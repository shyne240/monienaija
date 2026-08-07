import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import {
  normalizeAccountingUnit,
  normalizeCurrency,
  parsePositiveMinorUnits,
} from '../common/money';
import {
  LedgerEntryDirection,
  LedgerAccountType,
  LedgerNormalBalance,
} from '../ledger/ledger.enums';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { OutboxService } from '../operations/outbox.service';
import {
  assertPaymentUuid,
  normalizePaymentText,
  paymentRequestHash,
} from '../payment/payment-support';
import { Transfer } from './transfer.entity';
import {
  INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE,
  INTERNAL_TRANSFER_EVENT_CLASSIFICATION,
  INTERNAL_TRANSFER_EVENT_RETENTION_CLASS,
  buildInternalTransferCompletedEvent,
} from './transfer-events';
import { assertTransferTransition, isTerminalTransferStatus } from './transfer-lifecycle';
import { TransferFailureCode, TransferStatus } from './transfer.enums';
import type {
  CreateTransferLifecycleCommand,
  PostTransferToLedgerCommand,
  TransferLifecycleRequestContext,
  TransferLifecycleView,
  TransitionTransferLifecycleCommand,
} from './transfer-lifecycle.types';
import {
  TRANSFER_COMMAND_SCOPE,
  TRANSFER_LEDGER_POST_IDEMPOTENCY_SCOPE,
  TRANSFER_LIFECYCLE_IDEMPOTENCY_SCOPE,
  TRANSFER_STATE_IDEMPOTENCY_SCOPE,
} from './transfer-lifecycle.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_CONTEXT_LENGTH = 255;
const MAX_REFERENCE_LENGTH = 180;
const IDEMPOTENCY_RETENTION_SECONDS = 86_400;
const MAX_LEDGER_POST_ATTEMPTS = 3;

export class TransferOutcomeUnknownException extends ConflictException {
  constructor(readonly recoveryReference: string) {
    super({
      code: 'UNKNOWN_OUTCOME',
      message: 'The transfer Ledger outcome could not be verified',
      recoveryReference,
    });
  }
}

interface NormalizedCreateTransferLifecycleCommand
  extends Omit<
    CreateTransferLifecycleCommand,
    | 'amountMinor'
    | 'currency'
    | 'reference'
    | 'narration'
    | 'requestedAt'
    | 'requestContext'
    | 'idempotencyKey'
  > {
  amountMinor: string;
  currency: string;
  reference: string | null;
  narration: string | null;
  requestedAt: Date;
  requestContext: TransferLifecycleRequestContext;
  idempotencyKey: string;
}

interface NormalizedTransitionTransferLifecycleCommand
  extends Omit<
    TransitionTransferLifecycleCommand,
    'requestContext' | 'idempotencyKey' | 'reason' | 'recoveryReference' | 'failureMessage'
  > {
  requestContext: TransferLifecycleRequestContext;
  idempotencyKey: string;
  reason: string | null;
  recoveryReference: string | null;
  failureMessage: string | null;
  requestHash: string;
}

interface NormalizedPostTransferToLedgerCommand {
  idempotencyKey: string;
  requestContext: TransferLifecycleRequestContext;
}

@Injectable()
export class TransferLifecycleService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepository: Repository<Transfer>,
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async createPending(command: CreateTransferLifecycleCommand): Promise<TransferLifecycleView> {
    const normalized = this.normalizeCreate(command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.createPendingWithinTransaction(manager, normalized),
    );
  }

  async transition(
    transferId: string,
    command: TransitionTransferLifecycleCommand,
  ): Promise<TransferLifecycleView> {
    const normalizedTransferId = this.normalizeUuid(transferId, 'transferId');
    const normalized = this.normalizeTransition(normalizedTransferId, command);
    return this.dataSource.transaction('SERIALIZABLE', (manager) =>
      this.transitionWithinTransaction(manager, normalizedTransferId, normalized),
    );
  }

  async postToLedger(
    transferId: string,
    command: PostTransferToLedgerCommand,
  ): Promise<TransferLifecycleView> {
    const normalizedTransferId = this.normalizeUuid(transferId, 'transferId');
    const normalized = this.normalizePostCommand(command);
    return this.postToLedgerWithRetry(normalizedTransferId, normalized);
  }

  async get(transferId: string): Promise<TransferLifecycleView> {
    const normalizedTransferId = this.normalizeUuid(transferId, 'transferId');
    const transfer = await this.transferRepository.findOne({
      where: { id: normalizedTransferId },
    });
    if (!transfer) {
      throw new NotFoundException(`Transfer ${normalizedTransferId} was not found`);
    }
    return this.toView(transfer, false);
  }

  private async createPendingWithinTransaction(
    manager: EntityManager,
    command: NormalizedCreateTransferLifecycleCommand,
  ): Promise<TransferLifecycleView> {
    const repository = manager.getRepository(Transfer);
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: TRANSFER_LIFECYCLE_IDEMPOTENCY_SCOPE,
      key: this.lifecycleIdempotencyKey(command.idempotencyScope, command.idempotencyKey),
      requestHash: command.requestHash,
      retentionSeconds: IDEMPOTENCY_RETENTION_SECONDS,
    });

    if (reservation.kind === 'IN_PROGRESS') {
      throw new ConflictException('The transfer metadata request is already in progress');
    }
    if (reservation.kind === 'REPLAY') {
      return this.replayTransfer(
        manager,
        reservation.record.resourceId,
        reservation.record.responseBody,
      );
    }

    const existingCommand = await repository.findOne({
      where: { commandId: command.commandId },
    });
    if (existingCommand) {
      if (existingCommand.requestHash !== command.requestHash) {
        throw new ConflictException('The command ID was already used for another transfer');
      }
      const replay = this.toView(existingCommand, true);
      await this.recordAudit(manager, existingCommand, 'REPLAYED', command.requestContext, {
        requestHash: command.requestHash,
      });
      await this.idempotencyService.complete(manager, reservation.record.id, {
        statusCode: 200,
        responseBody: replay as unknown as Record<string, unknown>,
        resourceType: 'TRANSFER',
        resourceId: existingCommand.id,
      });
      return replay;
    }

    const transfer = repository.create({
      id: randomUUID(),
      commandId: command.commandId,
      commandType: command.commandType,
      commandVersion: command.contractVersion,
      capability: command.capability,
      action: command.action,
      commandScope: command.scope,
      sourceCustomerId: command.sourceCustomerId,
      destinationCustomerId: command.destinationCustomerId,
      sourceCustomerWalletId: command.sourceCustomerWalletId,
      destinationCustomerWalletId: command.destinationCustomerWalletId,
      sourceBindingId: command.sourceBindingId,
      destinationBindingId: command.destinationBindingId,
      sourceBindingVersion: command.sourceBindingVersion,
      destinationBindingVersion: command.destinationBindingVersion,
      sourceWalletId: command.sourceWalletAccountId,
      destinationWalletId: command.destinationWalletAccountId,
      sourceLedgerAccountId: command.sourceLedgerAccountId,
      destinationLedgerAccountId: command.destinationLedgerAccountId,
      authorizationContextReference: command.authorizationContextReference,
      policyDecisionReference: command.policyDecisionReference,
      policyVersion: command.policyVersion,
      policyProfileReference: command.policyProfileReference,
      policyProfileVersion: command.policyProfileVersion,
      policySnapshotReference: command.policySnapshotReference,
      policyInputHash: command.policyInputHash,
      journalId: null,
      paymentReference: null,
      amountMinor: command.amountMinor,
      currency: command.currency,
      accountingUnit: command.accountingUnit,
      status: TransferStatus.PENDING,
      idempotencyScope: command.idempotencyScope,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      requestId: command.requestContext.requestId,
      correlationId: command.requestContext.correlationId,
      traceId: command.requestContext.traceId ?? null,
      causationId: command.requestContext.causationId ?? null,
      requestedAt: command.requestedAt,
      reference: command.reference,
      narration: command.narration,
      failureCode: null,
      failureMessage: null,
      failureStatusCode: null,
      recoveryReference: null,
      stateReason: 'COMMAND_ACCEPTED',
      pendingAt: new Date(),
      processingAt: null,
      pendingRecoveryAt: null,
      unknownAt: null,
      cancelledAt: null,
      completedAt: null,
    });
    await repository.save(transfer);

    const result = this.toView(transfer, false);
    await this.recordAudit(manager, transfer, 'METADATA_CREATED', command.requestContext, {
      requestHash: command.requestHash,
      policyDecisionReference: command.policyDecisionReference,
      policyVersion: command.policyVersion,
    });
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 201,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'TRANSFER',
      resourceId: transfer.id,
    });
    return result;
  }

  private async postToLedgerWithRetry(
    transferId: string,
    command: NormalizedPostTransferToLedgerCommand,
  ): Promise<TransferLifecycleView> {
    for (let attempt = 1; attempt <= MAX_LEDGER_POST_ATTEMPTS; attempt += 1) {
      try {
        return await this.dataSource.transaction('SERIALIZABLE', (manager) =>
          this.postToLedgerWithinTransaction(manager, transferId, command),
        );
      } catch (error) {
        if (this.isRetryableTransactionError(error)) {
          if (attempt < MAX_LEDGER_POST_ATTEMPTS) {
            continue;
          }
          throw new ConflictException(
            `The transfer Ledger post exhausted ${MAX_LEDGER_POST_ATTEMPTS} bounded transaction attempts`,
          );
        }
        if (error instanceof HttpException || error instanceof QueryFailedError) {
          throw error;
        }
        return this.resolveUncertainPostOutcome(transferId, command);
      }
    }
    throw new ConflictException('The transfer Ledger post could not complete');
  }

  private async resolveUncertainPostOutcome(
    transferId: string,
    command: NormalizedPostTransferToLedgerCommand,
  ): Promise<TransferLifecycleView> {
    const recoveryReference = this.postRecoveryReference(transferId);
    let transfer: Transfer | null;
    try {
      transfer = await this.transferRepository.findOne({ where: { id: transferId } });
    } catch {
      throw new TransferOutcomeUnknownException(recoveryReference);
    }
    if (!transfer) {
      throw new TransferOutcomeUnknownException(recoveryReference);
    }

    if (transfer.journalId) {
      if (!(await this.isVerifiedTransferJournal(transfer))) {
        throw new TransferOutcomeUnknownException(recoveryReference);
      }
      if (transfer.status === TransferStatus.COMPLETED) {
        return this.toView(transfer, false);
      }
      try {
        return await this.transition(transferId, {
          transferId,
          nextStatus: TransferStatus.COMPLETED,
          idempotencyKey: `outcome-complete:${recoveryReference}`,
          requestContext: command.requestContext,
          journalId: transfer.journalId,
          recoveryReference,
          reason: 'LEDGER_POST_OUTCOME_VERIFIED',
        });
      } catch {
        throw new TransferOutcomeUnknownException(recoveryReference);
      }
    }
    if (
      transfer.status === TransferStatus.FAILED ||
      transfer.status === TransferStatus.CANCELLED ||
      transfer.status === TransferStatus.UNKNOWN ||
      transfer.status === TransferStatus.PENDING_RECOVERY
    ) {
      return this.toView(transfer, false);
    }

    try {
      return await this.transition(transferId, {
        transferId,
        nextStatus: TransferStatus.UNKNOWN,
        idempotencyKey: `outcome:${recoveryReference}`,
        requestContext: command.requestContext,
        recoveryReference,
        reason: 'LEDGER_POST_OUTCOME_UNKNOWN',
      });
    } catch {
      throw new TransferOutcomeUnknownException(recoveryReference);
    }
  }

  private async isVerifiedTransferJournal(transfer: Transfer): Promise<boolean> {
    if (
      !transfer.journalId ||
      !transfer.sourceLedgerAccountId ||
      !transfer.destinationLedgerAccountId
    ) {
      return false;
    }
    try {
      const journal = await this.ledgerService.getJournal(transfer.journalId);
      if (
        journal.id !== transfer.journalId ||
        journal.idempotencyKey !== `transfer:${transfer.id}:ledger-post` ||
        journal.currency !== transfer.currency ||
        journal.accountingUnit !== transfer.accountingUnit ||
        journal.totalMinor !== transfer.amountMinor ||
        journal.lines.length !== 2
      ) {
        return false;
      }
      const sourceLine = journal.lines.find(
        (line) =>
          line.accountId === transfer.sourceLedgerAccountId &&
          line.direction === LedgerEntryDirection.DEBIT,
      );
      const destinationLine = journal.lines.find(
        (line) =>
          line.accountId === transfer.destinationLedgerAccountId &&
          line.direction === LedgerEntryDirection.CREDIT,
      );
      return (
        sourceLine?.amountMinor === transfer.amountMinor &&
        destinationLine?.amountMinor === transfer.amountMinor &&
        sourceLine?.currency === transfer.currency &&
        destinationLine?.currency === transfer.currency &&
        sourceLine?.accountingUnit === transfer.accountingUnit &&
        destinationLine?.accountingUnit === transfer.accountingUnit
      );
    } catch {
      return false;
    }
  }

  private postRecoveryReference(transferId: string): string {
    return `transfer-recovery:${createHash('sha256').update(`${transferId}:ledger-post`).digest('hex')}`;
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driverError = error.driverError as { code?: string };
    return driverError.code === '40001' || driverError.code === '40P01';
  }

  private async postToLedgerWithinTransaction(
    manager: EntityManager,
    transferId: string,
    command: NormalizedPostTransferToLedgerCommand,
  ): Promise<TransferLifecycleView> {
    const transfer = await this.lockTransfer(manager, transferId);
    if (!transfer) {
      throw new NotFoundException(`Transfer ${transferId} was not found`);
    }
    if (!transfer.commandId) {
      throw new ConflictException('Legacy transfers cannot use the A5 Ledger posting contract');
    }
    if (
      !transfer.sourceLedgerAccountId ||
      !transfer.destinationLedgerAccountId ||
      !transfer.accountingUnit ||
      transfer.accountingUnit !== 'CUSTOMER_FUNDS'
    ) {
      throw new ConflictException('The transfer Ledger metadata is incomplete or incompatible');
    }
    if (transfer.sourceLedgerAccountId === transfer.destinationLedgerAccountId) {
      throw new ConflictException('Source and destination Ledger accounts must differ');
    }
    const requestHash = paymentRequestHash({
      transferId,
      idempotencyKey: command.idempotencyKey,
      sourceLedgerAccountId: transfer.sourceLedgerAccountId,
      destinationLedgerAccountId: transfer.destinationLedgerAccountId,
      amountMinor: transfer.amountMinor,
      currency: transfer.currency,
      accountingUnit: transfer.accountingUnit,
    });
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: TRANSFER_LEDGER_POST_IDEMPOTENCY_SCOPE,
      key: this.stateIdempotencyKey(transferId, command.idempotencyKey),
      requestHash,
      retentionSeconds: IDEMPOTENCY_RETENTION_SECONDS,
    });
    if (reservation.kind === 'IN_PROGRESS') {
      throw new ConflictException('The transfer Ledger posting request is already in progress');
    }
    if (reservation.kind === 'REPLAY') {
      return this.replayTransfer(
        manager,
        reservation.record.resourceId,
        reservation.record.responseBody,
      );
    }
    if (transfer.status !== TransferStatus.PROCESSING) {
      throw new ConflictException(`Transfer ${transfer.id} is already ${transfer.status}`);
    }

    let journalId: string;
    try {
      const accounts = await this.lockLedgerAccounts(manager, [
        transfer.sourceLedgerAccountId,
        transfer.destinationLedgerAccountId,
      ]);
      this.assertTransferLedgerAccounts(transfer, accounts);
      journalId = await this.ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `transfer:${transfer.id}:ledger-post`,
        currency: transfer.currency,
        accountingUnit: transfer.accountingUnit,
        reference: transfer.reference ?? transfer.paymentReference ?? undefined,
        description: transfer.narration ?? `Transfer ${transfer.id}`,
        correlationId: transfer.correlationId ?? `transfer:${transfer.id}`,
        metadata: {
          transferId: transfer.id,
          commandId: transfer.commandId,
          sourceLedgerAccountId: transfer.sourceLedgerAccountId,
          destinationLedgerAccountId: transfer.destinationLedgerAccountId,
        },
        lines: [
          {
            accountId: transfer.sourceLedgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: transfer.amountMinor,
          },
          {
            accountId: transfer.destinationLedgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: transfer.amountMinor,
          },
        ],
      });
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        throw error;
      }
      return this.failLedgerPostWithinTransaction(
        manager,
        transfer,
        command,
        requestHash,
        this.postFailureFromHttpException(error),
        reservation.record.id,
      );
    }

    this.applyTransition(transfer, {
      nextStatus: TransferStatus.COMPLETED,
      journalId,
      requestContext: command.requestContext,
      idempotencyKey: command.idempotencyKey,
      reason: 'LEDGER_POSTED',
      recoveryReference: null,
      failureCode: undefined,
      failureMessage: null,
      failureStatusCode: undefined,
      expectedVersion: undefined,
      transferId,
      requestHash,
    });
    await manager.getRepository(Transfer).save(transfer);
    const completedEvent = buildInternalTransferCompletedEvent(
      transfer,
      transfer.completedAt ?? new Date(),
    );
    await this.outboxService.enqueueOnce(manager, {
      eventKey: completedEvent.eventKey,
      eventType: INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE,
      aggregateType: completedEvent.aggregateType,
      aggregateId: completedEvent.aggregateId,
      schemaVersion: completedEvent.schemaVersion,
      classification: INTERNAL_TRANSFER_EVENT_CLASSIFICATION,
      retentionClass: INTERNAL_TRANSFER_EVENT_RETENTION_CLASS,
      occurredAt: new Date(completedEvent.occurredAt),
      correlationId: completedEvent.correlationId ?? undefined,
      causationId: completedEvent.causationId ?? undefined,
      payload: completedEvent as unknown as Record<string, unknown>,
    });
    const result = this.toView(transfer, false);
    await this.recordAudit(manager, transfer, 'LEDGER_POSTED', command.requestContext, {
      requestHash,
      journalId,
    });
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 200,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'TRANSFER',
      resourceId: transfer.id,
    });
    return result;
  }

  private async failLedgerPostWithinTransaction(
    manager: EntityManager,
    transfer: Transfer,
    command: NormalizedPostTransferToLedgerCommand,
    requestHash: string,
    failure: { code: TransferFailureCode; statusCode: number; message: string },
    reservationId: string,
  ): Promise<TransferLifecycleView> {
    this.applyTransition(transfer, {
      nextStatus: TransferStatus.FAILED,
      requestContext: command.requestContext,
      idempotencyKey: command.idempotencyKey,
      reason: 'LEDGER_POST_REJECTED',
      recoveryReference: null,
      failureCode: failure.code,
      failureMessage: failure.message,
      failureStatusCode: failure.statusCode,
      expectedVersion: undefined,
      transferId: transfer.id,
      requestHash,
    });
    await manager.getRepository(Transfer).save(transfer);
    const result = this.toView(transfer, false);
    await this.recordAudit(manager, transfer, 'LEDGER_POST_FAILED', command.requestContext, {
      requestHash,
      failureCode: failure.code,
    });
    await this.idempotencyService.complete(manager, reservationId, {
      statusCode: failure.statusCode,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'TRANSFER',
      resourceId: transfer.id,
    });
    return result;
  }

  private async lockLedgerAccounts(
    manager: EntityManager,
    accountIds: string[],
  ): Promise<LedgerAccount[]> {
    const orderedAccountIds = [...new Set(accountIds)].sort();
    return manager
      .getRepository(LedgerAccount)
      .createQueryBuilder('account')
      .where('account.id IN (:...accountIds)', { accountIds: orderedAccountIds })
      .orderBy('account.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  private assertTransferLedgerAccounts(transfer: Transfer, accounts: LedgerAccount[]): void {
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const accountIds = [transfer.sourceLedgerAccountId, transfer.destinationLedgerAccountId];
    for (const accountId of accountIds) {
      if (!accountId) {
        throw new ConflictException('The transfer Ledger account metadata is incomplete');
      }
      const account = accountById.get(accountId);
      if (!account) {
        throw new NotFoundException(`Ledger account ${accountId} was not found`);
      }
      if (!account.isActive || account.allowNegativeBalance) {
        throw new ConflictException(
          `Ledger account ${accountId} is not an active customer-funds account`,
        );
      }
      if (
        account.currency !== transfer.currency ||
        account.accountingUnit !== transfer.accountingUnit ||
        account.accountType !== LedgerAccountType.LIABILITY ||
        account.normalBalance !== LedgerNormalBalance.CREDIT
      ) {
        throw new ConflictException(
          `Ledger account ${accountId} does not match the transfer currency or accounting unit`,
        );
      }
    }
  }

  private postFailureFromHttpException(error: HttpException): {
    code: TransferFailureCode;
    statusCode: number;
    message: string;
  } {
    const statusCode = error.getStatus();
    const response = error.getResponse();
    const rawMessage =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] }).message ?? 'Ledger rejected the transfer');
    const message = Array.isArray(rawMessage) ? rawMessage.join('; ') : rawMessage;
    return {
      code:
        statusCode === 422
          ? TransferFailureCode.INSUFFICIENT_FUNDS
          : TransferFailureCode.LEDGER_REJECTED,
      statusCode,
      message: message.slice(0, 255),
    };
  }

  private normalizePostCommand(
    command: PostTransferToLedgerCommand,
  ): NormalizedPostTransferToLedgerCommand {
    const idempotencyKey = this.normalizeText(command.idempotencyKey, 'idempotencyKey');
    return {
      idempotencyKey,
      requestContext: this.normalizeRequestContext(command.requestContext),
    };
  }

  private async transitionWithinTransaction(
    manager: EntityManager,
    transferId: string,
    command: NormalizedTransitionTransferLifecycleCommand,
  ): Promise<TransferLifecycleView> {
    const reservation = await this.idempotencyService.reserve(manager, {
      scope: TRANSFER_STATE_IDEMPOTENCY_SCOPE,
      key: this.stateIdempotencyKey(transferId, command.idempotencyKey),
      requestHash: command.requestHash,
      retentionSeconds: IDEMPOTENCY_RETENTION_SECONDS,
    });
    if (reservation.kind === 'IN_PROGRESS') {
      throw new ConflictException('The transfer state request is already in progress');
    }
    if (reservation.kind === 'REPLAY') {
      return this.replayTransfer(
        manager,
        reservation.record.resourceId,
        reservation.record.responseBody,
      );
    }

    const transfer = await this.lockTransfer(manager, transferId);
    if (!transfer) {
      throw new NotFoundException(`Transfer ${transferId} was not found`);
    }
    if (!transfer.commandId) {
      throw new ConflictException('Legacy transfers cannot use the A5 lifecycle state contract');
    }
    if (command.expectedVersion !== undefined && command.expectedVersion !== transfer.version) {
      throw new ConflictException('The transfer lifecycle version is stale');
    }

    const previousStatus = transfer.status;
    assertTransferTransition(previousStatus, command.nextStatus);
    this.applyTransition(transfer, command);
    await manager.getRepository(Transfer).save(transfer);

    const result = this.toView(transfer, false);
    await this.recordAudit(manager, transfer, 'STATE_TRANSITION', command.requestContext, {
      previousStatus,
      nextStatus: command.nextStatus,
      requestHash: command.requestHash,
      recoveryReference: transfer.recoveryReference,
    });
    await this.idempotencyService.complete(manager, reservation.record.id, {
      statusCode: 200,
      responseBody: result as unknown as Record<string, unknown>,
      resourceType: 'TRANSFER',
      resourceId: transfer.id,
    });
    return result;
  }

  private applyTransition(
    transfer: Transfer,
    command: NormalizedTransitionTransferLifecycleCommand,
  ): void {
    const currentStatus = transfer.status;
    const nextStatus = command.nextStatus;
    const recoveryReference = this.resolveRecoveryReference(transfer, command);

    if (isTerminalTransferStatus(currentStatus)) {
      throw new ConflictException(`Transfer ${transfer.id} is already ${currentStatus}`);
    }
    if (
      (nextStatus === TransferStatus.UNKNOWN || nextStatus === TransferStatus.PENDING_RECOVERY) &&
      !recoveryReference
    ) {
      throw new ConflictException(`${nextStatus} requires a recovery reference`);
    }
    if (
      (currentStatus === TransferStatus.UNKNOWN ||
        currentStatus === TransferStatus.PENDING_RECOVERY) &&
      (nextStatus === TransferStatus.COMPLETED || nextStatus === TransferStatus.FAILED) &&
      !recoveryReference
    ) {
      throw new ConflictException('Resolving an uncertain transfer requires a recovery reference');
    }

    const now = new Date();
    transfer.stateReason = command.reason ?? transfer.stateReason;
    transfer.recoveryReference = recoveryReference;

    switch (nextStatus) {
      case TransferStatus.PROCESSING:
        if (transfer.journalId) {
          throw new ConflictException('A processing transfer cannot already have a journal');
        }
        transfer.processingAt ??= now;
        transfer.failureCode = null;
        transfer.failureMessage = null;
        transfer.failureStatusCode = null;
        break;
      case TransferStatus.PENDING_RECOVERY:
        transfer.pendingRecoveryAt ??= now;
        transfer.failureCode = null;
        transfer.failureMessage = null;
        transfer.failureStatusCode = null;
        break;
      case TransferStatus.UNKNOWN:
        transfer.unknownAt ??= now;
        transfer.failureCode = TransferFailureCode.UNKNOWN_OUTCOME;
        transfer.failureMessage =
          command.failureMessage ?? command.reason ?? 'The transfer outcome is unknown';
        transfer.failureStatusCode = command.failureStatusCode ?? null;
        transfer.journalId = null;
        transfer.completedAt = null;
        break;
      case TransferStatus.FAILED:
        if (!command.failureCode || !command.failureMessage) {
          throw new ConflictException('FAILED requires a failure code and message');
        }
        transfer.failureCode = command.failureCode;
        transfer.failureMessage = command.failureMessage;
        transfer.failureStatusCode = command.failureStatusCode ?? 422;
        transfer.journalId = null;
        transfer.completedAt = null;
        break;
      case TransferStatus.CANCELLED:
        transfer.cancelledAt ??= now;
        transfer.failureCode = TransferFailureCode.TRANSFER_CANCELLED;
        transfer.failureMessage = command.reason ?? 'The transfer was cancelled';
        transfer.failureStatusCode = 409;
        transfer.journalId = null;
        transfer.completedAt = null;
        break;
      case TransferStatus.COMPLETED:
        if (!command.journalId) {
          throw new ConflictException('COMPLETED requires an existing Ledger journal reference');
        }
        transfer.journalId = command.journalId;
        transfer.completedAt ??= now;
        transfer.failureCode = null;
        transfer.failureMessage = null;
        transfer.failureStatusCode = null;
        break;
      case TransferStatus.PENDING:
        throw new ConflictException('A transfer cannot transition back to PENDING');
    }
    transfer.status = nextStatus;
  }

  private resolveRecoveryReference(
    transfer: Transfer,
    command: NormalizedTransitionTransferLifecycleCommand,
  ): string | null {
    if (
      transfer.recoveryReference &&
      command.recoveryReference &&
      transfer.recoveryReference !== command.recoveryReference
    ) {
      throw new ConflictException('A transfer recovery reference is immutable for its lifecycle');
    }
    return transfer.recoveryReference ?? command.recoveryReference;
  }

  private async replayTransfer(
    manager: EntityManager,
    transferId: string | null,
    responseBody: Record<string, unknown> | null,
  ): Promise<TransferLifecycleView> {
    if (!transferId || !UUID_PATTERN.test(transferId)) {
      throw new ConflictException('The idempotent transfer result is incomplete');
    }
    const storedView = this.restoreStoredView(responseBody);
    if (storedView) {
      return storedView;
    }
    const transfer = await manager.getRepository(Transfer).findOne({
      where: { id: transferId },
    });
    if (!transfer) {
      throw new ConflictException('The idempotent transfer result could not be found');
    }
    return this.toView(transfer, true);
  }

  private restoreStoredView(
    responseBody: Record<string, unknown> | null,
  ): TransferLifecycleView | null {
    if (
      !responseBody ||
      typeof responseBody.id !== 'string' ||
      typeof responseBody.status !== 'string' ||
      !Object.values(TransferStatus).includes(responseBody.status as TransferStatus)
    ) {
      return null;
    }
    const date = (value: unknown): Date | null => {
      if (value === null || value === undefined) return null;
      if (value instanceof Date) return value;
      if (typeof value !== 'string') return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const view = responseBody as unknown as TransferLifecycleView;
    return {
      ...view,
      requestedAt: date(responseBody.requestedAt),
      pendingAt: date(responseBody.pendingAt),
      processingAt: date(responseBody.processingAt),
      pendingRecoveryAt: date(responseBody.pendingRecoveryAt),
      unknownAt: date(responseBody.unknownAt),
      cancelledAt: date(responseBody.cancelledAt),
      createdAt: date(responseBody.createdAt) ?? new Date(0),
      updatedAt: date(responseBody.updatedAt) ?? new Date(0),
      completedAt: date(responseBody.completedAt),
      idempotencyReplay: true,
    };
  }

  private async lockTransfer(manager: EntityManager, transferId: string): Promise<Transfer | null> {
    return manager
      .getRepository(Transfer)
      .createQueryBuilder('transfer')
      .where('transfer.id = :transferId', { transferId })
      .setLock('pessimistic_write')
      .getOne();
  }

  private async recordAudit(
    manager: EntityManager,
    transfer: Transfer,
    action: string,
    requestContext: TransferLifecycleRequestContext,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record(manager, {
      entityType: 'TRANSFER',
      entityId: transfer.id,
      action,
      actor: 'a5-transfer-lifecycle',
      correlationId: requestContext.correlationId,
      requestId: requestContext.requestId,
      newValues: {
        commandId: transfer.commandId,
        sourceCustomerId: transfer.sourceCustomerId,
        destinationCustomerId: transfer.destinationCustomerId,
        status: transfer.status,
        requestHash: transfer.requestHash,
        ...metadata,
      },
    });
  }

  private normalizeCreate(
    command: CreateTransferLifecycleCommand,
  ): NormalizedCreateTransferLifecycleCommand {
    if (
      command.contractVersion !== 1 ||
      command.commandType !== 'INTERNAL_TRANSFER' ||
      command.capability !== 'wallet.transfer' ||
      command.action !== 'create' ||
      command.scope !== 'INTERNAL_CUSTOMER_TO_CUSTOMER'
    ) {
      throw new BadRequestException('The transfer lifecycle command scope is invalid');
    }
    if (command.idempotencyScope !== TRANSFER_COMMAND_SCOPE) {
      throw new BadRequestException('The transfer command idempotency scope is invalid');
    }

    const sourceCustomerId = this.normalizeUuid(command.sourceCustomerId, 'sourceCustomerId');
    const destinationCustomerId = this.normalizeUuid(
      command.destinationCustomerId,
      'destinationCustomerId',
    );
    if (sourceCustomerId === destinationCustomerId) {
      throw new BadRequestException('Source and destination customers must differ');
    }

    const sourceCustomerWalletId = this.normalizeUuid(
      command.sourceCustomerWalletId,
      'sourceCustomerWalletId',
    );
    const destinationCustomerWalletId = this.normalizeUuid(
      command.destinationCustomerWalletId,
      'destinationCustomerWalletId',
    );
    const sourceBindingId = this.normalizeUuid(command.sourceBindingId, 'sourceBindingId');
    const destinationBindingId = this.normalizeUuid(
      command.destinationBindingId,
      'destinationBindingId',
    );
    const sourceWalletAccountId = this.normalizeUuid(
      command.sourceWalletAccountId,
      'sourceWalletAccountId',
    );
    const destinationWalletAccountId = this.normalizeUuid(
      command.destinationWalletAccountId,
      'destinationWalletAccountId',
    );
    const sourceLedgerAccountId = this.normalizeUuid(
      command.sourceLedgerAccountId,
      'sourceLedgerAccountId',
    );
    const destinationLedgerAccountId = this.normalizeUuid(
      command.destinationLedgerAccountId,
      'destinationLedgerAccountId',
    );
    if (
      sourceWalletAccountId === destinationWalletAccountId ||
      sourceLedgerAccountId === destinationLedgerAccountId
    ) {
      throw new BadRequestException('Source and destination financial accounts must differ');
    }

    const amountMinor = parsePositiveMinorUnits(command.amountMinor).toString();
    const currency = normalizeCurrency(command.currency);
    const accountingUnit = normalizeAccountingUnit(command.accountingUnit);
    if (accountingUnit !== 'CUSTOMER_FUNDS') {
      throw new BadRequestException('accountingUnit must be CUSTOMER_FUNDS');
    }
    const requestHash = this.normalizeHash(command.requestHash, 'requestHash');
    const policyInputHash = this.normalizeHash(command.policyInputHash, 'policyInputHash');
    const requestedAt = this.normalizeTimestamp(command.requestedAt, 'requestedAt');

    return {
      ...command,
      commandId: this.normalizeUuid(command.commandId, 'commandId'),
      sourceCustomerId,
      destinationCustomerId,
      sourceCustomerWalletId,
      destinationCustomerWalletId,
      sourceBindingId,
      destinationBindingId,
      sourceWalletAccountId,
      destinationWalletAccountId,
      sourceLedgerAccountId,
      destinationLedgerAccountId,
      amountMinor,
      currency,
      accountingUnit: 'CUSTOMER_FUNDS',
      idempotencyKey: this.normalizeText(command.idempotencyKey, 'idempotencyKey'),
      requestHash,
      authorizationContextReference: this.normalizeReference(
        command.authorizationContextReference,
        'authorizationContextReference',
      ),
      policyDecisionReference: this.normalizeReference(
        command.policyDecisionReference,
        'policyDecisionReference',
      ),
      policyVersion: this.normalizeReference(command.policyVersion, 'policyVersion'),
      policyProfileReference: this.normalizeReference(
        command.policyProfileReference,
        'policyProfileReference',
      ),
      policySnapshotReference: this.normalizeReference(
        command.policySnapshotReference,
        'policySnapshotReference',
      ),
      policyInputHash,
      requestedAt,
      sourceBindingVersion: this.normalizeVersion(
        command.sourceBindingVersion,
        'sourceBindingVersion',
      ),
      destinationBindingVersion: this.normalizeVersion(
        command.destinationBindingVersion,
        'destinationBindingVersion',
      ),
      policyProfileVersion: this.normalizeVersion(
        command.policyProfileVersion,
        'policyProfileVersion',
      ),
      reference: normalizePaymentText(command.reference ?? undefined, 'reference') ?? null,
      narration: normalizePaymentText(command.narration ?? undefined, 'narration') ?? null,
      requestContext: this.normalizeRequestContext(command.requestContext),
    };
  }

  private normalizeTransition(
    transferId: string,
    command: TransitionTransferLifecycleCommand,
  ): NormalizedTransitionTransferLifecycleCommand {
    if (!Object.values(TransferStatus).includes(command.nextStatus)) {
      throw new BadRequestException('The next transfer status is invalid');
    }
    const idempotencyKey = this.normalizeText(command.idempotencyKey, 'idempotencyKey');
    const requestContext = this.normalizeRequestContext(command.requestContext);
    const journalId = command.journalId
      ? this.normalizeUuid(command.journalId, 'journalId')
      : undefined;
    const recoveryReference = command.recoveryReference
      ? this.normalizeReference(command.recoveryReference, 'recoveryReference')
      : null;
    const reason = command.reason ? (normalizePaymentText(command.reason, 'reason') ?? null) : null;
    const failureMessage = command.failureMessage
      ? (normalizePaymentText(command.failureMessage, 'failureMessage') ?? null)
      : null;
    if (
      command.expectedVersion !== undefined &&
      (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1)
    ) {
      throw new BadRequestException('expectedVersion must be a positive integer');
    }
    const requestHash = paymentRequestHash({
      transferId,
      nextStatus: command.nextStatus,
      idempotencyKey,
      expectedVersion: command.expectedVersion ?? null,
      journalId: journalId ?? null,
      recoveryReference,
      reason,
      failureCode: command.failureCode ?? null,
      failureMessage,
      failureStatusCode: command.failureStatusCode ?? null,
    });
    return {
      ...command,
      transferId,
      idempotencyKey,
      requestContext,
      journalId,
      recoveryReference,
      reason,
      failureMessage,
      requestHash,
    };
  }

  private normalizeRequestContext(
    context: TransferLifecycleRequestContext,
  ): TransferLifecycleRequestContext {
    return {
      requestId: this.normalizeContextValue(context.requestId, 'requestId'),
      correlationId: this.normalizeContextValue(context.correlationId, 'correlationId'),
      ...(context.traceId
        ? { traceId: this.normalizeContextValue(context.traceId, 'traceId') }
        : {}),
      ...(context.causationId
        ? { causationId: this.normalizeContextValue(context.causationId, 'causationId') }
        : {}),
    };
  }

  private normalizeContextValue(value: string, field: string): string {
    if (!value || value.trim().length === 0 || value.length > MAX_CONTEXT_LENGTH) {
      throw new BadRequestException(`${field} is invalid`);
    }
    if (!/^[\x20-\x7E]+$/.test(value)) {
      throw new BadRequestException(`${field} is invalid`);
    }
    return value.trim();
  }

  private normalizeText(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 255) {
      throw new BadRequestException(`${field} is invalid`);
    }
    return normalized;
  }

  private normalizeReference(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_REFERENCE_LENGTH) {
      throw new BadRequestException(`${field} is invalid`);
    }
    return normalized;
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    assertPaymentUuid(normalized, field);
    return normalized;
  }

  private normalizeVersion(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
    return value;
  }

  private normalizeHash(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!HASH_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a SHA-256 hash`);
    }
    return normalized;
  }

  private normalizeTimestamp(value: string, field: string): Date {
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) {
      throw new BadRequestException(`${field} must be a valid timestamp`);
    }
    return timestamp;
  }

  private lifecycleIdempotencyKey(scope: string, key: string): string {
    return `transfer-lifecycle:${createHash('sha256').update(`${scope}:${key}`).digest('hex')}`;
  }

  private stateIdempotencyKey(transferId: string, key: string): string {
    return `transfer-state:${createHash('sha256').update(`${transferId}:${key}`).digest('hex')}`;
  }

  private toView(transfer: Transfer, idempotencyReplay: boolean): TransferLifecycleView {
    return {
      id: transfer.id,
      commandId: transfer.commandId,
      commandType: transfer.commandType,
      commandVersion: transfer.commandVersion,
      capability: transfer.capability,
      action: transfer.action,
      scope: transfer.commandScope,
      sourceCustomerId: transfer.sourceCustomerId,
      destinationCustomerId: transfer.destinationCustomerId,
      sourceCustomerWalletId: transfer.sourceCustomerWalletId,
      destinationCustomerWalletId: transfer.destinationCustomerWalletId,
      sourceBindingId: transfer.sourceBindingId,
      destinationBindingId: transfer.destinationBindingId,
      sourceBindingVersion: transfer.sourceBindingVersion,
      destinationBindingVersion: transfer.destinationBindingVersion,
      sourceWalletAccountId: transfer.sourceWalletId,
      destinationWalletAccountId: transfer.destinationWalletId,
      sourceLedgerAccountId: transfer.sourceLedgerAccountId,
      destinationLedgerAccountId: transfer.destinationLedgerAccountId,
      authorizationContextReference: transfer.authorizationContextReference,
      policyDecisionReference: transfer.policyDecisionReference,
      policyVersion: transfer.policyVersion,
      policyProfileReference: transfer.policyProfileReference,
      policyProfileVersion: transfer.policyProfileVersion,
      policySnapshotReference: transfer.policySnapshotReference,
      policyInputHash: transfer.policyInputHash,
      journalId: transfer.journalId,
      paymentReference: transfer.paymentReference,
      amountMinor: transfer.amountMinor,
      currency: transfer.currency,
      accountingUnit: transfer.accountingUnit,
      status: transfer.status,
      idempotencyScope: transfer.idempotencyScope,
      idempotencyKey: transfer.idempotencyKey,
      requestHash: transfer.requestHash,
      requestId: transfer.requestId,
      correlationId: transfer.correlationId,
      traceId: transfer.traceId,
      causationId: transfer.causationId,
      requestedAt: transfer.requestedAt,
      reference: transfer.reference,
      narration: transfer.narration,
      failureCode: transfer.failureCode,
      failureMessage: transfer.failureMessage,
      failureStatusCode: transfer.failureStatusCode,
      recoveryReference: transfer.recoveryReference,
      stateReason: transfer.stateReason,
      pendingAt: transfer.pendingAt,
      processingAt: transfer.processingAt,
      pendingRecoveryAt: transfer.pendingRecoveryAt,
      unknownAt: transfer.unknownAt,
      cancelledAt: transfer.cancelledAt,
      createdAt: transfer.createdAt,
      updatedAt: transfer.updatedAt,
      completedAt: transfer.completedAt,
      version: transfer.version,
      idempotencyReplay,
    };
  }
}
