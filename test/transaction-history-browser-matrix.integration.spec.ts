/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports */
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID, randomBytes, pbkdf2Sync, createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser, Page } from 'playwright';
import * as request from 'supertest';
import { formatFinancialAmount } from '../apps/admin-web/src/utils/financial-display';
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
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import {
  AgentFundingGovernanceTestFacade,
  agentNetworkManagerPrincipal,
  financeControllerPrincipal,
} from './support/agent-funding-governance';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';

const seed = require('../scripts/local-dev-seed-11-roles.js');
const kyc = createTestEvidenceReader({ mode: 'ELIGIBLE' });
function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${pbkdf2Sync(pin, salt, 10000, 32, 'sha256').toString('base64url')}`;
}

// Explicitly opt in; normal PG runs still exercise fixture setup and HTTP acceptance, but
// browser execution requires Vite plus the supplied Chromium binary. No synthetic auth adapter.
describe('Transaction History five-product real-workforce browser matrix', () => {
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
    dataSource = await createIntegrationDataSourceFromScratch('historybrowser');
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
    institutionId = (await fixture.createInstitution()).id;
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

  it('finds, opens and reopens all five products with scoped Customer Funding and platform agent denial', async () => {
    const out = resolve(
      process.env.HISTORY_MATRIX_OUT ||
        (process.env.HISTORY_MATRIX_BROWSER === 'yes'
          ? 'docs/transaction-history/evidence/browser-matrix'
          : 'data/validation/transaction-history-http-matrix'),
    );
    mkdirSync(out, { recursive: true });
    const credentialsBefore = await dataSource.query(
      'SELECT id,email,password_hash FROM local_admin_credentials ORDER BY id',
    );
    const grantsBefore = await dataSource.query(
      'SELECT * FROM authorization_role_functions ORDER BY id',
    );
    const sessions: Record<string, { accessToken: string; principal: { principalId: string } }> =
      {};
    for (const role of seed.ROLES) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/internal/a2/workforce/local-admin-sessions')
        .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
        .expect(201);
      sessions[role] = response.body;
    }
    expect(credentialsBefore).toHaveLength(11);
    const ops = sessions.OPERATIONS!;
    await fixture.grantWorkforceScope(institutionId, ops.principal.principalId);
    const foreign = await fixture.createInstitution();
    // Real reserved outbound, with the existing controlled sandbox execution authority only.
    const { agent } = await createActiveAgentWithPin(
      [
        AgentService.EXTERNAL_BANK_TRANSFER,
        AgentService.AGENT_FUNDING,
        AgentService.AGENT_DEFUNDING,
      ],
      '1234',
    );
    const beneficiaryId = await createAgentBeneficiary(agent.id);
    await configureAgentLimit(agent.id);
    const outbound = await service.initiateForAgent({
      agentId: agent.id,
      agentSessionId: agentSessions.get(agent.id)!,
      principal: agentPrincipal(agent.id),
      pin: '1234',
      amountMinor: '500',
      currency: 'NGN',
      beneficiaryId,
      idempotencyKey: randomUUID(),
    });
    // Platform funding rails stay unchanged; request approval/execution uses the accepted domain fixture.
    const agentFunding = new AgentFundingGovernanceTestFacade(
      app.get(AgentFundingService),
      app.get(PrivilegedActionApprovalService),
    );
    const agentCommand = {
      agentId: agent.id,
      amountMinor: '1000',
      currency: 'NGN',
      principal: agentNetworkManagerPrincipal(),
      actor: 'synthetic-browser-fixture',
    };
    await agentFunding.fund({
      ...agentCommand,
      idempotencyKey: 'matrix-fund-' + randomUUID(),
      reference: 'MATRIX-AGENT-FUND',
    });
    await agentFunding.defund({
      ...agentCommand,
      amountMinor: '500',
      idempotencyKey: 'matrix-defund-' + randomUUID(),
      reference: 'MATRIX-AGENT-DEFUND',
    });
    const [fund] = await dataSource.query(
      "SELECT id FROM agent_funding_requests WHERE reference='MATRIX-AGENT-FUND'",
    );
    const [defund] = await dataSource.query(
      "SELECT id FROM agent_funding_requests WHERE reference='MATRIX-AGENT-DEFUND'",
    );
    const [customer] = await dataSource.query(
      `INSERT INTO customers(reference,customer_type,status,kyc_level,kyc_status)
      VALUES($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      ['matrix-' + randomUUID()],
    );
    await fixture.makeCustomerEligible(customer.id, kyc);
    await fixture.enrolCustomer(customer.id, institutionId);
    const wallet = await fixture.createWallet(customer.id);
    await fixture.attributeWallet(wallet.walletId, institutionId);
    const funding = app.get(CustomerFundingService);
    const pending = await funding.createRequest({
      customerId: customer.id,
      amountMinor: '12500',
      currency: 'NGN',
      idempotencyKey: 'matrix-customer-pending-' + randomUUID(),
      principal: agentNetworkManagerPrincipal(),
    });
    const rejected = await funding.createRequest({
      customerId: customer.id,
      amountMinor: '15000',
      currency: 'NGN',
      idempotencyKey: 'matrix-customer-rejected-' + randomUUID(),
      principal: agentNetworkManagerPrincipal(),
    });
    await funding.reject({
      fundingRequestId: rejected.id,
      principal: financeControllerPrincipal(),
      rejectionReason: 'Synthetic acceptance rejection; no funds moved',
    });
    const [inbound] = await dataSource.query(
      `INSERT INTO banking_inbound_payments
      (institution_id,provider_key,environment,provider_transaction_reference,currency,gross_amount_minor,provider_fee_minor,credited_amount_minor)
      VALUES($1,'MONNIFY','sandbox','MATRIX-BANK-TO-WALLET','NGN',10000,100,9900) RETURNING id`,
      [institutionId],
    );
    const base = '/api/v1/internal/admin/transaction-history';
    const read = (path: string, session = ops) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer ' + session.accessToken);
    const matrix = [
      {
        type: 'WALLET_TO_BANK',
        label: 'Wallet to Bank',
        id: outbound.commitment.id,
        status: 'RESERVED',
        role: 'FINANCE_AUDITOR',
        reference: '',
      },
      {
        type: 'CUSTOMER_FUNDING',
        label: 'Customer Funding',
        id: pending.id,
        status: 'PENDING',
        role: 'OPERATIONS',
        reference: pending.reference,
      },
      {
        type: 'CUSTOMER_FUNDING',
        label: 'Customer Funding',
        id: rejected.id,
        status: 'REJECTED',
        role: 'OPERATIONS',
        reference: rejected.reference,
      },
      {
        type: 'AGENT_FUNDING',
        label: 'Agent Funding',
        id: fund.id,
        status: 'EXECUTED',
        role: 'FINANCE_AUDITOR',
        reference: 'MATRIX-AGENT-FUND',
      },
      {
        type: 'AGENT_DEFUNDING',
        label: 'Agent Defunding',
        id: defund.id,
        status: 'EXECUTED',
        role: 'FINANCE_AUDITOR',
        reference: 'MATRIX-AGENT-DEFUND',
      },
      {
        type: 'BANK_TO_WALLET',
        label: 'Bank to Wallet',
        id: inbound.id,
        status: 'UNVERIFIED',
        role: 'FINANCE_AUDITOR',
        reference: 'MATRIX-BANK-TO-WALLET',
      },
    ];
    const details: {
      feeMinor: string | null;
      journals: (string | null)[] | null;
      [key: string]: unknown;
    }[] = [];
    for (const entry of matrix) {
      const result = await read(`${base}/${entry.type}/${entry.id}`, sessions[entry.role]).expect(
        200,
      );
      entry.reference = result.body.reference;
      expect(result.body).toMatchObject({ id: entry.id, type: entry.type, status: entry.status });
      expect(
        (
          await read(
            `${base}?type=${entry.type}&status=${entry.status}&reference=${encodeURIComponent(entry.reference)}`,
            sessions[entry.role],
          ).expect(200)
        ).body.items,
      ).toHaveLength(1);
      details.push(result.body);
    }
    for (const entry of matrix.filter((x) => x.type.startsWith('AGENT_'))) {
      await read(`${base}/${entry.type}/${entry.id}`).expect(404);
      expect((await read(`${base}?reference=${entry.reference}`).expect(200)).body.items).toEqual(
        [],
      );
    }
    const screenshots: string[] = [];
    const browserChecks: string[] = [];
    if (process.env.HISTORY_MATRIX_BROWSER === 'yes') {
      await app.listen(3099, '0.0.0.0');
      const binary = JSON.parse(
        spawnSync(
          process.execPath,
          [
            '-e',
            "const c=require('@sparticuz/chromium').default;c.executablePath().then(path=>console.log(JSON.stringify({path,args:c.args})))",
          ],
          { encoding: 'utf8' },
        ).stdout,
      );
      const { chromium } = require('playwright');
      browser = await chromium.launch({
        executablePath: process.env.HISTORY_MATRIX_CHROMIUM_PATH || binary.path,
        args: binary.args.filter((arg: string) => arg !== '--single-process'),
        headless: true,
      });
      const origin = process.env.HISTORY_MATRIX_ORIGIN || 'http://127.0.0.1:5173';
      const signIn = async (role: string) => {
        const context = await browser!.newContext({ viewport: { width: 1512, height: 982 } });
        const page = await context.newPage();
        await page.goto(origin);
        await page.getByPlaceholder('Workforce email').fill(seed.emailFor(role));
        await page.getByPlaceholder('••••••••••••').fill(seed.passwordFor(role));
        await page.getByRole('button', { name: 'Sign in', exact: false }).click();
        await page.getByTestId('section-money').waitFor();
        return page;
      };
      const opsPage = await signIn('OPERATIONS');
      const auditPage = await signIn('FINANCE_AUDITOR');
      const shot = async (page: Page, name: string) => {
        await page.screenshot({ path: resolve(out, name + '.png'), fullPage: true });
        screenshots.push(name + '.png');
      };
      for (const [index, entry] of matrix.entries()) {
        const page = entry.role === 'OPERATIONS' ? opsPage : auditPage;
        await page.goto(origin);
        await page.getByTestId('section-money').click();
        await page.getByTestId('nav-transfers').click();
        await page
          .getByRole('combobox', { name: 'Transaction type', exact: true })
          .selectOption(entry.type);
        await page
          .getByRole('combobox', { name: 'Status', exact: true })
          .selectOption(entry.status);
        await page.getByPlaceholder('Enter a transaction reference').fill(entry.reference);
        await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
        const row = page
          .getByRole('row')
          .filter({ has: page.getByText(entry.reference, { exact: true }) });
        await row.getByText(entry.label, { exact: true }).waitFor();
        await row.getByText(entry.status, { exact: true }).waitFor();
        expect(await row.count()).toBe(1);
        await shot(page, `${index}-${entry.type}-${entry.status}-list`);
        const hash = `#transaction-history/${entry.type}/${entry.id}`;
        expect(await row.getByRole('link', { name: 'View details' }).getAttribute('href')).toBe(
          hash,
        );
        await row.getByRole('link', { name: 'View details' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('heading', { name: entry.reference, exact: true }).waitFor();
        await dialog.getByText(entry.label, { exact: true }).waitFor();
        await dialog.getByText(entry.status, { exact: true }).waitFor();
        if (entry.type === 'CUSTOMER_FUNDING')
          await dialog
            .getByText('Ledger information requires ledger.view.', { exact: true })
            .waitFor();
        if (details[index]!.feeMinor == null)
          await dialog
            .locator('div')
            .filter({ has: page.locator('dt', { hasText: /^Fee$/ }) })
            .last()
            .getByText('Not recorded', { exact: true })
            .waitFor();
        if (details[index]!.feeMinor != null) {
          await dialog
            .locator('dl > div')
            .filter({ has: page.locator('dt', { hasText: /^Fee$/ }) })
            .getByText(formatFinancialAmount(details[index]!.feeMinor, 'NGN'), {
              exact: true,
            })
            .waitFor();
        }
        for (const journal of details[index]!.journals || []) {
          if (journal) await dialog.getByText(journal, { exact: true }).waitFor();
        }
        if (entry.type === 'BANK_TO_WALLET')
          await dialog.getByText('No journal recorded.', { exact: true }).waitFor();
        await shot(page, `${index}-${entry.type}-${entry.status}-detail`);
        const savedUrl = page.url();
        expect(savedUrl).toBe(origin + '/' + hash);
        await page.goto('about:blank');
        await page.goto(savedUrl);
        await page
          .getByRole('dialog')
          .getByRole('heading', { name: entry.reference, exact: true })
          .waitFor();
        await page.getByRole('dialog').getByText(entry.status, { exact: true }).waitFor();
        browserChecks.push(
          `${entry.role}: ${entry.label}/${entry.status} type+status+reference filters, one row, detail and saved URL reopened`,
        );
      }
      // Same institution-scoped local role: deny platform records in both list and saved URL.
      for (const entry of matrix.filter((x) => x.type.startsWith('AGENT_'))) {
        await opsPage.goto(origin);
        await opsPage.getByTestId('section-money').click();
        await opsPage.getByTestId('nav-transfers').click();
        await opsPage.getByPlaceholder('Enter a transaction reference').fill(entry.reference);
        await opsPage.getByRole('button', { name: 'Apply filters', exact: true }).click();
        await opsPage.getByText('No matching transactions', { exact: true }).waitFor();
        await opsPage.goto(origin + `/#transaction-history/${entry.type}/${entry.id}`);
        await opsPage.getByRole('dialog').getByRole('alert').waitFor();
        await shot(opsPage, `denied-${entry.type}`);
      }
      // Scope switch is synthetic fixture setup, not a role/grant/password change. Both sessions
      // re-resolve ACTIVE institution assignments on every request. Original institution revoked.
      await dataSource.query(
        `UPDATE workforce_institution_assignments SET status='REVOKED',revoked_by='test',revoked_at=clock_timestamp() WHERE principal_id=$1 AND institution_id=$2`,
        [ops.principal.principalId, institutionId],
      );
      await fixture.grantWorkforceScope(foreign.id, ops.principal.principalId);
      const foreignPage = await signIn('OPERATIONS');
      for (const entry of matrix.filter((x) => x.type === 'CUSTOMER_FUNDING')) {
        expect((await read(base + '?reference=' + entry.reference).expect(200)).body.items).toEqual(
          [],
        );
        await read(`${base}/${entry.type}/${entry.id}`).expect(404);
        await foreignPage.goto(origin);
        await foreignPage.getByTestId('section-money').click();
        await foreignPage.getByTestId('nav-transfers').click();
        await foreignPage.getByPlaceholder('Enter a transaction reference').fill(entry.reference);
        await foreignPage.getByRole('button', { name: 'Apply filters', exact: true }).click();
        await foreignPage.getByText('No matching transactions', { exact: true }).waitFor();
        await shot(foreignPage, `foreign-${entry.status}-empty`);
        await foreignPage.goto(origin + `/#transaction-history/${entry.type}/${entry.id}`);
        await foreignPage.getByRole('dialog').getByRole('alert').waitFor();
        await shot(foreignPage, `foreign-${entry.status}-detail-denied`);
      }
      browserChecks.push(
        'Institution OPERATIONS cannot list/open platform FUND/DEFUND',
        'Fresh OPERATIONS browser sign-in scoped only to foreign institution cannot list/open owner PENDING/REJECTED Customer Funding',
      );
      await browser!.close();
      browser = undefined;
    }
    expect(
      await dataSource.query(
        'SELECT id,email,password_hash FROM local_admin_credentials ORDER BY id',
      ),
    ).toEqual(credentialsBefore);
    expect(
      await dataSource.query('SELECT * FROM authorization_role_functions ORDER BY id'),
    ).toEqual(grantsBefore);
    const sourceSha256: Record<string, string> = {};
    for (const file of [
      'src/admin/transaction-history.controller.ts',
      'apps/admin-web/src/screens/authenticated/TransactionHistoryScreen.tsx',
      'test/transaction-history-browser-matrix.integration.spec.ts',
    ])
      sourceSha256[file] = createHash('sha256').update(readFileSync(file)).digest('hex');
    writeFileSync(
      resolve(out, 'results.json'),
      JSON.stringify(
        {
          result: 'PASS',
          executedAt: new Date().toISOString(),
          testedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          workingTreeClean: !execFileSync(
            'git',
            ['status', '--porcelain', '--untracked-files=no'],
            { encoding: 'utf8' },
          ).trim(),
          browser: process.env.HISTORY_MATRIX_BROWSER === 'yes',
          syntheticData: true,
          realWorkforceSignIn: process.env.HISTORY_MATRIX_BROWSER === 'yes',
          schemaHead: (
            await dataSource.query(
              'SELECT name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1',
            )
          )[0].name,
          boundaries: [
            'Controlled KYC and sandbox withdrawal authority; real ledger/reservation, governed custody, funding services, role sessions and guards',
            'No institutional funding execution; customer requests pending/rejected only',
            'Foreign-institution negative uses same OPERATIONS account after scoped assignment switch and fresh browser sign-in; no role grants/password changes',
          ],
          matrix,
          details,
          browserChecks,
          screenshots,
          passwords: 'all 11 exact fixture passwords authenticated; hashes unchanged',
          roleGrants: 'unchanged',
          sourceSha256,
        },
        null,
        2,
      ),
    );
  }, 240000);
});
