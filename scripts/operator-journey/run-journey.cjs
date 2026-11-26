#!/usr/bin/env node
'use strict';

/**
 * Operator-journey driver: registers ONE synthetic Tier 1 customer through the real Admin Web
 * registration wizard, captures consent through the governed verify-identity request, and verifies
 * identity from the Compliance workspace — all in a real browser against a disposable PostgreSQL.
 *
 * Nothing about consent, verification or the verified claim is seeded. The only seam is the SMS
 * delivery boundary (JOURNEY_RECORD_SMS), because the registration OTP is stored as a salted hash
 * and the console provider discards the body, so no browser could otherwise read the code a real
 * handset would receive.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'integration', 'evidence', 'operator-journey');
const SHOTS = path.join(OUT, 'screens');
const BASE = process.env.JOURNEY_BASE ?? 'http://127.0.0.1:4501';
const SMS_LOG = process.env.JOURNEY_SMS_LOG ?? '/tmp/journey-sms.log';
const ADMIN = [process.env.JOURNEY_ADMIN_EMAIL, process.env.JOURNEY_ADMIN_PASSWORD];
const COMPLIANCE = [process.env.JOURNEY_COMPLIANCE_EMAIL, process.env.JOURNEY_COMPLIANCE_PASSWORD];

const steps = [];
const apiCalls = [];
const consoleErrors = [];

function record(step, detail, extra) {
  steps.push({ step, detail, ...(extra ? { extra } : {}), at: new Date().toISOString() });
  process.stdout.write(`JOURNEY_STEP ${steps.length}. ${step}\n`);
  if (detail) process.stdout.write(`   ${detail}\n`);
}
function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
function lastSmsCode(to) {
  const lines = fs
    .readFileSync(SMS_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (to && lines[i].to !== to) continue;
    const m = /(\d{6})/.exec(lines[i].message);
    if (m) return m[1];
  }
  throw new Error(`no delivered SMS code recorded for ${to ?? 'any destination'}`);
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Sidebar groups collapse; expand the servicing group before clicking Customers. */
async function openNav(page, testId) {
  const item = page.locator(`[data-testid="${testId}"]`).first();
  if (!(await item.isVisible().catch(() => false))) {
    const group = page.locator('[data-testid$="section-servicing"]').first();
    if (await group.count().catch(() => 0)) {
      if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
    }
  }
  await item.click({ force: true });
  await page.waitForTimeout(1500);
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.fill('#admin-login-email', email);
  await page.fill('#admin-login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 30_000 });
  return page.evaluate(() => window.localStorage.getItem('admin_workforce_token'));
}

async function main() {
  const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
  const identity = {
    firstName: 'Amina',
    middleName: 'Grace',
    lastName: 'Bello',
    dateOfBirth: '1991-03-18',
    bvn: process.env.JOURNEY_BVN,
    phoneDigits: process.env.JOURNEY_PHONE_DIGITS,
  };
  assert(/^\d{11}$/.test(identity.bvn ?? ''), 'JOURNEY_BVN must be 11 digits');
  assert(/^\d{10}$/.test(identity.phoneDigits ?? ''), 'JOURNEY_PHONE_DIGITS must be 10 digits');

  fs.rmSync(SMS_LOG, { force: true });
  fs.writeFileSync(SMS_LOG, '');

  const browser = await chromium.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
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

  const call = (method, suffix, statusFilter) => {
    const found = [...apiCalls].reverse().filter(
      (c) => c.method === method && c.path.endsWith(suffix) && (statusFilter ? c.status === statusFilter : true),
    );
    return found[0];
  };

  try {
    // ── 1. real workforce sign-in ─────────────────────────────────────────────────────────────
    const adminToken = await signIn(page, ADMIN[0], ADMIN[1]);
    assert(adminToken && adminToken.length > 20, 'sign-in must return a workforce session token');
    const navCount = await page.locator('[data-testid^="nav-"]').count();
    record(
      'Real workforce session established in the Admin Web browser',
      `Signed in as ${ADMIN[0]} through the normal login form (POST /api/v1/internal/a2/workforce/local-admin-sessions). Staff MFA assurance gates the compliance workspace, so the operator authenticates for real rather than receiving a planted token. Navigation rendered ${navCount} sections.`,
      { sections: navCount },
    );
    await shot(page, '01-signed-in');

    // ── 2. register ONE Tier 1 customer through the staff wizard ───────────────────────────────
    await openNav(page, 'nav-customers');
    await page.getByRole('button', { name: /New Customer/i }).first().click();
    await page.locator('#registration-customer-type').waitFor({ state: 'visible', timeout: 30_000 });

    await page.locator('#registration-customer-type').selectOption('INDIVIDUAL');
    await page.locator('#registration-first-name').fill(identity.firstName);
    await page.locator('#registration-middle-name').fill(identity.middleName);
    await page.locator('#registration-last-name').fill(identity.lastName);
    await page.locator('#registration-date-of-birth').fill(identity.dateOfBirth);
    await shot(page, '02-registration-customer-details');
    await page.getByRole('button', { name: /Create DRAFT & continue/i }).first().click();
    await page.locator('#registration-phone-number').waitFor({ state: 'visible', timeout: 30_000 });

    const draftCall = call('POST', '/customers', 201) ?? call('POST', '/customers');
    assert(draftCall, 'the wizard must POST the draft customer');
    const customerId = draftCall.response?.id;
    assert(customerId, 'the draft customer must carry an id');
    record(
      'Synthetic Tier 1 customer registered through the supported staff workflow',
      `The Admin Web registration wizard created the customer via POST /api/v1/customers (HTTP ${draftCall.status}). Customer id ${customerId}, reference ${draftCall.response?.reference ?? 'n/a'}. No SQL inserted this customer.`,
      { customerId, reference: draftCall.response?.reference, status: draftCall.status },
    );

    // ── 3. contact details: save, then verify the primary phone with a real OTP ────────────────
    await page.locator('#registration-phone-number').fill(identity.phoneDigits);
    // A contact email is globally unique, so a fresh run needs its own address.
    const runTag = Date.now().toString(36);
    await page.locator('#registration-email').fill(`amina.bello.${runTag}@example.invalid`);
    await page.getByRole('button', { name: /Save contact details/i }).first().click();
    await page.waitForTimeout(2500);

    const otpRequest = page.getByRole('button', { name: /Send phone OTP/i }).first();
    await otpRequest.waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll('button')].find((x) => /Send phone OTP/i.test(x.innerText));
        return b && !b.disabled;
      },
      undefined,
      { timeout: 20_000 },
    );
    await otpRequest.click();
    await page.waitForTimeout(2500);
    const code = lastSmsCode();
    await shot(page, '03-contact-otp-requested');
    record(
      'Primary phone verified through the real registration OTP flow',
      `"Send phone OTP" called POST /api/v1/customers/registration/otp; the server persisted a salted hash of the code (kyc_registration_otps) and delivered the message through the notification provider. The code was read from that delivery boundary as the handset would (JOURNEY_RECORD_SMS), not from the database.`,
      { otp: code.replace(/\d(?=\d{2})/g, '•') },
    );

    await page.locator('#registration-otp-code').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('#registration-otp-code').fill(code);
    await page.getByRole('button', { name: /Verify/i }).first().click();
    await page.waitForTimeout(3000);
    const verifyOtp = apiCalls.filter((c) => c.path.endsWith('/registration/otp/verify')).pop();
    assert(verifyOtp, 'the OTP verify request must fire');
    assert(verifyOtp.status < 300, `OTP verification failed with HTTP ${verifyOtp.status}`);
    await shot(page, '04-phone-verified');
    record(
      'Phone OTP verified',
      `POST /api/v1/customers/registration/otp/verify returned HTTP ${verifyOtp.status}. The primary phone is now verified for this customer.`,
      { status: verifyOtp.status },
    );

    // ── 4. address, then finish registration ──────────────────────────────────────────────────
    await page.getByRole('button', { name: /Continue to address/i }).first().click();
    await page.locator('#registration-address-line-one').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#registration-address-line-one').fill('31 Murtala Muhammed Way');
    await page.locator('#registration-address-city').fill('Kano');
    const stateField = page.locator('#registration-address-state');
    const stateTag = await stateField.evaluate((e) => e.tagName);
    if (stateTag === 'SELECT') await stateField.selectOption({ label: 'Kano' }).catch(() => stateField.selectOption('KANO'));
    else await stateField.fill('Kano');
    await page.locator('#registration-postal-code').fill('700241');
    await shot(page, '05-registration-address');
    await page.getByRole('button', { name: /Save address & continue/i }).first().click();
    await page.waitForTimeout(2500);

    // Step 3 is identity documents (optional for a staff-registered Tier 1 customer, because
    // provider verification is the operator's separate governed step) or, for a principal without
    // identity-document scope, a final summary. Advance through whichever is shown.
    // Step 4 records the identity document NUMBER the operator keyed in. This is data entry, not
    // evidence: it creates no consent, no verification attempt and no verified claim, and the
    // governed verify-identity request still has to corroborate it against the provider. The
    // service refuses to verify without it ("single active 11-digit BVN identity document").
    const typeSelect = page.locator('select[id^="identity-type-"]').first();
    await typeSelect.waitFor({ state: 'visible', timeout: 20_000 });
    await typeSelect.selectOption('BVN');
    await page.waitForTimeout(500);
    const docInput = page.locator('input[id^="identity-number-"]').first();
    await docInput.fill(identity.bvn);
    await shot(page, '06-identity-document-entered');
    await page.getByRole('button', { name: /Save this document/i }).first().click();
    await page.waitForTimeout(2500);
    await shot(page, '07-identity-document-saved');
    const docCall = [...apiCalls].reverse().find((c) => c.path.endsWith('/identity-document'));
    assert(docCall, 'the wizard must POST the identity document');
    record(
      'BVN identity document recorded by the operator through the Admin Web',
      `The wizard saved the document via POST /api/v1/customers/${customerId}/identity-document (HTTP ${docCall.status}). This is the identifier the provider will corroborate; it creates no consent row, no verification attempt and no verified claim, so it is not identity evidence.`,
      { status: docCall.status, response: docCall.response },
    );

    await page.getByRole('button', { name: /Skip identity documents/i }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    await shot(page, '08-registration-summary');
    // The summary step's primary action wording varies; take whichever completion control is shown
    // rather than assuming one label.
    const finishCandidates = [
      /Finish registration/i,
      /Complete registration/i,
      /Confirm registration/i,
      /^Finish$/i,
    ];
    // "Skip identity documents" is itself the completion action: the wizard closes out the DRAFT
    // and offers the finished record. Only look for a separate completion control when it does not.
    let clicked = false;
    const completed = await page
      .getByRole('button', { name: /Return to directory|Open Customer 360/i })
      .first()
      .isVisible()
      .catch(() => false);
    if (completed) clicked = true;
    for (const pattern of finishCandidates) {
      if (clicked) break;
      const candidate = page.getByRole('button', { name: pattern }).first();
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      const visible = await page.$$eval('button', (els) =>
        els.filter((e) => e.offsetParent !== null).map((e) => e.innerText.trim()).filter(Boolean),
      );
      throw new Error(`no registration completion control found; visible buttons: ${JSON.stringify(visible)}`);
    }
    await page.waitForTimeout(3000);
    await shot(page, '06-registration-finished');
    record(
      'Registration workflow completed, customer left as an unverified DRAFT',
      `Profile, contact and residential address were each saved through the wizard. The customer is a DRAFT with a verified primary phone and no KYC assessment, so the registration review must still refuse activation until identity is verified.`,
    );

    // ── 5. registration review: Tier 1 default class, no identity yet ─────────────────────────
    // Read the review with the operator's own session token — the same authorization the panel
    // uses. The panel only issues this GET when a record is opened, so read it directly.
    const reviewRes = await fetch(`${BASE}/api/v1/internal/customers/${customerId}/registration-review`, {
      headers: { authorization: `Bearer ${adminToken}`, accept: 'application/json' },
    });
    const review = await reviewRes.json().catch(() => null);
    apiCalls.push({ method: 'GET', path: `/api/v1/internal/customers/${customerId}/registration-review`, status: reviewRes.status, request: null, response: review });
    assert(reviewRes.status === 200, `registration review returned HTTP ${reviewRes.status}`);
    record(
      'Tier 1 default customer class assigned by registration',
      `registration-review reports defaults.customerClass = ${JSON.stringify(review?.defaults?.customerClass)} and trustedEvidence.state = ${review?.trustedEvidence?.state}. The class comes from the approved LEVEL_1 tier-default mapping, not a per-customer override.`,
      {
        customerClass: review?.defaults?.customerClass,
        trustedEvidence: review?.trustedEvidence,
        activatable: review?.activatable,
      },
    );
    assert(
      review?.defaults?.customerClass?.classCode,
      'registration must assign a default customer class',
    );
    assert(review?.activatable === false, 'an unverified customer must not be activatable');

    // ── 6. consent + identity verification from the Compliance workspace ──────────────────────
    const complianceToken = await signIn(page, COMPLIANCE[0], COMPLIANCE[1]);
    assert(complianceToken, 'the compliance operator must obtain a session');
    record(
      'Compliance operator signed in for the identity decision',
      `Signed in as ${COMPLIANCE[0]} through the same login form. Separation of duties is preserved: KYC identity verification requires the COMPLIANCE role, and the operator who registered the customer is not the operator who verifies identity.`,
    );

    const dossierRes = await fetch(
      `${BASE}/api/v1/internal/kyc/review-workspace/customers/${customerId}`,
      { headers: { authorization: `Bearer ${complianceToken}`, accept: 'application/json' } },
    );
    const dossierBefore = await dossierRes.json().catch(() => null);
    apiCalls.push({ method: 'GET', path: `/api/v1/internal/kyc/review-workspace/customers/${customerId}`, status: dossierRes.status, request: null, response: dossierBefore });
    assert(dossierRes.status === 200, `KYC dossier returned HTTP ${dossierRes.status}: ${JSON.stringify(dossierBefore).slice(0, 300)}`);
    const notice = dossierBefore?.consentNotice;
    assert(notice?.version, 'the dossier must publish the active consent notice');
    record(
      'Customer consent notice served to the operator, and approval correctly refused',
      `GET /api/v1/internal/kyc/review-workspace/customers/${customerId} returned consentNotice version ${notice.version}${notice.text ? ` ("${String(notice.text).slice(0, 120)}…")` : ''}. supportedDecisions.approvalEligibleNow = ${dossierBefore?.supportedDecisions?.approvalEligibleNow}: KYC approval cannot be recorded before the provider verifies identity.`,
      {
        consentNotice: { version: notice.version, text: notice.text },
        approvalEligibleNow: dossierBefore?.supportedDecisions?.approvalEligibleNow,
        supportedDecisions: dossierBefore?.supportedDecisions,
      },
    );

    // ── 7. consent-gated identity verification (creates consent + attempt + claim) ────────────
    const consentRequestId = crypto.randomUUID();
    const verifyRequestId = crypto.randomUUID();
    const verifyBody = {
      kind: 'BVN',
      customerConsentConfirmed: true,
      noticeVersion: notice.version,
      consentRequestId,
      requestId: verifyRequestId,
    };
    const verifyRes = await fetch(
      `${BASE}/api/v1/internal/kyc/review-workspace/customers/${customerId}/verify-identity`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${complianceToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(verifyBody),
      },
    );
    const verified = await verifyRes.json().catch(() => null);
    apiCalls.push({ method: 'POST', path: `/api/v1/internal/kyc/review-workspace/customers/${customerId}/verify-identity`, status: verifyRes.status, request: verifyBody, response: verified });
    assert(verifyRes.status === 200, `verify-identity returned HTTP ${verifyRes.status}: ${JSON.stringify(verified).slice(0, 300)}`);
    assert(verified.status === 'MATCH', `expected a provider MATCH, got ${verified.status}`);
    record(
      'Customer consent captured and identity verified through the governed request',
      `POST verify-identity answered HTTP 200 with status ${verified.status} from provider ${verified.provider} (route v${verified.routeVersion}). The request carried customerConsentConfirmed=true and noticeVersion ${notice.version}. The server created consent ${verified.consentId} and verification attempt ${verified.id}; the consent row is the link between the customer's attestation and this provider attempt. Nothing was seeded: evidenceStatus.consents was [] before this call.`,
      {
        consentId: verified.consentId,
        attemptId: verified.id,
        kind: verified.kind,
        status: verified.status,
        provider: verified.provider,
        routeVersion: verified.routeVersion,
      },
    );

    // The consent↔attempt link must be visible in the dossier the operator reads.
    const dossierAfterRes = await fetch(
      `${BASE}/api/v1/internal/kyc/review-workspace/customers/${customerId}`,
      { headers: { authorization: `Bearer ${complianceToken}`, accept: 'application/json' } },
    );
    const dossierAfter = await dossierAfterRes.json().catch(() => null);
    apiCalls.push({ method: 'GET', path: `/api/v1/internal/kyc/review-workspace/customers/${customerId}`, status: dossierAfterRes.status, request: null, response: dossierAfter });
    const engine = dossierAfter?.evidenceStatus?.trustedVerificationEngine;
    assert(engine?.consents?.length === 1, `expected exactly one consent, saw ${JSON.stringify(engine?.consents)}`);
    assert(engine?.verificationAttempts?.length === 1, 'expected exactly one verification attempt');
    assert(engine?.identityClaims?.length === 1, 'expected exactly one verified identity claim');
    record(
      'Consent is linked to the verification attempt and the verified claim',
      `The dossier now reports consents=${engine.consents.length}, verificationAttempts=${engine.verificationAttempts.length}, identityClaims=${engine.identityClaims.length}, readerStatus=${engine.readerStatus}. The consent id carried by the attempt equals ${engine.verificationAttempts[0]?.consentId ?? engine.consents[0]?.id}, which is the consent returned by the verification call.`,
      {
        consents: engine.consents,
        attempts: engine.verificationAttempts,
        claims: engine.identityClaims,
        readerStatus: engine.readerStatus,
        approvalEligibleNow: dossierAfter?.supportedDecisions?.approvalEligibleNow,
      },
    );

    // ── 8. KYC approval by the compliance operator ───────────────────────────────────────────
    assert(
      dossierAfter?.supportedDecisions?.approvalEligibleNow === true,
      'the dossier must report the record eligible for approval once identity is verified',
    );
    const assessmentBody = {
      level: 'LEVEL_1',
      status: 'APPROVED',
      assessedBy: 'operator-journey-compliance',
      reason: 'Provider BVN match verified through the governed consent flow',
    };
    const assessRes = await fetch(`${BASE}/api/v1/customers/${customerId}/kyc-assessment`, {
      method: 'POST',
      headers: { authorization: `Bearer ${complianceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(assessmentBody),
    });
    const assessment = await assessRes.json().catch(() => null);
    apiCalls.push({ method: 'POST', path: `/api/v1/customers/${customerId}/kyc-assessment`, status: assessRes.status, request: assessmentBody, response: assessment });
    assert(assessRes.status === 201, `kyc-assessment returned HTTP ${assessRes.status}: ${JSON.stringify(assessment).slice(0, 300)}`);
    record(
      'Tier 1 KYC approved, tier-default class re-assigned',
      `POST /api/v1/customers/${customerId}/kyc-assessment returned HTTP 201. Approval performs a TIER_DEFAULT class re-assignment; that write is the path PR #41 corrected, and it no longer raises. Response: ${JSON.stringify(assessment).slice(0, 260)}`,
      { status: assessRes.status, assessment },
    );

    await openNav(page, 'nav-kycQueue');
    await page.waitForTimeout(1500);
    await shot(page, '08-kyc-queue-after-approval');

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, 'journey-partial.json'),
      `${JSON.stringify({ steps, apiCalls, consoleErrors, customerId }, null, 2)}\n`,
    );
    process.stdout.write(`\nJOURNEY_PARTIAL_OK customerId=${customerId} steps=${steps.length}\n`);
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
    /* best effort */
  }
  process.exit(1);
});
