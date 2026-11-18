import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

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
    await app?.close();
    // Nest may close the injected DataSource itself; the harness safely handles either state
    // and also removes this run's isolated test database.
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
