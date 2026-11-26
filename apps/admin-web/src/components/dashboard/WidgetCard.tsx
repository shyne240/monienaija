import React from 'react';
import { colors } from './tokens';
import { formatDate } from './types';

interface WidgetCardProps {
  title: string;
  description?: string;
  loading?: boolean;
  error?: string | null;
  restricted?: boolean;
  /** Catalogue functions the widget requires — shown so a locked tile names what is missing. */
  missingFunctions?: readonly string[];
  empty?: boolean;
  emptyLabel?: string;
  /**
   * The source exists but could not be read. Distinct from `error` only in that the widget supplied
   * a structured "I cannot see" answer instead of a thrown request; both are rendered as
   * unavailable and neither is ever rendered as a zero.
   */
  unavailable?: string;
  /** The capability is absent by configuration in this deployment — a state, not a failure. */
  notConfigured?: string;
  /** When the source actually answered, so a stale number can be recognized as stale. */
  checkedAt?: string;
  /** Which endpoint/service produced the figure. */
  source?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Shared chrome for every dashboard widget tile, with the presentation states the configurable
 * dashboard contract requires: loading, error, permission-denied, and "measured empty".
 *
 * `empty` is deliberately labelled as a *measured* zero rather than "no data available", because
 * those two read identically to a human and mean opposite things to an operator: one says the
 * source was consulted and found nothing, the other says nobody looked. `unavailable` and
 * `notConfigured` exist for the same reason — an unreadable source and an unprovisioned one are
 * both facts worth stating, and neither is a zero. `restricted` is shown instead of attempting a
 * fetch at all for a widget the backend's own `my-dashboard` response marked `authorized: false`
 * (defense in depth matching the backend's per-widget re-check), and now names the grant that is
 * missing so the reader can act on it instead of guessing.
 */
export const WidgetCard: React.FC<WidgetCardProps> = ({
  title,
  description,
  loading,
  error,
  restricted,
  missingFunctions,
  empty,
  emptyLabel,
  unavailable,
  notConfigured,
  checkedAt,
  source,
  actions,
  footer,
  children,
}) => {
  const granted = !restricted && !loading && !error && !unavailable && !notConfigured;
  return (
    <section className="one-widget-card" style={styles.card} data-widget-title={title}>
      <div className="one-widget-card__header" style={styles.headerRow}>
        <div>
          <h3 className="one-widget-card__title" style={styles.title}>
            {title}
          </h3>
          {description && (
            <p className="one-widget-card__description" style={styles.description}>
              {description}
            </p>
          )}
        </div>
        {actions && !restricted && <div style={styles.actions}>{actions}</div>}
      </div>

      {restricted && (
        <div style={styles.restrictedBox} data-testid="widget-restricted">
          <span style={styles.restrictedIcon} aria-hidden="true">
            🔒
          </span>
          <span>
            Restricted — your role does not hold the permission required to view this widget.
            {missingFunctions && missingFunctions.length > 0 ? (
              <>
                {' Requires '}
                {missingFunctions.map((fn) => <code key={fn}>{fn}</code>)}
                {'.'}
              </>
            ) : null}
          </span>
        </div>
      )}

      {!restricted && loading && (
        <div style={styles.stateBox} role="status" data-testid="widget-loading">
          <div style={styles.spinner} />
          <span style={styles.stateText}>Loading…</span>
        </div>
      )}

      {!restricted && !loading && error && (
        <div style={styles.errorBox} role="alert" data-testid="widget-error">
          <span>
            ⚠️ Source unavailable — {error}. This is a read failure, not a zero.
          </span>
        </div>
      )}

      {!restricted && !loading && !error && unavailable && (
        <div style={styles.errorBox} role="alert" data-testid="widget-unavailable">
          <span>
            ⚠️ Unavailable — {unavailable}. No conclusion can be drawn from this card; the absence
            of a figure is not a zero.
          </span>
        </div>
      )}

      {!restricted && !loading && !error && !unavailable && notConfigured && (
        <div style={styles.noticeBox} data-testid="widget-not-configured">
          <span>
            Not configured — {notConfigured}. This is a configuration state, not a fault and not a
            measured zero.
          </span>
        </div>
      )}

      {granted && empty && (
        <div style={styles.emptyBox} data-testid="widget-zero">
          {emptyLabel ||
            'Measured zero — the source was read for this period and returned no records.'}
        </div>
      )}

      {granted && !empty && children}

      {granted && (checkedAt || source || footer) && (
        <div style={styles.footer} data-testid="widget-footer">
          {footer}
          {source ? (
            <span style={styles.footerItem}>
              Source: <code style={styles.footerCode}>{source}</code>
            </span>
          ) : null}
          {checkedAt ? (
            <span style={styles.footerItem}>Checked {formatDate(checkedAt)}</span>
          ) : null}
        </div>
      )}
    </section>
  );
};

/**
 * The drill-down affordance for a card. Rendered only when the console was given a destination by
 * the server AND its own navigation guard says the current principal may open that workspace — a
 * stale or tampered widget list therefore cannot introduce a new navigation target, and a role
 * that cannot use the queue is not offered a button that would dead-end.
 */
export const WidgetDrilldownButton: React.FC<{
  label: string;
  onOpen?: () => void;
  testId?: string;
}> = ({ label, onOpen, testId }) =>
  onOpen ? (
    <button
      type="button"
      className="one-drilldown-button"
      data-testid={testId ?? 'widget-drilldown'}
      style={styles.drilldown}
      onClick={onOpen}
    >
      {label}
    </button>
  ) : null;

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    padding: 20,
    minWidth: 0,
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
  noticeBox: {
    backgroundColor: colors.borderLight,
    color: colors.textSecondary,
    fontSize: 13,
    padding: 12,
    borderRadius: 6,
    border: `1px dashed ${colors.border}`,
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
    backgroundColor: colors.borderLight,
    borderRadius: 6,
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  restrictedIcon: {
    fontSize: 16,
  },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    borderTop: `1px solid ${colors.borderLight}`,
    fontSize: 11,
    color: colors.textFaint,
  },
  footerItem: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
  },
  footerCode: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: colors.textMuted,
  },
  drilldown: {
    backgroundColor: 'transparent',
    color: colors.brandGreen,
    border: `1px solid ${colors.brandGreen}`,
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
