import { UnprocessableEntityException } from '@nestjs/common';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  ObjectLiteral,
  Repository,
} from 'typeorm';

import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import type { PostJournalCommand } from '../src/ledger/ledger.types';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletStatus } from '../src/wallet/wallet.enums';
import { Transfer } from '../src/transfer/transfer.entity';
import { TransferDirection, TransferStatus } from '../src/transfer/transfer.enums';
import type { LedgerService } from '../src/ledger/ledger.service';
import { TransferService } from '../src/transfer/transfer.service';
import type { CreateTransferCommand } from '../src/transfer/transfer.types';

const SOURCE_WALLET_ID = '00000000-0000-4000-8000-000000000001';
const DESTINATION_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const SOURCE_LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000011';
const DESTINATION_LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000012';

class InMemoryTransferRepository {
  readonly records = new Map<string, Transfer>();
  private clock = 0;

  create(input: DeepPartial<Transfer>): Transfer {
    return input as Transfer;
  }

  save(entity: Transfer): Promise<Transfer> {
    if (!entity.createdAt) {
      entity.createdAt = new Date(1_000 + this.clock);
      this.clock += 1;
    }
    this.records.set(entity.id, entity);
    return Promise.resolve(entity);
  }

  findOne(options: FindOneOptions<Transfer>): Promise<Transfer | null> {
    const where = options.where;
    if (!where || Array.isArray(where)) {
      return Promise.resolve(null);
    }

    const conditions = where;
    if (typeof conditions.id === 'string') {
      return Promise.resolve(this.records.get(conditions.id) ?? null);
    }
    if (typeof conditions.idempotencyKey === 'string') {
      return Promise.resolve(
        [...this.records.values()].find(
          (record) => record.idempotencyKey === conditions.idempotencyKey,
        ) ?? null,
      );
    }

    return Promise.resolve(null);
  }

  findAndCount(options: FindManyOptions<Transfer>): Promise<[Transfer[], number]> {
    const where = options.where;
    const conditions = Array.isArray(where) ? where : where ? [where] : [];
    const records = [...this.records.values()].filter((record) =>
      conditions.some((condition) => {
        const candidate = condition;
        return (
          candidate.sourceWalletId === record.sourceWalletId ||
          candidate.destinationWalletId === record.destinationWalletId
        );
      }),
    );
    records.sort((left, right) => {
      const createdDifference = right.createdAt.getTime() - left.createdAt.getTime();
      return createdDifference || right.id.localeCompare(left.id);
    });

    const skip = options.skip ?? 0;
    const take = options.take ?? records.length;
    return Promise.resolve([records.slice(skip, skip + take), records.length]);
  }
}

interface WalletQueryBuilder {
  where(condition: string, parameters: Record<string, string[]>): WalletQueryBuilder;
  orderBy(column: string, direction: 'ASC' | 'DESC'): WalletQueryBuilder;
  setLock(mode: 'pessimistic_write'): WalletQueryBuilder;
  getMany(): Promise<WalletAccount[]>;
}

class InMemoryWalletRepository {
  readonly wallets = new Map<string, WalletAccount>();

  findOne(options: FindOneOptions<WalletAccount>): Promise<WalletAccount | null> {
    const where = options.where;
    if (!where || Array.isArray(where) || typeof where.id !== 'string') {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.wallets.get(where.id) ?? null);
  }

  createQueryBuilder(): WalletQueryBuilder {
    const builder: WalletQueryBuilder = {
      where: (_condition, parameters) => {
        const requestedIds = new Set(parameters.walletIds);
        builder.getMany = () =>
          Promise.resolve(
            [...this.wallets.values()].filter((wallet) => requestedIds.has(wallet.id)),
          );
        return builder;
      },
      orderBy: () => builder,
      setLock: () => builder,
      getMany: () => Promise.resolve([...this.wallets.values()]),
    };
    return builder;
  }
}

class InMemoryJournalRepository {
  readonly records = new Map<string, LedgerJournal>();

  findOne(options: FindOneOptions<LedgerJournal>): Promise<LedgerJournal | null> {
    const where = options.where;
    if (!where || Array.isArray(where) || typeof where.id !== 'string') {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.records.get(where.id) ?? null);
  }

  add(id: string, reference: string | undefined): void {
    const journal = Object.assign(new LedgerJournal(), {
      id,
      reference: reference ?? null,
    });
    this.records.set(id, journal);
  }
}

class InMemoryManager {
  constructor(
    private readonly transferRepository: InMemoryTransferRepository,
    private readonly walletRepository: InMemoryWalletRepository,
    private readonly journalRepository: InMemoryJournalRepository,
  ) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    if (target === Transfer) {
      return this.transferRepository as unknown as Repository<T>;
    }
    if (target === WalletAccount) {
      return this.walletRepository as unknown as Repository<T>;
    }
    if (target === LedgerJournal) {
      return this.journalRepository as unknown as Repository<T>;
    }

    throw new Error('Unexpected repository requested by transfer test');
  }
}

interface InMemorySnapshot {
  transfers: Map<string, Transfer>;
  journals: Map<string, LedgerJournal>;
  balances: Map<string, bigint>;
}

class InMemoryDataSource {
  readonly isolationLevels: string[] = [];
  timeoutAfterCommitOnce = false;

  constructor(
    private readonly manager: InMemoryManager,
    private readonly snapshotState: () => InMemorySnapshot,
    private readonly restoreState: (snapshot: InMemorySnapshot) => void,
  ) {}

  async transaction<T>(
    isolationLevel: string,
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    this.isolationLevels.push(isolationLevel);
    const snapshot = this.snapshotState();
    let committed = false;
    try {
      const result = await callback(this.manager as unknown as EntityManager);
      committed = true;
      if (this.timeoutAfterCommitOnce) {
        this.timeoutAfterCommitOnce = false;
        throw new Error('simulated client timeout after commit');
      }
      return result;
    } catch (error) {
      if (!committed) {
        this.restoreState(snapshot);
      }
      throw error;
    }
  }
}

class InMemoryLedgerService {
  readonly calls: PostJournalCommand[] = [];
  failAfterMutation = false;

  constructor(
    readonly balances: Map<string, bigint>,
    private readonly journalRepository: InMemoryJournalRepository,
  ) {}

  postJournalInTransaction(_manager: EntityManager, command: PostJournalCommand): Promise<string> {
    this.calls.push(command);
    const sourceLine = command.lines.find((line) => line.direction === LedgerEntryDirection.DEBIT);
    const destinationLine = command.lines.find(
      (line) => line.direction === LedgerEntryDirection.CREDIT,
    );
    if (!sourceLine || !destinationLine) {
      throw new Error('Test journal was not double-entry');
    }

    const sourceBalance = this.balances.get(sourceLine.accountId) ?? 0n;
    const amount = BigInt(sourceLine.amountMinor);
    if (sourceBalance < amount) {
      throw new UnprocessableEntityException('Insufficient wallet balance');
    }

    this.balances.set(sourceLine.accountId, sourceBalance - amount);
    this.balances.set(
      destinationLine.accountId,
      (this.balances.get(destinationLine.accountId) ?? 0n) + BigInt(destinationLine.amountMinor),
    );
    const journalId = '00000000-0000-4000-8000-000000000099';
    this.journalRepository.add(journalId, command.reference);
    if (this.failAfterMutation) {
      throw new Error('simulated journal persistence failure');
    }
    return Promise.resolve(journalId);
  }
}

interface Fixture {
  service: TransferService;
  transfers: InMemoryTransferRepository;
  wallets: InMemoryWalletRepository;
  journals: InMemoryJournalRepository;
  ledger: InMemoryLedgerService;
  dataSource: InMemoryDataSource;
}

function makeWallet(
  id: string,
  ledgerAccountId: string,
  currency = 'NGN',
  status = WalletStatus.ACTIVE,
): WalletAccount {
  return Object.assign(new WalletAccount(), {
    id,
    ledgerAccountId,
    currency,
    status,
    customerId: `customer-${id}`,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

function makeFixture(sourceBalance = 125000n, destinationCurrency = 'NGN'): Fixture {
  const transfers = new InMemoryTransferRepository();
  const wallets = new InMemoryWalletRepository();
  const journals = new InMemoryJournalRepository();
  wallets.wallets.set(SOURCE_WALLET_ID, makeWallet(SOURCE_WALLET_ID, SOURCE_LEDGER_ACCOUNT_ID));
  wallets.wallets.set(
    DESTINATION_WALLET_ID,
    makeWallet(DESTINATION_WALLET_ID, DESTINATION_LEDGER_ACCOUNT_ID, destinationCurrency),
  );
  const manager = new InMemoryManager(transfers, wallets, journals);
  const ledger = new InMemoryLedgerService(
    new Map([
      [SOURCE_LEDGER_ACCOUNT_ID, sourceBalance],
      [DESTINATION_LEDGER_ACCOUNT_ID, 0n],
    ]),
    journals,
  );
  const dataSource = new InMemoryDataSource(
    manager,
    () => ({
      transfers: new Map(
        [...transfers.records].map(([id, transfer]) => [
          id,
          Object.assign(new Transfer(), transfer),
        ]),
      ),
      journals: new Map(
        [...journals.records].map(([id, journal]) => [
          id,
          Object.assign(new LedgerJournal(), journal),
        ]),
      ),
      balances: new Map(ledger.balances),
    }),
    (snapshot) => {
      transfers.records.clear();
      for (const [id, transfer] of snapshot.transfers) {
        transfers.records.set(id, transfer);
      }
      journals.records.clear();
      for (const [id, journal] of snapshot.journals) {
        journals.records.set(id, journal);
      }
      ledger.balances.clear();
      for (const [id, balance] of snapshot.balances) {
        ledger.balances.set(id, balance);
      }
    },
  );
  const service = new TransferService(
    transfers as unknown as Repository<Transfer>,
    wallets as unknown as Repository<WalletAccount>,
    journals as unknown as Repository<LedgerJournal>,
    dataSource as unknown as DataSource,
    ledger as unknown as LedgerService,
  );

  return { service, transfers, wallets, journals, ledger, dataSource };
}

function transferCommand(overrides: Partial<CreateTransferCommand> = {}): CreateTransferCommand {
  return {
    sourceWalletId: SOURCE_WALLET_ID,
    destinationWalletId: DESTINATION_WALLET_ID,
    amountMinor: '50000',
    currency: 'NGN',
    idempotencyKey: 'transfer-test-1',
    reference: 'test-reference',
    narration: 'test narration',
    ...overrides,
  };
}

describe('TransferService', () => {
  it('executes a successful transfer in a SERIALIZABLE transaction', async () => {
    const fixture = makeFixture();

    const result = await fixture.service.createTransfer(transferCommand());

    expect(result).toMatchObject({
      status: TransferStatus.COMPLETED,
      sourceWalletId: SOURCE_WALLET_ID,
      destinationWalletId: DESTINATION_WALLET_ID,
      amountMinor: '50000',
      journalId: '00000000-0000-4000-8000-000000000099',
      journalReference: 'test-reference',
    });
    expect(fixture.dataSource.isolationLevels).toEqual(['SERIALIZABLE']);
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('rejects an insufficient-funds transfer without creating a journal', async () => {
    const fixture = makeFixture(10n);

    await expect(fixture.service.createTransfer(transferCommand())).rejects.toMatchObject({
      status: 422,
    });
    expect(fixture.ledger.calls).toHaveLength(1);
    expect(fixture.journals.records.size).toBe(0);
    expect([...fixture.transfers.records.values()][0]).toMatchObject({
      status: TransferStatus.FAILED,
    });
  });

  it('returns the original result for an identical idempotent request', async () => {
    const fixture = makeFixture();

    const first = await fixture.service.createTransfer(transferCommand());
    const second = await fixture.service.createTransfer(transferCommand());

    expect(second.id).toBe(first.id);
    expect(fixture.transfers.records.size).toBe(1);
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('returns the committed result after a client timeout', async () => {
    const fixture = makeFixture();
    fixture.dataSource.timeoutAfterCommitOnce = true;

    await expect(fixture.service.createTransfer(transferCommand())).rejects.toThrow(
      'simulated client timeout after commit',
    );
    const retry = await fixture.service.createTransfer(transferCommand());

    expect(retry.status).toBe(TransferStatus.COMPLETED);
    expect(fixture.transfers.records.size).toBe(1);
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('rejects a changed payload that reuses an idempotency key', async () => {
    const fixture = makeFixture();
    await fixture.service.createTransfer(transferCommand());

    await expect(
      fixture.service.createTransfer(transferCommand({ amountMinor: '50001' })),
    ).rejects.toMatchObject({ status: 409 });
    expect(fixture.transfers.records.size).toBe(1);
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('rejects self-transfers', async () => {
    const fixture = makeFixture();

    await expect(
      fixture.service.createTransfer(transferCommand({ destinationWalletId: SOURCE_WALLET_ID })),
    ).rejects.toMatchObject({ status: 400 });
    expect(fixture.ledger.calls).toHaveLength(0);
  });

  it('rejects currency mismatches and preserves the failed transfer outcome', async () => {
    const fixture = makeFixture(125000n, 'USD');

    await expect(fixture.service.createTransfer(transferCommand())).rejects.toMatchObject({
      status: 409,
    });
    expect([...fixture.transfers.records.values()][0]).toMatchObject({
      status: TransferStatus.FAILED,
    });
  });

  it('rejects a missing wallet', async () => {
    const fixture = makeFixture();

    await expect(
      fixture.service.createTransfer(
        transferCommand({ sourceWalletId: '00000000-0000-4000-8000-000000000003' }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(fixture.transfers.records.size).toBe(0);
  });

  it('rejects a suspended wallet', async () => {
    const fixture = makeFixture();
    const sourceWallet = fixture.wallets.wallets.get(SOURCE_WALLET_ID)!;
    sourceWallet.status = WalletStatus.SUSPENDED;

    await expect(fixture.service.createTransfer(transferCommand())).rejects.toMatchObject({
      status: 409,
    });
    expect([...fixture.transfers.records.values()][0]).toMatchObject({
      status: TransferStatus.FAILED,
    });
  });

  it('rejects a closed wallet', async () => {
    const fixture = makeFixture();
    const destinationWallet = fixture.wallets.wallets.get(DESTINATION_WALLET_ID)!;
    destinationWallet.status = WalletStatus.CLOSED;

    await expect(fixture.service.createTransfer(transferCommand())).rejects.toMatchObject({
      status: 409,
    });
    expect([...fixture.transfers.records.values()][0]).toMatchObject({
      status: TransferStatus.FAILED,
    });
  });

  it('rolls back transfer and ledger state after an interrupted journal creation', async () => {
    const fixture = makeFixture();
    fixture.ledger.failAfterMutation = true;

    await expect(fixture.service.createTransfer(transferCommand())).rejects.toThrow(
      'simulated journal persistence failure',
    );
    expect(fixture.transfers.records.size).toBe(0);
    expect(fixture.journals.records.size).toBe(0);
    expect(fixture.ledger.balances.get(SOURCE_LEDGER_ACCOUNT_ID)).toBe(125000n);
    expect(fixture.ledger.balances.get(DESTINATION_LEDGER_ACCOUNT_ID)).toBe(0n);

    fixture.ledger.failAfterMutation = false;
    const recovered = await fixture.service.createTransfer(transferCommand());
    expect(recovered.status).toBe(TransferStatus.COMPLETED);
    expect(fixture.transfers.records.size).toBe(1);
    expect(fixture.journals.records.size).toBe(1);
  });

  it('allows only one of two concurrent attempts to spend the same balance', async () => {
    const fixture = makeFixture(50000n);

    const outcomes = await Promise.allSettled([
      fixture.service.createTransfer(transferCommand({ idempotencyKey: 'concurrent-transfer-1' })),
      fixture.service.createTransfer(transferCommand({ idempotencyKey: 'concurrent-transfer-2' })),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(fixture.ledger.balances.get(SOURCE_LEDGER_ACCOUNT_ID)).toBe(0n);
    expect(fixture.ledger.balances.get(DESTINATION_LEDGER_ACCOUNT_ID)).toBe(50000n);
    expect(fixture.dataSource.isolationLevels).toEqual(['SERIALIZABLE', 'SERIALIZABLE']);
  });

  it('returns newest-first sent and received transaction history with pagination', async () => {
    const fixture = makeFixture();
    await fixture.service.createTransfer(transferCommand());
    await fixture.service.createTransfer(
      transferCommand({
        amountMinor: '25000',
        idempotencyKey: 'transfer-test-2',
        sourceWalletId: DESTINATION_WALLET_ID,
        destinationWalletId: SOURCE_WALLET_ID,
      }),
    );

    const sourceHistory = await fixture.service.getWalletTransactions(SOURCE_WALLET_ID, 1, 1);
    const destinationHistory = await fixture.service.getWalletTransactions(
      DESTINATION_WALLET_ID,
      1,
      20,
    );

    expect(sourceHistory.pagination).toMatchObject({ total: 2, totalPages: 2, hasNextPage: true });
    expect(sourceHistory.items[0]).toMatchObject({
      direction: TransferDirection.RECEIVED,
      amountMinor: '25000',
    });
    expect(destinationHistory.items[0]).toMatchObject({
      direction: TransferDirection.SENT,
      amountMinor: '25000',
    });
    expect(destinationHistory.items[1]).toMatchObject({
      direction: TransferDirection.RECEIVED,
      amountMinor: '50000',
    });
  });
});
