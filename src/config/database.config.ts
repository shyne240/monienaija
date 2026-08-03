import type { DataSourceOptions } from 'typeorm';

import type { Environment } from './environment';

export function createDatabaseOptions(environment: Environment): DataSourceOptions {
  return {
    type: 'postgres',
    host: environment.DB_HOST,
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
    migrations: [`${__dirname}/../migrations/*{.ts,.js}`],
  };
}
