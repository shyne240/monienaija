import React from 'react';
import { ApiClient } from '../../services/api-client';
import { useWidgetData } from './useWidgetData';
import { isTransactionSummary } from './widget-validation';
import { formatMinor, type TransactionSummaryResponse } from './types';

/** Only mounted when the server's resolved dashboard authorizes the transaction summary. */
export const OneSummaryCards: React.FC = () => {
  const { data, loading, error } = useWidgetData<TransactionSummaryResponse>(async () => {
    const result: unknown = await ApiClient.get('/internal/a2/workforce/dashboard/widgets/transaction-summary?period=7d');
    if (!isTransactionSummary(result, '7d', false)) throw new Error('Transaction summary unavailable');
    return result as TransactionSummaryResponse;
  }, []);
  const cards = [
    { label: 'Completed transaction value', value: data ? `${formatMinor(data.totalCompletedValueMinor, data.currency)} total` : '—', icon: '◫' },
    { label: 'Completed transactions', value: data ? `${data.totalCompletedCount.toLocaleString()} completed` : '—', icon: '⇄' },
    { label: 'Success rate', value: data && data.successRatePercent !== null ? `${data.successRatePercent}% success` : '—', icon: '◇' },
    { label: 'Pending transactions', value: data ? `${data.totalPendingCount.toLocaleString()} pending` : '—', icon: '◷' },
  ];
  return <section className="one-kpis" aria-label="Transaction summary for the last 7 days">
    {cards.map(card => <article className="one-kpi" key={card.label}><div className="one-kpi__label"><span aria-hidden="true">{card.icon}</span>{card.label}</div><strong>{loading ? 'Loading…' : error ? 'Unavailable' : card.value}</strong><small>{error ? 'Could not load summary' : 'Last 7 days'}</small></article>)}
  </section>;
};
