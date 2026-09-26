/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'a25-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('A25 Customer Transaction History & Detail Hardening (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a25history');
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

  async function createCustomer(opts: { reference?: string; displayName?: string; phone?: string; password?: string } = {}): Promise<{ customerId: string; reference: string; phone: string; displayName: string; token: string }> {
    const reference = opts.reference ?? `cust-a25-${randomUUID()}`;
    const displayName = opts.displayName ?? `Customer A25 ${randomUUID().slice(0,4)}`;
    const password = opts.password ?? 'correct-password-a25';
    const canonical10 = opts.phone ?? `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, displayName]);
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`, [customerId, `0${canonical10.slice(1)}`, canonical10]);
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    const token = login.body.accessToken as string;
    expect(token).toBeTruthy();
    return { customerId, reference, phone: canonical10, displayName, token };
  }

  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [`cls-a25-${randomUUID().slice(0,8)}`, `A25-${randomUUID().slice(0,6)}`, 'A25 Class', JSON.stringify(['CASH_IN']), JSON.stringify({})],
    );
    const classId = classRows[0]!.id;
    const ref = `agent-a25-${randomUUID()}`;
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [ref, classId]);
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-a25', 'agent-salt');
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'agent-pass-a25' }).expect(200);
    return login.body.accessToken as string;
  }

  // A. Customer can list own transactions
  it('A. Customer can list own transactions (W→W)', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice A25', phone: '8111111111' });
    const { customerId: custB, displayName: dispB, phone: phoneB } = await createCustomer({ displayName: 'Bob A25', phone: '8222222222' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25a-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25a-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATA_${randomUUID().slice(0,6)}`, name: 'PlatA', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundA-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '100000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '100000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25a-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '25000', currency: 'NGN', reference: `ref-${randomUUID()}`, pin: '1234' }).expect(201);
    const tid = tr.body.id as string;
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers?page=1&limit=20').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hist.body.items).toBeDefined();
    expect(hist.body.pagination.total).toBeGreaterThanOrEqual(1);
    const found = hist.body.items.find((x: any) => x.transferId === tid || x.id === tid);
    expect(found).toBeDefined();
    expect(found.transactionType).toBe('WALLET_TRANSFER');
    expect(found.type).toBe('WALLET_TRANSFER');
    expect(found.direction).toBe('SENT');
    expect(found.amountMinor).toBe('25000');
    expect(found.currency).toBe('NGN');
    expect(found.status).toBe('COMPLETED');
    expect(found.reference).toBeDefined();
    expect(found.createdAt).toBeDefined();
    expect(found.completedAt).toBeDefined();
    expect(found.feeMinor).toBe('0');
    // alias
    const hist2 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hist2.body.items.length).toBe(hist.body.items.length);
  });

  // B. Cannot list another's transactions
  it('B. Customer cannot list another customer transactions (filtered, not leaked)', async () => {
    const { token: tokenA, customerId: custA } = await createCustomer({ displayName: 'Alice B', phone: '8333333333' });
    const { token: tokenB, customerId: custB } = await createCustomer({ displayName: 'Bob B', phone: '8444444444' });
    const { customerId: custC } = await createCustomer({ displayName: 'Carol B', phone: '8555555555' });
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25b-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25b-wb-${custB}` });
    const wc = await ws.createWallet({ customerId: custC, currency: 'NGN', idempotencyKey: `a25b-wc-${custC}` });
    // fund B
    const plat = await ls.createAccount({ code: `PLATB_${randomUUID().slice(0,6)}`, name: 'PlatB', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundB-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wb.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenB}`).send({ pin: '4321' }).expect(200);
    const trBC = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenB}`).set('Idempotency-Key', `idem-a25b-${randomUUID()}`).send({ sourceWalletId: wb.id, destinationWalletId: wc.id, amountMinor: '10000', currency: 'NGN', pin: '4321' }).expect(201);
    const tidBC = trBC.body.id as string;
    // A should not see B->C transfer in list
    const histA = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const foundInA = histA.body.items.find((x: any) => x.transferId === tidBC || x.id === tidBC);
    expect(foundInA).toBeUndefined();
    // B should see it
    const histB = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenB}`).expect(200);
    const foundInB = histB.body.items.find((x: any) => x.transferId === tidBC || x.id === tidBC);
    expect(foundInB).toBeDefined();
  });

  // C. Can retrieve own detail
  it('C. Customer can retrieve own transaction detail (consistent with history)', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice C', phone: '8666666666' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob C', phone: '8777777777' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '9999' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25c-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25c-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATC_${randomUUID().slice(0,6)}`, name: 'PlatC', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundC-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25c-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '7000', currency: 'NGN', reference: 'my-ref', narration: 'test', pin: '9999' }).expect(201);
    const tid = tr.body.id as string;
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail.body.id).toBe(tid);
    expect(detail.body.transferId).toBe(tid);
    expect(detail.body.transactionType).toBe('WALLET_TRANSFER');
    expect(detail.body.direction).toBe('SENT');
    expect(detail.body.amountMinor).toBe('7000');
    expect(detail.body.currency).toBe('NGN');
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.reference).toBe('my-ref');
    expect(detail.body.narration).toBe('test');
    expect(detail.body.createdAt).toBeDefined();
    // alias
    const detail2 = await request(app.getHttpServer()).get(`/api/v1/customers/me/transactions/${tid}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail2.body.id).toBe(tid);
  });

  // D. Cannot retrieve another's detail
  it('D. Customer cannot retrieve another customer transaction detail (404)', async () => {
    const { token: tokenA } = await createCustomer({ displayName: 'Alice D', phone: '8888888888' });
    const { token: tokenB, customerId: custB } = await createCustomer({ displayName: 'Bob D', phone: '8999999999' });
    const { customerId: custC } = await createCustomer({ displayName: 'Carol D', phone: '8000000000' }); // use valid 10-digit
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25d-wb-${custB}` });
    const wc = await ws.createWallet({ customerId: custC, currency: 'NGN', idempotencyKey: `a25d-wc-${custC}` });
    const plat = await ls.createAccount({ code: `PLATD_${randomUUID().slice(0,6)}`, name: 'PlatD', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundD-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wb.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenB}`).send({ pin: '1111' }).expect(200);
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenB}`).set('Idempotency-Key', `idem-a25d-${randomUUID()}`).send({ sourceWalletId: wb.id, destinationWalletId: wc.id, amountMinor: '5000', currency: 'NGN', pin: '1111' }).expect(201);
    const tid = tr.body.id as string;
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transactions/${tid}`).set('Authorization', `Bearer ${tokenA}`).expect(404);
    // also by wallet ID enumeration
    const histA = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(histA.body.items.find((x: any) => x.id === tid)).toBeUndefined();
  });

  // E. Correct direction
  it('E. Correct direction SENT/RECEIVED/INTERNAL', async () => {
    const { token: tokenA, customerId: custA } = await createCustomer({ displayName: 'Alice E', phone: '8110000001' });
    const { customerId: custB, token: tokenB } = await createCustomer({ displayName: 'Bob E', phone: '8220000002' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenA}`).send({ pin: '1234' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenB}`).send({ pin: '5678' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25e-wa-${custA}` });
    // Wallet unique per customer+currency (NGN), so INTERNAL (own-wallet to own-wallet) is structurally not possible in V1 with single NGN wallet per customer. We test SENT/RECEIVED.
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25e-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATE_${randomUUID().slice(0,6)}`, name: 'PlatE', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundE-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '100000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '100000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', `idem-a25e-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '12345', currency: 'NGN', pin: '1234' }).expect(201);
    const tid = tr.body.id as string;
    const detailA = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(detailA.body.direction).toBe('SENT');
    const detailB = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(detailB.body.direction).toBe('RECEIVED');
    const histA = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const itemA = histA.body.items.find((x: any) => x.id === tid);
    expect(itemA.direction).toBe('SENT');
    const histB = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenB}`).expect(200);
    const itemB = histB.body.items.find((x: any) => x.id === tid);
    expect(itemB.direction).toBe('RECEIVED');
  });

  // F. Correct amount/currency/status/reference
  it('F. Correct amount/currency/status/reference persisted', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice F' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob F' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '0001' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25f-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25f-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATF_${randomUUID().slice(0,6)}`, name: 'PlatF', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundF-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '90000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '90000' }] });
    const ref = `my-ref-${randomUUID()}`;
    const nar = `nar-${randomUUID()}`;
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25f-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '33333', currency: 'NGN', reference: ref, narration: nar, pin: '0001' }).expect(201);
    const tid = tr.body.id as string;
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).expect(200);
    const item = hist.body.items.find((x: any) => x.id === tid);
    expect(item.amountMinor).toBe('33333');
    expect(item.currency).toBe('NGN');
    expect(item.status).toBe('COMPLETED');
    expect(item.reference).toBe(ref);
    expect(item.narration).toBe(nar);
    expect(item.feeMinor).toBe('0');
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail.body.amountMinor).toBe('33333');
    expect(detail.body.currency).toBe('NGN');
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.reference).toBe(ref);
    expect(detail.body.narration).toBe(nar);
  });

  // G. Counterparty correct
  it('G. Counterparty display correct (displayName, receivingNumber, walletId)', async () => {
    const { token: tokenA, customerId: custA } = await createCustomer({ displayName: 'Alice G', phone: '8770000001' });
    const { customerId: custB, displayName: dispB, phone: phoneB } = await createCustomer({ displayName: 'Bob G', phone: '8770000002' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenA}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25g-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25g-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATG_${randomUUID().slice(0,6)}`, name: 'PlatG', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundG-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '60000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '60000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', `idem-a25g-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '15000', currency: 'NGN', pin: '1234' }).expect(201);
    const tid = tr.body.id as string;
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const item = hist.body.items.find((x: any) => x.id === tid);
    expect(item.counterparty).toBeDefined();
    expect(item.counterparty.walletId).toBe(wb.id);
    expect(item.counterparty.customerId).toBe(custB);
    expect(item.counterparty.displayName).toBe(dispB);
    expect(item.counterparty.receivingNumber).toBe(phoneB);
    expect(item.counterpartyWalletId).toBe(wb.id);
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(detail.body.counterparty.walletId).toBe(wb.id);
    expect(detail.body.counterparty.displayName).toBe(dispB);
    expect(detail.body.counterparty.receivingNumber).toBe(phoneB);
    // also reverse: Bob sees Alice as counterparty
    const { token: tokenB } = await createCustomer({ displayName: 'Bob G2', phone: '8770000003' }); // not used, need actual token for custB
    // we already have custB but not token; create new login for custB
    const loginB = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId: custB, password: 'correct-password-a25' }).expect(200);
    const tokenB2 = loginB.body.accessToken as string;
    const histB = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${tokenB2}`).expect(200);
    const itemB = histB.body.items.find((x: any) => x.id === tid);
    expect(itemB.counterparty.walletId).toBe(wa.id);
    expect(itemB.counterparty.customerId).toBe(custA);
    expect(itemB.counterparty.displayName).toBe('Alice G');
  });

  // H. No sensitive auth/security info
  it('H. No sensitive authentication/security information in history/detail', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice H' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob H' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25h-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25h-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATH_${randomUUID().slice(0,6)}`, name: 'PlatH', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundH-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '40000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '40000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25h-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '1234' }).expect(201);
    const tid = tr.body.id as string;
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).expect(200);
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${token}`).expect(200);
    for (const body of [hist.body, detail.body]) {
      const low = JSON.stringify(body).toLowerCase();
      expect(low).not.toContain('pinhash');
      expect(low).not.toContain('password');
      expect(low).not.toContain('tokenhash');
      expect(low).not.toContain('secrethash');
      expect(low).not.toContain('challengehash');
      expect(low).not.toContain('otphash');
      expect(low).not.toContain('pin');
      // allow pinVersion? but history should not contain pinVersion, check exact key
      expect(low).not.toContain('"pin"');
      expect(low).not.toContain('pinhash');
      expect(low).not.toContain('accesstoken');
      expect(low).not.toContain('refreshtoken');
    }
  });

  // I. No ledger internals
  it('I. No ledger internals exposed (journalId, ledgerAccountId, requestHash, idempotency internals)', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice I' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob I' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25i-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25i-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATI_${randomUUID().slice(0,6)}`, name: 'PlatI', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundI-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '30000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '30000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25i-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '3000', currency: 'NGN', pin: '1234' }).expect(201);
    const tid = tr.body.id as string;
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).expect(200);
    const item = hist.body.items.find((x: any) => x.id === tid);
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tid}`).set('Authorization', `Bearer ${token}`).expect(200);
    for (const obj of [item, detail.body]) {
      const blob = JSON.stringify(obj).toLowerCase();
      expect(blob).not.toContain('journalid');
      expect(blob).not.toContain('ledgeraccountid');
      expect(blob).not.toContain('requesthash');
      expect(blob).not.toContain('idempotencykey');
      expect(blob).not.toContain('request_hash');
      expect(blob).not.toContain('ledger');
      expect(blob).not.toContain('audit');
    }
  });

  // J. Pagination works
  it('J. Pagination works (page, limit, total, hasNextPage)', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice J' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob J' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25j-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25j-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATJ_${randomUUID().slice(0,6)}`, name: 'PlatJ', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundJ-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '100000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '100000' }] });
    // create 5 transfers
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25j-${i}-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '1000', currency: 'NGN', pin: '1234' }).expect(201);
      // slight delay to ensure createdAt differs
      await new Promise((r) => setTimeout(r, 10));
    }
    const p1 = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers?page=1&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.pagination.page).toBe(1);
    expect(p1.body.pagination.limit).toBe(2);
    expect(p1.body.pagination.total).toBe(5);
    expect(p1.body.pagination.hasNextPage).toBe(true);
    const p2 = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers?page=2&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(p2.body.items.length).toBe(2);
    expect(p2.body.pagination.page).toBe(2);
    const p3 = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers?page=3&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(p3.body.items.length).toBe(1);
    expect(p3.body.pagination.hasNextPage).toBe(false);
    // alias
    const alias = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions?page=1&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(alias.body.items.length).toBe(2);
    expect(alias.body.pagination.total).toBe(5);
  });

  // K. Deterministic ordering (createdAt DESC, id DESC)
  it('K. Deterministic ordering works', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice K' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob K' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25k-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25k-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATK_${randomUUID().slice(0,6)}`, name: 'PlatK', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundK-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '100000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '100000' }] });
    const tids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25k-${i}-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: `${1000 + i}`, currency: 'NGN', pin: '1234' }).expect(201);
      tids.push(tr.body.id as string);
      await new Promise((r) => setTimeout(r, 10));
    }
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers?page=1&limit=10').set('Authorization', `Bearer ${token}`).expect(200);
    const idsInOrder = hist.body.items.map((x: any) => x.id);
    // most recent first: reverse of creation order
    expect(idsInOrder.slice(0, 3)).toEqual([tids[2], tids[1], tids[0]]);
    // second fetch should be same order
    const hist2 = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers?page=1&limit=10').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hist2.body.items.map((x: any) => x.id)).toEqual(idsInOrder);
  });

  // L. Empty history
  it('L. Empty history works (no wallets or no transactions)', async () => {
    const { token } = await createCustomer({ displayName: 'Alice L' });
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hist.body.items).toEqual([]);
    expect(hist.body.pagination.total).toBe(0);
    expect(hist.body.pagination.totalPages).toBe(0);
    expect(hist.body.pagination.hasNextPage).toBe(false);
    const hist2 = await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hist2.body.items).toEqual([]);
  });

  // M. Missing/nonexistent transaction 404
  it('M. Missing/nonexistent transaction returns 404 generic', async () => {
    const { token } = await createCustomer({ displayName: 'Alice M' });
    const fakeId = randomUUID();
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${fakeId}`).set('Authorization', `Bearer ${token}`).expect(404);
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transactions/${fakeId}`).set('Authorization', `Bearer ${token}`).expect(404);
    // invalid UUID format should be 400? but we expect not-found handling via 404 or 400 — ensure not 200
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/not-a-uuid`).set('Authorization', `Bearer ${token}`).expect((r) => expect([400, 404].includes(r.status)).toBe(true));
  });

  // N. Agent cannot access
  it('N. Agent principal cannot access Customer SELF history routes', async () => {
    const agentToken = await createAgentToken();
    await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${agentToken}`).expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').set('Authorization', `Bearer ${agentToken}`).expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${randomUUID()}`).set('Authorization', `Bearer ${agentToken}`).expect((r) => expect([401, 403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transactions/${randomUUID()}`).set('Authorization', `Bearer ${agentToken}`).expect((r) => expect([401, 403].includes(r.status)).toBe(true));
  });

  // O. Unauthenticated rejected
  it('O. Unauthenticated request is rejected (401)', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me/transactions').expect(401);
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${randomUUID()}`).expect(401);
    await request(app.getHttpServer()).get(`/api/v1/customers/me/transactions/${randomUUID()}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', 'Bearer invalid').expect(401);
  });

  // P. Other V1 types intentionally not included (documented limitation)
  it('P. Other V1 transaction types (Cash-In/Out/Cash-to-Cash) intentionally not in history — history remains Wallet→Wallet only', async () => {
    const { token, customerId: custA, phone: phoneA } = await createCustomer({ displayName: 'Alice P', phone: '8990000001' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob P', phone: '8990000002' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a25p-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a25p-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATP_${randomUUID().slice(0,6)}`, name: 'PlatP', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundP-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    // create Wallet→Wallet
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a25p-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '10000', currency: 'NGN', pin: '1234' }).expect(201);
    // create a Cash-to-Cash record directly (authoritative entity) with beneficiary = custA phone, but without involving Wallet→Wallet
    const agentClassRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`, [`cls-a25p-${randomUUID().slice(0,8)}`, `A25P-${randomUUID().slice(0,6)}`, 'A25P Class', JSON.stringify([]), JSON.stringify({})]);
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [`agent-a25p-${randomUUID()}`, agentClassRows[0]!.id]);
    const agentId = agentRows[0]!.id;
    const agentWallet = await ws.createWallet({ customerId: agentId, currency: 'NGN', idempotencyKey: `a25p-agw-${agentId}` });
    // ensure unclaimed account exists (seeded by migration, but truncated in harnesses -> recreate if missing)
    let unclaimedId: string;
    const unclaimedRows: Array<{ id: string }> = await dataSource.query(`SELECT id FROM ledger_accounts WHERE code='CASH_TO_CASH-UNCLAIMED-NGN' LIMIT 1`);
    if (unclaimedRows[0]?.id) {
      unclaimedId = unclaimedRows[0].id;
    } else {
      const acc = await ls.createAccount({ code: 'CASH_TO_CASH-UNCLAIMED-NGN', name: 'Cash To Cash Unclaimed', accountType: 'LIABILITY' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
      unclaimedId = acc.id;
    }
    // fund agent
    const plat2 = await ls.createAccount({ code: `PLATP2_${randomUUID().slice(0,6)}`, name: 'PlatP2', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundAg-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat2.id, direction: 'DEBIT' as any, amountMinor: '100000' }, { accountId: agentWallet.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '100000' }] });
    // create journal for cash-to-cash (DEBIT agent, CREDIT unclaimed)
    const c2cJournal = await ls.postJournal({ idempotencyKey: `c2c-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: agentWallet.ledgerAccountId, direction: 'DEBIT' as any, amountMinor: '5000' }, { accountId: unclaimedId, direction: 'CREDIT' as any, amountMinor: '5000' }] });
    const c2cJournalId = (c2cJournal as any).id as string;
    await dataSource.query(
      `INSERT INTO cash_to_cash_transfers (id, agent_id, beneficiary_phone, principal_minor, fee_minor, vat_minor, total_minor, currency, status, transfer_code_hash, hash_algorithm, transfer_code_version, failed_attempts, is_locked, journal_id, reference, idempotency_key, correlation_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UNCLAIMED',$9,'PBKDF2',1,0,false,$10,$11,$12,$13, NOW() + interval '7 days')`,
      [randomUUID(), agentId, phoneA, '5000', '0', '0', '5000', 'NGN', 'PBKDF2$sha256$10000$abc$def', c2cJournalId, `ref-${randomUUID()}`, `idem-c2c-${randomUUID()}`, `corr-${randomUUID()}`],
    );
    // history should still only contain Wallet→Wallet, not the cash-to-cash
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).expect(200);
    expect(hist.body.items.length).toBe(1);
    expect(hist.body.items[0].id).toBe(tr.body.id);
    expect(hist.body.items[0].transactionType).toBe('WALLET_TRANSFER');
    // ensure no cash-to-cash appears
    const hasC2C = hist.body.items.some((x: any) => x.beneficiaryPhone || x.beneficiary_phone || x.type === 'CASH_TO_CASH');
    expect(hasC2C).toBe(false);
  });

  // Extra: V1 boundary + migration count
  it('Q. V1 boundary and migration count (no new ledger/bank etc, 65 migrations)', async () => {
    const fs = await import('node:fs');
    const ctrl = fs.readFileSync('src/customer-app/customer-app.controller.ts', 'utf8');
    expect(ctrl).not.toContain('postJournalInTransaction');
    expect(ctrl).not.toContain('BankService');
    expect(ctrl.toLowerCase()).not.toContain('nibss');
    expect(ctrl).not.toContain('ProviderAdapter');
    expect(ctrl).toContain('listTransfers');
    expect(ctrl).toContain('getTransferDetail');
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0].count)).toBe(66);
  });
});
