/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01 — dedicated real-PostgreSQL, real-HTTP proof suite.
 *
 * Follows the exact non-mocked pattern of
 * test/v1-admin-authorization-kyc-01.integration.spec.ts: real bearer-token validation
 * (`A2WorkforceSessionService`), the real `RuntimeAccessGuard`/`RoutePolicyRegistry`, the real
 * `authorization_role_functions` catalogue, and the real `AuthorizationService.requireFunction()`
 * checks this task adds to `CustomerController.list`/`get`/`getProfile`. Nothing
 * authorization-relevant is mocked.
 *
 * Covers (task spec requirements):
 *   A. `GET /customers`, `GET /customers/:id`, `GET /customers/:id/profile` require
 *      `customer.view` — SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE
 *      (the five catalogue-assigned roles) succeed; every other V1 role is denied with 403.
 *   B. FINANCE_AUDITOR succeeds (explicitly catalogue-assigned `customer.view` — proven
 *      separately from the generic allow-list to document it is NOT an accidental
 *      OPERATOR-type grant).
 *   C. Unauthenticated requests get 401 on all three routes, never 403.
 *   D. CUSTOMER self-access is unaffected: a real CUSTOMER session reading its own
 *      `/customers/:id` and `/customers/:id/profile` still succeeds with no function required,
 *      and reading a DIFFERENT customer's record is still denied by the pre-existing
 *      `customerAccess: 'SELF'` route-policy check (unaffected by this task).
 *   E. (AMENDED by V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01) `/addresses`,
 *      `/contact-methods`, `/identity-documents` were deliberately left unmigrated by THIS
 *      task (no catalogue function existed for them at the time) and were proven reachable by
 *      any OPERATOR/SERVICE/PRIVILEGED principal regardless of `customer.view`. A later,
 *      separately-approved task (V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01) closed
 *      that catalogue gap with dedicated `customer.view_address` / `.view_contact_methods` /
 *      `.view_identity_documents` functions. Section D below is updated accordingly (TREASURY,
 *      which never holds any of the three new functions, is now correctly denied 403 instead
 *      of reaching 200) — see
 *      test/v1-admin-customer-pii-authorization-implementation-01.integration.spec.ts for the
 *      full dedicated proof suite. CUSTOMER self-service (D3) and unauthenticated 401 (D2) are
 *      unaffected and still verified here.
 *   F. No function is accidentally granted to an unrelated role — FINANCE_PREPARER,
 *      FINANCE_CONTROLLER, AGENT_NETWORK_MANAGER, RISK_FRAUD, TREASURY are denied on all three
 *      migrated routes despite being genuine, fully-authenticated OPERATOR-type workforce
 *      sessions (no FUNCTION_MISSING -> 401 collapse: these are 403s).
 *   G. A real AGENT bearer token remains denied (wrong principal type), unaffected.
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

function encodePbkdf2(password: string, saltStr = 'cust-read-01-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01 — customer read function authorization proof (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminauthcustread01');

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
    const principalId = `custread01:${principalSuffix}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-admin-authz-customer-read-01:${principalId}:${roleKey}`,
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

  // Real (non-mocked) AGENT session — a genuinely wrong principal TYPE for this surface.
  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-custread01-${randomUUID().slice(0, 8)}`,
        `C01-${randomUUID().slice(0, 6)}`,
        'CUSTOMER-READ-01 Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-custread01-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-custread01');
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-pass-custread01' })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function createActiveCustomer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-custread01-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'CUSTOMER-READ-01 Test Customer'],
    );
    const phone = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `+234${phone}`, phone],
    );
    return customerId;
  }

  async function createCustomerWithLogin(): Promise<{ customerId: string; token: string }> {
    const customerId = await createActiveCustomer();
    const password = 'correct-password-custread01';
    const hash = encodePbkdf2(password, 'customer-salt-custread01');
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    const token = res.body.accessToken as string;
    return { customerId, token };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const CUSTOMER_VIEW_ROLES = ['SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS', 'COMPLIANCE', 'CUSTOMER_SERVICE'];
  const NON_CUSTOMER_VIEW_ROLES = [
    'FINANCE_PREPARER',
    'FINANCE_CONTROLLER',
    'AGENT_NETWORK_MANAGER',
    'RISK_FRAUD',
    'TREASURY',
  ];

  const MIGRATED_ROUTES: Array<{ name: string; path: (id: string) => string }> = [
    { name: 'GET /customers/:id', path: (id) => `/api/v1/customers/${id}` },
    { name: 'GET /customers/:id/profile', path: (id) => `/api/v1/customers/${id}/profile` },
  ];

  // =====================================================================================
  // A. Migrated per-customer routes require customer.view
  // =====================================================================================

  for (const route of MIGRATED_ROUTES) {
    describe(`A. ${route.name} requires customer.view`, () => {
      it.each(CUSTOMER_VIEW_ROLES)(`A1 [${route.name}]. %s succeeds (holds customer.view)`, async (roleKey) => {
        const token = roleKey === 'SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(roleKey);
        const customerId = await createActiveCustomer();
        const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
        expect(res.status).toBe(200);
      });

      it.each(NON_CUSTOMER_VIEW_ROLES)(
        `A2 [${route.name}]. %s is denied (does not hold customer.view) — 403`,
        async (roleKey) => {
          const token = await tokenForRole(roleKey);
          const customerId = await createActiveCustomer();
          const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
          expect(res.status).toBe(403);
        },
      );

      it(`A3 [${route.name}]. unauthenticated request is 401, not 403`, async () => {
        const customerId = await createActiveCustomer();
        await request(app.getHttpServer()).get(route.path(customerId)).expect(401);
      });

      it(`A4 [${route.name}]. a real AGENT bearer token is denied (wrong principal type)`, async () => {
        const token = await createAgentToken();
        const customerId = await createActiveCustomer();
        const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
        expect([401, 403]).toContain(res.status);
      });
    });
  }

  it('A5. GET /customers (list) requires customer.view for workforce principals; SUPER_ADMIN succeeds', async () => {
    const token = await loginSuperAdmin();
    await createActiveCustomer();
    const res = await request(app.getHttpServer()).get('/api/v1/customers').set(auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it.each(NON_CUSTOMER_VIEW_ROLES)('A6. GET /customers (list) denies %s (does not hold customer.view) — 403', async (roleKey) => {
    const token = await tokenForRole(roleKey);
    const res = await request(app.getHttpServer()).get('/api/v1/customers').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('A7. GET /customers (list) unauthenticated is 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/customers').expect(401);
  });

  // =====================================================================================
  // B. FINANCE_AUDITOR proof — not an accidental OPERATOR-type grant
  // =====================================================================================

  describe('B. FINANCE_AUDITOR is explicitly catalogue-assigned customer.view (not an OPERATOR-type collapse)', () => {
    it('B1. FINANCE_AUDITOR succeeds on GET /customers/:id and /profile', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const customerId = await createActiveCustomer();
      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}`)
        .set(auth(token));
      expect(getRes.status).toBe(200);
      const profileRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/profile`)
        .set(auth(token));
      expect(profileRes.status).toBe(200);
    });

    it('B2. FINANCE_CONTROLLER (another FINANCE_* / OPERATOR-type role) is still denied — proves no generic OPERATOR-type pass-through', async () => {
      const token = await tokenForRole('FINANCE_CONTROLLER');
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}`)
        .set(auth(token));
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // C. CUSTOMER self-service preserved
  // =====================================================================================

  describe('C. CUSTOMER self-service is unaffected by this task', () => {
    it('C1. a real CUSTOMER session reads its own /customers/:id with no function required', async () => {
      const { customerId, token } = await createCustomerWithLogin();
      const res = await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}`).set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(customerId);
    });

    it('C2. a real CUSTOMER session reads its own /customers/:id/profile with no function required', async () => {
      const { customerId, token } = await createCustomerWithLogin();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/profile`)
        .set(auth(token));
      expect(res.status).toBe(200);
    });

    it('C3. a CUSTOMER session cannot read a DIFFERENT customer via /customers/:id (pre-existing SELF scope, unaffected)', async () => {
      const { token } = await createCustomerWithLogin();
      const otherCustomerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${otherCustomerId}`)
        .set(auth(token));
      expect(res.status).toBe(403);
    });

    it('C4. a CUSTOMER session cannot read a DIFFERENT customer via /customers/:id/profile (pre-existing SELF scope, unaffected)', async () => {
      const { token } = await createCustomerWithLogin();
      const otherCustomerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${otherCustomerId}/profile`)
        .set(auth(token));
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // D. Non-migrated endpoints retain their exact pre-existing behavior
  // =====================================================================================

  describe('D. /addresses, /contact-methods, /identity-documents (AMENDED by V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01 — now function-gated; see that task\'s dedicated suite)', () => {
    const NOT_MIGRATED = [
      { name: 'addresses', path: (id: string) => `/api/v1/customers/${id}/addresses` },
      { name: 'contact-methods', path: (id: string) => `/api/v1/customers/${id}/contact-methods` },
      { name: 'identity-documents', path: (id: string) => `/api/v1/customers/${id}/identity-documents` },
    ];

    it.each(NOT_MIGRATED)(
      'D1. $name now denies a workforce role lacking its dedicated PII function (e.g. TREASURY) — 403 (AMENDED by V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01)',
      async ({ path }) => {
        const token = await tokenForRole('TREASURY');
        const customerId = await createActiveCustomer();
        const res = await request(app.getHttpServer()).get(path(customerId)).set(auth(token));
        // TREASURY does not hold customer.view_address/.view_contact_methods/
        // .view_identity_documents in the approved role matrix — correctly denied 403.
        expect(res.status).toBe(403);
      },
    );

    it.each(NOT_MIGRATED)('D2. $name unauthenticated is still 401 (route-policy gate unaffected)', async ({ path }) => {
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer()).get(path(customerId)).expect(401);
    });

    it.each(NOT_MIGRATED)(
      'D3. $name: a real CUSTOMER session can still read its own sub-resource (self-service unaffected)',
      async ({ path }) => {
        const { customerId, token } = await createCustomerWithLogin();
        const res = await request(app.getHttpServer()).get(path(customerId)).set(auth(token));
        expect(res.status).toBe(200);
      },
    );
  });
});
