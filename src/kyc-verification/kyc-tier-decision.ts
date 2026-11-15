/**
 * Pure, non-authoritative eligibility computation. Do not expose this function to
 * clients or use its result to mutate customers: the caller must obtain a governed
 * policy and trustworthy, identity-bound evidence from authoritative stores.
 */
export const TIER_EVIDENCE_TYPES = [
  'BVN',
  'NIN',
  'PHONE',
  'BIOMETRIC',
  'ADDRESS',
  'ADDRESS_VERIFICATION',
  'UTILITY_BILL',
  'GPS',
  'IDENTITY_DOCUMENT',
  'DATE_OF_BIRTH',
  'OCCUPATION',
  'SOURCE_OF_FUNDS',
  'SOURCE_OF_WEALTH',
  'BUSINESS_PURPOSE',
  'PEP_SCREENING',
  'SANCTIONS_SCREENING',
  'CUSTOMER_RISK_ASSESSMENT',
  'ENHANCED_DUE_DILIGENCE',
] as const;
export type TierEvidenceType = (typeof TIER_EVIDENCE_TYPES)[number];
export type TierLevel = 'NONE' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
export type AssessedTierLevel = Exclude<TierLevel, 'NONE'>;
export type TierEvidenceStatus = 'VERIFIED' | 'REJECTED' | 'REVIEW' | 'REVOKED';
export type TierEvidenceProvenance = 'VERIFIED_PROVIDER' | 'AUTHORIZED_REVIEW' | 'SYNTHETIC';
export interface TierEvidence {
  id: string;
  customerId: string;
  identityRevision: string;
  type: TierEvidenceType;
  status: TierEvidenceStatus;
  provenance: TierEvidenceProvenance;
  verifiedAt: Date | null;
  expiresAt: Date | null;
}
export interface TierRequirements {
  all: TierEvidenceType[];
  any: TierEvidenceType[][];
}
export interface TierDecisionPolicy {
  version: string;
  approved: boolean;
  /** Explicit sign-off that the applicable regulatory requirements were reviewed. */
  regulatoryRequirementsConfirmed: boolean;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  /** Additional confirmed regulatory requirements, separate from the fixed mission floor. */
  regulatory: Record<AssessedTierLevel, TierRequirements>;
  /** Operator requirements can add constraints, never remove either regulatory layer. */
  operator: Record<AssessedTierLevel, TierRequirements>;
}
export interface TierDecision {
  status: 'NOT_CONFIGURED' | 'PENDING' | 'REVIEW' | 'ELIGIBLE';
  highestTier: TierLevel | null;
  reason: string;
  policyVersion: string | null;
  supportingEvidenceIds: string[];
}
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (d: unknown): d is Date => d instanceof Date && Number.isFinite(d.getTime());
const validType = (v: unknown): v is TierEvidenceType =>
  typeof v === 'string' && (TIER_EVIDENCE_TYPES as readonly string[]).includes(v);
function validRequirements(r: unknown): r is TierRequirements {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  return (
    Object.keys(x).sort().join(',') === 'all,any' &&
    Array.isArray(x.all) &&
    Array.isArray(x.any) &&
    x.all.length <= TIER_EVIDENCE_TYPES.length &&
    x.all.every(validType) &&
    new Set(x.all).size === x.all.length &&
    x.any.length <= TIER_EVIDENCE_TYPES.length &&
    x.any.every(
      (g: unknown) =>
        Array.isArray(g) &&
        g.length > 0 &&
        g.length <= TIER_EVIDENCE_TYPES.length &&
        g.every(validType) &&
        new Set(g).size === g.length,
    )
  );
}
function validPolicy(p: TierDecisionPolicy | null, now: Date): p is TierDecisionPolicy {
  if (
    !validDate(now) ||
    !p ||
    p.approved !== true ||
    p.regulatoryRequirementsConfirmed !== true ||
    typeof p.version !== 'string' ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(p.version) ||
    !validDate(p.effectiveFrom) ||
    p.effectiveFrom > now ||
    (p.effectiveUntil !== null &&
      (!validDate(p.effectiveUntil) ||
        p.effectiveUntil <= now ||
        p.effectiveUntil <= p.effectiveFrom)) ||
    !p.regulatory ||
    !p.operator
  )
    return false;
  const tiers: AssessedTierLevel[] = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'];
  if (
    !tiers.every(
      (tier) => validRequirements(p.regulatory[tier]) && validRequirements(p.operator[tier]),
    )
  )
    return false;
  return true;
}
const isTier3AdditionalType = (type: TierEvidenceType): boolean => type !== 'BVN' && type !== 'NIN';

/**
 * A Tier 3 rule must require at least one non-BVN/NIN item on every satisfying path. An any-of
 * group that mixes BVN/NIN with an extra code is not enough: that group could be satisfied by the
 * identity floor alone. Legacy two-tier policies normalize to empty Level 3 rules and therefore
 * leave Level 3 unavailable until a separately approved extra requirement is published.
 */
export function tier3HasAdditionalRequirement(
  p: Pick<TierDecisionPolicy, 'regulatory' | 'operator'>,
): boolean {
  return [p.regulatory.LEVEL_3, p.operator.LEVEL_3].some(
    (requirements) =>
      requirements.all.some(isTier3AdditionalType) ||
      requirements.any.some((group) => group.every(isTier3AdditionalType)),
  );
}

function tier3AdditionalEvidenceType(
  p: TierDecisionPolicy,
  have: (type: TierEvidenceType) => boolean,
): TierEvidenceType | null {
  for (const requirements of [p.regulatory.LEVEL_3, p.operator.LEVEL_3]) {
    const required = requirements.all.find((type) => isTier3AdditionalType(type) && have(type));
    if (required) return required;
    for (const group of requirements.any) {
      if (group.every(isTier3AdditionalType)) {
        const available = group.find(have);
        if (available) return available;
      }
    }
  }
  return null;
}
/**
 * This computes a candidate only. Positive output does not establish provenance,
 * policy approval, consent or regulatory sufficiency; those must be verified by a
 * transactional adapter. Tier 3 requires both identity numbers plus an explicit extra
 * all-of/any-of requirement in the approved policy.
 */
export function decideTier(input: {
  customerId: string;
  identityRevision: string;
  now: Date;
  policy: TierDecisionPolicy | null;
  evidence: TierEvidence[];
}): TierDecision {
  const result = (
    status: TierDecision['status'],
    highestTier: TierLevel | null,
    reason: string,
    ids: string[] = [],
  ): TierDecision => ({
    status,
    highestTier,
    reason,
    policyVersion: validPolicy(input.policy, input.now) ? input.policy.version : null,
    supportingEvidenceIds: ids,
  });
  if (!validDate(input.now) || !validPolicy(input.policy, input.now))
    return result('NOT_CONFIGURED', null, 'POLICY_NOT_EFFECTIVE_OR_APPROVED');
  if (
    !idPattern.test(input.customerId) ||
    typeof input.identityRevision !== 'string' ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(input.identityRevision) ||
    !Array.isArray(input.evidence)
  )
    return result('REVIEW', null, 'INVALID_INPUT');
  const ids = new Set<string>();
  for (const e of input.evidence) {
    if (
      !e ||
      !idPattern.test(e.id) ||
      ids.has(e.id) ||
      !idPattern.test(e.customerId) ||
      typeof e.identityRevision !== 'string' ||
      !validType(e.type) ||
      !['VERIFIED', 'REJECTED', 'REVIEW', 'REVOKED'].includes(e.status) ||
      !['VERIFIED_PROVIDER', 'AUTHORIZED_REVIEW', 'SYNTHETIC'].includes(e.provenance) ||
      (e.verifiedAt !== null && !validDate(e.verifiedAt)) ||
      (e.expiresAt !== null && !validDate(e.expiresAt))
    )
      return result('REVIEW', null, 'INVALID_EVIDENCE');
    ids.add(e.id);
    if (e.customerId !== input.customerId || e.identityRevision !== input.identityRevision)
      return result('REVIEW', null, 'IDENTITY_MISMATCH');
    if (
      e.status === 'VERIFIED' &&
      (!e.verifiedAt || !e.expiresAt || e.expiresAt <= e.verifiedAt || e.verifiedAt > input.now)
    )
      return result('REVIEW', null, 'INVALID_EVIDENCE_VALIDITY');
  }
  const usable = input.evidence.filter(
    (e) =>
      e.provenance !== 'SYNTHETIC' &&
      e.status === 'VERIFIED' &&
      e.expiresAt !== null &&
      e.expiresAt > input.now,
  );
  for (const e of input.evidence) {
    if (e.provenance === 'SYNTHETIC') continue;
    if (e.status === 'REVIEW') return result('REVIEW', null, 'EVIDENCE_REQUIRES_REVIEW');
    if (e.status === 'REJECTED' && usable.some((x) => x.type === e.type))
      return result('REVIEW', null, 'CONTRADICTORY_EVIDENCE');
  }
  const have = (t: TierEvidenceType) => usable.some((e) => e.type === t);
  const meets = (r: TierRequirements) => r.all.every(have) && r.any.every((g) => g.some(have));
  const p = input.policy;
  const one =
    (have('BVN') || have('NIN')) && meets(p.regulatory.LEVEL_1) && meets(p.operator.LEVEL_1);
  const two =
    one && have('BVN') && have('NIN') && meets(p.regulatory.LEVEL_2) && meets(p.operator.LEVEL_2);
  const tier3AdditionalEvidence = tier3AdditionalEvidenceType(p, have);
  const three =
    two &&
    tier3HasAdditionalRequirement(p) &&
    tier3AdditionalEvidence !== null &&
    meets(p.regulatory.LEVEL_3) &&
    meets(p.operator.LEVEL_3);
  if (!one) return result('PENDING', 'NONE', 'REQUIREMENTS_NOT_MET');
  // Select a deterministic, minimal set of evidence types actually used by the rules.
  const types = new Set<TierEvidenceType>(two ? ['BVN', 'NIN'] : [have('BVN') ? 'BVN' : 'NIN']);
  const required = [
    p.regulatory.LEVEL_1,
    p.operator.LEVEL_1,
    ...(two ? [p.regulatory.LEVEL_2, p.operator.LEVEL_2] : []),
    ...(three ? [p.regulatory.LEVEL_3, p.operator.LEVEL_3] : []),
  ];
  for (const rule of required) {
    for (const type of rule.all) types.add(type);
    for (const group of rule.any) {
      const preferAdditional =
        three && group.every(isTier3AdditionalType) ? group.find(have) : undefined;
      const existing = group.find((type) => types.has(type));
      const chosen = preferAdditional ?? existing ?? group.find(have);
      if (chosen) types.add(chosen);
    }
  }
  // Ensure the evidence item that makes the additional Tier 3 floor actionable is included in the
  // audited supporting set, even if a prior inherited any-of group selected another item.
  if (three && tier3AdditionalEvidence) types.add(tier3AdditionalEvidence);
  const supporting = [...types].map(
    (type) =>
      usable
        .filter((e) => e.type === type)
        .map((e) => e.id)
        .sort()[0]!,
  );
  return result(
    'ELIGIBLE',
    three ? 'LEVEL_3' : two ? 'LEVEL_2' : 'LEVEL_1',
    three ? 'TIER_3_REQUIREMENTS_MET' : two ? 'TIER_2_REQUIREMENTS_MET' : 'TIER_1_REQUIREMENTS_MET',
    supporting.sort(),
  );
}

export type TierTransitionPlan =
  | { action: 'HOLD_FOR_REVIEW'; reason: string; decision: TierDecision }
  | { action: 'NO_CHANGE'; reason: string; decision: TierDecision }
  | {
      action: 'PROPOSE_TRANSITION';
      oldTier: TierLevel;
      newTier: TierLevel;
      direction: 'UPGRADE' | 'DOWNGRADE';
      reason: string;
      decision: TierDecision;
    };

/**
 * Candidate plan only, never a mutation. Callers must re-evaluate in the same
 * transaction as any eventual authorized change. A legacy assessment is not
 * silently changed by a new evidence model; managed Level 3 assessments use the
 * same explicit evidence/reassessment rules as the lower tiers.
 */
export function planTierTransition(input: {
  currentTier: TierLevel;
  legacyAssessment: boolean;
  decision: TierDecision;
}): TierTransitionPlan {
  const { currentTier, legacyAssessment, decision } = input;
  if (
    !['NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(currentTier) ||
    typeof legacyAssessment !== 'boolean' ||
    !decision ||
    !['PENDING', 'ELIGIBLE'].includes(decision.status) ||
    !decision.policyVersion ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(decision.policyVersion) ||
    !Array.isArray(decision.supportingEvidenceIds) ||
    decision.supportingEvidenceIds.some((id) => !idPattern.test(id)) ||
    (decision.status === 'PENDING' &&
      (decision.highestTier !== 'NONE' || decision.supportingEvidenceIds.length !== 0)) ||
    (decision.status === 'ELIGIBLE' &&
      (!['LEVEL_1', 'LEVEL_2', 'LEVEL_3'].includes(decision.highestTier ?? '') ||
        decision.supportingEvidenceIds.length === 0)) ||
    decision.highestTier === null
  )
    return { action: 'HOLD_FOR_REVIEW', reason: 'DECISION_NOT_ACTIONABLE', decision };
  if (legacyAssessment) return { action: 'HOLD_FOR_REVIEW', reason: 'LEGACY_ASSESSMENT', decision };
  const rank: Record<TierLevel, number> = { NONE: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3 };
  if (!(decision.highestTier in rank))
    return { action: 'HOLD_FOR_REVIEW', reason: 'INVALID_CANDIDATE', decision };
  if (decision.highestTier === currentTier)
    return { action: 'NO_CHANGE', reason: 'ALREADY_AT_CANDIDATE_TIER', decision };
  return {
    action: 'PROPOSE_TRANSITION',
    oldTier: currentTier,
    newTier: decision.highestTier,
    direction: rank[decision.highestTier] > rank[currentTier] ? 'UPGRADE' : 'DOWNGRADE',
    reason: decision.reason,
    decision,
  };
}
