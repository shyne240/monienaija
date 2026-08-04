import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { normalizeCurrency } from '../common/money';
import { Customer } from '../customer/customer.entity';
import { CustomerEligibilityStatus } from '../customer-eligibility/customer-eligibility.enums';
import { CustomerEligibility } from '../customer-eligibility/customer-eligibility.entity';
import { CustomerOnboardingStatus } from '../customer-onboarding/customer-onboarding.enums';
import { CustomerOnboarding } from '../customer-onboarding/customer-onboarding.entity';
import { AuditService } from '../operations/audit.service';
import { CustomerWallet } from './customer-wallet.entity';
import {
  CustomerWalletStatus,
  CustomerWalletType,
  WalletProvisioningHistoryAction,
} from './customer-wallet.enums';
import type {
  CreateCustomerWalletCommand,
  CreateWalletAliasCommand,
  CustomerWalletView,
  UpdateCustomerWalletCommand,
} from './customer-wallet.types';
import { WalletAlias } from './wallet-alias.entity';
import { WalletOwnership } from './wallet-ownership.entity';
import { WalletProvisioningHistory } from './wallet-provisioning-history.entity';

@Injectable()
export class CustomerWalletService {
  constructor(
    @InjectRepository(CustomerWallet)
    private readonly walletRepository: Repository<CustomerWallet>,
    @InjectRepository(WalletProvisioningHistory)
    private readonly historyRepository: Repository<WalletProvisioningHistory>,
    @InjectRepository(WalletAlias)
    private readonly aliasRepository: Repository<WalletAlias>,
    @InjectRepository(WalletOwnership)
    private readonly ownershipRepository: Repository<WalletOwnership>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerOnboarding)
    private readonly onboardingRepository: Repository<CustomerOnboarding>,
    @InjectRepository(CustomerEligibility)
    private readonly eligibilityRepository: Repository<CustomerEligibility>,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async createWallet(
    customerId: string,
    command: CreateCustomerWalletCommand,
  ): Promise<CustomerWalletView> {
    this.assertUuid(customerId, 'customerId');
    const actor = this.normalizeActor(command.actor);
    const currency = normalizeCurrency(command.currency);
    const status = command.status ?? CustomerWalletStatus.PENDING;
    let walletId: string;

    try {
      walletId = await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        await this.requireEligibleProvisioning(manager, customerId);
        const repository = manager.getRepository(CustomerWallet);
        if (command.type === CustomerWalletType.PRIMARY) {
          const existingPrimary = await repository.findOne({
            where: { customerId, type: CustomerWalletType.PRIMARY },
          });
          if (existingPrimary && this.isNotDeleted(existingPrimary.deletedAt)) {
            throw new ConflictException('Customer already has a PRIMARY wallet');
          }
        }
        const wallet = await repository.save(
          repository.create({
            id: randomUUID(),
            customerId,
            type: command.type,
            currency,
            status,
            closedAt: null,
            version: 1,
            deletedAt: null,
          }),
        );
        const ownership = await manager.getRepository(WalletOwnership).save(
          manager.getRepository(WalletOwnership).create({
            id: randomUUID(),
            walletId: wallet.id,
            customerId,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'CUSTOMER_WALLET',
          wallet.id,
          'CREATED',
          actor,
          undefined,
          this.walletValues(wallet),
        );
        await this.audit(
          manager,
          'WALLET_OWNERSHIP',
          ownership.id,
          'CREATED',
          actor,
          undefined,
          this.ownershipValues(ownership),
        );
        await this.appendHistory(
          manager,
          wallet.id,
          WalletProvisioningHistoryAction.PROVISIONED,
          actor,
          null,
          wallet.status,
          { type: wallet.type, currency: wallet.currency },
        );
        await this.appendHistory(
          manager,
          wallet.id,
          WalletProvisioningHistoryAction.OWNERSHIP_CREATED,
          actor,
          null,
          null,
          { ownershipId: ownership.id },
        );
        return wallet.id;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        if (command.type === CustomerWalletType.PRIMARY) {
          throw new ConflictException('Customer already has a PRIMARY wallet');
        }
        throw new ConflictException('Customer wallet already exists');
      }
      throw error;
    }

    return this.getWallet(customerId, walletId);
  }

  async listWallets(customerId: string): Promise<CustomerWalletView[]> {
    this.assertUuid(customerId, 'customerId');
    await this.requireCustomer(this.customerRepository, customerId);
    const wallets = await this.walletRepository.find({ where: { customerId } });
    return this.sortByCreatedAt(
      wallets
        .filter((wallet) => this.isNotDeleted(wallet.deletedAt))
        .map((wallet) => this.toView(wallet)),
    );
  }

  async getWallet(customerId: string, walletId: string): Promise<CustomerWalletView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(walletId, 'walletId');
    await this.requireCustomer(this.customerRepository, customerId);
    const wallet = await this.walletRepository.findOne({ where: { id: walletId, customerId } });
    if (!wallet || !this.isNotDeleted(wallet.deletedAt)) {
      throw new NotFoundException(`Wallet ${walletId} was not found`);
    }
    return this.toView(wallet);
  }

  async updateWallet(
    customerId: string,
    walletId: string,
    command: UpdateCustomerWalletCommand,
  ): Promise<CustomerWalletView> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(walletId, 'walletId');
    const actor = this.normalizeActor(command.actor);
    return this.dataSource.transaction(async (manager) => {
      await this.requireCustomer(manager.getRepository(Customer), customerId);
      const repository = manager.getRepository(CustomerWallet);
      const wallet = await repository.findOne({ where: { id: walletId, customerId } });
      if (!wallet || !this.isNotDeleted(wallet.deletedAt)) {
        throw new NotFoundException(`Wallet ${walletId} was not found`);
      }
      if (command.version !== undefined && command.version !== wallet.version) {
        throw new ConflictException('Wallet version is stale');
      }
      if (wallet.status === command.status) {
        return this.toView(wallet);
      }
      this.assertStatusTransition(wallet.status, command.status);
      if (command.status === CustomerWalletStatus.ACTIVE) {
        await this.requireEligibleProvisioning(manager, customerId);
      }
      const previousStatus = wallet.status;
      const previous = this.walletValues(wallet);
      wallet.status = command.status;
      wallet.closedAt = command.status === CustomerWalletStatus.CLOSED ? new Date() : null;
      const saved = await repository.save(wallet);
      await this.audit(
        manager,
        'CUSTOMER_WALLET',
        saved.id,
        'STATUS_UPDATED',
        actor,
        previous,
        this.walletValues(saved),
      );
      await this.appendHistory(
        manager,
        saved.id,
        WalletProvisioningHistoryAction.STATUS_CHANGED,
        actor,
        previousStatus,
        saved.status,
        {},
      );
      return this.toView(saved);
    });
  }

  async createAlias(
    customerId: string,
    walletId: string,
    command: CreateWalletAliasCommand,
  ): Promise<WalletAlias> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(walletId, 'walletId');
    const actor = this.normalizeActor(command.actor);
    const aliasValue = this.normalizeAlias(command.alias);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireCustomer(manager.getRepository(Customer), customerId);
        const wallet = await this.requireWallet(
          manager.getRepository(CustomerWallet),
          customerId,
          walletId,
        );
        const repository = manager.getRepository(WalletAlias);
        const existing = await repository.findOne({ where: { alias: aliasValue } });
        if (existing && this.isNotDeleted(existing.deletedAt)) {
          throw new ConflictException(`Wallet alias ${aliasValue} already exists`);
        }
        const alias = await repository.save(
          repository.create({
            id: randomUUID(),
            walletId: wallet.id,
            alias: aliasValue,
            version: 1,
            deletedAt: null,
          }),
        );
        await this.audit(
          manager,
          'WALLET_ALIAS',
          alias.id,
          'CREATED',
          actor,
          undefined,
          this.aliasValues(alias),
        );
        await this.appendHistory(
          manager,
          wallet.id,
          WalletProvisioningHistoryAction.ALIAS_ADDED,
          actor,
          null,
          null,
          { aliasId: alias.id, alias: alias.alias },
        );
        return alias;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(`Wallet alias ${aliasValue} already exists`);
      }
      throw error;
    }
  }

  async listHistory(customerId: string, walletId: string): Promise<WalletProvisioningHistory[]> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(walletId, 'walletId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireWallet(this.walletRepository, customerId, walletId);
    const history = await this.historyRepository.find({ where: { walletId } });
    return this.sortByCreatedAt(history.filter((entry) => this.isNotDeleted(entry.deletedAt)));
  }

  async getOwnership(customerId: string, walletId: string): Promise<WalletOwnership> {
    this.assertUuid(customerId, 'customerId');
    this.assertUuid(walletId, 'walletId');
    await this.requireCustomer(this.customerRepository, customerId);
    await this.requireWallet(this.walletRepository, customerId, walletId);
    const ownership = await this.ownershipRepository.findOne({ where: { walletId } });
    if (!ownership || !this.isNotDeleted(ownership.deletedAt)) {
      throw new NotFoundException(`Ownership for wallet ${walletId} was not found`);
    }
    return ownership;
  }

  private async requireEligibleProvisioning(
    manager: EntityManager,
    customerId: string,
  ): Promise<void> {
    const onboarding = await manager.getRepository(CustomerOnboarding).find({
      where: { customerId, status: CustomerOnboardingStatus.COMPLETED },
    });
    if (!onboarding.some((record) => this.isNotDeleted(record.deletedAt))) {
      throw new ConflictException(
        'Customer onboarding must be COMPLETED before wallet provisioning',
      );
    }
    const eligibility = await manager.getRepository(CustomerEligibility).find({
      where: { customerId, status: CustomerEligibilityStatus.ELIGIBLE },
    });
    if (!eligibility.some((record) => this.isNotDeleted(record.deletedAt))) {
      throw new ConflictException(
        'Customer eligibility must be ELIGIBLE before wallet provisioning',
      );
    }
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

  private async requireWallet(
    repository: Repository<CustomerWallet>,
    customerId: string,
    walletId: string,
  ): Promise<CustomerWallet> {
    const wallet = await repository.findOne({ where: { id: walletId, customerId } });
    if (!wallet || !this.isNotDeleted(wallet.deletedAt)) {
      throw new NotFoundException(`Wallet ${walletId} was not found`);
    }
    return wallet;
  }

  private assertStatusTransition(current: CustomerWalletStatus, next: CustomerWalletStatus): void {
    const allowed: Record<CustomerWalletStatus, CustomerWalletStatus[]> = {
      [CustomerWalletStatus.PENDING]: [
        CustomerWalletStatus.ACTIVE,
        CustomerWalletStatus.SUSPENDED,
        CustomerWalletStatus.CLOSED,
      ],
      [CustomerWalletStatus.ACTIVE]: [CustomerWalletStatus.SUSPENDED, CustomerWalletStatus.CLOSED],
      [CustomerWalletStatus.SUSPENDED]: [CustomerWalletStatus.ACTIVE, CustomerWalletStatus.CLOSED],
      [CustomerWalletStatus.CLOSED]: [],
    };
    if (!allowed[current].includes(next)) {
      throw new ConflictException(`Invalid wallet status transition from ${current} to ${next}`);
    }
  }

  private async appendHistory(
    manager: EntityManager,
    walletId: string,
    action: WalletProvisioningHistoryAction,
    actor: string,
    previousStatus: CustomerWalletStatus | null,
    newStatus: CustomerWalletStatus | null,
    metadata: Record<string, unknown>,
  ): Promise<WalletProvisioningHistory> {
    const history = await manager.getRepository(WalletProvisioningHistory).save(
      manager.getRepository(WalletProvisioningHistory).create({
        id: randomUUID(),
        walletId,
        action,
        previousStatus,
        newStatus,
        actor,
        metadata,
        deletedAt: null,
      }),
    );
    await this.audit(
      manager,
      'WALLET_PROVISIONING_HISTORY',
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

  private normalizeAlias(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.:-]{0,159}$/.test(normalized)) {
      throw new BadRequestException('alias must contain 1 to 160 safe characters');
    }
    return normalized;
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

  private toView(wallet: CustomerWallet): CustomerWalletView {
    return {
      id: wallet.id,
      customerId: wallet.customerId,
      type: wallet.type,
      currency: wallet.currency,
      status: wallet.status,
      closedAt: wallet.closedAt,
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }

  private walletValues(wallet: CustomerWallet): Record<string, unknown> {
    return {
      customerId: wallet.customerId,
      type: wallet.type,
      currency: wallet.currency,
      status: wallet.status,
      closedAt: wallet.closedAt,
      version: wallet.version,
    };
  }

  private ownershipValues(ownership: WalletOwnership): Record<string, unknown> {
    return {
      walletId: ownership.walletId,
      customerId: ownership.customerId,
      version: ownership.version,
    };
  }

  private aliasValues(alias: WalletAlias): Record<string, unknown> {
    return {
      walletId: alias.walletId,
      alias: alias.alias,
      version: alias.version,
    };
  }

  private historyValues(history: WalletProvisioningHistory): Record<string, unknown> {
    return {
      walletId: history.walletId,
      action: history.action,
      previousStatus: history.previousStatus,
      newStatus: history.newStatus,
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
