import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import { KycProviderGovernanceService } from './kyc-provider-governance.service';
import { tier3HasAdditionalRequirement, type TierRequirements } from './kyc-tier-decision';
import { KycTierEvidenceReader } from './kyc-tier-evidence.reader';
import { validateTierPolicyDefinition, type TierPolicyDefinition } from './kyc-tier-policy.service';
import { PremblyCredentialGovernanceService } from './prembly-credential-governance.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKFORCE_TYPES = ['OPERATOR', 'PRIVILEGED'] as const;

export interface KycQueueQuery {
  search?: string;
  status?: string;
  level?: string;
  institutionId?: string;
  page?: number;
  limit?: number;
}

export interface KycReviewBlocker {
  code: string;
  severity: 'BLOCKING_APPROVAL' | 'ATTENTION' | 'INFO';
  title: string;
  detail: string;
}

function maskPhoneOrEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.includes('@')) {
    const [local, domain] = trimmed.split('@');
    if (!local || !domain) return '***';
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (trimmed.length <= 4) return '***';
  return `${trimmed.slice(0, 4)}***${trimmed.slice(-3)}`;
}

function maskDocumentNumber(raw: string | null | undefined): string {
  if (!raw) return '***';
  const trimmed = raw.trim();
  if (trimmed.length <= 4) return '****';
  return `••••${trimmed.slice(-4)}`;
}

function nextLevelFor(level: string): 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null {
  switch (level.toUpperCase()) {
    case 'NONE':
      return 'LEVEL_1';
    case 'LEVEL_1':
      return 'LEVEL_2';
    case 'LEVEL_2':
      return 'LEVEL_3';
    default:
      return null;
  }
}

@Injectable()
export class KycWorkforceReviewService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: AuthorizationService,
    private readonly evidenceReader: KycTierEvidenceReader,
    private readonly providerGovernance: KycProviderGovernanceService,
    private readonly premblyCredentials: PremblyCredentialGovernanceService,
    @Optional() private readonly institutionScope?: InstitutionWorkforceScopeService,
  ) {}

  private async requireMfaKycPrincipal(
    principal: AuthorizationPrincipal | undefined,
    allowedFunctions: readonly string[],
    resourceId?: string,
  ): Promise<AuthorizationPrincipal> {
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.assuranceLevel !== 'MFA' ||
      !principal.sessionId ||
      !UUID_PATTERN.test(principal.sessionId)
    ) {
      throw new ForbiddenException('MFA workforce session required');
    }
    void resourceId;
    let lastError: unknown;
    for (const fn of allowedFunctions) {
      if (principal.scopes.includes(fn)) {
        try {
          await this.auth.requireFunction(principal, fn, 'kyc-review-workspace', WORKFORCE_TYPES);
          return principal;
        } catch (err) {
          lastError = err;
        }
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new ForbiddenException(
      `KYC review workspace requires one of: ${allowedFunctions.join(', ')}`,
    );
  }

  private async hasGrant(
    principal: AuthorizationPrincipal,
    functionCode: string,
    resourceId?: string,
  ): Promise<boolean> {
    void resourceId;
    if (!principal.scopes.includes(functionCode)) return false;
    try {
      await this.auth.requireFunction(
        principal,
        functionCode,
        'kyc-review-workspace',
        WORKFORCE_TYPES,
      );
      return true;
    } catch {
      return false;
    }
  }

  async listQueue(principal: AuthorizationPrincipal | undefined, query: KycQueueQuery = {}) {
    const actor = await this.requireMfaKycPrincipal(principal, [
      'kyc.view',
      'kyc.review',
      'kyc.approve',
      'kyc.reject',
    ]);

    const scope = this.institutionScope
      ? await this.institutionScope.resolveCustomerRecordScope(actor, query.institutionId)
      : {
          mode: 'PLATFORM' as const,
          institutionIds: [] as string[],
          enrolmentsTablePresent: false,
          agentAffiliationsTablePresent: false,
        };

    const limit = Math.min(Math.max(Math.trunc(Number(query.limit) || 50), 1), 100);
    const page = Math.max(Math.trunc(Number(query.page) || 1), 1);
    const offset = (page - 1) * limit;
    const conditions: string[] = ['c.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (scope.mode === 'EXPLICIT_INSTITUTION' || scope.mode === 'ASSIGNED_INSTITUTIONS') {
      if (scope.enrolmentsTablePresent) {
        params.push(scope.institutionIds);
        conditions.push(
          `EXISTS (SELECT 1 FROM customer_institution_enrolments cie WHERE cie.customer_id = c.id AND cie.institution_id = ANY($${params.length}::uuid[]))`,
        );
      }
    } else if (scope.mode === 'UNASSIGNED_DIRECT_ONLY' && scope.enrolmentsTablePresent) {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM customer_institution_enrolments cie WHERE cie.customer_id = c.id)`,
      );
    }

    const statusFilter = query.status?.trim().toUpperCase();
    if (statusFilter && statusFilter !== 'ALL') {
      if (statusFilter === 'ACTIONABLE' || statusFilter === 'ATTENTION') {
        conditions.push(
          `(h.customer_id IS NOT NULL OR c.kyc_status IN ('PENDING', 'REJECTED') OR ev.outcome = 'MANUAL_REVIEW')`,
        );
      } else if (statusFilter === 'MANUAL_HOLD') {
        conditions.push(`h.customer_id IS NOT NULL`);
      } else if (['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED'].includes(statusFilter)) {
        params.push(statusFilter);
        conditions.push(`c.kyc_status = $${params.length}`);
      } else {
        throw new BadRequestException('Invalid KYC status filter');
      }
    }

    const levelFilter = query.level?.trim().toUpperCase();
    if (levelFilter && levelFilter !== 'ALL') {
      if (!['NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(levelFilter)) {
        throw new BadRequestException('Invalid KYC level filter');
      }
      params.push(levelFilter);
      conditions.push(`c.kyc_level = $${params.length}`);
    }

    const search = query.search?.trim();
    if (search) {
      if (UUID_PATTERN.test(search)) {
        params.push(search.toLowerCase());
        conditions.push(`c.id = $${params.length}::uuid`);
      } else {
        const escaped = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
        params.push(escaped);
        const idx = params.length;
        conditions.push(
          `(c.reference ILIKE $${idx} ESCAPE '\\' OR p.display_name ILIKE $${idx} ESCAPE '\\' OR p.legal_name ILIKE $${idx} ESCAPE '\\')`,
        );
      }
    }

    const canViewCustomer = await this.hasGrant(actor, 'customer.view');
    const canViewProvider = await this.hasGrant(actor, 'kyc.provider.view');
    const canViewPolicy = await this.hasGrant(actor, 'kyc.policy.view');

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const rows = await this.db.query<
      Array<{
        customer_id: string;
        reference: string;
        customer_type: string;
        customer_status: string;
        kyc_level: string;
        kyc_status: string;
        created_at: Date;
        display_name: string | null;
        legal_name: string | null;
        assessment_id: string | null;
        assessment_level: string | null;
        assessment_status: string | null;
        assessment_reason: string | null;
        assessed_by: string | null;
        assessment_created_at: Date | null;
        assessment_expires_at: Date | null;
        hold_reason: string | null;
        hold_actor: string | null;
        hold_created_at: Date | null;
        eval_outcome: string | null;
        eval_reason: string | null;
        eval_old_level: string | null;
        eval_new_level: string | null;
        eval_policy_version: number | null;
        eval_created_at: Date | null;
      }>
    >(
      `SELECT
         c.id AS customer_id,
         c.reference,
         c.customer_type,
         c.status AS customer_status,
         c.kyc_level,
         c.kyc_status,
         c.created_at,
         p.display_name,
         p.legal_name,
         a.id AS assessment_id,
         a.kyc_level AS assessment_level,
         a.kyc_status AS assessment_status,
         a.reason AS assessment_reason,
         a.assessed_by,
         a.created_at AS assessment_created_at,
         a.expires_at AS assessment_expires_at,
         h.reason AS hold_reason,
         h.actor AS hold_actor,
         h.created_at AS hold_created_at,
         ev.outcome AS eval_outcome,
         ev.reason AS eval_reason,
         ev.old_level AS eval_old_level,
         ev.new_level AS eval_new_level,
         ev.policy_version AS eval_policy_version,
         ev.created_at AS eval_created_at
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT display_name, legal_name
           FROM customer_profiles cp
          WHERE cp.customer_id = c.id AND cp.is_active = TRUE AND cp.deleted_at IS NULL
          ORDER BY cp.created_at DESC LIMIT 1
       ) p ON TRUE
       LEFT JOIN LATERAL (
         SELECT id, kyc_level, kyc_status, reason, assessed_by, created_at, expires_at
           FROM customer_kyc_assessments ka
          WHERE ka.customer_id = c.id AND ka.is_current = TRUE
          ORDER BY ka.updated_at DESC LIMIT 1
       ) a ON TRUE
       LEFT JOIN kyc_tier_manual_holds h ON h.customer_id = c.id
       LEFT JOIN LATERAL (
         SELECT outcome, reason, old_level, new_level, policy_version, created_at
           FROM kyc_tier_evaluations ke
          WHERE ke.customer_id = c.id
          ORDER BY ke.created_at DESC LIMIT 1
       ) ev ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE
           WHEN h.customer_id IS NOT NULL THEN 0
           WHEN c.kyc_status = 'PENDING' OR ev.outcome = 'MANUAL_REVIEW' THEN 1
           WHEN c.kyc_status = 'REJECTED' THEN 2
           WHEN c.kyc_status = 'NOT_STARTED' THEN 3
           ELSE 4
         END ASC,
         COALESCE(h.created_at, ev.created_at, a.created_at, c.created_at) DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );

    const items = rows.map((row) => {
      const priorityBand = row.hold_reason
        ? 'CRITICAL_HOLD'
        : row.kyc_status === 'PENDING' || row.eval_outcome === 'MANUAL_REVIEW'
          ? 'PENDING_REVIEW'
          : row.kyc_status === 'REJECTED'
            ? 'ACTIONABLE_BLOCKED'
            : row.kyc_status === 'NOT_STARTED'
              ? 'NOT_STARTED'
              : 'APPROVED';

      return {
        customerId: row.customer_id,
        reference: row.reference,
        customerReference: row.reference,
        displayName: canViewCustomer ? (row.display_name ?? row.legal_name ?? null) : null,
        customerType: row.customer_type,
        customerStatus: row.customer_status,
        kycLevel: row.kyc_level,
        kycStatus: row.kyc_status,
        priorityBand,
        currentAssessment: row.assessment_id
          ? {
              id: row.assessment_id,
              level: row.assessment_level,
              status: row.assessment_status,
              reason: row.assessment_reason,
              assessedBy: row.assessed_by,
              createdAt: row.assessment_created_at?.toISOString() ?? null,
              expiresAt: row.assessment_expires_at?.toISOString() ?? null,
            }
          : null,
        manualHold: row.hold_reason
          ? {
              reason: row.hold_reason,
              actor: row.hold_actor,
              createdAt: row.hold_created_at?.toISOString() ?? null,
            }
          : null,
        latestEvaluation: row.eval_outcome
          ? {
              outcome: row.eval_outcome,
              reason: row.eval_reason,
              oldLevel: row.eval_old_level,
              newLevel: row.eval_new_level,
              policyVersion: row.eval_policy_version,
              createdAt: row.eval_created_at?.toISOString() ?? null,
            }
          : null,
      };
    });

    const governance = await this.buildGovernanceSummary(actor, {
      canViewProvider,
      canViewPolicy,
    });

    const summary = {
      loaded: items.length,
      manualHolds: items.filter((item) => item.manualHold !== null).length,
      pendingReview: items.filter((item) => item.kycStatus === 'PENDING').length,
      rejected: items.filter((item) => item.kycStatus === 'REJECTED').length,
      notStarted: items.filter((item) => item.kycStatus === 'NOT_STARTED').length,
      approved: items.filter((item) => item.kycStatus === 'APPROVED').length,
    };

    return {
      items,
      total: items.length,
      page,
      limit,
      summary,
      counts: {
        total: items.length,
        pendingReview: summary.pendingReview,
        manualHolds: summary.manualHolds,
        rejected: summary.rejected,
        notStarted: summary.notStarted,
        approved: summary.approved,
      },
      scopeMode: scope.mode,
      governance,
    };
  }

  async inspectCustomer(principal: AuthorizationPrincipal | undefined, customerId: string) {
    if (!UUID_PATTERN.test(customerId)) {
      throw new BadRequestException('customerId must be a valid UUID');
    }
    const normalizedCustomerId = customerId.toLowerCase();
    const actor = await this.requireMfaKycPrincipal(principal, ['kyc.view'], normalizedCustomerId);

    if (this.institutionScope) {
      await this.institutionScope.assertCanAccessCustomerRecord(actor, normalizedCustomerId);
    }

    const customerRows = await this.db.query<
      Array<{
        id: string;
        reference: string;
        customer_type: string;
        status: string;
        kyc_level: string;
        kyc_status: string;
        created_at: Date;
        display_name: string | null;
        legal_name: string | null;
      }>
    >(
      `SELECT c.id, c.reference, c.customer_type, c.status, c.kyc_level, c.kyc_status, c.created_at,
              p.display_name, p.legal_name
         FROM customers c
         LEFT JOIN LATERAL (
           SELECT display_name, legal_name
             FROM customer_profiles cp
            WHERE cp.customer_id = c.id AND cp.is_active = TRUE AND cp.deleted_at IS NULL
            ORDER BY cp.created_at DESC LIMIT 1
         ) p ON TRUE
        WHERE c.id = $1::uuid AND c.deleted_at IS NULL
        LIMIT 1`,
      [normalizedCustomerId],
    );
    const customer = customerRows[0];
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const [
      canViewCustomer,
      canViewContacts,
      canViewAddress,
      canViewIdentityDocs,
      canViewPoaMetadata,
      canDownloadPoa,
      canViewProvider,
      canViewPolicy,
      canReviewKyc,
      canApproveKyc,
      canRejectKyc,
      canManageComplianceCase,
    ] = await Promise.all([
      this.hasGrant(actor, 'customer.view', normalizedCustomerId),
      this.hasGrant(actor, 'customer.view_contact_methods', normalizedCustomerId),
      this.hasGrant(actor, 'customer.view_address', normalizedCustomerId),
      this.hasGrant(actor, 'customer.view_identity_documents', normalizedCustomerId),
      this.hasGrant(actor, 'customer.view_proof_of_address_metadata', normalizedCustomerId),
      this.hasGrant(actor, 'customer.download_proof_of_address', normalizedCustomerId),
      this.hasGrant(actor, 'kyc.provider.view'),
      this.hasGrant(actor, 'kyc.policy.view'),
      this.hasGrant(actor, 'kyc.review', normalizedCustomerId),
      this.hasGrant(actor, 'kyc.approve', normalizedCustomerId),
      this.hasGrant(actor, 'kyc.reject', normalizedCustomerId),
      this.hasGrant(actor, 'compliance.manage_case', normalizedCustomerId),
    ]);

    // 1. Assessment state, history, evaluations & manual holds
    const [assessmentRows, evaluationRows, holdRows] = await Promise.all([
      this.db.query<
        Array<{
          id: string;
          kyc_level: string;
          kyc_status: string;
          reason: string | null;
          assessed_by: string;
          is_current: boolean;
          expires_at: Date | null;
          created_at: Date;
          updated_at: Date;
        }>
      >(
        `SELECT id, kyc_level, kyc_status, reason, assessed_by, is_current, expires_at, created_at, updated_at
           FROM customer_kyc_assessments
          WHERE customer_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 25`,
        [normalizedCustomerId],
      ),
      this.db.query<
        Array<{
          id: string;
          revision: string;
          policy_version: number | null;
          outcome: string;
          reason: string;
          old_level: string;
          new_level: string | null;
          actor: string;
          created_at: Date;
        }>
      >(
        `SELECT id, revision::text AS revision, policy_version, outcome, reason, old_level, new_level, actor, created_at
           FROM kyc_tier_evaluations
          WHERE customer_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 25`,
        [normalizedCustomerId],
      ),
      this.db.query<Array<{ actor: string; reason: string; created_at: Date }>>(
        `SELECT actor, reason, created_at
           FROM kyc_tier_manual_holds
          WHERE customer_id = $1::uuid
          LIMIT 1`,
        [normalizedCustomerId],
      ),
    ]);

    const currentAssessment = assessmentRows.find((row) => row.is_current) ?? null;
    const manualHold = holdRows[0] ?? null;

    // 2. Non-secret verification metadata (attempts, claims, consents — NO MACs or raw numbers)
    const [attemptRows, claimRows, consentRows] = await Promise.all([
      this.db.query<
        Array<{
          id: string;
          kind: string;
          provider: string;
          policy_version: string;
          outcome: string;
          consent_id: string;
          provider_route_version: number | null;
          created_at: Date;
          completed_at: Date | null;
          expires_at: Date | null;
        }>
      >(
        `SELECT id, kind, provider, policy_version, outcome, consent_id,
                provider_route_version, created_at, completed_at, expires_at
           FROM kyc_verification_attempts
          WHERE customer_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 20`,
        [normalizedCustomerId],
      ),
      this.db.query<
        Array<{
          id: string;
          kind: string;
          attempt_id: string | null;
          status: string;
          created_at: Date;
        }>
      >(
        `SELECT id, kind, attempt_id, status, created_at
           FROM kyc_identity_claims
          WHERE customer_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 20`,
        [normalizedCustomerId],
      ),
      this.db.query<
        Array<{
          id: string;
          kind: string;
          notice_version: string;
          provider: string | null;
          route_version: number | null;
          provenance: 'CUSTOMER_SESSION' | 'WORKFORCE_MFA' | 'UNVERIFIED';
          granted_at: Date;
          expires_at: Date;
          withdrawn_at: Date | null;
        }>
      >(
        `SELECT c.id, c.kind, c.notice_version, c.provider, c.route_version,
                CASE
                  WHEN c.session_id IS NOT NULL THEN 'CUSTOMER_SESSION'
                  WHEN EXISTS (
                    SELECT 1 FROM kyc_private_audit a
                     WHERE a.resource_id = c.id AND a.customer_id = c.customer_id
                       AND a.action = 'CONSENT_GRANTED' AND a.outcome = 'WORKFORCE_MFA'
                  ) THEN 'WORKFORCE_MFA'
                  ELSE 'UNVERIFIED'
                END AS provenance,
                c.granted_at, c.expires_at, c.withdrawn_at
           FROM kyc_consents c
          WHERE c.customer_id = $1::uuid
          ORDER BY c.granted_at DESC
          LIMIT 20`,
        [normalizedCustomerId],
      ),
    ]);

    // Check authoritative KycTierEvidenceReader readiness (non-locking read)
    const trustedEvidenceReady = await this.db.transaction(async (manager) => {
      const evidence = await this.evidenceReader.read(manager, normalizedCustomerId, {
        lockMode: 'NONE',
      });
      return Boolean(
        evidence &&
          evidence.evidence.some(
            (item) =>
              item.status === 'VERIFIED' &&
              item.provenance === 'VERIFIED_PROVIDER' &&
              (item.type === 'BVN' || item.type === 'NIN'),
          ),
      );
    });

    // 3. Permission-bounded Customer Evidence Sub-resources
    let primaryPhone:
      | { access: 'GRANTED'; present: boolean; verified: boolean; maskedValue: string | null }
      | { access: 'RESTRICTED'; requiredScope: string };
    if (canViewCustomer || canViewContacts) {
      const phoneRows = await this.db.query<
        Array<{ value: string; is_primary: boolean; verified_at: Date | null }>
      >(
        `SELECT value, is_primary, verified_at
           FROM customer_contact_methods
          WHERE customer_id = $1::uuid AND type = 'PHONE' AND deleted_at IS NULL
          ORDER BY is_primary DESC, created_at ASC
          LIMIT 1`,
        [normalizedCustomerId],
      );
      const top = phoneRows[0];
      primaryPhone = {
        access: 'GRANTED',
        present: Boolean(top),
        verified: Boolean(top?.verified_at),
        maskedValue: top ? maskPhoneOrEmail(top.value) : null,
      };
    } else {
      primaryPhone = { access: 'RESTRICTED', requiredScope: 'customer.view' };
    }

    let residentialAddress:
      | { access: 'GRANTED'; count: number; primarySummary: string | null }
      | { access: 'RESTRICTED'; requiredScope: string };
    if (canViewAddress) {
      const addrRows = await this.db.query<
        Array<{
          city: string;
          state: string;
          country: string;
          is_primary: boolean;
        }>
      >(
        `SELECT city, state, country, is_primary
           FROM customer_addresses
          WHERE customer_id = $1::uuid AND type = 'RESIDENTIAL' AND deleted_at IS NULL
          ORDER BY is_primary DESC, created_at ASC`,
        [normalizedCustomerId],
      );
      const top = addrRows[0];
      residentialAddress = {
        access: 'GRANTED',
        count: addrRows.length,
        primarySummary: top ? [top.city, top.state, top.country].filter(Boolean).join(', ') : null,
      };
    } else {
      residentialAddress = { access: 'RESTRICTED', requiredScope: 'customer.view_address' };
    }

    // SENSITIVE BOUNDARY 1: Identity Documents (`customer.view_identity_documents`)
    let identityDocuments:
      | {
          access: 'GRANTED';
          items: Array<{
            id: string;
            type: string;
            maskedDocumentNumber: string;
            issuingCountry: string;
            issuedAt: string | null;
            expiresAt: string | null;
            createdAt: string;
          }>;
        }
      | { access: 'RESTRICTED'; requiredScope: string; items: null };
    if (canViewIdentityDocs) {
      const docRows = await this.db.query<
        Array<{
          id: string;
          type: string;
          document_number: string;
          issuing_country: string;
          issued_at: Date | string | null;
          expires_at: Date | string | null;
          created_at: Date;
        }>
      >(
        `SELECT id, type, document_number, issuing_country, issued_at, expires_at, created_at
           FROM customer_identity_documents
          WHERE customer_id = $1::uuid AND deleted_at IS NULL
          ORDER BY created_at DESC`,
        [normalizedCustomerId],
      );
      identityDocuments = {
        access: 'GRANTED',
        items: docRows.map((doc) => ({
          id: doc.id,
          type: doc.type,
          maskedDocumentNumber: maskDocumentNumber(doc.document_number),
          issuingCountry: doc.issuing_country,
          issuedAt: doc.issued_at ? String(doc.issued_at).slice(0, 10) : null,
          expiresAt: doc.expires_at ? String(doc.expires_at).slice(0, 10) : null,
          createdAt: doc.created_at.toISOString(),
        })),
      };
    } else {
      identityDocuments = {
        access: 'RESTRICTED',
        requiredScope: 'customer.view_identity_documents',
        items: null,
      };
    }

    // SENSITIVE BOUNDARY 2: Proof of Address (`customer.view_proof_of_address_metadata`, auditorVisible: false)
    let proofOfAddress:
      | {
          access: 'GRANTED';
          canDownloadContent: boolean;
          items: Array<{
            id: string;
            revisionNumber: number;
            category: string;
            documentType: string;
            documentStatus: string;
            reviewStatus: string;
            scannerResult: string | null;
            uploadedAt: string | null;
          }>;
        }
      | { access: 'RESTRICTED'; requiredScope: string; items: null };
    if (canViewPoaMetadata && !actor.readOnlyPrincipal) {
      const poaRows = await this.db.query<
        Array<{
          id: string;
          revision_number: number;
          category: string;
          document_type: string;
          document_status: string;
          review_status: string;
          scanner_result: string | null;
          uploaded_at: Date | null;
        }>
      >(
        `SELECT id, revision_number, category, document_type, document_status, review_status, scanner_result, uploaded_at
           FROM customer_proof_of_address_submissions
          WHERE customer_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 20`,
        [normalizedCustomerId],
      );
      proofOfAddress = {
        access: 'GRANTED',
        canDownloadContent: canDownloadPoa,
        items: poaRows.map((row) => ({
          id: row.id,
          revisionNumber: row.revision_number,
          category: row.category,
          documentType: row.document_type,
          documentStatus: row.document_status,
          reviewStatus: row.review_status,
          scannerResult: row.scanner_result,
          uploadedAt: row.uploaded_at?.toISOString() ?? null,
        })),
      };
    } else {
      proofOfAddress = {
        access: 'RESTRICTED',
        requiredScope: 'customer.view_proof_of_address_metadata',
        items: null,
      };
    }

    // 4. Governance & Readiness (Provider routing & Tier policy publication)
    const governance = await this.buildGovernanceSummary(actor, {
      canViewProvider,
      canViewPolicy,
      targetNextLevel: nextLevelFor(customer.kyc_level),
    });

    // 5. Specific Blockers & Supported Operator Decisions
    const blockers: KycReviewBlocker[] = [];
    if (governance.tierPolicy.status !== 'EFFECTIVE') {
      blockers.push({
        code: 'TIER_POLICY_NOT_EFFECTIVE',
        severity: 'BLOCKING_APPROVAL',
        title:
          governance.tierPolicy.publishedVersion === 0
            ? 'No KYC tier policy version is published'
            : 'Published KYC tier policy is outside its effective window',
        detail:
          'KycTierTransitionService fails closed on APPROVED assessments until SUPER_ADMIN proposes and COMPLIANCE approves an effective KYC tier policy.',
      });
    }
    if (!trustedEvidenceReady) {
      blockers.push({
        code: 'TRUSTED_EVIDENCE_UNAVAILABLE',
        severity: 'BLOCKING_APPROVAL',
        title: 'Authoritative verified-evidence reader is unavailable',
        detail:
          'KycTierEvidenceReader returned null (no active provider verification trust anchor / MAC-bound BVN or NIN match on file). APPROVED tier promotions are blocked fail-closed; PENDING manual holds, REJECTED decisions, and Compliance Case escalations remain available.',
      });
    }
    if (
      governance.providerRouting.access === 'GRANTED' &&
      governance.providerRouting.dispatchReadyProviders.length === 0
    ) {
      blockers.push({
        code: 'NO_DISPATCH_READY_KYC_PROVIDER',
        severity: 'ATTENTION',
        title: 'No live KYC verification provider is currently dispatch-ready',
        detail:
          'Provider contract review, live-call release gates, or encrypted runtime credentials remain unconfigured across MONNIFY, DOJAH, and PREMBLY.',
      });
    }
    if (manualHold) {
      blockers.push({
        code: 'ACTIVE_MANUAL_HOLD',
        severity: 'ATTENTION',
        title: `Active manual hold: ${manualHold.reason}`,
        detail: `Placed by ${manualHold.actor} at ${manualHold.created_at.toISOString()}. Automatic tier promotion stays suspended while this hold is active.`,
      });
    }
    if (nextLevelFor(customer.kyc_level) === 'LEVEL_3') {
      blockers.push({
        code: 'TIER_3_ADDRESS_WORKFLOW_UNCONFIGURED',
        severity: 'ATTENTION',
        title: 'Tier 3 documentary & physical address verification workflows are not enabled',
        detail:
          'Stored Proof of Address files are malware-scanned only and do not establish documentary or physical address verification.',
      });
    }

    const readOnly = Boolean(actor.readOnlyPrincipal);
    const approvalBlocked = governance.tierPolicy.status !== 'EFFECTIVE' || !trustedEvidenceReady;

    return {
      customer: {
        id: customer.id,
        reference: customer.reference,
        type: customer.customer_type,
        status: customer.status,
        kycLevel: customer.kyc_level,
        kycStatus: customer.kyc_status,
        displayName: canViewCustomer ? customer.display_name : null,
        legalName: canViewCustomer ? customer.legal_name : null,
        createdAt: customer.created_at.toISOString(),
      },
      assessmentState: {
        current: currentAssessment
          ? {
              id: currentAssessment.id,
              level: currentAssessment.kyc_level,
              status: currentAssessment.kyc_status,
              reason: currentAssessment.reason,
              assessedBy: currentAssessment.assessed_by,
              createdAt: currentAssessment.created_at.toISOString(),
              updatedAt: currentAssessment.updated_at.toISOString(),
              expiresAt: currentAssessment.expires_at?.toISOString() ?? null,
            }
          : null,
        manualHold: manualHold
          ? {
              reason: manualHold.reason,
              actor: manualHold.actor,
              createdAt: manualHold.created_at.toISOString(),
            }
          : null,
      },
      evidenceStatus: {
        trustedVerificationEngine: {
          readerStatus: trustedEvidenceReady ? 'READY' : 'UNAVAILABLE',
          reasonCode: trustedEvidenceReady ? null : 'TRUSTED_EVIDENCE_UNAVAILABLE',
          verificationAttempts: attemptRows.map((row) => ({
            id: row.id,
            kind: row.kind,
            provider: row.provider,
            policyVersion: row.policy_version,
            outcome: row.outcome,
            consentId: row.consent_id,
            routeVersion: row.provider_route_version,
            createdAt: row.created_at.toISOString(),
            completedAt: row.completed_at?.toISOString() ?? null,
            expiresAt: row.expires_at?.toISOString() ?? null,
          })),
          identityClaims: claimRows.map((row) => ({
            id: row.id,
            kind: row.kind,
            attemptId: row.attempt_id,
            status: row.status,
            createdAt: row.created_at.toISOString(),
          })),
          consents: consentRows.map((row) => ({
            id: row.id,
            kind: row.kind,
            noticeVersion: row.notice_version,
            provider: row.provider,
            routeVersion: row.route_version,
            provenance: row.provenance,
            grantedAt: row.granted_at.toISOString(),
            expiresAt: row.expires_at.toISOString(),
            withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
          })),
        },
        primaryPhone,
        residentialAddress,
        identityDocuments,
        proofOfAddress,
      },
      reviewHistory: {
        assessments: assessmentRows.map((row) => ({
          id: row.id,
          level: row.kyc_level,
          status: row.kyc_status,
          reason: row.reason,
          assessedBy: row.assessed_by,
          isCurrent: row.is_current,
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at?.toISOString() ?? null,
        })),
        evaluations: evaluationRows.map((row) => ({
          id: row.id,
          revision: row.revision,
          policyVersion: row.policy_version,
          outcome: row.outcome,
          reason: row.reason,
          oldLevel: row.old_level,
          newLevel: row.new_level,
          actor: row.actor,
          createdAt: row.created_at.toISOString(),
        })),
      },
      governance,
      blockers,
      supportedDecisions: {
        readOnlyPrincipal: readOnly,
        canPlaceHoldPending: !readOnly && (canReviewKyc || canApproveKyc || canRejectKyc),
        canReject: !readOnly && canRejectKyc,
        canApprove: !readOnly && canApproveKyc,
        approvalEligibleNow: !readOnly && canApproveKyc && !approvalBlocked,
        approvalBlockedReason: approvalBlocked
          ? governance.tierPolicy.status !== 'EFFECTIVE'
            ? 'Effective KYC tier policy is not published.'
            : 'Trusted verification evidence reader is unavailable for this customer.'
          : null,
        governedHoldReasons: ['MANUAL_REVIEW', 'IDENTITY_CONFLICT', 'EVIDENCE_REVOKED'],
        canEscalateToComplianceCase: !readOnly && canManageComplianceCase,
        canViewCustomer360: canViewCustomer,
      },
    };
  }

  private async buildGovernanceSummary(
    actor: AuthorizationPrincipal,
    opts: {
      canViewProvider: boolean;
      canViewPolicy: boolean;
      targetNextLevel?: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null;
    },
  ) {
    const now = new Date();
    const headRows = await this.db.query<Array<{ version: number }>>(
      'SELECT version FROM kyc_tier_policy_head WHERE singleton = TRUE',
    );
    const publishedVersion = Number(headRows[0]?.version ?? 0);
    const versionRows = await this.db.query<
      Array<{
        version: number;
        definition: unknown;
        maker_id: string;
        checker_id: string;
        approved_at: Date;
      }>
    >(
      'SELECT version, definition, maker_id, checker_id, approved_at FROM kyc_tier_policy_versions ORDER BY version DESC LIMIT 12',
    );

    let effectiveVersion: number | null = null;
    let effectiveDefinition: TierPolicyDefinition | null = null;
    let latestApprovedAt: string | null = null;
    for (const row of versionRows) {
      if (!latestApprovedAt) latestApprovedAt = row.approved_at.toISOString();
      try {
        const parsed = validateTierPolicyDefinition(row.definition);
        const from = new Date(parsed.effectiveFrom).getTime();
        const until = parsed.effectiveUntil ? new Date(parsed.effectiveUntil).getTime() : null;
        if (from <= now.getTime() && (until === null || until > now.getTime())) {
          effectiveVersion = row.version;
          effectiveDefinition = parsed;
          break;
        }
      } catch {
        // Ignore invalid historical definition
      }
    }

    let pendingPolicyProposals = 0;
    if (opts.canViewPolicy) {
      const pendingRows = await this.db.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM kyc_tier_policy_proposals WHERE state = 'REQUESTED' AND expires_at > clock_timestamp()`,
      );
      pendingPolicyProposals = Number(pendingRows[0]?.count ?? '0');
    }

    let nextLevelRequirements: {
      level: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
      configured: boolean;
      regulatory: TierRequirements | null;
      operator: TierRequirements | null;
    } | null = null;
    if (opts.targetNextLevel) {
      const lvl = opts.targetNextLevel;
      const configured =
        effectiveDefinition !== null &&
        (lvl !== 'LEVEL_3' || tier3HasAdditionalRequirement(effectiveDefinition));
      nextLevelRequirements = {
        level: lvl,
        configured,
        regulatory:
          opts.canViewPolicy && configured && effectiveDefinition
            ? effectiveDefinition.regulatory[lvl]
            : null,
        operator:
          opts.canViewPolicy && configured && effectiveDefinition
            ? effectiveDefinition.operator[lvl]
            : null,
      };
    }

    const tierPolicy = {
      access: opts.canViewPolicy ? ('GRANTED' as const) : ('SUMMARY_ONLY' as const),
      requiredDetailScope: 'kyc.policy.view',
      publishedVersion,
      effectiveVersion,
      status:
        publishedVersion === 0
          ? ('UNCONFIGURED' as const)
          : effectiveVersion !== null
            ? ('EFFECTIVE' as const)
            : ('PUBLISHED_NOT_EFFECTIVE' as const),
      latestApprovedAt: opts.canViewPolicy ? latestApprovedAt : null,
      effectiveFrom:
        opts.canViewPolicy && effectiveDefinition ? effectiveDefinition.effectiveFrom : null,
      effectiveUntil:
        opts.canViewPolicy && effectiveDefinition ? effectiveDefinition.effectiveUntil : null,
      pendingProposalsCount: opts.canViewPolicy ? pendingPolicyProposals : null,
      nextLevelRequirements,
    };

    // SENSITIVE BOUNDARY 3: Provider settings & secret metadata (`kyc.provider.view` ONLY!)
    let providerRouting:
      | {
          access: 'GRANTED';
          version: number;
          dispatchReadyProviders: string[];
          pendingProposalsCount: number;
          providers: Array<{
            code: string;
            enabled: boolean;
            ready: boolean;
            testOnly: boolean;
            configuredCapabilities: string[];
            confirmedCapabilities: string[];
          }>;
          routes: Record<
            string,
            {
              primary: string | null;
              fallback: string | null;
              primaryReady: boolean;
              fallbackReady: boolean;
            }
          >;
          premblyCredentials: {
            encryptionAvailable: boolean;
            sandboxConfigured: boolean;
            productionConfigured: boolean;
            productionReleased: boolean;
          } | null;
        }
      | {
          access: 'RESTRICTED';
          requiredScope: 'kyc.provider.view';
        };

    if (opts.canViewProvider) {
      const [workspace, providerProposals, premblyStatus] = await Promise.all([
        this.providerGovernance.view(actor),
        this.providerGovernance.proposals(actor),
        this.premblyCredentials.status(actor).catch(() => null),
      ]);
      const readyByCode = new Map(workspace.catalogue.map((c) => [c.code, c.ready && !c.testOnly]));
      const routes: Record<
        string,
        {
          primary: string | null;
          fallback: string | null;
          primaryReady: boolean;
          fallbackReady: boolean;
        }
      > = {};
      for (const [capability, route] of Object.entries(workspace.configuration.routes)) {
        routes[capability] = {
          primary: route.primary,
          fallback: route.fallback,
          primaryReady: route.primary ? Boolean(readyByCode.get(route.primary)) : false,
          fallbackReady: route.fallback ? Boolean(readyByCode.get(route.fallback)) : false,
        };
      }
      providerRouting = {
        access: 'GRANTED',
        version: workspace.version,
        dispatchReadyProviders: workspace.catalogue
          .filter((item) => item.ready && !item.testOnly)
          .map((item) => item.code),
        pendingProposalsCount: providerProposals.filter((p) => p.state === 'REQUESTED').length,
        providers: workspace.catalogue.map((item) => ({
          code: item.code,
          enabled: workspace.configuration.providers[item.code]?.enabled ?? false,
          ready: item.ready,
          testOnly: item.testOnly,
          configuredCapabilities: workspace.configuration.providers[item.code]?.capabilities ?? [],
          confirmedCapabilities: [...item.confirmedCapabilities],
        })),
        routes,
        premblyCredentials: premblyStatus
          ? {
              encryptionAvailable: premblyStatus.encryptionAvailable,
              sandboxConfigured: premblyStatus.sandbox.configured,
              productionConfigured: premblyStatus.production.configured,
              productionReleased: premblyStatus.productionReleased,
            }
          : null,
      };
    } else {
      providerRouting = {
        access: 'RESTRICTED',
        requiredScope: 'kyc.provider.view',
      };
    }

    return {
      tierPolicy,
      providerRouting,
    };
  }
}
