import React, { useState } from 'react';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { useWidgetData } from '../../components/dashboard/useWidgetData';
import { ActionItems } from '../../components/dashboard/ActionItems';
import { canAccessAdminView, type AdminView } from './navigation-access';
import { OneSummaryCards } from '../../components/dashboard/OneSummaryCards';
import {
  TransactionTrendWidget,
  RecentTransactionsWidget,
  WidgetRenderer,
} from '../../components/dashboard/widgets';
import {
  TransactionStatus,
  ReconciliationNotice,
  RecentActivity,
} from '../../components/dashboard/OverviewPanels';
import './operational-surfaces.css';
import './dashboard-workspace.css';
import './one-dashboard.css';
import type { ResolvedDashboard } from '../../components/dashboard/types';

const DASH = '/internal/a2/workforce/dashboard';

interface DashboardScreenProps {
  onNavigateToCustomers?: () => void;
  onNavigateToAgents?: (options?: { openApplications?: boolean }) => void;
  onNavigate?: (view: AdminView, context?: DashboardNavigationContext) => void;
}

/**
 * Context a card may attach to a drill-down. Kept deliberately narrow: it carries an identifier the
 * destination workspace already understands, never a query, route fragment or URL the card invented.
 */
export interface DashboardNavigationContext {
  customerId?: string;
  agentId?: string;
  auditEntityId?: string;
  auditEntityType?: string;
  correlationId?: string;
  openAgentApplications?: boolean;
}

/**
 * Widgets the dashboard renders through its own bespoke panels (the "one dashboard" treatment)
 * rather than the generic tile renderer. They are excluded from the generic pass so a widget is
 * fetched exactly once per load; a key listed here is never dropped, it is rendered differently.
 */
const BESPOKE_WIDGET_KEYS = new Set([
  'transaction-summary',
  'transaction-trend',
  'recent-transactions',
  'reconciliation-status',
  'audit-trail',
]);

/** Resolve dashboard authorization from the server before requesting overview data. */
function validDashboard(value: unknown): value is ResolvedDashboard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const dashboard = value as ResolvedDashboard;
  return (
    typeof dashboard.templateKey === 'string' &&
    !!dashboard.templateKey.trim() &&
    typeof dashboard.displayName === 'string' &&
    typeof dashboard.description === 'string' &&
    typeof dashboard.isFallback === 'boolean' &&
    (dashboard.fallbackReason === undefined || typeof dashboard.fallbackReason === 'string') &&
    Array.isArray(dashboard.widgets) &&
    dashboard.widgets.every(
      (w) =>
        w &&
        typeof w.widgetKey === 'string' &&
        !!w.widgetKey.trim() &&
        Number.isFinite(w.order) &&
        typeof w.displayName === 'string' &&
        typeof w.description === 'string' &&
        (w.fetchMode === 'proxy' || w.fetchMode === 'direct') &&
        typeof w.kind === 'string' &&
        typeof w.authorized === 'boolean' &&
        (w.title === undefined || typeof w.title === 'string') &&
        (w.endpoint === undefined || typeof w.endpoint === 'string') &&
        (w.requiredFunctions === undefined ||
          (Array.isArray(w.requiredFunctions) &&
            w.requiredFunctions.every((fn) => typeof fn === 'string' && !!fn.trim()))) &&
        // A drill-down is only trusted when it names a view key and a label; anything else is
        // dropped (the widget still renders, it just gets no button).
        (w.drilldown === undefined ||
          (typeof w.drilldown === 'object' &&
            w.drilldown !== null &&
            typeof (w.drilldown as { view?: unknown }).view === 'string' &&
            !!(w.drilldown as { view?: string }).view?.trim() &&
            typeof (w.drilldown as { label?: unknown }).label === 'string')) &&
        (w.dataEndpoint === undefined || typeof w.dataEndpoint === 'string'),
    ) &&
    new Set(dashboard.widgets.map((w) => w.widgetKey)).size === dashboard.widgets.length
  );
}

export const DashboardScreen: React.FC<DashboardScreenProps> = (props) => {
  const { principal, sessionId } = useAuthStore();
  if (!principal) return null;
  const key = JSON.stringify([
    sessionId,
    principal.principalId,
    principal.sessionId,
    principal.audience,
    principal.type,
    principal.roles,
    principal.scopes,
    principal.assuranceLevel,
    principal.customerAccess,
    principal.readOnlyPrincipal,
  ]);
  return <DashboardWorkspace key={key} {...props} />;
};

const DashboardWorkspace: React.FC<DashboardScreenProps> = ({
  onNavigateToCustomers,
  onNavigateToAgents,
  onNavigate,
}) => {
  const { principal } = useAuthStore();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const {
    data: dashboard,
    loading,
    error,
  } = useWidgetData<ResolvedDashboard>(async () => {
    const value: unknown = await ApiClient.get(`${DASH}/my-dashboard`);
    if (!validDashboard(value)) throw new Error('Invalid dashboard response.');
    return value;
  }, [loadAttempt]);

  if (!principal) return null;

  /**
   * Presence *and* authorization. A key that is merely placed in the template but not authorized for
   * this session must not enable a panel: the dashboard used to ask "is it in the layout" in one
   * place and "is it mine" in another, which is how a restricted role could be offered an action it
   * could not complete. Every bespoke panel below therefore asks the authorized question, and
   * restricted placements are rendered (not hidden) by the generic pass, which explains the lock.
   */
  const has = (key: string) =>
    dashboard?.widgets.some((widget) => widget.widgetKey === key && widget.authorized) === true;
  const isPlaced = (key: string) => dashboard?.widgets.some((w) => w.widgetKey === key) === true;
  const navigate = (view: AdminView, context?: DashboardNavigationContext) =>
    onNavigate && canAccessAdminView(view, principal.scopes, principal.roles, context)
      ? () => onNavigate(view, context)
      : undefined;
  /**
   * The single funnel every generic card drill-down goes through. The destination comes from the
   * server's widget registry, but the *authorization* to open it is resolved here against the same
   * navigation contract the shell uses, and then again by the backend on the next page's data
   * calls — a registry entry that names a workspace this role cannot open produces no button.
   */
  const openView = (view: string, context?: DashboardNavigationContext) => {
    const candidate = view as AdminView;
    if (!canAccessAdminView(candidate, principal.scopes, principal.roles, context)) return;
    onNavigate?.(candidate, context);
  };
  /**
   * The same decision, asked *before* a control is rendered instead of after it is clicked, so an
   * unreachable destination never becomes a button that does nothing.
   */
  const canOpenView = (view: string) =>
    canAccessAdminView(view as AdminView, principal.scopes, principal.roles);
  const remainingWidgets = (dashboard?.widgets ?? [])
    .filter((widget) => !BESPOKE_WIDGET_KEYS.has(widget.widgetKey))
    .sort((a, b) => a.order - b.order);
  const role = principal.roles[0]?.replace(/_/g, ' ').toLowerCase() || 'operator';
  return (
    <div className="mn-operational mn-dashboard">
      <header className="one-dashboard-header">
        <div>
          <h1>Welcome back, {role}</h1>
          <p>Here's what's happening across your authorized workspace.</p>
        </div>
        <span>Operations overview</span>
      </header>
      {loading && (
        <div className="one-dashboard-state" role="status">
          Loading your dashboard…
        </div>
      )}
      {!loading && error && (
        <div className="one-dashboard-state one-dashboard-state--error" role="alert">
          Unable to load your dashboard: {error}{' '}
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry dashboard
          </button>
        </div>
      )}
      {!loading && !error && dashboard && (
        <>
          {dashboard.isFallback && (
            <div className="one-dashboard-state" role="status">
              Default dashboard{dashboard.fallbackReason ? ` — ${dashboard.fallbackReason}` : ''}
            </div>
          )}
          {has('transaction-summary') && (
            <OneSummaryCards
              canAgents={has('agent-lifecycle-summary') && principal.scopes.includes('agent.view')}
              agentNotConfigured={!isPlaced('agent-lifecycle-summary')}
              canCustomers={principal.scopes.includes('customer.view')}
            />
          )}
          {isPlaced('notification-delivery-exceptions') && (
            <div className="one-dashboard-widget one-dashboard-widget--notification-exceptions">
              {/*
                Placed, then decided by the renderer: an authorized placement renders the card and its
                records, a restricted one renders the lock and names the missing function. Hiding the tile
                entirely would leave the operator to conclude the dashboard has no such source, which is a
                different — and wrong — fact. The renderer fetches nothing for a restricted widget.
              */}
              <WidgetRenderer
                widget={
                  dashboard!.widgets.find((widget) => widget.widgetKey === 'notification-delivery-exceptions')!
                }
                onOpenView={openView}
                canOpenView={canOpenView}
              />
            </div>
          )}
          {has('reconciliation-status') && (
            <ReconciliationNotice onOpen={navigate('reconciliation')} />
          )}
          <div className="one-dashboard-widgets">
            {has('transaction-trend') && (
              <div className="one-dashboard-widget one-dashboard-widget--transaction-trend">
                <TransactionTrendWidget />
              </div>
            )}
            {has('transaction-summary') && (
              <div className="one-dashboard-widget one-dashboard-widget--status">
                <TransactionStatus />
              </div>
            )}
            <div className="one-dashboard-widget one-dashboard-widget--action-queue">
              <ActionItems
                canKyc={Boolean(navigate('kycQueue'))}
                canSupport={Boolean(navigate('support'))}
                canApprovals={Boolean(navigate('approvalsInbox'))}
                onAgents={principal.scopes.includes('agent.view') ? onNavigateToAgents : undefined}
                canAgentNetwork={has('agent-lifecycle-summary')}
                canAgentOnboarding={
                  has('agent-applications-queue') &&
                  principal.scopes.includes('agent.review_application')
                }
                onNavigate={(view) => onNavigate?.(view)}
              />
            </div>
            {has('recent-transactions') && (
              <div className="one-dashboard-widget one-dashboard-widget--recent-transactions">
                <RecentTransactionsWidget />
                {navigate('transfers') && (
                  <button
                    type="button"
                    className="one-overview-link"
                    onClick={navigate('transfers')}
                  >
                    Open transactions →
                  </button>
                )}
              </div>
            )}
            {has('audit-trail') && (
              <div className="one-dashboard-widget one-dashboard-widget--activity">
                <RecentActivity onOpen={navigate('auditEvents')} />
              </div>
            )}
          </div>
          {remainingWidgets
            .filter((widget) => widget.widgetKey !== 'notification-delivery-exceptions')
            .map((widget) => (
              <div className="one-dashboard-widget" key={widget.widgetKey}>
                <WidgetRenderer
                  widget={widget}
                  onOpenView={openView}
                  canOpenView={canOpenView}
                />
              </div>
            ))}
          {!dashboard.widgets.length && (
            <p className="one-dashboard-state">
              No widgets are configured for your current dashboard template. Your session still has
              its own identity and entitlement tiles available; ask a dashboard administrator to
              assign a template for operational data.
            </p>
          )}
        </>
      )}
    </div>
  );
};
