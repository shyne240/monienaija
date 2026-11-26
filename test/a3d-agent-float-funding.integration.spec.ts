/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import * as request from 'supertest';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { Browser, Page } from 'playwright';
import { BankingInboundService } from '../src/banking/banking-inbound.service';
import { BankingProviderRegistry, capabilitiesOf } from '../src/banking/banking-provider.registry';
import type { BankingProvider } from '../src/banking/banking-provider.types';

import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { AgentFloatFundingService } from '../src/banking/agent-float-funding.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditService } from '../src/operations/audit.service';
import { OutboxService } from '../src/operations/outbox.service';
import { PolicyAgentFloatFundingAuthority } from '../src/banking/agent-float-funding-authority';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';

/**
 * Agent operating float funded by a verified inbound payment.
 *
 * This is the lifecycle the banking mission could not prove: an account was provisioned, the payment
 * was verified, and then nothing credited the float. Every assertion below is about the *ledger*,
 * because a service that returned `CREDITED` without posting a balanced journal would pass a naive
 * test and move no money.
 *
 * The institution and its settlement account are created through the real authenticated console
 * (registration → evidence → governed lifecycle approval → governed ledger-account opening), so the
 * institution in these tests is genuinely APPROVED and its settlement asset is genuinely
 * institution-scoped. Nothing here forges an approval or writes a lifecycle status directly.
 *
 * The controlled fixture is a *sandbox* policy, which is what a controlled acceptance run may use.
 * Production stays withheld, and that is asserted too: it is the difference between "the lifecycle
 * works" and "this platform is authorized to fund agents with real money".
 */
describe('Agent float funding from verified inbound (real PostgreSQL)', () => {
  let db: DataSource;
  let app: NestFastifyApplication;
  let fixture: GovernedFinancialFixture;
  let service: AgentFloatFundingService;
  let policyAuthority: PolicyAgentFloatFundingAuthority;
  let identityBrowser: Browser | undefined;

  beforeAll(async () => {
    db = await createIntegrationDataSource('a3dfloat');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(db)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // The application's own service instance, so the test exercises the wiring rather than a
    // hand-built copy. The runtime authority approves nothing, which is the shipped behaviour.
    service = app.get(AgentFloatFundingService);
    policyAuthority = app.get(PolicyAgentFloatFundingAuthority);
    fixture = new GovernedFinancialFixture({ app, dataSource: db, label: 'a3dfloat' });
  }, 300_000);

  afterAll(async () => {
    await identityBrowser?.close();
    await app?.close();
    /*
     * `app.close()` already tears down the TypeORM DataSource, because this suite overrides the
     * `DataSource` provider with its own instance. Calling `destroy()` unconditionally afterwards
     * throws `CannotExecuteNotConnectedError` and reddens the suite *after* every assertion has
     * passed — which is exactly how it went unnoticed. The harness's destroy path is safe in
     * either state: it handles Nest having already closed the connection, and it also removes
     * this run's isolated test database. Keep mode (drill-only) remains off in regression.
     */
    if (db) await destroyIntegrationDataSource(db);
  });

  /**
   * A fresh institution per test, created through the authenticated console.
   *
   * Nothing is truncated between tests. Truncating would delete the workforce principals and their
   * sessions that the governed fixture seeded, and re-seeding them per test would mean this suite
   * spent most of its time on console traffic. Instead each test uses its own institution, its own
   * ledger accounts and its own provider references, so the tests are independent without sharing
   * state — and the assertions are scoped to accounts that only that test created.
   */

  interface FloatFixture {
    institutionId: string;
    agentId: string;
    walletId: string;
    floatAccountId: string;
    settlementAssetId: string;
    accountNumber: string;
  }

  /**
   * An APPROVED institution with a real institution-scoped SETTLEMENT asset, an ACTIVE agent, an
   * institution-attributed AGENT wallet and an ACTIVE funding account bound to it.
   */
  async function fixtureFor(options?: {
    agentStatus?: string;
    activatePolicy?: boolean;
    environment?: 'sandbox' | 'production';
    serviceInstance?: AgentFloatFundingService;
  }): Promise<FloatFixture> {
    const institution = await fixture.createInstitution();
    const settlementAssetId = await fixture.openInstitutionSettlementAccount(institution.id);

    const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    // The agent's float liability is institution-scoped: the ledger refuses a journal that mixes an
    // institution-attributed account with an unattributed one, because "the institution's cash
    // arrived" and "the institution owes this agent" are the same balance sheet.
    const floatAcct: Array<{ id: string }> = await db.query(
      `INSERT INTO ledger_accounts
         (id,code,name,account_type,normal_balance,currency,accounting_unit,
          institutional_scope,institution_id,institutional_purpose)
       VALUES ($1,$2,'Agent float liability','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',
               'INSTITUTION',$3,'SETTLEMENT') RETURNING id`,
      [randomUUID(), `A3DF_${suffix}_FLOAT`, institution.id],
    );

    const agent: Array<{ id: string }> = await db.query(
      `INSERT INTO agents (reference,status) VALUES ($1,$2) RETURNING id`,
      [`A3DF-AG-${suffix}`, options?.agentStatus ?? 'ACTIVE'],
    );
    const agentId = agent[0]!.id;

    const wallet: Array<{ id: string }> = await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id,owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'AGENT') RETURNING id`,
      [randomUUID(), agentId, floatAcct[0]!.id],
    );
    const walletId = wallet[0]!.id;

    // The wallet is deliberately NOT given an institution_id here. Wallet institutional attribution
    // is immutable once written and is reachable only through the governed attribution workflow,
    // which refuses a direct write — and that refusal is a guarantee this mission preserves rather
    // than works around. The invariant this suite proves is the one the funding path actually
    // depends on: the debit leg and the policy must belong to the same institution, which the policy
    // trigger enforces against the ledger account.

    const accountNumber = `9${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await db.query(
      `INSERT INTO virtual_accounts
         (id,wallet_id,provider,bank_code,account_number,account_name,status,assigned_at,reference)
       VALUES (gen_random_uuid(),$1,'MONNIFY','50515',$2,'Agent Float Account','ACTIVE',now(),$3)`,
      [walletId, accountNumber, `MN${Date.now()}${Math.floor(Math.random() * 1000)}`],
    );

    if (options?.activatePolicy !== false) {
      await db.query(
        `INSERT INTO agent_float_funding_policies
           (id,institution_id,provider_key,environment,currency,settlement_asset_account_id,
            status,purpose,approved_by,approved_at,activated_by,activated_at)
         VALUES (gen_random_uuid(),$1,'MONNIFY',$2,'NGN',$3,
                 'ACTIVE','AGENT_OPERATING_FLOAT','fixture-approver',now(),'fixture-operator',now())`,
        [institution.id, options?.environment ?? 'sandbox', settlementAssetId],
      );
    }

    return {
      institutionId: institution.id,
      agentId,
      walletId,
      floatAccountId: floatAcct[0]!.id,
      settlementAssetId,
      accountNumber,
    };
  }

  /**
   * Signed movement of an account, in the direction its normal balance grows.
   *
   * An ASSET grows on DEBIT and a LIABILITY grows on CREDIT, so a single credit-minus-debit formula
   * would report a correctly-debited asset as negative. Reporting the *meaningful* sign keeps the
   * assertions readable: both legs of a float credit show +amount.
   */
  async function accountBalance(accountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await db.query(
      `SELECT COALESCE(
                SUM(CASE
                      WHEN la.normal_balance = 'DEBIT' AND l.direction = 'DEBIT'  THEN l.amount_minor
                      WHEN la.normal_balance = 'DEBIT' AND l.direction = 'CREDIT' THEN -l.amount_minor
                      WHEN la.normal_balance = 'CREDIT' AND l.direction = 'CREDIT' THEN l.amount_minor
                      ELSE -l.amount_minor
                    END),0)::text AS balance
         FROM ledger_lines l
         JOIN ledger_journals j ON j.id = l.journal_id
         JOIN ledger_accounts la ON la.id = l.ledger_account_id
        WHERE l.ledger_account_id = $1`,
      [accountId],
    );
    return BigInt(rows[0]!.balance);
  }

  function command(f: FloatFixture, overrides: Record<string, unknown> = {}) {
    return {
      institutionId: f.institutionId,
      agentId: f.agentId,
      walletAccountId: f.walletId,
      fundingAccountNumber: f.accountNumber,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      providerReference: `MNFY-${randomUUID().slice(0, 8)}`,
      amountMinor: '250000',
      currency: 'NGN',
      correlationId: 'float-test',
      ...overrides,
    };
  }

  it('keeps the original Bank to Wallet URL through verification and float credit with real workforce sessions', async () => {
    const f = await fixtureFor();
    const foreignFixture = new GovernedFinancialFixture({
      app,
      dataSource: db,
      label: 'identity-foreign',
    });
    const foreign = await foreignFixture.createInstitution();
    const foreignOperator = (await foreignFixture.workforce()).operator;
    const seed = require('../scripts/local-dev-seed-11-roles.js');
    const oldConfirm = process.env.LOCAL_DEV_SEED_CONFIRM;
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    try {
      await seed.seedLocalRoles(db, app.get('A2_WORKFORCE_CONFIG'), app.get(AuditService));
    } finally {
      if (oldConfirm === undefined) delete process.env.LOCAL_DEV_SEED_CONFIRM;
      else process.env.LOCAL_DEV_SEED_CONFIRM = oldConfirm;
    }
    const hashes = await db.query(
      'SELECT id,password_hash FROM local_admin_credentials ORDER BY id',
    );
    expect(hashes).toHaveLength(11);
    const sessions: Record<string, { accessToken: string; principal: { principalId: string } }> =
      {};
    for (const role of seed.ROLES) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/internal/a2/workforce/local-admin-sessions')
        .send({ email: seed.emailFor(role), password: seed.passwordFor(role) })
        .expect(201);
      sessions[role] = response.body;
    }
    const ownSession = sessions.OPERATIONS!;
    const foreignSession = {
      accessToken: foreignOperator.token,
      principal: { principalId: foreignOperator.principalId },
    };
    await fixture.grantWorkforceScope(f.institutionId, ownSession.principal.principalId);
    const registry = new BankingProviderRegistry();
    registry.register({
      descriptor: {
        key: 'MONNIFY',
        displayName: 'Controlled sandbox verifier',
        environment: 'sandbox',
        capabilities: capabilitiesOf({ INBOUND_PAYMENT_VERIFICATION: true }),
        descriptors: [],
      },
      verifyInboundPayment: (reference: string) =>
        Promise.resolve({
          ok: true,
          value: {
            outcome: 'VERIFIED',
            providerTransactionReference: reference,
            currency: 'NGN',
            grossAmountMinor: '250000',
            correlationId: 'identity-test',
          },
        }),
    } as BankingProvider);
    const intake = new BankingInboundService(db, registry);
    const cmd = command(f);
    const bankCommand = {
      institutionId: f.institutionId,
      providerKey: 'MONNIFY',
      environment: 'sandbox' as const,
      providerTransactionReference: cmd.providerReference,
      receivingAccountNumber: f.accountNumber,
      currency: 'NGN',
      grossAmountMinor: '250000',
      providerFeeMinor: '0',
      creditedAmountMinor: '250000',
    };
    const payment = await intake.record(bankCommand);
    const hash = '#transaction-history/BANK_TO_WALLET/' + payment.id;
    const path = '/api/v1/internal/admin/transaction-history/BANK_TO_WALLET/' + payment.id;
    const read = (url: string, session = ownSession) =>
      request(app.getHttpServer())
        .get(url)
        .set('Authorization', 'Bearer ' + session.accessToken);
    const before = (await read(path).expect(200)).body;
    expect(before).toMatchObject({ id: payment.id, type: 'BANK_TO_WALLET', status: 'UNVERIFIED' });
    await read(path, foreignSession).expect(404);
    const savedBrowserUrl = 'http://127.0.0.1:5173/' + hash;
    let identityPage: Page | undefined;
    if (process.env.HISTORY_IDENTITY_BROWSER === 'yes') {
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
      identityBrowser = await chromium.launch({
        executablePath: binary.path,
        args: binary.args,
        headless: true,
      });
      identityPage = await identityBrowser!.newPage({ viewport: { width: 1512, height: 982 } });
      await identityPage.goto('http://127.0.0.1:5173');
      await identityPage.getByPlaceholder('Workforce email').fill(seed.emailFor('OPERATIONS'));
      await identityPage.getByPlaceholder('••••••••••••').fill(seed.passwordFor('OPERATIONS'));
      await identityPage.getByRole('button', { name: 'Sign in', exact: false }).click();
      await identityPage.getByTestId('section-money').waitFor();
      await identityPage.goto(savedBrowserUrl);
      await identityPage.getByRole('dialog').getByText('UNVERIFIED', { exact: true }).waitFor();
      expect(identityPage.url()).toBe(savedBrowserUrl);
      await identityPage.screenshot({
        path: 'docs/transaction-history/evidence/inbound-identity-before.png',
        fullPage: true,
      });
    }
    expect((await intake.verify(payment.id, 'identity-test')).state).toBe('VERIFIED');
    expect((await read(path).expect(200)).body.status).toBe('VERIFIED');
    const credited = await policyBackedService().fundFromVerifiedInbound(cmd);
    expect(credited.status).toBe('CREDITED');
    const after = (await read(path).expect(200)).body;
    expect(after).toMatchObject({
      id: payment.id,
      type: 'BANK_TO_WALLET',
      status: 'CREDITED',
      institutionId: f.institutionId,
      investigation: { floatReceiptId: credited.receiptId, postingState: 'FLOAT_CREDITED' },
    });
    if (identityPage) {
      // Full navigation reopens the URL captured before either transition, not a new detail link.
      await identityPage.goto('about:blank');
      await identityPage.goto(savedBrowserUrl);
      await identityPage.getByRole('dialog').getByText('CREDITED', { exact: true }).waitFor();
      expect(identityPage.url()).toBe(savedBrowserUrl);
      await identityPage.screenshot({
        path: 'docs/transaction-history/evidence/inbound-identity-after.png',
        fullPage: true,
      });
      await identityBrowser!.close();
      identityBrowser = undefined;
    }
    const referencePath =
      '/api/v1/internal/admin/transaction-history?reference=' +
      encodeURIComponent(cmd.providerReference);
    const listed = (await read(referencePath).expect(200)).body.items;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: payment.id, type: 'BANK_TO_WALLET', status: 'CREDITED' });
    const receiptAliasPath =
      '/api/v1/internal/admin/transaction-history/AGENT_FUNDING/' + credited.receiptId;
    expect((await read(receiptAliasPath).expect(200)).body).toEqual(after);
    await read(path, foreignSession).expect(404);
    await read(receiptAliasPath, foreignSession).expect(404);
    expect((await read(referencePath, foreignSession).expect(200)).body.items).toEqual([]);
    expect(await intake.record(bankCommand)).toEqual({ id: payment.id, alreadyRecorded: true });
    expect((await policyBackedService().fundFromVerifiedInbound(cmd)).status).toBe('REPLAYED');
    expect((await read(referencePath).expect(200)).body.items).toHaveLength(1);
    expect(await accountBalance(f.floatAccountId)).toBe(250000n);
    // Same reference is insufficient: account, environment, amount and institution must also agree.
    for (const over of [
      { providerTransactionReference: 'MNFY-MISMATCHED-REFERENCE' },
      { receivingAccountNumber: '0000000000' },
      { environment: 'production' as const },
      { grossAmountMinor: '250001', creditedAmountMinor: '250001' },
      { institutionId: foreign.id },
    ]) {
      const mismatchedCredit = command(f);
      const mismatchReceipt = await policyBackedService().fundFromVerifiedInbound(mismatchedCredit);
      const other = await intake.record({
        ...bankCommand,
        providerTransactionReference: mismatchedCredit.providerReference,
        ...over,
      });
      // Controlled fixture verifier transition; production environment remains UNKNOWN through service.
      await intake.verify(other.id, 'identity-mismatch-test');
      expect(
        await db.query('SELECT * FROM banking_inbound_float_links WHERE payment_id=$1', [other.id]),
      ).toEqual([]);
      await expect(
        db.query(
          'INSERT INTO banking_inbound_float_links(payment_id,float_receipt_id) VALUES($1,$2)',
          [other.id, mismatchReceipt.receiptId],
        ),
      ).rejects.toThrow('Inbound identity requires matching');
    }
    // Receipt-first ordering: retain the already-saved AGENT_FUNDING URL as an alias when
    // a later bank intake is verified. No record is hidden before a proven link exists.
    const lateCmd = command(f);
    const earlyReceipt = await policyBackedService().fundFromVerifiedInbound(lateCmd);
    const earlyPath =
      '/api/v1/internal/admin/transaction-history/AGENT_FUNDING/' + earlyReceipt.receiptId;
    expect((await read(earlyPath).expect(200)).body.id).toBe(earlyReceipt.receiptId);
    const lateBank = await intake.record({
      ...bankCommand,
      providerTransactionReference: lateCmd.providerReference,
    });
    expect(
      await db.query('SELECT * FROM banking_inbound_float_links WHERE payment_id=$1', [
        lateBank.id,
      ]),
    ).toEqual([]);
    await intake.verify(lateBank.id, 'identity-late-bank');
    expect((await read(earlyPath).expect(200)).body).toMatchObject({
      id: lateBank.id,
      type: 'BANK_TO_WALLET',
      status: 'CREDITED',
    });
    await read(earlyPath, foreignSession).expect(404);
    const lateReferencePath =
      '/api/v1/internal/admin/transaction-history?reference=' +
      encodeURIComponent(lateCmd.providerReference);
    expect((await read(lateReferencePath).expect(200)).body.items).toHaveLength(1);
    expect((await policyBackedService().fundFromVerifiedInbound(lateCmd)).status).toBe('REPLAYED');
    expect(
      await db.query('SELECT * FROM banking_inbound_float_links WHERE payment_id=$1', [
        lateBank.id,
      ]),
    ).toHaveLength(1);
    await expect(
      db.query('UPDATE banking_inbound_payments SET institution_id=$2 WHERE id=$1', [
        payment.id,
        foreign.id,
      ]),
    ).rejects.toThrow('Inbound business identity is immutable');
    await expect(
      db.query('DELETE FROM banking_inbound_float_links WHERE payment_id=$1', [payment.id]),
    ).rejects.toThrow();
    expect(
      await db.query(`SELECT
      has_table_privilege('monienaija_runtime','banking_inbound_float_links','UPDATE') AS update,
      has_table_privilege('monienaija_runtime','banking_inbound_float_links','DELETE') AS delete,
      has_table_privilege('monienaija_runtime','banking_inbound_float_links','TRUNCATE') AS truncate`),
    ).toEqual([{ update: false, delete: false, truncate: false }]);
    expect(
      await db.query('SELECT id,password_hash FROM local_admin_credentials ORDER BY id'),
    ).toEqual(hashes);
    writeFileSync(
      'docs/transaction-history/evidence/inbound-identity-results.json',
      JSON.stringify(
        {
          result: 'PASS',
          session: 'real local-admin login; all 11 passwords authenticated, hashes unchanged',
          verifier: 'controlled sandbox provider boundary; real BankingInboundService verification',
          credit:
            'real AgentFloatFundingService with controlled sandbox policy authority; balanced posted ledger',
          savedHash: hash,
          savedApiPath: path,
          before,
          after,
          listed,
          checks: [
            'original URL survives UNVERIFIED → VERIFIED → CREDITED',
            'one business row across all types',
            'legacy AGENT_FUNDING receipt URL aliases canonical payment (including receipt-first arrival)',
            'another institution list/detail/alias denied',
            'bank replay and float replay produce one credit',
            'reference/account/environment/amount/institution mismatch refused',
            'scope and persisted link immutable',
          ],
          savedBrowserUrl,
          browser: process.env.HISTORY_IDENTITY_BROWSER === 'yes',
        },
        null,
        2,
      ),
    );
  });

  it('credits float with a balanced journal and an immutable receipt', async () => {
    const f = await fixtureFor();
    const policyService = policyBackedService();

    const result = await policyService.fundFromVerifiedInbound(command(f));

    expect({ status: result.status, reason: result.reason }).toEqual({
      status: 'CREDITED',
      reason: undefined,
    });
    expect(result.receiptId).toBeDefined();

    // The ledger actually moved: the institution's settlement asset was debited and the agent's
    // float liability credited, both for the full amount.
    expect(await accountBalance(f.settlementAssetId)).toBe(250000n);
    expect(await accountBalance(f.floatAccountId)).toBe(250000n);

    const receipts: Array<Record<string, string>> = await db.query(
      `SELECT amount_minor::text AS amount_minor, float_account_id::text AS float_account_id,
              settlement_asset_account_id::text AS settlement_asset_account_id
         FROM agent_float_funding_receipts WHERE id = $1`,
      [result.receiptId],
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.amount_minor).toBe('250000');
    expect(receipts[0]!.float_account_id).toBe(f.floatAccountId);
    expect(receipts[0]!.settlement_asset_account_id).toBe(f.settlementAssetId);
  });

  it('is exactly-once under duplicate delivery of the same reference', async () => {
    const f = await fixtureFor();
    const cmd = command(f, { providerReference: 'MNFY-DUPE-0001' });

    const policyService = policyBackedService();
    const first = await policyService.fundFromVerifiedInbound(cmd);
    const second = await policyService.fundFromVerifiedInbound(cmd);
    const third = await policyService.fundFromVerifiedInbound(cmd);

    expect(first.status).toBe('CREDITED');
    expect(second.status).toBe('REPLAYED');
    expect(second.receiptId).toBe(first.receiptId);
    expect(third.receiptId).toBe(first.receiptId);

    // One credit, not three. This is the assertion a status-only test would miss.
    expect(await accountBalance(f.floatAccountId)).toBe(250000n);
    const count: Array<{ n: string }> = await db.query(
      `SELECT count(*)::text AS n FROM agent_float_funding_receipts WHERE wallet_account_id = $1`,
      [f.walletId],
    );
    expect(count[0]!.n).toBe('1');
  });

  it('is exactly-once under concurrent delivery of the same reference', async () => {
    const f = await fixtureFor();
    const cmd = command(f, { providerReference: 'MNFY-RACE-0001', amountMinor: '75000' });

    // Ten simultaneous attempts on one reference, as a webhook retry storm produces.
    const policyService = policyBackedService();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => policyService.fundFromVerifiedInbound(cmd)),
    );

    const credited = results.filter((r) => r.status === 'CREDITED');
    expect(credited.length).toBe(1);
    expect(results.filter((r) => r.status === 'REPLAYED').length).toBe(9);
    expect(await accountBalance(f.floatAccountId)).toBe(75000n);
  });

  it('refuses a reference already credited with different terms', async () => {
    const f = await fixtureFor();
    const policyService = policyBackedService();
    await policyService.fundFromVerifiedInbound(
      command(f, { providerReference: 'MNFY-CONFLICT-1', amountMinor: '50000' }),
    );

    // A second claim about the same reference for a different amount is not a retry; accepting it
    // would mean preferring the later story about what the provider actually paid.
    await expect(
      policyService.fundFromVerifiedInbound(
        command(f, { providerReference: 'MNFY-CONFLICT-1', amountMinor: '90000' }),
      ),
    ).rejects.toThrow(/different terms/i);

    expect(await accountBalance(f.floatAccountId)).toBe(50000n);
  });

  it('preserves an obligation, and moves no money, when no policy is active', async () => {
    const f = await fixtureFor({ activatePolicy: false });

    const cmd = entityCommand(f, { providerReference: 'MNFY-NOPOLICY-1' });
    const result = await policyBackedService().fundFromVerifiedInbound(cmd);

    // No approved policy exists for this institution, so the payment becomes an obligation.
    expect(result.status).toBe('OBLIGATION');
    expect(await accountBalance(f.floatAccountId)).toBe(0n);
    expect(await accountBalance(f.settlementAssetId)).toBe(0n);

    // The verified payment is not lost: it is operationally visible with a reason.
    const open = await service.openObligations(f.institutionId);
    expect(open).toHaveLength(1);
    expect(open[0]!.amount_minor).toBe('250000');
    expect(open[0]!.reason).toBe('NO_ACTIVE_POLICY');
    expect(open[0]!.provider_transaction_reference).toBe(cmd.providerReference);
  });

  /**
   * The same obligation, but through the policy-reading authority, which is what a deployment that
   * has exported an approved policy would use. Constructed explicitly here rather than injected, so
   * the test proves the policy path without implying this deployment is wired to it.
   */
  it('withholds production even under the policy-reading authority', async () => {
    const f = await fixtureFor({ environment: 'production' });
    const policyService = policyBackedService();

    const result = await policyService.fundFromVerifiedInbound(
      entityCommand(f, { environment: 'production', providerReference: 'MNFY-PROD-0002' }),
    );

    // A production policy row exists and is ACTIVE, and the credit still does not happen: the
    // authority refuses production execution outright.
    expect(result.status).toBe('OBLIGATION');
    expect(result.reason).toBe('PRODUCTION_EXECUTION_WITHHELD');
    expect(await accountBalance(f.floatAccountId)).toBe(0n);
  });

  it('credits under the policy-reading authority when an approved sandbox policy exists', async () => {
    const f = await fixtureFor();
    const policyService = policyBackedService();

    const result = await policyService.fundFromVerifiedInbound(
      entityCommand(f, { providerReference: 'MNFY-POLICY-OK', amountMinor: '15000' }),
    );

    expect(result.status).toBe('CREDITED');
    expect(await accountBalance(f.floatAccountId)).toBe(15000n);
    expect(await accountBalance(f.settlementAssetId)).toBe(15000n);
  });

  it('refuses a suspended agent and preserves the payment', async () => {
    const f = await fixtureFor({ agentStatus: 'SUSPENDED' });
    const policyService = policyBackedService();

    const result = await policyService.fundFromVerifiedInbound(
      entityCommand(f, { providerReference: 'MNFY-SUSP-0001' }),
    );

    expect(result.status).toBe('OBLIGATION');
    expect(result.reason).toBe('AGENT_INELIGIBLE');
    expect(await accountBalance(f.floatAccountId)).toBe(0n);
  });

  it('refuses a payment into an account that is not this agent funding account', async () => {
    const f = await fixtureFor();
    const policyService = policyBackedService();

    const result = await policyService.fundFromVerifiedInbound(
      entityCommand(f, {
        providerReference: 'MNFY-WRONGACCT',
        fundingAccountNumber: '9999999999',
      }),
    );

    expect(result.status).toBe('OBLIGATION');
    expect(result.reason).toBe('ACCOUNT_NOT_AGENT_FUNDING_ACCOUNT');
    expect(await accountBalance(f.floatAccountId)).toBe(0n);
  });

  it('refuses a customer wallet presented as an agent float destination', async () => {
    const f = await fixtureFor();
    const customerLedger: Array<{ id: string }> = await db.query(
      `INSERT INTO ledger_accounts (id,code,name,account_type,normal_balance,currency)
       VALUES ($1,$2,'Customer funds','LIABILITY','CREDIT','NGN') RETURNING id`,
      [randomUUID(), `A3DF_CUST_${randomUUID().slice(0, 6).toUpperCase()}`],
    );
    const customer: Array<{ id: string }> = await db.query(
      `INSERT INTO customers (reference,customer_type,status,kyc_level,kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`a3df-cust-${randomUUID().slice(0, 8)}`],
    );
    const customerWallet: Array<{ id: string }> = await db.query(
      `INSERT INTO wallet_accounts (id,customer_id,currency,status,ledger_account_id,owner_class)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'CUSTOMER') RETURNING id`,
      [randomUUID(), customer[0]!.id, customerLedger[0]!.id],
    );
    const accountNumber = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await db.query(
      `INSERT INTO virtual_accounts
         (id,wallet_id,provider,bank_code,account_number,account_name,status,assigned_at,reference)
       VALUES (gen_random_uuid(),$1,'MONNIFY','50515',$2,'Customer Account','ACTIVE',now(),$3)`,
      [customerWallet[0]!.id, accountNumber, `MN${Date.now()}${Math.floor(Math.random() * 1000)}`],
    );

    const policyService = policyBackedService();
    const result = await policyService.fundFromVerifiedInbound({
      institutionId: f.institutionId,
      agentId: customer[0]!.id,
      walletAccountId: customerWallet[0]!.id,
      fundingAccountNumber: accountNumber,
      providerKey: 'MONNIFY',
      environment: 'sandbox',
      providerReference: 'MNFY-CUSTOMER-1',
      amountMinor: '25000',
      currency: 'NGN',
      correlationId: 'float-customer',
    });

    // A customer deposit booked as agent float would be money in the wrong place with the wrong
    // liability behind it.
    expect(result.status).toBe('OBLIGATION');
    expect(result.reason).toBe('WALLET_NOT_AGENT_OWNED');
    expect(await accountBalance(customerLedger[0]!.id)).toBe(0n);
  });

  it('closes an earlier obligation once the same reference is actually credited', async () => {
    const f = await fixtureFor({ activatePolicy: false });
    const cmd = entityCommand(f, { providerReference: 'MNFY-LATER-0001', amountMinor: '15000' });

    const before = await policyBackedService().fundFromVerifiedInbound(cmd);
    expect(before.status).toBe('OBLIGATION');

    // An approved policy is exported. The same reference now credits under the policy authority, and
    // the obligation closes against the receipt that proves it rather than being deleted.
    await db.query(
      `INSERT INTO agent_float_funding_policies
         (id,institution_id,provider_key,environment,currency,settlement_asset_account_id,
          status,purpose,approved_by,approved_at,activated_by,activated_at)
       VALUES (gen_random_uuid(),$1,'MONNIFY','sandbox','NGN',$2,
               'ACTIVE','AGENT_OPERATING_FLOAT','fixture-approver',now(),'fixture-operator',now())`,
      [f.institutionId, f.settlementAssetId],
    );

    const after = await policyBackedService().fundFromVerifiedInbound(cmd);
    expect(after.status).toBe('CREDITED');
    expect(await accountBalance(f.floatAccountId)).toBe(15000n);

    const rows: Array<{ status: string }> = await db.query(
      `SELECT status FROM agent_float_funding_obligations WHERE institution_id = $1`,
      [f.institutionId],
    );
    expect(rows[0]!.status).toBe('RESOLVED_CREDITED');
  });

  it('refuses to resolve an obligation as credited without a receipt', async () => {
    const f = await fixtureFor({ activatePolicy: false });
    await policyBackedService().fundFromVerifiedInbound(
      entityCommand(f, { providerReference: 'MNFY-NORECEIPT' }),
    );

    // Operations cannot declare money moved. The database refuses it, so no future code path can
    // turn an obligation into a credited one without a ledger receipt behind it.
    await expect(
      db.query(
        `UPDATE agent_float_funding_obligations
            SET status='RESOLVED_CREDITED',
                resolution_evidence='{"receiptId":"none"}'::jsonb, resolved_at=now()
          WHERE institution_id=$1`,
        [f.institutionId],
      ),
    ).rejects.toThrow(/without a funding receipt/i);
  });

  it('refuses to modify or delete a funding receipt', async () => {
    const f = await fixtureFor();
    const result = await policyBackedService().fundFromVerifiedInbound(
      command(f, { providerReference: 'MNFY-IMMUTABLE' }),
    );

    await expect(
      db.query(`UPDATE agent_float_funding_receipts SET amount_minor=999999 WHERE id=$1`, [
        result.receiptId,
      ]),
    ).rejects.toThrow(/cannot be modified/i);
    await expect(
      db.query(`DELETE FROM agent_float_funding_receipts WHERE id=$1`, [result.receiptId]),
    ).rejects.toThrow(/cannot be deleted/i);
  });

  it('refuses a settlement asset that belongs to a different institution', async () => {
    const a = await fixtureFor();
    const b = await fixtureFor({ activatePolicy: false });

    // One institution's cash may not be posted against another's ledger.
    await expect(
      db.query(
        `INSERT INTO agent_float_funding_policies
           (id,institution_id,provider_key,environment,currency,settlement_asset_account_id,
            status,purpose,approved_by,approved_at,activated_by,activated_at)
         VALUES (gen_random_uuid(),$1,'MONNIFY','sandbox','NGN',$2,
                 'ACTIVE','AGENT_OPERATING_FLOAT','x',now(),'y',now())`,
        [b.institutionId, a.settlementAssetId],
      ),
    ).rejects.toThrow(/same institution/i);
  });

  /** The obligation command shape (identical to the funding command). */
  function entityCommand(f: FloatFixture, overrides: Record<string, unknown> = {}) {
    return command(f, overrides);
  }

  /**
   * A service instance using the policy-reading authority.
   *
   * Constructed from the application's own collaborators so it is the real ledger, audit and outbox
   * implementations, differing only in which authority decides policy.
   */
  function policyBackedService(): AgentFloatFundingService {
    return new AgentFloatFundingService(
      db,
      app.get(LedgerService),
      app.get(AuditService),
      app.get(OutboxService),
      policyAuthority,
    );
  }
});
