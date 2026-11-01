/**
 * Mission 25H — real-browser verification of the Admin Web against the corrected backend.
 *
 * For each of the 11 seeded single-role workforce identities this drives the REAL login form,
 * the REAL notification console and the REAL Customer 360° preference panel in headless
 * Chromium, and records:
 *   - whether the notification console is reachable for that role
 *   - what the preference panel actually renders (values vs restricted vs 403 state)
 *   - every background HTTP 400/403/500 the page itself produced
 *   - every uncaught JS error / console error
 */
const fs = require('node:fs');
const { chromium } = require('playwright');

const APP = 'http://127.0.0.1:5173/';
const C1_REF = 'm25h-cust-0001';
const results = [];
let pass = 0;
let fail = 0;
const failures = [];

function record(group, name, ok, detail) {
  results.push({ group, name, ok, detail: detail ?? null });
  if (ok) {
    pass++;
    console.log(`PASS [${group}] ${name}`);
  } else {
    fail++;
    failures.push({ group, name, detail });
    console.log(`FAIL [${group}] ${name} — ${JSON.stringify(detail)}`);
  }
}

const PREFERENCE_RE = /\/customers\/[^/]+\/preferences/;

(async () => {
  const creds = JSON.parse(
    fs.readFileSync('/home/user/m25h-harness/monienaija-local-dev-11-roles-credentials.json', 'utf8'),
  );
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-gl=swiftshader'],
    headless: true,
  });

  const roleReports = [];
  const shotDir = '/home/user/m25h-harness/screenshots';
  fs.mkdirSync(shotDir, { recursive: true });

  for (const [role, cred] of Object.entries(creds)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    const http4xx5xx = [];
    const prefRequests = [];
    const jsErrors = [];

    page.on('response', async (res) => {
      try {
        const url = res.url();
        if (!url.includes('/api/v1')) return;
        const status = res.status();
        const entry = { url: url.replace(/^https?:\/\/[^/]+/, ''), status, method: res.request().method() };
        if (PREFERENCE_RE.test(url)) prefRequests.push(entry);
        if (status === 400 || status === 403 || status === 500 || status >= 502) http4xx5xx.push(entry);
      } catch {
        /* response already gone */
      }
    });
    page.on('pageerror', (err) => jsErrors.push(String(err.message).slice(0, 200)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        // Browser-emitted resource-load noise (e.g. favicon) is not an application error.
        if (!/favicon|Failed to load resource/i.test(t)) jsErrors.push(`console: ${t.slice(0, 200)}`);
      }
    });

    try {
      await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.fill('input[type="text"]', cred.email);
      await page.fill('input[type="password"]', cred.password);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30000 });

      const navVisible = await page.locator('[data-testid="nav-notifications"]').count();

      // ---- notification console ----
      let consoleState = 'NOT-EXPOSED';
      if (navVisible > 0) {
        await page.click('[data-testid="nav-notifications"]');
        await page.waitForTimeout(1500);
        const body = await page.locator('main, [role="main"], body').first().innerText();
        const forbidden = /not authorized|not permitted|permission|restricted|403/i.test(body);
        const hasConsole = /Notification|Deliver/i.test(body);
        consoleState = hasConsole && !forbidden ? 'CONSOLE' : `RESTRICTED:${body.slice(0, 80).replace(/\s+/g, ' ')}`;
        await page.screenshot({ path: `${shotDir}/${role}-notifications.png`, fullPage: false });
      }

      // ---- Customer 360 preference panel ----
      let prefPanel = 'NO-CUSTOMERS-VIEW';
      let prefValuesShown = false;
      let prefPanelText = '';
      let prefRequestCount = 0;
      const customersNav = await page.locator('[data-testid="nav-customers"]').count();
      if (customersNav > 0) {
        await page.click('[data-testid="nav-customers"]');
        await page.waitForTimeout(1200);
        const search = page.locator('#mn-dir-search');
        if ((await search.count()) > 0) {
          await search.fill(C1_REF);
          await page.waitForTimeout(1500);
          const openBtn = page.locator(`button[aria-label*="Open Customer 360"]`).first();
          if ((await openBtn.count()) > 0) {
            await openBtn.click();
            await page.waitForTimeout(2000);
            // The preference card lives on the "Personal information & contact" tab, not Overview.
            const tab = page.getByRole('tab', { name: /Personal information/i }).first();
            if ((await tab.count()) > 0) await tab.click();
            else {
              const tabBtn = page.locator('button', { hasText: /Personal information/i }).first();
              if ((await tabBtn.count()) > 0) await tabBtn.click();
            }
            await page.waitForTimeout(2500);
            const card = page.locator('[data-testid="customer-preferences-card"]');
            if ((await card.count()) > 0) {
              prefPanelText = (await card.innerText()).replace(/\s+/g, ' ').slice(0, 400);
              const denied = await page.locator('[data-testid="customer-preferences-denied"]').count();
              const restricted = await page.locator('[data-testid="customer-preferences-restricted"]').count();
              const section = await page.locator('[data-testid="customer-preferences-section"]').count();
              prefValuesShown = section > 0;
              prefPanel = denied > 0 ? 'DENIED-403' : restricted > 0 ? 'RESTRICTED-COPY' : section > 0 ? 'VALUES-SHOWN' : 'OTHER';
            } else {
              prefPanel = 'CARD-ABSENT';
            }
            await page.screenshot({ path: `${shotDir}/${role}-customer360.png`, fullPage: false });
          } else {
            prefPanel = 'CUSTOMER-NOT-FOUND';
          }
        }
      }
      prefRequestCount = prefRequests.length;

      roleReports.push({
        role,
        navNotificationsExposed: navVisible > 0,
        consoleState,
        prefPanel,
        prefValuesShown,
        prefPanelText,
        prefRequests,
        http4xx5xx,
        jsErrors,
      });

      // Expected model: no workforce role may render preference VALUES, and the page must never
      // produce a 500. A 403 from a role that still asks is a documented Arena 2 incompatibility,
      // recorded below rather than treated as a backend failure.
      record(
        'browser-preference-boundary',
        `${role}: preference values are never rendered for a workforce session`,
        !prefValuesShown,
        { prefPanel },
      );
      record('browser-errors', `${role}: no uncaught JS errors on the pages visited`, jsErrors.length === 0, {
        jsErrors,
      });
      record(
        'browser-errors',
        `${role}: no background HTTP 500 from the integrated surfaces`,
        http4xx5xx.every((e) => e.status !== 500 && e.status < 502),
        { errors: http4xx5xx.filter((e) => e.status >= 500) },
      );
      // A role that still asks must be shown the explicit refusal state, not a blank or a
      // false "empty" state — otherwise the UI would misrepresent the backend decision.
      if (prefRequests.length > 0) {
        record(
          'browser-preference-boundary',
          `${role}: the UI reflects the backend refusal (denied state, not empty/values)`,
          prefPanel === 'DENIED-403',
          { prefPanel, statuses: prefRequests.map((p) => p.status) },
        );
      }
    } catch (e) {
      roleReports.push({ role, error: String(e.message).slice(0, 300) });
      record('browser-drive', `${role}: pages drive without a harness/driver error`, false, {
        error: String(e.message).slice(0, 300),
      });
    }
    await context.close();
  }

  await browser.close();

  // Aggregate view across roles.
  const exposed = roleReports.filter((r) => r.navNotificationsExposed).map((r) => r.role);
  const valuesShown = roleReports.filter((r) => r.prefValuesShown).map((r) => r.role);
  const denied = roleReports.filter((r) => r.prefPanel === 'DENIED-403').map((r) => r.role);
  const restricted = roleReports.filter((r) => r.prefPanel === 'RESTRICTED-COPY').map((r) => r.role);
  const prefCallers = roleReports.filter((r) => (r.prefRequests || []).length > 0).map((r) => r.role);
  const all403 = roleReports.every((r) =>
    (r.prefRequests || []).every((p) => p.status === 403 || p.status === 404),
  );

  record('browser-summary', 'notification console reachable for at least one role (RBAC not collapsed)', exposed.length > 0, {
    rolesWithConsole: exposed,
  });
  record('browser-summary', 'no role renders preference values', valuesShown.length === 0, { valuesShown });
  record(
    'browser-summary',
    'every preference request the UI makes is refused (403/404) after the correction',
    all403,
    { rolesThatAsk: prefCallers },
  );

  // ---- documented frontend incompatibilities (assigned to Arena 2, NOT fixed here) ----
  const incompatibilities = [];
  const totalPreference403 = roleReports.reduce(
    (n, r) => n + (r.prefRequests || []).filter((p) => p.status === 403).length,
    0,
  );
  if (prefCallers.length > 0) {
    incompatibilities.push({
      id: 'F-25H-01',
      owner: 'Arena 2',
      severity: 'medium',
      summary:
        'Customer 360 preference panel still issues GET /customers/:id/preferences and /history for every OPERATOR/PRIVILEGED role holding customer.view. The corrected backend denies all workforce access, so each such visit now produces 4 x HTTP 403 (refused, no data).',
      rolesStillRequesting: prefCallers,
      observed403Count: totalPreference403,
      uiState: 'DENIED-403 (renders the documented 403 message; no preference values shown)',
      suggestedDirection:
        'Gate the panel on the approved policy (no workforce preference read today) so no request is emitted, or keep the request but replace it with a static "not available to workforce" state.',
    });
  }
  incompatibilities.push({
    id: 'F-25H-02',
    owner: 'Arena 2',
    severity: 'low',
    summary:
      'Stale copy: the restricted state reads "Preference visibility is restricted to authorized operational and privileged workforce roles with customer.view", and the panel/notification-management-api comments still describe the superseded OPERATOR/PRIVILEGED-with-customer.view visibility model. No workforce role can read preferences under the corrected policy.',
    evidence: roleReports
      .filter((r) => r.prefPanel === 'RESTRICTED-COPY')
      .map((r) => ({ role: r.role, text: r.prefPanelText })),
  });

  const out = {
    pass,
    fail,
    total: results.length,
    failures,
    totalPreference403,
    incompatibilities,
    exposedRoles: exposed,
    rolesShowingValues: valuesShown,
    rolesInDenied403State: denied,
    rolesInRestrictedCopyState: restricted,
    rolesThatStillRequestPreferences: prefCallers,
    roleReports,
    results,
  };
  fs.writeFileSync('/home/user/m25h-harness/browser-results.json', JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        exposedRoles: exposed,
        rolesShowingValues: valuesShown,
        denied,
        restricted,
        prefCallers,
        totals: `${pass}/${results.length}`,
      },
      null,
      1,
    ),
  );
  console.log(`\n=== BROWSER TOTALS: ${pass} passed / ${fail} failed / ${results.length} checks ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
