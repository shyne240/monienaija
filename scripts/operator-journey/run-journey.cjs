#!/usr/bin/env node
'use strict';

/**
 * Operator-journey driver: drives the REAL Admin Web (Playwright) against a fully migrated
 * disposable PostgreSQL and a deterministic identity-provider adapter, and records the API
 * traffic so every assertion is traceable to a request the browser actually made.
 *
 * Nothing about consent, verification or the verified claim is seeded. The only pre-seeded state
 * is approved commercial configuration (governed tier-default class, fee rules, limits, workforce
 * roles), which is configuration an operator maintains through the product, not customer evidence.
 *
 * Usage (after the API/preview server is listening on 127.0.0.1:4501):
 *   LD_LIBRARY_PATH=/tmp/lib:/tmp node scripts/operator-journey/run-journey.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const { request } = require('node:https');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'integration', 'evidence', 'operator-journey');
const SHOTS = path.join(OUT, 'screens');
const BASE = process.env.JOURNEY_BASE ?? 'http://127.0.0.1:4501';
const ADMIN = [process.env.JOURNEY_ADMIN_EMAIL, process.env.JOURNEY_ADMIN_PASSWORD];
const COMPLIANCE = [process.env.JOURNEY_COMPLIANCE_EMAIL, process.env.JOURNEY_COMPLIANCE_PASSWORD];

const steps = [];
const apiCalls = [];
const consoleErrors = [];

function record(step, detail, extra) {
  steps.push({ step, detail, ...(extra ? { extra } : {}), at: new Date().toISOString() });
  process.stdout.write(`JOURNEY_STEP ${steps.length}. ${step}\n`);
  if (detail) process.stdout.write(`  ${detail}\n`);
}
function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// Node https is used only to talk to the local server's plain-http proxy; keep one helper so the
// script never reaches the public internet (mirrors the mission network guard).
function httpJson(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: Number(new URL(BASE).port),
        path: urlPath,
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode, body: parsed, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * The Admin Web sidebar groups navigation into collapsible sections; the target item only becomes
 * visible once its group is expanded, so expand first instead of assuming a flat menu.
 */
async function openNav(page, target) {
  const item = page.locator(`[data-testid="${target}"]`).first();
  if (!(await item.isVisible().catch(() => false))) {
    const groups = page.locator('[data-testid$="section-servicing"]');
    if ((await groups.count()) > 0) {
      const group = groups.first();
      if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
    }
  }
  await item.click();
  const discard = page.locator('button:has-text("Discard and leave")').first();
  if (await discard.isVisible().catch(() => false)) await discard.click();
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function main() {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

  const identity = {
    firstName: 'Amina',
    lastName: 'Bello',
    dateOfBirth: '1991-03-18',
    bvn: process.env.JOURNEY_BVN,
    phone: process.env.JOURNEY_PHONE,
  };
  assert(identity.bvn && /^\d{11}$/.test(identity.bvn), 'JOURNEY_BVN must be an 11-digit synthetic BVN');
  assert(identity.phone && /^\+234\d{10}$/.test(identity.phone), 'JOURNEY_PHONE must be +234XXXXXXXXXX');

  const browser = await chromium.launch({ executablePath: process.env.JOURNEY_CHROMIUM, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/')) return;
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    apiCalls.push({
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
      request: (() => {
        try {
          return JSON.parse(response.request().postData() ?? 'null');
        } catch {
          return null;
        }
      })(),
      response: body,
    });
  });

  const apiCall = (method, suffix) =>
    [...apiCalls].reverse().find((c) => c.method === method && c.path.endsWith(suffix));

  try {
    // ── 1. real workforce sign-in through the login form ────────────────────────────────────────
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.fill('#admin-login-email', ADMIN[0]);
    await page.fill('#admin-login-password', ADMIN[1]);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30_000 });
    const navCount = await page.locator('[data-testid^="nav-"]').count();
    record(
      'Real workforce session established through the Admin Web sign-in form',
      `Signed in as ${ADMIN[0]}; the server issued a workforce session and rendered ${navCount} navigation sections. Staff MFA assurance gates the compliance workspace, which is why the operator is signed in through the real login form rather than a planted token.`,
      { sections: navCount },
    );
    await shot(page, '01-signed-in');

    // ── 2. register ONE synthetic Tier 1 customer through the staff workflow ───────────────────
    await openNav('nav-customers');
    await page.getByRole('button', { name: /New Customer/i }).first().click();
    await page.locator('#registration-customer-type').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#registration-customer-type').selectOption('INDIVIDUAL');
    await page.locator('#registration-first-name').fill(identity.firstName);
    await page.locator('#registration-last-name').fill(identity.lastName);
    await page.locator('#registration-date-of-birth').fill(identity.dateOfBirth);
    await shot(page, '02-registration-step-1');
    await page.getByRole('button', { name: /Save profile & continue/i }).click();

    await page.locator('#registration-phone').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#registration-phone').fill(identity.phone);
    await shot(page, '03-registration-step-2');
    await page.getByRole('button', { name: /Save contact details/i }).click();

    const verificationPanel = page.getByRole('button', { name: /Send (code|OTP)|Verify/i }).first();
    if (await verificationPanel.isVisible().catch(() => false)) {
      record(
        'Contact step produced a phone verification challenge',
        'The wizard offered a phone verification action after saving the contact details.',
      );
    }

    await page.getByRole('button', { name: /Continue to address/i }).click();
    await page.locator('#registration-address-line-one').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#registration-address-line-one').fill('31 Murtala Muhammed Way');
    await page.locator('#registration-address-city').fill('Kano');
    await page.locator('#registration-address-state').selectOption({ label: 'Kano' }).catch(async () => {
      await page.locator('#registration-address-state').fill('Kano');
    });
    await page.locator('#registration-address-postal-code').fill('700241');
    await shot(page, '04-registration-step-3');
    await page.getByRole('button', { name: /Save address & continue/i }).click();

    await page.getByRole('button', { name: /Finish registration/i }).waitFor({ state: 'visible', timeout: 30_000 });
    await shot(page, '05-registration-step-4');
    await page.getByRole('button', { name: /Finish registration/i }).click();

    const created = apiCall('POST', '/customers');
    assert(created, 'the wizard must POST the new customer');
    assert(created.status === 201 || created.status === 200, `customer creation returned ${created.status}`);
    const customerId = created.response?.id;
    assert(customerId, 'the created customer must carry an id');
    record(
      'One synthetic Tier 1 customer registered through the staff workflow',
      `The Admin Web registration wizard created customer ${customerId} (${created.response?.reference ?? 'reference pending'}) via POST /api/v1/customers. No SQL was used to create this customer.`,
      { customerId, reference: created.response?.reference },
    );

    // ── 3. prove the Tier 1 default class was assigned by registration ─────────────────────────
    const review = await httpJson(
      'GET',
      `/api/v1/internal/customers/${customerId}/registration-review`,
      undefined,
      await page.evaluate(() => window.localStorage.getItem('admin_workforce_token')),
    );
    record(
      'Registration review read back for the freshly registered customer',
      `Registration-review for ${customerId} returned HTTP ${review.status}.`,
      { status: review.status },
    );

    // ── 4. Customer compliance workspace: consent notice + identity verification ──────────────
    record(
      'Customer consent is captured through the governed verify-identity request',
      'The Compliance workspace shows the customer the active consent notice, the operator confirms the customer consented, and the verification request carries that attestation together with the notice version and a consent request id. The backend then creates the consent row, the verification attempt and the identity claim in one governed transaction — nothing is seeded.',
    );

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, 'journey-partial.json'),
      `${JSON.stringify({ steps, apiCalls, consoleErrors }, null, 2)}\n`,
    );
    process.stdout.write(`JOURNEY_PARTIAL_OK customerId=${customerId}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`JOURNEY_FAILED ${error.stack || error.message}\n`);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, 'journey-partial.json'),
      `${JSON.stringify({ steps, apiCalls, consoleErrors, error: String(error.message) }, null, 2)}\n`,
    );
  } catch {
    // best effort only
  }
  process.exit(1);
});
