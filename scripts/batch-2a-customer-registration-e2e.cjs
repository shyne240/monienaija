#!/usr/bin/env node
'use strict';

// Isolated, synthetic-only browser proof for Batch 2A. It starts an in-process Nest test app
// with an in-memory notification provider and a local, ephemeral OIDC/JWKS signer. No OTP,
// credential, private key, or real customer data is written to disk or printed.
process.env.NODE_ENV = 'development';
process.env.LOG_LEVEL = 'silent';
process.env.ADMIN_WEB_DEV_PROXY_TARGET = 'http://127.0.0.1:3000';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { join, resolve } = require('node:path');
const {
  generateKeyPairSync,
  randomBytes,
  randomInt,
  randomUUID,
  sign,
} = require('node:crypto');
const { chromium } = require('playwright');
const { Test } = require('@nestjs/testing');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { ValidationPipe } = require('@nestjs/common');

const { AppModule } = require('../dist/app.module');
const { LocalAdminAuthenticationService } = require('../dist/local-admin-authentication/local-admin-authentication.service');
const { ProductionReadinessService } = require('../dist/production/production-readiness.service');
const { A2_WORKFORCE_CONFIG } = require('../dist/authorization/workforce-oidc.service');
const { NOTIFICATION_PROVIDER_TOKEN } = require('../dist/notification/notification.constants');
const { TestNotificationProvider } = require('../dist/notification/notification-provider.interface');

const UI_ORIGIN = 'http://127.0.0.1:5173';
const API_ORIGIN = 'http://127.0.0.1:3000';
const OIDC_ISSUER = 'http://127.0.0.1:3001/issuer';
const OIDC_AUDIENCE = 'batch2a-browser-test';
const OIDC_CLIENT_ID = 'monienaija-admin-web-e2e';
const OIDC_KID = 'batch2a-ephemeral-key';
const CHECKPOINT_TIMEOUT = 20_000;

const databaseName = (process.env.DB_NAME ?? '').trim();
if (!/e2e/i.test(databaseName)) {
  process.stderr.write('Batch 2A E2E refused: set DB_NAME to a disposable database containing "e2e".\n');
  process.exit(2);
}

let checkpoint = 'setup';
let app;
let moduleRef;
let browser;
let viteProcess;
let jwksServer;
let page;
let administratorEmail;
let administratorPassword;
let verificationCode;
let syntheticPhone;
let syntheticIdentityNumber;
let syntheticPassportNumber;
let syntheticDisplayName;
let syntheticRevisedName;
let syntheticAddress;
let restrictedAssertion;
let administratorAccessToken;

const notifications = new TestNotificationProvider();

function pass(description) {
  process.stdout.write(`PASS ${description}\n`);
}

function failSafely(error) {
  // Deliberately omit exception details: Playwright errors may include typed values, DOM
  // snippets, request payloads, phone numbers, identity values, or bearer tokens. The one
  // safe exception is a Linux shared-library name, which is not user data or a credential.
  const errorName = error && typeof error.name === 'string' ? error.name : 'Error';
  const missingLibrary = String(error?.message ?? '').match(
    /error while loading shared libraries:\s*([A-Za-z0-9_.+-]+):/i,
  )?.[1];
  if (checkpoint === 'launching headless Chromium' && missingLibrary) {
    process.stderr.write(`FAIL ${checkpoint}: Linux runtime library ${missingLibrary} is missing; details suppressed.\n`);
    return;
  }
  process.stderr.write(`FAIL ${checkpoint}: ${errorName}; details suppressed.\n`);
}

async function click(locator, nextCheckpoint) {
  checkpoint = nextCheckpoint;
  await locator.waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await locator.click();
}

async function fill(locator, value, nextCheckpoint) {
  checkpoint = nextCheckpoint;
  await locator.waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await locator.fill(value);
}

function signAssertion(privateKey, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: OIDC_KID })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: OIDC_ISSUER,
    sub: subject,
    aud: OIDC_AUDIENCE,
    azp: OIDC_CLIENT_ID,
    iat: now,
    exp: now + 300,
    auth_time: now,
    amr: ['pwd', 'mfa'],
    acr: 'mfa',
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

async function startJwksServer() {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = pair.publicKey.export({ format: 'jwk' });
  const jwks = {
    keys: [{
      kty: 'RSA',
      n: exported.n,
      e: exported.e,
      alg: 'RS256',
      use: 'sig',
      kid: OIDC_KID,
      environment: 'development',
    }],
  };
  jwksServer = createServer((request, response) => {
    if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify(jwks));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolveListen, reject) => {
    jwksServer.once('error', reject);
    jwksServer.listen(3001, '127.0.0.1', resolveListen);
  });
  return pair.privateKey;
}

const workforceConfig = {
  enabled: true,
  environment: 'development',
  oidcIssuer: OIDC_ISSUER,
  oidcJwksUri: 'http://127.0.0.1:3001/jwks',
  oidcAudience: OIDC_AUDIENCE,
  oidcClientId: OIDC_CLIENT_ID,
  internalAudience: 'workforce-admin',
  sessionTtlSeconds: 900,
  mfaFreshnessSeconds: 300,
  oidcJwksCacheSeconds: 60,
  oidcJwksMaxStalenessSeconds: 300,
  bootstrapEnabled: false,
  bootstrapIssuer: '',
  bootstrapAudience: '',
  bootstrapKeys: [],
  bootstrapFinanceAdminScopes: [],
  recoveryEnabled: false,
  recoveryAudience: '',
  recoveryKeys: [],
  roles: [{
    roleKey: 'SUPER_ADMIN',
    displayName: 'Super Admin',
    description: 'Ephemeral test administrator role.',
    enabled: true,
    scopes: [],
    applicableActions: [],
    mfaRequired: true,
    approvalCapability: false,
    makerEligible: false,
    checkerEligible: false,
    administrativeCapability: true,
  }],
  makerCheckerRules: [],
  rateLimits: [
    'workforce-authentication',
    'workforce-bootstrap',
    'finance-role-administration',
    'privileged-approval',
  ].map((category) => ({ category, capacity: 100, refillRatePerSecond: 100, enabled: true })),
  trustedProxyAddresses: ['127.0.0.1'],
};

async function startApi() {
  checkpoint = 'starting the isolated API against the disposable E2E database';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(A2_WORKFORCE_CONFIG)
    .useValue(workforceConfig)
    .overrideProvider(NOTIFICATION_PROVIDER_TOKEN)
    .useValue(notifications)
    .compile();
  app = moduleRef.createNestApplication(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
  }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  await moduleRef.get(ProductionReadinessService).verifyStartup();
  await app.listen(3000, '0.0.0.0');

  administratorEmail = `batch2a-${randomUUID()}@example.invalid`;
  administratorPassword = randomBytes(36).toString('base64url');
  await moduleRef.get(LocalAdminAuthenticationService).seedDefaultAdmin({
    email: administratorEmail,
    password: administratorPassword,
  });
}

async function startVite() {
  checkpoint = 'starting the local Admin Web dev server';
  const webRoot = resolve(__dirname, '../apps/admin-web');
  const viteEntry = join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const viteEnv = { ...process.env, ADMIN_WEB_DEV_PROXY_TARGET: 'http://127.0.0.1:3000' };
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL', 'DB_SSL_REJECT_UNAUTHORIZED']) {
    delete viteEnv[key];
  }
  viteProcess = spawn(process.execPath, [viteEntry, '--host', '0.0.0.0', '--port', '5173', '--strictPort'], {
    cwd: webRoot,
    env: viteEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupOutput = '';
  const observe = (chunk) => {
    startupOutput = `${startupOutput}${chunk.toString()}`.slice(-8_000);
  };
  viteProcess.stdout.on('data', observe);
  viteProcess.stderr.on('data', observe);
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('vite startup timeout')), 30_000);
    const inspect = () => {
      if (/Local:\s+http:\/\/localhost:5173|ready in/i.test(startupOutput)) {
        clearTimeout(timer);
        resolveReady();
      }
    };
    viteProcess.stdout.on('data', inspect);
    viteProcess.stderr.on('data', inspect);
    viteProcess.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    viteProcess.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`vite exited ${code}`));
    });
    inspect();
  });
}

async function launchBrowser() {
  checkpoint = 'launching headless Chromium';
  const options = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  } else if (process.platform === 'linux') {
    const Chromium = require('@sparticuz/chromium').default;
    options.executablePath = await Chromium.executablePath();
    options.args = Chromium.args;
  }
  browser = await chromium.launch(options);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  page = await context.newPage();
  page.setDefaultTimeout(CHECKPOINT_TIMEOUT);
}

async function runBrowserJourney(privateKey) {
  checkpoint = 'opening the workforce login screen';
  await page.goto(UI_ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/Email or username/).waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await fill(page.getByLabel(/Email or username/), administratorEmail, 'entering an ephemeral local administrator');
  await fill(page.getByLabel(/Password/), administratorPassword, 'entering the ephemeral local password');
  await click(page.getByRole('button', { name: 'Sign In' }), 'authenticating through the normal local workforce login');
  await page.getByTestId('nav-customers').waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  administratorAccessToken = await page.evaluate(() => localStorage.getItem('admin_workforce_token'));
  assert.ok(administratorAccessToken);
  pass('normal Admin login created an authenticated workforce session');

  await click(page.getByTestId('nav-customers'), 'opening the customer directory');
  await page.getByRole('heading', { name: 'Customer directory' }).waitFor({ state: 'visible' });
  await click(page.getByRole('button', { name: 'New Customer' }), 'opening New Customer');
  await page.getByRole('heading', { name: 'Customer details' }).waitFor({ state: 'visible' });

  const tag = randomBytes(3).toString('hex').toUpperCase();
  syntheticDisplayName = `Synthetic Batch ${tag}`;
  syntheticRevisedName = `Synthetic Batch 2A Revised ${tag}`;
  syntheticPhone = `+2348${randomInt(100000000, 999999999)}`;
  syntheticIdentityNumber = `SYNTHETIC-NIN-2A-${randomBytes(12).toString('hex').toUpperCase()}`;
  syntheticPassportNumber = `SYNTHETIC-PASSPORT-2A-${randomBytes(12).toString('hex').toUpperCase()}`;
  syntheticAddress = `1 Synthetic Crescent ${tag}`;
  const syntheticEmail = `contact-${randomBytes(6).toString('hex')}@example.test`;

  await page.getByLabel(/Customer type/).selectOption('INDIVIDUAL');
  await fill(page.getByLabel(/First name/), 'Synthetic', 'entering a synthetic first name');
  await fill(page.getByLabel(/Middle name/), 'Batch', 'entering a synthetic middle name');
  await fill(page.getByLabel(/Last name/), tag, 'entering a synthetic last name');
  await fill(page.getByLabel(/Date of birth/), '1991-03-17', 'entering a synthetic date of birth');
  await fill(page.getByLabel(/Nationality/), 'NG', 'entering a synthetic nationality');

  checkpoint = 'creating the manual DRAFT customer';
  const createdResponsePromise = page.waitForResponse((response) => {
    try {
      return response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/customers';
    } catch {
      return false;
    }
  });
  await click(page.getByRole('button', { name: 'Create DRAFT & continue' }), checkpoint);
  const createdResponse = await createdResponsePromise;
  assert.equal(createdResponse.status(), 201);
  const customer = await createdResponse.json();
  assert.equal(customer.status, 'DRAFT');
  await page.getByRole('heading', { name: 'Contact & verification' }).waitFor({ state: 'visible' });

  await fill(page.getByLabel(/Primary phone number/), syntheticPhone, 'entering a synthetic primary phone');
  await fill(page.getByLabel(/Email address/), syntheticEmail, 'entering a synthetic contact email');
  await click(page.getByRole('button', { name: 'Save contact details' }), 'saving the primary contact');
  await page.getByRole('status').filter({ hasText: 'Contact details saved' }).waitFor({ state: 'visible' });
  await click(page.getByRole('button', { name: 'Continue to address' }), 'continuing to the address step');
  await page.getByRole('heading', { name: 'Residential address' }).waitFor({ state: 'visible' });

  await fill(page.getByLabel(/Address line 1/), syntheticAddress, 'entering a synthetic address');
  await fill(page.getByLabel(/Address line 2/), 'Test District', 'entering a synthetic address locality');
  await fill(page.getByLabel(/^City/), 'Abuja', 'entering the synthetic city');
  await fill(page.getByLabel(/State \/ province/), 'FCT', 'entering the synthetic state');
  await fill(page.getByLabel(/Country/), 'NG', 'entering the synthetic country');
  await fill(page.getByLabel(/Postal code/), '00000', 'entering a synthetic postal code');
  await click(page.getByRole('button', { name: 'Save address & continue' }), 'saving the address');
  await page.getByRole('heading', { name: 'Identity documents' }).waitFor({ state: 'visible' });

  await page.getByLabel(/Identity document type/).selectOption('NIN');
  assert.equal(await page.getByLabel(/Issue date/).count(), 0);
  assert.equal(await page.getByLabel(/Expiry date/).count(), 0);
  await fill(page.getByLabel(/Document number/), syntheticIdentityNumber, 'entering synthetic identity metadata');
  await click(page.getByRole('button', { name: 'Save this document' }), 'saving the first identity document independently');
  await page.getByText(/Saved ·/).first().waitFor({ state: 'visible' });

  await click(page.getByRole('button', { name: 'Add another identity document' }), 'adding another identity document');
  await page.getByLabel(/Identity document type/).selectOption('INTERNATIONAL_PASSPORT');
  assert.equal(await page.getByLabel(/Issue date/).count(), 1);
  assert.equal(await page.getByLabel(/Expiry date/).count(), 1);
  await fill(page.getByLabel(/Document number/), syntheticPassportNumber, 'entering a second synthetic identity value');
  await fill(page.getByLabel(/Issue date/), '2015-06-12', 'entering a synthetic passport issue date');
  await fill(page.getByLabel(/Expiry date/), '2035-06-12', 'entering a synthetic passport expiry date');
  await click(page.getByRole('button', { name: 'Save this document' }), 'saving the second identity document independently');
  await page.getByText(/Saved ·/).last().waitFor({ state: 'visible' });
  await click(page.getByRole('button', { name: 'Continue to registration summary' }), 'continuing after independent identity-document saves');
  await page.getByText(/The customer remains/).waitFor({ state: 'visible' });
  const summary = await page.locator('body').innerText();
  assert.match(summary, /DRAFT/);
  assert.match(summary, /No activation or ledger wallet creation was requested/);
  assert.ok(!summary.includes(syntheticIdentityNumber));
  assert.ok(!summary.includes(syntheticPassportNumber));
  assert.ok(!summary.includes(syntheticPhone));
  pass('profile, contact, address and two independently saved masked identity documents stayed DRAFT');

  await click(page.getByRole('button', { name: 'Return to directory', exact: true }), 'returning to the directory after registration');
  await fill(page.getByLabel('Search customers'), syntheticDisplayName, 'checking the directory name immediately after profile save');
  await page.getByRole('button', { name: `Open Customer 360° for ${syntheticDisplayName}` }).waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await click(page.getByRole('button', { name: `Open Customer 360° for ${syntheticDisplayName}` }), 'opening the newly listed customer in Customer 360');
  await page.locator('.cm-workspace .cm-profile-heading h1').waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await page.getByRole('heading', { name: syntheticDisplayName, exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Overview' }).waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Personal information & contact' }).waitFor({ state: 'visible' });
  await page.getByText('Not verified', { exact: true }).waitFor({ state: 'visible' });
  const overviewText = await page.locator('body').innerText();
  assert.match(overviewText, /Draft/);
  assert.ok(!overviewText.includes(syntheticPhone));
  assert.ok(!overviewText.includes(syntheticIdentityNumber));
  assert.ok(!overviewText.includes(syntheticPassportNumber));

  const profileCard = page.locator('article.cm-card').filter({
    has: page.getByRole('heading', { name: 'Profile overview' }),
  });
  const walletCard = page.locator('article.cm-card').filter({
    has: page.getByRole('heading', { name: 'Wallet summary' }),
  });
  await walletCard.getByText('No financial wallets are recorded for this customer.').waitFor({ state: 'visible' });
  await click(page.getByRole('button', { name: 'Activate' }), 'attempting activation before phone verification');
  const activationDialog = page.getByRole('dialog');
  await activationDialog.getByText(/Activation will be rejected unless the customer has a verified primary phone/).waitFor({ state: 'visible' });
  await click(activationDialog.getByRole('button', { name: 'Confirm change' }), 'confirming the blocked activation attempt');
  await page.getByRole('alert').filter({ hasText: 'The status change was blocked by a customer lifecycle rule.' }).waitFor({ state: 'visible' });
  assert.equal(await profileCard.getByText('Draft', { exact: true }).count(), 1);
  await click(page.getByRole('dialog').getByRole('button', { name: 'Cancel' }), 'closing the activation dialog');
  pass('unverified-phone activation was blocked; status stayed DRAFT and no wallet appeared');

  await click(page.getByRole('tab', { name: 'Personal information & contact' }), 'opening personal information');
  await page.getByRole('heading', { name: 'Personal information', exact: true }).waitFor({ state: 'visible' });
  await click(page.getByRole('button', { name: 'Edit profile' }), 'opening profile correction');
  const profileEditor = page.locator('form.cm-editor-form').first();
  await fill(profileEditor.getByLabel(/Display name/), syntheticRevisedName, 'correcting the display name');
  await fill(profileEditor.getByLabel(/First name/), 'Revised', 'correcting the first name');
  await click(profileEditor.getByRole('button', { name: 'Save profile' }), 'saving the profile correction');
  await page.getByRole('status').filter({ hasText: 'Personal information saved' }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: syntheticRevisedName, exact: true }).waitFor({ state: 'visible' });

  const addressCard = page.locator('article.cm-card').filter({
    has: page.getByRole('heading', { name: 'Residential and mailing addresses' }),
  });
  await click(addressCard.locator('.cm-address-item').getByRole('button', { name: 'Edit' }), 'opening address correction');
  await fill(addressCard.getByLabel(/Address line 1/), `2 Synthetic Crescent ${tag}`, 'correcting the synthetic address');
  await click(addressCard.getByRole('button', { name: 'Save address' }), 'saving the address correction');
  await page.getByRole('status').filter({ hasText: 'Address correction saved' }).waitFor({ state: 'visible' });

  const identityCard = page.locator('article.cm-card').filter({
    has: page.getByRole('heading', { name: 'Supported identity metadata' }),
  });
  const passportRow = identityCard.locator('li').filter({ hasText: 'INTERNATIONAL PASSPORT' });
  assert.equal(await identityCard.locator('li').count(), 2);
  await click(passportRow.getByRole('button', { name: 'Edit' }), 'opening the selected passport correction');
  const maskedNumberInput = identityCard.getByLabel(/Document number/);
  assert.equal(await maskedNumberInput.inputValue(), '');
  await fill(identityCard.getByLabel(/Expiry date/), '2036-06-12', 'correcting passport expiry metadata');
  await click(identityCard.getByRole('button', { name: 'Save identity details' }), 'saving identity correction');
  await page.getByRole('status').filter({ hasText: 'Identity metadata saved' }).waitFor({ state: 'visible' });
  const correctedText = await page.locator('body').innerText();
  assert.ok(!correctedText.includes(syntheticIdentityNumber));
  assert.ok(!correctedText.includes(syntheticPassportNumber));
  assert.ok(!correctedText.includes(syntheticPhone));
  pass('authorized profile, address and identity corrections persisted without revealing sensitive values');

  await page.reload();
  await page.getByTestId('nav-customers').waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await click(page.getByTestId('nav-customers'), 'returning to the directory after refresh');
  await fill(page.getByLabel('Search customers'), syntheticRevisedName, 'searching the refreshed directory');
  const openCustomer = page.getByRole('button', { name: `Open Customer 360° for ${syntheticRevisedName}` });
  await openCustomer.waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await click(openCustomer, 'reopening the persisted customer from the directory');
  await page.getByRole('heading', { name: syntheticRevisedName, exact: true }).waitFor({ state: 'visible' });
  await click(page.getByRole('tab', { name: 'Personal information & contact' }), 'checking persisted customer details');
  await page.getByText(`2 Synthetic Crescent ${tag}`, { exact: false }).waitFor({ state: 'visible' });
  const refreshedText = await page.locator('body').innerText();
  assert.ok(refreshedText.includes(syntheticRevisedName));
  assert.ok(refreshedText.includes('2036-06-12'));
  assert.ok(!refreshedText.includes(syntheticIdentityNumber));
  assert.ok(!refreshedText.includes(syntheticPassportNumber));
  assert.ok(!refreshedText.includes(syntheticPhone));
  pass('directory and C360 reflected persisted corrections after browser refresh');

  await click(page.getByRole('tab', { name: 'Overview' }), 'checking phone and lifecycle status before proof');
  await page.getByText('Draft', { exact: true }).first().waitFor({ state: 'visible' });
  await page.getByText('Not verified', { exact: true }).waitFor({ state: 'visible' });
  await click(page.getByRole('tab', { name: 'Personal information & contact' }), 'opening phone verification controls');
  const contactCard = page.locator('article.cm-card').filter({
    has: page.getByRole('heading', { name: 'Phones and email' }),
  });
  const sentBefore = notifications.sent.length;
  await click(contactCard.getByRole('button', { name: 'Verify phone' }), 'requesting an OTP through the in-memory test provider');
  await page.getByRole('status').filter({ hasText: 'OTP request accepted' }).waitFor({ state: 'visible' });
  assert.ok(notifications.sent.length > sentBefore);
  verificationCode = notifications.sent[notifications.sent.length - 1].message.match(/code is (\d{6})/)?.[1];
  assert.ok(verificationCode);
  const otpForm = page.locator('form.cm-contact-otp');
  await fill(otpForm.getByLabel(/One-time code/), verificationCode, 'entering the in-memory synthetic OTP');
  await click(otpForm.getByRole('button', { name: 'Verify phone' }), 'verifying the primary phone');
  await page.getByRole('status').filter({ hasText: 'Phone verified. The customer remains in its current lifecycle status.' }).waitFor({ state: 'visible' });
  await click(page.getByRole('tab', { name: 'Overview' }), 'refreshing activation readiness after OTP');
  await page.getByText('Verified primary phone', { exact: true }).waitFor({ state: 'visible' });
  await page.getByText('Draft', { exact: true }).first().waitFor({ state: 'visible' });
  await walletCard.getByText('No financial wallets are recorded for this customer.').waitFor({ state: 'visible' });
  verificationCode = undefined;
  notifications.sent.splice(0, notifications.sent.length);
  pass('OTP proof persisted in memory-backed test delivery; customer remained DRAFT with no wallet');

  // Role assignment uses the existing, authorized workforce endpoint while the real
  // SUPER_ADMIN browser session is still active. The restricted session is then established
  // through the real OIDC session UI, never by writing a token/session directly.
  checkpoint = 'assigning the synthetic restricted role through authorized workforce administration';
  const now = new Date();
  const restrictedSubject = `batch2a-customer-service-${randomUUID()}`;
  const restrictedPrincipalId = `${OIDC_ISSUER}:${restrictedSubject}`;
  const assignment = await fetch(`${API_ORIGIN}/api/v1/internal/a2/workforce/roles`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${administratorAccessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      targetPrincipalId: restrictedPrincipalId,
      roleKey: 'CUSTOMER_SERVICE',
      effectiveFrom: new Date(now.getTime() - 60_000).toISOString(),
      effectiveTo: new Date(now.getTime() + 3_600_000).toISOString(),
    }),
  });
  assert.equal(assignment.status, 201);
  restrictedAssertion = signAssertion(privateKey, restrictedSubject);

  await click(page.getByRole('button', { name: /Log Out Session/ }), 'ending the super-admin browser session');
  await page.getByLabel(/Email or username/).waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await click(page.getByRole('button', { name: /Advanced: OIDC \/ Bootstrap/ }), 'opening the OIDC session form');
  // The LoginScreen's textarea currently has a non-associated visual label; use the corrected
  // semantic textarea locator instead of getByLabel.
  await fill(page.locator('textarea').first(), restrictedAssertion, 'entering a locally signed OIDC assertion');
  await click(page.getByRole('button', { name: 'Establish Session' }), 'establishing restricted access through OIDC');
  await page.getByTestId('nav-customers').waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  const restrictedPrincipal = await page.evaluate(() => JSON.parse(localStorage.getItem('admin_workforce_principal')));
  assert.deepEqual(restrictedPrincipal.roles, ['CUSTOMER_SERVICE']);
  assert.ok(restrictedPrincipal.scopes.includes('customer.view'));
  assert.ok(!restrictedPrincipal.scopes.includes('customer.create'));
  assert.ok(!restrictedPrincipal.scopes.includes('customer.view_identity_documents'));

  await click(page.getByTestId('nav-customers'), 'opening the directory as Customer Service');
  assert.equal(await page.getByRole('button', { name: 'New Customer' }).count(), 0);
  await fill(page.getByLabel('Search customers'), syntheticRevisedName, 'searching an authorized customer as Customer Service');
  const restrictedOpen = page.getByRole('button', { name: `Open Customer 360° for ${syntheticRevisedName}` });
  await restrictedOpen.waitFor({ state: 'visible', timeout: CHECKPOINT_TIMEOUT });
  await click(restrictedOpen, 'opening C360 as Customer Service');
  await page.getByRole('heading', { name: syntheticRevisedName, exact: true }).waitFor({ state: 'visible' });
  await click(page.getByRole('tab', { name: 'Personal information & contact' }), 'opening restricted C360 personal information');
  await page.getByText(/Identity data is restricted to roles with customer\.view_identity_documents/).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Add document' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Edit profile' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Add address' }).count(), 0);

  const restrictedStatusCodes = await page.evaluate(async (customerId) => {
    const token = localStorage.getItem('admin_workforce_token');
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const identity = await fetch(`/api/v1/customers/${encodeURIComponent(customerId)}/identity-documents`, { headers });
    const create = await fetch('/api/v1/customers', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'INDIVIDUAL' }),
    });
    return { identity: identity.status, create: create.status };
  }, customer.id);
  assert.deepEqual(restrictedStatusCodes, { identity: 403, create: 403 });
  const restrictedView = await page.locator('body').innerText();
  assert.ok(!restrictedView.includes(syntheticIdentityNumber));
  assert.ok(!restrictedView.includes(syntheticPassportNumber));
  assert.ok(!restrictedView.includes(syntheticPhone));
  pass('Customer Service UI hid creation/edit/identity controls; backend returned 403 for create and identity reads');
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolveClose) => server.close(() => resolveClose())).catch(() => undefined);
}

async function cleanup() {
  if (browser) await browser.close().catch(() => undefined);
  if (app) await app.close().catch(() => undefined);
  await closeServer(jwksServer);
  if (viteProcess && viteProcess.exitCode === null) {
    viteProcess.kill('SIGTERM');
    await new Promise((resolveExit) => {
      const timer = setTimeout(resolveExit, 5_000);
      viteProcess.once('exit', () => {
        clearTimeout(timer);
        resolveExit();
      });
    });
  }
}

(async () => {
  if (process.env.NODE_ENV !== 'development') throw new Error('E2E must run in development mode');
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error('DB_HOST, DB_USER and DB_PASSWORD must target the disposable E2E PostgreSQL instance');
  }
  const privateKey = await startJwksServer();
  await startApi();
  await startVite();
  await launchBrowser();
  await runBrowserJourney(privateKey);
})()
  .then(() => {
    process.stdout.write('PASS authenticated Batch 2A browser E2E completed.\n');
  })
  .catch((error) => {
    failSafely(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
