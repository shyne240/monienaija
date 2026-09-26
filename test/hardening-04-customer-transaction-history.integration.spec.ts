/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, createHash, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'a23-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
function sha64(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

describe('V1-HARDENING-04 Customer Transaction History Unification (real PostgreSQL) — 25 cases', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('h04unify');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => dataSource.destroy().catch(() => undefined));
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createCustomer(opts: { displayName?: string; password?: string; kycLevel?: string; kycStatus?: string } = {}): Promise<{ customerId: string; token: string; phone10: string }> {
    const reference = `cust-h04-${randomUUID()}`;
    const displayName = opts.displayName ?? 'H04 Customer';
    const password = opts.password ?? 'pw-h04-correct';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE',$2,$3) RETURNING id`,
      [reference, opts.kycLevel ?? 'LEVEL_1', opts.kycStatus ?? 'APPROVED'],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, displayName]);
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`, [customerId, `0${canonical10.slice(1)}`, canonical10]);
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    const token = login.body.accessToken as string;
    expect(token).toBeTruthy();
    return { customerId, token, phone10: canonical10 };
  }

  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [`cls-h04-${randomUUID().slice(0, 8)}`, `H04-${randomUUID().slice(0,6)}`, 'H04 Class', JSON.stringify(['CASH_IN']), JSON.stringify({})],
    );
    const classId = classRows[0]!.id;
    const ref = `agent-h04-${randomUUID()}`;
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [ref, classId]);
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-h04', 'agent-salt');
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'agent-pass-h04' }).expect(200);
    return login.body.accessToken as string;
  }

  async function createWallet(customerId: string, currency = 'NGN'): Promise<{ walletAccountId: string; ledgerAccountId: string; customerWalletId: string; bindingId: string }> {
    const { WalletService } = await import('../src/wallet/wallet.service');
    const walletService = app.get(WalletService);
    const wallet = await walletService.createWallet({ customerId, currency, idempotencyKey: `h04w-${customerId}-${randomUUID().slice(0,8)}` });
    // WalletService returns { id, ledgerAccountId } but we also need customerWalletId/binding
    // Fetch binding to get ids for later
    const bindings: Array<{ id: string; customer_wallet_id: string }> = await dataSource.query(
      `SELECT id, customer_wallet_id FROM customer_financial_account_bindings WHERE wallet_account_id=$1 AND state='ACTIVE' LIMIT 1`,
      [wallet.id],
    );
    const binding = bindings[0];
    return { walletAccountId: wallet.id, ledgerAccountId: wallet.ledgerAccountId, customerWalletId: binding?.customer_wallet_id ?? randomUUID(), bindingId: binding?.id ?? randomUUID() };
  }

  async function ensureLedgerAccount(code: string, type: 'ASSET'|'LIABILITY' = 'ASSET'): Promise<string> {
    const existing: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code=$1`, [code]);
    if (existing.length) return existing[0]!.id;
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active) VALUES ($1,$2,$3,$4,$5,'NGN','CUSTOMER_FUNDS',false,true)`,
      [id, code, code, type, type === 'ASSET' ? 'DEBIT' : 'CREDIT'],
    );
    return id;
  }

  async function insertJournalWithLines(opts: {
    currency?: string;
    totalMinor: string;
    lines: Array<{ accountId: string; direction: 'DEBIT'|'CREDIT'; amountMinor: string }>;
    metadata?: any;
    reference?: string;
    description?: string;
    createdAt?: Date;
    idempotencyKey?: string;
  }): Promise<string> {
    const id = randomUUID();
    const idempotencyKey = opts.idempotencyKey ?? `h04j-${randomUUID()}`;
    const requestHash = sha64(idempotencyKey);
    const createdAt = opts.createdAt ?? new Date();
    const metadata = opts.metadata ? JSON.stringify(opts.metadata) : '{}';
    try {
      await dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO ledger_journals (id, idempotency_key, request_hash, currency, accounting_unit, status, reference, description, metadata, total_minor, created_at, posted_at) VALUES ($1,$2,$3,$4,'CUSTOMER_FUNDS','POSTED',$5,$6,$7::jsonb,$8,$9,$9)`,
          [id, idempotencyKey, requestHash, opts.currency ?? 'NGN', opts.reference ?? `ref-${randomUUID().slice(0,8)}`, opts.description ?? `desc-${randomUUID().slice(0,8)}`, metadata, opts.totalMinor, createdAt],
        );
        let lineNumber = 1;
        for (const l of opts.lines) {
          await manager.query(
            `INSERT INTO ledger_lines (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'CUSTOMER_FUNDS',$8)`,
            [randomUUID(), id, l.accountId, lineNumber++, l.direction, l.amountMinor, opts.currency ?? 'NGN', createdAt],
          );
        }
      });
    } catch (e:any) {
      console.error('insertJournal failed', { id, totalMinor: opts.totalMinor, lines: opts.lines, metadata, error: e.message });
      throw e;
    }
    return id;
  }

  async function insertTransfer(opts: { sourceWalletId: string; destWalletId: string; amountMinor: string; status: 'COMPLETED'|'FAILED'; createdAt?: Date; sourceLedgerId?: string; destLedgerId?: string; failureCode?: string }): Promise<string> {
    const id = randomUUID();
    const createdAt = opts.createdAt ?? new Date();
    const completedAt = opts.status === 'COMPLETED' ? createdAt : null;
    const idempotencyKey = `h04tr-${randomUUID()}`;
    const requestHash = sha64(`${opts.sourceWalletId}-${opts.destWalletId}-${opts.amountMinor}`);
    let journalId: string | null = null;
    if (opts.status === 'COMPLETED') {
      const srcLedger = opts.sourceLedgerId ?? (await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [opts.sourceWalletId]))[0]?.ledger_account_id;
      const dstLedger = opts.destLedgerId ?? (await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [opts.destWalletId]))[0]?.ledger_account_id;
      const plat = await ensureLedgerAccount(`PLAT_H04_${randomUUID().slice(0,5)}`, 'ASSET');
      // For transfer, balanced between source (DEBIT) and dest (CREDIT) — amount moves; but we need to obey non-negative check.
      // To avoid negative balance violation, first fund source wallet via plat->source, then transfer source->dest
      // Instead we use transfer journal that debits source liability and credits dest liability? That would net zero but ledger checks negative balance later across all journals.
      // Liability accounts start at 0. Debit source would make source negative unless previously funded.
      // So we pre-fund source via plat if needed.
      // For test simplicity, we pre-fund source with enough before creating transfer journal.
      // Check current balance of source: sum credits - debits
      const balRows: Array<{ bal: string }> = await dataSource.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END),0)::text as bal FROM ledger_lines WHERE ledger_account_id=$1`,
        [srcLedger],
      );
      const bal = Number(balRows[0]?.bal ?? '0');
      if (bal < Number(opts.amountMinor)) {
        const topUp = String(Number(opts.amountMinor) * 2 + 5000);
        const topUpJournal = await insertJournalWithLines({
          totalMinor: topUp,
          lines: [{ accountId: plat, direction: 'DEBIT', amountMinor: topUp }, { accountId: srcLedger, direction: 'CREDIT', amountMinor: topUp }],
          reference: `prefund-${randomUUID().slice(0,6)}`,
          createdAt: new Date(createdAt.getTime() - 1000),
        });
        // journal created, balance now sufficient
      }
      journalId = await insertJournalWithLines({
        totalMinor: opts.amountMinor,
        lines: [{ accountId: srcLedger, direction: 'DEBIT', amountMinor: opts.amountMinor }, { accountId: dstLedger, direction: 'CREDIT', amountMinor: opts.amountMinor }],
        reference: `tr-${randomUUID().slice(0,6)}`,
        description: `transfer ${opts.amountMinor}`,
        createdAt,
      });
    }
    await dataSource.query(
      `INSERT INTO transfers (id, source_wallet_id, destination_wallet_id, journal_id, amount_minor, currency, status, idempotency_key, request_hash, reference, narration, failure_code, created_at, completed_at, updated_at) VALUES ($1,$2,$3,$4,$5,'NGN',$6,$7,$8,$9,$10,$11,$12,$13,$12)`,
      [id, opts.sourceWalletId, opts.destWalletId, journalId, opts.amountMinor, opts.status, idempotencyKey, requestHash, `ref-${randomUUID().slice(0,6)}`, `narr-${randomUUID().slice(0,6)}`, opts.failureCode ?? null, createdAt, completedAt],
    );
    return id;
  }

  async function insertFunding(opts: { customerId: string; amountMinor: string; status: 'PENDING'|'APPROVED'|'REJECTED'; createdAt?: Date; externalReference?: string; channel?: string; description?: string }): Promise<string> {
    const id = randomUUID();
    const createdAt = opts.createdAt ?? new Date();
    const idempotencyKey = `h04fund-${randomUUID()}`;
    const requestHash = sha64(`${opts.customerId}-${opts.amountMinor}-${randomUUID()}`);
    const reference = `FND-${randomUUID().slice(0,8)}`;
    let journalId: string | null = null;
    if (opts.status === 'APPROVED') {
      // Create settlement asset and credit wallet
      const wRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [opts.customerId]);
      const ledgerId = wRows[0]?.ledger_account_id ?? (await createWallet(opts.customerId)).ledgerAccountId;
      const settlement = await ensureLedgerAccount(`SETTLE_H04_${randomUUID().slice(0,5)}`, 'ASSET');
      journalId = await insertJournalWithLines({
        totalMinor: opts.amountMinor,
        lines: [{ accountId: settlement, direction: 'DEBIT', amountMinor: opts.amountMinor }, { accountId: ledgerId, direction: 'CREDIT', amountMinor: opts.amountMinor }],
        reference,
        description: opts.description ?? 'funding approve',
        createdAt: new Date(createdAt.getTime() + 100),
      });
    }
    const approvedAt = opts.status === 'APPROVED' ? new Date(createdAt.getTime() + 500) : null;
    const rejectedAt = opts.status === 'REJECTED' ? new Date(createdAt.getTime() + 500) : null;
    await dataSource.query(
      `INSERT INTO customer_funding_requests (id, customer_id, amount_minor, currency, status, external_reference, channel, description, maker_id, maker_type, checker_id, checker_type, journal_id, reference, idempotency_key, request_hash, correlation_id, rejection_reason, created_at, updated_at, approved_at, rejected_at, version) VALUES ($1,$2,$3,'NGN',$4,$5,$6,$7,$8,'SUPPORT',$9,'SUPPORT',$10,$11,$12,$13,$14,$15,$16,$16,$17,$18,1)`,
      [id, opts.customerId, opts.amountMinor, opts.status, opts.externalReference ?? null, opts.channel ?? 'BANK_TRANSFER', opts.description ?? 'fund desc', `maker-${randomUUID().slice(0,6)}`, null, journalId, reference, idempotencyKey, requestHash, `corr-${randomUUID().slice(0,6)}`, opts.status==='REJECTED' ? 'insufficient docs' : null, createdAt, approvedAt, rejectedAt],
    );
    return id;
  }

  async function insertCashToCash(opts: { agentId?: string; beneficiaryPhone: string; principalMinor: string; status: 'UNCLAIMED'|'CLAIMED'|'EXPIRED'; createdAt?: Date; claimantCustomerId?: string }): Promise<string> {
    const id = randomUUID();
    const createdAt = opts.createdAt ?? new Date();
    let agentId = opts.agentId;
    if (!agentId) {
      const classRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,'[]','{}') RETURNING id`, [`c2c-cls-${randomUUID().slice(0,6)}`, `C2C-${randomUUID().slice(0,6)}`, 'c2c']);
      const classId = classRows[0]!.id;
      const agRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [`ag-c2c-${randomUUID().slice(0,6)}`, classId]);
      agentId = agRows[0]!.id;
    }
    const reference = `C2C-${randomUUID().slice(0,8)}`;
    const idempotencyKey = `c2c-${randomUUID()}`;
    const requestHash = sha64(idempotencyKey);
    const expiresAt = new Date(createdAt.getTime() + 3600_000);
    const claimedAt = opts.status === 'CLAIMED' ? new Date(createdAt.getTime() + 60000) : null;
    const expiredAt = opts.status === 'EXPIRED' ? expiresAt : null;
    // Create ledger journal for cash_to_cash: need to balance via unclaimed liability account
    // Fetch wallets for agent to create balanced journal: agent wallet -> unclaimed
    // Ensure agent has wallet
    const agentWalletRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [agentId]);
    let agentLedgerId = agentWalletRows[0]?.ledger_account_id;
    if (!agentLedgerId) {
      // create agent wallet via WalletService using agentId as customerId (WalletService expects customerId uuid, agentId is uuid so okay)
      const { WalletService: WS2 } = await import('../src/wallet/wallet.service');
      const ws2 = app.get(WS2);
      try {
        const w = await ws2.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `c2c-agent-w-${agentId}-${randomUUID().slice(0,6)}` });
        agentLedgerId = w.ledgerAccountId;
      } catch (e) {
        // fallback: create ledger account manually
        agentLedgerId = await ensureLedgerAccount(`C2C_AGENT_${randomUUID().slice(0,6)}`, 'LIABILITY');
        await dataSource.query(`INSERT INTO wallet_accounts (id, customer_id, currency, ledger_account_id, status) VALUES ($1,$2,'NGN',$3,'ACTIVE')`, [randomUUID(), agentId, agentLedgerId]);
      }
    }
    // Find unclaimed account
    const unclaimedRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN' LIMIT 1`);
    let unclaimedLedgerId = unclaimedRows[0]?.id;
    if (!unclaimedLedgerId) {
      unclaimedLedgerId = await ensureLedgerAccount('CASH_TO_CASH-UNCLAIMED-NGN', 'LIABILITY');
    }
    const totalMinor = String(Number(opts.principalMinor)+110);
    // Pre-fund agent wallet if needed for UNCLAIMED debit
    const balRows: Array<{ bal: string }> = await dataSource.query(`SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0)::text as bal FROM ledger_lines WHERE ledger_account_id=$1`, [agentLedgerId]);
    const bal = Number(balRows[0]?.bal ?? '0');
    if (bal < Number(totalMinor)) {
      const plat = await ensureLedgerAccount(`PLAT_C2C_${randomUUID().slice(0,5)}`, 'ASSET');
      await insertJournalWithLines({ totalMinor: String(Number(totalMinor)+5000), lines: [{ accountId: plat, direction: 'DEBIT', amountMinor: String(Number(totalMinor)+5000) }, { accountId: agentLedgerId, direction: 'CREDIT', amountMinor: String(Number(totalMinor)+5000) }], reference: `prefund-c2c-${randomUUID().slice(0,6)}`, createdAt: new Date(createdAt.getTime()-1000) });
    }
    let journalId: string | null = null;
    // Create journal for UNCLAIMED: debit agent, credit unclaimed (balanced)
    journalId = await insertJournalWithLines({ totalMinor, lines: [{ accountId: agentLedgerId, direction: 'DEBIT', amountMinor: totalMinor }, { accountId: unclaimedLedgerId, direction: 'CREDIT', amountMinor: totalMinor }], reference, description: 'cash to cash create', createdAt });
    // For CLAIMED, need additional claim journal: debit unclaimed, credit claimant wallet
    let claimJournalId: string | null = null;
    if (opts.status === 'CLAIMED' && opts.claimantCustomerId) {
      const claimantRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [opts.claimantCustomerId]);
      let claimantLedgerId = claimantRows[0]?.ledger_account_id;
      if (!claimantLedgerId) {
        const { WalletService: WS3 } = await import('../src/wallet/wallet.service');
        const ws3 = app.get(WS3);
        const w = await ws3.createWallet({ customerId: opts.claimantCustomerId, currency: 'NGN', idempotencyKey: `c2c-claim-w-${opts.claimantCustomerId}-${randomUUID().slice(0,6)}` });
        claimantLedgerId = w.ledgerAccountId;
      }
      claimJournalId = await insertJournalWithLines({ totalMinor: opts.principalMinor, lines: [{ accountId: unclaimedLedgerId, direction: 'DEBIT', amountMinor: opts.principalMinor }, { accountId: claimantLedgerId, direction: 'CREDIT', amountMinor: opts.principalMinor }], reference: `claim-${randomUUID().slice(0,6)}`, description: 'cash to cash claim', createdAt: claimedAt! });
    }
    // Hash for transfer code
    const transferCodeHash = pbkdf2Sync('12345678', Buffer.from('salt'), 10000, 32, 'sha256').toString('base64url');
    await dataSource.query(
      `INSERT INTO cash_to_cash_transfers (id, agent_id, beneficiary_phone, principal_minor, fee_minor, vat_minor, total_minor, currency, status, transfer_code_hash, hash_algorithm, transfer_code_version, failed_attempts, is_locked, journal_id, reference, idempotency_key, correlation_id, expires_at, expired_at, claimant_customer_id, claimed_at, claim_journal_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'NGN',$8,$9,'PBKDF2',1,0,false,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
      [id, agentId, opts.beneficiaryPhone, opts.principalMinor, '100', '10', totalMinor, opts.status, transferCodeHash, journalId, reference, idempotencyKey, null, expiresAt, expiredAt, opts.claimantCustomerId ?? null, claimedAt, claimJournalId, createdAt],
    );
    return id;
  }

  async function insertCashInOut(opts: { walletLedgerId: string; amountMinor: string; service: 'CASH_IN'|'CASH_OUT'; createdAt: Date; agentId?: string }): Promise<string> {
    const platform = await ensureLedgerAccount('SHARED_CASH_H04', 'ASSET');
    // Ensure shared platform has large initial balance for CASH_OUT credits
    const platBalCheck: Array<{ bal: string }> = await dataSource.query(`SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_minor ELSE -amount_minor END),0)::text as bal FROM ledger_lines WHERE ledger_account_id=$1`, [platform]);
    if (Number(platBalCheck[0]?.bal ?? '0') < 5000000) {
      // Fund platform from equity liability (balanced: DEBIT asset platform, CREDIT liability equity)
      const equityId = await ensureLedgerAccount('SHARED_EQUITY_H04', 'LIABILITY');
      // Allow equity to be credited without negative check issues (liability credit increases, so okay)
      try {
        await dataSource.transaction(async (manager) => {
          const jid = randomUUID();
          const idk = `fund-shared-${randomUUID()}`;
          const rh = sha64(idk);
          const now = new Date(Date.now() - 10000);
          await manager.query(`INSERT INTO ledger_journals (id, idempotency_key, request_hash, currency, accounting_unit, status, reference, description, metadata, total_minor, created_at, posted_at) VALUES ($1,$2,$3,'NGN','CUSTOMER_FUNDS','POSTED',$4,$5,'{}'::jsonb,$6,$7,$7)`, [jid, idk, rh, `fund-${randomUUID().slice(0,6)}`, 'fund shared', '5000000', now]);
          await manager.query(`INSERT INTO ledger_lines (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit, created_at) VALUES ($1,$2,$3,1,'DEBIT','5000000','NGN','CUSTOMER_FUNDS',$4)`, [randomUUID(), jid, platform, now]);
          await manager.query(`INSERT INTO ledger_lines (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit, created_at) VALUES ($1,$2,$3,2,'CREDIT','5000000','NGN','CUSTOMER_FUNDS',$4)`, [randomUUID(), jid, equityId, now]);
        });
      } catch (e) {}
    }
    const metadata = { canonicalService: opts.service, agentId: opts.agentId ?? `agent-${randomUUID().slice(0,6)}` };
    if (opts.service === 'CASH_IN') {
      return insertJournalWithLines({
        totalMinor: opts.amountMinor,
        lines: [{ accountId: platform, direction: 'DEBIT', amountMinor: opts.amountMinor }, { accountId: opts.walletLedgerId, direction: 'CREDIT', amountMinor: opts.amountMinor }],
        metadata,
        reference: `cashin-${randomUUID().slice(0,6)}`,
        description: 'cash in',
        createdAt: opts.createdAt,
      });
    } else {
      const balRows: Array<{ bal: string }> = await dataSource.query(`SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_minor ELSE -amount_minor END),0)::text as bal FROM ledger_lines WHERE ledger_account_id=$1`, [opts.walletLedgerId]);
      const bal = Number(balRows[0]?.bal ?? '0');
      if (bal < Number(opts.amountMinor)) {
        await insertJournalWithLines({
          totalMinor: String(Number(opts.amountMinor)+5000),
          lines: [{ accountId: platform, direction: 'DEBIT', amountMinor: String(Number(opts.amountMinor)+5000) }, { accountId: opts.walletLedgerId, direction: 'CREDIT', amountMinor: String(Number(opts.amountMinor)+5000) }],
          reference: `prefund-co-${randomUUID().slice(0,6)}`,
          createdAt: new Date(opts.createdAt.getTime() - 1000),
        });
      }
      return insertJournalWithLines({
        totalMinor: opts.amountMinor,
        lines: [{ accountId: opts.walletLedgerId, direction: 'DEBIT', amountMinor: opts.amountMinor }, { accountId: platform, direction: 'CREDIT', amountMinor: opts.amountMinor }],
        metadata,
        reference: `cashout-${randomUUID().slice(0,6)}`,
        description: 'cash out',
        createdAt: opts.createdAt,
      });
    }
  }

  // 1 - unauth
  it('1. GET /customers/me/transactions without token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', 'Bearer invalid-token-123').expect(401);
  });

  // 2 - agent rejected
  it('2. Agent token cannot access CUSTOMER transaction history (401/403)', async () => {
    const agentToken = await createAgentToken();
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${agentToken}`).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
  });

  // 3 - A/B isolation
  it('3. Customer A cannot see Customer B history (isolation)', async () => {
    const a = await createCustomer({ displayName: 'A iso' });
    const b = await createCustomer({ displayName: 'B iso' });
    const wA = await createWallet(a.customerId);
    const wB = await createWallet(b.customerId);
    const thirdW = (await createWallet((await createCustomer()).customerId));
    // Create transfer B->third not involving A
    await insertTransfer({ sourceWalletId: wB.walletAccountId, destWalletId: thirdW.walletAccountId, amountMinor: '1234', status: 'COMPLETED', sourceLedgerId: wB.ledgerAccountId, destLedgerId: thirdW.ledgerAccountId });
    // Also funding for B
    await insertFunding({ customerId: b.customerId, amountMinor: '5000', status: 'PENDING' });
    const resA = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(resA.body.pagination.total).toBe(0);
    expect(resA.body.items.length).toBe(0);
    const resB = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${b.token}`).expect(200);
    expect(resB.body.pagination.total).toBe(2);
    // A cannot see B's detail via id — detail currently for transfer only, but history isolation implies items not leaked
    expect(JSON.stringify(resA.body).includes(wB.walletAccountId)).toBe(false);
  });

  // 4 - forged customerId ignored (no customerId param)
  it('4. Forged ?customerId= param is ignored, SELF still enforced', async () => {
    const a = await createCustomer({ displayName: 'A forged' });
    const b = await createCustomer({ displayName: 'B forged' });
    const wA = await createWallet(a.customerId);
    const wB = await createWallet(b.customerId);
    const wThird = (await createWallet((await createCustomer()).customerId));
    await insertTransfer({ sourceWalletId: wB.walletAccountId, destWalletId: wThird.walletAccountId, amountMinor: '2100', status: 'COMPLETED', sourceLedgerId: wB.ledgerAccountId, destLedgerId: wThird.ledgerAccountId });
    // Try to forge: A requests with ?customerId=B
    const forged = await request(app.getHttpServer()).get(`/api/v1/customers/me/transactions?customerId=${b.customerId}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(forged.body.pagination.total).toBe(0);
    // Try body/header injection via custom header
    const forged2 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${a.token}`).set('x-customer-id', b.customerId).expect(200);
    expect(forged2.body.pagination.total).toBe(0);
  });

  // 5 - invalid type => 400
  it('5. Invalid ?type returns 400 validation error', async () => {
    const c = await createCustomer();
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=INVALID_TYPE').set('Authorization', `Bearer ${c.token}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=wallet_transfer').set('Authorization', `Bearer ${c.token}`).expect(400);
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=TRANSFER').set('Authorization', `Bearer ${c.token}`).expect(400);
  });

  // 6 - WALLET_TRANSFER filter
  it('6. ?type=WALLET_TRANSFER returns only transfers', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const w2 = await createWallet((await createCustomer()).customerId);
    const w3 = await createWallet((await createCustomer()).customerId);
    const t1 = await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: w2.walletAccountId, amountMinor: '1111', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId });
    await insertFunding({ customerId: c.customerId, amountMinor: '2222', status: 'PENDING' });
    await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '3333', status: 'UNCLAIMED' });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=WALLET_TRANSFER').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].type).toBe('WALLET_TRANSFER');
    expect(res.body.items[0].id).toBe(t1);
  });

  it('7. ?type=FUNDING returns only FUNDING', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: (await createWallet((await createCustomer()).customerId)).walletAccountId, amountMinor: '1000', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId });
    const f1 = await insertFunding({ customerId: c.customerId, amountMinor: '77000', status: 'PENDING' });
    const f2 = await insertFunding({ customerId: c.customerId, amountMinor: '88000', status: 'APPROVED' });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=FUNDING').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.items.every((it: any)=>it.type==='FUNDING')).toBe(true);
    const ids = res.body.items.map((i:any)=>i.id);
    expect(ids).toContain(f1);
    expect(ids).toContain(f2);
  });

  it('8. ?type=CASH_TO_CASH returns only CASH_TO_CASH (beneficiary phone match + claimant)', async () => {
    const c = await createCustomer();
    await createWallet(c.customerId);
    const unclaimed = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '5000', status: 'UNCLAIMED' });
    const claimed = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '6000', status: 'CLAIMED', claimantCustomerId: c.customerId });
    // Another customer's cash should not appear
    const otherPhone = `8${String(Math.floor(100000000 + Math.random()*900000000))}`;
    await insertCashToCash({ beneficiaryPhone: otherPhone, principalMinor: '7000', status: 'UNCLAIMED' });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=CASH_TO_CASH').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(res.body.pagination.total).toBe(2);
    const ids = res.body.items.map((i:any)=>i.id);
    expect(ids).toContain(unclaimed);
    expect(ids).toContain(claimed);
  });

  it('9. ?type=CASH_IN returns only ledger CASH_IN journals', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const tAt1 = new Date(Date.now() - 5000);
    const tAt2 = new Date(Date.now() - 3000);
    const cashInId = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '44000', service: 'CASH_IN', createdAt: tAt1 });
    const cashOutId = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '11000', service: 'CASH_OUT', createdAt: tAt2 });
    const resIn = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=CASH_IN').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(resIn.body.pagination.total).toBe(1);
    expect(resIn.body.items[0].type).toBe('CASH_IN');
    expect(resIn.body.items[0].id).toBe(cashInId);
    // Ensure CASH_OUT not in CASH_IN filter
    expect(resIn.body.items.map((i:any)=>i.id)).not.toContain(cashOutId);
  });

  it('10. ?type=CASH_OUT returns only ledger CASH_OUT', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const t1 = new Date(Date.now() - 8000);
    const t2 = new Date(Date.now() - 4000);
    const inId = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '55000', service: 'CASH_IN', createdAt: t1 });
    const outId = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '22000', service: 'CASH_OUT', createdAt: t2 });
    const resOut = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=CASH_OUT').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(resOut.body.pagination.total).toBe(1);
    expect(resOut.body.items[0].type).toBe('CASH_OUT');
    expect(resOut.body.items[0].id).toBe(outId);
    expect(resOut.body.items.map((i:any)=>i.id)).not.toContain(inId);
  });

  it('11. Pagination page 1 limit 1 total/hasNext correct', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const base = Date.now();
    for (let i=0;i<3;i++) {
      await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: (await createWallet((await createCustomer()).customerId)).walletAccountId, amountMinor: String(1000+i), status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId, createdAt: new Date(base - i*1000) });
    }
    const p1 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=1&limit=1').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(p1.body.pagination.page).toBe(1);
    expect(p1.body.pagination.limit).toBe(1);
    expect(p1.body.pagination.total).toBe(3);
    expect(p1.body.pagination.totalPages).toBe(3);
    expect(p1.body.pagination.hasNextPage).toBe(true);
    expect(p1.body.items.length).toBe(1);
    const p3 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=3&limit=1').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(p3.body.pagination.hasNextPage).toBe(false);
    expect(p3.body.items.length).toBe(1);
    const beyond = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=4&limit=1').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(beyond.body.items.length).toBe(0);
    expect(beyond.body.pagination.hasNextPage).toBe(false);
  });

  it('12. Deterministic pagination order createdAt DESC id DESC across types (global sort not per-table)', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    // Create 5 records of different types interleaved by time: oldest FUNDING, then TRANSFER, then CASH_TO_CASH, then CASH_IN, newest CASH_OUT
    const t0 = new Date('2026-09-20T10:00:00.000Z');
    const t1 = new Date('2026-09-20T10:01:00.000Z');
    const t2 = new Date('2026-09-20T10:02:00.000Z');
    const t3 = new Date('2026-09-20T10:03:00.000Z');
    const t4 = new Date('2026-09-20T10:04:00.000Z');
    const fId = await insertFunding({ customerId: c.customerId, amountMinor: '10000', status: 'PENDING', createdAt: t0 });
    const trId = await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: (await createWallet((await createCustomer()).customerId)).walletAccountId, amountMinor: '11000', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId, createdAt: t1 });
    const c2cId = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '12000', status: 'UNCLAIMED', createdAt: t2 });
    const cashIn = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '13000', service: 'CASH_IN', createdAt: t3 });
    const cashOut = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '14000', service: 'CASH_OUT', createdAt: t4 });
    // Page 1 limit 2 should be cashOut (newest) + cashIn
    const p1 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=1&limit=2').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(p1.body.pagination.total).toBe(5);
    expect(p1.body.items.map((i:any)=>i.id)).toEqual([cashOut, cashIn]);
    const p2 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=2&limit=2').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(p2.body.items.map((i:any)=>i.id)).toEqual([c2cId, trId]);
    const p3 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=3&limit=2').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(p3.body.items.map((i:any)=>i.id)).toEqual([fId]);
    // Ensure not just per-table concat: if buggy per-table page1 concat, p1 would be newest of each table mixed wrong.
  });

  it('13. Limit validation 1..100 clamping, page >=1', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: (await createWallet((await createCustomer()).customerId)).walletAccountId, amountMinor: '1000', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId });
    // limit 0 -> defaults to 20 but should still return items (not 400)
    const r0 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?limit=0').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(r0.body.pagination.limit).toBe(20);
    const r101 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?limit=101').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(r101.body.pagination.limit).toBe(20);
    const rNeg = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=0').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(rNeg.body.pagination.page).toBe(1);
    const rLarge = await request(app.getHttpServer()).get(`/api/v1/customers/me/transactions?limit=100`).set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(rLarge.body.pagination.limit).toBe(100);
  });

  it('14. Safe projection hides PIN/OTP/hash/journalId/ledgerAccountId/internal workforce', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const w2 = await createWallet((await createCustomer()).customerId);
    await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: w2.walletAccountId, amountMinor: '5001', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId });
    await insertFunding({ customerId: c.customerId, amountMinor: '6002', status: 'PENDING' });
    await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '7003', service: 'CASH_IN', createdAt: new Date() });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${c.token}`).expect(200);
    const serial = JSON.stringify(res.body).toLowerCase();
    expect(serial).not.toContain('pinhash');
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('otp');
    expect(serial).not.toContain('hash');
    expect(serial).not.toContain('journalid');
    expect(serial).not.toContain('ledgeraccount');
    expect(serial).not.toContain('journal_id');
    expect(serial).not.toContain('ledger_account');
    // required safe fields present
    for (const item of res.body.items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('amountMinor');
      expect(item).toHaveProperty('currency');
      expect(item).toHaveProperty('direction');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('reference');
      expect(item).toHaveProperty('feeMinor');
      expect(item.feeMinor).toBeDefined();
    }
  });

  it('15. feeMinor is string, hides internal fee details, 0 for V1 transfers', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: (await createWallet((await createCustomer()).customerId)).walletAccountId, amountMinor: '9999', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId });
    await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '8888', status: 'UNCLAIMED' });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${c.token}`).expect(200);
    for (const it of res.body.items) {
      expect(typeof it.feeMinor).toBe('string');
      // transfer feeMinor is 0 in V1, cash_to_cash feeMinor exists as stored but projected
      expect(it.feeMinor).toMatch(/^\d+$/);
    }
    const tr = res.body.items.find((i:any)=>i.type==='WALLET_TRANSFER');
    expect(tr.feeMinor).toBe('0');
  });

  it('16. Source-of-truth status preserved per type (TRANSFER COMPLETED/FAILED, FUNDING PENDING/APPROVED/REJECTED, CASH_TO_CASH CREATED/CLAIMED/EXPIRED)', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const w2 = await createWallet((await createCustomer()).customerId);
    const failedId = await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: w2.walletAccountId, amountMinor: '4004', status: 'FAILED', failureCode: 'INSUFFICIENT_FUNDS' });
    const pendingFund = await insertFunding({ customerId: c.customerId, amountMinor: '5005', status: 'PENDING' });
    const approvedFund = await insertFunding({ customerId: c.customerId, amountMinor: '6006', status: 'APPROVED' });
    const rejectedFund = await insertFunding({ customerId: c.customerId, amountMinor: '7007', status: 'REJECTED' });
    const unclaimed = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '8008', status: 'UNCLAIMED' });
    const claimed = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '9009', status: 'CLAIMED', claimantCustomerId: c.customerId });
    // Insert expired directly (expires_at < now)
    const expired = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '1010', status: 'EXPIRED' });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${c.token}`).expect(200);
    const byId = new Map(res.body.items.map((i:any)=>[i.id,i]));
    expect((byId.get(failedId) as any).status).toBe('FAILED');
    expect((byId.get(pendingFund) as any).status).toBe('PENDING');
    expect((byId.get(approvedFund) as any).status).toBe('APPROVED');
    expect((byId.get(rejectedFund) as any).status).toBe('REJECTED');
    expect((byId.get(unclaimed) as any).status).toBe('UNCLAIMED');
    expect((byId.get(claimed) as any).status).toBe('CLAIMED');
    expect((byId.get(expired) as any).status).toBe('EXPIRED');
  });

  it('17. Counterparty batch enriched for WALLET_TRANSFER (displayName/receivingNumber), safe Agent for CASH', async () => {
    const counterparty = await createCustomer({ displayName: 'Counterparty H04' });
    const c = await createCustomer({ displayName: 'Self H04' });
    const wSelf = await createWallet(c.customerId);
    const wCp = await createWallet(counterparty.customerId);
    await insertTransfer({ sourceWalletId: wSelf.walletAccountId, destWalletId: wCp.walletAccountId, amountMinor: '3210', status: 'COMPLETED', sourceLedgerId: wSelf.ledgerAccountId });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=WALLET_TRANSFER').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(res.body.items.length).toBe(1);
    const cp = res.body.items[0].counterparty;
    expect(cp.walletId).toBe(wCp.walletAccountId);
    expect(cp.customerId).toBe(counterparty.customerId);
    expect(cp.displayName).toBe('Counterparty H04');
    expect(cp.receivingNumber).toBe(counterparty.phone10);
    // For CASH_IN/CASH_OUT counterparty should be safe {type:'AGENT'} not internal workforce hash
    await insertCashInOut({ walletLedgerId: wSelf.ledgerAccountId, amountMinor: '1234', service: 'CASH_IN', createdAt: new Date(Date.now()-1000) });
    const cashRes = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=CASH_IN').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(cashRes.body.items[0].counterparty).toEqual({ type: 'AGENT' });
  });

  it('18. Ordering tie-breaker id DESC when same created_at', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const sameTime = new Date('2026-09-22T12:00:00.000Z');
    const w2 = await createWallet((await createCustomer()).customerId);
    const w3 = await createWallet((await createCustomer()).customerId);
    const idA = await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: w2.walletAccountId, amountMinor: '1111', status: 'FAILED', createdAt: sameTime });
    const idB = await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: w3.walletAccountId, amountMinor: '2222', status: 'FAILED', createdAt: sameTime });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=WALLET_TRANSFER').set('Authorization', `Bearer ${c.token}`).expect(200);
    // Both have same time, should be ordered id DESC
    const expectedOrder = [idA, idB].sort().reverse();
    expect(res.body.items.map((i:any)=>i.id)).toEqual(expectedOrder);
  });

  it('19. Multi-source pagination not fetching page1 per table concat (correct global total)', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    // Create 2 of each type to reach 10 total, with interleaved timestamps ensuring global order crosses types
    const base = Date.now() - 100000;
    for (let i=0;i<2;i++) {
      await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: (await createWallet((await createCustomer()).customerId)).walletAccountId, amountMinor: String(100+i), status: 'FAILED', createdAt: new Date(base + i*1000) });
      await insertFunding({ customerId: c.customerId, amountMinor: String(200+i), status: 'PENDING', createdAt: new Date(base + i*1000 + 500) });
      await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: String(300+i), status: 'UNCLAIMED', createdAt: new Date(base + i*1000 + 700) });
      await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: String(400+i), service: 'CASH_IN', createdAt: new Date(base + i*1000 + 900) });
      await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: String(500+i), service: 'CASH_OUT', createdAt: new Date(base + i*1000 + 1100) });
    }
    const full = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?limit=100').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(full.body.pagination.total).toBe(10);
    // Paginated 3 per page should cover all 10 deterministically
    const p1 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=1&limit=3').set('Authorization', `Bearer ${c.token}`).expect(200);
    const p2 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=2&limit=3').set('Authorization', `Bearer ${c.token}`).expect(200);
    const p3 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=3&limit=3').set('Authorization', `Bearer ${c.token}`).expect(200);
    const p4 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=4&limit=3').set('Authorization', `Bearer ${c.token}`).expect(200);
    const combinedIds = [...p1.body.items, ...p2.body.items, ...p3.body.items, ...p4.body.items].map((i:any)=>i.id);
    expect(combinedIds).toEqual(full.body.items.map((i:any)=>i.id));
    expect(combinedIds.length).toBe(10);
    expect(new Set(combinedIds).size).toBe(10);
  });

  it('20. Funding history preserved via GET /customers/me/funding-history still works and appears in unified', async () => {
    const c = await createCustomer();
    await createWallet(c.customerId);
    const fundId = await insertFunding({ customerId: c.customerId, amountMinor: '90000', status: 'PENDING', description: 'test funding' });
    const fundingHist = await request(app.getHttpServer()).get('/api/v1/customers/me/funding-history?page=1&limit=10').set('Authorization', `Bearer ${c.token}`).expect(200);
    // Endpoint should still work (legacy). It may return paginated structure; check contains fundId
    const fundingContains = JSON.stringify(fundingHist.body).includes(fundId);
    expect(fundingContains).toBe(true);
    const unified = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=FUNDING').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(unified.body.items.map((i:any)=>i.id)).toContain(fundId);
  });

  it('21. GET /customers/me/transfers still preserved (transfers only)', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const w2 = await createWallet((await createCustomer()).customerId);
    await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: w2.walletAccountId, amountMinor: '6000', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId });
    await insertFunding({ customerId: c.customerId, amountMinor: '7000', status: 'PENDING' });
    const transfers = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(transfers.body.pagination).toBeDefined();
    expect(transfers.body.items.every((i:any)=> !!i.sourceWalletId || !!i.destinationWalletId)).toBe(true);
    // funding should not be in transfers list
    expect(JSON.stringify(transfers.body).includes('FUNDING')).toBe(false);
  });

  it('22. CASH_TO_CASH status mapping to direction (UNCLAIMED PENDING, CLAIMED RECEIVED, EXPIRED EXPIRED)', async () => {
    const c = await createCustomer();
    await createWallet(c.customerId);
    const unclaimedId = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '10000', status: 'UNCLAIMED' });
    const claimedId = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '11000', status: 'CLAIMED', claimantCustomerId: c.customerId });
    const expiredId = await insertCashToCash({ beneficiaryPhone: c.phone10, principalMinor: '12000', status: 'EXPIRED' });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=CASH_TO_CASH').set('Authorization', `Bearer ${c.token}`).expect(200);
    const byId = new Map(res.body.items.map((i:any)=>[i.id,i]));
    expect((byId.get(unclaimedId) as any).direction).toBe('PENDING');
    expect((byId.get(claimedId) as any).direction).toBe('RECEIVED');
    expect((byId.get(expiredId) as any).direction).toBe('EXPIRED');
    // completedAt for CLAIMED should be claimed_at, for EXPIRED should be expired_at
    expect(new Date((byId.get(claimedId) as any).completedAt).getTime()).toBeGreaterThan(0);
    expect(new Date((byId.get(expiredId) as any).completedAt).getTime()).toBeGreaterThan(0);
  });

  it('23. Ledger CASH_IN/CASH_OUT via metadata canonicalService projection correctness', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    const now = new Date();
    const cashInJ = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '33000', service: 'CASH_IN', createdAt: new Date(now.getTime()-2000), agentId: 'agent-123' });
    const cashOutJ = await insertCashInOut({ walletLedgerId: w.ledgerAccountId, amountMinor: '15000', service: 'CASH_OUT', createdAt: new Date(now.getTime()-1000), agentId: 'agent-456' });
    // Also insert a random journal without canonicalService should NOT appear
    const plat = await ensureLedgerAccount(`PLAT_RND_${randomUUID().slice(0,5)}`);
    await insertJournalWithLines({ totalMinor: '9999', lines: [{ accountId: plat, direction: 'DEBIT', amountMinor: '9999'}, {accountId: w.ledgerAccountId, direction: 'CREDIT', amountMinor: '9999'}], metadata: { foo: 'bar' }, createdAt: new Date() });
    const unified = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${c.token}`).expect(200);
    const ids = unified.body.items.map((i:any)=>i.id);
    expect(ids).toContain(cashInJ);
    expect(ids).toContain(cashOutJ);
    const types = unified.body.items.filter((i:any)=>[cashInJ,cashOutJ].includes(i.id)).map((i:any)=>i.type);
    expect(types).toContain('CASH_IN');
    expect(types).toContain('CASH_OUT');
    // random journal not included
    expect(unified.body.pagination.total).toBe(2);
  });

  it('24. Financial isolation: history query does not mutate journals/lines/balances (zero mutations)', async () => {
    const c = await createCustomer();
    const w = await createWallet(c.customerId);
    await insertTransfer({ sourceWalletId: w.walletAccountId, destWalletId: (await createWallet((await createCustomer()).customerId)).walletAccountId, amountMinor: '2500', status: 'COMPLETED', sourceLedgerId: w.ledgerAccountId });
    await insertFunding({ customerId: c.customerId, amountMinor: '3500', status: 'PENDING' });
    const beforeJournals: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const beforeLines: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_lines`);
    const beforeTransfers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM transfers`);
    const beforeFunding: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM customer_funding_requests`);
    for (let i=0;i<5;i++) {
      await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=1&limit=100').set('Authorization', `Bearer ${c.token}`).expect(200);
      await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=WALLET_TRANSFER').set('Authorization', `Bearer ${c.token}`).expect(200);
      await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=FUNDING').set('Authorization', `Bearer ${c.token}`).expect(200);
    }
    const afterJournals: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const afterLines: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_lines`);
    const afterTransfers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM transfers`);
    const afterFunding: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM customer_funding_requests`);
    expect(afterJournals[0]!.count).toBe(beforeJournals[0]!.count);
    expect(afterLines[0]!.count).toBe(beforeLines[0]!.count);
    expect(afterTransfers[0]!.count).toBe(beforeTransfers[0]!.count);
    expect(afterFunding[0]!.count).toBe(beforeFunding[0]!.count);
  });

  it('25. Empty history returns empty items with correct pagination zero', async () => {
    const c = await createCustomer();
    // No wallets/transfers/etc: should be empty
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(0);
    expect(res.body.pagination.hasNextPage).toBe(false);
    expect(res.body.pagination.page).toBe(1);
    const filtered = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?type=WALLET_TRANSFER').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(filtered.body.items).toEqual([]);
    expect(filtered.body.pagination.total).toBe(0);
  });
});
