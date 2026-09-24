import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { CustomerFinancialOperationsService } from '../src/customer-financial-operations/customer-financial-operations.service';
import { CustomerWallet } from '../src/customer-wallet/customer-wallet.entity';
import { CustomerWalletStatus } from '../src/customer-wallet/customer-wallet.enums';
import { CustomerReceivingNumber } from '../src/customer-wallet/customer-receiving-number.entity';
import type { CustomerWalletService } from '../src/customer-wallet/customer-wallet.service';
import { WalletProvisioningHistoryAction } from '../src/customer-wallet/customer-wallet.enums';
import { CustomerWalletType } from '../src/customer-wallet/customer-wallet.enums';
import { WalletProvisioningHistory } from '../src/customer-wallet/wallet-provisioning-history.entity';
import { Customer } from '../src/customer/customer.entity';
import { DepositStatus } from '../src/deposit/deposit.enums';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerEntryDirection } from '../src/ledger/ledger.enums';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import type { LedgerService } from '../src/ledger/ledger.service';
import { Transfer } from '../src/transfer/transfer.entity';
import { TransferStatus } from '../src/transfer/transfer.enums';
import type { TransferService } from '../src/transfer/transfer.service';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingState } from '../src/wallet/customer-financial-account-binding.enums';
import type { CustomerFinancialAccountBindingService } from '../src/wallet/customer-financial-account-binding.service';
import { CustomerFinancialAccountReadService } from '../src/wallet/customer-financial-account-read.service';
import type { CustomerFinancialAccountResolutionService } from '../src/wallet/customer-financial-account-resolution.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WithdrawalStatus } from '../src/withdrawal/withdrawal.enums';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import {
  createCustomerTransferStack,
  enableTransferPilot,
  seedFullyEligibleCustomer,
  admitToTransferPilot,
  selfPrincipal,
  type CustomerTransferStack,
} from './support/customer-transfer-stack';
import {
  seedTransactionPin,
  TEST_TRANSACTION_PIN,
  type TransactionPinStack,
} from './support/transaction-pin-harness';

/**
 * CustomerWallet -> CustomerFinancialAccountBinding -> WalletAccount -> LedgerAccount
 * wiring coverage against real PostgreSQL.
 *
 * Nothing is mocked: the full migration chain runs for the suite, the real
 * CustomerWallet provisioning lifecycle establishes the binding, and every
 * customer-facing financial operation resolves its WalletAccount through the
 * binding. This is the executable proof that the identity chain in the V1
 * specification works end to end.
 */
describe('CustomerWallet financial binding (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let stack: CustomerTransferStack;
  let ledger: LedgerService;
  let binding: CustomerFinancialAccountBindingService;
  let customerWallets: CustomerWalletService;
  let transfers: TransferService;
  let resolution: CustomerFinancialAccountResolutionService;
  let financialAccountRead: CustomerFinancialAccountReadService;
  let operations: CustomerFinancialOperationsService;
  let pinStack: TransactionPinStack;

  const customerPrincipal = (customerId: string): AuthorizationPrincipal => ({
    type: 'CUSTOMER',
    principalId: customerId,
    customerId,
    roles: [],
    scopes: [],
    customerAccess: 'SELF',
  });

  const servicePrincipal = (): AuthorizationPrincipal => ({
    type: 'SERVICE',
    principalId: 'integration-suite',
    roles: [],
    scopes: ['wallet:account-binding:write'],
    customerAccess: 'ANY',
  });

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('cfabinding');
    stack = createCustomerTransferStack(dataSource);
    ledger = stack.ledger;
    binding = stack.bindingService;
    customerWallets = stack.customerWallets;
    transfers = stack.transfers;
    resolution = stack.resolution;
    pinStack = stack.pinStack;
    operations = stack.operations;
    financialAccountRead = new CustomerFinancialAccountReadService(
      dataSource.getRepository(CustomerFinancialAccountBinding),
      dataSource.getRepository(Customer),
      dataSource.getRepository(CustomerWallet),
      dataSource.getRepository(WalletAccount),
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(CustomerReceivingNumber),
      ledger,
      stack.authorization,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await enableTransferPilot(stack);
    // Settlement account resolved by SettlementAccountService via code.
    await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Settlement asset',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
  });

  /** Seeds an ACTIVE individual customer with completed onboarding and eligibility. */
  async function seedEligibleCustomer(label: string): Promise<string> {
    const customerId = await seedFullyEligibleCustomer(stack, { label });
    // The A5 pilot control is deny-by-default per customer; the live gated
    // route requires cohort membership for every transacting customer.
    await admitToTransferPilot(stack, customerId);
    return customerId;
  }

  async function provisionActiveWallet(customerId: string) {
    return customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      status: CustomerWalletStatus.ACTIVE,
      actor: 'integration-harness',
    });
  }

  async function bindingRows(): Promise<CustomerFinancialAccountBinding[]> {
    return dataSource.getRepository(CustomerFinancialAccountBinding).find();
  }

  async function ledgerBalance(ledgerAccountId: string): Promise<bigint> {
    const balance = await ledger.getAccountBalance(ledgerAccountId);
    return BigInt(balance.balanceMinor);
  }

  it('1/2/3: provisions Customer -> CustomerWallet -> binding -> WalletAccount -> LedgerAccount atomically', async () => {
    const customerId = await seedEligibleCustomer('chain');

    const wallet = await provisionActiveWallet(customerId);

    const rows = await bindingRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.state).toBe(CustomerFinancialAccountBindingState.ACTIVE);
    expect(row.customerId).toBe(customerId);
    expect(row.customerWalletId).toBe(wallet.id);
    expect(row.currency).toBe('NGN');
    expect(row.accountingUnit).toBe('CUSTOMER_FUNDS');
    expect(row.sourceCustomerVersion).toBeGreaterThan(0);
    expect(row.sourceCustomerWalletVersion).toBeGreaterThan(0);

    // WalletAccount is the financial facade and is distinct from CustomerWallet.
    const walletAccount = await dataSource
      .getRepository(WalletAccount)
      .findOne({ where: { id: row.walletAccountId } });
    expect(walletAccount).not.toBeNull();
    expect(walletAccount!.id).not.toBe(wallet.id);
    expect(walletAccount!.status).toBe('ACTIVE');
    expect(walletAccount!.currency).toBe('NGN');

    // WalletAccount resolves to its intended LedgerAccount through the binding.
    expect(walletAccount!.ledgerAccountId).toBe(row.ledgerAccountId);
    const ledgerAccount = await dataSource
      .getRepository(LedgerAccount)
      .findOne({ where: { id: row.ledgerAccountId } });
    expect(ledgerAccount).not.toBeNull();
    expect(ledgerAccount!.accountType).toBe(LedgerAccountType.LIABILITY);
    expect(ledgerAccount!.normalBalance).toBe(LedgerNormalBalance.CREDIT);
    expect(ledgerAccount!.allowNegativeBalance).toBe(false);
    expect(ledgerAccount!.isActive).toBe(true);
    expect(ledgerAccount!.accountingUnit).toBe('CUSTOMER_FUNDS');

    // Provisioning history records the bound financial account.
    const history = await dataSource.getRepository(WalletProvisioningHistory).find();
    const provisioned = history.find(
      (entry) => entry.action === WalletProvisioningHistoryAction.PROVISIONED,
    );
    expect(provisioned?.metadata).toMatchObject({ financialAccountBindingId: row.id });
  });

  it('2 (lifecycle): a PENDING wallet is financially inert; activation binds exactly once', async () => {
    const customerId = await seedEligibleCustomer('lifecycle');
    const wallet = await customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      actor: 'integration-harness',
    });

    expect(wallet.status).toBe(CustomerWalletStatus.PENDING);
    expect(await bindingRows()).toHaveLength(0);
    expect(await dataSource.getRepository(WalletAccount).count()).toBe(0);

    // A pending binding-less wallet cannot move money.
    await expect(
      operations.createDeposit({
        customerId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: 'dep-pending-1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await customerWallets.updateWallet(customerId, wallet.id, {
      status: CustomerWalletStatus.ACTIVE,
      actor: 'integration-harness',
    });
    expect(await bindingRows()).toHaveLength(1);

    await customerWallets.updateWallet(customerId, wallet.id, {
      status: CustomerWalletStatus.SUSPENDED,
      actor: 'integration-harness',
    });
    await customerWallets.updateWallet(customerId, wallet.id, {
      status: CustomerWalletStatus.ACTIVE,
      actor: 'integration-harness',
    });
    const rows = await bindingRows();
    expect(rows).toHaveLength(1);
    expect(await dataSource.getRepository(WalletAccount).count()).toBe(1);
  });

  it('4/5/10: the authenticated customer resolves only their own financial account', async () => {
    const customerA = await seedEligibleCustomer('read-a');
    const customerB = await seedEligibleCustomer('read-b');
    await provisionActiveWallet(customerA);
    await provisionActiveWallet(customerB);

    const own = await financialAccountRead.getCustomerFinancialAccounts({
      customerId: customerA,
      principal: customerPrincipal(customerA),
    });
    expect(own.accounts).toHaveLength(1);
    expect(own.accounts[0]!.readState).toBe('ACTIVE');
    expect(own.accounts[0]!.customerId).toBe(customerA);
    expect(own.accounts[0]!.balanceMinor).toBe('0');

    // A customer principal cannot read another customer's binding (SELF scope).
    await expect(
      financialAccountRead.getCustomerFinancialAccounts({
        customerId: customerB,
        principal: customerPrincipal(customerA),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Resolution stays scope-safe at the command layer as well.
    const resolvedB = await resolution.resolveOwnActiveFinancialAccount(customerB, 'NGN');
    await expect(
      resolution.resolveOwnActiveBindingByCustomerWallet(
        customerA,
        resolvedB.binding.customerWalletId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('9/13/14: a customer transfer debits the own bound wallet and posts a balanced journal', async () => {
    const senderId = await seedEligibleCustomer('sender');
    await seedTransactionPin(pinStack, senderId);
    const recipientId = await seedEligibleCustomer('recipient');
    await provisionActiveWallet(senderId);
    await provisionActiveWallet(recipientId);

    const senderBinding = (await bindingRows()).find((row) => row.customerId === senderId)!;
    const recipientBinding = (await bindingRows()).find((row) => row.customerId === recipientId)!;

    // Fund the sender through the generic deposit lifecycle.
    const funding = await operations.createDeposit({
      customerId: senderId,
      amountMinor: '100000',
      currency: 'NGN',
      idempotencyKey: `fund-${randomUUID()}`,
      narration: 'initial funding',
    });
    await operations.completeDeposit(senderId, funding.id);
    expect(await ledgerBalance(senderBinding.ledgerAccountId)).toBe(100000n);

    const transfer = await operations.createTransfer({
      customerId: senderId,
      principal: selfPrincipal(senderId),
      destinationWalletId: recipientBinding.walletAccountId,
      amountMinor: '40000',
      currency: 'NGN',
      idempotencyKey: `transfer-${randomUUID()}`,
      transactionPin: TEST_TRANSACTION_PIN,
      narration: 'rent share',
    });

    expect(transfer.status).toBe(TransferStatus.COMPLETED);
    expect(transfer.sourceWalletId).toBe(senderBinding.walletAccountId);
    expect(transfer.destinationWalletId).toBe(recipientBinding.walletAccountId);
    expect(transfer.sourceWalletId).not.toBe(senderBinding.customerWalletId);

    expect(await ledgerBalance(senderBinding.ledgerAccountId)).toBe(60000n);
    expect(await ledgerBalance(recipientBinding.ledgerAccountId)).toBe(40000n);

    // The journal is balanced double-entry: one debit, one credit, equal amounts.
    expect(transfer.journalId).not.toBeNull();
    const lines = await dataSource.getRepository(LedgerLine).find({
      where: { journalId: transfer.journalId! },
    });
    expect(lines).toHaveLength(2);
    const debits = lines.filter((line) => line.direction === LedgerEntryDirection.DEBIT);
    const credits = lines.filter((line) => line.direction === LedgerEntryDirection.CREDIT);
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);
    expect(BigInt(debits[0]!.amountMinor)).toBe(40000n);
    expect(BigInt(credits[0]!.amountMinor)).toBe(40000n);
    expect(debits[0]!.ledgerAccountId).toBe(senderBinding.ledgerAccountId);
    expect(credits[0]!.ledgerAccountId).toBe(recipientBinding.ledgerAccountId);
  });

  it('6/7/8: foreign identifiers and CustomerWallet identifiers are rejected, fail closed', async () => {
    const customerA = await seedEligibleCustomer('safe-a');
    const customerB = await seedEligibleCustomer('safe-b');
    await provisionActiveWallet(customerA);
    await provisionActiveWallet(customerB);
    const rows = await bindingRows();
    const bindingB = rows.find((row) => row.customerId === customerB)!;

    // (8) CustomerWallet.id substituted for a WalletAccount.id is not a
    // financial account and is rejected outright.
    await expect(
      operations.createTransfer({
        customerId: customerA,
        principal: selfPrincipal(customerA),
        destinationWalletId: bindingB.customerWalletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `transfer-subst-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // (6) A customer cannot transact through another customer's CustomerWallet.
    await expect(
      operations.getTransactions({
        customerId: customerA,
        customerWalletId: bindingB.customerWalletId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // (7) A customer cannot complete another customer's deposit.
    const foreignFunding = await operations.createDeposit({
      customerId: customerB,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `foreign-fund-${randomUUID()}`,
    });
    await expect(operations.completeDeposit(customerA, foreignFunding.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // Non-NGN customer operations are outside V1.
    await expect(
      operations.createTransfer({
        customerId: customerA,
        principal: selfPrincipal(customerA),
        destinationWalletId: bindingB.walletAccountId,
        amountMinor: '1000',
        currency: 'USD',
        idempotencyKey: `transfer-usd-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The binding state is untouched by all rejected attempts.
    expect(await bindingRows()).toHaveLength(2);
  });

  it('11: duplicate active bindings are rejected; activating a second wallet for the same currency fails', async () => {
    const customerId = await seedEligibleCustomer('dup');
    await provisionActiveWallet(customerId);
    const existing = (await bindingRows())[0]!;

    // Direct re-bind of the same CustomerWallet.
    await expect(
      binding.bind({
        mode: 'PROVISION_NEW' as never,
        customerId,
        customerWalletId: existing.customerWalletId,
        currency: 'NGN',
        idempotencyKey: `dup-bind-${randomUUID()}`,
        principal: servicePrincipal(),
        requestContext: {
          requestId: 'dup-bind-req',
          correlationId: 'dup-bind-corr',
          traceId: 'dup-bind-trace',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await bindingRows()).toHaveLength(1);

    // A second CustomerWallet cannot be activated: one active binding per
    // customer and currency, enforced at the database boundary.
    const second = await customerWallets.createWallet(customerId, {
      type: CustomerWalletType.SAVINGS,
      currency: 'NGN',
      actor: 'integration-harness',
    });
    await expect(
      customerWallets.updateWallet(customerId, second.id, {
        status: CustomerWalletStatus.ACTIVE,
        actor: 'integration-harness',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const stillSecond = await customerWallets.getWallet(customerId, second.id);
    expect(stillSecond.status).toBe(CustomerWalletStatus.PENDING);
    expect(await bindingRows()).toHaveLength(1);
    expect(await dataSource.getRepository(WalletAccount).count()).toBe(1);
  });

  it('12: concurrent activation cannot create duplicate bindings', async () => {
    const customerId = await seedEligibleCustomer('race');
    const wallet = await customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      actor: 'integration-harness',
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        customerWallets.updateWallet(customerId, wallet.id, {
          status: CustomerWalletStatus.ACTIVE,
          actor: 'integration-harness',
        }),
      ),
    );

    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const failure of rejected) {
      if (failure.status !== 'rejected') continue;
      expect(failure.reason).toBeInstanceOf(HttpException);
      expect([409, 500]).toContain((failure.reason as HttpException).getStatus());
    }
    expect(await bindingRows()).toHaveLength(1);
    expect(await dataSource.getRepository(WalletAccount).count()).toBe(1);

    const active = await customerWallets.getWallet(customerId, wallet.id);
    expect(active.status).toBe(CustomerWalletStatus.ACTIVE);
  });

  it('15: transfer idempotency replay returns the original result without moving value twice', async () => {
    // The step-up PIN is seeded for the sender; replay still returns the original result.
    const senderId = await seedEligibleCustomer('idem-a');
    await seedTransactionPin(pinStack, senderId);
    const recipientId = await seedEligibleCustomer('idem-b');
    await provisionActiveWallet(senderId);
    await provisionActiveWallet(recipientId);
    const rows = await bindingRows();
    const sender = rows.find((row) => row.customerId === senderId)!;
    const recipient = rows.find((row) => row.customerId === recipientId)!;

    const funding = await operations.createDeposit({
      customerId: senderId,
      amountMinor: '50000',
      currency: 'NGN',
      idempotencyKey: `fund-${randomUUID()}`,
    });
    await operations.completeDeposit(senderId, funding.id);

    const idempotencyKey = `transfer-idem-${randomUUID()}`;
    const first = await operations.createTransfer({
      customerId: senderId,
      principal: selfPrincipal(senderId),
      destinationWalletId: recipient.walletAccountId,
      amountMinor: '12000',
      currency: 'NGN',
      idempotencyKey,
      transactionPin: TEST_TRANSACTION_PIN,
    });
    const replay = await operations.createTransfer({
      customerId: senderId,
      principal: selfPrincipal(senderId),
      destinationWalletId: recipient.walletAccountId,
      amountMinor: '12000',
      currency: 'NGN',
      idempotencyKey,
      transactionPin: TEST_TRANSACTION_PIN,
    });

    expect(replay.id).toBe(first.id);
    expect(await ledgerBalance(sender.ledgerAccountId)).toBe(38000n);
    expect(await ledgerBalance(recipient.ledgerAccountId)).toBe(12000n);
    expect(await dataSource.getRepository(Transfer).count()).toBe(1);
  });

  it('16/17/18: deposit, withdrawal and legacy transfer flows keep working through the binding', async () => {
    const customerA = await seedEligibleCustomer('flows-a');
    await seedTransactionPin(pinStack, customerA);
    const customerB = await seedEligibleCustomer('flows-b');
    await provisionActiveWallet(customerA);
    await provisionActiveWallet(customerB);
    const rows = await bindingRows();
    const bindingA = rows.find((row) => row.customerId === customerA)!;
    const bindingB = rows.find((row) => row.customerId === customerB)!;

    // Deposit lifecycle through the customer-facing operations.
    const deposit = await operations.createDeposit({
      customerId: customerA,
      amountMinor: '75000',
      currency: 'NGN',
      idempotencyKey: `dep-${randomUUID()}`,
    });
    expect(deposit.status).toBe(DepositStatus.PENDING);
    const completedDeposit = await operations.completeDeposit(customerA, deposit.id);
    expect(completedDeposit.status).toBe(DepositStatus.COMPLETED);
    expect(await ledgerBalance(bindingA.ledgerAccountId)).toBe(75000n);

    // Withdrawal lifecycle through the customer-facing operations.
    const withdrawal = await operations.createWithdrawal({
      customerId: customerA,
      amountMinor: '20000',
      currency: 'NGN',
      idempotencyKey: `wd-${randomUUID()}`,
      transactionPin: TEST_TRANSACTION_PIN,
    });
    expect(withdrawal.status).toBe(WithdrawalStatus.PENDING);
    await operations.processWithdrawal(customerA, withdrawal.id);
    const completedWithdrawal = await operations.completeWithdrawal(customerA, withdrawal.id);
    expect(completedWithdrawal.status).toBe(WithdrawalStatus.COMPLETED);
    expect(await ledgerBalance(bindingA.ledgerAccountId)).toBe(55000n);

    // (16) The legacy internal TransferService path is unchanged and keeps working
    // on genuine WalletAccount identifiers (operator/tooling surface).
    const legacy = await transfers.createTransfer({
      sourceWalletId: bindingA.walletAccountId,
      destinationWalletId: bindingB.walletAccountId,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `legacy-${randomUUID()}`,
    });
    expect(legacy.status).toBe(TransferStatus.COMPLETED);
    expect(await ledgerBalance(bindingA.ledgerAccountId)).toBe(50000n);
    expect(await ledgerBalance(bindingB.ledgerAccountId)).toBe(5000n);
  });

  it('invariants: no overdraft, failed transfer leaves balances untouched', async () => {
    const senderId = await seedEligibleCustomer('poor-a');
    await seedTransactionPin(pinStack, senderId);
    const recipientId = await seedEligibleCustomer('poor-b');
    await provisionActiveWallet(senderId);
    await provisionActiveWallet(recipientId);
    const rows = await bindingRows();
    const sender = rows.find((row) => row.customerId === senderId)!;
    const recipient = rows.find((row) => row.customerId === recipientId)!;

    const funding = await operations.createDeposit({
      customerId: senderId,
      amountMinor: '10000',
      currency: 'NGN',
      idempotencyKey: `fund-${randomUUID()}`,
    });
    await operations.completeDeposit(senderId, funding.id);

    await expect(
      operations.createTransfer({
        customerId: senderId,
        principal: selfPrincipal(senderId),
        destinationWalletId: recipient.walletAccountId,
        amountMinor: '99999999',
        currency: 'NGN',
        idempotencyKey: `overdraft-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(HttpException);

    expect(await ledgerBalance(sender.ledgerAccountId)).toBe(10000n);
    expect(await ledgerBalance(recipient.ledgerAccountId)).toBe(0n);

    // The failure is recorded on the transfer, not silently swallowed.
    const failed = await dataSource.getRepository(Transfer).find();
    expect(failed).toHaveLength(1);
    expect(failed[0]!.status).toBe(TransferStatus.FAILED);
    expect(failed[0]!.failureCode).toBe('INSUFFICIENT_FUNDS');
  });
});
