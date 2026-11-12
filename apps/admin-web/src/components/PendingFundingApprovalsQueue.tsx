import React, { useCallback, useEffect, useRef, useState } from 'react';
import './agent-workspaces.css';
import { formatMinorUnits } from '../utils/financial-display';
import { ApiClient } from '../services/api-client';
import { WorkspaceDrawer } from '../design-system/WorkspaceDrawer';

export interface PendingFundingQueueItem {
  id: string;
  approvalId: string;
  agentId: string;
  agentReference?: string | null;
  aggregatorId?: string | null;
  isAggregatorFunding?: boolean;
  direction: 'FUND' | 'DEFUND';
  amountMinor: string;
  currency: string;
  idempotencyKey?: string;
  reference?: string;
  correlationId?: string | null;
  description?: string;
  status: 'PENDING' | 'REJECTED' | 'EXECUTED' | string;
  approvalStatus: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CONSUMED' | 'EXPIRED' | string;
  approvalExpiresAt?: string | null;
  approvalApprovedBy?: string | null;
  reason: string;
  requesterPrincipalId: string;
  makerPrincipalId?: string;
  makerRole?: string;
  makerType?: string;
  checkerPrincipalId?: string | null;
  checkerRole?: string | null;
  checkerType?: string | null;
  journalId?: string | null;
  rejectionReason?: string | null;
  createdAt?: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  executedAt?: string | null;
}

export interface AgentFundingInboxQuery {
  status?: 'PENDING' | 'REJECTED' | 'EXECUTED';
  direction?: 'FUND' | 'DEFUND';
  page: number;
  limit: number;
}

export interface AgentFundingInboxPage {
  items: PendingFundingQueueItem[];
  page: number;
  limit: number;
  total: number;
}

export interface FundingInboxSelection {
  agentId: string;
  idempotencyKey?: string;
  requestId: string;
  approvalId: string;
}

export interface PendingFundingApprovalsQueueProps {
  /** Whether the funding inbox section should render on the screen. */
  canReviewFunding: boolean;
  /**
   * Whether this principal satisfies Decision 7 for GET /internal/agents/funding-requests
   * (non-SUPER_ADMIN FINANCE_CONTROLLER with MFA assurance and both agent.fund + agent.defund;
   * never requires agent.view). Defaults to true when omitted for isolated tests.
   */
  canAccessGlobalInbox?: boolean;
  /** Human-readable explanation when canAccessGlobalInbox is false. */
  unauthorizedReason?: string | null;
  /** Increment to trigger an automatic refresh after checker approve / execute / reject. */
  refreshTrigger?: number;
  /** Currently selected request ID in the Checker execution panel below. */
  activeRequestId?: string | null;
  /** Optional custom paginated loader; defaults to live GET /internal/agents/funding-requests. */
  loadInboxPage?: (query: AgentFundingInboxQuery) => Promise<AgentFundingInboxPage>;
  /** Legacy array loader compatibility for isolated component tests. */
  loadQueue?: () => Promise<PendingFundingQueueItem[]>;
  onSelectRequest: (
    agentId: string,
    idempotencyKey?: string,
    selection?: FundingInboxSelection,
  ) => void | boolean;
}

export async function fetchGlobalFundingInbox(
  query: AgentFundingInboxQuery,
): Promise<AgentFundingInboxPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(query.limit),
  });
  if (query.status) params.set('status', query.status);
  if (query.direction) params.set('direction', query.direction);
  return ApiClient.get<AgentFundingInboxPage>(
    `/internal/agents/funding-requests?${params.toString()}`,
  );
}

function formatMinor(value: string, currency: string): string {
  if (currency !== 'NGN') return formatMinorUnits(value, currency);
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

function formatTimestamp(raw?: string | null): string {
  if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? String(raw) : d.toLocaleString();
}

export const PendingFundingApprovalsQueue: React.FC<PendingFundingApprovalsQueueProps> = ({
  canReviewFunding,
  canAccessGlobalInbox = true,
  unauthorizedReason = null,
  refreshTrigger = 0,
  activeRequestId = null,
  loadInboxPage,
  loadQueue,
  onSelectRequest,
}) => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'REJECTED' | 'EXECUTED'>('PENDING');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'FUND' | 'DEFUND'>('ALL');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [items, setItems] = useState<PendingFundingQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forbiddenMessage, setForbiddenMessage] = useState('');
  const [unauthorizedSessionMessage, setUnauthorizedSessionMessage] = useState('');
  const [inspectedItem, setInspectedItem] = useState<PendingFundingQueueItem | null>(null);
  const [handoffCopiedId, setHandoffCopiedId] = useState<string | null>(null);
  const generation = useRef(0);
  const access = useRef({ canReviewFunding, canAccessGlobalInbox });
  access.current = { canReviewFunding, canAccessGlobalInbox };

  const effectiveLoader: (query: AgentFundingInboxQuery) => Promise<AgentFundingInboxPage> =
    useCallback(
      async (query: AgentFundingInboxQuery) => {
        if (loadInboxPage) {
          return loadInboxPage(query);
        }
        if (loadQueue) {
          const rows = await loadQueue();
          if (!Array.isArray(rows)) throw new Error('Invalid funding inbox response.');
          const safeRows = rows;
          const filtered = safeRows.filter((row) => {
            if (query.status && row.status !== query.status) return false;
            if (query.direction && row.direction !== query.direction) return false;
            return true;
          });
          const start = (query.page - 1) * query.limit;
          return {
            items: filtered.slice(start, start + query.limit),
            page: query.page,
            limit: query.limit,
            total: filtered.length,
          };
        }
        return fetchGlobalFundingInbox(query);
      },
      [loadInboxPage, loadQueue],
    );

  const loadPage = useCallback(
    async (
      targetPage: number,
      targetLimit: number,
      targetStatus: 'ALL' | 'PENDING' | 'REJECTED' | 'EXECUTED',
      targetDirection: 'ALL' | 'FUND' | 'DEFUND',
    ) => {
      if (!canReviewFunding || !canAccessGlobalInbox || forbiddenMessage) return;
      const current = ++generation.current;
      const valid = () => generation.current === current && access.current.canReviewFunding && access.current.canAccessGlobalInbox;
      setLoaded(false);
      setInspectedItem(null);
      setLoading(true);
      setError('');
      setUnauthorizedSessionMessage('');
      try {
        const res = await effectiveLoader({
          page: targetPage,
          limit: targetLimit,
          ...(targetStatus !== 'ALL' ? { status: targetStatus } : {}),
          ...(targetDirection !== 'ALL' ? { direction: targetDirection } : {}),
        });
        if (!valid()) return;
        if (!res || !Array.isArray(res.items) || typeof res.total !== 'number' || !Number.isFinite(res.total) || res.total < 0) throw new Error('Invalid funding inbox response.');
        const rows = res.items;
        setItems(rows);
        setTotal(res.total);
        setLoaded(true);
        setInspectedItem((cur) => (cur ? rows.find((r) => r.id === cur.id) ?? null : null));
      } catch (err: unknown) {
        if (!valid()) return;
        setItems([]);
        setInspectedItem(null);
        const status = (err as { status?: number } | null)?.status;
        const msg = err instanceof Error ? err.message : 'Failed to load global funding inbox.';
        if (status === 403) {
          setItems([]);
          setTotal(0);
          setInspectedItem(null);
          setForbiddenMessage(
            `Not entitled: ${msg || 'Global funding inbox requires a non-SUPER_ADMIN FINANCE_CONTROLLER with MFA assurance and both agent.fund and agent.defund.'}`,
          );
          return;
        }
        if (status === 401) {
          setItems([]);
          setTotal(0);
          setInspectedItem(null);
          setUnauthorizedSessionMessage(
            'Authentication required or session expired. Sign in again with MFA to view the funding inbox.',
          );
          return;
        }
        setError(msg);
      } finally {
        if (valid()) setLoading(false);
      }
    },
    [canAccessGlobalInbox, canReviewFunding, effectiveLoader, forbiddenMessage],
  );

  useEffect(() => {
    if (!canReviewFunding || !canAccessGlobalInbox || forbiddenMessage) return;
    void loadPage(page, limit, statusFilter, directionFilter);
    return () => { generation.current += 1; };
  }, [canReviewFunding, canAccessGlobalInbox, page, limit, statusFilter, directionFilter, refreshTrigger, loadPage, forbiddenMessage]);

  if (!canReviewFunding) return null;

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const buildHandoffJson = (item: PendingFundingQueueItem): string =>
    JSON.stringify({
      agentId: item.agentId,
      requestId: item.id,
      approvalId: item.approvalId,
      ...(item.idempotencyKey ? { idempotencyKey: item.idempotencyKey } : {}),
      direction: item.direction,
      amountMinor: item.amountMinor,
      currency: item.currency,
    });

  return (
    <section
      aria-label="Global pending funding discovery queue"
      className="mn-agent-workspace"
      data-testid="global-funding-inbox"
    >
      <div className="mn-agent-workspace__header">
        <div>
          <h3 className="mn-agent-workspace__title">Global Funding &amp; Defunding Approvals Inbox</h3>
          <p className="mn-agent-workspace__description">
            Live read-only checker discovery (<code>GET /internal/agents/funding-requests</code>). Own maker
            requests are excluded server-side; <code>agent.view</code> is not required.
          </p>
        </div>
        {canAccessGlobalInbox && !forbiddenMessage && (
          <button
            type="button"
            className="mn-agent-workspace__button"
            disabled={loading}
            onClick={() => void loadPage(page, limit, statusFilter, directionFilter)}
          >
            {loading ? 'Loading inbox…' : 'Refresh inbox'}
          </button>
        )}
      </div>

      {!canAccessGlobalInbox ? (
        <div
          style={styles.unauthorizedBox}
          role="status"
          data-testid="funding-inbox-unauthorized"
        >
          <strong>Not entitled to global funding inbox:</strong>{' '}
          {unauthorizedReason ||
            'Decision 7 requires a non-SUPER_ADMIN FINANCE_CONTROLLER signed in with MFA and holding both agent.fund and agent.defund.'}
        </div>
      ) : forbiddenMessage ? (
        <div
          style={styles.unauthorizedBox}
          role="status"
          data-testid="funding-inbox-unauthorized"
        >
          {forbiddenMessage}
        </div>
      ) : unauthorizedSessionMessage ? (
        <div
          style={styles.errorBox}
          role="alert"
          data-testid="funding-inbox-unauthorized"
        >
          {unauthorizedSessionMessage}
        </div>
      ) : (
        <>
          <div className="mn-agent-workspace__controls">
            <label className="mn-agent-workspace__field">
              Request status
              <select
                aria-label="Funding inbox status filter"
                value={statusFilter}
                disabled={loading}
                onChange={(e) => {
                  setStatusFilter(e.target.value as 'ALL' | 'PENDING' | 'REJECTED' | 'EXECUTED');
                  setPage(1);
                }}
                className="mn-agent-workspace__input"
              >
                <option value="PENDING">PENDING (awaiting checker action)</option>
                <option value="EXECUTED">EXECUTED</option>
                <option value="REJECTED">REJECTED</option>
                <option value="ALL">All statuses</option>
              </select>
            </label>

            <label className="mn-agent-workspace__field">
              Direction
              <select
                aria-label="Funding inbox direction filter"
                value={directionFilter}
                disabled={loading}
                onChange={(e) => {
                  setDirectionFilter(e.target.value as 'ALL' | 'FUND' | 'DEFUND');
                  setPage(1);
                }}
                className="mn-agent-workspace__input"
              >
                <option value="ALL">All directions</option>
                <option value="FUND">FUND</option>
                <option value="DEFUND">DEFUND</option>
              </select>
            </label>

            <label className="mn-agent-workspace__field">
              Page size
              <select
                aria-label="Funding inbox page size"
                value={String(limit)}
                disabled={loading}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="mn-agent-workspace__input"
              >
                <option value="10">10 per page</option>
                <option value="20">20 per page</option>
                <option value="50">50 per page</option>
              </select>
            </label>
          </div>

          {error && (
            <div style={styles.errorBox} role="alert" data-testid="funding-inbox-error">
              <span>{error}</span>{' '}
              <button
                type="button"
                className="mn-agent-workspace__button"
                disabled={loading}
                onClick={() => void loadPage(page, limit, statusFilter, directionFilter)}
              >
                Retry inbox
              </button>
            </div>
          )}

          {loading && !loaded ? (
            <div style={styles.loading} data-testid="funding-inbox-loading">
              Loading global funding inbox…
            </div>
          ) : loaded && items.length === 0 ? (
            <div style={styles.empty} data-testid="funding-inbox-empty">
              No funding instructions match these filters. Instructions initiated by your own principal are
              excluded by Decision 7 maker-checker separation.
            </div>
          ) : loaded ? (
            <div>
              <p className="mn-agent-workspace__description">Scroll horizontally to see all funding instruction columns.</p>
              <div className="mn-agent-workspace__scroll" role="region" aria-label="Funding instructions table" tabIndex={0}>
              <table className="mn-agent-workspace__table">
                <thead>
                  <tr>
                    <th style={styles.th}>Created / Expires</th>
                    <th style={styles.th}>Request / Approval</th>
                    <th style={styles.th}>Agent</th>
                    <th style={styles.th}>Direction &amp; Amount</th>
                    <th style={styles.th}>State</th>
                    <th style={styles.th}>Maker &amp; Reason</th>
                    <th style={styles.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isActiveTarget = activeRequestId === item.id;
                    return (
                      <tr
                        key={item.id}
                        style={isActiveTarget ? styles.activeRow : undefined}
                      >
                        <td style={styles.td}>
                          <div>{formatTimestamp(item.createdAt)}</div>
                          <div style={styles.muted}>Exp: {formatTimestamp(item.approvalExpiresAt)}</div>
                        </td>
                        <td style={styles.td}>
                          <code>{item.id}</code>
                          <div style={styles.muted}>
                            Approval: <code>{item.approvalId}</code>
                          </div>
                        </td>
                        <td style={styles.td}>
                          <strong>{item.agentReference || item.agentId}</strong>
                          {item.agentReference && (
                            <div style={styles.muted}>
                              <code>{item.agentId}</code>
                            </div>
                          )}
                        </td>
                        <td style={styles.td}>
                          <strong>{item.direction}</strong> · {formatMinor(item.amountMinor, item.currency)}
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge}>{item.status}</span>{' '}
                          <span style={styles.subBadge}>{item.approvalStatus}</span>
                        </td>
                        <td style={styles.td}>
                          <div>{item.reason}</div>
                          <div style={styles.muted}>
                            Maker: <code>{item.makerPrincipalId || item.requesterPrincipalId}</code>
                            {item.makerRole ? ` (${item.makerRole})` : ''}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.actionGroup}>
                            <button
                              type="button"
                              className="mn-agent-workspace__button"
                              onClick={() =>
                                setInspectedItem((cur) => (cur?.id === item.id ? null : item))
                              }
                            >
                              {inspectedItem?.id === item.id ? 'Hide details' : 'Inspect details'}
                            </button>
                            <button
                              type="button"
                              className="mn-agent-workspace__button mn-agent-workspace__button--primary"
                              onClick={() =>
                                onSelectRequest(item.agentId, item.idempotencyKey, {
                                  agentId: item.agentId,
                                  idempotencyKey: item.idempotencyKey,
                                  requestId: item.id,
                                  approvalId: item.approvalId,
                                })
                              }
                            >
                              {item.status === 'PENDING' ? 'Review in Checker' : 'Load in Checker'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          ) : null}

          {loaded && (
            <div style={styles.pager} data-testid="funding-inbox-pagination">
              <span>
                {total} request{total === 1 ? '' : 's'} · Page {page} of {totalPages}
              </span>
              <div style={styles.actionGroup}>
                <button
                  type="button"
                  className="mn-agent-workspace__button"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  className="mn-agent-workspace__button"
                  disabled={loading || page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next page
                </button>
              </div>
            </div>
          )}

          {loaded && !loading && !error && inspectedItem && (
            <WorkspaceDrawer label="Inspected funding request details" className="funding-inbox-drawer" onDismiss={() => setInspectedItem(null)}>
            <section
              aria-label="Inspected funding request details"
              data-testid="funding-inbox-detail"
              style={styles.detailCard}
            >
              <div style={styles.detailHeader}>
                <strong>
                  Funding Instruction Details — <code>{inspectedItem.id}</code>
                </strong>
                <div style={styles.actionGroup}>
                  <button
                    type="button"
                    className="mn-agent-workspace__button mn-agent-workspace__button--primary"
                    onClick={() => {
                      const accepted = onSelectRequest(inspectedItem.agentId, inspectedItem.idempotencyKey, {
                        agentId: inspectedItem.agentId,
                        idempotencyKey: inspectedItem.idempotencyKey,
                        requestId: inspectedItem.id,
                        approvalId: inspectedItem.approvalId,
                      });
                      if (accepted !== false) setInspectedItem(null);
                    }}
                  >
                    {inspectedItem.status === 'PENDING'
                      ? 'Proceed to Checker Decision'
                      : 'Open in Checker Recovery'}
                  </button>
                  <button
                    type="button"
                    className="mn-agent-workspace__button"
                    onClick={() => setInspectedItem(null)}
                  >
                    Close details
                  </button>
                </div>
              </div>

              <div style={styles.detailGrid}>
                <div>
                  <strong>Agent ID:</strong> <code>{inspectedItem.agentId}</code>
                  {inspectedItem.aggregatorId && (
                    <div>
                      <strong>Aggregator ID:</strong> <code>{inspectedItem.aggregatorId}</code>
                    </div>
                  )}
                </div>
                <div>
                  <strong>Direction &amp; Amount:</strong> {inspectedItem.direction} ·{' '}
                  {formatMinor(inspectedItem.amountMinor, inspectedItem.currency)} (
                  <code>{inspectedItem.amountMinor}</code> minor)
                </div>
                <div>
                  <strong>Request / Approval State:</strong> {inspectedItem.status} /{' '}
                  {inspectedItem.approvalStatus}
                </div>
                <div>
                  <strong>Approval ID:</strong> <code>{inspectedItem.approvalId}</code>
                </div>
                {inspectedItem.reference && (
                  <div>
                    <strong>Reference:</strong> <code>{inspectedItem.reference}</code>
                  </div>
                )}
                {inspectedItem.idempotencyKey && (
                  <div>
                    <strong>Idempotency Key:</strong> <code>{inspectedItem.idempotencyKey}</code>
                  </div>
                )}
                <div>
                  <strong>Maker:</strong>{' '}
                  <code>{inspectedItem.makerPrincipalId || inspectedItem.requesterPrincipalId}</code>
                  {inspectedItem.makerRole ? ` (${inspectedItem.makerRole})` : ''}
                </div>
                <div>
                  <strong>Approved / Checked By:</strong>{' '}
                  {inspectedItem.checkerPrincipalId || inspectedItem.approvalApprovedBy ? (
                    <code>{inspectedItem.checkerPrincipalId || inspectedItem.approvalApprovedBy}</code>
                  ) : (
                    'Awaiting checker'
                  )}
                </div>
                <div>
                  <strong>Created:</strong> {formatTimestamp(inspectedItem.createdAt)}
                </div>
                <div>
                  <strong>Approval Expires:</strong> {formatTimestamp(inspectedItem.approvalExpiresAt)}
                </div>
                {inspectedItem.executedAt && (
                  <div>
                    <strong>Executed:</strong> {formatTimestamp(inspectedItem.executedAt)}
                  </div>
                )}
                {inspectedItem.journalId && (
                  <div>
                    <strong>Ledger Journal ID:</strong> <code>{inspectedItem.journalId}</code>
                  </div>
                )}
                {inspectedItem.rejectionReason && (
                  <div>
                    <strong>Rejection Reason:</strong> {inspectedItem.rejectionReason}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                <strong>Business Reason:</strong> {inspectedItem.reason}
                {inspectedItem.description ? ` — ${inspectedItem.description}` : ''}
              </div>

              <div style={styles.handoffRow}>
                <strong>Maker-Checker Handoff Token:</strong>{' '}
                <code>{buildHandoffJson(inspectedItem)}</code>
                {typeof navigator !== 'undefined' && navigator.clipboard && (
                  <button
                    type="button"
                    className="mn-agent-workspace__button"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(buildHandoffJson(inspectedItem))
                        .then(() => setHandoffCopiedId(inspectedItem.id))
                        .catch(() => setHandoffCopiedId(null));
                    }}
                  >
                    {handoffCopiedId === inspectedItem.id ? 'Copied' : 'Copy handoff'}
                  </button>
                )}
              </div>
            </section>
            </WorkspaceDrawer>
          )}
        </>
      )}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    padding: 16,
    marginBottom: 16,
    background: '#FFFFFF',
    border: '1px solid #CBD5E1',
    borderRadius: 8,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  title: {
    margin: '0 0 4px',
    fontSize: 16,
    color: 'var(--mn-action-primary, #0b624a)',
  },
  subtitle: {
    margin: 0,
    fontSize: 12,
    color: 'var(--mn-text-secondary, #52655f)',
  },
  unauthorizedBox: {
    padding: 12,
    borderRadius: 6,
    background: '#FFFBEB',
    border: '1px solid #FCD34D',
    color: '#92400E',
    fontSize: 12,
    lineHeight: 1.5,
  },
  filterRow: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  filterLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--mn-text-primary, #132b25)',
  },
  select: {
    padding: '6px 8px',
    borderRadius: 5,
    border: '1px solid #CBD5E1',
    fontSize: 12,
  },
  button: {
    padding: '7px 12px',
    borderRadius: 6,
    border: '1px solid #CBD5E1',
    background: '#FFFFFF',
    color: 'var(--mn-text-primary, #132b25)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  smallButton: {
    padding: '5px 9px',
    borderRadius: 5,
    border: '1px solid #CBD5E1',
    background: '#FFFFFF',
    color: 'var(--mn-text-primary, #132b25)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
  },
  primaryButton: {
    padding: '6px 10px',
    borderRadius: 5,
    border: '1px solid var(--mn-action-primary, #0b624a)',
    background: 'var(--mn-action-primary, #0b624a)',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
  },
  errorBox: {
    padding: 10,
    marginBottom: 10,
    borderRadius: 6,
    background: '#FEF2F2',
    border: '1px solid #FCA5A5',
    color: '#991B1B',
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  loading: {
    padding: 18,
    textAlign: 'center',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: 12,
  },
  empty: {
    padding: 16,
    textAlign: 'center',
    color: 'var(--mn-text-secondary, #52655f)',
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    border: '1px dashed #CBD5E1',
    borderRadius: 6,
    fontSize: 12,
  },
  tableWrap: {
    width: '100%',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    textAlign: 'left',
    padding: '8px 6px',
    borderBottom: '1px solid var(--mn-border-subtle, #dde7e2)',
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: 11,
  },
  td: {
    padding: '8px 6px',
    borderBottom: '1px solid var(--mn-surface-sunken, #eef3f0)',
    verticalAlign: 'top',
  },
  activeRow: {
    background: '#ECFDF5',
  },
  actionGroup: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  muted: {
    color: 'var(--mn-text-secondary, #52655f)',
    fontSize: 11,
  },
  badge: {
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: 10,
    background: '#EFF6FF',
    color: '#1E40AF',
    fontWeight: 700,
    fontSize: 10,
  },
  subBadge: {
    display: 'inline-block',
    padding: '2px 7px',
    borderRadius: 10,
    background: 'var(--mn-surface-sunken, #eef3f0)',
    color: 'var(--mn-text-primary, #132b25)',
    fontWeight: 600,
    fontSize: 10,
  },
  pager: {
    marginTop: 10,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    fontSize: 12,
    color: 'var(--mn-text-secondary, #52655f)',
  },
  detailCard: {
    marginTop: 14,
    padding: 14,
    borderRadius: 6,
    border: '1px solid #CBD5E1',
    background: 'var(--mn-surface-canvas, #f5f8f6)',
    fontSize: 12,
    lineHeight: 1.5,
  },
  detailHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
    gap: 8,
  },
  handoffRow: {
    marginTop: 10,
    padding: 8,
    background: '#FFFFFF',
    border: '1px solid var(--mn-border-subtle, #dde7e2)',
    borderRadius: 5,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontSize: 11,
  },
};
