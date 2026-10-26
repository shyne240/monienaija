import React from 'react';
import { colors } from './tokens';

interface WidgetCardProps {
  title: string;
  description?: string;
  loading?: boolean;
  error?: string | null;
  restricted?: boolean;
  empty?: boolean;
  emptyLabel?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Shared chrome for every dashboard widget tile: title, optional description, and the four
 * required presentation states (loading / error / permission-denied / empty) called out by the
 * V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-02 task. `restricted` is shown instead of attempting a
 * fetch at all for a widget the backend's own `my-dashboard` response already marked
 * `authorized: false` — the frontend never calls that widget's data endpoint in that case
 * (defense in depth matches the backend's own re-check), it only explains why the tile is empty.
 */
export const WidgetCard: React.FC<WidgetCardProps> = ({
  title,
  description,
  loading,
  error,
  restricted,
  empty,
  emptyLabel,
  actions,
  children,
}) => {
  return (
    <div style={styles.card}>
      <div style={styles.headerRow}>
        <div>
          <h3 style={styles.title}>{title}</h3>
          {description && <p style={styles.description}>{description}</p>}
        </div>
        {actions && !restricted && <div style={styles.actions}>{actions}</div>}
      </div>

      {restricted && (
        <div style={styles.restrictedBox}>
          <span style={styles.restrictedIcon}>🔒</span>
          <span>Restricted — your role does not hold the permission required to view this widget.</span>
        </div>
      )}

      {!restricted && loading && (
        <div style={styles.stateBox}>
          <div style={styles.spinner} />
          <span style={styles.stateText}>Loading…</span>
        </div>
      )}

      {!restricted && !loading && error && (
        <div style={styles.errorBox}>
          <span>⚠️ {error}</span>
        </div>
      )}

      {!restricted && !loading && !error && empty && (
        <div style={styles.emptyBox}>{emptyLabel || 'No data available for this period.'}</div>
      )}

      {!restricted && !loading && !error && !empty && children}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    padding: 20,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
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
    maxWidth: 480,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  stateBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '20px 0',
    color: colors.textMuted,
    fontSize: 13,
  },
  spinner: {
    width: 16,
    height: 16,
    border: `2px solid ${colors.border}`,
    borderTop: `2px solid ${colors.brandGreen}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  stateText: {
    fontSize: 13,
  },
  errorBox: {
    backgroundColor: colors.dangerBg,
    color: colors.danger,
    fontSize: 13,
    fontWeight: 500,
    padding: 12,
    borderRadius: 6,
    border: `1px solid ${colors.danger}`,
  },
  emptyBox: {
    padding: '20px 0',
    color: colors.textFaint,
    fontSize: 13,
    textAlign: 'center',
  },
  restrictedBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  restrictedIcon: {
    fontSize: 16,
  },
};
