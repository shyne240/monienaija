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
import { CustomerPreference } from './customer-preference.entity';
import { PreferenceHistoryAction } from './customer-preference.enums';
import type {
  CreateCustomerPreferenceCommand,
  CustomerPreferenceView,
  NotificationPreferenceCommand,
  PreferenceHistoryView,
  SecurityPreferenceCommand,
  UpdateCustomerPreferenceCommand,
} from './customer-preference.types';
import { PreferenceHistory } from './preference-history.entity';

@Injectable()
export class CustomerPreferenceService {
  constructor(
    @InjectRepository(CustomerPreference)
    private readonly preferenceRepository: Repository<CustomerPreference>,
    @InjectRepository(PreferenceHistory)
    private readonly historyRepository: Repository<PreferenceHistory>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createPreferences(
    customerId: string,
    command: CreateCustomerPreferenceCommand,
  ): Promise<CustomerPreferenceView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    try {
      const preferenceId = await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const repository = manager.getRepository(CustomerPreference);
        const existing = await this.findActivePreference(repository, customerId);
        if (existing) {
          throw new ConflictException('Customer already has an active preference profile');
        }
        const preference = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            language: { code: command.language },
            theme: { code: command.theme },
            notifications: { ...command.notifications },
            security: { ...command.security },
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_PREFERENCE',
          preference.id,
          'CREATED',
          actor,
          undefined,
          this.preferenceValues(preference),
        );
        await this.appendHistory(
          manager,
          preference.id,
          PreferenceHistoryAction.CREATED,
          actor,
          null,
          this.preferenceValues(preference),
        );
        return preference.id;
      });
      return this.getPreferences(customerId, preferenceId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Customer already has an active preference profile');
      }
      throw error;
    }
  }

  async getPreferences(
    customerId: string,
    expectedPreferenceId?: string,
  ): Promise<CustomerPreferenceView> {
    this.assertUuid(customerId, 'customerId');
    if (expectedPreferenceId !== undefined) {
      this.assertUuid(expectedPreferenceId, 'preferenceId');
    }
    await this.requireCustomer(this.customerRepository, customerId);
    const preference = await this.findActivePreference(this.preferenceRepository, customerId);
    if (!preference) {
      throw new NotFoundException(`Preferences for customer ${customerId} were not found`);
    }
    if (expectedPreferenceId !== undefined && preference.id !== expectedPreferenceId) {
      throw new NotFoundException(`Preferences for customer ${customerId} were not found`);
    }
    return this.toView(preference);
  }

  async updatePreferences(
    customerId: string,
    command: UpdateCustomerPreferenceCommand,
  ): Promise<CustomerPreferenceView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const repository = manager.getRepository(CustomerPreference);
      const preference = await this.findActivePreference(repository, customerId);
      if (!preference) {
        throw new NotFoundException(`Preferences for customer ${customerId} were not found`);
      }
      if (command.version !== undefined && command.version !== preference.version) {
        throw new ConflictException('Preference profile version is stale');
      }
      if (!this.hasChanges(command)) {
        return this.toView(preference);
      }
      const previous = this.preferenceValues(preference);
      if (command.language !== undefined) {
        preference.language.code = command.language;
      }
      if (command.theme !== undefined) {
        preference.theme.code = command.theme;
      }
      if (command.notifications !== undefined) {
        Object.assign(preference.notifications, command.notifications);
      }
      if (command.security !== undefined) {
        Object.assign(preference.security, command.security);
      }
      const saved = await repository.save(preference);
      await this.audit(
        manager,
        'CUSTOMER_PREFERENCE',
        saved.id,
        'UPDATED',
        actor,
        previous,
        this.preferenceValues(saved),
      );
      await this.appendHistory(
        manager,
        saved.id,
        PreferenceHistoryAction.UPDATED,
        actor,
        previous,
        this.preferenceValues(saved),
      );
      return this.toView(saved);
    });
  }

  async listHistory(customerId: string): Promise<PreferenceHistoryView[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const preference = await this.findActivePreference(this.preferenceRepository, customerId);
    if (!preference) {
      throw new NotFoundException(`Preferences for customer ${customerId} were not found`);
    }
    const history = await this.historyRepository.find({ where: { preferenceId: preference.id } });
    return this.sortByCreatedAt(
      history
        .filter((entry) => this.isNotDeleted(entry.deletedAt))
        .map((entry) => ({
          id: entry.id,
          preferenceId: entry.preferenceId,
          action: entry.action,
          previousValues: entry.previousValues,
          newValues: entry.newValues,
          actor: entry.actor,
          createdAt: entry.createdAt,
        })),
    );
  }

  private async findActivePreference(
    repository: Repository<CustomerPreference>,
    customerId: string,
  ): Promise<CustomerPreference | null> {
    const preferences = await repository.find({ where: { customerId } });
    return preferences.find((preference) => this.isNotDeleted(preference.deletedAt)) ?? null;
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

  private async appendHistory(
    manager: EntityManager,
    preferenceId: string,
    action: PreferenceHistoryAction,
    actor: string,
    previousValues: Record<string, unknown> | null,
    newValues: Record<string, unknown>,
  ): Promise<PreferenceHistory> {
    const history = await manager.getRepository(PreferenceHistory).save(
      manager.getRepository(PreferenceHistory).create({
        id: randomUUID(),
        preferenceId,
        action,
        previousValues,
        newValues,
        actor,
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'PREFERENCE_HISTORY',
      history.id,
      'CREATED',
      actor,
      undefined,
      this.historyValues(history),
    );
    return history;
  }

  private hasChanges(command: UpdateCustomerPreferenceCommand): boolean {
    return (
      command.language !== undefined ||
      command.theme !== undefined ||
      (command.notifications !== undefined && Object.keys(command.notifications).length > 0) ||
      (command.security !== undefined && Object.keys(command.security).length > 0)
    );
  }

  private preferenceValues(preference: CustomerPreference): Record<string, unknown> {
    return {
      customerId: preference.customerId,
      language: preference.language.code,
      theme: preference.theme.code,
      notifications: this.notificationValues(preference.notifications),
      security: this.securityValues(preference.security),
      version: preference.version,
    };
  }

  private notificationValues(
    notifications: NotificationPreferenceCommand,
  ): NotificationPreferenceCommand {
    return {
      email: notifications.email,
      sms: notifications.sms,
      push: notifications.push,
      inApp: notifications.inApp,
    };
  }

  private securityValues(security: SecurityPreferenceCommand): SecurityPreferenceCommand {
    return {
      loginAlerts: security.loginAlerts,
      transactionAlerts: security.transactionAlerts,
      deviceRegistrationAlerts: security.deviceRegistrationAlerts,
      biometricAllowed: security.biometricAllowed,
    };
  }

  private historyValues(history: PreferenceHistory): Record<string, unknown> {
    return {
      preferenceId: history.preferenceId,
      action: history.action,
      previousValues: history.previousValues,
      newValues: history.newValues,
      actor: history.actor,
    };
  }

  private toView(preference: CustomerPreference): CustomerPreferenceView {
    return {
      id: preference.id,
      customerId: preference.customerId,
      language: preference.language.code,
      theme: preference.theme.code,
      notifications: this.notificationValues(preference.notifications),
      security: this.securityValues(preference.security),
      version: preference.version,
      createdAt: preference.createdAt,
      updatedAt: preference.updatedAt,
    };
  }

  private normalizeActor(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 160) {
      throw new BadRequestException('actor must contain 1 to 160 characters');
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
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '23505';
  }
}
