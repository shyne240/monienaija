import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { CustomerFinancialOperationsService } from '../src/customer-financial-operations/customer-financial-operations.service';
import type { CustomerTransactionAuthorizationService } from '../src/customer-financial-operations/customer-transaction-authorization.service';
import type { CustomerTransferCommand } from '../src/customer-financial-operations/customer-financial-operations.types';
import { CustomerTransferDestinationType } from '../src/customer-financial-operations/customer-financial-operations.types';
import type { CustomerRecipientResolutionService } from '../src/wallet/customer-recipient-resolution.service';
import type { DepositService } from '../src/deposit/deposit.service';
import type { TransferService } from '../src/transfer/transfer.service';
import { CustomerFinancialAccountBindingState } from '../src/wallet/customer-financial-account-binding.enums';
import type { CustomerFinancialAccountResolutionService } from '../src/wallet/customer-financial-account-resolution.service';
import type { WithdrawalService } from '../src/withdrawal/withdrawal.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-00000000000a';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000002';
const SOURCE_WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000003';
const LEDGER_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const BINDING_ID = '00000000-0000-4000-8000-000000000005';
const DESTINATION_WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000006';
const DEPOSIT_ID = '00000000-0000-4000-8000-000000000007';
const WITHDRAWAL_ID = '00000000-0000-4000-8000-000000000008';

function sourceBinding() {
  return {
    id: BINDING_ID,
    customerId: CUSTOMER_ID,
    customerWalletId: CUSTOMER_WALLET_ID,
    walletAccountId: SOURCE_WALLET_ACCOUNT_ID,
    ledgerAccountId: LEDGER_ACCOUNT_ID,
    currency: 'NGN',
    state: CustomerFinancialAccountBindingState.ACTIVE,
  };
}

function transferCommand(
  overrides: Partial<CustomerTransferCommand> = {},
): CustomerTransferCommand {
  return {
    customerId: CUSTOMER_ID,
    destinationWalletId: DESTINATION_WALLET_ACCOUNT_ID,
    amountMinor: '25000',
    currency: 'NGN',
    idempotencyKey: 'customer-transfer-test-1',
    transactionPin: '4826',
    ...overrides,
  };
}

describe('CustomerFinancialOperationsService', () => {
  function fixture() {
    const resolution = {
      resolveOwnActiveFinancialAccount: jest.fn().mockResolvedValue({
        binding: sourceBinding(),
        walletAccount: { id: SOURCE_WALLET_ACCOUNT_ID },
      }),
      resolveOwnActiveBindingByCustomerWallet: jest.fn().mockResolvedValue(sourceBinding()),
      assertOwnWalletAccount: jest.fn().mockResolvedValue(sourceBinding()),
      resolveActiveDestinationAccount: jest.fn().mockResolvedValue({
        ...sourceBinding(),
        id: '00000000-0000-4000-8000-000000000009',
        customerId: OTHER_CUSTOMER_ID,
        walletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      }),
    };
    const transfers = { createTransfer: jest.fn(), getWalletTransactions: jest.fn() };
    const deposits = {
      createDeposit: jest.fn(),
      getDeposit: jest.fn(),
      completeDeposit: jest.fn(),
    };
    const withdrawals = {
      createWithdrawal: jest.fn(),
      getWithdrawal: jest.fn(),
      completeWithdrawal: jest.fn(),
    };
    const recipientResolution = { resolveByReceivingNumber: jest.fn(), resolveByPhone: jest.fn() };
    const authorization = {
      authorizeTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomerFinancialOperationsService(
      resolution as unknown as CustomerFinancialAccountResolutionService,
      transfers as unknown as TransferService,
      deposits as unknown as DepositService,
      withdrawals as unknown as WithdrawalService,
      recipientResolution as unknown as CustomerRecipientResolutionService,
      authorization as unknown as CustomerTransactionAuthorizationService,
    );
    return { service, resolution, transfers, deposits, withdrawals, recipientResolution, authorization };
  }

  it('rejects ambiguous or missing transfer destinations', async () => {
    const { service } = fixture();
    await expect(
      service.createTransfer(
        transferCommand({
          destination: {
            type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
            value: '7065111760',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const rest = { ...transferCommand() };
    delete (rest as Partial<CustomerTransferCommand>).destinationWalletId;
    await expect(service.createTransfer(rest as CustomerTransferCommand)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resolves a MonieNaija number destination server-side to a WalletAccount', async () => {
    const { service, transfers, recipientResolution } = fixture();
    recipientResolution.resolveByReceivingNumber.mockResolvedValue({
      lookupMode: 'MONIENAIJA_NUMBER',
      ownerCustomerId: OTHER_CUSTOMER_ID,
      customerWalletId: '00000000-0000-4000-8000-0000000000aa',
      walletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      currency: 'NGN',
      receivingNumber: '7065111760',
      canonicalPhone: null,
      displayName: 'Recipient',
    });
    transfers.createTransfer.mockResolvedValue({ id: 'transfer-2' });

    const rest = { ...transferCommand() };
    delete (rest as Partial<CustomerTransferCommand>).destinationWalletId;
    await service.createTransfer({
      ...rest,
      destination: {
        type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
        value: '7065111760',
      },
    } as CustomerTransferCommand);

    expect(recipientResolution.resolveByReceivingNumber).toHaveBeenCalledWith('7065111760');
    expect(transfers.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWalletId: SOURCE_WALLET_ACCOUNT_ID,
        destinationWalletId: DESTINATION_WALLET_ACCOUNT_ID,
      }),
    );
  });

  it('resolves a phone destination and rejects destination == own phone or number', async () => {
    const { service, recipientResolution } = fixture();
    recipientResolution.resolveByPhone.mockResolvedValue({
      lookupMode: 'PHONE',
      ownerCustomerId: CUSTOMER_ID, // sender's own account resolved through the phone
      customerWalletId: '00000000-0000-4000-8000-000000000005',
      walletAccountId: SOURCE_WALLET_ACCOUNT_ID,
      currency: 'NGN',
      receivingNumber: '7012345678',
      canonicalPhone: '+2347012345678',
      displayName: 'Self',
    });
    const rest = { ...transferCommand() };
    delete (rest as Partial<CustomerTransferCommand>).destinationWalletId;
    await expect(
      service.createTransfer({
        ...rest,
        destination: { type: CustomerTransferDestinationType.PHONE, value: '07012345678' },
      } as CustomerTransferCommand),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('delegates a customer transfer with the bound WalletAccount, never a client identifier', async () => {
    const { service, transfers, resolution } = fixture();
    transfers.createTransfer.mockResolvedValue({ id: 'transfer-1' });

    await service.createTransfer(transferCommand());

    expect(resolution.resolveOwnActiveFinancialAccount).toHaveBeenCalledWith(CUSTOMER_ID, 'NGN');
    expect(transfers.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWalletId: SOURCE_WALLET_ACCOUNT_ID,
        destinationWalletId: DESTINATION_WALLET_ACCOUNT_ID,
        amountMinor: '25000',
        currency: 'NGN',
        idempotencyKey: 'customer-transfer-test-1',
      }),
    );
  });

  it('rejects non-NGN customer operations (V1 scope)', async () => {
    const { service, resolution } = fixture();

    await expect(
      service.createTransfer(transferCommand({ currency: 'USD' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resolution.resolveOwnActiveFinancialAccount).not.toHaveBeenCalled();

    await expect(
      service.createDeposit({
        customerId: CUSTOMER_ID,
        amountMinor: '1000',
        currency: 'EUR',
        idempotencyKey: 'dep-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createWithdrawal({
        customerId: CUSTOMER_ID,
        amountMinor: '1000',
        currency: 'USD',
        idempotencyKey: 'wd-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a destination that equals the own bound wallet', async () => {
    const { service, resolution } = fixture();

    await expect(
      service.createTransfer(transferCommand({ destinationWalletId: SOURCE_WALLET_ACCOUNT_ID })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(resolution.resolveActiveDestinationAccount).not.toHaveBeenCalled();
  });

  it('rejects a destination that resolves back to the same customer', async () => {
    const { service, resolution } = fixture();
    resolution.resolveActiveDestinationAccount.mockResolvedValue(sourceBinding());

    await expect(service.createTransfer(transferCommand())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('propagates destination resolution failures (foreign or CustomerWallet identifiers)', async () => {
    const { service, resolution, transfers } = fixture();
    resolution.resolveActiveDestinationAccount.mockRejectedValue(
      new NotFoundException('The destination is not a registered MonieNaija financial account'),
    );

    await expect(
      service.createTransfer(transferCommand({ destinationWalletId: CUSTOMER_WALLET_ID })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transfers.createTransfer).not.toHaveBeenCalled();
  });

  it('reads transaction history through the bound WalletAccount of the own CustomerWallet', async () => {
    const { service, transfers, resolution } = fixture();
    transfers.getWalletTransactions.mockResolvedValue({ items: [], pagination: {} });

    await service.getTransactions({
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      page: 2,
      limit: 15,
    });

    expect(resolution.resolveOwnActiveBindingByCustomerWallet).toHaveBeenCalledWith(
      CUSTOMER_ID,
      CUSTOMER_WALLET_ID,
    );
    expect(transfers.getWalletTransactions).toHaveBeenCalledWith(SOURCE_WALLET_ACCOUNT_ID, 2, 15);
  });

  it('creates deposits against the bound WalletAccount and completes only own deposits', async () => {
    const { service, deposits, resolution } = fixture();
    deposits.createDeposit.mockResolvedValue({ id: DEPOSIT_ID });
    deposits.getDeposit.mockResolvedValue({ id: DEPOSIT_ID, walletId: SOURCE_WALLET_ACCOUNT_ID });
    deposits.completeDeposit.mockResolvedValue({ id: DEPOSIT_ID, status: 'COMPLETED' });

    await service.createDeposit({
      customerId: CUSTOMER_ID,
      amountMinor: '5000',
      currency: 'ngn',
      idempotencyKey: 'dep-1',
    });
    expect(deposits.createDeposit).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: SOURCE_WALLET_ACCOUNT_ID, currency: 'NGN' }),
    );

    await service.completeDeposit(CUSTOMER_ID, DEPOSIT_ID);
    expect(resolution.assertOwnWalletAccount).toHaveBeenCalledWith(
      CUSTOMER_ID,
      SOURCE_WALLET_ACCOUNT_ID,
    );
    expect(deposits.completeDeposit).toHaveBeenCalledWith(DEPOSIT_ID);
  });

  it('refuses to complete another customer deposit', async () => {
    const { service, deposits, resolution } = fixture();
    deposits.getDeposit.mockResolvedValue({ id: DEPOSIT_ID, walletId: 'foreign-wallet' });
    resolution.assertOwnWalletAccount.mockRejectedValue(
      new ForbiddenException('The referenced financial account is not bound'),
    );

    await expect(service.completeDeposit(CUSTOMER_ID, DEPOSIT_ID)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deposits.completeDeposit).not.toHaveBeenCalled();
  });

  it('creates withdrawals against the bound WalletAccount and completes only own withdrawals', async () => {
    const { service, withdrawals, resolution } = fixture();
    withdrawals.createWithdrawal.mockResolvedValue({ id: WITHDRAWAL_ID });
    withdrawals.getWithdrawal.mockResolvedValue({
      id: WITHDRAWAL_ID,
      walletId: SOURCE_WALLET_ACCOUNT_ID,
    });
    withdrawals.completeWithdrawal.mockResolvedValue({ id: WITHDRAWAL_ID, status: 'COMPLETED' });

    await service.createWithdrawal({
      customerId: CUSTOMER_ID,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: 'wd-1',
      transactionPin: '4826',
    });
    expect(withdrawals.createWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: SOURCE_WALLET_ACCOUNT_ID }),
    );

    await service.completeWithdrawal(CUSTOMER_ID, WITHDRAWAL_ID);
    expect(resolution.assertOwnWalletAccount).toHaveBeenCalledWith(
      CUSTOMER_ID,
      SOURCE_WALLET_ACCOUNT_ID,
    );
    expect(withdrawals.completeWithdrawal).toHaveBeenCalledWith(WITHDRAWAL_ID);
  });

  it('verifies the transaction PIN before a transfer moves money', async () => {
    const { service, transfers, authorization } = fixture();
    transfers.createTransfer.mockResolvedValue({ id: 'transfer-pin-ok' });

    await service.createTransfer(transferCommand());

    expect(authorization.authorizeTransaction).toHaveBeenCalledWith(CUSTOMER_ID, '4826');
    expect(transfers.createTransfer).toHaveBeenCalled();
  });

  it('rejects the transfer before money movement when PIN authorization fails', async () => {
    const { service, transfers, authorization } = fixture();
    authorization.authorizeTransaction.mockRejectedValue(new UnauthorizedException('Invalid transaction PIN'));

    await expect(service.createTransfer(transferCommand())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(transfers.createTransfer).not.toHaveBeenCalled();
  });

  it('verifies the transaction PIN before a withdrawal is created', async () => {
    const { service, withdrawals, authorization } = fixture();
    withdrawals.createWithdrawal.mockResolvedValue({ id: WITHDRAWAL_ID });
    authorization.authorizeTransaction.mockRejectedValue(new ForbiddenException('Transaction PIN is locked'));

    await expect(
      service.createWithdrawal({
        customerId: CUSTOMER_ID,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: 'wd-locked',
        transactionPin: '4826',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorization.authorizeTransaction).toHaveBeenCalledWith(CUSTOMER_ID, '4826');
    expect(withdrawals.createWithdrawal).not.toHaveBeenCalled();
  });

  it('rejects withdrawals without a transaction PIN before any money movement', async () => {
    const { service, withdrawals, authorization } = fixture();

    await expect(
      service.createWithdrawal({
        customerId: CUSTOMER_ID,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: 'wd-nopin',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(authorization.authorizeTransaction).not.toHaveBeenCalled();
    expect(withdrawals.createWithdrawal).not.toHaveBeenCalled();
  });

  it('deposits do not require a transaction PIN', async () => {
    const { service, deposits, authorization } = fixture();
    deposits.createDeposit.mockResolvedValue({ id: DEPOSIT_ID });

    await service.createDeposit({
      customerId: CUSTOMER_ID,
      amountMinor: '1000',
      currency: 'NGN',
      idempotencyKey: 'dep-nopin',
    });

    expect(authorization.authorizeTransaction).not.toHaveBeenCalled();
    expect(deposits.createDeposit).toHaveBeenCalled();
  });
});
