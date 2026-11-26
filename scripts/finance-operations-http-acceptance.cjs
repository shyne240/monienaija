#!/usr/bin/env node
'use strict';

/**
 * Finance Operations — HTTP acceptance against a fully migrated, disposable PostgreSQL database.
 *
 * This is an **isolated test bootstrap**, not the production entrypoint. It builds the real
 * `AppModule` with the real Fastify adapter, global validation pipe, exception filter, HTTP
 * security, request-context hooks, authorization guards and route policies, then listens on
 * loopback. The ONLY thing it does not do is call `ProductionReadinessService.verifyStartup()`,
 * because that gate deliberately refuses to serve while eight financial dependencies are
 * unverified. The gate itself is untouched: `src/main.ts` still refuses in exactly the same way.
 *
 * It signs in through the real local workforce endpoint using the seeded 11-role accounts and
 * their documented passwords (never modified here), then exercises:
 *
 *   - authorized journal search / detail and scoped filters;
 *   - cross-institution denial (404) on finance and legacy ledger reads;
 *   - reversal eligibility before, during and after the governed maker-checker workflow;
 *   - the real request → approve → execute reversal workflow;
 *   - reconciliation evidence semantics (missing external evidence is NOT_PERFORMED).
 *
 * Usage:
 *   FINANCE_HTTP_ACCEPTANCE_CONFIRM=disposable-local-database \
 *     NODE_ENV=test node scripts/finance-operations-http-acceptance.cjs --out /tmp/finance-http
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

require('dotenv').config();

const PORT = Number(process.env.FINANCE_HTTP_ACCEPTANCE_PORT ?? 3100);
const OUT = path.resolve(
  process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : '/tmp/finance-http',
);
const RESULTS = [];
const TRANSCRIPT = [];

function record(name, ok, detail) {
  RESULTS.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
}

function guardEnvironment() {
  const errors = [];
  if (process.env.FINANCE_HTTP_ACCEPTANCE_CONFIRM !== 'disposable-local-database')
    errors.push('set FINANCE_HTTP_ACCEPTANCE_CONFIRM=disposable-local-database');
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? ''))
    errors.push('NODE_ENV must be development or test');
  if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST ?? ''))
    errors.push('DB_HOST must be loopback');
  for (const worker of ['NOTIFICATION_WORKER_ENABLED', 'CASH_TO_CASH_EXPIRY_WORKER_ENABLED']) {
    if ((process.env[worker] ?? 'false') === 'true') errors.push(`${worker} must be false`);
  }
  // The API process role disables worker drivers anyway; pin the KYC tier worker off explicitly so
  // the isolated bootstrap starts no timers before the role is applied.
  process.env.KYC_TIER_WORKER_ENABLED = 'false';
  if (errors.length) throw new Error(`Refusing to run: ${errors.join('; ')}`);
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const emailFor = (role) => `${role.toLowerCase().replace(/_/g, '-')}@monienaija.local`;
const passwordFor = (role) => `MonieNaija_${role}_123!`;
const principalFor = (email, issuer) =>
  `${issuer}:local-admin-credential:${sha256(email).slice(0, 32)}`;

const uuid = (suffix) => `aaaaaaaa-0000-4000-8000-${suffix.padStart(12, '0')}`;
const INST_A = uuid('000000000001');
const INST_B = uuid('000000000002');
const ACC_A_DEBIT = uuid('000000000011');
const ACC_A_CREDIT = uuid('000000000012');
const ACC_B_DEBIT = uuid('000000000021');
const ACC_B_CREDIT = uuid('000000000022');
// Immutable ledger rows cannot be deleted, so every run creates fresh journals and references.
const RUN = randomUUID().slice(0, 8);
const JOURNAL_A = randomUUID();
const JOURNAL_B = randomUUID();
const REF_A = `FIN-ACC-A-${RUN}`;
const REF_B = `FIN-ACC-B-${RUN}`;

async function seedFixtures(dataSource, actor) {
  const manager = dataSource.manager;
  const query = (sql, params) => manager.query(sql, params);

  /*
   * Institution lifecycle rows are normally created through the protected authority (a separate
   * credential) and its triggers refuse a direct APPROVED insert. This disposable acceptance
   * fixture therefore creates its two institutions with row triggers suspended, only for these two
   * INSERTs, and restores the normal replication role immediately. Nothing about the runtime path
   * changes: the API still cannot create an APPROVED institution this way.
   */
  await query("SET session_replication_role = 'replica'");
  try {
    for (const [id, code, name] of [
      [INST_A, 'FIA', 'Acceptance Institution A'],
      [INST_B, 'FIB', 'Acceptance Institution B'],
    ]) {
      await query(
        `INSERT INTO financial_institutions
           (id, reference, code, legal_name, display_name, institution_type, status,
            lifecycle_approval_id, operational_approved_at, operational_approved_by,
            created_by, updated_by)
         VALUES ($1,$2,$3,$4,$4,'MMO','APPROVED',$5,now(),$6,$6,$6)
         ON CONFLICT (id) DO NOTHING`,
        [id, `FIN-${code}`, code, name, `dddddddd-0000-4000-8000-${id.slice(-12)}`, actor],
      );
    }
  } finally {
    await query("SET session_replication_role = 'origin'");
  }

  for (const [id, code, name, institution, type, normal] of [
    [ACC_A_DEBIT, 'FIA-1100', 'Institution A customer funds', INST_A, 'ASSET', 'DEBIT'],
    [ACC_A_CREDIT, 'FIA-2100', 'Institution A settlement payable', INST_A, 'LIABILITY', 'CREDIT'],
    [ACC_B_DEBIT, 'FIB-1100', 'Institution B customer funds', INST_B, 'ASSET', 'DEBIT'],
    [ACC_B_CREDIT, 'FIB-2100', 'Institution B settlement payable', INST_B, 'LIABILITY', 'CREDIT'],
  ]) {
    await query(
      `INSERT INTO ledger_accounts
         (id, code, name, account_type, normal_balance, currency, accounting_unit,
          institutional_scope, institution_id)
       VALUES ($1,$2,$3,$4,$5,'NGN','CUSTOMER_FUNDS','INSTITUTION',$6)
       ON CONFLICT (id) DO NOTHING`,
      [id, code, name, type, normal, institution],
    );
  }

  // One transaction per run so the deferred balance trigger (INITIALLY DEFERRED) evaluates each
  // journal after both of its lines exist, exactly as the real posting path does.
  await dataSource.transaction(async (trx) => {
    for (const [id, institution, debit, credit, client] of [
      [JOURNAL_A, INST_A, ACC_A_DEBIT, ACC_A_CREDIT, 'IN-A'],
      [JOURNAL_B, INST_B, ACC_B_DEBIT, ACC_B_CREDIT, 'IN-B'],
    ]) {
      const reference = id === JOURNAL_A ? REF_A : REF_B;
      await trx.query(
        `INSERT INTO ledger_journals
           (id, idempotency_key, request_hash, currency, accounting_unit, status, reference,
            description, institution_id, total_minor, posted_at)
         VALUES ($1,$2,$3,'NGN','CUSTOMER_FUNDS','POSTED',$4,'Acceptance journal',$5,100000,now())`,
        [id, `finance-http-acceptance:${id}`, 'a'.repeat(64), reference, institution],
      );
      await trx.query(
        `INSERT INTO ledger_lines
           (id, journal_id, ledger_account_id, line_number, direction, amount_minor, currency, accounting_unit)
         VALUES (gen_random_uuid(),$1,$2,1,'DEBIT',100000,'NGN','CUSTOMER_FUNDS'),
                (gen_random_uuid(),$1,$3,2,'CREDIT',100000,'NGN','CUSTOMER_FUNDS')`,
        [id, debit, credit],
      );
      void client;
    }
  });

  const issuer = process.env.A2_WORKFORCE_OIDC_ISSUER;
  if (!issuer) throw new Error('A2_WORKFORCE_OIDC_ISSUER is required');
  await query('DELETE FROM workforce_institution_assignments WHERE institution_id = ANY($1)', [
    [INST_A, INST_B],
  ]);
  for (const role of ['FINANCE_AUDITOR', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'TREASURY']) {
    await query(
      `INSERT INTO workforce_institution_assignments
         (principal_id, institution_id, status, granted_by)
       VALUES ($1,$2,'ACTIVE',$3)`,
      [principalFor(emailFor(role), issuer), INST_A, actor],
    );
  }
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
  await seedFixtures(dataSource, 'finance-http-acceptance');
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
    // Evidence is shareable: credentials and bearer tokens never enter the transcript.
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
    record(`LOGIN-${role}`, response.status < 300 && !!response.body?.accessToken, `HTTP ${response.status}`);
    return response.body?.accessToken;
  };

  const auditor = await login('FINANCE_AUDITOR');
  const preparer = await login('FINANCE_PREPARER');
  const controller = await login('FINANCE_CONTROLLER');
  const treasury = await login('TREASURY');
  const superAdmin = await login('SUPER_ADMIN');

  const unauth = await call(`/internal/finance-operations/ledger/journals?reference=${REF_A}`);
  record('UNAUTHENTICATED-READ-DENIED', unauth.status === 401, `HTTP ${unauth.status}`);

  const searchA = await call(
    `/internal/finance-operations/ledger/journals?reference=${REF_A}`,
    { token: preparer },
  );
  record(
    'AUTHORIZED-SEARCH-RETURNS-INSTITUTION-RECORD',
    searchA.status === 200 &&
      searchA.body?.items?.length === 1 &&
      searchA.body.items[0].id === JOURNAL_A,
    `HTTP ${searchA.status}, items=${searchA.body?.items?.length}`,
  );

  const searchB = await call(
    `/internal/finance-operations/ledger/journals?reference=${REF_B}`,
    { token: preparer },
  );
  record(
    'SEARCH-DOES-NOT-LEAK-OTHER-INSTITUTION',
    searchB.status === 200 && searchB.body?.items?.length === 0,
    `HTTP ${searchB.status}, items=${searchB.body?.items?.length}`,
  );

  const detailA = await call(`/internal/finance-operations/ledger/journals/${JOURNAL_A}`, {
    token: preparer,
  });
  record(
    'AUTHORIZED-DETAIL-SHOWS-ATTRIBUTION-AND-LINES',
    detailA.status === 200 &&
      detailA.body?.institution?.id === INST_A &&
      detailA.body?.lines?.length === 2 &&
      detailA.body?.reversal?.kind === 'NORMAL',
    `HTTP ${detailA.status}, lines=${detailA.body?.lines?.length}, kind=${detailA.body?.reversal?.kind}`,
  );

  const detailB = await call(`/internal/finance-operations/ledger/journals/${JOURNAL_B}`, {
    token: preparer,
  });
  const ledgerB = await call(`/ledger/journals/${JOURNAL_B}`, { token: preparer });
  record(
    'CROSS-INSTITUTION-READ-DENIED-404',
    detailB.status === 404 && ledgerB.status === 404,
    `finance HTTP ${detailB.status}, legacy ledger HTTP ${ledgerB.status}`,
  );

  const breaksB = await call(
    `/internal/finance-operations/reconciliation/breaks?institutionId=${INST_B}`,
    { token: treasury },
  );
  record(
    'CROSS-INSTITUTION-RECONCILIATION-DENIED-404',
    breaksB.status === 404,
    `HTTP ${breaksB.status}`,
  );

  const breaksA = await call(
    `/internal/finance-operations/reconciliation/breaks?institutionId=${INST_A}`,
    { token: treasury },
  );
  const externalProvider = breaksA.body?.sources?.find(
    (source) => source.source === 'EXTERNAL_PROVIDER',
  );
  record(
    'EXTERNAL-EVIDENCE-STAYS-NOT-PERFORMED',
    breaksA.status === 200 &&
      breaksA.body?.reconciliationEstablished === false &&
      externalProvider &&
      externalProvider.result === 'NOT_PERFORMED',
    `HTTP ${breaksA.status}, established=${breaksA.body?.reconciliationEstablished}, provider=${externalProvider?.result}`,
  );

  const eligibilityAuditor = await call(
    `/internal/finance-operations/ledger/journals/${JOURNAL_A}/reversal-eligibility`,
    { token: auditor },
  );
  record(
    'AUDITOR-ELIGIBILITY-IS-READ-ONLY',
    eligibilityAuditor.status === 200 &&
      eligibilityAuditor.body?.nextAction === 'NONE' &&
      eligibilityAuditor.body?.reasonCode === 'READ_ONLY_PRINCIPAL',
    `nextAction=${eligibilityAuditor.body?.nextAction}, reason=${eligibilityAuditor.body?.reasonCode}`,
  );

  const eligibilityPreparer = await call(
    `/internal/finance-operations/ledger/journals/${JOURNAL_A}/reversal-eligibility`,
    { token: preparer },
  );
  record(
    'PREPARER-ELIGIBILITY-REQUESTS-REVERSAL',
    eligibilityPreparer.status === 200 &&
      eligibilityPreparer.body?.nextAction === 'REQUEST_REVERSAL',
    `nextAction=${eligibilityPreparer.body?.nextAction}`,
  );

  const crossRequest = await call(`/ledger/journals/${JOURNAL_B}/reversal-request`, {
    method: 'POST',
    token: preparer,
    body: { reason: 'Cross-institution attempt must be denied' },
  });
  record(
    'CROSS-INSTITUTION-REVERSAL-REQUEST-DENIED',
    crossRequest.status === 404,
    `HTTP ${crossRequest.status}`,
  );

  const reason = 'Acceptance: duplicate posting verified by Finance';
  const request = await call(`/ledger/journals/${JOURNAL_A}/reversal-request`, {
    method: 'POST',
    token: preparer,
    body: { reason },
  });
  const approvalId = request.body?.approvalId;
  record(
    'MAKER-REQUEST-CREATES-PENDING-APPROVAL',
    request.status === 201 && !!approvalId,
    `HTTP ${request.status}, approval=${approvalId}`,
  );

  const eligibilityPending = await call(
    `/internal/finance-operations/ledger/journals/${JOURNAL_A}/reversal-eligibility`,
    { token: controller },
  );
  record(
    'CHECKER-SEES-AWAIT-APPROVAL',
    eligibilityPending.status === 200 &&
      eligibilityPending.body?.nextAction === 'AWAIT_APPROVAL' &&
      eligibilityPending.body?.approval?.approvalId === approvalId,
    `nextAction=${eligibilityPending.body?.nextAction}, approvalStatus=${eligibilityPending.body?.approval?.status}`,
  );

  const approve = await call(
    `/internal/a2/workforce/approvals/${encodeURIComponent(approvalId ?? '')}/approve`,
    {
      method: 'POST',
      token: controller,
      body: { comment: 'Approved during disposable acceptance run' },
    },
  );
  record(
    'CHECKER-APPROVES-GOVERNED-ACTION',
    approve.status < 300,
    `HTTP ${approve.status}`,
  );

  const eligibilityApproved = await call(
    `/internal/finance-operations/ledger/journals/${JOURNAL_A}/reversal-eligibility`,
    { token: controller },
  );
  record(
    'CHECKER-ELIGIBILITY-OFFERS-EXECUTION',
    eligibilityApproved.status === 200 &&
      eligibilityApproved.body?.nextAction === 'EXECUTE_REVERSAL' &&
      eligibilityApproved.body?.permissions?.canExecute === true,
    `nextAction=${eligibilityApproved.body?.nextAction}`,
  );

  const execution = await call(`/ledger/journals/${JOURNAL_A}/reversal`, {
    method: 'POST',
    token: controller,
    headers: { 'idempotency-key': `finance-http-acceptance:${JOURNAL_A}:${approvalId}` },
    body: { reason, approvalId },
  });
  record(
    'EXECUTION-POSTS-REVERSAL',
    execution.status === 201 && !!execution.body?.id && execution.body?.reversalOfJournalId === JOURNAL_A,
    `HTTP ${execution.status}, reversal=${execution.body?.id}`,
  );

  const detailAfter = await call(`/internal/finance-operations/ledger/journals/${JOURNAL_A}`, {
    token: auditor,
  });
  record(
    'DETAIL-REFLECTS-REVERSED-STATE',
    detailAfter.status === 200 &&
      detailAfter.body?.reversal?.kind === 'REVERSED' &&
      detailAfter.body?.reversal?.reversedByJournalId === execution.body?.id,
    `kind=${detailAfter.body?.reversal?.kind}, reversedBy=${detailAfter.body?.reversal?.reversedByJournalId}`,
  );

  const eligibilityAfter = await call(
    `/internal/finance-operations/ledger/journals/${JOURNAL_A}/reversal-eligibility`,
    { token: controller },
  );
  record(
    'ALREADY-REVERSED-IS-NOT-ELIGIBLE',
    eligibilityAfter.status === 200 &&
      eligibilityAfter.body?.nextAction === 'NONE' &&
      eligibilityAfter.body?.reasonCode === 'ALREADY_REVERSED',
    `nextAction=${eligibilityAfter.body?.nextAction}, reason=${eligibilityAfter.body?.reasonCode}`,
  );

  const platformSearch = await call(
    `/internal/finance-operations/ledger/journals?reference=${REF_B}`,
    { token: superAdmin },
  );
  record(
    'PLATFORM-AUTHORITY-SEES-BOTH-INSTITUTIONS',
    platformSearch.status === 200 &&
      platformSearch.body?.scope?.mode === 'PLATFORM' &&
      platformSearch.body?.items?.length === 1,
    `HTTP ${platformSearch.status}, mode=${platformSearch.body?.scope?.mode}, items=${platformSearch.body?.items?.length}`,
  );

  const treasuryRead = await call(`/internal/finance-operations/ledger/journals`, {
    token: treasury,
  });
  const treasuryBreaks = await call(
    `/internal/finance-operations/reconciliation/breaks?institutionId=${INST_A}`,
    { token: treasury },
  );
  record(
    'FUNCTION-DENIAL-HOLDS-AND-OWN-INSTITUTION-IS-ALLOWED',
    treasuryRead.status === 403 && treasuryBreaks.status === 200,
    `ledger search HTTP ${treasuryRead.status}, own-institution reconciliation HTTP ${treasuryBreaks.status}`,
  );

  const invalidRange = await call(
    `/internal/finance-operations/ledger/journals?from=2026-11-20&to=2026-11-01`,
    { token: auditor },
  );
  record('INVALID-DATE-RANGE-REJECTED', invalidRange.status === 400, `HTTP ${invalidRange.status}`);

  await app.close();
  const failed = RESULTS.filter((entry) => !entry.ok);
  fs.writeFileSync(
    path.join(OUT, 'finance-operations-http-acceptance.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        bootstrap: 'isolated test bootstrap: real AppModule/Fastify/guards/route policies, readiness gate skipped',
        database: { host: process.env.DB_HOST, name: process.env.DB_NAME },
        assertions: RESULTS,
        transcript: TRANSCRIPT,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n${RESULTS.length - failed.length}/${RESULTS.length} HTTP checks passed -> ${OUT}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('finance operations HTTP acceptance failed to run:', error);
  process.exit(3);
});
