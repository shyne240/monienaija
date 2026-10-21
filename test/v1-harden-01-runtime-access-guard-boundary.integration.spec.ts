/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/require-await */
/**
 * V1-HARDEN-01 Part D — RuntimeAccessGuard WORKFORCE_SESSION post-authentication boundary
 * (real PostgreSQL + real HTTP, real provisioned+authenticated SUPPORT session).
 *
 * Finding: `RuntimeAccessGuard`'s `WORKFORCE_SESSION` branch authenticates A2 and SUPPORT
 * workforce bearer tokens but never itself consults `route.policy.allowedPrincipalTypes`
 * before returning `true` — it relies entirely on each controller to re-check
 * `authorizationPrincipal.type` on its own. Investigating every controller reachable behind a
 * WORKFORCE_SESSION route that the registry restricts to OPERATOR/SERVICE/PRIVILEGED (and
 * excludes SUPPORT) confirmed each one DOES perform its own such check (e.g.
 * `LimitCatalogController.requireWorkforce()`, the customer-lifecycle PATCH handler's own
 * 'Privileged access required' gate, the fee/commission/reward-rule registries, etc.).
 *
 * A guard-level enforcement change was prototyped during this audit and measurably broke five
 * unrelated, pre-existing, already-passing integration suites
 * (a22-admin-foundation, v1-hardening-09-admin-notification-delivery-diagnostics,
 * v1-capability-registry, v1-customer-onboarding-02, s-fix-01-customer-lifecycle-authorization)
 * by changing their deliberately-asserted status codes/messages for a wrong-type A2 principal
 * from 401 to 403 — without closing any gap those controllers had not already closed
 * themselves. Per this task's explicit instruction not to make undemonstrated, broad changes to
 * the authorization path, that change was reverted; the guard's lack of its own policy
 * enforcement is recorded as a defense-in-depth recommendation (audit report section 7 / 22),
 * not implemented as a fix in this task.
 *
 * This suite is the permanent regression PROVING, via the real HTTP stack with a REAL
 * provisioned+authenticated SUPPORT session (no synthetic principal injection), that every
 * SUPPORT-excluded WORKFORCE_SESSION route sampled here is already correctly denied today
 * (because of each controller's own check) — and that SUPPORT remains able to reach the routes
 * it IS permitted on.
 */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

describe('V1-HARDEN-01 Part D — RuntimeAccessGuard WORKFORCE_SESSION boundary (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;

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

  // V1-ADMIN-AUTHORIZATION-HARDENING-01: OPERATOR/SERVICE/PRIVILEGED need a realistic `scopes`
  // set (catalogue function codes) now that the relevant controllers call
  // AuthorizationService.requireFunction() rather than a bare principal-type check — this suite
  // exercises the RuntimeAccessGuard's principal-type boundary, not the authorization permission
  // matrix.
  const PRIVILEGED_WORKFORCE_FUNCTION_SCOPES = [
    'agent.suspend',
    'agent.terminate',
    'agent.reactivate',
    'agent.activate',
    'agent.review_application',
    'agent.manage_credentials',
    'workforce.user.create',
    'workforce.user.suspend',
    'customer.suspend',
    'customer.activate',
    'customer.close',
  ];
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
        scopes: PRIVILEGED_WORKFORCE_FUNCTION_SCOPES,
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
        assuranceLevel: 'MFA',
      } as any;
    },
  };

  const OPERATOR = { Authorization: 'Bearer workforce-OPERATOR' };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1harden01rag');
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
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function provisionAndLoginSupport(): Promise<{ accessToken: string }> {
    const username = `rag.boundary.${randomUUID().slice(0, 8)}`;
    const provision = await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set(OPERATOR)
      .send({ username })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username, password: provision.body.temporaryPassword })
      .expect(200);
    return { accessToken: login.body.accessToken as string };
  }

  it('denies a real, successfully-authenticated SUPPORT session on every sampled registry entry that restricts access to OPERATOR/SERVICE/PRIVILEGED (each controller already enforces this itself)', async () => {
    const { accessToken } = await provisionAndLoginSupport();
    const SUPPORT_AUTH = { Authorization: `Bearer ${accessToken}` };

    const deniedProbes: Array<{ method: 'get' | 'post'; path: string }> = [
      { method: 'get', path: '/api/v1/internal/limit-profiles' },
      { method: 'get', path: '/api/v1/internal/limit-rules' },
      { method: 'get', path: '/api/v1/internal/commercial-decision-snapshots' },
      { method: 'get', path: '/api/v1/internal/products' },
      { method: 'get', path: '/api/v1/internal/fee-rules' },
      { method: 'get', path: '/api/v1/internal/commission-rules' },
      { method: 'get', path: '/api/v1/internal/reward-rules' },
    ];

    for (const probe of deniedProbes) {
      const res = await request(app.getHttpServer())[probe.method](probe.path).set(SUPPORT_AUTH);
      expect([401, 403]).toContain(res.status);
    }
  });

  it('still allows the same real SUPPORT session on routes the policy registry explicitly permits', async () => {
    const { accessToken } = await provisionAndLoginSupport();
    const SUPPORT_AUTH = { Authorization: `Bearer ${accessToken}` };

    await request(app.getHttpServer())
      .get('/api/v1/internal/support/tickets')
      .set(SUPPORT_AUTH)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/internal/capabilities')
      .set(SUPPORT_AUTH)
      .expect((res) => expect([200, 404]).toContain(res.status));
  });

  it('OPERATOR (A2) remains allowed on the same SUPPORT-excluded routes, proving the per-controller enforcement is principal-type-specific, not a blanket workforce lockout', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/internal/limit-profiles')
      .set(OPERATOR)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/internal/products')
      .set(OPERATOR)
      .expect(200);
  });
});
