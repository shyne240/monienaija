import React, { useEffect, useRef, useState } from 'react';
import './agent-workspaces.css';
import { formatMinorUnits } from '../utils/financial-display';
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
  const response = await ApiClient.get<AdminAgentUnifiedHistoryResponse>(
    `/internal/agents/${encodeURIComponent(agentId)}/transactions?${params.toString()}`,
  );
  return normalizeUnifiedHistoryResponse(response);
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

function formatMinor(value: string, currency: string): string {
  if (currency !== 'NGN') return formatMinorUnits(value, currency);
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

/**
 * ARENA 3 Sprint 3 final integration: normalize the AUTHORITATIVE backend projection
 * (AgentTransactionHistoryService — GET /api/v1/internal/agents/:id/transactions, the same
 * V1-AGENT-HISTORY-01 shape served to Agent Mobile on /agents/me/transactions; contract:
 * docs/ARENA3-SPRINT3-WORKFORCE-API-AND-AUTHORIZATION-20261026.md §1.3) into this panel's
 * view-model.
 *
 * The backend emits:
 *   counterparty: { type: 'CUSTOMER'|'WORKFORCE'|'AGGREGATOR', beneficiaryPhone?, aggregatorId? } | null
 *   commission:   { commissionMinor: string, payable: boolean, treatment: string|null } | null
 * while this panel renders counterparty as { ownerType, display, identifierMasked } and
 * commission as { amountMinor, currency, status }. Without this mapping the real payload
 * rendered '—' for every counterparty and 'undefined' commission amounts. Entries already
 * in the panel view-model shape (injected loadTransactions fixtures) pass through unchanged.
 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return phone;
  return `${digits.slice(0, 3)}***${digits.slice(-4)}`;
}

function normalizeCounterparty(
  counterparty?: AdminAgentHistoryCounterparty | Record<string, unknown> | null,
): AdminAgentHistoryCounterparty | null {
  if (!counterparty || typeof counterparty !== 'object') return null;
  const raw = counterparty as Record<string, unknown>;
  if (typeof raw.ownerType === 'string') {
    return counterparty as AdminAgentHistoryCounterparty; // already panel-shaped
  }
  const ownerType = typeof raw.type === 'string' ? raw.type : 'UNKNOWN';
  const beneficiaryPhone = typeof raw.beneficiaryPhone === 'string' ? raw.beneficiaryPhone : null;
  const aggregatorId = typeof raw.aggregatorId === 'string' ? raw.aggregatorId : null;
  return {
    ownerType,
    display: null,
    identifierMasked: beneficiaryPhone ? maskPhone(beneficiaryPhone) : aggregatorId ? maskPhone(aggregatorId) : null,
  };
}

function normalizeCommission(
  entry: { currency?: string },
  commission?: AdminAgentHistoryCommission | Record<string, unknown> | null,
): AdminAgentHistoryCommission | null {
  if (!commission || typeof commission !== 'object') return null;
  const raw = commission as Record<string, unknown>;
  if (typeof raw.amountMinor === 'string') {
    return commission as AdminAgentHistoryCommission; // already panel-shaped
  }
  if (typeof raw.commissionMinor !== 'string') return null;
  const currency = typeof raw.currency === 'string' ? raw.currency : entry.currency ?? 'NGN';
  const status =
    typeof raw.treatment === 'string' && raw.treatment
      ? raw.treatment
      : raw.payable === true
        ? 'PAYABLE'
        : 'NOT_PAYABLE';
  return { amountMinor: raw.commissionMinor, currency, status };
}

function normalizeUnifiedHistoryResponse(
  response: AdminAgentUnifiedHistoryResponse,
): AdminAgentUnifiedHistoryResponse {
  if (!response || !Array.isArray(response.items)) return response;
  return {
    ...response,
    items: response.items.map((item) => ({
      ...item,
      counterparty: normalizeCounterparty(item.counterparty),
      commission: normalizeCommission(item, item.commission),
    })),
  };
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
  const requestGeneration = useRef(0);
  const entitled = canViewAgent ?? canViewTransactions ?? false;
  const currentContext = useRef({ agentId, entitled });
  currentContext.current = { agentId, entitled };

  useEffect(() => {
    setData(null);
    setTypeFilter('');
    setPage(1);
    setLimit(20);
    setError('');
    setForbidden(false);
    setLoading(false);
    return () => { requestGeneration.current += 1; };
  }, [agentId, entitled]);
  if (!entitled || !agentId) return null;

  const fetchPage = async (targetPage: number, targetLimit: number, targetType: string) => {
    if (loading || forbidden) return;
    const generation = ++requestGeneration.current;
    const isCurrent = () => generation === requestGeneration.current && currentContext.current.agentId === agentId && currentContext.current.entitled;
    setLoading(true);
    setError('');
    try {
      const response = await loadTransactions(agentId, {
        page: targetPage,
        limit: targetLimit,
        ...(targetType ? { type: targetType } : {}),
      });
      if (!isCurrent()) return;
      if (!response || !Array.isArray(response.items) || !response.pagination || typeof response.pagination.page !== 'number' || typeof response.pagination.total !== 'number' || typeof response.pagination.totalPages !== 'number' || typeof response.pagination.hasNextPage !== 'boolean') {
        throw new Error('Invalid Agent transaction history response.');
      }
      setData(response);
      setPage(response.pagination.page);
    } catch (err) {
      if (!isCurrent()) return;
      if (isForbiddenError(err)) {
        setForbidden(true);
        setData(null);
        setError('');
      } else {
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to load unified Agent transaction history.',
        );
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  return (
    <section className="mn-agent-workspace" aria-label="Unified Agent transaction stream">
      <div className="mn-agent-workspace__header">
        <h4 className="mn-agent-workspace__title">Unified Agent Service Ledger Stream</h4>
        <button
          type="button"
          className="mn-agent-workspace__button"
          disabled={loading || forbidden}
          onClick={() => void fetchPage(1, limit, typeFilter)}
        >
          {loading ? 'Loading…' : data ? 'Refresh unified stream' : 'Load unified stream'}
        </button>
      </div>

      <div className="mn-agent-workspace__controls">
        <label className="mn-agent-workspace__field">Service
        <select
          aria-label="Unified history service filter"
          value={typeFilter}
          disabled={loading || forbidden}
          onChange={(e) => {
            const next = e.target.value;
            setTypeFilter(next);
            if (data) void fetchPage(1, limit, next);
          }}
          className="mn-agent-workspace__input"
        >
          <option value="">All services</option>
          {ADMIN_AGENT_UNIFIED_HISTORY_TYPES.map((serviceType) => (
            <option key={serviceType} value={serviceType}>
              {serviceType}
            </option>
          ))}
        </select>
        </label>
        <label className="mn-agent-workspace__field">Page size
        <select
          aria-label="Unified history page size"
          value={String(limit)}
          disabled={loading || forbidden}
          onChange={(e) => {
            const nextLimit = Number(e.target.value) || 20;
            setLimit(nextLimit);
            if (data) void fetchPage(1, nextLimit, typeFilter);
          }}
          className="mn-agent-workspace__input"
        >
          <option value="10">10 per page</option>
          <option value="20">20 per page</option>
          <option value="50">50 per page</option>
        </select>
        </label>
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

      {!loading && !forbidden && data && (
        data.items.length === 0 ? (
          <div style={styles.empty} data-testid="agent-unified-history-empty">
            No unified Agent history entries found.
          </div>
        ) : (
          <>
            <p className="mn-agent-workspace__description">Scroll horizontally to see all history columns.</p>
            <div className="mn-agent-workspace__scroll" role="region" aria-label="Agent history table" tabIndex={0}>
            <table className="mn-agent-workspace__table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Service</th>
                  <th>Direction</th>
                  <th>Amount</th>
                  <th>Counterparty</th>
                  <th>Status</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div>{new Date(item.createdAt).toLocaleString()}</div>
                      {item.completedAt && (
                        <div style={styles.subText}>
                          Completed: {new Date(item.completedAt).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td>
                      <code>{item.type}</code>
                    </td>
                    <td>{item.direction}</td>
                    <td>
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
                    <td>{formatCounterparty(item.counterparty)}</td>
                    <td>
                      <div>{item.status}</div>
                      {(item.failureCode || item.failureMessage) && (
                        <div style={styles.failureSubText}>
                          {[item.failureCode, item.failureMessage].filter(Boolean).join(': ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>
                        <code>{item.reference || '—'}</code>
                      </div>
                      {item.narration && <div style={styles.subText}>{item.narration}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="mn-agent-workspace__pager" data-testid="agent-unified-history-pager">
              <span>
                Page {data.pagination.page} of {Math.max(1, data.pagination.totalPages)} (
                {data.pagination.total} total)
              </span>
              <button
                type="button"
                className="mn-agent-workspace__button"
                disabled={loading || forbidden || data.pagination.page <= 1}
                onClick={() => void fetchPage(data.pagination.page - 1, limit, typeFilter)}
              >
                Previous
              </button>
              <button
                type="button"
                className="mn-agent-workspace__button"
                disabled={loading || forbidden || !data.pagination.hasNextPage}
                onClick={() => void fetchPage(data.pagination.page + 1, limit, typeFilter)}
              >
                Next
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  box: { marginTop: 10, padding: 10, border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 6, background: '#FFFFFF' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 12, color: 'var(--mn-text-primary, #132b25)' },
  controls: { marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' },
  select: { padding: '5px 8px', border: '1px solid #CBD5E1', borderRadius: 5, fontSize: 12 },
  button: { padding: '5px 9px', border: '1px solid #CBD5E1', borderRadius: 5, background: '#FFF', cursor: 'pointer', fontSize: 11 },
  loading: { marginTop: 8, color: 'var(--mn-text-secondary, #52655f)', fontSize: 12 },
  errorBox: { marginTop: 8, padding: 8, borderRadius: 5, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#991B1B', fontSize: 11 },
  empty: { marginTop: 8, color: 'var(--mn-text-secondary, #52655f)', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 11 },
  th: { textAlign: 'left', padding: '5px 6px', borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)', color: 'var(--mn-text-secondary, #52655f)' },
  td: { padding: '6px', borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)', verticalAlign: 'top' },
  subText: { fontSize: 10, color: 'var(--mn-text-secondary, #52655f)', marginTop: 2 },
  failureSubText: { fontSize: 10, color: '#991B1B', marginTop: 2 },
  pager: { marginTop: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mn-text-secondary, #52655f)' },
};
