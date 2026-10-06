import { validateEnvironment } from '../src/config/environment';

const validEnvironment = {
  DB_HOST: 'localhost',
  DB_NAME: 'monienaija',
  DB_USER: 'monienaija',
  DB_PASSWORD: 'local-password',
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
});
