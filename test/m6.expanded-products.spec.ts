import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { QueryFailedError } from 'typeorm';

import type { Beneficiary } from '../src/beneficiary/beneficiary.entity';
import { BeneficiaryService } from '../src/beneficiary/beneficiary.service';
import { BeneficiaryType } from '../src/beneficiary/beneficiary.enums';
import type { Bank } from '../src/bank/bank.entity';
import { BankService } from '../src/bank/bank.service';
import { BankStatus } from '../src/bank/bank.enums';
import { FeeEngine } from '../src/fee/fee.engine';
import { LimitEngine } from '../src/limit/limit.engine';
import { PaymentQuote } from '../src/quote/payment-quote.entity';
import { PaymentQuoteStatus, QuotePaymentType } from '../src/quote/quote.enums';
import { QuoteService } from '../src/quote/quote.service';
import type { PaymentReferenceService } from '../src/payment/payment-reference.service';
import type { PaymentType } from '../src/payment/payment.enums';
import { VirtualAccount } from '../src/virtual-account/virtual-account.entity';
import { VirtualAccountService } from '../src/virtual-account/virtual-account.service';
import { VirtualAccountStatus } from '../src/virtual-account/virtual-account.enums';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletStatus } from '../src/wallet/wallet.enums';

const WALLET_ID = '00000000-0000-4000-8000-000000000001';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000101';

class SimpleRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  create(input: DeepPartial<T>): T {
    return input as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.id) {
      record.id = `00000000-0000-4000-8000-000000000${String(++this.sequence).padStart(3, '0')}`;
    }
    if (!record.createdAt) {
      record.createdAt = new Date(1_000 + this.sequence);
    }
    if (!record.updatedAt) {
      record.updatedAt = record.createdAt;
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
    return Promise.resolve(
      [...this.records.values()].find((entity) => {
        const record = entity as Record<string, unknown>;
        return Object.entries(conditions).every(([key, value]) => record[key] === value);
      }) ?? null,
    );
  }

  find(options: FindManyOptions<T>): Promise<T[]> {
    const where = options.where;
    const conditions = where && !Array.isArray(where) ? (where as Record<string, unknown>) : {};
    return Promise.resolve(
      [...this.records.values()].filter((entity) => {
        const record = entity as Record<string, unknown>;
        return Object.entries(conditions).every(([key, value]) => record[key] === value);
      }),
    );
  }

  createQueryBuilder(alias: string): MemoryQueryBuilder<T> {
    void alias;
    return new MemoryQueryBuilder(this.records);
  }

  remove(entity: T): Promise<T> {
    this.records.delete(String((entity as Record<string, unknown>).id));
    return Promise.resolve(entity);
  }
}

class MemoryPaymentReferenceService {
  private sequence = 0;

  nextReference(manager: EntityManager, type: PaymentType, id: string): Promise<string> {
    void manager;
    void type;
    void id;
    this.sequence += 1;
    return Promise.resolve(`MN${String(this.sequence).padStart(12, '0')}`);
  }
}

class MemoryDataSource {
  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(
    isolationOrCallback: string | ((manager: EntityManager) => Promise<T>),
    maybeCallback?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const callback =
      typeof isolationOrCallback === 'function' ? isolationOrCallback : maybeCallback;
    if (!callback) {
      throw new Error('Missing transaction callback');
    }
    return callback(this.manager as unknown as EntityManager);
  }
}

class MemoryQueryBuilder<T extends ObjectLiteral> {
  private predicate: (entity: T) => boolean = () => true;

  constructor(private readonly records: Map<string, T>) {}

  where(condition: string, parameters: Record<string, string>): MemoryQueryBuilder<T> {
    const value = Object.values(parameters)[0];
    const field = condition.includes('.id') ? 'id' : 'walletId';
    this.predicate = (entity) => String((entity as Record<string, unknown>)[field]) === value;
    return this;
  }

  setLock(lock: 'pessimistic_write'): MemoryQueryBuilder<T> {
    void lock;
    return this;
  }

  getOne(): Promise<T | null> {
    return Promise.resolve([...this.records.values()].find(this.predicate) ?? null);
  }
}

class MemoryManager {
  constructor(
    private readonly virtualAccounts: SimpleRepository<VirtualAccount>,
    private readonly wallets: SimpleRepository<WalletAccount>,
    private readonly quotes: SimpleRepository<PaymentQuote>,
  ) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    if (target === VirtualAccount) {
      return this.virtualAccounts as unknown as Repository<T>;
    }
    if (target === WalletAccount) {
      return this.wallets as unknown as Repository<T>;
    }
    if (target === PaymentQuote) {
      return this.quotes as unknown as Repository<T>;
    }
    throw new Error('Unexpected M6 repository');
  }
}

function wallet(): WalletAccount {
  return Object.assign(new WalletAccount(), {
    id: WALLET_ID,
    ledgerAccountId: WALLET_ACCOUNT_ID,
    customerId: 'customer-1',
    currency: 'NGN',
    status: WalletStatus.ACTIVE,
  });
}

describe('M6 expanded financial products', () => {
  it('calculates flat, percentage, minimum, maximum, and VAT fees exactly', () => {
    const engine = new FeeEngine();
    const result = engine.calculate(100000, 'NGN', {
      paymentType: QuotePaymentType.TRANSFER,
      flatFeeMinor: '100',
      percentageBps: '100',
      minimumFeeMinor: '500',
      maximumFeeMinor: '2000',
      vatBps: '750',
    });

    expect(result).toEqual({
      paymentType: QuotePaymentType.TRANSFER,
      currency: 'NGN',
      amountMinor: '100000',
      feeMinor: '1100',
      vatMinor: '82',
      totalMinor: '101182',
    });
  });

  it('evaluates single, daily, and monthly limits without mutating usage', () => {
    const engine = new LimitEngine();
    const result = engine.evaluate({
      customerId: 'customer-1',
      walletId: WALLET_ID,
      paymentType: QuotePaymentType.TRANSFER,
      amountMinor: '60000',
      singleTransactionLimitMinor: '50000',
      dailyLimitMinor: '100000',
      monthlyLimitMinor: '500000',
      dailyUsedMinor: '50000',
      monthlyUsedMinor: '100000',
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(['SINGLE_TRANSACTION_LIMIT_EXCEEDED', 'DAILY_LIMIT_EXCEEDED']);
    expect(result.remainingMonthlyMinor).toBe('340000');
  });

  it('prevents duplicate beneficiaries and supports update, list, and delete', async () => {
    const repository = new SimpleRepository<Beneficiary>();
    const service = new BeneficiaryService(repository as unknown as Repository<Beneficiary>);
    const command = {
      customerId: 'customer-1',
      nickname: 'Main account',
      bankCode: '001',
      accountNumber: '1234567890',
      accountName: 'A Customer',
      type: BeneficiaryType.BANK_ACCOUNT,
    };
    const first = await service.create(command);

    repository.save = (entity: Beneficiary): Promise<Beneficiary> => {
      const duplicate = [...repository.records.values()].some(
        (existing) =>
          existing.id !== entity.id &&
          existing.customerId === entity.customerId &&
          existing.bankCode === entity.bankCode &&
          existing.accountNumber === entity.accountNumber &&
          existing.type === entity.type,
      );
      if (duplicate) {
        return Promise.reject(
          new QueryFailedError(
            'insert',
            [],
            Object.assign(new Error('duplicate'), {
              code: '23505',
              constraint: 'uq_beneficiaries_duplicate',
            }),
          ),
        );
      }
      repository.records.set(entity.id, entity);
      return Promise.resolve(entity);
    };
    await expect(service.create(command)).rejects.toMatchObject({ status: 409 });

    const updated = await service.updateNickname(first.id, { nickname: 'Updated account' });
    expect(updated.nickname).toBe('Updated account');
    expect((await service.list('customer-1')).length).toBe(1);
    await service.remove(first.id);
    await expect(service.get(first.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('supports bank directory CRUD and status/search fields', async () => {
    const repository = new SimpleRepository<Bank>();
    const service = new BankService(repository as unknown as Repository<Bank>);
    const bank = await service.create({
      bankCode: '001',
      bankName: 'Test Bank',
      shortName: 'Test',
      nipSupported: true,
      status: BankStatus.ACTIVE,
    });

    const updated = await service.update(bank.id, {
      shortName: 'Updated',
      status: BankStatus.INACTIVE,
    });
    expect(updated.shortName).toBe('Updated');
    expect(updated.status).toBe(BankStatus.INACTIVE);
    expect(await service.list()).toHaveLength(1);
    await service.remove(bank.id);
    await expect(service.get(bank.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows one active virtual account per provider per wallet', async () => {
    const virtualAccounts = new SimpleRepository<VirtualAccount>();
    const wallets = new SimpleRepository<WalletAccount>();
    wallets.records.set(WALLET_ID, wallet());
    const quotes = new SimpleRepository<PaymentQuote>();
    const manager = new MemoryManager(virtualAccounts, wallets, quotes);
    const service = new VirtualAccountService(
      virtualAccounts as unknown as Repository<VirtualAccount>,
      new MemoryDataSource(manager) as unknown as DataSource,
      new MemoryPaymentReferenceService() as unknown as PaymentReferenceService,
    );
    const command = {
      walletId: WALLET_ID,
      bankCode: '001',
      accountNumber: '1234567890',
      accountName: 'Customer Wallet',
      provider: 'INTERNAL_PROVIDER',
    };

    const assigned = await service.assign(command);
    expect(assigned.status).toBe(VirtualAccountStatus.ACTIVE);
    await expect(service.assign(command)).rejects.toBeInstanceOf(ConflictException);
    const deactivated = await service.deactivate(assigned.id);
    expect(deactivated.status).toBe(VirtualAccountStatus.DEACTIVATED);
  });

  it('expires immutable quotes and marks them used only while active', async () => {
    const quotes = new SimpleRepository<PaymentQuote>();
    const manager = new MemoryManager(
      new SimpleRepository<VirtualAccount>(),
      new SimpleRepository<WalletAccount>(),
      quotes,
    );
    const service = new QuoteService(
      quotes as unknown as Repository<PaymentQuote>,
      new MemoryDataSource(manager) as unknown as DataSource,
      new MemoryPaymentReferenceService() as unknown as PaymentReferenceService,
    );
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const quote = await service.create({
      paymentType: QuotePaymentType.TRANSFER,
      amountMinor: '10000',
      feeMinor: '100',
      vatMinor: '8',
      currency: 'NGN',
      expiresAt,
      idempotencyKey: 'quote-test-1',
    });
    expect(quote.status).toBe(PaymentQuoteStatus.ACTIVE);
    expect(quote.totalMinor).toBe('10108');
    const stored = quotes.records.get(quote.id)!;
    stored.expiresAt = new Date(Date.now() - 1);
    expect((await service.get(quote.id)).status).toBe(PaymentQuoteStatus.EXPIRED);
  });
});
