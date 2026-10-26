import React, { useEffect, useState } from 'react';

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

  useEffect(() => {
    setTargetClassId(currentClassId ?? '');
    setReason('');
    setError('');
    setMessage('');
  }, [agentId, currentClassId]);

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
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onReclassify(agentId, targetClassId, reason.trim());
      setReason('');
      setMessage('Agent class updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update Agent class.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Agent class governance assignment" style={styles.panel}>
      <div style={styles.header}>
        <strong style={styles.title}>Class Governance &amp; Reclassification</strong>
        <span style={styles.currentLabel}>
          Current:{' '}
          {currentClass
            ? `${currentClass.name} (${currentClass.code})`
            : currentClassId || 'Unassigned'}
        </span>
      </div>

      {!onReclassify ? (
        <div style={styles.dependencyBox} role="note" data-testid="agent-reclassify-dependency">
          <strong>Backend Dependency (ARENA 3):</strong> Post-onboarding Agent reclassification (
          <code>PATCH /internal/admin/agents/:id/class</code>) and seeded role grants for{' '}
          <code>agent.manage_classes</code> are pending ARENA 3 delivery. Initial class assignment is bound
          from the approved onboarding application.
        </div>
      ) : !canManageClasses ? (
        <div style={styles.note}>Reclassification requires <code>agent.manage_classes</code>.</div>
      ) : (
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            Target active class
            <select
              aria-label="Target Agent class"
              value={targetClassId}
              onChange={(e) => {
                setTargetClassId(e.target.value);
                setError('');
              }}
              style={styles.input}
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
          <label style={styles.label}>
            Governance reason
            <input
              aria-label="Class change reason"
              placeholder="Reason for tier/class change"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError('');
              }}
              style={styles.input}
              disabled={busy}
            />
          </label>
          <button
            type="submit"
            style={styles.button}
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
  panel: { padding: 10, border: '1px solid #CBD5E1', borderRadius: 7, background: '#F8FAFC', marginTop: 10 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 },
  title: { color: '#032B14', fontSize: 13 },
  currentLabel: { color: '#334155', fontSize: 12 },
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
  note: { marginTop: 6, color: '#64748B', fontSize: 12 },
  form: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600, color: '#334155' },
  input: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { alignSelf: 'flex-start', padding: '6px 11px', border: '1px solid #0A3D25', borderRadius: 5, background: '#0A3D25', color: '#FFF', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  errorBox: { padding: 8, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 11 },
  successBox: { padding: 8, borderRadius: 5, border: '1px solid #6EE7B7', background: '#ECFDF5', color: '#065F46', fontSize: 11 },
};
