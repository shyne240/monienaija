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
import { BeneficiaryHistory } from './beneficiary-history.entity';
import { BeneficiaryOwnership } from './beneficiary-ownership.entity';
import { BeneficiaryVerification } from './beneficiary-verification.entity';
import { CustomerBeneficiary } from './customer-beneficiary.entity';
import { BeneficiaryHistoryAction, CustomerBeneficiaryStatus } from './customer-beneficiary.enums';
import type {
  CreateCustomerBeneficiaryCommand,
  CustomerBeneficiaryView,
  UpdateCustomerBeneficiaryCommand,
  VerifyCustomerBeneficiaryCommand,
} from './customer-beneficiary.types';

@Injectable()
export class CustomerBeneficiaryService {
  constructor(
    @InjectRepository(CustomerBeneficiary)
    private readonly beneficiaryRepository: Repository<CustomerBeneficiary>,
    @InjectRepository(BeneficiaryOwnership)
    private readonly ownershipRepository: Repository<BeneficiaryOwnership>,
    @InjectRepository(BeneficiaryVerification)
    private readonly verificationRepository: Repository<BeneficiaryVerification>,
    @InjectRepository(BeneficiaryHistory)
    private readonly historyRepository: Repository<BeneficiaryHistory>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createBeneficiary(
    customerId: string,
    command: CreateCustomerBeneficiaryCommand,
  ): Promise<CustomerBeneficiaryView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const displayName = this.normalizeText(command.displayName, 'displayName', 200);
    const reference = this.normalizeReference(command.reference);
    const destinationIdentifier = this.normalizeText(
      command.destinationIdentifier,
      'destinationIdentifier',
      160,
    );
    const normalizedDestinationIdentifier = this.normalizeDestination(destinationIdentifier);
    const destinationName = this.normalizeOptionalText(
      command.destinationName,
      'destinationName',
      200,
    );
    const destinationInstitution = this.normalizeOptionalText(
      command.destinationInstitution,
      'destinationInstitution',
      200,
    );
    const nickname = this.normalizeOptionalText(command.nickname, 'nickname', 120);

    try {
      const beneficiaryId = await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(CustomerBeneficiary);
        const existingReference = await repository.findOne({
          where: { reference },
          withDeleted: true,
        });
        if (existingReference) {
          throw new ConflictException(`Beneficiary reference ${reference} already exists`);
        }
        const existingDestination = await repository.findOne({
          where: { customerId, normalizedDestinationIdentifier },
        });
        if (existingDestination && this.isNotDeleted(existingDestination.deletedAt)) {
          throw new ConflictException('A beneficiary for this destination already exists');
        }
        const beneficiary = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: command.type,
            displayName,
            reference,
            destinationIdentifier,
            normalizedDestinationIdentifier,
            destinationName,
            destinationInstitution,
            nickname,
            status: CustomerBeneficiaryStatus.PENDING,
            verified: false,
            version: 1,
            deletedAt: null,
          }),
        );
        const ownership = await manager.getRepository(BeneficiaryOwnership).save(
          manager.getRepository(BeneficiaryOwnership).create({
            id: randomUUID(),
            beneficiaryId: beneficiary.id,
            customerId,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_BENEFICIARY',
          beneficiary.id,
          'CREATED',
          actor,
          undefined,
          this.beneficiaryValues(beneficiary),
        );
        await this.audit(
          manager,
          'BENEFICIARY_OWNERSHIP',
          ownership.id,
          'CREATED',
          actor,
          undefined,
          this.ownershipValues(ownership),
        );
        await this.appendHistory(
          manager,
          beneficiary.id,
          BeneficiaryHistoryAction.CREATED,
          actor,
          null,
          beneficiary.status,
          null,
          beneficiary.verified,
          { type: beneficiary.type, reference: beneficiary.reference },
        );
        await this.appendHistory(
          manager,
          beneficiary.id,
          BeneficiaryHistoryAction.OWNERSHIP_CREATED,
          actor,
          null,
          null,
          null,
          null,
          { ownershipId: ownership.id },
        );
        return beneficiary.id;
      });
      return this.getBeneficiary(customerId, beneficiaryId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Beneficiary reference ${reference} already exists`);
      }
      throw error;
    }
  }

  async listBeneficiaries(customerId: string): Promise<CustomerBeneficiaryView[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const beneficiaries = await this.beneficiaryRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(
      beneficiaries
        .filter((beneficiary) => this.isNotDeleted(beneficiary.deletedAt))
        .map((beneficiary) => this.toView(beneficiary)),
    );
  }

  async getBeneficiary(
    customerId: string,
    beneficiaryId: string,
  ): Promise<CustomerBeneficiaryView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(beneficiaryId, 'beneficiaryId');
    await this.requireCustomer(this.customerRepository, customerId);
    const beneficiary = await this.beneficiaryRepository.findOne({
      where: { id: beneficiaryId, customerId },
    });
    if (!beneficiary || !this.isNotDeleted(beneficiary.deletedAt)) {
      throw new NotFoundException(`Beneficiary ${beneficiaryId} was not found`);
    }
    return this.toView(beneficiary);
  }

  async updateBeneficiary(
    customerId: string,
    beneficiaryId: string,
    command: UpdateCustomerBeneficiaryCommand,
  ): Promise<CustomerBeneficiaryView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(beneficiaryId, 'beneficiaryId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const repository = manager.getRepository(CustomerBeneficiary);
      const beneficiary = await repository.findOne({
        where: { id: beneficiaryId, customerId },
        withDeleted: true,
      });
      if (!beneficiary) {
        throw new NotFoundException(`Beneficiary ${beneficiaryId} was not found`);
      }
      if (
        !this.isNotDeleted(beneficiary.deletedAt) ||
        beneficiary.status === CustomerBeneficiaryStatus.DELETED
      ) {
        if (command.status === CustomerBeneficiaryStatus.ACTIVE) {
          throw new ConflictException('DELETED beneficiaries cannot become ACTIVE again');
        }
        throw new NotFoundException(`Beneficiary ${beneficiaryId} was not found`);
      }
      if (command.version !== undefined && command.version !== beneficiary.version) {
        throw new ConflictException('Beneficiary version is stale');
      }
      if (beneficiary.status === command.status) {
        return this.toView(beneficiary);
      }
      this.assertStatusTransition(beneficiary.status, command.status);
      const previousStatus = beneficiary.status;
      const previousVerified = beneficiary.verified;
      beneficiary.status = command.status;
      if (command.status === CustomerBeneficiaryStatus.DELETED) {
        beneficiary.deletedAt = new Date();
      }
      const saved = await repository.save(beneficiary);
      await this.audit(
        manager,
        'CUSTOMER_BENEFICIARY',
        saved.id,
        'STATUS_UPDATED',
        actor,
        { status: previousStatus, verified: previousVerified },
        { status: saved.status, verified: saved.verified, version: saved.version },
      );
      await this.appendHistory(
        manager,
        saved.id,
        BeneficiaryHistoryAction.STATUS_CHANGED,
        actor,
        previousStatus,
        saved.status,
        previousVerified,
        saved.verified,
        {},
      );
      return this.toView(saved);
    });
  }

  async verifyBeneficiary(
    customerId: string,
    beneficiaryId: string,
    command: VerifyCustomerBeneficiaryCommand,
  ): Promise<BeneficiaryVerification> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(beneficiaryId, 'beneficiaryId');
    const verifiedBy = this.normalizeActor(command.verifiedBy);
    const verificationMethod = this.normalizeText(
      command.verificationMethod,
      'verificationMethod',
      80,
    );
    const remarks = this.normalizeOptionalText(command.remarks, 'remarks', 500);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const repository = manager.getRepository(CustomerBeneficiary);
      const beneficiary = await repository.findOne({
        where: { id: beneficiaryId, customerId },
        withDeleted: true,
      });
      if (!beneficiary || !this.isNotDeleted(beneficiary.deletedAt)) {
        throw new NotFoundException(`Beneficiary ${beneficiaryId} was not found`);
      }
      if (beneficiary.status === CustomerBeneficiaryStatus.DELETED) {
        throw new ConflictException('Deleted beneficiaries cannot be verified');
      }
      const previousStatus = beneficiary.status;
      const previousVerified = beneficiary.verified;
      beneficiary.verified = true;
      const saved = await repository.save(beneficiary);
      const verification = await manager.getRepository(BeneficiaryVerification).save(
        manager.getRepository(BeneficiaryVerification).create({
          id: randomUUID(),
          beneficiaryId: saved.id,
          verifiedBy,
          verifiedAt: new Date(),
          verificationMethod,
          remarks,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_BENEFICIARY',
        saved.id,
        'VERIFIED',
        verifiedBy,
        { status: previousStatus, verified: previousVerified },
        { status: saved.status, verified: saved.verified, version: saved.version },
      );
      await this.audit(
        manager,
        'BENEFICIARY_VERIFICATION',
        verification.id,
        'CREATED',
        verifiedBy,
        undefined,
        this.verificationValues(verification),
      );
      await this.appendHistory(
        manager,
        saved.id,
        BeneficiaryHistoryAction.VERIFIED,
        verifiedBy,
        previousStatus,
        saved.status,
        previousVerified,
        saved.verified,
        { verificationId: verification.id, verificationMethod },
      );
      return verification;
    });
  }

  async listHistory(customerId: string, beneficiaryId: string): Promise<BeneficiaryHistory[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(beneficiaryId, 'beneficiaryId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireBeneficiary(this.beneficiaryRepository, customerId, beneficiaryId, true);
    const history = await this.historyRepository.find({ where: { beneficiaryId } });
    return this.sortByCreatedAt(history.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async getOwnership(customerId: string, beneficiaryId: string): Promise<BeneficiaryOwnership> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(beneficiaryId, 'beneficiaryId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireBeneficiary(this.beneficiaryRepository, customerId, beneficiaryId, true);
    const ownership = await this.ownershipRepository.findOne({
      where: { beneficiaryId },
    });
    if (!ownership || !this.isNotDeleted(ownership.deletedAt)) {
      throw new NotFoundException(`Ownership for beneficiary ${beneficiaryId} was not found`);
    }
    return ownership;
  }

  private async requireCustomer(
    repository: Repository<Customer>,
    customerId: string,
  ): Promise<Customer> {
    const customer = await repository.findOne({ where: { id: customerId } });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} was not found`);
    }
    return customer;
  }

  private async requireBeneficiary(
    repository: Repository<CustomerBeneficiary>,
    customerId: string,
    beneficiaryId: string,
    includeDeleted = false,
  ): Promise<CustomerBeneficiary> {
    const beneficiary = await repository.findOne({
      where: { id: beneficiaryId, customerId },
      ...(includeDeleted ? { withDeleted: true } : {}),
    });
    if (!beneficiary || (!includeDeleted && !this.isNotDeleted(beneficiary.deletedAt))) {
      throw new NotFoundException(`Beneficiary ${beneficiaryId} was not found`);
    }
    return beneficiary;
  }

  private assertStatusTransition(
    current: CustomerBeneficiaryStatus,
    next: CustomerBeneficiaryStatus,
  ): void {
    const allowed: Record<CustomerBeneficiaryStatus, CustomerBeneficiaryStatus[]> = {
      [CustomerBeneficiaryStatus.PENDING]: [
        CustomerBeneficiaryStatus.ACTIVE,
        CustomerBeneficiaryStatus.SUSPENDED,
        CustomerBeneficiaryStatus.DELETED,
      ],
      [CustomerBeneficiaryStatus.ACTIVE]: [
        CustomerBeneficiaryStatus.SUSPENDED,
        CustomerBeneficiaryStatus.DELETED,
      ],
      [CustomerBeneficiaryStatus.SUSPENDED]: [
        CustomerBeneficiaryStatus.ACTIVE,
        CustomerBeneficiaryStatus.DELETED,
      ],
      [CustomerBeneficiaryStatus.DELETED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid beneficiary transition from ${current} to ${next}`);
    }
  }

  private async appendHistory(
    manager: EntityManager,
    beneficiaryId: string,
    action: BeneficiaryHistoryAction,
    actor: string,
    previousStatus: CustomerBeneficiaryStatus | null,
    newStatus: CustomerBeneficiaryStatus | null,
    previousVerified: boolean | null,
    newVerified: boolean | null,
    metadata: Record<string, unknown>,
  ): Promise<BeneficiaryHistory> {
    const history = await manager.getRepository(BeneficiaryHistory).save(
      manager.getRepository(BeneficiaryHistory).create({
        id: randomUUID(),
        beneficiaryId,
        action,
        previousStatus,
        newStatus,
        previousVerified,
        newVerified,
        actor,
        metadata,
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'BENEFICIARY_HISTORY',
      history.id,
      'CREATED',
      actor,
      undefined,
      this.historyValues(history),
    );
    return history;
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

  private normalizeReference(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.:-]{0,159}$/.test(normalized)) {
      throw new BadRequestException('reference must contain 1 to 160 safe characters');
    }
    return normalized;
  }

  private normalizeDestination(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[\s()-]/g, '');
    if (!normalized || normalized.length > 160) {
      throw new BadRequestException('destinationIdentifier must contain 1 to 160 characters');
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

  private isNotDeleted(value: Date | null | undefined): boolean {
    return value === null || value === undefined;
  }

  private sortByCreatedAt<T extends { createdAt: Date }>(records: T[]): T[] {
    return [...records].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  private toView(beneficiary: CustomerBeneficiary): CustomerBeneficiaryView {
    return {
      id: beneficiary.id,
      customerId: beneficiary.customerId,
      type: beneficiary.type,
      displayName: beneficiary.displayName,
      reference: beneficiary.reference,
      destinationIdentifier: beneficiary.destinationIdentifier,
      destinationName: beneficiary.destinationName,
      destinationInstitution: beneficiary.destinationInstitution,
      nickname: beneficiary.nickname,
      status: beneficiary.status,
      verified: beneficiary.verified,
      version: beneficiary.version,
      createdAt: beneficiary.createdAt,
      updatedAt: beneficiary.updatedAt,
    };
  }

  private beneficiaryValues(beneficiary: CustomerBeneficiary): Record<string, unknown> {
    return {
      customerId: beneficiary.customerId,
      type: beneficiary.type,
      displayName: beneficiary.displayName,
      reference: beneficiary.reference,
      destinationIdentifier: beneficiary.destinationIdentifier,
      destinationName: beneficiary.destinationName,
      destinationInstitution: beneficiary.destinationInstitution,
      nickname: beneficiary.nickname,
      status: beneficiary.status,
      verified: beneficiary.verified,
      version: beneficiary.version,
    };
  }

  private ownershipValues(ownership: BeneficiaryOwnership): Record<string, unknown> {
    return {
      beneficiaryId: ownership.beneficiaryId,
      customerId: ownership.customerId,
      version: ownership.version,
    };
  }

  private verificationValues(verification: BeneficiaryVerification): Record<string, unknown> {
    return {
      beneficiaryId: verification.beneficiaryId,
      verifiedBy: verification.verifiedBy,
      verifiedAt: verification.verifiedAt,
      verificationMethod: verification.verificationMethod,
      remarks: verification.remarks,
    };
  }

  private historyValues(history: BeneficiaryHistory): Record<string, unknown> {
    return {
      beneficiaryId: history.beneficiaryId,
      action: history.action,
      previousStatus: history.previousStatus,
      newStatus: history.newStatus,
      previousVerified: history.previousVerified,
      newVerified: history.newVerified,
      actor: history.actor,
      metadata: history.metadata,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
