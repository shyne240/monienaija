import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { normalizeCurrency } from '../common/money';
import { DepositService } from '../deposit/deposit.service';
import type { DepositView } from '../deposit/deposit.types';
import { IdempotencyRecordStatus } from '../operations/operations.enums';
import { IdempotencyService } from '../operations/idempotency.service';
import { InternalTransferGateService } from '../transfer/internal-transfer-gate.service';
import type {
  InternalTransferGateCommand,
  InternalTransferGateResult,
} from '../transfer/internal-transfer-gate.types';
import { TransferStatus } from '../transfer/transfer.enums';
import {
  TRANSFER_COMMAND_SCOPE,
  type CreateTransferLifecycleCommand,
  type TransferLifecycleView,
} from '../transfer/transfer-lifecycle.types';
import { TransferLifecycleService } from '../transfer/transfer-lifecycle.service';
import { TransferService } from '../transfer/transfer.service';
import type { TransferView, WalletTransactionHistoryView } from '../transfer/transfer.types';
import { CustomerFinancialAccountResolutionService } from '../wallet/customer-financial-account-resolution.service';
import { CustomerRecipientResolutionService } from '../wallet/customer-recipient-resolution.service';
import { toPublicRecipientView } from '../wallet/customer-recipient-resolution.types';
import { WithdrawalService } from '../withdrawal/withdrawal.service';
import type { WithdrawalView } from '../withdrawal/withdrawal.types';
import { CustomerTransactionAuthorizationService } from './customer-transaction-authorization.service';
import type {
  CustomerMoneyMovementCommand,
  CustomerTransactionsQuery,
  CustomerTransferCommand,
} from './customer-financial-operations.types';
import { CustomerTransferDestinationType } from './customer-financial-operations.types';

/**
 * V1 customer-facing money movement is NGN-only for individual customers. The
 * generic multi-currency architecture of the underlying financial services is
 * preserved; this boundary enforces the V1 product scope.
 */
const V1_CURRENCY = 'NGN';

/**
 * Customer-application idempotency scope for gated wallet-to-wallet commands.
 * Versioned independently from the A5T03 gate scope so replay at the customer
 * boundary never re-executes the gate; the gate result is already immutable.
 */
export const CUSTOMER_TRANSFER_IDEMPOTENCY_SCOPE = 'customer.wallet.transfer.create.v1';
const CUSTOMER_TRANSFER_IDEMPOTENCY_RETENTION_SECONDS = 86_400;

/**
 * Customer-facing financial command surface. Every operation derives its
 * WalletAccount through the CustomerWallet financial binding owned by the
 * authenticated customer; client-supplied identifiers are validated against
 * that binding and never trusted as proof of ownership.
 *
 * Wallet-to-wallet transfers are admitted ONLY through the authoritative A5
 * command path:
 *
 *   session authorize (runtime guard, SELF)
 *   → server-side binding resolution (A3 financial-account binding)
 *   → transaction PIN step-up (before any policy/money effect)
 *   → A5T03 InternalTransferGateService  (A2 + pilot + A4 policy+limits + A3)
 *   → A5T04 TransferLifecycleService     (PENDING → PROCESSING → terminal)
 *   → authoritative ledger posting owned by the lifecycle
 *
 * The gate is the single pre-movement control point; a gate failure can never
 * reach the lifecycle or the ledger because no transfer row is created before
 * the gate passes and no ledger effect is possible outside the lifecycle.
 */
@Injectable()
export class CustomerFinancialOperationsService {
  constructor(
    private readonly resolutionService: CustomerFinancialAccountResolutionService,
    private readonly transferService: TransferService,
    private readonly depositService: DepositService,
    private readonly withdrawalService: WithdrawalService,
    private readonly recipientResolutionService: CustomerRecipientResolutionService,
    private readonly transactionAuthorization: CustomerTransactionAuthorizationService,
    private readonly transferGate: InternalTransferGateService,
    private readonly transferLifecycle: TransferLifecycleService,
    private readonly idempotencyService: IdempotencyService,
    private readonly dataSource: DataSource,
  ) {}

  async createTransfer(command: CustomerTransferCommand): Promise<TransferView> {
    const currency = this.normalizeV1Currency(command.currency);
    const principal = this.requireSelfCustomerPrincipal(command);
    const source = await this.resolutionService.resolveOwnActiveFinancialAccount(
      command.customerId,
      currency,
    );

    const destinationWalletId = await this.resolveTransferDestination(command);
    if (destinationWalletId === source.binding.walletAccountId) {
      throw new BadRequestException('Source and destination wallets must be different');
    }
    const destination =
      await this.resolutionService.resolveActiveDestinationAccount(destinationWalletId);
    if (destination.customerId === source.binding.customerId) {
      throw new BadRequestException(
        "Wallet-to-wallet transfers must target a different customer's wallet",
      );
    }

    // Step-up authorization: the transaction PIN is verified BEFORE any
    // control-plane or money movement effect. Only this customer-facing
    // boundary enforces it; provider settlement, reconciliation, and internal
    // flows never require a PIN.
    await this.authorizeStepUp(command.customerId, command.transactionPin);

    // Customer-application idempotency: a NEW logical request reserves the
    // key first; every retry of that logical request replays the stored
    // result instead of re-executing the gate or the lifecycle.
    //
    // Why replaying BEFORE the A5T03 gate is safe (V1-W2W-REPLAY-SECURITY-AUDIT):
    //   1. `requireSelfCustomerPrincipal` has already established that the
    //      caller is an authenticated CUSTOMER principal whose identity equals
    //      the addressed `/customers/:id` context, so a replay is only ever
    //      served to the customer who owns the command context.
    //   2. `resolveOwnActiveFinancialAccount` has already resolved the source
    //      strictly from THIS customer's own ACTIVE binding.
    //   3. `authorizeStepUp` has already verified the transaction PIN, so a
    //      stolen or guessed idempotency key alone never unseals a result.
    //   4. `requestHash` commits to `sourceWalletAccountId`, which is unique
    //      per binding (uq_customer_financial_account_bindings_wallet_account)
    //      and therefore per customer. A different customer replaying the same
    //      key can never match the stored hash, so the reservation resolves to
    //      a 409 conflict instead of another customer's transfer.
    // The gate is skipped on replay precisely because no new financial effect
    // is produced: the replay returns the stored result and touches neither
    // the lifecycle nor the ledger.
    const requestHash = this.customerRequestHash(
      command,
      source.binding.walletAccountId,
      destinationWalletId,
      currency,
    );
    const reservation = await this.dataSource.transaction((manager) =>
      this.idempotencyService.reserve(manager, {
        scope: CUSTOMER_TRANSFER_IDEMPOTENCY_SCOPE,
        key: this.normalizeIdempotencyKey(command.idempotencyKey),
        requestHash,
        retentionSeconds: CUSTOMER_TRANSFER_IDEMPOTENCY_RETENTION_SECONDS,
      }),
    );
    if (reservation.kind === 'REPLAY') {
      return this.replayStoredResult(reservation.record);
    }

    // Single-attempt fields are generated exactly once, after the reservation
    // wins. Retries never recompute them, so replay is byte-stable.
    const commandId = randomUUID();
    const requestedAt = new Date().toISOString();
    const requestContext = {
      requestId: `customer-transfer:${commandId}`,
      correlationId: `customer-transfer:${commandId}`,
    };

    try {
      const limitUsage = await this.collectLimitUsage(
        command.customerId,
        command.amountMinor,
        requestedAt,
      );
      const gateCommand: InternalTransferGateCommand = {
        contractVersion: 1,
        commandType: 'INTERNAL_TRANSFER',
        commandId,
        capability: 'wallet.transfer',
        action: 'create',
        scope: 'INTERNAL_CUSTOMER_TO_CUSTOMER',
        sourceCustomerId: source.binding.customerId,
        destinationCustomerId: destination.customerId,
        sourceCustomerWalletId: source.binding.customerWalletId,
        destinationCustomerWalletId: destination.customerWalletId,
        sourceBindingId: source.binding.id,
        destinationBindingId: destination.id,
        sourceWalletAccountId: source.binding.walletAccountId,
        destinationWalletAccountId: destination.walletAccountId,
        sourceLedgerAccountId: source.binding.ledgerAccountId,
        destinationLedgerAccountId: destination.ledgerAccountId,
        sourceBindingVersion: source.binding.version,
        destinationBindingVersion: destination.version,
        amountMinor: command.amountMinor,
        currency,
        accountingUnit: source.binding.accountingUnit,
        reference: command.reference ?? null,
        narration: command.narration ?? null,
        authorizationContextReference: `customer-session:${principal.sessionId ?? principal.principalId}`,
        principal,
        policy: { limitUsage },
        requestContext,
        requestedAt,
        idempotencyKey: this.normalizeIdempotencyKey(command.idempotencyKey),
      };

      // A5T03: the authoritative pre-movement control point. Any failure here
      // (A2, pilot, A4 policy/limits, A3 binding) terminates the request
      // before any transfer row or journal can exist.
      const gate = await this.transferGate.validate(gateCommand);

      // A5T04: the lifecycle owns PENDING → PROCESSING → terminal. The
      // ledger posting happens only inside postToLedger, which fails closed
      // into a terminal FAILED state on any rejection.
      const pending = await this.transferLifecycle.createPending(
        this.toLifecycleCommand(gateCommand, gate, requestedAt, requestContext),
      );
      await this.transferLifecycle.transition(pending.id, {
        transferId: pending.id,
        nextStatus: TransferStatus.PROCESSING,
        idempotencyKey: `transition:${commandId}`,
        requestContext,
      });
      const completed = await this.transferLifecycle.postToLedger(pending.id, {
        idempotencyKey: `ledger-post:${commandId}`,
        requestContext,
      });

      if (completed.status === TransferStatus.FAILED) {
        const failure = {
          message: completed.failureMessage ?? 'The transfer failed',
          error: completed.failureCode ?? 'LEDGER_REJECTED',
        };
        await this.recordFailure(reservation.record.id, {
          statusCode: completed.failureStatusCode ?? 409,
          responseBody: failure,
        });
        throw new HttpException(failure, completed.failureStatusCode ?? 409);
      }

      const view = this.toTransferView(completed);
      await this.dataSource.transaction((manager) =>
        this.idempotencyService.complete(manager, reservation.record.id, {
          statusCode: 201,
          responseBody: view as unknown as Record<string, unknown>,
          resourceType: 'TRANSFER',
          resourceId: view.id,
        }),
      );
      return view;
    } catch (error) {
      if (error instanceof HttpException) {
        await this.recordFailureIfUnset(reservation.record.id, error);
      }
      throw error;
    }
  }

  async getTransactions(query: CustomerTransactionsQuery): Promise<WalletTransactionHistoryView> {
    const binding = await this.resolutionService.resolveOwnActiveBindingByCustomerWallet(
      query.customerId,
      query.customerWalletId,
    );
    return this.transferService.getWalletTransactions(
      binding.walletAccountId,
      query.page,
      query.limit,
    );
  }

  async createDeposit(command: CustomerMoneyMovementCommand): Promise<DepositView> {
    const currency = this.normalizeV1Currency(command.currency);
    const source = await this.resolutionService.resolveOwnActiveFinancialAccount(
      command.customerId,
      currency,
    );
    return this.depositService.createDeposit({
      walletId: source.binding.walletAccountId,
      amountMinor: command.amountMinor,
      currency,
      idempotencyKey: command.idempotencyKey,
      reference: command.reference,
      narration: command.narration,
    });
  }

  async completeDeposit(customerId: string, depositId: string): Promise<DepositView> {
    const deposit = await this.depositService.getDeposit(depositId);
    await this.resolutionService.assertOwnWalletAccount(customerId, deposit.walletId);
    return this.depositService.completeDeposit(depositId);
  }

  async createWithdrawal(command: CustomerMoneyMovementCommand): Promise<WithdrawalView> {
    const currency = this.normalizeV1Currency(command.currency);
    const source = await this.resolutionService.resolveOwnActiveFinancialAccount(
      command.customerId,
      currency,
    );
    // Step-up authorization before the withdrawal is created. The downstream
    // provider lifecycle (process/complete callbacks, settlement,
    // reconciliation) is deliberately PIN-free: it is never customer-invoked.
    await this.authorizeStepUp(command.customerId, command.transactionPin);
    return this.withdrawalService.createWithdrawal({
      walletId: source.binding.walletAccountId,
      amountMinor: command.amountMinor,
      currency,
      idempotencyKey: command.idempotencyKey,
      reference: command.reference,
      narration: command.narration,
    });
  }

  async processWithdrawal(customerId: string, withdrawalId: string): Promise<WithdrawalView> {
    const withdrawal = await this.withdrawalService.getWithdrawal(withdrawalId);
    await this.resolutionService.assertOwnWalletAccount(customerId, withdrawal.walletId);
    return this.withdrawalService.processWithdrawal(withdrawalId);
  }

  async completeWithdrawal(customerId: string, withdrawalId: string): Promise<WithdrawalView> {
    const withdrawal = await this.withdrawalService.getWithdrawal(withdrawalId);
    await this.resolutionService.assertOwnWalletAccount(customerId, withdrawal.walletId);
    return this.withdrawalService.completeWithdrawal(withdrawalId);
  }

  /**
   * Destination discrimination: exactly one of `destinationWalletId` (legacy
   * raw WalletAccount identifier) or `destination` (typed union) is required.
   * Typed destinations are resolved server-side through the recipient
   * resolution service; a raw identifier string is NEVER guessed between
   * WalletAccount ID / CustomerWallet ID / phone / receiving number.
   */
  private async resolveTransferDestination(command: CustomerTransferCommand): Promise<string> {
    const hasRaw = command.destinationWalletId !== undefined && command.destinationWalletId !== '';
    const hasTyped = command.destination !== undefined;
    if (hasRaw === hasTyped) {
      throw new BadRequestException(
        'Provide exactly one of destinationWalletId or destination (ambiguous destination)',
      );
    }
    if (hasRaw) {
      return command.destinationWalletId!.trim().toLowerCase();
    }
    const destination = command.destination!;
    if (destination.type === CustomerTransferDestinationType.WALLET_ACCOUNT) {
      return destination.value.trim().toLowerCase();
    }
    const resolved =
      destination.type === CustomerTransferDestinationType.MONIENAIJA_NUMBER
        ? await this.recipientResolutionService.resolveByReceivingNumber(destination.value)
        : await this.recipientResolutionService.resolveByPhone(destination.value);
    if (resolved.ownerCustomerId === command.customerId) {
      throw new ConflictException(
        destination.type === CustomerTransferDestinationType.MONIENAIJA_NUMBER
          ? 'Cannot transfer to your own MonieNaija receiving number'
          : 'Cannot transfer to your own phone number',
      );
    }
    return resolved.walletAccountId;
  }

  /** Fail-closed customer recipient lookup by 10-digit MonieNaija receiving number. */
  async resolveRecipientByReceivingNumber(customerId: string, number: string) {
    void customerId; // scope comes from the SELF guard; lookup targets may be other customers.
    return toPublicRecipientView(
      await this.recipientResolutionService.resolveByReceivingNumber(number),
    );
  }

  /** Fail-closed customer recipient lookup by Nigerian phone (any representation). */
  async resolveRecipientByPhone(customerId: string, phone: string) {
    void customerId;
    return toPublicRecipientView(await this.recipientResolutionService.resolveByPhone(phone));
  }

  private async authorizeStepUp(customerId: string, transactionPin: string | undefined) {
    if (typeof transactionPin !== 'string' || transactionPin.trim().length === 0) {
      throw new BadRequestException(
        'A transaction PIN is required to authorize this financial operation',
      );
    }
    await this.transactionAuthorization.authorizeTransaction(customerId, transactionPin);
  }

  private requireSelfCustomerPrincipal(command: CustomerTransferCommand) {
    const principal = command.principal;
    if (!principal || principal.type !== 'CUSTOMER' || !principal.customerId) {
      throw new UnauthorizedException('Authentication required');
    }
    if (principal.customerId !== command.customerId) {
      throw new UnauthorizedException('The authenticated customer does not match the command');
    }
    return principal;
  }

  /**
   * Usage context for the A4 limit evaluation, computed from canonical
   * movement history plus the sender's projected post-debit balance. Read
   * only; limits themselves come exclusively from the customer's approved
   * limit profile inside the A4 evaluator.
   */
  private async collectLimitUsage(
    sourceCustomerId: string,
    amountMinor: string,
    requestedAt: string,
  ) {
    const requested = new Date(requestedAt);
    const dayStart = new Date(requested);
    dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(requested);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const usageRows: Array<{
      day_count: string;
      day_amount: string;
      month_amount: string;
    }> = await this.dataSource.query(
      `SELECT
         COALESCE(COUNT(*) FILTER (WHERE completed_at >= $2), 0)::text AS day_count,
         COALESCE(SUM(amount_minor::numeric) FILTER (WHERE completed_at >= $2), 0)::text AS day_amount,
         COALESCE(SUM(amount_minor::numeric) FILTER (WHERE completed_at >= $3), 0)::text AS month_amount
       FROM transfers
       WHERE source_customer_id = $1 AND status = 'COMPLETED' AND completed_at < $4`,
      [sourceCustomerId, dayStart.toISOString(), monthStart.toISOString(), requested],
    );
    const bindingRows: Array<{ ledger_account_id: string }> = await this.dataSource.query(
      `SELECT ledger_account_id FROM customer_financial_account_bindings
       WHERE customer_id = $1 AND state = 'ACTIVE' AND currency = 'NGN' LIMIT 1`,
      [sourceCustomerId],
    );
    let projectedWalletBalance = 0n;
    const sourceLedgerAccountId = bindingRows[0]?.ledger_account_id;
    if (sourceLedgerAccountId) {
      const balanceRows: Array<{ balance: string }> = await this.dataSource.query(
        `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
        [sourceLedgerAccountId],
      );
      const current = BigInt(balanceRows[0]?.balance ?? '0');
      const proposed = current - BigInt(amountMinor);
      projectedWalletBalance = proposed > 0n ? proposed : 0n;
    }
    const usage = usageRows[0] ?? { day_count: '0', day_amount: '0', month_amount: '0' };
    return {
      amountMinor: String(BigInt(amountMinor)),
      currency: V1_CURRENCY,
      dailyUsedCount: Number(usage?.day_count ?? '0'),
      dailyUsedAmountMinor: String(usage?.day_amount ?? '0'),
      monthlyUsedAmountMinor: String(usage?.month_amount ?? '0'),
      projectedWalletBalanceMinor: String(projectedWalletBalance),
      usageAsOf: requestedAt,
      usageSourceReference: `transfers:ledger-lines:${sourceCustomerId}`,
    };
  }

  private toLifecycleCommand(
    gateCommand: InternalTransferGateCommand,
    gate: InternalTransferGateResult,
    requestedAt: string,
    requestContext: { requestId: string; correlationId: string },
  ): CreateTransferLifecycleCommand {
    return {
      contractVersion: 1,
      commandType: 'INTERNAL_TRANSFER',
      commandId: gate.commandId,
      capability: 'wallet.transfer',
      action: 'create',
      scope: gateCommand.scope,
      sourceCustomerId: gate.sourceCustomerId,
      destinationCustomerId: gate.destinationCustomerId,
      sourceCustomerWalletId: gateCommand.sourceCustomerWalletId,
      destinationCustomerWalletId: gateCommand.destinationCustomerWalletId,
      sourceBindingId: gate.sourceBinding.bindingId,
      destinationBindingId: gate.destinationBinding.bindingId,
      sourceBindingVersion: gate.sourceBinding.bindingVersion,
      destinationBindingVersion: gate.destinationBinding.bindingVersion,
      sourceWalletAccountId: gate.sourceWalletAccountId,
      destinationWalletAccountId: gate.destinationWalletAccountId,
      sourceLedgerAccountId: gate.sourceLedgerAccountId,
      destinationLedgerAccountId: gate.destinationLedgerAccountId,
      amountMinor: gate.amountMinor,
      currency: gate.currency,
      accountingUnit: gate.accountingUnit,
      idempotencyScope: TRANSFER_COMMAND_SCOPE,
      idempotencyKey: gateCommand.idempotencyKey,
      requestHash: gate.requestHash,
      authorizationContextReference: gateCommand.authorizationContextReference,
      policyDecisionReference: gate.policy.decisionReference,
      policyVersion: gate.policy.policyVersion,
      policyProfileReference: gate.policy.profileReference,
      policyProfileVersion: gate.policy.profileVersion,
      policySnapshotReference: gate.policy.evidenceSnapshotReference,
      policyInputHash: gate.policy.normalizedInputHash,
      requestedAt,
      requestContext,
      reference: gateCommand.reference ?? null,
      narration: gateCommand.narration ?? null,
    };
  }

  private toTransferView(view: TransferLifecycleView): TransferView {
    return {
      id: view.id,
      sourceWalletId: view.sourceWalletAccountId,
      destinationWalletId: view.destinationWalletAccountId,
      journalId: view.journalId,
      paymentReference: view.paymentReference,
      journalReference: null,
      amountMinor: view.amountMinor,
      currency: view.currency,
      status: view.status,
      idempotencyKey: view.idempotencyKey,
      reference: view.reference,
      narration: view.narration,
      failureCode: view.failureCode,
      failureMessage: view.failureMessage,
      failureStatusCode: view.failureStatusCode,
      createdAt: view.createdAt,
      completedAt: view.completedAt,
    };
  }

  private replayStoredResult(record: {
    status: IdempotencyRecordStatus;
    responseStatusCode: number | null;
    responseBody: Record<string, unknown> | null;
  }): TransferView {
    if (
      record.status === IdempotencyRecordStatus.FAILED ||
      (record.responseStatusCode ?? 0) >= 400
    ) {
      const body = record.responseBody ?? { message: 'The transfer failed' };
      throw new HttpException(body, record.responseStatusCode ?? 409);
    }
    if (!record.responseBody) {
      throw new ServiceUnavailableException('The idempotent transfer result is unavailable');
    }
    return record.responseBody as unknown as TransferView;
  }

  private customerRequestHash(
    command: CustomerTransferCommand,
    sourceWalletAccountId: string,
    destinationWalletAccountId: string,
    currency: string,
  ): string {
    return createHash('sha256')
      .update(
        this.canonicalJson({
          sourceWalletAccountId,
          destinationWalletAccountId,
          amountMinor: String(command.amountMinor).trim(),
          currency,
          reference: command.reference ?? null,
          narration: command.narration ?? null,
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

  private normalizeIdempotencyKey(key: string | undefined): string {
    const normalized = (key ?? '').trim();
    if (!normalized || normalized.length > 255) {
      throw new BadRequestException(
        'The Idempotency-Key header is required and must be at most 255 characters',
      );
    }
    return normalized;
  }

  private async recordFailure(
    reservationId: string,
    failure: { statusCode: number; responseBody: Record<string, unknown> },
  ): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.idempotencyService.fail(manager, reservationId, {
        statusCode: failure.statusCode,
        responseBody: failure.responseBody,
        resourceType: 'TRANSFER',
      }),
    );
  }

  private async recordFailureIfUnset(reservationId: string, error: HttpException): Promise<void> {
    // The terminal ledger-failure path already recorded its failure; every
    // other error (gate denial, lifecycle conflict, infrastructure) records
    // here so a retry replays the same failure rather than re-executing.
    try {
      const response = error.getResponse();
      await this.recordFailure(reservationId, {
        statusCode: error.getStatus(),
        responseBody:
          typeof response === 'object' && response !== null
            ? (response as Record<string, unknown>)
            : { message: String(response) },
      });
    } catch {
      // The original error remains authoritative; failure evidence must never
      // mask it.
    }
  }

  private normalizeV1Currency(value: string): string {
    const currency = normalizeCurrency(value);
    if (currency !== V1_CURRENCY) {
      throw new BadRequestException('V1 customer financial operations are NGN denominated only');
    }
    return currency;
  }
}
