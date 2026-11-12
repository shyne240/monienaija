// Synthetic recovery workflow only: every API request is intercepted. No signed statement or backend action.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const axe = require('axe-core');

(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('dialog', dialog => dialog.accept());
  const claims = { operation: 'REVOKE_SUPER_ADMIN', targetPrincipalId: 'synthetic-target', targetAssignmentReference: 'synthetic-assignment', reason: 'Synthetic keyboard review' };
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  let posts = 0, release, mode = 'receipt';
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/super-admin/recovery')) {
      posts++;
      await new Promise(resolve => { release = resolve; });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mode === 'receipt' ? { ...claims, recoveryReference: 'synthetic-recovery', revokedSessionCount: 0, consumedBy: 'synthetic-admin', consumedAt: '2026-11-01T00:00:00Z', auditReference: 'synthetic-audit' } : {}) });
    }
    if (request.method() !== 'GET') return route.fulfill({ status: 403, body: 'Blocked by synthetic harness' });
    if (path.endsWith('/my-dashboard')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templateKey: 'SYNTHETIC', displayName: 'Overview', isFallback: false, widgets: [] }) });
    return route.fulfill({ status: 503, body: 'Synthetic service unavailable' });
  });
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(() => {
    localStorage.setItem('admin_workforce_token', 'synthetic');
    localStorage.setItem('admin_workforce_session_id', 'synthetic');
    localStorage.setItem('admin_workforce_principal', JSON.stringify({ type: 'OPERATOR', principalId: 'synthetic-admin', sessionId: 'synthetic', audience: 'workforce-admin', roles: ['ADMINISTRATOR'], scopes: ['workforce.super_admin.recover'], customerAccess: 'NONE', assuranceLevel: 'MFA' }));
  });
  const report = [];
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload({ waitUntil: 'networkidle' });
    if (width < 1024) await page.getByTestId('mobile-menu-toggle').click();
    await page.getByTestId((width < 1024 ? 'mobile-' : '') + 'nav-superAdminRecovery').click();
    const input = page.getByLabel('Recovery statement (JWT)');
    const trigger = page.getByRole('button', { name: 'Execute Recovery' });
    mode = 'receipt'; await input.fill(token); await trigger.focus(); await page.keyboard.press('Enter');
    const modal = page.getByRole('dialog', { name: 'Confirm recovery request?' });
    await modal.waitFor();
    const keep = modal.getByRole('button', { name: 'Keep editing' });
    const confirm = modal.getByRole('button', { name: 'Confirm recovery' });
    assert(await keep.evaluate(el => el === document.activeElement), 'Initial focus must be on Keep editing');
    await page.keyboard.press('Shift+Tab'); assert(await confirm.evaluate(el => el === document.activeElement), 'Shift+Tab must wrap');
    await page.keyboard.press('Tab'); assert(await keep.evaluate(el => el === document.activeElement), 'Tab must wrap');
    await page.addScriptTag({ content: axe.source });
    const violations = await modal.evaluate(async el => (await window.axe.run(el, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.html) })));
    assert.deepEqual(violations, []);
    await page.keyboard.press('Escape'); assert.equal(await modal.count(), 0); assert(await trigger.evaluate(el => el === document.activeElement), 'Escape must restore focus to trigger');
    assert.equal(posts, report.length * 2, 'Cancel must not make a request');
    await page.keyboard.press('Enter'); await modal.waitFor(); await confirm.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.textContent.includes('Executing…'));
    await page.keyboard.press('Escape'); assert(await modal.isVisible(), 'Pending request must not dismiss');
    assert.equal(posts, report.length * 2 + 1); release();
    await page.getByText('synthetic-recovery', { exact: true }).waitFor();
    const receipt = page.locator('.mn-recovery__receipt');
    await page.waitForFunction(() => document.activeElement?.classList.contains('mn-recovery__receipt'));
    await page.screenshot({ path: `docs/admin-m2/evidence/acceptance-20261106/recovery-focus-${width}.png`, fullPage: true });
    await receipt.getByRole('button', { name: 'Dismiss recovery receipt' }).focus(); await page.keyboard.press('Enter');
    assert(await input.evaluate(el => el === document.activeElement), 'Receipt dismissal must focus the statement');
    mode = 'unconfirmed'; await input.fill(token); await trigger.focus(); await page.keyboard.press('Enter');
    await modal.waitFor(); await confirm.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.textContent.includes('Executing…')); assert.equal(posts, report.length * 2 + 2); release();
    await page.waitForFunction(() => document.activeElement?.classList.contains('mn-recovery__review'));
    const review = page.locator('.mn-recovery__review'); assert(await review.getByText(/fresh read cannot exclude a late commit/).isVisible());
    const acknowledge = review.getByRole('button', { name: 'I reviewed recovery and audit records' }); await acknowledge.focus(); await page.keyboard.press('Enter');
    assert(await input.evaluate(el => el === document.activeElement), 'Review acknowledgment must focus the statement');
    report.push({ width, modalFocusTrap: true, escapeRestoresFocus: true, noWriteBeforeConfirm: true, pendingCannotDismiss: true, targetedAxeViolations: violations, receiptFocus: true, receiptDismissalFocus: true, uncertainReviewFocus: true, acknowledgmentFocus: true, requestsIntercepted: 2 });
  }
  fs.writeFileSync('docs/admin-m2/evidence/acceptance-20261106/recovery-keyboard.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
