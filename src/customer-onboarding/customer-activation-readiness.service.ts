import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { maskCustomerReference } from '../customer/customer-privacy';
import type { EffectiveCustomerClass } from '../customer-class/customer-class.types';
import { CustomerClassResolverService } from '../customer-class/customer-class-resolver.service';
import { CustomerFinancialEligibilityService } from '../kyc-verification/customer-financial-eligibility.service';
import { KycTierEvidenceReader } from '../kyc-verification/kyc-tier-evidence.reader';
import { CustomerEffectiveConfigurationService } from './customer-effective-configuration.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The single readiness authority for customer onboarding completion.
 *
 * It is deliberately READ-ONLY and shared by:
 *   - the workforce registration-review surface
 *     (`GET /internal/customers/:id/registration-review`), and
 *   - the customer's own activation surface (`GET/POST /customers/me/activation`),
 *
 * so the "outstanding requirements" an administrator sees and the ones the customer sees are
 * produced by one implementation rather than two that can drift apart.
 *
 * Design rules:
 *   1. The definitive gate is {@link CustomerFinancialEligibilityService.require} with
 *      `requireActive = false` — the same service that gates every money movement. This projection
 *      never re-derives regulatory thresholds or replaces that decision.
 *   2. Attribution is separate from authority. The per-requirement checks below explain *why* the
 *      gate fails; they never override it. A requirement is reported `met` only when it can be
 *      positively demonstrated from authoritative rows.
 *   3. Missing evidence is never reported as satisfied. When the trusted evidence reader is
 *      unavailable (its production behaviour with no approved provider adapter) the projection
 *      says `unavailable`, and `canActivate` is false.
 *   4. Nothing here mutates state, provisions a wallet, issues a credential, or activates a
 *      customer.
 */
export interface ActivationRequirement {
  /** Stable machine code, e.g. `phone_verified`. */
  code: string;
  /** Customer-safe label suitable for the mobile app and the admin console. */
  label: string;
  state: 'MET' | 'OUTSTANDING' | 'UNAVAILABLE' | 'BLOCKED';
  /** Optional detail: never contains identifiers, credentials or provider payloads. */
  detail?: string;
}

export interface CustomerOnboardingReadiness {
  customerId: string;
  referenceMasked: string;
  customerType: string;
  customerStatus: string;
  isSynthetic: boolean;
  kyc: {
    level: string;
    status: string;
    assessment: {
      level: string;
      status: string;
      expiresAt: string | null;
      reason: string | null;
    } | null;
  };
  customerClass: {
    configured: boolean;
    classCode: string | null;
    className: string | null;
    source: string | null;
    effectiveFrom: string | null;
  };
  phone: { verifiedPrimaryPhone: boolean; phoneCount: number };
  restrictions: { active: string[] };
  identityConflicts: number;
  trustedEvidence: {
    state: 'VERIFIED' | 'MISSING' | 'UNAVAILABLE';
    verifiedKinds: string[];
    detail?: string;
  };
  financialEligibility: { eligible: boolean; reason: string | null; message: string | null };
  wallet: {
    provisioned: boolean;
    walletId: string | null;
    currency: string | null;
    status: string | null;
    balanceMinor: string | null;
  };
  onboardingWorkflow: {
    status: string | null;
    eligibility: string | null;
    completed: boolean;
  };
  commercialConfiguration?: {
    complete: boolean;
    issues: string[];
  };
  requirements: ActivationRequirement[];
  outstanding: string[];
  activatable: boolean;
  evaluatedAt: string;
}

interface CustomerRow {
  id: string;
  reference: string;
  customer_type: string;
  status: string;
  kyc_level: string;
  kyc_status: string;
  is_synthetic: boolean;
  deleted_at: Date | null;
}

@Injectable()
export class CustomerActivationReadinessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly classes: CustomerClassResolverService,
    private readonly financialEligibility: CustomerFinancialEligibilityService,
    private readonly evidenceReader: KycTierEvidenceReader,
    @Optional()
    @Inject(CustomerEffectiveConfigurationService)
    private readonly effectiveConfiguration?: CustomerEffectiveConfigurationService,
  ) {}

  async evaluateOuter(customerId: string): Promise<CustomerOnboardingReadiness> {
    return this.dataSource.transaction((manager) => this.evaluate(manager, customerId));
  }

  async evaluate(manager: EntityManager, customerId: string): Promise<CustomerOnboardingReadiness> {
    if (typeof customerId !== 'string' || !UUID.test(customerId)) {
      throw new NotFoundException('Customer not found');
    }
    const customers = await manager.query<CustomerRow[]>(
      `SELECT id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic,deleted_at
         FROM customers WHERE id=$1`,
      [customerId],
    );
    const customer = customers[0];
    if (!customer || (customer.deleted_at && customer.status !== 'CLOSED')) {
      throw new NotFoundException('Customer not found');
    }

    const assessments = await manager.query<
      Array<{
        kyc_level: string;
        kyc_status: string;
        expires_at: Date | null;
        reason: string | null;
      }>
    >(
      `SELECT kyc_level,kyc_status,expires_at,reason FROM customer_kyc_assessments
        WHERE customer_id=$1 AND is_current=true ORDER BY updated_at DESC LIMIT 1`,
      [customerId],
    );
    const assessment = assessments[0] ?? null;

    const phones = await manager.query<Array<{ is_primary: boolean; verified: boolean }>>(
      `SELECT is_primary,(verified_at IS NOT NULL) AS verified FROM customer_contact_methods
        WHERE customer_id=$1 AND type='PHONE' AND deleted_at IS NULL`,
      [customerId],
    );
    const verifiedPrimaryPhone = phones.some((phone) => phone.is_primary && phone.verified);

    const restrictions = await manager.query<Array<{ type: string }>>(
      `SELECT type FROM customer_restrictions
        WHERE customer_id=$1 AND is_active=true AND deleted_at IS NULL
          AND type IN ('FROZEN','BLACKLISTED','CONFIGURATION_REVIEW') ORDER BY type`,
      [customerId],
    );
    const conflicts = await manager.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM kyc_identity_conflicts
        WHERE requester_customer_id=$1 OR claimed_customer_id=$1`,
      [customerId],
    );

    let trustedEvidence: CustomerOnboardingReadiness['trustedEvidence'];
    try {
      const snapshot = await this.evidenceReader.read(manager, customerId);
      if (!snapshot || snapshot.evidence.length === 0) {
        trustedEvidence = {
          state: 'MISSING',
          verifiedKinds: [],
          detail: 'No trusted, identity-bound identity evidence is on record',
        };
      } else {
        const verified = snapshot.evidence.filter(
          (entry) =>
            entry.status === 'VERIFIED' &&
            entry.provenance !== 'SYNTHETIC' &&
            entry.expiresAt !== null &&
            entry.expiresAt.getTime() > Date.now(),
        );
        trustedEvidence = {
          state: verified.length > 0 ? 'VERIFIED' : 'MISSING',
          verifiedKinds: [...new Set(verified.map((entry) => entry.type))].sort(),
          ...(verified.length > 0
            ? {}
            : {
                detail:
                  'Identity evidence exists but none is currently verified, unexpired and non-synthetic',
              }),
        };
      }
    } catch {
      trustedEvidence = {
        state: 'UNAVAILABLE',
        verifiedKinds: [],
        detail: 'Trusted identity evidence could not be read',
      };
    }

    let eligibility: CustomerOnboardingReadiness['financialEligibility'];
    try {
      await this.financialEligibility.require(manager, customerId, {
        requireActive: false,
        lockMode: 'SHARE',
      });
      eligibility = { eligible: true, reason: null, message: null };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : 'Unavailable';
      eligibility = { eligible: false, reason: 'GATE_DENIED', message };
    }

    const wallets = await manager.query<Array<{ id: string; currency: string; status: string }>>(
      `SELECT id,currency,status FROM wallet_accounts
        WHERE lower(customer_id)=lower($1) ORDER BY created_at,id LIMIT 1`,
      [customerId],
    );
    const wallet = wallets[0] ?? null;

    const onboardings = await manager.query<Array<{ status: string }>>(
      `SELECT status FROM customer_onboardings
        WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    );
    const eligibilities = await manager.query<Array<{ status: string }>>(
      `SELECT status FROM customer_eligibilities
        WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    );

    let customerClass: CustomerOnboardingReadiness['customerClass'];
    try {
      const resolved: EffectiveCustomerClass | null = await this.classes.resolveInManager(
        manager,
        customerId,
      );
      customerClass = resolved
        ? {
            configured: true,
            classCode: resolved.classCode,
            className: resolved.className,
            source: resolved.source,
            effectiveFrom: resolved.effectiveFrom.toISOString(),
          }
        : {
            configured: false,
            classCode: null,
            className: null,
            source: null,
            effectiveFrom: null,
          };
    } catch {
      customerClass = {
        configured: false,
        classCode: null,
        className: null,
        source: null,
        effectiveFrom: null,
      };
    }

    const assessmentIsCurrent =
      assessment !== null &&
      assessment.kyc_status === 'APPROVED' &&
      assessment.kyc_level === customer.kyc_level &&
      assessment.expires_at !== null &&
      assessment.expires_at.getTime() > Date.now();

    let commercialConfig: {
      complete: boolean;
      issues: string[];
      state: ActivationRequirement['state'];
      detail?: string;
    } = {
      complete: false,
      issues: [],
      state: 'UNAVAILABLE',
      detail: 'Commercial configuration evaluation unavailable',
    };
    if (this.effectiveConfiguration) {
      try {
        const eff = await this.effectiveConfiguration.evaluateInManager(manager, customerId);
        const issues: string[] = [];
        if (!eff.assignedClass) {
          issues.push('No effective customer class assigned for verified tier');
        }
        for (const product of eff.products) {
          if (product.fee.status === 'NOT_CONFIGURED' || product.fee.status === 'AMBIGUOUS') {
            issues.push(`${product.productCode}: fee ${product.fee.status.toLowerCase()}`);
          }
          for (const limit of product.limits) {
            if (limit.status === 'MISSING') {
              issues.push(`${product.productCode}: ${limit.dimension} missing`);
            }
          }
        }
        commercialConfig =
          issues.length === 0
            ? { complete: true, issues: [], state: 'MET' }
            : {
                complete: false,
                issues,
                state: 'OUTSTANDING',
                detail: issues.slice(0, 8).join('; '),
              };
      } catch (error) {
        commercialConfig = {
          complete: false,
          issues: ['evaluation_failed'],
          state: 'UNAVAILABLE',
          detail: error instanceof Error ? error.message.slice(0, 200) : 'Evaluation failed',
        };
      }
    }

    const requirements: ActivationRequirement[] = [
      {
        code: 'phone_verified',
        label: 'Phone verified',
        state: verifiedPrimaryPhone ? 'MET' : 'OUTSTANDING',
        ...(verifiedPrimaryPhone
          ? {}
          : { detail: 'A single verified primary phone number is required' }),
      },
      {
        code: 'identity_evidence',
        label: 'Identity verified by an approved provider',
        state:
          trustedEvidence.state === 'VERIFIED'
            ? 'MET'
            : trustedEvidence.state === 'UNAVAILABLE'
              ? 'UNAVAILABLE'
              : 'OUTSTANDING',
        ...(trustedEvidence.verifiedKinds.length
          ? { detail: `Verified: ${trustedEvidence.verifiedKinds.join(', ')}` }
          : trustedEvidence.detail
            ? { detail: trustedEvidence.detail }
            : {}),
      },
      {
        code: 'kyc_assessment',
        label: 'KYC assessment approved',
        state: assessmentIsCurrent ? 'MET' : 'OUTSTANDING',
        ...(assessmentIsCurrent
          ? {}
          : {
              detail: assessment
                ? `Current assessment is ${assessment.kyc_level}/${assessment.kyc_status}`
                : 'No KYC assessment has been recorded',
            }),
      },
      {
        code: 'identity_conflict',
        label: 'No identity ownership conflict',
        state: Number(conflicts[0]?.count ?? '0') === 0 ? 'MET' : 'BLOCKED',
        ...(Number(conflicts[0]?.count ?? '0') === 0
          ? {}
          : { detail: 'This identity is claimed by more than one customer' }),
      },
      {
        code: 'account_restriction',
        label: 'No active financial restriction',
        state: restrictions.length === 0 ? 'MET' : 'BLOCKED',
        ...(restrictions.length ? { detail: restrictions.map((r) => r.type).join(', ') } : {}),
      },
      {
        code: 'financial_policy',
        label: 'Financial eligibility policy in force',
        state: eligibility.eligible
          ? 'MET'
          : eligibility.message &&
              /not eligible for financial access|approved KYC assessment/i.test(eligibility.message)
            ? 'OUTSTANDING'
            : 'UNAVAILABLE',
        ...(eligibility.eligible ? {} : { detail: eligibility.message ?? 'Unavailable' }),
      },
      {
        code: 'commercial_configuration',
        label: 'Effective fees and limits configured for enabled products',
        state: commercialConfig.state,
        ...(commercialConfig.detail ? { detail: commercialConfig.detail } : {}),
      },
      {
        code: 'account_active',
        label: 'Account activated by MonieNaija',
        state: customer.status === 'ACTIVE' ? 'MET' : 'OUTSTANDING',
        ...(customer.status === 'ACTIVE' ? {} : { detail: `Account status is ${customer.status}` }),
      },
      {
        code: 'wallet',
        label: 'Wallet provisioned',
        state: wallet ? 'MET' : 'OUTSTANDING',
        ...(wallet ? { detail: `${wallet.currency} · ${wallet.status}` } : {}),
      },
    ];

    const outstanding = requirements
      .filter((requirement) => requirement.state !== 'MET')
      .map((requirement) => requirement.code);

    // Activation readiness (what the ADMIN must be able to prove before DRAFT -> ACTIVE) excludes
    // the two steps that follow activation itself: the lifecycle transition and wallet provisioning.
    const preActivationCodes = [
      'phone_verified',
      'identity_evidence',
      'kyc_assessment',
      'identity_conflict',
      'account_restriction',
      'financial_policy',
      ...(this.effectiveConfiguration ? ['commercial_configuration'] : []),
    ];
    const activatable = preActivationCodes.every(
      (code) => requirements.find((requirement) => requirement.code === code)?.state === 'MET',
    );

    return {
      customerId: customer.id,
      referenceMasked: maskCustomerReference(customer.reference),
      customerType: customer.customer_type,
      customerStatus: customer.status,
      isSynthetic: customer.is_synthetic,
      kyc: {
        level: customer.kyc_level,
        status: customer.kyc_status,
        assessment: assessment
          ? {
              level: assessment.kyc_level,
              status: assessment.kyc_status,
              expiresAt: assessment.expires_at ? assessment.expires_at.toISOString() : null,
              reason: assessment.reason,
            }
          : null,
      },
      customerClass,
      phone: { verifiedPrimaryPhone, phoneCount: phones.length },
      restrictions: { active: restrictions.map((entry) => entry.type) },
      identityConflicts: Number(conflicts[0]?.count ?? '0'),
      trustedEvidence,
      financialEligibility: eligibility,
      wallet: wallet
        ? {
            provisioned: true,
            walletId: wallet.id,
            currency: wallet.currency,
            status: wallet.status,
            balanceMinor: null,
          }
        : {
            provisioned: false,
            walletId: null,
            currency: null,
            status: null,
            balanceMinor: null,
          },
      onboardingWorkflow: {
        status: onboardings[0]?.status ?? null,
        eligibility: eligibilities[0]?.status ?? null,
        completed: onboardings[0]?.status === 'COMPLETED',
      },
      commercialConfiguration: {
        complete: commercialConfig.complete,
        issues: commercialConfig.issues,
      },
      requirements,
      outstanding,
      activatable,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
