/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-call */
/**
 * V1-OPS-01 — Workforce Support Provisioning & Operational Workflow (real PostgreSQL + real HTTP).
 *
 * Proves the closed gap end-to-end through actual HTTP boundaries, with NO synthetic
 * principal injection for the SUPPORT identity itself: an authorized OPERATOR provisions a
 * SUPPORT workforce user, the SUPPORT user logs in through the real
 * `POST /internal/support/workforce-sessions` endpoint, and the resulting bearer token is
 * validated by the real `RuntimeAccessGuard` -> `SupportAuthenticationService.validate()`
 * path (not a test double). The ADMIN/OPERATOR actor itself still uses the established
 * `Bearer workforce-<TYPE>` mock A2 session (same pattern as
 * test/v1-agent-credentials-01.integration.spec.ts) because exercising the full external
 * OIDC workforce exchange is out of scope here and already covered elsewhere.
 */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID, pbkdf2Sync } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { WalletService } from '../src/wallet/wallet.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'test-salt-v1-ops-01'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-OPS-01 Support Workforce Operational Workflow (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let walletService: WalletService;

  const workforceConfig: A2WorkforceConfigurationV1 = {
    enabled: true,
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 900,
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  // The ONLY mocked identity boundary in this suite: the A2 (OPERATOR/PRIVILEGED) workforce
  // exchange, exactly as in test/v1-agent-credentials-01.integration.spec.ts. SUPPORT is
  // deliberately NOT resolved here — a token of the form `Bearer workforce-SUPPORT` must be
  // rejected, because the real SUPPORT identity path is the one under test.
  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-'))
        throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['OPERATOR', 'SERVICE', 'PRIVILEGED'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
        assuranceLevel: 'MFA',
      } as any;
    },
  };

  const OPERATOR = { Authorization: 'Bearer workforce-OPERATOR' };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1ops01support');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(A2WorkforceSessionService)
      .useValue(mockWorkforceSessions)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
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
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createCustomerWithCredential(): Promise<{ customerId: string; token: string }> {
    const reference = `cust-ops01-${randomUUID()}`;
    const password = 'correct-password-ops01';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'Ops01 Customer']);
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`, [customerId, `0${canonical10.slice(1)}`, canonical10]);
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `ops01-wallet-${customerId}` });
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    return { customerId, token: login.body.accessToken as string };
  }

  async function provisionSupportUser(username: string): Promise<{ username: string; temporaryPassword: string; supportUserId: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set(OPERATOR)
      .send({ username })
      .expect(201);
    expect(res.body.temporaryPassword).toEqual(expect.any(String));
    expect(res.body.username).toBe(username);
    return { username, temporaryPassword: res.body.temporaryPassword, supportUserId: res.body.supportUserId };
  }

  async function loginSupport(username: string, password: string): Promise<{ accessToken: string; sessionId: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username, password })
      .expect(200);
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.accessToken).toEqual(expect.any(String));
    return { accessToken: res.body.accessToken, sessionId: res.body.sessionId };
  }

  // ── 1/8. Provisioning is never self-service; only an authorized operational actor can do it ──
  it('1. CUSTOMER cannot provision a SUPPORT workforce user', async () => {
    const customer = await createCustomerWithCredential();
    await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set({ Authorization: `Bearer ${customer.token}` })
      .send({ username: 'rogue.support' })
      .expect(403);
  });

  it('2. An unauthenticated caller cannot provision a SUPPORT workforce user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .send({ username: 'rogue.support2' })
      .expect(401);
  });

  // ── 2/8. ADMIN (OPERATOR) provisions a real SUPPORT identity ──
  it('3. OPERATOR provisions a real SUPPORT workforce user; a one-time temporary password is returned and a no-secret audit event is recorded', async () => {
    const username = `agent.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);

    const row: Array<{ password_hash: string; status: string }> = await dataSource.query(
      `SELECT password_hash, status FROM support_workforce_users WHERE id = $1`,
      [provisioned.supportUserId],
    );
    expect(row[0]!.status).toBe('ACTIVE');
    // The plaintext temporary password must never equal the stored hash, and the hash must
    // never contain the plaintext value anywhere in it.
    expect(row[0]!.password_hash).not.toBe(provisioned.temporaryPassword);
    expect(row[0]!.password_hash.includes(provisioned.temporaryPassword)).toBe(false);

    const audits: Array<{ action: string; new_values: any }> = await dataSource.query(
      `SELECT action, new_values FROM audit_events WHERE entity_type = 'SUPPORT_WORKFORCE_USER' AND entity_id = $1 ORDER BY occurred_at`,
      [provisioned.supportUserId],
    );
    expect(audits.some((a) => a.action === 'SUPPORT_WORKFORCE_USER_PROVISIONED')).toBe(true);
    const provisionAudit = audits.find((a) => a.action === 'SUPPORT_WORKFORCE_USER_PROVISIONED')!;
    const serialized = JSON.stringify(provisionAudit.new_values);
    expect(serialized.includes(provisioned.temporaryPassword)).toBe(false);
  });

  // ── 3/8. SUPPORT authenticates for real and is recognized downstream ──
  it('4. The SUPPORT user authenticates with the temporary password via real HTTP login and the resulting session is recognized as a genuine SUPPORT principal by a protected route', async () => {
    const username = `teller.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const session = await loginSupport(username, provisioned.temporaryPassword);

    // Prove real recognition by RuntimeAccessGuard -> SupportAuthenticationService.validate():
    // a SUPPORT-permitted internal route succeeds with this exact bearer token.
    const list = await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set({ Authorization: `Bearer ${session.accessToken}` })
      .expect(200);
    expect(list.body).toHaveProperty('items');

    const audits: Array<{ action: string }> = await dataSource.query(
      `SELECT action FROM audit_events WHERE entity_type = 'SUPPORT_WORKFORCE_SESSION' ORDER BY occurred_at`,
    );
    expect(audits.some((a) => a.action === 'SUPPORT_WORKFORCE_LOGIN_SUCCEEDED')).toBe(true);
  });

  it('4b. A wrong password is rejected, and an unknown username is rejected with the same generic message (no enumeration)', async () => {
    const username = `teller2.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username, password: 'definitely-wrong' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username: 'no-such-support-user', password: provisioned.temporaryPassword })
      .expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  // ── 4/8. Full ticket flow: SUPPORT replies, customer sees it, internal notes stay hidden ──
  it('5. SUPPORT can reply to a customer ticket; the reply is visible to the customer; an internal note is never exposed to the customer', async () => {
    const customer = await createCustomerWithCredential();
    const ticketRes = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set({ Authorization: `Bearer ${customer.token}` })
      .send({ subject: 'Cannot see my balance', category: 'WALLET', description: 'Balance looks wrong since this morning.' })
      .expect(201);
    const ticketId = ticketRes.body.id as string;

    const username = `resolver.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const session = await loginSupport(username, provisioned.temporaryPassword);
    const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

    // SUPPORT can see the ticket in the internal queue (intentional support-queue model).
    await request(app.getHttpServer())
      .get(`/api/v1/internal/support/tickets/${ticketId}`)
      .set(SUPPORT_AUTH)
      .expect(200);

    // SUPPORT posts a customer-visible reply and an internal-only note.
    await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/messages`)
      .set(SUPPORT_AUTH)
      .send({ body: 'We are looking into your balance now.', isInternal: false })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/messages`)
      .set(SUPPORT_AUTH)
      .send({ body: 'INTERNAL: likely a reconciliation delay, escalate to Ops.', isInternal: true })
      .expect(201);

    // SUPPORT can also transition ticket status (permitted boundary).
    await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/status`)
      .set(SUPPORT_AUTH)
      .send({ status: 'IN_PROGRESS' })
      .expect((res) => expect([200, 201]).toContain(res.status));

    // Customer sees the public reply, and NEVER the internal note.
    const customerMessages = await request(app.getHttpServer())
      .get(`/api/v1/customers/me/support/tickets/${ticketId}/messages`)
      .set({ Authorization: `Bearer ${customer.token}` })
      .expect(200);
    const bodies = (customerMessages.body.items ?? customerMessages.body).map((m: any) => m.body as string);
    expect(bodies.some((b: string) => b.includes('looking into your balance'))).toBe(true);
    expect(bodies.some((b: string) => b.includes('escalate to Ops'))).toBe(false);
  });

  // ── 5/8. Escalation / self-escalation boundaries, proven with a REAL SUPPORT session ──
  it('6. A real SUPPORT session cannot provision another SUPPORT workforce user (no self-escalation) and cannot reach an operational/financial admin action', async () => {
    const username = `escalator.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const session = await loginSupport(username, provisioned.temporaryPassword);
    const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

    await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set(SUPPORT_AUTH)
      .send({ username: `${username}.peer` })
      .expect(403);

    // Agent lifecycle suspend/terminate are OPERATOR/SERVICE/PRIVILEGED-only operational
    // actions; the actor check runs before any entity lookup, so a non-existent agent id is
    // sufficient to prove the boundary.
    await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/agents/${randomUUID()}/suspend`)
      .set(SUPPORT_AUTH)
      .send({ reason: 'test' })
      .expect(403);
  });

  // ── 6/8. Idempotency reuses the existing IdempotencyService (no new framework) ──
  it('7. A retried SUPPORT reply with the same Idempotency-Key does not create a duplicate message', async () => {
    const customer = await createCustomerWithCredential();
    const ticketRes = await request(app.getHttpServer())
      .post('/api/v1/customers/me/support/tickets')
      .set({ Authorization: `Bearer ${customer.token}` })
      .send({ subject: 'Idempotency check', category: 'OTHER', description: 'Testing idempotent reply.' })
      .expect(201);
    const ticketId = ticketRes.body.id as string;

    const username = `idempotent.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const session = await loginSupport(username, provisioned.temporaryPassword);
    const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

    const idempotencyKey = `idem-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/messages`)
      .set(SUPPORT_AUTH)
      .set('Idempotency-Key', idempotencyKey)
      .send({ body: 'Thanks for reaching out, retried-safe reply.' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/internal/support/tickets/${ticketId}/messages`)
      .set(SUPPORT_AUTH)
      .set('Idempotency-Key', idempotencyKey)
      .send({ body: 'Thanks for reaching out, retried-safe reply.' })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const countRows: Array<{ count: string }> = await dataSource.query(
      `SELECT count(*)::text as count FROM support_ticket_messages WHERE ticket_id = $1 AND body = $2`,
      [ticketId, 'Thanks for reaching out, retried-safe reply.'],
    );
    expect(countRows[0]!.count).toBe('1');
  });

  // ── 7/8. Status / session lifecycle semantics are real, not invented ──
  it('8. Disabling a SUPPORT user immediately revokes its active sessions; the old bearer token is rejected on the very next request', async () => {
    const username = `revoked.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const session = await loginSupport(username, provisioned.temporaryPassword);
    const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set(SUPPORT_AUTH)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/disable`)
      .set(OPERATOR)
      .send({ reason: 'offboarding' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set(SUPPORT_AUTH)
      .expect(401);

    const sessionRow: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM support_workforce_sessions WHERE id = $1`,
      [session.sessionId],
    );
    expect(sessionRow[0]!.status).toBe('REVOKED');
  });

  it('9. Login for a disabled SUPPORT user is rejected even with the correct password', async () => {
    const username = `disabled.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/disable`)
      .set(OPERATOR)
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username, password: provisioned.temporaryPassword })
      .expect(401);
  });

  it('10. Re-enabling a SUPPORT user restores the ability to log in with a fresh session', async () => {
    const username = `reenabled.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/disable`)
      .set(OPERATOR)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/enable`)
      .set(OPERATOR)
      .expect(200);

    const session = await loginSupport(username, provisioned.temporaryPassword);
    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set({ Authorization: `Bearer ${session.accessToken}` })
      .expect(200);
  });

  it('11. An expired SUPPORT session is rejected and lazily marked EXPIRED', async () => {
    const username = `expiring.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const session = await loginSupport(username, provisioned.temporaryPassword);

    await dataSource.query(
      `UPDATE support_workforce_sessions SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [session.sessionId],
    );

    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set({ Authorization: `Bearer ${session.accessToken}` })
      .expect(401);

    const row: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM support_workforce_sessions WHERE id = $1`,
      [session.sessionId],
    );
    expect(row[0]!.status).toBe('EXPIRED');
  });

  it('12. A SUPPORT user can explicitly revoke its own session via DELETE, immediately invalidating the bearer token', async () => {
    const username = `selfrevoke.support.${randomUUID().slice(0, 8)}`;
    const provisioned = await provisionSupportUser(username);
    const session = await loginSupport(username, provisioned.temporaryPassword);
    const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

    await request(app.getHttpServer())
      .delete(`/api/v1/internal/support/workforce-sessions/${session.sessionId}`)
      .set(SUPPORT_AUTH)
      .send({ reason: 'logging out' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set(SUPPORT_AUTH)
      .expect(401);
  });

  // ── 8/8. Existing SUPPORT boundary coverage is untouched — see
  // test/v1-customer-09-support-workforce-boundary.integration.spec.ts and
  // test/v1-007-support-ticket.integration.spec.ts, both exercised by the same full
  // regression run as this file.
});
