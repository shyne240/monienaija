import type {
  RewardBeneficiaryType,
  RewardCalculationBasis,
  RewardCalculationModel,
  RewardCustomerKycLevel,
  RewardGrantType,
} from './reward-rule.entity';

/**
 * V1-REWARD-01 — Reward Engine decision types.
 *
 * A RewardDecision-shape is a REPRESENTATION ONLY: the engine never credits, posts
 * journals, mutates balances, or writes snapshots. It exists so that a later,
 * explicitly-approved integration task can wire resolved reward decisions into the
 * existing Commercial Decision Snapshot (whose reward field already supports
 * beneficiaryType/beneficiaryId/rewardType/amountMinor/currency/basis/ruleId/ruleVersion
 * grants — snapshot schema untouched here).
 *
 * Commercial concept separation (hard boundary): a reward is NOT principal, NOT a
 * customer fee, NOT platform revenue, NOT agent/aggregator commission, NOT a negative
 * fee or fee discount. The engine never defines or assumes any relationship between
 * those values; each is decided/configured separately, and reward calculation never
 * depends on commission (a future policy may select FEE as a calculation BASE, which
 * is still fee-evidence, never commission).
 */

export type RewardDecisionOutcome =
  /** At least one beneficiary group resolved and all resolved groups calculated cleanly (amounts may be zero — ZERO is an explicit calculated outcome, never NOT_CONFIGURED). */
  | 'GRANTED'
  /** No applicable active rule exists for ANY beneficiary type — the honest empty outcome (≠ ZERO). */
  | 'NOT_CONFIGURED'
  /** At least one beneficiary type had ≥2 equally-applicable rules sharing the top priority — fail-closed, no amounts produced. */
  | 'AMBIGUOUS'
  /** A resolved rule's calculation_basis amount was not supplied by the caller (e.g. FEE basis with no fee amount available). */
  | 'BASE_UNAVAILABLE';

/** Base amounts the caller supplies; the rule's calculation_basis picks one. */
export interface RewardBaseAmounts {
  principalMinor: string;
  feeMinor?: string | null;
  netMinor?: string | null;
}

/** Request context: transaction/participant eligibility identity (all targeting dimensions nullable). */
export interface RewardResolveInput {
  productCode: string;
  currency?: string;
  customerId?: string | null;
  /** The customer's CURRENT authoritative kycLevel (customers.kyc_level) when known. */
  customerKycLevel?: RewardCustomerKycLevel | null;
  agentId?: string | null;
  agentClassId?: string | null;
  /** Promotion identity carried by the transaction, when one exists (config-only). */
  campaignCode?: string | null;
  /** Evaluation timestamp; defaults to now. Past/future timestamps are first-class (historical resolution). */
  at?: Date | string;
}

export interface RewardDecideInput extends RewardResolveInput {
  bases: RewardBaseAmounts;
}

/** One tier of a resolved TIERED rule, surfaced as decision evidence. */
export interface RewardTierSnapshot {
  tierIndex: number;
  fromMinor: string;
  toMinor: string | null;
  flatRewardMinor: string | null;
  percentageBps: number | null;
}

/** The exact rule row (id + version + parameters + window) selected for a beneficiary group. */
export interface ResolvedRewardRule {
  ruleId: string;
  ruleVersion: number;
  beneficiaryType: RewardBeneficiaryType;
  rewardType: RewardGrantType;
  calculationBasis: RewardCalculationBasis;
  calculationModel: RewardCalculationModel;
  flatRewardMinor: string | null;
  percentageBps: number | null;
  minimumRewardMinor: string | null;
  maximumRewardMinor: string | null;
  customerId: string | null;
  customerKycLevel: RewardCustomerKycLevel | null;
  agentClassId: string | null;
  agentId: string | null;
  campaignCode: string | null;
  priority: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** Present only for calculationModel === 'TIERED'. */
  tiers?: RewardTierSnapshot[];
}

/** The eligible-rule outcome for one beneficiary type inside a resolution. */
export interface RewardBeneficiaryResolution {
  beneficiaryType: RewardBeneficiaryType;
  status: 'RESOLVED' | 'NOT_CONFIGURED' | 'AMBIGUOUS';
  rule?: ResolvedRewardRule;
  ambiguousRuleIds?: string[];
  ambiguousPriority?: number;
}

export interface RewardResolution {
  status: 'GRANTED' | 'NOT_CONFIGURED';
  productCode: string;
  currency: string;
  evaluatedAt: Date;
  grants: RewardGrantDecision[];
  /** One entry per winning rule (same rows as grants). */
  ruleRefs: Array<{ ruleId: string; ruleVersion: number; ruleType: 'REWARD' }>;
}

/** One calculated reward grant (representation only — no posting). */
export interface RewardGrantDecision {
  beneficiaryType: RewardBeneficiaryType;
  /** Targeted customer/agent from the rule when beneficiary-specific; NULL for untargeted rules (the future flow wiring supplies the transacting principal). */
  beneficiaryId: string | null;
  rewardType: RewardGrantType;
  amountMinor: string;
  currency: string;
  basis: string;
  baseAmountMinor: string;
  calculationModel: RewardCalculationModel;
  appliedParameters: Record<string, unknown>;
  ruleId: string;
  ruleVersion: number;
  priority: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** Promotion identity pinned by the rule, when campaign-targeted. */
  campaignCode: string | null;
  /** Eligibility evidence: which targeting dimensions this rule pinned (absent = untargeted). */
  targeting: {
    customerId: string | null;
    customerKycLevel: RewardCustomerKycLevel | null;
    agentClassId: string | null;
    agentId: string | null;
    campaignCode: string | null;
  };
}
