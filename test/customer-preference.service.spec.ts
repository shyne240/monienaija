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
import { CustomerPreference } from '../src/customer-preference/customer-preference.entity';
import {
  CustomerLanguage,
  CustomerTheme,
  PreferenceHistoryAction,
} from '../src/customer-preference/customer-preference.enums';
import { CustomerPreferenceService } from '../src/customer-preference/customer-preference.service';
import { CreateCustomerPreferenceDto } from '../src/customer-preference/dto/create-customer-preference.dto';
import { UpdateCustomerPreferenceDto } from '../src/customer-preference/dto/update-customer-preference.dto';
import { NotificationPreferenceDto } from '../src/customer-preference/dto/notification-preference.dto';
import { PreferenceHistory } from '../src/customer-preference/preference-history.entity';
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
      throw new Error('Unexpected preference repository');
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

describe('CustomerPreferenceService', () => {
  function fixture() {
    const preferenceRepository = new MemoryRepository<CustomerPreference>();
    const historyRepository = new MemoryRepository<PreferenceHistory>();
    const customerRepository = new MemoryRepository<Customer>();
    const repositories = new Map<unknown, MemoryRepository<ObjectLiteral>>([
      [CustomerPreference, preferenceRepository as unknown as MemoryRepository<ObjectLiteral>],
      [PreferenceHistory, historyRepository as unknown as MemoryRepository<ObjectLiteral>],
      [Customer, customerRepository as unknown as MemoryRepository<ObjectLiteral>],
    ]);
    const dataSource = new MemoryDataSource(new MemoryManager(repositories));
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new CustomerPreferenceService(
      preferenceRepository as unknown as Repository<CustomerPreference>,
      historyRepository as unknown as Repository<PreferenceHistory>,
      customerRepository as unknown as Repository<Customer>,
      dataSource as unknown as DataSource,
      audit as unknown as AuditService,
    );
    return {
      service,
      audit,
      repositories: { preferenceRepository, historyRepository, customerRepository },
    };
  }

  async function createCustomer(testFixture: ReturnType<typeof fixture>): Promise<Customer> {
    return testFixture.repositories.customerRepository.save(
      testFixture.repositories.customerRepository.create({
        id: '00000000-0000-4000-8000-000000000001',
        reference: 'preference-customer',
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        kycLevel: CustomerKycLevel.LEVEL_1,
        kycStatus: CustomerKycStatus.APPROVED,
        version: 1,
        deletedAt: null,
      }),
    );
  }

  async function createPreferences(testFixture: ReturnType<typeof fixture>, customerId: string) {
    return testFixture.service.createPreferences(customerId, {
      language: CustomerLanguage.EN,
      theme: CustomerTheme.SYSTEM,
      notifications: { email: true, sms: false, push: true, inApp: true },
      security: {
        loginAlerts: true,
        transactionAlerts: true,
        deviceRegistrationAlerts: true,
        biometricAllowed: false,
      },
      actor: 'preference-ops',
    });
  }

  it('creates one preference profile, rejects duplicates, and audits history', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const preferences = await createPreferences(testFixture, customer.id);
    const history = await testFixture.service.listHistory(customer.id);

    expect(preferences.language).toBe(CustomerLanguage.EN);
    expect(preferences.theme).toBe(CustomerTheme.SYSTEM);
    expect(preferences.notifications.sms).toBe(false);
    expect(preferences.security.biometricAllowed).toBe(false);
    expect(history).toHaveLength(1);
    expect(history[0]?.action).toBe(PreferenceHistoryAction.CREATED);
    expect(testFixture.repositories.preferenceRepository.records.size).toBe(1);
    expect(testFixture.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: 'CUSTOMER_PREFERENCE' }),
    );

    await expect(createPreferences(testFixture, customer.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('updates nested preferences, preserves unspecified fields, and appends history', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    await createPreferences(testFixture, customer.id);

    const updated = await testFixture.service.updatePreferences(customer.id, {
      language: CustomerLanguage.YO,
      theme: CustomerTheme.DARK,
      notifications: { email: false },
      security: { biometricAllowed: true },
      actor: 'preference-ops',
    });
    const history = await testFixture.service.listHistory(customer.id);

    expect(updated.language).toBe(CustomerLanguage.YO);
    expect(updated.theme).toBe(CustomerTheme.DARK);
    expect(updated.notifications.email).toBe(false);
    expect(updated.notifications.sms).toBe(false);
    expect(updated.notifications.push).toBe(true);
    expect(updated.security.biometricAllowed).toBe(true);
    expect(updated.security.loginAlerts).toBe(true);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([PreferenceHistoryAction.CREATED, PreferenceHistoryAction.UPDATED]),
    );
    expect(
      history.find((entry) => entry.action === PreferenceHistoryAction.UPDATED)?.previousValues,
    ).toEqual(expect.objectContaining({ language: CustomerLanguage.EN }));
  });

  it('rejects stale preference versions and supports soft-deleted profile replacement', async () => {
    const testFixture = fixture();
    const customer = await createCustomer(testFixture);
    const preferences = await createPreferences(testFixture, customer.id);

    await expect(
      testFixture.service.updatePreferences(customer.id, {
        language: CustomerLanguage.FR,
        version: preferences.version + 1,
        actor: 'preference-ops',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const stored = testFixture.repositories.preferenceRepository.records.get(preferences.id);
    if (!stored) {
      throw new Error('Expected preference persistence');
    }
    stored.deletedAt = new Date();
    const replacement = await createPreferences(testFixture, customer.id);
    expect(replacement.id).not.toBe(preferences.id);
  });

  it('validates nested DTOs and UUID parameters', async () => {
    const createErrors = await validate(
      plainToInstance(CreateCustomerPreferenceDto, {
        language: 'XX',
        theme: 'SYSTEM',
        notifications: {
          email: 'yes',
          sms: false,
          push: true,
          inApp: true,
        },
        security: {
          loginAlerts: true,
          transactionAlerts: true,
          deviceRegistrationAlerts: true,
          biometricAllowed: false,
        },
        actor: 'preference-ops',
      }),
    );
    expect(createErrors.some((error) => error.property === 'language')).toBe(true);
    expect(createErrors.some((error) => error.property === 'notifications')).toBe(true);

    const updateErrors = await validate(
      plainToInstance(UpdateCustomerPreferenceDto, {
        theme: 'UNKNOWN',
        notifications: { email: 'yes' },
        actor: 'preference-ops',
      }),
    );
    expect(updateErrors.some((error) => error.property === 'theme')).toBe(true);
    expect(updateErrors.some((error) => error.property === 'notifications')).toBe(true);

    const notificationErrors = await validate(
      plainToInstance(NotificationPreferenceDto, {
        email: 'yes',
        sms: false,
        push: true,
        inApp: true,
      }),
    );
    expect(notificationErrors.some((error) => error.property === 'email')).toBe(true);

    const testFixture = fixture();
    await expect(testFixture.service.getPreferences('not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
