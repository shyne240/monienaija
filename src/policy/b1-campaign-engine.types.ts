/**
 * B1T06 — B1 campaign engine, promotion engine, and coupon engine
 * types.
 *
 * The B1 campaign engine, promotion engine, and coupon engine is
 * the runtime commercial-incentive engine implementation for the
 * B1 first commercial scope (`commercial.virtual-account.inbound-
 * funding` v1) established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1
 * campaign engine, promotion engine, and coupon engine consumes
 * the B1 commercial catalog (B1T03), the B1 commercial decision
 * (B1T04), the B1 billing engine, invoice engine, and statement-
 * generation engine (B1T05) outputs, the A4 product-policy
 * decision, the A3 binding recheck, the A5 Ledger account state,
 * the A6 partner state, and the A7 product state through
 * approved read-only consumer boundaries.
 *
 * The B1 campaign engine, promotion engine, and coupon engine is
 * the only B1 commercial-incentive engine for campaigns,
 * promotions, and coupons. The B1 campaign engine, promotion
 * engine, and coupon engine is a read-only contract against the
 * existing A1 canonical identity, A2 authorization, A3 binding,
 * A4 policy decision, A5 Ledger, A6 partner-adapter, A6T05
 * external-operation, A6T08 settlement / suspense / compensating,
 * A6T09 external reconciliation, A6T10 data classification, A7
 * product catalog, A7 product-policy profile, A7T04 product
 * customer-binding, A7T05 product command, A7T06 product
 * notification, A7T07 product lifecycle, A7T08 product financial
 * effect, A7T09 product reconciliation, A7T10 product data
 * minimization, `CustomerPreference`, Wallet, Operations, Outbox,
 * Idempotency, Metrics, Diagnostics, Reconciliation, and
 * `CustomerPreference` authorities. The B1 campaign engine,
 * promotion engine, and coupon engine is a read-write contract
 * against the shared Operations `IdempotencyService`,
 * `AuditService`, `OutboxService`, and `MetricsService`.
 *
 * The B1 campaign engine, promotion engine, and coupon engine
 * NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    creates financial effects, repairs a binding, changes A4
 *    policy / source records, or dispatches a notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - modifies invoices, statements, commercial decisions, pricing
 *    catalogs, product state, policy, customer bindings, or
 *    customer preferences;
 *  - dispatches notifications, communicates with external
 *    partners, or executes financial effects.
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
 * by B1T06.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineContractName = 'B1-CAMPAIGN-ENGINE';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineContractVersion = 1;

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * decision kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineDecisionKind = 'CAMPAIGN' | 'PROMOTION' | 'COUPON';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * decision outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineDecisionOutcome = 'ELIGIBLE' | 'APPLIED' | 'REJECTED' | 'REPLAYED';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * campaign state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignState = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'RETIRED';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * promotion state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1PromotionState = 'CREATED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * coupon state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CouponState = 'CREATED' | 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * document kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignDocumentKind =
  | 'CAMPAIGN'
  | 'CAMPAIGN_RULE'
  | 'PROMOTION'
  | 'PROMOTION_RULE'
  | 'COUPON'
  | 'COUPON_REDEMPTION'
  | 'CAMPAIGN_PERIOD'
  | 'PROMOTION_PERIOD'
  | 'COUPON_PERIOD';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * document version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignDocumentVersion = 1;

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineScopeKey = 'commercial.virtual-account.inbound-funding';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineScopeVersion = 1;

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineCurrency = 'NGN';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEnginePeriodKey =
  'commercial.virtual-account.inbound-funding.campaign-period.per-flow.v1';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * period version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEnginePeriodVersion = 1;

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * decision priority vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEnginePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * stacking rule vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineStackingRule = 'STACKABLE' | 'EXCLUSIVE' | 'OVERRIDABLE';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineFailureCodeV1 =
  | 'B1_CAMPAIGN_ENGINE_INVALID_COMMAND'
  | 'B1_CAMPAIGN_ENGINE_INCOMPATIBLE'
  | 'B1_CAMPAIGN_ENGINE_QUERY_UNAVAILABLE'
  | 'B1_CAMPAIGN_ENGINE_PROHIBITED'
  | 'B1_CAMPAIGN_ENGINE_DECISION_NOT_FOUND'
  | 'B1_CAMPAIGN_ENGINE_DECISION_INCOMPATIBLE'
  | 'B1_CAMPAIGN_ENGINE_CATALOG_INCOMPATIBLE'
  | 'B1_CAMPAIGN_ENGINE_CATALOG_MISSING'
  | 'B1_CAMPAIGN_ENGINE_BILLING_DOCUMENT_NOT_FOUND'
  | 'B1_CAMPAIGN_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE'
  | 'B1_CAMPAIGN_ENGINE_A4_POLICY_DENIED'
  | 'B1_CAMPAIGN_ENGINE_A3_BINDING_INVALID'
  | 'B1_CAMPAIGN_ENGINE_A5_LEDGER_INVARIANT_BROKEN'
  | 'B1_CAMPAIGN_ENGINE_A6_PARTNER_INCOMPATIBLE'
  | 'B1_CAMPAIGN_ENGINE_A7_PRODUCT_INCOMPATIBLE'
  | 'B1_CAMPAIGN_ENGINE_REPLAY_CONFLICT'
  | 'B1_CAMPAIGN_ENGINE_REPLAY_EXPIRED'
  | 'B1_CAMPAIGN_ENGINE_IN_PROGRESS'
  | 'B1_CAMPAIGN_ENGINE_NUMBER_CONFLICT'
  | 'B1_CAMPAIGN_ENGINE_EXPIRED'
  | 'B1_CAMPAIGN_ENGINE_USAGE_LIMIT_EXCEEDED'
  | 'B1_CAMPAIGN_ENGINE_NOT_APPLICABLE';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * decision eligibility vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineEligibility =
  | 'CUSTOMER_ELIGIBLE'
  | 'MERCHANT_ELIGIBLE'
  | 'PARTNER_ELIGIBLE'
  | 'PRODUCT_ELIGIBLE'
  | 'TIER_ELIGIBLE'
  | 'PERIOD_ELIGIBLE'
  | 'USAGE_LIMIT_ELIGIBLE';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * rule kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignRuleKindV1 =
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
  | 'B1_CAMPAIGN_ENGINE_CUSTOMER_ELIGIBILITY'
  | 'B1_CAMPAIGN_ENGINE_MERCHANT_ELIGIBILITY'
  | 'B1_CAMPAIGN_ENGINE_PARTNER_ELIGIBILITY'
  | 'B1_CAMPAIGN_ENGINE_PRODUCT_ELIGIBILITY'
  | 'B1_CAMPAIGN_ENGINE_ACTIVATION_RULES'
  | 'B1_CAMPAIGN_ENGINE_PRIORITY'
  | 'B1_CAMPAIGN_ENGINE_STACKING_RULES'
  | 'B1_CAMPAIGN_ENGINE_EXCLUSIVITY_RULES'
  | 'B1_CAMPAIGN_ENGINE_EXPIRATION'
  | 'B1_CAMPAIGN_ENGINE_USAGE_LIMITS'
  | 'B1_CAMPAIGN_ENGINE_REPLAY_ELIGIBILITY'
  | 'B1_CAMPAIGN_ENGINE_NUMBER_DETERMINISTIC'
  | 'B1_CAMPAIGN_ENGINE_DOCUMENT_VERSION';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * rule outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignRuleOutcomeV1 = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * campaign decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignDecisionV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly campaignDecisionId: string;
  readonly campaignDecisionReference: string;
  readonly campaignDecisionVersion: B1CampaignDocumentVersion;
  readonly campaignDecisionState: B1CampaignState;
  readonly campaignDecisionOutcome: B1CampaignEngineDecisionOutcome;
  readonly campaignDecisionHash: string;
  readonly campaignDecisionReplayHash: string;
  readonly campaignRequestHash: string;
  readonly scopeKey: B1CampaignEngineScopeKey;
  readonly scopeVersion: B1CampaignEngineScopeVersion;
  readonly periodKey: B1CampaignEnginePeriodKey;
  readonly periodVersion: B1CampaignEnginePeriodVersion;
  readonly campaignKey: string;
  readonly campaignVersion: 1;
  readonly campaignName: string;
  readonly campaignDescription: string;
  readonly campaignPriority: B1CampaignEnginePriority;
  readonly campaignStackingRule: B1CampaignEngineStackingRule;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.campaign'
    | 'commercial.virtual-account.inbound-funding.promotion'
    | 'commercial.virtual-account.inbound-funding.coupon';
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
  readonly campaignStartAt: string;
  readonly campaignEndAt: string;
  readonly campaignEffectiveAt: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerCampaign: number;
  readonly usageLimitRemaining: number;
  readonly eligibilitySummary: readonly B1CampaignEngineEligibility[];
  readonly campaignEligible: boolean;
  readonly campaignApplicable: boolean;
  readonly campaignExclusivityConflicts: readonly string[];
  readonly campaignStackingConflicts: readonly string[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly explanationTrace: B1CampaignExplanationTraceV1;
  readonly ruleTrace: B1CampaignRuleTraceV1;
  readonly auditEvidence: B1CampaignAuditEvidenceV1;
  readonly idempotencyScope: 'b1.campaign-engine.campaign.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CampaignEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * promotion decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1PromotionDecisionV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly promotionDecisionId: string;
  readonly promotionDecisionReference: string;
  readonly promotionDecisionVersion: B1CampaignDocumentVersion;
  readonly promotionDecisionState: B1PromotionState;
  readonly promotionDecisionOutcome: B1CampaignEngineDecisionOutcome;
  readonly promotionDecisionHash: string;
  readonly promotionDecisionReplayHash: string;
  readonly promotionRequestHash: string;
  readonly scopeKey: B1CampaignEngineScopeKey;
  readonly scopeVersion: B1CampaignEngineScopeVersion;
  readonly periodKey: B1CampaignEnginePeriodKey;
  readonly periodVersion: B1CampaignEnginePeriodVersion;
  readonly promotionKey: string;
  readonly promotionVersion: 1;
  readonly promotionName: string;
  readonly promotionDescription: string;
  readonly promotionPriority: B1CampaignEnginePriority;
  readonly promotionStackingRule: B1CampaignEngineStackingRule;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.campaign'
    | 'commercial.virtual-account.inbound-funding.promotion'
    | 'commercial.virtual-account.inbound-funding.coupon';
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
  readonly promotionStartAt: string;
  readonly promotionEndAt: string;
  readonly promotionEffectiveAt: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerPromotion: number;
  readonly usageLimitRemaining: number;
  readonly eligibilitySummary: readonly B1CampaignEngineEligibility[];
  readonly promotionEligible: boolean;
  readonly promotionApplicable: boolean;
  readonly promotionExclusivityConflicts: readonly string[];
  readonly promotionStackingConflicts: readonly string[];
  readonly campaignDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly explanationTrace: B1CampaignExplanationTraceV1;
  readonly ruleTrace: B1CampaignRuleTraceV1;
  readonly auditEvidence: B1CampaignAuditEvidenceV1;
  readonly idempotencyScope: 'b1.campaign-engine.promotion.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CampaignEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * coupon decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CouponDecisionV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly couponDecisionId: string;
  readonly couponDecisionReference: string;
  readonly couponDecisionVersion: B1CampaignDocumentVersion;
  readonly couponDecisionState: B1CouponState;
  readonly couponDecisionOutcome: B1CampaignEngineDecisionOutcome;
  readonly couponDecisionHash: string;
  readonly couponDecisionReplayHash: string;
  readonly couponRequestHash: string;
  readonly scopeKey: B1CampaignEngineScopeKey;
  readonly scopeVersion: B1CampaignEngineScopeVersion;
  readonly periodKey: B1CampaignEnginePeriodKey;
  readonly periodVersion: B1CampaignEnginePeriodVersion;
  readonly couponCode: string;
  readonly couponKey: string;
  readonly couponVersion: 1;
  readonly couponName: string;
  readonly couponDescription: string;
  readonly couponPriority: B1CampaignEnginePriority;
  readonly couponStackingRule: B1CampaignEngineStackingRule;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.campaign'
    | 'commercial.virtual-account.inbound-funding.promotion'
    | 'commercial.virtual-account.inbound-funding.coupon';
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
  readonly couponStartAt: string;
  readonly couponEndAt: string;
  readonly couponEffectiveAt: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerCoupon: number;
  readonly usageLimitRemaining: number;
  readonly eligibilitySummary: readonly B1CampaignEngineEligibility[];
  readonly couponEligible: boolean;
  readonly couponApplicable: boolean;
  readonly couponExclusivityConflicts: readonly string[];
  readonly couponStackingConflicts: readonly string[];
  readonly promotionDecisionReference: string;
  readonly campaignDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly explanationTrace: B1CampaignExplanationTraceV1;
  readonly ruleTrace: B1CampaignRuleTraceV1;
  readonly auditEvidence: B1CampaignAuditEvidenceV1;
  readonly idempotencyScope: 'b1.campaign-engine.coupon.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CampaignEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * audit evidence (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignAuditEvidenceV1 {
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
 * The B1 campaign engine, promotion engine, and coupon engine
 * explanation trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignExplanationTraceV1 {
  readonly traceId: string;
  readonly traceKind:
    | 'CAMPAIGN_DECISION'
    | 'PROMOTION_DECISION'
    | 'COUPON_DECISION'
    | 'CAMPAIGN_ENGINE_COMPOSITE_DECISION';
  readonly traceSummary: string;
  readonly traceSteps: readonly B1CampaignExplanationStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * explanation step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignExplanationStepV1 {
  readonly stepIndex: number;
  readonly stepKind: B1CampaignRuleKindV1;
  readonly stepLabel: string;
  readonly stepOutcome: B1CampaignRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepReason: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
  readonly stepOutputs: Readonly<Record<string, unknown>>;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * rule trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignRuleTraceV1 {
  readonly ruleTraceId: string;
  readonly ruleTraceSteps: readonly B1CampaignRuleTraceStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * rule trace step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignRuleTraceStepV1 {
  readonly stepIndex: number;
  readonly ruleKind: B1CampaignRuleKindV1;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly ruleOutcome: B1CampaignRuleOutcomeV1;
  readonly ruleReasonCode: string;
  readonly ruleEvaluatedAt: string;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * decision failure (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignEngineFailureV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly code: B1CampaignEngineFailureCodeV1;
  readonly message: string;
  readonly failedRules: readonly B1CampaignRuleTraceStepV1[];
  readonly failedInputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestId: string;
  readonly generatedAt: string;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * campaign request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignRequestV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly campaignRequestId: string;
  readonly campaignRequestVersion: B1CampaignDocumentVersion;
  readonly scopeKey: B1CampaignEngineScopeKey;
  readonly scopeVersion: B1CampaignEngineScopeVersion;
  readonly expectedCurrency: B1CampaignEngineCurrency;
  readonly expectedAccountingUnit: B1CampaignEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.campaign'
    | 'commercial.virtual-account.inbound-funding.promotion'
    | 'commercial.virtual-account.inbound-funding.coupon';
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
  readonly periodKey: B1CampaignEnginePeriodKey;
  readonly periodVersion: B1CampaignEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly campaignKey: string;
  readonly campaignVersion: 1;
  readonly campaignStartAt: string;
  readonly campaignEndAt: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerCampaign: number;
  readonly campaignStackableRequest: boolean;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * promotion request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1PromotionRequestV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly promotionRequestId: string;
  readonly promotionRequestVersion: B1CampaignDocumentVersion;
  readonly scopeKey: B1CampaignEngineScopeKey;
  readonly scopeVersion: B1CampaignEngineScopeVersion;
  readonly expectedCurrency: B1CampaignEngineCurrency;
  readonly expectedAccountingUnit: B1CampaignEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.campaign'
    | 'commercial.virtual-account.inbound-funding.promotion'
    | 'commercial.virtual-account.inbound-funding.coupon';
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
  readonly periodKey: B1CampaignEnginePeriodKey;
  readonly periodVersion: B1CampaignEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly promotionKey: string;
  readonly promotionVersion: 1;
  readonly promotionStartAt: string;
  readonly promotionEndAt: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerPromotion: number;
  readonly promotionStackableRequest: boolean;
  readonly campaignDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * coupon request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CouponRequestV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly couponRequestId: string;
  readonly couponRequestVersion: B1CampaignDocumentVersion;
  readonly scopeKey: B1CampaignEngineScopeKey;
  readonly scopeVersion: B1CampaignEngineScopeVersion;
  readonly expectedCurrency: B1CampaignEngineCurrency;
  readonly expectedAccountingUnit: B1CampaignEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.campaign'
    | 'commercial.virtual-account.inbound-funding.promotion'
    | 'commercial.virtual-account.inbound-funding.coupon';
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
  readonly periodKey: B1CampaignEnginePeriodKey;
  readonly periodVersion: B1CampaignEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly couponCode: string;
  readonly couponKey: string;
  readonly couponVersion: 1;
  readonly couponStartAt: string;
  readonly couponEndAt: string;
  readonly usageLimitPerCustomer: number;
  readonly usageLimitPerCoupon: number;
  readonly couponStackableRequest: boolean;
  readonly promotionDecisionReference: string;
  readonly campaignDecisionReference: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * campaign replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignDecisionReplaySafeResultV1 {
  readonly record: B1CampaignDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.campaign-engine.campaign.idempotency.v1';
  readonly idempotencyKey: string;
  readonly campaignRequestHash: string;
  readonly campaignDecisionHash: string;
  readonly campaignDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * promotion replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1PromotionDecisionReplaySafeResultV1 {
  readonly record: B1PromotionDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.campaign-engine.promotion.idempotency.v1';
  readonly idempotencyKey: string;
  readonly promotionRequestHash: string;
  readonly promotionDecisionHash: string;
  readonly promotionDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * coupon replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CouponDecisionReplaySafeResultV1 {
  readonly record: B1CouponDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.campaign-engine.coupon.idempotency.v1';
  readonly idempotencyKey: string;
  readonly couponRequestHash: string;
  readonly couponDecisionHash: string;
  readonly couponDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * compatibility result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export type B1CampaignEngineCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1CampaignEngineFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * document versioning contract (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignDocumentVersioningContractV1 {
  readonly contractName: B1CampaignEngineContractName;
  readonly contractVersion: B1CampaignEngineContractVersion;
  readonly documentVersion: B1CampaignDocumentVersion;
  readonly scopeKey: B1CampaignEngineScopeKey;
  readonly scopeVersion: B1CampaignEngineScopeVersion;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByDocumentReference: string | null;
  readonly supersedesDocumentReference: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * document persistence record (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignDocumentPersistenceRecordV1 {
  readonly documentId: string;
  readonly documentReference: string;
  readonly documentVersion: B1CampaignDocumentVersion;
  readonly documentKind: B1CampaignDocumentKind;
  readonly documentHash: string;
  readonly documentReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly record: B1CampaignDecisionV1 | B1PromotionDecisionV1 | B1CouponDecisionV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 campaign engine, promotion engine, and coupon engine
 * read-only consumer ports (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
 */
export interface B1CampaignEngineConsumerPortsV1 {
  /**
   * B1 campaign decision generate. Returns the canonical B1
   * campaign decision for the supplied B1 campaign request. The
   * generate is read-only; the B1 campaign engine never posts a
   * journal, mutates a balance, executes cashback, executes
   * rewards, dispatches a notification, or executes any financial
   * effect.
   */
  readonly generateCampaignDecision: (
    request: B1CampaignRequestV1,
  ) => Promise<B1CampaignDecisionV1>;

  /**
   * B1 campaign decision replay-safe generate. Returns the
   * canonical B1 campaign decision replay-safe result for the
   * supplied B1 campaign request. The replay-safe generate is
   * read-only; the B1 campaign engine never posts a journal,
   * mutates a balance, executes cashback, executes rewards,
   * dispatches a notification, or executes any financial effect.
   */
  readonly replaySafeGenerateCampaignDecision: (
    request: B1CampaignRequestV1,
  ) => Promise<B1CampaignDecisionReplaySafeResultV1>;

  /**
   * B1 promotion decision generate. Returns the canonical B1
   * promotion decision for the supplied B1 promotion request. The
   * generate is read-only; the B1 promotion engine never posts a
   * journal, mutates a balance, executes cashback, executes
   * rewards, dispatches a notification, or executes any financial
   * effect.
   */
  readonly generatePromotionDecision: (
    request: B1PromotionRequestV1,
  ) => Promise<B1PromotionDecisionV1>;

  /**
   * B1 promotion decision replay-safe generate. Returns the
   * canonical B1 promotion decision replay-safe result for the
   * supplied B1 promotion request. The replay-safe generate is
   * read-only; the B1 promotion engine never posts a journal,
   * mutates a balance, executes cashback, executes rewards,
   * dispatches a notification, or executes any financial effect.
   */
  readonly replaySafeGeneratePromotionDecision: (
    request: B1PromotionRequestV1,
  ) => Promise<B1PromotionDecisionReplaySafeResultV1>;

  /**
   * B1 coupon decision generate. Returns the canonical B1 coupon
   * decision for the supplied B1 coupon request. The generate is
   * read-only; the B1 coupon engine never posts a journal,
   * mutates a balance, executes cashback, executes rewards,
   * dispatches a notification, or executes any financial effect.
   */
  readonly generateCouponDecision: (request: B1CouponRequestV1) => Promise<B1CouponDecisionV1>;

  /**
   * B1 coupon decision replay-safe generate. Returns the
   * canonical B1 coupon decision replay-safe result for the
   * supplied B1 coupon request. The replay-safe generate is
   * read-only; the B1 coupon engine never posts a journal,
   * mutates a balance, executes cashback, executes rewards,
   * dispatches a notification, or executes any financial effect.
   */
  readonly replaySafeGenerateCouponDecision: (
    request: B1CouponRequestV1,
  ) => Promise<B1CouponDecisionReplaySafeResultV1>;

  /**
   * B1 campaign engine compatibility check. Returns the canonical
   * B1 campaign engine compatibility result for the supplied B1
   * campaign / promotion / coupon request. The compatibility
   * check is read-only; the B1 campaign engine never posts a
   * journal, mutates a balance, executes cashback, executes
   * rewards, dispatches a notification, or executes any financial
   * effect.
   */
  readonly compatibilityCheck: (
    request: B1CampaignRequestV1 | B1PromotionRequestV1 | B1CouponRequestV1,
  ) => Promise<B1CampaignEngineCompatibilityResultV1>;
}
