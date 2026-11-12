/**
 * Mission 25P — INDEPENDENT migration 102 upgrade verification.
 *
 * Written from scratch for this mission. Mission 25O's own upgrade suite is run separately; this
 * harness proves the same properties with its own code and its own disposable database:
 *
 *   1. Apply the migration chain ONLY up to migration 101 (a genuine pre-102 schema).
 *   2. Seed legacy governance rows in that pre-102 shape (active configuration + approval + proposal).
 *   3. Apply migration 102 on top (the real upgrade path, not a fresh install).
 *   4. Assert: legacy rows survive, remain unbound (no silent approval/binding), new constraints are
 *      live, malformed metadata is refused, and the destructive rollback guard refuses while rows exist.
 */
const fs = require('node:fs');
const path = require('node:path');

let pass = 0;
let fail = 0;
const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
  if (ok) {
    pass++;
    console.log('PASS  ' + name);
  } else {
    fail++;
    console.log('FAIL  ' + name + ' — ' + JSON.stringify(detail));
  }
}

const DB = 'mn_h07_upgrade';
const MIG = '/home/user/m25p/dist/migrations';

function loadMigrations() {
  return fs
    .readdirSync(MIG)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .flatMap((f) => Object.values(require(path.join(MIG, f))).filter(
      (v) => typeof v === 'function' && v.prototype && v.prototype.up,
    ));
}

(async () => {
  const { Client } = require('pg');
  const { DataSource } = require('typeorm');

  const admin = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.query(`CREATE DATABASE "${DB}"`);
  await admin.end();

  const all = loadMigrations();
  const pre102 = all.filter((m) => (m.name || '').match(/(\d{13})/)?.[1] < '1785753600102' || !/1785753600102/.test(m.name || ''));
  const has102 = all.some((m) => /1785753600102/.test(m.name || ''));
  console.log(`migrations total=${all.length} pre102=${pre102.length} contains102=${has102}`);
  rec('1. migration 102 is present in the chain', has102, null);

  const makeDs = (migrations) =>
    new DataSource({
      type: 'postgres', host: '127.0.0.1', port: 5432, username: 'monienaija', password: 'monienaija-pw',
      database: DB, entities: [], migrations, migrationsTableName: 'typeorm_migrations',
      migrationsRun: false, synchronize: false,
    });

  // ── Step 1: schema at 101 only ──────────────────────────────────────────────
  const ds101 = makeDs(pre102);
  await ds101.initialize();
  await ds101.runMigrations({ transaction: 'all' });
  const at102 = await ds101.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name='notification_provider_configurations' AND column_name='credential_binding_mac'`,
  );
  rec('2. pre-upgrade schema has no binding columns (genuine 101 state)', at102.length === 0, { found: at102.length });

  // ── Step 2: seed legacy governance rows in the pre-102 shape ────────────────
  await ds101.query(
    `INSERT INTO notification_provider_configurations (channel, provider, updated_by, approved_by, credential_source)
     VALUES ('SMS','console','legacy-maker','legacy-checker','NONE')`,
  );
  const approvalId = '11111111-1111-4111-8111-111111111111';
  const proposalId = '22222222-2222-4222-8222-222222222222';
  await ds101.query(
    `INSERT INTO privileged_action_approvals
       (id, action_type, resource_type, action_fingerprint, approval_scope, requester_principal_id,
        reason, status, requested_at, expires_at)
     VALUES ($1,'NOTIFICATION_PROVIDER_CONFIG_ACTIVATION','NOTIFICATION_PROVIDER_CONFIG','${'a'.repeat(64)}',
             'platform','legacy-maker','legacy approval','REQUESTED', NOW(), NOW() + INTERVAL '1 day')`,
    [approvalId],
  );
  await ds101.query(
    `INSERT INTO notification_provider_config_proposals
       (id, channel, expected_version, proposed_provider, proposed_enabled, credential_action, reason,
        status, proposer_principal_id, approval_id, action_fingerprint)
     VALUES ($1,'SMS',1,'console',true,'KEEP_EXISTING','legacy proposal','REQUESTED','legacy-maker',$2,'legacy-fingerprint')`,
    [proposalId, approvalId],
  );
  const before = await ds101.query(
    `SELECT (SELECT count(*)::int FROM notification_provider_configurations) c,
            (SELECT count(*)::int FROM notification_provider_config_proposals) p`,
  );
  await ds101.destroy();
  rec('3. legacy rows seeded before upgrade', before[0].c === 1 && before[0].p === 1, before[0]);

  // ── Step 3: apply migration 102 over the pre-102 schema ─────────────────────
  const ds102 = makeDs(all);
  await ds102.initialize();
  const applied = await ds102.runMigrations({ transaction: 'all' });
  rec('4. migration 102 applies over an existing 101 database', Array.isArray(applied) && applied.length >= 1, {
    appliedCount: Array.isArray(applied) ? applied.length : null,
  });
  rec(
    '5. 102 is recorded in typeorm_migrations',
    (await ds102.query(`SELECT 1 FROM typeorm_migrations WHERE name LIKE '%AddNotificationCredentialBinding%'`)).length === 1,
    null,
  );

  // ── Step 4: post-upgrade assertions ────────────────────────────────────────
  const cfg = await ds102.query(
    `SELECT credential_binding_scheme s, credential_binding_key_version v, credential_binding_mac m,
            credential_source src, approved_by
     FROM notification_provider_configurations`,
  );
  rec('6. legacy configuration survives the upgrade', cfg.length === 1, { rows: cfg.length });
  rec(
    '7. legacy configuration remains UNBOUND (no silent credential approval)',
    cfg[0] && cfg[0].s === null && cfg[0].v === null && cfg[0].m === null,
    cfg[0],
  );
  rec('8. legacy configuration source and approver are not rewritten', cfg[0] && cfg[0].src === 'NONE' && cfg[0].approved_by === 'legacy-checker', cfg[0]);

  const prop = await ds102.query(
    `SELECT status, action_fingerprint_version fv, credential_binding_mac m, proposed_credential_source src
     FROM notification_provider_config_proposals WHERE id=$1`,
    [proposalId],
  );
  rec('9. legacy proposal survives with its original status', prop[0] && prop[0].status === 'REQUESTED', prop[0]);
  rec(
    '10. legacy proposal is not retro-bound and gains no fingerprint version',
    prop[0] && prop[0].m === null && prop[0].fv === null && (prop[0].src === null || prop[0].src === 'NONE'),
    prop[0],
  );

  // Constraints must be live on the upgraded database (not just on fresh installs).
  const probe = async (bindingCols, bindingVals, source) => {
    await ds102.query('SAVEPOINT u');
    try {
      await ds102.query(
        `INSERT INTO notification_provider_configurations
           (channel, provider, updated_by, approved_by, credential_source${bindingCols})
         VALUES ('EMAIL','none','m25p-upgrade','m25p-upgrade',$1${bindingVals})`,
        [source],
      );
      await ds102.query('ROLLBACK TO SAVEPOINT u');
      return 'accepted';
    } catch (e) {
      await ds102.query('ROLLBACK TO SAVEPOINT u');
      return e.constraint ?? e.code;
    }
  };
  await ds102.query('BEGIN');
  const mac = 'b'.repeat(64);
  const partial = await probe(', credential_binding_scheme, credential_binding_mac', `, 'HMAC_SHA256_V1', '${mac}'`, 'ENV_SECRET');
  const good = await probe(
    ', credential_binding_scheme, credential_binding_key_version, credential_binding_mac',
    `, 'HMAC_SHA256_V1', 'v1', '${mac}'`,
    'ENV_SECRET',
  );
  const badFv = (async () => {
    await ds102.query('SAVEPOINT f');
    try {
      await ds102.query(
        `INSERT INTO notification_provider_config_proposals
           (id, channel, expected_version, proposed_provider, proposed_enabled, credential_action, reason,
            status, proposer_principal_id, approval_id, action_fingerprint, action_fingerprint_version)
         VALUES (gen_random_uuid(),'SMS',1,'console',true,'KEEP_EXISTING','x','REQUESTED','m',$1,'f',7)`,
        ['33333333-3333-4333-8333-333333333333'],
      );
      await ds102.query('ROLLBACK TO SAVEPOINT f');
      return 'accepted';
    } catch (e) {
      await ds102.query('ROLLBACK TO SAVEPOINT f');
      return e.constraint ?? e.code;
    }
  })();
  const badFvResult = await badFv;
  await ds102.query('ROLLBACK');

  rec('11. binding check is enforced on the upgraded database (partial metadata refused)', partial === 'chk_notif_provider_cfg_binding', { partial });
  rec('12. well-formed binding still accepted on the upgraded database', good === 'accepted', { good });
  rec('13. fingerprint version other than 2 is refused on the upgraded database', badFvResult === 'chk_notif_provider_prop_fingerprint_version', { badFvResult });

  // Destructive rollback guard, with governance rows present.
  let refused = false;
  try {
    await ds102.undoLastMigration({ transaction: 'all' });
  } catch {
    refused = true;
  }
  const stillThere = await ds102.query(`SELECT count(*)::int n FROM notification_provider_configurations`);
  rec('14. destructive rollback is refused while governance rows exist', refused, { refused });
  rec('15. refused rollback left the data and schema intact', stillThere[0].n === 1 &&
    (await ds102.query(`SELECT 1 FROM information_schema.columns WHERE table_name='notification_provider_configurations' AND column_name='credential_binding_mac'`)).length === 1,
    stillThere[0]);

  await ds102.destroy();

  // Cleanup.
  const cleanup = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'postgres' });
  await cleanup.connect();
  await cleanup.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await cleanup.end();

  fs.writeFileSync('/home/user/m25p-harness/h07-upgrade-results.json', JSON.stringify({ pass, fail, total: results.length, results }, null, 2));
  console.log(`\n=== MIGRATION 102 UPGRADE TOTALS: ${pass} passed / ${fail} failed / ${results.length} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
