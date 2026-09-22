import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { AuthorizationService } from '../src/authorization/authorization.service';

import { CustomerEligibility } from '../src/customer-eligibility/customer-eligibility.entity';
import { CustomerOnboarding } from '../src/customer-onboarding/customer-onboarding.entity';
import { Customer } from '../src/customer/customer.entity';
import { CustomerContactMethod } from '../src/customer/customer-contact-method.entity';
import { CustomerProfile } from '../src/customer/customer-profile.entity';
import { CustomerAuthenticationCredential } from '../src/customer-authentication/customer-authentication-credential.entity';
import {
  AuthenticationCredentialType,
  SecurityEventType,
} from '../src/customer-authentication/customer-authentication.enums';
import type { CustomerTransactionPinService } from '../src/customer-authentication/customer-transaction-pin.service';
import { SecurityEventHistory } from '../src/customer-authentication/security-event-history.entity';
import { CustomerFinancialOperationsService } from '../src/customer-financial-operations/customer-financial-operations.service';
import { CustomerTransferDestinationType } from '../src/customer-financial-operations/customer-financial-operations.types';
import { CustomerReceivingNumber } from '../src/customer-wallet/customer-receiving-number.entity';
import { CustomerReceivingNumberService } from '../src/customer-wallet/customer-receiving-number.service';
import { CustomerWallet } from '../src/customer-wallet/customer-wallet.entity';
import { CustomerWalletStatus, CustomerWalletType } from '../src/customer-wallet/customer-wallet.enums';
import { CustomerWalletService } from '../src/customer-wallet/customer-wallet.service';
import { WalletAlias } from '../src/customer-wallet/wallet-alias.entity';
import { WalletOwnership } from '../src/customer-wallet/wallet-ownership.entity';
import { WalletProvisioningHistory } from '../src/customer-wallet/wallet-provisioning-history.entity';
import { Deposit } from '../src/deposit/deposit.entity';
import { DepositService } from '../src/deposit/deposit.service';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { IdempotencyRecord } from '../src/operations/idempotency-record.entity';
import { IdempotencyService } from '../src/operations/idempotency.service';
import { MetricsService } from '../src/operations/metrics.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { PaymentReferenceService } from '../src/payment/payment-reference.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { Transfer } from '../src/transfer/transfer.entity';
import { TransferService } from '../src/transfer/transfer.service';
import { CustomerFinancialAccountBinding } from '../src/wallet/customer-financial-account-binding.entity';
import { CustomerFinancialAccountBindingService } from '../src/wallet/customer-financial-account-binding.service';
import { CustomerFinancialAccountResolutionService } from '../src/wallet/customer-financial-account-resolution.service';
import { CustomerRecipientResolutionService } from '../src/wallet/customer-recipient-resolution.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { WalletService } from '../src/wallet/wallet.service';
import { Withdrawal } from '../src/withdrawal/withdrawal.entity';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import {
  createTransactionPinStack,
  seedPasswordCredential,
  seedTransactionPin,
  type TransactionPinStack,
} from './support/transaction-pin-harness';

const PIN = '84193';
const WRONG_PIN = '00000';
const ACTOR = 'integration-harness';

/**
 * Customer transaction PIN + step-up authorization against real PostgreSQL.
 * Covers: PIN credential lifecycle (create/verify/attempts/lock/unlock/
 * change/reset), transfer & withdrawal step-up enforcement before money
 * movement, internal/provider paths staying PIN-free, idempotency
 * preservation, and the no-plaintext-PIN guarantees in storage, views,
 * audit events, and security-event metadata.
 */
describe('Customer transaction PIN + step-up authorization (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let ledger: LedgerService;
  let customerWallets: CustomerWalletService;
  let transfers: TransferService;
  let deposits: DepositService;
  let withdrawals: WithdrawalService;
  let resolution: CustomerFinancialAccountResolutionService;
  let operations: CustomerFinancialOperationsService;
  let pinStack: TransactionPinStack;
  let pins: CustomerTransactionPinService;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('txpin');

    const repository = <T extends object>(entity: new () => T) => dataSource.getRepository(entity);
    const audit = new AuditService(repository(AuditEvent));
    const outbox = new OutboxService(repository(OutboxEvent));
    const metrics = new MetricsService(dataSource);
    const idempotency = new IdempotencyService(repository(IdempotencyRecord));

    ledger = new LedgerService(
      repository(LedgerAccount),
      repository(LedgerJournal),
      repository(LedgerLine),
      dataSource,
    );
    const walletAccounts = new WalletService(repository(WalletAccount), dataSource, ledger);
    const authorization = new AuthorizationService(dataSource, audit);
    const binding = new CustomerFinancialAccountBindingService(
      repository(CustomerFinancialAccountBinding),
      repository(Customer),
      repository(CustomerWallet),
      repository(WalletOwnership),
      repository(WalletAccount),
      repository(LedgerAccount),
      repository(LedgerLine),
      dataSource,
      walletAccounts,
      authorization,
      audit,
      idempotency,
    );
    const receivingNumbers = new CustomerReceivingNumberService(dataSource, audit);
    customerWallets = new CustomerWalletService(
      repository(CustomerWallet),
      repository(WalletProvisioningHistory),
      repository(WalletAlias),
      repository(WalletOwnership),
      repository(Customer),
      repository(CustomerOnboarding),
      repository(CustomerEligibility),
      dataSource,
      audit,
      binding,
      receivingNumbers,
    );
    const references = new PaymentReferenceService();
    const settlement = new SettlementAccountService();
    transfers = new TransferService(
      repository(Transfer),
      repository(WalletAccount),
      repository(LedgerJournal),
      dataSource,
      ledger,
      references,
      audit,
      outbox,
      metrics,
    );
    deposits = new DepositService(
      repository(Deposit),
      dataSource,
      ledger,
      references,
      settlement,
      audit,
      outbox,
      metrics,
    );
    withdrawals = new WithdrawalService(
      repository(Withdrawal),
      dataSource,
      ledger,
      references,
      settlement,
      audit,
      outbox,
      metrics,
    );
    resolution = new CustomerFinancialAccountResolutionService(
      repository(CustomerFinancialAccountBinding),
      repository(WalletAccount),
    );
    const recipientResolution = new CustomerRecipientResolutionService(
      repository(CustomerContactMethod),
      repository(Customer),
      repository(CustomerProfile),
      repository(CustomerWallet),
      repository(CustomerReceivingNumber),
      repository(CustomerFinancialAccountBinding),
      repository(WalletAccount),
      repository(LedgerAccount),
    );
    pinStack = createTransactionPinStack(dataSource, audit);
    pins = pinStack.pinService;
    operations = new CustomerFinancialOperationsService(
      resolution,
      transfers,
      deposits,
      withdrawals,
      recipientResolution,
      pinStack.authorization,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);
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

  async function seedEligibleCustomer(label: string): Promise<string> {
    const customerId = randomUUID();
    await dataSource.query(
      `INSERT INTO customers (id, reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1, $2, 'INDIVIDUAL', 'ACTIVE', 'LEVEL_1', 'APPROVED')`,
      [customerId, `it.pin.${label}.${randomUUID().slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO customer_onboardings (id, customer_id, status, completed_at)
       VALUES ($1, $2, 'COMPLETED', NOW())`,
      [randomUUID(), customerId],
    );
    await dataSource.query(
      `INSERT INTO customer_eligibilities (id, customer_id, status, reviewed_by, status_changed_at)
       VALUES ($1, $2, 'ELIGIBLE', $3, NOW())`,
      [randomUUID(), customerId, ACTOR],
    );
    return customerId;
  }

  async function provisionActiveWallet(customerId: string) {
    return customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      status: CustomerWalletStatus.ACTIVE,
      actor: ACTOR,
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

  async function bindingFor(customerId: string) {
    return dataSource.getRepository(CustomerFinancialAccountBinding).findOne({
      where: { customerId },
    });
  }

  async function pinCredentialFor(customerId: string) {
    return dataSource.getRepository(CustomerAuthenticationCredential).findOne({
      where: { customerId, type: AuthenticationCredentialType.PIN },
    });
  }

  async function securityEventsFor(customerId: string): Promise<SecurityEventHistory[]> {
    return dataSource.getRepository(SecurityEventHistory).find({ where: { customerId } });
  }

  it('1: create customer + wallet + PIN (server-side hash, exactly one active PIN, duplicate rejected)', async () => {
    const customerId = await seedEligibleCustomer('create');
    await provisionActiveWallet(customerId);

    const status = await pins.createPin(customerId, { pin: PIN, actor: ACTOR });
    expect(status.configured).toBe(true);

    const credential = await pinCredentialFor(customerId);
    expect(credential).not.toBeNull();
    expect(credential!.type).toBe(AuthenticationCredentialType.PIN);
    expect(credential!.passwordHash.startsWith('PBKDF2$sha512$')).toBe(true);
    expect(credential!.passwordHash).not.toContain(PIN);

    await expect(pins.createPin(customerId, { pin: '97531', actor: ACTOR })).rejects.toBeInstanceOf(
      ConflictException,
    );
    // The uniqueness guarantee is database-enforced, not just service-checked.
    await expect(
      dataSource.query(
        `INSERT INTO customer_authentication_credentials
           (customer_id, credential_type, password_hash, hash_algorithm, password_version)
         VALUES ($1, 'PIN', 'PBKDF2$sha512$210000$c2FsdA$ZGlnZXN0', 'PBKDF2', 1)`,
        [customerId],
      ),
    ).rejects.toThrow();

    // Concurrent creation races resolve to exactly one active PIN.
    const racingCustomer = await seedEligibleCustomer('race');
    const outcomes = await Promise.allSettled([
      pins.createPin(racingCustomer, { pin: PIN, actor: ACTOR }),
      pins.createPin(racingCustomer, { pin: PIN, actor: ACTOR }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(
      await dataSource.getRepository(CustomerAuthenticationCredential).count({
        where: { customerId: racingCustomer, type: AuthenticationCredentialType.PIN },
      }),
    ).toBe(1);
  });

  it('2/3: verify accepts the correct PIN and rejects an incorrect PIN', async () => {
    const customerId = await seedEligibleCustomer('verify');
    await seedTransactionPin(pinStack, customerId, PIN);

    const ok = await pins.verifyTransactionPin(customerId, { pin: PIN, actor: `customer:${customerId}` });
    expect(ok.configured).toBe(true);
    expect(ok.failedPinAttemptCount).toBe(0);

    await expect(
      pins.verifyTransactionPin(customerId, { pin: WRONG_PIN, actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      pins.verifyTransactionPin(customerId, { pin: '8419', actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('4/5: repeated incorrect attempts lock at the threshold and reject verification while locked', async () => {
    const customerId = await seedEligibleCustomer('lock');
    await seedTransactionPin(pinStack, customerId, PIN);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        pins.verifyTransactionPin(customerId, { pin: WRONG_PIN, actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await pins.getPinStatus(customerId)).accountLocked).toBe(false);
    }
    await expect(
      pins.verifyTransactionPin(customerId, { pin: WRONG_PIN, actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const status = await pins.getPinStatus(customerId);
    expect(status.accountLocked).toBe(true);
    expect(status.failedPinAttemptCount).toBe(5);
    expect(status.lockedAt).not.toBeNull();

    // Even the correct PIN is rejected while locked; attempts stop counting.
    await expect(
      pins.verifyTransactionPin(customerId, { pin: PIN, actor: ACTOR }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await pins.getPinStatus(customerId)).failedPinAttemptCount).toBe(5);

    const eventTypes = (await securityEventsFor(customerId)).map((event) => event.eventType);
    expect(eventTypes).toContain(SecurityEventType.PIN_LOCKED);
  });

  it('6: a locked PIN cannot authorize a transaction', async () => {
    const customerId = await seedEligibleCustomer('locked-tx');
    const recipientId = await seedEligibleCustomer('locked-tx-r');
    await provisionActiveWallet(customerId);
    await provisionActiveWallet(recipientId);
    await seedTransactionPin(pinStack, customerId, PIN);
    await fundCustomer(customerId, '50000');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        pins.verifyTransactionPin(customerId, { pin: WRONG_PIN, actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    const recipient = await bindingFor(recipientId);
    await expect(
      operations.createTransfer({
        customerId,
        destinationWalletId: recipient!.walletAccountId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `locked-${randomUUID()}`,
        transactionPin: PIN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await dataSource.getRepository(Transfer).count()).toBe(0);
  });

  it('7: unlock and reset both restore the ability to authorize', async () => {
    const customerId = await seedEligibleCustomer('unlock');
    await seedTransactionPin(pinStack, customerId, PIN);
    await seedPasswordCredential(pinStack, customerId, 'sparrow-river-42');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        pins.verifyTransactionPin(customerId, { pin: WRONG_PIN, actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect((await pins.getPinStatus(customerId)).accountLocked).toBe(true);

    const unlocked = await pins.unlockPin(customerId, { actor: 'security-ops', reason: 'verified' });
    expect(unlocked.accountLocked).toBe(false);
    await expect(
      pins.verifyTransactionPin(customerId, { pin: PIN, actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true });

    // Reset (recovery via password) also recovers from a fresh lock.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        pins.verifyTransactionPin(customerId, { pin: WRONG_PIN, actor: ACTOR }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const reset = await pins.resetPin(customerId, {
      password: 'sparrow-river-42',
      newPin: '60982',
      actor: ACTOR,
    });
    expect(reset.accountLocked).toBe(false);
    await expect(
      pins.verifyTransactionPin(customerId, { pin: '60982', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true });
  });

  it('8: PIN change requires the current PIN and every prior verification state is preserved', async () => {
    const customerId = await seedEligibleCustomer('change');
    await seedTransactionPin(pinStack, customerId, PIN);

    await expect(
      pins.changePin(customerId, { currentPin: WRONG_PIN, newPin: '27513', actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect((await pins.getPinStatus(customerId)).failedPinAttemptCount).toBe(1);

    const changed = await pins.changePin(customerId, {
      currentPin: PIN,
      newPin: '27513',
      actor: ACTOR,
    });
    expect(changed.pinVersion).toBe(2);
    expect(changed.failedPinAttemptCount).toBe(0);

    await expect(
      pins.verifyTransactionPin(customerId, { pin: PIN, actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      pins.verifyTransactionPin(customerId, { pin: '27513', actor: ACTOR }),
    ).resolves.toMatchObject({ configured: true });

    // Password history rows are password-only; PIN history never lands there.
    expect(
      await dataSource.query(`SELECT count(*)::int AS count FROM password_histories`),
    ).toEqual([{ count: 0 }]);
  });

  it('9: PIN reset flows through authorized recovery (password), never off the customer ID alone', async () => {
    const customerId = await seedEligibleCustomer('reset');
    await seedTransactionPin(pinStack, customerId, PIN);
    await seedPasswordCredential(pinStack, customerId, 'sparrow-river-42');

    await expect(
      pins.resetPin(customerId, { password: 'wrong-password', newPin: '60982', actor: ACTOR }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Wrong recovery password: PIN unchanged, reset never completed.
    expect((await pins.getPinStatus(customerId)).pinVersion).toBe(1);

    const reset = await pins.resetPin(customerId, {
      password: 'sparrow-river-42',
      newPin: '60982',
      actor: ACTOR,
    });
    expect(reset.pinVersion).toBe(2);
    const eventTypes = (await securityEventsFor(customerId)).map((event) => event.eventType);
    expect(eventTypes).toContain(SecurityEventType.PIN_RESET_REQUESTED);
    expect(eventTypes).toContain(SecurityEventType.PIN_RESET);

    // Password-credential isolation cuts both ways: PIN activity never touched
    // the login credential, and password login still resolves the PASSWORD row.
    const passwordCredential = await dataSource
      .getRepository(CustomerAuthenticationCredential)
      .findOne({ where: { customerId, type: AuthenticationCredentialType.PASSWORD } });
    expect(passwordCredential!.failedAuthenticationCount).toBe(1); // one wrong recovery attempt
    expect(passwordCredential!.accountLocked).toBe(false);
    const login = await pinStack.execution.authenticate({
      customerId,
      password: 'sparrow-river-42',
      actor: ACTOR,
    });
    expect(login.authenticated).toBe(true);
  });

  it('10/11: transfer requires a valid PIN and an invalid PIN fails BEFORE money movement', async () => {
    const customerId = await seedEligibleCustomer('tx-a');
    const recipientId = await seedEligibleCustomer('tx-b');
    await provisionActiveWallet(customerId);
    await provisionActiveWallet(recipientId);
    await seedTransactionPin(pinStack, customerId, PIN);
    await fundCustomer(customerId, '50000');
    const sender = await bindingFor(customerId);
    const recipient = await bindingFor(recipientId);

    // 11: no PIN, wrong PIN, malformed PIN — all rejected before any money moves.
    await expect(
      operations.createTransfer({
        customerId,
        destinationWalletId: recipient!.walletAccountId,
        amountMinor: '4000',
        currency: 'NGN',
        idempotencyKey: `miss-${randomUUID()}`,
        transactionPin: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      operations.createTransfer({
        customerId,
        destinationWalletId: recipient!.walletAccountId,
        amountMinor: '4000',
        currency: 'NGN',
        idempotencyKey: `bad-${randomUUID()}`,
        transactionPin: WRONG_PIN,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      operations.createTransfer({
        customerId,
        destinationWalletId: recipient!.walletAccountId,
        amountMinor: '4000',
        currency: 'NGN',
        idempotencyKey: `shape-${randomUUID()}`,
        transactionPin: '12ab',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(await dataSource.getRepository(Transfer).count()).toBe(0);
    expect(await ledger.getAccountBalance(sender!.ledgerAccountId)).toMatchObject({
      balanceMinor: '50000',
    });

    // 10: the correct PIN authorizes the transfer through the audited service.
    const transfer = await operations.createTransfer({
      customerId,
      destinationWalletId: recipient!.walletAccountId,
      amountMinor: '4000',
      currency: 'NGN',
      idempotencyKey: `ok-${randomUUID()}`,
      transactionPin: PIN,
      narration: 'pin authorized',
    });
    expect(transfer.status).toBe('COMPLETED');
    expect(await dataSource.getRepository(Transfer).count()).toBe(1);
    const recipientBalance = await ledger.getAccountBalance(recipient!.ledgerAccountId);
    expect(recipientBalance.balanceMinor).toBe('4000');

    // The failed attempt above was counted, but the success reset it.
    expect((await pins.getPinStatus(customerId)).failedPinAttemptCount).toBe(0);
  });

  it('12/13: withdrawal requires a valid PIN and an invalid PIN fails BEFORE money movement', async () => {
    const customerId = await seedEligibleCustomer('wd');
    await provisionActiveWallet(customerId);
    await seedTransactionPin(pinStack, customerId, PIN);
    await fundCustomer(customerId, '50000');

    await expect(
      operations.createWithdrawal({
        customerId,
        amountMinor: '8000',
        currency: 'NGN',
        idempotencyKey: `wd-miss-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      operations.createWithdrawal({
        customerId,
        amountMinor: '8000',
        currency: 'NGN',
        idempotencyKey: `wd-bad-${randomUUID()}`,
        transactionPin: WRONG_PIN,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(await dataSource.getRepository(Withdrawal).count()).toBe(0);
    const ledgerAccountId = (await bindingFor(customerId))!.ledgerAccountId;
    expect((await ledger.getAccountBalance(ledgerAccountId)).balanceMinor).toBe('50000');

    const withdrawal = await operations.createWithdrawal({
      customerId,
      amountMinor: '8000',
      currency: 'NGN',
      idempotencyKey: `wd-ok-${randomUUID()}`,
      transactionPin: PIN,
    });
    expect(withdrawal.status).toBe('PENDING');
    expect(await dataSource.getRepository(Withdrawal).count()).toBe(1);
  });

  it('14: internal/provider processing and service-level financial paths never require a customer PIN', async () => {
    const customerId = await seedEligibleCustomer('internal');
    await provisionActiveWallet(customerId);
    await seedTransactionPin(pinStack, customerId, PIN);
    await fundCustomer(customerId, '50000');
    const binding = await bindingFor(customerId);

    // Internal TransferService (operator/settlement/reconciliation surface): PIN-free by design.
    const recipientId = await seedEligibleCustomer('internal-r');
    await provisionActiveWallet(recipientId);
    const recipient = await bindingFor(recipientId);
    const internal = await transfers.createTransfer({
      sourceWalletId: binding!.walletAccountId,
      destinationWalletId: recipient!.walletAccountId,
      amountMinor: '5000',
      currency: 'NGN',
      idempotencyKey: `internal-${randomUUID()}`,
    });
    expect(internal.status).toBe('COMPLETED');

    // Customer-created withdrawal lifecycle continues without re-prompting the PIN.
    const withdrawal = await operations.createWithdrawal({
      customerId,
      amountMinor: '7000',
      currency: 'NGN',
      idempotencyKey: `wd-life-${randomUUID()}`,
      transactionPin: PIN,
    });
    const processed = await operations.processWithdrawal(customerId, withdrawal.id);
    expect(processed.status).toBe('PROCESSING');
    const completed = await operations.completeWithdrawal(customerId, withdrawal.id);
    expect(completed.status).toBe('COMPLETED');

    // Direct WithdrawalService usage (provider/reconciliation handlers): PIN-free.
    const direct = await withdrawals.createWithdrawal({
      walletId: binding!.walletAccountId,
      amountMinor: '3000',
      currency: 'NGN',
      idempotencyKey: `wd-direct-${randomUUID()}`,
    });
    expect(direct.status).toBe('PENDING');
  });

  it('15/16: idempotent transfer and withdrawal replays return the original result unchanged', async () => {
    const customerId = await seedEligibleCustomer('idem');
    const recipientId = await seedEligibleCustomer('idem-r');
    await provisionActiveWallet(customerId);
    await provisionActiveWallet(recipientId);
    await seedTransactionPin(pinStack, customerId, PIN);
    await fundCustomer(customerId, '50000');
    const recipient = await bindingFor(recipientId);

    const transferKey = `idem-tx-${randomUUID()}`;
    const firstTransfer = await operations.createTransfer({
      customerId,
      destinationWalletId: recipient!.walletAccountId,
      amountMinor: '6000',
      currency: 'NGN',
      idempotencyKey: transferKey,
      transactionPin: PIN,
    });
    const replayTransfer = await operations.createTransfer({
      customerId,
      destinationWalletId: recipient!.walletAccountId,
      amountMinor: '6000',
      currency: 'NGN',
      idempotencyKey: transferKey,
      transactionPin: PIN,
    });
    expect(replayTransfer.id).toBe(firstTransfer.id);
    expect(await dataSource.getRepository(Transfer).count()).toBe(1);
    expect((await ledger.getAccountBalance(recipient!.ledgerAccountId)).balanceMinor).toBe('6000');

    const withdrawalKey = `idem-wd-${randomUUID()}`;
    const firstWithdrawal = await operations.createWithdrawal({
      customerId,
      amountMinor: '9000',
      currency: 'NGN',
      idempotencyKey: withdrawalKey,
      transactionPin: PIN,
    });
    const replayWithdrawal = await operations.createWithdrawal({
      customerId,
      amountMinor: '9000',
      currency: 'NGN',
      idempotencyKey: withdrawalKey,
      transactionPin: PIN,
    });
    expect(replayWithdrawal.id).toBe(firstWithdrawal.id);
    expect(await dataSource.getRepository(Withdrawal).count()).toBe(1);
  });

  it('17: the PIN is never returned by any API view', async () => {
    const customerId = await seedEligibleCustomer('noview');
    const recipientId = await seedEligibleCustomer('noview-r');
    await provisionActiveWallet(customerId);
    await provisionActiveWallet(recipientId);
    await seedTransactionPin(pinStack, customerId, PIN);
    await fundCustomer(customerId, '20000');

    for (const view of [
      await pins.getPinStatus(customerId),
      await pins.changePin(customerId, { currentPin: PIN, newPin: '27513', actor: ACTOR }),
      await pins.verifyTransactionPin(customerId, { pin: '27513', actor: ACTOR }),
    ]) {
      expect(JSON.stringify(view)).not.toContain('27513');
      expect(view).not.toHaveProperty('pin');
      expect(view).not.toHaveProperty('passwordHash');
    }

    const recipient = await bindingFor(recipientId);
    const transfer = await operations.createTransfer({
      customerId,
      destination: { type: CustomerTransferDestinationType.WALLET_ACCOUNT, value: recipient!.walletAccountId },
      amountMinor: '1500',
      currency: 'NGN',
      idempotencyKey: `view-${randomUUID()}`,
      transactionPin: '27513',
    });
    expect(JSON.stringify(transfer)).not.toContain('27513');
  });

  it('18: PIN material never lands in audit events or security-event metadata', async () => {
    const customerId = await seedEligibleCustomer('noaudit');
    await seedTransactionPin(pinStack, customerId, PIN);
    await pins.verifyTransactionPin(customerId, { pin: WRONG_PIN, actor: ACTOR }).catch(() => undefined);
    await pins.verifyTransactionPin(customerId, { pin: PIN, actor: ACTOR });
    await pins.changePin(customerId, { currentPin: PIN, newPin: '27513', actor: ACTOR });

    const pinCredential = await pinCredentialFor(customerId);
    const auditRows = await dataSource.getRepository(AuditEvent).find({
      where: { entityType: 'CUSTOMER_AUTHENTICATION_CREDENTIAL', entityId: pinCredential!.id },
    });
    expect(auditRows.length).toBeGreaterThan(0);
    for (const row of auditRows) {
      const serialized = JSON.stringify({ previous: row.previousValues, next: row.newValues });
      expect(serialized).not.toContain(PIN);
      expect(serialized).not.toContain('27513');
      expect(serialized).not.toContain('passwordHash');
    }

    const events = await securityEventsFor(customerId);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const metadata = JSON.stringify(event.metadata);
      expect(metadata).not.toContain(PIN);
      expect(metadata).not.toContain('27513');
    }
    const pinEventTypes = new Set(events.map((event) => event.eventType));
    expect(pinEventTypes.has(SecurityEventType.PIN_CREATED)).toBe(true);
    expect(pinEventTypes.has(SecurityEventType.PIN_VERIFICATION_FAILED)).toBe(true);
    expect(pinEventTypes.has(SecurityEventType.PIN_VERIFICATION_SUCCEEDED)).toBe(true);
    expect(pinEventTypes.has(SecurityEventType.PIN_CHANGED)).toBe(true);

    // PIN management never fabricates password-history rows.
    expect(
      await dataSource.query(`SELECT count(*)::int AS count FROM password_histories`),
    ).toEqual([{ count: 0 }]);
  });

  it('management API errors map to explicit statuses without credential enumeration', async () => {
    const customerId = await seedEligibleCustomer('errors');
    await expect(
      pins.verifyTransactionPin(customerId, { pin: PIN, actor: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      pins.changePin(customerId, { currentPin: PIN, newPin: '27513', actor: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      pins.resetPin(customerId, { password: 'x', newPin: '27513', actor: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const unknown = randomUUID();
    await expect(pins.getPinStatus(unknown)).rejects.toBeInstanceOf(NotFoundException);
    await expect(pins.createPin(unknown, { pin: PIN, actor: ACTOR })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(pins.createPin(customerId, { pin: 'ab12', actor: ACTOR })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      pins.verifyTransactionPin(customerId, { pin: '12 34', actor: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
