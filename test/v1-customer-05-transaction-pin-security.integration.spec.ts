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

function encodePbkdf2(password: string, saltStr = 'v1c05-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * V1-CUSTOMER-05 — Secure Customer Transaction PIN change/reset.
 *
 * P0 fix under test: `POST customers/me/transaction-pin` used to let an
 * authenticated customer unconditionally overwrite an existing Transaction
 * PIN with no proof of knowledge of the old PIN. The PIN authorizes
 * Wallet→Wallet transfers (see a24 suite), so this was a financial
 * authorization bypass via a hijacked/stolen bearer token.
 *
 * Fixed contract:
 *  - POST customers/me/transaction-pin         → CREATE-ONLY (409 if one exists)
 *  - POST customers/me/transaction-pin/change  → requires {currentPin,newPin},
 *    verifies currentPin via the existing verify/lockout path (same
 *    MAX_FAILED_PINS=5 counter as Wallet→Wallet authorization)
 *  - GET  customers/me/transaction-pin         → status (NOT_SET/ACTIVE/LOCKED)
 *  - Locked PIN cannot be changed (no in-app recovery bypass — V1 has no
 *    secure out-of-band recovery channel; customer must contact support)
 */
describe('V1-CUSTOMER-05 Customer Transaction PIN security (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1c05pin');
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

  async function createCustomerWithCredential(opts: { reference?: string; password?: string } = {}): Promise<{ customerId: string; token: string }> {
    const reference = opts.reference ?? `cust-v1c05-${randomUUID()}`;
    const password = opts.password ?? 'correct-password-v1c05';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'Customer V1C05']);
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
    return { customerId, token };
  }

  async function fundAndWire(custA: string, custB: string, amountMinor: string) {
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS);
    const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `v1c05-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `v1c05-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATC05_${randomUUID().slice(0, 6)}`, name: 'PlatC05', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({
      idempotencyKey: `fundc05-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `ref-${randomUUID()}`,
      lines: [
        { accountId: plat.id, direction: 'DEBIT' as any, amountMinor },
        { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor },
      ],
    });
    return { ws, wa, wb };
  }

  // 1. First-time creation succeeds
  it('1. First-time creation — POST transaction-pin succeeds for a customer with no PIN', async () => {
    const { token } = await createCustomerWithCredential();
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    expect(res.body.pinVersion).toBe(1);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('pinhash');
  });

  // 2. Root fix — create endpoint can no longer overwrite an existing PIN
  it('2. Create-only — second POST transaction-pin for same customer is rejected (409), old PIN survives', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const conflict = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '9999' }).expect(409);
    expect(conflict.body.message).toMatch(/already exists/i);
    // original PIN 1234 must still verify (not silently overwritten)
    const verify = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    expect(verify.body.verified).toBe(true);
  });

  // 3. Known-PIN change succeeds with correct old PIN
  it('3. Known-PIN change — succeeds with correct currentPin, pinVersion increments', async () => {
    const { token } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '5678' }).expect(200);
    expect(res.body.pinVersion).toBe(2);
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain('pinhash');
    expect(JSON.stringify(res.body)).not.toContain('5678');
    const verifyNew = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '5678' }).expect(200);
    expect(verifyNew.body.verified).toBe(true);
  });

  // 4. Known-PIN change fails with incorrect old PIN; original PIN unchanged
  it('4. Known-PIN change — fails with incorrect currentPin (401), original PIN remains usable', async () => {
    const { token } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '0000', newPin: '5678' }).expect(401);
    expect(res.body.message).toMatch(/incorrect/i);
    // original PIN still verifies — failed change did not replace it
    const verifyOld = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    expect(verifyOld.body.verified).toBe(true);
    // new pin must NOT be usable
    const verifyNew = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '5678' }).expect(200);
    expect(verifyNew.body.verified).toBe(false);
  });

  // 5. Incorrect old PIN during change increments the same security counter used by W2W
  it('5. Known-PIN change — incorrect currentPin increments failed_count (shared counter with W2W authorization)', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '0000', newPin: '5678' }).expect(401);
    const rows: Array<{ failed_count: number }> = await dataSource.query(`SELECT failed_count FROM customer_transaction_pins WHERE customer_id=$1`, [customerId]);
    expect(Number(rows[0].failed_count)).toBe(1);
  });

  // 6. Locked PIN cannot be bypassed via change — 5 wrong change attempts lock it, then even correct-looking attempts are rejected
  it('6. Locked PIN — 5 failed change attempts lock the PIN; change is then rejected outright, no bypass', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '0000', newPin: '5678' }).expect(401);
    }
    const rows: Array<{ account_locked: boolean }> = await dataSource.query(`SELECT account_locked FROM customer_transaction_pins WHERE customer_id=$1`, [customerId]);
    expect(rows[0].account_locked).toBe(true);
    // Even presenting the CORRECT current PIN after lockout must be rejected — cannot bypass lockout via change.
    const attemptAfterLock = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '9999' }).expect(401);
    expect(attemptAfterLock.body.message).toMatch(/locked/i);
    // Confirm PIN truly unchanged (1234 still the hash, still locked, so /verify also reports locked)
    const verifyLocked = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    expect(verifyLocked.body.verified).toBe(false);
    expect(verifyLocked.body.locked).toBe(true);
  });

  // 7. Ownership — Customer A's change request cannot affect Customer B's PIN, and requires A's own authentication
  it('7. Ownership — Customer A changing their PIN never touches Customer B PIN; unauthenticated change is 401', async () => {
    const { token: tokenA, customerId: custA } = await createCustomerWithCredential();
    const { token: tokenB, customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenA}`).send({ pin: '1111' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${tokenB}`).send({ pin: '2222' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${tokenA}`).send({ currentPin: '1111', newPin: '3333' }).expect(200);
    // B's PIN unaffected
    const verifyB = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${tokenB}`).send({ pin: '2222' }).expect(200);
    expect(verifyB.body.verified).toBe(true);
    // no bearer token at all → 401, no state change
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').send({ currentPin: '3333', newPin: '4444' }).expect(401);
    const verifyAStillOld = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${tokenA}`).send({ pin: '3333' }).expect(200);
    expect(verifyAStillOld.body.verified).toBe(true);
  });

  // 8 & 9 — Wallet→Wallet regression: new PIN works, old PIN stops working
  it('8/9. W2W regression — after change, OLD PIN fails a transfer and NEW PIN succeeds', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { ws, wa, wb } = await fundAndWire(custA, custB, '100000');

    // OLD PIN works before the change
    const beforeChange = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-v1c05-8a-${randomUUID()}`)
      .send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '10000', currency: 'NGN', pin: '1234' })
      .expect(201);
    expect(beforeChange.body.status).toBe('COMPLETED');

    // Change PIN 1234 → 5678
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '5678' }).expect(200);

    // OLD PIN (1234) must now FAIL a transfer
    const afterChangeOld = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-v1c05-8b-${randomUUID()}`)
      .send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '10000', currency: 'NGN', pin: '1234' })
      .expect(401);
    expect(afterChangeOld.body.message).toMatch(/Invalid PIN/i);

    // NEW PIN (5678) must succeed
    const afterChangeNew = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-v1c05-8c-${randomUUID()}`)
      .send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '10000', currency: 'NGN', pin: '5678' })
      .expect(201);
    expect(afterChangeNew.body.status).toBe('COMPLETED');

    // exactly two successful debits of 10000 each (before-change + after-change-new), the failed old-pin attempt caused no debit
    const afterWa = await ws.getWalletBalance(wa.id);
    expect(afterWa.balanceMinor).toBe('80000');
  });

  // 10. Failed change does not alter the PIN usable for W2W
  it('10. W2W regression — a failed change attempt does not alter the PIN usable for a transfer', async () => {
    const { token, customerId: custA } = await createCustomerWithCredential();
    const { customerId: custB } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { ws, wa, wb } = await fundAndWire(custA, custB, '50000');

    // Attempt a change with the WRONG current PIN — must fail
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '9999', newPin: '5678' }).expect(401);

    // Original PIN (1234) must still authorize a transfer
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/me/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `idem-v1c05-10-${randomUUID()}`)
      .send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '1234' })
      .expect(201);
    expect(res.body.status).toBe('COMPLETED');
    const afterWa = await ws.getWalletBalance(wa.id);
    expect(afterWa.balanceMinor).toBe('45000');
  });

  // 11. PIN never returned in API responses for create/change/status
  it('11. No PIN leakage — create, change and status responses never contain pin/pinHash', async () => {
    const { token } = await createCustomerWithCredential();
    const createRes = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const changeRes = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '5678' }).expect(200);
    const statusRes = await request(app.getHttpServer()).get('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).expect(200);
    for (const body of [createRes.body, changeRes.body, statusRes.body]) {
      const blob = JSON.stringify(body).toLowerCase();
      expect(blob).not.toContain('pinhash');
      expect(blob).not.toContain('1234');
      expect(blob).not.toContain('5678');
      expect(blob).not.toContain('pbkdf2');
    }
    expect(statusRes.body.status).toBe('ACTIVE');
    expect(statusRes.body.exists).toBe(true);
  });

  // 12. Audit event PIN_ROTATED exists for a successful change and contains no plaintext/hash
  it('12. Audit — PIN_ROTATED event recorded for a successful change, no plaintext pin or hash in audit', async () => {
    const { token, customerId } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '5678' }).expect(200);
    const audits: Array<{ action: string; previous_values: any; new_values: any }> = await dataSource.query(
      `SELECT action, previous_values, new_values FROM audit_events WHERE entity_type='CUSTOMER_TRANSACTION_PIN' ORDER BY occurred_at ASC`,
    );
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('PIN_CREATED');
    expect(actions).toContain('PIN_ROTATED');
    for (const a of audits) {
      const blob = JSON.stringify({ prev: a.previous_values, nw: a.new_values }).toLowerCase();
      expect(blob).not.toContain('1234');
      expect(blob).not.toContain('5678');
      expect(blob).not.toContain('pbkdf2$sha256');
      expect(blob).not.toContain('"pinhash"');
    }
  });

  // 13. newPin must differ from currentPin
  it('13. Validation — newPin identical to currentPin is rejected (400), PIN unchanged', async () => {
    const { token } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '1234' }).expect(400);
    expect(res.body.message).toMatch(/different/i);
  });

  // 14. Change without an existing PIN is rejected — creation and change are distinct operations
  it('14. Separation — change endpoint rejects when no PIN has been created yet (400), directs to create', async () => {
    const { token } = await createCustomerWithCredential();
    const res = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '5678' }).expect(400);
    expect(res.body.message).toMatch(/no transaction pin/i);
  });

  // 15. Status endpoint accurately reflects NOT_SET / ACTIVE / LOCKED (recovery-unavailable UX relies on this)
  it('15. Status — GET transaction-pin reports NOT_SET, then ACTIVE, then LOCKED after 5 failed verifies', async () => {
    const { token } = await createCustomerWithCredential();
    const notSet = await request(app.getHttpServer()).get('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).expect(200);
    expect(notSet.body.status).toBe('NOT_SET');
    expect(notSet.body.exists).toBe(false);

    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const active = await request(app.getHttpServer()).get('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).expect(200);
    expect(active.body.status).toBe('ACTIVE');
    expect(active.body.pinVersion).toBe(1);

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '0000' }).expect(200);
    }
    const locked = await request(app.getHttpServer()).get('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).expect(200);
    expect(locked.body.status).toBe('LOCKED');
    expect(locked.body.accountLocked).toBe(true);
  });

  // 16. Format validation on the change endpoint (defense-in-depth, consistent with create/verify)
  it('16. Validation — change endpoint rejects malformed currentPin/newPin (400), no state mutated', async () => {
    const { token } = await createCustomerWithCredential();
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: 'abcd', newPin: '5678' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/change').set('Authorization', `Bearer ${token}`).send({ currentPin: '1234', newPin: '12' }).expect(400);
    // original PIN still usable — malformed requests did not touch state or consume an attempt
    const verify = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    expect(verify.body.verified).toBe(true);
  });
});
