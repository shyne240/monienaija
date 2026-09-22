import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from '../src/wallet/customer-financial-account-binding.enums';
import { CustomerFinancialAccountResolutionService } from '../src/wallet/customer-financial-account-resolution.service';
import type { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletStatus } from '../src/wallet/wallet.enums';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-00000000000a';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const BINDING_ID = '00000000-0000-4000-8000-000000000005';
const DESTINATION_WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000006';

function bindingRow(overrides: Partial<CustomerFinancialAccountBinding> = {}) {
  return {
    id: BINDING_ID,
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    walletAccountId: WALLET_ACCOUNT_ID,
    ledgerAccountId: LEDGER_ACCOUNT_ID,
    currency: 'NGN',
    accountingUnit: 'CUSTOMER_FUNDS',
    state: CustomerFinancialAccountBindingState.ACTIVE,
    ...overrides,
  } as CustomerFinancialAccountBinding;
}

function walletAccountRow(overrides: Partial<WalletAccount> = {}) {
  return {
    id: WALLET_ACCOUNT_ID,
    customerId: CUSTOMER_ID,
    currency: 'NGN',
    status: WalletStatus.ACTIVE,
    ledgerAccountId: LEDGER_ACCOUNT_ID,
    ...overrides,
  } as WalletAccount;
}

describe('CustomerFinancialAccountResolutionService', () => {
  function fixture(rows: {
    bindings?: CustomerFinancialAccountBinding[];
    wallets?: WalletAccount[];
  }) {
    const bindings = rows.bindings ?? [];
    const wallets = rows.wallets ?? [];
    const findMatching = <T>(records: T[], where: Record<string, unknown>) =>
      records.find((record) =>
        Object.entries(where).every(
          ([key, expected]) => (record as Record<string, unknown>)[key] === expected,
        ),
      ) ?? null;
    const bindingRepository = {
      findOne: jest.fn((options: { where: Record<string, unknown> }) =>
        Promise.resolve(findMatching(bindings, options.where)),
      ),
    };
    const walletRepository = {
      findOne: jest.fn((options: { where: Record<string, unknown> }) =>
        Promise.resolve(findMatching(wallets, options.where)),
      ),
    };
    const service = new CustomerFinancialAccountResolutionService(
      bindingRepository as unknown as Repository<CustomerFinancialAccountBinding>,
      walletRepository as unknown as Repository<WalletAccount>,
    );
    return { service, bindingRepository, walletRepository };
  }

  it('resolves the customer own ACTIVE financial account for a currency', async () => {
    const { service } = fixture({
      bindings: [bindingRow()],
      wallets: [walletAccountRow()],
    });

    const resolved = await service.resolveOwnActiveFinancialAccount(CUSTOMER_ID, 'ngn');

    expect(resolved.binding.id).toBe(BINDING_ID);
    expect(resolved.binding.walletAccountId).toBe(WALLET_ACCOUNT_ID);
    expect(resolved.binding.ledgerAccountId).toBe(LEDGER_ACCOUNT_ID);
    expect(resolved.walletAccount.id).toBe(WALLET_ACCOUNT_ID);
  });

  it('fails closed when the customer has no binding for the currency', async () => {
    const { service } = fixture({ bindings: [], wallets: [] });

    await expect(
      service.resolveOwnActiveFinancialAccount(CUSTOMER_ID, 'NGN'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a non-ACTIVE binding', async () => {
    const { service } = fixture({
      bindings: [bindingRow({ state: CustomerFinancialAccountBindingState.SUSPENDED })],
      wallets: [walletAccountRow()],
    });

    await expect(
      service.resolveOwnActiveFinancialAccount(CUSTOMER_ID, 'NGN'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a bound wallet account that is not ACTIVE', async () => {
    const { service } = fixture({
      bindings: [bindingRow()],
      wallets: [walletAccountRow({ status: WalletStatus.SUSPENDED })],
    });

    await expect(
      service.resolveOwnActiveFinancialAccount(CUSTOMER_ID, 'NGN'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('resolves the own CustomerWallet binding and rejects foreign CustomerWallets', async () => {
    const { service, bindingRepository } = fixture({
      bindings: [bindingRow()],
      wallets: [walletAccountRow()],
    });

    const own = await service.resolveOwnActiveBindingByCustomerWallet(
      CUSTOMER_ID,
      CUSTOMER_WALLET_ID,
    );
    expect(own.id).toBe(BINDING_ID);

    // The lookup is scoped by the authenticated customer; a foreign wallet
    // identifier never matches.
    await expect(
      service.resolveOwnActiveBindingByCustomerWallet(OTHER_CUSTOMER_ID, CUSTOMER_WALLET_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bindingRepository.findOne).toHaveBeenCalledWith({
      where: { customerId: OTHER_CUSTOMER_ID, customerWalletId: CUSTOMER_WALLET_ID },
    });
  });

  it('verifies WalletAccount ownership and rejects foreign wallet accounts', async () => {
    const { service } = fixture({ bindings: [bindingRow()] });

    const own = await service.assertOwnWalletAccount(CUSTOMER_ID, WALLET_ACCOUNT_ID);
    expect(own.walletAccountId).toBe(WALLET_ACCOUNT_ID);

    await expect(
      service.assertOwnWalletAccount(OTHER_CUSTOMER_ID, WALLET_ACCOUNT_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a CustomerWallet identifier used as a transfer destination', async () => {
    const { service } = fixture({ bindings: [bindingRow()] });

    // CUSTOMER_WALLET_ID is not a WalletAccount identifier, so there is no
    // binding row for it and the substitution is rejected.
    await expect(
      service.resolveActiveDestinationAccount(CUSTOMER_WALLET_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves an ACTIVE destination account and rejects non-ACTIVE destinations', async () => {
    const { service } = fixture({
      bindings: [
        bindingRow({
          id: '00000000-0000-4000-8000-000000000007',
          customerId: OTHER_CUSTOMER_ID,
          customerWalletId: '00000000-0000-4000-8000-000000000008',
          walletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
        }),
      ],
    });

    const destination = await service.resolveActiveDestinationAccount(
      DESTINATION_WALLET_ACCOUNT_ID,
    );
    expect(destination.walletAccountId).toBe(DESTINATION_WALLET_ACCOUNT_ID);

    const suspended = fixture({
      bindings: [
        bindingRow({
          walletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
          customerId: OTHER_CUSTOMER_ID,
          state: CustomerFinancialAccountBindingState.REPAIR_REQUIRED,
        }),
      ],
    });
    await expect(
      suspended.service.resolveActiveDestinationAccount(DESTINATION_WALLET_ACCOUNT_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates UUID inputs', async () => {
    const { service } = fixture({ bindings: [] });

    await expect(
      service.resolveOwnActiveFinancialAccount('not-a-uuid', 'NGN'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.assertOwnWalletAccount(CUSTOMER_ID, 'also-not-a-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
