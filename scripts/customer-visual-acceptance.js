#!/usr/bin/env node
/**
 * Customer-mobile visual acceptance harness (Arena 3B Stage 9).
 *
 * Renders the customer app through Expo web and captures the acceptance screens at the mission's
 * reference viewport of 390 x 844, saving a persistent screenshot per screen.
 *
 * This harness is intentionally separate from the test suites: it is evidence capture, not a
 * substitute for them. It never asserts business behaviour and it never claims physical-device
 * acceptance — a browser viewport is not a handset.
 *
 * Usage:
 *   node scripts/customer-visual-acceptance.js \
 *     [--base-url http://127.0.0.1:8081] \
 *     [--out docs/integration/arena3b-visual-evidence]
 *
 * If the exported bundle is not already being served, run in another shell:
 *   cd apps/customer-mobile && npx expo export --platform web --output-dir ../../dist/customer-web
 *   npx serve dist/customer-web -l 8081
 */

const fs = require('node:fs');
const path = require('node:path');

const VIEWPORT = { width: 390, height: 844 };

/** Screens captured for the visual record, in the order a customer meets them. */
const SCREENS = [
  { id: 'unauth-welcome', label: 'Welcome / entry', wait: 800 },
  { id: 'unauth-login', label: 'Customer login (passcode)', wait: 800 },
  { id: 'unauth-registration', label: 'Registration', wait: 800 },
  { id: 'unauth-credential-rotation', label: 'First-login rotation', wait: 800 },
  { id: 'unauth-credential-recovery', label: 'Credential recovery', wait: 800 },
  { id: 'auth-home', label: 'Dashboard (home)', wait: 1200 },
  { id: 'auth-kyc-status', label: 'KYC status / tier', wait: 800 },
  { id: 'auth-add-money', label: 'Add money (safe unavailable where no rail)', wait: 800 },
  { id: 'auth-transaction-detail', label: 'Transaction detail / receipt', wait: 800 },
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const baseUrl = arg('base-url', 'http://127.0.0.1:8081');
  const outDir = path.resolve(arg('out', 'docs/integration/arena3b-visual-evidence'));

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error(
      'playwright is not installed in this workspace; run `npm i -D playwright` in the repository root.',
    );
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      `no headless browser binary is available (${String(error).split('\n')[0]}). ` +
        'Install it with `npx playwright install chromium` on a host that can reach ' +
        'cdn.playwright.dev, then re-run this harness.',
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  const rendered = [];
  for (const screen of SCREENS) {
    const url = `${baseUrl}/?screen=${encodeURIComponent(screen.id)}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(screen.wait);
    const file = path.join(outDir, `${screen.id}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const bodyText = (await page.textContent('body')) ?? '';
    rendered.push({ id: screen.id, label: screen.label, file, textLength: bodyText.trim().length });
  }

  const manifest = {
    capturedAt: new Date().toISOString(),
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    baseUrl,
    note: 'Expo web rendering at a 390x844 viewport. This is NOT physical-device acceptance.',
    screens: rendered,
    consoleErrors,
  };
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  await browser.close();
  process.stdout.write(
    `Captured ${rendered.length} screens at ${VIEWPORT.width}x${VIEWPORT.height} into ${outDir}\n`,
  );
  if (consoleErrors.length > 0) {
    process.stderr.write(`Console errors observed: ${consoleErrors.length}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
