import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { AgentFinancialAccountService } from '../src/agent/agent-financial-account.service';
import type { AgentFinancialAccountBinding } from '../src/agent/agent-financial-account-binding.entity';
import {
  agentFloatAccountingConfiguration,
  type AgentFloatAccountingConfiguration,
} from '../src/agent/agent-float-accounting';
import { Agent } from '../src/agent/agent.entity';
import { AgentStatus } from '../src/agent/agent.enums';
import { WalletOwnerType } from '../src/wallet/wallet.enums';
import type { CreateWalletCommand } from '../src/wallet/wallet.types';

/** F-1/F-2 unit coverage: Agent financial identity and dedicated e-float wallet. */
describe('F-1/F-2 Agent financial account (unit)', () => {
  const AGENT_ID = '11111111-2222-4333-8444-555555555555';

  const financeConfig: AgentFloatAccountingConfiguration = {
    enabled: true,
    accountingUnit: 'AGENT_FLOAT_TEST_UNIT',
    accountType: 'LIABILITY',
    normalBalance: 'CREDIT',
    accountCodePrefix: 'AGENTFLOAT',
  };

  function build(
    options: {
      agent?: Agent | null;
      existingBinding?: AgentFinancialAccountBinding | null;
      accounting?: AgentFloatAccountingConfiguration;
    } = {},
  ) {
    const agent =
      options.agent === undefined
        ? Object.assign(new Agent(), {
            id: AGENT_ID,
            reference: 'agent-001',
            status: AgentStatus.ACTIVE,
          })
        : options.agent;

    const walletCommands: CreateWalletCommand[] = [];
    const auditCommands: unknown[] = [];
    const repo = {
      create: (input: unknown) => input,
      save: (entity: unknown) => Promise.resolve(entity),
    };

    const service = new AgentFinancialAccountService(
      { findOne: () => Promise.resolve(agent) } as never,
      {} as never,
      { findOne: () => Promise.resolve(options.existingBinding ?? null) } as never,
      {
        transaction: (work: (m: unknown) => Promise<unknown>) =>
          work({ getRepository: () => repo }),
      } as never,
      {
        createWalletInTransaction: (_m: unknown, command: CreateWalletCommand) => {
          walletCommands.push(command);
          return Promise.resolve({ id: 'wallet-account-1', ledgerAccountId: 'ledger-account-1' });
        },
      } as never,
      {
        record: (_m: unknown, c: unknown) => {
          auditCommands.push(c);
          return Promise.resolve();
        },
      } as never,
      options.accounting ?? financeConfig,
    );
    return { service, walletCommands, auditCommands };
  }

  const command = { agentId: AGENT_ID, actor: 'finance-ops' };

  describe('Finance-owned classification', () => {
    it('fails closed when Finance has not configured the classification', async () => {
      const { service, walletCommands } = build({ accounting: { enabled: false } });
      await expect(service.provisionFloatAccount(command)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(walletCommands).toHaveLength(0);
    });

    it('never defaults to CUSTOMER_FUNDS or invents a classification', async () => {
      const { service, walletCommands } = build();
      await service.provisionFloatAccount(command);
      const spec = walletCommands[0]?.ledgerAccountSpec;

      expect(spec?.accountingUnit).toBe('AGENT_FLOAT_TEST_UNIT');
      expect(spec?.accountingUnit).not.toBe('CUSTOMER_FUNDS');
      expect(spec?.accountType).toBe('LIABILITY');
      expect(spec?.normalBalance).toBe('CREDIT');
    });

    it('treats absent or malformed configuration as disabled', () => {
      expect(agentFloatAccountingConfiguration({}).enabled).toBe(false);
      expect(
        agentFloatAccountingConfiguration({ AGENT_FLOAT_ACCOUNTING_ENABLED: 'true' }).enabled,
      ).toBe(false);
      expect(
        agentFloatAccountingConfiguration({
          AGENT_FLOAT_ACCOUNTING_ENABLED: 'true',
          AGENT_FLOAT_ACCOUNTING_UNIT: 'lowercase-bad',
          AGENT_FLOAT_ACCOUNT_TYPE: 'LIABILITY',
          AGENT_FLOAT_NORMAL_BALANCE: 'CREDIT',
          AGENT_FLOAT_ACCOUNT_CODE_PREFIX: 'AGENTFLOAT',
        }).enabled,
      ).toBe(false);
    });

    it('accepts a complete Finance configuration', () => {
      expect(
        agentFloatAccountingConfiguration({
          AGENT_FLOAT_ACCOUNTING_ENABLED: 'true',
          AGENT_FLOAT_ACCOUNTING_UNIT: 'AGENT_FLOAT_X',
          AGENT_FLOAT_ACCOUNT_TYPE: 'LIABILITY',
          AGENT_FLOAT_NORMAL_BALANCE: 'CREDIT',
          AGENT_FLOAT_ACCOUNT_CODE_PREFIX: 'AGENTFLOAT',
        }),
      ).toEqual({
        enabled: true,
        accountingUnit: 'AGENT_FLOAT_X',
        accountType: 'LIABILITY',
        normalBalance: 'CREDIT',
        accountCodePrefix: 'AGENTFLOAT',
      });
    });
  });

  describe('ownership', () => {
    it('creates an AGENT-owned wallet account for the agent id', async () => {
      const { service, walletCommands } = build();
      await service.provisionFloatAccount(command);
      expect(walletCommands[0]?.ownerType).toBe(WalletOwnerType.AGENT);
      expect(walletCommands[0]?.customerId).toBe(AGENT_ID);
      expect(walletCommands[0]?.currency).toBe('NGN');
    });

    it('pins non-negative balance and Agent-float naming', async () => {
      const { service, walletCommands } = build();
      await service.provisionFloatAccount(command);
      expect(walletCommands[0]?.ledgerAccountSpec?.allowNegativeBalance).toBe(false);
      expect(walletCommands[0]?.ledgerAccountSpec?.name).toContain('Agent float');
      expect(walletCommands[0]?.ledgerAccountSpec?.name).not.toContain('Customer wallet');
    });
  });

  describe('lifecycle', () => {
    it('refuses PENDING, SUSPENDED and TERMINATED agents', async () => {
      for (const status of [AgentStatus.PENDING, AgentStatus.SUSPENDED, AgentStatus.TERMINATED]) {
        const agent = Object.assign(new Agent(), { id: AGENT_ID, reference: 'a', status });
        const { service, walletCommands } = build({ agent });
        await expect(service.provisionFloatAccount(command)).rejects.toBeInstanceOf(
          UnprocessableEntityException,
        );
        expect(walletCommands).toHaveLength(0);
      }
    });

    it('reports a missing agent as not found', async () => {
      const { service } = build({ agent: null });
      await expect(service.provisionFloatAccount(command)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('performs no lifecycle transition of its own', () => {
      const surface = Object.getOwnPropertyNames(AgentFinancialAccountService.prototype);
      for (const forbidden of ['activate', 'approve', 'updateStatus', 'suspend', 'terminate']) {
        expect(surface).not.toContain(forbidden);
      }
    });
  });

  describe('idempotency and identity', () => {
    const existing = {
      id: 'binding-1',
      agentId: AGENT_ID,
      agentWalletId: 'agent-wallet-1',
      walletAccountId: 'wallet-account-1',
      ledgerAccountId: 'ledger-account-1',
      currency: 'NGN',
      accountingUnit: 'AGENT_FLOAT_TEST_UNIT',
      state: 'ACTIVE',
    } as AgentFinancialAccountBinding;

    it('returns the existing account rather than creating a second', async () => {
      const { service, walletCommands } = build({ existingBinding: existing });
      const view = await service.provisionFloatAccount(command);
      expect(view.bindingId).toBe('binding-1');
      expect(walletCommands).toHaveLength(0);
    });

    it('resolves identity from the persisted binding and carries no balance', async () => {
      const { service } = build({ existingBinding: existing });
      const view = await service.getFloatAccount(AGENT_ID);
      expect(view.walletAccountId).toBe('wallet-account-1');
      expect(view.ledgerAccountId).toBe('ledger-account-1');
      expect(view).not.toHaveProperty('balance');
      expect(view).not.toHaveProperty('balanceMinor');
    });

    it('validates identifiers and actor', async () => {
      const { service } = build();
      await expect(service.getFloatAccount('nope')).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.provisionFloatAccount({ agentId: AGENT_ID, actor: '  ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('money safety', () => {
    it('writes only an audit record and no posting instruction', async () => {
      const { service, auditCommands } = build();
      await service.provisionFloatAccount(command);
      expect(auditCommands).toHaveLength(1);
      expect(JSON.stringify(auditCommands[0])).not.toMatch(/amountMinor|journal|posting/i);
    });

    it('exposes no funding, balance-mutating, cash or transfer operation', () => {
      const surface = Object.getOwnPropertyNames(AgentFinancialAccountService.prototype);
      for (const forbidden of [
        'fund','credit','debit','topUp','postJournal','transfer','cashIn','cashOut',
        'claim','redeem','expire','commission','fee',
      ]) {
        expect(surface).not.toContain(forbidden);
      }
    });
  });
});
