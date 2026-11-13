import type { A2RateLimitRuleV1 } from '../authorization/workforce-authentication.types';

/**
 * ARENA 4 — customer self-service credential recovery policy and operational bounds.
 *
 * The recovery *policy* is expressed here explicitly (versioned, backend-owned) so the mobile app
 * never decides what counts as sufficient authority:
 *
 *   recovery authority = (OTP delivered to the customer's own verified primary phone)
 *                      + (authoritative identity evidence readable by the accepted KYC evidence
 *                         oracle, i.e. `KycTierEvidenceReader`)
 *                      + (customer ACTIVE, not synthetic, no manual hold, no identity conflict)
 *
 * Possession of a phone number alone is therefore NEVER sufficient to replace a financial
 * credential. When the identity-evidence oracle has no confirmed provider (which is the current
 * production state), or the operator has not enabled the self-service policy, recovery FAILS CLOSED
 * and the customer is routed to support instead.
 *
 * Every numeric value below is an OPERATIONAL CONFIGURATION bound (not a regulatory threshold):
 * they are the smallest technically necessary limits for a public recovery surface.
 */

export const CUSTOMER_CREDENTIAL_RECOVERY_POLICY_VERSION = 'v1';

/** Activation switch. Absent/false ⇒ self-service recovery is unavailable (fail closed). */
export const CUSTOMER_CREDENTIAL_RECOVERY_ENABLED_ENV = 'CUSTOMER_CREDENTIAL_RECOVERY_ENABLED';

/** OTP lifetime for a recovery challenge. */
export const RECOVERY_OTP_TTL_SECONDS = 300;

/** Minimum seconds between issuing a fresh recovery challenge for the same phone + purpose. */
export const RECOVERY_OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Per-challenge failed-code cap (mirrors the 5-attempt customer credential lockout). */
export const RECOVERY_OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Lifetime of the one-time recovery token issued after OTP + evidence verification. */
export const RECOVERY_TOKEN_TTL_SECONDS = 600;

/** PBKDF2 parameters for the stored OTP digest — same family as registration OTP storage. */
export const RECOVERY_OTP_PBKDF2_ITERATIONS = 100_000;

export const RECOVERY_OTP_CODE_LENGTH = 6;

export type CustomerCredentialRecoveryPurpose = 'LOGIN_PASSCODE' | 'TRANSACTION_PIN';

export const CUSTOMER_CREDENTIAL_RECOVERY_PURPOSES: readonly CustomerCredentialRecoveryPurpose[] = [
  'LOGIN_PASSCODE',
  'TRANSACTION_PIN',
];

/** Security-critical SMS event type (delivered directly, never through the outbox). */
export const CUSTOMER_CREDENTIAL_RECOVERY_EVENT_TYPE = 'customer.credentials.recovery_otp';

export const CUSTOMER_CREDENTIAL_RECOVERY_RATE_LIMITS: readonly A2RateLimitRuleV1[] = [
  {
    category: 'CUSTOMER_CREDENTIAL_RECOVERY_ISSUE_PER_PHONE',
    capacity: 3,
    refillRatePerSecond: 3 / 3600,
    enabled: true,
  },
  {
    category: 'CUSTOMER_CREDENTIAL_RECOVERY_ISSUE_PER_IP',
    capacity: 20,
    refillRatePerSecond: 20 / 3600,
    enabled: true,
  },
  {
    category: 'CUSTOMER_CREDENTIAL_RECOVERY_VERIFY_PER_CHALLENGE',
    capacity: 10,
    refillRatePerSecond: 10 / 3600,
    enabled: true,
  },
  {
    category: 'CUSTOMER_CREDENTIAL_RECOVERY_COMPLETE_PER_TOKEN',
    capacity: 5,
    refillRatePerSecond: 5 / 3600,
    enabled: true,
  },
];

/** Fail-closed activation check; read at call time so operators can enable it without a rebuild. */
export function isCustomerCredentialRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CUSTOMER_CREDENTIAL_RECOVERY_ENABLED_ENV] === 'true';
}
