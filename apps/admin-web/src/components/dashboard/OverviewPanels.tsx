import React from 'react';
import { ApiClient } from '../../services/api-client';
import { useWidgetData } from './useWidgetData';
import { isAuditEntries, isReconciliationWidgetData, isTransactionSummary, type ReconciliationWidgetData } from './widget-validation';
import { formatDate, type TransactionSummaryResponse } from './types';

const DASH = '/internal/a2/workforce/dashboard/widgets';

export function TransactionStatus() {
  const { data, loading, error } = useWidgetData<TransactionSummaryResponse>(async () => {
    const value: unknown = await ApiClient.get(`${DASH}/transaction-summary?period=7d`);
    if (!isTransactionSummary(value, '7d', false)) throw new Error('Invalid transaction summary');
    return value as TransactionSummaryResponse;
  }, []);
  const rows = data ? [['Completed', data.totalCompletedCount], ['Pending', data.totalPendingCount], ['Failed', data.totalFailedCount]] as const : [];
  const total = rows.reduce((sum, row) => sum + row[1], 0);
  return <section className="one-overview-card one-status" aria-label="Transaction status"><div className="one-overview-card__head"><div><h2>Transaction status</h2><p>Last 7 days</p></div></div>
    {loading ? <p>Loading…</p> : error ? <p role="alert">Status unavailable</p> : <><div className="one-status__bar" aria-label={`${total} transactions`}>{rows.map(([label, count]) => <span key={label} className={`one-status__segment one-status__segment--${label.toLowerCase()}`} style={{width: total ? `${count / total * 100}%` : '0%'}} />)}</div><div className="one-status__rows">{rows.map(([label, count]) => <div key={label}><span><i className={`one-status__dot one-status__dot--${label.toLowerCase()}`} />{label}</span><strong>{count.toLocaleString()}</strong></div>)}</div>{total === 0 && <p>No transactions in this period.</p>}</>}
  </section>;
}

export function ReconciliationNotice({ onOpen }: { onOpen?: () => void }) {
  const { data, loading, error } = useWidgetData<ReconciliationWidgetData>(async () => {
    const value: unknown = await ApiClient.get(`${DASH}/reconciliation-status`);
    if (!isReconciliationWidgetData(value)) throw new Error('Invalid reconciliation response');
    return value;
  }, []);
  const warning = !!data && (data.report.status !== 'PASS' || !data.trialBalance.balanced || data.report.checks.some(check => check.status !== 'PASS'));
  return <section className={`one-reconciliation-notice${warning || error ? ' one-reconciliation-notice--warning' : ''}`} aria-label="Reconciliation overview">
    <div><strong>{loading ? 'Checking reconciliation…' : error ? 'Reconciliation unavailable' : warning ? 'Reconciliation needs attention' : data?.trialBalance.dimensions.length === 0 ? 'No balance details available' : 'Reconciliation checks passed'}</strong><span>{data ? `Report: ${data.report.status.toLowerCase()} · Trial balance: ${data.trialBalance.balanced ? 'balanced' : 'out of balance'}` : 'Review the reconciliation workspace for details.'}</span></div>
    {onOpen && <button type="button" onClick={onOpen}>Review reconciliation →</button>}
  </section>;
}

interface Activity { id:string; entityType:string; action:string; actor:string; occurredAt:string }
export function RecentActivity({ onOpen }: { onOpen?: () => void }) {
  const { data, loading, error } = useWidgetData<Activity[]>(async () => {
    const value: unknown = await ApiClient.get(`${DASH}/audit-trail`);
    if (!isAuditEntries(value)) throw new Error('Invalid activity response');
    return value as Activity[];
  }, []);
  return <section className="one-overview-card one-activity"><div className="one-overview-card__head"><h2>Recent activity</h2>{onOpen && <button type="button" onClick={onOpen}>View all →</button>}</div>
    {loading ? <p>Loading…</p> : error ? <p role="alert">Activity unavailable</p> : !data?.length ? <p>No recent activity.</p> : <ul>{data.slice(0, 5).map(row => <li key={row.id}><span className="one-activity__dot" aria-hidden="true">✓</span><div><strong>{row.action.replace(/_/g, ' ').toLowerCase()}</strong><small>{formatDate(row.occurredAt)}</small></div></li>)}</ul>}
  </section>;
}
