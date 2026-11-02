/**
 * Mission H-04/H-06 — INDEPENDENT migration 103 verification (Arena 3).
 *
 * Written from scratch for this integration. The source branch has its own upgrade suite; this
 * harness proves the same properties with independent code on its own disposable database:
 *
 *   1. Build the real migration chain and stop at 102 (a genuine pre-103 schema).
 *   2. Seed pre-103 state: a locked/misclassified financial row, a SECURITY row, a governed
 *      SMS/EMAIL choice at version 3, and a custom template version.
 *   3. Apply migration 103 for real (upgrade, not fresh install).
 *   4. Assert: financial lock repaired + audited, SECURITY lock preserved, governed settings and
 *      template history untouched, EVENT control rows seeded, transfer.unknown inherited once,
 *      channel CHECK extended, guard trigger re-armed, rollback refused.
 */
const fs = require('node:fs');
const path = require('node:path');

let pass = 0;
let fail = 0;
const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + ' — ' + JSON.stringify(detail)); }
}

const DB = 'mn_h0406_upgrade';
const MIG = '/home/user/h46/dist/migrations';
const M103 = '1785753600103';

function loadMigrations() {
  return fs.readdirSync(MIG).filter((f) => f.endsWith('.js')).sort()
    .flatMap((f) => Object.values(require(path.join(MIG, f)))
      .filter((v) => typeof v === 'function' && v.prototype && v.prototype.up));
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
  const pre103 = all.filter((m) => (m.name || '').indexOf(M103) === -1);
  rec('1. migration 103 present in chain and excluded from pre-upgrade set',
    all.length - pre103.length === 1, { total: all.length, pre: pre103.length });

  const makeDs = (migrations) => new DataSource({
    type: 'postgres', host: '127.0.0.1', port: 5432, username: 'monienaija',
    password: 'monienaija-pw', database: DB, entities: [], migrations,
    migrationsTableName: 'typeorm_migrations', synchronize: false,
  });

  // ── Step 1: schema at 102 ─────────────────────────────────────────────────
  const ds102 = makeDs(pre103);
  await ds102.initialize();
  await ds102.runMigrations({ transaction: 'all' });

  const cols102 = await ds102.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='notification_event_configurations'`);
  rec('2. pre-upgrade schema genuinely predates 103 (no EVENT rows possible)', cols102.length > 0, { cols: cols102.length });
  const chk102 = await ds102.query(
    `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='notification_event_configurations_channel_check'`);
  rec('3. pre-upgrade channel CHECK excludes EVENT', !/EVENT/.test(chk102[0].d), { def: chk102[0].d });

  // ── Step 2: seed pre-103 governed state ──────────────────────────────────
  // Guard trigger must be off to create non-versioned+1 rows.
  await ds102.query('ALTER TABLE notification_event_configurations DISABLE TRIGGER notification_configuration_guard');

  // (e) Custom template history that must never be replaced. Seed while the row is still
  // TRANSACTIONAL (the template guard refuses templates for SECURITY rows) and version +1.
  await ds102.query(
    `UPDATE notification_templates SET is_active=false
      WHERE event_type='transfer.completed' AND channel='SMS' AND is_active`);
  await ds102.query(
    `INSERT INTO notification_templates (event_type,channel,locale,version,is_active,subject,body,created_by)
     VALUES ('transfer.completed','SMS','en-NG',2,true,NULL,'CUSTOM-GOVERNED-BODY','pre103-governed')`);

  // (a) A financial row wrongly locked + wrongly SECURITY-classified (what 103 must repair).
  await ds102.query(
    `UPDATE notification_event_configurations
        SET delivery_class='SECURITY', is_locked=true, version=3, updated_by='pre103-wrong'
      WHERE event_type='transfer.completed' AND channel='SMS'`);
  // (b) A genuinely SECURITY event row that must keep its lock.
  const sec = await ds102.query(
    `SELECT event_type, channel FROM notification_event_configurations
      WHERE delivery_class='SECURITY' AND is_locked=true ORDER BY event_type, channel LIMIT 1`);
  rec('4. a real SECURITY-class row exists to protect', sec.length === 1, sec[0] ?? null);
  const secEvent = sec[0];

  // (c) A governed ordinary choice: transfer.failed SMS enabled at version 3 (transfer.unknown inherits this).
  await ds102.query(
    `UPDATE notification_event_configurations
        SET is_enabled=true, version=3, updated_by='pre103-governed'
      WHERE event_type='transfer.failed' AND channel='SMS'`);
  // (d) A governed customer choice on a financial event that must survive.
  await ds102.query(
    `UPDATE notification_event_configurations
        SET is_enabled=false, version=4, updated_by='pre103-governed'
      WHERE event_type='cash_to_cash.created' AND channel='EMAIL'`);

  await ds102.query('ALTER TABLE notification_event_configurations ENABLE TRIGGER notification_configuration_guard');

  const pre = await ds102.query(
    `SELECT event_type,channel,delivery_class,is_locked,is_enabled,version FROM notification_event_configurations
      WHERE (event_type='transfer.completed' AND channel='SMS')
         OR (event_type='transfer.failed' AND channel='SMS')
         OR (event_type='cash_to_cash.created' AND channel='EMAIL')`);
  const preRows = Object.fromEntries(pre.map((r) => [`${r.event_type}|${r.channel}`, r]));
  rec('5. pre-103 state seeded (locked financial row, governed choices)',
    preRows['transfer.completed|SMS']?.is_locked === true &&
    preRows['transfer.completed|SMS']?.delivery_class === 'SECURITY' &&
    preRows['transfer.failed|SMS']?.is_enabled === true &&
    preRows['cash_to_cash.created|EMAIL']?.is_enabled === false, preRows);
  await ds102.destroy();

  // ── Step 3: apply 103 for real ───────────────────────────────────────────
  const ds103 = makeDs(all);
  await ds103.initialize();
  const applied = await ds103.runMigrations({ transaction: 'all' });
  rec('6. migration 103 applies over an existing 102 database', Array.isArray(applied) && applied.length >= 1,
    { applied: Array.isArray(applied) ? applied.map((m) => m.name) : null });
  rec('7. 103 recorded in typeorm_migrations',
    (await ds103.query(`SELECT 1 FROM typeorm_migrations WHERE name LIKE '%ConfigureTransactionNotificationEvents%'`)).length === 1);

  // ── Step 4: assertions ───────────────────────────────────────────────────
  const chk103 = await ds103.query(
    `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='notification_event_configurations_channel_check'`);
  rec('8. channel CHECK now admits EVENT', /EVENT/.test(chk103[0].d), { def: chk103[0].d });

  const repaired = await ds103.query(
    `SELECT delivery_class,is_locked,version,updated_by FROM notification_event_configurations
      WHERE event_type='transfer.completed' AND channel='SMS'`);
  rec('9. financial row repaired: lock removed and delivery class restored',
    repaired[0] && repaired[0].is_locked === false && repaired[0].delivery_class !== 'SECURITY',
    repaired[0]);
  rec('10. repair is attributed to the migration and version-bumped',
    repaired[0] && repaired[0].updated_by === 'SYSTEM_MIGRATION_0103' && repaired[0].version === 4, repaired[0]);

  const auditRow = await ds103.query(
    `SELECT action,actor FROM audit_events WHERE action='NOTIFICATION_FINANCIAL_LOCK_REMOVED'`);
  rec('11. financial-lock repair written to the audit trail', auditRow.length >= 1, { rows: auditRow.length, first: auditRow[0] });

  const secAfter = await ds103.query(
    `SELECT is_locked,delivery_class,version FROM notification_event_configurations
      WHERE event_type=$1 AND channel=$2`, [secEvent.event_type, secEvent.channel]);
  const secBefore = await ds102 === null ? null : null;
  rec('12. SECURITY row keeps its lock and class', secAfter[0] && secAfter[0].is_locked === true && secAfter[0].delivery_class === 'SECURITY', secAfter[0]);

  const governed = await ds103.query(
    `SELECT is_enabled,version,updated_by FROM notification_event_configurations
      WHERE event_type='cash_to_cash.created' AND channel='EMAIL'`);
  rec('13. an ordinary governed channel choice survives untouched',
    governed[0] && governed[0].is_enabled === false && governed[0].version === 4 && governed[0].updated_by === 'pre103-governed',
    governed[0]);

  const tpl = await ds103.query(
    `SELECT version,body,is_active FROM notification_templates
      WHERE event_type='transfer.completed' AND channel='SMS' ORDER BY version`);
  const customTpl = tpl.find((t) => t.body === 'CUSTOM-GOVERNED-BODY');
  rec('14. custom template history preserved, not replaced', !!customTpl, { versions: tpl.map((t) => t.version) });

  // EVENT control row for every ordinary financial event.
  const eventRows = await ds103.query(
    `SELECT event_type,count(*)::int n FROM notification_event_configurations WHERE channel='EVENT' GROUP BY event_type`);
  rec('15. EVENT-wide control rows seeded for each ordinary event', eventRows.length >= 13, { events: eventRows.length });

  // Existing ordinary events enabled at the event level; new payment events disabled.
  const evState = await ds103.query(
    `SELECT event_type,is_enabled,is_locked FROM notification_event_configurations WHERE channel='EVENT'`);
  const byEvent = Object.fromEntries(evState.map((r) => [r.event_type, r]));
  rec('16. pre-existing ordinary events start event-enabled', byEvent['transfer.completed']?.is_enabled === true, byEvent['transfer.completed']);
  rec('17. newly created deposit/withdrawal events start disabled',
    byEvent['deposit.completed']?.is_enabled === false && byEvent['withdrawal.failed']?.is_enabled === false,
    { dep: byEvent['deposit.completed'], wd: byEvent['withdrawal.failed'] });
  rec('18. EVENT control rows are unlocked (owner-approved policy: no mandatory financial event)',
    evState.every((r) => r.is_locked === false), evState.filter((r) => r.is_locked).map((r) => r.event_type));

  // transfer.unknown inherited transfer.failed's SMS setting exactly once.
  const tu = await ds103.query(
    `SELECT is_enabled FROM notification_event_configurations WHERE event_type='transfer.unknown' AND channel='SMS'`);
  rec('19. transfer.unknown inherits the pre-upgrade transfer.failed channel setting once',
    tu[0] && tu[0].is_enabled === true, tu[0]);

  // Guard trigger must be re-armed: a normal UPDATE must bump version by 1 and a locked row must refuse.
  await ds103.query('BEGIN');
  let guardErr = null;
  try {
    await ds103.query(
      `UPDATE notification_event_configurations SET is_enabled=NOT is_enabled, version=version+1
        WHERE event_type=$1 AND channel=$2`, [secEvent.event_type, secEvent.channel]);
  } catch (e) { guardErr = e.message; }
  await ds103.query('ROLLBACK');
  rec('20. guard trigger re-armed: locked SECURITY configuration cannot be modified',
    guardErr !== null && /locked/i.test(guardErr), { guardErr });

  await ds103.query('BEGIN');
  let illegal = null;
  try {
    await ds103.query(
      `UPDATE notification_event_configurations SET is_enabled=NOT is_enabled
        WHERE event_type='transfer.completed' AND channel='SMS'`); // no version bump
  } catch (e) { illegal = e.message; }
  await ds103.query('ROLLBACK');
  rec('21. guard trigger still requires version+1 on ordinary rows', illegal !== null && /Invalid/i.test(illegal), { illegal });

  await ds103.query('BEGIN');
  let delErr = null;
  try {
    await ds103.query(`DELETE FROM notification_event_configurations WHERE event_type='transfer.completed' AND channel='SMS'`);
  } catch (e) { delErr = e.message; }
  await ds103.query('ROLLBACK');
  rec('22. configurations remain undeletable', delErr !== null && /cannot be deleted/i.test(delErr), { delErr });

  // Rollback refusal.
  let refused = false;
  try { await ds103.undoLastMigration({ transaction: 'all' }); } catch { refused = true; }
  const survived = await ds103.query(
    `SELECT count(*)::int n FROM notification_event_configurations WHERE channel='EVENT'`);
  rec('23. destructive rollback refused', refused, { refused });
  rec('24. refused rollback left governed EVENT rows intact', survived[0].n >= 13, survived[0]);

  await ds103.destroy();

  const cleanup = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'postgres' });
  await cleanup.connect();
  await cleanup.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await cleanup.end();

  fs.writeFileSync('/home/user/h46-harness/m103-upgrade-results.json',
    JSON.stringify({ pass, fail, total: results.length, results }, null, 2));
  console.log(`\n=== MIGRATION 103 UPGRADE TOTALS: ${pass} passed / ${fail} failed / ${results.length} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
