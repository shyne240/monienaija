import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { AuditService } from '../operations/audit.service';

export type DashboardPeriod = 'today' | '7d' | '30d' | 'custom';

export interface PeriodRange {
  from: Date;
  to: Date;
  period: DashboardPeriod;
}

/** The four V1 transaction types and the authoritative table that backs each. */
const TRANSACTION_TABLES: Array<{
  type: 'W2W' | 'C2W' | 'W2C' | 'C2C';
  table: string;
  completedStatus: string;
  failedStatuses: string[];
  pendingStatuses: string[];
  amountColumn: string;
  feeColumn: string | null;
  /**
   * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 (defect fix): `cash_to_cash_transfers` has no
   * `completed_at` column at all (see migrations 1785753600057/058) — its completion timestamp
   * column is `claimed_at` (set when status transitions to CLAIMED). The V1 version of
   * `recentTransactions()` hardcoded `completed_at` for every table, which fails with
   * "column completed_at does not exist" for the C2C branch of the UNION. Fixed by making the
   * completion-timestamp column configurable per table.
   */
  completedAtColumn: string;
}> = [
  { type: 'W2W', table: 'transfers', completedStatus: 'COMPLETED', failedStatuses: ['FAILED', 'CANCELLED'], pendingStatuses: ['PENDING', 'PROCESSING', 'PENDING_RECOVERY', 'UNKNOWN'], amountColumn: 'amount_minor', feeColumn: 'fee_minor', completedAtColumn: 'completed_at' },
  { type: 'C2W', table: 'deposits', completedStatus: 'COMPLETED', failedStatuses: ['FAILED', 'CANCELLED'], pendingStatuses: ['PENDING'], amountColumn: 'amount_minor', feeColumn: null, completedAtColumn: 'completed_at' },
  { type: 'W2C', table: 'withdrawals', completedStatus: 'COMPLETED', failedStatuses: ['FAILED', 'CANCELLED'], pendingStatuses: ['PENDING', 'PROCESSING'], amountColumn: 'amount_minor', feeColumn: null, completedAtColumn: 'completed_at' },
  { type: 'C2C', table: 'cash_to_cash_transfers', completedStatus: 'CLAIMED', failedStatuses: ['EXPIRED'], pendingStatuses: ['UNCLAIMED'], amountColumn: 'principal_minor', feeColumn: 'fee_minor', completedAtColumn: 'claimed_at' },
];

export function resolvePeriod(period: string | undefined, from: string | undefined, to: string | undefined): PeriodRange {
  const now = new Date();
  if (period === 'custom') {
    if (!from || !to) {
      throw new BadRequestException('period=custom requires both from and to query parameters (ISO dates).');
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('from/to must be valid ISO dates.');
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('from must not be after to.');
    }
    return { from: fromDate, to: toDate, period: 'custom' };
  }
  if (period === '7d') {
    return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now, period: '7d' };
  }
  if (period === '30d') {
    return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now, period: '30d' };
  }
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  return { from: startOfDay, to: now, period: 'today' };
}

export interface Row {
  [key: string]: unknown;
}

/** Percent change from `previous` to `current`. Null (not zero or Infinity) when there is no comparable baseline. */
function percentChange(previous: number | bigint, current: number | bigint): number | null {
  const prev = typeof previous === 'bigint' ? previous : BigInt(Math.trunc(previous));
  if (prev === BigInt(0)) {
    return null;
  }
  const curr = typeof current === 'bigint' ? current : BigInt(Math.trunc(current));
  const diff = curr - prev;
  // Scale by 10_000 (basis points) before dividing so integer/bigint division keeps 2dp precision.
  const scaled = (diff * BigInt(10000)) / prev;
  return Number(scaled) / 100;
}

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01
 *
 * Backs the "proxy" widgets listed in `DASHBOARD_WIDGET_REGISTRY`. Every method here queries the
 * authoritative source tables/services directly (never sums arbitrary pre-aggregated data) and
 * is only ever reached after the caller's `AuthorizationService.requireFunction` check has
 * already passed for that specific widget (enforced in `DashboardController`, independently of
 * which dashboard template is displayed).
 */
@Injectable()
export class DashboardWidgetDataService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reconciliationService: ReconciliationService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 (defect fix): the V1 query always bound 3
   * parameters (`range.from`, `range.to`, `t.completedStatus`) but only ever referenced `$3` in
   * the SQL text when `t.feeColumn` was set, so for any transaction table without a fee column
   * (`deposits`/C2W, `withdrawals`/W2C) Postgres rejected the query outright with
   * "bind message supplies 3 parameters, but prepared statement requires 2" — a deterministic
   * 500 on every call, for every period, for any role (see
   * docs/V1/V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01-REPORT.md §7, Defect #2). Fixed by only
   * ever binding the parameters a given table's query text actually references: the WHERE clause
   * always uses `$1`/`$2`, and `$3` (the completed-status marker used in the conditional fee
   * aggregate) is appended to the parameter array only when the fee clause is actually emitted.
   */
  async transactionSummary(range: PeriodRange, compare = false) {
    const current = await this.computeTransactionSummaryForRange(range);
    if (!compare) {
      return current;
    }

    const durationMs = Math.max(range.to.getTime() - range.from.getTime(), 1);
    const previousRange: PeriodRange = {
      from: new Date(range.from.getTime() - durationMs),
      to: new Date(range.from.getTime()),
      period: range.period,
    };
    const previous = await this.computeTransactionSummaryForRange(previousRange);

    return {
      ...current,
      previousPeriod: {
        from: previous.from,
        to: previous.to,
        totalCompletedCount: previous.totalCompletedCount,
        totalCompletedValueMinor: previous.totalCompletedValueMinor,
        successRatePercent: previous.successRatePercent,
        totalFeeRevenueMinor: previous.totalFeeRevenueMinor,
      },
      comparison: {
        definition:
          'Percent change vs. the immediately preceding period of equal length (e.g. for period=7d, the 7 days before the current 7-day window). Null when the prior period has no comparable baseline (zero).',
        completedCountChangePercent: percentChange(previous.totalCompletedCount, current.totalCompletedCount),
        completedValueChangePercent: percentChange(BigInt(previous.totalCompletedValueMinor), BigInt(current.totalCompletedValueMinor)),
      },
    };
  }

  private async computeTransactionSummaryForRange(range: PeriodRange) {
    const byType = await Promise.all(
      TRANSACTION_TABLES.map(async (t) => {
        const parameters: unknown[] = [range.from.toISOString(), range.to.toISOString()];
        let feeSelect = '';
        if (t.feeColumn) {
          parameters.push(t.completedStatus);
          feeSelect = `, COALESCE(SUM(CASE WHEN status = $${parameters.length} THEN ${t.feeColumn} ELSE 0 END), 0)::text AS fee_minor`;
        }
        const rows = await this.rows(
          `SELECT status, COUNT(*)::text AS count,
                  COALESCE(SUM(${t.amountColumn}), 0)::text AS value_minor
                  ${feeSelect}
             FROM ${t.table}
            WHERE created_at >= $1 AND created_at <= $2
            GROUP BY status`,
          parameters,
        );
        const completed = rows.find((r) => r.status === t.completedStatus);
        const failedCount = rows
          .filter((r) => t.failedStatuses.includes(String(r.status)))
          .reduce((sum, r) => sum + Number(r.count ?? 0), 0);
        const pendingCount = rows
          .filter((r) => t.pendingStatuses.includes(String(r.status)))
          .reduce((sum, r) => sum + Number(r.count ?? 0), 0);
        return {
          type: t.type,
          completedCount: Number(completed?.count ?? 0),
          completedValueMinor: String(completed?.value_minor ?? '0'),
          failedCount,
          pendingCount,
          feeRevenueMinor: t.feeColumn ? String(completed?.fee_minor ?? '0') : null,
        };
      }),
    );

    const totalCompleted = byType.reduce((s, t) => s + t.completedCount, 0);
    const totalFailed = byType.reduce((s, t) => s + t.failedCount, 0);
    const totalPending = byType.reduce((s, t) => s + t.pendingCount, 0);
    const totalValueMinor = byType.reduce((s, t) => s + BigInt(t.completedValueMinor), BigInt(0)).toString();
    const totalFeeRevenueMinor = byType
      .filter((t) => t.feeRevenueMinor !== null)
      .reduce((s, t) => s + BigInt(t.feeRevenueMinor as string), BigInt(0))
      .toString();
    const denom = totalCompleted + totalFailed;
    const successRatePercent = denom > 0 ? Math.round((totalCompleted / denom) * 10000) / 100 : null;

    return {
      period: range.period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      currency: 'NGN',
      totalCompletedCount: totalCompleted,
      totalCompletedValueMinor: totalValueMinor,
      totalFailedCount: totalFailed,
      totalPendingCount: totalPending,
      successRatePercent,
      totalFeeRevenueMinor,
      feeRevenueNote:
        'Fee revenue is computed only from transfers and cash-to-cash transfers (the only two transaction types carrying a fee_minor column). Deposits and withdrawals carry no fee column in V1 and are not included.',
      byType,
      // Commission figures require a verified accounting definition/source distinct from the
      // transaction fee_minor columns above; no such source was verified for this task, so
      // commission is intentionally omitted rather than invented (see implementation report §4).
      commission: null,
      commissionNote: 'No verified commission accounting source exists for this metric in V1 — intentionally omitted rather than estimated.',
    };
  }

  /**
   * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02: daily completed-transaction count/value trend
   * across all four V1 transaction types, zero-filled for days with no activity, computed
   * entirely from the same authoritative tables `transactionSummary` uses (never a derived or
   * cached figure). Capped at 92 days to keep the `generate_series` + aggregate query bounded and
   * fast regardless of caller-supplied date range.
   */
  async transactionTrend(range: PeriodRange) {
    const maxRangeMs = 92 * 24 * 60 * 60 * 1000;
    if (range.to.getTime() - range.from.getTime() > maxRangeMs) {
      throw new BadRequestException('Transaction trend supports a maximum 92-day window.');
    }

    const unionSelects = TRANSACTION_TABLES.map(
      (t) =>
        `SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS cnt, COALESCE(SUM(${t.amountColumn}), 0) AS val
           FROM ${t.table}
          WHERE created_at >= $1 AND created_at <= $2 AND status = '${t.completedStatus}'
          GROUP BY 1`,
    ).join('\n          UNION ALL\n');

    const rows = await this.rows(
      `WITH days AS (
         SELECT generate_series(date_trunc('day', $1::timestamptz), date_trunc('day', $2::timestamptz), interval '1 day')::date AS day
       ),
       agg AS (
          ${unionSelects}
       )
       SELECT days.day::text AS day, COALESCE(SUM(agg.cnt), 0)::text AS count, COALESCE(SUM(agg.val), 0)::text AS value_minor
         FROM days LEFT JOIN agg ON agg.day = days.day
        GROUP BY days.day
        ORDER BY days.day`,
      [range.from.toISOString(), range.to.toISOString()],
    );

    return {
      period: range.period,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      currency: 'NGN',
      definition:
        'Completed-transaction count and value, summed across all four V1 transaction types (W2W/C2W/W2C/C2C), grouped by calendar day (UTC). Days with no completed transactions appear as zero rather than being omitted.',
      daily: rows.map((r) => ({
        date: String(r.day),
        completedCount: Number(r.count ?? 0),
        completedValueMinor: String(r.value_minor ?? '0'),
      })),
    };
  }

  /**
   * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 (defect fix): each per-table branch below embeds
   * its own `ORDER BY ... LIMIT ...` so the UNION ALL only ever has to merge and re-sort at most
   * `safeLimit` rows per table rather than entire tables, but Postgres only allows `ORDER BY`/
   * `LIMIT` inside an individual branch of a `UNION ALL` when that branch is parenthesised —
   * without the parentheses (the V1 version of this query) Postgres raises
   * "syntax error at or near UNION" on every single call, unconditionally breaking the
   * `recent-transactions` widget for every role whose template includes it (SUPER_ADMIN,
   * FINANCE_AUDITOR, OPERATIONS). Found and fixed during
   * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 verification — see
   * docs/V1/V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01-REPORT.md §7 (Defect #3).
   */
  async recentTransactions(limit = 20) {
    const safeLimit = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.trunc(limit))) : 20;
    const queries = TRANSACTION_TABLES.map((t) => {
      const feeSelect = t.feeColumn ? t.feeColumn : 'NULL';
      return `(SELECT '${t.type}' AS type, id::text AS id, ${t.amountColumn} AS amount_minor, ${feeSelect} AS fee_minor, currency, status, created_at, ${t.completedAtColumn} AS completed_at
                 FROM ${t.table}
                ORDER BY created_at DESC
                LIMIT ${safeLimit})`;
    });
    const rows = await this.rows(`${queries.join(' UNION ALL ')} ORDER BY created_at DESC LIMIT ${safeLimit}`);
    return rows.map((r) => ({
      type: r.type,
      reference: r.id,
      amountMinor: String(r.amount_minor ?? '0'),
      feeMinor: r.fee_minor !== null ? String(r.fee_minor) : null,
      currency: r.currency,
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at ?? null,
    }));
  }

  async ledgerSummary() {
    return this.rows(`
      SELECT j.currency AS currency, j.accounting_unit AS accounting_unit,
             COUNT(DISTINCT j.id)::text AS journal_count,
             COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount_minor ELSE 0 END), 0)::text AS debits_minor,
             COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount_minor ELSE 0 END), 0)::text AS credits_minor
        FROM ledger_journals j
        LEFT JOIN ledger_lines l ON l.journal_id = j.id
       GROUP BY j.currency, j.accounting_unit
       ORDER BY j.currency, j.accounting_unit
    `);
  }

  async reconciliationStatus() {
    const [report, trialBalance] = await Promise.all([
      this.reconciliationService.runReconciliation(),
      this.reconciliationService.getTrialBalance(),
    ]);
    return { report, trialBalance };
  }

  async auditTrail(limit = 20) {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const result = await this.auditService.list({ limit: safeLimit });
    return result;
  }

  async workforceOverview() {
    const [headcount, byRole, activeSessions] = await Promise.all([
      this.rows(`SELECT COUNT(DISTINCT principal_id)::text AS count FROM a2_finance_role_assignments WHERE status = 'ACTIVE' AND effective_to > NOW()`),
      this.rows(`SELECT role_key, COUNT(*)::text AS count FROM a2_finance_role_assignments WHERE status = 'ACTIVE' AND effective_to > NOW() GROUP BY role_key ORDER BY role_key`),
      this.rows(`SELECT COUNT(*)::text AS count FROM a2_workforce_sessions WHERE status = 'ACTIVE' AND expires_at > NOW()`),
    ]);
    return {
      activeWorkforceHeadcount: Number(headcount[0]?.count ?? 0),
      roleDistribution: byRole.map((r) => ({ roleKey: r.role_key, count: Number(r.count ?? 0) })),
      activeSessionCount: Number(activeSessions[0]?.count ?? 0),
    };
  }

  async agentLifecycleSummary() {
    const [byStatus, pendingApplications] = await Promise.all([
      this.rows(`SELECT status, COUNT(*)::text AS count FROM agents WHERE deleted_at IS NULL GROUP BY status ORDER BY status`),
      this.rows(`SELECT COUNT(*)::text AS count FROM agent_applications WHERE status IN ('SUBMITTED', 'UNDER_REVIEW') AND deleted_at IS NULL`),
    ]);
    return {
      byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count ?? 0) })),
      pendingApplicationCount: Number(pendingApplications[0]?.count ?? 0),
    };
  }

  async kycQueueSummary() {
    const rows = await this.rows(`
      SELECT kyc_status, COUNT(*)::text AS count
        FROM customer_kyc_assessments
       WHERE is_current = TRUE
       GROUP BY kyc_status
       ORDER BY kyc_status
    `);
    return { byStatus: rows.map((r) => ({ status: r.kyc_status, count: Number(r.count ?? 0) })) };
  }

  async complianceCaseSummary() {
    const rows = await this.rows(`
      SELECT category, status, COUNT(*)::text AS count
        FROM customer_compliance_cases
       WHERE category <> 'FRAUD' AND deleted_at IS NULL
       GROUP BY category, status
       ORDER BY category, status
    `);
    return {
      byCategoryStatus: rows.map((r) => ({ category: r.category, status: r.status, count: Number(r.count ?? 0) })),
    };
  }

  async fraudCaseSummary() {
    const rows = await this.rows(`
      SELECT status, COUNT(*)::text AS count
        FROM customer_compliance_cases
       WHERE category = 'FRAUD' AND deleted_at IS NULL
       GROUP BY status
       ORDER BY status
    `);
    return { byStatus: rows.map((r) => ({ status: r.status, count: Number(r.count ?? 0) })) };
  }

  private async rows(sql: string, parameters: unknown[] = []): Promise<Row[]> {
    const result: unknown = await this.dataSource.query(sql, parameters);
    return Array.isArray(result) ? result.filter((v) => typeof v === 'object' && v !== null) : [];
  }
}
