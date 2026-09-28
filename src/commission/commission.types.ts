import type {
  CommissionCalculationBasis,
  CommissionCalculationModel,
  CommissionRecipientType,
} from './commission-rule.entity';

/**
 * V1-COMMISSION-01 — Commission Engine decision types.
 *
 * A CommissionCalculationDecision is a REPRESENTATION ONLY: the engine never charges,
 * posts journals, mutates balances, or writes snapshots. It exists so that a later,
 * explicitly-approved integration task can wire resolved commission decisions into the
 * existing Commercial Decision Snapshot (whose commission field already supports
 * beneficiaryType/beneficiaryId/amountMinor/currency/basis/ruleId/ruleVersion allocations
 * — snapshot schema untouched here).
 *
 * Commercial concept separation (hard boundary): commission is NOT a customer fee, NOT
 * platform revenue, NOT a reward/cashback, NOT principal. The engine never defines or
 * assumes any relationship between those values; each is decided/configured separately.
 */

export type CommissionDecisionStatus =
  /** At least one recipient group resolved and all resolved groups calculated cleanly (amounts may be zero — ZERO is an explicit calculated outcome, never NOT_CONFIGURED). */
  | 'CALCULATED'
  /** No applicable active rule exists for ANY recipient type — the honest empty outcome (≠ ZERO). */
  | 'NOT_CONFIGURED'
  /** At least one recipient type had ≥2 equally-applicable rules sharing the top priority — fail-closed, no amounts produced for that recipient. */
  | 'AMBIGUOUS'
  /** A resolved rule's calculation_basis amount was not supplied by the caller (e.g. FEE basis with no fee amount available). */
  | 'BASE_UNAVAILABLE';

/** Base amounts the caller supplies; the rule's calculation_basis picks one. */
export interface CommissionBaseAmounts {
  principalMinor: string;
  feeMinor?: string | null;
  netMinor?: string | null;
}

/** Request context: eligible transaction/participant identity (all targeting dimensions nullable). */
export interface CommissionResolveInput {
  productCode: string;
  currency?: string;
  agentId?: string | null;
  agentClassId?: string | null;
  aggregatorId?: string | null;
  /** Evaluation timestamp; defaults to now. Past/future timestamps are first-class (historical resolution). */
  at?: Date | string;
}

export interface CommissionDecideInput extends CommissionResolveInput {
  bases: CommissionBaseAmounts;
}

/** One tier of a resolved TIERED rule, surfaced as decision evidence. */
export interface CommissionTierSnapshot {
  tierIndex: number;
  fromMinor: string;
  toMinor: string | null;
  flatCommissionMinor: string | null;
  percentageBps: number | null;
}

/** The exact rule row (id + version + parameters + window) selected for a recipient. */
export interface ResolvedCommissionRule {
  ruleId: string;
  ruleVersion: number;
  recipientType: CommissionRecipientType;
  calculationBasis: CommissionCalculationBasis;
  calculationModel: CommissionCalculationModel;
  flatCommissionMinor: string | null;
  percentageBps: number | null;
  minimumCommissionMinor: string | null;
  maximumCommissionMinor: string | null;
  agentId: string | null;
  agentClassId: string | null;
  aggregatorId: string | null;
  priority: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** Present only for calculationModel === 'TIERED'. */
  tiers?: CommissionTierSnapshot[];
}

/** The eligible-rule outcome for one recipient type inside a resolution. */
export interface CommissionRecipientResolution {
  recipientType: CommissionRecipientType;
  status: 'RESOLVED' | 'NOT_CONFIGURED' | 'AMBIGUOUS';
  rule?: ResolvedCommissionRule;
  ambiguousRuleIds?: string[];
  ambiguousPriority?: number;
}

export interface CommissionResolution {
  status: 'RESOLVED' | 'NOT_CONFIGURED' | 'AMBIGUOUS';
  productCode: string;
  currency: string;
  evaluatedAt: Date;
  recipients: CommissionRecipientResolution[];
}

/** One calculated commission allocation (representation only — no posting). */
export interface CommissionAllocationDecision {
  recipientType: CommissionRecipientType;
  /** Targeted agent/aggregator from the rule when recipient-specific; NULL for class-wide/product-wide rules. */
  recipientId: string | null;
  amountMinor: string;
  currency: string;
  basis: CommissionCalculationBasis;
  baseAmountMinor: string;
  calculationModel: CommissionCalculationModel;
  ruleId: string;
  ruleVersion: number;
  /** Eligibility evidence: which targeting dimensions this rule pinned (absent = untargeted). */
  eligibility: {
    agentTargeted: boolean;
    agentClassTargeted: boolean;
    aggregatorTargeted: boolean;
    priority: number;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  };
}

export interface CommissionCalculationDecision {
  status: CommissionDecisionStatus;
  productCode: string;
  currency: string;
  evaluatedAt: Date;
  allocations: CommissionAllocationDecision[];
  /** recipient types that could not produce an amount, with the reason. */
  unresolved: Array<{
    recipientType: CommissionRecipientType;
    reason: CommissionDecisionStatus;
    ambiguousRuleIds?: string[];
  }>;
}
