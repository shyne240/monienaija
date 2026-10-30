import { AgentAuthenticationExecutionService } from '../src/agent-authentication/agent-authentication-execution.service';
import { AgentAuthenticationSessionService } from '../src/agent-authentication/agent-authentication-session.service';
import { AgentLifecycleService } from '../src/agent/agent-lifecycle.service';
import { AuditService } from '../src/operations/audit.service';
import { bearer, createMission15aFixture } from './support/mission15a-fixture';

describe('Mission 15A — Agent session lifecycle and administrative revocation (HTTP + PostgreSQL)', () => {
  let f: Awaited<ReturnType<typeof createMission15aFixture>>;
  let manager: { id: string; token: string };
  let auditor: { id: string; token: string };

  beforeAll(async () => {
    f = await createMission15aFixture('m15sessions');
    manager = await f.workforce('AGENT_NETWORK_MANAGER');
    auditor = await f.workforce('FINANCE_AUDITOR');
  }, 180_000);
  afterAll(async () => { if (f) await f.close(); }, 60_000);

  it.each(['suspend', 'terminate'] as const)(
    '%s revokes every active session atomically and keeps credential data unchanged',
    async (action) => {
      const agent = await f.agent();
      const first = await f.login(agent);
      const second = await f.login(agent);
      const before = await f.dataSource.query(
        `SELECT id,password_hash,password_version,status,rotation_required FROM agent_authentication_credentials WHERE id=$1`,
        [agent.credentialId],
      );
      const response = await f.app.inject({
        method: 'POST', url: `/api/v1/internal/admin/agents/${agent.id}/${action}`,
        headers: bearer(manager.token), payload: { reason: 'Administrative lifecycle test' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(action === 'suspend' ? 'SUSPENDED' : 'TERMINATED');
      const rows = await f.dataSource.query(
        `SELECT id,status,revoked_at,revoke_reason FROM agent_authentication_sessions WHERE agent_id=$1 ORDER BY id`, [agent.id],
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.status).toBe('REVOKED');
        expect(row.revoked_at).not.toBeNull();
        expect(row.revoke_reason).toBe(`Agent ${action === 'suspend' ? 'SUSPENDED' : 'TERMINATED'}`);
      }
      expect(await f.dataSource.query(
        `SELECT id,password_hash,password_version,status,rotation_required FROM agent_authentication_credentials WHERE id=$1`,
        [agent.credentialId],
      )).toEqual(before);
      const audit = await f.dataSource.query(
        `SELECT action,actor,new_values FROM audit_events
         WHERE entity_type='AGENT_AUTHENTICATION_SESSION' AND entity_id = ANY($1::uuid[]) AND action='SESSION_REVOKED'`,
        [[first.sessionId, second.sessionId]],
      );
      expect(audit).toHaveLength(2);
      expect(audit.every((event: { actor: string }) => event.actor === manager.id)).toBe(true);
      expect(JSON.stringify(audit)).not.toContain(first.token);
      expect(JSON.stringify(audit)).not.toContain(agent.password);
      for (const session of [first, second]) {
        expect((await f.app.inject({ method: 'GET', url: '/api/v1/agents/me', headers: bearer(session.token) })).statusCode).toBe(401);
      }
      if (action === 'suspend') {
        const reactivated = await f.app.inject({
          method: 'POST', url: `/api/v1/internal/admin/agents/${agent.id}/reactivate`, headers: bearer(manager.token),
        });
        expect(reactivated.statusCode).toBe(200);
        expect((await f.app.inject({ method: 'GET', url: '/api/v1/agents/me', headers: bearer(first.token) })).statusCode).toBe(401);
        const fresh = await f.login(agent);
        expect((await f.app.inject({ method: 'GET', url: '/api/v1/agents/me', headers: bearer(fresh.token) })).statusCode).toBe(200);
      }
    },
  );

  it.each(['suspend', 'terminate'] as const)('legacy %s alias revokes sessions even with no request body', async (action) => {
    const agent = await f.agent();
    const session = await f.login(agent);
    const response = await f.app.inject({
      method: 'POST', url: `/api/v1/internal/agents/${agent.id}/${action}`, headers: bearer(manager.token),
    });
    expect(response.statusCode).toBe(200);
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/agents/me', headers: bearer(session.token) })).statusCode).toBe(401);
    const [row] = await f.dataSource.query(`SELECT status FROM agent_authentication_sessions WHERE id=$1`, [session.sessionId]);
    expect(row.status).toBe('REVOKED');
  });

  it.each(['PENDING', 'SUSPENDED', 'TERMINATED', 'DELETED'] as const)(
    'rejects an existing session after an out-of-band %s change', async (state) => {
      const agent = await f.agent();
      const session = await f.login(agent);
      if (state === 'DELETED') {
        await f.dataSource.query(`UPDATE agents SET deleted_at=clock_timestamp() WHERE id=$1`, [agent.id]);
      } else {
        await f.dataSource.query(`UPDATE agents SET status=$2 WHERE id=$1`, [agent.id, state]);
      }
      expect((await f.app.inject({ method: 'GET', url: '/api/v1/agents/me', headers: bearer(session.token) })).statusCode).toBe(401);
      const login = await f.app.inject({ method: 'POST', url: '/api/v1/agents/sessions', payload: { agentId: agent.id, password: agent.password } });
      expect(login.statusCode).toBe(401);
      expect(login.json().message).toBe('Invalid credentials');
    },
  );

  it.each(['ACTIVE', 'PENDING', 'SUSPENDED', 'TERMINATED', 'DELETED'] as const)(
    'admin can revoke active sessions in %s without replacing the credential', async (state) => {
      const agent = await f.agent();
      const session = await f.login(agent);
      if (state === 'DELETED') {
        await f.dataSource.query(`UPDATE agents SET deleted_at=clock_timestamp() WHERE id=$1`, [agent.id]);
      } else {
        await f.dataSource.query(`UPDATE agents SET status=$2 WHERE id=$1`, [agent.id, state]);
      }
      const before = await f.dataSource.query(
        `SELECT id,password_hash,password_version,status,rotation_required FROM agent_authentication_credentials WHERE id=$1`, [agent.credentialId],
      );
      const url = `/api/v1/internal/admin/agents/${agent.id}/sessions/revoke`;
      const revoked = await f.app.inject({ method: 'POST', url, headers: bearer(manager.token) });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toEqual({ agentId: agent.id, revokedSessionCount: 1 });
      const again = await f.app.inject({ method: 'POST', url, headers: bearer(manager.token) });
      expect(again.statusCode).toBe(200);
      expect(again.json().revokedSessionCount).toBe(0);
      expect(await f.dataSource.query(
        `SELECT id,password_hash,password_version,status,rotation_required FROM agent_authentication_credentials WHERE id=$1`, [agent.credentialId],
      )).toEqual(before);
      const [row] = await f.dataSource.query(`SELECT status, revoke_reason FROM agent_authentication_sessions WHERE id=$1`, [session.sessionId]);
      expect(row).toEqual({ status: 'REVOKED', revoke_reason: 'Administrative session revocation' });
      const events = await f.dataSource.query(
        `SELECT action,actor,new_values FROM audit_events WHERE entity_type='AGENT' AND entity_id=$1 AND action='AGENT_SESSIONS_REVOKED' ORDER BY occurred_at`, [agent.id],
      );
      expect(events.map((e: { new_values: { revokedSessionCount: number } }) => e.new_values.revokedSessionCount)).toEqual([1, 0]);
      expect(events.every((e: { actor: string }) => e.actor === manager.id)).toBe(true);
      expect(JSON.stringify(events)).not.toContain(session.token);
      expect(JSON.stringify(events)).not.toContain(agent.password);
      if (state === 'ACTIVE') {
        expect((await f.app.inject({ method: 'GET', url: '/api/v1/agents/me', headers: bearer(session.token) })).statusCode).toBe(401);
        await f.login(agent); // Revocation does not prevent subsequent legitimate login.
      }
    },
  );

  it('denies unentitled and non-workforce callers before any session changes', async () => {
    const agent = await f.agent();
    const session = await f.login(agent);
    const url = `/api/v1/internal/admin/agents/${agent.id}/sessions/revoke`;
    expect((await f.app.inject({ method: 'POST', url, headers: bearer(auditor.token) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'POST', url, headers: bearer(session.token) })).statusCode).toBe(403);
    expect((await f.app.inject({ method: 'POST', url })).statusCode).toBe(401);
    const [row] = await f.dataSource.query(`SELECT status FROM agent_authentication_sessions WHERE id=$1`, [session.sessionId]);
    expect(row.status).toBe('ACTIVE');
  });

  it('rolls back the lifecycle transition and session changes if the revocation audit fails', async () => {
    const agent = await f.agent();
    const session = await f.login(agent);
    const audit = f.moduleRef.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = jest.spyOn(audit, 'record').mockImplementation((manager, event) => {
      if (event.action === 'SESSION_REVOKED') throw new Error('synthetic audit failure');
      return original(manager, event);
    });
    try {
      await expect(f.moduleRef.get(AgentLifecycleService).suspend(agent.id, manager.id)).rejects.toThrow('synthetic audit failure');
    } finally { spy.mockRestore(); }
    const [row] = await f.dataSource.query(
      `SELECT a.status AS agent_status,s.status AS session_status FROM agents a JOIN agent_authentication_sessions s ON s.agent_id=a.id WHERE s.id=$1`,
      [session.sessionId],
    );
    expect(row).toEqual({ agent_status: 'ACTIVE', session_status: 'ACTIVE' });
    expect((await f.app.inject({ method: 'GET', url: '/api/v1/agents/me', headers: bearer(session.token) })).statusCode).toBe(200);
  });

  it('serializes session issuance behind a concurrent suspension and rejects the stale authentication result', async () => {
    const agent = await f.agent();
    const execution = f.moduleRef.get(AgentAuthenticationExecutionService);
    const sessions = f.moduleRef.get(AgentAuthenticationSessionService);
    const lifecycle = f.moduleRef.get(AgentLifecycleService);
    const auth = await execution.authenticate({ agentId: agent.id, password: agent.password, actor: agent.id });
    expect(auth.authenticated).toBe(true);
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const original = sessions.revokeAllForAgentInManager.bind(sessions);
    const spy = jest.spyOn(sessions, 'revokeAllForAgentInManager').mockImplementationOnce(async (...args) => {
      reached();
      await held;
      return original(...args);
    });
    try {
      const suspend = lifecycle.suspend(agent.id, manager.id);
      await entered; // Agent row is locked and status update is still uncommitted.
      const issueOutcome = sessions.issue({ authentication: auth, actor: agent.id })
        .then(() => 'issued', (error: Error) => error.message);
      const early = await Promise.race([issueOutcome, new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 100))]);
      expect(early).toBe('waiting');
      release();
      await suspend;
      expect(await issueOutcome).toBe('Invalid credentials');
      const rows = await f.dataSource.query(`SELECT id FROM agent_authentication_sessions WHERE agent_id=$1 AND status='ACTIVE'`, [agent.id]);
      expect(rows).toHaveLength(0);
    } finally { release(); spy.mockRestore(); }
  });
});
