/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 — dedicated real-PostgreSQL, real-HTTP proof suite.
 *
 * Follows the exact non-mocked pattern of
 * test/v1-admin-authorization-hardening-01.integration.spec.ts: real bearer-token validation
 * (`A2WorkforceSessionService`), the real `RuntimeAccessGuard`/`RoutePolicyRegistry`, the real
 * `authorization_role_functions` catalogue, and the real `AuthorizationService.requireFunction()`
 * checks this task adds to `OperationsController`. Nothing authorization-relevant is mocked.
 *
 * Covers:
 *   A. The three newly-migrated read endpoints (`/internal/metrics`, `/internal/diagnostics`,
 *      `/internal/outbox`) return 200 for the three catalogue roles that actually hold
 *      `metrics.view`/`diagnostics.view`/`outbox.view` (SUPER_ADMIN, FINANCE_AUDITOR,
 *      OPERATIONS) and 403 for every other V1 role (FINANCE_PREPARER, FINANCE_CONTROLLER,
 *      AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY).
 *   B. The 401-vs-403 distinction fixed in `AuthorizationService.requireFunction()` (§6):
 *      a genuinely unauthenticated caller gets 401 (`UNAUTHENTICATED`); a real AGENT bearer
 *      token on the same workforce-only route gets 403 at the guard level (pre-existing,
 *      unaffected by this task — RuntimeAccessGuard rejects a genuine Agent/Customer credential
 *      on a WORKFORCE_SESSION route before the controller is ever reached); and a real,
 *      correctly-typed-but-under-entitled workforce principal (FINANCE_AUDITOR,
 *      principal.type === 'OPERATOR', missing `customer.suspend`) now ALSO gets 403
 *      (`FUNCTION_MISSING`) rather than the pre-fix 401 — the exact defect this task corrects.
 *      The legacy PRINCIPAL_TYPE_DENIED-\u2192401 shim (preserved for a workforce-ISSUED session
 *      masquerading as the wrong principal type) is proven unchanged by the pre-existing
 *      test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts, not re-proven here.
 *   C. No mutation leakage via the OPERATOR collapse on the new read surface: a role that can
 *      read `/internal/metrics` (FINANCE_AUDITOR) still cannot perform migrated mutations
 *      (agent.suspend / customer.suspend) — `principal.type === 'OPERATOR'` continues to never
 *      substitute for a function grant, on the read surface exactly as it does not on the
 *      mutation surface Hardening-01 already proved.
 *   D. `/internal/audit` is deliberately left unmigrated (SUPPORT-blocked, see the class-level
 *      comment in operations.controller.ts) — any authenticated workforce session can still
 *      reach it, confirming this task did not accidentally restrict a capability out of scope.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, pbkdf2Sync } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';

function encodePbkdf2(password: string, saltStr = 'read-surface-01-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 — read surface + 401/403 authorization proof (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminauthreadsurf01');

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
    sessionService = moduleRef.get(A2WorkforceSessionService);
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

  // ---------------------------------------------------------------- session helpers (identical
  // pattern to v1-admin-authorization-hardening-01.integration.spec.ts)

  async function loginSuperAdmin(): Promise<string> {
    await localAdminService.seedDefaultAdmin({
      email: 'admin@monienaija.local',
      password: 'MonieNaijaAdmin123!',
    });
    const login = await request(app.getHttpServer())
      .post(LOGIN_PATH)
      .send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    if (login.status !== 201) {
      throw new Error(`SUPER_ADMIN login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }
    return login.body.accessToken as string;
  }

  async function tokenForRole(roleKey: string, principalSuffix = roleKey): Promise<string> {
    const principalId = `readsurf01:${principalSuffix}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-admin-authz-read-surface-01:${principalId}:${roleKey}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      assignedBy: 'test-harness',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as any);
    const result = await sessionService.establish({
      issuer: 'https://local-dev-identity.monienaija.invalid',
      subject: principalId,
      principalId,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'test-harness-key',
    });
    return result.accessToken;
  }

  // Real (non-mocked) AGENT session — a genuinely wrong principal TYPE for any workforce route,
  // independent of the workforce session service entirely (mirrors
  // test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts `createAgentToken()`).
  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-readsurf01-${randomUUID().slice(0, 8)}`,
        `RS01-${randomUUID().slice(0, 6)}`,
        'Read-Surface-01 Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-readsurf01-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-readsurf01');
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-pass-readsurf01' })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function createActiveCustomer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-readsurf01-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'Read-Surface-01 Test Customer'],
    );
    const phone = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `+234${phone}`, phone],
    );
    return customerId;
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  // =====================================================================================
  // A. Read surface — metrics / diagnostics / outbox migrated to catalogue function checks
  // =====================================================================================

  describe('A. /internal/metrics, /internal/diagnostics, /internal/outbox require metrics.view/diagnostics.view/outbox.view', () => {
    it('A1. SUPER_ADMIN can read all three (holds every function)', async () => {
      const token = await loginSuperAdmin();
      await request(app.getHttpServer()).get('/api/v1/internal/metrics').set(auth(token)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/internal/diagnostics').set(auth(token)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/internal/outbox').set(auth(token)).expect(200);
    });

    it('A2. FINANCE_AUDITOR can read all three (holds metrics.view/diagnostics.view/outbox.view)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      await request(app.getHttpServer()).get('/api/v1/internal/metrics').set(auth(token)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/internal/diagnostics').set(auth(token)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/internal/outbox').set(auth(token)).expect(200);
    });

    it('A3. OPERATIONS can read all three (holds metrics.view/diagnostics.view/outbox.view)', async () => {
      const token = await tokenForRole('OPERATIONS');
      await request(app.getHttpServer()).get('/api/v1/internal/metrics').set(auth(token)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/internal/diagnostics').set(auth(token)).expect(200);
      await request(app.getHttpServer()).get('/api/v1/internal/outbox').set(auth(token)).expect(200);
    });

    it.each(['FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'AGENT_NETWORK_MANAGER', 'COMPLIANCE', 'RISK_FRAUD', 'CUSTOMER_SERVICE', 'TREASURY'])(
      'A4. %s is denied all three (holds none of metrics.view/diagnostics.view/outbox.view)',
      async (roleKey) => {
        const token = await tokenForRole(roleKey);
        const metrics = await request(app.getHttpServer()).get('/api/v1/internal/metrics').set(auth(token));
        expect(metrics.status).toBe(403);
        const diagnostics = await request(app.getHttpServer()).get('/api/v1/internal/diagnostics').set(auth(token));
        expect(diagnostics.status).toBe(403);
        const outbox = await request(app.getHttpServer()).get('/api/v1/internal/outbox').set(auth(token));
        expect(outbox.status).toBe(403);
      },
    );

    it('A5. unauthenticated requests to all three return 401, not 403', async () => {
      await request(app.getHttpServer()).get('/api/v1/internal/metrics').expect(401);
      await request(app.getHttpServer()).get('/api/v1/internal/diagnostics').expect(401);
      await request(app.getHttpServer()).get('/api/v1/internal/outbox').expect(401);
    });
  });

  // =====================================================================================
  // B. 401-vs-403 distinction (§6 fix in AuthorizationService.requireFunction())
  // =====================================================================================

  describe('B. requireFunction() distinguishes UNAUTHENTICATED/PRINCIPAL_TYPE_DENIED (401) from FUNCTION_MISSING (403)', () => {
    it('B1. no bearer token on the customer lifecycle route returns 401 (UNAUTHENTICATED)', async () => {
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .send({ status: 'SUSPENDED', actor: 'no-token' });
      expect(res.status).toBe(401);
    });

    it('B2. a real AGENT session on the customer lifecycle route returns 403 (RuntimeAccessGuard rejects a genuine Agent/Customer token on a WORKFORCE_SESSION route as Forbidden before the controller is ever reached — pre-existing guard behaviour, unaffected by this task; see the "Agent not allowed on workforce route" branch in runtime-access.guard.ts). The legacy PRINCIPAL_TYPE_DENIED-\u2192401 shim this task preserves only fires for a workforce-ISSUED session typed as the wrong principal (a masquerade reaching the controller), proven unchanged by test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts ("2. Authorized workforce actor..." — workforce-SUPPORT masquerade \u2192 401).', async () => {
      const customerId = await createActiveCustomer();
      const agentToken = await createAgentToken();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(agentToken))
        .send({ status: 'SUSPENDED', actor: 'wrong-principal-type' });
      expect(res.status).toBe(403);
    });

    it('B3. a real FINANCE_AUDITOR workforce session (correct principal type, missing function) on the SAME customer lifecycle route returns 403 (FUNCTION_MISSING), not 401 — the exact FINANCE_AUDITOR defect this task fixes', async () => {
      const customerId = await createActiveCustomer();
      const token = await tokenForRole('FINANCE_AUDITOR');
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'SUSPENDED', actor: 'function-missing' });
      expect(res.status).toBe(403);
    });

    it('B4. the new read-surface gates apply the same distinction: no token is 401, a real under-entitled workforce session is 403', async () => {
      const unauthenticated = await request(app.getHttpServer()).get('/api/v1/internal/metrics');
      expect(unauthenticated.status).toBe(401);

      const token = await tokenForRole('TREASURY');
      const underEntitled = await request(app.getHttpServer()).get('/api/v1/internal/metrics').set(auth(token));
      expect(underEntitled.status).toBe(403);
    });
  });

  // =====================================================================================
  // C. No mutation leakage via the OPERATOR collapse on the new read surface
  // =====================================================================================

  describe('C. FINANCE_AUDITOR: read access on the new surface never substitutes for mutation authority', () => {
    it('C1. FINANCE_AUDITOR can read /internal/metrics but still cannot suspend a customer (customer.suspend) or provision a workforce user (workforce.user.create)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const customerId = await createActiveCustomer();

      const metrics = await request(app.getHttpServer()).get('/api/v1/internal/metrics').set(auth(token));
      expect(metrics.status).toBe(200);

      const suspendCustomer = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'SUSPENDED', actor: 'should-be-denied' });
      expect(suspendCustomer.status).toBe(403);

      const provisionWorkforce = await request(app.getHttpServer())
        .post('/api/v1/internal/admin/support/workforce-users')
        .set(auth(token))
        .send({ username: `should-be-denied-${Date.now()}` });
      expect(provisionWorkforce.status).toBe(403);
    });
  });

  // =====================================================================================
  // D. /internal/audit is deliberately NOT migrated (SUPPORT-blocked, documented gap)
  // =====================================================================================

  describe('D. /internal/audit remains unmigrated by design (out of scope — SUPPORT is not catalogue-governed)', () => {
    it('D1. any authenticated workforce session (even one holding none of the new read functions) can still reach /internal/audit, confirming this task did not narrow it', async () => {
      const token = await tokenForRole('TREASURY');
      const res = await request(app.getHttpServer()).get('/api/v1/internal/audit?limit=1').set(auth(token));
      expect(res.status).toBe(200);
    });
  });
});
