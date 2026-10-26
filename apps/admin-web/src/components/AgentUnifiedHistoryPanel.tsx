import React, { useEffect, useState } from 'react';

export interface AdminAgentHistoryEntry {
  id: string;
  type: string;
  status: string;
  direction: string;
  amountMinor: string;
  currency: string;
  feeMinor?: string;
  reference: string | null;
  createdAt: string;
}

export interface AdminAgentUnifiedHistoryResponse {
  items: AdminAgentHistoryEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

export interface AgentUnifiedHistoryPanelProps {
  agentId: string;
  canViewTransactions: boolean;
  loadTransactions?: (
    agentId: string,
    query: { page: number; limit: number; type?: string },
  ) => Promise<AdminAgentUnifiedHistoryResponse>;
}

function formatMinor(value: string, currency = 'NGN'): string {
  try {
    const minor = BigInt(value);
    const neg = minor < 0n;
    const abs = neg ? -minor : minor;
    return `${neg ? '-' : ''}${currency} ${(abs / 100n).toLocaleString('en-NG')}.${String(abs % 100n).padStart(2, '0')}`;
  } catch {
    return `${currency} ${value}`;
  }
}

export const AgentUnifiedHistoryPanel: React.FC<AgentUnifiedHistoryPanelProps> = ({
  agentId,
  canViewTransactions,
  loadTransactions,
}) => {
  const [data, setData] = useState<AdminAgentUnifiedHistoryResponse | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setTypeFilter('');
    setPage(1);
    setError('');
  }, [agentId]);

  if (!canViewTransactions || !agentId) return null;

  const fetchPage = async (targetPage: number, targetType: string) => {
    if (!loadTransactions || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await loadTransactions(agentId, {
        page: targetPage,
        limit: 10,
        ...(targetType ? { type: targetType } : {}),
      });
      setData(response);
      setPage(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load unified Agent transaction history.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.box} aria-label="Unified Agent transaction stream">
      <div style={styles.header}>
        <strong style={styles.title}>Unified Agent Service Ledger Stream</strong>
        {loadTransactions && (
          <button
            type="button"
            style={styles.button}
            disabled={loading}
            onClick={() => void fetchPage(1, typeFilter)}
          >
            {loading ? 'Loading…' : data ? 'Refresh unified stream' : 'Load unified stream'}
          </button>
        )}
      </div>

      {!loadTransactions ? (
        <div>
          <div style={styles.dependencyBox} role="note" data-testid="agent-unified-history-dependency">
            <strong>Unavailable Backend Capability:</strong> Unified workforce Agent history (
            <code>GET /internal/agents/:id/transactions</code>, combining <code>CASH_IN</code>,{' '}
            <code>CASH_OUT</code>, <code>CASH_TO_CASH</code>, <code>CASH_TO_CASH_CLAIM</code>,{' '}
            <code>AGENT_FUNDING</code>, and <code>AGENT_DEFUNDING</code>) is not exposed on the backend yet.
            Use the live <strong>Wallet Transfers</strong> and <strong>Cash-to-Cash Transfers</strong> views
            above for authoritative records today.
          </div>
          <button
            type="button"
            disabled
            style={{ ...styles.button, marginTop: 8, opacity: 0.55, cursor: 'not-allowed' }}
          >
            Load unified stream (Unavailable)
          </button>
        </div>
      ) : (
        <>
          <div style={styles.controls}>
            <select
              aria-label="Unified history service filter"
              value={typeFilter}
              onChange={(e) => {
                const next = e.target.value;
                setTypeFilter(next);
                if (data) void fetchPage(1, next);
              }}
              style={styles.select}
            >
              <option value="">All services</option>
              <option value="CASH_IN">CASH_IN</option>
              <option value="CASH_OUT">CASH_OUT</option>
              <option value="CASH_TO_CASH">CASH_TO_CASH</option>
              <option value="CASH_TO_CASH_CLAIM">CASH_TO_CASH_CLAIM</option>
              <option value="AGENT_FUNDING">AGENT_FUNDING</option>
              <option value="AGENT_DEFUNDING">AGENT_DEFUNDING</option>
            </select>
          </div>

          {error && <div style={styles.errorBox} role="alert">{error}</div>}

          {data && (
            data.items.length === 0 ? (
              <div style={styles.empty}>No unified Agent history entries found.</div>
            ) : (
              <>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Service</th>
                      <th>Direction</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.id}>
                        <td>{new Date(item.createdAt).toLocaleString()}</td>
                        <td><code>{item.type}</code></td>
                        <td>{item.direction}</td>
                        <td>{formatMinor(item.amountMinor, item.currency)}</td>
                        <td>{item.status}</td>
                        <td><code>{item.reference || '—'}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={styles.pager}>
                  <span>Page {data.pagination.page} of {Math.max(1, data.pagination.totalPages)}</span>
                  <button
                    type="button"
                    style={styles.button}
                    disabled={loading || page <= 1}
                    onClick={() => void fetchPage(page - 1, typeFilter)}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    style={styles.button}
                    disabled={loading || !data.pagination.hasNextPage}
                    onClick={() => void fetchPage(page + 1, typeFilter)}
                  >
                    Next
                  </button>
                </div>
              </>
            )
          )}
        </>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  box: { marginTop: 10, padding: 10, border: '1px solid #E2E8F0', borderRadius: 6, background: '#FFFFFF' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 12, color: '#0F172A' },
  dependencyBox: {
    marginTop: 8,
    padding: 9,
    borderRadius: 5,
    border: '1px solid #FDE68A',
    background: '#FFFBEB',
    color: '#78350F',
    fontSize: 11,
    lineHeight: 1.5,
  },
  controls: { marginTop: 8, display: 'flex', gap: 8 },
  select: { padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { padding: '5px 9px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#FFF', cursor: 'pointer', fontSize: 11 },
  errorBox: { marginTop: 8, padding: 8, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 11 },
  empty: { marginTop: 8, color: '#64748B', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 11 },
  pager: { marginTop: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B' },
};
