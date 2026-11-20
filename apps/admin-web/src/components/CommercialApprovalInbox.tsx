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
  status: string;
  requestedAt: string;
  expiresAt: string;
  version: number;
}

interface CommercialApprovalInboxProps {
  currentPrincipalId?: string;
  canApprove: boolean;
  canWrite: boolean;
}

export const CommercialApprovalInbox: React.FC<CommercialApprovalInboxProps> = ({
  currentPrincipalId,
  canApprove,
  canWrite,
}) => {
  const [items, setItems] = useState<PrivilegedApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const res = await ApiClient.get<{ items: PrivilegedApprovalItem[]; total: number }>(
        `/api/v1/internal/a2/workforce/approvals${qs ? `?${qs}` : ''}`,
      );
      setItems(res.items ?? []);
      setTotal(res.total ?? 0);
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
    try {
      await ApiClient.post(`/api/v1/internal/a2/workforce/approvals/${item.id}/${decision}`, {
        comment: commentById[item.id]?.trim() || undefined,
        expectedVersion: item.version,
      });
      await loadInbox();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${decision} proposal`);
    } finally {
      setBusyId(null);
    }
  };

  if (!canApprove) {
    return null;
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

      {items.length === 0 ? (
        <p style={{ fontSize: '14px', opacity: 0.75 }}>
          {loading ? 'Loading proposals…' : 'No matching approval proposals in your authorized scope.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map((item) => {
            const isSelf = item.requesterPrincipalId === currentPrincipalId;
            const isPending = item.status === 'REQUESTED';
            const disabled = !canWrite || !isPending || isSelf || busyId === item.id;
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
                    {item.status} · v{item.version}
                  </span>
                </div>
                {item.reason && (
                  <div style={{ fontSize: '13px', opacity: 0.9 }}>{item.reason}</div>
                )}
                <div style={{ fontSize: '12px', opacity: 0.72 }}>
                  Requested by <code>{item.requesterPrincipalId}</code> · Expires{' '}
                  {new Date(item.expiresAt).toLocaleString()}
                </div>
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
