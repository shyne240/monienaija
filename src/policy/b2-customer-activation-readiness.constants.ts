/**
 * B2T03 — B2 customer activation-readiness frozen constants.
 *
 * The B2 customer activation-readiness is the customer-facing activation
 * readiness attestation for the bounded first activation cohort
 * `b2.activation.cohort.inbound-funding` v1 for the frozen B1 first
 * commercial scope `commercial.virtual-account.inbound-funding` v1 under
 * `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting
 * unit `CUSTOMER_FUNDS`, region `NG`. The B2 customer activation-
 * readiness is the only B2 customer activation-readiness authority for
 * the first cohort. The B2 customer activation-readiness is a
 * deterministic, replay-safe attestation that verifies KYC, A3 binding,
 * A4 policy eligibility, A7 product compatibility, B1 commercial tier
 * and entitlement compatibility, and CustomerConsent. The B2 customer
 * activation-readiness never activates a customer, merchant, or agent,
 * never creates a public API, never creates a credential, never
 * dispatches a notification, never mutates an A1-A7/B1 authority, never
 * posts a ledger entry, and never performs commercial execution.
 */

/**
 * B2 customer activation-readiness contract name.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_NAME =
  'B2-CUSTOMER-ACTIVATION-READINESS' as const;

/**
 * B2 customer activation-readiness contract version.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_VERSION = 1 as const;

/**
 * B2 customer activation-readiness contract document.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_CONTRACT_DOCUMENT =
  'docs/B2-CUSTOMER-ONBOARDING-CONTRACT.md' as const;

/**
 * B2 customer activation-readiness internal idempotency scope.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_SCOPE =
  'b2.customer-activation-readiness.idempotency.v1' as const;

/**
 * B2 customer activation-readiness idempotency retention (24h).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * B2 customer activation-readiness audit actor.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_AUDIT_ACTOR =
  'b2-customer-activation-readiness' as const;

/**
 * B2 customer activation-readiness audit entity type.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_AUDIT_ENTITY_TYPE =
  'b2_customer_activation_readiness' as const;

/**
 * B2 customer activation-readiness outbox event type.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_OUTBOX_EVENT_TYPE =
  'b2.customer-activation-readiness.decided.v1' as const;

/**
 * B2 customer activation-readiness outbox classification.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_OUTBOX_CLASSIFICATION = 'INTERNAL' as const;

/**
 * B2 customer activation-readiness outbox retention class.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_OUTBOX_RETENTION_CLASS =
  'OPERATIONS_DEFAULT' as const;

/**
 * B2 customer activation-readiness reference prefix.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_REFERENCE_PREFIX = 'b2-activation-readiness' as const;

/**
 * B2 activation cohort key (frozen).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_COHORT_KEY =
  'b2.activation.cohort.inbound-funding' as const;

/**
 * B2 activation cohort version.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_COHORT_VERSION = 1 as const;

/**
 * B2 first cohort currency, accounting unit, region.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_CURRENCY = 'NGN' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_REGION = 'NG' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_DIRECTION = 'inbound' as const;

/**
 * B1 scope and A7/A6 dependencies (frozen references).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_B1_SCOPE_KEY =
  'commercial.virtual-account.inbound-funding' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_B1_SCOPE_VERSION = 1 as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_A7_PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_A7_PRODUCT_VERSION = 1 as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_A6_PARTNER_KEY = 'NIBSS_NIP' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_PRODUCT_CAPABILITY =
  'product.virtual-account' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_B1_CAPABILITY =
  'commercial.virtual-account.inbound-funding' as const;

/**
 * Verification state vocabulary (frozen).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_VERIFICATION_STATES = [
  'UNVERIFIED',
  'PENDING',
  'VERIFIED',
  'SUSPENDED',
  'BLOCKED',
] as const;

/**
 * Activation eligibility vocabulary (frozen).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_ELIGIBILITIES = [
  'ELIGIBLE',
  'INELIGIBLE',
  'REQUIRES_CONSENT',
] as const;

/**
 * Attestation outcome vocabulary.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_OUTCOMES = [
  'ATTESTED_READY',
  'ATTESTED_NOT_READY',
  'ATTESTED_REQUIRES_CONSENT',
  'REJECTED',
] as const;

/**
 * Failure codes (frozen).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_FAILURE_CODES = [
  'B2_CUSTOMER_ACTIVATION_READINESS_INVALID_COMMAND',
  'B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE',
  'B2_CUSTOMER_ACTIVATION_READINESS_QUERY_UNAVAILABLE',
  'B2_CUSTOMER_ACTIVATION_READINESS_PROHIBITED',
  'B2_CUSTOMER_ACTIVATION_READINESS_CUSTOMER_NOT_FOUND',
  'B2_CUSTOMER_ACTIVATION_READINESS_KYC_NOT_VERIFIED',
  'B2_CUSTOMER_ACTIVATION_READINESS_A3_BINDING_INVALID',
  'B2_CUSTOMER_ACTIVATION_READINESS_A4_NOT_ELIGIBLE',
  'B2_CUSTOMER_ACTIVATION_READINESS_A7_INCOMPATIBLE',
  'B2_CUSTOMER_ACTIVATION_READINESS_B1_TIER_INELIGIBLE',
  'B2_CUSTOMER_ACTIVATION_READINESS_B1_ENTITLEMENT_INELIGIBLE',
  'B2_CUSTOMER_ACTIVATION_READINESS_CONSENT_NOT_GRANTED',
  'B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_CONFLICT',
  'B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_EXPIRED',
  'B2_CUSTOMER_ACTIVATION_READINESS_IN_PROGRESS',
] as const;

export const B2_CUSTOMER_ACTIVATION_READINESS_FAILURE_INVALID_COMMAND =
  'B2_CUSTOMER_ACTIVATION_READINESS_INVALID_COMMAND' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_FAILURE_INCOMPATIBLE =
  'B2_CUSTOMER_ACTIVATION_READINESS_INCOMPATIBLE' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_FAILURE_QUERY_UNAVAILABLE =
  'B2_CUSTOMER_ACTIVATION_READINESS_QUERY_UNAVAILABLE' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_FAILURE_PROHIBITED =
  'B2_CUSTOMER_ACTIVATION_READINESS_PROHIBITED' as const;
export const B2_CUSTOMER_ACTIVATION_READINESS_FAILURE_REPLAY_CONFLICT =
  'B2_CUSTOMER_ACTIVATION_READINESS_REPLAY_CONFLICT' as const;

/**
 * Rule kinds evaluated for the attestation (frozen).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_RULE_KINDS = [
  'A3_BINDING_RECHECK',
  'A4_POLICY_ELIGIBILITY',
  'A4_POLICY_CURRENTNESS',
  'A7_PRODUCT_COMPATIBILITY',
  'B1_TIER_COMPATIBILITY',
  'B1_ENTITLEMENT_COMPATIBILITY',
  'CUSTOMER_CONSENT',
  'KYC_VERIFICATION',
  'CUSTOMER_IDENTITY',
] as const;

export const B2_CUSTOMER_ACTIVATION_READINESS_RULE_KINDS_VALUES =
  B2_CUSTOMER_ACTIVATION_READINESS_RULE_KINDS;

/**
 * Rule outcomes.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_RULE_OUTCOMES = [
  'PASS',
  'FAIL',
  'SKIP',
  'NOT_APPLICABLE',
] as const;

/**
 * Consumer contract IDs (read-only).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_CONSUMER_CONTRACT_IDS = [
  'A1_READ_ONLY',
  'A2_READ_ONLY',
  'A3_READ_ONLY',
  'A4_READ_ONLY',
  'A7_PRODUCT_CATALOG_READ_ONLY',
  'B1_CATALOG_READ_ONLY',
  'CUSTOMER_PREFERENCE_READ_ONLY',
  'CUSTOMER_CONSENT_READ_ONLY',
] as const;

/**
 * Declared dependencies (frozen).
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_DECLARED_DEPENDENCIES = [
  'A1_CUSTOMER_IDENTITY',
  'A2_AUTHENTICATION',
  'A3_CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
  'A4_CAPABILITY_POLICY',
  'A7_PRODUCT_CATALOG_VIRTUAL_ACCOUNT',
  'B1_COMMERCIAL_CATALOG_INBOUND_FUNDING',
  'CUSTOMER_PREFERENCE_NOTIFICATIONS',
  'CUSTOMER_CONSENT_B2_ACTIVATION',
] as const;

/**
 * Metrics.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_METRICS = [
  'b2_customer_activation_readiness_attested_total',
  'b2_customer_activation_readiness_rejected_total',
  'b2_customer_activation_readiness_requires_consent_total',
] as const;

/**
 * Retention.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_RETENTION_DAYS = 365 as const;

/**
 * Data classification for support trace.
 */
export const B2_CUSTOMER_ACTIVATION_READINESS_DATA_CLASSIFICATION = 'INTERNAL' as const;
