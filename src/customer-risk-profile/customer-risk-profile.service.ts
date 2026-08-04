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
import { AuditService } from '../operations/audit.service';
import { CustomerRiskFactor } from './customer-risk-factor.entity';
import {
  CustomerRiskLevel,
  CustomerRiskProfileStatus,
  RiskFactorHistoryAction,
  RiskProfileHistoryAction,
} from './customer-risk-profile.enums';
import { CustomerRiskProfile } from './customer-risk-profile.entity';
import type {
  CreateCustomerRiskProfileCommand,
  CustomerRiskFactorView,
  CustomerRiskProfileView,
  RiskFactorCommand,
  RiskFactorHistoryView,
  RiskProfileHistoryView,
  UpdateCustomerRiskProfileCommand,
} from './customer-risk-profile.types';
import { RiskFactorHistory } from './risk-factor-history.entity';
import { RiskProfileHistory } from './risk-profile-history.entity';

@Injectable()
export class CustomerRiskProfileService {
  constructor(
    @InjectRepository(CustomerRiskProfile)
    private readonly profileRepository: Repository<CustomerRiskProfile>,
    @InjectRepository(CustomerRiskFactor)
    private readonly factorRepository: Repository<CustomerRiskFactor>,
    @InjectRepository(RiskProfileHistory)
    private readonly profileHistoryRepository: Repository<RiskProfileHistory>,
    @InjectRepository(RiskFactorHistory)
    private readonly factorHistoryRepository: Repository<RiskFactorHistory>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createProfile(
    customerId: string,
    command: CreateCustomerRiskProfileCommand,
  ): Promise<CustomerRiskProfileView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const assessment = this.normalizeAssessment(command);
    try {
      const profileId = await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(CustomerRiskProfile);
        const existing = await this.findActiveProfile(repository, customerId);
        if (existing) {
          throw new ConflictException('Customer already has an active risk profile');
        }
        const profile = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            status: CustomerRiskProfileStatus.ACTIVE,
            assessmentDate: assessment.assessmentDate,
            assessedBy: assessment.assessedBy,
            assessmentMethod: assessment.assessmentMethod,
            overallRiskLevel: assessment.overallRiskLevel,
            reviewDueDate: assessment.reviewDueDate,
            notes: assessment.notes,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_RISK_PROFILE',
          profile.id,
          'CREATED',
          actor,
          undefined,
          this.profileValues(profile),
        );
        await this.recordAssessment(
          manager,
          profile,
          assessment.factors,
          actor,
          RiskProfileHistoryAction.CREATED,
        );
        return profile.id;
      });
      return this.getProfile(customerId, profileId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has an active risk profile');
      }
      throw error;
    }
  }

  async getProfile(
    customerId: string,
    expectedProfileId?: string,
  ): Promise<CustomerRiskProfileView> {
    this.assertUuid(customerId, 'customerId');
    if (expectedProfileId !== undefined) this.assertUuid(expectedProfileId, 'profileId');
    await this.requireCustomer(this.customerRepository, customerId);
    const profile = await this.findActiveProfile(this.profileRepository, customerId);
    if (!profile || (expectedProfileId !== undefined && profile.id !== expectedProfileId)) {
      throw new NotFoundException(`Active risk profile for customer ${customerId} was not found`);
    }
    return this.toView(profile, this.factorRepository);
  }

  async updateProfile(
    customerId: string,
    command: UpdateCustomerRiskProfileCommand,
  ): Promise<CustomerRiskProfileView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.findActiveProfile(
        manager.getRepository(CustomerRiskProfile),
        customerId,
      );
      if (!profile) {
        throw new NotFoundException(`Active risk profile for customer ${customerId} was not found`);
      }
      if (command.version !== undefined && command.version !== profile.version) {
        throw new ConflictException('Risk profile version is stale');
      }
      if (command.status === CustomerRiskProfileStatus.CLOSED) {
        const previous = this.profileValues(profile);
        profile.status = CustomerRiskProfileStatus.CLOSED;
        profile.deletedAt = null;
        const saved = await manager.getRepository(CustomerRiskProfile).save(profile);
        await this.audit(
          manager,
          'CUSTOMER_RISK_PROFILE',
          saved.id,
          'CLOSED',
          actor,
          previous,
          this.profileValues(saved),
        );
        await this.appendProfileHistory(manager, saved, RiskProfileHistoryAction.CLOSED, actor);
        return this.toViewFromManager(manager, saved);
      }
      if (command.status !== undefined && command.status !== CustomerRiskProfileStatus.ACTIVE) {
        throw new ConflictException('Unsupported risk profile status transition');
      }
      const hasAssessmentChange =
        command.assessmentDate !== undefined ||
        command.assessedBy !== undefined ||
        command.assessmentMethod !== undefined ||
        command.overallRiskLevel !== undefined ||
        command.reviewDueDate !== undefined ||
        command.notes !== undefined ||
        command.factors !== undefined;
      if (!hasAssessmentChange) return this.toViewFromManager(manager, profile);
      const currentFactors = await this.currentFactors(
        manager.getRepository(CustomerRiskFactor),
        profile.id,
      );
      const assessment = this.normalizeAssessmentUpdate(command, profile, currentFactors);
      const previous = this.profileValues(profile);
      this.applyAssessment(profile, assessment);
      const saved = await manager.getRepository(CustomerRiskProfile).save(profile);
      await this.audit(
        manager,
        'CUSTOMER_RISK_PROFILE',
        saved.id,
        'REASSESSED',
        actor,
        previous,
        this.profileValues(saved),
      );
      await this.recordAssessment(
        manager,
        saved,
        assessment.factors,
        actor,
        RiskProfileHistoryAction.REASSESSED,
      );
      return this.toViewFromManager(manager, saved);
    });
  }

  async reassessProfile(
    customerId: string,
    command: CreateCustomerRiskProfileCommand,
  ): Promise<CustomerRiskProfileView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const assessment = this.normalizeAssessment(command);
    return this.dataSource.transaction(async (manager) => {
      const profile = await this.findLatestProfile(
        manager.getRepository(CustomerRiskProfile),
        customerId,
      );
      if (!profile) {
        throw new NotFoundException(`Risk profile for customer ${customerId} was not found`);
      }
      if (
        profile.status === CustomerRiskProfileStatus.CLOSED ||
        !this.isNotDeleted(profile.deletedAt)
      ) {
        throw new ConflictException('Closed or deleted risk profiles cannot be reassessed');
      }
      const previous = this.profileValues(profile);
      this.applyAssessment(profile, assessment);
      const saved = await manager.getRepository(CustomerRiskProfile).save(profile);
      await this.audit(
        manager,
        'CUSTOMER_RISK_PROFILE',
        saved.id,
        'REASSESSED',
        actor,
        previous,
        this.profileValues(saved),
      );
      await this.recordAssessment(
        manager,
        saved,
        assessment.factors,
        actor,
        RiskProfileHistoryAction.REASSESSED,
      );
      return this.toViewFromManager(manager, saved);
    });
  }

  async listHistory(
    customerId: string,
  ): Promise<{ assessments: RiskProfileHistoryView[]; factors: RiskFactorHistoryView[] }> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const profile = await this.findActiveProfile(this.profileRepository, customerId);
    if (!profile)
      throw new NotFoundException(`Active risk profile for customer ${customerId} was not found`);
    const assessments = await this.profileHistoryRepository.find({
      where: { profileId: profile.id },
    });
    const factors = await this.factorHistoryRepository.find({ where: { profileId: profile.id } });
    return {
      assessments: this.sortByCreatedAt(
        assessments.filter((entry) => this.isNotDeleted(entry.deletedAt)),
      ).map((entry) => ({
        id: entry.id,
        profileId: entry.profileId,
        action: entry.action,
        version: entry.version,
        assessmentDate: entry.assessmentDate,
        assessedBy: entry.assessedBy,
        assessmentMethod: entry.assessmentMethod,
        overallRiskLevel: entry.overallRiskLevel,
        reviewDueDate: entry.reviewDueDate,
        notes: entry.notes,
        actor: entry.actor,
        createdAt: entry.createdAt,
      })),
      factors: this.sortByCreatedAt(
        factors.filter((entry) => this.isNotDeleted(entry.deletedAt)),
      ).map((entry) => ({
        id: entry.id,
        profileId: entry.profileId,
        profileVersion: entry.profileVersion,
        action: entry.action,
        category: entry.category,
        score: entry.score,
        weight: entry.weight,
        remarks: entry.remarks,
        actor: entry.actor,
        createdAt: entry.createdAt,
      })),
    };
  }

  private async appendProfileHistory(
    manager: EntityManager,
    profile: CustomerRiskProfile,
    action: RiskProfileHistoryAction,
    actor: string,
  ): Promise<RiskProfileHistory> {
    const history = await manager.getRepository(RiskProfileHistory).save(
      manager.getRepository(RiskProfileHistory).create({
        id: randomUUID(),
        profileId: profile.id,
        customerId: profile.customerId,
        action,
        status: profile.status,
        version: profile.version,
        assessmentDate: profile.assessmentDate,
        assessedBy: profile.assessedBy,
        assessmentMethod: profile.assessmentMethod,
        overallRiskLevel: profile.overallRiskLevel,
        reviewDueDate: profile.reviewDueDate,
        notes: profile.notes,
        actor,
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'RISK_PROFILE_HISTORY',
      history.id,
      'CREATED',
      actor,
      undefined,
      this.profileHistoryValues(history),
    );
    return history;
  }

  private async recordAssessment(
    manager: EntityManager,
    profile: CustomerRiskProfile,
    factors: RiskFactorCommand[],
    actor: string,
    action: RiskProfileHistoryAction,
  ): Promise<void> {
    const profileHistory = await manager.getRepository(RiskProfileHistory).save(
      manager.getRepository(RiskProfileHistory).create({
        id: randomUUID(),
        profileId: profile.id,
        customerId: profile.customerId,
        action,
        status: profile.status,
        version: profile.version,
        assessmentDate: profile.assessmentDate,
        assessedBy: profile.assessedBy,
        assessmentMethod: profile.assessmentMethod,
        overallRiskLevel: profile.overallRiskLevel,
        reviewDueDate: profile.reviewDueDate,
        notes: profile.notes,
        actor,
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'RISK_PROFILE_HISTORY',
      profileHistory.id,
      'CREATED',
      actor,
      undefined,
      this.profileHistoryValues(profileHistory),
    );
    const factorRepository = manager.getRepository(CustomerRiskFactor);
    const oldFactors = await this.currentFactors(factorRepository, profile.id);
    for (const oldFactor of oldFactors) {
      oldFactor.deletedAt = new Date();
      await factorRepository.save(oldFactor);
      await this.audit(
        manager,
        'CUSTOMER_RISK_FACTOR',
        oldFactor.id,
        'SOFT_DELETED',
        actor,
        this.factorValues(oldFactor),
        { deletedAt: oldFactor.deletedAt },
      );
    }
    for (const factor of factors) {
      const savedFactor = await factorRepository.save(
        factorRepository.create({
          id: randomUUID(),
          profileId: profile.id,
          customerId: profile.customerId,
          category: factor.category,
          score: factor.score,
          weight: factor.weight,
          remarks: factor.remarks ?? null,
          version: 1,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_RISK_FACTOR',
        savedFactor.id,
        'CREATED',
        actor,
        undefined,
        this.factorValues(savedFactor),
      );
      const factorHistory = await manager.getRepository(RiskFactorHistory).save(
        manager.getRepository(RiskFactorHistory).create({
          id: randomUUID(),
          profileId: profile.id,
          customerId: profile.customerId,
          profileVersion: profile.version,
          action: RiskFactorHistoryAction.ASSESSMENT_RECORDED,
          category: savedFactor.category,
          score: savedFactor.score,
          weight: savedFactor.weight,
          remarks: savedFactor.remarks,
          actor,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'RISK_FACTOR_HISTORY',
        factorHistory.id,
        'CREATED',
        actor,
        undefined,
        this.factorHistoryValues(factorHistory),
      );
    }
  }

  private applyAssessment(profile: CustomerRiskProfile, assessment: NormalizedAssessment): void {
    profile.assessmentDate = assessment.assessmentDate;
    profile.assessedBy = assessment.assessedBy;
    profile.assessmentMethod = assessment.assessmentMethod;
    profile.overallRiskLevel = assessment.overallRiskLevel;
    profile.reviewDueDate = assessment.reviewDueDate;
    profile.notes = assessment.notes;
    profile.status = CustomerRiskProfileStatus.ACTIVE;
  }

  private normalizeAssessment(command: CreateCustomerRiskProfileCommand): NormalizedAssessment {
    const assessmentDate = this.parseDate(command.assessmentDate, 'assessmentDate');
    const reviewDueDate = this.parseDate(command.reviewDueDate, 'reviewDueDate');
    if (reviewDueDate < assessmentDate)
      throw new BadRequestException('reviewDueDate cannot be before assessmentDate');
    const factors = this.normalizeFactors(command.factors);
    if (factors.length === 0) throw new BadRequestException('At least one risk factor is required');
    return {
      assessmentDate,
      assessedBy: this.normalizeText(command.assessedBy, 'assessedBy', 160),
      assessmentMethod: this.normalizeText(command.assessmentMethod, 'assessmentMethod', 120),
      overallRiskLevel: command.overallRiskLevel,
      reviewDueDate,
      notes: this.normalizeOptionalText(command.notes, 'notes', 2000),
      factors,
    };
  }

  private normalizeAssessmentUpdate(
    command: UpdateCustomerRiskProfileCommand,
    profile: CustomerRiskProfile,
    currentFactors: CustomerRiskFactor[],
  ): NormalizedAssessment {
    const assessmentDate = command.assessmentDate
      ? this.parseDate(command.assessmentDate, 'assessmentDate')
      : profile.assessmentDate;
    const reviewDueDate = command.reviewDueDate
      ? this.parseDate(command.reviewDueDate, 'reviewDueDate')
      : profile.reviewDueDate;
    if (reviewDueDate < assessmentDate)
      throw new BadRequestException('reviewDueDate cannot be before assessmentDate');
    const factors = command.factors
      ? this.normalizeFactors(command.factors)
      : currentFactors.map((factor) => ({
          category: factor.category,
          score: factor.score,
          weight: factor.weight,
          remarks: factor.remarks ?? undefined,
        }));
    if (factors.length === 0) throw new BadRequestException('At least one risk factor is required');
    return {
      assessmentDate,
      assessedBy: command.assessedBy
        ? this.normalizeText(command.assessedBy, 'assessedBy', 160)
        : profile.assessedBy,
      assessmentMethod: command.assessmentMethod
        ? this.normalizeText(command.assessmentMethod, 'assessmentMethod', 120)
        : profile.assessmentMethod,
      overallRiskLevel: command.overallRiskLevel ?? profile.overallRiskLevel,
      reviewDueDate,
      notes:
        command.notes === undefined
          ? profile.notes
          : this.normalizeOptionalText(command.notes, 'notes', 2000),
      factors,
    };
  }

  private normalizeFactors(factors: RiskFactorCommand[]): RiskFactorCommand[] {
    return factors.map((factor) => {
      const category = this.normalizeText(factor.category, 'factor.category', 80);
      if (!Number.isFinite(factor.score) || factor.score < 0)
        throw new BadRequestException('Risk score cannot be negative');
      if (!Number.isFinite(factor.weight) || factor.weight <= 0)
        throw new BadRequestException('Risk weight must be greater than zero');
      return {
        category,
        score: factor.score,
        weight: factor.weight,
        remarks: this.normalizeOptionalText(factor.remarks, 'factor.remarks', 1000) ?? undefined,
      };
    });
  }

  private async currentFactors(
    repository: Repository<CustomerRiskFactor>,
    profileId: string,
  ): Promise<CustomerRiskFactor[]> {
    const factors = await repository.find({ where: { profileId } });
    return factors.filter((factor) => this.isNotDeleted(factor.deletedAt));
  }

  private async findLatestProfile(
    repository: Repository<CustomerRiskProfile>,
    customerId: string,
  ): Promise<CustomerRiskProfile | null> {
    const profiles = await repository.find({ where: { customerId }, withDeleted: true });
    return this.sortByCreatedAt(profiles)[0] ?? null;
  }

  private async findActiveProfile(
    repository: Repository<CustomerRiskProfile>,
    customerId: string,
  ): Promise<CustomerRiskProfile | null> {
    const profiles = await repository.find({
      where: { customerId, status: CustomerRiskProfileStatus.ACTIVE },
    });
    return profiles.find((profile) => this.isNotDeleted(profile.deletedAt)) ?? null;
  }

  private async requireCustomer(
    repository: Repository<Customer>,
    customerId: string,
  ): Promise<Customer> {
    const customer = await repository.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
    return customer;
  }

  private async toView(
    profile: CustomerRiskProfile,
    repository: Repository<CustomerRiskFactor>,
  ): Promise<CustomerRiskProfileView> {
    const factors = await this.currentFactors(repository, profile.id);
    return {
      ...this.profileViewValues(profile),
      factors: factors.map((factor) => this.factorView(factor)),
    };
  }

  private async toViewFromManager(
    manager: EntityManager,
    profile: CustomerRiskProfile,
  ): Promise<CustomerRiskProfileView> {
    return this.toView(profile, manager.getRepository(CustomerRiskFactor));
  }

  private profileViewValues(
    profile: CustomerRiskProfile,
  ): Omit<CustomerRiskProfileView, 'factors'> {
    return {
      id: profile.id,
      customerId: profile.customerId,
      status: profile.status,
      assessmentDate: profile.assessmentDate,
      assessedBy: profile.assessedBy,
      assessmentMethod: profile.assessmentMethod,
      overallRiskLevel: profile.overallRiskLevel,
      reviewDueDate: profile.reviewDueDate,
      notes: profile.notes,
      version: profile.version,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private factorView(factor: CustomerRiskFactor): CustomerRiskFactorView {
    return {
      id: factor.id,
      category: factor.category,
      score: factor.score,
      weight: factor.weight,
      remarks: factor.remarks,
    };
  }
  private profileValues(profile: CustomerRiskProfile): Record<string, unknown> {
    return {
      customerId: profile.customerId,
      status: profile.status,
      assessmentDate: profile.assessmentDate,
      assessedBy: profile.assessedBy,
      assessmentMethod: profile.assessmentMethod,
      overallRiskLevel: profile.overallRiskLevel,
      reviewDueDate: profile.reviewDueDate,
      notes: profile.notes,
      version: profile.version,
    };
  }
  private factorValues(factor: CustomerRiskFactor): Record<string, unknown> {
    return {
      profileId: factor.profileId,
      customerId: factor.customerId,
      category: factor.category,
      score: factor.score,
      weight: factor.weight,
      remarks: factor.remarks,
      version: factor.version,
    };
  }
  private profileHistoryValues(value: RiskProfileHistory): Record<string, unknown> {
    return {
      profileId: value.profileId,
      customerId: value.customerId,
      action: value.action,
      status: value.status,
      version: value.version,
      overallRiskLevel: value.overallRiskLevel,
      actor: value.actor,
    };
  }
  private factorHistoryValues(value: RiskFactorHistory): Record<string, unknown> {
    return {
      profileId: value.profileId,
      profileVersion: value.profileVersion,
      action: value.action,
      category: value.category,
      score: value.score,
      weight: value.weight,
      actor: value.actor,
    };
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is invalid`);
    return date;
  }
  private normalizeActor(value: string): string {
    return this.normalizeText(value, 'actor', 160);
  }
  private normalizeOptionalText(
    value: string | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    if (normalized.length > max)
      throw new BadRequestException(`${field} must contain at most ${max} characters`);
    return normalized || null;
  }
  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max)
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    return normalized;
  }
  private assertUuid(value: string, field: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      throw new BadRequestException(`${field} must be a UUID`);
  }
  private isNotDeleted(value: Date | null | undefined): boolean {
    return value === null || value === undefined;
  }
  private sortByCreatedAt<T extends { createdAt: Date }>(records: T[]): T[] {
    return [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}

type NormalizedAssessment = {
  assessmentDate: Date;
  assessedBy: string;
  assessmentMethod: string;
  overallRiskLevel: CustomerRiskLevel;
  reviewDueDate: Date;
  notes: string | null;
  factors: RiskFactorCommand[];
};
