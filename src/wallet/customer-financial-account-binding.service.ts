import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPolicy } from '../authorization/authorization.types';
import { normalizeAccountingUnit, normalizeCurrency } from '../common/money';
import { Customer } from '../customer/customer.entity';
import { CustomerStatus } from '../customer/customer.enums';
import { CustomerWallet } from '../customer-wallet/customer-wallet.entity';
import { CustomerWalletStatus } from '../customer-wallet/customer-wallet.enums';
import { WalletOwnership } from '../customer-wallet/wallet-ownership.entity';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../ledger/ledger.enums';
import { LedgerLine } from '../ledger/ledger-line.entity';
import { AuditService } from '../operations/audit.service';
import { WalletStatus } from './wallet.enums';
import { IdempotencyService } from '../operations/idempotency.service';
import { IdempotencyRecordStatus } from '../operations/operations.enums';
import type { RequestContext } from '../production/request-context';
import { CustomerFinancialAccountBinding } from './customer-financial-account-binding.entity';
import {
  CustomerFinancialAccountBindingMode,
  CustomerFinancialAccountBindingState,
} from './customer-financial-account-binding.enums';
import type {
  CustomerFinancialAccountBindingCommand,
  CustomerFinancialAccountBindingResult,
  NormalizedCustomerFinancialAccountBindingCommand,
} from './customer-financial-account-binding.types';
import { WalletAccount } from './wallet-account.entity';
import { WalletService } from './wallet.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTEXT_LENGTH = 255;
const IDEMPOTENCY_SCOPE = 'wallet.account-binding.v1';

export const CUSTOMER_FINANCIAL_ACCOUNT_BINDING_POLICY: AuthorizationPolicy = {
  resourceType: 'customer-financial-account-binding',
  action: 'wallet:account-binding:write',
  requiredScopes: ['wallet:account-binding:write'],
  allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
  customerAccess: 'ANY',
};

@Injectable()
export class CustomerFinancialAccountBindingService {
  constructor(
    @InjectRepository(CustomerFinancialAccountBinding)
    private readonly bindingRepository: Repository<CustomerFinancialAccountBinding>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerWallet)
    private readonly customerWalletRepository: Repository<CustomerWallet>,
    @InjectRepository(WalletOwnership)
    private readonly ownershipRepository: Repository<WalletOwnership>,
    @InjectRepository(WalletAccount)
    private readonly walletRepository: Repository<WalletAccount>,
    @InjectRepository(LedgerAccount)
    private readonly ledgerAccountRepository: Repository<LedgerAccount>,
    @InjectRepository(LedgerLine)
    private readonly ledgerLineRepository: Repository<LedgerLine>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async bind(
    command: CustomerFinancialAccountBindingCommand,
  ): Promise<CustomerFinancialAccountBindingResult> {
    const normalized = this.normalizeCommand(command);
    const authorization = await this.authorizationService.authorize(
      command.principal,
      CUSTOMER_FINANCIAL_ACCOUNT_BINDING_POLICY,
      {
        type: 'customer-financial-account-binding',
        id: normalized.customerWalletId,
        customerId: normalized.customerId,
      },
    );
    if (!authorization.allowed) {
      throw new ForbiddenException(`Authorization denied: ${authorization.reason}`);
    }

    const requestHash = this.requestHash(normalized);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.executeInTransaction(manager, normalized, requestHash),
        );
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) {
          continue;
        }
        await this.recordFailureAudit(normalized, error);
        if (
          this.isConstraintViolation(
            error,
            'uq_customer_financial_account_bindings_active_customer_currency',
          )
        ) {
          throw new ConflictException(
            'An active financial account mapping already exists for this customer and currency',
          );
        }
        if (
          this.isConstraintViolation(
            error,
            'uq_customer_financial_account_bindings_customer_wallet',
          )
        ) {
          throw new ConflictException(
            'The customer wallet already has a financial account mapping',
          );
        }
        if (
          this.isConstraintViolation(error, 'uq_customer_financial_account_bindings_wallet_account')
        ) {
          throw new ConflictException('The wallet account is already mapped to a customer wallet');
        }
        if (
          this.isConstraintViolation(error, 'uq_customer_financial_account_bindings_ledger_account')
        ) {
          throw new ConflictException('The ledger account is already mapped to a customer wallet');
        }
        if (this.isConstraintViolation(error, 'uq_wallet_accounts_customer_currency')) {
          throw new ConflictException('A wallet already exists for this customer and currency');
        }
        if (this.isConstraintViolation(error, 'uq_wallet_accounts_creation_idempotency_key')) {
          throw new ConflictException('The wallet provisioning request is already in progress');
        }
        throw error;
      }
    }

    throw new ConflictException('The account binding could not complete after concurrent retries');
  }

  private async executeInTransaction(
    manager: EntityManager,
    command: NormalizedCustomerFinancialAccountBindingCommand,
    requestHash: string,
  ): Promise<CustomerFinancialAccountBindingResult> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: IDEMPOTENCY_SCOPE,
      key: command.idempotencyKey,
      requestHash,
      retentionSeconds: 0,
    });

    if (reservation.kind === 'REPLAY') {
      if (reservation.record.status !== IdempotencyRecordStatus.COMPLETED) {
        throw new ConflictException('The idempotent binding request did not complete successfully');
      }
      const bindingId = reservation.record.resourceId;
      if (!bindingId || !UUID_PATTERN.test(bindingId)) {
        throw new ConflictException('The idempotent binding result is incomplete');
      }
      const binding = await manager
        .getRepository(CustomerFinancialAccountBinding)
        .findOne({ where: { id: bindingId } });
      if (!binding) {
        throw new ConflictException('The idempotent binding result could not be found');
      }
      const result = this.toResult(binding, command, requestHash, 'REPLAYED', true);
      await this.recordAudit(manager, binding, command, 'REPLAYED');
      return result;
    }

    const sources = await this.loadAndValidateSources(manager, command);
    await this.assertNoExistingMapping(manager, command);

    const target =
      command.mode === CustomerFinancialAccountBindingMode.PROVISION_NEW
        ? await this.provisionNewWallet(manager, command)
        : await this.loadExistingWallet(manager, command);
    const ledgerAccount = await this.validateFinancialTarget(manager, command, target);

    const bindingRepository = manager.getRepository(CustomerFinancialAccountBinding);
    const binding = await bindingRepository.save(
      bindingRepository.create({
        id: randomUUID(),
        customerId: sources.customer.id,
        customerWalletId: sources.customerWallet.id,
        walletAccountId: target.id,
        ledgerAccountId: ledgerAccount.id,
        currency: command.currency,
        accountingUnit: command.accountingUnit,
        state: CustomerFinancialAccountBindingState.ACTIVE,
        sourceCustomerVersion: sources.customer.version,
        sourceCustomerWalletVersion: sources.customerWallet.version,
        version: 1,
        createdBy: command.principal.principalId,
        updatedBy: command.principal.principalId,
        lastCorrelationId: command.requestContext.correlationId,
        lastRequestId: command.requestContext.requestId,
        closedAt: null,
      }),
    );

    const result = this.toResult(
      binding,
      command,
      requestHash,
      command.mode === CustomerFinancialAccountBindingMode.PROVISION_NEW
        ? 'PROVISIONED_AND_BOUND'
        : 'BOUND_EXISTING',
      false,
    );
    await this.recordAudit(
      manager,
      binding,
      command,
      command.mode === CustomerFinancialAccountBindingMode.PROVISION_NEW
        ? 'PROVISIONED_AND_BOUND'
        : 'BOUND_EXISTING',
    );
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 201,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
      resourceId: binding.id,
    });
    return result;
  }

  private async loadAndValidateSources(
    manager: EntityManager,
    command: NormalizedCustomerFinancialAccountBindingCommand,
  ): Promise<{ customer: Customer; customerWallet: CustomerWallet }> {
    const customer = await manager
      .getRepository(Customer)
      .findOne({ where: { id: command.customerId } });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException(`Customer ${command.customerId} was not found`);
    }
    if (customer.status !== CustomerStatus.ACTIVE) {
      throw new ConflictException('Customer must be ACTIVE before account binding');
    }
    if (
      command.expectedCustomerVersion !== null &&
      command.expectedCustomerVersion !== customer.version
    ) {
      throw new ConflictException('Customer version is stale');
    }

    const customerWallet = await manager
      .getRepository(CustomerWallet)
      .findOne({ where: { id: command.customerWalletId } });
    if (!customerWallet || customerWallet.deletedAt) {
      throw new NotFoundException(`Customer wallet ${command.customerWalletId} was not found`);
    }
    if (customerWallet.customerId !== customer.id) {
      throw new ConflictException('Customer wallet ownership does not match the customer');
    }
    if (customerWallet.status !== CustomerWalletStatus.ACTIVE) {
      throw new ConflictException('Customer wallet must be ACTIVE before account binding');
    }
    if (customerWallet.currency !== command.currency) {
      throw new ConflictException('Customer wallet currency does not match the binding request');
    }
    if (
      command.expectedCustomerWalletVersion !== null &&
      command.expectedCustomerWalletVersion !== customerWallet.version
    ) {
      throw new ConflictException('Customer wallet version is stale');
    }

    const ownership = await manager.getRepository(WalletOwnership).findOne({
      where: { walletId: customerWallet.id, customerId: customer.id },
    });
    if (!ownership || ownership.deletedAt) {
      throw new ConflictException('Customer wallet ownership evidence is missing');
    }

    return { customer, customerWallet };
  }

  private async assertNoExistingMapping(
    manager: EntityManager,
    command: NormalizedCustomerFinancialAccountBindingCommand,
  ): Promise<void> {
    const repository = manager.getRepository(CustomerFinancialAccountBinding);
    const byCustomerWallet = await repository.findOne({
      where: { customerWalletId: command.customerWalletId },
    });
    if (byCustomerWallet) {
      throw new ConflictException('The customer wallet already has a financial account mapping');
    }

    const byCustomerCurrency = await repository.findOne({
      where: {
        customerId: command.customerId,
        currency: command.currency,
        state: CustomerFinancialAccountBindingState.ACTIVE,
      },
    });
    if (byCustomerCurrency) {
      throw new ConflictException(
        'An active financial account mapping already exists for this customer and currency',
      );
    }
  }

  private async provisionNewWallet(
    manager: EntityManager,
    command: NormalizedCustomerFinancialAccountBindingCommand,
  ): Promise<WalletAccount> {
    const existingCanonicalWallet = await manager.getRepository(WalletAccount).findOne({
      where: { customerId: command.customerId, currency: command.currency },
    });
    if (existingCanonicalWallet) {
      throw new ConflictException(
        'A canonical wallet already exists and requires an explicit existing-account binding',
      );
    }

    const provisioningKey = this.subordinateProvisioningKey(command.customerId, command.currency);
    return this.walletService.createWalletInTransaction(manager, {
      customerId: command.customerId,
      currency: command.currency,
      idempotencyKey: provisioningKey,
    });
  }

  private async loadExistingWallet(
    manager: EntityManager,
    command: NormalizedCustomerFinancialAccountBindingCommand,
  ): Promise<WalletAccount> {
    const wallet = await manager.getRepository(WalletAccount).findOne({
      where: { id: command.targetWalletAccountId! },
    });
    if (!wallet) {
      throw new NotFoundException(`Wallet account ${command.targetWalletAccountId} was not found`);
    }
    if (wallet.customerId.trim().toLowerCase() !== command.customerId) {
      throw new ConflictException(
        'The existing wallet customer reference requires controlled ownership review',
      );
    }
    if (
      command.expectedLedgerAccountId &&
      wallet.ledgerAccountId !== command.expectedLedgerAccountId
    ) {
      throw new ConflictException('The wallet ledger-account assertion does not match');
    }

    const existingLine = await manager.getRepository(LedgerLine).findOne({
      where: { ledgerAccountId: wallet.ledgerAccountId },
    });
    if (existingLine) {
      throw new ConflictException(
        'The existing wallet has financial history and requires controlled ownership review',
      );
    }
    return wallet;
  }

  private async validateFinancialTarget(
    manager: EntityManager,
    command: NormalizedCustomerFinancialAccountBindingCommand,
    wallet: WalletAccount,
  ): Promise<LedgerAccount> {
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new ConflictException('Wallet account must be ACTIVE before account binding');
    }
    if (wallet.currency !== command.currency) {
      throw new ConflictException('Wallet account currency does not match the binding request');
    }

    const ledgerAccount = await manager.getRepository(LedgerAccount).findOne({
      where: { id: wallet.ledgerAccountId },
    });
    if (!ledgerAccount) {
      throw new ConflictException('Wallet account ledger relationship is missing');
    }
    if (
      ledgerAccount.currency !== command.currency ||
      ledgerAccount.accountingUnit !== command.accountingUnit ||
      ledgerAccount.accountType !== LedgerAccountType.LIABILITY ||
      ledgerAccount.normalBalance !== LedgerNormalBalance.CREDIT ||
      ledgerAccount.allowNegativeBalance ||
      !ledgerAccount.isActive
    ) {
      throw new ConflictException('Wallet ledger account is incompatible with customer funds');
    }
    return ledgerAccount;
  }

  private async recordFailureAudit(
    command: NormalizedCustomerFinancialAccountBindingCommand,
    error: unknown,
  ): Promise<void> {
    const reason =
      error instanceof HttpException ? `HTTP_${error.getStatus()}` : 'BINDING_EXECUTION_FAILED';
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.auditService.record(manager, {
          entityType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING_ATTEMPT',
          entityId: command.customerWalletId,
          action: 'REJECTED',
          actor: command.principal.principalId,
          correlationId: command.requestContext.correlationId,
          requestId: command.requestContext.requestId,
          newValues: {
            mode: command.mode,
            customerId: command.customerId,
            customerWalletId: command.customerWalletId,
            currency: command.currency,
            accountingUnit: command.accountingUnit,
            reason,
          },
        });
      });
    } catch {
      // Preserve the original binding error if operational audit is unavailable.
    }
  }

  private async recordAudit(
    manager: EntityManager,
    binding: CustomerFinancialAccountBinding,
    command: NormalizedCustomerFinancialAccountBindingCommand,
    action: string,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
      entityId: binding.id,
      action,
      actor: command.principal.principalId,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      newValues: {
        customerId: binding.customerId,
        customerWalletId: binding.customerWalletId,
        walletAccountId: binding.walletAccountId,
        ledgerAccountId: binding.ledgerAccountId,
        currency: binding.currency,
        accountingUnit: binding.accountingUnit,
        state: binding.state,
        sourceCustomerVersion: binding.sourceCustomerVersion,
        sourceCustomerWalletVersion: binding.sourceCustomerWalletVersion,
      },
    });
  }

  private toResult(
    binding: CustomerFinancialAccountBinding,
    command: NormalizedCustomerFinancialAccountBindingCommand,
    requestHash: string,
    outcome: CustomerFinancialAccountBindingResult['outcome'],
    idempotencyReplay: boolean,
  ): CustomerFinancialAccountBindingResult {
    return {
      outcome,
      bindingState: binding.state,
      bindingId: binding.id,
      mappingVersion: command.mappingVersion,
      mode: command.mode,
      customerId: binding.customerId,
      customerWalletId: binding.customerWalletId,
      walletAccountId: binding.walletAccountId,
      ledgerAccountId: binding.ledgerAccountId,
      currency: binding.currency,
      accountingUnit: binding.accountingUnit,
      idempotencyScope: IDEMPOTENCY_SCOPE,
      requestHash,
      idempotencyReplay,
      sourceCustomerVersion: binding.sourceCustomerVersion,
      sourceCustomerWalletVersion: binding.sourceCustomerWalletVersion,
      correlationId: command.requestContext.correlationId,
    };
  }

  private normalizeCommand(
    command: CustomerFinancialAccountBindingCommand,
  ): NormalizedCustomerFinancialAccountBindingCommand {
    if (command.mappingVersion !== undefined && command.mappingVersion !== 1) {
      throw new BadRequestException('mappingVersion must be 1');
    }
    if (!Object.values(CustomerFinancialAccountBindingMode).includes(command.mode)) {
      throw new BadRequestException('mode is invalid');
    }
    const customerId = this.normalizeUuid(command.customerId, 'customerId');
    const customerWalletId = this.normalizeUuid(command.customerWalletId, 'customerWalletId');
    const currency = normalizeCurrency(command.currency);
    const accountingUnit = normalizeAccountingUnit(command.accountingUnit);
    if (accountingUnit !== 'CUSTOMER_FUNDS') {
      throw new BadRequestException('accountingUnit must be CUSTOMER_FUNDS');
    }

    const targetWalletAccountId = command.targetWalletAccountId
      ? this.normalizeUuid(command.targetWalletAccountId, 'targetWalletAccountId')
      : null;
    if (
      command.mode === CustomerFinancialAccountBindingMode.BIND_EXISTING &&
      !targetWalletAccountId
    ) {
      throw new BadRequestException('targetWalletAccountId is required for BIND_EXISTING');
    }
    if (
      command.mode === CustomerFinancialAccountBindingMode.PROVISION_NEW &&
      targetWalletAccountId
    ) {
      throw new BadRequestException('targetWalletAccountId is forbidden for PROVISION_NEW');
    }

    const expectedLedgerAccountId = command.expectedLedgerAccountId
      ? this.normalizeUuid(command.expectedLedgerAccountId, 'expectedLedgerAccountId')
      : null;
    const expectedCustomerVersion = this.normalizeVersion(
      command.expectedCustomerVersion,
      'expectedCustomerVersion',
    );
    const expectedCustomerWalletVersion = this.normalizeVersion(
      command.expectedCustomerWalletVersion,
      'expectedCustomerWalletVersion',
    );
    const idempotencyKey = command.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'idempotencyKey is required and must be at most 255 characters',
      );
    }

    const requestContext = this.normalizeRequestContext(command.requestContext);
    return {
      mappingVersion: 1,
      mode: command.mode,
      customerId,
      customerWalletId,
      currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      targetWalletAccountId,
      expectedLedgerAccountId,
      expectedCustomerVersion,
      expectedCustomerWalletVersion,
      idempotencyKey,
      principal: command.principal,
      requestContext,
    };
  }

  private normalizeRequestContext(context: RequestContext): RequestContext {
    return {
      requestId: this.normalizeContextValue(context.requestId, 'requestId'),
      correlationId: this.normalizeContextValue(context.correlationId, 'correlationId'),
      traceId: this.normalizeContextValue(context.traceId, 'traceId'),
    };
  }

  private normalizeContextValue(value: string, field: string): string {
    const normalized = value.trim();
    if (
      !normalized ||
      normalized.length > MAX_CONTEXT_LENGTH ||
      !/^[\x20-\x7E]+$/.test(normalized)
    ) {
      throw new BadRequestException(`${field} is invalid`);
    }
    return normalized;
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private normalizeVersion(value: number | undefined, field: string): number | null {
    if (value === undefined) {
      return null;
    }
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
    return value;
  }

  private requestHash(command: NormalizedCustomerFinancialAccountBindingCommand): string {
    return createHash('sha256')
      .update(
        this.canonicalJson({
          accountingUnit: command.accountingUnit,
          customerId: command.customerId,
          customerWalletId: command.customerWalletId,
          currency: command.currency,
          expectedCustomerVersion: command.expectedCustomerVersion,
          expectedCustomerWalletVersion: command.expectedCustomerWalletVersion,
          expectedLedgerAccountId: command.expectedLedgerAccountId,
          mappingVersion: command.mappingVersion,
          mode: command.mode,
          targetWalletAccountId: command.targetWalletAccountId,
        }),
      )
      .digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalJson(object[key])}`)
      .join(',')}}`;
  }

  private subordinateProvisioningKey(customerId: string, currency: string): string {
    const digest = createHash('sha256').update(`${customerId}|${currency}`).digest('hex');
    return `A3-WALLET-PROVISION-V1:${digest}`;
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }

  private isConstraintViolation(error: unknown, constraintName: string): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { constraint?: string; code?: string };
    return driverError.code === '23505' && driverError.constraint === constraintName;
  }
}
