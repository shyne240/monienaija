#!/usr/bin/env node
'use strict';

/**
 * Platform Funds vs. Bank Balance — INSTITUTION-SCOPED direct evidence against a disposable
 * PostgreSQL database.
 *
 * The 37-check platform-funds acceptance proves the ledger math and the governed maker-checker
 * workflow, but it runs entirely against PLATFORM-scope settlement evidence. This harness proves
 * the cross-institution boundary directly, over real HTTP, with the seeded local workforce:
 *
 *   - registers two independent institutions through the governed HTTP API
 *     (register → regulatory evidence → workforce scope grant → maker-checker lifecycle activation);
 *   - plants one institution-scoped CUSTOMER_FUNDS SETTLEMENT asset account per institution;
 *   - grants FINANCE_PREPARER institution A plus a TEMPORARY institution B grant, seeds B's
 *     other-institution evidence through the real API as that preparer, then REVOKES the B grant;
 *     every isolation assertion below runs after revocation, against an ACTIVE-assignment-free B;
 *   - drives the running application over HTTP and asserts:
 *       OWN (institution A): preview, create, list, read, PATCH, timing-item add and remove — all OK;
 *       OTHER (institution B): after the grant is revoked the preparer cannot see or change ANY of
 *       B's evidence: settlement-accounts list omits B, preview/create against B are 404,
 *       GET/PATCH/timing-items/submit/snapshots against B's comparison are 404 (anti-probe:
 *       indistinguishable from "does not exist"), the institution detail route is 404, and the
 *       comparisons list omits B entirely.
 *
 * This is an **isolated test bootstrap**, not the production entrypoint. It builds the real
 * `AppModule` with the real Fastify adapter, global validation pipe, exception filter, HTTP
 * security, request-context hooks, authorization guards and route policies, then listens on
 * loopback. The ONLY thing it does not do is call `ProductionReadinessService.verifyStartup()`,
 * because that gate deliberately refuses to serve while eight financial dependencies are
 * unverified. The gate itself is untouched: `src/main.ts` still refuses in exactly the same way.
 *
 * Precedent for fixture-level SQL: ledger accounts are seeded with SQL (as the 37-check HTTP
 * acceptance seeds journals and the local dev seed creates credentials) — every application
 * DECISION this script exercises is made by the real running server. Institution activation is NOT
 * done in SQL: both institutions are approved through the same governed maker-checker workflow the
 * product uses.
 *
 * Seeded local workforce accounts are used exactly as documented (passwords are never printed or
 * written to evidence). The FINANCE_PREPARER grant created here is recorded in
 * `workforce_institution_assignments` and is scoped to institution A only; it is a fixture row in a
 * disposable database, never a production artefact.
 *
 * Usage:
 *   PLATFORM_FUNDS_SCOPE_CONFIRM=disposable-local-database \
 *     NODE_ENV=test node scripts/platform-funds-institution-scope-acceptance.cjs --out /tmp/pf-institution-scope
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

require('dotenv').config();

const PORT = Number(process.env.PLATFORM_FUNDS_SCOPE_PORT ?? 3102);
const OUT = path.resolve(
  process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : '/tmp/platform-funds-institution-scope',
);
const RESULTS = [];
const TRANSCRIPT = [];

function record(name, ok, detail) {
  RESULTS.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
}

function guardEnvironment() {
  const errors = [];
  if (process.env.PLATFORM_FUNDS_SCOPE_CONFIRM !== 'disposable-local-database')
    errors.push('set PLATFORM_FUNDS_SCOPE_CONFIRM=disposable-local-database');
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

const RUN = randomUUID().slice(0, 8).toUpperCase();
const LEDGER_CUTOFF = new Date(Date.now() + 30_000).toISOString();
const BANK_CUTOFF = new Date().toISOString();
const suffix = () => randomBytes(3).toString('hex').toUpperCase();

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        /password|accesstoken|token|authorization/i.test(key) ? '[REDACTED]' : redact(nested),
      ]),
    );
  }
  return value;
}

async function main() {
  guardEnvironment();
  fs.mkdirSync(OUT, { recursive: true });

  const gitSha = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..') })
        .toString()
        .trim();
    } catch {
      return 'unknown';
    }
  })();

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
  const { Client } = require('pg');

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
    TRANSCRIPT.push({
      method: options.method ?? 'GET',
      route,
      status: response.status,
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
    if (!(response.status < 300 && response.body?.accessToken)) {
      throw new Error(`login failed for ${role}: HTTP ${response.status}`);
    }
    return response.body.accessToken;
  };

  const superAdmin = await login('SUPER_ADMIN');
  const operator = await login('OPERATIONS');
  const controller = await login('FINANCE_CONTROLLER');
  const preparer = await login('FINANCE_PREPARER');

  // Look up the seeded workforce principal ids by role (needed for scope grants).
  const sql = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await sql.connect();
  const principals = {};
  for (const [key, roleKey] of [
    ['superAdmin', 'SUPER_ADMIN'],
    ['operator', 'OPERATIONS'],
    ['controller', 'FINANCE_CONTROLLER'],
    ['preparer', 'FINANCE_PREPARER'],
  ]) {
    const result = await sql.query(
      `SELECT DISTINCT principal_id FROM a2_finance_role_assignments WHERE role_key = $1`,
      [roleKey],
    );
    if (result.rows.length !== 1)
      throw new Error(`expected exactly one ${roleKey} principal, found ${result.rows.length}`);
    principals[key] = result.rows[0].principal_id;
  }

  // ---- stage 1: register + activate two independent institutions, governed workflow ----------
  const activateInstitution = async (tag) => {
    const registerResponse = await call('/internal/institutions', {
      method: 'POST',
      token: superAdmin,
      body: {
        reference: `PFEVID-${tag}-${RUN}`,
        code: `PFEVID_${tag}_${RUN}`,
        legalName: `Platform Funds Evidence ${tag} Limited`,
        displayName: `PFE ${tag}`,
        institutionType: 'MICROFINANCE_BANK',
        regulatorName: 'Central Bank of Nigeria',
        licenceReference: `PFE-LIC-${tag}-${RUN}`,
      },
    });
    if (registerResponse.status !== 201)
      throw new Error(`institution ${tag} registration failed: HTTP ${registerResponse.status}`);
    const institutionId = registerResponse.body?.id;
    const evidenceResponse = await call(`/internal/institutions/${institutionId}/evidence`, {
      method: 'POST',
      token: superAdmin,
      body: {
        evidenceReference: `PFE-EVID-${tag}-${RUN}`,
        regulatorName: 'Central Bank of Nigeria',
        licenceReference: `PFE-LIC-${tag}-${RUN}`,
      },
    });
    if (evidenceResponse.status !== 201)
      throw new Error(`institution ${tag} evidence failed: HTTP ${evidenceResponse.status}`);
    // Maker/checker and the scoped preparer need institution scope before the lifecycle walk.
    for (const principal of [principals.operator, principals.controller]) {
      const grant = await call(`/internal/institutions/${institutionId}/workforce`, {
        method: 'POST',
        token: superAdmin,
        body: { principalId: principal },
      });
      if (grant.status !== 201)
        throw new Error(`institution ${tag} scope grant failed: HTTP ${grant.status}`);
    }
    const reason = `Platform funds institution-scope evidence for distribution ${RUN}; regulator evidence verified`;
    const prepared = await call(`/internal/institutions/${institutionId}/lifecycle/request`, {
      method: 'POST',
      token: operator,
      body: { targetStatus: 'APPROVED', reason },
    });
    if (prepared.status !== 201)
      throw new Error(`institution ${tag} lifecycle request failed: HTTP ${prepared.status}`);
    const approvalId = prepared.body?.approvalId;
    const approved = await call(`/internal/a2/workforce/approvals/${approvalId}/approve`, {
      method: 'POST',
      token: controller,
      body: { comment: 'Independently checked by the designated MFA checker for evidence distribution' },
    });
    if (approved.status !== 201)
      throw new Error(`institution ${tag} approval failed: HTTP ${approved.status}`);
    const executed = await call(`/internal/institutions/${institutionId}/lifecycle`, {
      method: 'POST',
      token: controller,
      body: { approvalId, targetStatus: 'APPROVED', reason },
    });
    if (executed.status !== 201)
      throw new Error(`institution ${tag} activation failed: HTTP ${executed.status}`);
    return institutionId;
  };

  const institutionA = await activateInstitution('A');
  const institutionB = await activateInstitution('B');

  // The preparer is scoped to institution A ONLY. A temporary B grant lets the fixture seed
  // other-institution evidence AS the preparer; it is revoked before any isolation assertion,
  // which is what makes the 404s below a genuine cross-institution refusal, not a role denial.
  const preparerGrantA = await call(`/internal/institutions/${institutionA}/workforce`, {
    method: 'POST',
    token: superAdmin,
    body: { principalId: principals.preparer },
  });
  if (preparerGrantA.status !== 201)
    throw new Error(`preparer scope grant for A failed: HTTP ${preparerGrantA.status}`);
  const preparerGrantB = await call(`/internal/institutions/${institutionB}/workforce`, {
    method: 'POST',
    token: superAdmin,
    body: { principalId: principals.preparer },
  });
  if (preparerGrantB.status !== 201)
    throw new Error(`preparer temporary scope grant for B failed: HTTP ${preparerGrantB.status}`);

  // ---- stage 2: one institution-scoped settlement asset per institution (SQL fixture) --------
  const createSettlementAccount = async (tag, institutionId) => {
    const id = randomUUID();
    await sql.query(
      `INSERT INTO ledger_accounts
         (id, code, name, account_type, normal_balance, currency, accounting_unit,
          allow_negative_balance, is_active, institutional_scope, institution_id, institutional_purpose)
       VALUES ($1,$2,$3,'ASSET','DEBIT','NGN','CUSTOMER_FUNDS',false,true,'INSTITUTION',$4,'SETTLEMENT')`,
      [
        id,
        `PFESETT_${tag}_${RUN}`,
        `Institution ${tag} settlement evidence account`,
        institutionId,
      ],
    );
    return id;
  };
  const settlementA = await createSettlementAccount('A', institutionA);
  const settlementB = await createSettlementAccount('B', institutionB);

  // ---- stage 3: OWN institution (A) — direct evidence the preparer CAN work inside it ---------
  const previewA = await call('/internal/finance-operations/platform-funds/comparisons/preview', {
    method: 'POST',
    token: preparer,
    body: { settlementAccountId: settlementA, ledgerCutoff: LEDGER_CUTOFF },
  });
  record(
    'OWN-INSTITUTION-PREVIEW-ALLOWED',
    previewA.status < 300 && previewA.body?.settlementAccount?.expectedMinor !== undefined,
    `HTTP ${previewA.status}`,
  );
  const expectedA = previewA.body?.settlementAccount?.expectedMinor ?? '0';

  const createA = await call('/internal/finance-operations/platform-funds/comparisons', {
    method: 'POST',
    token: preparer,
    body: {
      settlementAccountId: settlementA,
      ledgerCutoff: LEDGER_CUTOFF,
      bankCutoff: BANK_CUTOFF,
      statementReference: `STMT-PFE-A-${RUN}`,
      bankBalanceMinor: expectedA,
    },
  });
  const comparisonAId = createA.body?.id;
  record(
    'OWN-INSTITUTION-COMPARISON-CREATED',
    createA.status === 201 && createA.body?.scope === 'INSTITUTION' && !!comparisonAId,
    `HTTP ${createA.status}, scope=${createA.body?.scope}`,
  );

  const getA = await call(`/internal/finance-operations/platform-funds/comparisons/${comparisonAId}`, {
    token: preparer,
  });
  record('OWN-INSTITUTION-READ-ALLOWED', getA.status === 200, `HTTP ${getA.status}`);

  const patchA = await call(`/internal/finance-operations/platform-funds/comparisons/${comparisonAId}`, {
    method: 'PATCH',
    token: preparer,
    body: { statementReference: `STMT-PFE-A2-${RUN}` },
  });
  record('OWN-INSTITUTION-PATCH-ALLOWED', patchA.status === 200, `HTTP ${patchA.status}`);

  const timingA = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonAId}/timing-items`,
    {
      method: 'POST',
      token: preparer,
      body: {
        title: 'Own-institution timing evidence',
        reference: `PFE-A-ITEM-${RUN}`,
        explanation: 'Deposit in transit recorded by the institution settlement desk',
        amountMinor: '25000',
      },
    },
  );
  const timingAId =
    timingA.body?.timingItems?.find?.((item) => item.reference === `PFE-A-ITEM-${RUN}`)?.id ??
    timingA.body?.items?.find?.((item) => item.reference === `PFE-A-ITEM-${RUN}`)?.id;
  record(
    'OWN-INSTITUTION-TIMING-ITEM-ADD-ALLOWED',
    timingA.status === 201 || timingA.status === 200,
    `HTTP ${timingA.status}`,
  );
  const deleteA = timingAId
    ? await call(
        `/internal/finance-operations/platform-funds/comparisons/${comparisonAId}/timing-items/${timingAId}`,
        { method: 'DELETE', token: preparer },
      )
    : { status: 0, body: 'timing item id not found in response' };
  record(
    'OWN-INSTITUTION-TIMING-ITEM-REMOVE-ALLOWED',
    deleteA.status === 200 || deleteA.status === 204,
    `HTTP ${deleteA.status}`,
  );

  // ---- stage 4: OTHER institution (B) — seeded by the preparer, grant then REVOKED ------------
  const previewB = await call('/internal/finance-operations/platform-funds/comparisons/preview', {
    method: 'POST',
    token: preparer,
    body: { settlementAccountId: settlementB, ledgerCutoff: LEDGER_CUTOFF },
  });
  const expectedB = previewB.body?.settlementAccount?.expectedMinor ?? '0';
  record(
    'PRE-REVOCATION-PREVIEW-B-ALLOWED',
    previewB.status < 300,
    `HTTP ${previewB.status}`,
  );

  const createB = await call('/internal/finance-operations/platform-funds/comparisons', {
    method: 'POST',
    token: preparer,
    body: {
      settlementAccountId: settlementB,
      ledgerCutoff: LEDGER_CUTOFF,
      bankCutoff: BANK_CUTOFF,
      statementReference: `STMT-PFE-B-${RUN}`,
      bankBalanceMinor: expectedB,
    },
  });
  const comparisonBId = createB.body?.id;
  record(
    'PRE-REVOCATION-COMPARISON-B-CREATED',
    createB.status === 201 && createB.body?.scope === 'INSTITUTION' && !!comparisonBId,
    `HTTP ${createB.status}, scope=${createB.body?.scope}`,
  );

  const timingB = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonBId}/timing-items`,
    {
      method: 'POST',
      token: preparer,
      body: {
        title: 'Other-institution timing evidence',
        reference: `PFE-B-ITEM-${RUN}`,
        explanation: 'Deposit in transit recorded by bank B settlement desk',
        amountMinor: '40000',
      },
    },
  );
  const timingBId =
    timingB.body?.timingItems?.find?.((item) => item.reference === `PFE-B-ITEM-${RUN}`)?.id ??
    timingB.body?.items?.find?.((item) => item.reference === `PFE-B-ITEM-${RUN}`)?.id;
  record(
    'PRE-REVOCATION-TIMING-ITEM-B-CREATED',
    timingB.status === 201 || timingB.status === 200,
    `HTTP ${timingB.status}`,
  );

  const revokeResponse = await call(
    `/internal/institutions/${institutionB}/workforce/${encodeURIComponent(principals.preparer)}`,
    { method: 'DELETE', token: superAdmin },
  );
  record(
    'OTHER-INSTITUTION-PREPARER-GRANT-REVOKED',
    revokeResponse.status < 300,
    `HTTP ${revokeResponse.status}`,
  );

  const accountsForPreparer = await call(
    '/internal/finance-operations/platform-funds/settlement-accounts',
    { token: preparer },
  );
  const accountItems = accountsForPreparer.body?.items ?? [];
  const seesA = accountItems.some((item) => item.id === settlementA);
  const seesB = accountItems.some((item) => item.id === settlementB);
  record(
    'SETTLEMENT-ACCOUNTS-LIST-SCOPED-TO-ASSIGNED-INSTITUTION',
    accountsForPreparer.status === 200 && seesA && !seesB,
    `HTTP ${accountsForPreparer.status}, items=${accountItems.length}, seesA=${seesA}, seesB=${seesB}`,
  );

  // The institution-scoped preparer now attacks every B surface. Every one must answer 404.
  const attacks = [
    ['OTHER-INSTITUTION-PREVIEW-REFUSED-404', 'POST',
      '/internal/finance-operations/platform-funds/comparisons/preview',
      { settlementAccountId: settlementB, ledgerCutoff: LEDGER_CUTOFF }],
    ['OTHER-INSTITUTION-CREATE-REFUSED-404', 'POST',
      '/internal/finance-operations/platform-funds/comparisons',
      {
        settlementAccountId: settlementB,
        ledgerCutoff: LEDGER_CUTOFF,
        bankCutoff: BANK_CUTOFF,
        statementReference: `STMT-PFE-B-X-${RUN}`,
        bankBalanceMinor: expectedB,
      }],
    ['OTHER-INSTITUTION-READ-REFUSED-404', 'GET',
      `/internal/finance-operations/platform-funds/comparisons/${comparisonBId}`],
    ['OTHER-INSTITUTION-PATCH-REFUSED-404', 'PATCH',
      `/internal/finance-operations/platform-funds/comparisons/${comparisonBId}`,
      { statementReference: `STMT-PFE-B-HACK-${RUN}` }],
    ['OTHER-INSTITUTION-TIMING-ITEM-ADD-REFUSED-404', 'POST',
      `/internal/finance-operations/platform-funds/comparisons/${comparisonBId}/timing-items`,
      {
        title: 'Unauthorized injection attempt',
        reference: `PFE-B-HACK-${RUN}`,
        explanation: 'Must never be recorded cross-institution',
        amountMinor: '1000',
      }],
    ['OTHER-INSTITUTION-SUBMIT-REFUSED-404', 'POST',
      `/internal/finance-operations/platform-funds/comparisons/${comparisonBId}/submit`,
      { reason: 'Cross-institution submit must be refused' }],
    ['OTHER-INSTITUTION-SNAPSHOTS-REFUSED-404', 'GET',
      `/internal/finance-operations/platform-funds/comparisons/${comparisonBId}/snapshots`],
  ];
  if (timingBId) {
    attacks.push([
      'OTHER-INSTITUTION-TIMING-ITEM-REMOVE-REFUSED-404', 'DELETE',
      `/internal/finance-operations/platform-funds/comparisons/${comparisonBId}/timing-items/${timingBId}`,
    ]);
  }
  attacks.push([
    'OTHER-INSTITUTION-DETAIL-REFUSED-404', 'GET', `/internal/institutions/${institutionB}`,
  ]);
  for (const [name, method, route, body] of attacks) {
    const response = await call(route, { method, token: preparer, body });
    record(name, response.status === 404, `HTTP ${response.status}`);
  }

  const listForPreparer = await call('/internal/finance-operations/platform-funds/comparisons', {
    token: preparer,
  });
  const comparisonItems = listForPreparer.body?.items ?? [];
  const listSeesA = comparisonItems.some((item) => item.id === comparisonAId);
  const listSeesB = comparisonItems.some((item) => item.id === comparisonBId);
  record(
    'COMPARISONS-LIST-OMITS-OTHER-INSTITUTION',
    listForPreparer.status === 200 && listSeesA && !listSeesB,
    `HTTP ${listForPreparer.status}, items=${comparisonItems.length}, seesA=${listSeesA}, seesB=${listSeesB}`,
  );

  const snapshotsA = await call(
    `/internal/finance-operations/platform-funds/comparisons/${comparisonAId}/snapshots`,
    { token: preparer },
  );
  record('OWN-INSTITUTION-SNAPSHOTS-READ-ALLOWED', snapshotsA.status === 200, `HTTP ${snapshotsA.status}`);

  await sql.end();
  await app.close();

  const failed = RESULTS.filter((r) => !r.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    gitCommit: gitSha,
    bootstrap:
      'isolated test bootstrap: real AppModule/Fastify/guards/route policies, readiness gate skipped by design',
    institutions: {
      a: { id: institutionA, code: `PFEVID_A_${RUN}` },
      b: { id: institutionB, code: `PFEVID_B_${RUN}` },
    },
    settlementAccounts: { a: settlementA, b: settlementB },
    scopedPrincipal: principals.preparer,
    comparisons: { a: comparisonAId, b: comparisonBId },
    checks: RESULTS,
    summary: { total: RESULTS.length, passed: RESULTS.length - failed.length, failed: failed.length },
    transcript: TRANSCRIPT,
  };
  fs.writeFileSync(path.join(OUT, 'platform-funds-institution-scope-acceptance.json'), JSON.stringify(report, null, 2));
  console.log(`\n${report.summary.passed}/${report.summary.total} institution-scope checks passed -> ${path.join(OUT, 'platform-funds-institution-scope-acceptance.json')}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('institution-scope acceptance failed to run:', error);
  process.exit(1);
});
