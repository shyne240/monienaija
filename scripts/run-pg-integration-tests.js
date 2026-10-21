#!/usr/bin/env node
'use strict';

/**
 * Runs the real-PostgreSQL integration suite (`test/*.integration.spec.ts`) in sequential
 * batches, each a fresh `node`/Jest process, instead of one single `jest --runInBand`
 * invocation covering all ~89 files.
 *
 * Why: measured in this repo, a single long-lived `jest --runInBand` process running every
 * integration suite back-to-back accumulates JS heap across files (ts-jest/TypeScript
 * compilation artifacts, decorator metadata, and each suite's own NestJS DI container/entity
 * schema do not appear to be released between files within one process) — heap climbed from
 * ~720MB to ~1.4GB over just the first ~19 of 89 files in this environment, and a full run
 * reliably crashed with `JavaScript heap out of memory` partway through, even after raising
 * `--max-old-space-size` to 3072MB. This is a pre-existing characteristic of running the
 * whole suite in one process (reproduced identically on the unmodified, pre-optimization
 * harness too) — not something introduced by the migration-template optimization in
 * test/support/pg-harness.ts.
 *
 * Splitting into batches, each its own OS process, means the OS fully reclaims memory between
 * batches — no change to test semantics, isolation, or ordering guarantees: every suite still
 * runs with `--runInBand` (strictly serial within and across batches — batches run one after
 * another, never concurrently), the real PostgreSQL harness, and its own dedicated database.
 * Each batch independently builds its own once-per-process migration template (see
 * `ensureMigrationTemplateDatabase` in test/support/pg-harness.ts) and cleans it up via the
 * same globalSetup/globalTeardown hook, so correctness and cleanup are unaffected — a run with
 * N batches just pays that ~1-1.5s template build N times instead of once, which is trivial
 * next to the per-suite savings the template itself provides.
 *
 * All batches always run (a failing batch does not stop later batches), matching the
 * all-failures-reported-together behaviour of a single `jest` invocation. The process exits
 * non-zero if any batch failed.
 *
 * Concurrency (PG_TEST_CONCURRENCY, default 2 — see measurements below; set to 1 to fall back
 * to the original fully-sequential behaviour):
 * Each batch is a fully independent Jest process with its own pid-scoped migration template
 * (see migrationTemplateDatabaseName() in test/support/pg-harness.ts) and every suite already
 * gets its own dedicated, uniquely-named database — so running more than one batch's process
 * at the same time is isolation-safe: there is no shared mutable DB state, no fixed ports (the
 * Nest app under test is driven in-process by supertest, it never binds a real TCP port), and
 * no shared on-disk fixtures between batches.
 *
 * Measured in this repo's 2-vCPU/3.8GB sandbox: running two of the lighter batches
 * concurrently (15 + 14 files) finished in ~92s wall-clock versus ~106s run back-to-back
 * sequentially — a real but modest ~13% win, because the box has only 2 CPU cores and the
 * work is a mix of CPU-bound (migrations, PBKDF2/bcrypt hashing, TypeORM metadata) and
 * Postgres-IO-bound work; CPU contention eats most of the theoretical gain. On a machine with
 * more cores (a typical CI runner), the same isolation would be expected to scale better,
 * since the bottleneck here is core count, not a correctness constraint.
 *
 * Default is 2 (V1-TEST-PERFORMANCE-01, this repo's 2-vCPU sandbox). Measured directly,
 * repeated twice for determinism: full 92-file suite at concurrency=1 took 902s (15.03min,
 * 1690/1690 tests passing); at concurrency=2 it took 513s and 477s on two separate runs
 * (8.55min and 7.95min, both 1690/1690 passing, zero flakiness, zero orphaned databases) — a
 * real ~43-47% wall-clock reduction for matching this sandbox's actual core count (2), not an
 * arbitrary oversubscription. Peak resident memory during concurrency=2 runs was observed at
 * ~3.2-3.7GB out of 3.8GB total (tight but stable, no swap, no crash, across both runs).
 *
 * concurrency=4 was separately experimented with (a bounded 11-file / 4-batch subset, not the
 * full suite, specifically to bound the blast radius of the experiment) and reliably drove
 * memory to exhaustion (<150MB available, no forward progress for 25+ seconds) before being
 * deliberately killed — consistent with an identical finding for the root unit suite's Jest
 * workers at maxWorkers=4 on this same hardware. Do not raise PG_TEST_CONCURRENCY above 2 on a
 * sandbox/CI runner with less than ~8GB RAM; on a machine with more cores AND more memory
 * headroom, a higher value may be safe but has not been validated here and must be
 * independently re-measured, not assumed.
 *
 * PG_TEST_MAX_OLD_SPACE_MB is left unchanged (3072, same as the prior concurrency=1 default)
 * when raising PG_TEST_CONCURRENCY — both concurrency=2 validation runs above used exactly this
 * ceiling and passed cleanly. The resident-memory pressure seen in the concurrency=4 experiment
 * was real OS-level memory exhaustion, not a configured per-process heap ceiling being hit, so
 * lowering this value would not have prevented it and is not a substitute for choosing a safe
 * PG_TEST_CONCURRENCY.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const JEST_BIN = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
const CONFIG = path.join(ROOT, 'jest.integration.config.js');
const BATCH_SIZE = Number(process.env.PG_TEST_BATCH_SIZE ?? 15);
// Unchanged from the prior (concurrency=1) default: this exact 3072MB ceiling is what both
// concurrency=2 validation runs actually used, so it is not re-tuned alongside the concurrency
// change below without first re-measuring (see module doc above).
const MAX_OLD_SPACE_MB = Number(process.env.PG_TEST_MAX_OLD_SPACE_MB ?? 3072);
const CONCURRENCY = Math.max(1, Number(process.env.PG_TEST_CONCURRENCY ?? 2));

function listTestFiles() {
  const result = spawnSync(
    process.execPath,
    [JEST_BIN, '--config', CONFIG, '--listTests', ...process.argv.slice(2)],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`Failed to list integration test files (exit ${result.status}).`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function runBatch(files, index, total) {
  process.stdout.write(
    `\n=== PG integration batch ${index + 1}/${total} (${files.length} files) starting ===\n`,
  );
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${MAX_OLD_SPACE_MB}`,
        JEST_BIN,
        '--config',
        CONFIG,
        '--runInBand',
        ...files,
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      process.stdout.write(
        `\n=== PG integration batch ${index + 1}/${total} finished (exit ${code}) ===\n`,
      );
      resolve(code === 0);
    });
  });
}

async function runWithConcurrency(batches, concurrency) {
  const results = new Array(batches.length);
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const i = cursor++;
      results[i] = await runBatch(batches[i], i, batches.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return results;
}

async function main() {
  const files = listTestFiles();
  if (files.length === 0) {
    throw new Error('No integration test files were discovered — the glob may be broken.');
  }
  const batches = chunk(files, BATCH_SIZE);
  const results = await runWithConcurrency(batches, CONCURRENCY);
  const anyFailed = results.some((ok) => !ok);
  process.stdout.write(
    `\n=== PG integration suite: ${batches.length} batch(es), ${files.length} files, concurrency=${CONCURRENCY} — ${
      anyFailed ? 'FAILED' : 'all passed'
    } ===\n`,
  );
  process.exit(anyFailed ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
