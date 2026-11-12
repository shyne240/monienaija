// Capture omitted owner-review views with synthetic reads only; no API mutation or real data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter(arg => arg !== '--single-process'), headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  let writes = 0;
  await page.route('**/api/v1/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') { writes++; return route.fulfill({ status: 403, body: 'Synthetic harness blocks writes' }); }
    let body;
    if (path.endsWith('/my-dashboard')) body = { templateKey: 'SYNTHETIC', displayName: 'Overview', widgets: [] };
    else if (/\/(deposits|withdrawals)\/synthetic-trace$/.test(path)) body = { id: 'synthetic-trace', status: 'PENDING', currency: 'NGN', amountMinor: '100000', reference: 'SYNTHETIC-REFERENCE', createdAt: '2026-11-01T10:00:00Z' };
    else if (path.endsWith('/internal/agents')) body = { data: [{ id: 'synthetic-agent', reference: 'AG-SYNTHETIC', status: 'ACTIVE', agentClassId: null, createdAt: '2026-11-01T00:00:00Z' }], total: 1 };
    else return route.fulfill({ status: 503, body: 'Synthetic service unavailable' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:5173/');
  const report = [];
  for (const width of [320, 1440]) {
    for (const view of ['cashIn', 'cashOut', 'maker']) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://127.0.0.1:5173/');
      await page.evaluate(view => {
        const maker = view === 'maker';
        localStorage.setItem('admin_workforce_token', 'synthetic'); localStorage.setItem('admin_workforce_session_id', 'synthetic');
        localStorage.setItem('admin_workforce_principal', JSON.stringify({ type: 'OPERATOR', principalId: 'synthetic', sessionId: 'synthetic', audience: 'workforce-admin', roles: [maker ? 'AGENT_NETWORK_MANAGER' : 'OPERATIONS'], scopes: maker ? ['agent.view', 'agent.fund', 'agent.defund'] : ['transaction.view'], customerAccess: 'ANY', assuranceLevel: 'MFA' }));
      }, view);
      await page.reload({ waitUntil: 'networkidle' });
      if (width < 1024) await page.getByTestId('mobile-menu-toggle').click();
      await page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-' + (view === 'maker' ? 'agents' : view)).click();
      if (view === 'maker') {
        await page.getByRole('region', { name: 'Agent funding workflow' }).waitFor();
        await page.getByLabel('Funding Agent ID').fill('synthetic-agent');
        await page.getByLabel('Funding amount in kobo').fill('100000');
        await page.getByLabel('Funding reason').fill('Synthetic visual review');
      } else {
        await page.getByLabel('Transaction ID (UUID)').fill('synthetic-trace');
        await page.getByRole('button', { name: 'Track' }).click();
        await page.getByText('SYNTHETIC-REFERENCE').waitFor();
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `docs/admin-m2/evidence/acceptance-20261106/visual-${view}-${width}.png`, fullPage: true });
      report.push({ width, view, writes });
      // Fresh page discards only this synthetic, never-submitted visual draft.
    }
  }
  assert.equal(writes, 0);
  fs.writeFileSync('docs/admin-m2/evidence/acceptance-20261106/visual-gaps-capture.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ captures: report.length, writes })); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
