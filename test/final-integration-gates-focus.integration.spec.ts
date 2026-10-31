/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * FINAL INTEGRATION GATES — focused real-HTTP checks (real PostgreSQL, real AppModule).
 *
 * Purpose: a single, short, high-signal proof of the release-gate behaviours that the
 * integration ships, exercised over real HTTP against the real Fastify application:
 *
 *   1. Customer login (`POST /api/v1/customers/sessions`).
 *   2. Global API prefix behaviour — the canonical `/api/v1/...` path resolves and the
 *      un-prefixed path does not; the customer-mobile client normalizes both bare-origin and
 *      pre-prefixed base URLs onto that same canonical path (see the mobile unit suite).
 *   3. Bodyless logout (`POST /api/v1/customers/sessions/logout` with no body and no
 *      Content-Type) succeeding — the Fastify "empty JSON body" trap the mobile fix avoids —
 *      while the same request *with* `Content-Type: application/json` and an empty body is
 *      rejected by the framework, documenting why the client must omit the header.
 *   4. Session expiry: the revoked bearer token is rejected afterwards.
 *   5. Wrong transaction PIN returns 401 while leaving the bearer session valid and creating
 *      no transfer, no ledger journal and no balance change.
 *   6. Source-wallet ownership: a customer cannot debit another customer's wallet (404, no
 *      mutation), while the legitimate owner can.
 *
 * No financial rule is asserted beyond "unchanged": amounts, fees and posting come from the
 * existing services, and the checks compare balances/ledger counts before and after.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'final-gates-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('Final integration gates — focused real-HTTP checks (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('finalgates');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createCustomer(
    label: string,
    password = 'correct-password-gates',
  ): Promise<{ customerId: string; token: string }> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-gates-${label}-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, `Gates ${label}`],
    );
    const phone = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary)
       VALUES ($1,'PHONE',$2,$3,true)`,
      [customerId, `0${phone.slice(1)}`, phone],
    );
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
         (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, encodePbkdf2(password)],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    return { customerId, token: login.body.accessToken as string };
  }

  async function createWallet(customerId: string): Promise<any> {
    const { WalletService } = await import('../src/wallet/wallet.service');
    return app.get(WalletService).createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `gates-wallet-${customerId}`,
    });
  }

  async function fundWallet(customerId: string, amountMinor = '50000'): Promise<any> {
    const { LedgerService } = await import('../src/ledger/ledger.service');
    const ledger = app.get(LedgerService);
    const wallet = await createWallet(customerId);
    const platform = await ledger.createAccount({
      code: `PLAT_${randomUUID().slice(0, 6)}`,
      name: 'Gates Platform',
      accountType: 'ASSET' as any,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    await ledger.postJournal({
      idempotencyKey: `gates-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `gates-ref-${randomUUID()}`,
      lines: [
        { accountId: platform.id, direction: 'DEBIT' as any, amountMinor },
        { accountId: wallet.ledgerAccountId, direction: 'CREDIT' as any, amountMinor },
      ],
    });
    return wallet;
  }

  it('1. customer login succeeds and yields a bearer session', async () => {
    const { token } = await createCustomer('login');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    const me = await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.id).toBeDefined();
  });

  it('2. the global /api/v1 prefix is required and the un-prefixed path does not resolve', async () => {
    const { token } = await createCustomer('prefix');
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Without the global prefix the route does not exist.
    const unprefixed = await request(app.getHttpServer())
      .get('/customers/me')
      .set('Authorization', `Bearer ${token}`);
    expect(unprefixed.status).toBe(404);
    // A doubled prefix is also not a valid route (what a naive client would produce).
    const doubled = await request(app.getHttpServer())
      .get('/api/v1/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`);
    expect(doubled.status).toBe(404);
  });

  it('3. bodyless logout succeeds, and the empty-JSON variant documents why the client omits Content-Type', async () => {
    const { token } = await createCustomer('logout');

    // (a) The mobile client's shape: POST with NO body and NO Content-Type header.
    const bodyless = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(bodyless.body).toMatchObject({ revoked: true });

    // (b) The trap the fix avoids: declaring JSON with an empty body is rejected by Fastify
    // before the handler runs. Asserting it here keeps the reason for the client behaviour
    // explicit rather than folklore.
    const { token: secondToken } = await createCustomer('logout-empty-json');
    const emptyJson = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions/logout')
      .set('Authorization', `Bearer ${secondToken}`)
      .set('Content-Type', 'application/json')
      .send();
    expect(emptyJson.status).toBe(400);
  });

  it('4. a revoked session is rejected afterwards (expiry/revocation path)', async () => {
    const { token } = await createCustomer('expiry');
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/customers/sessions/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // The same bearer token is no longer accepted.
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('5. a wrong transaction PIN returns 401, keeps the session valid and mutates nothing', async () => {
    const { customerId, token } = await createCustomer('wrong-pin');
    const { customerId: receiverId } = await createCustomer('wrong-pin-receiver');
    const source = await fundWallet(customerId);
    const destination = await createWallet(receiverId);

    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transaction-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '1234' })
      .expect(200);

    const transfersBefore = await dataSource.query(`SELECT count(*)::text AS c FROM transfers`);
    const journalsBefore = await dataSource.query(`SELECT count(*)::text AS c FROM ledger_journals`);

    const wrongPin = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `gates-wrong-pin-${randomUUID()}`)
      .send({
        sourceWalletId: source.id,
        destinationWalletId: destination.id,
        amountMinor: '1000',
        currency: 'NGN',
        pin: '9999',
      })
      .expect(401);
    expect(String(wrongPin.body.message)).toContain('Invalid PIN');

    // The bearer session survives the step-up failure (this is the mobile 401 bug).
    await request(app.getHttpServer())
      .get('/api/v1/customers/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // No money moved: no transfer row and no new journal, balance unchanged.
    const transfersAfter = await dataSource.query(`SELECT count(*)::text AS c FROM transfers`);
    const journalsAfter = await dataSource.query(`SELECT count(*)::text AS c FROM ledger_journals`);
    expect(transfersAfter[0].c).toBe(transfersBefore[0].c);
    expect(journalsAfter[0].c).toBe(journalsBefore[0].c);

    const { WalletService } = await import('../src/wallet/wallet.service');
    const balance = await app.get(WalletService).getWalletBalance(source.id);
    expect(balance.balanceMinor).toBe('50000');
  });

  it('6. source-wallet ownership blocks cross-customer debits while the owner still succeeds', async () => {
    const customerA = await createCustomer('owner-a');
    const customerB = await createCustomer('owner-b');
    const walletA = await fundWallet(customerA.customerId);
    // B's wallet exists but holds nothing: the ownership denial must not depend on balance.
    const walletB = await createWallet(customerB.customerId);

    for (const customer of [customerA, customerB]) {
      await request(app.getHttpServer())
        .post('/api/v1/customers/me/transaction-pin')
        .set('Authorization', `Bearer ${customer.token}`)
        .send({ pin: '1234' })
        .expect(200);
    }

    const transfersBefore = await dataSource.query(`SELECT count(*)::text AS c FROM transfers`);

    // B may not debit A's wallet, even with B's valid PIN.
    await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customerB.token}`)
      .set('Idempotency-Key', `gates-foreign-${randomUUID()}`)
      .send({
        sourceWalletId: walletA.id,
        destinationWalletId: walletB.id,
        amountMinor: '1000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(404);

    const transfersAfterDenial = await dataSource.query(`SELECT count(*)::text AS c FROM transfers`);
    expect(transfersAfterDenial[0].c).toBe(transfersBefore[0].c);

    // The legitimate owner still transfers from that same wallet.
    const ok = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${customerA.token}`)
      .set('Idempotency-Key', `gates-own-${randomUUID()}`)
      .send({
        sourceWalletId: walletA.id,
        destinationWalletId: walletB.id,
        amountMinor: '10000',
        currency: 'NGN',
        pin: '1234',
      })
      .expect(201);
    expect(ok.body.id).toBeDefined();

    const { WalletService } = await import('../src/wallet/wallet.service');
    const service = app.get(WalletService);
    expect((await service.getWalletBalance(walletA.id)).balanceMinor).toBe('40000');
    expect((await service.getWalletBalance(walletB.id)).balanceMinor).toBe('10000');
  });
});
