/**
 * B2T09 — B2 webhook authority frozen constants.
 *
 * The B2 webhook authority is the only B2-side webhook authority for the
 * bounded first cohort `b2.activation.cohort.inbound-funding` v1. It
 * implements deterministic, replay-safe webhook registration with
 * HTTPS-only allowlist validation and challenge-response verification,
 * HMAC-SHA256 signing, delivery attempts, bounded retry with exponential
 * backoff, dead-letter handling, event lifecycle, delivery state machine,
 * replay protection, timestamp freshness (300s), and Delivery-Id
 * uniqueness. The dedicated `b2.webhook.idempotency.v1` scope is
 * replay-safe with an 86400s window and deterministic hashes.
 */

export const B2_WEBHOOK_CONTRACT_NAME = 'B2-WEBHOOK-AUTHORITY' as const;

export const B2_WEBHOOK_CONTRACT_VERSION = 1 as const;

export const B2_WEBHOOK_CONTRACT_DOCUMENT = 'docs/B2-WEBHOOK-CONTRACT.md' as const;

export const B2_WEBHOOK_IDEMPOTENCY_SCOPE = 'b2.webhook.idempotency.v1' as const;

export const B2_WEBHOOK_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

export const B2_WEBHOOK_AUDIT_ACTOR = 'b2-webhook' as const;

export const B2_WEBHOOK_AUDIT_ENTITY_TYPE_REGISTRATION = 'b2_webhook_registration' as const;

export const B2_WEBHOOK_AUDIT_ENTITY_TYPE_DELIVERY = 'b2_webhook_delivery' as const;

export const B2_WEBHOOK_OUTBOX_EVENT_TYPE_REGISTRATION =
  'b2.webhook.registration.decided.v1' as const;

export const B2_WEBHOOK_OUTBOX_EVENT_TYPE_DELIVERY = 'b2.webhook.delivery.decided.v1' as const;

export const B2_WEBHOOK_OUTBOX_CLASSIFICATION = 'INTERNAL' as const;

export const B2_WEBHOOK_OUTBOX_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

export const B2_WEBHOOK_REGISTRATION_REFERENCE_PREFIX = 'b2-webhook-registration' as const;

export const B2_WEBHOOK_DELIVERY_REFERENCE_PREFIX = 'b2-webhook-delivery' as const;

export const B2_WEBHOOK_COHORT_KEY = 'b2.activation.cohort.inbound-funding' as const;

export const B2_WEBHOOK_COHORT_VERSION = 1 as const;

export const B2_WEBHOOK_B1_SCOPE_KEY = 'commercial.virtual-account.inbound-funding' as const;

export const B2_WEBHOOK_B1_SCOPE_VERSION = 1 as const;

export const B2_WEBHOOK_ALLOWLIST_HOSTS = [
  'example.com',
  'hooks.monienaija.com',
  'webhook.site',
] as const;

export const B2_WEBHOOK_HMAC_ALGORITHM = 'HMAC_SHA256' as const;

export const B2_WEBHOOK_HMAC_HEADER = 'X-Monienaija-Signature' as const;

export const B2_WEBHOOK_TIMESTAMP_HEADER = 'X-Monienaija-Timestamp' as const;

export const B2_WEBHOOK_DELIVERY_ID_HEADER = 'X-Monienaija-Delivery-Id' as const;

export const B2_WEBHOOK_CHALLENGE_HEADER = 'X-Monienaija-Challenge' as const;

export const B2_WEBHOOK_TIMESTAMP_FRESHNESS_SECONDS = 300 as const;

export const B2_WEBHOOK_EVENT_TYPES = [
  'b2.activation.succeeded',
  'b2.activation.suspended',
  'b2.webhook.test',
  'b1.commercial.invoice.created',
] as const;

export const B2_WEBHOOK_REGISTRATION_STATES = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'SUSPENDED',
  'REVOKED',
] as const;

export const B2_WEBHOOK_DELIVERY_STATES = [
  'ENQUEUED',
  'DELIVERED',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
  'DEAD_LETTER',
] as const;

export const B2_WEBHOOK_DELIVERY_MAX_ATTEMPTS = 5 as const;

export const B2_WEBHOOK_RETRY_BACKOFF_SECONDS = [1, 10, 60, 300, 900] as const;

export const B2_WEBHOOK_FAILURE_CODES = [
  'B2_WEBHOOK_INVALID_COMMAND',
  'B2_WEBHOOK_INCOMPATIBLE',
  'B2_WEBHOOK_PROHIBITED',
  'B2_WEBHOOK_URL_NOT_ALLOWED',
  'B2_WEBHOOK_CHALLENGE_FAILED',
  'B2_WEBHOOK_NOT_VERIFIED',
  'B2_WEBHOOK_REPLAY_CONFLICT',
  'B2_WEBHOOK_REPLAY_DETECTED',
  'B2_WEBHOOK_TIMESTAMP_STALE',
  'B2_WEBHOOK_SIGNATURE_INVALID',
  'B2_WEBHOOK_DELIVERY_ID_DUPLICATE',
  'B2_WEBHOOK_NOT_FOUND',
] as const;

export const B2_WEBHOOK_RETENTION_DAYS = 365 as const;

export const B2_WEBHOOK_DATA_CLASSIFICATION = 'INTERNAL' as const;
