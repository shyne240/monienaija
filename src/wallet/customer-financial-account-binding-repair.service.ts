import { createHash } from 'node:crypto';

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
import { PrivilegedActionApprovalService } from '../authorization/privileged-action-approval.service';
import { Customer } from '../customer/customer.entity';
import { CustomerStatus } from '../customer/customer.enums';
import { CustomerWallet } from '../customer-wallet/customer-wallet.entity';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../ledger/ledger.enums';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { IdempotencyRecordStatus } from '../operations/operations.enums';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import {
  CustomerFinancialAccountDiscrepancyType,
  type CustomerFinancialAccountDiscrepancy,
  type CustomerFinancialAccountReconciliationReport,
} from '../reconciliation/customer-financial-account-reconciliation.types';
import type { RequestContext } from '../production/request-context';
import { CustomerFinancialAccountBinding } from './customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from './customer-financial-account-binding.enums';
import { CustomerFinancialAccountBindingRepairAction } from './customer-financial-account-binding-repair.enums';
import type {
  CustomerFinancialAccountBindingRepairCommand,
  CustomerFinancialAccountBindingRepairResult,
  NormalizedCustomerFinancialAccountBindingRepairCommand,
} from './customer-financial-account-binding-repair.types';
import { WalletAccount } from './wallet-account.entity';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_CONTEXT_LENGTH = 255;
const MAX_REASON_LENGTH = 500;
const REPAIR_IDEMPOTENCY_SCOPE = 'wallet.account-binding-repair.v1';

export const CUSTOMER_FINANCIAL_ACCOUNT_BINDING_REPAIR_POLICY: AuthorizationPolicy = {
  resourceType: 'customer-financial-account-binding',
  action: 'wallet:account-binding:repair',
  requiredScopes: ['wallet:account-binding:repair'],
  allowedPrincipalTypes: ['OPERATOR', 'SERVICE', 'PRIVILEGED'],
  customerAccess: 'ASSIGNED',
};

@Injectable()
export class CustomerFinancialAccountBindingRepairService {
  constructor(
    @InjectRepository(CustomerFinancialAccountBinding)
    private readonly bindingRepository: Repository<CustomerFinancialAccountBinding>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerWallet)
    private readonly customerWalletRepository: Repository<CustomerWallet>,
    @InjectRepository(WalletAccount)
    private readonly walletRepository: Repository<WalletAccount>,
    @InjectRepository(LedgerAccount)
    private readonly ledgerAccountRepository: Repository<LedgerAccount>,
    private readonly dataSource: DataSource,
    private readonly authorizationService: AuthorizationService,
    private readonly privilegedApprovalService: PrivilegedActionApprovalService,
    private readonly reconciliationService: ReconciliationService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async repair(
    command: CustomerFinancialAccountBindingRepairCommand,
  ): Promise<CustomerFinancialAccountBindingRepairResult> {
    const normalized = this.normalizeCommand(command);
    const authorization = await this.authorizationService.authorize(
      normalized.principal,
      CUSTOMER_FINANCIAL_ACCOUNT_BINDING_REPAIR_POLICY,
      {
        type: 'customer-financial-account-binding',
        id: normalized.bindingId,
      },
    );
    if (!authorization.allowed) {
      throw new ForbiddenException(`Authorization denied: ${authorization.reason}`);
    }

    const before = await this.reconciliationService.getBindingReconciliation();
    this.assertReconciliationAvailable(before);
    const requestHash = this.requestHash(normalized);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.executeInTransaction(manager, normalized, requestHash, before),
        );
        const after = await this.reconciliationService.getBindingReconciliation();
        return {
          ...result,
          reconciliationAfter: {
            status: after.status,
            discrepancies: after.summary.discrepancies,
          },
        };
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) {
          continue;
        }
        await this.recordFailureAudit(normalized, error);
        throw error;
      }
    }

    throw new ConflictException('The binding repair could not complete after concurrent retries');
  }

  private async executeInTransaction(
    manager: EntityManager,
    command: NormalizedCustomerFinancialAccountBindingRepairCommand,
    requestHash: string,
    reconciliation: CustomerFinancialAccountReconciliationReport,
  ): Promise<CustomerFinancialAccountBindingRepairResult> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: REPAIR_IDEMPOTENCY_SCOPE,
      key: command.idempotencyKey,
      requestHash,
      retentionSeconds: 0,
    });

    if (reservation.kind === 'REPLAY') {
      if (reservation.record.status !== IdempotencyRecordStatus.COMPLETED) {
        throw new ConflictException('The idempotent repair request did not complete successfully');
      }
      const bindingId = reservation.record.resourceId;
      if (!bindingId || !UUID_PATTERN.test(bindingId)) {
        throw new ConflictException('The idempotent repair result is incomplete');
      }
      const binding = await manager
        .getRepository(CustomerFinancialAccountBinding)
        .findOne({ where: { id: bindingId } });
      if (!binding) {
        throw new ConflictException('The idempotent repair binding could not be found');
      }
      return this.toResult(binding, command, requestHash, reconciliation, 'REPLAYED', true);
    }

    const binding = await manager
      .getRepository(CustomerFinancialAccountBinding)
      .findOne({ where: { id: command.bindingId } });
    if (!binding) {
      throw new NotFoundException(`Binding ${command.bindingId} was not found`);
    }
    if (
      command.expectedBindingVersion !== null &&
      command.expectedBindingVersion !== binding.version
    ) {
      throw new ConflictException('Binding version is stale');
    }

    const previousState = binding.state;
    if (command.action === CustomerFinancialAccountBindingRepairAction.RESOLVE_TO_PENDING) {
      if (binding.state !== CustomerFinancialAccountBindingState.REPAIR_REQUIRED) {
        throw new ConflictException('Only REPAIR_REQUIRED bindings can be resolved to PENDING');
      }
      await this.validatePendingResolution(manager, binding);
    } else {
      if (
        binding.state === CustomerFinancialAccountBindingState.ACTIVE &&
        !this.hasBindingError(reconciliation.discrepancies, binding.id)
      ) {
        throw new ConflictException(
          'An ACTIVE binding can only be closed when reconciliation reports a binding error',
        );
      }
      if (binding.state === CustomerFinancialAccountBindingState.CLOSED) {
        throw new ConflictException('Binding is already CLOSED');
      }
    }

    const approval = await this.privilegedApprovalService.consume({
      principal: command.principal,
      approvalId: command.approvalId,
      actionType: CUSTOMER_FINANCIAL_ACCOUNT_BINDING_REPAIR_POLICY.action,
      resource: {
        type: 'customer-financial-account-binding',
        id: binding.id,
        customerId: binding.customerId,
      },
      actionFingerprint: command.actionFingerprint,
    });
    if (!approval.approved) {
      throw new ForbiddenException(`Privileged repair approval denied: ${approval.reason}`);
    }

    if (command.action === CustomerFinancialAccountBindingRepairAction.RESOLVE_TO_PENDING) {
      binding.state = CustomerFinancialAccountBindingState.PENDING;
      binding.closedAt = null;
      await this.refreshSourceVersions(manager, binding);
    } else {
      binding.state = CustomerFinancialAccountBindingState.CLOSED;
      binding.closedAt = new Date();
    }

    binding.updatedBy = command.principal.principalId;
    binding.lastCorrelationId = command.requestContext.correlationId;
    binding.lastRequestId = command.requestContext.requestId;
    binding.version += 1;
    const saved = await manager.getRepository(CustomerFinancialAccountBinding).save(binding);
    const outcome =
      command.action === CustomerFinancialAccountBindingRepairAction.RESOLVE_TO_PENDING
        ? 'REPAIRED_TO_PENDING'
        : 'CLOSED';
    const result = this.toResult(
      saved,
      command,
      requestHash,
      reconciliation,
      outcome,
      false,
      previousState,
    );
    await this.auditRepair(manager, saved, command, outcome, previousState);
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 200,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING_REPAIR',
      resourceId: saved.id,
    });
    return result;
  }

  private async validatePendingResolution(
    manager: EntityManager,
    binding: CustomerFinancialAccountBinding,
  ): Promise<void> {
    const customer = await manager
      .getRepository(Customer)
      .findOne({ where: { id: binding.customerId } });
    const customerWallet = await manager
      .getRepository(CustomerWallet)
      .findOne({ where: { id: binding.customerWalletId } });
    const wallet = await manager
      .getRepository(WalletAccount)
      .findOne({ where: { id: binding.walletAccountId } });
    const ledgerAccount = await manager
      .getRepository(LedgerAccount)
      .findOne({ where: { id: binding.ledgerAccountId } });

    if (!customer || customer.deletedAt || customer.status === CustomerStatus.CLOSED) {
      throw new ConflictException('Customer source cannot support pending repair');
    }
    if (!customerWallet || customerWallet.deletedAt) {
      throw new ConflictException('Customer wallet source is missing for pending repair');
    }
    if (customerWallet.customerId !== customer.id) {
      throw new ConflictException('Customer wallet ownership does not match the binding');
    }
    if (!wallet || !ledgerAccount) {
      throw new ConflictException('Financial account source is missing for pending repair');
    }
    if (wallet.ledgerAccountId !== ledgerAccount.id) {
      throw new ConflictException('Wallet and ledger account relationships do not match');
    }
    if (
      customerWallet.currency !== binding.currency ||
      wallet.currency !== binding.currency ||
      ledgerAccount.currency !== binding.currency ||
      binding.accountingUnit !== 'CUSTOMER_FUNDS' ||
      ledgerAccount.accountingUnit !== binding.accountingUnit ||
      ledgerAccount.accountType !== LedgerAccountType.LIABILITY ||
      ledgerAccount.normalBalance !== LedgerNormalBalance.CREDIT ||
      ledgerAccount.allowNegativeBalance
    ) {
      throw new ConflictException('Financial dimensions are incompatible for pending repair');
    }
  }

  private async refreshSourceVersions(
    manager: EntityManager,
    binding: CustomerFinancialAccountBinding,
  ): Promise<void> {
    const customer = await manager
      .getRepository(Customer)
      .findOne({ where: { id: binding.customerId } });
    const customerWallet = await manager
      .getRepository(CustomerWallet)
      .findOne({ where: { id: binding.customerWalletId } });
    if (!customer || !customerWallet) {
      throw new ConflictException('Cannot refresh binding source versions');
    }
    binding.sourceCustomerVersion = customer.version;
    binding.sourceCustomerWalletVersion = customerWallet.version;
  }

  private hasBindingError(
    discrepancies: CustomerFinancialAccountDiscrepancy[],
    bindingId: string,
  ): boolean {
    return discrepancies.some(
      (discrepancy) => discrepancy.bindingId === bindingId && discrepancy.severity === 'ERROR',
    );
  }

  private async auditRepair(
    manager: EntityManager,
    binding: CustomerFinancialAccountBinding,
    command: NormalizedCustomerFinancialAccountBindingRepairCommand,
    outcome: string,
    previousState: CustomerFinancialAccountBindingState,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING',
      entityId: binding.id,
      action: outcome,
      actor: command.principal.principalId,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      previousValues: {
        state: previousState,
        version: binding.version - 1,
      },
      newValues: {
        state: binding.state,
        version: binding.version,
        reason: command.reason,
        approvalId: command.approvalId,
      },
    });
  }

  private async recordFailureAudit(
    command: NormalizedCustomerFinancialAccountBindingRepairCommand,
    error: unknown,
  ): Promise<void> {
    const reason =
      error instanceof HttpException ? `HTTP_${error.getStatus()}` : 'BINDING_REPAIR_FAILED';
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.auditService.record(manager, {
          entityType: 'CUSTOMER_FINANCIAL_ACCOUNT_BINDING_REPAIR',
          entityId: command.bindingId,
          action: 'REJECTED',
          actor: command.principal.principalId,
          correlationId: command.requestContext.correlationId,
          requestId: command.requestContext.requestId,
          newValues: {
            action: command.action,
            bindingId: command.bindingId,
            reason,
          },
        });
      });
    } catch {
      // Preserve the original repair error if operational audit is unavailable.
    }
  }

  private toResult(
    binding: CustomerFinancialAccountBinding,
    command: NormalizedCustomerFinancialAccountBindingRepairCommand,
    requestHash: string,
    reconciliation: CustomerFinancialAccountReconciliationReport,
    outcome: CustomerFinancialAccountBindingRepairResult['outcome'],
    idempotencyReplay: boolean,
    previousState = binding.state,
  ): CustomerFinancialAccountBindingRepairResult {
    return {
      outcome,
      action: command.action,
      bindingId: binding.id,
      customerId: binding.customerId,
      customerWalletId: binding.customerWalletId,
      walletAccountId: binding.walletAccountId,
      ledgerAccountId: binding.ledgerAccountId,
      previousState,
      state: binding.state,
      version: binding.version,
      idempotencyScope: REPAIR_IDEMPOTENCY_SCOPE,
      requestHash,
      idempotencyReplay,
      reconciliationBefore: {
        status: reconciliation.status,
        discrepancies: reconciliation.summary.discrepancies,
      },
      correlationId: command.requestContext.correlationId,
    };
  }

  private assertReconciliationAvailable(
    report: CustomerFinancialAccountReconciliationReport,
  ): void {
    if (
      report.discrepancies.some(
        (discrepancy) =>
          discrepancy.type === CustomerFinancialAccountDiscrepancyType.QUERY_UNAVAILABLE,
      )
    ) {
      throw new ConflictException('Binding reconciliation evidence is unavailable');
    }
  }

  private normalizeCommand(
    command: CustomerFinancialAccountBindingRepairCommand,
  ): NormalizedCustomerFinancialAccountBindingRepairCommand {
    if (!Object.values(CustomerFinancialAccountBindingRepairAction).includes(command.action)) {
      throw new BadRequestException('Repair action is invalid');
    }
    const bindingId = this.normalizeUuid(command.bindingId, 'bindingId');
    const approvalId = this.normalizeUuid(command.approvalId, 'approvalId');
    const actionFingerprint = command.actionFingerprint.trim().toLowerCase();
    if (!FINGERPRINT_PATTERN.test(actionFingerprint)) {
      throw new BadRequestException('actionFingerprint must be a SHA-256 hex value');
    }
    const reason = command.reason.trim();
    if (!reason || reason.length > MAX_REASON_LENGTH) {
      throw new BadRequestException('reason must contain 1 to 500 characters');
    }
    const idempotencyKey = command.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'idempotencyKey is required and must be at most 255 characters',
      );
    }
    const expectedBindingVersion = command.expectedBindingVersion ?? null;
    if (
      expectedBindingVersion !== null &&
      (!Number.isInteger(expectedBindingVersion) || expectedBindingVersion < 1)
    ) {
      throw new BadRequestException('expectedBindingVersion must be a positive integer');
    }
    const requestContext = this.normalizeRequestContext(command.requestContext);
    return {
      action: command.action,
      bindingId,
      approvalId,
      actionFingerprint,
      reason,
      idempotencyKey,
      expectedBindingVersion,
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

  private requestHash(command: NormalizedCustomerFinancialAccountBindingRepairCommand): string {
    const canonical = JSON.stringify({
      action: command.action,
      actionFingerprint: command.actionFingerprint,
      bindingId: command.bindingId,
      expectedBindingVersion: command.expectedBindingVersion,
      reason: command.reason,
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }
}
