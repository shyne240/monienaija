/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
/**
 * ARENA 4 Phase 1 — institutional foundation. Real PostgreSQL + real HTTP acceptance suite.
 *
 * Proves the foundation delivered by migration `1785753600400-CreateInstitutionFoundation`:
 * first-class financial institutions with an administrative/regulatory/operational lifecycle
 * separation, governed agent affiliation changes through the EXISTING maker-checker stack,
 * request-time workforce institution scoping, the authoritative `AgentInstitutionResolver`
 * contract, and read-only attribution-gap visibility.
 *
 * Nothing authorization-relevant is mocked. Synthetic fixtures only; no provider call, no real
 * financial transaction, no deployment. Existing agents, wallets, balances and journals are
 * asserted untouched throughout.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { NotConfiguredInstitutionResolver } from '../src/institution/agent-institution-resolver';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const INSTITUTIONS = '/api/v1/internal/institutions';
const AGENT_AFFILIATIONS = '/api/v1/internal/agent-affiliations';
const APPROVALS = '/api/v1/internal/a2/workforce/approvals';

describe('Institutional foundation (ARENA 4 Phase 1) — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let ledger: LedgerService;
  let sessions: A2WorkforceSessionService;
  let provisioned: Record<RoleKey, Role> | undefined;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  type RoleKey = 'superAdmin' | 'operator' | 'networkManager' | 'controller' | 'auditor';
  interface Role {
    principalId: string;
    token: string;
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('arena4inst');

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

    ledger = moduleRef.get(LedgerService);
    sessions = moduleRef.get(A2WorkforceSessionService);
  }, 240_000);

  afterAll(async () => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        if (dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
      }
    }
  }, 60_000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    provisioned = undefined;
  });

  // ------------------------------------------------------------------ fixtures

  async function provisionRole(roleKey: string): Promise<Role> {
    const principalId = `arena4inst:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `arena4-institution:${principalId}`,
      assignmentVersion: 1,
      principalId,
      roleKey,
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
      signingKeyId: 'test-harness-key',
    });
    return { principalId, token: result.accessToken };
  }

  async function roles(): Promise<Record<RoleKey, Role>> {
    if (!provisioned) {
      provisioned = {
        superAdmin: await provisionRole('SUPER_ADMIN'),
        operator: await provisionRole('OPERATIONS'),
        networkManager: await provisionRole('AGENT_NETWORK_MANAGER'),
        controller: await provisionRole('FINANCE_CONTROLLER'),
        auditor: await provisionRole('FINANCE_AUDITOR'),
      };
    }
    return provisioned;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createAgent(status = 'ACTIVE'): Promise<{ id: string; reference: string }> {
    const id = randomUUID();
    const reference = `agent-${id.slice(0, 8)}`;
    await dataSource.query(`INSERT INTO agents (id, reference, status) VALUES ($1,$2,$3)`, [
      id,
      reference,
      status,
    ]);
    return { id, reference };
  }

  async function createAggregatorWithAgent(agentId: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO aggregators (id, reference, code, corporate_name, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,'ACTIVE','test-harness','test-harness')`,
      [id, `agg-${id.slice(0, 8)}`, `AGG_${id.slice(0, 8).toUpperCase()}`, 'Aggregator Ltd'],
    );
    await dataSource.query(
      `INSERT INTO aggregator_agent_assignments (id, aggregator_id, agent_id, status, assigned_by)
       VALUES ($1,$2,$3,'ACTIVE','test-harness')`,
      [randomUUID(), id, agentId],
    );
    return id;
  }

  async function createLedgerAccount(
    type: LedgerAccountType = LedgerAccountType.LIABILITY,
    normalBalance: LedgerNormalBalance = LedgerNormalBalance.CREDIT,
    allowNegativeBalance = false,
  ): Promise<string> {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const account = await ledger.createAccount({
      code: `A4-${suffix}`,
      name: `A4 ${suffix}`,
      accountType: type,
      normalBalance,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance,
    });
    return account.id;
  }

  async function postMovement(liabilityAccountId: string, amountMinor: string): Promise<string> {
    const assetId = await createLedgerAccount(LedgerAccountType.ASSET, LedgerNormalBalance.DEBIT);
    const journal = await ledger.postJournal({
      idempotencyKey: `a4-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'Arena 4 institutional foundation synthetic movement',
      lines: [
        { accountId: assetId, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: liabilityAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
    return journal.id;
  }

  async function createAgentWallet(
    agentId: string,
    funded = false,
  ): Promise<{ id: string; ledgerAccountId: string; journalId: string | null }> {
    const ledgerAccountId = await createLedgerAccount();
    const journalId = funded ? await postMovement(ledgerAccountId, '500000') : null;
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO wallet_accounts (id, customer_id, currency, status, ledger_account_id)
       VALUES ($1,$2,'NGN','ACTIVE',$3)`,
      [id, agentId, ledgerAccountId],
    );
    return { id, ledgerAccountId, journalId };
  }

  /** Honest settlement: debits the agent liability account, bringing the balance to zero. */
  async function settleMovement(liabilityAccountId: string, amountMinor: string): Promise<string> {
    // The synthetic counterparty account carries the mirror position, so it is allowed to go
    // negative inside this fixture only (no production account is configured this way).
    const assetId = await createLedgerAccount(
      LedgerAccountType.ASSET,
      LedgerNormalBalance.DEBIT,
      true,
    );
    const journal = await ledger.postJournal({
      idempotencyKey: `a4-settle-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'Arena 4 institutional foundation synthetic settlement',
      lines: [
        { accountId: liabilityAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: assetId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
    return journal.id;
  }

  async function walletBalance(ledgerAccountId: string): Promise<bigint> {
    const [row] = await dataSource.query<Array<{ balance: string }>>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    return BigInt(row!.balance);
  }

  async function ledgerLineCount(): Promise<number> {
    const [row] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM ledger_lines`,
    );
    return Number(row!.count);
  }

  // ------------------------------------------------------------ institution fixtures

  let institutionSequence = 0;

  async function registerInstitution(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    institutionSequence += 1;
    const suffix = `${institutionSequence}${randomUUID().slice(0, 6).toUpperCase()}`;
    const response = await request(app.getHttpServer())
      .post(INSTITUTIONS)
      .set(auth(token))
      .send({
        reference: `FI-${suffix}`,
        code: `FI_${suffix}`,
        legalName: `Institution ${suffix} Limited`,
        institutionType: 'MICROFINANCE_BANK',
        regulatorName: 'Central Bank',
        licenceReference: `LIC/${suffix}`,
        ...overrides,
      });
    return { status: response.status, body: response.body } as Record<string, any>;
  }

  async function recordEvidence(token: string, institutionId: string) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/evidence`)
      .set(auth(token))
      .send({
        evidenceReference: `EVID-${institutionId.slice(0, 8)}`,
        regulatorName: 'Central Bank',
        licenceReference: `LIC-${institutionId.slice(0, 8)}`,
      });
  }

  async function approve(token: string, approvalId: string) {
    return request(app.getHttpServer())
      .post(`${APPROVALS}/${approvalId}/approve`)
      .set(auth(token))
      .send({ comment: 'institutional evidence reviewed by an independent checker' });
  }

  async function requestLifecycle(
    token: string,
    institutionId: string,
    targetStatus: string,
    reason = 'Regulatory evidence verified by compliance and operational approval recorded',
  ) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle/request`)
      .set(auth(token))
      .send({ targetStatus, reason });
  }

  async function executeLifecycle(
    token: string,
    institutionId: string,
    approvalId: string,
    targetStatus: string,
    reason = 'Regulatory evidence verified by compliance and operational approval recorded',
  ) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle`)
      .set(auth(token))
      .send({ approvalId, targetStatus, reason });
  }

  /** Full governed activation: OPERATIONS prepares, FINANCE_CONTROLLER checks and executes. */
  async function activateInstitution(institutionId: string): Promise<string> {
    const { operator, controller } = await roles();
    const created = await requestLifecycle(operator.token, institutionId, 'APPROVED');
    expect(created.status).toBe(201);
    expect((await approve(controller.token, created.body.approvalId)).status).toBe(201);
    const executed = await executeLifecycle(
      controller.token,
      institutionId,
      created.body.approvalId,
      'APPROVED',
    );
    expect(executed.status).toBe(201);
    return created.body.approvalId as string;
  }

  /** Register + evidence + workforce scope + governed activation. */
  async function approvedInstitution(): Promise<string> {
    const { superAdmin } = await roles();
    const registered = await registerInstitution(superAdmin.token);
    expect(registered.status).toBe(201);
    const institutionId = registered.body.id as string;
    expect((await recordEvidence(superAdmin.token, institutionId)).status).toBe(201);
    const granted = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/workforce`)
      .set(auth(superAdmin.token))
      .send({ principalId: (await roles()).operator.principalId });
    expect(granted.status).toBe(201);
    await activateInstitution(institutionId);
    return institutionId;
  }

  // ------------------------------------------------------------ affiliation fixtures

  const affiliationBody = (
    institutionId: string,
    changeKind: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    institutionId,
    changeKind,
    evidenceType: 'INSTITUTION_APPROVAL_LETTER',
    evidenceReference: `AFF-${randomUUID().slice(0, 8)}`,
    reason: 'Agent appointed under the institution approval letter on file',
    ...overrides,
  });

  async function requestAffiliation(token: string, agentId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`${AGENT_AFFILIATIONS}/${agentId}/request`)
      .set(auth(token))
      .send(body);
  }

  async function executeAffiliation(token: string, agentId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`${AGENT_AFFILIATIONS}/${agentId}/execute`)
      .set(auth(token))
      .send(body);
  }

  async function governedAffiliation(
    agentId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, any>> {
    const { networkManager, controller } = await roles();
    const created = await requestAffiliation(networkManager.token, agentId, body);
    expect(created.status).toBe(201);
    expect((await approve(controller.token, created.body.approvalId)).status).toBe(201);
    const executed = await executeAffiliation(controller.token, agentId, {
      ...body,
      approvalId: created.body.approvalId,
    });
    return { created, executed } as Record<string, any>;
  }

  async function assignAgent(
    agentId: string,
    institutionId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return governedAffiliation(agentId, affiliationBody(institutionId, 'ASSIGN', overrides));
  }

  async function affiliationRows(agentId: string) {
    return dataSource.query<
      Array<{ id: string; institution_id: string; status: string; effective_to: Date | null }>
    >(
      `SELECT id, institution_id, status, effective_to FROM institution_agent_affiliations
        WHERE agent_id = $1 ORDER BY created_at ASC`,
      [agentId],
    );
  }

  async function resolution(agentId: string) {
    const { controller } = await roles();
    return request(app.getHttpServer())
      .get(`${AGENT_AFFILIATIONS}/${agentId}/resolution`)
      .set(auth(controller.token));
  }

  // ================================================================== acceptance cases

  it('1 — administrative registration confers no financial authority', async () => {
    const { superAdmin } = await roles();
    const registered = await registerInstitution(superAdmin.token);
    expect(registered.status).toBe(201);
    expect(registered.body.status).toBe('REGISTERED');
    // The licence reference is recorded as EVIDENCE, never as authority.
    expect(registered.body.licenceReference).toBeTruthy();
    expect(registered.body.operationalAuthority).toBe(false);

    const read = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${registered.body.id}`)
      .set(auth(superAdmin.token));
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('REGISTERED');
    expect(read.body.operationalAuthority).toBe(false);
  });

  it('2 — regulatory evidence is recorded for verification and still activates nothing', async () => {
    const { superAdmin, operator } = await roles();
    const registered = await registerInstitution(superAdmin.token);
    const institutionId = registered.body.id as string;

    // Evidence is administrative; OPERATIONS cannot reach this institution yet (no scope at all).
    expect((await recordEvidence(operator.token, institutionId)).status).toBe(404);
    const evidence = await recordEvidence(superAdmin.token, institutionId);
    expect(evidence.status).toBe(201);
    expect(evidence.body.status).toBe('EVIDENCE_SUBMITTED');
    expect(evidence.body.operationalAuthority).toBe(false);
    expect(evidence.body.evidenceReference).toBeTruthy();
    expect(evidence.body.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('3 — the database refuses operational approval without a consumed approval', async () => {
    const { superAdmin } = await roles();
    const registered = await registerInstitution(superAdmin.token);
    const institutionId = registered.body.id as string;
    await recordEvidence(superAdmin.token, institutionId);

    await expect(
      dataSource.query(
        `UPDATE financial_institutions
            SET status = 'APPROVED', operational_approved_at = now()
          WHERE id = $1`,
        [institutionId],
      ),
    ).rejects.toThrow(/requires its own approved request/);

    // REGISTERED -> APPROVED is also refused outright: evidence must be recorded first.
    const second = await registerInstitution(superAdmin.token);
    await expect(
      dataSource.query(`UPDATE financial_institutions SET status='APPROVED' WHERE id=$1`, [
        second.body.id,
      ]),
    ).rejects.toThrow(/not allowed|approved request/);
  });

  it('4 — operational approval requires an independent checker and yields authority', async () => {
    const institutionId = await approvedInstitution();
    const { controller } = await roles();
    const read = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionId}`)
      .set(auth(controller.token));
    expect(read.status).toBe(200);
    expect(read.body.status).toBe('APPROVED');
    expect(read.body.operationalAuthority).toBe(true);
    expect(read.body.operationalApprovedAt).toBeTruthy();
  });

  it('5 — the maker of an institution lifecycle change can neither approve nor execute it', async () => {
    const { superAdmin, operator, controller } = await roles();
    const registered = await registerInstitution(superAdmin.token);
    const institutionId = registered.body.id as string;
    await recordEvidence(superAdmin.token, institutionId);
    await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/workforce`)
      .set(auth(superAdmin.token))
      .send({ principalId: operator.principalId });

    const created = await requestLifecycle(operator.token, institutionId, 'APPROVED');
    expect(created.status).toBe(201);

    // Maker cannot approve its own request.
    expect((await approve(operator.token, created.body.approvalId)).status).toBe(403);
    // Maker holds no lifecycle.approve function, so it cannot execute either.
    const executed = await executeLifecycle(
      operator.token,
      institutionId,
      created.body.approvalId,
      'APPROVED',
    );
    expect(executed.status).toBe(403);

    // The institution is still unapproved; the approval remains unconsumed.
    const read = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionId}`)
      .set(auth(controller.token));
    expect(read.body.status).toBe('EVIDENCE_SUBMITTED');
    const [approval] = await dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM privileged_action_approvals WHERE id = $1`,
      [created.body.approvalId],
    );
    expect(approval!.status).not.toBe('CONSUMED');
  });

  it('6 — an affiliation row cannot exist without a consumed governed approval', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();

    await expect(
      dataSource.query(
        `INSERT INTO institution_agent_affiliations
           (institution_id, agent_id, status, evidence_type, evidence_reference, approval_id, assigned_by)
         VALUES ($1,$2,'ACTIVE','REGULATOR_RECORD','direct-sql',$3,'test-harness')`,
        [institutionId, agent.id, randomUUID()],
      ),
    ).rejects.toThrow(/consumed INSTITUTION_AGENT_AFFILIATION_CHANGE approval/);

    // The governed path succeeds exactly once.
    const assigned = await assignAgent(agent.id, institutionId);
    expect(assigned.executed.status).toBe(201);
    expect(assigned.executed.body.status).toBe('ACTIVE');
    const rows = await affiliationRows(agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('ACTIVE');
  });

  it('7 — affiliation changes require an independent checker (maker and read-only roles denied)', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    const { networkManager, controller, auditor } = await roles();

    const body = affiliationBody(institutionId, 'ASSIGN');
    const created = await requestAffiliation(networkManager.token, agent.id, body);
    expect(created.status).toBe(201);

    // Maker cannot approve or execute its own request.
    expect((await approve(networkManager.token, created.body.approvalId)).status).toBe(403);
    const selfExecute = await executeAffiliation(networkManager.token, agent.id, {
      ...body,
      approvalId: created.body.approvalId,
    });
    expect(selfExecute.status).toBe(403);

    // Read-only auditor holds neither prepare nor approve.
    expect((await requestAffiliation(auditor.token, agent.id, body)).status).toBe(403);
    expect(
      (
        await executeAffiliation(auditor.token, agent.id, {
          ...body,
          approvalId: created.body.approvalId,
        })
      ).status,
    ).toBe(403);

    expect(await affiliationRows(agent.id)).toHaveLength(0);

    // Checker completes the same approval.
    expect((await approve(controller.token, created.body.approvalId)).status).toBe(201);
    const executed = await executeAffiliation(controller.token, agent.id, {
      ...body,
      approvalId: created.body.approvalId,
    });
    expect(executed.status).toBe(201);
    expect(executed.body.approvalId).toBe(created.body.approvalId);
  });

  it('8 — executing a consumed affiliation approval replays idempotently', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    const body = affiliationBody(institutionId, 'ASSIGN');
    const assigned = await governedAffiliation(agent.id, body);
    expect(assigned.executed.status).toBe(201);

    const { controller } = await roles();
    const replay = await executeAffiliation(controller.token, agent.id, {
      ...body,
      approvalId: assigned.created.body.approvalId,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.affiliationId).toBe(assigned.executed.body.affiliationId);
    expect(await affiliationRows(agent.id)).toHaveLength(1);
    const governed = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM governed_institution_affiliations`,
    );
    expect(governed[0]!.count).toBe('1');
  });

  it('rejects a consumed affiliation approval replay with a changed target or evidence', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    const body = affiliationBody(institutionId, 'ASSIGN');
    const assigned = await governedAffiliation(agent.id, body);
    expect(assigned.executed.status).toBe(201);
    const { controller } = await roles();
    const replay = await executeAffiliation(controller.token, agent.id, {
      ...body,
      evidenceReference: 'TAMPERED-EVIDENCE',
      approvalId: assigned.created.body.approvalId,
    });
    expect(replay.status).toBe(409);
  });

  it('rejects reuse of a consumed lifecycle approval for another direct database transition', async () => {
    const institutionId = await approvedInstitution();
    const old = await dataSource.query<Array<{ lifecycle_approval_id: string }>>(
      'SELECT lifecycle_approval_id FROM financial_institutions WHERE id=$1',
      [institutionId],
    );
    const { operator, controller } = await roles();
    const reason = 'Operational suspension pending a regulatory review';
    const suspension = await requestLifecycle(operator.token, institutionId, 'SUSPENDED', reason);
    expect(suspension.status).toBe(201);
    expect((await approve(controller.token, suspension.body.approvalId)).status).toBe(201);
    expect(
      (
        await executeLifecycle(
          controller.token,
          institutionId,
          suspension.body.approvalId,
          'SUSPENDED',
          reason,
        )
      ).status,
    ).toBe(201);
    await expect(
      dataSource.query(
        "UPDATE financial_institutions SET status='APPROVED', suspended_at=NULL, suspended_by=NULL, lifecycle_approval_id=$2 WHERE id=$1",
        [institutionId, old[0]!.lifecycle_approval_id],
      ),
    ).rejects.toThrow();
  });

  it('rejects a consumed lifecycle approval replay with a changed target or reason', async () => {
    const institutionId = await approvedInstitution();
    const { operator, controller } = await roles();
    const reason = 'Operational suspension pending a regulatory review';
    const suspension = await requestLifecycle(operator.token, institutionId, 'SUSPENDED', reason);
    expect(suspension.status).toBe(201);
    expect((await approve(controller.token, suspension.body.approvalId)).status).toBe(201);
    expect(
      (
        await executeLifecycle(
          controller.token,
          institutionId,
          suspension.body.approvalId,
          'SUSPENDED',
          reason,
        )
      ).status,
    ).toBe(201);
    const replay = await executeLifecycle(
      controller.token,
      institutionId,
      suspension.body.approvalId,
      'APPROVED',
      'A different request payload',
    );
    expect(replay.status).toBe(409);
  });

  it('replays the original lifecycle result after a new authorized reactivation, without new mutations', async () => {
    const institutionId = await approvedInstitution();
    const { operator, controller } = await roles();
    const reason = 'Suspension pending regulatory review';
    const suspension = await requestLifecycle(operator.token, institutionId, 'SUSPENDED', reason);
    expect(suspension.status).toBe(201);
    expect((await approve(controller.token, suspension.body.approvalId)).status).toBe(201);
    const first = await executeLifecycle(
      controller.token,
      institutionId,
      suspension.body.approvalId,
      'SUSPENDED',
      reason,
    );
    expect(first.status).toBe(201);
    const reactivationReason = 'Regulatory review completed';
    const reactivation = await requestLifecycle(
      operator.token,
      institutionId,
      'APPROVED',
      reactivationReason,
    );
    expect(reactivation.status).toBe(201);
    expect((await approve(controller.token, reactivation.body.approvalId)).status).toBe(201);
    expect(
      (
        await executeLifecycle(
          controller.token,
          institutionId,
          reactivation.body.approvalId,
          'APPROVED',
          reactivationReason,
        )
      ).status,
    ).toBe(201);
    const replay = await executeLifecycle(
      controller.token,
      institutionId,
      suspension.body.approvalId,
      'SUSPENDED',
      reason,
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const current = await dataSource.query<Array<{ status: string }>>(
      'SELECT status FROM financial_institutions WHERE id=$1',
      [institutionId],
    );
    expect(current[0]!.status).toBe('APPROVED');
    const records = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM governed_institution_lifecycle_executions WHERE approval_id=$1',
      [suspension.body.approvalId],
    );
    expect(records[0]!.count).toBe('1');
  });

  it('serializes concurrent lifecycle executions of one approval and creates one immutable record', async () => {
    const institutionId = await approvedInstitution();
    const { operator, controller } = await roles();
    const reason = 'Suspension reviewed for concurrent execution';
    const created = await requestLifecycle(operator.token, institutionId, 'SUSPENDED', reason);
    expect(created.status).toBe(201);
    expect((await approve(controller.token, created.body.approvalId)).status).toBe(201);
    const results = await Promise.all([
      executeLifecycle(
        controller.token,
        institutionId,
        created.body.approvalId,
        'SUSPENDED',
        reason,
      ),
      executeLifecycle(
        controller.token,
        institutionId,
        created.body.approvalId,
        'SUSPENDED',
        reason,
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    const rows = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM governed_institution_lifecycle_executions WHERE approval_id=$1',
      [created.body.approvalId],
    );
    expect(rows[0]!.count).toBe('1');
    await expect(
      dataSource.query(
        'DELETE FROM governed_institution_lifecycle_executions WHERE approval_id=$1',
        [created.body.approvalId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      dataSource.query(
        'UPDATE governed_institution_lifecycle_executions SET reason=$2 WHERE approval_id=$1',
        [created.body.approvalId, 'tampered'],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('rolls back approval consumption when the database transition is inconsistent', async () => {
    const institutionId = await approvedInstitution();
    const { operator, controller } = await roles();
    const reason = 'Suspend after independent regulatory review';
    const created = await requestLifecycle(operator.token, institutionId, 'SUSPENDED', reason);
    expect(created.status).toBe(201);
    expect((await approve(controller.token, created.body.approvalId)).status).toBe(201);
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.query(
          "UPDATE privileged_action_approvals SET status='CONSUMED', consumed_at=now() WHERE id=$1",
          [created.body.approvalId],
        );
        await manager.query(
          "UPDATE financial_institutions SET status='CLOSED', closed_at=now(), lifecycle_approval_id=$2, status_reason=$3 WHERE id=$1",
          [institutionId, created.body.approvalId, reason],
        );
      }),
    ).rejects.toThrow();
    const state = await dataSource.query<Array<{ status: string }>>(
      'SELECT status FROM financial_institutions WHERE id=$1',
      [institutionId],
    );
    expect(state[0]!.status).toBe('APPROVED');
    const approval = await dataSource.query<Array<{ status: string }>>(
      'SELECT status FROM privileged_action_approvals WHERE id=$1',
      [created.body.approvalId],
    );
    expect(approval[0]!.status).toBe('APPROVED');
    const rows = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM governed_institution_lifecycle_executions WHERE approval_id=$1',
      [created.body.approvalId],
    );
    expect(rows[0]!.count).toBe('0');
    await expect(
      dataSource.query(
        "UPDATE privileged_action_approvals SET status='CONSUMED', consumed_at=now() WHERE id=$1",
        [created.body.approvalId],
      ),
    ).rejects.toThrow();
  });

  it('rejects changing approved lifecycle payload metadata with direct SQL', async () => {
    const institutionId = await approvedInstitution();
    const { operator, controller } = await roles();
    const created = await requestLifecycle(
      operator.token,
      institutionId,
      'SUSPENDED',
      'Review institutional regulatory status',
    );
    expect(created.status).toBe(201);
    expect((await approve(controller.token, created.body.approvalId)).status).toBe(201);
    await expect(
      dataSource.query(
        `UPDATE privileged_action_approvals SET policy=jsonb_set(policy, '{requestDetails,targetStatus}', '"CLOSED"'::jsonb) WHERE id=$1`,
        [created.body.approvalId],
      ),
    ).rejects.toThrow();
  });

  it('rejects forged affiliation execution evidence even when transition fields match', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    const { networkManager, controller } = await roles();
    const body = affiliationBody(institutionId, 'ASSIGN');
    const created = await requestAffiliation(networkManager.token, agent.id, body);
    expect(created.status).toBe(201);
    expect((await approve(controller.token, created.body.approvalId)).status).toBe(201);
    const affiliationId = randomUUID();
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.query(
          "UPDATE privileged_action_approvals SET status='CONSUMED', consumed_at=now() WHERE id=$1",
          [created.body.approvalId],
        );
        await manager.query(
          `INSERT INTO institution_agent_affiliations (id,institution_id,agent_id,status,effective_from,evidence_type,evidence_reference,evidence_digest,approval_id,assigned_by)
        VALUES ($1,$2,$3,'ACTIVE',now(),$4,$5,$6,$7,'executor')`,
          [
            affiliationId,
            institutionId,
            agent.id,
            body.evidenceType,
            body.evidenceReference,
            'a'.repeat(64),
            created.body.approvalId,
          ],
        );
        await manager.query(
          `INSERT INTO governed_institution_affiliations (approval_id,affiliation_id,agent_id,institution_id,previous_institution_id,change_kind,evidence_type,evidence_reference,evidence_digest,reason,executed_by)
        VALUES ($1,$2,$3,$4,NULL,'ASSIGN',$5,$6,$7,$8,'executor')`,
          [
            created.body.approvalId,
            affiliationId,
            agent.id,
            institutionId,
            body.evidenceType,
            body.evidenceReference,
            'a'.repeat(64),
            body.reason,
          ],
        );
      }),
    ).rejects.toThrow();
  });

  it('rejects reuse of a consumed affiliation approval for direct reactivation', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    const assigned = await assignAgent(agent.id, institutionId);
    expect(assigned.executed.status).toBe(201);
    const suspension = await governedAffiliation(
      agent.id,
      affiliationBody(institutionId, 'SUSPEND'),
    );
    expect(suspension.executed.status).toBe(201);
    await expect(
      dataSource.query(
        "UPDATE institution_agent_affiliations SET status='ACTIVE', approval_id=$2 WHERE id=$1",
        [assigned.executed.body.affiliationId, assigned.created.body.approvalId],
      ),
    ).rejects.toThrow();
  });

  it('9 — concurrent competing approvals can only produce one ACTIVE affiliation', async () => {
    const first = await approvedInstitution();
    const second = await approvedInstitution();
    const agent = await createAgent();
    const { networkManager, controller } = await roles();

    const bodyA = affiliationBody(first, 'ASSIGN');
    const bodyB = affiliationBody(second, 'ASSIGN');
    const requestA = await requestAffiliation(networkManager.token, agent.id, bodyA);
    const requestB = await requestAffiliation(networkManager.token, agent.id, bodyB);
    expect(requestA.status).toBe(201);
    expect(requestB.status).toBe(201);
    expect((await approve(controller.token, requestA.body.approvalId)).status).toBe(201);
    expect((await approve(controller.token, requestB.body.approvalId)).status).toBe(201);

    const [resultA, resultB] = await Promise.all([
      executeAffiliation(controller.token, agent.id, {
        ...bodyA,
        approvalId: requestA.body.approvalId,
      }),
      executeAffiliation(controller.token, agent.id, {
        ...bodyB,
        approvalId: requestB.body.approvalId,
      }),
    ]);
    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const rows = await affiliationRows(agent.id);
    expect(rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('10 — a governed TRANSFER replaces the affiliation and preserves the terminated row', async () => {
    const first = await approvedInstitution();
    const second = await approvedInstitution();
    const agent = await createAgent();
    const assigned = await assignAgent(agent.id, first);

    const transferBody = affiliationBody(second, 'TRANSFER');
    const transfer = await governedAffiliation(agent.id, transferBody);
    expect(transfer.executed.status).toBe(201);
    expect(transfer.executed.body.changeKind).toBe('TRANSFER');
    expect(transfer.executed.body.institutionId).toBe(second);

    const rows = await affiliationRows(agent.id);
    expect(rows).toHaveLength(2);
    const previous = rows.find((row) => row.id === assigned.executed.body.affiliationId)!;
    expect(previous.status).toBe('TERMINATED');
    expect(previous.effective_to).not.toBeNull();
    expect(rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(1);

    const current = await request(app.getHttpServer())
      .get(`${AGENT_AFFILIATIONS}/${agent.id}`)
      .set(auth((await roles()).controller.token));
    expect(current.status).toBe(200);
    expect(current.body.institutionId).toBe(second);

    // The history is immutable.
    await expect(
      dataSource.query(
        `UPDATE governed_institution_affiliations SET reason = 'rewritten' WHERE approval_id = $1`,
        [transfer.created.body.approvalId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      dataSource.query(`DELETE FROM institution_agent_affiliations WHERE id = $1`, [previous.id]),
    ).rejects.toThrow(/immutable/);
  });

  it('11 — institution suspension makes affiliations unresolvable and blocks new changes', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    await assignAgent(agent.id, institutionId);

    const resolvedBefore = await resolution(agent.id);
    expect(resolvedBefore.status).toBe(200);
    expect(resolvedBefore.body.outcome).toBe('RESOLVED');
    expect(resolvedBefore.body.institutionId).toBe(institutionId);

    const { operator, controller } = await roles();
    const suspension = await requestLifecycle(
      operator.token,
      institutionId,
      'SUSPENDED',
      'Operational suspension pending a regulatory review',
    );
    expect(suspension.status).toBe(201);
    expect((await approve(controller.token, suspension.body.approvalId)).status).toBe(201);
    expect(
      (
        await executeLifecycle(
          controller.token,
          institutionId,
          suspension.body.approvalId,
          'SUSPENDED',
          'Operational suspension pending a regulatory review',
        )
      ).status,
    ).toBe(201);

    const resolvedAfter = await resolution(agent.id);
    expect(resolvedAfter.body.outcome).toBe('INSTITUTION_INACTIVE');
    expect(resolvedAfter.body.reason).toBe('INSTITUTION_SUSPENDED');
    expect(resolvedAfter.body.institutionId).toBe(institutionId);

    // New affiliation work for the suspended institution is refused, never auto-approved.
    const anotherAgent = await createAgent();
    const { networkManager } = await roles();
    const attempt = await requestAffiliation(
      networkManager.token,
      anotherAgent.id,
      affiliationBody(institutionId, 'ASSIGN'),
    );
    expect(attempt.status).toBe(409);
  });

  it('12 — conflicting open affiliations are reported, never silently resolved', async () => {
    const first = await approvedInstitution();
    const second = await approvedInstitution();
    const agent = await createAgent();

    const assigned = await assignAgent(agent.id, first);
    const suspend = await governedAffiliation(agent.id, affiliationBody(first, 'SUSPEND'));
    expect(suspend.executed.status).toBe(201);

    // The governed surface itself refuses to create a second open affiliation while a suspended
    // one is still open, so ambiguity cannot be produced through the supported workflow.
    const { networkManager } = await roles();
    const secondAssignment = await requestAffiliation(
      networkManager.token,
      agent.id,
      affiliationBody(second, 'ASSIGN'),
    );
    expect(secondAssignment.status).toBe(409);
    expect(assigned.executed.body.affiliationId).toBeTruthy();

    // Explicitly verify that application SQL cannot manufacture this conflict using an old
    // approval, then simulate historical corruption using a disposable database owner only.
    const insertConflict = () =>
      dataSource.query(
        `INSERT INTO institution_agent_affiliations
         (institution_id, agent_id, status, effective_from, evidence_type, evidence_reference,
          evidence_digest, approval_id, assigned_by)
       VALUES ($1,$2,'ACTIVE',clock_timestamp(),'REGULATOR_RECORD','out-of-band',$3,$4,'out-of-band')`,
        [second, agent.id, 'a'.repeat(64), suspend.created.body.approvalId],
      );
    await expect(insertConflict()).rejects.toThrow();
    await dataSource.query(
      'ALTER TABLE institution_agent_affiliations DISABLE TRIGGER institution_affiliation_transition_integrity',
    );
    try {
      await insertConflict();
    } finally {
      await dataSource.query(
        'ALTER TABLE institution_agent_affiliations ENABLE TRIGGER institution_affiliation_transition_integrity',
      );
    }

    const rows = await affiliationRows(agent.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.status !== 'TERMINATED')).toHaveLength(2);

    const conflict = await resolution(agent.id);
    expect(conflict.status).toBe(200);
    expect(conflict.body.outcome).toBe('INVALID_AFFILIATION');
    expect(conflict.body.reason).toBe('CONFLICTING_AFFILIATION');
    expect(conflict.body.institutionId).toBeNull();
    expect(conflict.body.affiliationId).toBeNull();
  });

  it('13 — the resolver distinguishes RESOLVED / UNRESOLVED / NOT_CONFIGURED and never invents one', async () => {
    const institutionId = await approvedInstitution();
    const affiliated = await createAgent();
    const unaffiliated = await createAgent();
    await assignAgent(affiliated.id, institutionId);

    const resolved = await resolution(affiliated.id);
    expect(resolved.body.outcome).toBe('RESOLVED');
    expect(resolved.body.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const unresolved = await resolution(unaffiliated.id);
    expect(unresolved.body.outcome).toBe('UNRESOLVED');
    expect(unresolved.body.reason).toBe('NO_AFFILIATION');
    expect(unresolved.body.institutionId).toBeNull();

    // The explicit non-configured resolver (test/dry-run only) reports NOT_CONFIGURED and never
    // substitutes a default institution.
    const notConfigured = await new NotConfiguredInstitutionResolver().resolve(
      dataSource.manager,
      affiliated.id,
    );
    expect(notConfigured.outcome).toBe('NOT_CONFIGURED');
    expect((notConfigured as any).reason).toBe('SCHEMA_NOT_CONFIGURED');
    expect(notConfigured.institutionId).toBeNull();

    // Fingerprints differ per outcome: an authorization can bind to the exact context.
    expect(resolved.body.evidenceFingerprint).not.toBe(unresolved.body.evidenceFingerprint);
  });

  it('14 — an aggregator relationship never establishes institutional affiliation', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    await createAggregatorWithAgent(agent.id);

    const unresolved = await resolution(agent.id);
    expect(unresolved.status).toBe(200);
    expect(unresolved.body.outcome).toBe('UNRESOLVED');
    expect(unresolved.body.reason).toBe('NO_AFFILIATION');
    expect(unresolved.body.institutionId).toBeNull();

    // Linking the aggregator to the institution still attributes nothing to the agent.
    const { superAdmin } = await roles();
    const aggregatorRows = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM aggregators LIMIT 1`,
    );
    const linked = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/aggregators`)
      .set(auth(superAdmin.token))
      .send({ aggregatorId: aggregatorRows[0]!.id });
    expect(linked.status).toBe(201);
    expect(linked.body.status).toBe('ACTIVE');

    const stillUnresolved = await resolution(agent.id);
    expect(stillUnresolved.body.outcome).toBe('UNRESOLVED');
    expect(stillUnresolved.body.reason).toBe('NO_AFFILIATION');
  });

  it('15 — workforce institution scope is resolved per request, not from the token', async () => {
    const first = await approvedInstitution();
    const second = await approvedInstitution();
    const { superAdmin, operator } = await roles();

    // The operator is scoped to BOTH institutions while onboarding them; narrow it to the FIRST
    // only, using the same already-issued session token throughout.
    const unscoped = await request(app.getHttpServer())
      .delete(`${INSTITUTIONS}/${second}/workforce/${operator.principalId}`)
      .set(auth(superAdmin.token));
    expect(unscoped.status).toBe(200);

    const allowed = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${first}`)
      .set(auth(operator.token));
    expect(allowed.status).toBe(200);

    const denied = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${second}`)
      .set(auth(operator.token));
    expect(denied.status).toBe(404);

    const list = await request(app.getHttpServer()).get(INSTITUTIONS).set(auth(operator.token));
    expect(list.status).toBe(200);
    expect((list.body as Array<{ id: string }>).map((row) => row.id)).toEqual([first]);

    // Revocation applies to the SAME already-issued session token immediately.
    const revoked = await request(app.getHttpServer())
      .delete(`${INSTITUTIONS}/${first}/workforce/${operator.principalId}`)
      .set(auth(superAdmin.token));
    expect(revoked.status).toBe(200);
    expect(revoked.body.status).toBe('REVOKED');

    const afterRevocation = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${first}`)
      .set(auth(operator.token));
    expect(afterRevocation.status).toBe(404);

    // Platform-level staff (explicit attribution function) retain cross-institution read.
    const platform = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${second}`)
      .set(auth((await roles()).controller.token));
    expect(platform.status).toBe(200);
  });

  it('16 — institution-scoped operators cannot enumerate agent affiliations', async () => {
    const institutionId = await approvedInstitution();
    const agent = await createAgent();
    await assignAgent(agent.id, institutionId);

    const { operator } = await roles();
    const deniedRead = await request(app.getHttpServer())
      .get(`${AGENT_AFFILIATIONS}/${agent.id}`)
      .set(auth(operator.token));
    expect(deniedRead.status).toBe(403);

    const deniedHistory = await request(app.getHttpServer())
      .get(`${AGENT_AFFILIATIONS}/${agent.id}/history`)
      .set(auth(operator.token));
    expect(deniedHistory.status).toBe(403);

    const deniedGaps = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/attribution-gaps`)
      .set(auth(operator.token));
    expect(deniedGaps.status).toBe(403);

    // Unauthenticated access never reaches the surface.
    expect(
      (await request(app.getHttpServer()).get(`${INSTITUTIONS}/${institutionId}`)).status,
    ).toBe(401);

    // The explicit platform marker can read it.
    const allowed = await request(app.getHttpServer())
      .get(`${AGENT_AFFILIATIONS}/${agent.id}`)
      .set(auth((await roles()).controller.token));
    expect(allowed.status).toBe(200);
    expect(allowed.body.institutionId).toBe(institutionId);
  });

  it('17 — attribution gaps are read-only visibility over untouched existing data', async () => {
    const institutionId = await approvedInstitution();
    const affiliated = await createAgent();
    const unaffiliated = await createAgent();
    await assignAgent(affiliated.id, institutionId);

    const wallet = await createAgentWallet(unaffiliated.id, true);
    const linesBefore = await ledgerLineCount();
    const balanceBefore = await walletBalance(wallet.ledgerAccountId);

    const { controller } = await roles();
    const gaps = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/attribution-gaps`)
      .set(auth(controller.token));
    expect(gaps.status).toBe(200);
    const gapRows = gaps.body as Array<{ entityId: string; gapReason: string }>;
    expect(gapRows.map((row) => row.entityId)).toContain(unaffiliated.id);
    expect(gapRows.map((row) => row.entityId)).not.toContain(affiliated.id);
    expect(gapRows.find((row) => row.entityId === unaffiliated.id)!.gapReason).toBe(
      'NO_AFFILIATION',
    );

    const summary = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/attribution-gaps/summary`)
      .set(auth(controller.token));
    expect(summary.status).toBe(200);
    expect(summary.body).toEqual([{ gapReason: 'NO_AFFILIATION', agentCount: 1 }]);

    // Report generation wrote nothing.
    expect(await ledgerLineCount()).toBe(linesBefore);
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(balanceBefore);
    const institutions = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM financial_institutions`,
    );
    expect(institutions[0]!.count).toBe('1');
  });

  it('18 — affiliation changes never move balances, rewrite journals or alter wallets', async () => {
    const first = await approvedInstitution();
    const second = await approvedInstitution();
    const agent = await createAgent();
    await assignAgent(agent.id, first);

    const wallet = await createAgentWallet(agent.id, true);
    const linesBefore = await ledgerLineCount();
    const balanceBefore = await walletBalance(wallet.ledgerAccountId);
    const [journalCountBefore] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM ledger_journals`,
    );

    // A transfer is refused while the agent still holds value: reassignment may not strand it.
    const { networkManager } = await roles();
    const blocked = await requestAffiliation(
      networkManager.token,
      agent.id,
      affiliationBody(second, 'TRANSFER'),
    );
    expect(blocked.status).toBe(409);

    // Settle the wallet with an honest synthetic movement, then transfer.
    await settleMovement(wallet.ledgerAccountId, '500000');
    const settledBalance = await walletBalance(wallet.ledgerAccountId);
    expect(settledBalance).toBe(0n);

    const transfer = await governedAffiliation(agent.id, affiliationBody(second, 'TRANSFER'));
    expect(transfer.executed.status).toBe(201);
    expect(transfer.executed.body.institutionId).toBe(second);

    // Wallet id, currency, ledger account and net balance are untouched by the change.
    const [walletRow] = await dataSource.query<
      Array<{ id: string; ledger_account_id: string; customer_id: string }>
    >(`SELECT id, ledger_account_id, customer_id FROM wallet_accounts WHERE id = $1`, [wallet.id]);
    expect(walletRow!.ledger_account_id).toBe(wallet.ledgerAccountId);
    expect(walletRow!.customer_id).toBe(agent.id);
    expect(await walletBalance(wallet.ledgerAccountId)).toBe(settledBalance);
    expect(balanceBefore).toBe(500000n);

    // Only the settlement movement was added; nothing was rewritten or removed.
    expect(await ledgerLineCount()).toBe(linesBefore + 2);
    const [journalCountAfter] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM ledger_journals`,
    );
    expect(Number(journalCountAfter!.count)).toBe(Number(journalCountBefore!.count) + 1);

    // No fabricated institutional attribution was written onto historical financial rows.
    const columns = await dataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('wallet_accounts', 'ledger_journals', 'ledger_lines')
          AND column_name LIKE '%institution%'`,
    );
    expect(columns).toHaveLength(0);
  });
});
