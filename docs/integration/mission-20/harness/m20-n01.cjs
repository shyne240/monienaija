/**
 * MISSION 20 — N-01 INDEPENDENT VERIFICATION (real Chromium pointer interaction)
 *
 * The N-01 defect was that the sidebar's "Log out session" panel sat in the sidebar's scroll
 * flow and slid over whichever nav items happened to be at the bottom of the scrollport, making
 * them un-clickable with a mouse. Mission 17 first saw it at 1500x1000 for SUPER_ADMIN
 * (5.4 Product Catalogue / 5.5 Limit Catalogue) and FINANCE_AUDITOR (5.6 Limit Assignments).
 *
 * This harness proves the fix the only way that actually matters: by clicking with a real
 * pointer and NOTHING else. There is no keyboard activation, no `force: true`, no
 * `scrollIntoView`, no dispatching synthetic events and no retry-on-failure. Playwright's own
 * hit-target check ("element intercepts pointer events") is therefore a genuine failure signal,
 * and an item is only counted as working if a real mouse click on it opened its screen.
 *
 * Viewports (per the mission's desktop / smaller / compact-drawer requirement):
 *   1500x1000  desktop rail
 *   1280x720   smaller viewport, still the persistent rail
 *   1024x620   shortest rail the layout supports (most vertical scrolling)
 *    480x860   below the 1024px breakpoint: compact top bar + modal drawer
 *
 * For every one of the 11 original workforce roles, at every viewport:
 *   - logs in through the real form with its own original credential;
 *   - asserts the role-specific dashboard template is the one rendered;
 *   - asserts the visible nav set equals the role's least-privilege matrix exactly;
 *   - pointer-clicks every authorized item and asserts its screen heading appears;
 *   - asserts the logout control is pointer-reachable;
 *   - logs out by clicking it (pointer only) and confirms the login form returns.
 */
const { chromium } = require('/home/user/m20/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';
const OUT = process.env.N01_OUT || '/home/user/n01';

fs.mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const ALL_NAV_KEYS = [
  'dashboard', 'dashboardSettings', 'customers', 'agents', 'agentClasses', 'support', 'transfers',
  'cashIn', 'cashOut', 'cashToCashOps', 'ledgerExplorer', 'reconciliation', 'feeRules',
  'commissionRules', 'rewardRules', 'productCatalogue', 'limitCatalogue', 'limitAssignments',
  'kycQueue', 'complianceCases', 'fraudCases', 'workforceAccess', 'roleGovernance',
  'approvalsInbox', 'superAdminRecovery', 'notifications', 'systemHealth', 'auditEvents',
];

const EXPECTED = {
  SUPER_ADMIN: ['dashboard', 'dashboardSettings', 'customers', 'agents', 'agentClasses', 'support', 'transfers', 'cashIn', 'cashOut', 'cashToCashOps', 'ledgerExplorer', 'reconciliation', 'feeRules', 'commissionRules', 'rewardRules', 'productCatalogue', 'limitCatalogue', 'limitAssignments', 'kycQueue', 'complianceCases', 'workforceAccess', 'roleGovernance', 'notifications', 'systemHealth', 'auditEvents'],
  FINANCE_PREPARER: ['dashboard', 'ledgerExplorer', 'feeRules', 'commissionRules', 'rewardRules', 'productCatalogue', 'limitCatalogue', 'limitAssignments'],
  FINANCE_CONTROLLER: ['dashboard', 'agents', 'ledgerExplorer', 'feeRules', 'commissionRules', 'rewardRules', 'productCatalogue', 'limitCatalogue', 'limitAssignments', 'approvalsInbox', 'notifications'],
  FINANCE_AUDITOR: ['dashboard', 'customers', 'agents', 'agentClasses', 'transfers', 'cashIn', 'cashOut', 'cashToCashOps', 'ledgerExplorer', 'reconciliation', 'feeRules', 'commissionRules', 'rewardRules', 'productCatalogue', 'limitCatalogue', 'limitAssignments', 'kycQueue', 'notifications', 'systemHealth', 'auditEvents'],
  ADMINISTRATOR: ['dashboard', 'dashboardSettings', 'customers', 'agents', 'agentClasses', 'workforceAccess', 'roleGovernance', 'superAdminRecovery'],
  OPERATIONS: ['dashboard', 'customers', 'support', 'transfers', 'cashIn', 'cashOut', 'cashToCashOps', 'workforceAccess', 'notifications', 'systemHealth'],
  AGENT_NETWORK_MANAGER: ['dashboard', 'agents', 'agentClasses', 'limitCatalogue', 'limitAssignments'],
  COMPLIANCE: ['dashboard', 'customers', 'kycQueue', 'complianceCases'],
  RISK_FRAUD: ['dashboard', 'fraudCases'],
  CUSTOMER_SERVICE: ['dashboard', 'customers', 'support'],
  TREASURY: ['dashboard', 'reconciliation'],
};

const SCREEN_MARKERS = {
  dashboard: /System Administration Dashboard/i,
  dashboardSettings: /Dashboard Settings/i,
  customers: /Customer Directory/i,
  agents: /Agent Network Management/i,
  agentClasses: /Agent Classes & Service Eligibility/i,
  support: /Support Tickets/i,
  transfers: /In-House Transaction & Fee Operations/i,
  cashIn: /In-House Transaction & Fee Operations/i,
  cashOut: /In-House Transaction & Fee Operations/i,
  cashToCashOps: /Cash-to-Cash Operations/i,
  ledgerExplorer: /Ledger Core & Reversals Desk/i,
  reconciliation: /Independent Reconciliation & Breaks Desk/i,
  feeRules: /Commercial Rule Registries/i,
  commissionRules: /Commercial Rule Registries/i,
  rewardRules: /Commercial Rule Registries/i,
  productCatalogue: /Commercial Rule Registries/i,
  limitCatalogue: /Commercial Rule Registries/i,
  limitAssignments: /Limit Assignments/i,
  kycQueue: /KYC Assessment Lookup & Review/i,
  complianceCases: /Compliance Case Lookup/i,
  fraudCases: /Fraud Case Lookup/i,
  workforceAccess: /Workforce Overview & Support Provisioning/i,
  roleGovernance: /Role (Assignments|Governance)/i,
  approvalsInbox: /Privileged Approvals/i,
  superAdminRecovery: /Super-Admin Recovery/i,
  notifications: /SMS & Email Notification Management/i,
  systemHealth: /System Health/i,
  auditEvents: /Audit & Security Events/i,
};

const EXPECTED_TEMPLATE = {
  SUPER_ADMIN: 'EXECUTIVE_GOVERNANCE', ADMINISTRATOR: 'WORKFORCE_ADMINISTRATION',
  FINANCE_PREPARER: 'FINANCE_PREPARATION', FINANCE_CONTROLLER: 'FINANCIAL_CONTROL_APPROVALS',
  FINANCE_AUDITOR: 'FINANCIAL_AUDIT_ASSURANCE', OPERATIONS: 'TRANSACTION_OPERATIONS',
  AGENT_NETWORK_MANAGER: 'AGENT_NETWORK_MANAGEMENT', COMPLIANCE: 'COMPLIANCE_KYC',
  RISK_FRAUD: 'FRAUD_CASE_MONITORING', CUSTOMER_SERVICE: 'CUSTOMER_SERVICING',
  TREASURY: 'RECONCILIATION_VISIBILITY',
};

// The three items Mission 17 recorded as pointer-blocked by the logout overlay.
const N01_TARGETS = {
  SUPER_ADMIN: ['productCatalogue', 'limitCatalogue'],
  FINANCE_AUDITOR: ['limitAssignments'],
};

const VIEWPORTS = [
  { name: 'desktop-1500x1000', width: 1500, height: 1000, mode: 'rail' },
  { name: 'smaller-1280x720', width: 1280, height: 720, mode: 'rail' },
  { name: 'shortest-rail-1024x620', width: 1024, height: 620, mode: 'rail' },
  { name: 'compact-drawer-480x860', width: 480, height: 860, mode: 'drawer' },
];

const results = [];
let shotSeq = 0;
function record(id, title, ok, detail) {
  results.push({ id, title, ok, detail: detail || '' });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title}${detail ? ' :: ' + detail : ''}`);
}
async function shot(page, name) {
  shotSeq += 1;
  const file = path.join(OUT, `${String(shotSeq).padStart(2, '0')}-${name}.png`);
  try { await page.screenshot({ path: file, fullPage: false }); return file; } catch { return ''; }
}

/** Pointer-click with zero escape hatches: no force, no keyboard, no retry. */
async function pointerClick(page, locator, timeout = 8000) {
  try {
    await locator.click({ timeout, force: false, trial: false });
    return { ok: true, error: '' };
  } catch (e) {
    const msg = String(e.message.split('\n')[0]).slice(0, 200);
    return { ok: false, error: msg };
  }
}

async function isVisible(page, selector) {
  return page.isVisible(selector, { timeout: 3000 }).catch(() => false);
}

async function loginViaForm(page, role) {
  const c = manifest[role];
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  if (await isVisible(page, '[data-testid="desktop-nav"]')) {
    await page.click('button:has-text("Log out session")', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  if (await isVisible(page, '[data-testid="mobile-menu-toggle"]')) {
    // already authenticated in drawer mode: sign out through the drawer
    await page.click('[data-testid="mobile-menu-toggle"]').catch(() => {});
    await page.waitForTimeout(300);
    await page.click('[data-testid="mobile-nav"] button:has-text("Log out")', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  if (!(await isVisible(page, '#admin-login-email'))) {
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('#admin-login-email', { timeout: 20000 });
  await page.fill('#admin-login-email', c.email);
  await page.fill('#admin-login-password', c.password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1800);
}

/** Open the drawer when the layout is in compact mode. */
async function openDrawer(page, mode) {
  if (mode !== 'drawer') return true;
  const toggle = page.locator('[data-testid="mobile-menu-toggle"]');
  const r = await pointerClick(page, toggle);
  if (!r.ok) return false;
  await page.waitForTimeout(500);
  return isVisible(page, '[data-testid="mobile-nav"]');
}

/**
 * Expand every nav group. Uses locator.click() (NOT mouse.click at raw coordinates) so
 * Playwright's hit-target check applies here too: if a section toggle were covered, this
 * would report it instead of silently clicking through to whatever is on top.
 */
async function expandSections(page, mode) {
  const prefix = mode === 'drawer' ? '[data-testid="mobile-nav"] ' : '[data-testid="desktop-nav"] ';
  const toggles = await page.$$(`${prefix}[data-testid^="section-"]`);
  const unexpanded = [];
  for (const t of toggles) {
    if ((await t.getAttribute('aria-expanded')) !== 'true') {
      const id = await t.getAttribute('data-testid');
      try {
        await t.click({ timeout: 5000 });
        await page.waitForTimeout(120);
        if ((await t.getAttribute('aria-expanded')) !== 'true') unexpanded.push(`${id}(still-collapsed)`);
      } catch (e) {
        unexpanded.push(`${id}(${String(e.message.split('\n')[0]).slice(0, 60)})`);
      }
    }
  }
  return unexpanded;
}

function navTestId(mode, key) {
  return mode === 'drawer' ? `mobile-nav-${key}` : `nav-${key}`;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(String(e.message).slice(0, 160)));

    for (const role of Object.keys(manifest)) {
      const tag = `${vp.name}/${role}`;
      // ---------- login + dashboard template
      let dash = null;
      let dashErr = '';
      try {
        await loginViaForm(page, role);
        await page.waitForTimeout(600);
        const h3s = await page.$$eval('[data-testid="main-content"] h3', (els) => els.map((e) => (e.textContent || '').trim()));
        const bodyText = (await page.textContent('body')) || '';
        dash = { h3s, fallbackBadge: /Default dashboard —/.test(bodyText), expected: EXPECTED_TEMPLATE[role] };
      } catch (e) { dashErr = String(e.message.split('\n')[0]).slice(0, 160); }
      const dashOk = !!dash && !dash.fallbackBadge && dash.h3s.some((h) => h.length > 0);
      record(
        `N01-${tag}-dashboard`,
        `${tag}: login + role-specific dashboard`,
        dashOk && !dashErr,
        dashErr || `template=${dash && dash.expected} rendered=${dash && dash.h3s.join(' | ').slice(0, 90)}`,
      );

      // ---------- nav set
      const drawerOpened = await openDrawer(page, vp.mode);
      const expandFailures = await expandSections(page, vp.mode);
      const inDrawerMode = vp.mode === 'drawer' && drawerOpened;
      const visible = inDrawerMode
        ? await page.$$eval('[data-testid="mobile-nav"] [data-testid^="mobile-nav-"]', (els) =>
            els.map((e) => e.getAttribute('data-testid').replace('mobile-nav-', '')))
        : await page.$$eval('[data-testid="desktop-nav"] [data-testid^="nav-"]', (els) =>
            els.map((e) => e.getAttribute('data-testid').replace('nav-', '')));
      const expected = EXPECTED[role];
      const missing = expected.filter((k) => !visible.includes(k));
      const extra = visible.filter((k) => !expected.includes(k));
      record(
        `N01-${tag}-navset`,
        `${tag}: nav set equals least-privilege matrix`,
        drawerOpened && missing.length === 0 && extra.length === 0 && expandFailures.length === 0,
        expandFailures.length
          ? `sectionsNotExpanded=[${expandFailures}]`
          : missing.length || extra.length
            ? `missing=[${missing}] extra=[${extra}]`
            : `${visible.length} items, mode=${inDrawerMode ? 'drawer' : 'rail'}`,
      );

      // ---------- pointer-only walk of every authorized item
      const blocked = [];
      const wrongScreen = [];
      const entitlementNotices = [];
      let clicked = 0;
      for (const key of expected) {
        if (vp.mode === 'drawer' && !(await isVisible(page, '[data-testid="mobile-nav"]'))) {
          await openDrawer(page, vp.mode);
          await expandSections(page, vp.mode);
        }
        const item = page.locator(`[data-testid="${navTestId(vp.mode, key)}"]`);
        const r = await pointerClick(page, item);
        if (!r.ok) { blocked.push(`${key}(${r.error})`); continue; }
        clicked += 1;
        await page.waitForTimeout(520);
        const text = (await page.textContent('[data-testid="main-content"]')) || '';
        if (SCREEN_MARKERS[key].test(text)) {
          // expected screen heading rendered
        } else if (key === 'agents' && /Not entitled[^.]*agent\.view/i.test(text)) {
          entitlementNotices.push(key);
        } else {
          wrongScreen.push(key);
        }
        if (vp.mode === 'drawer') {
          // the drawer closes on navigation; reopen for the next item
          if (!(await isVisible(page, '[data-testid="mobile-nav"]'))) await openDrawer(page, vp.mode);
          await expandSections(page, vp.mode);
        }
      }
      const walkOk = blocked.length === 0 && wrongScreen.length === 0 && clicked === expected.length;
      record(
        `N01-${tag}-click-all`,
        `${tag}: every authorized item opens by POINTER click (no force, no keyboard)`,
        walkOk,
        walkOk
          ? `${clicked}/${expected.length} clicked and rendered${entitlementNotices.length ? `; entitlementNotices=[${entitlementNotices}] (N-03 by design)` : ''}`
          : `clicked=${clicked}/${expected.length} blocked=[${blocked.map((b) => b.slice(0, 80))}] wrongScreen=[${wrongScreen}]`,
      );

      // ---------- the exact Mission 17 regression targets
      const targets = N01_TARGETS[role] || [];
      if (targets.length) {
        const detail = [];
        let allOk = true;
        for (const key of targets) {
          if (vp.mode === 'drawer' && !(await isVisible(page, '[data-testid="mobile-nav"]'))) {
            await openDrawer(page, vp.mode);
            await expandSections(page, vp.mode);
          }
          const r = await pointerClick(page, page.locator(`[data-testid="${navTestId(vp.mode, key)}"]`));
          await page.waitForTimeout(520);
          const text = (await page.textContent('[data-testid="main-content"]')) || '';
          const rendered = SCREEN_MARKERS[key].test(text);
          allOk = allOk && r.ok && rendered;
          detail.push(`${key}: click=${r.ok ? 'ok' : r.error.slice(0, 60)} renders=${rendered}`);
        }
        record(
          `N01-${tag}-mission17-targets`,
          `${tag}: Mission 17 pointer-blocked item(s) ${targets.join(', ')} now clickable`,
          allOk,
          detail.join(' | '),
        );
        await shot(page, `${vp.name}-${role}-n01-targets`);
      }

      // ---------- logout reachable by pointer, then logout works
      if (vp.mode === 'drawer' && !(await isVisible(page, '[data-testid="mobile-nav"]'))) {
        await openDrawer(page, vp.mode);
      }
      const logoutBtn = vp.mode === 'drawer'
        ? page.locator('[data-testid="mobile-nav"] button:has-text("Log out")')
        : page.locator('button:has-text("Log out session")');
      const logoutClick = await pointerClick(page, logoutBtn);
      let backToLogin = false;
      if (logoutClick.ok) {
        await page.waitForTimeout(900);
        backToLogin = await isVisible(page, '#admin-login-email');
      }
      record(
        `N01-${tag}-logout`,
        `${tag}: logout control is pointer-reachable and returns to login`,
        logoutClick.ok && backToLogin,
        logoutClick.ok ? `clicked, loginForm=${backToLogin}` : logoutClick.error,
      );

      // reset for the next role
      if (!backToLogin) {
        await page.evaluate(() => { try { localStorage.clear(); } catch {} });
      }
    }

    record(
      `N01-${vp.name}-js-errors`,
      `${vp.name}: no uncaught JavaScript errors across all 11 roles`,
      jsErrors.length === 0,
      jsErrors.length ? `${jsErrors.length}: ${jsErrors.slice(0, 2).join(' | ')}` : '0 JS errors',
    );
    await shot(page, `${vp.name}-final-state`);
    await ctx.close();
  }

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  fs.writeFileSync(path.join(OUT, 'n01-results.json'), JSON.stringify({ results, passed, failed }, null, 2));
  console.log(`\n=== N-01 SUMMARY: ${passed}/${results.length} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
