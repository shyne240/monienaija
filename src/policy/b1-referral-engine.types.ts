/**
 * B1T07 — B1 referral engine, cashback engine, and loyalty engine
 * types.
 *
 * The B1 referral engine, cashback engine, and loyalty engine is
 * the runtime commercial-rewards engine implementation for the
 * B1 first commercial scope (`commercial.virtual-account.inbound-
 * funding` v1) established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1
 * referral engine, cashback engine, and loyalty engine consumes
 * the B1 commercial catalog (B1T03), the B1 commercial decision
 * (B1T04), the B1 billing engine, invoice engine, and statement-
 * generation engine (B1T05) outputs, the B1 campaign engine,
 * promotion engine, and coupon engine (B1T06) decisions, the A4
 * product-policy decision, the A3 binding recheck, the A5 Ledger
 * account state, the A6 partner state, and the A7 product state
 * through approved read-only consumer boundaries.
 *
 * The B1 referral engine, cashback engine, and loyalty engine is
 * the only B1 commercial-rewards engine for referrals, cashback,
 * and loyalty. The B1 referral engine, cashback engine, and
 * loyalty engine is a read-only contract against the existing
 * A1 canonical identity, A2 authorization, A3 binding, A4 policy
 * decision, A5 Ledger, A6 partner-adapter, A6T05 external-
 * operation, A6T08 settlement / suspense / compensating, A6T09
 * external reconciliation, A6T10 data classification, A7 product
 * catalog, A7 product-policy profile, A7T04 product customer-
 * binding, A7T05 product command, A7T06 product notification,
 * A7T07 product lifecycle, A7T08 product financial effect,
 * A7T09 product reconciliation, A7T10 product data minimization,
 * `CustomerPreference`, Wallet, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, Reconciliation, and `CustomerPreference`
 * authorities. The B1 referral engine, cashback engine, and
 * loyalty engine is a read-write contract against the shared
 * Operations `IdempotencyService`, `AuditService`, `OutboxService`,
 * and `MetricsService`.
 *
 * The B1 referral engine, cashback engine, and loyalty engine
 * NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    credits a wallet, debits a wallet, awards loyalty balances,
 *    redeems loyalty balances, executes referral rewards, creates
 *    financial effects, repairs a binding, changes A4 policy /
 *    source records, or dispatches a notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - modifies invoices, statements, commercial decisions, pricing
 *    catalogs, product state, policy, customer bindings, or
 *    customer preferences;
 *  - dispatches notifications, executes settlements, performs
 *    payouts, performs reconciliation, or communicates with
 *    external partners.
 *
 * No new A1 canonical identity, A2 authorization, A3 binding, A4
 * policy decision, A5 transfer / deposit / withdrawal, A6 partner-
 * adapter, A6T05 external-operation, A6T06 callback, A6T08
 * settlement / suspense / compensating-entry, A6T09 external
 * reconciliation, A6T10 data classification / consent / retention /
 * legal-hold / secret / disclosure / support-trace / partner-
 * payload validation, A7 product catalog, A7 product-policy
 * profile, A7T04 product customer-binding, A7T05 product
 * command/operation, A7T06 product notification delivery, A7T07
 * product lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, Wallet, Ledger,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics,
 * Reconciliation, or `CustomerPreference` authority is introduced
 * by B1T07.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineContractName = 'B1-REFERRAL-ENGINE';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineContractVersion = 1;

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * decision kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineDecisionKind = 'REFERRAL' | 'CASHBACK' | 'LOYALTY';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * decision outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineDecisionOutcome = 'ELIGIBLE' | 'APPLIED' | 'REJECTED' | 'REPLAYED';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * referral state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralState = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'RETIRED';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * cashback state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1CashbackState = 'CREATED' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * loyalty state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1LoyaltyState = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED' | 'ARCHIVED';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * document kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralDocumentKind =
  | 'REFERRAL'
  | 'REFERRAL_PROGRAM'
  | 'REFERRAL_CAMPAIGN'
  | 'REFERRAL_RELATIONSHIP'
  | 'REFERRAL_HIERARCHY'
  | 'REFERRAL_QUALIFICATION'
  | 'CASHBACK'
  | 'CASHBACK_CAMPAIGN'
  | 'CASHBACK_RULE'
  | 'LOYALTY'
  | 'LOYALTY_PROGRAM'
  | 'LOYALTY_TIER'
  | 'LOYALTY_POINT_POLICY'
  | 'LOYALTY_EARNING'
  | 'LOYALTY_REDEMPTION';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * document version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralDocumentVersion = 1;

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineScopeKey = 'commercial.virtual-account.inbound-funding';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineScopeVersion = 1;

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineCurrency = 'NGN';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEnginePeriodKey =
  'commercial.virtual-account.inbound-funding.referral-period.per-flow.v1';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * period version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEnginePeriodVersion = 1;

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * referral relationship type vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralRelationshipType =
  | 'PARENT'
  | 'CHILD'
  | 'SIBLING'
  | 'SPONSOR'
  | 'REFEREE'
  | 'CIRCLE'
  | 'NETWORK';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * referral qualification status vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralQualificationStatus =
  | 'NOT_QUALIFIED'
  | 'PENDING_VERIFICATION'
  | 'QUALIFIED'
  | 'OVER_QUALIFIED'
  | 'EXPIRED_QUALIFICATION';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * loyalty tier status vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1LoyaltyTierStatus =
  | 'TIER_PENDING'
  | 'TIER_BRONZE'
  | 'TIER_SILVER'
  | 'TIER_GOLD'
  | 'TIER_PLATINUM'
  | 'TIER_DIAMOND';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * loyalty earning source vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1LoyaltyEarningSource =
  | 'PURCHASE'
  | 'BILLING'
  | 'CAMPAIGN'
  | 'PROMOTION'
  | 'COUPON'
  | 'REFERRAL'
  | 'CASHBACK'
  | 'MANUAL_ADJUSTMENT';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * cashback calculation basis vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1CashbackCalculationBasis =
  | 'FIXED_AMOUNT'
  | 'PERCENTAGE_OF_BILLING'
  | 'PERCENTAGE_OF_FEE'
  | 'TIER_MULTIPLIER'
  | 'CAMPAIGN_OVERRIDE';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineFailureCodeV1 =
  | 'B1_REFERRAL_ENGINE_INVALID_COMMAND'
  | 'B1_REFERRAL_ENGINE_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_QUERY_UNAVAILABLE'
  | 'B1_REFERRAL_ENGINE_PROHIBITED'
  | 'B1_REFERRAL_ENGINE_DECISION_NOT_FOUND'
  | 'B1_REFERRAL_ENGINE_DECISION_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_CATALOG_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_CATALOG_MISSING'
  | 'B1_REFERRAL_ENGINE_BILLING_DOCUMENT_NOT_FOUND'
  | 'B1_REFERRAL_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_CAMPAIGN_DECISION_NOT_FOUND'
  | 'B1_REFERRAL_ENGINE_CAMPAIGN_DECISION_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_PROMOTION_DECISION_NOT_FOUND'
  | 'B1_REFERRAL_ENGINE_PROMOTION_DECISION_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_COUPON_DECISION_NOT_FOUND'
  | 'B1_REFERRAL_ENGINE_COUPON_DECISION_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_A4_POLICY_DENIED'
  | 'B1_REFERRAL_ENGINE_A3_BINDING_INVALID'
  | 'B1_REFERRAL_ENGINE_A5_LEDGER_INVARIANT_BROKEN'
  | 'B1_REFERRAL_ENGINE_A6_PARTNER_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_A7_PRODUCT_INCOMPATIBLE'
  | 'B1_REFERRAL_ENGINE_REPLAY_CONFLICT'
  | 'B1_REFERRAL_ENGINE_REPLAY_EXPIRED'
  | 'B1_REFERRAL_ENGINE_IN_PROGRESS'
  | 'B1_REFERRAL_ENGINE_NUMBER_CONFLICT'
  | 'B1_REFERRAL_ENGINE_EXPIRED'
  | 'B1_REFERRAL_ENGINE_USAGE_LIMIT_EXCEEDED'
  | 'B1_REFERRAL_ENGINE_NOT_APPLICABLE'
  | 'B1_REFERRAL_ENGINE_HIERARCHY_INVALID'
  | 'B1_REFERRAL_ENGINE_QUALIFICATION_INSUFFICIENT'
  | 'B1_REFERRAL_ENGINE_TIER_INSUFFICIENT'
  | 'B1_REFERRAL_ENGINE_POINT_POLICY_INCOMPATIBLE';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * decision eligibility vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineEligibility =
  | 'CUSTOMER_ELIGIBLE'
  | 'MERCHANT_ELIGIBLE'
  | 'PARTNER_ELIGIBLE'
  | 'PRODUCT_ELIGIBLE'
  | 'TIER_ELIGIBLE'
  | 'PERIOD_ELIGIBLE'
  | 'USAGE_LIMIT_ELIGIBLE'
  | 'HIERARCHY_ELIGIBLE'
  | 'QUALIFICATION_ELIGIBLE'
  | 'POINT_POLICY_ELIGIBLE';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * rule kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralRuleKindV1 =
  | 'A4_POLICY_LIMIT'
  | 'A4_POLICY_OBLIGATION'
  | 'A4_POLICY_CURRENTNESS'
  | 'A4_POLICY_REEVALUATION'
  | 'A3_BINDING_RECHECK'
  | 'A5_LEDGER_ACCOUNT_STATE'
  | 'A5_LEDGER_POSTING_BOUNDARY'
  | 'A5_FINANCIAL_INVARIANTS'
  | 'A6_PARTNER_STATE'
  | 'A6_PARTNER_CAPABILITY_VERSION'
  | 'A6T08_SETTLEMENT_SUSPENSE_COMPENSATING'
  | 'A6T09_EXTERNAL_RECONCILIATION'
  | 'A7_PRODUCT_CATALOG'
  | 'A7_PRODUCT_BOUNDARY'
  | 'A7T04_PRODUCT_CUSTOMER_BINDING'
  | 'A7T05_PRODUCT_COMMAND_OPERATION'
  | 'A7T06_PRODUCT_NOTIFICATION'
  | 'A7T07_PRODUCT_LIFECYCLE'
  | 'A7T08_PRODUCT_FINANCIAL_EFFECT'
  | 'A7T09_PRODUCT_RECONCILIATION'
  | 'A7T10_PRODUCT_DATA_MINIMIZATION'
  | 'B1_COMMERCIAL_CATALOG_LOOKUP'
  | 'B1_COMMERCIAL_CATALOG_COMPATIBILITY'
  | 'B1_COMMERCIAL_CATALOG_PLAN'
  | 'B1_COMMERCIAL_CATALOG_TIER'
  | 'B1_COMMERCIAL_CATALOG_ENTITLEMENT'
  | 'B1_COMMERCIAL_CATALOG_PACKAGE'
  | 'B1_COMMERCIAL_CATALOG_BUNDLE'
  | 'B1_COMMERCIAL_CATALOG_SUBSCRIPTION'
  | 'B1_COMMERCIAL_CATALOG_FEATURE_FLAG'
  | 'B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT'
  | 'B1_COMMERCIAL_CATALOG_PRICING'
  | 'B1_COMMERCIAL_DECISION_LOOKUP'
  | 'B1_COMMERCIAL_DECISION_COMPATIBILITY'
  | 'B1_COMMERCIAL_DECISION_REPLAY'
  | 'B1_BILLING_ENGINE_DOCUMENT_LOOKUP'
  | 'B1_BILLING_ENGINE_DOCUMENT_COMPATIBILITY'
  | 'B1_BILLING_ENGINE_DOCUMENT_REPLAY'
  | 'B1_CAMPAIGN_DECISION_LOOKUP'
  | 'B1_CAMPAIGN_DECISION_COMPATIBILITY'
  | 'B1_CAMPAIGN_DECISION_REPLAY'
  | 'B1_PROMOTION_DECISION_LOOKUP'
  | 'B1_PROMOTION_DECISION_COMPATIBILITY'
  | 'B1_PROMOTION_DECISION_REPLAY'
  | 'B1_COUPON_DECISION_LOOKUP'
  | 'B1_COUPON_DECISION_COMPATIBILITY'
  | 'B1_COUPON_DECISION_REPLAY'
  | 'B1_REFERRAL_ENGINE_REFERRAL_CAMPAIGN'
  | 'B1_REFERRAL_ENGINE_REFERRAL_PROGRAM'
  | 'B1_REFERRAL_ENGINE_REFERRAL_ELIGIBILITY'
  | 'B1_REFERRAL_ENGINE_REFERRAL_RELATIONSHIP'
  | 'B1_REFERRAL_ENGINE_REFERRAL_HIERARCHY'
  | 'B1_REFERRAL_ENGINE_REFERRAL_QUALIFICATION'
  | 'B1_REFERRAL_ENGINE_REFERRAL_REWARD_DECISION'
  | 'B1_REFERRAL_ENGINE_CASHBACK_ELIGIBILITY'
  | 'B1_REFERRAL_ENGINE_CASHBACK_CAMPAIGN'
  | 'B1_REFERRAL_ENGINE_CASHBACK_CALCULATION_DECISION'
  | 'B1_REFERRAL_ENGINE_CASHBACK_RULE_EVALUATION'
  | 'B1_REFERRAL_ENGINE_LOYALTY_PROGRAM'
  | 'B1_REFERRAL_ENGINE_LOYALTY_TIER'
  | 'B1_REFERRAL_ENGINE_LOYALTY_EARNING_DECISION'
  | 'B1_REFERRAL_ENGINE_LOYALTY_REDEMPTION_ELIGIBILITY_DECISION'
  | 'B1_REFERRAL_ENGINE_LOYALTY_POINT_POLICY'
  | 'B1_REFERRAL_ENGINE_NUMBER_DETERMINISTIC'
  | 'B1_REFERRAL_ENGINE_DOCUMENT_VERSION';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * rule outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralRuleOutcomeV1 = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * referral reward decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralRewardDecisionV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly referralRewardDecisionId: string;
  readonly referralRewardDecisionReference: string;
  readonly referralRewardDecisionVersion: B1ReferralDocumentVersion;
  readonly referralRewardDecisionState: B1ReferralState;
  readonly referralRewardDecisionOutcome: B1ReferralEngineDecisionOutcome;
  readonly referralRewardDecisionHash: string;
  readonly referralRewardDecisionReplayHash: string;
  readonly referralRequestHash: string;
  readonly scopeKey: B1ReferralEngineScopeKey;
  readonly scopeVersion: B1ReferralEngineScopeVersion;
  readonly periodKey: B1ReferralEnginePeriodKey;
  readonly periodVersion: B1ReferralEnginePeriodVersion;
  readonly referralCampaignKey: string;
  readonly referralCampaignVersion: 1;
  readonly referralCampaignName: string;
  readonly referralProgramKey: string;
  readonly referralProgramVersion: 1;
  readonly referralKey: string;
  readonly referralVersion: 1;
  readonly referralName: string;
  readonly referralStartAt: string;
  readonly referralEndAt: string;
  readonly referralEffectiveAt: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly refereeCustomerId: string;
  readonly sponsorCustomerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.referral'
    | 'commercial.virtual-account.inbound-funding.cashback'
    | 'commercial.virtual-account.inbound-funding.loyalty';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly relationshipType: B1ReferralRelationshipType;
  readonly hierarchyPath: readonly string[];
  readonly hierarchyDepth: number;
  readonly qualificationStatus: B1ReferralQualificationStatus;
  readonly referralUsageLimitPerReferrer: number;
  readonly referralUsageLimitPerCampaign: number;
  readonly referralUsageLimitRemaining: number;
  readonly eligibilitySummary: readonly B1ReferralEngineEligibility[];
  readonly referralEligible: boolean;
  readonly referralApplicable: boolean;
  readonly referralHierarchyConflicts: readonly string[];
  readonly referralQualificationConflicts: readonly string[];
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly explanationTrace: B1ReferralExplanationTraceV1;
  readonly ruleTrace: B1ReferralRuleTraceV1;
  readonly auditEvidence: B1ReferralAuditEvidenceV1;
  readonly idempotencyScope: 'b1.referral-engine.referral.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1ReferralEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * cashback calculation decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1CashbackCalculationDecisionV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly cashbackDecisionId: string;
  readonly cashbackDecisionReference: string;
  readonly cashbackDecisionVersion: B1ReferralDocumentVersion;
  readonly cashbackDecisionState: B1CashbackState;
  readonly cashbackDecisionOutcome: B1ReferralEngineDecisionOutcome;
  readonly cashbackDecisionHash: string;
  readonly cashbackDecisionReplayHash: string;
  readonly cashbackRequestHash: string;
  readonly scopeKey: B1ReferralEngineScopeKey;
  readonly scopeVersion: B1ReferralEngineScopeVersion;
  readonly periodKey: B1ReferralEnginePeriodKey;
  readonly periodVersion: B1ReferralEnginePeriodVersion;
  readonly cashbackCampaignKey: string;
  readonly cashbackCampaignVersion: 1;
  readonly cashbackCampaignName: string;
  readonly cashbackKey: string;
  readonly cashbackVersion: 1;
  readonly cashbackName: string;
  readonly cashbackStartAt: string;
  readonly cashbackEndAt: string;
  readonly cashbackEffectiveAt: string;
  readonly cashbackCalculationBasis: B1CashbackCalculationBasis;
  readonly cashbackCalculationRate: string;
  readonly cashbackCalculationBase: string;
  readonly cashbackCalculationAmount: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.referral'
    | 'commercial.virtual-account.inbound-funding.cashback'
    | 'commercial.virtual-account.inbound-funding.loyalty';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerCampaign: number;
  readonly usageLimitRemaining: number;
  readonly eligibilitySummary: readonly B1ReferralEngineEligibility[];
  readonly cashbackEligible: boolean;
  readonly cashbackApplicable: boolean;
  readonly cashbackRuleEvaluationTrace: readonly string[];
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly explanationTrace: B1ReferralExplanationTraceV1;
  readonly ruleTrace: B1ReferralRuleTraceV1;
  readonly auditEvidence: B1ReferralAuditEvidenceV1;
  readonly idempotencyScope: 'b1.referral-engine.cashback.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1ReferralEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * loyalty earning decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1LoyaltyEarningDecisionV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly loyaltyEarningDecisionId: string;
  readonly loyaltyEarningDecisionReference: string;
  readonly loyaltyEarningDecisionVersion: B1ReferralDocumentVersion;
  readonly loyaltyEarningDecisionState: B1LoyaltyState;
  readonly loyaltyEarningDecisionOutcome: B1ReferralEngineDecisionOutcome;
  readonly loyaltyEarningDecisionHash: string;
  readonly loyaltyEarningDecisionReplayHash: string;
  readonly loyaltyRequestHash: string;
  readonly scopeKey: B1ReferralEngineScopeKey;
  readonly scopeVersion: B1ReferralEngineScopeVersion;
  readonly periodKey: B1ReferralEnginePeriodKey;
  readonly periodVersion: B1ReferralEnginePeriodVersion;
  readonly loyaltyProgramKey: string;
  readonly loyaltyProgramVersion: 1;
  readonly loyaltyProgramName: string;
  readonly loyaltyTierKey: string;
  readonly loyaltyTierVersion: 1;
  readonly loyaltyTierStatus: B1LoyaltyTierStatus;
  readonly loyaltyPointPolicyKey: string;
  readonly loyaltyPointPolicyVersion: 1;
  readonly loyaltyEarningSource: B1LoyaltyEarningSource;
  readonly loyaltyEarningBase: string;
  readonly loyaltyEarningRate: string;
  readonly loyaltyEarningAmount: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.referral'
    | 'commercial.virtual-account.inbound-funding.cashback'
    | 'commercial.virtual-account.inbound-funding.loyalty';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerProgram: number;
  readonly usageLimitRemaining: number;
  readonly eligibilitySummary: readonly B1ReferralEngineEligibility[];
  readonly loyaltyEarningEligible: boolean;
  readonly loyaltyEarningApplicable: boolean;
  readonly loyaltyEarningConflicts: readonly string[];
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly explanationTrace: B1ReferralExplanationTraceV1;
  readonly ruleTrace: B1ReferralRuleTraceV1;
  readonly auditEvidence: B1ReferralAuditEvidenceV1;
  readonly idempotencyScope: 'b1.referral-engine.loyalty.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1ReferralEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * audit evidence (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralAuditEvidenceV1 {
  readonly auditEntityType: string;
  readonly auditEntityId: string;
  readonly auditAction: string;
  readonly auditActor: string;
  readonly auditCorrelationId: string;
  readonly auditRequestId: string;
  readonly auditCausationId: string | null;
  readonly auditOutboxEventType: string;
  readonly auditOutboxEventId: string | null;
  readonly auditRecorded: boolean;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * explanation trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralExplanationTraceV1 {
  readonly traceId: string;
  readonly traceKind:
    | 'REFERRAL_REWARD_DECISION'
    | 'CASHBACK_CALCULATION_DECISION'
    | 'LOYALTY_EARNING_DECISION'
    | 'LOYALTY_REDEMPTION_DECISION'
    | 'REFERRAL_ENGINE_COMPOSITE_DECISION';
  readonly traceSummary: string;
  readonly traceSteps: readonly B1ReferralExplanationStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * explanation step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralExplanationStepV1 {
  readonly stepIndex: number;
  readonly stepKind: B1ReferralRuleKindV1;
  readonly stepLabel: string;
  readonly stepOutcome: B1ReferralRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepReason: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
  readonly stepOutputs: Readonly<Record<string, unknown>>;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * rule trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralRuleTraceV1 {
  readonly ruleTraceId: string;
  readonly ruleTraceSteps: readonly B1ReferralRuleTraceStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * rule trace step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralRuleTraceStepV1 {
  readonly stepIndex: number;
  readonly ruleKind: B1ReferralRuleKindV1;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly ruleOutcome: B1ReferralRuleOutcomeV1;
  readonly ruleReasonCode: string;
  readonly ruleEvaluatedAt: string;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * decision failure (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralEngineFailureV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly code: B1ReferralEngineFailureCodeV1;
  readonly message: string;
  readonly failedRules: readonly B1ReferralRuleTraceStepV1[];
  readonly failedInputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestId: string;
  readonly generatedAt: string;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * referral request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralRequestV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly referralRequestId: string;
  readonly referralRequestVersion: B1ReferralDocumentVersion;
  readonly scopeKey: B1ReferralEngineScopeKey;
  readonly scopeVersion: B1ReferralEngineScopeVersion;
  readonly expectedCurrency: B1ReferralEngineCurrency;
  readonly expectedAccountingUnit: B1ReferralEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly refereeCustomerId: string;
  readonly sponsorCustomerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.referral'
    | 'commercial.virtual-account.inbound-funding.cashback'
    | 'commercial.virtual-account.inbound-funding.loyalty';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1ReferralEnginePeriodKey;
  readonly periodVersion: B1ReferralEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly referralCampaignKey: string;
  readonly referralCampaignVersion: 1;
  readonly referralProgramKey: string;
  readonly referralProgramVersion: 1;
  readonly referralKey: string;
  readonly referralVersion: 1;
  readonly referralStartAt: string;
  readonly referralEndAt: string;
  readonly relationshipType: B1ReferralRelationshipType;
  readonly hierarchyPath: readonly string[];
  readonly hierarchyDepth: number;
  readonly qualificationStatus: B1ReferralQualificationStatus;
  readonly referralUsageLimitPerReferrer: number;
  readonly referralUsageLimitPerCampaign: number;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * cashback request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1CashbackRequestV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly cashbackRequestId: string;
  readonly cashbackRequestVersion: B1ReferralDocumentVersion;
  readonly scopeKey: B1ReferralEngineScopeKey;
  readonly scopeVersion: B1ReferralEngineScopeVersion;
  readonly expectedCurrency: B1ReferralEngineCurrency;
  readonly expectedAccountingUnit: B1ReferralEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.referral'
    | 'commercial.virtual-account.inbound-funding.cashback'
    | 'commercial.virtual-account.inbound-funding.loyalty';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1ReferralEnginePeriodKey;
  readonly periodVersion: B1ReferralEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly cashbackCampaignKey: string;
  readonly cashbackCampaignVersion: 1;
  readonly cashbackKey: string;
  readonly cashbackVersion: 1;
  readonly cashbackStartAt: string;
  readonly cashbackEndAt: string;
  readonly cashbackCalculationBasis: B1CashbackCalculationBasis;
  readonly cashbackCalculationRate: string;
  readonly cashbackCalculationBase: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerCampaign: number;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * loyalty earning request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1LoyaltyEarningRequestV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly loyaltyRequestId: string;
  readonly loyaltyRequestVersion: B1ReferralDocumentVersion;
  readonly scopeKey: B1ReferralEngineScopeKey;
  readonly scopeVersion: B1ReferralEngineScopeVersion;
  readonly expectedCurrency: B1ReferralEngineCurrency;
  readonly expectedAccountingUnit: B1ReferralEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.referral'
    | 'commercial.virtual-account.inbound-funding.cashback'
    | 'commercial.virtual-account.inbound-funding.loyalty';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly periodKey: B1ReferralEnginePeriodKey;
  readonly periodVersion: B1ReferralEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly loyaltyProgramKey: string;
  readonly loyaltyProgramVersion: 1;
  readonly loyaltyTierKey: string;
  readonly loyaltyTierVersion: 1;
  readonly loyaltyPointPolicyKey: string;
  readonly loyaltyPointPolicyVersion: 1;
  readonly loyaltyEarningSource: B1LoyaltyEarningSource;
  readonly loyaltyEarningBase: string;
  readonly loyaltyEarningRate: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerProgram: number;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * referral replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralRewardReplaySafeResultV1 {
  readonly record: B1ReferralRewardDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.referral-engine.referral.idempotency.v1';
  readonly idempotencyKey: string;
  readonly referralRequestHash: string;
  readonly referralRewardDecisionHash: string;
  readonly referralRewardDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * cashback replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1CashbackCalculationReplaySafeResultV1 {
  readonly record: B1CashbackCalculationDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.referral-engine.cashback.idempotency.v1';
  readonly idempotencyKey: string;
  readonly cashbackRequestHash: string;
  readonly cashbackDecisionHash: string;
  readonly cashbackDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * loyalty earning replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1LoyaltyEarningReplaySafeResultV1 {
  readonly record: B1LoyaltyEarningDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.referral-engine.loyalty.idempotency.v1';
  readonly idempotencyKey: string;
  readonly loyaltyRequestHash: string;
  readonly loyaltyEarningDecisionHash: string;
  readonly loyaltyEarningDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * compatibility result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export type B1ReferralEngineCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1ReferralEngineFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * document versioning contract (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralDocumentVersioningContractV1 {
  readonly contractName: B1ReferralEngineContractName;
  readonly contractVersion: B1ReferralEngineContractVersion;
  readonly documentVersion: B1ReferralDocumentVersion;
  readonly scopeKey: B1ReferralEngineScopeKey;
  readonly scopeVersion: B1ReferralEngineScopeVersion;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByDocumentReference: string | null;
  readonly supersedesDocumentReference: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * document persistence record (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralDocumentPersistenceRecordV1 {
  readonly documentId: string;
  readonly documentReference: string;
  readonly documentVersion: B1ReferralDocumentVersion;
  readonly documentKind: B1ReferralDocumentKind;
  readonly documentHash: string;
  readonly documentReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly record:
    | B1ReferralRewardDecisionV1
    | B1CashbackCalculationDecisionV1
    | B1LoyaltyEarningDecisionV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 referral engine, cashback engine, and loyalty engine
 * read-only consumer ports (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
 */
export interface B1ReferralEngineConsumerPortsV1 {
  /**
   * B1 referral reward decision generate. Returns the canonical
   * B1 referral reward decision for the supplied B1 referral
   * request. The generate is read-only; the B1 referral engine
   * never posts a journal, mutates a balance, executes referral
   * rewards, dispatches a notification, or executes any financial
   * effect.
   */
  readonly generateReferralRewardDecision: (
    request: B1ReferralRequestV1,
  ) => Promise<B1ReferralRewardDecisionV1>;

  /**
   * B1 referral reward decision replay-safe generate. Returns the
   * canonical B1 referral reward decision replay-safe result for
   * the supplied B1 referral request. The replay-safe generate is
   * read-only; the B1 referral engine never posts a journal,
   * mutates a balance, executes referral rewards, dispatches a
   * notification, or executes any financial effect.
   */
  readonly replaySafeGenerateReferralRewardDecision: (
    request: B1ReferralRequestV1,
  ) => Promise<B1ReferralRewardReplaySafeResultV1>;

  /**
   * B1 cashback calculation decision generate. Returns the
   * canonical B1 cashback calculation decision for the supplied
   * B1 cashback request. The generate is read-only; the B1
   * cashback engine never posts a journal, mutates a balance,
   * redeems cashback, dispatches a notification, or executes any
   * financial effect.
   */
  readonly generateCashbackCalculationDecision: (
    request: B1CashbackRequestV1,
  ) => Promise<B1CashbackCalculationDecisionV1>;

  /**
   * B1 cashback calculation decision replay-safe generate. Returns
   * the canonical B1 cashback calculation decision replay-safe
   * result for the supplied B1 cashback request. The replay-safe
   * generate is read-only; the B1 cashback engine never posts a
   * journal, mutates a balance, redeems cashback, dispatches a
   * notification, or executes any financial effect.
   */
  readonly replaySafeGenerateCashbackCalculationDecision: (
    request: B1CashbackRequestV1,
  ) => Promise<B1CashbackCalculationReplaySafeResultV1>;

  /**
   * B1 loyalty earning decision generate. Returns the canonical
   * B1 loyalty earning decision for the supplied B1 loyalty
   * earning request. The generate is read-only; the B1 loyalty
   * engine never posts a journal, mutates a balance, awards
   * loyalty balances, redeems loyalty balances, dispatches a
   * notification, or executes any financial effect.
   */
  readonly generateLoyaltyEarningDecision: (
    request: B1LoyaltyEarningRequestV1,
  ) => Promise<B1LoyaltyEarningDecisionV1>;

  /**
   * B1 loyalty earning decision replay-safe generate. Returns the
   * canonical B1 loyalty earning decision replay-safe result for
   * the supplied B1 loyalty earning request. The replay-safe
   * generate is read-only; the B1 loyalty engine never posts a
   * journal, mutates a balance, awards loyalty balances, redeems
   * loyalty balances, dispatches a notification, or executes any
   * financial effect.
   */
  readonly replaySafeGenerateLoyaltyEarningDecision: (
    request: B1LoyaltyEarningRequestV1,
  ) => Promise<B1LoyaltyEarningReplaySafeResultV1>;

  /**
   * B1 referral engine compatibility check. Returns the canonical
   * B1 referral engine compatibility result for the supplied B1
   * referral / cashback / loyalty request. The compatibility
   * check is read-only; the B1 referral engine never posts a
   * journal, mutates a balance, executes referral rewards,
   * dispatches a notification, or executes any financial effect.
   */
  readonly compatibilityCheck: (
    request: B1ReferralRequestV1 | B1CashbackRequestV1 | B1LoyaltyEarningRequestV1,
  ) => Promise<B1ReferralEngineCompatibilityResultV1>;
}
