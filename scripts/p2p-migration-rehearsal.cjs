#!/usr/bin/env node
'use strict';
// Disposable schema-only rehearsal, NOT an application integration or migration command.
// Read blobs out of the frozen 3D commit. No checkout, merge, change to either inventory,
// fake migration marker, rollback of irreversible evidence, or use of a pre-existing DB.
require('../test/support/mission-25c-network-guard.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const three = '6816a760bd460df2a5347016d7d84f5c62cab642';
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
function inventory(ref) {
  const files = new Map();
  for (const line of git('ls-tree', '-r', ref, '--', 'src/migrations').split('\n')) {
    const m = /^\d+ blob ([a-f0-9]{40})\t(src\/migrations\/(\d{13})-(\w+)\.ts)$/.exec(line);
    if (!m) { assert.ok(line.endsWith('/.gitkeep')); continue; }
    assert.ok(!files.has(m[3]), 'duplicate migration timestamp');
    files.set(m[3], { blob: m[1], file: m[2], name: `${m[4]}${m[3]}` });
  }
  return files;
}
async function main() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DB_HOST, '127.0.0.1');
  assert.equal(process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER, 'yes');
  const runId = process.env.PG_TEST_RUN_ID;
  assert.match(runId || '', /^[a-z][a-z0-9]{3,15}$/);
  require('ts-node/register/transpile-only');
  const { createEmptyIntegrationDataSource, destroyIntegrationDataSource, postgresAdminConfig } = require('../test/support/pg-harness');
  const cfg = postgresAdminConfig();
  const client = new (require('pg').Client)({ host: cfg.host, port: cfg.port, user: cfg.username, password: cfg.password, database: cfg.adminDatabase });
  await client.connect();
  let version;
  try {
    const { rows: [server] } = await client.query("SELECT current_setting('data_directory') AS dir, current_setting('server_version') AS version");
    assert.equal(fs.realpathSync(server.dir), fs.realpathSync(path.join(root, 'data/embedded-pg')), 'not the explicitly provisioned disposable test cluster');
    version = server.version;
  } finally { await client.end(); }
  const two = git('rev-parse', 'HEAD');
  const p2p = inventory(two), infra = inventory(three);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-mig-'));
  const result = { id: runId, scope: 'migration classes only', postgres: version,
    p2pMigrationsTree: git('rev-parse', `${two}:src/migrations`), infraCommit: three, cases: [] };
  try {
    const paths2 = [], paths3 = [], union = []; const expected = [];
    for (const t of [...new Set([...p2p.keys(), ...infra.keys()])].sort()) {
      const a = p2p.get(t), b = infra.get(t);
      if (a && b) assert.equal(a.name, b.name, 'conflicting migration identity');
      const local = a && path.join(root, a.file);
      if (a) { assert.equal(git('hash-object', local), a.blob); paths2.push(local); }
      let frozen = local;
      if (b && a?.blob !== b.blob) {
        frozen = path.join(dir, path.basename(b.file));
        fs.writeFileSync(frozen, execFileSync('git', ['cat-file', 'blob', b.blob], {cwd: root}));
      }
      if (b) paths3.push(frozen);
      union.push(b ? frozen : local);
      expected.push({ timestamp: t, name: (b || a).name });
    }
    for (const [from, first] of [['empty', []], ['0614', paths3], ['0802', paths2]]) {
      const db = await createEmptyIntegrationDataSource(`parity_${from}`);
      try {
        let legacyId;
        if (first.length) {
          db.setOptions({ migrations: first }); await db.initialize();
          assert.equal((await db.runMigrations({ transaction: 'all' })).length, first.length);
          // Real pre-upgrade data, not a fabricated applied-migrations table.
          const [c] = await db.query(`INSERT INTO customers(reference,customer_type,status,kyc_level,kyc_status)
            VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`, [randomUUID()]);
          const [row] = await db.query(`INSERT INTO customer_beneficiaries(customer_id,beneficiary_type,display_name,reference,
            destination_identifier,normalized_destination_identifier,status,verified) VALUES($1,'INTERNAL_CUSTOMER','legacy',$2,$2,$2,'ACTIVE',true) RETURNING id`, [c.id,randomUUID()]);
          legacyId = row.id;
          await db.destroy();
        }
        db.setOptions({ migrations: union }); await db.initialize();
        const added = await db.runMigrations({ transaction: 'all' });
        assert.equal(added.length, expected.length-first.length);
        const rows = await db.query(`SELECT timestamp::text,name FROM typeorm_migrations ORDER BY timestamp`);
        assert.deepEqual(rows, expected);
        assert.deepEqual(await db.runMigrations({ transaction:'all' }), []);
        if (legacyId) assert.deepEqual(await db.query(`SELECT wallet_recipient_type,wallet_recipient_id,agent_id FROM customer_beneficiaries WHERE id=$1`, [legacyId]),
          [{wallet_recipient_type:null,wallet_recipient_id:null,agent_id:null}]);
        result.cases.push({ from, firstApplied:first.length, added:added.length, exactIdentityCount:rows.length,
          last:rows.at(-1), pendingAfterReplay:0, legacyUnchanged:legacyId ? true : null });
      } finally { await destroyIntegrationDataSource(db); }
    }
  } finally { fs.rmSync(dir,{recursive:true}); }
  console.log(JSON.stringify(result,null,2));
}
main().catch(err=>{ console.error(err.message);process.exitCode=1; });
