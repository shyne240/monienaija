import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
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
import { SettlementAccountService } from '../payment/settlement-account.service';
import { Withdrawal } from './withdrawal.entity';
import { WithdrawalFailureCode, WithdrawalStatus } from './withdrawal.enums';
import type { CreateWithdrawalCommand, WithdrawalView } from './withdrawal.types';

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
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly paymentReferenceService: PaymentReferenceService,
    private readonly settlementAccountService: SettlementAccountService,
  ) {}

  async createWithdrawal(command: CreateWithdrawalCommand): Promise<WithdrawalView> {
    const normalized = this.normalizeCreate(command);
    const withdrawalId = await this.runWithSerializationRetry((manager) =>
      this.createWithinTransaction(manager, normalized),
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
      return existing.id;
    });

    return this.getWithdrawal(withdrawalId);
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
    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.processWithinTransaction(manager, withdrawalId),
    );
    return this.getWithdrawal(id);
  }

  async completeWithdrawal(withdrawalId: string): Promise<WithdrawalView> {
    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.completeWithinTransaction(manager, withdrawalId),
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
    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.failWithinTransaction(manager, withdrawalId, reason),
    );
    return this.getWithdrawal(id);
  }

  async cancelWithdrawal(withdrawalId: string, reason?: string): Promise<WithdrawalView> {
    assertPaymentUuid(withdrawalId, 'withdrawalId');
    const id = await this.runWithSerializationRetry((manager) =>
      this.cancelWithinTransaction(manager, withdrawalId, reason),
    );
    return this.getWithdrawal(id);
  }

  private async createWithinTransaction(
    manager: EntityManager,
    command: NormalizedWithdrawal,
  ): Promise<string> {
    const repository = manager.getRepository(Withdrawal);
    const existing = await repository.findOne({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another withdrawal');
      }
      return existing.id;
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
      journalId = await this.ledgerService.postJournalInTransaction(manager, {
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
      });
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
