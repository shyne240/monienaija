import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not, QueryFailedError, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS } from '../customer-registration/customer-registration.constants';
import { CustomerRegistrationPhoneChallenge } from '../customer-registration/customer-registration-phone-challenge.entity';
import { normalizeNigerianPhone } from '../customer-registration/phone-normalization';
import { maskCustomerReference } from './customer-privacy';
import {
  ContactMethodType,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
  IdentityDocumentType,
} from './customer.enums';
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
  CreateRegistrationProfileCommand,
  UpdateAddressCommand,
  UpdateContactCommand,
  UpdateCustomerCommand,
  UpdateIdentityDocumentCommand,
  UpdateProfileCommand,
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
    const reference = this.normalizeReference(
      command.reference ?? `mn-cus-${randomBytes(12).toString('hex')}`,
    );
    const actor = this.normalizeActor(command.actor);
    if (command.status && command.status !== CustomerStatus.DRAFT) {
      throw new BadRequestException('Manual customer creation must start in DRAFT status');
    }
    try {
      const customer = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Customer);
        const draft = repository.create();
        Object.assign(draft, {
          id: randomUUID(),
          reference,
          type: command.type,
          status: CustomerStatus.DRAFT,
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
      if (command.status === CustomerStatus.ACTIVE) {
        await this.assertVerifiedPrimaryPhone(manager, id);
      }
      const previous = this.auditCustomer(customer);
      customer.status = command.status;
      customer.deletedAt =
        command.status === CustomerStatus.CLOSED ? new Date() : customer.deletedAt;
      const saved = await manager.getRepository(Customer).save(customer);
      const gateOutcome =
        command.status === CustomerStatus.ACTIVE ? { verifiedPrimaryPhone: true } : undefined;
      await this.audit(
        manager,
        'CUSTOMER',
        saved.id,
        'STATUS_UPDATED',
        actor,
        previous,
        gateOutcome
          ? { ...this.auditCustomer(saved), activationGate: gateOutcome }
          : this.auditCustomer(saved),
      );
      return saved;
    });
  }

  async createRegistrationProfile(
    customerId: string,
    command: CreateRegistrationProfileCommand,
  ): Promise<CustomerProfile> {
    this.assertUuid(customerId, 'customerId');
    const customer = await this.get(customerId);

    if (customer.type === CustomerType.INDIVIDUAL) {
      if (command.businessName?.trim()) {
        throw new BadRequestException('businessName is only valid for BUSINESS registration');
      }
      const firstName = this.normalizeText(command.firstName ?? '', 'firstName', 100);
      const middleName = command.middleName?.trim()
        ? this.normalizeText(command.middleName, 'middleName', 100)
        : undefined;
      const lastName = this.normalizeText(command.lastName ?? '', 'lastName', 100);
      const displayName = [firstName, middleName, lastName].filter(Boolean).join(' ');
      return this.createProfile(customerId, {
        displayName,
        legalName: displayName,
        firstName,
        middleName,
        lastName,
        dateOfBirth: command.dateOfBirth,
        nationality: command.nationality,
        actor: command.actor,
      });
    }

    if ([command.firstName, command.middleName, command.lastName].some((name) => name?.trim())) {
      throw new BadRequestException('Use businessName instead of individual name fields for BUSINESS registration');
    }
    const businessName = this.normalizeText(command.businessName ?? '', 'businessName', 200);
    return this.createProfile(customerId, {
      displayName: businessName,
      legalName: businessName,
      actor: command.actor,
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
      const firstName = command.firstName
        ? this.normalizeText(command.firstName, 'firstName', 100)
        : null;
      const middleName = command.middleName
        ? this.normalizeText(command.middleName, 'middleName', 100)
        : null;
      const lastName = command.lastName
        ? this.normalizeText(command.lastName, 'lastName', 100)
        : null;
      const composedLegalName = [firstName, middleName, lastName].filter(Boolean).join(' ');
      const profile = await repository.save(
        repository.create({
          id: randomUUID(),
          customerId,
          displayName: this.normalizeText(command.displayName, 'displayName', 200),
          legalName: command.legalName
            ? this.normalizeText(command.legalName, 'legalName', 200)
            : composedLegalName || null,
          firstName,
          middleName,
          lastName,
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
        {
          changedFields: [
            'displayName',
            'legalName',
            'firstName',
            'middleName',
            'lastName',
            'dateOfBirth',
            'nationality',
          ],
        },
      );
      return profile;
    });
  }

  async updateProfile(customerId: string, command: UpdateProfileCommand): Promise<CustomerProfile> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager, customerId);
      const repository = manager.getRepository(CustomerProfile);
      const profile = await repository.findOne({
        where: { customerId, isActive: true, deletedAt: IsNull() },
      });
      if (!profile) {
        throw new NotFoundException(`Active profile for customer ${customerId} was not found`);
      }

      const changedFields: string[] = [];
      if (command.displayName !== undefined) {
        profile.displayName = this.normalizeText(command.displayName, 'displayName', 200);
        changedFields.push('displayName');
      }
      if (command.firstName !== undefined) {
        profile.firstName = command.firstName === null
          ? null
          : this.normalizeText(command.firstName, 'firstName', 100);
        changedFields.push('firstName');
      }
      if (command.middleName !== undefined) {
        profile.middleName = command.middleName === null
          ? null
          : this.normalizeText(command.middleName, 'middleName', 100);
        changedFields.push('middleName');
      }
      if (command.lastName !== undefined) {
        profile.lastName = command.lastName === null
          ? null
          : this.normalizeText(command.lastName, 'lastName', 100);
        changedFields.push('lastName');
      }
      if (command.legalName !== undefined) {
        profile.legalName = command.legalName === null
          ? null
          : this.normalizeText(command.legalName, 'legalName', 200);
        changedFields.push('legalName');
      } else if (
        command.firstName !== undefined ||
        command.middleName !== undefined ||
        command.lastName !== undefined
      ) {
        const composedLegalName = [profile.firstName, profile.middleName, profile.lastName]
          .filter(Boolean)
          .join(' ');
        if (composedLegalName) profile.legalName = composedLegalName;
      }
      if (command.dateOfBirth !== undefined) {
        profile.dateOfBirth = command.dateOfBirth;
        changedFields.push('dateOfBirth');
      }
      if (command.nationality !== undefined) {
        profile.nationality = command.nationality?.trim().toUpperCase() ?? null;
        changedFields.push('nationality');
      }
      if (changedFields.length === 0) {
        throw new BadRequestException('At least one profile field is required');
      }

      const saved = await repository.save(profile);
      await this.audit(
        manager,
        'CUSTOMER_PROFILE',
        saved.id,
        'UPDATED',
        actor,
        { changedFields },
        { changedFields },
      );
      return saved;
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
      const customer = await this.lockCustomer(manager, customerId);
      if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
      if (command.isPrimary) {
        await this.clearPrimaryAddresses(manager, customerId, undefined, actor);
      }
      const repository = manager.getRepository(CustomerAddress);
      const address = await repository.save(
        repository.create({
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
        { changedFields: ['type', 'lineOne', 'lineTwo', 'city', 'state', 'country', 'postalCode', 'isPrimary'] },
      );
      return address;
    });
  }

  async updateAddress(
    customerId: string,
    addressId: string,
    command: UpdateAddressCommand,
  ): Promise<CustomerAddress> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(addressId, 'addressId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      const customer = await this.lockCustomer(manager, customerId);
      if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
      const repository = manager.getRepository(CustomerAddress);
      const address = await repository.findOne({ where: { id: addressId, customerId, deletedAt: IsNull() } });
      if (!address) throw new NotFoundException(`Address ${addressId} was not found`);

      const changedFields: string[] = [];
      if (command.type !== undefined) { address.type = command.type; changedFields.push('type'); }
      if (command.lineOne !== undefined) {
        address.lineOne = this.normalizeText(command.lineOne, 'lineOne', 200);
        changedFields.push('lineOne');
      }
      if (command.lineTwo !== undefined) {
        address.lineTwo = command.lineTwo === null ? null : this.normalizeText(command.lineTwo, 'lineTwo', 200);
        changedFields.push('lineTwo');
      }
      if (command.city !== undefined) {
        address.city = this.normalizeText(command.city, 'city', 100);
        changedFields.push('city');
      }
      if (command.state !== undefined) {
        address.state = this.normalizeText(command.state, 'state', 100);
        changedFields.push('state');
      }
      if (command.country !== undefined) {
        address.country = command.country.trim().toUpperCase();
        changedFields.push('country');
      }
      if (command.postalCode !== undefined) {
        address.postalCode = command.postalCode?.trim() ?? null;
        changedFields.push('postalCode');
      }
      if (command.isPrimary !== undefined) {
        if (command.isPrimary) {
          await this.clearPrimaryAddresses(manager, customerId, addressId, actor);
        }
        address.isPrimary = command.isPrimary;
        changedFields.push('isPrimary');
      }
      if (changedFields.length === 0) throw new BadRequestException('At least one address field is required');

      const saved = await repository.save(address);
      await this.audit(
        manager,
        'CUSTOMER_ADDRESS',
        saved.id,
        'UPDATED',
        actor,
        { changedFields },
        { changedFields },
      );
      return saved;
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
    const normalized = this.normalizeContact(command.type, command.value);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const customer = await this.lockCustomer(manager, customerId);
        if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
        if (command.isPrimary) {
          await this.clearPrimaryContacts(manager, customerId, command.type, undefined, actor);
        }
        const repository = manager.getRepository(CustomerContactMethod);
        const contact = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: command.type,
            value: normalized.value,
            normalizedValue: normalized.normalizedValue,
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
          { type: contact.type, isPrimary: contact.isPrimary, verified: false },
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

  async updateContactMethod(
    customerId: string,
    contactId: string,
    command: UpdateContactCommand,
  ): Promise<CustomerContactMethod> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(contactId, 'contactId');
    const actor = this.normalizeActor(command.actor);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const customer = await this.lockCustomer(manager, customerId);
        if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
        const repository = manager.getRepository(CustomerContactMethod);
        const contact = await repository.findOne({
          where: { id: contactId, customerId, deletedAt: IsNull() },
        });
        if (!contact) throw new NotFoundException(`Contact method ${contactId} was not found`);

        const changedFields: string[] = [];
        let valueChanged = false;
        if (command.value !== undefined) {
          const normalized = this.normalizeContact(contact.type, command.value);
          valueChanged =
            normalized.normalizedValue !== contact.normalizedValue || normalized.value !== contact.value;
          if (valueChanged) {
            contact.value = normalized.value;
            contact.normalizedValue = normalized.normalizedValue;
            changedFields.push('value');
          }
        }

        let verifiedAt: Date | null = contact.verifiedAt;
        if (command.verificationToken !== undefined) {
          if (contact.type !== ContactMethodType.PHONE) {
            throw new BadRequestException('Phone verification can only be applied to a PHONE contact');
          }
          const targetValue = command.value ?? contact.value;
          const phone = normalizeNigerianPhone(targetValue);
          verifiedAt = await this.consumePhoneVerificationToken(
            manager,
            phone.canonical,
            command.verificationToken,
          );
          contact.value = phone.e164;
          contact.normalizedValue = phone.canonical;
          contact.verifiedAt = verifiedAt;
          changedFields.push('phoneVerification');
        } else if (valueChanged) {
          // Changing an already verified value invalidates the old proof.
          contact.verifiedAt = null;
          if (contact.type === ContactMethodType.PHONE) changedFields.push('phoneVerification');
        }

        if (command.isPrimary !== undefined) {
          if (command.isPrimary) {
            await this.clearPrimaryContacts(manager, customerId, contact.type, contactId, actor);
          }
          if (contact.isPrimary !== command.isPrimary) changedFields.push('isPrimary');
          contact.isPrimary = command.isPrimary;
        }
        if (changedFields.length === 0) {
          throw new BadRequestException('At least one contact method field is required');
        }

        const saved = await repository.save(contact);
        await this.audit(
          manager,
          'CUSTOMER_CONTACT_METHOD',
          saved.id,
          command.verificationToken !== undefined ? 'PHONE_VERIFIED' : 'UPDATED',
          actor,
          { changedFields },
          {
            changedFields,
            isPrimary: saved.isPrimary,
            verified: saved.verifiedAt !== null,
          },
        );
        return saved;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`${command.value ? 'Contact method' : 'Primary contact'} already exists`);
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
    const documentNumber = this.normalizeText(command.documentNumber, 'documentNumber', 160);
    try {
      return await this.dataSource.transaction(async (manager) => {
        // Serialize writes for one customer so two concurrent requests cannot race past the
        // type+number duplicate check after removing the old one-document-per-type index.
        const customer = await this.lockCustomer(manager, customerId);
        if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
        const repository = manager.getRepository(CustomerIdentityDocument);
        if (
          await this.hasIdentityDocumentDuplicate(repository, customerId, command.type, documentNumber)
        ) {
          throw new ConflictException('An identity document with this type and number already exists for this customer');
        }

        const supportsDates = this.identityDocumentSupportsDates(command.type);
        const document = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: command.type,
            documentNumber,
            issuingCountry: command.issuingCountry.trim().toUpperCase(),
            issuedAt: supportsDates ? command.issuedAt ?? null : null,
            expiresAt: supportsDates ? command.expiresAt ?? null : null,
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
          { changedFields: ['type', 'documentNumber', 'issuingCountry', 'issuedAt', 'expiresAt'] },
        );
        return document;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('An identity document with this type and number already exists for this customer');
      }
      throw error;
    }
  }

  async updateIdentityDocument(
    customerId: string,
    documentId: string,
    command: UpdateIdentityDocumentCommand,
  ): Promise<CustomerIdentityDocument> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(documentId, 'documentId');
    const actor = this.normalizeActor(command.actor);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const customer = await this.lockCustomer(manager, customerId);
        if (!customer) throw new NotFoundException(`Customer ${customerId} was not found`);
        const repository = manager.getRepository(CustomerIdentityDocument);
        const document = await repository.findOne({
          where: { id: documentId, customerId, deletedAt: IsNull() },
        });
        if (!document) throw new NotFoundException(`Identity document ${documentId} was not found`);

        const changedFields: string[] = [];
        const nextType = command.type ?? document.type;
        const nextDocumentNumber = command.documentNumber === undefined
          ? document.documentNumber
          : this.normalizeText(command.documentNumber, 'documentNumber', 160);
        if (
          (nextType !== document.type || nextDocumentNumber !== document.documentNumber) &&
          await this.hasIdentityDocumentDuplicate(
            repository,
            customerId,
            nextType,
            nextDocumentNumber,
            document.id,
          )
        ) {
          throw new ConflictException('An identity document with this type and number already exists for this customer');
        }

        if (command.type !== undefined && command.type !== document.type) {
          document.type = command.type;
          changedFields.push('type');
        }
        if (command.documentNumber !== undefined && nextDocumentNumber !== document.documentNumber) {
          document.documentNumber = nextDocumentNumber;
          changedFields.push('documentNumber');
        }
        if (command.issuingCountry !== undefined) {
          const value = command.issuingCountry.trim().toUpperCase();
          if (value !== document.issuingCountry) {
            document.issuingCountry = value;
            changedFields.push('issuingCountry');
          }
        }

        if (!this.identityDocumentSupportsDates(nextType)) {
          if (document.issuedAt !== null) {
            document.issuedAt = null;
            changedFields.push('issuedAt');
          }
          if (document.expiresAt !== null) {
            document.expiresAt = null;
            changedFields.push('expiresAt');
          }
        } else {
          if (command.issuedAt !== undefined && command.issuedAt !== document.issuedAt) {
            document.issuedAt = command.issuedAt;
            changedFields.push('issuedAt');
          }
          if (command.expiresAt !== undefined && command.expiresAt !== document.expiresAt) {
            document.expiresAt = command.expiresAt;
            changedFields.push('expiresAt');
          }
        }
        if (changedFields.length === 0) {
          throw new BadRequestException('At least one identity document field is required');
        }

        const saved = await repository.save(document);
        await this.audit(
          manager,
          'CUSTOMER_IDENTITY_DOCUMENT',
          saved.id,
          'UPDATED',
          actor,
          { changedFields },
          { changedFields },
        );
        return saved;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('An identity document with this type and number already exists for this customer');
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

  private async clearPrimaryAddresses(
    manager: EntityManager,
    customerId: string,
    exceptId: string | undefined,
    actor: string,
  ): Promise<void> {
    const repository = manager.getRepository(CustomerAddress);
    const primaryAddresses = await repository.find({
      where: {
        customerId,
        isPrimary: true,
        deletedAt: IsNull(),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    for (const address of primaryAddresses) {
      address.isPrimary = false;
      await repository.save(address);
      await this.audit(
        manager,
        'CUSTOMER_ADDRESS',
        address.id,
        'PRIMARY_DESIGNATION_UPDATED',
        actor,
        { isPrimary: true },
        { isPrimary: false },
      );
    }
  }

  private async clearPrimaryContacts(
    manager: EntityManager,
    customerId: string,
    type: ContactMethodType,
    exceptId: string | undefined,
    actor: string,
  ): Promise<void> {
    const repository = manager.getRepository(CustomerContactMethod);
    const primaryContacts = await repository.find({
      where: {
        customerId,
        type,
        isPrimary: true,
        deletedAt: IsNull(),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    for (const contact of primaryContacts) {
      contact.isPrimary = false;
      await repository.save(contact);
      await this.audit(
        manager,
        'CUSTOMER_CONTACT_METHOD',
        contact.id,
        'PRIMARY_DESIGNATION_UPDATED',
        actor,
        { isPrimary: true },
        { isPrimary: false },
      );
    }
  }

  private async consumePhoneVerificationToken(
    manager: EntityManager,
    normalizedPhone: string,
    token: string,
  ): Promise<Date> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const repository = manager.getRepository(CustomerRegistrationPhoneChallenge);
    const challenge = await repository
      .createQueryBuilder('challenge')
      .where('challenge.normalized_phone = :phone', { phone: normalizedPhone })
      .andWhere("challenge.status = 'VERIFIED'")
      .andWhere('challenge.consumed_at IS NULL')
      .andWhere('challenge.revoked_at IS NULL')
      .orderBy('challenge.created_at', 'DESC')
      .setLock('pessimistic_write')
      .getOne();
    const storedHash = challenge?.verificationTokenHash;
    const storedBytes = storedHash && /^[a-f0-9]{64}$/i.test(storedHash)
      ? Buffer.from(storedHash, 'hex')
      : Buffer.alloc(0);
    const suppliedBytes = Buffer.from(tokenHash, 'hex');
    const tokenMatches = storedBytes.length === suppliedBytes.length &&
      storedBytes.length > 0 && timingSafeEqual(storedBytes, suppliedBytes);
    const verifiedAt = challenge?.verifiedAt;
    const now = new Date();
    if (
      !challenge ||
      !verifiedAt ||
      !tokenMatches ||
      verifiedAt.getTime() > now.getTime() ||
      now.getTime() - verifiedAt.getTime() > REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS * 1000
    ) {
      throw new BadRequestException('Phone verification token is invalid or expired');
    }
    challenge.consumedAt = now;
    await repository.save(challenge);
    return verifiedAt;
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

  /**
   * V1-CUSTOMER-ONBOARDING-02 — SUB-1 hard activation gate (docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md):
   * a customer may transition INTO ACTIVE only when a live, verified primary PHONE contact
   * exists. Fails closed (BadRequest before any save): on gate failure the transaction
   * rolls back — the customer stays DRAFT/SUSPENDED, and, exactly as with the existing
   * invalid-transition rejection, no audit row is persisted for the rule rejection.
   * Runs after the transition table so invalid transitions keep their existing error.
   */
  private async assertVerifiedPrimaryPhone(
    manager: EntityManager,
    customerId: string,
  ): Promise<void> {
    const verifiedPrimaryPhone = await manager.getRepository(CustomerContactMethod).findOne({
      where: {
        customerId,
        type: ContactMethodType.PHONE,
        isPrimary: true,
        verifiedAt: Not(IsNull()),
        deletedAt: IsNull(),
      },
    });
    if (!verifiedPrimaryPhone) {
      throw new BadRequestException('Customer activation requires a verified primary phone');
    }
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

  private async hasIdentityDocumentDuplicate(
    repository: Repository<CustomerIdentityDocument>,
    customerId: string,
    type: IdentityDocumentType,
    documentNumber: string,
    exceptId?: string,
  ): Promise<boolean> {
    const candidates = await repository.find({
      where: { customerId, type, deletedAt: IsNull() },
    });
    const candidateKey = this.identityDocumentNumberKey(documentNumber);
    return candidates.some(
      (candidate) =>
        candidate.id !== exceptId &&
        this.identityDocumentNumberKey(candidate.documentNumber) === candidateKey,
    );
  }

  private identityDocumentNumberKey(value: string): string {
    return value.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  }

  private identityDocumentSupportsDates(type: IdentityDocumentType): boolean {
    return type !== IdentityDocumentType.NIN && type !== IdentityDocumentType.BVN;
  }

  private normalizeText(value: string, field: string, max: number): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > max) {
      throw new BadRequestException(`${field} must contain 1 to ${max} characters`);
    }
    return normalized;
  }

  private normalizeContact(
    type: ContactMethodType,
    value: string,
  ): { value: string; normalizedValue: string } {
    if (type === ContactMethodType.EMAIL) {
      const normalized = value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new BadRequestException('Email contact method is invalid');
      }
      return { value: normalized, normalizedValue: normalized };
    }

    try {
      const nigerianPhone = normalizeNigerianPhone(value);
      return { value: nigerianPhone.e164, normalizedValue: nigerianPhone.canonical };
    } catch {
      const normalized = value.replace(/[\s()-]/g, '');
      if (!/^\+?[1-9]\d{7,14}$/.test(normalized)) {
        throw new BadRequestException('Phone contact method is invalid');
      }
      return { value: normalized, normalizedValue: normalized };
    }
  }

  private serializableValues(value: object): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }

  private auditCustomer(customer: Customer): Record<string, unknown> {
    return {
      reference: maskCustomerReference(customer.reference),
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
