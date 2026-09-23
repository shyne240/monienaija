import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { IdempotencyRecordStatus } from '../src/operations/operations.enums';
import type { IdempotencyService } from '../src/operations/idempotency.service';
import type { CustomerFinancialAccountResolutionService } from '../src/wallet/customer-financial-account-resolution.service';
import type { CustomerRecipientResolutionService } from '../src/wallet/customer-recipient-resolution.service';
import {
  CustomerTransferDestinationType,
  type CustomerTransferCommand,
} from '../src/customer-financial-operations/customer-financial-operations.types';
import { CustomerFinancialOperationsService } from '../src/customer-financial-operations/customer-financial-operations.service';
import type { InternalTransferGateService } from '../src/transfer/internal-transfer-gate.service';
import type { TransferLifecycleService } from '../src/transfer/transfer-lifecycle.service';
import { TransferStatus } from '../src/transfer/transfer.enums';
import type { CustomerTransactionAuthorizationService } from '../src/customer-financial-operations/customer-transaction-authorization.service';
import type { DepositService } from '../src/deposit/deposit.service';
import type { TransferService } from '../src/transfer/transfer.service';
import type { WithdrawalService } from '../src/withdrawal/withdrawal.service';

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_CUSTOMER_ID = '00000000-0000-4000-8000-000000000002';
const CUSTOMER_WALLET_ID = '00000000-0000-4000-8000-000000000003';
const SOURCE_WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-000000000004';
const DESTINATION_WALLET_ACCOUNT_ID = '00000000-0000-4000-8000-00000000000b';
const DEPOSIT_ID = '00000000-0000-4000-8000-000000000005';
const WITHDRAWAL_ID = '00000000-0000-4000-8000-000000000006';
const TRANSFER_ID = '00000000-0000-4000-8000-000000000007';

describe('CustomerFinancialOperationsService', () => {
  function sourceBinding() {
    return {
      customerId: CUSTOMER_ID,
      customerWalletId: CUSTOMER_WALLET_ID,
      walletAccountId: SOURCE_WALLET_ACCOUNT_ID,
      currency: 'NGN',
    };
  }

  function destinationBinding() {
    return {
      customerId: OTHER_CUSTOMER_ID,
      customerWalletId: '00000000-0000-4000-8000-00000000000c',
      walletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      currency: 'NGN',
    };
  }

  function transferCommand(
    overrides: Partial<CustomerTransferCommand> = {},
  ): CustomerTransferCommand {
    return {
      customerId: CUSTOMER_ID,
      principal: {
        type: 'CUSTOMER',
        principalId: CUSTOMER_ID,
        customerId: CUSTOMER_ID,
        roles: [],
        scopes: [],
        customerAccess: 'SELF',
      },
      destinationWalletId: DESTINATION_WALLET_ACCOUNT_ID,
      amountMinor: '25000',
      currency: 'NGN',
      idempotencyKey: 'customer-transfer-test-1',
      transactionPin: '4826',
      narration: 'Unit test transfer',
      ...overrides,
    };
  }

  function gateResult() {
    return {
      commandId: 'unit-command-id',
      requestHash: 'unit-request-hash',
      sourceCustomerId: CUSTOMER_ID,
      destinationCustomerId: OTHER_CUSTOMER_ID,
      sourceWalletAccountId: SOURCE_WALLET_ACCOUNT_ID,
      destinationWalletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      sourceLedgerAccountId: '00000000-0000-4000-8000-00000000000e',
      destinationLedgerAccountId: '00000000-0000-4000-8000-00000000000d',
      amountMinor: '25000',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      sourceBinding: { bindingId: '00000000-0000-4000-8000-000000000008', bindingVersion: 1 },
      destinationBinding: { bindingId: '00000000-0000-4000-8000-000000000009', bindingVersion: 1 },
      policy: {
        decisionReference: 'policy-decision:unit',
        policyVersion: 'a4.profile.wallet-transfer-create.v1',
        profileReference: 'profile.wallet-transfer-create.v1',
        profileVersion: 1,
        evidenceSnapshotReference: 'policy-snapshot:unit',
        normalizedInputHash: 'unit-input-hash',
      },
      evidence: { snapshotReference: 'policy-snapshot:unit' },
      replayed: false,
    };
  }

  function lifecycleView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: TRANSFER_ID,
      sourceWalletAccountId: SOURCE_WALLET_ACCOUNT_ID,
      destinationWalletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      amountMinor: '25000',
      currency: 'NGN',
      idempotencyKey: 'wallet.transfer.create.internal.v1:unit-command-id',
      reference: null,
      narration: 'Unit test transfer',
      status: 'COMPLETED',
      stateReason: 'LEDGER_POSTED',
      failureCode: null,
      failureMessage: null,
      failureStatusCode: null,
      journalId: '00000000-0000-4000-8000-00000000000f',
      paymentReference: 'PAY-UNIT',
      policyDecisionReference: 'policy-decision:unit',
      policySnapshotReference: 'policy-snapshot:unit',
      createdAt: new Date('2026-09-23T00:00:00.000Z'),
      completedAt: new Date('2026-09-23T00:00:00.000Z'),
      ...overrides,
    };
  }

  function fixture() {
    const resolution = {
      resolveOwnActiveFinancialAccount: jest.fn().mockResolvedValue({
        binding: {
          ...sourceBinding(),
          id: '00000000-0000-4000-8000-000000000008',
          ledgerAccountId: '00000000-0000-4000-8000-00000000000e',
          accountingUnit: 'CUSTOMER_FUNDS',
          version: 1,
        },
        walletAccount: { id: SOURCE_WALLET_ACCOUNT_ID },
      }),
      resolveActiveDestinationAccount: jest.fn().mockResolvedValue({
        ...destinationBinding(),
        id: '00000000-0000-4000-8000-000000000009',
        ledgerAccountId: '00000000-0000-4000-8000-00000000000d',
        accountingUnit: 'CUSTOMER_FUNDS',
        version: 1,
      }),
      resolveOwnActiveBindingByCustomerWallet: jest.fn().mockResolvedValue(sourceBinding()),
      assertOwnWalletAccount: jest.fn().mockResolvedValue(undefined),
    };
    const transfers = {
      createTransfer: jest.fn(),
      getWalletTransactions: jest.fn(),
      getTransfer: jest.fn(),
    };
    const deposits = {
      createDeposit: jest.fn(),
      completeDeposit: jest.fn(),
      getDeposit: jest.fn(),
    };
    const withdrawals = {
      createWithdrawal: jest.fn(),
      processWithdrawal: jest.fn(),
      completeWithdrawal: jest.fn(),
      getWithdrawal: jest.fn(),
    };
    const recipientResolution = {
      resolveByReceivingNumber: jest.fn(),
      resolveByPhone: jest.fn(),
    };
    const authorization = {
      authorizeTransaction: jest.fn().mockResolvedValue({
        authenticationReference: 'auth-unit',
        authenticationAt: '2026-09-23T00:00:00.000Z',
        assurance: 'LEVEL_2',
      }),
    };
    const gate = {
      validate: jest.fn().mockResolvedValue(gateResult()),
    };
    const lifecycle = {
      createPending: jest.fn().mockResolvedValue({ id: TRANSFER_ID }),
      transition: jest.fn().mockResolvedValue({ id: TRANSFER_ID, status: 'PROCESSING' }),
      postToLedger: jest.fn().mockResolvedValue(lifecycleView()),
    };
    const idempotency = {
      reserve: jest.fn().mockResolvedValue({ kind: 'NEW', record: { id: 'idem-1' } }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn((fn: (manager: object) => Promise<unknown>) => fn({})),
      query: jest
        .fn()
        .mockImplementation((sql: string): Promise<Array<Record<string, string>>> => {
          if (sql.includes('FROM transfers')) {
            return Promise.resolve([{ day_count: '0', day_amount: '0', month_amount: '0' }]);
          }
          return Promise.resolve([]);
        }),
    };
    const service = new CustomerFinancialOperationsService(
      resolution as unknown as CustomerFinancialAccountResolutionService,
      transfers as unknown as TransferService,
      deposits as unknown as DepositService,
      withdrawals as unknown as WithdrawalService,
      recipientResolution as unknown as CustomerRecipientResolutionService,
      authorization as unknown as CustomerTransactionAuthorizationService,
      gate as unknown as InternalTransferGateService,
      lifecycle as unknown as TransferLifecycleService,
      idempotency as unknown as IdempotencyService,
      dataSource as unknown as DataSource,
    );
    return {
      service,
      resolution,
      transfers,
      deposits,
      withdrawals,
      recipientResolution,
      authorization,
      gate,
      lifecycle,
      idempotency,
      dataSource,
    };
  }

  it('rejects ambiguous or missing transfer destinations', async () => {
    const { service, gate } = fixture();
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
    expect(gate.validate).not.toHaveBeenCalled();
  });

  it('resolves a MonieNaija number destination server-side to a WalletAccount', async () => {
    const { service, gate, recipientResolution, transfers } = fixture();
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

    const rest = { ...transferCommand() };
    delete (rest as Partial<CustomerTransferCommand>).destinationWalletId;
    const view = await service.createTransfer({
      ...rest,
      destination: {
        type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
        value: '7065111760',
      },
    } as CustomerTransferCommand);

    expect(recipientResolution.resolveByReceivingNumber).toHaveBeenCalledWith('7065111760');
    expect(gate.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationWalletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      }),
    );
    expect(transfers.createTransfer).not.toHaveBeenCalled();
    expect(view.status).toBe('COMPLETED');
  });

  it('resolves a phone destination and rejects destination == own phone or number', async () => {
    const { service, recipientResolution, gate } = fixture();
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
    expect(gate.validate).not.toHaveBeenCalled();
  });

  it('drives a customer transfer through the gate and lifecycle, never TransferService.createTransfer directly', async () => {
    const { service, gate, lifecycle, resolution, transfers } = fixture();

    const view = await service.createTransfer(transferCommand());

    expect(resolution.resolveOwnActiveFinancialAccount).toHaveBeenCalledWith(CUSTOMER_ID, 'NGN');
    expect(gate.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceCustomerId: CUSTOMER_ID,
        principal: expect.objectContaining({ customerId: CUSTOMER_ID }) as unknown,
        amountMinor: '25000',
        sourceWalletAccountId: SOURCE_WALLET_ACCOUNT_ID,
        destinationWalletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      }),
    );
    expect(lifecycle.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: '25000',
        sourceWalletAccountId: SOURCE_WALLET_ACCOUNT_ID,
        destinationWalletAccountId: DESTINATION_WALLET_ACCOUNT_ID,
      }),
    );
    expect(lifecycle.transition).toHaveBeenCalledWith(
      TRANSFER_ID,
      expect.objectContaining({ nextStatus: TransferStatus.PROCESSING }),
    );
    expect(lifecycle.postToLedger).toHaveBeenCalledWith(
      TRANSFER_ID,
      expect.objectContaining({
        idempotencyKey: expect.stringContaining('ledger-post:') as unknown,
      }),
    );
    expect(transfers.createTransfer).not.toHaveBeenCalled();
    expect(view.status).toBe('COMPLETED');
    expect(view.journalId).toBe('00000000-0000-4000-8000-00000000000f');
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
    resolution.resolveActiveDestinationAccount.mockResolvedValue({
      ...sourceBinding(),
      customerId: CUSTOMER_ID,
    });

    await expect(service.createTransfer(transferCommand())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('propagates destination resolution failures (foreign or CustomerWallet identifiers)', async () => {
    const { service, resolution, gate, lifecycle } = fixture();
    resolution.resolveActiveDestinationAccount.mockRejectedValue(
      new NotFoundException('The destination is not a registered MonieNaija financial account'),
    );

    await expect(
      service.createTransfer(transferCommand({ destinationWalletId: CUSTOMER_WALLET_ID })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(gate.validate).not.toHaveBeenCalled();
    expect(lifecycle.createPending).not.toHaveBeenCalled();
  });

  it('rejects a principal that does not own the customerId route parameter', async () => {
    const { service, resolution, authorization } = fixture();

    await expect(
      service.createTransfer(
        transferCommand({
          principal: {
            type: 'CUSTOMER',
            principalId: OTHER_CUSTOMER_ID,
            customerId: OTHER_CUSTOMER_ID,
            roles: [],
            scopes: [],
            customerAccess: 'SELF',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(resolution.resolveOwnActiveFinancialAccount).not.toHaveBeenCalled();
    expect(authorization.authorizeTransaction).not.toHaveBeenCalled();
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

  it('verifies the transaction PIN before gate validation and ledger posting', async () => {
    const { service, authorization, gate, lifecycle } = fixture();

    await service.createTransfer(transferCommand());

    expect(authorization.authorizeTransaction).toHaveBeenCalledWith(CUSTOMER_ID, '4826');
    const pinOrder = authorization.authorizeTransaction.mock.invocationCallOrder[0]!;
    const gateOrder = gate.validate.mock.invocationCallOrder[0]!;
    const ledgerOrder = lifecycle.postToLedger.mock.invocationCallOrder[0]!;
    expect(pinOrder).toBeLessThan(gateOrder);
    expect(gateOrder).toBeLessThan(ledgerOrder);
  });

  it('rejects the transfer before the gate when PIN authorization fails', async () => {
    const { service, authorization, gate, lifecycle } = fixture();
    authorization.authorizeTransaction.mockRejectedValue(
      new UnauthorizedException('Invalid transaction PIN'),
    );

    await expect(service.createTransfer(transferCommand())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(gate.validate).not.toHaveBeenCalled();
    expect(lifecycle.createPending).not.toHaveBeenCalled();
  });

  it('requires a transaction PIN for transfers before anything else happens', async () => {
    const { service, authorization, gate } = fixture();
    const rest = { ...transferCommand() };
    delete (rest as Partial<CustomerTransferCommand>).transactionPin;

    await expect(service.createTransfer(rest as CustomerTransferCommand)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(authorization.authorizeTransaction).not.toHaveBeenCalled();
    expect(gate.validate).not.toHaveBeenCalled();
  });

  it('propagates gate failures without creating any lifecycle record', async () => {
    const { service, gate, lifecycle } = fixture();
    gate.validate.mockRejectedValue(new ConflictException('limit exceeded'));

    await expect(service.createTransfer(transferCommand())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(lifecycle.createPending).not.toHaveBeenCalled();
    expect(lifecycle.postToLedger).not.toHaveBeenCalled();
  });

  it('marks post-admission lifecycle failures as FAILED (never an inconsistent partial state)', async () => {
    const { service, gate, lifecycle, idempotency } = fixture();
    lifecycle.postToLedger.mockResolvedValue(
      lifecycleView({
        status: 'FAILED',
        stateReason: 'DESTINATION_INACTIVE',
        failureCode: 'A3_BINDING_INACTIVE',
        failureMessage: 'Destination financial account is not active',
        failureStatusCode: 409,
        journalId: null,
        paymentReference: null,
        completedAt: null,
      }),
    );

    const error: unknown = await service
      .createTransfer(transferCommand())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(409);
    expect(gate.validate).toHaveBeenCalled();
    expect(lifecycle.postToLedger).toHaveBeenCalled();
    expect(idempotency.fail).toHaveBeenCalled();
  });

  it('rejects idempotency-key reuse with a different request payload', async () => {
    const { service, idempotency, gate } = fixture();
    idempotency.reserve.mockRejectedValue(
      new ConflictException('The idempotency key was already used for another request'),
    );

    await expect(service.createTransfer(transferCommand())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(gate.validate).not.toHaveBeenCalled();
  });

  it('replays an already-completed transfer from the idempotency store without re-execution', async () => {
    const { service, idempotency, gate, lifecycle } = fixture();
    idempotency.reserve.mockResolvedValue({
      kind: 'REPLAY',
      record: {
        id: 'idem-replay',
        status: IdempotencyRecordStatus.COMPLETED,
        responseStatusCode: 201,
        responseBody: lifecycleView(),
      },
    });

    const view = await service.createTransfer(transferCommand());

    expect(gate.validate).not.toHaveBeenCalled();
    expect(lifecycle.createPending).not.toHaveBeenCalled();
    expect(lifecycle.postToLedger).not.toHaveBeenCalled();
    expect(view.id).toBe(TRANSFER_ID);
    expect(view.status).toBe('COMPLETED');
  });

  it('verifies the transaction PIN before a withdrawal is created', async () => {
    const { service, withdrawals, authorization } = fixture();
    withdrawals.createWithdrawal.mockResolvedValue({ id: WITHDRAWAL_ID });
    authorization.authorizeTransaction.mockRejectedValue(
      new ForbiddenException('Transaction PIN is locked'),
    );

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
