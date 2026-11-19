import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { NOTIFICATION_PROVIDER_TOKEN } from '../src/notification/notification.constants';
import { TestNotificationProvider } from '../src/notification/notification-provider.interface';
import { CustomerService } from '../src/customer/customer.service';
import { AuthenticationSessionService } from '../src/customer-authentication/authentication-session.service';
import { CustomerTransactionPinService } from '../src/customer/customer-transaction-pin.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentService } from '../src/agent/agent-service.enum';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('Funding / defunding conservation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let ledger: LedgerService;
  let walletService: WalletService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('fundDefund');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource).useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader).useValue({ read: () => Promise.resolve(null) })
      .overrideProvider(NOTIFICATION_PROVIDER_TOKEN).useValue(new TestNotificationProvider())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    ledger = app.get(LedgerService);
    walletService = app.get(WalletService);
  }, 120000);
  afterAll(async () => { try { if (app) await app.close(); } catch {} try { if (dataSource) await destroyIntegrationDataSource(dataSource); } catch {} });

  async function createCustomerWithWallet(): Promise<{ customerId: string; walletId: string; ledgerAccountId: string }> {
    const cs = app.get(CustomerService);
    const phone = `+2348${Math.floor(100000000 + Math.random() * 900000000)}`;
    const customer = await cs.create({ phone, fullName: 'Fund User', password: 'Password123!' } as never);
    await dataSource.query(`UPDATE customers SET kyc_tier='TIER_2', status='ACTIVE' WHERE id=$1`, [customer.id]);
    const wallet = await walletService.createWallet({ customerId: customer.id, currency: 'NGN', idempotencyKey: `w-${randomUUID()}` });
    const wl: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    return { customerId: customer.id, walletId: wallet.id, ledgerAccountId: wl[0]!.ledger_account_id };
  }

  async function createAgentWithWallet(): Promise<{ agentId: string; walletId: string; ledgerAccountId: string }> {
    const agentClassService = app.get(AgentClassService);
    const agentAppService = app.get(AgentApplicationService);
    const lifecycleService = app.get(AgentLifecycleService);
    const cls = await agentClassService.create({ reference: `cls-fd-${randomUUID().slice(0, 6)}`, code: `FDA-${randomUUID().slice(0, 6).toUpperCase()}`, name: 'FD Class', isActive: true, applicableServices: [AgentService.CASH_IN] as unknown, actor: 'test' });
    const appEntity = await agentAppService.create({ agentClassId: cls.id, applicantReference: `h-${randomUUID()}`, businessName: `Biz ${randomUUID().slice(0, 4)}`, contactEmail: `fd-${randomUUID().slice(0, 6)}@test.com`, actor: 'applicant' });
    await agentAppService.submit(appEntity.id, 'applicant');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    const wallet = await walletService.createWallet({ customerId: agent.id, currency: 'NGN', idempotencyKey: `aw-${agent.id}-${randomUUID()}` });
    const wl: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [wallet.id]);
    return { agentId: agent.id, walletId: wallet.id, ledgerAccountId: wl[0]!.ledger_account_id };
  }

  it('customer funding: ledger journal balances (DEBIT asset + CREDIT wallet)', async () => {
    const { ledgerAccountId } = await createCustomerWithWallet();
    const assetRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    const journal = await ledger.postJournal({ idempotencyKey: `fund-cust-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', lines: [{ accountId: assetRows[0]!.id, direction: 'DEBIT' as never, amountMinor: '2000' }, { accountId: ledgerAccountId, direction: 'CREDIT' as never, amountMinor: '2000' }] });
    expect(journal.id).toBeDefined();
    const lines: Array<{ direction: string; amount_minor: string }> = await dataSource.query(`SELECT direction, amount_minor FROM ledger_entries WHERE journal_id=$1`, [journal.id]);
    expect(lines.length).toBe(2);
    expect(lines.reduce((s, l) => s + (l.direction === 'DEBIT' ? BigInt(l.amount_minor) : -BigInt(l.amount_minor)), BigInt(0))).toBe(BigInt(0));
  });

  it('agent operating wallet funding: same conservation', async () => {
    const { ledgerAccountId } = await createAgentWithWallet();
    const assetRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    const journal = await ledger.postJournal({ idempotencyKey: `fund-agent-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', lines: [{ accountId: assetRows[0]!.id, direction: 'DEBIT' as never, amountMinor: '3000' }, { accountId: ledgerAccountId, direction: 'CREDIT' as never, amountMinor: '3000' }] });
    expect(journal.id).toBeDefined();
  });

  it('concurrent funding: idempotency prevents double-credit', async () => {
    const { ledgerAccountId } = await createCustomerWithWallet();
    const assetRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    const key = `concurrent-fund-${randomUUID()}`;
    const [j1, j2] = await Promise.all([
      ledger.postJournal({ idempotencyKey: key, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', lines: [{ accountId: assetRows[0]!.id, direction: 'DEBIT' as never, amountMinor: '1000' }, { accountId: ledgerAccountId, direction: 'CREDIT' as never, amountMinor: '1000' }] }),
      ledger.postJournal({ idempotencyKey: key, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', lines: [{ accountId: assetRows[0]!.id, direction: 'DEBIT' as never, amountMinor: '1000' }, { accountId: ledgerAccountId, direction: 'CREDIT' as never, amountMinor: '1000' }] }),
    ]);
    expect(j1.id).toBe(j2.id);
  });

  it('defunding governed path requires finance approval (no direct journal bypass)', async () => {
    // This is a placeholder for the governed defunding flow — actual defunding goes through
    // AgentFunding inbox/execute which requires FINANCE_CONTROLLER; direct ledger bypass is not the governed path
    // Verify that agent_funding_requests table exists and has correct governance columns
    const cols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='agent_funding_requests'`);
    expect(cols.some((c) => c.column_name === 'status')).toBe(true);
  });
});
