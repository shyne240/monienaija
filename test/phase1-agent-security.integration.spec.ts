/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports */
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
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentAuthenticationExecutionService } from '../src/agent-authentication/agent-authentication-execution.service';
import { AgentAuthenticationSessionService } from '../src/agent-authentication/agent-authentication-session.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentPasswordHashVerificationService } from '../src/agent-authentication/agent-password-hash-verification.service';
import { AgentTransactionPin } from '../src/agent-authentication/agent-transaction-pin.entity';
import { AgentAuthenticationCredential } from '../src/agent-authentication/agent-authentication-credential.entity';
import { AuthorizationRole } from '../src/authorization-catalogue/authorization-role.entity';
import { AuthorizationFunction } from '../src/authorization-catalogue/authorization-function.entity';
import { AuthorizationRoleFunction } from '../src/authorization-catalogue/authorization-role-function.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

describe('Phase 1 ordinary Agent security (real PostgreSQL and HTTP)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let auth: AgentAuthenticationService;
  let agentSessions: AgentAuthenticationSessionService;
  let verifier: AgentPasswordHashVerificationService;
  let maker: { token: string; id: string };
  let checker: { token: string; id: string };
  let otherChecker: { token: string; id: string };
  let operations: { token: string; id: string };
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
  const hash = (secret: string) => {
    const salt = randomBytes(16);
    return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(secret, salt, 10000, 32, 'sha256').toString('base64url')}`;
  };

  async function role(roleKey: string) {
    const id = `phase1:${randomUUID()}`;
    const now = new Date();
    await ds.getRepository(A2FinanceRoleAssignment).save({
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
      issuer: 'https://phase1.test',
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

  async function agent() {
    const cls = await app.get(AgentClassService).create({
      reference: randomUUID(),
      code: `P1-${randomUUID().slice(0, 8)}`,
      name: 'Phase 1',
      actor: 'test',
      applicableServices: ['CASH_IN', 'AGENT_FUNDING', 'AGENT_DEFUNDING'],
    });
    const entity = await ds.getRepository(Agent).save({
      id: randomUUID(),
      reference: randomUUID(),
      status: AgentStatus.ACTIVE,
      agentClassId: cls.id,
    });
    const wallet = await app
      .get(WalletService)
      .createWallet({ customerId: entity.id, currency: 'NGN', idempotencyKey: randomUUID() });
    return { id: entity.id, cls, wallet };
  }

  beforeAll(async () => {
    ds = await createIntegrationDataSource('phase1security');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(ds)
      .overrideProvider(A2_WORKFORCE_CONFIG)
      .useValue(workforceConfig)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    sessions = app.get(A2WorkforceSessionService);
    auth = app.get(AgentAuthenticationService);
    agentSessions = app.get(AgentAuthenticationSessionService);
    verifier = app.get(AgentPasswordHashVerificationService);
    maker = await role('AGENT_NETWORK_MANAGER');
    checker = await role('FINANCE_CONTROLLER');
    otherChecker = await role('FINANCE_CONTROLLER');
    operations = await role('OPERATIONS');
  }, 180000);
  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
  });

  async function approval(agentId: string, direction = 'fund', amountMinor = '1000') {
    const instruction = { amountMinor, currency: 'NGN', idempotencyKey: randomUUID() };
    const created = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${agentId}/${direction}-request`)
      .set(headers(maker.token))
      .send({ ...instruction, reason: 'Verified test cash' })
      .expect(201);
    const approvalId = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${approvalId}/approve`)
      .set(headers(checker.token))
      .send({ comment: 'Independent review' })
      .expect(201);
    return { ...instruction, approvalId };
  }

  it('rejects establishment for an unknown role and validation for a disabled role', async () => {
    await expect(role('UNKNOWN_PHASE1_ROLE')).rejects.toThrow('No valid workforce roles');
    const user = await role('FINANCE_AUDITOR');
    const repo = ds.getRepository(AuthorizationRole);
    await repo.update({ roleKey: 'FINANCE_AUDITOR' }, { isActive: false });
    try {
      await expect(sessions.validate(user.token, 'workforce-admin')).rejects.toThrow(
        'No valid workforce roles',
      );
    } finally {
      await repo.update({ roleKey: 'FINANCE_AUDITOR' }, { isActive: true });
    }
  });

  it('persists reviewable instructions and prevents self-approval even for a dual-role maker', async () => {
    const a = await agent();
    const result = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund-request`)
      .set(headers(maker.token))
      .send({ amountMinor: '1234', idempotencyKey: randomUUID(), reason: 'test' })
      .expect(201);
    expect(result.body.policy.requestDetails.amountMinor).toBe('1234');
    expect(result.body.reason).toBe('test');
    const checkerInbox = await request(app.getHttpServer())
      .get(`/api/v1/internal/agents/${a.id}/funding-requests`)
      .set(headers(checker.token))
      .expect(200);
    expect(checkerInbox.body[0].reason).toBe('test');
    const principal = await sessions.validate(maker.token, 'workforce-admin');
    const decision = await app.get(PrivilegedActionApprovalService).approve({
      approvalId: result.body.id,
      principal: {
        ...principal,
        roles: [...principal.roles, 'FINANCE_CONTROLLER'],
        scopes: [...principal.scopes, 'agent.fund'],
      },
    });
    expect(decision.reason).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('a checker blocked behind consumption cannot resurrect a consumed approval', async () => {
    const a = await agent();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund-request`)
      .set(headers(maker.token))
      .send({ amountMinor: '1000', idempotencyKey: randomUUID(), reason: 'Concurrency fixture' })
      .expect(201);
    const approvalId = created.body.id as string;
    const principal = await sessions.validate(checker.token, 'workforce-admin');
    const runner = ds.createQueryRunner();
    let pending: ReturnType<PrivilegedActionApprovalService['approve']> | undefined;
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.manager
        .getRepository(PrivilegedActionApproval)
        .findOne({ where: { id: approvalId }, lock: { mode: 'pessimistic_write' } });
      const pidRows = (await runner.query('SELECT pg_backend_pid() AS pid')) as unknown as Array<{
        pid: number;
      }>;
      const pid = pidRows[0]!.pid;
      pending = app.get(PrivilegedActionApprovalService).approve({ approvalId, principal });
      let waiting = false;
      const deadline = Date.now() + 10000;
      while (!waiting && Date.now() < deadline) {
        const rows = await ds.query<Array<{ waiting: boolean }>>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::int = ANY(pg_blocking_pids(pid))) AS waiting`,
          [pid],
        );
        waiting = rows[0]?.waiting === true;
        if (!waiting) await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      // Represents a competing lifecycle writer while the checker is waiting on the row.
      await runner.query(
        `UPDATE privileged_action_approvals SET status='CONSUMED', approved_by=$2, approved_at=NOW(), consumed_at=NOW() WHERE id=$1`,
        [approvalId, checker.id],
      );
      await runner.commitTransaction();
      expect((await pending).approved).toBe(false);
      expect(
        (await ds.getRepository(PrivilegedActionApproval).findOneByOrFail({ id: approvalId }))
          .status,
      ).toBe('CONSUMED');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  });

  it('rejects expired approval without a financial effect', async () => {
    const a = await agent();
    const command = await approval(a.id);
    await ds
      .getRepository(PrivilegedActionApproval)
      .update({ id: command.approvalId }, { expiresAt: new Date(Date.now() - 1000) });
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund`)
      .set(headers(checker.token))
      .send(command)
      .expect(403);
    expect(
      (await app.get(LedgerService).getAccountBalance(a.wallet.ledgerAccountId)).balanceMinor,
    ).toBe('0');
  });

  it('concurrent funding cannot reuse one approval for two financial effects', async () => {
    const a = await agent();
    const command = await approval(a.id);
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/api/v1/internal/agents/${a.id}/fund`)
          .set(headers(checker.token))
          .send(command),
      ),
    );
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
    expect(
      (await app.get(LedgerService).getAccountBalance(a.wallet.ledgerAccountId)).balanceMinor,
    ).toBe('1000');
  });

  it('concurrent known-PIN changes cannot both authorize against the old PIN', async () => {
    const a = await agent();
    await auth.setTransactionPin(a.id, {
      pinHash: hash('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: a.id,
    });
    const changes = await Promise.all(
      ['5678', '9012'].map((pin) =>
        auth.changeTransactionPin(
          a.id,
          '1234',
          {
            pinHash: hash(pin),
            hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
            pinVersion: 1,
            actor: a.id,
          },
          verifier,
        ),
      ),
    );
    expect(changes.filter((r) => r.verified)).toHaveLength(1);
    expect(
      (await ds.getRepository(AgentTransactionPin).findOneByOrFail({ agentId: a.id })).pinVersion,
    ).toBe(2);
  });

  it('funding requires a function-entitled checker and approval', async () => {
    const a = await agent();
    for (const actor of [maker, operations]) {
      await request(app.getHttpServer())
        .post(`/api/v1/internal/agents/${a.id}/fund`)
        .set(headers(actor.token))
        .send({ amountMinor: '1000', idempotencyKey: randomUUID() })
        .expect(403);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund`)
      .set(headers(checker.token))
      .send({ amountMinor: '1000', idempotencyKey: randomUUID() })
      .expect(403);
  });

  it('gates funding-request execute/reject before lookup and preserves authorized checker actions', async () => {
    const a = await agent();
    const pending = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund-request`)
      .set(headers(maker.token))
      .send({ amountMinor: '1000', idempotencyKey: randomUUID(), reason: 'Non-enumeration fixture' })
      .expect(201);
    const existingId = pending.body.id as string;

    // A maker has agent.fund/agent.defund, but not FINANCE_CONTROLLER checker authority.
    // Existing and nonexistent identifiers must therefore produce indistinguishable denials.
    for (const action of ['execute', 'reject'] as const) {
      const existing = await request(app.getHttpServer())
        .post(`/api/v1/internal/agents/funding-requests/${existingId}/${action}`)
        .set(headers(maker.token))
        .send({ reason: 'Unauthorized request' })
        .expect(403);
      const missing = await request(app.getHttpServer())
        .post(`/api/v1/internal/agents/funding-requests/${randomUUID()}/${action}`)
        .set(headers(maker.token))
        .send({ reason: 'Unauthorized request' })
        .expect(403);
      expect(existing.body).toEqual(missing.body);
    }

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/funding-requests/${existingId}/reject`)
      .set(headers(checker.token))
      .send({ reason: 'Independent checker rejection' })
      .expect(201);
    expect(rejected.body.status).toBe('REJECTED');

    const approved = await approval(a.id);
    const executed = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/funding-requests/${approved.approvalId}/execute`)
      .set(headers(checker.token))
      .send({})
      .expect(201);
    expect(executed.body.status).toBe('COMPLETED');
    expect(executed.body.journalId).toBeDefined();
  });

  it('binds approval to amount, rejects another checker, posts once and replays', async () => {
    const a = await agent();
    const command = await approval(a.id);
    const url = `/api/v1/internal/agents/${a.id}/fund`;
    await request(app.getHttpServer())
      .post(url)
      .set(headers(checker.token))
      .send({ ...command, amountMinor: '2000' })
      .expect(403);
    await request(app.getHttpServer())
      .post(url)
      .set(headers(otherChecker.token))
      .send(command)
      .expect(403);
    const first = await request(app.getHttpServer())
      .post(url)
      .set(headers(checker.token))
      .send(command)
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(url)
      .set(headers(checker.token))
      .send(command)
      .expect(201);
    expect(replay.body.journalId).toBe(first.body.journalId);
    await request(app.getHttpServer())
      .post(url)
      .set(headers(otherChecker.token))
      .send(command)
      .expect(403);
    await request(app.getHttpServer())
      .post(url)
      .set(headers(checker.token))
      .send({ ...command, metadata: { changed: true } })
      .expect(403);
    await ds.getRepository(PrivilegedActionApproval).update(
      { id: command.approvalId },
      {
        expiresAt: new Date(Date.now() - 1000),
      },
    );
    await request(app.getHttpServer())
      .post(url)
      .set(headers(checker.token))
      .send(command)
      .expect(201);
    expect(
      (await ds.getRepository(PrivilegedActionApproval).findOneByOrFail({ id: command.approvalId }))
        .status,
    ).toBe('CONSUMED');
    expect(
      (await app.get(LedgerService).getAccountBalance(a.wallet.ledgerAccountId)).balanceMinor,
    ).toBe('1000');
  });

  it('defunding rolls approval consumption back on insufficient balance, then permits an approved debit', async () => {
    const a = await agent();
    const debit = await approval(a.id, 'defund');
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/defund`)
      .set(headers(checker.token))
      .send(debit)
      .expect(422);
    expect(
      (await ds.getRepository(PrivilegedActionApproval).findOneByOrFail({ id: debit.approvalId }))
        .status,
    ).toBe('APPROVED');
    const credit = await approval(a.id);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund`)
      .set(headers(checker.token))
      .send(credit)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/defund`)
      .set(headers(checker.token))
      .send(debit)
      .expect(201);
    expect(
      (await app.get(LedgerService).getAccountBalance(a.wallet.ledgerAccountId)).balanceMinor,
    ).toBe('0');
  });

  it('prevents maker self-approval and non-controller approval', async () => {
    const a = await agent();
    const result = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund-request`)
      .set(headers(maker.token))
      .send({ amountMinor: '1', idempotencyKey: randomUUID(), reason: 'test' })
      .expect(201);
    for (const actor of [maker, operations]) {
      await request(app.getHttpServer())
        .post(`/api/v1/internal/a2/workforce/approvals/${result.body.id}/approve`)
        .set(headers(actor.token))
        .send({})
        .expect(403);
    }
  });

  it('rejects sessions after their final role is revoked', async () => {
    const user = await role('OPERATIONS');
    await ds
      .getRepository(A2FinanceRoleAssignment)
      .update({ principalId: user.id }, { status: 'REVOKED' });
    await expect(sessions.validate(user.token, 'workforce-admin')).rejects.toThrow(
      'No valid workforce roles',
    );
    await request(app.getHttpServer())
      .get('/api/v1/internal/agents')
      .set(headers(user.token))
      .expect(401);
  });

  it('rejects forged approval/rejection identity and target fields, including a dual-role maker', async () => {
    const dual = await role('AGENT_NETWORK_MANAGER');
    const assignment = await ds
      .getRepository(A2FinanceRoleAssignment)
      .findOneByOrFail({ principalId: checker.id });
    await ds
      .getRepository(A2FinanceRoleAssignment)
      .save({
        ...assignment,
        id: randomUUID(),
        assignmentReference: randomUUID(),
        principalId: dual.id,
      });
    const a = await agent();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund-request`)
      .set(headers(dual.token))
      .send({ amountMinor: '1000', idempotencyKey: randomUUID(), reason: 'Separation test' })
      .expect(201);
    const forged = await sessions.validate(otherChecker.token, 'workforce-admin');
    for (const action of ['approve', 'reject']) {
      for (const caller of [dual, checker]) {
        await request(app.getHttpServer())
          .post(`/api/v1/internal/a2/workforce/approvals/${created.body.id}/${action}`)
          .set(headers(caller.token))
          .send({ principal: forged, approvalId: randomUUID(), actor: otherChecker.id })
          .expect(400);
      }
    }
    const denied = await request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${created.body.id}/approve`)
      .set(headers(dual.token))
      .send({ comment: 'Cannot self approve' })
      .expect(201);
    expect(denied.body.reason).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(
      (await ds.getRepository(PrivilegedActionApproval).findOneByOrFail({ id: created.body.id }))
        .status,
    ).toBe('REQUESTED');
    await request(app.getHttpServer())
      .post(`/api/v1/internal/a2/workforce/approvals/${created.body.id}/approve`)
      .set(headers(checker.token))
      .send({ comment: 'Independent approval' })
      .expect(201);
    expect(
      (await ds.getRepository(PrivilegedActionApproval).findOneByOrFail({ id: created.body.id }))
        .approvedBy,
    ).toBe(checker.id);
  });

  it('closes anonymous/cross-Agent application access and ignores spoofed actor headers', async () => {
    const a = await agent();
    const application = await app
      .get(AgentApplicationService)
      .create({ agentClassId: a.cls.id, applicantReference: randomUUID(), actor: 'original' });
    expect(application.applicantAccessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(application.applicantAccessTokenHash).toBeUndefined();
    const verifierRows = await ds.query(
      `SELECT applicant_access_token_hash FROM agent_applications WHERE id=$1`,
      [application.id],
    );
    expect(verifierRows[0].applicant_access_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifierRows[0].applicant_access_token_hash).not.toBe(application.applicantAccessToken);
    const path = `/api/v1/agents/applications/${application.id}`;
    await request(app.getHttpServer()).get(path).expect(401);
    const applicantRead = await request(app.getHttpServer())
      .get(path)
      .set(headers(application.applicantAccessToken!))
      .expect(200);
    expect(applicantRead.body).not.toHaveProperty('applicantAccessToken');
    expect(applicantRead.body).not.toHaveProperty('applicantAccessTokenHash');
    await request(app.getHttpServer())
      .get(path)
      .set(headers('invalid-application-capability'))
      .expect(401);
    await auth.createCredential(a.id, {
      passwordHash: hash('application-password'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordVersion: 1,
      actor: 'test',
    });
    const authenticated = await app
      .get(AgentAuthenticationExecutionService)
      .authenticate({ agentId: a.id, password: 'application-password', actor: a.id });
    const agentToken = await agentSessions.issue({ authentication: authenticated, actor: a.id });
    await request(app.getHttpServer()).get(path).set(headers(agentToken.accessToken)).expect(403);
    await request(app.getHttpServer())
      .patch(path)
      .set(headers(agentToken.accessToken))
      .send({ businessName: 'Cross-Agent attack' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(path)
      .set('x-actor', 'original')
      .send({ businessName: 'attack' })
      .expect(401);
    await request(app.getHttpServer()).post(`${path}/submit`).expect(401);
    await request(app.getHttpServer()).get(path).set(headers(operations.token)).expect(403);
    await request(app.getHttpServer())
      .patch(path)
      .set(headers(maker.token))
      .set('x-actor', 'forged')
      .send({ businessName: 'Approved edit' })
      .expect(200);
    expect((await app.get(AgentApplicationService).getById(application.id)).updatedBy).toBe(
      maker.id,
    );
  });

  it('class mutations require agent.manage_classes and do not inherit application-review grants', async () => {
    const a = await agent();
    const classesPath = '/api/v1/internal/agents/classes';

    // AGENT_NETWORK_MANAGER already has agent.review_application, but that function must
    // not authorize class eligibility changes. OPERATIONS has no class-management grant.
    await request(app.getHttpServer())
      .post(classesPath)
      .set(headers(maker.token))
      .send({ name: 'Denied class create' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`${classesPath}/${a.cls.id}`)
      .set(headers(maker.token))
      .send({ name: 'Denied class update', expectedVersion: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .post(classesPath)
      .set(headers(operations.token))
      .send({ name: 'Operations class create' })
      .expect(403);

    const role = await ds
      .getRepository(AuthorizationRole)
      .findOneByOrFail({ roleKey: 'AGENT_NETWORK_MANAGER' });
    const fn = await ds
      .getRepository(AuthorizationFunction)
      .findOneByOrFail({ functionCode: 'agent.manage_classes' });
    const roleFunctions = ds.getRepository(AuthorizationRoleFunction);
    expect(
      await roleFunctions.findOneBy({ roleId: role.id, functionCode: fn.functionCode }),
    ).toBeNull();

    // Test-only grant proves the route/controller positively honor the new function. It is
    // removed immediately and is deliberately not part of the system role seed.
    const grant = await roleFunctions.save(
      roleFunctions.create({
        roleId: role.id,
        functionCode: fn.functionCode,
        accessType: 'EXECUTE',
        isActive: true,
        assignedBy: 'phase1-test-only',
        assignedAt: new Date(),
      }),
    );
    try {
      const created = await request(app.getHttpServer())
        .post(classesPath)
        .set(headers(maker.token))
        .send({
          reference: `PHASE1-${randomUUID()}`,
          code: `P1CLASS-${randomUUID().slice(0, 8)}`,
          name: 'Explicitly authorized class',
        })
        .expect(201);
      expect(created.body.name).toBe('Explicitly authorized class');
      const updated = await request(app.getHttpServer())
        .patch(`${classesPath}/${created.body.id}`)
        .set(headers(maker.token))
        .send({ name: 'Explicitly authorized class updated', expectedVersion: 1 })
        .expect(200);
      expect(updated.body.name).toBe('Explicitly authorized class updated');
    } finally {
      await roleFunctions.delete({ id: grant.id });
    }
  });

  it('function-gates class and ordinary outlet administration', async () => {
    const a = await agent();
    await request(app.getHttpServer())
      .get('/api/v1/internal/agents/classes')
      .set(headers(operations.token))
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/internal/agents/classes')
      .set(headers(maker.token))
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/outlets`)
      .set(headers(operations.token))
      .send({ reference: randomUUID(), code: 'P1-OUTLET', name: 'Outlet' })
      .expect(403);
  });

  it('counts concurrent credential failures without lost updates', async () => {
    const a = await agent();
    const credential = await auth.createCredential(a.id, {
      passwordHash: hash('password'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordVersion: 1,
      actor: 'test',
    });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        auth.recordFailedAuthentication(a.id, credential.id, { actor: a.id }),
      ),
    );
    const stored = await ds
      .getRepository(AgentAuthenticationCredential)
      .findOneByOrFail({ id: credential.id });
    expect(stored.failedAuthenticationCount).toBe(10);
    expect(stored.accountLocked).toBe(true);
  });

  it('serializes PIN failures and preserves lockout against a correct PIN', async () => {
    const a = await agent();
    await auth.setTransactionPin(a.id, {
      pinHash: hash('1234'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      pinVersion: 1,
      actor: a.id,
    });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        auth.verifyTransactionPin(a.id, { pin: '9999', actor: a.id }, verifier),
      ),
    );
    const pin = await ds.getRepository(AgentTransactionPin).findOneByOrFail({ agentId: a.id });
    expect(pin.failedCount).toBe(5);
    expect(pin.accountLocked).toBe(true);
    expect(
      (await auth.verifyTransactionPin(a.id, { pin: '1234', actor: a.id }, verifier)).verified,
    ).toBe(false);
  });

  it('allows only one concurrent first PIN creation', async () => {
    const a = await agent();
    const results = await Promise.allSettled(
      ['1234', '5678'].map((pin) =>
        auth.setTransactionPin(a.id, {
          pinHash: hash(pin),
          hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
          pinVersion: 1,
          actor: a.id,
          createOnly: true,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('invalidates old sessions atomically with credential reissue', async () => {
    const a = await agent();
    await auth.createCredential(a.id, {
      passwordHash: hash('password'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordVersion: 1,
      actor: 'test',
    });
    const result = await app
      .get(AgentAuthenticationExecutionService)
      .authenticate({ agentId: a.id, password: 'password', actor: a.id });
    const session = await agentSessions.issue({ authentication: result, actor: a.id });
    expect((await agentSessions.validate({ token: session.accessToken })).valid).toBe(true);
    await auth.reissueInitialCredential(a.id, {
      passwordHash: hash('replacement'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordExpiresAt: new Date(Date.now() + 60000).toISOString(),
      actor: maker.id,
    });
    expect((await agentSessions.validate({ token: session.accessToken })).valid).toBe(false);
    await expect(agentSessions.issue({ authentication: result, actor: a.id })).rejects.toThrow(
      'Credential is no longer available',
    );
  });
  async function waitUntilBlocked(pid: number) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const rows = await ds.query(
        `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))) AS waiting`,
        [pid],
      );
      if (rows[0]?.waiting === true) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('Probe did not reach expected database lock');
  }
  it('cancellation cannot overwrite a concurrent consumed state', async () => {
    const a = await agent();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/internal/agents/${a.id}/fund-request`)
      .set(headers(maker.token))
      .send({ amountMinor: '1000', idempotencyKey: randomUUID(), reason: 'Cancellation fixture' })
      .expect(201);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<unknown> | undefined;
    try {
      await runner.manager
        .getRepository(PrivilegedActionApproval)
        .findOne({ where: { id: created.body.id }, lock: { mode: 'pessimistic_write' } });
      const rows = (await runner.query('SELECT pg_backend_pid() AS pid')) as unknown as Array<{
        pid: number;
      }>;
      pending = app
        .get(PrivilegedActionApprovalService)
        .cancel({
          approvalId: created.body.id,
          principal: await sessions.validate(maker.token, 'workforce-admin'),
        });
      await waitUntilBlocked(rows[0]!.pid);
      await runner.query(
        `UPDATE privileged_action_approvals SET status='CONSUMED',approved_by=$2,approved_at=NOW(),consumed_at=NOW() WHERE id=$1`,
        [created.body.id, checker.id],
      );
      await runner.commitTransaction();
      await pending;
      expect(
        (await ds.getRepository(PrivilegedActionApproval).findOneByOrFail({ id: created.body.id }))
          .status,
      ).toBe('CONSUMED');
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  });
  it('initial rotation rejects a lock established after password verification', async () => {
    const a = await agent();
    const credential = await auth.issueInitialCredential(a.id, {
      passwordHash: hash('temporary-password'),
      hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
      passwordExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      actor: maker.id,
    });
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: Promise<unknown> | undefined;
    try {
      await runner.manager
        .getRepository(Agent)
        .findOne({ where: { id: a.id }, lock: { mode: 'pessimistic_write' } });
      const rows = (await runner.query('SELECT pg_backend_pid() AS pid')) as unknown as Array<{
        pid: number;
      }>;
      pending = request(app.getHttpServer())
        .post('/api/v1/agents/credentials/rotate')
        .send({
          agentId: a.id,
          currentPassword: 'temporary-password',
          newPassword: 'replacement-password',
        })
        .then((r) => r);
      await waitUntilBlocked(rows[0]!.pid);
      await Promise.all(
        Array.from({ length: 5 }, () =>
          auth.recordFailedAuthentication(a.id, credential.id, { actor: a.id }),
        ),
      );
      expect(
        (
          await ds
            .getRepository(AgentAuthenticationCredential)
            .findOneByOrFail({ id: credential.id })
        ).accountLocked,
      ).toBe(true);
      await runner.commitTransaction();
      const response = (await pending) as request.Response;
      expect(response.status).toBe(409);
      expect(response.body.accessToken).toBeUndefined();
      expect(
        (
          await ds
            .getRepository(AgentAuthenticationCredential)
            .findOneByOrFail({ id: credential.id })
        ).accountLocked,
      ).toBe(true);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
  });
});
