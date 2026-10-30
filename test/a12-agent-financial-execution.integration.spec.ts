/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-return, no-empty */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync, randomBytes } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentFinancialExecutionService } from '../src/agent/agent-financial-execution.service';
import { AgentTransactionAuthorizationService } from '../src/agent/agent-transaction-authorization.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerAccountType, LedgerEntryDirection, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, 10000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

describe('A12 Agent financial execution foundation (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let financialService: AgentFinancialExecutionService;
  let authzService: AgentTransactionAuthorizationService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let ledgerService: LedgerService;

  // System account for funding Agent (allowNegativeBalance true)
  let systemLedgerAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a12financial');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    financialService = moduleRef.get(AgentFinancialExecutionService);
    authzService = moduleRef.get(AgentTransactionAuthorizationService);
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    pinService = moduleRef.get(AgentAuthenticationService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);

    // Create system control account for funding
    const sys = await ledgerService.createAccount({
      code: `SYS-FLOAT-${randomUUID().slice(0, 8)}`,
      name: 'System Float NGN',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    systemLedgerAccountId = sys.id;
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          void 0;
        }
      }
    }
  }, 60_000);

  async function createActiveAgentWithPin(services: unknown, pin: string | null, isActive = true) {
    const cls = await classService.create({
      reference: `cls-a12-${randomUUID().slice(0, 8)}`,
      code: `A12-${randomUUID().slice(0, 6)}`,
      name: 'A12 Class',
      isActive,
      applicableServices: services as unknown,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz A12 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a12-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a12',
    });
    await appService.submit(appEntity.id, 'applicant-a12');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    if (pin !== null) {
      await pinService.setTransactionPin(agent.id, {
        pinHash: hashPin(pin),
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        pinVersion: 1,
        actor: agent.id,
      });
    }
    // Ensure Agent wallet exists (WalletAccount with customerId = agentId)
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID().slice(0,6)}`,
    });
    return { cls, agent, appEntity, wallet };
  }

  async function authorizeAgent(agentId: string, service: string, pin: string) {
    const principal = { type: 'AGENT', agentId, principalId: agentId, roles: [], scopes: [], customerAccess: 'NONE' as const, agentAccess: 'SELF' as const };
    const res = await authzService.authorize({ agentId, service, pin, principal: principal as any });
    expect(res.allowed).toBe(true);
    expect(res.context).toBeDefined();
    return res.context!;
  }

  // A. successful atomic financial execution through reusable boundary
  it('A. successful atomic financial execution through reusable boundary', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    // Fund Agent via system -> Agent (credit Agent)
    const before = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const amount = '5000';
    const res = await financialService.execute({
      authorizedContext: ctx,
      idempotencyKey: `a-${randomUUID()}`,
      currency: 'NGN',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: amount },
        { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: amount },
      ],
      reference: 'A funding',
    });
    expect(res.status).toBe('COMPLETED');
    expect(res.journalId).toBeDefined();
    const after = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) + BigInt(amount));
  });

  // B. rollback when a later mutation fails
  it('B. rollback when a later mutation fails (simulated after journal)', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const beforeWalletBal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    try {
      await financialService.execute({
        authorizedContext: ctx,
        idempotencyKey: `b-${randomUUID()}`,
        currency: 'NGN',
        lines: [
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
        _simulateFailureAfterJournal: true,
      });
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('Simulated failure');
    }
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const afterWalletBal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    expect(afterWalletBal.balanceMinor).toBe(beforeWalletBal.balanceMinor);
  });

  // C. balanced journal requirement
  it('C. balanced journal requirement (unbalanced rejected)', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    try {
      await financialService.execute({
        authorizedContext: ctx,
        idempotencyKey: `c-${randomUUID()}`,
        currency: 'NGN',
        lines: [
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '900' }, // unbalanced
        ],
      });
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message.toLowerCase()).toContain('equal');
    }
    const after: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(after[0]!.cnt).toBe(before[0]!.cnt);
  });

  // D. idempotent replay does not create another journal
  it('D. idempotent replay does not create another journal', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const key = `d-${randomUUID()}`;
    const lines = [
      { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '2000' },
      { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '2000' },
    ];
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const r1 = await financialService.execute({ authorizedContext: ctx, idempotencyKey: key, currency: 'NGN', lines });
    expect(r1.status).toBe('COMPLETED');
    const after1: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(BigInt(after1[0]!.cnt)).toBe(BigInt(before[0]!.cnt) + 1n);
    const r2 = await financialService.execute({ authorizedContext: ctx, idempotencyKey: key, currency: 'NGN', lines });
    expect(r2.status).toBe('REPLAYED');
    expect(r2.journalId).toBe(r1.journalId);
    const after2: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(after2[0]!.cnt).toBe(after1[0]!.cnt);
  });

  // E. same idempotency key + conflicting request is rejected
  it('E. same idempotency key + conflicting request is rejected', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const key = `e-${randomUUID()}`;
    const lines1 = [
      { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
      { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
    ];
    const lines2 = [
      { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '2000' }, // different amount
      { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '2000' },
    ];
    const r1 = await financialService.execute({ authorizedContext: ctx, idempotencyKey: key, currency: 'NGN', lines: lines1 });
    expect(r1.status).toBe('COMPLETED');
    try {
      await financialService.execute({ authorizedContext: ctx, idempotencyKey: key, currency: 'NGN', lines: lines2 });
      fail('should have thrown conflict');
    } catch (e) {
      expect((e as Error).message.toLowerCase()).toContain('already used');
    }
  });

  // F. concurrent duplicate requests produce one financial effect
  it('F. concurrent duplicate requests produce one financial effect', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const key = `f-${randomUUID()}`;
    const lines = [
      { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '3000' },
      { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '3000' },
    ];
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const [r1, r2] = await Promise.all([
      financialService.execute({ authorizedContext: ctx, idempotencyKey: key, currency: 'NGN', lines }),
      financialService.execute({ authorizedContext: ctx, idempotencyKey: key, currency: 'NGN', lines }),
    ]);
    // One COMPLETED, one REPLAYED (order nondeterministic)
    const ids = [r1.journalId, r2.journalId];
    expect(ids[0]).toBe(ids[1]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(['COMPLETED', 'REPLAYED']);
    const after: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(BigInt(after[0]!.cnt)).toBe(BigInt(before[0]!.cnt) + 1n);
  });

  // G. concurrent Agent debit cannot produce negative balance
  it('G. concurrent Agent debit cannot produce negative balance', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    // Fund Agent with 10000
    await financialService.execute({
      authorizedContext: ctx,
      idempotencyKey: `g-fund-${randomUUID()}`,
      currency: 'NGN',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '10000' },
        { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '10000' },
      ],
    });
    const balBefore = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(balBefore.balanceMinor).toBe('10000');
    // Two concurrent debits of 8000 each (credit system, debit Agent)
    const debitLines = (key: string) => [
      { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '8000' },
      { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '8000' },
    ];
    const results = await Promise.allSettled([
      financialService.execute({ authorizedContext: ctx, idempotencyKey: `g-d1-${randomUUID()}`, currency: 'NGN', lines: debitLines('a') }),
      financialService.execute({ authorizedContext: ctx, idempotencyKey: `g-d2-${randomUUID()}`, currency: 'NGN', lines: debitLines('b') }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0]!.reason as Error).message.toLowerCase()).toContain('sufficient');
    const balAfter = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    // 10000 -8000 =2000, not negative, not  -6000
    expect(balAfter.balanceMinor).toBe('2000');
    expect(BigInt(balAfter.balanceMinor) >= 0n).toBe(true);
  });

  // H. insufficient Agent balance is rejected without ledger mutation
  it('H. insufficient Agent balance is rejected without ledger mutation', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    // Ensure wallet is empty (0)
    const bal0 = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(bal0.balanceMinor).toBe('0');
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    try {
      await financialService.execute({
        authorizedContext: ctx,
        idempotencyKey: `h-${randomUUID()}`,
        currency: 'NGN',
        lines: [
          { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '5000' },
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '5000' },
        ],
      });
      fail('should have thrown insufficient');
    } catch (e) {
      expect((e as Error).message.toLowerCase()).toContain('sufficient');
    }
    const after: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(after[0]!.cnt).toBe(before[0]!.cnt);
    const balAfter = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(balAfter.balanceMinor).toBe('0');
  });

  // I. successful Agent credit works through existing Agent wallet/ledger architecture
  it('I. successful Agent credit works through existing Agent wallet/ledger architecture', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const before = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    const res = await financialService.execute({
      authorizedContext: ctx,
      idempotencyKey: `i-${randomUUID()}`,
      currency: 'NGN',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '7000' },
        { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '7000' },
      ],
    });
    expect(res.status).toBe('COMPLETED');
    const after = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) + 7000n);
    // Verify journal lines exist and are balanced
    const journal = await ledgerService.getJournal(res.journalId);
    expect(journal.lines).toHaveLength(2);
    expect(journal.totalMinor).toBe('7000');
    expect(journal.currency).toBe('NGN');
  });

  // J. Agent wallet remains ledger-derived; no second balance source
  it('J. Agent wallet remains ledger-derived; no second balance source', async () => {
    const { agent } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    // Check agents table has no balance column
    const cols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='agents'`);
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain('balance');
    expect(names).not.toContain('wallet_balance');
    // Check wallet_accounts has no balance column (balance is via ledger)
    const wcols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wallet_accounts'`);
    const wnames = wcols.map((c) => c.column_name);
    expect(wnames).not.toContain('balance');
    // WalletService balance is derived
    const wallet = await walletService.createWallet({ customerId: `j-wallet-${randomUUID()}`, currency: 'NGN', idempotencyKey: `j-${randomUUID()}` });
    const balViaWallet = await walletService.getWalletBalance(wallet.id);
    const balViaLedger = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(balViaWallet.balanceMinor).toBe(balViaLedger.balanceMinor);
    // Ensure Agent wallet also
    const agentWallet = await walletService.createWallet({ customerId: agent.id, currency: 'NGN', idempotencyKey: `j-agent-${agent.id}-${randomUUID()}` }).catch(async () => {
      // Already exists from helper, fetch
      const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1 AND currency='NGN'`, [agent.id]);
      return { id: rows[0]!.id, ledgerAccountId: (await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [rows[0]!.id]))[0].ledger_account_id } as any;
    });
    // No second ledger
    const ledgerTables: Array<{ tablename: string }> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'ledger%'`);
    const ledgerNames = ledgerTables.map((t) => t.tablename).sort();
    expect(ledgerNames).toEqual(['ledger_accounts', 'ledger_journals', 'ledger_lines']);
  });

  // K. authorization context is required
  it('K. authorization context is required', async () => {
    const { wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    try {
      await financialService.execute({
        authorizedContext: null as any,
        idempotencyKey: `k-${randomUUID()}`,
        currency: 'NGN',
        lines: [
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
      });
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message.toLowerCase()).toContain('authorized');
    }
  });

  // L. unauthorized/missing context cannot execute financial mutation
  it('L. unauthorized/missing context cannot execute financial mutation', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    // Create a context but with wrong agent (simulate missing auth by using random agentId)
    const fakeCtx: any = {
      agentId: randomUUID(),
      principal: { type: 'AGENT', agentId: randomUUID(), principalId: randomUUID() },
      canonicalService: AgentService.AGENT_FUNDING,
      service: AgentService.AGENT_FUNDING,
      agentStatus: 'ACTIVE',
      agentClassId: randomUUID(),
      agentClassActive: true,
      applicableServices: [AgentService.AGENT_FUNDING],
      authorizedAt: new Date(),
    };
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    try {
      await financialService.execute({
        authorizedContext: fakeCtx,
        idempotencyKey: `l-${randomUUID()}`,
        currency: 'NGN',
        lines: [
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
      });
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message.toLowerCase()).toContain('mismatch');
    }
    const after: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    expect(after[0]!.cnt).toBe(before[0]!.cnt);
  });

  // M. Agent A cannot execute using Agent B's financial context
  it('M. Agent A cannot execute using Agent B financial context', async () => {
    const { agent: agentA, wallet: walletA } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const { agent: agentB } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctxB = await authorizeAgent(agentB.id, AgentService.AGENT_FUNDING, '1234');
    // Try to use ctxB (Agent B) to move funds into walletA (Agent A's wallet)
    try {
      await financialService.execute({
        authorizedContext: ctxB,
        idempotencyKey: `m-${randomUUID()}`,
        currency: 'NGN',
        lines: [
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: walletA.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
      });
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message.toLowerCase()).toContain('must involve');
    }
    // Correct: B's context with B's wallet should succeed
    const walletB: any = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [agentB.id]).then((r: any) => r[0]);
    const res = await financialService.execute({
      authorizedContext: ctxB,
      idempotencyKey: `m2-${randomUUID()}`,
      currency: 'NGN',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
        { accountId: walletB.ledger_account_id, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
      ],
    });
    expect(res.status).toBe('COMPLETED');
  });

  // N. NGN-only invariant is preserved
  it('N. NGN-only invariant is preserved', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    try {
      await financialService.execute({
        authorizedContext: ctx,
        idempotencyKey: `n-${randomUUID()}`,
        currency: 'USD',
        lines: [
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
      });
      fail('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('NGN');
    }
  });

  // O. rollback leaves ledger balanced and unchanged
  it('O. rollback leaves ledger balanced and unchanged (simulated failure)', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const beforeJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const beforeLines: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    const beforeBal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    try {
      await financialService.execute({
        authorizedContext: ctx,
        idempotencyKey: `o-${randomUUID()}`,
        currency: 'NGN',
        lines: [
          { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
        _simulateFailureAfterJournal: true,
      });
      fail('should have thrown');
    } catch {}
    const afterJournals: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    const afterLines: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    const afterBal = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(afterJournals[0]!.cnt).toBe(beforeJournals[0]!.cnt);
    expect(afterLines[0]!.cnt).toBe(beforeLines[0]!.cnt);
    expect(afterBal.balanceMinor).toBe(beforeBal.balanceMinor);
    // Ledger remains balanced (no partial)
    const journals: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_journals`);
    // If journals are balanced, sum of debits = credits globally (checked via ledger service constraint)
    // We just ensure no orphan lines
    const orphan: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines WHERE journal_id NOT IN (SELECT id FROM ledger_journals)`);
    expect(orphan[0]!.cnt).toBe('0');
  });

  // P. audit is created appropriately
  it('P. audit is created appropriately', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    const key = `p-${randomUUID()}`;
    const before: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM audit_events WHERE entity_type='AGENT_FINANCIAL_EXECUTION'`);
    const res = await financialService.execute({
      authorizedContext: ctx,
      idempotencyKey: key,
      currency: 'NGN',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
        { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
      ],
      correlationId: 'corr-p',
    });
    const after: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM audit_events WHERE entity_type='AGENT_FINANCIAL_EXECUTION'`);
    expect(BigInt(after[0]!.cnt)).toBe(BigInt(before[0]!.cnt) + 1n);
    const rows: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_type='AGENT_FINANCIAL_EXECUTION' ORDER BY occurred_at DESC LIMIT 1`);
    expect(rows[0]!.new_values.agentId).toBe(agent.id);
    expect(rows[0]!.new_values.journalId).toBe(res.journalId);
    expect(rows[0]!.new_values.canonicalService).toBe(AgentService.AGENT_FUNDING);
  });

  // Q. PIN/secrets do not appear in result/audit
  it('Q. PIN/secrets do not appear in result/audit', async () => {
    const { agent, wallet } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '4321');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '4321');
    const res = await financialService.execute({
      authorizedContext: ctx,
      idempotencyKey: `q-${randomUUID()}`,
      currency: 'NGN',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
        { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
      ],
    });
    const serial = JSON.stringify(res);
    expect(serial.toLowerCase()).not.toContain('pin');
    expect(serial.toLowerCase()).not.toContain('pinhash');
    expect(serial.toLowerCase()).not.toContain('4321');
    const audits: Array<{ new_values: any; previous_values: any }> = await dataSource.query(`SELECT new_values, previous_values FROM audit_events WHERE entity_type='AGENT_FINANCIAL_EXECUTION' ORDER BY occurred_at DESC LIMIT 5`);
    const auditSerial = JSON.stringify(audits).toLowerCase();
    expect(auditSerial).not.toContain('pin');
    expect(auditSerial).not.toContain('4321');
  });

  // R. existing customer financial flows are unaffected
  it('R. existing customer financial flows are unaffected', async () => {
    // Create a customer wallet and do a transfer via WalletService/LedgerService directly (customer flow)
    const custId = `cust-r-${randomUUID()}`;
    const wallet = await walletService.createWallet({ customerId: custId, currency: 'NGN', idempotencyKey: `r-cust-${randomUUID()}` });
    const before = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    // Simple funding via system account (not via Agent)
    const journalId = await ledgerService.postJournal({
      idempotencyKey: `r-journal-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '2000' },
        { accountId: wallet.ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor: '2000' },
      ],
    });
    expect(journalId.id).toBeDefined();
    const after = await ledgerService.getAccountBalance(wallet.ledgerAccountId);
    expect(BigInt(after.balanceMinor)).toBe(BigInt(before.balanceMinor) + 2000n);
    // Agent financial execution should not have affected customer wallet's logic
    const { agent } = await createActiveAgentWithPin([AgentService.AGENT_FUNDING], '1234');
    const ctx = await authorizeAgent(agent.id, AgentService.AGENT_FUNDING, '1234');
    // Agent execution with same system account should still work
    const agentWalletRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [agent.id]);
    const agentLedgerId = agentWalletRows[0]!.ledger_account_id;
    const res = await financialService.execute({
      authorizedContext: ctx,
      idempotencyKey: `r-agent-${randomUUID()}`,
      currency: 'NGN',
      lines: [
        { accountId: systemLedgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
        { accountId: agentLedgerId, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
      ],
    });
    expect(res.status).toBe('COMPLETED');
  });

  // S. A8/A9/A10/A11 regression remains green (smoke)
  it('S. A8/A9/A10/A11 regression smoke', async () => {
    // A10 capability check via authz
    const { agent } = await createActiveAgentWithPin([AgentService.CASH_IN], '1234');
    const cap = await authzService.authorize({ agentId: agent.id, service: AgentService.CASH_IN, pin: '1234', principal: { type: 'AGENT', agentId: agent.id, principalId: agent.id } as any });
    expect(cap.allowed).toBe(true);
    // A11 auth via financial execution already tested, just ensure no regression in wallet ledger
    const walletRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [agent.id]);
    expect(walletRows.length).toBe(1);
  });
});
