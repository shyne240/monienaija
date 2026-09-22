import { pbkdf2Sync, randomBytes } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';

import {
  assertValidTransactionPinSecurityPolicy,
  DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
  TRANSACTION_PIN_POLICY,
  type TransactionPinSecurityPolicy,
} from './transaction-pin-policy';

/**
 * Server-side transaction PIN hashing.
 *
 * PINs arrive over the authenticated API request in plaintext and are hashed
 * immediately before persistence; the client never pre-hashes. The encoded
 * format is `PBKDF2$sha512$<iterations>$<salt-b64url>$<derived-b64url>`, the
 * exact domain already enforced fail-closed by
 * PasswordHashVerificationService, so verification reuses the existing
 * constant-time verifier and no parallel verification path is created.
 *
 * The plaintext PIN is never returned, logged, or attached to any view
 * produced from the hash output.
 *
 * PIN LENGTH is NOT hard-coded here: the authoritative shape rule is the
 * centralized Transaction PIN security policy (injected; see
 * transaction-pin-policy.ts) — an internal MonieNaija V1 default of 4-6
 * digits, changeable through environment configuration.
 */

/** Digits-only envelope; the configured policy decides the allowed length. */
const PIN_DIGITS_ONLY = /^\d+$/;
const PBKDF2_DIGEST = 'sha512';
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;

/**
 * Backwards-compatible exports reflecting the V1 DEFAULT policy range. New
 * consumers must import the centralized policy from transaction-pin-policy.ts
 * instead of these constants — they do NOT track configuration changes.
 */
export const PIN_PATTERN = new RegExp(
  `^\\d{${DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.minPinLength},${DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.maxPinLength}}$`,
);
export const PIN_MIN_LENGTH = DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.minPinLength;
export const PIN_MAX_LENGTH = DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.maxPinLength;

export interface PinHashResult {
  encodedHash: string;
  algorithm: 'PBKDF2';
  iterations: number;
}

@Injectable()
export class PinHashService {
  constructor(
    @Optional()
    @Inject(TRANSACTION_PIN_POLICY)
    private readonly configuredPinPolicy?: TransactionPinSecurityPolicy,
  ) {}

  private get policy(): TransactionPinSecurityPolicy {
    // Defensive re-validation keeps hand-constructed fixtures fail-closed; in
    // production the policy already passed startup environment validation.
    return assertValidTransactionPinSecurityPolicy(
      this.configuredPinPolicy ?? DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
    );
  }

  /**
   * Validates the PIN shape against the CONFIGURED security policy (digits
   * only, length inside [minPinLength, maxPinLength]) and returns the
   * normalized value. Malformed input is rejected BEFORE any hashing work.
   */
  normalizePin(pin: unknown, field = 'pin'): string {
    const { minPinLength, maxPinLength } = this.policy;
    const rule = `${field} must be a ${minPinLength} to ${maxPinLength} digit numeric PIN`;
    if (typeof pin !== 'string') {
      throw new BadRequestException(rule);
    }
    const normalized = pin.trim();
    if (
      !PIN_DIGITS_ONLY.test(normalized) ||
      normalized.length < minPinLength ||
      normalized.length > maxPinLength
    ) {
      throw new BadRequestException(rule);
    }
    return normalized;
  }

  /** Hashes a validated PIN with a fresh random salt and server-controlled KDF parameters. */
  hashPin(pin: string): PinHashResult {
    const normalized = this.normalizePin(pin);
    const salt = randomBytes(SALT_BYTES);
    const derived = pbkdf2Sync(
      normalized,
      salt,
      PBKDF2_ITERATIONS,
      DERIVED_KEY_BYTES,
      PBKDF2_DIGEST,
    );
    return {
      encodedHash: [
        'PBKDF2',
        PBKDF2_DIGEST,
        String(PBKDF2_ITERATIONS),
        salt.toString('base64url'),
        derived.toString('base64url'),
      ].join('$'),
      algorithm: 'PBKDF2',
      iterations: PBKDF2_ITERATIONS,
    };
  }
}
