import React, { useEffect, useRef, useState } from 'react';
import './agent-workspaces.css';

export interface AgentClassOption {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface AgentClassAssignmentPanelProps {
  agentId: string;
  currentClassId: string | null;
  availableClasses: AgentClassOption[];
  canManageClasses: boolean;
  onReclassify?: (agentId: string, targetClassId: string, reason: string) => Promise<void>;
}

export const AgentClassAssignmentPanel: React.FC<AgentClassAssignmentPanelProps> = ({
  agentId,
  currentClassId,
  availableClasses,
  canManageClasses,
  onReclassify,
}) => {
  const [targetClassId, setTargetClassId] = useState(currentClassId ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const context = useRef({ agentId, canManageClasses });
  context.current = { agentId, canManageClasses };

  useEffect(() => {
    setTargetClassId(currentClassId ?? '');
    setReason('');
    setError('');
    setMessage('');
    setBusy(false);
    return () => { generation.current += 1; };
  }, [agentId, currentClassId, canManageClasses]);

  const currentClass = availableClasses.find((cls) => cls.id === currentClassId) ?? null;
  const activeChoices = availableClasses.filter((cls) => cls.isActive);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageClasses || !onReclassify || busy) return;
    if (!targetClassId || targetClassId === currentClassId) {
      setError('Select a different active Agent class before submitting.');
      return;
    }
    if (!reason.trim()) {
      setError('Audit reason is required before reclassifying an Agent.');
      return;
    }
    const request = ++generation.current;
    const valid = () => request === generation.current && context.current.agentId === agentId && context.current.canManageClasses;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onReclassify(agentId, targetClassId, reason.trim());
      if (!valid()) return;
      setReason('');
      setMessage('Agent class updated.');
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : 'Unable to update Agent class.');
    } finally {
      if (valid()) setBusy(false);
    }
  };

  return (
    <section aria-label="Agent class governance assignment" className="mn-agent-workspace">
      <div className="mn-agent-workspace__header">
        <h4 className="mn-agent-workspace__title">Class Governance &amp; Reclassification</h4>
        <span className="mn-agent-workspace__description">
          Current:{' '}
          {currentClass
            ? `${currentClass.name} (${currentClass.code})`
            : currentClassId || 'Unassigned'}
        </span>
      </div>

      {!onReclassify ? (
        <div>
          <div style={styles.dependencyBox} role="note" data-testid="agent-reclassify-dependency">
            <strong>Policy-Blocked Capability:</strong> Post-activation Agent class reassignment (
            <code>PATCH /internal/admin/agents/:id/class</code>) is not enabled in V1 policy. While{' '}
            <code>agent.manage_classes</code> governs the class catalogue, an active Agent&apos;s assigned
            class remains bound to its approved onboarding application until a governed reclassification
            workflow is approved.
          </div>
          <button
            type="button"
            disabled
            className="mn-agent-workspace__button"
          >
            Reclassify Agent (Policy blocked)
          </button>
        </div>
      ) : !canManageClasses ? (
        <div style={styles.note}>Reclassification requires <code>agent.manage_classes</code>.</div>
      ) : (
        <form onSubmit={handleSubmit} className="mn-agent-workspace__controls">
          <label className="mn-agent-workspace__field">
            Target active class
            <select
              aria-label="Target Agent class"
              value={targetClassId}
              onChange={(e) => {
                setTargetClassId(e.target.value);
                setError('');
              }}
              className="mn-agent-workspace__input"
              disabled={busy}
            >
              <option value="">Select active class…</option>
              {activeChoices.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({cls.code})
                </option>
              ))}
            </select>
          </label>
          <label className="mn-agent-workspace__field">
            Governance reason
            <input
              aria-label="Class change reason"
              placeholder="Reason for tier/class change"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError('');
              }}
              className="mn-agent-workspace__input"
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            className="mn-agent-workspace__button mn-agent-workspace__button--primary"
            disabled={busy || !targetClassId || targetClassId === currentClassId || !reason.trim()}
          >
            {busy ? 'Updating…' : 'Reclassify Agent'}
          </button>
          {error && <div style={styles.errorBox} role="alert">{error}</div>}
          {message && <div style={styles.successBox} role="status">{message}</div>}
        </form>
      )}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: { padding: 10, border: '1px solid #CBD5E1', borderRadius: 7, background: 'var(--mn-surface-canvas, #f5f8f6)', marginTop: 10 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 },
  title: { color: 'var(--mn-nav-surface-deep, #082f23)', fontSize: 13 },
  currentLabel: { color: 'var(--mn-text-primary, #132b25)', fontSize: 12 },
  dependencyBox: {
    marginTop: 8,
    padding: 9,
    borderRadius: 5,
    border: '1px solid #FDE68A',
    background: '#FFFBEB',
    color: '#78350F',
    fontSize: 11,
    lineHeight: 1.5,
  },
  note: { marginTop: 6, color: 'var(--mn-text-secondary, #52655f)', fontSize: 12 },
  form: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--mn-text-primary, #132b25)' },
  input: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { alignSelf: 'flex-start', padding: '6px 11px', border: '1px solid var(--mn-action-primary, #0b624a)', borderRadius: 5, background: 'var(--mn-action-primary, #0b624a)', color: '#FFF', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  errorBox: { padding: 8, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 11 },
  successBox: { padding: 8, borderRadius: 5, border: '1px solid #6EE7B7', background: '#ECFDF5', color: '#065F46', fontSize: 11 },
};
