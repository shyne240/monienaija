import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
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
import { assertWalletOwnership, walletOwnershipBinding } from '../wallet/wallet-ownership';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { PaymentQuoteStatus } from '../quote/quote.enums';
import {
  TransferQuoteService,
  requireAgentWalletTransferCapability,
} from './transfer-quote.service';
import { TransferPricingService, type TransferPricing } from './transfer-pricing.service';
import { TransferPinAuthorizationService } from './transfer-pin-authorization.service';
import { WalletOwnerClass, WalletStatus } from '../wallet/wallet.enums';
import { resolveTransferParticipants, type TransferParticipant } from './transfer-participant';
import { transferParticipantLimitInput } from './transfer-participant-limit';
import {
  LimitEnforcementService,
  type EnforceResult,
} from '../limit-catalog/limit-enforcement.service';
import { FeeRuleCalculatorService } from '../fee-rules/fee-rule-calculator.service';
import { FeeRuleResolverService } from '../fee-rules/fee-rule-resolver.service';
import { CommissionEngine } from '../commission/commission.engine';
import { CommercialAccountingService } from '../commercial-accounting/commercial-accounting.service';
import {
  annotateCommissionDecisionWithPosting,
  annotateFeeDecisionWithPosting,
} from '../commercial-accounting/commercial-decision-accounting.annotators';
import { CommercialDecisionSnapshotService } from '../commercial-decision/commercial-decision-snapshot.service';
import {
  commissionAllocatedAtAccountingBoundary,
  commissionFeeBasisMinor,
  commissionFeeCollectionStateOf,
  commissionNone,
  feeNotConfigured,
  limitApproved,
  limitNotEvaluated,
  rewardNone,
} from '../commercial-decision/commercial-decision.defaults';
import { Transfer } from './transfer.entity';
import {
  buildAuditedInternalTransferCompletedEvent,
  buildAuditedInternalTransferFailedEvent,
  buildTypedWalletTransferEvent,
  type TypedTransferRecipients,
  INTERNAL_TRANSFER_EVENT_CLASSIFICATION,
  INTERNAL_TRANSFER_EVENT_RETENTION_CLASS,
  INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION,
  INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE,
  INTERNAL_TRANSFER_FAILED_EVENT_TYPE,
  transferCompletedEventKey,
  transferFailedEventKey,
  type AuditedTransferRecipientIdentity,
} from './transfer-events';
import {
  limitCodeToTransferFailureCode,
  TransferDirection,
  TransferFailureCode,
  TransferStatus,
} from './transfer.enums';
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
type TransferNotificationRecipients = AuditedTransferRecipientIdentity & {
  typed?: TypedTransferRecipients;
};

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
    @Optional()
    private readonly limitEnforcementService?: LimitEnforcementService,
    // V1-COMMERCIAL-DECISION-02 — pilot snapshot wiring (WALLET_TRANSFER only). Both optional so
    // unit tests constructing TransferService directly keep compiling; absent → no snapshot.
    @Optional()
    private readonly feeRuleResolverService?: FeeRuleResolverService,
    @Optional()
    private readonly commercialDecisionSnapshotService?: CommercialDecisionSnapshotService,
    // V1-COMMERCIAL-IMPLEMENTATION-01 — single fee computation authority (optional; absent →
    // legacy evidence shape for manual-construction unit tests).
    @Optional()
    private readonly feeRuleCalculatorService?: FeeRuleCalculatorService,
    // V1-COMMERCIAL-IMPLEMENTATION-02 — single commission decision authority (optional; absent →
    // legacy commissionNone() shape for manual-construction unit tests).
    @Optional()
    private readonly commissionEngine?: CommissionEngine,
    // V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — @Optional so pre-existing unit constructions
    // (manual new TransferService(...)) keep working; absent = legacy evidence-only behavior.
    @Optional()
    private readonly commercialAccountingService?: CommercialAccountingService,
    @Optional() private readonly transferQuoteService?: TransferQuoteService,
    @Optional() private readonly transferPricingService?: TransferPricingService,
    @Optional() private readonly transferPinAuthorizationService?: TransferPinAuthorizationService,
  ) {}

  /** Verifies PIN for this quote before entering the shared financial transaction. */
  async createConfirmedTransfer(
    principal: AuthorizationPrincipal,
    quoteId: string,
    idempotencyKey: string,
    pin: string,
  ): Promise<TransferView> {
    if (
      !this.transferQuoteService ||
      !this.transferPricingService ||
      !this.transferPinAuthorizationService
    )
      throw new ServiceUnavailableException('Transfer confirmation is unavailable');
    const key = idempotencyKey?.trim();
    if (!key || key.length > 255) throw new BadRequestException('Idempotency key is required');
    const quote = await this.transferQuoteService.readForSession(principal, quoteId);
    const scopedKey = `self-transfer:${createHash('sha256').update(`${quote.principalType}:${quote.principalId}:${key}`).digest('hex')}`;
    const pinAuditId = await this.transferPinAuthorizationService.authorize(
      principal,
      quote.quoteId,
      scopedKey,
      pin,
    );
    return this.createTransfer({
      sourceWalletId: quote.sourceWalletId,
      destinationWalletId: quote.destinationWalletId,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      idempotencyKey: scopedKey,
      ownership: walletOwnershipBinding(principal),
      confirmation: { quoteId: quote.quoteId, principal, pinAuditId },
    });
  }

  async createTransfer(command: CreateTransferCommand): Promise<TransferView> {
    const normalized = this.normalizeCommand(command);
    let result: TransferTransactionResult | undefined;

    for (let attempt = 0; attempt < 3 && result === undefined; attempt += 1) {
      try {
        result = await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
          return this.executeWithinTransaction(manager, normalized);
        });
      } catch (error) {
        if (this.isRetryableTransactionError(error)) {
          if (attempt < 2) {
            await this.metricsService?.increment(undefined, 'retries');
            continue;
          }
          // V1-INFRA-03: the bounded retry budget (3 attempts, matching the A5 Ledger /
          // V1-TEST-01 precedent) is exhausted and PostgreSQL is still reporting a genuine
          // serialization failure or deadlock (SQLSTATE 40001/40P01). This is a real,
          // demonstrated-live-under-concurrency outcome — not a bug to retry forever — so it
          // must surface as the structured, retryable-by-the-client 409 Conflict below instead
          // of re-throwing the raw QueryFailedError (which the global exception filter would
          // otherwise turn into an opaque, non-actionable 500 Internal Server Error).
          //
          // V1-INFRA-03 (follow-up): the exception carries the stable, documented machine code
          // `TRANSACTION_CONTENTION_RETRY_EXHAUSTED` — the existing house convention already
          // established in AgentCashToCashService.transactionContentionExhaustedException() —
          // rather than the generic NestJS "Conflict" reason phrase, so a caller (and the
          // V1-LIMIT-05 test harness's own transient-contention retry wrapper) can distinguish
          // "transient contention, safe to retry the whole request" from a final/permanent
          // conflict, without ever re-exposing the raw PostgreSQL SQLSTATE or driver error type.
          // Before that code is returned, the post-loop recovery below gets one chance to find
          // the completed result of a competing identical request. Leaving the loop (rather than
          // throwing here) is what allows that read; when it finds nothing, the same conflict is
          // still what the caller receives.
          break;
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
          const ownedWallet = await this.walletRepository.findOne({
            where: { id: existing.sourceWalletId },
          });
          assertWalletOwnership(
            normalized.ownership,
            ownedWallet?.customerId,
            ownedWallet?.ownerClass,
          );
          await this.verifyConfirmedReplay(normalized, existing);
          result = { transferId: existing.id };
        } else {
          throw error;
        }
      }
    }

    if (!result) {
      // V1-IDEMPOTENCY-CONTENTION: the bounded budget above is deliberately small, so a request
      // that loses every attempt to a genuine serialization failure still has a defined outcome
      // when its operation has already been completed by a competing identical request. Recovery
      // reuses the same idempotency authority the unique-constraint path uses: the committed
      // transfer is the single financial operation, so returning it can never post a second
      // journal, and a payload that does not match the committed request hash stays a conflict.
      // Only when NO committed result exists does the exhaustion remain a retryable 409.
      result = await this.recoverCommittedResult(normalized);
      if (!result) {
        throw this.transactionContentionExhaustedException();
      }
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

  /**
   * Customer-scoped read: a transfer is visible to a customer who owns either side of it. Internal
   * principals keep using `getTransfer`.
   */
  async getTransferForCustomer(transferId: string, customerId: string): Promise<TransferView> {
    this.assertUuid(transferId, 'transferId');
    const transfer = await this.transferRepository.findOne({ where: { id: transferId } });
    if (!transfer) {
      throw new NotFoundException(`Transfer ${transferId} was not found`);
    }
    const owned = await this.walletRepository.findOne({
      where: [
        { id: transfer.sourceWalletId, customerId },
        { id: transfer.destinationWalletId, customerId },
      ],
    });
    if (!owned) {
      throw new NotFoundException(`Transfer ${transferId} was not found`);
    }
    const journal = transfer.journalId
      ? await this.journalRepository.findOne({ where: { id: transfer.journalId } })
      : null;
    return this.toView(transfer, journal?.reference ?? null);
  }

  /**
   * Customer-scoped transaction history: the wallet must belong to the authenticated customer, so
   * one customer can never read another customer's transaction records.
   */
  async getWalletTransactionsForCustomer(
    walletId: string,
    customerId: string,
    page?: number,
    limit?: number,
  ): Promise<WalletTransactionHistoryView> {
    this.assertUuid(walletId, 'walletId');
    const wallet = await this.walletRepository.findOne({ where: { id: walletId, customerId } });
    if (!wallet) {
      throw new NotFoundException(`Wallet ${walletId} was not found`);
    }
    return this.getWalletTransactions(walletId, page, limit);
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
    let confirmedQuote: Awaited<ReturnType<TransferQuoteService['lockForSession']>> | null = null;
    if (command.confirmation) {
      if (!this.transferQuoteService || !this.transferPricingService)
        throw new ServiceUnavailableException('Transfer confirmation is unavailable');
      confirmedQuote = await this.transferQuoteService.lockForSession(
        manager,
        command.confirmation.principal,
        command.confirmation.quoteId,
      );
      if (!this.transferPinAuthorizationService)
        throw new ServiceUnavailableException('Transfer PIN authorization is unavailable');
      await this.transferPinAuthorizationService.assertWithManager(
        manager,
        command.confirmation.principal,
        command.confirmation.quoteId,
        command.idempotencyKey,
        command.confirmation.pinAuditId,
      );
    }
    const existing = await transferRepository.findOne({
      where: { idempotencyKey: command.idempotencyKey },
    });
    if (existing) {
      if (existing.requestHash !== command.requestHash) {
        throw new ConflictException('The idempotency key was already used for another transfer');
      }
      // The ownership check must also guard the idempotency shortcut: replaying another customer's
      // key must never return (or reveal) a transfer that debits that customer's wallet.
      const ownedWallet = await manager
        .getRepository(WalletAccount)
        .findOne({ where: { id: existing.sourceWalletId } });
      assertWalletOwnership(command.ownership, ownedWallet?.customerId, ownedWallet?.ownerClass);
      if (confirmedQuote) this.assertQuoteMatchesReplay(confirmedQuote, existing);
      await this.metricsService?.increment(manager, 'idempotency.hits');
      return { transferId: existing.id };
    }

    // Optional injection supports legacy direct-service constructions only. A new confirmed
    // financial execution must never post without atomic admission, audit and delivery evidence.
    // Replays above remain recoverable if an operational dependency is temporarily unavailable.
    if (
      confirmedQuote &&
      (!this.limitEnforcementService || !this.outboxService || !this.auditService)
    ) {
      throw new ServiceUnavailableException('Confirmed transfer controls are unavailable');
    }

    if (
      confirmedQuote &&
      (confirmedQuote.status !== PaymentQuoteStatus.ACTIVE ||
        confirmedQuote.transferId ||
        confirmedQuote.expiresAt.getTime() <= Date.now())
    ) {
      throw new ConflictException('Transfer quote has expired or was already used');
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

    assertWalletOwnership(command.ownership, sourceWallet.customerId, sourceWallet.ownerClass);

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

    const participants = await resolveTransferParticipants(manager, [
      sourceWallet,
      destinationWallet,
    ]);

    let confirmedPricing: TransferPricing | null = null;
    if (confirmedQuote) {
      if (
        !participants ||
        confirmedQuote.sourceWalletId !== sourceWallet.id ||
        confirmedQuote.destinationWalletId !== destinationWallet.id ||
        confirmedQuote.sourceLedgerId !== sourceWallet.ledgerAccountId ||
        confirmedQuote.destinationLedgerId !== destinationWallet.ledgerAccountId ||
        confirmedQuote.principalType !== participants[0].type ||
        confirmedQuote.principalId !== participants[0].id ||
        confirmedQuote.recipientType !== participants[1].type ||
        confirmedQuote.recipientId !== participants[1].id ||
        confirmedQuote.institutionId !== (sourceWallet.institutionId ?? null) ||
        confirmedQuote.institutionId !== (destinationWallet.institutionId ?? null) ||
        confirmedQuote.amountMinor !== command.amountMinor.toString() ||
        confirmedQuote.currency !== command.currency
      ) {
        throw new ConflictException('Transfer no longer matches its confirmed participants');
      }
      requireAgentWalletTransferCapability(participants[0]);
      requireAgentWalletTransferCapability(participants[1]);
      confirmedPricing = await this.transferPricingService!.priceWithManager(manager, {
        amountMinor: command.amountMinor,
        currency: command.currency,
      });
      if (
        confirmedPricing.pricingHash !== confirmedQuote.pricingHash ||
        confirmedPricing.feeMinor !== confirmedQuote.feeMinor ||
        confirmedPricing.vatMinor !== confirmedQuote.vatMinor ||
        confirmedPricing.totalDebitMinor !== confirmedQuote.totalDebitMinor
      ) {
        throw new ConflictException('Transfer price has changed; request a new quote');
      }
    }

    // The v1 commercial, limit and notification paths below are CUSTOMER-specific. Never
    // process an agent (or unresolved/system owner) using those policies. This temporary gate
    // is inside the wallet-locked transaction and precedes even a failed-transfer/outbox record;
    // replay of an already committed result remains available above for safe recovery.
    // ownerClass is NOT NULL in PostgreSQL. Missing class is tolerated only for historical
    // direct unit constructions; an authenticated agent binding is never allowed through it.
    if (
      command.ownership.kind === 'AGENT_SELF' ||
      participants?.some((participant) => participant.type === 'AGENT') ||
      [sourceWallet, destinationWallet].some(
        (wallet) => wallet.ownerClass != null && wallet.ownerClass !== WalletOwnerClass.CUSTOMER,
      )
    ) {
      throw new ServiceUnavailableException(
        'Wallet transfer participant policy is not available for this wallet',
      );
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
      ...(confirmedPricing
        ? {
            feeMinor: confirmedPricing.feeMinor,
            vatMinor: confirmedPricing.vatMinor,
            sourceLedgerAccountId: sourceWallet.ledgerAccountId,
            destinationLedgerAccountId: destinationWallet.ledgerAccountId,
            sourceCustomerId: participants?.[0].type === 'CUSTOMER' ? participants[0].id : null,
            destinationCustomerId:
              participants?.[1].type === 'CUSTOMER' ? participants[1].id : null,
            accountingUnit: 'CUSTOMER_FUNDS',
            correlationId: `transfer:${transferId}`,
          }
        : {}),
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

    // Authoritative recipient identity for the versioned notification event contract,
    // derived from the pessimistically-locked wallet rows that back the ledger posting.
    const notificationRecipients: TransferNotificationRecipients = {
      sourceCustomerId: sourceWallet.customerId,
      destinationCustomerId: destinationWallet.customerId,
      ...(participants?.some((participant) => participant.type === 'AGENT')
        ? {
            typed: {
              source: { type: participants[0].type, id: participants[0].id },
              destination: { type: participants[1].type, id: participants[1].id },
            },
          }
        : {}),
    };

    if (
      sourceWallet.status !== WalletStatus.ACTIVE ||
      destinationWallet.status !== WalletStatus.ACTIVE
    ) {
      return this.markFailed(
        manager,
        transfer,
        {
          code: TransferFailureCode.WALLET_NOT_ACTIVE,
          statusCode: 409,
          message: 'Both wallets must be active to transfer funds',
        },
        notificationRecipients,
      );
    }

    // V1-SYSTEM-01: WalletAccount.status alone is not authoritative for whether the owning
    // customer may send or receive funds — wallets are created ACTIVE and are never
    // transitioned when a customer is later SUSPENDED/CLOSED. Re-check the owning customer's
    // CURRENT lifecycle status here, at the financial boundary, for both legs of the transfer.
    // This mirrors the existing, already-correct pattern used by agent cash-in, agent cash-out,
    // and agent C2C claim (all of which independently check `customers.status === 'ACTIVE'`
    // before moving money). Non-UUID customerId values identify internal/system wallets
    // (e.g. fee/commission/suspense accounts) and are intentionally skipped. A UUID-shaped
    // customerId with NO backing `customers` row is also intentionally NOT blocked here: in
    // production every real wallet is created with a genuine customerId from the customer
    // bounded context (WalletAccount.customerId is documented as an "opaque reference" that
    // this service must not assume is always a customer), so an absent row only ever occurs
    // for non-customer/system wallets — blocking on absence would reject legitimate non-customer
    // principals, not add any real protection against suspended customers.
    const customerWalletCustomerIds = [sourceWallet.customerId, destinationWallet.customerId]
      .filter((id, index, arr) => arr.indexOf(id) === index)
      .filter((id) => UUID_PATTERN.test(id));
    if (customerWalletCustomerIds.length > 0) {
      const statusRows: Array<{ id: string; status: string; deleted_at: string | null }> =
        await manager.query(
          `SELECT id, status, deleted_at FROM customers WHERE id = ANY($1::uuid[])`,
          [customerWalletCustomerIds],
        );
      const statusById = new Map(statusRows.map((row) => [row.id, row]));
      const sourceIneligible =
        UUID_PATTERN.test(sourceWallet.customerId) &&
        (() => {
          const row = statusById.get(sourceWallet.customerId);
          return !!row && (row.deleted_at !== null || row.status !== 'ACTIVE');
        })();
      const destinationIneligible =
        UUID_PATTERN.test(destinationWallet.customerId) &&
        (() => {
          const row = statusById.get(destinationWallet.customerId);
          return !!row && (row.deleted_at !== null || row.status !== 'ACTIVE');
        })();
      if (sourceIneligible || destinationIneligible) {
        return this.markFailed(
          manager,
          transfer,
          {
            code: TransferFailureCode.CUSTOMER_NOT_ACTIVE,
            statusCode: 409,
            message: 'Both the sending and receiving customer must be active to transfer funds',
          },
          notificationRecipients,
        );
      }
    }

    if (
      sourceWallet.currency !== command.currency ||
      destinationWallet.currency !== command.currency ||
      sourceWallet.currency !== destinationWallet.currency
    ) {
      return this.markFailed(
        manager,
        transfer,
        {
          code: TransferFailureCode.CURRENCY_MISMATCH,
          statusCode: 409,
          message: 'Source, destination, and transfer currencies must match',
        },
        notificationRecipients,
      );
    }

    // Institutional isolation. Two ATTRIBUTED wallets must belong to the same institution, and a
    // half-attributed pair is a configuration error rather than a guessable default.
    //
    // An entirely unattributed pair is a legacy wallet: `wallet_accounts.institution_id` is nullable
    // by design (migration 1785753600401) and the accepted unified baseline transferred between such
    // wallets. Refusing here would strand already-committed funds through a new admission
    // requirement, which the mission forbids. Such a transfer therefore proceeds to the tier-bound
    // gate WITHOUT an institution scope, where `LimitEnforcementService.resolveTierEnforcement`
    // decides: the accepted contract applies in non-production while the rollout is not activated,
    // and production fails closed because a real institution must be attributed.
    if (
      UUID_PATTERN.test(sourceWallet.customerId) &&
      UUID_PATTERN.test(destinationWallet.customerId)
    ) {
      const sourceInstitution = sourceWallet.institutionId ?? null;
      const destinationInstitution = destinationWallet.institutionId ?? null;
      const partiallyAttributed = !sourceInstitution !== !destinationInstitution;
      const crossInstitutional =
        sourceInstitution !== null &&
        destinationInstitution !== null &&
        sourceInstitution !== destinationInstitution;
      if (partiallyAttributed || crossInstitutional) {
        throw new ServiceUnavailableException('Institutional wallet context is unavailable');
      }
    }
    const sourceParticipant = participants?.[0] ?? {
      wallet: sourceWallet,
      type: 'CUSTOMER' as const,
      id: sourceWallet.customerId,
      agentClassId: null,
    };
    const destinationParticipant = participants?.[1] ?? {
      wallet: destinationWallet,
      type: 'CUSTOMER' as const,
      id: destinationWallet.customerId,
      agentClassId: null,
    };
    let limitIdempotencyKey: string | null = null;
    let recipientLimitIdempotencyKey: string | null = null;
    let limitOutcome: EnforceResult | null = null;
    if (this.limitEnforcementService) {
      const amountMinorStr = command.amountMinor.toString();
      try {
        // The two legs are independent: an unclassified/legacy source must not suppress
        // admission for an identifiable recipient. Each reservation is in this transaction.
        if (UUID_PATTERN.test(sourceWallet.customerId)) {
          limitIdempotencyKey = command.idempotencyKey;
          limitOutcome = await this.limitEnforcementService.enforceWithManager(
            manager,
            transferParticipantLimitInput(sourceParticipant, {
              direction: 'OUTGOING',
              currency: command.currency,
              amountMinor: amountMinorStr,
              idempotencyKey: limitIdempotencyKey,
              requestHash: command.requestHash,
              correlationId: `transfer:${transfer.id}`,
              now: new Date(),
            }),
          );
        }
        if (UUID_PATTERN.test(destinationWallet.customerId)) {
          recipientLimitIdempotencyKey = `transfer:${transfer.id}:incoming`;
          await this.limitEnforcementService.enforceWithManager(
            manager,
            transferParticipantLimitInput(destinationParticipant, {
              direction: 'INCOMING',
              currency: command.currency,
              amountMinor: amountMinorStr,
              idempotencyKey: recipientLimitIdempotencyKey,
              requestHash: createHash('sha256')
                .update(`${command.requestHash}:incoming:${destinationWallet.customerId}`)
                .digest('hex'),
              correlationId: `transfer:${transfer.id}`,
              now: new Date(),
            }),
          );
        }
      } catch (error) {
        for (const key of [limitIdempotencyKey, recipientLimitIdempotencyKey]) {
          if (key) await this.limitEnforcementService.releaseReservationsWithManager(manager, key);
        }
        if (error instanceof HttpException) {
          const resp = error.getResponse() as { error?: string; code?: string; message?: string };
          const rawCode = resp && (resp.error || resp.code);
          const limitCode = rawCode ? limitCodeToTransferFailureCode(String(rawCode)) : null;
          if (limitCode) {
            return this.markFailed(
              manager,
              transfer,
              {
                code: limitCode,
                statusCode: error.getStatus(),
                message: resp.message ?? String(limitCode),
              },
              notificationRecipients,
            );
          }
        }
        throw error;
      }
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

      if (this.limitEnforcementService) {
        for (const key of [limitIdempotencyKey, recipientLimitIdempotencyKey]) {
          if (!key) continue;
          // A release failure must roll back the enclosing transaction, not persist a
          // failed transfer alongside stranded reservations.
          await this.limitEnforcementService.releaseReservationsWithManager(manager, key);
        }
      }
      return this.markFailed(
        manager,
        transfer,
        this.failureFromLedgerException(error),
        notificationRecipients,
      );
    }

    if (this.limitEnforcementService) {
      for (const key of [limitIdempotencyKey, recipientLimitIdempotencyKey]) {
        if (!key) continue;
        // Admission is part of the financial transaction. Swallowing this error would
        // commit the journal without committing limit usage.
        await this.limitEnforcementService.commitReservationsWithManager(manager, key);
      }
    }

    // — V1-COMMERCIAL-DECISION-02 (pilot): record the immutable commercial decision snapshot
    // INSIDE this same SERIALIZABLE transaction, after the ledger posted and limits committed,
    // and only for transfers that reach COMPLETED. It commits atomically with the financial
    // state on success and rolls back with it on any downstream failure. NO fee is charged:
    // the fee decision stays NOT_CONFIGURED (zero production rules; ruleRefs merely capture the
    // resolved registry evidence when a rule exists).
    await this.recordCommercialDecisionSnapshot(manager, {
      transfer,
      command,
      sourceParticipant,
      feeDecision: confirmedPricing?.feeDecision,
      journalId,
      limitOutcome,
      payerLedgerAccountId: sourceWallet.ledgerAccountId,
    });

    if (confirmedQuote) {
      await this.auditService?.record(manager, {
        entityType: 'TRANSFER',
        entityId: transfer.id,
        action: 'LEDGER_POSTED',
        actor: 'internal',
        correlationId: `transfer:${transfer.id}`,
        newValues: { journalId, requestHash: transfer.requestHash },
      });
    }
    transfer.status = TransferStatus.COMPLETED;
    transfer.journalId = journalId;
    transfer.completedAt = new Date();
    transfer.failureCode = null;
    transfer.failureMessage = null;
    transfer.failureStatusCode = null;
    await transferRepository.save(transfer);
    if (confirmedQuote)
      await this.transferQuoteService!.consumeWithManager(
        manager,
        confirmedQuote.quoteId,
        transfer.id,
      );
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
    // Keep v1 CUSTOMER events byte-compatible; agent-involved transfers use a distinct typed contract.
    const completedAt = transfer.completedAt ?? new Date();
    const typed = notificationRecipients.typed;
    const eventType = typed ? 'wallet_transfer.completed' : INTERNAL_TRANSFER_COMPLETED_EVENT_TYPE;
    await this.outboxService?.enqueueOnce(manager, {
      eventKey: typed ? `${eventType}:${transfer.id}:v1` : transferCompletedEventKey(transfer.id),
      eventType,
      aggregateType: 'TRANSFER',
      aggregateId: transfer.id,
      schemaVersion: INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION,
      classification: INTERNAL_TRANSFER_EVENT_CLASSIFICATION,
      retentionClass: INTERNAL_TRANSFER_EVENT_RETENTION_CLASS,
      occurredAt: completedAt,
      correlationId: `transfer:${transfer.id}`,
      payload: typed
        ? buildTypedWalletTransferEvent(transfer, typed, 'completed', completedAt)
        : buildAuditedInternalTransferCompletedEvent(transfer, notificationRecipients, completedAt),
    });
    await this.metricsService?.increment(manager, 'transfers.completed');

    return { transferId: transfer.id };
  }

  /**
   * Capture the resolved fee, acting-participant commission and limit evidence in the existing
   * SERIALIZABLE transaction. When commercial accounting is enabled, its linked journal is
   * posted here as part of the same transaction; otherwise fee and commission remain evidence.
   * The sender's participant class and agent class come from locked authoritative records.
   */
  private async recordCommercialDecisionSnapshot(
    manager: EntityManager,
    ctx: {
      transfer: Transfer;
      command: NormalizedTransfer;
      sourceParticipant: TransferParticipant;
      feeDecision?: TransferPricing['feeDecision'];
      journalId: string;
      limitOutcome: EnforceResult | null;
      /** Payer-side ledger account for the commercial accounting legs (source wallet in WT). */
      payerLedgerAccountId: string;
    },
  ): Promise<void> {
    if (
      ctx.feeDecision &&
      (!this.feeRuleResolverService ||
        !this.commercialDecisionSnapshotService ||
        !this.commissionEngine ||
        !this.commercialAccountingService)
    ) {
      throw new ServiceUnavailableException(
        'Confirmed transfer commercial authority is unavailable',
      );
    }
    if (!this.feeRuleResolverService || !this.commercialDecisionSnapshotService) return;
    if (!UUID_PATTERN.test(ctx.sourceParticipant.id)) return;

    const productCode = 'WALLET_TRANSFER';
    const decisionAt = new Date();
    const amountMinor = ctx.command.amountMinor.toString();

    let feeDecision: Record<string, unknown>;
    if (ctx.feeDecision) {
      feeDecision = { ...ctx.feeDecision };
    } else {
      const resolution = await this.feeRuleResolverService.resolveWithManager(manager, {
        productCode,
        currency: ctx.command.currency,
        at: decisionAt,
      });

      // V1-COMMERCIAL-IMPLEMENTATION-01 — authoritative fee computation (single calculator authority);
      // legacy inline evidence retained only for calculator-absent (manual-construction) wiring.
      // The legacy, unconfirmed path retains its established fee resolution behavior.
      if (this.feeRuleCalculatorService) {
        feeDecision = {
          ...this.feeRuleCalculatorService.compute({
            resolution,
            principalAmountMinor: amountMinor,
            currency: ctx.command.currency,
          }),
        };
      } else {
        feeDecision = { ...feeNotConfigured(ctx.command.currency, amountMinor) };
        if (resolution.status === 'RESOLVED' && resolution.rule) {
          feeDecision.ruleRefs = [
            {
              ruleId: resolution.rule.ruleId,
              ruleVersion: resolution.rule.ruleVersion,
              flatFeeMinor: resolution.rule.flatFeeMinor,
              percentageBps: resolution.rule.percentageBps,
              minimumFeeMinor: resolution.rule.minimumFeeMinor,
              maximumFeeMinor: resolution.rule.maximumFeeMinor,
              vatBps: resolution.rule.vatBps,
              effectiveFrom: resolution.rule.effectiveFrom.toISOString(),
              effectiveTo:
                resolution.rule.effectiveTo === null
                  ? null
                  : resolution.rule.effectiveTo.toISOString(),
              priority: resolution.rule.priority,
            },
          ];
        } else if (resolution.status === 'AMBIGUOUS') {
          feeDecision.resolutionStatus = 'AMBIGUOUS';
          feeDecision.ambiguousRuleIds = resolution.ambiguousRuleIds ?? [];
        }
      }
    }

    // V1-COMMERCIAL-IMPLEMENTATION-02 — authoritative commission decision evaluated by the single
    // commission engine authority (rule resolver + calculator + decision facade) INSIDE this same
    // SERIALIZABLE transaction. The flow never computes commission itself; an empty rule registry
    // yields the identical byte-shape NONE as before, so an unwired/empty configuration cannot
    // change behavior by accident. Fail-closed: AMBIGUOUS rules or an unavailable FEE base throw
    // (409/400) and abort BEFORE money commits — no silent rule pick, no partial snapshot.
    // An agent-self sender is the acting agent; customer senders supply no agent context.
    // Aggregator commission remains disabled (aggregatorId never supplied).
    let commissionDecision: Record<string, unknown> = commissionNone();
    if (this.commissionEngine) {
      const engineDecision = await this.commissionEngine.decideWithManager(
        manager,
        {
          productCode,
          currency: ctx.command.currency,
          agentId: ctx.sourceParticipant.type === 'AGENT' ? ctx.sourceParticipant.id : null,
          agentClassId: ctx.sourceParticipant.agentClassId,
          aggregatorId: null,
          at: decisionAt,
        },
        {
          principalMinor: amountMinor,
          feeMinor: commissionFeeBasisMinor(feeDecision),
        },
      );
      if (engineDecision.status === 'ALLOCATED') {
        if (
          ctx.feeDecision &&
          !this.commercialAccountingService?.isEnabled() &&
          (engineDecision.allocations ?? []).some(
            (allocation) => BigInt(allocation.amountMinor) > 0n,
          )
        ) {
          throw new ServiceUnavailableException(
            'Confirmed transfer commission accounting is unavailable',
          );
        }
        commissionDecision = {
          ...commissionAllocatedAtAccountingBoundary(
            {
              ...engineDecision,
              allocations: (engineDecision.allocations ?? []).map((allocation) =>
                allocation.beneficiaryType === 'AGENT' &&
                !allocation.beneficiaryId &&
                ctx.sourceParticipant.type === 'AGENT'
                  ? { ...allocation, beneficiaryId: ctx.sourceParticipant.id }
                  : allocation,
              ),
            },
            {
              feeCollectionState: commissionFeeCollectionStateOf(feeDecision),
              commissionEvent: 'TRANSACTION_COMPLETION',
            },
          ),
        };
      }
    }

    // V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — approved-decision accounting posting INSIDE
    // this same SERIALIZABLE transaction (DP-02=A / DP-15=A). Config-gated: disabled (the default
    // without COMMERCIAL_ACCOUNTING_ENABLED=true) leaves every decision byte-shape unchanged.
    // Any blocker throws here → the whole operation (principal journal + snapshot) rolls back.
    if (this.commercialAccountingService && this.commercialAccountingService.isEnabled()) {
      const accountingOutcome = await this.commercialAccountingService.postForCompletion(manager, {
        productCode,
        currency: ctx.command.currency,
        baseIdempotencyKey: `transfer:${ctx.transfer.id}`,
        correlationId: `transfer:${ctx.transfer.id}`,
        reference: ctx.command.reference ?? null,
        snapshotIdempotencyKey: `transfer:${ctx.transfer.id}`,
        metadata: {
          flow: 'WALLET_TRANSFER',
          transferId: ctx.transfer.id,
          ...(ctx.sourceParticipant.type === 'CUSTOMER'
            ? { sourceCustomerId: ctx.sourceParticipant.id }
            : { sourceAgentId: ctx.sourceParticipant.id }),
        },
        feePayerLedgerAccountId: ctx.payerLedgerAccountId,
        // The accounting service accepts the historical wallet owner reference under this name;
        // the exact locked payer ledger account above is authoritative for either owner class.
        feePayerCustomerId: ctx.sourceParticipant.id,
        feeDecision,
        commissionDecision,
      });
      feeDecision = annotateFeeDecisionWithPosting(feeDecision, accountingOutcome);
      commissionDecision = annotateCommissionDecisionWithPosting(
        commissionDecision,
        accountingOutcome,
        {
          commissionEvent: 'TRANSACTION_COMPLETION',
        },
      );
    }

    const limitDecision = ctx.limitOutcome
      ? limitApproved({
          profileCode: ctx.limitOutcome.limitProfileCode ?? null,
          assignmentId: ctx.limitOutcome.assignmentId ?? null,
          ruleRefs: (ctx.limitOutcome.ruleRefs ?? []).map((r) => ({
            ruleId: r.ruleId,
            dimension: r.dimension,
            limitValueMinor: r.limitValueMinor,
            limitValueCount: r.limitValueCount,
          })),
          reservationIds: ctx.limitOutcome.reservationIds ?? [],
          usageIds: ctx.limitOutcome.usageIds ?? [],
        })
      : limitNotEvaluated();

    await this.commercialDecisionSnapshotService.recordDecisionWithManager(manager, {
      idempotencyKey: `transfer:${ctx.transfer.id}`,
      product: productCode,
      direction: 'OUTGOING',
      channel: null,
      principalType: ctx.sourceParticipant.type,
      principalId: ctx.sourceParticipant.id,
      currency: ctx.command.currency,
      principalAmountMinor: amountMinor,
      transactionReference: ctx.transfer.id,
      correlationId: `transfer:${ctx.transfer.id}`,
      journalId: ctx.journalId,
      decisionStatus: 'FINAL',
      decidedAt: decisionAt,
      finalizedAt: decisionAt,
      feeDecision: feeDecision as never,
      commissionDecision: commissionDecision as never,
      rewardDecision: rewardNone(),
      limitDecision,
      revenueDecision: null,
      configurationVersion: null,
      createdBy: 'transfer-service',
    });
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
    recipients: TransferNotificationRecipients,
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
    const failedAt = new Date();
    const typed = recipients.typed;
    const eventType = typed ? 'wallet_transfer.failed' : INTERNAL_TRANSFER_FAILED_EVENT_TYPE;
    await this.outboxService?.enqueueOnce(manager, {
      eventKey: typed ? `${eventType}:${transfer.id}:v1` : transferFailedEventKey(transfer.id),
      eventType,
      aggregateType: 'TRANSFER',
      aggregateId: transfer.id,
      schemaVersion: INTERNAL_TRANSFER_EVENT_SCHEMA_VERSION,
      classification: INTERNAL_TRANSFER_EVENT_CLASSIFICATION,
      retentionClass: INTERNAL_TRANSFER_EVENT_RETENTION_CLASS,
      occurredAt: failedAt,
      correlationId: `transfer:${transfer.id}`,
      payload: typed
        ? buildTypedWalletTransferEvent(transfer, typed, 'failed', failedAt)
        : buildAuditedInternalTransferFailedEvent(
            transfer,
            recipients,
            transfer.failureCode,
            failedAt,
          ),
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
          ...(command.confirmation ? { quoteId: command.confirmation.quoteId } : {}),
        }),
      )
      .digest('hex');

    return {
      sourceWalletId,
      ownership: command.ownership,
      confirmation: command.confirmation,
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

  // V1-INFRA-03: mirrors the established house convention in
  // AgentCashToCashService.transactionContentionExhaustedException() — a stable, documented
  // machine code (`TRANSACTION_CONTENTION_RETRY_EXHAUSTED`) set as both `error` and `code` in
  // the response body, plus `.code` directly on the exception instance, so a caller never has
  // to parse a free-text message to recognize "safe to retry the whole request".
  /**
   * Looks up an already-committed transfer for this idempotency key after the serializable retry
   * budget was exhausted.
   *
   * A competing identical request that won its own attempt may still be committing when this
   * request gives up (the winner's commit is a few milliseconds behind the loser's third
   * serialization failure), so the lookup is repeated within a small, fixed budget instead of
   * doubling the transaction retries. Waiting can never create a second financial operation: this
   * method only reads. When nothing has been committed by the end of the budget the caller still
   * surfaces the retryable `TRANSACTION_CONTENTION_RETRY_EXHAUSTED` conflict, and a payload that
   * differs from the committed request remains a conflict — both identical to the
   * unique-constraint recovery path.
   */
  private async recoverCommittedResult(
    normalized: NormalizedTransfer,
  ): Promise<TransferTransactionResult | undefined> {
    // 5 reads at 20/40/60/80 ms ≈ 200 ms of total waiting — bounded, and far below the caller's
    // own timeout. Nothing here retries a write.
    const delaysMs = [20, 40, 60, 80];
    for (let attempt = 0; ; attempt += 1) {
      const existing = await this.transferRepository.findOne({
        where: { idempotencyKey: normalized.idempotencyKey },
      });
      if (existing) {
        if (existing.requestHash !== normalized.requestHash) {
          throw new ConflictException('The idempotency key was already used for another transfer');
        }
        const ownedWallet = await this.walletRepository.findOne({
          where: { id: existing.sourceWalletId },
        });
        assertWalletOwnership(
          normalized.ownership,
          ownedWallet?.customerId,
          ownedWallet?.ownerClass,
        );
        await this.verifyConfirmedReplay(normalized, existing);
        return { transferId: existing.id };
      }
      if (attempt >= delaysMs.length) {
        return undefined;
      }
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }

  private assertQuoteMatchesReplay(
    quote: Awaited<ReturnType<TransferQuoteService['lockForSession']>>,
    transfer: Transfer,
  ): void {
    const completed = transfer.status === TransferStatus.COMPLETED;
    if (
      completed
        ? quote.status !== PaymentQuoteStatus.USED || quote.transferId !== transfer.id
        : quote.transferId !== null || quote.status === PaymentQuoteStatus.USED
    ) {
      throw new ConflictException('Transfer quote is not bound to this result');
    }
  }

  private async verifyConfirmedReplay(
    command: NormalizedTransfer,
    transfer: Transfer,
  ): Promise<void> {
    if (!command.confirmation) return;
    if (!this.transferQuoteService)
      throw new ServiceUnavailableException('Transfer confirmation is unavailable');
    if (!this.transferPinAuthorizationService)
      throw new ServiceUnavailableException('Transfer PIN authorization is unavailable');
    const confirmation = command.confirmation;
    await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const quote = await this.transferQuoteService!.lockForSession(
        manager,
        confirmation.principal,
        confirmation.quoteId,
      );
      await this.transferPinAuthorizationService!.assertWithManager(
        manager,
        confirmation.principal,
        confirmation.quoteId,
        command.idempotencyKey,
        confirmation.pinAuditId,
      );
      this.assertQuoteMatchesReplay(quote, transfer);
    });
  }

  private transactionContentionExhaustedException(): ConflictException {
    const code = 'TRANSACTION_CONTENTION_RETRY_EXHAUSTED';
    const message = 'The transfer could not be completed after concurrent retries';
    const exception = new ConflictException({ message, error: code, code });
    (exception as unknown as { code?: string }).code = code;
    return exception;
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
