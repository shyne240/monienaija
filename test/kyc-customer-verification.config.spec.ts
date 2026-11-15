import { validateEnvironment } from '../src/config/environment';
import { customerKycConfigurationFromEnvironment } from '../src/kyc-verification/kyc-customer-verification.config';

const base = {
  DB_HOST: 'localhost',
  DB_NAME: 'monienaija',
  DB_USER: 'monienaija',
  DB_PASSWORD: 'kyc-customer-config-test-password',
};
const policy = {
  version: 'ops-v1',
  enabled: true,
  maxAttemptsPerConsent: 3,
  cooldownSeconds: 60,
  customerWindowSeconds: 3600,
  customerWindowLimit: 5,
  providerWindowSeconds: 3600,
  providerWindowLimit: 100,
  timeoutMs: 1000,
  evidenceValiditySeconds: 86400,
};
const key = Buffer.alloc(32, 17);
const configured = () =>
  validateEnvironment({
    ...base,
    KYC_CUSTOMER_VERIFICATION_ENABLED: 'true',
    KYC_VERIFICATION_POLICY_JSON: JSON.stringify(policy),
    KYC_CONSENT_NOTICE_VERSION: 'notice-v1',
    KYC_CONSENT_NOTICE_TEXT: 'I authorize this identity verification for the stated KYC purpose.',
    KYC_CONSENT_VALIDITY_SECONDS: '86400',
    KYC_OWNERSHIP_KEY_BASE64: key.toString('base64'),
    KYC_OWNERSHIP_KEY_VERSION: 'ownership-v1',
  });

describe('customer verification runtime configuration', () => {
  it('defaults to a disabled workflow with no policy, key, notice, or seeded thresholds', () => {
    const env = validateEnvironment(base);
    expect(env.KYC_CUSTOMER_VERIFICATION_ENABLED).toBe(false);
    expect(env.KYC_VERIFICATION_POLICY_JSON).toBeUndefined();
    expect(customerKycConfigurationFromEnvironment(env)).toMatchObject({
      enabled: false,
      policy: null,
      consentNoticeVersion: null,
      consentNoticeText: null,
      consentValiditySeconds: null,
      ownershipKey: null,
      ownershipKeyVersion: null,
    });
  });

  it('accepts an explicitly configured bounded policy, notice, consent lifetime, and 256-bit key', () => {
    const env = configured();
    const result = customerKycConfigurationFromEnvironment(env);
    expect(result).toMatchObject({
      enabled: true,
      policy,
      consentNoticeVersion: 'notice-v1',
      consentValiditySeconds: 86400,
      ownershipKeyVersion: 'ownership-v1',
    });
    expect(result.ownershipKey).toEqual(key);
  });

  it('fails closed when enabled without a policy or approved notice/key references', () => {
    const withoutPolicy = validateEnvironment({
      ...base,
      KYC_CUSTOMER_VERIFICATION_ENABLED: 'true',
    });
    expect(() => customerKycConfigurationFromEnvironment(withoutPolicy)).toThrow(
      'KYC_VERIFICATION_POLICY_JSON is required',
    );

    const incomplete = validateEnvironment({
      ...base,
      KYC_CUSTOMER_VERIFICATION_ENABLED: 'true',
      KYC_VERIFICATION_POLICY_JSON: JSON.stringify(policy),
      KYC_CONSENT_NOTICE_VERSION: 'notice-v1',
      KYC_CONSENT_NOTICE_TEXT: 'An approved notice that is long enough.',
      KYC_CONSENT_VALIDITY_SECONDS: '86400',
      KYC_OWNERSHIP_KEY_BASE64: key.toString('base64'),
    });
    expect(() => customerKycConfigurationFromEnvironment(incomplete)).toThrow(
      'KYC_OWNERSHIP_KEY_VERSION is required',
    );
  });

  it('rejects malformed operational policy and a consent lifetime shorter than evidence freshness', () => {
    const extraField = validateEnvironment({
      ...base,
      KYC_CUSTOMER_VERIFICATION_ENABLED: 'true',
      KYC_VERIFICATION_POLICY_JSON: JSON.stringify({ ...policy, seededLimit: 1 }),
      KYC_CONSENT_NOTICE_VERSION: 'notice-v1',
      KYC_CONSENT_NOTICE_TEXT: 'An approved notice that is long enough.',
      KYC_CONSENT_VALIDITY_SECONDS: '86400',
      KYC_OWNERSHIP_KEY_BASE64: key.toString('base64'),
      KYC_OWNERSHIP_KEY_VERSION: 'ownership-v1',
    });
    expect(() => customerKycConfigurationFromEnvironment(extraField)).toThrow(
      'KYC_VERIFICATION_POLICY_JSON has an invalid shape',
    );

    const tooShort = validateEnvironment({
      ...base,
      KYC_CUSTOMER_VERIFICATION_ENABLED: 'true',
      KYC_VERIFICATION_POLICY_JSON: JSON.stringify(policy),
      KYC_CONSENT_NOTICE_VERSION: 'notice-v1',
      KYC_CONSENT_NOTICE_TEXT: 'An approved notice that is long enough.',
      KYC_CONSENT_VALIDITY_SECONDS: '3600',
      KYC_OWNERSHIP_KEY_BASE64: key.toString('base64'),
      KYC_OWNERSHIP_KEY_VERSION: 'ownership-v1',
    });
    expect(() => customerKycConfigurationFromEnvironment(tooShort)).toThrow(
      'KYC consent validity must cover the configured evidence validity',
    );
  });

  it('does not treat an invalid key as available when the workflow is disabled', () => {
    const env = validateEnvironment({ ...base, KYC_OWNERSHIP_KEY_BASE64: 'not-base64' });
    expect(customerKycConfigurationFromEnvironment(env)).toMatchObject({
      enabled: false,
      ownershipKey: null,
    });
  });
});
