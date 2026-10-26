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

  async function createRoleSession(
    roleKey: string,
    principalSuffix = roleKey,
  ): Promise<{ token: string; principalId: string }> {
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
    return { token: result.accessToken, principalId };
  }

  async function tokenForRole(roleKey: string, principalSuffix = roleKey): Promise<string> {
    return (await createRoleSession(roleKey, principalSuffix)).token;
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

  async function createDirectoryCustomer(
    name: string,
    phone: string,
  ): Promise<{ customerId: string; reference: string }> {
    const reference = `mn-${phone}`;
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [reference],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, legal_name, is_active) VALUES ($1,$2,$3,true)`,
      [customerId, name, `${name} Legal`],
    );
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `+234${phone}`, phone],
    );
    return { customerId, reference };
  }

  async function createBareCustomer(status = 'DRAFT'): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL',$2,'NONE','NOT_STARTED') RETURNING id`,
      [`cust-custread01-bare-${randomUUID()}`, status],
    );
    return rows[0]!.id;
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

  it('A8. a real CUSTOMER session cannot enumerate the workforce customer list', async () => {
    const { token } = await createCustomerWithLogin();
    const res = await request(app.getHttpServer()).get('/api/v1/customers').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('A9. the directory is server-filtered/paginated, joins profile names, and masks phone-derived identifiers', async () => {
    const first = await createDirectoryCustomer('Synthetic Directory Alpha', '8012345678');
    await createDirectoryCustomer('Synthetic Directory Beta', '8098765432');
    const superAdmin = await loginSuperAdmin();

    const filtered = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?search=Alpha&status=ACTIVE&type=INDIVIDUAL&kycLevel=LEVEL_1&kycStatus=APPROVED&page=1&limit=1')
      .set(auth(superAdmin))
      .expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].id).toBe(first.customerId);
    expect(filtered.body.data[0].displayName).toBe('Synthetic Directory Alpha');
    expect(filtered.body.data[0].legalName).toBe('Synthetic Directory Alpha Legal');
    expect(filtered.body.data[0].reference).toBe('mn-••••5678');
    expect(filtered.body.data[0].primaryContact).toEqual({
      type: 'PHONE',
      maskedValue: '+234*****5678',
      isVerified: true,
    });
    expect(JSON.stringify(filtered.body)).not.toContain(first.reference);
    expect(JSON.stringify(filtered.body)).not.toContain('8012345678');

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?status=ACTIVE&page=1&limit=1')
      .set(auth(superAdmin))
      .expect(200);
    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?status=ACTIVE&page=2&limit=1')
      .set(auth(superAdmin))
      .expect(200);
    expect(firstPage.body.total).toBe(2);
    expect(firstPage.body.hasNextPage).toBe(true);
    expect(secondPage.body.page).toBe(2);
    expect(secondPage.body.hasPreviousPage).toBe(true);
    expect(secondPage.body.data[0].id).not.toBe(firstPage.body.data[0].id);

    const roleWithoutContactRead = await tokenForRole('ADMINISTRATOR');
    const phoneSearch = await request(app.getHttpServer())
      .get('/api/v1/internal/customers?search=8012345678&page=1&limit=20')
      .set(auth(roleWithoutContactRead))
      .expect(200);
    expect(phoneSearch.body.total).toBe(0);
    expect(JSON.stringify(phoneSearch.body)).not.toContain('8012345678');
  });

  it('A10. manual creation is customer.create-gated, forced to DRAFT, and attributes audit to the authenticated principal', async () => {
    const { token, principalId } = await createRoleSession('OPERATIONS', 'create-draft');
    const response = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(token))
      .send({
        reference: 'mn-0801234567',
        type: 'INDIVIDUAL',
        status: 'ACTIVE',
        actor: 'forged-client-actor',
      })
      .expect(201);

    expect(response.body.status).toBe('DRAFT');
    expect(response.body.reference).toBe('mn-••••4567');
    const auditRows: Array<{ actor: string; new_values: Record<string, unknown> }> = await dataSource.query(
      `SELECT actor, new_values FROM audit_events WHERE entity_type='CUSTOMER' AND entity_id=$1 AND action='CREATED'`,
      [response.body.id],
    );
    expect(auditRows[0]?.actor).toBe(principalId);
    expect(auditRows[0]?.new_values?.reference).toBe('mn-••••4567');
    expect(JSON.stringify(auditRows[0]?.new_values)).not.toContain('0801234567');

    const customerServiceToken = await tokenForRole('CUSTOMER_SERVICE');
    const denied = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth(customerServiceToken))
      .send({ reference: `manual-denied-${randomUUID()}`, type: 'INDIVIDUAL', actor: 'spoofed' });
    expect(denied.status).toBe(403);
  });

  it('A11. profile/address/contact writes require customer.create; actors come from the principal while self-service stays available', async () => {
    const customerId = await createBareCustomer();
    const restrictedToken = await tokenForRole('CUSTOMER_SERVICE');
    const profileBody = { displayName: 'Synthetic Profile', actor: 'spoofed-profile-actor' };
    const deniedProfile = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/profile`)
      .set(auth(restrictedToken))
      .send(profileBody);
    expect(deniedProfile.status).toBe(403);

    const { token, principalId } = await createRoleSession('OPERATIONS', 'profile-write');
    const profile = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/profile`)
      .set(auth(token))
      .send(profileBody)
      .expect(201);
    const address = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/address`)
      .set(auth(token))
      .send({ type: 'RESIDENTIAL', lineOne: '1 Synthetic Road', city: 'Abuja', state: 'FCT', country: 'NG', isPrimary: true, actor: 'spoofed-address-actor' })
      .expect(201);
    const contact = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/contact-method`)
      .set(auth(token))
      .send({ type: 'PHONE', value: '+2348012345678', isPrimary: true, actor: 'spoofed-contact-actor' })
      .expect(201);

    for (const [entityType, entityId] of [
      ['CUSTOMER_PROFILE', profile.body.id],
      ['CUSTOMER_ADDRESS', address.body.id],
      ['CUSTOMER_CONTACT_METHOD', contact.body.id],
    ]) {
      const rows: Array<{ actor: string }> = await dataSource.query(
        `SELECT actor FROM audit_events WHERE entity_type=$1 AND entity_id=$2 AND action='CREATED'`,
        [entityType, entityId],
      );
      expect(rows[0]?.actor).toBe(principalId);
    }

    const self = await createCustomerWithLogin();
    const selfContact = await request(app.getHttpServer())
      .post(`/api/v1/customers/${self.customerId}/contact-method`)
      .set(auth(self.token))
      .send({ type: 'EMAIL', value: `self-${randomUUID()}@example.test`, isPrimary: false, actor: 'spoofed-self-actor' })
      .expect(201);
    const selfAudit: Array<{ actor: string }> = await dataSource.query(
      `SELECT actor FROM audit_events WHERE entity_type='CUSTOMER_CONTACT_METHOD' AND entity_id=$1 AND action='CREATED'`,
      [selfContact.body.id],
    );
    expect(selfAudit[0]?.actor).toBe(self.customerId);
  });

  it('A12. identity-document writes require both approved functions and responses/audits omit raw numbers', async () => {
    const customerId = await createBareCustomer();
    const documentNumber = 'SYNTHETIC-IDENTITY-987654321';
    const body = { type: 'NIN', documentNumber, issuingCountry: 'NG', actor: 'forged-document-actor' };
    const operations = await tokenForRole('OPERATIONS');
    const denied = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/identity-document`)
      .set(auth(operations))
      .send(body);
    expect(denied.status).toBe(403);

    const { token, principalId } = await createRoleSession('COMPLIANCE', 'identity-write');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/identity-document`)
      .set(auth(token))
      .send(body)
      .expect(201);
    expect(created.body).not.toHaveProperty('documentNumber');
    expect(created.body.maskedDocumentNumber).toBe('••••••4321');
    expect(JSON.stringify(created.body)).not.toContain(documentNumber);

    const listed = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/identity-documents`)
      .set(auth(token))
      .expect(200);
    expect(listed.body[0]).not.toHaveProperty('documentNumber');
    expect(JSON.stringify(listed.body)).not.toContain(documentNumber);

    const auditRows: Array<{ actor: string; new_values: Record<string, unknown> }> = await dataSource.query(
      `SELECT actor, new_values FROM audit_events WHERE entity_type='CUSTOMER_IDENTITY_DOCUMENT' AND entity_id=$1 AND action='CREATED'`,
      [created.body.id],
    );
    expect(auditRows[0]?.actor).toBe(principalId);
    expect(JSON.stringify(auditRows[0]?.new_values)).not.toContain(documentNumber);
  });

  it('A13. customer self-service KYC reads remain available but customer principals cannot mutate KYC assessments', async () => {
    const self = await createCustomerWithLogin();
    const { token: complianceToken } = await createRoleSession('COMPLIANCE', 'self-kyc-seed');
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${self.customerId}/kyc-assessment`)
      .set(auth(complianceToken))
      .send({ level: 'LEVEL_1', status: 'PENDING', assessedBy: 'forged-seed-actor' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/customers/${self.customerId}/kyc`)
      .set(auth(self.token))
      .expect(200);

    const denied = await request(app.getHttpServer())
      .post(`/api/v1/customers/${self.customerId}/kyc-assessment`)
      .set(auth(self.token))
      .send({ level: 'LEVEL_1', status: 'APPROVED', assessedBy: 'forged-self-actor' });
    expect(denied.status).toBe(403);
  });

  it('A14. lifecycle and KYC audit actors are derived from authenticated workforce principals', async () => {
    const customerId = await createActiveCustomer();
    const operations = await createRoleSession('OPERATIONS', 'lifecycle-actor');
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set(auth(operations.token))
      .send({ status: 'SUSPENDED', actor: 'forged-lifecycle-actor' })
      .expect(200);
    const lifecycleAudit: Array<{ actor: string }> = await dataSource.query(
      `SELECT actor FROM audit_events WHERE entity_type='CUSTOMER' AND entity_id=$1 AND action='STATUS_UPDATED'`,
      [customerId],
    );
    expect(lifecycleAudit[0]?.actor).toBe(operations.principalId);

    const kycCustomerId = await createBareCustomer();
    const compliance = await createRoleSession('COMPLIANCE', 'kyc-actor');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/customers/${kycCustomerId}/kyc-assessment`)
      .set(auth(compliance.token))
      .send({ level: 'LEVEL_1', status: 'PENDING', assessedBy: 'forged-kyc-actor' })
      .expect(201);
    expect(response.body.assessedBy).toBe(compliance.principalId);
  });

  it('A15. onboarding/eligibility summaries require customer.view and omit internal eligibility reasons/reviewer fields', async () => {
    const customerId = await createBareCustomer();
    await dataSource.query(
      `INSERT INTO customer_eligibilities (customer_id, status, reason, reviewed_by, status_changed_at, version) VALUES ($1,'ELIGIBLE','synthetic internal review note','synthetic-reviewer',now(),1)`,
      [customerId],
    );
    const operations = await tokenForRole('OPERATIONS');
    const treasury = await tokenForRole('TREASURY');

    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/onboarding-readiness`)
      .set(auth(treasury))
      .expect(403);
    const readiness = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/onboarding-readiness`)
      .set(auth(operations))
      .expect(200);
    expect(readiness.body.status).toBe('NOT_READY');

    await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/eligibility`)
      .set(auth(treasury))
      .expect(403);
    const eligibility = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/eligibility`)
      .set(auth(operations))
      .expect(200);
    expect(eligibility.body.status).toBe('ELIGIBLE');
    expect(eligibility.body).not.toHaveProperty('reason');
    expect(eligibility.body).not.toHaveProperty('reviewedBy');

    const operatingStatus = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/operating-status`)
      .set(auth(operations))
      .expect(200);
    expect(operatingStatus.body).toHaveProperty('canOperate');
    expect(operatingStatus.body).not.toHaveProperty('blockedReasons');
    expect(operatingStatus.body).not.toHaveProperty('activeRestrictions');
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
