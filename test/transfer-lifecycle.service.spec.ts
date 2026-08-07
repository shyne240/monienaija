import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type {
  DeepPartial,
  EntityManager,
  EntityTarget,
  FindOneOptions,
  ObjectLiteral,
  Repository,
  DataSource,
} from 'typeorm';

import type { AuditService } from '../src/operations/audit.service';
import type { IdempotencyService } from '../src/operations/idempotency.service';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import type { LedgerService } from '../src/ledger/ledger.service';
import type { LedgerJournalView, PostJournalCommand } from '../src/ledger/ledger.types';
import { Transfer } from '../src/transfer/transfer.entity';
import { TransferFailureCode, TransferStatus } from '../src/transfer/transfer.enums';
import { TransferLifecycleService } from '../src/transfer/transfer-lifecycle.service';
import type {
  CreateTransferLifecycleCommand,
  TransferLifecycleRequestContext,
  TransitionTransferLifecycleCommand,
} from '../src/transfer/transfer-lifecycle.types';

const SOURCE_CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const DESTINATION_CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const SOURCE_CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000003';
const DESTINATION_CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000004';
const SOURCE_BINDING_ID = '00000000-0000-4000-8000-000000000005';
const DESTINATION_BINDING_ID = '00000000-0000-4000-8000-000000000006';
const SOURCE_WALLET_ID = '00000000-0000-4000-8000-000000000007';
const DESTINATION_WALLET_ID = '00000000-0000-4000-8000-000000000008';
const SOURCE_LEDGER_ID = '00000000-0000-4000-8000-000000000009';
const DESTINATION_LEDGER_ID = '00000000-0000-4000-8000-000000000010';
const COMMAND_ID = '00000000-0000-4000-8000-000000000011';
const JOURNAL_ID = '00000000-0000-4000-8000-000000000012';
const REQUESTED_AT = '2026-08-07T10:00:00.000Z';

class InMemoryTransferRepository {
  readonly records = new Map<string, Transfer>();
  private clock = 0;

  create(input: DeepPartial<Transfer>): Transfer {
    return Object.assign(new Transfer(), input);
  }

  save(entity: Transfer): Promise<Transfer> {
    const existing = this.records.get(entity.id);
    if (!existing) {
      entity.version = entity.version ?? 1;
      entity.createdAt = entity.createdAt ?? new Date(1_000 + this.clock);
      entity.updatedAt = entity.updatedAt ?? entity.createdAt;
      this.clock += 1;
    } else {
      entity.version = existing.version + 1;
      entity.updatedAt = new Date(2_000 + this.clock);
      this.clock += 1;
    }
    this.records.set(entity.id, entity);
    return Promise.resolve(entity);
  }

  findOne(options: FindOneOptions<Transfer>): Promise<Transfer | null> {
    const where = options.where;
    if (!where || Array.isArray(where)) return Promise.resolve(null);
    if (typeof where.id === 'string') return Promise.resolve(this.records.get(where.id) ?? null);
    if (typeof where.commandId === 'string') {
      return Promise.resolve(
        [...this.records.values()].find((record) => record.commandId === where.commandId) ?? null,
      );
    }
    return Promise.resolve(null);
  }

  createQueryBuilder(): {
    where: (condition: string, parameters: Record<string, string>) => unknown;
    setLock: (mode: 'pessimistic_write') => unknown;
    getOne: () => Promise<Transfer | null>;
  } {
    let transferId: string | undefined;
    const builder = {
      where: (_condition: string, parameters: Record<string, string>) => {
        transferId = parameters.transferId;
        return builder;
      },
      setLock: () => builder,
      getOne: () => Promise.resolve(transferId ? (this.records.get(transferId) ?? null) : null),
    };
    return builder;
  }
}

class InMemoryLedgerAccountRepository {
  readonly accounts = new Map<string, LedgerAccount>();
  readonly lockOrders: string[][] = [];

  createQueryBuilder(): {
    where: (condition: string, parameters: { accountIds: string[] }) => unknown;
    orderBy: (column: string, direction: 'ASC' | 'DESC') => unknown;
    setLock: (mode: 'pessimistic_write') => unknown;
    getMany: () => Promise<LedgerAccount[]>;
  } {
    let requestedIds: string[] = [];
    const builder = {
      where: (_condition: string, parameters: { accountIds: string[] }) => {
        requestedIds = parameters.accountIds;
        return builder;
      },
      orderBy: () => builder,
      setLock: () => builder,
      getMany: () => {
        this.lockOrders.push([...requestedIds]);
        return Promise.resolve(
          requestedIds
            .map((id) => this.accounts.get(id))
            .filter((account): account is LedgerAccount => account !== undefined),
        );
      },
    };
    return builder;
  }
}

class FakeLedgerService {
  readonly calls: PostJournalCommand[] = [];
  readonly journals = new Map<string, LedgerJournalView>();
  failure: Error | null = null;

  postJournalInTransaction(_manager: EntityManager, command: PostJournalCommand): Promise<string> {
    this.calls.push(command);
    if (this.failure) return Promise.reject(this.failure);
    this.journals.set(JOURNAL_ID, {
      id: JOURNAL_ID,
      idempotencyKey: command.idempotencyKey,
      currency: command.currency,
      accountingUnit: command.accountingUnit ?? 'CUSTOMER_FUNDS',
      status: 'POSTED',
      reference: command.reference ?? null,
      description: command.description ?? null,
      correlationId: command.correlationId ?? null,
      reversalOfJournalId: null,
      metadata: command.metadata ?? {},
      totalMinor: String(command.lines[0]?.amountMinor ?? '0'),
      createdAt: new Date(),
      postedAt: new Date(),
      lines: command.lines.map((line, index) => ({
        id: `line-${index + 1}`,
        journalId: JOURNAL_ID,
        accountId: line.accountId,
        lineNumber: index + 1,
        direction: line.direction,
        amountMinor: String(line.amountMinor),
        currency: command.currency,
        accountingUnit: command.accountingUnit ?? 'CUSTOMER_FUNDS',
        createdAt: new Date(),
      })),
    });
    return Promise.resolve(JOURNAL_ID);
  }

  getJournal(journalId: string): Promise<LedgerJournalView> {
    const journal = this.journals.get(journalId);
    return journal ? Promise.resolve(journal) : Promise.reject(new Error('journal not found'));
  }
}

class InMemoryManager {
  constructor(
    private readonly transfers: InMemoryTransferRepository,
    private readonly ledgerAccounts: InMemoryLedgerAccountRepository,
  ) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    if (target === Transfer) return this.transfers as unknown as Repository<T>;
    if (target === LedgerAccount) return this.ledgerAccounts as unknown as Repository<T>;
    throw new Error('Unexpected repository requested by lifecycle test');
  }
}

class InMemoryDataSource {
  readonly isolationLevels: string[] = [];
  readonly queuedErrors: unknown[] = [];
  timeoutAfterCommitOnce = false;

  constructor(private readonly manager: InMemoryManager) {}

  async transaction<T>(
    isolationLevel: string,
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    this.isolationLevels.push(isolationLevel);
    const queuedError = this.queuedErrors.shift();
    if (queuedError instanceof Error) throw queuedError;
    if (queuedError) throw new Error('queued transaction failure');
    const result = await callback(this.manager as unknown as EntityManager);
    if (this.timeoutAfterCommitOnce) {
      this.timeoutAfterCommitOnce = false;
      throw new Error('simulated commit timeout');
    }
    return result;
  }
}

class FakeAuditService {
  readonly events: Array<Record<string, unknown>> = [];

  record(
    _manager: EntityManager,
    command: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.events.push(command);
    return Promise.resolve(command);
  }
}

class FakeIdempotencyService {
  readonly records = new Map<
    string,
    {
      id: string;
      key: string;
      requestHash: string;
      status: 'IN_PROGRESS' | 'COMPLETED';
      resourceId: string | null;
      responseBody: Record<string, unknown> | null;
    }
  >();
  completeCalls = 0;
  private sequence = 0;

  reserve(
    _manager: EntityManager,
    command: { scope: string; key: string; requestHash: string },
  ): Promise<{
    kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS';
    record: {
      id: string;
      idempotencyKey: string;
      requestHash: string;
      status: 'IN_PROGRESS' | 'COMPLETED';
      resourceId: string | null;
      responseBody: Record<string, unknown> | null;
    };
  }> {
    const mapKey = `${command.scope}:${command.key}`;
    const existing = this.records.get(mapKey);
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        return Promise.reject(new ConflictException('The idempotency key was reused'));
      }
      const record = {
        ...existing,
        idempotencyKey: existing.key,
        responseBody: existing.responseBody,
      };
      if (existing.status === 'IN_PROGRESS')
        return Promise.resolve({ kind: 'IN_PROGRESS', record });
      return Promise.resolve({ kind: 'REPLAY', record });
    }
    this.sequence += 1;
    const record = {
      id: `reservation-${this.sequence}`,
      key: command.key,
      idempotencyKey: command.key,
      requestHash: command.requestHash,
      status: 'IN_PROGRESS' as const,
      resourceId: null,
      responseBody: null,
    };
    this.records.set(mapKey, record);
    return Promise.resolve({ kind: 'NEW', record });
  }

  complete(
    _manager: EntityManager,
    recordId: string,
    command: { resourceId?: string; responseBody: Record<string, unknown> },
  ): Promise<void> {
    const record = [...this.records.values()].find((candidate) => candidate.id === recordId);
    if (!record) return Promise.reject(new Error('Idempotency record not found'));
    record.status = 'COMPLETED';
    record.resourceId = command.resourceId ?? null;
    record.responseBody = command.responseBody;
    this.completeCalls += 1;
    return Promise.resolve();
  }
}

interface Fixture {
  service: TransferLifecycleService;
  transfers: InMemoryTransferRepository;
  ledgerAccounts: InMemoryLedgerAccountRepository;
  ledger: FakeLedgerService;
  dataSource: InMemoryDataSource;
  audit: FakeAuditService;
  idempotency: FakeIdempotencyService;
}

const requestContext: TransferLifecycleRequestContext = {
  requestId: 'request-transfer-lifecycle-1',
  correlationId: 'correlation-transfer-lifecycle-1',
  traceId: 'trace-transfer-lifecycle-1',
};

function makeLedgerAccount(id: string, overrides: Partial<LedgerAccount> = {}): LedgerAccount {
  return Object.assign(new LedgerAccount(), {
    id,
    code: `ACCOUNT-${id.slice(-4)}`,
    name: 'Customer funds account',
    accountType: LedgerAccountType.LIABILITY,
    normalBalance: LedgerNormalBalance.CREDIT,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    allowNegativeBalance: false,
    isActive: true,
    ...overrides,
  });
}

function makeFixture(): Fixture {
  const transfers = new InMemoryTransferRepository();
  const ledgerAccounts = new InMemoryLedgerAccountRepository();
  ledgerAccounts.accounts.set(SOURCE_LEDGER_ID, makeLedgerAccount(SOURCE_LEDGER_ID));
  ledgerAccounts.accounts.set(DESTINATION_LEDGER_ID, makeLedgerAccount(DESTINATION_LEDGER_ID));
  const ledger = new FakeLedgerService();
  const dataSource = new InMemoryDataSource(new InMemoryManager(transfers, ledgerAccounts));
  const audit = new FakeAuditService();
  const idempotency = new FakeIdempotencyService();
  const service = new TransferLifecycleService(
    transfers as unknown as Repository<Transfer>,
    dataSource as unknown as DataSource,
    ledger as unknown as LedgerService,
    audit as unknown as AuditService,
    idempotency as unknown as IdempotencyService,
  );
  return { service, transfers, ledgerAccounts, ledger, dataSource, audit, idempotency };
}

function makeCreateCommand(
  overrides: Partial<CreateTransferLifecycleCommand> = {},
): CreateTransferLifecycleCommand {
  return {
    contractVersion: 1,
    commandType: 'INTERNAL_TRANSFER',
    commandId: COMMAND_ID,
    capability: 'wallet.transfer',
    action: 'create',
    scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
    sourceCustomerId: SOURCE_CUSTOMER_ID,
    destinationCustomerId: DESTINATION_CUSTOMER_ID,
    sourceCustomerWalletId: SOURCE_CUSTOMER_WALLET_ID,
    destinationCustomerWalletId: DESTINATION_CUSTOMER_WALLET_ID,
    sourceBindingId: SOURCE_BINDING_ID,
    destinationBindingId: DESTINATION_BINDING_ID,
    sourceBindingVersion: 1,
    destinationBindingVersion: 1,
    sourceWalletAccountId: SOURCE_WALLET_ID,
    destinationWalletAccountId: DESTINATION_WALLET_ID,
    sourceLedgerAccountId: SOURCE_LEDGER_ID,
    destinationLedgerAccountId: DESTINATION_LEDGER_ID,
    amountMinor: '10000',
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    idempotencyScope: 'wallet.transfer.create.v1',
    idempotencyKey: 'transfer-lifecycle-1',
    requestHash: 'a'.repeat(64),
    authorizationContextReference: 'a2-auth-context-1',
    policyDecisionReference: 'a4-decision-transfer-1',
    policyVersion: 'a4.profile.wallet-transfer-create.v1',
    policyProfileReference: 'profile.wallet-transfer-create.v1',
    policyProfileVersion: 1,
    policySnapshotReference: 'a4-snapshot-transfer-1',
    policyInputHash: 'b'.repeat(64),
    requestedAt: REQUESTED_AT,
    requestContext,
    reference: 'business-reference',
    narration: 'lifecycle metadata',
    ...overrides,
  };
}

function makeTransition(
  nextStatus: TransferStatus,
  overrides: Partial<TransitionTransferLifecycleCommand> = {},
): TransitionTransferLifecycleCommand {
  return {
    transferId: '00000000-0000-4000-8000-000000000099',
    nextStatus,
    idempotencyKey: `state-${nextStatus.toLowerCase()}`,
    requestContext,
    ...overrides,
  };
}

async function createPending(fixture: Fixture): Promise<string> {
  const result = await fixture.service.createPending(makeCreateCommand());
  return result.id;
}

async function prepareProcessing(fixture: Fixture): Promise<string> {
  const transferId = await createPending(fixture);
  await fixture.service.transition(
    transferId,
    makeTransition(TransferStatus.PROCESSING, {
      transferId,
      idempotencyKey: 'state-processing-for-ledger',
    }),
  );
  return transferId;
}

function postCommand(idempotencyKey = 'ledger-post-1') {
  return {
    idempotencyKey,
    requestContext,
  };
}

function transactionFailure(code: '40001' | '40P01'): QueryFailedError {
  const driverError = Object.assign(new Error('serialization/deadlock failure'), { code });
  return new QueryFailedError('serialization/deadlock failure', [], driverError);
}

describe('TransferLifecycleService', () => {
  it('persists a pending metadata record without invoking financial execution', async () => {
    const fixture = makeFixture();

    const result = await fixture.service.createPending(makeCreateCommand());

    expect(result).toMatchObject({
      status: TransferStatus.PENDING,
      commandId: COMMAND_ID,
      sourceCustomerId: SOURCE_CUSTOMER_ID,
      destinationCustomerId: DESTINATION_CUSTOMER_ID,
      sourceBindingId: SOURCE_BINDING_ID,
      destinationBindingId: DESTINATION_BINDING_ID,
      sourceLedgerAccountId: SOURCE_LEDGER_ID,
      destinationLedgerAccountId: DESTINATION_LEDGER_ID,
      amountMinor: '10000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      journalId: null,
      paymentReference: null,
      idempotencyReplay: false,
    });
    expect(fixture.transfers.records.size).toBe(1);
    expect(fixture.dataSource.isolationLevels).toEqual(['SERIALIZABLE']);
    expect(fixture.audit.events[0]).toMatchObject({ action: 'METADATA_CREATED' });
    expect(fixture.idempotency.completeCalls).toBe(1);
  });

  it('enforces the pending, processing, recovery, unknown, and completed lifecycle', async () => {
    const fixture = makeFixture();
    const transferId = await createPending(fixture);

    const processing = await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.PROCESSING, { transferId }),
    );
    expect(processing.status).toBe(TransferStatus.PROCESSING);

    const pendingRecovery = await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.PENDING_RECOVERY, {
        transferId,
        idempotencyKey: 'state-recovery-1',
        recoveryReference: 'recovery-1',
      }),
    );
    expect(pendingRecovery.status).toBe(TransferStatus.PENDING_RECOVERY);
    expect(pendingRecovery.recoveryReference).toBe('recovery-1');

    const unknown = await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.UNKNOWN, {
        transferId,
        idempotencyKey: 'state-unknown-1',
        reason: 'commit outcome cannot be verified',
      }),
    );
    expect(unknown).toMatchObject({
      status: TransferStatus.UNKNOWN,
      recoveryReference: 'recovery-1',
      failureCode: TransferFailureCode.UNKNOWN_OUTCOME,
    });

    const completed = await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.COMPLETED, {
        transferId,
        idempotencyKey: 'state-completed-1',
        journalId: JOURNAL_ID,
      }),
    );
    expect(completed).toMatchObject({
      status: TransferStatus.COMPLETED,
      journalId: JOURNAL_ID,
      recoveryReference: 'recovery-1',
    });
    expect(completed.completedAt).toBeInstanceOf(Date);
  });

  it('rejects invalid transitions and preserves the prior state', async () => {
    const fixture = makeFixture();
    const transferId = await createPending(fixture);

    await expect(
      fixture.service.transition(
        transferId,
        makeTransition(TransferStatus.COMPLETED, {
          transferId,
          idempotencyKey: 'state-invalid-completed-1',
          journalId: JOURNAL_ID,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await fixture.service.get(transferId)).status).toBe(TransferStatus.PENDING);

    await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.PROCESSING, {
        transferId,
        idempotencyKey: 'state-processing-1',
      }),
    );
    await expect(
      fixture.service.transition(
        transferId,
        makeTransition(TransferStatus.CANCELLED, {
          transferId,
          idempotencyKey: 'state-invalid-cancel-1',
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await fixture.service.get(transferId)).status).toBe(TransferStatus.PROCESSING);
  });

  it('rejects a stale optimistic lifecycle version without changing state', async () => {
    const fixture = makeFixture();
    const transferId = await createPending(fixture);

    await expect(
      fixture.service.transition(
        transferId,
        makeTransition(TransferStatus.PROCESSING, {
          transferId,
          idempotencyKey: 'state-stale-version-1',
          expectedVersion: 99,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await fixture.service.get(transferId)).status).toBe(TransferStatus.PENDING);
  });

  it('requires recovery evidence before entering an unknown outcome', async () => {
    const fixture = makeFixture();
    const transferId = await createPending(fixture);
    await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.PROCESSING, {
        transferId,
        idempotencyKey: 'state-processing-2',
      }),
    );

    await expect(
      fixture.service.transition(
        transferId,
        makeTransition(TransferStatus.UNKNOWN, {
          transferId,
          idempotencyKey: 'state-unknown-without-ref',
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await fixture.service.get(transferId)).status).toBe(TransferStatus.PROCESSING);

    const unknown = await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.UNKNOWN, {
        transferId,
        idempotencyKey: 'state-unknown-2',
        recoveryReference: 'recovery-2',
      }),
    );
    expect(unknown.recoveryReference).toBe('recovery-2');
  });

  it('keeps command identity and correlation metadata unchanged across transitions', async () => {
    const fixture = makeFixture();
    const transferId = await createPending(fixture);
    const before = await fixture.service.get(transferId);

    await fixture.service.transition(
      transferId,
      makeTransition(TransferStatus.PROCESSING, {
        transferId,
        idempotencyKey: 'state-processing-3',
      }),
    );
    const after = await fixture.service.get(transferId);

    expect(after).toMatchObject({
      commandId: before.commandId,
      sourceCustomerId: before.sourceCustomerId,
      destinationCustomerId: before.destinationCustomerId,
      sourceWalletAccountId: before.sourceWalletAccountId,
      destinationWalletAccountId: before.destinationWalletAccountId,
      sourceLedgerAccountId: before.sourceLedgerAccountId,
      destinationLedgerAccountId: before.destinationLedgerAccountId,
      amountMinor: before.amountMinor,
      currency: before.currency,
      requestHash: before.requestHash,
      requestId: before.requestId,
      correlationId: before.correlationId,
      traceId: before.traceId,
      policyDecisionReference: before.policyDecisionReference,
      policyInputHash: before.policyInputHash,
    });
  });

  it('replays create and transition commands consistently through Operations idempotency', async () => {
    const fixture = makeFixture();
    const command = makeCreateCommand();
    const first = await fixture.service.createPending(command);
    const second = await fixture.service.createPending(command);

    expect(second).toMatchObject({
      id: first.id,
      status: TransferStatus.PENDING,
      idempotencyReplay: true,
    });
    expect(fixture.transfers.records.size).toBe(1);

    const transition = makeTransition(TransferStatus.PROCESSING, {
      transferId: first.id,
      idempotencyKey: 'state-replay-1',
    });
    const transitioned = await fixture.service.transition(first.id, transition);
    await fixture.service.transition(
      first.id,
      makeTransition(TransferStatus.PENDING_RECOVERY, {
        transferId: first.id,
        idempotencyKey: 'state-replay-follow-up',
        recoveryReference: 'replay-recovery-1',
      }),
    );
    const replayed = await fixture.service.transition(first.id, transition);

    expect(replayed).toMatchObject({
      id: transitioned.id,
      status: TransferStatus.PROCESSING,
      idempotencyReplay: true,
    });
    expect(fixture.idempotency.completeCalls).toBe(3);
    expect(fixture.audit.events.map((event) => event.action)).toEqual([
      'METADATA_CREATED',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
    ]);
  });

  it('persists explicit failed and cancelled outcomes without a journal', async () => {
    const failedFixture = makeFixture();
    const failedId = await createPending(failedFixture);
    const failed = await failedFixture.service.transition(
      failedId,
      makeTransition(TransferStatus.FAILED, {
        transferId: failedId,
        idempotencyKey: 'state-failed-1',
        failureCode: TransferFailureCode.POLICY_NOT_EXECUTABLE,
        failureMessage: 'The A4 decision was not executable',
        failureStatusCode: 409,
      }),
    );
    expect(failed).toMatchObject({
      status: TransferStatus.FAILED,
      journalId: null,
      failureCode: TransferFailureCode.POLICY_NOT_EXECUTABLE,
      failureStatusCode: 409,
    });

    const cancelledFixture = makeFixture();
    const cancelledId = await createPending(cancelledFixture);
    const cancelled = await cancelledFixture.service.transition(
      cancelledId,
      makeTransition(TransferStatus.CANCELLED, {
        transferId: cancelledId,
        idempotencyKey: 'state-cancelled-1',
        reason: 'cancelled before execution',
      }),
    );
    expect(cancelled).toMatchObject({
      status: TransferStatus.CANCELLED,
      journalId: null,
      failureCode: TransferFailureCode.TRANSFER_CANCELLED,
    });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
  });

  it('posts one balanced debit and credit journal atomically through Ledger', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);

    const result = await fixture.service.postToLedger(transferId, postCommand());

    expect(result).toMatchObject({
      status: TransferStatus.COMPLETED,
      journalId: JOURNAL_ID,
      sourceLedgerAccountId: SOURCE_LEDGER_ID,
      destinationLedgerAccountId: DESTINATION_LEDGER_ID,
    });
    expect(fixture.ledger.calls).toHaveLength(1);
    const journal = fixture.ledger.calls[0]!;
    expect(journal.lines).toEqual([
      expect.objectContaining({
        accountId: SOURCE_LEDGER_ID,
        direction: LedgerEntryDirection.DEBIT,
        amountMinor: '10000',
      }),
      expect.objectContaining({
        accountId: DESTINATION_LEDGER_ID,
        direction: LedgerEntryDirection.CREDIT,
        amountMinor: '10000',
      }),
    ]);
    const debitTotal = journal.lines
      .filter((line) => line.direction === LedgerEntryDirection.DEBIT)
      .reduce((total, line) => total + BigInt(line.amountMinor), 0n);
    const creditTotal = journal.lines
      .filter((line) => line.direction === LedgerEntryDirection.CREDIT)
      .reduce((total, line) => total + BigInt(line.amountMinor), 0n);
    expect(debitTotal).toBe(creditTotal);
  });

  it('retries serialization failures with the same logical posting command', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);
    fixture.dataSource.isolationLevels.length = 0;
    fixture.dataSource.queuedErrors.push(transactionFailure('40001'), transactionFailure('40001'));

    const result = await fixture.service.postToLedger(
      transferId,
      postCommand('ledger-serialization-1'),
    );

    expect(result.status).toBe(TransferStatus.COMPLETED);
    expect(fixture.dataSource.isolationLevels).toHaveLength(3);
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('retries deadlock failures with bounded attempts', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);
    fixture.dataSource.isolationLevels.length = 0;
    fixture.dataSource.queuedErrors.push(transactionFailure('40P01'));

    const result = await fixture.service.postToLedger(transferId, postCommand('ledger-deadlock-1'));

    expect(result.status).toBe(TransferStatus.COMPLETED);
    expect(fixture.dataSource.isolationLevels).toHaveLength(2);
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('exhausts bounded serialization retries without posting or changing lifecycle state', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);
    fixture.dataSource.isolationLevels.length = 0;
    fixture.dataSource.queuedErrors.push(
      transactionFailure('40001'),
      transactionFailure('40001'),
      transactionFailure('40001'),
    );

    await expect(
      fixture.service.postToLedger(transferId, postCommand('ledger-retry-exhausted-1')),
    ).rejects.toThrow('exhausted 3 bounded transaction attempts');
    expect(fixture.dataSource.isolationLevels).toHaveLength(3);
    expect(fixture.ledger.calls).toHaveLength(0);
    expect((await fixture.service.get(transferId)).status).toBe(TransferStatus.PROCESSING);
  });

  it('verifies a committed post after a commit-timeout error', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);
    fixture.dataSource.timeoutAfterCommitOnce = true;

    const result = await fixture.service.postToLedger(transferId, postCommand('ledger-timeout-1'));

    expect(result).toMatchObject({
      status: TransferStatus.COMPLETED,
      journalId: JOURNAL_ID,
    });
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('persists and deterministically exposes an unknown outcome when durable evidence is absent', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);
    fixture.dataSource.queuedErrors.push(new Error('connection reset before commit'));

    const result = await fixture.service.postToLedger(transferId, postCommand('ledger-unknown-1'));

    expect(result).toMatchObject({
      status: TransferStatus.UNKNOWN,
      journalId: null,
    });
    expect(typeof result.recoveryReference).toBe('string');
    expect(fixture.ledger.calls).toHaveLength(0);
    const recovered = await fixture.service.get(transferId);
    expect(recovered.recoveryReference).toBe(result.recoveryReference);
    await expect(
      fixture.service.postToLedger(transferId, postCommand('ledger-unknown-1')),
    ).rejects.toThrow('already UNKNOWN');
    expect((await fixture.service.get(transferId)).recoveryReference).toBe(
      result.recoveryReference,
    );
  });

  it('rejects a Ledger currency mismatch without posting or completing the transfer', async () => {
    const fixture = makeFixture();
    fixture.ledgerAccounts.accounts.get(DESTINATION_LEDGER_ID)!.currency = 'USD';
    const transferId = await prepareProcessing(fixture);

    const result = await fixture.service.postToLedger(transferId, postCommand('ledger-currency-1'));

    expect(result).toMatchObject({
      status: TransferStatus.FAILED,
      journalId: null,
      failureCode: TransferFailureCode.LEDGER_REJECTED,
    });
    expect(fixture.ledger.calls).toHaveLength(0);
  });

  it('rejects an accounting-unit mismatch without posting', async () => {
    const fixture = makeFixture();
    fixture.ledgerAccounts.accounts.get(SOURCE_LEDGER_ID)!.accountingUnit = 'OTHER_UNIT';
    const transferId = await prepareProcessing(fixture);

    const result = await fixture.service.postToLedger(transferId, postCommand('ledger-unit-1'));

    expect(result.status).toBe(TransferStatus.FAILED);
    expect(result.failureCode).toBe(TransferFailureCode.LEDGER_REJECTED);
    expect(fixture.ledger.calls).toHaveLength(0);
  });

  it('locks source and destination Ledger accounts in deterministic order', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);

    await fixture.service.postToLedger(transferId, postCommand('ledger-lock-1'));

    expect(fixture.ledgerAccounts.lockOrders).toEqual([
      [SOURCE_LEDGER_ID, DESTINATION_LEDGER_ID].sort(),
    ]);
  });

  it('replays an identical Ledger post without creating a second journal effect', async () => {
    const fixture = makeFixture();
    const transferId = await prepareProcessing(fixture);
    const command = postCommand('ledger-replay-1');

    const first = await fixture.service.postToLedger(transferId, command);
    const second = await fixture.service.postToLedger(transferId, command);

    expect(first.journalId).toBe(JOURNAL_ID);
    expect(second).toMatchObject({
      status: TransferStatus.COMPLETED,
      journalId: JOURNAL_ID,
      idempotencyReplay: true,
    });
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('moves an ambiguous Ledger error to an explicit unknown outcome without claiming success', async () => {
    const fixture = makeFixture();
    fixture.ledger.failure = new Error('simulated Ledger transaction failure');
    const transferId = await prepareProcessing(fixture);

    const result = await fixture.service.postToLedger(transferId, postCommand('ledger-failure-1'));

    expect(result.status).toBe(TransferStatus.UNKNOWN);
    expect(result.journalId).toBeNull();
    expect(result.recoveryReference).toEqual(expect.any(String));
    expect(fixture.ledger.calls).toHaveLength(1);
  });
});
