/**
 * A7T05 — A7 product command identity, lifecycle, and idempotency frozen
 * constants for the A7 first product.
 *
 * The A7 first product is `VIRTUAL_ACCOUNT` v1 (per
 * `docs/A7-PRODUCT-EXPANSION-BASELINE.md` and `docs/A7-PRODUCT-CATALOG-CONTRACT.md`).
 * The A7 product command and idempotency contract consumes the A2
 * authorization context, the A3 customer-to-financial-account binding,
 * the A4 product-policy decision, the A5 transfer command correlation,
 * the A6T05 external-operation identity and provider idempotency
 * (per ADR-0049), the A6 partner-adapter boundary, the A7 product
 * catalog (A7T02), the A7 product-policy profile (A7T03), and the A7
 * product customer-binding map (A7T04).
 *
 * No new A3 binding, A4 product-policy, A2 authorization, A6T05
 * external-operation, A6 partner, A5 transfer command, A7 product
 * catalog, A7 product-policy profile, A7 product customer-binding map,
 * Wallet, Ledger, Operations, Outbox, Idempotency, Metrics,
 * Diagnostics, Reconciliation, or `CustomerPreference` authority is
 * introduced. The A7 product command and idempotency contract is a
 * read-write contract against the shared Operations `IdempotencyService`,
 * `AuditService`, and `OutboxService` and a read-only consumer of the
 * A6T05 `ExternalOperationService`, the A2 `AuthorizationService`, the
 * A4 product-policy service, the A3 `CustomerFinancialAccountBindingService`,
 * the A5 transfer command correlation, the A6 partner-adapter boundary,
 * the A7 product catalog, the A7 product-policy profile, and the A7
 * product customer-binding map.
 */

import { NIBSS_NIP_PARTNER_KEY } from '../partner/partner-adapter.types';

/**
 * A7 product command contract name (frozen by
 * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md` §1.4).
 */
export const A7_PRODUCT_COMMAND_CONTRACT_NAME = 'A7-PRODUCT-COMMAND' as const;

/**
 * A7 product command contract version (frozen by
 * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md` §1.4).
 */
export const A7_PRODUCT_COMMAND_CONTRACT_VERSION = 1 as const;

/**
 * A7 product command identity namespace.
 */
export const A7_PRODUCT_COMMAND_IDENTITY_NAMESPACE = 'A7-PRODUCT-COMMAND' as const;

/**
 * A7 product operation identity namespace.
 */
export const A7_PRODUCT_OPERATION_IDENTITY_NAMESPACE = 'A7-PRODUCT-OPERATION' as const;

/**
 * A7 product internal idempotency scope (frozen by
 * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md` §6.1).
 *
 * The A7 internal idempotency scope is a separate namespace from the
 * A6T05 `external.partner.operation.v1` scope. The A6T05 scope is
 * reused (sourced from A6T05) for the A7 product provider idempotency
 * scope/key.
 */
export const A7_PRODUCT_COMMAND_INTERNAL_IDEMPOTENCY_SCOPE = 'A7-PRODUCT-IDEMPOTENCY.v1' as const;

/**
 * A7 product provider idempotency scope (frozen by
 * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md` §6.2).
 *
 * The A7 product provider idempotency scope is sourced from the A6T05
 * provider idempotency scope (`nibss.nip.external-operation.v1`) per
 * ADR-0049. The A7 product command service does NOT generate or maintain
 * a separate A7 provider idempotency scope; the A7 product command
 * service reads the A6T05 provider idempotency scope/key from the A6T05
 * `ExternalOperation` record and references it inside the A7 product
 * command operation envelope.
 */
export const A7_PRODUCT_COMMAND_PROVIDER_IDEMPOTENCY_SCOPE =
  'nibss.nip.external-operation.v1' as const;

/**
 * A7 product command retention interval (24 hours; aligned with the
 * shared Operations `IdempotencyService` default).
 */
export const A7_PRODUCT_COMMAND_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * A7 product command audit entity type (reused by the shared Operations
 * `AuditService`; the A7 product command audit fact is recorded against
 * the `A7_PRODUCT_COMMAND` entity type).
 */
export const A7_PRODUCT_COMMAND_AUDIT_ENTITY_TYPE = 'A7_PRODUCT_COMMAND' as const;

/**
 * A7 product command audit actor (reused by the shared Operations
 * `AuditService`).
 */
export const A7_PRODUCT_COMMAND_AUDIT_ACTOR = 'a7-product-command' as const;

/**
 * A7 product command audit action codes. The A7 product command audit
 * facts are recorded through the shared Operations `AuditService`; the
 * `action` is one of the A7 product command audit action codes.
 */
export const A7_PRODUCT_COMMAND_AUDIT_ACTION_RESERVED = 'A7_PRODUCT_COMMAND_RESERVED' as const;
export const A7_PRODUCT_COMMAND_AUDIT_ACTION_ADMITTED = 'A7_PRODUCT_COMMAND_ADMITTED' as const;
export const A7_PRODUCT_COMMAND_AUDIT_ACTION_COMPLETED = 'A7_PRODUCT_COMMAND_COMPLETED' as const;
export const A7_PRODUCT_COMMAND_AUDIT_ACTION_FAILED = 'A7_PRODUCT_COMMAND_FAILED' as const;
export const A7_PRODUCT_COMMAND_AUDIT_ACTION_REPLAYED = 'A7_PRODUCT_COMMAND_REPLAYED' as const;
export const A7_PRODUCT_COMMAND_AUDIT_ACTION_CONFLICTED = 'A7_PRODUCT_COMMAND_CONFLICTED' as const;

/**
 * A7 product command outbox event type (reused by the shared Operations
 * `OutboxService`).
 */
export const A7_PRODUCT_COMMAND_OUTBOX_EVENT_TYPE = 'A7ProductCommandAdmitted' as const;

/**
 * A7 product command outbox event classification (reused by the shared
 * Operations `OutboxService`).
 */
export const A7_PRODUCT_COMMAND_OUTBOX_EVENT_CLASSIFICATION = 'INTERNAL_OPERATIONS' as const;

/**
 * A7 product command outbox event retention class (reused by the shared
 * Operations `OutboxService`).
 */
export const A7_PRODUCT_COMMAND_OUTBOX_EVENT_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

/**
 * A7 product command operation state vocabulary (frozen by
 * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md` §4.2).
 */
export const A7_PRODUCT_COMMAND_OPERATION_STATE_RESERVED = 'COMMAND_RESERVED' as const;
export const A7_PRODUCT_COMMAND_OPERATION_STATE_ADMITTED = 'COMMAND_ADMITTED' as const;
export const A7_PRODUCT_COMMAND_OPERATION_STATE_COMPLETED = 'COMMAND_COMPLETED' as const;
export const A7_PRODUCT_COMMAND_OPERATION_STATE_FAILED = 'COMMAND_FAILED' as const;
export const A7_PRODUCT_COMMAND_OPERATION_STATE_REPLAYED = 'COMMAND_REPLAYED' as const;
export const A7_PRODUCT_COMMAND_OPERATION_STATE_CONFLICTED = 'COMMAND_CONFLICTED' as const;

/**
 * A7 product command operation state vocabulary (frozen array of all
 * allowed states).
 */
export const A7_PRODUCT_COMMAND_OPERATION_STATES: readonly string[] = Object.freeze([
  A7_PRODUCT_COMMAND_OPERATION_STATE_RESERVED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_ADMITTED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_COMPLETED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_FAILED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_REPLAYED,
  A7_PRODUCT_COMMAND_OPERATION_STATE_CONFLICTED,
]);

/**
 * A7 product command product state vocabulary (reused from the A7T02
 * product catalog; the A7 product command service does not introduce a
 * new A7 product state).
 */
export const A7_PRODUCT_COMMAND_ASSIGN_STATES: readonly string[] = Object.freeze([
  'ASSIGN_REQUESTED',
  'ASSIGN_PENDING',
  'ASSIGN_ACTIVE',
  'ASSIGN_SUSPENDED',
  'ASSIGN_FAILED',
  'ASSIGN_CLOSED',
]);

export const A7_PRODUCT_COMMAND_FUNDING_STATES: readonly string[] = Object.freeze([
  'FUNDING_REQUESTED',
  'FUNDING_PENDING_VERIFICATION',
  'FUNDING_SETTLED',
  'FUNDING_UNKNOWN',
  'FUNDING_SUSPENDED',
  'FUNDING_FAILED',
  'FUNDING_CLOSED',
]);

export const A7_PRODUCT_COMMAND_ALL_STATES: readonly string[] = Object.freeze([
  ...A7_PRODUCT_COMMAND_ASSIGN_STATES,
  ...A7_PRODUCT_COMMAND_FUNDING_STATES,
]);

/**
 * A7 product command capability keys (frozen by the A7T02 product
 * catalog registration).
 */
export const A7_PRODUCT_COMMAND_CAPABILITY_ASSIGN = 'virtual-account.assign' as const;
export const A7_PRODUCT_COMMAND_CAPABILITY_INBOUND_FUNDING =
  'virtual-account.inbound-funding' as const;

/**
 * A7 product command action keys (frozen by the A7T02 product catalog
 * registration).
 */
export const A7_PRODUCT_COMMAND_ACTION_ASSIGN = 'assign' as const;
export const A7_PRODUCT_COMMAND_ACTION_LIFECYCLE = 'lifecycle' as const;

/**
 * A6 partner identity (reused from the A6T05 partner-adapter boundary).
 */
export const A7_PRODUCT_COMMAND_PARTNER_KEY = NIBSS_NIP_PARTNER_KEY;

/**
 * A6 partner capability and operation (reused from the A6T05 partner-
 * adapter boundary).
 */
export const A7_PRODUCT_COMMAND_PARTNER_CAPABILITY =
  'external.wallet.withdrawal.settlement' as const;
export const A7_PRODUCT_COMMAND_PARTNER_OPERATION = 'OUTBOUND_BANK_SETTLEMENT' as const;

/**
 * A7 product command failure codes (frozen by
 * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md`).
 */
export const A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_MISSING =
  'A7_PRODUCT_A2_AUTHORIZATION_MISSING' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_STALE =
  'A7_PRODUCT_A2_AUTHORIZATION_STALE' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A2_AUTHORIZATION_DENIED =
  'A7_PRODUCT_A2_AUTHORIZATION_DENIED' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_MISSING =
  'A7_PRODUCT_A3_BINDING_MISSING' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A3_BINDING_NOT_ACTIVE =
  'A7_PRODUCT_A3_BINDING_NOT_ACTIVE' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A3_STALE_BINDING = 'A7_PRODUCT_A3_STALE_BINDING' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_MISSING =
  'A7_PRODUCT_A4_POLICY_DECISION_MISSING' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_EXPIRED =
  'A7_PRODUCT_A4_POLICY_DECISION_EXPIRED' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE =
  'A7_PRODUCT_A4_POLICY_DECISION_NOT_EXECUTABLE' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING =
  'A7_PRODUCT_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED =
  'A7_PRODUCT_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MISSING =
  'A7_PRODUCT_A6_EXTERNAL_OPERATION_MISSING' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_NOT_FOUND =
  'A7_PRODUCT_A6_EXTERNAL_OPERATION_NOT_FOUND' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT =
  'A7_PRODUCT_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT' as const;
export const A7_PRODUCT_COMMAND_FAILURE_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH =
  'A7_PRODUCT_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH' as const;
export const A7_PRODUCT_COMMAND_FAILURE_REQUEST_HASH_CONFLICT =
  'A7_PRODUCT_REQUEST_HASH_CONFLICT' as const;
export const A7_PRODUCT_COMMAND_FAILURE_IDEMPOTENCY_IN_PROGRESS =
  'A7_PRODUCT_IDEMPOTENCY_IN_PROGRESS' as const;
export const A7_PRODUCT_COMMAND_FAILURE_PRODUCT_CATALOG_REJECTED =
  'A7_PRODUCT_CATALOG_REJECTED' as const;
export const A7_PRODUCT_COMMAND_FAILURE_CURRENCY_MISMATCH = 'A7_PRODUCT_CURRENCY_MISMATCH' as const;
export const A7_PRODUCT_COMMAND_FAILURE_ACCOUNTING_UNIT_MISMATCH =
  'A7_PRODUCT_ACCOUNTING_UNIT_MISMATCH' as const;
export const A7_PRODUCT_COMMAND_FAILURE_AMOUNT_INVALID = 'A7_PRODUCT_AMOUNT_INVALID' as const;
export const A7_PRODUCT_COMMAND_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE =
  'A7_PRODUCT_OPERATIONS_EVIDENCE_UNAVAILABLE' as const;

/**
 * A7 product command reference prefix (frozen by
 * `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md` §2.1).
 */
export const A7_PRODUCT_COMMAND_REFERENCE_PREFIX = 'a7-product-command' as const;
export const A7_PRODUCT_OPERATION_REFERENCE_PREFIX = 'a7-product-operation' as const;
