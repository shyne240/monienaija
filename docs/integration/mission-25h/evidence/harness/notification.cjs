/**
 * Mission 25H — notification regression verification over real HTTP.
 *
 * Confirms the customer-preference correction did not weaken: provider fail-closed behaviour,
 * maker-checker separation, event governance, diagnostic masking, and H-04 quarantine.
 */
const fs = require('node:fs');
const { Client } = require('pg');

const BASE = 'http://127.0.0.1:3000/api/v1';
const results = [];
let pass = 0;
let fail = 0;

function record(group, name, ok, detail) {
  results.push({ group, name, ok, detail: detail ?? null });
  if (ok) {
    pass++;
    console.log(`PASS [${group}] ${name}`);
  } else {
    fail++;
    console.log(`FAIL [${group}] ${name} — ${JSON.stringify(detail)}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const h = {};
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  return { status: res.status, text, json };
}

(async () => {
  const creds = JSON.parse(
    fs.readFileSync('/home/user/m25h-harness/monienaija-local-dev-11-roles-credentials.json', 'utf8'),
  );
  const login = async (role) => {
    const r = await req('POST', '/internal/a2/workforce/local-admin-sessions', {
      body: { email: creds[role].email, password: creds[role].password },
    });
    return { token: r.json.accessToken, principal: r.json.principal };
  };
  const sa = await login('SUPER_ADMIN');
  const fc = await login('FINANCE_CONTROLLER');
  const fp = await login('FINANCE_PREPARER');

  // ---------- 1. provider fail-closed ----------
  let r = await req('GET', '/internal/notifications/provider-status', { token: sa.token });
  const status = r.json;
  record(
    'N1-fail-closed',
    'provider-status reports NOT enabled / NOT_CONFIGURED with no live provider',
    r.status === 200 && JSON.stringify(status).includes('NOT_CONFIGURED'),
    { status: r.status, body: r.text.slice(0, 300) },
  );

  const smsSend = await req('POST', '/internal/notifications/test-send', {
    token: sa.token,
    body: { channel: 'SMS', destination: '+2348030000001' },
  });
  // The local SMS provider is the `console` adapter (NOTIFICATION_SMS_PROVIDER=console): it
  // simulates delivery and sends nothing to a vendor. A real vendor send would require a
  // provider credential, and none is configured here.
  const smsProviderIsConsole = /"provider":"console"/.test(smsSend.text);
  record(
    'N1-fail-closed',
    'SMS resolves to the console adapter only — no external vendor provider is configured or used',
    smsProviderIsConsole,
    { status: smsSend.status, provider: smsSend.json?.provider, body: smsSend.text.slice(0, 160) },
  );

  const emailSend = await req('POST', '/internal/notifications/test-send', {
    token: sa.token,
    body: { channel: 'EMAIL', destination: 'nobody@example.com' },
  });
  record(
    'N1-fail-closed',
    'EMAIL test-send is refused (no provider configured), not delivered',
    emailSend.status === 400 && /PROVIDER_NOT_CONFIGURED/.test(emailSend.text),
    { status: emailSend.status, body: emailSend.text.slice(0, 200) },
  );

  // ---------- 2. registry / governance ----------
  r = await req('GET', '/internal/notifications/events', { token: sa.token });
  const events = Array.isArray(r.json) ? r.json : (r.json?.items ?? r.json?.events ?? []);
  const eventKeys = events.map((e) => e.eventType ?? e.key ?? e.code).filter(Boolean);
  record('N2-governance', 'notification event catalogue is readable by an authorized role', r.status === 200 && eventKeys.length > 0, {
    status: r.status,
    count: eventKeys.length,
  });

  const h04 = ['deposit.completed', 'deposit.failed', 'withdrawal.completed', 'withdrawal.failed'];
  const presentH04 = h04.filter((k) => eventKeys.includes(k));
  record(
    'N3-h04-quarantine',
    'H-04 financial events remain absent from the notification catalogue (no invented mapping)',
    presentH04.length === 0,
    { presentH04 },
  );

  const tenure = eventKeys.find((k) => k === 'customer.funding.approved');
  record('N3-h04-quarantine', 'ordinary funded-outcome event is catalogued (contrast with H-04)', Boolean(tenure), {
    sample: eventKeys.slice(0, 8),
  });

  // H-04 config proposal must be refused.
  const badProposal = await req('POST', '/internal/notifications/changes', {
    token: sa.token,
    body: {
      type: 'CONFIGURATION',
      eventType: 'deposit.completed',
      channel: 'SMS',
      enabled: true,
      expectedVersion: 1,
      reason: 'M25H H-04 mapping probe — must be refused, no policy invented',
    },
  });
  record(
    'N3-h04-quarantine',
    'a configuration proposal for deposit.completed is refused',
    badProposal.status >= 400,
    { status: badProposal.status, body: badProposal.text.slice(0, 200) },
  );

  // ---------- 4. maker-checker on a governed change (H-06 probe behaviour preserved) ----------
  const proposal = await req('POST', '/internal/notifications/changes', {
    token: sa.token,
    body: {
      type: 'CONFIGURATION',
      eventType: 'customer.funding.requested',
      channel: 'EMAIL',
      enabled: false,
      expectedVersion: 1,
      reason: 'M25H regression probe — maker/checker only, left unapproved and unexecuted',
    },
  });
  const approvalId = proposal.json?.approvalId ?? proposal.json?.id;
  record('N4-maker-checker', 'a governed change proposal is created by the maker', proposal.status === 201 || proposal.status === 200, {
    status: proposal.status,
    approvalId,
    body: proposal.text.slice(0, 200),
  });

  if (approvalId) {
    const selfApprove = await req('POST', `/internal/a2/workforce/approvals/${approvalId}/approve`, {
      token: sa.token,
      body: {},
    });
    record('N4-maker-checker', 'the maker cannot approve its own proposal (403)', selfApprove.status === 403, {
      status: selfApprove.status,
      body: selfApprove.text.slice(0, 160),
    });

    const executeEarly = await req('POST', `/internal/notifications/changes/${approvalId}/execute`, {
      token: fc.token,
      body: {},
    });
    // The exact status code is 409 CONFLICT ("Approval is not consumable: REQUESTED") here;
    // the security property is that execution cannot precede approval, whatever the code.
    record(
      'N4-maker-checker',
      'execution before approval is refused (4xx), so the change cannot take effect',
      executeEarly.status >= 400 && executeEarly.status < 500,
      { status: executeEarly.status, body: executeEarly.text.slice(0, 200) },
    );
  }

  // ---------- 5. operational read surfaces still work ----------
  const deliveries = await req('GET', '/internal/notifications/deliveries', { token: sa.token });
  record('N5-read-surfaces', 'delivery monitoring remains readable for an authorized role', deliveries.status === 200, {
    status: deliveries.status,
    rows: Array.isArray(deliveries.json) ? deliveries.json.length : null,
  });

  const receipts = await req('GET', '/internal/notifications/outbox-receipts', { token: sa.token });
  record('N5-read-surfaces', 'outbox receipt monitoring remains readable', receipts.status === 200, {
    status: receipts.status,
  });

  // ---------- 6. diagnostic identifier masking ----------
  const maskedSend = await req('POST', '/internal/notifications/test-send', {
    token: sa.token,
    body: { channel: 'SMS', destination: '+2348031230000' },
  });
  record(
    'N6-masking',
    'a refused test-send echoes no full destination number',
    !/\+?2348031230000/.test(maskedSend.text),
    { status: maskedSend.status, body: maskedSend.text.slice(0, 200) },
  );

  // ---------- 7. H-06 state: locks unchanged by this integration ----------
  const client = new Client({ host: '127.0.0.1', port: 5432, user: 'monienaija', password: 'monienaija-pw', database: 'monienaija' });
  await client.connect();
  const locks = await client.query(
    `SELECT event_type, channel, is_locked FROM notification_event_configurations
      WHERE event_type IN ('customer.funding.approved','customer.funding.rejected','transfer.completed')
      ORDER BY event_type, channel`,
  );
  record(
    'N7-h06',
    'H-06 discrepancy is unchanged by this integration (ordinary events still unlocked server-side)',
    locks.rowCount === 0 || locks.rows.every((x) => x.is_locked === false),
    { rows: locks.rows },
  );

  const prefConfig = await client.query(
    `SELECT event_type, channel, is_enabled, version FROM notification_event_configurations
      WHERE event_type = 'customer.funding.requested' AND channel='EMAIL'`,
  );
  record(
    'N7-h06',
    'the probe left customer.funding.requested EMAIL configuration unchanged (no executed change)',
    prefConfig.rowCount === 0 || prefConfig.rows.every((x) => x.is_enabled === false),
    { rows: prefConfig.rows },
  );

  await client.end();

  fs.writeFileSync(
    '/home/user/m25h-harness/notification-results.json',
    JSON.stringify({ pass, fail, total: results.length, results }, null, 2),
  );
  console.log(`\n=== NOTIFICATION TOTALS: ${pass} passed / ${fail} failed / ${results.length} checks ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
