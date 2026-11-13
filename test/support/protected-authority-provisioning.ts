import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * Executes the SAME provisioning SQL that operators run (scripts/sql/*.sql) against real
 * PostgreSQL. No test-only grants: the negative tests run as the provisioned ordinary runtime
 * login, so a pass proves the shipped configuration denies the write.
 */
export interface ProvisionedRoles {
  runtimeRole: string;
  runtimePassword: string;
  authorityRole: string;
  authorityPassword: string;
  migratorRole: string;
  migratorPassword: string;
}

const SQL_DIRECTORY = join(__dirname, '..', '..', 'scripts', 'sql');

function password(): string {
  return randomBytes(24).toString('base64url');
}

export function provisionedRoleSet(label: string): ProvisionedRoles {
  const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`;
  const prefix = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 24);
  return {
    runtimeRole: `mn_${prefix}_rt_${suffix}`.slice(0, 62),
    runtimePassword: password(),
    authorityRole: `mn_${prefix}_au_${suffix}`.slice(0, 62),
    authorityPassword: password(),
    migratorRole: `mn_${prefix}_mg_${suffix}`.slice(0, 62),
    migratorPassword: password(),
  };
}

function render(file: string, roles: ProvisionedRoles, database: string): string {
  let sql = readFileSync(join(SQL_DIRECTORY, file), 'utf8');
  const values: Record<string, string> = {
    '{{RUNTIME_ROLE}}': roles.runtimeRole,
    '{{RUNTIME_PASSWORD}}': `'${roles.runtimePassword.replace(/'/g, "''")}'`,
    '{{AUTHORITY_ROLE}}': roles.authorityRole,
    '{{AUTHORITY_PASSWORD}}': `'${roles.authorityPassword.replace(/'/g, "''")}'`,
    '{{MIGRATOR_ROLE}}': roles.migratorRole,
    '{{MIGRATOR_PASSWORD}}': `'${roles.migratorPassword.replace(/'/g, "''")}'`,
    '{{DATABASE_NAME}}': database,
  };
  for (const [token, value] of Object.entries(values)) sql = sql.split(token).join(value);
  if (sql.includes('{{')) throw new Error(`${file} has an unresolved placeholder`);
  return sql;
}

export async function provisionClusterRoles(
  admin: DataSource,
  roles: ProvisionedRoles,
): Promise<void> {
  await admin.query(render('provision-database-roles-cluster.sql', roles, databaseName(admin)));
}

export async function provisionDatabaseBeforeMigrations(
  admin: DataSource,
  roles: ProvisionedRoles,
  database = databaseName(admin),
): Promise<void> {
  await admin.query(render('provision-database-roles-before-migrations.sql', roles, database));
}

export async function provisionDatabaseAfterMigrations(
  admin: DataSource,
  roles: ProvisionedRoles,
  database = databaseName(admin),
): Promise<void> {
  await admin.query(render('provision-database-roles-after-migrations.sql', roles, database));
}

/** Provision an already-migrated suite database with a real runtime/authority/migration split. */
export async function provisionMigratedDatabase(
  admin: DataSource,
  roles: ProvisionedRoles,
): Promise<void> {
  await provisionClusterRoles(admin, roles);
  await provisionDatabaseBeforeMigrations(admin, roles);
  await provisionDatabaseAfterMigrations(admin, roles);
}

export function roleConnection(
  admin: DataSource,
  role: { user: string; password: string },
  database = databaseName(admin),
): DataSource {
  const options = admin.options;
  if (options.type !== 'postgres') throw new Error('PostgreSQL required');
  return new DataSource({
    type: 'postgres',
    host: options.host,
    port: options.port,
    database,
    username: role.user,
    password: role.password,
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [],
    logging: false,
  });
}

/** Administrative connection to another database on the same server. */
export function adminConnectionTo(admin: DataSource, database: string): DataSource {
  const options = admin.options;
  if (options.type !== 'postgres') throw new Error('PostgreSQL required');
  return new DataSource({
    type: 'postgres',
    host: options.host,
    port: options.port,
    database,
    username: options.username,
    password: options.password,
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [],
    logging: false,
  });
}

export function databaseName(dataSource: DataSource): string {
  const name = dataSource.options.database;
  if (typeof name !== 'string' || !name) throw new Error('DataSource has no database name');
  return name;
}

/** Creates an empty database owned by the migration role. */
export async function createMigratorOwnedDatabase(
  admin: DataSource,
  name: string,
  migratorRole: string,
): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}" OWNER "${migratorRole}" TEMPLATE template0`);
}

/** Migration DataSource that carries the application entity/migration registrations. */
export function migratorDataSource(
  admin: DataSource,
  roles: ProvisionedRoles,
  database: string,
): DataSource {
  const options = admin.options;
  if (options.type !== 'postgres') throw new Error('PostgreSQL required');
  return new DataSource({
    type: 'postgres',
    host: options.host,
    port: options.port,
    database,
    username: roles.migratorRole,
    password: roles.migratorPassword,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    entities: options.entities,
    migrations: options.migrations,
    logging: false,
  });
}
