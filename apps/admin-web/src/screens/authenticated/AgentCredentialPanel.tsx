import React, { useState } from 'react';

import { ApiClient } from '../../services/api-client';

interface TemporaryCredential {
  agentId: string;
  credentialId: string;
  temporaryPassword: string;
  rotationRequired: boolean;
  passwordExpiresAt: string | null;
  deliveryNotice: string;
}

export const AgentCredentialPanel: React.FC<{
  agentId: string;
  agentStatus: string;
  canManage: boolean;
}> = ({ agentId, agentStatus, canManage }) => {
  const [credential, setCredential] = useState<TemporaryCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [initialIssued, setInitialIssued] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  if (!canManage) return null;

  const issue = async (reissue: boolean) => {
    if (busy || agentStatus !== 'ACTIVE') return;
    if (reissue && !window.confirm(
      'Reissue a temporary credential? The previous credential will be revoked and all sessions using it will be invalidated.',
    )) return;

    setBusy(true);
    setError('');
    setMessage('');
    setCredential(null);
    try {
      const endpoint = `/internal/admin/agents/${encodeURIComponent(agentId)}/credentials${reissue ? '/reissue' : ''}`;
      const result = await ApiClient.post<TemporaryCredential>(endpoint);
      setCredential(result);
      if (!reissue) setInitialIssued(true);
      setMessage(reissue
        ? 'Credential reissued. The previous credential and its active sessions were invalidated.'
        : 'Initial temporary credential issued.');
    } catch (requestError) {
      setError(
        `${requestError instanceof Error ? requestError.message : 'Credential request failed.'} ` +
          'The result may be uncertain. Do not reissue again until the Agent access state is checked.',
      );
    } finally {
      setBusy(false);
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
          <button type="button" style={styles.button} disabled={busy} onClick={() => void issue(false)}>
            {busy ? 'Working…' : 'Issue initial credential'}
          </button>
          <button type="button" style={styles.reissueButton} disabled={busy} onClick={() => void issue(true)}>
            Reissue + invalidate sessions
          </button>
        </div>
      )}
      {error && <div style={styles.error} role="alert">{error}</div>}
      {message && <div style={styles.success} role="status">{message}</div>}
      {credential && (
        <div style={styles.secretCard} aria-label="One-time temporary credential">
          <div><strong>One-time temporary password</strong></div>
          <code style={styles.secret} data-testid="temporary-agent-password">{credential.temporaryPassword}</code>
          <div><strong>Expires:</strong> {credential.passwordExpiresAt ? new Date(credential.passwordExpiresAt).toLocaleString() : 'Not provided'}</div>
          <div>{credential.deliveryNotice}</div>
          <button type="button" style={styles.button} onClick={() => setCredential(null)}>Hide one-time value</button>
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
  button: { padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#fff', color: '#1E293B', cursor: 'pointer' },
  reissueButton: { padding: '7px 10px', border: '1px solid #FDBA74', borderRadius: 5, background: '#FFF7ED', color: '#9A3412', cursor: 'pointer' },
  error: { padding: 9, border: '1px solid #FCA5A5', borderRadius: 5, background: '#FEF2F2', color: '#991B1B', fontSize: 12 },
  success: { padding: 9, border: '1px solid #6EE7B7', borderRadius: 5, background: '#ECFDF5', color: '#065F46', fontSize: 12 },
  secretCard: { display: 'flex', flexDirection: 'column', gap: 7, padding: 12, border: '1px solid #FCD34D', borderRadius: 6, background: '#FFFBEB', color: '#78350F', fontSize: 12, overflowWrap: 'anywhere' },
  secret: { display: 'block', padding: 9, borderRadius: 5, background: '#fff', fontSize: 15, userSelect: 'all' },
};
