import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';

import { minorUnitsToString, normalizeCurrency, parsePositiveMinorUnits } from '../common/money';
import { LedgerEntryDirection } from '../ledger/ledger.enums';
import { PaymentType } from '../payment/payment.enums';
import { PaymentReferenceService } from '../payment/payment-reference.service';
import { AuditService } from '../operations/audit.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';
import { LedgerJournal } from '../ledger/ledger-journal.entity';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccount } from '../wallet/wallet-account.entity';
import { WalletStatus } from '../wallet/wallet.enums';
import { Transfer } from './transfer.entity';
import { TransferDirection, TransferFailureCode, TransferStatus } from './transfer.enums';
import type {
  CreateTransferCommand,
  TransferFailure,
  TransferTransactionResult,
  TransferView,
  WalletTransactionHistoryView,
  WalletTransactionView,
} from './transfer.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_HISTORY_PAGE = 1;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

type NormalizedTransfer = Omit<
  CreateTransferCommand,
  'amountMinor' | 'sourceWalletId' | 'destinationWalletId' | 'currency'
> & {
  sourceWalletId: string;
  destinationWalletId: string;
  amountMinor: bigint;
  currency: string;
  requestHash: string;
};

@Injectable()
export class TransferService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transferRepository: Repository<Transfer>,
    @InjectRepository(WalletAccount)
    private readonly walletRepository: Repository<WalletAccount>,
    @InjectRepository(LedgerJournal)
    private readonly journalRepository: Repository<LedgerJournal>,
    private readonly dataSource: DataSource,
    private readonly ledgerService: LedgerService,
    @Optional()
    private readonly paymentReferenceService?: PaymentReferenceService,
    @Optional()
    private readonly auditService?: AuditService,
    @Optional()
    private readonly outboxService?: OutboxService,
    @Optional()
    private readonly metricsService?: MetricsService,
  ) {}

  async createTransfer(command: CreateTransferCommand): Promise<TransferView> {
    const normalized = this.normalizeCommand(command);
    let result: TransferTransactionResult | undefined;

    for (let attempt = 0; attempt < 3 && result === undefined; attempt += 1) {
      try {
        result = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          return this.executeWithinTransaction(manager, normalized);
        });
      } catch (error) {
        if (this.isRetryableTransactionError(error) && attempt < 2) {
          await this.metricsService?.increment(undefined, 'retries');
          continue;
        }

        if (this.isConstraintViolation(error, 'uq_transfers_idempotency_key')) {
          const existing = await this.transferRepository.findOne({
            where: { idempotencyKey: normalized.idempotencyKey },
          });
          if (!existing) {
            throw error;
          }
          if (existing.requestHash !== normalized.requestHash) {
            throw new ConflictException(
              'The idempotency key was already used for another transfer',
            );
          }
          result = { transferId: existing.id };
        } else {
          throw error;
        }
      }
    }

    if (!result) {
      throw new ConflictException('The transfer could not be completed after concurrent retries');
    }

    if (result.failure) {
      throw this.toFailureException(result.failure);
    }

    if (!result.transferId) {
      throw new ConflictException('The transfer did not produce a durable result');
    }

    const transfer = await this.getTransfer(result.transferId);
    if (transfer.status === TransferStatus.FAILED) {
      throw this.toFailureException(this.failureFromView(transfer));
    }

    return transfer;
  }

  async getTransfer(transferId: string): Promise<TransferView> {
    this.assertUuid(transferId, 'transferId');
    const transfer = await this.transferRepository.findOne({ where: { id: transferId } });
    if (!transfer) {
      throw new NotFoundException(`Transfer ${transferId} was not found`);
    }

    const journal = transfer.journalId
      ? await this.journalRepository.findOne({ where: { id: transfer.journalId } })
      : null;
    return this.toView(transfer, journal?.reference ?? null);
  }

  async getWalletTransactions(
    walletId: string,
    page = DEFAULT_HISTORY_PAGE,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<WalletTransactionHistoryView> {
    this.assertUuid(walletId, 'walletId');
    const wallet = await this.walletRepository.findOne({ where: { id: walletId } });
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} was not found`);
    }

    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const [transfers, total] = await this.transferRepository.findAndCount({
      where: [{ sourceWalletId: walletId }, { destinationWalletId: walletId }],
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (normalizedPage - 1) * normalizedLimit,
      take: normalizedLimit,
    });

    const items = transfers.map((transfer) => this.toTransactionView(transfer, walletId));
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);

    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  private async executeWithinTransaction(
    manager: EntityManager,
    command: NormalizedTransfer,
  ): Promise<TransferTransactionResult> {
    const transferRepository = manager.getRepository(Transfer);
    const existing = await transferRepository.findOne({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another transfer');
      }

      await this.metricsService?.increment(manager, 'idempotency.hits');
      return { transferId: existing.id };
    }

    const wallets = await this.lockWallets(manager, [
      command.sourceWalletId,
      command.destinationWalletId,
    ]);
    const walletsById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
    const sourceWallet = walletsById.get(command.sourceWalletId);
    if (!sourceWallet) {
      return {
        failure: {
          code: TransferFailureCode.SOURCE_WALLET_NOT_FOUND,
          statusCode: 404,
          message: `Source wallet ${command.sourceWalletId} was not found`,
        },
      };
    }

    const destinationWallet = walletsById.get(command.destinationWalletId);
    if (!destinationWallet) {
      return {
        failure: {
          code: TransferFailureCode.DESTINATION_WALLET_NOT_FOUND,
          statusCode: 404,
          message: `Destination wallet ${command.destinationWalletId} was not found`,
        },
      };
    }

    if (command.sourceWalletId === command.destinationWalletId) {
      return {
        failure: {
          code: TransferFailureCode.SELF_TRANSFER,
          statusCode: 400,
          message: 'Source and destination wallets must be different',
        },
      };
    }

    const transferId = randomUUID();
    const paymentReference = this.paymentReferenceService
      ? await this.paymentReferenceService.nextReference(manager, PaymentType.TRANSFER, transferId)
      : null;
    const transfer = transferRepository.create({
      id: transferId,
      sourceWalletId: command.sourceWalletId,
      destinationWalletId: command.destinationWalletId,
      journalId: null,
      paymentReference,
      amountMinor: command.amountMinor.toString(),
      currency: command.currency,
      status: TransferStatus.FAILED,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      reference: command.reference ?? null,
      narration: command.narration ?? null,
      failureCode: null,
      failureMessage: null,
      failureStatusCode: null,
      completedAt: null,
    });
    await transferRepository.save(transfer);

    if (
      sourceWallet.status !== WalletStatus.ACTIVE ||
      destinationWallet.status !== WalletStatus.ACTIVE
    ) {
      return this.markFailed(manager, transfer, {
        code: TransferFailureCode.WALLET_NOT_ACTIVE,
        statusCode: 409,
        message: 'Both wallets must be active to transfer funds',
      });
    }

    if (
      sourceWallet.currency !== command.currency ||
      destinationWallet.currency !== command.currency ||
      sourceWallet.currency !== destinationWallet.currency
    ) {
      return this.markFailed(manager, transfer, {
        code: TransferFailureCode.CURRENCY_MISMATCH,
        statusCode: 409,
        message: 'Source, destination, and transfer currencies must match',
      });
    }

    let journalId: string;
    try {
      journalId = await this.ledgerService.postJournalInTransaction(manager, {
        idempotencyKey: `transfer:${transfer.id}`,
        currency: command.currency,
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: command.reference,
        description: command.narration,
        correlationId: `transfer:${transfer.id}`,
        metadata: {
          transferId: transfer.id,
          sourceWalletId: command.sourceWalletId,
          destinationWalletId: command.destinationWalletId,
        },
        lines: [
          {
            accountId: sourceWallet.ledgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: command.amountMinor,
          },
          {
            accountId: destinationWallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: command.amountMinor,
          },
        ],
      });
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) {
        throw error;
      }

      return this.markFailed(manager, transfer, this.failureFromLedgerException(error));
    }

    transfer.status = TransferStatus.COMPLETED;
    transfer.journalId = journalId;
    transfer.completedAt = new Date();
    transfer.failureCode = null;
    transfer.failureMessage = null;
    transfer.failureStatusCode = null;
    await transferRepository.save(transfer);
    await this.auditService?.record(manager, {
      entityType: 'TRANSFER',
      entityId: transfer.id,
      action: 'COMPLETED',
      actor: 'internal',
      correlationId: `transfer:${transfer.id}`,
      newValues: {
        status: transfer.status,
        journalId: transfer.journalId,
        amountMinor: transfer.amountMinor,
      },
    });
    await this.outboxService?.enqueue(manager, {
      eventType: 'transfer.completed',
      aggregateType: 'TRANSFER',
      aggregateId: transfer.id,
      payload: {
        transferId: transfer.id,
        journalId: transfer.journalId,
        paymentReference: transfer.paymentReference,
      },
    });
    await this.metricsService?.increment(manager, 'transfers.completed');

    return { transferId: transfer.id };
  }

  private async lockWallets(manager: EntityManager, walletIds: string[]): Promise<WalletAccount[]> {
    const uniqueWalletIds = [...new Set(walletIds)].sort();
    return manager
      .getRepository(WalletAccount)
      .createQueryBuilder('wallet')
      .where('wallet.id IN (:...walletIds)', { walletIds: uniqueWalletIds })
      .orderBy('wallet.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
  }

  private async markFailed(
    manager: EntityManager,
    transfer: Transfer,
    failure: TransferFailure,
  ): Promise<TransferTransactionResult> {
    transfer.status = TransferStatus.FAILED;
    transfer.journalId = null;
    transfer.failureCode = failure.code;
    transfer.failureMessage = failure.message;
    transfer.failureStatusCode = failure.statusCode;
    transfer.completedAt = null;
    await manager.getRepository(Transfer).save(transfer);
    await this.auditService?.record(manager, {
      entityType: 'TRANSFER',
      entityId: transfer.id,
      action: 'FAILED',
      actor: 'internal',
      correlationId: `transfer:${transfer.id}`,
      newValues: { status: transfer.status, failureCode: transfer.failureCode },
    });
    await this.outboxService?.enqueue(manager, {
      eventType: 'transfer.failed',
      aggregateType: 'TRANSFER',
      aggregateId: transfer.id,
      payload: { transferId: transfer.id, failureCode: transfer.failureCode },
    });
    await this.metricsService?.increment(manager, 'transfers.failed');
    return { transferId: transfer.id };
  }

  private normalizeCommand(command: CreateTransferCommand): NormalizedTransfer {
    const sourceWalletId = command.sourceWalletId.trim().toLowerCase();
    const destinationWalletId = command.destinationWalletId.trim().toLowerCase();
    if (!UUID_PATTERN.test(sourceWalletId) || !UUID_PATTERN.test(destinationWalletId)) {
      throw new BadRequestException('sourceWalletId and destinationWalletId must be UUIDs');
    }

    const idempotencyKey = command.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException(
        'The Idempotency-Key header is required and must be at most 255 characters',
      );
    }

    const amountMinor = parsePositiveMinorUnits(command.amountMinor);
    const currency = normalizeCurrency(command.currency);
    const reference = this.optionalText(command.reference, 'reference');
    const narration = this.optionalText(command.narration, 'narration');
    const requestHash = createHash('sha256')
      .update(
        this.canonicalJson({
          sourceWalletId,
          destinationWalletId,
          amountMinor: amountMinor.toString(),
          currency,
          reference: reference ?? null,
          narration: narration ?? null,
        }),
      )
      .digest('hex');

    return {
      sourceWalletId,
      destinationWalletId,
      amountMinor,
      currency,
      idempotencyKey,
      reference,
      narration,
      requestHash,
    };
  }

  private optionalText(value: string | undefined, fieldName: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const normalized = value.trim();
    if (normalized.length === 0) {
      return undefined;
    }
    if (normalized.length > 255) {
      throw new BadRequestException(`${fieldName} must be at most 255 characters`);
    }

    return normalized;
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

  private failureFromLedgerException(error: HttpException): TransferFailure {
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

  private failureFromView(transfer: TransferView): TransferFailure {
    return {
      code: transfer.failureCode ?? TransferFailureCode.LEDGER_REJECTED,
      statusCode: transfer.failureStatusCode ?? 409,
      message: transfer.failureMessage ?? 'The transfer failed',
    };
  }

  private toFailureException(failure: TransferFailure): HttpException {
    return new HttpException({ message: failure.message, error: failure.code }, failure.statusCode);
  }

  private normalizePage(page: number): number {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new BadRequestException('page must be a positive integer');
    }

    return page;
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
      throw new BadRequestException(`limit must be between 1 and ${MAX_HISTORY_LIMIT}`);
    }

    return limit;
  }

  private assertUuid(value: string, fieldName: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new BadRequestException(`${fieldName} must be a UUID`);
    }
  }

  private toView(transfer: Transfer, journalReference: string | null): TransferView {
    return {
      id: transfer.id,
      sourceWalletId: transfer.sourceWalletId,
      destinationWalletId: transfer.destinationWalletId,
      journalId: transfer.journalId,
      paymentReference: transfer.paymentReference,
      journalReference,
      amountMinor: minorUnitsToString(transfer.amountMinor),
      currency: transfer.currency,
      status: transfer.status,
      idempotencyKey: transfer.idempotencyKey,
      reference: transfer.reference,
      narration: transfer.narration,
      failureCode: transfer.failureCode,
      failureMessage: transfer.failureMessage,
      failureStatusCode: transfer.failureStatusCode,
      createdAt: transfer.createdAt,
      completedAt: transfer.completedAt,
    };
  }

  private toTransactionView(transfer: Transfer, walletId: string): WalletTransactionView {
    const sent = transfer.sourceWalletId === walletId;
    return {
      transferId: transfer.id,
      direction: sent ? TransferDirection.SENT : TransferDirection.RECEIVED,
      counterpartyWalletId: sent ? transfer.destinationWalletId : transfer.sourceWalletId,
      amountMinor: minorUnitsToString(transfer.amountMinor),
      currency: transfer.currency,
      status: transfer.status,
      journalId: transfer.journalId,
      reference: transfer.reference,
      narration: transfer.narration,
      createdAt: transfer.createdAt,
      completedAt: transfer.completedAt,
    };
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
