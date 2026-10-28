import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindOperator } from 'typeorm';
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
import { ComplianceCaseAssignment } from '../src/customer-compliance/compliance-case-assignment.entity';
import { ComplianceCaseComment } from '../src/customer-compliance/compliance-case-comment.entity';
import { ComplianceCaseEvidence } from '../src/customer-compliance/compliance-case-evidence.entity';
import { ComplianceCaseHistory } from '../src/customer-compliance/compliance-case-history.entity';
import { CustomerComplianceCase } from '../src/customer-compliance/customer-compliance-case.entity';
import {
  ComplianceCaseCategory,
  ComplianceCaseHistoryAction,
  ComplianceCaseSeverity,
  ComplianceCaseStatus,
} from '../src/customer-compliance/customer-compliance.enums';
import { CustomerComplianceService } from '../src/customer-compliance/customer-compliance.service';
import { CreateComplianceCaseDto } from '../src/customer-compliance/dto/create-compliance-case.dto';
import { UpdateComplianceCaseDto } from '../src/customer-compliance/dto/update-compliance-case.dto';
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
          return expected instanceof FindOperator && expected.type === 'in'
            ? (expected.value as unknown[]).includes(actual)
            : actual === expected;
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
          return expected instanceof FindOperator && expected.type === 'in'
            ? (expected.value as unknown[]).includes(actual)
            : actual === expected;
        }),
      ),
    );
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) throw new Error('Unexpected compliance repository');
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

describe('CustomerComplianceService', () => {
  const access = (actor = 'compliance-ops') => ({
    actor,
    categories: Object.values(ComplianceCaseCategory),
  });
  function fixture() {
    const caseRepository = new MemoryRepository<CustomerComplianceCase>();
    const historyRepository = new MemoryRepository<ComplianceCaseHistory>();
    const assignmentRepository = new MemoryRepository<ComplianceCaseAssignment>();
    const commentRepository = new MemoryRepository<ComplianceCaseComment>();
    const evidenceRepository = new MemoryRepository<ComplianceCaseEvidence>();
    const customerRepository = new MemoryRepository<Customer>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [CustomerComplianceCase, caseRepository as unknown as MemoryRepository<ObjectLiteral>],
      [ComplianceCaseHistory, historyRepository as unknown as MemoryRepository<ObjectLiteral>],
      [
        ComplianceCaseAssignment,
        assignmentRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [ComplianceCaseComment, commentRepository as unknown as MemoryRepository<ObjectLiteral>],
      [ComplianceCaseEvidence, evidenceRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerComplianceService(
      caseRepository as unknown as Repository<CustomerComplianceCase>,
      historyRepository as unknown as Repository<ComplianceCaseHistory>,
      assignmentRepository as unknown as Repository<ComplianceCaseAssignment>,
      commentRepository as unknown as Repository<ComplianceCaseComment>,
      evidenceRepository as unknown as Repository<ComplianceCaseEvidence>,
      customerRepository as unknown as Repository<Customer>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: {
        caseRepository,
        historyRepository,
        assignmentRepository,
        commentRepository,
        evidenceRepository,
        customerRepository,
      },
    };
  }

  async function createCustomer(testFixture: ReturnType<typeof fixture>): Promise<Customer> {
    return testFixture.repositories.customerRepository.save(
      testFixture.repositories.customerRepository.create({
        id: '00000000-0000-4000-8000-000000000001',
        reference: 'compliance-customer',
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_1,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  async function createCase(
    testFixture: ReturnType<typeof fixture>,
    customerId: string,
    caseNumber = 'case-001',
  ) {
    return testFixture.service.createCase(
      customerId,
      {
        caseNumber,
        category: ComplianceCaseCategory.KYC,
        severity: ComplianceCaseSeverity.MEDIUM,
      },
      access('compliance-ops'),
    );
  }

  it('creates compliance cases, rejects duplicate numbers, and audits creation history', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const complianceCase = await createCase(testFixture, customer.id);
    const history = await testFixture.service.listHistory(customer.id, complianceCase.id, access());

    expect(complianceCase.status).toBe(ComplianceCaseStatus.OPEN);
    expect(complianceCase.openedBy).toBe('compliance-ops');
    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe(ComplianceCaseHistoryAction.CASE_CREATED);
    expect(testFixture.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'CUSTOMER_COMPLIANCE_CASE' }),
    );
    await expect(createCase(testFixture, customer.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates lifecycle and resolution, then protects closed cases', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const complianceCase = await createCase(testFixture, customer.id);
    const reviewed = await testFixture.service.updateCase(
      customer.id,
      complianceCase.id,
      {
        status: ComplianceCaseStatus.UNDER_REVIEW,
      },
      access('compliance-ops'),
    );
    expect(reviewed.status).toBe(ComplianceCaseStatus.UNDER_REVIEW);
    const resolved = await testFixture.service.updateCase(
      customer.id,
      complianceCase.id,
      {
        status: ComplianceCaseStatus.RESOLVED,
        resolution: 'Metadata review completed',
      },
      access('compliance-ops'),
    );
    expect(resolved.resolution).toBe('Metadata review completed');
    const closed = await testFixture.service.updateCase(
      customer.id,
      complianceCase.id,
      {
        status: ComplianceCaseStatus.CLOSED,
      },
      access('compliance-ops'),
    );
    expect(closed.closedAt).toBeDefined();
    await expect(
      testFixture.service.updateCase(
        customer.id,
        complianceCase.id,
        {
          status: ComplianceCaseStatus.OPEN,
        },
        access('compliance-ops'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      testFixture.service.addComment(
        customer.id,
        complianceCase.id,
        {
          comment: 'Closed case mutation',
        },
        access('compliance-ops'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maintains append-only assignments, comments, evidence, and history', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const complianceCase = await createCase(testFixture, customer.id, 'case-append');
    await testFixture.service.assignCase(
      customer.id,
      complianceCase.id,
      {
        assignedTo: 'analyst-one',
      },
      access('compliance-lead'),
    );
    await testFixture.service.assignCase(
      customer.id,
      complianceCase.id,
      {
        assignedTo: 'analyst-two',
      },
      access('compliance-lead'),
    );
    await testFixture.service.addComment(
      customer.id,
      complianceCase.id,
      {
        comment: 'Case comment is immutable',
      },
      access('analyst-two'),
    );
    await testFixture.service.addEvidence(
      customer.id,
      complianceCase.id,
      {
        documentName: 'Review note',
        documentType: 'INTERNAL_NOTE',
        reference: 'evidence-001',
      },
      access('analyst-two'),
    );

    const assignments = await testFixture.service.listAssignments(
      customer.id,
      complianceCase.id,
      access(),
    );
    const comments = await testFixture.service.listComments(
      customer.id,
      complianceCase.id,
      access(),
    );
    const evidence = await testFixture.service.listEvidence(
      customer.id,
      complianceCase.id,
      access(),
    );
    const history = await testFixture.service.listHistory(customer.id, complianceCase.id, access());

    expect(assignments).toHaveLength(2);
    expect(assignments[0]?.assignedTo).toBe('analyst-one');
    expect(assignments[1]?.assignedTo).toBe('analyst-two');
    expect(comments).toHaveLength(1);
    expect(evidence).toHaveLength(1);
    expect(history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        ComplianceCaseHistoryAction.ASSIGNMENT_CHANGED,
        ComplianceCaseHistoryAction.COMMENT_ADDED,
        ComplianceCaseHistoryAction.EVIDENCE_ADDED,
      ]),
    );
  });

  it('fails closed on missing or wrong category scope while retaining complete internal policy evidence', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const kyc = await createCase(testFixture, customer.id, 'case-kyc-scope');
    const fraudAccess = { actor: 'fraud-analyst', categories: [ComplianceCaseCategory.FRAUD] };
    const fraud = await testFixture.service.createCase(
      customer.id,
      {
        caseNumber: 'case-fraud-scope',
        category: ComplianceCaseCategory.FRAUD,
        severity: ComplianceCaseSeverity.HIGH,
      },
      fraudAccess,
    );

    expect(
      (await testFixture.service.listCases(customer.id, fraudAccess)).map((item) => item.id),
    ).toEqual([fraud.id]);
    expect(
      (await testFixture.service.listCasesForPolicyEvidence(customer.id)).map((item) => item.id),
    ).toEqual(expect.arrayContaining([kyc.id, fraud.id]));
    await expect(
      testFixture.service.getCase(customer.id, kyc.id, fraudAccess),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      testFixture.service.createCase(
        customer.id,
        {
          caseNumber: 'denied-kyc',
          category: ComplianceCaseCategory.KYC,
          severity: ComplianceCaseSeverity.LOW,
        },
        fraudAccess,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      testFixture.service.listCases(customer.id, { actor: 'nobody', categories: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      testFixture.service.listCases(customer.id, undefined as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing guard context at every service entry point without writing', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const existing = await createCase(testFixture, customer.id);
    const missing = undefined as never;
    const calls = [
      () =>
        testFixture.service.createCase(
          customer.id,
          {
            caseNumber: 'missing-context',
            category: ComplianceCaseCategory.KYC,
            severity: ComplianceCaseSeverity.LOW,
          },
          missing,
        ),
      () => testFixture.service.listCases(customer.id, missing),
      () => testFixture.service.getCase(customer.id, existing.id, missing),
      () =>
        testFixture.service.updateCase(
          customer.id,
          existing.id,
          { status: ComplianceCaseStatus.UNDER_REVIEW },
          missing,
        ),
      () =>
        testFixture.service.addComment(customer.id, existing.id, { comment: 'denied' }, missing),
      () => testFixture.service.listComments(customer.id, existing.id, missing),
      () =>
        testFixture.service.addEvidence(
          customer.id,
          existing.id,
          {
            documentName: 'denied',
            documentType: 'NOTE',
            reference: 'denied',
          },
          missing,
        ),
      () => testFixture.service.listEvidence(customer.id, existing.id, missing),
      () =>
        testFixture.service.assignCase(customer.id, existing.id, { assignedTo: 'denied' }, missing),
      () => testFixture.service.listAssignments(customer.id, existing.id, missing),
      () => testFixture.service.listHistory(customer.id, existing.id, missing),
    ];
    const callsBefore = testFixture.audit.record.mock.calls.length;
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    expect(testFixture.audit.record).toHaveBeenCalledTimes(callsBefore);
    expect(testFixture.repositories.caseRepository.records.size).toBe(1);
    expect(testFixture.repositories.commentRepository.records.size).toBe(0);
    expect(testFixture.repositories.evidenceRepository.records.size).toBe(0);
    expect(testFixture.repositories.assignmentRepository.records.size).toBe(0);
  });

  it('validates DTOs and UUID parameters', async () => {
    const createErrors = await validate(
      plainToInstance(CreateComplianceCaseDto, {
        caseNumber: 'bad number',
        category: 'UNSUPPORTED',
        severity: 'INVALID',
        actor: 'compliance-ops',
      }),
    );
    expect(createErrors.some((error) => error.property === 'caseNumber')).toBe(true);
    expect(createErrors.some((error) => error.property === 'category')).toBe(true);
    expect(createErrors.some((error) => error.property === 'severity')).toBe(true);
    const updateErrors = await validate(
      plainToInstance(UpdateComplianceCaseDto, {
        status: 'INVALID',
        actor: 'compliance-ops',
      }),
    );
    expect(updateErrors.some((error) => error.property === 'status')).toBe(true);

    const testFixture = fixture();
    await expect(testFixture.service.listCases('not-a-uuid', access())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
