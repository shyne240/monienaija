import { randomUUID } from 'node:crypto';
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { Deposit } from '../src/deposit/deposit.entity';
import { DepositFailureCode, DepositStatus } from '../src/deposit/deposit.enums';
import { DepositService } from '../src/deposit/deposit.service';
import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';
import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { MetricsService } from '../src/operations/metrics.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { PaymentReferenceService } from '../src/payment/payment-reference.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';
import { Transfer } from '../src/transfer/transfer.entity';
import { TransferStatus } from '../src/transfer/transfer.enums';
import { TransferService } from '../src/transfer/transfer.service';
import { WalletAccount } from '../src/wallet/wallet-account.entity';
import { Withdrawal } from '../src/withdrawal/withdrawal.entity';
import { WithdrawalFailureCode, WithdrawalStatus } from '../src/withdrawal/withdrawal.enums';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

/**
 * A5T05 / A5T06 — deposit, withdrawal and legacy TransferService lifecycle coverage against
 * real PostgreSQL.
 *
 * These three services were previously exercised only against Map-backed repositories and a
 * fake DataSource. This suite runs them against the real migration-produced schema with real
 * repositories, real transactions and real constraints/triggers, so that the money-movement
 * guarantees are evidenced rather than assumed.
 *
 * Scope note: TransferLifecycleService already has its own real-PG suite and is not
 * duplicated here. The createPending()/transition() retry question is explicitly out of
 * scope and is not touched.
 */
describe('A5 payment lifecycle (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let deposits: DepositService;
  let withdrawals: WithdrawalService;
  let transfers: TransferService;
  let ledger: LedgerService;

  let settlementAssetAccountId: string;
  let fundingAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a5payment');

    ledger = new LedgerService(
      dataSource.getRepository(LedgerAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource.getRepository(LedgerLine),
      dataSource,
    );
    const audit = new AuditService(dataSource.getRepository(AuditEvent));
    const outbox = new OutboxService(dataSource.getRepository(OutboxEvent));
    const metrics = new MetricsService(dataSource);
    const references = new PaymentReferenceService();
    const settlement = new SettlementAccountService();

    deposits = new DepositService(
      dataSource.getRepository(Deposit),
      dataSource,
      ledger,
      references,
      settlement,
      audit,
      outbox,
      metrics,
    );
    withdrawals = new WithdrawalService(
      dataSource.getRepository(Withdrawal),
      dataSource,
      ledger,
      references,
      settlement,
      audit,
      outbox,
      metrics,
    );
    transfers = new TransferService(
      dataSource.getRepository(Transfer),
      dataSource.getRepository(WalletAccount),
      dataSource.getRepository(LedgerJournal),
      dataSource,
      ledger,
      references,
      audit,
      outbox,
      metrics,
    );
  }, 180000);

  afterAll(async () => {
    if (dataSource) await destroyIntegrationDataSource(dataSource);
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);

    // Canonical settlement account, resolved by SettlementAccountService by code.
    const asset = await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Settlement asset',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    settlementAssetAccountId = asset.id;

    const funding = await ledger.createAccount({
      code: `FUNDING-${randomUUID().slice(0, 8)}`,
      name: 'Funding control',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    fundingAccountId = funding.id;
  }, 60000);

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  /**
   * Creates a real customer/wallet chain. The wallet ledger account deliberately disallows
   * negative balances: that is what the wallet_account_ledger_account_is_valid trigger
   * requires and what makes the insufficient-funds path reachable for real.
   */
  async function seedWallet(label: string): Promise<{ walletId: string; ledgerAccountId: string }> {
    const account = await ledger.createAccount({
      code: `WALLET-${label}-${randomUUID().slice(0, 8)}`,
      name: `Customer wallet ${label}`,
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: false,
    });
    const participant = await seedTransferParticipant(dataSource, label, account.id);
    return { walletId: participant.walletAccountId, ledgerAccountId: account.id };
  }

  /** Credits a wallet ledger account for real, so later debits have balance to consume. */
  async function fundWallet(ledgerAccountId: string, amountMinor: string): Promise<void> {
    await ledger.postJournal({
      idempotencyKey: `fund:${ledgerAccountId}:${randomUUID()}`,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      reference: `fund-${randomUUID().slice(0, 8)}`,
      description: 'Seed wallet balance',
      lines: [
        { accountId: fundingAccountId, direction: LedgerEntryDirection.DEBIT, amountMinor },
        { accountId: ledgerAccountId, direction: LedgerEntryDirection.CREDIT, amountMinor },
      ],
    });
  }

  async function balanceOf(ledgerAccountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    return BigInt(firstRow(rows, 'ledger balance').balance);
  }

  interface JournalLine {
    ledger_account_id: string;
    direction: string;
    amount_minor: string;
    currency: string;
    accounting_unit: string;
  }

  async function linesOf(journalId: string): Promise<JournalLine[]> {
    return await dataSource.query(
      `SELECT ledger_account_id, direction, amount_minor, currency, accounting_unit
         FROM ledger_lines WHERE journal_id = $1 ORDER BY line_number`,
      [journalId],
    );
  }

  /** Database-level money invariants for a posted journal. */
  async function assertBalancedJournal(
    journalId: string,
    expected: { debitAccount: string; creditAccount: string; amountMinor: string },
  ): Promise<void> {
    const lines = await linesOf(journalId);
    expect(lines).toHaveLength(2);

    const debits = lines.filter((l) => l.direction === 'DEBIT');
    const credits = lines.filter((l) => l.direction === 'CREDIT');
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);

    const debit = firstRow(debits, 'debit line');
    const credit = firstRow(credits, 'credit line');

    // Debit total == credit total.
    expect(BigInt(debit.amount_minor)).toBe(BigInt(credit.amount_minor));
    expect(BigInt(debit.amount_minor)).toBe(BigInt(expected.amountMinor));

    // Correct direction on the correct accounts.
    expect(debit.ledger_account_id).toBe(expected.debitAccount);
    expect(credit.ledger_account_id).toBe(expected.creditAccount);

    // Currency and accounting unit.
    for (const line of lines) {
      expect(line.currency).toBe('NGN');
      expect(line.accounting_unit).toBe('CUSTOMER_FUNDS');
    }

    const journals: Array<{ total_minor: string; currency: string; status: string }> =
      await dataSource.query(
        'SELECT total_minor, currency, status FROM ledger_journals WHERE id = $1',
        [journalId],
      );
    const journal = firstRow(journals, 'journal header');
    expect(BigInt(journal.total_minor)).toBe(BigInt(expected.amountMinor));
    expect(journal.currency).toBe('NGN');
    expect(journal.status).toBe('POSTED');
  }

  async function countRows(table: string): Promise<number> {
    const rows: Array<{ n: string }> = await dataSource.query(
      `SELECT count(*)::text AS n FROM ${table}`,
    );
    return Number(firstRow(rows, `${table} count`).n);
  }

  // =======================================================================================
  // DEPOSIT
  // =======================================================================================

  describe('DepositService', () => {
    it('completes a deposit with a correctly directed balanced journal', async () => {
      const wallet = await seedWallet('dep-ok');
      const before = await balanceOf(wallet.ledgerAccountId);

      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '25000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
        reference: 'deposit-ref',
        narration: 'integration deposit',
      });

      expect(created.status).toBe(DepositStatus.PENDING);
      expect(created.journalId).toBeNull();
      expect(created.paymentReference).toMatch(/^MN\d{12}$/);
      expect(created.amountMinor).toBe('25000');

      const completed = await deposits.completeDeposit(created.id);
      expect(completed.status).toBe(DepositStatus.COMPLETED);
      expect(completed.journalId).toBeTruthy();
      expect(completed.paymentReference).toBe(created.paymentReference);

      // A deposit debits the settlement asset and credits the customer wallet.
      await assertBalancedJournal(completed.journalId!, {
        debitAccount: settlementAssetAccountId,
        creditAccount: wallet.ledgerAccountId,
        amountMinor: '25000',
      });

      expect((await balanceOf(wallet.ledgerAccountId)) - before).toBe(25000n);
    });

    it('persists the payment reference row and audit/outbox effects', async () => {
      const wallet = await seedWallet('dep-effects');
      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await deposits.completeDeposit(created.id);

      const refs: Array<{ reference: string; payment_type: string }> = await dataSource.query(
        `SELECT reference, payment_type FROM payment_references WHERE payment_id = $1`,
        [created.id],
      );
      expect(firstRow(refs, 'payment reference').payment_type).toBe('DEPOSIT');
      expect(firstRow(refs, 'payment reference').reference).toBe(created.paymentReference);

      const audits: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM audit_events WHERE entity_type = 'DEPOSIT' AND entity_id = $1`,
        [created.id],
      );
      expect(audits.map((a) => a.action)).toContain('COMPLETED');

      const events: Array<{ event_type: string }> = await dataSource.query(
        `SELECT event_type FROM outbox_events WHERE aggregate_type = 'DEPOSIT' AND aggregate_id = $1`,
        [created.id],
      );
      expect(events.map((e) => e.event_type)).toContain('deposit.completed');
    });

    it('replays an identical create idempotently without a second deposit', async () => {
      const wallet = await seedWallet('dep-replay');
      const command = {
        walletId: wallet.walletId,
        amountMinor: '5000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      };
      const first = await deposits.createDeposit(command);
      const second = await deposits.createDeposit(command);

      expect(second.id).toBe(first.id);
      expect(second.paymentReference).toBe(first.paymentReference);
      expect(await countRows('deposits')).toBe(1);
      expect(await countRows('payment_references')).toBe(1);
    });

    it('is idempotent on completion and posts no second journal', async () => {
      const wallet = await seedWallet('dep-complete-replay');
      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '7000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      const first = await deposits.completeDeposit(created.id);
      const second = await deposits.completeDeposit(created.id);

      expect(second.journalId).toBe(first.journalId);
      // one funding journal for the wallet is not created here, so exactly one journal exists
      expect(await countRows('ledger_journals')).toBe(1);
      expect(await countRows('ledger_lines')).toBe(2);
      expect(await balanceOf(wallet.ledgerAccountId)).toBe(7000n);
    });

    it('rejects the same idempotency key carrying a different payload', async () => {
      const wallet = await seedWallet('dep-conflict');
      const key = `dep-${randomUUID()}`;
      await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '1200',
        currency: 'NGN',
        idempotencyKey: key,
      });

      await expect(
        deposits.createDeposit({
          walletId: wallet.walletId,
          amountMinor: '9999',
          currency: 'NGN',
          idempotencyKey: key,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(await countRows('deposits')).toBe(1);
      expect(await countRows('ledger_journals')).toBe(0);
    });

    it('fails a deposit into a suspended wallet without posting a journal', async () => {
      const wallet = await seedWallet('dep-suspended');
      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      await dataSource.query(`UPDATE wallet_accounts SET status = 'SUSPENDED' WHERE id = $1`, [
        wallet.walletId,
      ]);

      await expect(deposits.completeDeposit(created.id)).rejects.toBeInstanceOf(HttpException);

      const rows: Array<{ status: string; failure_code: string; journal_id: string | null }> =
        await dataSource.query(
          'SELECT status, failure_code, journal_id FROM deposits WHERE id = $1',
          [created.id],
        );
      const row = firstRow(rows, 'failed deposit');
      expect(row.status).toBe(DepositStatus.FAILED);
      expect(row.failure_code).toBe(DepositFailureCode.WALLET_NOT_ACTIVE);
      expect(row.journal_id).toBeNull();
      expect(await countRows('ledger_journals')).toBe(0);
      expect(await countRows('ledger_lines')).toBe(0);
    });

    it('rolls the whole completion back when the transaction aborts', async () => {
      const wallet = await seedWallet('dep-rollback');
      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '4000',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });

      // A genuine database failure inside the same transaction as the completion work.
      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          await manager.query(
            `UPDATE deposits SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
            [created.id],
          );
          // chk_deposits_completion_has_journal requires journal_id when COMPLETED.
          await manager.query('SELECT 1');
        }),
      ).rejects.toBeInstanceOf(QueryFailedError);

      const rows: Array<{ status: string; journal_id: string | null }> = await dataSource.query(
        'SELECT status, journal_id FROM deposits WHERE id = $1',
        [created.id],
      );
      const row = firstRow(rows, 'deposit after rollback');
      expect(row.status).toBe(DepositStatus.PENDING);
      expect(row.journal_id).toBeNull();
      expect(await countRows('ledger_journals')).toBe(0);
    });

    it('rolls audit, outbox and ledger back together with an aborted completion', async () => {
      const wallet = await seedWallet('dep-atomic');
      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '4500',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      const auditsBefore = await countRows('audit_events');
      const outboxBefore = await countRows('outbox_events');

      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          const journalId = await ledger.postJournalInTransaction(manager, {
            idempotencyKey: `deposit:${created.id}:completion`,
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
            reference: created.paymentReference,
            lines: [
              {
                accountId: settlementAssetAccountId,
                direction: LedgerEntryDirection.DEBIT,
                amountMinor: '4500',
              },
              {
                accountId: wallet.ledgerAccountId,
                direction: LedgerEntryDirection.CREDIT,
                amountMinor: '4500',
              },
            ],
          });
          await manager.query(
            `UPDATE deposits SET status = 'COMPLETED', journal_id = $1, completed_at = now() WHERE id = $2`,
            [journalId, created.id],
          );
          throw new Error('aborted after posting');
        }),
      ).rejects.toThrow('aborted after posting');

      expect(await countRows('ledger_journals')).toBe(0);
      expect(await countRows('ledger_lines')).toBe(0);
      expect(await countRows('audit_events')).toBe(auditsBefore);
      expect(await countRows('outbox_events')).toBe(outboxBefore);
      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM deposits WHERE id = $1',
        [created.id],
      );
      expect(firstRow(rows, 'deposit status').status).toBe(DepositStatus.PENDING);
    });

    it('rejects an unknown wallet', async () => {
      await expect(
        deposits.createDeposit({
          walletId: randomUUID(),
          amountMinor: '100',
          currency: 'NGN',
          idempotencyKey: `dep-${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await countRows('deposits')).toBe(0);
    });

    describe('database constraints', () => {
      it('enforces uq_deposits_idempotency_key', async () => {
        const wallet = await seedWallet('dep-uq-key');
        const created = await deposits.createDeposit({
          walletId: wallet.walletId,
          amountMinor: '1000',
          currency: 'NGN',
          idempotencyKey: `dep-${randomUUID()}`,
        });
        const depositRows: Array<Record<string, unknown>> = await dataSource.query(
          'SELECT * FROM deposits WHERE id = $1',
          [created.id],
        );
        const row = firstRow(depositRows, 'deposit row');
        await expect(
          dataSource.query(
            `INSERT INTO deposits (id, wallet_id, payment_reference, amount_minor, currency, status,
               idempotency_key, request_hash)
             VALUES ($1, $2, $3, 1, 'NGN', 'PENDING', $4, $5)`,
            [
              randomUUID(),
              wallet.walletId,
              `MN${'9'.repeat(12)}`,
              row.idempotency_key,
              row.request_hash,
            ],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);
      });

      it('enforces uq_deposits_payment_reference', async () => {
        const wallet = await seedWallet('dep-uq-ref');
        const created = await deposits.createDeposit({
          walletId: wallet.walletId,
          amountMinor: '1000',
          currency: 'NGN',
          idempotencyKey: `dep-${randomUUID()}`,
        });
        await expect(
          dataSource.query(
            `INSERT INTO deposits (id, wallet_id, payment_reference, amount_minor, currency, status,
               idempotency_key, request_hash)
             VALUES ($1, $2, $3, 1, 'NGN', 'PENDING', $4, $5)`,
            [randomUUID(), wallet.walletId, created.paymentReference, randomUUID(), 'a'.repeat(64)],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);
      });

      it('enforces chk_deposits_amount_positive and chk_deposits_completion_has_journal', async () => {
        const wallet = await seedWallet('dep-checks');
        await expect(
          dataSource.query(
            `INSERT INTO deposits (id, wallet_id, payment_reference, amount_minor, currency, status,
               idempotency_key, request_hash)
             VALUES ($1, $2, $3, 0, 'NGN', 'PENDING', $4, $5)`,
            [randomUUID(), wallet.walletId, `MN${'1'.repeat(12)}`, randomUUID(), 'a'.repeat(64)],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);

        await expect(
          dataSource.query(
            `INSERT INTO deposits (id, wallet_id, payment_reference, amount_minor, currency, status,
               idempotency_key, request_hash)
             VALUES ($1, $2, $3, 10, 'NGN', 'COMPLETED', $4, $5)`,
            [randomUUID(), wallet.walletId, `MN${'2'.repeat(12)}`, randomUUID(), 'a'.repeat(64)],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);
      });

      it('enforces the deposit wallet foreign key', async () => {
        await expect(
          dataSource.query(
            `INSERT INTO deposits (id, wallet_id, payment_reference, amount_minor, currency, status,
               idempotency_key, request_hash)
             VALUES ($1, $2, $3, 10, 'NGN', 'PENDING', $4, $5)`,
            [randomUUID(), randomUUID(), `MN${'3'.repeat(12)}`, randomUUID(), 'a'.repeat(64)],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);
      });
    });

    it('converges under genuine concurrent creates on one idempotency key', async () => {
      const wallet = await seedWallet('dep-concurrent');
      const command = {
        walletId: wallet.walletId,
        amountMinor: '800',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      };
      const settled = await Promise.allSettled(
        Array.from({ length: 5 }, () => deposits.createDeposit(command)),
      );
      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof deposits.createDeposit>>> =>
          r.status === 'fulfilled',
      );
      expect(fulfilled.length).toBeGreaterThan(0);
      const ids = new Set(fulfilled.map((r) => r.value.id));
      expect(ids.size).toBe(1);
      expect(await countRows('deposits')).toBe(1);
    });

    it('never double-credits under genuine concurrent completions', async () => {
      const wallet = await seedWallet('dep-concurrent-complete');
      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '2500',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });

      // Concurrent completions genuinely contend: each locks the deposit row FOR UPDATE and
      // then writes it, so PostgreSQL raises real serialization failures under SERIALIZABLE.
      // The service's bounded retry is what makes every caller converge instead of erroring.
      const settled = await Promise.allSettled([
        deposits.completeDeposit(created.id),
        deposits.completeDeposit(created.id),
        deposits.completeDeposit(created.id),
      ]);

      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      const serialization = rejected.filter((r) =>
        /could not serialize access|deadlock detected/i.test(String(r.reason)),
      );
      // Retry must absorb the contention: no caller may surface a raw serialization failure.
      expect(serialization).toHaveLength(0);
      expect(rejected).toHaveLength(0);

      expect(await countRows('ledger_journals')).toBe(1);
      expect(await balanceOf(wallet.ledgerAccountId)).toBe(2500n);
    });
  });

  // =======================================================================================
  // WITHDRAWAL
  // =======================================================================================

  describe('WithdrawalService', () => {
    async function fundedWallet(label: string, amountMinor = '100000') {
      const wallet = await seedWallet(label);
      await fundWallet(wallet.ledgerAccountId, amountMinor);
      return wallet;
    }

    it('completes a withdrawal with a correctly directed balanced journal', async () => {
      const wallet = await fundedWallet('wd-ok');
      const walletBefore = await balanceOf(wallet.ledgerAccountId);
      const settlementBefore = await balanceOf(settlementAssetAccountId);

      const created = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '15000',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
        reference: 'withdrawal-ref',
      });
      expect(created.status).toBe(WithdrawalStatus.PENDING);
      expect(created.paymentReference).toMatch(/^MN\d{12}$/);

      const processing = await withdrawals.processWithdrawal(created.id);
      expect(processing.status).toBe(WithdrawalStatus.PROCESSING);

      const completed = await withdrawals.completeWithdrawal(created.id);
      expect(completed.status).toBe(WithdrawalStatus.COMPLETED);
      expect(completed.journalId).toBeTruthy();
      expect(completed.amountMinor).toBe('15000');

      // A withdrawal debits the customer wallet and credits the settlement asset.
      await assertBalancedJournal(completed.journalId!, {
        debitAccount: wallet.ledgerAccountId,
        creditAccount: settlementAssetAccountId,
        amountMinor: '15000',
      });

      expect(walletBefore - (await balanceOf(wallet.ledgerAccountId))).toBe(15000n);
      expect((await balanceOf(settlementAssetAccountId)) - settlementBefore).toBe(15000n);
    });

    it('writes audit and outbox effects for a completed withdrawal', async () => {
      const wallet = await fundedWallet('wd-effects');
      const created = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
      });
      await withdrawals.processWithdrawal(created.id);
      await withdrawals.completeWithdrawal(created.id);

      const audits: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM audit_events WHERE entity_type = 'WITHDRAWAL' AND entity_id = $1`,
        [created.id],
      );
      expect(audits.map((a) => a.action)).toContain('COMPLETED');
      const events: Array<{ event_type: string }> = await dataSource.query(
        `SELECT event_type FROM outbox_events WHERE aggregate_type = 'WITHDRAWAL' AND aggregate_id = $1`,
        [created.id],
      );
      expect(events.map((e) => e.event_type)).toContain('withdrawal.completed');
    });

    it('marks an under-funded withdrawal FAILED with INSUFFICIENT_FUNDS and posts no journal', async () => {
      // Deliberately verifying the actual implemented behaviour: the ledger rejects the debit
      // and the service records a terminal FAILED state rather than leaving the row pending.
      const wallet = await fundedWallet('wd-insufficient', '1000');
      const created = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '999999',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
      });
      await withdrawals.processWithdrawal(created.id);

      await expect(withdrawals.completeWithdrawal(created.id)).rejects.toBeInstanceOf(
        HttpException,
      );

      const rows: Array<{ status: string; failure_code: string; journal_id: string | null }> =
        await dataSource.query(
          'SELECT status, failure_code, journal_id FROM withdrawals WHERE id = $1',
          [created.id],
        );
      const row = firstRow(rows, 'failed withdrawal');
      expect(row.status).toBe(WithdrawalStatus.FAILED);
      expect(row.failure_code).toBe(WithdrawalFailureCode.INSUFFICIENT_FUNDS);
      expect(row.journal_id).toBeNull();

      // Only the funding journal exists; no withdrawal journal was posted.
      expect(await countRows('ledger_journals')).toBe(1);
      expect(await balanceOf(wallet.ledgerAccountId)).toBe(1000n);
    });

    it('replays an identical create idempotently without a double debit', async () => {
      const wallet = await fundedWallet('wd-replay');
      const command = {
        walletId: wallet.walletId,
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
      };
      const first = await withdrawals.createWithdrawal(command);
      const second = await withdrawals.createWithdrawal(command);
      expect(second.id).toBe(first.id);
      expect(await countRows('withdrawals')).toBe(1);

      await withdrawals.processWithdrawal(first.id);
      const a = await withdrawals.completeWithdrawal(first.id);
      const b = await withdrawals.completeWithdrawal(first.id);
      expect(b.journalId).toBe(a.journalId);

      // funding journal + exactly one withdrawal journal
      expect(await countRows('ledger_journals')).toBe(2);
      expect(await balanceOf(wallet.ledgerAccountId)).toBe(98000n);
    });

    it('rejects the same idempotency key carrying a different payload', async () => {
      const wallet = await fundedWallet('wd-conflict');
      const key = `wd-${randomUUID()}`;
      await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '500',
        currency: 'NGN',
        idempotencyKey: key,
      });
      await expect(
        withdrawals.createWithdrawal({
          walletId: wallet.walletId,
          amountMinor: '600',
          currency: 'NGN',
          idempotencyKey: key,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await countRows('withdrawals')).toBe(1);
    });

    it('rolls an aborted withdrawal completion back atomically', async () => {
      const wallet = await fundedWallet('wd-rollback');
      const created = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `wd-${randomUUID()}`,
      });
      await withdrawals.processWithdrawal(created.id);
      const journalsBefore = await countRows('ledger_journals');

      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          const journalId = await ledger.postJournalInTransaction(manager, {
            idempotencyKey: `withdrawal:${created.id}:completion`,
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
            reference: created.paymentReference,
            lines: [
              {
                accountId: wallet.ledgerAccountId,
                direction: LedgerEntryDirection.DEBIT,
                amountMinor: '3000',
              },
              {
                accountId: settlementAssetAccountId,
                direction: LedgerEntryDirection.CREDIT,
                amountMinor: '3000',
              },
            ],
          });
          await manager.query(
            `UPDATE withdrawals SET status = 'COMPLETED', journal_id = $1, completed_at = now() WHERE id = $2`,
            [journalId, created.id],
          );
          throw new Error('aborted after posting');
        }),
      ).rejects.toThrow('aborted after posting');

      expect(await countRows('ledger_journals')).toBe(journalsBefore);
      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM withdrawals WHERE id = $1',
        [created.id],
      );
      expect(firstRow(rows, 'withdrawal status').status).toBe(WithdrawalStatus.PROCESSING);
      expect(await balanceOf(wallet.ledgerAccountId)).toBe(100000n);
    });

    describe('database constraints', () => {
      it('enforces uq_withdrawals_idempotency_key and the completion CHECK', async () => {
        const wallet = await fundedWallet('wd-constraints');
        const created = await withdrawals.createWithdrawal({
          walletId: wallet.walletId,
          amountMinor: '900',
          currency: 'NGN',
          idempotencyKey: `wd-${randomUUID()}`,
        });
        const withdrawalRows: Array<Record<string, unknown>> = await dataSource.query(
          'SELECT * FROM withdrawals WHERE id = $1',
          [created.id],
        );
        const row = firstRow(withdrawalRows, 'withdrawal row');
        await expect(
          dataSource.query(
            `INSERT INTO withdrawals (id, wallet_id, payment_reference, amount_minor, currency, status,
               idempotency_key, request_hash)
             VALUES ($1, $2, $3, 1, 'NGN', 'PENDING', $4, $5)`,
            [
              randomUUID(),
              wallet.walletId,
              `MN${'7'.repeat(12)}`,
              row.idempotency_key,
              row.request_hash,
            ],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);

        await expect(
          dataSource.query(
            `UPDATE withdrawals SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
            [created.id],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);
      });
    });

    it('absorbs contention through bounded retry for a pair of concurrent completions', async () => {
      // Setup is sequential on purpose so that the only contention under test is the
      // concurrent completion itself. Two writers sit inside the 3-attempt budget.
      const wallet = await fundedWallet('wd-pair', '100000');
      const created = [];
      for (let i = 0; i < 2; i += 1) {
        const w = await withdrawals.createWithdrawal({
          walletId: wallet.walletId,
          amountMinor: '4000',
          currency: 'NGN',
          idempotencyKey: `wd-${randomUUID()}`,
        });
        await withdrawals.processWithdrawal(w.id);
        created.push(w);
      }

      const settled = await Promise.allSettled(
        created.map((w) => withdrawals.completeWithdrawal(w.id)),
      );
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(0);
      expect(await balanceOf(wallet.ledgerAccountId)).toBe(92000n);
    });

    it('never overdraws a scarce wallet under concurrent completions', async () => {
      // DOCUMENTS ESTABLISHED BEHAVIOUR. Heavy contention can exhaust the bounded retry, and
      // scarce funds reject the rest. Either way the ledger must agree exactly with the set
      // of withdrawals that actually completed, and the wallet must never go negative.
      const wallet = await fundedWallet('wd-contention', '10000');
      const created = [];
      for (let i = 0; i < 4; i += 1) {
        const w = await withdrawals.createWithdrawal({
          walletId: wallet.walletId,
          amountMinor: '4000',
          currency: 'NGN',
          idempotencyKey: `wd-${randomUUID()}`,
        });
        await withdrawals.processWithdrawal(w.id);
        created.push(w);
      }

      const settled = await Promise.allSettled(
        created.map((w) => withdrawals.completeWithdrawal(w.id)),
      );
      const completed = settled.filter(
        (r) => r.status === 'fulfilled' && r.value.status === WithdrawalStatus.COMPLETED,
      ).length;

      const completedRows: Array<{ n: string }> = await dataSource.query(
        `SELECT count(*)::text AS n FROM withdrawals WHERE status = 'COMPLETED'`,
      );
      expect(Number(firstRow(completedRows, 'completed withdrawals').n)).toBe(completed);

      const balance = await balanceOf(wallet.ledgerAccountId);
      expect(balance).toBe(10000n - BigInt(completed) * 4000n);
      expect(balance).toBeGreaterThanOrEqual(0n);
      expect(completed).toBeLessThanOrEqual(2);
    });
  });

  // =======================================================================================
  // LEGACY TransferService (src/transfer/transfer.service.ts)
  // =======================================================================================

  describe('TransferService (legacy HTTP-exposed path)', () => {
    async function pair(label: string, fundMinor = '100000') {
      const source = await seedWallet(`${label}-src`);
      const destination = await seedWallet(`${label}-dst`);
      await fundWallet(source.ledgerAccountId, fundMinor);
      return { source, destination };
    }

    it('completes a transfer with a correctly directed balanced journal', async () => {
      const { source, destination } = await pair('tr-ok');
      const srcBefore = await balanceOf(source.ledgerAccountId);
      const dstBefore = await balanceOf(destination.ledgerAccountId);

      const view = await transfers.createTransfer({
        sourceWalletId: source.walletId,
        destinationWalletId: destination.walletId,
        amountMinor: '12000',
        currency: 'NGN',
        idempotencyKey: `tr-${randomUUID()}`,
        reference: 'transfer-ref',
        narration: 'integration transfer',
      });

      expect(view.status).toBe(TransferStatus.COMPLETED);
      expect(view.journalId).toBeTruthy();
      expect(view.amountMinor).toBe('12000');

      await assertBalancedJournal(view.journalId!, {
        debitAccount: source.ledgerAccountId,
        creditAccount: destination.ledgerAccountId,
        amountMinor: '12000',
      });

      expect(srcBefore - (await balanceOf(source.ledgerAccountId))).toBe(12000n);
      expect((await balanceOf(destination.ledgerAccountId)) - dstBefore).toBe(12000n);
    });

    it('conserves value across the two wallets', async () => {
      const { source, destination } = await pair('tr-conserve');
      const totalBefore =
        (await balanceOf(source.ledgerAccountId)) + (await balanceOf(destination.ledgerAccountId));
      await transfers.createTransfer({
        sourceWalletId: source.walletId,
        destinationWalletId: destination.walletId,
        amountMinor: '7500',
        currency: 'NGN',
        idempotencyKey: `tr-${randomUUID()}`,
      });
      const totalAfter =
        (await balanceOf(source.ledgerAccountId)) + (await balanceOf(destination.ledgerAccountId));
      expect(totalAfter).toBe(totalBefore);
    });

    it('persists audit and outbox effects', async () => {
      const { source, destination } = await pair('tr-effects');
      const view = await transfers.createTransfer({
        sourceWalletId: source.walletId,
        destinationWalletId: destination.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `tr-${randomUUID()}`,
      });
      const audits: Array<{ action: string }> = await dataSource.query(
        `SELECT action FROM audit_events WHERE entity_type = 'TRANSFER' AND entity_id = $1`,
        [view.id],
      );
      expect(audits.length).toBeGreaterThan(0);
      const events: Array<{ event_type: string }> = await dataSource.query(
        `SELECT event_type FROM outbox_events WHERE aggregate_type = 'TRANSFER' AND aggregate_id = $1`,
        [view.id],
      );
      expect(events.length).toBeGreaterThan(0);
    });

    it('replays an identical transfer idempotently without a second journal', async () => {
      const { source, destination } = await pair('tr-replay');
      const command = {
        sourceWalletId: source.walletId,
        destinationWalletId: destination.walletId,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `tr-${randomUUID()}`,
      };
      const first = await transfers.createTransfer(command);
      const second = await transfers.createTransfer(command);

      expect(second.id).toBe(first.id);
      expect(second.journalId).toBe(first.journalId);
      expect(await countRows('transfers')).toBe(1);
      // funding journal + exactly one transfer journal
      expect(await countRows('ledger_journals')).toBe(2);
      expect(await balanceOf(source.ledgerAccountId)).toBe(97000n);
    });

    it('rejects the same idempotency key carrying a different payload', async () => {
      const { source, destination } = await pair('tr-conflict');
      const key = `tr-${randomUUID()}`;
      await transfers.createTransfer({
        sourceWalletId: source.walletId,
        destinationWalletId: destination.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: key,
      });
      await expect(
        transfers.createTransfer({
          sourceWalletId: source.walletId,
          destinationWalletId: destination.walletId,
          amountMinor: '2000',
          currency: 'NGN',
          idempotencyKey: key,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await countRows('transfers')).toBe(1);
    });

    it('rejects an under-funded transfer and leaves both wallets untouched', async () => {
      const { source, destination } = await pair('tr-insufficient', '1000');
      const srcBefore = await balanceOf(source.ledgerAccountId);
      const dstBefore = await balanceOf(destination.ledgerAccountId);
      const journalsBefore = await countRows('ledger_journals');

      await expect(
        transfers.createTransfer({
          sourceWalletId: source.walletId,
          destinationWalletId: destination.walletId,
          amountMinor: '500000',
          currency: 'NGN',
          idempotencyKey: `tr-${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(HttpException);

      expect(await balanceOf(source.ledgerAccountId)).toBe(srcBefore);
      expect(await balanceOf(destination.ledgerAccountId)).toBe(dstBefore);
      expect(await countRows('ledger_journals')).toBe(journalsBefore);
    });

    it('rejects a self-transfer', async () => {
      const { source } = await pair('tr-self');
      await expect(
        transfers.createTransfer({
          sourceWalletId: source.walletId,
          destinationWalletId: source.walletId,
          amountMinor: '100',
          currency: 'NGN',
          idempotencyKey: `tr-${randomUUID()}`,
        }),
      ).rejects.toBeTruthy();
      expect(await countRows('transfers')).toBe(0);
    });

    it('rolls an aborted transfer back atomically', async () => {
      const { source, destination } = await pair('tr-rollback');
      const journalsBefore = await countRows('ledger_journals');
      const srcBefore = await balanceOf(source.ledgerAccountId);

      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          await ledger.postJournalInTransaction(manager, {
            idempotencyKey: `transfer:${randomUUID()}`,
            currency: 'NGN',
            accountingUnit: 'CUSTOMER_FUNDS',
            reference: `tr-${randomUUID().slice(0, 8)}`,
            lines: [
              {
                accountId: source.ledgerAccountId,
                direction: LedgerEntryDirection.DEBIT,
                amountMinor: '2000',
              },
              {
                accountId: destination.ledgerAccountId,
                direction: LedgerEntryDirection.CREDIT,
                amountMinor: '2000',
              },
            ],
          });
          throw new Error('aborted after posting');
        }),
      ).rejects.toThrow('aborted after posting');

      expect(await countRows('ledger_journals')).toBe(journalsBefore);
      expect(await balanceOf(source.ledgerAccountId)).toBe(srcBefore);
    });

    describe('database constraints', () => {
      it('enforces chk_transfers_wallets_different', async () => {
        const { source } = await pair('tr-chk-same');
        await expect(
          dataSource.query(
            `INSERT INTO transfers (id, source_wallet_id, destination_wallet_id, amount_minor,
               currency, status, idempotency_key, request_hash)
             VALUES ($1, $2, $2, 10, 'NGN', 'PENDING', $3, $4)`,
            [randomUUID(), source.walletId, randomUUID(), 'a'.repeat(64)],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);
      });

      it('enforces uq_transfers_idempotency_key', async () => {
        const { source, destination } = await pair('tr-chk-uq');
        const view = await transfers.createTransfer({
          sourceWalletId: source.walletId,
          destinationWalletId: destination.walletId,
          amountMinor: '100',
          currency: 'NGN',
          idempotencyKey: `tr-${randomUUID()}`,
        });
        const transferRows: Array<Record<string, unknown>> = await dataSource.query(
          'SELECT * FROM transfers WHERE id = $1',
          [view.id],
        );
        const row = firstRow(transferRows, 'transfer row');
        await expect(
          dataSource.query(
            `INSERT INTO transfers (id, source_wallet_id, destination_wallet_id, amount_minor,
               currency, status, idempotency_key, request_hash)
             VALUES ($1, $2, $3, 10, 'NGN', 'PENDING', $4, $5)`,
            [
              randomUUID(),
              source.walletId,
              destination.walletId,
              row.idempotency_key,
              row.request_hash,
            ],
          ),
        ).rejects.toBeInstanceOf(QueryFailedError);
      });
    });

    it('absorbs contention through bounded retry for a pair of concurrent transfers', async () => {
      // Two concurrent writers on one source wallet sit inside the 3-attempt budget, so the
      // service's retry must absorb the serialization conflict and both must complete.
      const { source, destination } = await pair('tr-contention', '100000');
      const settled = await Promise.allSettled(
        Array.from({ length: 2 }, () =>
          transfers.createTransfer({
            sourceWalletId: source.walletId,
            destinationWalletId: destination.walletId,
            amountMinor: '4000',
            currency: 'NGN',
            idempotencyKey: `tr-${randomUUID()}`,
          }),
        ),
      );
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(0);

      expect(await balanceOf(source.ledgerAccountId)).toBe(92000n);
      expect(await balanceOf(destination.ledgerAccountId)).toBe(8000n);
    });

    it('stays exactly consistent when heavy contention exhausts the retry budget', async () => {
      // DOCUMENTS ESTABLISHED BEHAVIOUR, NOT AN ENDORSEMENT.
      //
      // The retry budget is deliberately bounded at three attempts, so sufficiently heavy
      // contention can exhaust it and the caller sees a failure. What must never happen is a
      // partial or duplicated financial effect: the ledger has to agree exactly with the set
      // of transfers that actually completed.
      const { source, destination } = await pair('tr-exhaust', '1000000');
      const settled = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          transfers.createTransfer({
            sourceWalletId: source.walletId,
            destinationWalletId: destination.walletId,
            amountMinor: '4000',
            currency: 'NGN',
            idempotencyKey: `tr-${randomUUID()}`,
          }),
        ),
      );
      const completed = settled.filter(
        (r) => r.status === 'fulfilled' && r.value.status === TransferStatus.COMPLETED,
      ).length;

      const completedRows: Array<{ n: string }> = await dataSource.query(
        `SELECT count(*)::text AS n FROM transfers WHERE status = 'COMPLETED'`,
      );
      expect(Number(firstRow(completedRows, 'completed transfers').n)).toBe(completed);

      const src = await balanceOf(source.ledgerAccountId);
      const dst = await balanceOf(destination.ledgerAccountId);
      expect(src).toBe(1000000n - BigInt(completed) * 4000n);
      expect(dst).toBe(BigInt(completed) * 4000n);
      expect(src + dst).toBe(1000000n);
    });

    it('never overdraws a scarce source wallet under concurrent transfers', async () => {
      const { source, destination } = await pair('tr-scarce', '10000');
      const settled = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          transfers.createTransfer({
            sourceWalletId: source.walletId,
            destinationWalletId: destination.walletId,
            amountMinor: '4000',
            currency: 'NGN',
            idempotencyKey: `tr-${randomUUID()}`,
          }),
        ),
      );
      const completed = settled.filter(
        (r) => r.status === 'fulfilled' && r.value.status === TransferStatus.COMPLETED,
      ).length;

      const src = await balanceOf(source.ledgerAccountId);
      const dst = await balanceOf(destination.ledgerAccountId);
      expect(src).toBe(10000n - BigInt(completed) * 4000n);
      expect(dst).toBe(BigInt(completed) * 4000n);
      expect(src).toBeGreaterThanOrEqual(0n);
      expect(src + dst).toBe(10000n);
      expect(completed).toBeLessThanOrEqual(2);
    });
  });

  // =======================================================================================
  // Cross-cutting ledger immutability
  // =======================================================================================

  describe('ledger immutability across payment types', () => {
    it('refuses to mutate a posted journal line or header', async () => {
      const wallet = await seedWallet('immutable');
      const created = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '1500',
        currency: 'NGN',
        idempotencyKey: `dep-${randomUUID()}`,
      });
      const completed = await deposits.completeDeposit(created.id);

      await expect(
        dataSource.query(
          'UPDATE ledger_lines SET amount_minor = amount_minor + 1 WHERE journal_id = $1',
          [completed.journalId],
        ),
      ).rejects.toBeInstanceOf(QueryFailedError);

      await expect(
        dataSource.query('UPDATE ledger_journals SET total_minor = total_minor + 1 WHERE id = $1', [
          completed.journalId,
        ]),
      ).rejects.toBeInstanceOf(QueryFailedError);

      await expect(
        dataSource.query('DELETE FROM ledger_lines WHERE journal_id = $1', [completed.journalId]),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('refuses an unbalanced journal at the database level', async () => {
      const wallet = await seedWallet('unbalanced');
      await expect(
        dataSource.transaction(async (manager) => {
          const journalId = randomUUID();
          await manager.query(
            `INSERT INTO ledger_journals (id, idempotency_key, request_hash, currency, total_minor,
               accounting_unit, status)
             VALUES ($1, $2, $3, 'NGN', 100, 'CUSTOMER_FUNDS', 'POSTED')`,
            [journalId, `unbalanced-${randomUUID()}`, 'a'.repeat(64)],
          );
          await manager.query(
            `INSERT INTO ledger_lines (id, journal_id, ledger_account_id, line_number, direction,
               amount_minor, currency, accounting_unit)
             VALUES ($1, $2, $3, 1, 'DEBIT', 100, 'NGN', 'CUSTOMER_FUNDS')`,
            [randomUUID(), journalId, wallet.ledgerAccountId],
          );
        }),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });
  });
});
