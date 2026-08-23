import { randomUUID } from 'node:crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

import { LedgerAccount } from '../src/ledger/ledger-account.entity';
import { LedgerJournal } from '../src/ledger/ledger-journal.entity';
import { LedgerLine } from '../src/ledger/ledger-line.entity';
import {
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
} from '../src/ledger/ledger.enums';
import { LedgerService } from '../src/ledger/ledger.service';

import { Deposit } from '../src/deposit/deposit.entity';
import { DepositFailureCode, DepositStatus } from '../src/deposit/deposit.enums';
import { DepositService } from '../src/deposit/deposit.service';

import { Withdrawal } from '../src/withdrawal/withdrawal.entity';
import { WithdrawalFailureCode, WithdrawalStatus } from '../src/withdrawal/withdrawal.enums';
import { WithdrawalService } from '../src/withdrawal/withdrawal.service';

import { AuditEvent } from '../src/operations/audit-event.entity';
import { AuditService } from '../src/operations/audit.service';
import { MetricsService } from '../src/operations/metrics.service';
import { OutboxEvent } from '../src/operations/outbox-event.entity';
import { OutboxService } from '../src/operations/outbox.service';
import { PaymentReferenceService } from '../src/payment/payment-reference.service';
import { SettlementAccountService } from '../src/payment/settlement-account.service';

import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';

describe('A5 Ledger Reversal and Terminal Transitions (real PostgreSQL)', () => {
  let dataSource: DataSource;
  let ledger: LedgerService;
  let deposits: DepositService;
  let withdrawals: WithdrawalService;

  let fundingAccountId: string;

  beforeAll(async () => {
    dataSource = await createIntegrationDataSource('a5reversal');

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
  }, 180000);

  afterAll(async () => {
    if (dataSource) {
      await destroyIntegrationDataSource(dataSource);
    }
  }, 60000);

  beforeEach(async () => {
    await truncateAllTables(dataSource);

    // Seed canonical settlement account.
    await ledger.createAccount({
      code: 'PAYMENT-SETTLEMENT_ASSET-NGN',
      name: 'Settlement asset',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });

    // Seed funding account for ledger setup.
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

  // Helper: Seed liability wallet account for a customer
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

  // Helper: Get direct balance using database query to avoid caching
  async function dbBalanceOf(accountId: string): Promise<bigint> {
    const rows: Array<{ balance: string }> = await dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor ELSE -amount_minor END), 0)::text AS balance
         FROM ledger_lines WHERE ledger_account_id = $1`,
      [accountId],
    );
    return BigInt(firstRow(rows, 'db balance').balance);
  }

  // =======================================================================================
  // 5. LEDGER POSTING COVERAGE
  // =======================================================================================
  describe('Ledger posting invariants', () => {
    it('posts a valid balanced journal and updates balances correctly', async () => {
      const wallet = await seedWallet('post-ok');

      const journal = await ledger.postJournal({
        idempotencyKey: `post-journal-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: 'REF123',
        description: 'Direct journal post test',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      });

      expect(journal.status).toBe('POSTED');
      expect(journal.totalMinor).toBe('1000'); // minor units
      expect(await dbBalanceOf(fundingAccountId)).toBe(-1000n);
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(1000n);
    });

    it('rejects unbalanced journals at the service boundary', async () => {
      const wallet = await seedWallet('post-unbalanced');

      await expect(
        ledger.postJournal({
          idempotencyKey: `post-unbalanced-${randomUUID()}`,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          lines: [
            {
              accountId: fundingAccountId,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: '1000',
            },
            {
              accountId: wallet.ledgerAccountId,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: '999',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-existent account references due to foreign key enforcement', async () => {
      const fakeAccountId = randomUUID();
      await expect(
        ledger.postJournal({
          idempotencyKey: `post-fake-acc-${randomUUID()}`,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          lines: [
            {
              accountId: fundingAccountId,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: '1000',
            },
            {
              accountId: fakeAccountId,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: '1000',
            },
          ],
        }),
      ).rejects.toThrow();
    });

    it('rejects zero or negative journal totals', async () => {
      const wallet = await seedWallet('post-zero-neg');

      // The parsePositiveMinorUnits parses amounts. If we send a zero or negative amount to postJournal,
      // it should be rejected at parse time or by CHECK constraints. Let's assert it rejects.
      await expect(
        ledger.postJournal({
          idempotencyKey: `post-zero-${randomUUID()}`,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          lines: [
            {
              accountId: fundingAccountId,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: '0',
            },
            {
              accountId: wallet.ledgerAccountId,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: '0',
            },
          ],
        }),
      ).rejects.toThrow();

      await expect(
        ledger.postJournal({
          idempotencyKey: `post-neg-${randomUUID()}`,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          lines: [
            {
              accountId: fundingAccountId,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: '-100',
            },
            {
              accountId: wallet.ledgerAccountId,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: '-100',
            },
          ],
        }),
      ).rejects.toThrow();
    });

    it('preserves idempotency behavior for postJournal', async () => {
      const wallet = await seedWallet('post-idempotent');
      const key = `post-key-${randomUUID()}`;
      const payload = {
        idempotencyKey: key,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      };

      const first = await ledger.postJournal(payload);
      const second = await ledger.postJournal(payload);

      expect(first.id).toBe(second.id);
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(1000n); // exactly one credit
    });

    it('rejects same key with different payload for postJournal', async () => {
      const wallet = await seedWallet('post-idempotent-diff');
      const key = `post-key-${randomUUID()}`;

      await ledger.postJournal({
        idempotencyKey: key,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      });

      await expect(
        ledger.postJournal({
          idempotencyKey: key,
          currency: 'NGN',
          accountingUnit: 'CUSTOMER_FUNDS',
          lines: [
            {
              accountId: fundingAccountId,
              direction: LedgerEntryDirection.DEBIT,
              amountMinor: '2000',
            },
            {
              accountId: wallet.ledgerAccountId,
              direction: LedgerEntryDirection.CREDIT,
              amountMinor: '2000',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // =======================================================================================
  // 8. IMMUTABILITY
  // =======================================================================================
  describe('Ledger immutability', () => {
    it('enforces that posted journals and lines are strictly immutable', async () => {
      const wallet = await seedWallet('immutable-direct');
      const journal = await ledger.postJournal({
        idempotencyKey: `immutable-key-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      });

      // Attempting UPDATE on ledger_journals
      await expect(
        dataSource.query(`UPDATE ledger_journals SET description = 'Modified' WHERE id = $1`, [
          journal.id,
        ]),
      ).rejects.toThrow();

      // Attempting DELETE on ledger_journals
      await expect(
        dataSource.query(`DELETE FROM ledger_journals WHERE id = $1`, [journal.id]),
      ).rejects.toThrow();

      // Attempting UPDATE on ledger_lines
      await expect(
        dataSource.query(`UPDATE ledger_lines SET amount_minor = 2000 WHERE journal_id = $1`, [
          journal.id,
        ]),
      ).rejects.toThrow();

      // Attempting DELETE on ledger_lines
      await expect(
        dataSource.query(`DELETE FROM ledger_lines WHERE journal_id = $1`, [journal.id]),
      ).rejects.toThrow();

      // Assert that balance is completely unchanged
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(1000n);
    });
  });

  // =======================================================================================
  // 6. REVERSAL COVERAGE — PRIMARY OBJECTIVE
  // =======================================================================================
  describe('LedgerService.reverseJournal', () => {
    it('successfully reverses a journal posting compensating mirrored entries', async () => {
      const wallet = await seedWallet('rev-ok');

      // Post original: Debit Funding / Credit Wallet 5000
      const original = await ledger.postJournal({
        idempotencyKey: `orig-key-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        reference: 'ORIG-REF',
        description: 'Original posting',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '5000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '5000',
          },
        ],
      });

      expect(await dbBalanceOf(fundingAccountId)).toBe(-5000n);
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(5000n);

      // Perform Reversal
      const reversalIdempotencyKey = `rev-key-${randomUUID()}`;
      const reversal = await ledger.reverseJournal(
        original.id,
        reversalIdempotencyKey,
        'Need to undo original',
      );

      expect(reversal.status).toBe('POSTED');
      expect(reversal.reversalOfJournalId).toBe(original.id);
      expect(reversal.totalMinor).toBe('5000');

      // Mirror lines: Funding became Credit, Wallet became Debit
      const revLines = reversal.lines;
      expect(revLines).toHaveLength(2);

      const fundingLine = revLines.find((l) => l.accountId === fundingAccountId)!;
      const walletLine = revLines.find((l) => l.accountId === wallet.ledgerAccountId)!;

      expect(fundingLine.direction).toBe(LedgerEntryDirection.CREDIT);
      expect(fundingLine.amountMinor).toBe('5000');

      expect(walletLine.direction).toBe(LedgerEntryDirection.DEBIT);
      expect(walletLine.amountMinor).toBe('5000');

      // Original journal must remain untouched and locked as reversed in metadata/schema
      const freshOriginal = await ledger.getJournal(original.id);
      expect(freshOriginal.reversalOfJournalId).toBeNull(); // original row doesn't modify this column itself, the reversal references it

      // Balances must return exactly to pre-posting state (0)
      expect(await dbBalanceOf(fundingAccountId)).toBe(0n);
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(0n);
    });

    it('replays identical reversal idempotently returning the same journal', async () => {
      const wallet = await seedWallet('rev-idempotent');
      const original = await ledger.postJournal({
        idempotencyKey: `orig-key-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      });

      const key = `rev-key-${randomUUID()}`;
      const first = await ledger.reverseJournal(original.id, key, 'Reason');
      const second = await ledger.reverseJournal(original.id, key, 'Reason');

      expect(first.id).toBe(second.id);
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(0n); // exactly reversed once
    });

    it('rejects duplicate reversals of the same original journal', async () => {
      const wallet = await seedWallet('rev-duplicate');
      const original = await ledger.postJournal({
        idempotencyKey: `orig-key-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      });

      await ledger.reverseJournal(original.id, `rev-key-1-${randomUUID()}`, 'Reason 1');

      // Attempt to reverse again with a new key
      await expect(
        ledger.reverseJournal(original.id, `rev-key-2-${randomUUID()}`, 'Reason 2'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects the reversal of a reversal journal', async () => {
      const wallet = await seedWallet('rev-of-rev');
      const original = await ledger.postJournal({
        idempotencyKey: `orig-key-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      });

      const reversal = await ledger.reverseJournal(
        original.id,
        `rev-key-${randomUUID()}`,
        'Reason',
      );

      // Attempt to reverse the reversal journal
      await expect(
        ledger.reverseJournal(reversal.id, `rev-rev-key-${randomUUID()}`, 'Reverse a reversal'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('fails-closed when a different idempotency key is presented against an already-reversed journal', async () => {
      const wallet = await seedWallet('rev-already-rev-diff-key');
      const original = await ledger.postJournal({
        idempotencyKey: `orig-key-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '1000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '1000',
          },
        ],
      });

      await ledger.reverseJournal(original.id, `rev-key-first-${randomUUID()}`, 'First reversal');

      await expect(
        ledger.reverseJournal(
          original.id,
          `rev-key-second-${randomUUID()}`,
          'Second reversal with different key',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // =======================================================================================
  // 7. REAL CONCURRENCY — IMPORTANT
  // =======================================================================================
  describe('Ledger reversal real concurrency', () => {
    it('arbitrates concurrent reversals of the same original journal using partial unique index', async () => {
      const acc1 = await ledger.createAccount({
        code: `ACC-concur-1-${randomUUID().slice(0, 8)}`,
        name: `General account concur 1`,
        accountType: LedgerAccountType.ASSET,
        normalBalance: LedgerNormalBalance.DEBIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: true, // Allow negative balance to hit DB race
      });
      const acc2 = await ledger.createAccount({
        code: `ACC-concur-2-${randomUUID().slice(0, 8)}`,
        name: `General account concur 2`,
        accountType: LedgerAccountType.ASSET,
        normalBalance: LedgerNormalBalance.DEBIT,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        allowNegativeBalance: true, // Allow negative balance to hit DB race
      });

      const original = await ledger.postJournal({
        idempotencyKey: `orig-concur-key-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          { accountId: acc1.id, direction: LedgerEntryDirection.DEBIT, amountMinor: '1000' },
          { accountId: acc2.id, direction: LedgerEntryDirection.CREDIT, amountMinor: '1000' },
        ],
      });

      // We trigger two concurrent reversals with DIFFERENT idempotency keys
      const p1 = ledger.reverseJournal(original.id, `rev-key-a-${randomUUID()}`, 'Concur A');
      const p2 = ledger.reverseJournal(original.id, `rev-key-b-${randomUUID()}`, 'Concur B');

      const results = await Promise.allSettled([p1, p2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // PostgreSQL must arbitrate the race: exactly one must succeed, and the other must fail with ConflictException
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // Verify the losing request throws a ConflictException
      const error: unknown = (rejected[0] as PromiseRejectedResult).reason;
      expect(error).toBeInstanceOf(ConflictException);

      // Verify exactly one reversal exists in db pointing to the original journal
      const dbReversals: Array<{ id: string }> = await dataSource.query(
        'SELECT id FROM ledger_journals WHERE reversal_of_journal_id = $1',
        [original.id],
      );
      expect(dbReversals).toHaveLength(1);

      // Balances must be perfectly preserved and returned to 0
      expect(await dbBalanceOf(acc1.id)).toBe(0n);
      expect(await dbBalanceOf(acc2.id)).toBe(0n);
    });
  });

  // =======================================================================================
  // 9. DEPOSIT TERMINAL TRANSITIONS
  // =======================================================================================
  describe('Deposit terminal transitions', () => {
    it('cancels and fails deposits correctly leaving no journal side-effects', async () => {
      const wallet = await seedWallet('dep-term');

      // Test cancelDeposit
      const dep1 = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: `dep-k1-${randomUUID()}`,
      });

      const cancelled = await deposits.cancelDeposit(dep1.id, 'User cancelled');
      expect(cancelled.status).toBe(DepositStatus.CANCELLED);
      expect(cancelled.failureMessage).toBe('User cancelled');
      expect(cancelled.journalId).toBeNull();

      // Test failDeposit
      const dep2 = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `dep-k2-${randomUUID()}`,
      });

      const failed = await deposits.failDeposit(dep2.id, 'Validation failed');
      expect(failed.status).toBe(DepositStatus.FAILED);
      expect(failed.failureCode).toBe(DepositFailureCode.SETTLEMENT_REJECTED);
      expect(failed.failureMessage).toBe('Validation failed');
      expect(failed.journalId).toBeNull();

      // Assert that absolutely NO journals exist (except potentially audit or outbox entries, but NO monetary journals)
      const journalsCount: Array<{ n: string }> = await dataSource.query(
        'SELECT count(*)::text as n FROM ledger_journals',
      );
      expect(firstRow(journalsCount, 'journals count').n).toBe('0');
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(0n);
    });

    it('supports idempotent cancelDeposit and failDeposit calls', async () => {
      const wallet = await seedWallet('dep-term-idempotent');

      const dep = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `dep-k-${randomUUID()}`,
      });

      const firstCancel = await deposits.cancelDeposit(dep.id, 'First');
      const secondCancel = await deposits.cancelDeposit(dep.id, 'Second');
      expect(firstCancel.id).toBe(secondCancel.id);
      expect(secondCancel.status).toBe(DepositStatus.CANCELLED);

      // Now create another deposit to test failDeposit idempotency
      const dep2 = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `dep-k2-${randomUUID()}`,
      });

      const firstFail = await deposits.failDeposit(dep2.id, 'First Fail');
      const secondFail = await deposits.failDeposit(dep2.id, 'Second Fail');
      expect(firstFail.id).toBe(secondFail.id);
      expect(secondFail.status).toBe(DepositStatus.FAILED);
    });

    it('rejects invalid deposit transitions (e.g. from COMPLETED to CANCELLED/FAILED)', async () => {
      const wallet = await seedWallet('dep-term-invalid');

      const dep = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `dep-k-${randomUUID()}`,
      });

      await deposits.completeDeposit(dep.id);

      // Try to cancel
      await expect(deposits.cancelDeposit(dep.id, 'Should fail')).rejects.toBeInstanceOf(
        ConflictException,
      );

      // Try to fail
      await expect(deposits.failDeposit(dep.id, 'Should fail')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rolls back deposit transition changes atomically if process fails', async () => {
      const wallet = await seedWallet('dep-term-rollback');
      const dep = await deposits.createDeposit({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `dep-k-${randomUUID()}`,
      });

      // Attempt to trigger failure after changing state inside a serializable transaction manually
      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          await manager.query(`UPDATE deposits SET status = 'CANCELLED' WHERE id = $1`, [dep.id]);
          // Constraint violation or manual abort
          throw new Error('Force abort transaction');
        }),
      ).rejects.toThrow('Force abort transaction');

      // The status must remain PENDING
      const dbDep = await deposits.getDeposit(dep.id);
      expect(dbDep.status).toBe(DepositStatus.PENDING);
    });
  });

  // =======================================================================================
  // 10. WITHDRAWAL TERMINAL TRANSITIONS
  // =======================================================================================
  describe('Withdrawal terminal transitions', () => {
    it('cancels and fails withdrawals correctly leaving no journal side-effects', async () => {
      const wallet = await seedWallet('wd-term');

      // Test cancelWithdrawal
      const wd1 = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '2000',
        currency: 'NGN',
        idempotencyKey: `wd-k1-${randomUUID()}`,
      });

      const cancelled = await withdrawals.cancelWithdrawal(wd1.id, 'User cancelled');
      expect(cancelled.status).toBe(WithdrawalStatus.CANCELLED);
      expect(cancelled.failureMessage).toBe('User cancelled');
      expect(cancelled.journalId).toBeNull();

      // Test failWithdrawal
      const wd2 = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '3000',
        currency: 'NGN',
        idempotencyKey: `wd-k2-${randomUUID()}`,
      });

      const failed = await withdrawals.failWithdrawal(wd2.id, 'Validation failed');
      expect(failed.status).toBe(WithdrawalStatus.FAILED);
      expect(failed.failureCode).toBe(WithdrawalFailureCode.SETTLEMENT_REJECTED);
      expect(failed.failureMessage).toBe('Validation failed');
      expect(failed.journalId).toBeNull();

      // Assert that absolutely NO journals exist
      const journalsCount: Array<{ n: string }> = await dataSource.query(
        'SELECT count(*)::text as n FROM ledger_journals',
      );
      expect(firstRow(journalsCount, 'journals count').n).toBe('0');
      expect(await dbBalanceOf(wallet.ledgerAccountId)).toBe(0n);
    });

    it('supports idempotent cancelWithdrawal and failWithdrawal calls', async () => {
      const wallet = await seedWallet('wd-term-idempotent');

      const wd = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `wd-k-${randomUUID()}`,
      });

      const firstCancel = await withdrawals.cancelWithdrawal(wd.id, 'First');
      const secondCancel = await withdrawals.cancelWithdrawal(wd.id, 'Second');
      expect(firstCancel.id).toBe(secondCancel.id);
      expect(secondCancel.status).toBe(WithdrawalStatus.CANCELLED);

      // Now create another withdrawal to test failWithdrawal idempotency
      const wd2 = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `wd-k2-${randomUUID()}`,
      });

      const firstFail = await withdrawals.failWithdrawal(wd2.id, 'First Fail');
      const secondFail = await withdrawals.failWithdrawal(wd2.id, 'Second Fail');
      expect(firstFail.id).toBe(secondFail.id);
      expect(secondFail.status).toBe(WithdrawalStatus.FAILED);
    });

    it('rejects invalid withdrawal transitions (e.g. from COMPLETED to CANCELLED/FAILED)', async () => {
      const wallet = await seedWallet('wd-term-invalid');
      // Fund wallet first
      await ledger.postJournal({
        idempotencyKey: `fund-wd-term-${randomUUID()}`,
        currency: 'NGN',
        accountingUnit: 'CUSTOMER_FUNDS',
        lines: [
          {
            accountId: fundingAccountId,
            direction: LedgerEntryDirection.DEBIT,
            amountMinor: '5000',
          },
          {
            accountId: wallet.ledgerAccountId,
            direction: LedgerEntryDirection.CREDIT,
            amountMinor: '5000',
          },
        ],
      });

      const wd = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `wd-k-${randomUUID()}`,
      });

      await withdrawals.processWithdrawal(wd.id);
      await withdrawals.completeWithdrawal(wd.id);

      // Try to cancel
      await expect(withdrawals.cancelWithdrawal(wd.id, 'Should fail')).rejects.toBeInstanceOf(
        ConflictException,
      );

      // Try to fail
      await expect(withdrawals.failWithdrawal(wd.id, 'Should fail')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rolls back withdrawal transition changes atomically if process fails', async () => {
      const wallet = await seedWallet('wd-term-rollback');
      const wd = await withdrawals.createWithdrawal({
        walletId: wallet.walletId,
        amountMinor: '1000',
        currency: 'NGN',
        idempotencyKey: `wd-k-${randomUUID()}`,
      });

      await expect(
        dataSource.transaction('SERIALIZABLE', async (manager) => {
          await manager.query(`UPDATE withdrawals SET status = 'CANCELLED' WHERE id = $1`, [wd.id]);
          throw new Error('Force abort transaction');
        }),
      ).rejects.toThrow('Force abort transaction');

      const dbWd = await withdrawals.getWithdrawal(wd.id);
      expect(dbWd.status).toBe(WithdrawalStatus.PENDING);
    });
  });
});
