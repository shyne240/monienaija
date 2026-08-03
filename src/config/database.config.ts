import type { DataSourceOptions } from 'typeorm';

import type { Environment } from './environment';

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
    entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
    migrations: [`${__dirname}/../migrations/*{.ts,.js}`],
  };
}
