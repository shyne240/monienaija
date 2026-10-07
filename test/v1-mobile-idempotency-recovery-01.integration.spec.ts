/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { createIntegrationDataSource, destroyIntegrationDataSource, truncateAllTables } from './support/pg-harness';

/**
 * V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01 — PART 3 reproduction.
 *
 * Simulates, against real PostgreSQL, the exact ambiguous-timeout scenario described in the
 * task: request K1 reaches the backend and commits successfully, but the client never receives
 * the response (a true network-level ambiguous outcome — the test cannot literally drop a TCP
 * packet, so it reproduces the OBSERVABLE, decision-relevant fact instead: a transfer that has
 * already durably committed under key K1, with the client now choosing how to retry).
 *
 * The two client choices and their backend outcomes:
 *   A. Retry with the ORIGINAL key K1 (what the client SHOULD do when the outcome is unknown) —
 *      must be exactly-once/replay-safe: same transfer id returned, no new ledger effect.
 *   B. Retry with a FRESH key K2 (what the pre-fix mobile SendMoneyScreen used to do
 *      unconditionally after ANY error, including this exact ambiguous case) — the backend
 *      correctly has no way to know K2 is "the same logical operation" as K1, and legitimately
 *      creates a second, fully separate transfer and a second real debit.
 *
 * This is not a backend defect — the backend behaves exactly as an idempotency boundary should.
 * It is the evidence for why the CLIENT must not discard key K1 and mint K2 after an ambiguous
 * outcome; see apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx and
 * docs/V1/V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01.md.
 */
describe('V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01 — ambiguous-timeout retry: same key (A) vs new key (B)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  function encodePbkdf2(password: string, saltStr: string): string {
    const salt = Buffer.from(saltStr);
    const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
    return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('mobileidemrecovery');
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

  async function createCustomerWithPin(label: string): Promise<{ customerId: string; token: string }> {
    const reference = `cust-mir-${label}-${randomUUID()}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, `Customer ${label}`]);
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`,
      [customerId, `0${canonical10.slice(1)}`, canonical10],
    );
    const password = 'mir-password-1!';
    const hash = encodePbkdf2(password, `mir-salt-${label}`);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    const token = login.body.accessToken as string;
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);
    return { customerId, token };
  }

  async function fundWallet(ledgerAccountId: string, amountMinor: string): Promise<void> {
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const ls = app.get(LedgerService);
    const plat = await ls.createAccount({
      code: `MIR_PLAT_${randomUUID().slice(0, 8)}`,
      name: 'MIR Platform',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS' as any,
    });
    await ls.postJournal({
      idempotencyKey: `mir-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS' as any,
      reference: `mir-fund-ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor },
        { accountId: ledgerAccountId, direction: 'CREDIT' as any, amountMinor },
      ],
    });
  }

  it('A. retry with the ORIGINAL key K1 after it already committed is exactly-once/replay-safe (no second debit)', async () => {
    const { WalletService } = await import('../src/wallet/wallet.service');
    const ws = app.get(WalletService);

    const customer = await createCustomerWithPin('a-retry');
    const recipient = await createCustomerWithPin('a-recipient');
    const sourceWallet = await ws.createWallet({ customerId: customer.customerId, currency: 'NGN', idempotencyKey: `mir-a-src-${customer.customerId}` });
    const destWallet = await ws.createWallet({ customerId: recipient.customerId, currency: 'NGN', idempotencyKey: `mir-a-dst-${recipient.customerId}` });
    await fundWallet(sourceWallet.ledgerAccountId, '1000000');

    const k1 = `mir-k1-${randomUUID()}`;
    const body = {
      sourceWalletId: sourceWallet.id,
      destinationWalletId: destWallet.id,
      amountMinor: '500000',
      currency: 'NGN',
      narration: 'Lunch money',
      pin: '1234',
    };

    // K1 reaches the backend and commits successfully (the "client never saw the response" part
    // of the scenario is, by definition, unobservable server-side — what matters is what the
    // client does NEXT, which this test controls directly).
    const first = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', k1)
      .send(body)
      .expect(201);
    const transferId = first.body.id as string;

    // The client, having correctly preserved K1 across the ambiguous outcome (this is what the
    // V1-MOBILE-IDEMPOTENCY-RECOVERY-01 fix in SendMoneyScreen now does), retries with K1.
    const retryWithK1 = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', k1)
      .send(body)
      .expect(201);

    // PROOF (A): same transfer, not a new one.
    expect(retryWithK1.body.id).toBe(transferId);

    const sourceBalance = await ws.getWalletBalance(sourceWallet.id);
    const destBalance = await ws.getWalletBalance(destWallet.id);
    expect(sourceBalance.balanceMinor).toBe('500000'); // 1,000,000 - 500,000 ONCE only
    expect(destBalance.balanceMinor).toBe('500000');

    const transferRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM transfers WHERE source_wallet_id = $1 AND destination_wallet_id = $2`,
      [sourceWallet.id, destWallet.id],
    );
    expect(transferRows).toHaveLength(1);
  });

  it('B. retry with a FRESH key K2 after K1 already committed legitimately creates a SECOND, separate transfer and a second real debit', async () => {
    const { WalletService } = await import('../src/wallet/wallet.service');
    const ws = app.get(WalletService);

    const customer = await createCustomerWithPin('b-retry');
    const recipient = await createCustomerWithPin('b-recipient');
    const sourceWallet = await ws.createWallet({ customerId: customer.customerId, currency: 'NGN', idempotencyKey: `mir-b-src-${customer.customerId}` });
    const destWallet = await ws.createWallet({ customerId: recipient.customerId, currency: 'NGN', idempotencyKey: `mir-b-dst-${recipient.customerId}` });
    await fundWallet(sourceWallet.ledgerAccountId, '1000000');

    const k1 = `mir-k1-${randomUUID()}`;
    const bodyForK1 = {
      sourceWalletId: sourceWallet.id,
      destinationWalletId: destWallet.id,
      amountMinor: '500000',
      currency: 'NGN',
      narration: 'Lunch money',
      pin: '1234',
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', k1)
      .send(bodyForK1)
      .expect(201);
    const firstTransferId = first.body.id as string;

    // The PRE-FIX client behavior: treats the ambiguous outcome as a definitive failure and
    // mints a brand-new Idempotency-Key K2 for what the customer still believes is "retrying
    // the same transfer". The PIN must be re-entered (it is always cleared after any attempt),
    // exactly as the real SendMoneyScreen requires.
    const k2 = `mir-k2-${randomUUID()}`;
    const retryWithK2 = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customer.token}`)
      .set('Idempotency-Key', k2)
      .send({ ...bodyForK1, pin: '1234' })
      .expect(201);

    // PROOF (B): the backend has no way to know this is "the same" transfer — it is a genuinely
    // new, separate, fully-posted transfer with its own id.
    expect(retryWithK2.body.id).not.toBe(firstTransferId);

    const sourceBalance = await ws.getWalletBalance(sourceWallet.id);
    const destBalance = await ws.getWalletBalance(destWallet.id);
    // TWO real debits — this is the exact duplicate-financial-transfer risk the audit confirms:
    // not a backend defect, but the direct, demonstrated consequence of a client abandoning K1.
    expect(sourceBalance.balanceMinor).toBe('0'); // 1,000,000 - 500,000 - 500,000
    expect(destBalance.balanceMinor).toBe('1000000');

    const transferRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM transfers WHERE source_wallet_id = $1 AND destination_wallet_id = $2 ORDER BY created_at ASC`,
      [sourceWallet.id, destWallet.id],
    );
    expect(transferRows).toHaveLength(2);
    expect(transferRows.map((r) => r.id).sort()).toEqual([firstTransferId, retryWithK2.body.id].sort());
  });
});
