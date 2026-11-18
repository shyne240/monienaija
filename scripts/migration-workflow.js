#!/usr/bin/env node
/**
 * ARENA 3D Group 11 — migration workflow: locking, inventory, and safe recovery.
 *
 * ## The failure this prevents
 *
 * `docker-compose.yml` runs a one-shot `migrate` job before the backend. In a real deployment that job
 * is a *release step*, and release steps get run twice: a retried CI job, a second replica racing the
 * first, an operator re-running a failed deploy. TypeORM takes no lock across a migration run, so two
 * concurrent runners can both read the same set of unapplied migrations and both try to apply them. Each
 * individual migration runs in a transaction, so the second runner usually fails on a duplicate table —
 * leaving `typeorm_migrations` recording a partial truth and an operator unsure whether to retry, roll
 * forward, or restore.
 *
 * This script takes a PostgreSQL advisory lock for the whole run, so a second runner waits or exits
 * instead of interleaving. That is the entire point: **one migration run at a time, per database.**
 *
 * ## Why there is no `migration:revert`
 *
 * TypeORM offers `migration:revert`, and 126 of 152 migrations implement `down()`. Running it in
 * production would be a mistake, and this script deliberately provides no way to do it:
 *
 *  - `down()` here is not a data-safe inverse. Several migrations seed ledger accounts, governance
 *    roles and protected-authority structures that other rows now reference. `down()` deletes them,
 *    which fails on a foreign key at best and destroys financial evidence at worst.
 *  - A revert is a schema change without a data plan. The data that exists after a migration is usually
 *    not the data that existed before it — that is what the migration was for. Rolling the schema back
 *    under data that already moved produces a database that satisfies neither shape.
 *  - The mission forbids destructive rollback, and "the tool exists but you shouldn't use it" is not a
 *    safeguard. A command an operator can run under pressure at 3am is a command that will be run.
 *
 * Recovery is therefore roll-**forward**: fix or add a migration, then apply it. If a release must be
 * undone, the application is rolled back to a build that tolerates the newer schema — which is what the
 * expand/contract discipline in `docs/integration/MIGRATION-WORKFLOW.md` exists to make possible.
 *
 * ## Usage
 *
 *   node scripts/migration-workflow.js status        # inventory + applied + pending, no changes
 *   node scripts/migration-workflow.js apply         # take the lock, then migrate:run
 *   node scripts/migration-workflow.js verify        # assert every repository migration is applied
 *
 * Exit codes: 0 success, 1 verification failure, 2 lock unavailable, 3 usage.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const REPO_ROOT = path.join(__dirname, '..');
const MIGRATION_DIR = path.join(REPO_ROOT, 'src', 'migrations');

/**
 * Advisory lock key. A fixed 64-bit literal rather than `hashtext(...)` so the key is stable across
 * PostgreSQL versions and obvious to anyone reading `pg_locks`. The two-character prefix identifies the
 * purpose; the remainder is arbitrary but must never change.
 */
const MIGRATION_LOCK_KEY = 7_348_120_945_001_337n;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function connectionConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'postgres',
  };
}

/** Repository migrations, in the order TypeORM will apply them (ascending timestamp). */
function repositoryMigrations() {
  return fs
    .readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => {
      const base = file.replace(/\.ts$/, '');
      const separator = base.indexOf('-');
      return { timestamp: base.slice(0, separator), name: base.slice(separator + 1), file };
    })
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

async function appliedMigrations(client) {
  const exists = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name='typeorm_migrations'`,
  );
  if (exists.rows.length === 0) return null;
  const { rows } = await client.query(
    `SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp`,
  );
  return rows;
}

/**
 * The inventory report.
 *
 * `pending` is computed by timestamp, not by name: TypeORM's own `migrations` table stores a timestamp
 * and a name, and a migration whose file was renamed would otherwise look unapplied forever. Comparing
 * timestamps is the same key TypeORM uses to decide what to run.
 */
async function status(client) {
  const repository = repositoryMigrations();
  const applied = await appliedMigrations(client);

  if (applied === null) {
    log('typeorm_migrations: absent (database has never been migrated)');
    log(`repository migrations: ${repository.length}, all pending`);
    return { repository, applied: null, pending: repository, missingFromRepository: [] };
  }

  const appliedTimestamps = new Set(applied.map((row) => row.timestamp));
  const repositoryTimestamps = new Set(repository.map((m) => m.timestamp));
  const pending = repository.filter((m) => !appliedTimestamps.has(m.timestamp));
  // The dangerous direction: the database knows about a migration the repository does not contain. That
  // means the deployed code is older than the schema, and running it can write data the new schema no
  // longer accepts. Reported separately rather than folded into a count.
  const missingFromRepository = applied.filter((row) => !repositoryTimestamps.has(row.timestamp));

  log(`repository migrations : ${repository.length}`);
  log(`applied               : ${applied.length}`);
  log(`pending               : ${pending.length}`);
  if (pending.length > 0) {
    for (const migration of pending) log(`  pending  ${migration.timestamp} ${migration.name}`);
  }
  if (missingFromRepository.length > 0) {
    log(`applied but not in this repository: ${missingFromRepository.length}`);
    for (const row of missingFromRepository) log(`  ORPHAN   ${row.timestamp} ${row.name}`);
    log(
      '  This database is AHEAD of the code. Deploying this build may write data the schema rejects.',
    );
  }
  if (pending.length === 0 && missingFromRepository.length === 0) {
    log('schema is exactly in sync with the repository');
  }
  return { repository, applied, pending, missingFromRepository };
}

/**
 * Runs the migration chain while holding the advisory lock.
 *
 * `--no-wait` turns contention into a non-zero exit so a CI job fails fast instead of queueing behind a
 * hung deploy. Waiting is the default because a release that waits for the in-flight migration to finish
 * is usually the correct behaviour; a release that hangs forever is not, so the wait is bounded.
 */
async function apply({ noWait = false, waitSeconds = 300 } = {}) {
  const client = new Client(connectionConfig());
  await client.connect();
  let locked = false;
  try {
    if (noWait) {
      const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        MIGRATION_LOCK_KEY.toString(),
      ]);
      locked = rows[0].acquired;
    } else {
      // `statement_timeout` bounds the wait. A migration run that cannot start within the window means
      // another release is in progress or hung, and either way a human should look.
      await client.query(`SET statement_timeout = ${Number(waitSeconds) * 1000}`);
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY.toString()]);
      locked = true;
    }

    if (!locked) {
      const { rows } = await client.query(
        `SELECT pid, usename, application_name, state, left(query, 120) AS query
           FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND state <> 'idle'`,
      );
      log('another migration run holds the lock; refusing to interleave');
      for (const row of rows) {
        log(`  pid=${row.pid} user=${row.usename} state=${row.state} query=${row.query}`);
      }
      return 2;
    }

    log('advisory lock acquired — this is the only migration runner for this database');
    const before = await status(client);

    execFileSync(
      'npx',
      [
        'ts-node',
        '--transpile-only',
        'node_modules/typeorm/cli.js',
        'migration:run',
        '-d',
        'src/config/data-source.ts',
      ],
      { cwd: REPO_ROOT, stdio: 'inherit', env: process.env },
    );

    const after = await status(client);
    const newlyApplied = before.pending.length;
    log(`migrated: ${newlyApplied} migration(s) applied`);

    if (after.pending.length > 0) {
      log(`REFUSING to report success: ${after.pending.length} migration(s) still pending`);
      return 1;
    }
    return 0;
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY.toString()])
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

/** Asserts the schema matches the repository exactly. Intended for a release gate, not a deploy step. */
async function verify() {
  const client = new Client(connectionConfig());
  await client.connect();
  try {
    const report = await status(client);
    if (report.applied === null) {
      log('VERIFY FAILED: no migrations have been applied');
      return 1;
    }
    if (report.pending.length > 0) {
      log(`VERIFY FAILED: ${report.pending.length} migration(s) pending`);
      return 1;
    }
    if (report.missingFromRepository.length > 0) {
      log(
        `VERIFY FAILED: database contains ${report.missingFromRepository.length} migration(s) absent from this repository`,
      );
      return 1;
    }
    log('VERIFY OK: applied migrations match the repository exactly');
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'status') {
    const client = new Client(connectionConfig());
    await client.connect();
    try {
      await status(client);
      return 0;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  if (command === 'apply') {
    return apply({
      noWait: process.argv.includes('--no-wait'),
      waitSeconds: Number(
        (process.argv.find((a) => a.startsWith('--wait-seconds=')) || '').split('=')[1] || 300,
      ),
    });
  }
  if (command === 'verify') return verify();

  process.stderr.write(
    'usage: node scripts/migration-workflow.js <status|apply|verify> [--no-wait] [--wait-seconds=N]\n' +
      'There is no revert command by design; see the file header and docs/integration/MIGRATION-WORKFLOW.md\n',
  );
  return 3;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`migration workflow error: ${error.message}\n`);
    process.exitCode = 1;
  });
