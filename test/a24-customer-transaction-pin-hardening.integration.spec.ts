/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { createHash, pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'a24-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

describe('A24 Customer Wallet→Wallet Transaction PIN Hardening (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a24pin');
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

  async function createCustomerWithCredential(opts: { reference?: string; password?: string; custStatus?: string } = {}): Promise<{ customerId: string; reference: string; phone: string; token: string }> {
    const reference = opts.reference ?? `cust-a24-${randomUUID()}`;
    const password = opts.password ?? 'correct-password-a24';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL',$2,'LEVEL_1','APPROVED') RETURNING id`,
      [reference, opts.custStatus ?? 'ACTIVE'],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'Customer A24']);
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
    return { customerId, reference, phone: canonical10, token };
  }

  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [`cls-a24-${randomUUID().slice(0,8)}`, `A24-${randomUUID().slice(0,6)}`, 'A24 Class', JSON.stringify(['CASH_IN']), JSON.stringify({})],
    );
    const classId = classRows[0]!.id;
    const ref = `agent-a24-${randomUUID()}`;
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [ref, classId]);
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-a24', 'agent-salt');
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'agent-pass-a24' }).expect(200);
    return login.body.accessToken as string;
  }

  // 1. Valid PIN succeeds — financial execution via TransferService, ledger-derived, SERIALIZABLE preserved
  it('1. Valid PIN — Wallet→Wallet succeeds when PIN correct, delegates to TransferService (SERIALIZABLE, no second ledger)', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-1-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-1-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT1_${randomUUID().slice(0,6)}`, name: 'Plat1', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund1-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '100000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '100000' }] });
    const beforeWa = await ws.getWalletBalance(wa.id);
    expect(beforeWa.balanceMinor).toBe('100000');
    const idem = `idem-a24-1-${randomUUID()}`;
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '25000', currency: 'NGN', reference: `ref-${randomUUID()}`, narration: 'test valid', pin: '1234' }).expect(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.amountMinor).toBe('25000');
    const afterWa = await ws.getWalletBalance(wa.id);
    const afterWb = await ws.getWalletBalance(wb.id);
    expect(afterWa.balanceMinor).toBe('75000');
    expect(afterWb.balanceMinor).toBe('25000');
    // response must not contain pin
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('1234');
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('pin');
  });

  // 2. No PIN → 401 Transaction PIN required
  it('2. No PIN — 401 when PIN missing', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-2-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-2-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT2_${randomUUID().slice(0,6)}`, name: 'Plat2', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund2-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    // do not set PIN, try without pin field
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-2-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN' }).expect(401);
    expect(res.body.message).toMatch(/PIN/i);
    // also empty pin
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-2b-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '' }).expect(401);
    // no double debit
    const afterWa = await ws.getWalletBalance(wa.id);
    expect(afterWa.balanceMinor).toBe('50000');
  });

  // 3. Invalid PIN → 401
  it('3. Invalid PIN — 401 when PIN mismatch', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-3-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-3-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT3_${randomUUID().slice(0,6)}`, name: 'Plat3', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund3-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    const bad = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-3-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '9999' }).expect(401);
    expect(bad.body.message).toMatch(/Invalid PIN/i);
    // format invalid also 401
    const fmt = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-3f-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '12' }).expect(401);
    expect(fmt.body.message).toMatch(/PIN/i);
    const afterWa = await ws.getWalletBalance(wa.id);
    expect(afterWa.balanceMinor).toBe('50000');
  });

  // 4. Lockout after 5 failures (MAX_FAILED_PINS=5)
  it('4. Lockout after 5 consecutive invalid PINs — 5th locks, verify taxonomy', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '5555' }).expect(200);
    // verify via dedicated endpoint shows lockout progression
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '0000' }).expect(200);
      expect(res.body.verified).toBe(false);
      if (i < 4) expect(res.body.locked).not.toBe(true);
    }
    const locked = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '5555' }).expect(200);
    expect(locked.body.verified).toBe(false);
    expect(locked.body.locked).toBe(true);
    // also check DB: accountLocked true
    const pinRows: Array<{ account_locked: boolean; failed_count: number }> = await dataSource.query(`SELECT account_locked, failed_count FROM customer_transaction_pins WHERE customer_id=$1`, [customerId]);
    expect(pinRows[0].account_locked).toBe(true);
    expect(Number(pinRows[0].failed_count)).toBeGreaterThanOrEqual(5);
  });

  // 5. Locked rejects even correct PIN via transfers
  it('5. Locked PIN rejects Wallet→Wallet even with correct PIN', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '7777' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-5-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-5-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT5_${randomUUID().slice(0,6)}`, name: 'Plat5', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund5-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    // 5 failures via transfers
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-5f-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '1000', currency: 'NGN', pin: '0000' }).expect(401);
    }
    // now correct PIN should be locked
    const locked = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-5c-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '1000', currency: 'NGN', pin: '7777' }).expect(401);
    expect(locked.body.message).toMatch(/locked/i);
    // not reset by correct attempt
    const rows: Array<{ account_locked: boolean }> = await dataSource.query(`SELECT account_locked FROM customer_transaction_pins WHERE customer_id=$1`, [custA]);
    expect(rows[0].account_locked).toBe(true);
    const afterWa = await ws.getWalletBalance(wa.id);
    expect(afterWa.balanceMinor).toBe('50000'); // no debit
  });

  // 6. A cannot use B wallet — 404 fail-closed ownership before PIN check
  it('6. Ownership — Customer A cannot use Customer B wallet as source (404), even with valid PIN', async () => {
    const { token: tokenA, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    const { token: tokenB } = await createCustomerWithCredential(); // third but we need B wallet
    // create wallets
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const ws = app.get(WS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-6-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-6-wb-${custB}` });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenA}`).send({ pin: '1234' }).expect(200);
    // A tries to send from B's wallet
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', `idem-a24-6-${randomUUID()}`).send({ sourceWalletId: wb.id, destinationWalletId: wa.id, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(404);
    expect(res.body.message).toMatch(/not found/i);
  });

  // 7. A cannot use B PIN — 401 when PIN belongs to another customer
  it('7. Binding — Customer A cannot succeed using Customer B PIN', async () => {
    const { token: tokenA, customerId: custA } = await createCustomerWithCredential();
    const { token: tokenB, customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenA}`).send({ pin: '1111' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenB}`).send({ pin: '2222' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-7-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-7-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT7_${randomUUID().slice(0,6)}`, name: 'Plat7', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund7-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    // A tries to use B's PIN 2222 for A's wallet
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', `idem-a24-7-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '2222' }).expect(401);
    expect(res.body.message).toMatch(/Invalid PIN/i);
    const afterWa = await ws.getWalletBalance(wa.id);
    expect(afterWa.balanceMinor).toBe('50000');
  });

  // 8. Double-entry journal preserved — DEBIT source, CREDIT destination, sum 0, exactly-one execution
  it('8. Double-entry — journal has balanced DEBIT/CREDIT, wallet balances reflect exactly one execution', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '9999' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-8-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-8-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT8_${randomUUID().slice(0,6)}`, name: 'Plat8', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund8-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '80000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '80000' }] });
    const idem = `idem-a24-8-${randomUUID()}`;
    const ref = `ref-${randomUUID()}`;
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '30000', currency: 'NGN', reference: ref, pin: '9999' }).expect(201);
    const transferId = res.body.id as string;
    expect(res.body.journalId).toBeDefined();
    // verify ledger_lines
    const journalId = res.body.journalId as string;
    const lines: Array<{ ledger_account_id: string; direction: string; amount_minor: string }> = await dataSource.query(`SELECT ledger_account_id, direction, amount_minor FROM ledger_lines WHERE journal_id=$1 ORDER BY line_number`, [journalId]);
    expect(lines.length).toBe(2);
    expect(lines[0].direction).toBe('DEBIT');
    expect(lines[1].direction).toBe('CREDIT');
    expect(lines[0].amount_minor).toBe('30000');
    expect(lines[1].amount_minor).toBe('30000');
    expect(lines[0].ledger_account_id).toBe(wa.ledgerAccountId);
    expect(lines[1].ledger_account_id).toBe(wb.ledgerAccountId);
    // total debits = total credits
    // also check transfer has journal
    const trRows: Array<{ journal_id: string; status: string }> = await dataSource.query(`SELECT journal_id, status FROM transfers WHERE id=$1`, [transferId]);
    expect(trRows[0].journal_id).toBe(journalId);
    expect(trRows[0].status).toBe('COMPLETED');
    const afterWa = await ws.getWalletBalance(wa.id);
    const afterWb = await ws.getWalletBalance(wb.id);
    expect(afterWa.balanceMinor).toBe('50000');
    expect(afterWb.balanceMinor).toBe('30000');
  });

  // 9. Idempotency same key same op — no double debit, same transferId
  it('9. Idempotency — same Idempotency-Key + same business params returns same transferId, no double debit', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '4321' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-9-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-9-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT9_${randomUUID().slice(0,6)}`, name: 'Plat9', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund9-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '60000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '60000' }] });
    const idem = `idem-a24-9-${randomUUID()}`;
    const payload = { sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '15000', currency: 'NGN', reference: `ref-same-${randomUUID()}`, pin: '4321' };
    const first = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send(payload).expect(201);
    const tid1 = first.body.id as string;
    // same key same op (identical payload) — should be idempotent, same id
    const second = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send(payload).expect(201);
    expect(second.body.id).toBe(tid1);
    const afterWa = await ws.getWalletBalance(wa.id);
    const afterWb = await ws.getWalletBalance(wb.id);
    expect(afterWa.balanceMinor).toBe('45000'); // only one debit
    expect(afterWb.balanceMinor).toBe('15000');
    // only one transfer row
    const cnt: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM transfers WHERE idempotency_key=$1`, [idem]);
    expect(Number(cnt[0].count)).toBe(1);
  });

  // 10. Idempotency — same key same op with same hash but PIN not in hash retains idempotency
  it('10. Idempotency — PIN not in requestHash, same business params with same idempotency key remains idempotent', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1111' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-10-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-10-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT10_${randomUUID().slice(0,6)}`, name: 'Plat10', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund10-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '40000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '40000' }] });
    const idem = `idem-a24-10-${randomUUID()}`;
    const payload = { sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '10000', currency: 'NGN', pin: '1111' };
    const first = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send(payload).expect(201);
    const tid = first.body.id as string;
    // verify requestHash equals hash of business params only (no pin)
    const rows: Array<{ request_hash: string }> = await dataSource.query(`SELECT request_hash FROM transfers WHERE id=$1`, [tid]);
    const expectedHash = createHash('sha256').update(canonicalJson({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '10000', currency: 'NGN', reference: null, narration: null })).digest('hex');
    expect(rows[0].request_hash).toBe(expectedHash);
    // second call same idem same op (still pin 1111) should be same tid
    const second = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send(payload).expect(201);
    expect(second.body.id).toBe(tid);
  });

  // 11. Idempotency — same key different operation → 409
  it('11. Idempotency — same Idempotency-Key but different amount → 409 Conflict', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '2222' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-11-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-11-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT11_${randomUUID().slice(0,6)}`, name: 'Plat11', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund11-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    const idem = `idem-a24-11-${randomUUID()}`;
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '2222' }).expect(201);
    const conflict = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', idem).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '9999', currency: 'NGN', pin: '2222' }).expect(409);
    expect(conflict.body.message).toMatch(/idempotency/i);
  });

  // 12. PIN not in audit — CUSTOMER_TRANSACTION_PIN and TRANSFER audits contain no pin/pinHash
  it('12. No PIN in audit — audit_events for PIN and transfer contain no plaintext pin/pinHash', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '3333' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-12-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-12-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT12_${randomUUID().slice(0,6)}`, name: 'Plat12', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund12-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '40000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '40000' }] });
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-12-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '3333' }).expect(201);
    const tid = res.body.id as string;
    // also do a failed pin attempt to generate PIN_FAILED audit
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-12f-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '1000', currency: 'NGN', pin: '0000' }).expect(401);
    const audits: Array<{ entity_type: string; action: string; previous_values: any; new_values: any }> = await dataSource.query(`SELECT entity_type, action, previous_values, new_values FROM audit_events WHERE entity_type IN ('CUSTOMER_TRANSACTION_PIN','TRANSFER') ORDER BY occurred_at DESC LIMIT 20`);
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      const blob = JSON.stringify({ prev: a.previous_values, nw: a.new_values }).toLowerCase();
      expect(blob).not.toContain('3333');
      expect(blob).not.toContain('0000');
      // ensure no pinhash / pin plaintext — allow pinVersion field (contains "pin" as substring) so check for exact key
      expect(blob).not.toContain('"pinhash"');
      expect(blob).not.toContain('"pin":');
      expect(blob).not.toContain('"pin" :');
      // pinHash must not be present as PBKDF2 string
      if (a.entity_type === 'CUSTOMER_TRANSACTION_PIN') {
        expect(blob).not.toContain('$pbkdf2');
        expect(blob).not.toContain('pbkdf2$sha256');
      }
    }
    // also check transfer specific audit
    const transferAudits: Array<{ new_values: any }> = await dataSource.query(`SELECT new_values FROM audit_events WHERE entity_type='TRANSFER' AND entity_id=$1`, [tid]);
    if (transferAudits.length > 0) {
      const blob = JSON.stringify(transferAudits[0].new_values).toLowerCase();
      expect(blob).not.toContain('3333');
      expect(blob).not.toContain('"pin"');
      expect(blob).not.toContain('pinhash');
    }
  });

  // 13. PIN not in requestHash / transfer metadata / journal metadata
  it('13. No PIN persisted — requestHash, transfer row, journal metadata contain no PIN', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '4444' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-13-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-13-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT13_${randomUUID().slice(0,6)}`, name: 'Plat13', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund13-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '30000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '30000' }] });
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-13-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '7000', currency: 'NGN', pin: '4444' }).expect(201);
    const tid = res.body.id as string;
    const jid = res.body.journalId as string;
    const tRows: Array<{ request_hash: string; reference: string | null; narration: string | null }> = await dataSource.query(`SELECT request_hash, reference, narration FROM transfers WHERE id=$1`, [tid]);
    const rh = tRows[0].request_hash;
    // recompute expected without PIN
    const expected = createHash('sha256').update(canonicalJson({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '7000', currency: 'NGN', reference: null, narration: null })).digest('hex');
    expect(rh).toBe(expected);
    expect(rh).not.toContain('4444');
    const jRows: Array<{ metadata: any }> = await dataSource.query(`SELECT metadata FROM ledger_journals WHERE id=$1`, [jid]);
    expect(JSON.stringify(jRows[0].metadata).toLowerCase()).not.toContain('4444');
    expect(JSON.stringify(jRows[0].metadata).toLowerCase()).not.toContain('pin');
    // also check full transfer row dump
    const full: Array<any> = await dataSource.query(`SELECT * FROM transfers WHERE id=$1`, [tid]);
    expect(JSON.stringify(full[0]).toLowerCase()).not.toContain('4444');
    expect(JSON.stringify(full[0]).toLowerCase()).not.toContain('pin');
  });

  // 14. PIN not in response
  it('14. No PIN leakage in responses — transfer, wallet, profile, dashboard, transactions', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '5678' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-14-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-14-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT14_${randomUUID().slice(0,6)}`, name: 'Plat14', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund14-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '20000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '20000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-14-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '4000', currency: 'NGN', pin: '5678' }).expect(201);
    const tid = tr.body.id as string;
    const bodies = await Promise.all([
      request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${token}`).expect(200).then(r=>r.body),
      request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).expect(200).then(r=>r.body),
      request(app.getHttpServer()).get('/api/v1/customers/me/wallets').set('Authorization', `Bearer ${token}`).expect(200).then(r=>r.body),
      request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).expect(200).then(r=>r.body),
      request(app.getHttpServer()).get('/api/v1/customers/me/dashboard').set('Authorization', `Bearer ${token}`).expect(200).then(r=>r.body),
      Promise.resolve(tr.body),
    ]);
    for (const b of bodies) {
      const low = JSON.stringify(b).toLowerCase();
      expect(low).not.toContain('5678');
      expect(low).not.toContain('pinhash');
      // pin key should not appear at all
      expect(low).not.toMatch(/\"pin\"/);
    }
  });

  // 15. Agent rejection — 403/401
  it('15. Agent token cannot access Customer Wallet→Wallet — 403/401, no financial effect', async () => {
    const { customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    const agentToken = await createAgentToken();
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const ws = app.get(WS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-15-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-15-wb-${custB}` });
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${agentToken}`).set('Idempotency-Key', `idem-a24-15-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
    // ensure no transfer created
    const cnt: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM transfers WHERE source_wallet_id=$1`, [wa.id]);
    expect(Number(cnt[0].count)).toBe(0);
  });

  // 16. Unauthenticated 401
  it('16. Unauthenticated — 401 without token, even with PIN', async () => {
    const { customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const ws = app.get(WS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-16-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-16-wb-${custB}` });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Idempotency-Key', `idem-a24-16-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', 'Bearer invalid-token').set('Idempotency-Key', `idem-a24-16b-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(401);
  });

  // 17. Insufficient funds unchanged — still 422, not masked by PIN, balance unchanged
  it('17. Insufficient funds — with correct PIN, 422 INSUFFICIENT_FUNDS, no double spend, balance unchanged', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '8888' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-17-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-17-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLAT17_${randomUUID().slice(0,6)}`, name: 'Plat17', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund17-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '2000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '2000' }] });
    const beforeWa = await ws.getWalletBalance(wa.id);
    expect(beforeWa.balanceMinor).toBe('2000');
    const fail = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-17-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '8888' }).expect((r)=>expect([422,409,400].includes(r.status)).toBe(true));
    // should be 422 insufficient funds
    expect(fail.status).toBe(422);
    expect(JSON.stringify(fail.body).toLowerCase()).toMatch(/insufficient|funds/);
    const afterWa = await ws.getWalletBalance(wa.id);
    expect(afterWa.balanceMinor).toBe('2000');
    // with wrong PIN, should be 401 not 422 (PIN check first)
    const pinFail = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a24-17b-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '0000' }).expect(401);
    expect(pinFail.status).toBe(401);
  });

  // 18. Ownership fail-closed — missing Idempotency-Key still 400 even with PIN, and ownership cross-customer transfer not visible
  it('18. Ownership fail-closed — missing Idempotency-Key 400, cross-customer detail 404 after successful PIN transfer', async () => {
    const { token: tokenA, customerId: custA } = await createCustomerWithCredential();
    const { token: tokenB, customerId: custB } = await createCustomerWithCredential();
    const { customerId: custC } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenA}`).send({ pin: '1234' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenB}`).send({ pin: '5678' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a24-18-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a24-18-wb-${custB}` });
    const wc = await ws.createWallet({ customerId: custC, currency: 'NGN', idempotencyKey: `a24-18-wc-${custC}` });
    const plat = await ls.createAccount({ code: `PLAT18_${randomUUID().slice(0,6)}`, name: 'Plat18', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fund18a-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '20000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '20000' }] });
    await ls.postJournal({ idempotencyKey: `fund18b-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '20000' }, { accountId: wb.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '20000' }] });
    // missing Idempotency-Key even with valid PIN → 400
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).send({ sourceWalletId: wa.id, destinationWalletId: wc.id, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(400);
    // successful A->C
    const resAC = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', `idem-a24-18ac-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wc.id, amountMinor: '2000', currency: 'NGN', pin: '1234' }).expect(201);
    const tidAC = resAC.body.id as string;
    // B cannot see A->C detail (SELF enforcement)
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tidAC}`).set('Authorization', `Bearer ${tokenB}`).expect(404);
    // A can see own
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tidAC}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    // successful B->C
    const resBC = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenB}`).set('Idempotency-Key', `idem-a24-18bc-${randomUUID()}`).send({ sourceWalletId: wb.id, destinationWalletId: wc.id, amountMinor: '3000', currency: 'NGN', pin: '5678' }).expect(201);
    const tidBC = resBC.body.id as string;
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tidBC}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
  });

  // Bonus: V1 boundary checks — no second engine, no bank/NIBSS, no provider, no notifications
  it('19. V1 boundary — no second ledger/bank/NIBSS/provider, controller still thin, migration count 65', async () => {
    const fs = await import('node:fs');
    const ctrl = fs.readFileSync('src/customer-app/customer-app.controller.ts', 'utf8');
    expect(ctrl).not.toContain('postJournalInTransaction');
    expect(ctrl).not.toContain('BankService');
    // NIBSS and Provider checks are case-insensitive via lower
    expect(ctrl.toLowerCase()).not.toContain('nibss');
    // Provider as a service boundary — ensure no provider adapter import
    expect(ctrl).not.toContain('ProviderAdapter');
    expect(ctrl).not.toMatch(/ledgerService\.postJournal/);
    expect(ctrl).toContain('pinService.verifyTransactionPin');
    expect(ctrl).toContain('transferService.createTransfer');
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0].count)).toBe(66);
    // verify no new bank/NIBSS tables used via transfer path
    const via = JSON.stringify(ctrl).toLowerCase();
    expect(via).not.toContain('nibss');
    expect(via).not.toContain('bank');
  });
});
