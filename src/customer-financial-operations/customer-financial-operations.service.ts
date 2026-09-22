import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { normalizeCurrency } from '../common/money';
import { DepositService } from '../deposit/deposit.service';
import type { DepositView } from '../deposit/deposit.types';
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
 * Customer-facing financial command surface. Every operation derives its
 * WalletAccount through the CustomerWallet financial binding owned by the
 * authenticated customer; client-supplied identifiers are validated against
 * that binding and never trusted as proof of ownership.
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
  ) {}

  async createTransfer(command: CustomerTransferCommand): Promise<TransferView> {
    const currency = this.normalizeV1Currency(command.currency);
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

    // Step-up authorization: the transaction PIN is verified BEFORE money
    // movement is initiated. Only this customer-facing boundary enforces it;
    // the internal TransferService contract is unchanged so provider
    // settlement, reconciliation, and internal flows never require a PIN.
    await this.authorizeStepUp(command.customerId, command.transactionPin);

    return this.transferService.createTransfer({
      sourceWalletId: source.binding.walletAccountId,
      destinationWalletId,
      amountMinor: command.amountMinor,
      currency,
      idempotencyKey: command.idempotencyKey,
      reference: command.reference,
      narration: command.narration,
    });
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

  private normalizeV1Currency(value: string): string {
    const currency = normalizeCurrency(value);
    if (currency !== V1_CURRENCY) {
      throw new BadRequestException('V1 customer financial operations are NGN denominated only');
    }
    return currency;
  }
}
