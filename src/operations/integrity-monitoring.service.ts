/**
 * ARENA 3D Group 18 — integrity monitoring: durable snapshots and drift detection.
 *
 * See the migration for why storage was needed. This service adds the two things the stateless
 * `ReconciliationService` report could not provide:
 *
 *  1. **A persisted record of every run**, so "when did this check last pass?" is answerable.
 *  2. **Drift detection** — the difference between a stable known failure and a newly-broken invariant.
 *
 * ## The distinction this exists to make
 *
 * | Yesterday | Today | Meaning |
 * |---|---|---|
 * | ERROR | ERROR | A known, stable problem. Already being worked. |
 * | PASS | ERROR | **A new incident.** Something changed. Escalate. |
 * | ERROR | PASS | A recovery. Worth confirming it holds. |
 *
 * Without stored history the first and second rows are indistinguishable from a single report, which is
 * precisely how a newly-broken invariant gets triaged as "the same old reconciliation warning".
 *
 * ## Read-only
 *
 * Every check runs inside a read-only transaction supplied by `ReconciliationService`. This service only
 * writes *its own* snapshot rows; it never mutates business data to make a check pass.
 */
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  ReconciliationCheck,
  ReconciliationReport,
} from '../reconciliation/reconciliation.types';
import { VerificationStatus } from '../reconciliation/reconciliation.types';

/** A check whose verdict differs from the previous run. */
export interface DriftEntry {
  checkName: string;
  previousStatus: string | null;
  currentStatus: string;
  /** `null` when this check has no previous observation in the retained history. */
  change: 'newly-failing' | 'recovered' | 'newly-degraded' | 'changed' | 'new';
  findingCount: number;
}

export interface IntegritySnapshotView {
  id: string;
  observedAt: string;
  status: VerificationStatus;
  durationMs: number;
}

export interface LastPassView {
  checkName: string;
  lastPassedAt: string | null;
  lastStatus: string;
  lastObservedAt: string;
}

export interface IntegrityReport {
  generatedAt: string;
  /** Aggregate verdict for this run. */
  status: VerificationStatus;
  snapshot: IntegritySnapshotView | null;
  checks: Array<{ name: string; status: string; findingCount: number }>;
  drift: DriftEntry[];
  /**
   * True when any check moved from a non-failing state to failing. This is the field an alert should key
   * on, not the aggregate status — a system that has been FAIL for a week must not page every run.
   */
  regressionDetected: boolean;
  /** Checks with no prior observation in retained history. */
  newChecks: string[];
}

@Injectable()
export class IntegrityMonitoringService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Records a reconciliation report as a snapshot and compares it with the previous run.
   *
   * The report is passed in rather than generated here so that monitoring never becomes a second, divergent
   * implementation of the checks. There is one source of integrity verdicts.
   */
  async record(
    report: ReconciliationReport,
    options: { durationMs?: number; observer?: string | null } = {},
  ): Promise<IntegrityReport> {
    const previous = await this.previousStatuses();
    const drift = compare(previous, report.checks);

    const snapshotId = await this.persist(report, options);
    const snapshot = snapshotId ? await this.loadSnapshot(snapshotId) : null;

    return {
      generatedAt: new Date().toISOString(),
      status: report.status,
      snapshot,
      checks: report.checks.map((check) => ({
        name: check.name,
        status: check.status,
        findingCount: findingCountOf(check),
      })),
      drift,
      regressionDetected: drift.some(
        (entry) => entry.change === 'newly-failing' || entry.change === 'newly-degraded',
      ),
      newChecks: drift.filter((entry) => entry.change === 'new').map((entry) => entry.checkName),
    };
  }

  /**
   * Statuses from the most recent snapshot per check.
   *
   * `DISTINCT ON` rather than a window function: it uses the `(check_name, status)` index and is readable.
   * The result is keyed by check name so a comparison is a map lookup.
   */
  private async previousStatuses(): Promise<
    Map<string, { status: VerificationStatus; findingCount: number }>
  > {
    const rows: Array<{ check_name: string; status: string; finding_count: number }> =
      await this.dataSource.query(
        `SELECT DISTINCT ON (r.check_name) r.check_name, r.status, r.finding_count
           FROM integrity_check_results r
           JOIN integrity_snapshots s ON s.id = r.snapshot_id
          ORDER BY r.check_name, s.observed_at DESC, s.id DESC`,
      );
    const result = new Map<string, { status: VerificationStatus; findingCount: number }>();
    for (const row of rows) {
      result.set(row.check_name, {
        status: parseStatus(row.status),
        findingCount: row.finding_count,
      });
    }
    return result;
  }

  private async persist(
    report: ReconciliationReport,
    options: { durationMs?: number; observer?: string | null },
  ): Promise<string | null> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const inserted: Array<{ id: string }> = await manager.query(
          `INSERT INTO integrity_snapshots (observed_at, status, duration_ms, observer)
           VALUES (clock_timestamp(), $1, $2, $3)
           RETURNING id`,
          [
            report.status,
            Math.max(0, Math.round(options.durationMs ?? 0)),
            options.observer ?? null,
          ],
        );
        const snapshotId = inserted[0]?.id;
        if (!snapshotId) throw new Error('integrity snapshot insert returned no id');

        for (const check of report.checks) {
          await manager.query(
            `INSERT INTO integrity_check_results
               (snapshot_id, check_name, status, finding_count, detail)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (snapshot_id, check_name) DO NOTHING`,
            [
              snapshotId,
              check.name,
              check.status,
              findingCountOf(check),
              // Detail is bounded to 500 characters by the column. `message` is already operator-facing text
              // produced by the check itself, not a row dump.
              typeof check.message === 'string' ? check.message.slice(0, 500) : null,
            ],
          );
        }
        return snapshotId;
      });
    } catch {
      /*
       * Monitoring must never break the caller. A reconciliation probe runs inside readiness and diagnostics;
       * failing those because the *history* table is unavailable would turn an observability problem into an
       * availability problem.
       *
       * The consequence is stated rather than hidden: `snapshot` is null in the returned report, so a caller
       * can tell that this run was not recorded.
       */
      return null;
    }
  }

  private async loadSnapshot(id: string): Promise<IntegritySnapshotView | null> {
    const rows: Array<{
      id: string;
      observed_at: Date | string;
      status: string;
      duration_ms: number;
    }> = await this.dataSource.query(
      `SELECT id, observed_at, status, duration_ms FROM integrity_snapshots WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      observedAt: (row.observed_at instanceof Date
        ? row.observed_at
        : new Date(row.observed_at)
      ).toISOString(),
      status: row.status as VerificationStatus,
      durationMs: row.duration_ms,
    };
  }

  /**
   * When each check last passed.
   *
   * The question this answers is "how long has this been broken?" — which is the first thing asked in a
   * review, and which a stateless report cannot answer at all.
   */
  async lastPasses(): Promise<LastPassView[]> {
    const rows: Array<{
      check_name: string;
      last_passed_at: Date | string | null;
      last_status: string;
      last_observed_at: Date | string;
    }> = await this.dataSource.query(
      `SELECT r.check_name,
              max(s.observed_at) FILTER (WHERE r.status = 'PASS') AS last_passed_at,
              (array_agg(r.status ORDER BY s.observed_at DESC))[1] AS last_status,
              max(s.observed_at) AS last_observed_at
         FROM integrity_check_results r
         JOIN integrity_snapshots s ON s.id = r.snapshot_id
        GROUP BY r.check_name
        ORDER BY r.check_name`,
    );
    return rows.map((row) => ({
      checkName: row.check_name,
      lastPassedAt: toIso(row.last_passed_at),
      lastStatus: row.last_status,
      lastObservedAt: toIso(row.last_observed_at) ?? '',
    }));
  }

  /** Recent snapshots, newest first — the shape a dashboard or an export needs. */
  async history(limit = 50): Promise<IntegritySnapshotView[]> {
    const rows: Array<{
      id: string;
      observed_at: Date | string;
      status: string;
      duration_ms: number;
    }> = await this.dataSource.query(
      `SELECT id, observed_at, status, duration_ms
           FROM integrity_snapshots
          ORDER BY observed_at DESC, id DESC
          LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((row) => ({
      id: row.id,
      observedAt: toIso(row.observed_at) ?? '',
      status: row.status as VerificationStatus,
      durationMs: row.duration_ms,
    }));
  }
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/**
 * Extracts a finding count from a check.
 *
 * `ReconciliationCheck` does not carry a first-class count, so it is derived from the findings array when
 * present. Defaulting to 0 for a FAIL would be misleading — it reads as "failed with no findings" — so a
 * failing check with no enumerable findings reports `1`, meaning "at least one problem, not enumerated".
 */
function findingCountOf(check: ReconciliationCheck): number {
  const record = check as unknown as Record<string, unknown>;
  const findings = record.findings;
  if (Array.isArray(findings)) return findings.length;
  const count = record.findingCount ?? record.count;
  if (typeof count === 'number' && Number.isFinite(count)) return Math.max(0, Math.round(count));
  return check.status === VerificationStatus.PASS ? 0 : 1;
}

/**
 * Converts a stored status string back to the enum.
 *
 * The column has a CHECK constraint allowing only these three values, so an unexpected value means the
 * schema and the code disagree. Treating it as `ERROR` is the safe reading: an uninterpretable integrity
 * verdict must never be silently upgraded to a pass.
 */
function parseStatus(value: string): VerificationStatus {
  // Compared against the enum's underlying string values rather than against the enum members: `value`
  // comes from a database column and is a plain string, so comparing it to an enum member is the
  // "unsafe enum comparison" this rule exists to flag.
  if (value === 'PASS') return VerificationStatus.PASS;
  if (value === 'WARNING') return VerificationStatus.WARNING;
  return VerificationStatus.ERROR;
}

function compare(
  previous: Map<string, { status: VerificationStatus; findingCount: number }>,
  checks: readonly ReconciliationCheck[],
): DriftEntry[] {
  const drift: DriftEntry[] = [];
  for (const check of checks) {
    const prior = previous.get(check.name);
    const findingCount = findingCountOf(check);
    if (!prior) {
      drift.push({
        checkName: check.name,
        previousStatus: null,
        currentStatus: check.status,
        change: 'new',
        findingCount,
      });
      continue;
    }
    if (prior.status === check.status) continue;

    // `ERROR` is the failing verdict in `VerificationStatus`; `WARNING` is degraded but not failing.
    const wasFailing = prior.status === VerificationStatus.ERROR;
    const nowFailing = check.status === VerificationStatus.ERROR;
    let change: DriftEntry['change'];
    if (!wasFailing && nowFailing) change = 'newly-failing';
    else if (wasFailing && !nowFailing) change = 'recovered';
    else if (prior.status === VerificationStatus.PASS) change = 'newly-degraded';
    else change = 'changed';

    drift.push({
      checkName: check.name,
      previousStatus: prior.status,
      currentStatus: check.status,
      change,
      findingCount,
    });
  }
  return drift;
}
