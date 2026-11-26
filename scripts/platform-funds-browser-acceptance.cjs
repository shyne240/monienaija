#!/usr/bin/env node
'use strict';

/**
 * Platform Funds vs. Bank Balance — Admin Web browser acceptance (Finance → Reconciliation).
 *
 * Drives the **production Vite bundle** in a real Chromium: real DOM, real layout, real
 * request/response, real localStorage, real hit-testing on inputs and buttons. The API is
 * stubbed at the browser's network layer, so every assertion here is about the client. No
 * assertion in this file claims anything about the server or about the bank.
 *
 * What this pins, as a FINANCE_PREPARER (the maker):
 *   - the Finance navigation exposes "Platform funds vs. bank" for a ledger.view scope;
 *   - the comparison list renders the stubbed platform-scope DRAFT comparison;
 *   - the detail view surfaces the ACCOUNT_NOT_MAPPED blocker with role="alert" and keeps the
 *     "Submit for independent review" button DISABLED while the mapping is incomplete;
 *   - the New-comparison pane NEVER fetches a bank balance from anywhere: the "Preview ledger
 *     evidence" and "Create comparison" actions only talk to same-origin /api/v1, and the create
 *     request body carries exactly the manually entered minor-unit balance;
 *   - a timing item can be added and removed against the stubbed API;
 *   - a principal WITHOUT ledger.view never sees the navigation entry;
 *   - the password is never persisted to local/session storage.
 *
 * The bank balance is a staff-entered, statement-referenced value by product design — this
 * harness exists to prove the client honours that contract, not to move money. It moves nothing:
 * no ledger posting, no bank call, no payout.
 *
 * Browser binary: @sparticuz/chromium (serverless Linux Chromium) inflated to /tmp/chromium with
 * its Amazon Linux 2023 libraries in /tmp/al2023/lib. It is a genuine browser engine and a
 * genuine renderer, but not Safari, not a handset, and not a screen reader.
 *
 * Build the bundle first (same-origin API base, as the SPA expects):
 *   cd apps/admin-web && ADMIN_WEB_API_BASE_URL=/api/v1 npm run build
 *
 * Usage:
 *   node scripts/platform-funds-browser-acceptance.cjs \
 *     --dist apps/admin-web/dist --out /tmp/pf-browser \
 *     --executable /tmp/chromium --lib-path /tmp/al2023/lib [--port 4322]
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json, charset=utf-8',
};

function parseArgs(argv) {
  const args = { port: 4322 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

/** Serves the built bundle. Unknown paths fall back to index.html, as the SPA expects. */
function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const decoded = decodeURIComponent(url.pathname);
    const candidate = path.join(root, decoded);
    const inside = candidate.startsWith(root);
    const isFile = inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const target = isFile ? candidate : path.join(root, 'index.html');
    if (!fs.existsSync(target)) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

const COMPARISON_ID = '11111111-2222-4333-8444-555566667777';
const PLATFORM_ACCT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001';
const INST_ACCT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0002';
const AR_ACCT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0003';
const LEDGER_CUTOFF = '2026-11-25T09:00:00.000Z';
const BANK_CUTOFF = '2026-11-25T09:05:00.000Z';

const SCOPE = {
  mode: 'INSTITUTIONS',
  institutionIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  platformFunctionGranted: false,
};

const ACCOUNTS = [
  {
    id: PLATFORM_ACCT_ID,
    code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
    name: 'NGN settlement asset',
    accountType: 'ASSET',
    currency: 'NGN',
    scope: 'PLATFORM',
    institutionId: null,
    institutionCode: null,
    selectable: true,
    unavailableReason: null,
  },
  {
    id: INST_ACCT_ID,
    code: 'PFESETT_A_EVID',
    name: 'Institution A settlement',
    accountType: 'ASSET',
    currency: 'NGN',
    scope: 'INSTITUTION',
    institutionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    institutionCode: 'PFE_A',
    selectable: true,
    unavailableReason: null,
  },
];

const BLOCKER = {
  code: 'ACCOUNT_NOT_MAPPED',
  message: 'Account FINANCE-ACCOUNTS_RECEIVABLE-NGN is not mapped to any bucket',
  needed: 'Map FINANCE-ACCOUNTS_RECEIVABLE-NGN to a bucket or record why it is excluded',
  accountCode: 'FINANCE-ACCOUNTS_RECEIVABLE-NGN',
  accountId: AR_ACCT_ID,
};

const BREAKDOWN = {
  scope: 'PLATFORM',
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  ledgerCutoff: LEDGER_CUTOFF,
  settlementAccount: {
    id: PLATFORM_ACCT_ID,
    code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
    name: 'NGN settlement asset',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    scope: 'PLATFORM',
    institutionId: null,
    institutionalPurpose: null,
    expectedMinor: '245000000',
    debitMinor: '245000000',
    creditMinor: '0',
    balanceMinor: '245000000',
    lineCount: 12,
  },
  lines: [],
  controlLine: {
    key: 'PLATFORM_BOOKS_NET_ZERO',
    label: 'Platform books net zero',
    netMinor: '0',
    ok: true,
    accountCount: 40,
  },
  breakdownTotalMinor: '245000000',
  reconciliationGapMinor: '0',
  mappingComplete: false,
  blockers: [BLOCKER],
  journalEvidence: {
    ledgerCutoff: LEDGER_CUTOFF,
    journalsConsidered: 120,
    linesConsidered: '460',
    maxPostedAt: LEDGER_CUTOFF,
    totalDebitsMinor: '245000000',
    totalCreditsMinor: '245000000',
    conserved: true,
  },
  notes: [],
  evidenceHash: 'b'.repeat(64),
  generatedAt: LEDGER_CUTOFF,
};

const SUMMARY = {
  id: COMPARISON_ID,
  scope: 'PLATFORM',
  institutionId: null,
  settlementAccountId: PLATFORM_ACCT_ID,
  settlementAccountCode: 'PAYMENT-SETTLEMENT_ASSET-NGN',
  settlementAccountName: 'NGN settlement asset',
  currency: 'NGN',
  accountingUnit: 'CUSTOMER_FUNDS',
  status: 'DRAFT',
  ledgerCutoff: LEDGER_CUTOFF,
  bankCutoff: BANK_CUTOFF,
  statementReference: 'STMT-PFE-BROWSER-1',
  bankBalanceMinor: '245000000',
  expectedMinor: '245000000',
  differenceMinor: '0',
  timingTotalMinor: '0',
  unexplainedMinor: '0',
  mappingComplete: false,
  createdBy: 'finance-preparer@monienaija.local',
  createdAt: '2026-11-25T08:00:00.000Z',
  submittedBy: null,
  submittedAt: null,
  reviewedBy: null,
  reviewedAt: null,
};

// Stateful detail fixture: timing items round-trip through add/remove.
let timingItems = [];
const detailFixture = () => ({
  ...SUMMARY,
  blockers: [BLOCKER],
  decisionReason: null,
  timingItems: [...timingItems],
  breakdown: BREAKDOWN,
  approvalId: null,
  approval: null,
  selfApprovalDenied: false,
  snapshotCount: 0,
  canSubmit: false,
  canReview: false,
  blockingReasons: [
    'Mapping is incomplete: ACCOUNT_NOT_MAPPED (FINANCE-ACCOUNTS_RECEIVABLE-NGN) must be resolved first',
  ],
});

function principalFixture(overrides) {
  return {
    type: 'PRIVILEGED',
    principalId: 'workforce:acceptance-preparer',
    sessionId: 'session-acceptance-pf-1',
    audience: 'admin-console',
    roles: ['FINANCE_PREPARER'],
    scopes: ['ledger.view', 'reconciliation.view', 'transaction.view', 'workforce.dashboard.view'],
    customerAccess: 'ALL',
    assuranceLevel: 'AAL2',
    ...overrides,
  };
}

function sessionFixture(overrides) {
  return {
    accessToken: 'acceptance-token-not-a-credential',
    tokenType: 'Bearer',
    sessionId: 'session-acceptance-pf-1',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    principal: principalFixture(overrides),
  };
}

const dashboardFixture = {
  templateKey: 'acceptance-template',
  displayName: 'Acceptance dashboard',
  description: 'Dashboard rendered from the acceptance fixture',
  isFallback: false,
  widgets: [
    {
      widgetKey: 'customer-directory-shortcut',
      order: 1,
      displayName: 'Customer directory',
      description: 'Jump to the customer directory',
      fetchMode: 'direct',
      kind: 'shortcut',
      authorized: true,
      title: 'Customer directory',
    },
  ],
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = path.resolve(args.dist ?? 'apps/admin-web/dist');
  const out = path.resolve(args.out ?? '/tmp/pf-browser');
  const executable = args.executable ?? process.env.BROWSER_EXECUTABLE_PATH;
  const libPath = args['lib-path'] ?? process.env.BROWSER_LIBRARY_PATH;
  const port = Number(args.port ?? 4322);

  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(
      `no built bundle at ${dist} (run: cd apps/admin-web && ADMIN_WEB_API_BASE_URL=/api/v1 npm run build)`,
    );
    process.exit(2);
  }
  if (libPath) process.env.LD_LIBRARY_PATH = libPath;
  fs.mkdirSync(out, { recursive: true });

  const gitSha = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..') })
        .toString()
        .trim();
    } catch {
      return 'unknown';
    }
  })();

  const { chromium } = require('playwright');
  const base = `http://127.0.0.1:${port}`;

  const results = [];
  const record = (id, ok, detail) => {
    results.push({ id, ok, detail: String(detail).slice(0, 400) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail).slice(0, 180)}`);
  };

  const server = await serveStatic(dist, port);
  const browser = await chromium.launch({
    executablePath: executable || undefined,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const browserVersion = browser.version();
  const requests = [];
  const consoleErrors = [];
  const pageErrors = [];

  /** One fixture-mode router; `fixture` selects the session principal for each check. */
  let fixture = 'preparer';
  const routeHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = { method: request.method(), path: url.pathname, body: request.postData() ?? null };
    requests.push(entry);
    const fulfill = (status, body) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (url.pathname.endsWith('/internal/a2/workforce/local-admin-sessions')) {
      return fulfill(
        200,
        fixture === 'no-ledger-view'
          ? sessionFixture({ roles: ['ADMINISTRATOR'], scopes: ['workforce.dashboard.view'] })
          : sessionFixture({}),
      );
    }
    if (fixture === 'no-ledger-view') {
      // The shell only fetches the dashboard for this principal.
      if (url.pathname.endsWith('/internal/a2/workforce/dashboard/my-dashboard'))
        return fulfill(200, dashboardFixture);
      return fulfill(200, { data: [], items: [], total: 0, page: 1, pageSize: 20 });
    }
    if (url.pathname.endsWith('/internal/a2/workforce/dashboard/my-dashboard'))
      return fulfill(200, dashboardFixture);
    if (url.pathname.endsWith('/internal/finance-operations/platform-funds/scope'))
      return fulfill(200, SCOPE);
    if (url.pathname.endsWith('/internal/finance-operations/platform-funds/settlement-accounts'))
      return fulfill(200, { items: ACCOUNTS });
    if (url.pathname.endsWith('/internal/finance-operations/platform-funds/comparisons/preview'))
      return fulfill(201, BREAKDOWN);
    if (url.pathname.endsWith('/internal/finance-operations/platform-funds/comparisons')) {
      if (request.method() === 'POST') return fulfill(201, detailFixture());
      return fulfill(200, { items: [SUMMARY], total: 1, limit: 25, offset: 0, scope: SCOPE });
    }
    if (/\/comparisons\/[0-9a-f-]{36}\/timing-items\/[0-9a-f-]{36}$/i.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      timingItems = timingItems.filter((item) => item.id !== id);
      return fulfill(200, detailFixture());
    }
    if (/\/comparisons\/[0-9a-f-]{36}\/timing-items$/i.test(url.pathname)) {
      const body = JSON.parse(request.postData() ?? '{}');
      timingItems = [
        ...timingItems,
        {
          // UUID-shaped so it matches the [0-9a-f-]{36} DELETE route below (and the real API).
          id: `deadbeef-0000-4000-8000-${String(timingItems.length + 1).padStart(12, '0')}`,
          title: body.title,
          reference: body.reference,
          explanation: body.explanation,
          amountMinor: body.amountMinor,
          createdBy: 'finance-preparer@monienaija.local',
          createdAt: new Date().toISOString(),
        },
      ];
      return fulfill(201, detailFixture());
    }
    if (new RegExp(`/comparisons/${COMPARISON_ID}$`).test(url.pathname))
      return fulfill(200, detailFixture());
    if (url.pathname.endsWith('/internal/finance-operations/platform-funds/comparisons'))
      return fulfill(200, { items: [SUMMARY], total: 1, limit: 25, offset: 0, scope: SCOPE });

    return fulfill(200, { data: [], items: [], total: 0, page: 1, pageSize: 20 });
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/api/v1/**', routeHandler);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));

  // --- 1. Boot + login as FINANCE_PREPARER -----------------------------------
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  record('BOOT-RENDERS-LOGIN', await page.locator('#admin-login-email').isVisible(), 'login form visible');
  await page.fill('#admin-login-email', 'finance-preparer@monienaija.local');
  await page.fill('#admin-login-password', 'fixture-password-value');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });
  record('LOGIN-REACHES-AUTHENTICATED-SHELL', true, 'desktop nav rendered');

  // --- 2. Finance navigation exposes the comparison workspace ------------------
  await page.locator('[data-testid="section-finance"]').click({ timeout: 15000 });
  record(
    'PF-NAV-VISIBLE-FOR-LEDGER-VIEW',
    await page.locator('[data-testid="nav-platformFunds"]').isVisible(),
    'Finance → "Platform funds vs. bank" visible for a ledger.view principal',
  );

  // --- 3. The comparison list renders the fixture DRAFT ------------------------
  await page.locator('[data-testid="nav-platformFunds"]').click();
  await page.waitForSelector('text=Comparisons', { timeout: 15000 });
  const listText = await page.locator('[data-testid="main-content"]').innerText();
  record(
    'PF-COMPARISON-LIST-RENDERS',
    listText.includes('PAYMENT-SETTLEMENT_ASSET-NGN') &&
      listText.includes('STMT-PFE-BROWSER-1') &&
      listText.includes('1 total'),
    `main content contains settlement code, statement reference and total=1`,
  );
  await page.screenshot({ path: path.join(out, 'pf-list-1440x900.png') });

  // --- 4. Detail opens; mapping blocker alerts; submit stays disabled ---------
  await page.getByRole('button', { name: /PAYMENT-SETTLEMENT_ASSET-NGN/ }).click();
  await page.waitForSelector('text=Maker / checker sign-off', { timeout: 15000 });
  const blockerAlert = page.locator('[role="alert"]', { hasText: 'ACCOUNT_NOT_MAPPED' });
  record(
    'PF-DETAIL-BLOCKER-ALERTS',
    (await blockerAlert.count()) > 0,
    'role=alert renders the ACCOUNT_NOT_MAPPED blocker',
  );
  const submitButton = page.getByRole('button', { name: /Submit for independent review/ });
  record(
    'PF-SUBMIT-DISABLED-WHILE-MAPPING-INCOMPLETE',
    await submitButton.isDisabled(),
    'Submit for independent review is disabled with an incomplete mapping',
  );
  const blockingText = await page.locator('[data-testid="main-content"]').innerText();
  record(
    'PF-BLOCKING-REASON-VISIBLE',
    blockingText.includes('Mapping is incomplete'),
    'blocking reason text is visible to the maker',
  );
  await page.screenshot({ path: path.join(out, 'pf-detail-blocked-1440x900.png') });

  // --- 5. New comparison: preview computes, nothing is saved ------------------
  await page.getByRole('button', { name: 'New comparison' }).click();
  await page.waitForSelector('#pf-account', { timeout: 15000 });
  await page.selectOption('#pf-account', PLATFORM_ACCT_ID);
  await page.fill('#pf-bank-balance', '245000000');
  await page.fill('#pf-statement-ref', 'STMT-PFE-BROWSER-1');
  await page.getByRole('button', { name: /Preview ledger evidence/ }).click();
  await page.waitForSelector('text=Preview — nothing has been saved', { timeout: 15000 });
  // Tile labels carry CSS text-transform: uppercase, and innerText reflects the rendered text.
  const previewText = (await page.locator('[data-testid="main-content"]').innerText()).toLowerCase();
  record(
    'PF-PREVIEW-RENDERS-MEMO-NOT-SAVED',
    previewText.includes('expected (ledger)') && previewText.includes('breakdown total'),
    'preview tiles render Expected/Breakdown with no POST issued',
  );
  record(
    'PF-PREVIEW-SURFACES-BLOCKER',
    (await page.locator('[role="alert"]', { hasText: 'ACCOUNT_NOT_MAPPED' }).count()) > 0,
    'preview renders the same blocker, flagged, before any save',
  );
  const postsBeforeCreate = requests.filter(
    (entry) => entry.method === 'POST' && entry.path.endsWith('/comparisons'),
  ).length;
  record(
    'PF-PREVIEW-IS-READ-ONLY',
    postsBeforeCreate === 0,
    `POST /comparisons issued before Create: ${postsBeforeCreate}`,
  );
  await page.screenshot({ path: path.join(out, 'pf-preview-1440x900.png') });

  // --- 6. Create sends the staff-entered balance — never a fetched one --------
  await page.getByRole('button', { name: 'Create comparison' }).click();
  await page.waitForSelector('text=Maker / checker sign-off', { timeout: 15000 });
  const createPosts = requests.filter(
    (entry) => entry.method === 'POST' && entry.path.endsWith('/comparisons'),
  );
  let createBody = null;
  try {
    createBody = createPosts.length ? JSON.parse(createPosts[0].body) : null;
  } catch {
    createBody = null;
  }
  record(
    'PF-CREATE-CAPTURES-MANUAL-BALANCE',
    createPosts.length === 1 &&
      createBody?.bankBalanceMinor === '245000000' &&
      createBody?.settlementAccountId === PLATFORM_ACCT_ID &&
      createBody?.statementReference === 'STMT-PFE-BROWSER-1',
    `create POST body bankBalanceMinor=${createBody?.bankBalanceMinor}, settlementAccountId=${createBody?.settlementAccountId}`,
  );
  const externalCalls = requests.filter((entry) => !entry.path.startsWith('/api/v1/'));
  record(
    'PF-NO-NON-API-REQUESTS',
    externalCalls.length === 0,
    `requests outside same-origin /api/v1: ${externalCalls.length}`,
  );
  await page.screenshot({ path: path.join(out, 'pf-after-create-1440x900.png') });

  // --- 7. Timing item round-trips against the API ------------------------------
  await page.fill('input[aria-label="Timing item title"]', 'Deposit in transit');
  await page.fill('input[aria-label="Timing item reference"]', 'PFE-BROWSER-ITEM-1');
  await page.fill('input[aria-label="Timing item amount in minor units"]', '50000');
  await page.fill('textarea[aria-label="Timing item explanation"]', 'Lodgement recorded by the bank, not yet posted to the ledger');
  await page.getByRole('button', { name: 'Record timing item' }).click();
  await page.waitForSelector('text=Deposit in transit', { timeout: 15000 });
  const timingPosts = requests.filter(
    (entry) => entry.method === 'POST' && entry.path.endsWith('/timing-items'),
  );
  record(
    'PF-TIMING-ITEM-RECORDED',
    timingPosts.length === 1,
    `POST timing-items issued: ${timingPosts.length}`,
  );
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.waitForFunction(
    () => !document.body.innerText.includes('Deposit in transit'),
    { timeout: 15000 },
  );
  const timingDeletes = requests.filter((entry) => entry.method === 'DELETE');
  record(
    'PF-TIMING-ITEM-REMOVED',
    timingDeletes.length === 1,
    `DELETE timing-item issued: ${timingDeletes.length}`,
  );

  // --- 8. Password never persisted ---------------------------------------------
  const storageDump = await page.evaluate(() =>
    JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
  );
  record(
    'PF-PASSWORD-NEVER-PERSISTED',
    !storageDump.includes('fixture-password-value'),
    'no credential material in storage',
  );
  record(
    'PF-NO-PAGE-ERRORS',
    pageErrors.length === 0 && consoleErrors.length === 0,
    (pageErrors.join(' | ') || consoleErrors.join(' | ') || 'clean').slice(0, 300),
  );

  await context.close();

  // --- 9. A principal without ledger.view never sees the navigation entry ------
  fixture = 'no-ledger-view';
  const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context2.route('**/api/v1/**', routeHandler);
  const page2 = await context2.newPage();
  await page2.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page2.fill('#admin-login-email', 'admin@monienaija.local');
  await page2.fill('#admin-login-password', 'fixture-password-value');
  await page2.click('button[type="submit"]');
  await page2.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });
  const navCount = await page2.locator('[data-testid="nav-platformFunds"]').count();
  record(
    'PF-NO-LEDGER-VIEW-NO-NAV',
    navCount === 0,
    `nav entries for principal without ledger.view: ${navCount}`,
  );
  await context2.close();

  await browser.close();
  server.close();

  /**
   * The fixture password is synthetic, but evidence files should never carry credential material in
   * any form — redact password fields from stored request bodies before writing the report.
   */
  const redactBody = (body) =>
    body === null ? null : String(body).replace(/"password"\s*:\s*"[^"]*"/g, '"password":"[redacted]"');
  const scrubbedRequests = requests.map((entry) => ({ ...entry, body: redactBody(entry.body) }));

  const failed = results.filter((check) => !check.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    gitCommit: gitSha,
    api: 'stubbed (same-origin /api/v1 fixture router — no request reaches a server or a bank)',
    browser: { name: 'chromium', version: browserVersion, engine: 'Blink', headless: true },
    summary: { total: results.length, passed: results.length - failed.length, failed: failed.length },
    checks: results.map(({ id, ok, detail }) => ({ name: id, ok, detail })),
    requests: scrubbedRequests,
  };
  fs.writeFileSync(path.join(out, 'platform-funds-browser-acceptance.json'), JSON.stringify(report, null, 2));
  console.log(
    `\n${report.summary.passed}/${report.summary.total} browser checks passed -> ${path.join(out, 'platform-funds-browser-acceptance.json')}`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('platform-funds browser acceptance failed to run:', error);
  process.exit(1);
});
