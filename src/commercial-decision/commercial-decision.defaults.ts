import type {
  CommissionDecisionSnapshot,
  FeeDecisionSnapshot,
  LimitDecisionSnapshot,
  RewardDecisionSnapshot,
} from './commercial-decision-snapshot.entity';

/**
 * V1-COMMERCIAL-DECISION-01 — first-class "nothing configured" decision shapes.
 *
 * V1 runs a fee-free pilot: NO fee/commission/reward policy is configured and no commercial
 * values are invented. These factories produce the honest, fully-validated representations for
 * that reality, so snapshot recording never has to fabricate percentages, rates or tiers:
 *
 *  - FEE        → NOT_CONFIGURED, feeMinor 0 (mirrors the hardcoded feeMinor="0" in the flows)
 *  - COMMISSION → NONE, no allocations (commission machinery exists (V1-COMMISSION-01) but
 *                 ZERO rules are configured and no flow calls it)
 *  - REWARD     → NONE, no grants (reward machinery exists (V1-REWARD-01) but ZERO rules
 *                 are configured and no flow calls it)
 *  - LIMIT      → use limitApproved()/limitRejected()/limitNotEvaluated() to capture the
 *                 authoritative limit decision evidence without duplicating limit_usage.
 */

export function feeNotConfigured(currency: string, amountMinor: string): FeeDecisionSnapshot {
  return {
    status: 'NOT_CONFIGURED',
    currency,
    amountMinor,
    feeMinor: '0',
    vatMinor: '0',
    totalMinor: amountMinor,
    ruleRefs: [],
  };
}

export function commissionNone(): CommissionDecisionSnapshot {
  return { status: 'NONE', allocations: [], ruleRefs: [] };
}

/**
 * V1-COMMISSION-01 — pure builder for the ALLOCATED commission decision shape the
 * (future) wired flows will capture. Mirrors commissionNone()'s shape exactly; the
 * provided allocations must be non-empty (ALLOCATED without allocations is incoherent
 * and the snapshot service rejects it). This builder is mechanics only — deciding
 * whether/how allocations apply to a flow remains the future integration task.
 */
export function commissionAllocated(
  allocations: NonNullable<CommissionDecisionSnapshot['allocations']>,
  ruleRefs: NonNullable<CommissionDecisionSnapshot['ruleRefs']>,
): CommissionDecisionSnapshot {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new Error('commissionAllocated requires at least one allocation — use commissionNone() for empty');
  }
  return { status: 'ALLOCATED', allocations, ruleRefs: ruleRefs ?? [] };
}

/**
 * V1-COMMERCIAL-IMPLEMENTATION-02 — fee-basis evidence for `CommissionEngine.decideWithManager`.
 * The FEE calculation basis consumes the transaction's AUTHORITATIVE FEE DECISION amount — never
 * the principal. Returns `'0'` when the fee decision is NOT_CONFIGURED or has no concrete amount
 * (explicit zero commission must still resolve and be recorded as ZERO-amount ALLOCATED when a
 * configured commission rule applies — zero fee ⇒ zero commission, never "unavailable"), and
 * returns `null` ONLY when the fee decision is AMBIGUOUS, in which case the engine must fail closed
 * (COMMISSION_BASE_UNAVAILABLE) rather than compute on a guessed base.
 */
export function commissionFeeBasisMinor(feeDecision: Record<string, unknown>): string | null {
  const status = typeof feeDecision.status === 'string' ? feeDecision.status : null;
  if (status === 'AMBIGUOUS' || (feeDecision as { resolutionStatus?: unknown }).resolutionStatus === 'AMBIGUOUS') {
    return null;
  }
  const feeMinor = (feeDecision as { feeMinor?: unknown }).feeMinor;
  return typeof feeMinor === 'string' ? feeMinor : '0';
}

/**
 * V1-COMMERCIAL-IMPLEMENTATION-02 — truthful fee-collection state annotation for an ALLOCATED
 * commission decision. The fee BASIS amount is CALCULATED, but no fee revenue account family is
 * provisioned in V1 (FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED), so the fee itself was never
 * collected onto the ledger. The recorded commission is therefore an evidence decision only; the
 * annotation states exactly why the fee base is "calculated-but-not-collected" — the unposted fee
 * is never silently called "collected".
 */
export function commissionFeeCollectionStateOf(feeDecision: Record<string, unknown>): string {
  const status = typeof feeDecision.status === 'string' ? feeDecision.status : 'NOT_CONFIGURED';
  if (status === 'NOT_CONFIGURED') return 'FEE_NOT_CONFIGURED';
  if (status === 'ZERO') return 'FEE_ZERO';
  return 'FEE_CALCULATED_NOT_COLLECTED';
}

/**
 * V1-COMMERCIAL-IMPLEMENTATION-02 — wraps an engine-produced ALLOCATED commission decision with the
 * accounting-boundary annotations required because no COMMISSION accounting family (no
 * COMMISSION-PAYABLE / COMMISSION-EXPENSE ledger accounts) is provisioned in V1:
 *  - `payable: false` and explicit blockers — the decision is EVIDENCE, not a liability; nothing is
 *    owed or owed-to-be-settled by the platform, and no journal legs are posted;
 *  - `posting.journalLegsPosted: false` with the machine-readable blocker
 *    `COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED` — no journal mutation ever happens here;
 *  - `feeCollectionState` — whether the fee basis amount was actually collected (never, in V1);
 *  - `commissionEvent` — the lifecycle event the decision is attached to ('TRANSACTION_COMPLETION',
 *    or 'CASH_TO_CASH_INITIATION' for the single C2C commission event at initiation).
 * Pure shape annotation over the open JSONB decision; the engine mechanics/beneficiaries change not at all.
 */
export function commissionAllocatedAtAccountingBoundary(
  decision: CommissionDecisionSnapshot,
  evidence: { feeCollectionState: string; commissionEvent: 'TRANSACTION_COMPLETION' | 'CASH_TO_CASH_INITIATION' },
): CommissionDecisionSnapshot {
  if (decision.status !== 'ALLOCATED') return decision;
  return {
    ...decision,
    payable: false,
    payableBlockers: [
      'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED',
      'COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED',
    ],
    feeCollectionState: evidence.feeCollectionState,
    commissionEvent: evidence.commissionEvent,
    posting: {
      journalLegsPosted: false,
      reason: 'COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED',
    },
  };
}

export function rewardNone(): RewardDecisionSnapshot {
  return { status: 'NONE', grants: [], ruleRefs: [] };
}

/**
 * V1-REWARD-01 — pure builder for the GRANTED reward decision shape the (future) wired
 * flows will capture. Mirrors rewardNone()'s shape exactly; the provided grants must be
 * non-empty (GRANTED without grants is incoherent and the snapshot service rejects it).
 * This builder is mechanics only — deciding whether/how grants apply to a flow remains
 * the future integration task.
 */
export function rewardGranted(
  grants: NonNullable<RewardDecisionSnapshot['grants']>,
  ruleRefs: NonNullable<RewardDecisionSnapshot['ruleRefs']>,
): RewardDecisionSnapshot {
  if (!Array.isArray(grants) || grants.length === 0) {
    throw new Error('rewardGranted requires at least one grant — use rewardNone() for empty');
  }
  return { status: 'GRANTED', grants, ruleRefs: ruleRefs ?? [] };
}

export function limitNotEvaluated(): LimitDecisionSnapshot {
  return { status: 'NOT_EVALUATED', ruleRefs: [], reservationIds: [], usageIds: [] };
}

export function limitApproved(evidence: {
  profileCode?: string | null;
  assignmentId?: string | null;
  ruleRefs?: LimitDecisionSnapshot['ruleRefs'];
  reservationIds?: string[];
  usageIds?: string[];
}): LimitDecisionSnapshot {
  return {
    status: 'APPROVED',
    profileCode: evidence.profileCode ?? null,
    assignmentId: evidence.assignmentId ?? null,
    ruleRefs: evidence.ruleRefs ?? [],
    reservationIds: evidence.reservationIds ?? [],
    usageIds: evidence.usageIds ?? [],
  };
}

export function limitRejected(evidence: {
  failureCode: string;
  profileCode?: string | null;
  assignmentId?: string | null;
  ruleRefs?: LimitDecisionSnapshot['ruleRefs'];
}): LimitDecisionSnapshot {
  return {
    status: 'REJECTED',
    failureCode: evidence.failureCode,
    profileCode: evidence.profileCode ?? null,
    assignmentId: evidence.assignmentId ?? null,
    ruleRefs: evidence.ruleRefs ?? [],
    reservationIds: [],
    usageIds: [],
  };
}
