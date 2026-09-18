import { ConflictException } from '@nestjs/common';
import type {
  DataSource,
  DeepPartial,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { CustomerEligibility } from '../src/customer-eligibility/customer-eligibility.entity';
import { CustomerOnboarding } from '../src/customer-onboarding/customer-onboarding.entity';
import { CustomerWallet } from '../src/customer-wallet/customer-wallet.entity';
import { WalletOwnership } from '../src/customer-wallet/wallet-ownership.entity';
import { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import { Customer } from '../src/customer/customer.entity';
import { CustomerAddress } from '../src/customer/customer-address.entity';
import { CustomerContactMethod } from '../src/customer/customer-contact-method.entity';
import { CustomerIdentityDocument } from '../src/customer/customer-identity-document.entity';
import { CustomerKycAssessment } from '../src/customer/customer-kyc-assessment.entity';
import { CustomerProfile } from '../src/customer/customer-profile.entity';
import { Deposit } from '../src/deposit/deposit.entity';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import type { AuditService } from '../src/operations/audit.service';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import {
  AddressType,
  ContactMethodType,
  CustomerKycLevel,
  CustomerKycStatus,
  CustomerStatus,
  CustomerType,
  IdentityDocumentType,
} from '../src/customer/customer.enums';
import { CustomerService } from '../src/customer/customer.service';

class MemoryRepository<T extends ObjectLiteral> {
  readonly records = new Map<string, T>();
  private sequence = 0;

  constructor(private readonly duplicate?: (entity: T, records: T[]) => boolean) {}

  create(input?: DeepPartial<T>): T {
    return (input ?? {}) as T;
  }

  save(entity: T): Promise<T> {
    const record = entity as Record<string, unknown>;
    if (!record.id) {
      this.sequence += 1;
      record.id = `00000000-0000-4000-8000-000000000${String(this.sequence).padStart(3, '0')}`;
    }
    if (this.duplicate?.(entity, [...this.records.values()])) {
      return Promise.reject(
        new QueryFailedError(
          'insert',
          [],
          Object.assign(new Error('duplicate'), { code: '23505' }),
        ),
      );
    }
    record.createdAt ??= new Date(1_000 + this.sequence);
    record.updatedAt = new Date(2_000 + this.sequence);
    this.records.set(String(record.id), entity);
    return Promise.resolve(entity);
  }

  findOne(options: { where?: Partial<T> }): Promise<T | null> {
    const conditions = options.where ?? {};
    const found = [...this.records.values()].find((entity) =>
      Object.entries(conditions).every(([key, expected]) => {
        const actual = (entity as Record<string, unknown>)[key];
        if (typeof expected === 'object' && expected !== null && '_type' in expected) {
          return expected._type === 'isNull' ? actual === null : true;
        }
        return actual === expected;
      }),
    );
    return Promise.resolve(found ?? null);
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

  createQueryBuilder(): MemoryQueryBuilder<T> {
    return new MemoryQueryBuilder(this.records);
  }
}

class MemoryQueryBuilder<T extends ObjectLiteral> {
  private id: string | undefined;

  constructor(private readonly records: Map<string, T>) {}

  where(_sql: string, params: Record<string, string>): this {
    this.id = Object.values(params)[0];
    return this;
  }

  setLock(lock: 'pessimistic_write'): this {
    void lock;
    return this;
  }

  getOne(): Promise<T | null> {
    return Promise.resolve(this.id ? (this.records.get(this.id) ?? null) : null);
  }
}

class MemoryManager {
  constructor(private readonly repositories: Map<unknown, MemoryRepository<ObjectLiteral>>) {}

  getRepository<T extends ObjectLiteral>(target: EntityTarget<T>): Repository<T> {
    const repository = this.repositories.get(target);
    if (!repository) {
      throw new Error('Unexpected customer repository');
    }
    return repository as unknown as Repository<T>;
  }
}

class MemoryDataSource {
  constructor(private readonly manager: MemoryManager) {}

  transaction<T>(
    _isolationOrCallback: string | ((manager: EntityManager) => Promise<T>),
    maybeCallback?: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const callback =
      typeof _isolationOrCallback === 'function' ? _isolationOrCallback : maybeCallback;
    if (!callback) {
      throw new Error('Missing transaction callback');
    }
    return callback(this.manager as unknown as EntityManager);
  }
}

function duplicateBy(keys: string[]): (entity: ObjectLiteral, records: ObjectLiteral[]) => boolean {
  return (entity, records) =>
    records.some(
      (existing) => keys.every((key) => existing[key] === entity[key]) && existing.id !== entity.id,
    );
}

describe('CustomerService', () => {
  function fixture() {
    const customerRepository = new MemoryRepository<Customer>(duplicateBy(['reference']));
    const profileRepository = new MemoryRepository<CustomerProfile>();
    const addressRepository = new MemoryRepository<CustomerAddress>();
    const contactRepository = new MemoryRepository<CustomerContactMethod>(
      duplicateBy(['type', 'normalizedValue']),
    );
    const documentRepository = new MemoryRepository<CustomerIdentityDocument>(
      duplicateBy(['customerId', 'type']),
    );
    const kycRepository = new MemoryRepository<CustomerKycAssessment>(
      duplicateBy(['customerId', 'isCurrent']),
    );
    const onboardingRepository = new MemoryRepository<CustomerOnboarding>();
    const eligibilityRepository = new MemoryRepository<CustomerEligibility>();
    const customerWalletRepository = new MemoryRepository<CustomerWallet>();
    const credentialRepository = new MemoryRepository<CustomerAuthenticationCredential>();
    const walletOwnershipRepository = new MemoryRepository<WalletOwnership>();
    const financialWalletRepository = new MemoryRepository<WalletAccount>();
    const financialBindingRepository = new MemoryRepository<CustomerFinancialAccountBinding>();
    const ledgerAccountRepository = new MemoryRepository<LedgerAccount>();
    const ledgerJournalRepository = new MemoryRepository<LedgerJournal>();
    const ledgerLineRepository = new MemoryRepository<LedgerLine>();
    const depositRepository = new MemoryRepository<Deposit>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerProfile, profileRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerAddress, addressRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerContactMethod, contactRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerIdentityDocument, documentRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerKycAssessment, kycRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerOnboarding, onboardingRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerEligibility, eligibilityRepository as unknown as MemoryRepository<ObjectLiteral>],
      [CustomerWallet, customerWalletRepository as unknown as MemoryRepository<ObjectLiteral>],
      [
        CustomerAuthenticationCredential,
        credentialRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [WalletOwnership, walletOwnershipRepository as unknown as MemoryRepository<ObjectLiteral>],
      [WalletAccount, financialWalletRepository as unknown as MemoryRepository<ObjectLiteral>],
      [
        CustomerFinancialAccountBinding,
        financialBindingRepository as unknown as MemoryRepository<ObjectLiteral>,
      ],
      [LedgerAccount, ledgerAccountRepository as unknown as MemoryRepository<ObjectLiteral>],
      [LedgerJournal, ledgerJournalRepository as unknown as MemoryRepository<ObjectLiteral>],
      [LedgerLine, ledgerLineRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Deposit, depositRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const manager = new MemoryManager(repositories);
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerService(
      customerRepository as unknown as Repository<Customer>,
      profileRepository as unknown as Repository<CustomerProfile>,
      addressRepository as unknown as Repository<CustomerAddress>,
      contactRepository as unknown as Repository<CustomerContactMethod>,
      documentRepository as unknown as Repository<CustomerIdentityDocument>,
      kycRepository as unknown as Repository<CustomerKycAssessment>,
      new MemoryDataSource(manager) as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories,
      lifecycleRepositories: {
        onboardingRepository,
        eligibilityRepository,
        customerWalletRepository,
        credentialRepository,
        walletOwnershipRepository,
        financialWalletRepository,
        financialBindingRepository,
        ledgerAccountRepository,
        ledgerJournalRepository,
        ledgerLineRepository,
        depositRepository,
      },
    };
  }

  async function createCustomer(service: CustomerService) {
    return service.create({
      reference: 'customer-one',
      type: CustomerType.INDIVIDUAL,
      actor: 'customer-ops',
    });
  }

  it('creates customers and rejects duplicate references', async () => {
    const { service } = fixture();
    await createCustomer(service);
    await expect(
      service.create({
        reference: 'customer-one',
        type: CustomerType.BUSINESS,
        actor: 'customer-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates only the canonical customer record without activation or financial side effects', async () => {
    const { service, lifecycleRepositories } = fixture();

    const customer = await service.create({
      reference: 'public-registration-customer',
      type: CustomerType.INDIVIDUAL,
      status: CustomerStatus.ACTIVE,
      actor: 'public-registration',
    });

    expect(customer).toMatchObject({
      reference: 'public-registration-customer',
      type: CustomerType.INDIVIDUAL,
      status: CustomerStatus.ACTIVE,
      kycLevel: CustomerKycLevel.NONE,
      kycStatus: CustomerKycStatus.NOT_STARTED,
    });
    expect(lifecycleRepositories.onboardingRepository.records.size).toBe(0);
    expect(lifecycleRepositories.eligibilityRepository.records.size).toBe(0);
    expect(lifecycleRepositories.customerWalletRepository.records.size).toBe(0);
    expect(lifecycleRepositories.credentialRepository.records.size).toBe(0);
    expect(lifecycleRepositories.walletOwnershipRepository.records.size).toBe(0);
    expect(lifecycleRepositories.financialWalletRepository.records.size).toBe(0);
    expect(lifecycleRepositories.financialBindingRepository.records.size).toBe(0);
    expect(lifecycleRepositories.ledgerAccountRepository.records.size).toBe(0);
    expect(lifecycleRepositories.ledgerJournalRepository.records.size).toBe(0);
    expect(lifecycleRepositories.ledgerLineRepository.records.size).toBe(0);
    expect(lifecycleRepositories.depositRepository.records.size).toBe(0);
  });

  it('creates and audits profile, address, contact, and identity records', async () => {
    const { service, audit } = fixture();
    const customer = await createCustomer(service);
    const profile = await service.createProfile(customer.id, {
      displayName: 'Customer One',
      actor: 'customer-ops',
    });
    const address = await service.createAddress(customer.id, {
      type: AddressType.RESIDENTIAL,
      lineOne: '1 Test Street',
      city: 'Lagos',
      state: 'Lagos',
      country: 'NG',
      isPrimary: true,
      actor: 'customer-ops',
    });
    const contact = await service.createContactMethod(customer.id, {
      type: ContactMethodType.EMAIL,
      value: 'customer@example.com',
      isPrimary: true,
      actor: 'customer-ops',
    });
    const document = await service.createIdentityDocument(customer.id, {
      type: IdentityDocumentType.NIN,
      documentNumber: '12345678901',
      issuingCountry: 'NG',
      actor: 'customer-ops',
    });

    expect(profile.customerId).toBe(customer.id);
    expect(address.customerId).toBe(customer.id);
    expect(contact.normalizedValue).toBe('customer@example.com');
    expect(document.customerId).toBe(customer.id);
    expect(audit.record).toHaveBeenCalledTimes(5);
  });

  it('rejects duplicate contacts and identity-document types', async () => {
    const { service } = fixture();
    const customer = await createCustomer(service);
    await service.createContactMethod(customer.id, {
      type: ContactMethodType.PHONE,
      value: '+2348012345678',
      isPrimary: true,
      actor: 'ops',
    });
    await expect(
      service.createContactMethod(customer.id, {
        type: ContactMethodType.PHONE,
        value: '+2348012345678',
        isPrimary: false,
        actor: 'ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.createIdentityDocument(customer.id, {
      type: IdentityDocumentType.BVN,
      documentNumber: '12345678901',
      issuingCountry: 'NG',
      actor: 'ops',
    });
    await expect(
      service.createIdentityDocument(customer.id, {
        type: IdentityDocumentType.BVN,
        documentNumber: '98765432109',
        issuingCountry: 'NG',
        actor: 'ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('supports KYC lifecycle and rejects invalid transitions', async () => {
    const { service } = fixture();
    const customer = await createCustomer(service);
    const pending = await service.createKycAssessment(customer.id, {
      level: CustomerKycLevel.LEVEL_1,
      status: CustomerKycStatus.PENDING,
      assessedBy: 'kyc-ops',
    });
    const approved = await service.createKycAssessment(customer.id, {
      level: CustomerKycLevel.LEVEL_1,
      status: CustomerKycStatus.APPROVED,
      assessedBy: 'kyc-ops',
    });

    expect(pending.status).toBe(CustomerKycStatus.PENDING);
    expect(approved.status).toBe(CustomerKycStatus.APPROVED);
    await expect(
      service.createKycAssessment(customer.id, {
        level: CustomerKycLevel.LEVEL_3,
        status: CustomerKycStatus.NOT_STARTED,
        assessedBy: 'kyc-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
