/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion */
import { randomUUID } from 'node:crypto';

import { AgentClassService } from '../src/agent/agent-class.service';
import { AuditService } from '../src/operations/audit.service';
import { OutletService } from '../src/outlet/outlet.service';
import { TerminalService } from '../src/outlet/terminal.service';
import { bearer, createMission15aFixture } from './support/mission15a-fixture';

describe('Mission 15A Agent management (real Nest and isolated PostgreSQL)', () => {
  let f: Awaited<ReturnType<typeof createMission15aFixture>>;
  let manager: { id: string; token: string };
  let auditor: { id: string; token: string };
  let operations: { id: string; token: string };
  let reviewOnly: { id: string; token: string };
  let activateOnly: { id: string; token: string };
  let supportToken: string;
  let classId: string;
  let agent: { id: string; credentialId: string; password: string };
  let agentToken: string;

  beforeAll(async () => {
    f = await createMission15aFixture('mission15amanagement');
    manager = await f.workforce('AGENT_NETWORK_MANAGER');
    auditor = await f.workforce('FINANCE_AUDITOR');
    operations = await f.workforce('OPERATIONS');
    const superAdmin = await f.workforce('SUPER_ADMIN');
    // Isolated test-only roles prove the two functions are independently enforced. No seed or
    // production role catalogue is changed; the temporary database is destroyed after this suite.
    for (const [roleKey, functionCode] of [['M15_REVIEW_ONLY', 'agent.review_application'], ['M15_ACTIVATE_ONLY', 'agent.activate']]) {
      const [role] = await f.dataSource.query(
        `INSERT INTO authorization_roles(role_key,display_name,description) VALUES($1,$1,'isolated test role') RETURNING id`, [roleKey],
      );
      await f.dataSource.query(
        `INSERT INTO authorization_role_functions(role_id,function_code,access_type,assigned_at) VALUES($1,$2,'EXECUTE',now())`,
        [role.id, functionCode],
      );
    }
    reviewOnly = await f.workforce('M15_REVIEW_ONLY');
    activateOnly = await f.workforce('M15_ACTIVATE_ONLY');
    const username = `m15support${randomUUID().replace(/-/g, '')}`;
    const provision = await f.app.inject({ method: 'POST', url: '/api/v1/internal/admin/support/workforce-users', headers: bearer(superAdmin.token), payload: { username } });
    expect(provision.statusCode).toBe(201);
    const supportLogin = await f.app.inject({ method: 'POST', url: '/api/v1/internal/support/workforce-sessions', payload: { username, password: provision.json().temporaryPassword } });
    expect(supportLogin.statusCode).toBe(200);
    supportToken = supportLogin.json().accessToken;
    const agentClass = await f.moduleRef.get(AgentClassService).create({ name: 'Mission 15A locator', applicableServices: ['CASH_TO_CASH'], actor: 'isolated-test' });
    classId = agentClass.id;
    agent = await f.agent(classId);
    agentToken = (await f.login(agent)).token;
  }, 180000);

  afterAll(async () => { if (f) await f.close(); }, 60000);

  async function createOutlet() {
    const response = await f.app.inject({
      method: 'POST', url: `/api/v1/internal/agents/${agent.id}/outlets`, headers: bearer(manager.token),
      payload: { reference: `M15-O-${randomUUID()}`, name: 'Test location', displayName: 'Old public name', addressLine: 'Old address', city: 'Abuja', state: 'FCT', country: 'NG' },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; version: number; reference: string };
  }

  async function createTerminal(outletId: string) {
    const response = await f.app.inject({
      method: 'POST', url: `/api/v1/internal/outlets/${outletId}/terminals`, headers: bearer(manager.token),
      payload: { reference: `M15-T-${randomUUID()}`, outletId, label: 'Old label', serialNumber: 'OLD-SERIAL' },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; version: number; reference: string };
  }

  async function application(status: 'DRAFT' | 'APPROVED', fixedId = randomUUID()) {
    await f.dataSource.query(
      `INSERT INTO agent_applications(id,reference,agent_class_id,status,applicant_reference,created_by)
       VALUES($1,$2,$3,$4,$5,'isolated-test')`,
      [fixedId, `M15-APP-${randomUUID()}`, classId, status, `M15-APPLICANT-${randomUUID()}`],
    );
    return fixedId;
  }

  it('requires agent.view on all five Outlet/Terminal reads, including real SUPPORT, and prevents enumeration', async () => {
    const outlet = await createOutlet();
    const terminal = await createTerminal(outlet.id);
    const paths = [
      `/api/v1/internal/agents/${agent.id}/outlets`,
      `/api/v1/internal/outlets/${outlet.id}`,
      `/api/v1/internal/outlets/${outlet.id}/terminals`,
      `/api/v1/internal/agents/${agent.id}/terminals`,
      `/api/v1/internal/terminals/${terminal.id}`,
    ];
    for (const url of paths) {
      expect((await f.app.inject({ method: 'GET', url, headers: bearer(manager.token) })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'GET', url, headers: bearer(auditor.token) })).statusCode).toBe(200);
      expect((await f.app.inject({ method: 'GET', url, headers: bearer(operations.token) })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'GET', url, headers: bearer(supportToken) })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'GET', url, headers: bearer(agentToken) })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await f.app.inject({ method: 'HEAD', url: paths[1]!, headers: bearer(auditor.token) })).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/internal/outlets/${randomUUID()}`, headers: bearer(operations.token) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/internal/outlets/${randomUUID()}`, headers: bearer(auditor.token) })).statusCode).toBe(404);
    const denials = await f.dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='AUTHORIZATION_DECISION' AND actor=$1 AND action='DENIED' AND new_values->>'action'='agent.view'`,
      [operations.id],
    );
    expect(denials.length).toBeGreaterThanOrEqual(6);
    expect(denials.every((row: { new_values: { reason: string } }) => row.new_values.reason === 'FUNCTION_MISSING')).toBe(true);
  });

  it('separates application review from activation across both aliases and records denied decisions', async () => {
    const appA = await application('APPROVED');
    const appB = await application('APPROVED');
    const urls = [
      `/api/v1/internal/agents/applications/${appA}/activate`,
      `/api/v1/internal/admin/agents/applications/${appB}/activate`,
    ];
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/internal/agents/applications', headers: bearer(reviewOnly.token) })).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/internal/agents/applications', headers: bearer(activateOnly.token) })).statusCode).toBe(403);
    for (const url of urls) {
      const denied = await f.app.inject({ method: 'POST', url, headers: bearer(reviewOnly.token) });
      expect(denied.statusCode).toBe(403);
      const allowed = await f.app.inject({ method: 'POST', url, headers: bearer(activateOnly.token) });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json().status).toBe('ACTIVE');
    }
    const denials = await f.dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='AUTHORIZATION_DECISION' AND actor=$1 AND action='DENIED' AND new_values->>'action'='agent.activate'`,
      [reviewOnly.id],
    );
    expect(denials).toHaveLength(2);
    const allowedAudits = await f.dataSource.query(
      `SELECT new_values FROM audit_events WHERE entity_type='AUTHORIZATION_DECISION' AND actor=$1 AND action='ALLOWED' AND new_values->>'action'='agent.activate'`,
      [activateOnly.id],
    );
    expect(allowedAudits).toHaveLength(2); // no duplicate guard audit on successful requests
  });

  it.each(['/api/v1/internal/agents', '/api/v1/internal/admin/agents'])(
    'does not bypass application approval or mask failures on %s/:id/activate', async (base) => {
      const sharedId = randomUUID();
      await application('DRAFT', sharedId);
      await f.dataSource.query(`INSERT INTO agents(id,reference,status,agent_class_id) VALUES($1,$2,'PENDING',$3)`, [sharedId, `M15-COLLISION-${randomUUID()}`, classId]);
      const response = await f.app.inject({ method: 'POST', url: `${base}/${sharedId}/activate`, headers: bearer(activateOnly.token) });
      expect(response.statusCode).toBe(409);
      const [row] = await f.dataSource.query(`SELECT status FROM agents WHERE id=$1`, [sharedId]);
      expect(row.status).toBe('PENDING');
      const directId = randomUUID();
      await f.dataSource.query(`INSERT INTO agents(id,reference,status,agent_class_id) VALUES($1,$2,'PENDING',$3)`, [directId, `M15-DIRECT-${randomUUID()}`, classId]);
      const direct = await f.app.inject({ method: 'POST', url: `${base}/${directId}/activate`, headers: bearer(activateOnly.token) });
      expect(direct.statusCode).toBe(200);
      expect(direct.json().status).toBe('ACTIVE');
    },
  );

  it('retains applicant capability non-enumeration', async () => {
    const created = await f.app.inject({ method: 'POST', url: '/api/v1/agents/applications', payload: { agentClassId: classId, applicantReference: `M15-APPLICANT-${randomUUID()}` } });
    expect(created.statusCode).toBe(201);
    const { id, applicantAccessToken } = created.json();
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/agents/applications/${id}`, headers: bearer(applicantAccessToken) })).statusCode).toBe(200);
    const existing = await f.app.inject({ method: 'GET', url: `/api/v1/agents/applications/${id}`, headers: bearer('invalid-capability') });
    const missing = await f.app.inject({ method: 'GET', url: `/api/v1/agents/applications/${randomUUID()}`, headers: bearer('invalid-capability') });
    expect(existing.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(existing.json().message).toBe(missing.json().message);
  });

  it('updates Outlet metadata, audits before/after and refreshes the public locator without leaking identities', async () => {
    const outlet = await createOutlet();
    const response = await f.app.inject({
      method: 'PATCH', url: `/api/v1/internal/outlets/${outlet.id}`, headers: bearer(manager.token),
      payload: { expectedVersion: outlet.version, name: ' Updated legal name ', displayName: ' New public name ', addressLine: ' 12 Sample Road ', city: ' Maitama ', state: 'FCT', country: 'NG' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: 'Updated legal name', displayName: 'New public name', addressLine: '12 Sample Road', city: 'Maitama', state: 'FCT', country: 'NG', version: outlet.version + 1, agentId: agent.id, reference: outlet.reference });
    const events = await f.dataSource.query(`SELECT actor,previous_values,new_values FROM audit_events WHERE entity_id=$1 AND action='AGENT_OUTLET_UPDATED'`, [outlet.id]);
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe(manager.id);
    expect(events[0].previous_values.displayName).toBe('Old public name');
    expect(events[0].new_values.displayName).toBe('New public name');
    expect(events[0].new_values.version).toBe(outlet.version + 1);
    const locator = await f.app.inject({ method: 'GET', url: '/api/v1/public/agents/cash-to-cash-outlets?city=Maitama&state=FCT' });
    expect(locator.statusCode).toBe(200);
    expect(locator.json().data).toContainEqual({ name: 'New public name', address: '12 Sample Road', city: 'Maitama', state: 'FCT', country: 'NG' });
    expect(JSON.stringify(locator.json())).not.toContain(outlet.id);
    expect(JSON.stringify(locator.json())).not.toContain(agent.id);
    const clear = await f.app.inject({ method: 'PATCH', url: `/api/v1/internal/outlets/${outlet.id}`, headers: bearer(manager.token), payload: { expectedVersion: outlet.version + 1, displayName: null, addressLine: '' } });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toMatchObject({ displayName: null, addressLine: null, version: outlet.version + 2 });
    const fallback = await f.app.inject({ method: 'GET', url: '/api/v1/public/agents/cash-to-cash-outlets?city=Maitama&state=FCT' });
    expect(fallback.json().data).toContainEqual({ name: 'Cash-to-Cash service outlet', address: null, city: 'Maitama', state: 'FCT', country: 'NG' });
  });

  it('updates and clears Terminal metadata without changing its identity or association', async () => {
    const outlet = await createOutlet();
    const terminal = await createTerminal(outlet.id);
    const response = await f.app.inject({ method: 'PATCH', url: `/api/v1/internal/terminals/${terminal.id}`, headers: bearer(manager.token), payload: { expectedVersion: terminal.version, label: ' Counter 2 ', serialNumber: null } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ label: 'Counter 2', serialNumber: null, agentId: agent.id, outletId: outlet.id, reference: terminal.reference, version: terminal.version + 1 });
    const events = await f.dataSource.query(`SELECT actor,previous_values,new_values FROM audit_events WHERE entity_id=$1 AND action='AGENT_TERMINAL_UPDATED'`, [terminal.id]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: manager.id, previous_values: { label: 'Old label', serialNumber: 'OLD-SERIAL' }, new_values: { label: 'Counter 2', serialNumber: null } });
  });

  it('fails closed on invalid, stale, unauthorized and identity/status mutation PATCHes', async () => {
    const outlet = await createOutlet();
    const terminal = await createTerminal(outlet.id);
    for (const [url, field] of [[`/api/v1/internal/outlets/${outlet.id}`, 'displayName'], [`/api/v1/internal/terminals/${terminal.id}`, 'label']] as const) {
      const patch = (payload: object, token = manager.token) => f.app.inject({ method: 'PATCH', url, headers: bearer(token), payload });
      expect((await patch({ [field]: 'new' })).statusCode).toBe(400);
      expect((await patch({ expectedVersion: '1', [field]: 'new' })).statusCode).toBe(400);
      expect((await patch({ expectedVersion: 1 })).statusCode).toBe(400);
      expect((await patch({ expectedVersion: 1, [field]: 'bad\ncontrol' })).statusCode).toBe(400);
      expect((await patch({ expectedVersion: 1, [field]: 'new', status: 'TERMINATED' })).statusCode).toBe(400);
      expect((await patch({ expectedVersion: 1, [field]: 'new', agentId: randomUUID() })).statusCode).toBe(400);
      expect((await patch({ expectedVersion: 2, [field]: 'new' })).statusCode).toBe(409);
      expect((await patch({ expectedVersion: 1, [field]: 'new' }, operations.token)).statusCode).toBe(403);
      expect((await patch({ expectedVersion: 1, [field]: 'new' }, auditor.token)).statusCode).toBe(403);
      expect((await patch({ expectedVersion: 1, [field]: 'new' }, supportToken)).statusCode).toBe(403);
      expect((await patch({ expectedVersion: 1, [field]: 'new' }, agentToken)).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'PATCH', url, payload: { expectedVersion: 1, [field]: 'new' } })).statusCode).toBe(401);
    }
    expect((await f.app.inject({ method: 'PATCH', url: `/api/v1/internal/outlets/${randomUUID()}`, headers: bearer(manager.token), payload: { expectedVersion: 1, name: 'Missing' } })).statusCode).toBe(404);
    const [outletRow] = await f.dataSource.query(`SELECT version,status,display_name FROM agent_outlets WHERE id=$1`, [outlet.id]);
    const [terminalRow] = await f.dataSource.query(`SELECT version,status,label FROM agent_terminals WHERE id=$1`, [terminal.id]);
    expect(outletRow).toEqual({ version: 1, status: 'ACTIVE', display_name: 'Old public name' });
    expect(terminalRow).toEqual({ version: 1, status: 'ACTIVE', label: 'Old label' });
  });

  it.each(['outlet', 'terminal'] as const)('serializes concurrent %s updates so exactly one version wins', async (kind) => {
    const outlet = await createOutlet();
    const terminal = kind === 'terminal' ? await createTerminal(outlet.id) : undefined;
    const id = terminal?.id ?? outlet.id;
    const url = `/api/v1/internal/${kind === 'outlet' ? 'outlets' : 'terminals'}/${id}`;
    const field = kind === 'outlet' ? 'displayName' : 'label';
    const results = await Promise.all(['First update', 'Second update'].map((value) => f.app.inject({ method: 'PATCH', url, headers: bearer(manager.token), payload: { expectedVersion: 1, [field]: value } })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.statusCode === 200)!.json();
    expect(winner.version).toBe(2);
    const stored = await f.app.inject({ method: 'GET', url, headers: bearer(manager.token) });
    expect(stored.json()[field]).toBe(winner[field]);
    const audits = await f.dataSource.query(`SELECT id FROM audit_events WHERE entity_id=$1 AND action=$2`, [id, kind === 'outlet' ? 'AGENT_OUTLET_UPDATED' : 'AGENT_TERMINAL_UPDATED']);
    expect(audits).toHaveLength(1);
  });

  it.each(['outlet', 'terminal'] as const)('consumes the %s version even for identical metadata', async (kind) => {
    const outlet = await createOutlet();
    const terminal = kind === 'terminal' ? await createTerminal(outlet.id) : undefined;
    const id = terminal?.id ?? outlet.id;
    const url = `/api/v1/internal/${kind === 'outlet' ? 'outlets' : 'terminals'}/${id}`;
    const payload = kind === 'outlet'
      ? { expectedVersion: 1, displayName: 'Old public name' }
      : { expectedVersion: 1, label: 'Old label' };
    const results = await Promise.all([1, 2].map(() => f.app.inject({ method: 'PATCH', url, headers: bearer(manager.token), payload })));
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const success = results.find((response) => response.statusCode === 200)!;
    expect(success.json().version).toBe(2);
  });

  it.each(['outlet', 'terminal'] as const)('rolls back a %s update when its audit write fails', async (kind) => {
    const outlet = await createOutlet();
    const terminal = kind === 'terminal' ? await createTerminal(outlet.id) : undefined;
    const id = terminal?.id ?? outlet.id;
    const audit = f.moduleRef.get(AuditService);
    const original = audit.record.bind(audit);
    const action = kind === 'outlet' ? 'AGENT_OUTLET_UPDATED' : 'AGENT_TERMINAL_UPDATED';
    const spy = jest.spyOn(audit, 'record').mockImplementation((manager, event) => {
      if (event.action === action) throw new Error('synthetic metadata audit failure');
      return original(manager, event);
    });
    try {
      if (kind === 'outlet') {
        await expect(f.moduleRef.get(OutletService).updateMetadata(id, { expectedVersion: 1, displayName: 'Must roll back', actor: manager.id })).rejects.toThrow('synthetic metadata audit failure');
      } else {
        await expect(f.moduleRef.get(TerminalService).updateMetadata(id, { expectedVersion: 1, label: 'Must roll back', actor: manager.id })).rejects.toThrow('synthetic metadata audit failure');
      }
    } finally { spy.mockRestore(); }
    const row = kind === 'outlet' ? await f.moduleRef.get(OutletService).getById(id) : await f.moduleRef.get(TerminalService).getById(id);
    expect(row.version).toBe(1);
    expect(kind === 'outlet' ? (row as { displayName: string }).displayName : (row as { label: string }).label).toBe(kind === 'outlet' ? 'Old public name' : 'Old label');
  });
  it.each(['outlet', 'terminal'] as const)('coordinates %s status changes with stale metadata updates', async (kind) => {
    const outlet = await createOutlet();
    const terminal = kind === 'terminal' ? await createTerminal(outlet.id) : undefined;
    const id = terminal?.id ?? outlet.id;
    const outletService = f.moduleRef.get(OutletService);
    const terminalService = f.moduleRef.get(TerminalService);
    const audit = f.moduleRef.get(AuditService);
    const original = audit.record.bind(audit);
    let reached!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const action = kind === 'outlet' ? 'AGENT_OUTLET_SUSPENDED' : 'AGENT_TERMINAL_SUSPENDED';
    const spy = jest.spyOn(audit, 'record').mockImplementation(async (manager, event) => {
      if (event.action === action) { reached(); await held; }
      return original(manager, event);
    });
    try {
      const transition = kind === 'outlet' ? outletService.suspend(id, manager.id) : terminalService.suspend(id, manager.id);
      await entered;
      const patch = kind === 'outlet'
        ? outletService.updateMetadata(id, { expectedVersion: 1, displayName: 'Stale write', actor: manager.id })
        : terminalService.updateMetadata(id, { expectedVersion: 1, label: 'Stale write', actor: manager.id });
      // Attach the rejection handler before releasing the held transaction.
      const patchResult = patch.then(() => 'unexpected success', (error: Error) => error.message);
      release();
      await transition;
      expect(await patchResult).toMatch(/version is stale/i);
    } finally { release(); spy.mockRestore(); }
    const row = kind === 'outlet' ? await outletService.getById(id) : await terminalService.getById(id);
    expect(row.status).toBe('SUSPENDED');
    expect(row.version).toBe(2);
    expect(kind === 'outlet' ? (row as { displayName: string }).displayName : (row as { label: string }).label).toBe(kind === 'outlet' ? 'Old public name' : 'Old label');
  });

  it('reports a consistent expiry backlog without sweeping, financial disposition or sensitive fields', async () => {
    const empty = await f.app.inject({ method: 'GET', url: '/api/v1/internal/admin/cash-to-cash/expiry-status', headers: bearer(operations.token) });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ dueCount: 0, oldestDueAt: null, expiredCount: 0, worker: { configuredEnabled: false, schedulerRunning: false, tickInProgress: false } });
    const debit = randomUUID();
    const credit = randomUUID();
    const transferIds: string[] = [];
    await f.dataSource.transaction(async (db) => {
      await db.query(`INSERT INTO ledger_accounts(id,code,name,account_type,normal_balance,currency,accounting_unit,allow_negative_balance)
        VALUES($1,$2,'test debit','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',true),($3,$4,'test credit','ASSET','CREDIT','NGN','CUSTOMER_FUNDS',true)`,
        [debit, `M15-D-${randomUUID()}`, credit, `M15-C-${randomUUID()}`]);
      for (const [status, hours] of [['UNCLAIMED', -5], ['UNCLAIMED', -1], ['UNCLAIMED', 24], ['EXPIRED', -2]] as const) {
        const journal = randomUUID();
        const transfer = randomUUID();
        transferIds.push(transfer);
        await db.query(`INSERT INTO ledger_journals(id,idempotency_key,request_hash,currency,accounting_unit,status,total_minor)
          VALUES($1,$2,$3,'NGN','CUSTOMER_FUNDS','POSTED',1000)`, [journal, `m15-journal-${randomUUID()}`, 'a'.repeat(64)]);
        await db.query(`INSERT INTO ledger_lines(id,journal_id,ledger_account_id,line_number,direction,amount_minor,currency,accounting_unit)
          VALUES($1,$2,$3,1,'DEBIT',1000,'NGN','CUSTOMER_FUNDS'),($4,$2,$5,2,'CREDIT',1000,'NGN','CUSTOMER_FUNDS')`,
          [randomUUID(), journal, debit, randomUUID(), credit]);
        await db.query(`INSERT INTO cash_to_cash_transfers(id,agent_id,beneficiary_phone,principal_minor,fee_minor,vat_minor,total_minor,currency,status,transfer_code_hash,hash_algorithm,journal_id,idempotency_key,expires_at,expired_at)
          VALUES($1,$2,'7000000123',1000,0,0,1000,'NGN',$3,'PRIVATE-TEST-HASH','PBKDF2',$4,$5,clock_timestamp()+($6 * interval '1 hour'),CASE WHEN $3::varchar='EXPIRED' THEN clock_timestamp() ELSE NULL END)`,
          [transfer, agent.id, status, journal, `m15-transfer-${randomUUID()}`, hours]);
      }
    });
    const before = await f.dataSource.query(`SELECT id,status,expires_at,expired_at,journal_id FROM cash_to_cash_transfers WHERE id=ANY($1::uuid[]) ORDER BY id`, [transferIds]);
    const financialBefore = await f.dataSource.query(`SELECT (SELECT count(*) FROM ledger_journals)::text AS journals,(SELECT count(*) FROM ledger_lines)::text AS lines`);
    const url = '/api/v1/internal/admin/cash-to-cash/expiry-status';
    const result = await f.app.inject({ method: 'GET', url, headers: bearer(operations.token) });
    expect(result.statusCode).toBe(200);
    const body = result.json();
    expect(body).toMatchObject({ dueCount: 2, expiredCount: 1, worker: { configuredEnabled: false, schedulerRunning: false, tickInProgress: false } });
    const oldest = before.filter((row: { status: string; expires_at: Date }) => row.status === 'UNCLAIMED').map((row: { expires_at: Date }) => row.expires_at.getTime()).sort((a: number, b: number) => a - b)[0];
    expect(new Date(body.oldestDueAt).getTime()).toBe(oldest);
    expect(new Date(body.asOf).getTime()).toBeGreaterThanOrEqual(oldest);
    for (const secret of ['7000000123', 'PRIVATE-TEST-HASH', ...transferIds]) expect(result.body).not.toContain(secret);
    expect((await f.app.inject({ method: 'GET', url, headers: bearer(auditor.token) })).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'GET', url, headers: bearer(manager.token) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'GET', url, headers: bearer(supportToken) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'GET', url, headers: bearer(agentToken) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/internal/admin/cash-to-cash/transfers', headers: bearer(operations.token) })).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/internal/admin/cash-to-cash/transfers', headers: bearer(manager.token) })).statusCode).toBe(403);
    expect(await f.dataSource.query(`SELECT id,status,expires_at,expired_at,journal_id FROM cash_to_cash_transfers WHERE id=ANY($1::uuid[]) ORDER BY id`, [transferIds])).toEqual(before);
    expect(await f.dataSource.query(`SELECT (SELECT count(*) FROM ledger_journals)::text AS journals,(SELECT count(*) FROM ledger_lines)::text AS lines`)).toEqual(financialBefore);
    const expiryAudits = await f.dataSource.query(`SELECT id FROM audit_events WHERE action='CASH_TO_CASH_EXPIRED' AND entity_id=ANY($1::uuid[])`, [transferIds]);
    expect(expiryAudits).toHaveLength(0);
  });
});
