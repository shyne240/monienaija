#!/usr/bin/env node
'use strict';

/**
 * Platform Funds vs. Bank Balance — HTTP acceptance against a fully migrated, disposable
 * PostgreSQL database.
 *
 * This is an **isolated test bootstrap**, not the production entrypoint. It builds the real
 * `AppModule` with the real Fastify adapter, global validation pipe, exception filter, HTTP
 * security, request-context hooks, authorization guards and route policies, then listens on
 * loopback. The ONLY thing it does not do is call `ProductionReadinessService.verifyStartup()`,
 * because that gate deliberately refuses to serve while eight financial dependencies are
 * unverified. The gate itself is untouched: `src/main.ts` still refuses in exactly the same way.
 *
 * It signs in through the real local workforce endpoint using the seeded 11-role accounts and
 * their documented passwords (never modified here), seeds a conservation-exact NGN platform
 * ledger fixture (customer deposits, agent float, commission accrual/credit, fees, withdrawal
 * reserve/settle/release) and then proves over HTTP:
 *
 *   1. Reserving a Wallet→Bank payout leaves the ledger-expected bank balance UNCHANGED.
 *   2. Settling the reserved payout reduces the expected bank balance by exactly the reserved
 *      amount, exactly once.
 *   3. Releasing a reserved payout restores the wallet and records NO bank outflow.
 *   4. Commission accrued → credited to an agent wallet → paid out is counted EXACTLY ONCE in
 *      each bucket (UNPAID_AGENT_COMMISSIONS, then AGENT_FLOAT — never both), and the
 *      breakdown reconciles to the expected balance at every step.
 *   5. The governed maker-checker sign-off: FINANCE_PREPARER records/submits, an independent
 *      FINANCE_CONTROLLER reviews; sign-off is blocked while mapping is incomplete; ledger
 *      evidence drift after submission refuses approval; snapshots are immutable.
 *
 * Usage:
 *   PLATFORM_FUNDS_HTTP_ACCEPTANCE_CONFIRM=disposable-local-database \
 *     NODE_ENV=test node scripts/platform-funds-http-acceptance.cjs --out /tmp/platform-funds-http
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

require('dotenv').config();

const PORT = Number(process.env.PLATFORM_FUNDS_HTTP_ACCEPTANCE_PORT ?? 3101);
const OUT = path.resolve(
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : '/tmp/platform-funds-http',
);
const ROOT = path.resolve(__dirname, '..');
const RESULTS = [];
const TRANSCRIPT = [];

function record(name, ok, detail) {
  RESULTS.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
}

function guardEnvironment() {
  const errors = [];
  if (process.env.PLATFORM_FUNDS_HTTP_ACCEPTANCE_CONFIRM !== 'disposable-local-database')
    errors.push('set PLATFORM_FUNDS_HTTP_ACCEPTANCE_CONFIRM=disposable-local-database');
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? ''))
    errors.push('NODE_ENV must be development or test');
  if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST ?? ''))
    errors.push('DB_HOST must be loopback');
  for (const worker of ['NOTIFICATION_WORKER_ENABLED', 'CASH_TO_CASH_EXPIRY_WORKER_ENABLED']) {
    if ((process.env[worker] ?? 'false') === 'true') errors.push(`${worker} must be false`);
  }
  process.env.KYC_TIER_WORKER_ENABLED = 'false';
  if (errors.length) throw new Error(`Refusing to run: ${errors.join('; ')}`);
}

const emailFor = (role) => `${role.toLowerCase().replace(/_/g, '-')}@monienaija.local`;
const passwordFor = (role) => `MonieNaija_${role}_123!`;

// Immutable ledger rows cannot be deleted, so every run gets its own run-scoped references.
const RUN = randomUUID().slice(0, 8).toUpperCase();
// The cutoff sits in the near future so every fixture journal below is in scope.
// parseCutoff allows at most 60s of future skew; 30s covers the whole fixture.
const LEDGER_CUTOFF = new Date(Date.now() + 30_000).toISOString();
const BANK_CUTOFF = new Date().toISOString();
const STATEMENT_REFERENCE = `STMT-PF-ACC-${RUN}`;

const ACCOUNT_IDS = {
  customerWallet: randomUUID(),
  agentWallet: randomUUID(),
  mystery: randomUUID(),
};
const ACCOUNT_CODES = {
  customerWallet: `PF-${RUN}-CWALLET`,
  agentWallet: `PF-${RUN}-AWALLET`,
  mystery: `PF-${RUN}-UNMAPPED`,
};
// Well-known provisioned families/obligations (see migration 1785753600002 and 1785753600076).
const SETTLEMENT_ASSET_CODE = 'PAYMENT-SETTLEMENT_ASSET-NGN';
const WITHDRAWAL_RESERVE_CODE = 'PAYMENT-WITHDRAWAL_RESERVE-NGN';
const COMMISSION_EXPENSE_CODE = 'FINANCE-COMMISSION_EXPENSE-NGN';
const COMMISSION_PAYABLE_CODE = 'FINANCE-COMMISSION_PAYABLE-NGN';
const FEE_REVENUE_CODE = 'FINANCE-FEE_REVENUE-NGN';

// Amounts in minor units (NGN).
const FUND_CUSTOMER = 1_000_000n;
const FUND_AGENT = 500_000n;
const COMMISSION = 150_000n;
const FEE = 50_000n;
const RESERVE_A = 300_000n;
const RESERVE_B = 150_000n;
const DRIFT = 75_000n;
const MYSTERY = 25_000n;
const EXPECTED_AFTER_FUNDING = FUND_CUSTOMER + FUND_AGENT; // 1,500,000
const EXPECTED_AFTER_SETTLEMENT = EXPECTED_AFTER_FUNDING - RESERVE_A; // 1,200,000

const linesOf = (pairs) => pairs.map(([accountId, direction, amountMinor]) => ({ accountId, direction, amountMinor }));
const mn = (value) => BigInt(value);

async function accountIdByCode(dataSource, code) {
  const rows = await dataSource.query(
    'SELECT id::text AS id FROM ledger_accounts WHERE code = $1',
    [code],
  );
  if (!rows[0]) throw new Error(`account ${code} not found — is the database fully migrated?`);
  return rows[0].id;
}

async function seedAccounts(dataSource, run) {
  // Wallet owner classes are derived by trigger from the customers/agents tables
  // (wallet_owner_class(ref)): exactly one matching row and no cross-match => that class.
  // The rows must really exist or every wallet lands in REVIEW and blocks mapping.
  const customerId = randomUUID();
  const agentId = randomUUID();
  await dataSource.query(
    `INSERT INTO customers
       (id, reference, customer_type, status, kyc_level, kyc_status, version, created_at, updated_at, is_synthetic)
     VALUES ($1,$2,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED',1,now(),now(),FALSE)`,
    [customerId, `pf-acc-customer-${run.toLowerCase()}`],
  );
  await dataSource.query(
    `INSERT INTO agents (id, reference, status, version, created_at, updated_at)
     VALUES ($1,$2,'ACTIVE',1,now(),now())`,
    [agentId, `pf-acc-agent-${run.toLowerCase()}`],
  );

  const insert = (id, code, name, accountType, normalBalance) =>
    dataSource.query(
      `INSERT INTO ledger_accounts
         (id, code, name, account_type, normal_balance, currency, accounting_unit,
          allow_negative_balance, is_active, institutional_scope, institution_id, institutional_purpose,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'NGN','CUSTOMER_FUNDS',FALSE,TRUE,'UNATTRIBUTED',NULL,NULL,now(),now())`,
      [id, code, name, accountType, normalBalance],
    );
  await insert(ACCOUNT_IDS.customerWallet, ACCOUNT_CODES.customerWallet, 'Acceptance customer wallet liability', 'LIABILITY', 'CREDIT');
  await insert(ACCOUNT_IDS.agentWallet, ACCOUNT_CODES.agentWallet, 'Acceptance agent wallet liability', 'LIABILITY', 'CREDIT');

  for (const [id, principalId, ledgerAccountId] of [
    [randomUUID(), customerId, ACCOUNT_IDS.customerWallet],
    [randomUUID(), agentId, ACCOUNT_IDS.agentWallet],
  ]) {
    await dataSource.query(
      `INSERT INTO wallet_accounts
         (id, customer_id, currency, status, ledger_account_id, owner_class, created_at, updated_at)
       VALUES ($1,$2,'NGN','ACTIVE',$3,'REVIEW',now(),now())`,
      [id, principalId, ledgerAccountId],
    );
  }
}

async function postJournal(dataSource, seq, reference, lines) {
  const id = randomUUID();
  const total = lines
    .filter((line) => line.direction === 'DEBIT')
    .reduce((sum, line) => sum + mn(line.amountMinor), 0n);
  await dataSource.transaction(async (trx) => {
    await trx.query(
      `INSERT INTO ledger_journals
         (id, idempotency_key, request_hash, currency, accounting_unit, status, reference,
          description, institution_id, total_minor, metadata, created_at, posted_at)
       VALUES ($1,$2,$3,'NGN','CUSTOMER_FUNDS','POSTED',$4,$5,NULL,$6,'{}'::jsonb,now(),now())`,
      [
        id,
        `pf-http-acceptance:${RUN}:${seq}`,
        seq.toString().padStart(64, '0'),
        `PF-ACC-${RUN}-${seq}`,
        reference,
        total.toString(),
      ],
    );
    for (let i = 0; i < lines.length; i += 1) {
      await trx.query(
        `INSERT INTO ledger_lines
           (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit, created_at)
         VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'NGN','CUSTOMER_FUNDS',now())`,
        [id, lines[i].accountId, i + 1, lines[i].direction, mn(lines[i].amountMinor).toString()],
      );
    }
  });
  return id;
}

async function main() {
  guardEnvironment();
  fs.mkdirSync(OUT, { recursive: true });

  const { validateEnvironment } = require('../dist/config/environment');
  const { NestFactory } = require('@nestjs/core');
  const { FastifyAdapter } = require('@nestjs/platform-fastify');
  const { ValidationPipe } = require('@nestjs/common');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../dist/app.module');
  const { applyHttpSecurity, fastifyAdapterOptions } = require('../dist/production/http-security');
  const { registerRequestContextHooks } = require('../dist/production/request-hooks');
  const { GlobalExceptionFilter } = require('../dist/http-exception.filter');
  const { RequestTrackerService } = require('../dist/production/request-tracker.service');
  const { applyProcessRoleEnvironment, resolveProcessRole } = require('../dist/production/process-role');

  const environment = validateEnvironment(process.env);
  for (const change of applyProcessRoleEnvironment(resolveProcessRole('api'), process.env))
    console.log(`process role: ${change}`);

  const app = await NestFactory.create(
    AppModule,
    new FastifyAdapter(fastifyAdapterOptions(environment)),
    { bufferLogs: true, rawBody: true, logger: ['error', 'warn'] },
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter(console));
  applyHttpSecurity(app, environment);
  registerRequestContextHooks(app.getHttpAdapter().getInstance(), {
    requestTracker: app.get(RequestTrackerService),
    apiVersion: environment.API_VERSION,
  });

  const dataSource = app.get(DataSource);
  const settlementAssetId = await accountIdByCode(dataSource, SETTLEMENT_ASSET_CODE);
  const reserveId = await accountIdByCode(dataSource, WITHDRAWAL_RESERVE_CODE);
  const commissionExpenseId = await accountIdByCode(dataSource, COMMISSION_EXPENSE_CODE);
  const commissionPayableId = await accountIdByCode(dataSource, COMMISSION_PAYABLE_CODE);
  const feeRevenueId = await accountIdByCode(dataSource, FEE_REVENUE_CODE);
  await seedAccounts(dataSource, RUN);

  await app.init();
  await app.listen({ port: PORT, host: '127.0.0.1' });

  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const call = async (route, options = {}) => {
    const headers = { accept: 'application/json', ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(`${base}${route}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const redact = (value) => {
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          /password|accesstoken|token|authorization/i.test(key)
            ? '[REDACTED]'
            : typeof entry === 'string'
              ? entry.replace(/eyJ[A-Za-z0-9_-]+/g, '[REDACTED]')
              : redact(entry),
        ]),
      );
    };
    TRANSCRIPT.push({
      method: options.method ?? 'GET',
      route,
      status: response.status,
      body: redact(options.body ?? null),
      responsePreview:
        typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(redact(body)).slice(0, 400),
    });
    return { status: response.status, body };
  };

  const login = async (role) => {
    const response = await call('/internal/a2/workforce/local-admin-sessions', {
      method: 'POST',
      body: { email: emailFor(role), password: passwordFor(role) },
    });
    record(
      `LOGIN-${role}`,
      response.status < 300 && !!response.body?.accessToken,
      `HTTP ${response.status}`,
    );
    return response.body?.accessToken;
  };

  const preparer = await login('FINANCE_PREPARER');
  const controller = await login('FINANCE_CONTROLLER');
  const auditor = await login('FINANCE_AUDITOR');
  const treasury = await login('TREASURY');
  const superAdmin = await login('SUPER_ADMIN');

  const preview = async (token) => {
    const response = await call('/internal/finance-operations/platform-funds/comparisons/preview', {
      method: 'POST',
      token,
      body: { settlementAccountId: settlementAssetId, ledgerCutoff: LEDGER_CUTOFF },
    });
    return response;
  };
  const expectPreview = async (name, checks) => {
    const response = await preview(preparer);
    const bd = response.body ?? {};
    const line = (key) => (bd.lines ?? []).find((entry) => entry.key === key);
    const results = {
      status: response.status,
      settlementAccount: bd.settlementAccount,
      breakdownTotalMinor: bd.breakdownTotalMinor,
      reconciliationGapMinor: bd.reconciliationGapMinor,
      mappingComplete: bd.mappingComplete,
      blockers: bd.blockers,
      controlLine: bd.controlLine,
      evidenceHash: bd.evidenceHash,
      journalEvidence: bd.journalEvidence,
      CUSTOMER_WALLETS: line('CUSTOMER_WALLETS')?.contributionMinor,
      AGENT_FLOAT: line('AGENT_FLOAT')?.contributionMinor,
      UNPAID_AGENT_COMMISSIONS: line('UNPAID_AGENT_COMMISSIONS')?.contributionMinor,
      PLATFORM_EARNINGS_HELD: line('PLATFORM_EARNINGS_HELD')?.contributionMinor,
      OTHER_HELD: line('OTHER_HELD')?.contributionMinor,
    };
    const problems = checks(results) ?? [];
    record(name, response.status < 300 && problems.length === 0, problems.length === 0 ? 'breakdown as expected' : problems.join('; '));
    return results;
  };

  const S0 = await preview(preparer);
  record(
    'EMPTY-BOOKS-PREVIEW-ZERO-EXPECTED',
    S0.status < 300 && S0.body?.settlementAccount?.expectedMinor === '0' && S0.body?.mappingComplete === true,
    `HTTP ${S0.status}, expected=${S0.body?.settlementAccount?.expectedMinor}`,
  );

  // ---- stage 1: fund-in journals (customer deposit + agent float top-up) --------------------
  await postJournal(dataSource, '01', 'Customer deposit funded from bank', linesOf([
    [settlementAssetId, 'DEBIT', FUND_CUSTOMER],
    [ACCOUNT_IDS.customerWallet, 'CREDIT', FUND_CUSTOMER],
  ]));
  await postJournal(dataSource, '02', 'Agent float top-up funded from bank', linesOf([
    [settlementAssetId, 'DEBIT', FUND_AGENT],
    [ACCOUNT_IDS.agentWallet, 'CREDIT', FUND_AGENT],
  ]));
  await expectPreview('STAGE-1-FUNDING-EXPECTED-EQUALS-FUND-INS', (r) => {
    const problems = [];
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_FUNDING.toString()) problems.push(`expected ${r.settlementAccount?.expectedMinor}`);
    if (r.CUSTOMER_WALLETS !== FUND_CUSTOMER.toString()) problems.push(`CUSTOMER_WALLETS ${r.CUSTOMER_WALLETS}`);
    if (r.AGENT_FLOAT !== FUND_AGENT.toString()) problems.push(`AGENT_FLOAT ${r.AGENT_FLOAT}`);
    if (r.reconciliationGapMinor !== '0') problems.push(`gap ${r.reconciliationGapMinor}`);
    if (r.mappingComplete !== true) problems.push(`mappingComplete ${r.mappingComplete}, blockers ${JSON.stringify(r.blockers)}`);
    return problems;
  });

  // ---- stage 2: commission accrual (expense / payable) ---------------------------------------
  await postJournal(dataSource, '03', 'Commission accrual for agent work', linesOf([
    [commissionExpenseId, 'DEBIT', COMMISSION],
    [commissionPayableId, 'CREDIT', COMMISSION],
  ]));
  await expectPreview('STAGE-2-COMMISSION-ACCRUED-NOT-YET-IN-WALLET', (r) => {
    const problems = [];
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_FUNDING.toString()) problems.push(`expected moved to ${r.settlementAccount?.expectedMinor}`);
    if (r.UNPAID_AGENT_COMMISSIONS !== COMMISSION.toString()) problems.push(`UNPAID ${r.UNPAID_AGENT_COMMISSIONS}`);
    if (r.AGENT_FLOAT !== FUND_AGENT.toString()) problems.push(`AGENT_FLOAT ${r.AGENT_FLOAT}`);
    return problems;
  });

  // ---- stage 3: commission credited to the agent wallet --------------------------------------
  await postJournal(dataSource, '04', 'Commission payable settled into agent wallet', linesOf([
    [commissionPayableId, 'DEBIT', COMMISSION],
    [ACCOUNT_IDS.agentWallet, 'CREDIT', COMMISSION],
  ]));
  await expectPreview('STAGE-3-COMMISSION-COUNTED-ONCE-IN-AGENT-FLOAT', (r) => {
    const problems = [];
    if (r.UNPAID_AGENT_COMMISSIONS !== '0') problems.push(`UNPAID ${r.UNPAID_AGENT_COMMISSIONS}`);
    if (r.AGENT_FLOAT !== (FUND_AGENT + COMMISSION).toString()) problems.push(`AGENT_FLOAT ${r.AGENT_FLOAT}`);
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_FUNDING.toString()) problems.push(`expected ${r.settlementAccount?.expectedMinor}`);
    if (r.reconciliationGapMinor !== '0') problems.push(`gap ${r.reconciliationGapMinor}`);
    return problems;
  });

  // ---- stage 4: fee moved from customer wallet to platform earnings ---------------------------
  await postJournal(dataSource, '05', 'Transaction fee earned on customer wallet', linesOf([
    [ACCOUNT_IDS.customerWallet, 'DEBIT', FEE],
    [feeRevenueId, 'CREDIT', FEE],
  ]));
  await expectPreview('STAGE-4-FEE-DOES-NOT-MOVE-BANK-EXPECTATION', (r) => {
    const problems = [];
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_FUNDING.toString()) problems.push(`expected ${r.settlementAccount?.expectedMinor}`);
    if (r.CUSTOMER_WALLETS !== (FUND_CUSTOMER - FEE).toString()) problems.push(`CUSTOMER_WALLETS ${r.CUSTOMER_WALLETS}`);
    if (r.PLATFORM_EARNINGS_HELD !== (FEE - COMMISSION).toString()) problems.push(`EARNINGS ${r.PLATFORM_EARNINGS_HELD}`);
    return problems;
  });

  // ---- stage 5 (case 1): reserve a Wallet→Bank payout — expected bank UNCHANGED ----------------
  await postJournal(dataSource, '06', 'Withdrawal reserved from customer wallet', linesOf([
    [ACCOUNT_IDS.customerWallet, 'DEBIT', RESERVE_A],
    [reserveId, 'CREDIT', RESERVE_A],
  ]));
  await expectPreview('CASE-1-RESERVE-LEAVES-EXPECTED-BANK-UNCHANGED', (r) => {
    const problems = [];
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_FUNDING.toString()) problems.push(`expected moved to ${r.settlementAccount?.expectedMinor}`);
    if (r.OTHER_HELD !== RESERVE_A.toString()) problems.push(`WITHDRAWAL_RESERVE ${r.OTHER_HELD}`);
    if (r.CUSTOMER_WALLETS !== (FUND_CUSTOMER - FEE - RESERVE_A).toString()) problems.push(`CUSTOMER_WALLETS ${r.CUSTOMER_WALLETS}`);
    return problems;
  });

  // ---- stage 6 (case 2): settle the reserve — expected falls by exactly the reserved amount ----
  await postJournal(dataSource, '07', 'Withdrawal settled to bank account', linesOf([
    [reserveId, 'DEBIT', RESERVE_A],
    [settlementAssetId, 'CREDIT', RESERVE_A],
  ]));
  await expectPreview('CASE-2-SETTLEMENT-REDUCES-EXPECTED-EXACTLY-ONCE', (r) => {
    const problems = [];
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_SETTLEMENT.toString()) problems.push(`expected ${r.settlementAccount?.expectedMinor}`);
    if (r.OTHER_HELD !== '0') problems.push(`reserve ${r.OTHER_HELD}`);
    if (r.breakdownTotalMinor !== EXPECTED_AFTER_SETTLEMENT.toString()) problems.push(`breakdownTotal ${r.breakdownTotalMinor}`);
    if (r.reconciliationGapMinor !== '0') problems.push(`gap ${r.reconciliationGapMinor}`);
    return problems;
  });

  // ---- stage 7: reserve B (case 1, again) -----------------------------------------------------
  await postJournal(dataSource, '08', 'Second withdrawal reserved from customer wallet', linesOf([
    [ACCOUNT_IDS.customerWallet, 'DEBIT', RESERVE_B],
    [reserveId, 'CREDIT', RESERVE_B],
  ]));
  await expectPreview('CASE-1-SECOND-RESERVE-STILL-UNCHANGED', (r) => {
    const problems = [];
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_SETTLEMENT.toString()) problems.push(`expected ${r.settlementAccount?.expectedMinor}`);
    if (r.OTHER_HELD !== RESERVE_B.toString()) problems.push(`reserve ${r.OTHER_HELD}`);
    return problems;
  });

  // ---- stage 8 (case 3): release B — wallet restored, NO bank outflow -------------------------
  await postJournal(dataSource, '09', 'Withdrawal reservation released to customer wallet', linesOf([
    [reserveId, 'DEBIT', RESERVE_B],
    [ACCOUNT_IDS.customerWallet, 'CREDIT', RESERVE_B],
  ]));
  const stage8 = await expectPreview('CASE-3-RELEASE-RESTORES-WALLET-NO-BANK-OUTFLOW', (r) => {
    const problems = [];
    if (r.settlementAccount?.expectedMinor !== EXPECTED_AFTER_SETTLEMENT.toString()) problems.push(`expected ${r.settlementAccount?.expectedMinor}`);
    if (r.OTHER_HELD !== '0') problems.push(`reserve ${r.OTHER_HELD}`);
    if (r.CUSTOMER_WALLETS !== (FUND_CUSTOMER - FEE - RESERVE_A).toString()) problems.push(`wallet not restored: ${r.CUSTOMER_WALLETS}`);
    return problems;
  });

  // ===================== comparison #1: full governed sign-off ================================
  const settlementAccounts = await call('/internal/finance-operations/platform-funds/settlement-accounts', { token: preparer });
  const settlementAccount = settlementAccounts.body?.items?.find(
    (item) => item.id === settlementAssetId,
  );
  record(
    'SETTLEMENT-ACCOUNTS-LIST-INCLUDES-PLATFORM-SETTLEMENT-ASSET',
    settlementAccounts.status === 200 && !!settlementAccount && settlementAccount.selectable === true,
    `HTTP ${settlementAccounts.status}, items=${settlementAccounts.body?.items?.length}`,
  );

  const created = await call('/internal/finance-operations/platform-funds/comparisons', {
    method: 'POST',
    token: preparer,
    body: {
      settlementAccountId: settlementAssetId,
      ledgerCutoff: LEDGER_CUTOFF,
      bankCutoff: BANK_CUTOFF,
      statementReference: STATEMENT_REFERENCE,
      bankBalanceMinor: EXPECTED_AFTER_SETTLEMENT.toString(),
    },
  });
  const createdBreakdown = created.body?.breakdown;
  record(
    'COMPARISON-CREATED-CONSERVED-ZERO-DIFFERENCE',
    created.status === 201 &&
      created.body?.status === 'DRAFT' &&
      created.body?.expectedMinor === EXPECTED_AFTER_SETTLEMENT.toString() &&
      created.body?.differenceMinor === '0' &&
      created.body?.unexplainedMinor === '0' &&
      created.body?.mappingComplete === true &&
      createdBreakdown?.evidenceHash === stage8.evidenceHash,
    `HTTP ${created.status}, diff=${created.body?.differenceMinor}, hashMatch=${createdBreakdown?.evidenceHash === stage8.evidenceHash}`,
  );
  const comparisonId = created.body?.id;

  // Money the bank shows more than the ledger expects: a timing difference to document.
  const patched = await call(`/internal/finance-operations/platform-funds/comparisons/${comparisonId}`, {
    method: 'PATCH',
    token: preparer,
    body: { bankBalanceMinor: (EXPECTED_AFTER_SETTLEMENT + 50_000n).toString() },
  });
  record(
    'BANK-BALANCE-UPDATE-RECOMPUTES-DIFFERENCE',
    patched.status === 200 &&
      patched.body?.bankBalanceMinor === (EXPECTED_AFTER_SETTLEMENT + 50_000n).toString() &&
      patched.body?.differenceMinor === '50000' &&
      patched.body?.unexplainedMinor === '50000' &&
      patched.body?.timingTotalMinor === '0',
    `HTTP ${patched.status}, diff=${patched.body?.differenceMinor}, unexplained=${patched.body?.unexplainedMinor}`,
  );

  const zeroTiming = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/timing-items`,
    {
      method: 'POST',
      token: preparer,
      body: { title: 'Zero line explains nothing', reference: 'STMT-LINE-0', explanation: 'Attempting a zero timing item', amountMinor: '0' },
    },
  );
  record('ZERO-TIMING-ITEM-REJECTED', zeroTiming.status === 400, `HTTP ${zeroTiming.status}`);

  const timing = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/timing-items`,
    {
      method: 'POST',
      token: preparer,
      body: {
        title: 'Deposit in transit per statement line 12',
        reference: `${STATEMENT_REFERENCE}:line12`,
        explanation: 'Customer deposit reached the bank after the ledger cutoff; bank shows it, ledger expectation does not yet.',
        amountMinor: '50000',
      },
    },
  );
  record(
    'TIMING-ITEM-ABSORBS-THE-DIFFERENCE',
    timing.status === 201 &&
      timing.body?.timingTotalMinor === '50000' &&
      timing.body?.unexplainedMinor === '0',
    `HTTP ${timing.status}, timingTotal=${timing.body?.timingTotalMinor}, unexplained=${timing.body?.unexplainedMinor}`,
  );

  const submitAsController = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/submit`,
    { method: 'POST', token: controller, body: { reason: 'Checker must not be the maker' } },
  );
  record('CONTROLLER-CANNOT-SUBMIT-AS-MAKER', submitAsController.status === 403, `HTTP ${submitAsController.status}`);

  const reviewAsPreparer = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/review`,
    { method: 'POST', token: preparer, body: { decision: 'APPROVE', reason: 'Maker must not approve' } },
  );
  record('PREPARER-CANNOT-REVIEW-AS-CHECKER', reviewAsPreparer.status === 403, `HTTP ${reviewAsPreparer.status}`);

  const submitted = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/submit`,
    { method: 'POST', token: preparer, body: { reason: 'Books conserved; difference fully explained by one timing item' } },
  );
  record(
    'MAKER-SUBMITS-FOR-REVIEW',
    submitted.status === 201 && submitted.body?.status === 'SUBMITTED',
    `HTTP ${submitted.status}, status=${submitted.body?.status}`,
  );

  const timingAfterSubmit = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/timing-items`,
    {
      method: 'POST',
      token: preparer,
      body: { title: 'Late timing item', reference: 'STMT-LATE', explanation: 'Too late; items freeze on submit', amountMinor: '1000' },
    },
  );
  record('TIMING-ITEMS-FREEZE-AFTER-SUBMIT', timingAfterSubmit.status === 409, `HTTP ${timingAfterSubmit.status}`);

  const resubmit = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/submit`,
    { method: 'POST', token: preparer, body: { reason: 'Second submit must be refused' } },
  );
  record('DOUBLE-SUBMIT-REFUSED', resubmit.status === 409, `HTTP ${resubmit.status}`);

  const approved = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/review`,
    { method: 'POST', token: controller, body: { decision: 'APPROVE', reason: 'Reviewed evidence, timing item verified against statement line 12' } },
  );
  record(
    'INDEPENDENT-CONTROLLER-APPROVES',
    approved.status < 300 && approved.body?.status === 'APPROVED' && approved.body?.approval?.status === 'APPROVED',
    `HTTP ${approved.status}, status=${approved.body?.status}, approval=${approved.body?.approval?.status}`,
  );

  const snapshots = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId}/snapshots`,
    { token: auditor },
  );
  const snapshotReasons = (snapshots.body?.items ?? []).map((item) => item.reason);
  record(
    'SNAPSHOTS-RECORDED-CREATED-UPDATED-SUBMITTED-APPROVED',
    snapshots.status === 200 &&
      JSON.stringify(snapshotReasons) === JSON.stringify(['CREATED', 'UPDATED', 'SUBMITTED', 'REVIEW_APPROVED']),
    `HTTP ${snapshots.status}, reasons=${snapshotReasons.join(',')}`,
  );

  // Snapshots are immutable evidence: a direct UPDATE must be refused by the database trigger.
  let snapshotGuard = 'not-tested';
  try {
    await dataSource.query(
      `UPDATE platform_funds_comparison_snapshots SET reason = 'TAMPERED' WHERE comparison_id = $1`,
      [comparisonId],
    );
    snapshotGuard = 'UPDATE SUCCEEDED (guard missing)';
  } catch (error) {
    snapshotGuard = `refused: ${String(error.message ?? error).slice(0, 120)}`;
  }
  record(
    'SNAPSHOT-TAMPERING-REFUSED-BY-DATABASE',
    /immutable|55000|refus/i.test(snapshotGuard),
    snapshotGuard,
  );

  // ===================== comparison #2: evidence drift refuses approval ========================
  const created2 = await call('/internal/finance-operations/platform-funds/comparisons', {
    method: 'POST',
    token: preparer,
    body: {
      settlementAccountId: settlementAssetId,
      ledgerCutoff: LEDGER_CUTOFF,
      bankCutoff: BANK_CUTOFF,
      statementReference: `${STATEMENT_REFERENCE}-DRIFT`,
      bankBalanceMinor: (EXPECTED_AFTER_SETTLEMENT + 75_000n).toString(),
    },
  });
  const comparisonId2 = created2.body?.id;
  record(
    'DRIFT-COMPARISON-CREATED',
    created2.status === 201 && created2.body?.differenceMinor === '75000',
    `HTTP ${created2.status}, id=${comparisonId2}`,
  );
  const submitted2 = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId2}/submit`,
    { method: 'POST', token: preparer, body: { reason: 'Submit before ledger evidence moves' } },
  );
  record('DRIFT-COMPARISON-SUBMITTED', submitted2.status === 201, `HTTP ${submitted2.status}`);

  // The books move after submission: a new bank-funded deposit posts at or before the cutoff.
  await postJournal(dataSource, '10', 'Late bank-funded customer deposit posted after submit', linesOf([
    [settlementAssetId, 'DEBIT', DRIFT],
    [ACCOUNT_IDS.customerWallet, 'CREDIT', DRIFT],
  ]));
  const driftApprove = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId2}/review`,
    { method: 'POST', token: controller, body: { decision: 'APPROVE', reason: 'Must be refused: evidence moved' } },
  );
  record(
    'APPROVAL-REFUSED-AFTER-LEDGER-EVIDENCE-DRIFT',
    driftApprove.status === 409 && /evidence changed/i.test(JSON.stringify(driftApprove.body)),
    `HTTP ${driftApprove.status}`,
  );

  // ===================== comparison #3: incomplete mapping blocks sign-off =====================
  // NB: the unmapped account is created here — not at seed time — so the books stay clean
  // (and mappingComplete=true) for everything asserted above.
  await dataSource.query(
    `INSERT INTO ledger_accounts
       (id, code, name, account_type, normal_balance, currency, accounting_unit,
        allow_negative_balance, is_active, institutional_scope, institution_id, institutional_purpose,
        created_at, updated_at)
     VALUES ($1,$2,'Acceptance deliberately unmapped liability','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE,'UNATTRIBUTED',NULL,NULL,now(),now())`,
    [ACCOUNT_IDS.mystery, ACCOUNT_CODES.mystery],
  );
  await postJournal(dataSource, '11', 'Unmappable liability funded from bank', linesOf([
    [settlementAssetId, 'DEBIT', MYSTERY],
    [ACCOUNT_IDS.mystery, 'CREDIT', MYSTERY],
  ]));
  const blockedPreview = await call(
    '/internal/finance-operations/platform-funds/comparisons/preview',
    {
      method: 'POST',
      token: preparer,
      body: { settlementAccountId: settlementAssetId, ledgerCutoff: LEDGER_CUTOFF },
    },
  );
  const blockedCodes = (blockedPreview.body?.blockers ?? []).map((blocker) => blocker.code);
  record(
    'UNMAPPED-ACCOUNT-SURFACES-BLOCKER-BUT-CONSERVES',
    blockedPreview.status < 300 &&
      blockedPreview.body?.mappingComplete === false &&
      blockedCodes.includes('ACCOUNT_NOT_MAPPED') &&
      blockedPreview.body?.reconciliationGapMinor === '0',
    `HTTP ${blockedPreview.status}, blockers=${blockedCodes.join(',')}, gap=${blockedPreview.body?.reconciliationGapMinor}`,
  );
  const created3 = await call('/internal/finance-operations/platform-funds/comparisons', {
    method: 'POST',
    token: preparer,
    body: {
      settlementAccountId: settlementAssetId,
      ledgerCutoff: LEDGER_CUTOFF,
      bankCutoff: BANK_CUTOFF,
      statementReference: `${STATEMENT_REFERENCE}-BLOCKED`,
      bankBalanceMinor: (EXPECTED_AFTER_SETTLEMENT + DRIFT + MYSTERY).toString(),
    },
  });
  const comparisonId3 = created3.body?.id;
  const submit3 = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonId3}/submit`,
    { method: 'POST', token: preparer, body: { reason: 'Sign-off must be blocked' } },
  );
  record(
    'SIGN-OFF-BLOCKED-WHILE-MAPPING-INCOMPLETE',
    submit3.status === 409 && /block/i.test(JSON.stringify(submit3.body)),
    `HTTP ${submit3.status}`,
  );

  // ===================== scope and role denials ================================================
  const unauth = await call('/internal/finance-operations/platform-funds/comparisons');
  record('UNAUTHENTICATED-READ-DENIED', unauth.status === 401, `HTTP ${unauth.status}`);

  const treasuryList = await call('/internal/finance-operations/platform-funds/comparisons', { token: treasury });
  const treasuryAccounts = await call('/internal/finance-operations/platform-funds/settlement-accounts', { token: treasury });
  record(
    'TREASURY-WITHOUT-LEDGER-VIEW-DENIED',
    treasuryList.status === 403 && treasuryAccounts.status === 403,
    `comparisons HTTP ${treasuryList.status}, settlement-accounts HTTP ${treasuryAccounts.status}`,
  );

  const createAsController = await call('/internal/finance-operations/platform-funds/comparisons', {
    method: 'POST',
    token: controller,
    body: {
      settlementAccountId: settlementAssetId,
      ledgerCutoff: LEDGER_CUTOFF,
      bankCutoff: BANK_CUTOFF,
      statementReference: `${STATEMENT_REFERENCE}-CHECKER`,
      bankBalanceMinor: EXPECTED_AFTER_SETTLEMENT.toString(),
    },
  });
  record('CONTROLLER-CANNOT-CREATE-AS-MAKER', createAsController.status === 403, `HTTP ${createAsController.status}`);

  const auditorRead = await call('/internal/finance-operations/platform-funds/comparisons', { token: auditor });
  record('AUDITOR-CAN-READ-COMPARISONS', auditorRead.status === 200, `HTTP ${auditorRead.status}`);

  const superAdminRead = await call('/internal/finance-operations/platform-funds/settlement-accounts', { token: superAdmin });
  record('SUPER-ADMIN-CAN-READ-SETTLEMENT-ACCOUNTS', superAdminRead.status === 200, `HTTP ${superAdminRead.status}`);

  await app.close();
  const gitCommit = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
    } catch {
      return 'unknown';
    }
  })();
  const failed = RESULTS.filter((entry) => !entry.ok);
  fs.writeFileSync(
    path.join(OUT, 'platform-funds-http-acceptance.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        gitCommit,
        run: RUN,
        bootstrap:
          'isolated test bootstrap: real AppModule/Fastify/guards/route policies, readiness gate skipped',
        database: { host: process.env.DB_HOST, port: process.env.DB_PORT, name: process.env.DB_NAME },
        assertions: RESULTS,
        transcript: TRANSCRIPT,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n${RESULTS.length - failed.length}/${RESULTS.length} HTTP checks passed -> ${path.join(OUT, 'platform-funds-http-acceptance.json')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('platform funds HTTP acceptance failed to run:', error);
  process.exit(3);
});
