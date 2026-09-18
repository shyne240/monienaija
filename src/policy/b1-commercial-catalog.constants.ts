/**
 * B1T03 — B1 commercial catalog, plan catalog, subscription plan,
 * customer tier, merchant tier, partner tier, product entitlement,
 * product packaging / bundle catalog, and read-only consumer
 * boundary frozen constants.
 *
 * The B1 commercial catalog contract freezes the B1 first
 * commercial scope registration, the B1 first commercial plan
 * catalog, the B1 first commercial subscription plan registration,
 * the B1 first commercial customer tier catalog, the B1 first
 * commercial merchant tier catalog, the B1 first commercial partner
 * tier catalog, the B1 first commercial product entitlement
 * catalog, the B1 first commercial package catalog, the B1 first
 * commercial bundle catalog, the B1 first commercial feature flag
 * catalog, the B1 first commercial dynamic limit catalog, the B1
 * first commercial pricing catalog, the B1 commercial catalog
 * versioning contract, the B1 commercial catalog compatibility
 * validation contract, the B1 commercial catalog replay-safe
 * catalog lookup contract, and the B1 commercial catalog read-only
 * consumer boundary surface for later B1 tasks.
 *
 * The B1 commercial catalog contract extends the B1T02 commercial
 * catalog and commercial-boundary contract (without modification or
 * duplication). The B1 commercial catalog contract is a read-only
 * contract against the existing A1 canonical identity, A2
 * authorization, A3 binding, A4 policy decision, A5 Ledger, A6
 * partner-adapter, A6T05 external-operation, A6T08 settlement /
 * suspense / compensating-entry, A6T09 external reconciliation,
 * A6T10 data classification, A7 product catalog, A7 product-
 * policy profile, A7T04 product customer-binding, A7T05 product
 * command, A7T06 product notification, A7T07 product lifecycle,
 * A7T08 product financial effect, A7T09 product reconciliation,
 * A7T10 product data minimization, `CustomerPreference`, Wallet,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics, and
 * Reconciliation authorities. The B1 commercial catalog contract
 * is a read-write contract against the shared Operations
 * `IdempotencyService`, `AuditService`, `OutboxService`, and
 * `MetricsService`.
 *
 * No new A1 canonical identity, A2 authorization, A3 binding, A4
 * policy decision, A5 transfer / deposit / withdrawal, A6 partner-
 * adapter, A6T05 external-operation, A6T06 callback, A6T08
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
 * by B1T03. The B1 commercial catalog contract reuses the A1
 * canonical identity, A2 authorization, A3 binding, A4 policy
 * decision, A6 partner-adapter, A6T10 data classification, A7
 * product catalog, A7 product-policy profile, and the shared
 * Operations audit, idempotency, outbox, and metrics services
 * through the existing read-only consumer boundaries.
 */

/**
 * B1 commercial catalog contract name (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 and re-asserted by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3).
 */
export const B1_COMMERCIAL_CATALOG_CONTRACT_NAME = 'B1-COMMERCIAL-CATALOG' as const;

/**
 * B1 commercial catalog contract version (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export const B1_COMMERCIAL_CATALOG_CONTRACT_VERSION = 1 as const;

/**
 * B1 commercial catalog contract document reference.
 */
export const B1_COMMERCIAL_CATALOG_CONTRACT_DOCUMENT =
  'docs/B1-COMMERCIAL-CATALOG-CONTRACT.md' as const;

/**
 * B1 commercial catalog first commercial scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` §4.4).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_KEY =
  'commercial.virtual-account.inbound-funding' as const;

/**
 * B1 commercial catalog first commercial scope version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_VERSION = 1 as const;

/**
 * B1 commercial catalog first commercial scope direction (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_DIRECTION = 'inbound' as const;

/**
 * B1 commercial catalog first commercial scope currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY = 'NGN' as const;

/**
 * B1 commercial catalog first commercial scope accounting unit
 * (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

/**
 * B1 commercial catalog first commercial scope partner dependency
 * (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY = 'NIBSS_NIP' as const;

/**
 * B1 commercial catalog first commercial scope product dependency
 * (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY = 'VIRTUAL_ACCOUNT' as const;

/**
 * B1 commercial catalog first commercial scope product dependency
 * version (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION = 1 as const;

/**
 * B1 commercial catalog first commercial scope internal commercial-
 * decision owner (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_INTERNAL_COMMERCIAL_DECISION_OWNER =
  'B1_COMMERCIAL_ENGINE' as const;

/**
 * B1 commercial catalog first commercial scope classification
 * level (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL = 'INTERNAL' as const;

/**
 * B1 commercial catalog first commercial scope retention days
 * (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS = 365 as const;

/**
 * B1 commercial catalog first commercial scope effective-from
 * (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1; the B1
 * first commercial scope is not yet activated and has no
 * effective-from).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM: string | null = null;

/**
 * B1 commercial catalog first commercial scope effective-to
 * (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1; the B1
 * first commercial scope is not yet activated and has no
 * effective-to).
 */
export const B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO: string | null = null;

/**
 * B1 commercial catalog first commercial scope catalog key
 * (frozen; the B1 commercial catalog first commercial scope is
 * recorded as a single frozen registration with the catalog key
 * `b1.commercial-catalog.v1.commercial.virtual-account.inbound-funding`).
 */
export const B1_COMMERCIAL_CATALOG_FIRST_SCOPE_CATALOG_KEY =
  'b1.commercial-catalog.v1.commercial.virtual-account.inbound-funding' as const;

/**
 * B1 commercial catalog state vocabulary (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export const B1_COMMERCIAL_CATALOG_STATE_PENDING = 'COMMERCIAL_DECISION_PENDING' as const;
export const B1_COMMERCIAL_CATALOG_STATE_ADMITTED = 'COMMERCIAL_DECISION_ADMITTED' as const;
export const B1_COMMERCIAL_CATALOG_STATE_SUPPRESSED = 'COMMERCIAL_DECISION_SUPPRESSED' as const;
export const B1_COMMERCIAL_CATALOG_STATE_FAILED = 'COMMERCIAL_DECISION_FAILED' as const;
export const B1_COMMERCIAL_CATALOG_STATE_REPLAYED = 'COMMERCIAL_DECISION_REPLAYED' as const;
export const B1_COMMERCIAL_CATALOG_STATE_DISABLED = 'COMMERCIAL_DECISION_DISABLED' as const;

export const B1_COMMERCIAL_CATALOG_STATES: readonly string[] = Object.freeze([
  B1_COMMERCIAL_CATALOG_STATE_PENDING,
  B1_COMMERCIAL_CATALOG_STATE_ADMITTED,
  B1_COMMERCIAL_CATALOG_STATE_SUPPRESSED,
  B1_COMMERCIAL_CATALOG_STATE_FAILED,
  B1_COMMERCIAL_CATALOG_STATE_REPLAYED,
  B1_COMMERCIAL_CATALOG_STATE_DISABLED,
]);

export type B1CommercialCatalogStateConst =
  | typeof B1_COMMERCIAL_CATALOG_STATE_PENDING
  | typeof B1_COMMERCIAL_CATALOG_STATE_ADMITTED
  | typeof B1_COMMERCIAL_CATALOG_STATE_SUPPRESSED
  | typeof B1_COMMERCIAL_CATALOG_STATE_FAILED
  | typeof B1_COMMERCIAL_CATALOG_STATE_REPLAYED
  | typeof B1_COMMERCIAL_CATALOG_STATE_DISABLED;

export const B1_COMMERCIAL_CATALOG_STATE_VOCABULARY: readonly B1CommercialCatalogStateConst[] =
  Object.freeze([
    B1_COMMERCIAL_CATALOG_STATE_PENDING,
    B1_COMMERCIAL_CATALOG_STATE_ADMITTED,
    B1_COMMERCIAL_CATALOG_STATE_SUPPRESSED,
    B1_COMMERCIAL_CATALOG_STATE_FAILED,
    B1_COMMERCIAL_CATALOG_STATE_REPLAYED,
    B1_COMMERCIAL_CATALOG_STATE_DISABLED,
  ]);

/**
 * B1 commercial catalog first commercial scope capability key
 * (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.2).
 */
export const B1_COMMERCIAL_CATALOG_CAPABILITY_FEE =
  'commercial.virtual-account.inbound-funding.fee' as const;
export const B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION =
  'commercial.virtual-account.inbound-funding.commission' as const;

export const B1_COMMERCIAL_CATALOG_CAPABILITIES: readonly string[] = Object.freeze([
  B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
  B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
]);

/**
 * B1 commercial catalog first commercial scope capability action
 * vocabulary (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §4.2). The B1 commercial capability action vocabulary is the
 * B1 commercial catalog action vocabulary.
 */
export const B1_COMMERCIAL_CATALOG_ACTION_DECIDE = 'commercial-decision' as const;
export const B1_COMMERCIAL_CATALOG_ACTIONS: readonly string[] = Object.freeze([
  B1_COMMERCIAL_CATALOG_ACTION_DECIDE,
]);

/**
 * B1 commercial catalog first commercial scope data control
 * classifications (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §4.1). The B1 commercial catalog data control classifications
 * are the A6T10 data control classifications reused by the B1
 * commercial catalog through the existing A6T10 data
 * classification registry.
 */
export const B1_COMMERCIAL_CATALOG_DATA_CONTROL_CLASSIFICATIONS: readonly string[] = Object.freeze([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
]);

/**
 * B1 commercial catalog first commercial scope prohibited adjacent
 * commercial scopes (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §4.4 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T03). The B1 commercial catalog first commercial scope is
 * bounded; the following adjacent commercial scopes are explicitly
 * prohibited for the first commercial scope and require a separate
 * B1 cycle.
 */
export const B1_COMMERCIAL_CATALOG_PROHIBITED_ADJACENT_SCOPES: readonly string[] = Object.freeze([
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
]);

/**
 * B1 commercial catalog first commercial scope prohibited
 * dependencies (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §4.5 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T03). The B1 commercial catalog first commercial scope is
 * bounded; the following adjacent commercial dependencies are
 * explicitly prohibited for the first commercial scope and require
 * a separate B1 cycle.
 */
export const B1_COMMERCIAL_CATALOG_PROHIBITED_DEPENDENCIES: readonly string[] = Object.freeze([
  'B1_FEE_ENGINE',
  'B1_COMMISSION_ENGINE',
  'B1_REVENUE_SHARING_ENGINE',
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
]);

/**
 * B1 commercial catalog first commercial scope declared
 * dependencies (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §4.5 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T03). The B1 commercial catalog first commercial scope is
 * bounded to the existing A1-A7 dependencies. The declared
 * dependencies are the canonical A1-A7 authorities that the B1
 * commercial catalog consumes through the existing read-only
 * consumer boundaries.
 */
export const B1_COMMERCIAL_CATALOG_DECLARED_DEPENDENCIES: readonly string[] = Object.freeze([
  'A1-CANONICAL-OWNERSHIP',
  'A1-CANONICAL-IDENTITY',
  'A2-AUTHORIZATION-CONTEXT',
  'A3-CUSTOMER-FINANCIAL-ACCOUNT-BINDING',
  'A4-PRODUCT-POLICY-DECISION',
  'A5-COMMAND-CORRELATION',
  'A5-LEDGER',
  'A6-PARTNER-ADAPTER',
  'A6T05-EXTERNAL-OPERATION',
  'A6T08-SETTLEMENT-SUSPENSE-COMPENSATING',
  'A6T09-EXTERNAL-RECONCILIATION',
  'A6T10-DATA-CLASSIFICATION',
  'A6T10-DATA-CONTROL-AUDIT',
  'A7-PRODUCT-CATALOG',
  'A7-PRODUCT-POLICY-PROFILE',
  'A7T04-PRODUCT-CUSTOMER-BINDING',
  'A7T05-PRODUCT-COMMAND-OPERATION',
  'A7T06-PRODUCT-NOTIFICATION-DELIVERY',
  'A7T07-PRODUCT-LIFECYCLE',
  'A7T08-PRODUCT-FINANCIAL-EFFECT',
  'A7T09-PRODUCT-RECONCILIATION',
  'A7T10-PRODUCT-DATA-MINIMIZATION',
  'CUSTOMER-PREFERENCE',
  'OPERATIONS-AUDIT',
  'OPERATIONS-IDEMPOTENCY',
  'OPERATIONS-OUTBOX',
  'OPERATIONS-METRICS',
  'OPERATIONS-DIAGNOSTICS',
  'WALLET',
  'LEDGER',
  'RECONCILIATION',
]);

/**
 * B1 commercial catalog first commercial scope compatibility rule
 * identifiers (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §5.2 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T03).
 */
export const B1_COMMERCIAL_CATALOG_COMPATIBILITY_RULE_IDS: readonly string[] = Object.freeze([
  'B1_COMPAT_RULE_SCOPE_KEY_REQUIRED',
  'B1_COMPAT_RULE_SCOPE_VERSION_REQUIRED',
  'B1_COMPAT_RULE_DIRECTION_REQUIRED',
  'B1_COMPAT_RULE_CURRENCY_REQUIRED',
  'B1_COMPAT_RULE_ACCOUNTING_UNIT_REQUIRED',
  'B1_COMPAT_RULE_PARTNER_DEPENDENCY_REQUIRED',
  'B1_COMPAT_RULE_PRODUCT_DEPENDENCY_REQUIRED',
  'B1_COMPAT_RULE_CAPABILITY_REQUIRED',
  'B1_COMPAT_RULE_PLAN_REFERENCES_VALID',
  'B1_COMPAT_RULE_PACKAGE_REFERENCES_VALID',
  'B1_COMPAT_RULE_BUNDLE_REFERENCES_VALID',
  'B1_COMPAT_RULE_TIER_REFERENCES_VALID',
  'B1_COMPAT_RULE_ENTITLEMENT_REFERENCES_VALID',
  'B1_COMPAT_RULE_FEATURE_FLAG_REFERENCES_VALID',
  'B1_COMPAT_RULE_DYNAMIC_LIMIT_REFERENCES_VALID',
  'B1_COMPAT_RULE_PRICING_REFERENCES_VALID',
  'B1_COMPAT_RULE_SUBSCRIPTION_REFERENCES_VALID',
  'B1_COMPAT_RULE_NO_CROSS_CATALOG_REFERENCES',
]);

/**
 * B1 commercial catalog first commercial scope consumer contract
 * identifiers (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §10 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T03).
 */
export const B1_COMMERCIAL_CATALOG_CONSUMER_CONTRACT_IDS: readonly string[] = Object.freeze([
  'B1_CONSUMER_CONTRACT_A1',
  'B1_CONSUMER_CONTRACT_A2',
  'B1_CONSUMER_CONTRACT_A3',
  'B1_CONSUMER_CONTRACT_A4',
  'B1_CONSUMER_CONTRACT_A5',
  'B1_CONSUMER_CONTRACT_A6',
  'B1_CONSUMER_CONTRACT_A7',
  'B1_CONSUMER_CONTRACT_A6T10',
  'B1_CONSUMER_CONTRACT_A6T09',
  'B1_CONSUMER_CONTRACT_A7T09',
  'B1_CONSUMER_CONTRACT_A7T08',
  'B1_CONSUMER_CONTRACT_A7T06',
  'B1_CONSUMER_CONTRACT_OPERATIONS',
]);

/**
 * B1 commercial catalog first commercial scope version negotiation
 * rule identifiers (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §5.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export const B1_COMMERCIAL_CATALOG_VERSION_NEGOTIATION_RULE_IDS: readonly string[] = Object.freeze([
  'B1_VERSION_RULE_SCOPE_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_PLAN_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_PACKAGE_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_BUNDLE_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_ENTITLEMENT_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_TIER_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_SUBSCRIPTION_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_CATALOG_VERSION_EXACT_MATCH',
  'B1_VERSION_RULE_NO_CROSS_CATALOG_NEGOTIATION',
]);

/**
 * B1 commercial catalog first commercial scope replay rule
 * identifiers (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`
 * §6 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8
 * B1T03).
 */
export const B1_COMMERCIAL_CATALOG_REPLAY_RULE_IDS: readonly string[] = Object.freeze([
  'B1_REPLAY_RULE_WINDOW_86400',
  'B1_REPLAY_RULE_EXACT_MATCH_REQUIRED',
  'B1_REPLAY_RULE_IDEMPOTENT',
  'B1_REPLAY_RULE_AUDIT_TRACED',
  'B1_REPLAY_RULE_EXPIRES_AFTER_WINDOW',
  'B1_REPLAY_RULE_INHERITS_A1_A7',
]);

/**
 * B1 commercial catalog internal idempotency scope (frozen).
 */
export const B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE =
  'b1.commercial-catalog.idempotency.v1' as const;

/**
 * B1 commercial catalog internal idempotency retention (frozen;
 * 24 hours, aligned with the shared Operations `IdempotencyService`
 * default).
 */
export const B1_COMMERCIAL_CATALOG_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * B1 commercial catalog audit entity type (frozen).
 */
export const B1_COMMERCIAL_CATALOG_AUDIT_ENTITY_TYPE = 'B1_COMMERCIAL_CATALOG' as const;

/**
 * B1 commercial catalog audit actor (frozen).
 */
export const B1_COMMERCIAL_CATALOG_AUDIT_ACTOR = 'b1-commercial-catalog' as const;

/**
 * B1 commercial catalog outbox event type (frozen).
 */
export const B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE = 'B1CommercialCatalogRegistered' as const;

/**
 * B1 commercial catalog outbox event classification (frozen).
 */
export const B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_CLASSIFICATION = 'INTERNAL_OPERATIONS' as const;

/**
 * B1 commercial catalog outbox event retention class (frozen).
 */
export const B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

/**
 * B1 commercial catalog reference prefix (frozen).
 */
export const B1_COMMERCIAL_CATALOG_REFERENCE_PREFIX = 'b1-commercial-catalog' as const;

/**
 * B1 commercial catalog failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 and re-asserted by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §6).
 */
export const B1_COMMERCIAL_CATALOG_FAILURE_QUERY_UNAVAILABLE =
  'B1_COMMERCIAL_CATALOG_QUERY_UNAVAILABLE' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_INCOMPATIBLE =
  'B1_COMMERCIAL_CATALOG_INCOMPATIBLE' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_MALFORMED = 'B1_COMMERCIAL_CATALOG_MALFORMED' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_WRONG_VERSION =
  'B1_COMMERCIAL_CATALOG_WRONG_VERSION' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_PROHIBITED = 'B1_COMMERCIAL_CATALOG_PROHIBITED' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_UNSUPPORTED_CAPABILITY =
  'B1_COMMERCIAL_CATALOG_UNSUPPORTED_CAPABILITY' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PLAN =
  'B1_COMMERCIAL_CATALOG_MISSING_PLAN' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PACKAGE =
  'B1_COMMERCIAL_CATALOG_MISSING_PACKAGE' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_MISSING_BUNDLE =
  'B1_COMMERCIAL_CATALOG_MISSING_BUNDLE' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_MISSING_TIER =
  'B1_COMMERCIAL_CATALOG_MISSING_TIER' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_MISSING_ENTITLEMENT =
  'B1_COMMERCIAL_CATALOG_MISSING_ENTITLEMENT' as const;
export const B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND =
  'B1_COMMERCIAL_CATALOG_INVALID_COMMAND' as const;

export const B1_COMMERCIAL_CATALOG_FAILURE_CODES: readonly string[] = Object.freeze([
  B1_COMMERCIAL_CATALOG_FAILURE_QUERY_UNAVAILABLE,
  B1_COMMERCIAL_CATALOG_FAILURE_INCOMPATIBLE,
  B1_COMMERCIAL_CATALOG_FAILURE_MALFORMED,
  B1_COMMERCIAL_CATALOG_FAILURE_WRONG_VERSION,
  B1_COMMERCIAL_CATALOG_FAILURE_PROHIBITED,
  B1_COMMERCIAL_CATALOG_FAILURE_UNSUPPORTED_CAPABILITY,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PLAN,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PACKAGE,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_BUNDLE,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_TIER,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_ENTITLEMENT,
  B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND,
]);

/**
 * B1 commercial catalog metric names (frozen). The B1 commercial
 * catalog metrics are recorded through the shared Operations
 * `MetricsService` (the only metrics authority).
 */
export const B1_COMMERCIAL_CATALOG_METRIC_LOOKUP = 'b1.commercial-catalog.lookup' as const;
export const B1_COMMERCIAL_CATALOG_METRIC_REPLAYED = 'b1.commercial-catalog.replayed' as const;
export const B1_COMMERCIAL_CATALOG_METRIC_CONFLICT = 'b1.commercial-catalog.conflict' as const;
export const B1_COMMERCIAL_CATALOG_METRIC_INCOMPATIBLE =
  'b1.commercial-catalog.incompatible' as const;
export const B1_COMMERCIAL_CATALOG_METRIC_QUERY_UNAVAILABLE =
  'b1.commercial-catalog.query-unavailable' as const;

export const B1_COMMERCIAL_CATALOG_METRICS: readonly string[] = Object.freeze([
  B1_COMMERCIAL_CATALOG_METRIC_LOOKUP,
  B1_COMMERCIAL_CATALOG_METRIC_REPLAYED,
  B1_COMMERCIAL_CATALOG_METRIC_CONFLICT,
  B1_COMMERCIAL_CATALOG_METRIC_INCOMPATIBLE,
  B1_COMMERCIAL_CATALOG_METRIC_QUERY_UNAVAILABLE,
]);

/**
 * B1 commercial catalog plan key (frozen). The B1 commercial
 * catalog first commercial scope has two frozen plans, one for the
 * `fee` capability and one for the `commission` capability.
 */
export const B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE =
  'commercial.virtual-account.inbound-funding.fee.v1.plan.standard' as const;
export const B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION =
  'commercial.virtual-account.inbound-funding.commission.v1.plan.standard' as const;

export const B1_COMMERCIAL_CATALOG_PLAN_KEYS = [
  B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE,
  B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION,
] as const;

/**
 * B1 commercial catalog customer tier key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY =
  'commercial.customer.tier.standard.v1' as const;

export const B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEYS = [
  B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY,
] as const;

/**
 * B1 commercial catalog merchant tier key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY =
  'commercial.merchant.tier.standard.v1' as const;

export const B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEYS = [
  B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY,
] as const;

/**
 * B1 commercial catalog partner tier key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY =
  'commercial.partner.tier.standard.v1' as const;

export const B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEYS = [
  B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY,
] as const;

/**
 * B1 commercial catalog product entitlement key (frozen). The B1
 * commercial catalog first commercial scope has two frozen product
 * entitlements, one for the `fee` capability and one for the
 * `commission` capability.
 */
export const B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE =
  'commercial.virtual-account.inbound-funding.entitlement.fee.v1' as const;
export const B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION =
  'commercial.virtual-account.inbound-funding.entitlement.commission.v1' as const;

export const B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEYS = [
  B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE,
  B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION,
] as const;

/**
 * B1 commercial catalog package key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_PACKAGE_KEY =
  'commercial.virtual-account.inbound-funding.package.fee.commission.v1' as const;

export const B1_COMMERCIAL_CATALOG_PACKAGE_KEYS = [B1_COMMERCIAL_CATALOG_PACKAGE_KEY] as const;

/**
 * B1 commercial catalog bundle key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_BUNDLE_KEY =
  'commercial.virtual-account.inbound-funding.bundle.fee.commission.v1' as const;

export const B1_COMMERCIAL_CATALOG_BUNDLE_KEYS = [B1_COMMERCIAL_CATALOG_BUNDLE_KEY] as const;

/**
 * B1 commercial catalog subscription plan key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEY =
  'commercial.virtual-account.inbound-funding.subscription.standard.v1' as const;

export const B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEYS = [
  B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEY,
] as const;

/**
 * B1 commercial catalog feature flag key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_FEATURE_FLAG_FEE =
  'commercial.virtual-account.inbound-funding.fee.enabled' as const;
export const B1_COMMERCIAL_CATALOG_FEATURE_FLAG_COMMISSION =
  'commercial.virtual-account.inbound-funding.commission.enabled' as const;

export const B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS = [
  B1_COMMERCIAL_CATALOG_FEATURE_FLAG_FEE,
  B1_COMMERCIAL_CATALOG_FEATURE_FLAG_COMMISSION,
] as const;

/**
 * B1 commercial catalog dynamic limit key (frozen).
 */
export const B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_FEE =
  'commercial.virtual-account.inbound-funding.fee.dynamic-limit.daily' as const;
export const B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_COMMISSION =
  'commercial.virtual-account.inbound-funding.commission.dynamic-limit.daily' as const;

export const B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS = [
  B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_FEE,
  B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_COMMISSION,
] as const;

/**
 * B1 commercial catalog pricing catalog entry key (frozen). The
 * B1 commercial catalog first commercial scope has two frozen
 * pricing catalog entries, one for the `fee` capability and one
 * for the `commission` capability. The B1 commercial catalog
 * pricing catalog entry is configuration only; the B1 commercial
 * catalog pricing catalog does NOT calculate prices.
 */
export const B1_COMMERCIAL_CATALOG_PRICING_KEY_FEE =
  'commercial.virtual-account.inbound-funding.fee.v1.pricing.standard' as const;
export const B1_COMMERCIAL_CATALOG_PRICING_KEY_COMMISSION =
  'commercial.virtual-account.inbound-funding.commission.v1.pricing.standard' as const;

export const B1_COMMERCIAL_CATALOG_PRICING_KEYS = [
  B1_COMMERCIAL_CATALOG_PRICING_KEY_FEE,
  B1_COMMERCIAL_CATALOG_PRICING_KEY_COMMISSION,
] as const;

/**
 * B1 commercial catalog billing cycle vocabulary (frozen).
 */
export const B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION = 'PER_TRANSACTION' as const;

export const B1_COMMERCIAL_CATALOG_BILLING_CYCLES: readonly string[] = Object.freeze([
  B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION,
]);

/**
 * B1 commercial catalog plan type vocabulary (frozen).
 */
export const B1_COMMERCIAL_CATALOG_PLAN_TYPE_FEE = 'FEE' as const;
export const B1_COMMERCIAL_CATALOG_PLAN_TYPE_COMMISSION = 'COMMISSION' as const;

export const B1_COMMERCIAL_CATALOG_PLAN_TYPES: readonly string[] = Object.freeze([
  B1_COMMERCIAL_CATALOG_PLAN_TYPE_FEE,
  B1_COMMERCIAL_CATALOG_PLAN_TYPE_COMMISSION,
]);

/**
 * B1 commercial catalog plan classification level vocabulary (frozen).
 */
export const B1_COMMERCIAL_CATALOG_CLASSIFICATION_LEVELS: readonly string[] = Object.freeze([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
]);

/**
 * B1 commercial catalog lookup kind vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export const B1_COMMERCIAL_CATALOG_LOOKUP_KINDS: readonly string[] = Object.freeze([
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
]);
