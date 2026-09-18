/**
 * B1T05 — B1 billing engine, invoice engine, and statement-generation
 * engine types.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine is the runtime commercial-financial-effect engine
 * implementation for the B1 first commercial scope
 * (`commercial.virtual-account.inbound-funding` v1) established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1 billing
 * engine, invoice engine, and statement-generation engine consumes
 * the B1 commercial catalog (B1T03), the B1 commercial decision
 * (B1T04), the A4 product-policy decision, the A3 binding recheck,
 * the A5 Ledger account state, the A6 partner state, and the A7
 * product state through approved read-only consumer boundaries.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine is the only B1 commercial-financial-effect engine for
 * billing, invoicing, and statement generation. The B1 billing
 * engine, invoice engine, and statement-generation engine is a
 * read-only contract against the existing A1 canonical identity,
 * A2 authorization, A3 binding, A4 policy decision, A5 Ledger,
 * A6 partner-adapter, A6T05 external-operation, A6T08 settlement,
 * A6T09 external reconciliation, A6T10 data classification, A7
 * product catalog, A7 product-policy profile, A7T04 product
 * customer-binding, A7T05 product command, A7T06 product
 * notification, A7T07 product lifecycle, A7T08 product financial
 * effect, A7T09 product reconciliation, A7T10 product data
 * minimization, `CustomerPreference`, Wallet, Operations, Outbox,
 * Idempotency, Metrics, Diagnostics, Reconciliation, and
 * `CustomerPreference` authorities. The B1 billing engine, invoice
 * engine, and statement-generation engine is a read-write contract
 * against the shared Operations `IdempotencyService`,
 * `AuditService`, `OutboxService`, and `MetricsService`.
 *
 * The B1 billing engine, invoice engine, and statement-generation
 * engine NEVER:
 *  - posts a journal, mutates a balance, executes settlements,
 *    executes payouts, creates financial effects, repairs a
 *    binding, changes A4 policy / source records, or dispatches a
 *    notification;
 *  - calculates prices, fees, commissions, revenue sharing,
 *    invoices, statements, billing, promotions, cashback, loyalty,
 *    tax, cost-accounting, profitability, or financial effects
 *    outside the B1 first commercial scope;
 *  - modifies pricing catalogs, commercial decisions, product
 *    state, policy, customer bindings, or customer preferences;
 *  - dispatches notifications, executes settlements, performs
 *    payouts, or performs reconciliation.
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
 * by B1T05.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingEngineContractName = 'B1-BILLING-ENGINE';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingEngineContractVersion = 1;

/**
 * The B1 billing record state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingRecordState = 'CREATED' | 'READY' | 'ISSUED' | 'CANCELLED' | 'REPLAYED';

/**
 * The B1 invoice state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1InvoiceState = 'DRAFT' | 'GENERATED' | 'ISSUED' | 'CANCELLED' | 'VOIDED';

/**
 * The B1 statement state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1StatementState = 'OPEN' | 'GENERATED' | 'CLOSED' | 'REGENERATED';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine document kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingDocumentKind =
  | 'BILLING_RECORD'
  | 'INVOICE'
  | 'INVOICE_LINE'
  | 'STATEMENT'
  | 'STATEMENT_LINE'
  | 'BILLING_PERIOD'
  | 'STATEMENT_PERIOD';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine document version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingDocumentVersion = 1;

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingEngineScopeKey = 'commercial.virtual-account.inbound-funding';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingEngineScopeVersion = 1;

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingEngineCurrency = 'NGN';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingEngineAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine billing period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingPeriodKey =
  'commercial.virtual-account.inbound-funding.billing-period.per-transaction.v1';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine billing period version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingPeriodVersion = 1;

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine statement period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1StatementPeriodKey =
  'commercial.virtual-account.inbound-funding.statement-period.daily.v1';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine statement period version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1StatementPeriodVersion = 1;

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine billing line kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingLineKind =
  | 'FEE'
  | 'COMMISSION'
  | 'REVENUE_SHARING'
  | 'ADJUSTMENT'
  | 'ROUNDING'
  | 'PRORATION'
  | 'RECONCILIATION';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine document failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingDocumentFailureCodeV1 =
  | 'B1_BILLING_ENGINE_INVALID_COMMAND'
  | 'B1_BILLING_ENGINE_INCOMPATIBLE'
  | 'B1_BILLING_ENGINE_QUERY_UNAVAILABLE'
  | 'B1_BILLING_ENGINE_PROHIBITED'
  | 'B1_BILLING_ENGINE_DECISION_NOT_FOUND'
  | 'B1_BILLING_ENGINE_DECISION_INCOMPATIBLE'
  | 'B1_BILLING_ENGINE_CATALOG_INCOMPATIBLE'
  | 'B1_BILLING_ENGINE_CATALOG_MISSING'
  | 'B1_BILLING_ENGINE_A4_POLICY_DENIED'
  | 'B1_BILLING_ENGINE_A3_BINDING_INVALID'
  | 'B1_BILLING_ENGINE_A5_LEDGER_INVARIANT_BROKEN'
  | 'B1_BILLING_ENGINE_A6_PARTNER_INCOMPATIBLE'
  | 'B1_BILLING_ENGINE_A7_PRODUCT_INCOMPATIBLE'
  | 'B1_BILLING_ENGINE_REPLAY_CONFLICT'
  | 'B1_BILLING_ENGINE_REPLAY_EXPIRED'
  | 'B1_BILLING_ENGINE_IN_PROGRESS'
  | 'B1_BILLING_ENGINE_NUMBER_CONFLICT'
  | 'B1_BILLING_ENGINE_NUMBER_RESERVED';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine billing period (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingPeriodV1 {
  readonly periodKey: B1BillingPeriodKey;
  readonly periodVersion: B1BillingPeriodVersion;
  readonly periodScopeKey: B1BillingEngineScopeKey;
  readonly periodScopeVersion: B1BillingEngineScopeVersion;
  readonly periodCycle: 'PER_TRANSACTION';
  readonly periodCurrency: B1BillingEngineCurrency;
  readonly periodAccountingUnit: B1BillingEngineAccountingUnit;
  readonly periodEffectiveFrom: string | null;
  readonly periodEffectiveTo: string | null;
  readonly periodRetentionDays: number;
  readonly periodClassificationLevel:
    | 'PUBLIC'
    | 'INTERNAL'
    | 'CONFIDENTIAL'
    | 'RESTRICTED'
    | 'HIGHLY_RESTRICTED';
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine statement period (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1StatementPeriodV1 {
  readonly periodKey: B1StatementPeriodKey;
  readonly periodVersion: B1StatementPeriodVersion;
  readonly periodScopeKey: B1BillingEngineScopeKey;
  readonly periodScopeVersion: B1BillingEngineScopeVersion;
  readonly periodCycle: 'DAILY';
  readonly periodCurrency: B1BillingEngineCurrency;
  readonly periodAccountingUnit: B1BillingEngineAccountingUnit;
  readonly periodEffectiveFrom: string | null;
  readonly periodEffectiveTo: string | null;
  readonly periodRetentionDays: number;
  readonly periodClassificationLevel:
    | 'PUBLIC'
    | 'INTERNAL'
    | 'CONFIDENTIAL'
    | 'RESTRICTED'
    | 'HIGHLY_RESTRICTED';
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine billing record (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingRecordV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly billingRecordId: string;
  readonly billingRecordReference: string;
  readonly billingRecordVersion: B1BillingDocumentVersion;
  readonly billingRecordState: B1BillingRecordState;
  readonly billingRecordHash: string;
  readonly billingRecordReplayHash: string;
  readonly billingRequestHash: string;
  readonly scopeKey: B1BillingEngineScopeKey;
  readonly scopeVersion: B1BillingEngineScopeVersion;
  readonly periodKey: B1BillingPeriodKey;
  readonly periodVersion: B1BillingPeriodVersion;
  readonly periodCycle: 'PER_TRANSACTION';
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
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
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly baseAmountMinor: string;
  readonly baseCurrency: B1BillingEngineCurrency;
  readonly currency: B1BillingEngineCurrency;
  readonly accountingUnit: B1BillingEngineAccountingUnit;
  readonly feeMinor: string;
  readonly commissionMinor: string;
  readonly revenueSharingMinor: string;
  readonly totalMinor: string;
  readonly commercialDecisionReference: string;
  readonly commercialDecisionHash: string;
  readonly commercialDecisionReplayHash: string;
  readonly commercialDecisionIdempotencyKey: string;
  readonly explanationTrace: B1BillingExplanationTraceV1;
  readonly ruleTrace: B1BillingRuleTraceV1;
  readonly auditEvidence: B1BillingAuditEvidenceV1;
  readonly idempotencyScope: 'b1.billing-engine.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1BillingDocumentFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine invoice line (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1InvoiceLineV1 {
  readonly invoiceLineId: string;
  readonly invoiceLineReference: string;
  readonly invoiceLineVersion: B1BillingDocumentVersion;
  readonly billingRecordReference: string;
  readonly lineKind: B1BillingLineKind;
  readonly lineDescription: string;
  readonly lineAmountMinor: string;
  readonly lineCurrency: B1BillingEngineCurrency;
  readonly lineAccountingUnit: B1BillingEngineAccountingUnit;
  readonly lineOrder: number;
  readonly commercialDecisionReference: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine invoice (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1InvoiceV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly invoiceVersion: B1BillingDocumentVersion;
  readonly invoiceState: B1InvoiceState;
  readonly invoiceHash: string;
  readonly invoiceReplayHash: string;
  readonly billingRequestHash: string;
  readonly scopeKey: B1BillingEngineScopeKey;
  readonly scopeVersion: B1BillingEngineScopeVersion;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
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
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly baseAmountMinor: string;
  readonly baseCurrency: B1BillingEngineCurrency;
  readonly currency: B1BillingEngineCurrency;
  readonly accountingUnit: B1BillingEngineAccountingUnit;
  readonly feeMinor: string;
  readonly commissionMinor: string;
  readonly revenueSharingMinor: string;
  readonly totalMinor: string;
  readonly periodKey: B1BillingPeriodKey;
  readonly periodVersion: B1BillingPeriodVersion;
  readonly issuedAt: string;
  readonly commercialDecisionReferences: readonly string[];
  readonly commercialDecisionIdempotencyKeys: readonly string[];
  readonly explanationTrace: B1BillingExplanationTraceV1;
  readonly ruleTrace: B1BillingRuleTraceV1;
  readonly auditEvidence: B1BillingAuditEvidenceV1;
  readonly idempotencyScope: 'b1.billing-engine.invoice.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1BillingDocumentFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
  readonly invoiceLines: readonly B1InvoiceLineV1[];
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine statement line (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1StatementLineV1 {
  readonly statementLineId: string;
  readonly statementLineReference: string;
  readonly statementLineVersion: B1BillingDocumentVersion;
  readonly invoiceReference: string;
  readonly lineKind: B1BillingLineKind;
  readonly lineDescription: string;
  readonly lineAmountMinor: string;
  readonly lineCurrency: B1BillingEngineCurrency;
  readonly lineAccountingUnit: B1BillingEngineAccountingUnit;
  readonly lineOrder: number;
  readonly commercialDecisionReference: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine statement (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1StatementV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly statementId: string;
  readonly statementNumber: string;
  readonly statementVersion: B1BillingDocumentVersion;
  readonly statementState: B1StatementState;
  readonly statementHash: string;
  readonly statementReplayHash: string;
  readonly billingRequestHash: string;
  readonly scopeKey: B1BillingEngineScopeKey;
  readonly scopeVersion: B1BillingEngineScopeVersion;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly periodKey: B1StatementPeriodKey;
  readonly periodVersion: B1StatementPeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly baseAmountMinor: string;
  readonly baseCurrency: B1BillingEngineCurrency;
  readonly currency: B1BillingEngineCurrency;
  readonly accountingUnit: B1BillingEngineAccountingUnit;
  readonly openingBalanceMinor: string;
  readonly closingBalanceMinor: string;
  readonly feeMinor: string;
  readonly commissionMinor: string;
  readonly revenueSharingMinor: string;
  readonly totalDebitMinor: string;
  readonly totalCreditMinor: string;
  readonly totalMinor: string;
  readonly issuedAt: string;
  readonly invoiceReferences: readonly string[];
  readonly commercialDecisionReferences: readonly string[];
  readonly commercialDecisionIdempotencyKeys: readonly string[];
  readonly explanationTrace: B1BillingExplanationTraceV1;
  readonly ruleTrace: B1BillingRuleTraceV1;
  readonly auditEvidence: B1BillingAuditEvidenceV1;
  readonly idempotencyScope: 'b1.billing-engine.statement.idempotency.v1';
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly failure: B1BillingDocumentFailureV1 | null;
  readonly generatedAt: string;
  readonly correlationId: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
  readonly statementLines: readonly B1StatementLineV1[];
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine audit evidence (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingAuditEvidenceV1 {
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
 * The B1 billing engine, invoice engine, and statement-generation
 * engine explanation trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingExplanationTraceV1 {
  readonly traceId: string;
  readonly traceKind:
    | 'BILLING_RECORD_DECISION'
    | 'INVOICE_DECISION'
    | 'STATEMENT_DECISION'
    | 'BILLING_ENGINE_COMPOSITE_DECISION';
  readonly traceSummary: string;
  readonly traceSteps: readonly B1BillingExplanationStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine explanation step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingExplanationStepV1 {
  readonly stepIndex: number;
  readonly stepKind: B1BillingRuleKindV1;
  readonly stepLabel: string;
  readonly stepOutcome: B1BillingRuleOutcomeV1;
  readonly stepReasonCode: string;
  readonly stepReason: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
  readonly stepOutputs: Readonly<Record<string, unknown>>;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine rule kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingRuleKindV1 =
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
  | 'B1_BILLING_ENGINE_NUMBER_DETERMINISTIC'
  | 'B1_BILLING_ENGINE_DOCUMENT_VERSION';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine rule outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingRuleOutcomeV1 = 'PASS' | 'FAIL' | 'SKIP' | 'NOT_APPLICABLE';

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine rule trace (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingRuleTraceV1 {
  readonly ruleTraceId: string;
  readonly ruleTraceSteps: readonly B1BillingRuleTraceStepV1[];
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine rule trace step (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingRuleTraceStepV1 {
  readonly stepIndex: number;
  readonly ruleKind: B1BillingRuleKindV1;
  readonly ruleId: string;
  readonly ruleLabel: string;
  readonly ruleOutcome: B1BillingRuleOutcomeV1;
  readonly ruleReasonCode: string;
  readonly ruleEvaluatedAt: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine document failure (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingDocumentFailureV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly code: B1BillingDocumentFailureCodeV1;
  readonly message: string;
  readonly failedRules: readonly B1BillingRuleTraceStepV1[];
  readonly failedInputs: Readonly<Record<string, unknown>>;
  readonly correlationId: string;
  readonly requestId: string;
  readonly generatedAt: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine billing request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingRequestV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly billingRequestId: string;
  readonly billingRequestVersion: B1BillingDocumentVersion;
  readonly scopeKey: B1BillingEngineScopeKey;
  readonly scopeVersion: B1BillingEngineScopeVersion;
  readonly expectedCurrency: B1BillingEngineCurrency;
  readonly expectedAccountingUnit: B1BillingEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
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
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly periodKey: B1BillingPeriodKey;
  readonly periodVersion: B1BillingPeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly commercialDecisionReferences: readonly string[];
  readonly commercialDecisionIdempotencyKeys: readonly string[];
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine invoice request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1InvoiceRequestV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly invoiceRequestId: string;
  readonly invoiceRequestVersion: B1BillingDocumentVersion;
  readonly scopeKey: B1BillingEngineScopeKey;
  readonly scopeVersion: B1BillingEngineScopeVersion;
  readonly expectedCurrency: B1BillingEngineCurrency;
  readonly expectedAccountingUnit: B1BillingEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
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
  readonly customerTierKey: string;
  readonly customerTierVersion: 1;
  readonly merchantTierKey: string;
  readonly merchantTierVersion: 1;
  readonly partnerTierKey: string;
  readonly partnerTierVersion: 1;
  readonly billingRecordReferences: readonly string[];
  readonly commercialDecisionReferences: readonly string[];
  readonly commercialDecisionIdempotencyKeys: readonly string[];
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine statement request (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1StatementRequestV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly statementRequestId: string;
  readonly statementRequestVersion: B1BillingDocumentVersion;
  readonly scopeKey: B1BillingEngineScopeKey;
  readonly scopeVersion: B1BillingEngineScopeVersion;
  readonly expectedCurrency: B1BillingEngineCurrency;
  readonly expectedAccountingUnit: B1BillingEngineAccountingUnit;
  readonly customerId: string;
  readonly merchantId: string;
  readonly partnerId: string;
  readonly productKey: 'VIRTUAL_ACCOUNT';
  readonly productVersion: 1;
  readonly periodKey: B1StatementPeriodKey;
  readonly periodVersion: B1StatementPeriodVersion;
  readonly periodOpenAt: string;
  readonly periodCloseAt: string;
  readonly periodEffectiveAt: string;
  readonly billingRecordReferences: readonly string[];
  readonly invoiceReferences: readonly string[];
  readonly commercialDecisionReferences: readonly string[];
  readonly commercialDecisionIdempotencyKeys: readonly string[];
  readonly idempotencyKey: string;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine billing record replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingRecordReplaySafeResultV1 {
  readonly record: B1BillingRecordV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.billing-engine.idempotency.v1';
  readonly idempotencyKey: string;
  readonly billingRequestHash: string;
  readonly billingRecordHash: string;
  readonly billingRecordReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine invoice replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1InvoiceReplaySafeResultV1 {
  readonly invoice: B1InvoiceV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.billing-engine.invoice.idempotency.v1';
  readonly idempotencyKey: string;
  readonly invoiceRequestHash: string;
  readonly invoiceHash: string;
  readonly invoiceReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine statement replay-safe result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1StatementReplaySafeResultV1 {
  readonly statement: B1StatementV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.billing-engine.statement.idempotency.v1';
  readonly idempotencyKey: string;
  readonly statementRequestHash: string;
  readonly statementHash: string;
  readonly statementReplayHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine compatibility result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export type B1BillingDocumentCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1BillingDocumentFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine document versioning contract (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingDocumentVersioningContractV1 {
  readonly contractName: B1BillingEngineContractName;
  readonly contractVersion: B1BillingEngineContractVersion;
  readonly documentVersion: B1BillingDocumentVersion;
  readonly scopeKey: B1BillingEngineScopeKey;
  readonly scopeVersion: B1BillingEngineScopeVersion;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByDocumentReference: string | null;
  readonly supersedesDocumentReference: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine document persistence record (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingDocumentPersistenceRecordV1 {
  readonly documentId: string;
  readonly documentReference: string;
  readonly documentVersion: B1BillingDocumentVersion;
  readonly documentKind: B1BillingDocumentKind;
  readonly documentHash: string;
  readonly documentReplayHash: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly record:
    | B1BillingRecordV1
    | B1InvoiceV1
    | B1StatementV1
    | B1InvoiceLineV1
    | B1StatementLineV1
    | B1BillingPeriodV1
    | B1StatementPeriodV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 billing engine, invoice engine, and statement-generation
 * engine read-only consumer ports (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export interface B1BillingEngineConsumerPortsV1 {
  /**
   * B1 billing record generate. Returns the canonical B1 billing
   * record for the supplied B1 billing request. The generate is
   * read-only; the B1 billing engine never posts a journal,
   * mutates a balance, repairs a binding, changes A4 policy /
   * source records, or dispatches a notification.
   */
  readonly generateBillingRecord: (request: B1BillingRequestV1) => Promise<B1BillingRecordV1>;

  /**
   * B1 billing record replay-safe generate. Returns the canonical
   * B1 billing record replay-safe result for the supplied B1
   * billing request. The replay-safe generate is read-only; the
   * B1 billing engine never posts a journal, mutates a balance,
   * repairs a binding, changes A4 policy / source records, or
   * dispatches a notification.
   */
  readonly replaySafeGenerateBillingRecord: (
    request: B1BillingRequestV1,
  ) => Promise<B1BillingRecordReplaySafeResultV1>;

  /**
   * B1 invoice generate. Returns the canonical B1 invoice for the
   * supplied B1 invoice request. The generate is read-only; the
   * B1 invoice engine never posts a journal, mutates a balance,
   * repairs a binding, changes A4 policy / source records, or
   * dispatches a notification.
   */
  readonly generateInvoice: (request: B1InvoiceRequestV1) => Promise<B1InvoiceV1>;

  /**
   * B1 invoice replay-safe generate. Returns the canonical B1
   * invoice replay-safe result for the supplied B1 invoice
   * request. The replay-safe generate is read-only; the B1
   * invoice engine never posts a journal, mutates a balance,
   * repairs a binding, changes A4 policy / source records, or
   * dispatches a notification.
   */
  readonly replaySafeGenerateInvoice: (
    request: B1InvoiceRequestV1,
  ) => Promise<B1InvoiceReplaySafeResultV1>;

  /**
   * B1 statement generate. Returns the canonical B1 statement for
   * the supplied B1 statement request. The generate is read-only;
   * the B1 statement engine never posts a journal, mutates a
   * balance, repairs a binding, changes A4 policy / source
   * records, or dispatches a notification.
   */
  readonly generateStatement: (request: B1StatementRequestV1) => Promise<B1StatementV1>;

  /**
   * B1 statement replay-safe generate. Returns the canonical B1
   * statement replay-safe result for the supplied B1 statement
   * request. The replay-safe generate is read-only; the B1
   * statement engine never posts a journal, mutates a balance,
   * repairs a binding, changes A4 policy / source records, or
   * dispatches a notification.
   */
  readonly replaySafeGenerateStatement: (
    request: B1StatementRequestV1,
  ) => Promise<B1StatementReplaySafeResultV1>;

  /**
   * B1 billing document compatibility check. Returns the
   * canonical B1 billing document compatibility result for the
   * supplied B1 billing / invoice / statement request. The
   * compatibility check is read-only; the B1 billing engine
   * never posts a journal, mutates a balance, repairs a
   * binding, changes A4 policy / source records, or dispatches a
   * notification.
   */
  readonly compatibilityCheck: (
    request: B1BillingRequestV1 | B1InvoiceRequestV1 | B1StatementRequestV1,
  ) => Promise<B1BillingDocumentCompatibilityResultV1>;
}
