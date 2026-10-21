/**
 * DEVELOPMENT ONLY — V1-LOCAL-01 local wallet funding helper.
 *
 * This script does NOT touch wallet/ledger balances directly (no raw SQL against
 * `wallet_accounts` or any balance column). It calls the application's own real,
 * production double-entry ledger service (`LedgerService.postJournal`) — the exact
 * same code path every real money movement in MonieNaija V1 uses — to post one
 * balanced journal: DEBIT a local-only "funding source" ledger account, CREDIT the
 * target customer wallet's real ledger account.
 *
 * Why this exists: V1's only *application-level* way to credit a customer wallet
 * from nothing is the maker-checker Customer Funding Request workflow, which
 * requires a real (or locally-simulated) OIDC workforce principal — see
 * docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md for that real mechanism.
 * That ceremony is appropriate for a real deployment, but far too heavy for
 * "give my local test customer some money to click around with." This script is
 * the pragmatic local-development substitute: it is restricted to this sandbox's
 * own disposable local database, uses the real ledger API (never bypasses
 * double-entry accounting or balance invariants), and must never be pointed at a
 * production database.
 *
 * Usage:
 *   node scripts/local-dev-fund-wallet.js <walletId> <amountNaira>
 *
 * Example:
 *   node scripts/local-dev-fund-wallet.js 3fa85f64-5717-4562-b3fc-2c963f66afa6 50000
 *   (credits that wallet with NGN 50,000.00)
 *
 * Find your wallet id by logging in as the customer and calling:
 *   GET /api/v1/customers/me/wallets  (Authorization: Bearer <session token>)
 *
 * Requires: `npm run build` already run (reads from dist/), and the backend's
 * database reachable using the same DB_* environment variables the backend uses.
 */
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');

const FUNDING_SOURCE_CODE = 'LOCAL_DEV_FUNDING_SOURCE';

async function main() {
  const walletId = process.argv[2];
  const amountNaira = process.argv[3];
  if (!walletId || !amountNaira) {
    console.error('usage: node scripts/local-dev-fund-wallet.js <walletId> <amountNaira>');
    process.exit(1);
  }
  const amountMinor = String(Math.round(Number(amountNaira) * 100));
  if (!Number.isFinite(Number(amountNaira)) || Number(amountNaira) <= 0 || amountMinor === 'NaN') {
    console.error('amountNaira must be a positive number, e.g. 50000 for NGN 50,000.00');
    process.exit(1);
  }

  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const { LedgerService } = require('../dist/ledger/ledger.service');
    const { WalletAccount } = require('../dist/wallet/wallet-account.entity');
    const { getDataSourceToken } = require('@nestjs/typeorm');
    const ledgerService = app.get(LedgerService);
    const dataSource = app.get(getDataSourceToken());

    const wallet = await dataSource
      .getRepository(WalletAccount)
      .findOne({ where: { id: walletId } });
    if (!wallet) {
      throw new Error(`wallet ${walletId} not found — check the id from GET /api/v1/customers/me/wallets`);
    }

    const accountRepository = dataSource.getRepository(
      require('../dist/ledger/ledger-account.entity').LedgerAccount,
    );
    let fundingSource = await accountRepository.findOne({ where: { code: FUNDING_SOURCE_CODE } });
    if (!fundingSource) {
      fundingSource = await ledgerService.createAccount({
        code: FUNDING_SOURCE_CODE,
        name: 'Local Dev Funding Source (DEVELOPMENT ONLY)',
        accountType: 'ASSET',
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
      });
    }

    const journal = await ledgerService.postJournal({
      idempotencyKey: `local-dev-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `local-dev-fund-${walletId}`,
      lines: [
        { accountId: fundingSource.id, direction: 'DEBIT', amountMinor },
        { accountId: wallet.ledgerAccountId, direction: 'CREDIT', amountMinor },
      ],
    });

    console.log(
      JSON.stringify(
        {
          status: 'DEVELOPMENT ONLY — local database only, never run against production',
          walletId,
          creditedMinor: amountMinor,
          creditedNaira: Number(amountMinor) / 100,
          journalId: journal.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('LOCAL DEV FUNDING FAILED:', e.message || e);
  process.exit(1);
});
