/**
 * Arena 3 Phase 5 — Admin Web mirror of the backend effective-configuration preview contract.
 *
 * Source of truth: `src/commercial-configuration/effective-configuration-preview.types.ts`.
 * This file exists so the Admin Web can type the response without importing backend code. It must
 * stay a MIRROR: no field is renamed, narrowed or defaulted, and no computation lives here.
 */
/**
 * Mirrored contract (see header above). Original docblock retained for field semantics.
 *
 * This is the single published shape the Admin Web builds on, so an operator sees exactly the
 * evidence the backend produced and nothing a browser re-derived.
 *
 * Boundaries encoded in the shape itself:
 *  - `ADVISORY` — the preview is never an admission decision, a quote, a reservation, a charge, an
 *    accrual or a credit. No money moves because a preview ran.
 *  - `BACKEND_RESOLVERS` — every status, window, priority and amount below comes from an existing
 *    service. The preview performs no precedence, threshold or eligibility arithmetic.
 *  - `NOT_APPLICABLE` — a resolver whose contract is absent from this baseline (currently the
 *    Arena 1 customer-class resolver) is reported, never approximated from tier/segment/class code.
 *  - `MISSING` — a definitive "no such configuration". It is never rendered as "unlimited".
 */

export type PreviewSectionStatus =
  /** Resolver answered and produced applicable configuration. */
  | 'RESOLVED'
  /** Resolver answered definitively: no applicable configuration exists. */
  | 'MISSING'
  /** Resolver refused a tied top rule set. Nothing was selected. */
  | 'AMBIGUOUS'
  /** The section does not apply to this request; no inference was attempted. */
  | 'NOT_APPLICABLE'
  /** The section could not be evaluated (invalid input, unavailable policy). */
  | 'UNAVAILABLE'
  /** The caller lacks the read function for this section; nothing was disclosed. */
  | 'RESTRICTED';

export type PreviewSeverity = 'INFO' | 'WARNING' | 'BLOCKER';

export const PREVIEW_DISCLAIMER =
  'Effective-configuration preview. Advisory only: it explains which approved configuration would apply to a hypothetical operation. It creates no admission decision, quote, reservation, charge, accrual, credit or posting, and running it moves no money.';

export interface PreviewExplanation {
  /** Machine-readable code an operator can quote in a support ticket. */
  code: string;
  /** Plain-language statement of what the backend did or refused to do. */
  message: string;
  severity: PreviewSeverity;
}

export interface PreviewProduct {
  code: string;
  name: string;
  domain: string;
  currency: string;
  productScope: string;
  status: string;
  enabled: boolean;
  configurationStatus: string;
  version: number;
}

export interface PreviewInstitution {
  id: string;
  /** null when the institution could not be located; the explanation carries the detail. */
  name: string | null;
  status: string | null;
}

export interface PreviewCustomerClass {
  status: PreviewSectionStatus;
  note: string;
}

export interface PreviewKycRestriction {
  /** Trusted financial-eligibility gate result, or null when no customer was supplied. */
  kycLevel: 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | null;
  /** `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` as deployed for THIS backend instance. */
  tierEnforcementActivationEnabled: boolean;
  /** The approved institution tier-limit mapping binding this exact key, when resolvable. */
  tierMapping: {
    policyVersion: number;
    disposition: string;
    profileCode: string | null;
    profileDigest: string | null;
    serviceClass: string | null;
  } | null;
  /** Why a tier mapping is absent, straight from the policy service. */
  note: string | null;
}

export interface PreviewLimitAssignment {
  assignmentId: string;
  limitProfileCode: string;
  subjectType: string;
  subjectId: string | null;
  segmentCode: string | null;
  precedence: number;
}

export interface PreviewLimitRule {
  ruleId: string;
  profileCode: string;
  dimension: string;
  direction: string | null;
  channel: string | null;
  currency: string;
  limitValueMinor: string | null;
  limitValueCount: number | null;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Which profile contributed this rule. */
  source: 'ASSIGNMENT' | 'TIER_POLICY' | 'ASSIGNMENT_AND_TIER_POLICY';
}

export interface PreviewLimitSection {
  status: PreviewSectionStatus;
  note: string | null;
  assignment: PreviewLimitAssignment | null;
  /** Every profile conjunctively governing the admission, in resolution order. */
  governingProfileCodes: string[];
  assignmentProfileCode: string | null;
  tierProfileCode: string | null;
  rules: PreviewLimitRule[];
  /** Dimensions the selected rules would evaluate; the engine's own vocabulary. */
  evaluatedDimensions: string[];
  /** True when the caller's institution implies tier enforcement but the backend reports it off. */
  tierEnforcementInactive: boolean;
}

export interface PreviewFeeSection {
  status: PreviewSectionStatus;
  note: string | null;
  currency: string;
  evaluatedAt: string;
  rule: {
    ruleId: string;
    ruleVersion: number;
    flatFeeMinor: string | null;
    percentageBps: number | null;
    minimumFeeMinor: string | null;
    maximumFeeMinor: string | null;
    vatBps: number | null;
    priority: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  } | null;
  /** Present only when the resolver refused a tied top set (never a silent pick). */
  ambiguousRuleIds: string[] | null;
  ambiguousPriority: number | null;
  /** Calculator output when a rule resolved and an amount was supplied. Never posts a leg. */
  computed: {
    status: string;
    feeMinor: string | null;
    vatMinor: string | null;
    totalMinor: string | null;
    calculationModel: string | null;
    /** Always false — the preview never posts a journal leg. */
    postsJournalLegs: false;
  } | null;
}

export interface PreviewCommissionAllocation {
  recipientType: string;
  recipientId: string | null;
  amountMinor: string;
  currency: string;
  basis: string;
  baseAmountMinor: string;
  calculationModel: string;
  ruleId: string;
  ruleVersion: number;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  targeting: {
    agentClassId: string | null;
    agentId: string | null;
    aggregatorId: string | null;
  };
}

export interface PreviewCommissionSection {
  status: PreviewSectionStatus;
  note: string | null;
  allocations: PreviewCommissionAllocation[];
  /** Present only when status === \'AMBIGUOUS\': conflicting rule ids, sorted ASC. */
  ambiguousRuleIds?: string[] | null;
  ambiguousPriority?: number | null;
  /** Stated explicitly: nothing is accrued or settled here. */
  accrualPosted: false;
}

export interface PreviewRewardGrant {
  beneficiaryType: string;
  beneficiaryId: string | null;
  rewardType: string;
  amountMinor: string;
  currency: string;
  basis: string;
  baseAmountMinor: string;
  calculationModel: string;
  ruleId: string;
  ruleVersion: number;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  campaignCode: string | null;
}

export interface PreviewRewardSection {
  status: PreviewSectionStatus;
  note: string | null;
  grants: PreviewRewardGrant[];
  /** Present only when status === \'AMBIGUOUS\': conflicting rule ids, sorted ASC. */
  ambiguousRuleIds?: string[] | null;
  ambiguousPriority?: number | null;
  /** Reward financial execution stays unwired; the preview never credits a wallet. */
  creditPosted: false;
}

export interface EffectiveConfigurationPreview {
  previewedAt: string;
  authoritative: 'BACKEND_RESOLVERS';
  mode: 'ADVISORY';
  disclaimer: string;
  request: {
    productCode: string;
    currency: string;
    principalType: 'CUSTOMER' | 'AGENT';
    principalId: string | null;
    agentClassId: string | null;
    segmentCodes: string[];
    institutionId: string | null;
    direction: 'INCOMING' | 'OUTGOING';
    channel: string | null;
    amountMinor: string | null;
    serviceClass: string | null;
    evaluatedAt: string;
  };
  product: PreviewProduct | null;
  institution: PreviewInstitution | null;
  customerClass: PreviewCustomerClass;
  kycRestriction: PreviewKycRestriction;
  limits: PreviewLimitSection;
  fee: PreviewFeeSection;
  commission: PreviewCommissionSection;
  reward: PreviewRewardSection;
  /** Every missing/ambiguous/inactive fact, in one ordered list. */
  explanation: PreviewExplanation[];
  /** Convenience flags — derived from `explanation` by the backend, not by the browser. */
  summary: {
    sections: {
      limits: PreviewSectionStatus;
      fee: PreviewSectionStatus;
      commission: PreviewSectionStatus;
      reward: PreviewSectionStatus;
    };
    blockerCount: number;
    warningCount: number;
  };
  /** Hard guarantees the API makes on every response, so no client has to assume them. */
  guarantees: {
    readonly: true;
    writesPerformed: [];
    financialMutations: [];
  };
}

/**
 * Refuse a response that does not carry the advertised read-only guarantees.
 *
 * The Studio renders this data as authoritative, so a response claiming `mode`/`authoritative`
 * anything else — or reporting a write — is treated as a failed call rather than displayed. This is
 * a contract check, not a business rule.
 */
export function assertAdvisoryPreview(
  value: unknown,
): asserts value is EffectiveConfigurationPreview {
  const candidate = value as Partial<EffectiveConfigurationPreview> | null;
  const guarantees = candidate?.guarantees;
  if (
    !candidate ||
    candidate.mode !== 'ADVISORY' ||
    candidate.authoritative !== 'BACKEND_RESOLVERS' ||
    !guarantees ||
    guarantees.readonly !== true ||
    (guarantees.writesPerformed ?? []).length > 0 ||
    (guarantees.financialMutations ?? []).length > 0 ||
    !candidate.limits ||
    !candidate.fee ||
    !candidate.commission ||
    !candidate.reward ||
    !Array.isArray(candidate.explanation)
  )
    throw new Error(
      'The preview response did not carry the backend read-only guarantee, so it was not displayed.',
    );
}
