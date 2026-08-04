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
import { CustomerOnboardingStatus } from '../src/customer-onboarding/customer-onboarding.enums';
import { CustomerOnboarding } from '../src/customer-onboarding/customer-onboarding.entity';
import { CustomerEligibility } from '../src/customer-eligibility/customer-eligibility.entity';
import {
  CustomerEligibilityStatus,
  CustomerOperatingPermissionType,
  CustomerProductEnrollmentStatus,
  CustomerRestrictionType,
} from '../src/customer-eligibility/customer-eligibility.enums';
import { CustomerEligibilityService } from '../src/customer-eligibility/customer-eligibility.service';
import { CustomerLimitProfile } from '../src/customer-eligibility/customer-limit-profile.entity';
import { CustomerOperatingPermission } from '../src/customer-eligibility/customer-operating-permission.entity';
import { CustomerProductEnrollment } from '../src/customer-eligibility/customer-product-enrollment.entity';
import { CustomerRestriction } from '../src/customer-eligibility/customer-restriction.entity';
import { CreateCustomerLimitProfileDto } from '../src/customer-eligibility/dto/create-customer-limit-profile.dto';
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
      throw new Error('Unexpected eligibility repository');
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

describe('CustomerEligibilityService', () => {
  function fixture() {
    const eligibilityRepository = new MemoryRepository<CustomerEligibility>();
    const limitProfileRepository = new MemoryRepository<CustomerLimitProfile>();
    const enrollmentRepository = new MemoryRepository<CustomerProductEnrollment>();
    const permissionRepository = new MemoryRepository<CustomerOperatingPermission>();
    const restrictionRepository = new MemoryRepository<CustomerRestriction>();
    const customerRepository = new MemoryRepository<Customer>();
    const onboardingRepository = new MemoryRepository<CustomerOnboarding>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [CustomerEligibility, eligibilityRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerLimitProfile, limitProfileRepository as unknown as MemoryRepository<ObjectLiteral>],
      [
        CustomerProductEnrollment,
        enrollmentRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [
        CustomerOperatingPermission,
        permissionRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [CustomerRestriction, restrictionRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerOnboarding, onboardingRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerEligibilityService(
      eligibilityRepository as unknown as Repository<CustomerEligibility>,
      limitProfileRepository as unknown as Repository<CustomerLimitProfile>,
      enrollmentRepository as unknown as Repository<CustomerProductEnrollment>,
      permissionRepository as unknown as Repository<CustomerOperatingPermission>,
      restrictionRepository as unknown as Repository<CustomerRestriction>,
      customerRepository as unknown as Repository<Customer>,
      onboardingRepository as unknown as Repository<CustomerOnboarding>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        customerRepository,
        onboardingRepository,
      },
    };
  }

  async function createCustomer(
    testFixture: ReturnType<typeof fixture>,
    status: CustomerStatus = CustomerStatus.ACTIVE,
  ): Promise<Customer> {
    return testFixture.repositories.customerRepository.save(
      testFixture.repositories.customerRepository.create({
        id: '00000000-0000-4000-8000-000000000001',
        reference: 'eligibility-customer',
        type: CustomerType.INDIVIDUAL,
        status,
        kycLevel: CustomerKycLevel.NONE,
        kycStatus: CustomerKycStatus.NOT_STARTED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  async function completeOnboarding(
    testFixture: ReturnType<typeof fixture>,
    customerId: string,
  ): Promise<CustomerOnboarding> {
    return testFixture.repositories.onboardingRepository.save(
      testFixture.repositories.onboardingRepository.create({
        id: '00000000-0000-4000-8000-000000000010',
        customerId,
        status: CustomerOnboardingStatus.COMPLETED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  it('creates eligibility, enforces completed onboarding, rejects duplicates, and audits changes', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const pending = await testFixture.service.createEligibility(customer.id, {
      actor: 'eligibility-ops',
    });

    expect(pending.status).toBe(CustomerEligibilityStatus.PENDING);
    await expect(
      testFixture.service.createEligibility(customer.id, { actor: 'eligibility-ops' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      testFixture.service.updateEligibility(customer.id, {
        status: CustomerEligibilityStatus.ELIGIBLE,
        actor: 'eligibility-ops',
      }),
    ).rejects.toThrow('Only COMPLETED onboarding');

    const onboarding = await completeOnboarding(testFixture, customer.id);
    const eligible = await testFixture.service.updateEligibility(customer.id, {
      status: CustomerEligibilityStatus.ELIGIBLE,
      actor: 'eligibility-ops',
    });

    expect(eligible.status).toBe(CustomerEligibilityStatus.ELIGIBLE);
    expect(eligible.onboardingId).toBe(onboarding.id);
    expect(testFixture.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'CUSTOMER_ELIGIBILITY' }),
    );
    await expect(
      testFixture.service.updateEligibility(customer.id, {
        status: CustomerEligibilityStatus.PENDING,
        actor: 'eligibility-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates and updates one active limit profile', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const profile = await testFixture.service.createLimitProfile(customer.id, {
      currency: 'ngn',
      dailyTransactionCount: 20,
      dailyTransactionAmountMinor: '10000000',
      singleTransactionAmountMinor: '1000000',
      monthlyTransactionAmountMinor: '100000000',
      walletBalanceMinor: '50000000',
      actor: 'limits-ops',
    });

    expect(profile.currency).toBe('NGN');
    expect(profile.dailyTransactionAmountMinor).toBe('10000000');
    await expect(
      testFixture.service.createLimitProfile(customer.id, {
        currency: 'NGN',
        dailyTransactionCount: 10,
        dailyTransactionAmountMinor: '1',
        singleTransactionAmountMinor: '1',
        monthlyTransactionAmountMinor: '1',
        walletBalanceMinor: '1',
        actor: 'limits-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const updated = await testFixture.service.updateLimitProfile(customer.id, {
      dailyTransactionCount: 30,
      walletBalanceMinor: '60000000',
      actor: 'limits-ops',
    });
    expect(updated.dailyTransactionCount).toBe(30);
    expect(updated.walletBalanceMinor).toBe('60000000');
  });

  it('enforces eligibility and frozen restrictions for product enrollments', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await expect(
      testFixture.service.createEnrollment(customer.id, {
        product: 'wallet',
        status: CustomerProductEnrollmentStatus.ACTIVE,
        actor: 'product-ops',
      }),
    ).rejects.toThrow('Only ELIGIBLE customers');

    await testFixture.service.createEligibility(customer.id, {
      status: CustomerEligibilityStatus.PENDING,
      actor: 'eligibility-ops',
    });
    await completeOnboarding(testFixture, customer.id);
    await testFixture.service.updateEligibility(customer.id, {
      status: CustomerEligibilityStatus.ELIGIBLE,
      actor: 'eligibility-ops',
    });
    const enrollment = await testFixture.service.createEnrollment(customer.id, {
      product: 'wallet',
      actor: 'product-ops',
    });
    const active = await testFixture.service.updateEnrollment(customer.id, enrollment.id, {
      status: CustomerProductEnrollmentStatus.ACTIVE,
      actor: 'product-ops',
    });
    expect(active.status).toBe(CustomerProductEnrollmentStatus.ACTIVE);

    await expect(
      testFixture.service.createEnrollment(customer.id, {
        product: 'wallet',
        actor: 'product-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await testFixture.service.createRestriction(customer.id, {
      type: CustomerRestrictionType.FROZEN,
      isActive: true,
      actor: 'risk-ops',
    });
    await expect(
      testFixture.service.createEnrollment(customer.id, {
        product: 'payments',
        status: CustomerProductEnrollmentStatus.ACTIVE,
        actor: 'product-ops',
      }),
    ).rejects.toThrow('FROZEN customers');
  });

  it('creates permissions, restrictions, and calculates operating status', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await testFixture.service.createEligibility(customer.id, {
      status: CustomerEligibilityStatus.PENDING,
      actor: 'eligibility-ops',
    });
    await completeOnboarding(testFixture, customer.id);
    await testFixture.service.updateEligibility(customer.id, {
      status: CustomerEligibilityStatus.ELIGIBLE,
      actor: 'eligibility-ops',
    });
    await testFixture.service.createPermission(customer.id, {
      type: CustomerOperatingPermissionType.TRANSFER,
      enabled: true,
      actor: 'permission-ops',
    });
    await expect(
      testFixture.service.createPermission(customer.id, {
        type: CustomerOperatingPermissionType.TRANSFER,
        enabled: false,
        actor: 'permission-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await testFixture.service.createRestriction(customer.id, {
      type: CustomerRestrictionType.NONE,
      isActive: true,
      actor: 'risk-ops',
    });
    await expect(
      testFixture.service.createRestriction(customer.id, {
        type: CustomerRestrictionType.NONE,
        isActive: false,
        actor: 'risk-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const enrollment = await testFixture.service.createEnrollment(customer.id, {
      product: 'transfers',
      status: CustomerProductEnrollmentStatus.ACTIVE,
      actor: 'product-ops',
    });

    const operating = await testFixture.service.getOperatingStatus(customer.id);
    expect(operating.status).toBe('OPERABLE');
    expect(operating.canOperate).toBe(true);
    expect(operating.activeEnrollmentProducts).toEqual([enrollment.product]);
    expect(operating.enabledPermissions).toEqual([CustomerOperatingPermissionType.TRANSFER]);

    await testFixture.service.createRestriction(customer.id, {
      type: CustomerRestrictionType.LIMITED,
      isActive: true,
      actor: 'risk-ops',
    });
    const restricted = await testFixture.service.getOperatingStatus(customer.id);
    expect(restricted.status).toBe('RESTRICTED');
    expect(restricted.canOperate).toBe(false);
    expect(restricted.blockedReasons).toContain('LIMITED');
  });

  it('blocks blacklisted eligibility and validates limit DTOs', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await testFixture.service.createRestriction(customer.id, {
      type: CustomerRestrictionType.BLACKLISTED,
      isActive: true,
      actor: 'risk-ops',
    });
    await testFixture.service.createEligibility(customer.id, { actor: 'eligibility-ops' });
    await completeOnboarding(testFixture, customer.id);
    await expect(
      testFixture.service.updateEligibility(customer.id, {
        status: CustomerEligibilityStatus.ELIGIBLE,
        actor: 'eligibility-ops',
      }),
    ).rejects.toThrow('BLACKLISTED customers');

    const errors = await validate(
      plainToInstance(CreateCustomerLimitProfileDto, {
        currency: 'NGN',
        dailyTransactionCount: 1,
        dailyTransactionAmountMinor: '-1',
        singleTransactionAmountMinor: '1',
        monthlyTransactionAmountMinor: '1',
        walletBalanceMinor: '1',
        actor: 'limits-ops',
      }),
    );
    expect(errors.some((error) => error.property === 'dailyTransactionAmountMinor')).toBe(true);
  });
});
