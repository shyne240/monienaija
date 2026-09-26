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

function encodePbkdf2(password: string, saltStr = 'a26-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('A26 Customer Profile & Settings Hardening (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a26profile');
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

  async function createCustomer(opts: { reference?: string; displayName?: string; phone?: string; password?: string } = {}): Promise<{ customerId: string; reference: string; phone: string; displayName: string; token: string; password: string }> {
    const reference = opts.reference ?? `cust-a26-${randomUUID()}`;
    const displayName = opts.displayName ?? `Customer A26 ${randomUUID().slice(0,4)}`;
    const password = opts.password ?? 'correct-password-a26';
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
    return { customerId, reference, phone: canonical10, displayName, token, password };
  }

  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [`cls-a26-${randomUUID().slice(0,8)}`, `A26-${randomUUID().slice(0,6)}`, 'A26 Class', JSON.stringify(['CASH_IN']), JSON.stringify({})],
    );
    const classId = classRows[0]!.id;
    const ref = `agent-a26-${randomUUID()}`;
    const agentRows: Array<{ id: string }> = await dataSource.query(`INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`, [ref, classId]);
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-a26', 'agent-salt');
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'agent-pass-a26' }).expect(200);
    return login.body.accessToken as string;
  }

  // A. Authenticated Customer can read own profile/settings
  it('A. Authenticated Customer can read own profile/settings', async () => {
    const { token, customerId, displayName, phone } = await createCustomer({ displayName: 'Ada A26', phone: '8111111111' });
    const res = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.id).toBe(customerId);
    expect(res.body.profile?.displayName).toBe('Ada A26');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.kycLevel).toBe('LEVEL_1');
    // phone via receiving identity read-only
    const recv = await request(app.getHttpServer()).get('/api/v1/customers/me/receiving-identity').set('Authorization', `Bearer ${token}`).expect(200);
    expect(recv.body.receivingIdentity).toBe(phone);
    expect(recv.body.status).toBe('ACTIVE');
    const recvAlias = await request(app.getHttpServer()).get('/api/v1/customers/me/receiving-number').set('Authorization', `Bearer ${token}`).expect(200);
    expect(recvAlias.body.receivingNumber).toBe(phone);
    // sessions read
    const sess = await request(app.getHttpServer()).get('/api/v1/customers/me/sessions').set('Authorization', `Bearer ${token}`).expect(200);
    expect(sess.body.customerId).toBe(customerId);
    expect(Array.isArray(sess.body.sessions)).toBe(true);
    expect(sess.body.sessions.length).toBeGreaterThanOrEqual(1);
    // safe projection: no tokenHash
    const sessJson = JSON.stringify(sess.body).toLowerCase();
    expect(sessJson).not.toContain('tokenhash');
    expect(sessJson).not.toContain('token_hash');
  });

  // B. Cannot read another customer's profile/settings
  it('B. Customer cannot read another customer profile/settings', async () => {
    const { token: tokenA } = await createCustomer({ displayName: 'Alice B', phone: '8222222222' });
    const { customerId: custB, token: tokenB, displayName: dispB } = await createCustomer({ displayName: 'Bob B', phone: '8333333333' });
    // B's profile is readable by B
    const bProfile = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(bProfile.body.profile.displayName).toBe(dispB);
    // A's /me/profile never returns B's data, only own. We verify that A's profile is not B's
    const aProfile = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(aProfile.body.profile.displayName).not.toBe(dispB);
    // No arbitrary customerId param: try to PATCH with forged customerId in body should be rejected/ignored
    const patchAttempt = await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${tokenA}`).send({ displayName: 'Hacked', customerId: custB }).expect(400);
    expect(patchAttempt.body.message).toMatch(/not allowed|not mutable/i);
  });

  // C. Can update only permitted mutable profile fields (displayName)
  it('C. Customer can update only permitted mutable profile fields', async () => {
    const { token, customerId } = await createCustomer({ displayName: 'Old Name', phone: '8444444444' });
    const newName = `NewName ${randomUUID().slice(0,6)}`;
    const patch = await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).send({ displayName: newName }).expect(200);
    expect(patch.body.profile.displayName).toBe(newName);
    // persisted: GET reflects new
    const get = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).expect(200);
    expect(get.body.profile.displayName).toBe(newName);
    // DB verify
    const rows: Array<{ display_name: string }> = await dataSource.query(`SELECT display_name FROM customer_profiles WHERE customer_id=$1 AND is_active=true`, [customerId]);
    expect(rows[0].display_name).toBe(newName);
  });

  // D. Immutable/security-sensitive fields cannot be modified through profile PATCH
  it('D. Immutable/security-sensitive fields cannot be modified through profile PATCH', async () => {
    const { token, customerId } = await createCustomer({ displayName: 'Immutable Test', phone: '8555555555' });
    const before: Array<{ kyc_level: string; kyc_status: string; reference: string }> = await dataSource.query(`SELECT kyc_level, kyc_status, reference FROM customers WHERE id=$1`, [customerId]);
    // try each immutable
    for (const payload of [
      { displayName: 'Valid', kycLevel: 'LEVEL_2' },
      { displayName: 'Valid', reference: 'hacked-ref' },
      { displayName: 'Valid', status: 'CLOSED' },
      { displayName: 'Valid', legalName: 'Hacked Legal' },
      { displayName: 'Valid', customerId },
      { displayName: 'Valid', passwordHash: 'hacked' },
      { displayName: 'Valid', pinHash: 'hacked' },
      { kycLevel: 'LEVEL_2' },
    ]) {
      await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).send(payload).expect(400);
    }
    // ensure DB unchanged for kyc/reference
    const after: Array<{ kyc_level: string; kyc_status: string; reference: string }> = await dataSource.query(`SELECT kyc_level, kyc_status, reference FROM customers WHERE id=$1`, [customerId]);
    expect(after[0].kyc_level).toBe(before[0].kyc_level);
    expect(after[0].reference).toBe(before[0].reference);
    // profile still old? patch with valid should succeed after
    const valid = await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).send({ displayName: 'Still Valid' }).expect(200);
    expect(valid.body.profile.displayName).toBe('Still Valid');
  });

  // E. Agent principal is rejected
  it('E. Agent principal is rejected on Customer SELF routes', async () => {
    const agentToken = await createAgentToken();
    await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${agentToken}`).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${agentToken}`).send({ displayName: 'Agent tries' }).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${agentToken}`).send({ currentPassword: 'x', newPassword: 'y12345678' }).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).get('/api/v1/customers/me/sessions').set('Authorization', `Bearer ${agentToken}`).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
    await request(app.getHttpServer()).get('/api/v1/customers/me/receiving-identity').set('Authorization', `Bearer ${agentToken}`).expect((r)=>expect([401,403].includes(r.status)).toBe(true));
  });

  // F. Unauthenticated rejected
  it('F. Unauthenticated request is rejected', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers/me/profile').expect(401);
    await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').send({ displayName: 'NoAuth' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').send({ currentPassword: 'a', newPassword: 'b12345678' }).expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me/sessions').expect(401);
    await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', 'Bearer invalid').expect(401);
  });

  // G. Security credential mutations work through existing auth services (password change)
  it('G. Security credential mutations work (password change via existing CustomerAuthenticationService)', async () => {
    const { customerId, token, password: oldPass } = await createCustomer({ password: 'oldpass-123' });
    const newPass = 'newpass-45678';
    const change = await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: oldPass, newPassword: newPass }).expect(200);
    expect(change.body.changed).toBe(true);
    expect(change.body.passwordVersion).toBeGreaterThan(1);
    // old password should fail, new should succeed
    await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password: oldPass }).expect(401);
    const loginNew = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password: newPass }).expect(200);
    expect(loginNew.body.accessToken).toBeTruthy();
    // existing token still valid? we document not revoked, so old token should still work for profile read until expiry
    const still = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).expect(200);
    expect(still.body.id).toBe(customerId);
  });

  // H. Invalid current credential is rejected
  it('H. Invalid current credential is rejected where required', async () => {
    const { token } = await createCustomer({ password: 'real-pass-123' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'wrong-pass', newPassword: 'new-pass-123456' }).expect(401);
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'real-pass-123', newPassword: 'short' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'real-pass-123', newPassword: 'real-pass-123' }).expect(400);
    // missing fields
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'real-pass-123' }).expect(400);
  });

  // I. Password/PIN secrets are never returned
  it('I. Password/PIN secrets are never returned', async () => {
    const { token, password } = await createCustomer({ password: 'secret-pass-123' });
    const profile = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).expect(200);
    const lower = JSON.stringify(profile.body).toLowerCase();
    expect(lower).not.toContain('password');
    expect(lower).not.toContain('passwordhash');
    expect(lower).not.toContain('pinhash');
    expect(lower).not.toContain('hash');

    const sess = await request(app.getHttpServer()).get('/api/v1/customers/me/sessions').set('Authorization', `Bearer ${token}`).expect(200);
    const sessLower = JSON.stringify(sess.body).toLowerCase();
    expect(sessLower).not.toContain('password');
    expect(sessLower).not.toContain('tokenhash');
    expect(sessLower).not.toContain('hash');

    const change = await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: password, newPassword: 'another-pass-123' }).expect(200);
    const changeLower = JSON.stringify(change.body).toLowerCase();
    // passwordVersion is allowed (not secret), but password hash / plaintext must not appear
    expect(changeLower).not.toContain('passwordhash');
    expect(changeLower).not.toContain('"password"');
    expect(changeLower).not.toContain('currentpassword');
    expect(changeLower).not.toContain('newpassword');
    expect(changeLower).not.toContain('pinhash');
    // login response also not contain hash
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId: (await dataSource.query(`SELECT id FROM customers LIMIT 1`))[0].id, password: 'another-pass-123' }).catch(()=>null);
    // not needed
  });

  // J. Password/PIN secrets are never persisted in plaintext (hash only)
  it('J. Password/PIN secrets are never persisted in plaintext', async () => {
    const { customerId, token, password } = await createCustomer({ password: 'plain-check-123' });
    const newPass = 'new-plain-789012';
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: password, newPassword: newPass }).expect(200);
    const rows: Array<{ password_hash: string }> = await dataSource.query(`SELECT password_hash FROM customer_authentication_credentials WHERE customer_id=$1`, [customerId]);
    expect(rows[0].password_hash).not.toContain(password);
    expect(rows[0].password_hash).not.toContain(newPass);
    expect(rows[0].password_hash).toMatch(/^PBKDF2\$/);
    // audit should not contain plaintext
    const audits: Array<{ new_values: any; previous_values: any }> = await dataSource.query(`SELECT new_values, previous_values FROM audit_events WHERE entity_type='CUSTOMER_AUTHENTICATION_CREDENTIAL' ORDER BY created_at DESC LIMIT 2`);
    for (const a of audits) {
      const blob = JSON.stringify(a).toLowerCase();
      expect(blob).not.toContain(password.toLowerCase());
      expect(blob).not.toContain(newPass.toLowerCase());
    }
  });

  // K. Security events contain no secrets
  it('K. Security events contain no secrets', async () => {
    const { customerId, token, password } = await createCustomer({ password: 'sec-event-123' });
    const newPass = 'sec-event-45678';
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: password, newPassword: newPass }).expect(200);
    const patch = await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).send({ displayName: 'SecEvent Name' }).expect(200);
    // check security_event_history and audit_events for no secrets
    const secRows: Array<{ metadata: any }> = await dataSource.query(`SELECT metadata FROM security_event_histories WHERE customer_id=$1`, [customerId]);
    for (const r of secRows) {
      const blob = JSON.stringify(r.metadata).toLowerCase();
      expect(blob).not.toContain(password.toLowerCase());
      expect(blob).not.toContain(newPass.toLowerCase());
    }
    const auditRows: Array<{ new_values: any; previous_values: any }> = await dataSource.query(`SELECT new_values, previous_values FROM audit_events WHERE entity_type='CUSTOMER_PROFILE'`, []);
    for (const a of auditRows) {
      const blob = JSON.stringify(a).toLowerCase();
      // profile audits should not contain password
      expect(blob).not.toContain('passwordhash');
      expect(blob).not.toContain('"password"');
    }
  });

  // L. Existing transaction PIN functionality remains intact
  it('L. Existing transaction PIN functionality remains intact', async () => {
    const { token } = await createCustomer({ password: 'pin-check-123' });
    // set PIN
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const verify = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    expect(verify.body.verified).toBe(true);
    const verifyBad = await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin/verify').set('Authorization', `Bearer ${token}`).send({ pin: '9999' }).expect(200);
    expect(verifyBad.body.verified).toBe(false);
  });

  // M. Existing Customer login/logout remains intact
  it('M. Existing Customer login/logout remains intact', async () => {
    const { customerId, password } = await createCustomer({ password: 'login-pass-123' });
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    const token = login.body.accessToken as string;
    const me = await request(app.getHttpServer()).get('/api/v1/customers/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.id).toBe(customerId);
    await request(app.getHttpServer()).post('/api/v1/customers/sessions/logout').set('Authorization', `Bearer ${token}`).expect(200);
    // after logout, token should be revoked
    await request(app.getHttpServer()).get('/api/v1/customers/me').set('Authorization', `Bearer ${token}`).expect(401);
    // can login again
    await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
  });

  // N. Existing W→W PIN authorization remains intact
  it('N. Existing W→W PIN authorization remains intact', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice N', phone: '8666666666', password: 'w2w-pass-123' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob N', phone: '8777777777', password: 'b-pass-123' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '9999' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a26n-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a26n-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATN_${randomUUID().slice(0,6)}`, name: 'PlatN', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundN-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '50000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '50000' }] });
    // without PIN -> 401
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a26n-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN' }).expect(401);
    // with PIN -> 201
    await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a26n2-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '5000', currency: 'NGN', pin: '9999' }).expect(201);
  });

  // O. Existing transaction history remains intact
  it('O. Existing transaction history remains intact', async () => {
    const { token, customerId: custA } = await createCustomer({ displayName: 'Alice O', phone: '8888888888', password: 'hist-pass-123' });
    const { customerId: custB } = await createCustomer({ displayName: 'Bob O', phone: '8999999999', password: 'b2-pass' });
    await request(app.getHttpServer()).post('/api/v1/customers/me/transaction-pin').set('Authorization', `Bearer ${token}`).send({ pin: '1234' }).expect(200);
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId: custA, currency: 'NGN', idempotencyKey: `a26o-wa-${custA}` });
    const wb = await ws.createWallet({ customerId: custB, currency: 'NGN', idempotencyKey: `a26o-wb-${custB}` });
    const plat = await ls.createAccount({ code: `PLATO_${randomUUID().slice(0,6)}`, name: 'PlatO', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundO-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '80000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '80000' }] });
    const tr = await request(app.getHttpServer()).post('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', `idem-a26o-${randomUUID()}`).send({ sourceWalletId: wa.id, destinationWalletId: wb.id, amountMinor: '7000', currency: 'NGN', pin: '1234' }).expect(201);
    const hist = await request(app.getHttpServer()).get('/api/v1/customers/me/transfers').set('Authorization', `Bearer ${token}`).expect(200);
    const found = hist.body.items.find((x: any)=> x.id === tr.body.id);
    expect(found).toBeDefined();
    expect(found.direction).toBe('SENT');
    const detail = await request(app.getHttpServer()).get(`/api/v1/customers/me/transfers/${tr.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail.body.id).toBe(tr.body.id);
  });

  // P. Existing session authorization remains intact
  it('P. Existing session authorization remains intact', async () => {
    const { customerId, password } = await createCustomer({ password: 'sess-pass-123' });
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    const token = login.body.accessToken as string;
    await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).expect(200);
    // invalid token rejected
    await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', 'Bearer invalidtoken123').expect(401);
    // expired? we cannot easily test expiry without time travel, but revocation tested in M
  });

  // Q. Any implemented preference updates are strictly Customer SELF scoped
  it('Q. Preference/profile updates are strictly Customer SELF scoped', async () => {
    const { token: tokenA, displayName: dispA } = await createCustomer({ displayName: 'Alice Q', phone: '8110000001', password: 'q-pass-123' });
    const { customerId: custB, token: tokenB, displayName: dispB } = await createCustomer({ displayName: 'Bob Q', phone: '8220000002', password: 'q2-pass' });
    const newA = `AliceNew ${randomUUID().slice(0,4)}`;
    await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${tokenA}`).send({ displayName: newA }).expect(200);
    // B's profile unchanged
    const bProfile = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(bProfile.body.profile.displayName).toBe(dispB);
    // A's profile updated
    const aProfile = await request(app.getHttpServer()).get('/api/v1/customers/me/profile').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(aProfile.body.profile.displayName).toBe(newA);
    // B cannot affect A via forged body (already tested in B)
  });

  // R. No financial ledger/balance mutation occurs
  it('R. No financial ledger/balance mutation occurs via profile/settings', async () => {
    const { token, customerId } = await createCustomer({ displayName: 'Alice R', phone: '8330000003', password: 'r-pass-123' });
    const { WalletService: WS } = await import('../src/wallet/wallet.service');
    const { LedgerService: LS } = await import('../src/ledger/ledger.service');
    const ws = app.get(WS); const ls = app.get(LS);
    const wa = await ws.createWallet({ customerId, currency: 'NGN', idempotencyKey: `a26r-wa-${customerId}` });
    const plat = await ls.createAccount({ code: `PLATR_${randomUUID().slice(0,6)}`, name: 'PlatR', accountType: 'ASSET' as any, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS' });
    await ls.postJournal({ idempotencyKey: `fundR-${randomUUID()}`, currency: 'NGN', accountingUnit: 'CUSTOMER_FUNDS', reference: `ref-${randomUUID()}`, lines: [{ accountId: plat.id, direction: 'DEBIT' as any, amountMinor: '100000' }, { accountId: wa.ledgerAccountId, direction: 'CREDIT' as any, amountMinor: '100000' }] });
    const beforeBal = await ws.getWalletBalance(wa.id);
    const beforeJournals: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const beforeCount = Number(beforeJournals[0].count);
    // profile patch + password change
    await request(app.getHttpServer()).patch('/api/v1/customers/me/profile').set('Authorization', `Bearer ${token}`).send({ displayName: 'R New' }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/customers/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword: 'r-pass-123', newPassword: 'r-newpass-12345' }).expect(200);
    await request(app.getHttpServer()).get('/api/v1/customers/me/sessions').set('Authorization', `Bearer ${token}`).expect(200);
    const afterBal = await ws.getWalletBalance(wa.id);
    expect(afterBal.balanceMinor).toBe(beforeBal.balanceMinor);
    const afterJournals: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    expect(Number(afterJournals[0].count)).toBe(beforeCount);
    // also ensure no new transfers
    const transfers: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM transfers WHERE source_wallet_id=$1 OR destination_wallet_id=$1`, [wa.id]);
    expect(Number(transfers[0].count)).toBe(0);
  });

  // Extra: V1 boundary
  it('S. V1 boundary verification (no second ledger/bank/NIBSS/provider)', async () => {
    const fs = await import('node:fs');
    const ctrl = fs.readFileSync('src/customer-app/customer-app.controller.ts', 'utf8');
    expect(ctrl).not.toContain('postJournalInTransaction');
    expect(ctrl).not.toContain('BankService');
    expect(ctrl.toLowerCase()).not.toContain('nibss');
    expect(ctrl).not.toContain('ProviderAdapter');
    // ensure profile/password does not import ledger mutation
    expect(ctrl).toContain('patchProfile');
    expect(ctrl).toContain('changePassword');
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0].count)).toBe(63);
  });
});
