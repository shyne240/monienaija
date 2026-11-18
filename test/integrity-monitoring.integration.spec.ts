import type { DataSource } from 'typeorm';

import { IntegrityMonitoringService } from '../src/operations/integrity-monitoring.service';
import {
  VerificationStatus,
  type ReconciliationCheck,
  type ReconciliationReport,
} from '../src/reconciliation/reconciliation.types';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
} from './support/pg-harness';

/**
 * ARENA 3D Group 18 — durable integrity snapshots and drift detection.
 *
 * The behaviour under test cannot be faked: "was this check passing yesterday?" is a question about stored
 * history, and "newly broken" is a comparison against a previous run. Both require a real database.
 */

function check(name: string, status: VerificationStatus, message = 'ok'): ReconciliationCheck {
  return { name, status, message, details: {} };
}

function report(status: VerificationStatus, checks: ReconciliationCheck[]): ReconciliationReport {
  return {
    status,
    generatedAt: new Date().toISOString(),
    checks,
    binding: { status, generatedAt: new Date().toISOString(), checks: [] } as never,
  };
}

describe('Group 18 — integrity monitoring', () => {
  let db: DataSource;
  let service: IntegrityMonitoringService;

  beforeAll(async () => {
    db = await createIntegrationDataSource('g18integrity');
    service = new IntegrityMonitoringService(db);
  }, 180_000);

  afterAll(async () => {
    if (db?.isInitialized) await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    // Snapshots are append-only by trigger, so cleaning between tests must disable the trigger — which is
    // itself only possible as the table owner, and is never something application code may do.
    await db.query(
      'ALTER TABLE integrity_check_results DISABLE TRIGGER integrity_check_results_append_only',
    );
    await db.query(
      'ALTER TABLE integrity_snapshots DISABLE TRIGGER integrity_snapshots_append_only',
    );
    await db.query('DELETE FROM integrity_check_results');
    await db.query('DELETE FROM integrity_snapshots');
    await db.query(
      'ALTER TABLE integrity_check_results ENABLE TRIGGER integrity_check_results_append_only',
    );
    await db.query(
      'ALTER TABLE integrity_snapshots ENABLE TRIGGER integrity_snapshots_append_only',
    );
  });

  describe('the question a stateless report could not answer', () => {
    it('records a snapshot with every check', async () => {
      const result = await service.record(
        report(VerificationStatus.PASS, [
          check('journal_balance_integrity', VerificationStatus.PASS),
          check('orphan_ledger_entries', VerificationStatus.PASS),
        ]),
        { durationMs: 42, observer: 'readiness-probe' },
      );
      expect(result.snapshot).not.toBeNull();
      expect(result.snapshot?.durationMs).toBe(42);
      expect(result.checks).toHaveLength(2);

      const rows: Array<{ n: string }> = await db.query(
        'SELECT count(*)::text AS n FROM integrity_check_results WHERE snapshot_id = $1',
        [result.snapshot?.id],
      );
      expect(firstRow(rows, 'rows').n).toBe('2');
    });

    it('reports when each check last passed', async () => {
      // This is the whole point of persistence: "how long has this been broken?" is unanswerable from a
      // single report, and it is the first question asked in a review.
      // Backdate by inserting directly; the append-only trigger correctly forbids UPDATE, including in tests.
      const old: Array<{ id: string }> = await db.query(
        `INSERT INTO integrity_snapshots (observed_at, status, duration_ms) VALUES (NOW() - INTERVAL '3 days', 'PASS', 1) RETURNING id`,
      );
      const oldId = firstRow(old, 'old snapshot').id;
      await db.query(
        `INSERT INTO integrity_check_results (snapshot_id, check_name, status, finding_count)
         VALUES ($1, 'journal_balance_integrity', 'PASS', 0)`,
        [oldId],
      );
      await service.record(
        report(VerificationStatus.ERROR, [
          check('journal_balance_integrity', VerificationStatus.ERROR),
        ]),
      );

      const passes = await service.lastPasses();
      const balance = passes.find((entry) => entry.checkName === 'journal_balance_integrity');
      expect(balance?.lastStatus).toBe('ERROR');
      expect(balance?.lastPassedAt).not.toBeNull();
      // The last pass is ~3 days old while the failure is current.
      const ageMs = Date.now() - new Date(balance?.lastPassedAt ?? 0).getTime();
      expect(ageMs).toBeGreaterThan(2 * 24 * 60 * 60 * 1000);
    });
  });

  describe('drift is the signal, not the absolute status', () => {
    it('flags a check that newly breaks as a regression', async () => {
      // A system that has been ERROR for a week must not page on every run. A check that *just* broke must.
      await service.record(
        report(VerificationStatus.PASS, [
          check('journal_balance_integrity', VerificationStatus.PASS),
        ]),
      );
      const now = await service.record(
        report(VerificationStatus.ERROR, [
          check('journal_balance_integrity', VerificationStatus.ERROR),
        ]),
      );

      expect(now.regressionDetected).toBe(true);
      expect(now.drift).toEqual([
        expect.objectContaining({
          checkName: 'journal_balance_integrity',
          previousStatus: 'PASS',
          currentStatus: 'ERROR',
          change: 'newly-failing',
        }),
      ]);
    });

    it('does not flag a stable known failure as a regression', async () => {
      await service.record(
        report(VerificationStatus.ERROR, [
          check('journal_balance_integrity', VerificationStatus.ERROR),
        ]),
      );
      const again = await service.record(
        report(VerificationStatus.ERROR, [
          check('journal_balance_integrity', VerificationStatus.ERROR),
        ]),
      );
      expect(again.regressionDetected).toBe(false);
      expect(again.drift).toEqual([]);
    });

    it('detects recovery', async () => {
      await service.record(
        report(VerificationStatus.ERROR, [
          check('journal_balance_integrity', VerificationStatus.ERROR),
        ]),
      );
      const recovered = await service.record(
        report(VerificationStatus.PASS, [
          check('journal_balance_integrity', VerificationStatus.PASS),
        ]),
      );
      expect(recovered.drift).toEqual([
        expect.objectContaining({ change: 'recovered', currentStatus: 'PASS' }),
      ]);
      expect(recovered.regressionDetected).toBe(false);
    });

    it('flags PASS -> WARNING as newly-degraded', async () => {
      await service.record(
        report(VerificationStatus.PASS, [
          check('wallet_balances_ledger_derived', VerificationStatus.PASS),
        ]),
      );
      const degraded = await service.record(
        report(VerificationStatus.WARNING, [
          check('wallet_balances_ledger_derived', VerificationStatus.WARNING),
        ]),
      );
      expect(degraded.drift[0]?.change).toBe('newly-degraded');
      expect(degraded.regressionDetected).toBe(true);
    });

    it('reports a first-ever observation as new, not as a regression', async () => {
      const first = await service.record(
        report(VerificationStatus.ERROR, [check('brand_new_check', VerificationStatus.ERROR)]),
      );
      expect(first.newChecks).toEqual(['brand_new_check']);
      expect(first.drift[0]).toMatchObject({ change: 'new', previousStatus: null });
      expect(first.regressionDetected).toBe(false);
    });
  });

  describe('history is append-only, enforced by the database', () => {
    it('refuses to update a snapshot', async () => {
      const result = await service.record(
        report(VerificationStatus.PASS, [check('a', VerificationStatus.PASS)]),
      );
      await expect(
        db.query(`UPDATE integrity_snapshots SET status = 'ERROR' WHERE id = $1`, [
          result.snapshot?.id,
        ]),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses to update a check result', async () => {
      // Rewriting a result would destroy exactly the property that makes drift visible.
      const result = await service.record(
        report(VerificationStatus.ERROR, [check('a', VerificationStatus.ERROR)]),
      );
      await expect(
        db.query(`UPDATE integrity_check_results SET status = 'PASS' WHERE snapshot_id = $1`, [
          result.snapshot?.id,
        ]),
      ).rejects.toThrow(/append-only/);
    });

    it('refuses to delete a snapshot', async () => {
      const result = await service.record(
        report(VerificationStatus.PASS, [check('a', VerificationStatus.PASS)]),
      );
      await expect(
        db.query(`DELETE FROM integrity_snapshots WHERE id = $1`, [result.snapshot?.id]),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('monitoring never breaks its caller', () => {
    it('returns a report with a null snapshot when history cannot be written', async () => {
      // A reconciliation probe runs inside readiness and diagnostics. Failing those because the *history*
      // table is unavailable would turn an observability problem into an availability problem.
      const broken = new IntegrityMonitoringService({
        // History reads succeed (nothing stored yet); only the write path fails.
        query: () => Promise.resolve([]),
        transaction: () => Promise.reject(new Error('relation does not exist')),
      } as unknown as DataSource);
      const result = await broken.record(
        report(VerificationStatus.PASS, [check('a', VerificationStatus.PASS)]),
      );
      expect(result.snapshot).toBeNull();
      // The verdict itself is still reported truthfully.
      expect(result.status).toBe(VerificationStatus.PASS);
      expect(result.checks).toHaveLength(1);
    });
  });

  describe('conflicting verdicts are stored exactly as reported', () => {
    it('keeps a partial run honest rather than recomputing it', async () => {
      // Monitoring stores what the checks said. If it recomputed or normalised the aggregate it would become
      // a second, divergent source of integrity truth.
      const result = await service.record(
        report(VerificationStatus.ERROR, [
          check('a', VerificationStatus.PASS),
          check('b', VerificationStatus.ERROR),
        ]),
      );
      expect(result.status).toBe(VerificationStatus.ERROR);
      const stored: Array<{ status: string }> = await db.query(
        `SELECT status FROM integrity_snapshots WHERE id = $1`,
        [result.snapshot?.id],
      );
      expect(firstRow(stored, 'snapshot').status).toBe('ERROR');
    });
  });

  describe('history listing', () => {
    it('returns snapshots newest first', async () => {
      const older: Array<{ id: string }> = await db.query(
        `INSERT INTO integrity_snapshots (observed_at, status, duration_ms) VALUES (NOW() - INTERVAL '1 hour', 'PASS', 1) RETURNING id`,
      );
      await db.query(
        `INSERT INTO integrity_check_results (snapshot_id, check_name, status, finding_count)
         VALUES ($1, 'a', 'PASS', 0)`,
        [firstRow(older, 'older snapshot').id],
      );
      await service.record(
        report(VerificationStatus.ERROR, [check('a', VerificationStatus.ERROR)]),
      );
      const history = await service.history();
      expect(history).toHaveLength(2);
      expect(history[0]?.status).toBe('ERROR');
    });
  });
});
