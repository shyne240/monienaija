import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { RoutePolicyRegistry } from '../src/authorization/route-policy-registry';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { Transfer } from '../src/transfer/transfer.entity';
import { TransferStatus } from '../src/transfer/transfer.enums';
import { TransferLifecycleService } from '../src/transfer/transfer-lifecycle.service';
import type { CreateTransferLifecycleCommand } from '../src/transfer/transfer-lifecycle.types';
import { TransferService } from '../src/transfer/transfer.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
  type TransferParticipant,
} from './support/pg-harness';

/**
 * A5T13 — read-only global transfer listing against real PostgreSQL.
 *
 * Every transfer is seeded through the GENUINE A5 lifecycle path
 * (createPending → transition → postToLedger), never by hand-inserting rows,
 * so the listing is proven against real transfer records in real states.
 */
describe('A5T13 global transfer listing (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let lifecycle: TransferLifecycleService;
  let transfers: TransferService;
  let ledger: LedgerService;

  let sourceLedgerAccountId: string;
  let destinationLedgerAccountId: string;
  let source: TransferParticipant;
  let destination: TransferParticipant;

  const requestContext = { requestId: 'req-a5t13', correlationId: 'corr-a5t13' };

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result: unknown = await dataSource.query(sql, params);
    return result as T[];
  }

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a5t13transferlist');
    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
    lifecycle = new TransferLifecycleService(
      dataSource.getRepository(Transfer),
      dataSource,
      ledger,
      new AuditService(dataSource.getRepository(AuditEvent)),
      new OutboxService(dataSource.getRepository(OutboxEvent)),
      new IdempotencyService(dataSource.getRepository(IdempotencyRecord)),
    );
    transfers = new TransferService(
      dataSource.getRepository(Transfer),
      dataSource.getRepository(WalletAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource,
      ledger,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const suffix = randomUUID().slice(0, 8);
    const sourceAccount = await ledger.createAccount({
      code: `A5T13-SRC-${suffix}`,
      name: 'Source wallet',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    const destinationAccount = await ledger.createAccount({
      code: `A5T13-DST-${suffix}`,
      name: 'Destination wallet',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    const funding = await ledger.createAccount({
      code: `A5T13-FUND-${suffix}`,
      name: 'Funding control',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    sourceLedgerAccountId = sourceAccount.id;
    destinationLedgerAccountId = destinationAccount.id;
    source = await seedTransferParticipant(dataSource, 'a5t13src', sourceLedgerAccountId);
    destination = await seedTransferParticipant(dataSource, 'a5t13dst', destinationLedgerAccountId);

    await ledger.postJournal({
      idempotencyKey: `fund-${suffix}`,
      reference: `fund-${suffix}`,
      description: 'Seed source wallet',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: funding.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000000' },
        {
          accountId: sourceLedgerAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: '1000000',
        },
      ],
    });
  }, 60000);

  function createCommand(
    overrides: Partial<CreateTransferLifecycleCommand> = {},
  ): CreateTransferLifecycleCommand {
    return {
      contractVersion: 1,
      commandType: 'INTERNAL_TRANSFER',
      commandId: randomUUID(),
      capability: 'wallet.transfer',
      action: 'create',
      scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
      sourceCustomerId: source.customerId,
      destinationCustomerId: destination.customerId,
      sourceCustomerWalletId: source.customerWalletId,
      destinationCustomerWalletId: destination.customerWalletId,
      sourceBindingId: source.bindingId,
      destinationBindingId: destination.bindingId,
      sourceBindingVersion: 1,
      destinationBindingVersion: 1,
      sourceWalletAccountId: source.walletAccountId,
      destinationWalletAccountId: destination.walletAccountId,
      sourceLedgerAccountId,
      destinationLedgerAccountId,
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyScope: 'wallet.transfer.create.v1',
      idempotencyKey: `a5t13-${randomUUID()}`,
      requestHash: 'a'.repeat(64),
      authorizationContextReference: 'a2-auth-context-1',
      policyDecisionReference: 'a4-decision-1',
      policyVersion: 'a4.profile.v1',
      policyProfileReference: 'profile.v1',
      policyProfileVersion: 1,
      policySnapshotReference: 'a4-snapshot-1',
      policyInputHash: 'b'.repeat(64),
      requestedAt: new Date().toISOString(),
      requestContext,
      reference: 'business-reference',
      narration: 'listing seed',
      ...overrides,
    };
  }

  /** Seeds a genuine PENDING transfer. */
  async function seedPending(): Promise<string> {
    const created = await lifecycle.createPending(createCommand());
    return created.id;
  }

  /** Seeds a genuine COMPLETED transfer through the real lifecycle. */
  async function seedCompleted(): Promise<string> {
    const created = await lifecycle.createPending(createCommand());
    await lifecycle.transition(created.id, {
      transferId: created.id,
      nextStatus: TransferStatus.PROCESSING,
      idempotencyKey: `state-${randomUUID()}`,
      requestContext,
    });
    await lifecycle.postToLedger(created.id, {
      idempotencyKey: `post-${randomUUID()}`,
      requestContext,
    });
    return created.id;
  }

  describe('authorized listing', () => {
    it('lists transfers that genuinely exist', async () => {
      const pending = await seedPending();
      const completed = await seedCompleted();

      const result = await transfers.listTransfers();
      expect(result.pagination.total).toBe(2);
      expect(result.items.map((i) => i.id).sort()).toEqual([pending, completed].sort());
    });

    it('returns records that match the persisted transfers', async () => {
      const id = await seedCompleted();
      const [listed] = (await transfers.listTransfers()).items;
      const persisted = firstRow(
        await rows<{
          id: string;
          amount_minor: string;
          currency: string;
          status: string;
          journal_id: string | null;
          reference: string | null;
        }>(`SELECT * FROM transfers WHERE id = $1`, [id]),
        'persisted transfer',
      );

      expect(listed?.id).toBe(persisted.id);
      expect(listed?.amountMinor).toBe(String(persisted.amount_minor));
      expect(listed?.currency).toBe(persisted.currency);
      expect(listed?.status).toBe(persisted.status);
      expect(listed?.journalId).toBe(persisted.journal_id);
      expect(listed?.reference).toBe(persisted.reference);
    });

    it('represents different transfer states correctly', async () => {
      const pending = await seedPending();
      const completed = await seedCompleted();

      const { items } = await transfers.listTransfers();
      const pendingItem = items.find((i) => i.id === pending);
      const completedItem = items.find((i) => i.id === completed);

      expect(pendingItem?.status).toBe(TransferStatus.PENDING);
      expect(pendingItem?.journalId).toBeNull();
      expect(pendingItem?.completedAt).toBeNull();

      expect(completedItem?.status).toBe(TransferStatus.COMPLETED);
      expect(completedItem?.journalId).toBeTruthy();
      expect(completedItem?.journalReference).toBeTruthy();
      expect(completedItem?.completedAt).toBeTruthy();
    });

    it('paginates deterministically with no overlap and no omission', async () => {
      const seeded: string[] = [];
      for (let i = 0; i < 5; i += 1) seeded.push(await seedPending());

      const one = await transfers.listTransfers(1, 2);
      const two = await transfers.listTransfers(2, 2);
      const three = await transfers.listTransfers(3, 2);

      expect(one.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasNextPage: true,
      });
      expect(three.pagination.hasNextPage).toBe(false);

      const seen = [...one.items, ...two.items, ...three.items].map((i) => i.id);
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect(seen.sort()).toEqual(seeded.sort());
    });

    it('returns an empty result when no transfers exist', async () => {
      const result = await transfers.listTransfers();
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('rejects invalid pagination', async () => {
      await expect(transfers.listTransfers(1, 101)).rejects.toBeInstanceOf(BadRequestException);
      await expect(transfers.listTransfers(0, 10)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never exposes the idempotency key of a real transfer', async () => {
      await seedCompleted();
      const persisted = firstRow(
        await rows<{ idempotency_key: string }>(`SELECT idempotency_key FROM transfers`),
        'persisted idempotency key',
      );
      const serialized = JSON.stringify((await transfers.listTransfers()).items);

      expect(persisted.idempotency_key).toBeTruthy();
      expect(serialized).not.toContain(persisted.idempotency_key);
      expect((await transfers.listTransfers()).items[0]).not.toHaveProperty('idempotencyKey');
    });
  });

  describe('read-only guarantee', () => {
    it('leaves transfers, journals, lines and idempotency records unchanged', async () => {
      await seedPending();
      await seedCompleted();

      const before = {
        transfers: await rows<Record<string, unknown>>(`SELECT * FROM transfers ORDER BY id`),
        journals: await rows<Record<string, unknown>>(`SELECT * FROM ledger_journals ORDER BY id`),
        lines: await rows<Record<string, unknown>>(`SELECT * FROM ledger_lines ORDER BY id`),
        idempotency: await rows<Record<string, unknown>>(
          `SELECT * FROM idempotency_records ORDER BY id`,
        ),
      };

      await transfers.listTransfers();
      await transfers.listTransfers(1, 1);
      await transfers.listTransfers(2, 1);

      expect(await rows(`SELECT * FROM transfers ORDER BY id`)).toEqual(before.transfers);
      expect(await rows(`SELECT * FROM ledger_journals ORDER BY id`)).toEqual(before.journals);
      expect(await rows(`SELECT * FROM ledger_lines ORDER BY id`)).toEqual(before.lines);
      expect(await rows(`SELECT * FROM idempotency_records ORDER BY id`)).toEqual(
        before.idempotency,
      );
    });

    it('leaves ledger balances unchanged', async () => {
      await seedCompleted();
      const balanceOf = async (accountId: string) =>
        firstRow(
          await rows<{ balance: string }>(
            `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
               FROM ledger_lines WHERE ledger_account_id = $1`,
            [accountId],
          ),
          'balance',
        ).balance;

      const before = {
        src: await balanceOf(sourceLedgerAccountId),
        dst: await balanceOf(destinationLedgerAccountId),
      };

      await transfers.listTransfers();

      expect(await balanceOf(sourceLedgerAccountId)).toBe(before.src);
      expect(await balanceOf(destinationLedgerAccountId)).toBe(before.dst);
    });

    it('creates and deletes no transfer rows', async () => {
      await seedPending();
      await seedCompleted();

      await transfers.listTransfers();
      await transfers.listTransfers(1, 100);

      const counted = firstRow(
        await rows<{ count: number }>(`SELECT COUNT(*)::int AS count FROM transfers`),
        'transfer count',
      );
      expect(counted.count).toBe(2);
    });

    it('does not change transfer status or version', async () => {
      const id = await seedPending();
      const before = firstRow(
        await rows<{ status: string; version: number }>(
          `SELECT status, version FROM transfers WHERE id = $1`,
          [id],
        ),
        'transfer before',
      );

      await transfers.listTransfers();

      const after = firstRow(
        await rows<{ status: string; version: number }>(
          `SELECT status, version FROM transfers WHERE id = $1`,
          [id],
        ),
        'transfer after',
      );
      expect(after).toEqual(before);
      expect(after.status).toBe(TransferStatus.PENDING);
    });
  });

  describe('authorization boundary', () => {
    it('is internal-only and excludes CUSTOMER principals', () => {
      const registry = new RoutePolicyRegistry();
      const resolution = registry.resolve({ method: 'GET', url: '/api/v1/transfers' });

      expect(resolution.public).toBe(false);
      expect(resolution.policy?.requiredScopes).toEqual(['internal:access']);
      expect(resolution.policy?.allowedPrincipalTypes).not.toContain('CUSTOMER');
      expect(resolution.policy?.customerAccess).toBe('NONE');
    });
  });
});
