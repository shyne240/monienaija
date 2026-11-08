import './operational-surfaces.css';
import { Button, PageHeader } from '../../design-system/primitives';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './workforce-workspace.css';
import './approvals-redesign.css';
import { useDialogFocus } from '../../utils/use-dialog-focus';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { PendingFundingApprovalsQueue } from '../../components/PendingFundingApprovalsQueue';
import { AgentFundingPanel, SelectedFundingInboxTarget } from './AgentFundingPanel';

export const ApprovalsScreen: React.FC<{onApprovalGuardChange?: (guarded: boolean, busy: boolean) => void}> = ({onApprovalGuardChange}) => {
  const { principal, sessionId } = useAuthStore();
  const canApprove =
    principal?.roles.includes('FINANCE_CONTROLLER') === true &&
    (principal?.scopes.includes('privileged:approve') ?? false);
  const canReviewFunding =
    principal?.roles.includes('FINANCE_CONTROLLER') === true &&
    ((principal?.scopes.includes('agent.fund') ?? false) ||
      (principal?.scopes.includes('agent.defund') ?? false));
  const canAccessGlobalFundingInbox =
    ['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal?.type ?? '') &&
    principal?.roles.includes('FINANCE_CONTROLLER') === true &&
    !principal.roles.includes('SUPER_ADMIN') &&
    (principal?.scopes.includes('agent.fund') ?? false) &&
    (principal?.scopes.includes('agent.defund') ?? false) &&
    principal?.assuranceLevel === 'MFA';

  const key = JSON.stringify([sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.assuranceLevel, principal?.roles, principal?.scopes, principal?.readOnlyPrincipal, canApprove, canReviewFunding, canAccessGlobalFundingInbox]);
  return <ApprovalsWorkspace key={key} onApprovalGuardChange={onApprovalGuardChange} principal={principal} canApprove={canApprove} canReviewFunding={canReviewFunding} canAccessGlobalFundingInbox={canAccessGlobalFundingInbox} />;
};

const ApprovalsWorkspace: React.FC<{principal: ReturnType<typeof useAuthStore.getState>['principal']; canApprove: boolean; canReviewFunding: boolean; canAccessGlobalFundingInbox: boolean; onApprovalGuardChange?: (guarded: boolean, busy: boolean) => void}> = ({principal, canApprove, canReviewFunding, canAccessGlobalFundingInbox, onApprovalGuardChange}) => {
  const canWrite = !principal?.readOnlyPrincipal;
  const [unconfirmedIds, setUnconfirmedIds] = useState<Record<string, boolean>>({});
  const decisionGeneration = useRef(0);
  useEffect(() => () => { decisionGeneration.current += 1; }, []);
  const fundingInboxUnauthorizedReason = !canReviewFunding || canAccessGlobalFundingInbox
    ? null
    : principal?.roles.includes('SUPER_ADMIN')
      ? 'Decision 7 forbids SUPER_ADMIN from viewing or approving Agent funding requests.'
      : principal?.assuranceLevel !== 'MFA'
        ? 'MFA session assurance is required to access the global funding inbox.'
        : !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal?.type ?? '')
          ? 'An authorized workforce principal (OPERATOR, SERVICE, or PRIVILEGED) is required.'
          : 'Decision 7 requires both agent.fund and agent.defund scopes to read the global funding inbox.';

  const [fundingGuard, setFundingGuard] = useState(false);
  const [fundingBusy, setFundingBusy] = useState(false);
  const [fundingReview, setFundingReview] = useState(false);
  const reportFundingGuard = useCallback((guarded: boolean, busy: boolean, reviewRequired: boolean) => { setFundingGuard(guarded); setFundingBusy(busy); setFundingReview(reviewRequired); }, []);
  const mayChangeFundingTarget = () => !fundingBusy && (!fundingGuard || window.confirm('Change funding target? Unsaved entries and local review locks will be lost. An earlier request, decision or posting may have occurred; inspect funding, approval, ledger and audit records.'));
  const [selectedInboxTarget, setSelectedInboxTarget] = useState<SelectedFundingInboxTarget | null>(null);
  const [inboxRefreshTrigger, setInboxRefreshTrigger] = useState(0);
  const [approvalId, setApprovalId] = useState('');
  const [comment, setComment] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<'approve' | 'reject' | null>(null);
  const [decisionAction, setDecisionAction] = useState<'approve' | 'reject' | null>(null);
  const [pendingDecision, setPendingDecision] = useState<{action:'approve'|'reject'; id:string; comment:string} | null>(null);
  const [receiptId, setReceiptId] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  useDialogFocus(dialogRef, Boolean(pendingDecision), () => { if (!inFlight.current) setPendingDecision(null); }, pendingDecision?.action === 'reject' ? rejectRef : approveRef);
  useEffect(() => { if (isLoading) dialogRef.current?.focus(); }, [isLoading]);
  useEffect(() => { if (success && !pendingDecision) successRef.current?.focus(); }, [success, pendingDecision]);
  const decisionGuard = Object.keys(unconfirmedIds).length > 0 || isLoading || Boolean(pendingDecision) || Boolean(approvalId.trim() || comment.trim()) || fundingGuard;
  const decisionBusy = isLoading || fundingBusy;
  useEffect(() => { onApprovalGuardChange?.(decisionGuard, decisionBusy); }, [onApprovalGuardChange, decisionGuard, decisionBusy]);
  useEffect(() => () => onApprovalGuardChange?.(false, false), [onApprovalGuardChange]);
  useEffect(() => {
    if (!decisionGuard) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [decisionGuard]);

  const handleDecision = (action: 'approve' | 'reject') => {
    if (!canApprove || !canWrite || isLoading || fundingBusy || fundingReview || pendingDecision || inFlight.current || unconfirmedIds[approvalId.trim()]) return;
    setError(''); setSuccess(null); setReceiptId('');
    if (!approvalId.trim()) { setError('Approval ID is required'); return; }
    setPendingDecision({ action, id: approvalId.trim(), comment: comment.trim() });
  };

  const confirmDecision = async () => {
    if (!canApprove || !canWrite || isLoading || fundingBusy || fundingReview || inFlight.current || !pendingDecision || unconfirmedIds[pendingDecision.id]) return;
    const { action, id, comment: submittedComment } = pendingDecision;
    const request = ++decisionGeneration.current;
    inFlight.current = true; setIsLoading(true); setDecisionAction(action); setError(''); setSuccess(null);
    try {
      const response = await ApiClient.post<{approved?: boolean; reason?: string; approval?: {id?: string; status?: string}}>(`/internal/a2/workforce/approvals/${encodeURIComponent(id)}/${action}`, { comment: submittedComment || undefined });
      if (request !== decisionGeneration.current) return;
      const expected = action === 'approve' ? 'APPROVED' : 'REJECTED';
      if (!response || response.reason !== expected || response.approved !== (action === 'approve') || response.approval?.status !== expected || response.approval?.id !== id) {
        setUnconfirmedIds(current => ({ ...current, [id]: true }));
        setError(response?.reason ? `Decision not confirmed: ${response.reason}. Check the approval and audit trail before retrying.` : 'Decision outcome not confirmed. Check the approval and audit trail before retrying.'); return;
      }
      setSuccess(action); setReceiptId(id); setApprovalId(''); setComment('');
    } catch (err: any) {
      if (request === decisionGeneration.current) { setUnconfirmedIds(current => ({ ...current, [id]: true })); setError(`Decision outcome not confirmed. Check the approval and audit trail before retrying. ${err?.message || 'Service unavailable.'}`); }
    } finally {
      inFlight.current = false;
      if (request === decisionGeneration.current) { setIsLoading(false); setDecisionAction(null); setPendingDecision(null); }
    }
  };

  const handleApproveSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void handleDecision('approve');
  };

  if (!canApprove && !canReviewFunding) {
    return (
      <div className="mn-operational" style={styles.container} role="alert">
        <div style={styles.errorBox}>The configured checker role <code>FINANCE_CONTROLLER</code> and <code>privileged:approve</code> are required for these approval actions.</div>
      </div>
    );
  }

  return (
    <div className="mn-operational mn-approvals approvals-redesign" style={styles.container}>
      <PageHeader eyebrow="Workforce and governance" title="Privileged Approvals (Maker-Checker)" description="Review funding requests and record authorized checker decisions." />

      <div className="approvals-redesign__boundary" role="note"><strong>Separate checker workflows</strong><span>Funding requests have a dedicated inbox and decision flow. Other privileged approvals require a known approval ID.</span></div>
      <nav className="approvals-redesign__nav" aria-label="Approval workspace sections">
        {canReviewFunding && <a href="#funding-checker-workspace">Funding checker</a>}
        {canApprove && <a href="#generic-checker-workspace">Generic checker decision</a>}
      </nav>
      <div style={styles.gapWarning}>
        <span style={styles.gapTitle}>ℹ️ Approval Discovery Scope</span>
        <p style={styles.gapText}>
          Agent funding and defunding requests use the Global Funding Inbox when your session meets its access rules (<code>GET /internal/agents/funding-requests</code>). Generic non-funding workforce overrides require a known Approval ID because generic <code>GET /internal/a2/workforce/approvals</code> listing is not exposed.
        </p>
      </div>
      <div style={styles.fundingNote}>
        Agent funding requests use their dedicated rejection workflow so approval and request state change atomically. This generic rejection action intentionally rejects funding approval IDs; it does not replace that workflow.
      </div>
      <div style={styles.fundingNote} data-testid="notification-two-step-approval-note">
        <strong>Two-Step Notification Governance Note:</strong> Approving a governed notification template, trigger, or provider-configuration proposal ID here transitions its workforce approval to <code>APPROVED</code> (Step 1). Complete Step 2 execution in <strong>Notifications → Approvals &amp; Governance</strong> (<code>POST /internal/notifications/changes/:approvalId/execute</code>) or <strong>Provider Configuration</strong> so the approved proposal is applied.
      </div>

      {canReviewFunding && (
        <section id="funding-checker-workspace" className="approvals-redesign__panel" tabIndex={-1} aria-label="Funding checker workspace">
          <p className="approvals-redesign__eyebrow">AGENT FUNDING</p><h2>Funding checker workspace</h2><p className="approvals-redesign__intro">Review eligible requests and use the dedicated checker panel for funding decisions.</p>
          <PendingFundingApprovalsQueue
            canReviewFunding={canReviewFunding}
            canAccessGlobalInbox={canAccessGlobalFundingInbox}
            unauthorizedReason={fundingInboxUnauthorizedReason}
            refreshTrigger={inboxRefreshTrigger}
            activeRequestId={selectedInboxTarget?.requestId ?? null}
            onSelectRequest={(targetAgentId, idemKey, selection) => {
              if (!mayChangeFundingTarget()) return;
              setSelectedInboxTarget((prev) => ({
                agentId: targetAgentId,
                idempotencyKey: idemKey,
                requestId: selection?.requestId,
                revision: (prev?.revision ?? 0) + 1,
              }));
            }}
          />
          {selectedInboxTarget && (
            <div style={styles.fundingNote} data-testid="funding-inbox-selected-banner">
              Checker panel targeted to Agent <code>{selectedInboxTarget.agentId}</code>
              {selectedInboxTarget.requestId ? (
                <>
                  {' '}· Request <code>{selectedInboxTarget.requestId}</code>
                </>
              ) : null}
              .{' '}
              <button
                type="button"
                style={{
                  marginLeft: 8,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: '1px solid #93C5FD',
                  background: '#FFFFFF',
                  color: '#1E3A8A',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                }}
                onClick={() => { if (mayChangeFundingTarget()) setSelectedInboxTarget(null); }}
              >
                Clear target
              </button>
            </div>
          )}
          <AgentFundingPanel
            selectedInboxTarget={selectedInboxTarget}
            onFundingGuardChange={reportFundingGuard}
            externalMutationBlocked={isLoading || Boolean(pendingDecision) || Object.keys(unconfirmedIds).length > 0}
            onCheckerOutcome={() => setInboxRefreshTrigger((n) => n + 1)}
          />
        </section>
      )}

      {canApprove && <section id="generic-checker-workspace" className="approvals-redesign__panel approvals-redesign__generic" tabIndex={-1} aria-label="Generic checker decision">
      <p className="approvals-redesign__eyebrow">KNOWN APPROVAL ID</p><h2>Generic checker decision</h2><p className="approvals-redesign__intro">Review the pending action in an authorized record before deciding. A decision may require a separate execution step.</p>
      {!canWrite && <p role="note">This session is read-only. Checker decisions cannot be submitted.</p>}
      {fundingReview && <p role="alert">A funding outcome is unconfirmed. Complete independent funding review before using generic checker actions.</p>}
      {error && <div style={styles.errorBox} role="alert">{error}</div>}
      {Object.keys(unconfirmedIds).length > 0 && !unconfirmedIds[approvalId.trim()] && <div className="approvals-redesign__boundary" role="note"><strong>Unconfirmed decisions remain in this workspace.</strong><span>Return to an ID to review its outcome:</span>{Object.keys(unconfirmedIds).map(id => <button type="button" key={id} onClick={() => setApprovalId(id)}>{id}</button>)}</div>}
      {unconfirmedIds[approvalId.trim()] && <div className="approvals-redesign__boundary" role="status"><strong>Decision review required</strong><span>The decision may already have occurred. This screen has no generic approval read endpoint; inspect the authoritative approval and audit trail elsewhere before another action. This local lock is lost when leaving or changing session, and review cannot exclude a late commit.</span><button type="button" onClick={() => { setUnconfirmedIds(current => { const next = { ...current }; delete next[approvalId.trim()]; return next; }); setError(''); }}>I reviewed the approval and audit trail</button></div>}
      {success && <div ref={successRef} tabIndex={-1} style={styles.successBox} role="status"><span>{success === 'approve' ? 'Approval recorded. The underlying action may require a separate execution step.' : 'Approval decision recorded as rejected successfully.'}</span><div>Approval ID: <code>{receiptId}</code></div></div>}

      {canApprove && (
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Submit Checker Decision</h3>
        <form onSubmit={handleApproveSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label htmlFor="checker-approval-id" style={styles.label}>Pending Approval ID (UUID)</label>
            <input
              id="checker-approval-id"
              type="text"
              style={styles.input}
              placeholder="e.g. 5e6f7g8h-1234-..."
              value={approvalId}
              onChange={(e) => setApprovalId(e.target.value)}
              disabled={isLoading || Boolean(pendingDecision)}
            />
          </div>

          <div style={styles.inputGroup}>
            <label htmlFor="checker-comment" style={styles.label}>Audit Comment / Verification Notes (Optional)</label>
            <textarea
              id="checker-comment"
              style={styles.textarea}
              placeholder="Provide context or explanation for auditing..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={isLoading || Boolean(pendingDecision)}
            />
          </div>

          <div style={styles.decisionButtons}>
            <button ref={approveRef} type="submit" disabled={isLoading || fundingBusy || fundingReview || !canWrite || Boolean(pendingDecision) || !approvalId.trim() || Boolean(unconfirmedIds[approvalId.trim()])} style={styles.submitBtn}>
              {isLoading && decisionAction === 'approve' ? 'Approving…' : 'Sign & Approve Action'}
            </button>
            <button ref={rejectRef} type="button" disabled={isLoading || fundingBusy || fundingReview || !canWrite || Boolean(pendingDecision) || !approvalId.trim() || Boolean(unconfirmedIds[approvalId.trim()])} onClick={() => handleDecision('reject')} style={styles.rejectBtn}>
              {isLoading && decisionAction === 'reject' ? 'Rejecting…' : 'Reject Action'}
            </button>
          </div>
        </form>
      </div>
      )}
      </section>}
      {pendingDecision && <div className="approvals-redesign__overlay"><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="checker-review-title" aria-describedby="checker-review-description" tabIndex={-1} className="approvals-redesign__dialog">
        <p className="approvals-redesign__eyebrow">REVIEW CHECKER DECISION</p><h2 id="checker-review-title">Confirm {pendingDecision.action === 'approve' ? 'approval' : 'rejection'}</h2>
        <p id="checker-review-description">Confirm the known approval ID and decision. Funding rejections must use the dedicated funding workflow; an approval may require separate execution.</p>
        <dl><div><dt>Approval ID</dt><dd><code>{pendingDecision.id}</code></dd></div><div><dt>Decision</dt><dd>{pendingDecision.action === 'approve' ? 'Approve' : 'Reject'}</dd></div><div><dt>Audit comment</dt><dd>{pendingDecision.comment || 'Not provided'}</dd></div></dl>
        <div className="approvals-redesign__dialog-actions"><Button disabled={isLoading} onClick={() => setPendingDecision(null)}>Cancel</Button><Button variant={pendingDecision.action === 'reject' ? 'danger' : 'primary'} disabled={isLoading} onClick={() => void confirmDecision()}>{isLoading ? 'Recording decision…' : 'Confirm decision'}</Button></div>
      </section></div>}
    </div>
  );
};

const styles = {
  container: {
    padding: 'clamp(16px, 3vw, 32px)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: 'var(--mn-action-primary, #0b624a)',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--mn-text-secondary, #52655f)',
    margin: 0,
  },
  gapWarning: {
    backgroundColor: 'var(--mn-status-warning-bg, #fff3d9)',
    borderColor: 'var(--mn-status-warning, #8c5600)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '24px',
  },
  gapTitle: {
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#D97706',
    display: 'block',
    marginBottom: '6px',
  },
  gapText: {
    fontSize: '12px',
    color: '#78350F',
    margin: 0,
    lineHeight: '18px',
  },
  fundingNote: {
    backgroundColor: '#EFF6FF',
    border: '1px solid #BFDBFE',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '20px',
    color: '#1E3A8A',
    fontSize: '12px',
    lineHeight: '18px',
  },
  errorBox: {
    backgroundColor: 'var(--mn-status-danger-bg, #fdebe9)',
    color: 'var(--mn-status-danger, #b3261e)',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--mn-status-danger, #b3261e)',
  },
  successBox: {
    backgroundColor: 'var(--mn-status-success-bg, #e4f4ec)',
    color: 'var(--mn-status-success, #146348)',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--mn-status-success, #146348)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    maxWidth: '600px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: 'var(--mn-text-primary, #132b25)',
    margin: '0 0 20px 0',
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
    paddingBottom: '10px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    marginBottom: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '500',
    color: 'var(--mn-text-primary, #132b25)',
    marginBottom: '6px',
  },
  input: {
    height: '40px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '14px',
    color: 'var(--mn-text-primary, #132b25)',
  },
  textarea: {
    height: '100px',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '13px',
    resize: 'none' as const,
    color: 'var(--mn-text-primary, #132b25)',
  },
  decisionButtons: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
  submitBtn: {
    backgroundColor: 'var(--mn-action-primary, #0b624a)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    minWidth: 'min(100%, 180px)',
  },
  rejectBtn: {
    backgroundColor: '#FEF2F2',
    color: '#991B1B',
    border: '1px solid #FCA5A5',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    minWidth: 'min(100%, 180px)',
  },
};
