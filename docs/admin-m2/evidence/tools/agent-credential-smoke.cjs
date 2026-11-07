// Synthetic credential/session receipts only. No network mutation reaches a backend.
const assertVisibleLabels = require('./assert-visible-labels.cjs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('fs');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  page.on('dialog', dialog => dialog.accept());
  let revokeMode = 'mismatch';
  const agent = { id: 'agent-synthetic', reference: 'AG-SYNTHETIC', status: 'ACTIVE', agentClassId: null, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' };
  await page.route('**/api/v1/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body;
    if (req.method() === 'POST' && path.endsWith('/agent-synthetic/credentials')) body = { agentId: agent.id, credentialId: 'synthetic-credential', temporaryPassword: 'synthetic-not-a-real-credential', rotationRequired: true, passwordExpiresAt: '2027-01-01T00:00:00Z', deliveryNotice: 'Synthetic fixture only.' };
    else if (req.method() === 'POST' && path.endsWith('/agent-synthetic/sessions/revoke')) body = { agentId: revokeMode === 'mismatch' ? 'other-agent' : agent.id, revokedSessionCount: 0 };
    else if (req.method() !== 'GET') return route.fulfill({ status: 403, body: 'Synthetic harness blocks mutations' });
    else if (path.endsWith('/my-dashboard')) body = { templateKey: 'SYNTHETIC', displayName: 'Overview', isFallback: false, widgets: [] };
    else if (path.endsWith('/internal/agents')) body = { data: [agent], total: 1 };
    else if (path.endsWith('/agent-synthetic/financial-position')) body = { agentId: agent.id, currency: 'NGN', balanceMinor: '123456', walletExists: true, walletId: 'synthetic-wallet' };
    else return route.fulfill({ status: 503, body: 'Synthetic service unavailable' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => {
    localStorage.setItem('admin_workforce_token', 'synthetic');
    localStorage.setItem('admin_workforce_session_id', 'synthetic');
    localStorage.setItem('admin_workforce_principal', JSON.stringify({ type: 'OPERATOR', principalId: 'synthetic-manager', sessionId: 'synthetic', audience: 'workforce-admin', roles: ['AGENT_NETWORK_MANAGER'], scopes: ['agent.view', 'agent.manage_credentials'], customerAccess: 'NONE', assuranceLevel: 'MFA' }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  const report = [];
  for (const width of [320, 360, 390, 768, 769, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    async function navigate(key) { if (width < 1024) await page.getByTestId('mobile-menu-toggle').click(); await page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-' + key).click(); }
    await navigate('dashboard'); await navigate('agents');
    const view = page.getByRole('button', { name: 'View', exact: true }); await view.focus(); await page.keyboard.press('Enter');
    const controls = page.getByRole('region', { name: 'Agent credential and session controls' }); await controls.waitFor();
    const issue = controls.getByRole('button', { name: 'Issue initial credential' }); await issue.focus(); await page.keyboard.press('Enter');
    await controls.getByTestId('temporary-agent-password').waitFor();
    const hide = controls.getByRole('button', { name: 'Hide one-time value' }); await hide.focus(); await page.keyboard.press('Enter');
    if (await controls.getByTestId('temporary-agent-password').count()) throw Error('Synthetic one-time value remained visible after hiding');
    revokeMode = 'mismatch'; const revoke = controls.getByRole('button', { name: 'Invalidate active sessions' }); await revoke.focus(); await page.keyboard.press('Enter');
    await controls.getByText(/Session revocation response could not be confirmed/).waitFor();
    revokeMode = 'valid'; await revoke.focus(); await page.keyboard.press('Enter'); await controls.getByText('Active Agent sessions invalidated (0 sessions revoked).').waitFor();
    await assertVisibleLabels(page);
    const sizes = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    report.push({ width, workspace: 'credential and session controls', synthetic: true, keyboard: true, secretHidden: true, mismatchedReceiptRejected: true, zeroRevocationsConfirmed: true, ...sizes });
    if ([320, 1440].includes(width)) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${process.cwd()}/docs/admin-m2/evidence/agent-credentials-${width}.png`, fullPage: true }); }
  }
  fs.writeFileSync(`${process.cwd()}/docs/admin-m2/evidence/agent-credential-smoke.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ total: report.length, overflow: report.filter(row => row.page > row.view) }, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
