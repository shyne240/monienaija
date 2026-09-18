/**
 * B1T04 — B1 fee engine, commission engine, and revenue sharing
 * decision engine frozen constants.
 *
 * The B1 fee engine, commission engine, and revenue sharing
 * decision engine is the runtime commercial-decision engine
 * implementation for the B1 first commercial scope
 * (`commercial.virtual-account.inbound-funding` v1) established
 * in `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1 fee
 * engine, commission engine, and revenue sharing decision engine
 * consume the B1 commercial catalog (B1T03), the A4 product-policy
 * decision, the A3 binding recheck, the A5 Ledger account state,
 * the A6 partner state, and the A7 product state through
 * approved read-only consumer boundaries. The B1 fee engine,
 * commission engine, and revenue sharing decision engine are the
 * only B1 commercial-decision engines for fee, commission, and
 * revenue sharing. The B1 fee engine, commission engine, and
 * revenue sharing decision engine never post a journal, mutate a
 * balance, repair a binding, change A4 policy / source records,
 * or dispatch a notification. The B1 fee engine, commission
 * engine, and revenue sharing decision engine never post to
 * Ledger and never bypass A5.
 *
 * No new A1 canonical identity, A2 authorization, A3 binding, A4
 * policy decision, A5 transfer / deposit / withdrawal, A6
 * partner-adapter, A6T05 external-operation, A6T06 callback, A6T08
 * settlement / suspense / compensating-entry, A6T09 external
 * reconciliation, A6T10 data classification / consent / retention
 * / legal-hold / secret / disclosure / support-trace / partner-
 * payload validation, A7 product catalog, A7 product-policy
 * profile, A7T04 product customer-binding, A7T05 product
 * command/operation, A7T06 product notification delivery, A7T07
 * product lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, Wallet, Ledger,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics,
 * Reconciliation, or `CustomerPreference` authority is introduced
 * by B1T04. The B1 fee engine, commission engine, and revenue
 * sharing decision engine reuses the A1 canonical identity, A2
 * authorization, A3 binding, A4 product-policy, A5 Ledger, A6
 * partner-adapter, A6T10 data classification, A7 product catalog,
 * A7 product-policy profile, and the shared Operations audit,
 * idempotency, outbox, and metrics services through the existing
 * read-only consumer boundaries.
 */

/**
 * B1 fee engine, commission engine, and revenue sharing decision
 * engine contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_CONTRACT_NAME = 'B1-FEE-ENGINE' as const;

/**
 * B1 fee engine, commission engine, and revenue sharing decision
 * engine contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_CONTRACT_VERSION = 1 as const;

/**
 * B1 fee engine, commission engine, and revenue sharing decision
 * engine contract document reference.
 */
export const B1_FEE_ENGINE_CONTRACT_DOCUMENT = 'docs/B1-FEE-ENGINE-CONTRACT.md' as const;

/**
 * B1 commercial decision internal idempotency scope (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE =
  'b1.commercial-decision.idempotency.v1' as const;

/**
 * B1 commercial decision internal idempotency retention (frozen;
 * 24 hours, aligned with the shared Operations `IdempotencyService`
 * default).
 */
export const B1_FEE_ENGINE_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * B1 commercial decision audit entity type (frozen).
 */
export const B1_FEE_ENGINE_AUDIT_ENTITY_TYPE = 'B1_COMMERCIAL_DECISION' as const;

/**
 * B1 commercial decision audit actor (frozen).
 */
export const B1_FEE_ENGINE_AUDIT_ACTOR = 'b1-fee-engine' as const;

/**
 * B1 commercial decision outbox event type (frozen).
 */
export const B1_FEE_ENGINE_OUTBOX_EVENT_TYPE = 'B1CommercialDecisionDecided' as const;

/**
 * B1 commercial decision outbox event classification (frozen).
 */
export const B1_FEE_ENGINE_OUTBOX_EVENT_CLASSIFICATION = 'INTERNAL_OPERATIONS' as const;

/**
 * B1 commercial decision outbox event retention class (frozen).
 */
export const B1_FEE_ENGINE_OUTBOX_EVENT_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

/**
 * B1 commercial decision reference prefix (frozen).
 */
export const B1_FEE_ENGINE_REFERENCE_PREFIX = 'b1-commercial-decision' as const;

/**
 * B1 commercial decision scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_SCOPE_KEY = 'commercial.virtual-account.inbound-funding' as const;

/**
 * B1 commercial decision scope version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_SCOPE_VERSION = 1 as const;

/**
 * B1 commercial decision scope currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_SCOPE_CURRENCY = 'NGN' as const;

/**
 * B1 commercial decision scope accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

/**
 * B1 commercial decision scope product dependency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY = 'VIRTUAL_ACCOUNT' as const;

/**
 * B1 commercial decision scope product dependency version (frozen).
 */
export const B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY_VERSION = 1 as const;

/**
 * B1 commercial decision scope partner dependency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_SCOPE_PARTNER_DEPENDENCY = 'NIBSS_NIP' as const;

/**
 * B1 commercial decision scope direction (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_SCOPE_DIRECTION = 'inbound' as const;

/**
 * B1 commercial decision decision kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_DECISION_KIND_FEE = 'FEE' as const;
export const B1_FEE_ENGINE_DECISION_KIND_COMMISSION = 'COMMISSION' as const;
export const B1_FEE_ENGINE_DECISION_KIND_REVENUE_SHARING = 'REVENUE_SHARING' as const;

export const B1_FEE_ENGINE_DECISION_KINDS = [
  B1_FEE_ENGINE_DECISION_KIND_FEE,
  B1_FEE_ENGINE_DECISION_KIND_COMMISSION,
  B1_FEE_ENGINE_DECISION_KIND_REVENUE_SHARING,
] as const;

/**
 * B1 commercial decision outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_DECISION_OUTCOME_ADMITTED = 'COMMERCIAL_DECISION_ADMITTED' as const;
export const B1_FEE_ENGINE_DECISION_OUTCOME_SUPPRESSED = 'COMMERCIAL_DECISION_SUPPRESSED' as const;
export const B1_FEE_ENGINE_DECISION_OUTCOME_DISABLED = 'COMMERCIAL_DECISION_DISABLED' as const;
export const B1_FEE_ENGINE_DECISION_OUTCOME_FAILED = 'COMMERCIAL_DECISION_FAILED' as const;

export const B1_FEE_ENGINE_DECISION_OUTCOMES = [
  B1_FEE_ENGINE_DECISION_OUTCOME_ADMITTED,
  B1_FEE_ENGINE_DECISION_OUTCOME_SUPPRESSED,
  B1_FEE_ENGINE_DECISION_OUTCOME_DISABLED,
  B1_FEE_ENGINE_DECISION_OUTCOME_FAILED,
] as const;

/**
 * B1 commercial decision rule outcome vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_RULE_OUTCOME_PASS = 'PASS' as const;
export const B1_FEE_ENGINE_RULE_OUTCOME_FAIL = 'FAIL' as const;
export const B1_FEE_ENGINE_RULE_OUTCOME_SKIP = 'SKIP' as const;
export const B1_FEE_ENGINE_RULE_OUTCOME_NOT_APPLICABLE = 'NOT_APPLICABLE' as const;

export const B1_FEE_ENGINE_RULE_OUTCOMES = [
  B1_FEE_ENGINE_RULE_OUTCOME_PASS,
  B1_FEE_ENGINE_RULE_OUTCOME_FAIL,
  B1_FEE_ENGINE_RULE_OUTCOME_SKIP,
  B1_FEE_ENGINE_RULE_OUTCOME_NOT_APPLICABLE,
] as const;

/**
 * B1 commercial decision rule kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_RULE_KIND_A4_POLICY_LIMIT = 'A4_POLICY_LIMIT' as const;
export const B1_FEE_ENGINE_RULE_KIND_A4_POLICY_OBLIGATION = 'A4_POLICY_OBLIGATION' as const;
export const B1_FEE_ENGINE_RULE_KIND_A4_POLICY_CURRENTNESS = 'A4_POLICY_CURRENTNESS' as const;
export const B1_FEE_ENGINE_RULE_KIND_A4_POLICY_REEVALUATION = 'A4_POLICY_REEVALUATION' as const;
export const B1_FEE_ENGINE_RULE_KIND_A3_BINDING_RECHECK = 'A3_BINDING_RECHECK' as const;
export const B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE = 'A5_LEDGER_ACCOUNT_STATE' as const;
export const B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_POSTING_BOUNDARY =
  'A5_LEDGER_POSTING_BOUNDARY' as const;
export const B1_FEE_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS = 'A5_FINANCIAL_INVARIANTS' as const;
export const B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_STATE = 'A6_PARTNER_STATE' as const;
export const B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_CAPABILITY_VERSION =
  'A6_PARTNER_CAPABILITY_VERSION' as const;
export const B1_FEE_ENGINE_RULE_KIND_A6T08_SETTLEMENT_SUSPENSE_COMPENSATING =
  'A6T08_SETTLEMENT_SUSPENSE_COMPENSATING' as const;
export const B1_FEE_ENGINE_RULE_KIND_A6T09_EXTERNAL_RECONCILIATION =
  'A6T09_EXTERNAL_RECONCILIATION' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG = 'A7_PRODUCT_CATALOG' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_BOUNDARY = 'A7_PRODUCT_BOUNDARY' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7T04_PRODUCT_CUSTOMER_BINDING =
  'A7T04_PRODUCT_CUSTOMER_BINDING' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7T05_PRODUCT_COMMAND_OPERATION =
  'A7T05_PRODUCT_COMMAND_OPERATION' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7T06_PRODUCT_NOTIFICATION =
  'A7T06_PRODUCT_NOTIFICATION' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7T07_PRODUCT_LIFECYCLE = 'A7T07_PRODUCT_LIFECYCLE' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7T08_PRODUCT_FINANCIAL_EFFECT =
  'A7T08_PRODUCT_FINANCIAL_EFFECT' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7T09_PRODUCT_RECONCILIATION =
  'A7T09_PRODUCT_RECONCILIATION' as const;
export const B1_FEE_ENGINE_RULE_KIND_A7T10_PRODUCT_DATA_MINIMIZATION =
  'A7T10_PRODUCT_DATA_MINIMIZATION' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP =
  'B1_COMMERCIAL_CATALOG_LOOKUP' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_COMPATIBILITY =
  'B1_COMMERCIAL_CATALOG_COMPATIBILITY' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN =
  'B1_COMMERCIAL_CATALOG_PLAN' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_TIER =
  'B1_COMMERCIAL_CATALOG_TIER' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_ENTITLEMENT =
  'B1_COMMERCIAL_CATALOG_ENTITLEMENT' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PACKAGE =
  'B1_COMMERCIAL_CATALOG_PACKAGE' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_BUNDLE =
  'B1_COMMERCIAL_CATALOG_BUNDLE' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_SUBSCRIPTION =
  'B1_COMMERCIAL_CATALOG_SUBSCRIPTION' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_FEATURE_FLAG =
  'B1_COMMERCIAL_CATALOG_FEATURE_FLAG' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT =
  'B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT' as const;
export const B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PRICING =
  'B1_COMMERCIAL_CATALOG_PRICING' as const;

export const B1_FEE_ENGINE_RULE_KINDS = [
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_LIMIT,
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_OBLIGATION,
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_CURRENTNESS,
  B1_FEE_ENGINE_RULE_KIND_A4_POLICY_REEVALUATION,
  B1_FEE_ENGINE_RULE_KIND_A3_BINDING_RECHECK,
  B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_ACCOUNT_STATE,
  B1_FEE_ENGINE_RULE_KIND_A5_LEDGER_POSTING_BOUNDARY,
  B1_FEE_ENGINE_RULE_KIND_A5_FINANCIAL_INVARIANTS,
  B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_STATE,
  B1_FEE_ENGINE_RULE_KIND_A6_PARTNER_CAPABILITY_VERSION,
  B1_FEE_ENGINE_RULE_KIND_A6T08_SETTLEMENT_SUSPENSE_COMPENSATING,
  B1_FEE_ENGINE_RULE_KIND_A6T09_EXTERNAL_RECONCILIATION,
  B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_CATALOG,
  B1_FEE_ENGINE_RULE_KIND_A7_PRODUCT_BOUNDARY,
  B1_FEE_ENGINE_RULE_KIND_A7T04_PRODUCT_CUSTOMER_BINDING,
  B1_FEE_ENGINE_RULE_KIND_A7T05_PRODUCT_COMMAND_OPERATION,
  B1_FEE_ENGINE_RULE_KIND_A7T06_PRODUCT_NOTIFICATION,
  B1_FEE_ENGINE_RULE_KIND_A7T07_PRODUCT_LIFECYCLE,
  B1_FEE_ENGINE_RULE_KIND_A7T08_PRODUCT_FINANCIAL_EFFECT,
  B1_FEE_ENGINE_RULE_KIND_A7T09_PRODUCT_RECONCILIATION,
  B1_FEE_ENGINE_RULE_KIND_A7T10_PRODUCT_DATA_MINIMIZATION,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_LOOKUP,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_COMPATIBILITY,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PLAN,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_TIER,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_ENTITLEMENT,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PACKAGE,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_BUNDLE,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_SUBSCRIPTION,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_FEATURE_FLAG,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT,
  B1_FEE_ENGINE_RULE_KIND_B1_COMMERCIAL_CATALOG_PRICING,
] as const;

/**
 * B1 commercial decision failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_FAILURE_INVALID_COMMAND = 'B1_FEE_ENGINE_INVALID_COMMAND' as const;
export const B1_FEE_ENGINE_FAILURE_INCOMPATIBLE = 'B1_FEE_ENGINE_INCOMPATIBLE' as const;
export const B1_FEE_ENGINE_FAILURE_QUERY_UNAVAILABLE = 'B1_FEE_ENGINE_QUERY_UNAVAILABLE' as const;
export const B1_FEE_ENGINE_FAILURE_PROHIBITED = 'B1_FEE_ENGINE_PROHIBITED' as const;
export const B1_FEE_ENGINE_FAILURE_A4_POLICY_DENIED = 'B1_FEE_ENGINE_A4_POLICY_DENIED' as const;
export const B1_FEE_ENGINE_FAILURE_A3_BINDING_INVALID = 'B1_FEE_ENGINE_A3_BINDING_INVALID' as const;
export const B1_FEE_ENGINE_FAILURE_A5_LEDGER_INVARIANT_BROKEN =
  'B1_FEE_ENGINE_A5_LEDGER_INVARIANT_BROKEN' as const;
export const B1_FEE_ENGINE_FAILURE_A6_PARTNER_INCOMPATIBLE =
  'B1_FEE_ENGINE_A6_PARTNER_INCOMPATIBLE' as const;
export const B1_FEE_ENGINE_FAILURE_A7_PRODUCT_INCOMPATIBLE =
  'B1_FEE_ENGINE_A7_PRODUCT_INCOMPATIBLE' as const;
export const B1_FEE_ENGINE_FAILURE_B1_CATALOG_INCOMPATIBLE =
  'B1_FEE_ENGINE_B1_CATALOG_INCOMPATIBLE' as const;
export const B1_FEE_ENGINE_FAILURE_B1_CATALOG_MISSING = 'B1_FEE_ENGINE_B1_CATALOG_MISSING' as const;
export const B1_FEE_ENGINE_FAILURE_FEATURE_FLAG_DISABLED =
  'B1_FEE_ENGINE_FEATURE_FLAG_DISABLED' as const;
export const B1_FEE_ENGINE_FAILURE_DYNAMIC_LIMIT_EXCEEDED =
  'B1_FEE_ENGINE_DYNAMIC_LIMIT_EXCEEDED' as const;
export const B1_FEE_ENGINE_FAILURE_REPLAY_CONFLICT = 'B1_FEE_ENGINE_REPLAY_CONFLICT' as const;
export const B1_FEE_ENGINE_FAILURE_REPLAY_EXPIRED = 'B1_FEE_ENGINE_REPLAY_EXPIRED' as const;
export const B1_FEE_ENGINE_FAILURE_IN_PROGRESS = 'B1_FEE_ENGINE_IN_PROGRESS' as const;
export const B1_FEE_ENGINE_FAILURE_BREAK_GLASS_DENIED = 'B1_FEE_ENGINE_BREAK_GLASS_DENIED' as const;

export const B1_FEE_ENGINE_FAILURE_CODES = [
  B1_FEE_ENGINE_FAILURE_INVALID_COMMAND,
  B1_FEE_ENGINE_FAILURE_INCOMPATIBLE,
  B1_FEE_ENGINE_FAILURE_QUERY_UNAVAILABLE,
  B1_FEE_ENGINE_FAILURE_PROHIBITED,
  B1_FEE_ENGINE_FAILURE_A4_POLICY_DENIED,
  B1_FEE_ENGINE_FAILURE_A3_BINDING_INVALID,
  B1_FEE_ENGINE_FAILURE_A5_LEDGER_INVARIANT_BROKEN,
  B1_FEE_ENGINE_FAILURE_A6_PARTNER_INCOMPATIBLE,
  B1_FEE_ENGINE_FAILURE_A7_PRODUCT_INCOMPATIBLE,
  B1_FEE_ENGINE_FAILURE_B1_CATALOG_INCOMPATIBLE,
  B1_FEE_ENGINE_FAILURE_B1_CATALOG_MISSING,
  B1_FEE_ENGINE_FAILURE_FEATURE_FLAG_DISABLED,
  B1_FEE_ENGINE_FAILURE_DYNAMIC_LIMIT_EXCEEDED,
  B1_FEE_ENGINE_FAILURE_REPLAY_CONFLICT,
  B1_FEE_ENGINE_FAILURE_REPLAY_EXPIRED,
  B1_FEE_ENGINE_FAILURE_IN_PROGRESS,
  B1_FEE_ENGINE_FAILURE_BREAK_GLASS_DENIED,
] as const;

/**
 * B1 commercial decision metric names (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_METRIC_EVALUATE = 'b1.commercial-decision.evaluate' as const;
export const B1_FEE_ENGINE_METRIC_REPLAYED = 'b1.commercial-decision.replayed' as const;
export const B1_FEE_ENGINE_METRIC_CONFLICT = 'b1.commercial-decision.conflict' as const;
export const B1_FEE_ENGINE_METRIC_INCOMPATIBLE = 'b1.commercial-decision.incompatible' as const;
export const B1_FEE_ENGINE_METRIC_FEATURE_FLAG_DISABLED =
  'b1.commercial-decision.feature-flag-disabled' as const;
export const B1_FEE_ENGINE_METRIC_DYNAMIC_LIMIT_EXCEEDED =
  'b1.commercial-decision.dynamic-limit-exceeded' as const;
export const B1_FEE_ENGINE_METRIC_QUERY_UNAVAILABLE =
  'b1.commercial-decision.query-unavailable' as const;
export const B1_FEE_ENGINE_METRIC_A4_POLICY_DENIED =
  'b1.commercial-decision.a4-policy-denied' as const;
export const B1_FEE_ENGINE_METRIC_A3_BINDING_INVALID =
  'b1.commercial-decision.a3-binding-invalid' as const;
export const B1_FEE_ENGINE_METRIC_A5_LEDGER_INVARIANT_BROKEN =
  'b1.commercial-decision.a5-ledger-invariant-broken' as const;
export const B1_FEE_ENGINE_METRIC_A6_PARTNER_INCOMPATIBLE =
  'b1.commercial-decision.a6-partner-incompatible' as const;
export const B1_FEE_ENGINE_METRIC_A7_PRODUCT_INCOMPATIBLE =
  'b1.commercial-decision.a7-product-incompatible' as const;
export const B1_FEE_ENGINE_METRIC_B1_CATALOG_INCOMPATIBLE =
  'b1.commercial-decision.b1-catalog-incompatible' as const;
export const B1_FEE_ENGINE_METRIC_B1_CATALOG_MISSING =
  'b1.commercial-decision.b1-catalog-missing' as const;
export const B1_FEE_ENGINE_METRIC_IN_PROGRESS = 'b1.commercial-decision.in-progress' as const;
export const B1_FEE_ENGINE_METRIC_REPLAY_EXPIRED = 'b1.commercial-decision.replay-expired' as const;
export const B1_FEE_ENGINE_METRIC_REPLAY_CONFLICT =
  'b1.commercial-decision.replay-conflict' as const;
export const B1_FEE_ENGINE_METRIC_BREAK_GLASS_DENIED =
  'b1.commercial-decision.break-glass-denied' as const;

export const B1_FEE_ENGINE_METRICS = [
  B1_FEE_ENGINE_METRIC_EVALUATE,
  B1_FEE_ENGINE_METRIC_REPLAYED,
  B1_FEE_ENGINE_METRIC_CONFLICT,
  B1_FEE_ENGINE_METRIC_INCOMPATIBLE,
  B1_FEE_ENGINE_METRIC_FEATURE_FLAG_DISABLED,
  B1_FEE_ENGINE_METRIC_DYNAMIC_LIMIT_EXCEEDED,
  B1_FEE_ENGINE_METRIC_QUERY_UNAVAILABLE,
  B1_FEE_ENGINE_METRIC_A4_POLICY_DENIED,
  B1_FEE_ENGINE_METRIC_A3_BINDING_INVALID,
  B1_FEE_ENGINE_METRIC_A5_LEDGER_INVARIANT_BROKEN,
  B1_FEE_ENGINE_METRIC_A6_PARTNER_INCOMPATIBLE,
  B1_FEE_ENGINE_METRIC_A7_PRODUCT_INCOMPATIBLE,
  B1_FEE_ENGINE_METRIC_B1_CATALOG_INCOMPATIBLE,
  B1_FEE_ENGINE_METRIC_B1_CATALOG_MISSING,
  B1_FEE_ENGINE_METRIC_IN_PROGRESS,
  B1_FEE_ENGINE_METRIC_REPLAY_EXPIRED,
  B1_FEE_ENGINE_METRIC_REPLAY_CONFLICT,
  B1_FEE_ENGINE_METRIC_BREAK_GLASS_DENIED,
] as const;

/**
 * B1 commercial decision rounding policy vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_ROUNDING_BANKERS_ROUND = 'BANKERS_ROUND' as const;
export const B1_FEE_ENGINE_ROUNDING_TRUNCATE = 'TRUNCATE' as const;
export const B1_FEE_ENGINE_ROUNDING_CEIL = 'CEIL' as const;

export const B1_FEE_ENGINE_ROUNDING_POLICIES = [
  B1_FEE_ENGINE_ROUNDING_BANKERS_ROUND,
  B1_FEE_ENGINE_ROUNDING_TRUNCATE,
  B1_FEE_ENGINE_ROUNDING_CEIL,
] as const;

/**
 * B1 commercial decision classification level vocabulary (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_CLASSIFICATION_LEVELS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
] as const;

/**
 * B1 commercial decision data control classifications (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_DATA_CONTROL_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
] as const;

/**
 * B1 commercial decision retention seconds (frozen; 365 days,
 * aligned with the B1T03 catalog retention).
 */
export const B1_FEE_ENGINE_RETENTION_DAYS = 365 as const;

/**
 * B1 commercial decision lookup kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_LOOKUP_KINDS = [
  'CATALOG',
  'PLAN',
  'CUSTOMER_TIER',
  'MERCHANT_TIER',
  'PARTNER_TIER',
  'PRODUCT_ENTITLEMENT',
  'PACKAGE',
  'BUNDLE',
  'SUBSCRIPTION_PLAN',
  'FEATURE_FLAG',
  'DYNAMIC_LIMIT',
  'PRICING_CATALOG',
  'CAPABILITY_PLANS',
  'CAPABILITY_PACKAGES',
  'CAPABILITY_BUNDLES',
] as const;

/**
 * B1 commercial decision compatibility rule identifiers (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_COMPATIBILITY_RULE_IDS = [
  'B1_DECISION_RULE_SCOPE_KEY_REQUIRED',
  'B1_DECISION_RULE_SCOPE_VERSION_REQUIRED',
  'B1_DECISION_RULE_DECISION_KIND_REQUIRED',
  'B1_DECISION_RULE_CURRENCY_REQUIRED',
  'B1_DECISION_RULE_ACCOUNTING_UNIT_REQUIRED',
  'B1_DECISION_RULE_PARTNER_DEPENDENCY_REQUIRED',
  'B1_DECISION_RULE_PRODUCT_DEPENDENCY_REQUIRED',
  'B1_DECISION_RULE_CAPABILITY_REQUIRED',
  'B1_DECISION_RULE_PLAN_REFERENCES_VALID',
  'B1_DECISION_RULE_TIER_REFERENCES_VALID',
  'B1_DECISION_RULE_ENTITLEMENT_REFERENCES_VALID',
  'B1_DECISION_RULE_PACKAGE_REFERENCES_VALID',
  'B1_DECISION_RULE_BUNDLE_REFERENCES_VALID',
  'B1_DECISION_RULE_FEATURE_FLAG_REFERENCES_VALID',
  'B1_DECISION_RULE_DYNAMIC_LIMIT_REFERENCES_VALID',
  'B1_DECISION_RULE_PRICING_REFERENCES_VALID',
  'B1_DECISION_RULE_SUBSCRIPTION_REFERENCES_VALID',
  'B1_DECISION_RULE_NO_CROSS_CATALOG_REFERENCES',
] as const;

/**
 * B1 commercial decision consumer contract identifiers (frozen
 * by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_CONSUMER_CONTRACT_IDS = [
  'B1_DECISION_CONSUMER_CONTRACT_A1',
  'B1_DECISION_CONSUMER_CONTRACT_A2',
  'B1_DECISION_CONSUMER_CONTRACT_A3',
  'B1_DECISION_CONSUMER_CONTRACT_A4',
  'B1_DECISION_CONSUMER_CONTRACT_A5',
  'B1_DECISION_CONSUMER_CONTRACT_A6',
  'B1_DECISION_CONSUMER_CONTRACT_A7',
  'B1_DECISION_CONSUMER_CONTRACT_A6T10',
  'B1_DECISION_CONSUMER_CONTRACT_A6T09',
  'B1_DECISION_CONSUMER_CONTRACT_A7T09',
  'B1_DECISION_CONSUMER_CONTRACT_A7T08',
  'B1_DECISION_CONSUMER_CONTRACT_A7T06',
  'B1_DECISION_CONSUMER_CONTRACT_B1_COMMERCIAL_CATALOG',
  'B1_DECISION_CONSUMER_CONTRACT_OPERATIONS',
] as const;

/**
 * B1 commercial decision version negotiation rule identifiers
 * (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_VERSION_NEGOTIATION_RULE_IDS = [
  'B1_DECISION_VERSION_RULE_SCOPE_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_DECISION_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_PLAN_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_TIER_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_ENTITLEMENT_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_PACKAGE_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_BUNDLE_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_SUBSCRIPTION_VERSION_EXACT_MATCH',
  'B1_DECISION_VERSION_RULE_NO_CROSS_CATALOG_NEGOTIATION',
] as const;

/**
 * B1 commercial decision replay rule identifiers (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_REPLAY_RULE_IDS = [
  'B1_DECISION_REPLAY_RULE_WINDOW_86400',
  'B1_DECISION_REPLAY_RULE_EXACT_MATCH_REQUIRED',
  'B1_DECISION_REPLAY_RULE_IDEMPOTENT',
  'B1_DECISION_REPLAY_RULE_AUDIT_TRACED',
  'B1_DECISION_REPLAY_RULE_EXPIRES_AFTER_WINDOW',
  'B1_DECISION_REPLAY_RULE_INHERITS_A1_A7',
  'B1_DECISION_REPLAY_RULE_INHERITS_B1T03',
] as const;

/**
 * B1 commercial decision declared dependencies (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_DECLARED_DEPENDENCIES = [
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
 * B1 commercial decision prohibited dependencies (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
 */
export const B1_FEE_ENGINE_PROHIBITED_DEPENDENCIES = [
  'B1_BILLING_ENGINE',
  'B1_INVOICE_ENGINE',
  'B1_STATEMENT_ENGINE',
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
] as const;

/**
 * B1 commercial decision prohibited adjacent scopes (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04 and re-asserted from
 * the B1T03 catalog).
 */
export const B1_FEE_ENGINE_PROHIBITED_ADJACENT_SCOPES = [
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
