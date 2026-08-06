import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPolicy } from '../authorization/authorization.types';
import { Customer } from '../customer/customer.entity';
import { CustomerStatus } from '../customer/customer.enums';
import { CustomerWallet } from '../customer-wallet/customer-wallet.entity';
import { CustomerWalletStatus } from '../customer-wallet/customer-wallet.enums';
import { LedgerAccount } from '../ledger/ledger-account.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../ledger/ledger.enums';
import { LedgerService } from '../ledger/ledger.service';
import { CustomerFinancialAccountBinding } from './customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from './customer-financial-account-binding.enums';
import type {
  CustomerFinancialAccountReadCommand,
  CustomerFinancialAccountReadModel,
  CustomerFinancialAccountReadState,
  CustomerFinancialAccountView,
} from './customer-financial-account-read.types';
import { WalletAccount } from './wallet-account.entity';
import { WalletStatus } from './wallet.enums';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CUSTOMER_FINANCIAL_ACCOUNT_READ_POLICY_BASE: AuthorizationPolicy = {
  resourceType: 'customer-financial-account',
  action: 'wallet:account-binding:read',
};

@Injectable()
export class CustomerFinancialAccountReadService {
  constructor(
    @InjectRepository(CustomerFinancialAccountBinding)
    private readonly bindingRepository: Repository<CustomerFinancialAccountBinding>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerWallet)
    private readonly customerWalletRepository: Repository<CustomerWallet>,
    @InjectRepository(WalletAccount)
    private readonly walletRepository: Repository<WalletAccount>,
    @InjectRepository(LedgerAccount)
    private readonly ledgerAccountRepository: Repository<LedgerAccount>,
    private readonly ledgerService: LedgerService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async getCustomerFinancialAccounts(
    command: CustomerFinancialAccountReadCommand,
  ): Promise<CustomerFinancialAccountReadModel> {
    const customerId = this.normalizeUuid(command.customerId);
    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer || customer.deletedAt) {
      throw new NotFoundException(`Customer ${customerId} was not found`);
    }

    const authorization = await this.authorizationService.authorize(
      command.principal,
      this.readPolicy(command.principal),
      {
        type: 'customer-financial-account',
        id: customerId,
        customerId,
      },
    );
    if (!authorization.allowed) {
      throw new ForbiddenException(`Authorization denied: ${authorization.reason}`);
    }

    const [customerWallets, bindings] = await Promise.all([
      this.customerWalletRepository.find({ where: { customerId } }),
      this.bindingRepository.find({
        where: { customerId },
        order: { createdAt: 'ASC' },
      }),
    ]);
    const accounts: CustomerFinancialAccountView[] = [];
    const warnings: string[] = [];
    const boundWalletIds = new Set<string>();

    for (const binding of bindings) {
      boundWalletIds.add(binding.customerWalletId);
      accounts.push(await this.toView(customer, binding));
    }

    for (const customerWallet of customerWallets) {
      if (!boundWalletIds.has(customerWallet.id)) {
        accounts.push(this.missingBindingView(customerId, customerWallet));
        warnings.push(`Customer wallet ${customerWallet.id} has no financial account binding`);
      }
    }

    if (accounts.length === 0) {
      warnings.push('No customer financial account binding exists');
    }

    return {
      customerId,
      generatedAt: new Date().toISOString(),
      accounts,
      warnings,
    };
  }

  private readPolicy(
    principal: CustomerFinancialAccountReadCommand['principal'],
  ): AuthorizationPolicy {
    if (principal.type === 'CUSTOMER') {
      return {
        ...CUSTOMER_FINANCIAL_ACCOUNT_READ_POLICY_BASE,
        allowedPrincipalTypes: ['CUSTOMER'],
        customerAccess: 'SELF',
      };
    }
    return {
      ...CUSTOMER_FINANCIAL_ACCOUNT_READ_POLICY_BASE,
      requiredScopes: ['wallet:account-binding:read'],
      allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
      customerAccess: 'ASSIGNED',
    };
  }

  private async toView(
    customer: Customer,
    binding: CustomerFinancialAccountBinding,
  ): Promise<CustomerFinancialAccountView> {
    const base = {
      bindingId: binding.id,
      customerId: customer.id,
      customerWalletId: binding.customerWalletId,
      walletAccountId: binding.walletAccountId,
      ledgerAccountId: binding.ledgerAccountId,
      bindingState: binding.state,
      currency: binding.currency,
      accountingUnit: binding.accountingUnit,
    };

    if (binding.state !== CustomerFinancialAccountBindingState.ACTIVE) {
      return {
        ...base,
        readState: this.readStateForBinding(binding.state),
        balanceMinor: null,
        warnings: [`Binding is ${binding.state}`],
      };
    }

    const [customerWallet, walletAccount, ledgerAccount] = await Promise.all([
      this.customerWalletRepository.findOne({ where: { id: binding.customerWalletId } }),
      this.walletRepository.findOne({ where: { id: binding.walletAccountId } }),
      this.ledgerAccountRepository.findOne({ where: { id: binding.ledgerAccountId } }),
    ]);
    const staleReasons = this.staleReasons(
      customer,
      binding,
      customerWallet,
      walletAccount,
      ledgerAccount,
    );
    if (staleReasons.length > 0) {
      return {
        ...base,
        readState: 'STALE_BINDING',
        balanceMinor: null,
        warnings: staleReasons,
      };
    }

    try {
      const balance = await this.ledgerService.getAccountBalance(binding.ledgerAccountId);
      if (
        balance.currency !== binding.currency ||
        balance.accountingUnit !== binding.accountingUnit
      ) {
        return {
          ...base,
          readState: 'STALE_BINDING',
          balanceMinor: null,
          warnings: ['Ledger balance dimensions do not match the binding'],
        };
      }
      return {
        ...base,
        readState: 'ACTIVE',
        balanceMinor: balance.balanceMinor,
        warnings: [],
      };
    } catch {
      return {
        ...base,
        readState: 'LEDGER_UNAVAILABLE',
        balanceMinor: null,
        warnings: ['Ledger balance could not be read'],
      };
    }
  }

  private staleReasons(
    customer: Customer,
    binding: CustomerFinancialAccountBinding,
    customerWallet: CustomerWallet | null,
    walletAccount: WalletAccount | null,
    ledgerAccount: LedgerAccount | null,
  ): string[] {
    const reasons: string[] = [];
    if (customer.status !== CustomerStatus.ACTIVE) reasons.push('Customer is not ACTIVE');
    if (customerWallet === null) reasons.push('Customer wallet source is missing');
    if (customerWallet && customerWallet.customerId !== customer.id) {
      reasons.push('Customer wallet ownership does not match the customer');
    }
    if (customerWallet && customerWallet.status !== CustomerWalletStatus.ACTIVE) {
      reasons.push('Customer wallet is not ACTIVE');
    }
    if (customerWallet && customerWallet.currency !== binding.currency) {
      reasons.push('Customer wallet currency does not match the binding');
    }
    if (customerWallet && customerWallet.version !== binding.sourceCustomerWalletVersion) {
      reasons.push('Customer wallet version is stale');
    }
    if (customer.version !== binding.sourceCustomerVersion) {
      reasons.push('Customer version is stale');
    }
    if (walletAccount === null) reasons.push('Wallet account source is missing');
    if (walletAccount && walletAccount.status !== WalletStatus.ACTIVE) {
      reasons.push('Wallet account is not ACTIVE');
    }
    if (walletAccount && walletAccount.currency !== binding.currency) {
      reasons.push('Wallet account currency does not match the binding');
    }
    if (walletAccount && walletAccount.ledgerAccountId !== binding.ledgerAccountId) {
      reasons.push('Wallet account ledger relationship does not match the binding');
    }
    if (ledgerAccount === null) reasons.push('Ledger account source is missing');
    if (ledgerAccount && ledgerAccount.currency !== binding.currency) {
      reasons.push('Ledger account currency does not match the binding');
    }
    if (ledgerAccount && ledgerAccount.accountingUnit !== binding.accountingUnit) {
      reasons.push('Ledger account accounting unit does not match the binding');
    }
    if (ledgerAccount && ledgerAccount.accountType !== LedgerAccountType.LIABILITY) {
      reasons.push('Ledger account type is incompatible');
    }
    if (ledgerAccount && ledgerAccount.normalBalance !== LedgerNormalBalance.CREDIT) {
      reasons.push('Ledger account normal balance is incompatible');
    }
    if (ledgerAccount?.allowNegativeBalance) reasons.push('Ledger account allows negative balance');
    if (ledgerAccount && !ledgerAccount.isActive) reasons.push('Ledger account is inactive');
    return reasons;
  }

  private missingBindingView(
    customerId: string,
    customerWallet: CustomerWallet,
  ): CustomerFinancialAccountView {
    const warning = `Customer wallet ${customerWallet.id} has no financial account binding`;
    return {
      bindingId: null,
      customerId,
      customerWalletId: customerWallet.id,
      walletAccountId: null,
      ledgerAccountId: null,
      bindingState: null,
      readState: 'MISSING_BINDING',
      currency: customerWallet.currency,
      accountingUnit: null,
      balanceMinor: null,
      warnings: [warning],
    };
  }

  private readStateForBinding(
    state: CustomerFinancialAccountBindingState,
  ): CustomerFinancialAccountReadState {
    switch (state) {
      case CustomerFinancialAccountBindingState.PENDING:
        return 'PENDING';
      case CustomerFinancialAccountBindingState.SUSPENDED:
        return 'SUSPENDED';
      case CustomerFinancialAccountBindingState.REPAIR_REQUIRED:
        return 'REPAIR_REQUIRED';
      case CustomerFinancialAccountBindingState.CLOSED:
        return 'CLOSED';
      case CustomerFinancialAccountBindingState.ACTIVE:
        return 'ACTIVE';
    }
  }

  private normalizeUuid(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(normalized)) {
      throw new ForbiddenException('Customer identity must be a UUID');
    }
    return normalized;
  }
}
