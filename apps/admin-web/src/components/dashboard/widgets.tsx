import React, { useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { colors } from './tokens';
import { WidgetCard } from './WidgetCard';
import { KpiTile } from './KpiTile';
import { PeriodControls } from './PeriodControls';
import { useWidgetData } from './useWidgetData';
import {
  formatMinor,
  formatPercent,
  formatDate,
  type DashboardPeriod,
  type ResolvedWidget,
  type TransactionSummaryResponse,
  type TransactionTrendResponse,
  type RecentTransactionRow,
} from './types';

const DASH = '/internal/a2/workforce/dashboard';

function buildQuery(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function deltaTone(value: number | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (value === null || value === undefined || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = status.toUpperCase();
  let bg = '#F1F5F9';
  let fg = colors.textMuted;
  if (['COMPLETED', 'CLAIMED', 'ACTIVE', 'PASS', 'RESOLVED', 'APPROVED'].includes(s)) {
    bg = colors.successBg;
    fg = colors.success;
  } else if (['FAILED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'ERROR'].includes(s)) {
    bg = colors.dangerBg;
    fg = colors.danger;
  } else if (['PENDING', 'PROCESSING', 'UNCLAIMED', 'WARNING', 'UNDER_REVIEW', 'SUBMITTED'].includes(s)) {
    bg = colors.warningBg;
    fg = colors.warning;
  }
  return <span style={{ ...styles.badge, backgroundColor: bg, color: fg }}>{status}</span>;
};

/**
 * 4A. KPI cards + transaction breakdowns: the real Transaction Summary widget, backed by
 * `GET /internal/a2/workforce/dashboard/widgets/transaction-summary` (fixed in
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 — see Defect #2). Count (volume), value, fee
 * revenue and success rate are each labelled and defined explicitly; no "profit" figure is shown
 * anywhere — the backend does not compute or expose one (see `feeRevenueNote`/`commissionNote`).
 */
export const TransactionSummaryWidget: React.FC = () => {
  const [period, setPeriod] = useState<DashboardPeriod>('7d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [compare, setCompare] = useState(false);

  const { data, loading, error } = useWidgetData<TransactionSummaryResponse>(
    () =>
      ApiClient.get(
        `${DASH}/widgets/transaction-summary${buildQuery({
          period,
          from: period === 'custom' ? from : undefined,
          to: period === 'custom' ? to : undefined,
          compare: compare ? 'true' : undefined,
        })}`,
      ),
    [period, from, to, compare],
  );

  return (
    <WidgetCard
      title="Transaction Summary"
      description="Completed-transaction volume (count), value, success rate and fee revenue for the selected period, broken down by transaction type (W2W/C2W/W2C/C2C)."
      loading={loading}
      error={error}
      actions={
        <PeriodControls
          period={period}
          from={from}
          to={to}
          compare={compare}
          showCompare
          onPeriodChange={setPeriod}
          onFromChange={setFrom}
          onToChange={setTo}
          onCompareChange={setCompare}
        />
      }
    >
      {data && (
        <>
          <div style={styles.kpiRow}>
            <KpiTile
              label="Completed (volume / count)"
              value={String(data.totalCompletedCount)}
              deltaLabel={data.comparison ? `${formatPercent(data.comparison.completedCountChangePercent)} vs prior period` : undefined}
              deltaTone={deltaTone(data.comparison?.completedCountChangePercent)}
            />
            <KpiTile
              label="Completed Value"
              value={formatMinor(data.totalCompletedValueMinor, data.currency)}
              deltaLabel={data.comparison ? `${formatPercent(data.comparison.completedValueChangePercent)} vs prior period` : undefined}
              deltaTone={deltaTone(data.comparison?.completedValueChangePercent)}
            />
            <KpiTile label="Success Rate" value={data.successRatePercent === null ? '—' : `${data.successRatePercent}%`} caption="Completed ÷ (Completed + Failed)" />
            <KpiTile label="Fee Revenue (not profit)" value={formatMinor(data.totalFeeRevenueMinor, data.currency)} caption={data.feeRevenueNote} title={data.feeRevenueNote} />
            <KpiTile label="Failed" value={String(data.totalFailedCount)} />
            <KpiTile label="Pending" value={String(data.totalPendingCount)} />
          </div>
          <p style={styles.note}>
            <strong>Definitions:</strong> &ldquo;Volume&rdquo; is a transaction count, not a currency amount. &ldquo;Fee Revenue&rdquo; is
            recognized transaction fees only, not profit — no profit/margin figure is computed anywhere in this dashboard because no
            verified cost-accounting source exists in V1 ({data.commissionNote})
          </p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Completed</th>
                <th style={styles.th}>Value</th>
                <th style={styles.th}>Failed</th>
                <th style={styles.th}>Pending</th>
                <th style={styles.th}>Fee Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.byType.map((t) => (
                <tr key={t.type}>
                  <td style={styles.td}>{t.type}</td>
                  <td style={styles.td}>{t.completedCount}</td>
                  <td style={styles.td}>{formatMinor(t.completedValueMinor, data.currency)}</td>
                  <td style={styles.td}>{t.failedCount}</td>
                  <td style={styles.td}>{t.pendingCount}</td>
                  <td style={styles.td}>{t.feeRevenueMinor === null ? 'N/A (no fee column)' : formatMinor(t.feeRevenueMinor, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.comparison && <p style={styles.note}>{data.comparison.definition}</p>}
        </>
      )}
    </WidgetCard>
  );
};

/** 5. Historical trend: daily completed-transaction count/value, rendered as a lightweight inline SVG bar chart (no new chart-library dependency). */
export const TransactionTrendWidget: React.FC = () => {
  const [period, setPeriod] = useState<DashboardPeriod>('30d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, loading, error } = useWidgetData<TransactionTrendResponse>(
    () =>
      ApiClient.get(
        `${DASH}/widgets/transaction-trend${buildQuery({
          period,
          from: period === 'custom' ? from : undefined,
          to: period === 'custom' ? to : undefined,
        })}`,
      ),
    [period, from, to],
  );

  const daily = data?.daily ?? [];
  const maxCount = Math.max(1, ...daily.map((d) => d.completedCount));
  const barWidth = 22;

  return (
    <WidgetCard
      title="Transaction Volume Trend"
      description={data?.definition || 'Daily completed-transaction count, zero-filled for days with no activity (max 92-day window).'}
      loading={loading}
      error={error}
      empty={!!data && daily.length === 0}
      actions={<PeriodControls period={period} from={from} to={to} onPeriodChange={setPeriod} onFromChange={setFrom} onToChange={setTo} />}
    >
      {daily.length > 0 && (
        <div style={styles.chartWrap}>
          <svg width="100%" height={140} viewBox={`0 0 ${Math.max(daily.length * barWidth, 100)} 140`} preserveAspectRatio="none" role="img" aria-label="Daily transaction volume trend">
            {daily.map((d, i) => {
              const barHeight = Math.round((d.completedCount / maxCount) * 100);
              return (
                <g key={d.date}>
                  <rect x={i * barWidth + 2} y={118 - barHeight} width={barWidth - 6} height={Math.max(barHeight, 1)} fill={colors.brandGreen} rx={2}>
                    <title>{`${d.date}: ${d.completedCount} completed, ${formatMinor(d.completedValueMinor, data?.currency)}`}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
          <div style={styles.chartAxis}>
            <span>{daily[0]?.date}</span>
            <span>{daily[daily.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </WidgetCard>
  );
};

/** 4A. Recent transaction activity (Defects #3/#4 fixed: UNION ALL syntax + wrong completed-at column for cash-to-cash). */
export const RecentTransactionsWidget: React.FC = () => {
  const { data, loading, error } = useWidgetData<RecentTransactionRow[]>(() => ApiClient.get(`${DASH}/widgets/recent-transactions`), []);
  const rows = data ?? [];

  return (
    <WidgetCard
      title="Recent Transactions"
      description="The most recent completed/failed/pending transactions across all four V1 types (no customer PII)."
      loading={loading}
      error={error}
      empty={!!data && rows.length === 0}
    >
      {rows.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Reference</th>
              <th style={styles.th}>Amount</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reference}>
                <td style={styles.td}>{r.type}</td>
                <td style={styles.td}>
                  <code style={styles.code}>{r.reference.slice(0, 8)}…</code>
                </td>
                <td style={styles.td}>{formatMinor(r.amountMinor, r.currency)}</td>
                <td style={styles.td}>
                  <StatusBadge status={r.status} />
                </td>
                <td style={styles.td}>{formatDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </WidgetCard>
  );
};

interface LedgerSummaryRow {
  currency: string;
  accounting_unit: string;
  journal_count: string;
  debits_minor: string;
  credits_minor: string;
}

export const LedgerSummaryWidget: React.FC = () => {
  const { data, loading, error } = useWidgetData<LedgerSummaryRow[]>(() => ApiClient.get(`${DASH}/widgets/ledger-summary`), []);
  const rows = data ?? [];
  return (
    <WidgetCard title="Ledger Summary" description="Ledger debit/credit totals by currency and accounting unit, sourced directly from ledger_journals/ledger_lines." loading={loading} error={error} empty={!!data && rows.length === 0}>
      {rows.length > 0 && (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Currency</th>
              <th style={styles.th}>Accounting Unit</th>
              <th style={styles.th}>Journals</th>
              <th style={styles.th}>Debits</th>
              <th style={styles.th}>Credits</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.currency}-${r.accounting_unit}`}>
                <td style={styles.td}>{r.currency}</td>
                <td style={styles.td}>{r.accounting_unit}</td>
                <td style={styles.td}>{r.journal_count}</td>
                <td style={styles.td}>{formatMinor(r.debits_minor, r.currency)}</td>
                <td style={styles.td}>{formatMinor(r.credits_minor, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </WidgetCard>
  );
};

interface ReconciliationStatusResponse {
  report: { status: string; generatedAt: string; checks: Array<{ name: string; status: string; message: string }> };
  trialBalance: { balanced: boolean; dimensions: Array<{ currency: string; accountingUnit: string; balanced: boolean }> };
}

export const ReconciliationStatusWidget: React.FC = () => {
  const { data, loading, error } = useWidgetData<ReconciliationStatusResponse>(() => ApiClient.get(`${DASH}/widgets/reconciliation-status`), []);
  return (
    <WidgetCard title="Reconciliation Status" description="The latest independent reconciliation run and trial balance." loading={loading} error={error}>
      {data && (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Run Status" value={data.report?.status ?? '—'} />
            <KpiTile label="Trial Balance" value={data.trialBalance?.balanced ? 'Balanced' : 'Out of balance'} deltaTone={data.trialBalance?.balanced ? 'positive' : 'negative'} />
          </div>
          {Array.isArray(data.report?.checks) && data.report.checks.length > 0 && (
            <ul style={styles.list}>
              {data.report.checks.map((c) => (
                <li key={c.name} style={styles.listItem}>
                  <StatusBadge status={c.status} /> <span style={{ marginLeft: 6 }}>{c.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </WidgetCard>
  );
};

interface WorkforceOverviewResponse {
  activeWorkforceHeadcount: number;
  roleDistribution: Array<{ roleKey: string; count: number }>;
  activeSessionCount: number;
}

export const WorkforceOverviewWidget: React.FC = () => {
  const { data, loading, error } = useWidgetData<WorkforceOverviewResponse>(() => ApiClient.get(`${DASH}/widgets/workforce-overview`), []);
  return (
    <WidgetCard title="Workforce Overview" description="Active workforce headcount, role distribution and currently active sessions." loading={loading} error={error}>
      {data && (
        <>
          <div style={styles.kpiRow}>
            <KpiTile label="Active Headcount" value={String(data.activeWorkforceHeadcount)} />
            <KpiTile label="Active Sessions" value={String(data.activeSessionCount)} />
          </div>
          {data.roleDistribution?.length > 0 && (
            <ul style={styles.list}>
              {data.roleDistribution.map((r) => (
                <li key={r.roleKey} style={styles.listItem}>
                  {r.roleKey}: <strong>{r.count}</strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </WidgetCard>
  );
};

/** Generic count-by-status renderer shared by agent-lifecycle-summary / kyc-queue-summary / compliance-case-summary / fraud-case-summary. */
export const StatusCountWidget: React.FC<{ widgetKey: string; title: string; description: string }> = ({ widgetKey, title, description }) => {
  const { data, loading, error } = useWidgetData<any>(() => ApiClient.get(`${DASH}/widgets/${widgetKey}`), [widgetKey]);

  const rows: Array<{ label: string; count: number }> = [];
  let pendingApplicationCount: number | undefined;
  if (data) {
    if (Array.isArray(data.byStatus)) {
      for (const r of data.byStatus) rows.push({ label: String(r.status), count: Number(r.count ?? 0) });
    }
    if (Array.isArray(data.byCategoryStatus)) {
      for (const r of data.byCategoryStatus) rows.push({ label: `${r.category} / ${r.status}`, count: Number(r.count ?? 0) });
    }
    if (typeof data.pendingApplicationCount === 'number') {
      pendingApplicationCount = data.pendingApplicationCount;
    }
  }

  return (
    <WidgetCard title={title} description={description} loading={loading} error={error} empty={!!data && rows.length === 0 && pendingApplicationCount === undefined}>
      {data && (
        <>
          {pendingApplicationCount !== undefined && (
            <div style={styles.kpiRow}>
              <KpiTile label="Pending Applications" value={String(pendingApplicationCount)} />
            </div>
          )}
          {rows.length > 0 && (
            <ul style={styles.list}>
              {rows.map((r) => (
                <li key={r.label} style={styles.listItem}>
                  {r.label}: <strong>{r.count}</strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </WidgetCard>
  );
};

/**
 * Generic renderer for the 'direct'-fetchMode widgets that call a pre-existing, independently
 * owned endpoint (system-health → /internal/metrics, role-governance-queue, agent applications
 * queue, support ticket queue). Deliberately defensive about shape (array → table of the first
 * few primitive columns; flat-ish object → KPI tiles) rather than hardcoding each endpoint's
 * exact contract, since these endpoints are owned by other, independently-evolving modules.
 */
export const GenericDirectWidget: React.FC<{ title: string; description: string; endpoint: string }> = ({ title, description, endpoint }) => {
  const { data, loading, error } = useWidgetData<any>(() => ApiClient.get(endpoint), [endpoint]);

  let body: React.ReactNode = null;
  let isEmpty = false;

  if (data !== undefined && data !== null) {
    if (Array.isArray(data)) {
      if (data.length === 0) {
        isEmpty = true;
      } else {
        const first = data[0] && typeof data[0] === 'object' ? data[0] : {};
        const keys = Object.keys(first)
          .filter((k) => typeof first[k] !== 'object' || first[k] === null)
          .slice(0, 5);
        body = (
          <table style={styles.table}>
            <thead>
              <tr>
                {keys.map((k) => (
                  <th key={k} style={styles.th}>
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((row: any, i: number) => (
                <tr key={row?.id ?? i}>
                  {keys.map((k) => (
                    <td key={k} style={styles.td}>
                      {row?.[k] === null || row?.[k] === undefined ? '—' : String(row[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
    } else if (typeof data === 'object') {
      const metricsLike = data.metrics && typeof data.metrics === 'object' ? data.metrics : data;
      const entries = Object.entries(metricsLike).filter(([, v]) => typeof v !== 'object' || v === null);
      if (entries.length === 0) {
        isEmpty = true;
      } else {
        body = (
          <div style={styles.kpiRow}>
            {entries.slice(0, 8).map(([k, v]) => (
              <KpiTile key={k} label={k} value={v === null || v === undefined ? '—' : String(v)} />
            ))}
          </div>
        );
      }
    } else {
      isEmpty = true;
    }
  }

  return (
    <WidgetCard title={title} description={description} loading={loading} error={error} empty={isEmpty}>
      {body}
    </WidgetCard>
  );
};

export const DirectoryLinkWidget: React.FC<{ title: string; description: string; onNavigate?: () => void }> = ({ title, description, onNavigate }) => (
  <div style={styles.linkCard}>
    <div>
      <h3 style={styles.title}>{title}</h3>
      <p style={styles.description}>{description}</p>
    </div>
    <button style={styles.linkButton} onClick={onNavigate}>
      Open →
    </button>
  </div>
);

/**
 * Dispatches a resolved `my-dashboard` widget entry to its rendering component. A widget the
 * backend already marked `authorized: false` is shown as a restricted tile WITHOUT any data
 * fetch being attempted — this mirrors the backend's own defense-in-depth re-check per widget and
 * ensures a tampered/stale client-side widget list can never even attempt an unauthorized call.
 */
export const WidgetRenderer: React.FC<{ widget: ResolvedWidget; onNavigateToCustomers?: () => void }> = ({ widget, onNavigateToCustomers }) => {
  if (!widget.authorized) {
    return <WidgetCard title={widget.title || widget.displayName} description={widget.description} restricted />;
  }

  switch (widget.widgetKey) {
    case 'transaction-summary':
      return <TransactionSummaryWidget />;
    case 'transaction-trend':
      return <TransactionTrendWidget />;
    case 'recent-transactions':
      return <RecentTransactionsWidget />;
    case 'ledger-summary':
      return <LedgerSummaryWidget />;
    case 'reconciliation-status':
      return <ReconciliationStatusWidget />;
    case 'workforce-overview':
      return <WorkforceOverviewWidget />;
    case 'agent-lifecycle-summary':
    case 'kyc-queue-summary':
    case 'compliance-case-summary':
    case 'fraud-case-summary':
      return <StatusCountWidget widgetKey={widget.widgetKey} title={widget.title || widget.displayName} description={widget.description} />;
    case 'customer-directory-shortcut':
      return <DirectoryLinkWidget title={widget.title || widget.displayName} description={widget.description} onNavigate={onNavigateToCustomers} />;
    default:
      if (widget.fetchMode === 'direct' && widget.endpoint) {
        return <GenericDirectWidget title={widget.title || widget.displayName} description={widget.description} endpoint={widget.endpoint} />;
      }
      return <WidgetCard title={widget.title || widget.displayName} description={widget.description} error="This widget is not yet supported in Admin Web." />;
  }
};

const styles: Record<string, React.CSSProperties> = {
  kpiRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  note: {
    fontSize: 11,
    color: colors.textFaint,
    margin: 0,
    lineHeight: 1.5,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: `2px solid ${colors.border}`,
    color: colors.textMuted,
    fontWeight: 600,
    textTransform: 'uppercase',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  td: {
    padding: '6px 8px',
    borderBottom: `1px solid ${colors.borderLight}`,
    color: colors.textPrimary,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.textMuted,
  },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 10,
    textTransform: 'uppercase',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 12,
    color: colors.textSecondary,
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
  },
  chartWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  chartAxis: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    color: colors.textFaint,
  },
  linkCard: {
    backgroundColor: colors.cardBg,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    padding: 20,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary,
    margin: 0,
  },
  description: {
    fontSize: 12,
    color: colors.textMuted,
    margin: '4px 0 0 0',
  },
  linkButton: {
    backgroundColor: colors.brandGreen,
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 6,
    padding: '10px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
