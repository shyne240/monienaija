/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01 — dedicated real-PostgreSQL, real-HTTP
 * proof suite.
 *
 * Implements the approved decisions from
 * docs/V1/V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md by wiring three new catalogue
 * functions onto the three catalogue gaps V1-ADMIN-AUTHORIZATION-CUSTOMER-READ-01 deliberately
 * left open:
 *   - `GET /customers/:id/addresses`           -> customer.view_address
 *   - `GET /customers/:id/contact-methods`     -> customer.view_contact_methods
 *   - `GET /customers/:id/identity-documents`  -> customer.view_identity_documents
 *
 * Follows the exact non-mocked pattern of
 * test/v1-admin-authorization-customer-read-01.integration.spec.ts and
 * test/v1-admin-authorization-kyc-01.integration.spec.ts: real bearer-token validation
 * (`A2WorkforceSessionService`), the real `RuntimeAccessGuard`/`RoutePolicyRegistry`, the real
 * `authorization_role_functions` catalogue (seeded by `AuthorizationCatalogueSeedService` from
 * `authorization-catalogue.seed.ts`), and the real `AuthorizationService.requireFunction()`
 * checks this task adds to `CustomerController`. Nothing authorization-relevant is mocked.
 *
 * Approved role matrix (docs/V1/V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-DECISION-01.md):
 *   customer.view_address / customer.view_contact_methods
 *     ALLOW: SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE
 *     DENY:  FINANCE_PREPARER, FINANCE_CONTROLLER, AGENT_NETWORK_MANAGER, RISK_FRAUD, TREASURY
 *   customer.view_identity_documents
 *     ALLOW: SUPER_ADMIN, COMPLIANCE only
 *     DENY:  everyone else, INCLUDING FINANCE_AUDITOR/OPERATIONS/CUSTOMER_SERVICE (unlike the
 *            two functions above)
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

function encodePbkdf2(password: string, saltStr = 'cust-pii-01-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-IMPLEMENTATION-01 — customer PII function authorization proof (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1admincustpii01');

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
    const principalId = `custpii01:${principalSuffix}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-admin-customer-pii-authorization-implementation-01:${principalId}:${roleKey}`,
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
        `cls-custpii01-${randomUUID().slice(0, 8)}`,
        `C01-${randomUUID().slice(0, 6)}`,
        'CUSTOMER-PII-01 Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-custpii01-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-custpii01');
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-pass-custpii01' })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function createActiveCustomer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-custpii01-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'CUSTOMER-PII-01 Test Customer'],
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
    const password = 'correct-password-custpii01';
    const hash = encodePbkdf2(password, 'customer-salt-custpii01');
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

  const PII_ROUTES: Array<{ name: string; functionCode: string; path: (id: string) => string }> = [
    { name: 'addresses', functionCode: 'customer.view_address', path: (id) => `/api/v1/customers/${id}/addresses` },
    {
      name: 'contact-methods',
      functionCode: 'customer.view_contact_methods',
      path: (id) => `/api/v1/customers/${id}/contact-methods`,
    },
    {
      name: 'identity-documents',
      functionCode: 'customer.view_identity_documents',
      path: (id) => `/api/v1/customers/${id}/identity-documents`,
    },
  ];

  const ADDRESS_CONTACT_ROUTES = PII_ROUTES.filter((r) => r.name !== 'identity-documents');
  const IDENTITY_DOCUMENTS_ROUTE = PII_ROUTES.find((r) => r.name === 'identity-documents')!;

  const ADDRESS_CONTACT_ALLOW_ROLES = ['SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS', 'COMPLIANCE', 'CUSTOMER_SERVICE'];
  const ADDRESS_CONTACT_DENY_ROLES = [
    'FINANCE_PREPARER',
    'FINANCE_CONTROLLER',
    'AGENT_NETWORK_MANAGER',
    'RISK_FRAUD',
    'TREASURY',
  ];
  const IDENTITY_DOCUMENTS_ALLOW_ROLES = ['SUPER_ADMIN', 'COMPLIANCE'];
  const IDENTITY_DOCUMENTS_DENY_ROLES = [
    'FINANCE_PREPARER',
    'FINANCE_CONTROLLER',
    'FINANCE_AUDITOR',
    'OPERATIONS',
    'AGENT_NETWORK_MANAGER',
    'RISK_FRAUD',
    'CUSTOMER_SERVICE',
    'TREASURY',
  ];

  async function tokenFor(roleKey: string): Promise<string> {
    return roleKey === 'SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(roleKey);
  }

  // =====================================================================================
  // A. Each endpoint enforces its own dedicated function
  // =====================================================================================

  describe('A. each endpoint enforces its own dedicated PII function', () => {
    for (const route of ADDRESS_CONTACT_ROUTES) {
      it.each(ADDRESS_CONTACT_ALLOW_ROLES)(
        `A1 [${route.name} -> ${route.functionCode}]. %s succeeds (holds the function)`,
        async (roleKey) => {
          const token = await tokenFor(roleKey);
          const customerId = await createActiveCustomer();
          const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
          expect(res.status).toBe(200);
          expect(Array.isArray(res.body)).toBe(true);
        },
      );

      it.each(ADDRESS_CONTACT_DENY_ROLES)(
        `A2 [${route.name} -> ${route.functionCode}]. %s is denied — 403 (does not hold the function)`,
        async (roleKey) => {
          const token = await tokenForRole(roleKey);
          const customerId = await createActiveCustomer();
          const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
          expect(res.status).toBe(403);
        },
      );
    }

    it.each(IDENTITY_DOCUMENTS_ALLOW_ROLES)(
      `A3 [identity-documents -> customer.view_identity_documents]. %s succeeds (holds the function)`,
      async (roleKey) => {
        const token = await tokenFor(roleKey);
        const customerId = await createActiveCustomer();
        const res = await request(app.getHttpServer())
          .get(IDENTITY_DOCUMENTS_ROUTE.path(customerId))
          .set(auth(token));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      },
    );

    it.each(IDENTITY_DOCUMENTS_DENY_ROLES)(
      `A4 [identity-documents -> customer.view_identity_documents]. %s is denied — 403`,
      async (roleKey) => {
        const token = await tokenForRole(roleKey);
        const customerId = await createActiveCustomer();
        const res = await request(app.getHttpServer())
          .get(IDENTITY_DOCUMENTS_ROUTE.path(customerId))
          .set(auth(token));
        expect(res.status).toBe(403);
      },
    );
  });

  // =====================================================================================
  // B. SUPER_ADMIN / COMPLIANCE access all three; proves no OPERATOR-type-only pass-through
  // =====================================================================================

  describe('B. SUPER_ADMIN and COMPLIANCE access all three PII endpoints', () => {
    it.each(['SUPER_ADMIN', 'COMPLIANCE'])('B1. %s succeeds on all three PII endpoints', async (roleKey) => {
      const token = await tokenFor(roleKey);
      const customerId = await createActiveCustomer();
      for (const route of PII_ROUTES) {
        const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
        expect(res.status).toBe(200);
      }
    });

    it('B2. FINANCE_AUDITOR succeeds on addresses/contact-methods but is denied identity-documents (narrower matrix proof)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const customerId = await createActiveCustomer();
      const addressRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/addresses`)
        .set(auth(token));
      expect(addressRes.status).toBe(200);
      const contactRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/contact-methods`)
        .set(auth(token));
      expect(contactRes.status).toBe(200);
      const identityRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/identity-documents`)
        .set(auth(token));
      expect(identityRes.status).toBe(403);
    });

    it('B3. OPERATIONS and CUSTOMER_SERVICE succeed on addresses/contact-methods but are denied identity-documents', async () => {
      for (const roleKey of ['OPERATIONS', 'CUSTOMER_SERVICE']) {
        const token = await tokenForRole(roleKey);
        const customerId = await createActiveCustomer();
        const addressRes = await request(app.getHttpServer())
          .get(`/api/v1/customers/${customerId}/addresses`)
          .set(auth(token));
        expect(addressRes.status).toBe(200);
        const identityRes = await request(app.getHttpServer())
          .get(`/api/v1/customers/${customerId}/identity-documents`)
          .set(auth(token));
        expect(identityRes.status).toBe(403);
      }
    });

    it('B4. a real AGENT bearer token is denied on all three PII endpoints (wrong principal type)', async () => {
      const token = await createAgentToken();
      const customerId = await createActiveCustomer();
      for (const route of PII_ROUTES) {
        const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
        expect([401, 403]).toContain(res.status);
      }
    });
  });

  // =====================================================================================
  // C. CUSTOMER self-service preserved
  // =====================================================================================

  describe('C. CUSTOMER self-service is unaffected by this task', () => {
    it.each(PII_ROUTES)('C1. $name: a real CUSTOMER session can still read its own sub-resource', async ({ path }) => {
      const { customerId, token } = await createCustomerWithLogin();
      const res = await request(app.getHttpServer()).get(path(customerId)).set(auth(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it.each(PII_ROUTES)(
      'C2. $name: a CUSTOMER session cannot read a DIFFERENT customer\'s sub-resource (pre-existing SELF scope, unaffected)',
      async ({ path }) => {
        const { token } = await createCustomerWithLogin();
        const otherCustomerId = await createActiveCustomer();
        const res = await request(app.getHttpServer()).get(path(otherCustomerId)).set(auth(token));
        expect(res.status).toBe(403);
      },
    );
  });

  // =====================================================================================
  // D. 401 vs 403 semantics
  // =====================================================================================

  describe('D. unauthenticated is 401; authorized-but-missing-function is 403 (never collapsed to 401)', () => {
    it.each(PII_ROUTES)('D1. $name: unauthenticated request is 401, not 403', async ({ path }) => {
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer()).get(path(customerId)).expect(401);
    });

    it('D2. a genuine workforce session lacking the function (TREASURY) gets 403 on all three, never 401', async () => {
      const token = await tokenForRole('TREASURY');
      const customerId = await createActiveCustomer();
      for (const route of PII_ROUTES) {
        const res = await request(app.getHttpServer()).get(route.path(customerId)).set(auth(token));
        expect(res.status).toBe(403);
      }
    });
  });

  // =====================================================================================
  // E. KYC-01 / Customer-Read-01 behavior unchanged by this task
  // =====================================================================================

  describe('E. KYC-01 / Customer-Read-01 behavior is unchanged by this task', () => {
    it('E1. GET /customers/:id and /customers/:id/profile still require customer.view (unaffected by the new PII functions)', async () => {
      const token = await tokenForRole('TREASURY');
      const customerId = await createActiveCustomer();
      const getRes = await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}`).set(auth(token));
      expect(getRes.status).toBe(403);
      const profileRes = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/profile`)
        .set(auth(token));
      expect(profileRes.status).toBe(403);
    });

    it('E2. GET /customers/:id/kyc still requires kyc.view (unaffected by the new PII functions)', async () => {
      const token = await tokenForRole('TREASURY');
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}/kyc`).set(auth(token));
      expect(res.status).toBe(403);
    });

    it('E3. COMPLIANCE (holds kyc.view) still passes authorization on GET /customers/:id/kyc (not 401/403; a fresh customer has no KYC assessment yet, so 404 is the correct business-logic outcome, not an authorization denial)', async () => {
      const token = await tokenForRole('COMPLIANCE');
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}/kyc`).set(auth(token));
      expect([200, 404]).toContain(res.status);
    });
  });
});
