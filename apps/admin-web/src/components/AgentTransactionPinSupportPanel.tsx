import React, { useEffect, useRef, useState } from 'react';
import './agent-workspaces.css';
import './agent-governance.css';

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
    <section aria-label="Agent Transaction PIN support controls" className="mn-agent-workspace agent-governance">
      <div className="mn-agent-workspace__header">
        <div><p className="agent-governance__eyebrow">SUPPORT · SECURITY</p><h4 className="mn-agent-workspace__title">Transaction PIN Support &amp; Lockout Remediation</h4></div>
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
          <div className="agent-governance__boundary" role="note" data-testid="agent-pin-support-dependency">
            <strong>Policy-Blocked Capability (V1-AGENT-05 §7):</strong> Operational Agent Transaction PIN
            status and lockout-reset endpoints (<code>GET /internal/admin/agents/:id/transaction-pin</code>{' '}
            and <code>POST /internal/admin/agents/:id/transaction-pin/unlock</code>) remain disabled pending
            explicit dual-control governance policy. Record verified out-of-band identity evidence in the
            Support ticket thread for Agent <code>{agentId}</code>.
          </div>
          <div className="agent-governance__actions">
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
          {error && <div className="agent-governance__feedback agent-governance__feedback--error" role="alert">{error}</div>}
          {message && <div className="agent-governance__feedback agent-governance__feedback--success" role="status">{message}</div>}

          {!pinState && !loading && !error && loadPinStatus && <p className="agent-governance__hint">PIN state has not been loaded. Inspect the state before considering remediation.</p>}
          {!onUnlockPin && loadPinStatus && <p className="agent-governance__hint">Lockout reset is unavailable in this workspace.</p>}
          {pinState && !loading && (
            <div className="agent-governance__state" data-testid="agent-pin-support-state">
              <div>
                <strong>PIN Status:</strong>{' '}
                <span className={pinState.status === 'LOCKED' ? 'agent-governance__badge agent-governance__badge--locked' : 'agent-governance__badge'}>{pinState.status}</span>
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
                <form onSubmit={handleUnlock} className="mn-agent-workspace__controls agent-governance__form">
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
