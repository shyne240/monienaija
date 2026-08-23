import React from 'react';
import { useAuthStore } from '../../store/auth-store';

export const DashboardScreen: React.FC = () => {
  const { principal } = useAuthStore();

  if (!principal) return null;

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

      <h3 style={styles.sectionHeader}>System Financial Health</h3>
      <div style={styles.grid}>
        <div style={styles.metricCard}>
          <span style={styles.metricLabel}>NGN Total Supply (Ledger)</span>
          <span style={styles.metricGap}>Not yet available — B6 Reporting backend API gap</span>
        </div>

        <div style={styles.metricCard}>
          <span style={styles.metricLabel}>Suspense Balance Breaks</span>
          <span style={styles.metricGap}>Not yet available — B2F10 break management gap</span>
        </div>

        <div style={styles.metricCard}>
          <span style={styles.metricLabel}>Outbox event backlog</span>
          <span style={styles.metricGap}>Not yet available — Operations API gap</span>
        </div>
      </div>
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
  sectionHeader: {
    fontSize: '17px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 16px 0',
  },
  metricCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: '8px',
    border: '1px dashed #CBD5E1',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '120px',
  },
  metricLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#64748B',
    marginBottom: '8px',
  },
  metricGap: {
    fontSize: '12px',
    fontWeight: '500',
    color: '#94A3B8',
    textAlign: 'center' as const,
  },
};
