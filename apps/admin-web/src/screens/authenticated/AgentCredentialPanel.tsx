import '../../components/agent-workspaces.css';
import React, { useEffect, useRef, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { revokeAgentActiveSessions } from '../../services/ordinary-agent-admin-api';
import { useAuthStore } from '../../store/auth-store';

interface TemporaryCredential {
  agentId: string;
  credentialId: string;
  temporaryPassword: string;
  rotationRequired: boolean;
  passwordExpiresAt: string | null;
  deliveryNotice: string;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

interface AgentCredentialPanelProps {
  agentId: string;
  agentStatus: string;
  canManage: boolean;
  onGuardChange?: (guarded: boolean, busy: boolean) => void;
}

export const AgentCredentialPanel: React.FC<AgentCredentialPanelProps> = (props) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([props.agentId, sessionId, principal?.principalId, principal?.sessionId,
    principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel,
    principal?.customerAccess, principal?.readOnlyPrincipal, props.canManage]);
  return <AgentCredentialWorkspace key={key} {...props} canManage={props.canManage && !principal?.readOnlyPrincipal} />;
};

const AgentCredentialWorkspace: React.FC<AgentCredentialPanelProps> = ({ agentId, agentStatus, canManage, onGuardChange }) => {
  const [credential, setCredential] = useState<TemporaryCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [boundaryNote, setBoundaryNote] = useState('');
  const [initialIssued, setInitialIssued] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const context = useRef({ agentId, canManage });
  context.current = { agentId, canManage };

  useEffect(() => {
    setCredential(null);
    setInitialIssued(false);
    setCopied(false);
    setBoundaryNote('');
    setError('');
    setMessage('');
    setBusy(false);
    setRevokeBusy(false);
    return () => { generation.current += 1; };
  }, [agentId, canManage]);

  useEffect(() => { onGuardChange?.(reviewRequired || busy || revokeBusy || Boolean(credential), busy || revokeBusy); }, [onGuardChange, reviewRequired, busy, revokeBusy, credential]);
  useEffect(() => () => onGuardChange?.(false, false), [onGuardChange]);

  useEffect(() => {
    if (!reviewRequired && !busy && !revokeBusy && !credential) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [reviewRequired, busy, revokeBusy, credential]);

  if (!canManage) return null;

  const anyBusy = busy || revokeBusy;

  const issue = async (reissue: boolean) => {
    if (anyBusy || inFlight.current || reviewRequired || agentStatus !== 'ACTIVE') return;
    if (
      reissue &&
      !window.confirm(
        'Reissue a temporary credential? The previous credential will be revoked and all sessions using it will be invalidated.',
      )
    ) {
      return;
    }

    inFlight.current = true;
    const current = ++generation.current;
    const valid = () => generation.current === current && context.current.agentId === agentId && context.current.canManage;
    setBusy(true);
    setError('');
    setMessage('');
    setBoundaryNote('');
    setCopied(false);
    setCredential(null);
    try {
      const endpoint = `/internal/admin/agents/${encodeURIComponent(agentId)}/credentials${reissue ? '/reissue' : ''}`;
      const result = await ApiClient.post<TemporaryCredential>(endpoint);
      if (!valid()) return;
      if (!result || result.agentId !== agentId || typeof result.credentialId !== 'string' || !result.credentialId.trim() ||
          typeof result.temporaryPassword !== 'string' || !result.temporaryPassword || result.rotationRequired !== true ||
          (result.passwordExpiresAt !== null && (typeof result.passwordExpiresAt !== 'string' || !Number.isFinite(Date.parse(result.passwordExpiresAt)))) ||
          typeof result.deliveryNotice !== 'string' || !result.deliveryNotice.trim()) {
        setReviewRequired(true);
        setError('Credential response could not be confirmed. The result may be uncertain; check the Agent access state before retrying.');
        return;
      }
      setCredential(result);
      setInitialIssued(true);
      setMessage(
        reissue
          ? 'Credential reissued. The previous credential and its active sessions were invalidated.'
          : 'Initial temporary credential issued.',
      );
    } catch (requestError) {
      if (!valid()) return;
      const status = statusOf(requestError);
      if (status === 400 || status === 403 || status === 404 || status === 409) {
        if (status === 409) setReviewRequired(true);
        setError(`Credential request was rejected (HTTP ${status}). Check the Agent status and existing credential before choosing an action.`);
      } else {
        setReviewRequired(true);
        setError('Credential request outcome may be uncertain. Check the Agent access state before retrying.');
      }
    } finally {
      if (valid()) { inFlight.current = false; setBusy(false); }
    }
  };

  const invalidateSessions = async () => {
    if (anyBusy || inFlight.current || reviewRequired) return;
    if (
      !window.confirm(
        'Invalidate all active sessions for this Agent without rotating their password?',
      )
    ) {
      return;
    }

    inFlight.current = true;
    const current = ++generation.current;
    const valid = () => generation.current === current && context.current.agentId === agentId && context.current.canManage;
    setRevokeBusy(true);
    setError('');
    setMessage('');
    setBoundaryNote('');
    try {
      const outcome = await revokeAgentActiveSessions(agentId);
      if (!valid()) return;
      if (outcome.status === 'BLOCKED') {
        setBoundaryNote(outcome.message);
        return;
      }
      const count = outcome.data.revokedCount;
      if (outcome.data.agentId !== agentId || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        setReviewRequired(true);
        setError('Session revocation response could not be confirmed. Check the Agent access state before retrying.');
        return;
      }
      setMessage(`Active Agent sessions invalidated (${count} session${count === 1 ? '' : 's'} revoked).`);
    } catch (requestError) {
      if (!valid()) return;
      const rawMessage =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to invalidate active Agent sessions.';
      setReviewRequired(true);
      setError(`${rawMessage} Session revocation may be unconfirmed; check the Agent access state before retrying.`);
    } finally {
      if (valid()) { inFlight.current = false; setRevokeBusy(false); }
    }
  };

  const copySecret = async () => {
    if (!credential?.temporaryPassword) return;
    try {
      if (navigator?.clipboard?.writeText) {
        const copiedAgent = agentId;
        await navigator.clipboard.writeText(credential.temporaryPassword);
        if (context.current.agentId === copiedAgent && context.current.canManage) setCopied(true);
      }
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="mn-agent-workspace mn-agent-workspace--stack" aria-label="Agent credential and session controls">
      <h4 className="mn-agent-workspace__title">Credential &amp; session security</h4>
      <p className="mn-agent-workspace__description">
        Temporary credentials are returned once, expire after 72 hours, and must be rotated at first login. Reissue revokes the previous credential and its active sessions. Deliver the one-time value to the Agent out-of-band; it is not stored by this screen.
      </p>
      {agentStatus !== 'ACTIVE' ? (
        <div className="mn-agent-workspace__description">Credential issuance is available only for an ACTIVE Agent.</div>
      ) : (
        <div className="mn-agent-workspace__actions">
          <button
            type="button"
            className="mn-agent-workspace__button"
            disabled={anyBusy || reviewRequired || initialIssued}
            onClick={() => void issue(false)}
          >
            {busy ? 'Working…' : initialIssued ? 'Initial credential issued' : 'Issue initial credential'}
          </button>
          <button
            type="button"
            className="mn-agent-workspace__button"
            disabled={anyBusy || reviewRequired}
            onClick={() => void issue(true)}
          >
            Reissue + invalidate sessions
          </button>
        </div>
      )}

      <div className="mn-agent-workspace__controls" aria-label="Standalone session revocation">
        <p className="mn-agent-workspace__description">The server records an administrative revocation; this endpoint does not record a custom reason.</p>
        <button
          type="button"
          className="mn-agent-workspace__button"
          disabled={anyBusy || reviewRequired}
          onClick={() => void invalidateSessions()}
        >
          {revokeBusy ? 'Invalidating…' : 'Invalidate active sessions'}
        </button>
      </div>

      {reviewRequired && <div style={styles.boundary} role="status"><strong>Independent review required.</strong> The action may have completed, and a one-time password may be unrecoverable. This panel has no credential or session status read; inspect the authoritative Agent access records and audit trail elsewhere before another action. This local lock is lost on leaving or session change; review cannot exclude a late commit. <button type="button" className="mn-agent-workspace__button" onClick={() => { setReviewRequired(false); setError(''); }}>I reviewed Agent access and audit history</button></div>}
      {boundaryNote && (
        <div
          style={styles.boundary}
          role="note"
          data-testid="agent-session-revoke-arena1-boundary"
        >
          <strong>Session revocation unavailable:</strong> {boundaryNote}
        </div>
      )}
      {error && <div style={styles.error} role="alert">{error}</div>}
      {message && <div style={styles.success} role="status">{message}</div>}
      {credential && credential.agentId === agentId && (
        <div style={styles.secretCard} aria-label="One-time temporary credential">
          <div>
            <strong>One-time temporary password</strong> (Agent <code>{credential.agentId}</code>)
          </div>
          <code style={styles.secret} data-testid="temporary-agent-password">
            {credential.temporaryPassword}
          </code>
          <div>
            <strong>Credential ID:</strong> <code>{credential.credentialId}</code> ·{' '}
            <strong>Rotation required:</strong> {credential.rotationRequired ? 'Yes (first login)' : 'No'}
          </div>
          <div>
            <strong>Expires:</strong>{' '}
            {credential.passwordExpiresAt
              ? new Date(credential.passwordExpiresAt).toLocaleString()
              : 'Not provided'}
          </div>
          <div>{credential.deliveryNotice}</div>
          <div className="mn-agent-workspace__actions">
            {typeof navigator !== 'undefined' && navigator.clipboard && (
              <button type="button" className="mn-agent-workspace__button" onClick={() => void copySecret()}>
                {copied ? 'Copied' : 'Copy one-time value'}
              </button>
            )}
            <button
              type="button"
              className="mn-agent-workspace__button"
              onClick={() => {
                setCredential(null);
                setCopied(false);
              }}
            >
              Hide one-time value
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: { padding: 12, border: '1px solid #CBD5E1', borderRadius: 7, background: 'var(--mn-surface-canvas, #f5f8f6)', display: 'flex', flexDirection: 'column', gap: 10 },
  title: { margin: 0, color: 'var(--mn-nav-surface-deep, #082f23)', fontSize: 14 },
  note: { margin: 0, color: 'var(--mn-text-secondary, #52655f)', fontSize: 12, lineHeight: 1.5 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  sessionRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingTop: 6, borderTop: '1px dashed #CBD5E1' },
  reasonInput: { padding: '6px 9px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', fontSize: 12, minWidth: 210 },
  button: { padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', color: 'var(--mn-text-primary, #132b25)', cursor: 'pointer' },
  reissueButton: { padding: '7px 10px', border: '1px solid #FDBA74', borderRadius: 5, background: '#FFF7ED', color: '#9A3412', cursor: 'pointer' },
  revokeButton: { padding: '7px 10px', border: '1px solid #FCA5A5', borderRadius: 5, background: '#FEF2F2', color: '#991B1B', cursor: 'pointer' },
  boundary: { padding: 9, border: '1px solid #FCD34D', borderRadius: 5, background: '#FFFBEB', color: '#78350F', fontSize: 12 },
  error: { padding: 9, border: '1px solid #FCA5A5', borderRadius: 5, background: '#FEF2F2', color: '#991B1B', fontSize: 12 },
  success: { padding: 9, border: '1px solid #6EE7B7', borderRadius: 5, background: '#ECFDF5', color: '#065F46', fontSize: 12 },
  secretCard: { display: 'flex', flexDirection: 'column', gap: 7, padding: 12, border: '1px solid #FCD34D', borderRadius: 6, background: '#FFFBEB', color: '#78350F', fontSize: 12, overflowWrap: 'anywhere' },
  secret: { display: 'block', padding: 9, borderRadius: 5, background: '#fff', fontSize: 15, userSelect: 'all' },
};
