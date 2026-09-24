import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../src/authorization/authorization.types';
import type { CustomerReceivingNumberService } from '../src/customer-wallet/customer-receiving-number.service';
import type { CustomerFinancialOperationsService } from '../src/customer-financial-operations/customer-financial-operations.service';
import { CustomerTransferDestinationType } from '../src/customer-financial-operations/customer-financial-operations.types';
import { CustomerReceivingNumber } from '../src/customer-wallet/customer-receiving-number.entity';
import { CustomerReceivingNumberStatus } from '../src/customer-wallet/customer-receiving-number.enums';
import { Customer } from '../src/customer/customer.entity';
import { CustomerAddress } from '../src/customer/customer-address.entity';
import { CustomerContactMethod } from '../src/customer/customer-contact-method.entity';
import { CustomerIdentityDocument } from '../src/customer/customer-identity-document.entity';
import { CustomerKycAssessment } from '../src/customer/customer-kyc-assessment.entity';
import { CustomerProfile } from '../src/customer/customer-profile.entity';
import { ContactMethodType, CustomerStatus, CustomerType } from '../src/customer/customer.enums';
import { CustomerService } from '../src/customer/customer.service';
import { CustomerWallet } from '../src/customer-wallet/customer-wallet.entity';
import {
  CustomerWalletStatus,
  CustomerWalletType,
  WalletProvisioningHistoryAction,
} from '../src/customer-wallet/customer-wallet.enums';
import type { CustomerWalletService } from '../src/customer-wallet/customer-wallet.service';
import { WalletProvisioningHistory } from '../src/customer-wallet/wallet-provisioning-history.entity';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import type { LedgerService } from '../src/ledger/ledger.service';
import { TransferStatus } from '../src/transfer/transfer.enums';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountReadService } from '../src/wallet/customer-financial-account-read.service';
import {
  CustomerRecipientLookupMode,
  toPublicRecipientView,
} from '../src/wallet/customer-recipient-resolution.types';
import type { CustomerRecipientResolutionService } from '../src/wallet/customer-recipient-resolution.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
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
 * Canonical Nigerian phone + primary MonieNaija receiving number wiring
 * against real PostgreSQL. Covers task points 1-33: canonicalization,
 * system-issued numbers at the wallet-activation lifecycle, per-table
 * uniqueness under concurrency, fail-closed recipient resolution by number
 * and phone, and transfers with typed receiving-number/phone destinations
 * that still execute through the audited transfer service.
 */
describe('Canonical phone + MonieNaija receiving number (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let stack: CustomerTransferStack;
  let ledger: LedgerService;
  let customerWallets: CustomerWalletService;
  let customers: CustomerService;
  let recipientResolution: CustomerRecipientResolutionService;
  let financialAccountRead: CustomerFinancialAccountReadService;
  let receivingNumbers: CustomerReceivingNumberService;
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

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('mnnumber');
    stack = createCustomerTransferStack(dataSource);
    ledger = stack.ledger;
    customerWallets = stack.customerWallets;
    receivingNumbers = stack.receivingNumbers;
    recipientResolution = stack.recipientResolution;
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
    customers = new CustomerService(
      dataSource.getRepository(Customer),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(CustomerAddress),
      dataSource.getRepository(CustomerContactMethod),
      dataSource.getRepository(CustomerIdentityDocument),
      dataSource.getRepository(CustomerKycAssessment),
      dataSource,
      stack.audit,
      receivingNumbers,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    await enableTransferPilot(stack);
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

  /** Seeds an ACTIVE individual customer with completed onboarding + eligibility. */
  async function seedEligibleCustomer(label: string): Promise<string> {
    const customerId = await seedFullyEligibleCustomer(stack, { label });
    // The A5 pilot control is deny-by-default per customer; the live gated
    // route requires cohort membership for every transacting customer.
    await admitToTransferPilot(stack, customerId);
    return customerId;
  }

  /** Registers a canonical phone through the real contact-method API. */
  async function addPhone(customerId: string, rawPhone: string, label?: string) {
    return customers.createContactMethod(customerId, {
      type: ContactMethodType.PHONE,
      value: rawPhone,
      isPrimary: true,
      actor: label ?? 'integration-harness',
    });
  }

  async function provisionActiveWallet(customerId: string) {
    return customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      status: CustomerWalletStatus.ACTIVE,
      actor: 'integration-harness',
    });
  }

  async function fundCustomer(customerId: string, amountMinor: string): Promise<void> {
    const deposit = await operations.createDeposit({
      customerId,
      amountMinor,
      currency: 'NGN',
      idempotencyKey: `dep-${randomUUID()}`,
    });
    await operations.completeDeposit(customerId, deposit.id);
  }

  async function activeNumberForWallet(walletId: string) {
    return dataSource.getRepository(CustomerReceivingNumber).findOne({
      where: { walletId, status: CustomerReceivingNumberStatus.ACTIVE },
    });
  }

  async function bindingForWallet(walletId: string) {
    return dataSource.getRepository(CustomerFinancialAccountBinding).findOne({
      where: { customerWalletId: walletId },
    });
  }

  async function ledgerBalance(ledgerAccountId: string): Promise<bigint> {
    const balance = await ledger.getAccountBalance(ledgerAccountId);
    return BigInt(balance.balanceMinor);
  }

  it('PHONE 1-3: 07065111760, 2347065111760 and +2347065111760 canonicalize to ONE representation', async () => {
    const customerId = await seedEligibleCustomer('canon');
    const contact = await addPhone(customerId, '07065111760');
    expect(contact.normalizedValue).toBe('+2347065111760');
    expect(contact.value).toBe('+2347065111760');

    // Identity invariant: every other representation of the same number lands
    // on the SAME canonical value and is therefore a uniqueness conflict (for
    // this customer and for any other customer).
    for (const raw of ['2347065111760', '+2347065111760', '070 6511 1760']) {
      await expect(addPhone(customerId, raw)).rejects.toBeInstanceOf(ConflictException);
    }
    const other = await seedEligibleCustomer('canon-other');
    await expect(addPhone(other, '+2347065111760')).rejects.toBeInstanceOf(ConflictException);
  });

  it('PHONE 4: duplicate representations cannot create duplicate phone identities', async () => {
    const a = await seedEligibleCustomer('dup-a');
    await addPhone(a, '07065111760');

    // Same customer, different representation: conflict.
    await expect(addPhone(a, '+2347065111760')).rejects.toBeInstanceOf(ConflictException);

    // Different customer, equivalent representation: conflict (global uniqueness).
    const b = await seedEligibleCustomer('dup-b');
    await expect(addPhone(b, '2347065111760')).rejects.toBeInstanceOf(ConflictException);
  });

  it('PHONE 5/6: invalid Nigerian phones rejected; generic non-Nigerian contact preserved', async () => {
    const customerId = await seedEligibleCustomer('invalids');
    for (const raw of [
      '07065111761x', // malformed
      '07065111', // too short
      '06098765432', // non-mobile Nigerian prefix
      '014632011', // Lagos landline shape
    ]) {
      await expect(addPhone(customerId, raw)).rejects.toBeInstanceOf(BadRequestException);
    }
    // Non-Nigerian international input still follows the generic rule.
    const generic = await addPhone(customerId, '+14155552671');
    expect(generic.normalizedValue).toBe('+14155552671');
  });

  it('REG 22: registration phone becomes a canonical contact atomically (create rolls back on bad phone)', async () => {
    const ok = await customers.create({
      reference: `mn-reg-${randomUUID().slice(0, 8)}`,
      type: CustomerType.INDIVIDUAL,
      status: CustomerStatus.ACTIVE,
      actor: 'integration-harness',
      phone: '0803 611 2619',
    });
    const contacts = await customers.listContactMethods(ok.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.normalizedValue).toBe('+2348036112619');
    expect(contacts[0]!.isPrimary).toBe(true);

    await expect(
      customers.create({
        reference: `mn-reg-bad-${randomUUID().slice(0, 8)}`,
        type: CustomerType.INDIVIDUAL,
        status: CustomerStatus.ACTIVE,
        actor: 'integration-harness',
        phone: '06098765432',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await dataSource.getRepository(Customer).count()).toBe(1);
  });

  it('NUM 7/8/10/12: activation issues the 10-digit deterministic number atomically with history + read model', async () => {
    const customerId = await seedEligibleCustomer('issue');
    await addPhone(customerId, '07065111760');
    const wallet = await provisionActiveWallet(customerId);

    const row = await activeNumberForWallet(wallet.id);
    expect(row).not.toBeNull();
    expect(row!.number).toBe('7065111760');
    expect(row!.number).toMatch(/^\d{10}$/);
    expect(row!.derivedFromPhone).toBe('+2347065111760');
    expect(row!.customerId).toBe(customerId);
    expect(row!.walletId).toBe(wallet.id);

    // Identity distinction preserved: the number is neither a wallet,
    // wallet-account, ledger-account, binding, nor customer identifier.
    const binding = await bindingForWallet(wallet.id);
    expect(row!.number).not.toBe(wallet.id);
    expect(row!.number).not.toBe(binding!.walletAccountId);
    expect(row!.number).not.toBe(binding!.ledgerAccountId);
    expect(row!.number).not.toBe(customerId);

    const history = await dataSource.getRepository(WalletProvisioningHistory).find();
    expect(
      history.some(
        (entry) =>
          entry.action === WalletProvisioningHistoryAction.RECEIVING_NUMBER_ISSUED &&
          (entry.metadata as { receivingNumber?: string }).receivingNumber === '7065111760',
      ),
    ).toBe(true);

    const readModel = await financialAccountRead.getCustomerFinancialAccounts({
      customerId,
      principal: customerPrincipal(customerId),
    });
    expect(readModel.accounts[0]!.receivingNumber).toBe('7065111760');
  });

  it('NUM 9/14: duplicates impossible; repeated activation is idempotent; NSN INSERT level uniqueness enforced by PostgreSQL', async () => {
    const customerId = await seedEligibleCustomer('idem');
    await addPhone(customerId, '08130021017');
    const wallet = await provisionActiveWallet(customerId);
    const first = await activeNumberForWallet(wallet.id);
    expect(first!.number).toBe('8130021017');

    // Re-activation forms (re-issue attempts) converge to the same row.
    const reissued = await receivingNumbers.issue({
      customerId,
      walletId: wallet.id,
      actor: 'integration-harness',
    });
    expect(reissued!.id).toBe(first!.id);
    expect(reissued!.number).toBe('8130021017');

    // PostgreSQL-level uniqueness: a rogue second ACTIVE row is impossible.
    await expect(
      dataSource.query(
        `INSERT INTO customer_receiving_numbers (id, customer_id, wallet_id, number)
         VALUES ($1, $2, $3, '8130021017')`,
        [randomUUID(), customerId, randomUUID()],
      ),
    ).rejects.toThrow();
    // Per-wallet ACTIVE uniqueness.
    await expect(
      dataSource.query(
        `INSERT INTO customer_receiving_numbers (id, customer_id, wallet_id, number)
         VALUES ($1, $2, $3, '7065111761')`,
        [randomUUID(), customerId, wallet.id],
      ),
    ).rejects.toThrow();
  });

  it('NUM 11: a PENDING wallet has no usable receiving number until activation', async () => {
    const customerId = await seedEligibleCustomer('pending');
    await addPhone(customerId, '08023000445');
    const wallet = await customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      actor: 'integration-harness',
    });
    expect(wallet.status).toBe(CustomerWalletStatus.PENDING);
    expect(await activeNumberForWallet(wallet.id)).toBeNull();
    expect(await receivingNumbers.findActiveByWallet(wallet.id)).toBeNull();
    await expect(recipientResolution.resolveByReceivingNumber('8023000445')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await customerWallets.updateWallet(customerId, wallet.id, {
      status: CustomerWalletStatus.ACTIVE,
      actor: 'integration-harness',
    });
    const issued = await activeNumberForWallet(wallet.id);
    expect(issued!.number).toBe('8023000445');
  });

  it('NUM 13: concurrent activation produces exactly one receiving number', async () => {
    const customerId = await seedEligibleCustomer('race');
    await addPhone(customerId, '09099712340');
    const wallet = await customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      actor: 'integration-harness',
    });

    const slots = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        customerWallets.updateWallet(customerId, wallet.id, {
          status: CustomerWalletStatus.ACTIVE,
          actor: 'integration-harness',
        }),
      ),
    );
    expect(slots.some((slot) => slot.status === 'fulfilled')).toBe(true);
    slots.forEach((slot) => {
      if (slot.status === 'rejected') {
        expect(slot.reason instanceof HttpException).toBe(true);
      }
    });

    const rows = await dataSource.getRepository(CustomerReceivingNumber).find();
    const active = rows.filter((row) => row.status === CustomerReceivingNumberStatus.ACTIVE);
    expect(active).toHaveLength(1);
    expect(active[0]!.number).toBe('9099712340');
  });

  it('NUM 17: another customer cannot claim a number; phone uniqueness enforces single ownership', async () => {
    const a = await seedEligibleCustomer('own-a');
    await addPhone(a, '07065999001');
    await provisionActiveWallet(a);
    // Customer B cannot register the same phone under any representation.
    const b = await seedEligibleCustomer('own-b');
    await expect(addPhone(b, '+2347065999001')).rejects.toBeInstanceOf(ConflictException);
    expect(await dataSource.getRepository(CustomerReceivingNumber).count()).toBe(1);
  });

  it('RES 18-21: phone and number lookups resolve to the right wallet; unknowns fail closed', async () => {
    const customerId = await seedEligibleCustomer('resolve');
    await addPhone(customerId, '+2348105550166');
    const wallet = await provisionActiveWallet(customerId);
    const binding = await bindingForWallet(wallet.id);

    for (const raw of ['08105550166', '2348105550166', '+2348105550166', '0810 555 0166']) {
      const resolved = await recipientResolution.resolveByPhone(raw);
      expect(resolved.lookupMode).toBe(CustomerRecipientLookupMode.PHONE);
      expect(resolved.ownerCustomerId).toBe(customerId);
      expect(resolved.customerWalletId).toBe(wallet.id);
      expect(resolved.walletAccountId).toBe(binding!.walletAccountId);
      expect(resolved.receivingNumber).toBe('8105550166');
      expect(resolved.canonicalPhone).toBe('+2348105550166');
    }

    const byNumber = await recipientResolution.resolveByReceivingNumber('8105550166');
    expect(byNumber.ownerCustomerId).toBe(customerId);
    expect(byNumber.customerWalletId).toBe(wallet.id);
    expect(byNumber.walletAccountId).toBe(binding!.walletAccountId);
    expect(byNumber.canonicalPhone).toBeNull();

    // Unknowns and malformed inputs fail closed / deterministically.
    await expect(recipientResolution.resolveByPhone('07065111761')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(recipientResolution.resolveByReceivingNumber('9998887777')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(recipientResolution.resolveByReceivingNumber('123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('RES 22/23: inactive wallet or customer fails closed; public view exposes no internal identifiers', async () => {
    const customerId = await seedEligibleCustomer('closed');
    await addPhone(customerId, '08120442190');
    const wallet = await provisionActiveWallet(customerId);

    const resolved = await recipientResolution.resolveByReceivingNumber('8120442190');
    const publicView = toPublicRecipientView(resolved);
    expect(publicView.receivingNumber).toBe('8120442190');
    expect(Object.keys(publicView).sort()).toEqual(
      ['canonicalPhone', 'currency', 'displayName', 'lookupMode', 'receivingNumber'].sort(),
    );
    expect((publicView as unknown as Record<string, unknown>).walletAccountId).toBeUndefined();
    expect((publicView as unknown as Record<string, unknown>).ownerCustomerId).toBeUndefined();
    expect((publicView as unknown as Record<string, unknown>).customerWalletId).toBeUndefined();

    await customerWallets.updateWallet(customerId, wallet.id, {
      status: CustomerWalletStatus.SUSPENDED,
      actor: 'integration-harness',
    });
    await expect(recipientResolution.resolveByReceivingNumber('8120442190')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(recipientResolution.resolveByPhone('+2348120442190')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('TX 24-33: transfers execute with receiving-number and phone destinations through the audited transfer service', async () => {
    const senderId = await seedEligibleCustomer('tx-sender');
    await seedTransactionPin(pinStack, senderId);
    const receiverId = await seedEligibleCustomer('tx-receiver');
    await addPhone(senderId, '07033001122');
    await addPhone(receiverId, '07065111760');
    await provisionActiveWallet(senderId);
    const receiverWallet = await provisionActiveWallet(receiverId);
    await fundCustomer(senderId, '50000');

    // 256-bit smoke of all destination mechanisms --------------------------------------------
    // 29: self-transfer by own number is rejected.
    await expect(
      operations.createTransfer({
        customerId: senderId,
        principal: selfPrincipal(senderId),
        destination: {
          type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
          value: '7033001122',
        },
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `self-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    // Ambiguity rejected.
    await expect(
      operations.createTransfer({
        customerId: senderId,
        principal: selfPrincipal(senderId),
        destinationWalletId: randomUUID(),
        destination: {
          type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
          value: '7065111760',
        },
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `both-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      operations.createTransfer({
        customerId: senderId,
        principal: selfPrincipal(senderId),
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `none-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 27/28: typed payloads cannot smuggle CustomerWallet/WalletAccount UUIDs.
    const receiverBinding = await bindingForWallet(receiverWallet.id);
    await expect(
      operations.createTransfer({
        customerId: senderId,
        principal: selfPrincipal(senderId),
        destination: {
          type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
          value: receiverWallet.id,
        },
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `cwid-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      operations.createTransfer({
        customerId: senderId,
        principal: selfPrincipal(senderId),
        destination: {
          type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
          value: receiverBinding!.walletAccountId,
        },
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `waid-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 24/25/26/30: number destination executes with server-resolved source.
    const key = `tx-${randomUUID()}`;
    const transfer = await operations.createTransfer({
      customerId: senderId,
      principal: selfPrincipal(senderId),
      destination: { type: CustomerTransferDestinationType.MONIENAIJA_NUMBER, value: '7065111760' },
      amountMinor: '12000',
      currency: 'NGN',
      idempotencyKey: key,
      transactionPin: TEST_TRANSACTION_PIN,
      narration: 'by receiving number',
    });
    expect(transfer.status).toBe(TransferStatus.COMPLETED);
    expect(transfer.destinationWalletId).toBe(receiverBinding!.walletAccountId);
    const senderBinding = await bindingForWallet(
      (await recipientResolution.resolveByPhone('07033001122')).customerWalletId,
    );
    expect(transfer.sourceWalletId).toBe(senderBinding!.walletAccountId);

    // Balanced double-entry on the true ledger accounts.
    const lines = await dataSource.getRepository(LedgerLine).find({
      where: { journalId: transfer.journalId! },
    });
    expect(lines).toHaveLength(2);
    const debits = lines.filter((line) => line.direction === LedgerEntryDirection.DEBIT);
    const credits = lines.filter((line) => line.direction === LedgerEntryDirection.CREDIT);
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);
    expect(BigInt(debits[0]!.amountMinor)).toBe(12000n);
    expect(BigInt(credits[0]!.amountMinor)).toBe(12000n);
    expect(new Set(lines.map((line) => line.ledgerAccountId)).size).toBe(2);
    expect(await ledgerBalance(receiverBinding!.ledgerAccountId)).toBe(12000n);
    expect(await ledgerBalance(senderBinding!.ledgerAccountId)).toBe(38000n);

    // 32: idempotency replay returns the identical transfer.
    const replay = await operations.createTransfer({
      customerId: senderId,
      principal: selfPrincipal(senderId),
      destination: { type: CustomerTransferDestinationType.MONIENAIJA_NUMBER, value: '7065111760' },
      amountMinor: '12000',
      currency: 'NGN',
      idempotencyKey: key,
      transactionPin: TEST_TRANSACTION_PIN,
      narration: 'by receiving number',
    });
    expect(replay.id).toBe(transfer.id);
    expect(await ledgerBalance(receiverBinding!.ledgerAccountId)).toBe(12000n);

    // PHONE destination resolves the SAME wallet (distinct lookup mechanism).
    const phoneTransfer = await operations.createTransfer({
      customerId: senderId,
      principal: selfPrincipal(senderId),
      destination: { type: CustomerTransferDestinationType.PHONE, value: '07065111760' },
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: `txp-${randomUUID()}`,
      transactionPin: TEST_TRANSACTION_PIN,
    });
    expect(phoneTransfer.destinationWalletId).toBe(receiverBinding!.walletAccountId);
    expect(await ledgerBalance(receiverBinding!.ledgerAccountId)).toBe(15000n);

    // 31: insufficient funds stays fail-closed via a typed destination.
    await expect(
      operations.createTransfer({
        customerId: senderId,
        principal: selfPrincipal(senderId),
        destination: {
          type: CustomerTransferDestinationType.MONIENAIJA_NUMBER,
          value: '7065111760',
        },
        amountMinor: '99999999',
        currency: 'NGN',
        idempotencyKey: `big-${randomUUID()}`,
        transactionPin: TEST_TRANSACTION_PIN,
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(await ledgerBalance(senderBinding!.ledgerAccountId)).toBe(35000n);
    expect(await ledgerBalance(receiverBinding!.ledgerAccountId)).toBe(15000n);
  });
});
