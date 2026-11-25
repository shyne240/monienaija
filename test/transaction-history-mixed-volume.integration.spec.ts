/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports */
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, randomBytes, pbkdf2Sync, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser } from 'playwright';
import * as request from 'supertest';
import { HISTORY_SQL, HISTORY_LIST_SQL } from '../src/admin/transaction-history.controller';
import { AppModule } from '../src/app.module';
import { AuditService } from '../src/operations/audit.service';
import { FinancialCommitmentService } from '../src/financial-commitment/financial-commitment.service';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from '../src/financial-commitment/withdrawal-execution-authority';
import { AgentService } from '../src/agent/agent-service.enum';
import { AgentClassService } from '../src/agent/agent-class.service';
import { AgentApplicationService } from '../src/agent/agent-application.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AgentAuthenticationService } from '../src/agent-authentication/agent-authentication.service';
import { AgentPasswordHashAlgorithm } from '../src/agent-authentication/agent-authentication.enums';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentFundingService } from '../src/agent/agent-funding.service';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import {
  AgentFundingGovernanceTestFacade,
  agentNetworkManagerPrincipal,
} from './support/agent-funding-governance';
import {
  buildIntegrationDataSource,
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

import { assertOwnRunDatabaseName, resolveRunIdentifier } from './support/pg-run-namespace';
import { assertDisposablePgTestEnvironment } from './support/pg-test-safety';
const reuse = process.env.HISTORY_MIXED_REUSE_DB;
const volumeDescribe = process.env.HISTORY_MIXED_VOLUME === 'yes' ? describe : describe.skip;
const seed = require('../scripts/local-dev-seed-11-roles.js');
const kyc = createTestEvidenceReader({ mode: 'ELIGIBLE' });
function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(pin, salt, 10000, 32, 'sha256').toString('base64url')}`;
}

// Explicitly opt in; normal PG runs still exercise fixture setup and HTTP acceptance, but
// browser execution requires Vite plus the supplied Chromium binary. No synthetic auth adapter.
volumeDescribe('Transaction History representative mixed-product plans', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fixture: GovernedFinancialFixture;
  let institutionId: string;
  let ledger: LedgerService;
  let service: FinancialCommitmentService;
  let agentClassService: AgentClassService;
  let agentAppService: AgentApplicationService;
  let lifecycleService: AgentLifecycleService;
  let pinService: AgentAuthenticationService;
  let walletService: WalletService;
  let browser: Browser | undefined;
  const agentSessions = new Map<string, string>();
  const oldEnv = { ...process.env };
  beforeAll(async () => {
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    if (reuse) {
      assertDisposablePgTestEnvironment();
      if (!/^mn_it_(historybrowser|mixedhistory)_[a-z][a-z0-9]{3,15}_[0-9]+$/.test(reuse))
        throw new Error('Reuse source must be an explicitly kept mixed-volume disposable fixture');
      const ownName = `mn_it_mixedclone_${resolveRunIdentifier()}_${process.pid}`;
      assertOwnRunDatabaseName(ownName);
      const admin = buildIntegrationDataSource(process.env.DB_ADMIN_NAME || 'postgres');
      await admin.initialize();
      try {
        await admin.query(`CREATE DATABASE "${ownName}" TEMPLATE "${reuse}"`);
      } finally {
        await admin.destroy();
      }
      dataSource = buildIntegrationDataSource(ownName);
      await dataSource.initialize();
      expect(
        (await dataSource.query('SELECT count(*)::integer AS count FROM mixed_fixture_jobs'))[0]
          .count,
      ).toBe(40000);
    } else dataSource = await createIntegrationDataSourceFromScratch('mixedhistory');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kyc.reader)
      .overrideProvider(WITHDRAWAL_EXECUTION_AUTHORITY)
      .useValue({
        authorize: () =>
          Promise.resolve({
            outcome: 'AUTHORIZED',
            providerKey: 'MONNIFY',
            environment: 'sandbox',
          }),
      })
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await seed.seedLocalRoles(dataSource, app.get('A2_WORKFORCE_CONFIG'), app.get(AuditService));
    fixture = new GovernedFinancialFixture({ app, dataSource, label: 'historyBrowser' });
    institutionId = reuse
      ? (await dataSource.query('SELECT institution FROM mixed_fixture_wallets WHERE inst=0'))[0]
          .institution
      : (await fixture.createInstitution()).id;
    ledger = app.get(LedgerService);
    service = app.get(FinancialCommitmentService);
    agentClassService = app.get(AgentClassService);
    agentAppService = app.get(AgentApplicationService);
    lifecycleService = app.get(AgentLifecycleService);
    pinService = app.get(AgentAuthenticationService);
    walletService = app.get(WalletService);
    await dataSource.query(
      `INSERT INTO banks(id,bank_code,bank_name,short_name,nip_supported,status)
      VALUES($1,'AGENTBANK','Synthetic acceptance bank','SYN Bank',true,'ACTIVE') ON CONFLICT DO NOTHING`,
      [randomUUID()],
    );
  }, 180000);
  afterAll(async () => {
    await browser?.close();
    await app?.close();
    if (dataSource) await destroyIntegrationDataSource(dataSource);
    process.env = oldEnv;
  }, 60000);
  async function createActiveAgentWithPin(services: unknown, pin: string | null) {
    const cls = await agentClassService.create({
      reference: `cls-agb-${randomUUID().slice(0, 6)}`,
      code: `AGB-${randomUUID().slice(0, 6).toUpperCase()}`,
      name: 'AGB Class',
      isActive: true,
      applicableServices: services,
      actor: 'test-actor',
    });
    const appEntity = await agentAppService.create({
      agentClassId: cls.id,
      applicantReference: `h-${randomUUID()}`,
      businessName: `Biz AGB ${randomUUID().slice(0, 4)}`,
      contactEmail: `agb-${randomUUID().slice(0, 6)}@test.com`,
      actor: 'applicant-agb',
    });
    await agentAppService.submit(appEntity.id, 'applicant-agb');
    await dataSource.query(
      `UPDATE agent_applications SET status='APPROVED', reviewed_at=NOW(), approved_at=NOW() WHERE id=$1`,
      [appEntity.id],
    );
    const agent = await lifecycleService.activateFromApplication(appEntity.id, 'test-actor');
    expect(agent.status).toBe(AgentStatus.ACTIVE);
    if (pin !== null) {
      await pinService.setTransactionPin(agent.id, {
        pinHash: hashPin(pin),
        hashAlgorithm: AgentPasswordHashAlgorithm.PBKDF2,
        pinVersion: 1,
        actor: agent.id,
      });
    }
    // Agent operating wallet for the financial commitment journey uses the same
    // unattributed liability pattern as the customer commitment tests — the
    // ledger reservation journal contains [wallet ledger + PAYMENT-WITHDRAWAL_RESERVE],
    // both of which must share the same institutional scope (here: none). Governed
    // institutional attribution is covered by the cash-out (A14) suite; here it would
    // mix INSTITUTION + UNATTRIBUTED and the journal institution check would — correctly
    // — refuse it. The wallet is still owner-class AGENT and institution affiliation
    // is established separately for class-of-service checks.
    const wallet = await walletService.createWallet({
      customerId: agent.id,
      currency: 'NGN',
      idempotencyKey: `agent-wallet-${agent.id}-${randomUUID()}`,
    });
    await fixture.affiliateAgent(agent.id, institutionId);
    const walletLedger: Array<{ ledger_account_id: string; ledger_account_code: string }> =
      await dataSource.query(
        `SELECT ledger_account_id, (SELECT code FROM ledger_accounts WHERE id = wallet_accounts.ledger_account_id) AS ledger_account_code FROM wallet_accounts WHERE id=$1 LIMIT 1`,
        [wallet.id],
      );
    const wlId = walletLedger[0]!.ledger_account_id;
    const assetRows: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM ledger_accounts WHERE code='PAYMENT-SETTLEMENT_ASSET-NGN' LIMIT 1`,
    );
    await ledger.postJournal({
      idempotencyKey: `fund-agb-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: assetRows[0]!.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '5000' },
        { accountId: wlId, direction: LedgerEntryDirection.CREDIT, amountMinor: '5000' },
      ],
    });
    // Agent auth session
    const [credential] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO agent_authentication_credentials (agent_id, password_hash, hash_algorithm, password_version, password_changed_at, status) VALUES ($1,$2,'PBKDF2',1,clock_timestamp(),'ACTIVE') RETURNING id`,
      [agent.id, hashPin('login-password')],
    );
    const [session] = await dataSource.query<[{ id: string }]>(
      `INSERT INTO agent_authentication_sessions (agent_id, credential_id, token_hash, audience, status, issued_at, expires_at, last_seen_at) VALUES ($1,$2,$3,'agent-api','ACTIVE',clock_timestamp(),clock_timestamp()+INTERVAL '1 hour',clock_timestamp()) RETURNING id`,
      [agent.id, credential.id, randomBytes(32).toString('hex')],
    );
    agentSessions.set(agent.id, session.id);
    return { cls, agent, wallet, appEntity };
  }

  function agentPrincipal(agentId: string) {
    return {
      type: 'AGENT' as const,
      sessionId: agentSessions.get(agentId),
      agentId,
      principalId: agentId,
      roles: [],
      scopes: [],
      customerAccess: 'NONE' as const,
      agentAccess: 'SELF' as const,
    };
  }

  async function createAgentBeneficiary(agentId: string) {
    // Create BANK_ACCOUNT beneficiary directly via service bypassing enquiry (fixture)
    // For real journey we need verified ACTIVE bank beneficiary; create via SQL fixture
    const benId = randomUUID();
    const ref = `bank-${randomUUID()}`;
    await dataSource.query(
      `INSERT INTO customer_beneficiaries (id, agent_id, beneficiary_type, display_name, reference, destination_identifier, normalized_destination_identifier, destination_name, destination_institution, nickname, status, verified, version, created_at, updated_at)
       VALUES ($1,$2,'BANK_ACCOUNT',$3,$4,'1234567890','1234567890','Test Account','AGENTBANK','My Bank','ACTIVE',true,1,clock_timestamp(),clock_timestamp())`,
      [benId, agentId, 'Test Account', ref],
    );
    await dataSource.query(
      `INSERT INTO beneficiary_ownerships (id, beneficiary_id, agent_id, version) VALUES ($1,$2,$3,1)`,
      [randomUUID(), benId, agentId],
    );
    return benId;
  }

  async function configureAgentLimit(agentId: string, agentClassId?: string) {
    const profile = `AGB_${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await dataSource.query(
      `INSERT INTO limit_profiles(code,name,kind,status,enabled,configuration_status,created_by) VALUES($1,'Agent bank test','AGENT','ACTIVE',true,'CONFIGURED','fixture')`,
      [profile],
    );
    const subjectType = agentClassId ? 'AGENT_CLASS' : 'AGENT';
    const subjectId = agentClassId ?? agentId;
    await dataSource.query(
      `INSERT INTO limit_assignments(id,limit_profile_code,subject_type,subject_id,effective_from,is_active,created_by) VALUES($1,$2,$3,$4,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile, subjectType, subjectId],
    );
    await dataSource.query(
      `INSERT INTO limit_rules(id,limit_profile_code,product,direction,currency,dimension,limit_value_minor,effective_from,is_active,created_by) VALUES($1,$2,'EXTERNAL_BANK_TRANSFER','OUTGOING','NGN','DAILY_AMOUNT',10000,clock_timestamp()-interval '1 day',true,'fixture')`,
      [randomUUID(), profile],
    );
  }

  it('measures the real list projection for platform and scoped sessions at mixed volume', async () => {
    if (process.env.HISTORY_MIXED_VOLUME !== 'yes') return;
    const out = resolve(process.env.HISTORY_MIXED_OUT || 'data/validation/mixed-volume');
    mkdirSync(out, { recursive: true });
    const credentials = await dataSource.query(
      'SELECT id,email,password_hash FROM local_admin_credentials ORDER BY id',
    );
    const grants = await dataSource.query('SELECT * FROM authorization_role_functions ORDER BY id');
    const sessions: Record<string, { accessToken: string; principal: { principalId: string } }> =
      {};
    for (const role of seed.ROLES)
      sessions[role] = (
        await request(app.getHttpServer())
          .post('/api/v1/internal/a2/workforce/local-admin-sessions')
          .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
          .expect(201)
      ).body;
    if (!reuse) {
      const institutions = [institutionId];
      for (let i = 1; i < 4; i++) institutions.push((await fixture.createInstitution()).id);
      await fixture.grantWorkforceScope(institutionId, sessions.OPERATIONS!.principal.principalId);
      const wallets: {
        institution: string;
        source: string;
        sourceLedger: string;
        destination: string;
        destinationLedger: string;
        asset: string;
        customer: string;
      }[] = [];
      for (const institution of institutions) {
        const ws = [];
        const cs = [];
        for (let i = 0; i < 2; i++) {
          const [customer] = await dataSource.query(
            `INSERT INTO customers(reference,customer_type,status,kyc_level,kyc_status) VALUES($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
            ['mixed-' + randomUUID()],
          );
          await fixture.makeCustomerEligible(customer.id, kyc);
          await fixture.enrolCustomer(customer.id, institution);
          const w = await fixture.createWallet(customer.id);
          await fixture.attributeWallet(w.walletId, institution);
          ws.push(w);
          cs.push(customer.id);
        }
        await fixture.fundLedgerAccount(ws[0]!.ledgerAccountId, '100000000', {
          institutionId: institution,
        });
        wallets.push({
          institution,
          source: ws[0]!.walletId,
          sourceLedger: ws[0]!.ledgerAccountId,
          destination: ws[1]!.walletId,
          destinationLedger: ws[1]!.ledgerAccountId,
          asset: await fixture.openInstitutionSettlementAccount(institution),
          customer: cs[0] as string,
        });
      }
      const { agent } = await createActiveAgentWithPin(
        [
          AgentService.EXTERNAL_BANK_TRANSFER,
          AgentService.AGENT_FUNDING,
          AgentService.AGENT_DEFUNDING,
        ],
        '1234',
      );
      // Set-based synthetic read-model fixture; all ledger balance, scope and immutability triggers stay on.
      await dataSource.query(
        `CREATE TABLE mixed_fixture_wallets(inst integer PRIMARY KEY,institution uuid,source uuid,source_ledger uuid,destination uuid,destination_ledger uuid,asset uuid,customer uuid)`,
      );
      for (const [i, w] of wallets.entries())
        await dataSource.query(
          'INSERT INTO mixed_fixture_wallets VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            i,
            w.institution,
            w.source,
            w.sourceLedger,
            w.destination,
            w.destinationLedger,
            w.asset,
            w.customer,
          ],
        );
      await dataSource.query(`CREATE TABLE mixed_fixture_jobs AS SELECT n,kind,gen_random_uuid() AS id,gen_random_uuid() AS business_id,
      CASE WHEN n%20<12 THEN 0 WHEN n%20<17 THEN 1 WHEN n%20<19 THEN 2 ELSE 3 END AS inst,
      '2026-11-25T12:00:00Z'::timestamptz-(n%90)*interval '1 day'-(n%24)*interval '1 hour'+(n%3)*interval '1 microsecond' AS at
      FROM generate_series(1,10000) n CROSS JOIN unnest(ARRAY['WALLET_TRANSFER','CASH_IN','CASH_OUT','CASH_TO_CASH']) kind`);
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        for (let low = 1; low <= 10000; low += 250) {
          await runner.startTransaction();
          await runner.query(
            `INSERT INTO ledger_journals(id,idempotency_key,request_hash,currency,accounting_unit,status,reference,total_minor,metadata,created_at,posted_at,institution_id)
          SELECT j.id,'MIX-J-'||j.id,repeat('a',64),'NGN','CUSTOMER_FUNDS','POSTED','MIX-'||j.kind||'-'||j.n,100,
          CASE WHEN kind IN ('CASH_IN','CASH_OUT') THEN jsonb_build_object('canonicalService',kind,'amountMinor','100','agentId',$3::text) ELSE '{}'::jsonb END,j.at,j.at,w.institution
          FROM mixed_fixture_jobs j JOIN mixed_fixture_wallets w USING(inst) WHERE n BETWEEN $1 AND $2`,
            [low, low + 249, agent.id],
          );
          await runner.query(
            `INSERT INTO ledger_lines(id,journal_id,ledger_account_id,line_number,direction,amount_minor,currency,accounting_unit)
          SELECT gen_random_uuid(),j.id,CASE WHEN d=1 THEN CASE WHEN kind='CASH_IN' THEN w.asset ELSE w.source_ledger END ELSE CASE WHEN kind='CASH_OUT' THEN w.asset ELSE w.destination_ledger END END,
          d,CASE WHEN d=1 THEN 'DEBIT' ELSE 'CREDIT' END,100,'NGN','CUSTOMER_FUNDS'
          FROM mixed_fixture_jobs j JOIN mixed_fixture_wallets w USING(inst) CROSS JOIN generate_series(1,2) d WHERE n BETWEEN $1 AND $2`,
            [low, low + 249],
          );
          await runner.commitTransaction();
        }
      } finally {
        await runner.release();
      }
      await dataSource.query(`INSERT INTO transfers(id,source_wallet_id,destination_wallet_id,journal_id,amount_minor,currency,status,idempotency_key,request_hash,reference,created_at,completed_at)
      SELECT j.business_id,w.source,w.destination,j.id,100,'NGN','COMPLETED','MIX-T-'||n,repeat('a',64),'MIX-WALLET_TRANSFER-'||n,j.at,j.at FROM mixed_fixture_jobs j JOIN mixed_fixture_wallets w USING(inst) WHERE kind='WALLET_TRANSFER'`);
      await dataSource.query(
        `INSERT INTO cash_to_cash_transfers(id,agent_id,beneficiary_phone,principal_minor,fee_minor,vat_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,reference,idempotency_key,created_at,expires_at)
      SELECT j.business_id,$1,'8012345678',100,0,0,100,'NGN','UNCLAIMED','synthetic-not-a-live-code','PBKDF2',j.id,'MIX-CASH_TO_CASH-'||n,'MIX-C2C-'||n,j.at,j.at+interval '7 days' FROM mixed_fixture_jobs j WHERE kind='CASH_TO_CASH'`,
        [agent.id],
      );
      await dataSource.query(`INSERT INTO banking_inbound_payments(institution_id,provider_key,environment,provider_transaction_reference,currency,gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state,recorded_at)
      SELECT w.institution,'MONNIFY','sandbox','MIX-BANK-'||n,'NGN',100,0,100,CASE WHEN n%3=0 THEN 'UNVERIFIED' ELSE 'VERIFIED' END,
      '2026-11-25T12:00:00Z'::timestamptz-(n%90)*interval '1 day'-(n%24)*interval '1 hour'+(n%3)*interval '1 microsecond'
      FROM generate_series(1,40000)n JOIN mixed_fixture_wallets w ON w.inst=CASE WHEN n%20<12 THEN 0 WHEN n%20<17 THEN 1 WHEN n%20<19 THEN 2 ELSE 3 END`);
      await dataSource.query(`INSERT INTO customer_funding_requests(id,customer_id,amount_minor,currency,status,maker_id,maker_type,reference,idempotency_key,request_hash,created_at)
      SELECT gen_random_uuid(),w.customer,100,'NGN','PENDING','synthetic-mixed-maker','OPERATOR','MIX-CUSTOMER-'||n,'MIX-CF-'||n,repeat('a',64),
      '2026-11-25T12:00:00Z'::timestamptz-(n%90)*interval '1 day'-(n%24)*interval '1 hour'+(n%3)*interval '1 microsecond'
      FROM generate_series(1,10000)n JOIN mixed_fixture_wallets w ON w.inst=CASE WHEN n%20<12 THEN 0 WHEN n%20<17 THEN 1 WHEN n%20<19 THEN 2 ELSE 3 END`);
      await dataSource.query(
        `UPDATE customer_funding_requests SET status='REJECTED',checker_id='synthetic-checker',checker_type='OPERATOR',rejection_reason='Synthetic rejection',rejected_at=created_at WHERE reference LIKE 'MIX-CUSTOMER-%' AND (split_part(reference,'-',3)::integer)%2=0`,
      );
      const agentFunding = new AgentFundingGovernanceTestFacade(
        app.get(AgentFundingService),
        app.get(PrivilegedActionApprovalService),
      );
      const beneficiaryId = await createAgentBeneficiary(agent.id);
      await configureAgentLimit(agent.id);
      for (let i = 0; i < 100; i++) {
        const cmd = {
          agentId: agent.id,
          amountMinor: '100',
          currency: 'NGN',
          principal: agentNetworkManagerPrincipal(),
          actor: 'synthetic-mixed-fixture',
        };
        await agentFunding.fund({
          ...cmd,
          idempotencyKey: 'mixed-af-' + i,
          reference: 'MIX-AGENT-FUND-' + i,
        });
        await agentFunding.defund({
          ...cmd,
          amountMinor: '50',
          idempotencyKey: 'mixed-ad-' + i,
          reference: 'MIX-AGENT-DEFUND-' + i,
        });
        await service.initiateForAgent({
          agentId: agent.id,
          agentSessionId: agentSessions.get(agent.id)!,
          principal: agentPrincipal(agent.id),
          pin: '1234',
          amountMinor: '1',
          currency: 'NGN',
          beneficiaryId,
          idempotencyKey: 'mixed-out-' + i,
        });
      }
    }
    await dataSource.query('ANALYZE');
    const distribution = await dataSource.query(
      `${HISTORY_SQL} SELECT type,status,institution_id,count(*)::integer AS rows FROM scoped GROUP BY type,status,institution_id ORDER BY type,status,institution_id`,
      [true, 'unused'],
    );
    expect(new Set(distribution.map((r: { type: string }) => r.type)).size).toBe(9);
    expect(distribution.reduce((sum: number, r: { rows: number }) => sum + r.rows, 0)).toBe(90300);
    expect(
      (
        await dataSource.query(`${HISTORY_SQL} SELECT count(*)::integer AS count FROM scoped`, [
          false,
          sessions.OPERATIONS!.principal.principalId,
        ])
      )[0].count,
    ).toBe(54000);

    const projection = `id,type,status,reference,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",created_at AS "createdAt",amount_minor AS "amountMinor",fee_minor AS "feeMinor",currency`;
    const cases = {
      combined: '',
      reference: `WHERE reference='MIX-WALLET_TRANSFER-1000'`,
      typeStatusDate: `WHERE type='BANK_TO_WALLET' AND status='VERIFIED' AND created_at >= '2026-11-01T23:00:00Z' AND created_at < '2026-11-24T23:00:00Z'`,
      cursor: `WHERE (created_at,type,id) < ('2026-10-15T12:00:00.000001Z'::timestamptz,'CUSTOMER_FUNDING','ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid)`,
    };
    const plans: Record<string, unknown> = {};
    for (const [name, principal] of Object.entries({
      platform: [true, sessions.FINANCE_AUDITOR!.principal.principalId],
      institution: [false, sessions.OPERATIONS!.principal.principalId],
    })) {
      for (const [query, predicate] of Object.entries(cases)) {
        const sql = `${HISTORY_LIST_SQL} SELECT ${projection} FROM scoped ${predicate} ORDER BY created_at DESC,type DESC,id DESC LIMIT 101`;
        // The optimized list must preserve the full detail model's exact projected rows.
        expect(await dataSource.query(sql, principal)).toEqual(
          await dataSource.query(
            `${HISTORY_SQL} SELECT ${projection} FROM scoped ${predicate} ORDER BY created_at DESC,type DESC,id DESC LIMIT 101`,
            principal,
          ),
        );
        const samples = [];
        for (let run = 0; run < 3; run++)
          samples.push(
            (
              await dataSource.query(
                `EXPLAIN (ANALYZE,BUFFERS,SETTINGS,FORMAT JSON) ${sql}`,
                principal,
              )
            )[0]['QUERY PLAN'][0],
          );
        plans[name + '-' + query] = { sql, scope: principal, samples };
      }
    }
    const base = '/api/v1/internal/admin/transaction-history';
    const read = (query: string, role = 'OPERATIONS') =>
      request(app.getHttpServer())
        .get(base + query)
        .set('Authorization', 'Bearer ' + sessions[role]!.accessToken);
    const validations: Record<string, unknown> = {};
    for (const role of ['OPERATIONS', 'FINANCE_AUDITOR']) {
      const expected = await dataSource.query(
        `${HISTORY_SQL} SELECT id,type,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM scoped ORDER BY created_at DESC,type DESC,id DESC LIMIT 1000`,
        [role === 'FINANCE_AUDITOR', sessions[role]!.principal.principalId],
      );
      const seen: string[] = [];
      let cursor = '';
      for (let p = 0; p < 10; p++) {
        const result = (
          await read(
            '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
            role,
          ).expect(200)
        ).body;
        seen.push(...result.items.map((r: { type: string; id: string }) => r.type + '/' + r.id));
        cursor = result.nextCursor;
        expect(cursor).toBeTruthy();
      }
      expect(seen).toEqual(expected.map((r: { type: string; id: string }) => r.type + '/' + r.id));
      expect(new Set(seen).size).toBe(1000);
      validations[role] = {
        pages: 10,
        rows: 1000,
        noDuplicates: true,
        orderedAgainstFullScopedOracle: true,
      };
    }

    // Independent known fixture keys, not an oracle built from the optimized query.
    for (const [type, prefix] of Object.entries({
      WALLET_TRANSFER: 'MIX-WALLET_TRANSFER-',
      CASH_IN: 'MIX-CASH_IN-',
      CASH_OUT: 'MIX-CASH_OUT-',
      CASH_TO_CASH: 'MIX-CASH_TO_CASH-',
      BANK_TO_WALLET: 'MIX-BANK-',
      CUSTOMER_FUNDING: 'MIX-CUSTOMER-',
    })) {
      const own = (await read('?reference=' + prefix + '1000').expect(200)).body.items;
      expect(own).toHaveLength(1);
      expect(own[0].type).toBe(type);
      const foreign = (await read('?reference=' + prefix + '1012', 'FINANCE_AUDITOR').expect(200))
        .body.items;
      expect(foreign).toHaveLength(1);
      expect((await read('?reference=' + prefix + '1012').expect(200)).body.items).toEqual([]);
      await read('/' + type + '/' + foreign[0].id).expect(404);
      const detail = (await read('/' + type + '/' + own[0].id, 'FINANCE_AUDITOR').expect(200)).body;
      expect(detail.id).toBe(own[0].id);
      if (type !== 'CUSTOMER_FUNDING') expect(detail.journals.filter(Boolean)).not.toHaveLength(0);
      else expect(detail.investigation.scopeEvidenceId).toBeTruthy();
    }
    for (const type of ['AGENT_FUNDING', 'AGENT_DEFUNDING', 'WALLET_TO_BANK']) {
      expect((await read('?type=' + type).expect(200)).body.items).toEqual([]);
      const item = (await read('?type=' + type + '&limit=1', 'FINANCE_AUDITOR').expect(200)).body
        .items[0];
      expect(item).toBeTruthy();
      await read('/' + type + '/' + item.id).expect(404);
      const detail = (await read('/' + type + '/' + item.id, 'FINANCE_AUDITOR').expect(200)).body;
      expect(detail.journals.filter(Boolean)).not.toHaveLength(0);
    }
    const ownRef = (await read('?reference=MIX-WALLET_TRANSFER-1000').expect(200)).body.items;
    const foreignRef = (await read('?reference=MIX-WALLET_TRANSFER-1012').expect(200)).body.items;
    expect(ownRef).toHaveLength(1);
    expect(foreignRef).toEqual([]);
    const foreignRow = (
      await read('?reference=MIX-WALLET_TRANSFER-1012', 'FINANCE_AUDITOR').expect(200)
    ).body.items[0];
    await read('/WALLET_TRANSFER/' + foreignRow.id).expect(404);
    const detail = (await read('/WALLET_TRANSFER/' + ownRef[0].id, 'FINANCE_AUDITOR').expect(200))
      .body;
    expect(detail.journals.filter(Boolean)).toHaveLength(1);
    const filtered = (
      await read(
        '?type=BANK_TO_WALLET&status=VERIFIED&from=2026-11-02&to=2026-11-24&limit=100',
      ).expect(200)
    ).body.items;
    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.every(
        (r: { type: string; status: string; createdAt: string }) =>
          r.type === 'BANK_TO_WALLET' &&
          r.status === 'VERIFIED' &&
          r.createdAt >= '2026-11-01T23:00:00.000Z' &&
          r.createdAt < '2026-11-24T23:00:00.000Z',
      ),
    ).toBe(true);
    expect(
      await dataSource.query(
        'SELECT id,email,password_hash FROM local_admin_credentials ORDER BY id',
      ),
    ).toEqual(credentials);
    expect(
      await dataSource.query('SELECT * FROM authorization_role_functions ORDER BY id'),
    ).toEqual(grants);
    writeFileSync(
      resolve(out, 'results.json'),
      JSON.stringify(
        {
          workingTreeClean: !execFileSync('git', ['status', '--porcelain'], {
            encoding: 'utf8',
          }).trim(),
          testedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          harnessSha256: createHash('sha256')
            .update(readFileSync('test/transaction-history-mixed-volume.integration.spec.ts'))
            .digest('hex'),
          sourceSha256: createHash('sha256')
            .update(readFileSync('src/admin/transaction-history.controller.ts'))
            .digest('hex'),
          schema: await dataSource.query('SELECT name FROM typeorm_migrations ORDER BY timestamp'),
          postgres: (await dataSource.query('SELECT version()'))[0],
          settings: await dataSource.query(
            `SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','effective_cache_size','random_page_cost','jit','max_parallel_workers_per_gather')`,
          ),
          dataProvenance: {
            mode: reuse
              ? 'clone of explicitly kept disposable seeded fixture, current-run owned database'
              : 'fresh full migration and seed',
            source: reuse || null,
          },
          fixture:
            'Synthetic 90300 rows / 9 types / 4 institutions skew 60:25:10:5 for institutional volume; 300 native platform records; no production histogram supplied; all constraints/triggers enabled; actual execution only for native agent/outbound minority, bulk read-model records not execution certification',
          distribution,
          plans,
          validations,
          assertions: [
            'exact reference AND scoped detail foreign404',
            'type/status/Lagos bounds AND',
            '1000-row paging per real session matches full ordering including ties and microseconds',
            'ledger journal IDs preserved',
            'all11 exact passwords authenticate; hashes and role-function grants unchanged',
          ],
        },
        null,
        2,
      ),
    );
  }, 600000);
});
