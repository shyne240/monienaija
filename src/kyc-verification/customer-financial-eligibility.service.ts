import { ConflictException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { decideTier } from './kyc-tier-decision';
import { KycTierEvidenceReader } from './kyc-tier-evidence.reader';
import { KycTierPolicyService } from './kyc-tier-policy.service';
import { KycFoundationError } from './kyc.types';

export interface FinancialEligibilityOptions {
  readonly requireActive?: boolean;
  readonly lockMode?: 'UPDATE' | 'SHARE';
}

/** Transactional gate for an identified customer. The trusted reader is intentionally
 * unavailable in production until provider provenance has been reviewed. */
@Injectable()
export class CustomerFinancialEligibilityService {
  constructor(
    private readonly policies: KycTierPolicyService,
    private readonly reader: KycTierEvidenceReader,
  ) {}

  async require(
    manager: EntityManager,
    customerId: string,
    requireActiveOrOptions: boolean | FinancialEligibilityOptions = true,
    options?: FinancialEligibilityOptions,
  ): Promise<void> {
    const resolvedOptions: FinancialEligibilityOptions =
      typeof requireActiveOrOptions === 'boolean'
        ? { ...options, requireActive: requireActiveOrOptions }
        : { ...requireActiveOrOptions, ...options };
    const requireActive = resolvedOptions.requireActive ?? true;
    const rowLock = resolvedOptions.lockMode === 'SHARE' ? 'FOR SHARE' : 'FOR UPDATE';
    const customers = await manager.query<
      Array<{
        status: string;
        kyc_status: string;
        kyc_level: string;
        is_synthetic: boolean;
        deleted_at: Date | null;
      }>
    >(
      `SELECT status,kyc_status,kyc_level,is_synthetic,deleted_at FROM customers WHERE id=$1 ${rowLock}`,
      [customerId],
    );
    const customer = customers[0];
    if (
      !customer ||
      customer.deleted_at ||
      customer.is_synthetic ||
      (requireActive && customer.status !== 'ACTIVE') ||
      (!requireActive && !['DRAFT', 'ACTIVE', 'SUSPENDED'].includes(customer.status)) ||
      customer.kyc_status !== 'APPROVED' ||
      !['LEVEL_1', 'LEVEL_2'].includes(customer.kyc_level)
    )
      throw new ConflictException('Customer is not eligible for financial access');
    const now = (await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now'))[0]!
      .now;
    let policy;
    try {
      policy = await this.policies.effective(manager, now);
    } catch (error) {
      // A missing or invalid governed policy denies financial scope; it must not
      // turn a verified onboarding sign-in into an unhandled server error.
      if (error instanceof KycFoundationError && ['DISABLED', 'INVALID'].includes(error.code))
        throw new ConflictException('Customer financial policy is unavailable');
      throw error;
    }
    const holds = await manager.query<Array<{ customer_id: string }>>(
      `SELECT customer_id FROM kyc_tier_manual_holds WHERE customer_id=$1 ${rowLock}`,
      [customerId],
    );
    if (holds.length) throw new ConflictException('Customer is not eligible for financial access');
    const conflicts = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM kyc_identity_conflicts WHERE requester_customer_id=$1 OR claimed_customer_id=$1 FOR SHARE`,
      [customerId],
    );
    if (conflicts.length)
      throw new ConflictException('Customer is not eligible for financial access');
    const phones = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND is_primary=true AND verified_at IS NOT NULL AND deleted_at IS NULL FOR SHARE`,
      [customerId],
    );
    if (phones.length !== 1)
      throw new ConflictException('Customer is not eligible for financial access');
    const source = await this.reader.read(manager, customerId);
    if (!source) throw new ConflictException('Trusted KYC evidence is unavailable');
    const decision = decideTier({
      customerId,
      identityRevision: source.identityRevision,
      now,
      policy,
      evidence: source.evidence,
    });
    const rank = { NONE: 0, LEVEL_1: 1, LEVEL_2: 2 } as const;
    const approvedLevel = customer.kyc_level as 'LEVEL_1' | 'LEVEL_2';
    if (
      decision.status !== 'ELIGIBLE' ||
      !decision.highestTier ||
      rank[decision.highestTier] < rank[approvedLevel]
    )
      throw new ConflictException('Customer is not eligible for financial access');
    const assessments = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM customer_kyc_assessments WHERE customer_id=$1 AND is_current=true AND kyc_status='APPROVED' AND kyc_level=$2 AND expires_at>$3 ${rowLock}`,
      [customerId, approvedLevel, now],
    );
    if (assessments.length !== 1)
      throw new ConflictException('Customer is not eligible for financial access');
  }
}
