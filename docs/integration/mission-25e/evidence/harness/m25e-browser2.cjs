/**
 * MISSION 25E — BROWSER RE-VERIFICATION of the three assertions that were wrong the first time.
 * The first run asserted table presence for surfaces that only render when rows exist, and
 * treated a correctly-disabled button as a false promise. This run asserts the real contracts
 * with REAL delivery/receipt rows produced by the product consumer.
 */
'use strict';
const { chromium } = require('/home/user/m25e/node_modules/playwright');
const fs = require('fs');
const BASE = 'http://localhost:5173';
const OUT = '/home/user/m25e-browser';
const manifest = JSON.parse(fs.readFileSync('/home/user/monienaija-local-dev-11-roles-credentials.json', 'utf8'));

const results = [];
const rec = (id, ok, detail) => { results.push({ id, ok, detail: String(detail).slice(0, 500) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail).slice(0, 260)}`); };

async function login(page, role) {
  const c = manifest[role];
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#admin-login-email', { timeout: 25000 });
  await page.fill('#admin-login-email', c.email);
  await page.fill('#admin-login-password', c.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.locator('[data-testid="nav-notifications"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/tmp/chrome/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  // ---------- 1. deliveries with real rows ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const net = [];
    page.on('response', (r) => { if (r.url().includes('/api/v1/')) net.push({ u: r.url().replace(BASE, '').split('?')[0], s: r.status() }); });
    await login(page, 'SUPER_ADMIN');
    await page.locator('[data-testid="notif-tab-deliveries"]').click();
    await page.waitForTimeout(3000);

    const table = await page.locator('[data-testid="notification-deliveries-table"]').count();
    const panel = (await page.locator('[data-testid="notif-panel-deliveries"]').textContent().catch(() => '')) || '';
    rec('UI-DELIVERIES-TABLE-RENDERS-WITH-ROWS', table > 0, `deliveries table present=${table > 0}`);

    const rowText = (await page.locator('[data-testid="notif-panel-deliveries"]').textContent()) || '';
    rec('UI-DELIVERIES-STATUS-VISIBLE', /SKIPPED/.test(rowText),
      `statuses on screen: ${(rowText.match(/PENDING|SENT|FAILED|SKIPPED|UNKNOWN|DEAD/g) || []).join(',')}`);
    // a suppressed row must not be presented as a successful send
    const claimsSuccess = /(^|\s)(Delivered|Sent successfully)(\s|$)/i.test(rowText);
    rec('UI-DELIVERIES-SKIPPED-NOT-PRESENTED-AS-SENT', !claimsSuccess, `success wording present=${claimsSuccess}`);

    // recipient must be masked/redacted, never a raw phone
    const rawPhone = /\+?\d{11,15}/.test(rowText);
    rec('UI-DELIVERIES-NO-RAW-DESTINATION', !rawPhone, `raw phone-shaped string in deliveries panel=${rawPhone}`);

    const bad = net.filter((n) => n.s >= 400);
    rec('UI-DELIVERIES-NO-BACKGROUND-4XX', bad.length === 0, bad.length ? JSON.stringify(bad) : '0 background 4xx/5xx');
    await page.screenshot({ path: `${OUT}/deliveries-with-rows.png`, fullPage: true });

    // ---------- 2. outbox receipts with real quarantine rows ----------
    const section = await page.locator('[data-testid="outbox-receipts-section"]').count();
    const rText = (await page.locator('[data-testid="outbox-receipts-section"]').textContent().catch(() => '')) || '';
    rec('UI-RECEIPTS-SECTION-PRESENT', section > 0, `outbox-receipts section present=${section > 0}`);
    rec('UI-RECEIPTS-QUARANTINE-VISIBLE', /QUARANTINED/.test(rText),
      `receipt statuses on screen: ${(rText.match(/QUARANTINED|UNSUPPORTED|SUPPRESSED|MATERIALIZED|FAILED/g) || []).join(',')}`);
    rec('UI-RECEIPTS-REASON-VISIBLE', /EVENT_TYPE_UNSUPPORTED|SUPPORT_VISIBILITY_UNKNOWN/.test(rText),
      `quarantine reasons visible=${/EVENT_TYPE_UNSUPPORTED|SUPPORT_VISIBILITY_UNKNOWN/.test(rText)}`);

    // the filter control the operator uses (M-05-style status selection)
    const sel = await page.locator('[data-testid="outbox-receipt-status-select"]').count();
    rec('UI-RECEIPTS-STATUS-FILTER', sel > 0, `status filter present=${sel > 0}`);
    if (sel) {
      await page.selectOption('[data-testid="outbox-receipt-status-select"]', 'QUARANTINED');
      await page.waitForTimeout(2200);
      const filtered = (await page.locator('[data-testid="outbox-receipts-section"]').textContent().catch(() => '')) || '';
      const hasQuarantined = /QUARANTINED/.test(filtered);
      const hasMaterialized = /MATERIALIZED/.test(filtered);
      rec('UI-RECEIPTS-FILTER-QUARANTINED', hasQuarantined && !hasMaterialized,
        `QUARANTINED filter shows quarantined=${hasQuarantined} shows materialized=${hasMaterialized}`);
    }
    await page.screenshot({ path: `${OUT}/receipts-with-rows.png`, fullPage: true });
    await ctx.close();
  }

  // ---------- 3. read-only role: action control must be DISABLED, not merely styled ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    await login(page, 'FINANCE_AUDITOR');
    await page.locator('[data-testid="notif-tab-events"]').click();
    await page.waitForTimeout(2500);
    const btn = page.locator('[data-testid="configure-trigger-customer.funding.requested"]');
    const n = await btn.count();
    const disabled = n ? await btn.isDisabled() : null;
    const title = n ? await btn.getAttribute('title') : null;
    rec('UI-READONLY-CONFIG-CONTROL-DISABLED', n > 0 && disabled === true,
      `button present=${n > 0} disabled=${disabled} title="${title}"`);
    // and no false success messaging anywhere on the panel
    const panel = (await page.locator('[data-testid="notif-panel-events"]').textContent().catch(() => '')) || '';
    rec('UI-READONLY-NO-FALSE-SUCCESS', !/was applied|successfully applied|has been updated/i.test(panel),
      `false-success wording present=${/was applied|successfully applied|has been updated/i.test(panel)}`);
    await page.screenshot({ path: `${OUT}/auditor-events-disabled.png`, fullPage: true });
    await ctx.close();
  }

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(`${OUT}/browser-recheck-results.json`, JSON.stringify({ results, passed: results.length - failed.length, failed: failed.length }, null, 2));
  console.log(`\n=== M25E BROWSER RECHECK: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
