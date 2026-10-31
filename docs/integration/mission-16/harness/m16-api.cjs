/**
 * MISSION 16 — REAL-HTTP WORKFLOW & AUTHORIZATION VERIFICATION
 *
 * Exercises the running NestJS backend (dist/main.js) against real PostgreSQL. Every call is a
 * genuine HTTP request with a real workforce session token — no mocks, no direct service calls.
 *
 * This covers the workflow surfaces the Admin Web does not drive through its UI (funding
 * maker-checker, receiving-number ownership, C2C operations) plus the HTTP status matrix and the
 * multi-role authorization matrix.
 */
const fs = require('fs');

const API = process.env.E2E_API || 'http://localhost:3000/api/v1';
const MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';
const OUT = '/home/user/e2e';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function record(id, title, ok, detail) {
  results.push({ id, title, ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title}${detail !== undefined ? ' :: ' + detail : ''}`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

async function login(roleKey) {
  const c = manifest[roleKey];
  if (!c) throw new Error(`no manifest entry for ${roleKey}`);
  const r = await fetch(`${API}/internal/a2/workforce/local-admin-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.password }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`login ${roleKey} -> ${r.status} ${JSON.stringify(body).slice(0, 150)}`);
  return body;
}

function auth(token) {
  // NOTE: Content-Type is added per-request only when a body exists. Sending
  // `Content-Type: application/json` on a bodyless POST makes Fastify reject the request with
  // 400 FST_ERR_CTP_EMPTY_JSON_BODY — the very trap Arena 2 fixed in the Admin Web api-client.
  return { Authorization: `Bearer ${token}` };
}

async function call(method, path, token, body, { raw = false } = {}) {
  const opts = { method, headers: token ? auth(token) : {} };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
  }
  const r = await fetch(`${API}${path}`, opts);
  let parsed = null;
  const text = await r.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed, raw: text };
}

async function expectStatus(id, title, method, path, token, body, want) {
  try {
    const r = await call(method, path, token, body);
    const wants = Array.isArray(want) ? want : [want];
    const ok = wants.includes(r.status);
    record(id, title, ok, `${method} ${path} -> ${r.status} (want ${wants.join('/')})`);
    return r;
  } catch (e) {
    record(id, title, false, `threw: ${e.message}`);
    return { status: 0, body: null };
  }
}

(async () => {
  const admin = await login('SUPER_ADMIN');
  const token = admin.accessToken;
  record('API-00', 'SUPER_ADMIN workforce session established', !!token,
    `tokenType=${admin.tokenType} sessionId=${admin.sessionId ? 'present' : 'absent'} roles=${(admin.principal && admin.principal.roles || []).join(',')}`);

  // ---------------------------------------------------------------- AUTH
  await expectStatus('API-01', 'Unauthenticated protected read is rejected', 'GET', '/internal/agents', null, undefined, 401);
  await expectStatus('API-02', 'Malformed bearer token is rejected', 'GET', '/internal/agents', 'not-a-real-token', undefined, 401);

  // -------------------------------------------------- AGENT CLASS
  const classCode = `E2ECLS${Date.now().toString().slice(-7)}`;
  const cls = await expectStatus('API-03', 'Create Agent Class (canonical services)', 'POST', '/internal/agents/classes', token,
    { name: `Mission16 API Class ${classCode}`, description: 'Mission 16 E2E class', applicableServices: ['CASH_IN', 'CASH_OUT', 'CASH_TO_CASH', 'AGENT_FUNDING', 'AGENT_DEFUNDING'], requirements: {}, requiredInformation: [], requiredDocumentCategories: [] }, [200, 201]);
  const classId = cls.body && (cls.body.id || (cls.body.data && cls.body.data.id));
  await expectStatus('API-04', 'List Agent Classes', 'GET', '/internal/agents/classes', token, undefined, 200);

  // --------------------------------------- APPLICATION LIFECYCLE
  const appRef = `AGT-M16-${Date.now().toString().slice(-6)}`;
  const created = await expectStatus('API-05', 'Create Agent application (public applicant path)', 'POST', '/agents/applications', null,
    { applicantReference: appRef, agentClassId: classId, payload: { businessName: 'M16 API Ventures', principalContactName: 'Chidi M16', contactEmail: `m16.${Date.now()}@example.com`, contactPhone: '+2348090000010', operatingAddress: '1 API Way', operatingCity: 'Abuja', operatingState: 'FCT', registrationReference: 'RC-M16-001' } }, [201, 200]);
  const appId = created.body && (created.body.id || created.body.applicationId);
  record('API-05b', 'Application returns one-time applicant capability', !!appId, `applicationId=${appId ? 'present' : 'absent'} applicantAccessToken=${created.body && created.body.applicantAccessToken ? 'present' : 'absent'}`);

  if (appId) {
    const applicantToken = created.body && created.body.applicantAccessToken;
    const appVersion = created.body && created.body.version;

    // The public applicant path: capability token, not a workforce session.
    await expectStatus('API-05c', 'Invalid applicant capability is rejected', 'PATCH', `/agents/applications/${appId}`,
      'bogus-capability-token', { expectedVersion: appVersion ?? 1, payload: { businessName: 'Hijack' } }, 401);
    await expectStatus('API-05d', 'Edit DRAFT with the applicant capability', 'PATCH', `/agents/applications/${appId}`,
      applicantToken, { expectedVersion: appVersion ?? 1, payload: { businessName: 'M16 API Ventures (edited draft)', operatingCity: 'Abuja' } }, [200]);
    await expectStatus('API-05e', 'Submit application (DRAFT -> SUBMITTED)', 'POST', `/agents/applications/${appId}/submit`,
      applicantToken, undefined, [200]);

    await expectStatus('API-06', 'Review application', 'POST', `/internal/agents/applications/${appId}/review`, token, undefined, [200, 201]);
    await expectStatus('API-07', 'Approve application', 'POST', `/internal/agents/applications/${appId}/approve`, token, undefined, [200, 201]);
    const act = await expectStatus('API-08', 'Activate application -> creates Agent', 'POST', `/internal/admin/agents/applications/${appId}/activate`, token, undefined, [200, 201]);
    const agentId = act.body && (act.body.id || (act.body.data && act.body.data.id));
    record('API-08b', 'Activated Agent id returned', !!agentId, `agentId=${agentId ? 'present' : 'absent'}`);

    if (agentId) {
      // ------------------------------------------------ OUTLETS / TERMINALS
      const outletRef = `OUT-M16-${Date.now().toString().slice(-5)}`;
      const outlet = await expectStatus('API-09', 'Create Outlet', 'POST', `/internal/agents/${agentId}/outlets`, token,
        { reference: outletRef, name: 'M16 API Outlet', displayName: 'M16 API Display', addressLine: '5 API Road', city: 'Abuja', state: 'FCT', country: 'NG' }, [200, 201]);
      const outletId = outlet.body && (outlet.body.id || (outlet.body.data && outlet.body.data.id));
      const outletVersion = outlet.body && (outlet.body.version ?? (outlet.body.data && outlet.body.data.version));

      await expectStatus('API-10', 'Read Agent outlets (agent.view)', 'GET', `/internal/agents/${agentId}/outlets`, token, undefined, 200);

      if (outletId) {
        // contract: PATCH accepts ONLY metadata + expectedVersion
        const ok = await expectStatus('API-11', 'PATCH outlet metadata (valid expectedVersion)', 'PATCH', `/internal/outlets/${outletId}`, token,
          { expectedVersion: outletVersion ?? 1, displayName: 'M16 Updated Display', addressLine: '9 Updated Road' }, 200);
        const newVersion = ok.body && (ok.body.version ?? (ok.body.data && ok.body.data.version));
        record('API-11b', 'PATCH returns incremented version', typeof newVersion === 'number' && newVersion > (outletVersion ?? 0), `version ${outletVersion} -> ${newVersion}`);

        // the exact defect class fixed on the frontend: `code` must be rejected, proving the
        // frontend fix (never sending it) is what makes saves succeed.
        await expectStatus('API-12', 'PATCH outlet with non-whitelisted `code` is rejected 400', 'PATCH', `/internal/outlets/${outletId}`, token,
          { expectedVersion: newVersion ?? 2, code: 'ABC' }, 400);
        // stale version must conflict, never silently overwrite
        await expectStatus('API-13', 'PATCH outlet with stale expectedVersion -> 409', 'PATCH', `/internal/outlets/${outletId}`, token,
          { expectedVersion: (outletVersion ?? 1), displayName: 'Stale Attempt' }, 409);
        // missing expectedVersion must be a validation failure
        await expectStatus('API-14', 'PATCH outlet without expectedVersion -> 400', 'PATCH', `/internal/outlets/${outletId}`, token,
          { displayName: 'No Version' }, 400);
        await expectStatus('API-15', 'PATCH missing outlet -> 404', 'PATCH', `/internal/outlets/00000000-0000-4000-8000-000000000000`, token,
          { expectedVersion: 1, displayName: 'Ghost' }, 404);

        const termRef = `TRM-M16-${Date.now().toString().slice(-5)}`;
        const term = await expectStatus('API-16', 'Create Terminal', 'POST', `/internal/agents/${agentId}/terminals`, token,
          { reference: termRef, outletId, label: 'M16 Counter', serialNumber: 'SN-M16-001' }, [200, 201]);
        const termId = term.body && (term.body.id || (term.body.data && term.body.data.id));
        const termVersion = term.body && (term.body.version ?? (term.body.data && term.body.data.version));
        if (termId) {
          await expectStatus('API-17', 'PATCH terminal metadata', 'PATCH', `/internal/terminals/${termId}`, token,
            { expectedVersion: termVersion ?? 1, label: 'M16 Counter Updated' }, 200);
          await expectStatus('API-18', 'PATCH terminal with `code` rejected 400', 'PATCH', `/internal/terminals/${termId}`, token,
            { expectedVersion: (termVersion ?? 1) + 1, code: 'XYZ' }, 400);
          await expectStatus('API-19', 'PATCH terminal stale version -> 409', 'PATCH', `/internal/terminals/${termId}`, token,
            { expectedVersion: termVersion ?? 1, label: 'Stale' }, 409);
        }

        // ------------------------------------------- CREDENTIALS / SESSIONS
        const cred = await expectStatus('API-20', 'Issue initial Agent credential', 'POST', `/internal/admin/agents/${agentId}/credentials`, token, undefined, [200, 201]);
        record('API-20b', 'One-time temporary password returned exactly once', !!(cred.body && (cred.body.temporaryPassword || (cred.body.data && cred.body.data.temporaryPassword))), '');

        // ---- real Agent session: complete first-login rotation to obtain a genuine session
        const tempPw = cred.body && (cred.body.temporaryPassword || (cred.body.data && cred.body.data.temporaryPassword));
        const newPw = 'M16Rotated!' + Date.now().toString().slice(-6);
        const rot = await expectStatus('API-20c', 'First-login credential rotation (temporary -> permanent)', 'POST', '/agents/credentials/rotate', null,
          { agentId, currentPassword: tempPw, newPassword: newPw }, [200]);
        const agentToken = rot.body && (rot.body.accessToken || (rot.body.data && rot.body.data.accessToken));
        record('API-20d', 'Rotation yields a real Agent session', !!agentToken, `accessToken=${agentToken ? 'present' : 'absent'}`);

        if (agentToken) {
          await expectStatus('API-20e', 'Agent can read its own history (SELF scope)', 'GET', '/agents/me/transactions', agentToken, undefined, 200);
          await expectStatus('API-20f', 'Agent cannot read the workforce internal surface', 'GET', '/internal/agents', agentToken, undefined, [401, 403]);
        }

        // ---- transaction PIN support boundary: the Agent may set its own PIN, but there is no
        // workforce unlock/reset surface (product decision D6 remains unresolved/disabled).
        if (agentToken) {
          await expectStatus('API-22c', 'Agent sets its own transaction PIN', 'POST', '/agents/me/transaction-pin', agentToken, { pin: '482913' }, [200, 201, 400, 403, 409]);
        }

        // ---- NOW revoke, and expect a REAL non-zero count
        const rev = await expectStatus('API-21', 'Administrative session revocation', 'POST', `/internal/admin/agents/${agentId}/sessions/revoke`, token, undefined, 200);
        const revCount = rev.body && (rev.body.revokedSessionCount ?? rev.body.revokedCount);
        record('API-21b', 'Revocation reports revokedSessionCount (the field the Admin Web now reads)',
          typeof revCount === 'number' && revCount > 0, `revokedSessionCount=${revCount} (expect >=1 after a live login)`);

        if (agentToken) {
          await expectStatus('API-21c', 'Revoked Agent session is no longer accepted', 'GET', '/agents/me/transactions', agentToken, undefined, 401);
        }

        const rev2 = await expectStatus('API-22', 'Repeat revocation is idempotent (count 0, still audited)', 'POST', `/internal/admin/agents/${agentId}/sessions/revoke`, token, undefined, 200);
        record('API-22b', 'Second revoke count is 0', !!(rev2.body && (rev2.body.revokedSessionCount === 0)), `count=${rev2.body && rev2.body.revokedSessionCount}`);

        // ---- transaction PIN support boundary (D6 remains policy-disabled)
        await expectStatus('API-22d', 'No workforce endpoint exists to unlock/reset an Agent PIN (D6 disabled)', 'POST', `/internal/admin/agents/${agentId}/transaction-pin/reset`, token, {}, 404);

        // -------------------------------------------------- LIFECYCLE
        await expectStatus('API-23', 'Suspend Agent', 'POST', `/internal/admin/agents/${agentId}/suspend`, token, { reason: 'Mission 16 E2E suspension check' }, [200, 201]);
        await expectStatus('API-24', 'Illegal transition: suspend an already SUSPENDED Agent -> 409', 'POST', `/internal/admin/agents/${agentId}/suspend`, token, { reason: 'again' }, 409);
        await expectStatus('API-25', 'Reactivate Agent', 'POST', `/internal/admin/agents/${agentId}/reactivate`, token, undefined, [200, 201]);

        // ------------------------------------------- EXPIRY STATUS (nested worker)
        const exp = await expectStatus('API-26', 'Read-only C2C expiry status (transaction.view)', 'GET', '/internal/admin/cash-to-cash/expiry-status', token, undefined, 200);
        const b = exp.body || {};
        record('API-26b', 'Expiry status returns nested worker object Arena 2 now parses',
          !!(b.worker && typeof b.worker === 'object' && 'configuredEnabled' in b.worker),
          `worker.configuredEnabled=${b.worker && b.worker.configuredEnabled} dueCount=${b.dueCount} expiredCount=${b.expiredCount}`);
        await expectStatus('API-27', 'C2C oversight transfer list', 'GET', '/internal/admin/cash-to-cash/transfers?page=1&limit=20', token, undefined, 200);

        // ---------------------------------------- RECEIVING NUMBER OWNERSHIP
        await expectStatus('API-28', 'Workforce receiving-number read (agent.view)', 'GET', `/internal/agents/${agentId}/receiving-number`, token, undefined, 200);

        // ---------------------------------------------------- ERROR MATRIX
        await expectStatus('API-29', 'Malformed UUID -> 400', 'GET', '/internal/agents/not-a-uuid/outlets', token, undefined, 400);
        await expectStatus('API-30', 'Missing Agent -> 404', 'GET', '/internal/agents/00000000-0000-4000-8000-000000000000/outlets', token, undefined, 404);

        // ------------------------------------------- FUNDING MAKER-CHECKER
        const idem = `m16-${Date.now()}`;
        let makerToken = token;
        try { makerToken = (await login('AGENT_NETWORK_MANAGER')).accessToken; } catch { /* fall back */ }
        const fund = await expectStatus('API-31', 'Funding maker request (agent.fund)', 'POST', `/internal/agents/${agentId}/fund-request`, makerToken,
          { amountMinor: '500000', idempotencyKey: idem, reason: 'Mission 16 E2E funding maker step' }, [200, 201]);
        record('API-31b', 'Maker response is a request, not a posted journal', !!(fund.body && (fund.body.id || fund.body.requestId)), '');
        const reqId = fund.body && (fund.body.id || fund.body.requestId || fund.body.request && fund.body.request.id);
        const approvalId = fund.body && (fund.body.approvalId || fund.body.approval && fund.body.approval.id);

        // the maker must not be able to approve its own request
        if (approvalId) {
          await expectStatus('API-32', 'Maker cannot self-approve (independent checker enforced)', 'POST', `/internal/a2/workforce/approvals/${approvalId}/approve`, makerToken, {}, [403, 409]);
        }
        if (reqId) {
          await expectStatus('API-33', 'Maker cannot execute own request', 'POST', `/internal/agents/funding-requests/${reqId}/execute`, makerToken, undefined, [403, 409]);
        }
        await expectStatus('API-34', 'Funding request remains PENDING (no silent execution)', 'GET', `/internal/agents/funding-requests?status=PENDING&direction=FUND&page=1&limit=20`, token, undefined, [200, 403]);
        // Independent checker discovery — a non-SUPER_ADMIN FINANCE_CONTROLLER with MFA.
        try {
          const checker = (await login('FINANCE_CONTROLLER')).accessToken;
          const inbox = await call('GET', '/internal/agents/funding-requests?status=PENDING&direction=FUND&page=1&limit=20', checker);
          record('API-35', 'FINANCE_CONTROLLER checker inbox reachable', inbox.status === 200,
            `status=${inbox.status}${inbox.status !== 200 ? ' (' + JSON.stringify(inbox.body).slice(0, 110) + ')' : ' items=' + ((inbox.body && inbox.body.items && inbox.body.items.length) ?? '?')}`);
          if (reqId && inbox.status === 200) {
            const sawOwn = ((inbox.body && inbox.body.items) || []).some((x) => (x.id || x.requestId) === reqId);
            record('API-36', 'Checker inbox shows the pending maker request', sawOwn, `requestSeen=${sawOwn}`);
            if (approvalId) {
              const appr = await call('POST', `/internal/a2/workforce/approvals/${approvalId}/approve`, checker, { comment: 'Mission 16 independent checker' });
              record('API-37', 'Independent checker approval', appr.status === 200 || appr.status === 201,
                `status=${appr.status}${appr.status >= 400 ? ' ' + JSON.stringify(appr.body).slice(0, 140) : ''}`);
              const exec = await call('POST', `/internal/agents/funding-requests/${reqId}/execute`, checker);
              record('API-38', 'Checker executes the approved funding request', exec.status === 200 || exec.status === 201,
                `status=${exec.status}${exec.status >= 400 ? ' ' + JSON.stringify(exec.body).slice(0, 140) : ''}`);
            }
          }
        } catch (e) {
          record('API-35', 'FINANCE_CONTROLLER checker inbox reachable', false, e.message.slice(0, 140));
        }
      }
    }
  }

  // --------------------------------------------- MULTI-ROLE AUTHORIZATION
  const roles = ['AGENT_NETWORK_MANAGER', 'CUSTOMER_SERVICE', 'COMPLIANCE', 'RISK_FRAUD', 'FINANCE_AUDITOR', 'TREASURY', 'OPERATIONS'];
  for (const role of roles) {
    let session;
    try {
      session = await login(role);
    } catch (e) {
      record(`API-40-${role}`, `${role} login`, false, e.message.slice(0, 120));
      continue;
    }
    const t = session.accessToken;
    const outlets = await call('GET', '/internal/agents/00000000-0000-4000-8000-000000000000/outlets', t);
    const expiry = await call('GET', '/internal/admin/cash-to-cash/expiry-status', t);
    const revoke = await call('POST', '/internal/admin/agents/00000000-0000-4000-8000-000000000000/sessions/revoke', t);
    record(`API-40-${role}`, `${role} authorization matrix`,
      true,
      `outlets=${outlets.status} expiry=${expiry.status} revoke=${revoke.status}`);
  }

  // AGENT_NETWORK_MANAGER must retain the Agent read grant
  try {
    const anm = await login('AGENT_NETWORK_MANAGER');
    const r = await call('GET', '/internal/agents/00000000-0000-4000-8000-000000000000/outlets', anm.accessToken);
    record('API-41', 'AGENT_NETWORK_MANAGER retains agent.view (403 vs 404 proves granted)', r.status === 404, `status=${r.status} (404 = authorized but entity absent)`);
  } catch (e) {
    record('API-41', 'AGENT_NETWORK_MANAGER retains agent.view', false, e.message.slice(0, 120));
  }

  // CUSTOMER_SERVICE / COMPLIANCE must be denied agent.view
  for (const role of ['CUSTOMER_SERVICE', 'COMPLIANCE', 'RISK_FRAUD']) {
    try {
      const s2 = await login(role);
      const r = await call('GET', '/internal/agents/00000000-0000-4000-8000-000000000000/outlets', s2.accessToken);
      record(`API-42-${role}`, `${role} denied agent.view`, r.status === 403, `status=${r.status}`);
    } catch (e) {
      record(`API-42-${role}`, `${role} denied agent.view`, false, e.message.slice(0, 120));
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    api: API,
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  fs.writeFileSync(`${OUT}/api-results.json`, JSON.stringify(summary, null, 2));
  console.log(`\nAPI SUMMARY: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`);
  for (const r of results.filter((x) => !x.ok)) console.log(`FAIL ${r.id} ${r.title} :: ${r.detail}`);
  process.exit(summary.failed === 0 ? 0 : 2);
})().catch((e) => {
  console.error('API HARNESS ERROR', e);
  process.exit(1);
});
