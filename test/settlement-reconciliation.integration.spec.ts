/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports */
import { createServer, request as httpRequest, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Browser } from 'playwright';
import * as request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentStatus } from '../src/agent/agent.enums';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { FinanceOperationsService } from '../src/finance-operations/finance-operations.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { SettlementReconciliationService } from '../src/settlement-reconciliation/settlement-reconciliation.service';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

import * as seed from './support/settlement-synthetic-roles';
const kyc = createTestEvidenceReader({ mode: 'ELIGIBLE' });

const BASE = '/api/v1/internal/finance-operations/settlement-reconciliation';

function hashPassword(secret: string): string {
  const salt = randomBytes(16);
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(secret, salt, 10000, 32, 'sha256').toString('base64url')}`;
}

describe('Settlement Report & Statement Reconciliation (Real PostgreSQL + 11-Role + E2E)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fixture: GovernedFinancialFixture;
  let institutionId: string;
  let foreignInstitutionId: string;
  let browser: Browser | undefined;
  let proxyServer: Server | undefined;
  const oldEnv = { ...process.env };

  const sessions: Record<
    string,
    {
      accessToken: string;
      sessionId: string;
      principal: { principalId: string; roles: string[]; scopes: string[] };
    }
  > = {};

  let inboundCleanId: string;
  let cleanJournalId: string;
  let inboundFeeMismatchId: string;
  let inboundMissingProviderId: string;
  let inboundAmbiguousAId: string;
  let inboundAmbiguousBId: string;
  let inboundLateId: string;
  let outboundOpId: string;
  let customChecker: { principalId: string; accessToken: string };
  let customPrincipalForTest: AuthorizationPrincipal;
  let noChecker: { principalId: string; accessToken: string };
  let secondMaker: { principalId: string; accessToken: string };
  let secondMakerSecondSession: { principalId: string; accessToken: string };
  let uploaderSecondSession: { principalId: string; accessToken: string; sessionId: string };
  let postedJournalCountBefore: number;
  let postedLinesCountBefore: number;
  let baselineAccountIds: string[];
  let financialSnapshotBefore: unknown;
  async function financialSnapshot() {
    const accounts = await dataSource.query(
      `SELECT a.id::text AS id, a.normal_balance,
          COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS balance
         FROM ledger_accounts a LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id
        WHERE a.id = ANY($1::uuid[]) GROUP BY a.id ORDER BY a.id`,
      [baselineAccountIds],
    );
    const journals = await dataSource.query(
      `SELECT to_jsonb(j) AS value FROM ledger_journals j ORDER BY j.id`,
    );
    const lines = await dataSource.query(
      `SELECT to_jsonb(l) AS value FROM ledger_lines l ORDER BY l.id`,
    );
    const wallets = await dataSource.query(
      `SELECT to_jsonb(w) AS value FROM wallet_accounts w ORDER BY w.id`,
    );
    return { accounts, journals, lines, wallets };
  }

  const nipSessionId = '000013261126113000000009876543';

  beforeAll(async () => {
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';

    dataSource = await createIntegrationDataSourceFromScratch('srrecon01');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kyc.reader)
      .compile();

    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    await seed.seedLocalRoles(dataSource, app.get('A2_WORKFORCE_CONFIG'));
    for (const role of seed.ROLES) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/internal/a2/workforce/local-admin-sessions')
        .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
        .expect(201);
      sessions[role] = res.body;
    }

    fixture = new GovernedFinancialFixture({ app, dataSource, label: 'srRecon' });
    institutionId = (await fixture.createInstitution()).id;
    foreignInstitutionId = (await fixture.createInstitution()).id;

    // Grant active institution scope to FINANCE_PREPARER for institutionId only (not foreignInstitutionId).
    await fixture.grantWorkforceScope(
      institutionId,
      sessions.FINANCE_PREPARER!.principal.principalId,
    );

    // Create configurable checker and negative-control roles through the real, independently
    // approved role-definition workflow; no canonical workforce account is altered.
    const roleApi = '/api/v1/internal/a2/workforce/role-definitions/proposals';
    for (const [roleKey, grants] of [
      [
        'SR_TEST_CHECKER',
        [
          { functionCode: 'ledger.view', accessType: 'VIEW' },
          { functionCode: 'reconciliation.settlement_report.review', accessType: 'APPROVE' },
        ],
      ],
      ['SR_TEST_LEDGER_ONLY', [{ functionCode: 'ledger.view', accessType: 'VIEW' }]],
    ] as const) {
      const created = await request(app.getHttpServer())
        .post(roleApi)
        .set('Authorization', `Bearer ${sessions.SUPER_ADMIN!.accessToken}`)
        .send({
          proposalType: 'CREATE',
          roleKey,
          displayName: roleKey,
          description: 'Disposable settlement review test role',
          readOnly: false,
          functionGrants: grants,
          reason: 'Verify independent reconciliation checker',
        })
        .expect(201);
      const proposalId = created.body.proposal.id as string;
      await request(app.getHttpServer())
        .post(`${roleApi}/${proposalId}/approve`)
        .set('Authorization', `Bearer ${sessions.FINANCE_CONTROLLER!.accessToken}`)
        .send({ comment: 'Independent approval for synthetic test' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${roleApi}/${proposalId}/apply`)
        .set('Authorization', `Bearer ${sessions.SUPER_ADMIN!.accessToken}`)
        .send({})
        .expect(201);
    }
    async function assignRole(principalId: string, roleKey: string) {
      const now = new Date();
      await dataSource.getRepository(A2FinanceRoleAssignment).save({
        id: randomUUID(),
        assignmentReference: `sr-checker-${randomUUID()}`,
        assignmentVersion: 1,
        principalId,
        roleKey,
        scopes: [],
        status: 'ACTIVE',
        initiatedScope: 'SUPER_ADMIN_SCOPE',
        interim: true,
        effectiveFrom: new Date(now.getTime() - 60_000),
        effectiveTo: new Date(now.getTime() + 86400_000),
        assignedBy: 'synthetic-fixture',
        assignedAt: now,
        revokedBy: null,
        revokedAt: null,
        bootstrapReference: null,
        approvalIds: [],
        auditReferences: [],
      });
    }
    async function establish(principalId: string) {
      const now = new Date();
      return app.get(A2WorkforceSessionService).establish({
        issuer: 'https://test-identity.example.invalid',
        subject: principalId,
        principalId,
        audience: ['workforce-admin'],
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
        authenticatedAt: now.toISOString(),
        assuranceLevel: 'MFA',
        amr: ['pwd', 'otp'],
        acr: null,
        signingKeyId: 'synthetic-test-key',
      });
    }
    const customPrincipal = `sr-checker:${randomUUID()}`;
    const noCheckerPrincipal = `sr-viewer:${randomUUID()}`;
    const secondMakerPrincipal = `sr-maker:${randomUUID()}`;
    await assignRole(customPrincipal, 'SR_TEST_CHECKER');
    await assignRole(noCheckerPrincipal, 'SR_TEST_LEDGER_ONLY');
    await assignRole(secondMakerPrincipal, 'FINANCE_PREPARER');
    await assignRole(secondMakerPrincipal, 'SR_TEST_CHECKER');
    const uploaderId = sessions.FINANCE_PREPARER!.principal.principalId;
    await assignRole(uploaderId, 'SR_TEST_CHECKER');
    for (const p of [customPrincipal, noCheckerPrincipal, secondMakerPrincipal]) {
      await fixture.grantWorkforceScope(institutionId, p);
    }
    const customSession = await establish(customPrincipal);
    customPrincipalForTest = customSession.principal;
    customChecker = { principalId: customPrincipal, ...customSession };
    noChecker = { principalId: noCheckerPrincipal, ...(await establish(noCheckerPrincipal)) };
    secondMaker = { principalId: secondMakerPrincipal, ...(await establish(secondMakerPrincipal)) };
    secondMakerSecondSession = {
      principalId: secondMakerPrincipal,
      ...(await establish(secondMakerPrincipal)),
    };
    uploaderSecondSession = { principalId: uploaderId, ...(await establish(uploaderId)) };
    expect(uploaderSecondSession.sessionId).not.toBe(sessions.FINANCE_PREPARER!.sessionId);
    expect((await establish(customPrincipal)).principal.scopes).toContain(
      'reconciliation.settlement_report.review',
    );

    // Seed internal banking_inbound_payments & banking_outbound_operations evidence on institutionId.
    inboundCleanId = randomUUID();
    inboundFeeMismatchId = randomUUID();
    inboundMissingProviderId = randomUUID();
    inboundAmbiguousAId = randomUUID();
    inboundAmbiguousBId = randomUUID();
    inboundLateId = randomUUID();
    outboundOpId = randomUUID();

    // Provision a customer wallet and post a balanced ledger journal on inboundCleanId:
    //   Gross paid: 1,000,000 (₦10,000.00)
    //   Monnify provider fee: 15,000 (₦150.00) -> Merchant settlement: 985,000 (₦9,850.00)
    //   MonieNaija platform charge: 5,000 (₦50.00) -> Customer wallet credit: 980,000 (₦9,800.00)
    const [custRow] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO customers(reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
      [`sr-cust-${randomUUID()}`],
    );
    await fixture.makeCustomerEligible(custRow.id, kyc);
    const wallet = await fixture.prepareUnattributedWallet(custRow.id);
    const walletLedgerAccountId = wallet.ledgerAccountId;
    const [{ id: settlementAssetId }] = await dataSource.query<[{ id: string }]>(
      `SELECT id FROM ledger_accounts WHERE code = 'PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
    const [{ id: clearingAccountId }] = await dataSource.query<[{ id: string }]>(
      `SELECT id FROM ledger_accounts WHERE code = 'PAYMENT-SYSTEM_SUSPENSE-NGN' LIMIT 1`,
    );
    const cleanJournal = await app.get(LedgerService).postJournal({
      idempotencyKey: `sr-clean-deposit-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      description: 'Customer bank-to-wallet deposit with separate platform charge',
      lines: [
        {
          accountId: settlementAssetId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: '985000',
        },
        {
          accountId: walletLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '980000',
        },
        {
          accountId: clearingAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '5000',
        },
      ],
    });
    cleanJournalId = cleanJournal.id;

    // 1. Clean inbound payment linked to cleanJournalId
    const [{ has_direct_credit: hasDirectCredit }] = await dataSource.query<
      [{ has_direct_credit: boolean }]
    >(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'banking_inbound_payments' AND column_name = 'credit_journal_id') AS has_direct_credit`,
    );
    const directColumns = hasDirectCredit
      ? 'credit_journal_id, settlement_amount_minor, monienaija_fee_minor, customer_credit_minor, resolution_state'
      : 'ledger_transaction_id';
    const directValues = hasDirectCredit ? "$3::uuid,985000,5000,980000,'CREDITED'" : '$3::uuid';
    await dataSource.query(
      `INSERT INTO banking_inbound_payments (
         id, institution_id, provider_key, environment,
         provider_transaction_reference, provider_payment_reference,
         receiving_account_number, receiving_bank_code, currency,
         gross_amount_minor, provider_fee_minor, credited_amount_minor,
         paid_at, verification_state, ${directColumns}
       ) VALUES ($1,$2,'MONNIFY','sandbox','MNFY|SR|CLEAN|001','MNJ-PAY-CLEAN-001','8011223344','50515','NGN',1000000,15000,985000,'2026-11-26T09:10:00.000Z','VERIFIED',${directValues})`,
      [inboundCleanId, institutionId, cleanJournalId],
    );

    // 2. Fee-mismatch inbound payment: internal recorded 10,000 fee vs provider deducting 20,000 fee
    await dataSource.query(
      `INSERT INTO banking_inbound_payments (
         id, institution_id, provider_key, environment,
         provider_transaction_reference, provider_payment_reference,
         receiving_account_number, receiving_bank_code, currency,
         gross_amount_minor, provider_fee_minor, credited_amount_minor,
         paid_at, verification_state
       ) VALUES ($1,$2,'MONNIFY','sandbox','MNFY|SR|FEEMIS|002','MNJ-PAY-FEEMIS-002','8011223344','50515','NGN',500000,10000,490000,'2026-11-26T09:20:00.000Z','VERIFIED')`,
      [inboundFeeMismatchId, institutionId],
    );

    // 3. Internal verified inbound inside window with NO matching row in the provider report -> MISSING_IN_PROVIDER
    await dataSource.query(
      `INSERT INTO banking_inbound_payments (
         id, institution_id, provider_key, environment,
         provider_transaction_reference, provider_payment_reference,
         receiving_account_number, receiving_bank_code, currency,
         gross_amount_minor, provider_fee_minor, credited_amount_minor,
         paid_at, verification_state
       ) VALUES ($1,$2,'MONNIFY','sandbox','MNFY|SR|ONLYINT|003','MNJ-PAY-ONLYINT-003','8011223344','50515','NGN',300000,4500,295500,'2026-11-26T09:30:00.000Z','VERIFIED')`,
      [inboundMissingProviderId, institutionId],
    );

    // 4. Two internal inbound rows sharing the same payment reference for AMBIGUOUS_CANDIDATES when provider ref differs
    await dataSource.query(
      `INSERT INTO banking_inbound_payments (
         id, institution_id, provider_key, environment,
         provider_transaction_reference, provider_payment_reference,
         receiving_account_number, receiving_bank_code, currency,
         gross_amount_minor, provider_fee_minor, credited_amount_minor,
         paid_at, verification_state
       ) VALUES
       ($1,$3,'MONNIFY','sandbox','MNFY|SR|AMB_INT_A','MNJ-PAY-SHARED-AMB','8011223344','50515','NGN',200000,3000,197000,'2026-11-26T09:40:00.000Z','VERIFIED'),
       ($2,$3,'MONNIFY','sandbox','MNFY|SR|AMB_INT_B','MNJ-PAY-SHARED-AMB','8011223344','50515','NGN',200000,3000,197000,'2026-11-26T09:41:00.000Z','VERIFIED')`,
      [inboundAmbiguousAId, inboundAmbiguousBId, institutionId],
    );

    // 5. Late-matched inbound payment: internal paid_at 48h earlier than provider's paidOn (>24h cutoff) -> DATE_WINDOW_MISMATCH
    await dataSource.query(
      `INSERT INTO banking_inbound_payments (
         id, institution_id, provider_key, environment,
         provider_transaction_reference, provider_payment_reference,
         receiving_account_number, receiving_bank_code, currency,
         gross_amount_minor, provider_fee_minor, credited_amount_minor,
         paid_at, verification_state
       ) VALUES ($1,$2,'MONNIFY','sandbox','MNFY|SR|LATE|005','MNJ-PAY-LATE-005','8011223344','50515','NGN',400000,6000,394000,'2026-11-24T08:00:00.000Z','VERIFIED')`,
      [inboundLateId, institutionId],
    );

    // 5. Outbound transfer operation matched via provider reference & 30-digit NIP sessionId
    const extOpId = randomUUID();
    await dataSource.query(
      `INSERT INTO banking_outbound_operations (
         id, institution_id, provider_key, environment,
         operation_reference, external_operation_id, currency, amount_minor,
         destination_bank_code, destination_account_number, destination_account_name,
         state, provider_status, provider_transaction_reference,
         submitted_at, resolved_at
       ) VALUES ($1,$2,'MONNIFY','sandbox','MNJ_OUT_SR_701',$3,'NGN',400000,'044','0099887766','Kano Beneficiary','SUCCESSFUL','SUCCESS','MFDS|SR|OUT|701','2026-11-26T10:00:00.000Z','2026-11-26T10:01:00.000Z')`,
      [outboundOpId, institutionId, extOpId],
    );

    const [{ c: jc }] = await dataSource.query<[{ c: string }]>(
      'SELECT COUNT(*)::text AS c FROM ledger_journals',
    );
    const [{ c: lc }] = await dataSource.query<[{ c: string }]>(
      'SELECT COUNT(*)::text AS c FROM ledger_lines',
    );
    postedJournalCountBefore = Number(jc);
    postedLinesCountBefore = Number(lc);
    baselineAccountIds = (
      await dataSource.query<Array<{ id: string }>>(
        'SELECT id::text FROM ledger_accounts ORDER BY id',
      )
    ).map((r) => r.id);
    financialSnapshotBefore = await financialSnapshot();
  }, 180000);

  afterAll(async () => {
    await browser?.close();
    if (proxyServer) {
      await new Promise<void>((res) => proxyServer!.close(() => res()));
    }
    await app?.close();
    if (dataSource?.isInitialized) {
      await destroyIntegrationDataSource(dataSource);
    }
    process.env = oldEnv;
  }, 60000);

  it('enforces the 11-role workforce matrix, blocks Customer/Agent/Aggregator/unauthenticated/non-MFA callers, and returns 404 for unassigned institutions', async () => {
    // Unauthenticated -> 401
    await request(app.getHttpServer()).get(`${BASE}/overview`).expect(401);

    // 7 non-ledger.view workforce roles -> 403 Forbidden
    const deniedRoles = [
      'ADMINISTRATOR',
      'OPERATIONS',
      'AGENT_NETWORK_MANAGER',
      'COMPLIANCE',
      'RISK_FRAUD',
      'CUSTOMER_SERVICE',
      'TREASURY',
    ];
    for (const role of deniedRoles) {
      await request(app.getHttpServer())
        .get(`${BASE}/overview`)
        .set('Authorization', `Bearer ${sessions[role]!.accessToken}`)
        .expect(403);
    }

    // 4 ledger.view workforce roles -> 200 OK on overview
    for (const role of [
      'SUPER_ADMIN',
      'FINANCE_PREPARER',
      'FINANCE_CONTROLLER',
      'FINANCE_AUDITOR',
    ]) {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/overview?institutionId=${institutionId}`)
        .set('Authorization', `Bearer ${sessions[role]!.accessToken}`)
        .expect(200);
      expect(res.body.capabilities.mfaVerified).toBe(true);
    }

    // Read-only ledger.view roles (SUPER_ADMIN, FINANCE_AUDITOR) and Checker (FINANCE_CONTROLLER) cannot import reports -> 403
    for (const role of ['SUPER_ADMIN', 'FINANCE_AUDITOR', 'FINANCE_CONTROLLER']) {
      await request(app.getHttpServer())
        .post(`${BASE}/imports`)
        .set('Authorization', `Bearer ${sessions[role]!.accessToken}`)
        .send({
          institutionId,
          providerKey: 'MONNIFY',
          reportType: 'COLLECTIONS',
          fileName: 'denied.json',
          content: '[]',
        })
        .expect(403);
    }

    // Non-MFA workforce sessions are refused BOTH at A2 session establishment AND inside SettlementReconciliationService (defense in depth)
    const sessionSvc = app.get(A2WorkforceSessionService);
    const now = new Date();
    await expect(
      sessionSvc.establish({
        issuer: 'https://identity.issuer.invalid',
        subject: 'non-mfa-preparer',
        principalId: sessions.FINANCE_PREPARER!.principal.principalId,
        audience: ['workforce-admin'],
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
        authenticatedAt: now.toISOString(),
        assuranceLevel: 'PASSWORD',
        amr: ['pwd'],
        acr: 'password',
        signingKeyId: 'test-standard',
      }),
    ).rejects.toThrow(/MFA/i);

    await expect(
      app.get(SettlementReconciliationService).importReport(
        {
          ...sessions.FINANCE_PREPARER!.principal,
          type: 'OPERATOR',
          assuranceLevel: 'PASSWORD',
          customerAccess: 'NONE',
        } as never,
        {
          institutionId,
          providerKey: 'MONNIFY',
          reportType: 'COLLECTIONS',
          fileName: 'no-mfa.json',
          content: '[]',
        },
      ),
    ).rejects.toThrow(ForbiddenException);

    // Institution-scoped FINANCE_PREPARER querying unassigned foreignInstitutionId -> 404 NotFound (anti-probe)
    await request(app.getHttpServer())
      .get(`${BASE}/overview?institutionId=${foreignInstitutionId}`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .expect(404);

    // Real Agent bearer token -> 403 Forbidden ('Agent not allowed on workforce route')
    const agentCls = await app.get(AgentClassService).create({
      reference: `cls-sr-${randomUUID().slice(0, 6)}`,
      code: `SR-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'SR Agent Class',
      isActive: true,
      applicableServices: [AgentService.CASH_IN],
      actor: 'fixture',
    });
    const agentApp = await app.get(AgentApplicationService).create({
      agentClassId: agentCls.id,
      applicantReference: `sr-ag-${randomUUID()}`,
      businessName: 'SR Agent Biz',
      contactEmail: `sr-agent-${randomUUID().slice(0, 6)}@test.local`,
      actor: 'fixture',
    });
    await app.get(AgentApplicationService).submit(agentApp.id, 'fixture');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [agentApp.id],
    );
    const activeAgent = await app
      .get(AgentLifecycleService)
      .activateFromApplication(agentApp.id, 'fixture');
    expect(activeAgent.status).toBe(AgentStatus.ACTIVE);
    const [agentCred] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO agent_authentication_credentials (agent_id, status, password_hash, hash_algorithm, password_version, password_changed_at)
       VALUES ($1,'ACTIVE',$2,'PBKDF2',1,clock_timestamp()) RETURNING id`,
      [activeAgent.id, hashPassword('AgentPassword_123!')],
    );
    const rawAgentBearer = randomBytes(32).toString('base64url');
    const agentTokenHash = createHash('sha256').update(rawAgentBearer, 'utf8').digest('hex');
    await dataSource.query(
      `INSERT INTO agent_authentication_sessions (agent_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at)
       VALUES ($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
      [activeAgent.id, agentCred.id, agentTokenHash],
    );
    const agentDenied = await request(app.getHttpServer())
      .get(`${BASE}/overview`)
      .set('Authorization', `Bearer ${rawAgentBearer}`)
      .expect(403);
    expect(String(agentDenied.body?.message ?? '')).toMatch(/Agent not allowed/i);

    // Customer, Agent & Aggregator principals evaluated directly against AuthorizationService -> ForbiddenException
    const authService = app.get(AuthorizationService);
    for (const nonWorkforcePrincipal of [
      {
        type: 'CUSTOMER',
        principalId: randomUUID(),
        customerId: randomUUID(),
        roles: [],
        scopes: ['ledger.view'],
        customerAccess: 'SELF',
      },
      {
        type: 'AGENT',
        principalId: activeAgent.id,
        agentId: activeAgent.id,
        roles: [],
        scopes: ['ledger.view'],
        customerAccess: 'NONE',
        agentAccess: 'SELF',
      },
      {
        type: 'AGGREGATOR',
        principalId: randomUUID(),
        roles: [],
        scopes: ['ledger.view'],
        customerAccess: 'NONE',
        aggregatorAccess: 'SELF',
      },
    ]) {
      const decision = await authService.authorize(
        nonWorkforcePrincipal as never,
        {
          action: 'FINANCE_SETTLEMENT_RECONCILIATION_OVERVIEW',
          resourceType: 'settlement-reconciliation',
          allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
          requiredFunctions: ['ledger.view'],
          customerAccess: 'NONE',
          agentAccess: 'NONE',
          aggregatorAccess: 'NONE',
        },
        { type: 'settlement-reconciliation' },
      );
      expect(decision.allowed).toBe(false);
      expect(['PRINCIPAL_TYPE_DENIED', 'INVALID_PRINCIPAL']).toContain(decision.reason);
      await expect(
        app
          .get(SettlementReconciliationService)
          .getWorkspaceOverview(nonWorkforcePrincipal as never, {}),
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('executes Workflow 1 & 2: previews, imports idempotently, masks bank accounts, classifies all match outcomes, and enforces Maker-Checker SoD', async () => {
    const collectionsJson = JSON.stringify({
      requestSuccessful: true,
      responseBody: {
        content: [
          {
            transactionReference: 'MNFY|SR|CLEAN|001',
            paymentReference: 'MNJ-PAY-CLEAN-001',
            amountPaid: 10000.0,
            fee: 150.0,
            settlementAmount: 9850.0,
            currency: 'NGN',
            paymentStatus: 'PAID',
            paidOn: '2026-11-26T09:10:05.000Z',
            accountDetails: { accountNumber: '0123456789', bankCode: '058' },
            destinationAccountInformation: { accountNumber: '8011223344', bankCode: '50515' },
          },
          {
            transactionReference: 'MNFY|SR|FEEMIS|002',
            paymentReference: 'MNJ-PAY-FEEMIS-002',
            amountPaid: 5000.0,
            fee: 200.0,
            settlementAmount: 4800.0,
            currency: 'NGN',
            paymentStatus: 'PAID',
            paidOn: '2026-11-26T09:20:02.000Z',
            accountDetails: { accountNumber: '0123459999', bankCode: '058' },
          },
          {
            transactionReference: 'MNFY|SR|GHOST|004',
            paymentReference: 'MNJ-PAY-GHOST-004',
            amountPaid: 7500.0,
            fee: 112.5,
            settlementAmount: 7387.5,
            currency: 'NGN',
            paymentStatus: 'PAID',
            paidOn: '2026-11-26T09:35:00.000Z',
          },
          {
            transactionReference: 'MNFY|SR|AMB_EXT',
            paymentReference: 'MNJ-PAY-SHARED-AMB',
            amountPaid: 2000.0,
            fee: 30.0,
            settlementAmount: 1970.0,
            currency: 'NGN',
            paymentStatus: 'PAID',
            paidOn: '2026-11-26T09:42:00.000Z',
          },
          {
            transactionReference: 'MNFY|SR|LATE|005',
            paymentReference: 'MNJ-PAY-LATE-005',
            amountPaid: 4000.0,
            fee: 60.0,
            settlementAmount: 3940.0,
            currency: 'NGN',
            paymentStatus: 'PAID',
            paidOn: '2026-11-26T09:50:00.000Z',
          },
        ],
      },
    });

    // Dry-run preview first — must NOT write any import, match, or audit rows, while distinguishing
    // Merchant Settlement vs Customer Wallet Credit and flagging Ambiguous & Late rows for Finance review!
    const previewRes = await request(app.getHttpServer())
      .post(`${BASE}/imports/preview`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        institutionId,
        providerKey: 'MONNIFY',
        reportType: 'COLLECTIONS',
        fileName: 'monnify-collections-20261126.json',
        content: collectionsJson,
        periodStart: '2026-11-26T09:00:00.000Z',
        periodEnd: '2026-11-26T09:55:00.000Z',
      })
      .expect(201);

    expect(previewRes.body.verificationStatus).toBe('VERIFIED_OFFICIAL_API_JSON');
    expect(previewRes.body.validRowsCount).toBe(5);
    expect(previewRes.body.financeReviewRowsCount).toBe(4);
    expect(JSON.stringify(previewRes.body)).not.toContain('0123456789');
    expect(JSON.stringify(previewRes.body)).not.toContain('8011223344');

    // Prove preview distinguishes Merchant Settlement (985,000) from MonieNaija Fee (5,000) and Customer Wallet Credit (980,000)
    const previewClean = previewRes.body.sampleValidRows.find(
      (r: { providerTransactionReference?: string }) =>
        r.providerTransactionReference === 'MNFY|SR|CLEAN|001',
    );
    expect(previewClean).toMatchObject({
      grossAmountMinor: '1000000',
      providerFeeMinor: '15000',
      netAmountMinor: '985000',
      internalMerchantSettlementMinor: '985000',
      internalPlatformFeeMinor: '5000',
      internalCustomerCreditMinor: '980000',
      predictedStatus: 'MATCHED',
      requiresFinanceReview: false,
    });

    // Prove preview flags Ambiguous & Late (>24h cutoff) matches for Finance review
    const previewAmb = previewRes.body.sampleValidRows.find(
      (r: { providerTransactionReference?: string }) =>
        r.providerTransactionReference === 'MNFY|SR|AMB_EXT',
    );
    expect(previewAmb).toMatchObject({
      predictedStatus: 'AMBIGUOUS_CANDIDATES',
      requiresFinanceReview: true,
      ambiguousCandidatesCount: 2,
    });
    const previewLate = previewRes.body.sampleValidRows.find(
      (r: { providerTransactionReference?: string }) =>
        r.providerTransactionReference === 'MNFY|SR|LATE|005',
    );
    expect(previewLate).toMatchObject({
      predictedStatus: 'DATE_WINDOW_MISMATCH',
      requiresFinanceReview: true,
    });

    // Prove Dry-Run Preview persisted ZERO rows in DB (preview-only until confirmed)
    const [{ c: importsAfterPreview }] = await dataSource.query<[{ c: string }]>(
      `SELECT COUNT(*)::text AS c FROM settlement_report_imports WHERE institution_id = $1::uuid`,
      [institutionId],
    );
    expect(Number(importsAfterPreview)).toBe(0);

    // Confirm import
    const importRes = await request(app.getHttpServer())
      .post(`${BASE}/imports`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        institutionId,
        providerKey: 'MONNIFY',
        reportType: 'COLLECTIONS',
        fileName: 'monnify-collections-20261126.json',
        content: collectionsJson,
        periodStart: '2026-11-26T09:00:00.000Z',
        periodEnd: '2026-11-26T09:55:00.000Z',
      })
      .expect(201);

    expect(importRes.body.idempotentReplay).toBe(false);
    expect(importRes.body.importRecord.validRows).toBe(5);
    expect(importRes.body.importRecord.maskedStatementAccount).toBe('••••••3344');

    // Idempotent replay of exact same file -> idempotentReplay = true, zero duplicate rows
    const replayRes = await request(app.getHttpServer())
      .post(`${BASE}/imports`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        institutionId,
        providerKey: 'MONNIFY',
        reportType: 'COLLECTIONS',
        fileName: 'monnify-collections-20261126.json',
        content: collectionsJson,
        periodStart: '2026-11-26T09:00:00.000Z',
        periodEnd: '2026-11-26T09:55:00.000Z',
      })
      .expect(201);
    expect(replayRes.body.idempotentReplay).toBe(true);
    expect(replayRes.body.importRecord.id).toBe(importRes.body.importRecord.id);

    // Also import Outbound Payouts JSON carrying 30-digit NIP sessionId
    const payoutsJson = JSON.stringify({
      responseBody: [
        {
          transactionReference: 'MFDS|SR|OUT|701',
          reference: 'MNJ_OUT_SR_701',
          amount: 4000.0,
          fee: 35.0,
          currency: 'NGN',
          status: 'SUCCESS',
          sessionId: nipSessionId,
          destinationAccountNumber: '0099887766',
          destinationBankCode: '044',
          createdOn: '2026-11-26T10:00:30.000Z',
        },
      ],
    });
    await request(app.getHttpServer())
      .post(`${BASE}/imports`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        institutionId,
        providerKey: 'MONNIFY',
        reportType: 'PAYOUTS',
        fileName: 'monnify-payouts-20261126.json',
        content: payoutsJson,
      })
      .expect(201);

    // Inspect transaction match classifications
    const matchesRes = await request(app.getHttpServer())
      .get(`${BASE}/transaction-matches?institutionId=${institutionId}`)
      .set('Authorization', `Bearer ${sessions.FINANCE_AUDITOR!.accessToken}`)
      .expect(200);

    interface MatchSummaryItem {
      id: string;
      matchStatus: string;
      providerReference?: string;
      internalSourceId?: string;
      internalTransactionHistoryPath?: string;
      internalJournalIds?: string[];
      ambiguousCandidates?: Array<{ sourceId: string }>;
      [key: string]: unknown;
    }
    const items: MatchSummaryItem[] = matchesRes.body.items;
    const byStatus = new Map<string, MatchSummaryItem[]>();
    for (const item of items) {
      const arr = byStatus.get(item.matchStatus) ?? [];
      arr.push(item);
      byStatus.set(item.matchStatus, arr);
    }

    expect(byStatus.get('MATCHED')?.length).toBeGreaterThanOrEqual(1);
    expect(byStatus.get('FEE_MISMATCH')?.length).toBe(1);
    expect(byStatus.get('MISSING_INTERNAL')?.length).toBe(1);
    expect(byStatus.get('MISSING_IN_PROVIDER')?.length).toBe(1);
    expect(byStatus.get('AMBIGUOUS_CANDIDATES')?.length).toBe(1);
    expect(byStatus.get('DATE_WINDOW_MISMATCH')?.length).toBe(1);

    const cleanMatch = items.find((m) => m.providerReference === 'MNFY|SR|CLEAN|001')!;
    expect(cleanMatch.matchStatus).toBe('MATCHED');
    expect(cleanMatch.internalNetMinor).toBe('985000');
    expect(cleanMatch.internalPlatformFeeMinor).toBe('5000');
    expect(cleanMatch.internalCustomerCreditMinor).toBe('980000');
    expect(cleanMatch.internalJournalIds).toContain(cleanJournalId);
    expect(cleanMatch.internalTransactionHistoryPath).toBe(
      `#transaction-history/BANK_TO_WALLET/${inboundCleanId}`,
    );

    const feeMis = byStatus.get('FEE_MISMATCH')![0]!;
    expect(feeMis.feeVarianceMinor).toBe('10000');

    // A different maker proposes; the original uploader also holds the checker function.
    const propRes = await request(app.getHttpServer())
      .post(`${BASE}/transaction-matches/${feeMis.id}/propose`)
      .set('Authorization', `Bearer ${secondMaker.accessToken}`)
      .send({
        decision: 'CONFIRM_FEE_VARIANCE',
        note: 'Verified Monnify tiered stamp/collection fee deduction on invoice.',
      })
      .expect(201);
    expect(propRes.body.reviewState).toBe('PROPOSED');

    // The uploader's second independently issued session holds checker authority, but the
    // principal is the same as the source uploader and cannot review another maker's proposal.
    const ownProposalReview = await request(app.getHttpServer())
      .post(`${BASE}/transaction-matches/${feeMis.id}/review`)
      .set('Authorization', `Bearer ${secondMakerSecondSession.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Attempting review of own proposal' })
      .expect(403);
    expect(ownProposalReview.body.message).toMatch(/own reconciliation proposal/i);
    await expect(
      app
        .get(SettlementReconciliationService)
        .reviewTransactionMatchResolution(
          { ...customPrincipalForTest, assuranceLevel: 'PASSWORD' },
          feeMis.id,
          { decision: 'APPROVE', note: 'No MFA' },
        ),
    ).rejects.toThrow(/MFA/i);
    const uploadOwnerReview = await request(app.getHttpServer())
      .post(`${BASE}/transaction-matches/${feeMis.id}/review`)
      .set('Authorization', `Bearer ${uploaderSecondSession.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Attempting review of own upload' })
      .expect(403);
    expect(uploadOwnerReview.body.message).toMatch(/own upload/i);
    await request(app.getHttpServer())
      .post(`${BASE}/transaction-matches/${feeMis.id}/review`)
      .set('Authorization', `Bearer ${noChecker.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Missing checker function' })
      .expect(403);
    const customOverview = await request(app.getHttpServer())
      .get(`${BASE}/overview?institutionId=${institutionId}`)
      .set('Authorization', `Bearer ${customChecker.accessToken}`)
      .expect(200);
    expect(customOverview.body.capabilities.canReview).toBe(true);
    const viewerOverview = await request(app.getHttpServer())
      .get(`${BASE}/overview?institutionId=${institutionId}`)
      .set('Authorization', `Bearer ${noChecker.accessToken}`)
      .expect(200);
    expect(viewerOverview.body.capabilities.canReview).toBe(false);
    await request(app.getHttpServer())
      .get(`${BASE}/overview?institutionId=${foreignInstitutionId}`)
      .set('Authorization', `Bearer ${customChecker.accessToken}`)
      .expect(404);

    const revRes = await request(app.getHttpServer())
      .post(`${BASE}/transaction-matches/${feeMis.id}/review`)
      .set('Authorization', `Bearer ${customChecker.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Independent checker verified the fee variance.' })
      .expect(201);
    expect(revRes.body.reviewState).toBe('APPROVED');
    expect(revRes.body.reviewedBy).toBe(customChecker.principalId);
    expect(await financialSnapshot()).toEqual(financialSnapshotBefore);
  });

  it('executes Workflow 3: reconciles Settlement Batch -> Gross Collections / Monnify Fee / Net Settlement -> Bank Statement Credit, and enriches FinanceOperationsService', async () => {
    // Import Monnify Settlements report referencing MNFY|SR|CLEAN|001
    const settlementJson = JSON.stringify({
      responseBody: [
        {
          settlementReference: 'SET-20261126-KANO-01',
          payoutReference: 'PO-KANO-01',
          settledDate: '2026-11-26T14:00:00.000Z',
          settlementAmount: 9850.0,
          settlementFee: 150.0,
          totalTransactionsAmount: 10000.0,
          currency: 'NGN',
          destinationAccountNumber: '2030405060',
          destinationBankCode: '058',
          transactions: [
            {
              transactionReference: 'MNFY|SR|CLEAN|001',
              paymentReference: 'MNJ-PAY-CLEAN-001',
              amountPaid: 10000.0,
              fee: 150.0,
              settlementAmount: 9850.0,
              currency: 'NGN',
              paidOn: '2026-11-26T09:10:05.000Z',
            },
          ],
        },
      ],
    });

    await request(app.getHttpServer())
      .post(`${BASE}/imports`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        institutionId,
        providerKey: 'MONNIFY',
        reportType: 'SETTLEMENTS',
        statementDestination: 'BANK_ACCOUNT',
        fileName: 'monnify-settlement-kano-01.json',
        content: settlementJson,
      })
      .expect(201);

    // Before bank statement is imported, batch status must be STATEMENT_UNMATCHED
    const beforeStmt = await request(app.getHttpServer())
      .get(`${BASE}/settlement-batches?institutionId=${institutionId}`)
      .set('Authorization', `Bearer ${sessions.FINANCE_CONTROLLER!.accessToken}`)
      .expect(200);
    expect(beforeStmt.body.items).toHaveLength(1);
    expect(beforeStmt.body.items[0].batchStatus).toBe('STATEMENT_UNMATCHED');
    expect(beforeStmt.body.items[0].grossCollectionsMinor).toBe('1000000');
    expect(beforeStmt.body.items[0].providerFeeTotalMinor).toBe('15000');
    expect(beforeStmt.body.items[0].expectedNetSettlementMinor).toBe('985000');
    expect(beforeStmt.body.items[0].maskedDestinationAccount).toBe('••••••5060');

    // Now import Commercial Bank Statement CSV (UNVERIFIED_MISSING_REDACTED_EXPORT) carrying the ₦9,850.00 credit
    const bankCsv = [
      'Value Date,Reference,Narration,Credit,Debit,Running Balance,Currency,Account Number',
      '2026-11-26,GTB-CR-881,MONNIFY SETTLEMENT SET-20261126-KANO-01,9850.00,0.00,509850.00,NGN,2030405060',
    ].join('\n');

    const stmtImport = await request(app.getHttpServer())
      .post(`${BASE}/imports`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        institutionId,
        providerKey: 'COMMERCIAL_BANK_STATEMENT',
        reportType: 'BANK_STATEMENT',
        statementDestination: 'BANK_ACCOUNT',
        fileName: 'gtb-corporate-statement.csv',
        content: bankCsv,
      })
      .expect(201);
    expect(stmtImport.body.importRecord.verificationStatus).toBe(
      'UNVERIFIED_MISSING_REDACTED_EXPORT',
    );

    // Batch automatically reconciles against statement credit!
    const afterStmt = await request(app.getHttpServer())
      .get(`${BASE}/settlement-batches?institutionId=${institutionId}`)
      .set('Authorization', `Bearer ${sessions.FINANCE_CONTROLLER!.accessToken}`)
      .expect(200);
    expect(afterStmt.body.items[0].batchStatus).toBe('RECONCILED');
    expect(afterStmt.body.items[0].statementCreditMinor).toBe('985000');
    expect(afterStmt.body.items[0].varianceMinor).toBe('0');
    const batchId = afterStmt.body.items[0].id as string;
    await request(app.getHttpServer())
      .post(`${BASE}/settlement-batches/${batchId}/propose`)
      .set('Authorization', `Bearer ${secondMaker.accessToken}`)
      .send({
        decision: 'CONFIRM_RECONCILED',
        note: 'Independent maker proposes settlement check.',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/settlement-batches/${batchId}/review`)
      .set('Authorization', `Bearer ${uploaderSecondSession.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Uploader cannot review own settlement.' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${BASE}/settlement-batches/${batchId}/review`)
      .set('Authorization', `Bearer ${customChecker.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Independent settlement checker.' })
      .expect(201);
    expect(await financialSnapshot()).toEqual(financialSnapshotBefore);

    // Verify FinanceOperationsService.reconciliationBreaks:
    // - foreignInstitutionId (0 imports) keeps EXTERNAL_PROVIDER & EXTERNAL_STATEMENT as UNAVAILABLE/NOT_PERFORMED
    // - institutionId exposes importedSettlementReportEvidence
    const finOps = app.get(FinanceOperationsService);
    const untouchedBreaks = await finOps.reconciliationBreaks(
      sessions.SUPER_ADMIN!.principal as never,
      { institutionId: foreignInstitutionId } as never,
    );
    const extProviderUntouched = untouchedBreaks.sources.find(
      (s) => s.source === 'EXTERNAL_PROVIDER',
    );
    const extStmtUntouched = untouchedBreaks.sources.find((s) => s.source === 'EXTERNAL_STATEMENT');
    expect(extProviderUntouched?.availability).toBe('UNAVAILABLE');
    expect(extStmtUntouched?.availability).toBe('UNAVAILABLE');

    const enrichedBreaks = await finOps.reconciliationBreaks(
      sessions.SUPER_ADMIN!.principal as never,
      { institutionId } as never,
    );
    const extProviderEnriched = enrichedBreaks.sources.find(
      (s) => s.source === 'EXTERNAL_PROVIDER',
    );
    const extStmtEnriched = enrichedBreaks.sources.find((s) => s.source === 'EXTERNAL_STATEMENT');
    expect(['DIFFERENCES', 'EVIDENCE_RECORDED']).toContain(extProviderEnriched?.result);
    expect(['DIFFERENCES', 'EVIDENCE_RECORDED', 'MATCHED']).toContain(extStmtEnriched?.result);
  });

  it('executes Workflow 4 & DB Invariants: tracks Return/Refund/Chargeback lifecycles without mutating original transactions, enforces append-only/masking triggers, and posts ZERO ledger journals', async () => {
    const refundsJson = JSON.stringify({
      responseBody: {
        content: [
          {
            refundReference: 'MNFY-REF-9001',
            transactionReference: 'MNFY|SR|CLEAN|001',
            refundAmount: 10000.0,
            refundStatus: 'PENDING',
            refundReason: 'Customer duplicate transfer refund',
            currencyCode: 'NGN',
            createdOn: '2026-11-26T15:00:00.000Z',
          },
          {
            disputeReference: 'MNFY-CBK-9002',
            transactionReference: 'MNFY|SR|UNKNOWN_ORIG|999',
            amount: 25000.0,
            status: 'OPEN',
            eventKind: 'CHARGEBACK_OR_LIEN',
            reason: 'Issuer chargeback claim',
            currencyCode: 'NGN',
            createdOn: '2026-11-26T15:10:00.000Z',
          },
        ],
      },
    });

    const refImport = await request(app.getHttpServer())
      .post(`${BASE}/imports`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        institutionId,
        providerKey: 'MONNIFY',
        reportType: 'REFUNDS_DISPUTES',
        fileName: 'monnify-refunds-disputes.json',
        content: refundsJson,
      })
      .expect(201);

    // Because the batch includes a chargeback (no official Monnify dispute API schema), format status is downgraded honestly
    expect(refImport.body.importRecord.verificationStatus).toBe(
      'UNVERIFIED_MISSING_REDACTED_EXPORT',
    );

    const casesRes = await request(app.getHttpServer())
      .get(`${BASE}/return-dispute-cases?institutionId=${institutionId}`)
      .set('Authorization', `Bearer ${sessions.FINANCE_AUDITOR!.accessToken}`)
      .expect(200);
    expect(casesRes.body.items).toHaveLength(2);

    interface CaseSummaryItem {
      id: string;
      returnOrDisputeReference?: string;
      lifecycleStatus?: string;
      originalGrossMinor?: string;
      originalProviderFeeMinor?: string;
      originalNetMinor?: string;
    }
    const voluntaryRefund = (casesRes.body.items as CaseSummaryItem[]).find(
      (c) => c.returnOrDisputeReference === 'MNFY-REF-9001',
    )!;
    expect(voluntaryRefund.lifecycleStatus).toBe('AWAITING_PROVIDER_CONFIRMATION');
    expect(voluntaryRefund.originalGrossMinor).toBe('1000000');
    expect(voluntaryRefund.originalProviderFeeMinor).toBe('15000');
    expect(voluntaryRefund.originalNetMinor).toBe('985000');

    const chargeback = (casesRes.body.items as CaseSummaryItem[]).find(
      (c) => c.returnOrDisputeReference === 'MNFY-CBK-9002',
    )!;
    expect(chargeback.lifecycleStatus).toBe('PROVIDER_CONFIRMED_UNMATCHED_INTERNAL');
    await request(app.getHttpServer())
      .post(`${BASE}/return-dispute-cases/${chargeback.id}/propose`)
      .set('Authorization', `Bearer ${secondMaker.accessToken}`)
      .send({ decision: 'ESCALATE_UNMATCHED_CHARGEBACK', note: 'Independent maker escalates.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/return-dispute-cases/${chargeback.id}/review`)
      .set('Authorization', `Bearer ${uploaderSecondSession.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Uploader cannot review own case.' })
      .expect(403);
    const reviewedChargeback = await request(app.getHttpServer())
      .post(`${BASE}/return-dispute-cases/${chargeback.id}/review`)
      .set('Authorization', `Bearer ${customChecker.accessToken}`)
      .send({ decision: 'APPROVE', note: 'Independent configurable checker.' })
      .expect(201);
    expect(reviewedChargeback.body.reviewedBy).toBe(customChecker.principalId);
    expect(reviewedChargeback.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventSource: 'INTERNAL_RECORD',
          eventType: 'RESOLUTION_APPROVED',
          actor: customChecker.principalId,
        }),
      ]),
    );

    // Maker proposes awaiting provider completion on voluntary refund & Checker approves
    await request(app.getHttpServer())
      .post(`${BASE}/return-dispute-cases/${voluntaryRefund.id}/propose`)
      .set('Authorization', `Bearer ${sessions.FINANCE_PREPARER!.accessToken}`)
      .send({
        decision: 'AWAIT_PROVIDER_COMPLETION',
        note: 'Tracking Monnify pending refund; original settlement remains frozen.',
      })
      .expect(201);

    const approvedCase = await request(app.getHttpServer())
      .post(`${BASE}/return-dispute-cases/${voluntaryRefund.id}/review`)
      .set('Authorization', `Bearer ${sessions.FINANCE_CONTROLLER!.accessToken}`)
      .send({
        decision: 'APPROVE',
        note: 'Confirmed pending provider refund; original collection untouched.',
      })
      .expect(201);

    expect(approvedCase.body.reviewState).toBe('APPROVED');
    expect(approvedCase.body.events.length).toBeGreaterThanOrEqual(3);

    // Verify original banking_inbound_payments row & original MATCHED transaction match row were NEVER mutated
    const [origInbound] = await dataSource.query<
      Array<{ gross: string; fee: string; net: string }>
    >(
      `SELECT gross_amount_minor::text AS gross, provider_fee_minor::text AS fee, credited_amount_minor::text AS net
         FROM banking_inbound_payments WHERE id = $1`,
      [inboundCleanId],
    );
    expect(origInbound).toEqual({ gross: '1000000', fee: '15000', net: '985000' });

    // Prove DB append-only / no-delete / immutability / masking invariants directly against PostgreSQL
    await expect(dataSource.query(`DELETE FROM settlement_report_rows`)).rejects.toThrow(
      /never deleted/i,
    );
    await expect(
      dataSource.query(`UPDATE settlement_report_rows SET provider_status = 'TAMPERED'`),
    ).rejects.toThrow(/append-only/i);
    await expect(dataSource.query(`DELETE FROM settlement_return_dispute_events`)).rejects.toThrow(
      /never deleted/i,
    );
    await expect(dataSource.query(`DELETE FROM settlement_transaction_matches`)).rejects.toThrow(
      /never deleted/i,
    );
    await expect(
      dataSource.query(
        `UPDATE settlement_return_dispute_cases SET original_gross_minor = 1 WHERE id = $1`,
        [voluntaryRefund.id],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      dataSource.query(
        `UPDATE settlement_report_imports SET masked_statement_account = '0123456789' WHERE id = $1`,
        [refImport.body.importRecord.id],
      ),
    ).rejects.toThrow(/check/i);

    // Prove ZERO ledger journals or ledger lines were posted by reconciliation
    const [{ c: jcAfter }] = await dataSource.query<[{ c: string }]>(
      'SELECT COUNT(*)::text AS c FROM ledger_journals',
    );
    const [{ c: lcAfter }] = await dataSource.query<[{ c: string }]>(
      'SELECT COUNT(*)::text AS c FROM ledger_lines',
    );
    expect(Number(jcAfter)).toBe(postedJournalCountBefore);
    expect(Number(lcAfter)).toBe(postedLinesCountBefore);
    expect(await financialSnapshot()).toEqual(financialSnapshotBefore);

    // Prove audit trail recorded imports, proposals, and reviews
    const [{ c: auditCount }] = await dataSource.query<[{ c: string }]>(
      `SELECT COUNT(*)::text AS c FROM audit_events
        WHERE entity_type LIKE 'SETTLEMENT_%'`,
    );
    expect(Number(auditCount)).toBeGreaterThanOrEqual(7);
  });

  it('revoking the review function removes checker access, and restoring it returns access', async () => {
    const roleApi = '/api/v1/internal/a2/workforce/role-definitions/proposals';
    const grantsFor = async (roleKey: string) => {
      const [role] = await dataSource.query<
        Array<{
          id: string;
          definition_version: string;
          display_name: string;
          description: string;
          read_only: boolean;
        }>
      >(
        `SELECT id::text AS id, definition_version::text AS definition_version,
                display_name, description, read_only
           FROM authorization_roles WHERE role_key = $1`,
        [roleKey],
      );
      expect(role).toBeDefined();
      const grants = await dataSource.query<Array<{ function_code: string; access_type: string }>>(
        `SELECT function_code, access_type FROM authorization_role_functions
          WHERE role_id = $1::uuid AND is_active = true ORDER BY function_code`,
        [role!.id],
      );
      return { role: role!, grants };
    };
    const andAuthenticationState = async (token: string) => {
      const overview = await request(app.getHttpServer())
        .get(`${BASE}/overview?institutionId=${institutionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // A review attempt on an unknown identifier separates "gate passed" (404) from "no authority" (403).
      const probe = await request(app.getHttpServer())
        .post(`${BASE}/transaction-matches/${randomUUID()}/review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'APPROVE', note: 'Authorization probe' });
      return {
        canReview: overview.body.capabilities.canReview as boolean,
        probeStatus: probe.status,
        probeMessage: (probe.body as { message?: string }).message ?? '',
      };
    };

    // Baseline: the review function is granted through the governed workflow, so the checker passes
    // the authorization gate (a 404 on an unknown id, never a 403).
    const before = await grantsFor('SR_TEST_CHECKER');
    expect(before.grants.map((grant) => grant.function_code)).toContain(
      'reconciliation.settlement_report.review',
    );
    const authorized = await andAuthenticationState(customChecker.accessToken);
    expect(authorized).toMatchObject({ canReview: true, probeStatus: 404 });

    // Revoke the review function through the same governed maker-checker workflow.
    const revoked = await request(app.getHttpServer())
      .post(roleApi)
      .set('Authorization', `Bearer ${sessions.SUPER_ADMIN!.accessToken}`)
      .send({
        proposalType: 'MODIFY',
        roleKey: 'SR_TEST_CHECKER',
        displayName: before.role.display_name,
        description: before.role.description,
        readOnly: before.role.read_only,
        functionGrants: before.grants
          .filter((grant) => grant.function_code !== 'reconciliation.settlement_report.review')
          .map((grant) => ({ functionCode: grant.function_code, accessType: grant.access_type })),
        expectedDefinitionVersion: Number(before.role.definition_version),
        reason: 'Revoke settlement reconciliation review during the permission acceptance test.',
      })
      .expect(201);
    const revokedId = revoked.body.proposal.id as string;
    await request(app.getHttpServer())
      .post(`${roleApi}/${revokedId}/approve`)
      .set('Authorization', `Bearer ${sessions.FINANCE_CONTROLLER!.accessToken}`)
      .send({ comment: 'Independent approval of the revocation' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${roleApi}/${revokedId}/apply`)
      .set('Authorization', `Bearer ${sessions.SUPER_ADMIN!.accessToken}`)
      .send({})
      .expect(201);

    // The very same session token loses review authority, because roles and scopes are resolved per
    // request from the role catalogue rather than frozen into the token.
    const afterRevoke = await andAuthenticationState(customChecker.accessToken);
    expect(afterRevoke.canReview).toBe(false);
    expect(afterRevoke.probeStatus).toBe(403);
    expect(afterRevoke.probeMessage).toMatch(/reconciliation\.settlement_report\.review/i);

    // Restore the grant through the same workflow; access returns without a new session.
    const stripped = await grantsFor('SR_TEST_CHECKER');
    expect(stripped.grants.map((grant) => grant.function_code)).not.toContain(
      'reconciliation.settlement_report.review',
    );
    const restored = await request(app.getHttpServer())
      .post(roleApi)
      .set('Authorization', `Bearer ${sessions.SUPER_ADMIN!.accessToken}`)
      .send({
        proposalType: 'MODIFY',
        roleKey: 'SR_TEST_CHECKER',
        displayName: stripped.role.display_name,
        description: stripped.role.description,
        readOnly: stripped.role.read_only,
        functionGrants: [
          ...stripped.grants.map((grant) => ({
            functionCode: grant.function_code,
            accessType: grant.access_type,
          })),
          { functionCode: 'reconciliation.settlement_report.review', accessType: 'APPROVE' },
        ],
        expectedDefinitionVersion: Number(stripped.role.definition_version),
        reason: 'Restore settlement reconciliation review after the permission acceptance test.',
      })
      .expect(201);
    const restoredId = restored.body.proposal.id as string;
    await request(app.getHttpServer())
      .post(`${roleApi}/${restoredId}/approve`)
      .set('Authorization', `Bearer ${sessions.FINANCE_CONTROLLER!.accessToken}`)
      .send({ comment: 'Independent approval of the restoration' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${roleApi}/${restoredId}/apply`)
      .set('Authorization', `Bearer ${sessions.SUPER_ADMIN!.accessToken}`)
      .send({})
      .expect(201);

    const afterRestore = await andAuthenticationState(customChecker.accessToken);
    expect(afterRestore).toMatchObject({ canReview: true, probeStatus: 404 });
    // The revoked function never leaked to the ledger-only control role.
    const control = await andAuthenticationState(noChecker.accessToken);
    expect(control.canReview).toBe(false);
    expect(control.probeStatus).toBe(403);
  });

  it('drives the real built Admin Web SPA in headless Chromium against the live NestJS + PostgreSQL backend when SR_BROWSER_E2E=yes', async () => {
    if (process.env.SR_BROWSER_E2E !== 'yes') {
      return;
    }

    const distDir = resolve(__dirname, '../apps/admin-web/dist');
    expect(existsSync(join(distDir, 'index.html'))).toBe(true);

    await app.listen(0, '127.0.0.1');
    const apiAddr = app.getHttpServer().address() as { port: number };
    const apiPort = apiAddr.port;

    const mimeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
    };

    proxyServer = createServer((req, res) => {
      const reqUrl = req.url ?? '/';
      if (reqUrl.startsWith('/api/v1')) {
        const upReq = httpRequest(
          {
            hostname: '127.0.0.1',
            port: apiPort,
            path: reqUrl,
            method: req.method,
            headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
          },
          (upRes) => {
            res.writeHead(upRes.statusCode ?? 502, upRes.headers);
            upRes.pipe(res);
          },
        );
        upReq.on('error', (err) => {
          res.statusCode = 502;
          res.end(String(err));
        });
        req.pipe(upReq);
        return;
      }

      const cleanPath = decodeURIComponent(reqUrl.split('?')[0] ?? '/');
      const candidate = join(distDir, cleanPath);
      const filePath =
        candidate.startsWith(distDir) && existsSync(candidate) && !cleanPath.endsWith('/')
          ? candidate
          : join(distDir, 'index.html');
      const data = readFileSync(filePath);
      res.setHeader('Content-Type', mimeMap[extname(filePath)] ?? 'application/octet-stream');
      res.end(data);
    });

    await new Promise<void>((res) => proxyServer!.listen(0, '127.0.0.1', () => res()));
    const webPort = (proxyServer.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${webPort}`;

    const binary = JSON.parse(
      spawnSync(
        process.execPath,
        [
          '-e',
          "const c=require('@sparticuz/chromium').default;c.executablePath().then(p=>console.log(JSON.stringify({path:p,args:c.args})))",
        ],
        { encoding: 'utf8' },
      ).stdout,
    );
    const al2023Dir = '/tmp/al2023';
    const al2023Archive = resolve(
      __dirname,
      '../node_modules/@sparticuz/chromium/bin/al2023.tar.br',
    );
    if (!existsSync(join(al2023Dir, 'lib')) && existsSync(al2023Archive)) {
      mkdirSync(al2023Dir, { recursive: true });
      const tarPath = join(al2023Dir, 'al2023.tar');
      writeFileSync(tarPath, brotliDecompressSync(readFileSync(al2023Archive)));
      execFileSync('tar', ['-xf', tarPath, '-C', al2023Dir]);
    }

    const { chromium } = require('playwright');
    browser = await chromium.launch({
      executablePath: binary.path,
      args: binary.args.filter((a: string) => a !== '--single-process'),
      headless: true,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [join(al2023Dir, 'lib'), process.env.LD_LIBRARY_PATH]
          .filter(Boolean)
          .join(':'),
      },
    });

    const pageErrors: string[] = [];
    const signIn = async (role: string) => {
      const ctx = await browser!.newContext({ viewport: { width: 1440, height: 920 } });
      const page = await ctx.newPage();
      page.on('pageerror', (err: Error) => pageErrors.push(`${err.message}\n${err.stack ?? ''}`));
      await page.goto(origin);
      await page.getByPlaceholder('Workforce email').fill(seed.emailFor(role));
      await page.getByPlaceholder('••••••••••••').fill(seed.passwordFor(role));
      await page.getByRole('button', { name: 'Sign in', exact: false }).click();
      await page.getByTestId('main-content').waitFor();
      return page;
    };

    // 1. FINANCE_PREPARER opens Finance -> Platform funds vs. bank -> Provider Settlement Reports & Statements
    const prepPage = await signIn('FINANCE_PREPARER');
    await prepPage.getByTestId('section-finance').click();
    await prepPage.getByTestId('nav-platformFunds').click();
    await prepPage
      .getByRole('button', { name: 'Provider Settlement Reports & Statements' })
      .click();
    await prepPage.getByTestId('settlement-report-reconciliation-panel').waitFor();
    await prepPage.getByText('monnify-collections-20261126.json').waitFor();

    // Verify Dry-Run Preview in real Chromium separates Merchant Settlement (₦9,850.00) vs MonieNaija Fee (₦50.00) vs Customer Wallet Credit (₦9,800.00) and flags Ambiguous & Late rows for Finance review
    await prepPage.getByTestId('sr-report-content-textarea').fill(
      JSON.stringify({
        responseBody: {
          content: [
            {
              transactionReference: 'MNFY|SR|CLEAN|001',
              paymentReference: 'MNJ-PAY-CLEAN-001',
              settlementReference: 'SET-PREVIEW-ONLY',
              amountPaid: 10000.0,
              fee: 150.0,
              settlementAmount: 9850.0,
              currency: 'NGN',
              paymentStatus: 'PAID',
              paidOn: '2026-11-26T09:10:05.000Z',
            },
            {
              transactionReference: 'MNFY|SR|AMB_EXT_PREVIEW',
              paymentReference: 'MNJ-PAY-SHARED-AMB',
              settlementReference: 'SET-PREVIEW-ONLY',
              amountPaid: 2000.0,
              fee: 30.0,
              settlementAmount: 1970.0,
              currency: 'NGN',
              paymentStatus: 'PAID',
              paidOn: '2026-11-26T09:42:00.000Z',
            },
            {
              transactionReference: 'MNFY|SR|LATE|005',
              paymentReference: 'MNJ-PAY-LATE-005',
              settlementReference: 'SET-PREVIEW-ONLY',
              amountPaid: 4000.0,
              fee: 60.0,
              settlementAmount: 3940.0,
              currency: 'NGN',
              paymentStatus: 'PAID',
              paidOn: '2026-11-26T09:50:00.000Z',
            },
          ],
        },
      }),
    );
    await prepPage.getByTestId('sr-preview-btn').click();
    const previewRowsTable = prepPage.getByTestId('sr-preview-rows-table');
    try {
      await previewRowsTable.waitFor({ timeout: 4000 });
    } catch (err) {
      const bodyText = await prepPage
        .locator('body')
        .innerText({ timeout: 2000 })
        .catch(() => '');
      throw new Error(
        `Preview table did not appear.\nPageErrors:\n${pageErrors.join('\n---\n')}\nBodyText:\n${bodyText}\nOrig: ${String(err)}`,
      );
    }
    await previewRowsTable.getByText('₦9,850.00').waitFor();
    await previewRowsTable.getByText('₦50.00').waitFor();
    await previewRowsTable.getByText('₦9,800.00').waitFor();
    await prepPage.getByTestId('sr-preview-review-flag-2').waitFor();
    await prepPage.getByTestId('sr-preview-review-flag-3').waitFor();

    // Open Transaction Matching & propose disposition on MISSING_INTERNAL exception
    await prepPage.getByRole('button', { name: '2. Transaction Matching' }).click();
    await prepPage.getByText('MNFY|SR|GHOST|004').waitFor();
    const ghostRow = prepPage
      .getByRole('row')
      .filter({ has: prepPage.getByText('MNFY|SR|GHOST|004') });
    await ghostRow.getByRole('button', { name: 'Inspect' }).click();
    await prepPage.getByTestId('sr-tx-decision-select').selectOption('ESCALATE_MISSING_INTERNAL');
    await prepPage
      .getByTestId('sr-tx-propose-note')
      .fill('Escalating provider collection missing internal webhook receipt.');
    await prepPage.getByTestId('sr-tx-propose-btn').click();
    await prepPage.getByTestId('sr-success-banner').waitFor();

    // Prove upload audits & Finance review items PERSIST across full browser page reload!
    await prepPage.reload();
    await prepPage.getByTestId('section-finance').click();
    await prepPage.getByTestId('nav-platformFunds').click();
    await prepPage
      .getByRole('button', { name: 'Provider Settlement Reports & Statements' })
      .click();
    await prepPage.getByText('monnify-collections-20261126.json').waitFor();
    await prepPage.getByRole('button', { name: '2. Transaction Matching' }).click();
    const reloadedGhostRow = prepPage
      .getByRole('row')
      .filter({ has: prepPage.getByText('MNFY|SR|GHOST|004') });
    await reloadedGhostRow.getByText('PROPOSED').waitFor();

    // 2. FINANCE_CONTROLLER logs in & approves the proposal, then reloads to confirm APPROVED persists!
    const ctrlPage = await signIn('FINANCE_CONTROLLER');
    await ctrlPage.getByTestId('section-finance').click();
    await ctrlPage.getByTestId('nav-platformFunds').click();
    await ctrlPage
      .getByRole('button', { name: 'Provider Settlement Reports & Statements' })
      .click();
    await ctrlPage.getByTestId('sr-institution-select').selectOption(institutionId);
    await ctrlPage.getByRole('button', { name: '2. Transaction Matching' }).click();
    await ctrlPage.getByText('MNFY|SR|GHOST|004').waitFor();
    await ctrlPage
      .getByRole('row')
      .filter({ has: ctrlPage.getByText('MNFY|SR|GHOST|004') })
      .getByRole('button', { name: 'Inspect' })
      .click();
    await ctrlPage
      .getByTestId('sr-tx-review-note')
      .fill('Confirmed missing webhook; escalated to Monnify support.');
    await ctrlPage.getByTestId('sr-tx-approve-btn').click();
    await ctrlPage.getByTestId('sr-success-banner').waitFor();

    await ctrlPage.reload();
    await ctrlPage.getByTestId('section-finance').click();
    await ctrlPage.getByTestId('nav-platformFunds').click();
    await ctrlPage
      .getByRole('button', { name: 'Provider Settlement Reports & Statements' })
      .click();
    await ctrlPage.getByTestId('sr-institution-select').selectOption(institutionId);
    await ctrlPage.getByRole('button', { name: '2. Transaction Matching' }).click();
    await ctrlPage
      .getByRole('row')
      .filter({ has: ctrlPage.getByText('MNFY|SR|GHOST|004') })
      .getByText('APPROVED')
      .waitFor();

    // 3. FINANCE_AUDITOR follows Report Row -> #transaction-history/BANK_TO_WALLET/<id> -> Ledger Journal!
    const audPage = await signIn('FINANCE_AUDITOR');
    await audPage.getByTestId('section-finance').click();
    await audPage.getByTestId('nav-reconciliation').click();
    await audPage.getByRole('button', { name: 'Provider Settlement Reports' }).click();
    await audPage.getByTestId('sr-institution-select').selectOption(institutionId);
    await audPage.getByRole('button', { name: '2. Transaction Matching' }).click();
    await audPage.getByText('MNFY|SR|CLEAN|001').first().waitFor();
    await audPage
      .getByRole('row')
      .filter({ has: audPage.getByText('MNFY|SR|CLEAN|001') })
      .first()
      .getByRole('button', { name: 'Inspect' })
      .click();
    const historyHref = `#transaction-history/BANK_TO_WALLET/${inboundCleanId}`;
    const link = audPage.locator(`a[href="${historyHref}"]`);
    await link.waitFor();
    await link.click();
    const dialog = audPage.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByText(cleanJournalId).waitFor();
    const journalResponsePromise = audPage.waitForResponse((response) =>
      response.url().includes(`/api/v1/ledger/journals/${cleanJournalId}`),
    );
    await dialog.getByRole('button', { name: 'Open journal' }).click();
    const journalResponse = await journalResponsePromise;
    expect(journalResponse.status()).toBe(200);
    expect((await journalResponse.json()).id).toBe(cleanJournalId);
    await request(app.getHttpServer())
      .get(`/api/v1/ledger/journals/${cleanJournalId}`)
      .set('Authorization', `Bearer ${sessions.FINANCE_AUDITOR!.accessToken}`)
      .expect(200);
    expect(await financialSnapshot()).toEqual(financialSnapshotBefore);
  }, 180000);
});
