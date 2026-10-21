/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * P0-A — dedicated real-PostgreSQL, real-HTTP proof suite for commercial-rule maker-checker
 * governance (Decision 2): FINANCE_PREPARER initiates a governed commercial change (fee /
 * commission / reward / product rule) but cannot approve it; FINANCE_CONTROLLER can approve a
 * permitted pending change but cannot approve their own request; live commercial rules cannot
 * be changed via an ungoverned direct-write path; unauthorized requests are rejected by the
 * backend regardless of frontend visibility; rejected/pending/approved changes preserve the
 * intended audit trail.
 *
 * Nothing authorization-relevant is mocked: real bearer-token sessions (SUPER_ADMIN via the real
 * local-admin login endpoint, other roles via a real, unmocked `A2WorkforceSessionService.establish()`
 * call after persisting a real `a2_finance_role_assignments` row — identical pattern to
 * test/v1-admin-role-definition-governance-implementation-01.integration.spec.ts), the real
 * `PrivilegedActionApprovalService`, the real commercial registry services.
 *
 * Uses synthetic test data only (generated product codes / rule payloads; no seed assumptions).
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalStatus } from '../src/authorization/privileged-action-approval.enums';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const FEE_PATH = '/api/v1/internal/fee-rules';
const COMMISSION_PATH = '/api/v1/internal/commission-rules';
const REWARD_PATH = '/api/v1/internal/reward-rules';
const PRODUCT_PATH = '/api/v1/internal/products';
const PRODUCT_GOV_PATH = '/api/v1/internal/product-governance/records';
const APPROVE_PATH = '/api/v1/internal/a2/workforce/approvals';

describe('P0-A commercial rule maker-checker governance — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessionService: A2WorkforceSessionService;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('p0acomgov01');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

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

  // ---------------------------------------------------------------- session helpers

  async function provisionRole(
    roleKey: string,
    extraRoles: string[] = [],
  ): Promise<{ principalId: string; token: string }> {
    const principalId = `p0acomgov01:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    for (const key of [roleKey, ...extraRoles]) {
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `p0-a-com-gov-01:${principalId}:${key}`,
        assignmentVersion: 1,
        principalId,
        roleKey: key,
        scopes: [],
        status: 'ACTIVE',
        initiatedScope: 'SUPER_ADMIN_SCOPE',
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
    }
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
    return { principalId, token: result.accessToken };
  }

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  const feeCreateBody = (reason: string) => ({
    reason,
    productCode: `P0A_${randomUUID().slice(0, 8).toUpperCase()}`,
    currency: 'NGN',
    percentageBps: 42,
    priority: 1,
    isActive: true,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });

  // ---------------------------------------------------------------- P0-A core lifecycle

  it('lets a FINANCE_PREPARER initiate a fee_rule.create request but never write the rule directly', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const body = feeCreateBody('P0-A governed create');

    const res = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      actionType: 'FEE_RULE_CREATE',
      resourceType: 'FEE_RULE',
      resourceId: null,
    });
    expect(res.body.approvalId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.body.actionFingerprint).toMatch(/^[0-9a-f]{64}$/);

    // The ungoverned direct-write path is closed: no live rule exists yet.
    const list = await request(app.getHttpServer())
      .get(`${FEE_PATH}?productCode=${body.productCode}`)
      .set(auth(preparer.token));
    expect(list.status).toBe(200);
    expect(list.body.items ?? list.body).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ productCode: body.productCode })]),
    );
  });

  it('enforces maker≠checker: the maker cannot approve their own request; the FINANCE_CONTROLLER can approve a permitted pending change', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const body = feeCreateBody('P0-A self-approval prohibition');

    const created = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(body);
    expect(created.status).toBe(201);
    const approvalId = created.body.approvalId as string;

    // Maker lacks the checker role entirely.
    const makerAttempt = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(preparer.token))
      .send({ comment: 'self-approve attempt' });
    expect(makerAttempt.status).toBe(403);

    // A principal holding BOTH roles still cannot approve their OWN request
    // (established decide() self-approval prohibition).
    const both = await provisionRole('FINANCE_PREPARER', ['FINANCE_CONTROLLER']);
    const own = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(both.token))
      .send(feeCreateBody('P0-A dual-role self-approval'));
    expect(own.status).toBe(201);
    const selfDecision = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${own.body.approvalId}/approve`)
      .set(auth(both.token))
      .send({ comment: 'no' });
    expect(selfDecision.status).toBe(201);
    expect(selfDecision.body).toMatchObject({
      approved: false,
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });

    // The independent FINANCE_CONTROLLER approves the pending change.
    const decision = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'verified pricing' });
    expect(decision.status).toBe(201);
    expect(decision.body).toMatchObject({ approved: true, reason: 'APPROVED' });
  });

  it('applies an approved fee_rule.create only through the execution endpoint — and only once', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const body = feeCreateBody('P0-A execute lifecycle');

    const created = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(body);
    const approvalId = created.body.approvalId as string;
    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'ok' });

    // The maker cannot execute the approved change.
    const makerExecute = await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${approvalId}/execute-create`)
      .set(auth(preparer.token))
      .send(body);
    expect(makerExecute.status).toBe(403);

    // The approving FINANCE_CONTROLLER executes the exact approved payload.
    const executed = await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${approvalId}/execute-create`)
      .set(auth(controller.token))
      .send(body);
    expect(executed.status).toBe(201);
    expect(executed.body).toMatchObject({ productCode: body.productCode, percentageBps: 42 });

    // Replay is rejected.
    const replay = await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${approvalId}/execute-create`)
      .set(auth(controller.token))
      .send(body);
    expect(replay.status).toBe(409);
  });

  it('rejects tampered payloads at execution (fingerprint binding) and preserves the audit trail', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const body = feeCreateBody('P0-A tamper rejection');

    const created = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(body);
    const approvalId = created.body.approvalId as string;
    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'ok' });

    const tampered = await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${approvalId}/execute-create`)
      .set(auth(controller.token))
      .send({ ...body, percentageBps: 99 });
    expect(tampered.status).toBe(403);

    // The approval row still shows the intended trail (approved, not consumed).
    const stored = await dataSource.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
    });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe(PrivilegedActionApprovalStatus.APPROVED);
    expect(stored!.actionType).toBe('FEE_RULE_CREATE');
    expect(stored!.resourceType).toBe('FEE_RULE');
  });

  it('rejects unauthorized initiation and unauthorized approval regardless of frontend visibility', async () => {
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const auditor = await provisionRole('FINANCE_AUDITOR');

    // The checker role cannot initiate (Decision 2: PREPARER maker).
    const checkerInitiate = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(controller.token))
      .send(feeCreateBody('P0-A checker cannot make'));
    expect(checkerInitiate.status).toBe(403);

    // An auditor can neither initiate nor approve.
    const auditorInitiate = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(auditor.token))
      .send(feeCreateBody('P0-A auditor cannot make'));
    expect(auditorInitiate.status).toBe(403);

    const preparer = await provisionRole('FINANCE_PREPARER');
    const created = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(feeCreateBody('P0-A auditor cannot check'));
    const auditorApprove = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${created.body.approvalId}/approve`)
      .set(auth(auditor.token))
      .send({});
    expect(auditorApprove.status).toBe(403);
  });

  it('supports checker rejection: a rejected change can never be executed', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const body = feeCreateBody('P0-A rejection trail');

    const created = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(body);
    const approvalId = created.body.approvalId as string;

    const rejected = await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/reject`)
      .set(auth(controller.token))
      .send({ comment: 'pricing out of policy' });
    expect(rejected.status).toBe(201);
    expect(rejected.body).toMatchObject({ approved: false, reason: 'REJECTED' });

    const execute = await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${approvalId}/execute-create`)
      .set(auth(controller.token))
      .send(body);
    expect(execute.status).toBe(409);

    const stored = await dataSource.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
    });
    expect(stored!.status).toBe(PrivilegedActionApprovalStatus.REJECTED);
  });

  it('governs fee_rule.modify with resource binding and optimistic-concurrency version in the fingerprint', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const body = feeCreateBody('P0-A modify lifecycle');

    // Create through the governed flow.
    const created = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(body);
    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${created.body.approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'ok' });
    const rule = await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${created.body.approvalId}/execute-create`)
      .set(auth(controller.token))
      .send(body);
    expect(rule.status).toBe(201);
    const ruleId = rule.body.id as string;

    // Modify request binds the existing rule id.
    const modifyBody = { reason: 'P0-A disable mispriced rule', isActive: false, version: 1 };
    const modifyReq = await request(app.getHttpServer())
      .patch(`${FEE_PATH}/${ruleId}`)
      .set(auth(preparer.token))
      .send(modifyBody);
    expect(modifyReq.status).toBe(200);
    expect(modifyReq.body).toMatchObject({
      actionType: 'FEE_RULE_MODIFY',
      resourceType: 'FEE_RULE',
      resourceId: ruleId,
    });

    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${modifyReq.body.approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'ok' });
    const modified = await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${modifyReq.body.approvalId}/execute-modify`)
      .set(auth(controller.token))
      .send(modifyBody);
    expect(modified.status).toBe(200);
    expect(modified.body).toMatchObject({ id: ruleId, isActive: false });
  });

  it.each(
    [
      {
        name: 'commission_rule.create',
        path: COMMISSION_PATH,
        body: () => ({
          reason: 'P0-A commission governed create',
          productCode: `P0A_${randomUUID().slice(0, 8).toUpperCase()}`,
          currency: 'NGN',
          percentageBps: 25,
        }),
        actionType: 'COMMISSION_RULE_CREATE',
        resourceType: 'COMMISSION_RULE',
      },
      {
        name: 'reward_rule.create',
        path: REWARD_PATH,
        body: () => ({
          reason: 'P0-A reward governed create',
          productCode: `P0A_${randomUUID().slice(0, 8).toUpperCase()}`,
          currency: 'NGN',
          flatRewardMinor: '1000',
        }),
        actionType: 'REWARD_RULE_CREATE',
        resourceType: 'REWARD_RULE',
      },
      {
        name: 'product.modify',
        path: PRODUCT_PATH,
        body: () => ({
          reason: 'P0-A product governed registration',
          code: `P0A_${randomUUID().slice(0, 8).toUpperCase()}`,
          name: 'P0-A synthetic product',
          domain: 'PAYMENTS',
        }),
        actionType: 'PRODUCT_MODIFY',
        resourceType: 'PRODUCT',
      },
      {
        name: 'product.governance',
        path: PRODUCT_GOV_PATH,
        body: () => ({
          reason: 'P0-A product governance record',
          kind: 'PRODUCT_CONFIGURATION',
          recordKey: `P0A_${randomUUID().slice(0, 8).toUpperCase()}`,
          name: 'P0-A governance record',
          status: 'DRAFT',
          version: 1,
          payload: {},
          actor: 'p0a-harness',
        }),
        actionType: 'PRODUCT_GOVERNANCE',
        resourceType: 'PRODUCT',
      },
    ].map((entry) => [entry.name, entry] as const),
  )('governs %s identically: request only — never a direct write', async (_name, entry) => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const body = entry.body();

    const res = await request(app.getHttpServer())
      .post(entry.path)
      .set(auth(preparer.token))
      .send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'REQUESTED',
      actionType: entry.actionType,
      resourceType: entry.resourceType,
    });
    expect(res.body.actionFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the maker-checker audit trail for pending → approved → consumed', async () => {
    const preparer = await provisionRole('FINANCE_PREPARER');
    const controller = await provisionRole('FINANCE_CONTROLLER');
    const body = feeCreateBody('P0-A audit trail');

    const created = await request(app.getHttpServer())
      .post(FEE_PATH)
      .set(auth(preparer.token))
      .send(body);
    const approvalId = created.body.approvalId as string;

    const pending = await dataSource.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
    });
    expect(pending!.status).toBe(PrivilegedActionApprovalStatus.REQUESTED);
    expect(pending!.requesterPrincipalId).toBe(preparer.principalId);

    await request(app.getHttpServer())
      .post(`${APPROVE_PATH}/${approvalId}/approve`)
      .set(auth(controller.token))
      .send({ comment: 'trail' });
    await request(app.getHttpServer())
      .post(`${FEE_PATH}/changes/${approvalId}/execute-create`)
      .set(auth(controller.token))
      .send(body);

    const final = await dataSource.getRepository(PrivilegedActionApproval).findOne({
      where: { id: approvalId },
    });
    expect(final!.status).toBe(PrivilegedActionApprovalStatus.CONSUMED);
    expect(final!.approvedBy).toBe(controller.principalId);
  });
});
