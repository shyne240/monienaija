/**
 * Mission 25H — disposable fixtures for independent verification.
 *
 * Creates TWO ACTIVE customers with real PBKDF2 credentials, profile rows and a primary
 * phone contact method, in the disposable `monienaija` database only. Mirrors the repository's
 * own trusted fixture pattern (scripts/infra03-seed.js). No production data is touched.
 */
const { Client } = require('pg');
const { pbkdf2Sync, randomUUID } = require('node:crypto');
const fs = require('node:fs');

function encodePbkdf2(password, saltStr) {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

async function main() {
  const c = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'monienaija',
    password: 'monienaija-pw',
    database: 'monienaija',
  });
  await c.connect();

  const out = {};
  for (const label of ['1', '2', '3']) {
    const reference = `m25h-cust-000${label}`;
    const password = `M25h-Pass-${label}-x9Qz`;
    const existing = await c.query('SELECT id FROM customers WHERE reference=$1', [reference]);
    let customerId;
    if (existing.rowCount > 0) {
      customerId = existing.rows[0].id;
    } else {
      const res = await c.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
        [reference],
      );
      customerId = res.rows[0].id;
      await c.query(
        `INSERT INTO customer_profiles (customer_id, display_name, first_name, is_active)
         VALUES ($1,$2,$3,true)`,
        [customerId, `M25H Customer ${label}`, `M25H${label}`],
      );
      const canonical10 = `0803${label}0000${label}`.slice(0, 10);
      await c.query(
        `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at)
         VALUES ($1,'PHONE',$2,$3,true,now())`,
        [customerId, canonical10, canonical10],
      );
      await c.query(
        `INSERT INTO customer_authentication_credentials
           (customer_id, password_hash, hash_algorithm, password_version, password_changed_at,
            status, account_locked, failed_authentication_count, version)
         VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
        [customerId, encodePbkdf2(password, `m25h-salt-${label}`)],
      );
    }
    out[`customer${label}`] = { customerId, reference, password };
  }

  fs.writeFileSync('/home/user/m25h-harness/fixtures.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await c.end();
}

main().catch((e) => {
  console.error('FIXTURE FAILED', e);
  process.exit(1);
});
