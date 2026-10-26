/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
/**
 * V1-SPRINT2-FUNDING-INBOX-01 (ARENA 3) — global, read-only funding/defunding discovery
 * inbox for the Decision 7 independent checker:
 *
 *   GET /api/v1/internal/agents/funding-requests
 *       ?status=PENDING|REJECTED|EXECUTED
 *       &direction=FUND|DEFUND
 *       &page=<int >= 1>
 *       &limit=<int 1..50, default 20>
 *
 * Authorization (double-gated): RoutePolicyRegistry declares WORKFORCE_SESSION +
 * OPERATOR/SERVICE/PRIVILEGED + requiredRoles ['FINANCE_CONTROLLER'] + requiredFunctions
 * ['agent.fund','agent.defund']; AgentFundingController.requireFundingChecker and
 * AgentFundingService.assertCheckerPrincipal enforce the identical Decision 7 checker
 * policy (non-SUPER_ADMIN FINANCE_CONTROLLER, MFA assurance, both APPROVE functions).
 * The inbox requires and confers NO Agent Network function (no agent.view). Rows whose
 * maker is the caller are excluded server-side (maker-checker independence); the endpoint
 * mutates nothing.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import type { A2WorkforceConfigurationV1 } from '../src/authorization/workforce-authentication.types';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { Agent } from '../src/agent/agent.entity';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentClassService } from '../src/agent/agent-class.service';
import { WalletService } from '../src/wallet/wallet.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('V1-SPRINT2-FUNDING-INBOX-01 global funding approvals inbox (real PostgreSQL)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let maker: { token: string; id: string };
  let checker: { token: string; id: string };
  let operations: { token: string; id: string };
  let superAdmin: { token: string; id: string };

  const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
  const inbox = '/api/v1/internal/agents/funding-requests';

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
    roles: [
      {
        roleKey: 'FINANCE_CONTROLLER',
        displayName: 'Finance Controller test fixture',
        description: 'Provides the legacy approval scope used by the existing approval workflow tests.',
        enabled: true,
        scopes: ['privileged:approve'],
        applicableActions: [],
        mfaRequired: true,
        approvalCapability: true,
        makerEligible: false,
        checkerEligible: true,
        administrativeCapability: false,
      },
    ],
    makerCheckerRules: [],
    rateLimits: [
      { category: 'privileged-approval', capacity: 100, refillRatePerSecond: 100, enabled: true },
    ],
    trustedProxyAddresses: [],
  } as unknown as A2WorkforceConfigurationV1;

  async function assignRole(principalId: string, roleKey: string): Promise<void> {
    const now = new Date();
    await ds.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: randomUUID(),
      assignmentVersion: 1,
      principalId,
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
  }

  async function principalWithRoles(...roleKeys: string[]): Promise<{ token: string; id: string }> {
    const id = `inbox:${randomUUID()}`;
    for (const roleKey of roleKeys) await assignRole(id, roleKey);
    const now = new Date();
    const session = await sessions.establish({
      issuer: 'https://inbox.test',
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
    return { id, token: session.accessToken };
  }

  async function agent(): Promise<string> {
    const cls = await app.get(AgentClassService).create({
      reference: randomUUID(),
      code: `INB-${randomUUID().slice(0, 8)}`,
      name: 'Inbox Class',
      actor: 'test',
      applicableServices: ['CASH_IN', 'AGENT_FUNDING', 'AGENT_DEFUNDING'],
    });
    const entity = await ds.getRepository(Agent).save({
      id: randomUUID(),
      reference: randomUUID(),
      status: AgentStatus.ACTIVE,
      agentClassId: cls.id,
    });
    await app
      .get(WalletService)
      .createWallet({ customerId: entity.id, currency: 'NGN', idempotencyKey: randomUUID() });
    return entity.id;
  }

  async function createRequest(
    agentId: string,
    direction: 'fund' | 'defund',
  ): Promise<{ id: string; idempotencyKey: string }> {
    const idempotencyKey = randomUUID();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/${direction}-request`)
      .set(headers(maker.token))
      .send({ amountMinor: '1000', currency: 'NGN', idempotencyKey, reason: 'Inbox fixture' })
      .expect(201);
    return { id: created.body.id as string, idempotencyKey };
  }

  beforeAll(async () => {
    ds = await createIntegrationDataSource('v1fundinginbox');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(ds)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(A2WorkforceSessionService);
    maker = await principalWithRoles('AGENT_NETWORK_MANAGER');
    checker = await principalWithRoles('FINANCE_CONTROLLER');
    operations = await principalWithRoles('OPERATIONS');
    superAdmin = await principalWithRoles('SUPER_ADMIN');
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (ds) await destroyIntegrationDataSource(ds).catch(() => undefined);
  }, 60_000);

  it('A. FINANCE_CONTROLLER discovers pending funding and defunding work across Agents', async () => {
    const agentA = await agent();
    const agentB = await agent();
    const fund = await createRequest(agentA, 'fund');
    const defund = await createRequest(agentB, 'defund');

    const res = await request(app.getHttpServer())
      .get(inbox)
      .set(headers(checker.token))
      .expect(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([fund.id, defund.id]));
    const fundItem = (res.body.items as any[]).find((i) => i.id === fund.id);
    expect(fundItem.direction).toBe('FUND');
    expect(fundItem.status).toBe('PENDING');
    expect(fundItem.agentId).toBe(agentA);
    expect(fundItem.makerPrincipalId).toBe(maker.id);
    // Newest-first ordering is deterministic (created_at DESC, id DESC).
    const createdAts = (res.body.items as Array<{ createdAt: string }>).map((i) =>
      Date.parse(i.createdAt),
    );
    expect(createdAts).toEqual([...createdAts].sort((a, b) => b - a));
  });

  it('B. server-side filtering by status and direction', async () => {
    const agentA = await agent();
    const fund = await createRequest(agentA, 'fund');
    const defund = await createRequest(agentA, 'defund');

    const pending = await request(app.getHttpServer())
      .get(`${inbox}?status=PENDING&direction=DEFUND`)
      .set(headers(checker.token))
      .expect(200);
    const pendingIds = (pending.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(pendingIds).toContain(defund.id);
    expect(pendingIds).not.toContain(fund.id);
    expect(
      (pending.body.items as Array<{ direction: string }>).every((i) => i.direction === 'DEFUND'),
    ).toBe(true);

    // Reject the FUND request through the existing independent checker route, then the
    // status filter must surface it as REJECTED and drop it from PENDING.
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/funding-requests/${fund.id}/reject`)
      .set(headers(checker.token))
      .send({ reason: 'Inbox fixture rejection' })
      .expect(201);

    const rejected = await request(app.getHttpServer())
      .get(`${inbox}?status=REJECTED`)
      .set(headers(checker.token))
      .expect(200);
    const rejectedIds = (rejected.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(rejectedIds).toContain(fund.id);
    const stillPending = await request(app.getHttpServer())
      .get(`${inbox}?status=PENDING`)
      .set(headers(checker.token))
      .expect(200);
    expect((stillPending.body.items as Array<{ id: string }>).map((i) => i.id)).not.toContain(
      fund.id,
    );
  });

  it('C. pagination is server-side with a bounded page size', async () => {
    const agentA = await agent();
    const made = [
      await createRequest(agentA, 'fund'),
      await createRequest(agentA, 'fund'),
      await createRequest(agentA, 'fund'),
    ];
    const page1 = await request(app.getHttpServer())
      .get(`${inbox}?limit=2&page=1`)
      .set(headers(checker.token))
      .expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.page).toBe(1);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.total).toBeGreaterThanOrEqual(3);
    const page1Ids = (page1.body.items as Array<{ id: string }>).map((i) => i.id);

    // Walk pages until every made request has been seen exactly once.
    const seen = [...page1Ids];
    for (let page = 2; page <= 10; page++) {
      const next = await request(app.getHttpServer())
        .get(`${inbox}?limit=2&page=${page}`)
        .set(headers(checker.token))
        .expect(200);
      const nextIds = (next.body.items as Array<{ id: string }>).map((i) => i.id);
      seen.push(...nextIds);
      if (seen.length >= page1.body.total) break;
    }
    expect(new Set(seen).size).toBe(seen.length); // no duplicates across pages
    for (const m of made) expect(seen).toContain(m.id);

    await request(app.getHttpServer())
      .get(`${inbox}?page=0`)
      .set(headers(checker.token))
      .expect(400);
    await request(app.getHttpServer())
      .get(`${inbox}?limit=51`)
      .set(headers(checker.token))
      .expect(400);
    await request(app.getHttpServer())
      .get(`${inbox}?limit=abc`)
      .set(headers(checker.token))
      .expect(400);
    await request(app.getHttpServer())
      .get(`${inbox}?status=BOGUS`)
      .set(headers(checker.token))
      .expect(400);
    await request(app.getHttpServer())
      .get(`${inbox}?direction=BOGUS`)
      .set(headers(checker.token))
      .expect(400);
  });

  it('D. excludes the caller\u2019s own maker rows even when the caller holds both roles', async () => {
    const dual = await principalWithRoles('AGENT_NETWORK_MANAGER', 'FINANCE_CONTROLLER');
    const agentA = await agent();
    const own = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentA}/fund-request`)
      .set(headers(dual.token))
      .send({ amountMinor: '2500', currency: 'NGN', idempotencyKey: randomUUID(), reason: 'Dual-role own request' })
      .expect(201);
    const other = await createRequest(agentA, 'fund');

    const res = await request(app.getHttpServer())
      .get(inbox)
      .set(headers(dual.token))
      .expect(200);
    const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).not.toContain(own.body.id); // maker-checker independence, server-side
    expect(ids).toContain(other.id); // other makers' work is still discoverable
  });

  it('E. denies every non-checker identity', async () => {
    // Maker (AGENT_NETWORK_MANAGER) — has agent.fund INITIATE but is not the checker.
    await request(app.getHttpServer()).get(inbox).set(headers(maker.token)).expect(403);
    // OPERATIONS — no funding functions at all.
    await request(app.getHttpServer()).get(inbox).set(headers(operations.token)).expect(403);
    // SUPER_ADMIN — explicitly excluded from Decision 7 funding governance.
    await request(app.getHttpServer()).get(inbox).set(headers(superAdmin.token)).expect(403);
    // Agent session.
    const agentId = await agent();
    await ds.query(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE')`,
      [
        agentId,
        (() => {
          const salt = randomBytes(16);
          return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync('agent-pw', salt, 10000, 32, 'sha256').toString('base64url')}`;
        })(),
      ],
    );
    const login = await request(app.getHttpServer())
      .post('/api/v1/agents/sessions')
      .send({ agentId, password: 'agent-pw' })
      .expect(200);
    await request(app.getHttpServer())
      .get(inbox)
      .set(headers(login.body.accessToken as string))
      .expect(403);
    // Unauthenticated and garbage tokens.
    await request(app.getHttpServer()).get(inbox).expect(401);
    await request(app.getHttpServer())
      .get(inbox)
      .set('Authorization', 'Bearer garbage')
      .expect(401);
  });

  it('F. is read-only — a GET never mutates request or approval state', async () => {
    const agentA = await agent();
    const made = await createRequest(agentA, 'fund');
    await request(app.getHttpServer()).get(inbox).set(headers(checker.token)).expect(200);
    await request(app.getHttpServer())
      .get(`${inbox}?status=PENDING`)
      .set(headers(checker.token))
      .expect(200);
    const after = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentA}/funding-requests`)
      .set(headers(checker.token))
      .expect(200);
    const row = (after.body as any[]).find((r) => r.id === made.id);
    expect(row.status).toBe('PENDING');
    expect(row.approvalStatus).toBe('REQUESTED');
    expect(row.checkerPrincipalId).toBeNull();
  });

  it('G. per-Agent list route is unchanged for maker and checker', async () => {
    const agentA = await agent();
    const made = await createRequest(agentA, 'fund');
    const makerView = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentA}/funding-requests`)
      .set(headers(maker.token))
      .expect(200);
    expect((makerView.body as Array<{ id: string }>).map((r) => r.id)).toContain(made.id);
    const checkerView = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentA}/funding-requests`)
      .set(headers(checker.token))
      .expect(200);
    expect((checkerView.body as Array<{ id: string }>).map((r) => r.id)).toContain(made.id);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${agentA}/funding-requests`)
      .set(headers(operations.token))
      .expect(403);
  });
});
