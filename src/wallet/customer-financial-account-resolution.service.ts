import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CustomerFinancialAccountBinding } from './customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from './customer-financial-account-binding.enums';
import { WalletAccount } from './wallet-account.entity';
import { WalletStatus } from './wallet.enums';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface ResolvedCustomerFinancialAccount {
  binding: CustomerFinancialAccountBinding;
  walletAccount: WalletAccount;
}

/**
 * Authoritative customer-facing binding resolution. Every customer-initiated
 * financial operation must derive its WalletAccount through this service so
 * that no caller can act on another customer's financial account, and so that
 * a CustomerWallet registry identifier is never silently treated as a
 * WalletAccount identifier.
 *
 * All lookups are scoped by the authenticated customer's canonical id and fail
 * closed: a missing, foreign, or non-ACTIVE binding rejects the operation.
 */
@Injectable()
export class CustomerFinancialAccountResolutionService {
  constructor(
    @InjectRepository(CustomerFinancialAccountBinding)
    private readonly bindingRepository: Repository<CustomerFinancialAccountBinding>,
    @InjectRepository(WalletAccount)
    private readonly walletAccountRepository: Repository<WalletAccount>,
  ) {}

  /**
   * Resolves the authenticated customer's ACTIVE financial account for a
   * currency. Used as the source-of-funds for customer-initiated financial
   * operations where the client never supplies the WalletAccount identifier.
   */
  async resolveOwnActiveFinancialAccount(
    customerId: string,
    currency: string,
  ): Promise<ResolvedCustomerFinancialAccount> {
    const normalizedCustomerId = this.normalizeUuid(customerId, 'customerId');
    const normalizedCurrency = this.normalizeCurrency(currency);
    const binding = await this.bindingRepository.findOne({
      where: { customerId: normalizedCustomerId, currency: normalizedCurrency },
    });
    if (!binding) {
      throw new NotFoundException(
        'No financial account is bound to an active customer wallet for this currency',
      );
    }
    this.assertBindingActive(binding);
    return { binding, walletAccount: await this.loadActiveWalletAccount(binding) };
  }

  /**
   * Resolves the ACTIVE binding for a CustomerWallet owned by the
   * authenticated customer. A CustomerWallet belonging to another customer —
   * or one that does not exist — is indistinguishable from a missing wallet
   * and fails closed.
   */
  async resolveOwnActiveBindingByCustomerWallet(
    customerId: string,
    customerWalletId: string,
  ): Promise<CustomerFinancialAccountBinding> {
    const normalizedCustomerId = this.normalizeUuid(customerId, 'customerId');
    const normalizedCustomerWalletId = this.normalizeUuid(customerWalletId, 'customerWalletId');
    const binding = await this.bindingRepository.findOne({
      where: {
        customerId: normalizedCustomerId,
        customerWalletId: normalizedCustomerWalletId,
      },
    });
    if (!binding) {
      throw new NotFoundException('No financial account binding exists for this customer wallet');
    }
    this.assertBindingActive(binding);
    return binding;
  }

  /**
   * Verifies that a WalletAccount is bound to the authenticated customer. Used
   * when a client legitimately references a WalletAccount it already knows
   * (for example completing a deposit it created). A foreign WalletAccount
   * identifier is rejected without revealing whether it exists.
   */
  async assertOwnWalletAccount(
    customerId: string,
    walletAccountId: string,
  ): Promise<CustomerFinancialAccountBinding> {
    const normalizedCustomerId = this.normalizeUuid(customerId, 'customerId');
    const normalizedWalletAccountId = this.normalizeUuid(walletAccountId, 'walletAccountId');
    const binding = await this.bindingRepository.findOne({
      where: {
        customerId: normalizedCustomerId,
        walletAccountId: normalizedWalletAccountId,
      },
    });
    if (!binding) {
      throw new ForbiddenException(
        'The referenced financial account is not bound to the authenticated customer',
      );
    }
    return binding;
  }

  /**
   * Resolves a transfer destination WalletAccount. Wallet-to-wallet transfers
   * are customer-to-customer, so the destination must be a registered
   * customer's financial account with an ACTIVE binding. A CustomerWallet
   * identifier supplied here is not a financial account and is rejected.
   */
  async resolveActiveDestinationAccount(
    walletAccountId: string,
  ): Promise<CustomerFinancialAccountBinding> {
    const normalizedWalletAccountId = this.normalizeUuid(walletAccountId, 'walletAccountId');
    const binding = await this.bindingRepository.findOne({
      where: { walletAccountId: normalizedWalletAccountId },
    });
    if (!binding) {
      throw new NotFoundException(
        'The destination is not a registered MonieNaija financial account',
      );
    }
    if (binding.state !== CustomerFinancialAccountBindingState.ACTIVE) {
      throw new ConflictException('The destination financial account binding is not ACTIVE');
    }
    return binding;
  }

  private async loadActiveWalletAccount(
    binding: CustomerFinancialAccountBinding,
  ): Promise<WalletAccount> {
    const walletAccount = await this.walletAccountRepository.findOne({
      where: { id: binding.walletAccountId },
    });
    if (!walletAccount) {
      throw new ConflictException('The bound wallet account does not exist');
    }
    if (walletAccount.status !== WalletStatus.ACTIVE) {
      throw new ConflictException('The bound wallet account is not ACTIVE');
    }
    return walletAccount;
  }

  private assertBindingActive(binding: CustomerFinancialAccountBinding): void {
    if (binding.state !== CustomerFinancialAccountBindingState.ACTIVE) {
      throw new ConflictException('The customer financial account binding is not ACTIVE');
    }
  }

  private normalizeUuid(value: string, field: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new BadRequestException(`${field} must be a UUID`);
    }
    return normalized;
  }

  private normalizeCurrency(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!CURRENCY_PATTERN.test(normalized)) {
      throw new BadRequestException('currency must be a three-letter code');
    }
    return normalized;
  }
}
