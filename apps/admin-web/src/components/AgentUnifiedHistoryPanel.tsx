import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api-client';

export const ADMIN_AGENT_UNIFIED_HISTORY_TYPES = [
  'CASH_IN',
  'CASH_OUT',
  'CASH_TO_CASH',
  'CASH_TO_CASH_CLAIM',
  'AGENT_FUNDING',
  'AGENT_DEFUNDING',
] as const;

export type AdminAgentUnifiedHistoryType =
  (typeof ADMIN_AGENT_UNIFIED_HISTORY_TYPES)[number];

export interface AdminAgentHistoryCounterparty {
  ownerType: string;
  display: string | null;
  identifierMasked: string | null;
}

export interface AdminAgentHistoryCommission {
  amountMinor: string;
  currency: string;
  status: string;
}

export interface AdminAgentHistoryEntry {
  id: string;
  type: AdminAgentUnifiedHistoryType | string;
  status: string;
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | string;
  amountMinor: string;
  currency: string;
  createdAt: string;
  completedAt?: string | null;
  reference: string | null;
  narration?: string | null;
  feeMinor?: string;
  counterparty?: AdminAgentHistoryCounterparty | null;
  commission?: AdminAgentHistoryCommission | null;
  failureCode?: string | null;
  failureMessage?: string | null;
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

export interface AdminAgentUnifiedHistoryQuery {
  page: number;
  limit: number;
  type?: AdminAgentUnifiedHistoryType | string;
}

export async function fetchAdminAgentUnifiedHistory(
  agentId: string,
  query: AdminAgentUnifiedHistoryQuery,
): Promise<AdminAgentUnifiedHistoryResponse> {
  const safePage = Number.isInteger(query.page) && query.page >= 1 ? query.page : 1;
  const safeLimit =
    Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 100
      ? query.limit
      : 20;
  const params = new URLSearchParams({
    page: String(safePage),
    limit: String(safeLimit),
  });
  if (
    query.type &&
    (ADMIN_AGENT_UNIFIED_HISTORY_TYPES as readonly string[]).includes(query.type)
  ) {
    params.set('type', query.type);
  }
  return ApiClient.get<AdminAgentUnifiedHistoryResponse>(
    `/internal/agents/${encodeURIComponent(agentId)}/transactions?${params.toString()}`,
  );
}

export interface AgentUnifiedHistoryPanelProps {
  agentId: string;
  /** Primary gate matching ARENA 3 contract: `agent.view` + OPERATOR/SERVICE/PRIVILEGED workforce principal. */
  canViewAgent?: boolean;
  /** Retained as optional alias for existing callers/tests. */
  canViewTransactions?: boolean;
  loadTransactions?: (
    agentId: string,
    query: AdminAgentUnifiedHistoryQuery,
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

function isForbiddenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: unknown }).status;
  return status === 403;
}

function formatCounterparty(counterparty?: AdminAgentHistoryCounterparty | null): string {
  if (!counterparty) return '—';
  const parts = [
    counterparty.display,
    counterparty.identifierMasked,
    counterparty.ownerType,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export const AgentUnifiedHistoryPanel: React.FC<AgentUnifiedHistoryPanelProps> = ({
  agentId,
  canViewAgent,
  canViewTransactions,
  loadTransactions = fetchAdminAgentUnifiedHistory,
}) => {
  const [data, setData] = useState<AdminAgentUnifiedHistoryResponse | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    setData(null);
    setTypeFilter('');
    setPage(1);
    setLimit(20);
    setError('');
    setForbidden(false);
  }, [agentId]);

  const entitled = canViewAgent ?? canViewTransactions ?? false;
  if (!entitled || !agentId) return null;

  const fetchPage = async (targetPage: number, targetLimit: number, targetType: string) => {
    if (loading || forbidden) return;
    setLoading(true);
    setError('');
    try {
      const response = await loadTransactions(agentId, {
        page: targetPage,
        limit: targetLimit,
        ...(targetType ? { type: targetType } : {}),
      });
      setData(response);
      setPage(response.pagination?.page ?? targetPage);
    } catch (err) {
      if (isForbiddenError(err)) {
        setForbidden(true);
        setData(null);
        setError('');
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load unified Agent transaction history.',
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.box} aria-label="Unified Agent transaction stream">
      <div style={styles.header}>
        <strong style={styles.title}>Unified Agent Service Ledger Stream</strong>
        <button
          type="button"
          style={styles.button}
          disabled={loading || forbidden}
          onClick={() => void fetchPage(1, limit, typeFilter)}
        >
          {loading ? 'Loading…' : data ? 'Refresh unified stream' : 'Load unified stream'}
        </button>
      </div>

      <div style={styles.controls}>
        <select
          aria-label="Unified history service filter"
          value={typeFilter}
          disabled={loading || forbidden}
          onChange={(e) => {
            const next = e.target.value;
            setTypeFilter(next);
            if (data) void fetchPage(1, limit, next);
          }}
          style={styles.select}
        >
          <option value="">All services</option>
          {ADMIN_AGENT_UNIFIED_HISTORY_TYPES.map((serviceType) => (
            <option key={serviceType} value={serviceType}>
              {serviceType}
            </option>
          ))}
        </select>

        <select
          aria-label="Unified history page size"
          value={String(limit)}
          disabled={loading || forbidden}
          onChange={(e) => {
            const nextLimit = Number(e.target.value) || 20;
            setLimit(nextLimit);
            if (data) void fetchPage(1, nextLimit, typeFilter);
          }}
          style={styles.select}
        >
          <option value="10">10 per page</option>
          <option value="20">20 per page</option>
          <option value="50">50 per page</option>
        </select>
      </div>

      {loading && (
        <div
          style={styles.loading}
          role="status"
          data-testid="agent-unified-history-loading"
        >
          Loading unified Agent transaction history…
        </div>
      )}

      {forbidden && (
        <div
          style={styles.errorBox}
          role="alert"
          data-testid="agent-unified-history-forbidden"
        >
          You are not authorized to view unified transaction history for this Agent (403 Forbidden).
        </div>
      )}

      {!forbidden && error && (
        <div
          style={styles.errorBox}
          role="alert"
          data-testid="agent-unified-history-error"
        >
          {error}
        </div>
      )}

      {!forbidden && data && (
        data.items.length === 0 ? (
          <div style={styles.empty} data-testid="agent-unified-history-empty">
            No unified Agent history entries found.
          </div>
        ) : (
          <>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Time</th>
                  <th style={styles.th}>Service</th>
                  <th style={styles.th}>Direction</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Counterparty</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Reference</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td style={styles.td}>
                      <div>{new Date(item.createdAt).toLocaleString()}</div>
                      {item.completedAt && (
                        <div style={styles.subText}>
                          Completed: {new Date(item.completedAt).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>
                      <code>{item.type}</code>
                    </td>
                    <td style={styles.td}>{item.direction}</td>
                    <td style={styles.td}>
                      <div>
                        <strong>{formatMinor(item.amountMinor, item.currency)}</strong>
                      </div>
                      {item.feeMinor && item.feeMinor !== '0' && (
                        <div style={styles.subText}>
                          Fee: {formatMinor(item.feeMinor, item.currency)}
                        </div>
                      )}
                      {item.commission && (
                        <div style={styles.subText}>
                          Commission: {formatMinor(item.commission.amountMinor, item.commission.currency)}{' '}
                          ({item.commission.status})
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>{formatCounterparty(item.counterparty)}</td>
                    <td style={styles.td}>
                      <div>{item.status}</div>
                      {(item.failureCode || item.failureMessage) && (
                        <div style={styles.failureSubText}>
                          {[item.failureCode, item.failureMessage].filter(Boolean).join(': ')}
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>
                      <div>
                        <code>{item.reference || '—'}</code>
                      </div>
                      {item.narration && <div style={styles.subText}>{item.narration}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={styles.pager} data-testid="agent-unified-history-pager">
              <span>
                Page {data.pagination.page} of {Math.max(1, data.pagination.totalPages)} (
                {data.pagination.total} total)
              </span>
              <button
                type="button"
                style={styles.button}
                disabled={loading || forbidden || data.pagination.page <= 1}
                onClick={() => void fetchPage(data.pagination.page - 1, limit, typeFilter)}
              >
                Previous
              </button>
              <button
                type="button"
                style={styles.button}
                disabled={loading || forbidden || !data.pagination.hasNextPage}
                onClick={() => void fetchPage(data.pagination.page + 1, limit, typeFilter)}
              >
                Next
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  box: { marginTop: 10, padding: 10, border: '1px solid #E2E8F0', borderRadius: 6, background: '#FFFFFF' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 12, color: '#0F172A' },
  controls: { marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' },
  select: { padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { padding: '5px 9px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#FFF', cursor: 'pointer', fontSize: 11 },
  loading: { marginTop: 8, color: '#475569', fontSize: 12 },
  errorBox: { marginTop: 8, padding: 8, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 11 },
  empty: { marginTop: 8, color: '#64748B', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 11 },
  th: { textAlign: 'left', padding: '5px 6px', borderBottom: '1px solid #E2E8F0', color: '#475569' },
  td: { padding: '6px', borderBottom: '1px solid #F1F5F9', verticalAlign: 'top' },
  subText: { fontSize: 10, color: '#64748B', marginTop: 2 },
  failureSubText: { fontSize: 10, color: '#991B1B', marginTop: 2 },
  pager: { marginTop: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B' },
};
