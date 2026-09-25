import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AgentFinancialAccountBinding } from '../src/agent/agent-financial-account-binding.entity';
import { AgentFinancialAccountService } from '../src/agent/agent-financial-account.service';
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
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletOwnerType } from '../src/wallet/wallet.enums';
import { WalletService } from '../src/wallet/wallet.service';
import { Withdrawal } from '../src/withdrawal/withdrawal.entity';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * F-4C — Customer/Agent financial boundary, owner-aware reporting and the
 * Agent settlement-position read.
 *
 * Proves the customer payment paths cannot reach an Agent-owned wallet, that
 * wallet liability is reportable per owner type without changing the pool, and
 * that an Agent's e-float position is readable from the existing ledger.
 */
describe('F-4C Agent financial boundary (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let agents: AgentService;
  let financial: AgentFinancialAccountService;
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

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('f4cboundary');
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
    const paymentReferences = new PaymentReferenceService();
    const settlementAccounts = new SettlementAccountService();
    deposits = new DepositService(
      dataSource.getRepository(Deposit),
      dataSource,
      ledger,
      paymentReferences,
      settlementAccounts,
    );
    withdrawals = new WithdrawalService(
      dataSource.getRepository(Withdrawal),
      dataSource,
      ledger,
      paymentReferences,
      settlementAccounts,
    );
    reconciliation = new ReconciliationService(dataSource);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    // Re-seed the payment settlement accounts and Finance classification that
    // migrations install, since truncation clears them.
    await dataSource.query(`
      INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
      VALUES
        ('00000000-0000-4000-8000-000000000201','PAYMENT-SETTLEMENT_ASSET-NGN','Payment settlement asset NGN','ASSET','DEBIT','NGN','CUSTOMER_FUNDS',FALSE,TRUE),
        ('00000000-0000-4000-8000-000000000203','PAYMENT-SYSTEM_SUSPENSE-NGN','Payment system suspense NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
    `);
    await dataSource.query(`
      INSERT INTO agent_float_accounting_classifications
        (accounting_unit, account_type, normal_balance, is_active, approved_by, note)
      VALUES ('CUSTOMER_FUNDS','LIABILITY','CREDIT',TRUE,'finance-f3-decision','restored for test')
    `);
  });

  async function customerWallet(): Promise<string> {
    const wallet = await wallets.createWallet({
      customerId: randomUUID(),
      currency: 'NGN',
      idempotencyKey: `cust-${randomUUID()}`,
    });
    return wallet.id;
  }

  async function agentWallet(label = 'agent'): Promise<string> {
    const created = await agents.create({
      reference: `${label}-${randomUUID().slice(0, 8)}`,
      actor: 'f4c',
    });
    await dataSource.query(`UPDATE agents SET status = $2 WHERE id = $1`, [
      created.id,
      AgentStatus.ACTIVE,
    ]);
    const view = await financial.provisionFloatAccount({ agentId: created.id, actor: 'ops' });
    return view.walletAccountId;
  }

  describe('A/B. customer deposit boundary', () => {
    it('A. accepts a CUSTOMER-owned wallet', async () => {
      const walletId = await customerWallet();
      const deposit = await deposits.createDeposit({
        walletId,
        amountMinor: '5000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      expect(deposit.id).toBeTruthy();
    });

    it('B. rejects an AGENT-owned wallet', async () => {
      const walletId = await agentWallet('deposit-reject');
      await expect(
        deposits.createDeposit({
          walletId,
          amountMinor: '5000',
          currency: 'NGN',
          idempotencyKey: `dep-${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await count('deposits')).toBe(0);
      expect(await count('ledger_journals')).toBe(0);
    });
  });

  describe('C/D. customer withdrawal boundary', () => {
    it('C. accepts a CUSTOMER-owned wallet', async () => {
      const walletId = await customerWallet();
      // Fund it through the customer deposit path first.
      const deposit = await deposits.createDeposit({
        walletId,
        amountMinor: '10000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await deposits.completeDeposit(deposit.id);

      const withdrawal = await withdrawals.createWithdrawal({
        walletId,
        amountMinor: '2500',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
      });
      expect(withdrawal.id).toBeTruthy();
    });

    it('D. rejects an AGENT-owned wallet', async () => {
      const walletId = await agentWallet('withdrawal-reject');
      await expect(
        withdrawals.createWithdrawal({
          walletId,
          amountMinor: '1000',
          currency: 'NGN',
          idempotencyKey: `wd-${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await count('withdrawals')).toBe(0);
    });
  });

  describe('E/F. agent wallet independence', () => {
    it('E. remains independently provisioned and AGENT-owned', async () => {
      const walletAccountId = await agentWallet('independent');
      const row = firstRow(
        await rows<{ owner_type: string }>(
          `SELECT owner_type FROM wallet_accounts WHERE id = $1`,
          [walletAccountId],
        ),
        'agent wallet',
      );
      expect(row.owner_type).toBe(WalletOwnerType.AGENT);
      expect(await count('customers')).toBe(0);
    });

    it('F. agent balance stays zero until a journal actually posts', async () => {
      const created = await agents.create({ reference: `zero-${randomUUID().slice(0, 8)}`, actor: 'f4c' });
      await dataSource.query(`UPDATE agents SET status = 'ACTIVE' WHERE id = $1`, [created.id]);
      await financial.provisionFloatAccount({ agentId: created.id, actor: 'ops' });

      const position = await financial.getSettlementPosition(created.id);
      expect(BigInt(position.balanceMinor)).toBe(0n);
      expect(await count('ledger_journals')).toBe(0);
    });
  });

  describe('settlement position read', () => {
    it('reports the e-float position from the existing ledger authority', async () => {
      const created = await agents.create({ reference: `pos-${randomUUID().slice(0, 8)}`, actor: 'f4c' });
      await dataSource.query(`UPDATE agents SET status = 'ACTIVE' WHERE id = $1`, [created.id]);
      const account = await financial.provisionFloatAccount({ agentId: created.id, actor: 'ops' });

      const position = await financial.getSettlementPosition(created.id);
      expect(position).toMatchObject({
        agentId: created.id,
        walletAccountId: account.walletAccountId,
        ledgerAccountId: account.ledgerAccountId,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        bindingState: 'ACTIVE',
        balanceMinor: '0',
        agentStatus: AgentStatus.ACTIVE,
      });
      // Read-only: no balance column exists anywhere.
      const columns = await rows<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name IN ('agent_wallets','agent_financial_account_bindings')
            AND column_name LIKE '%balance%'`,
      );
      expect(columns).toEqual([]);
    });
  });

  describe('G/H. owner-aware reporting', () => {
    it('G. reports customer liability and agent e-float independently', async () => {
      const walletId = await customerWallet();
      const deposit = await deposits.createDeposit({
        walletId,
        amountMinor: '7000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await deposits.completeDeposit(deposit.id);
      await agentWallet('reporting');

      const report = await reconciliation.getFinanceVerification();
      const byOwner = new Map(report.walletOwnerPositions.map((p) => [p.ownerType, p]));

      expect(byOwner.get('CUSTOMER')?.balanceMinor).toBe('7000');
      expect(byOwner.get('AGENT')?.balanceMinor).toBe('0');
      // Same pool for both: ownership is separated, the pool is not.
      expect(byOwner.get('CUSTOMER')?.accountingUnit).toBe('CUSTOMER_FUNDS');
      expect(byOwner.get('AGENT')?.accountingUnit).toBe('CUSTOMER_FUNDS');
      expect(byOwner.get('AGENT')?.walletCount).toBe(1);
    });

    it('H. owner aggregation equals the underlying ledger wallet total', async () => {
      const first = await customerWallet();
      const second = await customerWallet();
      for (const [walletId, amount] of [
        [first, '4000'],
        [second, '1500'],
      ] as const) {
        const deposit = await deposits.createDeposit({
          walletId,
          amountMinor: amount,
          currency: 'NGN',
          idempotencyKey: `dep-${randomUUID()}`,
        });
        await deposits.completeDeposit(deposit.id);
      }
      await agentWallet('agg');

      const report = await reconciliation.getFinanceVerification();
      const combined = report.walletOwnerPositions.reduce(
        (sum, p) => sum + BigInt(p.balanceMinor),
        0n,
      );

      const ledgerTotal = firstRow(
        await rows<{ total: string }>(
          `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END), 0)::text AS total
             FROM wallet_accounts w
             JOIN ledger_accounts a ON a.id = w.ledger_account_id
             LEFT JOIN ledger_lines l ON l.ledger_account_id = a.id`,
        ),
        'ledger wallet total',
      );
      expect(combined).toBe(BigInt(ledgerTotal.total));
      expect(combined).toBe(5500n);

      // Conservation still proven per pool, unchanged.
      for (const dimension of report.balanceConservation) {
        expect(dimension.balanced).toBe(true);
      }
    });
  });

  describe('I/J/K/L. safety and regression', () => {
    it('I. rejected agent operations create no money', async () => {
      const agentWalletId = await agentWallet('nomoney');
      await expect(
        deposits.createDeposit({
          walletId: agentWalletId,
          amountMinor: '9999',
          currency: 'NGN',
          idempotencyKey: `dep-${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await count('ledger_journals')).toBe(0);
      expect(await count('ledger_lines')).toBe(0);
      const total = firstRow(
        await rows<{ total: string }>(
          `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS total FROM ledger_lines`,
        ),
        'system total',
      );
      expect(BigInt(total.total)).toBe(0n);
    });

    it('J. customer deposit/withdrawal lifecycle is unchanged end to end', async () => {
      const walletId = await customerWallet();
      const deposit = await deposits.createDeposit({
        walletId,
        amountMinor: '8000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await deposits.completeDeposit(deposit.id);

      const wallet = firstRow(
        await rows<{ ledger_account_id: string }>(
          `SELECT ledger_account_id FROM wallet_accounts WHERE id = $1`,
          [walletId],
        ),
        'wallet',
      );
      expect(
        BigInt((await ledger.getAccountBalance(wallet.ledger_account_id)).balanceMinor),
      ).toBe(8000n);

      const withdrawal = await withdrawals.createWithdrawal({
        walletId,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
      });
      await withdrawals.processWithdrawal(withdrawal.id);
      await withdrawals.completeWithdrawal(withdrawal.id);

      expect(
        BigInt((await ledger.getAccountBalance(wallet.ledger_account_id)).balanceMinor),
      ).toBe(5000n);
    });

    it('L. no agent funding or defunding operation exists', () => {
      const surface = Object.getOwnPropertyNames(AgentFinancialAccountService.prototype);
      for (const forbidden of [
        'fund','defund','settle','credit','debit','topUp','postJournal','transfer',
        'cashIn','cashOut','withdraw','deposit',
      ]) {
        expect(surface).not.toContain(forbidden);
      }
      // Only provisioning and read operations are exposed.
      expect(surface).toContain('provisionFloatAccount');
      expect(surface).toContain('getFloatAccount');
      expect(surface).toContain('getSettlementPosition');
    });
  });
});
