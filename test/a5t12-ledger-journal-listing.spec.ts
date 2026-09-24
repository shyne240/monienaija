import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { LedgerController } from '../src/ledger/ledger.controller';
import type { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import type { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerEntryDirection, LedgerJournalStatus } from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';

/**
 * A5T12 — unit coverage for the read-only ledger journal listing.
 *
 * Persistence is proven separately against real PostgreSQL in
 * `a5t12-ledger-journal-listing.integration.spec.ts`.
 */
describe('A5T12 ledger journal listing (unit)', () => {
  function journal(overrides: Partial<LedgerJournal> = {}): LedgerJournal {
    return {
      id: '11111111-2222-4333-8444-555555555555',
      idempotencyKey: 'idem-1',
      requestHash: 'a'.repeat(64),
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      status: LedgerJournalStatus.POSTED,
      reference: 'ref-1',
      description: 'desc',
      correlationId: null,
      reversalOfJournalId: null,
      metadata: {},
      totalMinor: '1000',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      postedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    } as LedgerJournal;
  }

  function line(journalId: string, lineNumber: number): LedgerLine {
    return {
      id: `line-${journalId}-${lineNumber}`,
      journalId,
      ledgerAccountId: 'acc-1',
      lineNumber,
      direction: lineNumber === 1 ? LedgerEntryDirection.DEBIT : LedgerEntryDirection.CREDIT,
      amountMinor: '1000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    } as unknown as LedgerLine;
  }

  interface FindArgs {
    skip?: number;
    take?: number;
    where?: unknown;
  }

  function buildService(journals: LedgerJournal[], lines: LedgerLine[] = []) {
    const writes: string[] = [];
    const journalRepository = {
      findAndCount: (args: FindArgs): Promise<[LedgerJournal[], number]> => {
        const skip = args.skip ?? 0;
        const take = args.take ?? journals.length;
        return Promise.resolve([journals.slice(skip, skip + take), journals.length]);
      },
      findOne: () => Promise.resolve(null),
      save: (entity: unknown) => {
        writes.push('journal.save');
        return Promise.resolve(entity);
      },
    };
    const lineRepository = {
      find: (): Promise<LedgerLine[]> => Promise.resolve(lines),
      save: (entity: unknown) => {
        writes.push('line.save');
        return Promise.resolve(entity);
      },
    };
    const service = new LedgerService(
      {} as never,
      journalRepository as unknown as Repository<LedgerJournal>,
      lineRepository as unknown as Repository<LedgerLine>,
      {} as never,
      undefined,
    );
    return { service, writes };
  }

  describe('listing', () => {
    it('returns the established pagination envelope', async () => {
      const { service } = buildService([journal({ id: 'a' }), journal({ id: 'b' })]);
      const result = await service.listJournals({ page: 1, limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
        hasNextPage: true,
      });
    });

    it('defaults to page 1 and limit 50', async () => {
      const { service } = buildService([journal()]);
      const result = await service.listJournals();

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(50);
    });

    it('returns an empty result without dividing by zero', async () => {
      const { service } = buildService([]);
      const result = await service.listJournals();

      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNextPage).toBe(false);
    });

    it('rejects invalid pagination', async () => {
      const { service } = buildService([journal()]);
      for (const bad of [0, -1, 1.5, Number.NaN]) {
        await expect(service.listJournals({ page: bad })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      for (const bad of [0, -1, 101, 2.5]) {
        await expect(service.listJournals({ limit: bad })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
    });

    it('reuses the existing journal projection, including its lines', async () => {
      const { service } = buildService(
        [journal({ id: 'j1' })],
        [line('j1', 1), line('j1', 2)],
      );
      const [item] = (await service.listJournals()).items;

      expect(Object.keys(item ?? {}).sort()).toEqual(
        [
          'id',
          'idempotencyKey',
          'currency',
          'accountingUnit',
          'status',
          'reference',
          'description',
          'correlationId',
          'reversalOfJournalId',
          'metadata',
          'totalMinor',
          'createdAt',
          'postedAt',
          'lines',
        ].sort(),
      );
      expect(item?.lines).toHaveLength(2);
      // requestHash is internal idempotency material and must not be projected.
      expect(item).not.toHaveProperty('requestHash');
    });

    it('groups lines onto their own journal only', async () => {
      const { service } = buildService(
        [journal({ id: 'j1' }), journal({ id: 'j2' })],
        [line('j1', 1), line('j2', 1), line('j2', 2)],
      );
      const { items } = await service.listJournals();

      expect(items.find((i) => i.id === 'j1')?.lines).toHaveLength(1);
      expect(items.find((i) => i.id === 'j2')?.lines).toHaveLength(2);
    });

    it('never writes while listing', async () => {
      const { service, writes } = buildService([journal()], [line('j1', 1)]);
      await service.listJournals();
      await service.listJournals({ page: 1, limit: 10 });
      expect(writes).toEqual([]);
    });

    it('exposes no secret or credential material', async () => {
      const { service } = buildService([journal()], [line('j1', 1)]);
      const serialized = JSON.stringify((await service.listJournals()).items).toLowerCase();

      for (const secret of ['password', 'secret', 'token', 'credential', 'pin', 'requesthash']) {
        expect(serialized).not.toContain(secret);
      }
    });
  });

  describe('authorization boundary', () => {
    it('resolves the ledger journals route to the internal-route policy', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({
        method: 'GET',
        url: '/api/v1/ledger/journals?page=1',
      });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).toEqual([
        'SUPPORT',
        'OPERATOR',
        'SERVICE',
        'PRIVILEGED',
      ]);
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });

    it('applies the same boundary as the existing single-journal read', () => {
      const registry = new RoutePolicyRegistry();
      const listing = registry.resolve({ method: 'GET', url: '/api/v1/ledger/journals' });
      const single = registry.resolve({
        method: 'GET',
        url: '/api/v1/ledger/journals/11111111-2222-4333-8444-555555555555',
      });

      expect(listing.policy?.requiredScopes).toEqual(single.policy?.requiredScopes);
      expect(listing.policy?.allowedPrincipalTypes).toEqual(single.policy?.allowedPrincipalTypes);
      expect(listing.policy?.customerAccess).toBe(single.policy?.customerAccess);
    });

    it('never exposes ledger journals publicly', () => {
      const registry = new RoutePolicyRegistry();
      expect(registry.isPublic('GET', '/api/v1/ledger/journals')).toBe(false);
    });
  });

  describe('controller', () => {
    it('delegates to the service without transforming the query', async () => {
      const received: unknown[] = [];
      const service = {
        listJournals: (query: unknown) => {
          received.push(query);
          return Promise.resolve({
            items: [],
            pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasNextPage: false },
          });
        },
      };
      const controller = new LedgerController(service as unknown as LedgerService);

      await controller.listJournals({ page: 2, limit: 10 });
      expect(received).toEqual([{ page: 2, limit: 10 }]);
    });

    it('adds no mutating handler', () => {
      const handlers = Object.getOwnPropertyNames(LedgerController.prototype);
      for (const existing of [
        'createAccount',
        'listAccounts',
        'getAccountBalance',
        'getAccount',
        'postJournal',
        'getJournal',
        'reverseJournal',
      ]) {
        expect(handlers).toContain(existing);
      }
      expect(handlers).toContain('listJournals');
    });
  });
});
