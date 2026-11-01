/**
 * Mission 25K — independent 11-role real-browser verification of the integrated candidate.
 *
 * Adapted from the Mission 25H harness (`browser.cjs`) to the POST-25J Admin Web model, where the
 * Customer 360 preference surface renders a static enforced-restriction card and issues NO
 * customer-preference request of any kind. Every 25H assertion that expected a "denied"/"empty"/
 * "values" node has been inverted into the negative form required by the 25J correction, and the
 * panel-presence assertion is kept so the negative checks cannot pass vacuously.
 *
 * Drives the REAL login form, the REAL notification console and the REAL Customer 360 panel in
 * headless Chromium for each of the 11 single-role workforce identities, and records per role:
 *   - every /customers/:id/preferences request (method + status) — expected ZERO
 *   - every background HTTP 400/403/500 — expected ZERO
 *   - the exact preference-card text rendered
 *   - every uncaught JS error / console error
 */
const fs = require('node:fs');
const { chromium } = require('playwright');

const APP = 'http://127.0.0.1:5173/';
const C1_REF = 'm25h-cust-0001';
const EXPECTED_COPY =
  'Customer preferences are restricted to authenticated customers accessing their own records. Workforce preference access is not authorized.';

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

/** Any customer-scoped preference read or history read or mutation. */
const PREFERENCE_RE = /\/customers\/[^/]+\/preferences/;

(async () => {
  const creds = JSON.parse(
    fs.readFileSync('/home/user/m25k-harness/monienaija-local-dev-11-roles-credentials.json', 'utf8'),
  );
  const browser = await chromium.launch({
    executablePath: '/tmp/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-gl=swiftshader'],
    headless: true,
  });

  const roleReports = [];
  const navNotificationsExposed = [];
  const rolesWithCustomersNav = [];
  const rolesWithPanel = [];
  const rolesWithCorrectCopy = [];
  const prefRequestsAll = [];
  const forbiddenAll = [];
  const jsErrorsAll = [];

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
        const entry = {
          url: url.replace(/^https?:\/\/[^/]+/, ''),
          status,
          method: res.request().method(),
        };
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
        if (!/favicon|Failed to load resource/i.test(t)) jsErrors.push(`console: ${t.slice(0, 200)}`);
      }
    });

    const report = { role };
    try {
      await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.fill('input[type="text"]', cred.email);
      await page.fill('input[type="password"]', cred.password);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30000 });
      report.login = 'OK';

      const navVisible = await page.locator('[data-testid="nav-notifications"]').count();
      report.navNotificationsExposed = navVisible > 0;
      if (report.navNotificationsExposed) navNotificationsExposed.push(role);

      // ---- notification console (RBAC must stay unchanged / not collapsed) ----
      let consoleState = 'NOT-EXPOSED';
      if (navVisible > 0) {
        await page.click('[data-testid="nav-notifications"]');
        await page.waitForTimeout(1500);
        const body = await page.locator('main, [role="main"], body').first().innerText();
        const forbidden = /not authorized|not permitted|restricted|403/i.test(body);
        const hasConsole = /Notification|Deliver/i.test(body);
        consoleState = hasConsole && !forbidden ? 'CONSOLE' : `RESTRICTED:${body.slice(0, 80).replace(/\s+/g, ' ')}`;
        await page.screenshot({ path: `/home/user/m25k-harness/screenshots/${role}-notifications.png` });
      }
      report.consoleState = consoleState;

      // ---- Customer 360 personal-information preference panel ----
      let panelState = 'NO-CUSTOMERS-NAV';
      let cardText = '';
      let restrictedText = '';
      const customersNav = await page.locator('[data-testid="nav-customers"]').count();
      if (customersNav > 0) {
        rolesWithCustomersNav.push(role);
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
            const tab = page.getByRole('tab', { name: /Personal information/i }).first();
            if ((await tab.count()) > 0) await tab.click();
            else {
              const tabBtn = page.locator('button', { hasText: /Personal information/i }).first();
              if ((await tabBtn.count()) > 0) await tabBtn.click();
            }
            await page.waitForTimeout(2500);

            const card = page.locator('[data-testid="customer-preferences-card"]');
            if ((await card.count()) > 0) {
              rolesWithPanel.push(role);
              cardText = (await card.innerText()).replace(/\s+/g, ' ').trim();
              const restricted = page.locator('[data-testid="customer-preferences-restricted"]');
              restrictedText = (await restricted.count()) > 0
                ? (await restricted.first().innerText()).replace(/\s+/g, ' ').trim()
                : '';

              // Post-25J: the retired value/history/denied/empty nodes must NOT exist.
              const retiredNodes = {};
              for (const id of [
                'customer-preferences-section',
                'customer-preferences-denied',
                'customer-preferences-empty',
                'customer-preference-history-list',
              ]) {
                retiredNodes[id] = await page.locator(`[data-testid="${id}"]`).count();
              }
              const valueNodes = await page.locator('[data-testid^="customer-pref-"]').count();
              const cardButtons = await card.locator('button').count();
              const cardCheckboxes = await card.locator('input[type="checkbox"]').count();

              panelState = restrictedText ? 'RESTRICTED-COPY' : 'OTHER';
              report.retiredNodes = retiredNodes;
              report.valueNodes = valueNodes;
              report.cardButtons = cardButtons;
              report.cardCheckboxes = cardCheckboxes;

              record(
                'panel-structure',
                `${role}: no retired preference value/history/denied/empty node is rendered`,
                Object.values(retiredNodes).every((n) => n === 0) && valueNodes === 0,
                { retiredNodes, valueNodes },
              );
              record(
                'panel-structure',
                `${role}: restriction card exposes no mutation control (no button / checkbox)`,
                cardButtons === 0 && cardCheckboxes === 0,
                { cardButtons, cardCheckboxes },
              );
              record(
                'panel-copy',
                `${role}: renders the exact enforced self-service restriction policy copy`,
                restrictedText === EXPECTED_COPY,
                { restrictedText },
              );
              record(
                'panel-copy',
                `${role}: card makes no stale customer.view / "operational and privileged" claim`,
                !/customer\.view/i.test(cardText) &&
                  !/operational and privileged/i.test(cardText) &&
                  !/read-only/i.test(cardText),
                { cardText },
              );
              const leaked = /en-NG|SYSTEM|v\d|Enabled|Disabled|loginAlerts|NOTIFICATION_PREFERENCES/i.test(cardText);
              record('panel-copy', `${role}: no preference values or history rendered`, !leaked, {
                cardText: cardText.slice(0, 200),
              });
              if (restrictedText === EXPECTED_COPY) rolesWithCorrectCopy.push(role);
            } else {
              panelState = 'CARD-ABSENT';
            }
            // Scroll the preference card into view so the evidence screenshot contains it,
            // then capture both the viewport and an element-only card crop.
            try {
              await card.first().scrollIntoViewIfNeeded({ timeout: 5000 });
              await page.waitForTimeout(400);
            } catch {
              /* card detached — viewport shot below still records the page */
            }
            await page.screenshot({ path: `/home/user/m25k-harness/screenshots/${role}-customer360.png` });
            if ((await card.count()) > 0) {
              await card
                .first()
                .screenshot({ path: `/home/user/m25k-harness/screenshots/${role}-preference-card.png` })
                .catch(() => {});
            }
          } else {
            panelState = 'CUSTOMER-NOT-FOUND';
          }
        }
      }
      report.panelState = panelState;
      report.cardText = cardText;

      // Customer 360 must remain functional outside the preference card.
      if (panelState === 'RESTRICTED-COPY') {
        const body = await page.locator('main, [role="main"], body').first().innerText();
        record(
          'customer-360',
          `${role}: Customer 360 non-preference content still renders`,
          /Personal information|customer|Profile/i.test(body) && body.length > 200,
          { length: body.length },
        );
      }

      prefRequestsAll.push(...prefRequests.map((p) => ({ role, ...p })));
      forbiddenAll.push(...http4xx5xx.map((p) => ({ role, ...p })));
      jsErrorsAll.push(...jsErrors.map((p) => ({ role, error: p })));

      record(
        'preference-boundary',
        `${role}: issues ZERO customer-preference requests (no read, no history, no mutation)`,
        prefRequests.length === 0,
        { prefRequests },
      );
      record(
        'preference-boundary',
        `${role}: produces no unnecessary HTTP 403/400/500 on the surfaces visited`,
        http4xx5xx.length === 0,
        { http4xx5xx },
      );
      record('browser-errors', `${role}: no uncaught JS error / console error`, jsErrors.length === 0, {
        jsErrors,
      });
    } catch (e) {
      report.error = String(e.message).slice(0, 300);
      record('browser-drive', `${role}: pages drive without a harness/driver error`, false, {
        error: String(e.message).slice(0, 300),
      });
    }
    await context.close();
    roleReports.push(report);
  }

  await browser.close();

  // ---- aggregate view across the 11 roles ----
  record('summary', 'all 11 workforce roles were driven', roleReports.length === 11, {
    roles: roleReports.map((r) => r.role),
  });
  record(
    'summary',
    'ZERO customer-preference requests across all 11 roles (F-25H-01 closed)',
    prefRequestsAll.length === 0,
    { prefRequestsAll },
  );
  record('summary', 'ZERO HTTP 400/403/500 across all 11 roles', forbiddenAll.length === 0, {
    forbiddenAll,
  });
  record('summary', 'ZERO uncaught JS errors across all 11 roles', jsErrorsAll.length === 0, {
    jsErrorsAll,
  });
  record(
    'summary',
    'every role that reaches the Customer 360 panel shows the enforced restriction copy (F-25H-02 closed)',
    rolesWithPanel.length > 0 && rolesWithCorrectCopy.length === rolesWithPanel.length,
    { rolesWithPanel, rolesWithCorrectCopy },
  );
  record(
    'summary',
    'notification console RBAC is not collapsed (at least one role exposed, at least one withheld)',
    navNotificationsExposed.length > 0 && navNotificationsExposed.length < 11,
    { navNotificationsExposed },
  );

  const out = {
    pass,
    fail,
    total: results.length,
    failures,
    expectedCopy: EXPECTED_COPY,
    rolesDriven: roleReports.length,
    rolesWithCustomersNav,
    rolesWithPanel,
    rolesWithCorrectCopy,
    rolesWithoutPanel: roleReports.filter((r) => !rolesWithPanel.includes(r.role)).map((r) => r.role),
    navNotificationsExposed,
    totalPreferenceRequests: prefRequestsAll.length,
    prefRequestsAll,
    forbiddenResponses: forbiddenAll,
    jsErrors: jsErrorsAll,
    roleReports,
    results,
  };
  fs.writeFileSync('/home/user/m25k-harness/browser-results.json', JSON.stringify(out, null, 2));
  console.log(
    `=== BROWSER TOTALS: ${pass} passed / ${fail} failed / ${results.length} | prefRequests=${prefRequestsAll.length} 403s=${forbiddenAll.length} jsErrors=${jsErrorsAll.length} rolesWithPanel=${rolesWithPanel.length} ===`,
  );
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
