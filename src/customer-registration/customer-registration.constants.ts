import type { A2RateLimitRuleV1 } from '../authorization/workforce-authentication.types';

/**
 * V1-CUSTOMER-ONBOARDING-01 — operational policy constants for the customer registration
 * front door and phone verification.
 *
 * IMPORTANT: every value here is an OPERATIONAL CONFIGURATION DEFAULT chosen as the
 * smallest technically necessary bound for a public self-service surface. None of these
 * values is, or is presented as, a regulatory requirement (no source document establishes
 * one). Tuning them is an operations decision; the shapes (per-phone + per-IP token
 * buckets, challenge TTL, attempt cap, resend cooldown) are the security boundary.
 */

/** 6-digit numeric OTP, CSPRNG-generated. */
export const REGISTRATION_OTP_CODE_LENGTH = 6;

/** Challenge lifetime (decision doc §4 "OTP mechanism design" — this task's minimal value). */
export const REGISTRATION_OTP_TTL_SECONDS = 300;

/** Minimum seconds between issuing a fresh OTP for the same phone. */
export const REGISTRATION_OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * Per-challenge failed-verification cap, mirroring the existing 5-attempt customer
 * credential lockout convention (customer authentication uses 5).
 */
export const REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Seconds the one-time registration token stays valid after successful verification. */
export const REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS = 900;

/** PBKDF2 parameters for OTP storage (same family/bounds as customer password hashing). */
export const REGISTRATION_OTP_PBKDF2_ITERATIONS = 100_000;

/** Notification event type used for the OTP SMS (registered in notification-security.constants). */
export const REGISTRATION_PHONE_VERIFICATION_EVENT_TYPE =
  'customer.registration.phone_verification';

/** Rate-limit buckets for the public registration surface (behaviour-neutral generic rules). */
export const CUSTOMER_REGISTRATION_RATE_LIMITS: readonly A2RateLimitRuleV1[] = [
  // OTP issuance per phone — throttles SMS-bombing of a single victim number.
  {
    category: 'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_PHONE',
    capacity: 3,
    refillRatePerSecond: 3 / 3600,
    enabled: true,
  },
  // OTP issuance per source IP — throttles bulk phone-space probing/farming.
  {
    category: 'CUSTOMER_REGISTRATION_OTP_ISSUE_PER_IP',
    capacity: 20,
    refillRatePerSecond: 20 / 3600,
    enabled: true,
  },
  // OTP verification attempts per phone — complements the per-challenge 5-attempt cap
  // (which is bound to a single challenge and resets on re-issue).
  {
    category: 'CUSTOMER_REGISTRATION_OTP_VERIFY_PER_PHONE',
    capacity: 10,
    refillRatePerSecond: 10 / 3600,
    enabled: true,
  },
  // Registration completion per source IP — bounds DRAFT-row farming even if a caller
  // obtained many verification tokens.
  {
    category: 'CUSTOMER_REGISTRATION_COMPLETE_PER_IP',
    capacity: 10,
    refillRatePerSecond: 10 / 3600,
    enabled: true,
  },
];

/** Shared actor identity for customer self-service registration (unauthenticated principal). */
export const CUSTOMER_REGISTRATION_ACTOR = 'customer-self-service';
