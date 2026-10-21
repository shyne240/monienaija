/* V1-INFRA-03 Part D (continued): registration + OTP idempotency/race across two instances. */
const { Client } = require('pg');

const BASE_A = 'http://127.0.0.1:3001/api/v1';
const BASE_B = 'http://127.0.0.1:3002/api/v1';

async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function main() {
  const phone = `070${Math.floor(10000000 + Math.random() * 89999999)}`;
  console.log('Using test phone:', phone);

  console.log('\n=== TEST 4: request OTP via instance A ===');
  const otpReq = await post(BASE_A, '/customers/registration/otp', { phone });
  console.log('OTP request response:', JSON.stringify(otpReq));

  // Fetch the OTP code directly from DB (console SMS provider logs it, but DB row is the
  // ground truth and avoids log-scraping two separate process logs).
  const client = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'monienaija' });
  await client.connect();
  const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%otp%' OR table_name LIKE '%registration%'`);
  console.log('OTP/registration-related tables:', tables.rows.map((r) => r.table_name));

  let otpRow;
  for (const t of tables.rows.map((r) => r.table_name)) {
    try {
      const cols = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t]);
      const colNames = cols.rows.map((c) => c.column_name);
      if (colNames.includes('code') || colNames.includes('otp_code') || colNames.includes('code_hash')) {
        const r = await client.query(`SELECT * FROM ${t} ORDER BY created_at DESC LIMIT 3`);
        console.log(`Rows in ${t}:`, JSON.stringify(r.rows, (k, v) => typeof v === 'string' && v.length > 120 ? v.slice(0, 40) + '...' : v));
      }
    } catch (e) { console.log(`(skip ${t}: ${e.message})`); }
  }
  await client.end();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
