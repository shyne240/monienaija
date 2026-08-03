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

import { Deposit } from '../src/deposit/deposit.entity';
import { DepositService } from '../src/deposit/deposit.service';
import { DepositStatus } from '../src/deposit/deposit.enums';
import type { CreateDepositCommand } from '../src/deposit/deposit.types';
import type { LedgerService } from '../src/ledger/ledger.service';
import type { PostJournalCommand } from '../src/ledger/ledger.types';
import type { PaymentReferenceService } from '../src/payment/payment-reference.service';
import type { SettlementAccountService } from '../src/payment/settlement-account.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletStatus } from '../src/wallet/wallet.enums';
import { Withdrawal } from '../src/withdrawal/withdrawal.entity';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import { WithdrawalStatus } from '../src/withdrawal/withdrawal.enums';
import type { CreateWithdrawalCommand } from '../src/withdrawal/withdrawal.types';

const WALLET_ID = '00000000-0000-4000-8000-000000000001';
const WALLET_LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000101';
const SETTLEMENT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000201';

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private clock = 0;

  create(input: DeepPartial<T>): T {
    return input as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.createdAt) {
      record.createdAt = new Date(1_000 + this.clock);
      this.clock += 1;
    }
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    const where = options.where;
    if (!where || Array.isArray(where)) {
      return Promise.resolve(null);
    }
    const conditions = where as Record<string, unknown>;
    const matching = [...this.records.values()].find((entity) => {
      const record = entity as Record<string, unknown>;
      return Object.entries(conditions).every(([key, value]) => record[key] === value);
    });
    return Promise.resolve(matching ?? null);
  }

  find(options: FindManyOptions<T>): Promise<T[]> {
    const where = options.where;
    const conditions = where && !Array.isArray(where) ? (where as Record<string, unknown>) : {};
    const values = [...this.records.values()].filter((entity) => {
      const record = entity as Record<string, unknown>;
      return Object.entries(conditions).every(([key, value]) => record[key] === value);
    });
    return Promise.resolve(values);
  }

  createQueryBuilder(alias: string): MemoryQueryBuilder<T> {
    return new MemoryQueryBuilder(this.records, alias);
  }
}

class MemoryQueryBuilder<T extends ObjectLiteral> {
  private predicate: (entity: T) => boolean = () => true;

  constructor(
    private readonly records: Map<string, T>,
    private readonly alias: string,
  ) {}

  where(condition: string, parameters: Record<string, string>): MemoryQueryBuilder<T> {
    const parameterName = Object.keys(parameters)[0];
    const parameterValue = parameterName ? parameters[parameterName] : undefined;
    const field = condition.includes('.id') ? 'id' : 'walletId';
    this.predicate = (entity) =>
      String((entity as Record<string, unknown>)[field]) === String(parameterValue);
    return this;
  }

  setLock(mode: 'pessimistic_write'): MemoryQueryBuilder<T> {
    void mode;
    return this;
  }

  getOne(): Promise<T | null> {
    return Promise.resolve([...this.records.values()].find(this.predicate) ?? null);
  }

  getMany(): Promise<T[]> {
    return Promise.resolve([...this.records.values()].filter(this.predicate));
  }
}

class MemoryManager {
  constructor(
    private readonly deposits: MemoryRepository<Deposit>,
    private readonly withdrawals: MemoryRepository<Withdrawal>,
    private readonly wallets: MemoryRepository<WalletAccount>,
  ) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    if (target === Deposit) {
      return this.deposits as unknown as Repository<T>;
    }
    if (target === Withdrawal) {
      return this.withdrawals as unknown as Repository<T>;
    }
    if (target === WalletAccount) {
      return this.wallets as unknown as Repository<T>;
    }
    throw new Error('Unexpected payment repository');
  }
}

class MemoryDataSource {
  readonly isolationLevels: string[] = [];

  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(
    isolationLevel: string,
    callback: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    this.isolationLevels.push(isolationLevel);
    return callback(this.manager as unknown as EntityManager);
  }
}

class FakeLedgerService {
  readonly calls: PostJournalCommand[] = [];
  fail = false;
  private sequence = 0;

  postJournalInTransaction(_manager: EntityManager, command: PostJournalCommand): Promise<string> {
    this.calls.push(command);
    if (this.fail) {
      return Promise.reject(new UnprocessableEntityException('Insufficient settlement balance'));
    }
    this.sequence += 1;
    return Promise.resolve(
      `00000000-0000-4000-8000-0000000002${String(this.sequence).padStart(2, '0')}`,
    );
  }
}

class FakePaymentReferenceService {
  private sequence = 0;

  nextReference(): Promise<string> {
    this.sequence += 1;
    return Promise.resolve(`MN${String(this.sequence).padStart(12, '0')}`);
  }
}

class FakeSettlementAccountService {
  getAccountId(): Promise<string> {
    return Promise.resolve(SETTLEMENT_ACCOUNT_ID);
  }
}

interface Fixture {
  depositService: DepositService;
  withdrawalService: WithdrawalService;
  deposits: MemoryRepository<Deposit>;
  withdrawals: MemoryRepository<Withdrawal>;
  ledger: FakeLedgerService;
  dataSource: MemoryDataSource;
}

function makeFixture(): Fixture {
  const deposits = new MemoryRepository<Deposit>();
  const withdrawals = new MemoryRepository<Withdrawal>();
  const wallets = new MemoryRepository<WalletAccount>();
  wallets.records.set(
    WALLET_ID,
    Object.assign(new WalletAccount(), {
      id: WALLET_ID,
      ledgerAccountId: WALLET_LEDGER_ACCOUNT_ID,
      customerId: 'payment-test-customer',
      currency: 'NGN',
      status: WalletStatus.ACTIVE,
    }),
  );
  const manager = new MemoryManager(deposits, withdrawals, wallets);
  const dataSource = new MemoryDataSource(manager);
  const ledger = new FakeLedgerService();
  const references = new FakePaymentReferenceService();
  const settlement = new FakeSettlementAccountService();
  const depositService = new DepositService(
    deposits as unknown as Repository<Deposit>,
    dataSource as unknown as DataSource,
    ledger as unknown as LedgerService,
    references as unknown as PaymentReferenceService,
    settlement as unknown as SettlementAccountService,
  );
  const withdrawalService = new WithdrawalService(
    withdrawals as unknown as Repository<Withdrawal>,
    dataSource as unknown as DataSource,
    ledger as unknown as LedgerService,
    references as unknown as PaymentReferenceService,
    settlement as unknown as SettlementAccountService,
  );
  return { depositService, withdrawalService, deposits, withdrawals, ledger, dataSource };
}

function depositCommand(overrides: Partial<CreateDepositCommand> = {}): CreateDepositCommand {
  return {
    walletId: WALLET_ID,
    amountMinor: '100000',
    currency: 'NGN',
    idempotencyKey: 'deposit-payment-test-1',
    reference: 'payment-test-deposit',
    ...overrides,
  };
}

function withdrawalCommand(
  overrides: Partial<CreateWithdrawalCommand> = {},
): CreateWithdrawalCommand {
  return {
    walletId: WALLET_ID,
    amountMinor: '40000',
    currency: 'NGN',
    idempotencyKey: 'withdrawal-payment-test-1',
    reference: 'payment-test-withdrawal',
    ...overrides,
  };
}

describe('controlled payment services', () => {
  it('creates an idempotent pending deposit and completes it once', async () => {
    const fixture = makeFixture();
    const created = await fixture.depositService.createDeposit(depositCommand());
    const retry = await fixture.depositService.createDeposit(depositCommand());

    expect(created.status).toBe(DepositStatus.PENDING);
    expect(created.paymentReference).toBe('MN000000000001');
    expect(retry.id).toBe(created.id);
    expect(fixture.deposits.records.size).toBe(1);

    const completed = await fixture.depositService.completeDeposit(created.id);
    const duplicateCallback = await fixture.depositService.completeDeposit(created.id);

    expect(completed.status).toBe(DepositStatus.COMPLETED);
    expect(duplicateCallback.journalId).toBe(completed.journalId);
    expect(fixture.ledger.calls).toHaveLength(1);
  });

  it('rejects a changed deposit payload with the same idempotency key', async () => {
    const fixture = makeFixture();
    await fixture.depositService.createDeposit(depositCommand());

    await expect(
      fixture.depositService.createDeposit(depositCommand({ amountMinor: '100001' })),
    ).rejects.toMatchObject({ status: 409 });
    expect(fixture.deposits.records.size).toBe(1);
  });

  it('moves withdrawals through processing and completes repeated callbacks safely', async () => {
    const fixture = makeFixture();
    const withdrawal = await fixture.withdrawalService.createWithdrawal(withdrawalCommand());
    const duplicateCreation = await fixture.withdrawalService.createWithdrawal(withdrawalCommand());
    expect(withdrawal.status).toBe(WithdrawalStatus.PENDING);
    expect(duplicateCreation.id).toBe(withdrawal.id);
    expect(fixture.withdrawals.records.size).toBe(1);

    const processing = await fixture.withdrawalService.processWithdrawal(withdrawal.id);
    expect(processing.status).toBe(WithdrawalStatus.PROCESSING);
    const completed = await fixture.withdrawalService.completeWithdrawal(withdrawal.id);
    const duplicateCompletion = await fixture.withdrawalService.completeWithdrawal(withdrawal.id);

    expect(completed.status).toBe(WithdrawalStatus.COMPLETED);
    expect(duplicateCompletion.journalId).toBe(completed.journalId);
    expect(fixture.ledger.calls).toHaveLength(1);
    expect(fixture.dataSource.isolationLevels.every((level) => level === 'SERIALIZABLE')).toBe(
      true,
    );
  });

  it('marks a failed withdrawal without creating a journal', async () => {
    const fixture = makeFixture();
    const withdrawal = await fixture.withdrawalService.createWithdrawal(withdrawalCommand());
    await fixture.withdrawalService.processWithdrawal(withdrawal.id);
    fixture.ledger.fail = true;

    await expect(fixture.withdrawalService.completeWithdrawal(withdrawal.id)).rejects.toMatchObject(
      {
        status: 422,
      },
    );
    expect(fixture.withdrawals.records.get(withdrawal.id)).toMatchObject({
      status: WithdrawalStatus.FAILED,
      journalId: null,
    });
  });
});
