/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
/**
 * V1-SPRINT2-AUTHZ-01 (ARENA 3) — HTTP-level authorization coverage for the two Agent
 * receiving-number read endpoints, which previously had NO effective authorization:
 *
 *  - GET /api/v1/agents/:id/receiving-number          (Agent-facing)
 *    Fell to the generic /agents/* SELF branch, but the runtime guard compared the
 *    caller's own session agentId with itself (no branch extracted the URL :id), so any
 *    authenticated Agent could read ANY other Agent's receiving number. Contract:
 *    docs/V1/A21-AGENT-APP-CONTRACT.md:42-43 — SELF-bound, 403/404 when :id ≠ principal.
 *
 *  - GET /api/v1/internal/agents/:id/receiving-number (workforce-facing)
 *    Fell to the generic /api/v1/internal/ branch: every workforce principal type
 *    (including SUPPORT) with zero catalogue functions. Policy:
 *    docs/V1/V1-PHASE1-AGENT-SECURITY-IMPLEMENTATION-01.md — "Internal receiving-number
 *    reads require agent.view."
 *
 * These tests pin the FIXED behavior: resource-bound SELF on the Agent route and the
 * agent.view function gate (SUPPORT excluded) on the internal route, with positive and
 * negative cases for every principal class.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

function encodePbkdf2(password: string, saltPhrase: string): string {
  const salt = Buffer.from(saltPhrase);
  const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

describe('V1-SPRINT2-AUTHZ-01 Agent receiving-number authorization (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;

  const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

  const workforceConfig = {
    enabled: true,
    environment: 'test',
    oidcIssuer: 'https://workforce.test',
    oidcJwksUri: 'https://workforce.test/jwks',
    oidcAudience: 'workforce',
    oidcClientId: 'test-client',
    internalAudience: 'workforce-admin',
    sessionTtlSeconds: 3600,
    mfaFreshnessSeconds: 300,
    oidcJwksCacheSeconds: 900,
    oidcJwksMaxStalenessSeconds: 3600,
    bootstrapEnabled: false,
    bootstrapIssuer: '',
    bootstrapAudience: '',
    bootstrapKeys: [],
    bootstrapFinanceAdminScopes: [],
    recoveryEnabled: false,
    recoveryAudience: '',
    recoveryKeys: [],
    roles: [],
    makerCheckerRules: [],
    rateLimits: [
      { category: 'privileged-approval', capacity: 100, refillRatePerSecond: 100, enabled: true },
    ],
    trustedProxyAddresses: [],
  } as unknown as A2WorkforceConfigurationV1;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1recvnumauthz');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
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
    sessions = moduleRef.get(A2WorkforceSessionService);
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource)
      await destroyIntegrationDataSource(dataSource).catch(() =>
        dataSource.destroy().catch(() => undefined),
      );
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function createActiveAgentWithNumber(): Promise<{
    agentId: string;
    receivingNumber: string;
    token: string;
  }> {
    const classRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits)
       VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
      [
        `cls-${randomUUID().slice(0, 8)}`,
        `RN-${randomUUID().slice(0, 6)}`,
        'Receiving Number Class',
        JSON.stringify(['CASH_IN', 'CASH_OUT']),
        JSON.stringify({}),
      ],
    );
    const agentRows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
      [`agent-${randomUUID()}`, classRows[0]!.id],
    );
    const agentId = agentRows[0]!.id;
    const receivingNumber = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO agent_receiving_numbers (agent_id, receiving_number, status) VALUES ($1,$2,'ACTIVE')`,
      [agentId, receivingNumber],
    );
    const password = `pw-${randomUUID().slice(0, 8)}`;
    await dataSource.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [agentId, encodePbkdf2(password, `rn-salt-${agentId.slice(0, 8)}`)],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password })
      .expect(200);
    return { agentId, receivingNumber, token: login.body.accessToken as string };
  }

  async function workforceToken(roleKey: string): Promise<string> {
    const id = `rn-authz:${randomUUID()}`;
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: randomUUID(),
      assignmentVersion: 1,
      principalId: id,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60000),
      effectiveTo: new Date(now.getTime() + 3600000),
      assignedBy: 'test',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    });
    const session = await sessions.establish({
      issuer: 'https://rn-authz.test',
      subject: id,
      principalId: id,
      audience: ['workforce-admin'],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      authenticatedAt: now.toISOString(),
      assuranceLevel: 'MFA',
      amr: ['pwd', 'otp'],
      acr: null,
      signingKeyId: 'test',
    });
    return session.accessToken;
  }

  describe('GET /api/v1/agents/:id/receiving-number (Agent-facing, SELF-bound)', () => {
    it('returns the receiving number when :id is the authenticated Agent itself', async () => {
      const self = await createActiveAgentWithNumber();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/agents/${self.agentId}/receiving-number`)
        .set(headers(self.token))
        .expect(200);
      expect(res.body.receivingNumber).toBe(self.receivingNumber);
    });

    it('denies a cross-Agent read with 403 and leaks no part of the other number', async () => {
      const victim = await createActiveAgentWithNumber();
      const attacker = await createActiveAgentWithNumber();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/agents/${victim.agentId}/receiving-number`)
        .set(headers(attacker.token))
        .expect(403);
      expect(JSON.stringify(res.body)).not.toContain(victim.receivingNumber);
    });

    it('denies a random-UUID :id with the same 403 (no existence enumeration)', async () => {
      const attacker = await createActiveAgentWithNumber();
      await request(app.getHttpServer())
        .get(`/api/v1/agents/${randomUUID()}/receiving-number`)
        .set(headers(attacker.token))
        .expect(403);
    });

    it('rejects unauthenticated and garbage-token callers with 401', async () => {
      const target = await createActiveAgentWithNumber();
      await request(app.getHttpServer())
        .get(`/api/v1/agents/${target.agentId}/receiving-number`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1/agents/${target.agentId}/receiving-number`)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('rejects workforce tokens on the Agent-facing route with 403', async () => {
      const target = await createActiveAgentWithNumber();
      const token = await workforceToken('AGENT_NETWORK_MANAGER');
      await request(app.getHttpServer())
        .get(`/api/v1/agents/${target.agentId}/receiving-number`)
        .set(headers(token))
        .expect(403);
    });

    it('leaves the SELF-derived /agents/me/receiving-number alias working', async () => {
      const self = await createActiveAgentWithNumber();
      const res = await request(app.getHttpServer())
        .get('/api/v1/agents/me/receiving-number')
        .set(headers(self.token))
        .expect(200);
      expect(res.body.receivingNumber).toBe(self.receivingNumber);
    });
  });

  describe('GET /api/v1/internal/agents/:id/receiving-number (workforce, agent.view-gated)', () => {
    it('allows AGENT_NETWORK_MANAGER (holds agent.view) to read any Agent number', async () => {
      const target = await createActiveAgentWithNumber();
      const token = await workforceToken('AGENT_NETWORK_MANAGER');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${target.agentId}/receiving-number`)
        .set(headers(token))
        .expect(200);
      expect(res.body.receivingNumber).toBe(target.receivingNumber);
    });

    it('allows SUPER_ADMIN (holds agent.view)', async () => {
      const target = await createActiveAgentWithNumber();
      const token = await workforceToken('SUPER_ADMIN');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${target.agentId}/receiving-number`)
        .set(headers(token))
        .expect(200);
      expect(res.body.receivingNumber).toBe(target.receivingNumber);
    });

    it('allows FINANCE_AUDITOR (VIEW-level agent.view grant satisfies the gate)', async () => {
      const target = await createActiveAgentWithNumber();
      const token = await workforceToken('FINANCE_AUDITOR');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${target.agentId}/receiving-number`)
        .set(headers(token))
        .expect(200);
      expect(res.body.receivingNumber).toBe(target.receivingNumber);
    });

    it('denies OPERATIONS (no agent-domain function) with 403', async () => {
      const target = await createActiveAgentWithNumber();
      const token = await workforceToken('OPERATIONS');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${target.agentId}/receiving-number`)
        .set(headers(token))
        .expect(403);
      expect(JSON.stringify(res.body)).not.toContain(target.receivingNumber);
    });

    it('denies FINANCE_CONTROLLER (deliberately holds no agent.view) with 403', async () => {
      const target = await createActiveAgentWithNumber();
      const token = await workforceToken('FINANCE_CONTROLLER');
      await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${target.agentId}/receiving-number`)
        .set(headers(token))
        .expect(403);
    });

    it('denies Agent sessions on the workforce route with 403', async () => {
      const target = await createActiveAgentWithNumber();
      const other = await createActiveAgentWithNumber();
      await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${target.agentId}/receiving-number`)
        .set(headers(other.token))
        .expect(403);
    });

    it('rejects unauthenticated callers with 401', async () => {
      const target = await createActiveAgentWithNumber();
      await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${target.agentId}/receiving-number`)
        .expect(401);
    });

    it('returns an explicit NONE view for an Agent with no receiving number', async () => {
      const token = await workforceToken('AGENT_NETWORK_MANAGER');
      const classRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO agent_classes (reference, code, name, is_active, applicable_services, applicable_limits)
         VALUES ($1,$2,$3,true,$4,$5) RETURNING id`,
        [
          `cls-${randomUUID().slice(0, 8)}`,
          `RN2-${randomUUID().slice(0, 6)}`,
          'No Number Class',
          JSON.stringify(['CASH_IN']),
          JSON.stringify({}),
        ],
      );
      const agentRows: Array<{ id: string }> = await dataSource.query(
        `INSERT INTO agents (reference, status, agent_class_id) VALUES ($1,'ACTIVE',$2) RETURNING id`,
        [`agent-${randomUUID()}`, classRows[0]!.id],
      );
      const res = await request(app.getHttpServer())
        .get(`/api/v1/internal/agents/${agentRows[0]!.id}/receiving-number`)
        .set(headers(token))
        .expect(200);
      expect(res.body.receivingNumber).toBeNull();
      expect(res.body.status).toBe('NONE');
    });
  });

  // Guard-regression pin: the resource-binding fix must not weaken the generic internal
  // surface — an unrelated internal read route keeps its pre-existing behavior.
  it('does not change unrelated internal agent routes (classes GET still agent.view-gated)', async () => {
    const operationsToken = await workforceToken('OPERATIONS');
    await request(app.getHttpServer())
      .get('/api/v1/internal/agents/classes')
      .set(headers(operationsToken))
      .expect(403);
    const auditorToken = await workforceToken('FINANCE_AUDITOR');
    await request(app.getHttpServer())
      .get('/api/v1/internal/agents/classes')
      .set(headers(auditorToken))
      .expect(200);
  });

  // Guard-regression pin: the :id extraction must NOT apply under the literal /agents/me/*
  // subtree, where an `:id` param is never an Agent id (e.g. support tickets/:id). Before
  // this pin the naive extraction turned the support-ticket owner's legitimate reads into
  // SELF-mismatch 403s (caught by v1-007-support-ticket; pinned here at the route-policy
  // boundary as well).
  it('leaves /agents/me/support ticket routes resource-unbound (owner keeps access)', async () => {
    const owner = await createActiveAgentWithNumber();
    const created = await request(app.getHttpServer())
      .post('/api/v1/agents/me/support/tickets')
      .set(headers(owner.token))
      .send({
        category: 'OTHER',
        subject: 'Receiving-number authz regression pin',
        description: 'Ensures /agents/me/* :id params are not bound as Agent ids.',
      })
      .expect(201);
    const ticketId = created.body.id as string;
    expect(ticketId).toBeTruthy();
    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/support/tickets/${ticketId}`)
      .set(headers(owner.token))
      .expect(200);
    expect(fetched.body.id).toBe(ticketId);
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/support/tickets/${ticketId}/messages`)
      .set(headers(owner.token))
      .send({ body: 'Follow-up message from the owner.' })
      .expect(201);
    // The other Agent still may not read it (controller-level ownership → 404 per V1-007).
    const other = await createActiveAgentWithNumber();
    await request(app.getHttpServer())
      .get(`/api/v1/agents/me/support/tickets/${ticketId}`)
      .set(headers(other.token))
      .expect(404);
  });
});
