import React, { useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { useWidgetData } from '../../components/dashboard/useWidgetData';
import { ActionItems } from '../../components/dashboard/ActionItems';
import { canAccessAdminView, type AdminView } from './navigation-access';
import { OneSummaryCards } from '../../components/dashboard/OneSummaryCards';
import { TransactionTrendWidget, RecentTransactionsWidget } from '../../components/dashboard/widgets';
import { TransactionStatus, ReconciliationNotice, RecentActivity } from '../../components/dashboard/OverviewPanels';
import './operational-surfaces.css';
import './dashboard-workspace.css';
import './one-dashboard.css';
import type { ResolvedDashboard } from '../../components/dashboard/types';

const DASH = '/internal/a2/workforce/dashboard';

interface DashboardScreenProps {
  onNavigateToCustomers?: () => void;
  onNavigateToAgents?: (options?: { openApplications?: boolean }) => void;
  onNavigate?: (view: AdminView) => void;
}

/** Resolve dashboard authorization from the server before requesting overview data. */
function validDashboard(value: unknown): value is ResolvedDashboard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const dashboard = value as ResolvedDashboard;
  return typeof dashboard.templateKey === 'string' && !!dashboard.templateKey.trim() &&
    typeof dashboard.displayName === 'string' && typeof dashboard.description === 'string' &&
    typeof dashboard.isFallback === 'boolean' && (dashboard.fallbackReason === undefined || typeof dashboard.fallbackReason === 'string') && Array.isArray(dashboard.widgets) &&
    dashboard.widgets.every(w => w && typeof w.widgetKey === 'string' && !!w.widgetKey.trim() &&
      Number.isFinite(w.order) && typeof w.displayName === 'string' && typeof w.description === 'string' &&
      (w.fetchMode === 'proxy' || w.fetchMode === 'direct') && typeof w.kind === 'string' &&
      typeof w.authorized === 'boolean' && (w.title === undefined || typeof w.title === 'string') &&
      (w.endpoint === undefined || typeof w.endpoint === 'string')) &&
    new Set(dashboard.widgets.map(w => w.widgetKey)).size === dashboard.widgets.length;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = (props) => {
  const { principal, sessionId } = useAuthStore();
  if (!principal) return null;
  const key = JSON.stringify([sessionId, principal.principalId, principal.sessionId, principal.audience, principal.type, principal.roles, principal.scopes, principal.assuranceLevel, principal.customerAccess, principal.readOnlyPrincipal]);
  return <DashboardWorkspace key={key} {...props} />;
};

const DashboardWorkspace: React.FC<DashboardScreenProps> = ({ onNavigateToCustomers, onNavigateToAgents, onNavigate }) => {
  const { principal } = useAuthStore();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { data: dashboard, loading, error } = useWidgetData<ResolvedDashboard>(
    async () => {
      const value: unknown = await ApiClient.get(`${DASH}/my-dashboard`);
      if (!validDashboard(value)) throw new Error('Invalid dashboard response.');
      return value;
    },
    [loadAttempt],
  );

  if (!principal) return null;

  const has = (key: string) => dashboard?.widgets.some(widget => widget.widgetKey === key && widget.authorized) === true;
  const navigate = (view: AdminView) => onNavigate && canAccessAdminView(view, principal.scopes, principal.roles) ? () => onNavigate(view) : undefined;
  const role = principal.roles[0]?.replace(/_/g, ' ').toLowerCase() || 'operator';
  return (
    <div className="mn-operational mn-dashboard">
      <header className="one-dashboard-header"><div><h1>Welcome back, {role}</h1><p>Here's what's happening across your authorized workspace.</p></div><span>Operations overview</span></header>
      {loading && <div className="one-dashboard-state" role="status">Loading your dashboard…</div>}
      {!loading && error && <div className="one-dashboard-state one-dashboard-state--error" role="alert">Unable to load your dashboard: {error} <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry dashboard</button></div>}
      {!loading && !error && dashboard && <>
        {dashboard.isFallback && <div className="one-dashboard-state" role="status">Default dashboard{dashboard.fallbackReason ? ` — ${dashboard.fallbackReason}` : ''}</div>}
        {has('transaction-summary') && <OneSummaryCards canAgents={has('agent-lifecycle-summary') && principal.scopes.includes('agent.view')} agentNotConfigured={!dashboard.widgets.some(widget => widget.widgetKey === 'agent-lifecycle-summary')} canCustomers={principal.scopes.includes('customer.view')} />}
        {has('reconciliation-status') && <ReconciliationNotice onOpen={navigate('reconciliation')} />}
        <div className="one-dashboard-widgets">
          {has('transaction-trend') && <div className="one-dashboard-widget one-dashboard-widget--transaction-trend"><TransactionTrendWidget /></div>}
          {has('transaction-summary') && <div className="one-dashboard-widget one-dashboard-widget--status"><TransactionStatus /></div>}
          <div className="one-dashboard-widget one-dashboard-widget--action-queue"><ActionItems canKyc={Boolean(navigate('kycQueue'))} canSupport={Boolean(navigate('support'))} canApprovals={Boolean(navigate('approvalsInbox'))} onAgents={principal.scopes.includes('agent.view') ? onNavigateToAgents : undefined} canAgentNetwork={has('agent-lifecycle-summary')} canAgentOnboarding={has('agent-applications-queue') && principal.scopes.includes('agent.review_application')} onNavigate={view => onNavigate?.(view)} /></div>
          {has('recent-transactions') && <div className="one-dashboard-widget one-dashboard-widget--recent-transactions"><RecentTransactionsWidget />{navigate('transfers') && <button type="button" className="one-overview-link" onClick={navigate('transfers')}>Open transactions →</button>}</div>}
          {has('audit-trail') && <div className="one-dashboard-widget one-dashboard-widget--activity"><RecentActivity onOpen={navigate('auditEvents')} /></div>}
        </div>
        {!dashboard.widgets.length && <p className="one-dashboard-state">No widgets are configured for your current dashboard template.</p>}
      </>}
    </div>
  );
};
