/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * ARENA 4 Phase 3 — institutional administration console read API (real PostgreSQL + real HTTP).
 *
 * Covers the two minimal read endpoints the console needed and nothing else:
 *
 *  - `GET /internal/institutions/:institutionId/pending-approvals` — institution-scoped;
 *  - `GET /internal/institution-agent-directory` — platform read, three-way relationship
 *    classification that never promotes an aggregator link to an institutional affiliation.
 *
 * Every authorization decision here is made by the real guard + catalogue stack; nothing is mocked.
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
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const INSTITUTIONS = '/api/v1/internal/institutions';
const AGENT_AFFILIATIONS = '/api/v1/internal/agent-affiliations';
const AGENT_DIRECTORY = '/api/v1/internal/institution-agent-directory';
const APPROVALS = '/api/v1/internal/a2/workforce/approvals';

type RoleKey =
  | 'superAdmin'
  | 'operator'
  | 'networkManager'
  | 'preparer'
  | 'controller'
  | 'riskFraud';

interface Role {
  principalId: string;
  token: string;
}

describe('Institutional administration console reads (ARENA 4 Phase 3) — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let sessions: A2WorkforceSessionService;
  let provisioned: Record<RoleKey, Role> | undefined;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('arena4console');

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
    const principalId = `arena4console:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `arena4-console:${principalId}`,
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
        preparer: await provisionRole('FINANCE_PREPARER'),
        controller: await provisionRole('FINANCE_CONTROLLER'),
        riskFraud: await provisionRole('RISK_FRAUD'),
      };
    }
    return provisioned;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function approve(token: string, approvalId: string) {
    return request(app.getHttpServer())
      .post(`${APPROVALS}/${approvalId}/approve`)
      .set(auth(token))
      .send({ comment: 'independently checked by the designated checker' });
  }

  async function approvedInstitution(principalIds: string[] = []): Promise<string> {
    const { superAdmin, operator, controller } = await roles();
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const registered = await request(app.getHttpServer())
      .post(INSTITUTIONS)
      .set(auth(superAdmin.token))
      .send({
        reference: `FI3-${suffix}`,
        code: `FI3_${suffix}`,
        legalName: `Institution ${suffix} Limited`,
        institutionType: 'MICROFINANCE_BANK',
        regulatorName: 'Central Bank',
        licenceReference: `LIC3/${suffix}`,
      });
    expect(registered.status).toBe(201);
    const institutionId = registered.body.id as string;
    expect(
      (
        await request(app.getHttpServer())
          .post(`${INSTITUTIONS}/${institutionId}/evidence`)
          .set(auth(superAdmin.token))
          .send({
            evidenceReference: `EVID3-${suffix}`,
            regulatorName: 'Central Bank',
            licenceReference: `LIC3/${suffix}`,
          })
      ).status,
    ).toBe(201);
    for (const principalId of principalIds) {
      expect(
        (
          await request(app.getHttpServer())
            .post(`${INSTITUTIONS}/${institutionId}/workforce`)
            .set(auth(superAdmin.token))
            .send({ principalId })
        ).status,
      ).toBe(201);
    }
    const reason = 'Regulatory evidence verified by compliance and operational approval recorded';
    const prepared = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle/request`)
      .set(auth(operator.token))
      .send({ targetStatus: 'APPROVED', reason });
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${INSTITUTIONS}/${institutionId}/lifecycle`)
          .set(auth(controller.token))
          .send({ approvalId: prepared.body.approvalId, targetStatus: 'APPROVED', reason })
      ).status,
    ).toBe(201);
    return institutionId;
  }

  /** Registered + evidence only: no activation, no workforce scope. */
  async function registeredInstitution(): Promise<string> {
    const { superAdmin } = await roles();
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const registered = await request(app.getHttpServer())
      .post(INSTITUTIONS)
      .set(auth(superAdmin.token))
      .send({
        reference: `FI3R-${suffix}`,
        code: `FI3R_${suffix}`,
        legalName: `Institution ${suffix} Limited`,
        institutionType: 'MICROFINANCE_BANK',
        regulatorName: 'Central Bank',
        licenceReference: `LIC3R/${suffix}`,
      });
    expect(registered.status).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${INSTITUTIONS}/${registered.body.id}/evidence`)
          .set(auth(superAdmin.token))
          .send({
            evidenceReference: `EVID3R-${suffix}`,
            regulatorName: 'Central Bank',
            licenceReference: `LIC3R/${suffix}`,
          })
      ).status,
    ).toBe(201);
    return registered.body.id as string;
  }

  async function createAgent(reference?: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(`INSERT INTO agents (id, reference, status) VALUES ($1,$2,'ACTIVE')`, [
      id,
      reference ?? `agent-${id.slice(0, 8)}`,
    ]);
    return id;
  }

  async function createCustomer(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status, is_synthetic)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_2','APPROVED',false)`,
      [id, `cust-${id.slice(0, 8)}`],
    );
    return id;
  }

  /** Creates a REQUESTED affiliation approval (maker only) and returns its exact payload. */
  async function pendingAffiliationApproval(
    agentId: string,
    institutionId: string,
  ): Promise<{ approvalId: string; body: Record<string, unknown> }> {
    const { networkManager } = await roles();
    const body = {
      institutionId,
      changeKind: 'ASSIGN',
      evidenceType: 'INSTITUTION_APPROVAL_LETTER',
      evidenceReference: `AFF3-${randomUUID().slice(0, 8)}`,
      reason: 'Agent appointed under the institution approval letter on file',
    };
    const prepared = await request(app.getHttpServer())
      .post(`${AGENT_AFFILIATIONS}/${agentId}/request`)
      .set(auth(networkManager.token))
      .send(body);
    expect(prepared.status).toBe(201);
    return { approvalId: prepared.body.approvalId as string, body };
  }

  async function activeAffiliation(agentId: string, institutionId: string): Promise<void> {
    const { networkManager, controller } = await roles();
    const body = {
      institutionId,
      changeKind: 'ASSIGN',
      evidenceType: 'INSTITUTION_APPROVAL_LETTER',
      evidenceReference: `AFF3-${randomUUID().slice(0, 8)}`,
      reason: 'Agent appointed under the institution approval letter on file',
    };
    const prepared = await request(app.getHttpServer())
      .post(`${AGENT_AFFILIATIONS}/${agentId}/request`)
      .set(auth(networkManager.token))
      .send(body);
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post(`${AGENT_AFFILIATIONS}/${agentId}/execute`)
          .set(auth(controller.token))
          .send({ ...body, approvalId: prepared.body.approvalId })
      ).status,
    ).toBe(201);
  }

  async function aggregatorLink(agentId: string): Promise<string> {
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

  // ================================================================== acceptance cases

  it('1 — pending approvals are scoped to the institution named in the frozen payload', async () => {
    const { operator, preparer } = await roles();
    const institutionA = await approvedInstitution([operator.principalId, preparer.principalId]);
    const institutionB = await approvedInstitution([operator.principalId, preparer.principalId]);
    const agentA = await createAgent();
    const agentB = await createAgent();
    const approvalForA = (await pendingAffiliationApproval(agentA, institutionA)).approvalId;
    const approvalForB = (await pendingAffiliationApproval(agentB, institutionB)).approvalId;

    const forA = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionA}/pending-approvals`)
      .set(auth(operator.token));
    expect(forA.status).toBe(200);
    expect(forA.body).toHaveLength(1);
    expect(forA.body[0]).toMatchObject({
      approvalId: approvalForA,
      actionType: 'INSTITUTION_AGENT_AFFILIATION_CHANGE',
      resourceType: 'AGENT',
      resourceId: agentA,
      status: 'REQUESTED',
      awaitingChecker: true,
    });
    expect(forA.body[0].requesterPrincipalId).toBeTruthy();

    const forB = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionB}/pending-approvals`)
      .set(auth(operator.token));
    expect(forB.status).toBe(200);
    expect(forB.body.map((row: any) => row.approvalId)).toEqual([approvalForB]);
  });

  it('2 — pending approvals track checker progress and exclude unrelated/non-pending decisions', async () => {
    const { operator, controller } = await roles();
    const institutionId = await approvedInstitution([operator.principalId]);
    const agent = await createAgent();
    const { approvalId, body } = await pendingAffiliationApproval(agent, institutionId);

    // A separate institution's request must never leak into this institution's queue.
    const otherInstitution = await approvedInstitution([operator.principalId]);
    await pendingAffiliationApproval(await createAgent(), otherInstitution);

    expect((await approve(controller.token, approvalId)).status).toBe(201);
    const approvedQueue = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionId}/pending-approvals`)
      .set(auth(operator.token));
    expect(approvedQueue.status).toBe(200);
    expect(approvedQueue.body).toHaveLength(1);
    expect(approvedQueue.body[0]).toMatchObject({
      approvalId,
      status: 'APPROVED',
      awaitingChecker: false,
    });
    expect(approvedQueue.body[0].approvedBy).toBeTruthy();

    // Executing the affiliated change consumes the approval; it leaves the pending queue.
    const executed = await request(app.getHttpServer())
      .post(`${AGENT_AFFILIATIONS}/${agent}/execute`)
      .set(auth(controller.token))
      .send({ ...body, approvalId });
    expect(executed.status).toBe(201);

    const afterExecution = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionId}/pending-approvals`)
      .set(auth(operator.token));
    expect(afterExecution.status).toBe(200);
    expect(afterExecution.body).toEqual([]);

    // The affiliation itself is still visible through the existing history endpoint.
    const history = await request(app.getHttpServer())
      .get(`${AGENT_AFFILIATIONS}/${agent}/history`)
      .set(auth(controller.token));
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).toContain(institutionId);
  });

  it('3 — institution-scoped staff cannot read another institution or without a scope', async () => {
    const { operator, networkManager, riskFraud } = await roles();
    const institutionA = await approvedInstitution([operator.principalId]);
    const institutionB = await registeredInstitution();

    const own = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionA}/pending-approvals`)
      .set(auth(operator.token));
    expect(own.status).toBe(200);

    const foreign = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionB}/pending-approvals`)
      .set(auth(operator.token));
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain(institutionB);

    // AGENT_NETWORK_MANAGER holds institution.view but no assignment here.
    expect(
      (
        await request(app.getHttpServer())
          .get(`${INSTITUTIONS}/${institutionA}/pending-approvals`)
          .set(auth(networkManager.token))
      ).status,
    ).toBe(404);

    // RISK_FRAUD holds no institution function at all.
    expect(
      (
        await request(app.getHttpServer())
          .get(`${INSTITUTIONS}/${institutionA}/pending-approvals`)
          .set(auth(riskFraud.token))
      ).status,
    ).toBe(403);

    expect(
      (
        await request(app.getHttpServer())
          .get(`${INSTITUTIONS}/${institutionA}/pending-approvals`)
          .set(auth('not-a-session'))
      ).status,
    ).toBe(401);
  });

  it('4 — the agent directory is platform-only and classifies relationships without inference', async () => {
    const { operator, controller } = await roles();
    const institutionId = await approvedInstitution([operator.principalId]);

    const affiliatedAgent = await createAgent('AG-AFFILIATED');
    await activeAffiliation(affiliatedAgent, institutionId);
    const aggregatorAgent = await createAgent('AG-AGGREGATOR');
    await aggregatorLink(aggregatorAgent);
    const independentAgent = await createAgent('AG-INDEPENDENT');

    // Institution-scoped staff hold no platform marker: the directory stays closed to them.
    expect(
      (await request(app.getHttpServer()).get(AGENT_DIRECTORY).set(auth(operator.token))).status,
    ).toBe(403);
    expect(
      (await request(app.getHttpServer()).get(AGENT_DIRECTORY).set(auth('not-a-session'))).status,
    ).toBe(401);

    const all = await request(app.getHttpServer()).get(AGENT_DIRECTORY).set(auth(controller.token));
    expect(all.status).toBe(200);
    const byReference = new Map(all.body.map((row: any) => [row.agentReference, row]));
    expect(byReference.get('AG-AFFILIATED')).toMatchObject({
      agentId: affiliatedAgent,
      relationship: 'INSTITUTION_AFFILIATED',
      affiliationInstitutionId: institutionId,
      affiliationStatus: 'ACTIVE',
      aggregatorReference: null,
    });
    expect(byReference.get('AG-AGGREGATOR')).toMatchObject({
      agentId: aggregatorAgent,
      relationship: 'AGGREGATOR_LINKED',
      affiliationId: null,
      affiliationInstitutionId: null,
    });
    expect(byReference.get('AG-INDEPENDENT')).toMatchObject({
      agentId: independentAgent,
      relationship: 'INDEPENDENT',
      affiliationId: null,
      aggregatorReference: null,
    });

    // An aggregator link never satisfies an affiliation filter for the institution.
    const affiliated = await request(app.getHttpServer())
      .get(AGENT_DIRECTORY)
      .set(auth(controller.token))
      .query({ institutionId, affiliation: 'AFFILIATED' });
    expect(affiliated.status).toBe(200);
    expect(affiliated.body.map((row: any) => row.agentId)).toEqual([affiliatedAgent]);

    const unaffiliated = await request(app.getHttpServer())
      .get(AGENT_DIRECTORY)
      .set(auth(controller.token))
      .query({ affiliation: 'UNAFFILIATED' });
    expect(unaffiliated.status).toBe(200);
    const unaffiliatedIds = unaffiliated.body.map((row: any) => row.agentId);
    expect(unaffiliatedIds).toEqual(expect.arrayContaining([aggregatorAgent, independentAgent]));
    expect(unaffiliatedIds).not.toContain(affiliatedAgent);

    // Search narrows by agent reference only.
    const searched = await request(app.getHttpServer())
      .get(AGENT_DIRECTORY)
      .set(auth(controller.token))
      .query({ search: 'AGGREGATOR' });
    expect(searched.status).toBe(200);
    expect(searched.body.map((row: any) => row.agentId)).toEqual([aggregatorAgent]);

    // AFFILIATED without an institution is a request error, not a silent platform-wide answer.
    expect(
      (
        await request(app.getHttpServer())
          .get(AGENT_DIRECTORY)
          .set(auth(controller.token))
          .query({ affiliation: 'AFFILIATED' })
      ).status,
    ).toBe(400);
  });

  it('5 — the directory never exposes financial data or writes anything', async () => {
    const { controller, operator } = await roles();
    const institutionId = await approvedInstitution([operator.principalId]);
    const agent = await createAgent('AG-NO-FINANCE');
    await activeAffiliation(agent, institutionId);

    const before = await dataSource.query<
      Array<{ wallets: string; journals: string; lines: string; approvals: string }>
    >(
      `SELECT (SELECT count(*) FROM wallet_accounts)::text AS wallets,
              (SELECT count(*) FROM ledger_journals)::text AS journals,
              (SELECT count(*) FROM ledger_lines)::text AS lines,
              (SELECT count(*) FROM privileged_action_approvals)::text AS approvals`,
    );
    const response = await request(app.getHttpServer())
      .get(AGENT_DIRECTORY)
      .set(auth(controller.token));
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/balance|amount_minor|walletId|ledgerAccount/i);

    const after = await dataSource.query<
      Array<{ wallets: string; journals: string; lines: string; approvals: string }>
    >(
      `SELECT (SELECT count(*) FROM wallet_accounts)::text AS wallets,
              (SELECT count(*) FROM ledger_journals)::text AS journals,
              (SELECT count(*) FROM ledger_lines)::text AS lines,
              (SELECT count(*) FROM privileged_action_approvals)::text AS approvals`,
    );
    expect(after).toEqual(before);
  });

  it('6 — enrolment and attribution requests appear in the institution queue while pending', async () => {
    const { operator, preparer, networkManager } = await roles();
    const institutionId = await approvedInstitution([
      operator.principalId,
      preparer.principalId,
      networkManager.principalId,
    ]);
    const customerId = await createCustomer();

    const enrolment = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/enrolments`)
      .set(auth(networkManager.token))
      .send({
        customerId,
        reference: `ENR3-${randomUUID().slice(0, 10).toUpperCase()}`,
        targetStatus: 'ACTIVE',
        financialEligibility: 'ELIGIBLE',
        statusReason: 'Enrolment requested under the institutional onboarding agreement',
        kycReuse: {
          evidenceReference: 'KYC-EVID-001',
          consentReference: 'CONSENT-001',
          policyReference: 'POLICY-KYC-REUSE-001',
        },
      });
    expect(enrolment.status).toBe(201);

    const queue = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionId}/pending-approvals`)
      .set(auth(operator.token));
    expect(queue.status).toBe(200);
    const enrolmentRow = queue.body.find(
      (row: any) => row.approvalId === enrolment.body.approvalId,
    );
    expect(enrolmentRow).toMatchObject({
      actionType: 'CUSTOMER_INSTITUTION_ENROLMENT_CHANGE',
      resourceType: 'CUSTOMER',
      resourceId: customerId,
      awaitingChecker: true,
    });
    // Only metadata is exposed — never the frozen payload's KYC references.
    expect(JSON.stringify(queue.body)).not.toMatch(/POLICY-KYC-REUSE-001|CONSENT-001/);
    expect(preparer.token).toBeTruthy();
  });
});
