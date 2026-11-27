/**
 * Arena 3 Phase 3 — EFFECTIVE CONFIGURATION PREVIEW contract (types only).
 *
 * This is the single published shape the Admin Web builds on, so an operator sees exactly the
 * evidence the backend produced and nothing a browser re-derived.
 *
 * Boundaries encoded in the shape itself:
 *  - `ADVISORY` — the preview is never an admission decision, a quote, a reservation, a charge, an
 *    accrual or a credit. No money moves because a preview ran.
 *  - `BACKEND_RESOLVERS` — every status, window, priority and amount below comes from an existing
 *    service. The preview performs no precedence, threshold or eligibility arithmetic.
 *  - `NOT_APPLICABLE` — a section that does not apply to this request at all (for example a
 *    KYC decision for a request that named no customer). Never an approximation.
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
  /**
   * The caller is authenticated and authorized for THIS route (`limit.view`) but not for the
   * function that governs the section's data. The section is withheld — not evaluated, not
   * partially disclosed — and `note` says only which capability is missing. Nothing about the
   * underlying configuration (existence, count, priority, amount) is returned.
   */
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

/**
 * Section projection for a withheld section.
 *
 * Deliberately carries NO configuration fields: an unauthorized caller learns that the section
 * exists and which capability would unlock it, and nothing else. Presence/absence of rules,
 * amounts and priorities are exactly the information a missing read function must not reveal.
 */
export interface PreviewRestrictedSection {
  status: 'RESTRICTED';
  note: string;
  /** Catalogue function the caller lacks for this section. */
  requiredFunction: string;
}

/** An effective customer-class resolution (Arena 1 `CustomerClassResolverService`). */
export interface PreviewCustomerClassResolution {
  /** Class code — the identifier every commercial rule targets. */
  classCode: string;
  assignmentId: string;
  classId: string;
  className: string;
  /** Assignment row version, so a later switch is explainable. */
  assignmentVersion: number;
  /** Class catalogue row version. */
  classVersion: number;
  source: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PreviewCustomerClassSection {
  status: PreviewSectionStatus;
  note: string | null;
  /** Present only when status === 'RESOLVED'. */
  effective: PreviewCustomerClassResolution | null;
}

interface PreviewKycRestrictionBody {
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

export type PreviewKycRestriction = PreviewKycRestrictionBody | PreviewRestrictedSection;

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

interface PreviewFeeSectionBody {
  status: Exclude<PreviewSectionStatus, 'RESTRICTED'>;
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

export type PreviewFeeSection = PreviewFeeSectionBody | PreviewRestrictedSection;

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

interface PreviewCommissionSectionBody {
  status: Exclude<PreviewSectionStatus, 'RESTRICTED'>;
  note: string | null;
  allocations: PreviewCommissionAllocation[];
  /** Present only when status === 'AMBIGUOUS': conflicting rule ids, sorted ASC. */
  ambiguousRuleIds: string[] | null;
  ambiguousPriority: number | null;
  /** Stated explicitly: nothing is accrued or settled here. */
  accrualPosted: false;
}

export type PreviewCommissionSection = PreviewCommissionSectionBody | PreviewRestrictedSection;

/**
 * PR #27 — statutory charges, reported separately from the service fee.
 *
 * The point of the separate section is the zero-vs-missing distinction the mission demands:
 * VAT on our own fee is modelled and authored per rule; every OTHER statutory charge is absent from
 * the data model entirely. Those are different facts and must never collapse into one number.
 */
export interface PreviewStatutoryChargeLine {
  charge: string;
  rateBps: number | null;
  amountMinor: string | null;
  provenance: 'AUTHORED' | 'NOT_MODELLED';
  note: string;
}

export interface PreviewStatutoryChargesSection {
  status: Exclude<PreviewSectionStatus, 'RESTRICTED'>;
  note: string;
  lines: PreviewStatutoryChargeLine[];
  /** Charges with no representation in the schema/resolver/engine layer. Never given a zero rate. */
  notModelled: Array<{ charge: string; reason: string }>;
  postsJournalLegs: false;
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

interface PreviewRewardSectionBody {
  status: Exclude<PreviewSectionStatus, 'RESTRICTED'>;
  note: string | null;
  grants: PreviewRewardGrant[];
  /** Present only when status === 'AMBIGUOUS': conflicting rule ids, sorted ASC. */
  ambiguousRuleIds: string[] | null;
  ambiguousPriority: number | null;
  /** Reward financial execution stays unwired; the preview never credits a wallet. */
  creditPosted: false;
}

export type PreviewRewardSection = PreviewRewardSectionBody | PreviewRestrictedSection;

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
  /** `null` when withheld or not located; `productRestricted` carries the reason. */
  product: PreviewProduct | PreviewRestrictedSection | null;
  productRestricted: PreviewRestrictedSection | null;
  institution: PreviewInstitution | PreviewRestrictedSection | null;
  institutionRestricted: PreviewRestrictedSection | null;
  customerClass: PreviewCustomerClassSection | PreviewRestrictedSection;
  kycRestriction: PreviewKycRestriction;
  limits: PreviewLimitSection;
  fee: PreviewFeeSection;
  statutoryCharges: PreviewStatutoryChargesSection;
  commission: PreviewCommissionSection;
  reward: PreviewRewardSection;
  /** Every missing/ambiguous/inactive fact, in one ordered list. */
  explanation: PreviewExplanation[];
  /** Convenience flags — derived from `explanation` by the backend, not by the browser. */
  summary: {
    sections: {
      limits: PreviewSectionStatus;
      fee: PreviewSectionStatus;
      statutoryCharges: PreviewSectionStatus;
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
    /**
     * Proves the advisory read ran inside a database-enforced READ ONLY transaction
     * (`SET TRANSACTION READ ONLY`, then `SHOW transaction_read_only` asserted back). Reported as
     * the observed value, never as a constant the code merely claims.
     */
    databaseTransactionReadOnly: boolean;
  };
}
