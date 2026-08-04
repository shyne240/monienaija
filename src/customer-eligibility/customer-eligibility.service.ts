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
import { CustomerOnboardingStatus } from '../customer-onboarding/customer-onboarding.enums';
import { CustomerOnboarding } from '../customer-onboarding/customer-onboarding.entity';
import { AuditService } from '../operations/audit.service';
import { CustomerEligibility } from './customer-eligibility.entity';
import {
  CustomerEligibilityStatus,
  CustomerProductEnrollmentStatus,
  CustomerRestrictionType,
  type CustomerOperatingStatus,
} from './customer-eligibility.enums';
import type {
  CreateCustomerEligibilityCommand,
  CreateCustomerLimitProfileCommand,
  CreateCustomerOperatingPermissionCommand,
  CreateCustomerProductEnrollmentCommand,
  CreateCustomerRestrictionCommand,
  CustomerOperatingStatusView,
  UpdateCustomerEligibilityCommand,
  UpdateCustomerLimitProfileCommand,
  UpdateCustomerProductEnrollmentCommand,
} from './customer-eligibility.types';
import { CustomerLimitProfile } from './customer-limit-profile.entity';
import { CustomerOperatingPermission } from './customer-operating-permission.entity';
import { CustomerProductEnrollment } from './customer-product-enrollment.entity';
import { CustomerRestriction } from './customer-restriction.entity';

const MAX_BIGINT = 9_223_372_036_854_775_807n;

@Injectable()
export class CustomerEligibilityService {
  constructor(
    @InjectRepository(CustomerEligibility)
    private readonly eligibilityRepository: Repository<CustomerEligibility>,
    @InjectRepository(CustomerLimitProfile)
    private readonly limitProfileRepository: Repository<CustomerLimitProfile>,
    @InjectRepository(CustomerProductEnrollment)
    private readonly enrollmentRepository: Repository<CustomerProductEnrollment>,
    @InjectRepository(CustomerOperatingPermission)
    private readonly permissionRepository: Repository<CustomerOperatingPermission>,
    @InjectRepository(CustomerRestriction)
    private readonly restrictionRepository: Repository<CustomerRestriction>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerOnboarding)
    private readonly onboardingRepository: Repository<CustomerOnboarding>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createEligibility(
    customerId: string,
    command: CreateCustomerEligibilityCommand,
  ): Promise<CustomerEligibility> {
    this.assertUuid(customerId, 'customerId');
    const reviewedBy = this.normalizeActor(command.actor);
    const status = command.status ?? CustomerEligibilityStatus.PENDING;
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const repository = manager.getRepository(CustomerEligibility);
        const existing = await this.findActiveEligibility(repository, customerId);
        if (existing) {
          throw new ConflictException('Customer already has an active eligibility record');
        }
        const onboardingId =
          status === CustomerEligibilityStatus.ELIGIBLE
            ? (await this.assertCanBecomeEligible(manager, customerId)).id
            : null;
        const eligibility = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            onboardingId,
            status,
            reason,
            reviewedBy,
            statusChangedAt: new Date(),
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_ELIGIBILITY',
          eligibility.id,
          'CREATED',
          reviewedBy,
          undefined,
          this.eligibilityValues(eligibility),
        );
        return eligibility;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has an active eligibility record');
      }
      throw error;
    }
  }

  async getEligibility(customerId: string): Promise<CustomerEligibility> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const eligibility = await this.findActiveEligibility(this.eligibilityRepository, customerId);
    if (!eligibility) {
      throw new NotFoundException(`Eligibility for customer ${customerId} was not found`);
    }
    return eligibility;
  }

  async updateEligibility(
    customerId: string,
    command: UpdateCustomerEligibilityCommand,
  ): Promise<CustomerEligibility> {
    this.assertUuid(customerId, 'customerId');
    const reviewedBy = this.normalizeActor(command.actor);
    const reason =
      command.reason === undefined
        ? undefined
        : this.normalizeOptionalText(command.reason, 'reason', 500);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager, customerId);
      const repository = manager.getRepository(CustomerEligibility);
      const eligibility = await this.findActiveEligibility(repository, customerId);
      if (!eligibility) {
        throw new NotFoundException(`Eligibility for customer ${customerId} was not found`);
      }
      if (command.version !== undefined && command.version !== eligibility.version) {
        throw new ConflictException('Eligibility version is stale');
      }
      const statusChanged = eligibility.status !== command.status;
      if (!statusChanged && reason === undefined) {
        return eligibility;
      }
      if (statusChanged) {
        this.assertEligibilityTransition(eligibility.status, command.status);
      }
      let onboardingId = eligibility.onboardingId;
      if (command.status === CustomerEligibilityStatus.ELIGIBLE) {
        onboardingId = (await this.assertCanBecomeEligible(manager, customerId)).id;
      }
      const previous = this.eligibilityValues(eligibility);
      eligibility.status = command.status;
      eligibility.reviewedBy = reviewedBy;
      if (reason !== undefined) {
        eligibility.reason = reason;
      }
      eligibility.onboardingId = onboardingId;
      if (statusChanged) {
        eligibility.statusChangedAt = new Date();
      }
      const saved = await repository.save(eligibility);
      await this.audit(
        manager,
        'CUSTOMER_ELIGIBILITY',
        saved.id,
        statusChanged ? 'STATUS_UPDATED' : 'UPDATED',
        reviewedBy,
        previous,
        this.eligibilityValues(saved),
      );
      return saved;
    });
  }

  async createLimitProfile(
    customerId: string,
    command: CreateCustomerLimitProfileCommand,
  ): Promise<CustomerLimitProfile> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const values = this.normalizeLimitCreate(command);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const repository = manager.getRepository(CustomerLimitProfile);
        const existing = await this.findActiveLimitProfile(repository, customerId);
        if (existing) {
          throw new ConflictException('Customer already has an active limit profile');
        }
        const profile = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            ...values,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_LIMIT_PROFILE',
          profile.id,
          'CREATED',
          actor,
          undefined,
          this.limitProfileValues(profile),
        );
        return profile;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has an active limit profile');
      }
      throw error;
    }
  }

  async getLimitProfile(customerId: string): Promise<CustomerLimitProfile> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const profile = await this.findActiveLimitProfile(this.limitProfileRepository, customerId);
    if (!profile) {
      throw new NotFoundException(`Limit profile for customer ${customerId} was not found`);
    }
    return profile;
  }

  async updateLimitProfile(
    customerId: string,
    command: UpdateCustomerLimitProfileCommand,
  ): Promise<CustomerLimitProfile> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager, customerId);
      const repository = manager.getRepository(CustomerLimitProfile);
      const profile = await this.findActiveLimitProfile(repository, customerId);
      if (!profile) {
        throw new NotFoundException(`Limit profile for customer ${customerId} was not found`);
      }
      if (command.version !== undefined && command.version !== profile.version) {
        throw new ConflictException('Limit profile version is stale');
      }
      const updates = this.normalizeLimitUpdate(command);
      if (Object.keys(updates).length === 0) {
        return profile;
      }
      const previous = this.limitProfileValues(profile);
      Object.assign(profile, updates);
      const saved = await repository.save(profile);
      await this.audit(
        manager,
        'CUSTOMER_LIMIT_PROFILE',
        saved.id,
        'UPDATED',
        actor,
        previous,
        this.limitProfileValues(saved),
      );
      return saved;
    });
  }

  async createEnrollment(
    customerId: string,
    command: CreateCustomerProductEnrollmentCommand,
  ): Promise<CustomerProductEnrollment> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const product = this.normalizeProduct(command.product);
    const status = command.status ?? CustomerProductEnrollmentStatus.PENDING;
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const repository = manager.getRepository(CustomerProductEnrollment);
        const existing = await repository.findOne({ where: { customerId, product } });
        if (existing && this.isNotDeleted(existing.deletedAt)) {
          throw new ConflictException(`Customer is already enrolled in product ${product}`);
        }
        if (status === CustomerProductEnrollmentStatus.ACTIVE) {
          await this.assertCanActivateEnrollment(manager, customerId);
        }
        const enrollment = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            product,
            status,
            reason,
            statusChangedAt: new Date(),
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_PRODUCT_ENROLLMENT',
          enrollment.id,
          'CREATED',
          actor,
          undefined,
          this.enrollmentValues(enrollment),
        );
        return enrollment;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Customer is already enrolled in product ${product}`);
      }
      throw error;
    }
  }

  async listEnrollments(customerId: string): Promise<CustomerProductEnrollment[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const enrollments = await this.enrollmentRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(
      enrollments.filter((enrollment) => this.isNotDeleted(enrollment.deletedAt)),
    );
  }

  async updateEnrollment(
    customerId: string,
    enrollmentId: string,
    command: UpdateCustomerProductEnrollmentCommand,
  ): Promise<CustomerProductEnrollment> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(enrollmentId, 'enrollmentId');
    const actor = this.normalizeActor(command.actor);
    const reason =
      command.reason === undefined
        ? undefined
        : this.normalizeOptionalText(command.reason, 'reason', 500);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager, customerId);
      const repository = manager.getRepository(CustomerProductEnrollment);
      const enrollment = await repository.findOne({ where: { id: enrollmentId, customerId } });
      if (!enrollment || !this.isNotDeleted(enrollment.deletedAt)) {
        throw new NotFoundException(`Enrollment ${enrollmentId} was not found`);
      }
      if (command.version !== undefined && command.version !== enrollment.version) {
        throw new ConflictException('Enrollment version is stale');
      }
      const statusChanged = enrollment.status !== command.status;
      if (!statusChanged && reason === undefined) {
        return enrollment;
      }
      if (statusChanged) {
        this.assertEnrollmentTransition(enrollment.status, command.status);
      }
      if (command.status === CustomerProductEnrollmentStatus.ACTIVE) {
        await this.assertCanActivateEnrollment(manager, customerId);
      }
      const previous = this.enrollmentValues(enrollment);
      enrollment.status = command.status;
      enrollment.reason = reason === undefined ? enrollment.reason : reason;
      if (statusChanged) {
        enrollment.statusChangedAt = new Date();
      }
      const saved = await repository.save(enrollment);
      await this.audit(
        manager,
        'CUSTOMER_PRODUCT_ENROLLMENT',
        saved.id,
        statusChanged ? 'STATUS_UPDATED' : 'UPDATED',
        actor,
        previous,
        this.enrollmentValues(saved),
      );
      return saved;
    });
  }

  async createPermission(
    customerId: string,
    command: CreateCustomerOperatingPermissionCommand,
  ): Promise<CustomerOperatingPermission> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const repository = manager.getRepository(CustomerOperatingPermission);
        const existing = await repository.findOne({
          where: { customerId, type: command.type },
        });
        if (existing && this.isNotDeleted(existing.deletedAt)) {
          throw new ConflictException(`Permission ${command.type} already exists`);
        }
        const permission = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: command.type,
            enabled: command.enabled,
            reason,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_OPERATING_PERMISSION',
          permission.id,
          'CREATED',
          actor,
          undefined,
          this.permissionValues(permission),
        );
        return permission;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Permission ${command.type} already exists`);
      }
      throw error;
    }
  }

  async listPermissions(customerId: string): Promise<CustomerOperatingPermission[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const permissions = await this.permissionRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(
      permissions.filter((permission) => this.isNotDeleted(permission.deletedAt)),
    );
  }

  async createRestriction(
    customerId: string,
    command: CreateCustomerRestrictionCommand,
  ): Promise<CustomerRestriction> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const reason = this.normalizeOptionalText(command.reason, 'reason', 500);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const repository = manager.getRepository(CustomerRestriction);
        const existing = await repository.findOne({ where: { customerId, type: command.type } });
        if (existing && this.isNotDeleted(existing.deletedAt)) {
          throw new ConflictException(`Restriction ${command.type} already exists`);
        }
        const restriction = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: command.type,
            isActive: command.isActive,
            reason,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_RESTRICTION',
          restriction.id,
          'CREATED',
          actor,
          undefined,
          this.restrictionValues(restriction),
        );
        return restriction;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Restriction ${command.type} already exists`);
      }
      throw error;
    }
  }

  async listRestrictions(customerId: string): Promise<CustomerRestriction[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const restrictions = await this.restrictionRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(
      restrictions.filter((restriction) => this.isNotDeleted(restriction.deletedAt)),
    );
  }

  async getOperatingStatus(customerId: string): Promise<CustomerOperatingStatusView> {
    this.assertUuid(customerId, 'customerId');
    const customer = await this.requireCustomer(this.customerRepository, customerId);
    const eligibility = await this.findActiveEligibility(this.eligibilityRepository, customerId);
    const restrictions = (await this.restrictionRepository.find({ where: { customerId } })).filter(
      (restriction) =>
        restriction.isActive &&
        restriction.type !== CustomerRestrictionType.NONE &&
        this.isNotDeleted(restriction.deletedAt),
    );
    const permissions = (await this.permissionRepository.find({ where: { customerId } })).filter(
      (permission) => permission.enabled && this.isNotDeleted(permission.deletedAt),
    );
    const enrollments = (await this.enrollmentRepository.find({ where: { customerId } })).filter(
      (enrollment) => this.isNotDeleted(enrollment.deletedAt),
    );
    const activeRestrictions = restrictions.map((restriction) => restriction.type);
    const activeEnrollmentProducts = enrollments
      .filter((enrollment) => enrollment.status === CustomerProductEnrollmentStatus.ACTIVE)
      .map((enrollment) => enrollment.product);
    const enabledPermissions = permissions.map((permission) => permission.type);
    const blockedReasons: string[] = [];
    const hasRestriction = (type: CustomerRestrictionType): boolean =>
      activeRestrictions.includes(type);
    if (!eligibility) {
      blockedReasons.push('ELIGIBILITY_NOT_FOUND');
    } else if (eligibility.status !== CustomerEligibilityStatus.ELIGIBLE) {
      blockedReasons.push(`ELIGIBILITY_${eligibility.status}`);
    }
    if (hasRestriction(CustomerRestrictionType.BLACKLISTED)) {
      blockedReasons.push('BLACKLISTED');
    }
    if (hasRestriction(CustomerRestrictionType.FROZEN)) {
      blockedReasons.push('FROZEN');
    }
    if (hasRestriction(CustomerRestrictionType.LIMITED)) {
      blockedReasons.push('LIMITED');
    }
    if (hasRestriction(CustomerRestrictionType.MANUAL_REVIEW)) {
      blockedReasons.push('MANUAL_REVIEW');
    }
    if (
      activeEnrollmentProducts.length > 0 &&
      eligibility?.status !== CustomerEligibilityStatus.ELIGIBLE
    ) {
      blockedReasons.push('ACTIVE_ENROLLMENTS_REQUIRE_ELIGIBLE_STATUS');
    }
    if (customer.status === CustomerStatus.CLOSED) {
      blockedReasons.push('CUSTOMER_CLOSED');
    }
    const status = this.operatingStatus(eligibility?.status, activeRestrictions, customer.status);
    return {
      customerId,
      status,
      canOperate: status === 'OPERABLE',
      eligibilityStatus: eligibility?.status ?? null,
      activeRestrictions,
      activeEnrollmentProducts,
      enabledPermissions,
      blockedReasons,
    };
  }

  private operatingStatus(
    eligibilityStatus: CustomerEligibilityStatus | undefined,
    restrictions: CustomerRestrictionType[],
    customerStatus: CustomerStatus,
  ): CustomerOperatingStatus {
    if (restrictions.includes(CustomerRestrictionType.BLACKLISTED)) {
      return 'BLACKLISTED';
    }
    if (restrictions.includes(CustomerRestrictionType.FROZEN)) {
      return 'FROZEN';
    }
    if (customerStatus === CustomerStatus.CLOSED) {
      return 'INELIGIBLE';
    }
    if (
      restrictions.includes(CustomerRestrictionType.LIMITED) ||
      restrictions.includes(CustomerRestrictionType.MANUAL_REVIEW)
    ) {
      return 'RESTRICTED';
    }
    if (eligibilityStatus === CustomerEligibilityStatus.REVOKED) {
      return 'REVOKED';
    }
    if (eligibilityStatus === CustomerEligibilityStatus.SUSPENDED) {
      return 'SUSPENDED';
    }
    return eligibilityStatus === CustomerEligibilityStatus.ELIGIBLE ? 'OPERABLE' : 'INELIGIBLE';
  }

  private async assertCanBecomeEligible(
    manager: EntityManager,
    customerId: string,
  ): Promise<CustomerOnboarding> {
    const blacklist = await this.findActiveRestriction(
      manager.getRepository(CustomerRestriction),
      customerId,
      CustomerRestrictionType.BLACKLISTED,
    );
    if (blacklist) {
      throw new ConflictException('BLACKLISTED customers cannot become ELIGIBLE');
    }
    const onboarding = await this.findCompletedOnboarding(
      manager.getRepository(CustomerOnboarding),
      customerId,
    );
    if (!onboarding) {
      throw new ConflictException('Only COMPLETED onboarding may become ELIGIBLE');
    }
    return onboarding;
  }

  private async assertCanActivateEnrollment(
    manager: EntityManager,
    customerId: string,
  ): Promise<void> {
    const eligibility = await this.findActiveEligibility(
      manager.getRepository(CustomerEligibility),
      customerId,
    );
    if (!eligibility || eligibility.status !== CustomerEligibilityStatus.ELIGIBLE) {
      throw new ConflictException('Only ELIGIBLE customers may have ACTIVE product enrollments');
    }
    const frozen = await this.findActiveRestriction(
      manager.getRepository(CustomerRestriction),
      customerId,
      CustomerRestrictionType.FROZEN,
    );
    if (frozen) {
      throw new ConflictException('FROZEN customers cannot receive ACTIVE enrollments');
    }
  }

  private async requireCustomer(
    repositoryOrManager: Repository<Customer> | EntityManager,
    id: string,
  ): Promise<Customer> {
    const repository = this.isManager(repositoryOrManager)
      ? repositoryOrManager.getRepository(Customer)
      : repositoryOrManager;
    const customer = await repository.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} was not found`);
    }
    return customer;
  }

  private isManager(value: Repository<Customer> | EntityManager): value is EntityManager {
    return 'getRepository' in value;
  }

  private async findActiveEligibility(
    repository: Repository<CustomerEligibility>,
    customerId: string,
  ): Promise<CustomerEligibility | null> {
    const records = await repository.find({ where: { customerId } });
    return records.find((record) => this.isNotDeleted(record.deletedAt)) ?? null;
  }

  private async findActiveLimitProfile(
    repository: Repository<CustomerLimitProfile>,
    customerId: string,
  ): Promise<CustomerLimitProfile | null> {
    const records = await repository.find({ where: { customerId } });
    return records.find((record) => this.isNotDeleted(record.deletedAt)) ?? null;
  }

  private async findActiveRestriction(
    repository: Repository<CustomerRestriction>,
    customerId: string,
    type: CustomerRestrictionType,
  ): Promise<CustomerRestriction | null> {
    const records = await repository.find({ where: { customerId, type, isActive: true } });
    return records.find((record) => this.isNotDeleted(record.deletedAt)) ?? null;
  }

  private async findCompletedOnboarding(
    repository: Repository<CustomerOnboarding>,
    customerId: string,
  ): Promise<CustomerOnboarding | null> {
    const records = await repository.find({
      where: { customerId, status: CustomerOnboardingStatus.COMPLETED },
    });
    return records.find((record) => this.isNotDeleted(record.deletedAt)) ?? null;
  }

  private assertEligibilityTransition(
    current: CustomerEligibilityStatus,
    next: CustomerEligibilityStatus,
  ): void {
    const allowed: Record<CustomerEligibilityStatus, CustomerEligibilityStatus[]> = {
      [CustomerEligibilityStatus.PENDING]: [
        CustomerEligibilityStatus.ELIGIBLE,
        CustomerEligibilityStatus.INELIGIBLE,
        CustomerEligibilityStatus.SUSPENDED,
        CustomerEligibilityStatus.REVOKED,
      ],
      [CustomerEligibilityStatus.ELIGIBLE]: [
        CustomerEligibilityStatus.INELIGIBLE,
        CustomerEligibilityStatus.SUSPENDED,
        CustomerEligibilityStatus.REVOKED,
      ],
      [CustomerEligibilityStatus.INELIGIBLE]: [
        CustomerEligibilityStatus.PENDING,
        CustomerEligibilityStatus.SUSPENDED,
        CustomerEligibilityStatus.REVOKED,
      ],
      [CustomerEligibilityStatus.SUSPENDED]: [
        CustomerEligibilityStatus.PENDING,
        CustomerEligibilityStatus.ELIGIBLE,
        CustomerEligibilityStatus.INELIGIBLE,
        CustomerEligibilityStatus.REVOKED,
      ],
      [CustomerEligibilityStatus.REVOKED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid eligibility transition from ${current} to ${next}`);
    }
  }

  private assertEnrollmentTransition(
    current: CustomerProductEnrollmentStatus,
    next: CustomerProductEnrollmentStatus,
  ): void {
    const allowed: Record<CustomerProductEnrollmentStatus, CustomerProductEnrollmentStatus[]> = {
      [CustomerProductEnrollmentStatus.PENDING]: [
        CustomerProductEnrollmentStatus.ACTIVE,
        CustomerProductEnrollmentStatus.SUSPENDED,
        CustomerProductEnrollmentStatus.CLOSED,
      ],
      [CustomerProductEnrollmentStatus.ACTIVE]: [
        CustomerProductEnrollmentStatus.SUSPENDED,
        CustomerProductEnrollmentStatus.CLOSED,
      ],
      [CustomerProductEnrollmentStatus.SUSPENDED]: [
        CustomerProductEnrollmentStatus.ACTIVE,
        CustomerProductEnrollmentStatus.CLOSED,
      ],
      [CustomerProductEnrollmentStatus.CLOSED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid enrollment transition from ${current} to ${next}`);
    }
  }

  private normalizeLimitCreate(
    command: CreateCustomerLimitProfileCommand,
  ): Omit<
    CustomerLimitProfile,
    'id' | 'customerId' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'
  > {
    return {
      currency: this.normalizeCurrency(command.currency),
      dailyTransactionCount: this.normalizeCount(command.dailyTransactionCount),
      dailyTransactionAmountMinor: this.normalizeAmount(
        command.dailyTransactionAmountMinor,
        'dailyTransactionAmountMinor',
      ),
      singleTransactionAmountMinor: this.normalizeAmount(
        command.singleTransactionAmountMinor,
        'singleTransactionAmountMinor',
      ),
      monthlyTransactionAmountMinor: this.normalizeAmount(
        command.monthlyTransactionAmountMinor,
        'monthlyTransactionAmountMinor',
      ),
      walletBalanceMinor: this.normalizeAmount(command.walletBalanceMinor, 'walletBalanceMinor'),
    };
  }

  private normalizeLimitUpdate(
    command: UpdateCustomerLimitProfileCommand,
  ): Partial<CustomerLimitProfile> {
    const updates: Partial<CustomerLimitProfile> = {};
    if (command.currency !== undefined) {
      updates.currency = this.normalizeCurrency(command.currency);
    }
    if (command.dailyTransactionCount !== undefined) {
      updates.dailyTransactionCount = this.normalizeCount(command.dailyTransactionCount);
    }
    if (command.dailyTransactionAmountMinor !== undefined) {
      updates.dailyTransactionAmountMinor = this.normalizeAmount(
        command.dailyTransactionAmountMinor,
        'dailyTransactionAmountMinor',
      );
    }
    if (command.singleTransactionAmountMinor !== undefined) {
      updates.singleTransactionAmountMinor = this.normalizeAmount(
        command.singleTransactionAmountMinor,
        'singleTransactionAmountMinor',
      );
    }
    if (command.monthlyTransactionAmountMinor !== undefined) {
      updates.monthlyTransactionAmountMinor = this.normalizeAmount(
        command.monthlyTransactionAmountMinor,
        'monthlyTransactionAmountMinor',
      );
    }
    if (command.walletBalanceMinor !== undefined) {
      updates.walletBalanceMinor = this.normalizeAmount(
        command.walletBalanceMinor,
        'walletBalanceMinor',
      );
    }
    return updates;
  }

  private normalizeCount(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
      throw new BadRequestException('dailyTransactionCount must be a non-negative integer');
    }
    return value;
  }

  private normalizeAmount(value: string, field: string): string {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException(`${field} must be a non-negative integer string`);
    }
    try {
      const amount = BigInt(normalized);
      if (amount > MAX_BIGINT) {
        throw new BadRequestException(`${field} exceeds the supported amount range`);
      }
      return amount.toString();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`${field} is invalid`);
    }
  }

  private normalizeCurrency(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new BadRequestException('currency must be a three-letter code');
    }
    return normalized;
  }

  private normalizeProduct(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(normalized)) {
      throw new BadRequestException('product must contain 1 to 80 safe lowercase characters');
    }
    return normalized;
  }

  private normalizeActor(value: string): string {
    return this.normalizeText(value, 'actor', 160);
  }

  private normalizeOptionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === undefined) {
      return null;
    }
    const normalized = value.trim();
    if (normalized.length > max) {
      throw new BadRequestException(`${field} must contain at most ${max} characters`);
    }
    return normalized || null;
  }

  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max) {
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    }
    return normalized;
  }

  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a UUID`);
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

  private eligibilityValues(value: CustomerEligibility): Record<string, unknown> {
    return {
      customerId: value.customerId,
      onboardingId: value.onboardingId,
      status: value.status,
      reason: value.reason,
      reviewedBy: value.reviewedBy,
      statusChangedAt: value.statusChangedAt,
      version: value.version,
    };
  }

  private limitProfileValues(value: CustomerLimitProfile): Record<string, unknown> {
    return {
      customerId: value.customerId,
      currency: value.currency,
      dailyTransactionCount: value.dailyTransactionCount,
      dailyTransactionAmountMinor: value.dailyTransactionAmountMinor,
      singleTransactionAmountMinor: value.singleTransactionAmountMinor,
      monthlyTransactionAmountMinor: value.monthlyTransactionAmountMinor,
      walletBalanceMinor: value.walletBalanceMinor,
      version: value.version,
    };
  }

  private enrollmentValues(value: CustomerProductEnrollment): Record<string, unknown> {
    return {
      customerId: value.customerId,
      product: value.product,
      status: value.status,
      reason: value.reason,
      statusChangedAt: value.statusChangedAt,
      version: value.version,
    };
  }

  private permissionValues(value: CustomerOperatingPermission): Record<string, unknown> {
    return {
      customerId: value.customerId,
      type: value.type,
      enabled: value.enabled,
      reason: value.reason,
      version: value.version,
    };
  }

  private restrictionValues(value: CustomerRestriction): Record<string, unknown> {
    return {
      customerId: value.customerId,
      type: value.type,
      isActive: value.isActive,
      reason: value.reason,
      version: value.version,
    };
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
}
