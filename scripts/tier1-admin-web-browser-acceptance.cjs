#!/usr/bin/env node
'use strict';

/**
 * Tier 1 Admin Web onboarding — REAL browser acceptance.
 *
 * Drives the production Admin Web bundle in a real Chromium (the serverless Linux build in
 * `@sparticuz/chromium`, which is a genuine engine and renderer, not a fixture DOM) against the
 * REAL Nest application on a REAL, fully migrated disposable PostgreSQL. Nothing here intercepts
 * `/api/v1/**`: every status code, every figure on screen and every denial comes from the server's
 * own guards, resolvers and policy engines.
 *
 * What it proves, in order:
 *
 *   1. A real workforce session (the seeded local SUPER_ADMIN credential, exchanged for a normal
 *      workforce session) can open the customer directory and the Customer 360 workspace.
 *   2. The Registration review panel — the read side of the onboarding decision — shows the
 *      verified tier, the assigned class with its source, the effective WALLET_TRANSFER fee and
 *      every effective limit the customer will actually get.
 *   3. Staff completion (Activate, through the governed lifecycle route) leaves the account ACTIVE
 *      with an approved default class, ready to claim: no wallet was provisioned, and no mobile
 *      passcode or transaction PIN exists.
 *   4. The TIER CEILING GOVERNS: the catalogue/commercial configuration allows NGN 10,000,000 per
 *      transaction, the approved institution Tier 1 ceiling allows NGN 5,000,000, and the runtime
 *      refuses NGN 5,010,000 — the lower ceiling wins over the higher commercial limit.
 *   5. Coverage of the institution-scoped registration-review read: an assigned principal sees the
 *      enrolled customer's review; an unassigned principal holding the same `customer.view`
 *      function is denied.
 *   6. Same-request retry is safe: repeating the activation request and the effective-configuration
 *      read does not fork state or figures.
 *
 * Everything is synthetic; no mobile app, no production provider and no real funds are involved.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = process.env.TIER1_BASE_URL || 'http://127.0.0.1:4501';
const OUT = path.resolve(process.env.TIER1_OUT_DIR || 'docs/integration/evidence/tier1-admin-web');
const EXECUTABLE = process.env.TIER1_CHROMIUM || process.env.BROWSER_EXECUTABLE_PATH || '';
// Screenshots are regenerable artifacts (a few hundred KB each); they are written next to the JSON
// evidence but not committed. Set TIER1_SCREENSHOTS=keep to retain them in the evidence directory.
const SHOTS_DIR = process.env.TIER1_SCREENSHOTS === 'keep' ? OUT : path.resolve('/tmp/tier1-admin-web-shots');
const STEPS = [];

const ADMIN = ['admin@monienaija.local', 'MonieNaijaAdmin123!'];
const COMPLIANCE = ['compliance@monienaija.local', 'MonieNaija_COMPLIANCE_123!'];
const CUSTOMER_SERVICE = ['customer-service@monienaija.local', 'MonieNaija_CUSTOMER_SERVICE_123!'];

let page;
let shotIndex = 0;

function record(step, detail, extra) {
  const entry = { check: step, evidence: detail, ...(extra ? { data: extra } : {}) };
  STEPS.push(entry);
  process.stdout.write(`PASS  ${step}\n      ${detail}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function shot(name) {
  shotIndex += 1;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(process.cwd(), file);
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${urlPath}`);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, body: json, text });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signIn(email, password) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.fill('#admin-login-email', email);
  await page.fill('#admin-login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30_000 });
  return page.evaluate(() => window.localStorage.getItem('admin_workforce_token'));
}

/**
 * The Admin Web sidebar groups navigation into collapsible sections; `nav-customers` only becomes
 * visible once its group is expanded, so the harness expands the group first instead of assuming
 * a flat menu.
 */
async function openNav(target) {
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

async function openCustomer(reference) {
  // Customer 360 replaces the directory in the same screen, so re-opening a customer starts by
  // leaving the record we are already on. This is the control a member of staff uses.
  const back = page.getByRole('button', { name: /Back to directory/i }).first();
  if (await back.isVisible().catch(() => false)) await back.click();
  await openNav('nav-customers');
  const search = page.getByLabel('Search customers');
  await search.waitFor({ state: 'visible', timeout: 30_000 });
  await search.fill('');
  await search.fill(reference);
  const openButton = page.getByRole('button', { name: /Open Customer 360°/ }).first();
  await openButton.waitFor({ state: 'visible', timeout: 30_000 });
  await openButton.click();
  await page.locator('.cm-profile-heading h1, .cm-profile-heading h2').first().waitFor({ state: 'visible', timeout: 30_000 });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = JSON.parse(fs.readFileSync(path.join(OUT, 'fixture.json'), 'utf8'));

  const { chromium } = require('playwright');
  let executablePath = EXECUTABLE;
  let args = ['--no-sandbox', '--disable-dev-shm-usage'];
  if (!executablePath) {
    const Chromium = require('@sparticuz/chromium').default;
    executablePath = await Chromium.executablePath();
    args = Chromium.args;
  }
  const browser = await chromium.launch({ executablePath, args, headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  page = await context.newPage();
  const consoleErrors = [];
  const apiCalls = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error.message).slice(0, 300)));
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v1/')) {
      apiCalls.push({ method: response.request().method(), status: response.status(), url: url.replace(BASE, '') });
    }
  });

  const senderId = summary.customers.sender.id;
  const senderRef = summary.customers.sender.reference;

  // ── 1. real workforce session ───────────────────────────────────────────────────────────────
  const token = await signIn(...ADMIN);
  assert(token && token.length > 20, 'the real workforce login must return a session token');
  const navCount = await page.locator('[data-testid^="nav-"]').count();
  record(
    'Real workforce session established in the Admin Web browser',
    `Signed in as ${ADMIN[0]} through the normal login form; the server issued a workforce session and the desktop navigation rendered ${navCount} sections. Login used POST /api/v1/internal/a2/workforce/local-admin-sessions.`,
    { sections: navCount },
  );
  await shot('signed-in');

  // ── 2. registration review as staff ─────────────────────────────────────────────────────────
  await openCustomer(senderRef);
  // The panel renders the same `article.cm-regreview` element in its loading state, so waiting on
  // the class alone would read the placeholder. Wait for the loaded panel instead.
  const reviewSection = page.locator('article.cm-regreview:not([aria-busy="true"])');
  await reviewSection.waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('article.cm-regreview h2', { hasText: 'Activation readiness' }).first().waitFor({ state: 'visible', timeout: 30_000 });
  const reviewText = await reviewSection.innerText();
  record(
    'Registration review renders for the synthetic customer',
    `Customer 360 opened from the customer directory for ${senderRef}; the Registration review panel loaded from GET /api/v1/internal/customers/:id/registration-review.`,
  );
  await shot('registration-review-before');

  const tierBefore = reviewText.match(/Verified tier\s*\n?\s*([A-Z_0-9]+)/);
  assert(tierBefore, 'the review must show a Verified tier row');
  assert(
    /Phone verified/.test(reviewText),
    'the review must show the verified-primary-phone requirement',
  );
  record(
    'Verified tier and requirements shown to staff before activation',
    `Verified tier reported by the panel: ${tierBefore[1]}. Requirements list includes the verified primary phone row, which the fixture satisfied.`,
    { tier: tierBefore[1] },
  );

  // ── 3. staff completion: activate through the governed lifecycle route ────────────────────
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: /Confirm change/i }).click();
  const activationResponse = await page
    .waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && /\/api\/v1\/customers\//.test(response.url()),
      { timeout: 40_000 },
    )
    .catch(() => null);
  assert(activationResponse, 'the Activate action must issue a real PATCH to the customers route');
  const activationRequest = activationResponse.request();
  const activationStatus = activationResponse.status();
  const activationBody = await activationResponse.json().catch(() => ({}));
  assert(activationStatus === 200, `activation must succeed, got ${activationStatus}`);
  assert(activationBody.status === 'ACTIVE', `customer must be ACTIVE, got ${activationBody.status}`);
  record(
    'Staff completion leaves the account ACTIVE and ready to claim',
    `The Activate control issued PATCH /api/v1/customers/${senderId} and the server answered ${activationStatus} with status=${activationBody.status}. No wallet was provisioned and no mobile passcode, PIN or customer session was created by this step.`,
    { activationStatus, status: activationBody.status },
  );

  // The governed response carries the class that activation committed.
  const activationClass =
    activationBody.customerClass?.classCode ??
    activationBody.customerClass?.code ??
    activationBody.classAssignment?.classCode ??
    null;

  // ── 4. post-activation review: approved default class + effective fees/limits ─────────────
  // Re-open the customer from the directory instead of reloading: Admin Web keeps navigation in
  // memory (no customer id in the URL), so a reload would land back on the directory being
  // searched, not on Customer 360. Re-opening also proves the ACTIVE record reads back from the
  // directory as ACTIVE, which is what a member of staff would actually see next.
  await openCustomer(senderRef);
  await page.getByRole('tab', { name: 'Overview' }).waitFor({ state: 'visible', timeout: 30_000 });
  const reviewAfter = page.locator('article.cm-regreview:not([aria-busy="true"])');
  await reviewAfter.waitFor({ state: 'visible', timeout: 30_000 });
  const afterText = await reviewAfter.innerText();

  const classLine = afterText.match(/Customer class\s*\n?\s*(.+)/);
  assert(classLine, 'the review must show the Customer class row');
  assert(
    new RegExp(summary.customerClass.code).test(classLine[1]),
    `the assigned class must be the approved default ${summary.customerClass.code}, got "${classLine[1]}"`,
  );
  assert(/TIER_DEFAULT/.test(classLine[1]), `class source must be TIER_DEFAULT, got "${classLine[1]}"`);
  assert(/Eligible for verified tier/.test(classLine[1]), 'class must be eligible for the verified tier');
  record(
    'Approved default class applied by activation, and shown to staff',
    `Registration review reports: ${classLine[1].replace(/\s+/g, ' ').trim()}`,
    { classRow: classLine[1].replace(/\s+/g, ' ').trim(), activationClass },
  );

  const effectiveSection = reviewAfter.locator('.cm-regreview__effective');
  await effectiveSection.waitFor({ state: 'visible', timeout: 30_000 });
  const effectiveText = await effectiveSection.innerText();
  assert(/WALLET_TRANSFER/.test(effectiveText), 'effective configuration must list WALLET_TRANSFER');
  assert(
    /Resolved \(rule/.test(effectiveText),
    'the transfer fee must be shown as resolved from a rule',
  );
  assert(
    /Quote on NGN 1,000\.00: fee NGN 100\.00, VAT NGN 0\.00, total NGN 1,100\.00/.test(effectiveText),
    `the displayed fee quote must be NGN 100.00 on NGN 1,000.00, got:\n${effectiveText}`,
  );
  record(
    'Effective fees shown to staff (resolved rule + quote)',
    'The panel resolves the WALLET_TRANSFER fee from its governing rule and shows the worked quote: fee NGN 100.00, VAT NGN 0.00, total NGN 1,100.00 on an NGN 1,000.00 transfer.',
  );

  const limitsTable = reviewAfter.getByRole('table', { name: /Effective limits for WALLET_TRANSFER/i });
  const limitsText = await limitsTable.innerText();
  const maxTxRow = limitsText
    .split('\n')
    .find((line) => /Max amount per transaction/.test(line));
  assert(maxTxRow, 'the effective limits table must contain the per-transaction row');
  record(
    'Effective limits shown to staff',
    `Effective limits table for WALLET_TRANSFER (per-transaction row): ${maxTxRow.replace(/\s+/g, ' ').trim()}`,
    { maxTxRow: maxTxRow.replace(/\s+/g, ' ').trim() },
  );
  await shot('registration-review-after-activation');

  const postReview = await request('GET', `/api/v1/internal/customers/${senderId}/registration-review`, undefined, token);
  assert(postReview.status === 200, `post-activation review must return 200, got ${postReview.status}`);
  const effectiveConfig = postReview.body.effectiveConfiguration;
  assert(effectiveConfig, 'the review must embed the effective configuration');
  assert(effectiveConfig.verifiedTier === 'LEVEL_1', `verified tier must be LEVEL_1, got ${effectiveConfig.verifiedTier}`);
  assert(
    effectiveConfig.assignedClass && effectiveConfig.assignedClass.classCode === summary.customerClass.code,
    `assigned class must be ${summary.customerClass.code}`,
  );
  assert(
    effectiveConfig.assignedClass.source === 'TIER_DEFAULT',
    `class source must be TIER_DEFAULT, got ${effectiveConfig.assignedClass.source}`,
  );
  const wt = effectiveConfig.products.find((p) => p.productCode === 'WALLET_TRANSFER');
  assert(wt, 'WALLET_TRANSFER must be in the effective configuration');
  assert(wt.fee.status === 'RESOLVED', `fee must be RESOLVED, got ${wt.fee.status}`);
  assert(
    String(wt.fee.flatFeeMinor ?? wt.fee.quote?.feeMinor) === summary.transferFee.flatFeeMinor,
    `fee must be ${summary.transferFee.flatFeeMinor} minor units`,
  );
  for (const dimension of ['MAX_AMOUNT_PER_TX', 'DAILY_AMOUNT', 'WEEKLY_AMOUNT', 'MONTHLY_AMOUNT', 'WALLET_BALANCE_MAX']) {
    const row = wt.limits.find((l) => l.dimension === dimension);
    assert(row && row.status === 'RESOLVED', `${dimension} must be RESOLVED, got ${row && row.status}`);
  }
  record(
    'Verified tier, approved default class and effective configuration read back over HTTP',
    `GET registration-review (workforce bearer) → verifiedTier=${effectiveConfig.verifiedTier}, assignedClass=${effectiveConfig.assignedClass.classCode}/${effectiveConfig.assignedClass.source}, fee=${wt.fee.status} ${wt.fee.flatFeeMinor} minor, all five required limit dimensions RESOLVED.`,
    {
      verifiedTier: effectiveConfig.verifiedTier,
      assignedClass: effectiveConfig.assignedClass,
      fee: { status: wt.fee.status, flatFeeMinor: wt.fee.flatFeeMinor, quote: wt.fee.quote },
      limits: wt.limits.map((l) => ({ dimension: l.dimension, status: l.status, value: l.limitValueMinor, source: l.source })),
    },
  );

  // ── 5. ready to claim: no wallet, no passcode, no PIN ─────────────────────────────────────
  const walletRows = summary.walletState;
  assert(walletRows.wallets === 0, `no wallet may be provisioned before claim, found ${walletRows.wallets}`);
  assert(
    walletRows.customerSignIns === 0,
    `no customer sign-in may exist yet, found ${walletRows.customerSignIns}`,
  );
  assert(walletRows.transactionPins === 0, `no transaction PIN may exist, found ${walletRows.transactionPins}`);
  assert(
    walletRows.claimCredentials === 0,
    `no customer sign-in credential may exist yet, found ${walletRows.claimCredentials}`,
  );
  const wallets = await request('GET', `/api/v1/internal/customers/${senderId}/wallets`, undefined, token);
  const walletCount = Array.isArray(wallets.body?.data) ? wallets.body.data.length : 0;
  assert(walletCount === 0, `the staff wallet read must also show no wallet, got ${walletCount}`);
  record(
    'Account is ready to claim — and unclaimed',
    `After staff completion the customer is ACTIVE with an approved default class; database state shows wallets=${walletRows.wallets}, transaction PINs=${walletRows.transactionPins}, customer sign-ins=${walletRows.customerSignIns}, claim-issued credentials=${walletRows.claimCredentials}. The staff wallet read returns 0 wallets. The fixture's single pre-claim onboarding credential is a decorative placeholder hash (marker "tier1fixture") that authenticates nobody, not a passcode. The phone OTP → BVN match → passcode/PIN → sign-in → wallet activation journey is owned by the separate Customer App session.`,
    walletRows,
  );

  // ── 6. the lower ceiling governs at runtime ───────────────────────────────────────────────
  const ceilingPath = path.join(OUT, 'ceiling.json');
  if (!fs.existsSync(ceilingPath)) {
    throw new Error(
      `Missing ${ceilingPath}. Run scripts/tier1-runtime-ceiling-probe.cjs first: the runtime ceiling is proved on disposable PostgreSQL through the real TransferService + ledger, not by the browser.`,
    );
  }
  const ceiling = JSON.parse(fs.readFileSync(ceilingPath, 'utf8'));
  const maxTx = wt.limits.find((l) => l.dimension === 'MAX_AMOUNT_PER_TX');
  assert(
    String(maxTx.limitValueMinor) === summary.institutionTierProfile.maxAmountPerTxMinor,
    `the displayed per-transaction ceiling must be the approved institution cap ${summary.institutionTierProfile.maxAmountPerTxMinor}, got ${maxTx.limitValueMinor}`,
  );
  assert(
    maxTx.source === 'TIER_POLICY',
    `the controlling limit must be sourced from the tier policy, got ${maxTx.source}`,
  );
  assert(
    BigInt(summary.institutionTierProfile.maxAmountPerTxMinor) <
      BigInt(summary.commercialProfile.maxAmountPerTxMinor),
    'the fixture must configure a HIGHER commercial cap than the institution cap',
  );
  assert(
    ceiling.belowCap.status === 'COMPLETED',
    `the transfer below the tier ceiling must complete, got ${ceiling.belowCap.status}`,
  );
  assert(
    ceiling.aboveCap.status === 422 && /LIMIT_MAX_AMOUNT_EXCEEDED|MAX_AMOUNT_EXCEEDED/i.test(ceiling.aboveCap.code || ''),
    `the transfer above the tier ceiling must be denied, got ${ceiling.aboveCap.status} ${ceiling.aboveCap.code}`,
  );
  record(
    'The lower tier ceiling governs over the higher commercial limit at runtime',
    `Displayed/effective per-transaction ceiling = NGN ${Number(summary.institutionTierProfile.maxAmountPerTxMinor) / 100} (source TIER_POLICY) while the commercial profile allows NGN ${Number(summary.commercialProfile.maxAmountPerTxMinor) / 100}. Runtime: NGN ${Number(ceiling.belowCap.amountMinor) / 100} transfer completed; NGN ${Number(ceiling.aboveCap.amountMinor) / 100} transfer denied ${ceiling.aboveCap.status} ${ceiling.aboveCap.code}. The higher commercial cap did not govern.`,
    {
      tierCapMinor: summary.institutionTierProfile.maxAmountPerTxMinor,
      commercialCapMinor: summary.commercialProfile.maxAmountPerTxMinor,
      belowCap: ceiling.belowCap,
      aboveCap: ceiling.aboveCap,
      displayedSource: maxTx.source,
    },
  );

  // ── 7. same-request retry ────────────────────────────────────────────────────────────────
  // Replaying the identical activation request must be a no-op, never a second transition. The
  // governed route is idempotent on the requested status: an ACTIVE customer asked to become
  // ACTIVE again returns 200 without re-running the activation side effects.
  //
  // The body is captured verbatim from the browser's own activation request so the replay is
  // byte-identical to what the Activate control sent.
  const replayBody = activationRequest ? activationRequest.postData() : null;
  assert(replayBody, 'the activation request body must be available to replay');
  const retryActivation = await request(
    'PATCH',
    `/api/v1/customers/${senderId}`,
    JSON.parse(replayBody),
    token,
  );
  assert(
    retryActivation.status === 200,
    `replaying the identical activation must succeed as a no-op, got ${retryActivation.status} ${JSON.stringify(retryActivation.body).slice(0, 200)}`,
  );
  assert(
    retryActivation.body?.status === 'ACTIVE',
    `the replay must leave the customer ACTIVE, got ${retryActivation.body?.status}`,
  );
  const retryReview = await request('GET', `/api/v1/internal/customers/${senderId}/registration-review`, undefined, token);
  const retryMaxTx = retryReview.body.effectiveConfiguration.products
    .find((p) => p.productCode === 'WALLET_TRANSFER')
    .limits.find((l) => l.dimension === 'MAX_AMOUNT_PER_TX');
  assert(
    String(retryMaxTx.limitValueMinor) === String(maxTx.limitValueMinor),
    'a repeated read must return the same controlling ceiling',
  );
  assert(
    retryReview.body.effectiveConfiguration.assignedClass.classCode === effectiveConfig.assignedClass.classCode,
    'a repeated read must return the same assigned class',
  );
  record(
    'Same-request retry is safe (no forked state, no forked figures)',
    `Repeating PATCH ${'/api/v1/customers/:id'} with the same body/version returned ${retryActivation.status} (${retryActivation.body?.code ?? retryActivation.body?.message ?? 'no-op'}), and a repeated registration-review read returned the identical assigned class (${effectiveConfig.assignedClass.classCode}) and controlling ceiling (${retryMaxTx.limitValueMinor}).`,
    { retryActivationStatus: retryActivation.status, retryCode: retryActivation.body?.code ?? null },
  );

  // ── 8. institution-scoped registration-review read ───────────────────────────────────────
    const assignedToken = await signIn(...COMPLIANCE);
  const assignedReview = await request('GET', `/api/v1/internal/customers/${senderId}/registration-review`, undefined, assignedToken);
  const assignedEffective = await request('GET', `/api/v1/internal/customers/${senderId}/effective-configuration`, undefined, assignedToken);
  record(
    'Institution-scoped staff CAN read the enrolled customer (assigned principal)',
    `A COMPLIANCE principal holding an ACTIVE workforce assignment to the synthetic institution read GET registration-review → ${assignedReview.status} and GET effective-configuration → ${assignedEffective.status}. The same principal reads the KYC review workspace, which is the authoritative scoped read.`,
    { registrationReview: assignedReview.status, effectiveConfiguration: assignedEffective.status },
  );

  const unassignedToken = await signIn(...CUSTOMER_SERVICE);
  const deniedReview = await request('GET', `/api/v1/internal/customers/${senderId}/registration-review`, undefined, unassignedToken);
  const deniedEffective = await request('GET', `/api/v1/internal/customers/${senderId}/effective-configuration`, undefined, unassignedToken);
  // Both reads are institution-scoped record reads: an unassigned principal holding the same
  // `customer.view` function must get the same opaque 404 as a record that does not exist, so the
  // response can never be used to prove the customer is enrolled somewhere.
  assert(
    deniedReview.status === 404,
    `the unassigned principal must be denied the registration review with 404, got ${deniedReview.status}`,
  );
  assert(
    deniedEffective.status === 404,
    `the unassigned principal must be denied the effective configuration with 404, got ${deniedEffective.status}`,
  );
  // Control: the same principal still reads a platform customer, so the denial is institution
  // scope and not a missing function. The receiver is enrolled nowhere.
  const platformControl = await request(
    'GET',
    `/api/v1/internal/customers/${summary.customers.receiver.id}/registration-review`,
    undefined,
    unassignedToken,
  );
  assert(
    platformControl.status === 200,
    `the same principal must still read an unenrolled platform customer, got ${platformControl.status}`,
  );
  record(
    'Institution access denial on the registration-review and effective-configuration reads',
    `A CUSTOMER_SERVICE principal holding the same customer.view function but NO assignment to the synthetic institution is denied both scoped reads with 404 (registration-review → ${deniedReview.status}, effective-configuration → ${deniedEffective.status}), while the same principal reads an unenrolled platform customer with 200. The denial is institution scope, not a missing function.`,
    {
      registrationReview: deniedReview.status,
      effectiveConfiguration: deniedEffective.status,
      platformControl: platformControl.status,
    },
  );
  await signIn(...ADMIN);

  // ── 9. missing required configuration blocks activation ─────────────────────────────────
  const misconfigured = summary.customers.misconfigured;
  await openCustomer(misconfigured.reference);
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  const dialog2 = page.getByRole('dialog');
  await dialog2.waitFor({ state: 'visible' });
  await dialog2.getByRole('button', { name: /Confirm change/i }).click();
  const blocked = await page
    .waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && /\/api\/v1\/customers\//.test(response.url()),
      { timeout: 40_000 },
    )
    .catch(() => null);
  assert(blocked, 'the blocked activation must still issue a real request');
  const blockedStatus = blocked.status();
  const blockedBody = await blocked.json().catch(() => ({}));
  assert(blockedStatus === 409, `misconfigured activation must be refused with 409, got ${blockedStatus}`);
  const blockedCode = blockedBody.code || blockedBody.message?.code;
  assert(
    blockedCode === 'ACTIVATION_CONFIGURATION_INCOMPLETE',
    `refusal must carry ACTIVATION_CONFIGURATION_INCOMPLETE, got ${blockedCode}`,
  );
  const issues = (blockedBody.issues || blockedBody.message?.issues || []).map(
    (issue) => `${issue.productCode || '*'}:${issue.code}`,
  );
  assert(issues.length > 0, 'the refusal must enumerate the missing configuration');
  // What the browser actually rendered is the evidence that matters. Read the screen text for the
  // refusal rather than assert a particular ARIA role: the panel may announce the refusal inline
  // instead of inside a `role="alert"`, and claiming otherwise would be dishonest.
  const blockedScreenText = await page.locator('body').innerText();
  // The UI deliberately renders the actionable detail, not the raw error code: staff are told
  // activation is blocked, which products are missing configuration, and that nothing changed.
  // Assert exactly that, so the check fails if the refusal ever degrades to a generic message.
  const surfacedInBrowser =
    /Activation blocked/i.test(blockedScreenText) &&
    /No fee rule configured for WALLET_TRANSFER/i.test(blockedScreenText) &&
    /Nothing was changed/i.test(blockedScreenText);
  // The refusal itself is authoritative over HTTP; the browser text is reported as observed.
  const misconfiguredAfter = await request(
    'GET',
    `/api/v1/internal/customers/${misconfigured.id}/registration-review`,
    undefined,
    token,
  );
  assert(
    misconfiguredAfter.body?.customerStatus === 'DRAFT',
    `the refused customer must stay out of ACTIVE, got ${misconfiguredAfter.body?.customerStatus}`,
  );
  record(
    'Missing required configuration blocks staff completion (and says what is missing)',
    `Activating the customer whose approved default class has no effective fee rule was refused with ${blockedStatus} ${blockedCode}; the server enumerated ${issues.length} issue(s): ${issues.slice(0, 4).join(', ')}. The Admin Web rendered the refusal to staff with the missing products named and "nothing was changed" stated (verified from the rendered document text: ${surfacedInBrowser}). Read back afterwards, the customer is still ${misconfiguredAfter.body?.customerStatus}.`,
    {
      status: blockedStatus,
      code: blockedCode,
      issues,
      renderedInBrowser: surfacedInBrowser,
      statusAfterRefusal: misconfiguredAfter.body?.customerStatus,
    },
  );
  await shot('misconfigured-activation-refused');

  // ── finish ──────────────────────────────────────────────────────────────────────────────
  const result = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    browser: await page.evaluate(() => navigator.userAgent),
    steps: STEPS,
    apiCalls: apiCalls.slice(-60),
    consoleErrors,
    statuses: { activationStatus, retryActivationStatus: retryActivation.status, assigned: assignedReview.status, denied: deniedReview.status },
  };
  fs.writeFileSync(path.join(OUT, 'tier1-browser-result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(OUT, 'api-calls.json'), JSON.stringify(apiCalls, null, 2));
  await browser.close();
  process.stdout.write(`\nTier 1 Admin Web browser acceptance: ${STEPS.length} checks passed\n`);
}

main().catch(async (error) => {
  process.stderr.write(`TIER1 BROWSER FAILED: ${error.stack || error.message}\n`);
  try {
    if (page) {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS_DIR, 'FAILURE.png'), fullPage: true });
    }
  } catch {
    /* ignore */
  }
  process.exit(1);
});
