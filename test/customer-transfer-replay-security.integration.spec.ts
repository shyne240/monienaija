import { randomUUID } from 'node:crypto';

import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { CustomerTransferCommand } from '../src/customer-financial-operations/customer-financial-operations.types';
import { CustomerTransferDestinationType } from '../src/customer-financial-operations/customer-financial-operations.types';
import { CUSTOMER_TRANSFER_IDEMPOTENCY_SCOPE } from '../src/customer-financial-operations/customer-financial-operations.service';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import {
  CustomerWalletStatus,
  CustomerWalletType,
} from '../src/customer-wallet/customer-wallet.enums';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';
import { seedTransactionPin, TEST_TRANSACTION_PIN } from './support/transaction-pin-harness';
import {
  createCustomerTransferStack,
  enableTransferPilot,
  seedFullyEligibleCustomer,
  selfPrincipal,
  type CustomerTransferStack,
} from './support/customer-transfer-stack';

const PIN = TEST_TRANSACTION_PIN;
const WRONG_PIN = '00000';

/**
 * V1-W2W-REPLAY-SECURITY-AUDIT proof against real PostgreSQL.
 *
 * The customer transfer command short-circuits on an idempotent REPLAY before
 * the A5T03 gate runs. These tests pin down the security boundary that makes
 * that safe: the replay short-circuit sits BEHIND the self-principal check,
 * the caller's own binding resolution and the transaction PIN step-up, and the
 * reservation it reads is bound to the caller's own source wallet account
 * through the request hash.
 *
 * Everything here runs the live graph against real PostgreSQL. Nothing that
 * participates in the security decision is mocked; the only jest spies observe
 * (without replacing) the gate and the ledger-posting step, to prove a replay
 * re-executes neither.
 */
describe('Customer transfer idempotent replay security boundary (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let stack: CustomerTransferStack;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('w2wreplaysec');
    stack = createCustomerTransferStack(dataSource);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  let pilotCohort: string[] = [];

  beforeEach(async () => {
    jest.restoreAllMocks();
    pilotCohort = [];
    await truncateAllTables(dataSource);
    await stack.ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Settlement asset',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
  });

  function transferCommand(
    customerId: string,
    destinationWalletAccountId: string,
    amountMinor: string,
    overrides: Partial<CustomerTransferCommand> = {},
  ): CustomerTransferCommand {
    return {
      customerId,
      principal: selfPrincipal(customerId),
      destination: {
        type: CustomerTransferDestinationType.WALLET_ACCOUNT,
        value: destinationWalletAccountId,
      },
      amountMinor,
      currency: 'NGN',
      idempotencyKey: `w2w-${randomUUID()}`,
      transactionPin: PIN,
      narration: 'replay security test',
      ...overrides,
    };
  }

  async function provisionParty(label: string, fundMinor = '0') {
    const customerId = await seedFullyEligibleCustomer(stack, { label });
    pilotCohort.push(customerId);
    await enableTransferPilot(stack, pilotCohort);
    await stack.customerWallets.createWallet(customerId, {
      type: CustomerWalletType.PRIMARY,
      currency: 'NGN',
      status: CustomerWalletStatus.ACTIVE,
      actor: 'integration-harness',
    });
    await seedTransactionPin(stack.pinStack, customerId, PIN);
    if (BigInt(fundMinor) > 0n) {
      const deposit = await stack.operations.createDeposit({
        customerId,
        amountMinor: fundMinor,
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await stack.operations.completeDeposit(customerId, deposit.id);
    }
    return customerId;
  }

  async function customerWalletAccountId(customerId: string): Promise<string> {
    const rows: Array<{ wallet_account_id: string }> = await dataSource.query(
      `SELECT wallet_account_id FROM customer_financial_account_bindings
       WHERE customer_id = $1 AND state = 'ACTIVE'`,
      [customerId],
    );
    return rows[0]!.wallet_account_id;
  }

  async function ledgerAccountFor(customerId: string): Promise<string> {
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM customer_financial_account_bindings
       WHERE customer_id = $1 AND state = 'ACTIVE'`,
      [customerId],
    );
    return rows[0]!.ledger_account_id;
  }

  async function balanceOf(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END), 0)::text AS balance
       FROM ledger_lines WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    return BigInt(rows[0]!.balance);
  }

  async function transferJournals(): Promise<Array<{ id: string; idempotency_key: string }>> {
    return dataSource.query(
      `SELECT id, idempotency_key FROM ledger_journals WHERE idempotency_key LIKE 'transfer:%'`,
    );
  }

  async function transferRows(): Promise<Array<Record<string, unknown>>> {
    return dataSource.query(`SELECT * FROM transfers`);
  }

  async function customerTransferRecords(): Promise<
    Array<{
      idempotency_key: string;
      request_hash: string;
      status: string;
      hit_count: number;
      response_body: Record<string, unknown> | null;
    }>
  > {
    return dataSource.query(
      `SELECT idempotency_key, request_hash, status, hit_count, response_body
       FROM idempotency_records WHERE scope = $1 ORDER BY created_at ASC`,
      [CUSTOMER_TRANSFER_IDEMPOTENCY_SCOPE],
    );
  }

  /**
   * The stored replay body is the JSON projection of the first response, so
   * `createdAt`/`completedAt` come back as ISO strings where the in-process
   * first response still holds Date objects. Over HTTP both serialize
   * identically, so equivalence is asserted on the JSON projection.
   */
  function jsonProjection(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value));
  }

  /** Every string that appears anywhere inside a thrown error, for leak checks. */
  function errorSurface(error: unknown): string {
    const candidate = error as { message?: unknown; getResponse?: () => unknown };
    const parts: unknown[] = [candidate?.message];
    if (typeof candidate?.getResponse === 'function') {
      parts.push(candidate.getResponse());
    }
    parts.push(String(error));
    return JSON.stringify(parts);
  }

  it('A: the same authorized customer replaying the same request gets the original result and no second movement', async () => {
    const source = await provisionParty('rs-a-src', '50000');
    const destination = await provisionParty('rs-a-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const command = transferCommand(source, destinationAccount, '20000');

    const first = await stack.operations.createTransfer(command);
    const replay = await stack.operations.createTransfer(command);

    expect(jsonProjection(replay)).toEqual(jsonProjection(first));
    expect(replay.id).toBe(first.id);
    expect(replay.journalId).toBe(first.journalId);
    expect((await transferRows()).length).toBe(1);
    expect((await transferJournals()).length).toBe(1);

    const sourceLedger = await ledgerAccountFor(source);
    const destinationLedger = await ledgerAccountFor(destination);
    expect(await balanceOf(sourceLedger)).toBe(30000n);
    expect(await balanceOf(destinationLedger)).toBe(20000n);

    // Exactly one reservation, hit once by the replay.
    const records = await customerTransferRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.status).toBe('COMPLETED');
    expect(Number(records[0]!.hit_count)).toBe(1);
  });

  it('D: a replay re-executes neither the A5 gate nor the ledger posting', async () => {
    const source = await provisionParty('rs-d-src', '50000');
    const destination = await provisionParty('rs-d-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const command = transferCommand(source, destinationAccount, '20000');

    await stack.operations.createTransfer(command);

    // Observe the real collaborators without replacing their behaviour.
    const gateSpy = jest.spyOn(stack.gate, 'validate');
    const postSpy = jest.spyOn(stack.lifecycle, 'postToLedger');
    const createPendingSpy = jest.spyOn(stack.lifecycle, 'createPending');

    const replay = await stack.operations.createTransfer(command);

    expect(gateSpy).not.toHaveBeenCalled();
    expect(createPendingSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    expect(replay.status).toBe('COMPLETED');
    expect((await transferJournals()).length).toBe(1);
  });

  it('B: another customer reusing the same idempotency key is denied and learns nothing about the original transfer', async () => {
    const victim = await provisionParty('rs-b-victim', '50000');
    const attacker = await provisionParty('rs-b-attacker', '50000');
    const destination = await provisionParty('rs-b-dst');
    const destinationAccount = await customerWalletAccountId(destination);

    const sharedKey = `w2w-shared-${randomUUID()}`;
    const original = await stack.operations.createTransfer(
      transferCommand(victim, destinationAccount, '20000', { idempotencyKey: sharedKey }),
    );

    // The attacker is a fully authenticated customer with a valid PIN of their
    // own; the ONLY thing they borrow is the victim's idempotency key.
    const attack = stack.operations.createTransfer(
      transferCommand(attacker, destinationAccount, '20000', { idempotencyKey: sharedKey }),
    );
    await expect(attack).rejects.toBeInstanceOf(ConflictException);

    const error = await attack.catch((caught: unknown) => caught);
    const surface = errorSurface(error);
    // No field of the victim's transfer may appear in the attacker's response.
    expect(surface).not.toContain(original.id);
    expect(surface).not.toContain(String(original.journalId));
    expect(surface).not.toContain(victim);
    expect(surface).not.toContain(await customerWalletAccountId(victim));

    // The victim's transfer and the stored reservation are untouched.
    expect((await transferRows()).length).toBe(1);
    expect((await transferJournals()).length).toBe(1);
    const records = await customerTransferRecords();
    expect(records).toHaveLength(1);
    expect((records[0]!.response_body as { id?: string } | null)?.id).toBe(original.id);

    // No money moved for the attacker.
    const attackerLedger = await ledgerAccountFor(attacker);
    expect(await balanceOf(attackerLedger)).toBe(50000n);
    expect(await balanceOf(await ledgerAccountFor(victim))).toBe(30000n);
    expect(await balanceOf(await ledgerAccountFor(destination))).toBe(20000n);
  });

  it('C: a mismatched principal cannot reach the replay short-circuit at all', async () => {
    const victim = await provisionParty('rs-c-victim', '50000');
    const attacker = await provisionParty('rs-c-attacker', '50000');
    const destination = await provisionParty('rs-c-dst');
    const destinationAccount = await customerWalletAccountId(destination);

    const sharedKey = `w2w-shared-${randomUUID()}`;
    const original = await stack.operations.createTransfer(
      transferCommand(victim, destinationAccount, '20000', { idempotencyKey: sharedKey }),
    );

    // Authenticated as the attacker, but addressing the victim's customer
    // context (the /customers/:id path the controller forwards verbatim).
    const impersonation = stack.operations.createTransfer(
      transferCommand(victim, destinationAccount, '20000', {
        idempotencyKey: sharedKey,
        principal: selfPrincipal(attacker),
      }),
    );
    await expect(impersonation).rejects.toBeInstanceOf(UnauthorizedException);
    const surface = errorSurface(await impersonation.catch((caught: unknown) => caught));
    expect(surface).not.toContain(original.id);
    expect(surface).not.toContain(String(original.journalId));

    // A principal with no customer identity is rejected the same way.
    await expect(
      stack.operations.createTransfer(
        transferCommand(victim, destinationAccount, '20000', {
          idempotencyKey: sharedKey,
          principal: undefined as never,
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect((await transferRows()).length).toBe(1);
    expect((await transferJournals()).length).toBe(1);
    expect(await balanceOf(await ledgerAccountFor(victim))).toBe(30000n);
    expect(await balanceOf(await ledgerAccountFor(attacker))).toBe(50000n);
  });

  it('PIN: a replay of the customer own request still requires the transaction PIN', async () => {
    const source = await provisionParty('rs-pin-src', '50000');
    const destination = await provisionParty('rs-pin-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const command = transferCommand(source, destinationAccount, '20000');

    const first = await stack.operations.createTransfer(command);

    // Same customer, same idempotency material, wrong PIN: the step-up runs
    // BEFORE the reservation is read, so the stored result stays sealed.
    const wrongPin = stack.operations.createTransfer({ ...command, transactionPin: WRONG_PIN });
    await expect(wrongPin).rejects.toBeTruthy();
    const surface = errorSurface(await wrongPin.catch((caught: unknown) => caught));
    expect(surface).not.toContain(first.id);
    expect(surface).not.toContain(String(first.journalId));

    // A missing PIN is refused the same way. The field is typed as required,
    // so this models an untyped/hand-rolled client reaching the boundary.
    const missingPin = stack.operations.createTransfer({
      ...command,
      transactionPin: undefined as unknown as string,
    });
    await expect(missingPin).rejects.toBeTruthy();
    expect(errorSurface(await missingPin.catch((caught: unknown) => caught))).not.toContain(
      first.id,
    );

    // Still exactly one movement, and the correct PIN still replays cleanly.
    expect((await transferJournals()).length).toBe(1);
    const replay = await stack.operations.createTransfer(command);
    expect(jsonProjection(replay)).toEqual(jsonProjection(first));
    expect((await transferJournals()).length).toBe(1);
  });

  it('E+F: the first execution is unchanged and an altered request on the same key is still a conflict', async () => {
    const source = await provisionParty('rs-f-src', '50000');
    const destination = await provisionParty('rs-f-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const key = `w2w-${randomUUID()}`;
    const command = transferCommand(source, destinationAccount, '20000', { idempotencyKey: key });

    const first = await stack.operations.createTransfer(command);
    const storedBefore = (await customerTransferRecords())[0]!;

    await expect(
      stack.operations.createTransfer({ ...command, amountMinor: '25000' }),
    ).rejects.toBeInstanceOf(ConflictException);

    const storedAfter = (await customerTransferRecords())[0]!;
    expect(storedAfter.request_hash).toBe(storedBefore.request_hash);
    expect(storedAfter.response_body).toEqual(storedBefore.response_body);
    expect((storedAfter.response_body as { id?: string } | null)?.id).toBe(first.id);
    expect((await transferRows()).length).toBe(1);
    expect((await transferJournals()).length).toBe(1);
    expect(await balanceOf(await ledgerAccountFor(source))).toBe(30000n);
  });

  it('G: concurrent duplicates still collapse to exactly one movement', async () => {
    const source = await provisionParty('rs-g-src', '50000');
    const destination = await provisionParty('rs-g-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const command = transferCommand(source, destinationAccount, '20000');

    const results = await Promise.allSettled([
      stack.operations.createTransfer(command),
      stack.operations.createTransfer(command),
      stack.operations.createTransfer(command),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    expect((await transferRows()).length).toBe(1);
    expect((await transferJournals()).length).toBe(1);
    expect(await balanceOf(await ledgerAccountFor(source))).toBe(30000n);
    expect(await balanceOf(await ledgerAccountFor(destination))).toBe(20000n);
  });

  it('the stored reservation is bound to the caller own source wallet account', async () => {
    // The request hash is what prevents one customer from ever matching
    // another customer's reservation: it commits to the source wallet account,
    // which is unique per binding (uq_..._wallet_account) and therefore per
    // customer. Two customers issuing an otherwise identical transfer under
    // the same key produce different hashes, so a cross-customer REPLAY is
    // unreachable by construction rather than by message filtering.
    const alice = await provisionParty('rs-h-alice', '50000');
    const bob = await provisionParty('rs-h-bob', '50000');
    const destination = await provisionParty('rs-h-dst');
    const destinationAccount = await customerWalletAccountId(destination);

    await stack.operations.createTransfer(
      transferCommand(alice, destinationAccount, '20000', { idempotencyKey: `k-${randomUUID()}` }),
    );
    await stack.operations.createTransfer(
      transferCommand(bob, destinationAccount, '20000', { idempotencyKey: `k-${randomUUID()}` }),
    );

    const records = await customerTransferRecords();
    expect(records).toHaveLength(2);
    expect(records[0]!.request_hash).not.toBe(records[1]!.request_hash);
  });
});
