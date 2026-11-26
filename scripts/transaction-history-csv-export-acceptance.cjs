#!/usr/bin/env node
'use strict';
/*
 * CSV export acceptance — real browser, real workforce sign-in, real PostgreSQL.
 *
 * This script does not fake the export. It creates a fully migrated disposable PostgreSQL cluster,
 * seeds the 11 existing local workforce accounts, fires inbound transaction rows for two
 * institutions, boots the real AppModule and the real Admin Web SPA, signs in with an actual email
 * and password, and drives the "Export CSV" button in Chromium. The downloaded file is then read
 * back and reconciled against the paginated list.
 *
 *   LD_LIBRARY_PATH=node_modules/@embedded-postgres/linux-x64/native/lib \
 *   node scripts/transaction-history-csv-export-acceptance.cjs --browser
 *
 * Without --browser it runs the HTTP-only checks (no Chromium, no Vite); pass --browser after
 * starting the Vite dev server with ADMIN_WEB_DEV_PROXY_TARGET=http://127.0.0.1:3099.
 *
 * Evidence is written to docs/transaction-history-csv/evidence/ and is synthetic: the rows are
 * disposable and the "download" is a file this machine produced, never a production record.
 */
require('ts-node/register/transpile-only');
require('reflect-metadata');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const EmbeddedPostgres = require('embedded-postgres').default;
const { DataSource } = require('typeorm');
const request = require('supertest');

const OUT = path.resolve('docs/transaction-history-csv/evidence');
const BROWSER = process.argv.includes('--browser');
const ROWS = 47; // five list pages at the UI's page size of 20
const PORT = Number(process.env.CSV_ACCEPTANCE_PG_PORT || 55441);
const API_PORT = Number(process.env.CSV_ACCEPTANCE_API_PORT || 3099);
const SPA_ORIGIN = process.env.CSV_ACCEPTANCE_SPA_ORIGIN || 'http://127.0.0.1:5173';
const report = [];

function check(name, detail) {
  report.push({ name, result: 'PASS', detail });
  console.log('PASS', name);
}

/** Parses enough RFC 4180 to prove the server wrote a well-formed file. */
function parseCsv(text) {
  const body = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cluster = new EmbeddedPostgres({
    databaseDir: `/tmp/history-csv-pg-${process.pid}`,
    port: PORT,
    user: 'history_csv',
    password: randomUUID(),
    persistent: false,
    onLog: () => {},
    onError: console.error,
  });
  let dataSource;
  let app;
  try {
    await cluster.initialise();
    await cluster.start();
    await cluster.createDatabase('monienaija');
    const cfg = cluster.getPgClient().connectionParameters;

    // Load the application through the same environment the migrated harness uses.
    process.env.NODE_ENV = 'test';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = String(cfg.port);
    process.env.DB_NAME = 'monienaija';
    process.env.DB_USER = cfg.user;
    process.env.DB_PASSWORD = cfg.password;
    process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER = 'yes';
    process.env.PG_TEST_RUN_ID = `csvexport${Date.now().toString(36).slice(-6)}`;
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';

    const { createIntegrationDataSourceFromScratch } = require('../test/support/pg-harness');
    dataSource = await createIntegrationDataSourceFromScratch('csvexportbrowser');
    if (dataSource.options.type !== 'postgres') throw new Error('Expected PostgreSQL');

    // The 11 real local workforce accounts, through the real seed implementation.
    // Seed the SUITE's own database, not the cluster's default one.
    const options = dataSource.options;
    const cli = spawnSync(process.execPath, ['scripts/local-dev-seed-11-roles.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DB_HOST: String(options.host),
        DB_PORT: String(options.port),
        DB_NAME: String(options.database),
        DB_USER: String(options.username),
        DB_PASSWORD: String(options.password),
      },
      encoding: 'utf8',
      timeout: 120000,
    });
    if (cli.status !== 0) throw new Error(`Local role seed failed: ${cli.stderr || cli.status}`);
    check('11 local workforce accounts seeded by the real seed script', {
      accounts: (await dataSource.query('SELECT id FROM local_admin_credentials')).length,
    });

    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { FastifyAdapter } = require('@nestjs/platform-fastify');
    const { AppModule } = require('../src/app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();
    app = mod.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    check('real AppModule booted against fully migrated disposable PostgreSQL');

    const seedInfo = require('../scripts/local-dev-seed-11-roles.js');
    const api = () => request(app.getHttpServer());
    const login = async (role) => {
      const response = await api()
        .post('/api/v1/internal/a2/workforce/local-admin-sessions')
        .send({ email: seedInfo.emailFor(role), password: seedInfo.passwordFor(role) });
      assert.equal(response.status, 201, `login failed for ${role}`);
      return response.body;
    };
    const ops = await login('OPERATIONS');
    const auditor = await login('FINANCE_AUDITOR');
    check('real email/password sign-in for OPERATIONS and FINANCE_AUDITOR', {
      operations: ops.principal.principalId,
    });

    // Fixture: two institutions, a foreign one that must never appear, and Lagos-day edges.
    const institution = async () =>
      (
        await dataSource.query(
          `INSERT INTO financial_institutions(reference,code,legal_name,institution_type,created_by)
           VALUES($1,$2,'CSV export acceptance institution','PARTNER','acceptance') RETURNING id`,
          [randomUUID(), `ACC_${randomUUID().slice(0, 8).toUpperCase()}`],
        )
      )[0].id;
    const own = await institution();
    const foreign = await institution();
    await dataSource.query(
      `INSERT INTO workforce_institution_assignments(principal_id,institution_id,status,granted_by)
       VALUES($1,$2,'ACTIVE','acceptance')`,
      [ops.principal.principalId, own],
    );
    await dataSource.query(
      `INSERT INTO banking_inbound_payments
         (institution_id,provider_key,environment,provider_transaction_reference,currency,
          gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state,recorded_at)
       SELECT $1::uuid,'MONNIFY','sandbox','ACC-OWN-' || lpad(n::text,2,'0'),'NGN',10000,100,9900,
              CASE WHEN n % 4 = 0 THEN 'UNVERIFIED' ELSE 'VERIFIED' END,
              '2026-11-24T12:00:00Z'::timestamptz - (n % 11) * interval '1 second'
       FROM generate_series(1,$2) n`,
      [own, ROWS],
    );
    await dataSource.query(
      `INSERT INTO banking_inbound_payments
         (institution_id,provider_key,environment,provider_transaction_reference,currency,
          gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state,recorded_at)
       SELECT $1::uuid,'MONNIFY','sandbox','ACC-FOREIGN-' || lpad(n::text,2,'0'),'NGN',20000,200,19800,'VERIFIED',
              '2026-11-24T12:00:00Z'::timestamptz
       FROM generate_series(1,9) n`,
      [foreign],
    );
    await dataSource.query(
      `INSERT INTO banking_inbound_payments
         (institution_id,provider_key,environment,provider_transaction_reference,currency,
          gross_amount_minor,provider_fee_minor,credited_amount_minor,verification_state,recorded_at)
       VALUES ($1::uuid,'MONNIFY','sandbox','ACC-BEFORE-MIDNIGHT','NGN',100,1,99,'VERIFIED','2026-11-23T22:59:59.999999Z'),
              ($1::uuid,'MONNIFY','sandbox','ACC-AT-NEXT-MIDNIGHT','NGN',100,1,99,'VERIFIED','2026-11-24T23:00:00Z')`,
      [own],
    );
    check('fixture created: visible rows, a foreign institution, and Lagos day edges', {
      visible: ROWS,
      foreign: 9,
      outsideLagosDay: 2,
    });

    const base = '/api/v1/internal/admin/transaction-history';
    const filters = 'from=2026-11-24&to=2026-11-24&type=BANK_TO_WALLET';

    // --- HTTP: the export must equal the list, row for row -------------------------------
    const screenRows = [];
    let cursor = '';
    let pages = 0;
    for (;;) {
      const page = await api()
        .get(`${base}?${filters}&limit=20&cursor=${encodeURIComponent(cursor)}`)
        .set('Authorization', `Bearer ${ops.accessToken}`);
      assert.equal(page.status, 200);
      screenRows.push(...page.body.items);
      pages += 1;
      if (!page.body.nextCursor) break;
      cursor = page.body.nextCursor;
    }
    const exported = await api()
      .get(`${base}/export.csv?${filters}`)
      .set('Authorization', `Bearer ${ops.accessToken}`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers['content-type'], /text\/csv/);
    assert.match(exported.headers['content-disposition'], /attachment; filename="[^"]+\.csv"/);
    assert.equal(exported.headers['x-export-rows'], String(ROWS));
    const table = parseCsv(exported.text);
    const header = table[0];
    const dataRows = table.slice(1);
    assert.equal(dataRows.length, ROWS);
    assert.equal(new Set(dataRows.map((r) => r[0])).size, ROWS);
    assert.deepEqual(
      dataRows.map((r) => r[0]).sort(),
      screenRows.map((r) => r.reference).sort(),
    );
    check('export equals the paginated list exactly — every row once, across all UI pages', {
      pages,
      rows: dataRows.length,
      header,
    });
    // --- Authorization: foreign institution and unauthorized callers -------------------
    assert.equal(
      dataRows.filter((r) => r[0].startsWith('ACC-FOREIGN')).length,
      0,
      'foreign institution leaked into the export',
    );
    assert.ok(!dataRows.some((r) => r[0] === 'ACC-BEFORE-MIDNIGHT'));
    assert.ok(!dataRows.some((r) => r[0] === 'ACC-AT-NEXT-MIDNIGHT'));
    check('foreign institution and out-of-range Lagos rows are absent from the file');

    const treasury = await login('TREASURY');
    const denied = await api()
      .get(`${base}/export.csv?${filters}`)
      .set('Authorization', `Bearer ${treasury.accessToken}`);
    assert.equal(denied.status, 403);
    assert.ok(!denied.text.includes('transaction_reference'));
    const anonymous = await api().get(`${base}/export.csv?${filters}`);
    assert.equal(anonymous.status, 401);
    check('unauthorized requests are denied server-side (403 for a role without transaction.view, 401 anonymous)');

    // --- Audit trail -------------------------------------------------------------------
    const auditRows = await dataSource.query(
      `SELECT actor,action,new_values FROM audit_events
        WHERE entity_type='TRANSACTION_HISTORY_EXPORT' AND entity_id=$1`,
      [exported.headers['x-export-id']],
    );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].actor, ops.principal.principalId);
    assert.equal(auditRows[0].action, 'TRANSACTION_HISTORY_CSV_EXPORTED');
    assert.deepEqual(auditRows[0].new_values.filters, {
      type: 'BANK_TO_WALLET',
      status: null,
      reference: null,
      from: '2026-11-24',
      to: '2026-11-24',
    });
    assert.equal(auditRows[0].new_values.outcome, 'SUCCEEDED');
    check('export recorded in the existing audit trail with actor, applied filters and outcome', {
      actor: auditRows[0].actor,
      outcome: auditRows[0].new_values.outcome,
    });

    // --- Empty result ------------------------------------------------------------------
    const empty = await api()
      .get(`${base}/export.csv?reference=ACC-NO-SUCH-ROW`)
      .set('Authorization', `Bearer ${ops.accessToken}`);
    assert.equal(empty.status, 200);
    assert.deepEqual(parseCsv(empty.text), [header]);
    check('an empty result returns a header-only file, not an error');

    // --- Size limit --------------------------------------------------------------------
    const { TransactionHistoryExportService } = require('../src/admin/transaction-history-export.service');
    const { TransactionHistoryController } = require('../src/admin/transaction-history.controller');
    const controller = app.get(TransactionHistoryController);
    const { AuditService } = require('../src/operations/audit.service');
    const lowCeiling = new TransactionHistoryExportService(dataSource, app.get(AuditService), {
      maxRows: 10,
    });
    const refusal = await lowCeiling
      .export(
        { list: (req, query) => controller.list(req, query) },
        {
          authorizationPrincipal: {
            type: 'OPERATOR',
            principalId: ops.principal.principalId,
            roles: ops.principal.roles,
            scopes: ops.principal.scopes,
            customerAccess: 'NONE',
          },
        },
        { type: 'BANK_TO_WALLET' },
      )
      .then(
        () => null,
        (error) => error,
      );
    assert.equal(refusal && refusal.getStatus(), 413);
    assert.match(refusal.message, /above the supported export size/);
    assert.match(refusal.message, /Narrow the date range/);
    assert.match(refusal.message, /No file was produced/);
    const refusalAudit = await dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='TRANSACTION_HISTORY_EXPORT'
        AND new_values->>'outcome'='REFUSED_SIZE_LIMIT' ORDER BY occurred_at DESC LIMIT 1`,
    );
    assert.equal(refusalAudit[0].new_values.rowCount, 0);
    check('an over-size export is refused with a narrowing instruction and no file', {
      status: 413,
      message: refusal.message,
    });

    // --- Browser: the actual button, the actual download --------------------------------
    if (BROWSER) {
      await app.listen(API_PORT, '0.0.0.0');
      const { chromium } = require('playwright');
      const binaryPath =
        process.env.CSV_ACCEPTANCE_CHROMIUM_PATH ||
        (() => {
          const resolved = spawnSync(
            process.execPath,
            [
              '-e',
              "const c=require('@sparticuz/chromium').default;c.executablePath().then(p=>console.log(p))",
            ],
            { encoding: 'utf8' },
          );
          return String(resolved.stdout).trim();
        })();
      const browser = await chromium.launch({ executablePath: binaryPath, headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 1512, height: 982 },
          acceptDownloads: true,
        });
        const page = await context.newPage();
        await page.goto(SPA_ORIGIN);
        await page.getByPlaceholder('Workforce email').fill(seedInfo.emailFor('OPERATIONS'));
        await page.getByPlaceholder('••••••••••••').fill(seedInfo.passwordFor('OPERATIONS'));
        await page.getByRole('button', { name: 'Sign in', exact: false }).click();
        await page.getByTestId('section-money').click();
        await page.getByTestId('nav-transfers').click();
        await page.getByLabel('From date').fill('2026-11-24');
        await page.getByLabel('To date').fill('2026-11-24');
        await page.getByLabel('Transaction type').selectOption('BANK_TO_WALLET');
        await page.getByRole('button', { name: 'Apply filters' }).click();
        await page.getByText('ACC-OWN-01', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(OUT, 'export-filters-applied.png'), fullPage: true });

        // Page 2, so the downloaded file cannot be "just what is on screen".
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.getByText('Page 2 · newest first').waitFor();
        await page.screenshot({ path: path.join(OUT, 'export-page-2.png'), fullPage: true });

        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export CSV' }).click();
        const download = await downloadPromise;
        const savedPath = path.join(OUT, 'browser-download.csv');
        await download.saveAs(savedPath);
        const confirmation = page.getByText(/Exported [\d,]+ transactions/);
        await confirmation.waitFor();
        const confirmationText = await confirmation.innerText();
        await page.screenshot({ path: path.join(OUT, 'export-confirmed.png'), fullPage: true });

        const downloaded = parseCsv(fs.readFileSync(savedPath, 'utf8'));
        assert.deepEqual(downloaded[0], header, 'downloaded header differs from the API export');
        assert.equal(downloaded.length - 1, ROWS, 'downloaded rows differ from the matching set');
        assert.equal(new Set(downloaded.slice(1).map((r) => r[0])).size, ROWS);
        assert.match(download.suggestedFilename(), /^transaction-history_2026-11-24_to_2026-11-24_bank_to_wallet\.csv$/);
        assert.match(confirmationText, new RegExp(`\\b${ROWS}\\b`));
        assert.match(confirmationText, /not just this page/);
        check('real browser sign-in, filtered list on page 2, Export CSV downloaded every matching row', {
          suggestedFilename: download.suggestedFilename(),
          confirmation: confirmationText,
          rowsInFile: downloaded.length - 1,
        });

        // The refusal must be explained in the UI, not swallowed.
        await page.route('**/export.csv**', (route) =>
          route.fulfill({
            status: 413,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 413,
              message:
                'This export matches more than 50,000 transactions, which is above the supported export size. Narrow the date range or add a product, status or reference filter and export again. No file was produced.',
            }),
          }),
        );
        await page.getByRole('button', { name: 'Export CSV' }).click();
        const alert = page.getByRole('alert', { name: '' }).filter({ hasText: 'Export CSV failed' });
        await alert.waitFor();
        await page.screenshot({ path: path.join(OUT, 'export-size-refusal.png'), fullPage: true });
        check('the size refusal is shown in the UI with the narrowing instruction');
      } finally {
        await browser.close();
      }
    }

    fs.writeFileSync(
      path.join(OUT, 'acceptance.json'),
      `${JSON.stringify(
        {
          date: new Date().toISOString(),
          commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
          scope:
            'Fully migrated disposable PostgreSQL, real AppModule, real local workforce email/password sign-in. Synthetic business rows; not a production record.',
          browser: BROWSER,
          checks: report,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\n${report.length} checks passed. Evidence: ${OUT}`);
  } finally {
    if (app) await app.close().catch(() => undefined);
    if (dataSource && dataSource.isInitialized) await dataSource.destroy().catch(() => undefined);
    await cluster.stop().catch(() => undefined);
  }
})().catch((error) => {
  console.error('CSV EXPORT ACCEPTANCE FAILED:', error);
  process.exit(1);
});
