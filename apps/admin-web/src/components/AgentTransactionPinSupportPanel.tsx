import React, { useEffect, useState } from 'react';

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

  useEffect(() => {
    setPinState(null);
    setReason('');
    setError('');
    setMessage('');
  }, [agentId]);

  if (!canManageSupport || !agentId) return null;

  const inspectStatus = async () => {
    if (!loadPinStatus || loading) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const status = await loadPinStatus(agentId);
      setPinState(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Agent Transaction PIN status.');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onUnlockPin || unlockBusy) return;
    if (!reason.trim()) {
      setError('Audit reason is required before unlocking a locked Agent Transaction PIN.');
      return;
    }
    setUnlockBusy(true);
    setError('');
    setMessage('');
    try {
      await onUnlockPin(agentId, reason.trim());
      setReason('');
      setMessage(`Transaction PIN lockout cleared for Agent ${agentId}.`);
      if (loadPinStatus) {
        const refreshed = await loadPinStatus(agentId);
        setPinState(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to unlock Agent Transaction PIN.');
    } finally {
      setUnlockBusy(false);
    }
  };

  return (
    <section aria-label="Agent Transaction PIN support controls" style={styles.panel}>
      <div style={styles.header}>
        <h4 style={styles.title}>Transaction PIN Support &amp; Lockout Remediation</h4>
        {loadPinStatus && (
          <button
            type="button"
            style={styles.button}
            disabled={loading || unlockBusy}
            onClick={() => void inspectStatus()}
          >
            {loading ? 'Loading PIN state…' : pinState ? 'Refresh PIN state' : 'Inspect PIN state'}
          </button>
        )}
      </div>

      <p style={styles.note}>
        Security boundary (V1-AGENT-05): Workforce operators never view, generate, or set an Agent&apos;s
        Transaction PIN. Agents create and rotate their own 4–12 digit PIN in Agent Mobile; after 5 failed
        attempts, PIN lockout requires verified Support remediation.
      </p>

      {!loadPinStatus && !onUnlockPin ? (
        <div style={styles.dependencyBox} role="note" data-testid="agent-pin-support-dependency">
          <strong>Backend Dependency (ARENA 3):</strong> Admin Agent Transaction PIN status and lockout-reset
          endpoints (<code>GET /internal/admin/agents/:id/transaction-pin</code> and{' '}
          <code>POST /internal/admin/agents/:id/transaction-pin/unlock</code>) are not yet available on the
          backend. Record out-of-band identity verification in the Support ticket thread for Agent{' '}
          <code>{agentId}</code> and escalate lockout clearance once ARENA 3 enables the endpoint.
        </div>
      ) : (
        <>
          {error && <div style={styles.errorBox} role="alert">{error}</div>}
          {message && <div style={styles.successBox} role="status">{message}</div>}

          {pinState && (
            <div style={styles.stateBox} data-testid="agent-pin-support-state">
              <div>
                <strong>PIN Status:</strong>{' '}
                <span style={styles.badge}>{pinState.status}</span>
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
                <form onSubmit={handleUnlock} style={styles.unlockForm}>
                  <label style={styles.label}>
                    Support verification &amp; unlock audit reason
                    <input
                      aria-label="PIN unlock audit reason"
                      placeholder="e.g. Verified Agent KYC & outlet manager callback on SUP-..."
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setError('');
                      }}
                      style={styles.input}
                      disabled={unlockBusy}
                    />
                  </label>
                  <button
                    type="submit"
                    style={styles.unlockButton}
                    disabled={unlockBusy || !reason.trim()}
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
    background: '#F8FAFC',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 10,
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { margin: 0, fontSize: 13, color: '#032B14' },
  note: { margin: 0, fontSize: 12, color: '#475569', lineHeight: 1.5 },
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
    border: '1px solid #E2E8F0',
    background: '#FFFFFF',
    fontSize: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  badge: { display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: '#FEE2E2', color: '#991B1B', fontSize: 11, fontWeight: 700 },
  unlockForm: { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 6 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px', fontSize: 11, fontWeight: 600, color: '#334155' },
  input: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { padding: '6px 10px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#FFF', cursor: 'pointer', fontSize: 12 },
  unlockButton: { padding: '7px 12px', border: '1px solid #0A3D25', borderRadius: 5, background: '#0A3D25', color: '#FFF', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  errorBox: { padding: 8, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 12 },
  successBox: { padding: 8, borderRadius: 5, border: '1px solid #6EE7B7', background: '#ECFDF5', color: '#065F46', fontSize: 12 },
};
