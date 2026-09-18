/**
 * B1T05 — B1 billing engine, invoice engine, and statement-generation
 * engine frozen constants.
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
 * `CustomerPreference` authorities.
 */

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_CONTRACT_NAME = 'B1-BILLING-ENGINE' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_CONTRACT_VERSION = 1 as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine contract document reference.
 */
export const B1_BILLING_ENGINE_CONTRACT_DOCUMENT = 'docs/B1-BILLING-ENGINE-CONTRACT.md' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine internal idempotency scope (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE =
  'b1.billing-engine.idempotency.v1' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine invoice internal idempotency scope (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_INVOICE_IDEMPOTENCY_SCOPE =
  'b1.billing-engine.invoice.idempotency.v1' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine statement internal idempotency scope (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_STATEMENT_IDEMPOTENCY_SCOPE =
  'b1.billing-engine.statement.idempotency.v1' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine internal idempotency retention (frozen; 24 hours,
 * aligned with the shared Operations `IdempotencyService`
 * default).
 */
export const B1_BILLING_ENGINE_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine audit entity type (frozen).
 */
export const B1_BILLING_ENGINE_AUDIT_ENTITY_TYPE = 'B1_BILLING_DOCUMENT' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine audit actor (frozen).
 */
export const B1_BILLING_ENGINE_AUDIT_ACTOR = 'b1-billing-engine' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine outbox event type (frozen).
 */
export const B1_BILLING_ENGINE_OUTBOX_EVENT_TYPE = 'B1BillingDocumentGenerated' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine outbox event classification (frozen).
 */
export const B1_BILLING_ENGINE_OUTBOX_EVENT_CLASSIFICATION = 'INTERNAL_OPERATIONS' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine outbox event retention class (frozen).
 */
export const B1_BILLING_ENGINE_OUTBOX_EVENT_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine reference prefix (frozen).
 */
export const B1_BILLING_ENGINE_REFERENCE_PREFIX = 'b1-billing-document' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_SCOPE_KEY = 'commercial.virtual-account.inbound-funding' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_SCOPE_VERSION = 1 as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_SCOPE_CURRENCY = 'NGN' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_SCOPE_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope product dependency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY = 'VIRTUAL_ACCOUNT' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope product dependency version (frozen).
 */
export const B1_BILLING_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION = 1 as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope partner dependency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_SCOPE_PARTNER_DEPENDENCY = 'NIBSS_NIP' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine scope direction (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_SCOPE_DIRECTION = 'inbound' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine billing period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_BILLING_PERIOD_KEY =
  'commercial.virtual-account.inbound-funding.billing-period.per-transaction.v1' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine statement period key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_STATEMENT_PERIOD_KEY =
  'commercial.virtual-account.inbound-funding.statement-period.daily.v1' as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine retention days (frozen; 365 days, aligned with the
 * B1T03 catalog retention).
 */
export const B1_BILLING_ENGINE_RETENTION_DAYS = 365 as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine billing record state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_BILLING_RECORD_STATE_CREATED = 'CREATED' as const;
export const B1_BILLING_ENGINE_BILLING_RECORD_STATE_READY = 'READY' as const;
export const B1_BILLING_ENGINE_BILLING_RECORD_STATE_ISSUED = 'ISSUED' as const;
export const B1_BILLING_ENGINE_BILLING_RECORD_STATE_CANCELLED = 'CANCELLED' as const;
export const B1_BILLING_ENGINE_BILLING_RECORD_STATE_REPLAYED = 'REPLAYED' as const;

export const B1_BILLING_ENGINE_BILLING_RECORD_STATES = [
  B1_BILLING_ENGINE_BILLING_RECORD_STATE_CREATED,
  B1_BILLING_ENGINE_BILLING_RECORD_STATE_READY,
  B1_BILLING_ENGINE_BILLING_RECORD_STATE_ISSUED,
  B1_BILLING_ENGINE_BILLING_RECORD_STATE_CANCELLED,
  B1_BILLING_ENGINE_BILLING_RECORD_STATE_REPLAYED,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine invoice state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_INVOICE_STATE_DRAFT = 'DRAFT' as const;
export const B1_BILLING_ENGINE_INVOICE_STATE_GENERATED = 'GENERATED' as const;
export const B1_BILLING_ENGINE_INVOICE_STATE_ISSUED = 'ISSUED' as const;
export const B1_BILLING_ENGINE_INVOICE_STATE_CANCELLED = 'CANCELLED' as const;
export const B1_BILLING_ENGINE_INVOICE_STATE_VOIDED = 'VOIDED' as const;

export const B1_BILLING_ENGINE_INVOICE_STATES = [
  B1_BILLING_ENGINE_INVOICE_STATE_DRAFT,
  B1_BILLING_ENGINE_INVOICE_STATE_GENERATED,
  B1_BILLING_ENGINE_INVOICE_STATE_ISSUED,
  B1_BILLING_ENGINE_INVOICE_STATE_CANCELLED,
  B1_BILLING_ENGINE_INVOICE_STATE_VOIDED,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine statement state vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_STATEMENT_STATE_OPEN = 'OPEN' as const;
export const B1_BILLING_ENGINE_STATEMENT_STATE_GENERATED = 'GENERATED' as const;
export const B1_BILLING_ENGINE_STATEMENT_STATE_CLOSED = 'CLOSED' as const;
export const B1_BILLING_ENGINE_STATEMENT_STATE_REGENERATED = 'REGENERATED' as const;

export const B1_BILLING_ENGINE_STATEMENT_STATES = [
  B1_BILLING_ENGINE_STATEMENT_STATE_OPEN,
  B1_BILLING_ENGINE_STATEMENT_STATE_GENERATED,
  B1_BILLING_ENGINE_STATEMENT_STATE_CLOSED,
  B1_BILLING_ENGINE_STATEMENT_STATE_REGENERATED,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine document kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_DOCUMENT_KIND_BILLING_RECORD = 'BILLING_RECORD' as const;
export const B1_BILLING_ENGINE_DOCUMENT_KIND_INVOICE = 'INVOICE' as const;
export const B1_BILLING_ENGINE_DOCUMENT_KIND_INVOICE_LINE = 'INVOICE_LINE' as const;
export const B1_BILLING_ENGINE_DOCUMENT_KIND_STATEMENT = 'STATEMENT' as const;
export const B1_BILLING_ENGINE_DOCUMENT_KIND_STATEMENT_LINE = 'STATEMENT_LINE' as const;
export const B1_BILLING_ENGINE_DOCUMENT_KIND_BILLING_PERIOD = 'BILLING_PERIOD' as const;
export const B1_BILLING_ENGINE_DOCUMENT_KIND_STATEMENT_PERIOD = 'STATEMENT_PERIOD' as const;

export const B1_BILLING_ENGINE_DOCUMENT_KINDS = [
  B1_BILLING_ENGINE_DOCUMENT_KIND_BILLING_RECORD,
  B1_BILLING_ENGINE_DOCUMENT_KIND_INVOICE,
  B1_BILLING_ENGINE_DOCUMENT_KIND_INVOICE_LINE,
  B1_BILLING_ENGINE_DOCUMENT_KIND_STATEMENT,
  B1_BILLING_ENGINE_DOCUMENT_KIND_STATEMENT_LINE,
  B1_BILLING_ENGINE_DOCUMENT_KIND_BILLING_PERIOD,
  B1_BILLING_ENGINE_DOCUMENT_KIND_STATEMENT_PERIOD,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine billing line kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_LINE_KIND_FEE = 'FEE' as const;
export const B1_BILLING_ENGINE_LINE_KIND_COMMISSION = 'COMMISSION' as const;
export const B1_BILLING_ENGINE_LINE_KIND_REVENUE_SHARING = 'REVENUE_SHARING' as const;
export const B1_BILLING_ENGINE_LINE_KIND_ADJUSTMENT = 'ADJUSTMENT' as const;
export const B1_BILLING_ENGINE_LINE_KIND_ROUNDING = 'ROUNDING' as const;
export const B1_BILLING_ENGINE_LINE_KIND_PRORATION = 'PRORATION' as const;
export const B1_BILLING_ENGINE_LINE_KIND_RECONCILIATION = 'RECONCILIATION' as const;

export const B1_BILLING_ENGINE_LINE_KINDS = [
  B1_BILLING_ENGINE_LINE_KIND_FEE,
  B1_BILLING_ENGINE_LINE_KIND_COMMISSION,
  B1_BILLING_ENGINE_LINE_KIND_REVENUE_SHARING,
  B1_BILLING_ENGINE_LINE_KIND_ADJUSTMENT,
  B1_BILLING_ENGINE_LINE_KIND_ROUNDING,
  B1_BILLING_ENGINE_LINE_KIND_PRORATION,
  B1_BILLING_ENGINE_LINE_KIND_RECONCILIATION,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine document failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND =
  'B1_BILLING_ENGINE_INVALID_COMMAND' as const;
export const B1_BILLING_ENGINE_FAILURE_INCOMPATIBLE = 'B1_BILLING_ENGINE_INCOMPATIBLE' as const;
export const B1_BILLING_ENGINE_FAILURE_QUERY_UNAVAILABLE =
  'B1_BILLING_ENGINE_QUERY_UNAVAILABLE' as const;
export const B1_BILLING_ENGINE_FAILURE_PROHIBITED = 'B1_BILLING_ENGINE_PROHIBITED' as const;
export const B1_BILLING_ENGINE_FAILURE_DECISION_NOT_FOUND =
  'B1_BILLING_ENGINE_DECISION_NOT_FOUND' as const;
export const B1_BILLING_ENGINE_FAILURE_DECISION_INCOMPATIBLE =
  'B1_BILLING_ENGINE_DECISION_INCOMPATIBLE' as const;
export const B1_BILLING_ENGINE_FAILURE_CATALOG_INCOMPATIBLE =
  'B1_BILLING_ENGINE_CATALOG_INCOMPATIBLE' as const;
export const B1_BILLING_ENGINE_FAILURE_CATALOG_MISSING =
  'B1_BILLING_ENGINE_CATALOG_MISSING' as const;
export const B1_BILLING_ENGINE_FAILURE_A4_POLICY_DENIED =
  'B1_BILLING_ENGINE_A4_POLICY_DENIED' as const;
export const B1_BILLING_ENGINE_FAILURE_A3_BINDING_INVALID =
  'B1_BILLING_ENGINE_A3_BINDING_INVALID' as const;
export const B1_BILLING_ENGINE_FAILURE_A5_LEDGER_INVARIANT_BROKEN =
  'B1_BILLING_ENGINE_A5_LEDGER_INVARIANT_BROKEN' as const;
export const B1_BILLING_ENGINE_FAILURE_A6_PARTNER_INCOMPATIBLE =
  'B1_BILLING_ENGINE_A6_PARTNER_INCOMPATIBLE' as const;
export const B1_BILLING_ENGINE_FAILURE_A7_PRODUCT_INCOMPATIBLE =
  'B1_BILLING_ENGINE_A7_PRODUCT_INCOMPATIBLE' as const;
export const B1_BILLING_ENGINE_FAILURE_REPLAY_CONFLICT =
  'B1_BILLING_ENGINE_REPLAY_CONFLICT' as const;
export const B1_BILLING_ENGINE_FAILURE_REPLAY_EXPIRED = 'B1_BILLING_ENGINE_REPLAY_EXPIRED' as const;
export const B1_BILLING_ENGINE_FAILURE_IN_PROGRESS = 'B1_BILLING_ENGINE_IN_PROGRESS' as const;
export const B1_BILLING_ENGINE_FAILURE_NUMBER_CONFLICT =
  'B1_BILLING_ENGINE_NUMBER_CONFLICT' as const;
export const B1_BILLING_ENGINE_FAILURE_NUMBER_RESERVED =
  'B1_BILLING_ENGINE_NUMBER_RESERVED' as const;

export const B1_BILLING_ENGINE_FAILURE_CODES = [
  B1_BILLING_ENGINE_FAILURE_INVALID_COMMAND,
  B1_BILLING_ENGINE_FAILURE_INCOMPATIBLE,
  B1_BILLING_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_BILLING_ENGINE_FAILURE_PROHIBITED,
  B1_BILLING_ENGINE_FAILURE_DECISION_NOT_FOUND,
  B1_BILLING_ENGINE_FAILURE_DECISION_INCOMPATIBLE,
  B1_BILLING_ENGINE_FAILURE_CATALOG_INCOMPATIBLE,
  B1_BILLING_ENGINE_FAILURE_CATALOG_MISSING,
  B1_BILLING_ENGINE_FAILURE_A4_POLICY_DENIED,
  B1_BILLING_ENGINE_FAILURE_A3_BINDING_INVALID,
  B1_BILLING_ENGINE_FAILURE_A5_LEDGER_INVARIANT_BROKEN,
  B1_BILLING_ENGINE_FAILURE_A6_PARTNER_INCOMPATIBLE,
  B1_BILLING_ENGINE_FAILURE_A7_PRODUCT_INCOMPATIBLE,
  B1_BILLING_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_BILLING_ENGINE_FAILURE_REPLAY_EXPIRED,
  B1_BILLING_ENGINE_FAILURE_IN_PROGRESS,
  B1_BILLING_ENGINE_FAILURE_NUMBER_CONFLICT,
  B1_BILLING_ENGINE_FAILURE_NUMBER_RESERVED,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine metric names (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_METRIC_BILLING_RECORD = 'b1.billing-engine.billing-record' as const;
export const B1_BILLING_ENGINE_METRIC_INVOICE = 'b1.billing-engine.invoice' as const;
export const B1_BILLING_ENGINE_METRIC_STATEMENT = 'b1.billing-engine.statement' as const;
export const B1_BILLING_ENGINE_METRIC_REPLAYED = 'b1.billing-engine.replayed' as const;
export const B1_BILLING_ENGINE_METRIC_CONFLICT = 'b1.billing-engine.conflict' as const;
export const B1_BILLING_ENGINE_METRIC_INCOMPATIBLE = 'b1.billing-engine.incompatible' as const;
export const B1_BILLING_ENGINE_METRIC_QUERY_UNAVAILABLE =
  'b1.billing-engine.query-unavailable' as const;
export const B1_BILLING_ENGINE_METRIC_IN_PROGRESS = 'b1.billing-engine.in-progress' as const;
export const B1_BILLING_ENGINE_METRIC_REPLAY_CONFLICT =
  'b1.billing-engine.replay-conflict' as const;
export const B1_BILLING_ENGINE_METRIC_REPLAY_EXPIRED = 'b1.billing-engine.replay-expired' as const;
export const B1_BILLING_ENGINE_METRIC_NUMBER_CONFLICT =
  'b1.billing-engine.number-conflict' as const;
export const B1_BILLING_ENGINE_METRIC_NUMBER_RESERVED =
  'b1.billing-engine.number-reserved' as const;
export const B1_BILLING_ENGINE_METRIC_A4_POLICY_DENIED =
  'b1.billing-engine.a4-policy-denied' as const;
export const B1_BILLING_ENGINE_METRIC_A3_BINDING_INVALID =
  'b1.billing-engine.a3-binding-invalid' as const;
export const B1_BILLING_ENGINE_METRIC_A5_LEDGER_INVARIANT_BROKEN =
  'b1.billing-engine.a5-ledger-invariant-broken' as const;
export const B1_BILLING_ENGINE_METRIC_A6_PARTNER_INCOMPATIBLE =
  'b1.billing-engine.a6-partner-incompatible' as const;
export const B1_BILLING_ENGINE_METRIC_A7_PRODUCT_INCOMPATIBLE =
  'b1.billing-engine.a7-product-incompatible' as const;
export const B1_BILLING_ENGINE_METRIC_CATALOG_INCOMPATIBLE =
  'b1.billing-engine.catalog-incompatible' as const;
export const B1_BILLING_ENGINE_METRIC_CATALOG_MISSING =
  'b1.billing-engine.catalog-missing' as const;
export const B1_BILLING_ENGINE_METRIC_DECISION_NOT_FOUND =
  'b1.billing-engine.decision-not-found' as const;
export const B1_BILLING_ENGINE_METRIC_DECISION_INCOMPATIBLE =
  'b1.billing-engine.decision-incompatible' as const;

export const B1_BILLING_ENGINE_METRICS = [
  B1_BILLING_ENGINE_METRIC_BILLING_RECORD,
  B1_BILLING_ENGINE_METRIC_INVOICE,
  B1_BILLING_ENGINE_METRIC_STATEMENT,
  B1_BILLING_ENGINE_METRIC_REPLAYED,
  B1_BILLING_ENGINE_METRIC_CONFLICT,
  B1_BILLING_ENGINE_METRIC_INCOMPATIBLE,
  B1_BILLING_ENGINE_METRIC_QUERY_UNAVAILABLE,
  B1_BILLING_ENGINE_METRIC_IN_PROGRESS,
  B1_BILLING_ENGINE_METRIC_REPLAY_CONFLICT,
  B1_BILLING_ENGINE_METRIC_REPLAY_EXPIRED,
  B1_BILLING_ENGINE_METRIC_NUMBER_CONFLICT,
  B1_BILLING_ENGINE_METRIC_NUMBER_RESERVED,
  B1_BILLING_ENGINE_METRIC_A4_POLICY_DENIED,
  B1_BILLING_ENGINE_METRIC_A3_BINDING_INVALID,
  B1_BILLING_ENGINE_METRIC_A5_LEDGER_INVARIANT_BROKEN,
  B1_BILLING_ENGINE_METRIC_A6_PARTNER_INCOMPATIBLE,
  B1_BILLING_ENGINE_METRIC_A7_PRODUCT_INCOMPATIBLE,
  B1_BILLING_ENGINE_METRIC_CATALOG_INCOMPATIBLE,
  B1_BILLING_ENGINE_METRIC_CATALOG_MISSING,
  B1_BILLING_ENGINE_METRIC_DECISION_NOT_FOUND,
  B1_BILLING_ENGINE_METRIC_DECISION_INCOMPATIBLE,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine classification level vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_CLASSIFICATION_LEVELS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine data control classifications (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_DATA_CONTROL_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine rule kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_RULE_KIND_A3_BINDING_RECHECK = 'A3_BINDING_RECHECK' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_CURRENTNESS = 'A4_POLICY_CURRENTNESS' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_OBLIGATION = 'A4_POLICY_OBLIGATION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_REEVALUATION = 'A4_POLICY_REEVALUATION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_LIMIT = 'A4_POLICY_LIMIT' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE =
  'A5_LEDGER_ACCOUNT_STATE' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A5_LEDGER_POSTING_BOUNDARY =
  'A5_LEDGER_POSTING_BOUNDARY' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS =
  'A5_FINANCIAL_INVARIANTS' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A6_PARTNER_STATE = 'A6_PARTNER_STATE' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A6_PARTNER_CAPABILITY_VERSION =
  'A6_PARTNER_CAPABILITY_VERSION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A6T08_SETTLEMENT_SUSPENSE_COMPENSATING =
  'A6T08_SETTLEMENT_SUSPENSE_COMPENSATING' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A6T09_EXTERNAL_RECONCILIATION =
  'A6T09_EXTERNAL_RECONCILIATION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG = 'A7_PRODUCT_CATALOG' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7_PRODUCT_BOUNDARY = 'A7_PRODUCT_BOUNDARY' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7T04_PRODUCT_CUSTOMER_BINDING =
  'A7T04_PRODUCT_CUSTOMER_BINDING' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7T05_PRODUCT_COMMAND_OPERATION =
  'A7T05_PRODUCT_COMMAND_OPERATION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7T06_PRODUCT_NOTIFICATION =
  'A7T06_PRODUCT_NOTIFICATION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7T07_PRODUCT_LIFECYCLE =
  'A7T07_PRODUCT_LIFECYCLE' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7T08_PRODUCT_FINANCIAL_EFFECT =
  'A7T08_PRODUCT_FINANCIAL_EFFECT' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7T09_PRODUCT_RECONCILIATION =
  'A7T09_PRODUCT_RECONCILIATION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_A7T10_PRODUCT_DATA_MINIMIZATION =
  'A7T10_PRODUCT_DATA_MINIMIZATION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP =
  'B1_COMMERCIAL_CATALOG_LOOKUP' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_COMPATIBILITY =
  'B1_COMMERCIAL_CATALOG_COMPATIBILITY' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN =
  'B1_COMMERCIAL_CATALOG_PLAN' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_TIER =
  'B1_COMMERCIAL_CATALOG_TIER' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_ENTITLEMENT =
  'B1_COMMERCIAL_CATALOG_ENTITLEMENT' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PACKAGE =
  'B1_COMMERCIAL_CATALOG_PACKAGE' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_BUNDLE =
  'B1_COMMERCIAL_CATALOG_BUNDLE' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_SUBSCRIPTION =
  'B1_COMMERCIAL_CATALOG_SUBSCRIPTION' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_FEATURE_FLAG =
  'B1_COMMERCIAL_CATALOG_FEATURE_FLAG' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT =
  'B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PRICING =
  'B1_COMMERCIAL_CATALOG_PRICING' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP =
  'B1_COMMERCIAL_DECISION_LOOKUP' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_COMPATIBILITY =
  'B1_COMMERCIAL_DECISION_COMPATIBILITY' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY =
  'B1_COMMERCIAL_DECISION_REPLAY' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_NUMBER_DETERMINISTIC =
  'B1_BILLING_ENGINE_NUMBER_DETERMINISTIC' as const;
export const B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_VERSION =
  'B1_BILLING_ENGINE_DOCUMENT_VERSION' as const;

export const B1_BILLING_ENGINE_RULE_KINDS = [
  B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
  B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_OBLIGATION,
  B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_CURRENTNESS,
  B1_BILLING_ENGINE_RULE_KIND_A4_POLICY_REEVALUATION,
  B1_BILLING_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
  B1_BILLING_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
  B1_BILLING_ENGINE_RULE_KIND_A5_LEDGER_POSTING_BOUNDARY,
  B1_BILLING_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
  B1_BILLING_ENGINE_RULE_KIND_A6_PARTNER_STATE,
  B1_BILLING_ENGINE_RULE_KIND_A6_PARTNER_CAPABILITY_VERSION,
  B1_BILLING_ENGINE_RULE_KIND_A6T08_SETTLEMENT_SUSPENSE_COMPENSATING,
  B1_BILLING_ENGINE_RULE_KIND_A6T09_EXTERNAL_RECONCILIATION,
  B1_BILLING_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
  B1_BILLING_ENGINE_RULE_KIND_A7_PRODUCT_BOUNDARY,
  B1_BILLING_ENGINE_RULE_KIND_A7T04_PRODUCT_CUSTOMER_BINDING,
  B1_BILLING_ENGINE_RULE_KIND_A7T05_PRODUCT_COMMAND_OPERATION,
  B1_BILLING_ENGINE_RULE_KIND_A7T06_PRODUCT_NOTIFICATION,
  B1_BILLING_ENGINE_RULE_KIND_A7T07_PRODUCT_LIFECYCLE,
  B1_BILLING_ENGINE_RULE_KIND_A7T08_PRODUCT_FINANCIAL_EFFECT,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_COMPATIBILITY,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_TIER,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_ENTITLEMENT,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PACKAGE,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_BUNDLE,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_SUBSCRIPTION,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_FEATURE_FLAG,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PRICING,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_LOOKUP,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_COMPATIBILITY,
  B1_BILLING_ENGINE_RULE_KIND_B1_COMMERCIAL_DECISION_REPLAY,
  B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_NUMBER_DETERMINISTIC,
  B1_BILLING_ENGINE_RULE_KIND_B1_BILLING_ENGINE_DOCUMENT_VERSION,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine rule outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_RULE_OUTCOME_PASS = 'PASS' as const;
export const B1_BILLING_ENGINE_RULE_OUTCOME_FAIL = 'FAIL' as const;
export const B1_BILLING_ENGINE_RULE_OUTCOME_SKIP = 'SKIP' as const;
export const B1_BILLING_ENGINE_RULE_OUTCOME_NOT_APPLICABLE = 'NOT_APPLICABLE' as const;

export const B1_BILLING_ENGINE_RULE_OUTCOMES = [
  B1_BILLING_ENGINE_RULE_OUTCOME_PASS,
  B1_BILLING_ENGINE_RULE_OUTCOME_FAIL,
  B1_BILLING_ENGINE_RULE_OUTCOME_SKIP,
  B1_BILLING_ENGINE_RULE_OUTCOME_NOT_APPLICABLE,
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine compatibility rule identifiers (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_COMPATIBILITY_RULE_IDS = [
  'B1_BILLING_RULE_SCOPE_KEY_REQUIRED',
  'B1_BILLING_RULE_SCOPE_VERSION_REQUIRED',
  'B1_BILLING_RULE_CURRENCY_REQUIRED',
  'B1_BILLING_RULE_ACCOUNTING_UNIT_REQUIRED',
  'B1_BILLING_RULE_PRODUCT_DEPENDENCY_REQUIRED',
  'B1_BILLING_RULE_PARTNER_DEPENDENCY_REQUIRED',
  'B1_BILLING_RULE_DOCUMENT_VERSION_REQUIRED',
  'B1_BILLING_RULE_DECISION_REFERENCES_REQUIRED',
  'B1_BILLING_RULE_NUMBER_DETERMINISTIC',
  'B1_BILLING_RULE_NO_CROSS_CATALOG_REFERENCES',
  'B1_BILLING_RULE_BILLING_PERIOD_VERSION_REQUIRED',
  'B1_BILLING_RULE_STATEMENT_PERIOD_VERSION_REQUIRED',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine consumer contract identifiers (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_CONSUMER_CONTRACT_IDS = [
  'B1_BILLING_CONSUMER_CONTRACT_A1',
  'B1_BILLING_CONSUMER_CONTRACT_A2',
  'B1_BILLING_CONSUMER_CONTRACT_A3',
  'B1_BILLING_CONSUMER_CONTRACT_A4',
  'B1_BILLING_CONSUMER_CONTRACT_A5',
  'B1_BILLING_CONSUMER_CONTRACT_A6',
  'B1_BILLING_CONSUMER_CONTRACT_A7',
  'B1_BILLING_CONSUMER_CONTRACT_A6T10',
  'B1_BILLING_CONSUMER_CONTRACT_A6T09',
  'B1_BILLING_CONSUMER_CONTRACT_A7T09',
  'B1_BILLING_CONSUMER_CONTRACT_A7T08',
  'B1_BILLING_CONSUMER_CONTRACT_A7T06',
  'B1_BILLING_CONSUMER_CONTRACT_B1_COMMERCIAL_CATALOG',
  'B1_BILLING_CONSUMER_CONTRACT_B1_COMMERCIAL_DECISION',
  'B1_BILLING_CONSUMER_CONTRACT_OPERATIONS',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine version negotiation rule identifiers (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_VERSION_NEGOTIATION_RULE_IDS = [
  'B1_BILLING_VERSION_RULE_SCOPE_VERSION_EXACT_MATCH',
  'B1_BILLING_VERSION_RULE_DOCUMENT_VERSION_EXACT_MATCH',
  'B1_BILLING_VERSION_RULE_BILLING_PERIOD_VERSION_EXACT_MATCH',
  'B1_BILLING_VERSION_RULE_STATEMENT_PERIOD_VERSION_EXACT_MATCH',
  'B1_BILLING_VERSION_RULE_NO_CROSS_CATALOG_NEGOTIATION',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine replay rule identifiers (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_REPLAY_RULE_IDS = [
  'B1_BILLING_REPLAY_RULE_WINDOW_86400',
  'B1_BILLING_REPLAY_RULE_EXACT_MATCH_REQUIRED',
  'B1_BILLING_REPLAY_RULE_IDEMPOTENT',
  'B1_BILLING_REPLAY_RULE_AUDIT_TRACED',
  'B1_BILLING_REPLAY_RULE_EXPIRES_AFTER_WINDOW',
  'B1_BILLING_REPLAY_RULE_INHERITS_A1_A7',
  'B1_BILLING_REPLAY_RULE_INHERITS_B1T03',
  'B1_BILLING_REPLAY_RULE_INHERITS_B1T04',
  'B1_BILLING_REPLAY_RULE_NUMBER_DETERMINISTIC',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine declared dependencies (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_DECLARED_DEPENDENCIES = [
  'A1-CANONICAL-IDENTITY',
  'A2-AUTHORIZATION-CONTEXT',
  'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
  'A4-PRODUCT-POLICY-DECISION',
  'A5-LEDGER',
  'A6-PARTNER-ADAPTER',
  'A6T05-EXTERNAL-OPERATION',
  'A6T08-SETTLEMENT-SUSPENSE-COMPENSATING',
  'A6T09-EXTERNAL-RECONCILIATION',
  'A6T10-DATA-CLASSIFICATION',
  'A7-PRODUCT-CATALOG',
  'A7-PRODUCT-POLICY-PROFILE',
  'A7T04-PRODUCT-CUSTOMER-BINDING',
  'A7T05-PRODUCT-COMMAND-OPERATION',
  'A7T06-PRODUCT-NOTIFICATION-DELIVERY',
  'A7T07-PRODUCT-LIFECYCLE',
  'A7T08-PRODUCT-FINANCIAL-EFFECT',
  'A7T09-PRODUCT-RECONCILIATION',
  'A7T10-PRODUCT-DATA-MINIMIZATION',
  'B1-COMMERCIAL-CATALOG',
  'B1-COMMERCIAL-DECISION',
  'CUSTOMER-PREFERENCE',
  'OPERATIONS-AUDIT',
  'OPERATIONS-IDEMPOTENCY',
  'OPERATIONS-OUTBOX',
  'OPERATIONS-METRICS',
  'OPERATIONS-DIAGNOSTICS',
  'WALLET',
  'LEDGER',
  'RECONCILIATION',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine prohibited dependencies (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
 */
export const B1_BILLING_ENGINE_PROHIBITED_DEPENDENCIES = [
  'B1_CAMPAIGN_ENGINE',
  'B1_PROMOTION_ENGINE',
  'B1_COUPON_ENGINE',
  'B1_REFERRAL_ENGINE',
  'B1_CASHBACK_ENGINE',
  'B1_LOYALTY_ENGINE',
  'B1_REVENUE_RECOGNITION_ENGINE',
  'B1_TAX_ENGINE',
  'B1_COST_ACCOUNTING_ENGINE',
  'B1_PROFITABILITY_ENGINE',
  'B1_ANALYTICS_ENGINE',
  'B1_COMMERCIAL_RECONCILIATION_ENGINE',
  'B1_COMMERCIAL_DATA_CLASSIFICATION_REGISTRY',
  'B1_COMMERCIAL_IDEMPOTENCY_AUTHORITY',
  'B1_COMMERCIAL_AUDIT_AUTHORITY',
  'B1_COMMERCIAL_APPROVAL_AUTHORITY',
  'B1_COMMERCIAL_FEATURE_FLAG_AUTHORITY',
  'B1_COMMERCIAL_RELEASE_GATE',
  'A5_LEDGER_POSTING_AUTHORITY',
  'A5_LEDGER_JOURNAL_AUTHORITY',
  'A5_FINANCIAL_INVARIANTS_OVERRIDE_AUTHORITY',
  'A6T08_SETTLEMENT_AUTHORITY',
  'A6T08_SUSPENSE_AUTHORITY',
  'A6T08_COMPENSATING_AUTHORITY',
  'A6T09_RECONCILIATION_AUTHORITY',
] as const;

/**
 * B1 billing engine, invoice engine, and statement-generation
 * engine prohibited adjacent scopes (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05 and re-asserted from
 * the B1T03 catalog).
 */
export const B1_BILLING_ENGINE_PROHIBITED_ADJACENT_SCOPES = [
  'commercial.virtual-account.outbound-settlement',
  'commercial.savings.inbound-funding',
  'commercial.lending.inbound-funding',
  'commercial.bills.inbound-funding',
  'commercial.airtime.inbound-funding',
  'commercial.qr-merchant.inbound-funding',
  'commercial.agent-assisted.inbound-funding',
  'commercial.card.inbound-funding',
  'commercial.bulk-payroll.inbound-funding',
  'commercial.fx.inbound-funding',
  'commercial.cross-region.inbound-funding',
  'commercial.cross-currency.inbound-funding',
  'commercial.public-channel.inbound-funding',
  'commercial.marketing-consent.inbound-funding',
] as const;
