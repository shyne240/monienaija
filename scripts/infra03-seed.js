/* V1-INFRA-03 Part D multi-instance concurrency test fixture seeder.
 * Creates two ACTIVE customers with credentials + funded wallets using the
 * SAME pattern as the project's own trusted integration test harness
 * (test/a23-customer-app.integration.spec.ts): direct SQL for identity rows,
 * real WalletService/LedgerService for financial rows. Runs against the
 * real shared Postgres instance the two live backend processes use.
 */
const { Client } = require('pg');
const { pbkdf2Sync, randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');

function encodePbkdf2(password, saltStr) {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

async function main() {
  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'monienaija',
    password: 'monienaija-pw',
    database: 'monienaija',
  });
  await client.connect();

  const results = {};
  for (const label of ['A', 'B']) {
    const reference = `infra03-cust-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const password = `infra03-pass-${label}`;
    const custRes = await client.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = custRes.rows[0].id;
    await client.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, `Infra03 Customer ${label}`],
    );
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await client.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`,
      [customerId, `0${canonical10.slice(1)}`, canonical10],
    );
    const hash = encodePbkdf2(password, `infra03-salt-${label}`);
    await client.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    results[label] = { customerId, reference, password, phone: canonical10 };
  }
  await client.end();

  // Use the real WalletService/LedgerService (compiled dist) against the same DB
  // to create and fund wallets — same technique the project's own a23 integration
  // test suite uses, just invoked as a standalone script instead of under jest.
  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const { WalletService } = require('../dist/wallet/wallet.service');
  const { LedgerService } = require('../dist/ledger/ledger.service');
  const walletService = app.get(WalletService);
  const ledgerService = app.get(LedgerService);

  const platformAccount = await ledgerService.createAccount({
    code: `INFRA03_PLATFORM_${randomUUID().slice(0, 6)}`,
    name: 'Infra03 Platform Asset',
    accountType: 'ASSET',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
  });

  for (const label of ['A', 'B']) {
    const r = results[label];
    const wallet = await walletService.createWallet({
      customerId: r.customerId,
      currency: 'NGN',
      idempotencyKey: `infra03-wallet-${label}-${r.customerId}`,
    });
    const fundAmount = label === 'A' ? '10000000' : '1000000'; // A gets 100,000.00 NGN; B gets 10,000.00 NGN
    await ledgerService.postJournal({
      idempotencyKey: `infra03-fund-${label}-${r.customerId}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `infra03-fund-ref-${label}`,
      lines: [
        { accountId: platformAccount.id, direction: 'DEBIT', amountMinor: fundAmount },
        { accountId: wallet.ledgerAccountId, direction: 'CREDIT', amountMinor: fundAmount },
      ],
    });
    results[label].walletId = wallet.id;
    results[label].fundedMinor = fundAmount;
  }

  await app.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('SEED FAILED:', e);
  process.exit(1);
});
