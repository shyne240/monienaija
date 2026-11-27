'use strict';
const BASE = 'http://127.0.0.1:4500';
const { randomUUID } = require('node:crypto');

async function login(email, password) {
  const r = await fetch(`${BASE}/api/v1/internal/a2/workforce/local-admin-sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(j).slice(0,200)}`);
  return j.accessToken;
}
async function api(token, method, path, body) {
  const r = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, body: j ?? text };
}

(async () => {
  const superAdmin = await login('super-admin@monienaija.local', 'MonieNaija_SUPER_ADMIN_123!');
  const compliance = await login('compliance@monienaija.local', 'MonieNaija_COMPLIANCE_123!');

  const current = await api(superAdmin, 'GET', '/internal/kyc/providers');
  console.log('current version:', current.body?.version, 'status', current.status);

  const proposal = await api(superAdmin, 'POST', '/internal/kyc/providers/proposals', {
    requestId: randomUUID(),
    expectedVersion: current.body?.version ?? 0,
    reason: 'INITIAL_SETUP',
    configuration: {
      providers: {
        MONNIFY: { enabled: false, capabilities: [] },
        DOJAH: { enabled: false, capabilities: [] },
        PREMBLY: { enabled: true, capabilities: ['BVN', 'NIN'] },
        SYNTHETIC: { enabled: false, capabilities: [] },
      },
      routes: {
        BVN: { primary: 'PREMBLY', fallback: null },
        NIN: { primary: 'PREMBLY', fallback: null },
        ADDRESS_VERIFICATION: { primary: null, fallback: null },
        ENHANCED_DUE_DILIGENCE: { primary: null, fallback: null },
      },
    },
  });
  console.log('proposal:', proposal.status, JSON.stringify(proposal.body).slice(0, 260));
  if (proposal.status >= 300) process.exit(1);

  // maker/checker: a DIFFERENT principal must approve
  const approve = await api(compliance, 'POST', `/internal/kyc/providers/proposals/${proposal.body.id}/approve`, {});
  console.log('approve:', approve.status, JSON.stringify(approve.body).slice(0, 260));
  if (approve.status >= 300) process.exit(1);

  const after = await api(superAdmin, 'GET', '/internal/kyc/providers');
  console.log('version after:', after.body?.version);
  console.log('routes:', JSON.stringify(after.body?.configuration?.routes ?? after.body?.routes));
  console.log('providers:', JSON.stringify((after.body?.configuration?.providers ?? after.body?.providers)));
})().catch((e) => { console.error('CONFIG_FAILED', e.message); process.exit(1); });
