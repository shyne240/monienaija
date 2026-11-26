/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

/**
 * PR #27 — ADMIN WEB BROWSER WALKTHROUGH (real Chromium → production Admin Web bundle → real Nest
 * → disposable PostgreSQL).
 *
 * The other governed-authoring evidence for this PR is either an HTTP call from a test
 * (`v1-commercial-configuration-authoring`, 39 cases) or a client assertion against a stubbed
 * network layer (`m2-commercial-authoring-contract`). Neither proves an operator can *do* the work.
 * This suite walks the operator path once for a FEE and once for a LIMIT, and then closes the loop
 * that matters: what the preview panel displayed versus what the runtime decided.
 *
 *   1. FINANCE_PREPARER signs in through the shipped login screen and authors a WALLET_TRANSFER fee
 *      from the Fee rules screen. Nothing is written — the drawer produces a proposal.
 *   2. FINANCE_CONTROLLER signs in through the same screen (a different browser context with a
 *      different credential), opens Approvals, approves it, and applies it from the same inbox.
 *   3. The Preview tab renders the resolver's answer for a 100000 minor-unit operation.
 *   4. A REAL `TransferQuoteService.create()` quote for the same amount is compared, field by
 *      field, with what the panel showed and with the rule id the panel named.
 *   5. The same four steps run for a DAILY_AMOUNT limit rule, then
 *      `LimitEnforcementService.enforceWithManager` — the call the transfer path makes inside its
 *      own transaction — admits 50000 and refuses 150000 against the rule the panel displayed.
 *
 * The fee is deliberately the hardest shape the Studio can author — a flat fee with a VAT band and
 * a minimum/maximum collar — because that is the payload PR27-BROWSER-01 broke: the approval stored
 * a *filtered* copy of the request (`ALLOWED_COMMERCIAL_REQUEST_DETAIL_KEYS` in
 * src/authorization/commercial-rule-governance.service.ts was missing `vatBps`, `minimumFeeMinor` and
 * `maximumFeeMinor`), so replaying it to `execute-create` recomputed a different fingerprint and the
 * inbox's *Execute approved change* button returned 403 FINGERPRINT_MISMATCH. The allowlist now
 * carries those names, so the fee is applied from the inbox like the limit is; if the drift returns,
 * this suite fails at that click instead of silently degrading. The tamper half of the guarantee
 * (an altered stored request must still be refused) is pinned in
 * `test/commercial-stored-request-details-execution.integration.spec.ts`.
 *
 * Stated plainly, so the evidence cannot be over-read:
 *   - Authoring, approval and application are done by clicking the real UI. Runtime numbers come
 *     from the services the money paths call; the UI is read-only by design and is never treated as
 *     the source of a money decision.
 *   - The limit *assignment* (profile → customer) is fixture setup via SQL, as in
 *     `v1-limit-04-limit-runtime`. Assignments are not the governed change under test.
 *   - Synthetic amounts. No provider is contacted, no funds move, no journal is posted.
 *   - The KYC evidence reader is the documented test double; nothing else authorization-relevant is
 *     mocked. Chromium is launched via `@sparticuz/chromium`'s binary in a child process (its package
 *     is ESM-only), exactly as `transaction-history-browser-matrix` does.
 *
 * Gated on PR27_WALKTHROUGH_BROWSER=yes because it needs a Chromium binary and a built
 * `apps/admin-web/dist`:
 *
 *   ADMIN_WEB_API_BASE_URL=/api/v1 npm run build --prefix apps/admin-web
 *   PR27_WALKTHROUGH_BROWSER=yes PR27_CHROMIUM_PATH=/tmp/chromium PR27_CHROMIUM_LIB=/tmp/al2023/lib \
 *   PR27_WALKTHROUGH_OUT=docs/commercial/evidence/pr27-browser-walkthrough \
 *   node scripts/run-pg-integration-tests.js test/pr27-commercial-browser-walkthrough.integration.spec.ts
 */

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { AuditService } from '../src/operations/audit.service';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { ProductCatalogSeedService } from '../src/product-catalog/product-catalog-seed.service';
import { TransferQuoteService } from '../src/transfer/transfer-quote.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LimitEnforcementService } from '../src/limit-catalog/limit-enforcement.service';
import {
  createIntegrationDataSourceFromScratch,
  destroyIntegrationDataSource,
} from './support/pg-harness';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import { createEligibleCustomer } from './support/kyc-test-fixtures';
import { GovernedFinancialFixture } from './support/governed-financial-fixture';

const seed = require('../scripts/local-dev-seed-11-roles.js');
// One handle for both the provider override and the fixtures: the trust key is per-handle, so a
// second instance would sign evidence the application never trusts.
const kyc = createTestEvidenceReader({ mode: 'ELIGIBLE' });

const BROWSER_ENABLED = process.env.PR27_WALKTHROUGH_BROWSER === 'yes';
const DIST = resolve(process.cwd(), 'apps/admin-web/dist');
const OUT = resolve(process.env.PR27_WALKTHROUGH_OUT ?? 'data/validation/pr27-browser-walkthrough');
const API_PORT = Number(process.env.PR27_WALKTHROUGH_API_PORT ?? 3099);
const WEB_PORT = Number(process.env.PR27_WALKTHROUGH_WEB_PORT ?? 4310);
const ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const PRODUCT = 'WALLET_TRANSFER';
const CURRENCY = 'NGN';
const FEE_MINOR = '100';
const FEE_MINIMUM_MINOR = '50';
const FEE_MAXIMUM_MINOR = '500';
const VAT_BPS = '750';
const LIMIT_PROFILE = 'PR27_BROWSER_WALK';
const DAILY_LIMIT_MINOR = '100000';

/**
 * Commercial accounting registry rows provisioned verbatim from migration 1785753600076. The fee
 * quote path refuses to price a configured fee without them, and the migration's seed is not
 * guaranteed on a from-scratch database, so the suite provisions the same four families the sibling
 * PR #27 quote suite uses.
 */
const ACCOUNTING_FAMILIES = [
  { role: 'FEE_REVENUE', code: 'FINANCE-FEE_REVENUE-NGN', type: 'REVENUE', normal: 'CREDIT' },
  { role: 'VAT_PAYABLE', code: 'FINANCE-VAT_PAYABLE-NGN', type: 'LIABILITY', normal: 'CREDIT' },
  {
    role: 'COMMISSION_EXPENSE',
    code: 'FINANCE-COMMISSION_EXPENSE-NGN',
    type: 'EXPENSE',
    normal: 'DEBIT',
  },
  {
    role: 'COMMISSION_PAYABLE',
    code: 'FINANCE-COMMISSION_PAYABLE-NGN',
    type: 'LIABILITY',
    normal: 'CREDIT',
  },
] as const;

const SECTION_FOR_VIEW: Record<string, string> = {
  feeRules: 'commercial',
  commissionRules: 'commercial',
  rewardRules: 'commercial',
  productCatalogue: 'commercial',
  limitCatalogue: 'commercial',
  limitAssignments: 'commercial',
  approvalsInbox: 'platform',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Serves the built bundle and forwards `/api/**` to the live Nest listener byte for byte, so the
 * page's same-origin base URL (`/api/v1`) reaches the real backend. Nothing is stubbed or reshaped.
 */
function startWebServer(apiTarget: string, port: number): Promise<Server> {
  const upstream = new URL(apiTarget);
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      const proxied = httpRequest(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `${upstream.hostname}:${upstream.port}` },
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      proxied.on('error', (error) => {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'proxy_failed', message: error.message }));
      });
      req.pipe(proxied);
      return;
    }
    const url = new URL(req.url ?? '/', ORIGIN);
    const candidate = join(DIST, decodeURIComponent(url.pathname));
    const inside = candidate.startsWith(DIST);
    const isFile = inside && existsSync(candidate) && statSync(candidate).isFile();
    const target = isFile ? candidate : join(DIST, 'index.html');
    if (!existsSync(target)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(target).pipe(res);
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

const describeIfBrowser = BROWSER_ENABLED ? describe : describe.skip;

describeIfBrowser('PR27 Admin Web governed fee + limit walkthrough (real browser)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let fixture: GovernedFinancialFixture;
  let web: Server | undefined;
  let browser: Browser | undefined;
  let customerId: string;
  const oldEnv = { ...process.env };
  const screenshots: string[] = [];
  const pageDiagnostics = new WeakMap<Page, { console: string[]; network: string[] }>();
  let checkerSession: { context: BrowserContext; page: Page } | undefined;
  const report: Record<string, any> = {
    generatedAt: null,
    kind: 'PR27_ADMIN_WEB_BROWSER_WALKTHROUGH',
    origin: ORIGIN,
    adminWeb:
      'apps/admin-web/dist (production Vite bundle built with ADMIN_WEB_API_BASE_URL=/api/v1, served with a byte-for-byte /api proxy)',
    database: process.env.DB_NAME ?? null,
    checks: [],
    findings: [],
    regressionGuards: [
      'PR27-BROWSER-01 (fixed in this revision): the authored fee carries vatBps 750 and a 50/500 ' +
        'minimum/maximum collar, and is applied by the inbox Execute button, not by an API replay.',
    ],
    screenshots: [],
  };

  const check = (name: string, ok: boolean, detail: unknown) => {
    report.checks.push({ name, ok, detail });
    if (!ok) throw new Error(`walkthrough check failed: ${name} :: ${JSON.stringify(detail)}`);
  };

  beforeAll(async () => {
    process.env.LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database';
    // Runtime commercial accounting is read fresh per call; an explicit VAT treatment is required
    // before any fee can be quoted. EXCLUSIVE_ADD_ON mirrors the sibling PR #27 suites.
    process.env.COMMERCIAL_ACCOUNTING_ENABLED = 'true';
    process.env.COMMERCIAL_ACCOUNTING_VAT_TREATMENT = 'EXCLUSIVE_ADD_ON';
    process.env.COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT = 'EXPENSE_PAYABLE';
    process.env.COMMERCIAL_COMMISSION_RECOGNITION_TIMING = 'ACCRUE_NOW_SETTLE_LATER';
    process.env.NOTIFICATION_WORKER_ENABLED = 'false';
    process.env.CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false';
    mkdirSync(OUT, { recursive: true });
    if (!existsSync(join(DIST, 'index.html'))) {
      throw new Error(
        `apps/admin-web/dist is missing. Run \`npm run build --prefix apps/admin-web\` first (looked in ${DIST}).`,
      );
    }
    dataSource = await createIntegrationDataSourceFromScratch('pr27walk');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kyc.reader)
      .compile();
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get(ProductCatalogSeedService).seedIfEmpty();
    await seed.seedLocalRoles(dataSource, app.get('A2_WORKFORCE_CONFIG'), app.get(AuditService));
    fixture = new GovernedFinancialFixture({ app, dataSource, label: 'pr27walk' });
    await app.listen(API_PORT, '127.0.0.1');
    web = await startWebServer(`http://127.0.0.1:${API_PORT}`, WEB_PORT);

    if (process.env.PR27_CHROMIUM_LIB) {
      process.env.LD_LIBRARY_PATH = process.env.PR27_CHROMIUM_LIB;
    }
    // `@sparticuz/chromium` ships ESM only, so its executable path and flags are resolved in a child
    // process instead of requiring an ES module from Jest's CommonJS runtime.
    let executablePath = process.env.PR27_CHROMIUM_PATH;
    let launchArgs: string[] = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
    if (!executablePath) {
      const resolved = spawnSync(
        process.execPath,
        [
          '-e',
          "const c=require('@sparticuz/chromium').default;c.executablePath().then(path=>console.log(JSON.stringify({path,args:c.args})))",
        ],
        { encoding: 'utf8', cwd: process.cwd() },
      );
      const parsed = JSON.parse(resolved.stdout.trim() || '{}') as {
        path?: string;
        args?: string[];
      };
      executablePath = parsed.path;
      if (parsed.args) launchArgs = parsed.args.filter((arg) => arg !== '--single-process');
    }
    if (!executablePath || !existsSync(executablePath)) {
      throw new Error(`no Chromium binary at ${executablePath ?? '(unresolved)'}`);
    }
    const { chromium: playwrightChromium } = require('playwright');
    browser = await playwrightChromium.launch({
      executablePath,
      args: launchArgs,
      env: { ...process.env },
      headless: true,
    });
  }, 300_000);

  afterAll(async () => {
    await browser?.close();
    await app?.close();
    if (web) await new Promise<void>((done) => web!.close(() => done()));
    if (dataSource) await destroyIntegrationDataSource(dataSource);
    process.env = oldEnv;
    report.generatedAt = new Date().toISOString();
    report.screenshots = screenshots;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'walkthrough.json'), `${JSON.stringify(report, null, 2)}\n`);
  }, 120_000);

  async function shot(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
    screenshots.push(`${name}.png`);
  }

  /**
   * Real local password login through the shipped login screen — no token injection — asserting the
   * session that comes back actually holds the role that was asked for.
   */
  async function signIn(role: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser!.newContext({ viewport: { width: 1512, height: 982 } });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const network: string[] = [];
    pageDiagnostics.set(page, { console: consoleErrors, network });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => {
      if (request.method() === 'GET') return;
      network.push(`>> ${request.method()} ${request.url().replace(ORIGIN, '')}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (!url.includes('/api/')) return;
      network.push(`<< ${response.status()} ${url.replace(ORIGIN, '')}`);
      if (response.status() >= 400) {
        void response
          .text()
          .then((body) => network.push(`!! body ${body.slice(0, 600)}`))
          .catch(() => undefined);
      }
    });
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Workforce email').fill(seed.emailFor(role));
    await page.getByPlaceholder('••••••••••••').fill(seed.passwordFor(role));
    await page.getByRole('button', { name: 'Sign in', exact: false }).click();
    try {
      await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 45_000 });
    } catch (error) {
      await page.screenshot({ path: join(OUT, `login-failed-${role}.png`), fullPage: true });
      writeFileSync(
        join(OUT, `login-failed-${role}.txt`),
        [
          `role=${role} origin=${ORIGIN}`,
          '--- console errors ---',
          ...consoleErrors,
          '--- requests/responses ---',
          ...network,
          '--- body text ---',
          (await page.locator('body').innerText()).slice(0, 4000),
        ].join('\n'),
      );
      throw error;
    }
    await page.waitForTimeout(500);
    const principalRaw = await page
      .evaluate(() => window.localStorage.getItem('admin_workforce_principal'))
      .catch(() => null);
    const session = JSON.parse(principalRaw ?? '{}') as { roles?: string[]; scopes?: string[] };
    writeFileSync(join(OUT, `principal-${role}.json`), String(principalRaw ?? 'null'));
    const roles = session.roles ?? [];
    if (!roles.includes(role)) {
      writeFileSync(
        join(OUT, `session-mismatch-${role}.txt`),
        [`expected role ${role}, session roles: ${roles.join(',') || '(none)'}`, ...network].join(
          '\n',
        ),
      );
      throw new Error(`signed in as ${roles.join(',') || 'no role'}, expected ${role}`);
    }
    return { context, page };
  }

  /**
   * Opens a navigation view the way an operator does: expand the section that holds it, then click
   * the item. The shell renders every group collapsed until it is opened.
   */
  async function openView(page: Page, viewKey: string): Promise<void> {
    const sectionId = SECTION_FOR_VIEW[viewKey];
    const item = page.locator(`[data-testid="nav-${viewKey}"]`);
    if (sectionId) {
      const toggle = page.locator(`[data-testid="section-${sectionId}"]`);
      if ((await toggle.count()) > 0) {
        await toggle.scrollIntoViewIfNeeded().catch(() => undefined);
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
          await toggle.click();
          await page.waitForTimeout(250);
        }
      }
    }
    try {
      await item.click({ timeout: 20_000 });
    } catch (error) {
      const rendered: string[] = [];
      const navs = page.locator('[data-testid^="nav-"]');
      for (let index = 0; index < (await navs.count()); index += 1) {
        const node = navs.nth(index);
        rendered.push(
          `${await node.getAttribute('data-testid')}=${(await node.isVisible()) ? 'visible' : 'hidden'}`,
        );
      }
      writeFileSync(
        join(OUT, `nav-failed-${viewKey}.txt`),
        `view=${viewKey} section=${sectionId ?? '(none)'}\nrendered nav items: ${rendered.join(', ')}\n`,
      );
      throw error;
    }
    await page.waitForTimeout(400);
  }

  /**
   * Clicks "Submit for approval". On success the screen closes the drawer itself, so there is no
   * receipt to read here: the pending approval is discovered in the Approvals inbox by the checker.
   * On refusal the drawer stays open and prints why — that text is what gets reported.
   */
  async function submitProposal(page: Page, form: any, label: string): Promise<void> {
    await form.getByRole('button', { name: 'Submit for approval' }).click();
    const closed = await form
      .waitFor({ state: 'detached', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (closed) return;
    const diagnostics = pageDiagnostics.get(page) ?? { console: [], network: [] };
    await page.screenshot({ path: join(OUT, `submit-refused-${label}.png`), fullPage: true });
    writeFileSync(
      join(OUT, `submit-refused-${label}.txt`),
      [
        `label=${label}`,
        '--- console errors ---',
        ...diagnostics.console,
        '--- requests/responses ---',
        ...diagnostics.network,
        '--- page text ---',
        (await page.locator('body').innerText()).slice(0, 4000),
      ].join('\n'),
    );
    throw new Error(`proposal was not recorded (${label}); see submit-refused-${label}.txt`);
  }

  /**
   * The checker's real discovery step: open Approvals, filter to REQUESTED for the action, read the
   * approval id off the card. Nothing is injected; the id comes from the page.
   */
  async function pendingApprovalIds(page: Page, actionType: string): Promise<string[]> {
    const inbox = page.locator('section[aria-label="Commercial and Governance Approval Inbox"]');
    await page.locator('select[aria-label="Filter by status"]').selectOption('REQUESTED');
    await page.locator('input[aria-label="Filter by action"]').fill(actionType);
    await inbox.getByRole('button', { name: /^Refresh/ }).click();
    await inbox.getByText(actionType, { exact: false }).first().waitFor({ timeout: 30_000 });
    const text = await inbox.innerText();
    const ids = [
      ...text.matchAll(
        /Approval ID\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
      ),
    ].map((match) => match[1]!);
    if (ids.length === 0) {
      throw new Error(`no pending ${actionType} approval id in the inbox: ${text.slice(0, 400)}`);
    }
    return [...new Set(ids)];
  }

  /** Approve or execute one approval, by clicking the card's own button. */
  async function decideInInbox(
    page: Page,
    approvalId: string,
    action: 'approve' | 'execute',
  ): Promise<void> {
    const inbox = page.locator('section[aria-label="Commercial and Governance Approval Inbox"]');
    await page
      .locator('select[aria-label="Filter by status"]')
      .selectOption(action === 'approve' ? 'REQUESTED' : 'APPROVED');
    await inbox.getByRole('button', { name: /^Refresh/ }).click();
    const code = inbox.getByText(approvalId, { exact: true }).first();
    await code.waitFor({ timeout: 30_000 });
    // The card is the nearest ancestor div that owns a decision button.
    const card = code.locator('xpath=ancestor::div[.//button][1]');
    if (action === 'approve') {
      await card.getByRole('button', { name: 'Approve', exact: true }).click();
    } else {
      await card.getByRole('button', { name: 'Execute approved change' }).click();
    }
  }

  /**
   * Waits for the inbox's own confirmation line. A timeout here is the interesting case (the API
   * refused the decision), so the inbox's rendered error and the network log are kept.
   */
  async function waitForNotice(page: Page, pattern: RegExp, tag: string): Promise<boolean> {
    const found = await page
      .getByText(pattern)
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!found) {
      const diagnostics = pageDiagnostics.get(page) ?? { console: [], network: [] };
      await page.screenshot({ path: join(OUT, `notice-missing-${tag}.png`), fullPage: true });
      writeFileSync(
        join(OUT, `notice-missing-${tag}.txt`),
        [
          `expected notice matching: ${String(pattern)}`,
          '--- console errors ---',
          ...diagnostics.console,
          '--- requests/responses ---',
          ...diagnostics.network,
          '--- page text ---',
          (await page.locator('body').innerText()).slice(0, 4000),
        ].join('\n'),
      );
    }
    return found;
  }

  async function seedAccountingFamilies(institutionId: string): Promise<void> {
    for (const family of ACCOUNTING_FAMILIES) {
      await dataSource.query(
        `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active, institutional_scope, institution_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS', FALSE, TRUE, 'INSTITUTION', $5)
         ON CONFLICT (code) DO NOTHING`,
        [family.code, `${family.code} (PR27 fixture)`, family.type, family.normal, institutionId],
      );
      await dataSource.query(
        `INSERT INTO commercial_accounting_registry (
           family_code, account_code, account_type, normal_balance, currency, accounting_unit,
           purpose, decision_references, evidence_source, provisioned_by
         ) VALUES ($1, $2, $3, $4, 'NGN', 'CUSTOMER_FUNDS',
           'PR27 fixture mirroring migration 1785753600076', ARRAY['DP-31=A'], 'TEST', '1785753600076')
         ON CONFLICT (family_code) DO NOTHING`,
        [family.role, family.code, family.type, family.normal],
      );
    }
  }

  const approvalRow = async (approvalId: string) =>
    (
      await dataSource.query<Array<{ status: string; policy: any }>>(
        'SELECT status, policy FROM privileged_action_approvals WHERE id = $1',
        [approvalId],
      )
    )[0];

  /** Fills the fee drawer. `withVat` reproduces what the Studio builds for a VAT-bearing fee. */
  async function fillFeeForm(
    page: Page,
    options: { reason: string; withVat: boolean; priority?: string },
  ): Promise<any> {
    const form = page.locator('form[aria-label="Fee rule create form"]');
    await form.waitFor({ timeout: 30_000 });
    await form.locator('#authoring-reason').fill(options.reason);
    await form.locator('#authoring-productCode').fill(PRODUCT);
    await form.locator('#authoring-currency').fill(CURRENCY);
    await form.locator('#authoring-flatFeeMinor').fill(FEE_MINOR);
    await form.locator('#authoring-percentageBps').fill('0');
    if (options.withVat) {
      await form.locator('#authoring-minimumFeeMinor').fill(FEE_MINIMUM_MINOR);
      await form.locator('#authoring-maximumFeeMinor').fill(FEE_MAXIMUM_MINOR);
      await form.locator('#authoring-vatBps').fill(VAT_BPS);
    }
    await form.locator('#authoring-priority').fill(options.priority ?? '100');
    await form.locator('#authoring-effectiveFrom').fill('2026-01-01T00:00');
    // "Effective until" stays empty: open-ended must emit NO key rather than a fabricated date.
    return form;
  }

  it('authors, independently approves, applies, previews and re-checks a FEE rule in the real Admin Web', async () => {
    // ── Fixture: an eligible customer with a wallet, so runtime pricing prices something real.
    const customer = await createEligibleCustomer(dataSource, kyc);
    const counterparty = await createEligibleCustomer(dataSource, kyc);
    customerId = customer.customerId;
    const institutionId = await fixture.institution('pr27-walk');
    await seedAccountingFamilies(institutionId);
    await fixture.enrolCustomer(customer.customerId, institutionId);
    await fixture.enrolCustomer(counterparty.customerId, institutionId);
    const wallets = app.get(WalletService);
    const source = await wallets.createWallet({
      customerId: customer.customerId,
      currency: CURRENCY,
      idempotencyKey: `pr27-walk-src-${randomUUID()}`,
    });
    const destination = await wallets.createWallet({
      customerId: counterparty.customerId,
      currency: CURRENCY,
      idempotencyKey: `pr27-walk-dst-${randomUUID()}`,
    });
    await fixture.attributeWallet(source.id, institutionId);
    await fixture.attributeWallet(destination.id, institutionId);
    report.fee = {
      maker: seed.emailFor('FINANCE_PREPARER'),
      checker: seed.emailFor('FINANCE_CONTROLLER'),
    };

    // ── 1. Maker: author the fee exactly as the Studio builds it (VAT band included).
    const maker = await signIn('FINANCE_PREPARER');
    await openView(maker.page, 'feeRules');
    await maker.page.getByRole('tab', { name: 'Fees' }).click();
    await shot(maker.page, '01-fee-rules-registry-before');
    const feeRulesBefore = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM fee_rules',
    );
    check('no fee rule exists before authoring', feeRulesBefore[0]!.count === '0', {
      count: feeRulesBefore[0]!.count,
    });

    await maker.page.getByRole('button', { name: 'Propose a new fee rule' }).click();
    const vatForm = await fillFeeForm(maker.page, {
      reason: 'PR27 browser walkthrough — wallet transfer fee with VAT band',
      withVat: true,
    });
    await shot(maker.page, '02-fee-authoring-drawer-filled-vat');
    await submitProposal(maker.page, vatForm, 'fee-vat');
    await shot(maker.page, '03-fee-proposal-submitted-drawer-closed');
    const feeRulesAfterProposal = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM fee_rules',
    );
    check('the proposal alone writes nothing', feeRulesAfterProposal[0]!.count === '0', {
      count: feeRulesAfterProposal[0]!.count,
    });

    // Separation of duties in the client: a FINANCE_PREPARER session is not offered the checker
    // workspace at all (navigation-access.ts requires FINANCE_CONTROLLER + privileged:approve).
    const makerSeesApprovals = await maker.page
      .locator('[data-testid="nav-approvalsInbox"]')
      .count();
    check('the maker is not offered the checker workspace', makerSeesApprovals === 0, {
      renderedNavItems: makerSeesApprovals,
    });
    await shot(maker.page, '04-maker-has-no-checker-workspace');

    // ── 2. Checker: different context, different credential, approves it.
    const checker = await signIn('FINANCE_CONTROLLER');
    await openView(checker.page, 'approvalsInbox');
    const [feeApprovalId] = await pendingApprovalIds(checker.page, 'FEE_RULE_CREATE');
    report.fee.approvalId = feeApprovalId;
    await decideInInbox(checker.page, feeApprovalId!, 'approve');
    const approvedNotice = await waitForNotice(
      checker.page,
      new RegExp(`Approval ${feeApprovalId} recorded as APPROVED`),
      'fee-approve',
    );
    check('the independent checker approved the fee proposal', approvedNotice, {
      approvalId: feeApprovalId,
    });
    await shot(checker.page, '05-fee-approved-by-independent-checker');
    check(
      'the approval ledger records APPROVED',
      (await approvalRow(feeApprovalId!))?.status === 'APPROVED',
      { status: (await approvalRow(feeApprovalId!))?.status },
    );

    // ── 3. The checker applies it from the same inbox — no API workaround.
    // This is the exact step PR27-BROWSER-01 used to break (403 FINGERPRINT_MISMATCH on a
    // VAT-bearing fee); the authored fee now carries VAT *and* a min/max collar so the regression
    // cannot come back unnoticed.
    await decideInInbox(checker.page, feeApprovalId!, 'execute');
    const executedNotice = await waitForNotice(
      checker.page,
      new RegExp(`Approved change ${feeApprovalId} executed and consumed`),
      'fee-execute',
    );
    await shot(checker.page, '06-fee-approved-change-executed-from-inbox');
    const appliedFee = await dataSource.query<
      Array<{
        id: string;
        flat_fee_minor: string;
        minimum_fee_minor: string | null;
        maximum_fee_minor: string | null;
        vat_bps: number | null;
        effective_to: string | null;
      }>
    >(
      `SELECT id, flat_fee_minor, minimum_fee_minor::text AS minimum_fee_minor,
              maximum_fee_minor::text AS maximum_fee_minor, vat_bps,
              effective_to::text AS effective_to
         FROM fee_rules WHERE product_code = $1 AND currency = $2`,
      [PRODUCT, CURRENCY],
    );
    const feeRuleId = appliedFee[0]!.id;
    report.fee.ruleId = feeRuleId;
    report.fee.appliedRule = {
      flatFeeMinor: appliedFee[0]!.flat_fee_minor,
      minimumFeeMinor: appliedFee[0]!.minimum_fee_minor,
      maximumFeeMinor: appliedFee[0]!.maximum_fee_minor,
      vatBps: appliedFee[0]!.vat_bps,
      effectiveTo: appliedFee[0]!.effective_to,
    };
    check(
      'the inbox applied the VAT + min/max fee and consumed the approval',
      executedNotice &&
        (await approvalRow(feeApprovalId!))?.status === 'CONSUMED' &&
        appliedFee.length === 1 &&
        appliedFee[0]!.flat_fee_minor === FEE_MINOR &&
        appliedFee[0]!.minimum_fee_minor === FEE_MINIMUM_MINOR &&
        appliedFee[0]!.maximum_fee_minor === FEE_MAXIMUM_MINOR &&
        appliedFee[0]!.vat_bps === Number(VAT_BPS) &&
        appliedFee[0]!.effective_to === null,
      {
        executed: executedNotice,
        approvalStatus: (await approvalRow(feeApprovalId!))?.status,
        rule: report.fee.appliedRule,
        rules: appliedFee.length,
      },
    );

    // ── 5. Preview in the browser.
    await openView(checker.page, 'feeRules');
    await checker.page.getByRole('tab', { name: /Preview/i }).click();
    await checker.page.locator('input[aria-label="Preview product code"]').fill(PRODUCT);
    await checker.page.locator('input[aria-label="Preview currency"]').fill(CURRENCY);
    await checker.page
      .locator('input[aria-label="Preview principal id"]')
      .fill(customer.customerId);
    await checker.page.locator('input[aria-label="Preview amount in minor units"]').fill('100000');
    await checker.page.getByRole('button', { name: 'Evaluate configuration' }).click();
    const feeSection = checker.page
      .locator('section', {
        has: checker.page.getByRole('heading', { name: 'Applicable fee rule' }),
      })
      .first();
    await feeSection.waitFor({ timeout: 30_000 });
    const feeSectionText = await feeSection.innerText();
    await shot(checker.page, '07-fee-preview-in-browser');
    check('the preview panel names the applied rule id', feeSectionText.includes(feeRuleId), {
      ruleId: feeRuleId,
      panel: feeSectionText.replace(/\s+/g, ' ').slice(0, 400),
    });
    // Read the numbers the panel actually rendered, so parity is compared value by value rather
    // than by "some number appears somewhere".
    const panelLine = (label: string): string | null => {
      const found = new RegExp(`${label} \\(minor\\)\\s+([\\d,]+)`).exec(
        feeSectionText.replace(/\s+/g, ' '),
      );
      return found ? found[1]!.replace(/,/g, '') : null;
    };
    const preview = {
      ruleIdShown: feeSectionText.includes(feeRuleId),
      feeMinor: panelLine('Computed fee'),
      vatMinor: panelLine('Computed VAT'),
      totalMinor: panelLine('Computed total'),
      excerpt: feeSectionText.replace(/\s+/g, ' ').slice(0, 700),
    };
    report.fee.previewPanel = preview;
    check(
      'the preview panel renders a non-zero VAT and the authored flat fee',
      preview.feeMinor === FEE_MINOR && preview.vatMinor !== null && preview.vatMinor !== '0',
      preview,
    );

    // ── 6. Runtime: the real quote service, for the same amount.
    const clock = new Date();
    const credential = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO customer_authentication_credentials
         (customer_id, password_hash, hash_algorithm, password_version, password_changed_at,
          status, account_locked, failed_authentication_count, version)
       VALUES ($1, 'pr27-walk-not-a-login-credential', 'PBKDF2', 1, now(), 'ACTIVE', false, 0, 1)
       RETURNING id`,
      [customer.customerId],
    );
    const sessionRows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO authentication_sessions
         (customer_id, credential_id, token_hash, audience, status, issued_at, expires_at,
          last_seen_at, onboarding_password_version)
       VALUES ($1, $2, $3, 'customer-api', 'ACTIVE', $4, $5, $4, 1) RETURNING id`,
      [
        customer.customerId,
        credential[0]!.id,
        randomUUID().replace(/-/g, '').padEnd(64, '0'),
        clock.toISOString(),
        new Date(clock.getTime() + 900_000).toISOString(),
      ],
    );
    const quote = await app.get(TransferQuoteService).create(
      {
        type: 'CUSTOMER',
        principalId: customer.customerId,
        customerId: customer.customerId,
        sessionId: sessionRows[0]!.id,
        roles: [],
        scopes: [],
        customerAccess: 'SELF',
      } as any,
      {
        sourceWalletId: source.id,
        destinationWalletId: destination.id,
        amountMinor: '100000',
        currency: CURRENCY,
        idempotencyKey: `pr27-walk-quote-${randomUUID()}`,
      },
    );
    report.fee.runtimeQuote = {
      amountMinor: quote.amountMinor,
      feeMinor: quote.feeMinor,
      vatMinor: quote.vatMinor,
      totalDebitMinor: quote.totalDebitMinor,
      status: quote.status,
    };
    check(
      'preview and runtime agree on the rule, the fee, the VAT and the total',
      preview.ruleIdShown &&
        quote.feeMinor === preview.feeMinor &&
        quote.vatMinor === preview.vatMinor &&
        quote.totalDebitMinor === preview.totalMinor &&
        quote.feeMinor === FEE_MINOR &&
        // 100 * 750bps, floor-rounded on the clamped fee; total = principal + fee + VAT.
        quote.vatMinor === '7' &&
        quote.totalDebitMinor === '100107',
      { preview, runtime: report.fee.runtimeQuote },
    );
    const journals = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM ledger_journals',
    );
    report.fee.journalsPosted = journals[0]!.count;
    check('no journal was posted by preview or quote', journals[0]!.count === '0', {
      count: journals[0]!.count,
    });
    await shot(maker.page, '09-maker-session-after-apply');
    await maker.context.close();
    checkerSession = checker;
  }, 900_000);

  it('authors, approves, applies and enforces a LIMIT rule in the same browser session', async () => {
    if (!checkerSession) throw new Error('the checker session from the fee walkthrough is missing');
    const checkerPage = checkerSession.page;

    // ── 1. Maker creates the limit profile (a direct, audited limit.modify action) and authors the
    // governed rule. Profiles are intentionally not part of the governed-change flow.
    const maker = await signIn('FINANCE_PREPARER');
    await openView(maker.page, 'limitCatalogue');
    await maker.page.getByRole('button', { name: 'Create limit profile' }).click();
    await maker.page.locator('input[aria-label="Limit profile code"]').fill(LIMIT_PROFILE);
    await maker.page
      .locator('input[aria-label="Limit profile name"]')
      .fill('PR27 browser walk profile');
    await maker.page.locator('select[aria-label="Limit profile kind"]').selectOption('CUSTOMER');
    await maker.page.locator('select[aria-label="Limit profile status"]').selectOption('ACTIVE');
    await maker.page
      .locator('select[aria-label="Limit profile configuration status"]')
      .selectOption('CONFIGURED');
    await maker.page.locator('select[aria-label="Limit profile enabled"]').selectOption('true');
    await maker.page.getByRole('button', { name: 'Create profile' }).click();
    await maker.page.waitForTimeout(1500);
    const profileRow = await dataSource.query<Array<{ code: string; enabled: boolean }>>(
      'SELECT code, enabled FROM limit_profiles WHERE code = $1',
      [LIMIT_PROFILE],
    );
    await shot(maker.page, '11-limit-profile-created-in-studio');
    check(
      'the profile created from the Studio exists and is enabled',
      profileRow.length === 1 && profileRow[0]!.enabled === true,
      profileRow,
    );

    // Fixture prerequisite (not the governed change under test): assign the profile to the customer.
    await dataSource.query(
      `INSERT INTO limit_assignments
         (id, limit_profile_code, subject_type, subject_id, segment_code, precedence,
          effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,'CUSTOMER',$3,NULL,0,$4,NULL,true,'pr27-walkthrough-fixture')`,
      [randomUUID(), LIMIT_PROFILE, customerId, new Date(Date.now() - 86_400_000).toISOString()],
    );

    await maker.page.getByRole('tab', { name: /Limits/i }).click();
    await maker.page.getByRole('button', { name: 'Propose a new limit rule' }).first().click();
    const limitForm = maker.page.locator('form[aria-label="Limit rule create form"]');
    await limitForm.waitFor({ timeout: 30_000 });
    await limitForm
      .locator('#authoring-reason')
      .fill('PR27 browser walkthrough — daily outgoing cap');
    await limitForm.locator('#authoring-limitProfileCode').fill(LIMIT_PROFILE);
    await limitForm.locator('#authoring-product').fill(PRODUCT);
    await limitForm.locator('#authoring-currency').fill(CURRENCY);
    await limitForm.locator('#authoring-dimension').selectOption('DAILY_AMOUNT');
    await limitForm.locator('#authoring-direction').selectOption('OUTGOING');
    await limitForm.locator('#authoring-limitValueMinor').fill(DAILY_LIMIT_MINOR);
    await limitForm.locator('#authoring-effectiveFrom').fill('2026-01-01T00:00');
    await shot(maker.page, '12-limit-authoring-drawer-filled');
    await submitProposal(maker.page, limitForm, 'limit');
    report.limit = { profileCode: LIMIT_PROFILE, maker: seed.emailFor('FINANCE_PREPARER') };
    const rulesBeforeApply = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM limit_rules WHERE product = $1',
      [PRODUCT],
    );
    check('the limit proposal writes no rule', rulesBeforeApply[0]!.count === '0', {
      count: rulesBeforeApply[0]!.count,
    });

    // ── 2 + 3. Independent approval and application from the checker's own session.
    await openView(checkerPage, 'approvalsInbox');
    const [limitApprovalId] = await pendingApprovalIds(checkerPage, 'LIMIT_RULE_CREATE');
    report.limit.approvalId = limitApprovalId;
    await decideInInbox(checkerPage, limitApprovalId!, 'approve');
    check(
      'the checker approved the limit proposal',
      await waitForNotice(
        checkerPage,
        new RegExp(`Approval ${limitApprovalId} recorded as APPROVED`),
        'limit-approve',
      ),
      { approvalId: limitApprovalId },
    );
    await shot(checkerPage, '13-limit-approved-by-independent-checker');
    await decideInInbox(checkerPage, limitApprovalId!, 'execute');
    const limitExecuted = await waitForNotice(
      checkerPage,
      new RegExp(`Approved change ${limitApprovalId} executed and consumed`),
      'limit-execute',
    );
    await shot(checkerPage, '14-limit-approved-change-executed');
    const appliedLimit = await dataSource.query<
      Array<{ id: string; dimension: string; limit_value_minor: string; direction: string }>
    >(
      `SELECT id, dimension, limit_value_minor::text AS limit_value_minor, direction
         FROM limit_rules WHERE product = $1 AND dimension = 'DAILY_AMOUNT'`,
      [PRODUCT],
    );
    check(
      'the limit execution applied exactly one DAILY_AMOUNT rule',
      limitExecuted && appliedLimit.length === 1,
      { executed: limitExecuted, rules: appliedLimit },
    );
    const limitRuleId = appliedLimit[0]!.id;
    report.limit.ruleId = limitRuleId;

    // ── 4. Preview: the panel must show the authored threshold for this customer.
    await openView(checkerPage, 'feeRules');
    await checkerPage.getByRole('tab', { name: /Preview/i }).click();
    await checkerPage.locator('input[aria-label="Preview product code"]').fill(PRODUCT);
    await checkerPage.locator('input[aria-label="Preview currency"]').fill(CURRENCY);
    await checkerPage.locator('input[aria-label="Preview principal id"]').fill(customerId);
    await checkerPage.locator('input[aria-label="Preview amount in minor units"]').fill('50000');
    await checkerPage.getByRole('button', { name: 'Evaluate configuration' }).click();
    const limitSection = checkerPage
      .locator('section', {
        has: checkerPage.getByRole('heading', { name: 'Effective limit profile' }),
      })
      .first();
    await limitSection.waitFor({ timeout: 30_000 });
    const limitSectionText = await limitSection.innerText();
    await shot(checkerPage, '15-limit-preview-in-browser');
    check(
      'the preview panel shows the authored DAILY_AMOUNT threshold',
      /DAILY_AMOUNT/.test(limitSectionText) && limitSectionText.includes(DAILY_LIMIT_MINOR),
      { panel: limitSectionText.replace(/\s+/g, ' ').slice(0, 500) },
    );
    report.limit.previewPanel = {
      dimensionShown: /DAILY_AMOUNT/.test(limitSectionText),
      limitShown: limitSectionText.includes(DAILY_LIMIT_MINOR),
      excerpt: limitSectionText.replace(/\s+/g, ' ').slice(0, 700),
    };

    // ── 5. Runtime: the enforcement the transfer path calls, inside a real transaction.
    const limits = app.get(LimitEnforcementService);
    const enforce = (amountMinor: string) =>
      dataSource.transaction('SERIALIZABLE', async (manager) =>
        limits.enforceWithManager(manager, {
          principalType: 'CUSTOMER',
          principalId: customerId,
          product: PRODUCT,
          currency: CURRENCY,
          direction: 'OUTGOING',
          amountMinor,
          idempotencyKey: randomUUID(),
          // `idempotency_records.chk_idempotency_records_hash` requires a sha256-shaped hash.
          requestHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          correlationId: 'pr27-browser-walkthrough',
          now: new Date(),
        }),
      );
    const within = await enforce('50000');
    let refusal: any = null;
    try {
      await enforce('150000');
    } catch (error: any) {
      refusal = error?.getResponse?.() ?? { message: error?.message, status: error?.status };
    }
    const runtimeRuleIds = (within.ruleRefs ?? []).map((rule) => rule.ruleId);
    report.limit.runtime = {
      within: {
        allowed: within.allowed,
        limitProfileCode: within.limitProfileCode,
        evaluatedDimensions: within.evaluatedDimensions,
        ruleIds: runtimeRuleIds,
      },
      overLimitRefusal: refusal,
    };
    check('runtime admits an amount inside the authored threshold', within.allowed === true, {
      allowed: within.allowed,
      profile: within.limitProfileCode,
    });
    check(
      'runtime refuses an amount above the authored threshold',
      refusal !== null &&
        /LIMIT_DAILY_AMOUNT_EXCEEDED|LIMIT_MAX|exceeds/i.test(JSON.stringify(refusal)),
      refusal,
    );
    check('runtime evaluated the rule the browser applied', runtimeRuleIds.includes(limitRuleId), {
      runtimeRuleIds,
      appliedRuleId: limitRuleId,
    });
    report.limit.previewEqualsRuntime = runtimeRuleIds.includes(limitRuleId);
    await shot(checkerPage, '16-limit-runtime-compared');
    await maker.context.close();
  }, 900_000);
});
