// All reads and writes are intercepted synthetic fixtures; no backend mutations.
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const cls = { id: 'synthetic-class', reference: 'SYNTHETIC-CLASS', code: 'SYNTHETIC', name: 'Synthetic Agent class', description: null, isActive: true, requirements: null, requiredInformation: null, requiredDocumentCategories: null, applicableServices: null, applicableLimits: null, version: 2, createdAt: '2026-11-01', updatedAt: '2026-11-01' };
  let mode = 'mismatch', active = true, version = 1;
  const assignment = (id, code) => ({ id, subjectType: 'AGENT_CLASS', subjectId: cls.id, limitProfileCode: code, isActive: active, version });
  await page.route('**/api/v1/**', route => {
    const req = route.request(), url = new URL(req.url()); let body;
    if (req.method() === 'PATCH' && url.pathname.endsWith('/limit-assignments/second')) {
      if (mode === 'match') { active = false; version = 2; }
      body = { ...assignment(mode === 'match' ? 'second' : 'unrelated', 'PAGE_TWO'), isActive: false, version: 2 };
    } else if (req.method() !== 'GET') return route.fulfill({ status: 403, body: 'Blocked by synthetic harness' });
    else if (url.pathname.endsWith('/my-dashboard')) body = { templateKey: 'SYNTHETIC', displayName: 'Overview', isFallback: false, widgets: [] };
    else if (url.pathname.endsWith('/agents/classes')) body = [cls];
    else if (url.pathname.endsWith('/limit-assignments/agent-class/synthetic-class')) {
      const n = Number(url.searchParams.get('page'));
      body = { data: n === 2 ? [assignment('second', 'PAGE_TWO')] : Array.from({ length: 20 }, (_, i) => assignment(`first-${i}`, `PROFILE_${i}`)), page: n, limit: 20, total: 21, totalPages: 2, hasNextPage: n === 1 };
    } else return route.fulfill({ status: 503, body: 'Synthetic service unavailable' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => {
    localStorage.setItem('admin_workforce_token', 'synthetic'); localStorage.setItem('admin_workforce_session_id', 'synthetic');
    localStorage.setItem('admin_workforce_principal', JSON.stringify({ type: 'OPERATOR', principalId: 'synthetic-manager', sessionId: 'synthetic', audience: 'workforce-admin', roles: ['AGENT_NETWORK_MANAGER'], scopes: ['agent.view', 'agent.manage_classes', 'limit.view', 'limit.modify'], customerAccess: 'NONE', assuranceLevel: 'MFA' }));
  });
  await page.reload({ waitUntil: 'networkidle' }); const report = [];
  async function activate(locator) { await locator.focus(); await page.keyboard.press('Enter'); }
  for (const width of [320, 360, 390, 768, 769, 1024, 1280, 1440]) {
    mode = 'mismatch'; active = true; version = 1; await page.setViewportSize({ width, height: 900 });
    async function navigate(key) { if (width < 1024) await page.getByTestId('mobile-menu-toggle').click(); await page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-' + key).click(); }
    await navigate('dashboard'); await navigate('agentClasses');
    await activate(page.getByRole('button', { name: 'Review / edit' })); await activate(page.getByRole('button', { name: 'Load class limit assignments' }));
    await page.getByText('Page 1 of 2 · 21 assignments').waitFor(); await activate(page.getByRole('button', { name: 'Next' })); await page.getByText('PAGE_TWO').waitFor();
    await activate(page.getByRole('button', { name: 'Deactivate class limit' })); await page.getByText(/update outcome could not be confirmed/).waitFor();
    if (await page.getByRole('button', { name: 'Deactivate class limit' }).count()) throw Error('Stale action remained available');
    mode = 'match'; await activate(page.getByRole('button', { name: 'Load class limit assignments' })); await page.getByText('PROFILE_0', { exact: true }).waitFor(); await activate(page.getByRole('button', { name: 'Next' }));
    await page.getByText('PAGE_TWO').waitFor(); await activate(page.getByRole('button', { name: 'Deactivate class limit' })); await page.getByText('Class limit PAGE_TWO deactivated.').waitFor();
    await assertVisibleLabels(page); const size = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    report.push({ width, keyboard: true, pagination: true, mismatchedReceiptRejected: true, matchingReceiptConfirmed: true, visibleLabelMechanisms: true, ...size });
    if ([320, 1440].includes(width)) await page.screenshot({ path: `${process.cwd()}/docs/admin-m2/evidence/agent-class-actions-${width}.png`, fullPage: true });
  }
  fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/agent-class-actions-smoke.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ total: report.length, overflow: report.filter(row => row.page > row.view) }, null, 2)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
