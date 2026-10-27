import React, { useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { PendingFundingApprovalsQueue } from '../../components/PendingFundingApprovalsQueue';
import { AgentFundingPanel, SelectedFundingInboxTarget } from './AgentFundingPanel';

export const ApprovalsScreen: React.FC = () => {
  const { principal } = useAuthStore();
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

  const fundingInboxUnauthorizedReason = !canReviewFunding || canAccessGlobalFundingInbox
    ? null
    : principal?.roles.includes('SUPER_ADMIN')
      ? 'Decision 7 forbids SUPER_ADMIN from viewing or approving Agent funding requests.'
      : principal?.assuranceLevel !== 'MFA'
        ? 'MFA session assurance is required to access the global funding inbox.'
        : !['OPERATOR', 'SERVICE', 'PRIVILEGED'].includes(principal?.type ?? '')
          ? 'An authorized workforce principal (OPERATOR, SERVICE, or PRIVILEGED) is required.'
          : 'Decision 7 requires both agent.fund and agent.defund scopes to read the global funding inbox.';

  const [selectedInboxTarget, setSelectedInboxTarget] = useState<SelectedFundingInboxTarget | null>(null);
  const [inboxRefreshTrigger, setInboxRefreshTrigger] = useState(0);
  const [approvalId, setApprovalId] = useState('');
  const [comment, setComment] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<'approve' | 'reject' | null>(null);
  const [decisionAction, setDecisionAction] = useState<'approve' | 'reject' | null>(null);

  const handleDecision = async (action: 'approve' | 'reject') => {
    if (!canApprove) return;
    if (!approvalId.trim()) {
      setError('Approval ID is required');
      return;
    }

    setIsLoading(true);
    setDecisionAction(action);
    setError('');
    setSuccess(null);

    try {
      // Both decision routes exist; the backend remains authoritative for the checker policy.
      await ApiClient.post(`/internal/a2/workforce/approvals/${approvalId.trim()}/${action}`, {
        comment: comment.trim() || undefined,
      });
      setSuccess(action);
      setApprovalId('');
      setComment('');
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} the action override`);
    } finally {
      setIsLoading(false);
      setDecisionAction(null);
    }
  };

  const handleApproveSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void handleDecision('approve');
  };

  if (!canApprove && !canReviewFunding) {
    return (
      <div style={styles.container} role="alert">
        <div style={styles.errorBox}>The configured checker role <code>FINANCE_CONTROLLER</code> and <code>privileged:approve</code> are required for these approval actions.</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Privileged Approvals (Maker-Checker)</h2>
        <p style={styles.subtitle}>Execute authorized check verifications and system overrides</p>
      </div>

      <div style={styles.gapWarning}>
        <span style={styles.gapTitle}>ℹ️ Approval Discovery Scope</span>
        <p style={styles.gapText}>
          Agent funding and defunding requests use the live Global Funding Inbox below (<code>GET /internal/agents/funding-requests</code>). Generic non-funding workforce overrides still require a known Approval ID because generic <code>GET /internal/a2/workforce/approvals</code> listing is not exposed.
        </p>
      </div>
      <div style={styles.fundingNote}>
        Agent funding requests use their dedicated rejection workflow so approval and request state change atomically. This generic rejection action intentionally rejects funding approval IDs; it does not replace that workflow.
      </div>

      {canReviewFunding && (
        <div style={{ marginBottom: 24 }}>
          <PendingFundingApprovalsQueue
            canReviewFunding={canReviewFunding}
            canAccessGlobalInbox={canAccessGlobalFundingInbox}
            unauthorizedReason={fundingInboxUnauthorizedReason}
            refreshTrigger={inboxRefreshTrigger}
            activeRequestId={selectedInboxTarget?.requestId ?? null}
            onSelectRequest={(targetAgentId, idemKey, selection) => {
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
                onClick={() => setSelectedInboxTarget(null)}
              >
                Clear target
              </button>
            </div>
          )}
          <AgentFundingPanel
            selectedInboxTarget={selectedInboxTarget}
            onCheckerOutcome={() => setInboxRefreshTrigger((n) => n + 1)}
          />
        </div>
      )}

      {error && <div style={styles.errorBox} role="alert">{error}</div>}
      {success && <div style={styles.successBox} role="status">{success === 'approve' ? 'Privileged action checked and approved successfully!' : 'Approval decision recorded as rejected successfully.'}</div>}

      {canApprove && (
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Submit Checker Decision</h3>
        <form onSubmit={handleApproveSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Pending Approval ID (UUID)</label>
            <input
              type="text"
              style={styles.input}
              placeholder="e.g. 5e6f7g8h-1234-..."
              value={approvalId}
              onChange={(e) => setApprovalId(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Audit Comment / Verification Notes (Optional)</label>
            <textarea
              style={styles.textarea}
              placeholder="Provide context or explanation for auditing..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={isLoading}
            />
          </div>

          <div style={styles.decisionButtons}>
            <button type="submit" disabled={isLoading || !approvalId.trim()} style={styles.submitBtn}>
              {isLoading && decisionAction === 'approve' ? 'Approving…' : 'Sign & Approve Action'}
            </button>
            <button type="button" disabled={isLoading || !approvalId.trim()} onClick={() => void handleDecision('reject')} style={styles.rejectBtn}>
              {isLoading && decisionAction === 'reject' ? 'Rejecting…' : 'Reject Action'}
            </button>
          </div>
        </form>
      </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '24px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '24px',
  },
  title: {
    fontSize: '22px',
    fontWeight: 'bold',
    color: '#0A3D25',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0,
  },
  gapWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
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
    backgroundColor: '#FEE2E2',
    color: '#EF4444',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#EF4444',
  },
  successBox: {
    backgroundColor: '#D1FAE5',
    color: '#10B981',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#10B981',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '8px',
    border: '1px solid #E2E8F0',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
    maxWidth: '600px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1E293B',
    margin: '0 0 20px 0',
    borderBottom: '1px solid #F1F5F9',
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
    color: '#334155',
    marginBottom: '6px',
  },
  input: {
    height: '40px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '0 12px',
    fontSize: '14px',
    color: '#1E293B',
  },
  textarea: {
    height: '100px',
    border: '1px solid #E2E8F0',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '13px',
    resize: 'none' as const,
    color: '#1E293B',
  },
  decisionButtons: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap' as const,
  },
  submitBtn: {
    backgroundColor: '#0A3D25',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    padding: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    minWidth: '180px',
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
    minWidth: '180px',
  },
};
