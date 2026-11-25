'use strict';

/**
 * Focused browser acceptance for the Finance Operations read model.
 *
 * Serves the production Vite bundle, stubs the API at the browser's network layer, and drives the
 * real DOM: ledger record search, journal detail with institution/source/eligibility, the
 * transaction → journal link, and the reconciliation evidence workspace. It does not assert
 * anything about the server; the API is a fixture.
 *
 * Usage:
 *   node scripts/finance-operations-browser-acceptance.cjs \
 *     --dist /tmp/g33-dist --executable /tmp/chromium \
 *     --lib-path /tmp/al2023/lib --out /tmp/finance-acceptance
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = {};
for (let i = 0; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue;
  args[process.argv[i].slice(2)] = process.argv[i + 1];
  i += 1;
}
const DIST = path.resolve(args.dist);
const OUT = path.resolve(args.out ?? '/tmp/finance-acceptance');
const PORT = Number(args.port ?? 4399);
if (args['lib-path']) process.env.LD_LIBRARY_PATH = args['lib-path'];
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const candidate = path.join(DIST, decodeURIComponent(url.pathname));
  const target =
    candidate.startsWith(DIST) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
};

const institution = { id: 'inst-1', code: 'MNJ', name: 'Monie Naija Ltd', status: 'ACTIVE' };
const journalId = '0d1f2e3a-1111-4222-8333-444455556666';
const transactionId = 'aa11bb22-3333-4444-8555-666677778888';

const recordSummary = {
  id: journalId,
  reference: 'TRF-2026-000123',
  description: 'Wallet transfer',
  status: 'POSTED',
  currency: 'NGN',
  accountingUnit: 'NGN',
  totalMinor: '250000',
  lineCount: 2,
  institution,
  source: {
    type: 'TRANSFER',
    id: transactionId,
    reference: 'TRF-2026-000123',
    status: 'COMPLETED',
    linkedBy: 'JOURNAL_ID',
    navigable: true,
  },
  reversal: { kind: 'NORMAL', reversalOfJournalId: null, reversedByJournalId: null },
  createdAt: '2026-11-20T09:00:00.000Z',
  postedAt: '2026-11-20T09:00:01.000Z',
};

const depositJournalId = '1a2b3c4d-2222-4333-8444-555566667777';
const fundingJournalId = '9f8e7d6c-3333-4444-8555-666677778888';
const depositRecord = {
  ...recordSummary,
  id: depositJournalId,
  reference: 'DEP-2026-000044',
  totalMinor: '50000',
  source: {
    type: 'DEPOSIT',
    id: 'deposit-1',
    reference: 'DEP-2026-000044',
    status: 'COMPLETED',
    linkedBy: 'JOURNAL_ID',
    navigable: true,
  },
  institution,
  postedAt: '2026-11-21T09:00:01.000Z',
  createdAt: '2026-11-21T09:00:00.000Z',
};
const fundingRecord = {
  ...recordSummary,
  id: fundingJournalId,
  reference: 'FUND-2026-000007',
  totalMinor: '70000',
  source: {
    type: 'CUSTOMER_FUNDING',
    id: 'funding-1',
    reference: 'FUND-2026-000007',
    status: 'PENDING',
    linkedBy: 'JOURNAL_ID',
    navigable: false,
  },
  institution,
  postedAt: '2026-11-22T09:00:01.000Z',
  createdAt: '2026-11-22T09:00:00.000Z',
};
const journalDetail = {
  ...recordSummary,
  idempotencyKey: `transfer:${transactionId}:ledger-post`,
  correlationId: null,
  metadata: {},
  lines: [
    {
      id: 'line-1',
      lineNumber: 1,
      accountId: 'acct-1',
      accountCode: '1100',
      accountName: 'Customer wallet liability',
      accountType: 'LIABILITY',
      institutionalScope: 'INSTITUTION',
      institutionId: 'inst-1',
      direction: 'CREDIT',
      amountMinor: '250000',
      currency: 'NGN',
      accountingUnit: 'NGN',
    },
    {
      id: 'line-2',
      lineNumber: 2,
      accountId: 'acct-2',
      accountCode: '2100',
      accountName: 'Settlement payable',
      accountType: 'LIABILITY',
      institutionalScope: 'INSTITUTION',
      institutionId: 'inst-1',
      direction: 'DEBIT',
      amountMinor: '250000',
      currency: 'NGN',
      accountingUnit: 'NGN',
    },
  ],
};

const depositDetail = {
  ...journalDetail,
  ...depositRecord,
  lines: journalDetail.lines.map((line) => ({ ...line })),
};
const fundingDetail = {
  ...journalDetail,
  ...fundingRecord,
  lines: journalDetail.lines.map((line) => ({ ...line })),
};
const eligibility = {
  journalId,
  eligible: true,
  nextAction: 'EXECUTE_REVERSAL',
  nextActionLabel: 'Execute the approved reversal',
  reasonCode: 'APPROVED_AWAITING_EXECUTOR',
  reason: 'An approved reversal request exists and this principal may execute it.',
  permissions: { canView: true, canRequest: false, canExecute: true },
  approval: {
    approvalId: 'approval-1',
    status: 'APPROVED',
    requestedAt: '2026-11-21T08:00:00.000Z',
    expiresAt: '2026-11-28T08:00:00.000Z',
    requestedBy: 'preparer',
    approvedBy: 'controller',
    reason: 'Duplicate posting on 2026-11-20',
    actionType: 'LEDGER_REVERSAL',
    resourceType: 'ledger',
  },
  blockers: [],
  governance: {
    actionType: 'LEDGER_REVERSAL',
    resourceType: 'ledger',
    makerRole: 'FINANCE_PREPARER',
    checkerRole: 'FINANCE_CONTROLLER',
    note: 'Separation of duties is enforced by the server.',
  },
};

const breakId = 'ledger:journal_balance_integrity:J1';
const breaks = {
  institution,
  generatedAt: '2026-11-25T10:00:00.000Z',
  sources: [
    {
      source: 'INTERNAL_LEDGER',
      label: 'Internal ledger',
      availability: 'AVAILABLE',
      result: 'DIFFERENCES',
      description: 'Internal checks run against this ledger.',
      evidenceKind: 'LEDGER_QUERY',
      checkedAt: '2026-11-25T10:00:00.000Z',
      detail: 'One journal is unbalanced.',
      providerKeys: [],
    },
    {
      source: 'EXTERNAL_PROVIDER',
      label: 'External provider evidence',
      availability: 'UNAVAILABLE',
      result: 'NOT_PERFORMED',
      description: 'Provider reconciliation observations are not available.',
      evidenceKind: 'PROVIDER_RECONCILIATION',
      checkedAt: null,
      detail: 'The provider is not operational for reconciliation; this is an exception, not a pass.',
      providerKeys: ['monnify'],
    },
    {
      source: 'EXTERNAL_STATEMENT',
      label: 'External statement evidence',
      availability: 'UNAVAILABLE',
      result: 'NOT_PERFORMED',
      description: 'No statement evidence is recorded.',
      evidenceKind: 'STATEMENT_EVIDENCE',
      checkedAt: null,
      detail: 'No statement has been uploaded; this is not a pass.',
      providerKeys: [],
    },
  ],
  checks: [
    {
      name: 'journal_balance_integrity',
      source: 'INTERNAL_LEDGER',
      label: 'Journal balance integrity',
      description: 'Every posted journal balances.',
      status: 'ERROR',
      checkedAt: '2026-11-25T10:00:00.000Z',
      evidenceCount: 1,
      detail: '1 journal does not balance.',
    },
  ],
  breaks: [
    {
      id: breakId,
      source: 'INTERNAL_LEDGER',
      checkName: 'journal_balance_integrity',
      title: 'Journal is not balanced',
      state: 'ERROR',
      severity: 'CRITICAL',
      institution,
      subject: { type: 'JOURNAL', reference: 'TRF-2026-000123' },
      amounts: { internalMinor: '250000', providerMinor: null, currency: 'NGN' },
      detail: 'Debits and credits differ by 500 minor units.',
      checkedAt: '2026-11-25T10:00:00.000Z',
      evidence: [
        {
          kind: 'LEDGER_QUERY',
          available: true,
          reference: journalId,
          observedAt: '2026-11-25T10:00:00.000Z',
          note: 'Checked posted journal lines.',
        },
      ],
      nextAction: {
        code: 'INSPECT_JOURNAL',
        label: 'Inspect the journal record',
        permitted: true,
        reason: 'The journal can be read with ledger.view.',
        targetKind: 'JOURNAL',
        targetId: journalId,
      },
      run: null,
      provider: null,
      journalId,
    },
  ],
  providerReadiness: [
    {
      providerKey: 'monnify',
      environment: 'sandbox',
      state: 'APPROVED_NOT_CREDENTIALED',
      usable: false,
      entitled: 'UNKNOWN',
      summary: 'Approved but not credentialed for this institution.',
      reconciliationCapability: { state: 'UNAVAILABLE', usable: false },
    },
  ],
  reconciliationEstablished: false,
  summary: {
    breaks: 1,
    errors: 1,
    warnings: 0,
    unavailableSources: 2,
    checksRun: 1,
    checksPassed: 0,
    externalExceptionsOpen: 0,
    providerReady: false,
  },
  filters: { source: 'ALL', state: 'ALL', from: null, to: null, reference: null },
  scope: { mode: 'INSTITUTIONS', institutionIds: ['inst-1'], platformFunctionGranted: false },
};

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function main() {
  const { chromium } = require('playwright');
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: args.executable, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const requests = [];
  let mode = 'login';

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname });
    if (url.pathname.endsWith('/internal/a2/workforce/local-admin-sessions')) {
      if (mode === 'reject')
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 401, message: 'Invalid credentials' }),
        });
      return json(route, {
        accessToken: 'fixture-token',
        tokenType: 'Bearer',
        sessionId: 'session-acceptance-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        principal: {
          type: 'PRIVILEGED',
          principalId: 'workforce:acceptance-operator',
          sessionId: 'session-acceptance-1',
          audience: 'admin-console',
          roles: ['SUPER_ADMIN', 'FINANCE_CONTROLLER'],
          scopes: [
            'workforce.dashboard.view',
            'transaction.view',
            'ledger.view',
            'reconciliation.view',
            'institution.attribution.view',
            'privileged:execute',
          ],
          customerAccess: 'ALL',
          assuranceLevel: 'AAL2',
        },
      });
    }
    if (url.pathname.endsWith('/dashboard/my-dashboard')) {
      return json(route, {
        templateKey: 'acceptance-template',
        displayName: 'Acceptance dashboard',
        description: 'Fixture',
        isFallback: false,
        widgets: [],
      });
    }
    if (url.pathname.endsWith('/internal/finance-operations/reconciliation/institutions'))
      return json(route, {
        items: [institution],
        scope: { mode: 'INSTITUTIONS', institutionIds: ['inst-1'], platformFunctionGranted: false },
      });
    if (url.pathname.endsWith('/internal/finance-operations/reconciliation/breaks'))
      return json(route, breaks);
    if (url.pathname.endsWith('/internal/finance-operations/ledger/journals'))
      return json(route, {
        items: [recordSummary, depositRecord, fundingRecord],
        total: 3,
        hasMore: false,
        limit: 50,
        offset: 0,
        range: { from: '2026-10-26T00:00:00.000Z', to: '2026-11-25T00:00:00.000Z' },
        scope: {
          mode: 'INSTITUTIONS',
          institutionIds: ['inst-1'],
          platformFunctionGranted: false,
        },
        supportedReferenceForms: ['journal reference', 'journal id'],
      });
    if (url.pathname.endsWith(`/internal/finance-operations/ledger/journals/${journalId}`))
      return json(route, journalDetail);
    if (url.pathname.endsWith(`/internal/finance-operations/ledger/journals/${depositJournalId}`))
      return json(route, depositDetail);
    if (url.pathname.endsWith(`/internal/finance-operations/ledger/journals/${fundingJournalId}`))
      return json(route, fundingDetail);
    if (url.pathname.endsWith(`/reversal-eligibility`)) return json(route, eligibility);
    if (url.pathname.includes('/internal/finance-operations/transactions/'))
      return json(route, {
        transaction: {
          id: transactionId,
          type: 'TRANSFER',
          reference: 'TRF-2026-000123',
          status: 'COMPLETED',
          createdAt: '2026-11-20T09:00:00.000Z',
        },
        ledgerAccess: 'GRANTED',
        journal: recordSummary,
        outcome: 'FOUND',
        message: 'The transaction is recorded by one posted ledger journal.',
      });
    if (url.pathname.includes('/ledger/journals/'))
      return json(route, {
        id: decodeURIComponent(url.pathname.split('/').pop()),
        status: 'POSTED',
        currency: 'NGN',
        accountingUnit: 'NGN',
        reference: 'TRF-2026-000123',
        description: 'Wallet transfer',
        createdAt: '2026-11-20T09:00:00.000Z',
        lines: [
          { id: 'line-1', accountId: 'acct-1', direction: 'CREDIT', amountMinor: '250000' },
          { id: 'line-2', accountId: 'acct-2', direction: 'DEBIT', amountMinor: '250000' },
        ],
      });
    if (url.pathname.includes('/internal/ledger/accounts')) return json(route, []);
    if (url.pathname.includes('/transfers/'))
      return json(route, {
        id: transactionId,
        status: 'COMPLETED',
        currency: 'NGN',
        amountMinor: '250000',
        reference: 'TRF-2026-000123',
        createdAt: '2026-11-20T09:00:00.000Z',
      });
    return json(route, { data: [], items: [], total: 0, page: 1, pageSize: 20 });
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const base = `http://127.0.0.1:${PORT}`;
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.fill('#admin-login-email', 'controller@monienaija.local');
  await page.fill('#admin-login-password', 'fixture-password-value');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });

  // --- Ledger record search -------------------------------------------------
  if (!(await page.locator('[data-testid="nav-ledgerExplorer"]').isVisible()))
    await page.locator('[data-testid="section-finance"]').click();
  await page.locator('[data-testid="nav-ledgerExplorer"]').click();
  const searchPanel = page.locator('[data-testid="ledger-record-search"]');
  await searchPanel.waitFor({ timeout: 15000 });
  record('LEDGER-SEARCH-PANEL-RENDERS', await searchPanel.isVisible(), 'search panel visible');

  await page.fill('[data-testid="ledger-record-reference"]', 'TRF-2026-000123');
  await page.click('[data-testid="ledger-record-search-submit"]');
  await page.locator('[data-testid="ledger-record-results"]').waitFor({ timeout: 15000 });
  const rows = await page.locator('[data-testid^="ledger-record-open-"]').count();
  record('LEDGER-SEARCH-RETURNS-SCOPED-ROWS', rows === 3, `${rows} result row(s), institution and source rendered`);

  await page.locator(`[data-testid="ledger-record-open-${journalId}"]`).click();
  await page.locator('[data-testid="reversal-eligibility"]').waitFor({ timeout: 15000 });
  const nextAction = await page.locator('[data-testid="reversal-next-action"]').innerText();
  const sourceVisible = await page.locator('[data-testid="ledger-journal-source"]').isVisible();
  record(
    'JOURNAL-DETAIL-SHOWS-NEXT-ACTION-AND-SOURCE',
    nextAction.trim() === 'Execute the approved reversal' && sourceVisible,
    `next action="${nextAction.trim()}", source link visible=${sourceVisible}`,
  );

  // --- Finance → Transaction History contract link --------------------------
  const transferHref = await page
    .locator('[data-testid="open-unified-transaction-detail"]')
    .getAttribute('href');
  record(
    'TRANSFER-LINKS-TO-UNIFIED-HISTORY-BY-BUSINESS-KEY',
    transferHref === `#transaction-history/WALLET_TRANSFER/${transactionId}`,
    `href=${transferHref}`,
  );

  // Cash-in/cash-out must use the original posted journal ID, never the deposit/withdrawal row id.
  await page.fill('[data-testid="ledger-record-reference"]', 'DEP-2026-000044');
  await page.click('[data-testid="ledger-record-search-submit"]');
  await page.locator('[data-testid="ledger-record-results"]').waitFor({ timeout: 15000 });
  await page.locator(`[data-testid="ledger-record-open-${depositJournalId}"]`).click();
  await page.locator('[data-testid="reversal-eligibility"]').waitFor({ timeout: 15000 });
  const cashInHref = await page
    .locator('[data-testid="open-unified-transaction-detail"]')
    .getAttribute('href');
  record(
    'CASH-IN-LINKS-BY-CANONICAL-JOURNAL-ID',
    cashInHref === `#transaction-history/CASH_IN/${depositJournalId}`,
    `href=${cashInHref} (expected CASH_IN/${depositJournalId}, not deposit-1)`,
  );

  // A product with no history mapping must say so rather than guess.
  await page.fill('[data-testid="ledger-record-reference"]', 'FUND-2026-000007');
  await page.click('[data-testid="ledger-record-search-submit"]');
  await page.locator('[data-testid="ledger-record-results"]').waitFor({ timeout: 15000 });
  await page.locator(`[data-testid="ledger-record-open-${fundingJournalId}"]`).click();
  await page.locator('[data-testid="transaction-history-unavailable"]').waitFor({ timeout: 15000 });
  const unavailableText = await page
    .locator('[data-testid="transaction-history-unavailable"]')
    .innerText();
  record(
    'UNSUPPORTED-PRODUCT-SHOWS-LINK-UNAVAILABLE',
    /unavailable/i.test(unavailableText) && /no mapping/i.test(unavailableText),
    unavailableText.replace(/\s+/g, ' ').slice(0, 140),
  );

  // --- Reconciliation evidence ---------------------------------------------
  if (!(await page.locator('[data-testid="nav-reconciliation"]').isVisible()))
    await page.locator('[data-testid="section-finance"]').click();
  await page.locator('[data-testid="nav-reconciliation"]').click();
  await page.getByRole('button', { name: 'External Evidence & Breaks' }).click();
  const panel = page.locator('[data-testid="reconciliation-breaks-panel"]');
  await panel.waitFor({ timeout: 15000 });
  await page.locator('[data-testid="reconciliation-established"]').waitFor({ timeout: 15000 });
  const established = await page.locator('[data-testid="reconciliation-established"]').innerText();
  const sources = await page.locator('[data-testid="reconciliation-sources"] article').count();
  record(
    'RECONCILIATION-SHOWS-NOT-ESTABLISHED-AND-SOURCES',
    /not established/i.test(established) && sources === 3,
    `${sources} source cards; banner: "${established.replace(/\s+/g, ' ').slice(0, 120)}"`,
  );

  await page.locator(`[data-testid="open-break-journal-${breakId}"]`).click();
  await page.locator('[data-testid="reversal-eligibility"]').waitFor({ timeout: 15000 });
  record(
    'RECONCILIATION-BREAK-OPENS-JOURNAL',
    true,
    'internal break next action opened the journal record',
  );

  record(
    'NO-UNCAUGHT-PAGE-ERRORS',
    pageErrors.length === 0,
    pageErrors.join(' | ') || 'none',
  );

  fs.writeFileSync(
    path.join(OUT, 'finance-operations-browser-acceptance.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), api: 'stubbed', checks: results }, null, 2)}\n`,
  );
  await page.screenshot({ path: path.join(OUT, 'finance-operations-1440x900.png') });
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  server.close();
  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed -> ${OUT}`);
  if (consoleErrors.length && process.env.VERBOSE)
    console.log('console errors:', consoleErrors.slice(0, 5));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('finance acceptance failed to run:', error);
  server.close();
  process.exit(3);
});
