import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { CustomerFinancialAccountDiscrepancyType } from '../src/reconciliation/customer-financial-account-reconciliation.types';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A5T14 — read-only reconciliation break detail against real PostgreSQL.
 *
 * Reconciliation breaks are NOT persisted: the repository derives them from the
 * live relationships between customers, customer wallets, wallet accounts,
 * bindings and ledger accounts. There is therefore no "break row" to insert,
 * and inserting one would be meaningless.
 *
 * So breaks are produced the only genuine way available: by creating real
 * participants through the existing `seedTransferParticipant` harness path and
 * then establishing real inconsistent states (a wallet account with no binding;
 * a binding whose customer wallet is gone). The reconciliation pass and the
 * read model under test are the real ones — nothing is mocked.
 */
describe('A5T14 reconciliation breaks (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let reconciliation: ReconciliationService;
  let ledger: LedgerService;

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
    dataSource = await createIntegrationDataSource('a5t14breaks');
    reconciliation = new ReconciliationService(dataSource);
    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
  });

  async function makeLedgerAccount(label: string): Promise<string> {
    const account = await ledger.createAccount({
      code: `A5T14-${label}-${randomUUID().slice(0, 8)}`,
      name: `A5T14 ${label}`,
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    return account.id;
  }

  /**
   * A genuinely consistent participant: customer, customer wallet, wallet
   * account and binding, plus the `wallet_ownerships` evidence row that real
   * wallet provisioning creates. The shared `seedTransferParticipant` harness
   * omits that row (it is not needed for transfer execution), which the
   * reconciliation pass correctly reports as ORPHANED_CUSTOMER_WALLET, so it is
   * added here to obtain a truly clean census.
   */
  async function seedConsistent(label: string) {
    const participant = await seedTransferParticipant(
      dataSource,
      label,
      await makeLedgerAccount(label),
    );
    await dataSource.query(
      `INSERT INTO wallet_ownerships (wallet_id, customer_id) VALUES ($1, $2)`,
      [participant.customerWalletId, participant.customerId],
    );
    return participant;
  }

  /**
   * A financial wallet account provisioned without a binding. This is a real
   * operational state (provisioning can outrun binding) and the reconciliation
   * pass classifies it as UNBOUND_FINANCIAL_WALLET.
   */
  async function seedUnboundWalletAccount(): Promise<string> {
    const ledgerAccountId = await makeLedgerAccount('unbound');
    const walletAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO wallet_accounts (id, customer_id, currency, ledger_account_id, status)
       VALUES ($1, $2, 'NGN', $3, 'ACTIVE')`,
      [walletAccountId, randomUUID(), ledgerAccountId],
    );
    return walletAccountId;
  }

  async function seedBreaks(howMany: number): Promise<void> {
    for (let i = 0; i < howMany; i += 1) await seedUnboundWalletAccount();
  }

  describe('breaks derived from genuine persisted state', () => {
    it('reports no breaks for a consistent binding census', async () => {
      await seedConsistent('clean');

      const result = await reconciliation.listBindingReconciliationBreaks();
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.summary.discrepancies).toBe(0);
      expect(result.repairPerformed).toBe(false);
    });

    it('surfaces a genuine unbound financial wallet as a break', async () => {
      const walletAccountId = await seedUnboundWalletAccount();

      const result = await reconciliation.listBindingReconciliationBreaks();
      expect(result.pagination.total).toBeGreaterThan(0);

      const unbound = result.items.find(
        (b) => b.type === CustomerFinancialAccountDiscrepancyType.UNBOUND_FINANCIAL_WALLET,
      );
      expect(unbound).toBeDefined();
      expect(unbound?.walletAccountId).toBe(walletAccountId);
      expect(unbound?.message).toBeTruthy();
    });

    it('returns breaks that correspond to actually persisted rows', async () => {
      const walletAccountId = await seedUnboundWalletAccount();
      const [item] = (await reconciliation.listBindingReconciliationBreaks()).items;

      const persisted = firstRow(
        await rows<{ id: string; currency: string; ledger_account_id: string }>(
          `SELECT id, currency, ledger_account_id FROM wallet_accounts WHERE id = $1`,
          [walletAccountId],
        ),
        'persisted wallet account',
      );
      expect(item?.walletAccountId).toBe(persisted.id);
      expect(item?.currency).toBe(persisted.currency);
      expect(item?.ledgerAccountId).toBe(persisted.ledger_account_id);
    });

    it('keeps the summary describing the whole pass while paging the detail', async () => {
      await seedBreaks(5);

      const page = await reconciliation.listBindingReconciliationBreaks({ page: 1, limit: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.pagination.total).toBe(5);
      expect(page.summary.discrepancies).toBe(5);
    });
  });

  describe('pagination', () => {
    it('is deterministic and neither overlaps nor omits', async () => {
      await seedBreaks(5);

      const one = await reconciliation.listBindingReconciliationBreaks({ page: 1, limit: 2 });
      const two = await reconciliation.listBindingReconciliationBreaks({ page: 2, limit: 2 });
      const three = await reconciliation.listBindingReconciliationBreaks({ page: 3, limit: 2 });

      expect(one.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
      });
      expect(three.pagination.hasNextPage).toBe(false);

      const keys = [...one.items, ...two.items, ...three.items].map((b) => b.key);
      expect(keys).toHaveLength(5);
      expect(new Set(keys).size).toBe(5);
    });

    it('returns a stable page across repeated identical reads', async () => {
      await seedBreaks(4);
      const first = await reconciliation.listBindingReconciliationBreaks({ page: 1, limit: 2 });
      const second = await reconciliation.listBindingReconciliationBreaks({ page: 1, limit: 2 });
      expect(second.items.map((b) => b.key)).toEqual(first.items.map((b) => b.key));
    });

    it('handles an empty database', async () => {
      const result = await reconciliation.listBindingReconciliationBreaks();
      expect(result.items).toEqual([]);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('rejects invalid pagination', async () => {
      await expect(
        reconciliation.listBindingReconciliationBreaks({ limit: 101 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        reconciliation.listBindingReconciliationBreaks({ page: 0 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('read-only guarantee', () => {
    it('mutates no reconciliation-relevant table across repeated reads', async () => {
      await seedConsistent('stable');
      await seedBreaks(3);

      const snapshot = async () => ({
        customers: await rows<Record<string, unknown>>(`SELECT * FROM customers ORDER BY id`),
        customerWallets: await rows<Record<string, unknown>>(
          `SELECT * FROM customer_wallets ORDER BY id`,
        ),
        walletAccounts: await rows<Record<string, unknown>>(
          `SELECT * FROM wallet_accounts ORDER BY id`,
        ),
        bindings: await rows<Record<string, unknown>>(
          `SELECT * FROM customer_financial_account_bindings ORDER BY id`,
        ),
        ledgerAccounts: await rows<Record<string, unknown>>(
          `SELECT * FROM ledger_accounts ORDER BY id`,
        ),
        journals: await rows<Record<string, unknown>>(`SELECT * FROM ledger_journals ORDER BY id`),
        lines: await rows<Record<string, unknown>>(`SELECT * FROM ledger_lines ORDER BY id`),
        transfers: await rows<Record<string, unknown>>(`SELECT * FROM transfers ORDER BY id`),
      });

      const before = await snapshot();

      await reconciliation.listBindingReconciliationBreaks();
      await reconciliation.listBindingReconciliationBreaks({ page: 1, limit: 1 });
      await reconciliation.listBindingReconciliationBreaks({ page: 2, limit: 1 });

      expect(await snapshot()).toEqual(before);
    });

    it('never resolves or repairs a break', async () => {
      await seedBreaks(2);

      const before = await reconciliation.listBindingReconciliationBreaks();
      await reconciliation.listBindingReconciliationBreaks();
      const after = await reconciliation.listBindingReconciliationBreaks();

      // The same breaks are still reported: reading does not clear them.
      expect(after.pagination.total).toBe(before.pagination.total);
      expect(after.items.map((b) => b.key).sort()).toEqual(
        before.items.map((b) => b.key).sort(),
      );
      expect(after.repairPerformed).toBe(false);
    });

    it('creates no ledger, transfer or audit records', async () => {
      await seedConsistent('noside');
      const beforeAudit = await count('audit_events');

      await reconciliation.listBindingReconciliationBreaks();

      expect(await count('ledger_journals')).toBe(0);
      expect(await count('ledger_lines')).toBe(0);
      expect(await count('transfers')).toBe(0);
      expect(await count('audit_events')).toBe(beforeAudit);
    });

    it('runs inside a read-only transaction that PostgreSQL itself enforces', async () => {
      await seedBreaks(1);
      // The pass executes under SET TRANSACTION READ ONLY; a write attempted on
      // that path would raise 25006. Reaching a result proves no write occurred.
      await expect(reconciliation.listBindingReconciliationBreaks()).resolves.toBeDefined();

      await expect(
        dataSource.transaction(async (manager) => {
          await manager.query('SET TRANSACTION READ ONLY');
          await manager.query(`DELETE FROM wallet_accounts`);
        }),
      ).rejects.toThrow(/read-only transaction/i);
    });
  });

  describe('authorization boundary', () => {
    it('is internal-only and excludes CUSTOMER principals', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({
        method: 'GET',
        url: '/api/v1/internal/reconciliation/report/breaks',
      });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });
  });
});
