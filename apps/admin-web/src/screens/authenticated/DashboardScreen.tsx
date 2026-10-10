import React from 'react';
import { useAuthStore } from '../../store/auth-store';
import { ApiClient } from '../../services/api-client';
import { useWidgetData } from '../../components/dashboard/useWidgetData';
import { WidgetRenderer } from '../../components/dashboard/widgets';
import type { ResolvedDashboard } from '../../components/dashboard/types';

const DASH = '/internal/a2/workforce/dashboard';

interface DashboardScreenProps {
  onNavigateToCustomers?: () => void;
}

/**
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02
 *
 * Replaces the V1 placeholder ("Not yet available — ... gap" cards) with the real, per-role
 * configurable dashboard: fetches the caller's own resolved dashboard from the real backend
 * (`GET /internal/a2/workforce/dashboard/my-dashboard`, derived entirely from the caller's own
 * session roles/scopes — never a client-supplied parameter) and renders every widget the backend
 * returns through the shared widget-rendering library in `components/dashboard/`. The SAME
 * component renders all eleven V1 roles' dashboards — which widgets appear, and whether each is
 * shown as authorized or restricted, is controlled entirely by the backend's own template/
 * assignment/authorization resolution, never by any role-name branching in this file.
 *
 * The Identity & Session / Entitlements cards below are rendered directly from the already-known
 * `principal` object (no extra request — this is the same `identity-session`/`entitlements-scopes`
 * data the backend's own widget registry describes as "no function grant required, always your
 * own data") and are deliberately excluded from the generic widget list below to avoid showing the
 * same information twice.
 */
export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigateToCustomers }) => {
  const { principal } = useAuthStore();

  const { data: dashboard, loading, error } = useWidgetData<ResolvedDashboard>(
    () => ApiClient.get(`${DASH}/my-dashboard`),
    [],
  );

  if (!principal) return null;

  const renderableWidgets = (dashboard?.widgets ?? [])
    .filter((w) => w.widgetKey !== 'identity-session' && w.widgetKey !== 'entitlements-scopes')
    .slice()
    .sort((a, b) => a.order - b.order);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>System Administration Dashboard</h2>
        <p style={styles.subtitle}>Real-time system telemetry and operational monitoring status</p>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Identity & Session</h3>
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Operator Principal:</span>
            <span style={styles.metaValue}>{principal.principalId}</span>
          </div>
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Assurance Level:</span>
            <span style={styles.metaValue}>{principal.assuranceLevel}</span>
          </div>
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Audience bound:</span>
            <span style={styles.metaValue}>{principal.audience}</span>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Entitlements & Scopes</h3>
          <div style={styles.badgeContainer}>
            {principal.roles.map((role) => (
              <span key={role} style={styles.roleBadge}>{role}</span>
            ))}
          </div>
          <div style={styles.scopesList}>
            <span style={styles.scopesLabel}>Allowed scopes:</span>
            {principal.scopes.map((scope) => (
              <span key={scope} style={styles.scopeItem}>• {scope}</span>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.sectionHeaderRow}>
        <h3 style={styles.sectionHeader}>{dashboard ? dashboard.displayName : 'Your Dashboard'}</h3>
        {dashboard?.isFallback && (
          <span style={styles.fallbackBadge} title={dashboard.fallbackReason}>
            Default dashboard — {dashboard.fallbackReason || 'no role-specific template assigned'}
          </span>
        )}
      </div>
      {dashboard?.description && <p style={styles.subtitle}>{dashboard.description}</p>}

      {loading && (
        <div style={styles.stateBox}>
          <div style={styles.spinner} />
          <span>Loading your dashboard…</span>
        </div>
      )}

      {!loading && error && (
        <div style={styles.errorBox}>
          ⚠️ Unable to load your dashboard: {error}
        </div>
      )}

      {!loading && !error && dashboard && renderableWidgets.length === 0 && (
        <div style={styles.emptyBox}>No widgets are configured for your current dashboard template.</div>
      )}

      {!loading && !error && renderableWidgets.length > 0 && (
        <div style={styles.widgetGrid}>
          {renderableWidgets.map((widget) => (
            <WidgetRenderer key={widget.widgetKey} widget={widget} onNavigateToCustomers={onNavigateToCustomers} />
          ))}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '28px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '20px',
    marginBottom: '32px',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 16px 0',
    borderBottom: '1px solid #F1F5F9',
    paddingBottom: '8px',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    marginBottom: '10px',
  },
  metaLabel: {
    color: '#64748B',
    fontWeight: '500',
  },
  metaValue: {
    color: '#0F172A',
    fontWeight: '600',
    wordBreak: 'break-all' as const,
  },
  badgeContainer: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '8px',
    marginBottom: '16px',
  },
  roleBadge: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#0A3D25',
    backgroundColor: '#E6F0EB',
    padding: '4px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase' as const,
  },
  scopesList: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  scopesLabel: {
    fontSize: '12px',
    color: '#64748B',
    fontWeight: '500',
    marginBottom: '8px',
  },
  scopeItem: {
    fontSize: '12px',
    color: '#334155',
    fontFamily: 'monospace',
    marginBottom: '4px',
  },
  sectionHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap' as const,
    marginBottom: '4px',
  },
  sectionHeader: {
    fontSize: '17px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 16px 0',
  },
  fallbackBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    padding: '4px 10px',
    borderRadius: '999px',
    marginBottom: '16px',
  },
  widgetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
    gap: '20px',
    alignItems: 'start',
  },
  stateBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: '#64748B',
    fontSize: 13,
    padding: '12px 0',
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid #E2E8F0',
    borderTop: '2px solid #0A3D25',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorBox: {
    backgroundColor: '#FEE2E2',
    color: '#EF4444',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid #EF4444',
  },
  emptyBox: {
    color: '#94A3B8',
    fontSize: 13,
    padding: '12px 0',
  },
};
