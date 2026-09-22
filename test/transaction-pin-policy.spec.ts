import { validateEnvironment } from '../src/config/environment';
import { PinHashService } from '../src/customer-authentication/pin-hash.service';
import {
  assertValidTransactionPinSecurityPolicy,
  DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
  PIN_INPUT_PATTERN,
  PIN_POLICY_BOUNDS,
  PIN_POLICY_ENV,
  resolveTransactionPinSecurityPolicy,
  type TransactionPinSecurityPolicy,
} from '../src/customer-authentication/transaction-pin-policy';

/**
 * Centralized Transaction PIN security policy tests.
 *
 * V1 defaults are INTERNAL MonieNaija decisions (5 failed attempts, 4-6
 * digits) — asserted here so a regression can never silently flip them, and
 * so no future change can misattribute them to a regulator.
 */

function baseEnvironment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_NAME: 'monienaija_test',
    DB_USER: 'monienaija',
    DB_PASSWORD: 'monienaija',
    ...overrides,
  };
}

function configServiceWith(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] };
}

// Defence-in-depth: nobody may attribute these defaults to CBN doctrine
// inside the repository. (Checked here as a policy-in-code assertion.)
describe('Transaction PIN security policy — centralized configuration', () => {
  it('V1 defaults: INTERNAL MonieNaija values 5 failed attempts and 4-6 digit PINs', () => {
    expect(DEFAULT_TRANSACTION_PIN_SECURITY_POLICY).toEqual({
      maxFailedAttempts: 5,
      minPinLength: 4,
      maxPinLength: 6,
    });
    // The default lockout threshold stays exactly 5 — internal V1 default.
    expect(DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.maxFailedAttempts).toBe(5);
  });

  it('environment schema defaults resolve to the same internal V1 defaults', () => {
    const environment = validateEnvironment(baseEnvironment());
    expect(environment.PIN_MAX_FAILED_ATTEMPTS).toBe(5);
    expect(environment.PIN_MIN_LENGTH).toBe(4);
    expect(environment.PIN_MAX_LENGTH).toBe(6);
    expect(resolveTransactionPinSecurityPolicy(undefined)).toEqual(
      DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
    );
  });

  it('resolves configured values from the environment', () => {
    const environment = validateEnvironment(
      baseEnvironment({
        PIN_MAX_FAILED_ATTEMPTS: '3',
        PIN_MIN_LENGTH: '6',
        PIN_MAX_LENGTH: '8',
      }),
    );
    expect(environment.PIN_MAX_FAILED_ATTEMPTS).toBe(3);
    expect(environment.PIN_MIN_LENGTH).toBe(6);
    expect(environment.PIN_MAX_LENGTH).toBe(8);

    const policy = resolveTransactionPinSecurityPolicy(configServiceWith(environment));
    expect(policy).toEqual({ maxFailedAttempts: 3, minPinLength: 6, maxPinLength: 8 });
    expect(PIN_POLICY_ENV.maxFailedAttempts).toBe('PIN_MAX_FAILED_ATTEMPTS');
  });

  it('rejects maxFailedAttempts below 1 at startup validation', () => {
    expect(() => validateEnvironment(baseEnvironment({ PIN_MAX_FAILED_ATTEMPTS: '0' }))).toThrow(
      /PIN_MAX_FAILED_ATTEMPTS/,
    );
  });

  it('rejects maxFailedAttempts above the implementation cap (bounded security limit)', () => {
    expect(() =>
      validateEnvironment(
        baseEnvironment({
          PIN_MAX_FAILED_ATTEMPTS: String(PIN_POLICY_BOUNDS.maxFailedAttempts.max + 1),
        }),
      ),
    ).toThrow(/PIN_MAX_FAILED_ATTEMPTS/);
  });

  it('rejects a PIN minimum length below the V1 floor of 4 digits', () => {
    expect(() => validateEnvironment(baseEnvironment({ PIN_MIN_LENGTH: '3' }))).toThrow(
      /PIN_MIN_LENGTH/,
    );
  });

  it('rejects maxPinLength lower than minPinLength', () => {
    expect(() =>
      validateEnvironment(baseEnvironment({ PIN_MIN_LENGTH: '8', PIN_MAX_LENGTH: '6' })),
    ).toThrow(/PIN_MAX_LENGTH must be greater than or equal to PIN_MIN_LENGTH/);
  });

  it('rejects PIN lengths outside the absolute 4-12 digit envelope', () => {
    expect(() => validateEnvironment(baseEnvironment({ PIN_MAX_LENGTH: '13' }))).toThrow(
      /PIN_MAX_LENGTH/,
    );
  });

  it('assertValidTransactionPinSecurityPolicy fails closed on invalid hand-built policies', () => {
    const bad: TransactionPinSecurityPolicy[] = [
      { maxFailedAttempts: 0, minPinLength: 4, maxPinLength: 6 },
      { maxFailedAttempts: 5, minPinLength: 3, maxPinLength: 6 },
      { maxFailedAttempts: 5, minPinLength: 4, maxPinLength: 3 },
      { maxFailedAttempts: 5, minPinLength: 8, maxPinLength: 6 },
      { maxFailedAttempts: 5, minPinLength: 4, maxPinLength: 13 },
    ];
    for (const policy of bad) {
      expect(() => assertValidTransactionPinSecurityPolicy(policy)).toThrow(
        /Transaction PIN security policy/,
      );
    }
    expect(assertValidTransactionPinSecurityPolicy(DEFAULT_TRANSACTION_PIN_SECURITY_POLICY)).toBe(
      DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
    );
  });

  it('resolveTransactionPinSecurityPolicy fail-closes on invalid injected values', () => {
    expect(() =>
      resolveTransactionPinSecurityPolicy(
        configServiceWith({ PIN_MAX_FAILED_ATTEMPTS: 0 }) as never,
      ),
    ).toThrow(/maxFailedAttempts/);
  });

  it('DTO sanitation envelope follows the absolute bounds (4-12), not a hard-coded 4-6', () => {
    expect(PIN_INPUT_PATTERN.test('1234')).toBe(true);
    expect(PIN_INPUT_PATTERN.test('123456')).toBe(true);
    expect(PIN_INPUT_PATTERN.test('123456789012')).toBe(true);
    expect(PIN_INPUT_PATTERN.test('123')).toBe(false);
    expect(PIN_INPUT_PATTERN.test('1234567890123')).toBe(false);
    expect(PIN_INPUT_PATTERN.test('abcdef')).toBe(false);
  });

  it('PIN length validation follows the configured min/max', () => {
    // Default policy keeps V1 behavior: 4-6 digits.
    const defaultHasher = new PinHashService();
    expect(() => defaultHasher.normalizePin('123')).toThrow(/4 to 6 digit numeric PIN/);
    expect(() => defaultHasher.normalizePin('1234567')).toThrow(/4 to 6 digit numeric PIN/);
    expect(defaultHasher.normalizePin('1234')).toBe('1234');
    expect(defaultHasher.normalizePin('123456')).toBe('123456');
    expect(() => defaultHasher.normalizePin('12345a')).toThrow(/4 to 6 digit numeric PIN/);

    // Configured 8-digit-only policy: V1-legal PINs are rejected, 8 digits accepted.
    const eight = new PinHashService({ maxFailedAttempts: 5, minPinLength: 8, maxPinLength: 8 });
    expect(() => eight.normalizePin('123456')).toThrow(/8 to 8 digit numeric PIN/);
    expect(() => eight.normalizePin('1234567')).toThrow(/8 to 8 digit numeric PIN/);
    expect(() => eight.normalizePin('123456789')).toThrow(/8 to 8 digit numeric PIN/);
    expect(eight.normalizePin('12345678')).toBe('12345678');

    // Configured 6-12 window.
    const wide = new PinHashService({ maxFailedAttempts: 5, minPinLength: 6, maxPinLength: 12 });
    expect(() => wide.normalizePin('12345')).toThrow(/6 to 12 digit numeric PIN/);
    expect(wide.normalizePin('123456789012')).toBe('123456789012');
  });

  it('PinHashService refuses to operate on an invalid injected policy (fail-closed)', () => {
    const broken = new PinHashService({ maxFailedAttempts: 0, minPinLength: 4, maxPinLength: 6 });
    expect(() => broken.normalizePin('1234')).toThrow(/Transaction PIN security policy/);
  });
});
