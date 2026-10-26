/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
/**
 * V1-ADMIN-FULL-SURFACE-AUDIT-01 Part A — regression for the "Authentication required" defect
 * reported against Admin Web's Customer & KYC Servicing screen (real PostgreSQL + real HTTP,
 * real local-admin login, no mocks).
 *
 * Root cause (see runtime-access.guard.ts and route-policy-registry.ts for the full analysis):
 *
 *   1. `RuntimeAccessGuard`'s default branch (used by any route with no explicit
 *      `authenticationMode`, e.g. the generic `/api/v1/customers` surface Admin Web's Customer
 *      & KYC Servicing screen calls) only ever attempted to resolve an Agent or a Customer
 *      session. A genuine, correctly-issued A2 workforce (SUPER_ADMIN/PRIVILEGED) bearer
 *      token could never be recognised there, so it fell straight through to 401
 *      "Authentication required" before `authorizationService.authorize()` ever consulted the
 *      route's policy — even though that policy already declared OPERATOR/SERVICE/PRIVILEGED
 *      principal types allowed.
 *   2. Independently, `AuthorizationService.checkCustomerScope()`'s `SELF` branch treated any
 *      non-CUSTOMER principal as an automatic `CUSTOMER_SCOPE_MISMATCH`, which would have kept
 *      denying workforce principals with 403 even after (1) was fixed, on every resource-ID
 *      scoped route (`/customers/:id`, `/customers/:id/kyc`, ...).
 *   3. The bare `GET/POST /api/v1/customers` (list/create, no `:id`) had no dedicated
 *      route-policy branch at all and fell into the final catch-all, whose
 *      `requiredScopes: ['internal:access']` is never granted to any principal — unreachable by
 *      design for everyone until a dedicated branch was added.
 *
 * This suite proves, end-to-end over the real HTTP stack with a REAL local-admin login (the
 * same login Admin Web actually performs) and a REAL, persisted SUPER_ADMIN role assignment
 * (no synthetic principal injection, no mocked session/authorization service):
 *   - a genuine SUPER_ADMIN session can now list, create, read, and read the KYC state of
 *     customers through the exact endpoints Admin Web's Customer & KYC Servicing screen calls;
 *   - an unauthenticated request to the same endpoints still fails closed with 401 (the fix
 *     must not weaken this — see test/v1-customer-onboarding-01.integration.spec.ts line ~190);
 *   - logging out (revoking the real session) makes the same, previously-working request fail
 *     with 401 again, and logging back in makes it succeed again (full login → 200 → logout →
 *     401 → re-login → 200 cycle, against real session infrastructure).
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';

// Deliberately does NOT override A2_WORKFORCE_CONFIG or any session/authorization provider:
// this suite boots the real AppModule exactly like the running backend, and exercises the real
// guard, the real route-policy registry, and the real local-admin login path end to end.
describe('V1-ADMIN-FULL-SURFACE-AUDIT-01 Part A — customer API auth propagation (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminauthprop');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    localAdminService = moduleRef.get(LocalAdminAuthenticationService);
  }, 180_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try {
          if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function loginAsFinanceAdmin(): Promise<{ token: string; sessionId: string }> {
    await localAdminService.seedDefaultAdmin({
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });
    const login = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    expect(login.status).toBe(201);
    expect(login.body.principal).toMatchObject({ type: 'PRIVILEGED', roles: ['SUPER_ADMIN'] });
    return { token: login.body.accessToken as string, sessionId: login.body.sessionId as string };
  }

  it('an unauthenticated GET /api/v1/customers fails closed with 401 (fail-closed behaviour preserved)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/customers');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/authentication required/i);
  });

  it('an unauthenticated POST /api/v1/customers fails closed with 401 (fail-closed behaviour preserved)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .send({ reference: 'should-not-be-created', type: 'INDIVIDUAL', actor: 'anonymous' });
    expect(res.status).toBe(401);
  });

  it('a real SUPER_ADMIN session can list customers via GET /api/v1/customers (previously 401 "Authentication required")', async () => {
    const { token } = await loginAsFinanceAdmin();

    const res = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('a real SUPER_ADMIN session can create, read, and read KYC status for a customer via the Admin Web customer-servicing endpoints', async () => {
    const { token } = await loginAsFinanceAdmin();
    const AUTH = { Authorization: `Bearer ${token}` };

    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(AUTH)
      .send({ reference: `audit-regression-${Date.now()}`, type: 'INDIVIDUAL', actor: 'finance-admin-audit' });
    expect(created.status).toBe(201);
    expect(typeof created.body.id).toBe('string');
    const customerId = created.body.id as string;

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}`)
      .set(AUTH);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(customerId);

    // No KYC assessment has been submitted yet — this must be a legitimate business-state 404
    // ("Current KYC assessment ... was not found"), never an authentication/authorization
    // failure. Distinguishing this from a 401/403 is exactly what V1-ADMIN-FULL-SURFACE-AUDIT-01
    // Part F requires.
    const kyc = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/kyc`)
      .set(AUTH);
    expect(kyc.status).toBe(404);
    expect(kyc.body.message).toMatch(/kyc assessment/i);
  });

  it('full real-session cycle: login → protected API 200 → logout → protected API 401 → re-login → protected API 200 again', async () => {
    await localAdminService.seedDefaultAdmin({
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });

    // 1) Login (real HTTP, real DB-backed A2 workforce session).
    const firstLogin = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    expect(firstLogin.status).toBe(201);
    const firstToken = firstLogin.body.accessToken as string;
    const firstSessionId = firstLogin.body.sessionId as string;

    // 2) The real session authorizes the previously-broken Admin Web customer-servicing API.
    const beforeLogout = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${firstToken}`);
    expect(beforeLogout.status).toBe(200);

    // 3) Logout — the exact call Admin Web's auth-store performs on logout.
    const logout = await request(app.getHttpServer())
      .delete(`/api/v1/internal/a2/workforce/sessions/${firstSessionId}`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ reason: 'V1-ADMIN-FULL-SURFACE-AUDIT-01 regression test logout' });
    expect([200, 201, 204]).toContain(logout.status);

    // 4) The now-revoked session must no longer authorize the same API: 401, not a stale 200.
    const afterLogout = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${firstToken}`);
    expect(afterLogout.status).toBe(401);

    // 5) Re-login issues a fresh, independently valid session that authorizes the API again.
    const secondLogin = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    expect(secondLogin.status).toBe(201);
    const secondToken = secondLogin.body.accessToken as string;
    expect(secondToken).not.toBe(firstToken);

    const afterReLogin = await request(app.getHttpServer())
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${secondToken}`);
    expect(afterReLogin.status).toBe(200);
  });

  it('SUPPORT remains denied on the general customer-servicing surface even though workforce sessions are now recognised here (no over-broadening of the fix)', async () => {
    // This mirrors the dedicated adversarial regression in
    // test/v1-harden-01-support-adversarial.integration.spec.ts ("a real SUPPORT bearer token
    // cannot read or modify an arbitrary customer record via the customer API"). It is repeated
    // here, scoped to this task, to document that fixing the guard's session-resolution gap for
    // OPERATOR/SERVICE/PRIVILEGED did not also broaden SUPPORT's access to this surface.
    const { token: financeAdminToken } = await loginAsFinanceAdmin();
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ reference: `support-boundary-${Date.now()}`, type: 'INDIVIDUAL', actor: 'finance-admin-audit' });
    expect(created.status).toBe(201);
    const customerId = created.body.id as string;

    const provisioned = await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set('Authorization', `Bearer ${financeAdminToken}`)
      .send({ username: `audit.support.${Date.now()}`, actor: 'finance-admin-audit' });
    expect(provisioned.status).toBe(201);

    const supportLogin = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username: provisioned.body.username, password: provisioned.body.temporaryPassword });
    expect(supportLogin.status).toBe(200);
    const supportToken = supportLogin.body.accessToken as string;

    const supportRead = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${supportToken}`);
    expect([401, 403]).toContain(supportRead.status);
  });
});
