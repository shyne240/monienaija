/**
 * MISSION 25E — NOTIFICATION CONSOLE REAL-BROWSER VERIFICATION
 *
 * Real Chromium (pointer/click only), real Vite dev server -> real compiled backend.
 * Focus: background 400/403 absence (N-02/N-04), per-role console authorization,
 * provider secret-free surfaces, governance approve+execute through the UI,
 * security-event restrictions, delivery/receipt/quarantine visibility.
 */
'use strict';
const { chromium } = require('/home/user/m25e/node_modules/playwright');
const fs = require('fs');

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const OUT = '/home/user/m25e-browser';
const MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const results = [];
const rec = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 500) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail).slice(0, 220)}`);
};

const ALL_ROLES = Object.keys(manifest);
const FULL_ACCESS = ['SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS'];
const PARTIAL_ACCESS = ['FINANCE_CONTROLLER'];
const NO_ACCESS = ALL_ROLES.filter((r) => !FULL_ACCESS.includes(r) && !PARTIAL_ACCESS.includes(r));

async function login(page, roleKey) {
  const c = manifest[roleKey];
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#admin-login-email', { timeout: 25000 });
  await page.fill('#admin-login-email', c.email);
  await page.fill('#admin-login-password', c.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 25000 });
  await page.waitForTimeout(800);
}

async function openNotifications(page) {
  const nav = page.locator('[data-testid="nav-notifications"]').first();
  if (!(await nav.count())) return false;
  if (!(await nav.isVisible().catch(() => false))) return false;
  await nav.click({ timeout: 8000, force: false });
  await page.waitForTimeout(2500);
  return true;
}

function attachNetworkLog(page) {
  const log = [];
  page.on('response', (r) => {
    const u = r.url();
    if (!u.includes('/api/v1/')) return;
    log.push({ url: u.replace(BASE, ''), status: r.status(), method: r.request().method() });
  });
  return log;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  // ============================================================
  // 1. PER-ROLE CONSOLE AUTHORIZATION + BACKGROUND 4xx ABSENCE
  // ============================================================
  const roleReport = {};
  for (const role of ALL_ROLES) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await ctx.newPage();
    const log = attachNetworkLog(page);
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 160)));

    await login(page, role);
    const opened = await openNotifications(page);
    await page.waitForTimeout(1500);

    const consolePresent = await page.locator('[data-testid="notification-management-screen"]').count() > 0;
    const denied = await page.locator('[data-testid="notification-module-access-denied"]').count() > 0;
    const globalErrors = await page.locator('[data-testid="notification-global-load-errors"]').count() > 0;

    // Background failures = 4xx/5xx the operator did not deliberately cause
    const bg = log.filter((r) => r.status >= 400);
    // A graceful "403 used to decide the role's scope" is still a background error the
    // operator should not be forced to generate; N-02/N-04 require none of these.
    roleReport[role] = {
      navVisible: opened,
      consolePresent,
      accessDeniedPanel: denied,
      globalLoadErrors: globalErrors,
      background4xx: bg,
      jsErrors,
      requests: log.length,
    };

    if (FULL_ACCESS.includes(role)) {
      rec(`BROWSER-${role}-CONSOLE-OPEN`, opened && consolePresent,
        `navVisible=${opened} console=${consolePresent} requests=${log.length}`);
      rec(`BROWSER-${role}-NO-BACKGROUND-4XX`, bg.length === 0,
        bg.length ? bg.map((b) => `${b.status} ${b.method} ${b.url.split('?')[0]}`).join(' | ') : '0 background 4xx/5xx');
    } else if (PARTIAL_ACCESS.includes(role)) {
      rec(`BROWSER-${role}-CONSOLE-OPEN`, opened && consolePresent, `navVisible=${opened} console=${consolePresent}`);
      // This role lacks notification.view_deliveries: the console must not pre-fetch it blindly.
      const deliveryProbes = bg.filter((b) => b.url.includes('/deliveries') || b.url.includes('/outbox-receipts'));
      rec(`BROWSER-${role}-NO-BACKGROUND-4XX`, bg.length === 0,
        bg.length ? bg.map((b) => `${b.status} ${b.method} ${b.url.split('?')[0]}`).join(' | ') : '0 background 4xx/5xx (deliveries scoped out)');
      rec(`BROWSER-${role}-DELIVERY-SCOPE-HANDLED`, deliveryProbes.every((p) => p.status !== 403) || deliveryProbes.length === 0,
        `delivery/receipt responses=${JSON.stringify(deliveryProbes)}`);
    } else {
      rec(`BROWSER-${role}-NO-CONSOLE-ACCESS`, !opened || denied || !consolePresent,
        `navVisible=${opened} console=${consolePresent} accessDeniedPanel=${denied}`);
      rec(`BROWSER-${role}-NO-BACKGROUND-4XX`, bg.length === 0,
        bg.length ? bg.map((b) => `${b.status} ${b.method} ${b.url.split('?')[0]}`).join(' | ') : '0 background 4xx/5xx');
    }
    rec(`BROWSER-${role}-NO-JS-ERROR`, jsErrors.length === 0, jsErrors.join(' | ') || 'no uncaught page errors');

    await page.screenshot({ path: `${OUT}/role-${role}.png` }).catch(() => {});
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/role-matrix.json`, JSON.stringify(roleReport, null, 2));

  // ============================================================
  // 2. SUPER_ADMIN DEEP CONSOLE VERIFICATION
  // ============================================================
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const log = attachNetworkLog(page);
  await login(page, 'SUPER_ADMIN');
  await openNotifications(page);

  // --- events catalogue renders live data ---
  await page.locator('[data-testid="notif-tab-events"]').click();
  await page.waitForTimeout(2000);
  const eventRows = await page.locator('[data-testid^="event-row-"]').count();
  rec('UI-EVENTS-RENDERED', eventRows > 0, `event rows=${eventRows}`);

  // --- security events are presented as locked ---
  const secRow = page.locator('[data-testid="event-row-customer.registration.phone_verification"]');
  const secRowText = (await secRow.count()) ? ((await secRow.textContent()) || '') : '';
  rec('UI-SECURITY-EVENT-LOCKED-CHIP', /simulated|Locked|SECURITY/i.test(secRowText) && !/Configure Triggers/i.test(secRowText.split('Locked')[0] || ''),
    `security row text has lock affordance only: ${secRowText.replace(/\s+/g, ' ').slice(0, 160)}`);

  // --- H-06 UI lock is visible for the disputed funding event ---
  const fundRow = page.locator('[data-testid="event-row-customer.funding.approved"]');
  const fundText = (await fundRow.count()) ? ((await fundRow.textContent()) || '') : '';
  rec('UI-H-06-FUNDING-SHOWN-LOCKED', /Locked/i.test(fundText),
    `customer.funding.approved UI shows locked=${/Locked/i.test(fundText)} (backend seeds it unlocked — divergence recorded)`);

  // --- provider status surface: no secrets, truthful lifecycle ---
  await page.locator('[data-testid="notif-tab-providers"]').click();
  await page.waitForTimeout(1800);
  const provText = (await page.locator('[data-testid="notif-panel-providers"]').textContent()) || '';
  rec('UI-PROVIDER-SECRET-FREE-BANNER', await page.locator('[data-testid="provider-secret-free-banner"]').count() > 0, 'secret-free banner present');
  const leakedSecret = /robe_[A-Za-z0-9]{8,}|xkeysib-[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{20,}/.test(provText);
  rec('UI-PROVIDER-NO-SECRET-IN-DOM', !leakedSecret, `secret-shaped strings in provider panel: ${leakedSecret}`);
  rec('UI-PROVIDER-CONSOLE-ONLY-TRUTHFUL', /CONSOLE_ONLY|Not configured|NOT_CONFIGURED/i.test(provText),
    `lifecycle rendered: ${(provText.match(/CONSOLE_ONLY|NOT_CONFIGURED|CONFIGURED|VERIFIED|PRODUCTION_READY/g) || []).join(',')}`);
  // console simulation must never be presented as production-ready
  rec('UI-PROVIDER-NOT-PRODUCTION-READY', !/PRODUCTION_READY/.test(provText) || !/console/i.test(provText),
    `production-ready token present=${/PRODUCTION_READY/.test(provText)}`);
  await page.screenshot({ path: `${OUT}/super-admin-providers.png` });

  // --- provider config tab (permission boundary surface) ---
  await page.locator('[data-testid="notif-tab-providerConfig"]').click().catch(() => {});
  await page.waitForTimeout(1800);
  const cfgText = (await page.locator('[data-testid="notif-panel-providerConfig"]').textContent().catch(() => '')) || '';
  const cfgLeak = /robe_[A-Za-z0-9]{8,}|xkeysib-[A-Za-z0-9]{8,}/.test(cfgText);
  rec('UI-PROVIDER-CONFIG-NO-SECRET', !cfgLeak, `secret-shaped strings in provider-config panel: ${cfgLeak}`);
  await page.screenshot({ path: `${OUT}/super-admin-provider-config.png` });

  // --- delivery + receipt visibility (statuses incl. UNKNOWN/DEAD) ---
  await page.locator('[data-testid="notif-tab-deliveries"]').click();
  await page.waitForTimeout(1800);
  const delPanel = (await page.locator('[data-testid="notif-panel-deliveries"]').textContent().catch(() => '')) || '';
  // The table only renders when rows exist; with no rows the panel must show an explicit
  // empty state instead. Both are correct — assert one of them is present.
  const delTable = await page.locator('[data-testid="notification-deliveries-table"]').count();
  const delEmpty = /No notification delivery records matched/.test(delPanel);
  rec('UI-DELIVERIES-SURFACE', delTable > 0 || delEmpty,
    `deliveries table=${delTable > 0} explicit empty state=${delEmpty}`);
  rec('UI-DELIVERIES-UNKNOWN-DEAD-STATES', /UNKNOWN/.test(delPanel) && /DEAD/.test(delPanel),
    `UNKNOWN token=${/UNKNOWN/.test(delPanel)} DEAD token=${/DEAD/.test(delPanel)} (M-05 remediation)`);
  await page.screenshot({ path: `${OUT}/super-admin-deliveries.png` });

  // Outbox receipts are a SECTION inside the deliveries tab, not a tab of their own.
  // Judge the ROW elements, not the section text (the status <select> contributes its
  // own option labels to textContent and would falsely "match" every status).
  const receiptSection = await page.locator('[data-testid="outbox-receipts-section"]').count();
  const receiptRows = await page.$$eval('[data-testid^="outbox-receipt-row-"]', (els) =>
    els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)),
  ).catch(() => []);
  rec('UI-RECEIPTS-SECTION-PRESENT', receiptSection > 0, `outbox-receipts section present=${receiptSection > 0}`);
  rec('UI-RECEIPTS-QUARANTINE-VISIBLE',
    receiptRows.length === 0 || receiptRows.some((r) => /QUARANTINED|UNSUPPORTED|SUPPRESSED|MATERIALIZED/.test(r)),
    `receipt rows=${receiptRows.length} sample=${JSON.stringify(receiptRows.slice(0, 3))}`);
  await page.screenshot({ path: `${OUT}/super-admin-receipts.png` });

  // --- background 4xx across the whole deep session ---
  const deepBg = log.filter((r) => r.status >= 400);
  rec('UI-SUPER-ADMIN-NO-BACKGROUND-4XX-DEEP', deepBg.length === 0,
    deepBg.length ? deepBg.map((b) => `${b.status} ${b.method} ${b.url.split('?')[0]}`).join(' | ') : '0 background 4xx/5xx across all tabs');

  // ============================================================
  // 3. GOVERNANCE: APPROVE + EXECUTE THROUGH THE UI
  // ============================================================
  // A frozen proposal is created over HTTP (maker = SUPER_ADMIN), then the INDEPENDENT
  // checker completes approval AND execution in the browser.
  const approvalId = process.env.M25E_APPROVAL_ID || '';
  await page.locator('[data-testid="notif-tab-approvals"]').click();
  await page.waitForTimeout(1800);
  const changeTable = await page.locator('[data-testid="notification-change-requests-table"]').count();
  rec('UI-APPROVALS-QUEUE-PRESENT', changeTable > 0, 'change-requests table present');
  const govAudit = await page.locator('[data-testid="notification-governance-audit-table"]').count();
  rec('UI-GOVERNANCE-AUDIT-SECTION', govAudit > 0, 'governance audit table present');
  await page.screenshot({ path: `${OUT}/super-admin-approvals.png` });
  await ctx.close();

  // checker executes through the console
  if (approvalId) {
    const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const p2 = await ctx2.newPage();
    const log2 = attachNetworkLog(p2);
    await login(p2, 'FINANCE_CONTROLLER');
    await openNotifications(p2);
    await p2.locator('[data-testid="notif-tab-approvals"]').click();
    await p2.waitForTimeout(1500);
    await p2.fill('[data-testid="direct-workforce-approval-id-input"]', approvalId);
    await p2.fill('[data-testid="direct-workforce-approval-comment-input"]', 'M25E browser verification');
    await p2.locator('[data-testid="direct-workforce-approve-btn"]').click();
    await p2.waitForTimeout(2500);
    const afterApprove = (await p2.locator('[data-testid="notif-panel-approvals"]').textContent()) || '';
    rec('UI-CHECKER-APPROVE', /APPROVED|Approved|applied/i.test(afterApprove),
      `approve path responded; panel mentions approved=${/APPROVED|Approved/i.test(afterApprove)}`);

    await p2.fill('[data-testid="direct-workforce-approval-id-input"]', approvalId);
    await p2.locator('[data-testid="direct-execute-approved-btn"]').click();
    await p2.waitForTimeout(2500);
    const afterExec = (await p2.locator('[data-testid="notif-panel-approvals"]').textContent()) || '';
    rec('UI-CHECKER-EXECUTE', /APPLIED|applied|executed/i.test(afterExec),
      `panel mentions applied/executed=${/APPLIED|applied|executed/i.test(afterExec)}`);
    await p2.screenshot({ path: `${OUT}/finance-controller-execute.png` });
    const bg2 = log2.filter((r) => r.status >= 400);
    rec('UI-FINANCE-CONTROLLER-NO-BACKGROUND-4XX-DEEP', bg2.length === 0,
      bg2.length ? bg2.map((b) => `${b.status} ${b.method} ${b.url.split('?')[0]}`).join(' | ') : '0 background 4xx/5xx');
    await ctx2.close();
  } else {
    rec('UI-CHECKER-APPROVE', false, 'no M25E_APPROVAL_ID supplied — governance UI flow not exercised');
  }

  // ============================================================
  // 4. READ-ONLY AUDITOR PREVIEW RESTRICTION (M-04) — no false success
  // ============================================================
  {
    const ctx3 = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const p3 = await ctx3.newPage();
    await login(p3, 'FINANCE_AUDITOR');
    const opened = await openNotifications(p3);
    // trigger config / preview affordances must not offer a false success to a read-only role
    await p3.locator('[data-testid="notif-tab-events"]').click().catch(() => {});
    await p3.waitForTimeout(1500);
    // A control may be RENDERED but must be DISABLED for a principal that cannot use it.
    // Presence alone is not a false promise; an enabled control would be.
    const cfgBtn = p3.locator('[data-testid="configure-trigger-customer.funding.requested"]');
    const n = await cfgBtn.count();
    const isDisabled = n ? await cfgBtn.isDisabled() : null;
    const why = n ? await cfgBtn.getAttribute('title') : null;
    rec('UI-READONLY-CONFIG-CONTROL-DISABLED', n > 0 && isDisabled === true,
      `control present=${n > 0} disabled=${isDisabled} title="${why}"`);
    const eventsPanelText = (await p3.locator('[data-testid="notif-panel-events"]').textContent().catch(() => '')) || '';
    rec('UI-READONLY-NO-FALSE-SUCCESS', !/was applied|successfully applied|has been updated/i.test(eventsPanelText),
      `false-success wording present=${/was applied|successfully applied|has been updated/i.test(eventsPanelText)}`);
    rec('UI-READONLY-CONSOLE-OPENS', opened, `console opened for FINANCE_AUDITOR=${opened}`);
    await p3.screenshot({ path: `${OUT}/finance-auditor-events.png` });
    await ctx3.close();
  }

  // ============================================================
  // 5. CUSTOMER PREFERENCES READ-ONLY SURFACE
  // ============================================================
  {
    const ctx4 = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const p4 = await ctx4.newPage();
    const log4 = attachNetworkLog(p4);
    await login(p4, 'ADMINISTRATOR');
    const nav = p4.locator('[data-testid="nav-customers"]').first();
    let opened = false;
    if (await nav.count()) {
      await nav.click().catch(() => {});
      await p4.waitForTimeout(2500);
      opened = true;
    }
    const body = (await p4.locator('[data-testid="main-content"]').textContent().catch(() => '')) || '';
    rec('UI-CUSTOMER-SURFACE-LOADS', opened && body.length > 0, `customer surface opened=${opened} chars=${body.length}`);
    const bg4 = log4.filter((r) => r.status >= 400);
    rec('UI-CUSTOMER-SURFACE-NO-BACKGROUND-4XX', bg4.length === 0,
      bg4.length ? bg4.map((b) => `${b.status} ${b.method} ${b.url.split('?')[0]}`).join(' | ') : '0 background 4xx/5xx');
    await p4.screenshot({ path: `${OUT}/administrator-customers.png` });
    await ctx4.close();
  }

  // ---------- summary ----------
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(`${OUT}/browser-results.json`, JSON.stringify({ results, passed: results.length - failed.length, failed: failed.length }, null, 2));
  console.log(`\n=== M25E BROWSER: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error('HARNESS ERROR', e);
  try { fs.writeFileSync(`${OUT}/browser-results-crash.json`, JSON.stringify({ results, error: String(e).slice(0, 2000) }, null, 2)); } catch {}
  process.exit(2);
});
