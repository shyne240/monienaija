import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
import { BeneficiaryHistory } from '../src/customer-beneficiary/beneficiary-history.entity';
import { BeneficiaryOwnership } from '../src/customer-beneficiary/beneficiary-ownership.entity';
import { BeneficiaryVerification } from '../src/customer-beneficiary/beneficiary-verification.entity';
import { CustomerBeneficiary } from '../src/customer-beneficiary/customer-beneficiary.entity';
import {
  BeneficiaryHistoryAction,
  CustomerBeneficiaryStatus,
  CustomerBeneficiaryType,
} from '../src/customer-beneficiary/customer-beneficiary.enums';
import { CustomerBeneficiaryService } from '../src/customer-beneficiary/customer-beneficiary.service';
import { CreateCustomerBeneficiaryDto } from '../src/customer-beneficiary/dto/create-customer-beneficiary.dto';
import { UpdateCustomerBeneficiaryDto } from '../src/customer-beneficiary/dto/update-customer-beneficiary.dto';
import { VerifyCustomerBeneficiaryDto } from '../src/customer-beneficiary/dto/verify-customer-beneficiary.dto';
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
      throw new Error('Unexpected beneficiary repository');
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

describe('CustomerBeneficiaryService', () => {
  function fixture() {
    const beneficiaryRepository = new MemoryRepository<CustomerBeneficiary>();
    const ownershipRepository = new MemoryRepository<BeneficiaryOwnership>();
    const verificationRepository = new MemoryRepository<BeneficiaryVerification>();
    const historyRepository = new MemoryRepository<BeneficiaryHistory>();
    const customerRepository = new MemoryRepository<Customer>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [CustomerBeneficiary, beneficiaryRepository as unknown as MemoryRepository<ObjectLiteral>],
      [BeneficiaryOwnership, ownershipRepository as unknown as MemoryRepository<ObjectLiteral>],
      [
        BeneficiaryVerification,
        verificationRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [BeneficiaryHistory, historyRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerBeneficiaryService(
      beneficiaryRepository as unknown as Repository<CustomerBeneficiary>,
      ownershipRepository as unknown as Repository<BeneficiaryOwnership>,
      verificationRepository as unknown as Repository<BeneficiaryVerification>,
      historyRepository as unknown as Repository<BeneficiaryHistory>,
      customerRepository as unknown as Repository<Customer>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        beneficiaryRepository,
        ownershipRepository,
        verificationRepository,
        historyRepository,
        customerRepository,
      },
    };
  }

  async function createCustomer(
    testFixture: ReturnType<typeof fixture>,
    id = '00000000-0000-4000-8000-000000000001',
  ): Promise<Customer> {
    return testFixture.repositories.customerRepository.save(
      testFixture.repositories.customerRepository.create({
        id,
        reference: `beneficiary-customer-${id.slice(-4)}`,
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_1,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  async function createBeneficiary(
    testFixture: ReturnType<typeof fixture>,
    customerId: string,
    reference = 'beneficiary-001',
    destinationIdentifier = '+2348012345678',
  ) {
    return testFixture.service.createBeneficiary(customerId, {
      type: CustomerBeneficiaryType.MOBILE_MONEY,
      displayName: 'Trusted recipient',
      reference,
      destinationIdentifier,
      destinationName: 'Recipient Name',
      destinationInstitution: 'Mobile Provider',
      nickname: 'Recipient',
      actor: 'beneficiary-ops',
    });
  }

  it('creates a beneficiary with immutable ownership, history, and audit events', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const beneficiary = await createBeneficiary(testFixture, customer.id);
    const ownership = await testFixture.service.getOwnership(customer.id, beneficiary.id);
    const history = await testFixture.service.listHistory(customer.id, beneficiary.id);

    expect(beneficiary.status).toBe(CustomerBeneficiaryStatus.PENDING);
    expect(beneficiary.verified).toBe(false);
    expect(beneficiary.destinationIdentifier).toBe('+2348012345678');
    expect(ownership.beneficiaryId).toBe(beneficiary.id);
    expect(ownership.customerId).toBe(customer.id);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        BeneficiaryHistoryAction.CREATED,
        BeneficiaryHistoryAction.OWNERSHIP_CREATED,
      ]),
    );
    expect(testFixture.repositories.beneficiaryRepository.records.size).toBe(1);
    expect(testFixture.repositories.ownershipRepository.records.size).toBe(1);
    expect(testFixture.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'CUSTOMER_BENEFICIARY' }),
    );
  });

  it('rejects duplicate destinations and globally duplicate references', async () => {
    const testFixture = fixture();
    const firstCustomer = await createCustomer(testFixture);
    const secondCustomer = await createCustomer(
      testFixture,
      '00000000-0000-4000-8000-000000000002',
    );
    await createBeneficiary(testFixture, firstCustomer.id, 'reference-one', '+2348012345678');

    await expect(
      createBeneficiary(testFixture, firstCustomer.id, 'reference-two', '+234 801 234 5678'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      createBeneficiary(testFixture, secondCustomer.id, 'REFERENCE-ONE', '08098765432'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('verifies beneficiaries and appends verification and history records', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const beneficiary = await createBeneficiary(testFixture, customer.id);
    const verification = await testFixture.service.verifyBeneficiary(customer.id, beneficiary.id, {
      verifiedBy: 'review-ops',
      verificationMethod: 'MANUAL_REVIEW',
      remarks: 'Recipient details reviewed',
    });
    const current = await testFixture.service.getBeneficiary(customer.id, beneficiary.id);
    const history = await testFixture.service.listHistory(customer.id, beneficiary.id);

    expect(verification.beneficiaryId).toBe(beneficiary.id);
    expect(current.verified).toBe(true);
    expect(testFixture.repositories.verificationRepository.records.size).toBe(1);
    expect(history.map((entry) => entry.action)).toContain(BeneficiaryHistoryAction.VERIFIED);
  });

  it('enforces status transitions, suspension reactivation, and deletion protection', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const beneficiary = await createBeneficiary(testFixture, customer.id);

    const active = await testFixture.service.updateBeneficiary(customer.id, beneficiary.id, {
      status: CustomerBeneficiaryStatus.ACTIVE,
      actor: 'beneficiary-ops',
    });
    expect(active.status).toBe(CustomerBeneficiaryStatus.ACTIVE);
    const suspended = await testFixture.service.updateBeneficiary(customer.id, beneficiary.id, {
      status: CustomerBeneficiaryStatus.SUSPENDED,
      actor: 'beneficiary-ops',
    });
    expect(suspended.status).toBe(CustomerBeneficiaryStatus.SUSPENDED);
    const reactivated = await testFixture.service.updateBeneficiary(customer.id, beneficiary.id, {
      status: CustomerBeneficiaryStatus.ACTIVE,
      actor: 'beneficiary-ops',
    });
    expect(reactivated.status).toBe(CustomerBeneficiaryStatus.ACTIVE);
    const deleted = await testFixture.service.updateBeneficiary(customer.id, beneficiary.id, {
      status: CustomerBeneficiaryStatus.DELETED,
      actor: 'beneficiary-ops',
    });
    expect(deleted.status).toBe(CustomerBeneficiaryStatus.DELETED);

    await expect(
      testFixture.service.updateBeneficiary(customer.id, beneficiary.id, {
        status: CustomerBeneficiaryStatus.ACTIVE,
        actor: 'beneficiary-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      testFixture.service.verifyBeneficiary(customer.id, beneficiary.id, {
        verifiedBy: 'review-ops',
        verificationMethod: 'MANUAL_REVIEW',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(await testFixture.service.listBeneficiaries(customer.id)).toHaveLength(0);
    expect(await testFixture.service.listHistory(customer.id, beneficiary.id)).toHaveLength(6);
  });

  it('validates DTOs and UUID parameters', async () => {
    const createErrors = await validate(
      plainToInstance(CreateCustomerBeneficiaryDto, {
        type: 'UNSUPPORTED',
        displayName: 'Invalid beneficiary',
        reference: 'invalid-reference',
        destinationIdentifier: 'destination',
        actor: 'beneficiary-ops',
      }),
    );
    expect(createErrors.some((error) => error.property === 'type')).toBe(true);

    const updateErrors = await validate(
      plainToInstance(UpdateCustomerBeneficiaryDto, {
        status: 'UNSUPPORTED',
        actor: 'beneficiary-ops',
      }),
    );
    expect(updateErrors.some((error) => error.property === 'status')).toBe(true);

    const verifyErrors = await validate(
      plainToInstance(VerifyCustomerBeneficiaryDto, {
        verifiedBy: 'review-ops',
        verificationMethod: '',
      }),
    );
    expect(verifyErrors.some((error) => error.property === 'verificationMethod')).toBe(true);

    const testFixture = fixture();
    await expect(testFixture.service.listBeneficiaries('not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
