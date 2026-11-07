import './operational-surfaces.css';
import './system-health.css';
import { PageHeader } from '../../design-system/primitives';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { DataRecord, extractRecords, StructuredColumn, StructuredKeyValueList, StructuredRecordTable } from '../../components/StructuredData';

interface DeliveryFilters {
  status: string;
  channel: string;
  recipientType: string;
  eventType: string;
}

const DELIVERY_COLUMNS: StructuredColumn[] = [
  { key: 'eventType', label: 'Event' }, { key: 'channel', label: 'Channel' },
  { key: 'recipientType', label: 'Recipient type' }, { key: 'recipientId', label: 'Recipient ID' },
  { key: 'status', label: 'Status' }, { key: 'attempts', label: 'Attempts' },
  { key: 'providerRef', label: 'Provider reference' }, { key: 'createdAt', label: 'Created' },
  { key: 'sentAt', label: 'Sent' }, { key: 'errorCode', label: 'Error code' },
];

const OUTBOX_RECEIPT_COLUMNS: StructuredColumn[] = [
  { key: 'outboxEventId', label: 'Outbox Event ID' },
  { key: 'status', label: 'Status' },
  { key: 'reason', label: 'Reason' },
  { key: 'attempts', label: 'Attempts' },
  { key: 'nextAttemptAt', label: 'Next Attempt' },
  { key: 'updatedAt', label: 'Updated At' },
];

const OUTBOX_COLUMNS: StructuredColumn[] = [
  { key: 'eventType', label: 'Event' }, { key: 'aggregateType', label: 'Aggregate' },
  { key: 'aggregateId', label: 'Aggregate ID' }, { key: 'status', label: 'Status' },
  { key: 'attempts', label: 'Attempts' }, { key: 'occurredAt', label: 'Occurred' },
  { key: 'availableAt', label: 'Available' }, { key: 'lastError', label: 'Last error' },
];

const isRecord = (value: unknown): value is DataRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const validList = (value: unknown): boolean => {
  const rows = Array.isArray(value) ? value : isRecord(value) ? ['data','items','rows','records','results'].map(key => value[key]).find(Array.isArray) : null;
  return Array.isArray(rows) && rows.every(isRecord);
};
export const SystemHealthScreen: React.FC<{ onOpenNotifications?: () => void }> = (props) => {
  const principal = useAuthStore((state) => state.principal);
  const contextKey = JSON.stringify([principal?.principalId, principal?.sessionId, principal?.type, principal?.roles, principal?.scopes, principal?.assuranceLevel, principal?.customerAccess, principal?.readOnlyPrincipal]);
  return <SystemHealthWorkspace key={contextKey} {...props} />;
};
const SystemHealthWorkspace: React.FC<{ onOpenNotifications?: () => void }> = ({ onOpenNotifications }) => {
  const { principal } = useAuthStore();
  const generations = useRef({health:0, receipts:0});
  useEffect(() => () => { generations.current.health++; generations.current.receipts++; }, []);
  const canViewMetrics = principal?.scopes.includes('metrics.view') ?? false;
  const canViewDiagnostics = principal?.scopes.includes('diagnostics.view') ?? false;
  const canViewOutbox = principal?.scopes.includes('outbox.view') ?? false;
  const canViewDeliveries = principal?.scopes.includes('notification.view_deliveries') ?? false;
  const canViewAny = canViewMetrics || canViewDiagnostics || canViewOutbox || canViewDeliveries;

  const [metrics, setMetrics] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<DataRecord | null>(null);
  const [outbox, setOutbox] = useState<unknown>(null);
  const [deliveries, setDeliveries] = useState<any>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryStatus, setDeliveryStatus] = useState('');
  const [deliveryChannel, setDeliveryChannel] = useState('');
  const [deliveryRecipientType, setDeliveryRecipientType] = useState('');
  const [deliveryEventInput, setDeliveryEventInput] = useState('');
  const [appliedDeliveryFilters, setAppliedDeliveryFilters] = useState<DeliveryFilters>({
    status: '',
    channel: '',
    recipientType: '',
    eventType: '',
  });
  const [outboxReceipts, setOutboxReceipts] = useState<any>(null);
  const [outboxReceiptsLoading, setOutboxReceiptsLoading] = useState(false);
  const [outboxReceiptsError, setOutboxReceiptsError] = useState('');

  const fetchOutboxReceiptsOnDemand = useCallback(async (statusFilter = '') => {
    if (!canViewDeliveries) return;
    const generation = ++generations.current.receipts;
    setOutboxReceipts(null);
    setOutboxReceiptsLoading(true);
    setOutboxReceiptsError('');
    try {
      const q = new URLSearchParams({ page: '1', limit: '20' });
      if (statusFilter) q.set('status', statusFilter);
      const res = await ApiClient.get(`/internal/notifications/outbox-receipts?${q.toString()}`);
      if (generation !== generations.current.receipts) return;
      if (!validList(res)) throw new Error('Notification outbox receipts returned an invalid response.');
      setOutboxReceipts(res);
    } catch (err: any) {
      if (generation === generations.current.receipts) setOutboxReceiptsError(err?.message || 'Notification outbox receipts unavailable');
    } finally {
      if (generation === generations.current.receipts) setOutboxReceiptsLoading(false);
    }
  }, [canViewDeliveries]);

  const fetchAll = useCallback(async () => {
    const generation = ++generations.current.health;
    setLoading(true);
    setLoadErrors({});
    const requests: Promise<void>[] = [];

    if (canViewMetrics) {
      requests.push(ApiClient.get('/internal/metrics').then(value => { if (!isRecord(value) || !isRecord(value.metrics)) throw new Error('Metrics returned an invalid response.'); if (generation === generations.current.health) setMetrics(value); }).catch((err: any) => {
        if (generation !== generations.current.health) return;
        setLoadErrors((prev) => ({ ...prev, metrics: err?.message || 'Metrics unavailable' }));
      }));
    }
    if (canViewDiagnostics) {
      requests.push(ApiClient.get<DataRecord>('/internal/diagnostics').then(value => { if (!isRecord(value) || typeof value.status !== 'string') throw new Error('Diagnostics returned an invalid response.'); if (generation === generations.current.health) setDiagnostics(value); }).catch((err: any) => {
        if (generation !== generations.current.health) return;
        setLoadErrors((prev) => ({ ...prev, diagnostics: err?.message || 'Diagnostics unavailable' }));
      }));
    }
    if (canViewOutbox) {
      requests.push(ApiClient.get('/internal/outbox').then(value => { if (!validList(value)) throw new Error('Outbox returned an invalid response.'); if (generation === generations.current.health) setOutbox(value); }).catch((err: any) => {
        if (generation !== generations.current.health) return;
        setLoadErrors((prev) => ({ ...prev, outbox: err?.message || 'Outbox unavailable' }));
      }));
    }
    if (canViewDeliveries) {
      const query = new URLSearchParams({ page: String(deliveryPage), limit: '20' });
      if (appliedDeliveryFilters.status) query.set('status', appliedDeliveryFilters.status);
      if (appliedDeliveryFilters.channel) query.set('channel', appliedDeliveryFilters.channel);
      if (appliedDeliveryFilters.recipientType) query.set('recipientType', appliedDeliveryFilters.recipientType);
      if (appliedDeliveryFilters.eventType) query.set('eventType', appliedDeliveryFilters.eventType);
      requests.push(ApiClient.get(`/internal/notifications/deliveries?${query.toString()}`).then(value => { if (!isRecord(value) || !validList(value) || !Number.isSafeInteger(value.total) || (value.total as number) < 0 || value.page !== deliveryPage || typeof value.hasNextPage !== 'boolean') throw new Error('Notification deliveries returned an invalid or mismatched response.'); if (generation === generations.current.health) setDeliveries(value); }).catch((err: any) => {
        if (generation !== generations.current.health) return;
        setLoadErrors((prev) => ({ ...prev, deliveries: err?.message || 'Notification deliveries unavailable' }));
      }));
    }

    await Promise.all(requests);
    if (generation === generations.current.health) setLoading(false);
  }, [canViewMetrics, canViewDiagnostics, canViewOutbox, canViewDeliveries, deliveryPage, appliedDeliveryFilters]);

  useEffect(() => {
    if (canViewAny) void fetchAll();
    else setLoading(false);
  }, [canViewAny, fetchAll]);

  const metricRows = useMemo(() => {
    const values = metrics?.metrics && typeof metrics.metrics === 'object' ? metrics.metrics : {};
    return Object.entries(values as Record<string, unknown>).map(([metric, value]) => ({ metric, value }));
  }, [metrics]);
  const deliveryRows = extractRecords(deliveries);
  const outboxRows = extractRecords(outbox);
  const deliveryHasNextPage = Boolean(deliveries?.hasNextPage);
  const deliveryTotal = Number(deliveries?.total ?? deliveryRows.length);
  const deliveryCurrentPage = Number(deliveries?.page ?? deliveryPage);

  const applyDeliveryFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setDeliveryPage(1);
    setAppliedDeliveryFilters({
      status: deliveryStatus,
      channel: deliveryChannel,
      recipientType: deliveryRecipientType,
      eventType: deliveryEventInput.trim(),
    });
  };

  if (!canViewAny) {
    return (
      <div className="mn-operational" style={wrap} role="alert">
        <div style={denied}>
          This screen requires at least one of <code>metrics.view</code>, <code>diagnostics.view</code>, <code>outbox.view</code>, or <code>notification.view_deliveries</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="mn-operational mn-system-health" style={wrap}>
      <PageHeader eyebrow="System administration" title="System Health" description="Read-only operational data. Each panel is requested only when its matching function is granted." />
      <button type="button" onClick={() => void fetchAll()} style={btn} disabled={loading}>
        {loading ? 'Loading…' : 'Refresh'}
      </button>

      {loading ? <div style={loadingBox}>Loading health data…</div> : (
        <>
          <div style={grid}>
            {canViewMetrics && (
              <section style={card} aria-label="Metrics">
                <h3 style={h4}>Metrics</h3>
                {loadErrors.metrics ? <div style={errBox}>{loadErrors.metrics}</div> : (
                  <>
                    <p style={muted}>Generated {metrics?.generatedAt ? new Date(metrics.generatedAt).toLocaleString() : 'time unavailable'}</p>
                    <StructuredRecordTable
                      rows={metricRows}
                      columns={[{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }]}
                      showDetails={false}
                      emptyMessage="No metric values were returned."
                    />
                  </>
                )}
              </section>
            )}

            {canViewDiagnostics && (
              <section style={card} aria-label="Diagnostics">
                <h3 style={h4}>Diagnostics</h3>
                {loadErrors.diagnostics ? <div style={errBox}>{loadErrors.diagnostics}</div> : (
                  <StructuredKeyValueList data={diagnostics} />
                )}
              </section>
            )}
          </div>

          {canViewOutbox && (
            <section style={card} aria-label="Outbox recent events">
              <h3 style={h4}>Outbox (recent events)</h3>
              {loadErrors.outbox ? <div style={errBox}>{loadErrors.outbox}</div> : (
                <StructuredRecordTable rows={outboxRows} columns={OUTBOX_COLUMNS} emptyMessage="No outbox events were returned." />
              )}
            </section>
          )}

          {canViewDeliveries && (
            <section style={card} aria-label="Notification deliveries">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={h4}>Notification Deliveries</h3>
                {onOpenNotifications && (
                  <button
                    type="button"
                    style={smallBtn}
                    data-testid="open-notification-management-btn"
                    onClick={onOpenNotifications}
                  >
                    Manage SMS & Email Notifications →
                  </button>
                )}
              </div>
              {!loadErrors.deliveries && <p style={muted}>
                Read-only delivery diagnostics. Showing loaded page ({deliveryRows.length} rows on Page {deliveryCurrentPage}) out of {deliveryTotal} matching delivery records.
              </p>}
              <form onSubmit={applyDeliveryFilters} style={filterRow}>
                <label style={filterLabel}>Status
                  <select value={deliveryStatus} onChange={(event) => setDeliveryStatus(event.target.value)} style={select}>
                    <option value="">All</option><option value="PENDING">PENDING</option>
                    <option value="SENT">SENT</option><option value="FAILED">FAILED</option>
                    <option value="DEAD">DEAD</option><option value="UNKNOWN">UNKNOWN</option>
                    <option value="SKIPPED">SKIPPED</option>
                  </select>
                </label>
                <label style={filterLabel}>Channel
                  <select value={deliveryChannel} onChange={(event) => setDeliveryChannel(event.target.value)} style={select}>
                    <option value="">All</option><option value="SMS">SMS</option><option value="EMAIL">EMAIL</option><option value="PUSH">PUSH</option>
                  </select>
                </label>
                <label style={filterLabel}>Recipient type
                  <select value={deliveryRecipientType} onChange={(event) => setDeliveryRecipientType(event.target.value)} style={select}>
                    <option value="">All</option><option value="CUSTOMER">CUSTOMER</option><option value="AGENT">AGENT</option><option value="PHONE">PHONE</option><option value="WORKFORCE">WORKFORCE</option>
                  </select>
                </label>
                <label style={filterLabel}>Event type
                  <input value={deliveryEventInput} onChange={(event) => setDeliveryEventInput(event.target.value)} maxLength={180} style={input} />
                </label>
                <button type="submit" style={smallBtn} disabled={loading}>Search</button>
              </form>
              {loadErrors.deliveries ? <div style={errBox}>{loadErrors.deliveries}</div> : (
                <>
                  <StructuredRecordTable
                    rows={deliveryRows}
                    columns={DELIVERY_COLUMNS}
                    emptyMessage="No notification deliveries were returned for these filters."
                  />
                  <div style={pager}>
                    <span>Showing {deliveryRows.length} of {deliveryTotal} matching deliveries · Page {deliveryCurrentPage}</span>
                    <button type="button" style={smallBtn} disabled={deliveryPage <= 1 || loading} onClick={() => setDeliveryPage((page) => Math.max(1, page - 1))}>Previous</button>
                    <button type="button" style={smallBtn} disabled={!deliveryHasNextPage || loading} onClick={() => setDeliveryPage((page) => page + 1)}>Next</button>
                    <button
                      type="button"
                      style={smallBtn}
                      data-testid="system-health-load-outbox-receipts-btn"
                      disabled={outboxReceiptsLoading}
                      onClick={() => void fetchOutboxReceiptsOnDemand()}
                    >
                      {outboxReceiptsLoading ? 'Loading receipts…' : 'Inspect Outbox Receipts'}
                    </button>
                  </div>
                </>
              )}
              {outboxReceiptsError && <div role="alert" style={{ ...errBox, marginTop: 10 }}>{outboxReceiptsError}</div>}
              {outboxReceipts && (
                <div style={{ marginTop: 12 }} data-testid="system-health-outbox-receipts-panel">
                  <h4 style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--mn-text-primary, #132b25)' }}>
                    Notification Outbox Receipts (<code>GET /internal/notifications/outbox-receipts</code>)
                  </h4>
                  <StructuredRecordTable
                    rows={extractRecords(outboxReceipts)}
                    columns={OUTBOX_RECEIPT_COLUMNS}
                    emptyMessage="No notification outbox receipts returned."
                  />
                </div>
              )}
            </section>
          )}
        </>
      )}

      <div style={note}>
        Operational panels are read-only; this screen does not mutate delivery, reconciliation, or ledger state. Each panel is backed by server-side catalogue function enforcement (<code>metrics.view</code>, <code>diagnostics.view</code>, <code>outbox.view</code>, and <code>notification.view_deliveries</code>).
      </div>
    </div>
  );
};

const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1200 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: 'var(--mn-nav-surface-deep, #082f23)' };
const sub: React.CSSProperties = { color: 'var(--mn-text-secondary, #52655f)', fontSize: 13, marginBottom: 12 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid var(--mn-border-subtle, #dde7e2)', background: '#fff', cursor: 'pointer', marginBottom: 12 };
const smallBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer', fontSize: 12 };
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: 'var(--mn-text-secondary, #52655f)' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12, marginBottom: 12 };
const card: React.CSSProperties = { padding: 16, background: '#fff', border: '1px solid var(--mn-border-subtle, #dde7e2)', borderRadius: 8, marginBottom: 12 };
const h4: React.CSSProperties = { margin: '0 0 8px', fontSize: 15, color: 'var(--mn-text-primary, #132b25)' };
const muted: React.CSSProperties = { color: 'var(--mn-text-secondary, #52655f)', fontSize: 12, margin: '0 0 10px' };
const filterRow: React.CSSProperties = { display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap', marginBottom: 12 };
const filterLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--mn-text-secondary, #52655f)', fontSize: 12 };
const select: React.CSSProperties = { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', minWidth: 120 };
const input: React.CSSProperties = { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 6, minWidth: 180 };
const pager: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10, color: 'var(--mn-text-secondary, #52655f)', fontSize: 12 };
const note: React.CSSProperties = { marginTop: 16, fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', background: 'var(--mn-surface-canvas, #f5f8f6)', padding: 10, borderRadius: 6, border: '1px solid var(--mn-border-subtle, #dde7e2)' };
