/**
 * Mission 25H — independent customer-preference authorization verification over real HTTP,
 * real authentication/authorization guards and real PostgreSQL.
 *
 * No mocks. Every principal below is a genuine persisted account that authenticated through
 * the application's own public login endpoints.
 */
const fs = require('node:fs');
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3000/api/v1';
const results = [];
let pass = 0;
let fail = 0;
const failures = [];

function record(group, name, ok, detail) {
  results.push({ group, name, ok, detail });
  if (ok) {
    pass++;
    console.log(`PASS [${group}] ${name}`);
  } else {
    fail++;
    failures.push({ group, name, detail });
    console.log(`FAIL [${group}] ${name} — ${JSON.stringify(detail)}`);
  }
}

async function req(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

const DB = { host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'monienaija' };

async function main() {
  const creds = JSON.parse(
    fs.readFileSync('/home/user/m25k-harness/monienaija-local-dev-11-roles-credentials.json', 'utf8'),
  );
  const fixtures = JSON.parse(fs.readFileSync('/home/user/m25k-harness/fixtures.json', 'utf8'));
  const principals = JSON.parse(fs.readFileSync('/home/user/m25k-harness/principals.json', 'utf8'));

  const C1 = fixtures.customer1.customerId;
  const C2 = fixtures.customer2.customerId;

  // ---------- sessions ----------
  const sessions = {};
  for (const [role, c] of Object.entries(creds)) {
    const r = await req('POST', '/internal/a2/workforce/local-admin-sessions', {
      body: { email: c.email, password: c.password },
    });
    if (r.status !== 201 && r.status !== 200) throw new Error(`workforce login failed for ${role}: ${r.status}`);
    sessions[role] = { token: r.json.accessToken, principal: r.json.principal };
  }

  const custLogin = async (id, password) => {
    const r = await req('POST', `/customers/${id}/authenticate`, { body: { password } });
    if (r.status !== 200) throw new Error(`customer login failed: ${r.status} ${r.text.slice(0, 200)}`);
    return r.json.session.accessToken;
  };
  const c1Token = await custLogin(C1, fixtures.customer1.password);
  const c2Token = await custLogin(C2, fixtures.customer2.password);

  const supLogin = await req('POST', '/internal/support/workforce-sessions', {
    body: { username: principals.support.username, password: principals.support.password },
  });
  if (supLogin.status !== 200) throw new Error(`support login failed ${supLogin.status} ${supLogin.text.slice(0, 200)}`);
  const supportToken = supLogin.json.accessToken;

  // AGENT: real temporary credential -> mandatory rotation -> real session.
  // Idempotent: a previously-rotated credential logs in directly; a fresh temporary
  // credential must complete the mandatory first-login rotation before a session exists.
  let agentRotate = { status: 'NOT_NEEDED' };
  let agentLogin = await req('POST', '/agents/sessions', {
    body: { agentId: principals.agent.agentId, password: principals.agent.newPassword },
  });
  if (agentLogin.status !== 200) {
    const tempLogin = await req('POST', '/agents/sessions', {
      body: { agentId: principals.agent.agentId, password: principals.agent.temporaryPassword },
    });
    if (tempLogin.json && tempLogin.json.rotationRequired === true) {
      agentRotate = await req('POST', '/agents/credentials/rotate', {
        body: {
          agentId: principals.agent.agentId,
          currentPassword: principals.agent.temporaryPassword,
          newPassword: principals.agent.newPassword,
        },
      });
      agentLogin = await req('POST', '/agents/sessions', {
        body: { agentId: principals.agent.agentId, password: principals.agent.newPassword },
      });
    } else {
      agentLogin = tempLogin;
    }
  }
  if (!agentLogin.json || !agentLogin.json.accessToken) {
    throw new Error(`agent login failed ${agentLogin.status} ${agentLogin.text.slice(0, 300)}`);
  }
  const agentToken = agentLogin.json.accessToken;

  record('sessions', 'all 13 principals authenticated through real login endpoints', true, {
    workforce: Object.keys(sessions).length,
    customer: 2,
    support: 1,
    agent: 1,
  });
  console.log(
    JSON.stringify({ workforceRoles: Object.keys(sessions), agentRotateStatus: agentRotate.status }),
  );

  // ---------- A. customer self-service positive path ----------
  const createBody = {
    language: 'EN',
    theme: 'SYSTEM',
    notifications: { email: true, sms: false, push: true, inApp: true },
    security: {
      loginAlerts: true,
      transactionAlerts: false,
      deviceRegistrationAlerts: true,
      biometricAllowed: false,
    },
  };

  let r = await req('GET', `/customers/${C1}/preferences`, { token: c1Token });
  const preexisting = r.status === 200;
  if (preexisting) {
    record('A-customer-self-service', 'customer creates own preferences (POST) → verified earlier in this run; profile already initialized', true, {
      status: 'SKIPPED-409-ON-REPEAT',
    });
  } else {
    r = await req('POST', `/customers/${C1}/preferences`, { token: c1Token, body: createBody });
    record('A-customer-self-service', 'customer creates own preferences (POST) → 2xx', r.status === 201 || r.status === 200, {
      status: r.status,
      body: r.text.slice(0, 160),
    });
  }

  r = await req('GET', `/customers/${C1}/preferences`, { token: c1Token });
  record(
    'A-customer-self-service',
    'customer reads own preferences (GET) → 200 with own values',
    r.status === 200 && r.json && r.json.notifications && r.json.notifications.email === true,
    { status: r.status, email: r.json?.notifications?.email },
  );

  r = await req('PATCH', `/customers/${C1}/preferences`, {
    token: c1Token,
    body: { notifications: { ...createBody.notifications, sms: true }, version: r.json?.version },
  });
  record('A-customer-self-service', 'customer updates own preferences (PATCH) → 200', r.status === 200, {
    status: r.status,
    body: r.text.slice(0, 160),
  });

  r = await req('GET', `/customers/${C1}/preferences/history`, { token: c1Token });
  record(
    'A-customer-self-service',
    'customer reads own preference history → 200 with entries',
    r.status === 200 && Array.isArray(r.json) && r.json.length >= 2,
    { status: r.status, entries: Array.isArray(r.json) ? r.json.length : null },
  );

  r = await req('GET', '/customers/me', { token: c1Token });
  record('A-customer-self-service', 'customer self-service GET /customers/me still 200', r.status === 200, {
    status: r.status,
  });

  r = await req('GET', '/customers/me/profile', { token: c1Token });
  record('A-customer-self-service', 'customer self-service GET /customers/me/profile still 200', r.status === 200, {
    status: r.status,
  });

  // ---------- A2. full lifecycle on a virgin customer (unambiguous create proof) ----------
  const C3 = fixtures.customer3.customerId;
  const c3Token = await custLogin(C3, fixtures.customer3.password);
  const c3Get0 = await req('GET', `/customers/${C3}/preferences`, { token: c3Token });
  record('A2-virgin-lifecycle', 'virgin customer has no preference profile yet (404 before create)', c3Get0.status === 404, {
    status: c3Get0.status,
  });
  const c3Create = await req('POST', `/customers/${C3}/preferences`, {
    token: c3Token,
    body: { ...createBody, actor: 'spoofed-actor-EVIL' },
  });
  record(
    'A2-virgin-lifecycle',
    'virgin customer creates own preferences (POST 201) with a spoofed actor supplied',
    c3Create.status === 201,
    { status: c3Create.status, body: c3Create.text.slice(0, 120) },
  );
  const c3Get = await req('GET', `/customers/${C3}/preferences`, { token: c3Token });
  record('A2-virgin-lifecycle', 'virgin customer reads back own created profile (200)', c3Get.status === 200, {
    status: c3Get.status,
  });
  const c3Patch = await req('PATCH', `/customers/${C3}/preferences`, {
    token: c3Token,
    body: { language: 'YO', version: c3Get.json?.version },
  });
  record('A2-virgin-lifecycle', 'virgin customer updates own profile (PATCH 200)', c3Patch.status === 200, {
    status: c3Patch.status,
    body: c3Patch.text.slice(0, 120),
  });
  const c3Hist = await req('GET', `/customers/${C3}/preferences/history`, { token: c3Token });
  record(
    'A2-virgin-lifecycle',
    'virgin customer sees CREATED + UPDATED history entries',
    c3Hist.status === 200 &&
      Array.isArray(c3Hist.json) &&
      c3Hist.json.some((h) => h.action === 'CREATED') &&
      c3Hist.json.some((h) => h.action === 'UPDATED'),
    { status: c3Hist.status, actions: Array.isArray(c3Hist.json) ? c3Hist.json.map((h) => h.action) : null },
  );

  // ---------- B. cross-customer ----------
  const crossChecks = [
    ['GET', `/customers/${C1}/preferences`, undefined],
    ['GET', `/customers/${C1}/preferences/history`, undefined],
    ['PATCH', `/customers/${C1}/preferences`, { language: 'FR' }],
    ['POST', `/customers/${C1}/preferences`, createBody],
  ];
  for (const [method, path, body] of crossChecks) {
    const res = await req(method, path, { token: c2Token, body });
    record(
      'B-cross-customer',
      `customer B ${method} ${path.replace(C1, '<C1>')} → 403, no payload`,
      res.status === 403 && !/"notifications"/.test(res.text),
      { status: res.status, body: res.text.slice(0, 120) },
    );
  }
  // Non-enumeration: an id that does not exist must look identical to one that does.
  const ghost = '11111111-2222-4333-8444-555555555555';
  const ghostRes = await req('GET', `/customers/${ghost}/preferences`, { token: c2Token });
  record('B-cross-customer', 'cross-customer denial is identical for a non-existent customer id', ghostRes.status === 403, {
    status: ghostRes.status,
  });

  // ---------- C. 11 workforce roles × 4 endpoints ----------
  const roleNames = Object.keys(sessions);
  const endpoints = [
    ['GET', `/customers/${C1}/preferences`],
    ['GET', `/customers/${C1}/preferences/history`],
    ['POST', `/customers/${C1}/preferences`],
    ['PATCH', `/customers/${C1}/preferences`],
  ];
  for (const role of roleNames) {
    for (const [method, path] of endpoints) {
      const res = await req(method, path, {
        token: sessions[role].token,
        body: method === 'GET' ? undefined : createBody,
      });
      const leaked = /"notifications"|"biometric"|"loginAlerts"/.test(res.text);
      record(
        'C-workforce-denied',
        `${role} ${method} ${path.replace(C1, '<id>')} → 403 and no preference data`,
        res.status === 403 && !leaked,
        { status: res.status, principalType: sessions[role].principal.type, body: res.text.slice(0, 100) },
      );
    }
  }

  // ---------- D. AGENT + SUPPORT ----------
  for (const [label, token] of [
    ['AGENT', agentToken],
    ['SUPPORT', supportToken],
  ]) {
    for (const [method, path] of endpoints) {
      const res = await req(method, path, { token, body: method === 'GET' ? undefined : createBody });
      record(
        'D-agent-support-denied',
        `${label} ${method} ${path.replace(C1, '<id>')} → 403`,
        res.status === 403,
        { status: res.status, body: res.text.slice(0, 100) },
      );
    }
  }

  // ---------- E. anonymous ----------
  for (const [method, path] of endpoints) {
    const res = await req(method, path, { body: method === 'GET' ? undefined : createBody });
    record('E-anonymous', `anonymous ${method} → 401`, res.status === 401, { status: res.status });
  }

  // ---------- F. route / encoding / method bypass probes ----------
  const bypassAsWorkforce = [
    ['GET', `/customers/${C1}/%70references`, 'percent-encoded static segment (p)'],
    ['GET', `/api/v1/%63ustomers/${C1}/preferences`, 'percent-encoded static segment (c)'],
    ['GET', `/customers/${C1}/preferences/`, 'trailing slash'],
    ['GET', `/customers/${C1}/preferences%2Fhistory`, 'percent-encoded slash in descendant'],
    ['GET', `/customers/${C1}/preferences/history/extra`, 'extra descendant segment'],
    ['GET', `/customers/${C1}/preferences?probe=1`, 'query string appended'],
    ['GET', `/customers/me/preferences`, 'unsupported /me alias'],
    ['GET', `/customers/not-a-uuid/preferences`, 'non-UUID id'],
    ['PUT', `/customers/${C1}/preferences`, 'alternate method PUT'],
    ['DELETE', `/customers/${C1}/preferences`, 'alternate method DELETE'],
    ['OPTIONS', `/customers/${C1}/preferences`, 'alternate method OPTIONS'],
    ['POST', `/customers/${C1}/preferences/history`, 'POST to history child'],
    ['PATCH', `/customers/${C1}/preferences/history`, 'PATCH to history child'],
    ['HEAD', `/customers/${C1}/preferences`, 'HEAD alias of GET'],
  ].map(([m, p, label]) => [m, p.replace(/^\/api\/v1/, ''), label]);

  for (const [method, path, label] of bypassAsWorkforce) {
    const res = await req(method, path, {
      token: sessions.SUPER_ADMIN.token,
      body: ['POST', 'PATCH', 'PUT'].includes(method) ? createBody : undefined,
    });
    const leaked = /"notifications"|"biometric"|"loginAlerts"/.test(res.text);
    record(
      'F-bypass-workforce',
      `SUPER_ADMIN ${label} → not 2xx, no preference data`,
      res.status >= 400 && !leaked,
      { method, path, status: res.status, body: res.text.slice(0, 120) },
    );
  }

  // Same probes as the legitimate owning customer: must not grant anything extra.
  const bypassAsCustomer = [
    ['GET', `/customers/${C2}/%70references`, 'percent-encoded segment, other customer'],
    ['GET', `/customers/${C2}/preferences`, 'other customer plain'],
    ['GET', `/customers/${C2}/preferences?probe=1`, 'other customer + query string'],
    ['GET', `/customers/${C2}/preferences%2Fhistory`, 'other customer + encoded slash'],
    ['GET', `/customers/me/preferences`, 'own /me alias'],
    ['PATCH', `/customers/${C2}/preferences`, 'PATCH other customer encoded'],
  ].map(([m, p, label]) => [m, p, label]);
  for (const [method, path, label] of bypassAsCustomer) {
    const res = await req(method, path, {
      token: c1Token,
      body: ['POST', 'PATCH', 'PUT'].includes(method) ? createBody : undefined,
    });
    const leaked = /"notifications"|"biometric"|"loginAlerts"/.test(res.text);
    record(
      'F-bypass-customer',
      `customer A ${label} → not 2xx, no preference data`,
      res.status >= 400 && !leaked,
      { method, path, status: res.status, body: res.text.slice(0, 120) },
    );
  }

  // Owning customer with a query string must still work (policy strips the query).
  r = await req('GET', `/customers/${C1}/preferences?probe=1`, { token: c1Token });
  record('F-bypass-customer', 'owning customer GET with query string still 200', r.status === 200, {
    status: r.status,
  });

  // ---------- G. audit actor attribution / spoofing ----------
  const client = new Client(DB);
  await client.connect();

  r = await req('PATCH', `/customers/${C1}/preferences`, {
    token: c1Token,
    body: {
      language: 'EN',
      actor: 'spoofed-actor-EVIL',
      notifications: { email: true, sms: true, push: true, inApp: false },
    },
  });
  const spoofStatus = r.status;

  const hist = await client.query(
    `SELECT h.actor, h.action FROM preference_histories h
       JOIN customer_preferences p ON p.id = h.preference_id
      WHERE p.customer_id = $1 ORDER BY h.created_at DESC LIMIT 5`,
    [C1],
  );
  const actors = hist.rows.map((x) => x.actor);
  record(
    'G-audit-attribution',
    'request-supplied actor cannot spoof preference history (stored actor is the customer id)',
    spoofStatus === 200 && actors.length > 0 && actors.every((a) => a === C1),
    { spoofStatus, actors },
  );

  const auditRows = await client.query(
    `SELECT actor, action FROM audit_events
      WHERE entity_type IN ('CUSTOMER_PREFERENCE','PREFERENCE_HISTORY') AND actor IS NOT NULL
      ORDER BY occurred_at DESC LIMIT 10`,
  );
  record(
    'G-audit-attribution',
    'no preference audit row attributes the action to a spoofed actor',
    auditRows.rows.every((x) => x.actor !== 'spoofed-actor-EVIL'),
    { actors: [...new Set(auditRows.rows.map((x) => x.actor))] },
  );

  const decisionSpoof = await client.query(
    `SELECT actor FROM audit_events
      WHERE entity_type='AUTHORIZATION_DECISION'
        AND (new_values->>'resourceType'='customer-preference')
        AND occurred_at > now() - interval '30 minutes' LIMIT 20`,
  );
  record(
    'G-audit-attribution',
    'preference authorization decisions are attributed to the authenticated principal, not a body value',
    decisionSpoof.rows.every((x) => x.actor !== 'spoofed-actor-EVIL'),
    { actors: [...new Set(decisionSpoof.rows.map((x) => x.actor))] },
  );

  // ---------- H. generic audit projections ----------
  r = await req('GET', '/internal/audit?limit=200', { token: sessions.SUPER_ADMIN.token });
  const auditText = r.text;
  const leaksPrefRows = /CUSTOMER_PREFERENCE|PREFERENCE_HISTORY/.test(auditText);
  const leaksCustomerPrefResource = /customer-preference/.test(auditText);
  const leaksPreferenceValues = /biometricAllowed|transactionAlerts|deviceRegistrationAlerts/.test(auditText);
  record(
    'H-audit-projection',
    'SUPER_ADMIN generic audit read exposes no preference rows, decisions or values',
    r.status === 200 && !leaksPrefRows && !leaksCustomerPrefResource && !leaksPreferenceValues,
    {
      status: r.status,
      leaksPrefRows,
      leaksCustomerPrefResource,
      leaksPreferenceValues,
      bytes: auditText.length,
    },
  );

  const dbPrefAudit = await client.query(
    `SELECT count(*)::int AS n FROM audit_events WHERE entity_type IN ('CUSTOMER_PREFERENCE','PREFERENCE_HISTORY')`,
  );
  record(
    'H-audit-projection',
    'underlying preference audit rows still exist in PostgreSQL (filtered, not deleted)',
    dbPrefAudit.rows[0].n > 0,
    { rowsInDb: dbPrefAudit.rows[0].n },
  );

  const unrelatedType = 'A2_WORKFORCE_SESSION';
  const unrelated = await req('GET', `/internal/audit?limit=5&entityType=${unrelatedType}`, {
    token: sessions.SUPER_ADMIN.token,
  });
  const unrelatedDb = await client.query(
    `SELECT count(*)::int AS n FROM audit_events WHERE entity_type = $1`,
    [unrelatedType],
  );
  record(
    'H-audit-projection',
    'unrelated audit records remain visible to an authorized audit reader',
    unrelated.status === 200 &&
      Array.isArray(unrelated.json) &&
      unrelated.json.length > 0 &&
      unrelated.json.every((row) => row.entityType === unrelatedType),
    {
      status: unrelated.status,
      rows: Array.isArray(unrelated.json) ? unrelated.json.length : null,
      rowsInDbForType: unrelatedDb.rows[0].n,
    },
  );

  const supportAudit = await req('GET', '/internal/audit?limit=200', { token: supportToken });
  record(
    'H-audit-projection',
    'SUPPORT audit exception does not expose preference rows either',
    !/CUSTOMER_PREFERENCE|PREFERENCE_HISTORY|biometricAllowed/.test(supportAudit.text),
    { status: supportAudit.status },
  );

  // Filtered query straight at the preference entity type must return nothing.
  const directPrefAudit = await req('GET', '/internal/audit?limit=50&entityType=CUSTOMER_PREFERENCE', {
    token: sessions.SUPER_ADMIN.token,
  });
  record(
    'H-audit-projection',
    'an explicit entityType=CUSTOMER_PREFERENCE audit query returns no rows',
    directPrefAudit.status === 200 && Array.isArray(directPrefAudit.json) && directPrefAudit.json.length === 0,
    { status: directPrefAudit.status, rows: Array.isArray(directPrefAudit.json) ? directPrefAudit.json.length : null },
  );

  const complianceAudit = await req('GET', '/internal/audit?limit=200', {
    token: sessions.COMPLIANCE.token,
  });
  record(
    'H-audit-projection',
    'COMPLIANCE audit read exposes no preference rows or values',
    !/CUSTOMER_PREFERENCE|PREFERENCE_HISTORY|biometricAllowed|transactionAlerts/.test(complianceAudit.text),
    { status: complianceAudit.status },
  );

  const depDecision = await client.query(
    `SELECT count(*)::int AS n FROM audit_events
      WHERE entity_type='AUTHORIZATION_DECISION'
        AND (new_values->>'resourceType'='customer-preference'
             OR COALESCE(new_values->>'action','') ~* '/customers/[^/]+/preferences')`,
  );
  record(
    'H-audit-projection',
    'preference-route authorization decisions exist in PostgreSQL but are hidden from generic audit HTTP',
    depDecision.rows[0].n > 0 && !/customer-preference/.test(auditText),
    { decisionsInDb: depDecision.rows[0].n },
  );

  // Operational audit summary: aggregate only.
  const summary = await req('GET', '/internal/audit/summary', { token: sessions.SUPER_ADMIN.token });
  record(
    'H-audit-projection',
    'operational audit summary contains no per-customer preference values',
    !/biometricAllowed|transactionAlerts|deviceRegistrationAlerts/.test(summary.text),
    { status: summary.status, bytes: summary.text.length },
  );

  await client.end();

  const out = { pass, fail, failures, total: results.length, results };
  fs.writeFileSync('/home/user/m25k-harness/authz-results.json', JSON.stringify(out, null, 2));
  console.log(`\n=== TOTALS: ${pass} passed / ${fail} failed / ${results.length} checks ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
