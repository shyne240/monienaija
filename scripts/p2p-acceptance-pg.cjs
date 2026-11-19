#!/usr/bin/env node
'use strict';
// Acceptance driver, not an application worker. Each invocation gets a fresh archive,
// local config, cluster and namespace. Only the allowlisted result projection leaves it.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'docs/integration/evidence/p2p-parity/pg');
const idPattern = /^[a-z][a-z0-9]{3,15}$/;
const iso = () => new Date().toISOString();
const sha = (data) => createHash('sha256').update(data).digest('hex');
const cmd = (file, args, opts = {}) => execFileSync(file, args, { cwd: root, encoding: 'utf8', ...opts });
function save(file, report) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(report, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
function classify(json, absolute, code, signal) {
  if (!json || json.numTotalTestSuites !== 1 || json.testResults?.length !== 1 ||
      json.testResults[0].name !== absolute) return { status: 'NO_RESULT' };
  const passed = json.numPassedTests, failed = json.numFailedTests;
  const skipped = json.numPendingTests + json.numTodoTests;
  if (![passed, failed, skipped].every(n => Number.isSafeInteger(n) && n >= 0) ||
      passed + failed + skipped !== json.numTotalTests) return { status: 'NO_RESULT' };
  const ok = code === 0 && !signal && json.success === true && json.numPassedTestSuites === 1 &&
    json.testResults[0].status === 'passed' && passed > 0 && !failed && !skipped;
  return { status: ok ? 'PASS' : 'FAIL', passed, failed, skipped };
}
function reusable(report, profile, file) {
  if (JSON.stringify(report.profile) !== JSON.stringify(profile)) throw new Error('Prior source/toolchain/profile differs');
  const s = report.suites[file];
  // Only firsthand, fully reported successes. Never inherit another run's REUSED marker,
  // partial test tallies, suite-teardown failures, pending records or failures.
  return s?.status === 'PASS' && s.exit === 0 && s.signal === null && Number.isSafeInteger(s.passed) &&
    s.passed > 0 && s.failed === 0 && s.skipped === 0;
}
async function main([source, id, ...priorIds]) {
  if (process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER !== 'yes') throw new Error('Explicit disposable cluster confirmation required');
  if (!/^[a-f0-9]{40}$/.test(source) || !idPattern.test(id) || ![...priorIds].every(x => idPattern.test(x))) {
    throw new Error('Usage: PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes node scripts/p2p-acceptance-pg.cjs <full commit> <new run id> [prior run id ...]');
  }
  cmd('git', ['merge-base', '--is-ancestor', source, 'HEAD']);
  fs.mkdirSync(evidence, { recursive: true });
  const reportPath = path.join(evidence, `${id}.json`);
  const prior = priorIds.map(key => {
    const data = JSON.parse(fs.readFileSync(path.join(evidence, `${key}.json`), 'utf8'));
    if (data.id !== key) throw new Error('Wrong prior invocation identity');
    return data;
  });
  const report = { id, source, started: iso(), state: 'SETTING_UP', resumeFrom: priorIds, suites: {} };
  fs.writeFileSync(reportPath, JSON.stringify(report) + '\n', { flag: 'wx' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-parity-pg-'));
  let pg;
  try {
    const archive = path.join(dir, 'source.tar');
    cmd('git', ['archive', '--format=tar', '-o', archive, source]);
    cmd('tar', ['-xf', archive], { cwd: dir });
    fs.unlinkSync(archive);
    cmd('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'ignore' });
    cmd(process.execPath, ['scripts/prepare-pg-test-env.js', '--create-if-missing'], { cwd: dir });
    // No inherited database credentials, provider config, NODE_OPTIONS or existing .env.
    const local = require(path.join(dir, 'node_modules/dotenv')).parse(fs.readFileSync(path.join(dir, '.env')));
    const dataDir = path.join(dir, 'disposable-pg');
    const guard = path.join(dir, 'test/support/mission-25c-network-guard.cjs');
    const env = { ...local, HOME: os.homedir(), PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC',
      NODE_ENV: 'test', PG_TEST_CONFIRM_DISPOSABLE_CLUSTER: 'yes', DB_HOST: '127.0.0.1', PG_TEST_RUN_ID: id,
      NODE_OPTIONS: `--require=${guard}` };
    const loadFromArchive = require('node:module').createRequire(path.join(dir, 'package.json'));
    const EmbeddedPg = loadFromArchive('embedded-postgres').default;
    pg = new EmbeddedPg({ databaseDir: dataDir, port: Number(local.DB_PORT), user: local.DB_USER,
      password: local.DB_PASSWORD, persistent: false, createPostgresUser: false,
      postgresFlags: ['-c', 'listen_addresses=localhost'], onLog() {}, onError() {} });
    await pg.initialise();
    await pg.start(); // A busy port is an error, never fall back to someone else's cluster.
    const client = pg.getPgClient('postgres', env.DB_HOST);
    await client.connect();
    let pgVersion;
    try {
      const { rows: [row] } = await client.query("SELECT current_setting('data_directory') AS dir, current_setting('server_version') AS version");
      if (fs.realpathSync(row.dir) !== fs.realpathSync(dataDir)) throw new Error('Not the new disposable cluster');
      pgVersion = row.version;
    } finally { await client.end(); }
    await pg.createDatabase(local.DB_NAME);
    const args = ['--max-old-space-size=1536', '-r', guard, 'node_modules/jest/bin/jest.js', '--config', 'jest.integration.config.js', '--runInBand'];
    const files = JSON.parse(cmd(process.execPath, [...args, '--listTests', '--json'], { cwd: dir, env }))
      .map(p => path.relative(dir, p)).sort();
    if (!files.length || files.some(p => !/^test\/[\w./-]+\.integration\.spec\.ts$/.test(p)) ||
        new Set(files).size !== files.length) throw new Error('Invalid Jest discovery');
    report.profile = { source, tree: cmd('git', ['rev-parse', `${source}^{tree}`]).trim(),
      inventorySha256: sha(files.join('\n')), runnerSha256: sha(fs.readFileSync(__filename)),
      lockSha256: sha(fs.readFileSync(path.join(dir, 'package-lock.json'))),
      node: process.version, platform: `${process.platform}/${process.arch}`, npm: cmd('npm', ['-v']).trim(), postgres: pgVersion,
      config: 'jest.integration.config.js', guard: path.relative(dir, guard), perProcess: 1, concurrency: 1, heapMiB: 1536 };
    for (const p of files) {
      const previous = prior.find(r => reusable(r, report.profile, p));
      report.suites[p] = previous ? { status: 'REUSED', from: previous.id } : { status: 'PENDING' };
    }
    report.state = 'RUNNING'; save(reportPath, report);
    console.log(`${id}: ${files.length} discovered; frozen ${source}; new disposable cluster verified`);
    for (const [p, state] of Object.entries(report.suites)) {
      if (state.status === 'REUSED') continue;
      report.suites[p] = { status: 'RUNNING', started: iso() }; save(reportPath, report);
      const out = path.join(dir, 'jest-result.json'); fs.rmSync(out, { force: true });
      const log = path.join(dir, path.basename(p) + '.log');
      const fd = fs.openSync(log, 'wx', 0o600);
      let code, signal;
      try {
        const child = spawn(process.execPath, [...args, '--runTestsByPath', p, '--json', '--outputFile', out],
          { cwd: dir, env, stdio: ['ignore', fd, fd] });
        [code, signal] = await once(child, 'close');
      } finally { fs.closeSync(fd); }
      let json; try { json = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* missing or truncated: never PASS */ }
      const result = classify(json, path.join(dir, p), code, signal);
      Object.assign(report.suites[p], result, { exit: code, signal, finished: iso() }); save(reportPath, report);
      console.log(`${id} ${result.status} ${p} (${result.passed ?? '-'} passed)`);
      if (result.status === 'PASS') fs.unlinkSync(log);
      else console.error(`Private diagnostic (not evidence): ${log}`);
    }
    if (Object.values(report.suites).some(s => !['PASS', 'REUSED'].includes(s.status))) {
      report.state = 'FAILED'; process.exitCode = 1;
    } else report.state = Object.values(report.suites).some(s => s.status === 'REUSED') ? 'COMPLETE_WITH_PRIOR_RESULTS' : 'PASSED';
  } catch (e) { report.state = 'ERROR'; throw e; }
  finally {
    try { if (pg) await pg.stop(); }
    catch { report.state = 'CLEANUP_ERROR'; process.exitCode = 1; }
    report.finished = iso(); save(reportPath, report);
    if (['PASSED', 'COMPLETE_WITH_PRIOR_RESULTS'].includes(report.state)) fs.rmSync(dir, { recursive: true });
    else console.error(`Private diagnostic directory: ${dir}`);
  }
}
module.exports = { classify, reusable };
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
