import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { A2WorkforceSession } from '../src/authorization/workforce-authentication.entity';
import type {
  A2RateLimitRuleV1,
  A2WorkforceConfigurationV1,
} from '../src/authorization/workforce-authentication.types';
import { A2_WORKFORCE_CONFIG } from '../src/authorization/workforce-oidc.service';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { createMission15aFixture } from './support/mission15a-fixture';

const AUDIENCE = 'workforce-admin';
const DASHBOARD = '/api/v1/internal/a2/workforce/dashboard/my-dashboard';
const sessionPath = (id: string) => `/api/v1/internal/a2/workforce/sessions/${id}`;
const reason = { reason: 'Mission 19A test logout' };

describe('Mission 19A — workforce logout (real TCP HTTP + PostgreSQL)', () => {
  let f: Awaited<ReturnType<typeof createMission15aFixture>>;
  let baseUrl: string;
  let sessions: A2WorkforceSessionService;

  beforeAll(async () => {
    f = await createMission15aFixture('m19alogout');
    sessions = f.moduleRef.get(A2WorkforceSessionService);
    await f.app.listen({ port: 0, host: '0.0.0.0' });
    const address = f.app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 180_000);

  afterAll(async () => { if (f) await f.close(); }, 60_000);

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.text() };
  }

  async function workforce(role = 'FINANCE_AUDITOR') {
    const identity = await f.workforce(role);
    const principal = await sessions.validate(identity.token, AUDIENCE);
    if (!principal.sessionId) throw new Error('A2 session did not have an id');
    return { ...identity, principal, sessionId: principal.sessionId };
  }

  async function anotherSession(principalId: string) {
    const now = new Date();
    return sessions.establish({
      issuer: 'https://workforce.test', subject: principalId, principalId, audience: [AUDIENCE],
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      authenticatedAt: now.toISOString(), assuranceLevel: 'MFA', amr: ['pwd', 'otp'], acr: null,
      signingKeyId: 'test',
    });
  }

  it('lets FINANCE_AUDITOR revoke its current session and rejects token replay', async () => {
    const auditor = await workforce();
    expect(auditor.principal.readOnlyPrincipal).toBe(true);

    const before = await call('GET', '/api/v1/internal/agents', auditor.token);
    const revoke = await call('DELETE', sessionPath(auditor.sessionId), auditor.token, reason);
    const replay = await call('GET', '/api/v1/internal/agents', auditor.token);
    // Status-only evidence; never print the bearer token or any login credential.
    console.info(`M19A_LIVE_HTTP auditor read=${before.status} self-revoke=${revoke.status} replay=${replay.status}`);
    expect({ before: before.status, revoke: revoke.status, replay: replay.status }).toEqual({
      before: 200, revoke: 200, replay: 401,
    });
    expect((await call('DELETE', sessionPath(auditor.sessionId), auditor.token, reason)).status).toBe(401);

    const rows: Array<{ status: string; revoke_reason: string; revoked_at: Date | null }> = await f.dataSource.query(
      `SELECT status,revoke_reason,revoked_at FROM a2_workforce_sessions WHERE id=$1`,
      [auditor.sessionId],
    );
    expect(rows[0]).toMatchObject({ status: 'REVOKED', revoke_reason: reason.reason });
    expect(rows[0]!.revoked_at).not.toBeNull();
  });

  it('exercises local-admin login, logout and replay across real HTTP', async () => {
    // Test-only local credential and role assignment; no external identity or real secret is used.
    const identity = await f.workforce('FINANCE_AUDITOR');
    const email = `m19-${randomUUID()}@example.test`;
    const password = `disposable-${randomUUID()}`;
    const salt = randomBytes(16);
    const digest = pbkdf2Sync(password, salt, 10_000, 32, 'sha256');
    const passwordHash = `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
    const subject = `local-admin-credential:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
    const principalId = `https://workforce.test:${subject}`;
    await f.dataSource.query(
      `INSERT INTO local_admin_credentials(email,password_hash,hash_algorithm) VALUES($1,$2,'PBKDF2')`,
      [email, passwordHash],
    );
    await f.dataSource.query(
      `UPDATE a2_finance_role_assignments SET principal_id=$1 WHERE principal_id=$2`,
      [principalId, identity.id],
    );
    // The reused fixture supplies only a privileged-approval limiter; add a real enabled
    // workforce-login limiter to this in-memory test configuration, not to production policy.
    const config = f.moduleRef.get<A2WorkforceConfigurationV1>(A2_WORKFORCE_CONFIG);
    (config.rateLimits as A2RateLimitRuleV1[]).push({
      category: 'workforce-authentication', capacity: 100, refillRatePerSecond: 100, enabled: true,
    });

    const login = await call('POST', '/api/v1/internal/a2/workforce/local-admin-sessions', undefined, { email, password });
    expect(login.status).toBe(201);
    const token = JSON.parse(login.body) as {
      accessToken: string; sessionId: string; principal: { roles: string[]; readOnlyPrincipal: boolean };
    };
    expect(token.principal).toMatchObject({ roles: ['FINANCE_AUDITOR'], readOnlyPrincipal: true });
    const before = await call('GET', DASHBOARD, token.accessToken);
    const logout = await call('DELETE', sessionPath(token.sessionId), token.accessToken, reason);
    const replay = await call('GET', DASHBOARD, token.accessToken);
    console.info(`M19A_LOCAL_LOGIN_HTTP login=${login.status} read=${before.status} self-revoke=${logout.status} replay=${replay.status}`);
    expect([before.status, logout.status, replay.status]).toEqual([200, 200, 401]);
  });

  it('rejects other sessions, unrelated unsafe methods, and invalid credentials without revoking anyone', async () => {
    const auditor = await workforce();
    const sibling = await anotherSession(auditor.id);
    const other = await workforce();
    const unknownId = randomUUID();

    const deniedSibling = await call('DELETE', sessionPath(sibling.sessionId), auditor.token, reason);
    const deniedOther = await call('DELETE', sessionPath(other.sessionId), auditor.token, reason);
    const deniedUnknown = await call('DELETE', sessionPath(unknownId), auditor.token, reason);
    expect([deniedSibling.status, deniedOther.status, deniedUnknown.status]).toEqual([403, 403, 403]);
    expect(deniedSibling.body).toEqual(deniedOther.body);
    expect(deniedSibling.body).toEqual(deniedUnknown.body);

    expect((await call('DELETE', sessionPath(auditor.sessionId), undefined, reason)).status).toBe(401);
    expect((await call('DELETE', sessionPath(auditor.sessionId), 'invalid-token', reason)).status).toBe(401);
    expect((await call('DELETE', `/api/v1/internal/a2/workforce/roles/${auditor.id}/FINANCE_AUDITOR`, auditor.token, reason)).status).toBe(403);
    expect((await call('POST', '/api/v1/internal/a2/workforce/roles', auditor.token, {})).status).toBe(403);
    expect((await call('PATCH', `/api/v1/internal/agents/classes/${randomUUID()}`, auditor.token, {})).status).toBe(403);
    expect((await call('PUT', '/api/v1/internal/a2/workforce/dashboard/assignments/FINANCE_AUDITOR', auditor.token, {})).status).toBe(403);

    // Fastify decodes params, but an encoded or suffixed raw path is not the exact logout path.
    const encodedId = `%${auditor.sessionId.charCodeAt(0).toString(16)}${auditor.sessionId.slice(1)}`;
    expect((await call('DELETE', sessionPath(encodedId), auditor.token, reason)).status).toBe(403);
    expect([403, 404]).toContain((await call('DELETE', `${sessionPath(auditor.sessionId)}/extra`, auditor.token, reason)).status);
    expect((await call('GET', DASHBOARD, auditor.token)).status).toBe(200);
    expect((await call('GET', DASHBOARD, sibling.accessToken)).status).toBe(200);
    expect((await call('GET', DASHBOARD, other.token)).status).toBe(200);

    // The exception leaves the controller's DTO validation intact.
    expect((await call('DELETE', sessionPath(auditor.sessionId), auditor.token, {})).status).toBe(400);
    expect((await call('DELETE', sessionPath(auditor.sessionId), auditor.token, { reason: '' })).status).toBe(400);
    expect((await call('DELETE', sessionPath(auditor.sessionId), auditor.token, { reason: 'x'.repeat(501) })).status).toBe(400);
    expect((await call('GET', DASHBOARD, auditor.token)).status).toBe(200);
    expect((await call('DELETE', `${sessionPath(auditor.sessionId)}?source=logout`, auditor.token, reason)).status).toBe(200);
    expect((await call('GET', DASHBOARD, auditor.token)).status).toBe(401);
    expect((await call('GET', DASHBOARD, sibling.accessToken)).status).toBe(200);
    expect((await call('GET', DASHBOARD, other.token)).status).toBe(200);
  });

  it('preserves the session service ownership check for a non-read-only workforce principal', async () => {
    const operator = await workforce('OPERATIONS');
    const sibling = await anotherSession(operator.id);
    const other = await workforce();
    expect(operator.principal.readOnlyPrincipal).toBe(false);
    expect((await call('DELETE', sessionPath(other.sessionId), operator.token, reason)).status).toBe(401);
    expect((await call('GET', DASHBOARD, other.token)).status).toBe(200);
    expect((await call('DELETE', sessionPath(sibling.sessionId), operator.token, reason)).status).toBe(200);
    expect((await call('GET', DASHBOARD, sibling.accessToken)).status).toBe(401);
    expect((await call('GET', DASHBOARD, operator.token)).status).toBe(200);
  });

  it('works for a different catalogue-read-only role without adding any function grants', async () => {
    await f.dataSource.query(
      `INSERT INTO authorization_roles(role_key,display_name,description,read_only)
       VALUES('M19_TEST_READONLY','M19 test read-only','Isolated test role',true)`,
    );
    const reader = await workforce('M19_TEST_READONLY');
    expect(reader.principal.readOnlyPrincipal).toBe(true);
    expect(reader.principal.scopes).toEqual([]);
    expect((await call('GET', DASHBOARD, reader.token)).status).toBe(200);
    expect((await call('POST', '/api/v1/internal/a2/workforce/roles', reader.token, {})).status).toBe(403);
    expect((await call('DELETE', sessionPath(reader.sessionId), reader.token, reason)).status).toBe(200);
    expect((await call('GET', DASHBOARD, reader.token)).status).toBe(401);
  });

  it('keeps logout and replay working for all eleven existing catalogue roles', async () => {
    const roles = [
      'SUPER_ADMIN', 'FINANCE_PREPARER', 'FINANCE_CONTROLLER', 'FINANCE_AUDITOR',
      'ADMINISTRATOR', 'OPERATIONS', 'AGENT_NETWORK_MANAGER', 'COMPLIANCE',
      'RISK_FRAUD', 'CUSTOMER_SERVICE', 'TREASURY',
    ];
    for (const role of roles) {
      const actor = await workforce(role);
      const before = await call('GET', DASHBOARD, actor.token);
      const logout = await call('DELETE', sessionPath(actor.sessionId), actor.token, reason);
      const replay = await call('GET', DASHBOARD, actor.token);
      expect({ role, before: before.status, logout: logout.status, replay: replay.status }).toEqual({
        role, before: 200, logout: 200, replay: 401,
      });
    }
    console.info('M19A_ROLE_MATRIX 11 roles: read=200 self-revoke=200 replay=401');
  });

  it('does not resurrect a session when an earlier live HTTP validation finishes after logout', async () => {
    const auditor = await workforce();
    type Resolution = {
      roles: readonly string[]; scopes: readonly string[];
      administrativeCapability: boolean; readOnlyPrincipal: boolean;
    };
    const internal = sessions as unknown as {
      resolve: (principalId: string, now: Date) => Promise<Resolution>;
    };
    const originalResolve = internal.resolve.bind(sessions);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const spy = jest.spyOn(internal, 'resolve').mockImplementationOnce(async (id, now) => {
      const roles = await originalResolve(id, now);
      entered();
      await blocked;
      return roles;
    });
    const inFlightRead = call('GET', DASHBOARD, auditor.token);
    await ready;
    let logout: Awaited<ReturnType<typeof call>>;
    try {
      logout = await call('DELETE', sessionPath(auditor.sessionId), auditor.token, reason);
    } finally {
      release();
    }
    const earlierRead = await inFlightRead;
    spy.mockRestore();
    const replay = await call('GET', DASHBOARD, auditor.token);
    const rows: Array<{ status: string }> = await f.dataSource.query(
      `SELECT status FROM a2_workforce_sessions WHERE id=$1`, [auditor.sessionId],
    );
    console.info(`M19A_CONCURRENT_HTTP self-revoke=${logout.status} delayed-read=${earlierRead.status} replay=${replay.status} status=${rows[0]!.status}`);
    expect([logout.status, earlierRead.status, replay.status, rows[0]!.status]).toEqual([200, 401, 401, 'REVOKED']);
  });

  it('does not overwrite revocation metadata when an expired validation races logout', async () => {
    const auditor = await workforce();
    const repository = f.dataSource.getRepository(A2WorkforceSession);
    const originalFind = repository.findOne.bind(repository);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const spy = jest.spyOn(repository, 'findOne').mockImplementationOnce(async (options) => {
      const row = await originalFind(options);
      entered();
      await blocked;
      return row;
    });
    const delayedExpiry = sessions.validate(auditor.token, AUDIENCE, new Date(Date.now() + 7_200_000))
      .then(() => null, (error: unknown) => error);
    await ready;
    try {
      await sessions.revoke(auditor.sessionId, auditor.principal, 'Expiry race logout');
    } finally {
      release();
    }
    expect(await delayedExpiry).toMatchObject({ status: 401 });
    spy.mockRestore();
    const rows: Array<{ status: string; revoke_reason: string; revoked_at: Date | null }> = await f.dataSource.query(
      `SELECT status,revoke_reason,revoked_at FROM a2_workforce_sessions WHERE id=$1`, [auditor.sessionId],
    );
    expect(rows[0]).toMatchObject({ status: 'REVOKED', revoke_reason: 'Expiry race logout' });
    expect(rows[0]!.revoked_at).not.toBeNull();
    expect((await call('GET', DASHBOARD, auditor.token)).status).toBe(401);
  });
});
