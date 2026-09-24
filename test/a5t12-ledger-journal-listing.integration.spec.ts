import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A5T12 — read-only ledger journal listing against real PostgreSQL.
 *
 * Journals are created through the real `postJournal` path so the listing is
 * proven against genuine, balanced, double-entry accounting facts rather than
 * hand-inserted rows. The suite then proves the listing is strictly read-only:
 * journals, lines and account balances are identical before and after reads.
 */
describe('A5T12 ledger journal listing (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let service: LedgerService;
  let debitAccountId: string;
  let creditAccountId: string;

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a5t12journallist');
    service = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
      undefined,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const debit = await service.createAccount({
      code: `A5T12-DR-${Date.now()}`,
      name: 'A5T12 debit',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
    });
    const credit = await service.createAccount({
      code: `A5T12-CR-${Date.now()}`,
      name: 'A5T12 credit',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
    });
    debitAccountId = debit.id;
    creditAccountId = credit.id;
  });

  async function postJournal(index: number): Promise<string> {
    const view = await service.postJournal({
      idempotencyKey: `a5t12-${index}-${Date.now()}`,
      currency: 'NGN',
      reference: `ref-${index}`,
      description: `journal ${index}`,
      lines: [
        {
          accountId: debitAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: String(1000 * index),
        },
        {
          accountId: creditAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: String(1000 * index),
        },
      ],
    });
    return view.id;
  }

  describe('authorized listing', () => {
    it('lists journals that genuinely exist in the ledger', async () => {
      const first = await postJournal(1);
      const second = await postJournal(2);

      const result = await service.listJournals();
      expect(result.pagination.total).toBe(2);

      const listedIds = result.items.map((item) => item.id).sort();
      expect(listedIds).toEqual([first, second].sort());

      const persisted = await rows<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ledger_journals`,
      );
      expect(firstRow(persisted, 'journal count').count).toBe(2);
    });

    it('returns records that match the persisted rows exactly', async () => {
      const journalId = await postJournal(3);
      const [listed] = (await service.listJournals()).items;
      const persisted = firstRow(
        await rows<{
          id: string;
          currency: string;
          accounting_unit: string;
          status: string;
          reference: string | null;
          total_minor: string;
        }>(`SELECT * FROM ledger_journals WHERE id = $1`, [journalId]),
        'persisted journal',
      );

      expect(listed?.id).toBe(persisted.id);
      expect(listed?.currency).toBe(persisted.currency);
      expect(listed?.accountingUnit).toBe(persisted.accounting_unit);
      expect(listed?.status).toBe(persisted.status);
      expect(listed?.reference).toBe(persisted.reference);
      expect(listed?.totalMinor).toBe(String(persisted.total_minor));
    });

    it('returns the balanced lines for each listed journal', async () => {
      await postJournal(1);
      const [listed] = (await service.listJournals()).items;

      expect(listed?.lines).toHaveLength(2);
      const debits = listed?.lines.filter((l) => l.direction === LedgerEntryDirection.DEBIT) ?? [];
      const credits =
        listed?.lines.filter((l) => l.direction === LedgerEntryDirection.CREDIT) ?? [];
      expect(debits).toHaveLength(1);
      expect(credits).toHaveLength(1);
      expect(debits[0]?.amountMinor).toBe(credits[0]?.amountMinor);
    });

    it('paginates deterministically with no overlap and no omission', async () => {
      const posted: string[] = [];
      for (let i = 1; i <= 5; i += 1) posted.push(await postJournal(i));

      const pageOne = await service.listJournals({ page: 1, limit: 2 });
      const pageTwo = await service.listJournals({ page: 2, limit: 2 });
      const pageThree = await service.listJournals({ page: 3, limit: 2 });

      expect(pageOne.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
      });
      expect(pageThree.pagination.hasNextPage).toBe(false);

      const seen = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((i) => i.id);
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect(seen.sort()).toEqual(posted.sort());
    });

    it('returns a stable page on repeated identical reads', async () => {
      for (let i = 1; i <= 3; i += 1) await postJournal(i);

      const first = await service.listJournals({ page: 1, limit: 2 });
      const second = await service.listJournals({ page: 1, limit: 2 });
      expect(second.items.map((i) => i.id)).toEqual(first.items.map((i) => i.id));
    });

    it('returns an empty result for an empty ledger', async () => {
      const result = await service.listJournals();
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('rejects invalid pagination against the real ledger', async () => {
      await expect(service.listJournals({ limit: 101 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.listJournals({ page: 0 })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('read-only guarantee', () => {
    it('leaves journals, lines and balances byte-identical after reads', async () => {
      for (let i = 1; i <= 3; i += 1) await postJournal(i);

      const journalsBefore = await rows<Record<string, unknown>>(
        `SELECT * FROM ledger_journals ORDER BY id`,
      );
      const linesBefore = await rows<Record<string, unknown>>(
        `SELECT * FROM ledger_lines ORDER BY id`,
      );
      const debitBalanceBefore = await service.getAccountBalance(debitAccountId);
      const creditBalanceBefore = await service.getAccountBalance(creditAccountId);

      await service.listJournals();
      await service.listJournals({ page: 1, limit: 1 });
      await service.listJournals({ page: 2, limit: 1 });

      const journalsAfter = await rows<Record<string, unknown>>(
        `SELECT * FROM ledger_journals ORDER BY id`,
      );
      const linesAfter = await rows<Record<string, unknown>>(
        `SELECT * FROM ledger_lines ORDER BY id`,
      );

      expect(journalsAfter).toEqual(journalsBefore);
      expect(linesAfter).toEqual(linesBefore);
      expect(await service.getAccountBalance(debitAccountId)).toEqual(debitBalanceBefore);
      expect(await service.getAccountBalance(creditAccountId)).toEqual(creditBalanceBefore);
    });

    it('creates and deletes no journal or line rows', async () => {
      await postJournal(1);
      await postJournal(2);

      await service.listJournals();
      await service.listJournals({ page: 1, limit: 100 });

      const journalCount = firstRow(
        await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ledger_journals`),
        'journal count',
      );
      const lineCount = firstRow(
        await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ledger_lines`),
        'line count',
      );
      expect(journalCount.count).toBe(2);
      expect(lineCount.count).toBe(4);
    });

    it('does not change journal status or produce a reversal', async () => {
      const journalId = await postJournal(1);

      await service.listJournals();

      const after = firstRow(
        await rows<{ status: string; reversal_of_journal_id: string | null }>(
          `SELECT status, reversal_of_journal_id FROM ledger_journals WHERE id = $1`,
          [journalId],
        ),
        'journal after read',
      );
      expect(after.status).toBe('POSTED');
      expect(after.reversal_of_journal_id).toBeNull();

      const reversals = firstRow(
        await rows<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM ledger_journals WHERE reversal_of_journal_id IS NOT NULL`,
        ),
        'reversal count',
      );
      expect(reversals.count).toBe(0);
    });
  });

  describe('authorization boundary', () => {
    it('is not a public route and requires the internal scope', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({ method: 'GET', url: '/api/v1/ledger/journals' });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });
  });
});
