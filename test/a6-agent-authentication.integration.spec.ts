import { pbkdf2Sync, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AgentAuthenticationCredential } from '../src/agent/agent-authentication.entity';
import {
  AGENT_SESSION_AUDIENCE,
  AgentAuthenticationService,
} from '../src/agent/agent-authentication.service';
import { AgentFinancialAccountBinding } from '../src/agent/agent-financial-account-binding.entity';
import { AgentFinancialAccountService } from '../src/agent/agent-financial-account.service';
import { AgentSession } from '../src/agent/agent-session.entity';
import { AgentWallet } from '../src/agent/agent-wallet.entity';
import type { AgentFloatAccountingConfiguration } from '../src/agent/agent-float-accounting';
import { Agent } from '../src/agent/agent.entity';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentService } from '../src/agent/agent.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { PasswordHashAlgorithm } from '../src/customer-authentication/customer-authentication.enums';
import { PasswordHashVerificationService } from '../src/customer-authentication/password-hash-verification.service';
import { PinHashService } from '../src/customer-authentication/pin-hash.service';
import { DEFAULT_TRANSACTION_PIN_SECURITY_POLICY } from '../src/customer-authentication/transaction-pin-policy';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletService } from '../src/wallet/wallet.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

const LOGIN_SECRET = 'agent-login-secret-123';

/**
 * The platform stores a caller-supplied login hash (the same convention the
 * customer credential uses), so the test encodes one exactly as the shared
 * verifier expects.
 */
function encodePbkdf2(secret: string): string {
  const salt = Buffer.from('a6-agent-salt');
  const digest = pbkdf2Sync(secret, salt, 10_000, 32, 'sha256');
  return `PBKDF2$sha256$10000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
const PIN = '1357';

/**
 * A6 — Agent authentication and transaction PIN against real PostgreSQL.
 *
 * Proves the Agent security boundary is genuinely separate from Customer, that
 * secrets are never stored or emitted in plaintext, and that an authenticated
 * Agent gains no customer or administrative reach.
 */
describe('A6 Agent authentication and transaction PIN (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let agents: AgentService;
  let auth: AgentAuthenticationService;
  let financial: AgentFinancialAccountService;
  let authorization: AuthorizationService;

  const FINANCE_CONFIG: AgentFloatAccountingConfiguration = {
    enabled: true,
    accountingUnit: 'CUSTOMER_FUNDS',
    accountType: 'LIABILITY',
    normalBalance: 'CREDIT',
    accountCodePrefix: 'AGENTFLOAT',
  };

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a6agentauth');
    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    const ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
    agents = new AgentService(dataSource.getRepository(Agent), dataSource, audit);
    auth = new AgentAuthenticationService(
      dataSource.getRepository(Agent),
      dataSource.getRepository(AgentAuthenticationCredential),
      dataSource.getRepository(AgentSession),
      dataSource,
      new PinHashService(),
      new PasswordHashVerificationService(),
      audit,
      DEFAULT_TRANSACTION_PIN_SECURITY_POLICY,
    );
    financial = new AgentFinancialAccountService(
      dataSource.getRepository(Agent),
      dataSource.getRepository(AgentWallet),
      dataSource.getRepository(AgentFinancialAccountBinding),
      dataSource,
      new WalletService(dataSource.getRepository(WalletAccount), dataSource, ledger),
      ledger,
      audit,
      FINANCE_CONFIG,
    );
    authorization = new AuthorizationService(dataSource, audit);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await dataSource.query(`
      INSERT INTO agent_float_accounting_classifications
        (accounting_unit, account_type, normal_balance, is_active, approved_by)
      VALUES ('CUSTOMER_FUNDS','LIABILITY','CREDIT',TRUE,'finance-f3-decision')
    `);
  });

  async function makeAgent(status: AgentStatus = AgentStatus.ACTIVE): Promise<string> {
    const created = await agents.create({
      reference: `a6-${randomUUID().slice(0, 8)}`,
      actor: 'a6',
    });
    await dataSource.query(`UPDATE agents SET status = 'ACTIVE' WHERE id = $1`, [created.id]);
    await auth.setLoginCredential(
      created.id,
      encodePbkdf2(LOGIN_SECRET),
      PasswordHashAlgorithm.PBKDF2,
      'ops',
    );
    await auth.setTransactionPin(created.id, PIN, 'ops');
    if (status !== AgentStatus.ACTIVE) {
      await dataSource.query(`UPDATE agents SET status = $2 WHERE id = $1`, [created.id, status]);
    }
    return created.id;
  }

  describe('A-D. agent authentication identity', () => {
    it('A/H. provisions credentials and stores no plaintext', async () => {
      const agentId = await makeAgent();
      const credentials = await rows<{
        credential_type: string;
        secret_hash: string;
        hash_algorithm: string;
      }>(
        `SELECT credential_type, secret_hash, hash_algorithm
           FROM agent_authentication_credentials WHERE agent_id = $1 AND status = 'ACTIVE'
          ORDER BY credential_type`,
        [agentId],
      );

      expect(credentials.map((c) => c.credential_type)).toEqual(['PASSWORD', 'PIN']);
      for (const credential of credentials) {
        expect(credential.hash_algorithm).toBe('PBKDF2');
        expect(credential.secret_hash).not.toContain(LOGIN_SECRET);
        expect(credential.secret_hash).not.toContain(PIN);
      }
      // J. the PIN hash is not the PIN
      const pin = credentials.find((c) => c.credential_type === 'PIN');
      expect(pin?.secret_hash.length).toBeGreaterThan(20);
    });

    it('B/C/D. an ACTIVE agent authenticates and yields an AGENT principal', async () => {
      const agentId = await makeAgent();
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'agent-app');

      expect(session.audience).toBe(AGENT_SESSION_AUDIENCE);
      expect(session.token).toHaveLength(64);

      const principal = await auth.resolvePrincipal(session.token);
      expect(principal.type).toBe('AGENT');
      expect(principal.agentId).toBe(agentId);
      expect(principal.agentAccess).toBe('SELF');
      // C. not a customer in any respect
      expect(principal.type).not.toBe('CUSTOMER');
      expect(principal.customerId).toBeUndefined();
      expect(principal.customerAccess).toBe('NONE');
      // Q. no elevated identity
      expect(principal.roles).toEqual([]);
      expect(principal.scopes).toEqual([]);
    });

    it('rejects a wrong login secret and an unknown token', async () => {
      const agentId = await makeAgent();
      await expect(auth.authenticate(agentId, 'wrong-secret-value', 'x')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(auth.resolvePrincipal('deadbeef')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('only the stored token hash is persisted, never the token', async () => {
      const agentId = await makeAgent();
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'x');
      const stored = firstRow(
        await rows<{ token_hash: string }>(`SELECT token_hash FROM agent_sessions WHERE id = $1`, [
          session.sessionId,
        ]),
        'session',
      );
      expect(stored.token_hash).not.toBe(session.token);
      expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('E-G. agent status gating', () => {
    it('E/F/G. PENDING, SUSPENDED and TERMINATED agents cannot authenticate', async () => {
      for (const status of [AgentStatus.PENDING, AgentStatus.SUSPENDED, AgentStatus.TERMINATED]) {
        const agentId = await makeAgent(status);
        await expect(auth.authenticate(agentId, LOGIN_SECRET, 'x')).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
    });

    it('an existing session stops resolving once the agent is suspended', async () => {
      const agentId = await makeAgent();
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'x');
      await expect(auth.resolvePrincipal(session.token)).resolves.toBeDefined();

      await dataSource.query(`UPDATE agents SET status = 'SUSPENDED' WHERE id = $1`, [agentId]);
      await expect(auth.resolvePrincipal(session.token)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('I-N. transaction PIN', () => {
    async function principalFor(agentId: string): Promise<AuthorizationPrincipal> {
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'x');
      return auth.resolvePrincipal(session.token);
    }

    it('K. a correct PIN authorizes the agent', async () => {
      const agentId = await makeAgent();
      const principal = await principalFor(agentId);
      await expect(
        auth.authorizeTransaction(principal, agentId, PIN, 'agent-app'),
      ).resolves.toBeUndefined();
    });

    it('L. an incorrect PIN is rejected', async () => {
      const agentId = await makeAgent();
      const principal = await principalFor(agentId);
      await expect(
        auth.authorizeTransaction(principal, agentId, '9999', 'agent-app'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('M/N. failed attempts lock the PIN at the configured threshold and unlock restores it', async () => {
      const agentId = await makeAgent();
      const principal = await principalFor(agentId);
      const max = DEFAULT_TRANSACTION_PIN_SECURITY_POLICY.maxFailedAttempts;

      for (let attempt = 0; attempt < max; attempt += 1) {
        await expect(
          auth.authorizeTransaction(principal, agentId, '9999', 'agent-app'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }

      const locked = firstRow(
        await rows<{ account_locked: boolean; failed_authentication_count: number }>(
          `SELECT account_locked, failed_authentication_count
             FROM agent_authentication_credentials
            WHERE agent_id = $1 AND credential_type = 'PIN' AND status = 'ACTIVE'`,
          [agentId],
        ),
        'pin credential',
      );
      expect(locked.account_locked).toBe(true);
      expect(locked.failed_authentication_count).toBe(max);

      // N. even the correct PIN cannot authorize while locked
      await expect(
        auth.authorizeTransaction(principal, agentId, PIN, 'agent-app'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await auth.unlockTransactionPin(agentId, 'ops');
      await expect(
        auth.authorizeTransaction(principal, agentId, PIN, 'agent-app'),
      ).resolves.toBeUndefined();
    });

    it('a successful verification clears the failure counter', async () => {
      const agentId = await makeAgent();
      const principal = await principalFor(agentId);
      await expect(
        auth.authorizeTransaction(principal, agentId, '9999', 'x'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await auth.authorizeTransaction(principal, agentId, PIN, 'x');

      const credential = firstRow(
        await rows<{ failed_authentication_count: number }>(
          `SELECT failed_authentication_count FROM agent_authentication_credentials
            WHERE agent_id = $1 AND credential_type = 'PIN' AND status = 'ACTIVE'`,
          [agentId],
        ),
        'pin credential',
      );
      expect(credential.failed_authentication_count).toBe(0);
    });

    it('the PIN is not interchangeable with the login secret', async () => {
      const agentId = await makeAgent();
      const principal = await principalFor(agentId);
      // The login secret must not pass PIN normalization/verification.
      await expect(
        auth.authorizeTransaction(principal, agentId, LOGIN_SECRET, 'x'),
      ).rejects.toBeInstanceOf(BadRequestException);
      // The PIN must not authenticate a login. It is rejected as a credential
      // mismatch because login and PIN are separate credential rows.
      await expect(auth.authenticate(agentId, PIN, 'x')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('O-R. authorization boundary', () => {
    it('O. one agent cannot authorize another agent transaction', async () => {
      const first = await makeAgent();
      const second = await makeAgent();
      const session = await auth.authenticate(first, LOGIN_SECRET, 'x');
      const principal = await auth.resolvePrincipal(session.token);

      await expect(
        auth.authorizeTransaction(principal, second, PIN, 'x'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a customer principal cannot authorize an agent transaction', async () => {
      const agentId = await makeAgent();
      const customerPrincipal: AuthorizationPrincipal = {
        type: 'CUSTOMER',
        principalId: randomUUID(),
        customerId: randomUUID(),
        roles: [],
        scopes: [],
        customerAccess: 'SELF',
      };
      await expect(
        auth.authorizeTransaction(customerPrincipal, agentId, PIN, 'x'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('P. an agent principal cannot satisfy customer SELF access', async () => {
      const agentId = await makeAgent();
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'x');
      const principal = await auth.resolvePrincipal(session.token);

      const decision = await authorization.authorize(
        principal,
        {
          resourceType: 'customer',
          action: 'GET:/api/v1/customers/x',
          allowedPrincipalTypes: ['CUSTOMER', 'SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
          customerAccess: 'SELF',
        },
        { type: 'customer', customerId: randomUUID() },
      );
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('PRINCIPAL_TYPE_DENIED');
    });

    it('agent-owned resources are reachable only by their own agent', async () => {
      const agentId = await makeAgent();
      const other = await makeAgent();
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'x');
      const principal = await auth.resolvePrincipal(session.token);
      const policy = {
        resourceType: 'agent-float',
        action: 'READ',
        allowedPrincipalTypes: ['AGENT'] as const,
        agentAccess: 'SELF' as const,
        customerAccess: 'NONE' as const,
      };

      await expect(
        authorization.authorize(principal, policy, { type: 'agent-float', agentId }),
      ).resolves.toMatchObject({ allowed: true });
      await expect(
        authorization.authorize(principal, policy, { type: 'agent-float', agentId: other }),
      ).resolves.toMatchObject({ allowed: false, reason: 'AGENT_SCOPE_MISMATCH' });
    });

    it('Q/R. an agent gains no internal, admin or privileged reach', async () => {
      const agentId = await makeAgent();
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'x');
      const principal = await auth.resolvePrincipal(session.token);
      const registry = new RoutePolicyRegistry();

      for (const url of [
        '/api/v1/ledger/journals',
        '/api/v1/transfers',
        '/api/v1/customers',
        '/api/v1/internal/reconciliation/report',
        '/api/v1/internal/a2/workforce/approvals',
      ]) {
        const route = registry.resolve({ method: 'GET', url });
        if (!route.policy) continue;
        const decision = await authorization.authorize(principal, route.policy, {
          type: route.resourceType,
        });
        expect({ url, allowed: decision.allowed }).toEqual({ url, allowed: false });
      }
    });
  });

  describe('S-X. secrets, audit and wallet resolution', () => {
    it('S/T. no secret, PIN or hash ever reaches the audit trail', async () => {
      const agentId = await makeAgent();
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'ops');
      const principal = await auth.resolvePrincipal(session.token);
      await auth.authorizeTransaction(principal, agentId, PIN, 'ops');
      await expect(
        auth.authorizeTransaction(principal, agentId, '9999', 'ops'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const events = await rows<{ new_values: Record<string, unknown> }>(
        `SELECT new_values FROM audit_events WHERE entity_type LIKE 'AGENT_%'`,
      );
      expect(events.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(LOGIN_SECRET);
      expect(serialized).not.toContain(PIN);
      expect(serialized).not.toContain(session.token);
      expect(serialized.toLowerCase()).not.toContain('secrethash');
      expect(serialized.toLowerCase()).not.toContain('pbkdf2$');
    });

    it('W. the authenticated agent resolves to the canonical wallet binding', async () => {
      const agentId = await makeAgent();
      const account = await financial.provisionFloatAccount({ agentId, actor: 'ops' });
      const session = await auth.authenticate(agentId, LOGIN_SECRET, 'x');
      const principal = await auth.resolvePrincipal(session.token);

      const position = await financial.getSettlementPosition(principal.agentId as string);
      expect(position.walletAccountId).toBe(account.walletAccountId);
      expect(position.ledgerAccountId).toBe(account.ledgerAccountId);
      expect(position.balanceMinor).toBe('0');
    });

    it('X. authentication introduces no balance column anywhere on agent tables', async () => {
      const columns = await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name IN ('agents','agent_wallets','agent_financial_account_bindings',
                               'agent_authentication_credentials','agent_sessions')
            AND column_name LIKE '%balance%'`,
      );
      expect(columns).toEqual([]);
    });

    it('U. no customer row or customer credential is created for an agent', async () => {
      const agentId = await makeAgent();
      await auth.authenticate(agentId, LOGIN_SECRET, 'x');

      for (const table of ['customers', 'customer_authentication_credentials']) {
        const counted = firstRow(
          await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`),
          `${table} count`,
        );
        expect({ table, count: counted.count }).toEqual({ table, count: 0 });
      }
    });
  });
});
