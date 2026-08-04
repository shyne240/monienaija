import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';

import { Customer } from '../src/customer/customer.entity';
import {
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
} from '../src/customer/customer.enums';
import { CustomerEligibilityStatus } from '../src/customer-eligibility/customer-eligibility.enums';
import { CustomerEligibility } from '../src/customer-eligibility/customer-eligibility.entity';
import { CustomerOnboardingStatus } from '../src/customer-onboarding/customer-onboarding.enums';
import { CustomerOnboarding } from '../src/customer-onboarding/customer-onboarding.entity';
import { CustomerWallet } from '../src/customer-wallet/customer-wallet.entity';
import {
  CustomerWalletStatus,
  CustomerWalletType,
  WalletProvisioningHistoryAction,
} from '../src/customer-wallet/customer-wallet.enums';
import { CustomerWalletService } from '../src/customer-wallet/customer-wallet.service';
import { CreateCustomerWalletDto } from '../src/customer-wallet/dto/create-customer-wallet.dto';
import { CreateWalletAliasDto } from '../src/customer-wallet/dto/create-wallet-alias.dto';
import { WalletAlias } from '../src/customer-wallet/wallet-alias.entity';
import { WalletOwnership } from '../src/customer-wallet/wallet-ownership.entity';
import { WalletProvisioningHistory } from '../src/customer-wallet/wallet-provisioning-history.entity';
import type { AuditService } from '../src/operations/audit.service';

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  create(input?: DeepPartial<T>): T {
    return (input ?? {}) as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.id) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-000000000${String(this.sequence).padStart(3, '0')}`;
    }
    record.createdAt ??= new Date(1_000 + this.sequence);
    record.updatedAt = new Date(2_000 + this.sequence);
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Partial<T> }): Promise<T | null> {
    const conditions = options.where ?? {};
    return Promise.resolve(
      [...this.records.values()].find((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          const actual = (entity as Record<string, unknown>)[key];
          return actual === expected;
        }),
      ) ?? null,
    );
  }

  find(options?: { where?: Partial<T> }): Promise<T[]> {
    const conditions = options?.where ?? {};
    return Promise.resolve(
      [...this.records.values()].filter((entity) =>
        Object.entries(conditions).every(([key, expected]) => {
          const actual = (entity as Record<string, unknown>)[key];
          return actual === expected;
        }),
      ),
    );
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) {
      throw new Error('Unexpected customer-wallet repository');
    }
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  readonly manager: EntityManager;

  constructor(private readonly memoryManager: MemoryManager) {
    this.manager = memoryManager as unknown as EntityManager;
  }

  transaction<T>(
    _isolationOrCallback: string | ((manager: EntityManager) => Promise<T>),
    maybeCallback?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const callback =
      typeof _isolationOrCallback === 'function' ? _isolationOrCallback : maybeCallback;
    if (!callback) {
      throw new Error('Missing transaction callback');
    }
    return callback(this.manager);
  }
}

describe('CustomerWalletService', () => {
  function fixture() {
    const walletRepository = new MemoryRepository<CustomerWallet>();
    const historyRepository = new MemoryRepository<WalletProvisioningHistory>();
    const aliasRepository = new MemoryRepository<WalletAlias>();
    const ownershipRepository = new MemoryRepository<WalletOwnership>();
    const customerRepository = new MemoryRepository<Customer>();
    const onboardingRepository = new MemoryRepository<CustomerOnboarding>();
    const eligibilityRepository = new MemoryRepository<CustomerEligibility>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [CustomerWallet, walletRepository as unknown as MemoryRepository<ObjectLiteral>],
      [WalletProvisioningHistory, historyRepository as unknown as MemoryRepository<ObjectLiteral>],
      [WalletAlias, aliasRepository as unknown as MemoryRepository<ObjectLiteral>],
      [WalletOwnership, ownershipRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerOnboarding, onboardingRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerEligibility, eligibilityRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerWalletService(
      walletRepository as unknown as Repository<CustomerWallet>,
      historyRepository as unknown as Repository<WalletProvisioningHistory>,
      aliasRepository as unknown as Repository<WalletAlias>,
      ownershipRepository as unknown as Repository<WalletOwnership>,
      customerRepository as unknown as Repository<Customer>,
      onboardingRepository as unknown as Repository<CustomerOnboarding>,
      eligibilityRepository as unknown as Repository<CustomerEligibility>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        customerRepository,
        onboardingRepository,
        eligibilityRepository,
        walletRepository,
        historyRepository,
        aliasRepository,
        ownershipRepository,
      },
    };
  }

  async function createCustomer(testFixture: ReturnType<typeof fixture>): Promise<Customer> {
    return testFixture.repositories.customerRepository.save(
      testFixture.repositories.customerRepository.create({
        id: '00000000-0000-4000-8000-000000000001',
        reference: 'wallet-customer',
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_1,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  async function makeEligible(testFixture: ReturnType<typeof fixture>, customerId: string) {
    await testFixture.repositories.onboardingRepository.save(
      testFixture.repositories.onboardingRepository.create({
        id: '00000000-0000-4000-8000-000000000010',
        customerId,
        status: CustomerOnboardingStatus.COMPLETED,
        version: 1,
        deletedAt: null,
      }),
    );
    await testFixture.repositories.eligibilityRepository.save(
      testFixture.repositories.eligibilityRepository.create({
        id: '00000000-0000-4000-8000-000000000011',
        customerId,
        status: CustomerEligibilityStatus.ELIGIBLE,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  it('provisions a wallet with immutable ownership and provisioning history', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await makeEligible(testFixture, customer.id);

    const wallet = await testFixture.service.createWallet(customer.id, {
      type: CustomerWalletType.PRIMARY,
      currency: 'ngn',
      actor: 'wallet-ops',
    });
    const ownership = await testFixture.service.getOwnership(customer.id, wallet.id);
    const history = await testFixture.service.listHistory(customer.id, wallet.id);

    expect(wallet.status).toBe(CustomerWalletStatus.PENDING);
    expect(wallet.currency).toBe('NGN');
    expect(ownership.walletId).toBe(wallet.id);
    expect(ownership.customerId).toBe(customer.id);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        WalletProvisioningHistoryAction.OWNERSHIP_CREATED,
        WalletProvisioningHistoryAction.PROVISIONED,
      ]),
    );
    expect(testFixture.repositories.walletRepository.records.size).toBe(1);
    expect(testFixture.repositories.ownershipRepository.records.size).toBe(1);
    expect(testFixture.audit.record).toHaveBeenCalled();
  });

  it('rejects duplicate primary wallets and globally duplicate aliases', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await makeEligible(testFixture, customer.id);
    const primary = await testFixture.service.createWallet(customer.id, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      actor: 'wallet-ops',
    });
    await expect(
      testFixture.service.createWallet(customer.id, {
        type: CustomerWalletType.PRIMARY,
        currency: 'USD',
        actor: 'wallet-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await testFixture.service.createAlias(customer.id, primary.id, {
      alias: 'main-wallet',
      actor: 'wallet-ops',
    });
    const savings = await testFixture.service.createWallet(customer.id, {
      type: CustomerWalletType.SAVINGS,
      currency: 'NGN',
      actor: 'wallet-ops',
    });
    await expect(
      testFixture.service.createAlias(customer.id, savings.id, {
        alias: 'MAIN-WALLET',
        actor: 'wallet-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects provisioning before onboarding completion and without eligibility', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await expect(
      testFixture.service.createWallet(customer.id, {
        type: CustomerWalletType.PRIMARY,
        currency: 'NGN',
        actor: 'wallet-ops',
      }),
    ).rejects.toThrow('onboarding must be COMPLETED');

    await testFixture.repositories.onboardingRepository.save(
      testFixture.repositories.onboardingRepository.create({
        id: '00000000-0000-4000-8000-000000000020',
        customerId: customer.id,
        status: CustomerOnboardingStatus.COMPLETED,
        version: 1,
        deletedAt: null,
      }),
    );
    await expect(
      testFixture.service.createWallet(customer.id, {
        type: CustomerWalletType.PRIMARY,
        currency: 'NGN',
        actor: 'wallet-ops',
      }),
    ).rejects.toThrow('eligibility must be ELIGIBLE');
  });

  it('enforces wallet status transitions and closed-wallet protection', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await makeEligible(testFixture, customer.id);
    const wallet = await testFixture.service.createWallet(customer.id, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      actor: 'wallet-ops',
    });

    const active = await testFixture.service.updateWallet(customer.id, wallet.id, {
      status: CustomerWalletStatus.ACTIVE,
      actor: 'wallet-ops',
    });
    expect(active.status).toBe(CustomerWalletStatus.ACTIVE);
    const suspended = await testFixture.service.updateWallet(customer.id, wallet.id, {
      status: CustomerWalletStatus.SUSPENDED,
      actor: 'wallet-ops',
    });
    expect(suspended.status).toBe(CustomerWalletStatus.SUSPENDED);
    const reactivated = await testFixture.service.updateWallet(customer.id, wallet.id, {
      status: CustomerWalletStatus.ACTIVE,
      actor: 'wallet-ops',
    });
    expect(reactivated.status).toBe(CustomerWalletStatus.ACTIVE);
    const closed = await testFixture.service.updateWallet(customer.id, wallet.id, {
      status: CustomerWalletStatus.CLOSED,
      actor: 'wallet-ops',
    });
    expect(closed.status).toBe(CustomerWalletStatus.CLOSED);
    await expect(
      testFixture.service.updateWallet(customer.id, wallet.id, {
        status: CustomerWalletStatus.ACTIVE,
        actor: 'wallet-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const history = await testFixture.service.listHistory(customer.id, wallet.id);
    expect(
      history.filter((entry) => entry.action === WalletProvisioningHistoryAction.STATUS_CHANGED),
    ).toHaveLength(4);
  });

  it('validates wallet and alias DTOs', async () => {
    const walletErrors = await validate(
      plainToInstance(CreateCustomerWalletDto, {
        type: 'UNKNOWN',
        currency: 'NGN',
        actor: 'wallet-ops',
      }),
    );
    expect(walletErrors.some((error) => error.property === 'type')).toBe(true);

    const aliasErrors = await validate(
      plainToInstance(CreateWalletAliasDto, {
        alias: 'not valid alias',
        actor: 'wallet-ops',
      }),
    );
    expect(aliasErrors.some((error) => error.property === 'alias')).toBe(true);
  });
});
