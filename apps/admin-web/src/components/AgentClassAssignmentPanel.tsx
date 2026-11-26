import React, { useEffect, useRef, useState } from 'react';
import type { AgentClassImpact, AgentClassReadiness } from '../services/agent-class-lifecycle-api';
import { describeCapabilityReason } from '../services/agent-class-lifecycle-api';
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
  /**
   * V1-AGENT-CLASS-LIFECYCLE-01 — read-only readiness projection for the CURRENT class.
   * Supplied by the screen; absent means "not loaded", never "nothing is denied".
   */
  readiness?: AgentClassReadiness | null;
  /**
   * Read-only impact preview for the SELECTED target class. Supplied by the screen so this
   * component stays presentational and every judgement comes from the backend capability gate.
   */
  impactPreview?: AgentClassImpact | null;
  impactPreviewError?: string;
  impactPreviewLoading?: boolean;
  /** Agent version for the optimistic lock; the screen owns the record it last read. */
  agentVersion?: number;
  /**
   * Fired when the operator picks a different target class, so the SCREEN can request the read-only
   * impact preview. Kept as a callback (rather than fetching here) so this component never issues a
   * request the screen has not accounted for, and so the no-callback "Policy blocked" path used by
   * the governance tests stays a pure presentational surface.
   */
  onPreviewTargetClass?: (targetClassId: string) => void;
}

export const AgentClassAssignmentPanel: React.FC<AgentClassAssignmentPanelProps> = ({
  agentId,
  currentClassId,
  availableClasses,
  canManageClasses,
  onReclassify,
  readiness,
  impactPreview,
  impactPreviewError,
  impactPreviewLoading,
  agentVersion,
  onPreviewTargetClass,
}) => {
  const [targetClassId, setTargetClassId] = useState(currentClassId ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const generation = useRef(0);
  /**
   * The class this panel itself just switched the Agent to. When the parent re-renders with that
   * exact class, the reset effect must NOT wipe the success message — that class change IS our own
   * confirmed result. Any other class change (another operator, a different Agent) still resets.
   */
  const ownSwitchTarget = useRef<string | null>(null);
  const context = useRef({ agentId, canManageClasses });
  context.current = { agentId, canManageClasses };

  useEffect(() => {
    const isOwnConfirmedSwitch =
      ownSwitchTarget.current !== null && currentClassId === ownSwitchTarget.current;
    ownSwitchTarget.current = null;
    setTargetClassId(currentClassId ?? '');
    setAcknowledged(false);
    setBusy(false);
    if (isOwnConfirmedSwitch) return;
    setReason('');
    setError('');
    setMessage('');
    return () => {
      generation.current += 1;
    };
  }, [agentId, currentClassId, canManageClasses]);

  const currentClass = availableClasses.find((cls) => cls.id === currentClassId) ?? null;
  const activeChoices = availableClasses.filter((cls) => cls.isActive);
  const isSameClass = Boolean(targetClassId) && targetClassId === currentClassId;
  const withdrawalCount = impactPreview?.losses.length ?? 0;
  const previewBlocks = impactPreview ? !impactPreview.canSwitch : false;
  // A switch that withdraws services is the one case where "are you sure?" is not ceremony.
  const needsAcknowledgement = withdrawalCount > 0;
  const canSubmit =
    canManageClasses &&
    Boolean(onReclassify) &&
    Boolean(targetClassId) &&
    !isSameClass &&
    Boolean(reason.trim()) &&
    !previewBlocks &&
    (!needsAcknowledgement || acknowledged);

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
    const valid = () =>
      request === generation.current &&
      context.current.agentId === agentId &&
      context.current.canManageClasses;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await onReclassify(agentId, targetClassId, reason.trim());
      if (!valid()) return;
      ownSwitchTarget.current = targetClassId;
      setReason('');
      setAcknowledged(false);
      setMessage('Agent class updated.');
    } catch (err) {
      if (valid()) setError(err instanceof Error ? err.message : 'Unable to update Agent class.');
    } finally {
      if (valid()) setBusy(false);
    }
  };

  return (
    <section
      aria-label="Agent class governance assignment"
      className="mn-agent-workspace agent-governance"
    >
      <div className="agent-governance__header">
        <div>
          <p className="agent-governance__eyebrow">AGENT GOVERNANCE</p>
          <h4 className="mn-agent-workspace__title">Class Governance &amp; Reclassification</h4>
          <p className="mn-agent-workspace__description">
            Review the Agent’s assigned class, what that class currently permits, and the exact
            effect of moving the Agent to another class.
          </p>
        </div>
      </div>
      <div className="agent-governance__fact">
        <span>Current assigned class</span>
        <strong>
          {currentClass
            ? `${currentClass.name} (${currentClass.code})`
            : readiness?.currentClass
              ? `${readiness.currentClass.name} (${readiness.currentClass.code})`
              : currentClassId || 'Unassigned'}
        </strong>
      </div>

      {/* Readiness — what the LIVE gate says right now, service by service. */}
      {readiness ? (
        <div className="agent-governance__fact" data-testid="agent-class-readiness">
          <span>Operating readiness</span>
          <div>
            {readiness.canOperate ? (
              <strong>All {readiness.allowedServices.length} Agent services are permitted.</strong>
            ) : (
              <strong>
                {readiness.deniedServices.length} service
                {readiness.deniedServices.length === 1 ? '' : 's'} denied
                {readiness.blockedBy ? ` — ${readiness.blockedBy}` : ''}
              </strong>
            )}
            <ul className="agent-governance__list">
              {readiness.allowedServices.map((service) => (
                <li key={`allow-${service}`} data-testid={`agent-class-allowed-${service}`}>
                  <code>{service}</code> — permitted
                </li>
              ))}
              {readiness.deniedServices.map((denial) => (
                <li
                  key={`deny-${denial.service}`}
                  data-testid={`agent-class-denied-${denial.service}`}
                >
                  <code>{denial.service}</code> — {describeCapabilityReason(denial.reason)} (
                  <code>{denial.reason}</code>)
                </li>
              ))}
            </ul>
            <p className="mn-agent-workspace__description">
              Evaluated {new Date(readiness.evaluatedAt).toLocaleString()} against the same gate
              that authorizes live Agent operations. Reading this did not attempt any operation.
            </p>
            {/*
              Configuration the class still needs. Kept separate from the permitted/denied service
              list above: a service can be PERMITTED and still have no limit profile or no fee rule,
              and conflating the two would let an operator read "permitted" as "configured".
            */}
            {readiness.missingConfiguration && readiness.missingConfiguration.length > 0 ? (
              <div data-testid="agent-class-missing-configuration">
                <strong>Configuration this class still needs</strong>
                <ul className="agent-governance__list">
                  {readiness.missingConfiguration.map((gap) => (
                    <li key={gap.code} data-testid={`agent-class-missing-${gap.code}`}>
                      <strong>{gap.surface}</strong> — {gap.detail}
                    </li>
                  ))}
                </ul>
                <p className="mn-agent-workspace__description">
                  Missing configuration does not block a class switch. It does mean some operations
                  would run with undefined limits or charges rather than generous ones.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!onReclassify ? (
        <div>
          <div
            className="agent-governance__boundary"
            role="note"
            data-testid="agent-reclassify-dependency"
          >
            <strong>Policy-Blocked Capability:</strong> Governed reclassification (
            <code>POST /internal/agents/:id/class</code>) is not enabled in this console session.
            While <code>agent.manage_classes</code> governs the class catalogue, an active Agent
            needs that same function to move between classes.
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
        <div className="agent-governance__boundary">
          Reclassification requires <code>agent.manage_classes</code>.
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="mn-agent-workspace__controls agent-governance__form"
        >
          <label className="mn-agent-workspace__field">
            Target active class
            <select
              aria-label="Target Agent class"
              value={targetClassId}
              onChange={(e) => {
                setTargetClassId(e.target.value);
                setAcknowledged(false);
                setError('');
                onPreviewTargetClass?.(e.target.value);
              }}
              className="mn-agent-workspace__input"
              disabled={busy}
            >
              <option value="">Select active class…</option>
              {activeChoices.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name} ({cls.code}){cls.id === currentClassId ? ' — current' : ''}
                </option>
              ))}
            </select>
          </label>

          {/* Impact preview: read-only, server-computed, and explicit about what it did NOT do. */}
          {impactPreviewLoading ? (
            <div className="agent-governance__state" role="status">
              Reading the impact of this change…
            </div>
          ) : null}
          {impactPreviewError ? (
            <div
              className="agent-governance__feedback agent-governance__feedback--error"
              role="alert"
            >
              {impactPreviewError}
            </div>
          ) : null}
          {impactPreview ? (
            <div className="agent-governance__boundary" data-testid="agent-class-impact-preview">
              <strong>Impact preview (read-only):</strong> moving this Agent to{' '}
              <code>{impactPreview.targetClass.code}</code>
              {impactPreview.canSwitch ? '' : ' is blocked'}.
              {impactPreview.blockingReasons.length > 0 ? (
                <ul className="agent-governance__list">
                  {impactPreview.blockingReasons.map((block) => (
                    <li key={block} data-testid={`agent-class-blocked-${block}`}>
                      {describeCapabilityReason(block)} (<code>{block}</code>)
                    </li>
                  ))}
                </ul>
              ) : null}
              {impactPreview.gains.length > 0 ? (
                <div>
                  <strong>Would permit:</strong>{' '}
                  {impactPreview.gains.map((gain) => gain.service).join(', ')}
                </div>
              ) : null}
              {impactPreview.losses.length > 0 ? (
                <div data-testid="agent-class-impact-losses">
                  <strong>Would WITHDRAW:</strong>{' '}
                  {impactPreview.losses.map((loss) => loss.service).join(', ')}
                </div>
              ) : null}
              {impactPreview.gains.length === 0 && impactPreview.losses.length === 0 ? (
                <div>No service entitlement changes; only the recorded class would differ.</div>
              ) : null}
              {impactPreview.warnings.map((warning) => (
                <p key={warning} className="mn-agent-workspace__description">
                  {warning}
                </p>
              ))}
              <p className="mn-agent-workspace__description">
                Nothing was written and no financial mutation occurred while producing this preview.
              </p>
            </div>
          ) : null}

          {needsAcknowledgement ? (
            <label className="mn-agent-workspace__field agent-governance__acknowledgement">
              <input
                type="checkbox"
                aria-label="Acknowledge withdrawn services"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={busy}
              />{' '}
              I understand {withdrawalCount} service{withdrawalCount === 1 ? '' : 's'} will stop
              being permitted for this Agent immediately.
            </label>
          ) : null}

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
            disabled={busy || !canSubmit}
          >
            {busy ? 'Updating…' : 'Reclassify Agent'}
          </button>
          {agentVersion !== undefined ? (
            <p className="mn-agent-workspace__description">
              Submitted against Agent version {agentVersion}; a change made by another operator is
              refused rather than overwritten.
            </p>
          ) : null}
          {error ? (
            <div
              className="agent-governance__feedback agent-governance__feedback--error"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          {message ? (
            <div
              className="agent-governance__feedback agent-governance__feedback--success"
              role="status"
            >
              {message}
            </div>
          ) : null}
        </form>
      )}
    </section>
  );
};
