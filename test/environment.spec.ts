import { validateEnvironment } from '../src/config/environment';

// INTEGRATION NOTE (integration/main-backend-frontend-20261030): 'local-password' satisfied this suite when it was written, but the
// integrated schema also carries main's phase 16-20 production secret rule (>= 16 characters, no
// documented placeholder value or prefix, no single-character repetition), and several cases below
// promote this fixture to NODE_ENV=production. The base password therefore conforms to the
// production profile; non-production cases are unaffected because the rule returns early for them,
// and the placeholder-rejection cases below still override DB_PASSWORD explicitly, so they keep
// failing for the documented reason they assert.
const validEnvironment = {
  DB_HOST: 'localhost',
  DB_NAME: 'monienaija',
  DB_USER: 'monienaija',
  DB_PASSWORD: 'environment-spec-fixture-password',
};

describe('validateEnvironment', () => {
  it('applies safe defaults to a valid environment', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      APP_VERSION: '0.1.0',
      API_VERSION: 'v1',
      PORT: 3000,
      DB_PORT: 5432,
      DB_SSL: false,
      IDEMPOTENCY_RETENTION_SECONDS: 86400,
      OUTBOX_RETRY_DELAY_SECONDS: 60,
      METRICS_RETENTION_SECONDS: 2592000,
      AUDIT_RETENTION_SECONDS: 31536000,
      OUTBOX_RETENTION_SECONDS: 2592000,
      BUILD_TIMESTAMP: 'unknown',
      SHUTDOWN_DRAIN_TIMEOUT_SECONDS: 30,
    });
  });

  it('accepts only credential-free HTTPS URLs for the optional Cash-to-Cash locator link', () => {
    expect(validateEnvironment(validEnvironment).CASH_TO_CASH_LOCATOR_URL).toBeUndefined();
    expect(validateEnvironment({ ...validEnvironment, CASH_TO_CASH_LOCATOR_URL: 'https://locator.example.ng/cash-to-cash' }).CASH_TO_CASH_LOCATOR_URL)
      .toBe('https://locator.example.ng/cash-to-cash');
    expect(() => validateEnvironment({ ...validEnvironment, CASH_TO_CASH_LOCATOR_URL: 'http://locator.example.ng/cash-to-cash' }))
      .toThrow('Invalid environment configuration');
    expect(() => validateEnvironment({ ...validEnvironment, CASH_TO_CASH_LOCATOR_URL: 'https://user:password@locator.example.ng/cash-to-cash' }))
      .toThrow('Invalid environment configuration');
  });

  it('keeps secure PoA uploads disabled by default with the documented 10 MB cap', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      POA_UPLOADS_ENABLED: false,
      POA_MAX_UPLOAD_BYTES: 10_485_760,
      POA_STORAGE_PROVIDER: 'local',
      POA_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
    });
  });

  it('restricts enabled local PoA storage to development/test', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        NOTIFICATION_SMS_PROVIDER: 'robase',
        ROBASE_API_KEY: `robe_${'a'.repeat(60)}`,
        POA_UPLOADS_ENABLED: 'true',
        POA_STORAGE_PROVIDER: 'local',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts production S3 PoA configuration only with a valid persistent versioned keyring', () => {
    const base = {
      ...validEnvironment,
      NODE_ENV: 'production',
      NOTIFICATION_SMS_PROVIDER: 'robase',
      ROBASE_API_KEY: `robe_${'a'.repeat(60)}`,
      POA_UPLOADS_ENABLED: 'true',
      POA_STORAGE_PROVIDER: 's3',
      POA_S3_BUCKET: 'private-customer-documents',
      POA_S3_REGION: 'af-south-1',
      POA_ENCRYPTION_KEYRING_JSON: JSON.stringify({ v1: Buffer.alloc(32, 9).toString('base64') }),
    };
    expect(validateEnvironment(base)).toMatchObject({
      POA_UPLOADS_ENABLED: true,
      POA_STORAGE_PROVIDER: 's3',
      POA_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
    });
    expect(() =>
      validateEnvironment({ ...base, POA_ENCRYPTION_KEYRING_JSON: undefined }),
    ).toThrow('Invalid environment configuration');
  });

  it('fails fast when required database configuration is absent', () => {
    expect(() => validateEnvironment({ ...validEnvironment, DB_PASSWORD: '' })).toThrow(
      'Invalid environment configuration',
    );
  });

  it('rejects invalid operational durations', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, IDEMPOTENCY_RETENTION_SECONDS: '30' }),
    ).toThrow('Invalid environment configuration');
    expect(() =>
      validateEnvironment({ ...validEnvironment, OUTBOX_RETRY_DELAY_SECONDS: '0' }),
    ).toThrow('Invalid environment configuration');
  });

  // V1-RELEASE-01: the 'console' SMS provider never delivers real SMS and logs live OTP
  // codes to stdout; a production deployment must not be able to fall into it silently.
  it('rejects a production environment that has not explicitly selected a real SMS provider', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, NODE_ENV: 'production' }),
    ).toThrow('Invalid environment configuration');
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        NOTIFICATION_SMS_PROVIDER: 'console',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts a production environment that has explicitly selected the real SMS provider with credentials', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        NOTIFICATION_SMS_PROVIDER: 'robase',
        ROBASE_API_KEY: `robe_${'a'.repeat(60)}`,
      }),
    ).toMatchObject({ NODE_ENV: 'production', NOTIFICATION_SMS_PROVIDER: 'robase' });
  });

  it('keeps non-production environments defaulting to the console SMS provider unchanged', () => {
    expect(validateEnvironment({ ...validEnvironment, NODE_ENV: 'staging' })).toMatchObject({
      NODE_ENV: 'staging',
      NOTIFICATION_SMS_PROVIDER: 'console',
    });
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      NODE_ENV: 'development',
      NOTIFICATION_SMS_PROVIDER: 'console',
    });
  });

  // V1-GO-LIVE-01: the shipped .env.example documents the inert commercial-accounting
  // posture as COMMERCIAL_ACCOUNTING_ENABLED=false with the three treatment/timing knobs
  // left blank. Before this fix, validateEnvironment() rejected that exact, canonical
  // configuration in every NODE_ENV (development/test/staging/production) and on every
  // boot path (main.ts, data-source.ts migrations, app.module.ts), because the three enum
  // fields lacked the empty-string-to-undefined preprocessing used by every other optional
  // field in this schema. A fresh deployer following the repo's own .env.example could not
  // start the application at all.
  it('accepts the shipped .env.example commercial-accounting posture (disabled, blank treatments)', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        COMMERCIAL_ACCOUNTING_ENABLED: 'false',
        COMMERCIAL_ACCOUNTING_VAT_TREATMENT: '',
        COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: '',
        COMMERCIAL_COMMISSION_RECOGNITION_TIMING: '',
      }),
    ).toMatchObject({
      COMMERCIAL_ACCOUNTING_ENABLED: false,
      COMMERCIAL_ACCOUNTING_VAT_TREATMENT: undefined,
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: undefined,
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: undefined,
    });
  });

  it('still rejects a genuinely invalid (non-empty, out-of-enum) commercial-accounting treatment', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'NOT_A_REAL_TREATMENT',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts an explicit commercial-accounting enabled posture with real treatment values', () => {
    expect(
      validateEnvironment({
        ...validEnvironment,
        COMMERCIAL_ACCOUNTING_ENABLED: 'true',
        COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'EXCLUSIVE_ADD_ON',
        COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
        COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
      }),
    ).toMatchObject({
      COMMERCIAL_ACCOUNTING_ENABLED: true,
      COMMERCIAL_ACCOUNTING_VAT_TREATMENT: 'EXCLUSIVE_ADD_ON',
      COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT: 'AGENT_WALLET_NETTING',
      COMMERCIAL_COMMISSION_RECOGNITION_TIMING: 'AT_COMPLETION',
    });
  });
});
