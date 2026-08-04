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
import { CustomerFundingInstrument } from '../src/customer-funding-instrument/customer-funding-instrument.entity';
import {
  CustomerFundingInstrumentStatus,
  CustomerFundingInstrumentType,
  FundingInstrumentHistoryAction,
  FundingInstrumentVerificationState,
} from '../src/customer-funding-instrument/customer-funding-instrument.enums';
import { CustomerFundingInstrumentService } from '../src/customer-funding-instrument/customer-funding-instrument.service';
import { CreateCustomerFundingInstrumentDto } from '../src/customer-funding-instrument/dto/create-customer-funding-instrument.dto';
import { UpdateCustomerFundingInstrumentDto } from '../src/customer-funding-instrument/dto/update-customer-funding-instrument.dto';
import { VerifyCustomerFundingInstrumentDto } from '../src/customer-funding-instrument/dto/verify-customer-funding-instrument.dto';
import { FundingInstrumentHistory } from '../src/customer-funding-instrument/funding-instrument-history.entity';
import { FundingInstrumentOwnership } from '../src/customer-funding-instrument/funding-instrument-ownership.entity';
import { FundingInstrumentVerification } from '../src/customer-funding-instrument/funding-instrument-verification.entity';
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
      throw new Error('Unexpected funding-instrument repository');
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

describe('CustomerFundingInstrumentService', () => {
  function fixture() {
    const instrumentRepository = new MemoryRepository<CustomerFundingInstrument>();
    const ownershipRepository = new MemoryRepository<FundingInstrumentOwnership>();
    const verificationRepository = new MemoryRepository<FundingInstrumentVerification>();
    const historyRepository = new MemoryRepository<FundingInstrumentHistory>();
    const customerRepository = new MemoryRepository<Customer>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [
        CustomerFundingInstrument,
        instrumentRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [
        FundingInstrumentOwnership,
        ownershipRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [
        FundingInstrumentVerification,
        verificationRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [FundingInstrumentHistory, historyRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerFundingInstrumentService(
      instrumentRepository as unknown as Repository<CustomerFundingInstrument>,
      ownershipRepository as unknown as Repository<FundingInstrumentOwnership>,
      verificationRepository as unknown as Repository<FundingInstrumentVerification>,
      historyRepository as unknown as Repository<FundingInstrumentHistory>,
      customerRepository as unknown as Repository<Customer>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        instrumentRepository,
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
        reference: `funding-customer-${id.slice(-4)}`,
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_1,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  it('creates an instrument with immutable ownership, history, and audit events', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const instrument = await testFixture.service.createInstrument(customer.id, {
      type: CustomerFundingInstrumentType.BANK_ACCOUNT,
      displayName: 'Main account',
      reference: 'Bank-001',
      actor: 'funding-ops',
    });

    const ownership = await testFixture.service.getOwnership(customer.id, instrument.id);
    const history = await testFixture.service.listHistory(customer.id, instrument.id);

    expect(instrument.status).toBe(CustomerFundingInstrumentStatus.PENDING);
    expect(instrument.verificationState).toBe(FundingInstrumentVerificationState.UNVERIFIED);
    expect(instrument.reference).toBe('bank-001');
    expect(ownership.instrumentId).toBe(instrument.id);
    expect(ownership.customerId).toBe(customer.id);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        FundingInstrumentHistoryAction.CREATED,
        FundingInstrumentHistoryAction.OWNERSHIP_CREATED,
      ]),
    );
    expect(testFixture.repositories.instrumentRepository.records.size).toBe(1);
    expect(testFixture.repositories.ownershipRepository.records.size).toBe(1);
    expect(testFixture.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'CUSTOMER_FUNDING_INSTRUMENT' }),
    );
  });

  it('rejects duplicate references globally and does not reuse soft-deleted references', async () => {
    const testFixture = fixture();
    const firstCustomer = await createCustomer(testFixture);
    const secondCustomer = await createCustomer(
      testFixture,
      '00000000-0000-4000-8000-000000000002',
    );
    const first = await testFixture.service.createInstrument(firstCustomer.id, {
      type: CustomerFundingInstrumentType.MOBILE_MONEY,
      displayName: 'Mobile wallet',
      reference: 'shared-ref',
      actor: 'funding-ops',
    });

    await expect(
      testFixture.service.createInstrument(secondCustomer.id, {
        type: CustomerFundingInstrumentType.CASH_AGENT,
        displayName: 'Agent reference',
        reference: 'SHARED-REF',
        actor: 'funding-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const stored = testFixture.repositories.instrumentRepository.records.get(first.id);
    if (!stored) {
      throw new Error('Expected instrument persistence');
    }
    stored.deletedAt = new Date();
    await expect(
      testFixture.service.createInstrument(firstCustomer.id, {
        type: CustomerFundingInstrumentType.INTERNAL_SETTLEMENT,
        displayName: 'Historical reference reuse',
        reference: 'shared-ref',
        actor: 'funding-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('verifies instruments, appends verification records, and creates history', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const instrument = await testFixture.service.createInstrument(customer.id, {
      type: CustomerFundingInstrumentType.BANK_ACCOUNT,
      displayName: 'Verification account',
      reference: 'verify-001',
      actor: 'funding-ops',
    });

    const verification = await testFixture.service.verifyInstrument(customer.id, instrument.id, {
      verifiedBy: 'review-ops',
      verificationMethod: 'MANUAL_DOCUMENT_REVIEW',
      remarks: 'Evidence inspected',
    });
    const current = await testFixture.service.getInstrument(customer.id, instrument.id);
    const verifications = testFixture.repositories.verificationRepository.records;
    const history = await testFixture.service.listHistory(customer.id, instrument.id);

    expect(verification.instrumentId).toBe(instrument.id);
    expect(current.status).toBe(CustomerFundingInstrumentStatus.VERIFIED);
    expect(current.verificationState).toBe(FundingInstrumentVerificationState.VERIFIED);
    expect(verifications.size).toBe(1);
    expect(history.map((entry) => entry.action)).toContain(FundingInstrumentHistoryAction.VERIFIED);
    await expect(
      testFixture.service.verifyInstrument(customer.id, instrument.id, {
        verifiedBy: 'review-ops',
        verificationMethod: 'MANUAL_DOCUMENT_REVIEW',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces status transitions and prevents rejected instruments becoming verified', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const instrument = await testFixture.service.createInstrument(customer.id, {
      type: CustomerFundingInstrumentType.MOBILE_MONEY,
      displayName: 'Lifecycle instrument',
      reference: 'lifecycle-001',
      actor: 'funding-ops',
    });

    const suspended = await testFixture.service.updateInstrument(customer.id, instrument.id, {
      status: CustomerFundingInstrumentStatus.SUSPENDED,
      actor: 'funding-ops',
    });
    expect(suspended.status).toBe(CustomerFundingInstrumentStatus.SUSPENDED);
    const pending = await testFixture.service.updateInstrument(customer.id, instrument.id, {
      status: CustomerFundingInstrumentStatus.PENDING,
      actor: 'funding-ops',
    });
    expect(pending.status).toBe(CustomerFundingInstrumentStatus.PENDING);
    await expect(
      testFixture.service.updateInstrument(customer.id, instrument.id, {
        status: CustomerFundingInstrumentStatus.VERIFIED,
        actor: 'funding-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const rejected = await testFixture.service.updateInstrument(customer.id, instrument.id, {
      status: CustomerFundingInstrumentStatus.REJECTED,
      actor: 'funding-ops',
    });
    expect(rejected.status).toBe(CustomerFundingInstrumentStatus.REJECTED);
    await expect(
      testFixture.service.verifyInstrument(customer.id, instrument.id, {
        verifiedBy: 'review-ops',
        verificationMethod: 'MANUAL',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const history = await testFixture.service.listHistory(customer.id, instrument.id);
    expect(
      history.filter((entry) => entry.action === FundingInstrumentHistoryAction.STATUS_CHANGED),
    ).toHaveLength(3);
  });

  it('rejects verification of soft-deleted instruments and validates DTOs and UUIDs', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const instrument = await testFixture.service.createInstrument(customer.id, {
      type: CustomerFundingInstrumentType.CASH_AGENT,
      displayName: 'Deleted instrument',
      reference: 'deleted-001',
      actor: 'funding-ops',
    });
    const stored = testFixture.repositories.instrumentRepository.records.get(instrument.id);
    if (!stored) {
      throw new Error('Expected instrument persistence');
    }
    stored.deletedAt = new Date();

    await expect(
      testFixture.service.verifyInstrument(customer.id, instrument.id, {
        verifiedBy: 'review-ops',
        verificationMethod: 'MANUAL',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const createErrors = await validate(
      plainToInstance(CreateCustomerFundingInstrumentDto, {
        type: 'UNSUPPORTED',
        displayName: 'Invalid',
        reference: 'invalid-ref',
        actor: 'funding-ops',
      }),
    );
    expect(createErrors.some((error) => error.property === 'type')).toBe(true);

    const updateErrors = await validate(
      plainToInstance(UpdateCustomerFundingInstrumentDto, {
        status: 'UNSUPPORTED',
        actor: 'funding-ops',
      }),
    );
    expect(updateErrors.some((error) => error.property === 'status')).toBe(true);

    const verifyErrors = await validate(
      plainToInstance(VerifyCustomerFundingInstrumentDto, {
        verifiedBy: 'review-ops',
        verificationMethod: '',
      }),
    );
    expect(verifyErrors.some((error) => error.property === 'verificationMethod')).toBe(true);

    await expect(
      testFixture.service.getInstrument(customer.id, 'not-a-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
