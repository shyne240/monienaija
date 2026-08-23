import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

/**
 * Real-PostgreSQL integration harness.
 *
 * Every suite gets its own database, named per process id, so that suites running in
 * separate Jest workers never share schema or rows. Nothing here mocks PostgreSQL: if the
 * server is unreachable the harness throws so the suite fails loudly rather than silently
 * skipping and reporting false coverage.
 */

export interface PostgresAdminConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  adminDatabase: string;
}

export function postgresAdminConfig(): PostgresAdminConfig {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  return {
    host: host === 'localhost' ? '127.0.0.1' : host,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'monienaija',
    password: process.env.DB_PASSWORD ?? 'monienaija-pw',
    adminDatabase: process.env.DB_ADMIN_NAME ?? 'postgres',
  };
}

function adminDataSource(): DataSource {
  const c = postgresAdminConfig();
  return new DataSource({
    type: 'postgres',
    host: c.host,
    port: c.port,
    username: c.username,
    password: c.password,
    database: c.adminDatabase,
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [],
    logging: false,
  });
}

async function withAdmin<T>(work: (ds: DataSource) => Promise<T>): Promise<T> {
  const ds = adminDataSource();
  await ds.initialize();
  try {
    return await work(ds);
  } finally {
    await ds.destroy().catch(() => undefined);
  }
}

/** Throws a descriptive error when PostgreSQL is not reachable. Never skips. */
export async function assertPostgresAvailable(): Promise<void> {
  try {
    await withAdmin((ds) => ds.query('SELECT 1'));
  } catch (error) {
    const c = postgresAdminConfig();
    throw new Error(
      `Real PostgreSQL is required for integration suites but is not reachable at ` +
        `${c.host}:${c.port} as "${c.username}". These suites must not be mocked or skipped. ` +
        `Underlying error: ${(error as Error).message}`,
    );
  }
}

export function integrationDatabaseName(label: string): string {
  const safe = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 24);
  return `mn_it_${safe}_${process.pid}`;
}

export function buildIntegrationDataSource(name: string): DataSource {
  const cfg = postgresAdminConfig();
  return new DataSource({
    type: 'postgres',
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password,
    database: name,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    entities: [`${__dirname}/../../src/**/*.entity.ts`],
    migrations: [`${__dirname}/../../src/migrations/*.ts`],
    logging: false,
  });
}

/** Creates a dedicated, empty database for the suite and returns an uninitialised DataSource. */
export async function createEmptyIntegrationDataSource(label: string): Promise<DataSource> {
  await assertPostgresAvailable();
  const name = integrationDatabaseName(label);
  await withAdmin(async (ds) => {
    await ds.query(`DROP DATABASE IF EXISTS "${name}"`);
    await ds.query(`CREATE DATABASE "${name}"`);
  });
  return buildIntegrationDataSource(name);
}

/**
 * Creates a dedicated database for the suite and runs the complete migration chain against
 * it. The returned DataSource uses the same entity and migration registration as production.
 */
export async function createIntegrationDataSource(label: string): Promise<DataSource> {
  const dataSource = await createEmptyIntegrationDataSource(label);
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });
  return dataSource;
}

/** Destroys the DataSource and drops its dedicated database. */
export async function destroyIntegrationDataSource(dataSource: DataSource): Promise<void> {
  const name = dataSource.options.database as string;
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
  await withAdmin(async (ds) => {
    await ds.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await ds.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
}

/** Truncates every application table, leaving the migration ledger intact. */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  const rows: Array<{ tablename: string }> = await dataSource.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'typeorm_migrations'`,
  );
  if (!rows.length) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** Reads a required single scalar from a query result without unchecked index access. */
export function firstRow<T>(rows: T[], context: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected at least one row for ${context}`);
  return row;
}

export interface TransferParticipant {
  customerId: string;
  customerWalletId: string;
  walletAccountId: string;
  bindingId: string;
  ledgerAccountId: string;
}

/**
 * Seeds the A3 customer/wallet/binding rows that the `transfers` foreign keys require.
 *
 * Real referential integrity is part of what these suites exist to prove, so the rows are
 * inserted for real rather than the constraints being relaxed.
 */
export async function seedTransferParticipant(
  dataSource: DataSource,
  label: string,
  ledgerAccountId: string,
): Promise<TransferParticipant> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
     VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
    [`it.${label}.${Date.now()}.${Math.floor(Math.random() * 1e6)}`],
  );
  const customerId = firstRow(rows, 'seeded customer').id;

  const walletRows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO customer_wallets (customer_id, type, currency, status)
     VALUES ($1, 'PRIMARY', 'NGN', 'ACTIVE') RETURNING id`,
    [customerId],
  );
  const customerWalletId = firstRow(walletRows, 'seeded customer wallet').id;

  const walletAccountId = randomUUID();
  await dataSource.query(
    `INSERT INTO wallet_accounts (id, customer_id, currency, ledger_account_id, status)
     VALUES ($1, $2, 'NGN', $3, 'ACTIVE')`,
    [walletAccountId, customerId, ledgerAccountId],
  );

  const bindingRows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO customer_financial_account_bindings
       (customer_id, customer_wallet_id, wallet_account_id, ledger_account_id, currency,
        source_customer_version, source_customer_wallet_version, created_by, updated_by,
        accounting_unit, state)
     VALUES ($1, $2, $3, $4, 'NGN', 1, 1, 'integration-harness', 'integration-harness',
             'CUSTOMER_FUNDS', 'ACTIVE') RETURNING id`,
    [customerId, customerWalletId, walletAccountId, ledgerAccountId],
  );

  return {
    customerId,
    customerWalletId,
    walletAccountId,
    bindingId: firstRow(bindingRows, 'seeded binding').id,
    ledgerAccountId,
  };
}
