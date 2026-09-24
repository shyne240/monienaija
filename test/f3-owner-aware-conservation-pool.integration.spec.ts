import { randomUUID } from 'node:crypto';
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
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { VerificationStatus } from '../src/reconciliation/reconciliation.types';
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
 * F-3 — shared conservation pool + owner-aware financial identity.
 *
 * Proves that Customer and Agent are INDEPENDENT financial owners that both
 * participate in the CUSTOMER_FUNDS conservation pool, that reconciliation is
 * owner-aware, and that the transfer representation can distinguish all four
 * owner combinations — without implementing any agent transaction flow.
 */
describe('F-3 owner-aware shared conservation pool (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let agents: AgentService;
  let financial: AgentFinancialAccountService;
  let wallets: WalletService;
  let ledger: LedgerService;
  let reconciliation: ReconciliationService;

  // Finance-approved classification registered by migration 058.
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
    dataSource = await createIntegrationDataSource('f3ownerpool');
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
      new AuditService(dataSource.getRepository(AuditEvent)),
      FINANCE_CONFIG,
    );
    reconciliation = new ReconciliationService(dataSource);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  /**
   * Truncation clears the migration-seeded classification, so it is restored
   * exactly as migration 058 registers it. This keeps the registry the single
   * source of truth rather than letting application code assume it.
   */
  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await dataSource.query(`
      INSERT INTO agent_float_accounting_classifications
        (accounting_unit, account_type, normal_balance, is_active, approved_by, note)
      VALUES ('CUSTOMER_FUNDS', 'LIABILITY', 'CREDIT', TRUE, 'finance-f3-decision', 'restored for test')
    `);
  });

  async function activeAgent(label = 'agent'): Promise<Agent> {
    const created = await agents.create({
      reference: `${label}-${randomUUID().slice(0, 8)}`,
      actor: 'f3-integration',
    });
    await dataSource.query(`UPDATE agents SET status = $2 WHERE id = $1`, [
      created.id,
      AgentStatus.ACTIVE,
    ]);
    return { ...created, status: AgentStatus.ACTIVE };
  }

  async function makeLedgerAccount(unit: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO ledger_accounts
         (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance)
       VALUES ($1, $2, 'f3 account', 'LIABILITY', 'CREDIT', 'NGN', $3, FALSE)`,
      [id, `F3-${id.slice(0, 8)}`, unit],
    );
    return id;
  }

  describe('A. Customer wallet remains valid in CUSTOMER_FUNDS', () => {
    it('provisions a customer wallet exactly as before', async () => {
      const wallet = await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });

      const row = firstRow(
        await rows<{ owner_type: string; accounting_unit: string; name: string }>(
          `SELECT w.owner_type, la.accounting_unit, la.name
             FROM wallet_accounts w JOIN ledger_accounts la ON la.id = w.ledger_account_id
            WHERE w.id = $1`,
          [wallet.id],
        ),
        'customer wallet',
      );
      expect(row.owner_type).toBe(WalletOwnerType.CUSTOMER);
      expect(row.accounting_unit).toBe('CUSTOMER_FUNDS');
      expect(row.name).toContain('Customer wallet');
    });
  });

  describe('B. Agent wallet is valid in CUSTOMER_FUNDS when classified AGENT', () => {
    it('provisions an agent float account in the shared pool', async () => {
      const agent = await activeAgent();
      const view = await financial.provisionFloatAccount({
        agentId: agent.id,
        actor: 'finance-ops',
      });

      const row = firstRow(
        await rows<{ owner_type: string; accounting_unit: string; name: string }>(
          `SELECT w.owner_type, la.accounting_unit, la.name
             FROM wallet_accounts w JOIN ledger_accounts la ON la.id = w.ledger_account_id
            WHERE w.id = $1`,
          [view.walletAccountId],
        ),
        'agent wallet',
      );
      expect(row.owner_type).toBe(WalletOwnerType.AGENT);
      expect(row.accounting_unit).toBe('CUSTOMER_FUNDS');
      // Shared POOL, independent OWNER: the account is an Agent float account.
      expect(row.name).toContain('Agent float');
      expect(row.name).not.toContain('Customer wallet');
    });

    it('keeps Customer and Agent as independent owners in one pool', async () => {
      const agent = await activeAgent();
      await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });

      expect(
        await rows<{ owner_type: string; accounting_unit: string; count: number }>(
          `SELECT w.owner_type, la.accounting_unit, COUNT(*)::int AS count
             FROM wallet_accounts w JOIN ledger_accounts la ON la.id = w.ledger_account_id
            GROUP BY w.owner_type, la.accounting_unit ORDER BY w.owner_type`,
        ),
      ).toEqual([
        { owner_type: 'AGENT', accounting_unit: 'CUSTOMER_FUNDS', count: 1 },
        { owner_type: 'CUSTOMER', accounting_unit: 'CUSTOMER_FUNDS', count: 1 },
      ]);
    });
  });

  describe('C/D. classification cannot be mismatched to owner type', () => {
    it('C. a customer wallet cannot use a non-CUSTOMER_FUNDS classification', async () => {
      await dataSource.query(
        `INSERT INTO agent_float_accounting_classifications
           (accounting_unit, account_type, normal_balance, is_active, approved_by)
         VALUES ('OTHER_POOL', 'LIABILITY', 'CREDIT', FALSE, 'test')`,
      );
      const other = await makeLedgerAccount('OTHER_POOL');
      await expect(
        dataSource.query(
          `INSERT INTO wallet_accounts (id, customer_id, owner_type, currency, ledger_account_id, status)
           VALUES ($1, $2, 'CUSTOMER', 'NGN', $3, 'ACTIVE')`,
          [randomUUID(), randomUUID(), other],
        ),
      ).rejects.toThrow(/customer-funds liability account/);
    });

    it('D. an agent wallet cannot use an unapproved classification', async () => {
      const other = await makeLedgerAccount('NOT_APPROVED_POOL');
      await expect(
        dataSource.query(
          `INSERT INTO wallet_accounts (id, customer_id, owner_type, currency, ledger_account_id, status)
           VALUES ($1, $2, 'AGENT', 'NGN', $3, 'ACTIVE')`,
          [randomUUID(), randomUUID(), other],
        ),
      ).rejects.toThrow(/approved active agent-float classification/);
    });
  });

  describe('E. reconciliation accepts both owners and still catches violations', () => {
    it('passes with both a customer wallet and an agent float account', async () => {
      const agent = await activeAgent();
      await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });

      const report = await reconciliation.runReconciliation();
      const named = (name: string) => report.checks.find((c) => c.name === name);

      expect(named('wallet_liability_account_ownership')?.status).toBe(VerificationStatus.PASS);
      expect(named('accounting_unit_consistency')?.status).toBe(VerificationStatus.PASS);
      expect(named('wallet_owner_binding_integrity')?.status).toBe(VerificationStatus.PASS);
    });

    it('still detects an AGENT wallet with no agent binding', async () => {
      // Bypass the service to create an orphaned AGENT-owned account.
      const orphanLedger = await makeLedgerAccount('CUSTOMER_FUNDS');
      await dataSource.query(
        `INSERT INTO wallet_accounts (id, customer_id, owner_type, currency, ledger_account_id, status)
         VALUES ($1, $2, 'AGENT', 'NGN', $3, 'ACTIVE')`,
        [randomUUID(), randomUUID(), orphanLedger],
      );

      const report = await reconciliation.runReconciliation();
      const check = report.checks.find((c) => c.name === 'wallet_owner_binding_integrity');
      expect(check?.status).not.toBe(VerificationStatus.PASS);
    });

    it('conservation is still proven per accounting unit', async () => {
      const agent = await activeAgent();
      await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });

      const report = await reconciliation.getFinanceVerification();
      for (const dimension of report.balanceConservation) {
        expect(dimension.balanced).toBe(true);
      }
    });
  });

  describe('F/G/H. transfer representation distinguishes all four owner pairs', () => {
    /** A genuine customer-owned wallet account id. */
    async function customerWalletAccount(): Promise<string> {
      const wallet = await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });
      return wallet.id;
    }

    /** A genuine agent-owned float wallet account id. */
    async function agentWalletAccount(label: string): Promise<string> {
      const agent = await activeAgent(label);
      const view = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      return view.walletAccountId;
    }

    async function accountFor(owner: string, label: string): Promise<string> {
      return owner === 'AGENT' ? agentWalletAccount(label) : customerWalletAccount();
    }

    async function seedTransfer(sourceOwner: string, destinationOwner: string): Promise<string> {
      const id = randomUUID();
      const source = await accountFor(sourceOwner, `src-${id.slice(0, 6)}`);
      const destination = await accountFor(destinationOwner, `dst-${id.slice(0, 6)}`);
      await dataSource.query(
        `INSERT INTO transfers
           (id, source_wallet_id, destination_wallet_id, source_owner_type, destination_owner_type,
            amount_minor, currency, status, idempotency_key, request_hash, reference)
         VALUES ($1, $2, $3, $4, $5, 1000, 'NGN', 'PENDING', $6, $7, $8)`,
        [
          id,
          source,
          destination,
          sourceOwner,
          destinationOwner,
          `f3-${id}`,
          'a'.repeat(64),
          `MN-${id.slice(0, 8).toUpperCase()}`,
        ],
      );
      return id;
    }

    it('G. represents CUSTOMER->CUSTOMER, CUSTOMER->AGENT, AGENT->CUSTOMER and AGENT->AGENT', async () => {
      await seedTransfer('CUSTOMER', 'CUSTOMER');
      await seedTransfer('CUSTOMER', 'AGENT');
      await seedTransfer('AGENT', 'CUSTOMER');
      await seedTransfer('AGENT', 'AGENT');

      expect(
        await rows<{ source_owner_type: string; destination_owner_type: string }>(
          `SELECT source_owner_type, destination_owner_type FROM transfers
            ORDER BY source_owner_type, destination_owner_type`,
        ),
      ).toEqual([
        { source_owner_type: 'AGENT', destination_owner_type: 'AGENT' },
        { source_owner_type: 'AGENT', destination_owner_type: 'CUSTOMER' },
        { source_owner_type: 'CUSTOMER', destination_owner_type: 'AGENT' },
        { source_owner_type: 'CUSTOMER', destination_owner_type: 'CUSTOMER' },
      ]);
    });

    it('F. existing transfers default to CUSTOMER on both sides', async () => {
      const id = randomUUID();
      await dataSource.query(
        `INSERT INTO transfers
           (id, source_wallet_id, destination_wallet_id, amount_minor, currency, status,
            idempotency_key, request_hash)
         VALUES ($1, $2, $3, 1000, 'NGN', 'PENDING', $4, $5)`,
        [
          id,
          await customerWalletAccount(),
          await customerWalletAccount(),
          `legacy-${id}`,
          'a'.repeat(64),
        ],
      );

      const row = firstRow(
        await rows<{ source_owner_type: string; destination_owner_type: string }>(
          `SELECT source_owner_type, destination_owner_type FROM transfers WHERE id = $1`,
          [id],
        ),
        'legacy transfer',
      );
      expect(row).toEqual({ source_owner_type: 'CUSTOMER', destination_owner_type: 'CUSTOMER' });
    });

    it('H. one transaction reference identifies both participant sides', async () => {
      const id = await seedTransfer('CUSTOMER', 'AGENT');
      const row = firstRow(
        await rows<{
          reference: string;
          source_wallet_id: string;
          destination_wallet_id: string;
          source_owner_type: string;
          destination_owner_type: string;
        }>(`SELECT * FROM transfers WHERE id = $1`, [id]),
        'transfer',
      );

      // A single reference, resolvable from either side with its owner type.
      expect(row.reference).toMatch(/^MN-/);
      expect(row.source_owner_type).toBe('CUSTOMER');
      expect(row.destination_owner_type).toBe('AGENT');
      expect(row.source_wallet_id).not.toBe(row.destination_wallet_id);
    });

    it('rejects an unsupported owner type on either side', async () => {
      await expect(seedTransfer('AGGREGATOR', 'CUSTOMER')).rejects.toThrow(
        /chk_transfers_source_owner_type/,
      );
      await expect(seedTransfer('CUSTOMER', 'AGGREGATOR')).rejects.toThrow(
        /chk_transfers_destination_owner_type/,
      );
    });
  });

  describe('I/J. no transaction flow, no money', () => {
    it('I. no agent transfer execution path is introduced', () => {
      const surface = Object.getOwnPropertyNames(AgentFinancialAccountService.prototype);
      for (const forbidden of [
        'transfer','cashIn','cashOut','fund','debit','credit','postJournal','execute',
      ]) {
        expect(surface).not.toContain(forbidden);
      }
    });

    it('J. registering the classification and provisioning creates no money', async () => {
      const agent = await activeAgent();
      const view = await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      await wallets.createWallet({
        customerId: randomUUID(),
        currency: 'NGN',
        idempotencyKey: `cust-${randomUUID()}`,
      });

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

    it('Agent still does not create a Customer', async () => {
      const agent = await activeAgent();
      await financial.provisionFloatAccount({ agentId: agent.id, actor: 'ops' });
      expect(await count('customers')).toBe(0);
      expect(await count('customer_wallets')).toBe(0);
    });
  });
});
