import React, { useEffect, useState } from 'react';

import { ApiClient } from '../../services/api-client';
import { revokeAgentActiveSessions } from '../../services/ordinary-agent-admin-api';

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

export const AgentCredentialPanel: React.FC<{
  agentId: string;
  agentStatus: string;
  canManage: boolean;
}> = ({ agentId, agentStatus, canManage }) => {
  const [credential, setCredential] = useState<TemporaryCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [boundaryNote, setBoundaryNote] = useState('');
  const [initialIssued, setInitialIssued] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setCredential(null);
    setInitialIssued(false);
    setCopied(false);
    setRevokeReason('');
    setBoundaryNote('');
    setError('');
    setMessage('');
    return () => {
      setCredential(null);
    };
  }, [agentId]);

  if (!canManage) return null;

  const anyBusy = busy || revokeBusy;

  const issue = async (reissue: boolean) => {
    if (anyBusy || agentStatus !== 'ACTIVE') return;
    if (
      reissue &&
      !window.confirm(
        'Reissue a temporary credential? The previous credential will be revoked and all sessions using it will be invalidated.',
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    setBoundaryNote('');
    setCopied(false);
    setCredential(null);
    try {
      const endpoint = `/internal/admin/agents/${encodeURIComponent(agentId)}/credentials${reissue ? '/reissue' : ''}`;
      const result = await ApiClient.post<TemporaryCredential>(endpoint);
      setCredential(result);
      setInitialIssued(true);
      setMessage(
        reissue
          ? 'Credential reissued. The previous credential and its active sessions were invalidated.'
          : 'Initial temporary credential issued.',
      );
    } catch (requestError) {
      const status = statusOf(requestError);
      const rawMessage =
        requestError instanceof Error ? requestError.message : 'Credential request failed.';
      if (!reissue && status === 409) {
        setInitialIssued(true);
        setError(
          `${rawMessage} Use "Reissue + invalidate sessions" if the Agent requires a replacement temporary password.`,
        );
      } else if (status === 400 || status === 403 || status === 404 || status === 409) {
        setError(rawMessage);
      } else {
        setError(
          `${rawMessage} The result may be uncertain. Do not reissue again until the Agent access state is checked.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const invalidateSessions = async () => {
    if (anyBusy) return;
    if (
      !window.confirm(
        'Invalidate all active sessions for this Agent without rotating their password?',
      )
    ) {
      return;
    }

    setRevokeBusy(true);
    setError('');
    setMessage('');
    setBoundaryNote('');
    try {
      const outcome = await revokeAgentActiveSessions(agentId, revokeReason);
      if (outcome.status === 'BLOCKED') {
        setBoundaryNote(outcome.message);
        return;
      }
      setRevokeReason('');
      const count = outcome.data.revokedCount;
      setMessage(
        typeof count === 'number'
          ? `Active Agent sessions invalidated (${count} session${count === 1 ? '' : 's'} revoked).`
          : 'Active Agent sessions invalidated.',
      );
    } catch (requestError) {
      const rawMessage =
        requestError instanceof Error
          ? requestError.message
          : 'Failed to invalidate active Agent sessions.';
      setError(rawMessage);
    } finally {
      setRevokeBusy(false);
    }
  };

  const copySecret = async () => {
    if (!credential?.temporaryPassword) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(credential.temporaryPassword);
        setCopied(true);
      }
    } catch {
      setCopied(false);
    }
  };

  return (
    <section style={styles.panel} aria-label="Agent credential and session controls">
      <h4 style={styles.title}>Credential &amp; session security</h4>
      <p style={styles.note}>
        Temporary credentials are returned once, expire after 72 hours, and must be rotated at first login. Reissue revokes the previous credential and its active sessions. Deliver the one-time value to the Agent out-of-band; it is not stored by this screen.
      </p>
      {agentStatus !== 'ACTIVE' ? (
        <div style={styles.note}>Credential issuance is available only for an ACTIVE Agent.</div>
      ) : (
        <div style={styles.actions}>
          <button
            type="button"
            style={styles.button}
            disabled={anyBusy || initialIssued}
            onClick={() => void issue(false)}
          >
            {busy ? 'Working…' : initialIssued ? 'Initial credential issued' : 'Issue initial credential'}
          </button>
          <button
            type="button"
            style={styles.reissueButton}
            disabled={anyBusy}
            onClick={() => void issue(true)}
          >
            Reissue + invalidate sessions
          </button>
        </div>
      )}

      <div style={styles.sessionRow} aria-label="Standalone session revocation">
        <input
          aria-label="Session revocation reason"
          placeholder="Revocation reason (optional)"
          value={revokeReason}
          onChange={(event) => setRevokeReason(event.target.value)}
          style={styles.reasonInput}
          disabled={anyBusy}
          maxLength={240}
        />
        <button
          type="button"
          style={styles.revokeButton}
          disabled={anyBusy}
          onClick={() => void invalidateSessions()}
        >
          {revokeBusy ? 'Invalidating…' : 'Invalidate active sessions'}
        </button>
      </div>

      {boundaryNote && (
        <div
          style={styles.boundary}
          role="note"
          data-testid="agent-session-revoke-arena1-boundary"
        >
          <strong>Cross-Arena Integration Boundary:</strong> {boundaryNote}
        </div>
      )}
      {error && <div style={styles.error} role="alert">{error}</div>}
      {message && <div style={styles.success} role="status">{message}</div>}
      {credential && (
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
          <div style={styles.actions}>
            {typeof navigator !== 'undefined' && navigator.clipboard && (
              <button type="button" style={styles.button} onClick={() => void copySecret()}>
                {copied ? 'Copied' : 'Copy one-time value'}
              </button>
            )}
            <button
              type="button"
              style={styles.button}
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
  panel: { padding: 12, border: '1px solid #CBD5E1', borderRadius: 7, background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: 10 },
  title: { margin: 0, color: '#032B14', fontSize: 14 },
  note: { margin: 0, color: '#475569', fontSize: 12, lineHeight: 1.5 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  sessionRow: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', paddingTop: 6, borderTop: '1px dashed #CBD5E1' },
  reasonInput: { padding: '6px 9px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', fontSize: 12, minWidth: 210 },
  button: { padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', color: '#1E293B', cursor: 'pointer' },
  reissueButton: { padding: '7px 10px', border: '1px solid #FDBA74', borderRadius: 5, background: '#FFF7ED', color: '#9A3412', cursor: 'pointer' },
  revokeButton: { padding: '7px 10px', border: '1px solid #FCA5A5', borderRadius: 5, background: '#FEF2F2', color: '#991B1B', cursor: 'pointer' },
  boundary: { padding: 9, border: '1px solid #FCD34D', borderRadius: 5, background: '#FFFBEB', color: '#78350F', fontSize: 12 },
  error: { padding: 9, border: '1px solid #FCA5A5', borderRadius: 5, background: '#FEF2F2', color: '#991B1B', fontSize: 12 },
  success: { padding: 9, border: '1px solid #6EE7B7', borderRadius: 5, background: '#ECFDF5', color: '#065F46', fontSize: 12 },
  secretCard: { display: 'flex', flexDirection: 'column', gap: 7, padding: 12, border: '1px solid #FCD34D', borderRadius: 6, background: '#FFFBEB', color: '#78350F', fontSize: 12, overflowWrap: 'anywhere' },
  secret: { display: 'block', padding: 9, borderRadius: 5, background: '#fff', fontSize: 15, userSelect: 'all' },
};
