import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
  AUTHORIZATION_FUNCTION_SEED,
  AUTHORIZATION_ROLE_FUNCTION_SEED,
  AUTHORIZATION_ROLE_SEED,
} from '../../src/authorization-catalogue/authorization-catalogue.seed';
import {
  DASHBOARD_TEMPLATE_SEED,
  ROLE_DASHBOARD_ASSIGNMENT_SEED,
} from '../../src/dashboard/dashboard-templates.seed';

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

function migrationTemplateDatabaseName(): string {
  // Scoped to this process id, matching integrationDatabaseName's scheme. Under the required
  // `--runInBand` execution model every suite in a run shares one process, so this is built
  // at most once per run and reused by every suite in it; a different run (different pid)
  // always builds its own. See test/support/pg-template-sweep.js for the matching cleanup.
  return `mn_it_tpl_${process.pid}`;
}

async function templateDatabaseExists(ds: DataSource, name: string): Promise<boolean> {
  const rows: Array<{ exists: boolean }> = await ds.query(
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
    [name],
  );
  return firstRow(rows, 'template database existence check').exists;
}

/**
 * Ensures a fully-migrated template database exists for this test process, building it once
 * (the real, complete migration chain run against a genuinely empty database — identical to
 * what createIntegrationDataSourceFromScratch does) and reusing it for the rest of the run.
 *
 * Measured in this repo: a from-scratch create+migrate costs ~930-1050ms per suite; cloning
 * this template via `CREATE DATABASE ... TEMPLATE` costs ~55-90ms. Every suite that only
 * needs a correctly-migrated, empty-of-data schema to test application behaviour against
 * (which is nearly all of them) gets the exact same schema much faster. This is not a
 * behavioural shortcut: the schema is bit-for-bit what the full migration chain produces,
 * because it IS that exact migration run, filesystem-cloned by PostgreSQL itself.
 *
 * Suites whose entire purpose is proving the real migration chain succeeds end-to-end against
 * a genuinely empty database (migration-chain.integration.spec.ts,
 * v1-release-01-production-readiness-migration-sync.integration.spec.ts) must not go through
 * this path — they use createEmptyIntegrationDataSource / createIntegrationDataSourceFromScratch
 * instead, so that coverage of the migration chain itself is never short-circuited.
 */
async function ensureMigrationTemplateDatabase(): Promise<string> {
  const name = migrationTemplateDatabaseName();
  await withAdmin(async (ds) => {
    if (await templateDatabaseExists(ds, name)) return;
    await ds.query(`CREATE DATABASE "${name}"`);
    const template = buildIntegrationDataSource(name);
    await template.initialize();
    try {
      await template.runMigrations({ transaction: 'all' });
    } finally {
      await template.destroy();
    }
  });
  return name;
}

/**
 * Creates a dedicated database for the suite, pre-populated with the full, real migration
 * chain, by cloning a once-built template database (see `ensureMigrationTemplateDatabase`).
 * The returned DataSource uses the same entity and migration registration as production, and
 * the resulting schema is identical to running the full migration chain fresh — it is simply
 * built once per test run and cloned, rather than re-run from scratch for every suite.
 */
export async function createIntegrationDataSource(label: string): Promise<DataSource> {
  await assertPostgresAvailable();
  const templateName = await ensureMigrationTemplateDatabase();
  const name = integrationDatabaseName(label);
  await withAdmin(async (ds) => {
    await ds.query(`DROP DATABASE IF EXISTS "${name}"`);
    await ds.query(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`);
  });
  const dataSource = buildIntegrationDataSource(name);
  await dataSource.initialize();
  return dataSource;
}

/**
 * Identical to createIntegrationDataSource before the template-clone optimization: creates a
 * genuinely empty database and runs the complete migration chain against it from scratch.
 * Reserved for suites whose entire purpose is proving the real migration chain itself
 * succeeds end-to-end against an empty database. Everything else should use
 * createIntegrationDataSource, which clones a once-built template for speed while producing
 * the identical schema.
 */
export async function createIntegrationDataSourceFromScratch(label: string): Promise<DataSource> {
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
  // V1-ADMIN-AUTHORIZATION-HARDENING-01: `authorization_functions`/`authorization_roles`/
  // `authorization_role_functions` are bootstrap REFERENCE/governance data (seeded exactly once
  // by AuthorizationCatalogueSeedService.onApplicationBootstrap() when the Nest app under test
  // is created), not test-authored business rows — conceptually closer to `typeorm_migrations`
  // (excluded above) than to a table a test expects to start empty. Before this task nothing in
  // the live runtime actually depended on this data surviving a mid-suite TRUNCATE (the two
  // pre-existing `requiredFunctions` call sites — FINANCE_ROLE_ASSIGN/REVOKE — are exercised by
  // suites that provision their own role assignments per-test and happened not to hit this
  // gap), so the gap was latent. This task wires `requiredFunctions` into several more
  // `AuthorizationService.requireFunction()` call sites reached via real, non-mocked workforce
  // sessions (e.g. the real local-admin SUPER_ADMIN login in
  // test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts), which DOES
  // depend on this data surviving every `beforeEach(truncateAllTables)` call, not just the
  // one-time bootstrap seed — so the catalogue is restored here, every time, to the exact
  // reference data `AuthorizationCatalogueSeedService` would (idempotently) converge on anyway.
  // Suites that specifically want to test the seeder/catalogue's own empty-table behavior use
  // `AuthorizationCatalogueSeedService.reseed()` directly (truncate-then-seed in one call) and
  // are unaffected by this — they do not rely on `truncateAllTables` leaving the catalogue empty.
  await reseedAuthorizationCatalogue(dataSource);
  // V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01: identical rationale — `dashboard_templates`/
  // `role_dashboard_assignments` are bootstrap reference data seeded once by
  // `DashboardSeedService.onApplicationBootstrap()`, and suites that exercise `/my-dashboard`,
  // `/widgets/:widgetKey`, or the dashboard settings endpoints via a real, non-mocked app need it
  // to survive every `beforeEach(truncateAllTables)` call, not just the first test.
  await reseedDashboardPlatform(dataSource);
}

/**
 * Re-inserts the `authorization_functions`/`authorization_roles`/`authorization_role_functions`
 * bootstrap reference data directly via the DataSource (no NestJS DI/app context required),
 * mirroring AuthorizationCatalogueSeedService's insert logic exactly against the same exported
 * seed arrays it uses. Safe to call against already-empty (just-truncated) catalogue tables.
 */
async function reseedAuthorizationCatalogue(dataSource: DataSource): Promise<void> {
  const tableCheck: Array<{ exists: boolean }> = await dataSource.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'authorization_functions') AS exists`,
  );
  if (!tableCheck[0]?.exists) return; // migration not present in this suite's schema — nothing to do

  const now = new Date();
  for (const item of AUTHORIZATION_FUNCTION_SEED) {
    await dataSource.query(
      `INSERT INTO authorization_functions
         (function_code, domain, name, description, sensitivity, v1_status, assignable,
          finance_class_restricted, maker_checker_required, approval_required,
          super_admin_excluded, auditor_visible, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       ON CONFLICT (function_code) DO NOTHING`,
      [
        item.functionCode,
        item.domain,
        item.name,
        item.description,
        item.sensitivity,
        item.v1Status,
        item.assignable,
        item.financeClassRestricted ?? false,
        item.makerCheckerRequired ?? false,
        item.approvalRequired ?? false,
        item.superAdminExcluded ?? false,
        item.auditorVisible ?? true,
        item.notes ?? null,
        now,
      ],
    );
  }

  const roleIdByKey = new Map<string, string>();
  for (const item of AUTHORIZATION_ROLE_SEED) {
    const existing: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM authorization_roles WHERE role_key = $1`,
      [item.roleKey],
    );
    if (existing[0]) {
      roleIdByKey.set(item.roleKey, existing[0].id);
      continue;
    }
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO authorization_roles
         (id, role_key, display_name, description, is_active, is_system_seeded,
          finance_role_class, administrative_capability, read_only, maker_eligible,
          checker_eligible, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,true,true,$5,$6,$7,$8,$9,'SYSTEM_SEED',$10,$10)
       ON CONFLICT (role_key) DO NOTHING`,
      [
        id,
        item.roleKey,
        item.displayName,
        item.description,
        item.financeRoleClass ?? false,
        item.administrativeCapability ?? false,
        item.readOnly ?? false,
        item.makerEligible ?? false,
        item.checkerEligible ?? false,
        now,
      ],
    );
    roleIdByKey.set(item.roleKey, id);
  }

  for (const item of AUTHORIZATION_ROLE_FUNCTION_SEED) {
    const roleId = roleIdByKey.get(item.roleKey);
    if (!roleId) continue;
    await dataSource.query(
      `INSERT INTO authorization_role_functions
         (id, role_id, function_code, access_type, is_active, assigned_by, assigned_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,true,'SYSTEM_SEED',$5,$5,$5)
       ON CONFLICT DO NOTHING`,
      [randomUUID(), roleId, item.functionCode, item.accessType, now],
    );
  }
}

/**
 * Re-inserts the `dashboard_templates`/`role_dashboard_assignments` bootstrap reference data
 * directly via the DataSource, mirroring `DashboardSeedService`'s insert-missing-only logic
 * against the same exported seed arrays it uses. Safe to call against already-empty
 * (just-truncated) tables, and a no-op if the migration hasn't run in this suite's schema.
 */
async function reseedDashboardPlatform(dataSource: DataSource): Promise<void> {
  const tableCheck: Array<{ exists: boolean }> = await dataSource.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dashboard_templates') AS exists`,
  );
  if (!tableCheck[0]?.exists) return;

  const now = new Date();
  for (const item of DASHBOARD_TEMPLATE_SEED) {
    await dataSource.query(
      `INSERT INTO dashboard_templates
         (template_key, display_name, description, operational_area, layout, is_active, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,NULL,$6,$6)
       ON CONFLICT (template_key) DO NOTHING`,
      [item.templateKey, item.displayName, item.description, item.operationalArea, JSON.stringify({ widgets: item.widgets }), now],
    );
  }
  for (const item of ROLE_DASHBOARD_ASSIGNMENT_SEED) {
    await dataSource.query(
      `INSERT INTO role_dashboard_assignments
         (role_key, template_key, assigned_by, assigned_at, reason, created_at, updated_at)
       VALUES ($1,$2,'SYSTEM_SEED',$3,$4,$3,$3)
       ON CONFLICT (role_key) DO NOTHING`,
      [item.roleKey, item.templateKey, now, item.reason],
    );
  }
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
