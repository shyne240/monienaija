/**
 * A7T07 — A7 product lifecycle, bounded retry, manual review, unknown
 * outcomes, and recovery frozen constants for the A7 first product.
 *
 * The A7 first product is `VIRTUAL_ACCOUNT` v1 (per
 * `docs/A7-PRODUCT-EXPANSION-BASELINE.md` and
 * `docs/A7-PRODUCT-CATALOG-CONTRACT.md`). The A7 product lifecycle
 * contract is the runtime resilience and lifecycle implementation for
 * the A7 first product; the A7 product lifecycle contract extends the
 * A6 lifecycle vocabulary (per `docs/A7-IMPLEMENTATION-PLAN.md` §8
 * A7T07) without replacing or duplicating the A6 lifecycle authority.
 *
 * The A7 product lifecycle contract consumes the A2 authorization
 * context, the A3 customer-to-financial-account binding, the A4
 * product-policy decision, the A5 transfer command correlation, the
 * A6 lifecycle authority (A6T07 transitions; partner circuit-breaker;
 * status verification; retry; unknown-outcome recovery; per
 * `docs/A6-EXTERNAL-LIFECYCLE-CONTRACT.md`), the A6T05 external-
 * operation identity and provider idempotency (per ADR-0049), the A6
 * partner-adapter boundary, the A7 product catalog (A7T02), the A7
 * product-policy profile (A7T03), the A7 product customer-binding
 * map (A7T04), the A7 product command/operation identity (A7T05),
 * and the A7 product notification delivery (A7T06).
 *
 * The A7 product lifecycle contract is a read-write contract against
 * the shared Operations `IdempotencyService`, `AuditService`,
 * `OutboxService`, `MetricsService`, and `DiagnosticsService` and a
 * read-only consumer of the A6 lifecycle authority, the A6T05
 * `ExternalOperationService`, the A6 `PartnerCircuitBreakerService`,
 * the A6T07 status verifier, the A2 `AuthorizationService`, the A4
 * product-policy service, the A3 `CustomerFinancialAccountBindingService`,
 * the A7 product catalog, the A7 product-policy profile, the A7
 * product customer-binding map, the A7 product command/operation
 * identity, and the A7 product notification delivery handoff.
 *
 * No new A3 binding, A4 product-policy, A2 authorization, A6T05
 * external-operation, A6 partner, A5 transfer command, A6 lifecycle,
 * A6 circuit-breaker, A6 status-verification, A6 retry/recovery, A7
 * product catalog, A7 product-policy profile, A7 product customer-
 * binding map, A7 product command/operation, A7 product notification,
 * Wallet, Ledger, Operations, Outbox, Idempotency, Metrics,
 * Diagnostics, Reconciliation, or `CustomerPreference` authority is
 * introduced. The A7 product lifecycle contract does not introduce
 * an unbounded retry loop, an unowned scheduler, or a local product
 * idempotency/audit store; the A7 product lifecycle contract reuses
 * the shared Operations primitives and the A6 lifecycle authority.
 */

import { NIBSS_NIP_PARTNER_KEY } from '../partner/partner-adapter.types';

/**
 * A7 product lifecycle contract name (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 */
export const A7_PRODUCT_LIFECYCLE_CONTRACT_NAME = 'A7-PRODUCT-LIFECYCLE' as const;

/**
 * A7 product lifecycle contract version (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 */
export const A7_PRODUCT_LIFECYCLE_CONTRACT_VERSION = 1 as const;

/**
 * A7 product lifecycle identity namespace.
 */
export const A7_PRODUCT_LIFECYCLE_IDENTITY_NAMESPACE = 'A7-PRODUCT-LIFECYCLE' as const;

/**
 * A7 product lifecycle internal idempotency scope (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 *
 * The A7 product lifecycle internal idempotency scope is a separate
 * namespace from the A7T05 internal idempotency scope
 * (`A7-PRODUCT-IDEMPOTENCY.v1`), the A7T06 internal idempotency
 * scope (`a7.notification-dispatch.idempotency.v1`), and the A6T05
 * internal idempotency scope (`external.partner.operation.v1`). The
 * A7 product lifecycle contract does NOT generate or maintain a
 * separate A7 provider idempotency scope; the A7 product lifecycle
 * contract reads the A6T05 provider idempotency scope/key from the
 * A6T05 `ExternalOperation` record and references it inside the A7
 * product lifecycle outbox payload as correlation metadata per
 * ADR-0049.
 */
export const A7_PRODUCT_LIFECYCLE_INTERNAL_IDEMPOTENCY_SCOPE =
  'a7.product-lifecycle.idempotency.v1' as const;

/**
 * A7 product lifecycle provider idempotency scope (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 *
 * The A7 product lifecycle provider idempotency scope is sourced
 * from the A6T05 provider idempotency scope per ADR-0049. The A7
 * product lifecycle contract does NOT generate or maintain a separate
 * A7 provider idempotency scope.
 */
export const A7_PRODUCT_LIFECYCLE_PROVIDER_IDEMPOTENCY_SCOPE =
  'nibss.nip.external-operation.v1' as const;

/**
 * A7 product lifecycle retention interval (24 hours; aligned with
 * the shared Operations `IdempotencyService` default).
 */
export const A7_PRODUCT_LIFECYCLE_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * A7 product lifecycle audit entity type (reused by the shared
 * Operations `AuditService`; the A7 product lifecycle audit fact is
 * recorded against the `A7_PRODUCT_LIFECYCLE` entity type).
 */
export const A7_PRODUCT_LIFECYCLE_AUDIT_ENTITY_TYPE = 'A7_PRODUCT_LIFECYCLE' as const;

/**
 * A7 product lifecycle audit actor (reused by the shared Operations
 * `AuditService`).
 */
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTOR = 'a7-product-lifecycle' as const;

/**
 * A7 product lifecycle audit action codes. The A7 product lifecycle
 * audit facts are recorded through the shared Operations
 * `AuditService`; the `action` is one of the A7 product lifecycle
 * audit action codes.
 */
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RESERVED = 'A7_PRODUCT_LIFECYCLE_RESERVED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_ADMITTED = 'A7_PRODUCT_LIFECYCLE_ADMITTED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_PARTNER_PENDING =
  'A7_PRODUCT_LIFECYCLE_PARTNER_PENDING' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_PENDING_VERIFICATION =
  'A7_PRODUCT_LIFECYCLE_PENDING_VERIFICATION' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_UNKNOWN = 'A7_PRODUCT_LIFECYCLE_UNKNOWN' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_MANUAL_REVIEW =
  'A7_PRODUCT_LIFECYCLE_MANUAL_REVIEW' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_FAILED = 'A7_PRODUCT_LIFECYCLE_FAILED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_SCHEDULED =
  'A7_PRODUCT_LIFECYCLE_RETRY_SCHEDULED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_EXHAUSTED =
  'A7_PRODUCT_LIFECYCLE_RETRY_EXHAUSTED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_CANCELLED =
  'A7_PRODUCT_LIFECYCLE_CANCELLED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_ISSUED =
  'A7_PRODUCT_LIFECYCLE_RECOVERY_ISSUED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RECOVERY_RESOLVED =
  'A7_PRODUCT_LIFECYCLE_RECOVERY_RESOLVED' as const;
export const A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_REPLAYED = 'A7_PRODUCT_LIFECYCLE_REPLAYED' as const;

/**
 * A7 product lifecycle outbox event type (reused by the shared
 * Operations `OutboxService`).
 */
export const A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_TYPE = 'A7ProductLifecycleTransitioned' as const;

/**
 * A7 product lifecycle outbox event classification (reused by the
 * shared Operations `OutboxService`).
 */
export const A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_CLASSIFICATION = 'INTERNAL_OPERATIONS' as const;

/**
 * A7 product lifecycle outbox event retention class (reused by the
 * shared Operations `OutboxService`).
 */
export const A7_PRODUCT_LIFECYCLE_OUTBOX_EVENT_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

/**
 * A7 product lifecycle state vocabulary (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 *
 * The A7 product lifecycle state vocabulary extends, but does NOT
 * replace, the A6 lifecycle vocabulary. The A6 lifecycle authority
 * (A6T07 transitions, `ExternalOperationLifecycleState` enum) is the
 * only lifecycle authority; the A7 product lifecycle states are
 * product-side correlation states that the A7 product lifecycle
 * service records alongside the A6 lifecycle states. The A7 product
 * lifecycle states reuse the A6 semantics for `PENDING_PARTNER`,
 * `PENDING_VERIFICATION`, `UNKNOWN`, `MANUAL_REVIEW`, `FAILED`, and
 * `CANCELLED`, and add `RETRY_SCHEDULED` and `RECOVERY_ISSUED` as
 * product-side correlation states that the A7 product lifecycle
 * service uses to communicate the bounded retry, manual-review, and
 * recovery decisions to the A7 product lifecycle audit and outbox
 * payloads.
 */
export const A7_PRODUCT_LIFECYCLE_STATE_PENDING = 'LIFECYCLE_PENDING' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_ADMITTED = 'LIFECYCLE_ADMITTED' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER = 'LIFECYCLE_PENDING_PARTNER' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION =
  'LIFECYCLE_PENDING_VERIFICATION' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN = 'LIFECYCLE_UNKNOWN' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW = 'LIFECYCLE_MANUAL_REVIEW' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED = 'LIFECYCLE_RETRY_SCHEDULED' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED = 'LIFECYCLE_RECOVERY_ISSUED' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_FAILED = 'LIFECYCLE_FAILED' as const;
export const A7_PRODUCT_LIFECYCLE_STATE_CANCELLED = 'LIFECYCLE_CANCELLED' as const;

/**
 * A7 product lifecycle state vocabulary (frozen array of all allowed
 * states).
 */
export const A7_PRODUCT_LIFECYCLE_STATES: readonly string[] = Object.freeze([
  A7_PRODUCT_LIFECYCLE_STATE_PENDING,
  A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
  A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
  A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN,
  A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
  A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
  A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED,
  A7_PRODUCT_LIFECYCLE_STATE_FAILED,
  A7_PRODUCT_LIFECYCLE_STATE_CANCELLED,
]);

/**
 * A7 product lifecycle handoff scope (single-use, support-traceable,
 * A2-protected internal control surface).
 */
export const A7_PRODUCT_LIFECYCLE_HANDOFF_SCOPE = 'a7-product-lifecycle-handoff.v1' as const;

/**
 * A7 product lifecycle handoff validity interval.
 */
export const A7_PRODUCT_LIFECYCLE_HANDOFF_VALIDITY_SECONDS = 15 * 60;

/**
 * A7 product lifecycle terminal state vocabulary (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07). Terminal states are the
 * only states from which the A7 product lifecycle service does NOT
 * admit a transition.
 */
export const A7_PRODUCT_LIFECYCLE_TERMINAL_STATES: readonly string[] = Object.freeze([
  A7_PRODUCT_LIFECYCLE_STATE_FAILED,
  A7_PRODUCT_LIFECYCLE_STATE_CANCELLED,
]);

// The `RETRY_EXHAUSTED_PLACEHOLDER` is a synthetic state name used
// only as a transition target marker for the `RETRY_SCHEDULED` state;
// the A7 product lifecycle service translates the
// `RETRY_EXHAUSTED_PLACEHOLDER` transition into the
// `A7_PRODUCT_LIFECYCLE_STATE_FAILED` terminal state and the
// `A7_PRODUCT_LIFECYCLE_AUDIT_ACTION_RETRY_EXHAUSTED` audit action.
const A7_PRODUCT_LIFECYCLE_STATE_RETRY_EXHAUSTED_PLACEHOLDER = 'LIFECYCLE_RETRY_EXHAUSTED';

/**
 * A7 product lifecycle state transitions (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07). The transition table
 * is the product-side correlation of the A6 lifecycle transition
 * table; the A7 product lifecycle state transitions are
 * `LIFECYCLE_*` transitions recorded alongside the A6 lifecycle
 * transitions, NOT a replacement for the A6 lifecycle transitions.
 * The A7 product lifecycle service records the A7 product lifecycle
 * state transition inside the A7 product lifecycle audit and outbox
 * payloads; the A6 lifecycle service records the A6 lifecycle
 * transition inside the A6T05 `ExternalOperation` record and the A6
 * lifecycle audit and outbox payloads.
 */
export const A7_PRODUCT_LIFECYCLE_TRANSITIONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    [A7_PRODUCT_LIFECYCLE_STATE_PENDING]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_ADMITTED,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
      A7_PRODUCT_LIFECYCLE_STATE_CANCELLED,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_ADMITTED]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
      A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
      A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN,
      A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
      A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED,
      A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
      A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
      A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED,
      A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER,
      A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
      A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN,
      A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
      A7_PRODUCT_LIFECYCLE_STATE_RETRY_EXHAUSTED_PLACEHOLDER,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED]: Object.freeze([
      A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION,
      A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW,
      A7_PRODUCT_LIFECYCLE_STATE_FAILED,
    ]),
    [A7_PRODUCT_LIFECYCLE_STATE_FAILED]: Object.freeze([]),
    [A7_PRODUCT_LIFECYCLE_STATE_CANCELLED]: Object.freeze([]),
  });

/**
 * A7 product lifecycle retry policy (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 *
 * The A7 product lifecycle bounded retry policy distinguishes safe
 * transport retry (timeout, network), partner rejection (provider-
 * side rejection), rate limit (provider-side throttling), timeout
 * (provider-side timeout), status-query (provider-side status
 * verification), and ambiguous commit (provider-side unknown
 * outcome). The A7 product lifecycle retry policy does NOT
 * introduce an unbounded retry loop; the A7 product lifecycle
 * service fails closed on retry exhaustion.
 */
export const A7_PRODUCT_LIFECYCLE_MAX_RETRY_ATTEMPTS = 3 as const;

/**
 * A7 product lifecycle retry class vocabulary (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 */
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASS_SAFE_TRANSPORT = 'SAFE_TRANSPORT' as const;
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASS_PARTNER_REJECTION = 'PARTNER_REJECTION' as const;
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASS_RATE_LIMIT = 'RATE_LIMIT' as const;
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASS_TIMEOUT = 'TIMEOUT' as const;
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASS_STATUS_QUERY = 'STATUS_QUERY' as const;
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASS_AMBIGUOUS_COMMIT = 'AMBIGUOUS_COMMIT' as const;
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE = 'NONE' as const;

/**
 * A7 product lifecycle retry class vocabulary (frozen array of all
 * allowed retry classes).
 */
export const A7_PRODUCT_LIFECYCLE_RETRY_CLASSES: readonly string[] = Object.freeze([
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_SAFE_TRANSPORT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_PARTNER_REJECTION,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_RATE_LIMIT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_TIMEOUT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_STATUS_QUERY,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_AMBIGUOUS_COMMIT,
  A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NONE,
]);

/**
 * A7 product lifecycle outcome class vocabulary (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 */
export const A7_PRODUCT_LIFECYCLE_OUTCOME_PENDING = 'OUTCOME_PENDING' as const;
export const A7_PRODUCT_LIFECYCLE_OUTCOME_VERIFIED = 'OUTCOME_VERIFIED' as const;
export const A7_PRODUCT_LIFECYCLE_OUTCOME_REJECTED = 'OUTCOME_REJECTED' as const;
export const A7_PRODUCT_LIFECYCLE_OUTCOME_UNKNOWN = 'OUTCOME_UNKNOWN' as const;
export const A7_PRODUCT_LIFECYCLE_OUTCOME_MANUAL_REVIEW = 'OUTCOME_MANUAL_REVIEW' as const;
export const A7_PRODUCT_LIFECYCLE_OUTCOME_FAILED = 'OUTCOME_FAILED' as const;

/**
 * A7 product lifecycle outcome class vocabulary (frozen array of all
 * allowed outcome classes).
 */
export const A7_PRODUCT_LIFECYCLE_OUTCOMES: readonly string[] = Object.freeze([
  A7_PRODUCT_LIFECYCLE_OUTCOME_PENDING,
  A7_PRODUCT_LIFECYCLE_OUTCOME_VERIFIED,
  A7_PRODUCT_LIFECYCLE_OUTCOME_REJECTED,
  A7_PRODUCT_LIFECYCLE_OUTCOME_UNKNOWN,
  A7_PRODUCT_LIFECYCLE_OUTCOME_MANUAL_REVIEW,
  A7_PRODUCT_LIFECYCLE_OUTCOME_FAILED,
]);

/**
 * A7 product lifecycle A6 lifecycle state mapping (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07). The mapping translates
 * the A7 product lifecycle state to the corresponding A6 lifecycle
 * state. The A7 product lifecycle service does NOT issue or refresh
 * the A6 lifecycle state; the A7 product lifecycle service records
 * the A6 lifecycle state as a correlation identifier inside the A7
 * product lifecycle audit and outbox payloads.
 */
export const A7_PRODUCT_LIFECYCLE_TO_A6_LIFECYCLE: Readonly<Record<string, string>> = Object.freeze(
  {
    [A7_PRODUCT_LIFECYCLE_STATE_PENDING]: 'CREATED',
    [A7_PRODUCT_LIFECYCLE_STATE_ADMITTED]: 'SUBMITTING',
    [A7_PRODUCT_LIFECYCLE_STATE_PENDING_PARTNER]: 'PENDING_PROVIDER',
    [A7_PRODUCT_LIFECYCLE_STATE_PENDING_VERIFICATION]: 'PENDING_VERIFICATION',
    [A7_PRODUCT_LIFECYCLE_STATE_UNKNOWN]: 'UNKNOWN',
    [A7_PRODUCT_LIFECYCLE_STATE_MANUAL_REVIEW]: 'MANUAL_REVIEW',
    [A7_PRODUCT_LIFECYCLE_STATE_RETRY_SCHEDULED]: 'SUBMITTING',
    [A7_PRODUCT_LIFECYCLE_STATE_RECOVERY_ISSUED]: 'PENDING_VERIFICATION',
    [A7_PRODUCT_LIFECYCLE_STATE_FAILED]: 'FAILED',
    [A7_PRODUCT_LIFECYCLE_STATE_CANCELLED]: 'CANCELLED',
  },
);

/**
 * A7 product lifecycle product state vocabulary (reused from the
 * A7T02 product catalog; the A7 product lifecycle contract does not
 * introduce a new A7 product state).
 */
export const A7_PRODUCT_LIFECYCLE_ASSIGN_STATES: readonly string[] = Object.freeze([
  'ASSIGN_REQUESTED',
  'ASSIGN_PENDING',
  'ASSIGN_ACTIVE',
  'ASSIGN_SUSPENDED',
  'ASSIGN_FAILED',
  'ASSIGN_CLOSED',
]);

export const A7_PRODUCT_LIFECYCLE_FUNDING_STATES: readonly string[] = Object.freeze([
  'FUNDING_REQUESTED',
  'FUNDING_PENDING_VERIFICATION',
  'FUNDING_SETTLED',
  'FUNDING_UNKNOWN',
  'FUNDING_SUSPENDED',
  'FUNDING_FAILED',
  'FUNDING_CLOSED',
]);

export const A7_PRODUCT_LIFECYCLE_ALL_STATES: readonly string[] = Object.freeze([
  ...A7_PRODUCT_LIFECYCLE_ASSIGN_STATES,
  ...A7_PRODUCT_LIFECYCLE_FUNDING_STATES,
]);

/**
 * A7 product lifecycle capability and action keys (frozen by the
 * A7T02 product catalog registration).
 */
export const A7_PRODUCT_LIFECYCLE_CAPABILITY_ASSIGN = 'virtual-account.assign' as const;
export const A7_PRODUCT_LIFECYCLE_CAPABILITY_INBOUND_FUNDING =
  'virtual-account.inbound-funding' as const;

export const A7_PRODUCT_LIFECYCLE_ACTION_ASSIGN = 'assign' as const;
export const A7_PRODUCT_LIFECYCLE_ACTION_LIFECYCLE = 'lifecycle' as const;

/**
 * A6 partner identity (reused from the A6T05 partner-adapter
 * boundary).
 */
export const A7_PRODUCT_LIFECYCLE_PARTNER_KEY = NIBSS_NIP_PARTNER_KEY;
export const A7_PRODUCT_LIFECYCLE_PARTNER_CAPABILITY =
  'external.wallet.withdrawal.settlement' as const;
export const A7_PRODUCT_LIFECYCLE_PARTNER_OPERATION = 'OUTBOUND_BANK_SETTLEMENT' as const;

/**
 * A7 product lifecycle failure codes (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 */
export const A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_MISSING =
  'A7_PRODUCT_LIFECYCLE_A6_LIFECYCLE_MISSING' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_INVALID_TRANSITION =
  'A7_PRODUCT_LIFECYCLE_A6_LIFECYCLE_INVALID_TRANSITION' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_TERMINAL =
  'A7_PRODUCT_LIFECYCLE_A6_LIFECYCLE_TERMINAL' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A6_LIFECYCLE_STALE =
  'A7_PRODUCT_LIFECYCLE_A6_LIFECYCLE_STALE' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A6_STATUS_VERIFICATION_UNAVAILABLE =
  'A7_PRODUCT_LIFECYCLE_A6_STATUS_VERIFICATION_UNAVAILABLE' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A6_CIRCUIT_OPEN =
  'A7_PRODUCT_LIFECYCLE_A6_CIRCUIT_OPEN' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A6_RETRY_EXHAUSTED =
  'A7_PRODUCT_LIFECYCLE_A6_RETRY_EXHAUSTED' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_MISSING =
  'A7_PRODUCT_LIFECYCLE_A2_AUTHORIZATION_MISSING' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_STALE =
  'A7_PRODUCT_LIFECYCLE_A2_AUTHORIZATION_STALE' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A2_AUTHORIZATION_DENIED =
  'A7_PRODUCT_LIFECYCLE_A2_AUTHORIZATION_DENIED' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_MISSING =
  'A7_PRODUCT_LIFECYCLE_A4_POLICY_DECISION_MISSING' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_EXPIRED =
  'A7_PRODUCT_LIFECYCLE_A4_POLICY_DECISION_EXPIRED' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE =
  'A7_PRODUCT_LIFECYCLE_A4_POLICY_DECISION_NOT_EXECUTABLE' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_MISSING =
  'A7_PRODUCT_LIFECYCLE_A7T05_PRODUCT_COMMAND_MISSING' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_NOT_FOUND =
  'A7_PRODUCT_LIFECYCLE_A7T05_PRODUCT_COMMAND_NOT_FOUND' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH =
  'A7_PRODUCT_LIFECYCLE_A7T05_PRODUCT_COMMAND_CONTEXT_MISMATCH' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISSING =
  'A7_PRODUCT_LIFECYCLE_RECOVERY_REFERENCE_MISSING' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_RECOVERY_REFERENCE_MISMATCH =
  'A7_PRODUCT_LIFECYCLE_RECOVERY_REFERENCE_MISMATCH' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_EXHAUSTED =
  'A7_PRODUCT_LIFECYCLE_RETRY_EXHAUSTED' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_RETRY_CLASS_NOT_RETRYABLE =
  'A7_PRODUCT_LIFECYCLE_RETRY_CLASS_NOT_RETRYABLE' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_CATALOG_REJECTED =
  'A7_PRODUCT_LIFECYCLE_PRODUCT_CATALOG_REJECTED' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_PRODUCT_STATE_INVALID =
  'A7_PRODUCT_LIFECYCLE_PRODUCT_STATE_INVALID' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_REQUEST_HASH_CONFLICT =
  'A7_PRODUCT_LIFECYCLE_REQUEST_HASH_CONFLICT' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_IDEMPOTENCY_IN_PROGRESS =
  'A7_PRODUCT_LIFECYCLE_IDEMPOTENCY_IN_PROGRESS' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE =
  'A7_PRODUCT_LIFECYCLE_OPERATIONS_EVIDENCE_UNAVAILABLE' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_OUTBOX_PUBLICATION_FAILED =
  'A7_PRODUCT_LIFECYCLE_OUTBOX_PUBLICATION_FAILED' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_UNKNOWN =
  'A7_PRODUCT_LIFECYCLE_OUTCOME_UNKNOWN' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_MANUAL_REVIEW_REQUIRED =
  'A7_PRODUCT_LIFECYCLE_OUTCOME_MANUAL_REVIEW_REQUIRED' as const;
export const A7_PRODUCT_LIFECYCLE_FAILURE_OUTCOME_FAILED =
  'A7_PRODUCT_LIFECYCLE_OUTCOME_FAILED' as const;

/**
 * A7 product lifecycle metric names (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07). The A7 product
 * lifecycle metrics are recorded through the shared Operations
 * `MetricsService` (the only metrics authority).
 */
export const A7_PRODUCT_LIFECYCLE_METRIC_ADMITTED = 'a7.product-lifecycle.admitted' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_TRANSITIONED =
  'a7.product-lifecycle.transitioned' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_RETRY_SCHEDULED =
  'a7.product-lifecycle.retry-scheduled' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_RETRY_EXHAUSTED =
  'a7.product-lifecycle.retry-exhausted' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_ISSUED =
  'a7.product-lifecycle.recovery-issued' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_RECOVERY_RESOLVED =
  'a7.product-lifecycle.recovery-resolved' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_MANUAL_REVIEW =
  'a7.product-lifecycle.manual-review' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_FAILED = 'a7.product-lifecycle.failed' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_CANCELLED = 'a7.product-lifecycle.cancelled' as const;
export const A7_PRODUCT_LIFECYCLE_METRIC_REPLAYED = 'a7.product-lifecycle.replayed' as const;

/**
 * A7 product lifecycle reference prefixes (frozen by
 * `docs/A7-IMPLEMENTATION-PLAN.md` §8 A7T07).
 */
export const A7_PRODUCT_LIFECYCLE_REFERENCE_PREFIX = 'a7-product-lifecycle' as const;
export const A7_PRODUCT_LIFECYCLE_RECOVERY_REFERENCE_PREFIX =
  'a7-product-lifecycle-recovery' as const;
