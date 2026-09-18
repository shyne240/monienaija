import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { createDatabaseOptions } from '../src/config/database.config';
import { validateEnvironment } from '../src/config/environment';

const base = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'monienaija',
  DB_USER: 'monienaija',
};

const production = (overrides: Record<string, string> = {}) => ({
  ...base,
  NODE_ENV: 'production',
  DB_PASSWORD: 'a-strong-unique-production-password',
  ...overrides,
});

describe('production configuration safety', () => {
  it('refuses the documented local placeholder password in production', () => {
    expect(() => validateEnvironment(production({ DB_PASSWORD: 'change-me-local-only' }))).toThrow(
      /DB_PASSWORD: Placeholder secrets are not accepted/,
    );
  });

  it.each([
    ['change-me', /Placeholder secrets/],
    ['CHANGEME', /Placeholder secrets/],
    ['placeholder', /Placeholder secrets/],
    ['your-database-password', /Placeholder secrets/],
    ['example-password-value-1234', /Placeholder secrets/],
    ['short-pw', /at least 16 characters/],
    ['aaaaaaaaaaaaaaaaaaaa', /Repeated-character secrets/],
  ])('refuses %s in production', (password, expected) => {
    expect(() => validateEnvironment(production({ DB_PASSWORD: password }))).toThrow(expected);
  });

  it('accepts a strong production password', () => {
    const config = validateEnvironment(
      production({ DB_PASSWORD: 'Correct-Horse-Battery-Staple-2026' }),
    );

    expect(config.DB_PASSWORD).toBe('Correct-Horse-Battery-Staple-2026');
  });

  it('keeps local development usable with the documented local password', () => {
    const config = validateEnvironment({
      ...base,
      NODE_ENV: 'development',
      DB_PASSWORD: 'change-me-local-only',
    });

    expect(config.NODE_ENV).toBe('development');
  });

  it('refuses a placeholder partner callback secret in production', () => {
    expect(() =>
      validateEnvironment(
        production({
          A6_PARTNER_ENABLED: 'true',
          A6_PARTNER_ENVIRONMENT: 'production',
          A6_PARTNER_PRODUCTION_BASE_URL: 'https://partner.example.com',
          A6_PARTNER_PRODUCTION_CREDENTIAL_REFERENCE: 'ref/credential',
          A6_PARTNER_PRODUCTION_SIGNING_KEY_REFERENCE: 'ref/signing-key',
          A6_PARTNER_PRODUCTION_CALLBACK_SECRET: 'change-me-local-only',
        }),
      ),
    ).toThrow(/A6_PARTNER_PRODUCTION_CALLBACK_SECRET: Placeholder secrets/);
  });

  it('refuses the retired workforce development mock flag in production', () => {
    expect(() =>
      validateEnvironment(production({ A2_WORKFORCE_DEV_MOCK_ENABLED: 'true' })),
    ).toThrow(/A2_WORKFORCE_DEV_MOCK_ENABLED/);
  });

  it('refuses the retired workforce development mock flag in every environment', () => {
    // The mock assertion path no longer exists, so enabling the flag is a configuration error
    // everywhere instead of a silent no-op.
    for (const nodeEnv of ['development', 'test', 'staging'] as const) {
      expect(() =>
        validateEnvironment({
          ...base,
          NODE_ENV: nodeEnv,
          DB_PASSWORD: 'change-me-local-only',
          A2_WORKFORCE_DEV_MOCK_ENABLED: 'true',
        }),
      ).toThrow(/A2_WORKFORCE_DEV_MOCK_ENABLED/);
    }
  });
});

describe('database connection configuration', () => {
  const environment = (overrides: Record<string, string> = {}) =>
    validateEnvironment({
      ...base,
      NODE_ENV: 'test',
      DB_PASSWORD: 'local-test-password',
      ...overrides,
    });
  const postgresOptions = (overrides: Record<string, string> = {}) =>
    createDatabaseOptions(environment(overrides)) as PostgresConnectionOptions;

  it('keeps driver defaults when no resilience value is configured', () => {
    const options = postgresOptions();

    expect(options.extra).toBeUndefined();
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.migrationsTableName).toBe('typeorm_migrations');
  });

  it('maps explicitly configured pool and timeout values', () => {
    const options = postgresOptions({
      DB_POOL_MAX: '25',
      DB_POOL_IDLE_TIMEOUT_MS: '10000',
      DB_CONNECTION_TIMEOUT_MS: '5000',
      DB_STATEMENT_TIMEOUT_MS: '15000',
    });

    expect(options.extra).toEqual({
      max: 25,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
    });
  });

  it('normalises the localhost alias and honours ssl settings', () => {
    const options = postgresOptions({
      DB_HOST: 'localhost',
      DB_SSL: 'true',
      DB_SSL_REJECT_UNAUTHORIZED: 'false',
    });

    expect(options.host).toBe('127.0.0.1');
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });
});
