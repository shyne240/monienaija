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
 *  - COMMISSION → NONE, no allocations (no commission engine exists in the codebase)
 *  - REWARD     → NONE, no grants (no reward/cashback engine exists in the codebase)
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

export function rewardNone(): RewardDecisionSnapshot {
  return { status: 'NONE', grants: [], ruleRefs: [] };
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
