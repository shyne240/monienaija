// Top up Wallet A again so Test D2 (concurrent overdraft race) can be re-run after the
// transfer.service.ts retry-exhaustion fix, without needing to re-seed customers/wallets.
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');

async function main() {
  const walletId = process.argv[2];
  const amountMinor = process.argv[3] || '10000000';
  if (!walletId) {
    throw new Error('usage: node scripts/infra03-topup.js <walletId> [amountMinor]');
  }

  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const { LedgerService } = require('../dist/ledger/ledger.service');
  const { WalletAccount } = require('../dist/wallet/wallet-account.entity');
  const { getDataSourceToken } = require('@nestjs/typeorm');
  const ledgerService = app.get(LedgerService);
  const dataSource = app.get(getDataSourceToken());

  const wallet = await dataSource.getRepository(WalletAccount).findOne({ where: { id: walletId } });
  if (!wallet) throw new Error(`wallet ${walletId} not found`);

  const platformAccount = await ledgerService.createAccount({
    code: `INFRA03_TOPUP_${randomUUID().slice(0, 6)}`,
    name: 'Infra03 Topup Platform Asset',
    accountType: 'ASSET',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
  });

  await ledgerService.postJournal({
    idempotencyKey: `infra03-topup-${randomUUID()}`,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    reference: `infra03-topup-ref-${randomUUID().slice(0, 8)}`,
    lines: [
      { accountId: platformAccount.id, direction: 'DEBIT', amountMinor },
      { accountId: wallet.ledgerAccountId, direction: 'CREDIT', amountMinor },
    ],
  });

  await app.close();
  console.log(JSON.stringify({ walletId, toppedUpMinor: amountMinor }, null, 2));
}

main().catch((e) => {
  console.error('TOPUP FAILED:', e);
  process.exit(1);
});
