/**
 * B1T08 — B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine types.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine is the runtime commercial-financial-
 * recognition engine implementation for the B1 first commercial
 * scope (`commercial.virtual-account.inbound-funding` v1)
 * established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1
 * revenue-recognition engine, tax / VAT engine, and cost-
 * accounting engine consumes the B1 commercial catalog (B1T03),
 * the B1 commercial decision (B1T04), the B1 billing engine,
 * invoice engine, and statement-generation engine (B1T05)
 * outputs, the B1 campaign engine, promotion engine, and coupon
 * engine (B1T06) decisions, the B1 referral engine, cashback
 * engine, and loyalty engine (B1T07) decisions, the A4 product-
 * policy decision, the A3 binding recheck, the A5 Ledger account
 * state, the A6 partner state, and the A7 product state through
 * approved read-only consumer boundaries.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine is the only B1 commercial-financial-
 * recognition engine for revenue recognition, tax / VAT, and
 * cost accounting. The B1 revenue-recognition engine, tax / VAT
 * engine, and cost-accounting engine is a read-only contract
 * against the existing A1 canonical identity, A2 authorization,
 * A3 binding, A4 policy decision, A5 Ledger, A6 partner-adapter,
 * A6T05 external-operation, A6T08 settlement / suspense /
 * compensating, A6T09 external reconciliation, A6T10 data
 * classification, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding, A7T05 product command, A7T06
 * product notification, A7T07 product lifecycle, A7T08 product
 * financial effect, A7T09 product reconciliation, A7T10 product
 * data minimization, `CustomerPreference`, Wallet, Operations,
 * Outbox, Idempotency, Metrics, Diagnostics, Reconciliation, and
 * `CustomerPreference` authorities. The B1 revenue-recognition
 * engine, tax / VAT engine, and cost-accounting engine is a
 * read-write contract against the shared Operations
 * `IdempotencyService`, `AuditService`, `OutboxService`, and
 * `MetricsService`.
 *
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    redeems cashback, awards loyalty balances, redeems loyalty
 *    balances, executes referral rewards, creates financial
 *    effects, repairs a binding, changes A4 policy / source
 *    records, or dispatches a notification;
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
 * by B1T08.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineContractName = 'B1-REVENUE-RECOGNITION-ENGINE';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineContractVersion = 1;

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine decision kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineDecisionKind =
  | 'REVENUE_RECOGNITION'
  | 'TAX_VAT'
  | 'COST_ACCOUNTING';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine decision outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineDecisionOutcome =
  | 'ELIGIBLE'
  | 'APPLIED'
  | 'REJECTED'
  | 'REPLAYED';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine revenue-recognition state vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionState =
  | 'DRAFT'
  | 'PENDING'
  | 'RECOGNIZED'
  | 'DEFERRED'
  | 'CANCELLED'
  | 'RETIRED';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine tax / VAT state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1TaxVatState =
  | 'DRAFT'
  | 'PENDING'
  | 'ASSESSED'
  | 'EXEMPTED'
  | 'DECLARED'
  | 'CANCELLED'
  | 'RETIRED';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine cost-accounting state vocabulary (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1CostAccountingState =
  | 'DRAFT'
  | 'PENDING'
  | 'ALLOCATED'
  | 'RECOGNIZED'
  | 'AMORTIZED'
  | 'CANCELLED'
  | 'RETIRED';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine document kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionDocumentKind =
  | 'REVENUE_RECOGNITION'
  | 'REVENUE_RECOGNITION_POLICY'
  | 'REVENUE_RECOGNITION_SCHEDULE'
  | 'REVENUE_RECOGNITION_EVENT'
  | 'DEFERRED_REVENUE'
  | 'RECOGNIZED_REVENUE'
  | 'TAX_VAT'
  | 'TAX_VAT_POLICY'
  | 'TAX_JURISDICTION'
  | 'TAX_CATEGORY'
  | 'TAX_EXEMPTION'
  | 'TAX_DECISION'
  | 'TAX_EVIDENCE'
  | 'COST_ACCOUNTING'
  | 'COST_ACCOUNTING_POLICY'
  | 'DIRECT_COST'
  | 'INDIRECT_COST'
  | 'ACQUISITION_COST'
  | 'OPERATIONAL_COST'
  | 'ALLOCATED_COST'
  | 'COST_CATEGORY'
  | 'COST_DECISION';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine document version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionDocumentVersion = 1;

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineScopeKey = 'commercial.virtual-account.inbound-funding';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineScopeVersion = 1;

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineCurrency = 'NGN';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine accounting basis vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineAccountingBasis =
  | 'CASH_BASIS'
  | 'ACCRUAL_BASIS'
  | 'MODIFIED_ACCRUAL_BASIS'
  | 'REVENUE_RECOGNITION_BASIS';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEnginePeriodKey =
  'commercial.virtual-account.inbound-funding.revenue-recognition-period.per-flow.v1';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine period version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEnginePeriodVersion = 1;

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine recognition method vocabulary (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionMethod =
  | 'POINT_IN_TIME'
  | 'OVER_TIME'
  | 'MILESTONE_BASED'
  | 'PERCENTAGE_OF_COMPLETION'
  | 'INSTALLMENT'
  | 'DEFERRED';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine tax category vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionTaxCategory =
  | 'VAT'
  | 'SALES_TAX'
  | 'WITHHOLDING_TAX'
  | 'SERVICE_TAX'
  | 'EXCISE_TAX'
  | 'EXEMPT'
  | 'ZERO_RATED'
  | 'OUT_OF_SCOPE';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine cost category vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionCostCategory =
  | 'DIRECT_COST'
  | 'INDIRECT_COST'
  | 'ACQUISITION_COST'
  | 'OPERATIONAL_COST'
  | 'ALLOCATED_COST'
  | 'OVERHEAD_COST'
  | 'SUPPORT_COST'
  | 'CAPITALIZED_COST';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine tax jurisdiction vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionTaxJurisdiction =
  | 'NIGERIA_FEDERAL'
  | 'NIGERIA_STATE'
  | 'NIGERIA_LGA'
  | 'WEST_AFRICA_REGION'
  | 'AFRICA_REGION'
  | 'GLOBAL';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine cost allocation method vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionCostAllocationMethod =
  | 'DIRECT_ALLOCATION'
  | 'STEP_ALLOCATION'
  | 'RECIPROCAL_ALLOCATION'
  | 'PROPORTIONAL_ALLOCATION'
  | 'ACTIVITY_BASED_COSTING'
  | 'STANDARD_COSTING';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineFailureCodeV1 =
  | 'B1_REVENUE_RECOGNITION_ENGINE_INVALID_COMMAND'
  | 'B1_REVENUE_RECOGNITION_ENGINE_INCOMPATIBLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_QUERY_UNAVAILABLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_PROHIBITED'
  | 'B1_REVENUE_RECOGNITION_ENGINE_DECISION_NOT_FOUND'
  | 'B1_REVENUE_RECOGNITION_ENGINE_DECISION_INCOMPATIBLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_CATALOG_INCOMPATIBLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_CATALOG_MISSING'
  | 'B1_REVENUE_RECOGNITION_ENGINE_BILLING_DOCUMENT_NOT_FOUND'
  | 'B1_REVENUE_RECOGNITION_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_A4_POLICY_DENIED'
  | 'B1_REVENUE_RECOGNITION_ENGINE_A3_BINDING_INVALID'
  | 'B1_REVENUE_RECOGNITION_ENGINE_A5_LEDGER_INVARIANT_BROKEN'
  | 'B1_REVENUE_RECOGNITION_ENGINE_A6_PARTNER_INCOMPATIBLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_A7_PRODUCT_INCOMPATIBLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_REPLAY_CONFLICT'
  | 'B1_REVENUE_RECOGNITION_ENGINE_REPLAY_EXPIRED'
  | 'B1_REVENUE_RECOGNITION_ENGINE_IN_PROGRESS'
  | 'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_CONFLICT'
  | 'B1_REVENUE_RECOGNITION_ENGINE_EXPIRED'
  | 'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_BASIS_INVALID'
  | 'B1_REVENUE_RECOGNITION_ENGINE_NOT_APPLICABLE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_POLICY_MISSING'
  | 'B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTION_INVALID'
  | 'B1_REVENUE_RECOGNITION_ENGINE_COST_ALLOCATION_INVALID'
  | 'B1_REVENUE_RECOGNITION_ENGINE_DEFERRED_REVENUE_INVALID';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine decision eligibility vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineEligibility =
  | 'CUSTOMER_ELIGIBLE'
  | 'MERCHANT_ELIGIBLE'
  | 'PARTNER_ELIGIBLE'
  | 'PRODUCT_ELIGIBLE'
  | 'TIER_ELIGIBLE'
  | 'PERIOD_ELIGIBLE'
  | 'RECOGNITION_BASIS_ELIGIBLE'
  | 'TAX_POLICY_ELIGIBLE'
  | 'COST_ALLOCATION_ELIGIBLE';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine rule kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionRuleKindV1 =
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
  | 'B1_REFERRAL_DECISION_LOOKUP'
  | 'B1_REFERRAL_DECISION_COMPATIBILITY'
  | 'B1_REFERRAL_DECISION_REPLAY'
  | 'B1_CASHBACK_DECISION_LOOKUP'
  | 'B1_CASHBACK_DECISION_COMPATIBILITY'
  | 'B1_CASHBACK_DECISION_REPLAY'
  | 'B1_LOYALTY_DECISION_LOOKUP'
  | 'B1_LOYALTY_DECISION_COMPATIBILITY'
  | 'B1_LOYALTY_DECISION_REPLAY'
  | 'B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_POLICY'
  | 'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_SCHEDULE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_EVENT'
  | 'B1_REVENUE_RECOGNITION_ENGINE_RECOGNITION_BASIS'
  | 'B1_REVENUE_RECOGNITION_ENGINE_DEFERRED_REVENUE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_RECOGNIZED_REVENUE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_POLICY'
  | 'B1_REVENUE_RECOGNITION_ENGINE_TAX_JURISDICTION'
  | 'B1_REVENUE_RECOGNITION_ENGINE_TAX_CATEGORY'
  | 'B1_REVENUE_RECOGNITION_ENGINE_TAX_EXEMPTION'
  | 'B1_REVENUE_RECOGNITION_ENGINE_TAX_DECISION'
  | 'B1_REVENUE_RECOGNITION_ENGINE_TAX_EVIDENCE'
  | 'B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_POLICY'
  | 'B1_REVENUE_RECOGNITION_ENGINE_DIRECT_COST'
  | 'B1_REVENUE_RECOGNITION_ENGINE_INDIRECT_COST'
  | 'B1_REVENUE_RECOGNITION_ENGINE_ACQUISITION_COST'
  | 'B1_REVENUE_RECOGNITION_ENGINE_OPERATIONAL_COST'
  | 'B1_REVENUE_RECOGNITION_ENGINE_ALLOCATED_COST'
  | 'B1_REVENUE_RECOGNITION_ENGINE_COST_CATEGORY'
  | 'B1_REVENUE_RECOGNITION_ENGINE_COST_DECISION'
  | 'B1_REVENUE_RECOGNITION_ENGINE_NUMBER_DETERMINISTIC'
  | 'B1_REVENUE_RECOGNITION_ENGINE_DOCUMENT_VERSION';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine rule outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionRuleOutcomeV1 = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine revenue-recognition decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionDecisionV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly revenueRecognitionDecisionId: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly revenueRecognitionDecisionVersion: B1RevenueRecognitionDocumentVersion;
  readonly revenueRecognitionDecisionState: B1RevenueRecognitionState;
  readonly revenueRecognitionDecisionOutcome: B1RevenueRecognitionEngineDecisionOutcome;
  readonly revenueRecognitionDecisionHash: string;
  readonly revenueRecognitionDecisionReplayHash: string;
  readonly revenueRecognitionRequestHash: string;
  readonly scopeKey: B1RevenueRecognitionEngineScopeKey;
  readonly scopeVersion: B1RevenueRecognitionEngineScopeVersion;
  readonly periodKey: B1RevenueRecognitionEnginePeriodKey;
  readonly periodVersion: B1RevenueRecognitionEnginePeriodVersion;
  readonly accountingBasis: B1RevenueRecognitionEngineAccountingBasis;
  readonly accountingUnit: B1RevenueRecognitionEngineAccountingUnit;
  readonly recognitionPolicyReference: string;
  readonly recognitionPolicyVersion: 1;
  readonly recognitionScheduleReference: string;
  readonly recognitionScheduleVersion: 1;
  readonly recognitionMethod: B1RevenueRecognitionMethod;
  readonly deferredRevenueAmount: string;
  readonly recognizedRevenueAmount: string;
  readonly recognitionEventReference: string;
  readonly recognitionEventVersion: 1;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.revenue-recognition'
    | 'commercial.virtual-account.inbound-funding.tax-vat'
    | 'commercial.virtual-account.inbound-funding.cost-accounting';
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
  readonly revenueRecognitionStartAt: string;
  readonly revenueRecognitionEndAt: string;
  readonly revenueRecognitionEffectiveAt: string;
  readonly eligibilitySummary: readonly B1RevenueRecognitionEngineEligibility[];
  readonly revenueRecognitionEligible: boolean;
  readonly revenueRecognitionApplicable: boolean;
  readonly revenueRecognitionScheduleConflicts: readonly string[];
  readonly revenueRecognitionPolicyConflicts: readonly string[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly explanationTrace: B1RevenueRecognitionExplanationTraceV1;
  readonly ruleTrace: B1RevenueRecognitionRuleTraceV1;
  readonly recognitionTrace: B1RevenueRecognitionRecognitionTraceV1;
  readonly auditEvidence: B1RevenueRecognitionAuditEvidenceV1;
  readonly idempotencyScope: 'b1.revenue-recognition-engine.revenue-recognition.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1RevenueRecognitionEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine tax / VAT decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1TaxVatDecisionV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly taxVatDecisionId: string;
  readonly taxVatDecisionReference: string;
  readonly taxVatDecisionVersion: B1RevenueRecognitionDocumentVersion;
  readonly taxVatDecisionState: B1TaxVatState;
  readonly taxVatDecisionOutcome: B1RevenueRecognitionEngineDecisionOutcome;
  readonly taxVatDecisionHash: string;
  readonly taxVatDecisionReplayHash: string;
  readonly taxVatRequestHash: string;
  readonly scopeKey: B1RevenueRecognitionEngineScopeKey;
  readonly scopeVersion: B1RevenueRecognitionEngineScopeVersion;
  readonly periodKey: B1RevenueRecognitionEnginePeriodKey;
  readonly periodVersion: B1RevenueRecognitionEnginePeriodVersion;
  readonly accountingBasis: B1RevenueRecognitionEngineAccountingBasis;
  readonly accountingUnit: B1RevenueRecognitionEngineAccountingUnit;
  readonly taxJurisdiction: B1RevenueRecognitionTaxJurisdiction;
  readonly taxCategory: B1RevenueRecognitionTaxCategory;
  readonly taxExemptionStatus: 'EXEMPT' | 'PARTIAL_EXEMPT' | 'NOT_EXEMPT';
  readonly taxExemptionReference: string;
  readonly taxExemptionVersion: 1;
  readonly taxBaseAmount: string;
  readonly taxRate: string;
  readonly taxAmount: string;
  readonly taxVatPolicyReference: string;
  readonly taxVatPolicyVersion: 1;
  readonly taxEvidenceReference: string;
  readonly taxEvidenceVersion: 1;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.revenue-recognition'
    | 'commercial.virtual-account.inbound-funding.tax-vat'
    | 'commercial.virtual-account.inbound-funding.cost-accounting';
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
  readonly taxVatStartAt: string;
  readonly taxVatEndAt: string;
  readonly taxVatEffectiveAt: string;
  readonly eligibilitySummary: readonly B1RevenueRecognitionEngineEligibility[];
  readonly taxVatEligible: boolean;
  readonly taxVatApplicable: boolean;
  readonly taxJurisdictionConflicts: readonly string[];
  readonly taxExemptionConflicts: readonly string[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly explanationTrace: B1RevenueRecognitionExplanationTraceV1;
  readonly ruleTrace: B1RevenueRecognitionRuleTraceV1;
  readonly recognitionTrace: B1RevenueRecognitionRecognitionTraceV1;
  readonly auditEvidence: B1RevenueRecognitionAuditEvidenceV1;
  readonly idempotencyScope: 'b1.revenue-recognition-engine.tax-vat.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1RevenueRecognitionEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine cost-accounting decision (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1CostAccountingDecisionV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly costAccountingDecisionId: string;
  readonly costAccountingDecisionReference: string;
  readonly costAccountingDecisionVersion: B1RevenueRecognitionDocumentVersion;
  readonly costAccountingDecisionState: B1CostAccountingState;
  readonly costAccountingDecisionOutcome: B1RevenueRecognitionEngineDecisionOutcome;
  readonly costAccountingDecisionHash: string;
  readonly costAccountingDecisionReplayHash: string;
  readonly costAccountingRequestHash: string;
  readonly scopeKey: B1RevenueRecognitionEngineScopeKey;
  readonly scopeVersion: B1RevenueRecognitionEngineScopeVersion;
  readonly periodKey: B1RevenueRecognitionEnginePeriodKey;
  readonly periodVersion: B1RevenueRecognitionEnginePeriodVersion;
  readonly accountingBasis: B1RevenueRecognitionEngineAccountingBasis;
  readonly accountingUnit: B1RevenueRecognitionEngineAccountingUnit;
  readonly costCategory: B1RevenueRecognitionCostCategory;
  readonly costAllocationMethod: B1RevenueRecognitionCostAllocationMethod;
  readonly directCostAmount: string;
  readonly indirectCostAmount: string;
  readonly acquisitionCostAmount: string;
  readonly operationalCostAmount: string;
  readonly allocatedCostAmount: string;
  readonly totalCostAmount: string;
  readonly costAccountingPolicyReference: string;
  readonly costAccountingPolicyVersion: 1;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.revenue-recognition'
    | 'commercial.virtual-account.inbound-funding.tax-vat'
    | 'commercial.virtual-account.inbound-funding.cost-accounting';
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
  readonly costAccountingStartAt: string;
  readonly costAccountingEndAt: string;
  readonly costAccountingEffectiveAt: string;
  readonly eligibilitySummary: readonly B1RevenueRecognitionEngineEligibility[];
  readonly costAccountingEligible: boolean;
  readonly costAccountingApplicable: boolean;
  readonly costAllocationConflicts: readonly string[];
  readonly costCategoryConflicts: readonly string[];
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly explanationTrace: B1RevenueRecognitionExplanationTraceV1;
  readonly ruleTrace: B1RevenueRecognitionRuleTraceV1;
  readonly recognitionTrace: B1RevenueRecognitionRecognitionTraceV1;
  readonly auditEvidence: B1RevenueRecognitionAuditEvidenceV1;
  readonly idempotencyScope: 'b1.revenue-recognition-engine.cost-accounting.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1RevenueRecognitionEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine audit evidence (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionAuditEvidenceV1 {
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
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine explanation trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionExplanationTraceV1 {
  readonly traceId: string;
  readonly traceKind:
    | 'REVENUE_RECOGNITION_DECISION'
    | 'TAX_VAT_DECISION'
    | 'COST_ACCOUNTING_DECISION'
    | 'REVENUE_RECOGNITION_ENGINE_COMPOSITE_DECISION';
  readonly traceSummary: string;
  readonly traceSteps: readonly B1RevenueRecognitionExplanationStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine explanation step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionExplanationStepV1 {
  readonly stepIndex: number;
  readonly stepKind: B1RevenueRecognitionRuleKindV1;
  readonly stepLabel: string;
  readonly stepOutcome: B1RevenueRecognitionRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepReason: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
  readonly stepOutputs: Readonly<Record<string, unknown>>;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine rule trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionRuleTraceV1 {
  readonly ruleTraceId: string;
  readonly ruleTraceSteps: readonly B1RevenueRecognitionRuleTraceStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine rule trace step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionRuleTraceStepV1 {
  readonly stepIndex: number;
  readonly ruleKind: B1RevenueRecognitionRuleKindV1;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly ruleOutcome: B1RevenueRecognitionRuleOutcomeV1;
  readonly ruleReasonCode: string;
  readonly ruleEvaluatedAt: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine recognition trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionRecognitionTraceV1 {
  readonly recognitionTraceId: string;
  readonly recognitionMethod: B1RevenueRecognitionMethod;
  readonly recognitionSteps: readonly B1RevenueRecognitionRecognitionStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine recognition step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionRecognitionStepV1 {
  readonly stepIndex: number;
  readonly stepKind:
    | 'REVENUE_RECOGNITION'
    | 'DEFERRED_REVENUE'
    | 'RECOGNIZED_REVENUE'
    | 'TAX_VAT'
    | 'COST_ACCOUNTING'
    | 'RECOGNITION_EVENT'
    | 'RECOGNITION_SCHEDULE'
    | 'TAX_EVIDENCE'
    | 'COST_ALLOCATION';
  readonly stepReference: string;
  readonly stepLabel: string;
  readonly stepOutcome: B1RevenueRecognitionRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepAmount: string;
  readonly stepCurrency: B1RevenueRecognitionEngineCurrency;
  readonly stepEvaluatedAt: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine decision failure (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionEngineFailureV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly code: B1RevenueRecognitionEngineFailureCodeV1;
  readonly message: string;
  readonly failedRules: readonly B1RevenueRecognitionRuleTraceStepV1[];
  readonly failedInputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestId: string;
  readonly generatedAt: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine revenue-recognition request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionRequestV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly revenueRecognitionRequestId: string;
  readonly revenueRecognitionRequestVersion: B1RevenueRecognitionDocumentVersion;
  readonly scopeKey: B1RevenueRecognitionEngineScopeKey;
  readonly scopeVersion: B1RevenueRecognitionEngineScopeVersion;
  readonly expectedCurrency: B1RevenueRecognitionEngineCurrency;
  readonly expectedAccountingUnit: B1RevenueRecognitionEngineAccountingUnit;
  readonly accountingBasis: B1RevenueRecognitionEngineAccountingBasis;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.revenue-recognition'
    | 'commercial.virtual-account.inbound-funding.tax-vat'
    | 'commercial.virtual-account.inbound-funding.cost-accounting';
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
  readonly periodKey: B1RevenueRecognitionEnginePeriodKey;
  readonly periodVersion: B1RevenueRecognitionEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly recognitionPolicyReference: string;
  readonly recognitionPolicyVersion: 1;
  readonly recognitionScheduleReference: string;
  readonly recognitionScheduleVersion: 1;
  readonly recognitionMethod: B1RevenueRecognitionMethod;
  readonly recognitionEventReference: string;
  readonly recognitionEventVersion: 1;
  readonly deferredRevenueAmount: string;
  readonly recognizedRevenueAmount: string;
  readonly revenueRecognitionStartAt: string;
  readonly revenueRecognitionEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine tax / VAT request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1TaxVatRequestV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly taxVatRequestId: string;
  readonly taxVatRequestVersion: B1RevenueRecognitionDocumentVersion;
  readonly scopeKey: B1RevenueRecognitionEngineScopeKey;
  readonly scopeVersion: B1RevenueRecognitionEngineScopeVersion;
  readonly expectedCurrency: B1RevenueRecognitionEngineCurrency;
  readonly expectedAccountingUnit: B1RevenueRecognitionEngineAccountingUnit;
  readonly accountingBasis: B1RevenueRecognitionEngineAccountingBasis;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.revenue-recognition'
    | 'commercial.virtual-account.inbound-funding.tax-vat'
    | 'commercial.virtual-account.inbound-funding.cost-accounting';
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
  readonly periodKey: B1RevenueRecognitionEnginePeriodKey;
  readonly periodVersion: B1RevenueRecognitionEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly taxJurisdiction: B1RevenueRecognitionTaxJurisdiction;
  readonly taxCategory: B1RevenueRecognitionTaxCategory;
  readonly taxExemptionStatus: 'EXEMPT' | 'PARTIAL_EXEMPT' | 'NOT_EXEMPT';
  readonly taxExemptionReference: string;
  readonly taxExemptionVersion: 1;
  readonly taxBaseAmount: string;
  readonly taxRate: string;
  readonly taxVatPolicyReference: string;
  readonly taxVatPolicyVersion: 1;
  readonly taxEvidenceReference: string;
  readonly taxEvidenceVersion: 1;
  readonly taxVatStartAt: string;
  readonly taxVatEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine cost-accounting request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1CostAccountingRequestV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly costAccountingRequestId: string;
  readonly costAccountingRequestVersion: B1RevenueRecognitionDocumentVersion;
  readonly scopeKey: B1RevenueRecognitionEngineScopeKey;
  readonly scopeVersion: B1RevenueRecognitionEngineScopeVersion;
  readonly expectedCurrency: B1RevenueRecognitionEngineCurrency;
  readonly expectedAccountingUnit: B1RevenueRecognitionEngineAccountingUnit;
  readonly accountingBasis: B1RevenueRecognitionEngineAccountingBasis;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.revenue-recognition'
    | 'commercial.virtual-account.inbound-funding.tax-vat'
    | 'commercial.virtual-account.inbound-funding.cost-accounting';
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
  readonly periodKey: B1RevenueRecognitionEnginePeriodKey;
  readonly periodVersion: B1RevenueRecognitionEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly costCategory: B1RevenueRecognitionCostCategory;
  readonly costAllocationMethod: B1RevenueRecognitionCostAllocationMethod;
  readonly directCostAmount: string;
  readonly indirectCostAmount: string;
  readonly acquisitionCostAmount: string;
  readonly operationalCostAmount: string;
  readonly allocatedCostAmount: string;
  readonly costAccountingPolicyReference: string;
  readonly costAccountingPolicyVersion: 1;
  readonly costAccountingStartAt: string;
  readonly costAccountingEndAt: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly billingDocumentReference: string;
  readonly campaignDecisionReference: string;
  readonly promotionDecisionReference: string;
  readonly couponDecisionReference: string;
  readonly referralDecisionReference: string;
  readonly cashbackDecisionReference: string;
  readonly loyaltyDecisionReference: string;
  readonly revenueRecognitionDecisionReference: string;
  readonly taxVatDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine revenue-recognition replay-safe result
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionDecisionReplaySafeResultV1 {
  readonly record: B1RevenueRecognitionDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.revenue-recognition-engine.revenue-recognition.idempotency.v1';
  readonly idempotencyKey: string;
  readonly revenueRecognitionRequestHash: string;
  readonly revenueRecognitionDecisionHash: string;
  readonly revenueRecognitionDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine tax / VAT replay-safe result (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1TaxVatDecisionReplaySafeResultV1 {
  readonly record: B1TaxVatDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.revenue-recognition-engine.tax-vat.idempotency.v1';
  readonly idempotencyKey: string;
  readonly taxVatRequestHash: string;
  readonly taxVatDecisionHash: string;
  readonly taxVatDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine cost-accounting replay-safe result
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1CostAccountingDecisionReplaySafeResultV1 {
  readonly record: B1CostAccountingDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.revenue-recognition-engine.cost-accounting.idempotency.v1';
  readonly idempotencyKey: string;
  readonly costAccountingRequestHash: string;
  readonly costAccountingDecisionHash: string;
  readonly costAccountingDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine compatibility result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export type B1RevenueRecognitionEngineCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1RevenueRecognitionEngineFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine document versioning contract (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionDocumentVersioningContractV1 {
  readonly contractName: B1RevenueRecognitionEngineContractName;
  readonly contractVersion: B1RevenueRecognitionEngineContractVersion;
  readonly documentVersion: B1RevenueRecognitionDocumentVersion;
  readonly scopeKey: B1RevenueRecognitionEngineScopeKey;
  readonly scopeVersion: B1RevenueRecognitionEngineScopeVersion;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByDocumentReference: string | null;
  readonly supersedesDocumentReference: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine document persistence record (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionDocumentPersistenceRecordV1 {
  readonly documentId: string;
  readonly documentReference: string;
  readonly documentVersion: B1RevenueRecognitionDocumentVersion;
  readonly documentKind: B1RevenueRecognitionDocumentKind;
  readonly documentHash: string;
  readonly documentReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly record: B1RevenueRecognitionDecisionV1 | B1TaxVatDecisionV1 | B1CostAccountingDecisionV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 revenue-recognition engine, tax / VAT engine, and
 * cost-accounting engine read-only consumer ports (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
 */
export interface B1RevenueRecognitionEngineConsumerPortsV1 {
  /**
   * B1 revenue-recognition decision generate. Returns the
   * canonical B1 revenue-recognition decision for the supplied
   * B1 revenue-recognition request. The generate is read-only;
   * the B1 revenue-recognition engine never posts a journal,
   * mutates a balance, executes financial effects, dispatches a
   * notification, or executes any financial effect.
   */
  readonly generateRevenueRecognitionDecision: (
    request: B1RevenueRecognitionRequestV1,
  ) => Promise<B1RevenueRecognitionDecisionV1>;

  /**
   * B1 revenue-recognition decision replay-safe generate.
   * Returns the canonical B1 revenue-recognition decision
   * replay-safe result for the supplied B1 revenue-recognition
   * request. The replay-safe generate is read-only; the B1
   * revenue-recognition engine never posts a journal, mutates a
   * balance, executes financial effects, dispatches a
   * notification, or executes any financial effect.
   */
  readonly replaySafeGenerateRevenueRecognitionDecision: (
    request: B1RevenueRecognitionRequestV1,
  ) => Promise<B1RevenueRecognitionDecisionReplaySafeResultV1>;

  /**
   * B1 tax / VAT decision generate. Returns the canonical B1
   * tax / VAT decision for the supplied B1 tax / VAT request.
   * The generate is read-only; the B1 tax / VAT engine never
   * posts a journal, mutates a balance, executes financial
   * effects, dispatches a notification, or executes any financial
   * effect.
   */
  readonly generateTaxVatDecision: (request: B1TaxVatRequestV1) => Promise<B1TaxVatDecisionV1>;

  /**
   * B1 tax / VAT decision replay-safe generate. Returns the
   * canonical B1 tax / VAT decision replay-safe result for the
   * supplied B1 tax / VAT request. The replay-safe generate is
   * read-only; the B1 tax / VAT engine never posts a journal,
   * mutates a balance, executes financial effects, dispatches a
   * notification, or executes any financial effect.
   */
  readonly replaySafeGenerateTaxVatDecision: (
    request: B1TaxVatRequestV1,
  ) => Promise<B1TaxVatDecisionReplaySafeResultV1>;

  /**
   * B1 cost-accounting decision generate. Returns the canonical
   * B1 cost-accounting decision for the supplied B1 cost-
   * accounting request. The generate is read-only; the B1 cost-
   * accounting engine never posts a journal, mutates a balance,
   * executes financial effects, dispatches a notification, or
   * executes any financial effect.
   */
  readonly generateCostAccountingDecision: (
    request: B1CostAccountingRequestV1,
  ) => Promise<B1CostAccountingDecisionV1>;

  /**
   * B1 cost-accounting decision replay-safe generate. Returns
   * the canonical B1 cost-accounting decision replay-safe
   * result for the supplied B1 cost-accounting request. The
   * replay-safe generate is read-only; the B1 cost-accounting
   * engine never posts a journal, mutates a balance, executes
   * financial effects, dispatches a notification, or executes
   * any financial effect.
   */
  readonly replaySafeGenerateCostAccountingDecision: (
    request: B1CostAccountingRequestV1,
  ) => Promise<B1CostAccountingDecisionReplaySafeResultV1>;

  /**
   * B1 revenue-recognition engine compatibility check. Returns
   * the canonical B1 revenue-recognition engine compatibility
   * result for the supplied B1 revenue-recognition / tax / VAT
   * / cost-accounting request. The compatibility check is read-
   * only; the B1 revenue-recognition engine never posts a
   * journal, mutates a balance, executes financial effects,
   * dispatches a notification, or executes any financial effect.
   */
  readonly compatibilityCheck: (
    request: B1RevenueRecognitionRequestV1 | B1TaxVatRequestV1 | B1CostAccountingRequestV1,
  ) => Promise<B1RevenueRecognitionEngineCompatibilityResultV1>;
}
