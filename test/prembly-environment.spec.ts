import { validateEnvironment } from '../src/config/environment';

const baseEnvironment = {
  NODE_ENV: 'test',
  DB_HOST: 'db.example.invalid',
  DB_NAME: 'monienaija_test',
  DB_USER: 'kyc_test',
  DB_PASSWORD: 'synthetic-test-database-password',
};
const encryptionKey = Buffer.alloc(32, 17).toString('base64');

describe('Prembly environment release gates', () => {
  it('keeps both release gates closed by default and requires a keyring when sandbox calls are enabled', () => {
    const defaults = validateEnvironment(baseEnvironment);
    expect(defaults.PREMBLY_SANDBOX_CALLS_ENABLED).toBe(false);
    expect(defaults.PREMBLY_PRODUCTION_RELEASE_ENABLED).toBe(false);

    expect(() =>
      validateEnvironment({ ...baseEnvironment, PREMBLY_SANDBOX_CALLS_ENABLED: 'true' }),
    ).toThrow('KYC_PROVIDER_ENCRYPTION_KEYRING_JSON is required');
  });

  it('accepts a versioned canonical 32-byte keyring only when the active key is present', () => {
    const configured = validateEnvironment({
      ...baseEnvironment,
      PREMBLY_SANDBOX_CALLS_ENABLED: 'true',
      KYC_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: encryptionKey }),
      KYC_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
    });
    expect(configured.PREMBLY_SANDBOX_CALLS_ENABLED).toBe(true);
    expect(configured.KYC_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION).toBe('v1');

    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        PREMBLY_SANDBOX_CALLS_ENABLED: 'true',
        KYC_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: 'invalid' }),
      }),
    ).toThrow('Every KYC provider encryption key must be a versioned 32-byte base64 value');

    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        PREMBLY_SANDBOX_CALLS_ENABLED: 'true',
        KYC_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: encryptionKey }),
        KYC_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION: 'v2',
      }),
    ).toThrow('KYC_PROVIDER_ENCRYPTION_ACTIVE_KEY_VERSION is missing from the KYC keyring');
  });
});
