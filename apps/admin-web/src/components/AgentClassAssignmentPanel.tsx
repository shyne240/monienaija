import React, { useEffect, useRef, useState } from 'react';
import './agent-workspaces.css';
import './agent-governance.css';

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
    <section aria-label="Agent class governance assignment" className="mn-agent-workspace agent-governance">
      <div className="agent-governance__header">
        <div><p className="agent-governance__eyebrow">AGENT GOVERNANCE</p><h4 className="mn-agent-workspace__title">Class Governance &amp; Reclassification</h4><p className="mn-agent-workspace__description">Review the Agent’s assigned class and the availability of governed reclassification.</p></div>
      </div>
      <div className="agent-governance__fact"><span>Current assigned class</span><strong>{currentClass ? `${currentClass.name} (${currentClass.code})` : currentClassId || 'Unassigned'}</strong></div>

      {!onReclassify ? (
        <div>
          <div className="agent-governance__boundary" role="note" data-testid="agent-reclassify-dependency">
            <strong>Policy-Blocked Capability:</strong> Post-activation Agent class reassignment (
            <code>PATCH /internal/admin/agents/:id/class</code>) is not enabled in V1 policy. While{' '}
            <code>agent.manage_classes</code> governs the class catalogue, an active Agent&apos;s assigned
            class remains bound to its approved onboarding application until a governed reclassification
            workflow is approved.
          </div>
          <button
            type="button"
            disabled
            className="mn-agent-workspace__button agent-governance__blocked-action"
          >
            Reclassify Agent (Policy blocked)
          </button>
        </div>
      ) : !canManageClasses ? (
        <div className="agent-governance__boundary">Reclassification requires <code>agent.manage_classes</code>.</div>
      ) : (
        <form onSubmit={handleSubmit} className="mn-agent-workspace__controls agent-governance__form">
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
          {error && <div className="agent-governance__feedback agent-governance__feedback--error" role="alert">{error}</div>}
          {message && <div className="agent-governance__feedback agent-governance__feedback--success" role="status">{message}</div>}
        </form>
      )}
    </section>
  );
};
