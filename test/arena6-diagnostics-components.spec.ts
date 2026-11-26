import type { DataSource } from 'typeorm';

import { DiagnosticsService } from '../src/operations/diagnostics.service';
import type { DiagnosticsReport } from '../src/operations/operations.types';
import type { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import type { WorkerSupervisorService } from '../src/operations/worker-supervisor.service';

/**
 * ARENA 6 — System Health component reporting.
 *
 * The behaviour under test is the difference between three outcomes a dashboard must not conflate:
 * a component that answered, a component that is broken, and a component that was never measured.
 * These tests pin the third case specifically, because it is the one that is easiest to get wrong and
 * hardest to notice: a probe that could not run must be reported as unknown, and must never be
 * allowed to appear as `ok` or as a zero.
 */

const isoTimestamp = (value: unknown) => {
  expect(typeof value).toBe('string');
  expect(Number.isNaN(Date.parse(value as string))).toBe(false);
};

/**
 * The doubles are structural fakes, cast once at the seam to the dependency type the service declares.
 * Casting through `unknown` rather than handing the constructor an `any` keeps every expectation below
 * type-checked against the real contract: a renamed or widened field on `HealthComponentReport` has to
 * fail here, not silently pass against a loose stub.
 */
const dataSource = (implementation: (sql: string) => unknown): DataSource =>
  ({
    query: jest.fn((sql: string): Promise<unknown> => {
      try {
        return Promise.resolve(implementation(sql));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('query failed'));
      }
    }),
  }) as unknown as DataSource;

const reconciliation = (status: 'PASS' | 'WARNING' | 'ERROR'): ReconciliationService =>
  ({
    runReconciliation: jest.fn(
      (): Promise<{ status: 'PASS' | 'WARNING' | 'ERROR' }> => Promise.resolve({ status }),
    ),
  }) as unknown as ReconciliationService;

/** A reconciliation run that could not complete at all — distinct from one that reported an ERROR. */
const throwingReconciliation = (): ReconciliationService =>
  ({
    runReconciliation: jest.fn((): Promise<never> => Promise.reject(new Error('connection reset'))),
  }) as unknown as ReconciliationService;

interface SupervisorStub {
  generatedAt: string;
  status: 'ok' | 'degraded' | 'indeterminate';
  workers: Array<{ name: string; enabled: boolean; activityObserved: boolean }>;
  neverObserved: string[];
  disabled: string[];
  failing: string[];
  stale: string[];
  scope: string;
}

const supervisor = (report: SupervisorStub): WorkerSupervisorService =>
  ({ report: (): SupervisorStub => report }) as unknown as WorkerSupervisorService;

const healthy = (sql: string): unknown => {
  if (sql.includes('SELECT 1')) return [{ ok: 1 }];
  if (sql.includes('typeorm_migrations')) return [{ applied_count: '42' }];
  if (sql.includes('outbox_events')) return [{ pending_count: '0' }];
  return [];
};

describe('ARENA 6 — diagnostics components', () => {
  it('reports every component it checked, with a meaning and its own check time', async () => {
    const service = new DiagnosticsService(
      dataSource(healthy),
      reconciliation('PASS'),
      supervisor({
        generatedAt: '2026-11-05T10:00:00.000Z',
        status: 'ok',
        workers: [{ name: 'notification-delivery', enabled: true, activityObserved: true }],
        neverObserved: [],
        disabled: [],
        failing: [],
        stale: [],
        scope: 'process-local',
      }),
    );

    const report: DiagnosticsReport = await service.getDiagnostics();
    expect(report.status).toBe('ok');
    const byKey = new Map(report.components!.map((entry) => [entry.key, entry]));
    // Every probe the service runs must appear as a component, including the ones that passed.
    expect([...byKey.keys()].sort()).toEqual([
      'database',
      'migrations',
      'outbox',
      'reconciliation',
      'workers',
    ]);

    for (const component of report.components!) {
      expect(component.label.trim().length).toBeGreaterThan(0);
      expect(component.meaning.trim().length).toBeGreaterThan(0);
      expect(component.source.trim().length).toBeGreaterThan(0);
      isoTimestamp(component.checkedAt);
      if (component.availability !== 'CHECKED') {
        expect(component.reason).toBeDefined();
      }
    }

    expect(byKey.get('database')!.state).toBe('ok');
    expect(byKey.get('migrations')!.detail.appliedCount).toBe(42);
    // A counted zero is stated as a measured zero, not as an absence of data.
    expect(byKey.get('outbox')!.state).toBe('ok');
    expect(byKey.get('outbox')!.meaning).toMatch(/genuine zero/i);
    expect(byKey.get('reconciliation')!.state).toBe('ok');
    expect(byKey.get('workers')!.availability).toBe('CHECKED');
    // The supervisor's own generation time is preserved rather than replaced by "now".
    expect(byKey.get('workers')!.checkedAt).toBe('2026-11-05T10:00:00.000Z');
  });

  it('marks every downstream check unmeasured when the database probe fails', async () => {
    const queries: string[] = [];
    const service = new DiagnosticsService(
      dataSource((sql) => {
        queries.push(sql);
        if (sql.includes('SELECT 1')) throw new Error('database is down');
        return healthy(sql);
      }),
      reconciliation('PASS'),
    );

    const report = await service.getDiagnostics();
    expect(report.status).toBe('degraded');
    // The pre-existing flat contract is unchanged for readiness and the maturity survey.
    expect(report.database).toEqual({ status: 'error' });
    expect(report.migrations).toEqual({ status: 'error', appliedCount: 0 });
    expect(report.pendingOutbox).toBe(-1);

    const byKey = new Map(report.components!.map((entry) => [entry.key, entry]));
    expect(byKey.get('database')!.availability).toBe('CHECKED');
    expect(byKey.get('database')!.state).toBe('error');
    expect(byKey.get('migrations')!.availability).toBe('UNAVAILABLE');
    expect(byKey.get('migrations')!.state).toBe('unknown');
    expect(byKey.get('migrations')!.reason).toMatch(/database unavailable/i);
    expect(byKey.get('outbox')!.availability).toBe('UNAVAILABLE');
    // ...and the claim is spelled out, because "no number" reads as "nothing pending" otherwise.
    expect(byKey.get('outbox')!.meaning).toMatch(/not a zero/i);
    // A cascade skip must not issue queries that cannot succeed.
    expect(queries.some((sql) => sql.includes('typeorm_migrations'))).toBe(false);
  });

  it('distinguishes an unreadable outbox count from an empty queue', async () => {
    const service = new DiagnosticsService(
      dataSource((sql) => {
        if (sql.includes('outbox_events')) throw new Error('statement timeout');
        return healthy(sql);
      }),
      reconciliation('PASS'),
    );

    const report = await service.getDiagnostics();
    const outbox = report.components!.find((entry) => entry.key === 'outbox')!;
    expect(outbox.availability).toBe('UNAVAILABLE');
    expect(outbox.state).toBe('unknown');
    // The reason names the failed read, not the underlying database error text, which must not leak.
    expect(outbox.reason).toMatch(/pending outbox query failed/i);
    expect(outbox.reason).not.toMatch(/timeout/i);
    expect(outbox.detail).toEqual({});
    // The flat field keeps its historical sentinel so existing consumers are unaffected.
    expect(report.pendingOutbox).toBe(-1);
    expect(report.status).toBe('degraded');
  });

  it('reports a reconciliation throw as unknown rather than as a failed reconciliation', async () => {
    const service = new DiagnosticsService(dataSource(healthy), throwingReconciliation());
    const report = await service.getDiagnostics();
    const reconciliationComponent = report.components!.find(
      (entry) => entry.key === 'reconciliation',
    )!;
    expect(report.reconciliation).toEqual({ status: 'ERROR' });
    expect(reconciliationComponent.availability).toBe('UNAVAILABLE');
    expect(reconciliationComponent.state).toBe('unknown');
    expect(reconciliationComponent.reason).toMatch(/threw before producing a verdict/i);
    expect(reconciliationComponent.meaning).toMatch(/no verdict about the books exists/i);
  });

  it('states the process-local limit when no worker was observed', async () => {
    const service = new DiagnosticsService(
      dataSource(healthy),
      reconciliation('PASS'),
      supervisor({
        generatedAt: '2026-11-05T11:00:00.000Z',
        status: 'indeterminate',
        workers: [],
        neverObserved: ['notification-delivery'],
        disabled: ['banking-dispatch'],
        failing: [],
        stale: [],
        scope: 'process-local',
      }),
    );

    const report = await service.getDiagnostics();
    const workers = report.components!.find((entry) => entry.key === 'workers')!;
    expect(workers.availability).toBe('UNAVAILABLE');
    expect(workers.state).toBe('unknown');
    expect(workers.reason).toMatch(/no completed tick observed in this process/i);
    // Reporting nothing measured must not silently change the overall readiness verdict.
    expect(report.status).toBe('ok');
  });

  it('names an unwired supervisor as unavailable instead of omitting the component', async () => {
    const service = new DiagnosticsService(dataSource(healthy), reconciliation('PASS'));
    const report = await service.getDiagnostics();
    const workers = report.components!.find((entry) => entry.key === 'workers')!;
    expect(workers.availability).toBe('UNAVAILABLE');
    expect(workers.reason).toMatch(/not wired in this process/i);
    expect(workers.source).toMatch(/not provided/i);
  });

  it('keeps per-probe check times distinct from the report assembly time', async () => {
    const startedAt = Date.now();
    const service = new DiagnosticsService(dataSource(healthy), reconciliation('PASS'));
    const report = await service.getDiagnostics();
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
    for (const component of report.components!) {
      const checked = Date.parse(component.checkedAt);
      expect(checked).toBeGreaterThanOrEqual(startedAt - 1000);
      expect(checked).toBeLessThanOrEqual(Date.parse(report.timestamp) + 1000);
    }
  });
});
