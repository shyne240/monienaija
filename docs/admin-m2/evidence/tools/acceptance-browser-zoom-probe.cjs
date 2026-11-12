// Capability probe only. Ctrl-plus delivered to headless-shell may not reach browser chrome.
// A smaller viewport, CSS transforms and pinch scaling are NOT treated as browser zoom.
const { chromium: playwright } = require('playwright-core');
const chromium = require('@sparticuz/chromium').default;
const fs = require('node:fs');
(async () => {
  const browser = await playwright.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let writes = 0;
  await page.route('**/api/v1/**', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({ status: 503, body: 'Synthetic service unavailable' });
  });
  await page.goto('http://127.0.0.1:5173/');
  const metrics = () => page.evaluate(() => ({ innerWidth, clientWidth: document.documentElement.clientWidth, devicePixelRatio, visualViewportWidth: visualViewport.width, visualViewportScale: visualViewport.scale }));
  const baseline = await metrics();
  // Default Chromium zoom levels: five increments reach 200%, eight reach 400%.
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+Equal');
  const afterFive = await metrics();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Equal');
  const afterEight = await metrics();
  const changed = JSON.stringify(baseline) !== JSON.stringify(afterFive) || JSON.stringify(afterFive) !== JSON.stringify(afterEight);
  const report = { browserVersion: browser.version(), environment: 'headless Chromium shell, no desktop display', baseline, afterFive, afterEight, changed, writes, conclusion: changed ? 'Metrics changed; verify the actual browser zoom setting before treating this as zoom evidence.' : 'No measurable browser zoom change. 200% and 400% actual browser zoom remain unverified.' };
  fs.writeFileSync('docs/admin-m2/evidence/acceptance-20261106/browser-zoom-capability.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
