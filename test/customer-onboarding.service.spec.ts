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
import { CustomerAddress } from '../src/customer/customer-address.entity';
import { CustomerIdentityDocument } from '../src/customer/customer-identity-document.entity';
import { CustomerProfile } from '../src/customer/customer-profile.entity';
import {
  AddressType,
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
  IdentityDocumentType,
} from '../src/customer/customer.enums';
import { CustomerAgreement } from '../src/customer-onboarding/customer-agreement.entity';
import { CustomerApprovalDecision } from '../src/customer-onboarding/customer-approval-decision.entity';
import {
  CustomerAgreementType,
  CustomerApprovalDecisionStatus,
  CustomerOnboardingStatus,
  CustomerOnboardingTaskStatus,
  CustomerOnboardingTaskType,
  CustomerRiskLevel,
} from '../src/customer-onboarding/customer-onboarding.enums';
import { CustomerOnboarding } from '../src/customer-onboarding/customer-onboarding.entity';
import { CustomerOnboardingService } from '../src/customer-onboarding/customer-onboarding.service';
import { CustomerOnboardingTask } from '../src/customer-onboarding/customer-onboarding-task.entity';
import { CustomerRiskProfile } from '../src/customer-onboarding/customer-risk-profile.entity';
import { CreateCustomerOnboardingTaskDto } from '../src/customer-onboarding/dto/create-customer-onboarding-task.dto';
import { CreateCustomerRiskProfileDto } from '../src/customer-onboarding/dto/create-customer-risk-profile.dto';
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
      throw new Error('Unexpected onboarding repository');
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

describe('CustomerOnboardingService', () => {
  function fixture() {
    const onboardingRepository = new MemoryRepository<CustomerOnboarding>();
    const agreementRepository = new MemoryRepository<CustomerAgreement>();
    const riskProfileRepository = new MemoryRepository<CustomerRiskProfile>();
    const taskRepository = new MemoryRepository<CustomerOnboardingTask>();
    const approvalRepository = new MemoryRepository<CustomerApprovalDecision>();
    const customerRepository = new MemoryRepository<Customer>();
    const profileRepository = new MemoryRepository<CustomerProfile>();
    const addressRepository = new MemoryRepository<CustomerAddress>();
    const identityDocumentRepository = new MemoryRepository<CustomerIdentityDocument>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [CustomerOnboarding, onboardingRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerAgreement, agreementRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerRiskProfile, riskProfileRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerOnboardingTask, taskRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerApprovalDecision, approvalRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerProfile, profileRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerAddress, addressRepository as unknown as MemoryRepository<ObjectLiteral>],
      [
        CustomerIdentityDocument,
        identityDocumentRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerOnboardingService(
      onboardingRepository as unknown as Repository<CustomerOnboarding>,
      agreementRepository as unknown as Repository<CustomerAgreement>,
      riskProfileRepository as unknown as Repository<CustomerRiskProfile>,
      taskRepository as unknown as Repository<CustomerOnboardingTask>,
      approvalRepository as unknown as Repository<CustomerApprovalDecision>,
      customerRepository as unknown as Repository<Customer>,
      profileRepository as unknown as Repository<CustomerProfile>,
      addressRepository as unknown as Repository<CustomerAddress>,
      identityDocumentRepository as unknown as Repository<CustomerIdentityDocument>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        customerRepository,
        profileRepository,
        addressRepository,
        identityDocumentRepository,
      },
    };
  }

  async function createCustomer(
    fixtureResult: ReturnType<typeof fixture>,
    status: CustomerStatus = CustomerStatus.ACTIVE,
  ): Promise<Customer> {
    const customer = fixtureResult.repositories.customerRepository.create({
      id: '00000000-0000-4000-8000-000000000001',
      reference: 'onboarding-customer',
      type: CustomerType.INDIVIDUAL,
      status,
      kycLevel: CustomerKycLevel.NONE,
      kycStatus: CustomerKycStatus.NOT_STARTED,
      version: 1,
      deletedAt: null,
    });
    return fixtureResult.repositories.customerRepository.save(customer);
  }

  async function addCoreEvidence(
    fixtureResult: ReturnType<typeof fixture>,
    customerId: string,
  ): Promise<void> {
    await fixtureResult.repositories.profileRepository.save(
      fixtureResult.repositories.profileRepository.create({
        id: '00000000-0000-4000-8000-000000000101',
        customerId,
        displayName: 'Onboarding Customer',
        isActive: true,
        deletedAt: null,
      }),
    );
    await fixtureResult.repositories.addressRepository.save(
      fixtureResult.repositories.addressRepository.create({
        id: '00000000-0000-4000-8000-000000000102',
        customerId,
        type: AddressType.RESIDENTIAL,
        lineOne: '1 Test Street',
        city: 'Lagos',
        state: 'Lagos',
        country: 'NG',
        isPrimary: true,
        deletedAt: null,
      }),
    );
    await fixtureResult.repositories.identityDocumentRepository.save(
      fixtureResult.repositories.identityDocumentRepository.create({
        id: '00000000-0000-4000-8000-000000000103',
        customerId,
        type: IdentityDocumentType.NIN,
        documentNumber: '12345678901',
        issuingCountry: 'NG',
        deletedAt: null,
      }),
    );
  }

  it('creates onboarding and rejects a duplicate active workflow', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const onboarding = await testFixture.service.createOnboarding(customer.id, {
      actor: 'onboarding-ops',
    });

    expect(onboarding.status).toBe(CustomerOnboardingStatus.NOT_STARTED);
    await expect(
      testFixture.service.createOnboarding(customer.id, { actor: 'onboarding-ops' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('persists evidence, calculates readiness, completes onboarding, and audits mutations', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const onboarding = await testFixture.service.createOnboarding(customer.id, {
      actor: 'onboarding-ops',
    });
    await addCoreEvidence(testFixture, customer.id);
    await testFixture.service.createRiskProfile(customer.id, {
      riskLevel: CustomerRiskLevel.LOW,
      rationale: 'Standard internal assessment',
      assessedBy: 'risk-ops',
    });
    await testFixture.service.createAgreement(customer.id, {
      type: CustomerAgreementType.TERMS_AND_CONDITIONS,
      version: '2026.01',
      isRequired: true,
      accepted: true,
      acceptedBy: 'customer',
      actor: 'onboarding-ops',
    });
    await testFixture.service.createTask(customer.id, {
      type: CustomerOnboardingTaskType.PROFILE_COMPLETION,
      status: CustomerOnboardingTaskStatus.COMPLETED,
      isRequired: true,
      completedBy: 'onboarding-ops',
      actor: 'onboarding-ops',
    });

    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.IN_PROGRESS,
      actor: 'onboarding-ops',
    });
    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.AWAITING_REVIEW,
      actor: 'onboarding-ops',
    });
    await testFixture.service.createApproval(customer.id, {
      decision: CustomerApprovalDecisionStatus.PENDING,
      decidedBy: 'review-ops',
    });
    await testFixture.service.createApproval(customer.id, {
      decision: CustomerApprovalDecisionStatus.APPROVED,
      decidedBy: 'review-ops',
    });
    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.APPROVED,
      actor: 'review-ops',
    });

    const readiness = await testFixture.service.getReadiness(customer.id);
    expect(readiness.status).toBe('READY');
    expect(readiness.canComplete).toBe(true);
    expect(readiness.missing).toEqual([]);

    const completed = await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.COMPLETED,
      actor: 'review-ops',
    });
    expect(completed.status).toBe(CustomerOnboardingStatus.COMPLETED);
    expect(testFixture.audit.record).toHaveBeenCalled();
    expect(testFixture.audit.record.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(onboarding.id).toBe(completed.id);
  });

  it('rejects completion when mandatory evidence is missing', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await testFixture.service.createOnboarding(customer.id, { actor: 'onboarding-ops' });
    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.IN_PROGRESS,
      actor: 'onboarding-ops',
    });
    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.AWAITING_REVIEW,
      actor: 'onboarding-ops',
    });
    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.APPROVED,
      actor: 'review-ops',
    });

    await expect(
      testFixture.service.updateOnboarding(customer.id, {
        status: CustomerOnboardingStatus.COMPLETED,
        actor: 'review-ops',
      }),
    ).rejects.toThrow('profile, address, identity_document, required_agreements, required_tasks');
  });

  it('rejects duplicate current risk profiles and duplicate approval decisions', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await testFixture.service.createOnboarding(customer.id, { actor: 'onboarding-ops' });
    await testFixture.service.createRiskProfile(customer.id, {
      riskLevel: CustomerRiskLevel.MEDIUM,
      assessedBy: 'risk-ops',
    });
    await expect(
      testFixture.service.createRiskProfile(customer.id, {
        riskLevel: CustomerRiskLevel.HIGH,
        assessedBy: 'risk-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await testFixture.service.createApproval(customer.id, {
      decision: CustomerApprovalDecisionStatus.PENDING,
      decidedBy: 'review-ops',
    });
    await expect(
      testFixture.service.createApproval(customer.id, {
        decision: CustomerApprovalDecisionStatus.PENDING,
        decidedBy: 'review-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects prohibited risk approval and invalid lifecycle transitions', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await testFixture.service.createOnboarding(customer.id, { actor: 'onboarding-ops' });
    await testFixture.service.createRiskProfile(customer.id, {
      riskLevel: CustomerRiskLevel.PROHIBITED,
      assessedBy: 'risk-ops',
    });

    await expect(
      testFixture.service.createApproval(customer.id, {
        decision: CustomerApprovalDecisionStatus.APPROVED,
        decidedBy: 'review-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      testFixture.service.updateOnboarding(customer.id, {
        status: CustomerOnboardingStatus.APPROVED,
        actor: 'review-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.IN_PROGRESS,
      actor: 'onboarding-ops',
    });
    await testFixture.service.updateOnboarding(customer.id, {
      status: CustomerOnboardingStatus.REJECTED,
      actor: 'review-ops',
    });
    await expect(
      testFixture.service.updateOnboarding(customer.id, {
        status: CustomerOnboardingStatus.COMPLETED,
        actor: 'review-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates risk and task DTO enums', async () => {
    const riskErrors = await validate(
      plainToInstance(CreateCustomerRiskProfileDto, {
        riskLevel: 'UNSUPPORTED',
        assessedBy: 'risk-ops',
      }),
    );
    expect(riskErrors.some((error) => error.property === 'riskLevel')).toBe(true);

    const taskErrors = await validate(
      plainToInstance(CreateCustomerOnboardingTaskDto, {
        type: 'UNSUPPORTED',
        status: CustomerOnboardingTaskStatus.PENDING,
        isRequired: true,
        actor: 'onboarding-ops',
      }),
    );
    expect(taskErrors.some((error) => error.property === 'type')).toBe(true);
  });
});
