/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * ARENA 4 Phase 2 — institutional financial ownership. Real PostgreSQL + real HTTP acceptance
 * suite (16 cases).
 *
 * Proves migration `1785753600401-CreateInstitutionalFinancialOwnership`:
 *
 *  - one customer identity, per-institution enrolments with independent lifecycle and eligibility;
 *  - governed `WALLET_INSTITUTION_ATTRIBUTION` (evidence, maker-checker, MFA, atomic consumption,
 *    immutable execution record, idempotent replay, concurrency safety);
 *  - historical wallets/journals/balances preserved, nothing defaulted or inferred;
 *  - database + service ledger isolation (no cross-institution posting, no unattributed bypass);
 *  - the published `FinancialContextResolver` contract, including transaction participation;
 *  - the complete migration chain.
 *
 * Every fixture is synthetic. No provider call, no real financial transaction, no deployment.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import {
  DatabaseFinancialContextResolver,
  FINANCIAL_CONTEXT_RESOLVER,
  type FinancialContextResolver,
} from '../src/institution/financial-context-resolver';
import { InstitutionAttributionEvidenceType } from '../src/institution/institution.enums';
import { WalletInstitutionAttributionService } from '../src/institution/wallet-institution-attribution.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

const INSTITUTIONS = '/api/v1/internal/institutions';
const AGENT_AFFILIATIONS = '/api/v1/internal/agent-affiliations';
const INSTITUTION_LEDGER = '/api/v1/internal/institution-ledger';
const ENROLMENT_READS = '/api/v1/internal/institution-enrolments';
const FINANCIAL_CONTEXT = '/api/v1/internal/financial-context';
const APPROVALS = '/api/v1/internal/a2/workforce/approvals';

type RoleKey = 'superAdmin' | 'operator' | 'networkManager' | 'preparer' | 'controller' | 'auditor';

interface Role {
  principalId: string;
  token: string;
  principal: AuthorizationPrincipal;
}

describe('Institutional financial ownership (ARENA 4 Phase 2) — real PostgreSQL + real HTTP', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let ledger: LedgerService;
  let sessions: A2WorkforceSessionService;
  let attributionService: WalletInstitutionAttributionService;
  let contextResolver: FinancialContextResolver;
  let provisioned: Record<RoleKey, Role> | undefined;
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    dataSource = await createIntegrationDataSource('arena4finownership');

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
    attributionService = moduleRef.get(WalletInstitutionAttributionService);
    contextResolver = moduleRef.get<FinancialContextResolver>(FINANCIAL_CONTEXT_RESOLVER);
    expect(moduleRef.get(DatabaseFinancialContextResolver)).toBeDefined();
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

  // ---------------------------------------------------------------- workforce fixtures

  async function provisionRole(roleKey: string): Promise<Role> {
    const principalId = `arena4fin:${roleKey}:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await dataSource.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: `arena4-financial-ownership:${principalId}`,
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
    const principal = await sessions.validate(result.accessToken, 'workforce-admin');
    return { principalId, token: result.accessToken, principal };
  }

  async function roles(): Promise<Record<RoleKey, Role>> {
    if (!provisioned) {
      provisioned = {
        superAdmin: await provisionRole('SUPER_ADMIN'),
        operator: await provisionRole('OPERATIONS'),
        networkManager: await provisionRole('AGENT_NETWORK_MANAGER'),
        preparer: await provisionRole('FINANCE_PREPARER'),
        controller: await provisionRole('FINANCE_CONTROLLER'),
        auditor: await provisionRole('FINANCE_AUDITOR'),
      };
    }
    return provisioned;
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // -------------------------------------------------------------- institution fixtures

  let institutionSequence = 0;

  async function registerInstitution(token: string): Promise<string> {
    institutionSequence += 1;
    const suffix = `${institutionSequence}${randomUUID().slice(0, 6).toUpperCase()}`;
    const response = await request(app.getHttpServer())
      .post(INSTITUTIONS)
      .set(auth(token))
      .send({
        reference: `FI2-${suffix}`,
        code: `FI2_${suffix}`,
        legalName: `Institution ${suffix} Limited`,
        institutionType: 'MICROFINANCE_BANK',
        regulatorName: 'Central Bank',
        licenceReference: `LIC2/${suffix}`,
      });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  async function approve(token: string, approvalId: string) {
    return request(app.getHttpServer())
      .post(`${APPROVALS}/${approvalId}/approve`)
      .set(auth(token))
      .send({ comment: 'independently checked by the designated checker' })
      .then((response) => response);
  }

  async function grantWorkforce(institutionId: string, principalId: string): Promise<void> {
    const { superAdmin } = await roles();
    const response = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/workforce`)
      .set(auth(superAdmin.token))
      .send({ principalId });
    expect(response.status).toBe(201);
  }

  /** Register → evidence → optional workforce scope → governed activation. */
  async function approvedInstitution(
    principalIds: string[] = [],
    withNetworkManager = true,
  ): Promise<string> {
    const { superAdmin, operator, controller } = await roles();
    const institutionId = await registerInstitution(superAdmin.token);
    const evidence = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/evidence`)
      .set(auth(superAdmin.token))
      .send({
        evidenceReference: `EVID2-${institutionId.slice(0, 8)}`,
        regulatorName: 'Central Bank',
        licenceReference: `LIC2-${institutionId.slice(0, 8)}`,
      });
    expect(evidence.status).toBe(201);
    const scoped = withNetworkManager
      ? [...new Set([...principalIds, (await roles()).networkManager.principalId])]
      : principalIds;
    for (const principalId of scoped) await grantWorkforce(institutionId, principalId);

    const prepared = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle/request`)
      .set(auth(operator.token))
      .send({
        targetStatus: 'APPROVED',
        reason: 'Regulatory evidence verified by compliance and operational approval recorded',
      });
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);
    const executed = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle`)
      .set(auth(controller.token))
      .send({
        approvalId: prepared.body.approvalId,
        targetStatus: 'APPROVED',
        reason: 'Regulatory evidence verified by compliance and operational approval recorded',
      });
    expect(executed.status).toBe(201);
    return institutionId;
  }

  async function suspendInstitution(institutionId: string): Promise<void> {
    const { operator, controller } = await roles();
    const reason = 'Supervisory suspension notice received and recorded for operations';
    const prepared = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle/request`)
      .set(auth(operator.token))
      .send({ targetStatus: 'SUSPENDED', reason });
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);
    const executed = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/lifecycle`)
      .set(auth(controller.token))
      .send({ approvalId: prepared.body.approvalId, targetStatus: 'SUSPENDED', reason });
    expect(executed.status).toBe(201);
  }

  async function agentAffiliation(agentId: string, institutionId: string): Promise<void> {
    const { networkManager, controller } = await roles();
    const body = {
      institutionId,
      changeKind: 'ASSIGN',
      evidenceType: 'INSTITUTION_APPROVAL_LETTER',
      evidenceReference: `AFF2-${randomUUID().slice(0, 8)}`,
      reason: 'Agent appointed under the institution approval letter on file',
    };
    const prepared = await request(app.getHttpServer())
      .post(`${AGENT_AFFILIATIONS}/${agentId}/request`)
      .set(auth(networkManager.token))
      .send(body);
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);
    const executed = await request(app.getHttpServer())
      .post(`${AGENT_AFFILIATIONS}/${agentId}/execute`)
      .set(auth(controller.token))
      .send({ ...body, approvalId: prepared.body.approvalId });
    expect(executed.status).toBe(201);
  }

  // ------------------------------------------------------------------ customer fixtures

  async function createCustomer(
    kycStatus = 'APPROVED',
    kycLevel = 'LEVEL_2',
  ): Promise<{ id: string; reference: string }> {
    const id = randomUUID();
    const reference = `cust-${id.slice(0, 8)}`;
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status, is_synthetic)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE',$3,$4,false)`,
      [id, reference, kycLevel, kycStatus],
    );
    return { id, reference };
  }

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

  async function createLedgerAccount(
    type: LedgerAccountType = LedgerAccountType.LIABILITY,
    normalBalance: LedgerNormalBalance = LedgerNormalBalance.CREDIT,
    allowNegativeBalance = false,
  ): Promise<string> {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const account = await ledger.createAccount({
      code: `A4P2-${suffix}`,
      name: `A4P2 ${suffix}`,
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
      idempotencyKey: `a4p2-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'Arena 4 Phase 2 synthetic historical movement',
      lines: [
        { accountId: assetId, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: liabilityAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
    return journal.id;
  }

  async function createWallet(
    ownerReference: string,
    funded = false,
  ): Promise<{ id: string; ledgerAccountId: string; journalId: string | null }> {
    const ledgerAccountId = await createLedgerAccount();
    const journalId = funded ? await postMovement(ledgerAccountId, '500000') : null;
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO wallet_accounts (id, customer_id, currency, status, ledger_account_id)
       VALUES ($1,$2,'NGN','ACTIVE',$3)`,
      [id, ownerReference, ledgerAccountId],
    );
    return { id, ledgerAccountId, journalId };
  }

  async function walletRow(walletId: string) {
    const [row] = await dataSource.query<
      Array<{
        id: string;
        institution_id: string | null;
        owner_class: string;
        ledger_account_id: string;
      }>
    >(
      `SELECT id, institution_id, owner_class, ledger_account_id FROM wallet_accounts WHERE id=$1`,
      [walletId],
    );
    return row!;
  }

  async function ledgerAccountRow(accountId: string) {
    const [row] = await dataSource.query<
      Array<{
        institutional_scope: string;
        institution_id: string | null;
        institutional_purpose: string | null;
      }>
    >(
      `SELECT institutional_scope, institution_id, institutional_purpose FROM ledger_accounts WHERE id=$1`,
      [accountId],
    );
    return row!;
  }

  async function counts() {
    const [row] = await dataSource.query<
      Array<{ lines: string; journals: string; receipts: string; enrolments: string }>
    >(
      `SELECT (SELECT count(*) FROM ledger_lines)::text AS lines,
              (SELECT count(*) FROM ledger_journals)::text AS journals,
              (SELECT count(*) FROM governed_wallet_institution_attributions)::text AS receipts,
              (SELECT count(*) FROM customer_institution_enrolments)::text AS enrolments`,
    );
    return {
      lines: Number(row!.lines),
      journals: Number(row!.journals),
      receipts: Number(row!.receipts),
      enrolments: Number(row!.enrolments),
    };
  }

  async function balanceOf(ledgerAccountId: string): Promise<bigint> {
    const [row] = await dataSource.query<Array<{ balance: string }>>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    return BigInt(row!.balance);
  }

  // ---------------------------------------------------------------- enrolment helpers

  const enrolmentBody = (
    customerId: string,
    targetStatus: 'PENDING' | 'ACTIVE' = 'ACTIVE',
    financialEligibility: 'PENDING_KYC' | 'ELIGIBLE' | 'RESTRICTED' = 'ELIGIBLE',
    withKycReuse = true,
  ) => ({
    customerId,
    reference: `ENR-${randomUUID().slice(0, 12).toUpperCase()}`,
    targetStatus,
    financialEligibility,
    statusReason: 'Enrolment requested under the institutional onboarding agreement',
    ...(withKycReuse
      ? {
          kycReuse: {
            evidenceReference: 'KYC-EVID-001',
            consentReference: 'CONSENT-001',
            policyReference: 'POLICY-KYC-REUSE-001',
          },
        }
      : {}),
  });

  async function requestEnrolment(token: string, institutionId: string, body: any) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/enrolments`)
      .set(auth(token))
      .send(body);
  }

  async function executeEnrolment(token: string, institutionId: string, body: any) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/enrolments/execute`)
      .set(auth(token))
      .send(body);
  }

  async function governedEnrolment(institutionId: string, body: any): Promise<Record<string, any>> {
    const { networkManager, controller } = await roles();
    const prepared = await requestEnrolment(networkManager.token, institutionId, body);
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);
    const executed = await executeEnrolment(controller.token, institutionId, {
      ...body,
      approvalId: prepared.body.approvalId,
    });
    expect(executed.status).toBe(201);
    return executed.body as Record<string, any>;
  }

  // -------------------------------------------------------------- attribution helpers

  const attributionBody = (walletId: string) => ({
    walletId,
    evidenceType: InstitutionAttributionEvidenceType.INSTITUTION_AGREEMENT,
    evidenceReference: `AGR-${randomUUID().slice(0, 10)}`,
    reason: 'Wallet attributed under the executed institution custody agreement',
  });

  async function requestAttribution(token: string, institutionId: string, body: any) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/wallet-attributions`)
      .set(auth(token))
      .send(body);
  }

  async function executeAttribution(token: string, institutionId: string, body: any) {
    return request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/wallet-attributions/execute`)
      .set(auth(token))
      .send(body);
  }

  async function governedAttribution(
    institutionId: string,
    walletId: string,
  ): Promise<Record<string, any>> {
    const { preparer, controller } = await roles();
    const body = attributionBody(walletId);
    const prepared = await requestAttribution(preparer.token, institutionId, body);
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);
    const executed = await executeAttribution(controller.token, institutionId, {
      ...body,
      approvalId: prepared.body.approvalId,
    });
    expect(executed.status).toBe(201);
    return executed.body as Record<string, any>;
  }

  /** A new customer identity with an ACTIVE, ELIGIBLE enrolment at the institution. */
  async function enrolledCustomer(institutionId: string): Promise<string> {
    const customer = await createCustomer();
    await governedEnrolment(institutionId, enrolmentBody(customer.id));
    return customer.id;
  }

  /** Institution + enrolment + attributed customer wallet, ready for isolation cases. */
  async function attributedWallet(): Promise<{
    institutionId: string;
    customerId: string;
    walletId: string;
    ledgerAccountId: string;
  }> {
    const { operator, preparer } = await roles();
    const institutionId = await approvedInstitution([operator.principalId, preparer.principalId]);
    const customer = await createCustomer();
    await governedEnrolment(institutionId, enrolmentBody(customer.id));
    const wallet = await createWallet(customer.id);
    await governedAttribution(institutionId, wallet.id);
    return {
      institutionId,
      customerId: customer.id,
      walletId: wallet.id,
      ledgerAccountId: wallet.ledgerAccountId,
    };
  }

  // ===================================================================== acceptance cases

  it('1 — one customer identity holds independent enrolments per institution', async () => {
    const { operator, networkManager } = await roles();
    const institutionA = await approvedInstitution([
      operator.principalId,
      networkManager.principalId,
    ]);
    const institutionB = await approvedInstitution([
      operator.principalId,
      networkManager.principalId,
    ]);
    const customer = await createCustomer();

    const enrolmentA = await governedEnrolment(
      institutionA,
      enrolmentBody(customer.id, 'ACTIVE', 'ELIGIBLE'),
    );
    const enrolmentB = await governedEnrolment(
      institutionB,
      enrolmentBody(customer.id, 'ACTIVE', 'PENDING_KYC', false),
    );

    expect(enrolmentA.customerId).toBe(customer.id);
    expect(enrolmentB.customerId).toBe(customer.id);
    expect(enrolmentA.id).not.toBe(enrolmentB.id);
    expect(enrolmentA.institutionId).toBe(institutionA);
    expect(enrolmentB.institutionId).toBe(institutionB);
    expect(enrolmentA.status).toBe('ACTIVE');
    expect(enrolmentA.financialEligibility).toBe('ELIGIBLE');
    // Eligibility is per institution — the second enrolment is ACTIVE but not eligible.
    expect(enrolmentB.financialEligibility).toBe('PENDING_KYC');

    // No duplicated customer identity: exactly one row, referenced by both enrolments.
    const [identity] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM customers WHERE id = $1`,
      [customer.id],
    );
    expect(Number(identity!.count)).toBe(1);
    const [total] = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM customers`,
    );
    expect(Number(total!.count)).toBe(1);

    const forA = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionA}/enrolments`)
      .set(auth(operator.token));
    expect(forA.status).toBe(200);
    expect(forA.body).toHaveLength(1);
    expect(forA.body[0].institutionId).toBe(institutionA);

    const crossEntity = await request(app.getHttpServer())
      .get(`${ENROLMENT_READS}/customers/${customer.id}`)
      .set(auth((await roles()).controller.token));
    expect(crossEntity.status).toBe(200);
    expect(crossEntity.body).toHaveLength(2);
    expect(new Set(crossEntity.body.map((row: any) => row.institutionId))).toEqual(
      new Set([institutionA, institutionB]),
    );
  });

  it('2 — enrolment records are confined to the institution that owns them', async () => {
    const { operator, networkManager, controller } = await roles();
    const institutionA = await approvedInstitution([
      operator.principalId,
      networkManager.principalId,
    ]);
    const institutionB = await approvedInstitution([operator.principalId], false);
    const customer = await createCustomer();
    await governedEnrolment(institutionA, enrolmentBody(customer.id));

    const own = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionA}/enrolments`)
      .set(auth(networkManager.token));
    expect(own.status).toBe(200);

    // Institution-scoped staff without the platform marker cannot reach another institution.
    const foreign = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionB}/enrolments`)
      .set(auth(networkManager.token));
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.body)).not.toContain(institutionB);

    const foreignPreparation = await requestEnrolment(
      networkManager.token,
      institutionB,
      enrolmentBody(customer.id),
    );
    expect(foreignPreparation.status).toBe(404);

    // The shared customer identity is not a side door: cross-entity enumeration needs the
    // explicit platform marker, which OPERATIONS/AGENT_NETWORK_MANAGER do not hold.
    const operatorCrossEntity = await request(app.getHttpServer())
      .get(`${ENROLMENT_READS}/customers/${customer.id}`)
      .set(auth(operator.token));
    expect(operatorCrossEntity.status).toBe(403);
    const auditorCrossEntity = await request(app.getHttpServer())
      .get(`${ENROLMENT_READS}/customers/${customer.id}`)
      .set(auth((await roles()).auditor.token));
    expect(auditorCrossEntity.status).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${ENROLMENT_READS}/wallets/${randomUUID()}`)
          .set(auth(controller.token))
      ).status,
    ).toBe(404);
  });

  it('3 — governed attribution binds a customer wallet to one institution with evidence', async () => {
    const { operator, preparer } = await roles();
    const institutionId = await approvedInstitution([operator.principalId, preparer.principalId]);
    const customer = await createCustomer();
    const enrolment = await governedEnrolment(institutionId, enrolmentBody(customer.id));
    expect(enrolment.financialEligibility).toBe('ELIGIBLE');
    const wallet = await createWallet(customer.id);
    const before = await walletRow(wallet.id);
    expect(before.owner_class).toBe('CUSTOMER');
    expect(before.institution_id).toBeNull();

    const body = attributionBody(wallet.id);
    const prepared = await requestAttribution(preparer.token, institutionId, body);
    expect(prepared.status).toBe(201);
    expect(prepared.body.actionFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await approve((await roles()).controller.token, prepared.body.approvalId)).status).toBe(
      201,
    );
    const executed = await executeAttribution((await roles()).controller.token, institutionId, {
      ...body,
      approvalId: prepared.body.approvalId,
    });
    expect(executed.status).toBe(201);
    expect(executed.body.institutionId).toBe(institutionId);
    expect(executed.body.walletId).toBe(wallet.id);
    expect(executed.body.ownerClass).toBe('CUSTOMER');
    expect(executed.body.evidenceType).toBe('INSTITUTION_AGREEMENT');
    expect(executed.body.evidenceReference).toBe(body.evidenceReference);

    // Wallet identity, balance and journal history are untouched; ownership class is preserved.
    const after = await walletRow(wallet.id);
    expect(after.id).toBe(wallet.id);
    expect(after.ledger_account_id).toBe(wallet.ledgerAccountId);
    expect(after.owner_class).toBe('CUSTOMER');
    expect(after.institution_id).toBe(institutionId);

    const account = await ledgerAccountRow(wallet.ledgerAccountId);
    expect(account.institutional_scope).toBe('INSTITUTION');
    expect(account.institution_id).toBe(institutionId);
    expect(account.institutional_purpose).toBe('CUSTOMER_FUNDS');
    expect(await balanceOf(wallet.ledgerAccountId)).toBe(0n);

    // The execution record is immutable.
    await expect(
      dataSource.query(
        `UPDATE governed_wallet_institution_attributions SET reason = 'rewritten' WHERE wallet_id = $1`,
        [wallet.id],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      dataSource.query(
        `DELETE FROM governed_wallet_institution_attributions WHERE wallet_id = $1`,
        [wallet.id],
      ),
    ).rejects.toThrow(/immutable/i);

    // Replay is idempotent: the same approval returns the same execution record.
    const replay = await executeAttribution((await roles()).controller.token, institutionId, {
      ...body,
      approvalId: prepared.body.approvalId,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.attributionId).toBe(executed.body.attributionId);
    expect((await counts()).receipts).toBe(1);
  });

  it('4 — unauthorized attribution is rejected on every boundary', async () => {
    const { operator, preparer, networkManager, auditor, controller } = await roles();
    const institutionId = await approvedInstitution([
      operator.principalId,
      preparer.principalId,
      networkManager.principalId,
    ]);
    const customer = await createCustomer();
    await governedEnrolment(institutionId, enrolmentBody(customer.id));
    const wallet = await createWallet(customer.id);
    const body = attributionBody(wallet.id);

    // Wrong role: the affiliation maker holds no attribution function.
    expect((await requestAttribution(networkManager.token, institutionId, body)).status).toBe(403);
    // Read-only principal.
    expect((await requestAttribution(auditor.token, institutionId, body)).status).toBe(403);
    // Preparing principal cannot approve its own request.
    const own = await requestAttribution(preparer.token, institutionId, body);
    expect(own.status).toBe(201);
    const selfApproval = await approve(preparer.token, own.body.approvalId);
    expect(selfApproval.status).toBeGreaterThanOrEqual(400);
    // Preparing principal cannot execute the checker step either.
    expect((await approve(controller.token, own.body.approvalId)).status).toBe(201);
    expect(
      (
        await executeAttribution(preparer.token, institutionId, {
          ...body,
          approvalId: own.body.approvalId,
        })
      ).status,
    ).toBe(403);

    // Without an ACTIVE, ELIGIBLE enrolment no attribution is possible at all.
    const stranger = await createCustomer();
    const strangerWallet = await createWallet(stranger.id);
    const strangerBody = attributionBody(strangerWallet.id);
    const preparedStranger = await requestAttribution(preparer.token, institutionId, strangerBody);
    expect(preparedStranger.status).toBe(409);
    expect(JSON.stringify(preparedStranger.body)).toMatch(/enrol/i);

    // Nothing was attributed by any rejected attempt.
    expect((await counts()).receipts).toBe(0);
    expect((await walletRow(wallet.id)).institution_id).toBeNull();
    expect((await walletRow(strangerWallet.id)).institution_id).toBeNull();
  });

  it('5 — approval consumption and attribution are atomic (rollback leaves no trace)', async () => {
    const { operator, preparer, controller } = await roles();
    const institutionId = await approvedInstitution([operator.principalId, preparer.principalId]);
    const customer = await createCustomer();
    await governedEnrolment(institutionId, enrolmentBody(customer.id));
    const wallet = await createWallet(customer.id);
    const body = attributionBody(wallet.id);
    const prepared = await requestAttribution(preparer.token, institutionId, body);
    expect(prepared.status).toBe(201);
    expect((await approve(controller.token, prepared.body.approvalId)).status).toBe(201);

    const baseline = await counts();
    await expect(
      attributionService.executeAttribution({
        ...body,
        institutionId,
        approvalId: prepared.body.approvalId,
        principal: controller.principal,
        _simulateFailureAfterAttribution: true,
      }),
    ).rejects.toThrow(/Simulated institutional attribution failure/);

    const [approval] = await dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM privileged_action_approvals WHERE id = $1`,
      [prepared.body.approvalId],
    );
    expect(approval!.status).toBe('APPROVED'); // consumption rolled back with the attribution
    const after = await counts();
    expect(after).toEqual(baseline);
    expect((await walletRow(wallet.id)).institution_id).toBeNull();
    expect((await ledgerAccountRow(wallet.ledgerAccountId)).institutional_scope).toBe(
      'UNATTRIBUTED',
    );

    // A subsequent genuine execution of the same approval still succeeds.
    const executed = await executeAttribution(controller.token, institutionId, {
      ...body,
      approvalId: prepared.body.approvalId,
    });
    expect(executed.status).toBe(201);
    expect((await walletRow(wallet.id)).institution_id).toBe(institutionId);
  });

  it('6 — concurrent attribution of the same wallet yields exactly one attribution', async () => {
    const { operator, preparer, controller } = await roles();
    const institutionId = await approvedInstitution([operator.principalId, preparer.principalId]);
    const customer = await createCustomer();
    await governedEnrolment(institutionId, enrolmentBody(customer.id));
    const wallet = await createWallet(customer.id);
    const body = attributionBody(wallet.id);

    const first = await requestAttribution(preparer.token, institutionId, body);
    const second = await requestAttribution(preparer.token, institutionId, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.approvalId).not.toBe(second.body.approvalId);
    for (const approvalId of [first.body.approvalId, second.body.approvalId]) {
      expect((await approve(controller.token, approvalId)).status).toBe(201);
    }

    const settled = await Promise.allSettled([
      executeAttribution(controller.token, institutionId, {
        ...body,
        approvalId: first.body.approvalId,
      }),
      executeAttribution(controller.token, institutionId, {
        ...body,
        approvalId: second.body.approvalId,
      }),
    ]);
    const statuses = settled
      .map((result) => (result.status === 'fulfilled' ? result.value.status : 'rejected'))
      .sort();
    expect(statuses).toEqual([201, 409]);

    const rows = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM governed_wallet_institution_attributions WHERE wallet_id = $1`,
      [wallet.id],
    );
    expect(rows).toHaveLength(1);
    expect((await walletRow(wallet.id)).institution_id).toBe(institutionId);
    // The losing approval is untouched rather than half-consumed.
    const [loser] = await dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM privileged_action_approvals WHERE id = $1`,
      [first.body.approvalId],
    );
    expect(['APPROVED', 'CONSUMED']).toContain(loser!.status);
  });

  it('7 — wallets with posted history keep every journal and persona intact', async () => {
    const { operator, preparer } = await roles();
    const institutionId = await approvedInstitution([operator.principalId, preparer.principalId]);
    const customer = await createCustomer();
    await governedEnrolment(institutionId, enrolmentBody(customer.id));
    const wallet = await createWallet(customer.id, true);
    const baseline = await counts();
    const baselineBalance = await balanceOf(wallet.ledgerAccountId);
    const [journalBefore] = await dataSource.query<Array<{ institution_id: string | null }>>(
      `SELECT institution_id FROM ledger_journals WHERE id = $1`,
      [wallet.journalId],
    );
    expect(journalBefore!.institution_id).toBeNull();

    const body = attributionBody(wallet.id);
    const prepared = await requestAttribution(preparer.token, institutionId, body);
    expect(prepared.status).toBe(409);
    expect(JSON.stringify(prepared.body)).toMatch(/posted financial history/i);

    // Nothing moved: journal, lines, balance and attribution state are byte-identical.
    const after = await counts();
    expect(after.lines).toBe(baseline.lines);
    expect(after.journals).toBe(baseline.journals);
    expect(after.receipts).toBe(0);
    expect(await balanceOf(wallet.ledgerAccountId)).toBe(baselineBalance);
    expect((await walletRow(wallet.id)).institution_id).toBeNull();
    expect((await ledgerAccountRow(wallet.ledgerAccountId)).institutional_scope).toBe(
      'UNATTRIBUTED',
    );
    const [journalAfter] = await dataSource.query<Array<{ institution_id: string | null }>>(
      `SELECT institution_id FROM ledger_journals WHERE id = $1`,
      [wallet.journalId],
    );
    expect(journalAfter!.institution_id).toBeNull();
  });

  it('8 — no wallet or account is ever defaulted or inferred into an institution', async () => {
    const { operator, controller } = await roles();
    const institutionId = await approvedInstitution([operator.principalId]);
    const customer = await createCustomer();
    await governedEnrolment(institutionId, enrolmentBody(customer.id));
    const wallet = await createWallet(customer.id);

    expect((await walletRow(wallet.id)).institution_id).toBeNull();
    expect((await ledgerAccountRow(wallet.ledgerAccountId)).institutional_scope).toBe(
      'UNATTRIBUTED',
    );
    const [nulls] = await dataSource.query<Array<{ institutions: string }>>(
      `SELECT count(*)::text AS institutions FROM wallet_accounts WHERE institution_id IS NOT NULL`,
    );
    expect(Number(nulls!.institutions)).toBe(0);

    // Reconciliation visibility: the unattributed account is reported, not guessed.
    const unattributed = await request(app.getHttpServer())
      .get(`${INSTITUTION_LEDGER}/unattributed`)
      .set(auth(controller.token));
    expect(unattributed.status).toBe(200);
    const listed = unattributed.body.find((row: any) => row.entityId === wallet.id);
    expect(listed).toBeDefined();
    expect(listed.entity).toBe('WALLET');
    expect(listed.ownerClass).toBe('CUSTOMER');
    expect(listed.ledgerAccountId).toBe(wallet.ledgerAccountId);

    const coverage = await request(app.getHttpServer())
      .get(`${INSTITUTION_LEDGER}/coverage`)
      .set(auth(controller.token));
    expect(coverage.status).toBe(200);
    const covered = coverage.body.find((row: any) => row.institutionId === institutionId);
    expect(covered.attributedWallets).toBe(0);
    expect(covered.activeEnrolments).toBe(1);
  });

  it('9 — an agent affiliation alone never transfers wallet or balance ownership', async () => {
    const { operator, preparer } = await roles();
    const institutionA = await approvedInstitution([operator.principalId, preparer.principalId]);
    const institutionB = await approvedInstitution([operator.principalId, preparer.principalId]);
    const agent = await createAgent();
    const wallet = await createWallet(agent.id);
    expect((await walletRow(wallet.id)).owner_class).toBe('AGENT');

    await agentAffiliation(agent.id, institutionA);
    // The affiliation is authoritative for scoping, but changes nothing about the wallet.
    expect((await walletRow(wallet.id)).institution_id).toBeNull();
    expect((await ledgerAccountRow(wallet.ledgerAccountId)).institutional_scope).toBe(
      'UNATTRIBUTED',
    );
    expect((await counts()).receipts).toBe(0);

    // Attribution must match the authoritative affiliation, not a convenient institution.
    const wrong = await requestAttribution(
      preparer.token,
      institutionB,
      attributionBody(wallet.id),
    );
    expect(wrong.status).toBe(409);
    expect(JSON.stringify(wrong.body)).toMatch(/affiliat/i);

    const executed = await governedAttribution(institutionA, wallet.id);
    expect(executed.institutionId).toBe(institutionA);
    expect((await walletRow(wallet.id)).owner_class).toBe('AGENT');
    expect((await balanceOf(wallet.ledgerAccountId)).toString()).toBe('0');
  });

  /** Open an institution settlement/suspense account through the governed route. */
  async function openInstitutionAccount(
    institutionId: string,
    purpose: 'SETTLEMENT' | 'SUSPENSE' | 'CLEARING',
  ): Promise<Record<string, any>> {
    const { operator } = await roles();
    const response = await request(app.getHttpServer())
      .post(`${INSTITUTIONS}/${institutionId}/ledger-accounts`)
      .set(auth(operator.token))
      .send({
        code: `INST-${purpose.slice(0, 3)}-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: `Institution ${purpose.toLowerCase()} account`,
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        currency: 'NGN',
        purpose,
        allowNegativeBalance: true,
      });
    expect(response.status).toBe(201);
    return response.body as Record<string, any>;
  }

  it('10 — same-institution internal posting succeeds with valid evidence', async () => {
    const { operator, controller } = await roles();
    const { institutionId, walletId } = await attributedWallet();
    expect((await walletRow(walletId)).institution_id).toBe(institutionId);

    const settlement = await openInstitutionAccount(institutionId, 'SETTLEMENT');
    expect(settlement.institutionalScope).toBe('INSTITUTION');
    expect(settlement.institutionId).toBe(institutionId);
    expect(settlement.institutionalPurpose).toBe('SETTLEMENT');
    const suspense = await openInstitutionAccount(institutionId, 'SUSPENSE');
    expect(suspense.institutionalPurpose).toBe('SUSPENSE');

    const journal = await ledger.postJournal({
      idempotencyKey: `a4p2-same-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'Intra-institution funding movement',
      lines: [
        { accountId: settlement.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '250000' },
        { accountId: suspense.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '250000' },
      ],
    });
    const [row] = await dataSource.query<Array<{ institution_id: string | null }>>(
      `SELECT institution_id FROM ledger_journals WHERE id = $1`,
      [journal.id],
    );
    expect(row!.institution_id).toBe(institutionId);
    // Signed balance convention: CREDIT positive, DEBIT negative.
    expect(await balanceOf(settlement.id)).toBe(-250000n);
    expect(await balanceOf(suspense.id)).toBe(250000n);

    const listed = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionId}/ledger-accounts`)
      .set(auth(controller.token));
    expect(listed.status).toBe(200);
    const listedIds = listed.body.map((account: any) => account.id);
    expect(listedIds).toEqual(expect.arrayContaining([settlement.id, suspense.id]));
    expect(listed.body.every((account: any) => account.institutionId === institutionId)).toBe(true);

    // A second institution's accounts cannot be opened under this institution's route.
    expect(
      (
        await request(app.getHttpServer())
          .post(`${INSTITUTIONS}/${institutionId}/ledger-accounts`)
          .set(auth(operator.token))
          .send({
            code: `SETTLE-${randomUUID().slice(0, 8).toUpperCase()}`,
            name: 'Invalid purpose account',
            accountType: 'ASSET',
            normalBalance: 'DEBIT',
            currency: 'NGN',
            purpose: 'CUSTOMER_FUNDS',
          })
      ).status,
    ).toBe(400);
  });

  it('11 — cross-institution internal posting is refused by the service and by the database', async () => {
    const { operator, preparer } = await roles();
    const institutionA = await approvedInstitution([operator.principalId, preparer.principalId]);
    const institutionB = await approvedInstitution([operator.principalId, preparer.principalId]);

    const customerA = await createCustomer();
    await governedEnrolment(institutionA, enrolmentBody(customerA.id));
    const walletA = await createWallet(customerA.id);
    await governedAttribution(institutionA, walletA.id);

    const customerB = await createCustomer();
    await governedEnrolment(institutionB, enrolmentBody(customerB.id));
    const walletB = await createWallet(customerB.id);
    await governedAttribution(institutionB, walletB.id);

    const settlementA = await openInstitutionAccount(institutionA, 'SETTLEMENT');
    const suspenseA = await openInstitutionAccount(institutionA, 'SUSPENSE');
    const settlementB = await openInstitutionAccount(institutionB, 'SETTLEMENT');

    const journalA = await ledger.postJournal({
      idempotencyKey: `a4p2-intra-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'Intra-institution funding movement',
      lines: [
        { accountId: settlementA.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '10000' },
        { accountId: suspenseA.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '10000' },
      ],
    });
    const [journalRow] = await dataSource.query<Array<{ institution_id: string | null }>>(
      `SELECT institution_id FROM ledger_journals WHERE id = $1`,
      [journalA.id],
    );
    expect(journalRow!.institution_id).toBe(institutionA);

    const baseline = await counts();
    await expect(
      ledger.postJournal({
        idempotencyKey: `a4p2-cross-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        description: 'Cross-institution internal transfer attempt',
        lines: [
          {
            accountId: settlementA.id,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '10000',
          },
          {
            accountId: settlementB.id,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '10000',
          },
        ],
      }),
    ).rejects.toThrow(/Cross-institution/i);
    const after = await counts();
    expect(after.journals).toBe(baseline.journals);
    expect(after.lines).toBe(baseline.lines);

    // The database refuses the same attempt even when the service is bypassed.
    await expect(
      dataSource.query(
        `INSERT INTO ledger_lines
           (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit)
         VALUES ($1,$2,$3,99,'DEBIT',10000,'NGN','CUSTOMER_FUNDS')`,
        [randomUUID(), journalA.id, settlementB.id],
      ),
    ).rejects.toThrow(/Cross-institution internal posting is not permitted/i);

    // And an unattributed account cannot join an institutional journal by raw SQL either.
    const strayAccount = await createLedgerAccount();
    await expect(
      dataSource.query(
        `INSERT INTO ledger_lines
           (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit)
         VALUES ($1,$2,$3,98,'CREDIT',5000,'NGN','CUSTOMER_FUNDS')`,
        [randomUUID(), journalA.id, strayAccount],
      ),
    ).rejects.toThrow(/cannot participate in an institutional journal/i);
    expect(walletA.id).not.toBe(walletB.id);
  });

  it('12 — unattributed accounts cannot bypass institutional isolation', async () => {
    const { institutionId, walletId, ledgerAccountId } = await attributedWallet();
    expect((await ledgerAccountRow(ledgerAccountId)).institutional_scope).toBe('INSTITUTION');
    const settlement = await openInstitutionAccount(institutionId, 'SETTLEMENT');
    const plainAccountId = await createLedgerAccount();

    // (a) A journal that mixes an institutional account with an unattributed one is refused.
    await expect(
      ledger.postJournal({
        idempotencyKey: `a4p2-mixed-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        description: 'Mixed institutional and unattributed posting attempt',
        lines: [
          { accountId: settlement.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '5000' },
          {
            accountId: plainAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '5000',
          },
        ],
      }),
    ).rejects.toThrow(/not attributed to the journal's institution/i);

    // (b) The database refuses an institutional account inside a non-institutional journal.
    const customer = await createCustomer();
    const fundedWallet = await createWallet(customer.id, true);
    await expect(
      dataSource.query(
        `INSERT INTO ledger_lines
           (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit)
         VALUES ($1,$2,$3,97,'DEBIT',5000,'NGN','CUSTOMER_FUNDS')`,
        [randomUUID(), fundedWallet.journalId, settlement.id],
      ),
    ).rejects.toThrow(/requires an institutional journal/i);

    // (c) Direct SQL cannot shortcut the governed path to mint an institutional account.
    await expect(
      dataSource.query(
        `UPDATE ledger_accounts SET institutional_scope='INSTITUTION', institution_id=$1 WHERE id=$2`,
        [institutionId, plainAccountId],
      ),
    ).rejects.toThrow(/governed wallet attribution record/i);

    // (d) A wallet ledger account with posted history cannot be silently attributed by SQL.
    await expect(
      dataSource.query(
        `UPDATE ledger_accounts SET institutional_scope='INSTITUTION', institution_id=$1 WHERE id=$2`,
        [institutionId, fundedWallet.ledgerAccountId],
      ),
    ).rejects.toThrow(/governed wallet attribution record/i);

    // (e) Direct SQL cannot set a wallet attribution without its execution record.
    const plainWallet = await createWallet(await enrolledCustomer(institutionId));
    await expect(
      dataSource.query(`UPDATE wallet_accounts SET institution_id=$1 WHERE id=$2`, [
        institutionId,
        plainWallet.id,
      ]),
    ).rejects.toThrow(/cannot be cleared or partially set/i);

    // (f) The attributed wallet itself was never touched by any rejected attempt.
    expect((await walletRow(walletId)).institution_id).toBe(institutionId);
  });

  it('13 — institution suspension blocks new institutional authorization', async () => {
    const { controller } = await roles();
    const { institutionId, walletId, customerId } = await attributedWallet();
    const secondWallet = await createWallet(await enrolledCustomer(institutionId));

    const before = await request(app.getHttpServer())
      .post(`${FINANCIAL_CONTEXT}/validate`)
      .set(auth(controller.token))
      .send({ institutionId, walletIds: [walletId] });
    expect(before.status).toBe(200);
    expect(before.body.outcome).toBe('RESOLVED');
    expect(before.body.institutionId).toBe(institutionId);

    await suspendInstitution(institutionId);

    const after = await request(app.getHttpServer())
      .post(`${FINANCIAL_CONTEXT}/validate`)
      .set(auth(controller.token))
      .send({ institutionId, walletIds: [walletId], customerId });
    expect(after.status).toBe(200);
    expect(after.body.outcome).toBe('INSTITUTION_INACTIVE');
    expect(after.body.reasons).toEqual(
      expect.arrayContaining(['INSTITUTION_NOT_APPROVED', 'INSTITUTION_SUSPENDED']),
    );
    expect(after.body.institutionStatus).toBe('SUSPENDED');

    // New attribution is refused; the existing one is immutable and still reported.
    const prepared = await requestAttribution(
      (await roles()).preparer.token,
      institutionId,
      attributionBody(secondWallet.id),
    );
    expect(prepared.status).toBe(409);
    expect((await walletRow(walletId)).institution_id).toBe(institutionId);
    const listed = await request(app.getHttpServer())
      .get(`${INSTITUTIONS}/${institutionId}/wallet-attributions`)
      .set(auth(controller.token));
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
  });

  it('14 — existing governed wallet ownership protections remain intact', async () => {
    const { institutionId, walletId, customerId } = await attributedWallet();
    const otherCustomer = await createCustomer();

    // Direct SQL cannot re-point a wallet at another owner.
    await expect(
      dataSource.query(`UPDATE wallet_accounts SET customer_id=$1 WHERE id=$2`, [
        otherCustomer.id,
        walletId,
      ]),
    ).rejects.toThrow(/immutable|governed/i);

    // The owner class stays system-assigned: a REVIEW wallet (unknown reference) can never be
    // institutionally attributed.
    const unknownWallet = await createWallet(`unknown-${randomUUID()}`);
    expect((await walletRow(unknownWallet.id)).owner_class).toBe('REVIEW');
    const prepared = await requestAttribution(
      (await roles()).preparer.token,
      institutionId,
      attributionBody(unknownWallet.id),
    );
    expect(prepared.status).toBe(409);
    expect(JSON.stringify(prepared.body)).toMatch(/REVIEW/);

    // The attribution is already set, so a second governed attempt is refused (no silent move).
    const again = await requestAttribution(
      (await roles()).preparer.token,
      institutionId,
      attributionBody(walletId),
    );
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(/already carries/i);
    expect((await walletRow(walletId)).institution_id).toBe(institutionId);
    expect(customerId).toBeTruthy();
  });

  it('15 — the published resolver revalidates and serialises institutional change', async () => {
    const { institutionId, walletId, customerId, ledgerAccountId } = await attributedWallet();
    const agent = await createAgent();
    await agentAffiliation(agent.id, institutionId);

    const consistent = await dataSource.transaction((manager) =>
      contextResolver.resolve(manager, {
        institutionId,
        customerId,
        walletIds: [walletId],
        agentId: agent.id,
        ledgerAccountIds: [ledgerAccountId],
      }),
    );
    expect(consistent.outcome).toBe('RESOLVED');
    expect(consistent.reasons).toEqual([]);
    expect(consistent.customerEnrolment?.status).toBe('ACTIVE');
    expect(consistent.agentAffiliation?.outcome).toBe('RESOLVED');
    expect(consistent.parties.map((party) => party.kind).sort()).toEqual([
      'LEDGER_ACCOUNT',
      'WALLET',
    ]);
    expect(consistent.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    // Deterministic over the resolved evidence.
    const repeat = await dataSource.transaction((manager) =>
      contextResolver.resolve(manager, { institutionId, walletIds: [walletId] }),
    );
    expect(repeat.evidenceFingerprint).toBe(
      (
        await dataSource.transaction((manager) =>
          contextResolver.resolve(manager, { institutionId, walletIds: [walletId] }),
        )
      ).evidenceFingerprint,
    );

    // Wrong institution and unattributed parties are reported, never silently accepted.
    const wrongInstitution = await dataSource.transaction((manager) =>
      contextResolver.resolve(manager, {
        institutionId: randomUUID(),
        walletIds: [walletId],
      }),
    );
    expect(wrongInstitution.outcome).toBe('INCOMPATIBLE');
    expect(wrongInstitution.reasons).toContain('CROSS_INSTITUTION');
    const unattributedWallet = await createWallet((await createCustomer()).id);
    const unattributed = await dataSource.transaction((manager) =>
      contextResolver.resolve(manager, { walletIds: [unattributedWallet.id] }),
    );
    expect(unattributed.outcome).toBe('UNRESOLVED');
    expect(unattributed.reasons).toEqual(
      expect.arrayContaining(['UNATTRIBUTED_WALLET', 'NO_INSTITUTION_CONTEXT']),
    );

    // Transaction participation: a resolver-held SHARE lock blocks an attribution change until
    // the caller's transaction ends, so an institutional change cannot race execution.
    const secondWallet = await createWallet(await enrolledCustomer(institutionId));
    const { preparer, controller } = await roles();
    const secondBody = attributionBody(secondWallet.id);
    const approval = await requestAttribution(preparer.token, institutionId, secondBody);
    expect(approval.status).toBe(201);
    expect((await approve(controller.token, approval.body.approvalId)).status).toBe(201);

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let settled = false;
    try {
      const locked = await contextResolver.resolve(runner.manager, {
        institutionId,
        customerId,
        walletIds: [secondWallet.id],
        lock: 'SHARE',
      });
      // The wallet is still unattributed, so the locked read is honestly incompatible — the point
      // is that it read the wallet inside this transaction and holds the row lock until commit.
      expect(locked.outcome).toBe('INCOMPATIBLE');
      expect(locked.reasons).toEqual(expect.arrayContaining(['UNATTRIBUTED_WALLET']));

      const pending = attributionService
        .executeAttribution({
          ...secondBody,
          institutionId,
          approvalId: approval.body.approvalId,
          principal: controller.principal,
        })
        .then((value) => {
          settled = true;
          return value;
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false);
      await runner.commitTransaction();
      const executed = await pending;
      expect(executed.walletId).toBe(secondWallet.id);
      expect(executed.institutionId).toBe(institutionId);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('16 — the complete migration chain is applied, including Phase 2', async () => {
    const applied = await dataSource.query<Array<{ name: string }>>(
      `SELECT name FROM typeorm_migrations ORDER BY timestamp ASC`,
    );
    const names = applied.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'CreateInstitutionFoundation1785753600400',
        'CreateInstitutionalFinancialOwnership1785753600401',
      ]),
    );
    // Phase 2 added exactly one migration in the Arena 4 range 0400–0499.
    const arena4 = applied.filter((row) => /CreateInstitution\w*\d{13}/.test(row.name));
    expect(arena4.length).toBeGreaterThanOrEqual(2);

    const objects = await dataSource.query<Array<{ name: string; kind: string }>>(
      `SELECT 'governed_wallet_institution_attributions' AS name, 'table' AS kind
       UNION ALL SELECT 'customer_institution_enrolments', 'table'
       UNION ALL SELECT 'unattributed_financial_accounts', 'view'
       UNION ALL SELECT 'institution_financial_coverage', 'view'`,
    );
    for (const object of objects) {
      const [present] = await dataSource.query<Array<{ found: boolean }>>(
        `SELECT to_regclass($1) IS NOT NULL AS found`,
        [`public.${object.name}`],
      );
      expect(`${object.name}:${present!.found}`).toBe(`${object.name}:true`);
    }

    const columns = await dataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ledger_accounts'
          AND column_name IN ('institutional_scope','institution_id','institutional_purpose')`,
    );
    expect(columns.map((column) => column.column_name).sort()).toEqual([
      'institution_id',
      'institutional_purpose',
      'institutional_scope',
    ]);
  });
});
