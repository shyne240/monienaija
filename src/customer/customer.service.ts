import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { ContactMethodType, CustomerKycStatus, CustomerStatus } from './customer.enums';
import { Customer } from './customer.entity';
import { CustomerAddress } from './customer-address.entity';
import { CustomerContactMethod } from './customer-contact-method.entity';
import { CustomerIdentityDocument } from './customer-identity-document.entity';
import { CustomerKycAssessment } from './customer-kyc-assessment.entity';
import { CustomerProfile } from './customer-profile.entity';
import type {
  CreateAddressCommand,
  CreateContactCommand,
  CreateCustomerCommand,
  CreateIdentityDocumentCommand,
  CreateKycAssessmentCommand,
  CreateProfileCommand,
  UpdateCustomerCommand,
} from './customer.types';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerProfile)
    private readonly profileRepository: Repository<CustomerProfile>,
    @InjectRepository(CustomerAddress)
    private readonly addressRepository: Repository<CustomerAddress>,
    @InjectRepository(CustomerContactMethod)
    private readonly contactRepository: Repository<CustomerContactMethod>,
    @InjectRepository(CustomerIdentityDocument)
    private readonly documentRepository: Repository<CustomerIdentityDocument>,
    @InjectRepository(CustomerKycAssessment)
    private readonly kycRepository: Repository<CustomerKycAssessment>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async create(command: CreateCustomerCommand): Promise<Customer> {
    const reference = this.normalizeReference(command.reference);
    const actor = this.normalizeActor(command.actor);
    try {
      const customer = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Customer);
        const draft = repository.create();
        Object.assign(draft, {
          id: randomUUID(),
          reference,
          type: command.type,
          status: command.status ?? CustomerStatus.DRAFT,
          kycLevel: 'NONE',
          kycStatus: 'NOT_STARTED',
          version: 1,
          deletedAt: null,
        });
        const saved = await repository.save(draft);
        await this.audit(
          manager,
          'CUSTOMER',
          saved.id,
          'CREATED',
          actor,
          undefined,
          this.auditCustomer(saved),
        );
        return saved;
      });
      return customer;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer reference already exists');
      }
      throw error;
    }
  }

  async list(status?: CustomerStatus, type?: string, page = 1, limit = 50): Promise<Customer[]> {
    const customers = await this.customerRepository.find({
      where: {
        ...(status ? { status } : {}),
        ...(type ? { type: type as Customer['type'] } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (Math.max(page, 1) - 1) * Math.min(Math.max(limit, 1), 100),
      take: Math.min(Math.max(limit, 1), 100),
    });
    return customers;
  }

  async get(id: string): Promise<Customer> {
    this.assertUuid(id, 'customerId');
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} was not found`);
    }
    return customer;
  }

  async updateStatus(id: string, command: UpdateCustomerCommand): Promise<Customer> {
    this.assertUuid(id, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.lockCustomer(manager, id);
      if (!customer) {
        throw new NotFoundException(`Customer ${id} was not found`);
      }
      if (!command.status) {
        throw new BadRequestException('status is required');
      }
      if (customer.status === command.status) {
        return customer;
      }
      this.assertCustomerTransition(customer.status, command.status);
      const previous = this.auditCustomer(customer);
      customer.status = command.status;
      customer.deletedAt =
        command.status === CustomerStatus.CLOSED ? new Date() : customer.deletedAt;
      const saved = await manager.getRepository(Customer).save(customer);
      await this.audit(
        manager,
        'CUSTOMER',
        saved.id,
        'STATUS_UPDATED',
        actor,
        previous,
        this.auditCustomer(saved),
      );
      return saved;
    });
  }

  async createProfile(customerId: string, command: CreateProfileCommand): Promise<CustomerProfile> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager, customerId);
      const repository = manager.getRepository(CustomerProfile);
      const existing = await repository.findOne({
        where: { customerId, isActive: true, deletedAt: IsNull() },
      });
      if (existing) {
        throw new ConflictException('Customer already has an active profile');
      }
      const profile = await repository.save(
        repository.create({
          id: randomUUID(),
          customerId,
          displayName: this.normalizeText(command.displayName, 'displayName', 200),
          legalName: command.legalName
            ? this.normalizeText(command.legalName, 'legalName', 200)
            : null,
          dateOfBirth: command.dateOfBirth ?? null,
          nationality: command.nationality?.trim().toUpperCase() ?? null,
          isActive: true,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_PROFILE',
        profile.id,
        'CREATED',
        actor,
        undefined,
        this.serializableValues(profile),
      );
      return profile;
    });
  }

  async getProfile(customerId: string): Promise<CustomerProfile> {
    await this.get(customerId);
    const profile = await this.profileRepository.findOne({ where: { customerId, isActive: true } });
    if (!profile) {
      throw new NotFoundException(`Active profile for customer ${customerId} was not found`);
    }
    return profile;
  }

  async createAddress(customerId: string, command: CreateAddressCommand): Promise<CustomerAddress> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager, customerId);
      const address = await manager.getRepository(CustomerAddress).save(
        manager.getRepository(CustomerAddress).create({
          id: randomUUID(),
          customerId,
          type: command.type,
          lineOne: this.normalizeText(command.lineOne, 'lineOne', 200),
          lineTwo: command.lineTwo ? this.normalizeText(command.lineTwo, 'lineTwo', 200) : null,
          city: this.normalizeText(command.city, 'city', 100),
          state: this.normalizeText(command.state, 'state', 100),
          country: command.country.trim().toUpperCase(),
          postalCode: command.postalCode?.trim() ?? null,
          isPrimary: command.isPrimary,
          deletedAt: null,
        }),
      );
      await this.audit(
        manager,
        'CUSTOMER_ADDRESS',
        address.id,
        'CREATED',
        actor,
        undefined,
        this.serializableValues(address),
      );
      return address;
    });
  }

  async listAddresses(customerId: string): Promise<CustomerAddress[]> {
    await this.get(customerId);
    return this.addressRepository.find({
      where: { customerId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async createContactMethod(
    customerId: string,
    command: CreateContactCommand,
  ): Promise<CustomerContactMethod> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const normalizedValue = this.normalizeContact(command.type, command.value);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const contact = await manager.getRepository(CustomerContactMethod).save(
          manager.getRepository(CustomerContactMethod).create({
            id: randomUUID(),
            customerId,
            type: command.type,
            value: normalizedValue,
            normalizedValue,
            isPrimary: command.isPrimary,
            verifiedAt: null,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_CONTACT_METHOD',
          contact.id,
          'CREATED',
          actor,
          undefined,
          this.serializableValues(contact),
        );
        return contact;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`${command.type} contact method already exists`);
      }
      throw error;
    }
  }

  async listContactMethods(customerId: string): Promise<CustomerContactMethod[]> {
    await this.get(customerId);
    return this.contactRepository.find({
      where: { customerId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async createIdentityDocument(
    customerId: string,
    command: CreateIdentityDocumentCommand,
  ): Promise<CustomerIdentityDocument> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager, customerId);
        const document = await manager.getRepository(CustomerIdentityDocument).save(
          manager.getRepository(CustomerIdentityDocument).create({
            id: randomUUID(),
            customerId,
            type: command.type,
            documentNumber: this.normalizeText(command.documentNumber, 'documentNumber', 160),
            issuingCountry: command.issuingCountry.trim().toUpperCase(),
            issuedAt: command.issuedAt ?? null,
            expiresAt: command.expiresAt ?? null,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_IDENTITY_DOCUMENT',
          document.id,
          'CREATED',
          actor,
          undefined,
          this.serializableValues(document),
        );
        return document;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          `Identity document type ${command.type} already exists for this customer`,
        );
      }
      throw error;
    }
  }

  async listIdentityDocuments(customerId: string): Promise<CustomerIdentityDocument[]> {
    await this.get(customerId);
    return this.documentRepository.find({
      where: { customerId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  async createKycAssessment(
    customerId: string,
    command: CreateKycAssessmentCommand,
  ): Promise<CustomerKycAssessment> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.assessedBy);
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.requireCustomer(manager, customerId);
      this.assertKycTransition(customer.kycStatus, command.status);
      const repository = manager.getRepository(CustomerKycAssessment);
      const current = await repository.findOne({ where: { customerId, isCurrent: true } });
      if (current) {
        current.isCurrent = false;
        await repository.save(current);
        await this.audit(
          manager,
          'CUSTOMER_KYC_ASSESSMENT',
          current.id,
          'SUPERSEDED',
          actor,
          { isCurrent: true },
          { isCurrent: false },
        );
      }
      const assessment = await repository.save(
        repository.create({
          id: randomUUID(),
          customerId,
          level: command.level,
          status: command.status,
          reason: command.reason?.trim() ?? null,
          assessedBy: actor,
          isCurrent: true,
          expiresAt: command.expiresAt ? new Date(command.expiresAt) : null,
        }),
      );
      const previousCustomer = this.auditCustomer(customer);
      customer.kycLevel = command.level;
      customer.kycStatus = command.status;
      await manager.getRepository(Customer).save(customer);
      await this.audit(
        manager,
        'CUSTOMER_KYC_ASSESSMENT',
        assessment.id,
        'CREATED',
        actor,
        undefined,
        this.serializableValues(assessment),
      );
      await this.audit(
        manager,
        'CUSTOMER',
        customer.id,
        'KYC_UPDATED',
        actor,
        previousCustomer,
        this.auditCustomer(customer),
      );
      return assessment;
    });
  }

  async getKyc(customerId: string): Promise<CustomerKycAssessment> {
    await this.get(customerId);
    const assessment = await this.kycRepository.findOne({ where: { customerId, isCurrent: true } });
    if (!assessment) {
      throw new NotFoundException(
        `Current KYC assessment for customer ${customerId} was not found`,
      );
    }
    return assessment;
  }

  private async requireCustomer(manager: EntityManager, id: string): Promise<Customer> {
    const customer = await manager.getRepository(Customer).findOne({ where: { id } });
    if (!customer) {
      throw new NotFoundException(`Customer ${id} was not found`);
    }
    return customer;
  }

  private async lockCustomer(manager: EntityManager, id: string): Promise<Customer | null> {
    return manager
      .getRepository(Customer)
      .createQueryBuilder('customer')
      .where('customer.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
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
      newValues,
      previousValues,
    });
  }

  private assertCustomerTransition(current: CustomerStatus, next: CustomerStatus): void {
    const allowed: Record<CustomerStatus, CustomerStatus[]> = {
      [CustomerStatus.DRAFT]: [
        CustomerStatus.ACTIVE,
        CustomerStatus.SUSPENDED,
        CustomerStatus.CLOSED,
      ],
      [CustomerStatus.ACTIVE]: [CustomerStatus.SUSPENDED, CustomerStatus.CLOSED],
      [CustomerStatus.SUSPENDED]: [CustomerStatus.ACTIVE, CustomerStatus.CLOSED],
      [CustomerStatus.CLOSED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid customer status transition from ${current} to ${next}`);
    }
  }

  private assertKycTransition(current: CustomerKycStatus, next: CustomerKycStatus): void {
    const allowed: Record<CustomerKycStatus, CustomerKycStatus[]> = {
      [CustomerKycStatus.NOT_STARTED]: [CustomerKycStatus.PENDING],
      [CustomerKycStatus.PENDING]: [CustomerKycStatus.APPROVED, CustomerKycStatus.REJECTED],
      [CustomerKycStatus.APPROVED]: [CustomerKycStatus.PENDING],
      [CustomerKycStatus.REJECTED]: [CustomerKycStatus.PENDING],
    };
    if (current === next) {
      throw new ConflictException(`KYC assessment is already ${current}`);
    }
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid KYC status transition from ${current} to ${next}`);
    }
  }

  private normalizeReference(reference: string): string {
    const normalized = reference.trim().toLowerCase();
    if (
      !normalized ||
      normalized.length > 160 ||
      !/^[a-z0-9][a-z0-9_.:-]{0,159}$/.test(normalized)
    ) {
      throw new BadRequestException('reference must contain 1 to 160 lowercase safe characters');
    }
    return normalized;
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

  private normalizeContact(type: ContactMethodType, value: string): string {
    if (type === ContactMethodType.EMAIL) {
      const normalized = value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new BadRequestException('Email contact method is invalid');
      }
      return normalized;
    }
    const normalized = value.replace(/[\s()-]/g, '');
    if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) {
      throw new BadRequestException('Phone contact method is invalid');
    }
    return normalized;
  }

  private serializableValues(value: object): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }

  private auditCustomer(customer: Customer): Record<string, unknown> {
    return {
      reference: customer.reference,
      type: customer.type,
      status: customer.status,
      kycLevel: customer.kycLevel,
      kycStatus: customer.kycStatus,
      version: customer.version,
      deletedAt: customer.deletedAt,
    };
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
}
