/**
 * A7T06 — A7 product notification delivery frozen constants for the A7
 * first product.
 *
 * The A7 first product is `VIRTUAL_ACCOUNT` v1 (per
 * `docs/A7-PRODUCT-EXPANSION-BASELINE.md` and `docs/A7-PRODUCT-CATALOG-CONTRACT.md`).
 * The A7 product notification delivery contract consumes the existing
 * `CustomerPreference.notifications` (the only customer intent
 * authority) and the existing A6T10 data-classification matrix (the
 * only data-classification authority). The A7 product notification
 * delivery contract is a read-write contract against the shared
 * Operations `IdempotencyService`, `AuditService`, and `OutboxService`
 * and a read-only consumer of the A2 authorization context, the A3
 * customer-to-financial-account binding (via A7T04), the A4
 * product-policy decision, the A6T05 external-operation identity
 * (for provider idempotency scope/key correlation per ADR-0049), the
 * A7 product catalog (A7T02), the A7 product-policy profile (A7T03),
 * the A7 product customer-binding map (A7T04), and the A7 product
 * command/operation identity (A7T05).
 *
 * No new `CustomerPreference`, A2 authorization, A3 binding, A4
 * product-policy, A6T05 external-operation, A6 partner, A5 transfer
 * command, A7 product catalog, A7 product-policy profile, A7 product
 * customer-binding map, A7 product command/operation, Wallet, Ledger,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics, Reconciliation,
 * or notification authority is introduced. The A7 product notification
 * delivery contract does not wire a live email, SMS, push, or web
 * channel; it only defines the dispatcher boundary, the outbox
 * contract, and the audit/idempotency integration.
 */

/**
 * A7 product notification delivery contract name (frozen by
 * `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §1.4).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_NAME = 'A7-NOTIFICATION-DELIVERY' as const;

/**
 * A7 product notification delivery contract version (frozen by
 * `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §1.4).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CONTRACT_VERSION = 1 as const;

/**
 * A7 notification event identity namespace (frozen).
 */
export const A7_PRODUCT_NOTIFICATION_EVENT_IDENTITY_NAMESPACE = 'A7-NOTIFICATION-DELIVERY' as const;

/**
 * A7 notification dispatch identity namespace (frozen).
 */
export const A7_PRODUCT_NOTIFICATION_DISPATCH_IDENTITY_NAMESPACE =
  'A7-NOTIFICATION-DISPATCH' as const;

/**
 * A7 internal idempotency scope for the notification dispatcher
 * (frozen by `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §8.1).
 *
 * The A7 notification internal idempotency scope is a separate
 * namespace from the A7T05 internal idempotency scope
 * (`A7-PRODUCT-IDEMPOTENCY.v1`) and from the A6T05 internal
 * idempotency scope (`external.partner.operation.v1`). The A7
 * notification internal idempotency scope is the only A7
 * notification internal idempotency scope.
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_INTERNAL_IDEMPOTENCY_SCOPE =
  'a7.notification-dispatch.idempotency.v1' as const;

/**
 * A7 provider idempotency scope for the notification dispatcher
 * (frozen by `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §8.2).
 *
 * The A7 notification provider idempotency scope is sourced from the
 * A6T05 provider idempotency scope (`nibss.nip.external-operation.v1`)
 * per ADR-0049. The A7 product notification delivery service does NOT
 * generate or maintain a separate A7 provider idempotency scope; the
 * A7 product notification delivery service reads the A6T05 provider
 * idempotency scope/key from the A6T05 `ExternalOperation` record and
 * references it inside the A7 notification dispatch outbox payload
 * as correlation metadata.
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_PROVIDER_IDEMPOTENCY_SCOPE =
  'nibss.nip.external-operation.v1' as const;

/**
 * A7 product notification delivery retention interval (24 hours;
 * aligned with the shared Operations `IdempotencyService` default).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

/**
 * A7 product notification delivery audit entity type (reused by the
 * shared Operations `AuditService`; the A7 notification dispatch audit
 * fact is recorded against the `A7_NOTIFICATION_DISPATCH` entity type).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ENTITY_TYPE =
  'A7_NOTIFICATION_DISPATCH' as const;

/**
 * A7 product notification delivery audit actor (reused by the shared
 * Operations `AuditService`).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTOR =
  'a7-product-notification-delivery' as const;

/**
 * A7 product notification delivery audit action codes. The A7
 * notification dispatch audit facts are recorded through the shared
 * Operations `AuditService`; the `action` is one of the A7 product
 * notification delivery audit action codes.
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_RESERVED =
  'A7_NOTIFICATION_DISPATCH_RESERVED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_ADMITTED =
  'A7_NOTIFICATION_DISPATCH_ADMITTED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_SUPPRESSED =
  'A7_NOTIFICATION_DISPATCH_SUPPRESSED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_FAILED =
  'A7_NOTIFICATION_DISPATCH_FAILED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_AUDIT_ACTION_REPLAYED =
  'A7_NOTIFICATION_DISPATCH_REPLAYED' as const;

/**
 * A7 product notification delivery outbox event type (reused by the
 * shared Operations `OutboxService`).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_TYPE =
  'A7ProductNotificationDispatched' as const;

/**
 * A7 product notification delivery outbox event classification (reused
 * by the shared Operations `OutboxService`).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_CLASSIFICATION =
  'INTERNAL_OPERATIONS' as const;

/**
 * A7 product notification delivery outbox event retention class
 * (reused by the shared Operations `OutboxService`).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_OUTBOX_EVENT_RETENTION_CLASS =
  'OPERATIONS_DEFAULT' as const;

/**
 * A7 product notification delivery state vocabulary (frozen by
 * `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §4).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_PENDING = 'PENDING' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_DISPATCHED = 'DISPATCHED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_SUPPRESSED = 'SUPPRESSED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_FAILED = 'FAILED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_REPLAYED = 'REPLAYED' as const;

/**
 * A7 product notification delivery state vocabulary (frozen array of
 * all allowed states).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_STATES: readonly string[] = Object.freeze([
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_PENDING,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_DISPATCHED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_SUPPRESSED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_FAILED,
  A7_PRODUCT_NOTIFICATION_DELIVERY_STATE_REPLAYED,
]);

/**
 * A7 product notification delivery notification channel vocabulary
 * (frozen by `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §3.1).
 *
 * The notification channel vocabulary is reused from the existing
 * `CustomerPreference.notifications` channel flags; the A7 product
 * notification delivery contract does not introduce a new notification
 * channel.
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_EMAIL = 'email' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_SMS = 'sms' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_PUSH = 'push' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_IN_APP = 'inApp' as const;

/**
 * A7 product notification delivery notification channel vocabulary
 * (frozen array of all allowed channels).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNELS: readonly string[] = Object.freeze([
  A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_EMAIL,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_SMS,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_PUSH,
  A7_PRODUCT_NOTIFICATION_DELIVERY_CHANNEL_IN_APP,
]);

/**
 * A7 product notification delivery capability and action keys (frozen
 * by the A7T02 product catalog registration).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CAPABILITY_ASSIGN = 'virtual-account.assign' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_CAPABILITY_INBOUND_FUNDING =
  'virtual-account.inbound-funding' as const;

export const A7_PRODUCT_NOTIFICATION_DELIVERY_ACTION_ASSIGN = 'assign' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_ACTION_LIFECYCLE = 'lifecycle' as const;

/**
 * A7 product notification delivery product state vocabulary (reused
 * from the A7T02 product catalog; the A7 product notification delivery
 * service does not introduce a new A7 product state).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_ASSIGN_STATES: readonly string[] = Object.freeze([
  'ASSIGN_REQUESTED',
  'ASSIGN_PENDING',
  'ASSIGN_ACTIVE',
  'ASSIGN_SUSPENDED',
  'ASSIGN_FAILED',
  'ASSIGN_CLOSED',
]);

export const A7_PRODUCT_NOTIFICATION_DELIVERY_FUNDING_STATES: readonly string[] = Object.freeze([
  'FUNDING_REQUESTED',
  'FUNDING_PENDING_VERIFICATION',
  'FUNDING_SETTLED',
  'FUNDING_UNKNOWN',
  'FUNDING_SUSPENDED',
  'FUNDING_FAILED',
  'FUNDING_CLOSED',
]);

export const A7_PRODUCT_NOTIFICATION_DELIVERY_ALL_STATES: readonly string[] = Object.freeze([
  ...A7_PRODUCT_NOTIFICATION_DELIVERY_ASSIGN_STATES,
  ...A7_PRODUCT_NOTIFICATION_DELIVERY_FUNDING_STATES,
]);

/**
 * A7 product notification delivery handoff scope (single-use,
 * support-traceable, A2-protected internal control surface).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_HANDOFF_SCOPE =
  'a7-notification-dispatch-handoff.v1' as const;

/**
 * A7 product notification delivery handoff validity interval.
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_HANDOFF_VALIDITY_SECONDS = 15 * 60;

/**
 * A6 partner identity (reused from the A6T05 partner-adapter boundary).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_PARTNER_KEY = 'NIBSS_NIP' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_PARTNER_CAPABILITY =
  'external.wallet.withdrawal.settlement' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_PARTNER_OPERATION =
  'OUTBOUND_BANK_SETTLEMENT' as const;

/**
 * A7 product notification delivery failure codes (frozen by
 * `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §1.3, §7, §8, §10, §12).
 */
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_MISSING =
  'A7_NOTIFICATION_A2_AUTHORIZATION_MISSING' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_STALE =
  'A7_NOTIFICATION_A2_AUTHORIZATION_STALE' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A2_AUTHORIZATION_DENIED =
  'A7_NOTIFICATION_A2_AUTHORIZATION_DENIED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_MISSING =
  'A7_NOTIFICATION_CUSTOMER_PREFERENCE_MISSING' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_STALE =
  'A7_NOTIFICATION_CUSTOMER_PREFERENCE_STALE' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_CUSTOMER_PREFERENCE_DISABLED =
  'A7_NOTIFICATION_CUSTOMER_PREFERENCE_DISABLED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_MISSING =
  'A7_NOTIFICATION_A4_POLICY_DECISION_MISSING' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_EXPIRED =
  'A7_NOTIFICATION_A4_POLICY_DECISION_EXPIRED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A4_POLICY_DECISION_NOT_EXECUTABLE =
  'A7_NOTIFICATION_A4_POLICY_DECISION_NOT_EXECUTABLE' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING =
  'A7_NOTIFICATION_A7T04_PRODUCT_CUSTOMER_BINDING_MISSING' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED =
  'A7_NOTIFICATION_A7T04_PRODUCT_CUSTOMER_BINDING_FAILED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_A7T05_PRODUCT_COMMAND_MISSING =
  'A7_NOTIFICATION_A7T05_PRODUCT_COMMAND_MISSING' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_SECRET_PRESENT =
  'A7_NOTIFICATION_PAYLOAD_SECRET_PRESENT' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_REJECTED =
  'A7_NOTIFICATION_PAYLOAD_DISCLOSURE_REJECTED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_DISCLOSURE_AUDIENCE_TOO_LOW =
  'A7_NOTIFICATION_PAYLOAD_DISCLOSURE_AUDIENCE_TOO_LOW' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_CLASSIFICATION_NOT_REGISTERED =
  'A7_NOTIFICATION_PAYLOAD_CLASSIFICATION_NOT_REGISTERED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_IDEMPOTENCY_IN_PROGRESS =
  'A7_NOTIFICATION_IDEMPOTENCY_IN_PROGRESS' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_REQUEST_HASH_CONFLICT =
  'A7_NOTIFICATION_REQUEST_HASH_CONFLICT' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_IDEMPOTENCY_MISSING =
  'A7_NOTIFICATION_IDEMPOTENCY_MISSING' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OPERATIONS_EVIDENCE_UNAVAILABLE =
  'A7_NOTIFICATION_OPERATIONS_EVIDENCE_UNAVAILABLE' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_OUTBOX_PUBLICATION_FAILED =
  'A7_NOTIFICATION_OUTBOX_PUBLICATION_FAILED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_NOTIFICATION_CHANNEL_UNSUPPORTED =
  'A7_NOTIFICATION_NOTIFICATION_CHANNEL_UNSUPPORTED' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PAYLOAD_HASH_MISMATCH =
  'A7_NOTIFICATION_PAYLOAD_HASH_MISMATCH' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_TEMPLATE_REFERENCE_INVALID =
  'A7_NOTIFICATION_TEMPLATE_REFERENCE_INVALID' as const;
export const A7_PRODUCT_NOTIFICATION_DELIVERY_FAILURE_PRODUCT_CATALOG_REJECTED =
  'A7_NOTIFICATION_PRODUCT_CATALOG_REJECTED' as const;

/**
 * A7 product notification delivery reference prefix (frozen by
 * `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md` §2.1).
 */
export const A7_PRODUCT_NOTIFICATION_EVENT_REFERENCE_PREFIX = 'a7-notification-event' as const;
export const A7_PRODUCT_NOTIFICATION_DISPATCH_REFERENCE_PREFIX =
  'a7-notification-dispatch' as const;
