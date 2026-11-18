#!/usr/bin/env node
/**
 * ARENA 3D Group 35 — run the ten platform journeys and record what happened.
 *
 * Reads the journey registry (`src/acceptance/platform-journeys.ts`), executes the integration
 * suites each journey names against a real PostgreSQL cluster, and writes
 * `docs/integration/evidence/journeys/journey-results.json`.
 *
 * It refuses to invent a cluster. `PG_TEST_RUN_ID`, `PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes` and
 * the `DB_*` connection variables must be supplied by the caller: this script will not guess a
 * host, will not default a password, and will not run against whatever happens to be listening.
 *
 * Suites run in batches, each its own Jest process — the same memory argument as
 * `run-pg-integration-tests.js`: a single long-lived process accumulates heap across ts-jest
 * compilations and Nest DI graphs until it is killed.
 *
 * Usage:
 *   PG_TEST_RUN_ID=g35 PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
 *   DB_HOST=127.0.0.1 DB_PORT=5461 DB_USER=... DB_PASSWORD=... \
 *   node scripts/run-journey-acceptance.js [--batch-size 3] [--only A,C]
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

require('ts-node/register/transpile-only');

const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs/integration/evidence/journeys');
const CONFIG = 'jest.integration.config.js';

const { PLATFORM_JOURNEYS, evaluateJourneyResults, summariseJourneys } = require(
  join(ROOT, 'src/acceptance/platform-journeys.ts'),
);

function parseArgs(argv) {
  const args = { batchSize: 3, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--batch-size') args.batchSize = Number(argv[i + 1]);
    if (argv[i] === '--only') args.only = argv[i + 1].split(',').map((id) => id.trim());
  }
  return args;
}

function requireEnvironment() {
  const missing = [];
  if (!process.env.PG_TEST_RUN_ID) missing.push('PG_TEST_RUN_ID');
  if (process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER !== 'yes') {
    missing.push('PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes');
  }
  for (const name of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD']) {
    if (!process.env[name]) missing.push(name);
  }
  if (missing.length > 0) {
    console.error(
      `refusing to run: ${missing.join(', ')} must be set. This script will not guess a cluster.`,
    );
    process.exit(2);
  }
}

/** Runs one batch of suites in its own Jest process and returns its JSON result. */
function runBatch(files, index) {
  const outputFile = join(tmpdir(), `journey-batch-${String(index)}-${String(process.pid)}.json`);
  const result = spawnSync(
    'npx',
    ['jest', '-c', CONFIG, '--runInBand', '--json', `--outputFile=${outputFile}`, ...files],
    { cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 },
  );

  let parsed = null;
  if (existsSync(outputFile)) {
    try {
      parsed = JSON.parse(readFileSync(outputFile, 'utf8'));
    } catch {
      parsed = null;
    }
    rmSync(outputFile, { force: true });
  }

  return { parsed, status: result.status, stderrTail: (result.stderr ?? '').slice(-400) };
}

function main() {
  requireEnvironment();
  const args = parseArgs(process.argv.slice(2));

  const journeys =
    args.only === null
      ? PLATFORM_JOURNEYS
      : PLATFORM_JOURNEYS.filter((journey) => args.only.includes(journey.id));

  const allFiles = [...new Set(journeys.flatMap((journey) => journey.suites))];
  const missingFiles = allFiles.filter((file) => !existsSync(join(ROOT, file)));
  const runnable = allFiles.filter((file) => !missingFiles.includes(file));

  console.log(
    `${String(journeys.length)} journey(s), ${String(allFiles.length)} suite(s), ` +
      `${String(missingFiles.length)} missing file(s), batch size ${String(args.batchSize)}`,
  );

  const outcomes = [];
  let batchIndex = 0;
  for (let start = 0; start < runnable.length; start += args.batchSize) {
    const batch = runnable.slice(start, start + args.batchSize);
    batchIndex += 1;
    console.log(`\n--- batch ${String(batchIndex)} (${String(batch.length)} suite(s))`);
    const { parsed, status, stderrTail } = runBatch(batch, batchIndex);

    const results = parsed?.testResults ?? [];
    const seen = new Set();

    for (const suite of results) {
      const file = String(suite.name ?? '').replace(`${ROOT}/`, '');
      if (!file) continue;
      seen.add(file);

      /*
       * Jest's per-file JSON carries `assertionResults`, not the aggregate counters that only exist
       * at the top level. Counting the assertions is also stricter: a suite whose status is
       * "failed" but which recorded no failed assertion is a suite that did not execute (compile
       * error, harness abort), and it must never be reported as a pass.
       */
      const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
      const failures = assertions.filter((assertion) => assertion.status === 'failed').length;
      const executed = assertions.length;
      /*
       * Jest's own per-file status is authoritative: it is "failed" both when an assertion failed
       * and when the suite could not run (compile error, harness abort, teardown throw). The
       * message field is NOT used as a signal — a suite that logs to stderr has a non-empty
       * message and is still green — but it is carried into the detail when the status is bad.
       */
      const suiteFailed = failures > 0 || executed === 0 || suite.status !== 'passed';

      outcomes.push({
        file,
        tests: executed,
        failed: failures,
        durationMs: Math.max(0, Number(suite.endTime ?? 0) - Number(suite.startTime ?? 0)),
        status: suiteFailed ? 'FAIL' : 'PASS',
        detail: suiteFailed
          ? failures > 0
            ? `${String(failures)} of ${String(executed)} test(s) failed`
            : `the suite did not pass (status ${String(suite.status)}): ${String(
                suite.message ?? '',
              )
                .trim()
                .slice(0, 200)}`
          : undefined,
      });
      console.log(
        `  ${suiteFailed ? 'FAIL' : 'PASS'}  ${file} (${String(executed)} tests, ${String(failures)} failing)`,
      );
    }

    // A suite that produced no JSON at all (compile error, crash, OOM) is reported, never skipped.
    for (const file of batch) {
      if (!seen.has(file)) {
        outcomes.push({
          file,
          tests: 0,
          failed: 0,
          durationMs: 0,
          status: 'FAIL',
          detail: `the batch produced no result for this suite (jest exit ${String(status)}): ${stderrTail}`,
        });
        console.log(`  NORUN ${file} (jest exit ${String(status)})`);
      }
    }
  }

  const results = evaluateJourneyResults(journeys, outcomes, missingFiles);
  const summary = summariseJourneys(results);

  const report = {
    generatedAt: new Date().toISOString(),
    command:
      'node scripts/run-journey-acceptance.js (jest -c jest.integration.config.js --runInBand)',
    database: {
      host: String(process.env.DB_HOST),
      port: Number(process.env.DB_PORT),
      disposableCluster: true,
    },
    journeys: results,
    summary,
    notPerformed: [
      'no provider was contacted: every provider interaction is a controlled fixture',
      'no real money moved: every amount is a test fixture in a disposable database',
      'no browser, mobile app or device took part — these are API and service-layer journeys',
      'no deployment exists behind them, and none was created',
      'the suites were run, not re-read: this report is the result of executing them',
    ],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'journey-results.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `\njourneys: ${String(summary.passed)}/${String(summary.journeys)} passed, ` +
      `${String(summary.failed)} failed, ${String(summary.notRun)} not run, ${String(summary.tests)} tests`,
  );
  for (const journey of results) {
    console.log(
      `  ${journey.verdict.padEnd(7)} ${journey.id}  ${journey.title} — ${String(journey.tests)} tests`,
    );
  }

  process.exit(summary.failed === 0 && summary.notRun === 0 ? 0 : 1);
}

main();
