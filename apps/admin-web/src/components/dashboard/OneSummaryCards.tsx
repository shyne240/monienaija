import React from 'react';
import { ApiClient } from '../../services/api-client';
import { useWidgetData } from './useWidgetData';
import { isStatusCountData, isTransactionSummary } from './widget-validation';
import { formatMinor, type TransactionSummaryResponse } from './types';

function Card({ label, icon, value, caption }: { label:string; icon:string; value:string; caption:string }) {
  return <article className="one-kpi"><div className="one-kpi__label"><span aria-hidden="true">{icon}</span>{label}</div><strong>{value}</strong><small>{caption}</small></article>;
}
function AgentCard() {
  const {data,loading,error} = useWidgetData<number>(async () => {
    const value: unknown = await ApiClient.get('/internal/a2/workforce/dashboard/widgets/agent-lifecycle-summary');
    if (!isStatusCountData(value, 'agent-lifecycle-summary') || !value.byStatus || new Set(value.byStatus.map(row => row.status)).size !== value.byStatus.length) throw new Error('Invalid agent summary');
    return value.byStatus.find(row => row.status === 'ACTIVE')?.count ?? 0;
  }, []);
  return <Card label="Active agents" icon="♙" value={loading ? 'Loading…' : error ? 'Unavailable' : data === undefined ? '—' : `${data.toLocaleString()} active ${data === 1 ? 'agent' : 'agents'}`} caption="Current lifecycle status" />;
}
function CustomerCard() {
  const {data,loading,error} = useWidgetData<number>(async () => {
    const value: any = await ApiClient.get('/internal/customers?page=1&limit=1');
    if (!value || !Array.isArray(value.data) || value.page !== 1 || value.limit !== 1 || !Number.isSafeInteger(value.total) || value.total < 0 || value.data.length > Math.min(1, value.total) || value.totalPages !== Math.ceil(value.total) || value.hasPreviousPage !== false || value.hasNextPage !== (value.total > 1)) throw new Error('Invalid customer count');
    return value.total;
  }, []);
  return <Card label="Total customers" icon="♙" value={loading ? 'Loading…' : error ? 'Unavailable' : data === undefined ? '—' : `${data.toLocaleString()} ${data === 1 ? 'customer' : 'customers'}`} caption="Customer directory total" />;
}
/** Only mounted when the server's resolved dashboard authorizes the transaction summary. */
export const OneSummaryCards: React.FC<{canAgents?:boolean; canCustomers?:boolean; agentNotConfigured?:boolean}> = ({canAgents=false,canCustomers=false,agentNotConfigured=false}) => {
  const { data, loading, error } = useWidgetData<TransactionSummaryResponse>(async () => {
    const result: unknown = await ApiClient.get('/internal/a2/workforce/dashboard/widgets/transaction-summary?period=7d');
    if (!isTransactionSummary(result, '7d', false)) throw new Error('Transaction summary unavailable');
    return result as TransactionSummaryResponse;
  }, []);
  return <section className="one-kpis" aria-label="Transaction summary for the last 7 days">
    <Card label="Completed transaction value" icon="◫" value={loading ? 'Loading…' : error ? 'Unavailable' : data ? `${formatMinor(data.totalCompletedValueMinor, data.currency)} total` : '—'} caption="Last 7 days" />
    <Card label="Completed transactions" icon="⇄" value={loading ? 'Loading…' : error ? 'Unavailable' : data ? `${data.totalCompletedCount.toLocaleString()} completed` : '—'} caption="Last 7 days" />
    {canAgents ? <AgentCard/> : <Card label="Active agents" icon="♙" value={agentNotConfigured ? 'Not configured' : 'Restricted'} caption={agentNotConfigured ? 'Not in this dashboard' : 'Permission required'}/>}
    {canCustomers ? <CustomerCard/> : <Card label="Total customers" icon="♙" value="Restricted" caption="Permission required"/>}
  </section>;
};
