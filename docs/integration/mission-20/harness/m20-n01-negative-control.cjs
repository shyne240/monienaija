/**
 * MISSION 20 — N-01 NEGATIVE CONTROL
 *
 * A green pointer-click suite only means something if the suite is capable of going red.
 * This script performs the three Mission 17 pointer clicks (SUPER_ADMIN Product Catalogue,
 * SUPER_ADMIN Limit Catalogue, FINANCE_AUDITOR Limit Assignments) under whatever CSS is
 * currently being served by the Vite dev server, and prints whether each one is reachable by
 * a plain mouse click (no force, no keyboard, no synthetic events).
 *
 * Run it once with the baseline (Mission 17) admin-shell.css in place -> expect BLOCKED.
 * Run it again with the Mission 19B css in place                           -> expect OK.
 * Same script, same browser, same credentials: only the stylesheet differs.
 */
const { chromium } = require('/home/user/m20/node_modules/playwright');
const fs = require('fs');

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const CASES = [
  { role: 'SUPER_ADMIN', key: 'productCatalogue' },
  { role: 'SUPER_ADMIN', key: 'limitCatalogue' },
  { role: 'FINANCE_AUDITOR', key: 'limitAssignments' },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const label = process.argv[2] || 'run';
  const rows = [];

  for (const { role, key } of CASES) {
    const c = manifest[role];
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    if (await page.isVisible('[data-testid="desktop-nav"]', { timeout: 3000 }).catch(() => false)) {
      await page.click('button:has-text("Log out session")', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    if (!(await page.isVisible('#admin-login-email', { timeout: 3000 }).catch(() => false))) {
      await page.evaluate(() => { try { localStorage.clear(); } catch {} });
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await page.waitForSelector('#admin-login-email', { timeout: 20000 });
    await page.fill('#admin-login-email', c.email);
    await page.fill('#admin-login-password', c.password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });
    await page.waitForTimeout(1200);
    for (const t of await page.$$('[data-testid="desktop-nav"] [data-testid^="section-"]')) {
      if ((await t.getAttribute('aria-expanded')) !== 'true') { await t.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(80); }
    }

    let clickable = false;
    let error = '';
    try {
      await page.locator(`[data-testid="nav-${key}"]`).click({ timeout: 6000, force: false });
      clickable = true;
    } catch (e) {
      error = String(e.message.split('\n')[0]).slice(0, 120);
    }
    if (clickable) {
      await page.waitForTimeout(500);
      const text = (await page.textContent('[data-testid="main-content"]')) || '';
      clickable = /Commercial Rule Registries|Limit Assignments/i.test(text);
    }
    rows.push({ role, key, clickable, error });
    console.log(`[${clickable ? 'OK' : 'BLOCKED'}] ${label} ${role} -> ${key}${error ? ' :: ' + error : ''}`);
  }

  fs.writeFileSync(`/home/user/n01-negative-control-${label}.json`, JSON.stringify(rows, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
