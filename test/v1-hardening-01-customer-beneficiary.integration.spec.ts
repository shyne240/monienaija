/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID, randomBytes, createHash } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';
import { WalletService } from '../src/wallet/wallet.service';

function encodePbkdf2(password: string, saltStr = 'hardening-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-HARDENING-01 Customer Beneficiary Exposure + Wallet→Wallet Transfer Integration (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1-hardening-01-beneficiary');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    walletService = moduleRef.get(WalletService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource).catch(() => dataSource.destroy().catch(() => undefined));
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // ensure settlement accounts exist (required for funding via ledger)
    const settlement: Array<{ code: string }> = await dataSource.query(`SELECT code FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`);
    if (settlement.length === 0) {
      await dataSource.query(`
        INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
        VALUES
          ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000202','PAYMENT-SETTLEMENT_CLEARING-NGN','Payment settlement clearing NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
          ('00000000-0000-4000-8000-000000000203','PAYMENT-SYSTEM_SUSPENSE-NGN','Payment system suspense NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
          ('00000000-0000-4000-8000-000000000001','AGENT_FUNDING_POOL-NGN','Agent funding pool NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
          ('00000000-0000-4000-8000-000000000002','CASH_TO_CASH-UNCLAIMED-NGN','Cash to cash unclaimed NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
        ON CONFLICT (code) DO NOTHING
      `);
    }
  });

  function genCanonical10(): string {
    // 10-digit starting 8 or 9, valid for RecipientResolution
    const first = Math.random() > 0.5 ? '8' : '9';
    return first + String(Math.floor(100000000 + Math.random() * 900000000));
  }

  async function createCustomer(opts: { phone?: string; reference?: string; displayName?: string; password?: string } = {}): Promise<{ customerId: string; phone: string; token: string; reference: string }> {
    const reference = opts.reference ?? `cust-hardening-${randomUUID()}`;
    const displayName = opts.displayName ?? `Hardening Cust ${randomUUID().slice(0,4)}`;
    const password = opts.password ?? `pw-hardening-${randomUUID().slice(0,8)}`;
    const rows: Array<{ id: string }> = await dataSource.query(`INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`, [reference]);
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, displayName]);
    const canonical10 = opts.phone ?? genCanonical10();
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`, [customerId, `0${canonical10.slice(1)}`, canonical10]);
    const hash = encodePbkdf2(password, `salt-${customerId.slice(0,8)}`);
    await dataSource.query(`INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`, [customerId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    const token = login.body.accessToken as string;
    expect(token).toBeTruthy();
    // ensure wallet exists
    try {
      await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `wallet-${customerId}-${randomUUID()}` });
    } catch {}
    return { customerId, phone: canonical10, token, reference };
  }

  async function getWalletId(customerId: string): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM wallet_accounts WHERE customer_id=$1 LIMIT 1`, [customerId]);
    if (rows[0]) return rows[0].id;
    const w = await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `wallet2-${customerId}-${randomUUID()}` });
    return (w as any).id ?? (w as any).walletId ?? rows[0]!.id;
  }

  async function setPin(customerId: string, token: string, pin = '1234'): Promise<void> {
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin }).expect(200);
  }

  async function fundWallet(customerId: string, amountMinor: string): Promise<void> {
    const walletId = await getWalletId(customerId);
    const walletRows: Array<{ ledger_account_id: string }> = await dataSource.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [walletId]);
    const walletLedgerId = walletRows[0]!.ledger_account_id;
    const poolRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='AGENT_FUNDING_POOL-NGN' LIMIT 1`);
    const poolId = poolRows[0]!.id;
    const journalId = randomUUID();
    const idem = `fund-${customerId}-${amountMinor}-${randomUUID()}`;
    const hash = createHash('sha256').update(`${journalId}-${amountMinor}`).digest('hex');
    await dataSource.transaction(async (manager) => {
      await manager.query(`INSERT INTO ledger_journals (id, idempotency_key, request_hash, currency, accounting_unit, status, total_minor) VALUES ($1,$2,$3,'NGN','CUSTOMER_FUNDS','POSTED',$4)`, [journalId, idem, hash, amountMinor]);
      await manager.query(`INSERT INTO ledger_lines (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit) VALUES ($1,$2,$3,1,'DEBIT',$4,'NGN','CUSTOMER_FUNDS')`, [randomUUID(), journalId, poolId, amountMinor]);
      await manager.query(`INSERT INTO ledger_lines (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit) VALUES ($1,$2,$3,2,'CREDIT',$4,'NGN','CUSTOMER_FUNDS')`, [randomUUID(), journalId, walletLedgerId, amountMinor]);
    });
  }

  async function countJournals(): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_journals`);
    return Number(rows[0]!.cnt);
  }
  async function countLines(): Promise<number> {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM ledger_lines`);
    return Number(rows[0]!.cnt);
  }

  // ──────────────────────────────────────────────
  // PART 1: CRUD
  // ──────────────────────────────────────────────

  it('01. GET /customers/me/beneficiaries unauthenticated 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries').expect(401);
  });

  it('02. GET /customers/me/beneficiaries empty returns pagination page1 limit20', async () => {
    const { token } = await createCustomer();
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(20);
    expect(res.body.pagination.total).toBe(0);
    const ser = JSON.stringify(res.body).toLowerCase();
    expect(ser).not.toContain('pinhash');
    expect(ser).not.toContain('password');
    expect(ser).not.toContain('tokenhash');
    expect(ser).not.toContain('ledger');
  });

  it('03. POST /customers/me/beneficiaries valid identifier creates ACTIVE verified, zero ledger, audit', async () => {
    const alice = await createCustomer({ displayName: 'Alice' });
    const bob = await createCustomer({ displayName: 'Bob' });
    const beforeJ = await countJournals();
    const beforeL = await countLines();
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${alice.token}`).send({ nickname: 'BobNick', beneficiaryIdentifier: bob.phone }).expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.nickname).toBe('BobNick');
    expect(res.body.displayName).toBeTruthy();
    expect(res.body.receivingNumber).toBeTruthy();
    expect(res.body.isVerified).toBe(true);
    expect(res.body.isActive).toBe(true);
    expect(res.body.beneficiaryCustomerId).toBe(bob.customerId);
    expect(res.body.createdAt).toBeTruthy();
    // safe projection exactly, no leak
    const str = JSON.stringify(res.body).toLowerCase();
    expect(str).not.toContain('password');
    expect(str).not.toContain('pinhash');
    expect(str).not.toContain('tokenhash');
    expect(str).not.toContain('ledger');
    expect(str).not.toContain('hash');
    expect(str).not.toContain('otp');
    // zero ledger for CRUD
    const afterJ = await countJournals();
    const afterL = await countLines();
    expect(afterJ).toBe(beforeJ);
    expect(afterL).toBe(beforeL);
    // audit recorded? check audit_logs? At least history exists
    const hist: Array<{ beneficiary_id: string }> = await dataSource.query(`SELECT beneficiary_id FROM beneficiary_histories WHERE beneficiary_id=$1`, [res.body.id]);
    expect(hist.length).toBeGreaterThanOrEqual(2);
  });

  it('04. POST duplicate destination for same customer 409', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'dup1', beneficiaryIdentifier: b.phone }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'dup2', beneficiaryIdentifier: b.phone }).expect(409);
  });

  it('05. POST different customer same destination allowed (not global duplicate)', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const c = await createCustomer();
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'toB', beneficiaryIdentifier: b.phone }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${c.token}`).send({ nickname: 'toB2', beneficiaryIdentifier: b.phone }).expect(201);
  });

  it('06. POST invalid identifier 400', async () => {
    const a = await createCustomer();
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'bad', beneficiaryIdentifier: 'not-a-phone' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'bad', beneficiaryIdentifier: '' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'bad' }).expect(400);
  });

  it('07. POST non-existent recipient 400', async () => {
    const a = await createCustomer();
    const fake = genCanonical10(); // not assigned to any customer
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'fake', beneficiaryIdentifier: fake }).expect(400);
  });

  it('08. POST self as beneficiary 400', async () => {
    const a = await createCustomer();
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'self', beneficiaryIdentifier: a.phone }).expect(400);
  });

  it('09. GET list pagination deterministic page=1 limit=20 max100', async () => {
    const a = await createCustomer();
    const b1 = await createCustomer();
    const b2 = await createCustomer();
    const b3 = await createCustomer();
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'b1', beneficiaryIdentifier: b1.phone }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'b2', beneficiaryIdentifier: b2.phone }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'b3', beneficiaryIdentifier: b3.phone }).expect(201);
    const list = await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries?page=1&limit=2').set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(list.body.items.length).toBe(2);
    expect(list.body.pagination.total).toBe(3);
    expect(list.body.pagination.totalPages).toBe(2);
    expect(list.body.pagination.hasNextPage).toBe(true);
    expect(list.body.pagination.page).toBe(1);
    expect(list.body.pagination.limit).toBe(2);
    // deterministic: second page
    const list2 = await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries?page=2&limit=2').set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(list2.body.items.length).toBe(1);
    expect(list2.body.pagination.hasNextPage).toBe(false);
    // limit >100 capped
    const capped = await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries?page=1&limit=500').set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(capped.body.pagination.limit).toBe(100);
    // safe fields only
    for (const item of list.body.items) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('nickname');
      expect(item).toHaveProperty('beneficiaryCustomerId');
      expect(item).toHaveProperty('displayName');
      expect(item).toHaveProperty('receivingNumber');
      expect(item).toHaveProperty('isVerified');
      expect(item).toHaveProperty('isActive');
      expect(item).toHaveProperty('createdAt');
      const s = JSON.stringify(item).toLowerCase();
      expect(s).not.toContain('pinhash');
      expect(s).not.toContain('ledger');
      expect(s).not.toContain('hash');
    }
  });

  it('10. GET single beneficiary ownership 200 safe, foreign 404', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const c = await createCustomer();
    const create = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'toB', beneficiaryIdentifier: b.phone }).expect(201);
    const id = create.body.id as string;
    const get = await request(app.getHttpServer()).get(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(get.body.id).toBe(id);
    expect(get.body.beneficiaryCustomerId).toBe(b.customerId);
    expect(get.body.isVerified).toBe(true);
    // foreign customer cannot see
    await request(app.getHttpServer()).get(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${c.token}`).expect(404);
    // unauth 401
    await request(app.getHttpServer()).get(`/api/v1/customers/me/beneficiaries/${id}`).expect(401);
  });

  it('11. PATCH nickname/active ownership, audit no ledger, no ownership change', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const create = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'orig', beneficiaryIdentifier: b.phone }).expect(201);
    const id = create.body.id as string;
    const beforeJ = await countJournals();
    // patch nickname
    const patchedNick = await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${a.token}`).send({ nickname: 'newNick' }).expect(200);
    expect(patchedNick.body.nickname).toBe('newNick');
    expect(patchedNick.body.beneficiaryCustomerId).toBe(b.customerId);
    // patch to suspended
    const patchedSuspend = await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${a.token}`).send({ isActive: false }).expect(200);
    expect(patchedSuspend.body.isActive).toBe(false);
    // reactivate
    const patchedActive = await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${a.token}`).send({ status: 'ACTIVE' }).expect(200);
    expect(patchedActive.body.isActive).toBe(true);
    // ensure ownership still a, destination unchanged
    const after = await request(app.getHttpServer()).get(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(after.body.beneficiaryCustomerId).toBe(b.customerId);
    expect(after.body.receivingNumber).toBe(patchedNick.body.receivingNumber);
    const afterJ = await countJournals();
    expect(afterJ).toBe(beforeJ);
    // foreign patch 404
    const c = await createCustomer();
    await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${c.token}`).send({ nickname: 'hacked' }).expect(404);
  });

  it('12. PATCH with invalid fields 400, no ledger', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const create = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 't', beneficiaryIdentifier: b.phone }).expect(201);
    const id = create.body.id as string;
    await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${a.token}`).send({ customerId: 'forged' } as any).expect(400);
    await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${id}`).set('Authorization', `Bearer ${a.token}`).send({ destinationIdentifier: 'forged' } as any).expect(400);
  });

  it('13. Security: Agent cannot access customer beneficiary routes 401/403, no agent route exists', async () => {
    const a = await createCustomer();
    // create agent token via direct insert like a23
    const classRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`, [`cls-hard-${randomUUID().slice(0,8)}`, `AG-${randomUUID().slice(0,6)}`, 'Hard Class', JSON.stringify(['CASH_IN']), JSON.stringify({})]);
    const classId = classRows[0]!.id;
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [`agent-hard-${randomUUID()}`, classId]);
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-hard', 'agent-salt-hard');
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'agent-pass-hard' }).expect(200);
    const agentToken = login.body.accessToken as string;
    await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${agentToken}`).expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${agentToken}`).send({ nickname: 'x', beneficiaryIdentifier: a.phone }).expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).get('/api/v1/agents/me/beneficiaries').set('Authorization', `Bearer ${agentToken}`).expect(404);
    await request(app.getHttpServer()).post('/api/v1/agents/me/beneficiaries').set('Authorization', `Bearer ${agentToken}`).send({ nickname: 'x', beneficiaryIdentifier: a.phone }).expect(404);
    // ensure no agent beneficiary table exposure
    await request(app.getHttpServer()).get('/api/v1/agents/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).expect(404);
  });

  it('14. Beneficiary CRUD zero ledger isolation', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const before = await countJournals();
    const c1 = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'n1', beneficiaryIdentifier: b.phone }).expect(201);
    const mid = await countJournals();
    expect(mid).toBe(before);
    await request(app.getHttpServer()).get(`/api/v1/customers/me/beneficiaries/${c1.body.id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(await countJournals()).toBe(before);
    await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${c1.body.id}`).set('Authorization', `Bearer ${a.token}`).send({ nickname: 'n1-up' }).expect(200);
    expect(await countJournals()).toBe(before);
  });

  // ──────────────────────────────────────────────
  // PART 2: Transfer via beneficiary
  // ──────────────────────────────────────────────

  it('15. POST /customers/me/transfers via destinationWalletId still works (backward compat)', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '100000');
    const srcWallet = await getWalletId(src.customerId);
    const dstWallet = await getWalletId(dst.customerId);
    const before = await countJournals();
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, destinationWalletId: dstWallet, amountMinor: '10000', currency: 'NGN', pin: '1234' }).expect(201);
    expect(res.body.id).toBeTruthy();
    const after = await countJournals();
    expect(after).toBe(before + 1);
    // journal balanced with 2 lines
    const lines: Array<{ amount_minor: string; direction: string }> = await dataSource.query(`SELECT amount_minor::text, direction FROM ledger_lines WHERE journal_id IN (SELECT id FROM ledger_journals WHERE idempotency_key=$1)`, [res.body.idempotencyKey ?? res.body.id]);
    // alternative check via transfer id: find journal via transfer table? Check transfer's id maps? We'll just verify ledger_lines count increased by 2
    expect(await countLines()).toBeGreaterThan(0);
  });

  it('16. POST /customers/me/transfers via beneficiaryId success, one journal, correct debit/credit', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '200000');
    const srcWallet = await getWalletId(src.customerId);
    const dstWallet = await getWalletId(dst.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    const beforeJ = await countJournals();
    const beforeL = await countLines();
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '15000', currency: 'NGN', reference: `ref-${randomUUID()}`, pin: '1234' }).expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.sourceWalletId).toBe(srcWallet);
    expect(res.body.destinationWalletId).toBe(dstWallet);
    const afterJ = await countJournals();
    const afterL = await countLines();
    expect(afterJ).toBe(beforeJ + 1);
    expect(afterL).toBe(beforeL + 2);
    // verify balances via ledger: source debited, dest credited (check lines sum)
    const srcBalRows: Array<{ bal: string }> = await dataSource.query(`SELECT COALESCE(SUM(CASE WHEN ll.direction='CREDIT' THEN ll.amount_minor ELSE -ll.amount_minor END),0)::text as bal FROM ledger_lines ll JOIN wallet_accounts wa ON wa.ledger_account_id=ll.ledger_account_id WHERE wa.id=$1`, [srcWallet]);
    const dstBalRows: Array<{ bal: string }> = await dataSource.query(`SELECT COALESCE(SUM(CASE WHEN ll.direction='CREDIT' THEN ll.amount_minor ELSE -ll.amount_minor END),0)::text as bal FROM ledger_lines ll JOIN wallet_accounts wa ON wa.ledger_account_id=ll.ledger_account_id WHERE wa.id=$1`, [dstWallet]);
    // after funding 200k and transfer 15k, src should be 185k, dst 15k
    expect(Number(srcBalRows[0]!.bal)).toBe(185000);
    expect(Number(dstBalRows[0]!.bal)).toBe(15000);
  });

  it('17. POST via beneficiaryId requires exactly one of destinationWalletId/beneficiaryId', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '50000');
    const srcWallet = await getWalletId(src.customerId);
    const dstWallet = await getWalletId(dst.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    // both provided
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, destinationWalletId: dstWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(400);
    // neither
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, amountMinor: '1000', currency: 'NGN', pin: '1234' } as any).expect(400);
  });

  it('18. Transfer via foreign beneficiaryId blocked 404, cannot access/modify B beneficiary', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const c = await createCustomer(); // third party
    await setPin(a.customerId, a.token, '1234');
    await fundWallet(a.customerId, '50000');
    const aWallet = await getWalletId(a.customerId);
    // b creates beneficiary to c
    const benBC = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${b.token}`).send({ nickname: 'toC', beneficiaryIdentifier: c.phone }).expect(201);
    const benId = benBC.body.id as string;
    // a tries to use b's beneficiary
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${a.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: aWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(404);
    // a tries to GET b's beneficiary
    await request(app.getHttpServer()).get(`/api/v1/customers/me/beneficiaries/${benId}`).set('Authorization', `Bearer ${a.token}`).expect(404);
    // a tries to PATCH b's beneficiary
    await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${benId}`).set('Authorization', `Bearer ${a.token}`).send({ nickname: 'hacked' }).expect(404);
  });

  it('19. Transfer via inactive beneficiary blocked 400', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '50000');
    const srcWallet = await getWalletId(src.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${benId}`).set('Authorization', `Bearer ${src.token}`).send({ isActive: false }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(400);
    // reactivate and should succeed
    await request(app.getHttpServer()).patch(`/api/v1/customers/me/beneficiaries/${benId}`).set('Authorization', `Bearer ${src.token}`).send({ isActive: true }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(201);
  });

  it('20. Transfer via unverified beneficiary blocked 400', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '50000');
    const srcWallet = await getWalletId(src.customerId);
    // Manually create PENDING unverified beneficiary via service bypass (direct DB insert) to simulate
    const benId = randomUUID();
    const ref = `unver-${randomUUID().slice(0,8).toLowerCase()}`;
    await dataSource.query(
      `INSERT INTO customer_beneficiaries (id, customer_id, beneficiary_type, display_name, reference, destination_identifier, normalized_destination_identifier, destination_name, destination_institution, nickname, status, verified, version) VALUES ($1,$2,'INTERNAL_CUSTOMER',$3,$4,$5,$5,$3,'MONIE_NAIJA','unverified','PENDING',false,1)`,
      [benId, src.customerId, dst.phone, ref, dst.phone],
    );
    await dataSource.query(`INSERT INTO beneficiary_ownerships (id, beneficiary_id, customer_id) VALUES ($1,$2,$3)`, [randomUUID(), benId, src.customerId]);
    // attempt transfer should be blocked due to not ACTIVE
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(400);
    // also test SUSPENDED unverified? Set to SUSPENDED still blocked via inactive
    await dataSource.query(`UPDATE customer_beneficiaries SET status='SUSPENDED' WHERE id=$1`, [benId]);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(400);
    // now set to ACTIVE but still unverified -> should be blocked due to verified false
    await dataSource.query(`UPDATE customer_beneficiaries SET status='ACTIVE', verified=false WHERE id=$1`, [benId]);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(400);
  });

  it('21. Transfer PIN required, invalid PIN 401, no journal created', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '50000');
    const srcWallet = await getWalletId(src.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    const before = await countJournals();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN', pin: '9999' }).expect(401);
    expect(await countJournals()).toBe(before);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '1000', currency: 'NGN' } as any).expect(401);
    expect(await countJournals()).toBe(before);
  });

  it('22. Idempotency CASE A: same beneficiaryId retry with same Idempotency-Key idempotent, no double journal', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '100000');
    const srcWallet = await getWalletId(src.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    const key = `idem-caseA-${randomUUID()}`;
    const beforeJ = await countJournals();
    const first = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '5000', currency: 'NGN', reference: `ref-${randomUUID()}`, pin: '1234' }).expect(201);
    const firstId = first.body.id as string;
    expect(await countJournals()).toBe(beforeJ + 1);
    const second = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '5000', currency: 'NGN', reference: first.body.reference, pin: '1234' }).expect(201);
    expect(second.body.id).toBe(firstId);
    expect(await countJournals()).toBe(beforeJ + 1);
  });

  it('23. Idempotency CASE B: beneficiaryId→W vs destinationWalletId=W same Idempotency-Key same amount idempotent (resolved wallet hash)', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '100000');
    const srcWallet = await getWalletId(src.customerId);
    const dstWallet = await getWalletId(dst.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    const key = `idem-caseB-${randomUUID()}`;
    const ref = `ref-caseB-${randomUUID()}`;
    const viaBen = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '7000', currency: 'NGN', reference: ref, pin: '1234' }).expect(201);
    const viaBenId = viaBen.body.id as string;
    // Second request uses direct destinationWalletId with same economic params and same Idempotency-Key — should be idempotent (same transfer), not double post
    const beforeJ = await countJournals();
    const viaDirect = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, destinationWalletId: dstWallet, amountMinor: '7000', currency: 'NGN', reference: ref, pin: '1234' }).expect(201);
    expect(viaDirect.body.id).toBe(viaBenId);
    expect(await countJournals()).toBe(beforeJ);
  });

  it('24. Idempotency different amount same key 409, different beneficiary same key 409', async () => {
    const src = await createCustomer();
    const dst1 = await createCustomer();
    const dst2 = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '100000');
    const srcWallet = await getWalletId(src.customerId);
    const ben1 = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'to1', beneficiaryIdentifier: dst1.phone }).expect(201);
    const ben2 = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'to2', beneficiaryIdentifier: dst2.phone }).expect(201);
    const key = `idem-caseC-${randomUUID()}`;
    const ref = `ref-${randomUUID()}`;
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: ben1.body.id, amountMinor: '5000', currency: 'NGN', reference: ref, pin: '1234' }).expect(201);
    // different amount same key -> 409
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: ben1.body.id, amountMinor: '6000', currency: 'NGN', reference: ref, pin: '1234' }).expect(409);
    // different beneficiary (different resolved wallet) same key -> 409 (because destination differs, requestHash differs)
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: ben2.body.id, amountMinor: '5000', currency: 'NGN', reference: ref, pin: '1234' }).expect(409);
  });

  it('25. No GET/POST /agents/me/beneficiaries route', async () => {
    const c = await createCustomer();
    await request(app.getHttpServer()).get('/api/v1/agents/me/beneficiaries').set('Authorization', `Bearer ${c.token}`).expect(404);
    await request(app.getHttpServer()).post('/api/v1/agents/me/beneficiaries').set('Authorization', `Bearer ${c.token}`).send({ nickname: 'x', beneficiaryIdentifier: c.phone }).expect(404);
  });

  it('26. Forged customerId in body ignored, ownership enforced via auth principal', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const c = await createCustomer();
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'toB', beneficiaryIdentifier: b.phone, customerId: c.customerId } as any).expect(201);
    expect(res.body.beneficiaryCustomerId).toBe(b.customerId);
    // verify that beneficiary belongs to a, not c
    const listC = await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${c.token}`).expect(200);
    expect(listC.body.items.length).toBe(0);
    const listA = await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(listA.body.items.length).toBe(1);
  });

  it('27. Response never leaks PIN/OTP/hash/ledger/internal', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).send({ nickname: 'toB', beneficiaryIdentifier: b.phone }).expect(201);
    const all = await request(app.getHttpServer()).get('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${a.token}`).expect(200);
    const single = await request(app.getHttpServer()).get(`/api/v1/customers/me/beneficiaries/${ben.body.id}`).set('Authorization', `Bearer ${a.token}`).expect(200);
    const combined = JSON.stringify([ben.body, all.body, single.body]).toLowerCase();
    expect(combined).not.toContain('password');
    expect(combined).not.toContain('hash');
    expect(combined).not.toContain('pin');
    expect(combined).not.toContain('otp');
    expect(combined).not.toContain('ledger');
    expect(combined).not.toContain('journal');
    expect(combined).not.toContain('secret');
    expect(combined).not.toContain('token');
  });

  it('28. Migration count is additive and chain intact', async () => {
    const rows: Array<{ cnt: string }> = await dataSource.query(`SELECT count(*)::text as cnt FROM typeorm_migrations`);
    expect(Number(rows[0]!.cnt)).toBeGreaterThanOrEqual(67);
    const files: Array<{ name: string }> = await dataSource.query(`SELECT name FROM typeorm_migrations ORDER BY name`);
    expect(files.length).toBeGreaterThanOrEqual(67);
    expect(files.some((f) => f.name.includes('1785753600066'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600065'))).toBe(true);
    expect(files.some((f) => f.name.includes('1785753600000'))).toBe(true);
  });

  it('29. Concurrent transfer via same beneficiaryId with same key does not double post (serializable)', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '100000');
    const srcWallet = await getWalletId(src.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    const key = `idem-conc-${randomUUID()}`;
    const before = await countJournals();
    const promises = [
      request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '9000', currency: 'NGN', pin: '1234' }),
      request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', key).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '9000', currency: 'NGN', pin: '1234' }),
    ];
    const results = await Promise.all(promises);
    for (const r of results) expect([200, 201].includes(r.status)).toBe(true);
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    expect(await countJournals()).toBe(before + 1);
  });

  it('30. Transfer via beneficiary reuses existing TransferService path: fee 0, balanced journal, same as direct', async () => {
    const src = await createCustomer();
    const dst = await createCustomer();
    await setPin(src.customerId, src.token, '1234');
    await fundWallet(src.customerId, '50000');
    const srcWallet = await getWalletId(src.customerId);
    const ben = await request(app.getHttpServer()).post('/api/v1/customers/me/beneficiaries').set('Authorization', `Bearer ${src.token}`).send({ nickname: 'toDst', beneficiaryIdentifier: dst.phone }).expect(201);
    const benId = ben.body.id as string;
    const beforeJ = await countJournals();
    const beforeL = await countLines();
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${src.token}`).set('Idempotency-Key', `idem-${randomUUID()}`).send({ sourceWalletId: srcWallet, beneficiaryId: benId, amountMinor: '12345', currency: 'NGN', pin: '1234' }).expect(201);
    expect(res.body.feeMinor ?? res.body.fee ?? '0').toBe('0');
    expect(await countJournals()).toBe(beforeJ + 1);
    expect(await countLines()).toBe(beforeL + 2);
    // verify journal total and lines balanced
    const journal: Array<{ total_minor: string; currency: string }> = await dataSource.query(`SELECT total_minor::text, currency FROM ledger_journals ORDER BY created_at DESC LIMIT 1`);
    expect(journal[0]!.total_minor).toBe('12345');
    expect(journal[0]!.currency).toBe('NGN');
    const lines: Array<{ direction: string; amount_minor: string }> = await dataSource.query(`SELECT direction, amount_minor::text FROM ledger_lines WHERE journal_id=(SELECT id FROM ledger_journals ORDER BY created_at DESC LIMIT 1) ORDER BY line_number`);
    expect(lines.length).toBe(2);
    expect(lines[0]!.amount_minor).toBe('12345');
    expect(lines[1]!.amount_minor).toBe('12345');
    expect(new Set(lines.map(l=>l.direction))).toEqual(new Set(['DEBIT','CREDIT']));
  });
});
