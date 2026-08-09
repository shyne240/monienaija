/**
 * B2T08 — B2 API consumer, credential, quota, and rate-limit frozen constants.
 *
 * The B2 API consumer registry, credential lifecycle, quota policies, and
 * token-bucket rate limiting are the only B2-side consumer, credential,
 * quota, and rate-limit authorities. They enforce A2 authentication and
 * never store raw secrets, never log raw secrets, never duplicate the A2
 * authentication or authorization authority, and never post ledger
 * entries.
 */

export const B2_API_CONSUMER_CONTRACT_NAME = 'B2-API-CONSUMER' as const;

export const B2_API_CONSUMER_CONTRACT_VERSION = 1 as const;

export const B2_API_CONSUMER_CONTRACT_DOCUMENT_CREDENTIALS =
  'docs/B2-API-CREDENTIALS-CONTRACT.md' as const;

export const B2_API_CONSUMER_CONTRACT_DOCUMENT_QUOTA =
  'docs/B2-QUOTA-RATE-LIMIT-CONTRACT.md' as const;

export const B2_API_CONSUMER_IDEMPOTENCY_SCOPE = 'b2.api-consumer.idempotency.v1' as const;

export const B2_API_CONSUMER_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

export const B2_API_CONSUMER_AUDIT_ACTOR = 'b2-api-consumer' as const;

export const B2_API_CONSUMER_AUDIT_ENTITY_TYPE_CONSUMER = 'b2_api_consumer' as const;

export const B2_API_CONSUMER_AUDIT_ENTITY_TYPE_CREDENTIAL = 'b2_api_credential' as const;

export const B2_API_CONSUMER_AUDIT_ENTITY_TYPE_QUOTA = 'b2_api_quota' as const;

export const B2_API_CONSUMER_AUDIT_ENTITY_TYPE_RATE_LIMIT = 'b2_rate_limit_bucket' as const;

export const B2_API_CONSUMER_OUTBOX_EVENT_TYPE = 'b2.api-consumer.decided.v1' as const;

export const B2_API_CONSUMER_OUTBOX_CLASSIFICATION = 'INTERNAL' as const;

export const B2_API_CONSUMER_OUTBOX_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

export const B2_API_CONSUMER_REFERENCE_PREFIX = 'b2-consumer' as const;

export const B2_API_CREDENTIAL_REFERENCE_PREFIX = 'b2-credential' as const;

export const B2_API_CREDENTIAL_KEY_PREFIX_LIVE = 'mnj_live_' as const;

export const B2_API_CREDENTIAL_KEY_PREFIX_TEST = 'mnj_test_' as const;

export const B2_API_CONSUMER_COHORT_KEY = 'b2.activation.cohort.inbound-funding' as const;

export const B2_API_CONSUMER_COHORT_VERSION = 1 as const;

export const B2_API_CONSUMER_TYPES = ['DEVELOPER', 'MERCHANT', 'AGENT', 'PARTNER'] as const;

export const B2_API_CONSUMER_STATES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'REVOKED'] as const;

export const B2_API_CREDENTIAL_KINDS = ['API_KEY', 'CLIENT_CREDENTIALS'] as const;

export const B2_API_CREDENTIAL_STATES = ['ISSUED', 'ROTATED', 'REVOKED', 'EXPIRED'] as const;

export const B2_API_CREDENTIAL_ROTATION_GRACE_SECONDS = 300 as const;

export const B2_API_CREDENTIAL_SANDBOX_TYPES = ['SANDBOX', 'PRODUCTION'] as const;

export const B2_API_QUOTA_GROUPS = [
  'commercial.read',
  'commercial.write',
  'webhooks.manage',
] as const;

export const B2_API_QUOTA_STATES = ['ALLOCATED', 'EXCEEDED'] as const;

export const B2_API_QUOTA_LIMITS = {
  'commercial.read': 5000,
  'commercial.write': 500,
  'webhooks.manage': 100,
} as const;

export const B2_API_QUOTA_WINDOW = 'UTC_CALENDAR_DAY' as const;

export const B2_API_RATE_LIMIT_BUCKETS = [
  'global',
  'commercial.read',
  'commercial.write',
  'commercial.activations:write',
  'webhooks:delivery',
] as const;

export const B2_API_RATE_LIMIT_CONFIGS = {
  global: { capacity: 100, refillPerSecond: 2, burst: 100 },
  'commercial.read': { capacity: 50, refillPerSecond: 0.83, burst: 50 },
  'commercial.write': { capacity: 20, refillPerSecond: 0.33, burst: 20 },
  'commercial.activations:write': { capacity: 10, refillPerSecond: 0.16, burst: 20 },
  'webhooks:delivery': { capacity: 5, refillPerSecond: 0.08, burst: 5 },
} as const;

export const B2_API_RATE_LIMIT_STRATEGY = 'TOKEN_BUCKET' as const;

export const B2_API_RATE_LIMIT_STATES = ['ALLOWED', 'THROTTLED'] as const;

export const B2_API_CONSUMER_FAILURE_CODES = [
  'B2_API_CONSUMER_INVALID_COMMAND',
  'B2_API_CONSUMER_INCOMPATIBLE',
  'B2_API_CONSUMER_NOT_FOUND',
  'B2_API_CONSUMER_SUSPENDED',
  'B2_API_CONSUMER_REVOKED',
  'B2_API_CONSUMER_CONSUMER_EXISTS',
  'B2_API_CONSUMER_REPLAY_CONFLICT',
  'B2_API_CONSUMER_REPLAY_EXPIRED',
  'B2_API_CONSUMER_CREDENTIAL_REVOKED',
  'B2_API_CONSUMER_CREDENTIAL_EXPIRED',
  'B2_API_CONSUMER_QUOTA_EXCEEDED',
  'B2_API_CONSUMER_RATE_LIMITED',
  'B2_API_CONSUMER_INVALID_STATE_TRANSITION',
] as const;

export const B2_API_CONSUMER_RETENTION_DAYS = 365 as const;

export const B2_API_CONSUMER_DATA_CLASSIFICATION = 'INTERNAL' as const;
