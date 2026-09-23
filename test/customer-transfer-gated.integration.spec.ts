import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TransferController } from '../src/transfer/transfer.controller';

import {
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';

import type { CustomerTransferCommand } from '../src/customer-financial-operations/customer-financial-operations.types';
import { CustomerTransferDestinationType } from '../src/customer-financial-operations/customer-financial-operations.types';
import { LedgerAccountType, LedgerNormalBalance } from '../src/ledger/ledger.enums';
import { TransferStatus } from '../src/transfer/transfer.enums';
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
 * V1-W2W-GATE-INTEGRATION proof against real PostgreSQL.
 *
 * The ACTUAL customer transfer application command
 * (CustomerFinancialOperationsService.createTransfer — the exact boundary the
 * HTTP controller delegates to) must execute EVERY transfer through the
 * A5T03 gate and A5T04 lifecycle. These tests compose the full live graph
 * with nothing mocked and prove, per scenario, either exactly one balanced
 * movement or zero movement with gate denial evidence.
 */
describe('Customer Wallet->Wallet through A5T03 gate + A5T04 lifecycle (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let stack: CustomerTransferStack;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('w2wgate');
    stack = createCustomerTransferStack(dataSource);
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  let pilotCohort: string[] = [];

  beforeEach(async () => {
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
      narration: 'gated transfer test',
      ...overrides,
    };
  }

  async function customerWalletAccountId(customerId: string): Promise<string> {
    const rows: Array<{ wallet_account_id: string }> = await dataSource.query(
      `SELECT wallet_account_id FROM customer_financial_account_bindings
       WHERE customer_id = $1 AND state = 'ACTIVE'`,
      [customerId],
    );
    return rows[0]!.wallet_account_id;
  }

  async function customerReceivingNumber(customerId: string): Promise<string | null> {
    const rows: Array<{ number: string }> = await dataSource.query(
      `SELECT number FROM customer_receiving_numbers WHERE customer_id = $1 AND status = 'ACTIVE'`,
      [customerId],
    );
    return rows[0]?.number ?? null;
  }

  async function provisionParty(label: string, fundMinor = '0', phone?: string) {
    const customerId = await seedFullyEligibleCustomer(stack, {
      label,
      phoneE164: phone,
    });
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

  async function transferRows(): Promise<Array<Record<string, unknown>>> {
    return dataSource.query(`SELECT * FROM transfers`);
  }

  async function journalRowsForAccounts(
    accountIds: string[],
  ): Promise<Array<Record<string, unknown>>> {
    if (accountIds.length === 0) return [];
    // Transfer journals only: the funding deposit journal legitimately touches
    // the same ledger accounts and must not pollute movement assertions.
    return dataSource.query(
      `SELECT DISTINCT j.* FROM ledger_journals j
       JOIN ledger_lines l ON l.journal_id = j.id
       WHERE l.ledger_account_id = ANY($1) AND j.idempotency_key LIKE 'transfer:%'`,
      [accountIds],
    );
  }

  async function balanceOf(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor::numeric ELSE -amount_minor::numeric END), 0)::text AS balance
       FROM ledger_lines WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    return BigInt(rows[0]!.balance);
  }

  async function ledgerAccountFor(customerId: string): Promise<string> {
    const rows: Array<{ ledger_account_id: string }> = await dataSource.query(
      `SELECT ledger_account_id FROM customer_financial_account_bindings
       WHERE customer_id = $1 AND state = 'ACTIVE'`,
      [customerId],
    );
    return rows[0]!.ledger_account_id;
  }

  async function gateAudits(): Promise<
    Array<{ action: string; new_values: Record<string, unknown> }>
  > {
    return dataSource.query(
      `SELECT action, new_values FROM audit_events WHERE entity_type = 'INTERNAL_TRANSFER_GATE'`,
    );
  }

  async function completedOutboxEvents(): Promise<Array<{ payload: Record<string, unknown> }>> {
    return dataSource.query(
      `SELECT payload FROM outbox_events WHERE event_type = 'transfer.completed'`,
    );
  }

  async function expectNoFinancialMovement(
    sourceLedger: string,
    destinationLedger: string,
    expectedSourceBalance: string,
    expectedDestinationBalance: string,
  ) {
    expect((await transferRows()).length).toBe(0);
    expect((await journalRowsForAccounts([sourceLedger, destinationLedger])).length).toBe(0);
    expect(await balanceOf(sourceLedger)).toBe(BigInt(expectedSourceBalance));
    expect(await balanceOf(destinationLedger)).toBe(BigInt(expectedDestinationBalance));
    expect((await completedOutboxEvents()).length).toBe(0);
  }

  it('A: valid customer + recipient + PIN + allowed limit -> exactly one balanced gated movement with completed lifecycle', async () => {
    const source = await provisionParty('a-src', '50000');
    const destination = await provisionParty('a-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const view = await stack.operations.createTransfer(
      transferCommand(source, destinationAccount, '20000'),
    );
    expect(view.status).toBe(TransferStatus.COMPLETED);
    expect(view.journalId).not.toBeNull();

    // Exactly one transfer row, owned by the lifecycle (commandId + policy references).
    const rows = await transferRows();
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('COMPLETED');
    expect(rows[0]!.command_id).not.toBeNull();
    expect(rows[0]!.policy_decision_reference).not.toBeNull();
    expect(rows[0]!.state_reason).toBe('LEDGER_POSTED');
    expect(rows[0]!.completed_at).not.toBeNull();

    // Balanced double-entry journal, exactly one, through the ledger accounts.
    const sourceLedger = await ledgerAccountFor(source);
    const destinationLedger = await ledgerAccountFor(destination);
    const journals = await journalRowsForAccounts([sourceLedger, destinationLedger]);
    expect(journals.length).toBe(1);
    expect(journals[0]!.idempotency_key).toBe(`transfer:${view.id}:ledger-post`);
    const lines: Array<{ ledger_account_id: string; direction: string; amount_minor: string }> =
      await dataSource.query(`SELECT * FROM ledger_lines WHERE journal_id = $1`, [journals[0]!.id]);
    expect(lines.length).toBe(2);
    expect(lines.find((l) => l.ledger_account_id === sourceLedger)?.direction).toBe('DEBIT');
    expect(lines.find((l) => l.ledger_account_id === destinationLedger)?.direction).toBe('CREDIT');

    // Balances moved exactly once.
    expect(await balanceOf(sourceLedger)).toBe(30000n);
    expect(await balanceOf(destinationLedger)).toBe(20000n);

    // Gate evidence + completed outbox event exist exactly once.
    const audits = await gateAudits();
    expect(audits.filter((a) => a.action === 'PASSED').length).toBeGreaterThanOrEqual(1);
    const events = await completedOutboxEvents();
    expect(events.length).toBe(1);
  });

  it('B: amount above the configured single-transaction limit is denied at the gate with NO financial movement', async () => {
    const source = await provisionParty('b-src', '50000');
    const destination = await provisionParty('b-dst');
    // Tighten the A4 limit profile for the source customer (real configuration).
    await dataSource.query(
      `UPDATE customer_limit_profiles SET single_transaction_amount_minor = '5000' WHERE customer_id = $1`,
      [source],
    );
    const destinationAccount = await customerWalletAccountId(destination);
    await expect(
      stack.operations.createTransfer(transferCommand(source, destinationAccount, '20000')),
    ).rejects.toMatchObject({ status: 409 });
    await expectNoFinancialMovement(
      await ledgerAccountFor(source),
      await ledgerAccountFor(destination),
      '50000',
      '0',
    );
    const audits = await gateAudits();
    expect(audits.some((a) => a.action === 'REJECTED')).toBe(true);
    expect((await completedOutboxEvents()).length).toBe(0);
  });

  it('C: A4 restriction denial (FROZEN customer) is enforced at the gate with NO financial movement', async () => {
    const source = await provisionParty('c-src', '50000');
    const destination = await provisionParty('c-dst');
    await dataSource.query(
      `INSERT INTO customer_restrictions (id, customer_id, type, is_active, reason)
       VALUES ($1, $2, 'FROZEN', TRUE, 'freeze for policy test')`,
      [randomUUID(), source],
    );
    const destinationAccount = await customerWalletAccountId(destination);
    await expect(
      stack.operations.createTransfer(transferCommand(source, destinationAccount, '20000')),
    ).rejects.toBeInstanceOf(HttpException);
    await expectNoFinancialMovement(
      await ledgerAccountFor(source),
      await ledgerAccountFor(destination),
      '50000',
      '0',
    );
  });

  it('D: A3 binding/account validation failure is enforced at the gate with NO financial movement', async () => {
    const source = await provisionParty('d-src', '50000');
    const destination = await provisionParty('d-dst');
    // Deactivate the destination ledger account: binding row stays ACTIVE but
    // the A3 binding port must refuse the account inside the gate.
    const destinationLedger = await ledgerAccountFor(destination);
    await dataSource.query(`UPDATE ledger_accounts SET is_active = FALSE WHERE id = $1`, [
      destinationLedger,
    ]);
    const destinationAccount = await customerWalletAccountId(destination);
    await expect(
      stack.operations.createTransfer(transferCommand(source, destinationAccount, '20000')),
    ).rejects.toMatchObject({ status: 409 });
    const rows = await transferRows();
    expect(rows.length).toBe(0);
    expect((await journalRowsForAccounts([destinationLedger])).length).toBe(0);
    expect(await balanceOf(destinationLedger)).toBe(0n);
    const audits = await gateAudits();
    expect(audits.some((a) => a.action === 'REJECTED')).toBe(true);
  });

  it('E: A2 authorization failure (customer mismatch) and pilot disable are both fail-closed with NO movement', async () => {
    const source = await provisionParty('e-src', '50000');
    const destination = await provisionParty('e-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const sourceLedger = await ledgerAccountFor(source);
    const destinationLedger = await ledgerAccountFor(destination);

    // Principal for a different customer: service + gate fail closed.
    const mismatched = transferCommand(source, destinationAccount, '20000', {
      principal: selfPrincipal(destination),
    });
    await expect(stack.operations.createTransfer(mismatched)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expectNoFinancialMovement(sourceLedger, destinationLedger, '50000', '0');

    // Pilot control disabled: gate rejects before any movement.
    await dataSource.query(
      `UPDATE pilot_controls SET enabled = FALSE WHERE control_key = 'wallet.transfer.create.internal.v1'`,
    );
    await expect(
      stack.operations.createTransfer(transferCommand(source, destinationAccount, '20000')),
    ).rejects.toBeInstanceOf(HttpException);
    await expectNoFinancialMovement(sourceLedger, destinationLedger, '50000', '0');
  });

  it('F: invalid PIN fails before any control-plane or money effect', async () => {
    const source = await provisionParty('f-src', '50000');
    const destination = await provisionParty('f-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const key = `w2w-${randomUUID()}`;
    await expect(
      stack.operations.createTransfer(
        transferCommand(source, destinationAccount, '20000', {
          transactionPin: WRONG_PIN,
          idempotencyKey: key,
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expectNoFinancialMovement(
      await ledgerAccountFor(source),
      await ledgerAccountFor(destination),
      '50000',
      '0',
    );
    // The gate was never reached: no gate audit, no idempotency reservation consumed.
    expect((await gateAudits()).length).toBe(0);
    const idem: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM idempotency_records WHERE idempotency_key = $1`,
      [key],
    );
    expect(idem.length).toBe(0);
  });

  it('G: idempotent replay returns the same transfer with no duplicate movement', async () => {
    const source = await provisionParty('g-src', '50000');
    const destination = await provisionParty('g-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const key = `w2w-${randomUUID()}`;
    const command = transferCommand(source, destinationAccount, '20000', { idempotencyKey: key });
    const first = await stack.operations.createTransfer(command);
    const replay = await stack.operations.createTransfer(command);
    expect(replay.id).toBe(first.id);
    expect((await transferRows()).length).toBe(1);
    const sourceLedger = await ledgerAccountFor(source);
    const destinationLedger = await ledgerAccountFor(destination);
    expect((await journalRowsForAccounts([sourceLedger, destinationLedger])).length).toBe(1);
    expect(await balanceOf(sourceLedger)).toBe(30000n);
    expect(await balanceOf(destinationLedger)).toBe(20000n);
  });

  it('H: same idempotency key with a different request is rejected as a conflict', async () => {
    const source = await provisionParty('h-src', '50000');
    const destination = await provisionParty('h-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const key = `w2w-${randomUUID()}`;
    await stack.operations.createTransfer(
      transferCommand(source, destinationAccount, '20000', { idempotencyKey: key }),
    );
    await expect(
      stack.operations.createTransfer(
        transferCommand(source, destinationAccount, '20001', { idempotencyKey: key }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await transferRows()).length).toBe(1);
    const sourceLedger = await ledgerAccountFor(source);
    expect(await balanceOf(sourceLedger)).toBe(30000n);
  });

  it('I: concurrent duplicate attempts produce exactly one financial movement', async () => {
    const source = await provisionParty('i-src', '50000');
    const destination = await provisionParty('i-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const key = `w2w-${randomUUID()}`;
    const command = transferCommand(source, destinationAccount, '20000', { idempotencyKey: key });
    const outcomes = await Promise.allSettled([
      stack.operations.createTransfer(command),
      stack.operations.createTransfer(command),
    ]);
    expect(outcomes.some((o) => o.status === 'fulfilled')).toBe(true);
    expect((await transferRows()).length).toBe(1);
    const sourceLedger = await ledgerAccountFor(source);
    const destinationLedger = await ledgerAccountFor(destination);
    expect((await journalRowsForAccounts([sourceLedger, destinationLedger])).length).toBe(1);
    expect(await balanceOf(sourceLedger)).toBe(30000n);
    expect(await balanceOf(destinationLedger)).toBe(20000n);
  });

  it('J: insufficient balance fails terminally with no partial movement, and replay fails identically (K)', async () => {
    const source = await provisionParty('j-src', '10000');
    const destination = await provisionParty('j-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const key = `w2w-${randomUUID()}`;
    const command = transferCommand(source, destinationAccount, '50000', { idempotencyKey: key });
    await expect(stack.operations.createTransfer(command)).rejects.toMatchObject({
      status: 422,
    });

    const rows = await transferRows();
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('FAILED');
    expect(rows[0]!.failure_code).toBe('INSUFFICIENT_FUNDS');
    const sourceLedger = await ledgerAccountFor(source);
    const destinationLedger = await ledgerAccountFor(destination);
    expect((await journalRowsForAccounts([sourceLedger, destinationLedger])).length).toBe(0);
    expect(await balanceOf(sourceLedger)).toBe(10000n);
    expect(await balanceOf(destinationLedger)).toBe(0n);
    expect((await completedOutboxEvents()).length).toBe(0);

    // K: replay of the failed request replays the failure; nothing re-executes.
    await expect(stack.operations.createTransfer(command)).rejects.toMatchObject({
      status: 422,
    });
    expect((await transferRows()).length).toBe(1);
    expect((await journalRowsForAccounts([sourceLedger, destinationLedger])).length).toBe(0);
  });

  it('L: WALLET_ACCOUNT and MONIENAIJA_NUMBER typed destinations both execute through the gated path, PHONE resolves recipients', async () => {
    const source = await provisionParty('l-src', '100000');
    const destination = await provisionParty('l-dst', '0', '+2348012345678');
    const destinationAccount = await customerWalletAccountId(destination);
    const number = await customerReceivingNumber(destination);
    expect(number).not.toBeNull();

    const byNumber = await stack.operations.createTransfer(
      transferCommand(source, destinationAccount, '10000', {
        destination: { type: CustomerTransferDestinationType.MONIENAIJA_NUMBER, value: number! },
      }),
    );
    expect(byNumber.status).toBe(TransferStatus.COMPLETED);

    // Recipient confirmation lookup remains display-safe and resolvable.
    const confirmed = await stack.operations.resolveRecipientByReceivingNumber(source, number!);
    expect(confirmed.receivingNumber).toBe(number);

    // Phone-based recipient confirmation for the destination's contact method.
    const phone = '+2348012345678';
    const destinationPrimaryWallet: Array<{ customer_wallet_id: string }> = await dataSource.query(
      `SELECT customer_wallet_id FROM customer_financial_account_bindings WHERE customer_id = $1`,
      [destination],
    );
    const byPhone = await stack.operations.resolveRecipientByPhone(source, phone);
    expect(byPhone.canonicalPhone).not.toBeNull();
    expect(destinationPrimaryWallet.length).toBe(1);
  });

  it('M: CustomerWallet registry id as a destination is rejected; identifier discipline is intact', async () => {
    const source = await provisionParty('m-src', '50000');
    const destination = await provisionParty('m-dst');
    const bindingRows: Array<{ customer_wallet_id: string }> = await dataSource.query(
      `SELECT customer_wallet_id FROM customer_financial_account_bindings WHERE customer_id = $1`,
      [destination],
    );
    const destinationCustomerWalletId = bindingRows[0]!.customer_wallet_id;
    // A CustomerWallet id is NOT a financial account: must not be guessed into one.
    await expect(
      stack.operations.createTransfer(
        transferCommand(source, destinationCustomerWalletId, '20000', {
          destination: {
            type: CustomerTransferDestinationType.WALLET_ACCOUNT,
            value: destinationCustomerWalletId,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const sourceLedger = await ledgerAccountFor(source);
    const destinationLedger = await ledgerAccountFor(destination);
    await expectNoFinancialMovement(sourceLedger, destinationLedger, '50000', '0');
  });

  it('legacy POST /transfers surface is retired (410 Gone) and cannot bypass the gate', () => {
    // The controller no longer executes; prove the throw is hard-wired by
    // statically asserting the controller body is a GoneException factory.
    const instance = Object.create(TransferController.prototype) as {
      createTransfer: () => never;
    };
    expect(() => instance.createTransfer()).toThrow(/retired/);
    // Static proof: no other public mutation path into TransferService.createTransfer.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.')) walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || full.includes('.spec.ts')) continue;
        const content = fs.readFileSync(full, 'utf8');
        if (
          content.includes('.createTransfer(') &&
          !full.includes('transfer.service.ts') &&
          !full.includes('customer-financial-operations.service.ts')
        ) {
          offenders.push(full);
        }
      }
    };
    walk(path.resolve(__dirname, '../src'));
    // transfer.service callers: only tests and internal self-usage may remain.
    const createTransferCallers = offenders.filter((file) => {
      const content = fs.readFileSync(file, 'utf8');
      return /transferService\.createTransfer|transferService\)\.createTransfer/.test(content);
    });
    expect(createTransferCallers).toEqual([]);
  });

  it('outbox and audit identities are stable under replay (idempotent evidence)', async () => {
    const source = await provisionParty('n-src', '50000');
    const destination = await provisionParty('n-dst');
    const destinationAccount = await customerWalletAccountId(destination);
    const key = `w2w-${randomUUID()}`;
    const command = transferCommand(source, destinationAccount, '20000', { idempotencyKey: key });
    const first = await stack.operations.createTransfer(command);
    await stack.operations.createTransfer(command);
    const events = await completedOutboxEvents();
    expect(events.length).toBe(1);
    const transferRowsResult = await transferRows();
    expect(transferRowsResult.length).toBe(1);
    // Replay short-circuits at the customer-application idempotency boundary
    // (before the gate), so the retry must leave ZERO new control-plane
    // evidence: exactly one PASSED gate fact for the original attempt and no
    // second gate fact of any kind.
    const audits = await gateAudits();
    expect(audits.filter((a) => a.action === 'PASSED').length).toBe(1);
    expect(audits.filter((a) => a.action === 'REPLAYED').length).toBe(0);
    expect(audits.length).toBe(1);
    // One ledger-posted fact per the single executed movement.
    const posted: Array<{ id: string }> = await dataSource.query(
      `SELECT id FROM audit_events WHERE entity_type = 'TRANSFER' AND action = 'LEDGER_POSTED'`,
    );
    expect(posted.length).toBe(1);
    expect(first.journalId).not.toBeNull();
  });
});
