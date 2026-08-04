import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { CustomerRiskFactor } from '../src/customer-risk-profile/customer-risk-factor.entity';
import {
  CustomerRiskLevel,
  CustomerRiskProfileStatus,
  RiskProfileHistoryAction,
} from '../src/customer-risk-profile/customer-risk-profile.enums';
import { CustomerRiskProfile } from '../src/customer-risk-profile/customer-risk-profile.entity';
import { CustomerRiskProfileService } from '../src/customer-risk-profile/customer-risk-profile.service';
import { CreateCustomerRiskProfileDto } from '../src/customer-risk-profile/dto/create-customer-risk-profile.dto';
import { RiskFactorDto } from '../src/customer-risk-profile/dto/risk-factor.dto';
import { UpdateCustomerRiskProfileDto } from '../src/customer-risk-profile/dto/update-customer-risk-profile.dto';
import { RiskFactorHistory } from '../src/customer-risk-profile/risk-factor-history.entity';
import { RiskProfileHistory } from '../src/customer-risk-profile/risk-profile-history.entity';
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
    if (!repository) throw new Error('Unexpected risk profile repository');
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
    if (!callback) throw new Error('Missing transaction callback');
    return callback(this.manager);
  }
}

describe('CustomerRiskProfileService', () => {
  function fixture() {
    const profileRepository = new MemoryRepository<CustomerRiskProfile>();
    const factorRepository = new MemoryRepository<CustomerRiskFactor>();
    const profileHistoryRepository = new MemoryRepository<RiskProfileHistory>();
    const factorHistoryRepository = new MemoryRepository<RiskFactorHistory>();
    const customerRepository = new MemoryRepository<Customer>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [CustomerRiskProfile, profileRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerRiskFactor, factorRepository as unknown as MemoryRepository<ObjectLiteral>],
      [RiskProfileHistory, profileHistoryRepository as unknown as MemoryRepository<ObjectLiteral>],
      [RiskFactorHistory, factorHistoryRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerRiskProfileService(
      profileRepository as unknown as Repository<CustomerRiskProfile>,
      factorRepository as unknown as Repository<CustomerRiskFactor>,
      profileHistoryRepository as unknown as Repository<RiskProfileHistory>,
      factorHistoryRepository as unknown as Repository<RiskFactorHistory>,
      customerRepository as unknown as Repository<Customer>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        profileRepository,
        factorRepository,
        profileHistoryRepository,
        factorHistoryRepository,
        customerRepository,
      },
    };
  }

  async function createCustomer(testFixture: ReturnType<typeof fixture>): Promise<Customer> {
    return testFixture.repositories.customerRepository.save(
      testFixture.repositories.customerRepository.create({
        id: '00000000-0000-4000-8000-000000000001',
        reference: 'risk-profile-customer',
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_1,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  const baseCommand = {
    assessmentDate: '2026-08-01T00:00:00.000Z',
    assessedBy: 'risk-ops',
    assessmentMethod: 'MANUAL_REVIEW',
    overallRiskLevel: CustomerRiskLevel.MEDIUM,
    reviewDueDate: '2026-12-01T00:00:00.000Z',
    notes: 'Manual assessment',
    factors: [
      { category: 'customer-profile', score: 10, weight: 1, remarks: 'Standard profile' },
      { category: 'geography', score: 5, weight: 0.5, remarks: 'Review recorded' },
    ],
    actor: 'risk-ops',
  };

  it('creates a risk profile with multiple factors, history, and audit events', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const profile = await testFixture.service.createProfile(customer.id, baseCommand);
    const history = await testFixture.service.listHistory(customer.id);

    expect(profile.overallRiskLevel).toBe(CustomerRiskLevel.MEDIUM);
    expect(profile.factors).toHaveLength(2);
    expect(history.assessments).toHaveLength(1);
    expect(history.assessments[0]?.action).toBe(RiskProfileHistoryAction.CREATED);
    expect(history.factors).toHaveLength(2);
    expect(testFixture.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'CUSTOMER_RISK_PROFILE' }),
    );
  });

  it('rejects duplicate active profiles and invalid assessment dates or factors', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await testFixture.service.createProfile(customer.id, baseCommand);
    await expect(
      testFixture.service.createProfile(customer.id, baseCommand),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      testFixture.service.reassessProfile(customer.id, {
        ...baseCommand,
        assessmentDate: '2026-12-01T00:00:00.000Z',
        reviewDueDate: '2026-11-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('reviewDueDate cannot be before assessmentDate');
    await expect(
      testFixture.service.reassessProfile(customer.id, {
        ...baseCommand,
        factors: [{ category: 'bad', score: -1, weight: 1 }],
      }),
    ).rejects.toThrow('Risk score cannot be negative');
    await expect(
      testFixture.service.reassessProfile(customer.id, {
        ...baseCommand,
        factors: [{ category: 'bad', score: 1, weight: 0 }],
      }),
    ).rejects.toThrow('Risk weight must be greater than zero');
  });

  it('reassesses with immutable assessment and factor history', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const profile = await testFixture.service.createProfile(customer.id, baseCommand);
    const reassessed = await testFixture.service.reassessProfile(customer.id, {
      ...baseCommand,
      assessmentDate: '2026-09-01T00:00:00.000Z',
      overallRiskLevel: CustomerRiskLevel.HIGH,
      factors: [{ category: 'new-factor', score: 80, weight: 2, remarks: 'Reassessment' }],
    });
    const history = await testFixture.service.listHistory(customer.id);

    expect(reassessed.id).toBe(profile.id);
    expect(reassessed.overallRiskLevel).toBe(CustomerRiskLevel.HIGH);
    expect(reassessed.factors).toHaveLength(1);
    expect(history.assessments).toHaveLength(2);
    expect(history.assessments.map((entry) => entry.action)).toContain(
      RiskProfileHistoryAction.REASSESSED,
    );
    expect(history.factors).toHaveLength(3);
    expect(
      [...testFixture.repositories.factorRepository.records.values()].some(
        (factor) => factor.deletedAt !== null,
      ),
    ).toBe(true);
  });

  it('protects closed profiles from reassessment and validates DTOs and UUIDs', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await testFixture.service.createProfile(customer.id, baseCommand);
    await testFixture.service.updateProfile(customer.id, {
      status: CustomerRiskProfileStatus.CLOSED,
      actor: 'risk-ops',
    });
    await expect(
      testFixture.service.reassessProfile(customer.id, baseCommand),
    ).rejects.toBeInstanceOf(ConflictException);

    const createErrors = await validate(
      plainToInstance(CreateCustomerRiskProfileDto, {
        ...baseCommand,
        reviewDueDate: '2026-07-01T00:00:00.000Z',
        factors: [],
      }),
    );
    expect(createErrors.some((error) => error.property === 'factors')).toBe(true);

    const factorErrors = await validate(
      plainToInstance(RiskFactorDto, {
        category: 'test',
        score: -1,
        weight: 0,
      }),
    );
    expect(factorErrors.some((error) => error.property === 'score')).toBe(true);
    expect(factorErrors.some((error) => error.property === 'weight')).toBe(true);

    const updateErrors = await validate(
      plainToInstance(UpdateCustomerRiskProfileDto, {
        overallRiskLevel: 'UNSUPPORTED',
        actor: 'risk-ops',
      }),
    );
    expect(updateErrors.some((error) => error.property === 'overallRiskLevel')).toBe(true);
    await expect(testFixture.service.getProfile('not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
