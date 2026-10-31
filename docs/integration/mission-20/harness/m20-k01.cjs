/**
 * MISSION 20 — K-01 INDEPENDENT VERIFICATION (real HTTP, real PostgreSQL)
 *
 * Verifies Arena 1's Mission 19A correction from the outside, exactly as a client sees it.
 * Nothing is mocked: genuine local-admin password logins against the running NestJS backend,
 * real bearer tokens over TCP, and direct read-only PostgreSQL inspection of the session row
 * to prove the stored state — not just the HTTP response.
 *
 * Requirements from the mission, one check each:
 *   K01-1  FINANCE_AUDITOR (read-only) can revoke its OWN current session          -> 200
 *   K01-2  the revoked bearer immediately returns 401 on a protected read
 *   K01-3  cross-session revocation is still denied (sibling / other principal / unknown id),
 *          and the sibling session keeps working
 *   K01-4  unrelated unsafe methods are still denied for the read-only principal
 *   K01-5  a session-validation race cannot resurrect a revoked session: after interleaved
 *          reads + logout the stored row is REVOKED and the token stays 401 (repeated trials)
 *   K01-6  the other ten workforce roles keep their established logout behaviour
 *          (own-session DELETE 200, token dead afterwards)
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('/home/user/m20/node_modules/pg');

const API = process.env.K01_API || 'http://127.0.0.1:3000/api/v1';
const MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';
const OUT = process.env.K01_OUT || '/home/user/k01';
const DB = {
  host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw',
  database: process.env.DB_NAME || 'monienaija_e2e',
};

fs.mkdirSync(OUT, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const results = [];

function record(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title}${detail ? ' :: ' + detail : ''}`);
}

async function call(method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${API}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, body: parsed };
}

async function login(role) {
  const creds = manifest[role];
  const r = await call('POST', '/internal/a2/workforce/local-admin-sessions', null, {
    email: creds.email, password: creds.password,
  });
  if (!r.body || !r.body.accessToken) throw new Error(`login failed for ${role}: ${r.status}`);
  return { token: r.body.accessToken, sessionId: r.body.sessionId, principal: r.body.principal };
}

const dashboard = (t) => call('GET', '/internal/a2/workforce/dashboard/my-dashboard', t);
const logout = (t, sid) =>
  call('DELETE', `/internal/a2/workforce/sessions/${sid}`, t, { reason: 'Mission 20 K-01 verification' });

(async () => {
  const db = new Client(DB);
  await db.connect();
  const sessionStatus = async (sid) => {
    const r = await db.query('SELECT status, revoked_at, revoke_reason FROM a2_workforce_sessions WHERE id=$1', [sid]);
    return r.rows[0] || null;
  };

  // ------------------------------------------------------------------ K01-1 / K01-2
  const auditor = await login('FINANCE_AUDITOR');
  const beforeRead = await dashboard(auditor.token);
  const selfRevoke = await logout(auditor.token, auditor.sessionId);
  const afterRead = await dashboard(auditor.token);
  const rowAfter = await sessionStatus(auditor.sessionId);
  record(
    'K01-1',
    'FINANCE_AUDITOR can revoke its OWN current session',
    auditor.principal.readOnlyPrincipal === true && beforeRead.status === 200 && selfRevoke.status === 200,
    `readBefore=${beforeRead.status} readOnlyPrincipal=${auditor.principal.readOnlyPrincipal} logout=${selfRevoke.status} message=${(selfRevoke.body && selfRevoke.body.message) || '-'}`,
  );
  record(
    'K01-2',
    'the revoked bearer immediately returns 401',
    afterRead.status === 401 && rowAfter && rowAfter.status === 'REVOKED',
    `readAfter=${afterRead.status} dbStatus=${rowAfter && rowAfter.status} revokedAt=${!!(rowAfter && rowAfter.revoked_at)}`,
  );

  // ------------------------------------------------------------------ K01-3 cross-session denial
  // (a) a read-only principal holding two live sessions may not revoke the sibling
  const s1 = await login('FINANCE_AUDITOR');
  const s2 = await login('FINANCE_AUDITOR');
  const siblingDenied = await logout(s1.token, s2.sessionId);
  const siblingStillWorks = await dashboard(s2.token);
  const siblingRow = await sessionStatus(s2.sessionId);
  // (b) another principal's live session
  const treasury = await login('TREASURY');
  const foreignDenied = await logout(s1.token, treasury.sessionId);
  const foreignStillWorks = await dashboard(treasury.token);
  const foreignRow = await sessionStatus(treasury.sessionId);
  // (c) an unknown session id
  const unknownDenied = await logout(s1.token, '00000000-0000-4000-8000-000000000000');
  record(
    'K01-3',
    'cross-session revocation stays denied (sibling / other principal / unknown) and those sessions survive',
    siblingDenied.status === 403 && foreignDenied.status === 403 && unknownDenied.status === 403 &&
      siblingStillWorks.status === 200 && foreignStillWorks.status === 200 &&
      siblingRow.status === 'ACTIVE' && foreignRow.status === 'ACTIVE',
    `sibling=${siblingDenied.status} siblingSurvives=${siblingStillWorks.status}/${siblingRow.status} ` +
      `otherPrincipal=${foreignDenied.status} otherSurvives=${foreignStillWorks.status}/${foreignRow.status} unknown=${unknownDenied.status}`,
  );

  // ------------------------------------------------------------------ K01-4 unrelated unsafe ops
  // Each probe is first exercised as SUPER_ADMIN (a non-read-only principal with broad scopes)
  // to prove the route really exists and is not simply 404/401-unreachable. Only routes that are
  // genuinely reachable for a non-read-only principal are then required to return 403 for the
  // read-only FINANCE_AUDITOR, so a 403 here can only come from the read-only method control and
  // not from a missing route, a bad URL or an authentication failure.
  const admin = await login('SUPER_ADMIN');
  const candidates = [
    ['POST', `/internal/agents/${'00000000-0000-4000-8000-000000000000'}/suspend`, {}],
    ['POST', '/internal/agents/classes', { name: 'probe', applicableServices: ['CASH_IN'], isActive: false }],
    ['POST', `/internal/agents/${'00000000-0000-4000-8000-000000000000'}/outlets`, { reference: 'PROBE-1', name: 'probe' }],
    ['PATCH', `/internal/outlets/${'00000000-0000-4000-8000-000000000000'}`, { name: 'probe' }],
    ['DELETE', `/internal/a2/workforce/sessions/${treasury.sessionId}`, { reason: 'probe' }],
    ['POST', `/internal/a2/workforce/approvals/${'00000000-0000-4000-8000-000000000000'}/approve`, { reason: 'probe' }],
    ['POST', '/internal/notifications/templates', { eventType: 'customer.registration.phone_verification', channel: 'SMS' }],
  ];
  const probeRows = [];
  for (const [m, p2, b] of candidates) {
    const asAdmin = await call(m, p2, admin.token, b);
    if (asAdmin.status === 404 || asAdmin.status === 401 || asAdmin.status === 405) {
      probeRows.push({ m, p: p2, reachable: false, adminStatus: asAdmin.status, auditorStatus: null });
      continue;
    }
    const asAuditor = await call(m, p2, s1.token, b);
    probeRows.push({ m, p: p2, reachable: true, adminStatus: asAdmin.status, auditorStatus: asAuditor.status });
  }
  const reachable = probeRows.filter((r) => r.reachable);
  const summary = probeRows.map((r) =>
    `${r.m} ${r.p.split('?')[0].replace(/[0-9a-f-]{36}/gi, ':id')} admin=${r.adminStatus}` +
    (r.reachable ? ` auditor=${r.auditorStatus}` : ' (route not reachable — excluded)'));
  record(
    'K01-4',
    'unrelated unsafe methods stay denied for the read-only principal (403 on every reachable route)',
    reachable.length >= 4 && reachable.every((r) => r.auditorStatus === 403),
    `${reachable.length}/${probeRows.length} routes reachable & discriminator-valid :: ` + summary.join('  '),
  );

  // ------------------------------------------------------------------ K01-5 race
  // Interleave many in-flight validations with the logout, then prove the stored row never
  // comes back ACTIVE and the bearer stays dead. Repeated trials to actually stand a chance of
  // hitting the interleaving; the invariant is checked after every trial.
  const trials = [];
  const TRIALS = 12;
  for (let i = 0; i < TRIALS; i += 1) {
    const s = await login('FINANCE_AUDITOR');
    // warm the session so the race has a realistic already-ACTIVE row
    await dashboard(s.token);
    const inflight = Array.from({ length: 8 }, () => dashboard(s.token));
    const revoke = logout(s.token, s.sessionId);
    const settled = await Promise.allSettled([...inflight, revoke]);
    const revokeStatus = settled[settled.length - 1].value.status;
    await new Promise((r) => setTimeout(r, 60));
    const row = await sessionStatus(s.sessionId);
    // A validation that lands after revocation must not succeed, and the row must stay REVOKED.
    const lateReads = await Promise.all(Array.from({ length: 4 }, () => dashboard(s.token)));
    const lateAll401 = lateReads.every((r) => r.status === 401);
    trials.push({ revokeStatus, dbStatus: row.status, lateAll401 });
  }
  const raceOk = trials.every((t) => t.revokeStatus === 200 && t.dbStatus === 'REVOKED' && t.lateAll401);
  const statuses = {};
  trials.forEach((t) => { statuses[t.dbStatus] = (statuses[t.dbStatus] || 0) + 1; });
  record(
    'K01-5',
    'a validation race cannot resurrect a revoked session (stored status + replay)',
    raceOk,
    `${TRIALS} trials: fetch-store=200 all=${trials.every((t) => t.revokeStatus === 200)} ` +
      `storedStatus=${JSON.stringify(statuses)} postRevokeReadsAll401=${trials.every((t) => t.lateAll401)}`,
  );

  // ------------------------------------------------------------------ K01-6 other ten roles
  const others = Object.keys(manifest).filter((r) => r !== 'FINANCE_AUDITOR');
  const rows = [];
  for (const role of others) {
    const s = await login(role);
    const before = await dashboard(s.token);
    const out = await logout(s.token, s.sessionId);
    const after = await dashboard(s.token);
    const row = await sessionStatus(s.sessionId);
    rows.push({ role, readOnly: s.principal.readOnlyPrincipal === true, before: before.status, logout: out.status, after: after.status, db: row.status });
  }
  const othersOk = rows.every((r) => r.before === 200 && r.logout === 200 && r.after === 401 && r.db === 'REVOKED');
  record(
    'K01-6',
    'the other ten workforce roles keep their logout behaviour (own-session 200, token dead)',
    othersOk,
    rows.map((r) => `${r.role}:${r.before}/${r.logout}/${r.after}/${r.db}${r.readOnly ? '(ro)' : ''}`).join(' '),
  );

  await db.end();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  fs.writeFileSync(path.join(OUT, 'k01-results.json'), JSON.stringify({ results, trials, rows, passed, failed }, null, 2));
  console.log(`\n=== K-01 SUMMARY: ${passed}/${results.length} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
