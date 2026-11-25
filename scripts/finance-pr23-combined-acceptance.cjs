'use strict';

/**
 * Temporary combined-build acceptance for PR #25 (Finance desk) + PR #23 (unified Transaction
 * History). Serves the production Vite bundle built from a throwaway `git merge` commit and drives
 * the real DOM end to end:
 *
 *   customer → transaction trace → ledger journal → unified transaction detail
 *
 * The API is a fixture at the browser network layer; this run proves the two PRs' contracts line up
 * in one build (which navigation case wins, which hash the link writes, which endpoint the unified
 * screen reads). It is not a server test — the real HTTP checks live in
 * finance-operations-http-acceptance.cjs.
 *
 * Usage:
 *   node scripts/finance-pr23-combined-acceptance.cjs \
 *     --dist /tmp/combined-dist --executable /tmp/chromium \
 *     --lib-path /tmp/al2023/lib --out /tmp/combined-acceptance
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
const OUT = path.resolve(args.out ?? '/tmp/combined-acceptance');
const PORT = Number(args.port ?? 4402);
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

const customerId = 'c0c0c0c0-1111-4222-8333-444455556666';
const transactionId = 'aa11bb22-3333-4444-8555-666677778888';
// The original canonical-service CASH_IN journal: the ONLY identifier the PR #23 contract accepts
// for cash-in. The deposit row id must never appear in the link.
const journalId = '1a2b3c4d-2222-4333-8444-555566667777';
const depositRowId = 'd0e0f0a0-9999-4888-8777-666655554444';
const institution = { id: 'inst-1', code: 'MNJ', name: 'Monie Naija Ltd', status: 'ACTIVE' };

const customer = {
  id: customerId,
  reference: 'CUS-2026-000321',
  type: 'INDIVIDUAL',
  status: 'ACTIVE',
  kycLevel: 'LEVEL_2',
  kycStatus: 'APPROVED',
  createdAt: '2026-05-01T09:00:00.000Z',
  displayName: 'Ada Acceptance',
  legalName: 'Ada Acceptance',
  primaryContact: { type: 'PHONE', maskedValue: '••••••1234', isVerified: true },
};

const transaction = {
  id: transactionId,
  status: 'COMPLETED',
  currency: 'NGN',
  amountMinor: '150000',
  reference: 'DEP-2026-000044',
  createdAt: '2026-11-20T09:00:00.000Z',
  completedAt: '2026-11-20T09:00:05.000Z',
  walletId: 'wallet-1',
};

const journalDetail = {
  id: journalId,
  reference: 'DEP-2026-000044',
  description: 'Agent cash-in',
  status: 'POSTED',
  currency: 'NGN',
  accountingUnit: 'NGN',
  totalMinor: '150000',
  lineCount: 2,
  institution,
  source: {
    // The source record says DEPOSIT with the deposit row id; the link adapter must resolve the
    // canonical cash-in journal id, not echo this row id.
    type: 'DEPOSIT',
    id: depositRowId,
    reference: 'DEP-2026-000044',
    status: 'COMPLETED',
    linkedBy: 'JOURNAL_ID',
    navigable: true,
  },
  reversal: { kind: 'NORMAL', reversalOfJournalId: null, reversedByJournalId: null },
  lines: [
    {
      id: 'line-1',
      lineNumber: 1,
      accountId: 'acct-1',
      accountCode: '1100',
      accountName: 'Agent cash clearing',
      accountType: 'ASSET',
      institutionalScope: 'INSTITUTION',
      institutionId: institution.id,
      direction: 'DEBIT',
      amountMinor: '150000',
      currency: 'NGN',
      accountingUnit: 'NGN',
    },
    {
      id: 'line-2',
      lineNumber: 2,
      accountId: 'acct-2',
      accountCode: '2100',
      accountName: 'Customer funds payable',
      accountType: 'LIABILITY',
      institutionalScope: 'INSTITUTION',
      institutionId: institution.id,
      direction: 'CREDIT',
      amountMinor: '150000',
      currency: 'NGN',
      accountingUnit: 'NGN',
    },
  ],
};

const unifiedCashInDetail = {
  id: journalId,
  type: 'CASH_IN',
  reference: 'DEP-2026-000044',
  status: 'POSTED',
  createdAt: '2026-11-20T09:00:00.000Z',
  completedAt: '2026-11-20T09:00:05.000Z',
  amountMinor: '150000',
  feeMinor: '0',
  vatMinor: '0',
  currency: 'NGN',
  institutionId: institution.id,
  journals: [journalId],
  investigation: { agentId: 'agent-001', customerId },
};

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function main() {
  const { chromium } = require('playwright');
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: args.executable, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const requests = [];

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname + url.search });
    if (url.pathname.endsWith('/internal/a2/workforce/local-admin-sessions'))
      return json(route, {
        accessToken: 'fixture-token',
        tokenType: 'Bearer',
        sessionId: 'session-combined-1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        principal: {
          type: 'PRIVILEGED',
          principalId: 'workforce:combined-operator',
          sessionId: 'session-combined-1',
          audience: 'admin-console',
          roles: ['SUPER_ADMIN', 'FINANCE_CONTROLLER'],
          scopes: [
            'workforce.dashboard.view',
            'customer.view',
            'customer.view_transactions',
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
    if (url.pathname.endsWith('/dashboard/my-dashboard'))
      return json(route, {
        templateKey: 'acceptance-template',
        displayName: 'Acceptance dashboard',
        description: 'Fixture',
        isFallback: false,
        widgets: [],
      });
    if (url.pathname.endsWith('/internal/customers'))
      return json(route, {
        data: [customer],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    if (url.pathname.endsWith(`/internal/customers/${customerId}`)) return json(route, customer);
    if (url.pathname.endsWith(`/internal/customers/${customerId}/transactions`))
      return json(route, {
        items: [
          {
            id: transactionId,
            type: 'DEPOSIT',
            status: 'COMPLETED',
            direction: 'CREDIT',
            currency: 'NGN',
            amountMinor: '150000',
            reference: 'DEP-2026-000044',
            createdAt: '2026-11-20T09:00:00.000Z',
          },
        ],
        pagination: { total: 1, page: 1, limit: 20, totalPages: 1, hasNextPage: false },
      });
    if (url.pathname.endsWith(`/deposits/${transactionId}`)) return json(route, transaction);
    if (url.pathname.endsWith(`/internal/finance-operations/transactions/${transactionId}/journal`))
      return json(route, {
        transaction: {
          id: transactionId,
          type: 'DEPOSIT',
          reference: 'DEP-2026-000044',
          status: 'COMPLETED',
          createdAt: '2026-11-20T09:00:00.000Z',
        },
        ledgerAccess: 'GRANTED',
        journal: {
          id: journalId,
          reference: 'DEP-2026-000044',
          status: 'POSTED',
          currency: 'NGN',
          totalMinor: '150000',
          institution,
          reversal: { kind: 'NORMAL', reversalOfJournalId: null, reversedByJournalId: null },
        },
        outcome: 'FOUND',
        message: 'The transaction is recorded by one posted ledger journal.',
      });
    // The desk still reads the legacy journal endpoint for the record body; the Finance read model
    // supplies attribution, source and eligibility.
    if (url.pathname.endsWith(`/api/v1/ledger/journals/${journalId}`))
      return json(route, {
        id: journalId,
        status: 'POSTED',
        currency: 'NGN',
        accountingUnit: 'NGN',
        reference: 'DEP-2026-000044',
        description: 'Agent cash-in',
        createdAt: '2026-11-20T09:00:00.000Z',
        lines: journalDetail.lines.map((line) => ({
          id: line.id,
          accountId: line.accountId,
          direction: line.direction,
          amountMinor: line.amountMinor,
        })),
      });
    if (url.pathname.endsWith(`/internal/finance-operations/ledger/journals/${journalId}`))
      return json(route, journalDetail);
    if (url.pathname.endsWith(`/internal/finance-operations/ledger/journals/${journalId}/reversal-eligibility`))
      return json(route, {
        journalId,
        eligible: false,
        nextAction: 'NONE',
        nextActionLabel: 'No reversal action available',
        reasonCode: 'READ_ONLY_PRINCIPAL',
        reason: 'This principal can review the journal but cannot reverse it.',
        permissions: { canView: true, canRequest: false, canExecute: false },
        approval: null,
        blockers: [],
        governance: {
          actionType: 'LEDGER_REVERSAL',
          resourceType: 'ledger',
          makerRole: 'FINANCE_PREPARER',
          checkerRole: 'FINANCE_CONTROLLER',
          note: 'Separation of duties is enforced by the server.',
        },
      });
    // PR #23's contract endpoint. CASH_IN keys by the original canonical-service journal id.
    if (url.pathname.endsWith(`/internal/admin/transaction-history/CASH_IN/${journalId}`))
      return json(route, unifiedCashInDetail);
    if (url.pathname.endsWith('/internal/admin/transaction-history'))
      return json(route, {
        items: [
          {
            id: journalId,
            type: 'CASH_IN',
            reference: 'DEP-2026-000044',
            status: 'POSTED',
            createdAt: '2026-11-20T09:00:00.000Z',
            amountMinor: '150000',
            feeMinor: '0',
            currency: 'NGN',
          },
        ],
        nextCursor: null,
      });
    return json(route, { data: [], items: [], total: 0, page: 1, pageSize: 20 });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message)));

  const base = `http://127.0.0.1:${PORT}`;
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.fill('#admin-login-email', 'controller@monienaija.local');
  await page.fill('#admin-login-password', 'fixture-password-value');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });

  // --- customer → transaction trace -----------------------------------------
  if (!(await page.locator('[data-testid="nav-customers"]').isVisible()))
    await page.locator('[data-testid="section-servicing"]').click();
  await page.locator('[data-testid="nav-customers"]').click();
  const openCustomer = page.getByRole('button', {
    name: 'Open Customer 360° for Ada Acceptance',
  });
  await openCustomer.waitFor({ timeout: 20000 });
  await openCustomer.click();
  const openWorkspace = page.getByRole('button', { name: /Open transaction workspace/ });
  await openWorkspace.waitFor({ timeout: 20000 });
  await openWorkspace.click();

  await page.getByRole('button', { name: 'Deposits', exact: true }).click();
  await page.fill('#transaction-id', transactionId);
  await page.getByRole('button', { name: 'Track' }).click();
  const journalStatus = page.locator('[data-testid="transaction-journal-status"]');
  await journalStatus.waitFor({ timeout: 20000 });
  const statusText = (await journalStatus.innerText()).replace(/\s+/g, ' ');
  const linkText = (await page.locator('[data-testid="transaction-journal-link"]').innerText()).replace(
    /\s+/g,
    ' ',
  );
  record(
    'TRANSACTION-RESOLVES-ITS-LEDGER-JOURNAL',
    /FOUND/.test(statusText) && linkText.includes('DEP-2026-000044'),
    `${statusText} | ${linkText.slice(0, 120)}`,
  );

  // --- journal → Finance ledger desk ----------------------------------------
  await page.locator('[data-testid="open-journal-record"]').click();
  await page.locator('[data-testid="reversal-eligibility"]').waitFor({ timeout: 20000 });
  const ledgerSource = await page.locator('[data-testid="ledger-journal-source"]').innerText();
  record(
    'JOURNAL-OPENS-THE-FINANCE-LEDGER-DESK',
    ledgerSource.includes('DEP-2026-000044'),
    ledgerSource.replace(/\s+/g, ' ').slice(0, 120),
  );

  // --- Finance ledger → unified transaction detail (PR #23 contract) -------
  const unifiedHref = await page
    .locator('[data-testid="open-unified-transaction-detail"]')
    .getAttribute('href');
  record(
    'LEDGER-LINKS-BY-CANONICAL-CASH-IN-JOURNAL-ID',
    unifiedHref === `#transaction-history/CASH_IN/${journalId}`,
    `href=${unifiedHref} (deposit row id ${depositRowId} must not appear)`,
  );
  await page.locator('[data-testid="open-unified-transaction-detail"]').click();
  const detailDrawer = page.locator('[aria-label="Transaction details"]');
  await detailDrawer.waitFor({ timeout: 20000 });
  await detailDrawer.getByRole('heading', { name: 'DEP-2026-000044' }).waitFor({ timeout: 20000 });
  const detailText = (await detailDrawer.innerText()).replace(/\s+/g, ' ');
  const contractCall = requests.find((entry) =>
    entry.path.startsWith(`/api/v1/internal/admin/transaction-history/CASH_IN/${journalId}`),
  );
  record(
    'UNIFIED-DETAIL-READS-THE-CONTRACT-ENDPOINT',
    Boolean(contractCall),
    contractCall?.path ?? 'contract endpoint was not requested',
  );
  record(
    'UNIFIED-DETAIL-SHOWS-THE-SAME-BUSINESS-RECORD',
    detailText.includes(journalId) &&
      /CASH[ _-]IN/i.test(detailText) &&
      !detailText.includes(depositRowId),
    detailText.slice(0, 220),
  );

  record('NO-UNCAUGHT-PAGE-ERRORS', pageErrors.length === 0, pageErrors.join(' | ') || 'none');

  fs.writeFileSync(
    path.join(OUT, 'finance-pr23-combined-acceptance.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dist: DIST,
        api: 'stubbed',
        requests,
        checks: results,
      },
      null,
      2,
    )}\n`,
  );
  await page.screenshot({ path: path.join(OUT, 'finance-pr23-combined-1440x900.png') });
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  server.close();
  const failed = results.filter((entry) => !entry.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed -> ${OUT}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('combined acceptance failed to run:', error);
  server.close();
  process.exit(1);
});
