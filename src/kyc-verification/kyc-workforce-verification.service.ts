import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { CustomerSessionValidator } from '../customer-authentication/authentication-session.types';
import type { InstitutionWorkforceScopeService } from '../institution/institution-workforce-scope.service';
import type { AuditService } from '../operations/audit.service';
import type { CustomerKycVerificationConfiguration } from './kyc-customer-verification.service';
import { KycOrchestrator, UUID } from './kyc-orchestrator';
import { assertPolicy } from './kyc-policy';
import type { KycProviderGovernanceService } from './kyc-provider-governance.service';
import {
  KycFoundationError,
  type IdentityDetails,
  type KycPolicy,
  type KycProvider,
} from './kyc.types';
import { PostgresKycStore } from './postgres-kyc.store';

export interface WorkforceIdentityVerificationCommand {
  kind: 'BVN' | 'NIN';
  customerConsentConfirmed: boolean;
  noticeVersion: string;
  consentRequestId: string;
  requestId: string;
  expectedProvider?: 'MONNIFY' | 'DOJAH' | 'PREMBLY';
  expectedRouteVersion?: number;
  identifier?: string;
}

export interface WorkforceIdentityVerificationResult {
  id: string;
  consentId: string;
  kind: 'BVN' | 'NIN';
  status: string;
  provider: string;
  routeVersion: number;
  identityRevision: string;
  expiresAt: string | null;
}

function sameElevenDigits(a: string, b: string): boolean {
  if (!/^\d{11}$/.test(a) || !/^\d{11}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export class KycWorkforceVerificationService {
  private readonly store: PostgresKycStore;

  constructor(
    private readonly db: DataSource,
    sessions: CustomerSessionValidator,
    private readonly auth: AuthorizationService,
    private readonly institutionScope: InstitutionWorkforceScopeService,
    private readonly governance: KycProviderGovernanceService,
    private readonly providers: readonly KycProvider[],
    private readonly configuration: CustomerKycVerificationConfiguration,
    private readonly audit: AuditService,
  ) {
    this.store = new PostgresKycStore(db, sessions);
  }

  consentNotice(): { version: string; text: string } | null {
    const { consentNoticeVersion, consentNoticeText } = this.configuration;
    if (
      !consentNoticeVersion ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(consentNoticeVersion) ||
      typeof consentNoticeText !== 'string' ||
      consentNoticeText.trim().length < 20
    ) {
      return null;
    }
    return { version: consentNoticeVersion, text: consentNoticeText };
  }

  private policy(): { policy: KycPolicy; consentSeconds: number; ownershipKey: Buffer } {
    const c = this.configuration;
    if (
      c.enabled !== true ||
      !c.policy ||
      c.policy.enabled !== true ||
      !c.consentNoticeVersion ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(c.consentNoticeVersion) ||
      typeof c.consentNoticeText !== 'string' ||
      c.consentNoticeText.trim().length < 20 ||
      c.consentNoticeText.length > 10000 ||
      typeof c.consentValiditySeconds !== 'number' ||
      !Number.isSafeInteger(c.consentValiditySeconds) ||
      c.consentValiditySeconds < c.policy.evidenceValiditySeconds ||
      c.consentValiditySeconds > 31536000 ||
      !Buffer.isBuffer(c.ownershipKey) ||
      c.ownershipKey.length < 32 ||
      !c.ownershipKeyVersion ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(c.ownershipKeyVersion)
    ) {
      throw new ServiceUnavailableException('KYC verification is not configured');
    }
    assertPolicy(c.policy);
    return {
      policy: { ...c.policy },
      consentSeconds: c.consentValiditySeconds,
      ownershipKey: Buffer.from(c.ownershipKey),
    };
  }

  async verifyRegisteredIdentity(
    principal: AuthorizationPrincipal | undefined,
    customerId: string,
    command: WorkforceIdentityVerificationCommand,
  ): Promise<WorkforceIdentityVerificationResult> {
    if (!principal || !['OPERATOR', 'PRIVILEGED'].includes(principal.type)) {
      throw new UnauthorizedException('Workforce authentication required');
    }
    if (principal.readOnlyPrincipal) {
      throw new ForbiddenException(
        'Read-only workforce principals cannot execute KYC verification',
      );
    }
    if (
      principal.assuranceLevel !== 'MFA' ||
      !principal.sessionId ||
      !UUID.test(principal.sessionId)
    ) {
      throw new ForbiddenException('MFA workforce session required for KYC verification');
    }
    const normalizedCustomerId = typeof customerId === 'string' ? customerId.trim() : '';
    if (!UUID.test(normalizedCustomerId)) {
      throw new BadRequestException('customerId must be a valid UUID');
    }

    await this.auth.requireFunction(principal, 'kyc.review', 'kyc_review', [
      'OPERATOR',
      'PRIVILEGED',
    ]);
    await this.auth.requireFunction(principal, 'customer.view_identity_documents', 'customer', [
      'OPERATOR',
      'PRIVILEGED',
    ]);
    if (this.institutionScope) {
      await this.institutionScope.assertCanAccessCustomerRecord(principal, normalizedCustomerId);
    }

    const { policy, consentSeconds, ownershipKey } = this.policy();

    if (
      !command ||
      !['BVN', 'NIN'].includes(command.kind) ||
      command.customerConsentConfirmed !== true ||
      command.noticeVersion !== this.configuration.consentNoticeVersion ||
      !UUID.test(command.consentRequestId ?? '') ||
      !UUID.test(command.requestId ?? '') ||
      (command.expectedProvider !== undefined &&
        !['MONNIFY', 'DOJAH', 'PREMBLY'].includes(command.expectedProvider)) ||
      (command.expectedRouteVersion !== undefined &&
        (!Number.isSafeInteger(command.expectedRouteVersion) ||
          command.expectedRouteVersion < 1)) ||
      (command.identifier !== undefined && !/^\d{11}$/.test(command.identifier))
    ) {
      throw new BadRequestException(
        'Valid kind, customerConsentConfirmed=true, active noticeVersion, consentRequestId, and requestId are required',
      );
    }

    try {
      const context = await this.loadRegisteredIdentityContext(
        normalizedCustomerId,
        command.kind,
        command.identifier,
      );
      const route = await this.governance.resolve(command.kind);
      if (
        !['MONNIFY', 'DOJAH', 'PREMBLY'].includes(route.provider) ||
        !this.providers.some((candidate) => candidate.code === route.provider)
      ) {
        throw new ServiceUnavailableException('Governed KYC provider runtime is not ready');
      }
      if (
        (command.expectedProvider !== undefined && route.provider !== command.expectedProvider) ||
        (command.expectedRouteVersion !== undefined &&
          route.version !== command.expectedRouteVersion)
      ) {
        throw new ConflictException(
          'Active governed KYC provider route changed; reload the workspace before verifying',
        );
      }
      const provider = this.providers.find((candidate) => candidate.code === route.provider);
      if (!provider) {
        throw new ServiceUnavailableException('Governed KYC provider adapter is unavailable');
      }

      const consentId = await this.store.grantWorkforceRegistrationConsent({
        customerId: normalizedCustomerId,
        workforceSessionId: principal.sessionId,
        kind: command.kind,
        noticeVersion: command.noticeVersion,
        expiresAt: new Date(Date.now() + consentSeconds * 1000),
        requestId: command.consentRequestId,
        provider: route.provider,
        routeVersion: route.version,
        identityRevision: context.identityRevision,
      });

      const sessionMacKey = createHmac('sha256', ownershipKey)
        .update('kyc-workforce-request-v1\0')
        .update(principal.sessionId)
        .digest();

      const orchestrator = new KycOrchestrator(
        this.store,
        provider,
        policy,
        sessionMacKey,
        'workforce-session-v1',
        ownershipKey,
        this.configuration.ownershipKeyVersion!,
        {
          assert: async (providerCode, kind) => {
            const current = await this.governance.resolve(kind);
            if (current.version !== route.version || current.provider !== providerCode) {
              throw new KycFoundationError('BLOCKED');
            }
          },
        },
      );

      const attempt = await orchestrator.verify({
        customerId: normalizedCustomerId,
        consentId,
        requestId: command.requestId,
        sessionToken: '',
        workforceSessionId: principal.sessionId,
        identityRevision: context.identityRevision,
        providerRouteVersion: route.version,
        input: {
          kind: command.kind,
          identifier: context.identifier,
          identity: context.identity,
        },
      });

      await this.db.transaction(async (manager) => {
        await this.audit.record(manager, {
          entityType: 'CUSTOMER_KYC_VERIFICATION',
          entityId: attempt.id,
          action: 'WORKFORCE_VERIFIED',
          actor: principal.principalId,
          newValues: {
            customerId: normalizedCustomerId,
            kind: command.kind,
            provider: attempt.provider,
            routeVersion: route.version,
            identityRevision: context.identityRevision,
            outcome: attempt.outcome,
            consentId,
            workforceSessionId: principal.sessionId,
          },
        });
      });

      return {
        id: attempt.id,
        consentId,
        kind: command.kind,
        status: attempt.outcome,
        provider: attempt.provider,
        routeVersion: route.version,
        identityRevision: context.identityRevision,
        expiresAt: attempt.expiresAt?.toISOString() ?? null,
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private async loadRegisteredIdentityContext(
    customerId: string,
    kind: 'BVN' | 'NIN',
    suppliedIdentifier?: string,
  ): Promise<{
    identityRevision: string;
    identifier: string;
    identity: IdentityDetails;
  }> {
    return this.db.transaction(async (m) => {
      const customers = await m.query<
        Array<{ id: string; status: string; is_synthetic: boolean; customer_type: string }>
      >(
        'SELECT id, status, is_synthetic, customer_type FROM customers WHERE id = $1 AND deleted_at IS NULL',
        [customerId],
      );
      const customer = customers[0];
      if (!customer) {
        throw new NotFoundException(`Customer ${customerId} was not found`);
      }
      if (
        customer.is_synthetic ||
        customer.customer_type !== 'INDIVIDUAL' ||
        !['DRAFT', 'ACTIVE'].includes(customer.status)
      ) {
        throw new ConflictException(
          'Customer must be a non-synthetic DRAFT or ACTIVE individual customer',
        );
      }

      const [revisions, profiles, phones, documents] = await Promise.all([
        m.query<Array<{ revision: string }>>(
          'SELECT revision::text AS revision FROM kyc_customer_identity_revisions WHERE customer_id = $1 FOR SHARE',
          [customerId],
        ),
        m.query<
          Array<{
            first_name: string | null;
            last_name: string | null;
            date_of_birth: string | null;
          }>
        >(
          `SELECT first_name, last_name, date_of_birth::text AS date_of_birth
             FROM customer_profiles
            WHERE customer_id = $1 AND is_active = true AND deleted_at IS NULL
            ORDER BY updated_at DESC LIMIT 2`,
          [customerId],
        ),
        m.query<Array<{ phone: string; verified_at: Date | null }>>(
          `SELECT normalized_value AS phone, verified_at
             FROM customer_contact_methods
            WHERE customer_id = $1 AND type = 'PHONE' AND is_primary = true AND deleted_at IS NULL
            ORDER BY updated_at DESC LIMIT 2`,
          [customerId],
        ),
        m.query<Array<{ document_number: string }>>(
          `SELECT document_number
             FROM customer_identity_documents
            WHERE customer_id = $1 AND type = $2 AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 2`,
          [customerId, kind],
        ),
      ]);

      const identityRevision = revisions[0]?.revision;
      const profile = profiles[0];
      const phone = phones[0]?.phone;
      if (
        profiles.length !== 1 ||
        !profile?.first_name ||
        !profile.last_name ||
        !profile.date_of_birth ||
        phones.length !== 1 ||
        !phones[0]?.verified_at ||
        !phone ||
        !/^\+?\d{7,15}$/.test(phone) ||
        !identityRevision ||
        !/^[1-9][0-9]{0,18}$/.test(identityRevision)
      ) {
        throw new ConflictException(
          'Customer must have an active individual profile and a verified primary phone before KYC verification',
        );
      }

      if (documents.length !== 1 || !/^\d{11}$/.test(documents[0]!.document_number.trim())) {
        throw new ConflictException(
          `Customer must have a single active 11-digit ${kind} identity document recorded before verification`,
        );
      }
      const recordedIdentifier = documents[0]!.document_number.trim();
      if (
        suppliedIdentifier !== undefined &&
        !sameElevenDigits(suppliedIdentifier, recordedIdentifier)
      ) {
        throw new ConflictException(
          `Supplied ${kind} does not match the customer's recorded ${kind} identity document`,
        );
      }

      return {
        identityRevision,
        identifier: recordedIdentifier,
        identity: {
          firstName: profile.first_name,
          lastName: profile.last_name,
          dateOfBirth: profile.date_of_birth,
          phone,
        },
      };
    });
  }

  private mapError(error: unknown): Error {
    if (error instanceof KycFoundationError) {
      switch (error.code) {
        case 'INVALID':
          return new BadRequestException('Invalid KYC verification request');
        case 'NOT_FOUND':
          return new NotFoundException('Customer or KYC resource was not found');
        case 'CONFLICT':
          return new ConflictException(
            'KYC consent or identity snapshot changed; reload and retry verification',
          );
        case 'BLOCKED':
          return new ConflictException(
            'KYC verification is blocked by active evidence, rate limit, or ownership conflict',
          );
        case 'DISABLED':
          return new ServiceUnavailableException('KYC verification is disabled or unavailable');
      }
    }
    return error instanceof Error
      ? error
      : new ServiceUnavailableException('KYC verification failed');
  }
}
