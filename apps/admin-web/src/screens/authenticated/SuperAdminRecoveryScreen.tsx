import './operational-surfaces.css';
import './super-admin-recovery.css';
import React, { useEffect, useRef, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { useDialogFocus } from '../../utils/use-dialog-focus';
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


type RecoveryClaims = { targetPrincipalId: string; targetAssignmentReference: string; reason: string };
// The payload is displayed only as unverified request context. The server alone verifies the signature.
function decodeRecoveryClaims(compact: string): RecoveryClaims | null {
  try {
    const parts = compact.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const bytes = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[1].length % 4) % 4));
    const json = decodeURIComponent(Array.from(bytes, ch => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    const payload = JSON.parse(json);
    if (!payload || payload.operation !== 'REVOKE_SUPER_ADMIN' || typeof payload.targetPrincipalId !== 'string' || !payload.targetPrincipalId.trim() || typeof payload.targetAssignmentReference !== 'string' || !payload.targetAssignmentReference.trim() || typeof payload.reason !== 'string' || !payload.reason.trim()) return null;
    return {targetPrincipalId: payload.targetPrincipalId.trim(), targetAssignmentReference: payload.targetAssignmentReference.trim(), reason: payload.reason.trim()};
  } catch { return null; }
}

export const SuperAdminRecoveryScreen: React.FC<{onRecoveryGuardChange?: (guarded: boolean, busy: boolean) => void}> = ({onRecoveryGuardChange}) => {
  const { principal, sessionId } = useAuthStore();
  const canView = principal?.scopes.includes('workforce.super_admin.recover') ?? false;
  const principalId = principal?.principalId ?? '';
  const canExecute = Boolean(canView && principal?.roles.includes('ADMINISTRATOR') && principal.assuranceLevel === 'MFA' && !principal.readOnlyPrincipal);
  return <RecoveryWorkspace key={JSON.stringify([sessionId, principalId, principal?.sessionId, principal?.type, principal?.assuranceLevel, principal?.roles, principal?.scopes, principal?.customerAccess, principal?.readOnlyPrincipal, canView])} principalId={principalId} canView={canView} canExecute={canExecute} roles={principal?.roles ?? []} onRecoveryGuardChange={onRecoveryGuardChange} />;
};

const RecoveryWorkspace: React.FC<{ principalId: string; canView: boolean; canExecute: boolean; roles: string[]; onRecoveryGuardChange?: (guarded: boolean, busy: boolean) => void }> = ({ principalId, canView, canExecute, roles, onRecoveryGuardChange }) => {
  const [statement, setStatement] = useState('');
  const [result, setResult] = useState<DataRecord | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingClaims, setPendingClaims] = useState<RecoveryClaims | null>(null);
  const [uncertain, setUncertain] = useState<RecoveryClaims | null>(null);
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialogRef, Boolean(pendingClaims), () => { if (!inFlight.current) setPendingClaims(null); }, triggerRef);
  useEffect(() => { if (loading) dialogRef.current?.focus(); }, [loading]);
  const guarded = loading || Boolean(statement.trim()) || Boolean(pendingClaims) || Boolean(uncertain) || Boolean(result);
  useEffect(() => { onRecoveryGuardChange?.(guarded, loading); }, [onRecoveryGuardChange, guarded, loading]);
  useEffect(() => () => onRecoveryGuardChange?.(false, false), [onRecoveryGuardChange]);
  useEffect(() => {
    if (!guarded) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [guarded]);

  const generation = useRef(0);
  const access = useRef({ principalId, canView });
  access.current = { principalId, canView };

  useEffect(() => {
    setStatement(''); setResult(null); setError(''); setLoading(false);
    return () => { generation.current += 1; };
  }, [principalId, canView]);

  const reviewRecovery = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canExecute || loading || inFlight.current || pendingClaims || uncertain || result || !statement.trim()) return;
    const claims = decodeRecoveryClaims(statement.trim());
    if (!claims) { setError('The statement is not a recognizable recovery JWT. Check the approved runbook; no request was sent.'); return; }
    setError(''); setPendingClaims(claims);
  };

  const handleRecover = async () => {
    if (!canExecute || loading || inFlight.current || !pendingClaims || uncertain || result) return;
    const claims = pendingClaims;
    const request = ++generation.current;
    const valid = () => request === generation.current && access.current.canView && access.current.principalId === principalId;
    const submittedStatement = statement.trim();
    inFlight.current = true; setStatement(''); setError(''); setResult(null); setLoading(true);
    try {
      const res = await ApiClient.post<unknown>('/internal/a2/workforce/super-admin/recovery', { statement: submittedStatement });
      if (!valid()) return;
      if (!isRecoveryReceipt(res) || res.targetPrincipalId !== claims.targetPrincipalId || res.targetAssignmentReference !== claims.targetAssignmentReference || res.reason !== claims.reason || res.consumedBy !== principalId || typeof res.consumedAt !== 'string' || !Number.isFinite(Date.parse(res.consumedAt))) {
        setUncertain(claims); setError('The server response did not include a matching recovery receipt. The outcome is unconfirmed; check the audit trail before attempting again.');
        return;
      }
      setResult({ recoveryReference: res.recoveryReference, operation: res.operation, targetPrincipalId: res.targetPrincipalId, targetAssignmentReference: res.targetAssignmentReference, reason: res.reason, revokedSessionCount: res.revokedSessionCount, consumedBy: res.consumedBy, consumedAt: res.consumedAt, auditReference: res.auditReference });
    } catch (err: any) {
      if (valid()) {
        setUncertain(claims);
        const detail = typeof err?.message === 'string' ? err.message.split(submittedStatement).join('[redacted]').replace(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, '[redacted]') : 'Recovery service unavailable.';
        setError(`The request did not return a confirmed recovery receipt. Check the audit trail before attempting again. ${detail}`);
      }
    } finally { inFlight.current = false; if (valid()) { setLoading(false); setPendingClaims(null); } }
  };

  if (!canView) return <div className="mn-operational mn-recovery"><Alert tone="warning" title="Access restricted">Requires <code>workforce.super_admin.recover</code> (ADMINISTRATOR only, RS256). Roles: {roles.join(', ') || 'None'}</Alert></div>;

  return (
    <main className="mn-operational mn-recovery">
      <PageHeader eyebrow="Workforce governance" title="Super-Admin recovery" description="Consume an externally signed recovery statement to revoke a compromised SUPER_ADMIN assignment and its sessions." />
      <Alert tone="warning" title="Controlled recovery">
        This action requires an ADMINISTRATOR with the recovery function and a valid RS256-signed <code>A2RecoveryStatementV1</code>. The signed statement—not the operator alone—authorizes the outcome.
      </Alert>
      {!canExecute && <Alert tone="warning" title="Recovery action unavailable">An ADMINISTRATOR MFA session that is not read-only is required.</Alert>}
      {uncertain && <Alert tone="warning" title="Independent recovery review required">The request for {uncertain.targetPrincipalId} may have completed. Independently inspect authorized recovery, assignment, session and audit records. A fresh read cannot exclude a late commit; this local lock is lost on confirmed exit or session change. <button type="button" onClick={() => { setUncertain(null); setError(''); }}>I reviewed recovery and audit records</button></Alert>}
      <section className="mn-recovery__card" aria-labelledby="recovery-form-title">
        <h2 id="recovery-form-title">Submit recovery statement</h2>
        <p id="recovery-guidance">Paste the externally signed compact statement. Treat it as sensitive; it is cleared from this form when submitted.</p>
        <form onSubmit={reviewRecovery} className="mn-recovery__form">
          <label htmlFor="recovery-statement">Recovery statement (JWT)</label>
          <textarea id="recovery-statement" value={statement} onChange={e => setStatement(e.target.value)} placeholder="Paste RS256-signed recovery statement…" rows={6} autoComplete="off" spellCheck={false} aria-describedby="recovery-guidance" disabled={!canExecute || loading || Boolean(pendingClaims) || Boolean(uncertain) || Boolean(result)} />
          <Button ref={triggerRef} type="submit" variant="primary" disabled={!canExecute || loading || Boolean(pendingClaims) || Boolean(uncertain) || Boolean(result) || !statement.trim()}>{loading ? 'Executing…' : 'Execute Recovery'}</Button>
          {loading && <p role="status" className="mn-recovery__pending">Submitting the recovery request. Do not submit the statement again while its outcome is pending.</p>}
        </form>
      </section>
      {error && <Alert tone="danger" title={uncertain ? 'Recovery outcome not confirmed' : 'Statement needs correction'}>{error}</Alert>}
      {result && <section className="mn-recovery__receipt" role="status" aria-labelledby="recovery-result-title"><h2 id="recovery-result-title">Recovery executed</h2><p>Retain the recovery and audit references for verification.</p><StructuredKeyValueList data={result} /><button type="button" onClick={() => { if (window.confirm('Dismiss this recovery receipt after retaining its references?')) setResult(null); }}>Dismiss recovery receipt</button></section>}
      {pendingClaims && <div className="cm-modal-backdrop"><section ref={dialogRef} tabIndex={-1} className="cm-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-confirm-title"><h2 id="recovery-confirm-title">Confirm recovery request?</h2><p>Unverified statement claims (the server must verify the signature): target <code>{pendingClaims.targetPrincipalId}</code>, assignment <code>{pendingClaims.targetAssignmentReference}</code>.</p><p>Reason: {pendingClaims.reason}</p><div className="cm-actions-row"><button type="button" disabled={loading} onClick={() => setPendingClaims(null)}>Keep editing</button><button type="button" disabled={loading} onClick={() => void handleRecover()}>{loading ? 'Executing…' : 'Confirm recovery'}</button></div></section></div>}
      <aside className="mn-recovery__note">The recovery service separately verifies the statement and ADMINISTRATOR authority. SUPER_ADMIN cannot perform its own recovery. Use the approved recovery runbook and audit trail for the surrounding ceremony.</aside>
    </main>
  );
};
