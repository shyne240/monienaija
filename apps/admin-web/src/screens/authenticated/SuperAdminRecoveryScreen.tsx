import './operational-surfaces.css';
import './super-admin-recovery.css';
import React, { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { DataRecord, StructuredKeyValueList } from '../../components/StructuredData';
import { Alert, Button, PageHeader } from '../../design-system/primitives';

/** A transport success without a recognizable receipt does not prove recovery occurred. */
function isRecoveryReceipt(value: unknown): value is DataRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as DataRecord;
  return receipt.operation === 'REVOKE_SUPER_ADMIN'
    && typeof receipt.recoveryReference === 'string' && receipt.recoveryReference.trim().length > 0
    && typeof receipt.targetPrincipalId === 'string' && receipt.targetPrincipalId.trim().length > 0
    && typeof receipt.auditReference === 'string' && receipt.auditReference.trim().length > 0
    && typeof receipt.revokedSessionCount === 'number' && Number.isSafeInteger(receipt.revokedSessionCount) && receipt.revokedSessionCount >= 0;
}

export const SuperAdminRecoveryScreen: React.FC = () => {
  const { principal } = useAuthStore();
  const canView = principal?.scopes.includes('workforce.super_admin.recover') ?? false;
  const principalId = principal?.principalId ?? '';
  return <RecoveryWorkspace key={JSON.stringify([principalId, principal?.sessionId, principal?.type, principal?.assuranceLevel, principal?.roles, canView])} principalId={principalId} canView={canView} roles={principal?.roles ?? []} />;
};

const RecoveryWorkspace: React.FC<{ principalId: string; canView: boolean; roles: string[] }> = ({ principalId, canView, roles }) => {
  const [statement, setStatement] = useState('');
  const [result, setResult] = useState<DataRecord | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const access = useRef({ principalId, canView });
  access.current = { principalId, canView };

  useEffect(() => {
    setStatement(''); setResult(null); setError(''); setLoading(false);
    return () => { generation.current += 1; };
  }, [principalId, canView]);

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canView || loading || !statement.trim()) return;
    const request = ++generation.current;
    const valid = () => request === generation.current && access.current.canView && access.current.principalId === principalId;
    const submittedStatement = statement;
    setStatement(''); setError(''); setResult(null); setLoading(true);
    try {
      const res = await ApiClient.post<unknown>('/internal/a2/workforce/super-admin/recovery', { statement: submittedStatement });
      if (!valid()) return;
      if (!isRecoveryReceipt(res)) {
        setError('The server response did not include a recognizable recovery receipt. The outcome is unconfirmed; check the audit trail before attempting again.');
        return;
      }
      setResult(res);
    } catch (err: any) {
      if (valid()) {
        const detail = typeof err?.message === 'string' ? err.message.split(submittedStatement).join('[redacted]').replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[redacted]') : 'Recovery service unavailable.';
        setError(`The request did not return a confirmed recovery receipt. Check the audit trail before attempting again. ${detail}`);
      }
    } finally { if (valid()) setLoading(false); }
  };

  if (!canView) return <div className="mn-operational mn-recovery"><Alert tone="warning" title="Access restricted">Requires <code>workforce.super_admin.recover</code> (ADMINISTRATOR only, RS256). Roles: {roles.join(', ') || 'None'}</Alert></div>;

  return (
    <main className="mn-operational mn-recovery">
      <PageHeader eyebrow="Workforce governance" title="Super-Admin recovery" description="Consume an externally signed recovery statement to revoke a compromised SUPER_ADMIN assignment and its sessions." />
      <Alert tone="warning" title="Controlled recovery">
        This action requires an ADMINISTRATOR with the recovery function and a valid RS256-signed <code>A2RecoveryStatementV1</code>. The signed statement—not the operator alone—authorizes the outcome.
      </Alert>
      <section className="mn-recovery__card" aria-labelledby="recovery-form-title">
        <h2 id="recovery-form-title">Submit recovery statement</h2>
        <p id="recovery-guidance">Paste the externally signed compact statement. Treat it as sensitive; it is cleared from this form when submitted.</p>
        <form onSubmit={handleRecover} className="mn-recovery__form">
          <label htmlFor="recovery-statement">Recovery statement (JWT)</label>
          <textarea id="recovery-statement" value={statement} onChange={e => setStatement(e.target.value)} placeholder="Paste RS256-signed recovery statement…" rows={6} autoComplete="off" spellCheck={false} aria-describedby="recovery-guidance" disabled={loading} />
          <Button type="submit" variant="primary" disabled={loading || !statement.trim()}>{loading ? 'Executing…' : 'Execute Recovery'}</Button>
          {loading && <p role="status" className="mn-recovery__pending">Submitting the recovery request. Do not submit the statement again while its outcome is pending.</p>}
        </form>
      </section>
      {error && <Alert tone="danger" title="Recovery outcome not confirmed">{error}</Alert>}
      {result && <section className="mn-recovery__receipt" role="status" aria-labelledby="recovery-result-title"><h2 id="recovery-result-title">Recovery executed</h2><p>Retain the recovery and audit references for verification.</p><StructuredKeyValueList data={result} /></section>}
      <aside className="mn-recovery__note">The recovery service separately verifies the statement and ADMINISTRATOR authority. SUPER_ADMIN cannot perform its own recovery. Use the approved recovery runbook and audit trail for the surrounding ceremony.</aside>
    </main>
  );
};
