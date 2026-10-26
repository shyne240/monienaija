import React, { useState } from 'react';

export interface PendingFundingQueueItem {
  id: string;
  approvalId: string;
  agentId: string;
  agentReference?: string | null;
  direction: 'FUND' | 'DEFUND';
  amountMinor: string;
  currency: string;
  idempotencyKey?: string;
  status: 'PENDING' | 'REJECTED' | 'EXECUTED' | string;
  approvalStatus: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CONSUMED' | 'EXPIRED' | string;
  reason: string;
  requesterPrincipalId: string;
  approvalExpiresAt?: string | null;
}

export interface PendingFundingApprovalsQueueProps {
  canReviewFunding: boolean;
  loadQueue?: () => Promise<PendingFundingQueueItem[]>;
  onSelectRequest: (agentId: string, idempotencyKey?: string) => void;
}

function formatMinor(value: string, currency: string): string {
  try {
    const minor = BigInt(value);
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const whole = (abs / 100n).toLocaleString('en-NG');
    const frac = String(abs % 100n).padStart(2, '0');
    return `${negative ? '-' : ''}${currency} ${whole}.${frac}`;
  } catch {
    return `${currency} ${value}`;
  }
}

export const PendingFundingApprovalsQueue: React.FC<PendingFundingApprovalsQueueProps> = ({
  canReviewFunding,
  loadQueue,
  onSelectRequest,
}) => {
  const [items, setItems] = useState<PendingFundingQueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'REQUESTED' | 'APPROVED'>('ALL');

  if (!canReviewFunding) return null;

  const handleLoad = async () => {
    if (!loadQueue || loading) return;
    setLoading(true);
    setError('');
    try {
      const rows = await loadQueue();
      setItems(Array.isArray(rows) ? rows : []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pending funding queue.');
    } finally {
      setLoading(false);
    }
  };

  const visibleItems = items.filter((item) =>
    statusFilter === 'ALL' ? true : item.approvalStatus === statusFilter,
  );

  return (
    <section
      aria-label="Global pending funding discovery queue"
      style={styles.card}
    >
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Global Pending Funding Discovery Queue</h3>
          <p style={styles.subtitle}>
            Cross-agent discovery of pending <code>FUND</code> and <code>DEFUND</code> maker-checker instructions.
          </p>
        </div>
        {loadQueue && (
          <button
            type="button"
            style={styles.button}
            disabled={loading}
            onClick={() => void handleLoad()}
          >
            {loading ? 'Loading queue…' : loaded ? 'Refresh pending queue' : 'Load pending queue'}
          </button>
        )}
      </div>

      {!loadQueue ? (
        <div style={styles.dependencyBox} role="note" data-testid="pending-funding-backend-dependency">
          <strong>Backend Dependency (ARENA 3):</strong> Unscoped global pending-funding listing (
          <code>GET /internal/agents/funding-requests?status=PENDING</code> or{' '}
          <code>GET /internal/a2/workforce/approvals?status=REQUESTED</code>) is not yet exposed by the backend.
          Until ARENA 3 lands global queue discovery, use the{' '}
          <strong>Agent Funding &amp; Defunding Checker</strong> below by pasting a Maker Handoff Token or
          entering the target <code>Agent ID</code> to load{' '}
          <code>GET /internal/agents/:agentId/funding-requests</code>.
        </div>
      ) : (
        <>
          <div style={styles.filterRow}>
            <label style={styles.filterLabel}>
              Approval status
              <select
                aria-label="Queue approval status filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'REQUESTED' | 'APPROVED')}
                style={styles.select}
              >
                <option value="ALL">All actionable</option>
                <option value="REQUESTED">REQUESTED (awaiting checker approval)</option>
                <option value="APPROVED">APPROVED (ready to execute)</option>
              </select>
            </label>
          </div>

          {error && <div style={styles.errorBox} role="alert">{error}</div>}

          {loaded && (
            visibleItems.length === 0 ? (
              <div style={styles.empty}>No pending funding instructions match this filter.</div>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th>Request / Approval</th>
                    <th>Agent</th>
                    <th>Direction &amp; Amount</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <code>{item.id}</code>
                        <div style={styles.muted}>Approval: <code>{item.approvalId}</code></div>
                      </td>
                      <td>
                        <strong>{item.agentReference || item.agentId}</strong>
                        <div style={styles.muted}><code>{item.agentId}</code></div>
                      </td>
                      <td>
                        <strong>{item.direction}</strong> · {formatMinor(item.amountMinor, item.currency)}
                      </td>
                      <td>
                        <span style={styles.badge}>{item.approvalStatus}</span>
                      </td>
                      <td>{item.reason}</td>
                      <td>
                        <button
                          type="button"
                          style={styles.primaryButton}
                          onClick={() => onSelectRequest(item.agentId, item.idempotencyKey)}
                        >
                          Open in Funding Checker
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </>
      )}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: '#FFFFFF',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
  },
  title: { margin: '0 0 4px', fontSize: 16, color: '#0A3D25' },
  subtitle: { margin: 0, fontSize: 12, color: '#64748B' },
  dependencyBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 6,
    border: '1px solid #FDE68A',
    background: '#FFFBEB',
    color: '#78350F',
    fontSize: 12,
    lineHeight: 1.5,
  },
  filterRow: { marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' },
  filterLabel: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: '#334155' },
  select: { padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { padding: '7px 12px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#FFF', cursor: 'pointer', fontSize: 12 },
  primaryButton: { padding: '6px 10px', border: '1px solid #0A3D25', borderRadius: 5, background: '#0A3D25', color: '#FFF', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  errorBox: { marginTop: 10, padding: 10, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 12 },
  empty: { marginTop: 12, padding: 14, borderRadius: 6, border: '1px dashed #CBD5E1', color: '#64748B', fontSize: 12, textAlign: 'center' },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 12 },
  muted: { color: '#64748B', fontSize: 11 },
  badge: { display: 'inline-block', padding: '2px 7px', borderRadius: 99, background: '#EFF6FF', color: '#1D4ED8', fontSize: 11, fontWeight: 700 },
};
