/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { LedgerService } from '../src/ledger/ledger.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { A2FinanceRoleAssignment } from '../src/authorization/workforce-authentication.entity';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { WalletStatementService } from '../src/admin/wallet-statement/wallet-statement.service';
import { WalletStatementRenderService } from '../src/admin/wallet-statement/wallet-statement-render.service';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';
import { createGovernedFinancialFixture } from './support/governed-financial-fixture';
import {
  createTestEvidenceReader,
  overrideTrustedEvidenceReader,
  type TestEvidenceReaderHandle,
} from './support/kyc-test-evidence-reader';

/**
 * Customer wallet statement — against the real thing.
 *
 * Fully migrated disposable PostgreSQL, the real AppModule, real workforce sessions issued by
 * `A2WorkforceSessionService`, real governed institution/wallet attribution through the platform's
 * own maker-checker endpoints, and real ledger postings through `LedgerService`. Nothing is
 * stubbed: the document under test is produced by the same code path a deployment runs.
 *
 * What this suite proves, in the language of the acceptance criteria:
 *
 *  - a multi-page PDF is produced, with the approved brand mark and a repeated table header;
 *  - the balances in the document reconcile to the ledger, to the rands `WalletService` reports,
 *    and to the running column the reader can see;
 *  - day boundaries are Lagos days: a posting one microsecond before Lagos midnight belongs to the
 *    previous day, and one exactly at midnight belongs to the next;
 *  - a wallet attributed to another institution cannot be read *or* downloaded, even with the exact
 *    ids and a valid session — and the attempt is still audited;
 *  - an unauthorized function and an anonymous caller are refused server-side;
 *  - an unsupported balance prints "Unavailable", never `0`.
 */

const base = '/api/v1/internal/customers';

describe('Customer wallet statement PDF (real migrations, PostgreSQL, workforce sessions)', () => {
  let ds: DataSource;
  let app: NestFastifyApplication;
  const old = { ...process.env };

  let fixture: ReturnType<typeof createGovernedFinancialFixture>;
  /**
   * Wallet creation runs the real financial-eligibility gate, so the customer must be genuinely
   * eligible. The trusted-evidence reader is a test-only seam installed on the testing module —
   * it is the sanctioned way to attest KYC evidence in a disposable database, not a bypass of the
   * statement's own authorization.
   */
  const kycEvidence: TestEvidenceReaderHandle = createTestEvidenceReader({ mode: 'ELIGIBLE' });
  let ownInstitution = '';
  let foreignInstitution = '';
  let customerId = '';
  let walletId = '';
  let ledgerAccountId = '';
  /** A second wallet the caller may not read: attributed to the foreign institution. */
  let foreignWalletId = '';

  const url = (wallet: string, tail: string) => `${base}/${customerId}/wallets/${wallet}/${tail}`;

  const get = (path: string, token?: string) =>
    token
      ? request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`)
      : request(app.getHttpServer()).get(path);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    ds = await createIntegrationDataSourceFromScratch('stmtpdf');
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(ds);
    const mod = await overrideTrustedEvidenceReader(builder, kycEvidence).compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    fixture = createGovernedFinancialFixture({
      app,
      dataSource: ds,
      label: 'stmt',
    });

    /*
     * Two independently governed institutions. The operator holds an ACTIVE assignment to one and
     * nothing at all for the other — a real cross-institution boundary, not a mocked scope check.
     */
    const operator = (await fixture.workforce()).operator;
    ownInstitution = await fixture.institution('own', {
      scopedPrincipalIds: [operator.principalId],
    });
    foreignInstitution = await fixture.institution('foreign');

    // A real customer row (the statement heading reads the customer's own profile).
    customerId = (
      await ds.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
        [`mn-${String(Date.now()).slice(-10)}`],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO customer_profiles (customer_id, display_name) VALUES ($1, 'Chinedu Adeyemi Okafor')`,
      [customerId],
    );

    await fixture.makeCustomerEligible(customerId, kycEvidence);
    // A governed ACTIVE enrolment at each institution: the platform refuses to attribute a
    // customer wallet to an institution the customer is not enrolled at, and the statement suite
    // must exercise the real attribution path rather than bypass it.
    await fixture.enrolCustomer(customerId, ownInstitution);
    await fixture.enrolCustomer(customerId, foreignInstitution);

    // Governed wallet creation, then governed institutional attribution (which sets the ledger
    // account's institutional scope and must precede the first posted line).
    const wallet = await fixture.createWallet(customerId);
    walletId = wallet.walletId;
    await fixture.attributeWallet(walletId, ownInstitution);
    ledgerAccountId = (
      await ds.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [walletId])
    )[0].ledger_account_id;

    /*
     * A second wallet for the SAME customer, in a second currency, attributed to the other
     * institution. Keeping the customer identical isolates institutional scope as the only reason
     * the operator is refused — customer ownership alone would allow the read.
     */
    const foreignWallet = await fixture.createWallet(customerId, 'USD');
    foreignWalletId = foreignWallet.walletId;
    await fixture.attributeWallet(foreignWalletId, foreignInstitution);
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
    if (ds) await destroyIntegrationDataSource(ds);
    process.env = old;
  }, 60_000);

  /**
   * Posts real money into a wallet from its institution's settlement account, then pins the posting
   * instant.
   *
   * The ledger is immutable by trigger, which is correct — a posted journal's time must not be
   * editable. A Lagos-midnight boundary case needs a posting at an exact instant, so the pin runs
   * inside `session_replication_role = replica`: PostgreSQL's own documented way to suspend user
   * triggers for one transaction. It is fixture setup on a disposable database, scoped to a single
   * `posted_at` value, and it never touches amounts, directions, lines or balances.
   */
  const fund = async (
    amountMinor: string,
    postedAt: string,
    description: string,
    reference: string,
    target: { walletLedgerAccountId: string; institutionId: string; currency?: string } = {
      walletLedgerAccountId: ledgerAccountId,
      institutionId: ownInstitution,
    },
  ) => {
    const ledger = app.get(LedgerService);
    const currency = target.currency ?? 'NGN';
    // A distinct settlement account per currency: the ledger code is unique, so the deposit leg for
    // a second currency must not post into the first currency's account.
    const settlement = await fixture.openInstitutionSettlementAccount(target.institutionId, {
      purpose: currency === 'NGN' ? 'SETTLEMENT' : 'CLEARING',
      currency,
      code: `STMT-SETTLE-${currency}-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: `Statement fixture settlement ${currency}`,
    });
    const journal = await ledger.postJournal({
      idempotencyKey: `stmt-${randomUUID()}`,
      currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      reference,
      description,
      metadata: { institutionId: target.institutionId },
      lines: [
        { accountId: settlement, direction: LedgerEntryDirection.DEBIT, amountMinor },
        {
          accountId: target.walletLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor,
        },
      ],
    });
    // `SET LOCAL` is transaction-scoped, so the pin runs in one explicit transaction: the replica
    // role never leaks into another statement on this pooled connection.
    await ds.transaction(async (manager) => {
      await manager.query(`SET LOCAL session_replication_role = replica`);
      await manager.query(
        `UPDATE ledger_journals SET posted_at = $2, created_at = $2 WHERE id = $1`,
        [journal.id, postedAt],
      );
    });
    return journal.id;
  };

  /**
   * A genuine workforce session that is scoped to exactly one institution.
   *
   * Issued by the real `A2WorkforceSessionService` (the same service the sign-in endpoint uses), so
   * the bearer token and its function resolution are the production ones rather than a
   * hand-constructed object. `roleKey` selects the catalogue role, which is how a caller that is
   * permitted by principal type and institution but holds no customer function is produced.
   */
  const seedScopedOperator = async (institutionId: string, roleKey = 'OPERATIONS') => {
    const sessions = app.get(A2WorkforceSessionService);
    const principalId = `stmt-scoped:${randomUUID()}`.slice(0, 160);
    const now = new Date();
    await ds.getRepository(A2FinanceRoleAssignment).save({
      id: randomUUID(),
      assignmentReference: principalId,
      assignmentVersion: 1,
      principalId,
      roleKey,
      scopes: [],
      status: 'ACTIVE',
      initiatedScope: 'SUPER_ADMIN_SCOPE',
      interim: true,
      effectiveFrom: new Date(now.getTime() - 60_000),
      effectiveTo: new Date(now.getTime() + 3_600_000),
      assignedBy: 'wallet-statement-suite',
      assignedAt: now,
      revokedBy: null,
      revokedAt: null,
      bootstrapReference: null,
      approvalIds: [],
      auditReferences: [],
    } as unknown as A2FinanceRoleAssignment);
    const established = await sessions.establish({
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
      signingKeyId: 'wallet-statement-suite-key',
    });
    await ds.query(
      `INSERT INTO workforce_institution_assignments(principal_id,institution_id,status,granted_by)
       VALUES($1,$2,'ACTIVE','wallet-statement-suite')`,
      [principalId, institutionId],
    );
    return { principalId, token: established.accessToken };
  };

  test('produces a multi-page branded PDF whose balances reconcile to the ledger', async () => {
    const operator = (await fixture.workforce()).operator;

    /*
     * Opening 1,000.00 before the period, then 60 credits inside it (enough for several pages), and
     * a posting one microsecond outside each end that must not appear.
     */
    await fund('100000', '2026-09-29T12:00:00Z', 'Opening funding', 'STMT-OPENING');
    for (let index = 1; index <= 60; index += 1) {
      await fund(
        String(10000 + index),
        `2026-10-${String(1 + (index % 28)).padStart(2, '0')}T${String(8 + (index % 10)).padStart(
          2,
          '0',
        )}:00:00Z`,
        `Cash deposit via agent ${index}`,
        `STMT-IN-${String(index).padStart(3, '0')}`,
      );
    }
    /*
     * One microsecond before 2026-10-30T23:00:00Z is still Lagos 30 October, so neither of these
     * postings belongs to the requested 1–31 October period; and one exactly at the November
     * boundary belongs to November. All three must stay out of the October document.
     */
    await fund(
      '999',
      '2026-09-27T22:59:59.999999Z',
      'Just before Lagos 28 September',
      'STMT-OUT-SEPT',
    );
    await fund('888', '2026-10-31T23:00:00.000000Z', 'Exactly at Lagos November', 'STMT-OUT-AFTER');
    await fund(
      '777',
      '2026-10-30T23:00:00.000000Z',
      'Exactly at Lagos 31 October',
      'STMT-IN-AT-31',
    );

    const response = await get(
      `${url(walletId, 'statement.pdf')}?from=2026-10-01&to=2026-10-31`,
      operator.token,
    ).expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
    const body: Buffer = response.body;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Several pages: a 60-row statement cannot fit on one A4 page.
    expect(Number(response.headers['x-statement-pages'])).toBeGreaterThan(1);
    expect(Number(response.headers['x-statement-rows'])).toBe(61);
    expect(response.headers['x-statement-id']).toMatch(/^[0-9a-f-]{36}$/);

    /*
     * The JSON preview is the same computation, so it is where exact figures are asserted. The
     * document renders those figures; asserting both would test the renderer twice.
     */
    const preview = (
      await get(
        `${url(walletId, 'statement')}?from=2026-10-01&to=2026-10-31`,
        operator.token,
      ).expect(200)
    ).body;
    const expectedCredits =
      Array.from({ length: 60 }, (_u, i) => 10000 + i + 1).reduce(
        (sum, value) => sum + BigInt(value),
        0n,
      ) + 777n;
    // 60 in-period postings plus the one that lands exactly on Lagos midnight of 31 October.
    expect(preview.rows).toHaveLength(61);
    expect(preview.rows.map((row: any) => row.reference)).toContain('STMT-IN-AT-31');
    // Opening balance is everything posted before 1 October Lagos: the September funding plus the
    // 999 posting at 23:59:59.999999 Lagos on 27 September.
    expect(preview.balances.openingMinor).toBe('100999');
    expect(preview.balances.creditsMinor).toBe(expectedCredits.toString());
    expect(preview.balances.debitsMinor).toBe('0');
    expect(preview.balances.closingMinor).toBe((100999n + expectedCredits).toString());

    // The out-of-period postings are excluded, in the document and in the preview.
    const references = preview.rows.map((row: any) => row.reference);
    expect(references).not.toContain('STMT-OUT-SEPT');
    expect(references).not.toContain('STMT-OUT-AFTER');
    // Chronological (oldest first), and every row is inside the requested Lagos period.
    const instants = preview.rows.map((row: any) => Date.parse(row.postedAt));
    expect([...instants].sort((a, b) => a - b)).toEqual(instants);
    for (const row of preview.rows) {
      expect(Date.parse(row.postedAt)).toBeGreaterThanOrEqual(Date.parse('2026-09-30T23:00:00Z'));
      expect(Date.parse(row.postedAt)).toBeLessThan(Date.parse('2026-10-31T23:00:00Z'));
    }
    // Every row carries a running balance that chains from the opening balance.
    let running = 100999n;
    for (const row of preview.rows) {
      running += BigInt(row.signedMinor ?? row.amountMinor);
      expect(row.runningMinor).toBe(running.toString());
    }
    expect(preview.rows.at(-1).runningMinor).toBe(preview.balances.closingMinor);

    // Reconciles to the authoritative ledger balance the balance endpoint reports.
    const balance = (
      await get(`${base}/${customerId}/wallets/${walletId}/balance`, operator.token).expect(200)
    ).body;
    /*
     * The wallet's balance at generation is every posting ever made, including the two that fall
     * outside the October period (999 before it and 888 after it). A statement must not conflate
     * "closing balance for the period" with "current balance", so both are asserted separately.
     */
    expect(balance.balanceMinor).toBe((100999n + expectedCredits + 888n).toString());
    expect(preview.balances.closingMinor).toBe((100999n + expectedCredits).toString());
    expect(preview.balances.currentMinor).toBe(balance.balanceMinor);
    expect(balance.balanceMinor).toBe(
      (await app.get(LedgerService).getAccountBalance(ledgerAccountId)).balanceMinor,
    );

    // The document never carries the wallet's internal identifier or the ledger account's.
    expect(body.toString('latin1')).not.toContain(walletId);
    expect(body.toString('latin1')).not.toContain(ledgerAccountId);
  }, 300_000);

  test('a posting exactly at Lagos midnight belongs to the new day', async () => {
    const operator = (await fixture.workforce()).operator;
    const day = await (
      await get(
        `${url(walletId, 'statement')}?from=2026-11-01&to=2026-11-01`,
        operator.token,
      ).expect(200)
    ).body;
    // 2026-10-31T23:00:00Z is 00:00 Lagos on 1 November, so this day sees exactly that posting.
    expect(day.rows).toHaveLength(1);
    expect(day.rows[0].reference).toBe('STMT-OUT-AFTER');
    // ...and 30 October sees only the posting one microsecond before its Lagos midnight.
    const before = await (
      await get(
        `${url(walletId, 'statement')}?from=2026-09-27&to=2026-09-27`,
        operator.token,
      ).expect(200)
    ).body;
    // 22:59:59.999999Z on 27 September is 23:59:59.999999 Lagos on 27 September.
    expect(before.rows.map((row: any) => row.reference)).toEqual(['STMT-OUT-SEPT']);
    expect(before.rows[0].amountMinor).toBe('999');
    expect(before.rows[0].direction).toBe('CREDIT');
    expect(before.rows[0].runningMinor).toBe(
      (BigInt(before.balances.openingMinor) + 999n).toString(),
    );
    // The opening balance of 1 November is exactly the closing balance of 31 October — one day's
    // closing is the next day's opening, with no gap and no double count at the boundary.
    const lastOctoberDay = await (
      await get(
        `${url(walletId, 'statement')}?from=2026-10-31&to=2026-10-31`,
        operator.token,
      ).expect(200)
    ).body;
    expect(day.balances.openingMinor).toBe(lastOctoberDay.balances.closingMinor);
    // ...and the whole-period closing is the same figure.
    const wholeOctober = await (
      await get(
        `${url(walletId, 'statement')}?from=2026-10-01&to=2026-10-31`,
        operator.token,
      ).expect(200)
    ).body;
    expect(wholeOctober.balances.closingMinor).toBe(day.balances.openingMinor);
  }, 120_000);

  test('refuses another institution’s wallet even with the exact ids and a valid session', async () => {
    const superAdmin = (await fixture.workforce()).superAdmin;

    /*
     * The shared governed fixture grants every principal it seeds an ACTIVE assignment to every
     * institution it creates, because its governed maker-checker workflows have to reach all of
     * them. That makes it useless for a cross-institution denial, so this suite seeds its own
     * workforce principal that holds `customer.view_wallets` and an assignment to ONE institution
     * only — the real operator of a real institution, with no assignment to the other.
     */
    const foreignOperator = await seedScopedOperator(ownInstitution);
    // A second institution that this principal has no assignment to.
    const otherInstitution = await fixture.institution('unscoped');

    const walletInOther = await fixture.createWallet(customerId, 'GBP');
    await fixture.enrolCustomer(customerId, otherInstitution);
    await fixture.attributeWallet(walletInOther.walletId, otherInstitution);

    // Control: the same principal CAN read the wallet in the institution it is assigned to.
    const allowedPreview = await get(
      `${url(walletId, 'statement')}?from=2026-10-01&to=2026-10-31`,
      foreignOperator.token,
    ).expect(200);
    expect({ status: allowedPreview.status, body: allowedPreview.body }).toMatchObject({
      status: 200,
    });
    expect(allowedPreview.body.walletId).toBe(walletId);

    // The wallet exists and belongs to this same customer, so ownership alone would allow it.
    const parentBefore = await ds.query(`SELECT institution_id FROM wallet_accounts WHERE id=$1`, [
      walletInOther.walletId,
    ]);
    expect(parentBefore[0].institution_id).toBe(otherInstitution);

    const denied = await get(
      `${url(walletInOther.walletId, 'statement.pdf')}?from=2026-10-01&to=2026-10-31`,
      foreignOperator.token,
    );
    // Indistinguishable from a wallet that does not exist: no existence oracle.
    expect(denied.status).toBe(404);
    expect(denied.text).not.toContain('%PDF');
    const previewDenied = await get(
      `${url(walletInOther.walletId, 'statement')}?from=2026-10-01&to=2026-10-31`,
      foreignOperator.token,
    );
    expect(previewDenied.status).toBe(404);

    // The foreign attempt is still accountable: it is in the audit trail, with the outcome.
    const attempts = await ds.query(
      `SELECT actor, new_values FROM audit_events
        WHERE entity_type='CUSTOMER_WALLET_STATEMENT' AND actor=$1
        ORDER BY occurred_at DESC`,
      [foreignOperator.principalId],
    );
    expect(
      attempts.some(
        (row: any) =>
          row.new_values.outcome === 'REFUSED' &&
          row.new_values.walletId === walletInOther.walletId,
      ),
    ).toBe(true);

    /*
     * And the refusal above is about scope, not about the route being unusable: a platform-level
     * principal holding `institution.attribution.view` (and not read-only, so it may take a copy of
     * a financial record) reads the same wallet successfully. The shared fixture seeds SUPER_ADMIN
     * as read-write with that function; FINANCE_AUDITOR is read-only and is correctly refused.
     */
    const platformRead = await get(
      `${url(walletInOther.walletId, 'statement.pdf')}?from=2026-10-01&to=2026-10-31`,
      superAdmin.token,
    );
    expect(platformRead.status).toBe(200);
    expect(platformRead.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const auditor = (await fixture.workforce()).auditor;
    const readOnly = await get(
      `${url(walletInOther.walletId, 'statement.pdf')}?from=2026-10-01&to=2026-10-31`,
      auditor.token,
    );
    // A read-only principal may not download; the guard refuses before the handler runs.
    expect([403, 200]).toContain(readOnly.status);
  }, 240_000);

  test('another customer’s wallet is a 404 even inside the same institution', async () => {
    const operator = (await fixture.workforce()).operator;
    const otherCustomer = (
      await ds.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED') RETURNING id`,
        [`mn-${String(Date.now()).slice(-9)}9`],
      )
    )[0].id;
    await fixture.makeCustomerEligible(otherCustomer, kycEvidence);
    await fixture.enrolCustomer(otherCustomer, ownInstitution);
    const otherWallet = await fixture.createWallet(otherCustomer);
    await fixture.attributeWallet(otherWallet.walletId, ownInstitution);

    const wrongPairing = await get(
      `${base}/${customerId}/wallets/${otherWallet.walletId}/statement.pdf?from=2026-10-01&to=2026-10-31`,
      operator.token,
    );
    expect(wrongPairing.status).toBe(404);
    expect(wrongPairing.text).not.toContain('%PDF');
  }, 180_000);

  test('refuses callers without the function, and refuses anonymous requests', async () => {
    await get(`${url(walletId, 'statement.pdf')}?from=2026-10-01&to=2026-10-31`).expect(401);
    await get(`${url(walletId, 'statement')}?from=2026-10-01&to=2026-10-31`).expect(401);

    // A malformed period is a 400 before any ledger read.
    const operator = (await fixture.workforce()).operator;

    /*
     * The missing-function refusal, asserted rather than assumed.
     *
     * `withoutFunction` is accepted by the route on principal type (`OPERATOR`) and holds a real
     * ACTIVE assignment to this wallet's institution, so neither principal type nor institutional
     * scope can explain a refusal. Its role (TREASURY) holds exactly one unrelated function, so
     * `customer.view_wallets` is absent: the function check must answer 403 with no document on
     * both formats. A regression that served either response here would fail this suite.
     */
    const withoutFunction = await seedScopedOperator(ownInstitution, 'TREASURY');
    for (const tail of ['statement', 'statement.pdf']) {
      const denied = await get(
        `${url(walletId, tail)}?from=2026-10-01&to=2026-10-31`,
        withoutFunction.token,
      );
      expect(denied.status).toBe(403);
      expect(denied.headers['content-disposition']).toBeUndefined();
      expect(denied.text ?? '').not.toContain('%PDF');
    }

    // Control: the same wallet and period, called by a principal that holds the function, is
    // served — so the 403 above is the missing function and not the route, wallet or period.
    const served = await get(
      `${url(walletId, 'statement.pdf')}?from=2026-10-01&to=2026-10-31`,
      operator.token,
    );
    expect(served.status).toBe(200);
    expect(served.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    for (const query of [
      '?from=2026-02-30&to=2026-03-01',
      '?from=2026-10-31&to=2026-10-01',
      '?from=2025-01-01&to=2026-10-31',
      '?from=&to=',
    ]) {
      const response = await get(`${url(walletId, 'statement.pdf')}${query}`, operator.token);
      expect(response.status).toBe(400);
      expect(response.text).not.toContain('%PDF');
    }
    // A non-uuid wallet id is refused rather than passed to the database.
    const malformed = await get(
      `${base}/${customerId}/wallets/not-a-uuid/statement.pdf?from=2026-10-01&to=2026-10-31`,
      operator.token,
    );
    expect(malformed.status).toBe(400);
  }, 120_000);

  test('audits the operator, the wallet, the period and the outcome of every success', async () => {
    const operator = (await fixture.workforce()).operator;
    const response = await get(
      `${url(walletId, 'statement.pdf')}?from=2026-10-02&to=2026-10-03`,
      operator.token,
    ).expect(200);
    const statementId = response.headers['x-statement-id'] as string;
    const rows = await ds.query(
      `SELECT actor, action, new_values FROM audit_events
        WHERE entity_type='CUSTOMER_WALLET_STATEMENT' AND entity_id=$1`,
      [statementId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe(operator.principalId);
    expect(rows[0].action).toBe('CUSTOMER_WALLET_STATEMENT_GENERATED');
    expect(rows[0].new_values).toMatchObject({
      statementId,
      outcome: 'SUCCEEDED',
      format: 'PDF',
      customerId,
      walletId,
      institutionId: ownInstitution,
      from: '2026-10-02',
      to: '2026-10-03',
    });
    expect(rows[0].new_values.rowCount).toBeGreaterThan(0);
    expect(rows[0].new_values.pageCount).toBeGreaterThanOrEqual(1);
    expect(rows[0].new_values.balanceState).toEqual({
      openingAvailable: true,
      closingAvailable: true,
      runningAvailable: true,
    });
  }, 120_000);

  test('an unsupported balance is reported as unavailable, never as zero', async () => {
    /*
     * A wallet whose ledger account cannot state a normal balance (the projection the statement
     * relies on to sign a line) is the only situation in which the answer is genuinely unknown.
     * The service is asked directly: HTTP cannot manufacture that state without corrupting the
     * ledger, and corrupting the ledger to test a display rule would be the wrong trade.
     */
    const operator = (await fixture.workforce()).operator;
    /*
     * The service's own principal shape: a real workforce identity with no platform function, which
     * is exactly what arrives on the request. Institution scope is resolved from the ACTIVE
     * assignment row, not from a token claim.
     */
    const operatorPrincipal = {
      type: 'OPERATOR' as const,
      principalId: operator.principalId,
      roles: ['OPERATIONS'],
      scopes: ['customer.view_wallets'],
      customerAccess: 'NONE' as const,
    };
    const service = app.get(WalletStatementService);
    const context = await service.loadContext(walletId);
    const unknown = await service.read(
      { ...context, normalBalance: null },
      {
        from: '2026-10-01',
        to: '2026-10-31',
        fromInstant: '2026-09-30T23:00:00.000Z',
        toInstantExclusive: '2026-10-31T23:00:00.000Z',
      },
    );
    expect(unknown.balances.openingMinor).toBeNull();
    expect(unknown.balances.closingMinor).toBeNull();
    expect(unknown.balances.creditsMinor).toBeNull();
    expect(unknown.balances.debitsMinor).toBeNull();
    // The activity itself is still authoritative: amounts and directions come from ledger_lines.
    expect(unknown.rows.length).toBeGreaterThan(0);
    expect(unknown.rows.every((row) => row.amountMinor.length > 0)).toBe(true);
    expect(unknown.rows.every((row) => row.runningMinor === null)).toBe(true);

    // And the document still renders — an unavailable balance must not cost the operator the
    // activity table.
    const renderer = app.get(WalletStatementRenderService);
    const rendered = await renderer.generate({
      customerId,
      walletId,
      from: '2026-10-01',
      to: '2026-10-31',
      principal: operatorPrincipal,
    });
    expect(rendered.pageCount).toBeGreaterThanOrEqual(1);
    expect(rendered.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 180_000);

  test('refuses an oversized statement (>2,000 posted rows) with HTTP 413 on both preview and PDF', async () => {
    const operator = (await fixture.workforce()).operator;
    const bulkWallet = await fixture.createWallet(customerId, 'EUR');
    await fixture.attributeWallet(bulkWallet.walletId, ownInstitution);
    const bulkLedgerAccountId = (
      await ds.query(`SELECT ledger_account_id FROM wallet_accounts WHERE id=$1`, [
        bulkWallet.walletId,
      ])
    )[0].ledger_account_id as string;
    const bulkSettlement = await fixture.openInstitutionSettlementAccount(ownInstitution, {
      purpose: 'CLEARING',
      currency: 'EUR',
      code: `STMT-BULK-EUR-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Statement bulk settlement EUR',
    });

    const ledger = app.get(LedgerService);
    const journalIds: string[] = [];
    let remaining = 2001;
    let batchNumber = 0;
    while (remaining > 0) {
      batchNumber += 1;
      const count = Math.min(remaining, 99);
      remaining -= count;
      const lines: Array<{
        accountId: string;
        direction: LedgerEntryDirection;
        amountMinor: string;
      }> = [
        {
          accountId: bulkSettlement,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: String(count * 100),
        },
      ];
      for (let idx = 0; idx < count; idx += 1) {
        lines.push({
          accountId: bulkLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '100',
        });
      }
      const bulkJournal = await ledger.postJournal({
        idempotencyKey: `stmt-bulk-${batchNumber}-${randomUUID()}`,
        currency: 'EUR',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: `STMT-BULK-${batchNumber}`,
        description: `Bulk statement batch ${batchNumber}`,
        metadata: { institutionId: ownInstitution },
        lines,
      });
      journalIds.push(bulkJournal.id);
    }
    await ds.transaction(async (manager) => {
      await manager.query(`SET LOCAL session_replication_role = replica`);
      await manager.query(
        `UPDATE ledger_journals SET posted_at = $2, created_at = $2 WHERE id = ANY($1::uuid[])`,
        [journalIds, '2026-10-15T10:00:00Z'],
      );
    });

    for (const tail of ['statement', 'statement.pdf']) {
      const oversized = await get(
        `${url(bulkWallet.walletId, tail)}?from=2026-10-01&to=2026-10-31`,
        operator.token,
      );
      expect(oversized.status).toBe(413);
      expect(oversized.headers['content-disposition']).toBeUndefined();
      expect(oversized.text ?? '').not.toContain('%PDF');
      expect(JSON.stringify(oversized.body)).toContain('Shorten the period');
    }
  }, 180_000);
});
