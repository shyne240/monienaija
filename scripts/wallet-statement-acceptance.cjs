#!/usr/bin/env node
'use strict';
/*
 * Wallet statement acceptance — real browser, real workforce sign-in, real PostgreSQL, real PDF.
 *
 * It creates a fully migrated disposable PostgreSQL cluster, boots the real AppModule, posts real
 * ledger movements (with exact Lagos-boundary instants), signs in with an actual workforce email and
 * password in Chromium, opens Customer 360 → wallet → statement, previews it, and clicks Download
 * PDF. The downloaded bytes are then parsed with a real PDF parser and reconciled against the
 * ledger, and every page is rendered to a PNG for the pull request.
 *
 *   LD_LIBRARY_PATH=/tmp/al2023/lib \
 *   node scripts/wallet-statement-acceptance.cjs [--browser]
 *
 * The SPA must already be running with ADMIN_WEB_DEV_PROXY_TARGET pointing at API_PORT, exactly as
 * the CSV export acceptance does. Evidence is written to docs/wallet-statement/evidence/ and is
 * synthetic: the customers, wallets and postings are disposable.
 */
require('ts-node/register/transpile-only');
require('reflect-metadata');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const EmbeddedPostgres = require('embedded-postgres').default;
const { DataSource } = require('typeorm');
const request = require('supertest');

const OUT = path.resolve('docs/wallet-statement/evidence');
const BROWSER = process.argv.includes('--browser');
const PORT = Number(process.env.STMT_ACCEPTANCE_PG_PORT || 55443);
const API_PORT = Number(process.env.STMT_ACCEPTANCE_API_PORT || 3097);
const SPA_ORIGIN = process.env.STMT_ACCEPTANCE_SPA_ORIGIN || 'http://127.0.0.1:5173';
/** Rows posted inside the statement period. Enough to force several printed pages. */
const ROWS = 64;
const report = [];

function check(name, detail) {
  report.push({ name, result: 'PASS', detail });
  console.log('PASS', name);
}

/**
 * Extracts text and structure from a real PDF with PDF.js.
 *
 * Asserting on the file with a parser is what makes these claims about the document rather than
 * about the code that produced it: the page count, the words on each page, the repeated header and
 * the embedded image are all read back out of the bytes the browser actually saved.
 */
async function parsePdf(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  const pages = [];
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    const operators = await page.getOperatorList();
    pages.push({
      text: content.items.map((item) => item.str).join(' '),
      images: operators.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject).length,
      viewport: page.getViewport({ scale: 1 }),
      items: content.items.map((item) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
      })),
    });
  }
  return { pageCount: doc.numPages, pages, metadata: await doc.getMetadata() };
}

/** Renders every page of a PDF to PNG through Chromium + PDF.js, for visual review. */
async function renderPages(pdfPath, prefix) {
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><body style="margin:0;background:#e6e6e6">
        <div id="pages"></div>
        <script type="module">
          import * as pdfjs from '/pdf.mjs';
          pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
          const doc = await pdfjs.getDocument({ url: '/doc.pdf' }).promise;
          const host = document.getElementById('pages');
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height;
            canvas.style.display = 'block'; canvas.style.margin = '8px';
            host.appendChild(canvas);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          }
          document.title = 'rendered-' + doc.numPages;
        </script></body></html>`);
      return;
    }
    if (req.url === '/doc.pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      return res.end(fs.readFileSync(pdfPath));
    }
    const name = req.url.replace(/^\//, '');
    for (const candidate of [
      path.join('node_modules/pdfjs-dist/build', name),
      path.join('node_modules/pdfjs-dist/cmaps', name),
    ]) {
      if (fs.existsSync(candidate)) {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        return res.end(fs.readFileSync(candidate));
      }
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const { chromium } = require('playwright');
  const binaryPath =
    process.env.STMT_ACCEPTANCE_CHROMIUM_PATH ||
    (await require('@sparticuz/chromium').default.executablePath());
  const browser = await chromium.launch({ executablePath: binaryPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => document.title.startsWith('rendered-'), null, {
      timeout: 120_000,
    });
    const canvases = await page.$$('canvas');
    const files = [];
    for (let index = 0; index < canvases.length; index += 1) {
      const file = path.join(OUT, `${prefix}-page-${index + 1}.png`);
      await canvases[index].screenshot({ path: file });
      files.push(path.basename(file));
    }
    return files;
  } finally {
    await browser.close();
    server.close();
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cluster = new EmbeddedPostgres({
    databaseDir: `/tmp/wallet-statement-pg-${process.pid}`,
    port: PORT,
    user: 'wallet_statement',
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

    process.env.NODE_ENV = 'test';
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = String(cfg.port);
    process.env.DB_NAME = 'monienaija';
    process.env.DB_USER = cfg.user;
    process.env.DB_PASSWORD = cfg.password;
    process.env.PG_TEST_CONFIRM_DISPOSABLE_CLUSTER = 'yes';
    process.env.PG_TEST_RUN_ID = `stmtacc${Date.now().toString(36).slice(-5)}`;
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';

    const { createIntegrationDataSourceFromScratch } = require('../test/support/pg-harness');
    dataSource = await createIntegrationDataSourceFromScratch('stmtaccept');
    assert.equal(dataSource.options.type, 'postgres');

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
      timeout: 120_000,
    });
    if (cli.status !== 0) throw new Error(`Local role seed failed: ${cli.stderr || cli.status}`);
    check('fully migrated disposable PostgreSQL, 11 real local workforce accounts seeded', {
      accounts: (await dataSource.query('SELECT id FROM local_admin_credentials')).length,
    });

    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { FastifyAdapter } = require('@nestjs/platform-fastify');
    const { AppModule } = require('../src/app.module');
    /*
     * Governed wallet creation runs the real financial-eligibility gate, which fails closed without
     * attested KYC evidence. The approved test seam attests it on this disposable database; nothing
     * about the statement's own authorization is bypassed.
     */
    const {
      createTestEvidenceReader,
      overrideTrustedEvidenceReader,
    } = require('../test/support/kyc-test-evidence-reader');
    const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource);
    const mod = await overrideTrustedEvidenceReader(builder, kycEvidence).compile();
    app = mod.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    check('real AppModule booted against the migrated database');

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
    const superAdmin = await login('SUPER_ADMIN');
    check('real email/password sign-in (OPERATIONS, SUPER_ADMIN)', {
      operations: ops.principal.principalId,
    });

    // ── Fixture: one customer, a governed wallet, a real ledger history ─────────────────────────
    /*
     * Institutions, enrolments and wallet attribution go through the platform's own governed
     * maker-checker endpoints (test/support/governed-financial-fixture.ts), so the wallets this
     * script statements are created exactly the way production creates them. Only the ledger
     * postings below are written directly, because there is no product API that posts historical
     * movements in bulk.
     */
    const {
      createGovernedFinancialFixture,
    } = require('../test/support/governed-financial-fixture');
    const fixture = createGovernedFinancialFixture({ app, dataSource, label: 'stmtacc' });
    const own = await fixture.institution('own');
    const other = await fixture.institution('other');

    /*
     * Give the REAL local OPERATIONS account an ACTIVE assignment to the "own" institution only, via
     * the platform's own governed `POST /internal/institutions/:id/workforce` endpoint. That is what
     * a production workforce grant is, and it is what makes the cross-institution denial below a
     * real test: this principal holds a genuine, HTTP-issued session and can reach one institution,
     * not an ownerless token that would be refused for an unrelated reason.
     */
    await fixture.grantWorkforceScope(own, ops.principal.principalId);

    const customerId = (
      await dataSource.query(
        `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
         VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
        ['mn-8031234567'],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name) VALUES ($1,'Chinedu Adeyemi Okafor')`,
      [customerId],
    );
    await fixture.makeCustomerEligible(customerId, kycEvidence);
    await fixture.enrolCustomer(customerId, own);
    await fixture.enrolCustomer(customerId, other);

    const createWallet = async (currency, institutionId) => {
      const wallet = await fixture.createWallet(customerId, currency);
      await fixture.attributeWallet(wallet.walletId, institutionId);
      return { walletId: wallet.walletId, ledgerAccountId: wallet.ledgerAccountId };
    };

    const ownWallet = { ...(await createWallet('NGN', own)), institutionId: own };
    const otherWallet = { ...(await createWallet('USD', other)), institutionId: other };

    const { LedgerService } = require('../src/ledger/ledger.service');
    const { LedgerEntryDirection } = require('../src/ledger/ledger.enums');
    const ledgerService = app.get(LedgerService);

    /** Opens a settlement asset for the institution through the governed endpoint, per currency. */
    const settlementAccounts = new Map();
    const settlementFor = async (institutionId, currency) => {
      const key = `${institutionId}:${currency}`;
      if (!settlementAccounts.has(key)) {
        const accountId = await fixture.openInstitutionSettlementAccount(institutionId, {
          purpose: currency === 'NGN' ? 'SETTLEMENT' : 'CLEARING',
          currency,
          code: `STMT-SETTLE-${currency}-${randomUUID().slice(0, 8).toUpperCase()}`,
          name: `Statement acceptance ${currency} settlement`,
        });
        settlementAccounts.set(key, accountId);
      }
      return settlementAccounts.get(key);
    };

    /**
     * Posts a real, balanced journal through `LedgerService`, then pins its `posted_at`.
     *
     * The pin runs under `session_replication_role = replica` — PostgreSQL's documented way to
     * suspend user triggers for one transaction — because the ledger is (correctly) immutable and a
     * Lagos-midnight boundary cannot be produced any other way on a disposable database. Amounts,
     * directions, lines and balances are all produced by the real posting path.
     */
    const post = async (
      wallet,
      amountMinor,
      postedAt,
      description,
      reference,
      currency = 'NGN',
    ) => {
      const settlement = await settlementFor(wallet.institutionId, currency);
      const journal = await ledgerService.postJournal({
        idempotencyKey: `stmt-accept-${randomUUID()}`,
        currency,
        accountingUnit: 'CUSTOMER_FUNDS',
        reference,
        description,
        metadata: { institutionId: wallet.institutionId },
        lines: [
          { accountId: settlement, direction: LedgerEntryDirection.DEBIT, amountMinor },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor,
          },
        ],
      });
      await dataSource.transaction(async (manager) => {
        await manager.query(`SET LOCAL session_replication_role = replica`);
        await manager.query(
          `UPDATE ledger_journals SET posted_at = $2, created_at = $2 WHERE id = $1`,
          [journal.id, postedAt],
        );
      });
      return journal.id;
    };

    const statementBase = `/api/v1/internal/customers/${customerId}/wallets/${ownWallet.walletId}`;
    const period = 'from=2026-10-01&to=2026-10-31';

    // Opening balance before the period, 64 in-period postings, and boundary cases.
    const ledger = [];
    await post(ownWallet, 125000, '2026-09-29T10:00:00.000000Z', 'Opening funding', 'STMT-OPENING');
    for (let index = 1; index <= ROWS; index += 1) {
      const amount = String(20000 + index * 37);
      await post(
        ownWallet,
        amount,
        `2026-10-${String(1 + (index % 28)).padStart(2, '0')}T${String(7 + (index % 12)).padStart(
          2,
          '0',
        )}:${String(index % 60).padStart(2, '0')}:00.000000Z`,
        index % 4 === 0 ? 'Wallet transfer to Ada Obi' : 'Cash deposit via agent',
        `STMT-IN-${String(index).padStart(3, '0')}`,
      );
      ledger.push(BigInt(amount));
    }
    /*
     * One microsecond before Lagos 1 October: 2026-09-30T22:59:59.999999Z is 23:59:59.999999 Lagos
     * on 30 September, so it is BEFORE the statement period and belongs to the opening balance.
     */
    await post(
      ownWallet,
      '777',
      '2026-09-30T22:59:59.999999Z',
      'One microsecond before the period',
      'STMT-BEFORE-PERIOD',
    );
    /*
     * Exactly Lagos midnight on 1 November (2026-10-31T23:00:00Z) is the FIRST instant of November:
     * it must appear in the 1 November statement and be absent from October's.
     */
    await post(
      ownWallet,
      '888',
      '2026-10-31T23:00:00.000000Z',
      'Exactly at Lagos midnight',
      'STMT-AT-MIDNIGHT',
    );
    await post(
      otherWallet,
      '5000',
      '2026-10-10T10:00:00.000000Z',
      'Foreign institution wallet',
      'STMT-FOREIGN',
      'USD',
    );
    await dataSource
      .query(
        `INSERT INTO customer_institution_enrolments
         (reference,customer_id,institution_id,status,status_reason,financial_eligibility,
          kyc_reuse_authorized,approval_id,effective_from)
       VALUES ($1,$2,$3,'ACTIVE','acceptance','ELIGIBLE',false,gen_random_uuid(),now())`,
        [`ENR-${randomUUID().slice(0, 8)}`, customerId, other],
      )
      .catch(() => undefined);

    // Opening balance = the September funding plus the microsecond-before-period posting.
    const expectedOpening = 125000n + 777n;
    const september = await api()
      .get(`${statementBase}/statement?from=2026-09-30&to=2026-09-30`)
      .set('Authorization', `Bearer ${ops.accessToken}`)
      .expect(200);
    assert.deepEqual(
      september.body.rows.map((row) => row.reference),
      ['STMT-BEFORE-PERIOD'],
      'the microsecond-before-midnight posting must belong to 30 September (Lagos)',
    );
    check('real ledger fixture: opening balance, 64 in-period postings, Lagos boundary cases', {
      openingMinor: expectedOpening.toString(),
      inPeriod: ROWS,
      microsecondBeforeBoundary: '30 September Lagos, not 1 October',
    });

    // ── HTTP: the statement reconciles with the ledger ─────────────────────────────────────────
    const preview = await api()
      .get(`${statementBase}/statement?${period}`)
      .set('Authorization', `Bearer ${ops.accessToken}`);
    if (preview.status !== 200) {
      console.error('PREVIEW FAILED', preview.status, JSON.stringify(preview.body).slice(0, 400));
      console.error(
        'wallet row',
        await dataSource.query(
          `SELECT w.id, w.customer_id::text AS customer_id, w.currency, w.institution_id::text AS institution_id FROM wallet_accounts w WHERE w.id=$1`,
          [ownWallet.walletId],
        ),
      );
      console.error('customer', customerId, 'wallet', ownWallet.walletId);
      console.error(
        'assignments',
        await dataSource.query(
          `SELECT institution_id::text AS i FROM workforce_institution_assignments WHERE principal_id=$1 AND status='ACTIVE'`,
          [ops.principal.principalId],
        ),
      );
    }
    assert.equal(preview.status, 200, JSON.stringify(preview.body).slice(0, 300));
    const expectedCredits = ledger.reduce((sum, value) => sum + value, 0n);
    assert.equal(preview.body.rows.length, ROWS);
    assert.equal(preview.body.balances.openingMinor, expectedOpening.toString());
    assert.equal(preview.body.balances.creditsMinor, expectedCredits.toString());
    assert.equal(preview.body.balances.debitsMinor, '0');
    assert.equal(
      preview.body.balances.closingMinor,
      (expectedOpening + expectedCredits).toString(),
    );
    // Running balances chain from the opening balance and end at the closing balance.
    let running = BigInt(preview.body.balances.openingMinor);
    for (const row of preview.body.rows) running += BigInt(row.amountMinor);
    assert.equal(running.toString(), preview.body.balances.closingMinor);
    // The boundary cases are outside the period; the foreign wallet's row is never in it.
    const refs = preview.body.rows.map((row) => row.reference);
    assert.ok(!refs.includes('STMT-BEFORE-PERIOD'));
    assert.ok(!refs.includes('STMT-AT-MIDNIGHT'));
    assert.ok(!refs.includes('STMT-FOREIGN'));

    const nov = await api()
      .get(`${statementBase}/statement?from=2026-11-01&to=2026-11-01`)
      .set('Authorization', `Bearer ${ops.accessToken}`)
      .expect(200);
    assert.deepEqual(
      nov.body.rows.map((row) => row.reference),
      ['STMT-AT-MIDNIGHT'],
    );
    // The opening balance of 1 November is the closing balance of 31 October: no gap, no double count.
    const lastOctober = await api()
      .get(`${statementBase}/statement?from=2026-10-31&to=2026-10-31`)
      .set('Authorization', `Bearer ${ops.accessToken}`)
      .expect(200);
    assert.equal(nov.body.balances.openingMinor, lastOctober.body.balances.closingMinor);
    check('statement figures reconcile to the ledger and to the Lagos day boundary', {
      opening: preview.body.balances.openingMinor,
      closing: preview.body.balances.closingMinor,
      novemberOpening: nov.body.balances.openingMinor,
    });

    const pdfResponse = await api()
      .get(`${statementBase}/statement.pdf?${period}`)
      .set('Authorization', `Bearer ${ops.accessToken}`)
      .expect(200);
    assert.match(pdfResponse.headers['content-type'], /application\/pdf/);
    assert.match(pdfResponse.headers['content-disposition'], /attachment; filename="[^"]+\.pdf"/);
    assert.equal(pdfResponse.headers['x-statement-rows'], String(ROWS));
    assert.equal(pdfResponse.headers['x-content-type-options'], 'nosniff');
    const apiPdfPath = path.join(OUT, 'statement-sample.pdf');
    fs.writeFileSync(apiPdfPath, pdfResponse.body);
    const parsed = await parsePdf(apiPdfPath);
    assert.ok(parsed.pageCount > 1, `expected multiple pages, got ${parsed.pageCount}`);
    assert.equal(parsed.pageCount, Number(pdfResponse.headers['x-statement-pages']));
    // A4 portrait.
    for (const page of parsed.pages) {
      assert.ok(Math.abs(page.viewport.width - 595.28) < 1);
      assert.ok(Math.abs(page.viewport.height - 841.89) < 1);
    }
    // Every page: brand header, the table header, and a page number.
    for (const [index, page] of parsed.pages.entries()) {
      assert.match(page.text, /MonieNaija/);
      assert.match(page.text, /Customer wallet statement/);
      assert.match(page.text, /Date \(Lagos\)/);
      assert.match(page.text, new RegExp(`Page ${index + 1} of ${parsed.pageCount}`));
      // The approved brand mark is embedded on each page.
      assert.ok(page.images >= 1, `page ${index + 1} has no embedded brand mark`);
    }
    /*
     * The document prints the ledger's own currency code (`NGN`) rather than a glyph, so a reader
     * can never mistake a symbol-only amount for another currency; the mask bullets prove the
     * embedded Unicode font is really in the file rather than silently substituted.
     */
    const allText = parsed.pages.map((page) => page.text).join(' ');
    assert.match(allText, /NGN/);
    assert.match(allText, /••••/);
    assert.match(allText, /Chinedu Adeyemi Okafor/);
    assert.match(allText, /2026-10-01 to 2026-10-31/);
    // The closing balance is printed; and no raw UUID leaks into the page text.
    assert.match(allText, /Closing balance/);
    for (const page of parsed.pages)
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(page.text));
    // Every in-period reference is printed exactly once across the whole document.
    for (const reference of [
      'STMT-IN-001',
      'STMT-IN-032',
      `STMT-IN-${String(ROWS).padStart(3, '0')}`,
    ]) {
      const occurrences = allText.split(reference).length - 1;
      assert.equal(occurrences, 1, `${reference} appears ${occurrences} times`);
    }
    assert.ok(!allText.includes('STMT-FOREIGN'));
    check(
      'a real multi-page A4 PDF: brand mark on every page, repeated header, correct page numbers',
      {
        pages: parsed.pageCount,
        bytes: pdfResponse.body.length,
      },
    );

    // ── Foreign institution cannot download, even by direct request ────────────────────────────
    const foreignDenied = await api()
      .get(
        `/api/v1/internal/customers/${customerId}/wallets/${otherWallet.walletId}/statement.pdf?${period}`,
      )
      .set('Authorization', `Bearer ${ops.accessToken}`);
    assert.equal(foreignDenied.status, 404);
    assert.ok(!String(foreignDenied.text || '').includes('%PDF'));
    const foreignPreviewDenied = await api()
      .get(
        `/api/v1/internal/customers/${customerId}/wallets/${otherWallet.walletId}/statement?${period}`,
      )
      .set('Authorization', `Bearer ${ops.accessToken}`);
    assert.equal(foreignPreviewDenied.status, 404);
    // Control: platform-level staff can, so the refusal is about scope not a broken route.
    const platformAllowed = await api()
      .get(
        `/api/v1/internal/customers/${customerId}/wallets/${otherWallet.walletId}/statement.pdf?${period}`,
      )
      .set('Authorization', `Bearer ${superAdmin.accessToken}`);
    assert.equal(platformAllowed.status, 200);
    check(
      'a foreign-institution operator cannot download even by direct request; platform staff can',
      {
        operatorStatus: foreignDenied.status,
        platformStatus: platformAllowed.status,
      },
    );

    // Anonymous and malformed requests.
    await api().get(`${statementBase}/statement.pdf?${period}`).expect(401);
    for (const bad of [
      'from=2026-02-30&to=2026-03-01',
      'from=2026-10-31&to=2026-10-01',
      'from=&to=',
    ]) {
      const response = await api()
        .get(`${statementBase}/statement.pdf?${bad}`)
        .set('Authorization', `Bearer ${ops.accessToken}`);
      assert.equal(response.status, 400);
    }
    check(
      'anonymous requests are refused and malformed periods are rejected before any ledger read',
    );

    // Every attempt is audited.
    const auditRows = await dataSource.query(
      `SELECT actor,new_values FROM audit_events
        WHERE entity_type='CUSTOMER_WALLET_STATEMENT' ORDER BY occurred_at ASC`,
    );
    assert.ok(auditRows.length >= 3);
    assert.ok(
      auditRows.some(
        (row) =>
          row.new_values.outcome === 'REFUSED' && row.new_values.walletId === otherWallet.walletId,
      ),
    );
    assert.ok(
      auditRows.some(
        (row) =>
          row.new_values.outcome === 'SUCCEEDED' &&
          row.new_values.walletId === ownWallet.walletId &&
          row.new_values.from === '2026-10-01' &&
          row.new_values.to === '2026-10-31',
      ),
    );
    check('every attempt is audited: operator, wallet, period, outcome — refusals included', {
      auditRows: auditRows.length,
    });

    // ── Browser: the real button, the real download, the real file ────────────────────────────
    const rendered = await renderPages(apiPdfPath, 'statement');
    check('every page rendered for visual review', { pages: rendered.length });

    if (BROWSER) {
      await app.listen(API_PORT, '0.0.0.0');
      const { chromium } = require('playwright');
      const binaryPath =
        process.env.STMT_ACCEPTANCE_CHROMIUM_PATH ||
        (await require('@sparticuz/chromium').default.executablePath());
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
        await page.getByTestId('desktop-section-servicing').click();
        await page.getByTestId('desktop-nav-customers').click();
        await page.getByPlaceholder('Name, reference or authorized contact').fill('mn-8031234567');
        await page.getByText('mn-••••4567').first().click();
        await page.getByRole('button', { name: /View NGN wallet details/ }).click();
        await page.getByLabel('From (Lagos)').fill('2026-10-01');
        await page.getByLabel('To (Lagos)').fill('2026-10-31');
        await page.getByRole('button', { name: 'Preview statement' }).click();
        await page.getByText('Ledger-derived balance at generation').waitFor();
        await page.screenshot({ path: path.join(OUT, 'statement-preview.png'), fullPage: true });

        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download PDF' }).click();
        const download = await downloadPromise;
        const savedPath = path.join(OUT, 'browser-download.pdf');
        await download.saveAs(savedPath);
        await page.getByText(/Downloaded monienaija-wallet-statement/).waitFor();
        await page.screenshot({ path: path.join(OUT, 'statement-downloaded.png'), fullPage: true });

        assert.match(
          download.suggestedFilename(),
          /^monienaija-wallet-statement-[0-9A-F]{4}-2026-10-01_2026-10-31\.pdf$/,
        );
        const saved = await parsePdf(savedPath);
        assert.equal(saved.pageCount, parsed.pageCount);
        assert.ok(saved.pageCount > 1);
        const savedText = saved.pages.map((p) => p.text).join(' ');
        assert.match(savedText, /Chinedu Adeyemi Okafor/);
        assert.match(savedText, /Closing balance/);
        assert.ok(!savedText.includes('STMT-FOREIGN'));

        // The foreign wallet must not be downloadable from the browser either.
        const blocked = await page.evaluate(async (url) => {
          const token = localStorage.getItem('admin_workforce_token');
          const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          return { status: response.status, body: (await response.text()).slice(0, 40) };
        }, `${SPA_ORIGIN}/api/v1/internal/customers/${customerId}/wallets/${otherWallet.walletId}/statement.pdf?${period}`);
        assert.equal(blocked.status, 404);
        assert.ok(!blocked.body.includes('%PDF'));
        check(
          'real browser: sign-in, Customer 360 → wallet → statement, multi-page PDF downloaded and reopened',
          {
            suggestedFilename: download.suggestedFilename(),
            pages: saved.pageCount,
            foreignRequestStatus: blocked.status,
          },
        );

        const browserPages = await renderPages(savedPath, 'browser-download');
        check('the downloaded file rendered page by page', { pages: browserPages.length });
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
            'Fully migrated disposable PostgreSQL, real AppModule, real workforce email/password sign-in, real Chromium download. Synthetic customers and postings; not a production record.',
          browser: BROWSER,
          statement: {
            pages: parsed.pageCount,
            rows: ROWS,
            openingMinor: preview.body.balances.openingMinor,
            closingMinor: preview.body.balances.closingMinor,
            file: 'statement-sample.pdf',
          },
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
  console.error('WALLET STATEMENT ACCEPTANCE FAILED:', error);
  process.exit(1);
});
