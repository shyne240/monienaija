import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import type { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { TransferController } from '../src/transfer/transfer.controller';
import type { Transfer } from '../src/transfer/transfer.entity';
import { TransferStatus } from '../src/transfer/transfer.enums';
import { TransferService } from '../src/transfer/transfer.service';

/**
 * A5T13 — unit coverage for the read-only global transfer listing.
 *
 * Persistence is proven separately against real PostgreSQL in
 * `a5t13-global-transfer-listing.integration.spec.ts`.
 */
describe('A5T13 global transfer listing (unit)', () => {
  function transfer(overrides: Partial<Transfer> = {}): Transfer {
    return {
      id: '11111111-2222-4333-8444-555555555555',
      sourceWalletId: '22222222-2222-4333-8444-555555555555',
      destinationWalletId: '33333333-2222-4333-8444-555555555555',
      journalId: null,
      paymentReference: null,
      amountMinor: '1000',
      currency: 'NGN',
      status: TransferStatus.COMPLETED,
      idempotencyKey: 'super-secret-idempotency-key',
      requestHash: 'a'.repeat(64),
      policyInputHash: 'b'.repeat(64),
      reference: 'ref-1',
      narration: 'narration',
      failureCode: null,
      failureMessage: null,
      failureStatusCode: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-01T00:00:01.000Z'),
      ...overrides,
    } as Transfer;
  }

  interface FindArgs {
    skip?: number;
    take?: number;
  }

  function buildService(transfers: Transfer[], journals: LedgerJournal[] = []) {
    const writes: string[] = [];
    const transferRepository = {
      findAndCount: (args: FindArgs): Promise<[Transfer[], number]> => {
        const skip = args.skip ?? 0;
        const take = args.take ?? transfers.length;
        return Promise.resolve([transfers.slice(skip, skip + take), transfers.length]);
      },
      findOne: () => Promise.resolve(null),
      save: (e: unknown) => {
        writes.push('transfer.save');
        return Promise.resolve(e);
      },
    };
    const journalRepository = {
      find: (): Promise<LedgerJournal[]> => Promise.resolve(journals),
      findOne: () => Promise.resolve(null),
      save: (e: unknown) => {
        writes.push('journal.save');
        return Promise.resolve(e);
      },
    };
    const service = new TransferService(
      transferRepository as unknown as Repository<Transfer>,
      {} as never,
      journalRepository as unknown as Repository<LedgerJournal>,
      {} as never,
      {} as never,
    );
    return { service, writes };
  }

  describe('listing', () => {
    it('returns the established pagination envelope', async () => {
      const { service } = buildService([transfer({ id: 'a' }), transfer({ id: 'b' })]);
      const result = await service.listTransfers(1, 1);

      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
        hasNextPage: true,
      });
    });

    it('applies the existing history defaults', async () => {
      const { service } = buildService([transfer()]);
      const result = await service.listTransfers();

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it('returns an empty result without dividing by zero', async () => {
      const { service } = buildService([]);
      const result = await service.listTransfers();

      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasNextPage).toBe(false);
    });

    it('rejects invalid pagination', async () => {
      const { service } = buildService([transfer()]);
      for (const bad of [0, -1, 1.5, Number.NaN]) {
        await expect(service.listTransfers(bad, 10)).rejects.toBeInstanceOf(BadRequestException);
      }
      for (const bad of [0, -1, 101, 2.5]) {
        await expect(service.listTransfers(1, bad)).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('resolves the journal reference for transfers that posted one', async () => {
      const { service } = buildService(
        [transfer({ id: 't1', journalId: 'j1' }), transfer({ id: 't2', journalId: null })],
        [{ id: 'j1', reference: 'JRNL-1' } as LedgerJournal],
      );
      const { items } = await service.listTransfers();

      expect(items.find((i) => i.id === 't1')?.journalReference).toBe('JRNL-1');
      expect(items.find((i) => i.id === 't2')?.journalReference).toBeNull();
    });

    it('never writes while listing', async () => {
      const { service, writes } = buildService([transfer()]);
      await service.listTransfers();
      await service.listTransfers(1, 5);
      expect(writes).toEqual([]);
    });
  });

  describe('projection safety', () => {
    it('omits the idempotency key from the global listing', async () => {
      const { service } = buildService([transfer()]);
      const [item] = (await service.listTransfers()).items;

      expect(item).not.toHaveProperty('idempotencyKey');
      expect(JSON.stringify(item)).not.toContain('super-secret-idempotency-key');
    });

    it('still exposes the operational fields the single read exposes', async () => {
      const { service } = buildService([transfer()]);
      const [item] = (await service.listTransfers()).items;

      expect(Object.keys(item ?? {}).sort()).toEqual(
        [
          'id',
          'sourceWalletId',
          'destinationWalletId',
          'journalId',
          'paymentReference',
          'journalReference',
          'amountMinor',
          'currency',
          'status',
          'reference',
          'narration',
          'failureCode',
          'failureMessage',
          'failureStatusCode',
          'createdAt',
          'completedAt',
        ].sort(),
      );
    });

    it('never leaks internal hashes, PINs or credentials', async () => {
      const { service } = buildService([transfer()]);
      const serialized = JSON.stringify((await service.listTransfers()).items).toLowerCase();

      for (const forbidden of [
        'idempotencykey',
        'requesthash',
        'policyinputhash',
        'pin',
        'password',
        'secret',
        'token',
        'credential',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  describe('authorization boundary', () => {
    it('is not public and requires the internal scope', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({ method: 'GET', url: '/api/v1/transfers?page=1' });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });

    it('excludes CUSTOMER principals from the global listing', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({ method: 'GET', url: '/api/v1/transfers' });

      expect(resolution.policy?.allowedPrincipalTypes).toEqual([
        'SUPPORT',
        'OPERATOR',
        'SERVICE',
        'PRIVILEGED',
      ]);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
    });

    it('applies the same boundary as the existing single-transfer read', () => {
      const registry = new RoutePolicyRegistry();
      const listing = registry.resolve({ method: 'GET', url: '/api/v1/transfers' });
      const single = registry.resolve({
        method: 'GET',
        url: '/api/v1/transfers/11111111-2222-4333-8444-555555555555',
      });

      expect(listing.policy?.requiredScopes).toEqual(single.policy?.requiredScopes);
      expect(listing.policy?.allowedPrincipalTypes).toEqual(single.policy?.allowedPrincipalTypes);
      expect(listing.policy?.customerAccess).toBe(single.policy?.customerAccess);
    });
  });

  describe('controller', () => {
    it('passes pagination through and adds no mutating handler', async () => {
      const received: unknown[] = [];
      const service = {
        listTransfers: (page?: number, limit?: number) => {
          received.push({ page, limit });
          return Promise.resolve({
            items: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false },
          });
        },
      };
      const controller = new TransferController(service as unknown as TransferService);

      await controller.listTransfers({ page: 3, limit: 5 });
      expect(received).toEqual([{ page: 3, limit: 5 }]);

      const handlers = Object.getOwnPropertyNames(TransferController.prototype);
      expect(handlers).toContain('getTransfer');
      expect(handlers).toContain('createTransfer');
      expect(handlers).toContain('listTransfers');
    });

    it('leaves the retired mutating route retired', () => {
      const controller = new TransferController({} as unknown as TransferService);
      expect(() => controller.createTransfer()).toThrow(/retired/i);
    });
  });
});
