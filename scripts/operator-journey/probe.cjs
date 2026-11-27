#!/usr/bin/env node
'use strict';

/** Exploratory probe: signs in as the real operator and reports the registration surfaces. */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'integration', 'evidence', 'operator-journey');
const BASE = process.env.JOURNEY_BASE ?? 'http://127.0.0.1:4501';

async function main() {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  fs.mkdirSync(OUT, { recursive: true });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.fill('#admin-login-email', 'admin@monienaija.local');
  await page.fill('#admin-login-password', 'MonieNaijaAdmin123!');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30_000 });

  const navIds = await page.$$eval('[data-testid^="nav-"]', (els) =>
    els.map((e) => e.getAttribute('data-testid')),
  );
  console.log('NAV:', JSON.stringify(navIds));

  // expand every collapsed group, then click customers
  const groups = await page.$$eval('[aria-expanded="false"]', (els) => els.length);
  console.log('collapsed groups:', groups);
  await page.locator('[data-testid="nav-customers"]').first().click({ force: true }).catch(async () => {
    const g = page.locator('[data-testid$="section-servicing"]').first();
    if (await g.count()) await g.click();
    await page.locator('[data-testid="nav-customers"]').first().click();
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'probe-customers.png') });

  const newCustomer = page.getByRole('button', { name: /New Customer/i });
  console.log('New Customer buttons:', await newCustomer.count());
  if (await newCustomer.count()) {
    await newCustomer.first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'probe-wizard.png') });
    const inputs = await page.$$eval('input,select,textarea', (els) =>
      els
        .map((e) => ({ id: e.id, name: e.getAttribute('name'), type: e.type, label: (e.labels?.[0]?.innerText ?? '').split('\n')[0] }))
        .filter((e) => e.id || e.name),
    );
    console.log('WIZARD FIELDS:', JSON.stringify(inputs, null, 1));
    const buttons = await page.$$eval('button', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    console.log('WIZARD BUTTONS:', JSON.stringify(buttons));

    // fill step 0 first
    await page.locator('#registration-customer-type').selectOption('INDIVIDUAL');
    await page.locator('#registration-first-name').fill('Amina');
    await page.locator('#registration-last-name').fill('Bello');
    await page.locator('#registration-date-of-birth').fill('1991-03-18');
    await page.locator('#registration-nationality').fill('NG').catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'probe-step1-filled.png') });
    const errs = await page.$$eval('[role="alert"],[id$="-error"],.cm-field-error', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    console.log('STEP1 ERRORS BEFORE:', JSON.stringify(errs));
    // step 0 -> create draft
    await page.getByRole('button', { name: /Create DRAFT & continue|Save profile & continue/i }).first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, 'probe-step2.png') });
    const f2 = await page.$$eval('input,select,textarea,button', (els) =>
      els.map((e) => ({ tag: e.tagName, id: e.id || null, type: e.type || null, text: (e.innerText || '').trim().slice(0, 40) })).filter((e) => e.id || (e.tag === 'BUTTON' && e.text)),
    );
    const errs2 = await page.$$eval('[role="alert"],[id$="-error"]', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    console.log('STEP2 ERRORS:', JSON.stringify(errs2));
    const controls2 = await page.$$eval('input,select,textarea', (els) => els.map((e) => e.id || e.getAttribute('name')).filter(Boolean));
    console.log('STEP2 CONTROLS:', JSON.stringify(controls2));
    const btn2 = await page.$$eval('button', (els) => els.map((e) => e.innerText.trim()).filter((t) => t && t.length < 40));
    console.log('STEP2 BUTTONS:', JSON.stringify(btn2));

    // step 1: phone + save
    await page.locator('#registration-phone-number').fill('8099110001');
    await page.waitForTimeout(400);
    const saveBtn = page.getByRole('button', { name: /Save contact details|Save & continue/i }).first();
    console.log('save contact visible:', await saveBtn.count());
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(3500);
    }
    await page.screenshot({ path: path.join(OUT, 'probe-step2-phone.png') });
    const btn3 = await page.$$eval('button', (els) => els.map((e) => e.innerText.trim()).filter((t) => t && t.length < 40));
    console.log('STEP2b BUTTONS:', JSON.stringify(btn3));
    const ctl3 = await page.$$eval('input,select,textarea', (els) => els.map((e) => e.id).filter(Boolean));
    console.log('STEP2b CONTROLS:', JSON.stringify(ctl3));
    const st3 = await page.$$eval('[role="status"],[role="alert"]', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    console.log('STEP2b STATUS:', JSON.stringify(st3));

    await page.getByRole('button', { name: /Send phone OTP/i }).first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, 'probe-otp.png') });
    const ctl4 = await page.$$eval('input,select,textarea', (els) => els.map((e) => e.id).filter(Boolean));
    console.log('OTP CONTROLS:', JSON.stringify(ctl4));
    const st4 = await page.$$eval('[role="status"],[role="alert"]', (els) => els.map((e) => e.innerText.trim()).filter(Boolean));
    console.log('OTP STATUS:', JSON.stringify(st4));
  }
  await browser.close();
}
main().catch((e) => {
  console.error('PROBE_FAILED', e.message);
  process.exit(1);
});
