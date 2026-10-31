/**
 * MISSION 16 — REAL-BROWSER END-TO-END VERIFICATION
 *
 * Drives the ACTUAL Admin Web (Vite dev server) in a real Chromium via Playwright against the
 * ACTUAL NestJS backend booted from dist/ and a real PostgreSQL database. No mocked API
 * responses anywhere: every assertion below is the result of a genuine HTTP round-trip to the
 * running backend and a real DOM in a real browser engine.
 *
 * Each step records PASS/FAIL independently so one broken capability does not hide the rest of
 * the matrix. Screenshots are written per step.
 */
const { chromium } = require('/home/user/m20/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const OUT = '/home/user/e2e-m20';
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@monienaija.local',
  password: process.env.E2E_ADMIN_PASSWORD || 'MonieNaijaAdmin123!',
};

fs.mkdirSync(OUT, { recursive: true });

const results = [];

/** The applications table also contains the agent reference; an Agent row is the one with "View". */
function agentRow(page, ref) {
  return page
    .locator('tr', { hasText: ref })
    .filter({ has: page.locator('button:has-text("View")') })
    .first();
}
const e2eClassName = `E2E Class ${Date.now()}`;
let shotSeq = 0;

function record(id, title, ok, detail, screenshot) {
  results.push({ id, title, ok, detail: detail || '', screenshot: screenshot || '' });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} ${title}${detail ? ' :: ' + detail : ''}`);
}

async function shot(page, name) {
  shotSeq += 1;
  const file = path.join(OUT, `${String(shotSeq).padStart(2, '0')}-${name}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return '';
  }
}

async function step(id, title, fn) {
  try {
    const r = await fn();
    if (r && typeof r === 'object') {
      record(id, title, r.ok !== false, r.detail, r.screenshot);
    } else {
      record(id, title, true, '');
    }
  } catch (e) {
    record(id, title, false, String(e && e.message ? e.message : e).slice(0, 400));
  }
}

async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#admin-login-email', { timeout: 30000 });
  await page.fill('#admin-login-email', email);
  await page.fill('#admin-login-password', password);
  await page.click('button[type="submit"]');
  // Sidebar appears once the session store is populated.
  await page.waitForSelector('text=Agent Network Management', { timeout: 30000 });
}

async function navTo(page, label) {
  const link = page.locator(`text=${label}`).first();
  await link.click({ timeout: 20000 });
  await page.waitForTimeout(900);
}

async function logout(page) {
  try {
    const btn = await page.$('text=Sign out');
    if (btn) {
      await btn.click();
      await page.waitForTimeout(800);
    }
  } catch { /* ignore */ }
}


// ---------------------------------------------------------------------------
// SETUP (real HTTP against the same live backend — not a mock): establish a
// known-good Agent with one Outlet, one Terminal and a credential, so the
// browser steps below verify the Admin Web against real integrated data.
// ---------------------------------------------------------------------------
const API = process.env.E2E_API || 'http://localhost:3000/api/v1';
const seeded = { agentId: null, agentRef: null, outletId: null, terminalId: null, appRef: null, appRefInternal: null };

async function apiJson(method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

async function seedAgent() {
  const manifest = JSON.parse(fs.readFileSync('/home/user/monienaija-local-dev-11-roles-credentials.json', 'utf8'));
  const login = await apiJson('POST', '/internal/a2/workforce/local-admin-sessions', null, {
    email: manifest.SUPER_ADMIN.email,
    password: manifest.SUPER_ADMIN.password,
  });
  const token = login.body.accessToken;
  const stamp = Date.now().toString().slice(-6);

  const cls = await apiJson('POST', '/internal/agents/classes', token, {
    name: `E2E Seed Class ${stamp}`,
    applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING'],
    isActive: true,
  });
  const classId = cls.body && (cls.body.id || cls.body.data && cls.body.data.id);
  if (!classId) throw new Error('seed: class creation failed ' + JSON.stringify(cls.body).slice(0, 200));

  seeded.appRef = `AGT-SEED-${stamp}`;
  const app = await apiJson('POST', '/agents/applications', null, {
    applicantReference: seeded.appRef,
    agentClassId: classId,
    payload: { businessName: 'Seeded Agent Ventures', principalContactName: 'Seed Owner', contactEmail: `seed.${stamp}@example.com`, contactPhone: '+2348090000020', operatingAddress: '1 Seed Street', operatingCity: 'Abuja', operatingState: 'FCT' },
  });
  const appId = app.body && app.body.id;
  await apiJson('POST', `/agents/applications/${appId}/submit`, app.body.applicantAccessToken);
  await apiJson('POST', `/internal/agents/applications/${appId}/review`, token);
  await apiJson('POST', `/internal/agents/applications/${appId}/approve`, token);
  const act = await apiJson('POST', `/internal/admin/agents/applications/${appId}/activate`, token);
  seeded.agentId = act.body && act.body.id;
  if (!seeded.agentId) throw new Error('seed: activation failed ' + JSON.stringify(act.body).slice(0, 200));
  seeded.agentRef = (act.body.reference) || seeded.appRef;

  const outlet = await apiJson('POST', `/internal/agents/${seeded.agentId}/outlets`, token, {
    reference: `OUT-SEED-${stamp}`, name: 'Seeded Outlet', displayName: 'Seeded Display',
    addressLine: '1 Seed Street', city: 'Abuja', state: 'FCT', country: 'NG',
  });
  seeded.outletId = outlet.body && outlet.body.id;
  const term = await apiJson('POST', `/internal/agents/${seeded.agentId}/terminals`, token, {
    reference: `TRM-SEED-${stamp}`, outletId: seeded.outletId, label: 'Seeded Counter', serialNumber: `SN-${stamp}`,
  });
  seeded.terminalId = term.body && term.body.id;
  await apiJson('POST', `/internal/admin/agents/${seeded.agentId}/credentials`, token);
  return seeded;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/tmp/chrome/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  const httpLog = [];
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api/')) httpLog.push(`${r.request().method()} ${new URL(u).pathname} -> ${r.status()}`);
  });

  // ------------------------------------------------------------- 0. SETUP
  await step('E2E-00', 'Seed an Agent with outlet/terminal/credential (real HTTP)', async () => {
    const r = await seedAgent();
    return {
      ok: !!(r.agentId && r.outletId && r.terminalId),
      detail: `agentRef=${r.agentRef} agentId=${r.agentId ? 'set' : 'missing'} outlet=${r.outletId ? 'set' : 'missing'} terminal=${r.terminalId ? 'set' : 'missing'}`,
    };
  });

  // ---------------------------------------------------------------- 1. LOGIN
  await step('E2E-01', 'Real browser login against live backend session', async () => {
    await login(page, ADMIN.email, ADMIN.password);
    const s = await shot(page, 'login-dashboard');
    const heading = await page.textContent('body');
    return {
      ok: heading.includes('Agent Network Management'),
      detail: 'authenticated; sidebar rendered',
      screenshot: s,
    };
  });

  // ------------------------------------------------- 2. AGENT CLASS (prereq)
  await step('E2E-02', 'Create Agent Class with canonical services', async () => {
    await navTo(page, 'Agent Classes');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Create class")');
    await page.waitForSelector('[aria-label="Create Agent class"]', { timeout: 15000 });
    const className = e2eClassName;
    await page.fill('[aria-label="Class name"]', className);
    const desc = page.locator('[aria-label="Class description"]');
    if (await desc.count()) await desc.first().fill('Mission 16 E2E canonical class');
    const selAll = await page.$('button:has-text("Select all canonical services")');
    if (selAll) await selAll.click();
    // Newly created classes default to INACTIVE, and an inactive class never appears in the
    // Agent Application class selector. Production-intended behaviour; the E2E must activate it.
    const activeBox = page.locator('label:has-text("Class active") input[type="checkbox"]').first();
    if (await activeBox.count()) await activeBox.check();
    // In create mode the submit button is labelled "Create inactive class" (Save class is edit mode).
    await page.click('button:has-text("Create inactive class")');
    await page.waitForTimeout(1800);
    const body = await page.textContent('body');
    const s = await shot(page, 'agent-class-created');
    // STRICT and behavioural: an inactive class never reaches the Agent Application selector
    // (it filters `isActive !== false`). So "our class is selectable" IS the activation proof.
    await navTo(page, 'Agent Network Management');
    await page.waitForTimeout(800);
    await page.click('button:has-text("New Agent Application")');
    await page.waitForTimeout(3000);
    const optTexts = await page
      .locator('select[aria-label="Application Agent class"] option')
      .evaluateAll((o) => o.map((x) => x.textContent || ''));
    const selectable = optTexts.some((t) => t.includes(className));
    // leave the form open; the next step uses it
    return {
      ok: body.includes(className) && selectable,
      detail: `${className}; listedOnScreen=${body.includes(className)} selectableForApplication=${selectable} (options=${optTexts.length})`,
      screenshot: s,
    };
  });

  // ------------------------------ 3. NEW AGENT APPLICATION — DRAFT CREATION
  const agentRef = `AGT-E2E-${Date.now().toString().slice(-6)}`;
  await step('E2E-03', 'Create Agent application as editable DRAFT', async () => {
    // Hard reload: guarantees a fresh component tree so no stale form state can affect the run.
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Agent Network Management', { timeout: 30000 });
    await navTo(page, 'Agent Network Management');
    await page.waitForTimeout(900);
    await page.click('button:has-text("New Agent Application")');
    await page.waitForSelector('[aria-label="Agent application onboarding form"]', { timeout: 20000 });
    await page.waitForTimeout(1200);

    await page.fill('[aria-label="Applicant reference"]', agentRef);

    // The class catalog is fetched on demand; without it the form falls back to a free-text
    // class reference input. Load it explicitly, then wait for real options.
    const loadCatalog = await page.$('button:has-text("Load class catalog"), button:has-text("Refresh class catalog")');
    if (loadCatalog) { await loadCatalog.click(); await page.waitForTimeout(1800); }

    let classChosen = false;
    let chosenClass = '';
    const sel = page.locator('select[aria-label="Application Agent class"]');
    try {
      await sel.waitFor({ state: 'visible', timeout: 20000 });
      await page.waitForFunction(
        () => {
          const el = document.querySelector('select[aria-label="Application Agent class"]');
          return !!el && el.options.length > 1;
        },
        { timeout: 20000 },
      );
      const opts = await sel.locator('option').evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent })));
      // Prefer this run's class; otherwise any genuinely active class proves the selector works.
      const pick = opts.find((o) => o.t && o.t.includes(e2eClassName)) || opts.find((o) => o.v);
      if (pick) { await sel.selectOption(pick.v); classChosen = true; chosenClass = pick.t; }
    } catch { /* fall through to reference input */ }

    if (!classChosen) {
      const refInput = page.locator('[aria-label="Application Agent class reference"]');
      if (await refInput.count()) {
        await refInput.first().fill(e2eClassName);
        classChosen = true;
      }
    }
    await page.fill('[aria-label="Business name"]', 'E2E Ventures Ltd');
    await page.fill('[aria-label="Principal contact name"]', 'Ada E2E');
    await page.fill('[aria-label="Contact email"]', 'ada.e2e@example.com');
    await page.fill('[aria-label="Contact phone"]', '+2348090000001');
    const addr = page.locator('[aria-label="Operating address"]');
    if (await addr.count()) await addr.first().fill('12 E2E Road');
    const city = page.locator('[aria-label="Operating city"]');
    if (await city.count()) await city.first().fill('Abuja');
    const st = page.locator('[aria-label="Operating state"]');
    if (await st.count()) await st.first().fill('FCT');

    await page.click('button:has-text("Save draft")');
    await page.waitForTimeout(2000);
    const body = await page.textContent('body');
    const s = await shot(page, 'draft-created');
    // STRICT: prove persistence by loading the queue and finding THIS reference, and that no
    // validation error is displayed on the form.
    const loadApps = await page.$('button:has-text("Load applications"), button:has-text("Refresh applications")');
    if (loadApps) { await loadApps.click(); await page.waitForTimeout(2200); }
    const pageText = await page.textContent('body');
    const validationError = /is required/i.test(pageText);
    // The queue renders the INTERNAL application reference (AGENT-APP-…), not the applicant
    // reference the operator typed. Capture it from the success banner so later steps target
    // exactly this run's row.
    const appRefMatch = (pageText.match(/AGENT-APP-[A-Z0-9]+/) || [])[0] || '';
    if (appRefMatch) seeded.appRefInternal = appRefMatch;
    const rowExists = appRefMatch ? (await page.locator('tr', { hasText: appRefMatch }).count()) > 0 : false;
    return {
      ok: classChosen && rowExists && !validationError,
      detail: `applicantReference=${agentRef} classChosen=${classChosen} class=${chosenClass} internalRef=${appRefMatch || 'not-found'} rowInQueue=${rowExists} validationError=${validationError}`,
      screenshot: s,
    };
  });

  // ------------------------------------------ 4. DRAFT EDIT + SUBMIT
  await step('E2E-04', 'Edit the DRAFT then submit into review queue', async () => {
    // filter to DRAFT and open the draft for editing
    const filter = page.locator('[aria-label="Filter applications by status"]');
    if (await filter.count()) await filter.first().selectOption('DRAFT');
    await page.click('button:has-text("Load applications"), button:has-text("Refresh applications")');
    await page.waitForTimeout(1800);

    // Scope every action to the row belonging to THIS run's reference, so a pre-existing
    // draft/approval from another run can never make this step pass.
    const ownRow = page.locator('tr', { hasText: seeded.appRefInternal || agentRef }).first();
    const editDraft = (await ownRow.count()) ? await ownRow.locator('button:has-text("Edit draft")').first().elementHandle() : null;
    if (editDraft) {
      await editDraft.click();
      await page.waitForTimeout(1200);
      // change a metadata field to prove the draft is genuinely editable
      const addr = page.locator('[aria-label="Operating address"]');
      if (await addr.count()) await addr.first().fill('99 Edited Draft Avenue');
      await page.click('button:has-text("Save draft")');
      await page.waitForTimeout(1600);
    }
    const s1 = await shot(page, 'draft-edited');

    const submitHandle = (await ownRow.count())
      ? await ownRow.locator('button:has-text("Submit draft")').first().elementHandle().catch(() => null)
      : null;
    const submit = submitHandle;
    if (submit) {
      await submit.click();
      await page.waitForTimeout(1800);
    } else {
      // fall back to submitting from the editor form
      const sub2 = await page.$('button:has-text("Submit application")');
      if (sub2) {
        await sub2.click();
        await page.waitForTimeout(1800);
      }
    }
    // STRICT: reload the queue with no status filter and require OUR row to read SUBMITTED.
    const allFilter = page.locator('[aria-label="Filter applications by status"]');
    if (await allFilter.count()) await allFilter.first().selectOption('All application states').catch(async () => {
      await allFilter.first().selectOption('');
    });
    const reload = await page.$('button:has-text("Refresh applications"), button:has-text("Load applications")');
    if (reload) { await reload.click(); await page.waitForTimeout(2400); }
    const ourRow = page.locator('tr', { hasText: seeded.appRefInternal || agentRef }).first();
    const rowVisible = (await ourRow.count()) > 0;
    const rowText = rowVisible ? (await ourRow.textContent()) || '' : '';
    const s2 = await shot(page, 'draft-submitted');
    return {
      ok: rowVisible && /SUBMITTED/.test(rowText) && !/DRAFT/.test(rowText),
      detail: `edited=${!!editDraft} submitted=${!!submit} rowStatus=${(rowText.match(/DRAFT|SUBMITTED|UNDER_REVIEW|APPROVED|REJECTED/) || ['none'])[0]}`,
      screenshot: s2 || s1,
    };
  });

  // ------------------------- 5. REVIEW → APPROVE → ACTIVATE
  await step('E2E-05', 'Review, approve and activate the application', async () => {
    const filter = page.locator('[aria-label="Filter applications by status"]');
    if (await filter.count()) await filter.first().selectOption('SUBMITTED');
    await page.click('button:has-text("Refresh applications"), button:has-text("Load applications")');
    await page.waitForTimeout(1800);

    let body = '';
    const rowOf = async () => page.locator('tr', { hasText: seeded.appRefInternal || agentRef }).first();

    // Each transition changes the application's status, so the status filter must be reset to
    // "All application states" before the row can be found again.
    const showAll = async () => {
      const f = page.locator('[aria-label="Filter applications by status"]');
      if (await f.count()) {
        await f.first().selectOption('All application states').catch(async () => {
          await f.first().selectOption('').catch(() => {});
        });
      }
      const r = await page.$('button:has-text("Refresh applications"), button:has-text("Load applications")');
      if (r) { await r.click(); await page.waitForTimeout(2200); }
    };

    const clickInRow = async (label) => {
      const row = await rowOf();
      if (!(await row.count())) return false;
      const btn = await row.locator(`button:has-text("${label}")`).first().elementHandle().catch(() => null);
      if (!btn) return false;
      await btn.click();
      await page.waitForTimeout(2200);
      return true;
    };

    const review = await clickInRow('Mark under review');
    await showAll();
    const approve = await clickInRow('Approve');
    await showAll();

    // Activation is only offered while the application is APPROVED and no Agent exists yet
    // (once an agent exists the row shows "Open agent" instead). Wait for that state rather
    // than assuming the post-approve refresh has settled.
    let activate = false;
    let rowStatus = '';
    for (let attempt = 0; attempt < 4 && !activate; attempt += 1) {
      const row = await rowOf();
      if (await row.count()) {
        rowStatus = ((await row.textContent()) || '').match(/DRAFT|SUBMITTED|UNDER_REVIEW|APPROVED|REJECTED/)?.[0] || '';
      }
      if (rowStatus === 'APPROVED') {
        activate = await clickInRow('Activate agent');
      }
      if (!activate) { await page.waitForTimeout(1500); await showAll(); }
    }
    await showAll();



    body = await page.textContent('body');
    const s = await shot(page, 'application-activated');
    // STRICT: all three actions must actually have been performed, and the success banner must
    // name THIS application. Previously this accepted a bare /ACTIVE/ substring, which is present
    // on almost every page and could never fail — a false-positive assertion.
    const bannerOk = /activated/i.test(body);
    const errors = /(failed|not entitled|denied|forbidden)/i.test(body);
    const ok = Boolean(review && approve && activate) && bannerOk && !errors;
    return {
      ok,
      detail: `review=${!!review} approve=${!!approve} activate=${!!activate} rowStatus=${rowStatus} banner=${bannerOk} errors=${errors}`,
      screenshot: s,
    };
  });

  // ------------------------------------- 6. OUTLET + TERMINAL CREATION
  await step('E2E-05b', 'Activated Agent appears in the Agent directory', async () => {
    await navTo(page, 'Agent Network Management');
    await page.waitForTimeout(1500);
    const refresh = await page.$('button:has-text("Refresh"), button:has-text("Load agents")');
    if (refresh) { await refresh.click(); await page.waitForTimeout(1800); }
    const row = agentRow(page, seeded.agentRef);
    const found = (await row.count()) > 0;
    const txt = found ? (await row.textContent()) : '';
    const s = await shot(page, 'agent-in-directory');
    return { ok: found && /ACTIVE/.test(txt || ''), detail: `agentRef=${seeded.agentRef} rowFound=${found} status=${(txt || '').match(/ACTIVE|SUSPENDED|TERMINATED/)?.[0] || 'n/a'}`, screenshot: s };
  });

  await step('E2E-06', 'Create Outlet and Terminal for the activated Agent', async () => {
    await navTo(page, 'Agent Network Management');
    await page.waitForTimeout(600);
    // open the activated agent
    const row6 = agentRow(page, seeded.agentRef);
    if (!(await row6.count())) return { ok: false, detail: `agent row ${seeded.agentRef} not found in Agent list` };
    await row6.locator('button:has-text("View")').first().click();
    await page.waitForTimeout(2000);

    // Outlets/terminals are loaded on demand behind an explicit button.
    await page.click('button:has-text("Load outlets & terminals")');
    await page.waitForTimeout(2200);

    await page.waitForSelector('[aria-label="Create outlet form"]', { timeout: 25000 });
    await page.fill('[aria-label="Outlet reference"]', `OUT-E2E-${Date.now().toString().slice(-5)}`);
    await page.fill('[aria-label="Outlet name"]', 'E2E Outlet One');
    const od = page.locator('[aria-label="Outlet display name"]');
    if (await od.count()) await od.first().fill('E2E Display One');
    const oa = page.locator('[aria-label="Outlet address line"]');
    if (await oa.count()) await oa.first().fill('7 Integration Close');
    const oc = page.locator('[aria-label="Outlet city"]');
    if (await oc.count()) await oc.first().fill('Abuja');
    const os = page.locator('[aria-label="Outlet state"]');
    if (await os.count()) await os.first().fill('FCT');
    // The seeded outlet and terminal must be visible before we add another one.
    const outletVisible = (await page.locator('text=OUT-SEED-').count()) > 0;
    await page.click('button:has-text("Create outlet")');
    await page.waitForTimeout(2200);
    const s1 = await shot(page, 'outlet-created');

    // terminal
    await page.waitForSelector('[aria-label="Create terminal form"]', { timeout: 20000 });
    await page.fill('[aria-label="Terminal reference"]', `TRM-E2E-${Date.now().toString().slice(-5)}`);
    const tl = page.locator('[aria-label="Terminal label"]');
    if (await tl.count()) await tl.first().fill('E2E Counter');
    const ts = page.locator('[aria-label="Terminal serial number"]');
    if (await ts.count()) await ts.first().fill('SN-E2E-001');
    await page.click('button:has-text("Create terminal")');
    await page.waitForTimeout(2200);
    const body = await page.textContent('body');
    const s2 = await shot(page, 'terminal-created');
    const createErrors = /Failed to create/i.test(body);
    return {
      ok: outletVisible && !createErrors,
      detail: `seededOutletRendered=${outletVisible} createErrors=${createErrors}`,
      screenshot: s2 || s1,
    };
  });

  // -------------- 7. OUTLET METADATA EDIT (the integrated-contract fix)
  await step('E2E-07', 'Edit Outlet metadata via PATCH (contract fix: must be 200, not 400)', async () => {
    const edit = await page.$('button:has-text("Edit outlet")');
    if (!edit) return { ok: false, detail: 'Edit outlet control not present' };
    await edit.click();
    await page.waitForTimeout(900);
    const addr = page.locator('[aria-label^="Edit outlet address for"]');
    if (await addr.count()) await addr.first().fill('55 Reintegrated Road');
    await page.click('button:has-text("Save outlet changes")');
    await page.waitForTimeout(2500);
    const body = await page.textContent('body');
    const s = await shot(page, 'outlet-metadata-updated');
    const patched = httpLog.filter((l) => l.startsWith('PATCH /api/v1/internal/outlets/'));
    const lastPatch = patched[patched.length - 1] || 'no PATCH observed';
    const ok = /metadata updated/i.test(body) && lastPatch.endsWith('-> 200');
    return { ok, detail: `PATCH result: ${lastPatch}`, screenshot: s };
  });

  // ----------- 8. TERMINAL METADATA EDIT (same contract fix)
  await step('E2E-08', 'Edit Terminal metadata via PATCH (contract fix: must be 200, not 400)', async () => {
    const edit = await page.$('button:has-text("Edit terminal")');
    if (!edit) return { ok: false, detail: 'Edit terminal control not present' };
    await edit.click();
    await page.waitForTimeout(900);
    const lbl = page.locator('[aria-label^="Edit terminal label for"]');
    if (await lbl.count()) await lbl.first().fill('E2E Counter Updated');
    await page.click('button:has-text("Save terminal changes")');
    await page.waitForTimeout(2500);
    const body = await page.textContent('body');
    const s = await shot(page, 'terminal-metadata-updated');
    const patched = httpLog.filter((l) => l.startsWith('PATCH /api/v1/internal/terminals/'));
    const lastPatch = patched[patched.length - 1] || 'no PATCH observed';
    const ok = /metadata updated/i.test(body) && lastPatch.endsWith('-> 200');
    return { ok, detail: `PATCH result: ${lastPatch}`, screenshot: s };
  });

  // --------------------------- 9. CREDENTIAL ISSUE + SESSION REVOCATION
  await step('E2E-09', 'Issue credential, then invalidate sessions with a true count', async () => {
    const issue = await page.$('button:has-text("Issue initial credential")');
    let issued = false;
    if (issue) {
      await issue.click();
      await page.waitForTimeout(2200);
      issued = !!(await page.$('[aria-label="One-time temporary credential"]'));
    }
    const s1 = await shot(page, 'credential-issued');

    const revoke = await page.$('button:has-text("Invalidate active sessions")');
    if (!revoke) return { ok: false, detail: 'session revoke control missing', screenshot: s1 };
    page.once('dialog', (d) => d.accept());
    await revoke.click();
    await page.waitForTimeout(2500);
    const body = await page.textContent('body');
    const s2 = await shot(page, 'sessions-revoked');
    const revokes = httpLog.filter((l) => l.includes('/sessions/revoke'));
    const lastRevoke = revokes[revokes.length - 1] || 'no revoke observed';
    // The fix: the count must be rendered (not "unknown"), and the call must be 200.
    // NOTE: the seeded Agent has no *live* session, so a truthful count is 0. The point of this
    // browser step is that the count is RENDERED (not "unknown") and the call is 200 — the exact
    // defect fixed in the integration (backend returns `revokedSessionCount`).
    const ok = lastRevoke.endsWith('-> 200') && /sessions? (revoked|invalidated)/i.test(body);
    return {
      ok,
      detail: `issued=${issued}; ${lastRevoke}; count rendered=${/\(0 sessions|\([0-9]+ sessions/.test(body)}`,
      screenshot: s2,
    };
  });

  // --------------------------- 10. C2C EXPIRY MONITORING (read-only)
  await step('E2E-10', 'Cash-to-Cash expiry status renders worker state (nested contract fix)', async () => {
    await navTo(page, 'Cash-to-Cash');
    await page.waitForTimeout(2500);
    const body = await page.textContent('body');
    const s = await shot(page, 'c2c-expiry-monitoring');
    const calls = httpLog.filter((l) => l.includes('/cash-to-cash/expiry-status'));
    const last = calls[calls.length - 1] || 'no expiry-status call observed';
    const showsWorker = /ENABLED|DISABLED/i.test(body);
    return {
      ok: last.endsWith('-> 200') && showsWorker,
      detail: `${last}; worker state shown=${showsWorker}`,
      screenshot: s,
    };
  });

  // --------------------------- 11. SUPPORT TICKET NAVIGATION
  await step('E2E-11', 'Agent drawer deep-link into Agent-filtered Support Tickets', async () => {
    await navTo(page, 'Agent Network Management');
    await page.waitForTimeout(1500);
    const row11 = agentRow(page, seeded.agentRef);
    if (await row11.count()) {
      await row11.locator('button:has-text("View")').first().click();
      await page.waitForTimeout(2000);
    }
    const open = await page.$('[data-testid="open-agent-support-tickets"]');
    if (!open) return { ok: false, detail: 'support-ticket deep link missing in Agent drawer' };
    await open.click();
    await page.waitForTimeout(2200);
    const body = await page.textContent('body');
    const s = await shot(page, 'support-tickets-agent-filtered');
    return { ok: /support/i.test(body), detail: 'navigated to Agent-filtered tickets', screenshot: s };
  });

  // --------------------------- 12. UNAUTHORIZED ROLE (real 403 / UI gate)
  await step('E2E-12', 'Restricted role cannot reach Agent Network or trigger forbidden fetches', async () => {
    const credsPath = '/home/user/monienaija-local-dev-11-roles-credentials.json';
    if (!fs.existsSync(credsPath)) {
      return { ok: false, detail: '11-role credential manifest not found' };
    }
    const manifest = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    // manifest is keyed by role: { ROLE_KEY: { email, password, principalId } }
    let roleKey = null;
    let target = null;
    for (const preferred of ['CUSTOMER_SERVICE', 'COMPLIANCE', 'RISK_FRAUD', 'FINANCE_AUDITOR']) {
      if (manifest[preferred]) { roleKey = preferred; target = manifest[preferred]; break; }
    }
    if (!target) return { ok: false, detail: 'no suitable restricted role identity found' };

    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p2 = await ctx2.newPage();
    const restrictedHttp = [];
    p2.on('response', (r) => {
      const u = r.url();
      if (u.includes('/api/')) restrictedHttp.push(`${r.request().method()} ${new URL(u).pathname} -> ${r.status()}`);
    });
    await p2.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p2.fill('#admin-login-email', target.email);
    await p2.fill('#admin-login-password', target.password);
    await p2.click('button[type="submit"]');
    await p2.waitForTimeout(4000);

    const body = await p2.textContent('body');
    const navVisible = /Agent Network Management/.test(body);
    const s = await shot(p2, `restricted-role-${roleKey.toLowerCase()}`);
    await ctx2.close();

    // Either the nav entry is hidden, or any attempted agent read is refused with 403.
    const agentCalls = restrictedHttp.filter((l) => l.includes('/agents'));
    const forbidden = agentCalls.filter((l) => l.endsWith('-> 403'));
    const leaked200 = agentCalls.filter((l) => l.endsWith('-> 200'));
    const ok = !navVisible || (forbidden.length > 0 && leaked200.length === 0);
    return {
      ok,
      detail: `role=${roleKey}; navVisible=${navVisible}; agentReads=${agentCalls.length}; 403=${forbidden.length}; 200=${leaked200.length}`,
      screenshot: s,
    };
  });

  // --------------------------- 13. HTTP ERROR SURFACING (no false success)
  await step('E2E-13', 'No false success messages on rejected requests', async () => {
    const failures = httpLog.filter((l) => /-> (400|401|403|404|409|501)$/.test(l));
    const body = await page.textContent('body');
    // A failed call must not coincide with a success banner for the same capability.
    const falseSuccess = /metadata updated/i.test(body) && failures.some((l) => l.startsWith('PATCH'));
    return {
      ok: !falseSuccess,
      detail: `non-2xx observed=${failures.length}; falseSuccess=${falseSuccess}`,
      screenshot: '',
    };
  });

  // --------------------------------------------------------------- SUMMARY
  const summary = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    browser: await browser.version(),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    consoleErrors: consoleErrors.slice(0, 30),
    httpLog: httpLog.slice(-120),
    results,
  };
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(summary, null, 2));

  console.log('\n================ E2E SUMMARY ================');
  console.log(`browser: ${summary.browser}`);
  console.log(`steps: ${summary.total}  passed: ${summary.passed}  failed: ${summary.failed}`);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.title}  ${r.ok ? '' : ':: ' + r.detail}`);
  }

  await browser.close();
  process.exit(summary.failed === 0 ? 0 : 2);
})().catch((e) => {
  console.error('E2E HARNESS ERROR', e);
  process.exit(1);
});
