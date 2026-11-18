import type { DataSource } from 'typeorm';

import { PerformanceAcceptanceService } from '../src/performance/performance-acceptance.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 3D Group 28 — performance acceptance.
 *
 * The properties under test:
 *
 * 1. **Plan shape is measured, not timing.** Timing here describes this laptop; plan shape is the same in
 *    production. This asserts the harness reads real plans.
 * 2. **A small table is reported NOT_MEASURED, never PASS.** Postgres correctly prefers a sequential scan on a
 *    small table; calling that a pass would be a claim without evidence.
 * 3. **A genuine seq scan on a hot path is an ERROR** — the harness must be able to fail.
 * 4. **No fabricated throughput.** The report contains no latency or throughput figure at all.
 */
describe('Group 28 — performance acceptance', () => {
  let db: DataSource;
  let service: PerformanceAcceptanceService;

  beforeAll(async () => {
    db = await createIntegrationDataSource('g28perf');
    service = new PerformanceAcceptanceService(db);
  }, 180_000);

  afterAll(async () => {
    await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  /** Seeds audit events in bulk so the planner sees a realistic cardinality. */
  async function seedAuditEvents(count: number): Promise<void> {
    await db.query(
      `INSERT INTO audit_events (entity_type, entity_id, action, actor, occurred_at)
       SELECT 'PERF_ENTITY',
              ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
              'PERF_ACTION',
              'perf-seed',
              now() - (g || ' seconds')::interval
         FROM generate_series(1, $1) AS g`,
      [count],
    );
    // The statistics collector is asynchronous; without this the harness reads a stale zero row count and
    // reports NOT_MEASURED for a table that is in fact populated.
    await db.query(`ANALYZE audit_events`);
  }

  describe('the report is honest about what it measured', () => {
    it('reports NOT_MEASURED rather than PASS on an empty database', async () => {
      /*
       * The central discipline. An empty table seq-scans because that is correct, and calling it a pass would
       * claim a plan was validated when nothing was validated.
       */
      const report = await service.report();

      for (const finding of report.findings) {
        expect(finding.evidence).toBe('NOT_MEASURED');
        expect(finding.verdict).toBe('WARNING');
        expect(finding.detail).toMatch(/at least|below/i);
      }
      expect(report.verdict).toBe('WARNING');
      expect(report.notMeasured.length).toBe(report.findings.length);
    });

    it('measures a real plan once the table has volume', async () => {
      await seedAuditEvents(1_200);

      const report = await service.report();
      const finding = report.findings.find((entry) => entry.name === 'audit-by-entity');

      expect(finding?.evidence).toBe('MEASURED');
      expect(finding?.measuredAtRows).toBeGreaterThanOrEqual(500);
      expect(finding?.planShape).not.toBe('NOT_PLANNED');
      expect(finding?.planShape).not.toBe('UNKNOWN');
      expect(finding?.indexNames.length ?? 0).toBeGreaterThan(0);
    });

    it('confirms the audit entity index is used for the entity lookup', async () => {
      // `idx_audit_events_entity_time` exists precisely for this query.
      await seedAuditEvents(1_200);

      const report = await service.report();
      const finding = report.findings.find((entry) => entry.name === 'audit-by-entity');

      expect(finding?.usesIndex).toBe(true);
      expect(finding?.verdict).toBe('PASS');
      expect(finding?.indexNames.join(' ')).toMatch(/idx_audit_events_entity_time/);
    });

    it('confirms the range index added in Group 23 is used for the evidence export', async () => {
      // `idx_audit_events_occurred_at` was added specifically because no index covered a bare date range.
      await seedAuditEvents(1_200);

      const report = await service.report();
      const finding = report.findings.find((entry) => entry.name === 'audit-by-time-range');

      expect(finding?.usesIndex).toBe(true);
      expect(finding?.indexNames.join(' ')).toMatch(/idx_audit_events_occurred_at/);
    });

    it('never reports a latency or throughput figure', async () => {
      /*
       * Any timing produced in this sandbox describes this sandbox. Presenting it as acceptance evidence would
       * be fabrication, so the report contains no timing field at all — asserted structurally rather than by
       * convention.
       */
      await seedAuditEvents(600);
      const report = await service.report();
      const serialized = JSON.stringify(report);

      expect(Object.keys(report)).not.toContain('latency');
      expect(Object.keys(report)).not.toContain('throughput');
      expect(Object.keys(report)).not.toContain('p99');
      expect(serialized).not.toMatch(/milliseconds|ms\b|seconds|req\/s|per second/i);

      for (const finding of report.findings) {
        expect(Object.keys(finding)).not.toContain('durationMs');
        expect(Object.keys(finding)).not.toContain('elapsedMs');
      }
    });

    it('is reproducible — the same schema produces the same plan', async () => {
      await seedAuditEvents(1_200);
      const first = await service.report();
      const second = await service.report();

      const shape = (report: typeof first, name: string) =>
        report.findings.find((entry) => entry.name === name)?.planShape;
      expect(shape(second, 'audit-by-entity')).toBe(shape(first, 'audit-by-entity'));
    }, 30_000);
  });

  describe('the harness can fail', () => {
    it('reports ERROR when a hot path has no usable index', async () => {
      /*
       * A harness that cannot fail is not a harness. The entity lookup has a dedicated index in the real schema,
       * so dropping it must produce an ERROR rather than a warning.
       */
      await seedAuditEvents(1_200);

      const before = await service.report();
      expect(before.findings.find((entry) => entry.name === 'audit-by-entity')?.verdict).toBe(
        'PASS',
      );

      const indexes: Array<{ indexname: string }> = await db.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'audit_events'`,
      );
      const entityIndex = indexes.find((index) => /entity_time/.test(index.indexname));
      expect(entityIndex).toBeDefined();
      await db.query(`DROP INDEX ${entityIndex?.indexname}`);

      const after = await service.report();
      const finding = after.findings.find((entry) => entry.name === 'audit-by-entity');

      expect(finding?.evidence).toBe('MEASURED');
      expect(finding?.usesIndex).toBe(false);
      expect(finding?.verdict).toBe('ERROR');
      expect(finding?.detail).toMatch(/seq/i);
      expect(after.verdict).toBe('ERROR');
    });
  });

  describe('coverage of the hot paths the application actually issues', () => {
    it('checks every declared hot path', async () => {
      const report = await service.report();
      const names = report.findings.map((finding) => finding.name).sort();

      expect(names).toEqual([
        'audit-by-entity',
        'audit-by-time-range',
        'disputes-by-customer',
        'fraud-findings-open',
        'ledger-lines-by-journal',
        'notification-deliveries-pending',
        'outbox-due-events',
        'transfer-by-idempotency-key',
      ]);
    });

    it('gives every finding an actionable detail', async () => {
      const report = await service.report();
      for (const finding of report.findings) {
        expect(finding.detail.length).toBeGreaterThan(10);
        expect(finding.description.length).toBeGreaterThan(10);
      }
    });

    it('records the reason for anything it could not measure', async () => {
      const report = await service.report();
      for (const skipped of report.notMeasured) {
        expect(skipped.reason.length).toBeGreaterThan(5);
      }
    });
  });
});
