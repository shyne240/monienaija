import type { ConfigService } from '@nestjs/config';
import { DataSource, type DataSourceOptions } from 'typeorm';

/**
 * Token for the credential-separated connection used by the protected checker-authority
 * component. When no separate credential is configured this resolves to the ordinary application
 * DataSource, which keeps local/test/CI usable but is NOT an accepted production configuration —
 * `ProductionReadinessService` refuses to start production in that case.
 */
export const PROTECTED_AUTHORITY_DATA_SOURCE = Symbol('PROTECTED_AUTHORITY_DATA_SOURCE');

export interface ProtectedAuthorityEnvironment {
  user?: string;
  password?: string;
  host?: string;
  port?: number;
  database?: string;
}

export function protectedAuthorityEnvironment(
  values: Record<string, unknown>,
): ProtectedAuthorityEnvironment {
  const text = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const port = (() => {
    const value = values.PROTECTED_AUTHORITY_DB_PORT;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return undefined;
  })();
  return {
    user: text('PROTECTED_AUTHORITY_DB_USER'),
    password: text('PROTECTED_AUTHORITY_DB_PASSWORD'),
    host: text('PROTECTED_AUTHORITY_DB_HOST'),
    port,
    database: text('PROTECTED_AUTHORITY_DB_NAME'),
  };
}

/** True only when a distinct protected-authority credential is fully configured. */
export function protectedAuthorityConfigured(values: Record<string, unknown>): boolean {
  const environment = protectedAuthorityEnvironment(values);
  return Boolean(environment.user && environment.password);
}

/**
 * Builds the protected-authority connection options from the ordinary connection. The authority
 * login must be a different role; this is checked at readiness time using the real connection
 * identity rather than trusting configuration.
 */
export function createProtectedAuthorityOptions(
  values: Record<string, unknown>,
  base: DataSourceOptions,
): DataSourceOptions | null {
  const environment = protectedAuthorityEnvironment(values);
  if (!environment.user || !environment.password) return null;
  if (base.type !== 'postgres') return null;
  return {
    ...base,
    username: environment.user,
    password: environment.password,
    host: environment.host ?? base.host,
    port: environment.port ?? base.port,
    database: environment.database ?? base.database,
    migrations: [],
    migrationsRun: false,
    synchronize: false,
  };
}

export async function initializeProtectedAuthorityDataSource(
  values: Record<string, unknown>,
  main: DataSource,
): Promise<DataSource> {
  const options = createProtectedAuthorityOptions(values, main.options);
  if (!options) return main;
  const dataSource = new DataSource(options);
  await dataSource.initialize();
  return dataSource;
}

export function configValues(config: ConfigService): Record<string, unknown> {
  return {
    PROTECTED_AUTHORITY_DB_USER: config.get<string>('PROTECTED_AUTHORITY_DB_USER'),
    PROTECTED_AUTHORITY_DB_PASSWORD: config.get<string>('PROTECTED_AUTHORITY_DB_PASSWORD'),
    PROTECTED_AUTHORITY_DB_HOST: config.get<string>('PROTECTED_AUTHORITY_DB_HOST'),
    PROTECTED_AUTHORITY_DB_PORT: config.get<string>('PROTECTED_AUTHORITY_DB_PORT'),
    PROTECTED_AUTHORITY_DB_NAME: config.get<string>('PROTECTED_AUTHORITY_DB_NAME'),
  };
}
