/* V1-INFRA-03 Part D: Live two-process multi-instance concurrency proof.
 * Targets two REAL running backend processes (instance A on :3001, instance B on :3002)
 * both pointed at the SAME shared Postgres database, seeded by scripts/infra03-seed.js.
 *
 * Proves/disproves:
 *  1. Session tokens issued by one instance are honored by the other (no process-local
 *     session cache that would break multi-instance auth).
 *  2. Concurrent same-source-wallet transfers submitted to DIFFERENT instances at the
 *     same instant cannot both succeed if their combined amount exceeds the balance
 *     (no double-spend / overdraft across instances).
 *  3. The SAME Idempotency-Key + same payload submitted to BOTH instances at the same
 *     instant produces exactly one real money movement (no duplicate debit/credit row
 *     from cross-instance idempotency races).
 *  4. Final ledger balance after the race matches expected arithmetic (debits==credits,
 *     no phantom credit, no lost debit).
 */
const { Client } = require('pg');

const BASE_A = 'http://127.0.0.1:3001/api/v1';
const BASE_B = 'http://127.0.0.1:3002/api/v1';

async function post(base, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  if (body && body.__idem) {
    headers['idempotency-key'] = body.__idem;
    delete body.__idem;
  }
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function get(base, path, token) {
  const headers = {};
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { headers });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function main() {
  const seed = require('../infra03-seed-result.json');
  const { A, B } = seed;

  console.log('\n=== TEST 1: session issued by instance A is honored by instance B ===');
  const loginA_onA = await post(BASE_A, '/customers/sessions', { customerId: A.customerId, password: A.password });
  if (loginA_onA.status !== 200) throw new Error('login on A failed: ' + JSON.stringify(loginA_onA));
  const tokenA = loginA_onA.body.accessToken;
  const meOnB = await get(BASE_B, '/customers/me', tokenA);
  console.log('Token minted by instance A, presented to instance B -> status', meOnB.status, meOnB.status === 200 ? '(PASS: cross-instance auth works, token not process-local)' : '(FAIL)');
  if (meOnB.status !== 200) throw new Error('Cross-instance auth FAILED: ' + JSON.stringify(meOnB));

  const loginB_onB = await post(BASE_B, '/customers/sessions', { customerId: B.customerId, password: B.password });
  if (loginB_onB.status !== 200) throw new Error('login on B failed: ' + JSON.stringify(loginB_onB));
  const tokenB = loginB_onB.body.accessToken;

  console.log('\n=== Setting transaction PINs (via instance A for A, instance B for B) ===');
  const pinA = await post(BASE_A, '/customers/me/transaction-pin', { pin: '1234' }, tokenA);
  console.log('Set PIN for A on instance A ->', pinA.status);
  const pinB = await post(BASE_B, '/customers/me/transaction-pin', { pin: '4321' }, tokenB);
  console.log('Set PIN for B on instance B ->', pinB.status);
  // Verify PIN set on instance A is visible+usable via instance B (no process-local PIN cache)
  const verifyOnOther = await post(BASE_B, '/customers/me/transaction-pin/verify', { pin: '1234' }, tokenA);
  console.log('Verify A\'s PIN (set via instance A) through instance B ->', verifyOnOther.status, verifyOnOther.status === 200 ? '(PASS)' : '(FAIL)');

  const walletsA = await get(BASE_A, '/customers/me/wallets', tokenA);
  const walletA = walletsA.body.data ? walletsA.body.data[0] : walletsA.body[0];
  const walletsB = await get(BASE_B, '/customers/me/wallets', tokenB);
  const walletB = walletsB.body.data ? walletsB.body.data[0] : walletsB.body[0];
  console.log('Wallet A id:', walletA.id, 'Wallet B id:', walletB.id);

  const balBefore = await get(BASE_A, `/customers/me/wallets/${walletA.id}/balance`, tokenA);
  console.log('Wallet A balance before race:', JSON.stringify(balBefore.body));

  console.log('\n=== TEST 2: concurrent overdraft race — two DIFFERENT transfers from the SAME source wallet (A has 100,000.00 NGN), each for 60,000.00 NGN, fired at the same instant to DIFFERENT instances ===');
  const amountMinor = '6000000'; // 60,000.00 NGN; two of these exceed the 100,000.00 balance
  const refSuffix = Date.now();
  const [raceResA, raceResB] = await Promise.allSettled([
    post(BASE_A, '/customers/me/transfers', { __idem: `race-a-${refSuffix}`, sourceWalletId: walletA.id, destinationWalletId: walletB.id, amountMinor, currency: 'NGN', reference: `race-ref-a-${refSuffix}`, pin: '1234' }, tokenA),
    post(BASE_B, '/customers/me/transfers', { __idem: `race-b-${refSuffix}`, sourceWalletId: walletA.id, destinationWalletId: walletB.id, amountMinor, currency: 'NGN', reference: `race-ref-b-${refSuffix}`, pin: '1234' }, tokenA),
  ]);
  console.log('Race result via instance A:', raceResA.status === 'fulfilled' ? JSON.stringify({ status: raceResA.value.status, body: raceResA.value.body }) : raceResA.reason);
  console.log('Race result via instance B:', raceResB.status === 'fulfilled' ? JSON.stringify({ status: raceResB.value.status, body: raceResB.value.body }) : raceResB.reason);

  const statusA = raceResA.status === 'fulfilled' ? raceResA.value.status : -1;
  const statusB = raceResB.status === 'fulfilled' ? raceResB.value.status : -1;
  const successes = [statusA, statusB].filter((s) => s === 201).length;
  console.log(`Successful transfers out of 2 concurrent 60,000.00 NGN debits against a 100,000.00 NGN balance: ${successes}`);
  console.log(successes === 1 ? 'PASS: exactly one succeeded, no overdraft' : `FAIL or UNEXPECTED: expected exactly 1 success, got ${successes}`);

  const balAfterRace = await get(BASE_B, `/customers/me/wallets/${walletA.id}/balance`, tokenA);
  console.log('Wallet A balance after overdraft race (queried via instance B):', JSON.stringify(balAfterRace.body));

  console.log('\n=== TEST 3: cross-instance idempotency race — SAME Idempotency-Key + SAME payload fired at both instances simultaneously ===');
  const sharedIdem = `shared-idem-${refSuffix}`;
  const sharedRef = `shared-ref-${refSuffix}`;
  const payloadBase = { sourceWalletId: walletA.id, destinationWalletId: walletB.id, amountMinor: '100000', currency: 'NGN', reference: sharedRef, pin: '1234' };
  const [idemResA, idemResB] = await Promise.allSettled([
    post(BASE_A, '/customers/me/transfers', { ...payloadBase, __idem: sharedIdem }, tokenA),
    post(BASE_B, '/customers/me/transfers', { ...payloadBase, __idem: sharedIdem }, tokenA),
  ]);
  const vA = idemResA.status === 'fulfilled' ? idemResA.value : { status: -1, body: String(idemResA.reason) };
  const vB = idemResB.status === 'fulfilled' ? idemResB.value : { status: -1, body: String(idemResB.reason) };
  console.log('Idempotent race result via instance A:', JSON.stringify(vA));
  console.log('Idempotent race result via instance B:', JSON.stringify(vB));
  const idA = vA.body && (vA.body.id || vA.body.transferId);
  const idB = vB.body && (vB.body.id || vB.body.transferId);
  console.log('Transfer id from A:', idA, 'Transfer id from B:', idB);

  console.log('\n=== Direct SQL verification: count actual ledger postings for the two race references ===');
  const client = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'monienaija' });
  await client.connect();
  const raceCount = await client.query(`SELECT count(*) FROM ledger_journals WHERE reference IN ($1,$2)`, [`race-ref-a-${refSuffix}`, `race-ref-b-${refSuffix}`]);
  console.log('Ledger journals matching the overdraft race references (expect exactly 1):', raceCount.rows[0].count);
  const idemCount = await client.query(`SELECT count(DISTINCT id) as distinct_journals, count(*) as total_rows FROM ledger_journals WHERE reference = $1`, [sharedRef]);
  console.log('Ledger journals matching the shared-idempotency-key reference (expect exactly 1 distinct journal):', JSON.stringify(idemCount.rows[0]));
  const idemKeyRows = await client.query(`SELECT count(*) FROM idempotency_records WHERE idempotency_key = $1`, [sharedIdem]).catch((e) => { console.log('idempotency_records query error:', e.message); return null; });
  if (idemKeyRows) console.log('idempotency_records rows for shared key (expect exactly 1):', idemKeyRows.rows[0].count);

  const finalBal = await client.query(
    `SELECT a.code, a.currency, COALESCE(SUM(CASE WHEN l.direction='DEBIT' THEN l.amount_minor::numeric ELSE -l.amount_minor::numeric END),0) as net_debit_minor
     FROM ledger_accounts a JOIN ledger_lines l ON l.ledger_account_id = a.id
     WHERE a.id = (SELECT ledger_account_id FROM wallet_accounts WHERE id = $1)
     GROUP BY a.code, a.currency`,
    [walletA.id],
  );
  console.log('Wallet A ledger-account net movement row:', JSON.stringify(finalBal.rows));

  await client.end();

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    crossInstanceAuthWorks: meOnB.status === 200,
    crossInstancePinVerifyWorks: verifyOnOther.status === 200,
    overdraftRaceSuccesses: successes,
    overdraftRaceSafe: successes === 1,
    idempotencyRaceStatusA: vA.status,
    idempotencyRaceStatusB: vB.status,
    idempotencyRaceSameId: idA && idB ? idA === idB : null,
    journalRowsForOverdraftRace: raceCount.rows[0].count,
    distinctJournalsForIdempotencyRace: idemCount.rows[0].distinct_journals,
    totalJournalLineRowsForIdempotencyRace: idemCount.rows[0].total_rows,
  }, null, 2));
}

main().catch((e) => { console.error('TEST SCRIPT FAILED:', e); process.exit(1); });
