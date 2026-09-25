import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AgentFinancialAccountBinding } from '../src/agent/agent-financial-account-binding.entity';
import { AgentFinancialAccountService } from '../src/agent/agent-financial-account.service';
import { AgentFloatMovementService } from '../src/agent/agent-float-movement.service';
import { AgentFloatMovementKind } from '../src/agent/agent-float-movement.types';
import { AgentWallet } from '../src/agent/agent-wallet.entity';
import type { AgentFloatAccountingConfiguration } from '../src/agent/agent-float-accounting';
import { Agent } from '../src/agent/agent.entity';
import { AgentStatus } from '../src/agent/agent.enums';
import { AgentService } from '../src/agent/agent.service';
import { Deposit } from '../src/deposit/deposit.entity';
import { DepositService } from '../src/deposit/deposit.service';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { PaymentReferenceService } from '../src/payment/payment-reference.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { VerificationStatus } from '../src/reconciliation/reconciliation.types';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletService } from '../src/wallet/wallet.service';
import { Withdrawal } from '../src/withdrawal/withdrawal.entity';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

const SETTLEMENT_ASSET_ID = '00000000-0000-4000-8000-000000000201';

/**
 * F-5 — Agent float funding and defunding against real PostgreSQL.
 *
 * Every posting here is an INTERNAL ledger movement. No external settlement is
 * claimed, no provider is contacted, and the resulting view always reports
 * `externallySettled: false`.
 */
describe('F-5 Agent float funding and defunding (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let agents: AgentService;
  let financial: AgentFinancialAccountService;
  let movements: AgentFloatMovementService;
  let wallets: WalletService;
  let ledger: LedgerService;
  let deposits: DepositService;
  let withdrawals: WithdrawalService;
  let reconciliation: ReconciliationService;

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

  async function count(table: string): Promise<number> {
    return firstRow(
      await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`),
      `${table} count`,
    ).count;
  }

  async function balanceOf(ledgerAccountId: string): Promise<bigint> {
    return BigInt((await ledger.getAccountBalance(ledgerAccountId)).balanceMinor);
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('f5agentfloat');
    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
    wallets = new WalletService(dataSource.getRepository(WalletAccount), dataSource, ledger);
    agents = new AgentService(
      dataSource.getRepository(Agent),
      dataSource,
      new AuditService(dataSource.getRepository(AuditEvent)),
    );
    financial = new AgentFinancialAccountService(
      dataSource.getRepository(Agent),
      dataSource.getRepository(AgentWallet),
      dataSource.getRepository(AgentFinancialAccountBinding),
      dataSource,
      wallets,
      ledger,
      new AuditService(dataSource.getRepository(AuditEvent)),
      FINANCE_CONFIG,
    );
    const settlementAccounts = new SettlementAccountService();
    movements = new AgentFloatMovementService(
      dataSource.getRepository(Agent),
      dataSource.getRepository(AgentFinancialAccountBinding),
      dataSource,
      ledger,
      settlementAccounts,
      new AuditService(dataSource.getRepository(AuditEvent)),
    );
    const references = new PaymentReferenceService();
    deposits = new DepositService(
      dataSource.getRepository(Deposit),
      dataSource,
      ledger,
      references,
      settlementAccounts,
    );
    withdrawals = new WithdrawalService(
      dataSource.getRepository(Withdrawal),
      dataSource,
      ledger,
      references,
      settlementAccounts,
    );
    reconciliation = new ReconciliationService(dataSource);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // Restore what migrations seed (truncation clears them).
    await dataSource.query(`
      INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
      VALUES ($1,'PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)
    `, [SETTLEMENT_ASSET_ID]);
    await dataSource.query(`
      INSERT INTO agent_float_accounting_classifications
        (accounting_unit, account_type, normal_balance, is_active, approved_by, note)
      VALUES ('CUSTOMER_FUNDS','LIABILITY','CREDIT',TRUE,'finance-f3-decision','restored for test')
    `);
  });

  async function makeAgent(status: AgentStatus = AgentStatus.ACTIVE) {
    const created = await agents.create({
      reference: `f5-${randomUUID().slice(0, 8)}`,
      actor: 'f5',
    });
    await dataSource.query(`UPDATE agents SET status = 'ACTIVE' WHERE id = $1`, [created.id]);
    const account = await financial.provisionFloatAccount({ agentId: created.id, actor: 'ops' });
    if (status !== AgentStatus.ACTIVE) {
      await dataSource.query(`UPDATE agents SET status = $2 WHERE id = $1`, [created.id, status]);
    }
    return { agentId: created.id, account };
  }

  const fundCommand = (agentId: string, amountMinor: string) => ({
    agentId,
    amountMinor,
    idempotencyKey: `fund-${randomUUID()}`,
    actor: 'finance-ops',
    reason: 'internal float funding',
  });

  describe('A-G. funding', () => {
    it('A-E. funds an ACTIVE agent with one balanced two-line journal', async () => {
      const { agentId, account } = await makeAgent();
      const result = await movements.fundFloat(fundCommand(agentId, '50000'));

      expect(result.kind).toBe(AgentFloatMovementKind.FUNDING);
      expect(result.externallySettled).toBe(false);

      // B. exactly one journal
      expect(await count('ledger_journals')).toBe(1);
      // C. exactly two balanced lines
      const lines = await rows<{ ledger_account_id: string; direction: string; amount_minor: string }>(
        `SELECT ledger_account_id, direction, amount_minor::text FROM ledger_lines WHERE journal_id = $1`,
        [result.journalId],
      );
      expect(lines).toHaveLength(2);
      const debit = lines.find((l) => l.direction === 'DEBIT');
      const credit = lines.find((l) => l.direction === 'CREDIT');
      expect(debit?.amount_minor).toBe(credit?.amount_minor);
      // D. debits settlement asset
      expect(debit?.ledger_account_id).toBe(SETTLEMENT_ASSET_ID);
      // E. credits agent float
      expect(credit?.ledger_account_id).toBe(account.ledgerAccountId);
    });

    it('F. agent settlement position increases by exactly the funded amount', async () => {
      const { agentId } = await makeAgent();
      expect((await financial.getSettlementPosition(agentId)).balanceMinor).toBe('0');

      await movements.fundFloat(fundCommand(agentId, '25000'));
      expect((await financial.getSettlementPosition(agentId)).balanceMinor).toBe('25000');

      await movements.fundFloat(fundCommand(agentId, '15000'));
      expect((await financial.getSettlementPosition(agentId)).balanceMinor).toBe('40000');
    });

    it('G. owner-aware reporting increases for AGENT only', async () => {
      const { agentId } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '30000'));

      const report = await reconciliation.getFinanceVerification();
      const byOwner = new Map(report.walletOwnerPositions.map((p) => [p.ownerType, p]));
      expect(byOwner.get('AGENT')?.balanceMinor).toBe('30000');
      expect(byOwner.get('CUSTOMER')).toBeUndefined();
    });
  });

  describe('H-J. agent status gating', () => {
    it('H. PENDING agent cannot be funded', async () => {
      const created = await agents.create({ reference: `p-${randomUUID().slice(0, 8)}`, actor: 'f5' });
      await expect(
        movements.fundFloat(fundCommand(created.id, '1000')),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(await count('ledger_journals')).toBe(0);
    });

    it('I/J. SUSPENDED and TERMINATED agents cannot fund or defund', async () => {
      for (const status of [AgentStatus.SUSPENDED, AgentStatus.TERMINATED]) {
        await truncateAllTables(dataSource);
        await dataSource.query(
          `INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
           VALUES ($1,'PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE)`,
          [SETTLEMENT_ASSET_ID],
        );
        await dataSource.query(`
          INSERT INTO agent_float_accounting_classifications
            (accounting_unit, account_type, normal_balance, is_active, approved_by)
          VALUES ('CUSTOMER_FUNDS','LIABILITY','CREDIT',TRUE,'finance-f3-decision')
        `);
        const { agentId } = await makeAgent(status);

        await expect(
          movements.fundFloat(fundCommand(agentId, '1000')),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);
        await expect(
          movements.defundFloat(fundCommand(agentId, '1000')),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);
        expect(await count('ledger_journals')).toBe(0);
      }
    });
  });

  describe('K-Q. defunding', () => {
    it('K-O. defunds with one balanced two-line journal in the correct direction', async () => {
      const { agentId, account } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '40000'));

      const result = await movements.defundFloat(fundCommand(agentId, '15000'));
      expect(result.kind).toBe(AgentFloatMovementKind.DEFUNDING);

      expect(await count('ledger_journals')).toBe(2);
      const lines = await rows<{ ledger_account_id: string; direction: string }>(
        `SELECT ledger_account_id, direction FROM ledger_lines WHERE journal_id = $1`,
        [result.journalId],
      );
      expect(lines).toHaveLength(2);
      // N. debits agent float, O. credits settlement asset
      expect(lines.find((l) => l.direction === 'DEBIT')?.ledger_account_id).toBe(
        account.ledgerAccountId,
      );
      expect(lines.find((l) => l.direction === 'CREDIT')?.ledger_account_id).toBe(
        SETTLEMENT_ASSET_ID,
      );
      expect(await balanceOf(account.ledgerAccountId)).toBe(25000n);
    });

    it('P. defunding cannot exceed the available agent balance', async () => {
      const { agentId, account } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '10000'));

      await expect(
        movements.defundFloat(fundCommand(agentId, '10001')),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(await balanceOf(account.ledgerAccountId)).toBe(10000n);
      expect(await count('ledger_journals')).toBe(1);
    });

    it('Q. concurrent defunding cannot double-spend', async () => {
      const { agentId, account } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '10000'));

      // Two simultaneous defundings of the full balance; exactly one may win.
      const results = await Promise.allSettled([
        movements.defundFloat(fundCommand(agentId, '10000')),
        movements.defundFloat(fundCommand(agentId, '10000')),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(await balanceOf(account.ledgerAccountId)).toBe(0n);
      // funding + exactly one defunding
      expect(await count('ledger_journals')).toBe(2);
    });
  });

  describe('R-T. idempotency', () => {
    it('R. funding replay creates no duplicate journal', async () => {
      const { agentId, account } = await makeAgent();
      const command = fundCommand(agentId, '12000');

      const first = await movements.fundFloat(command);
      const replay = await movements.fundFloat(command);

      expect(replay.journalId).toBe(first.journalId);
      expect(await count('ledger_journals')).toBe(1);
      expect(await count('ledger_lines')).toBe(2);
      expect(await balanceOf(account.ledgerAccountId)).toBe(12000n);
    });

    it('S. defunding replay creates no duplicate journal', async () => {
      const { agentId, account } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '20000'));
      const command = fundCommand(agentId, '5000');

      const first = await movements.defundFloat(command);
      const replay = await movements.defundFloat(command);

      expect(replay.journalId).toBe(first.journalId);
      expect(await count('ledger_journals')).toBe(2);
      expect(await balanceOf(account.ledgerAccountId)).toBe(15000n);
    });

    it('T. the same key cannot be reused for a materially different request', async () => {
      const { agentId } = await makeAgent();
      const other = await makeAgent();
      const key = `shared-${randomUUID()}`;

      await movements.fundFloat({ ...fundCommand(agentId, '1000'), idempotencyKey: key });

      // Different amount, same key.
      await expect(
        movements.fundFloat({ ...fundCommand(agentId, '2000'), idempotencyKey: key }),
      ).rejects.toBeInstanceOf(ConflictException);
      // Different agent, same key.
      await expect(
        movements.fundFloat({ ...fundCommand(other.agentId, '1000'), idempotencyKey: key }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await count('ledger_journals')).toBe(1);
    });
  });

  describe('U-Z. safety, isolation and boundaries', () => {
    it('U. rejected operations create zero journals and zero lines', async () => {
      const { agentId } = await makeAgent();
      for (const bad of ['0', '-100']) {
        await expect(
          movements.fundFloat(fundCommand(agentId, bad)),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(
        movements.fundFloat({ ...fundCommand(agentId, '100'), actor: '  ' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(await count('ledger_journals')).toBe(0);
      expect(await count('ledger_lines')).toBe(0);
    });

    it('V. customer balances are unchanged by agent funding and defunding', async () => {
      const customerWallet = await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });
      const deposit = await deposits.createDeposit({
        walletId: customerWallet.id,
        amountMinor: '9000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await deposits.completeDeposit(deposit.id);
      const customerLedgerAccount = firstRow(
        await rows<{ ledger_account_id: string }>(
          `SELECT ledger_account_id FROM wallet_accounts WHERE id = $1`,
          [customerWallet.id],
        ),
        'customer wallet',
      ).ledger_account_id;
      const before = await balanceOf(customerLedgerAccount);

      const { agentId } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '7000'));
      await movements.defundFloat(fundCommand(agentId, '3000'));

      expect(await balanceOf(customerLedgerAccount)).toBe(before);
      expect(before).toBe(9000n);
    });

    it('W/X. agent balance stays queryable and reconciliation stays balanced', async () => {
      const { agentId } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '18000'));
      await movements.defundFloat(fundCommand(agentId, '6000'));

      expect((await financial.getSettlementPosition(agentId)).balanceMinor).toBe('12000');

      const report = await reconciliation.runReconciliation();
      expect(report.status).toBe(VerificationStatus.PASS);
      const finance = await reconciliation.getFinanceVerification();
      for (const dimension of finance.balanceConservation) {
        expect(dimension.balanced).toBe(true);
      }
    });

    it('Y. no agent table has a balance column', async () => {
      const columns = await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name IN ('agents','agent_wallets','agent_financial_account_bindings')
            AND column_name LIKE '%balance%'`,
      );
      expect(columns).toEqual([]);
    });

    it('Z/AA. no external settlement is claimed and no customer payment path is used', async () => {
      const { agentId } = await makeAgent();
      const result = await movements.fundFloat(fundCommand(agentId, '5000'));

      expect(result.externallySettled).toBe(false);
      const journal = firstRow(
        await rows<{ metadata: Record<string, unknown> }>(
          `SELECT metadata FROM ledger_journals WHERE id = $1`,
          [result.journalId],
        ),
        'journal',
      );
      expect(journal.metadata.externallySettled).toBe(false);
      expect(journal.metadata.agentFloatMovement).toBe('FUNDING');

      // AA. no deposit/withdrawal record was created for the agent movement.
      expect(await count('deposits')).toBe(0);
      expect(await count('withdrawals')).toBe(0);
      // No external operation or settlement record either.
      expect(await count('external_operations')).toBe(0);
    });

    it('AB. funding and defunding are auditable', async () => {
      const { agentId } = await makeAgent();
      const funded = await movements.fundFloat({
        ...fundCommand(agentId, '4000'),
        correlationId: 'corr-f5',
      });
      await movements.defundFloat(fundCommand(agentId, '1000'));

      const events = await rows<{
        action: string;
        actor: string;
        entity_id: string;
        new_values: Record<string, unknown>;
      }>(
        `SELECT action, actor, entity_id, new_values FROM audit_events
          WHERE entity_type = 'AGENT_FLOAT_MOVEMENT' ORDER BY action ASC`,
      );
      expect(events.map((e) => e.action)).toEqual(['DEFUNDING', 'FUNDING']);
      const fundingEvent = events.find((e) => e.action === 'FUNDING');
      expect(fundingEvent?.entity_id).toBe(funded.journalId);
      expect(fundingEvent?.actor).toBe('finance-ops');
      expect(fundingEvent?.new_values.amountMinor).toBe('4000');
      expect(fundingEvent?.new_values.externallySettled).toBe(false);
    });
  });

  describe('AC. customer regression + reversal', () => {
    it('AC. customer deposit to withdrawal lifecycle remains green alongside agent float', async () => {
      const customerWallet = await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });
      const deposit = await deposits.createDeposit({
        walletId: customerWallet.id,
        amountMinor: '10000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await deposits.completeDeposit(deposit.id);

      const { agentId } = await makeAgent();
      await movements.fundFloat(fundCommand(agentId, '5000'));

      const withdrawal = await withdrawals.createWithdrawal({
        walletId: customerWallet.id,
        amountMinor: '4000',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
      });
      await withdrawals.processWithdrawal(withdrawal.id);
      await withdrawals.completeWithdrawal(withdrawal.id);

      const customerLedgerAccount = firstRow(
        await rows<{ ledger_account_id: string }>(
          `SELECT ledger_account_id FROM wallet_accounts WHERE id = $1`,
          [customerWallet.id],
        ),
        'customer wallet',
      ).ledger_account_id;
      expect(await balanceOf(customerLedgerAccount)).toBe(6000n);
      expect((await financial.getSettlementPosition(agentId)).balanceMinor).toBe('5000');
    });

    it('a funding journal is reversible with the existing reverseJournal', async () => {
      const { agentId, account } = await makeAgent();
      const funded = await movements.fundFloat(fundCommand(agentId, '8000'));
      expect(await balanceOf(account.ledgerAccountId)).toBe(8000n);

      const reversal = await ledger.reverseJournal(
        funded.journalId,
        `reverse-${randomUUID()}`,
        'operational correction',
      );

      expect(reversal.reversalOfJournalId).toBe(funded.journalId);
      expect(await balanceOf(account.ledgerAccountId)).toBe(0n);
      expect((await financial.getSettlementPosition(agentId)).balanceMinor).toBe('0');
    });
  });
});
