import { randomUUID } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AgentFinancialAccountBinding } from '../src/agent/agent-financial-account-binding.entity';
import { AgentFinancialAccountService } from '../src/agent/agent-financial-account.service';
import { AgentWallet } from '../src/agent/agent-wallet.entity';
import type { AgentFloatAccountingConfiguration } from '../src/agent/agent-float-accounting';
import { Agent } from '../src/agent/agent.entity';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentService } from '../src/agent/agent.service';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletOwnerType } from '../src/wallet/wallet.enums';
import { WalletService } from '../src/wallet/wallet.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * F-1 / F-2 — Agent financial identity and dedicated e-float wallet against
 * real PostgreSQL.
 *
 * Agents are created through the genuine Stage 1 `AgentService.create` path.
 * Stage 1 deliberately implements no lifecycle transition (activation is
 * B5-owned), so ACTIVE is set on the persisted row; the provisioning path
 * under test is the real one.
 *
 * `AGENT_FLOAT_TEST_UNIT` is registered as a TEST-ONLY Finance classification.
 * It is not a production value: production stays fail-closed until Finance
 * registers an approved classification.
 */
describe('F-1/F-2 Agent financial account (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let agents: AgentService;
  let financial: AgentFinancialAccountService;
  let ledger: LedgerService;

  const AGENT_UNIT = 'AGENT_FLOAT_TEST_UNIT';
  const FINANCE_CONFIG: AgentFloatAccountingConfiguration = {
    enabled: true,
    accountingUnit: AGENT_UNIT,
    accountType: 'LIABILITY',
    normalBalance: 'CREDIT',
    accountCodePrefix: 'AGENTFLOAT',
  };

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  async function count(table: string): Promise<number> {
    return firstRow(
      await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`),
      `${table} count`,
    ).count;
  }

  function buildService(accounting: AgentFloatAccountingConfiguration) {
    return new AgentFinancialAccountService(
      dataSource.getRepository(Agent),
      dataSource.getRepository(AgentWallet),
      dataSource.getRepository(AgentFinancialAccountBinding),
      dataSource,
      new WalletService(dataSource.getRepository(WalletAccount), dataSource, ledger),
      new AuditService(dataSource.getRepository(AuditEvent)),
      accounting,
    );
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('agentfinancial');
    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
    agents = new AgentService(
      dataSource.getRepository(Agent),
      dataSource,
      new AuditService(dataSource.getRepository(AuditEvent)),
    );
    financial = buildService(FINANCE_CONFIG);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // Finance registers the approved (test) classification.
    await dataSource.query(
      `INSERT INTO agent_float_accounting_classifications
         (accounting_unit, account_type, normal_balance, approved_by, note)
       VALUES ($1, 'LIABILITY', 'CREDIT', 'finance-test', 'test-only classification')`,
      [AGENT_UNIT],
    );
  });

  async function activeAgent(label = 'agent'): Promise<Agent> {
    const created = await agents.create({
      reference: `${label}-${randomUUID().slice(0, 8)}`,
      actor: 'f1f2-integration',
    });
    await dataSource.query(`UPDATE agents SET status = $2 WHERE id = $1`, [
      created.id,
      AgentStatus.ACTIVE,
    ]);
    return { ...created, status: AgentStatus.ACTIVE };
  }

  describe('dedicated account chain', () => {
    it('provisions Agent -> AgentWallet -> WalletAccount -> LedgerAccount', async () => {
      const agent = await activeAgent();
      const view = await financial.provisionFloatAccount({
        agentId: agent.id,
        actor: 'finance-ops',
      });

      expect(view.currency).toBe('NGN');
      expect(view.accountingUnit).toBe(AGENT_UNIT);

      const walletAccount = firstRow(
        await rows<{ owner_type: string; customer_id: string; currency: string }>(
          `SELECT owner_type, customer_id, currency FROM wallet_accounts WHERE id = $1`,
          [view.walletAccountId],
        ),
        'wallet account',
      );
      expect(walletAccount.owner_type).toBe(WalletOwnerType.AGENT);
      expect(walletAccount.customer_id).toBe(agent.id);

      const ledgerAccount = firstRow(
        await rows<{
          accounting_unit: string;
          account_type: string;
          normal_balance: string;
          allow_negative_balance: boolean;
          name: string;
        }>(`SELECT * FROM ledger_accounts WHERE id = $1`, [view.ledgerAccountId]),
        'ledger account',
      );
      expect(ledgerAccount.accounting_unit).toBe(AGENT_UNIT);
      expect(ledgerAccount.accounting_unit).not.toBe('CUSTOMER_FUNDS');
      expect(ledgerAccount.account_type).toBe('LIABILITY');
      expect(ledgerAccount.normal_balance).toBe('CREDIT');
      expect(ledgerAccount.allow_negative_balance).toBe(false);
      expect(ledgerAccount.name).toContain('Agent float');

      expect(await count('agent_wallets')).toBe(1);
      expect(await count('agent_financial_account_bindings')).toBe(1);
      expect(await financial.getFloatAccount(agent.id)).toEqual(view);
    });

    it('does not turn the Agent into a Customer', async () => {
      const agent = await activeAgent();
      await financial.provisionFloatAccount({ agentId: agent.id, actor: 'finance-ops' });

      expect(await count('customers')).toBe(0);
      expect(await count('customer_wallets')).toBe(0);
      expect(await count('customer_financial_account_bindings')).toBe(0);
      expect(await count(`wallet_accounts WHERE owner_type = 'CUSTOMER'`)).toBe(0);
    });
  });

  describe('customer coexistence and regression', () => {
    it('keeps Agent and Customer accounts independent and correctly classified', async () => {
      const agent = await activeAgent();
      const agentView = await financial.provisionFloatAccount({
        agentId: agent.id,
        actor: 'finance-ops',
      });

      const wallets = new WalletService(
        dataSource.getRepository(WalletAccount),
        dataSource,
        ledger,
      );
      const customerWallet = await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });

      expect(customerWallet.id).not.toBe(agentView.walletAccountId);
      expect(
        await rows<{ owner_type: string; count: number }>(
          `SELECT owner_type, COUNT(*)::int AS count FROM wallet_accounts GROUP BY owner_type ORDER BY owner_type`,
        ),
      ).toEqual([
        { owner_type: 'AGENT', count: 1 },
        { owner_type: 'CUSTOMER', count: 1 },
      ]);

      const customerLedger = firstRow(
        await rows<{ accounting_unit: string; name: string }>(
          `SELECT la.accounting_unit, la.name FROM ledger_accounts la
             JOIN wallet_accounts wa ON wa.ledger_account_id = la.id WHERE wa.id = $1`,
          [customerWallet.id],
        ),
        'customer ledger account',
      );
      expect(customerLedger.accounting_unit).toBe('CUSTOMER_FUNDS');
      expect(customerLedger.name).toContain('Customer wallet');
    });
  });

  describe('idempotency', () => {
    it('repeated provisioning creates no duplicates', async () => {
      const agent = await activeAgent();
      const first = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      const second = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      const third = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });

      expect(second).toEqual(first);
      expect(third).toEqual(first);
      expect(await count('agent_wallets')).toBe(1);
      expect(await count('agent_financial_account_bindings')).toBe(1);
      expect(await count('wallet_accounts')).toBe(1);
      expect(await count('ledger_accounts')).toBe(1);
    });

    it('the database refuses a second open binding for one agent', async () => {
      const agent = await activeAgent();
      const view = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      await expect(
        dataSource.query(
          `INSERT INTO agent_financial_account_bindings
             (agent_id, agent_wallet_id, wallet_account_id, ledger_account_id, currency,
              accounting_unit, state, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'NGN', $5, 'ACTIVE', 'x', 'x')`,
          [agent.id, view.agentWalletId, view.walletAccountId, view.ledgerAccountId, AGENT_UNIT],
        ),
      ).rejects.toThrow(/uq_agent_bindings/);
    });

    it('rejects a non-NGN agent wallet', async () => {
      const agent = await activeAgent();
      await expect(
        dataSource.query(`INSERT INTO agent_wallets (agent_id, currency) VALUES ($1, 'USD')`, [
          agent.id,
        ]),
      ).rejects.toThrow(/chk_agent_wallets_currency/);
    });
  });

  describe('lifecycle and fail-closed accounting', () => {
    it('refuses a PENDING agent and writes nothing', async () => {
      const created = await agents.create({
        reference: `pending-${randomUUID().slice(0, 8)}`,
        actor: 'f1f2',
      });
      expect(created.status).toBe(AgentStatus.PENDING);

      await expect(
        financial.provisionFloatAccount({ agentId: created.id, actor: 'ops' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(await count('agent_wallets')).toBe(0);
      expect(await count('wallet_accounts')).toBe(0);
    });

    it('refuses when Finance configuration is absent', async () => {
      const agent = await activeAgent();
      await expect(
        buildService({ enabled: false }).provisionFloatAccount({
          agentId: agent.id,
          actor: 'ops',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(await count('wallet_accounts')).toBe(0);
    });

    it('the database refuses even if the application is misconfigured', async () => {
      const agent = await activeAgent();
      const rogue = buildService({
        enabled: true,
        accountingUnit: 'ROGUE_UNIT_NOT_APPROVED',
        accountType: 'LIABILITY',
        normalBalance: 'CREDIT',
        accountCodePrefix: 'ROGUE',
      });
      await expect(
        rogue.provisionFloatAccount({ agentId: agent.id, actor: 'ops' }),
      ).rejects.toThrow(/approved active agent-float classification/);
      expect(await count('wallet_accounts')).toBe(0);
    });
  });

  describe('conservation and non-negative float', () => {
    it('creates no journal, no line and no money', async () => {
      const agent = await activeAgent();
      const view = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });

      expect(await count('ledger_journals')).toBe(0);
      expect(await count('ledger_lines')).toBe(0);
      expect(BigInt((await ledger.getAccountBalance(view.ledgerAccountId)).balanceMinor)).toBe(0n);

      const total = firstRow(
        await rows<{ total: string }>(
          `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS total
             FROM ledger_lines`,
        ),
        'system total',
      );
      expect(BigInt(total.total)).toBe(0n);
    });

    it('the ledger refuses a posting that would overdraw Agent e-float', async () => {
      const agent = await activeAgent();
      const view = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });

      const counterparty = await ledger.createAccount({
        code: `CP-${randomUUID().slice(0, 8)}`,
        name: 'Counterparty',
        accountType: 'ASSET' as never,
        normalBalance: 'DEBIT' as never,
        currency: 'NGN',
        accountingUnit: AGENT_UNIT,
        allowNegativeBalance: true,
      });

      await expect(
        ledger.postJournal({
          idempotencyKey: `overdraw-${randomUUID()}`,
          currency: 'NGN',
          accountingUnit: AGENT_UNIT,
          lines: [
            { accountId: view.ledgerAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
            { accountId: counterparty.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
          ],
        }),
      ).rejects.toThrow();

      expect(BigInt((await ledger.getAccountBalance(view.ledgerAccountId)).balanceMinor)).toBe(0n);
      expect(await count('ledger_journals')).toBe(0);
    });

    it('records an auditable provisioning event without moving value', async () => {
      const agent = await activeAgent();
      await financial.provisionFloatAccount({
        agentId: agent.id,
        actor: 'finance-ops',
        correlationId: 'corr-f1f2',
      });

      const event = firstRow(
        await rows<{ action: string; actor: string; new_values: Record<string, unknown> }>(
          `SELECT action, actor, new_values FROM audit_events
            WHERE entity_type = 'AGENT_FINANCIAL_ACCOUNT_BINDING'`,
        ),
        'binding audit',
      );
      expect(event.action).toBe('CREATED');
      expect(event.new_values.accountingUnit).toBe(AGENT_UNIT);
      expect(await count('ledger_journals')).toBe(0);
    });
  });
});
