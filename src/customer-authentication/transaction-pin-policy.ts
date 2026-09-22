import type { ConfigService } from '@nestjs/config';

/**
 * Centralized Customer Transaction PIN security policy.
 *
 * ARCHITECTURE / COMPLIANCE POSITION (read before changing):
 *
 *   This policy is an INTERNAL MonieNaija security configuration. None of
 *   these values is a CBN-mandated figure, and the code must continue to
 *   distinguish three separate concerns:
 *
 *     1. regulatory requirement  — what CBN or NIBSS may require (these
 *        requirements do NOT currently fix a specific failed-attempt
 *        threshold or PIN length for MonieNaija);
 *     2. internal security policy — MonieNaija's V1 risk decision
 *        (locks at 5 failed attempts; 4–6 digit PINs);
 *     3. configurable implementation parameter — how the internal policy is
 *        realized in code (the env-configurable values below).
 *
 *   If a future CBN directive, NIBSS/product requirement, or MonieNaija
 *   internal risk-policy review mandates different values, only the
 *   environment configuration changes — the implementation must not encode
 *   any such value as an unchangeable constant, and must not attribute the
 *   V1 defaults to a regulator.
 *
 * MUTATION SURFACE: no admin UI; deployment-time environment configuration
 * only, validated at startup by src/config/environment.ts. Envelope claims
 * (e.g. DTO sanitation) derive from the bounds here so no consumer hard-codes
 * the thresholds either.
 */

/** Environment variable names for the configurable parameters. */
export const PIN_POLICY_ENV = {
  maxFailedAttempts: 'PIN_MAX_FAILED_ATTEMPTS',
  minPinLength: 'PIN_MIN_LENGTH',
  maxPinLength: 'PIN_MAX_LENGTH',
} as const;

export interface TransactionPinSecurityPolicy {
  /** Wrong-PIN entries on the PIN credential before it locks. Independent of password lockout. */
  maxFailedAttempts: number;
  /** Shortest acceptable PIN length at enrollment (create/change/reset). */
  minPinLength: number;
  /** Longest acceptable PIN length at enrollment (create/change/reset). */
  maxPinLength: number;
}

/**
 * Internal MonieNaija V1 defaults. These are product/risk decisions, NOT a
 * regulatory constant: 5 failed attempts and a 4–6 digit PIN are the shipped
 * V1 posture and remain the default until configuration says otherwise.
 */
export const DEFAULT_TRANSACTION_PIN_SECURITY_POLICY: TransactionPinSecurityPolicy = {
  maxFailedAttempts: 5,
  minPinLength: 4,
  maxPinLength: 6,
};

/**
 * Reasonable security bounds regardless of configuration:
 *  - at least 1 attempt before lockout; above 20 attempts a lockout threshold
 *    stops thinning brute-force space meaningfully and only invites lockout
 *    abuse, so it is an implementation cap, not a regulatory one;
 *  - PINs stay between 4 and 12 digits (>= 4 is the V1 floor; 12 digits keeps
 *    the credential numeric and brute-force space orders of magnitude above
 *    the attempt budget).
 */
export const PIN_POLICY_BOUNDS = {
  maxFailedAttempts: { min: 1, max: 20 },
  pinLength: { min: 4, max: 12 },
} as const;

/**
 * Injection token for the resolved policy. Constructed per-module from
 * ConfigService so tests can also construct services with an explicit policy.
 */
export const TRANSACTION_PIN_POLICY = 'TRANSACTION_PIN_POLICY';

/**
 * Digits-only sanitation envelope for request DTOs, derived from the absolute
 * allowed range — NOT the effective policy. The authoritative length check is
 * the configured policy enforced inside PinHashService, so changing
 * min/max length via configuration never requires touching DTO files.
 */
export const PIN_INPUT_PATTERN = new RegExp(
  `^\\d{${PIN_POLICY_BOUNDS.pinLength.min},${PIN_POLICY_BOUNDS.pinLength.max}}$`,
);

/**
 * Validates any candidate policy; returns it unchanged on success.
 * Throwing here is fail-closed: a misconfigured security policy must never
 * silently downgrade the PIN lockout or length guarantees.
 */
export function assertValidTransactionPinSecurityPolicy(
  policy: TransactionPinSecurityPolicy,
): TransactionPinSecurityPolicy {
  const attempts = PIN_POLICY_BOUNDS.maxFailedAttempts;
  const lengths = PIN_POLICY_BOUNDS.pinLength;
  if (
    !Number.isInteger(policy.maxFailedAttempts) ||
    policy.maxFailedAttempts < attempts.min ||
    policy.maxFailedAttempts > attempts.max
  ) {
    throw new Error(
      `Transaction PIN security policy: maxFailedAttempts must be an integer between ${attempts.min} and ${attempts.max} (got ${String(
        policy.maxFailedAttempts,
      )})`,
    );
  }
  if (
    !Number.isInteger(policy.minPinLength) ||
    policy.minPinLength < lengths.min ||
    policy.minPinLength > lengths.max
  ) {
    throw new Error(
      `Transaction PIN security policy: minPinLength must be an integer between ${lengths.min} and ${lengths.max} (got ${String(
        policy.minPinLength,
      )})`,
    );
  }
  if (
    !Number.isInteger(policy.maxPinLength) ||
    policy.maxPinLength < lengths.min ||
    policy.maxPinLength > lengths.max
  ) {
    throw new Error(
      `Transaction PIN security policy: maxPinLength must be an integer between ${lengths.min} and ${lengths.max} (got ${String(
        policy.maxPinLength,
      )})`,
    );
  }
  if (policy.maxPinLength < policy.minPinLength) {
    throw new Error(
      `Transaction PIN security policy: maxPinLength (${policy.maxPinLength}) must be greater than or equal to minPinLength (${policy.minPinLength})`,
    );
  }
  return policy;
}

/**
 * Resolves the effective policy following the repository's configuration
 * pattern: validated environment values win, internal V1 defaults are the
 * fallback (and are also the environment schema defaults). The result is
 * re-validated defensively so direct construction outside ConfigModule
 * (unit tests) fails closed on nonsense values too.
 */
export function resolveTransactionPinSecurityPolicy(
  configService?: Pick<ConfigService, 'get'>,
): TransactionPinSecurityPolicy {
  const policy: TransactionPinSecurityPolicy = {
    maxFailedAttempts:
      configService?.get<number>(PIN_POLICY_ENV.maxFailedAttempts) ??
      DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.maxFailedAttempts,
    minPinLength:
      configService?.get<number>(PIN_POLICY_ENV.minPinLength) ??
      DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.minPinLength,
    maxPinLength:
      configService?.get<number>(PIN_POLICY_ENV.maxPinLength) ??
      DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.maxPinLength,
  };
  return assertValidTransactionPinSecurityPolicy(policy);
}
