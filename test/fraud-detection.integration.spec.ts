import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';

import { FraudDetectionService } from '../src/fraud/fraud-detection.service';
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
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  seedTransferParticipant,
  truncateAllTables,
} from './support/pg-harness';
import type { TransferParticipant } from './support/pg-harness';
import { testWalletFinancialBoundary } from './support/test-wallet-financial-boundary';

/**
 * ARENA 3D Group 22 — fraud and risk signal detection.
 *
 * Three properties matter here, and each is asserted rather than assumed:
 *
 * 1. Detection is **deduplicated at the source** — a scheduled evaluator re-observes the same condition
 *    every run, and a row per run would fill the queue with N copies of one problem.
 * 2. A finding is **authority-free** — it records that something looked unusual and cannot refuse money.
 * 3. A run that did not complete is **recorded as not looking**, never as clean.
 */
describe('Group 22 — fraud signal detection', () => {
  let db: DataSource;
  let service: FraudDetectionService;
  let ledger: LedgerService;

  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    db = await createIntegrationDataSource('g22frd');
    ledger = new LedgerService(
      db.getRepository(LedgerAccount),
      db.getRepository(LedgerJournal),
      db.getRepository(LedgerLine),
      db,
      testWalletFinancialBoundary,
    );
    service = new FraudDetectionService(db, new AuditService(db.getRepository(AuditEvent)));
  }, 180_000);

  afterAll(async () => {
    await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
    const funding = await ledger.createAccount({
      code: `G22-FUND-${suffix}-${Math.floor(Math.random() * 1e6)}`,
      name: 'Group 22 funding control',
      accountType: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      allowNegativeBalance: true,
    });
    fundingAccountId = funding.id;
  });

  /** A funding control account, created once, so every seeded journal balances. */
  let fundingAccountId: string;

  /** Creates a ledger account for a seeded customer, returning the participant. */
  async function participant(label: string): Promise<TransferParticipant> {
    const account = await ledger.createAccount({
      code: `G22-${label}-${suffix}-${Math.floor(Math.random() * 1e6)}`,
      name: `Group 22 ${label}`,
      accountType: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
    });
    return seedTransferParticipant(db, `g22.${label}`, account.id);
  }

  /**
   * Posts a real balanced journal and returns its id.
   *
   * The `transfers` foreign key to `ledger_journals` is real, so the reference has to point at a journal
   * that exists and is balanced — the ledger's own triggers enforce the balance. Faking the reference
   * would mean relaxing referential integrity, and these suites exist partly to prove it holds.
   */
  async function journalFor(amountMinor: number, occurredAt: Date): Promise<string> {
    const journal = await ledger.postJournal({
      idempotencyKey: `g22-journal-${randomUUID()}`,
      reference: `g22-${randomUUID().slice(0, 8)}`,
      description: 'Group 22 seeded transfer journal',
      currency: 'NGN',
      accountingUnit: 'CUSTOMER_FUNDS',
      lines: [
        {
          accountId: fundingAccountId,
          direction: LedgerEntryDirection.DEBIT,
          amountMinor: String(amountMinor),
        },
        {
          accountId: fundingAccountId,
          direction: LedgerEntryDirection.CREDIT,
          amountMinor: String(amountMinor),
        },
      ],
    });
    // postJournal stamps its own time; the fact timestamp the detector reads comes from completed_at.
    void occurredAt;
    return journal.id;
  }

  /**
   * Inserts a completed transfer directly.
   *
   * The lifecycle trigger requires a journal and a completion time for COMPLETED, so both are supplied.
   * These tests are about the detector reading committed facts; driving real transfers would exercise the
   * transfer service, not this one.
   */
  async function completedTransfer(options: {
    source: TransferParticipant;
    destination: TransferParticipant;
    amountMinor: number;
    occurredAt: Date;
  }): Promise<string> {
    const rows: Array<{ id: string }> = await db.query(
      `INSERT INTO transfers (
         id, source_wallet_id, destination_wallet_id, amount_minor, currency, status,
         idempotency_key, request_hash, journal_id, completed_at, created_at,
         source_customer_id, destination_customer_id,
         source_customer_wallet_id, destination_customer_wallet_id
       ) VALUES (
         gen_random_uuid(), $1, $2, $3, 'NGN', 'COMPLETED',
         $4, repeat('a', 64), $5, $6, $6,
         $7, $8, $9, $10
       ) RETURNING id`,
      [
        options.source.walletAccountId,
        options.destination.walletAccountId,
        options.amountMinor,
        `g22-${randomUUID()}`,
        await journalFor(options.amountMinor, options.occurredAt),
        options.occurredAt,
        options.source.customerId,
        options.destination.customerId,
        options.source.customerWalletId,
        options.destination.customerWalletId,
      ],
    );
    return firstRow(rows, 'seeded transfer').id;
  }

  async function addRule(options: {
    ruleKey: string;
    signalType: string;
    windowMinutes?: number | null;
    thresholdCount?: number | null;
    thresholdAmountMinor?: number | null;
    escalation?: string;
    severity?: string;
  }): Promise<string> {
    const rows: Array<{ id: string }> = await db.query(
      `INSERT INTO fraud_signal_rules (
         rule_key, signal_type, window_minutes, threshold_count, threshold_amount_minor,
         escalation, severity, created_by, effective_from
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'test', now() - interval '1 hour')
       RETURNING id`,
      [
        options.ruleKey,
        options.signalType,
        options.windowMinutes ?? null,
        options.thresholdCount ?? null,
        options.thresholdAmountMinor ?? null,
        options.escalation ?? 'OBSERVE',
        options.severity ?? 'MEDIUM',
      ],
    );
    return firstRow(rows, 'seeded rule').id;
  }

  describe('velocity detection', () => {
    it('raises a finding when a customer exceeds the configured transfer count', async () => {
      const source = await participant('vel-src');
      const destination = await participant('vel-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'VEL-COUNT',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.status).toBe('PASS');
      expect(summary.findingsWritten).toBe(1);
      const findings = await service.openFindings(source.customerId);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.ruleKey).toBe('VEL-COUNT');
      expect(findings[0]?.observedCount).toBe(4);
      expect(findings[0]?.thresholdCount).toBe(3);
    });

    it('does not fire at exactly the threshold', async () => {
      // A threshold of 3 means 3 is allowed. A limit and a fraud rule sharing a number must not disagree by
      // one, or every boundary case becomes an argument.
      const source = await participant('vel-eq-src');
      const destination = await participant('vel-eq-dst');
      const now = new Date();
      for (let index = 0; index < 3; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'VEL-EQ',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.findingsWritten).toBe(0);
      expect(await service.openFindings(source.customerId)).toHaveLength(0);
    });

    it('ignores transfers older than the window', async () => {
      const source = await participant('vel-old-src');
      const destination = await participant('vel-old-dst');
      const now = new Date();
      // Three transfers two hours ago, one now, window is 30 minutes: only the recent one is in scope.
      for (let index = 0; index < 3; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - 7_200_000 - index * 60_000),
        });
      }
      await completedTransfer({ source, destination, amountMinor: 5_000, occurredAt: now });
      await addRule({
        ruleKey: 'VEL-OLD',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 30,
        thresholdCount: 2,
      });

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.findingsWritten).toBe(0);
    });

    it('ignores transfers that never completed', async () => {
      // Counting pending or failed transfers would let a customer trip velocity rules with money that
      // never moved.
      const source = await participant('vel-fail-src');
      const destination = await participant('vel-fail-dst');
      const now = new Date();
      for (let index = 0; index < 5; index += 1) {
        await db.query(
          `INSERT INTO transfers (
             id, source_wallet_id, destination_wallet_id, amount_minor, currency, status,
             idempotency_key, request_hash, created_at, source_customer_id, destination_customer_id,
             source_customer_wallet_id, destination_customer_wallet_id
           ) VALUES (gen_random_uuid(), $1, $2, 5000, 'NGN', 'PENDING', $3, repeat('a', 64), $4, $5, $6, $7, $8)`,
          [
            source.walletAccountId,
            destination.walletAccountId,
            `g22-${randomUUID()}`,
            now,
            source.customerId,
            destination.customerId,
            source.customerWalletId,
            destination.customerWalletId,
          ],
        );
      }
      await addRule({
        ruleKey: 'VEL-FAIL',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 1,
      });

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.findingsWritten).toBe(0);
    });

    it('raises a finding when the total amount exceeds the configured threshold', async () => {
      const source = await participant('amt-src');
      const destination = await participant('amt-dst');
      const now = new Date();
      for (let index = 0; index < 3; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 40_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'VEL-AMT',
        signalType: 'VELOCITY_AMOUNT',
        windowMinutes: 60,
        thresholdAmountMinor: 100_000,
      });

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.findingsWritten).toBe(1);
      const findings = await service.openFindings(source.customerId);
      expect(findings[0]?.observedAmountMinor).toBe(120_000);
    });
  });

  describe('duplicate shape detection', () => {
    it('detects the same amount to the same destination repeated in the window', async () => {
      const source = await participant('dup-src');
      const destination = await participant('dup-dst');
      const now = new Date();
      for (let index = 0; index < 3; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 25_000,
          occurredAt: new Date(now.getTime() - index * 30_000),
        });
      }
      await addRule({
        ruleKey: 'DUP-SHAPE',
        signalType: 'DUPLICATE_SHAPE',
        windowMinutes: 30,
        thresholdCount: 1,
      });

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.findingsWritten).toBe(1);
      const findings = await service.openFindings(source.customerId);
      expect(findings[0]?.signalType).toBe('DUPLICATE_SHAPE');
      expect(findings[0]?.observedCount).toBe(3);
    });

    it('does not fire when identical amounts go to different destinations', async () => {
      // Two identical amounts to two different people is a normal payday, not a duplicate.
      const source = await participant('dup-ok-src');
      const first = await participant('dup-ok-a');
      const second = await participant('dup-ok-b');
      const now = new Date();
      await completedTransfer({ source, destination: first, amountMinor: 25_000, occurredAt: now });
      await completedTransfer({
        source,
        destination: second,
        amountMinor: 25_000,
        occurredAt: new Date(now.getTime() - 60_000),
      });
      await addRule({
        ruleKey: 'DUP-OK',
        signalType: 'DUPLICATE_SHAPE',
        windowMinutes: 30,
        thresholdCount: 1,
      });

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.findingsWritten).toBe(0);
    });
  });

  describe('deduplication at the source', () => {
    it('does not create a second finding when the evaluator runs again', async () => {
      // The whole point: a scheduled evaluator re-observes the same condition every run.
      const source = await participant('dedupe-src');
      const destination = await participant('dedupe-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'DEDUPE',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });

      /*
       * Each run is given a *later* clock, because that is what a scheduled evaluator does and because a
       * fixed `now` would make this test pass for the wrong reason: with an identical timestamp a dedupe
       * key that wrongly incorporated the run time would still collide. Advancing by a minute keeps every
       * fact inside the 60-minute window while making the runs genuinely distinct.
       */
      const first = await service.runDetection({ evaluator: 'test', now });
      const second = await service.runDetection({
        evaluator: 'test',
        now: new Date(now.getTime() + 60_000),
      });
      const third = await service.runDetection({
        evaluator: 'test',
        now: new Date(now.getTime() + 120_000),
      });

      expect(first.findingsWritten).toBe(1);
      // Both later runs re-observed the same open condition, so they refresh it rather than duplicate it.
      expect(second.findingsWritten).toBe(0);
      expect(third.findingsWritten).toBe(0);

      const findings = await service.openFindings(source.customerId);
      expect(findings).toHaveLength(1);
    });

    it('does not re-raise a finding a human already dismissed', async () => {
      // Re-raising a dismissed finding from the same rule and bucket would override a human judgement
      // without review.
      const source = await participant('dismiss-src');
      const destination = await participant('dismiss-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'DISMISS',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });
      await service.runDetection({ evaluator: 'test', now });

      const open = await service.openFindings(source.customerId);
      expect(open).toHaveLength(1);
      await db.query(
        `UPDATE fraud_signal_findings
            SET status = 'DISMISSED', dismissed_reason = 'customer payroll run',
                reviewed_by = 'analyst-1', reviewed_at = now()
          WHERE id = $1`,
        [open[0]?.id],
      );

      const afterDismissal = await service.runDetection({
        evaluator: 'test',
        now: new Date(now.getTime() + 60_000),
      });

      expect(afterDismissal.findingsWritten).toBe(0);
      const stillOpen = await service.openFindings(source.customerId);
      expect(stillOpen).toHaveLength(0);
    });
  });

  describe('findings are evidence, not an authority over money', () => {
    it('refuses to delete a finding', async () => {
      const source = await participant('del-src');
      const destination = await participant('del-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'DEL',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });
      await service.runDetection({ evaluator: 'test', now });
      const findings = await service.openFindings(source.customerId);

      await expect(
        db.query(`DELETE FROM fraud_signal_findings WHERE id = $1`, [findings[0]?.id]),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses to rewrite what was observed', async () => {
      const source = await participant('mut-src');
      const destination = await participant('mut-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'MUT',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });
      await service.runDetection({ evaluator: 'test', now });
      const findings = await service.openFindings(source.customerId);

      await expect(
        db.query(`UPDATE fraud_signal_findings SET observed_count = 1 WHERE id = $1`, [
          findings[0]?.id,
        ]),
      ).rejects.toThrow(/immutable/i);
    });

    it('allows disposition to change, because that is what humans did about it', async () => {
      const source = await participant('disp-src');
      const destination = await participant('disp-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'DISP',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });
      await service.runDetection({ evaluator: 'test', now });
      const findings = await service.openFindings(source.customerId);

      await db.query(
        `UPDATE fraud_signal_findings
            SET status = 'UNDER_REVIEW', reviewed_by = 'analyst-2', reviewed_at = now()
          WHERE id = $1`,
        [findings[0]?.id],
      );

      const rows: Array<{ status: string }> = await db.query(
        `SELECT status FROM fraud_signal_findings WHERE id = $1`,
        [findings[0]?.id],
      );
      expect(firstRow(rows, 'finding').status).toBe('UNDER_REVIEW');
    });

    it('refuses a dismissal with no reason', async () => {
      const source = await participant('noreason-src');
      const destination = await participant('noreason-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'NOREASON',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });
      await service.runDetection({ evaluator: 'test', now });
      const findings = await service.openFindings(source.customerId);

      await expect(
        db.query(
          `UPDATE fraud_signal_findings
              SET status = 'DISMISSED', dismissed_reason = '   ',
                  reviewed_by = 'analyst-3', reviewed_at = now()
            WHERE id = $1`,
          [findings[0]?.id],
        ),
      ).rejects.toThrow();
    });

    it('refuses to reopen a resolved finding', async () => {
      const source = await participant('reopen-src');
      const destination = await participant('reopen-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'REOPEN',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });
      await service.runDetection({ evaluator: 'test', now });
      const findings = await service.openFindings(source.customerId);
      await db.query(
        `UPDATE fraud_signal_findings
            SET status = 'DISMISSED', dismissed_reason = 'checked', reviewed_by = 'a', reviewed_at = now()
          WHERE id = $1`,
        [findings[0]?.id],
      );

      await expect(
        db.query(`UPDATE fraud_signal_findings SET status = 'OPEN' WHERE id = $1`, [
          findings[0]?.id,
        ]),
      ).rejects.toThrow(/cannot be reopened/i);
    });
  });

  describe('a run that did not look is not a clean run', () => {
    it('records a failed evaluation as ERROR rather than silence', async () => {
      await addRule({
        ruleKey: 'BOOM',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 1,
      });
      // Break the transfers table out from under the evaluator to force a failure after the run row opens.
      await db.query(`ALTER TABLE transfers RENAME TO transfers_hidden`);
      try {
        const summary = await service.runDetection({ evaluator: 'test', now: new Date() });
        expect(summary.status).toBe('ERROR');
        expect(summary.errorDetail).toMatch(/transfers_hidden|does not exist/i);
      } finally {
        await db.query(`ALTER TABLE transfers_hidden RENAME TO transfers`);
      }

      const posture = await service.detectionPosture();
      expect(posture.lastStatus).toBe('ERROR');
      // Never having passed must not be reported as a passing state.
      expect(posture.lastPassAt).toBeNull();
      expect(posture.secondsSinceLastPass).toBeNull();
    });

    it('reports when detection last actually completed', async () => {
      const summary = await service.runDetection({ evaluator: 'test', now: new Date() });
      const posture = await service.detectionPosture();

      expect(summary.status).toBe('PASS');
      expect(posture.lastStatus).toBe('PASS');
      expect(posture.lastPassAt).not.toBeNull();
      expect(posture.secondsSinceLastPass).not.toBeNull();
    });
  });

  describe('configuration, not invented policy', () => {
    it('has no findings when no rules are configured', async () => {
      // Out of the box the system detects nothing, and says so. A hard-coded plausible-looking threshold
      // would dress an invented policy as an implemented control.
      const source = await participant('norules-src');
      const destination = await participant('norules-dst');
      const now = new Date();
      for (let index = 0; index < 10; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.rulesEvaluated).toBe(0);
      expect(summary.findingsWritten).toBe(0);
    });

    it('ignores a rule that is not yet in force or already retired', async () => {
      const source = await participant('eff-src');
      const destination = await participant('eff-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await db.query(
        `INSERT INTO fraud_signal_rules (
           rule_key, signal_type, window_minutes, threshold_count, created_by, effective_from
         ) VALUES ('FUTURE', 'VELOCITY_COUNT', 60, 1, 'test', now() + interval '1 day')`,
      );

      const summary = await service.runDetection({ evaluator: 'test', now });

      expect(summary.rulesEvaluated).toBe(0);
    });

    it('refuses a rule that measures nothing', async () => {
      await expect(
        db.query(
          `INSERT INTO fraud_signal_rules (rule_key, signal_type, created_by)
           VALUES ('INERT', 'VELOCITY_COUNT', 'test')`,
        ),
      ).rejects.toThrow();
    });

    it('refuses two active rules with the same key', async () => {
      await addRule({
        ruleKey: 'DUP-KEY',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 1,
      });
      await expect(
        db.query(
          `INSERT INTO fraud_signal_rules (rule_key, signal_type, window_minutes, threshold_count, created_by)
           VALUES ('DUP-KEY', 'VELOCITY_COUNT', 30, 1, 'test')`,
        ),
      ).rejects.toThrow();
    });

    it('refuses to roll back while findings exist', async () => {
      const source = await participant('rb-src');
      const destination = await participant('rb-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'RB',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });
      await service.runDetection({ evaluator: 'test', now });

      const { FraudRiskSignals1785753600609 } = await import(
        '../src/migrations/1785753600609-FraudRiskSignals'
      );
      const migration = new FraudRiskSignals1785753600609();
      const runner = { query: (sql: string) => db.query(sql) };
      await expect(
        migration.down(runner as unknown as Parameters<typeof migration.down>[0]),
      ).rejects.toThrow(/Refusing to roll back/i);

      // And the schema is still intact after the refusal.
      const findings = await service.openFindings(source.customerId);
      expect(findings).toHaveLength(1);
    });
  });

  describe('audit', () => {
    it('records who and what when a finding is raised', async () => {
      const source = await participant('audit-src');
      const destination = await participant('audit-dst');
      const now = new Date();
      for (let index = 0; index < 4; index += 1) {
        await completedTransfer({
          source,
          destination,
          amountMinor: 5_000,
          occurredAt: new Date(now.getTime() - index * 60_000),
        });
      }
      await addRule({
        ruleKey: 'AUDIT',
        signalType: 'VELOCITY_COUNT',
        windowMinutes: 60,
        thresholdCount: 3,
      });

      await service.runDetection({ evaluator: 'test', now });

      const rows: Array<{ action: string; entity_type: string; new_values: unknown }> =
        await db.query(
          `SELECT action, entity_type, new_values FROM audit_events
          WHERE entity_type = 'FRAUD_SIGNAL_FINDING'`,
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe('FRAUD_SIGNAL_RAISED');
      expect(rows[0]?.new_values).toMatchObject({
        ruleKey: 'AUDIT',
        signalType: 'VELOCITY_COUNT',
        observedCount: 4,
        thresholdCount: 3,
      });
    });
  });
});
