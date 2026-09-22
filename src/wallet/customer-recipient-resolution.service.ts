import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { ContactMethodType, CustomerStatus } from '../customer/customer.enums';
import { Customer } from '../customer/customer.entity';
import { CustomerContactMethod } from '../customer/customer-contact-method.entity';
import { CustomerProfile } from '../customer/customer-profile.entity';
import { canonicalizeNigerianPhone } from '../customer/nigerian-phone';
import { CustomerReceivingNumber } from '../customer-wallet/customer-receiving-number.entity';
import { CustomerReceivingNumberStatus } from '../customer-wallet/customer-receiving-number.enums';
import { CustomerWallet } from '../customer-wallet/customer-wallet.entity';
import { CustomerWalletStatus, CustomerWalletType } from '../customer-wallet/customer-wallet.enums';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { CustomerFinancialAccountBinding } from './customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from './customer-financial-account-binding.enums';
import {
  CustomerRecipientLookupMode,
  type ResolvedRecipient,
} from './customer-recipient-resolution.types';
import { WalletAccount } from './wallet-account.entity';
import { WalletStatus } from './wallet.enums';

const RECEIVING_NUMBER_PATTERN = /^[0-9]{10}$/;
const UNIFORM_NOT_FOUND = 'Recipient not found';

/**
 * Authoritative customer-facing recipient resolution.
 *
 * Two lookup mechanisms, both fail-closed and exact (no fuzzy matching):
 *
 *   MONIENAIJA_NUMBER: 10-digit number → receiving-number record →
 *     CustomerWallet → ACTIVE financial binding → WalletAccount.
 *   PHONE: canonical Nigerian phone → customer → PRIMARY ACTIVE
 *     CustomerWallet → ACTIVE financial binding → WalletAccount.
 *
 * Every failure shape (unknown, inactive, unbound, closed) collapses to one
 * uniform NotFoundException so existence cannot be enumerated.
 */
@Injectable()
export class CustomerRecipientResolutionService {
  constructor(
    @InjectRepository(CustomerContactMethod)
    private readonly contactRepository: Repository<CustomerContactMethod>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerProfile)
    private readonly profileRepository: Repository<CustomerProfile>,
    @InjectRepository(CustomerWallet)
    private readonly customerWalletRepository: Repository<CustomerWallet>,
    @InjectRepository(CustomerReceivingNumber)
    private readonly receivingNumberRepository: Repository<CustomerReceivingNumber>,
    @InjectRepository(CustomerFinancialAccountBinding)
    private readonly bindingRepository: Repository<CustomerFinancialAccountBinding>,
    @InjectRepository(WalletAccount)
    private readonly walletAccountRepository: Repository<WalletAccount>,
    @InjectRepository(LedgerAccount)
    private readonly ledgerAccountRepository: Repository<LedgerAccount>,
  ) {}

  async resolveByReceivingNumber(number: string): Promise<ResolvedRecipient> {
    const normalized = number.trim();
    if (!RECEIVING_NUMBER_PATTERN.test(normalized)) {
      throw new BadRequestException('MonieNaija receiving number must be exactly 10 digits');
    }
    const record = await this.receivingNumberRepository.findOne({
      where: { number: normalized, status: CustomerReceivingNumberStatus.ACTIVE },
    });
    if (!record) {
      throw new NotFoundException(UNIFORM_NOT_FOUND);
    }
    const wallet = await this.requireActivePrimaryWallet(record.walletId, record.customerId);
    return this.toResolved(
      CustomerRecipientLookupMode.MONIENAIJA_NUMBER,
      wallet,
      record.number,
      null,
    );
  }

  async resolveByPhone(phone: string): Promise<ResolvedRecipient> {
    // canonicalizeNigerianPhone throws BadRequestException with precise
    // reasons for malformed/non-mobile/non-Nigerian input.
    const canonical = canonicalizeNigerianPhone(phone);
    const contact = await this.contactRepository.findOne({
      where: {
        type: ContactMethodType.PHONE,
        normalizedValue: canonical,
        deletedAt: IsNull(),
      },
    });
    if (!contact) {
      throw new NotFoundException(UNIFORM_NOT_FOUND);
    }
    const wallet = await this.requirePrimaryWalletForCustomer(contact.customerId);
    return this.toResolved(CustomerRecipientLookupMode.PHONE, wallet, null, canonical);
  }

  private async requireActivePrimaryWallet(
    walletId: string,
    customerId: string,
  ): Promise<CustomerWallet> {
    const wallet = await this.customerWalletRepository.findOne({ where: { id: walletId } });
    if (
      !wallet ||
      wallet.deletedAt ||
      wallet.customerId !== customerId ||
      wallet.type !== CustomerWalletType.PRIMARY ||
      wallet.status !== CustomerWalletStatus.ACTIVE
    ) {
      throw new NotFoundException(UNIFORM_NOT_FOUND);
    }
    return wallet;
  }

  private async requirePrimaryWalletForCustomer(customerId: string): Promise<CustomerWallet> {
    const wallet = await this.customerWalletRepository.findOne({
      where: {
        customerId,
        type: CustomerWalletType.PRIMARY,
        status: CustomerWalletStatus.ACTIVE,
        deletedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
    if (!wallet) {
      throw new NotFoundException(UNIFORM_NOT_FOUND);
    }
    return wallet;
  }

  private async toResolved(
    lookupMode: CustomerRecipientLookupMode,
    wallet: CustomerWallet,
    receivingNumber: string | null,
    canonicalPhone: string | null,
  ): Promise<ResolvedRecipient> {
    const customer = await this.customerRepository.findOne({ where: { id: wallet.customerId } });
    if (!customer || customer.deletedAt || customer.status !== CustomerStatus.ACTIVE) {
      throw new NotFoundException(UNIFORM_NOT_FOUND);
    }
    const binding = await this.bindingRepository.findOne({
      where: {
        customerWalletId: wallet.id,
        state: CustomerFinancialAccountBindingState.ACTIVE,
      },
    });
    if (!binding) {
      throw new NotFoundException(UNIFORM_NOT_FOUND);
    }
    const [walletAccount, ledgerAccount] = await Promise.all([
      this.walletAccountRepository.findOne({ where: { id: binding.walletAccountId } }),
      this.ledgerAccountRepository.findOne({ where: { id: binding.ledgerAccountId } }),
    ]);
    if (!walletAccount || walletAccount.status !== WalletStatus.ACTIVE || !ledgerAccount) {
      throw new NotFoundException(UNIFORM_NOT_FOUND);
    }

    const [receivingNumberRow, profile] = await Promise.all([
      receivingNumber
        ? Promise.resolve({ number: receivingNumber })
        : this.receivingNumberRepository.findOne({
            where: {
              walletId: wallet.id,
              status: CustomerReceivingNumberStatus.ACTIVE,
            },
          }),
      this.profileRepository.findOne({ where: { customerId: customer.id } }),
    ]);

    return {
      lookupMode,
      ownerCustomerId: customer.id,
      customerWalletId: wallet.id,
      walletAccountId: binding.walletAccountId,
      currency: binding.currency,
      receivingNumber: receivingNumberRow?.number ?? null,
      canonicalPhone,
      displayName: profile?.displayName ?? 'MonieNaija Customer',
    };
  }
}
