import type { DataSourceOptions } from 'typeorm';

import type { Environment } from './environment';

/**
 * Optional connection-resilience controls.
 *
 * Nothing is invented here: when a value is unset, the driver default remains in force (pg: pool
 * size 10, no connect timeout, no statement timeout). Deployments that need explicit capacity or
 * timeout numbers provide `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS` and
 * `DB_STATEMENT_TIMEOUT_MS`, which keeps production tuning an infrastructure decision instead of a
 * hardcoded repository constant.
 */
function poolOptions(environment: Environment): Record<string, unknown> | undefined {
  const options: Record<string, unknown> = {};
  if (environment.DB_POOL_MAX !== undefined) options.max = environment.DB_POOL_MAX;
  if (environment.DB_POOL_IDLE_TIMEOUT_MS !== undefined)
    options.idleTimeoutMillis = environment.DB_POOL_IDLE_TIMEOUT_MS;
  if (environment.DB_CONNECTION_TIMEOUT_MS !== undefined)
    options.connectionTimeoutMillis = environment.DB_CONNECTION_TIMEOUT_MS;
  if (environment.DB_STATEMENT_TIMEOUT_MS !== undefined)
    options.statement_timeout = environment.DB_STATEMENT_TIMEOUT_MS;
  return Object.keys(options).length > 0 ? options : undefined;
}

export function createDatabaseOptions(environment: Environment): DataSourceOptions {
  return {
    type: 'postgres',
    // Docker Desktop exposes the published PostgreSQL port over IPv4. Node can
    // otherwise resolve localhost to the IPv6 loopback address on Windows.
    host: environment.DB_HOST === 'localhost' ? '127.0.0.1' : environment.DB_HOST,
    port: environment.DB_PORT,
    username: environment.DB_USER,
    password: environment.DB_PASSWORD,
    database: environment.DB_NAME,
    ssl: environment.DB_SSL
      ? { rejectUnauthorized: environment.DB_SSL_REJECT_UNAUTHORIZED }
      : false,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    ...(poolOptions(environment) ? { extra: poolOptions(environment) } : {}),
    entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
    migrations: [`${__dirname}/../migrations/*{.ts,.js}`],
  };
}
