import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { Customer } from '../customer/customer.entity';
import { CustomerStatus } from '../customer/customer.enums';
import { CustomerAddress } from '../customer/customer-address.entity';
import { CustomerIdentityDocument } from '../customer/customer-identity-document.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { AuditService } from '../operations/audit.service';
import { CustomerAgreement } from './customer-agreement.entity';
import { CustomerApprovalDecision } from './customer-approval-decision.entity';
import {
  CustomerApprovalDecisionStatus,
  CustomerOnboardingStatus,
  CustomerOnboardingTaskStatus,
  CustomerRiskLevel,
} from './customer-onboarding.enums';
import { CustomerOnboarding } from './customer-onboarding.entity';
import type {
  CreateCustomerAgreementCommand,
  CreateCustomerApprovalDecisionCommand,
  CreateCustomerOnboardingCommand,
  CreateCustomerOnboardingTaskCommand,
  CreateCustomerRiskProfileCommand,
  CustomerOnboardingReadiness,
  UpdateCustomerOnboardingCommand,
} from './customer-onboarding.types';
import { CustomerOnboardingTask } from './customer-onboarding-task.entity';
import { CustomerRiskProfile } from './customer-risk-profile.entity';

const ACTIVE_ONBOARDING_STATUSES = [
  CustomerOnboardingStatus.NOT_STARTED,
  CustomerOnboardingStatus.IN_PROGRESS,
  CustomerOnboardingStatus.AWAITING_REVIEW,
  CustomerOnboardingStatus.APPROVED,
];

@Injectable()
export class CustomerOnboardingService {
  constructor(
    @InjectRepository(CustomerOnboarding)
    private readonly onboardingRepository: Repository<CustomerOnboarding>,
    @InjectRepository(CustomerAgreement)
    private readonly agreementRepository: Repository<CustomerAgreement>,
    @InjectRepository(CustomerRiskProfile)
    private readonly riskProfileRepository: Repository<CustomerRiskProfile>,
    @InjectRepository(CustomerOnboardingTask)
    private readonly taskRepository: Repository<CustomerOnboardingTask>,
    @InjectRepository(CustomerApprovalDecision)
    private readonly approvalRepository: Repository<CustomerApprovalDecision>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerProfile)
    private readonly profileRepository: Repository<CustomerProfile>,
    @InjectRepository(CustomerAddress)
    private readonly addressRepository: Repository<CustomerAddress>,
    @InjectRepository(CustomerIdentityDocument)
    private readonly identityDocumentRepository: Repository<CustomerIdentityDocument>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createOnboarding(
    customerId: string,
    command: CreateCustomerOnboardingCommand,
  ): Promise<CustomerOnboarding> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const customer = await this.requireCustomer(manager, customerId);
        if (customer.status === CustomerStatus.CLOSED) {
          throw new ConflictException('Closed customers cannot start onboarding');
        }
        const repository = manager.getRepository(CustomerOnboarding);
        const existing = await this.findLatestOnboarding(repository, customerId, true);
        if (existing) {
          throw new ConflictException('Customer already has an active onboarding workflow');
        }
        const onboarding = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            status: CustomerOnboardingStatus.NOT_STARTED,
            version: 1,
            startedAt: null,
            approvedAt: null,
            rejectedAt: null,
            completedAt: null,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_ONBOARDING',
          onboarding.id,
          'CREATED',
          actor,
          undefined,
          this.onboardingValues(onboarding),
        );
        return onboarding;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has an active onboarding workflow');
      }
      throw error;
    }
  }

  async getOnboarding(customerId: string): Promise<CustomerOnboarding> {
    this.assertUuid(customerId, 'customerId');
    const onboarding = await this.findLatestOnboarding(this.onboardingRepository, customerId);
    if (!onboarding) {
      throw new NotFoundException(`Onboarding for customer ${customerId} was not found`);
    }
    return onboarding;
  }

  async updateOnboarding(
    customerId: string,
    command: UpdateCustomerOnboardingCommand,
  ): Promise<CustomerOnboarding> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.requireCustomer(manager, customerId);
      const repository = manager.getRepository(CustomerOnboarding);
      const onboarding = await this.findLatestOnboarding(repository, customerId);
      if (!onboarding) {
        throw new NotFoundException(`Onboarding for customer ${customerId} was not found`);
      }
      if (command.version !== undefined && command.version !== onboarding.version) {
        throw new ConflictException('Onboarding version is stale');
      }
      if (onboarding.status === command.status) {
        return onboarding;
      }
      this.assertOnboardingTransition(onboarding.status, command.status);
      if (command.status === CustomerOnboardingStatus.APPROVED) {
        const riskProfile = await this.findCurrentRiskProfile(
          manager.getRepository(CustomerRiskProfile),
          customerId,
        );
        if (riskProfile?.riskLevel === CustomerRiskLevel.PROHIBITED) {
          throw new ConflictException('PROHIBITED risk cannot become APPROVED');
        }
      }
      if (command.status === CustomerOnboardingStatus.COMPLETED) {
        const readiness = await this.calculateReadiness(manager, customer, onboarding);
        if (!readiness.canComplete) {
          throw new ConflictException(
            `Onboarding cannot be completed: ${readiness.missing.join(', ')}`,
          );
        }
      }
      const previous = this.onboardingValues(onboarding);
      const now = new Date();
      onboarding.status = command.status;
      if (command.status === CustomerOnboardingStatus.IN_PROGRESS && !onboarding.startedAt) {
        onboarding.startedAt = now;
      }
      if (command.status === CustomerOnboardingStatus.APPROVED) {
        onboarding.approvedAt = now;
      }
      if (command.status === CustomerOnboardingStatus.REJECTED) {
        onboarding.rejectedAt = now;
      }
      if (command.status === CustomerOnboardingStatus.COMPLETED) {
        onboarding.completedAt = now;
      }
      const saved = await repository.save(onboarding);
      await this.audit(
        manager,
        'CUSTOMER_ONBOARDING',
        saved.id,
        'STATUS_UPDATED',
        actor,
        previous,
        this.onboardingValues(saved),
      );
      return saved;
    });
  }

  async createAgreement(
    customerId: string,
    command: CreateCustomerAgreementCommand,
  ): Promise<CustomerAgreement> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const agreementVersion = this.normalizeText(command.version, 'version', 40);
    const acceptedBy = command.accepted ? this.normalizeActor(command.acceptedBy ?? actor) : null;
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const onboarding = await this.requireActiveOnboarding(manager, customerId);
        const repository = manager.getRepository(CustomerAgreement);
        const existing = await repository.findOne({
          where: {
            customerId,
            onboardingId: onboarding.id,
            type: command.type,
            agreementVersion,
          },
        });
        if (existing) {
          throw new ConflictException(
            'This agreement version already exists for the onboarding workflow',
          );
        }
        const agreement = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            onboardingId: onboarding.id,
            type: command.type,
            agreementVersion,
            isRequired: command.isRequired,
            accepted: command.accepted,
            acceptedAt: command.accepted ? new Date() : null,
            acceptedBy,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_AGREEMENT',
          agreement.id,
          'CREATED',
          actor,
          undefined,
          this.agreementValues(agreement),
        );
        return agreement;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'This agreement version already exists for the onboarding workflow',
        );
      }
      throw error;
    }
  }

  async listAgreements(customerId: string): Promise<CustomerAgreement[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.dataSource.manager, customerId);
    const agreements = await this.agreementRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(agreements);
  }

  async createRiskProfile(
    customerId: string,
    command: CreateCustomerRiskProfileCommand,
  ): Promise<CustomerRiskProfile> {
    this.assertUuid(customerId, 'customerId');
    const assessedBy = this.normalizeActor(command.assessedBy);
    const rationale =
      command.rationale === undefined
        ? null
        : this.normalizeText(command.rationale, 'rationale', 500);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const onboarding = await this.requireActiveOnboarding(manager, customerId);
        const repository = manager.getRepository(CustomerRiskProfile);
        const existing = await this.findCurrentRiskProfile(repository, customerId);
        if (existing) {
          throw new ConflictException('Customer already has a current risk profile');
        }
        const riskProfile = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            onboardingId: onboarding.id,
            riskLevel: command.riskLevel,
            rationale,
            assessedBy,
            isCurrent: true,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_RISK_PROFILE',
          riskProfile.id,
          'CREATED',
          assessedBy,
          undefined,
          this.riskProfileValues(riskProfile),
        );
        return riskProfile;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has a current risk profile');
      }
      throw error;
    }
  }

  async getRiskProfile(customerId: string): Promise<CustomerRiskProfile> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.dataSource.manager, customerId);
    const riskProfile = await this.findCurrentRiskProfile(this.riskProfileRepository, customerId);
    if (!riskProfile) {
      throw new NotFoundException(`Current risk profile for customer ${customerId} was not found`);
    }
    return riskProfile;
  }

  async createTask(
    customerId: string,
    command: CreateCustomerOnboardingTaskCommand,
  ): Promise<CustomerOnboardingTask> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const completedBy =
      command.status === CustomerOnboardingTaskStatus.COMPLETED
        ? this.normalizeActor(command.completedBy ?? actor)
        : null;
    const notes =
      command.notes === undefined ? null : this.normalizeText(command.notes, 'notes', 500);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager, customerId);
      const onboarding = await this.requireActiveOnboarding(manager, customerId);
      const repository = manager.getRepository(CustomerOnboardingTask);
      const task = await repository.save(
        repository.create({
          id: randomUUID(),
          customerId,
          onboardingId: onboarding.id,
          type: command.type,
          status: command.status,
          isRequired: command.isRequired,
          completedAt:
            command.status === CustomerOnboardingTaskStatus.COMPLETED ? new Date() : null,
          completedBy,
          notes,
          version: 1,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_ONBOARDING_TASK',
        task.id,
        'CREATED',
        actor,
        undefined,
        this.taskValues(task),
      );
      return task;
    });
  }

  async listTasks(customerId: string): Promise<CustomerOnboardingTask[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.dataSource.manager, customerId);
    const tasks = await this.taskRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(tasks);
  }

  async createApproval(
    customerId: string,
    command: CreateCustomerApprovalDecisionCommand,
  ): Promise<CustomerApprovalDecision> {
    this.assertUuid(customerId, 'customerId');
    const decidedBy = this.normalizeActor(command.decidedBy);
    const reason =
      command.reason === undefined ? null : this.normalizeText(command.reason, 'reason', 500);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const onboarding = await this.requireActiveOnboarding(manager, customerId);
        const repository = manager.getRepository(CustomerApprovalDecision);
        const current = await this.findLatestApproval(repository, customerId);
        if (current?.decision === command.decision) {
          throw new ConflictException(`Approval decision is already ${command.decision}`);
        }
        if (current) {
          this.assertApprovalTransition(current.decision, command.decision);
        }
        if (command.decision === CustomerApprovalDecisionStatus.APPROVED) {
          const riskProfile = await this.findCurrentRiskProfile(
            manager.getRepository(CustomerRiskProfile),
            customerId,
          );
          if (riskProfile?.riskLevel === CustomerRiskLevel.PROHIBITED) {
            throw new ConflictException('PROHIBITED risk cannot become APPROVED');
          }
        }
        if (current) {
          const previous = this.approvalValues(current);
          current.isLatest = false;
          const superseded = await repository.save(current);
          await this.audit(
            manager,
            'CUSTOMER_APPROVAL_DECISION',
            superseded.id,
            'SUPERSEDED',
            decidedBy,
            previous,
            this.approvalValues(superseded),
          );
        }
        const decision = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            onboardingId: onboarding.id,
            decision: command.decision,
            reason,
            decidedBy,
            isLatest: true,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_APPROVAL_DECISION',
          decision.id,
          'CREATED',
          decidedBy,
          undefined,
          this.approvalValues(decision),
        );
        return decision;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has a latest approval decision');
      }
      throw error;
    }
  }

  async getApproval(customerId: string): Promise<CustomerApprovalDecision> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.dataSource.manager, customerId);
    const decision = await this.findLatestApproval(this.approvalRepository, customerId);
    if (!decision) {
      throw new NotFoundException(
        `Latest approval decision for customer ${customerId} was not found`,
      );
    }
    return decision;
  }

  async getReadiness(customerId: string): Promise<CustomerOnboardingReadiness> {
    this.assertUuid(customerId, 'customerId');
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.requireCustomer(manager, customerId);
      const onboarding = await this.findLatestOnboarding(
        manager.getRepository(CustomerOnboarding),
        customerId,
      );
      if (!onboarding) {
        return {
          customerId,
          onboardingId: null,
          onboardingStatus: null,
          status: 'NOT_READY',
          canComplete: false,
          missing: ['onboarding'],
          checks: {
            customerActive: customer.status === CustomerStatus.ACTIVE,
            profilePresent: false,
            addressPresent: false,
            identityDocumentPresent: false,
            requiredAgreementsAccepted: false,
            requiredTasksCompleted: false,
            riskAllowed: true,
            onboardingNotRejected: false,
          },
          evaluatedAt: new Date().toISOString(),
        };
      }
      return this.calculateReadiness(manager, customer, onboarding);
    });
  }

  private async calculateReadiness(
    manager: EntityManager,
    customer: Customer,
    onboarding: CustomerOnboarding,
  ): Promise<CustomerOnboardingReadiness> {
    const profileRecords = await manager
      .getRepository(CustomerProfile)
      .find({ where: { customerId: customer.id, isActive: true } });
    const addressRecords = await manager
      .getRepository(CustomerAddress)
      .find({ where: { customerId: customer.id } });
    const identityRecords = await manager
      .getRepository(CustomerIdentityDocument)
      .find({ where: { customerId: customer.id } });
    const agreementRecords = await manager
      .getRepository(CustomerAgreement)
      .find({ where: { customerId: customer.id, onboardingId: onboarding.id } });
    const taskRecords = await manager
      .getRepository(CustomerOnboardingTask)
      .find({ where: { customerId: customer.id, onboardingId: onboarding.id } });
    const riskProfile = await this.findCurrentRiskProfile(
      manager.getRepository(CustomerRiskProfile),
      customer.id,
    );

    const profilePresent = profileRecords.some(
      (profile) => profile.isActive && this.isNotDeleted(profile.deletedAt),
    );
    const addressPresent = addressRecords.some((address) => this.isNotDeleted(address.deletedAt));
    const identityDocumentPresent = identityRecords.some((document) =>
      this.isNotDeleted(document.deletedAt),
    );
    const requiredAgreements = agreementRecords.filter(
      (agreement) => agreement.isRequired && this.isNotDeleted(agreement.deletedAt),
    );
    const requiredTasks = taskRecords.filter(
      (task) => task.isRequired && this.isNotDeleted(task.deletedAt),
    );
    const requiredAgreementsAccepted =
      requiredAgreements.length > 0 && requiredAgreements.every((agreement) => agreement.accepted);
    const requiredTasksCompleted =
      requiredTasks.length > 0 &&
      requiredTasks.every((task) => task.status === CustomerOnboardingTaskStatus.COMPLETED);
    const customerActive = customer.status === CustomerStatus.ACTIVE;
    const riskAllowed = riskProfile?.riskLevel !== CustomerRiskLevel.PROHIBITED;
    const onboardingNotRejected = onboarding.status !== CustomerOnboardingStatus.REJECTED;
    const workflowReady =
      onboarding.status === CustomerOnboardingStatus.APPROVED ||
      onboarding.status === CustomerOnboardingStatus.COMPLETED;
    const missing: string[] = [];

    if (!customerActive) {
      missing.push('customer_active');
    }
    if (!profilePresent) {
      missing.push('profile');
    }
    if (!addressPresent) {
      missing.push('address');
    }
    if (!identityDocumentPresent) {
      missing.push('identity_document');
    }
    if (!requiredAgreementsAccepted) {
      missing.push('required_agreements');
    }
    if (!requiredTasksCompleted) {
      missing.push('required_tasks');
    }
    if (!riskAllowed) {
      missing.push('risk_allowed');
    }
    if (!onboardingNotRejected) {
      missing.push('onboarding_not_rejected');
    }
    if (!workflowReady && onboardingNotRejected) {
      missing.push('onboarding_status_approved');
    }

    const evidenceReady =
      customerActive &&
      profilePresent &&
      addressPresent &&
      identityDocumentPresent &&
      requiredAgreementsAccepted &&
      requiredTasksCompleted &&
      riskAllowed &&
      onboardingNotRejected;
    const canComplete = evidenceReady && onboarding.status === CustomerOnboardingStatus.APPROVED;
    const ready = evidenceReady && workflowReady;
    return {
      customerId: customer.id,
      onboardingId: onboarding.id,
      onboardingStatus: onboarding.status,
      status: ready ? 'READY' : 'NOT_READY',
      canComplete,
      missing,
      checks: {
        customerActive,
        profilePresent,
        addressPresent,
        identityDocumentPresent,
        requiredAgreementsAccepted,
        requiredTasksCompleted,
        riskAllowed,
        onboardingNotRejected,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }

  private async requireActiveOnboarding(
    manager: EntityManager,
    customerId: string,
  ): Promise<CustomerOnboarding> {
    const onboarding = await this.findLatestOnboarding(
      manager.getRepository(CustomerOnboarding),
      customerId,
      true,
    );
    if (!onboarding) {
      throw new NotFoundException(`Active onboarding for customer ${customerId} was not found`);
    }
    return onboarding;
  }

  private async requireCustomer(manager: EntityManager, id: string): Promise<Customer> {
    const customer = await manager.getRepository(Customer).findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} was not found`);
    }
    return customer;
  }

  private async findLatestOnboarding(
    repository: Repository<CustomerOnboarding>,
    customerId: string,
    activeOnly = false,
  ): Promise<CustomerOnboarding | null> {
    const records = await repository.find({ where: { customerId } });
    return this.latest(
      records.filter(
        (record) =>
          this.isNotDeleted(record.deletedAt) &&
          (!activeOnly || ACTIVE_ONBOARDING_STATUSES.includes(record.status)),
      ),
    );
  }

  private async findCurrentRiskProfile(
    repository: Repository<CustomerRiskProfile>,
    customerId: string,
  ): Promise<CustomerRiskProfile | null> {
    const records = await repository.find({ where: { customerId, isCurrent: true } });
    return records.find((record) => this.isNotDeleted(record.deletedAt)) ?? null;
  }

  private async findLatestApproval(
    repository: Repository<CustomerApprovalDecision>,
    customerId: string,
  ): Promise<CustomerApprovalDecision | null> {
    const records = await repository.find({ where: { customerId, isLatest: true } });
    return this.latest(records.filter((record) => this.isNotDeleted(record.deletedAt)));
  }

  private assertOnboardingTransition(
    current: CustomerOnboardingStatus,
    next: CustomerOnboardingStatus,
  ): void {
    const allowed: Record<CustomerOnboardingStatus, CustomerOnboardingStatus[]> = {
      [CustomerOnboardingStatus.NOT_STARTED]: [CustomerOnboardingStatus.IN_PROGRESS],
      [CustomerOnboardingStatus.IN_PROGRESS]: [
        CustomerOnboardingStatus.AWAITING_REVIEW,
        CustomerOnboardingStatus.REJECTED,
      ],
      [CustomerOnboardingStatus.AWAITING_REVIEW]: [
        CustomerOnboardingStatus.APPROVED,
        CustomerOnboardingStatus.REJECTED,
      ],
      [CustomerOnboardingStatus.APPROVED]: [CustomerOnboardingStatus.COMPLETED],
      [CustomerOnboardingStatus.REJECTED]: [],
      [CustomerOnboardingStatus.COMPLETED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid onboarding transition from ${current} to ${next}`);
    }
  }

  private assertApprovalTransition(
    current: CustomerApprovalDecisionStatus,
    next: CustomerApprovalDecisionStatus,
  ): void {
    const allowed: Record<CustomerApprovalDecisionStatus, CustomerApprovalDecisionStatus[]> = {
      [CustomerApprovalDecisionStatus.PENDING]: [
        CustomerApprovalDecisionStatus.APPROVED,
        CustomerApprovalDecisionStatus.REJECTED,
        CustomerApprovalDecisionStatus.ESCALATED,
      ],
      [CustomerApprovalDecisionStatus.ESCALATED]: [
        CustomerApprovalDecisionStatus.PENDING,
        CustomerApprovalDecisionStatus.APPROVED,
        CustomerApprovalDecisionStatus.REJECTED,
      ],
      [CustomerApprovalDecisionStatus.APPROVED]: [],
      [CustomerApprovalDecisionStatus.REJECTED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid approval transition from ${current} to ${next}`);
    }
  }

  private async audit(
    manager: EntityManager,
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    previousValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType,
      entityId,
      action,
      actor,
      previousValues,
      newValues,
    });
  }

  private onboardingValues(onboarding: CustomerOnboarding): Record<string, unknown> {
    return {
      customerId: onboarding.customerId,
      status: onboarding.status,
      version: onboarding.version,
      startedAt: onboarding.startedAt,
      approvedAt: onboarding.approvedAt,
      rejectedAt: onboarding.rejectedAt,
      completedAt: onboarding.completedAt,
    };
  }

  private agreementValues(agreement: CustomerAgreement): Record<string, unknown> {
    return {
      customerId: agreement.customerId,
      onboardingId: agreement.onboardingId,
      type: agreement.type,
      agreementVersion: agreement.agreementVersion,
      isRequired: agreement.isRequired,
      accepted: agreement.accepted,
      acceptedAt: agreement.acceptedAt,
      acceptedBy: agreement.acceptedBy,
      version: agreement.version,
    };
  }

  private riskProfileValues(profile: CustomerRiskProfile): Record<string, unknown> {
    return {
      customerId: profile.customerId,
      onboardingId: profile.onboardingId,
      riskLevel: profile.riskLevel,
      rationale: profile.rationale,
      assessedBy: profile.assessedBy,
      isCurrent: profile.isCurrent,
      version: profile.version,
    };
  }

  private taskValues(task: CustomerOnboardingTask): Record<string, unknown> {
    return {
      customerId: task.customerId,
      onboardingId: task.onboardingId,
      type: task.type,
      status: task.status,
      isRequired: task.isRequired,
      completedAt: task.completedAt,
      completedBy: task.completedBy,
      notes: task.notes,
      version: task.version,
    };
  }

  private approvalValues(decision: CustomerApprovalDecision): Record<string, unknown> {
    return {
      customerId: decision.customerId,
      onboardingId: decision.onboardingId,
      decision: decision.decision,
      reason: decision.reason,
      decidedBy: decision.decidedBy,
      isLatest: decision.isLatest,
      version: decision.version,
    };
  }

  private normalizeActor(actor: string): string {
    return this.normalizeText(actor, 'actor', 160);
  }

  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max) {
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    }
    return normalized;
  }

  private assertUuid(id: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }

  private isNotDeleted(value: Date | null | undefined): boolean {
    return value === null || value === undefined;
  }

  private sortByCreatedAt<T extends { createdAt: Date; id: string }>(records: T[]): T[] {
    return [...records].sort((left, right) => {
      const timeDifference = right.createdAt.getTime() - left.createdAt.getTime();
      return timeDifference || right.id.localeCompare(left.id);
    });
  }

  private latest<T extends { createdAt: Date; id: string }>(records: T[]): T | null {
    return this.sortByCreatedAt(records)[0] ?? null;
  }
}
