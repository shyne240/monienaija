import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { requirePrincipal, isSystemContext, runWithSystemContext } from '../authorization/authorization-context';
import { FinancialCommandGateService } from '../authorization/financial-command-gate.service';
import { MakerCheckerPolicyService } from '../authorization/maker-checker-policy.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { minorUnitsToString, normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { CustomerWallet } from '../customer-wallet/customer-wallet.entity';
import { CustomerFinancialAccountBinding } from '../wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from '../wallet/customer-financial-account-binding.enums';
import { WalletStatus } from '../wallet/wallet.enums';
import { assertPaymentTransition } from '../payment/payment-lifecycle';
import { PaymentLifecycleState } from '../payment/payment.enums';
import {
  assertPaymentUuid,
  failureFromHttpException,
  isConstraintViolation,
  isRetryableTransactionError,
  normalizePaymentText,
  paymentRequestHash,
  type PaymentFailureDetails,
} from '../payment/payment-support';
import { PaymentType, SettlementAccountRole } from '../payment/payment.enums';
import { PaymentReferenceService } from '../payment/payment-reference.service';
import { AuditService } from '../operations/audit.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';
import { SettlementAccountService } from '../payment/settlement-account.service';
import { Withdrawal } from './withdrawal.entity';
import { WithdrawalFailureCode, WithdrawalStatus } from './withdrawal.enums';
import type { CreateWithdrawalCommand, WithdrawalView } from './withdrawal.types';
import { WithdrawalGateService } from './withdrawal-gate.service';

interface NormalizedWithdrawal
  extends Omit<CreateWithdrawalCommand, 'amountMinor' | 'walletId' | 'currency'> {
  walletId: string;
  amountMinor: bigint;
  currency: string;
  requestHash: string;
}

@Injectable()
export class WithdrawalService {
  constructor(
    @InjectRepository(Withdrawal)
    private readonly withdrawalRepository: Repository<Withdrawal>,
    @InjectRepository(WalletAccount)
    private readonly walletRepository: Repository<WalletAccount>,
    @InjectRepository(CustomerWallet)
    private readonly customerWalletRepository: Repository<CustomerWallet>,
    @InjectRepository(CustomerFinancialAccountBinding)
    private readonly bindingRepository: Repository<CustomerFinancialAccountBinding>,
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly paymentReferenceService: PaymentReferenceService,
    private readonly settlementAccountService: SettlementAccountService,
    private readonly commandGate: FinancialCommandGateService,
    private readonly withdrawalGate: WithdrawalGateService,
    private readonly makerCheckerPolicy: MakerCheckerPolicyService,
    @Optional()
    private readonly auditService?: AuditService,
    @Optional()
    private readonly outboxService?: OutboxService,
    @Optional()
    private readonly metricsService?: MetricsService,
  ) {}

  async createWithdrawal(command: CreateWithdrawalCommand): Promise<WithdrawalView> {
    // REQUIRE authorization context - no bypass possible for top-level financial operations
    const principal = requirePrincipal();

    // A2 Authorization - ALWAYS enforced for top-level financial operations
    // System context bypass is ONLY for sub-operations (e.g., ledger posting within a withdrawal)
    const authResult = await this.commandGate.authorize({
      principal,
      resourceType: 'withdrawal',
      action: 'withdrawal:create',
      requiredScopes: ['withdrawal:create'],
    });

    if (!authResult.allowed) {
      throw new ForbiddenException(authResult.reason ?? 'Authorization denied');
    }

    // Build and validate withdrawal gate command (A3 bindings, A4 policy, limits)
    // This MUST succeed before any financial mutation can occur - NO bypass possible
    const gateCommand = await this.buildWithdrawalGateCommand(command, principal);
    const gateResult = await this.withdrawalGate.validate(gateCommand);

    if (gateResult.status !== 'ALLOWED') {
      throw new ForbiddenException(`Withdrawal gate validation failed: ${gateResult.reason}`);
    }

    // Maker/Checker enforcement - check if approval is required
    const makerCheckerCheck = await this.makerCheckerPolicy.checkRequirement({
      principal,
      actionType: 'WITHDRAWAL_CREATE',
      resourceType: 'withdrawal',
      amountMinor: command.amountMinor.toString(),
      currency: command.currency,
    });

    if (makerCheckerCheck.required) {
      if (!command.approvalId) {
        throw new ForbiddenException(
          `Maker/checker approval required for this withdrawal. ${makerCheckerCheck.reason}. ` +
          `Please request approval with scope: ${makerCheckerCheck.approvalScope}`
        );
      }
    }

    const normalized = this.normalizeCreate(command);
    const withdrawalId = await this.runWithSerializationRetry((manager) =>
      this.createWithinTransaction(manager, normalized, principal),
    ).catch(async (error: unknown) => {
      if (!isConstraintViolation(error, 'uq_withdrawals_idempotency_key')) {
        throw error;
      }
      const existing = await this.withdrawalRepository.findOne({
        where: { idempotencyKey: normalized.idempotencyKey },
      });
      if (!existing) {
        throw error;
      }
      if (existing.requestHash !== normalized.requestHash) {
        throw new ConflictException('The idempotency key was already used for another withdrawal');
      }
      await this.metricsService?.increment(undefined, 'idempotency.hits');
      return existing.id;
    });

    return this.getWithdrawal(withdrawalId);
  }

  /**
   * Build WithdrawalGateCommand from withdrawal command and principal.
   * Looks up all required binding and account information.
   */
  private async buildWithdrawalGateCommand(
    command: CreateWithdrawalCommand,
    principal: AuthorizationPrincipal,
  ): Promise<import('./withdrawal-gate.types').WithdrawalGateCommand> {
    // Look up wallet
    const wallet = await this.walletRepository.findOne({
      where: { id: command.walletId },
    });
    if (!wallet) {
      throw new NotFoundException(`Wallet ${command.walletId} not found`);
    }

    // Look up customer wallet
    const customerWallet = await this.customerWalletRepository.findOne({
      where: { customerId: wallet.customerId },
    });
    if (!customerWallet) {
      throw new NotFoundException(`Customer wallet not found`);
    }

    // Look up binding
    const binding = await this.bindingRepository.findOne({
      where: { walletAccountId: wallet.id, state: CustomerFinancialAccountBindingState.ACTIVE },
    });
    if (!binding) {
      throw new NotFoundException(`Binding not found for wallet ${wallet.id}`);
    }

    // Build gate command
    return {
      principal,
      customerId: customerWallet.customerId,
      walletId: customerWallet.id,
      walletAccountId: wallet.id,
      ledgerAccountId: wallet.ledgerAccountId,
      bindingId: binding.id,
      bindingVersion: binding.version,
      amountMinor: command.amountMinor.toString(),
      currency: command.currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyKey: command.idempotencyKey,
      requestContext: {
        requestId: randomUUID(),
        correlationId: randomUUID(),
      },
    };
  }

  async getWithdrawal(withdrawalId: string): Promise<WithdrawalView> {
    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const withdrawal = await this.withdrawalRepository.findOne({ where: { id: withdrawalId } });
    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} was not found`);
    }
    return this.toView(withdrawal);
  }

  async listWithdrawals(walletId?: string): Promise<WithdrawalView[]> {
    if (walletId !== undefined) {
      assertPaymentUuid(walletId, 'walletId');
    }
    const withdrawals = await this.withdrawalRepository.find({
      where: walletId ? { walletId } : undefined,
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return withdrawals.map((withdrawal) => this.toView(withdrawal));
  }

  async processWithdrawal(withdrawalId: string): Promise<WithdrawalView> {
    // REQUIRE authorization context - no bypass possible for state-changing operations
    const principal = requirePrincipal();

    // A2 Authorization - ALWAYS enforced
    const authResult = await this.commandGate.authorize({
      principal,
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      action: 'withdrawal:process',
      requiredScopes: ['withdrawal:manage'],
    });

    if (!authResult.allowed) {
      throw new ForbiddenException(authResult.reason ?? 'Authorization denied');
    }

    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.processWithinTransaction(manager, withdrawalId),
    );
    return this.getWithdrawal(id);
  }

  async completeWithdrawal(withdrawalId: string): Promise<WithdrawalView> {
    // REQUIRE authorization context - no bypass possible for top-level financial operations
    const principal = requirePrincipal();

    // A2 Authorization - ALWAYS enforced for top-level financial operations
    const authResult = await this.commandGate.authorize({
      principal,
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      action: 'withdrawal:complete',
      requiredScopes: ['withdrawal:complete'],
    });

    if (!authResult.allowed) {
      throw new ForbiddenException(authResult.reason ?? 'Authorization denied');
    }

    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.completeWithinTransaction(manager, withdrawalId, principal),
    );
    const withdrawal = await this.getWithdrawal(id);
    if (withdrawal.status === WithdrawalStatus.FAILED) {
      throw this.failureException({
        code: withdrawal.failureCode ?? WithdrawalFailureCode.SETTLEMENT_REJECTED,
        statusCode: withdrawal.failureStatusCode ?? 409,
        message: withdrawal.failureMessage ?? 'Withdrawal completion failed',
      });
    }
    return withdrawal;
  }

  async failWithdrawal(withdrawalId: string, reason?: string): Promise<WithdrawalView> {
    // REQUIRE authorization context - no bypass possible for state-changing operations
    const principal = requirePrincipal();

    // A2 Authorization - ALWAYS enforced
    const authResult = await this.commandGate.authorize({
      principal,
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      action: 'withdrawal:fail',
      requiredScopes: ['withdrawal:manage'],
    });

    if (!authResult.allowed) {
      throw new ForbiddenException(authResult.reason ?? 'Authorization denied');
    }

    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.failWithinTransaction(manager, withdrawalId, reason),
    );
    return this.getWithdrawal(id);
  }

  async cancelWithdrawal(withdrawalId: string, reason?: string): Promise<WithdrawalView> {
    // REQUIRE authorization context - no bypass possible for state-changing operations
    const principal = requirePrincipal();

    // A2 Authorization - ALWAYS enforced
    const authResult = await this.commandGate.authorize({
      principal,
      resourceType: 'withdrawal',
      resourceId: withdrawalId,
      action: 'withdrawal:cancel',
      requiredScopes: ['withdrawal:manage'],
    });

    if (!authResult.allowed) {
      throw new ForbiddenException(authResult.reason ?? 'Authorization denied');
    }

    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.cancelWithinTransaction(manager, withdrawalId, reason),
    );
    return this.getWithdrawal(id);
  }

  private async createWithinTransaction(
    manager: EntityManager,
    command: NormalizedWithdrawal,
    principal: AuthorizationPrincipal,
  ): Promise<string> {
    const repository = manager.getRepository(Withdrawal);
    const existing = await repository.findOne({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another withdrawal');
      }
      await this.metricsService?.increment(manager, 'idempotency.hits');
      return existing.id;
    }

    // Consume maker/checker approval if required and provided
    if (command.approvalId) {
      const actionFingerprint = this.commandGate.computeActionFingerprint({
        action: 'withdrawal:create',
        idempotencyKey: command.idempotencyKey,
        walletId: command.walletId,
        amountMinor: command.amountMinor.toString(),
        currency: command.currency,
      });

      const approvalResult = await this.commandGate.consumeApproval(manager, {
        approvalId: command.approvalId,
        actionType: 'WITHDRAWAL_CREATE',
        actionFingerprint,
        principal,
        resourceType: 'withdrawal',
      });

      if (!approvalResult.approved) {
        throw new ForbiddenException(approvalResult.reason ?? 'Approval denied');
      }
    }

    const wallet = await this.lockWallet(manager, command.walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${command.walletId} was not found`);
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new ConflictException('The wallet must be active for a withdrawal');
    }
    if (wallet.currency !== command.currency) {
      throw new ConflictException('The wallet and withdrawal currencies must match');
    }

    const withdrawalId = randomUUID();
    const paymentReference = await this.paymentReferenceService.nextReference(
      manager,
      PaymentType.WITHDRAWAL,
      withdrawalId,
    );
    assertPaymentTransition(PaymentLifecycleState.CREATED, PaymentLifecycleState.PENDING);
    await repository.save(
      repository.create({
        id: withdrawalId,
        walletId: command.walletId,
        journalId: null,
        paymentReference,
        amountMinor: command.amountMinor.toString(),
        currency: command.currency,
        status: WithdrawalStatus.PENDING,
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
        reference: command.reference ?? null,
        narration: command.narration ?? null,
        failureCode: null,
        failureMessage: null,
        failureStatusCode: null,
        completedAt: null,
      }),
    );
    
    // Audit the creation
    await this.auditService?.record(manager, {
      entityType: 'WITHDRAWAL',
      entityId: withdrawalId,
      action: 'CREATED',
      actor: principal.principalId,
      correlationId: `withdrawal:${withdrawalId}`,
      newValues: { 
        status: WithdrawalStatus.PENDING,
        walletId: command.walletId,
        amountMinor: command.amountMinor.toString(),
        currency: command.currency,
      },
    });
    
    return withdrawalId;
  }

  private async processWithinTransaction(
    manager: EntityManager,
    withdrawalId: string,
  ): Promise<string> {
    const repository = manager.getRepository(Withdrawal);
    const withdrawal = await this.lockWithdrawal(manager, withdrawalId);
    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} was not found`);
    }
    if (withdrawal.status === WithdrawalStatus.PROCESSING) {
      return withdrawal.id;
    }
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw new ConflictException(`Withdrawal ${withdrawal.id} is already ${withdrawal.status}`);
    }
    const wallet = await this.lockWallet(manager, withdrawal.walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet ${withdrawal.walletId} was not found`);
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new ConflictException('The wallet must be active to process a withdrawal');
    }
    if (wallet.currency !== withdrawal.currency) {
      throw new ConflictException('The wallet and withdrawal currencies must match');
    }
    assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.PROCESSING);
    withdrawal.status = WithdrawalStatus.PROCESSING;
    await repository.save(withdrawal);
    return withdrawal.id;
  }

  private async completeWithinTransaction(
    manager: EntityManager,
    withdrawalId: string,
    principal: AuthorizationPrincipal,
  ): Promise<string> {
    const repository = manager.getRepository(Withdrawal);
    const withdrawal = await this.lockWithdrawal(manager, withdrawalId);
    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} was not found`);
    }
    if (withdrawal.status === WithdrawalStatus.COMPLETED) {
      return withdrawal.id;
    }
    if (withdrawal.status !== WithdrawalStatus.PROCESSING) {
      throw new ConflictException(`Withdrawal ${withdrawal.id} is already ${withdrawal.status}`);
    }

    const wallet = await this.lockWallet(manager, withdrawal.walletId);
    if (!wallet) {
      return this.markFailed(manager, withdrawal, {
        code: WithdrawalFailureCode.WALLET_NOT_FOUND,
        statusCode: 404,
        message: `Wallet ${withdrawal.walletId} was not found`,
      });
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      return this.markFailed(manager, withdrawal, {
        code: WithdrawalFailureCode.WALLET_NOT_ACTIVE,
        statusCode: 409,
        message: 'The wallet must be active to complete a withdrawal',
      });
    }
    if (wallet.currency !== withdrawal.currency) {
      return this.markFailed(manager, withdrawal, {
        code: WithdrawalFailureCode.CURRENCY_MISMATCH,
        statusCode: 409,
        message: 'The wallet and withdrawal currencies must match',
      });
    }

    let journalId: string;
    try {
      const settlementAccountId = await this.settlementAccountService.getAccountId(
        manager,
        withdrawal.currency,
        SettlementAccountRole.SETTLEMENT_ASSET,
      );
      
      // Call LedgerService with system context (already authorized at withdrawal level)
      journalId = await runWithSystemContext(
        `withdrawal:${withdrawal.id}:completion:ledger-posting`,
        () => this.ledgerService.postJournalInTransaction(manager, {
          idempotencyKey: `withdrawal:${withdrawal.id}:completion`,
          currency: withdrawal.currency,
          accountingUnit: 'CUSTOMER_FUNDS',
          reference: withdrawal.paymentReference,
          description: withdrawal.narration ?? `Withdrawal ${withdrawal.paymentReference}`,
          correlationId: `withdrawal:${withdrawal.id}`,
          metadata: {
            withdrawalId: withdrawal.id,
            paymentReference: withdrawal.paymentReference,
            walletId: withdrawal.walletId,
          },
          lines: [
            {
              accountId: wallet.ledgerAccountId,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: withdrawal.amountMinor,
            },
            {
              accountId: settlementAccountId,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: withdrawal.amountMinor,
            },
          ],
        }),
        principal, // Preserve original principal for audit trail
      );
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        throw error;
      }
      return this.markFailed(
        manager,
        withdrawal,
        failureFromHttpException(
          error,
          WithdrawalFailureCode.SETTLEMENT_REJECTED,
          WithdrawalFailureCode.INSUFFICIENT_FUNDS,
        ),
      );
    }

    assertPaymentTransition(PaymentLifecycleState.PROCESSING, PaymentLifecycleState.COMPLETED);
    withdrawal.status = WithdrawalStatus.COMPLETED;
    withdrawal.journalId = journalId;
    withdrawal.completedAt = new Date();
    await repository.save(withdrawal);
    await this.auditService?.record(manager, {
      entityType: 'WITHDRAWAL',
      entityId: withdrawal.id,
      action: 'COMPLETED',
      actor: principal.principalId,
      correlationId: `withdrawal:${withdrawal.id}`,
      newValues: { status: withdrawal.status, journalId: withdrawal.journalId },
    });
    await this.outboxService?.enqueue(manager, {
      eventType: 'withdrawal.completed',
      aggregateType: 'WITHDRAWAL',
      aggregateId: withdrawal.id,
      payload: { withdrawalId: withdrawal.id, journalId: withdrawal.journalId },
    });
    await this.metricsService?.increment(manager, 'withdrawals.completed');
    return withdrawal.id;
  }

  private async failWithinTransaction(
    manager: EntityManager,
    withdrawalId: string,
    reason?: string,
  ): Promise<string> {
    const withdrawal = await this.lockWithdrawal(manager, withdrawalId);
    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} was not found`);
    }
    if (withdrawal.status === WithdrawalStatus.FAILED) {
      return withdrawal.id;
    }
    if (
      withdrawal.status !== WithdrawalStatus.PENDING &&
      withdrawal.status !== WithdrawalStatus.PROCESSING
    ) {
      throw new ConflictException(`Withdrawal ${withdrawal.id} is already ${withdrawal.status}`);
    }
    assertPaymentTransition(
      withdrawal.status === WithdrawalStatus.PENDING
        ? PaymentLifecycleState.PENDING
        : PaymentLifecycleState.PROCESSING,
      PaymentLifecycleState.FAILED,
    );
    return this.markFailed(manager, withdrawal, {
      code: WithdrawalFailureCode.SETTLEMENT_REJECTED,
      statusCode: 422,
      message: normalizePaymentText(reason, 'reason') ?? 'Withdrawal failed',
    });
  }

  private async cancelWithinTransaction(
    manager: EntityManager,
    withdrawalId: string,
    reason?: string,
  ): Promise<string> {
    const repository = manager.getRepository(Withdrawal);
    const withdrawal = await this.lockWithdrawal(manager, withdrawalId);
    if (!withdrawal) {
      throw new NotFoundException(`Withdrawal ${withdrawalId} was not found`);
    }
    if (withdrawal.status === WithdrawalStatus.CANCELLED) {
      return withdrawal.id;
    }
    if (
      withdrawal.status !== WithdrawalStatus.PENDING &&
      withdrawal.status !== WithdrawalStatus.PROCESSING
    ) {
      throw new ConflictException(`Withdrawal ${withdrawal.id} is already ${withdrawal.status}`);
    }
    assertPaymentTransition(
      withdrawal.status === WithdrawalStatus.PENDING
        ? PaymentLifecycleState.PENDING
        : PaymentLifecycleState.PROCESSING,
      PaymentLifecycleState.CANCELLED,
    );
    withdrawal.status = WithdrawalStatus.CANCELLED;
    withdrawal.failureMessage = normalizePaymentText(reason, 'reason') ?? null;
    await repository.save(withdrawal);
    return withdrawal.id;
  }

  private async markFailed(
    manager: EntityManager,
    withdrawal: Withdrawal,
    failure: PaymentFailureDetails,
  ): Promise<string> {
    const repository = manager.getRepository(Withdrawal);
    assertPaymentTransition(
      withdrawal.status === WithdrawalStatus.PENDING
        ? PaymentLifecycleState.PENDING
        : PaymentLifecycleState.PROCESSING,
      PaymentLifecycleState.FAILED,
    );
    withdrawal.status = WithdrawalStatus.FAILED;
    withdrawal.failureCode = failure.code as WithdrawalFailureCode;
    withdrawal.failureMessage = failure.message;
    withdrawal.failureStatusCode = failure.statusCode;
    withdrawal.journalId = null;
    withdrawal.completedAt = null;
    await repository.save(withdrawal);
    await this.auditService?.record(manager, {
      entityType: 'WITHDRAWAL',
      entityId: withdrawal.id,
      action: 'FAILED',
      actor: 'internal',
      correlationId: `withdrawal:${withdrawal.id}`,
      newValues: { status: withdrawal.status, failureCode: withdrawal.failureCode },
    });
    await this.outboxService?.enqueue(manager, {
      eventType: 'withdrawal.failed',
      aggregateType: 'WITHDRAWAL',
      aggregateId: withdrawal.id,
      payload: { withdrawalId: withdrawal.id, failureCode: withdrawal.failureCode },
    });
    await this.metricsService?.increment(manager, 'withdrawals.failed');
    return withdrawal.id;
  }

  private async lockWithdrawal(
    manager: EntityManager,
    withdrawalId: string,
  ): Promise<Withdrawal | null> {
    return manager
      .getRepository(Withdrawal)
      .createQueryBuilder('withdrawal')
      .where('withdrawal.id = :withdrawalId', { withdrawalId })
      .setLock('pessimistic_write')
      .getOne();
  }

  private async lockWallet(
    manager: EntityManager,
    walletId: string,
  ): Promise<WalletAccount | null> {
    return manager
      .getRepository(WalletAccount)
      .createQueryBuilder('wallet')
      .where('wallet.id = :walletId', { walletId })
      .setLock('pessimistic_write')
      .getOne();
  }

  private normalizeCreate(command: CreateWithdrawalCommand): NormalizedWithdrawal {
    const walletId = command.walletId.trim().toLowerCase();
    assertPaymentUuid(walletId, 'walletId');
    const idempotencyKey = command.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'The Idempotency-Key header is required and must be at most 255 characters',
      );
    }
    const amountMinor = parsePositiveMinorUnits(command.amountMinor);
    const currency = normalizeCurrency(command.currency);
    const reference = normalizePaymentText(command.reference, 'reference');
    const narration = normalizePaymentText(command.narration, 'narration');
    return {
      walletId,
      amountMinor,
      currency,
      idempotencyKey,
      reference,
      narration,
      requestHash: paymentRequestHash({
        walletId,
        amountMinor: amountMinor.toString(),
        currency,
        reference: reference ?? null,
        narration: narration ?? null,
      }),
    };
  }

  private async runWithSerializationRetry(
    operation: (manager: EntityManager) => Promise<string>,
  ): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', operation);
      } catch (error) {
        if (!isRetryableTransactionError(error) || attempt === 2) {
          throw error;
        }
        await this.metricsService?.increment(undefined, 'retries');
      }
    }
    throw new ConflictException('Payment operation could not complete after retries');
  }

  private failureException(failure: PaymentFailureDetails): HttpException {
    return new HttpException({ message: failure.message, error: failure.code }, failure.statusCode);
  }

  private toView(withdrawal: Withdrawal): WithdrawalView {
    return {
      id: withdrawal.id,
      walletId: withdrawal.walletId,
      journalId: withdrawal.journalId,
      paymentReference: withdrawal.paymentReference,
      amountMinor: minorUnitsToString(withdrawal.amountMinor),
      currency: withdrawal.currency,
      status: withdrawal.status,
      idempotencyKey: withdrawal.idempotencyKey,
      reference: withdrawal.reference,
      narration: withdrawal.narration,
      failureCode: withdrawal.failureCode,
      failureMessage: withdrawal.failureMessage,
      failureStatusCode: withdrawal.failureStatusCode,
      createdAt: withdrawal.createdAt,
      completedAt: withdrawal.completedAt,
    };
  }
}
