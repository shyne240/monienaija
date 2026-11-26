/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import type { Browser, Page } from 'playwright';

import { AppModule } from '../src/app.module';
import { AuditService } from '../src/operations/audit.service';
import { OutboxService } from '../src/operations/outbox.service';
import { LedgerService } from '../src/ledger/ledger.service';
import type { SettlementAccountService } from '../src/payment/settlement-account.service';
import { FeeRuleCalculatorService } from '../src/fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../src/fee-rules/fee-rule-resolver.service';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import type { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import type { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { WITHDRAWAL_EXECUTION_AUTHORITY } from '../src/financial-commitment/withdrawal-execution-authority';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { PrivilegedActionApproval } from '../src/authorization/privileged-action-approval.entity';
import { PrivilegedActionApprovalService } from '../src/authorization/privileged-action-approval.service';
import { ProtectedAuthorityService } from '../src/authorization/protected-authority.service';
import type { AuthorizationService } from '../src/authorization/authorization.service';
import { BankingInboundService } from '../src/banking/banking-inbound.service';
import { BankingProviderRegistry } from '../src/banking/banking-provider.registry';
import type { MonnifyHttpClient } from '../src/banking/monnify/monnify.http';
import { MonnifyProvider } from '../src/banking/monnify/monnify.provider';
import { BankToWalletExceptionService } from '../src/banking/bank-to-wallet-exception.service';
import { BankToWalletService } from '../src/banking/bank-to-wallet.service';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { createKycAuthorityConnectionsOverTcp } from './support/kyc-authority-tcp';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const seed = require('../scripts/local-dev-seed-11-roles.js');
const kyc = createTestEvidenceReader({ mode: 'ELIGIBLE' });

/**
 * PR #23 merged into the integration tip still derives BANK_TO_WALLET history status from legacy
 * float receipts. This suite posts a REAL Bank-to-Wallet credit through the #40 service and proves
 * the combined tree exposes that credit once, with the immutable bank-intake UUID, its business
 * reference and its actual credit journal. Pending and return-authorised payments are never
 * reported as credited. Ledger and institution permissions remain enforced end to end.
 *
 * Browser execution is opt-in because it needs the Admin Web Vite process and Chromium. HTTP and
 * database assertions always run against a disposable, fully migrated PostgreSQL database.
 */
describe('Bank to Wallet History compatibility with merged PR #23', () => {
  let db: DataSource;
  let app: NestFastifyApplication;
  let fixture: GovernedFinancialFixture;
  let service: BankToWalletService;
  let institutionId: string;
  let walletId: string;
  let virtualAccountId: string;
  let accountNumber: string;
  let accountReference: string;
  let providerReference: string;
  let approvals: PrivilegedActionApprovalService;
  let connections: Awaited<ReturnType<typeof createKycAuthorityConnectionsOverTcp>>;
  let credited: {
    businessReference: string;
    intakeId: string;
    journalId: string;
    amountMinor: string;
  };
  let pendingReference: string;
  let returnedReference: string;
  let sessions: Record<string, { accessToken: string; principal: { principalId: string } }>;
  const oldEnv = { ...process.env };
  let browser: Browser | undefined;
  const browserChecks: string[] = [];
  const screenshots: string[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    db = await createIntegrationDataSource('b2whist');
    connections = await createKycAuthorityConnectionsOverTcp(db);
    approvals = new PrivilegedActionApprovalService(
      db.getRepository(PrivilegedActionApproval),
      db.getRepository(SecurityEventHistory),
      connections.runtime,
      new AuditService(db.getRepository(AuditEvent)),
      { authorize: () => Promise.resolve({ allowed: true }) } as unknown as AuthorizationService,
      new ProtectedAuthorityService(db),
    );

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
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
    await seed.seedLocalRoles(db, app.get('A2_WORKFORCE_CONFIG'), app.get(AuditService));
    fixture = new GovernedFinancialFixture({ app, dataSource: db, label: 'b2whist' });
    institutionId = (await fixture.createInstitution()).id;

    const customerId = randomUUID();
    await db.query(
      `INSERT INTO customers (id,reference,customer_type,status,kyc_level,kyc_status,is_synthetic)
       VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_2','APPROVED',false)`,
      [customerId, `b2whist-${randomUUID().slice(0, 8)}`],
    );
    await fixture.makeCustomerEligible(customerId, kyc);
    await fixture.enrolCustomer(customerId, institutionId);
    const wallet = await fixture.createWallet(customerId);
    await fixture.attributeWallet(wallet.walletId, institutionId);
    walletId = wallet.walletId;

    // The frozen virtual-account constraints require digits-only number and `MN<digits>` reference.
    const digits = `${institutionId.replace(/[^0-9]/g, '')}${Date.now()}`;
    accountNumber = `62${digits.slice(0, 10)}`;
    accountReference = `MN${digits.slice(0, 16)}`;
    virtualAccountId = randomUUID();
    await db.query(
      `INSERT INTO virtual_accounts (id,wallet_id,bank_code,account_number,account_name,provider,status,reference,assigned_at)
       VALUES ($1,$2,'50515',$3,'Synthetic Bank to Wallet account','MONNIFY','ACTIVE',$4,clock_timestamp())`,
      [virtualAccountId, walletId, accountNumber, accountReference],
    );
    await db.query(
      `INSERT INTO products (code,name,domain,currency,enabled,status,created_by)
       VALUES ('BANK_TO_WALLET','Bank to wallet','CUSTOMER','NGN',true,'ACTIVE','synthetic-fixture')
       ON CONFLICT (code) DO NOTHING`,
    );
    await db.query(
      `INSERT INTO fee_rules
         (product_code,currency,flat_fee_minor,percentage_bps,minimum_fee_minor,maximum_fee_minor,
          vat_bps,effective_from,is_active,created_by,priority)
       VALUES ('BANK_TO_WALLET','NGN',0,0,0,NULL,0,now() - interval '1 hour',true,'synthetic-fixture',100)`,
    );

    const http: MonnifyHttpClient = {
      send: (request) => {
        if (request.path === '/api/v1/auth/login') {
          return Promise.resolve({
            status: 200,
            body: {
              requestSuccessful: true,
              responseCode: '0',
              responseBody: { accessToken: 'synthetic-token', expiresIn: 3600 },
            },
          });
        }
        if (request.path.startsWith('/api/v2/merchant/transactions/query')) {
          return Promise.resolve({
            status: 200,
            body: {
              requestSuccessful: true,
              responseCode: '0',
              responseBody: {
                transactionReference: providerReference,
                paymentReference: accountReference,
                amountPaid: 10000,
                settlementAmount: 9825,
                fee: 175,
                currencyCode: 'NGN',
                paymentStatus: 'PAID',
                paymentMethod: 'ACCOUNT_TRANSFER',
                paidOn: new Date().toISOString(),
                paymentSourceInformation: [
                  { bankCode: '058', accountNumber: '0123456789', accountName: 'Payer' },
                ],
              },
            },
          });
        }
        return Promise.resolve({
          status: 400,
          body: {
            requestSuccessful: false,
            responseCode: '99',
            responseMessage: 'unexpected path',
          },
        });
      },
    };
    const provider = new MonnifyProvider({
      environment: 'sandbox',
      contractCode: 'SYNTHETIC_CONTRACT',
      apiKey: 'synthetic-api-key',
      secretKey: 'synthetic-secret-key',
      http,
    });
    const registry = new BankingProviderRegistry();
    registry.register(provider);
    // Institution-scoped settlement asset: both journal legs must carry the same institutional
    // attribution, otherwise the real ledger boundary refuses a mixed-scope posting. The seeded
    // platform account is deliberately left untouched.
    const settlementLedgerId = randomUUID();
    await db.query(
      `INSERT INTO ledger_accounts
         (id,code,name,account_type,normal_balance,currency,accounting_unit,is_active,
          institutional_scope,institution_id,institutional_purpose)
       VALUES ($1,$2,'Bank to Wallet settlement asset','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',true,
               'INSTITUTION',$3,'SETTLEMENT')`,
      [settlementLedgerId, `B2WH_SETTLEMENT_${Date.now()}`, institutionId],
    );
    const limits = {
      enforceWithManager: () =>
        Promise.resolve({
          allowed: true,
          limitProfileCode: 'B2W_HISTORY_PROFILE',
          evaluatedDimensions: [],
          ruleRefs: [],
        }),
    } as unknown as LimitEnforcementService;
    const eligibility = {
      require: () => Promise.resolve('LEVEL_2' as const),
    } as unknown as CustomerFinancialEligibilityService;
    const boundary = new WalletFinancialBoundaryService(eligibility);
    const ledger = app.get(LedgerService);
    const settlementAccounts = {
      getAccountId: () => Promise.resolve(settlementLedgerId),
    } as unknown as SettlementAccountService;
    const exceptions = new BankToWalletExceptionService(db, approvals, ledger, settlementAccounts);
    service = new BankToWalletService(
      db,
      new BankingInboundService(db, registry),
      registry,
      exceptions,
      app.get(FeeRuleResolverService),
      app.get(FeeRuleCalculatorService),
      limits,
      boundary,
      ledger,
      settlementAccounts,
      app.get(AuditService),
      app.get(OutboxService),
      new ConfigService<Record<string, unknown>, true>({
        BANK_TO_WALLET_ENABLED: true,
        BANKING_ENVIRONMENT: 'sandbox',
      } as never),
    );

    sessions = {};
    for (const role of ['OPERATIONS', 'FINANCE_AUDITOR'] as const) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/internal/a2/workforce/local-admin-sessions')
        .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
        .expect(201);
      sessions[role] = response.body;
      await fixture.grantWorkforceScope(institutionId, response.body.principal.principalId);
    }

    const intake = (transactionReference: string) => {
      providerReference = transactionReference;
      return {
        institutionId,
        providerKey: 'MONNIFY',
        environment: 'sandbox' as const,
        providerTransactionReference: transactionReference,
        providerPaymentReference: accountReference,
        reservationId: null,
        receivingAccountNumber: accountNumber,
        receivingBankCode: '50515',
        currency: 'NGN',
        grossAmountMinor: '1000000',
        providerFeeMinor: '17500',
        paidAt: new Date().toISOString(),
      };
    };
    const paid = await service.intake(intake(`MNFY|HIST|${randomUUID().slice(0, 12)}`));
    const posted = await service.verifyAndPost({
      businessReference: paid.businessReference,
      correlationId: 'b2w-history-compat',
    });
    if (posted.status !== 'CREDITED') throw new Error(`Expected CREDITED, got ${posted.status}`);
    const [row] = await db.query<Array<{ id: string; journal_id: string; amount_minor: string }>>(
      `SELECT id,(SELECT journal_id FROM bank_to_wallet_credits WHERE inbound_payment_id=b.id) AS journal_id,
              (SELECT amount_minor FROM bank_to_wallet_credits WHERE inbound_payment_id=b.id)::text AS amount_minor
         FROM banking_inbound_payments b WHERE business_reference=$1`,
      [paid.businessReference],
    );
    credited = {
      businessReference: paid.businessReference,
      intakeId: row!.id,
      journalId: row!.journal_id,
      amountMinor: row!.amount_minor,
    };

    const pending = await service.intake(intake(`MNFY|PENDING|${randomUUID().slice(0, 12)}`));
    pendingReference = pending.businessReference;
    const returned = await service.intake(intake(`MNFY|RETURNED|${randomUUID().slice(0, 12)}`));
    returnedReference = returned.businessReference;
    await db.query(
      `INSERT INTO bank_to_wallet_exceptions
         (id,business_reference,institution_id,provider_key,environment,provider_transaction_reference,
          provider_payment_reference,receiving_account_number,currency,gross_amount_minor,provider_fee_minor,
          reason,state,permitted_next_action,evidence)
       VALUES ($1,$2,$3,'MONNIFY','sandbox',$4,$5,$6,'NGN',1000000,17500,
               'LIMIT_BLOCKED','APPROVED_FOR_RETURN','RETURN_AUTHORIZED_ONLY',$7::jsonb)`,
      [
        randomUUID(),
        returnedReference,
        institutionId,
        `MNFY|RETURNED|${randomUUID().slice(0, 12)}`,
        accountReference,
        accountNumber,
        JSON.stringify({ note: 'Synthetic return-authorised fixture; no provider payout' }),
      ],
    );
    await db.query(
      `UPDATE banking_inbound_payments
          SET verification_state='VERIFIED',resolution_state='EXCEPTION',
              exception_id=(SELECT id FROM bank_to_wallet_exceptions WHERE business_reference=$2)
        WHERE business_reference=$1`,
      [returnedReference, returnedReference],
    );
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    if (db?.isInitialized) await destroyIntegrationDataSource(db);
    process.env = oldEnv;
  }, 60_000);

  const read = (path: string, role: 'OPERATIONS' | 'FINANCE_AUDITOR' = 'FINANCE_AUDITOR') =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + sessions[role]!.accessToken);

  it('posts through #40 and shows one CREDITED Bank to Wallet row with canonical IDs and journal', async () => {
    const list = await read(
      '/api/v1/internal/admin/transaction-history?type=BANK_TO_WALLET&status=CREDITED&reference=' +
        encodeURIComponent(credited.businessReference),
    ).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: credited.intakeId,
      type: 'BANK_TO_WALLET',
      status: 'CREDITED',
      reference: credited.businessReference,
      amountMinor: credited.amountMinor,
    });

    const detail = await read(
      `/api/v1/internal/admin/transaction-history/BANK_TO_WALLET/${credited.intakeId}`,
    ).expect(200);
    expect(detail.body).toMatchObject({
      id: credited.intakeId,
      type: 'BANK_TO_WALLET',
      status: 'CREDITED',
      reference: credited.businessReference,
      institutionId,
      journals: [credited.journalId],
    });
    expect(detail.body.investigation).toMatchObject({
      businessReference: credited.businessReference,
      postingState: 'DIRECT_CREDIT_JOURNAL',
      identitySource: 'BANK_INTAKE',
    });
    expect(detail.body.investigation.floatReceiptId).toBeNull();

    const journal = await read(
      `/api/v1/internal/finance-operations/ledger/journals/${credited.journalId}`,
    ).expect(200);
    expect(journal.body.source).toMatchObject({
      type: 'BANK_TO_WALLET',
      id: credited.intakeId,
      status: 'CREDITED',
      linkedBy: 'DIRECT_CREDIT_JOURNAL',
      navigable: true,
    });
  });

  it('does not report pending or return-authorised payments as credited', async () => {
    for (const reference of [pendingReference, returnedReference]) {
      const creditedList = await read(
        '/api/v1/internal/admin/transaction-history?type=BANK_TO_WALLET&status=CREDITED&reference=' +
          encodeURIComponent(reference),
      ).expect(200);
      expect(creditedList.body.items).toEqual([]);
    }
    const pendingList = await read(
      '/api/v1/internal/admin/transaction-history?type=BANK_TO_WALLET&status=UNVERIFIED&reference=' +
        encodeURIComponent(pendingReference),
    ).expect(200);
    expect(pendingList.body.items).toHaveLength(1);
    expect(pendingList.body.items[0]).toMatchObject({
      status: 'UNVERIFIED',
      reference: pendingReference,
    });
    const returnedList = await read(
      '/api/v1/internal/admin/transaction-history?type=BANK_TO_WALLET&reference=' +
        encodeURIComponent(returnedReference),
    ).expect(200);
    expect(returnedList.body.items).toHaveLength(1);
    expect(returnedList.body.items[0].status).not.toBe('CREDITED');
  });

  it('preserves institution scoping, ledger.view and all 11 workforce credentials', async () => {
    const credentialsBefore = await db.query(
      'SELECT id,email,password_hash FROM local_admin_credentials ORDER BY id',
    );
    const grantsBefore = await db.query('SELECT * FROM authorization_role_functions ORDER BY id');
    expect(credentialsBefore).toHaveLength(11);

    // Same institution, no ledger.view: the detail resolves but no journal id is exposed.
    const restricted = await read(
      `/api/v1/internal/admin/transaction-history/BANK_TO_WALLET/${credited.intakeId}`,
      'OPERATIONS',
    ).expect(200);
    expect(restricted.body.journals).toBeNull();
    await read(
      `/api/v1/internal/finance-operations/ledger/journals/${credited.journalId}`,
      'OPERATIONS',
    ).expect(403);

    // Foreign institution: same 404 empty result and detail, no cross-institution disclosure.
    const foreignId = randomUUID();
    const foreignCode = `FOREIGN_${foreignId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
    await db.query(
      `INSERT INTO financial_institutions (id,reference,code,legal_name,institution_type,created_by,status)
       VALUES ($1,$2,$3,'Foreign institution','PARTNER','synthetic-fixture','REGISTERED')`,
      [foreignId, `FOREIGN-${foreignId.slice(0, 8)}`, foreignCode],
    );
    await db.query(
      `UPDATE workforce_institution_assignments SET status='REVOKED',revoked_by='synthetic-fixture',
         revoked_at=clock_timestamp() WHERE principal_id=$1 AND institution_id=$2`,
      [sessions.OPERATIONS!.principal.principalId, institutionId],
    );
    const foreignLogin = await request(app.getHttpServer())
      .post('/api/v1/internal/a2/workforce/local-admin-sessions')
      .send({ email: seed.emailFor('OPERATIONS'), password: seed.passwordFor('OPERATIONS') })
      .expect(201);
    const foreignList = await request(app.getHttpServer())
      .get(
        '/api/v1/internal/admin/transaction-history?type=BANK_TO_WALLET&status=CREDITED&reference=' +
          encodeURIComponent(credited.businessReference),
      )
      .set('Authorization', 'Bearer ' + foreignLogin.body.accessToken)
      .expect(200);
    expect(foreignList.body.items).toEqual([]);
    await request(app.getHttpServer())
      .get(`/api/v1/internal/admin/transaction-history/BANK_TO_WALLET/${credited.intakeId}`)
      .set('Authorization', 'Bearer ' + foreignLogin.body.accessToken)
      .expect(404);

    expect(
      await db.query('SELECT id,email,password_hash FROM local_admin_credentials ORDER BY id'),
    ).toEqual(credentialsBefore);
    expect(await db.query('SELECT * FROM authorization_role_functions ORDER BY id')).toEqual(
      grantsBefore,
    );
  });

  it('drives the real Admin Web History → journal → same-transaction round trip in a browser', async () => {
    if (process.env.HISTORY_COMPAT_BROWSER !== 'yes') {
      browserChecks.push('browser execution not requested (HISTORY_COMPAT_BROWSER=yes)');
      return;
    }
    const out = resolve(
      process.env.HISTORY_COMPAT_OUT ||
        'docs/integration/evidence/bank-to-wallet-history-compatibility',
    );
    mkdirSync(out, { recursive: true });
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
      executablePath: process.env.HISTORY_COMPAT_CHROMIUM_PATH || binary.path,
      args: binary.args.filter((arg: string) => arg !== '--single-process'),
      headless: true,
    });
    const origin = process.env.HISTORY_COMPAT_ORIGIN || 'http://127.0.0.1:5173';
    const context = await browser!.newContext({ viewport: { width: 1512, height: 982 } });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByPlaceholder('Workforce email').fill(seed.emailFor('FINANCE_AUDITOR'));
    await page.getByPlaceholder('••••••••••••').fill(seed.passwordFor('FINANCE_AUDITOR'));
    await page.getByRole('button', { name: 'Sign in', exact: false }).click();
    await page.getByTestId('section-money').waitFor();

    const filter = async (status: string, reference: string) => {
      await page.goto(origin);
      await page.getByTestId('section-money').click();
      await page.getByTestId('nav-transfers').click();
      await page
        .getByRole('combobox', { name: 'Transaction type', exact: true })
        .selectOption('BANK_TO_WALLET');
      await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption(status);
      await page.getByPlaceholder('Enter a transaction reference').fill(reference);
      const loaded = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          url.pathname === '/api/v1/internal/admin/transaction-history' &&
          url.searchParams.get('type') === 'BANK_TO_WALLET' &&
          url.searchParams.get('status') === status &&
          url.searchParams.get('reference') === reference
        );
      });
      await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
      await loaded;
      await page
        .getByText('Loading transaction history…', { exact: true })
        .waitFor({ state: 'hidden' });
    };
    const shot = async (name: string, target: Page = page) => {
      await target.screenshot({ path: resolve(out, name + '.png'), fullPage: true });
      screenshots.push(name + '.png');
    };

    await filter('CREDITED', credited.businessReference);
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText(credited.businessReference, { exact: true }) });
    expect(await row.count()).toBe(1);
    await row.getByText('CREDITED', { exact: true }).waitFor();
    await shot('1-credited-list');
    expect(await row.getByRole('link', { name: 'View details' }).getAttribute('href')).toBe(
      `#transaction-history/BANK_TO_WALLET/${credited.intakeId}`,
    );
    await row.getByRole('link', { name: 'View details' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: credited.businessReference, exact: true }).waitFor();
    await dialog.getByText(credited.journalId, { exact: true }).waitFor();
    await shot('2-credited-detail');

    await dialog.getByRole('button', { name: 'Open journal', exact: true }).click();
    await page.getByText('Journal Entry Details', { exact: true }).waitFor();
    const source = page.getByTestId('ledger-journal-source');
    await source.waitFor();
    await source.getByText('Bank to Wallet', { exact: false }).waitFor();
    const back = page.getByTestId('open-unified-transaction-detail');
    expect(await back.getAttribute('href')).toBe(
      `#transaction-history/BANK_TO_WALLET/${credited.intakeId}`,
    );
    await shot('3-credit-journal');

    await back.click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: credited.businessReference, exact: true }).waitFor();
    await dialog.getByText('CREDITED', { exact: true }).waitFor();
    expect(page.url()).toBe(origin + `/#transaction-history/BANK_TO_WALLET/${credited.intakeId}`);
    await shot('4-returned-to-same-transaction');
    browserChecks.push(
      'CREDITED History row → exact intake UUID → Open journal → same-transaction return link',
    );

    for (const [label, reference, status] of [
      ['pending', pendingReference, 'CREDITED'],
      ['return-authorised', returnedReference, 'CREDITED'],
    ] as const) {
      await filter(status, reference);
      const rows = page
        .getByRole('row')
        .filter({ has: page.getByText(reference, { exact: true }) });
      expect(await rows.count()).toBe(0);
      await shot(`5-${label}-not-credited`);
      browserChecks.push(`${label} payment absent from CREDITED History in the browser`);
    }

    const results = {
      testedSha: process.env.HISTORY_COMPAT_TESTED_SHA || 'uncommitted working tree',
      integrationTip: process.env.HISTORY_COMPAT_BASE_SHA || null,
      credited,
      pendingReference,
      returnedReference,
      institutionId,
      checks: browserChecks,
      screenshots,
      credentialsUnchanged: true,
      productionFlags: { BANK_TO_WALLET_ENABLED: false, BANK_TO_WALLET_PRODUCTION_ENABLED: false },
    };
    writeFileSync(resolve(out, 'results.json'), JSON.stringify(results, null, 2));
    await browser!.close();
    browser = undefined;
  });
});
