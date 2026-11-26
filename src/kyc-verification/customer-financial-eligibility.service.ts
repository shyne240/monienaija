import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { isRetryableTransactionError } from '../common/serializable-transaction';
import { decideTier } from './kyc-tier-decision';
import { KycTierEvidenceReader } from './kyc-tier-evidence.reader';
import { KycTierPolicyService } from './kyc-tier-policy.service';

export interface FinancialEligibilityOptions {
  readonly requireActive?: boolean;
  /**
   * Row locking strength.
   *
   * `UPDATE` (default) — the admission lock every financial path takes.
   * `SHARE`              — a read lock for callers that must not be disturbed by a concurrent
   *                        restriction write (e.g. the commercial snapshot writers).
   * `NONE`               — NO row lock. Reserved for genuinely read-only callers (Arena 3's
   *                        effective-configuration preview), because PostgreSQL forbids
   *                        `SELECT … FOR SHARE/UPDATE` inside a `READ ONLY` transaction. Such a
   *                        caller must never make a financial decision from this result, and the
   *                        preview never does: it reports eligibility, it does not admit anything.
   */
  readonly lockMode?: 'UPDATE' | 'SHARE' | 'NONE';
}

export const FROZEN_CUSTOMER_MESSAGE =
  'Customer account is frozen — financial operations are blocked';
export const BLACKLISTED_CUSTOMER_MESSAGE =
  'Customer account is restricted — financial operations are blocked';

/** Transactional gate for an identified customer. The trusted reader is intentionally
 * unavailable in production until provider provenance has been reviewed.
 *
 * ARENA 5 §6 — administrative restriction admission.
 *
 * `LIMITED` and `MANUAL_REVIEW` are deliberately NOT admission blockers here: they map to the
 * `RESTRICTED` operating status and are governed by tier/purpose/limit policy, not by a hard
 * freeze. Only `FROZEN` and `BLACKLISTED` stop money movement, exactly as
 * `CustomerEligibilityService.operatingStatus()` already publishes.
 *
 * Concurrency contract (see docs/integration/ARENA5-FROZEN-RESTRICTION-ADMISSION-20261120.md):
 * the restriction read below happens inside the caller's existing transaction and AFTER this
 * method has taken the `customers` row lock (`FOR UPDATE` by default, `FOR SHARE` for read-only
 * callers). A restriction row that does not exist yet cannot be locked, so absence of a row is
 * not by itself a serialization point: `CustomerEligibilityService.createRestriction()` takes the
 * SAME `customers` row lock (a real `UPDATE customers SET updated_at = NOW()`) before it inserts.
 * The two writers therefore serialize against the one row that always exists:
 *  - freeze commits first  → this read sees it (READ COMMITTED), or the lock acquisition aborts
 *    with 40001 and the caller's existing bounded retry re-reads it (SERIALIZABLE/REPEATABLE READ);
 *  - admission locks first → the freeze waits for this transaction to finish and is effective
 *    only afterwards, so the transfer is serialized BEFORE the restriction, never after it.
 */
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
  ): Promise<'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3'> {
    const resolvedOptions: FinancialEligibilityOptions =
      typeof requireActiveOrOptions === 'boolean'
        ? { ...options, requireActive: requireActiveOrOptions }
        : { ...requireActiveOrOptions, ...options };
    const requireActive = resolvedOptions.requireActive ?? true;
    const rowLock =
      resolvedOptions.lockMode === 'NONE'
        ? ''
        : resolvedOptions.lockMode === 'SHARE'
          ? 'FOR SHARE'
          : 'FOR UPDATE';
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
      !['LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(customer.kyc_level)
    )
      throw new ConflictException('Customer is not eligible for financial access');
    // ARENA 5 §6: active administrative restriction admission, evaluated inside this transaction
    // after the customer row lock and before any policy/evidence I/O. Read-only: it never
    // creates, mutates or shadows restriction state, and it keeps the caller's lock strength.
    const restrictions = await manager.query<Array<{ type: string }>>(
      `SELECT type FROM customer_restrictions
       WHERE customer_id=$1 AND type IN ('BLACKLISTED','FROZEN','CONFIGURATION_REVIEW') AND is_active=true AND deleted_at IS NULL
       ORDER BY type ${rowLock}`,
      [customerId],
    );
    if (restrictions.some((restriction) => restriction.type === 'BLACKLISTED'))
      throw new ConflictException(BLACKLISTED_CUSTOMER_MESSAGE);
    if (restrictions.some((restriction) => restriction.type === 'FROZEN'))
      throw new ConflictException(FROZEN_CUSTOMER_MESSAGE);
    if (restrictions.some((restriction) => restriction.type === 'CONFIGURATION_REVIEW'))
      throw new ConflictException(
        'Customer commercial configuration requires review before financial access',
      );
    const now = (await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now'))[0]!
      .now;
    let policy;
    try {
      policy = await this.policies.effective(manager, now);
    } catch (error) {
      // A database-aborted transaction has made no decision about the policy. Preserve
      // the driver signal for the transaction owner's existing bounded retry, never retry here.
      if (isRetryableTransactionError(error)) throw error;
      throw new ServiceUnavailableException('Customer financial policy is unavailable');
    }
    if (!policy) throw new ServiceUnavailableException('Customer financial policy is unavailable');
    const holds = await manager.query<Array<{ customer_id: string }>>(
      `SELECT customer_id FROM kyc_tier_manual_holds WHERE customer_id=$1 ${rowLock}`,
      [customerId],
    );
    if (holds.length) throw new ConflictException('Customer is not eligible for financial access');
    const conflicts = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM kyc_identity_conflicts WHERE requester_customer_id=$1 OR claimed_customer_id=$1 ${rowLock}`,
      [customerId],
    );
    if (conflicts.length)
      throw new ConflictException('Customer is not eligible for financial access');
    const phones = await manager.query<Array<{ id: string }>>(
      `SELECT id FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND is_primary=true AND verified_at IS NOT NULL AND deleted_at IS NULL ${rowLock}`,
      [customerId],
    );
    if (phones.length !== 1)
      throw new ConflictException('Customer is not eligible for financial access');
    let source;
    try {
      // The trusted reader takes the same lock strength as this gate. Under the default
      // UPDATE/SHARE strengths that is unchanged; a genuinely read-only caller (lockMode NONE)
      // must not attempt `FOR SHARE` inside its READ ONLY transaction.
      source = await this.reader.read(manager, customerId, {
        ...(resolvedOptions.lockMode === 'NONE' ? { lockMode: 'NONE' as const } : {}),
      });
    } catch (error) {
      if (isRetryableTransactionError(error)) throw error;
      throw new ServiceUnavailableException('Trusted KYC evidence is unavailable');
    }
    if (!source) throw new ServiceUnavailableException('Trusted KYC evidence is unavailable');
    const decision = decideTier({
      customerId,
      identityRevision: source.identityRevision,
      now,
      policy,
      evidence: source.evidence,
    });
    const rank = { NONE: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3 } as const;
    const approvedLevel = customer.kyc_level as 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
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
    return approvedLevel;
  }
}
