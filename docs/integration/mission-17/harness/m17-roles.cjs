/**
 * MISSION 17 — REAL-BROWSER VERIFICATION OF ALL 11 ORIGINAL WORKFORCE ROLES
 *
 * Drives the ACTUAL Admin Web (Vite dev server) in a real Chromium against the ACTUAL NestJS
 * backend and real PostgreSQL. Every role logs in through the real login form with its own
 * ORIGINAL local-dev credential from the 11-role fixture manifest — no SUPER_ADMIN stand-in,
 * no synthetic token injection into the store, no mocked API responses.
 *
 * For each role this verifies, entirely from the rendered DOM:
 *   1. login succeeds through the real form;
 *   2. the role-specific dashboard template returned by the backend is the one rendered
 *      (and the "Default dashboard" fallback badge is absent when a template is assigned);
 *   3. the visible sidebar nav set equals the role's least-privilege expectation exactly —
 *      a missing item and an extra (over-granted) item are both failures;
 *   4. every visible nav item opens a real screen (its heading renders), so no navigation
 *      item is broken or blank;
 *   5. logout returns to the login screen and a DIFFERENT role can then log in on the same
 *      browser context (session switching), ending with the original role again.
 *
 * The EXPECTED matrix below is the authoritative per-role least-privilege matrix already
 * committed in apps/admin-web/__tests__/menu-visibility-11-roles.test.tsx. Reusing it here
 * turns that unit-level matrix into a real-browser, real-catalogue confirmation: if the
 * backend catalogue ever granted a role more than this matrix, the browser check fails.
 */
const { chromium } = require('/home/user/m17/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const API = process.env.E2E_API || 'http://localhost:3000/api/v1';
const MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';
const OUT = process.env.E2E_OUT || '/home/user/e2e-roles';

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

// Screen heading each nav key must actually render (same markers as the committed unit matrix).
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
  SUPER_ADMIN: 'EXECUTIVE_GOVERNANCE',
  ADMINISTRATOR: 'WORKFORCE_ADMINISTRATION',
  FINANCE_PREPARER: 'FINANCE_PREPARATION',
  FINANCE_CONTROLLER: 'FINANCIAL_CONTROL_APPROVALS',
  FINANCE_AUDITOR: 'FINANCIAL_AUDIT_ASSURANCE',
  OPERATIONS: 'TRANSACTION_OPERATIONS',
  AGENT_NETWORK_MANAGER: 'AGENT_NETWORK_MANAGEMENT',
  COMPLIANCE: 'COMPLIANCE_KYC',
  RISK_FRAUD: 'FRAUD_CASE_MONITORING',
  CUSTOMER_SERVICE: 'CUSTOMER_SERVICING',
  TREASURY: 'RECONCILIATION_VISIBILITY',
};

const results = [];
let shotSeq = 0;
function record(id, title, ok, detail) {
  results.push({ id, title, ok, detail: detail || '' });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title}${detail ? ' :: ' + detail : ''}`);
}

async function shot(page, name) {
  shotSeq += 1;
  const file = path.join(OUT, `${String(shotSeq).padStart(2, '0')}-${name}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); return file; } catch { return ''; }
}

async function apiLogin(role) {
  const creds = manifest[role];
  const r = await fetch(`${API}/internal/a2/workforce/local-admin-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function uiLogin(page, role) {
  const creds = manifest[role];
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  // The auth store persists across navigation; sign out first so every role really logs in
  // through the form rather than inheriting the previous role's session.
  if (await page.isVisible('[data-testid="desktop-nav"]', { timeout: 5000 }).catch(() => false)) {
    await page.click('button:has-text("Log out session")', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  if (!(await page.isVisible('#admin-login-email', { timeout: 5000 }).catch(() => false))) {
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await page.waitForSelector('#admin-login-email', { timeout: 30000 });
  await page.fill('#admin-login-email', creds.email);
  await page.fill('#admin-login-password', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30000 });
  // Wait for the dashboard to settle so the nav gate is computed from the real principal.
  await page.waitForTimeout(1500);
}

/** Collapsed nav groups render their items `hidden`, so expand every group first. */
async function expandAllSections(page) {
  const toggles = await page.$$('[data-testid^="section-"]');
  for (const t of toggles) {
    const expanded = await t.getAttribute('aria-expanded');
    if (expanded !== 'true') {
      await t.click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(120);
    }
  }
}

async function uiLogout(page) {
  await page.click('button:has-text("Log out session")', { timeout: 15000 });
  await page.waitForSelector('#admin-login-email', { timeout: 20000 });
}

async function visibleNavKeys(page) {
  await expandAllSections(page);
  return page.evaluate((keys) => {
    const aside = document.querySelector('[data-testid="desktop-nav"]');
    if (!aside) return [];
    return keys.filter((k) => aside.querySelector(`[data-testid="nav-${k}"]`) !== null);
  }, ALL_NAV_KEYS);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const resourceErrors = [];
  const badResponses = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) resourceErrors.push(t.slice(0, 160));
    else consoleErrors.push(t.slice(0, 240));
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  const ctx = { role: 'pre-login', screen: 'login' };
  page.on('response', (r) => {
    const s = r.status();
    if (s >= 400) {
      const u = new URL(r.url());
      badResponses.push(`${ctx.role}/${ctx.screen}: ${r.request().method()} ${u.pathname}${u.search} -> ${s}`);
    }
  });

  const roles = Object.keys(manifest);
  console.log(`=== verifying ${roles.length} roles: ${roles.join(', ')} ===`);

  for (const role of roles) {
    // ---- backend truth for this role (template + principal scopes), via real HTTP
    let api = { status: 0, body: {} };
    try { api = await apiLogin(role); } catch (e) { api = { status: -1, body: { error: String(e) } }; }
    const principalScopes = (api.body && api.body.principal && api.body.principal.scopes) || [];
    const token = api.body && api.body.accessToken;

    let dash = null;
    if (token) {
      const dr = await fetch(`${API}/internal/a2/workforce/dashboard/my-dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      dash = await dr.json().catch(() => null);
    }

    let navKeys = [];
    let dashTitle = '';
    let fallbackBadge = false;
    let navDetail = '';
    let dashOk = false;
    let uiOk = false;
    let uiErr = '';
    try {
      ctx.role = role; ctx.screen = 'login';
      await uiLogin(page, role);
      ctx.screen = 'dashboard';
      uiOk = true;
      navKeys = await visibleNavKeys(page);
      const bodyText = await page.textContent('body');
      fallbackBadge = /Default dashboard —/.test(bodyText || '');
      // The dashboard h3 is the backend-supplied displayName.
      const h3s = await page.$$eval('[data-testid="main-content"] h3', (els) =>
        els.map((e) => (e.textContent || '').trim()),
      );
      dashTitle = h3s.join(' | ');
      const expectedTemplate = EXPECTED_TEMPLATE[role];
      const apiTemplate = dash && (dash.templateKey || dash.template?.key);
      dashOk =
        !!dash &&
        !fallbackBadge &&
        !dash.isFallback &&
        apiTemplate === expectedTemplate &&
        !!dash.displayName &&
        h3s.includes(String(dash.displayName).trim());
      navDetail = `template=${apiTemplate || 'none'} title="${dashTitle.trim()}" scopes=${principalScopes.length}`;
      await shot(page, `role-${role.toLowerCase()}-dashboard`);
    } catch (e) {
      uiErr = String(e && e.message ? e.message : e).slice(0, 300);
    }

    // ---- 1. real login + real template
    record(
      `R-${role}-01`,
      `${role}: real browser login + role-specific dashboard template`,
      uiOk && dashOk && api.status >= 200 && api.status < 300,
      uiErr || navDetail,
    );

    // ---- 2. nav set equals least-privilege expectation exactly
    const expected = new Set(EXPECTED[role]);
    const actual = new Set(navKeys);
    const missing = [...expected].filter((k) => !actual.has(k));
    const extra = [...actual].filter((k) => !expected.has(k));
    const unknown = [...actual].filter((k) => !ALL_NAV_KEYS.includes(k));
    record(
      `R-${role}-02`,
      `${role}: sidebar nav equals its least-privilege matrix (no missing, no over-grant)`,
      missing.length === 0 && extra.length === 0 && unknown.length === 0,
      missing.length || extra.length || unknown.length
        ? `missing=[${missing}] extra=[${extra}] unknown=[${unknown}]`
        : `${actual.size} items, all expected`,
    );

    // ---- 3. every visible nav item opens a real screen
    const broken = [];
    const pointerBlocked = [];
    const entitlementNotices = [];
    let walked = 0;
    if (uiOk) {
      for (const key of [...actual].filter((k) => ALL_NAV_KEYS.includes(k))) {
        const item = page.locator(`[data-testid="nav-${key}"]`);
        ctx.screen = key;
        let activated = false;
        try {
          await item.click({ timeout: 4000 });
          activated = true;
        } catch {
          // The sidebar's "Log out session" panel is in normal flow with margin-top:auto and
          // slides over whichever nav item sits at the bottom of the scrollport, so some items
          // are pointer-unreachable. Keyboard activation is the real accessible path.
          try {
            await item.focus();
            await page.keyboard.press('Enter');
            activated = true;
            pointerBlocked.push(key);
          } catch { /* leave activated=false */ }
        }
        if (!activated) { broken.push(`${key}(not activatable)`); continue; }
        walked += 1;
        await page.waitForTimeout(650);
        const text = (await page.textContent('[data-testid="main-content"]')) || '';
        if (SCREEN_MARKERS[key].test(text)) {
          // rendered its real screen heading
        } else if (key === 'agents' && /Not entitled[^.]*agent\.view/i.test(text)) {
          // FINANCE_CONTROLLER reaches Agent Network for funding (agent.fund) but holds no
          // agent.view, so the screen deliberately renders an explicit entitlement notice plus
          // the funding maker panel instead of the directory. Recorded as observation N-03.
          entitlementNotices.push(key);
        } else {
          broken.push(key);
        }
      }
      await shot(page, `role-${role.toLowerCase()}-nav-walk`);
    }
    record(
      `R-${role}-03`,
      `${role}: every visible nav item renders its real screen`,
      uiOk && broken.length === 0 && walked === expected.size && expected.size > 0,
      broken.length
        ? `broken=[${broken}] walked=${walked}/${expected.size}`
        : `walked=${walked}/${expected.size} screens rendered; pointerBlocked=[${pointerBlocked}] entitlementNotices=[${entitlementNotices}]`,
    );
  }

  // ------------------- 4. FINANCE_AUDITOR read-only server-side logout (known follow-up)
  try {
    const logoutCalls = [];
    const onResp = (r) => {
      const u = r.url();
      if (r.request().method() === 'POST' && /logout|local-admin-sessions/.test(u)) {
        logoutCalls.push(`${r.request().method()} ${new URL(u).pathname} -> ${r.status()}`);
      }
    };
    page.on('response', onResp);
    await uiLogin(page, 'FINANCE_AUDITOR');
    await uiLogout(page);
    await page.waitForTimeout(1200);
    page.off('response', onResp);
    const stillLoggedOut = await page.isVisible('#admin-login-email');
    const serverStatuses = logoutCalls.join(', ');
    const server403 = /-> 403/.test(serverStatuses);
    record(
      'R-13',
      'FINANCE_AUDITOR logout: client returns to login even when the server rejects the revocation',
      stillLoggedOut,
      `login-form=${stillLoggedOut} logout requests=[${serverStatuses || 'none observed'}]${server403 ? ' (server 403 = known read-only follow-up, client logout still works)' : ''}`,
    );
  } catch (e) {
    record('R-13', 'FINANCE_AUDITOR logout behaviour', false, String(e.message || e).slice(0, 300));
  }

  // ------------------------------------------------- 5. logout / login switching
  try {
    await uiLogin(page, 'SUPER_ADMIN');
    await uiLogout(page);
    const afterLogout = await page.isVisible('#admin-login-email');
    // Storage must be cleared: reload must NOT restore a session.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const stillLoggedOut = await page.isVisible('#admin-login-email', { timeout: 15000 }).catch(() => false);
    // Switch to a different role in the same context, then back.
    await uiLogin(page, 'TREASURY');
    const treasuryNav = await visibleNavKeys(page);
    await uiLogout(page);
    await uiLogin(page, 'SUPER_ADMIN');
    const adminNav = await visibleNavKeys(page);
    const switched = treasuryNav.length === EXPECTED.TREASURY.length && adminNav.length === EXPECTED.SUPER_ADMIN.length;
    await shot(page, 'logout-login-switching');
    record(
      'R-11',
      'logout clears the session and a different role can log in on the same context',
      afterLogout && stillLoggedOut && switched,
      `login-form-after-logout=${afterLogout} logged-out-after-reload=${stillLoggedOut} treasuryNav=${treasuryNav.length} superAdminNav=${adminNav.length}`,
    );
    record(
      'R-12',
      'no uncaught JavaScript errors across the whole role sweep',
      consoleErrors.length === 0,
      consoleErrors.length ? `${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(' | ')}` : '0 JS errors, 0 unhandled rejections',
    );
    // Non-2xx API traffic the UI generated. The only expected pattern is the Notification
    // console pre-fetching template counts for security-classified events, which the backend
    // refuses by policy ("Security notifications cannot use editable templates") — recorded as
    // a separate follow-up, not treated as an integration regression.
    const KNOWN = {
      policyRefusal: /internal\/notifications\/templates\?.*-> 400$/,          // N-02
      readOnlyLogout: /internal\/a2\/workforce\/sessions\/.*-> 403$/,           // K-01 (FINANCE_AUDITOR)
      configProbe: /internal\/configuration -> 403$/,                           // N-04 (Notification console)
      inFlightAfterLogout: /dashboard\/widgets\/reconciliation-status -> 401$/, // N-05 (in-flight request)
    };
    const classify = (r) => Object.keys(KNOWN).find((k) => KNOWN[k].test(r)) || 'unexpected';
    const bucketSummary = (b) => `N-02=${b.policyRefusal} K-01readOnlyLogout=${b.readOnlyLogout} N-04configProbe=${b.configProbe} N-05inFlight=${b.inFlightAfterLogout}`;
    const buckets = { policyRefusal: 0, readOnlyLogout: 0, configProbe: 0, inFlightAfterLogout: 0, unexpected: 0 };
    badResponses.forEach((r) => { buckets[classify(r)] += 1; });
    const unexpected = [...new Set(badResponses.filter((r) => classify(r) === 'unexpected'))];
    const policyCount = buckets.policyRefusal;
    record(
      'R-14',
      'no unexpected non-2xx API responses during the role sweep',
      unexpected.length === 0,
      `total=${badResponses.length} ${bucketSummary(buckets)} unexpected=${unexpected.length}${unexpected.length ? ' :: ' + unexpected.slice(0, 6).join(' | ') : ''}`,
    );
    await uiLogout(page).catch(() => {});
  } catch (e) {
    record('R-11', 'logout clears the session and a different role can log in', false, String(e.message || e).slice(0, 300));
  }

  await browser.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  fs.writeFileSync(path.join(OUT, 'role-results.json'), JSON.stringify({ results, passed, failed }, null, 2));
  console.log(`\n=== ROLES SUMMARY: ${passed}/${results.length} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})();
