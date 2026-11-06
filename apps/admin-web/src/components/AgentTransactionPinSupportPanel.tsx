import React, { useEffect, useRef, useState } from 'react';
import './agent-workspaces.css';

export interface AgentAdminPinStatus {
  agentId: string;
  status: 'NOT_SET' | 'ACTIVE' | 'LOCKED';
  pinVersion?: number | null;
  lockReason?: string | null;
  lastChangedAt?: string | null;
}

export interface AgentTransactionPinSupportPanelProps {
  agentId: string;
  canManageSupport: boolean;
  loadPinStatus?: (agentId: string) => Promise<AgentAdminPinStatus>;
  onUnlockPin?: (agentId: string, reason: string) => Promise<void>;
}

export const AgentTransactionPinSupportPanel: React.FC<AgentTransactionPinSupportPanelProps> = ({
  agentId,
  canManageSupport,
  loadPinStatus,
  onUnlockPin,
}) => {
  const [pinState, setPinState] = useState<AgentAdminPinStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const context = useRef({ agentId, canManageSupport });
  context.current = { agentId, canManageSupport };

  useEffect(() => {
    setPinState(null);
    setReason('');
    setError('');
    setMessage('');
    setLoading(false);
    setUnlockBusy(false);
    return () => { generation.current += 1; };
  }, [agentId, canManageSupport]);

  if (!canManageSupport || !agentId) return null;

  const inspectStatus = async () => {
    if (!loadPinStatus || loading || unlockBusy) return;
    const current = ++generation.current;
    const valid = () => generation.current === current && context.current.agentId === agentId && context.current.canManageSupport;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const status = await loadPinStatus(agentId);
      if (!valid()) return;
      if (!status || status.agentId !== agentId) throw new Error('PIN status did not match the selected Agent.');
      setPinState(status);
    } catch (err) {
      if (valid()) {
        setPinState(null);
        setError(err instanceof Error ? err.message : 'Unable to load Agent Transaction PIN status.');
      }
    } finally {
      if (valid()) setLoading(false);
    }
  };

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onUnlockPin || unlockBusy || loading) return;
    if (!reason.trim()) {
      setError('Audit reason is required before unlocking a locked Agent Transaction PIN.');
      return;
    }
    const current = ++generation.current;
    const valid = () => generation.current === current && context.current.agentId === agentId && context.current.canManageSupport;
    setUnlockBusy(true);
    setError('');
    setMessage('');
    try {
      await onUnlockPin(agentId, reason.trim());
      if (!valid()) return;
      setPinState(null);
      setReason('');
      setMessage(`Transaction PIN lockout cleared for Agent ${agentId}.`);
      if (loadPinStatus) {
        const refreshed = await loadPinStatus(agentId);
        if (!valid()) return;
        if (!refreshed || refreshed.agentId !== agentId) throw new Error('PIN status did not match the selected Agent.');
        setPinState(refreshed);
      }
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : 'Unable to unlock Agent Transaction PIN.');
    } finally {
      if (valid()) setUnlockBusy(false);
    }
  };

  return (
    <section aria-label="Agent Transaction PIN support controls" className="mn-agent-workspace">
      <div className="mn-agent-workspace__header">
        <h4 className="mn-agent-workspace__title">Transaction PIN Support &amp; Lockout Remediation</h4>
        {loadPinStatus && (
          <button
            type="button"
            className="mn-agent-workspace__button"
            disabled={loading || unlockBusy}
            onClick={() => void inspectStatus()}
          >
            {loading ? 'Loading PIN state…' : pinState ? 'Refresh PIN state' : 'Inspect PIN state'}
          </button>
        )}
      </div>

      <p className="mn-agent-workspace__description">
        Security boundary (V1-AGENT-05): Workforce operators never view, generate, or set an Agent&apos;s
        Transaction PIN. Agents create and rotate their own 4–12 digit PIN in Agent Mobile; after 5 failed
        attempts, PIN lockout requires verified Support remediation.
      </p>

      {!loadPinStatus && !onUnlockPin ? (
        <div>
          <div style={styles.dependencyBox} role="note" data-testid="agent-pin-support-dependency">
            <strong>Policy-Blocked Capability (V1-AGENT-05 §7):</strong> Operational Agent Transaction PIN
            status and lockout-reset endpoints (<code>GET /internal/admin/agents/:id/transaction-pin</code>{' '}
            and <code>POST /internal/admin/agents/:id/transaction-pin/unlock</code>) remain disabled pending
            explicit dual-control governance policy. Record verified out-of-band identity evidence in the
            Support ticket thread for Agent <code>{agentId}</code>.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled
              className="mn-agent-workspace__button"
            >
              Inspect PIN state (Unavailable)
            </button>
            <button
              type="button"
              disabled
              className="mn-agent-workspace__button"
            >
              Clear PIN Lockout (Policy blocked)
            </button>
          </div>
        </div>
      ) : (
        <>
          {error && <div style={styles.errorBox} role="alert">{error}</div>}
          {message && <div style={styles.successBox} role="status">{message}</div>}

          {pinState && !loading && (
            <div style={styles.stateBox} data-testid="agent-pin-support-state">
              <div>
                <strong>PIN Status:</strong>{' '}
                <span style={pinState.status === 'LOCKED' ? styles.badge : styles.neutralBadge}>{pinState.status}</span>
                {pinState.pinVersion != null && (
                  <span> · Version: <code>{pinState.pinVersion}</code></span>
                )}
              </div>
              {pinState.lockReason && (
                <div><strong>Lock reason:</strong> {pinState.lockReason}</div>
              )}
              {pinState.lastChangedAt && (
                <div><strong>Last updated:</strong> {new Date(pinState.lastChangedAt).toLocaleString()}</div>
              )}

              {pinState.status === 'LOCKED' && onUnlockPin && (
                <form onSubmit={handleUnlock} className="mn-agent-workspace__controls">
                  <label className="mn-agent-workspace__field">
                    Support verification &amp; unlock audit reason
                    <input
                      aria-label="PIN unlock audit reason"
                      placeholder="e.g. Verified Agent KYC & outlet manager callback on SUP-..."
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setError('');
                      }}
                      className="mn-agent-workspace__input"
                      disabled={unlockBusy || loading}
                    />
                  </label>
                  <button
                    type="submit"
                    className="mn-agent-workspace__button mn-agent-workspace__button--primary"
                    disabled={unlockBusy || loading || !reason.trim()}
                  >
                    {unlockBusy ? 'Unlocking…' : 'Clear PIN Lockout'}
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    padding: 12,
    border: '1px solid #CBD5E1',
    borderRadius: 7,
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 10,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 13, color: 'var(--mn-nav-surface-deep, #082f23)' },
  note: { margin: 0, fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', lineHeight: 1.5 },
  dependencyBox: {
    padding: 10,
    borderRadius: 6,
    border: '1px solid #FDE68A',
    background: '#FFFBEB',
    color: '#78350F',
    fontSize: 12,
    lineHeight: 1.5,
  },
  stateBox: {
    padding: 10,
    borderRadius: 6,
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    background: '#FFFFFF',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  neutralBadge: { display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: 'var(--mn-surface-sunken, #eef3f0)', color: 'var(--mn-text-primary, #132b25)', fontSize: 11, fontWeight: 700 },
  badge: { display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: 'var(--mn-status-danger-bg, #fdebe9)', color: '#991B1B', fontSize: 11, fontWeight: 700 },
  unlockForm: { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px', fontSize: 11, fontWeight: 600, color: 'var(--mn-text-primary, #132b25)' },
  input: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#FFF', cursor: 'pointer', fontSize: 12 },
  unlockButton: { padding: '7px 12px', border: '1px solid var(--mn-action-primary, #0b624a)', borderRadius: 5, background: 'var(--mn-action-primary, #0b624a)', color: '#FFF', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  errorBox: { padding: 8, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 12 },
  successBox: { padding: 8, borderRadius: 5, border: '1px solid #6EE7B7', background: '#ECFDF5', color: '#065F46', fontSize: 12 },
};
