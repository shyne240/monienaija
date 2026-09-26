/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { WalletService } from '../src/wallet/wallet.service';
import { TransferService } from '../src/transfer/transfer.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'fund-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-001 Operations Customer Funding maker/checker (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fundingService: CustomerFundingService;
  let walletService: WalletService;
  let transferService: TransferService;
  let ledgerService: LedgerService;

  const supportMaker: any = {
    type: 'SUPPORT',
    principalId: 'support-maker-1',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const operatorChecker: any = {
    type: 'OPERATOR',
    principalId: 'operator-checker-1',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const operatorMaker: any = {
    type: 'OPERATOR',
    principalId: 'operator-maker-2',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const privilegedChecker: any = {
    type: 'PRIVILEGED',
    principalId: 'priv-checker-1',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const supportChecker: any = {
    type: 'SUPPORT',
    principalId: 'support-checker-1',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-001-funding');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    fundingService = moduleRef.get(CustomerFundingService);
    walletService = moduleRef.get(WalletService);
    transferService = moduleRef.get(TransferService);
    ledgerService = moduleRef.get(LedgerService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try { await destroyIntegrationDataSource(dataSource); } catch { try { if (dataSource.isInitialized) await dataSource.destroy().catch(()=>undefined);} catch { void 0; } }
    }
  }, 60000);

  beforeEach(async () => {
    // Truncate all tables except ledger_accounts (seeded by migrations) and typeorm_migrations.
    // Using truncateAllTables would wipe PAYMENT-SETTLEMENT_ASSET-NGN and AGENT_FUNDING_POOL-NGN
    // which are required for funding and agent flows.
    const rows: Array<{ tablename: string }> = await dataSource.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('typeorm_migrations','ledger_accounts')`,
    );
    if (rows.length) {
      const list = rows.map((r) => `"${r.tablename}"`).join(', ');
      await dataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    }
    // Ensure ledger_accounts seed still present (in case data was not yet migrated due to previous truncate)
    const settlement: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (settlement.length === 0) {
      // Re-run the specific seed from migration 0002/0061 without re-running all migrations
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES
          ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000202','PAYMENT-SETTLEMENT_CLEARING-NGN','Payment settlement clearing NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000203','PAYMENT-SYSTEM_SUSPENSE-NGN','Payment system suspense NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES (gen_random_uuid(),'AGENT_FUNDING_POOL-NGN','Agent Funding Pool NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES (gen_random_uuid(),'CASH_TO_CASH-UNCLAIMED-NGN','Cash-to-Cash Unclaimed NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
    }
  });

  async function createCustomerWithCredential(opts: { reference?: string; password?: string } = {}): Promise<{ customerId: string; token: string; walletId: string; ledgerAccountId: string }> {
    const reference = opts.reference ?? `cust-fund-${randomUUID()}`;
    const password = opts.password ?? 'correct-password-fund';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'Fund Customer']);
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`, [customerId, `0${canonical10.slice(1)}`, canonical10]);
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const wallet = await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `fund-wallet-${customerId}-${randomUUID()}` });
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    const token = login.body.accessToken as string;
    return { customerId, token, walletId: wallet.id, ledgerAccountId: wallet.ledgerAccountId };
  }

  async function getBalance(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id WHERE l.ledger_account_id=$1`,
      [ledgerAccountId],
    );
    return BigInt(rows[0]!.balance);
  }

  async function getSettlementAssetId(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (rows.length === 0) throw new Error('Settlement asset not found');
    return rows[0]!.id;
  }

  it('1. authorized maker creates funding request (PENDING)', async () => {
    const { customerId } = await createCustomerWithCredential();
    const res = await fundingService.createRequest({
      customerId,
      amountMinor: '50000',
      currency: 'NGN',
      externalReference: 'EXT-REF-001',
      channel: 'FUNDING_ACCOUNT_GT',
      description: 'Customer paid into funding account',
      idempotencyKey: `idem-create-${randomUUID()}`,
      principal: supportMaker,
    });
    expect(res.status).toBe('PENDING');
    expect(res.customerId).toBe(customerId);
    expect(res.amountMinor).toBe('50000');
    expect(res.reference).toMatch(/^CF-/);
    expect(res.makerId).toBe(supportMaker.principalId);
    expect(res.journalId).toBeNull();
    const rows: Array<any> = await dataSource.query(`SELECT * FROM customer_funding_requests WHERE id=$1`, [res.id]);
    expect(rows[0].status).toBe('PENDING');
  });

  it('2. unauthorized principal rejected (no principal)', async () => {
    const { customerId } = await createCustomerWithCredential();
    await expect(
      fundingService.createRequest({
        customerId,
        amountMinor: '10000',
        currency: 'NGN',
        idempotencyKey: `idem-unauth-${randomUUID()}`,
        principal: undefined as any,
      }),
    ).rejects.toThrow(/Authentication required/i);
  });

  it('3. customer cannot create internal request (CUSTOMER forbidden)', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    // via HTTP internal route with customer token should be 403
    await request(app.getHttpServer())
      .post(`/api/v1/internal/customers/${customerId}/funding-requests`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-cust-${randomUUID()}`)
      .send({ amountMinor: '10000', currency: 'NGN' })
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));

    // via service with CUSTOMER principal should also be forbidden
    const custPrincipal: any = { type: 'CUSTOMER', principalId: customerId, customerId, roles: [], scopes: [], customerAccess: 'SELF' };
    await expect(
      fundingService.createRequest({
        customerId,
        amountMinor: '10000',
        currency: 'NGN',
        idempotencyKey: `idem-cust2-${randomUUID()}`,
        principal: custPrincipal,
      }),
    ).rejects.toThrow(/cannot create/i);
  });

  it('4. pending status persisted, agent cannot create', async () => {
    const { customerId } = await createCustomerWithCredential();
    const agentPrincipal: any = { type: 'AGENT', principalId: randomUUID(), agentId: randomUUID(), roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'SELF' };
    await expect(
      fundingService.createRequest({
        customerId,
        amountMinor: '20000',
        currency: 'NGN',
        idempotencyKey: `idem-agent-${randomUUID()}`,
        principal: agentPrincipal,
      }),
    ).rejects.toThrow(/cannot create/i);
  });

  it('5. authorized checker approves (APPROVED) and credits wallet via ledger', async () => {
    const { customerId, ledgerAccountId } = await createCustomerWithCredential();
    const before = await getBalance(ledgerAccountId);
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '75000',
      currency: 'NGN',
      idempotencyKey: `idem-approve-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved = await fundingService.approve({
      fundingRequestId: created.id,
      principal: operatorChecker,
    });
    expect(approved.status).toBe('APPROVED');
    expect(approved.journalId).toBeTruthy();
    expect(approved.checkerId).toBe(operatorChecker.principalId);
    expect(approved.approvedAt).toBeTruthy();
    const after = await getBalance(ledgerAccountId);
    expect(after).toBe(before + 75000n);
  });

  it('6. maker cannot approve own request (403)', async () => {
    const { customerId } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '10000',
      currency: 'NGN',
      idempotencyKey: `idem-maker-own-${randomUUID()}`,
      principal: supportMaker,
    });
    await expect(
      fundingService.approve({ fundingRequestId: created.id, principal: supportMaker }),
    ).rejects.toThrow(/Maker cannot approve own/i);
    await expect(
      fundingService.reject({ fundingRequestId: created.id, principal: supportMaker, rejectionReason: 'try self reject' }),
    ).rejects.toThrow(/Maker cannot/i);
  });

  it('7. unauthorized checker rejected (SUPPORT cannot approve)', async () => {
    const { customerId } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '10000',
      currency: 'NGN',
      idempotencyKey: `idem-support-approve-${randomUUID()}`,
      principal: operatorMaker,
    });
    await expect(
      fundingService.approve({ fundingRequestId: created.id, principal: supportChecker }),
    ).rejects.toThrow(/cannot approve/i);
    // SUPPORT also cannot reject? Our implementation requires OPERATOR for reject, so same
    await expect(
      fundingService.reject({ fundingRequestId: created.id, principal: supportChecker, rejectionReason: 'no' }),
    ).rejects.toThrow(/cannot reject/i);
  });

  it('8. approval credits customer wallet (amount correct)', async () => {
    const { customerId, ledgerAccountId } = await createCustomerWithCredential();
    const before = await getBalance(ledgerAccountId);
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '12345',
      currency: 'NGN',
      idempotencyKey: `idem-credit-${randomUUID()}`,
      principal: operatorMaker,
    });
    await fundingService.approve({ fundingRequestId: created.id, principal: privilegedChecker });
    const after = await getBalance(ledgerAccountId);
    expect(after - before).toBe(12345n);
    // via WalletService balance also
    const bal = await walletService.getWalletBalance((await createCustomerWithCredential()).walletId); // dummy to keep, but we check earlier
    // Ensure ledger-derived
    const walletBal = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE customer_id=$1`, [customerId]);
    const ledgerBal = await getBalance(walletBal[0].ledger_account_id);
    expect(ledgerBal).toBe(after);
  });

  it('9. journal is balanced (DEBIT settlement asset, CREDIT wallet)', async () => {
    const { customerId, ledgerAccountId } = await createCustomerWithCredential();
    const settlementId = await getSettlementAssetId();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '9999',
      currency: 'NGN',
      idempotencyKey: `idem-balanced-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    const lines: Array<{ ledger_account_id: string; direction: string; amount_minor: string }> = await dataSource.query(
      `SELECT ledger_account_id, direction, amount_minor::text AS amount_minor FROM ledger_lines WHERE journal_id=$1 ORDER BY line_number`,
      [approved.journalId],
    );
    expect(lines.length).toBe(2);
    const debit = lines.find((l) => l.direction === 'DEBIT')!;
    const credit = lines.find((l) => l.direction === 'CREDIT')!;
    expect(debit.amount_minor).toBe('9999');
    expect(credit.amount_minor).toBe('9999');
    expect(debit.ledger_account_id).toBe(settlementId);
    expect(credit.ledger_account_id).toBe(ledgerAccountId);
    // journal total
    const journals: Array<{ total_minor: string; currency: string; accounting_unit: string }> = await dataSource.query(`SELECT total_minor::text AS total_minor, currency, accounting_unit FROM ledger_journals WHERE id=$1`, [approved.journalId]);
    expect(journals[0]!.total_minor).toBe('9999');
    expect(journals[0]!.currency).toBe('NGN');
    expect(journals[0]!.accounting_unit).toBe('CUSTOMER_FUNDS');
  });

  it('10. correct funding/control account is used (PAYMENT-SETTLEMENT_ASSET-NGN, not AGENT pool, not invented)', async () => {
    const { customerId } = await createCustomerWithCredential();
    const settlementId = await getSettlementAssetId();
    const poolRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='AGENT_FUNDING_POOL-NGN' LIMIT 1`);
    const poolId = poolRows[0]?.id;
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `idem-correct-acct-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    const lines: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM ledger_lines WHERE journal_id=$1`, [approved.journalId]);
    const ids = lines.map((l) => l.ledger_account_id);
    expect(ids).toContain(settlementId);
    if (poolId) expect(ids).not.toContain(poolId); // should not use agent pool
    // ensure not using invented AR_CONTROL that doesn't exist as customer funding pool
    const arRows: Array<any> = await dataSource.query(`SELECT code FROM ledger_accounts WHERE code='FINANCE-ACCOUNTS_RECEIVABLE-NGN'`);
    if (arRows.length > 0) {
      const arIdRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='FINANCE-ACCOUNTS_RECEIVABLE-NGN' LIMIT 1`);
      expect(ids).not.toContain(arIdRows[0]!.id);
    }
  });

  it('11. request becomes approved and 12. approval audit exists', async () => {
    const { customerId } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '11000',
      currency: 'NGN',
      idempotencyKey: `idem-audit-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    expect(approved.status).toBe('APPROVED');
    const audits: Array<{ action: string; new_values: any }> = await dataSource.query(
      `SELECT action, new_values FROM audit_events WHERE entity_id=$1 AND entity_type='CUSTOMER_FUNDING_REQUEST' ORDER BY occurred_at`,
      [created.id],
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('FUNDING_REQUEST_CREATED');
    expect(actions).toContain('FUNDING_REQUEST_APPROVED');
    const approvedAudit = audits.find((a) => a.action === 'FUNDING_REQUEST_APPROVED')!;
    expect(approvedAudit.new_values.journalId).toBe(approved.journalId);
    const serial = JSON.stringify(audits).toLowerCase();
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('pin');
    expect(serial).not.toContain('secret');
    expect(serial).not.toContain('tokenhash');
  });

  it('13. duplicate approval cannot double-credit (second approve throws)', async () => {
    const { customerId, ledgerAccountId } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '20000',
      currency: 'NGN',
      idempotencyKey: `idem-dup-approve-${randomUUID()}`,
      principal: supportMaker,
    });
    await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    const before = await getBalance(ledgerAccountId);
    await expect(fundingService.approve({ fundingRequestId: created.id, principal: privilegedChecker })).rejects.toThrow(/already APPROVED/i);
    const after = await getBalance(ledgerAccountId);
    expect(after).toBe(before);
    // also check only one journal for funding
    const journals: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM ledger_journals WHERE idempotency_key=$1`, [`customer-funding:${created.id}`]);
    expect(journals[0]!.count).toBe('1');
  });

  it('14. concurrent approvals produce one credit', async () => {
    const { customerId, ledgerAccountId } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '30000',
      currency: 'NGN',
      idempotencyKey: `idem-conc-${randomUUID()}`,
      principal: supportMaker,
    });
    const before = await getBalance(ledgerAccountId);
    const checkerA: any = { type: 'OPERATOR', principalId: `operator-conc-A-${randomUUID()}`, roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE' };
    const checkerB: any = { type: 'OPERATOR', principalId: `operator-conc-B-${randomUUID()}`, roles: [], scopes: [], customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE' };
    const results = await Promise.allSettled([
      fundingService.approve({ fundingRequestId: created.id, principal: checkerA }),
      fundingService.approve({ fundingRequestId: created.id, principal: checkerB }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const after = await getBalance(ledgerAccountId);
    expect(after).toBe(before + 30000n);
    const count: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM ledger_lines WHERE journal_id IN (SELECT journal_id FROM customer_funding_requests WHERE id=$1)`, [created.id]);
    // 2 lines per journal, but only one journal
    const journals: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM ledger_journals WHERE idempotency_key=$1`, [`customer-funding:${created.id}`]);
    expect(journals[0]!.count).toBe('1');
  });

  it('15. rejection does not credit wallet and 16. rejection audit exists', async () => {
    const { customerId, ledgerAccountId } = await createCustomerWithCredential();
    const before = await getBalance(ledgerAccountId);
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '40000',
      currency: 'NGN',
      idempotencyKey: `idem-reject-${randomUUID()}`,
      principal: supportMaker,
    });
    const rejected = await fundingService.reject({
      fundingRequestId: created.id,
      principal: operatorChecker,
      rejectionReason: 'Insufficient evidence',
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Insufficient evidence');
    expect(rejected.journalId).toBeNull();
    const after = await getBalance(ledgerAccountId);
    expect(after).toBe(before);
    const audits: Array<{ action: string }> = await dataSource.query(`SELECT action FROM audit_events WHERE entity_id=$1 AND entity_type='CUSTOMER_FUNDING_REQUEST'`, [created.id]);
    expect(audits.map((a)=>a.action)).toContain('FUNDING_REQUEST_REJECTED');
    const rejectedRows: Array<any> = await dataSource.query(`SELECT status FROM customer_funding_requests WHERE id=$1`, [created.id]);
    expect(rejectedRows[0].status).toBe('REJECTED');
  });

  it('17. invalid state transition rejected (approve rejected, reject approved, approve approved)', async () => {
    const { customerId } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '15000',
      currency: 'NGN',
      idempotencyKey: `idem-state-${randomUUID()}`,
      principal: supportMaker,
    });
    await fundingService.reject({ fundingRequestId: created.id, principal: operatorChecker, rejectionReason: 'no' });
    await expect(fundingService.approve({ fundingRequestId: created.id, principal: privilegedChecker })).rejects.toThrow(/already REJECTED/i);
    await expect(fundingService.reject({ fundingRequestId: created.id, principal: privilegedChecker, rejectionReason: 'again' })).rejects.toThrow(/already REJECTED/i);

    const created2 = await fundingService.createRequest({
      customerId,
      amountMinor: '16000',
      currency: 'NGN',
      idempotencyKey: `idem-state2-${randomUUID()}`,
      principal: supportMaker,
    });
    await fundingService.approve({ fundingRequestId: created2.id, principal: operatorChecker });
    await expect(fundingService.approve({ fundingRequestId: created2.id, principal: privilegedChecker })).rejects.toThrow(/already APPROVED/i);
    await expect(fundingService.reject({ fundingRequestId: created2.id, principal: privilegedChecker, rejectionReason: 'too late' })).rejects.toThrow(/already APPROVED/i);
  });

  it('18. customer funding history returns safe projection (no journalId etc)', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '25000',
      currency: 'NGN',
      externalReference: 'EXT-HIST-1',
      channel: 'BANK_GT',
      description: 'History test',
      idempotencyKey: `idem-hist-${randomUUID()}`,
      principal: supportMaker,
    });
    await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    const hist = await request(app.getHttpServer())
      .get('/api/v1/customers/me/funding-history')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(hist.body.items).toBeDefined();
    const item = hist.body.items.find((i: any) => i.id === created.id);
    expect(item).toBeDefined();
    expect(item.reference).toMatch(/^CF-/);
    expect(item.amountMinor).toBe('25000');
    expect(item.status).toBe('APPROVED');
    expect(item.externalReference).toBe('EXT-HIST-1');
    expect(item.channel).toBe('BANK_GT');
    // safe: no journalId, no ledger_account_id, no request_hash, no idempotency_key, no maker/checker hash
    const serial = JSON.stringify(item).toLowerCase();
    expect(serial).not.toContain('journalid');
    expect(serial).not.toContain('ledger');
    expect(serial).not.toContain('request_hash');
    expect(serial).not.toContain('idempotency');
    expect(serial).not.toContain('maker');
    expect(serial).not.toContain('checker');
    expect(serial).not.toContain('password');
    expect(serial).not.toContain('pinhash');
    // alias also works
    const hist2 = await request(app.getHttpServer())
      .get('/api/v1/customers/me/funding-requests')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(hist2.body.items.length).toBe(hist.body.items.length);

    // Rejected history also safe
    const createdRej = await fundingService.createRequest({
      customerId,
      amountMinor: '26000',
      currency: 'NGN',
      idempotencyKey: `idem-hist-rej-${randomUUID()}`,
      principal: supportMaker,
    });
    await fundingService.reject({ fundingRequestId: createdRej.id, principal: operatorChecker, rejectionReason: 'docs missing' });
    const hist3 = await request(app.getHttpServer())
      .get('/api/v1/customers/me/funding-history')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const rejItem = hist3.body.items.find((i: any) => i.id === createdRej.id);
    expect(rejItem.status).toBe('REJECTED');
    expect(rejItem.rejectionReason).toBe('docs missing');
  });

  it('19. cross-customer history isolation', async () => {
    const custA = await createCustomerWithCredential();
    const custB = await createCustomerWithCredential();
    const createdA = await fundingService.createRequest({
      customerId: custA.customerId,
      amountMinor: '7000',
      currency: 'NGN',
      idempotencyKey: `idem-crossA-${randomUUID()}`,
      principal: supportMaker,
    });
    await fundingService.approve({ fundingRequestId: createdA.id, principal: operatorChecker });
    const createdB = await fundingService.createRequest({
      customerId: custB.customerId,
      amountMinor: '8000',
      currency: 'NGN',
      idempotencyKey: `idem-crossB-${randomUUID()}`,
      principal: supportMaker,
    });
    await fundingService.approve({ fundingRequestId: createdB.id, principal: operatorChecker });
    const histA = await request(app.getHttpServer()).get('/api/v1/customers/me/funding-history').set('Authorization', `Bearer ${custA.token}`).expect(200);
    const histB = await request(app.getHttpServer()).get('/api/v1/customers/me/funding-history').set('Authorization', `Bearer ${custB.token}`).expect(200);
    expect(histA.body.items.some((i: any) => i.id === createdA.id)).toBe(true);
    expect(histA.body.items.some((i: any) => i.id === createdB.id)).toBe(false);
    expect(histB.body.items.some((i: any) => i.id === createdB.id)).toBe(true);
    expect(histB.body.items.some((i: any) => i.id === createdA.id)).toBe(false);
    // unauthenticated 401
    await request(app.getHttpServer()).get('/api/v1/customers/me/funding-history').expect(401);
    // agent cannot access
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`, [`cls-fund-${randomUUID().slice(0,8)}`, `FND-${randomUUID().slice(0,6)}`, 'Fund Class', JSON.stringify(['CASH_IN']), JSON.stringify({})]);
    const classId = agentRows[0]!.id;
    const ref = `agent-fund-${randomUUID()}`;
    const agentRows2: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [ref, classId]);
    const agentId = agentRows2[0]!.id;
    const hash = encodePbkdf2('agent-pass-fund', 'agent-salt-fund');
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'agent-pass-fund' }).expect(200);
    const agentToken = login.body.accessToken;
    await request(app.getHttpServer()).get('/api/v1/customers/me/funding-history').set('Authorization', `Bearer ${agentToken}`).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
  });

  it('20. idempotency/replay behavior (same key same hash replay, different amount conflict)', async () => {
    const { customerId } = await createCustomerWithCredential();
    const key = `idem-replay-${randomUUID()}`;
    const first = await fundingService.createRequest({
      customerId,
      amountMinor: '5000',
      currency: 'NGN',
      externalReference: 'EXT-REPLAY',
      channel: 'CHAN',
      idempotencyKey: key,
      principal: supportMaker,
    });
    const second = await fundingService.createRequest({
      customerId,
      amountMinor: '5000',
      currency: 'NGN',
      externalReference: 'EXT-REPLAY',
      channel: 'CHAN',
      idempotencyKey: key,
      principal: supportMaker,
    });
    expect(second.id).toBe(first.id);
    expect(second.reference).toBe(first.reference);
    // different amount with same key should conflict
    await expect(
      fundingService.createRequest({
        customerId,
        amountMinor: '9999',
        currency: 'NGN',
        externalReference: 'EXT-REPLAY',
        channel: 'CHAN',
        idempotencyKey: key,
        principal: supportMaker,
      }),
    ).rejects.toThrow(/already used for another funding request/i);
    // ledger idempotency for approve replay already covered via duplicate approval not double credit (test 13)
  });

  it('21. no PIN/password/secret leakage in funding endpoints', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({
      customerId,
      amountMinor: '33000',
      currency: 'NGN',
      idempotencyKey: `idem-leak-${randomUUID()}`,
      principal: supportMaker,
    });
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    const internal = await dataSource.query(`SELECT * FROM customer_funding_requests WHERE id=$1`, [created.id]);
    const serialInternal = JSON.stringify(internal).toLowerCase();
    expect(serialInternal).not.toContain('password');
    expect(serialInternal).not.toContain('pin');
    expect(serialInternal).not.toContain('secret');
    // customer history safe already checked, also check internal GET via workforce? Need workforce token but we test service view: toView includes makerId but not pin
    const view = await fundingService.getById(created.id);
    expect(JSON.stringify(view).toLowerCase()).not.toContain('password');
    expect(JSON.stringify(view).toLowerCase()).not.toContain('pin');
    // funding history via customer also safe (checked)
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/funding-history').set('Authorization', `Bearer ${token}`).expect(200);
    expect(JSON.stringify(hist.body).toLowerCase()).not.toContain('password');
    expect(JSON.stringify(hist.body).toLowerCase()).not.toContain('pinhash');
    expect(JSON.stringify(hist.body).toLowerCase()).not.toContain('tokenhash');
  });

  it('22. existing customer W→W still passes (A23)', async () => {
    const { customerId: custAId, token: tokenA } = await createCustomerWithCredential();
    const { customerId: custBId } = await createCustomerWithCredential();
    // create wallets already done via helper, but need to get wallet ids from WalletService list?
    const walletsA: Array<{ id: string }> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [custAId]);
    const walletsB: Array<{ id: string }> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [custBId]);
    const walletAId = walletsA[0]!.id;
    const walletBId = walletsB[0]!.id;
    // fund A via funding flow
    const fund = await fundingService.createRequest({ customerId: custAId, amountMinor: '100000', currency: 'NGN', idempotencyKey: `idem-w2w-fund-${randomUUID()}`, principal: supportMaker });
    await fundingService.approve({ fundingRequestId: fund.id, principal: operatorChecker });
    // set PIN for A
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenA}`).send({ pin: '1234' }).expect(200);
    const beforeB: bigint = await getBalance((await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [walletBId]))[0].ledger_account_id);
    const tr = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', `w2w-${randomUUID()}`)
      .send({ sourceWalletId: walletAId, destinationWalletId: walletBId, amountMinor: '25000', currency: 'NGN', pin: '1234' })
      .expect(201);
    expect(tr.body.status).toBe('COMPLETED');
    const afterB: bigint = await getBalance((await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [walletBId]))[0].ledger_account_id);
    expect(afterB).toBe(beforeB + 25000n);
  });

  it('23. existing Agent financial flows still pass (Agent funding)', async () => {
    // create agent via service
    const { AgentFundingService } = await import('../src/agent/agent-funding.service');
    const { AgentApplicationService } = await import('../src/agent/agent-application.service');
    const { AgentLifecycleService } = await import('../src/agent/agent-lifecycle.service');
    const { AgentClassService } = await import('../src/agent/agent-class.service');
    const fundingServiceAgent = app.get(AgentFundingService);
    const classService = app.get(AgentClassService);
    const appService = app.get(AgentApplicationService);
    const lifecycleService = app.get(AgentLifecycleService);
    const cls = await classService.create({
      reference: `cls-fund23-${randomUUID().slice(0,8)}`,
      code: `F23-${randomUUID().slice(0,6)}`,
      name: 'Fund23 Class',
      isActive: true,
      applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING'] as any,
      applicableLimits: {} as any,
      actor: 'test-actor',
    });
    const application = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-fund23-${randomUUID()}`,
      businessName: `Biz Fund23 ${randomUUID().slice(0,4)}`,
      contactEmail: `fund23-${randomUUID().slice(0,6)}@test.com`,
      actor: 'applicant-fund23',
    });
    await appService.submit(application.id, 'applicant-fund23');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [application.id]);
    const { AgentStatus } = await import('../src/agent/agent.enums');
    const agent = await lifecycleService.activateFromApplication(application.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    const wallet = await walletService.createWallet({ customerId: agent.id, currency: 'NGN', idempotencyKey: `agent-wallet-f23-${agent.id}-${randomUUID()}` });
    const before = await getBalance(wallet.ledgerAccountId);
    const res = await fundingServiceAgent.fund({
      agentId: agent.id,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `agent-fund23-${randomUUID()}`,
      principal: privilegedChecker,
      actor: 'test-actor',
    });
    expect(res.status).toBe('COMPLETED');
    const after = await getBalance(wallet.ledgerAccountId);
    expect(after).toBe(before + 5000n);
  });

  it('migration count is 65 and settlement account exists', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text AS count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBe(66);
    const latest: Array<{ timestamp: string; name: string }> = await dataSource.query(`SELECT timestamp::text AS timestamp, name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1`);
    expect(latest[0]!.timestamp).toBe('1785753600065');
    expect(latest[0]!.name).toBe('CreateNotificationDeliveries1785753600065');
    const settlement: Array<{ code: string }> = await dataSource.query(`SELECT code FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN'`);
    expect(settlement.length).toBe(1);
    const fundingTable: Array<{ tablename: string }> = await dataSource.query(`SELECT tablename FROM pg_tables WHERE tablename='customer_funding_requests'`);
    expect(fundingTable.length).toBe(1);
  });

  it('no balance column (ledger-derived)', async () => {
    const cols: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='wallet_accounts' AND column_name='balance_minor'`);
    expect(cols.length).toBe(0);
    const cols2: Array<{ column_name: string }> = await dataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name='customer_funding_requests' AND column_name='balance_minor'`);
    expect(cols2.length).toBe(0);
  });

  it('outbox events exist for funding approved/rejected', async () => {
    const { customerId } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({ customerId, amountMinor: '12000', currency: 'NGN', idempotencyKey: `idem-outbox-${randomUUID()}`, principal: supportMaker });
    const approved = await fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker });
    const outboxApproved: Array<{ event_type: string }> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='customer.funding.approved'`, [created.id]);
    expect(outboxApproved.length).toBe(1);
    const created2 = await fundingService.createRequest({ customerId, amountMinor: '13000', currency: 'NGN', idempotencyKey: `idem-outbox2-${randomUUID()}`, principal: supportMaker });
    await fundingService.reject({ fundingRequestId: created2.id, principal: operatorChecker, rejectionReason: 'test' });
    const outboxRejected: Array<{ event_type: string }> = await dataSource.query(`SELECT event_type FROM outbox_events WHERE aggregate_id=$1 AND event_type='customer.funding.rejected'`, [created2.id]);
    expect(outboxRejected.length).toBe(1);
  });

  it('unauthenticated internal funding rejected (401)', async () => {
    const { customerId } = await createCustomerWithCredential();
    await request(app.getHttpServer())
      .post(`/api/v1/internal/customers/${customerId}/funding-requests`)
      .set('Idempotency-Key', `idem-unauth-http-${randomUUID()}`)
      .send({ amountMinor: '1000', currency: 'NGN' })
      .expect(401);
    const { customerId: cid } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({ customerId: cid, amountMinor: '5000', currency: 'NGN', idempotencyKey: `idem-unauth-approve-${randomUUID()}`, principal: supportMaker });
    await request(app.getHttpServer())
      .post(`/api/v1/internal/customer-funding-requests/${created.id}/approve`)
      .send({})
      .expect(401);
  });

  it('customer cannot approve funding (403) and internal list is workforce-only', async () => {
    const { customerId, token } = await createCustomerWithCredential();
    const created = await fundingService.createRequest({ customerId, amountMinor: '6000', currency: 'NGN', idempotencyKey: `idem-cust-approve-${randomUUID()}`, principal: supportMaker });
    await request(app.getHttpServer())
      .post(`/api/v1/internal/customer-funding-requests/${created.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer())
      .get('/api/v1/internal/customer-funding-requests')
      .set('Authorization', `Bearer ${token}`)
      .expect((r) => expect([401, 403].includes(r.status)).toBe(true));
  });
});
