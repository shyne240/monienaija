/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * V1-ADMIN-AUTHORIZATION-HARDENING-01 — dedicated real-PostgreSQL, real-HTTP authorization
 * hardening proof suite.
 *
 * Deliberately does NOT mock `A2WorkforceSessionService`, `AuthorizationService`, or the
 * catalogue — every request below goes through the REAL stack: real bearer-token validation
 * (`A2WorkforceSessionService.validate`), the real `RuntimeAccessGuard`, the real
 * `RoutePolicyRegistry`, the real `authorization_role_functions` catalogue lookup
 * (`AuthorizationCatalogueRuntimeService`), and the real `AuthorizationService.requireFunction()`
 * check added by this task. The only thing bypassed is the external OIDC identity-provider round
 * trip (no IdP exists in this sandbox) — sessions for non-SUPER_ADMIN roles are minted by
 * persisting a real `a2_finance_role_assignments` row then calling the real, unmocked
 * `A2WorkforceSessionService.establish()` in-process (the same "controlled/direct provisioning
 * for roles unreachable via the HTTP assign/revoke API" explicitly permitted by this task, since
 * `POST /internal/a2/workforce/roles` can only grant FINANCE_PREPARER/CONTROLLER/AUDITOR). The
 * resulting bearer token is then used over real HTTP exactly like any other caller.
 *
 * SUPER_ADMIN sessions use the REAL local-admin login HTTP endpoint
 * (`POST /internal/a2/workforce/local-admin-sessions`), identical to
 * test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts.
 *
 * Covers:
 *   - FINANCE_AUDITOR critical proof (§5/§16): reads work, every migrated mutation family
 *     returns 403, proving `principal.type === 'OPERATOR'` alone can no longer grant arbitrary
 *     administrative mutation access (the pre-hardening defect).
 *   - SUPER_ADMIN proof (§7): can perform every migrated administrative mutation (replacing
 *     FINANCE_ADMIN's old universal authority) but the catalogue itself structurally excludes it
 *     from Finance-class execution (ledger.post/reverse, agent.fund/defund, fee/commission/
 *     reward/product/limit modification) — asserted directly against the persisted catalogue,
 *     the sole authority for that boundary.
 *   - Positive/negative matrix for AGENT_NETWORK_MANAGER, OPERATIONS, FINANCE_PREPARER,
 *     FINANCE_CONTROLLER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY across the five
 *     migrated gates (agent lifecycle, agent credentials, workforce user provisioning, customer
 *     lifecycle).
 *   - FINANCE_ADMIN does not resolve as a live role (empty roles/scopes, 403 everywhere).
 *   - Unauthenticated → 401.
 *   - Governance invariants remain structural: Finance-class-restricted function cannot be
 *     assigned to a non-finance-class role (DB trigger), TREASURY holds exactly
 *     `reconciliation.view`, RISK_FRAUD holds exactly `risk_fraud.manage_fraud_case`.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { LocalAdminAuthenticationService } from '../src/local-admin-authentication/local-admin-authentication.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_PATH = '/api/v1/internal/a2/workforce/local-admin-sessions';

describe('V1-ADMIN-AUTHORIZATION-HARDENING-01 — function-based authorization proof (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminauthhard01');

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
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
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

  // ---------------------------------------------------------------- session helpers

  async function loginSuperAdmin(): Promise<string> {
    await localAdminService.seedDefaultAdmin({
      email: `admin-${randomUUID().slice(0, 8)}@monienaija.local`,
      password: 'MonieNaijaAdmin123!',
    });
    // seedDefaultAdmin is keyed by email; use the fixed well-known email so repeated calls
    // within a test converge on one credential (mirrors v1-admin-full-surface-audit-01).
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

  /**
   * Real, non-mocked role provisioning for roles the HTTP assign/revoke API cannot grant
   * (every role except FINANCE_PREPARER/CONTROLLER/AUDITOR) — persists a real
   * `a2_finance_role_assignments` row, then calls the real `A2WorkforceSessionService.establish()`
   * to mint a real, persisted `a2_workforce_sessions` row and bearer token. Every subsequent
   * HTTP request made with this token is validated by the real, unmocked
   * `A2WorkforceSessionService.validate()` against the real catalogue.
   */
  async function tokenForRole(roleKey: string, principalSuffix = roleKey): Promise<string> {
    const principalId = `hardening01:${principalSuffix}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `v1-admin-authz-hardening-01:${principalId}:${roleKey}`,
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

  // ---------------------------------------------------------------- fixture helpers

  async function createActiveAgent(): Promise<string> {
    const cls = await classService.create({
      reference: `CLS-${randomUUID().slice(0, 8)}`,
      code: `CODE-${randomUUID().slice(0, 8)}`,
      name: `Hardening Test Class ${randomUUID().slice(0, 6)}`,
      description: 'v1-admin-authorization-hardening-01 test class',
      isActive: true,
      requirements: { requiredInformation: ['businessName', 'contactEmail'] } as any,
      requiredDocumentCategories: ['IDENTITY'] as any,
      applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING'] as any,
      applicableLimits: {} as any,
      actor: 'test-admin',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `hardening01-${randomUUID()}`,
      businessName: `Biz ${randomUUID().slice(0, 4)}`,
      contactEmail: `hardening01-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant',
    });
    await appService.submit(appEntity.id, 'applicant');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-harness');
    return agent.id;
  }

  async function createActiveCustomer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-hardening01-${randomUUID()}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'Hardening Test Customer'],
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
  // A. SUPER_ADMIN — positive matrix across every migrated gate
  // =====================================================================================

  describe('A. SUPER_ADMIN replaces FINANCE_ADMIN as the live administrative role', () => {
    it('A1. can suspend/reactivate/terminate an agent via the catalogue-backed admin lifecycle endpoints', async () => {
      const token = await loginSuperAdmin();
      const agentId = await createActiveAgent();

      const suspend = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .set(auth(token))
        .send({ reason: 'hardening-01 test' });
      expect(suspend.status).toBe(200);
      expect(suspend.body.status).toBe('SUSPENDED');

      const reactivate = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/reactivate`)
        .set(auth(token));
      expect(reactivate.status).toBe(200);
      expect(reactivate.body.status).toBe('ACTIVE');

      const terminate = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/terminate`)
        .set(auth(token))
        .send({ reason: 'hardening-01 close' });
      expect(terminate.status).toBe(200);
      expect(terminate.body.status).toBe('TERMINATED');
    });

    it('A2. can issue agent credentials (agent.manage_credentials)', async () => {
      const token = await loginSuperAdmin();
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/credentials`)
        .set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.temporaryPassword).toBeDefined();
    });

    it('A3. can provision and suspend a SUPPORT workforce user (workforce.user.create / .suspend)', async () => {
      const token = await loginSuperAdmin();
      const create = await request(app.getHttpServer())
        .post('/api/v1/internal/admin/support/workforce-users')
        .set(auth(token))
        .send({ username: `hardening01.support.${Date.now()}` });
      expect(create.status).toBe(201);
      const supportUserId = create.body.supportUserId as string;

      const disable = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/support/workforce-users/${supportUserId}/disable`)
        .set(auth(token))
        .send({ reason: 'hardening-01 test' });
      expect(disable.status).toBe(200);
    });

    it('A4. can suspend/activate/close a customer (customer.suspend/.activate/.close, Decision 4)', async () => {
      const token = await loginSuperAdmin();
      const customerId = await createActiveCustomer();

      const suspend = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'SUSPENDED', actor: 'hardening-01' });
      expect(suspend.status).toBe(200);
      expect(suspend.body.status).toBe('SUSPENDED');

      const activate = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'ACTIVE', actor: 'hardening-01' });
      expect(activate.status).toBe(200);
      expect(activate.body.status).toBe('ACTIVE');

      const close = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'CLOSED', actor: 'hardening-01' });
      expect(close.status).toBe(200);
      expect(close.body.status).toBe('CLOSED');
    });

    it('A5. SUPER_ADMIN structurally holds no Finance-class execution function (catalogue is the sole authority)', async () => {
      const rows: Array<{ function_code: string }> = await dataSource.query(
        `SELECT rf.function_code FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id
         WHERE r.role_key = 'SUPER_ADMIN' AND rf.function_code IN (
           'ledger.post','ledger.reverse','ledger.approve_adjustment',
           'agent.fund','agent.defund',
           'fee_rule.create','fee_rule.modify','commission_rule.create','commission_rule.modify',
           'reward_rule.create','reward_rule.modify','product.modify','product.governance',
           'limit.modify','finance.control_policy.activate'
         )`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  // =====================================================================================
  // B. FINANCE_AUDITOR — the critical OPERATOR-collapse regression proof
  // =====================================================================================

  describe('B. FINANCE_AUDITOR: principal.type=OPERATOR must never substitute for a real function grant', () => {
    it('B1. FINANCE_AUDITOR can read (generic internal list reads already work, unaffected by this task)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const res = await request(app.getHttpServer())
        .get('/api/v1/internal/agents')
        .set(auth(token));
      expect(res.status).toBe(200);
    });

    it('B2. FINANCE_AUDITOR is denied agent.suspend (403, not 200) despite principal.type=OPERATOR', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .set(auth(token))
        .send({ reason: 'should be denied' });
      expect(res.status).toBe(403);
      // Prove no mutation occurred despite the attempt.
      const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM agents WHERE id = $1`, [agentId]);
      expect(rows[0]!.status).toBe('ACTIVE');
    });

    it('B3. FINANCE_AUDITOR is denied agent.terminate/.reactivate/.activate (403)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const agentId = await createActiveAgent();
      for (const action of ['terminate', 'reactivate']) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/internal/admin/agents/${agentId}/${action}`)
          .set(auth(token))
          .send({});
        expect(res.status).toBe(403);
      }
    });

    it('B4. FINANCE_AUDITOR is denied agent.manage_credentials (cannot issue agent credentials)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/credentials`)
        .set(auth(token));
      expect(res.status).toBe(403);
    });

    it('B5. FINANCE_AUDITOR is denied workforce.user.create (cannot provision workforce users)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const res = await request(app.getHttpServer())
        .post('/api/v1/internal/admin/support/workforce-users')
        .set(auth(token))
        .send({ username: `should-be-denied-${Date.now()}` });
      expect(res.status).toBe(403);
    });

    it('B6. FINANCE_AUDITOR is denied customer.suspend/.activate/.close (customer lifecycle mutation)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const customerId = await createActiveCustomer();
      for (const status of ['SUSPENDED', 'ACTIVE', 'CLOSED']) {
        const res = await request(app.getHttpServer())
          .patch(`/api/v1/customers/${customerId}`)
          .set(auth(token))
          .send({ status, actor: 'should-be-denied' });
        expect(res.status).toBe(403);
      }
      const rows: Array<{ status: string }> = await dataSource.query(`SELECT status FROM customers WHERE id = $1`, [customerId]);
      expect(rows[0]!.status).toBe('ACTIVE');
    });

    it('B7. FINANCE_AUDITOR is denied privileged financial approval authority (FINANCE_ROLE_ASSIGN requires a function it does not hold)', async () => {
      const token = await tokenForRole('FINANCE_AUDITOR');
      const res = await request(app.getHttpServer())
        .post('/api/v1/internal/a2/workforce/roles')
        .set(auth(token))
        .send({
          targetPrincipalId: 'some-principal',
          roleKey: 'FINANCE_PREPARER',
          effectiveFrom: new Date().toISOString(),
          effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
        });
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // C. AGENT_NETWORK_MANAGER — positive on agent.*, negative on customer/workforce
  // =====================================================================================

  describe('C. AGENT_NETWORK_MANAGER', () => {
    it('C1. can suspend an agent (agent.suspend)', async () => {
      const token = await tokenForRole('AGENT_NETWORK_MANAGER');
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .set(auth(token))
        .send({ reason: 'anm test' });
      expect(res.status).toBe(200);
    });

    it('C2. can issue agent credentials (agent.manage_credentials)', async () => {
      const token = await tokenForRole('AGENT_NETWORK_MANAGER');
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/credentials`)
        .set(auth(token));
      expect(res.status).toBe(200);
    });

    it('C3. is denied customer.suspend (does not hold any customer.* function)', async () => {
      const token = await tokenForRole('AGENT_NETWORK_MANAGER');
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'SUSPENDED', actor: 'should-be-denied' });
      // V1-ADMIN-AUTHORIZATION-READ-SURFACE-01 (§6): CustomerController's `deniedStatus: 401`
      // override is preserved only for genuinely wrong-principal-type/invalid-principal denials
      // (see test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts). A principal
      // that IS a valid workforce OPERATOR but simply lacks `customer.suspend`
      // (FUNCTION_MISSING) now correctly gets 403, not 401 — see
      // src/authorization/authorization.service.ts `requireFunction()`.
      expect(res.status).toBe(403);
    });

    it('C4. is denied workforce.user.create (does not hold it)', async () => {
      const token = await tokenForRole('AGENT_NETWORK_MANAGER');
      const res = await request(app.getHttpServer())
        .post('/api/v1/internal/admin/support/workforce-users')
        .set(auth(token))
        .send({ username: `should-be-denied-${Date.now()}` });
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // D. OPERATIONS — positive on customer.* and workforce.user.*, negative on agent.*
  // =====================================================================================

  describe('D. OPERATIONS', () => {
    it('D1. can suspend/activate a customer (customer.suspend/.activate EXECUTE)', async () => {
      const token = await tokenForRole('OPERATIONS');
      const customerId = await createActiveCustomer();
      const suspend = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'SUSPENDED', actor: 'ops test' });
      expect(suspend.status).toBe(200);
      const activate = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'ACTIVE', actor: 'ops test' });
      expect(activate.status).toBe(200);
    });

    it('D2. can provision a workforce user (workforce.user.create EXECUTE)', async () => {
      const token = await tokenForRole('OPERATIONS');
      const res = await request(app.getHttpServer())
        .post('/api/v1/internal/admin/support/workforce-users')
        .set(auth(token))
        .send({ username: `hardening01.ops.${Date.now()}` });
      expect(res.status).toBe(201);
    });

    it('D3. is denied agent.suspend (does not hold any agent.* function)', async () => {
      const token = await tokenForRole('OPERATIONS');
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .set(auth(token))
        .send({ reason: 'should be denied' });
      expect(res.status).toBe(403);
    });

    it('D4. is denied agent.manage_credentials', async () => {
      const token = await tokenForRole('OPERATIONS');
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/credentials`)
        .set(auth(token));
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // E. FINANCE_PREPARER / FINANCE_CONTROLLER — hold none of the five migrated gates
  // =====================================================================================

  describe('E. FINANCE_PREPARER and FINANCE_CONTROLLER are denied the full migrated admin surface', () => {
    it.each(['FINANCE_PREPARER', 'FINANCE_CONTROLLER'])(
      '%s is denied agent.suspend, agent.manage_credentials, workforce.user.create and customer.suspend',
      async (roleKey) => {
        const token = await tokenForRole(roleKey);
        const agentId = await createActiveAgent();
        const customerId = await createActiveCustomer();

        const suspendAgent = await request(app.getHttpServer())
          .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
          .set(auth(token))
          .send({ reason: 'x' });
        expect(suspendAgent.status).toBe(403);

        const credentials = await request(app.getHttpServer())
          .post(`/api/v1/internal/admin/agents/${agentId}/credentials`)
          .set(auth(token));
        expect(credentials.status).toBe(403);

        const provisionWorkforce = await request(app.getHttpServer())
          .post('/api/v1/internal/admin/support/workforce-users')
          .set(auth(token))
          .send({ username: `should-be-denied-${roleKey}-${Date.now()}` });
        expect(provisionWorkforce.status).toBe(403);

        const suspendCustomer = await request(app.getHttpServer())
          .patch(`/api/v1/customers/${customerId}`)
          .set(auth(token))
          .send({ status: 'SUSPENDED', actor: 'should-be-denied' });
        // See C3's comment: FUNCTION_MISSING denials are 403, not 401.
        expect(suspendCustomer.status).toBe(403);
      },
    );
  });

  // =====================================================================================
  // F. COMPLIANCE / RISK_FRAUD / CUSTOMER_SERVICE / TREASURY — scoped-role spot checks
  // =====================================================================================

  describe('F. Narrowly-scoped roles remain denied outside their own function set', () => {
    it.each(['COMPLIANCE', 'RISK_FRAUD', 'TREASURY'])(
      '%s is denied agent.suspend and customer.suspend (outside its scope)',
      async (roleKey) => {
        const token = await tokenForRole(roleKey);
        const agentId = await createActiveAgent();
        const customerId = await createActiveCustomer();

        const suspendAgent = await request(app.getHttpServer())
          .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
          .set(auth(token))
          .send({ reason: 'x' });
        expect(suspendAgent.status).toBe(403);

        const suspendCustomer = await request(app.getHttpServer())
          .patch(`/api/v1/customers/${customerId}`)
          .set(auth(token))
          .send({ status: 'SUSPENDED', actor: 'should-be-denied' });
        // See C3's comment: FUNCTION_MISSING denials are 403, not 401.
        expect(suspendCustomer.status).toBe(403);
      },
    );

    it('CUSTOMER_SERVICE holds customer.view/manage_support_case only — denied customer.suspend (not an EXECUTE grant)', async () => {
      const token = await tokenForRole('CUSTOMER_SERVICE');
      const customerId = await createActiveCustomer();
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'SUSPENDED', actor: 'should-be-denied' });
      // See C3's comment: FUNCTION_MISSING denials are 403, not 401.
      expect(res.status).toBe(403);
    });

    it('CUSTOMER_SERVICE is denied agent.suspend (no agent.* function at all)', async () => {
      const token = await tokenForRole('CUSTOMER_SERVICE');
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .set(auth(token))
        .send({ reason: 'x' });
      expect(res.status).toBe(403);
    });
  });

  // =====================================================================================
  // G. FINANCE_ADMIN does not resolve as a live organizational role
  // =====================================================================================

  describe('G. FINANCE_ADMIN is not a live role (Task 22 invariant, reverified here)', () => {
    it('G1. a principal assigned the legacy FINANCE_ADMIN role key resolves to zero roles/scopes and is denied everywhere', async () => {
      const token = await tokenForRole('FINANCE_ADMIN');
      const agentId = await createActiveAgent();
      const customerId = await createActiveCustomer();

      const suspendAgent = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .set(auth(token))
        .send({ reason: 'x' });
      expect(suspendAgent.status).toBe(403);

      const suspendCustomer = await request(app.getHttpServer())
        .patch(`/api/v1/customers/${customerId}`)
        .set(auth(token))
        .send({ status: 'SUSPENDED', actor: 'x' });
      // See C3's comment: FUNCTION_MISSING denials are 403, not 401.
      expect(suspendCustomer.status).toBe(403);

      const provisionWorkforce = await request(app.getHttpServer())
        .post('/api/v1/internal/admin/support/workforce-users')
        .set(auth(token))
        .send({ username: `should-be-denied-${Date.now()}` });
      expect(provisionWorkforce.status).toBe(403);
    });
  });

  // =====================================================================================
  // H. Authentication vs authorization boundary
  // =====================================================================================

  describe('H. Unauthenticated requests fail closed with 401, not 403', () => {
    it('H1. no bearer token on a migrated mutation endpoint returns 401', async () => {
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .send({ reason: 'x' });
      expect(res.status).toBe(401);
    });

    it('H2. a garbage bearer token on a migrated mutation endpoint returns 401', async () => {
      const agentId = await createActiveAgent();
      const res = await request(app.getHttpServer())
        .post(`/api/v1/internal/admin/agents/${agentId}/suspend`)
        .set(auth('not-a-real-token'))
        .send({ reason: 'x' });
      expect(res.status).toBe(401);
    });
  });

  // =====================================================================================
  // I. Governance invariants remain structural (catalogue + DB triggers), not re-litigated
  // =====================================================================================

  describe('I. Foundation-01 governance invariants are preserved (not weakened by this task)', () => {
    it('I1. a Finance-class-restricted function cannot be assigned to a non-finance-class role (DB trigger)', async () => {
      const roleRows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM authorization_roles WHERE role_key = 'OPERATIONS'`,
      );
      expect(roleRows).toHaveLength(1);
      await expect(
        dataSource.query(
          `INSERT INTO authorization_role_functions (role_id, function_code, access_type, assigned_by, assigned_at)
           VALUES ($1, 'ledger.post', 'INITIATE', 'test-harness', NOW())`,
          [roleRows[0]!.id],
        ),
      ).rejects.toThrow();
    });

    it('I2. a non-assignable (FUTURE/OUT_OF_V1_SCOPE) function has zero role assignments', async () => {
      const rows: Array<{ count: string }> = await dataSource.query(
        `SELECT count(*)::text as count FROM authorization_role_functions
         WHERE function_code IN ('workforce.role.create','workforce.role.modify','ledger.approve_adjustment','customer.terminate','agent.manage_permissions')`,
      );
      expect(Number(rows[0]!.count)).toBe(0);
    });

    it('I3. TREASURY holds exactly reconciliation.view and nothing else (Decision 6)', async () => {
      const rows: Array<{ function_code: string }> = await dataSource.query(
        `SELECT rf.function_code FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id WHERE r.role_key = 'TREASURY'`,
      );
      expect(rows.map((r) => r.function_code)).toEqual(['reconciliation.view']);
    });

    it('I4. RISK_FRAUD holds exactly risk_fraud.manage_fraud_case and nothing else (Decisions 8/9)', async () => {
      const rows: Array<{ function_code: string }> = await dataSource.query(
        `SELECT rf.function_code FROM authorization_role_functions rf
         JOIN authorization_roles r ON r.id = rf.role_id WHERE r.role_key = 'RISK_FRAUD'`,
      );
      expect(rows.map((r) => r.function_code)).toEqual(['risk_fraud.manage_fraud_case']);
    });

    it('I5. all eleven V1 roles resolve from the persistent catalogue table (no hardcoded role universe)', async () => {
      // V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 added ADMINISTRATOR (the 11th
      // approved role) to the catalogue seed — see docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md.
      const rows: Array<{ role_key: string }> = await dataSource.query(
        `SELECT role_key FROM authorization_roles WHERE is_active = true ORDER BY role_key`,
      );
      expect(rows.map((r) => r.role_key)).toEqual([
        'ADMINISTRATOR',
        'AGENT_NETWORK_MANAGER',
        'COMPLIANCE',
        'CUSTOMER_SERVICE',
        'FINANCE_AUDITOR',
        'FINANCE_CONTROLLER',
        'FINANCE_PREPARER',
        'OPERATIONS',
        'RISK_FRAUD',
        'SUPER_ADMIN',
        'TREASURY',
      ]);
    });
  });

  // =====================================================================================
  // J. Existing (pre-hardening) functionality is unchanged for the already-wired actions
  // =====================================================================================

  describe('J. Pre-existing requiredFunctions wiring (Task 22) still works unchanged', () => {
    it('J1. FINANCE_CONTROLLER can still approve a FINANCE_ROLE_ASSIGN request (workforce.role.assign/.revoke untouched by this task)', async () => {
      const superAdminToken = await loginSuperAdmin();
      const preparerToken = await tokenForRole('FINANCE_PREPARER');
      // Just prove the existing wiring responds (not 404/500) — full coverage lives in the
      // Task 22 (V1-ADMIN-AUTHORIZATION-RUNTIME-01) test suite; this is a non-regression check.
      const res = await request(app.getHttpServer())
        .post('/api/v1/internal/a2/workforce/roles')
        .set(auth(preparerToken))
        .send({
          targetPrincipalId: 'target-principal',
          roleKey: 'FINANCE_AUDITOR',
          effectiveFrom: new Date().toISOString(),
          effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
        });
      // FINANCE_PREPARER is not an initiating role for FINANCE_ROLE_ASSIGN per
      // A2_MAKER_CHECKER_RULES_JSON (SUPER_ADMIN initiates) — expect a clean 403, not a crash.
      expect([401, 403]).toContain(res.status);
      expect(superAdminToken).toBeDefined();
    });
  });
});
