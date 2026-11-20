/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource, QueryFailedError } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../src/app.module';
import { TransferService } from '../src/transfer/transfer.service';
import { CustomerFundingService } from '../src/customer-funding/customer-funding.service';
import { WalletService } from '../src/wallet/wallet.service';
import { LedgerService } from '../src/ledger/ledger.service';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { CustomerEligibilityService } from '../src/customer-eligibility/customer-eligibility.service';
import { CustomerRestrictionType } from '../src/customer-eligibility/customer-eligibility.enums';
import { CustomerFinancialEligibilityService } from '../src/kyc-verification/customer-financial-eligibility.service';
import { WalletFinancialBoundaryService } from '../src/wallet/wallet-financial-boundary.service';
import { createIntegrationDataSource, destroyIntegrationDataSource } from './support/pg-harness';
import { KycTierEvidenceReader } from '../src/kyc-verification/kyc-tier-evidence.reader';
import { createTestEvidenceReader } from './support/kyc-test-evidence-reader';
import {
  makeCustomerFinanciallyEligible,
  seedGovernedTierPolicy,
} from './support/kyc-test-fixtures';

/**
 * ARENA 5 §6 — FROZEN / BLACKLISTED admission at the centralized financial boundary
 * (`CustomerFinancialEligibilityService.require()`), with the restriction-writer serialization
 * contract from `CustomerEligibilityService.createRestriction()`.
 *
 * Before the fix, `require()` never read `customer_restrictions`: a customer administratively
 * frozen with `POST /customers/:id/restriction { type: 'FROZEN', isActive: true }` could still
 * send, receive and be credited money. Everything below runs against real PostgreSQL and the real
 * ledger/journal/serialization semantics — no mocked manager.
 */
const kycEvidence = createTestEvidenceReader({ mode: 'ELIGIBLE' });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('V1-SYSTEM-02 FROZEN/BLACKLISTED customer financial admission (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let app: NestFastifyApplication;
  let transferService: TransferService;
  let fundingService: CustomerFundingService;
  let walletService: WalletService;
  let ledgerService: LedgerService;
  let eligibilityService: CustomerEligibilityService;
  let financialEligibility: CustomerFinancialEligibilityService;
  let walletBoundary: WalletFinancialBoundaryService;

  const operatorChecker: any = {
    type: 'OPERATOR',
    principalId: 'operator-checker-sys02',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };
  const supportMaker: any = {
    type: 'SUPPORT',
    principalId: 'support-maker-sys02',
    roles: [],
    scopes: [],
    customerAccess: 'NONE',
    agentAccess: 'NONE',
    aggregatorAccess: 'NONE',
  };

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('v1system02-frozen');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(KycTierEvidenceReader)
      .useValue(kycEvidence.reader)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    transferService = moduleRef.get(TransferService);
    fundingService = moduleRef.get(CustomerFundingService);
    walletService = moduleRef.get(WalletService);
    ledgerService = moduleRef.get(LedgerService);
    eligibilityService = moduleRef.get(CustomerEligibilityService);
    financialEligibility = moduleRef.get(CustomerFinancialEligibilityService);
    walletBoundary = moduleRef.get(WalletFinancialBoundaryService);
    const requirements = { all: [], any: [] };
    await seedGovernedTierPolicy(dataSource, {
      definition: {
        regulatoryRequirementsConfirmed: true,
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveUntil: null,
        regulatory: { LEVEL_1: requirements, LEVEL_2: requirements, LEVEL_3: requirements },
        operator: { LEVEL_1: requirements, LEVEL_2: requirements, LEVEL_3: requirements },
      },
      makerId: 'sys02-maker',
      checkerId: 'sys02-checker',
    });
  }, 180000);

  afterAll(async () => {
    if (app) await app.close().catch(() => undefined);
    if (dataSource) {
      try {
        await destroyIntegrationDataSource(dataSource);
      } catch {
        /* noop */
      }
    }
  });

  async function createActiveCustomerWithWallet(): Promise<{
    customerId: string;
    walletId: string;
    ledgerAccountId: string;
  }> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO customers (reference, customer_type, status, kyc_level, kyc_status)
       VALUES ($1,'INDIVIDUAL','ACTIVE','LEVEL_1','APPROVED') RETURNING id`,
      [`cust-sys02-${randomUUID().slice(0, 8)}`],
    );
    const customerId = rows[0]!.id;
    await dataSource.query(
      `INSERT INTO customer_profiles (customer_id, display_name, is_active) VALUES ($1,$2,true)`,
      [customerId, 'Frozen Boundary Customer'],
    );
    const canonical10 = `8${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    await dataSource.query(
      `INSERT INTO customer_contact_methods (customer_id, type, value, normalized_value, is_primary, verified_at)
       VALUES ($1,'PHONE',$2,$2,true,NOW())`,
      [customerId, canonical10],
    );
    await makeCustomerFinanciallyEligible(dataSource, customerId, kycEvidence);
    const wallet = await walletService.createWallet({
      customerId,
      currency: 'NGN',
      idempotencyKey: `sys02-wallet-${customerId}-${randomUUID()}`,
    });
    return { customerId, walletId: wallet.id, ledgerAccountId: wallet.ledgerAccountId };
  }

  /** The real product path: `POST /customers/:id/restriction`. */
  async function restrict(customerId: string, type: CustomerRestrictionType): Promise<string> {
    const restriction = await eligibilityService.createRestriction(customerId, {
      type,
      isActive: true,
      reason: 'ARENA 5 §6 acceptance',
      actor: 'arena5-risk-ops',
    });
    return restriction.id;
  }

  /**
   * No deactivation API exists yet (see the integration report); this reproduces the state a
   * future one must produce, under the same customer-lock discipline the writer must keep.
   */
  async function deactivateRestriction(customerId: string, type: CustomerRestrictionType) {
    await dataSource.transaction(async (manager) => {
      await manager.query('UPDATE customers SET updated_at = NOW() WHERE id=$1', [customerId]);
      await manager.query(
        `UPDATE customer_restrictions SET is_active=false, updated_at=NOW()
          WHERE customer_id=$1 AND type=$2 AND deleted_at IS NULL`,
        [customerId, type],
      );
    });
  }

  async function fundWallet(ledgerAccountId: string, amountMinor: string): Promise<void> {
    const sys = await ledgerService.createAccount({
      code: `SYS02-FLOAT-NGN-${randomUUID().slice(0, 6)}`,
      name: 'SYS02 float',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    await ledgerService.postJournal({
      idempotencyKey: `sys02-fund-${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        { accountId: sys.id, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
  }

  async function getBalance(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::text AS balance
         FROM ledger_lines l JOIN ledger_accounts a ON a.id=l.ledger_account_id
        WHERE l.ledger_account_id=$1`,
      [ledgerAccountId],
    );
    return BigInt(rows[0]!.balance);
  }

  function transfer(
    sourceWalletId: string,
    destinationWalletId: string,
    idempotencyKey = `sys02-w2w-${randomUUID()}`,
  ) {
    return transferService.createTransfer({
      ownership: { kind: 'INTERNAL', principalId: 'v1-system-02-spec', principalType: 'SERVICE' },
      sourceWalletId,
      destinationWalletId,
      amountMinor: '25000',
      currency: 'NGN',
      idempotencyKey,
    });
  }

  it('1. TRANSFER: a FROZEN source customer is refused and no money moves', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');
    await restrict(sender.customerId, CustomerRestrictionType.FROZEN);

    const beforeSender = await getBalance(sender.ledgerAccountId);
    const beforeRecipient = await getBalance(recipient.ledgerAccountId);

    await expect(transfer(sender.walletId, recipient.walletId)).rejects.toThrow(/frozen/i);

    expect(await getBalance(sender.ledgerAccountId)).toBe(beforeSender);
    expect(await getBalance(recipient.ledgerAccountId)).toBe(beforeRecipient);
  });

  it('2. TRANSFER: a FROZEN destination customer is refused (no silent credit)', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');
    await restrict(recipient.customerId, CustomerRestrictionType.FROZEN);

    const beforeSender = await getBalance(sender.ledgerAccountId);
    const beforeRecipient = await getBalance(recipient.ledgerAccountId);

    await expect(transfer(sender.walletId, recipient.walletId)).rejects.toThrow(/frozen/i);

    expect(await getBalance(sender.ledgerAccountId)).toBe(beforeSender);
    expect(await getBalance(recipient.ledgerAccountId)).toBe(beforeRecipient);
  });

  it('3. TRANSFER: BLACKLISTED is refused with its own restricted verdict', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');
    await restrict(sender.customerId, CustomerRestrictionType.BLACKLISTED);

    await expect(transfer(sender.walletId, recipient.walletId)).rejects.toThrow(/restricted/i);
  });

  it('4. TRANSFER: an INACTIVE FROZEN restriction no longer blocks', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');
    await restrict(sender.customerId, CustomerRestrictionType.FROZEN);
    await expect(transfer(sender.walletId, recipient.walletId)).rejects.toThrow(/frozen/i);

    await deactivateRestriction(sender.customerId, CustomerRestrictionType.FROZEN);

    const view = await transfer(sender.walletId, recipient.walletId);
    expect(view.status).toBe('COMPLETED');
    expect(await getBalance(recipient.ledgerAccountId)).toBe(25000n);
  });

  it.each([CustomerRestrictionType.LIMITED, CustomerRestrictionType.MANUAL_REVIEW])(
    '5. TRANSFER: %s is NOT reinterpreted as a full freeze',
    async (type) => {
      const sender = await createActiveCustomerWithWallet();
      const recipient = await createActiveCustomerWithWallet();
      await fundWallet(sender.ledgerAccountId, '100000');
      await restrict(sender.customerId, type);

      const view = await transfer(sender.walletId, recipient.walletId);
      expect(view.status).toBe('COMPLETED');
      expect(await getBalance(recipient.ledgerAccountId)).toBe(25000n);
    },
  );

  it('6. CUSTOMER_FUNDING: approval for a frozen customer is refused and stays PENDING', async () => {
    const customer = await createActiveCustomerWithWallet();
    const created = await fundingService.createRequest({
      customerId: customer.customerId,
      amountMinor: '60000',
      currency: 'NGN',
      idempotencyKey: `sys02-funding-create-${randomUUID()}`,
      principal: supportMaker,
    });
    expect(created.status).toBe('PENDING');

    await restrict(customer.customerId, CustomerRestrictionType.FROZEN);

    const before = await getBalance(customer.ledgerAccountId);
    await expect(
      fundingService.approve({ fundingRequestId: created.id, principal: operatorChecker }),
    ).rejects.toThrow(/frozen/i);
    expect(await getBalance(customer.ledgerAccountId)).toBe(before);

    const rows: Array<{ status: string }> = await dataSource.query(
      `SELECT status FROM customer_funding_requests WHERE id=$1`,
      [created.id],
    );
    expect(rows[0]!.status).toBe('PENDING');
  });

  it('7. WITHDRAWAL / CASH-TO-CASH / settlement lane: every journal touching a frozen wallet is refused', async () => {
    const customer = await createActiveCustomerWithWallet();
    await fundWallet(customer.ledgerAccountId, '80000');
    await restrict(customer.customerId, CustomerRestrictionType.FROZEN);

    const counterparty = await ledgerService.createAccount({
      code: `SYS02-SUSPENSE-NGN-${randomUUID().slice(0, 6)}`,
      name: 'SYS02 suspense',
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });

    // The same centralized boundary every withdrawal, cash-to-cash settlement and funding credit
    // reaches: LedgerService.postWithinTransaction -> requireAccounts -> require().
    await expect(
      ledgerService.postJournal({
        idempotencyKey: `sys02-withdrawal-lane-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: customer.ledgerAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '10000',
          },
          {
            accountId: counterparty.id,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '10000',
          },
        ],
      }),
    ).rejects.toThrow(/frozen/i);

    // And the explicit ownership boundary used by virtual-account inbound funding, partner
    // external operations and financial commitments.
    await expect(
      dataSource.transaction((manager) =>
        walletBoundary.requireCustomerWallet(
          manager,
          customer.customerId,
          customer.walletId,
          customer.ledgerAccountId,
        ),
      ),
    ).rejects.toThrow(/frozen/i);

    expect(await getBalance(customer.ledgerAccountId)).toBe(80000n);
  });

  it('8. WALLET PROVISIONING: a frozen customer cannot open another wallet', async () => {
    const customer = await createActiveCustomerWithWallet();
    await restrict(customer.customerId, CustomerRestrictionType.FROZEN);

    await expect(
      walletService.createWallet({
        customerId: customer.customerId,
        currency: 'NGN',
        idempotencyKey: `sys02-wallet-frozen-${randomUUID()}`,
      }),
    ).rejects.toThrow(/frozen/i);
  });

  it('9. IDEMPOTENCY: a refused transfer replays the same 409 and never posts a journal', async () => {
    const sender = await createActiveCustomerWithWallet();
    const recipient = await createActiveCustomerWithWallet();
    await fundWallet(sender.ledgerAccountId, '100000');
    await restrict(sender.customerId, CustomerRestrictionType.FROZEN);
    const idempotencyKey = `sys02-idem-${randomUUID()}`;

    await expect(transfer(sender.walletId, recipient.walletId, idempotencyKey)).rejects.toThrow(
      /frozen/i,
    );
    await expect(transfer(sender.walletId, recipient.walletId, idempotencyKey)).rejects.toThrow(
      /frozen/i,
    );

    const transfers: Array<{ count: string; journals: string }> = await dataSource.query(
      `SELECT COUNT(*)::text AS count, COUNT(journal_id)::text AS journals
         FROM transfers WHERE idempotency_key=$1`,
      [idempotencyKey],
    );
    expect(transfers[0]!.count).toBe('1');
    expect(transfers[0]!.journals).toBe('0');
    expect(await getBalance(sender.ledgerAccountId)).toBe(100000n);
    expect(await getBalance(recipient.ledgerAccountId)).toBe(0n);
  });

  /**
   * Serialization strategy, part 1 — the writer takes the SAME `customers` row lock the admission
   * takes. A freeze must therefore wait for the in-flight financial transaction and only becomes
   * effective after it commits; it can never be silently overwritten by an admission that had
   * already read an empty `customer_restrictions` set.
   */
  it('10. CONCURRENCY: a freeze waits for the in-flight admission and applies afterwards', async () => {
    const customer = await createActiveCustomerWithWallet();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('BEGIN');
      // Exactly what a financial transaction does first: lock the customer row and pass admission.
      await expect(financialEligibility.require(runner.manager, customer.customerId)).resolves.toBe(
        'LEVEL_1',
      );

      const freeze = restrict(customer.customerId, CustomerRestrictionType.FROZEN);
      const outcome = await Promise.race([
        freeze.then(() => 'committed' as const),
        delay(500).then(() => 'waiting' as const),
      ]);
      expect(outcome).toBe('waiting');

      await runner.query('COMMIT');
      await expect(freeze).resolves.toEqual(expect.any(String));
    } finally {
      await runner.release();
    }

    // The freeze committed after the admission; the next admission is refused.
    await expect(
      dataSource.transaction((manager) =>
        financialEligibility.require(manager, customer.customerId),
      ),
    ).rejects.toThrow(/frozen/i);
  }, 60000);

  /**
   * Serialization strategy, part 2 — an admission that already holds an older snapshot cannot pass
   * silently. The writer's `UPDATE customers SET updated_at = NOW()` makes the customer row's
   * version newer than that snapshot, so PostgreSQL aborts the admission's locking read with
   * `40001 could not serialize access due to concurrent update`. The bounded retry the financial
   * flows already run then re-reads a snapshot in which the restriction exists.
   */
  it('11. CONCURRENCY: a stale SERIALIZABLE snapshot aborts instead of admitting a frozen customer', async () => {
    const customer = await createActiveCustomerWithWallet();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      // Pin the snapshot BEFORE the freeze exists.
      await runner.query('SELECT COUNT(*)::text AS count FROM customers');

      await restrict(customer.customerId, CustomerRestrictionType.FROZEN);

      const error = await runner
        .query(
          `SELECT status,kyc_status,kyc_level,is_synthetic,deleted_at FROM customers WHERE id=$1 FOR UPDATE`,
          [customer.customerId],
        )
        .catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(QueryFailedError);
      const driver: unknown = (error as QueryFailedError).driverError;
      expect(driver).toMatchObject({ code: '40001' });
      await runner.query('ROLLBACK');
    } finally {
      await runner.release();
    }

    // What the bounded retry produces: a fresh transaction that sees the committed restriction.
    await expect(
      dataSource.transaction((manager) =>
        financialEligibility.require(manager, customer.customerId),
      ),
    ).rejects.toThrow(/frozen/i);
  }, 60000);

  /**
   * Serialization strategy, part 3 — an UNCOMMITTED freeze blocks admission on the same row, and
   * the admission is then refused (never admitted on the pre-freeze snapshot).
   */
  it('12. CONCURRENCY: an uncommitted freeze blocks admission, which is refused once it commits', async () => {
    const customer = await createActiveCustomerWithWallet();
    const writer = dataSource.createQueryRunner();
    await writer.connect();
    let admission: Promise<'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3'> | undefined;
    try {
      await writer.query('BEGIN');
      await writer.query('UPDATE customers SET updated_at = NOW() WHERE id=$1', [
        customer.customerId,
      ]);
      await writer.query(
        `INSERT INTO customer_restrictions (customer_id, type, is_active, reason)
         VALUES ($1,'FROZEN',true,'ARENA 5 §6 acceptance')`,
        [customer.customerId],
      );

      admission = dataSource.transaction((manager) =>
        financialEligibility.require(manager, customer.customerId),
      );
      const settled = await Promise.race([
        admission.then(() => 'resolved' as const).catch(() => 'rejected' as const),
        delay(500).then(() => 'waiting' as const),
      ]);
      expect(settled).toBe('waiting');

      await writer.query('COMMIT');
      await expect(admission).rejects.toThrow(/frozen/i);
    } finally {
      await writer.release();
    }
  }, 60000);

  it('13. OPERATING STATUS stays consistent with admission for every restriction type', async () => {
    const customer = await createActiveCustomerWithWallet();
    // This fixture provisions KYC eligibility but no `customer_eligibility` record, so the honest
    // baseline projection is INELIGIBLE — never OPERABLE. What matters here is the restriction
    // precedence the admission boundary now enforces.
    expect((await eligibilityService.getOperatingStatus(customer.customerId)).status).toBe(
      'INELIGIBLE',
    );

    await restrict(customer.customerId, CustomerRestrictionType.FROZEN);
    const frozen = await eligibilityService.getOperatingStatus(customer.customerId);
    expect(frozen.status).toBe('FROZEN');
    expect(frozen.canOperate).toBe(false);

    await deactivateRestriction(customer.customerId, CustomerRestrictionType.FROZEN);
    await restrict(customer.customerId, CustomerRestrictionType.LIMITED);
    const limited = await eligibilityService.getOperatingStatus(customer.customerId);
    expect(limited.status).toBe('RESTRICTED');
    // LIMITED is still refused by the product operating-status projection but is not an admission
    // freeze — the two decisions stay independent, as approved policy requires.
    await expect(
      dataSource.transaction((manager) =>
        financialEligibility.require(manager, customer.customerId),
      ),
    ).resolves.toBe('LEVEL_1');
  }, 60000);
});
