/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
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
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AggregatorService } from '../src/aggregator/aggregator.service';
import { CustomerService } from '../src/customer/customer.service';

describe('A22 Admin Backend Foundation (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let classService: AgentClassService;
  let appService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let aggregatorService: AggregatorService;

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

  // Mock workforce session service that validates synthetic tokens:
  //  Bearer workforce-SUPPORT, workforce-OPERATOR, workforce-SERVICE, workforce-PRIVILEGED
  //  Bearer workforce-AGENT, workforce-CUSTOMER should be treated as workforce type but will be denied by controller's requireWorkforce
  const mockWorkforceSessions = {
    validate: async (token: string, audience: string) => {
      if (!token || !token.startsWith('workforce-')) throw new UnauthorizedException('invalid workforce token');
      const type = token.replace('workforce-', '').toUpperCase();
      const allowed = ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED', 'AGENT', 'CUSTOMER', 'AGGREGATOR'];
      if (!allowed.includes(type)) throw new UnauthorizedException('invalid type');
      // Simulate workforce session validation success
      return {
        type,
        principalId: `workforce-${type.toLowerCase()}-1`,
        audience,
        roles: [],
        scopes: [],
        customerAccess: 'NONE',
        agentAccess: 'NONE',
        aggregatorAccess: 'NONE',
      } as any;
    },
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a22admin');
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
    classService = moduleRef.get(AgentClassService);
    appService = moduleRef.get(AgentApplicationService);
    lifecycleService = moduleRef.get(AgentLifecycleService);
    aggregatorService = moduleRef.get(AggregatorService);
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        try { if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined); } catch { void 0; }
      }
    }
  }, 60000);

  async function createActiveAgent(): Promise<string> {
    const cls = await classService.create({
      reference: `cls-a22-${randomUUID().slice(0, 8)}`,
      code: `A22-${randomUUID().slice(0, 6)}`,
      name: 'A22 Class',
      isActive: true,
      applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING'] as any,
      applicableLimits: {} as any,
      actor: 'test-actor',
    });
    const appEntity = await appService.create({
      agentClassId: cls.id,
      applicantReference: `h-a22-${randomUUID()}`,
      businessName: `Biz A22 ${randomUUID().slice(0, 4)}`,
      contactEmail: `a22-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-a22',
    });
    await appService.submit(appEntity.id, 'applicant-a22');
    await dataSource.query(`UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`, [appEntity.id]);
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    return agent.id;
  }

  async function createCustomer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status) VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-a22-${randomUUID()}`],
    );
    return rows[0]!.id;
  }

  function workforceToken(type: string): string {
    return `workforce-${type}`;
  }

  // Helper to get agent/customer bearer via real login (for negative tests)
  async function getAgentToken(agentId: string): Promise<string> {
    // create credential if not exists
    const exists: Array<any> = await dataSource.query(`SELECT id FROM agent_authentication_credentials WHERE agent_id=$1`, [agentId]);
    if (exists.length === 0) {
      const hash = 'PBKDF2$sha256$10000$YTIyLXRlc3Qtc2FsdA$testhash';
      // Use real service to create proper hash? For this test we can directly test via service not HTTP for agent
      // Instead, we will use a fake agent token via workforce mock with type AGENT to simulate agent principal
      return workforceToken('AGENT');
    }
    // Try login via HTTP
    const res = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'test' });
    return res.body.accessToken as string;
  }

  it('1. Unauthenticated reject (no token) for admin reads', async () => {
    await request(app.getHttpServer()).get('/api/v1/internal/agents').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/customers').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/aggregators').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/audit').expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/reconciliation/report').expect(401);
  });

  it('2. Customer cannot access admin (mock customer workforce token)', async () => {
    const token = workforceToken('CUSTOMER');
    await request(app.getHttpServer()).get('/api/v1/internal/agents').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/customers').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/aggregators').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('3. Agent cannot access admin', async () => {
    const token = workforceToken('AGENT');
    await request(app.getHttpServer()).get('/api/v1/internal/agents').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/customers').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app.getHttpServer()).get('/api/v1/internal/aggregators').set('Authorization', `Bearer ${token}`).expect(401);
    // Also test via real agent session if available - should be 401 (workforce route, not agent)
    const agentId = await createActiveAgent();
    const { pbkdf2Sync } = await import('node:crypto');
    const salt = Buffer.from('a22-test-salt');
    const digest = pbkdf2Sync('pw-a22', salt, 10_000, 32, 'sha256');
    const hash2 = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
    await dataSource.query(`INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`, [agentId, hash2]);
    const login = await request(app.getHttpServer()).post('/api/v1/agents/sessions').send({ agentId, password: 'pw-a22' }).expect(200);
    const agentToken = login.body.accessToken as string;
    const res = await request(app.getHttpServer()).get('/api/v1/internal/agents').set('Authorization', `Bearer ${agentToken}`);
    expect([401, 403, 500].includes(res.status)).toBe(true);
    expect(res.status).not.toBe(200);
  });

  it('4. Workforce SUPPORT/OPERATOR/SERVICE/PRIVILEGED can access admin list', async () => {
    // Ensure at least one agent and customer and aggregator exist
    const agentId = await createActiveAgent();
    await createCustomer();
    await aggregatorService.create({ reference: `agg-a22-${randomUUID().slice(0, 8)}`, code: `AGG-${randomUUID().slice(0, 6)}`, corporateName: 'Agg A22', actor: 'test-actor' });

    for (const type of ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']) {
      const token = workforceToken(type);
      const resAgents = await request(app.getHttpServer()).get('/api/v1/internal/agents').set('Authorization', `Bearer ${token}`).expect(200);
      expect(resAgents.body.data).toBeDefined();
      expect(Array.isArray(resAgents.body.data)).toBe(true);
      const resCustomers = await request(app.getHttpServer()).get('/api/v1/internal/customers').set('Authorization', `Bearer ${token}`).expect(200);
      expect(resCustomers.body.data).toBeDefined();
      const resAggregators = await request(app.getHttpServer()).get('/api/v1/internal/aggregators').set('Authorization', `Bearer ${token}`).expect(200);
      expect(resAggregators.body.data).toBeDefined();
    }
  });

  it('5. Workforce can get single agent/customer', async () => {
    const agentId = await createActiveAgent();
    const customerId = await createCustomer();
    const token = workforceToken('SUPPORT');
    const resAgent = await request(app.getHttpServer()).get(`/api/v1/internal/agents/${agentId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(resAgent.body.id).toBe(agentId);
    expect(resAgent.body.reference).toBeDefined();
    // Ensure no sensitive fields
    const agentStr = JSON.stringify(resAgent.body).toLowerCase();
    expect(agentStr).not.toContain('password');
    expect(agentStr).not.toContain('pin');
    expect(agentStr).not.toContain('secret');
    expect(agentStr).not.toContain('token');

    const resCustomer = await request(app.getHttpServer()).get(`/api/v1/internal/customers/${customerId}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(resCustomer.body.id).toBe(customerId);
    const custStr = JSON.stringify(resCustomer.body).toLowerCase();
    expect(custStr).not.toContain('password');
    expect(custStr).not.toContain('pin');
    expect(custStr).not.toContain('secret');
  });

  it('6. Pagination works for admin lists', async () => {
    const token = workforceToken('PRIVILEGED');
    // Create 3 agents
    await createActiveAgent();
    await createActiveAgent();
    await createActiveAgent();
    const res = await request(app.getHttpServer()).get('/api/v1/internal/agents?page=1&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(2);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data.length).toBe(2);
    const res2 = await request(app.getHttpServer()).get('/api/v1/internal/agents?page=2&limit=2').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res2.body.page).toBe(2);
    expect(res2.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('7. Agent lifecycle via admin (workforce) still respects rules', async () => {
    const agentId = await createActiveAgent();
    const token = workforceToken('PRIVILEGED');
    // Suspend via workforce (existing endpoint)
    const suspendRes = await request(app.getHttpServer()).post(`/api/v1/internal/agents/${agentId}/suspend`).set('Authorization', `Bearer ${token}`).send({ reason: 'test' }).expect(200);
    expect(suspendRes.body.status).toBe('SUSPENDED');
    // Reactivate
    const reactRes = await request(app.getHttpServer()).post(`/api/v1/internal/agents/${agentId}/reactivate`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(reactRes.body.status).toBe('ACTIVE');
    // Terminate
    const termRes = await request(app.getHttpServer()).post(`/api/v1/internal/agents/${agentId}/terminate`).set('Authorization', `Bearer ${token}`).send({ reason: 'close' }).expect(200);
    expect(termRes.body.status).toBe('TERMINATED');
    // Cannot reactivate terminated - expect 400 or 409
    const fail = await request(app.getHttpServer()).post(`/api/v1/internal/agents/${agentId}/reactivate`).set('Authorization', `Bearer ${token}`);
    expect([400, 409].includes(fail.status)).toBe(true);
  });

  it('8. Aggregator lifecycle via admin workforce', async () => {
    const token = workforceToken('SUPPORT');
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/internal/aggregators')
      .set('Authorization', `Bearer ${token}`)
      .send({ reference: `agg-a22-lc-${randomUUID().slice(0, 8)}`, code: `AGGC-${randomUUID().slice(0, 4).toUpperCase()}`, corporateName: 'Agg LC' })
      .expect(201);
    const aggId = createRes.body.id as string;
    await request(app.getHttpServer()).post(`/api/v1/internal/aggregators/${aggId}/activate`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/internal/aggregators/${aggId}/suspend`).set('Authorization', `Bearer ${token}`).send({ reason: 'risk' }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/internal/aggregators/${aggId}/reactivate`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/internal/aggregators/${aggId}/terminate`).set('Authorization', `Bearer ${token}`).send({ reason: 'end' }).expect(200);
  });

  it('9. Outlet/Terminal via workforce (existing)', async () => {
    const agentId = await createActiveAgent();
    const token = workforceToken('PRIVILEGED');
    const outletRes = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/outlets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reference: `out-a22-${randomUUID().slice(0, 6)}`, name: 'Outlet A22', displayName: 'A22', addressLine: '1 Test', city: 'Lagos', state: 'Lagos' })
      .expect(201);
    const outletId = outletRes.body.id as string;
    const termRes = await request(app.getHttpServer())
      .post(`/api/v1/internal/outlets/${outletId}/terminals`)
      .set('Authorization', `Bearer ${token}`)
      .send({ outletId, reference: `term-a22-${randomUUID().slice(0, 6)}`, label: 'POS', serialNumber: 'SN-A22' })
      .expect(201);
    expect(termRes.body.id).toBeDefined();
  });

  it('10. Funding via A19 (workforce) and financial reads non-mutating', async () => {
    const agentId = await createActiveAgent();
    const token = workforceToken('PRIVILEGED');
    const journalsBefore: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    const fundRes = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/fund`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor: '100000', currency: 'NGN', reference: `fund-a22-${randomUUID().slice(0, 8)}`, idempotencyKey: `idem-a22-${randomUUID()}` })
      .expect(201);
    expect(fundRes.body.journalId ?? fundRes.body.id).toBeDefined();
    const journalsAfter: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    expect(Number(journalsAfter[0]!.count)).toBeGreaterThan(Number(journalsBefore[0]!.count));
    // Financial reads should not mutate
    const reconBefore = Number(journalsAfter[0]!.count);
    await request(app.getHttpServer()).get('/api/v1/internal/reconciliation/report').set('Authorization', `Bearer ${token}`).expect(200);
    const journalsAfterRecon: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM ledger_journals`);
    expect(Number(journalsAfterRecon[0]!.count)).toBe(reconBefore);
  });

  it('11. Audit reads via workforce and no sensitive fields', async () => {
    const token = workforceToken('SUPPORT');
    const res = await request(app.getHttpServer()).get('/api/v1/internal/audit?limit=5').set('Authorization', `Bearer ${token}`).expect(200);
    const bodyStr = JSON.stringify(res.body).toLowerCase();
    expect(bodyStr).not.toContain('password');
    expect(bodyStr).not.toContain('pin');
    expect(bodyStr).not.toContain('secret');
    expect(bodyStr).not.toContain('token');
    expect(bodyStr).not.toContain('otp');
  });

  it('12. Production/readiness reads', async () => {
    // version is public
    await request(app.getHttpServer()).get('/api/v1/internal/version').expect(200);
    const token = workforceToken('SUPPORT');
    await request(app.getHttpServer()).get('/api/v1/internal/readiness').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).get('/api/v1/internal/configuration').set('Authorization', `Bearer ${token}`).expect(200);
  });

  it('13. No arbitrary customer mutation via admin (should be 404)', async () => {
    const token = workforceToken('PRIVILEGED');
    const customerId = await createCustomer();
    await request(app.getHttpServer()).patch(`/api/v1/internal/customers/${customerId}`).set('Authorization', `Bearer ${token}`).send({ status: 'ACTIVE' }).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/internal/customers/${customerId}/balance`).set('Authorization', `Bearer ${token}`).send({ amount: 100 }).expect(404);
  });

  it('14. No admin money-movement shortcut (direct ledger)', async () => {
    const token = workforceToken('PRIVILEGED');
    await request(app.getHttpServer()).post('/api/v1/internal/ledger/journals').set('Authorization', `Bearer ${token}`).send({ amount: 100 }).expect(404);
  });

  it('15. Migration chain and audit for admin', async () => {
    const rows: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM typeorm_migrations`);
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(63);
    // Check audit was created for agent lifecycle
    const audits: Array<{ count: string }> = await dataSource.query(`SELECT count(*)::text as count FROM audit_events WHERE entity_type='AGENT'`);
    expect(Number(audits[0]!.count)).toBeGreaterThan(0);
  });
});
