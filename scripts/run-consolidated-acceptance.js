#!/usr/bin/env node
/**
 * ARENA 3D Group 36 — run the consolidated acceptance matrix.
 *
 * Executes the checks that can be executed here, reads the artefacts the earlier groups recorded,
 * and marks the rest `UNAVAILABLE` with the reason. Writes
 * `docs/integration/evidence/consolidated/consolidated-run.json`.
 *
 * It refuses to run on a dirty tree. Evidence produced alongside half-written files is evidence of
 * a state that never existed; the artefact records the commit it describes, and the suite checks
 * that commit is an ancestor of HEAD.
 *
 * Usage (on a clean tree):
 *   node scripts/run-consolidated-acceptance.js [--skip-suite]
 */

'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

require('ts-node/register/transpile-only');

const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs/integration/evidence/consolidated');

const {
  CONSOLIDATED_MATRIX,
  NOT_CLAIMED,
  evaluateConsolidatedMatrix,
} = require(join(ROOT, 'src/acceptance/consolidated-matrix.ts'));
const { evaluateRepositoryCiGates } = require(join(ROOT, 'src/deployment/ci-gate.service.ts'));
const { evaluateRepositoryReleaseGate } = require(join(ROOT, 'src/readiness/release-gate.service.ts'));
const {
  evaluateRepositoryMobileRelease,
} = require(join(ROOT, 'src/mobile/mobile-release-readiness.service.ts'));

function sh(command, args) {
  return spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function tail(text, limit = 300) {
  const trimmed = String(text ?? '').trim();
  return trimmed.length > limit ? `…${trimmed.slice(-limit)}` : trimmed;
}

const entries = [];
const record = (id, status, detail) => {
  entries.push({ id, status, detail });
  console.log(`${status.padEnd(11)} ${id} — ${detail.slice(0, 150)}`);
};

function readJson(relative) {
  const path = join(ROOT, relative);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const skipSuite = process.argv.includes('--skip-suite');

  const status = sh('git', ['status', '--porcelain']).stdout.trim();
  const commit = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  const cleanTree = status === '';
  if (!cleanTree) {
    console.error('refusing to run on a dirty tree:\n' + status);
    process.exit(2);
  }
  console.log(`commit ${commit}, clean tree\n`);

  // --- executed here -------------------------------------------------------

  const tsc = sh('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json']);
  record(
    'typescript',
    tsc.status === 0 ? 'PASS' : 'FAIL',
    tsc.status === 0 ? 'tsc --noEmit clean' : tail(tsc.stdout),
  );

  const lint = sh('npm', ['run', 'lint']);
  const lintErrors = /(\d+) problems? \((\d+) errors?/.exec(String(lint.stdout ?? ''));
  record(
    'lint',
    lint.status === 0 ? 'PASS' : 'FAIL',
    lint.status === 0
      ? `eslint src and test clean (${lintErrors ? `${lintErrors[2]} errors` : 'exit 0'})`
      : tail(lint.stdout),
  );

  const format = sh('npm', ['run', 'format:check']);
  record(
    'format',
    format.status === 0 ? 'PASS' : 'FAIL',
    format.status === 0 ? 'prettier clean' : tail(format.stdout),
  );

  if (skipSuite) {
    record('unit-suite', 'MISSING', '--skip-suite was passed');
  } else {
    const suite = sh('npx', ['jest', '--config', 'jest.config.js']);
    const tests = /Tests:\s+(\d+) passed, (\d+) total/.exec(String(suite.stdout ?? ''));
    const suites = /Test Suites:\s+(\d+) passed, (\d+) total/.exec(String(suite.stdout ?? ''));
    record(
      'unit-suite',
      suite.status === 0 ? 'PASS' : 'FAIL',
      suite.status === 0
        ? `${tests ? tests[1] : '?'} tests in ${suites ? suites[1] : '?'} suites`
        : tail(suite.stdout),
    );
  }

  const ci = evaluateRepositoryCiGates(ROOT);
  record(
    'ci-gates',
    ci.verdict === 'PASS' ? 'PASS' : 'FAIL',
    ci.verdict === 'PASS'
      ? `${ci.checks.length} required jobs and scripts intact`
      : `missing: ${ci.missing.join(', ')}`,
  );

  const mobile = evaluateRepositoryMobileRelease(ROOT);
  const mobileErrors = mobile.findings.filter((finding) => finding.verdict === 'ERROR');
  const mobileWarnings = mobile.findings.filter((finding) => finding.verdict === 'WARNING');
  record(
    'mobile-manifests',
    mobileErrors.length === 0 ? 'PASS' : 'FAIL',
    mobileErrors.length === 0
      ? `${mobile.findings.length} checks, ${mobileWarnings.length} warning(s), 0 error`
      : mobileErrors.map((finding) => finding.check).join(', '),
  );

  const release = evaluateRepositoryReleaseGate(ROOT);
  record(
    'release-gate',
    release.verdict === 'READY' ? 'PASS' : 'NOT_READY',
    `${release.blockers.length} blocker(s), ${release.conditions.length} condition(s)`,
  );

  // --- recorded by earlier groups -----------------------------------------

  const journeys = readJson('docs/integration/evidence/journeys/journey-results.json');
  record(
    'journeys',
    journeys === null ? 'MISSING' : journeys.summary.failed === 0 && journeys.summary.notRun === 0 ? 'PASS' : 'FAIL',
    journeys === null
      ? 'no journey run recorded'
      : `${journeys.summary.passed}/${journeys.summary.journeys} journeys, ${journeys.summary.tests} tests, recorded ${journeys.generatedAt}`,
  );

  const browser = readJson('docs/integration/evidence/browser-acceptance/browser-acceptance.json');
  record(
    'browser',
    browser === null ? 'MISSING' : browser.summary.failed === 0 ? 'PASS' : 'FAIL',
    browser === null
      ? 'no browser run recorded'
      : `${browser.summary.passed}/${browser.summary.total} checks in ${browser.browser.engine} ${browser.browser.version}, recorded ${browser.generatedAt}`,
  );

  const documentary = [
    ['postgres-inventory', 'src/deployment/postgres-acceptance.service.ts'],
    ['privacy-retention', 'docs/integration/PRIVACY-AND-RETENTION.md'],
    ['performance', 'docs/integration/PERFORMANCE-ACCEPTANCE.md'],
    ['startup-gate', 'docs/integration/SANDBOX-INTEGRATION-READINESS.md'],
  ];
  for (const [id, path] of documentary) {
    const present = existsSync(join(ROOT, path));
    record(
      id,
      present ? 'PASS' : 'MISSING',
      present ? `recorded at ${path}` : `missing: ${path}`,
    );
  }

  // --- never possible here -------------------------------------------------

  for (const requirement of CONSOLIDATED_MATRIX) {
    if (requirement.kind !== 'unavailable') continue;
    record(requirement.id, 'UNAVAILABLE', requirement.evidence);
  }

  const evaluated = evaluateConsolidatedMatrix(CONSOLIDATED_MATRIX, entries);
  const report = {
    generatedAt: new Date().toISOString(),
    commit,
    cleanTree,
    rows: evaluated.rows,
    summary: evaluated.summary,
    releaseVerdict: release.verdict,
    notClaimed: [...NOT_CLAIMED],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'consolidated-run.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `\n${String(evaluated.summary.requirements)} requirements: ` +
      `${String(evaluated.summary.executed)} executed, ${String(evaluated.summary.recorded)} recorded, ` +
      `${String(evaluated.summary.unavailable)} unavailable, ${String(evaluated.summary.failing)} failing`,
  );
  console.log(`release verdict: ${release.verdict}`);
  process.exit(evaluated.summary.failing === 0 ? 0 : 1);
}

main();
