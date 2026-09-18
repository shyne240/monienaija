/**
 * B2T10 — B2 public API authentication and B1 capability exposure frozen constants.
 *
 * The B2 public API authentication is the only B2-side public-surface
 * authentication integration for the bounded first cohort
 * `b2.activation.cohort.inbound-funding` v1. It verifies every public
 * B2 route through A2 audience/scope, token expiry, consumer ACTIVE,
 * credential ISSUED/ROTATED, consent GRANTED, A4 ELIGIBLE, quota
 * ALLOCATED, and rate-limit ALLOWED, and exposes B1 catalog/plan/tier
 * and B2 activation as audience-scoped, minimized reads. The dedicated
 * `b2.public-api-authentication.idempotency.v1` scope is replay-safe
 * with an 86400s window and deterministic hashes.
 */

export const B2_PUBLIC_API_AUTHENTICATION_CONTRACT_NAME = 'B2-PUBLIC-API-AUTHENTICATION' as const;

export const B2_PUBLIC_API_AUTHENTICATION_CONTRACT_VERSION = 1 as const;

export const B2_PUBLIC_API_AUTHENTICATION_CONTRACT_DOCUMENT =
  'docs/B2-PUBLIC-API-AUTHENTICATION-CONTRACT.md' as const;

export const B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_SCOPE =
  'b2.public-api-authentication.idempotency.v1' as const;

export const B2_PUBLIC_API_AUTHENTICATION_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

export const B2_PUBLIC_API_AUTHENTICATION_AUDIT_ACTOR = 'b2-public-api-authentication' as const;

export const B2_PUBLIC_API_AUTHENTICATION_AUDIT_ENTITY_TYPE =
  'b2_public_api_authentication' as const;

export const B2_PUBLIC_API_AUTHENTICATION_OUTBOX_EVENT_TYPE =
  'b2.public-api.authentication.decided.v1' as const;

export const B2_PUBLIC_API_AUTHENTICATION_OUTBOX_CLASSIFICATION = 'INTERNAL' as const;

export const B2_PUBLIC_API_AUTHENTICATION_OUTBOX_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

export const B2_PUBLIC_API_AUTHENTICATION_REFERENCE_PREFIX = 'b2-public-api-auth' as const;

export const B2_PUBLIC_API_AUTHENTICATION_COHORT_KEY =
  'b2.activation.cohort.inbound-funding' as const;

export const B2_PUBLIC_API_AUTHENTICATION_COHORT_VERSION = 1 as const;

export const B2_PUBLIC_API_AUTHENTICATION_B1_SCOPE_KEY =
  'commercial.virtual-account.inbound-funding' as const;

export const B2_PUBLIC_API_AUTHENTICATION_B1_SCOPE_VERSION = 1 as const;

export const B2_PUBLIC_API_AUTHENTICATION_A7_PRODUCT_KEY = 'VIRTUAL_ACCOUNT' as const;

export const B2_PUBLIC_API_AUTHENTICATION_A7_PRODUCT_VERSION = 1 as const;

export const B2_PUBLIC_API_AUTHENTICATION_A6_PARTNER_KEY = 'NIBSS_NIP' as const;

export const B2_PUBLIC_API_AUTHENTICATION_CURRENCY = 'NGN' as const;

export const B2_PUBLIC_API_AUTHENTICATION_ACCOUNTING_UNIT = 'CUSTOMER_FUNDS' as const;

export const B2_PUBLIC_API_AUTHENTICATION_REGION = 'NG' as const;

export const B2_PUBLIC_API_AUTHENTICATION_B1_PLANS = [
  'commercial.virtual-account.inbound-funding',
  'commercial.virtual-account.inbound-funding.fee',
] as const;

export const B2_PUBLIC_API_AUTHENTICATION_B1_TIERS = [
  'tier.b2.inbound-funding.standard',
  'tier.b2.inbound-funding.premium',
] as const;

export const B2_PUBLIC_API_AUTHENTICATION_AUDIENCES = [
  'public:commercial:activation:b2:inbound-funding:read',
  'public:commercial:activation:b2:inbound-funding:write',
  'public:webhooks:b2:manage',
  'public:consents:b2:manage',
  'public:support:b2:read',
  'public:auth:token:exchange',
] as const;

export const B2_PUBLIC_API_AUTHENTICATION_SCOPES = [
  'b2:activation:read',
  'b2:activation:write',
  'b2:webhooks:manage',
  'b2:consents:manage',
  'b2:support:read',
  'b2:auth:token:exchange',
] as const;

export const B2_PUBLIC_API_AUTHENTICATION_PUBLIC_ROUTES = [
  '/v1/commercial/activations',
  '/v1/commercial/activations/{activationReference}',
  '/v1/commercial/catalog',
  '/v1/commercial/plans/{planKey}',
  '/v1/commercial/tiers/{tierKey}',
  '/v1/auth/token',
  '/v1/webhooks/registrations',
  '/v1/consents',
  '/v1/health',
  '/v1/support/activations/{activationReference}',
] as const;

export const B2_PUBLIC_API_AUTHENTICATION_FAILURE_CODES = [
  'B2_AUTH_UNAUTHORIZED',
  'B2_AUTH_FORBIDDEN',
  'B2_AUTH_WRONG_AUDIENCE',
  'B2_AUTH_EXPIRED',
  'B2_AUTH_WRONG_SCOPE',
  'B2_AUTH_CONSUMER_NOT_ACTIVE',
  'B2_AUTH_CREDENTIAL_REVOKED',
  'B2_AUTH_CONSENT_REQUIRED',
  'B2_AUTH_ACTIVATION_REQUIRED',
  'B2_AUTH_QUOTA_EXCEEDED',
  'B2_AUTH_RATE_LIMITED',
  'B2_AUTH_NOT_FOUND',
  'B2_AUTH_REPLAY_CONFLICT',
  'B2_AUTH_INCOMPATIBLE',
  'B2_AUTH_A4_NOT_ELIGIBLE',
] as const;

export const B2_PUBLIC_API_AUTHENTICATION_RETENTION_DAYS = 365 as const;

export const B2_PUBLIC_API_AUTHENTICATION_DATA_CLASSIFICATION = 'INTERNAL' as const;

export const B2_PUBLIC_API_AUTHENTICATION_TOKEN_EXPIRY_SECONDS = 900 as const;
