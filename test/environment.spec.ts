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
      PORT: 3000,
      DB_PORT: 5432,
      DB_SSL: false,
      IDEMPOTENCY_RETENTION_SECONDS: 86400,
      OUTBOX_RETRY_DELAY_SECONDS: 60,
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
});
