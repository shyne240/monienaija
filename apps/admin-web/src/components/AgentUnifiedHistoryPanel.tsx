import React, { useEffect, useRef, useState } from 'react';
import './agent-workspaces.css';
import './agent-history.css';
import { formatMinorUnits } from '../utils/financial-display';
import { ApiClient } from '../services/api-client';
import { useAuthStore } from '../store/auth-store';

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

function validHistoryPage(response: AdminAgentUnifiedHistoryResponse, page: number, limit: number): boolean {
  const p = response?.pagination;
  return !!response && Array.isArray(response.items) && !!p && p.page === page && p.limit === limit &&
    Number.isSafeInteger(p.total) && p.total >= response.items.length && Number.isSafeInteger(p.totalPages) &&
    p.totalPages === Math.ceil(p.total / limit) && p.hasNextPage === (page < p.totalPages) && response.items.length <= limit &&
    response.items.every(item => item && typeof item.id === 'string' && !!item.id && typeof item.type === 'string' &&
      typeof item.status === 'string' && typeof item.direction === 'string' && typeof item.currency === 'string' && !!item.currency &&
      typeof item.amountMinor === 'string' && /^-?\d+$/.test(item.amountMinor) && typeof item.createdAt === 'string' &&
      (item.reference === null || typeof item.reference === 'string') &&
      (item.feeMinor === undefined || typeof item.feeMinor === 'string' && /^-?\d+$/.test(item.feeMinor)) &&
      (!item.counterparty || typeof item.counterparty.ownerType === 'string' &&
        (item.counterparty.display == null || typeof item.counterparty.display === 'string') &&
        (item.counterparty.identifierMasked == null || typeof item.counterparty.identifierMasked === 'string')) &&
      (!item.commission || typeof item.commission.amountMinor === 'string' && /^-?\d+$/.test(item.commission.amountMinor) && typeof item.commission.currency === 'string' && typeof item.commission.status === 'string'));
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

export const AgentUnifiedHistoryPanel: React.FC<AgentUnifiedHistoryPanelProps> = (props) => {
  const { principal, sessionId } = useAuthStore();
  const key = JSON.stringify([props.agentId, sessionId, principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <AgentHistoryWorkspace key={key} {...props} />;
};

const AgentHistoryWorkspace: React.FC<AgentUnifiedHistoryPanelProps> = ({
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
      if (!validHistoryPage(response, targetPage, targetLimit)) {
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
    <section className="mn-agent-workspace agent-history" aria-label="Unified Agent transaction stream">
      <div className="agent-history__header">
        <div>
          <p className="agent-history__eyebrow">AGENT ACTIVITY · READ ONLY</p>
          <h4 className="mn-agent-workspace__title">Unified Agent Service Ledger Stream</h4>
          <p className="agent-history__intro">Review this Agent’s service transactions, including recorded fees, commissions and counterparties. Amounts and statuses are returned by the service.</p>
        </div>
        <button type="button" className="mn-agent-workspace__button agent-history__load" disabled={loading || forbidden} onClick={() => void fetchPage(1, limit, typeFilter)}>
          {loading ? 'Loading…' : data ? 'Refresh unified stream' : 'Load unified stream'}
        </button>
      </div>
      <div className="agent-history__filters">
        <label className="mn-agent-workspace__field">Service
          <select aria-label="Unified history service filter" value={typeFilter} disabled={loading || forbidden}
            onChange={(e) => { const next = e.target.value; setTypeFilter(next); if (data) void fetchPage(1, limit, next); }} className="mn-agent-workspace__input">
            <option value="">All services</option>
            {ADMIN_AGENT_UNIFIED_HISTORY_TYPES.map(serviceType => <option key={serviceType} value={serviceType}>{serviceType}</option>)}
          </select>
        </label>
        <label className="mn-agent-workspace__field">Page size
          <select aria-label="Unified history page size" value={String(limit)} disabled={loading || forbidden}
            onChange={(e) => { const next = Number(e.target.value) || 20; setLimit(next); if (data) void fetchPage(1, next, typeFilter); }} className="mn-agent-workspace__input">
            <option value="10">10 per page</option><option value="20">20 per page</option><option value="50">50 per page</option>
          </select>
        </label>
      </div>
      {!loading && !forbidden && !error && !data && <p className="agent-history__initial">Choose a service or page size, then load the stream. This view does not initiate transactions.</p>}
      {loading && <div className="agent-history__state" role="status" data-testid="agent-unified-history-loading">Loading unified Agent transaction history…</div>}
      {forbidden && <div className="agent-history__state agent-history__state--error" role="alert" data-testid="agent-unified-history-forbidden">You are not authorized to view unified transaction history for this Agent (403 Forbidden).</div>}
      {!forbidden && error && <div className="agent-history__state agent-history__state--error" role="alert" data-testid="agent-unified-history-error">{error}</div>}
      {!loading && !forbidden && data && <>
        <div className="agent-history__results" role="status"><strong>Transaction history</strong><span>{data.items.length} shown on this page · {data.pagination.total} total</span></div>
        {data.items.length === 0 ? <div className="agent-history__state" data-testid="agent-unified-history-empty">{data.pagination.page === 1 && data.pagination.total === 0 ? 'No unified Agent history entries found.' : 'No unified Agent history entries found on this page.'}</div> :
          <ol className="agent-history__list" aria-label="Agent transactions">
            {data.items.map(item => <li className="agent-history__item" key={item.id}>
              <div className="agent-history__item-head">
                <div><p className="agent-history__service">{item.type}</p><strong className="agent-history__amount">{formatMinor(item.amountMinor, item.currency)}</strong><p className="agent-history__direction">{item.direction}</p></div>
                <div className="agent-history__status"><span>{item.status}</span><small>Created {formatHistoryDate(item.createdAt)}</small>{item.completedAt && <small>Completed: {formatHistoryDate(item.completedAt)}</small>}</div>
              </div>
              <dl className="agent-history__facts">
                <div><dt>Reference</dt><dd><code>{item.reference || '—'}</code></dd>{item.narration && <small>{item.narration}</small>}</div>
                <div><dt>Counterparty</dt><dd>{formatCounterparty(item.counterparty)}</dd></div>
                {(item.feeMinor && item.feeMinor !== '0' || item.commission) && <div><dt>Fee and commission</dt>
                  {item.feeMinor && item.feeMinor !== '0' && <dd>Fee: {formatMinor(item.feeMinor, item.currency)}</dd>}
                  {item.commission && <dd>Commission: {formatMinor(item.commission.amountMinor, item.commission.currency)} ({item.commission.status})</dd>}
                </div>}
                {(item.failureCode || item.failureMessage) && <div className="agent-history__failure"><dt>Failure detail</dt><dd>{[item.failureCode, item.failureMessage].filter(Boolean).join(': ')}</dd></div>}
              </dl>
            </li>)}
          </ol>}
        <div className="agent-history__pager" data-testid="agent-unified-history-pager">
          <span>Page {data.pagination.page}{data.pagination.page <= Math.max(1, data.pagination.totalPages) ? ` of ${Math.max(1, data.pagination.totalPages)}` : ' (beyond last page)'} ({data.pagination.total} total)</span>
          <div><button type="button" className="mn-agent-workspace__button" disabled={loading || forbidden || data.pagination.page <= 1} onClick={() => void fetchPage(data.pagination.page - 1, limit, typeFilter)}>Previous</button>
          <button type="button" className="mn-agent-workspace__button" disabled={loading || forbidden || !data.pagination.hasNextPage} onClick={() => void fetchPage(data.pagination.page + 1, limit, typeFilter)}>Next</button></div>
        </div>
      </>}
    </section>
  );
};
