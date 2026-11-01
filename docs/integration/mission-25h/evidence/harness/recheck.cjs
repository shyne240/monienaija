const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const creds = JSON.parse(fs.readFileSync('monienaija-local-dev-11-roles-credentials.json', 'utf8'));
  const b = await chromium.launch({ executablePath: '/tmp/chrome/chromium', args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=swiftshader'], headless: true });
  const p = await (await b.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
  await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await p.fill('input[type="text"]', creds.SUPER_ADMIN.email);
  await p.fill('input[type="password"]', creds.SUPER_ADMIN.password);
  await p.click('button[type="submit"]');
  await p.waitForSelector('[data-testid="desktop-nav"]');
  await p.click('[data-testid="nav-notifications"]');
  await page_wait(p, 2000);
  await p.getByRole('tab', { name: /Deliveries & Retries/i }).click();
  await p.waitForTimeout(2500);

  const section = p.locator('[data-testid="outbox-receipts-section"]');
  const out = { sectionPresent: (await section.count()) > 0 };
  const sel = p.locator('[data-testid="outbox-receipt-status-select"]');
  out.selectOptions = (await sel.locator('option').allInnerTexts()).map(s => s.trim());

  // Apply the QUARANTINED filter exactly as the 25E recheck did.
  await sel.selectOption('QUARANTINED');
  await p.waitForTimeout(2500);

  // (a) the 25E method: whole-section textContent
  out.sectionTextContentHasMaterialized = /MATERIALIZED/i.test(await section.innerText());
  // (b) the correct method: only the data rows
  const rows = p.locator('[data-testid="outbox-receipts-table"] tbody tr');
  const rc = await rows.count();
  out.receiptRowCount = rc;
  out.rowTexts = [];
  for (let i = 0; i < rc; i++) out.rowTexts.push((await rows.nth(i).innerText()).replace(/\s+/g, ' ').slice(0, 200));
  out.rowsContainingMaterialized = out.rowTexts.filter(t => /MATERIALIZED(?!_)/i.test(t) && !/QUARANTINED/i.test(t)).length;
  out.allRowsAreQuarantined = rc > 0 && out.rowTexts.every(t => /QUARANTINED/i.test(t));

  // Where does the false positive come from? Locate the option element itself.
  out.materializedOptionPresent = out.selectOptions.some(o => /^MATERIALIZED$/i.test(o));

  await p.screenshot({ path: 'screenshots/receipts-quarantined-filter.png', fullPage: false });
  fs.writeFileSync('recheck-results.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1).slice(0, 1600));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
function page_wait(p, ms) { return p.waitForTimeout(ms); }
