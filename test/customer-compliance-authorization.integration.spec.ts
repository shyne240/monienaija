/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { CustomerComplianceAccessGuard } from '../src/customer-compliance/customer-compliance-access.guard';
import { AuditService } from '../src/operations/audit.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

/** Real HTTP, global/class guards, workforce session validation, active DB grants and PG transactions. */
describe('Customer compliance authorization (real PostgreSQL + real HTTP)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('complianceauth');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = module.get(A2WorkforceSessionService);
  }, 180_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    if (app) await app.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60_000);

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const casesUrl = (customerId: string) => `/api/v1/customers/${customerId}/compliance-cases`;
  const caseUrl = (customerId: string, caseId: string) => `${casesUrl(customerId)}/${caseId}`;

  async function workforce(...roles: string[]): Promise<{ token: string; principalId: string }> {
    const principalId = `compliance-test:${randomUUID()}`;
    const now = new Date();
    for (const roleKey of roles) {
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `case:${randomUUID()}`,
        assignmentVersion: 1,
        principalId,
        roleKey,
        scopes: [],
        status: 'ACTIVE',
        interim: true,
        effectiveFrom: new Date(now.getTime() - 60_000),
        effectiveTo: new Date(now.getTime() + 3_600_000),
        assignedBy: 'test-harness',
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
      });
    }
    const result = await sessions.establish({
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
      signingKeyId: 'integration-test',
    });
    return { token: result.accessToken, principalId };
  }

  async function customer(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
      [`case-customer-${randomUUID()}`],
    );
    return rows[0]!.id;
  }

  async function createCase(customerId: string, token: string, category = 'AML') {
    const response = await request(app.getHttpServer())
      .post(casesUrl(customerId))
      .set(auth(token))
      .send({
        caseNumber: `case-${randomUUID()}`,
        category,
        severity: 'MEDIUM',
        actor: 'spoofed-actor',
      })
      .expect(201);
    return response.body as { id: string; customerId: string; category: string; openedBy: string };
  }

  function passwordHash(password: string): string {
    const salt = Buffer.from('case-auth-test-salt');
    const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
    return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
  }

  async function customerToken(customerId: string): Promise<string> {
    const password = 'customer-case-test-password';
    await dataSource.query(
      `INSERT INTO customer_authentication_credentials
        (customer_id, password_hash, hash_algorithm, password_version, password_changed_at,
         status, account_locked, failed_authentication_count, version)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, passwordHash(password)],
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/customers/sessions')
      .send({ customerId, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  async function agentToken(): Promise<string> {
    const cls: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits)
       VALUES ($1,$2,'Case test class',true,$3,$4) RETURNING id`,
      [
        `case-class-${randomUUID()}`,
        `C-${randomUUID().slice(0, 8)}`,
        JSON.stringify(['CASH_IN']),
        JSON.stringify({}),
      ],
    );
    const agents: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`case-agent-${randomUUID()}`, cls[0]!.id],
    );
    const password = 'agent-case-test-password';
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials
        (agent_id,password_hash,hash_algorithm,password_version,password_changed_at,status)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agents[0]!.id, passwordHash(password)],
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId: agents[0]!.id, password })
      .expect(200);
    return response.body.accessToken as string;
  }

  it('preserves a complete compliance workflow and binds every audit/history actor to the session', async () => {
    const user = await workforce('COMPLIANCE');
    const id = await customer();
    const created = await createCase(id, user.token, 'KYC');
    expect(created.openedBy).toBe(user.principalId);
    const base = caseUrl(id, created.id);

    const list = await request(app.getHttpServer())
      .get(casesUrl(id))
      .set(auth(user.token))
      .expect(200);
    expect(list.body.map((entry: any) => entry.id)).toEqual([created.id]);
    await request(app.getHttpServer()).get(base).set(auth(user.token)).expect(200);
    const assignment = await request(app.getHttpServer())
      .post(`${base}/assignment`)
      .set(auth(user.token))
      .send({ assignedTo: 'investigator-1', actor: 'spoofed-actor' })
      .expect(201);
    expect(assignment.body.assignedBy).toBe(user.principalId);
    const comment = await request(app.getHttpServer())
      .post(`${base}/comment`)
      .set(auth(user.token))
      .send({ comment: 'Review recorded', actor: 'spoofed-actor' })
      .expect(201);
    expect(comment.body.actor).toBe(user.principalId);
    const evidence = await request(app.getHttpServer())
      .post(`${base}/evidence`)
      .set(auth(user.token))
      .send({
        documentName: 'Review record',
        documentType: 'NOTE',
        reference: 'ev-1',
        uploadedBy: 'spoofed-actor',
      })
      .expect(201);
    expect(evidence.body.uploadedBy).toBe(user.principalId);
    const update = await request(app.getHttpServer())
      .patch(base)
      .set(auth(user.token))
      .send({ status: 'UNDER_REVIEW', actor: 'spoofed-actor' })
      .expect(200);
    expect(update.body.status).toBe('UNDER_REVIEW');
    await request(app.getHttpServer())
      .get(`${base}/comments`)
      .set(auth(user.token))
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(1));
    await request(app.getHttpServer())
      .get(`${base}/evidence`)
      .set(auth(user.token))
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(1));
    await request(app.getHttpServer())
      .get(`${base}/assignments`)
      .set(auth(user.token))
      .expect(200)
      .expect((res) => expect(res.body).toHaveLength(1));
    const history = await request(app.getHttpServer())
      .get(`${base}/history`)
      .set(auth(user.token))
      .expect(200);
    expect(history.body.map((entry: any) => entry.action)).toEqual(
      expect.arrayContaining([
        'CASE_CREATED',
        'ASSIGNMENT_CHANGED',
        'COMMENT_ADDED',
        'EVIDENCE_ADDED',
        'STATUS_CHANGED',
      ]),
    );
    expect(history.body.every((entry: any) => entry.actor === user.principalId)).toBe(true);
    const audits: Array<{ actor: string; entity_type: string }> = await dataSource.query(
      `SELECT actor, entity_type FROM audit_events
        WHERE entity_type IN ('CUSTOMER_COMPLIANCE_CASE','COMPLIANCE_CASE_COMMENT',
                              'COMPLIANCE_CASE_EVIDENCE','COMPLIANCE_CASE_ASSIGNMENT','COMPLIANCE_CASE_HISTORY')`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(9);
    expect(audits.every((event) => event.actor === user.principalId)).toBe(true);
    expect(audits.map((event) => event.entity_type)).toEqual(
      expect.arrayContaining([
        'CUSTOMER_COMPLIANCE_CASE',
        'COMPLIANCE_CASE_COMMENT',
        'COMPLIANCE_CASE_EVIDENCE',
        'COMPLIANCE_CASE_ASSIGNMENT',
        'COMPLIANCE_CASE_HISTORY',
      ]),
    );
  });

  it('enforces category isolation for lists, every subresource and mutations in both directions', async () => {
    const compliance = await workforce('COMPLIANCE');
    const fraud = await workforce('RISK_FRAUD');
    const id = await customer();
    const aml = await createCase(id, compliance.token, 'AML');
    const fraudCase = await createCase(id, fraud.token, 'FRAUD');
    const amlBase = caseUrl(id, aml.id);
    const fraudBase = caseUrl(id, fraudCase.id);
    await request(app.getHttpServer())
      .post(`${amlBase}/evidence`)
      .set(auth(compliance.token))
      .send({
        documentName: 'Sensitive AML evidence',
        documentType: 'NOTE',
        reference: 'aml-evidence',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${fraudBase}/evidence`)
      .set(auth(fraud.token))
      .send({
        documentName: 'Sensitive fraud evidence',
        documentType: 'NOTE',
        reference: 'fraud-evidence',
      })
      .expect(201);
    const cList = await request(app.getHttpServer())
      .get(casesUrl(id))
      .set(auth(compliance.token))
      .expect(200);
    const fList = await request(app.getHttpServer())
      .get(casesUrl(id))
      .set(auth(fraud.token))
      .expect(200);
    expect(cList.body.map((entry: any) => entry.id)).toEqual([aml.id]);
    expect(fList.body.map((entry: any) => entry.id)).toEqual([fraudCase.id]);

    const hiddenCases: Array<[string, string]> = [
      [fraud.token, amlBase],
      [compliance.token, fraudBase],
    ];
    for (const [token, hidden] of hiddenCases) {
      for (const suffix of ['', '/comments', '/evidence', '/assignments', '/history']) {
        await request(app.getHttpServer()).get(`${hidden}${suffix}`).set(auth(token)).expect(404);
      }
      await request(app.getHttpServer())
        .patch(hidden)
        .set(auth(token))
        .send({ status: 'UNDER_REVIEW' })
        .expect(404);
      await request(app.getHttpServer())
        .post(`${hidden}/comment`)
        .set(auth(token))
        .send({ comment: 'no' })
        .expect(404);
      await request(app.getHttpServer())
        .post(`${hidden}/evidence`)
        .set(auth(token))
        .send({ documentName: 'no', documentType: 'NOTE', reference: 'no' })
        .expect(404);
      await request(app.getHttpServer())
        .post(`${hidden}/assignment`)
        .set(auth(token))
        .send({ assignedTo: 'no' })
        .expect(404);
    }
    await request(app.getHttpServer())
      .post(casesUrl(id))
      .set(auth(fraud.token))
      .send({ caseNumber: `denied-${randomUUID()}`, category: 'SANCTIONS', severity: 'HIGH' })
      .expect(403);
    await request(app.getHttpServer())
      .post(casesUrl(id))
      .set(auth(compliance.token))
      .send({ caseNumber: `denied-${randomUUID()}`, category: 'FRAUD', severity: 'HIGH' })
      .expect(403);
    const rows = await dataSource.query(
      `SELECT category,status FROM customer_compliance_cases ORDER BY category`,
    );
    expect(rows).toEqual([
      { category: 'AML', status: 'OPEN' },
      { category: 'FRAUD', status: 'OPEN' },
    ]);
  });

  it('allows the union only when both separately granted functions are held', async () => {
    const compliance = await workforce('COMPLIANCE');
    const fraud = await workforce('RISK_FRAUD');
    const both = await workforce('COMPLIANCE', 'RISK_FRAUD');
    const superAdmin = await workforce('SUPER_ADMIN');
    const id = await customer();
    const aml = await createCase(id, compliance.token);
    const fraudCase = await createCase(id, fraud.token, 'FRAUD');
    const all = await request(app.getHttpServer())
      .get(casesUrl(id))
      .set(auth(both.token))
      .expect(200);
    expect(all.body.map((entry: any) => entry.id).sort()).toEqual([aml.id, fraudCase.id].sort());
    await request(app.getHttpServer())
      .get(caseUrl(id, fraudCase.id))
      .set(auth(both.token))
      .expect(200);
    await request(app.getHttpServer())
      .get(caseUrl(id, aml.id))
      .set(auth(superAdmin.token))
      .expect(200);
    await request(app.getHttpServer())
      .get(caseUrl(id, fraudCase.id))
      .set(auth(superAdmin.token))
      .expect(404);
  });

  it('checks the case/customer pair on all reads and writes, including history and evidence', async () => {
    const user = await workforce('COMPLIANCE');
    const first = await customer();
    const second = await customer();
    const one = await createCase(first, user.token);
    const two = await createCase(second, user.token, 'KYC');
    const wrong = caseUrl(second, one.id);
    const list = await request(app.getHttpServer())
      .get(casesUrl(second))
      .set(auth(user.token))
      .expect(200);
    expect(list.body.map((entry: any) => entry.id)).toEqual([two.id]);
    for (const suffix of ['', '/comments', '/evidence', '/assignments', '/history']) {
      await request(app.getHttpServer()).get(`${wrong}${suffix}`).set(auth(user.token)).expect(404);
    }
    await request(app.getHttpServer())
      .patch(wrong)
      .set(auth(user.token))
      .send({ status: 'UNDER_REVIEW' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`${wrong}/comment`)
      .set(auth(user.token))
      .send({ comment: 'no' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`${wrong}/assignment`)
      .set(auth(user.token))
      .send({ assignedTo: 'no' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`${wrong}/evidence`)
      .set(auth(user.token))
      .send({ documentName: 'no', documentType: 'NOTE', reference: 'no' })
      .expect(404);
    const history = await dataSource.query(
      `SELECT action FROM compliance_case_histories WHERE case_id = $1`,
      [one.id],
    );
    expect(history).toEqual([{ action: 'CASE_CREATED' }]);
  });

  it('rejects missing credentials and unentitled roles across all eleven handlers', async () => {
    const id = await customer();
    const missingCase = randomUUID();
    const base = caseUrl(id, missingCase);
    const routes: Array<['get' | 'post' | 'patch', string, object | undefined]> = [
      ['get', casesUrl(id), undefined],
      ['post', casesUrl(id), {}],
      ['get', base, undefined],
      ['patch', base, {}],
      ['post', `${base}/comment`, {}],
      ['get', `${base}/comments`, undefined],
      ['post', `${base}/evidence`, {}],
      ['get', `${base}/evidence`, undefined],
      ['post', `${base}/assignment`, {}],
      ['get', `${base}/assignments`, undefined],
      ['get', `${base}/history`, undefined],
    ];
    const ops = await workforce('OPERATIONS');
    for (const [method, url, payload] of routes) {
      const noAuth = request(app.getHttpServer())[method](url);
      if (payload) noAuth.send(payload);
      await noAuth.expect(401);
      const noFunction = request(app.getHttpServer())[method](url).set(auth(ops.token));
      if (payload) noFunction.send(payload);
      await noFunction.expect(403);
    }
    const denied = await dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='AUTHORIZATION_DECISION' AND actor=$1 AND action='DENIED'`,
      [ops.principalId],
    );
    expect(denied.length).toBe(11);
    expect(denied.every((row: any) => row.new_values.reason === 'FUNCTION_MISSING')).toBe(true);
    expect(denied.some((row: any) => row.new_values.customerId === id)).toBe(true);
  });

  it.each([
    'FINANCE_PREPARER',
    'FINANCE_CONTROLLER',
    'FINANCE_AUDITOR',
    'OPERATIONS',
    'AGENT_NETWORK_MANAGER',
    'CUSTOMER_SERVICE',
    'TREASURY',
    'ADMINISTRATOR',
  ])('denies unentitled %s despite workforce authentication', async (role) => {
    const user = await workforce(role);
    const id = await customer();
    await request(app.getHttpServer()).get(casesUrl(id)).set(auth(user.token)).expect(403);
    await request(app.getHttpServer())
      .post(casesUrl(id))
      .set(auth(user.token))
      .send({ caseNumber: `no-${randomUUID()}`, category: 'AML', severity: 'LOW' })
      .expect(403);
  });

  it('rejects genuine customer (including self), agent and SUPPORT sessions', async () => {
    const id = await customer();
    const other = await customer();
    const cToken = await customerToken(id);
    await request(app.getHttpServer())
      .get('/api/v1/customers/me/compliance-cases')
      .set(auth(cToken))
      .expect(403);
    const aToken = await agentToken();
    const admin = await workforce('SUPER_ADMIN');
    const provision = await request(app.getHttpServer())
      .post('/api/v1/internal/admin/support/workforce-users')
      .set(auth(admin.token))
      .send({ username: `case.support.${randomUUID().slice(0, 8)}` })
      .expect(201);
    const support = await request(app.getHttpServer())
      .post('/api/v1/internal/support/workforce-sessions')
      .send({ username: provision.body.username, password: provision.body.temporaryPassword })
      .expect(200);
    for (const token of [cToken, aToken, support.body.accessToken as string]) {
      for (const subject of [id, other]) {
        await request(app.getHttpServer()).get(casesUrl(subject)).set(auth(token)).expect(403);
        await request(app.getHttpServer())
          .post(casesUrl(subject))
          .set(auth(token))
          .send({ caseNumber: `no-${randomUUID()}`, category: 'AML', severity: 'LOW' })
          .expect(403);
      }
    }
  });

  it('denies non-workforce principal types even if presented with an active case function', async () => {
    // A2 sessions currently issue only OPERATOR/PRIVILEGED. Exercise the actual case guard
    // against hypothetical other principal types with real PG grants and audited decisions,
    // independently of the genuine customer, agent and SUPPORT HTTP tests above.
    const id = await customer();
    const guard = app.get(CustomerComplianceAccessGuard);
    const common = {
      roles: ['COMPLIANCE'],
      scopes: ['compliance.manage_case'],
      customerAccess: 'NONE' as const,
    };
    const principals: AuthorizationPrincipal[] = [
      { ...common, type: 'SERVICE', principalId: `service:${randomUUID()}` },
      { ...common, type: 'SUPPORT', principalId: `support:${randomUUID()}` },
      { ...common, type: 'CUSTOMER', principalId: `customer:${randomUUID()}`, customerId: id },
      { ...common, type: 'AGENT', principalId: `agent:${randomUUID()}`, agentId: randomUUID() },
      {
        ...common,
        type: 'AGGREGATOR',
        principalId: `aggregator:${randomUUID()}`,
        aggregatorId: randomUUID(),
      },
    ];
    for (const principal of principals) {
      for (const method of ['GET', 'PATCH']) {
        await expect(guard.resolveAccess(principal, method, { id })).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
      const decisions = await dataSource.query(
        `SELECT new_values FROM audit_events
          WHERE entity_type='AUTHORIZATION_DECISION' AND actor=$1 AND action='DENIED'`,
        [principal.principalId],
      );
      expect(decisions).toHaveLength(2);
      expect(decisions.every((row: any) => row.new_values.reason === 'PRINCIPAL_TYPE_DENIED')).toBe(
        true,
      );
    }
  });

  it('distinguishes VIEW from EXECUTE and does not treat INITIATE or APPROVE as case access', async () => {
    const user = await workforce('COMPLIANCE');
    const id = await customer();
    const created = await createCase(id, user.token);
    await request(app.getHttpServer())
      .post(`${caseUrl(id, created.id)}/evidence`)
      .set(auth(user.token))
      .send({ documentName: 'Existing evidence', documentType: 'NOTE', reference: 'view-test' })
      .expect(201);
    for (const accessType of ['VIEW', 'INITIATE', 'APPROVE']) {
      await dataSource.query(
        `UPDATE authorization_role_functions SET access_type=$1
          WHERE role_id=(SELECT id FROM authorization_roles WHERE role_key='COMPLIANCE')
            AND function_code='compliance.manage_case'`,
        [accessType],
      );
      await request(app.getHttpServer())
        .get(casesUrl(id))
        .set(auth(user.token))
        .expect(accessType === 'VIEW' ? 200 : 403);
      await request(app.getHttpServer())
        .get(`${caseUrl(id, created.id)}/evidence`)
        .set(auth(user.token))
        .expect(accessType === 'VIEW' ? 200 : 403);
      await request(app.getHttpServer())
        .patch(caseUrl(id, created.id))
        .set(auth(user.token))
        .send({ status: 'UNDER_REVIEW' })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${caseUrl(id, created.id)}/evidence`)
        .set(auth(user.token))
        .send({ documentName: 'no', documentType: 'NOTE', reference: 'no' })
        .expect(403);
    }
    const stored = await dataSource.query(
      `SELECT status FROM customer_compliance_cases WHERE id=$1`,
      [created.id],
    );
    expect(stored).toEqual([{ status: 'OPEN' }]);
  });

  it('keeps case audit records off generic audit and dashboard views, including historical route decisions', async () => {
    const compliance = await workforce('COMPLIANCE');
    const ops = await workforce('OPERATIONS');
    const auditor = await workforce('FINANCE_AUDITOR');
    const id = await customer();
    const created = await createCase(id, compliance.token);
    await request(app.getHttpServer())
      .post(`${caseUrl(id, created.id)}/evidence`)
      .set(auth(compliance.token))
      .send({
        documentName: 'restricted-evidence',
        documentType: 'NOTE',
        reference: 'restricted-reference',
      })
      .expect(201);
    // A pre-hardening generic-customer authorization decision stored the request URL in action.
    await dataSource.query(
      `INSERT INTO audit_events (id,entity_type,entity_id,action,actor,new_values,occurred_at)
       VALUES ($1,'AUTHORIZATION_DECISION',$2,'ALLOWED','legacy',$3::jsonb,now())`,
      [
        randomUUID(),
        created.id,
        JSON.stringify({ resourceType: 'customer', action: `GET:${caseUrl(id, created.id)}` }),
      ],
    );
    await dataSource.query(
      `INSERT INTO audit_events (id,entity_type,entity_id,action,actor,new_values,occurred_at)
       VALUES ($1,'OTHER_AUDIT_TEST',$2,'CREATED','test',$3::jsonb,now())`,
      [randomUUID(), randomUUID(), JSON.stringify({ safe: true })],
    );
    // A4 and A7 emit reason codes with a customer ID in policy audit facts. These are an
    // alternate way to learn a case exists, even if the case ID and payload are absent.
    const restrictedPolicyIds: string[] = [];
    for (const [marker, reasonCodes] of [
      ['restricted-a4-policy', ['OTHER_REASON', 'COMPLIANCE_CASE_OPEN']],
      ['restricted-a7-policy', ['COMPLIANCE_REVIEW_OPEN']],
      ['restricted-future-policy', ['COMPLIANCE_FUTURE_REASON']],
      ['safe-policy-audit', ['CUSTOMER_INACTIVE']],
    ] as Array<[string, string[]]>) {
      const entityId = randomUUID();
      if (marker.startsWith('restricted')) restrictedPolicyIds.push(entityId);
      await dataSource.query(
        `INSERT INTO audit_events (id,entity_type,entity_id,action,actor,new_values,occurred_at)
         VALUES ($1,'A4_POLICY_DECISION',$2,'DECISION_CREATED','test',$3::jsonb,now())`,
        [
          randomUUID(),
          entityId,
          JSON.stringify({ customerId: id, marker, metadata: { reasonCodes } }),
        ],
      );
    }
    for (const [marker, reasonCodes] of [
      ['restricted-malformed-value', 'COMPLIANCE_CASE_OPEN'],
      ['restricted-malformed-item', [{ code: 'COMPLIANCE_REVIEW_OPEN' }]],
    ] as Array<[string, unknown]>) {
      const entityId = randomUUID();
      restrictedPolicyIds.push(entityId);
      await dataSource.query(
        `INSERT INTO audit_events (id,entity_type,entity_id,action,actor,new_values,occurred_at)
         VALUES ($1,'A4_POLICY_DECISION',$2,'DECISION_CREATED','test',$3::jsonb,now())`,
        [
          randomUUID(),
          entityId,
          JSON.stringify({ customerId: id, marker, metadata: { reasonCodes } }),
        ],
      );
    }
    await dataSource.query(
      `INSERT INTO audit_events (id,entity_type,entity_id,action,actor,new_values,occurred_at)
       VALUES ($1,'A4_POLICY_DECISION',$2,'DECISION_PERSISTED','test',$3::jsonb,now())`,
      [randomUUID(), randomUUID(), JSON.stringify({ marker: 'safe-policy-no-reasons' })],
    );
    // The service filters by default; explicitly trusted internal consumers can still read
    // the stored records. The opt-in is never taken from an HTTP request.
    expect(
      await app
        .get(AuditService)
        .list({ entityType: 'CUSTOMER_COMPLIANCE_CASE', entityId: created.id }),
    ).toHaveLength(0);
    expect(
      await app
        .get(AuditService)
        .list(
          { entityType: 'CUSTOMER_COMPLIANCE_CASE', entityId: created.id },
          { includeComplianceCaseRecords: true },
        ),
    ).not.toHaveLength(0);
    for (const entityId of restrictedPolicyIds) {
      expect(
        await app.get(AuditService).list({ entityType: 'A4_POLICY_DECISION', entityId }),
      ).toEqual([]);
      expect(
        await app
          .get(AuditService)
          .list(
            { entityType: 'A4_POLICY_DECISION', entityId },
            { includeComplianceCaseRecords: true },
          ),
      ).toHaveLength(1);
    }
    // REPORT-34 H-01-R2 (strict audit gate): OPERATIONS no longer holds audit access. Denial is
    // asserted separately below, so the compliance-record filtering is proven for the role that
    // is actually entitled to read the generic audit listing (FINANCE_AUDITOR holds audit.view).
    for (const user of [auditor]) {
      const direct = await request(app.getHttpServer())
        .get(
          `/api/v1/internal/audit?entityType=CUSTOMER_COMPLIANCE_CASE&entityId=${created.id}&includeComplianceCaseRecords=true`,
        )
        .set(auth(user.token))
        .expect(200);
      expect(direct.body).toEqual([]);
      const generic = await request(app.getHttpServer())
        .get('/api/v1/internal/audit?limit=1000')
        .set(auth(user.token))
        .expect(200);
      const text = JSON.stringify(generic.body);
      expect(text).not.toContain(created.id);
      expect(text).not.toContain('restricted-reference');
      expect(text).not.toContain('restricted-a4-policy');
      expect(text).not.toContain('restricted-a7-policy');
      expect(text).not.toContain('restricted-future-policy');
      expect(text).not.toContain('restricted-malformed-value');
      expect(text).not.toContain('restricted-malformed-item');
      expect(text).toContain('safe-policy-audit');
      expect(text).toContain('safe-policy-no-reasons');
      expect(text).toContain('OTHER_AUDIT_TEST');
      const policyById = await request(app.getHttpServer())
        .get(
          `/api/v1/internal/audit?entityType=A4_POLICY_DECISION&entityId=${restrictedPolicyIds[0]}&includeComplianceCaseRecords=true`,
        )
        .set(auth(user.token))
        .expect(200);
      expect(policyById.body).toEqual([]);
    }

    // A catalogue principal without audit.view (OPERATIONS) is denied the whole route — on GET and
    // on the HEAD alias — and therefore cannot observe any compliance or policy audit record.
    for (const denied of [ops]) {
      await request(app.getHttpServer())
        .get('/api/v1/internal/audit?limit=1000')
        .set(auth(denied.token))
        .expect(403);
      await request(app.getHttpServer())
        .get(
          `/api/v1/internal/audit?entityType=CUSTOMER_COMPLIANCE_CASE&entityId=${created.id}&includeComplianceCaseRecords=true`,
        )
        .set(auth(denied.token))
        .expect(403);
      await request(app.getHttpServer())
        .head('/api/v1/internal/audit')
        .set(auth(denied.token))
        .expect(403);
    }
    const widget = await request(app.getHttpServer())
      .get('/api/v1/internal/a2/workforce/dashboard/widgets/audit-trail?limit=50')
      .set(auth(auditor.token))
      .expect(200);
    expect(JSON.stringify(widget.body)).not.toContain(created.id);
    expect(JSON.stringify(widget.body)).not.toContain('restricted-reference');
    expect(JSON.stringify(widget.body)).not.toContain('restricted-a4-policy');
    expect(JSON.stringify(widget.body)).not.toContain('restricted-a7-policy');
    expect(JSON.stringify(widget.body)).not.toContain('restricted-future-policy');
    expect(JSON.stringify(widget.body)).not.toContain('restricted-malformed-value');
    expect(JSON.stringify(widget.body)).not.toContain('restricted-malformed-item');
    expect(JSON.stringify(widget.body)).toContain('safe-policy-audit');
    expect(JSON.stringify(widget.body)).toContain('safe-policy-no-reasons');
    expect(JSON.stringify(widget.body)).toContain('OTHER_AUDIT_TEST');
  });

  it('enforces the same live category grant and access type on compliance dashboard summaries', async () => {
    const compliance = await workforce('COMPLIANCE');
    const fraud = await workforce('RISK_FRAUD');
    const id = await customer();
    await createCase(id, compliance.token, 'AML');
    await createCase(id, fraud.token, 'FRAUD');
    const dashboard = '/api/v1/internal/a2/workforce/dashboard/widgets';
    const c = await request(app.getHttpServer())
      .get(`${dashboard}/compliance-case-summary`)
      .set(auth(compliance.token))
      .expect(200);
    expect(c.body.byCategoryStatus).toEqual([{ category: 'AML', status: 'OPEN', count: 1 }]);
    const f = await request(app.getHttpServer())
      .get(`${dashboard}/fraud-case-summary`)
      .set(auth(fraud.token))
      .expect(200);
    expect(f.body.byStatus).toEqual([{ status: 'OPEN', count: 1 }]);
    await request(app.getHttpServer())
      .get(`${dashboard}/compliance-case-summary`)
      .set(auth(fraud.token))
      .expect(403);
    await request(app.getHttpServer())
      .get(`${dashboard}/fraud-case-summary`)
      .set(auth(compliance.token))
      .expect(403);
    for (const [accessType, status] of [
      ['VIEW', 200],
      ['INITIATE', 403],
      ['APPROVE', 403],
    ] as const) {
      await dataSource.query(
        `UPDATE authorization_role_functions SET access_type=$1
          WHERE role_id=(SELECT id FROM authorization_roles WHERE role_key='COMPLIANCE')
            AND function_code='compliance.manage_case'`,
        [accessType],
      );
      await request(app.getHttpServer())
        .get(`${dashboard}/compliance-case-summary`)
        .set(auth(compliance.token))
        .expect(status);
    }
  });

  it('rechecks active grants on an already-issued session and fails closed after revocation', async () => {
    const user = await workforce('COMPLIANCE');
    const id = await customer();
    await request(app.getHttpServer()).get(casesUrl(id)).set(auth(user.token)).expect(200);
    await dataSource.query(
      `UPDATE authorization_role_functions SET is_active=false
        WHERE role_id=(SELECT id FROM authorization_roles WHERE role_key='COMPLIANCE')
          AND function_code='compliance.manage_case'`,
    );
    await request(app.getHttpServer()).get(casesUrl(id)).set(auth(user.token)).expect(403);
    await request(app.getHttpServer())
      .post(casesUrl(id))
      .set(auth(user.token))
      .send({ caseNumber: `no-${randomUUID()}`, category: 'AML', severity: 'LOW' })
      .expect(403);
  });

  it('rechecks the category under the case row lock if it changes concurrently', async () => {
    const user = await workforce('COMPLIANCE');
    const id = await customer();
    const created = await createCase(id, user.token, 'AML');
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<{ status: number }> | undefined;
    try {
      // Test-only privileged SQL simulates a concurrent external category change. There is
      // deliberately no category-change endpoint in the case workflow.
      const holder: Array<{ pid: number }> = await runner.query(`SELECT pg_backend_pid() AS pid`);
      await runner.query(`UPDATE customer_compliance_cases SET category='FRAUD' WHERE id=$1`, [
        created.id,
      ]);
      pending = request(app.getHttpServer())
        .patch(caseUrl(id, created.id))
        .set(auth(user.token))
        .send({ status: 'UNDER_REVIEW' })
        .then((response) => response);
      let blocked = false;
      for (let attempt = 0; attempt < 120 && !blocked; attempt++) {
        const rows: Array<{ count: string }> = await dataSource.query(
          `SELECT count(*) AS count FROM pg_stat_activity
            WHERE datname=current_database() AND wait_event_type='Lock'
              AND $1 = ANY(pg_blocking_pids(pid))`,
          [holder[0]!.pid],
        );
        blocked = Number(rows[0]?.count ?? 0) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      await runner.commitTransaction();
      expect((await pending).status).toBe(404);
      expect(
        await dataSource.query(
          `SELECT category,status FROM customer_compliance_cases WHERE id=$1`,
          [created.id],
        ),
      ).toEqual([{ category: 'FRAUD', status: 'OPEN' }]);
      expect(
        await dataSource.query(`SELECT action FROM compliance_case_histories WHERE case_id=$1`, [
          created.id,
        ]),
      ).toEqual([{ action: 'CASE_CREATED' }]);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (pending) await pending.catch(() => undefined);
      await runner.release();
    }
  });

  it('rolls back case mutation and history when the transactional business audit fails', async () => {
    const user = await workforce('COMPLIANCE');
    const id = await customer();
    const created = await createCase(id, user.token);
    const base = caseUrl(id, created.id);
    await dataSource.query(`CREATE FUNCTION test_reject_case_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.entity_type = 'COMPLIANCE_CASE_COMMENT' THEN RAISE EXCEPTION 'test audit failure'; END IF;
      RETURN NEW; END $$`);
    await dataSource.query(`CREATE TRIGGER test_reject_case_audit BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION test_reject_case_audit()`);
    try {
      await request(app.getHttpServer())
        .post(`${base}/comment`)
        .set(auth(user.token))
        .send({ comment: 'must roll back' })
        .expect(500);
      expect(
        await dataSource.query(`SELECT id FROM compliance_case_comments WHERE case_id=$1`, [
          created.id,
        ]),
      ).toHaveLength(0);
      const history = await dataSource.query(
        `SELECT action FROM compliance_case_histories WHERE case_id=$1`,
        [created.id],
      );
      expect(history).toEqual([{ action: 'CASE_CREATED' }]);
    } finally {
      await dataSource.query(`DROP TRIGGER test_reject_case_audit ON audit_events`);
      await dataSource.query(`DROP FUNCTION test_reject_case_audit()`);
    }
    await request(app.getHttpServer())
      .post(`${base}/comment`)
      .set(auth(user.token))
      .send({ comment: 'works after recovery' })
      .expect(201);
    const count = await dataSource.query(
      `SELECT id FROM compliance_case_comments WHERE case_id=$1`,
      [created.id],
    );
    expect(count).toHaveLength(1);
  });
});
