import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { WorkerSupervisorService } from './worker-supervisor.service';
import type { DiagnosticsReport, HealthComponentReport } from './operations.types';

/**
 * Operational diagnostics for the internal read surfaces (`/internal/diagnostics`, readiness).
 *
 * Two layers, deliberately kept in one payload:
 *
 *  - the **flat verdicts** (`database`, `migrations`, `reconciliation`, `pendingOutbox`) are the
 *    long-standing readiness contract. They are computed exactly as before, because `HealthService`
 *    gates `503` on them and the maturity survey reads them;
 *  - the **`components` array** is the operator-facing view: one entry per thing that was actually
 *    checked, each carrying its own `checkedAt`, an explicit statement of what its state means, the
 *    subsystem that answered, and — critically — whether anything was measured at all.
 *
 * The distinction `components[].availability` draws is the reason this file changed. A probe that
 * could not run (the database was unreachable, so the migration table was never queried; the
 * reconciliation service threw, so no verdict exists) used to surface as `error`, which reads on a
 * dashboard as "this component is broken". Sometimes it is broken; often nothing is known. Those
 * are different operational facts and the payload now keeps them apart, the same way
 * `OperationalMetricsService.unavailable` and `OperationsCentreView.partial` already do elsewhere in
 * this subsystem. Nothing here invents a new health verdict: every state is delegated to the service
 * that owns it.
 */

/** A probe that could not be executed is a distinct outcome from a probe that reported a failure. */
type Probe<T> =
  | { readonly ok: true; readonly value: T; readonly checkedAt: string }
  | { readonly ok: false; readonly reason: string; readonly checkedAt: string };

@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reconciliationService: ReconciliationService,
    /**
     * Process-local worker supervision. Optional for the same reason the operations centre treats it
     * as optional: diagnostics must stay answerable in a build where no background worker is wired,
     * and an unwired supervisor is a fact to report rather than a reason to throw.
     */
    @Optional() private readonly workerSupervisor?: WorkerSupervisorService,
  ) {}

  async getDiagnostics(): Promise<DiagnosticsReport> {
    const database = await this.checkDatabase();
    // Cascade honesty: with no database, the migration head and the outbox backlog were never
    // measured. Reporting them as `error` would claim knowledge the probe does not have.
    const migrations = database.ok
      ? await this.checkMigrations()
      : this.unavailableProbe<number>('database unavailable; the migration table was not queried');
    const outbox = database.ok
      ? await this.probe('pending outbox query failed', () => this.pendingOutboxCount())
      : this.unavailableProbe<number>(
          'database unavailable; the outbox backlog was not counted (a missing number is not a zero)',
        );

    let reconciliation: DiagnosticsReport['reconciliation'] = { status: 'ERROR' };
    let reconciliationProbe: Probe<'PASS' | 'WARNING' | 'ERROR'> = {
      ok: false,
      reason: 'the reconciliation service threw before producing a verdict',
      checkedAt: new Date().toISOString(),
    };
    try {
      const report = await this.reconciliationService.runReconciliation();
      reconciliation = { status: report.status };
      reconciliationProbe = { ok: true, value: report.status, checkedAt: new Date().toISOString() };
    } catch {
      reconciliation = { status: 'ERROR' };
      reconciliationProbe = {
        ok: false,
        reason: 'the reconciliation service threw before producing a verdict',
        checkedAt: new Date().toISOString(),
      };
    }

    const pendingOutbox = outbox.ok ? outbox.value : -1;
    const appliedCount = migrations.ok ? migrations.value : 0;
    const databaseStatus = database.ok ? 'ok' : 'error';
    const migrationsStatus = migrations.ok ? 'ok' : 'error';

    const status =
      databaseStatus === 'ok' &&
      migrationsStatus === 'ok' &&
      reconciliation.status !== 'ERROR' &&
      pendingOutbox >= 0
        ? 'ok'
        : 'degraded';

    const supervision = await this.probeSupervision();

    return {
      status,
      version: process.env.APP_VERSION ?? process.env.npm_package_version ?? '0.1.0',
      database: { status: databaseStatus },
      migrations: { status: migrationsStatus, appliedCount },
      reconciliation,
      pendingOutbox,
      timestamp: new Date().toISOString(),
      components: [
        {
          key: 'database',
          label: 'Database connectivity',
          state: database.ok ? 'ok' : 'error',
          availability: 'CHECKED',
          meaning: database.ok
            ? 'A `SELECT 1` round-trip on the application connection pool succeeded, so persistence is reachable right now. It says nothing about the correctness of what is stored.'
            : 'The `SELECT 1` round-trip failed, so the instance cannot read or write. Every other data-backed check in this report is therefore unmeasured, not healthy.',
          detail: { query: 'SELECT 1' },
          checkedAt: database.checkedAt,
          source: 'DiagnosticsService → DataSource',
        },
        {
          key: 'migrations',
          label: 'Schema migration head',
          state: !migrations.ok
            ? 'unknown'
            : appliedCount > 0
              ? 'ok'
              : ('degraded' as const),
          availability: migrations.ok ? 'CHECKED' : 'UNAVAILABLE',
          meaning: migrations.ok
            ? 'Rows recorded in `typeorm_migrations`. A count is a presence check on the migration ledger, not proof that the schema matches the code this build expects.'
            : 'Nothing was measured: the migration ledger could not be queried, so no conclusion about the schema is available.',
          detail: migrations.ok ? { appliedCount: migrations.value } : {},
          checkedAt: migrations.checkedAt,
          source: 'DiagnosticsService → typeorm_migrations',
          ...(migrations.ok ? {} : { reason: migrations.reason }),
        },
        {
          key: 'reconciliation',
          label: 'Financial reconciliation',
          state: reconciliationProbe.ok
            ? reconciliationProbe.value === 'PASS'
              ? 'ok'
              : reconciliationProbe.value === 'WARNING'
                ? 'degraded'
                : ('error' as const)
            : ('unknown' as const),
          availability: reconciliationProbe.ok ? 'CHECKED' : 'UNAVAILABLE',
          meaning: reconciliationProbe.ok
            ? 'PASS means every reconciliation check agreed; WARNING means a discrepancy needs review; ERROR means a check could not complete. This is a verdict about the books, not about this process.'
            : 'The reconciliation run threw, so no verdict about the books exists. This is reported as unmeasured rather than as a reconciliation failure.',
          detail: reconciliationProbe.ok ? { verdict: reconciliationProbe.value } : {},
          checkedAt: reconciliationProbe.checkedAt,
          source: 'ReconciliationService.runReconciliation()',
          ...(reconciliationProbe.ok ? {} : { reason: reconciliationProbe.reason }),
        },
        {
          key: 'outbox',
          label: 'Outbox backlog',
          state: !outbox.ok
            ? 'unknown'
            : outbox.value === 0
              ? 'ok'
              : ('degraded' as const),
          availability: outbox.ok ? 'CHECKED' : 'UNAVAILABLE',
          meaning: outbox.ok
            ? outbox.value === 0
              ? 'No event is PENDING or FAILED: a genuine zero, measured against the outbox table.'
              : 'Events are waiting to be published or retried. A non-zero backlog is normal in transit; it matters when it grows or ages.'
            : 'The backlog could not be counted. This is explicitly not a zero — a count that failed and a queue that is empty look identical unless the difference is stated.',
          detail: outbox.ok ? { pendingOrFailed: outbox.value } : {},
          checkedAt: outbox.checkedAt,
          source: 'DiagnosticsService → outbox_events',
          ...(outbox.ok ? {} : { reason: outbox.reason }),
        },
        supervision,
      ],
    };
  }

  private async checkDatabase(): Promise<Probe<true>> {
    return this.probe('database unavailable', async () => {
      await this.dataSource.query('SELECT 1');
      return true as const;
    });
  }

  private async checkMigrations(): Promise<Probe<number>> {
    return this.probe('migration ledger unavailable', async () => {
      const result: unknown = await this.dataSource.query(
        `SELECT COUNT(*)::text AS applied_count FROM typeorm_migrations`,
      );
      const rows = isUnknownArray(result) ? result : [];
      const first = rows[0];
      const record = first && typeof first === 'object' ? (first as Record<string, unknown>) : {};
      return Number(record.applied_count ?? 0);
    });
  }

  private async pendingOutboxCount(): Promise<number> {
    const result: unknown = await this.dataSource.query(
      `SELECT COUNT(*)::text AS pending_count
         FROM outbox_events
        WHERE status IN ('PENDING', 'FAILED')`,
    );
    const rows = isUnknownArray(result) ? result : [];
    const first = rows[0];
    const record = first && typeof first === 'object' ? (first as Record<string, unknown>) : {};
    return Number(record.pending_count ?? 0);
  }

  /**
   * Worker supervision, reported at the granularity an operator can act on.
   *
   * The supervisor's own `indeterminate` status is preserved rather than smoothed into `degraded`:
   * it means no tick has been observed **in this process**, which is a statement about this
   * instance's window onto the fleet, not about the workers themselves.
   */
  private async probeSupervision(): Promise<HealthComponentReport> {
    const checkedAt = new Date().toISOString();
    if (!this.workerSupervisor) {
      return {
        key: 'workers',
        label: 'Background worker supervision',
        state: 'unknown',
        availability: 'UNAVAILABLE',
        meaning:
          'No worker supervisor is wired into this process, so background-worker liveness was not observed here. Consult a supervised instance before concluding that a worker is idle.',
        detail: {},
        checkedAt,
        source: 'WorkerSupervisorService (not provided)',
        reason: 'worker supervision is not wired in this process',
      };
    }
    const probe = await this.probe('worker supervisor threw while reporting', () =>
      Promise.resolve(this.workerSupervisor!.report()),
    );
    if (!probe.ok) {
      return {
        key: 'workers',
        label: 'Background worker supervision',
        state: 'unknown',
        availability: 'UNAVAILABLE',
        meaning: 'The supervisor could not produce a report, so worker liveness is unknown for this process.',
        detail: {},
        checkedAt: probe.checkedAt,
        source: 'WorkerSupervisorService.report()',
        reason: probe.reason,
      };
    }
    const report = probe.value;
    return {
      key: 'workers',
      label: 'Background worker supervision',
      state:
        report.status === 'ok' ? 'ok' : report.status === 'degraded' ? 'degraded' : 'unknown',
      availability: report.status === 'indeterminate' ? 'UNAVAILABLE' : 'CHECKED',
      meaning:
        report.status === 'indeterminate'
          ? 'Nothing has been measured in this process: every supervised worker is either configured off or has never completed a tick here. No conclusion about the workers is available.'
          : report.status === 'ok'
            ? 'Every supervised worker that is enabled in this process completed a tick inside its allowed interval window.'
            : 'At least one supervised worker is failing or has missed its expected ticks in this process.',
      detail: {
        processLocal: true,
        workersObserved: report.workers.filter((worker) => worker.activityObserved).length,
        workersEnabled: report.workers.filter((worker) => worker.enabled).length,
        failing: report.failing.length,
        stale: report.stale.length,
      },
      checkedAt: report.generatedAt ?? probe.checkedAt,
      source: 'WorkerSupervisorService.report()',
      ...(report.status === 'indeterminate'
        ? {
            reason:
              'no completed tick observed in this process; disabled workers are never measured by design',
          }
        : {}),
    };
  }

  /** Runs `run` and records when it ran; a throw becomes `ok: false`, never a fabricated value. */
  private async probe<T>(reason: string, run: () => Promise<T>): Promise<Probe<T>> {
    try {
      const value = await run();
      return { ok: true, value, checkedAt: new Date().toISOString() };
    } catch {
      return { ok: false, reason, checkedAt: new Date().toISOString() };
    }
  }

  private unavailableProbe<T>(reason: string): Probe<T> {
    return { ok: false, reason, checkedAt: new Date().toISOString() };
  }
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
