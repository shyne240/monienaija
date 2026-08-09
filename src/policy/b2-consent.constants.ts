/**
 * B2T06 — B2 consent authority frozen constants.
 *
 * The B2 consent authority is the only B2-side consent authority for the
 * bounded first cohort `b2.activation.cohort.inbound-funding` v1. It
 * implements Customer Consent, Marketing Consent, and Commercial Consent
 * as explicit intent authorities with deterministic replay-safe decisions.
 * The authority never creates another Customer authority, never modifies
 * CustomerPreference, A1 identity, or A2 authorization, never executes
 * notifications, never activates products, and never communicates with
 * external partners. The lifecycle PENDING -> GRANTED -> REVOKED ->
 * EXPIRED and the four purposes B2_ACTIVATION, B2_COMMERCIAL,
 * B2_SELF_SERVICE, MARKETING_COMMERCIAL_OFFER are frozen at v1.
 */

export const B2_CONSENT_CONTRACT_NAME = 'B2-CONSENT-AUTHORITY' as const;

export const B2_CONSENT_CONTRACT_VERSION = 1 as const;

export const B2_CONSENT_CONTRACT_DOCUMENT = 'docs/B2-CONSENT-CONTRACT.md' as const;

export const B2_CONSENT_IDEMPOTENCY_SCOPE = 'b2.consent.idempotency.v1' as const;

export const B2_CONSENT_IDEMPOTENCY_RETENTION_SECONDS = 86_400 as const;

export const B2_CONSENT_AUDIT_ACTOR = 'b2-consent' as const;

export const B2_CONSENT_AUDIT_ENTITY_TYPE = 'b2_consent' as const;

export const B2_CONSENT_OUTBOX_EVENT_TYPE = 'b2.consent.decided.v1' as const;

export const B2_CONSENT_OUTBOX_CLASSIFICATION = 'INTERNAL' as const;

export const B2_CONSENT_OUTBOX_RETENTION_CLASS = 'OPERATIONS_DEFAULT' as const;

export const B2_CONSENT_REFERENCE_PREFIX = 'b2-consent' as const;

export const B2_CONSENT_COHORT_KEY = 'b2.activation.cohort.inbound-funding' as const;

export const B2_CONSENT_COHORT_VERSION = 1 as const;

export const B2_CONSENT_PURPOSES = [
  'B2_ACTIVATION',
  'B2_COMMERCIAL',
  'B2_SELF_SERVICE',
  'MARKETING_COMMERCIAL_OFFER',
] as const;

export const B2_CONSENT_CHANNELS = ['email', 'sms', 'push', 'inApp', null] as const;

export const B2_CONSENT_STATES = ['PENDING', 'GRANTED', 'REVOKED', 'EXPIRED'] as const;

export const B2_CONSENT_STATE_PENDING = 'PENDING' as const;
export const B2_CONSENT_STATE_GRANTED = 'GRANTED' as const;
export const B2_CONSENT_STATE_REVOKED = 'REVOKED' as const;
export const B2_CONSENT_STATE_EXPIRED = 'EXPIRED' as const;

export const B2_CONSENT_FAILURE_CODES = [
  'B2_CONSENT_INVALID_COMMAND',
  'B2_CONSENT_INCOMPATIBLE',
  'B2_CONSENT_QUERY_UNAVAILABLE',
  'B2_CONSENT_PROHIBITED',
  'B2_CONSENT_REPLAY_CONFLICT',
  'B2_CONSENT_REPLAY_EXPIRED',
  'B2_CONSENT_IN_PROGRESS',
  'B2_CONSENT_NOT_FOUND',
  'B2_CONSENT_EXPIRED',
  'B2_CONSENT_INVALID_STATE_TRANSITION',
] as const;

export const B2_CONSENT_RETENTION_DAYS = 365 as const;

export const B2_CONSENT_DATA_CLASSIFICATION = 'INTERNAL' as const;
