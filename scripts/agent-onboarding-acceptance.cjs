#!/usr/bin/env node
/**
 * Agent onboarding acceptance walkthrough — draft → submission → review → approval → activation.
 *
 * WHAT THIS IS
 *   A real Chromium driving the REAL Admin Web dev server, which proxies to the REAL API server,
 *   which is backed by a disposable local PostgreSQL with synthetic data. Nothing is stubbed at
 *   the network layer: every screen state below comes from a genuine HTTP response, and every
 *   write goes through the same governed endpoints production would use.
 *
 *   That is deliberately different from `scripts/admin-web-browser-acceptance.cjs`, which stubs the
 *   API and is explicit that it certifies the client only. This script certifies the SEAM.
 *
 * WHY THE API IS NOT `dist/main.js`
 *   `dist/main.js` refuses to start while eight financial dependencies are unverified. That refusal
 *   is correct and is not worked around here — the launcher (`scripts/local-dev-api-server.js`)
 *   prints the verdict and the blockers on every start, binds to 127.0.0.1 only, and refuses a
 *   non-disposable target. See the PR body for the exact output.
 *
 * WHAT IT WALKS
 *   1. sign in as the maker (AGENT_NETWORK_MANAGER) with the existing local role account
 *   2. open the onboarding form and prove NO class is pre-selected
 *   3. attempt to save without a class — refused
 *   4. choose a class explicitly and watch its declared requirements appear
 *   5. save the draft, then submit it for review
 *   6. sign in as an independent reviewer and move it through review → approval
 *   7. open the pre-activation configuration review: selected class, eligible services, effective
 *      fees, commissions and limits
 *   8. activate, then verify the persisted Agent carries the class that was chosen and that the
 *      class actually governs the Agent's services
 *   9. show the missing-configuration state with a class that has no limit profile and no fee rule
 *
 * Usage:
 *   node scripts/agent-onboarding-acceptance.cjs \
 *     --executable /tmp/chromium --lib-path /tmp/al2023/lib \
 *     --admin-web http://127.0.0.1:5173 --api http://127.0.0.1:3000/api/v1 \
 *     --out apps/admin-web/acceptance-evidence/agent-onboarding
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    executable: '/tmp/chromium',
    'lib-path': '/tmp/al2023/lib',
    'admin-web': 'http://127.0.0.1:5173',
    api: 'http://127.0.0.1:3000/api/v1',
    out: 'apps/admin-web/acceptance-evidence/agent-onboarding',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));
const EVIDENCE = path.resolve(ROOT, ARGS.out);

/**
 * Existing local role accounts. These are the fixtures `scripts/local-dev-seed-11-roles.js` creates;
 * they are reused verbatim so the acceptance run cannot drift from what a developer actually has.
 */
const ACCOUNTS = {
  maker: { email: 'agent-network-manager@monienaija.local', password: 'MonieNaija_AGENT_NETWORK_MANAGER_123!' },
  // Only AGENT_NETWORK_MANAGER and SUPER_ADMIN hold `agent.review_application` (verified against the
  // live catalogue), so SUPER_ADMIN is the only existing account that can act as an independent
  // reviewer for a maker holding AGENT_NETWORK_MANAGER. ADMINISTRATOR holds agent.view only.
  reviewer: { email: 'super-admin@monienaija.local', password: 'MonieNaija_SUPER_ADMIN_123!' },
};

const steps = [];
const shots = [];
/* Deviations from the acceptance criteria that a human must read — recorded, not swallowed. */
const findings = [];

function record(step, detail) {
  steps.push({ step, detail });
  process.stdout.write(`  ✓ ${step}${detail ? ` — ${detail}` : ''}\n`);
}

async function api(pathname, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${ARGS.api}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/**
 * Read-only SQL against the same disposable database the API is using. Used only to prove that
 * what the API reported is what was actually persisted; the walkthrough itself never writes here.
 */
async function query(sql, params = []) {
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'monienaija',
    password: process.env.DB_PASSWORD || 'monienaija-pw',
    database: process.env.DB_NAME || 'monienaija',
  });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function signIn(account) {
  const res = await api('/internal/a2/workforce/local-admin-sessions', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  if (![200, 201].includes(res.status)) {
    throw new Error(`sign-in failed for ${account.email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Load the console as `session` and navigate the way an operator does: expand "Customers & agents"
 * in the rail, then choose the Agent Network leaf. Clicking the dashboard's action item would reach
 * the same view, but the rail path exercises the navigation-access gate as well as the screen.
 *
 * This has to run after every account switch: the console opens on the Dashboard, so a bare reload
 * leaves the reviewer staring at a dashboard instead of the application they are deciding on.
 */
let page;

async function openAgentNetwork(session) {
  await page.goto(`${ARGS['admin-web']}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ([token, sessionId, principal]) => {
      localStorage.setItem('admin_workforce_token', token);
      localStorage.setItem('admin_workforce_session_id', sessionId);
      localStorage.setItem('admin_workforce_principal', principal);
    },
    [session.accessToken, session.sessionId, JSON.stringify(session.principal)],
  );
  await page.goto(`${ARGS['admin-web']}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  const section = page.getByRole('button', { name: /Customers & agents/i }).first();
  if (await section.count()) {
    await section.click();
    await page.waitForTimeout(500);
  }
  // The leaf label is permission-dependent: privileged principals see "Agents & network", the agent
  // operator workspace sees "Agent network". Match both, or the click silently lands nowhere.
  const leafName = /^(Agent network|Agents & network)$/i;
  const agentNetworkLeaf = page
    .getByRole('button', { name: leafName })
    .or(page.getByRole('link', { name: leafName }))
    .first();
  if (await agentNetworkLeaf.count()) {
    await agentNetworkLeaf.click();
  } else {
    // Fall back to the dashboard action item, which routes to the same view.
    await page.getByText(leafName).first().click().catch(() => {});
  }
  await page.waitForTimeout(2000);
  // Prove the screen actually loaded instead of proceeding on a stale view.
  await page
    .getByRole('button', { name: 'New Agent Application' })
    .first()
    .waitFor({ state: 'visible', timeout: 25000 })
    .catch(() => {
      throw new Error(`Agent Network did not load for ${session.principal.scopes?.length} scopes`);
    });

  /*
   * The onboarding table is NOT loaded on mount — it is behind "Load applications". Skipping this
   * leaves an empty table that looks identical to "no applications exist", which is exactly the kind
   * of screenshot that misleads a reviewer.
   */
  const loadButton = page.getByRole('button', { name: 'Load applications' }).first();
  if (await loadButton.count()) {
    await loadButton.click();
    await page.waitForTimeout(2000);
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  const { chromium } = require('playwright-core');
  const { inflate } = require('@sparticuz/chromium');
  const sparticuz = require('@sparticuz/chromium').default;
  // The serverless Chromium build needs its AL2023 shared libraries on the loader path.
  await inflate(path.join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));

  const browser = await chromium.launch({
    executablePath: ARGS.executable,
    args: [...sparticuz.args, '--no-sandbox', '--disable-dev-shm-usage'],
    headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: `${ARGS['lib-path']}:${process.env.LD_LIBRARY_PATH ?? ''}` },
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();

  /** Screenshot + record a step. Every shot is a real render of a real response. */
  async function shot(name, note, target = null) {
    const file = path.join(EVIDENCE, `${String(shots.length + 1).padStart(2, '0')}-${name}.png`);
    if (target) {
      /*
       * Photograph the subject, not the whole page. The review queue accumulates applications from
       * every run, so a full-page capture is a wall of neighbouring rows in which the thing being
       * demonstrated is unreadable.
       */
      await target.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
    shots.push({ file: path.relative(ROOT, file), note });
    record(name.replace(/-/g, ' '), note);
    return file;
  }

  // ---------------------------------------------------------------- synthetic identifiers
  const runTag = randomUUID().slice(0, 8).toUpperCase();
  const applicantReference = `ACC-AGT-${runTag}`;

  // ---------------------------------------------------------------- 1. sign in as maker
  const maker = await signIn(ACCOUNTS.maker);
  record(
    'maker session',
    `${ACCOUNTS.maker.email} roles=${maker.principal.roles.join(',')} scopes=${maker.principal.scopes.length}`,
  );

  await openAgentNetwork(maker);
  await shot('maker-signed-in', `signed in as ${ACCOUNTS.maker.email}; Agent Network loaded`);

  // ---------------------------------------------------------------- 2-5. onboarding
  const newApplication = page.getByRole('button', { name: 'New Agent Application' });
  await newApplication.waitFor({ state: 'visible', timeout: 30000 });
  await newApplication.click();
  await page.waitForTimeout(800);

  const classSelect = page.getByLabel('Application Agent class');
  await classSelect.waitFor({ state: 'visible', timeout: 20000 });

  // NO CLASS PRE-SELECTED. This is the assertion the whole "approved default" change exists for.
  const preselected = await classSelect.inputValue();
  const provenance = await page.getByTestId('onboarding-class-provenance').innerText();
  if (preselected !== '') {
    throw new Error(`expected no pre-selected class, found "${preselected}"`);
  }
  await shot(
    'no-class-preselected',
    `class selector empty; provenance states: "${provenance.trim()}"`,
  );

  // Saving with a class missing must be refused, and no POST may escape.
  let sawPost = false;
  const onRequest = (req) => {
    if (req.method() === 'POST' && req.url().includes('/agents/applications')) sawPost = true;
  };
  page.on('request', onRequest);
  await page.getByLabel(/Applicant reference/i).fill(applicantReference);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForTimeout(600);
  const classRequiredVisible = await page.getByTestId('onboarding-class-required').count();
  await shot(
    'class-selection-required',
    `save refused without a class (notice visible=${classRequiredVisible > 0}); POST issued=${sawPost}`,
  );
  if (sawPost) throw new Error('a draft POST escaped while the class was unselected');

  // Choose explicitly, and show the class's declared requirements appear.
  const classes = await api('/internal/agents/classes', { token: maker.accessToken });
  const targetClass = classes.body.find((c) => c.code === 'DEMO_ORDINARY_L1');
  if (!targetClass) throw new Error('DEMO_ORDINARY_L1 not found in the class catalogue');
  await classSelect.selectOption(targetClass.id);
  await page.waitForTimeout(600);
  const selectedProvenance = await page.getByTestId('onboarding-class-provenance').innerText();
  await shot(
    'class-explicitly-selected',
    `selected ${targetClass.name} (${targetClass.code}); provenance: "${selectedProvenance.trim()}"`,
  );

  /*
   * Requirements declared by the class appear as required fields, one input each. Fill every one
   * that rendered: the form refuses submission on any unfilled class-declared requirement, and
   * guessing only `bvn` would leave the rest to fail later.
   */
  const declaredInfoInputs = page.getByLabel(/^Required info:/);
  const infoCount = await declaredInfoInputs.count();
  for (let i = 0; i < infoCount; i += 1) {
    const input = declaredInfoInputs.nth(i);
    const label = (await input.getAttribute('aria-label')) ?? '';
    const value = /bvn/i.test(label) ? String(Date.now()).slice(-11) : `SYNTH-${runTag}-${i + 1}`;
    await input.fill(value);
  }
  await shot(
    'class-requirements',
    infoCount > 0
      ? `${infoCount} class-declared requirement field(s) rendered and filled`
      : 'class declares no extra information requirements',
  );

  await page.getByLabel(/Business name/i).fill(`Acceptance Agent ${runTag}`).catch(() => {});
  await page.getByLabel(/Contact email/i).fill(`acceptance-${runTag.toLowerCase()}@example.invalid`).catch(() => {});
  await page.getByLabel('Principal contact name').fill(`Acceptance Contact ${runTag}`).catch(() => {});
  await page.getByLabel('Contact phone').fill('08000000000').catch(() => {});
  await page.getByLabel('Operating address').fill(`Synthetic Acceptance Address ${runTag}`).catch(() => {});
  await page
    .getByLabel('Primary evidence reference')
    .fill(`KYC-${runTag}`)
    .catch(() => {});

  /*
   * The class declares required document EVIDENCE categories, and the form renders one input per
   * category. These are references a human supplied for verification — deliberately not uploads,
   * because the local launcher keeps document uploads disabled — so fill each declared category.
   */
  const declaredDocInputs = page.getByLabel(/^Required evidence:/);
  const docCount = await declaredDocInputs.count();
  for (let i = 0; i < docCount; i += 1) {
    await declaredDocInputs.nth(i).fill(`EV-${runTag}-${i + 1}`);
  }
  if (docCount > 0) {
    record('class-required evidence', `${docCount} declared evidence reference(s) supplied`);
  }

  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForTimeout(1500);
  page.off('request', onRequest);
  await shot('draft-saved', `draft created for ${applicantReference}`);

  // Find the draft through the API to get its id, then submit it from the UI.
  const drafts = await api('/internal/agents/applications', { token: maker.accessToken });
  const draft = drafts.body.find((a) => a.applicantReference === applicantReference && a.status === 'DRAFT');
  if (!draft) throw new Error('draft was not persisted');
  record('draft persisted', `${draft.reference} status=${draft.status} class=${draft.agentClassId}`);

  const submitButton = page.getByRole('button', { name: 'Submit application' });
  await submitButton.click();
  /*
   * Submission is a real POST — poll the API rather than trusting a screenshot delay. A fixed sleep
   * would make this assertion a race with the backend, which is exactly the kind of flake that makes
   * evidence untrustworthy.
   */
  let submitted = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const afterSubmit = await api('/internal/agents/applications', { token: maker.accessToken });
    submitted = afterSubmit.body.find((a) => a.id === draft.id);
    if (submitted && submitted.status !== 'DRAFT') break;
    await page.waitForTimeout(500);
  }
  if (!submitted || submitted.status === 'DRAFT') {
    // Diagnose instead of guessing: dump whatever the form is telling the operator.
    const bodyText = await page.locator('body').innerText();
    fs.writeFileSync(path.join(EVIDENCE, 'submit-diagnostic.txt'), bodyText);
    const errors = bodyText
      .split('\n')
      .filter((line) => /required|not confirmed|failed|cannot|must /i.test(line))
      .slice(0, 12);
    process.stdout.write(`  ! submit diagnostics: ${JSON.stringify(errors)}\n`);
  }
  await shot('submitted-for-review', `application ${draft.reference} status=${submitted?.status}`);
  if (!submitted || submitted.status !== 'SUBMITTED') {
    throw new Error(`expected SUBMITTED, got ${submitted && submitted.status}`);
  }
  record('submission confirmed', `status=${submitted.status} submittedAt=${submitted.submittedAt}`);

  // ---------------------------------------------------------------- 6. independent review
  const reviewer = await signIn(ACCOUNTS.reviewer);
  record(
    'independent reviewer session',
    `${ACCOUNTS.reviewer.email} — a different principal from the maker (${maker.principal.principalId.slice(-8)} vs ${reviewer.principal.principalId.slice(-8)})`,
  );
  if (reviewer.principal.principalId === maker.principal.principalId) {
    throw new Error('reviewer and maker are the same principal; independence is not demonstrated');
  }

  /*
   * Separation of duties is checked, not assumed — but on a THROWAWAY second application, so the
   * walkthrough application below is only ever driven by the independent reviewer. Probing on the
   * real record would either contaminate the evidence or abort the whole run.
   */
  // Creation is the public applicant endpoint and returns a one-time capability, so the probe is
  // created the same way a member of the public would create it.
  const probe = await api('/agents/applications', {
    method: 'POST',
    body: {
      applicantReference: `ACC-SOD-${runTag}`,
      agentClassId: targetClass.id,
      businessName: `SOD Probe ${runTag}`,
      contactEmail: `sod-${runTag.toLowerCase()}@example.test`,
    },
  });
  const probeId = probe.body?.id;
  let sodAttempt = { status: 0, body: {} };
  let probeState = null;
  if (probeId) {
    // The one-time applicant capability, returned only by the create response.
    await api(`/agents/applications/${probeId}/submit`, {
      token: probe.body.applicantAccessToken,
      method: 'POST',
    });
    sodAttempt = await api(`/internal/agents/applications/${probeId}/approve`, {
      token: maker.accessToken,
      method: 'POST',
    });
    const probeList = await api('/internal/agents/applications', { token: maker.accessToken });
    probeState = probeList.body.find((a) => a.id === probeId);
  }
  record(
    'separation of duties (throwaway application)',
    probeId
      ? `maker approve attempt -> HTTP ${sodAttempt.status}; application state=${probeState?.status}` +
        (probeState?.status === 'APPROVED'
          ? ' — FINDING: the submitting principal holds agent.review_application so the API accepts a ' +
            'self-approval; there is no maker!=checker guard in AgentApplicationService.approve() and no ' +
            'AGENT_APPLICATION_APPROVE maker-checker rule in the governed-action registry'
          : ' — self-approval refused')
      : `probe application could not be created: HTTP ${probe.status} ${JSON.stringify(probe.body).slice(0, 240)}`,
  );
  if (probeState?.status === 'APPROVED') {
    findings.push(
      'Self-approval is accepted: a principal holding agent.review_application can approve the ' +
        'application it submitted. Approval is gated by function scope only; no maker!=checker ' +
        'signature or governed-action rule applies. Enforced independence was NOT demonstrated.',
    );
  }
  const probeApproved = probeState?.status === 'APPROVED';

  // Drive the review/approve transitions through the same governed endpoints the UI calls.
  const underReview = await api(`/internal/agents/applications/${draft.id}/review`, {
    token: reviewer.accessToken,
    method: 'POST',
  });
  record('review', `POST /review -> ${underReview.status} status=${underReview.body?.status}`);
  const approved = await api(`/internal/agents/applications/${draft.id}/approve`, {
    token: reviewer.accessToken,
    method: 'POST',
  });
  record('approval', `POST /approve -> ${approved.status} status=${approved.body?.status}`);
  if (approved.body?.status !== 'APPROVED') {
    throw new Error(`approval did not reach APPROVED: ${JSON.stringify(approved.body).slice(0, 300)}`);
  }

  // Reload the console as the reviewer so the APPROVED row (and the pre-activation panel) render.
  await openAgentNetwork(reviewer);
  await shot('approved-awaiting-activation', `application ${draft.reference} is APPROVED and awaiting activation`);

  // ---------------------------------------------------------------- 7. pre-activation review
  /*
   * Everything below is scoped to this application's own row. Other applications (including the
   * separation-of-duties probe) are listed on the same page and also carry an "Activate agent"
   * button; matching the first one on the page activates the wrong record.
   */
  const row = page.getByTestId(`application-row-${draft.id}`).first();
  await row.waitFor({ state: 'visible', timeout: 25000 });

  const toggle = row.getByTestId('onboarding-pre-activation-toggle').first();
  await toggle.waitFor({ state: 'visible', timeout: 20000 });
  await toggle.click();
  await page.waitForTimeout(2500);

  const classText = await row.getByTestId('pre-activation-class').first().innerText();
  const servicesText = await row.getByTestId('pre-activation-services').first().innerText();
  if (/not in the loaded catalogue/i.test(classText)) {
    throw new Error(
      `the pre-activation panel could not resolve class ${targetClass.code}: "${classText.trim()}"`,
    );
  }
  if (/none/i.test(servicesText)) {
    throw new Error(
      `the pre-activation panel reported no eligible services for ${targetClass.code}: "${servicesText.trim()}"`,
    );
  }
  await shot(
    'pre-activation-class-and-services',
    `class: "${classText.trim()}" | services: "${servicesText.trim()}"`,
    row,
  );

  const pricingTable = row.getByTestId('pre-activation-pricing').first();
  const pricingText = (await pricingTable.count()) ? await pricingTable.innerText() : '(none)';
  const limitsText = (await row.getByTestId('pre-activation-limits').first().count())
    ? await row.getByTestId('pre-activation-limits').first().innerText()
    : '(none)';
  await shot(
    'pre-activation-fees-commissions-limits',
    `limits: "${limitsText.trim().slice(0, 120)}" | pricing: "${pricingText.replace(/\s+/g, ' ').trim().slice(0, 200)}"`,
    row,
  );

  const gapsVisible = await row.getByTestId('pre-activation-gaps').count();
  await shot(
    'pre-activation-gaps',
    gapsVisible > 0
      ? 'missing configuration surfaced before activation'
      : 'no configuration gaps for this class',
    row,
  );

  // ---------------------------------------------------------------- 8. activation
  await row.getByRole('button', { name: 'Activate agent' }).first().click();

  /*
   * Poll for the Agent to reach ACTIVE instead of trusting a sleep: activation allocates a
   * receiving number and audits in the same transaction, so a screenshot taken too early shows a
   * PENDING Agent and would be read as "activation did nothing".
   */
  let activatedApp = null;
  let agentStatus = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const activated = await api('/internal/agents/applications', { token: reviewer.accessToken });
    activatedApp = activated.body.find((a) => a.id === draft.id);
    if (activatedApp?.agentId) {
      const row = await api(`/internal/agents/${activatedApp.agentId}`, { token: reviewer.accessToken });
      agentStatus = row.body?.status ?? null;
      if (agentStatus === 'ACTIVE') break;
    }
    await page.waitForTimeout(500);
  }
  await shot('activated', `application ${draft.reference} → Agent ${agentStatus}`);
  record(
    'activation receipt',
    `applicationStatus=${activatedApp?.status} agentId=${activatedApp?.agentId} agentStatus=${agentStatus} linkedAgentStatus=${activatedApp?.linkedAgentStatus}`,
  );
  if (!activatedApp?.agentId) throw new Error('activation produced no agentId');
  if (agentStatus !== 'ACTIVE') {
    throw new Error(`the Agent reached ${agentStatus}, not ACTIVE, after clicking Activate agent`);
  }

  // ---------------------------------------------------------------- 9. persisted class governs
  const agent = await api(`/internal/agents/${activatedApp.agentId}`, { token: maker.accessToken });
  const readiness = await api(`/internal/agents/${activatedApp.agentId}/class/readiness`, {
    token: maker.accessToken,
  });
  const persistedClassId = agent.body.agentClassId;
  if (persistedClassId !== targetClass.id) {
    throw new Error(
      `activated Agent carries class ${persistedClassId}, expected the explicitly chosen ${targetClass.id}`,
    );
  }
  const governingServices = (readiness.body.allowedServices ?? []).slice().sort().join(',');
  const expectedServices = (targetClass.applicableServices ?? []).slice().sort().join(',');
  if (governingServices !== expectedServices) {
    throw new Error(
      `the class does not govern the Agent's services: allowed=${governingServices} expected=${expectedServices}`,
    );
  }
  await shot(
    'activated-agent-class-persisted',
    `agents.agent_class_id = ${persistedClassId} (the chosen class), governing services: ${governingServices}`,
  );

  const history = await api(`/internal/agents/${activatedApp.agentId}/class/history`, {
    token: maker.accessToken,
  });
  record(
    'class history',
    (Array.isArray(history.body) ? history.body.length : '?') === 0
      ? 'entries=0 — this surface records class SWITCHES only, and no switch has occurred; the ' +
        'assignment came from activation, which is verified above through agents.agent_class_id'
      : `entries=${history.body.length} — the Agent has been moved between classes since activation`,
  );

  // The class on the Agent must also be the class the activation audit recorded, not just a match.
  const activationAudit = await query(
    `SELECT action, new_values->>'agentClassId' AS class_id
       FROM audit_events
      WHERE entity_type = 'AGENT' AND entity_id = $1
      ORDER BY occurred_at ASC`,
    [activatedApp.agentId],
  );
  record(
    'activation audit trail',
    activationAudit.length
      ? activationAudit.map((row) => `${row.action}${row.class_id ? `(class ${row.class_id.slice(0, 8)})` : ''}`).join(' → ')
      : 'no AGENT audit rows recorded for this activation',
  );

  // Confirm in the database, not only through the API projection.
  const persistedRows = await query(
    'SELECT agent_class_id, status FROM agents WHERE id = $1',
    [activatedApp.agentId],
  );
  if (persistedRows[0]?.agent_class_id !== targetClass.id) {
    throw new Error(
      `agents.agent_class_id is ${persistedRows[0]?.agent_class_id}, expected ${targetClass.id}`,
    );
  }
  record(
    'persisted class confirmed in the database',
    `agents row: status=${persistedRows[0].status} agent_class_id=${persistedRows[0].agent_class_id}`,
  );

  // ---------------------------------------------------------------- 10. missing configuration
  /*
   * Create a class with permitted services but NO limit assignment and NO fee rule, and show what
   * staff see. Done through the catalogue + readiness surfaces rather than by faking a response, so
   * the empty state is the backend's own.
   */
  const admin = await signIn(ACCOUNTS.reviewer);
  const bareCode = `ACC_BARE_${runTag}`;
  const bare = await api('/internal/agents/classes', {
    token: admin.accessToken,
    method: 'POST',
    body: {
      reference: bareCode,
      code: bareCode,
      name: `Acceptance Bare Class ${runTag}`,
      description: 'Synthetic class with services but no limits or commercial rules.',
      isActive: true,
      applicableServices: ['CASH_IN'],
    },
  });
  record('bare class created', `POST /agents/classes -> ${bare.status} ${bare.body?.code ?? ''}`);

  const bareAgents = await api('/internal/agents?limit=1', { token: admin.accessToken });
  const anyAgent = bareAgents.body.data?.[0];
  if (anyAgent) {
    // Preview what the bare class would mean for an existing Agent — the impact and readiness
    // projections are read-only, so this cannot mutate anything.
    const bareReadiness = await api(
      `/internal/agents/${anyAgent.id}/class/impact-preview?targetClassId=${bare.body.id}`,
      { token: admin.accessToken },
    );
    record(
      'bare class impact',
      `canSwitch=${bareReadiness.body?.canSwitch} losses=${(bareReadiness.body?.losses ?? []).length}`,
    );
  }

  /*
   * What staff SEE, not just what the API returns. A bare class is only rendered in the review queue
   * once an application targets it, so take one through approval and open its panel — the gaps below
   * are the panel's own render, not a restatement of the API payload.
   */
  const bareApp = await api('/agents/applications', {
    method: 'POST',
    body: {
      applicantReference: `ACC-BARE-${runTag}`,
      agentClassId: bare.body.id,
      businessName: `Bare Class Applicant ${runTag}`,
      contactEmail: `bare-${runTag.toLowerCase()}@example.test`,
    },
  });
  await api(`/agents/applications/${bareApp.body.id}/submit`, {
    token: bareApp.body.applicantAccessToken,
    method: 'POST',
  });
  const bareApproved = await api(`/internal/agents/applications/${bareApp.body.id}/approve`, {
    token: admin.accessToken,
    method: 'POST',
  });
  record(
    'bare class application approved',
    `POST /approve -> ${bareApproved.status} status=${bareApproved.body?.status}`,
  );

  await openAgentNetwork(admin);
  const bareRow = page.getByTestId(`application-row-${bareApp.body.id}`).first();
  await bareRow.waitFor({ state: 'visible', timeout: 25000 });
  await bareRow.getByTestId('onboarding-pre-activation-toggle').first().click();
  await page.waitForTimeout(3000);

  const gapsText = (await bareRow.getByTestId('pre-activation-gaps').count())
    ? await bareRow.getByTestId('pre-activation-gaps').first().innerText()
    : '';
  const bareServicesText = await bareRow.getByTestId('pre-activation-services').first().innerText();
  const barePricingText = (await bareRow.getByTestId('pre-activation-pricing').count())
    ? await bareRow.getByTestId('pre-activation-pricing').first().innerText()
    : '';
  const bareLimitsText = (await bareRow.getByTestId('pre-activation-limits').count())
    ? await bareRow.getByTestId('pre-activation-limits').first().innerText()
    : '';
  await shot(
    'missing-configuration-what-staff-see',
    `gaps rendered: "${gapsText.replace(/\s+/g, ' ').trim().slice(0, 260)}"`,
    bareRow,
  );

  if (!gapsText.trim()) {
    throw new Error(
      'a class with no limit assignment, no fee rule and no commission rule rendered no configuration gaps',
    );
  }
  // The wording has to distinguish "absent" from "zero"/"unlimited", or an operator will read a
  // missing rule as a free transaction.
  if (!/(not the same as unlimited|undefined|nothing would accrue)/i.test(`${gapsText} ${barePricingText}`)) {
    throw new Error(
      `missing configuration is not explained as absent: "${gapsText.replace(/\s+/g, ' ').trim()}"`,
    );
  }
  record(
    'missing configuration explained to staff',
    `services "${bareServicesText.trim()}" | limits "${bareLimitsText.replace(/\s+/g, ' ').trim().slice(0, 80)}" | ` +
      `pricing "${barePricingText.replace(/\s+/g, ' ').trim().slice(0, 120)}" | gaps ${gapsText.split('\n').filter((l) => l.trim()).length} line(s)`,
  );

  const bareLimitsRows = await query(
    `SELECT count(*)::int AS n FROM limit_assignments
      WHERE subject_type = 'AGENT_CLASS' AND subject_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
    [bare.body.id],
  );
  const bareFeeRules = await query(
    `SELECT count(*)::int AS n FROM fee_rules
      WHERE agent_class_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
    [bare.body.id],
  );
  record(
    'missing configuration confirmed in the database',
    `limit assignments=${bareLimitsRows[0].n}, class-scoped fee rules=${bareFeeRules[0].n}, ` +
      `class=${bare.body.code} — the gaps describe genuine absence, not a failed read`,
  );

  // ---------------------------------------------------------------- report
  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      adminWeb: ARGS['admin-web'],
      api: ARGS.api,
      browser: 'Chromium (serverless build) via playwright-core',
      note:
        'Real Admin Web dev server → real API → disposable local PostgreSQL with synthetic data. No response is stubbed.',
      apiStartup:
        'API started with scripts/local-dev-api-server.js: release readiness reported as error (financial_dependencies_not_ready) and NOT bypassed; bound to 127.0.0.1 only.',
      database:
        'Disposable local PostgreSQL, fully migrated, synthetic accounts and synthetic Agent applications only.',
      productionGate:
        'dist/main.js was NOT used and was NOT modified; it still refuses to start until the release-readiness blockers clear.',
    },
    syntheticIdentifiers: {
      applicantReference,
      applicationId: draft.id,
      applicationReference: draft.reference,
      agentId: activatedApp.agentId,
      chosenClassId: targetClass.id,
      chosenClassCode: targetClass.code,
      bareClassId: bare.body.id,
      bareClassCode: bareCode,
    },
    steps,
    screenshots: shots,
    findings,
    probeApplication: { id: probeId, state: probeState?.status, selfApproveHttpStatus: sodAttempt.status, note: probeApproved ? 'walked away from: self-approval accepted by the API' : 'unused' },
  };
  fs.writeFileSync(path.join(EVIDENCE, 'report.json'), JSON.stringify(report, null, 2));

  process.stdout.write(`\nEvidence written to ${path.relative(ROOT, EVIDENCE)}\n`);
  process.stdout.write(`${shots.length} screenshots, ${steps.length} recorded steps\n`);
  if (findings.length) {
    process.stdout.write(`\n${findings.length} finding(s) that require a human decision:\n`);
    for (const item of findings) process.stdout.write(`  ! ${item}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`\nacceptance walkthrough FAILED: ${error?.stack ?? error}\n`);
  fs.writeFileSync(
    path.join(EVIDENCE, 'failure.json'),
    JSON.stringify({ at: new Date().toISOString(), steps, shots, error: String(error?.stack ?? error) }, null, 2),
  );
  process.exitCode = 1;
});
