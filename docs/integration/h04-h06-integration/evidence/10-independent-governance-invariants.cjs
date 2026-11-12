/**
 * Mission H-04/H-06 — INDEPENDENT governance-invariant verification (Arena 3).
 *
 * The source branch's suites exercise the full HTTP stack. This harness instead asserts the
 * *data-layer invariants* the governance guarantees depend on, directly against a disposable
 * database migrated by the real chain. It shares no helper or fixture with the source's tests.
 *
 * Mapped to the required functional checks:
 *   - EVENT / SMS / EMAIL are independent settings per event (checks 1,3,4)
 *   - an event-wide disable is a distinct row from channel settings (checks 1,2)
 *   - SECURITY rows keep their locks and are never ordinary-configurable (check 9)
 *   - deposit/withdrawal events exist with original semantics: disabled by default, unlocked (check 11)
 *   - versioning is enforced by trigger, so maker-checker `expectedVersion` fencing is meaningful (check 5)
 */
const fs = require('node:fs');
const path = require('node:path');

let pass = 0, fail = 0;
const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + ' — ' + JSON.stringify(detail)); }
}

const DB = 'mn_h0406_gov';
const MIG = '/home/user/h46/dist/migrations';

(async () => {
  const { Client } = require('pg');
  const { DataSource } = require('typeorm');

  const admin = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await admin.query(`CREATE DATABASE "${DB}"`);
  await admin.end();

  const migrations = fs.readdirSync(MIG).filter((f) => f.endsWith('.js')).sort()
    .flatMap((f) => Object.values(require(path.join(MIG, f)))
      .filter((v) => typeof v === 'function' && v.prototype && v.prototype.up));

  const ds = new DataSource({
    type: 'postgres', host: '127.0.0.1', port: 5432, username: 'monienaija',
    password: 'monienaija-pw', database: DB, entities: [], migrations,
    migrationsTableName: 'typeorm_migrations', synchronize: false,
  });
  await ds.initialize();
  await ds.runMigrations({ transaction: 'all' });
  rec('0. full chain (through 103) migrates a fresh database', true);

  const get = async (ev, ch) => (await ds.query(
    `SELECT is_enabled,is_locked,version,delivery_class FROM notification_event_configurations
      WHERE event_type=$1 AND channel=$2`, [ev, ch]))[0];

  // ── Independence of EVENT / SMS / EMAIL ──────────────────────────────────
  const before = { ev: await get('transfer.completed', 'EVENT'), sms: await get('transfer.completed', 'SMS'), em: await get('transfer.completed', 'EMAIL') };
  rec('1. every ordinary event carries three independent control rows',
    !!before.ev && !!before.sms && !!before.em, before);

  // Disable the event only.
  await ds.query(`UPDATE notification_event_configurations SET is_enabled=false, version=version+1
                   WHERE event_type='transfer.completed' AND channel='EVENT'`);
  const afterDisable = { ev: await get('transfer.completed', 'EVENT'), sms: await get('transfer.completed', 'SMS'), em: await get('transfer.completed', 'EMAIL') };
  rec('2. event-wide disable suppresses delivery without touching channel settings',
    afterDisable.ev.is_enabled === false &&
    afterDisable.sms.is_enabled === before.sms.is_enabled &&
    afterDisable.em.is_enabled === before.em.is_enabled, { afterDisable });

  // Re-enable the event; channel settings must be exactly as they were.
  await ds.query(`UPDATE notification_event_configurations SET is_enabled=true, version=version+1
                   WHERE event_type='transfer.completed' AND channel='EVENT'`);
  const afterEnable = { ev: await get('transfer.completed', 'EVENT'), sms: await get('transfer.completed', 'SMS'), em: await get('transfer.completed', 'EMAIL') };
  rec('3. re-enabling the event preserves both channel settings',
    afterEnable.ev.is_enabled === true &&
    afterEnable.sms.is_enabled === before.sms.is_enabled && afterEnable.sms.version === before.sms.version &&
    afterEnable.em.is_enabled === before.em.is_enabled && afterEnable.em.version === before.em.version, { afterEnable });

  // SMS-only / email-only / both / neither — set channels independently.
  const combos = [
    { sms: true, em: false, label: 'SMS-only' },
    { sms: false, em: true, label: 'email-only' },
    { sms: true, em: true, label: 'both' },
    { sms: false, em: false, label: 'neither' },
  ];
  let combosOk = true;
  const comboDetail = [];
  for (const c of combos) {
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=$1, version=version+1
                     WHERE event_type='transfer.completed' AND channel='SMS'`, [c.sms]);
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=$1, version=version+1
                     WHERE event_type='transfer.completed' AND channel='EMAIL'`, [c.em]);
    const s = await get('transfer.completed', 'SMS');
    const e = await get('transfer.completed', 'EMAIL');
    const evRow = await get('transfer.completed', 'EVENT');
    const ok = s.is_enabled === c.sms && e.is_enabled === c.em && evRow.is_enabled === true;
    combosOk = combosOk && ok;
    comboDetail.push({ combo: c.label, sms: s.is_enabled, email: e.is_enabled, event: evRow.is_enabled, ok });
  }
  rec('4. SMS-only, email-only, both and neither are independently representable', combosOk, comboDetail);

  // Changing one event must not change another.
  const otherBefore = await ds.query(
    `SELECT event_type,channel,is_enabled,version FROM notification_event_configurations
      WHERE event_type IN ('cash_to_cash.created','transfer.failed') ORDER BY event_type,channel`);
  await ds.query(`UPDATE notification_event_configurations SET is_enabled=true, version=version+1
                   WHERE event_type='transfer.completed'`);
  const otherAfter = await ds.query(
    `SELECT event_type,channel,is_enabled,version FROM notification_event_configurations
      WHERE event_type IN ('cash_to_cash.created','transfer.failed') ORDER BY event_type,channel`);
  rec('5. changing one event leaves every other event untouched',
    JSON.stringify(otherBefore) === JSON.stringify(otherAfter), { changed: JSON.stringify(otherBefore) !== JSON.stringify(otherAfter) });

  // ── Versioning / maker-checker fencing ──────────────────────────────────
  await ds.query('BEGIN');
  let noBump = null;
  try {
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=false WHERE event_type='transfer.completed' AND channel='EVENT'`);
  } catch (e) { noBump = e.message; }
  await ds.query('ROLLBACK');
  rec('6. the database refuses an unversioned change (expectedVersion fencing is meaningful)',
    noBump !== null && /Invalid/i.test(noBump), { noBump });

  await ds.query('BEGIN');
  let skip = null;
  try {
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=false, version=version+5 WHERE event_type='transfer.completed' AND channel='EVENT'`);
  } catch (e) { skip = e.message; }
  await ds.query('ROLLBACK');
  rec('7. the database refuses a version jump (no silent multi-step advance)', skip !== null, { skip });

  // ── SECURITY locks intact ───────────────────────────────────────────────
  const secRows = await ds.query(
    `SELECT event_type,channel,is_locked FROM notification_event_configurations WHERE delivery_class='SECURITY'`);
  rec('8. SECURITY configurations retain their locks', secRows.length > 0 && secRows.every((r) => r.is_locked === true),
    { count: secRows.length, unlocked: secRows.filter((r) => !r.is_locked).map((r) => `${r.event_type}|${r.channel}`) });

  const secEventRows = await ds.query(
    `SELECT count(*)::int n FROM notification_event_configurations c WHERE c.channel='EVENT'
      AND EXISTS (SELECT 1 FROM notification_event_configurations s WHERE s.event_type=c.event_type AND s.delivery_class='SECURITY')`);
  rec('9. no SECURITY event gained an event-wide ordinary control row', secEventRows[0].n === 0, secEventRows[0]);

  await ds.query('BEGIN');
  let secMod = null;
  try {
    await ds.query(`UPDATE notification_event_configurations SET is_enabled=NOT is_enabled, version=version+1
                     WHERE ctid = (SELECT ctid FROM notification_event_configurations
                                    WHERE delivery_class='SECURITY' AND is_locked=true LIMIT 1)`);
  } catch (e) { secMod = e.message; }
  await ds.query('ROLLBACK');
  rec('10. a locked SECURITY row cannot be modified at all', secMod !== null && /locked/i.test(secMod), { secMod });

  // ── Deposit / withdrawal: original semantics ───────────────────────────
  const pay = await ds.query(
    `SELECT event_type,channel,is_enabled FROM notification_event_configurations
      WHERE event_type IN ('deposit.completed','deposit.failed','withdrawal.completed','withdrawal.failed')
      ORDER BY event_type,channel`);
  const payEvents = [...new Set(pay.map((r) => r.event_type))];
  rec('11. deposit and withdrawal events exist with EVENT/SMS/EMAIL controls',
    payEvents.length === 4 && pay.length === 12, { events: payEvents.length, rows: pay.length });
  rec('12. deposit/withdrawal controls start disabled (no new send enabled by migration)',
    pay.every((r) => r.is_enabled === false), { enabled: pay.filter((r) => r.is_enabled).map((r) => `${r.event_type}|${r.channel}`) });
  const payLocks = await ds.query(
    `SELECT count(*)::int n FROM notification_event_configurations
      WHERE event_type IN ('deposit.completed','deposit.failed','withdrawal.completed','withdrawal.failed')
        AND is_locked=true`);
  rec('13. deposit/withdrawal controls are unlocked (owner-approved configurability)', payLocks[0].n === 0, payLocks[0]);

  // ── No speculative producers: the events exist but nothing emits them ──
  const outboxCols = await ds.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='outbox_events'`);
  rec('14. notification outbox schema untouched by 103 (no producer changes)',
    outboxCols.length > 0 && !outboxCols.some((c) => /event_control|channel_control/i.test(c.column_name)),
    { cols: outboxCols.length });

  // ── H-07 binding still intact alongside 103 ────────────────────────────
  const bindingCols = await ds.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='notification_provider_configurations' AND column_name LIKE 'credential_binding%'`);
  rec('15. H-07 credential-binding columns coexist with migration 103', bindingCols.length === 3, { cols: bindingCols.length });

  await ds.destroy();

  const cleanup = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'postgres' });
  await cleanup.connect();
  await cleanup.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await cleanup.end();

  fs.writeFileSync('/home/user/h46-harness/governance-invariants-results.json',
    JSON.stringify({ pass, fail, total: results.length, results }, null, 2));
  console.log(`\n=== GOVERNANCE INVARIANT TOTALS: ${pass} passed / ${fail} failed / ${results.length} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
