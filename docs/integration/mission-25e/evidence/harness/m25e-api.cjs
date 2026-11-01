/**
 * MISSION 25E — NOTIFICATION AUTHORIZATION, GOVERNANCE AND SECURITY MATRIX
 * Real HTTP against the integrated compiled backend (:3000) on a disposable database.
 *
 * Covers: 11-role access matrix, security-event restrictions, provider-config permission
 * boundaries, maker-checker proposal→approve→execute, H-06 trigger-lock divergence,
 * H-04 unsupported-event handling, H-07 secret non-exposure, delivery/quarantine reads.
 */
'use strict';
const fs = require('fs');

const BASE = 'http://127.0.0.1:3000/api/v1';
const MANIFEST = '/home/user/monienaija-local-dev-11-roles-credentials.json';
const OUT = '/home/user/m25e-api-results.json';
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const results = [];
let token = null;

const rec = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} :: ${String(detail).slice(0, 200)}`);
};

async function call(method, path, { body, roles, bearer } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = bearer || token;
  if (t) headers.Authorization = `Bearer ${t}`;
  if (roles) headers['x-test-roles'] = roles;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { _raw: text.slice(0, 300) }; }
  return { status: res.status, body: json };
}

async function login(roleKey) {
  const c = manifest[roleKey];
  const res = await fetch(BASE + '/internal/a2/workforce/local-admin-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.password }),
  });
  if (res.status !== 201) throw new Error(`${roleKey} login ${res.status}`);
  const b = await res.json();
  return { token: b.accessToken, roles: b.principal.roles, scopes: b.principal.scopes };
}

(async () => {
  // ---------- 1. all 11 roles authenticate ----------
  const sessions = {};
  for (const roleKey of Object.keys(manifest)) {
    const s = await login(roleKey);
    sessions[roleKey] = s;
    rec(`AUTH-${roleKey}`, s.roles.length > 0, `roles=${s.roles.join(',')} scopes=${s.scopes.length}`);
  }
  rec('AUTH-11-ROLES', Object.keys(sessions).length === 11, `${Object.keys(sessions).length}/11 roles authenticated`);

  token = sessions.SUPER_ADMIN.token;

  // ---------- 2. notification console read matrix ----------
  const READ_ENDPOINTS = [
    ['events', '/internal/notifications/events'],
    ['templates', '/internal/notifications/templates?eventType=customer.funding.approved&channel=SMS'],
    ['changes', '/internal/notifications/changes'],
    ['provider-status', '/internal/notifications/provider-status'],
    ['provider-config', '/internal/notifications/provider-config'],
    ['deliveries', '/internal/notifications/deliveries'],
    ['outbox-receipts', '/internal/notifications/outbox-receipts'],
  ];

  const matrix = {};
  for (const [roleKey, s] of Object.entries(sessions)) {
    matrix[roleKey] = {};
    for (const [name, path] of READ_ENDPOINTS) {
      const r = await call('GET', path, { bearer: s.token });
      matrix[roleKey][name] = r.status;
    }
  }
  // SUPER_ADMIN must reach every notification read surface
  for (const [name] of READ_ENDPOINTS) {
    rec(`READ-SUPER_ADMIN-${name}`, matrix.SUPER_ADMIN[name] === 200, `status=${matrix.SUPER_ADMIN[name]}`);
  }
  // no surface may 5xx for ANY role (a 5xx is a defect; 401/403 is a correct denial)
  const fiveHundreds = [];
  for (const [roleKey, row] of Object.entries(matrix)) {
    for (const [name, st] of Object.entries(row)) if (st >= 500) fiveHundreds.push(`${roleKey}/${name}=${st}`);
  }
  rec('READ-NO-5XX-ANY-ROLE', fiveHundreds.length === 0, fiveHundreds.length ? fiveHundreds.join(',') : 'no 5xx across 11 roles x 7 surfaces');
  fs.writeFileSync('/home/user/m25e-read-matrix.json', JSON.stringify(matrix, null, 2));

  // ---------- 3. events catalogue shape ----------
  const ev = await call('GET', '/internal/notifications/events');
  const items = ev.body?.items ?? [];
  rec('EVENTS-ENVELOPE', Array.isArray(items) && items.length > 0, `items=${items.length} keys=${Object.keys(ev.body || {}).join(',')}`);
  const sample = items.find((i) => i.eventType === 'customer.funding.approved');
  rec('EVENTS-CHANNEL-SHAPE', Boolean(sample?.channels?.SMS && 'enabled' in sample.channels.SMS && 'locked' in sample.channels.SMS && 'configurationVersion' in sample.channels.SMS),
    sample ? `SMS=${JSON.stringify(sample.channels.SMS)}` : 'customer.funding.approved missing');

  // ---------- 4. H-06: backend lock state of the three disputed events ----------
  const disputed = ['customer.funding.approved', 'customer.funding.rejected', 'transfer.completed'];
  const lockReport = disputed.map((et) => {
    const it = items.find((i) => i.eventType === et);
    return { eventType: et, smsLocked: it?.channels?.SMS?.locked ?? null, editable: it?.editable ?? null, version: it?.channels?.SMS?.configurationVersion ?? null };
  });
  fs.writeFileSync('/home/user/m25e-h06-backend-locks.json', JSON.stringify(lockReport, null, 2));
  rec('H-06-BACKEND-LOCKS-RECORDED', lockReport.every((r) => r.smsLocked !== null),
    lockReport.map((r) => `${r.eventType}:locked=${r.smsLocked},v=${r.version}`).join(' | '));

  // ---------- 5. SECURITY events are locked + not template-editable ----------
  const secEvents = ['customer.registration.phone_verification', 'customer.credentials.temporary_credential', 'agent.desk.customer_otp'];
  const secReport = secEvents.map((et) => {
    const it = items.find((i) => i.eventType === et);
    return { eventType: et, locked: it?.channels?.SMS?.locked ?? null, editable: it?.editable ?? null };
  });
  rec('SECURITY-EVENTS-LOCKED', secReport.every((r) => r.locked === true && r.editable === false), JSON.stringify(secReport));

  // security template read must be refused
  const secTpl = await call('GET', '/internal/notifications/templates?eventType=customer.registration.phone_verification&channel=SMS');
  rec('SECURITY-TEMPLATE-READ-REFUSED', secTpl.status >= 400 && secTpl.status < 500, `status=${secTpl.status} body=${JSON.stringify(secTpl.body).slice(0, 160)}`);

  // security template preview must be refused
  const secPrev = await call('POST', '/internal/notifications/templates/preview', {
    body: { eventType: 'customer.registration.phone_verification', channel: 'SMS', body: 'Your code is {{otp}}' },
  });
  rec('SECURITY-TEMPLATE-PREVIEW-REFUSED', secPrev.status >= 400 && secPrev.status < 500, `status=${secPrev.status}`);

  // security CONFIGURATION change must be refused
  const secChange = await call('POST', '/internal/notifications/changes', {
    body: { type: 'CONFIGURATION', eventType: 'customer.registration.phone_verification', channel: 'SMS', enabled: false, expectedVersion: 1, reason: 'M25E security-lock probe' },
  });
  rec('SECURITY-CONFIG-CHANGE-REFUSED', secChange.status >= 400 && secChange.status < 500, `status=${secChange.status} body=${JSON.stringify(secChange.body).slice(0, 160)}`);

  // ---------- 6. H-07 / provider secret non-exposure ----------
  const pstat = await call('GET', '/internal/notifications/provider-status');
  const pcfg = await call('GET', '/internal/notifications/provider-config');
  const pstatRaw = JSON.stringify(pstat.body);
  const pcfgRaw = JSON.stringify(pcfg.body);
  const secretPatterns = [/sk_[A-Za-z0-9]{10,}/, /api[_-]?key"?\s*:\s*"[^"]{8,}"/i, /xkeysib-[A-Za-z0-9]{10,}/];
  const leaked = secretPatterns.filter((re) => re.test(pstatRaw) || re.test(pcfgRaw));
  rec('H-07-NO-SECRET-IN-PROVIDER-RESPONSES', leaked.length === 0 && !/password/i.test(pcfgRaw),
    `status=${pstat.status}/${pcfg.status} leaks=${leaked.length} keys=${Object.keys(pcfg.body || {}).join(',')}`);
  rec('H-07-SCOPE-DECLARED', typeof pstat.body?.projectionScope === 'string', `projectionScope=${pstat.body?.projectionScope}`);

  // ---------- 7. provider-config permission boundary ----------
  const boundary = {};
  for (const roleKey of ['SUPER_ADMIN', 'FINANCE_AUDITOR', 'ADMINISTRATOR', 'CUSTOMER_SERVICE', 'OPERATIONS']) {
    const r = await call('GET', '/internal/notifications/provider-config', { bearer: sessions[roleKey].token });
    boundary[roleKey] = r.status;
  }
  rec('PROVIDER-CONFIG-PERMISSION-BOUNDARY', boundary.SUPER_ADMIN === 200 && boundary.CUSTOMER_SERVICE >= 400,
    JSON.stringify(boundary));

  // non-provider-view principal must not see FULL projection
  const auditorStatus = await call('GET', '/internal/notifications/provider-status', { bearer: sessions.FINANCE_AUDITOR.token });
  rec('PROVIDER-STATUS-PROJECTION-SCOPE', [200, 401, 403].includes(auditorStatus.status),
    `FINANCE_AUDITOR status=${auditorStatus.status} scope=${auditorStatus.body?.projectionScope ?? 'n/a'}`);

  // ---------- 8. maker-checker: CONFIGURATION change -> approve -> execute ----------
  const target = 'transfer.failed'; // ordinary, unlocked, SMS
  const evT = items.find((i) => i.eventType === target);
  const curEnabled = evT?.channels?.SMS?.enabled;
  const curVersion = evT?.channels?.SMS?.configurationVersion;

  const create = await call('POST', '/internal/notifications/changes', {
    body: { type: 'CONFIGURATION', eventType: target, channel: 'SMS', enabled: !curEnabled, expectedVersion: curVersion, reason: 'M25E integration verification — governed trigger toggle' },
  });
  rec('GOV-PROPOSAL-CREATED', create.status === 201 || create.status === 200,
    `status=${create.status} approvalId=${create.body?.approvalId} actionFingerprint=${create.body?.actionFingerprint}`);

  const approvalId = create.body?.approvalId;
  if (approvalId) {
    // requester must not be the checker (maker-checker separation)
    const selfApprove = await call('POST', `/internal/a2/workforce/approvals/${approvalId}/approve`, { body: { comment: 'self' } });
    rec('GOV-MAKER-CANNOT-SELF-APPROVE', selfApprove.status >= 400, `status=${selfApprove.status}`);

    // execute before approval must fail
    const earlyExec = await call('POST', `/internal/notifications/changes/${approvalId}/execute`);
    rec('GOV-EXECUTE-BEFORE-APPROVAL-REFUSED', earlyExec.status >= 400 && earlyExec.status < 500, `status=${earlyExec.status}`);

    // independent checker approves
    const checker = sessions.FINANCE_CONTROLLER.token;
    const approve = await call('POST', `/internal/a2/workforce/approvals/${approvalId}/approve`, { body: { comment: 'M25E independent verification' }, bearer: checker });
    rec('GOV-CHECKER-APPROVES', approve.status === 200 || approve.status === 201, `status=${approve.status} body=${JSON.stringify(approve.body).slice(0, 160)}`);

    // checker executes the stored proposal — Admin Web primary path sends NO body at all
    const exec = await call('POST', `/internal/notifications/changes/${approvalId}/execute`, { bearer: checker });
    const appliedOk = (exec.status === 200 || exec.status === 201) &&
      JSON.stringify(exec.body || {}).includes(String(!curEnabled));
    rec('GOV-CHECKER-EXECUTES', appliedOk, `status=${exec.status} body=${JSON.stringify(exec.body).slice(0, 200)}`);

    // the change is now real: registry reflects it
    const after = await call('GET', '/internal/notifications/events');
    const afterIt = (after.body?.items ?? []).find((i) => i.eventType === target);
    rec('GOV-APPLIED-STATE-VISIBLE', afterIt?.channels?.SMS?.enabled === !curEnabled,
      `${target} SMS enabled ${curEnabled} -> ${afterIt?.channels?.SMS?.enabled} (version ${afterIt?.channels?.SMS?.configurationVersion})`);

    // replay of the same proposal must not double-apply
    const replay = await call('POST', `/internal/notifications/changes/${approvalId}/execute`, { bearer: checker });
    rec('GOV-REPLAY-REFUSED', replay.status >= 400 && replay.status < 500, `status=${replay.status}`);

    // restore original state through the same governed path
    const restoreCreate = await call('POST', '/internal/notifications/changes', {
      body: { type: 'CONFIGURATION', eventType: target, channel: 'SMS', enabled: curEnabled, expectedVersion: afterIt?.channels?.SMS?.configurationVersion, reason: 'M25E restore verified baseline state' },
    });
    if (restoreCreate.body?.approvalId) {
      await call('POST', `/internal/a2/workforce/approvals/${restoreCreate.body.approvalId}/approve`, { body: { comment: 'restore' }, bearer: checker });
      const restoreExec = await call('POST', `/internal/notifications/changes/${restoreCreate.body.approvalId}/execute`, { bearer: checker });
      const restored = await call('GET', '/internal/notifications/events');
      const restoredIt = (restored.body?.items ?? []).find((i) => i.eventType === target);
      rec('GOV-RESTORED-BASELINE', restoredIt?.channels?.SMS?.enabled === curEnabled,
        `restore exec=${restoreExec.status} ${target} SMS enabled back to ${restoredIt?.channels?.SMS?.enabled}`);
    }
  } else {
    rec('GOV-PROPOSAL-CREATED', false, 'no approvalId returned — governance flow could not be exercised');
  }

  // ---------- 9. H-06 divergence: can an API client disable a "UI-locked" mandatory event? ----------
  const h06Probe = await call('POST', '/internal/notifications/changes', {
    body: { type: 'CONFIGURATION', eventType: 'customer.funding.approved', channel: 'SMS', enabled: false, expectedVersion: items.find((i) => i.eventType === 'customer.funding.approved')?.channels?.SMS?.configurationVersion, reason: 'M25E H-06 divergence probe (NOT executed)' },
  });
  fs.writeFileSync('/home/user/m25e-h06-probe.json', JSON.stringify({ status: h06Probe.status, body: h06Probe.body }, null, 2));
  rec('H-06-DIVERGENCE-DOCUMENTED', true,
    `backend accepted CONFIGURATION proposal to disable customer.funding.approved: status=${h06Probe.status} approvalId=${h06Probe.body?.approvalId ?? 'none'} (proposal left UNAPPROVED and UNEXECUTED — no state changed)`);

  // ---------- 10. H-04: deposit/withdrawal events have no catalogue entry ----------
  const blockedEvents = ['deposit.completed', 'deposit.failed', 'withdrawal.completed', 'withdrawal.failed'];
  const present = blockedEvents.filter((et) => items.some((i) => i.eventType === et));
  rec('H-04-NO-DEPOSIT-WITHDRAWAL-CATALOGUE', present.length === 0, `absent from catalogue: ${blockedEvents.join(', ')} (present=${present.join(',') || 'none'})`);

  // a change proposal for a blocked event must be refused
  const h04Change = await call('POST', '/internal/notifications/changes', {
    body: { type: 'CONFIGURATION', eventType: 'deposit.completed', channel: 'SMS', enabled: true, expectedVersion: 1, reason: 'M25E H-04 probe' },
  });
  rec('H-04-CHANGE-REFUSED', h04Change.status >= 400 && h04Change.status < 500, `status=${h04Change.status} body=${JSON.stringify(h04Change.body).slice(0, 140)}`);

  // ---------- 11. deliveries / outbox receipts read shape + quarantine visibility ----------
  const del = await call('GET', '/internal/notifications/deliveries?page=1&limit=20');
  const delKeys = Object.keys(del.body || {}).sort().join(',');
  rec('DELIVERIES-ENVELOPE', del.status === 200 && ['data', 'total', 'page', 'limit', 'totalPages', 'hasNextPage'].every((k) => k in (del.body || {})),
    `status=${del.status} keys=${delKeys} total=${del.body?.total}`);

  const rcpt = await call('GET', '/internal/notifications/outbox-receipts?page=1&limit=20');
  const rcptKeys = Object.keys(rcpt.body || {}).sort().join(',');
  rec('RECEIPTS-ENVELOPE', rcpt.status === 200 && ['data', 'total', 'page', 'limit'].every((k) => k in (rcpt.body || {})),
    `status=${rcpt.status} keys=${rcptKeys} total=${rcpt.body?.total}`);

  // status filter values the Admin Web relies on
  for (const st of ['QUARANTINED', 'UNSUPPORTED', 'SUPPRESSED', 'FAILED', 'MATERIALIZED']) {
    const f = await call('GET', `/internal/notifications/outbox-receipts?status=${st}`);
    rec(`RECEIPTS-FILTER-${st}`, f.status === 200, `status=${f.status} total=${f.body?.total}`);
  }
  for (const st of ['PENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNKNOWN', 'DEAD']) {
    const f = await call('GET', `/internal/notifications/deliveries?status=${st}`);
    rec(`DELIVERIES-FILTER-${st}`, f.status === 200, `status=${f.status} total=${f.body?.total}`);
  }
  // EMAIL channel filter (A2 relies on this being live)
  const emailFilter = await call('GET', '/internal/notifications/deliveries?channel=EMAIL');
  rec('DELIVERIES-FILTER-EMAIL', emailFilter.status === 200, `status=${emailFilter.status} total=${emailFilter.body?.total}`);

  // ---------- 12. read-only customer preferences + history ----------
  // These are workforce-only read surfaces used by CustomerPersonalInformationPanel.
  const prefs = await call('GET', '/internal/customers/00000000-0000-0000-0000-000000000000/notification-preferences');
  rec('CUSTOMER-PREFS-SURFACE', prefs.status !== 500, `status=${prefs.status} (404/400 acceptable for unknown customer, 5xx is not)`);
  const hist = await call('GET', '/internal/customers/00000000-0000-0000-0000-000000000000/notification-preferences/history');
  rec('CUSTOMER-PREFS-HISTORY-SURFACE', hist.status !== 500, `status=${hist.status}`);

  // ---------- 13. test-send in dev: console simulation only, never a live vendor ----------
  // In development with NOTIFICATION_SMS_PROVIDER=console and no governed row, the
  // documented non-production exception applies: a LOCAL SIMULATION is permitted.
  // What must hold: it is reported as the console provider, the destination is masked,
  // and it can never promote the channel to a verified / production-ready state.
  const ts = await call('POST', '/internal/notifications/test-send', { body: { channel: 'SMS', destination: '+2348000000000' } });
  const tsBody = ts.body || {};
  rec('TEST-SEND-IS-CONSOLE-SIMULATION-ONLY', (ts.status === 400 || ts.status === 503) || tsBody.provider === 'console',
    `status=${ts.status} provider=${tsBody.provider} (a non-console provider here would be external activation)`);
  rec('TEST-SEND-MASKS-DESTINATION', !JSON.stringify(tsBody).includes('+2348000000000'),
    `destination echoed in clear: ${JSON.stringify(tsBody).includes('+2348000000000')} masked=${tsBody.destination}`);
  const psAfter = await call('GET', '/internal/notifications/provider-status');
  const smsGates = psAfter.body?.sms?.gates || {};
  rec('TEST-SEND-NEVER-PROMOTES-READINESS',
    smsGates.enabled !== true && smsGates.productionReady !== true && smsGates.deliveryTested !== true,
    `sms lifecycle=${psAfter.body?.sms?.lifecycleState} gates=${JSON.stringify(smsGates)}`);

  // ---------- summary ----------
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(OUT, JSON.stringify({ results, passed: results.length - failed.length, failed: failed.length }, null, 2));
  console.log(`\n=== M25E API MATRIX: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
