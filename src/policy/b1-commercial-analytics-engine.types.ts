/**
 * B1T09 — B1 commercial-analytics engine, profitability engine,
 * and commercial-reconciliation engine types.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine is the runtime read-only B1
 * commercial-analytics and reconciliation engine implementation
 * for the B1 first commercial scope
 * (`commercial.virtual-account.inbound-funding` v1) established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1
 * commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine consumes the A5 Ledger, the A6
 * partner, the A7 product, the B1T03 commercial catalog, the B1T04
 * commercial decision, the B1T05 billing document, the B1T06
 * commercial-incentive decision, the B1T07 commercial-rewards
 * decision, the B1T08 commercial-financial-recognition decision, the
 * A4 product-policy decision, the A3 binding recheck, the A5
 * Ledger account state, the A6 partner state, the A6T09 external
 * reconciliation snapshot, and the A7 product state through
 * approved read-only consumer boundaries.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine is the only B1 commercial-
 * analytics engine for commercial analytics, profitability, and
 * commercial reconciliation. The B1 commercial-analytics engine,
 * profitability engine, and commercial-reconciliation engine is a
 * read-only contract against the existing A1 canonical identity, A2
 * authorization, A3 binding, A4 policy decision, A5 Ledger, A6
 * partner-adapter, A6T05 external-operation, A6T08 settlement /
 * suspense / compensating, A6T09 external reconciliation, A6T10
 * data classification, A7 product catalog, A7 product-policy
 * profile, A7T04 product customer-binding, A7T05 product command,
 * A7T06 product notification, A7T07 product lifecycle, A7T08
 * product financial effect, A7T09 product reconciliation, A7T10
 * product data minimization, `CustomerPreference`, Wallet,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics,
 * Reconciliation, and `CustomerPreference` authorities. The B1
 * commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine is a read-write contract against
 * the shared Operations `IdempotencyService`, `AuditService`,
 * `OutboxService`, and `MetricsService`.
 *
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes cashback, executes rewards, executes payouts,
 *    redeems cashback, awards loyalty balances, redeems loyalty
 *    balances, executes referral rewards, creates financial
 *    effects, repairs a binding, changes A4 policy / source
 *    records, auto-repairs discrepancies, or dispatches a
 *    notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - rewrites source records or rewrites history;
 *  - mutates invoices, statements, commercial decisions, pricing
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
 * by B1T09.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineContractName = 'B1-COMMERCIAL-ANALYTICS-ENGINE';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineContractVersion = 1;

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine decision kind vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineDecisionKind =
  | 'COMMERCIAL_ANALYTICS'
  | 'PROFITABILITY'
  | 'COMMERCIAL_RECONCILIATION';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine decision outcome vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineDecisionOutcome =
  | 'AVAILABLE'
  | 'COMPLETED'
  | 'RECONCILED'
  | 'DISCREPANCY'
  | 'REPLAYED';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-analytics state
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsState = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED' | 'ARCHIVED';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine profitability state vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1ProfitabilityState = 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED' | 'ARCHIVED';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-reconciliation state
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialReconciliationState =
  | 'DRAFT'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'RECONCILED'
  | 'DISCREPANCY'
  | 'CLOSED';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine document kind vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsDocumentKind =
  | 'COMMERCIAL_ANALYTICS'
  | 'COMMERCIAL_KPI'
  | 'COMMERCIAL_METRIC'
  | 'TREND_ANALYSIS'
  | 'PRODUCT_ANALYTICS'
  | 'CUSTOMER_ANALYTICS'
  | 'MERCHANT_ANALYTICS'
  | 'PARTNER_ANALYTICS'
  | 'PROFITABILITY'
  | 'PRODUCT_PROFITABILITY'
  | 'CUSTOMER_PROFITABILITY'
  | 'MERCHANT_PROFITABILITY'
  | 'CAMPAIGN_PROFITABILITY'
  | 'FEE_PROFITABILITY'
  | 'REVENUE_ATTRIBUTION'
  | 'COST_ATTRIBUTION'
  | 'PROFITABILITY_DECISION'
  | 'COMMERCIAL_RECONCILIATION'
  | 'COMMERCIAL_RECONCILIATION_REPORT'
  | 'COMMERCIAL_RECONCILIATION_EVIDENCE'
  | 'COMMERCIAL_RECONCILIATION_DECISION'
  | 'COMMERCIAL_RECONCILIATION_TRACE'
  | 'COMMERCIAL_RECONCILIATION_DISCREPANCY';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine document version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsDocumentVersion = 1;

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineScopeKey = 'commercial.virtual-account.inbound-funding';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineScopeVersion = 1;

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineCurrency = 'NGN';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEnginePeriodKey =
  'commercial.virtual-account.inbound-funding.commercial-analytics-period.per-flow.v1';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine period version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEnginePeriodVersion = 1;

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial KPI vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsKpi =
  | 'GMV'
  | 'NET_REVENUE'
  | 'GROSS_PROFIT'
  | 'NET_PROFIT'
  | 'CUSTOMER_LIFETIME_VALUE'
  | 'CUSTOMER_ACQUISITION_COST'
  | 'FEE_VOLUME'
  | 'COMMISSION_VOLUME'
  | 'CAMPAIGN_UTILIZATION'
  | 'COUPON_REDEMPTION_RATE'
  | 'REFERRAL_CONVERSION_RATE'
  | 'CASHBACK_UTILIZATION'
  | 'LOYALTY_REDEMPTION_RATE'
  | 'REVENUE_RECOGNITION_RATE'
  | 'TAX_COMPLIANCE_RATE'
  | 'COST_ALLOCATION_RATE'
  | 'BILLING_ACCURACY'
  | 'INVOICE_ACCURACY'
  | 'STATEMENT_ACCURACY'
  | 'RECONCILIATION_RATE';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial trend vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsTrend =
  | 'INCREASING'
  | 'STABLE'
  | 'DECREASING'
  | 'VOLATILE'
  | 'INSUFFICIENT_DATA';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine discrepancy severity
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T09).
 */
export type B1CommercialAnalyticsDiscrepancySeverity =
  | 'INFO'
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine discrepancy owner vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsDiscrepancyOwner =
  | 'B1_COMMERCIAL_CATALOG_OWNER'
  | 'B1_FEE_ENGINE_OWNER'
  | 'B1_BILLING_ENGINE_OWNER'
  | 'B1_CAMPAIGN_ENGINE_OWNER'
  | 'B1_REFERRAL_ENGINE_OWNER'
  | 'B1_REVENUE_RECOGNITION_ENGINE_OWNER'
  | 'A5_LEDGER_OWNER'
  | 'A6_PARTNER_OWNER'
  | 'A7_PRODUCT_OWNER'
  | 'OPERATIONS_OWNER';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine discrepancy recovery state
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T09).
 */
export type B1CommercialAnalyticsDiscrepancyRecoveryState =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'INVESTIGATING'
  | 'PENDING_REMEDIATION'
  | 'PENDING_OWNER_REVIEW'
  | 'CLOSED_RESOLVED'
  | 'CLOSED_ACCEPTED'
  | 'CLOSED_WONT_FIX';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine discrepancy category vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsDiscrepancyCategory =
  | 'COMMERCIAL_DECISION_DISCREPANCY'
  | 'COMMERCIAL_FINANCIAL_EFFECT_DISCREPANCY'
  | 'COMMERCIAL_BILLING_DISCREPANCY'
  | 'COMMERCIAL_INVOICE_DISCREPANCY'
  | 'COMMERCIAL_STATEMENT_DISCREPANCY'
  | 'COMMERCIAL_CAMPAIGN_DISCREPANCY'
  | 'COMMERCIAL_PROMOTION_DISCREPANCY'
  | 'COMMERCIAL_COUPON_DISCREPANCY'
  | 'COMMERCIAL_REFERRAL_DISCREPANCY'
  | 'COMMERCIAL_CASHBACK_DISCREPANCY'
  | 'COMMERCIAL_LOYALTY_DISCREPANCY'
  | 'COMMERCIAL_REVENUE_RECOGNITION_DISCREPANCY'
  | 'COMMERCIAL_TAX_DISCREPANCY'
  | 'COMMERCIAL_COST_ACCOUNTING_DISCREPANCY'
  | 'COMMERCIAL_PROFITABILITY_DISCREPANCY'
  | 'COMMERCIAL_ANALYTICS_DISCREPANCY';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine profitability dimension
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T09).
 */
export type B1CommercialAnalyticsProfitabilityDimension =
  | 'PRODUCT'
  | 'CUSTOMER'
  | 'MERCHANT'
  | 'PARTNER'
  | 'CAMPAIGN'
  | 'FEE'
  | 'REVENUE'
  | 'COST';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine failure code vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineFailureCodeV1 =
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_INVALID_COMMAND'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_INCOMPATIBLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_QUERY_UNAVAILABLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_PROHIBITED'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_NOT_FOUND'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_DECISION_INCOMPATIBLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_CATALOG_INCOMPATIBLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_CATALOG_MISSING'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_BILLING_DOCUMENT_NOT_FOUND'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_BILLING_DOCUMENT_INCOMPATIBLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_A4_POLICY_DENIED'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_A3_BINDING_INVALID'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_A5_LEDGER_INVARIANT_BROKEN'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_A6_PARTNER_INCOMPATIBLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_A7_PRODUCT_INCOMPATIBLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_REPLAY_CONFLICT'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_REPLAY_EXPIRED'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_IN_PROGRESS'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_CONFLICT'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_EXPIRED'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_NOT_APPLICABLE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_INSUFFICIENT_DATA'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_DISCREPANCY_THRESHOLD_EXCEEDED'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_SNAPSHOT_STALE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_RECONCILIATION_SCOPE_VIOLATION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_AUTO_REPAIR_ATTEMPTED';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine rule kind vocabulary (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsRuleKindV1 =
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
  | 'A6T09_EXTERNAL_RECONCILIATION_SNAPSHOT'
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
  | 'B1_REVENUE_RECOGNITION_DECISION_LOOKUP'
  | 'B1_REVENUE_RECOGNITION_DECISION_COMPATIBILITY'
  | 'B1_REVENUE_RECOGNITION_DECISION_REPLAY'
  | 'B1_TAX_VAT_DECISION_LOOKUP'
  | 'B1_TAX_VAT_DECISION_COMPATIBILITY'
  | 'B1_TAX_VAT_DECISION_REPLAY'
  | 'B1_COST_ACCOUNTING_DECISION_LOOKUP'
  | 'B1_COST_ACCOUNTING_DECISION_COMPATIBILITY'
  | 'B1_COST_ACCOUNTING_DECISION_REPLAY'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_KPI'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_METRIC'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_TREND_ANALYSIS'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_PRODUCT_ANALYTICS'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_CUSTOMER_ANALYTICS'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_MERCHANT_ANALYTICS'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_PARTNER_ANALYTICS'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_DIMENSION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_REVENUE_ATTRIBUTION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COST_ATTRIBUTION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_PROFITABILITY_DECISION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_REPORT'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_EVIDENCE'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_DECISION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_RECONCILIATION_DISCREPANCY'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_NUMBER_DETERMINISTIC'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_DOCUMENT_VERSION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_READ_ONLY_TRANSACTION'
  | 'B1_COMMERCIAL_ANALYTICS_ENGINE_NO_AUTO_REPAIR';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine rule outcome vocabulary
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsRuleOutcomeV1 = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine decision eligibility
 * vocabulary (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T09).
 */
export type B1CommercialAnalyticsEngineEligibility =
  | 'CUSTOMER_ELIGIBLE'
  | 'MERCHANT_ELIGIBLE'
  | 'PARTNER_ELIGIBLE'
  | 'PRODUCT_ELIGIBLE'
  | 'TIER_ELIGIBLE'
  | 'PERIOD_ELIGIBLE'
  | 'KPI_AVAILABLE'
  | 'PROFITABILITY_AVAILABLE'
  | 'RECONCILIATION_AVAILABLE';

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-analytics decision
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsDecisionV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly commercialAnalyticsDecisionId: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly commercialAnalyticsDecisionVersion: B1CommercialAnalyticsDocumentVersion;
  readonly commercialAnalyticsDecisionState: B1CommercialAnalyticsState;
  readonly commercialAnalyticsDecisionOutcome: B1CommercialAnalyticsEngineDecisionOutcome;
  readonly commercialAnalyticsDecisionHash: string;
  readonly commercialAnalyticsDecisionReplayHash: string;
  readonly commercialAnalyticsRequestHash: string;
  readonly scopeKey: B1CommercialAnalyticsEngineScopeKey;
  readonly scopeVersion: B1CommercialAnalyticsEngineScopeVersion;
  readonly periodKey: B1CommercialAnalyticsEnginePeriodKey;
  readonly periodVersion: B1CommercialAnalyticsEnginePeriodVersion;
  readonly commercialKpi: B1CommercialAnalyticsKpi;
  readonly commercialMetricValue: string;
  readonly commercialMetricUnit: string;
  readonly commercialTrend: B1CommercialAnalyticsTrend;
  readonly commercialAnalyticsEligible: boolean;
  readonly commercialAnalyticsApplicable: boolean;
  readonly commercialKpiSummary: readonly B1CommercialAnalyticsKpi[];
  readonly commercialTrendSummary: readonly B1CommercialAnalyticsTrend[];
  readonly productAnalyticsSummary: readonly string[];
  readonly customerAnalyticsSummary: readonly string[];
  readonly merchantAnalyticsSummary: readonly string[];
  readonly partnerAnalyticsSummary: readonly string[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-analytics'
    | 'commercial.virtual-account.inbound-funding.profitability'
    | 'commercial.virtual-account.inbound-funding.commercial-reconciliation';
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
  readonly commercialAnalyticsStartAt: string;
  readonly commercialAnalyticsEndAt: string;
  readonly commercialAnalyticsEffectiveAt: string;
  readonly eligibilitySummary: readonly B1CommercialAnalyticsEngineEligibility[];
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
  readonly costAccountingDecisionReference: string;
  readonly explanationTrace: B1CommercialAnalyticsExplanationTraceV1;
  readonly ruleTrace: B1CommercialAnalyticsRuleTraceV1;
  readonly analyticsTrace: B1CommercialAnalyticsAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialAnalyticsAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-analytics-engine.commercial-analytics.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialAnalyticsEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine profitability decision (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1ProfitabilityDecisionV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly profitabilityDecisionId: string;
  readonly profitabilityDecisionReference: string;
  readonly profitabilityDecisionVersion: B1CommercialAnalyticsDocumentVersion;
  readonly profitabilityDecisionState: B1ProfitabilityState;
  readonly profitabilityDecisionOutcome: B1CommercialAnalyticsEngineDecisionOutcome;
  readonly profitabilityDecisionHash: string;
  readonly profitabilityDecisionReplayHash: string;
  readonly profitabilityRequestHash: string;
  readonly scopeKey: B1CommercialAnalyticsEngineScopeKey;
  readonly scopeVersion: B1CommercialAnalyticsEngineScopeVersion;
  readonly periodKey: B1CommercialAnalyticsEnginePeriodKey;
  readonly periodVersion: B1CommercialAnalyticsEnginePeriodVersion;
  readonly profitabilityDimension: B1CommercialAnalyticsProfitabilityDimension;
  readonly revenueAttributionAmount: string;
  readonly costAttributionAmount: string;
  readonly grossProfitAmount: string;
  readonly netProfitAmount: string;
  readonly profitabilityEligible: boolean;
  readonly profitabilityApplicable: boolean;
  readonly revenueAttributionSummary: readonly string[];
  readonly costAttributionSummary: readonly string[];
  readonly productProfitabilitySummary: readonly string[];
  readonly customerProfitabilitySummary: readonly string[];
  readonly merchantProfitabilitySummary: readonly string[];
  readonly campaignProfitabilitySummary: readonly string[];
  readonly feeProfitabilitySummary: readonly string[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-analytics'
    | 'commercial.virtual-account.inbound-funding.profitability'
    | 'commercial.virtual-account.inbound-funding.commercial-reconciliation';
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
  readonly profitabilityStartAt: string;
  readonly profitabilityEndAt: string;
  readonly profitabilityEffectiveAt: string;
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
  readonly costAccountingDecisionReference: string;
  readonly explanationTrace: B1CommercialAnalyticsExplanationTraceV1;
  readonly ruleTrace: B1CommercialAnalyticsRuleTraceV1;
  readonly analyticsTrace: B1CommercialAnalyticsAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialAnalyticsAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-analytics-engine.profitability.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialAnalyticsEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-reconciliation
 * decision (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialReconciliationDecisionV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly commercialReconciliationDecisionId: string;
  readonly commercialReconciliationDecisionReference: string;
  readonly commercialReconciliationDecisionVersion: B1CommercialAnalyticsDocumentVersion;
  readonly commercialReconciliationDecisionState: B1CommercialReconciliationState;
  readonly commercialReconciliationDecisionOutcome: B1CommercialAnalyticsEngineDecisionOutcome;
  readonly commercialReconciliationDecisionHash: string;
  readonly commercialReconciliationDecisionReplayHash: string;
  readonly commercialReconciliationRequestHash: string;
  readonly scopeKey: B1CommercialAnalyticsEngineScopeKey;
  readonly scopeVersion: B1CommercialAnalyticsEngineScopeVersion;
  readonly periodKey: B1CommercialAnalyticsEnginePeriodKey;
  readonly periodVersion: B1CommercialAnalyticsEnginePeriodVersion;
  readonly reconciliationWindowStartAt: string;
  readonly reconciliationWindowEndAt: string;
  readonly reconciliationWindowEffectiveAt: string;
  readonly commercialReconciliationEligible: boolean;
  readonly commercialReconciliationApplicable: boolean;
  readonly commercialReconciliationReportSummary: readonly string[];
  readonly commercialReconciliationEvidenceSummary: readonly string[];
  readonly commercialReconciliationTraceSummary: readonly string[];
  readonly commercialReconciliationDiscrepancySummary: readonly B1CommercialReconciliationDiscrepancyV1[];
  readonly commercialReconciliationDiscrepancyCount: number;
  readonly commercialReconciliationDiscrepancySeveritySummary: readonly B1CommercialAnalyticsDiscrepancySeverity[];
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-analytics'
    | 'commercial.virtual-account.inbound-funding.profitability'
    | 'commercial.virtual-account.inbound-funding.commercial-reconciliation';
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
  readonly costAccountingDecisionReference: string;
  readonly explanationTrace: B1CommercialAnalyticsExplanationTraceV1;
  readonly ruleTrace: B1CommercialAnalyticsRuleTraceV1;
  readonly analyticsTrace: B1CommercialAnalyticsAnalyticsTraceV1;
  readonly auditEvidence: B1CommercialAnalyticsAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-analytics-engine.commercial-reconciliation.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialAnalyticsEngineFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-reconciliation
 * discrepancy (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T09).
 */
export interface B1CommercialReconciliationDiscrepancyV1 {
  readonly discrepancyId: string;
  readonly discrepancyCategory: B1CommercialAnalyticsDiscrepancyCategory;
  readonly discrepancySeverity: B1CommercialAnalyticsDiscrepancySeverity;
  readonly discrepancyOwner: B1CommercialAnalyticsDiscrepancyOwner;
  readonly discrepancyRecoveryState: B1CommercialAnalyticsDiscrepancyRecoveryState;
  readonly discrepancySummary: string;
  readonly commercialDecisionReference: string;
  readonly commercialFinancialEffectReference: string;
  readonly commercialBillingDocumentReference: string;
  readonly commercialInvoiceReference: string;
  readonly commercialStatementReference: string;
  readonly commercialCampaignDecisionReference: string;
  readonly commercialPromotionDecisionReference: string;
  readonly commercialCouponDecisionReference: string;
  readonly commercialReferralDecisionReference: string;
  readonly commercialCashbackDecisionReference: string;
  readonly commercialLoyaltyDecisionReference: string;
  readonly commercialRevenueRecognitionDecisionReference: string;
  readonly commercialTaxVatDecisionReference: string;
  readonly commercialCostAccountingDecisionReference: string;
  readonly commercialProfitabilityDecisionReference: string;
  readonly commercialAnalyticsDecisionReference: string;
  readonly detectedAt: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine audit evidence (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsAuditEvidenceV1 {
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
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine explanation trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsExplanationTraceV1 {
  readonly traceId: string;
  readonly traceKind:
    | 'COMMERCIAL_ANALYTICS_DECISION'
    | 'PROFITABILITY_DECISION'
    | 'COMMERCIAL_RECONCILIATION_DECISION'
    | 'COMMERCIAL_ANALYTICS_ENGINE_COMPOSITE_DECISION';
  readonly traceSummary: string;
  readonly traceSteps: readonly B1CommercialAnalyticsExplanationStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine explanation step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsExplanationStepV1 {
  readonly stepIndex: number;
  readonly stepKind: B1CommercialAnalyticsRuleKindV1;
  readonly stepLabel: string;
  readonly stepOutcome: B1CommercialAnalyticsRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepReason: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
  readonly stepOutputs: Readonly<Record<string, unknown>>;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine rule trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsRuleTraceV1 {
  readonly ruleTraceId: string;
  readonly ruleTraceSteps: readonly B1CommercialAnalyticsRuleTraceStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine rule trace step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsRuleTraceStepV1 {
  readonly stepIndex: number;
  readonly ruleKind: B1CommercialAnalyticsRuleKindV1;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly ruleOutcome: B1CommercialAnalyticsRuleOutcomeV1;
  readonly ruleReasonCode: string;
  readonly ruleEvaluatedAt: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine analytics trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsAnalyticsTraceV1 {
  readonly analyticsTraceId: string;
  readonly analyticsSteps: readonly B1CommercialAnalyticsAnalyticsStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine analytics step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsAnalyticsStepV1 {
  readonly stepIndex: number;
  readonly stepKind:
    | 'COMMERCIAL_KPI'
    | 'COMMERCIAL_METRIC'
    | 'TREND_ANALYSIS'
    | 'PRODUCT_ANALYTICS'
    | 'CUSTOMER_ANALYTICS'
    | 'MERCHANT_ANALYTICS'
    | 'PARTNER_ANALYTICS'
    | 'PROFITABILITY'
    | 'REVENUE_ATTRIBUTION'
    | 'COST_ATTRIBUTION'
    | 'COMMERCIAL_RECONCILIATION'
    | 'COMMERCIAL_RECONCILIATION_EVIDENCE'
    | 'COMMERCIAL_RECONCILIATION_DISCREPANCY';
  readonly stepReference: string;
  readonly stepLabel: string;
  readonly stepOutcome: B1CommercialAnalyticsRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepAmount: string;
  readonly stepCurrency: B1CommercialAnalyticsEngineCurrency;
  readonly stepEvaluatedAt: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine decision failure (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsEngineFailureV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly code: B1CommercialAnalyticsEngineFailureCodeV1;
  readonly message: string;
  readonly failedRules: readonly B1CommercialAnalyticsRuleTraceStepV1[];
  readonly failedInputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestId: string;
  readonly generatedAt: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-analytics request
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsRequestV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly commercialAnalyticsRequestId: string;
  readonly commercialAnalyticsRequestVersion: B1CommercialAnalyticsDocumentVersion;
  readonly scopeKey: B1CommercialAnalyticsEngineScopeKey;
  readonly scopeVersion: B1CommercialAnalyticsEngineScopeVersion;
  readonly expectedCurrency: B1CommercialAnalyticsEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialAnalyticsEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-analytics'
    | 'commercial.virtual-account.inbound-funding.profitability'
    | 'commercial.virtual-account.inbound-funding.commercial-reconciliation';
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
  readonly periodKey: B1CommercialAnalyticsEnginePeriodKey;
  readonly periodVersion: B1CommercialAnalyticsEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly commercialKpi: B1CommercialAnalyticsKpi;
  readonly commercialAnalyticsStartAt: string;
  readonly commercialAnalyticsEndAt: string;
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
  readonly costAccountingDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine profitability request (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1ProfitabilityRequestV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly profitabilityRequestId: string;
  readonly profitabilityRequestVersion: B1CommercialAnalyticsDocumentVersion;
  readonly scopeKey: B1CommercialAnalyticsEngineScopeKey;
  readonly scopeVersion: B1CommercialAnalyticsEngineScopeVersion;
  readonly expectedCurrency: B1CommercialAnalyticsEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialAnalyticsEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-analytics'
    | 'commercial.virtual-account.inbound-funding.profitability'
    | 'commercial.virtual-account.inbound-funding.commercial-reconciliation';
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
  readonly periodKey: B1CommercialAnalyticsEnginePeriodKey;
  readonly periodVersion: B1CommercialAnalyticsEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly profitabilityDimension: B1CommercialAnalyticsProfitabilityDimension;
  readonly revenueAttributionAmount: string;
  readonly costAttributionAmount: string;
  readonly profitabilityStartAt: string;
  readonly profitabilityEndAt: string;
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
  readonly costAccountingDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-reconciliation
 * request (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialReconciliationRequestV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly commercialReconciliationRequestId: string;
  readonly commercialReconciliationRequestVersion: B1CommercialAnalyticsDocumentVersion;
  readonly scopeKey: B1CommercialAnalyticsEngineScopeKey;
  readonly scopeVersion: B1CommercialAnalyticsEngineScopeVersion;
  readonly expectedCurrency: B1CommercialAnalyticsEngineCurrency;
  readonly expectedAccountingUnit: B1CommercialAnalyticsEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.commercial-analytics'
    | 'commercial.virtual-account.inbound-funding.profitability'
    | 'commercial.virtual-account.inbound-funding.commercial-reconciliation';
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
  readonly periodKey: B1CommercialAnalyticsEnginePeriodKey;
  readonly periodVersion: B1CommercialAnalyticsEnginePeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly reconciliationWindowStartAt: string;
  readonly reconciliationWindowEndAt: string;
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
  readonly costAccountingDecisionReference: string;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-analytics replay-safe
 * result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsDecisionReplaySafeResultV1 {
  readonly record: B1CommercialAnalyticsDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-analytics-engine.commercial-analytics.idempotency.v1';
  readonly idempotencyKey: string;
  readonly commercialAnalyticsRequestHash: string;
  readonly commercialAnalyticsDecisionHash: string;
  readonly commercialAnalyticsDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine profitability replay-safe
 * result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1ProfitabilityDecisionReplaySafeResultV1 {
  readonly record: B1ProfitabilityDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-analytics-engine.profitability.idempotency.v1';
  readonly idempotencyKey: string;
  readonly profitabilityRequestHash: string;
  readonly profitabilityDecisionHash: string;
  readonly profitabilityDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine commercial-reconciliation
 * replay-safe result (frozen by `docs/B1-IMPLEMENTATION-PLAN.md`
 * §8 B1T09).
 */
export interface B1CommercialReconciliationDecisionReplaySafeResultV1 {
  readonly record: B1CommercialReconciliationDecisionV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-analytics-engine.commercial-reconciliation.idempotency.v1';
  readonly idempotencyKey: string;
  readonly commercialReconciliationRequestHash: string;
  readonly commercialReconciliationDecisionHash: string;
  readonly commercialReconciliationDecisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine compatibility result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export type B1CommercialAnalyticsEngineCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1CommercialAnalyticsEngineFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine document versioning contract
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsDocumentVersioningContractV1 {
  readonly contractName: B1CommercialAnalyticsEngineContractName;
  readonly contractVersion: B1CommercialAnalyticsEngineContractVersion;
  readonly documentVersion: B1CommercialAnalyticsDocumentVersion;
  readonly scopeKey: B1CommercialAnalyticsEngineScopeKey;
  readonly scopeVersion: B1CommercialAnalyticsEngineScopeVersion;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByDocumentReference: string | null;
  readonly supersedesDocumentReference: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine document persistence record
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsDocumentPersistenceRecordV1 {
  readonly documentId: string;
  readonly documentReference: string;
  readonly documentVersion: B1CommercialAnalyticsDocumentVersion;
  readonly documentKind: B1CommercialAnalyticsDocumentKind;
  readonly documentHash: string;
  readonly documentReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly record:
    | B1CommercialAnalyticsDecisionV1
    | B1ProfitabilityDecisionV1
    | B1CommercialReconciliationDecisionV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 commercial-analytics engine, profitability engine, and
 * commercial-reconciliation engine read-only consumer ports
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
 */
export interface B1CommercialAnalyticsEngineConsumerPortsV1 {
  /**
   * B1 commercial-analytics decision generate. Returns the
   * canonical B1 commercial-analytics decision for the supplied
   * B1 commercial-analytics request. The generate is read-only;
   * the B1 commercial-analytics engine never writes source
   * records, never auto-repairs discrepancies, never dispatches
   * a notification, or executes any financial effect.
   */
  readonly generateCommercialAnalyticsDecision: (
    request: B1CommercialAnalyticsRequestV1,
  ) => Promise<B1CommercialAnalyticsDecisionV1>;

  /**
   * B1 commercial-analytics decision replay-safe generate.
   * Returns the canonical B1 commercial-analytics decision
   * replay-safe result for the supplied B1 commercial-analytics
   * request. The replay-safe generate is read-only; the B1
   * commercial-analytics engine never writes source records,
   * never auto-repairs discrepancies, never dispatches a
   * notification, or executes any financial effect.
   */
  readonly replaySafeGenerateCommercialAnalyticsDecision: (
    request: B1CommercialAnalyticsRequestV1,
  ) => Promise<B1CommercialAnalyticsDecisionReplaySafeResultV1>;

  /**
   * B1 profitability decision generate. Returns the canonical
   * B1 profitability decision for the supplied B1 profitability
   * request. The generate is read-only; the B1 profitability
   * engine never writes source records, never auto-repairs
   * discrepancies, never dispatches a notification, or executes
   * any financial effect.
   */
  readonly generateProfitabilityDecision: (
    request: B1ProfitabilityRequestV1,
  ) => Promise<B1ProfitabilityDecisionV1>;

  /**
   * B1 profitability decision replay-safe generate. Returns the
   * canonical B1 profitability decision replay-safe result for
   * the supplied B1 profitability request. The replay-safe
   * generate is read-only; the B1 profitability engine never
   * writes source records, never auto-repairs discrepancies,
   * never dispatches a notification, or executes any financial
   * effect.
   */
  readonly replaySafeGenerateProfitabilityDecision: (
    request: B1ProfitabilityRequestV1,
  ) => Promise<B1ProfitabilityDecisionReplaySafeResultV1>;

  /**
   * B1 commercial-reconciliation decision generate. Returns the
   * canonical B1 commercial-reconciliation decision for the
   * supplied B1 commercial-reconciliation request. The generate
   * is read-only; the B1 commercial-reconciliation engine never
   * writes source records, never auto-repairs discrepancies,
   * never dispatches a notification, or executes any financial
   * effect.
   */
  readonly generateCommercialReconciliationDecision: (
    request: B1CommercialReconciliationRequestV1,
  ) => Promise<B1CommercialReconciliationDecisionV1>;

  /**
   * B1 commercial-reconciliation decision replay-safe generate.
   * Returns the canonical B1 commercial-reconciliation decision
   * replay-safe result for the supplied B1 commercial-
   * reconciliation request. The replay-safe generate is read-
   * only; the B1 commercial-reconciliation engine never writes
   * source records, never auto-repairs discrepancies, never
   * dispatches a notification, or executes any financial effect.
   */
  readonly replaySafeGenerateCommercialReconciliationDecision: (
    request: B1CommercialReconciliationRequestV1,
  ) => Promise<B1CommercialReconciliationDecisionReplaySafeResultV1>;

  /**
   * B1 commercial-analytics engine compatibility check. Returns
   * the canonical B1 commercial-analytics engine compatibility
   * result for the supplied B1 commercial-analytics /
   * profitability / commercial-reconciliation request. The
   * compatibility check is read-only; the B1 commercial-analytics
   * engine never writes source records, never auto-repairs
   * discrepancies, never dispatches a notification, or executes
   * any financial effect.
   */
  readonly compatibilityCheck: (
    request:
      | B1CommercialAnalyticsRequestV1
      | B1ProfitabilityRequestV1
      | B1CommercialReconciliationRequestV1,
  ) => Promise<B1CommercialAnalyticsEngineCompatibilityResultV1>;
}
