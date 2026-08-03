import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { minorUnitsToString, normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
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
import { Deposit } from './deposit.entity';
import { DepositFailureCode, DepositStatus } from './deposit.enums';
import type { CreateDepositCommand, DepositView } from './deposit.types';

interface NormalizedDeposit
  extends Omit<CreateDepositCommand, 'amountMinor' | 'walletId' | 'currency'> {
  walletId: string;
  amountMinor: bigint;
  currency: string;
  requestHash: string;
}

@Injectable()
export class DepositService {
  constructor(
    @InjectRepository(Deposit)
    private readonly depositRepository: Repository<Deposit>,
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly paymentReferenceService: PaymentReferenceService,
    private readonly settlementAccountService: SettlementAccountService,
    @Optional()
    private readonly auditService?: AuditService,
    @Optional()
    private readonly outboxService?: OutboxService,
    @Optional()
    private readonly metricsService?: MetricsService,
  ) {}

  async createDeposit(command: CreateDepositCommand): Promise<DepositView> {
    const normalized = this.normalizeCreate(command);
    const depositId = await this.runWithSerializationRetry((manager) =>
      this.createWithinTransaction(manager, normalized),
    ).catch(async (error: unknown) => {
      if (!isConstraintViolation(error, 'uq_deposits_idempotency_key')) {
        throw error;
      }
      const existing = await this.depositRepository.findOne({
        where: { idempotencyKey: normalized.idempotencyKey },
      });
      if (!existing) {
        throw error;
      }
      if (existing.requestHash !== normalized.requestHash) {
        throw new ConflictException('The idempotency key was already used for another deposit');
      }
      await this.metricsService?.increment(undefined, 'idempotency.hits');
      return existing.id;
    });

    return this.getDeposit(depositId);
  }

  async getDeposit(depositId: string): Promise<DepositView> {
    assertPaymentUuid(depositId, 'depositId');
    const deposit = await this.depositRepository.findOne({ where: { id: depositId } });
    if (!deposit) {
      throw new NotFoundException(`Deposit ${depositId} was not found`);
    }
    return this.toView(deposit);
  }

  async listDeposits(walletId?: string): Promise<DepositView[]> {
    if (walletId !== undefined) {
      assertPaymentUuid(walletId, 'walletId');
    }
    const deposits = await this.depositRepository.find({
      where: walletId ? { walletId } : undefined,
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return deposits.map((deposit) => this.toView(deposit));
  }

  async completeDeposit(depositId: string): Promise<DepositView> {
    assertPaymentUuid(depositId, 'depositId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.completeWithinTransaction(manager, depositId),
    );
    const deposit = await this.getDeposit(id);
    if (deposit.status === DepositStatus.FAILED) {
      throw this.failureException({
        code: deposit.failureCode ?? DepositFailureCode.SETTLEMENT_REJECTED,
        statusCode: deposit.failureStatusCode ?? 409,
        message: deposit.failureMessage ?? 'Deposit completion failed',
      });
    }
    return deposit;
  }

  async failDeposit(depositId: string, reason?: string): Promise<DepositView> {
    assertPaymentUuid(depositId, 'depositId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.failWithinTransaction(manager, depositId, reason),
    );
    return this.getDeposit(id);
  }

  async cancelDeposit(depositId: string, reason?: string): Promise<DepositView> {
    assertPaymentUuid(depositId, 'depositId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.cancelWithinTransaction(manager, depositId, reason),
    );
    return this.getDeposit(id);
  }

  private async createWithinTransaction(
    manager: EntityManager,
    command: NormalizedDeposit,
  ): Promise<string> {
    const repository = manager.getRepository(Deposit);
    const existing = await repository.findOne({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another deposit');
      }
      await this.metricsService?.increment(manager, 'idempotency.hits');
      return existing.id;
    }

    const wallet = await this.lockWallet(manager, command.walletId);
    this.assertWalletForPayment(wallet, command.currency);

    const depositId = randomUUID();
    const paymentReference = await this.paymentReferenceService.nextReference(
      manager,
      PaymentType.DEPOSIT,
      depositId,
    );
    assertPaymentTransition(PaymentLifecycleState.CREATED, PaymentLifecycleState.PENDING);
    await repository.save(
      repository.create({
        id: depositId,
        walletId: command.walletId,
        journalId: null,
        paymentReference,
        amountMinor: command.amountMinor.toString(),
        currency: command.currency,
        status: DepositStatus.PENDING,
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
    return depositId;
  }

  private async completeWithinTransaction(
    manager: EntityManager,
    depositId: string,
  ): Promise<string> {
    const repository = manager.getRepository(Deposit);
    const deposit = await this.lockDeposit(manager, depositId);
    if (!deposit) {
      throw new NotFoundException(`Deposit ${depositId} was not found`);
    }
    if (deposit.status === DepositStatus.COMPLETED) {
      return deposit.id;
    }
    if (deposit.status !== DepositStatus.PENDING) {
      throw new ConflictException(`Deposit ${deposit.id} is already ${deposit.status}`);
    }

    const wallet = await this.lockWallet(manager, deposit.walletId);
    if (!wallet) {
      return this.markFailed(manager, deposit, {
        code: DepositFailureCode.WALLET_NOT_FOUND,
        statusCode: 404,
        message: `Wallet ${deposit.walletId} was not found`,
      });
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      return this.markFailed(manager, deposit, {
        code: DepositFailureCode.WALLET_NOT_ACTIVE,
        statusCode: 409,
        message: 'The wallet must be active to complete a deposit',
      });
    }
    if (wallet.currency !== deposit.currency) {
      return this.markFailed(manager, deposit, {
        code: DepositFailureCode.CURRENCY_MISMATCH,
        statusCode: 409,
        message: 'The wallet and deposit currencies must match',
      });
    }

    let journalId: string;
    try {
      const settlementAccountId = await this.settlementAccountService.getAccountId(
        manager,
        deposit.currency,
        SettlementAccountRole.SETTLEMENT_ASSET,
      );
      journalId = await this.ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `deposit:${deposit.id}:completion`,
        currency: deposit.currency,
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: deposit.paymentReference,
        description: deposit.narration ?? `Deposit ${deposit.paymentReference}`,
        correlationId: `deposit:${deposit.id}`,
        metadata: {
          depositId: deposit.id,
          paymentReference: deposit.paymentReference,
          walletId: deposit.walletId,
        },
        lines: [
          {
            accountId: settlementAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: deposit.amountMinor,
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: deposit.amountMinor,
          },
        ],
      });
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        throw error;
      }
      return this.markFailed(
        manager,
        deposit,
        failureFromHttpException(error, DepositFailureCode.SETTLEMENT_REJECTED),
      );
    }

    assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.COMPLETED);
    deposit.status = DepositStatus.COMPLETED;
    deposit.journalId = journalId;
    deposit.completedAt = new Date();
    await repository.save(deposit);
    await this.auditService?.record(manager, {
      entityType: 'DEPOSIT',
      entityId: deposit.id,
      action: 'COMPLETED',
      actor: 'internal',
      correlationId: `deposit:${deposit.id}`,
      newValues: { status: deposit.status, journalId: deposit.journalId },
    });
    await this.outboxService?.enqueue(manager, {
      eventType: 'deposit.completed',
      aggregateType: 'DEPOSIT',
      aggregateId: deposit.id,
      payload: { depositId: deposit.id, journalId: deposit.journalId },
    });
    await this.metricsService?.increment(manager, 'deposits.completed');
    return deposit.id;
  }

  private async failWithinTransaction(
    manager: EntityManager,
    depositId: string,
    reason?: string,
  ): Promise<string> {
    const deposit = await this.lockDeposit(manager, depositId);
    if (!deposit) {
      throw new NotFoundException(`Deposit ${depositId} was not found`);
    }
    if (deposit.status === DepositStatus.FAILED) {
      return deposit.id;
    }
    if (deposit.status !== DepositStatus.PENDING) {
      throw new ConflictException(`Deposit ${deposit.id} is already ${deposit.status}`);
    }
    assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.FAILED);
    return this.markFailed(manager, deposit, {
      code: DepositFailureCode.SETTLEMENT_REJECTED,
      statusCode: 422,
      message: normalizePaymentText(reason, 'reason') ?? 'Deposit failed',
    });
  }

  private async cancelWithinTransaction(
    manager: EntityManager,
    depositId: string,
    reason?: string,
  ): Promise<string> {
    const repository = manager.getRepository(Deposit);
    const deposit = await this.lockDeposit(manager, depositId);
    if (!deposit) {
      throw new NotFoundException(`Deposit ${depositId} was not found`);
    }
    if (deposit.status === DepositStatus.CANCELLED) {
      return deposit.id;
    }
    if (deposit.status !== DepositStatus.PENDING) {
      throw new ConflictException(`Deposit ${deposit.id} is already ${deposit.status}`);
    }
    assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.CANCELLED);
    deposit.status = DepositStatus.CANCELLED;
    deposit.failureMessage = normalizePaymentText(reason, 'reason') ?? null;
    await repository.save(deposit);
    return deposit.id;
  }

  private async markFailed(
    manager: EntityManager,
    deposit: Deposit,
    failure: PaymentFailureDetails,
  ): Promise<string> {
    const repository = manager.getRepository(Deposit);
    assertPaymentTransition(PaymentLifecycleState.PENDING, PaymentLifecycleState.FAILED);
    deposit.status = DepositStatus.FAILED;
    deposit.failureCode = failure.code as DepositFailureCode;
    deposit.failureMessage = failure.message;
    deposit.failureStatusCode = failure.statusCode;
    deposit.journalId = null;
    deposit.completedAt = null;
    await repository.save(deposit);
    await this.auditService?.record(manager, {
      entityType: 'DEPOSIT',
      entityId: deposit.id,
      action: 'FAILED',
      actor: 'internal',
      correlationId: `deposit:${deposit.id}`,
      newValues: { status: deposit.status, failureCode: deposit.failureCode },
    });
    await this.outboxService?.enqueue(manager, {
      eventType: 'deposit.failed',
      aggregateType: 'DEPOSIT',
      aggregateId: deposit.id,
      payload: { depositId: deposit.id, failureCode: deposit.failureCode },
    });
    await this.metricsService?.increment(manager, 'deposits.failed');
    return deposit.id;
  }

  private async lockDeposit(manager: EntityManager, depositId: string): Promise<Deposit | null> {
    return manager
      .getRepository(Deposit)
      .createQueryBuilder('deposit')
      .where('deposit.id = :depositId', { depositId })
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

  private assertWalletForPayment(wallet: WalletAccount | null, currency: string): void {
    if (!wallet) {
      throw new NotFoundException('Wallet was not found');
    }
    if (wallet.status !== WalletStatus.ACTIVE) {
      throw new ConflictException('The wallet must be active for a deposit');
    }
    if (wallet.currency !== currency) {
      throw new ConflictException('The wallet and deposit currencies must match');
    }
  }

  private normalizeCreate(command: CreateDepositCommand): NormalizedDeposit {
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

  private toView(deposit: Deposit): DepositView {
    return {
      id: deposit.id,
      walletId: deposit.walletId,
      journalId: deposit.journalId,
      paymentReference: deposit.paymentReference,
      amountMinor: minorUnitsToString(deposit.amountMinor),
      currency: deposit.currency,
      status: deposit.status,
      idempotencyKey: deposit.idempotencyKey,
      reference: deposit.reference,
      narration: deposit.narration,
      failureCode: deposit.failureCode,
      failureMessage: deposit.failureMessage,
      failureStatusCode: deposit.failureStatusCode,
      createdAt: deposit.createdAt,
      completedAt: deposit.completedAt,
    };
  }
}
