/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
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

describe('V1-ADMIN-P1-HARDENING — P1 function-level authorization for all internal + observability endpoints (real PG + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let localAdminService: LocalAdminAuthenticationService;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  const fakeCustomerId = randomUUID();
  const fakeWalletId = randomUUID();
  const fakeTransferId = randomUUID();

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('v1adminp1hard01');
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
      try { await destroyIntegrationDataSource(dataSource); } catch { try { if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined); } catch {} }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function loginSuperAdmin(): Promise<string> {
    await localAdminService.seedDefaultAdmin({ email: 'p1-admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    await localAdminService.seedDefaultAdmin({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    const login = await request(app.getHttpServer()).post(LOGIN_PATH).send({ email: 'admin@monienaija.local', password: 'MonieNaijaAdmin123!' });
    if (login.status !== 201) throw new Error(`SUPER_ADMIN login failed: ${login.status} ${JSON.stringify(login.body)}`);
    return login.body.accessToken as string;
  }

  async function tokenForRole(roleKey: string, principalSuffix = roleKey): Promise<string> {
    const principalId = `p1hard:${principalSuffix}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `p1-hardening:${principalId}:${roleKey}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      assignedBy: 'p1-test-harness',
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
      signingKeyId: 'p1-test-key',
    });
    return result.accessToken;
  }

  async function expectStatus(path: string, method: 'get'|'post'|'patch' = 'get', token: string, body: any, expected: number | number[]) {
    const exp = Array.isArray(expected) ? expected : [expected];
    let req = (request(app.getHttpServer()) as any)[method](path);
    if (body) req = req.send(body);
    const res = await req.set('Authorization', `Bearer ${token}`);
    if (!exp.includes(res.status)) {
      throw new Error(`Expected ${method.toUpperCase()} ${path} to be ${exp}, got ${res.status} body=${JSON.stringify(res.body).slice(0,800)}`);
    }
    return res;
  }

  describe('A. Agent network (agent.view)', () => {
    it('SUPER_ADMIN, AGENT_NETWORK_MANAGER, FINANCE_AUDITOR, ADMINISTRATOR can list agents', async () => {
      for (const role of ['SUPER_ADMIN','AGENT_NETWORK_MANAGER','FINANCE_AUDITOR','ADMINISTRATOR']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        await expectStatus('/api/v1/internal/agents?limit=5', 'get', tok, null, 200);
      }
    });
    it('FINANCE_PREPARER, FINANCE_CONTROLLER, OPERATIONS, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY are denied list agents', async () => {
      for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','OPERATIONS','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','TREASURY']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/internal/agents?limit=5', 'get', tok, null, 403);
      }
    });
  });

  describe('B. Customer directory (customer.view / view_transactions / view_wallets / manage_support_case)', () => {
    it('customer.view list: SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE, ADMINISTRATOR allowed; others denied', async () => {
      for (const role of ['SUPER_ADMIN','FINANCE_AUDITOR','OPERATIONS','COMPLIANCE','CUSTOMER_SERVICE','ADMINISTRATOR']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        await expectStatus('/api/v1/internal/customers?limit=5', 'get', tok, null, 200);
      }
      for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','AGENT_NETWORK_MANAGER','RISK_FRAUD','TREASURY']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/internal/customers?limit=5', 'get', tok, null, 403);
      }
    });
    it('customer.view_transactions: SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS, CUSTOMER_SERVICE allowed; others denied', async () => {
      for (const role of ['SUPER_ADMIN','FINANCE_AUDITOR','OPERATIONS','CUSTOMER_SERVICE']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get(`/api/v1/internal/customers/${fakeCustomerId}/transactions?limit=5`).set('Authorization', `Bearer ${tok}`);
        // 404 if customer not found is okay for authorized (means function check passed), 403 for denied
        expect([200,404]).toContain(res.status);
      }
      for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus(`/api/v1/internal/customers/${fakeCustomerId}/transactions?limit=5`, 'get', tok, null, 403);
      }
    });
    it('customer.view_wallets: SUPER_ADMIN, OPERATIONS, CUSTOMER_SERVICE allowed; others denied', async () => {
      for (const role of ['SUPER_ADMIN','OPERATIONS','CUSTOMER_SERVICE']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get(`/api/v1/internal/customers/${fakeCustomerId}/wallets`).set('Authorization', `Bearer ${tok}`);
        expect([200,404]).toContain(res.status);
      }
      for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus(`/api/v1/internal/customers/${fakeCustomerId}/wallets`, 'get', tok, null, 403);
      }
    });
    it('wallet balance (customer.view_wallets) same matrix', async () => {
      for (const role of ['SUPER_ADMIN','OPERATIONS','CUSTOMER_SERVICE']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get(`/api/v1/internal/customers/${fakeCustomerId}/wallets/${fakeWalletId}/balance`).set('Authorization', `Bearer ${tok}`);
        expect([200,404]).toContain(res.status);
      }
      for (const role of ['FINANCE_AUDITOR']) {
        const tok = await tokenForRole(role);
        await expectStatus(`/api/v1/internal/customers/${fakeCustomerId}/wallets/${fakeWalletId}/balance`, 'get', tok, null, 403);
      }
    });
    it('support-tickets via customer (customer.manage_support_case): SUPER_ADMIN, OPERATIONS, CUSTOMER_SERVICE allowed; others denied', async () => {
      for (const role of ['SUPER_ADMIN','OPERATIONS','CUSTOMER_SERVICE']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get(`/api/v1/internal/customers/${fakeCustomerId}/support-tickets?limit=5`).set('Authorization', `Bearer ${tok}`);
        expect([200,404]).toContain(res.status);
      }
      for (const role of ['FINANCE_PREPARER','FINANCE_AUDITOR','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','TREASURY','ADMINISTRATOR','FINANCE_CONTROLLER']) {
        const tok = await tokenForRole(role);
        await expectStatus(`/api/v1/internal/customers/${fakeCustomerId}/support-tickets?limit=5`, 'get', tok, null, 403);
      }
    });
  });

  describe('C. Support tickets (customer.manage_support_case)', () => {
    it('list tickets: SUPER_ADMIN, OPERATIONS, CUSTOMER_SERVICE allowed; others denied', async () => {
      for (const role of ['SUPER_ADMIN','OPERATIONS','CUSTOMER_SERVICE']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        await expectStatus('/api/v1/internal/support/tickets?limit=5', 'get', tok, null, 200);
      }
      for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/internal/support/tickets?limit=5', 'get', tok, null, 403);
      }
    });
    it('write (status) requires same function: unauthorized gets 403', async () => {
      const fakeId = randomUUID();
      for (const role of ['FINANCE_PREPARER','TREASURY']) {
        const tok = await tokenForRole(role);
        await expectStatus(`/api/v1/internal/support/tickets/${fakeId}/status`, 'post', tok, { status: 'IN_PROGRESS', version: 1 }, 403);
      }
    });
  });

  describe('D. Reconciliation (reconciliation.view)', () => {
    it('report and trial-balance: SUPER_ADMIN, FINANCE_AUDITOR, TREASURY allowed; others denied', async () => {
      for (const role of ['SUPER_ADMIN','FINANCE_AUDITOR','TREASURY']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        await expectStatus('/api/v1/internal/reconciliation/report', 'get', tok, null, 200);
        await expectStatus('/api/v1/internal/reconciliation/trial-balance', 'get', tok, null, 200);
      }
      for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','OPERATIONS','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/internal/reconciliation/report', 'get', tok, null, 403);
        await expectStatus('/api/v1/internal/reconciliation/trial-balance', 'get', tok, null, 403);
      }
    });
  });

  describe('E. Transaction observability (transaction.view / customer.view_wallets / fee_rule.view / limit.view)', () => {
    it('transfers, deposits, withdrawals GET require transaction.view', async () => {
      const paths = [`/api/v1/transfers/${fakeTransferId}`, `/api/v1/deposits/${randomUUID()}`, `/api/v1/withdrawals/${randomUUID()}`];
      for (const path of paths) {
        for (const role of ['SUPER_ADMIN','FINANCE_AUDITOR','OPERATIONS']) {
          const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
          const res = await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tok}`);
          expect([200,404]).toContain(res.status);
        }
        for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','TREASURY','ADMINISTRATOR']) {
          const tok = await tokenForRole(role);
          await expectStatus(path, 'get', tok, null, 403);
        }
      }
    });
    it('wallets GET require customer.view_wallets', async () => {
      for (const role of ['SUPER_ADMIN','OPERATIONS','CUSTOMER_SERVICE']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get(`/api/v1/wallets/${fakeWalletId}`).set('Authorization', `Bearer ${tok}`);
        expect([200,404]).toContain(res.status);
      }
      for (const role of ['FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus(`/api/v1/wallets/${fakeWalletId}`, 'get', tok, null, 403);
      }
    });
    it('fee-rules registry requires fee_rule.view', async () => {
      for (const role of ['SUPER_ADMIN','FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get('/api/v1/internal/fee-rules').set('Authorization', `Bearer ${tok}`);
        if (res.status === 403) throw new Error(`${role} should be allowed fee_rule.view but got 403 ${JSON.stringify(res.body).slice(0,300)}`);
        expect([200,400]).toContain(res.status);
      }
      for (const role of ['OPERATIONS','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/internal/fee-rules', 'get', tok, null, 403);
      }
    });
    it('commission-rules registry requires commission_rule.view', async () => {
      for (const role of ['SUPER_ADMIN','FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get('/api/v1/internal/commission-rules').set('Authorization', `Bearer ${tok}`);
        if (res.status === 403) throw new Error(`${role} should be allowed commission_rule.view but got 403 ${JSON.stringify(res.body).slice(0,300)}`);
        expect([200,400]).toContain(res.status);
      }
      for (const role of ['OPERATIONS','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/internal/commission-rules', 'get', tok, null, 403);
      }
    });
    it('limit catalogue requires limit.view', async () => {
      for (const role of ['SUPER_ADMIN','FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR','AGENT_NETWORK_MANAGER']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        const res = await request(app.getHttpServer()).get('/api/v1/internal/limit-profiles').set('Authorization', `Bearer ${tok}`);
        if (res.status === 403) throw new Error(`${role} should be allowed limit.view but got 403 ${JSON.stringify(res.body).slice(0,300)}`);
        expect([200,400]).toContain(res.status);
      }
      for (const role of ['OPERATIONS','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/internal/limit-profiles', 'get', tok, null, 403);
      }
    });
  });

  describe('F. Ledger (ledger.view)', () => {
    it('ledger.view: SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR allowed; others denied', async () => {
      for (const role of ['SUPER_ADMIN','FINANCE_PREPARER','FINANCE_CONTROLLER','FINANCE_AUDITOR']) {
        const tok = role==='SUPER_ADMIN' ? await loginSuperAdmin() : await tokenForRole(role);
        await expectStatus('/api/v1/ledger/accounts', 'get', tok, null, 200);
      }
      for (const role of ['OPERATIONS','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','TREASURY','ADMINISTRATOR']) {
        const tok = await tokenForRole(role);
        await expectStatus('/api/v1/ledger/accounts', 'get', tok, null, 403);
      }
    });
  });
});
