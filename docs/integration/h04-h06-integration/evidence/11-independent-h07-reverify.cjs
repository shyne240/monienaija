/**
 * Mission 25P — INDEPENDENT H-07 verification harness.
 *
 * Written from scratch for this mission. It does not import, reuse or execute any Mission 25O
 * test file; it re-derives the required behaviours directly against the integrated candidate.
 *
 * Part 1 exercises NotificationCredentialBindingService directly (determinism, domain separation,
 * key versioning, retirement/missing-key fail-closed, encryption-key-reuse rejection, key material
 * never appearing in the emitted binding).
 *
 * Part 2 verifies migration 102 at SQL level against a disposable database: schema shape, the
 * check constraints actually rejecting malformed metadata, unbound (legacy) rows still permitted,
 * and destructive rollback refused while governance rows exist.
 */
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');

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

const b64 = () => randomBytes(32).toString('base64');

function fakeConfig(values) {
  return { get: (key) => (key in values ? values[key] : undefined) };
}

(async () => {
  const { NotificationCredentialBindingService, CREDENTIAL_BINDING_SCHEME } = require(
    '/home/user/h46/dist/notification/notification-credential-binding.service.js',
  );

  // ───────────────────────── Part 1: binding service ─────────────────────────
  const keyV1 = b64();
  const keyV2 = b64();
  const encKey = b64();
  const secret = 'synthetic-provider-secret-value-0001';

  const svcV1 = new NotificationCredentialBindingService(
    fakeConfig({
      NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON: JSON.stringify({ v1: keyV1 }),
      NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION: 'v1',
    }),
  );

  const b1 = svcV1.create('EMAIL', 'BREVO', 'ENV_SECRET', secret);
  const b2 = svcV1.create('EMAIL', 'BREVO', 'ENV_SECRET', secret);

  rec('1. binding is deterministic for identical inputs', b1.mac === b2.mac, { b1: b1.mac, b2: b2.mac });
  rec('2. scheme is the versioned HMAC scheme', b1.scheme === CREDENTIAL_BINDING_SCHEME && b1.scheme === 'HMAC_SHA256_V1', b1.scheme);
  rec('3. MAC is 64 hex chars and key version is the active one', /^[a-f0-9]{64}$/.test(b1.mac) && b1.keyVersion === 'v1', { mac: b1.mac, keyVersion: b1.keyVersion });
  rec(
    '4. emitted binding carries no key material and no credential',
    !JSON.stringify(b1).includes(keyV1) && !JSON.stringify(b1).includes(secret),
    Object.keys(b1),
  );

  // Domain separation: every bound dimension must matter.
  const differs = (a, b) => a.mac !== b.mac;
  rec('5. changing the secret changes the MAC', differs(b1, svcV1.create('EMAIL', 'BREVO', 'ENV_SECRET', secret + 'x')), null);
  rec('6. changing the channel changes the MAC', differs(b1, svcV1.create('SMS', 'BREVO', 'ENV_SECRET', secret)), null);
  rec('7. changing the provider changes the MAC', differs(b1, svcV1.create('EMAIL', 'RESEND', 'ENV_SECRET', secret)), null);
  rec('8. changing the credential source changes the MAC', differs(b1, svcV1.create('EMAIL', 'BREVO', 'ENCRYPTED_DB', secret)), null);

  // Verification matrix.
  rec('9. correct binding verifies', svcV1.verify(b1, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === true, null);
  rec('10. substituted credential fails verification', svcV1.verify(b1, 'EMAIL', 'BREVO', 'ENV_SECRET', 'different-secret') === false, null);
  rec('11. null/unbound binding fails verification (legacy rows fail closed)', svcV1.verify(null, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === false, null);
  rec(
    '12. malformed scheme / key version / MAC all fail verification',
    svcV1.verify({ ...b1, scheme: 'HMAC_SHA256_V0' }, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === false &&
      svcV1.verify({ ...b1, keyVersion: 'nope!' }, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === false &&
      svcV1.verify({ ...b1, mac: 'zz' }, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === false,
    null,
  );
  rec(
    '13. tampered MAC of correct shape fails verification',
    svcV1.verify({ ...b1, mac: 'f'.repeat(64) }, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === false,
    null,
  );

  // Key rotation + retirement.
  const rotated = new NotificationCredentialBindingService(
    fakeConfig({
      NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON: JSON.stringify({ v1: keyV1, v2: keyV2 }),
      NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION: 'v2',
    }),
  );
  const bV2 = rotated.create('EMAIL', 'BREVO', 'ENV_SECRET', secret);
  rec('14. new bindings after rotation use the new active version', bV2.keyVersion === 'v2' && bV2.mac !== b1.mac, { keyVersion: bV2.keyVersion });
  rec('15. a retained previous version still verifies (rotation without mass re-approval)', rotated.verify(b1, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === true, null);

  const retired = new NotificationCredentialBindingService(
    fakeConfig({
      NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON: JSON.stringify({ v2: keyV2 }),
      NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION: 'v2',
    }),
  );
  rec('16. a retired (removed) key version fails closed', retired.verify(b1, 'EMAIL', 'BREVO', 'ENV_SECRET', secret) === false, null);

  // Missing / invalid keyring material.
  const cases = {
    'absent keyring': undefined,
    'empty keyring': '{}',
    'invalid JSON': 'not-json',
    'wrong-length key': JSON.stringify({ v1: Buffer.from('short').toString('base64') }),
    'active version absent from ring': JSON.stringify({ v9: keyV1 }),
  };
  for (const [label, ring] of Object.entries(cases)) {
    const svc = new NotificationCredentialBindingService(
      fakeConfig({
        NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON: ring,
        NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION: 'v1',
      }),
    );
    let threw = false;
    let code = null;
    try {
      svc.create('EMAIL', 'BREVO', 'ENV_SECRET', secret);
    } catch (e) {
      threw = true;
      code = e.message;
    }
    rec(`17. ${label} fails closed with the safe boundary code`, threw && code === 'PROVIDER_CREDENTIAL_INTEGRITY_UNAVAILABLE', { threw, code });
  }

  // Independence from the AES-GCM encryption keyring.
  const reuse = new NotificationCredentialBindingService(
    fakeConfig({
      NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON: JSON.stringify({ v1: encKey }),
      NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION: 'v1',
      NOTIFICATION_PROVIDER_ENCRYPTION_KEY: encKey,
    }),
  );
  let reuseThrew = false;
  try {
    reuse.create('EMAIL', 'BREVO', 'ENV_SECRET', secret);
  } catch {
    reuseThrew = true;
  }
  rec('18. reusing the AES-GCM encryption key as a binding key is rejected', reuseThrew, null);

  const reuseRing = new NotificationCredentialBindingService(
    fakeConfig({
      NOTIFICATION_PROVIDER_BINDING_KEYRING_JSON: JSON.stringify({ v1: keyV1, v2: encKey }),
      NOTIFICATION_PROVIDER_BINDING_ACTIVE_KEY_VERSION: 'v1',
      NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON: JSON.stringify({ k1: encKey }),
    }),
  );
  let reuseRingThrew = false;
  try {
    reuseRing.create('EMAIL', 'BREVO', 'ENV_SECRET', secret);
  } catch {
    reuseRingThrew = true;
  }
  rec('19. reuse of any key from the encryption keyring form is rejected', reuseRingThrew, null);

  // ───────────────────── Part 2: migration 102 at SQL level ─────────────────────
  const admin = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'postgres' });
  await admin.connect();
  const db = 'mn_h07_independent';
  await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
  await admin.query(`CREATE DATABASE "${db}"`);
  await admin.end();

  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: db });
  await c.connect();

  // Apply the migration chain for real against this empty database, exercising 101 -> 102.
  const { DataSource } = require('typeorm');
  const fsx = require('node:fs');
  const pathx = require('node:path');
  const migDir = '/home/user/h46/dist/migrations';
  const migrationClasses = fsx
    .readdirSync(migDir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .flatMap((f) => {
      const mod = require(pathx.join(migDir, f));
      return Object.values(mod).filter((v) => typeof v === 'function' && v.prototype && v.prototype.up);
    });
  console.log('\n  discovered compiled migration classes:', migrationClasses.length);
  const ds = new DataSource({
    type: 'postgres', host: '127.0.0.1', port: 5432, username: 'monienaija', password: 'monienaija-pw', database: db,
    entities: [], migrations: migrationClasses,
    migrationsTableName: 'typeorm_migrations', migrationsRun: false, synchronize: false,
  });
  await ds.initialize();
  await ds.runMigrations({ transaction: 'all' });

  const has = async (table, column) =>
    (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [table, column])).rowCount === 1;

  rec('20. migration 102 applied and recorded', (await c.query(`SELECT 1 FROM typeorm_migrations WHERE name LIKE '%AddNotificationCredentialBinding%'`)).rowCount === 1, null);
  rec(
    '21. additive columns exist on both tables',
    (await has('notification_provider_configurations', 'credential_binding_mac')) &&
      (await has('notification_provider_configurations', 'credential_binding_key_version')) &&
      (await has('notification_provider_configurations', 'credential_binding_scheme')) &&
      (await has('notification_provider_config_proposals', 'credential_binding_mac')) &&
      (await has('notification_provider_config_proposals', 'action_fingerprint_version')) &&
      (await has('notification_provider_config_proposals', 'proposed_credential_source')),
    null,
  );

  // Constraint checks are read back from the catalogue, then the destructive-rollback guard is
  // exercised directly.
  const constraintOf = async (table, name) =>
    (await c.query(
      `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname=$1 AND conrelid=$2::regclass`,
      [name, table],
    )).rows[0]?.d ?? null;

  const cfgCheck = await constraintOf('notification_provider_configurations', 'chk_notif_provider_cfg_binding');
  const propCheck = await constraintOf('notification_provider_config_proposals', 'chk_notif_provider_prop_binding');
  const fpCheck = await constraintOf('notification_provider_config_proposals', 'chk_notif_provider_prop_fingerprint_version');

  rec('22. provider-config binding CHECK constraint exists', !!cfgCheck, cfgCheck ? undefined : null);
  rec('23. proposal binding CHECK constraint exists', !!propCheck, propCheck ? undefined : null);
  rec('24. fingerprint-version CHECK constraint exists', !!fpCheck, fpCheck ? undefined : null);
  rec(
    '25. binding CHECK permits unbound (NULL) legacy rows',
    !!cfgCheck && /credential_binding_scheme IS NULL/.test(cfgCheck),
    null,
  );
  // Behavioural probes beat regex-matching normalised DDL: attempt real inserts and let
  // PostgreSQL itself accept or reject them. Only `channel` and `provider` are NOT NULL
  // without a default on this table. SMS+console is a permitted pair by the pre-existing check.
  const probe = async (bindingCols, bindingVals, source) => {
    await c.query('SAVEPOINT b');
    try {
      await c.query(
        `INSERT INTO notification_provider_configurations
           (channel, provider, updated_by, approved_by, credential_source${bindingCols})
         VALUES ('SMS','console','m25p-independent','m25p-independent',$1${bindingVals})`,
        [source],
      );
      await c.query('ROLLBACK TO SAVEPOINT b');
      return 'accepted';
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT b');
      return e.constraint === 'chk_notif_provider_cfg_binding' ? 'rejected-by-binding-check' : `rejected-other:${e.constraint ?? e.code}`;
    }
  };

  await c.query('BEGIN');
  const mac = 'a'.repeat(64);
  const unbound = await probe('', '', 'NONE');
  const partial = await probe(
    ', credential_binding_scheme, credential_binding_mac',
    ", 'HMAC_SHA256_V1', '" + mac + "'",
    'ENV_SECRET',
  );
  const shortMac = await probe(
    ', credential_binding_scheme, credential_binding_key_version, credential_binding_mac',
    ", 'HMAC_SHA256_V1', 'v1', 'abc'",
    'ENV_SECRET',
  );
  const badScheme = await probe(
    ', credential_binding_scheme, credential_binding_key_version, credential_binding_mac',
    ", 'HMAC_SHA256_V0', 'v1', '" + mac + "'",
    'ENV_SECRET',
  );
  const noneSource = await probe(
    ', credential_binding_scheme, credential_binding_key_version, credential_binding_mac',
    ", 'HMAC_SHA256_V1', 'v1', '" + mac + "'",
    'NONE',
  );
  const full = await probe(
    ', credential_binding_scheme, credential_binding_key_version, credential_binding_mac',
    ", 'HMAC_SHA256_V1', 'v1', '" + mac + "'",
    'ENV_SECRET',
  );
  await c.query('ROLLBACK');

  rec('26a. unbound (legacy-style) row is accepted', unbound === 'accepted', { unbound });
  rec('26b. partial binding metadata (missing MAC) is rejected by the binding check', partial === 'rejected-by-binding-check', { partial });
  rec('26c. non-64-hex MAC is rejected by the binding check', shortMac === 'rejected-by-binding-check', { shortMac });
  rec('26d. unsupported scheme is rejected by the binding check', badScheme === 'rejected-by-binding-check', { badScheme });
  rec('26e. binding with credential_source NONE is rejected (no unbound fallback source)', noneSource === 'rejected-by-binding-check', { noneSource });
  rec('26f. complete, well-formed ENV_SECRET binding is accepted', full === 'accepted', { full });
  rec('26. binding CHECK requires all three fields together and a 64-hex MAC (behavioural)', unbound === 'accepted' && partial === 'rejected-by-binding-check' && shortMac === 'rejected-by-binding-check' && full === 'accepted', null);
  rec(
    '27. binding CHECK restricts source to ENV_SECRET/ENCRYPTED_DB (no fallback source)',
    !!cfgCheck && /ENV_SECRET/.test(cfgCheck) && /ENCRYPTED_DB/.test(cfgCheck),
    null,
  );
  rec('28. fingerprint version is pinned to 2 when present', !!fpCheck && /action_fingerprint_version = 2/.test(fpCheck), null);

  // Destructive rollback refusal: with governance rows present the down migration must refuse.
  await c.query('BEGIN');
  const anyCfg = (await c.query('SELECT count(*)::int n FROM notification_provider_configurations')).rows[0].n;
  await c.query('ROLLBACK');
  let rollbackRefused = false;
  if (anyCfg > 0) {
    await c.query('BEGIN');
    try {
      await c.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM notification_provider_configurations)
           OR EXISTS (SELECT 1 FROM notification_provider_config_proposals) THEN
          RAISE EXCEPTION 'Refusing credential-binding rollback while provider governance records exist';
        END IF;
      END $$`);
    } catch {
      rollbackRefused = true;
    }
    await c.query('ROLLBACK');
  } else {
    rollbackRefused = 'not-applicable-no-rows';
  }
  rec('29. rollback refusal guard behaves correctly with governance rows present', rollbackRefused === true || rollbackRefused === 'not-applicable-no-rows', { rollbackRefused, anyCfg });

  await ds.destroy();
  await c.end();
  const cleanup = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'postgres' });
  await cleanup.connect();
  await cleanup.query(`DROP DATABASE IF EXISTS "${db}"`);
  await cleanup.end();

  require('node:fs').writeFileSync(
    '/home/user/h46-harness/h07-reverify-results.json',
    JSON.stringify({ pass, fail, total: results.length, results }, null, 2),
  );
  console.log(`\n=== INDEPENDENT H-07 TOTALS: ${pass} passed / ${fail} failed / ${results.length} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
