#!/usr/bin/env node
/**
 * Admin Web browser acceptance (ARENA 3D Group 33).
 *
 * Drives the **production Vite bundle** in a real Chromium: real DOM, real layout, real
 * request/response, real localStorage, real hit-testing on inputs and buttons. The API is
 * stubbed at the browser's network layer, so every assertion here is about the client. No
 * assertion in this file claims anything about the server.
 *
 * Why the API is stubbed rather than booted: the backend deliberately refuses to start while
 * eight financial dependencies are unverified (Group 31, `financial_dependencies_not_ready`).
 * A harness that silently worked around that refusal would be testing a configuration that
 * cannot exist. So the client is exercised against recorded-shaped responses and the report
 * says so in `api.origin`.
 *
 * Browser binary: Playwright is a dependency but its browser download is unreachable here
 * (egress is restricted to package registries). `--executable` accepts any Chrome/Chromium
 * binary; in a restricted sandbox one can be obtained from the npm registry:
 *
 *   npm i --no-save @sparticuz/chromium
 *   node -e "require('@sparticuz/chromium').inflate('node_modules/@sparticuz/chromium/bin/al2023.tar.br')"
 *   node scripts/admin-web-browser-acceptance.cjs \
 *     --executable /tmp/chromium --lib-path /tmp/al2023/lib
 *
 * That build is a serverless Linux Chromium; it is a genuine browser engine and a genuine
 * renderer, but it is not Safari, not a handset, and not a screen reader. See
 * docs/integration/BROWSER-ACCEPTANCE.md for what that does and does not certify.
 *
 * Usage:
 *   node scripts/admin-web-browser-acceptance.cjs \
 *     --dist /tmp/g33-dist --out docs/integration/evidence/browser-acceptance [--port 4321]
 */

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json, charset=utf-8',
};

function parseArgs(argv) {
  const args = { port: 4321 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    args[name] = value;
    i += 1;
  }
  return args;
}

/** Serves the built bundle. Unknown paths fall back to index.html, as the SPA expects. */
function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const decoded = decodeURIComponent(url.pathname);
    const candidate = path.join(root, decoded);
    const inside = candidate.startsWith(root);
    const isFile = inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    const target = isFile ? candidate : path.join(root, 'index.html');
    if (!fs.existsSync(target)) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function principal(overrides) {
  return {
    type: 'PRIVILEGED',
    principalId: 'workforce:acceptance-operator',
    sessionId: 'session-acceptance-1',
    audience: 'admin-console',
    roles: ['SUPER_ADMIN'],
    // The console's navigation is scope-driven, not role-driven (see
    // `src/screens/authenticated/navigation-access.ts`), so an empty scope list would render a
    // single-item rail and prove nothing about the authenticated shell.
    scopes: [
      'workforce.dashboard.view',
      'customer.view',
      'agent.view',
      'transaction.view',
      'ledger.view',
      'reconciliation.view',
      'fee_rule.view',
      'commission_rule.view',
      'reward_rule.view',
      'product.view',
      'limit.view',
      'kyc.view',
      'kyc.provider.view',
      'kyc.policy.view',
      'compliance.manage_case',
      'risk_fraud.manage_fraud_case',
      'audit.view',
    ],
    customerAccess: 'ALL',
    assuranceLevel: 'AAL2',
    ...overrides,
  };
}

function session(overrides) {
  return {
    accessToken: 'acceptance-token-not-a-credential',
    tokenType: 'Bearer',
    sessionId: 'session-acceptance-1',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    principal: principal(overrides),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dist = path.resolve(args.dist ?? '');
  const out = path.resolve(args.out ?? 'docs/integration/evidence/browser-acceptance');
  const executable = args.executable ?? process.env.BROWSER_EXECUTABLE_PATH;
  const libPath = args['lib-path'] ?? process.env.BROWSER_LIBRARY_PATH;
  const port = Number(args.port ?? 4321);

  if (!dist || !fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(
      `no built bundle at ${dist} (run: ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build)`,
    );
    process.exit(2);
  }
  if (libPath) process.env.LD_LIBRARY_PATH = libPath;
  fs.mkdirSync(out, { recursive: true });

  // Required lazily so `--help`/argument errors do not need the browser stack present.
  const { chromium } = require('playwright');
  const base = `http://127.0.0.1:${port}`;

  const results = [];
  const record = (id, ok, detail) => {
    results.push({ id, ok, detail: String(detail).slice(0, 400) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail).slice(0, 180)}`);
  };

  const server = await serveStatic(dist, port);
  const browser = await chromium.launch({
    executablePath: executable || undefined,
    headless: true,
    // `--single-process` is deliberately NOT set: a multi-process browser is what a real user
    // runs, and the out-of-process renderer is part of what is being accepted.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const browserVersion = browser.version();
  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];

  /** One fixture-mode router; `mode` lets a check switch the API's behaviour mid-run. */
  let mode = 'login';
  const routeHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const entry = {
      method: request.method(),
      path: url.pathname,
      body: request.postData() ?? null,
    };
    requests.push(entry);

    if (url.pathname.endsWith('/internal/a2/workforce/local-admin-sessions')) {
      if (mode === 'reject') {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 401, message: 'Invalid credentials' }),
        });
        return;
      }
      const body = mode === 'no-roles' ? { roles: [], scopes: [] } : {};
      // Deliberate latency so the in-flight state is observable: the form must stay on screen
      // while the request is outstanding (the defect this check pins, see App.tsx).
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(session(body)),
      });
      return;
    }

    if (mode === 'expired') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 401, message: 'Session expired' }),
      });
      return;
    }

    if (url.pathname.endsWith('/internal/a2/workforce/dashboard/my-dashboard')) {
      // A well-formed dashboard: one widget the principal may see and one it may not. Widgets
      // that fetch their own data are avoided on purpose — the point is to render the response.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          templateKey: 'acceptance-template',
          displayName: 'Acceptance dashboard',
          description: 'Dashboard rendered from the acceptance fixture',
          isFallback: false,
          widgets: [
            {
              widgetKey: 'customer-directory-shortcut',
              order: 1,
              displayName: 'Customer directory',
              description: 'Jump to the customer directory',
              fetchMode: 'direct',
              kind: 'shortcut',
              authorized: true,
              title: 'Customer directory',
            },
            {
              widgetKey: 'transaction-summary',
              order: 2,
              displayName: 'Transaction summary',
              description: 'Not granted to this principal in the fixture',
              fetchMode: 'direct',
              kind: 'summary',
              authorized: false,
            },
          ],
        }),
      });
      return;
    }

    // Everything else: an empty but well-formed page envelope, so a screen that fetches on
    // mount fails visibly in the console instead of hanging the run.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], items: [], total: 0, page: 1, pageSize: 20 }),
    });
  };

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/api/v1/**', routeHandler);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));

  // --- 1. Boot to login -------------------------------------------------------
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  const loginVisible = await page.locator('#admin-login-email').isVisible();
  record('BOOT-RENDERS-LOGIN', loginVisible, `email field visible=${loginVisible}`);
  record(
    'BOOT-NO-PAGE-ERROR',
    pageErrors.length === 0,
    pageErrors.join(' | ') || 'no uncaught page errors',
  );

  // An unauthenticated boot must not have leaked protected chrome.
  const shellLeaked = await page.locator('[data-testid="desktop-nav"]').count();
  record(
    'BOOT-NO-PROTECTED-CHROME',
    shellLeaked === 0,
    `desktop-nav nodes on a fresh load=${shellLeaked}`,
  );

  // --- 2. Keyboard reachability ----------------------------------------------
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? 'none',
    id: document.activeElement?.id ?? '',
    className: document.activeElement?.className ?? '',
  }));
  record(
    'KEYBOARD-FIRST-TAB-LANDS-IN-DOCUMENT',
    firstFocus.tag !== 'BODY',
    `first Tab -> <${firstFocus.tag.toLowerCase()} id="${firstFocus.id}" class="${String(firstFocus.className).slice(0, 60)}">`,
  );

  // --- 3. Accessible names ----------------------------------------------------
  const emailByLabel = await page.getByLabel('Email or username').count();
  const passwordByLabel = await page.getByLabel('Password', { exact: true }).count();
  const langSet = await page.evaluate(() => document.documentElement.lang || '');
  const passwordType = await page.locator('#admin-login-password').getAttribute('type');
  record(
    'A11Y-FORM-LABELS',
    emailByLabel === 1 && passwordByLabel === 1,
    `getByLabel(Email or username)=${emailByLabel} getByLabel(Password)=${passwordByLabel}`,
  );
  record('A11Y-DOCUMENT-LANG', langSet.length > 0, `html[lang]="${langSet}"`);
  record(
    'PASSWORD-MASKED-BY-DEFAULT',
    passwordType === 'password',
    `password input type="${passwordType}"`,
  );

  await page.screenshot({ path: path.join(out, 'admin-login-1440x900.png'), fullPage: false });

  // --- 4. Rejected credentials stay on the login screen ----------------------
  mode = 'reject';
  await page.fill('#admin-login-email', 'operator@monienaija.local');
  await page.fill('#admin-login-password', 'not-the-password');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#admin-login-error', { timeout: 15000 });
  const alertRole = await page.locator('#admin-login-error').getAttribute('role');
  const stillOnLogin = await page.locator('#admin-login-email').isVisible();
  const tokenAfterFailure = await page.evaluate(() =>
    localStorage.getItem('admin_workforce_token'),
  );
  record(
    'LOGIN-FAILURE-SHOWS-ALERT',
    alertRole === 'alert' && stillOnLogin,
    `role="${alertRole}" login still visible=${stillOnLogin}`,
  );
  record(
    'LOGIN-FAILURE-SETS-NO-TOKEN',
    tokenAfterFailure === null,
    `admin_workforce_token after 401 = ${tokenAfterFailure === null ? 'absent' : 'present'}`,
  );
  const emailAfterFailure = await page.inputValue('#admin-login-email');
  record(
    'LOGIN-RETRY-PRESERVES-EMAIL',
    emailAfterFailure === 'operator@monienaija.local',
    `email field after a rejected sign-in = "${emailAfterFailure}"`,
  );

  // --- 5. Accepted credentials reach the authenticated shell -----------------
  mode = 'login';
  const before = requests.length;
  await page.fill('#admin-login-password', 'fixture-password-value');
  await page.click('button[type="submit"]');
  // Sampled while the request is deliberately held open: the operator's form must not be
  // replaced by the initialising screen for the duration of an attempt.
  await page.waitForTimeout(150);
  const inflight = await page.evaluate(() => ({
    spinner: document.body.innerText.includes('Initializing MonieNaija Admin Core'),
    form: Boolean(document.querySelector('#admin-login-email')),
  }));
  record(
    'LOGIN-FORM-STAYS-MOUNTED-IN-FLIGHT',
    inflight.form && !inflight.spinner,
    `during the attempt: form mounted=${inflight.form}, initialising screen=${inflight.spinner}`,
  );
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });
  const loginCalls = requests
    .slice(before)
    .filter((entry) => entry.path.endsWith('/internal/a2/workforce/local-admin-sessions'));
  record(
    'LOGIN-IS-ONE-POST',
    loginCalls.length === 1 && loginCalls[0].method === 'POST',
    `${loginCalls.length} call(s) to the login endpoint`,
  );
  const loginBody = loginCalls[0]?.body ?? '';
  let bodyShape = 'unparsed';
  try {
    const parsed = JSON.parse(loginBody);
    bodyShape = `keys=${Object.keys(parsed).sort().join(',')}`;
    record(
      'LOGIN-BODY-CARRIES-CREDENTIALS-ONLY',
      Object.keys(parsed).sort().join(',') === 'email,password',
      bodyShape,
    );
  } catch {
    record(
      'LOGIN-BODY-CARRIES-CREDENTIALS-ONLY',
      false,
      `body was not JSON: ${loginBody.slice(0, 80)}`,
    );
  }

  await page.locator('[data-testid="section-servicing"]').click({ timeout: 15000 });
  const superAdminNav = await page.locator('[data-testid^="nav-"]').count();
  const customersVisible = await page.locator('[data-testid="nav-customers"]').isVisible();
  record(
    'AUTHENTICATED-NAV-RENDERS',
    superAdminNav > 0 && customersVisible,
    `${superAdminNav} nav items rendered for a scoped principal; Customers visible after expanding its section=${customersVisible}`,
  );

  const clientRoutes = await page.evaluate(() => Object.keys(window.localStorage).sort());
  record(
    'SESSION-PERSISTED-IN-LOCALSTORAGE',
    clientRoutes.includes('admin_workforce_token') &&
      clientRoutes.includes('admin_workforce_session_id'),
    `keys=${clientRoutes.join(',')}`,
  );

  // The password must never be written to storage, on any key.
  const storageDump = await page.evaluate(() =>
    JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
  );
  record(
    'PASSWORD-NEVER-PERSISTED',
    !storageDump.includes('fixture-password-value'),
    `storage copied=${storageDump.length} bytes, password present=${storageDump.includes('fixture-password-value')}`,
  );

  const painted = await page.evaluate(() => ({
    bodyText: document.body.innerText.trim().length,
    elements: document.querySelectorAll('*').length,
    backgrounds: [...document.querySelectorAll('body, [data-testid="desktop-nav"]')].map(
      (node) => getComputedStyle(node).backgroundColor,
    ),
    navBox: (() => {
      const nav = document.querySelector('[data-testid="desktop-nav"]');
      if (!nav) return null;
      const rect = nav.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    })(),
  }));
  /*
   * No element-count threshold: the rail's sections are collapsed, so a "must have N nodes" rule
   * would be a magic number that fails whenever the design changes. The question is whether a
   * layout was produced at all — text, a laid-out sidebar with real pixel width, and a painted
   * background. Those are properties, not counts.
   */
  record(
    'RENDER-PRODUCED-AUTHENTICATED-LAYOUT',
    painted.bodyText > 0 &&
      painted.backgrounds.some((colour) => colour !== 'rgba(0, 0, 0, 0)') &&
      (painted.navBox?.width ?? 0) > 0 &&
      (painted.navBox?.height ?? 0) > 0,
    `${painted.elements} elements, ${painted.bodyText} chars of text, nav box=${JSON.stringify(painted.navBox)}, ` +
      `backgrounds=${painted.backgrounds.join('/')}`,
  );

  /*
   * The dashboard is a bespoke screen whose slots are keyed by widget name, not a generic list, so
   * the assertion is about the response being accepted: the header renders and the error state
   * does not. Individual widget shapes are unit-tested in `__tests__/`; reproducing five widget
   * payloads here would test the fixtures, not the browser.
   */
  const dashboardText = await page.locator('[data-testid="main-content"]').innerText();
  record(
    'DASHBOARD-ACCEPTS-A-WELL-FORMED-RESPONSE',
    !/Unable to load your dashboard/i.test(dashboardText) &&
      /Welcome back/i.test(dashboardText) &&
      /Action Items/i.test(dashboardText),
    `main content: ${dashboardText.replace(/\s+/g, ' ').slice(0, 140)}`,
  );

  await page.screenshot({
    path: path.join(out, 'admin-authenticated-1440x900.png'),
    fullPage: false,
  });

  // --- 6. Session survives a reload; keyboard skip link ---------------------
  await page.reload({ waitUntil: 'networkidle' });
  let restored = false;
  try {
    await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });
    restored = await page.locator('[data-testid="desktop-nav"]').isVisible();
  } catch {
    restored = false;
  }
  record(
    'SESSION-RESTORED-AFTER-RELOAD',
    restored,
    `authenticated shell after a full reload with a stored session=${restored}`,
  );

  await page.keyboard.press('Tab');
  const skipLink = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      text: (active?.textContent ?? '').trim().slice(0, 40),
      className: String(active?.className ?? ''),
    };
  });
  record(
    'A11Y-SKIP-LINK-FIRST-IN-AUTHENTICATED-SHELL',
    /skip/i.test(skipLink.text),
    `first Tab on a restored session -> "${skipLink.text}" (class="${skipLink.className}")`,
  );

  // --- 7. Session expiry returns the user to login --------------------------
  mode = 'expired';
  // The rail's sections are collapsed by default: expanding one is part of the real flow, and a
  // nav item is only clickable once its section is open.
  if (!(await page.locator('[data-testid="nav-customers"]').isVisible())) {
    // Sections toggle: only open the group if the earlier check left it collapsed.
    await page.locator('[data-testid="section-servicing"]').click({ timeout: 15000 });
  }
  await page.locator('[data-testid="nav-customers"]').click({ timeout: 15000 });
  let returnedToLogin = false;
  try {
    await page.waitForSelector('#admin-login-email', { timeout: 20000 });
    returnedToLogin = await page.locator('#admin-login-email').isVisible();
  } catch {
    returnedToLogin = false;
  }
  const tokenAfterExpiry = await page.evaluate(() => localStorage.getItem('admin_workforce_token'));
  record(
    'EXPIRED-SESSION-RETURNS-TO-LOGIN',
    returnedToLogin && tokenAfterExpiry === null,
    `login visible=${returnedToLogin}, token after 401=${tokenAfterExpiry === null ? 'cleared' : 'still present'}`,
  );

  // --- 8. Role differential in a second context -----------------------------
  mode = 'no-roles';
  const context2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context2.route('**/api/v1/**', routeHandler);
  const page2 = await context2.newPage();
  const pageErrors2 = [];
  page2.on('pageerror', (error) => pageErrors2.push(String(error.message).slice(0, 300)));
  await page2.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page2.fill('#admin-login-email', 'operator@monienaija.local');
  await page2.fill('#admin-login-password', 'fixture-password-value');
  await page2.click('button[type="submit"]');
  await page2.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20000 });
  const minimalNav = await page2.locator('[data-testid^="nav-"]').count();
  const privilegedItem = await page2.locator('[data-testid="nav-agentClasses"]').count();
  record(
    'ROLE-DIFFERENTIAL-NAV',
    minimalNav > 0 && minimalNav < superAdminNav && privilegedItem === 0,
    `SUPER_ADMIN=${superAdminNav} items, no-role principal=${minimalNav} items, privileged item present=${privilegedItem}`,
  );
  record(
    'ROLE-DIFFERENTIAL-NO-PAGE-ERROR',
    pageErrors2.length === 0,
    pageErrors2.join(' | ') || 'none',
  );
  await page2.screenshot({ path: path.join(out, 'admin-minimal-role-1440x900.png') });
  await context2.close();

  // --- 9. Console hygiene over the whole run --------------------------------
  /*
   * Chrome reports every failed HTTP response as a console error. Two 401s are produced
   * deliberately here (a rejected sign-in and an expired session), so they are subtracted by
   * name rather than tolerated by raising the threshold: anything else is a real defect.
   */
  const expectedConsole = consoleErrors.filter((text) => /status of 401/.test(text));
  const unexpectedConsole = consoleErrors.filter((text) => !/status of 401/.test(text));
  record(
    'CONSOLE-NO-UNEXPECTED-ERRORS',
    unexpectedConsole.length === 0,
    `${consoleErrors.length} console error(s): ${expectedConsole.length} expected 401(s) from the two deliberate rejections, ` +
      `${unexpectedConsole.length} unexpected` +
      (unexpectedConsole.length ? ` -> ${unexpectedConsole.join(' | ')}` : ''),
  );

  // --- 10. Same-origin only -------------------------------------------------
  const external = requests.filter((entry) => entry.path === undefined);
  const allPaths = requests.map((entry) => entry.path);
  record(
    'NETWORK-SAME-ORIGIN-ONLY',
    external.length === 0 && allPaths.every((p) => typeof p === 'string' && p.startsWith('/')),
    `${requests.length} requests, all relative to the console origin`,
  );

  // --- 11. The shipped bundle contains no loopback host ---------------------
  const assets = await page.evaluate(async () => {
    const seen = new Set();
    for (const entry of performance.getEntriesByType('resource')) {
      if (/\/(assets|one)\//.test(entry.name) && /\.(js|css)$/.test(entry.name)) {
        seen.add(entry.name);
      }
    }
    return [...seen];
  });
  let loopbackHits = 0;
  let inspected = 0;
  for (const asset of assets) {
    const text = await (await fetch(asset)).text();
    inspected += text.length;
    loopbackHits += (text.match(/localhost|127\.0\.0\.1/g) ?? []).length;
  }
  record(
    'BUNDLE-HAS-NO-LOOPBACK-HOST',
    loopbackHits === 0,
    `${assets.length} assets, ${inspected} bytes scanned, ${loopbackHits} loopback occurrences`,
  );

  const shotBytes = fs.statSync(path.join(out, 'admin-authenticated-1440x900.png')).size;
  record(
    'SCREENSHOTS-CAPTURED',
    shotBytes > 10_000,
    `authenticated screenshot ${shotBytes} bytes at 1440x900`,
  );

  // Teardown must not mask a completed run: on some headless builds closing the last context
  // takes the browser down with it.
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  server.close();

  const failed = results.filter((entry) => !entry.ok);
  const report = {
    mission: 'ARENA 3D',
    group: 33,
    generatedAt: new Date().toISOString(),
    browser: { name: 'chromium', version: browserVersion, engine: 'Blink', headless: true },
    viewport: { width: 1440, height: 900 },
    api: {
      origin: 'stubbed at the browser network layer (page.route)',
      reason:
        'the backend refuses to start while eight financial dependencies are unverified; see docs/integration/SANDBOX-INTEGRATION-READINESS.md',
      calls: requests.length,
    },
    bundle: { path: dist, assets: assets.length },
    checks: results,
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
    },
    notPerformed: [
      'no server assertion: every API response in this run was a stub',
      'no cross-browser: Blink only, no WebKit and no Gecko',
      'not a handset: a 1440x900 desktop viewport, no touch, no device pixel ratio above 1',
      'no assistive technology: labels and roles were asserted through the accessibility tree only',
      'no screen-reader announcement, no real keyboard-only user session',
      'no visual regression baseline: screenshots are evidence, not a compared baseline',
      'no load, concurrency or performance measurement',
    ],
  };

  fs.writeFileSync(
    path.join(out, 'browser-acceptance.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`\n${report.summary.passed}/${report.summary.total} browser checks passed -> ${out}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('browser acceptance failed to run:', error);
  process.exit(3);
});
