import React, { useCallback, useEffect, useState } from 'react';
import { ApiClient } from '../services/api-client';
import { Button } from '../design-system/primitives';

export interface PrivilegedApprovalItem {
  id: string;
  actionType: string;
  resourceType: string;
  resourceId: string | null;
  requesterPrincipalId: string;
  approvedBy: string | null;
  reason?: string;
  approvalScope: string;
  policy?: {
    requestDetails?: Record<string, unknown>;
    [key: string]: unknown;
  };
  status: string;
  requestedAt: string;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  consumedAt: string | null;
  version: number;
}

interface CommercialApprovalInboxProps {
  currentPrincipalId?: string;
  canApprove: boolean;
  canWrite: boolean;
  scopes?: string[];
}

interface ExecutionTarget {
  path: string;
  body: Record<string, unknown>;
  requiredFunction: string;
}

export function resolveCommercialExecutionTarget(
  item: PrivilegedApprovalItem,
): ExecutionTarget | null {
  const details = item.policy?.requestDetails;
  if (!details || typeof details !== 'object') return null;

  switch (item.actionType) {
    case 'FEE_RULE_CREATE':
      return {
        path: `/internal/fee-rules/changes/${encodeURIComponent(item.id)}/execute-create`,
        body: { ...details },
        requiredFunction: 'fee_rule.create',
      };
    case 'FEE_RULE_MODIFY':
      return {
        path: `/internal/fee-rules/changes/${encodeURIComponent(item.id)}/execute-modify`,
        body: { ...details },
        requiredFunction: 'fee_rule.modify',
      };
    case 'COMMISSION_RULE_CREATE':
      return {
        path: `/internal/commission-rules/changes/${encodeURIComponent(item.id)}/execute-create`,
        body: { ...details },
        requiredFunction: 'commission_rule.create',
      };
    case 'COMMISSION_RULE_MODIFY':
      return {
        path: `/internal/commission-rules/changes/${encodeURIComponent(item.id)}/execute-modify`,
        body: { ...details },
        requiredFunction: 'commission_rule.modify',
      };
    case 'REWARD_RULE_CREATE':
      return {
        path: `/internal/reward-rules/changes/${encodeURIComponent(item.id)}/execute-create`,
        body: { ...details },
        requiredFunction: 'reward_rule.create',
      };
    case 'REWARD_RULE_MODIFY':
      return {
        path: `/internal/reward-rules/changes/${encodeURIComponent(item.id)}/execute-modify`,
        body: { ...details },
        requiredFunction: 'reward_rule.modify',
      };
    case 'PRODUCT_MODIFY': {
      const { productCode: preservedCode, ...restDetails } = details;
      const productBody =
        item.resourceId === null &&
        restDetails.code === '[REDACTED]' &&
        typeof preservedCode === 'string'
          ? { ...restDetails, code: preservedCode }
          : { ...details };
      return {
        path:
          item.resourceId === null
            ? `/internal/products/changes/${encodeURIComponent(item.id)}/execute-create`
            : `/internal/products/changes/${encodeURIComponent(item.id)}/execute-modify`,
        body: productBody,
        requiredFunction: 'product.modify',
      };
    }
    case 'LIMIT_RULE_CREATE': {
      const profileCode =
        typeof details.limitProfileCode === 'string' ? details.limitProfileCode.trim() : '';
      if (!profileCode) return null;
      const { limitProfileCode: _ignored, ...ruleBody } = details;
      return {
        path: `/internal/limit-profiles/${encodeURIComponent(profileCode)}/rules/changes/${encodeURIComponent(item.id)}/execute-create`,
        body: ruleBody,
        requiredFunction: 'limit.modify',
      };
    }
    case 'LIMIT_RULE_UPDATE': {
      const ruleId = item.resourceId?.trim();
      if (!ruleId) return null;
      return {
        path: `/internal/limit-rules/${encodeURIComponent(ruleId)}/changes/${encodeURIComponent(item.id)}/execute-update`,
        body: { ...details },
        requiredFunction: 'limit.modify',
      };
    }
    default:
      return null;
  }
}

function statusStateLabel(status: string, consumedAt: string | null): string {
  if (status === 'CONSUMED' || consumedAt) return 'EXECUTED (CONSUMED)';
  if (status === 'APPROVED') return 'APPROVED (Awaiting execution)';
  if (status === 'REQUESTED') return 'PENDING (Awaiting checker)';
  return status;
}

export const CommercialApprovalInbox: React.FC<CommercialApprovalInboxProps> = ({
  currentPrincipalId,
  canApprove,
  canWrite,
  scopes = [],
}) => {
  const [items, setItems] = useState<PrivilegedApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('REQUESTED');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [resourceFilter, setResourceFilter] = useState<string>('');
  const [institutionFilter, setInstitutionFilter] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [commentById, setCommentById] = useState<Record<string, string>>({});

  const loadInbox = useCallback(async () => {
    if (!canApprove) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (actionFilter.trim()) params.set('actionType', actionFilter.trim());
      if (resourceFilter.trim()) params.set('resourceType', resourceFilter.trim());
      if (institutionFilter.trim()) params.set('institutionId', institutionFilter.trim());
      const qs = params.toString();
      const res = await ApiClient.get<{ items?: PrivilegedApprovalItem[]; total?: number }>(
        `/internal/a2/workforce/approvals${qs ? `?${qs}` : ''}`,
      );
      setItems(Array.isArray(res?.items) ? res.items : []);
      setTotal(typeof res?.total === 'number' ? res.total : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commercial approvals');
    } finally {
      setLoading(false);
    }
  }, [canApprove, statusFilter, actionFilter, resourceFilter, institutionFilter]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const handleDecision = async (item: PrivilegedApprovalItem, decision: 'approve' | 'reject') => {
    if (!canWrite || busyId) return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await ApiClient.post(`/internal/a2/workforce/approvals/${item.id}/${decision}`, {
        comment: commentById[item.id]?.trim() || undefined,
        expectedVersion: item.version,
      });
      setNotice(
        decision === 'approve'
          ? `Approval ${item.id} recorded as APPROVED.`
          : `Approval ${item.id} recorded as REJECTED.`,
      );
      await loadInbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${decision} proposal`);
    } finally {
      setBusyId(null);
    }
  };

  const handleExecute = async (item: PrivilegedApprovalItem) => {
    if (!canWrite || busyId) return;
    const target = resolveCommercialExecutionTarget(item);
    if (!target) return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await ApiClient.post(target.path, target.body);
      setNotice(`Approved change ${item.id} executed and consumed.`);
      await loadInbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute approved proposal');
    } finally {
      setBusyId(null);
    }
  };

  if (!canApprove) {
    return (
      <section
        className="mn-surface-card"
        aria-label="Commercial and Governance Approval Inbox"
        style={{ marginTop: '20px', padding: '20px' }}
      >
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
          Commercial &amp; Governance Approval Inbox
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: '13px', opacity: 0.78 }}>
          Your account does not currently hold the required checker authorization to review
          commercial or governance approval proposals.
        </p>
      </section>
    );
  }

  return (
    <section
      className="mn-surface-card"
      aria-label="Commercial and Governance Approval Inbox"
      style={{ marginTop: '20px', padding: '20px' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '16px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
            Commercial &amp; Governance Approval Inbox
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.78 }}>
            Permission-filtered maker-checker proposals ({total} matching)
          </p>
        </div>
        <Button type="button" onClick={() => void loadInbox()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: '10px',
          marginBottom: '16px',
        }}
      >
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="REQUESTED">REQUESTED</option>
          <option value="APPROVED">APPROVED</option>
          <option value="REJECTED">REJECTED</option>
          <option value="CONSUMED">CONSUMED</option>
          <option value="EXPIRED">EXPIRED</option>
          <option value="">ALL STATUSES</option>
        </select>
        <input
          type="text"
          aria-label="Filter by action"
          placeholder="Action (e.g. FEE_RULE_CREATE)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        />
        <input
          type="text"
          aria-label="Filter by resource"
          placeholder="Resource (e.g. FEE_RULE)"
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
        />
        <input
          type="text"
          aria-label="Filter by institution"
          placeholder="Institution ID"
          value={institutionFilter}
          onChange={(e) => setInstitutionFilter(e.target.value)}
        />
      </div>

      {error && (
        <div role="alert" style={{ color: '#991B1B', marginBottom: '12px', fontSize: '13px' }}>
          {error}
        </div>
      )}
      {notice && (
        <div style={{ color: '#065F46', marginBottom: '12px', fontSize: '13px' }}>{notice}</div>
      )}

      {items.length === 0 ? (
        <p style={{ fontSize: '14px', opacity: 0.75 }}>
          {loading
            ? 'Loading proposals…'
            : 'No matching approval proposals in your authorized scope.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map((item) => {
            const isSelf = item.requesterPrincipalId === currentPrincipalId;
            const isPending = item.status === 'REQUESTED';
            const isApproved = item.status === 'APPROVED' && !item.consumedAt;
            const disabled = !canWrite || !isPending || isSelf || busyId === item.id;
            const executionTarget = isApproved ? resolveCommercialExecutionTarget(item) : null;
            const canExecuteItem =
              Boolean(executionTarget) &&
              canWrite &&
              !isSelf &&
              (scopes.length === 0 ||
                scopes.includes(executionTarget!.requiredFunction) ||
                scopes.includes('privileged:execute')) &&
              (item.approvedBy === currentPrincipalId || scopes.includes('privileged:execute'));
            const requestDetails = item.policy?.requestDetails;
            return (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--mn-border-subtle, #dde7e2)',
                  borderRadius: '8px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>
                    {item.actionType} · {item.resourceType}
                    {item.resourceId ? ` (${item.resourceId})` : ''}
                  </strong>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>
                    {statusStateLabel(item.status, item.consumedAt)} · v{item.version}
                  </span>
                </div>
                {item.reason && <div style={{ fontSize: '13px', opacity: 0.9 }}>{item.reason}</div>}
                {requestDetails && Object.keys(requestDetails).length > 0 && (
                  <div
                    style={{
                      fontSize: '12px',
                      background: 'var(--mn-surface-muted, #f6f9f7)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                    }}
                  >
                    <strong>Proposed parameters:</strong>{' '}
                    {Object.entries(requestDetails)
                      .filter(([k, v]) => k !== 'reason' && v !== null && v !== undefined)
                      .map(
                        ([k, v]) =>
                          `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
                      )
                      .join(' · ')}
                  </div>
                )}
                <div style={{ fontSize: '12px', opacity: 0.72 }}>
                  Approval ID <code>{item.id}</code> · Requested by{' '}
                  <code>{item.requesterPrincipalId}</code> · Created{' '}
                  {new Date(item.requestedAt).toLocaleString()} · Expires{' '}
                  {new Date(item.expiresAt).toLocaleString()}
                </div>
                {(item.approvedBy || item.approvedAt || item.rejectedAt || item.consumedAt) && (
                  <div style={{ fontSize: '12px', opacity: 0.78 }}>
                    {item.approvedBy && (
                      <>
                        Decided by <code>{item.approvedBy}</code>{' '}
                      </>
                    )}
                    {item.approvedAt && (
                      <>· Approved {new Date(item.approvedAt).toLocaleString()} </>
                    )}
                    {item.rejectedAt && (
                      <>· Rejected {new Date(item.rejectedAt).toLocaleString()} </>
                    )}
                    {item.consumedAt && (
                      <>· Executed {new Date(item.consumedAt).toLocaleString()}</>
                    )}
                  </div>
                )}
                {isPending && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginTop: '4px',
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Reviewer comment / rejection reason"
                      value={commentById[item.id] ?? ''}
                      onChange={(e) =>
                        setCommentById((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      style={{ flex: '1 1 220px', minWidth: '180px' }}
                    />
                    <Button
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleDecision(item, 'approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleDecision(item, 'reject')}
                    >
                      Reject
                    </Button>
                    {isSelf && (
                      <span style={{ fontSize: '12px', color: '#991B1B' }}>
                        Self-approval forbidden
                      </span>
                    )}
                  </div>
                )}
                {isApproved && executionTarget && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginTop: '4px',
                    }}
                  >
                    <Button
                      type="button"
                      disabled={!canExecuteItem || busyId === item.id}
                      onClick={() => void handleExecute(item)}
                    >
                      {busyId === item.id ? 'Executing…' : 'Execute approved change'}
                    </Button>
                    {!canExecuteItem && (
                      <span style={{ fontSize: '12px', opacity: 0.78 }}>
                        Execution requires the approving checker or a{' '}
                        <code>privileged:execute</code> session with{' '}
                        <code>{executionTarget.requiredFunction}</code>.
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
