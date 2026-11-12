'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEffectiveEnv, validate, run } = require('../scripts/local-preflight.cjs');
const env = () => ({ NODE_ENV: 'development', DB_HOST: 'localhost', DB_NAME: 'synthetic', DB_USER: 'test', DB_PASSWORD: 'not-a-real-secret', LOCAL_DB_CONFIRMED_ISOLATED: 'yes', A5_PILOT_EMERGENCY_STOP: 'true' });

test('shell settings override a synthetic env file without modifying it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-preflight-'));
  try {
    const file = path.join(dir, '.env');
    const content = 'DB_HOST=localhost\nDB_NAME=synthetic\n';
    fs.writeFileSync(file, content);
    assert.equal(loadEffectiveEnv(dir, { DB_NAME: 'from-shell' }).DB_NAME, 'from-shell');
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('valid config preserves credentials privately and uses an explicitly read-only pg session', async () => {
  let seenConfig, query, ended = false;
  class FakeClient {
    constructor(config) { seenConfig = config; }
    async connect() {}
    async query(sql) { query = sql; }
    async end() { ended = true; }
  }
  await run(env(), { ClientClass: FakeClient });
  assert.equal(seenConfig.host, '127.0.0.1');
  assert.equal(seenConfig.password, 'not-a-real-secret');
  assert.equal(seenConfig.options, '-c default_transaction_read_only=on');
  assert.equal(query, 'SELECT 1');
  assert.equal(ended, true);
});

test('rejects non-local, malformed or unsafe configuration before connecting', async () => {
  class NeverClient { constructor() { assert.fail('must not connect'); } }
  const cases = [
    { DB_HOST: 'prod.example' }, { DB_HOST: '/tmp/socket' }, { NODE_ENV: 'production' },
    { DB_PASSWORD: '' }, { DB_PORT: '5432notvalid' }, { DB_SSL: 'maybe' },
    { LOCAL_DB_CONFIRMED_ISOLATED: '' }, { NOTIFICATION_SMS_PROVIDER: 'robase' },
    { NOTIFICATION_EMAIL_PROVIDER: 'managed' }, { A6_PARTNER_ENABLED: 'true' },
    { NOTIFICATION_WORKER_ENABLED: 'true' }, { CASH_TO_CASH_EXPIRY_WORKER_ENABLED: 'true' },
    { POA_UPLOADS_ENABLED: 'true' }, { A5_PILOT_EMERGENCY_STOP: 'false' },
    { API_VERSION: 'v2' },
  ];
  for (const override of cases) await assert.rejects(run({ ...env(), ...override }, { ClientClass: NeverClient }));
  assert.equal(validate({ ...env(), DB_HOST: '::1', DB_SSL: 'true' }).ssl.rejectUnauthorized, true);
});

test('database failures are sanitized, close connections, and expose no secret', async () => {
  let ended = false;
  class FakeClient { async connect() { throw new Error('secret leak sentinel'); } async end() { ended = true; } }
  await assert.rejects(run(env(), { ClientClass: FakeClient }), (error) => !error.message.includes('sentinel'));
  assert.equal(ended, true);
});

test('environment generator refuses implicit creation and all overwrites, including force', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-env-script-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs/deployment/config'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../scripts/prepare-pg-test-env.js'), path.join(dir, 'scripts/prepare-pg-test-env.js'));
    fs.copyFileSync(path.join(__dirname, '../.env.example'), path.join(dir, '.env.example'));
    fs.copyFileSync(path.join(__dirname, '../docs/deployment/config/v1-workforce-bootstrap.env.template'), path.join(dir, 'docs/deployment/config/v1-workforce-bootstrap.env.template'));
    const exec = (...args) => spawnSync(process.execPath, [path.join(dir, 'scripts/prepare-pg-test-env.js'), ...args], { encoding: 'utf8' });
    assert.notEqual(exec().status, 0);
    assert.equal(fs.existsSync(path.join(dir, '.env')), false);
    assert.equal(exec('--create-if-missing').status, 0);
    const target = path.join(dir, '.env');
    fs.writeFileSync(target, 'DO-NOT-OVERWRITE\n');
    assert.notEqual(exec('--force').status, 0);
    assert.notEqual(exec('--create-if-missing').status, 0);
    assert.equal(fs.readFileSync(target, 'utf8'), 'DO-NOT-OVERWRITE\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('backend health probe is loopback-only, bounded, and rejects bad status without following redirects', async () => {
  const http = require('node:http');
  const { EventEmitter } = require('node:events');
  const { checkBackend } = require('../scripts/local-preflight.cjs');
  const original = http.get;
  try {
    let seen;
    http.get = (options, callback) => {
      seen = options;
      const req = new EventEmitter();
      process.nextTick(() => callback({ statusCode: 200, resume() {} }));
      return req;
    };
    await checkBackend(3000);
    assert.deepEqual(seen, { hostname: '127.0.0.1', port: 3000, path: '/api/v1/health', timeout: 3000 });
    http.get = (_options, callback) => {
      const req = new EventEmitter();
      process.nextTick(() => callback({ statusCode: 302, resume() {} }));
      return req;
    };
    await assert.rejects(checkBackend(3000), /HTTP 200/);
  } finally { http.get = original; }
});

test('legacy embedded database helper refuses without approval or over an existing directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-embedded-guard-'));
  try {
    const script = path.join(__dirname, '../scripts/embedded-pg.js');
    const safeEnv = { ...process.env };
    delete safeEnv.EMBEDDED_PG_CONFIRM_DISPOSABLE;
    assert.notEqual(spawnSync(process.execPath, [script], { cwd: dir, env: safeEnv }).status, 0);
    const data = path.join(dir, 'data/embedded-pg');
    assert.equal(fs.existsSync(data), false);
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'do-not-touch'), 'sentinel');
    assert.notEqual(spawnSync(process.execPath, [script], { cwd: dir, env: { ...safeEnv, EMBEDDED_PG_CONFIRM_DISPOSABLE: 'yes' } }).status, 0);
    assert.equal(fs.readFileSync(path.join(data, 'do-not-touch'), 'utf8'), 'sentinel');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('PostgreSQL integration runner refuses before loading configuration or starting tests without confirmation', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/run-pg-integration-tests.js')], {
    cwd: os.tmpdir(), env: { ...process.env, PG_TEST_CONFIRM_DISPOSABLE_CLUSTER: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PG_TEST_CONFIRM_DISPOSABLE_CLUSTER/);
  assert.doesNotMatch(result.stdout, /PG integration batch/);
});
