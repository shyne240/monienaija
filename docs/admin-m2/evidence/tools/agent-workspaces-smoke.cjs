// Synthetic reads only. No backend and no mutation requests are permitted.
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  const agent = { id: 'agent-synthetic', reference: 'AG-SYNTHETIC', status: 'ACTIVE', agentClassId: null, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' };
  const item = { id: 'funding-synthetic', approvalId: 'approval-synthetic', agentId: agent.id, agentReference: agent.reference, direction: 'FUND', amountMinor: '100000', currency: 'NGN', idempotencyKey: 'synthetic-key', status: 'PENDING', approvalStatus: 'REQUESTED', reason: 'Synthetic funding request', requesterPrincipalId: 'synthetic-maker', createdAt: '2026-11-01T10:00:00Z', approvalExpiresAt: '2026-12-01T10:00:00Z' };
  await page.route('**/api/v1/**', route => {
    const req = route.request(); const url = new URL(req.url()); let body;
    if (req.method() !== 'GET') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic harness blocks mutations' }) });
    if (url.pathname.endsWith('/my-dashboard')) body = { templateKey: 'SYNTHETIC', displayName: 'Overview', description: 'Synthetic', isFallback: false, widgets: [] };
    else if (url.pathname.endsWith('/internal/agents/funding-requests')) body = { items: [item], page: 1, limit: 20, total: 1 };
    else if (url.pathname.endsWith('/internal/agents')) body = { data: [agent], total: 1 };
    else if (url.pathname.endsWith('/internal/agents/agent-synthetic/financial-position')) body = { agentId: agent.id, currency: 'NGN', balanceMinor: '123456', walletExists: true, walletId: 'synthetic-wallet' };
    else if (url.pathname.endsWith('/internal/agents/agent-synthetic/transactions')) body = { items: [{ id:'synthetic-tx', type:'AGENT_FUNDING', status:'COMPLETED', direction:'CREDIT', amountMinor:'123456', currency:'NGN', createdAt:'2026-11-01T10:00:00Z', reference:'TX-SYNTHETIC', counterparty:null, commission:null }], pagination: { page:1, limit:20, total:1, totalPages:1, hasNextPage:false } };
    else return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic service unavailable' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => {
    localStorage.setItem('admin_workforce_token', 'synthetic'); localStorage.setItem('admin_workforce_session_id', 'synthetic');
    localStorage.setItem('admin_workforce_principal', JSON.stringify({ type:'OPERATOR', principalId:'synthetic-checker', sessionId:'synthetic', audience:'workforce-admin', roles:['FINANCE_CONTROLLER','AGENT_NETWORK_MANAGER'], scopes:['agent.view','agent.fund','agent.defund','agent.manage_credentials','agent.manage_classes','customer.manage_support_case','privileged:approve'], customerAccess:'NONE', assuranceLevel:'MFA' }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  const report = [];
  for (const width of [320,360,390,768,769,1024,1280,1440]) {
    await page.setViewportSize({ width, height: 900 });
    async function navigate(key) { if (width < 1024) await page.getByTestId('mobile-menu-toggle').click(); await page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-' + key).click(); }
    await navigate('agents');
    await page.getByRole('button', { name:'View', exact:true }).click();
    await page.getByText('synthetic-wallet').waitFor();
    await page.getByRole('button', { name:'Load unified stream' }).click();
    await page.getByText('TX-SYNTHETIC').waitFor();
    for (const name of ['Agent credential and session controls', 'Agent class governance assignment', 'Unified Agent transaction stream', 'Agent Transaction PIN support controls']) {
      const region = page.getByRole('region', { name }); await region.waitFor();
      const sizes = await page.evaluate(() => ({ page:document.documentElement.scrollWidth, view:document.documentElement.clientWidth }));
      report.push({ width, workspace:name, ...sizes });

    }
    if ([320,1440].includes(width)) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/agent-detail-loaded-${width}.png`, fullPage:true}); }
    await navigate('approvalsInbox'); await page.getByRole('button', { name:'Inspect details' }).click();
    await page.getByTestId('funding-inbox-detail').waitFor();
    const sizes = await page.evaluate(() => ({ page:document.documentElement.scrollWidth, view:document.documentElement.clientWidth }));
    report.push({ width, workspace:'funding inbox with details', ...sizes });
    if ([320,1440].includes(width)) { await page.getByRole('region', { name:'Funding instructions table' }).evaluate(el => { el.scrollLeft = 0; }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:`${process.cwd()}/docs/admin-m2/evidence/agent-approvals-loaded-${width}.png`, fullPage:true}); }
  }
  fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/agent-workspaces-smoke.json`, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ total:report.length, overflow:report.filter(x=>x.page>x.view) }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
