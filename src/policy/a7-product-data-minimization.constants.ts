/**
 * A7T10 — A7 product data minimization frozen constants for the A7
 * first product.
 *
 * The A7 first product is `VIRTUAL_ACCOUNT` v1 (per
 * `docs/A7-PRODUCT-EXPANSION-BASELINE.md` and
 * `docs/A7-PRODUCT-CATALOG-CONTRACT.md`). The A7 product data
 * minimization contract consumes the existing A6T10 data
 * classification, consent, retention, legal-hold, secret, disclosure,
 * support-trace, and partner-payload validation authorities (the only
 * A6T10 data-control authorities) and the existing A1
 * `CustomerPreference.notifications` (the only customer intent
 * authority) through the approved read-only consumer boundaries. The
 * A7 product data minimization contract is a read-only contract
 * against the shared Operations `IdempotencyService`, `AuditService`,
 * `OutboxService`, `MetricsService`, and `DiagnosticsService` and a
 * read-only consumer of the A2 authorization context, the A3
 * customer-to-financial-account binding (via A7T04), the A4
 * product-policy decision, the A6T10 data-control authorities, the A7
 * product catalog (A7T02), the A7 product-policy profile (A7T03), the
 * A7 product customer-binding map (A7T04), the A7 product
 * command/operation identity (A7T05), the A7 product lifecycle
 * (A7T07), the A7 product notification delivery (A7T06), the A7
 * product financial effect (A7T08), and the A7 product reconciliation
 * (A7T09).
 *
 * No new A6T10 data classification registry, A6T10 consent authority,
 * A6T10 retention authority, A6T10 legal-hold authority, A6T10 secret
 * authority, A6T10 disclosure authority, A6T10 support-trace
 * authority, A6T10 partner-payload validation authority, A2
 * authorization, A3 binding, A4 product-policy, A6T05
 * external-operation, A6 partner, A5 transfer command, A7 product
 * catalog, A7 product-policy profile, A7 product customer-binding
 * map, A7 product command/operation, A7 product notification delivery,
 * A7 product lifecycle, A7 product financial effect, A7 product
 * reconciliation, Wallet, Ledger, Operations, Outbox, Idempotency,
 * Metrics, Diagnostics, Reconciliation, or `CustomerPreference`
 * authority is introduced.
 */

/**
 * A7 product data minimization contract name (frozen by
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §2.2).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_NAME = 'A7-PRODUCT-DATA-MINIMIZATION' as const;

/**
 * A7 product data minimization contract version (frozen by
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §2.2).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_VERSION = 1 as const;

/**
 * A7 product data minimization contract reference (frozen by
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §2.3).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_CONTRACT_DOCUMENT =
  'docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md' as const;

/**
 * A7 product data minimization internal idempotency scope (frozen).
 * The A7 product data minimization internal idempotency scope is the
 * A7 product data minimization record's idempotency scope.
 */
export const A7_PRODUCT_DATA_MINIMIZATION_INTERNAL_IDEMPOTENCY_SCOPE =
  'a7.product-data-minimization.idempotency.v1' as const;

/**
 * A7 product data minimization provider idempotency scope (frozen).
 * The A7 product data minimization provider idempotency scope is
 * sourced from the A6T05 provider idempotency scope per ADR-0049.
 */
export const A7_PRODUCT_DATA_MINIMIZATION_PROVIDER_IDEMPOTENCY_SCOPE =
  'nibss.nip.external-operation.v1' as const;

/**
 * A7 product data minimization retention (frozen).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_RETENTION_SECONDS = 86_400 as const;

/**
 * A7 product data minimization audit entity type (frozen).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ENTITY_TYPE =
  'A7_PRODUCT_DATA_MINIMIZATION' as const;

/**
 * A7 product data minimization audit actor (frozen).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_AUDIT_ACTOR = 'a7-product-data-minimization' as const;

/**
 * A7 product data minimization reference prefixes (frozen).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_REFERENCE_PREFIX =
  'a7-product-data-minimization' as const;
export const A7_PRODUCT_DISCLOSURE_REFERENCE_PREFIX = 'a7-product-disclosure' as const;
export const A7_PRODUCT_SUPPORT_TRACE_REFERENCE_PREFIX = 'a7-product-support-trace' as const;
export const A7_PRODUCT_CONSENT_REFERENCE_PREFIX = 'a7-product-consent' as const;
export const A7_PRODUCT_LEGAL_HOLD_REFERENCE_PREFIX = 'a7-product-legal-hold' as const;
export const A7_PRODUCT_RETENTION_REFERENCE_PREFIX = 'a7-product-retention' as const;
export const A7_PRODUCT_SECRET_REFERENCE_PREFIX = 'a7-product-secret' as const;

/**
 * A7 product data minimization failure code vocabulary (frozen; see
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §4.7).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CLASSIFICATION_NOT_REGISTERED =
  'A7_PRODUCT_DATA_MINIMIZATION_CLASSIFICATION_NOT_REGISTERED' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_EXPIRED =
  'A7_PRODUCT_DATA_MINIMIZATION_CONSENT_EXPIRED' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_REVOKED =
  'A7_PRODUCT_DATA_MINIMIZATION_CONSENT_REVOKED' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_PURPOSE_MISMATCH =
  'A7_PRODUCT_DATA_MINIMIZATION_CONSENT_PURPOSE_MISMATCH' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_JURISDICTION_MISMATCH =
  'A7_PRODUCT_DATA_MINIMIZATION_CONSENT_JURISDICTION_MISMATCH' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_MISSING =
  'A7_PRODUCT_DATA_MINIMIZATION_CONSENT_MISSING' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_RETENTION_HOLD_ACTIVE =
  'A7_PRODUCT_DATA_MINIMIZATION_RETENTION_HOLD_ACTIVE' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_RETENTION_BELOW_FLOOR =
  'A7_PRODUCT_DATA_MINIMIZATION_RETENTION_BELOW_FLOOR' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_HOLD_AUTHORITY_MISSING =
  'A7_PRODUCT_DATA_MINIMIZATION_HOLD_AUTHORITY_MISSING' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_HOLD_NOT_FOUND =
  'A7_PRODUCT_DATA_MINIMIZATION_HOLD_NOT_FOUND' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_SECRET_IN_RAW_PAYLOAD =
  'A7_PRODUCT_DATA_MINIMIZATION_SECRET_IN_RAW_PAYLOAD' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_SECRET_IN_SUPPORT_TRACE =
  'A7_PRODUCT_DATA_MINIMIZATION_SECRET_IN_SUPPORT_TRACE' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_AUDIENCE_TOO_LOW =
  'A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_AUDIENCE_TOO_LOW' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_FIELD_NOT_REGISTERED =
  'A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_FIELD_NOT_REGISTERED' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_REJECTED_HIGHLY_RESTRICTED =
  'A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_REJECTED_HIGHLY_RESTRICTED' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_BEYOND_LEGAL_HOLD =
  'A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_BEYOND_LEGAL_HOLD' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_PARTNER_PAYLOAD_REJECTED =
  'A7_PRODUCT_DATA_MINIMIZATION_PARTNER_PAYLOAD_REJECTED' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_PARTNER_PAYLOAD_MISSING_FIELD =
  'A7_PRODUCT_DATA_MINIMIZATION_PARTNER_PAYLOAD_MISSING_FIELD' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND =
  'A7_PRODUCT_DATA_MINIMIZATION_INVALID_COMMAND' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE =
  'A7_PRODUCT_DATA_MINIMIZATION_QUERY_UNAVAILABLE' as const;

export const A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CODES: readonly string[] = Object.freeze([
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CLASSIFICATION_NOT_REGISTERED,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_EXPIRED,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_REVOKED,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_PURPOSE_MISMATCH,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_JURISDICTION_MISMATCH,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_CONSENT_MISSING,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_RETENTION_HOLD_ACTIVE,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_RETENTION_BELOW_FLOOR,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_HOLD_AUTHORITY_MISSING,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_HOLD_NOT_FOUND,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_SECRET_IN_RAW_PAYLOAD,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_SECRET_IN_SUPPORT_TRACE,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_AUDIENCE_TOO_LOW,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_FIELD_NOT_REGISTERED,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_REJECTED_HIGHLY_RESTRICTED,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_DISCLOSURE_BEYOND_LEGAL_HOLD,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_PARTNER_PAYLOAD_REJECTED,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_PARTNER_PAYLOAD_MISSING_FIELD,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_INVALID_COMMAND,
  A7_PRODUCT_DATA_MINIMIZATION_FAILURE_QUERY_UNAVAILABLE,
]);

/**
 * A7 product consent purpose vocabulary (frozen; see
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §4.3).
 */
export const A7_PRODUCT_CONSENT_PURPOSE = 'PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING' as const;

export const A7_PRODUCT_CONSENT_PURPOSES: readonly string[] = Object.freeze([
  A7_PRODUCT_CONSENT_PURPOSE,
]);

/**
 * A7 product consent approved jurisdiction (frozen; the A6T10 approved
 * jurisdictions are `NG`, and the A7 first product is NG-only).
 */
export const A7_PRODUCT_CONSENT_APPROVED_JURISDICTION = 'NG' as const;

export const A7_PRODUCT_CONSENT_APPROVED_JURISDICTIONS: readonly string[] = Object.freeze([
  A7_PRODUCT_CONSENT_APPROVED_JURISDICTION,
]);

/**
 * A7 product retention dataset vocabulary (frozen; see
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §4.4).
 */
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_OPERATION = 'A7_PRODUCT_OPERATION' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_COMMAND = 'A7_PRODUCT_COMMAND' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_LIFECYCLE = 'A7_PRODUCT_LIFECYCLE' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_FINANCIAL_EFFECT =
  'A7_PRODUCT_FINANCIAL_EFFECT' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_CUSTOMER_BINDING =
  'A7_PRODUCT_CUSTOMER_BINDING' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_NOTIFICATION_DELIVERY =
  'A7_PRODUCT_NOTIFICATION_DELIVERY' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_DISCLOSURE = 'A7_PRODUCT_DISCLOSURE' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_SUPPORT_TRACE =
  'A7_PRODUCT_SUPPORT_TRACE' as const;
export const A7_PRODUCT_RETENTION_DATASET_PRODUCT_RECONCILIATION =
  'A7_PRODUCT_RECONCILIATION' as const;

export const A7_PRODUCT_RETENTION_DATASETS: readonly string[] = Object.freeze([
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_OPERATION,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_COMMAND,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_LIFECYCLE,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_FINANCIAL_EFFECT,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_CUSTOMER_BINDING,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_NOTIFICATION_DELIVERY,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_DISCLOSURE,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_SUPPORT_TRACE,
  A7_PRODUCT_RETENTION_DATASET_PRODUCT_RECONCILIATION,
]);

/**
 * A7 product retention days (frozen).
 */
export const A7_PRODUCT_RETENTION_DAYS_OPERATION = 365 as const;
export const A7_PRODUCT_RETENTION_DAYS_COMMAND = 365 as const;
export const A7_PRODUCT_RETENTION_DAYS_LIFECYCLE = 365 as const;
export const A7_PRODUCT_RETENTION_DAYS_FINANCIAL_EFFECT = 365 as const;
export const A7_PRODUCT_RETENTION_DAYS_CUSTOMER_BINDING = 365 as const;
export const A7_PRODUCT_RETENTION_DAYS_NOTIFICATION_DELIVERY = 90 as const;
export const A7_PRODUCT_RETENTION_DAYS_DISCLOSURE = 30 as const;
export const A7_PRODUCT_RETENTION_DAYS_SUPPORT_TRACE = 90 as const;
export const A7_PRODUCT_RETENTION_DAYS_RECONCILIATION = 90 as const;

/**
 * A7 product legal-hold scope vocabulary (frozen; see
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §4.5). The A7
 * product legal-hold scopes are mapped 1-to-1 to the A7 product
 * retention datasets.
 */
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_OPERATION = 'A7_PRODUCT_OPERATION' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_COMMAND = 'A7_PRODUCT_COMMAND' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_LIFECYCLE = 'A7_PRODUCT_LIFECYCLE' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_FINANCIAL_EFFECT = 'A7_PRODUCT_FINANCIAL_EFFECT' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_CUSTOMER_BINDING = 'A7_PRODUCT_CUSTOMER_BINDING' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_NOTIFICATION_DELIVERY =
  'A7_PRODUCT_NOTIFICATION_DELIVERY' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_DISCLOSURE = 'A7_PRODUCT_DISCLOSURE' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_SUPPORT_TRACE = 'A7_PRODUCT_SUPPORT_TRACE' as const;
export const A7_PRODUCT_LEGAL_HOLD_SCOPE_RECONCILIATION = 'A7_PRODUCT_RECONCILIATION' as const;

export const A7_PRODUCT_LEGAL_HOLD_SCOPES: readonly string[] = Object.freeze([
  A7_PRODUCT_LEGAL_HOLD_SCOPE_OPERATION,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_COMMAND,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_LIFECYCLE,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_FINANCIAL_EFFECT,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_CUSTOMER_BINDING,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_NOTIFICATION_DELIVERY,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_DISCLOSURE,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_SUPPORT_TRACE,
  A7_PRODUCT_LEGAL_HOLD_SCOPE_RECONCILIATION,
]);

/**
 * A7 product data minimization disclosure audience vocabulary
 * (frozen; reuses the A6T10 disclosure audience vocabulary; see
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §4.2). The A7
 * product data minimization contract does NOT introduce a new
 * disclosure audience.
 */
export const A7_PRODUCT_DISCLOSURE_AUDIENCES: readonly string[] = Object.freeze([
  'SUPPORT',
  'OPERATIONS',
  'RECONCILIATION',
  'FINANCE',
  'COMPLIANCE',
  'LEGAL',
  'SECURITY',
  'A6_TEN_INTERNAL',
]);

/**
 * A7 product data minimization data handling level vocabulary
 * (frozen; reuses the A6T10 data handling level vocabulary; see
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §4.1). The A7
 * product data minimization contract does NOT introduce a new data
 * handling level.
 */
export const A7_PRODUCT_DATA_HANDLING_LEVELS: readonly string[] = Object.freeze([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
]);

/**
 * A7 product data minimization secret category vocabulary (frozen;
 * reuses the A6T10 secret category vocabulary; see
 * `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md` §4.6). The A7
 * product data minimization contract does NOT introduce a new secret
 * category.
 */
export const A7_PRODUCT_SECRET_CATEGORIES: readonly string[] = Object.freeze([
  'PARTNER_CLIENT_AUTHENTICATION',
  'PARTNER_REQUEST_SIGNING_KEY',
  'CALLBACK_SECRET',
  'CALLBACK_SIGNATURE',
  'PRIVATE_KEY',
  'CUSTOMER_PIN',
  'CUSTOMER_OTP',
  'DEVICE_FINGERPRINT_RAW',
  'RISK_NARRATIVE_RAW',
  'COMPLIANCE_CASE_RAW',
]);

/**
 * A7 product data minimization product key (frozen; the A7 first
 * product key, shared with A7T02 product catalog and A7T09 product
 * reconciliation).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;

/**
 * A7 product data minimization product version (frozen; the A7 first
 * product version, shared with A7T02 product catalog and A7T09
 * product reconciliation).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_VERSION = 1 as const;

/**
 * A7 product data minimization product capability (frozen; the A7
 * first product capability, shared with A7T03 product policy and
 * A7T07 product lifecycle).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_CAPABILITY = 'product.virtual-account' as const;

/**
 * A7 product data minimization product action (frozen; the A7 first
 * product lifecycle action, shared with A7T03 product policy and
 * A7T07 product lifecycle).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_PRODUCT_ACTION = 'lifecycle' as const;

/**
 * A7 product data minimization source domains (frozen).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_SOURCE_DOMAIN = 'a7.product' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_SOURCE_DOMAIN_PARTNER = 'a7.product.partner' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_SOURCE_DOMAIN_NOTIFICATION =
  'a7.product.notification' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_SOURCE_DOMAIN_SUPPORT = 'a7.product.support' as const;

/**
 * A7 product data minimization owners (frozen).
 */
export const A7_PRODUCT_DATA_MINIMIZATION_OWNER = 'a7-product-data-minimization' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_OWNER_PARTNER =
  'a7-product-data-minimization.partner' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_OWNER_NOTIFICATION =
  'a7-product-data-minimization.notification' as const;
export const A7_PRODUCT_DATA_MINIMIZATION_OWNER_SUPPORT =
  'a7-product-data-minimization.support' as const;
