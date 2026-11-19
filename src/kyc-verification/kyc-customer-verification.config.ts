import type { Environment } from '../config/environment';
import { assertPolicy } from './kyc-policy';
import type { KycPolicy } from './kyc.types';
import type { CustomerKycVerificationConfiguration } from './kyc-customer-verification.service';

export type CustomerKycEnvironment = Pick<
  Environment,
  | 'KYC_CUSTOMER_VERIFICATION_ENABLED'
  | 'KYC_VERIFICATION_POLICY_JSON'
  | 'KYC_CONSENT_NOTICE_VERSION'
  | 'KYC_CONSENT_NOTICE_TEXT'
  | 'KYC_CONSENT_VALIDITY_SECONDS'
  | 'KYC_OWNERSHIP_KEY_BASE64'
  | 'KYC_OWNERSHIP_KEY_VERSION'
>;

const POLICY_KEYS = [
  'version',
  'enabled',
  'maxAttemptsPerConsent',
  'cooldownSeconds',
  'customerWindowSeconds',
  'customerWindowLimit',
  'providerWindowSeconds',
  'providerWindowLimit',
  'timeoutMs',
  'evidenceValiditySeconds',
].sort();
const hasExactKeys = (value: unknown, expected: string[]): value is Record<string, unknown> =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === expected.join(',');

/** Parse explicit KYC-only operational configuration; deliberately has no rate/freshness defaults.
 *
 * `ConfigService<Environment, true>` says the values are already validated; the test harness builds
 * an unvalidated test `ConfigModule`, so a raw `'false'` string can reach this function. Treating a
 * raw `'false'` as enabled inverts a security gate, which is the wrong direction to fail. This
 * normalisation is the only guard allowed here: it never turns a string into an *enabled* KYC path,
 * it can only turn an unvalidated falsy-looking string into `false`. Every other value keeps the
 * previous semantics, and the production path is unchanged because it is always validated.
 */
const falsyBooleanString = (value: unknown): unknown =>
  value === 'false' || value === '0' || value === 'no' ? false : value;
const truthyBooleanString = (value: unknown): unknown =>
  value === 'true' || value === '1' || value === 'yes' ? true : falsyBooleanString(value);

export function customerKycConfigurationFromEnvironment(
  env: CustomerKycEnvironment,
): CustomerKycVerificationConfiguration {
  const enabledRaw = truthyBooleanString(env.KYC_CUSTOMER_VERIFICATION_ENABLED);
  if (typeof enabledRaw !== 'boolean' && enabledRaw !== undefined) {
    throw new Error('KYC_CUSTOMER_VERIFICATION_ENABLED must be a validated boolean');
  }
  const enabled = enabledRaw === true;
  env = { ...env, KYC_CUSTOMER_VERIFICATION_ENABLED: enabled };
  let policy: KycPolicy | null = null;
  if (env.KYC_VERIFICATION_POLICY_JSON) {
    let value: unknown;
    try {
      value = JSON.parse(env.KYC_VERIFICATION_POLICY_JSON);
    } catch {
      if (env.KYC_CUSTOMER_VERIFICATION_ENABLED)
        throw new Error('KYC_VERIFICATION_POLICY_JSON must contain valid JSON');
    }
    if (value !== undefined) {
      if (!hasExactKeys(value, POLICY_KEYS)) {
        if (env.KYC_CUSTOMER_VERIFICATION_ENABLED)
          throw new Error('KYC_VERIFICATION_POLICY_JSON has an invalid shape');
      } else {
        const candidate = value as unknown as KycPolicy;
        try {
          assertPolicy(candidate);
          policy = candidate;
        } catch {
          if (env.KYC_CUSTOMER_VERIFICATION_ENABLED)
            throw new Error('KYC_VERIFICATION_POLICY_JSON contains invalid operational bounds');
        }
      }
    }
  } else if (env.KYC_CUSTOMER_VERIFICATION_ENABLED) {
    throw new Error('KYC_VERIFICATION_POLICY_JSON is required when customer KYC is enabled');
  }

  if (enabled && (!policy || !policy.enabled))
    throw new Error('Customer KYC requires an enabled versioned verification policy');
  if (enabled && (!env.KYC_CONSENT_NOTICE_VERSION || !env.KYC_CONSENT_NOTICE_TEXT))
    throw new Error('Customer KYC requires an approved consent notice version and text');
  if (
    enabled &&
    (!env.KYC_CONSENT_VALIDITY_SECONDS ||
      env.KYC_CONSENT_VALIDITY_SECONDS < policy!.evidenceValiditySeconds)
  )
    throw new Error('Customer KYC consent validity must cover the configured evidence validity');

  let ownershipKey: Buffer | null = null;
  const encodedKey = env.KYC_OWNERSHIP_KEY_BASE64;
  if (encodedKey) {
    const decoded = Buffer.from(encodedKey, 'base64');
    if (decoded.toString('base64') !== encodedKey || decoded.length < 32) {
      if (enabled) throw new Error('KYC_OWNERSHIP_KEY_BASE64 must encode at least 32 bytes');
    } else {
      ownershipKey = decoded;
    }
  } else if (enabled) {
    throw new Error('KYC_OWNERSHIP_KEY_BASE64 is required when customer KYC is enabled');
  }
  if (enabled && !env.KYC_OWNERSHIP_KEY_VERSION)
    throw new Error('KYC_OWNERSHIP_KEY_VERSION is required when customer KYC is enabled');

  return {
    enabled,
    policy: policy ? { ...policy, enabled: enabled && policy.enabled } : null,
    consentNoticeVersion: env.KYC_CONSENT_NOTICE_VERSION ?? null,
    consentNoticeText: env.KYC_CONSENT_NOTICE_TEXT ?? null,
    consentValiditySeconds: env.KYC_CONSENT_VALIDITY_SECONDS ?? null,
    ownershipKey,
    ownershipKeyVersion: env.KYC_OWNERSHIP_KEY_VERSION ?? null,
  };
}
