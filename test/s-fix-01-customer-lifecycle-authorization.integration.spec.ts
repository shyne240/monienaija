/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltStr = 'sfix01-test-salt'): string {
  const salt = Buffer.from(saltStr);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/**
 * S-FIX-01 — Customer lifecycle authorization narrowing + session/status binding.
 * Proves the two security invariants against real PostgreSQL + real HTTP:
 *  - audit C-3: a CUSTOMER SELF principal cannot self-PATCH its own lifecycle status
 *    (self-activate/self-unsuspend); lifecycle transitions are workforce-privileged.
 *  - audit C-4: customer sessions and login are bound to the CURRENT customers.status;
 *    a cryptographically valid session is not sufficient for DRAFT/SUSPENDED/CLOSED.
 */
describe('S-FIX-01 customer lifecycle authorization + session/status binding (real PG + HTTP)', () => {
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
    jwksJson: [],
    adminScopes: ['privileged:execute'],
    financeRoles: [],
    makerCheckerRules: [],
    rateLimits: [],
    trustedProxies: ['127.0.0.1'],
  } as unknown as A2WorkforceConfigurationV1;

  // Mock workforce session service validating synthetic workforce-<TYPE> tokens.
  // Non-workforce principal types (CUSTOMER/AGENT/AGGREGATOR) validate as sessions of
  // that type and must be rejected by the controller-level workforce assertion.
  const mockWorkforceSessions = {
    validate: (token: string, audience: string): Promise<any> => {
      if (!token || !token.startsWith('workforce-')) {
        return Promise.reject(new UnauthorizedException('invalid workforce token'));
      }
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = [
        'SUPPORT',
        'OPERATOR',
        'SERVICE',
        'PRIVILEGED',
        'AGENT',
        'CUSTOMER',
        'AGGREGATOR',
      ];
      if (!allowed.includes(type)) return Promise.reject(new UnauthorizedException('invalid type'));
      return Promise.resolve({
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any);
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('sfix01lifecycle');
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createCustomer(
    custStatus: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED' = 'ACTIVE',
    opts: { password?: string } = {},
  ): Promise<{ customerId: string; password: string }> {
    const password = opts.password ?? 'correct-password-sfix01';
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL',$2,'LEVEL_1','APPROVED') RETURNING id`,
      [`cust-sfix01-${randomUUID()}`, custStatus],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'S-FIX-01 Customer'],
    );
    // V1-CUSTOMER-ONBOARDING-02 fixture update (SUB-1 gate): activation into ACTIVE now
    // requires a verified primary phone. The lifecycle AUTHORIZATION assertions are
    // unchanged; the fixture carries the verified phone the decided invariant mandates.
    const phone = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at) VALUES ($1,'PHONE',$2,$3,true,now())`,
      [customerId, `+234${phone}`, phone],
    );
    if (custStatus === 'CLOSED') {
      await dataSource.query(`UPDATE customers SET deleted_at = now() WHERE id = $1`, [customerId]);
    }
    const hash = encodePbkdf2(password);
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials (customer_id, password_hash, hash_algorithm, password_version, password_changed_at, status, account_locked, failed_authentication_count, version) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, hash],
    );
    return { customerId, password };
  }

  async function login(customerId: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    const token = res.body.accessToken as string;
    expect(token).toBeTruthy();
    return token;
  }

  async function createAgentToken(): Promise<string> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits) VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-sfix01-${randomUUID().slice(0, 8)}`,
        `SF01-${randomUUID().slice(0, 6)}`,
        'S-FIX-01 Class',
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-sfix01-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const hash = encodePbkdf2('agent-pass-sfix01', 'agent-salt');
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, hash],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-pass-sfix01' })
      .expect(200);
    return login.body.accessToken as string;
  }

  async function dbCustomerStatus(customerId: string): Promise<string | undefined> {
    const rows: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM customers WHERE id = $1`,
      [customerId],
    );
    return rows[0]?.status;
  }

  async function auditCount(customerId: string, action: string): Promise<number> {
    const rows: Array<{ n: string }> = await dataSource.query(
      `SELECT count(*)::text AS n FROM audit_events WHERE entity_id = $1 AND action = $2`,
      [customerId, action],
    );
    return Number(rows[0]?.n ?? 0);
  }

  it('0. Route policy: lifecycle PATCH is workforce-session; self-service routes unchanged', () => {
    const registry = new RoutePolicyRegistry();
    const lifecycle = registry.resolve({ method: 'PATCH', url: '/api/v1/customers/some-uuid' });
    expect(lifecycle.authenticationMode).toBe('WORKFORCE_SESSION');
    // UAT-DEFECT-001 boundary: SUPPORT is excluded from customer lifecycle transitions
    // (catalogue UAT-SEC-005 / UAT-ADMIN-011: SUPPORT = read + funding-maker + support-queue).
    expect(lifecycle.policy?.allowedPrincipalTypes).toEqual(['OPERATOR', 'SERVICE', 'PRIVILEGED']);
    expect(lifecycle.policy?.customerAccess).toBe('NONE');
    // Self-service surface explicitly unchanged (A23 contract).
    const me = registry.resolve({ method: 'GET', url: '/api/v1/customers/me/profile' });
    expect(me.authenticationMode).toBeUndefined();
    expect(me.policy?.allowedPrincipalTypes).toEqual(['CUSTOMER']);
    expect(me.policy?.customerAccess).toBe('SELF');
    // Non-lifecycle methods on /customers/:id keep the generic customer policy.
    const get = registry.resolve({ method: 'GET', url: '/api/v1/customers/some-uuid' });
    expect(get.authenticationMode).toBeUndefined();
    expect(get.policy?.allowedPrincipalTypes).toContain('CUSTOMER');
  });

  it('1. CUSTOMER SELF cannot perform privileged lifecycle transitions (self-activation closed)', async () => {
    const { customerId, password } = await createCustomer('ACTIVE');
    const token = await login(customerId, password);

    // Self-PATCH attempts (self-suspend here — the same route also closed self-activation,
    // proven by the DRAFT login denial below and the workforce-branch routing).
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED', actor: 'malicious-self' })
      .expect(403);
    expect(await dbCustomerStatus(customerId)).toBe('ACTIVE');
    expect(await auditCount(customerId, 'STATUS_UPDATED')).toBe(0);
  });

  it('2. Authorized workforce actor performs the intended lifecycle operation (activation)', async () => {
    const { customerId } = await createCustomer('DRAFT');
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'workforce-activation' })
      .expect(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(await dbCustomerStatus(customerId)).toBe('ACTIVE');
    expect(await auditCount(customerId, 'STATUS_UPDATED')).toBe(1);

    // UAT-DEFECT-001 boundary: SUPPORT is NOT an authorized workforce principal on this
    // surface (catalogue UAT-SEC-005/UAT-ADMIN-011 + route-policy customer-lifecycle
    // branch). Denial mirrors the V1-003 agent-lifecycle convention (401
    // "Privileged access required") and must carry no state write and no audit row.
    const denied = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-SUPPORT')
      .send({ status: 'SUSPENDED', actor: 'workforce-suspend' })
      .expect(401);
    expect(denied.body.message).toBe('Privileged access required');
    expect(await dbCustomerStatus(customerId)).toBe('ACTIVE');
    expect(await auditCount(customerId, 'STATUS_UPDATED')).toBe(1); // still only the OPERATOR activation
  });

  it('3. Unauthorized principal types are rejected on the lifecycle route', async () => {
    const { customerId } = await createCustomer('ACTIVE');

    // No token at all.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .send({ status: 'SUSPENDED', actor: 'no-token' })
      .expect(401);

    // Unknown bearer (not a workforce/customer/agent session) — workforce branch falls
    // through cross-checks and fails authentication.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ status: 'SUSPENDED', actor: 'unknown' })
      .expect(401);

    // Workforce-issued session whose principal type is CUSTOMER (masquerade) —
    // the controller-level workforce assertion rejects it.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-CUSTOMER')
      .send({ status: 'SUSPENDED', actor: 'masquerade' })
      .expect(401);

    // A real AGENT session is not a workforce principal on this route.
    const agentToken = await createAgentToken();
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'SUSPENDED', actor: 'agent-actor' })
      .expect(403);

    expect(await dbCustomerStatus(customerId)).toBe('ACTIVE');
    expect(await auditCount(customerId, 'STATUS_UPDATED')).toBe(0);
  });

  it('4+5. Current customer status is respected: login and sessions denied for DRAFT/SUSPENDED/CLOSED', async () => {
    // DRAFT customers cannot log in (pre-activation) — even with a valid credential.
    const draft = await createCustomer('DRAFT');
    await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId: draft.customerId, password: draft.password })
      .expect(401);

    // ACTIVE → login works; after workforce suspension the SAME session is denied and
    // re-login is denied.
    const active = await createCustomer('ACTIVE');
    const token = await login(active.customerId, active.password);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${active.customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'SUSPENDED', actor: 'workforce-suspend' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/status')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId: active.customerId, password: active.password })
      .expect(401);

    // CLOSED customers (soft-deleted) can neither log in nor hold a valid session.
    const closed = await createCustomer('CLOSED');
    await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId: closed.customerId, password: closed.password })
      .expect(401);
  });

  it('7. Session behavior is deterministic across lifecycle transitions', async () => {
    const { customerId, password } = await createCustomer('ACTIVE');
    const token = await login(customerId, password);

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'SUSPENDED', actor: 'wf-1' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    // Reactivation: current status is authoritative at request time, so the unexpired
    // session is usable again without re-login (session was never revoked).
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'wf-2' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // CLOSED is terminal: session denied, and no transition out exists.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'CLOSED', actor: 'wf-3' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(401);
    // CLOSED is fail-closed terminal: the customer row is soft-deleted, so even a
    // workforce reactivation attempt cannot reach the transition map (404 NotFound;
    // CLOSED→ACTIVE would also be rejected by the transition map with 409 if reached).
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', 'Bearer workforce-OPERATOR')
      .send({ status: 'ACTIVE', actor: 'wf-4' })
      .expect(404);
  });

  it('8. No privilege escalation through alternate customer routes/services', async () => {
    const self = await createCustomer('ACTIVE');
    const other = await createCustomer('ACTIVE');
    const selfToken = await login(self.customerId, self.password);
    const otherToken = await login(other.customerId, other.password);

    // Existing SELF read surface unchanged.
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${self.customerId}`)
      .set('Authorization', `Bearer ${selfToken}`)
      .expect(200);
    // Cross-customer access still denied by customerAccess SELF scope.
    await request(app.getHttpServer())
      .get(`/api/v1/customers/${other.customerId}`)
      .set('Authorization', `Bearer ${selfToken}`)
      .expect(403);

    // Lifecycle PATCH on a non-existent customer reaches the service (workforce route)
    // and returns 404 — the workforce gate happened, not customer self-service.
    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${randomUUID()}`)
      .set('Authorization', 'Bearer workforce-PRIVILEGED')
      .send({ status: 'ACTIVE', actor: 'wf-missing' })
      .expect(404);

    // PATCH /customers/me is NOT a lifecycle backdoor: it route-matches the lifecycle
    // handler (:id = 'me') under the CUSTOMER me-policy, and the controller-level
    // workforce assertion rejects the CUSTOMER principal before any status write.
    await request(app.getHttpServer())
      .patch('/api/v1/customers/me')
      .set('Authorization', `Bearer ${selfToken}`)
      .send({ status: 'ACTIVE', actor: 'self-me' })
      .expect(401);
    expect(await dbCustomerStatus(self.customerId)).toBe('ACTIVE');
    void otherToken;
  });
});
