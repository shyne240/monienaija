/**
 * B1T04 — B1 fee engine, commission engine, and revenue sharing
 * decision engine types.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine is the runtime commercial-decision engine
 * implementation for the B1 first commercial scope
 * (`commercial.virtual-account.inbound-funding` v1) established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1 fee
 * engine, commission engine, and revenue sharing decision engine
 * consume the B1 commercial catalog (B1T03), the A4 product-policy
 * decision, the A3 binding recheck, the A5 Ledger account state,
 * the A6 partner state, and the A7 product state through approved
 * read-only consumer boundaries. The B1 fee engine, commission
 * engine, and revenue sharing decision engine are the only B1
 * commercial-decision engines for fee, commission, and revenue
 * sharing. The B1 fee engine, commission engine, and revenue
 * sharing decision engine never post a journal, mutate a balance,
 * repair a binding, change A4 policy / source records, or dispatch
 * a notification. The B1 fee engine, commission engine, and
 * revenue sharing decision engine never post to Ledger and never
 * bypass A5.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine is a read-only contract against the existing A1
 * canonical identity, A2 authorization, A3 binding, A4 policy
 * decision, A5 Ledger, A6 partner-adapter, A6T05 external-operation,
 * A6T08 settlement, A6T09 external reconciliation, A6T10 data
 * classification, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding, A7T05 product command, A7T06
 * product notification, A7T07 product lifecycle, A7T08 product
 * financial effect, A7T09 product reconciliation, A7T10 product
 * data minimization, `CustomerPreference`, Wallet, Operations,
 * Outbox, Idempotency, Metrics, Diagnostics, Reconciliation, and
 * `CustomerPreference` authorities. The B1 fee engine, commission
 * engine, and revenue sharing decision engine is a read-write
 * contract against the shared Operations `IdempotencyService`,
 * `AuditService`, `OutboxService`, and `MetricsService`.
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
 * by B1T04.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export type B1FeeEngineContractName = 'B1-FEE-ENGINE';

/**
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export type B1FeeEngineContractVersion = 1;

/**
 * The B1 commercial decision key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision key is the canonical B1 commercial decision identifier
 * for a single commercial flow.
 */
export type B1CommercialDecisionKey = string;

/**
 * The B1 commercial decision version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export type B1CommercialDecisionVersion = 1;

/**
 * The B1 commercial decision kind (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision kind distinguishes the fee, commission, and revenue-
 * sharing decisions.
 */
export type B1CommercialDecisionKind = 'FEE' | 'COMMISSION' | 'REVENUE_SHARING';

/**
 * The B1 commercial decision outcome (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision outcome is the canonical B1 commercial decision
 * outcome.
 */
export type B1CommercialDecisionOutcome =
  | 'COMMERCIAL_DECISION_ADMITTED'
  | 'COMMERCIAL_DECISION_SUPPRESSED'
  | 'COMMERCIAL_DECISION_DISABLED'
  | 'COMMERCIAL_DECISION_FAILED';

/**
 * The B1 commercial decision rule outcome (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision rule outcome is the canonical B1 commercial decision
 * rule outcome for each rule evaluated by the B1 fee engine,
 * commission engine, and revenue sharing decision engine.
 */
export type B1CommercialDecisionRuleOutcome = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

/**
 * The B1 commercial decision rule kind (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision rule kind distinguishes the rule categories evaluated
 * by the B1 fee engine, commission engine, and revenue sharing
 * decision engine.
 */
export type B1CommercialDecisionRuleKind =
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
  | 'B1_COMMERCIAL_CATALOG_PRICING';

/**
 * The B1 commercial decision failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export type B1CommercialDecisionFailureCodeV1 =
  | 'B1_FEE_ENGINE_INVALID_COMMAND'
  | 'B1_FEE_ENGINE_INCOMPATIBLE'
  | 'B1_FEE_ENGINE_QUERY_UNAVAILABLE'
  | 'B1_FEE_ENGINE_PROHIBITED'
  | 'B1_FEE_ENGINE_A4_POLICY_DENIED'
  | 'B1_FEE_ENGINE_A3_BINDING_INVALID'
  | 'B1_FEE_ENGINE_A5_LEDGER_INVARIANT_BROKEN'
  | 'B1_FEE_ENGINE_A6_PARTNER_INCOMPATIBLE'
  | 'B1_FEE_ENGINE_A7_PRODUCT_INCOMPATIBLE'
  | 'B1_FEE_ENGINE_B1_CATALOG_INCOMPATIBLE'
  | 'B1_FEE_ENGINE_B1_CATALOG_MISSING'
  | 'B1_FEE_ENGINE_FEATURE_FLAG_DISABLED'
  | 'B1_FEE_ENGINE_DYNAMIC_LIMIT_EXCEEDED'
  | 'B1_FEE_ENGINE_REPLAY_CONFLICT'
  | 'B1_FEE_ENGINE_REPLAY_EXPIRED'
  | 'B1_FEE_ENGINE_IN_PROGRESS'
  | 'B1_FEE_ENGINE_BREAK_GLASS_DENIED';

/**
 * The B1 commercial decision currency (reuses the B1T03 frozen
 * currency vocabulary).
 */
export type B1CommercialDecisionCurrency = 'NGN';

/**
 * The B1 commercial decision accounting unit (reuses the B1T03
 * frozen accounting unit vocabulary).
 */
export type B1CommercialDecisionAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 commercial decision fee breakdown (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision fee breakdown is the canonical B1 commercial decision
 * fee breakdown; the B1 fee engine is a deterministic calculator
 * and the B1 fee engine never posts a journal.
 */
export interface B1CommercialDecisionFeeBreakdownV1 {
  readonly baseAmountMinor: string;
  readonly feeRateBps: number;
  readonly flatFeeMinor: string;
  readonly variableFeeMinor: string;
  readonly tierDiscountMinor: string;
  readonly netFeeMinor: string;
  readonly currency: B1CommercialDecisionCurrency;
  readonly accountingUnit: B1CommercialDecisionAccountingUnit;
  readonly components: readonly B1CommercialDecisionFeeComponentV1[];
  readonly roundingPolicy: 'BANKERS_ROUND' | 'TRUNCATE' | 'CEIL';
}

/**
 * The B1 commercial decision fee component (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision fee component is the canonical B1 commercial decision
 * fee component; the B1 fee engine is a deterministic calculator
 * and the B1 fee engine never posts a journal.
 */
export interface B1CommercialDecisionFeeComponentV1 {
  readonly componentKey: string;
  readonly componentLabel: string;
  readonly componentKind:
    | 'BASE'
    | 'VARIABLE'
    | 'FLAT'
    | 'TIER_DISCOUNT'
    | 'FEATURE_FLAG_OVERRIDE'
    | 'DYNAMIC_LIMIT_OVERRIDE';
  readonly componentAmountMinor: string;
  readonly componentOrder: number;
}

/**
 * The B1 commercial decision commission breakdown (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision commission breakdown is the canonical B1 commercial
 * decision commission breakdown; the B1 commission engine is a
 * deterministic calculator and the B1 commission engine never
 * posts a journal.
 */
export interface B1CommercialDecisionCommissionBreakdownV1 {
  readonly netAmountMinor: string;
  readonly commissionRateBps: number;
  readonly flatCommissionMinor: string;
  readonly variableCommissionMinor: string;
  readonly partnerTierMultiplier: number;
  readonly netCommissionMinor: string;
  readonly currency: B1CommercialDecisionCurrency;
  readonly accountingUnit: B1CommercialDecisionAccountingUnit;
  readonly components: readonly B1CommercialDecisionCommissionComponentV1[];
  readonly roundingPolicy: 'BANKERS_ROUND' | 'TRUNCATE' | 'CEIL';
}

/**
 * The B1 commercial decision commission component (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision commission component is the canonical B1 commercial
 * decision commission component.
 */
export interface B1CommercialDecisionCommissionComponentV1 {
  readonly componentKey: string;
  readonly componentLabel: string;
  readonly componentKind:
    | 'BASE'
    | 'VARIABLE'
    | 'FLAT'
    | 'PARTNER_TIER'
    | 'FEATURE_FLAG_OVERRIDE'
    | 'DYNAMIC_LIMIT_OVERRIDE';
  readonly componentAmountMinor: string;
  readonly componentOrder: number;
}

/**
 * The B1 commercial decision revenue sharing breakdown (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision revenue sharing breakdown is the canonical B1
 * commercial decision revenue sharing breakdown; the B1 revenue
 * sharing engine is a deterministic calculator and the B1 revenue
 * sharing engine never posts a journal.
 */
export interface B1CommercialDecisionRevenueSharingBreakdownV1 {
  readonly netAmountMinor: string;
  readonly platformShareMinor: string;
  readonly partnerShareMinor: string;
  readonly merchantShareMinor: string;
  readonly customerShareMinor: string;
  readonly currency: B1CommercialDecisionCurrency;
  readonly accountingUnit: B1CommercialDecisionAccountingUnit;
  readonly components: readonly B1CommercialDecisionRevenueSharingComponentV1[];
  readonly roundingPolicy: 'BANKERS_ROUND' | 'TRUNCATE' | 'CEIL';
}

/**
 * The B1 commercial decision revenue sharing component (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision revenue sharing component is the canonical B1
 * commercial decision revenue sharing component.
 */
export interface B1CommercialDecisionRevenueSharingComponentV1 {
  readonly componentKey: string;
  readonly componentLabel: string;
  readonly componentKind: 'PLATFORM' | 'PARTNER' | 'MERCHANT' | 'CUSTOMER' | 'RECONCILIATION';
  readonly componentAmountMinor: string;
  readonly componentOrder: number;
  readonly componentBps: number;
}

/**
 * The B1 commercial decision applied pricing plan (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision applied pricing plan references the B1T03 plan.
 */
export interface B1CommercialDecisionAppliedPlanV1 {
  readonly planKey: string;
  readonly planVersion: 1;
  readonly planCatalogReference: string;
}

/**
 * The B1 commercial decision applied pricing catalog entry (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedPricingEntryV1 {
  readonly pricingKey: string;
  readonly pricingVersion: 1;
  readonly pricingCatalogReference: string;
}

/**
 * The B1 commercial decision applied tier (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedTierV1 {
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly tierCatalogReference: string;
}

/**
 * The B1 commercial decision applied subscription (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedSubscriptionV1 {
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly subscriptionCatalogReference: string;
}

/**
 * The B1 commercial decision applied product entitlement (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedProductEntitlementV1 {
  readonly entitlementKey: string;
  readonly entitlementVersion: 1;
  readonly productEntitlementCatalogReference: string;
}

/**
 * The B1 commercial decision applied package (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedPackageV1 {
  readonly packageKey: string;
  readonly packageVersion: 1;
  readonly packageCatalogReference: string;
}

/**
 * The B1 commercial decision applied bundle (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedBundleV1 {
  readonly bundleKey: string;
  readonly bundleVersion: 1;
  readonly bundleCatalogReference: string;
}

/**
 * The B1 commercial decision applied feature flag (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedFeatureFlagV1 {
  readonly featureFlagKey: string;
  readonly featureFlagState: 'ENABLED' | 'DISABLED';
  readonly featureFlagCatalogReference: string;
}

/**
 * The B1 commercial decision applied dynamic limit (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionAppliedDynamicLimitV1 {
  readonly dynamicLimitKey: string;
  readonly dynamicLimitUnit: 'MINOR' | 'COUNT' | 'PERCENT';
  readonly dynamicLimitValue: string;
  readonly dynamicLimitCatalogReference: string;
  readonly dynamicLimitBreached: boolean;
}

/**
 * The B1 commercial decision audit evidence (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision audit evidence is the canonical B1 commercial decision
 * audit evidence.
 */
export interface B1CommercialDecisionAuditEvidenceV1 {
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
 * The B1 commercial decision explanation trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision explanation trace is the canonical B1 commercial
 * decision explanation trace; the explanation trace is consumed
 * by the B1T10 commercial data classification / commercial
 * disclosure / commercial support-trace contract (re-asserted
 * from the B1T10 plan).
 */
export interface B1CommercialDecisionExplanationTraceV1 {
  readonly traceId: string;
  readonly traceKind:
    | 'FEE_DECISION'
    | 'COMMISSION_DECISION'
    | 'REVENUE_SHARING_DECISION'
    | 'COMPOSITE_DECISION';
  readonly traceSummary: string;
  readonly traceSteps: readonly B1CommercialDecisionExplanationStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial decision explanation step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionExplanationStepV1 {
  readonly stepIndex: number;
  readonly stepKind: B1CommercialDecisionRuleKind;
  readonly stepLabel: string;
  readonly stepOutcome: B1CommercialDecisionRuleOutcome;
  readonly stepReasonCode: string;
  readonly stepReason: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
  readonly stepOutputs: Readonly<Record<string, unknown>>;
}

/**
 * The B1 commercial decision rule trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision rule trace is the canonical B1 commercial decision
 * rule trace; the rule trace is consumed by the B1T10 commercial
 * data classification / commercial disclosure / commercial
 * support-trace contract.
 */
export interface B1CommercialDecisionRuleTraceV1 {
  readonly ruleTraceId: string;
  readonly ruleTraceSteps: readonly B1CommercialDecisionRuleTraceStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial decision rule trace step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export interface B1CommercialDecisionRuleTraceStepV1 {
  readonly stepIndex: number;
  readonly ruleKind: B1CommercialDecisionRuleKind;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly ruleOutcome: B1CommercialDecisionRuleOutcome;
  readonly ruleReasonCode: string;
  readonly ruleEvaluatedAt: string;
}

/**
 * The B1 commercial decision request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision request is the canonical B1 commercial decision
 * request; the B1 commercial decision request is the only B1
 * commercial decision request.
 */
export interface B1CommercialDecisionRequestV1 {
  readonly contractName: B1FeeEngineContractName;
  readonly contractVersion: B1FeeEngineContractVersion;
  readonly decisionKind: B1CommercialDecisionKind;
  readonly decisionRequestId: string;
  readonly decisionRequestVersion: 1;
  readonly scopeKey: 'commercial.virtual-account.inbound-funding';
  readonly scopeVersion: 1;
  readonly expectedCurrency: B1CommercialDecisionCurrency;
  readonly expectedAccountingUnit: B1CommercialDecisionAccountingUnit;
  readonly baseAmountMinor: string;
  readonly baseCurrency: B1CommercialDecisionCurrency;
  readonly customerId: string;
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantId: string;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerId: string;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly capabilityKey:
    | 'commercial.virtual-account.inbound-funding.fee'
    | 'commercial.virtual-account.inbound-funding.commission';
  readonly capabilityVersion: 1;
  readonly planKey: string;
  readonly planVersion: 1;
  readonly subscriptionKey: string;
  readonly subscriptionVersion: 1;
  readonly packageKey: string;
  readonly packageVersion: 1;
  readonly bundleKey: string;
  readonly bundleVersion: 1;
  readonly productEntitlementKey: string;
  readonly productEntitlementVersion: 1;
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial decision record (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision record is the canonical B1 commercial decision record
 * for a single commercial flow.
 */
export interface B1CommercialDecisionRecordV1 {
  readonly contractName: B1FeeEngineContractName;
  readonly contractVersion: B1FeeEngineContractVersion;
  readonly decisionId: string;
  readonly decisionReference: string;
  readonly decisionVersion: B1CommercialDecisionVersion;
  readonly decisionKind: B1CommercialDecisionKind;
  readonly decisionOutcome: B1CommercialDecisionOutcome;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly requestHash: string;
  readonly baseAmountMinor: string;
  readonly baseCurrency: B1CommercialDecisionCurrency;
  readonly currency: B1CommercialDecisionCurrency;
  readonly accountingUnit: B1CommercialDecisionAccountingUnit;
  readonly appliedPlan: B1CommercialDecisionAppliedPlanV1 | null;
  readonly appliedPricingEntry: B1CommercialDecisionAppliedPricingEntryV1 | null;
  readonly appliedTiers: B1CommercialDecisionAppliedTierV1 | null;
  readonly appliedSubscription: B1CommercialDecisionAppliedSubscriptionV1 | null;
  readonly appliedProductEntitlement: B1CommercialDecisionAppliedProductEntitlementV1 | null;
  readonly appliedPackage: B1CommercialDecisionAppliedPackageV1 | null;
  readonly appliedBundle: B1CommercialDecisionAppliedBundleV1 | null;
  readonly appliedFeatureFlags: readonly B1CommercialDecisionAppliedFeatureFlagV1[];
  readonly appliedDynamicLimits: readonly B1CommercialDecisionAppliedDynamicLimitV1[];
  readonly feeBreakdown: B1CommercialDecisionFeeBreakdownV1 | null;
  readonly commissionBreakdown: B1CommercialDecisionCommissionBreakdownV1 | null;
  readonly revenueSharingBreakdown: B1CommercialDecisionRevenueSharingBreakdownV1 | null;
  readonly explanationTrace: B1CommercialDecisionExplanationTraceV1;
  readonly ruleTrace: B1CommercialDecisionRuleTraceV1;
  readonly auditEvidence: B1CommercialDecisionAuditEvidenceV1;
  readonly idempotencyScope: 'b1.commercial-decision.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1CommercialDecisionFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial decision failure (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision failure is the canonical B1 commercial decision
 * failure; the B1 commercial decision failure is a non-terminal
 * support-traceable artifact.
 */
export interface B1CommercialDecisionFailureV1 {
  readonly contractName: B1FeeEngineContractName;
  readonly contractVersion: B1FeeEngineContractVersion;
  readonly code: B1CommercialDecisionFailureCodeV1;
  readonly message: string;
  readonly failedRules: readonly B1CommercialDecisionRuleTraceStepV1[];
  readonly failedInputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestId: string;
  readonly generatedAt: string;
}

/**
 * The B1 commercial decision persistence record (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision persistence record is the durable TypeORM record for
 * each B1 commercial decision.
 */
export interface B1CommercialDecisionPersistenceRecordV1 {
  readonly decisionId: string;
  readonly decisionReference: string;
  readonly decisionVersion: B1CommercialDecisionVersion;
  readonly decisionKind: B1CommercialDecisionKind;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly idempotencyScope: 'b1.commercial-decision.idempotency.v1';
  readonly idempotencyKey: string;
  readonly record: B1CommercialDecisionRecordV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 commercial decision replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision replay-safe result carries the canonical B1 commercial
 * decision record alongside the replay metadata.
 */
export interface B1CommercialDecisionReplaySafeResultV1 {
  readonly record: B1CommercialDecisionRecordV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-decision.idempotency.v1';
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly decisionHash: string;
  readonly decisionReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial decision compatibility result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision compatibility result is the canonical B1 commercial
 * decision compatibility result.
 */
export type B1CommercialDecisionCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1CommercialDecisionFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 commercial decision versioning contract (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision versioning contract records the B1 commercial decision
 * version, the B1 commercial decision identity, the B1 commercial
 * decision effective-from, the B1 commercial decision effective-to,
 * the B1 commercial decision superseded-by reference, the B1
 * commercial decision supersedes reference, and the B1 commercial
 * decision migration hint.
 */
export interface B1CommercialDecisionVersioningContractV1 {
  readonly contractName: B1FeeEngineContractName;
  readonly contractVersion: B1FeeEngineContractVersion;
  readonly decisionVersion: B1CommercialDecisionVersion;
  readonly scopeKey: 'commercial.virtual-account.inbound-funding';
  readonly scopeVersion: 1;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByDecisionReference: string | null;
  readonly supersedesDecisionReference: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 commercial decision consumer port input (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision consumer port input is the canonical B1 commercial
 * decision consumer port input for the B1 commercial decision
 * read-only consumer boundary surface.
 */
export type B1CommercialDecisionConsumerPortInputV1 =
  | B1CommercialDecisionRequestV1
  | { readonly kind: 'COMPATIBILITY'; readonly request: B1CommercialDecisionRequestV1 };

/**
 * The B1 commercial decision read-only consumer ports (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial
 * decision read-only consumer ports are the canonical read-only
 * consumer boundary surface for later B1 tasks (B1T05 billing /
 * invoice / statement engine; B1T06 campaign / promotion /
 * coupon engine; B1T07 referral / cashback / loyalty engine;
 * B1T08 revenue-recognition / tax / cost-accounting engine;
 * B1T09 commercial analytics / profitability / commercial
 * reconciliation engine; B1T10 commercial data classification /
 * commercial disclosure / commercial support-trace surface;
 * B1T11 commercial release gate).
 */
export interface B1CommercialDecisionConsumerPortsV1 {
  /**
   * B1 commercial decision evaluate. Returns the canonical B1
   * commercial decision record for the supplied B1 commercial
   * decision request. The evaluate is read-only; the B1 fee
   * engine, commission engine, and revenue sharing decision
   * engine never post a journal, mutate a balance, repair a
   * binding, change A4 policy / source records, or dispatch a
   * notification.
   */
  readonly evaluate: (
    request: B1CommercialDecisionRequestV1,
  ) => Promise<B1CommercialDecisionRecordV1>;

  /**
   * B1 commercial decision replay-safe evaluate. Returns the
   * canonical B1 commercial decision replay-safe result for the
   * supplied B1 commercial decision request. The replay-safe
   * evaluate is read-only; the B1 fee engine, commission engine,
   * and revenue sharing decision engine never post a journal,
   * mutate a balance, repair a binding, change A4 policy / source
   * records, or dispatch a notification.
   */
  readonly replaySafeEvaluate: (
    request: B1CommercialDecisionRequestV1,
  ) => Promise<B1CommercialDecisionReplaySafeResultV1>;

  /**
   * B1 commercial decision compatibility check. Returns the
   * canonical B1 commercial decision compatibility result for the
   * supplied B1 commercial decision request. The compatibility
   * check is read-only; the B1 fee engine, commission engine, and
   * revenue sharing decision engine never post a journal, mutate
   * a balance, repair a binding, change A4 policy / source
   * records, or dispatch a notification.
   */
  readonly compatibilityCheck: (
    request: B1CommercialDecisionRequestV1,
  ) => Promise<B1CommercialDecisionCompatibilityResultV1>;
}
