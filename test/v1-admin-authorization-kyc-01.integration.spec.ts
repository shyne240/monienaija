/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMIN-AUTHORIZATION-KYC-01 — dedicated real-PostgreSQL, real-HTTP proof suite.
 *
 * Follows the exact non-mocked pattern of
 * test/v1-admin-authorization-read-surface-01.integration.spec.ts: real bearer-token validation
 * (`A2WorkforceSessionService`), the real `RuntimeAccessGuard`/`RoutePolicyRegistry`, the real
 * `authorization_role_functions` catalogue, and the real `AuthorizationService.requireFunction()`
 * checks this task adds to `CustomerController.getKyc`/`createKycAssessment`. Nothing
 * authorization-relevant is mocked.
 *
 * Covers (Decision 5 + task spec requirements):
 *   A. `GET /customers/:id/kyc` requires `kyc.view` — SUPER_ADMIN, COMPLIANCE, and
 *      FINANCE_AUDITOR (the three catalogue-assigned roles) succeed (200/404 — never 401/403);
 *      every other V1 role is denied with 403.
 *   B. `POST /customers/:id/kyc-assessment` requires a function derived from `dto.status`:
 *      PENDING/NOT_STARTED → `kyc.review`, APPROVED → `kyc.approve`, REJECTED → `kyc.reject`.
 *      Only SUPER_ADMIN and COMPLIANCE hold all three decision functions; FINANCE_AUDITOR holds
 *      none of them (view-only) and is denied all three; every other V1 role is denied all three.
 *   C. `kyc.approve` and `kyc.reject` are strictly distinct — a principal holding one must not
 *      be able to use the other (proven by granting a principal ONLY one of the two catalogue
 *      functions directly, bypassing role bundles entirely, and checking the other is denied).
 *   D. RISK_FRAUD remains fully denied on every KYC function (no KYC/AML expansion).
 *   E. Unauthenticated requests get 401 on both routes, never 403.
 *   F. CUSTOMER self-access is unaffected by this change: a real CUSTOMER session accessing its
 *      own `/kyc` still reaches the service layer (no function required for CUSTOMER), and a
 *      CUSTOMER accessing a DIFFERENT customer's `/kyc` is still denied by the pre-existing
 *      `customerAccess: 'SELF'` route-policy check (unaffected by this task).
 *   G. Business behavior is unchanged: a SUPER_ADMIN's real KYC assessment creation still
 *      persists via the real service and is reflected on a subsequent `GET /kyc`.
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

function encodePbkdf2(password: string, saltStr = 'kyc-01-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-ADMIN-AUTHORIZATION-KYC-01 — KYC function authorization proof (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminauthkyc01');

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
  // pattern to v1-admin-authorization-read-surface-01.integration.spec.ts)

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
    const principalId = `kyc01:${principalSuffix}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-admin-authz-kyc-01:${principalId}:${roleKey}`,
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

  // Real (non-mocked) AGENT session — a genuinely wrong principal TYPE for this workforce-gated
  // route surface.
  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-kyc01-${randomUUID().slice(0, 8)}`,
        `K01-${randomUUID().slice(0, 6)}`,
        'KYC-01 Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-kyc01-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-kyc01');
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-pass-kyc01' })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function createActiveCustomer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-kyc01-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'KYC-01 Test Customer'],
    );
    const phone = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `+234${phone}`, phone],
    );
    return customerId;
  }

  // Real customer login (matches the established pattern in
  // s-fix-01-customer-lifecycle-authorization.integration.spec.ts): creates a real password
  // credential for the customer and logs in via the real `POST /customers/sessions` endpoint,
  // exercising the exact same RuntimeAccessGuard CUSTOMER-resolution branch production traffic
  // uses. No mocked session/principal.
  async function createCustomerWithLogin(): Promise<{ customerId: string; token: string }> {
    const customerId = await createActiveCustomer();
    const password = 'correct-password-kyc01';
    const hash = encodePbkdf2(password, 'customer-salt-kyc01');
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

  const NON_KYC_ROLES = [
    'FINANCE_PREPARER',
    'FINANCE_CONTROLLER',
    'OPERATIONS',
    'AGENT_NETWORK_MANAGER',
    'RISK_FRAUD',
    'CUSTOMER_SERVICE',
    'TREASURY',
  ];

  // =====================================================================================
  // A. GET /customers/:id/kyc requires kyc.view
  // =====================================================================================

  describe('A. GET /customers/:id/kyc requires kyc.view', () => {
    it('A1. SUPER_ADMIN can read KYC state (holds kyc.view)', async () => {
      const token = await loginSuperAdmin();
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token));
      // No assessment exists yet for a freshly created customer — must be 404 (business logic),
      // never 401/403 (authorization), proving the function check passed.
      expect(res.status).toBe(404);
    });

    it('A2. COMPLIANCE can read KYC state (holds kyc.view)', async () => {
      const token = await tokenForRole('COMPLIANCE');
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token));
      expect(res.status).toBe(404);
    });

    it('A3. FINANCE_AUDITOR can read KYC state (holds kyc.view)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token));
      expect(res.status).toBe(404);
    });

    it.each(NON_KYC_ROLES)('A4. %s is denied (does not hold kyc.view) — 403', async (roleKey) => {
      const token = await tokenForRole(roleKey);
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token));
      expect(res.status).toBe(403);
    });

    it('A5. unauthenticated request is 401, not 403', async () => {
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}/kyc`).expect(401);
    });

    it('A6. a real AGENT bearer token is denied on this route (wrong principal type)', async () => {
      const token = await createAgentToken();
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token));
      expect([401, 403]).toContain(res.status);
    });
  });

  // =====================================================================================
  // B. POST /customers/:id/kyc-assessment requires kyc.review/kyc.approve/kyc.reject
  // =====================================================================================

  describe('B. POST /customers/:id/kyc-assessment requires the status-derived function', () => {
    function reviewBody(status: string) {
      return {
        level: 'LEVEL_1',
        status,
        assessedBy: 'kyc-01-test-harness',
      };
    }

    // CustomerService.assertKycTransition (pure business logic, untouched by this task) only
    // allows NOT_STARTED->PENDING, PENDING->APPROVED|REJECTED, and APPROVED|REJECTED->PENDING
    // (a decision can always be revisited via a fresh review, but APPROVED cannot go directly
    // to REJECTED or vice versa). These sequences respect that state machine throughout.
    it('B1. SUPER_ADMIN can review, approve, and reject (holds all three)', async () => {
      const token = await loginSuperAdmin();
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('PENDING'))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('APPROVED'))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('PENDING'))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('REJECTED'))
        .expect(201);
    });

    it('B2. COMPLIANCE can review, approve, and reject (holds all three)', async () => {
      const token = await tokenForRole('COMPLIANCE');
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('PENDING'))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('APPROVED'))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('PENDING'))
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('REJECTED'))
        .expect(201);
    });

    it('B3. FINANCE_AUDITOR (view-only) is denied review, approve, and reject', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const customerId = await createActiveCustomer();
      const review = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('PENDING'));
      expect(review.status).toBe(403);
      const approve = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('APPROVED'));
      expect(approve.status).toBe(403);
      const reject = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('REJECTED'));
      expect(reject.status).toBe(403);
    });

    it.each(NON_KYC_ROLES)('B4. %s is denied review, approve, and reject', async (roleKey) => {
      const token = await tokenForRole(roleKey);
      const customerId = await createActiveCustomer();
      const review = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('PENDING'));
      expect(review.status).toBe(403);
      const approve = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('APPROVED'));
      expect(approve.status).toBe(403);
      const reject = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send(reviewBody('REJECTED'));
      expect(reject.status).toBe(403);
    });

    it('B5. unauthenticated request is 401, not 403', async () => {
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .send(reviewBody('PENDING'))
        .expect(401);
    });
  });

  // =====================================================================================
  // C. kyc.approve and kyc.reject are strictly distinct functions
  // =====================================================================================

  describe('C. kyc.approve and kyc.reject never conflate', () => {
    // Grant ONLY kyc.approve directly on the catalogue, bypassing any role bundle entirely, to
    // prove the controller checks the exact function for the exact request and never the
    // sibling decision function.
    async function tokenWithOnlyFunction(functionCode: 'kyc.approve' | 'kyc.reject'): Promise<string> {
      const principalId = `kyc01:onlyfn:${functionCode}:${randomUUID()}`.slice(0, 160);
      const now = new Date();
      // A synthetic role scoped to this test only, carrying exactly one of the two catalogue
      // decision functions (via a dedicated `authorization_roles` + `authorization_role_functions`
      // row pair), never both — proves the controller checks the exact function for the exact
      // request rather than any broader role-level grant.
      const roleKey = `KYC01_ONLY_${functionCode === 'kyc.approve' ? 'APPROVE' : 'REJECT'}`;
      const roleRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO authorization_roles (role_key, display_name, description, is_active, is_system_seeded)
         VALUES ($1,$2,'KYC-01 test-only single-function role', true, false)
         RETURNING id`,
        [roleKey, `KYC-01 ${functionCode} only`],
      );
      const roleId = roleRows[0]!.id;
      await dataSource.query(
        `INSERT INTO authorization_role_functions (role_id, function_code, access_type, is_active, assigned_by)
         VALUES ($1,$2,'EXECUTE', true, 'test-harness')`,
        [roleId, functionCode],
      );
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `v1-admin-authz-kyc-01:${principalId}:${roleKey}`,
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

    // CustomerService.assertKycTransition (pure business logic, untouched) requires passing
    // through PENDING before an APPROVED/REJECTED decision, and again before flipping from one
    // decision to the other (APPROVED->REJECTED / REJECTED->APPROVED is never a direct
    // transition). A real SUPER_ADMIN session (holding kyc.review) performs ONLY the PENDING
    // review steps here, so that the single-function principal under test is exercised ONLY on
    // its one decision function, with the authorization check (not the business-rule check)
    // being the thing proven to deny the sibling decision.
    it('C1. a principal holding ONLY kyc.approve can approve but is denied reject', async () => {
      const superAdminToken = await loginSuperAdmin();
      const token = await tokenWithOnlyFunction('kyc.approve');
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(superAdminToken))
        .send({ level: 'LEVEL_1', status: 'PENDING', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send({ level: 'LEVEL_1', status: 'APPROVED', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      // Reset to PENDING (a business-valid transition from APPROVED) so the next attempt is
      // denied by AUTHORIZATION, never by the unrelated business-rule conflict.
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(superAdminToken))
        .send({ level: 'LEVEL_1', status: 'PENDING', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      const reject = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send({ level: 'LEVEL_1', status: 'REJECTED', assessedBy: 'kyc-01-test-harness' });
      expect(reject.status).toBe(403);
    });

    it('C2. a principal holding ONLY kyc.reject can reject but is denied approve', async () => {
      const superAdminToken = await loginSuperAdmin();
      const token = await tokenWithOnlyFunction('kyc.reject');
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(superAdminToken))
        .send({ level: 'LEVEL_1', status: 'PENDING', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send({ level: 'LEVEL_1', status: 'REJECTED', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(superAdminToken))
        .send({ level: 'LEVEL_1', status: 'PENDING', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      const approve = await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send({ level: 'LEVEL_1', status: 'APPROVED', assessedBy: 'kyc-01-test-harness' });
      expect(approve.status).toBe(403);
    });
  });

  // =====================================================================================
  // D. RISK_FRAUD stays fully denied (no KYC/AML expansion)
  // =====================================================================================

  describe('D. RISK_FRAUD is fully denied on every KYC function', () => {
    it('D1. RISK_FRAUD cannot view, review, approve, or reject', async () => {
      const token = await tokenForRole('RISK_FRAUD');
      const customerId = await createActiveCustomer();
      const view = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token));
      expect(view.status).toBe(403);
      for (const status of ['PENDING', 'APPROVED', 'REJECTED']) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/customers/${customerId}/kyc-assessment`)
          .set(auth(token))
          .send({ level: 'LEVEL_1', status, assessedBy: 'kyc-01-test-harness' });
        expect(res.status).toBe(403);
      }
    });
  });

  // =====================================================================================
  // F. CUSTOMER self-access is unaffected
  // =====================================================================================

  describe('F. CUSTOMER self-access is unaffected by the new function checks', () => {
    it('F1. a real CUSTOMER session reading its own /kyc reaches the service layer (404, not 401/403)', async () => {
      const { customerId, token } = await createCustomerWithLogin();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token));
      // No assessment yet — proves the CUSTOMER request reached the (unchanged) service layer
      // rather than being blocked by the new function check (which would be 403).
      expect(res.status).toBe(404);
    });

    it('F2. a real CUSTOMER session reading a DIFFERENT customer\'s /kyc is still denied (pre-existing SELF policy, unaffected)', async () => {
      const { token } = await createCustomerWithLogin();
      const otherCustomerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${otherCustomerId}/kyc`)
        .set(auth(token));
      expect([401, 403]).toContain(res.status);
    });
  });

  // =====================================================================================
  // G. Business behavior unchanged — SUPER_ADMIN's real assessment persists end-to-end
  // =====================================================================================

  describe('G. business behavior unchanged — assessment persists and is readable', () => {
    it('G1. SUPER_ADMIN creates a PENDING assessment, then an APPROVED one, and GET /kyc reflects the latest', async () => {
      const token = await loginSuperAdmin();
      const customerId = await createActiveCustomer();
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send({ level: 'LEVEL_1', status: 'PENDING', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/customers/${customerId}/kyc-assessment`)
        .set(auth(token))
        .send({ level: 'LEVEL_2', status: 'APPROVED', assessedBy: 'kyc-01-test-harness' })
        .expect(201);
      const current = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customerId}/kyc`)
        .set(auth(token))
        .expect(200);
      expect(current.body.status).toBe('APPROVED');
      expect(current.body.level).toBe('LEVEL_2');
    });
  });
});
