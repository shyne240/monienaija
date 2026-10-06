/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/require-await */
/**
 * V1-HARDEN-01 — adversarial SUPPORT authentication probes (real PostgreSQL + real HTTP).
 *
 * Covers audit areas not already exercised by test/v1-ops-01-support-workforce-operational
 * .integration.spec.ts: brute-force/login-abuse behaviour (Part B), a real concurrent
 * disable-vs-authenticated-request race (Part C/G), cross-account session-revocation IDOR
 * (Part E/G), SUPPORT's own disable/enable authorization boundary (Part E/G), and a fresh
 * real-HTTP regression of the customer/wallet financial-data boundary against the new guard
 * fallback (Part I). All SUPPORT identities here are provisioned and authenticated through the
 * real HTTP endpoints — no synthetic principal injection.
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

function encodePbkdf2(password: string, saltStr = 'test-salt-v1-harden-01'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-HARDEN-01 adversarial SUPPORT authentication probes (real PostgreSQL + real HTTP)', () => {
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
    dataSource = await createIntegrationDataSource('v1harden01adversarial');
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

  async function provisionSupportUser(username: string): Promise<{ username: string; temporaryPassword: string; supportUserId: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set(OPERATOR)
      .send({ username })
      .expect(201);
    return { username, temporaryPassword: res.body.temporaryPassword, supportUserId: res.body.supportUserId };
  }

  async function loginSupport(username: string, password: string): Promise<{ accessToken: string; sessionId: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username, password })
      .expect(200);
    return { accessToken: res.body.accessToken, sessionId: res.body.sessionId };
  }

  async function createCustomerWithCredential(): Promise<{ customerId: string; token: string }> {
    const reference = `cust-harden01-${randomUUID()}`;
    const password = 'correct-password-harden01';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(`INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`, [customerId, 'Harden01 Customer']);
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(`INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary) VALUES ($1,'PHONE',$2,$3,true)`, [customerId, `0${canonical10.slice(1)}`, canonical10]);
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const wallet = await walletService.createWallet({ customerId, currency: 'NGN', idempotencyKey: `harden01-wallet-${customerId}` });
    const login = await request(app.getHttpServer()).post('/api/v1/customers/sessions').send({ customerId, password }).expect(200);
    return { customerId, token: login.body.accessToken as string, walletId: (wallet as any).id } as any;
  }

  // ── Part B: brute force / login abuse ──
  describe('Part B — login abuse', () => {
    it('20 sequential wrong-password attempts against one real account produce 401 every time, with no lockout and no 429/5xx; the correct password still works immediately afterward', async () => {
      const username = `bruteforce.support.${randomUUID().slice(0, 8)}`;
      const provisioned = await provisionSupportUser(username);

      const attempts = [];
      for (let i = 0; i < 20; i += 1) {
        attempts.push(
          await request(app.getHttpServer())
            .post('/api/v1/internal/support/workforce-sessions')
            .send({ username, password: `wrong-guess-${randomUUID()}` }),
        );
      }
      for (const res of attempts) {
        expect(res.status).toBe(401);
      }
      expect(attempts.every((r) => r.status !== 429 && r.status < 500)).toBe(true);

      // Also confirm a small genuinely concurrent burst behaves identically (no 429/5xx).
      const concurrent = await Promise.all(
        Array.from({ length: 3 }).map(() =>
          request(app.getHttpServer())
            .post('/api/v1/internal/support/workforce-sessions')
            .send({ username, password: `wrong-guess-${randomUUID()}` }),
        ),
      );
      expect(concurrent.every((r) => r.status === 401)).toBe(true);

      // Confirms there is no failed-attempt lockout counter for SUPPORT (unlike
      // CustomerAuthenticationService/AgentAuthenticationService, which both lock the account
      // after MAX_FAILED_AUTHENTICATIONS=5). Documented as a P2 defense-in-depth inconsistency
      // in the audit report, not fixed here: the only password a SUPPORT account can ever have
      // is a 96-bit CSPRNG-generated temporary credential (no self-service password choice
      // exists), so brute force against the actual secret remains computationally infeasible
      // regardless of lockout.
      await loginSupport(username, provisioned.temporaryPassword);
    }, 30000);

    it('repeated attempts against many nonexistent usernames and a mix of disabled/expired/nonexistent accounts all return the same generic 401 message', async () => {
      const username = `mixedattack.support.${randomUUID().slice(0, 8)}`;
      const provisioned = await provisionSupportUser(username);
      await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/disable`)
        .set(OPERATOR)
        .send({})
        .expect(200);

      const probes = [
        { username: 'no-such-user-1', password: 'anything' },
        { username: 'no-such-user-2', password: 'anything' },
        { username, password: provisioned.temporaryPassword }, // correct password, but disabled
        { username, password: 'wrong-password-entirely' },
      ];
      const results = await Promise.all(
        probes.map((p) =>
          request(app.getHttpServer()).post('/api/v1/internal/support/workforce-sessions').send(p),
        ),
      );
      const messages = new Set(results.map((r) => (r.status === 401 ? r.body.message : `non-401:${r.status}`)));
      expect(results.every((r) => r.status === 401)).toBe(true);
      expect(messages.size).toBe(1); // every probe returns the exact same body message
    });
  });

  // ── Part C/G: concurrency races ──
  describe('Part C/G — concurrency races', () => {
    it('racing disable() against an in-flight authenticated request never crashes and always ends in a consistent state (user DISABLED, session REVOKED)', async () => {
      const username = `race.disable.${randomUUID().slice(0, 8)}`;
      const provisioned = await provisionSupportUser(username);
      const session = await loginSupport(username, provisioned.temporaryPassword);
      const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

      const [disableRes, ...ticketResponses] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/disable`)
          .set(OPERATOR)
          .send({ reason: 'race probe' }),
        ...Array.from({ length: 5 }).map(() =>
          request(app.getHttpServer()).get('/api/v1/internal/support/tickets').set(SUPPORT_AUTH),
        ),
      ]);
      expect(disableRes.status).toBe(200);
      // Every concurrent ticket request must resolve to either 200 (raced ahead of the
      // disable) or 401 (observed the disable) — never a 500 or any other status.
      for (const r of ticketResponses) {
        expect([200, 401]).toContain(r.status);
      }

      // Final state must be fully consistent regardless of how the race resolved.
      const userRow: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM support_workforce_users WHERE id = $1`,
        [provisioned.supportUserId],
      );
      expect(userRow[0]!.status).toBe('DISABLED');
      const sessionRow: Array<{ status: string }> = await dataSource.query(
        `SELECT status FROM support_workforce_sessions WHERE id = $1`,
        [session.sessionId],
      );
      expect(sessionRow[0]!.status).toBe('REVOKED');

      // And the token is now definitely rejected.
      await request(app.getHttpServer())
        .get('/api/v1/internal/support/tickets')
        .set(SUPPORT_AUTH)
        .expect(401);
    });
  });

  // ── Part E/G: cross-account IDOR / self-escalation on workforce admin actions ──
  describe('Part E/G — cross-account IDOR and self-escalation', () => {
    it('SUPPORT user A cannot revoke SUPPORT user B\'s session (cross-account session revocation denied)', async () => {
      const userA = await provisionSupportUser(`idor.a.${randomUUID().slice(0, 8)}`);
      const userB = await provisionSupportUser(`idor.b.${randomUUID().slice(0, 8)}`);
      const sessionA = await loginSupport(userA.username, userA.temporaryPassword);
      const sessionB = await loginSupport(userB.username, userB.temporaryPassword);

      await request(app.getHttpServer())
        .delete(`/api/v1/internal/support/workforce-sessions/${sessionB.sessionId}`)
        .set({ Authorization: `Bearer ${sessionA.accessToken}` })
        .send({ reason: 'attempted cross-account revoke' })
        .expect(403);

      // B's session must remain fully usable — A's attempt had no side effect.
      await request(app.getHttpServer())
        .get('/api/v1/internal/support/tickets')
        .set({ Authorization: `Bearer ${sessionB.accessToken}` })
        .expect(200);
    });

    it('a real SUPPORT session cannot disable or enable any workforce user, including itself', async () => {
      const victim = await provisionSupportUser(`idor.victim.${randomUUID().slice(0, 8)}`);
      const self = await provisionSupportUser(`idor.self.${randomUUID().slice(0, 8)}`);
      const selfSession = await loginSupport(self.username, self.temporaryPassword);
      const SUPPORT_AUTH = { Authorization: `Bearer ${selfSession.accessToken}` };

      await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/support/workforce-users/${victim.supportUserId}/disable`)
        .set(SUPPORT_AUTH)
        .send({ reason: 'self-escalation attempt' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/support/workforce-users/${self.supportUserId}/disable`)
        .set(SUPPORT_AUTH)
        .send({ reason: 'self-disable attempt' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/support/workforce-users/${victim.supportUserId}/enable`)
        .set(SUPPORT_AUTH)
        .expect(403);
    });

    it('a crafted body/header claiming an elevated principal type or role is ignored — authorization is derived solely from the server-validated bearer token', async () => {
      const username = `spoof.support.${randomUUID().slice(0, 8)}`;
      const provisioned = await provisionSupportUser(username);
      const session = await loginSupport(username, provisioned.temporaryPassword);

      await request(app.getHttpServer())
        .post('/api/v1/internal/admin/support/workforce-users')
        .set({
          Authorization: `Bearer ${session.accessToken}`,
          'X-Principal-Type': 'OPERATOR',
          'X-Role': 'PRIVILEGED',
        })
        .send({ username: `${username}.peer`, type: 'OPERATOR', role: 'PRIVILEGED', principalType: 'PRIVILEGED' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${randomUUID()}/suspend`)
        .set({
          Authorization: `Bearer ${session.accessToken}`,
          'X-Principal-Type': 'OPERATOR',
        })
        .send({ reason: 'test', type: 'OPERATOR' })
        .expect(403);
    });
  });

  // ── Part J: auditability trace over the full SUPPORT lifecycle ──
  describe('Part J — auditability', () => {
    it('every SUPPORT lifecycle action (provision, login success, login failure, disable, enable, session revoke) is recorded in the existing audit_events table with actor/action/entityId/timestamp', async () => {
      const username = `audit.support.${randomUUID().slice(0, 8)}`;
      const provisioned = await provisionSupportUser(username);
      const session = await loginSupport(username, provisioned.temporaryPassword);

      // Failure before fix: this produced NO audit trail at all (gap fixed as part of
      // V1-HARDEN-01 Part J; see SupportAuthenticationService.login()).
      await request(app.getHttpServer())
        .post('/api/v1/internal/support/workforce-sessions')
        .send({ username, password: 'definitely-wrong' })
        .expect(401);

      await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/disable`)
        .set(OPERATOR)
        .send({ reason: 'audit trace test' })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/support/workforce-users/${provisioned.supportUserId}/enable`)
        .set(OPERATOR)
        .expect(200);

      // Session was revoked by the disable() call above, so log in again to exercise
      // an explicit self-revoke for the revoke-audit assertion.
      const session2 = await loginSupport(username, provisioned.temporaryPassword);
      await request(app.getHttpServer())
        .delete(`/api/v1/internal/support/workforce-sessions/${session2.sessionId}`)
        .set({ Authorization: `Bearer ${session2.accessToken}` })
        .send({ reason: 'self logout' })
        .expect(200);

      const userAudits: Array<{ action: string; actor: string; entity_id: string; occurred_at: Date }> =
        await dataSource.query(
          `SELECT action, actor, entity_id, occurred_at FROM audit_events WHERE entity_type = 'SUPPORT_WORKFORCE_USER' AND entity_id = $1 ORDER BY occurred_at`,
          [provisioned.supportUserId],
        );
      const actions = userAudits.map((a) => a.action);
      expect(actions).toContain('SUPPORT_WORKFORCE_USER_PROVISIONED');
      expect(actions).toContain('SUPPORT_WORKFORCE_LOGIN_FAILED');
      expect(actions).toContain('SUPPORT_WORKFORCE_USER_DISABLED');
      expect(actions).toContain('SUPPORT_WORKFORCE_USER_ENABLED');
      for (const row of userAudits) {
        expect(row.entity_id).toBe(provisioned.supportUserId);
        expect(typeof row.actor).toBe('string');
        expect(row.actor.length).toBeGreaterThan(0);
        expect(row.occurred_at).toBeTruthy();
      }

      const sessionAudits: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM audit_events WHERE entity_type = 'SUPPORT_WORKFORCE_SESSION' AND entity_id = ANY($1::uuid[]) ORDER BY occurred_at`,
        [[session.sessionId, session2.sessionId]],
      );
      const sessionActions = sessionAudits.map((a) => a.action);
      expect(sessionActions).toContain('SUPPORT_WORKFORCE_LOGIN_SUCCEEDED');
      expect(sessionActions).toContain('SUPPORT_WORKFORCE_SESSION_REVOKED');
    });

    it('a failed login against an unknown username does not fabricate an audit row referencing a nonexistent user (no false entity)', async () => {
      const before: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*)::text FROM audit_events WHERE action = 'SUPPORT_WORKFORCE_LOGIN_FAILED'`,
      );
      await request(app.getHttpServer())
        .post('/api/v1/internal/support/workforce-sessions')
        .send({ username: `nonexistent.${randomUUID()}`, password: 'whatever' })
        .expect(401);
      const after: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*)::text FROM audit_events WHERE action = 'SUPPORT_WORKFORCE_LOGIN_FAILED'`,
      );
      expect(after[0]!.count).toBe(before[0]!.count);
    });
  });

  // ── Part I: customer/wallet financial-data boundary regression ──
  describe('Part I — support data-boundary regression against the new guard fallback', () => {
    it('a real SUPPORT bearer token cannot read or modify an arbitrary customer record via the customer API', async () => {
      const customer = await createCustomerWithCredential();
      const username = `boundary.support.${randomUUID().slice(0, 8)}`;
      const provisioned = await provisionSupportUser(username);
      const session = await loginSupport(username, provisioned.temporaryPassword);
      const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.customerId}`)
        .set(SUPPORT_AUTH)
        .expect((res) => expect([401, 403]).toContain(res.status));

      await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customer.customerId}`)
        .set(SUPPORT_AUTH)
        .send({ status: 'SUSPENDED', actor: 'support-escalation-attempt' })
        .expect((res) => expect([401, 403]).toContain(res.status));

      await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.customerId}/kyc`)
        .set(SUPPORT_AUTH)
        .expect((res) => expect([401, 403]).toContain(res.status));
    });

    it('a real SUPPORT bearer token cannot read or create wallets/transfers', async () => {
      const customer = await createCustomerWithCredential();
      const username = `walletboundary.support.${randomUUID().slice(0, 8)}`;
      const provisioned = await provisionSupportUser(username);
      const session = await loginSupport(username, provisioned.temporaryPassword);
      const SUPPORT_AUTH = { Authorization: `Bearer ${session.accessToken}` };

      await request(app.getHttpServer())
        .get(`/api/v1/wallets/${(customer as any).walletId ?? randomUUID()}/balance`)
        .set(SUPPORT_AUTH)
        .expect((res) => expect([401, 403, 404]).toContain(res.status));

      await request(app.getHttpServer())
        .post('/api/v1/transfers')
        .set(SUPPORT_AUTH)
        .send({ fromWalletId: randomUUID(), toWalletId: randomUUID(), amountMinor: '1000', currency: 'NGN' })
        .expect((res) => expect([401, 403, 400]).toContain(res.status));
    });
  });
});
