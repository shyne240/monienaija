/**
 * Jest globalSetup/globalTeardown housekeeping for the real-PostgreSQL migration template
 * that `test/support/pg-harness.ts` builds (see `ensureMigrationTemplateDatabase`).
 *
 * The template is named `mn_it_tpl_<runId>_<pid>` via the SAME `migrationTemplateDatabaseName()`
 * the harness uses (imported below — no duplicated naming logic), so the namespace is identical
 * across every suite and cleanup operation in the run. This script only ever drops the template
 * for *this* Jest process's own pid under *this* run's namespace (asserted before any drop),
 * never a wildcard sweep of other `mn_it_tpl_%` names, so it cannot interfere with a different,
 * concurrently-running integration test invocation — nor with databases from previous runs
 * (e.g. `mn_it_h04unify_20364`).
 *
 * - globalSetup: drops any pre-existing template for this run+pid before any suite runs, so a
 *   template surviving from a previous run that happened to reuse the same OS pid can never
 *   be mistaken for an up-to-date one.
 * - globalTeardown: drops the template this run built, once every suite has finished with it,
 *   so repeated local/dev runs don't accumulate orphaned template databases over time.
 */

import 'dotenv/config';
import { DataSource } from 'typeorm';
import { migrationTemplateDatabaseName } from './pg-harness';
import { assertOwnRunDatabaseName } from './pg-run-namespace';

function adminConfig() {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  return {
    host: host === 'localhost' ? '127.0.0.1' : host,
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'monienaija',
    password: process.env.DB_PASSWORD ?? 'monienaija-pw',
    database: process.env.DB_ADMIN_NAME ?? 'postgres',
  };
}

export default async function dropOwnMigrationTemplateDatabase(): Promise<void> {
  const cfg = adminConfig();
  const ds = new DataSource({
    type: 'postgres',
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [],
    logging: false,
  });
  try {
    await ds.initialize();
  } catch {
    // Best-effort housekeeping only. If PostgreSQL is unreachable, the suites themselves
    // fail loudly via assertPostgresAvailable() — this sweep must not mask that by throwing
    // first, and must not report false coverage either way.
    return;
  }
  try {
    // Name resolution and the namespace guard both fail loudly when PG_TEST_RUN_ID is
    // missing/invalid — the suites fail with the same error, which is the intended loud
    // failure. If the name is somehow outside this run's namespace, skip the drop entirely
    // rather than touching a database this run does not own.
    const name = migrationTemplateDatabaseName();
    assertOwnRunDatabaseName(name);
    await ds.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await ds.query(`DROP DATABASE IF EXISTS "${name}"`);
  } catch (error) {
    // Never drop a database outside this run's namespace. A missing/invalid run identifier is
    // reported by the suites themselves (they fail loudly); housekeeping stays best-effort.
    if (String((error as Error).message).includes('PG_TEST_RUN_ID')) return;
    throw error;
  } finally {
    await ds.destroy().catch(() => undefined);
  }
}
