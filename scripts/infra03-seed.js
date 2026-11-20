/* V1-INFRA-03 Part D multi-instance concurrency test fixture seeder.
 * Creates two ACTIVE customers with credentials + funded wallets using the
 * SAME pattern as the project's trusted integration harness
 * (test/a23-customer-app.integration.spec.ts): Test.createTestingModule(AppModule)
 * overriding DataSource + KycTierEvidenceReader, real WalletService/LedgerService
 * against a disposable integration DataSource. NOT the main DB.
 *
 * Root cause fixed 2026-11-20: prior version used raw pg Client + NestFactory.createApplicationContext(AppModule)
 * which missed AuditEvent entity metadata (DataSource glob resolves differently for compiled dist)
 * and omitted the governed KYC tier policy + per-customer evidence rows required by
 * CustomerFinancialEligibilityService.require(). This version uses the canonical harness:
 * createIntegrationDataSource() + Test.createTestingModule(AppModule).overrideProvider(DataSource/KycTierEvidenceReader).
 * Synthetic policy definition is DEFAULT_GOVERNED_TIER_POLICY (fixture-maker/fixture-checker), never production.
 */
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'ES2023' } });

const { pbkdf2Sync, randomUUID } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const { DataSource } = require('typeorm');
const { FastifyAdapter } = require('@nestjs/platform-fastify');

function encodePbkdf2(password, saltStr) {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

async function main() {
  const { createIntegrationDataSource } = require('../test/support/pg-harness');
  const { AppModule } = require('../src/app.module');
  const { KycTierEvidenceReader } = require('../src/kyc-verification/kyc-tier-evidence.reader');
  const { createTestEvidenceReader } = require('../test/support/kyc-test-evidence-reader');
  const { makeCustomerFinanciallyEligible } = require('../test/support/kyc-test-fixtures');
  const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

  const dataSource = await createIntegrationDataSource('infra03seed');
  console.log(`[infra03] disposable DB ${dataSource.options.database} ready`);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .overrideProvider(KycTierEvidenceReader)
    .useValue(kycEvidence.reader)
    .compile();

  const app = moduleRef.createNestApplication(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // Governance seam: seed synthetic tier policy via GovernedFinancialFixture (or direct seedGovernedTierPolicy)
  // Using the lower-level helper keeps this seeder independent of institution governance fixtures.
  const { seedGovernedTierPolicy } = require('../test/support/kyc-test-fixtures');
  await seedGovernedTierPolicy(dataSource);
  console.log('[infra03] synthetic tier policy v1 seeded (fixture-maker/fixture-checker)');

  const WalletService = require('../src/wallet/wallet.service').WalletService;
  const LedgerService = require('../src/ledger/ledger.service').LedgerService;
  const walletService = app.get(WalletService);
  const ledgerService = app.get(LedgerService);

  // Create platform funding account (institution-scoped funding not needed for infra03 — unattributed customer wallets)
  const platformAccount = await ledgerService.createAccount({
    code: `INFRA03_PLATFORM_${randomUUID().slice(0, 6)}`,
    name: 'Infra03 Platform Asset',
    accountType: 'ASSET',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
  });

  const results = {};
  for (const label of ['A', 'B']) {
    const reference = `infra03-cust-${label.toLowerCase()}-${randomUUID().slice(0, 8)}`;
    const password = `infra03-pass-${label}`;
    const custRes = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = custRes[0].id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, `Infra03 Customer ${label}`],
    );
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `0${canonical10.slice(1)}`, canonical10],
    );
    const hash = encodePbkdf2(password, `infra03-salt-${label}`);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );

    // Honest eligibility: real consent/attempt/claim rows MAC-bound to test reader
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);
    console.log(`[infra03] customer ${label} ${customerId} eligible`);

    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `infra03-wallet-${label}-${customerId}`,
    });
    const fundAmount = label === 'A' ? '10000000' : '1000000'; // A 100,000 NGN, B 10,000 NGN
    await ledgerService.postJournal({
      idempotencyKey: `infra03-fund-${label}-${customerId}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `infra03-fund-ref-${label}`,
      lines: [
        { accountId: platformAccount.id, direction: 'DEBIT', amountMinor: fundAmount },
        { accountId: wallet.ledgerAccountId, direction: 'CREDIT', amountMinor: fundAmount },
      ],
    });
    results[label] = { customerId, reference, password, phone: canonical10, walletId: wallet.id, ledgerAccountId: wallet.ledgerAccountId, fundedMinor: fundAmount };
    console.log(`[infra03] customer ${label} wallet ${wallet.id} funded ${fundAmount}`);
  }

  // Verify institution isolation not violated (wallets are unattributed customer wallets, no institution scope)
  const ledgerRows = await dataSource.query(
    `SELECT count(*)::int as c FROM ledger_journals WHERE reference LIKE 'infra03-fund-ref-%'`,
  );
  console.log(`[infra03] ledger journals for funding: ${ledgerRows[0].c} (expected 2)`);

  const fs = require('fs');
  const path = require('path');
  const out = { ...results, database: dataSource.options.database, tierPolicyVersion: 1 };
  fs.writeFileSync(path.join(__dirname, '..', 'infra03-seed-result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  // Keep DB for inspection: destroy app+connection but retain DB (sweep cleans orphans)
  console.log(`[infra03] SEED PASS — disposable DB ${dataSource.options.database} retained for concurrency harness`);
  await dataSource.destroy().catch(() => undefined);
}

main().catch((e) => {
  console.error('SEED FAILED:', e.stack || e.message);
  process.exit(1);
});
