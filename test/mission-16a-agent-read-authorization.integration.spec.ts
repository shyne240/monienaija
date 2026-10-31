import { pbkdf2Sync, randomUUID } from 'node:crypto';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { A2WorkforceSessionService } from '../src/authorization/workforce-session.service';
import { bearer, createMission15aFixture } from './support/mission15a-fixture';

describe('Mission 16A Agent-read authorization contract (real HTTP + PostgreSQL)', () => {
  let f: Awaited<ReturnType<typeof createMission15aFixture>>;
  let agentId: string;
  let agentToken: string;
  let customerToken: string;
  let manager: { id: string; token: string };
  let operations: { id: string; token: string };
  let supportToken: string;

  beforeAll(async () => {
    f = await createMission15aFixture('m16aagentread');
    manager = await f.workforce('AGENT_NETWORK_MANAGER');
    operations = await f.workforce('OPERATIONS');
    const superAdmin = await f.workforce('SUPER_ADMIN');
    const agent = await f.agent();
    agentId = agent.id;
    agentToken = (await f.login(agent)).token;

    const username = `m16asupport${randomUUID().replace(/-/g, '')}`;
    const provision = await f.app.inject({
      method: 'POST', url: '/api/v1/internal/admin/support/workforce-users',
      headers: bearer(superAdmin.token), payload: { username },
    });
    expect(provision.statusCode).toBe(201);
    const supportLogin = await f.app.inject({
      method: 'POST', url: '/api/v1/internal/support/workforce-sessions',
      payload: { username, password: provision.json<{ temporaryPassword: string }>().temporaryPassword },
    });
    expect(supportLogin.statusCode).toBe(200);
    supportToken = supportLogin.json<{ accessToken: string }>().accessToken;

    const customers: Array<{ id: string }> = await f.dataSource.query(
      `INSERT INTO customers (reference,customer_type,status,kyc_level,kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`m16a-customer-${randomUUID()}`],
    );
    const customerId = customers[0]!.id;
    await f.dataSource.query(
      `INSERT INTO customer_profiles (customer_id,display_name,is_active) VALUES ($1,'Mission 16A Customer',true)`,
      [customerId],
    );
    const password = `Test-${randomUUID()}`;
    const salt = Buffer.from('mission-16a-customer-test-salt');
    const hash = pbkdf2Sync(password, salt, 10_000, 32, 'sha256').toString('base64url');
    await f.dataSource.query(
      `INSERT INTO customer_authentication_credentials
       (customer_id,password_hash,hash_algorithm,password_version,password_changed_at,status,account_locked,failed_authentication_count,version)
       VALUES ($1,$2,'PBKDF2',1,now(),'ACTIVE',false,0,1)`,
      [customerId, `PBKDF2$sha256$10000$${salt.toString('base64url')}$${hash}`],
    );
    const customerLogin = await f.app.inject({
      method: 'POST', url: '/api/v1/customers/sessions', payload: { customerId, password },
    });
    expect(customerLogin.statusCode).toBe(200);
    customerToken = customerLogin.json<{ accessToken: string }>().accessToken;
  }, 180_000);

  afterAll(async () => { if (f) await f.close(); }, 60_000);

  it('preserves 401 for synthetic non-workforce validator results, even with a forged function or an unknown ID', async () => {
    const sessions = f.moduleRef.get(A2WorkforceSessionService);
    const originalValidate = sessions.validate.bind(sessions);
    const synthetic = new Map<string, AuthorizationPrincipal>();
    for (const type of ['CUSTOMER', 'AGENT', 'AGGREGATOR'] as const) {
      for (const forged of [false, true]) {
        synthetic.set(`m16a-${type}-${forged}`, {
          type,
          principalId: `m16a-synthetic-${type}-${forged}`,
          roles: [],
          scopes: forged ? ['agent.view'] : [],
          customerAccess: 'NONE',
          ...(type === 'CUSTOMER' ? { customerId: randomUUID() } : {}),
          ...(type === 'AGENT' ? { agentId: randomUUID() } : {}),
          ...(type === 'AGGREGATOR' ? { aggregatorId: randomUUID() } : {}),
        });
      }
    }
    const spy = jest.spyOn(sessions, 'validate').mockImplementation(async (token, audience, now) => {
      const principal = synthetic.get(token);
      return principal ?? originalValidate(token, audience, now);
    });
    try {
      const missingId = randomUUID();
      const urls = [
        '/api/v1/internal/agents',
        `/api/v1/internal/agents/${agentId}`,
        `/api/v1/internal/agents/${missingId}`,
        `/api/v1/internal/agents/${agentId}/financial-position`,
        `/api/v1/internal/agents/${missingId}/financial-position`,
      ];
      for (const token of synthetic.keys()) {
        for (const method of ['GET', 'HEAD'] as const) {
          for (const url of urls) {
            const response = await f.app.inject({ method, url, headers: bearer(token) });
            expect(response.statusCode).toBe(401);
            if (method === 'GET') {
              expect(response.json<{ message: string }>().message).toBe('Privileged access required');
              expect(response.body).not.toContain(agentId);
            }
          }
        }
      }
      // The 401 precedence is not generalized to other function-gated routes.
      const unrelated = await f.app.inject({
        method: 'GET', url: `/api/v1/internal/outlets/${randomUUID()}`,
        headers: bearer('m16a-AGENT-false'),
      });
      expect(unrelated.statusCode).toBe(403);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps genuine Agent/Customer tokens at 403 and missing or invalid credentials at 401', async () => {
    const missingId = randomUUID();
    for (const token of [agentToken, customerToken]) {
      for (const [existing, missing] of [
        [`/api/v1/internal/agents/${agentId}`, `/api/v1/internal/agents/${missingId}`],
        [`/api/v1/internal/agents/${agentId}/financial-position`, `/api/v1/internal/agents/${missingId}/financial-position`],
      ] as Array<[string, string]>) {
        const first = await f.app.inject({ method: 'GET', url: existing, headers: bearer(token) });
        const second = await f.app.inject({ method: 'GET', url: missing, headers: bearer(token) });
        expect(first.statusCode).toBe(403);
        expect(second.statusCode).toBe(403);
        expect(second.body).toBe(first.body);
      }
      expect((await f.app.inject({ method: 'HEAD', url: '/api/v1/internal/agents', headers: bearer(token) })).statusCode).toBe(403);
    }
    for (const url of ['/api/v1/internal/agents', `/api/v1/internal/agents/${agentId}`]) {
      expect((await f.app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await f.app.inject({ method: 'GET', url, headers: bearer('not-a-real-token') })).statusCode).toBe(401);
    }
  });

  it('treats expiry capability status as metadata, not the authorization gate', async () => {
    const registry = await f.app.inject({
      method: 'GET', url: '/api/v1/internal/capabilities/CASH_TO_CASH_EXPIRY', headers: bearer(operations.token),
    });
    expect(registry.statusCode).toBe(200);
    expect(registry.json<{ apiStatus: string; adminUiStatus: string }>()).toMatchObject({
      apiStatus: 'NOT_EXPOSED', adminUiStatus: 'NOT_EXPOSED',
    });
    const endpoint = '/api/v1/internal/admin/cash-to-cash/expiry-status';
    const checkAccess = async () => {
      const allowed = await f.app.inject({ method: 'GET', url: endpoint, headers: bearer(operations.token) });
      expect(allowed.statusCode).toBe(200);
      expect((await f.app.inject({ method: 'GET', url: endpoint, headers: bearer(manager.token) })).statusCode).toBe(403);
      expect((await f.app.inject({ method: 'GET', url: endpoint })).statusCode).toBe(401);
      return allowed.json<{ worker: { configuredEnabled: boolean } }>().worker.configuredEnabled;
    };
    const enabledBefore = await checkAccess();
    // This changes only the isolated test database; no seed, production row or policy is changed.
    try {
      await f.dataSource.query(
        `UPDATE capabilities SET api_status='API_READY',admin_ui_status='ADMIN_UI_READY' WHERE capability_code='CASH_TO_CASH_EXPIRY'`,
      );
      expect(await checkAccess()).toBe(enabledBefore);
    } finally {
      await f.dataSource.query(
        `UPDATE capabilities SET api_status='NOT_EXPOSED',admin_ui_status='NOT_EXPOSED' WHERE capability_code='CASH_TO_CASH_EXPIRY'`,
      );
    }
  });

  it('requires agent.view for genuine workforce and preserves denial/success audit and non-enumeration', async () => {
    const urls = [
      '/api/v1/internal/agents',
      `/api/v1/internal/agents/${agentId}`,
      `/api/v1/internal/agents/${agentId}/financial-position`,
    ];
    for (const url of urls) {
      expect((await f.app.inject({ method: 'GET', url, headers: bearer(manager.token) })).statusCode).toBe(200);
      const denied = await f.app.inject({ method: 'GET', url, headers: bearer(operations.token) });
      expect(denied.statusCode).toBe(403);
      expect(denied.json<{ message: string }>().message).toBe('Authorization denied: FUNCTION_MISSING');
      expect((await f.app.inject({ method: 'GET', url, headers: bearer(supportToken) })).statusCode).toBe(403);
    }
    const missingId = randomUUID();
    const hidden = await f.app.inject({ method: 'GET', url: `/api/v1/internal/agents/${missingId}`, headers: bearer(operations.token) });
    expect(hidden.statusCode).toBe(403);
    expect(hidden.json<{ message: string }>().message).toBe('Authorization denied: FUNCTION_MISSING');
    expect((await f.app.inject({ method: 'GET', url: `/api/v1/internal/agents/${missingId}`, headers: bearer(manager.token) })).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'HEAD', url: urls[0]!, headers: bearer(manager.token) })).statusCode).toBe(200);
    expect((await f.app.inject({ method: 'HEAD', url: urls[0]!, headers: bearer(operations.token) })).statusCode).toBe(403);

    const audits: Array<{ action: string; actor: string; reason: string | null }> = await f.dataSource.query(
      `SELECT action,actor,new_values->>'reason' AS reason FROM audit_events
       WHERE entity_type='AUTHORIZATION_DECISION' AND actor IN ($1,$2) AND new_values->>'action'='agent.view'`,
      [manager.id, operations.id],
    );
    expect(audits.filter((event) => event.actor === operations.id)).toHaveLength(5);
    expect(audits.filter((event) => event.actor === operations.id).every((event) => event.action === 'DENIED' && event.reason === 'FUNCTION_MISSING')).toBe(true);
    expect(audits.filter((event) => event.actor === manager.id && event.action === 'ALLOWED')).toHaveLength(5);
  });
});
