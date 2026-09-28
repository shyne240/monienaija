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
