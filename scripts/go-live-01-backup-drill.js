// V1-GO-LIVE-01 Part D: Backup/restore rehearsal using server-side COPY (pg_dump/pg_restore
// confirmed absent from this sandbox, including inside @embedded-postgres). This proves the
// COPY-protocol backup/restore MECHANISM works end-to-end (seed -> backup -> fresh DB -> restore
// -> verify), not a full production backup *policy* (retention/scheduling/off-site storage are
// explicitly out of scope and remain REQUIRES REAL INFRASTRUCTURE).
const { Client } = require('pg');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BACKUP_DIR = '/home/user/monienaija/data/backup-drill';
const SRC_DB = 'monienaija';
const RESTORE_DB = 'monienaija_restore_drill';
const CONN = { host: 'localhost', port: 5432, user: 'monienaija', password: 'monienaija-pw' };

const TABLES_IN_DEPENDENCY_ORDER = [
  'customers',
  'ledger_accounts',
  'wallet_accounts',
  'ledger_journals',
  'ledger_lines',
];

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // --- 1. Seed a fresh, verifiable financial fact in the source DB ---
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const { LedgerService } = require('../dist/ledger/ledger.service');
  const { WalletAccount } = require('../dist/wallet/wallet-account.entity');
  const { Customer } = require('../dist/customer/customer.entity');
  const { getDataSourceToken } = require('@nestjs/typeorm');
  const ledgerService = app.get(LedgerService);
  const dataSource = app.get(getDataSourceToken());
  const { randomUUID } = require('node:crypto');

  const customerRepo = dataSource.getRepository(Customer);
  const customer = await customerRepo.save({
    reference: `backup-drill-cust-${randomUUID().slice(0, 8)}`,
    type: 'INDIVIDUAL',
    status: 'ACTIVE',
    kycLevel: 'LEVEL_1',
    kycStatus: 'APPROVED',
  });

  const walletLedgerAccount = await ledgerService.createAccount({
    code: `DRILL_WALLET_${randomUUID().slice(0, 6)}`,
    name: 'Backup Drill Wallet',
    accountType: 'LIABILITY',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
  });
  const wallet = await dataSource.getRepository(WalletAccount).save({
    id: randomUUID(),
    customerId: customer.id,
    ledgerAccountId: walletLedgerAccount.id,
    currency: 'NGN',
    status: 'ACTIVE',
    creationIdempotencyKey: `drill-${randomUUID()}`,
  });

  const platformAccount = await ledgerService.createAccount({
    code: `DRILL_PLATFORM_${randomUUID().slice(0, 6)}`,
    name: 'Backup Drill Platform Asset',
    accountType: 'ASSET',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
  });
  const DRILL_AMOUNT = '777700'; // NGN 7,777.00
  await ledgerService.postJournal({
    idempotencyKey: `drill-fund-${randomUUID()}`,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    reference: `drill-fund-ref-${randomUUID().slice(0, 8)}`,
    lines: [
      { accountId: platformAccount.id, direction: 'DEBIT', amountMinor: DRILL_AMOUNT },
      { accountId: walletLedgerAccount.id, direction: 'CREDIT', amountMinor: DRILL_AMOUNT },
    ],
  });

  const preBalance = await dataSource.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) AS bal
     FROM ledger_lines WHERE ledger_account_id = $1`,
    [walletLedgerAccount.id],
  );
  console.log('SEEDED: customer=%s wallet=%s ledgerAccount=%s balanceMinor=%s',
    customer.id, wallet.id, walletLedgerAccount.id, preBalance[0].bal);

  await app.close();

  // --- 2. Backup: server-side COPY TO for the subset of tables touching this fact ---
  const src = new Client({ ...CONN, database: SRC_DB });
  await src.connect();
  for (const t of TABLES_IN_DEPENDENCY_ORDER) {
    const file = path.join(BACKUP_DIR, `${t}.csv`);
    await src.query(`COPY (SELECT * FROM ${t}) TO '${file}' WITH (FORMAT csv, HEADER true)`);
    const size = fs.statSync(file).size;
    console.log(`BACKED UP ${t} -> ${file} (${size} bytes)`);
  }
  await src.end();

  // --- 3. Provision a brand-new, empty database and run real migrations against it ---
  const admin = new Client({ ...CONN, database: 'postgres' });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${RESTORE_DB}`);
  await admin.query(`CREATE DATABASE ${RESTORE_DB}`);
  await admin.end();
  console.log(`CREATED fresh database ${RESTORE_DB}`);

  const migrateEnv = {
    ...process.env,
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'monienaija',
    DB_PASSWORD: 'monienaija-pw',
    DB_NAME: RESTORE_DB,
  };
  execSync('npx typeorm-ts-node-commonjs migration:run -d src/config/data-source.ts', {
    cwd: '/home/user/monienaija',
    env: migrateEnv,
    stdio: 'inherit',
  });
  console.log(`MIGRATED ${RESTORE_DB} to latest schema`);

  // --- 4. Restore: migrations also insert baseline/system seed rows (e.g. well-known system
  // ledger accounts), so a realistic restore-to-known-state must clear those first, then load the
  // real backed-up data. (This mirrors the real-world caveat that seed-bearing migrations are not
  // idempotent against a full data restore -- documented as a finding below.)
  // NOTE: the schema has deferred constraint triggers (ledger_journal_must_balance /
  // ledger_lines_must_balance_journal) that only re-validate at transaction COMMIT. Restoring
  // table-by-table in separate autocommit statements makes journals briefly "lineless" at the
  // moment their own COPY commits (lines haven't landed yet) and trips a false-positive
  // "not balanced" error. The correct restore procedure is therefore to load every table inside
  // ONE explicit transaction, so the deferred checks only evaluate once, after all tables are
  // fully populated -- this is itself a real operational finding, documented in the report.
  const dst = new Client({ ...CONN, database: RESTORE_DB });
  await dst.connect();
  await dst.query('BEGIN');
  try {
    for (const t of [...TABLES_IN_DEPENDENCY_ORDER].reverse()) {
      await dst.query(`TRUNCATE TABLE ${t} CASCADE`);
    }
    for (const t of TABLES_IN_DEPENDENCY_ORDER) {
      const file = path.join(BACKUP_DIR, `${t}.csv`);
      await dst.query(`COPY ${t} FROM '${file}' WITH (FORMAT csv, HEADER true)`);
      console.log(`RESTORED ${t} <- ${file}`);
    }
    await dst.query('COMMIT');
    console.log('RESTORE TRANSACTION COMMITTED (deferred balance triggers validated clean)');
  } catch (e) {
    await dst.query('ROLLBACK');
    throw e;
  }

  // --- 5. Verify: the restored DB reproduces the exact same financial fact ---
  const restoredWallet = await dst.query('SELECT * FROM wallet_accounts WHERE id = $1', [wallet.id]);
  const restoredBalance = await dst.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END),0) AS bal
     FROM ledger_lines WHERE ledger_account_id = $1`,
    [walletLedgerAccount.id],
  );
  const globalNet = await dst.query(
    `SELECT SUM(CASE WHEN direction='DEBIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END) AS net FROM ledger_lines`,
  );
  console.log('RESTORED wallet row found:', restoredWallet.rows.length === 1);
  console.log('RESTORED wallet balanceMinor:', restoredBalance.rows[0].bal, '(expected', DRILL_AMOUNT, ')');
  console.log('RESTORED global ledger net (should be 0):', globalNet.rows[0].net);
  await dst.end();

  const ok =
    restoredWallet.rows.length === 1 &&
    restoredBalance.rows[0].bal === DRILL_AMOUNT &&
    String(globalNet.rows[0].net) === '0';
  console.log(ok ? 'BACKUP/RESTORE DRILL: PASS' : 'BACKUP/RESTORE DRILL: FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('DRILL FAILED:', e);
  process.exit(1);
});
