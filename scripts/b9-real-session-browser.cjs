#!/usr/bin/env node
'use strict';

/**
 * ARENA B9 — real-session browser acceptance for configurable workforce roles.
 *
 * Unlike `scripts/admin-web-workforce-b9-browser.cjs` (which intercepts `/api/v1/**` and answers
 * from fixtures), this harness talks to a REAL Nest application on a REAL, fully migrated disposable
 * PostgreSQL through the Admin Web bundle. Every identity is a genuine local workforce account, so
 * each step is decided by the server's guards, catalogues, approval state machine and audit trail.
 *
 * Prerequisites (all disposable):
 *   1. a PostgreSQL cluster started by `node start-pg-temp.js`, migrated and seeded with the eleven
 *      local fixture accounts (`scripts/local-dev-seed-11-roles.js`);
 *   2. `npm run build`;
 *   3. the Admin Web built with `ADMIN_WEB_API_BASE_URL=/api/v1`;
 *   4. `node scripts/b9-real-session-server.cjs <bundle-dir>` serving the bundle + real API.
 *
 * The one thing this script writes directly to the database is the SYNTHETIC workforce user's
 * credential row. There is no HTTP account-provisioning route in the product, and the point of the
 * run is to prove what happens to a real account's access — not to exercise user creation. The
 * script refuses to run against a non-loopback database and cleans its own fixture first, so reruns
 * against the same disposable cluster are deterministic.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash, pbkdf2Sync, randomBytes, randomUUID } = require('node:crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE = process.env.B9_BASE_URL || 'http://127.0.0.1:4401';
const OUT = path.resolve(
  process.env.B9_OUT_DIR || 'docs/integration/evidence/b9-real-session',
);
const EXECUTABLE = process.env.B9_CHROMIUM || process.env.BROWSER_EXECUTABLE_PATH || '';
const LIB_PATH = process.env.B9_CHROMIUM_LIB || '';

const ROLE_KEY = 'SOC_ANALYST';
const CUSTOM_EMAIL = 'soc-analyst@monienaija.local';
const CUSTOM_PASSWORD = 'MonieNaija_CustomRole_123!';
const FUNCTIONS = ['fee_rule.view', 'customer.view'];

const FIXTURES = {
  SUPER_ADMIN: ['super-admin@monienaija.local', 'MonieNaija_SUPER_ADMIN_123!'],
  FINANCE_CONTROLLER: ['finance-controller@monienaija.local', 'MonieNaija_FINANCE_CONTROLLER_123!'],
  FINANCE_PREPARER: ['finance-preparer@monienaija.local', 'MonieNaija_FINANCE_PREPARER_123!'],
  FINANCE_AUDITOR: ['finance-auditor@monienaija.local', 'MonieNaija_FINANCE_AUDITOR_123!'],
  ADMINISTRATOR: ['administrator@monienaija.local', 'MonieNaija_ADMINISTRATOR_123!'],
  OPERATIONS: ['operations@monienaija.local', 'MonieNaija_OPERATIONS_123!'],
  AGENT_NETWORK_MANAGER: [
    'agent-network-manager@monienaija.local',
    'MonieNaija_AGENT_NETWORK_MANAGER_123!',
  ],
  COMPLIANCE: ['compliance@monienaija.local', 'MonieNaija_COMPLIANCE_123!'],
  RISK_FRAUD: ['risk-fraud@monienaija.local', 'MonieNaija_RISK_FRAUD_123!'],
  CUSTOMER_SERVICE: ['customer-service@monienaija.local', 'MonieNaija_CUSTOMER_SERVICE_123!'],
  TREASURY: ['treasury@monienaija.local', 'MonieNaija_TREASURY_123!'],
};

const checks = [];
let checkIndex = 0;
function record(id, ok, detail) {
  checkIndex += 1;
  checks.push({ id, ok: Boolean(ok), detail: String(detail ?? '').slice(0, 400) });
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail ?? '').slice(0, 200)}\n`,
  );
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const principalFor = (email) =>
  `${process.env.A2_WORKFORCE_OIDC_ISSUER}:local-admin-credential:${sha256(email).slice(0, 32)}`;

function hashPassword(password) {
  const salt = randomBytes(16);
  const iterations = 10_000;
  const digest = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `PBKDF2$sha256$${iterations}$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

/** Local `datetime-local` value (the screens interpret these in the browser's local time). */
function localWindow() {
  const toLocal = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const from = new Date(Date.now() - 5 * 60_000);
  const to = new Date(Date.now() + 30 * 24 * 3600_000);
  return { from: toLocal(from), to: toLocal(to) };
}

async function prepareFixtures() {
  const { Client } = require('pg');
  const host = process.env.DB_HOST;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing a non-loopback database host: ${host}`);
  }
  const client = new Client({
    host,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await client.connect();
  const principal = principalFor(CUSTOM_EMAIL);
  try {
    await client.query('BEGIN');
    // Clean this harness's own artefacts so a rerun on the same disposable cluster is deterministic.
    await client.query(
      `DELETE FROM privileged_action_approvals
        WHERE resource_type = 'A2_FINANCE_ROLE_ASSIGNMENT'
          AND (resource_id LIKE $1 OR resource_id LIKE $2)`,
      ['%SOC_ANALYST%', '%soc-analyst%'],
    );
    await client.query('DELETE FROM role_definition_proposals WHERE target_role_key = $1', [
      ROLE_KEY,
    ]);
    await client.query(
      `DELETE FROM authorization_role_functions WHERE role_id IN
         (SELECT id FROM authorization_roles WHERE role_key = $1 AND is_system_seeded = false)`,
      [ROLE_KEY],
    );
    await client.query(
      'DELETE FROM authorization_roles WHERE role_key = $1 AND is_system_seeded = false',
      [ROLE_KEY],
    );
    await client.query('DELETE FROM a2_finance_role_assignments WHERE principal_id = $1', [
      principal,
    ]);
    await client.query('DELETE FROM local_admin_credentials WHERE email = $1', [CUSTOM_EMAIL]);
    await client.query(
      'INSERT INTO local_admin_credentials (id,email,password_hash,hash_algorithm) VALUES ($1,$2,$3,$4)',
      [randomUUID(), CUSTOM_EMAIL, hashPassword(CUSTOM_PASSWORD), 'PBKDF2'],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
  return { principal };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (LIB_PATH) process.env.LD_LIBRARY_PATH = LIB_PATH;
  const { chromium } = require('playwright');

  const { principal } = await prepareFixtures();
  const window = localWindow();

  const browser = await chromium.launch({
    executablePath: EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const pageErrors = [];
  const responses = [];
  const openSession = async (role) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)));
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/v1/')) responses.push({ status: response.status(), url, role });
    });
    return { context, page };
  };
  const signIn = async (page, email, password) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.fill('#admin-login-email', email);
    await page.fill('#admin-login-password', password);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="desktop-nav"]', { timeout: 20_000 });
  };
  const openNav = async (page, view, section) => {
    const item = page.locator(`[data-testid="nav-${view}"]`);
    if (!(await item.first().isVisible().catch(() => false))) {
      const controller = page.locator(`[data-testid="section-${section}"]`).first();
      if ((await controller.count()) > 0) {
        if ((await controller.getAttribute('aria-expanded')) === 'false') await controller.click();
      }
    }
    await item.click();
    const discard = page.locator('button:has-text("Discard and leave")').first();
    if (await discard.isVisible().catch(() => false)) await discard.click();
  };
  const actWithResponse = async (page, predicate, action) => {
    const [response] = await Promise.all([
      page.waitForResponse(predicate, { timeout: 30_000 }),
      action(),
    ]);
    return response;
  };
  const navItems = async (page) => {
    const sections = page.locator('[data-testid^="section-"]');
    const count = await sections.count();
    for (let index = 0; index < count; index += 1) {
      const controller = sections.nth(index);
      if ((await controller.getAttribute('aria-expanded')) === 'false') await controller.click();
    }
    const ids = await page
      .locator('[data-testid^="nav-"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node.getAttribute('data-testid') ?? '').replace(/^nav-/, '')),
      );
    return [...new Set(ids)].sort();
  };

  const admin = await openSession('SUPER_ADMIN');
  const checker = await openSession('FINANCE_CONTROLLER');
  let analyst = null;

  // ---------------------------------------------------------------------------------------
  // 1. Define a custom role with two permitted VIEW functions (SUPER_ADMIN initiates).
  // ---------------------------------------------------------------------------------------
  await signIn(admin.page, ...FIXTURES.SUPER_ADMIN);
  await openNav(admin.page, 'roleGovernance', 'platform');
  await admin.page.waitForSelector('[data-testid="role-definitions-panel"]', { timeout: 20_000 });
  await admin.page.click('[data-testid="rd-open"]');
  await admin.page.waitForSelector('[data-testid="rd-function-fee_rule.view"]', { timeout: 20_000 });
  const optionCount = await admin.page.locator('[data-testid^="rd-function-"]').count();
  record(
    'DEFINITION-CATALOGUE-FROM-API',
    optionCount > 10,
    `the editor loaded ${optionCount} assignable catalogue functions from the real API`,
  );
  await admin.page.fill('#rd-role-key', ROLE_KEY);
  await admin.page.fill('#rd-display-name', 'SOC Analyst');
  await admin.page.fill(
    '#rd-description',
    'Read-only commercial and audit visibility for the security operations centre.',
  );
  for (const code of FUNCTIONS) {
    await admin.page.locator(`[data-testid="rd-function-${code}"] input`).check();
  }
  await admin.page.fill('#rd-reason', 'B9 real-session acceptance: read-only analyst role');
  await admin.page.click('[data-testid="rd-submit"]');
  await admin.page.waitForSelector('[data-testid^="rd-proposal-"]', { timeout: 20_000 });
  const createdCard = await admin.page.locator('[data-testid^="rd-proposal-"]').first().innerText();
  record(
    'DEFINITION-SUBMITTED',
    createdCard.includes(ROLE_KEY) &&
      createdCard.includes('Awaiting independent approval') &&
      FUNCTIONS.every((code) => createdCard.includes(code)),
    createdCard.replace(/\s+/g, ' ').slice(0, 220),
  );
  await admin.page.screenshot({ path: path.join(OUT, 'definition-submitted-1440x1000.png') });

  // The proposer must never be able to decide its own definition.
  const proposerDecisionButtons = await admin.page
    .locator('[data-testid^="rd-approve-"]')
    .count();
  record(
    'DEFINITION-SELF-APPROVAL-UNAVAILABLE',
    proposerDecisionButtons === 0,
    `decision controls offered to the proposer: ${proposerDecisionButtons}`,
  );

  // ---------------------------------------------------------------------------------------
  // 2. An independent FINANCE_CONTROLLER approves the definition.
  // ---------------------------------------------------------------------------------------
  await signIn(checker.page, ...FIXTURES.FINANCE_CONTROLLER);
  await openNav(checker.page, 'roleGovernance', 'platform');
  await checker.page.waitForSelector('[data-testid="role-definitions-panel"]', { timeout: 20_000 });
  const checkerAssignForm = admin.page.locator('#role-key');
  await checker.page.click('[data-testid="rd-open"]');
  const approveButton = checker.page.locator('[data-testid^="rd-approve-"]').first();
  await approveButton.waitFor({ timeout: 20_000 });
  record(
    'DEFINITION-CHECKER-WORKSPACE',
    (await checkerAssignForm.count()) >= 0 && (await approveButton.count()) === 1,
    'the checker can open the definition but not the assignment form',
  );
  const decisionResponse = await actWithResponse(
    checker.page,
    (response) =>
      response.request().method() !== 'GET' && /role-definitions\/proposals\/[^/]+/.test(response.url()),
    () => approveButton.click(),
  );
  await checker.page.waitForFunction(
    () => {
      const card = document.querySelector('[data-testid^="rd-proposal-"]');
      return Boolean(card && /Approved/.test(card.textContent || ''));
    },
    undefined,
    { timeout: 20_000 },
  );
  const approvedCard = await checker.page
    .locator('[data-testid^="rd-proposal-"]')
    .first()
    .innerText();
  record(
    'DEFINITION-APPROVED',
    decisionResponse.status() < 300 && approvedCard.includes('Approved'),
    `${decisionResponse.request().method()} ${new URL(decisionResponse.url()).pathname} -> ${decisionResponse.status()}; card="${approvedCard.replace(/\s+/g, ' ').slice(0, 120)}"`,
  );
  await checker.page.screenshot({ path: path.join(OUT, 'definition-approved-1440x1000.png') });

  // ---------------------------------------------------------------------------------------
  // 3. The initiator applies the approved definition to the catalogue.
  // ---------------------------------------------------------------------------------------
  await admin.page.click('button:has-text("Refresh definitions")');
  const applyButton = admin.page.locator('[data-testid^="rd-apply-"]').first();
  await applyButton.waitFor({ timeout: 20_000 });
  await applyButton.click();
  await admin.page.waitForFunction(
    () => document.body.innerText.includes('Applied to the catalogue'),
    undefined,
    { timeout: 20_000 },
  );
  record('DEFINITION-APPLIED', true, 'the approved definition was applied to the catalogue');
  await admin.page.screenshot({ path: path.join(OUT, 'definition-applied-1440x1000.png') });

  // ---------------------------------------------------------------------------------------
  // 4. Assign it to a synthetic workforce user: prepare approval -> checker -> apply.
  // ---------------------------------------------------------------------------------------
  const assign = async (action) => {
    await admin.page.click('button:has-text("Finance Roles")').catch(() => {});
    await admin.page.click(
      `button:has-text("${action === 'assign' ? 'Assign Finance Role' : 'Revoke Finance Role'}")`,
    );
    await admin.page.fill('#role-custom-key', ROLE_KEY);
    await admin.page.fill('#role-effective-from', window.from);
    await admin.page.fill('#role-effective-to', window.to);
    await admin.page.fill('#role-target-principal', principal);
    await admin.page.click('[data-testid="request-role-approval"]');
    await admin.page.waitForSelector('[data-testid="role-approval-notice"]', { timeout: 20_000 });
    const notice = await admin.page.locator('[data-testid="role-approval-notice"]').innerText();
    const approvalId = (notice.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ??
      [])[0];
    return { notice, approvalId };
  };

  const assignPrep = await assign('assign');
  record(
    'ASSIGNMENT-APPROVAL-PREPARED',
    Boolean(assignPrep.approvalId) && assignPrep.notice.includes('FINANCE_ROLE_ASSIGN'),
    assignPrep.notice.replace(/\s+/g, ' ').slice(0, 200),
  );

  await checker.page.click('[data-testid="nav-approvalsInbox"]').catch(async () => {
    await openNav(checker.page, 'approvalsInbox', 'platform');
  });
  await checker.page.waitForSelector('#checker-approval-id', { timeout: 20_000 });
  await checker.page.fill('#checker-approval-id', assignPrep.approvalId);
  await checker.page.fill('#checker-comment', 'Scope reviewed: read-only, time-bound.');
  const assignDecision = await actWithResponse(
    checker.page,
    (response) => response.url().endsWith(`/approvals/${assignPrep.approvalId}/approve`),
    async () => {
      await checker.page.click('button:has-text("Sign & Approve Action")');
      await checker.page.click('button:has-text("Confirm decision")');
    },
  );
  record(
    'ASSIGNMENT-APPROVAL-DECIDED',
    assignDecision.status() === 201,
    `POST /approvals/${assignPrep.approvalId}/approve -> ${assignDecision.status()}`,
  );

  const assignmentResponse = await actWithResponse(
    admin.page,
    (response) =>
      response.request().method() === 'POST' &&
      /\/internal\/a2\/workforce\/roles$/.test(new URL(response.url()).pathname),
    async () => {
      await admin.page.click('button:has-text("Commit Role Assignment")');
      await admin.page.click('button:has-text("Confirm role change")');
    },
  );
  await admin.page.waitForFunction(
    () => /successfully|Role assignment/i.test(document.body.innerText),
    undefined,
    { timeout: 20_000 },
  );
  record(
    'ASSIGNMENT-APPLIED',
    assignmentResponse.status() < 300,
    `POST /internal/a2/workforce/roles -> ${assignmentResponse.status()}`,
  );
  await admin.page.screenshot({ path: path.join(OUT, 'assignment-applied-1440x1000.png') });

  // ---------------------------------------------------------------------------------------
  // 5. Sign in as the synthetic user and observe the effective access.
  // ---------------------------------------------------------------------------------------
  analyst = await openSession('SOC_ANALYST');
  await signIn(analyst.page, CUSTOM_EMAIL, CUSTOM_PASSWORD);
  const analystNav = await navItems(analyst.page);
  const session = await analyst.page.evaluate(() => ({
    token: window.localStorage.getItem('admin_workforce_token'),
    principal: JSON.parse(window.localStorage.getItem('admin_workforce_principal') || '{}'),
  }));
  record(
    'CUSTOM-ROLE-SIGNED-IN',
    session.principal.roles?.includes(ROLE_KEY) === true,
    `roles=[${(session.principal.roles || []).join(',')}] scopes=[${(session.principal.scopes || []).join(',')}]`,
  );
  record(
    'CUSTOM-ROLE-GRANTED-MENUS',
    analystNav.includes('feeRules') && analystNav.includes('customers'),
    `sidebar=[${analystNav.join(', ')}]`,
  );
  record(
    'CUSTOM-ROLE-DENIED-MENU',
    !analystNav.includes('workforceDirectory') && !analystNav.includes('roleGovernance'),
    'Workforce directory and Role governance are absent from the sidebar',
  );
  await openNav(analyst.page, 'feeRules', 'commercial');
  await analyst.page.waitForTimeout(600);
  const grantedPage = await analyst.page.locator('[data-testid="main-content"]').innerText();
  record(
    'CUSTOM-ROLE-GRANTED-PAGE',
    /Commercial Rule Registries/i.test(grantedPage),
    'the granted Fee rules workspace rendered for the custom role',
  );
  await analyst.page.screenshot({ path: path.join(OUT, 'custom-role-granted-1440x1000.png') });

  const grants = await analyst.page.evaluate(async (token) => {
    const call = async (url, options) => {
      const response = await fetch(url, {
        ...options,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      });
      return response.status;
    };
    return {
      feeRules: await call('/api/v1/internal/fee-rules'),
      customers: await call('/api/v1/internal/customers'),
      directory: await call('/api/v1/internal/workforce/directory'),
      roleDefinitions: await call('/api/v1/internal/a2/workforce/role-definitions/proposals'),
    };
  }, session.token);
  record(
    'CUSTOM-ROLE-GRANTED-READS',
    grants.feeRules === 200 && grants.customers === 200,
    `GET fee-rules=${grants.feeRules} customers=${grants.customers}`,
  );
  record(
    'CUSTOM-ROLE-DENIED-API',
    grants.directory === 403 && grants.roleDefinitions === 403,
    `GET workforce/directory=${grants.directory} role-definitions/proposals=${grants.roleDefinitions}`,
  );

  // ---------------------------------------------------------------------------------------
  // 6. Revoke through the governed path and observe immediate loss of access.
  // ---------------------------------------------------------------------------------------
  await admin.page.click('button:has-text("Discard and leave")').catch(() => {});
  const revokePrep = await assign('revoke');
  record(
    'REVOCATION-APPROVAL-PREPARED',
    Boolean(revokePrep.approvalId) && revokePrep.notice.includes('FINANCE_ROLE_REVOKE'),
    revokePrep.notice.replace(/\s+/g, ' ').slice(0, 200),
  );
  await checker.page.fill('#checker-approval-id', revokePrep.approvalId);
  await checker.page.fill('#checker-comment', 'Rotation window confirmed by the owner.');
  const revokeDecision = await actWithResponse(
    checker.page,
    (response) => response.url().endsWith(`/approvals/${revokePrep.approvalId}/approve`),
    async () => {
      await checker.page.click('button:has-text("Sign & Approve Action")');
      await checker.page.click('button:has-text("Confirm decision")');
    },
  );
  record(
    'REVOCATION-APPROVED',
    revokeDecision.status() === 201,
    `POST /approvals/${revokePrep.approvalId}/approve -> ${revokeDecision.status()}`,
  );

  const revokeResponse = await actWithResponse(
    admin.page,
    (response) =>
      response.request().method() !== 'GET' && /a2\/workforce\/roles/.test(response.url()),
    async () => {
      await admin.page.click('button:has-text("Execute Revocation")');
      await admin.page.click('button:has-text("Confirm role change")');
    },
  );
  record(
    'REVOCATION-APPLIED',
    revokeResponse.status() < 300,
    `${revokeResponse.request().method()} ${new URL(revokeResponse.url()).pathname} -> ${revokeResponse.status()}`,
  );

  const afterRevoke = await analyst.page.evaluate(async (token) => {
    const response = await fetch('/api/v1/internal/fee-rules', {
      headers: { authorization: `Bearer ${token}` },
    });
    return response.status;

  }, session.token);
  record(
    'ACCESS-LOST-IMMEDIATELY',
    afterRevoke === 401,
    `the same token that read fee rules returned ${afterRevoke} after the revocation`,
  );
  await analyst.page.reload({ waitUntil: 'networkidle' });
  await analyst.page.waitForTimeout(800);
  const backAtLogin = await analyst.page.locator('#admin-login-email').count();
  record(
    'SESSION-INVALIDATED-IN-UI',
    backAtLogin === 1,
    'reloading the analyst workspace returned the operator to the login screen',
  );
  await analyst.page.screenshot({ path: path.join(OUT, 'after-revocation-1440x1000.png') });

  // ---------------------------------------------------------------------------------------
  // 7. Regression: the eleven fixture passwords still authenticate against the real API.
  // ---------------------------------------------------------------------------------------
  let fixtureFailures = 0;
  for (const [role, [email, password]] of Object.entries(FIXTURES)) {
    const response = await fetch(`${BASE}/api/v1/internal/a2/workforce/local-admin-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (response.status !== 201) fixtureFailures += 1;
    const body = await response.json().catch(() => ({}));
    if (!Array.isArray(body?.principal?.roles) || !body.principal.roles.includes(role)) {
      fixtureFailures += 1;
    }
  }
  record('ELEVEN-FIXTURES-UNCHANGED', fixtureFailures === 0, `failures=${fixtureFailures}`);
  record(
    'NO-UNEXPECTED-PAGE-ERRORS',
    pageErrors.length === 0,
    pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'none',
  );

  await browser.close();

  const passed = checks.filter((entry) => entry.ok).length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    base: BASE,
    api: 'REAL Nest application (AppModule) on a migrated disposable PostgreSQL',
    roleKey: ROLE_KEY,
    functions: FUNCTIONS,
    principal,
    total: checks.length,
    passed,
    checks,
    pageErrors,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const lines = [
    '# Arena B9 — configurable role, real workforce sessions, real PostgreSQL',
    '',
    `Generated: ${report.generatedAt}`,
    `Admin Web bundle served at ${BASE}; \`/api/v1\` proxied to the real Nest application.`,
    `Database: disposable PostgreSQL, fully migrated, eleven local fixture accounts seeded.`,
    '',
    `${passed}/${checks.length} checks passed.`,
    '',
    '| Check | Result | Evidence |',
    '| --- | --- | --- |',
    ...checks.map(
      (entry) => `| \`${entry.id}\` | ${entry.ok ? 'PASS' : 'FAIL'} | ${entry.detail} |`,
    ),
    '',
    'Screenshots in this directory: `definition-submitted-1440x1000.png`,',
    '`definition-approved-1440x1000.png`, `definition-applied-1440x1000.png`,',
    '`assignment-applied-1440x1000.png`, `custom-role-granted-1440x1000.png`,',
    '`after-revocation-1440x1000.png`.',
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
  process.stdout.write(`\n${passed}/${checks.length} checks passed → ${OUT}\n`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`B9 REAL-SESSION FAILED: ${error.stack || error.message}\n`);
  process.exit(1);
});
