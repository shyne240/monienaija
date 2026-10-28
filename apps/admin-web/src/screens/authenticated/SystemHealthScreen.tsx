import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { useAuthStore } from '../../store/auth-store';
import { DataRecord, extractRecords, StructuredColumn, StructuredKeyValueList, StructuredRecordTable } from '../../components/StructuredData';

interface DeliveryFilters {
  status: string;
  channel: string;
  eventType: string;
}

const DELIVERY_COLUMNS: StructuredColumn[] = [
  { key: 'eventType', label: 'Event' }, { key: 'channel', label: 'Channel' },
  { key: 'recipientType', label: 'Recipient type' }, { key: 'recipientId', label: 'Recipient ID' },
  { key: 'status', label: 'Status' }, { key: 'attempts', label: 'Attempts' },
  { key: 'providerRef', label: 'Provider reference' }, { key: 'createdAt', label: 'Created' },
  { key: 'sentAt', label: 'Sent' }, { key: 'errorCode', label: 'Error code' },
];

const OUTBOX_COLUMNS: StructuredColumn[] = [
  { key: 'eventType', label: 'Event' }, { key: 'aggregateType', label: 'Aggregate' },
  { key: 'aggregateId', label: 'Aggregate ID' }, { key: 'status', label: 'Status' },
  { key: 'attempts', label: 'Attempts' }, { key: 'occurredAt', label: 'Occurred' },
  { key: 'availableAt', label: 'Available' }, { key: 'lastError', label: 'Last error' },
];

export const SystemHealthScreen: React.FC<{ onOpenNotifications?: () => void }> = ({ onOpenNotifications }) => {
  const { principal } = useAuthStore();
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
  const [deliveryEventInput, setDeliveryEventInput] = useState('');
  const [appliedDeliveryFilters, setAppliedDeliveryFilters] = useState<DeliveryFilters>({ status: '', channel: '', eventType: '' });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadErrors({});
    const requests: Promise<void>[] = [];

    if (canViewMetrics) {
      requests.push(ApiClient.get('/internal/metrics').then(setMetrics).catch((err: any) => {
        setLoadErrors((prev) => ({ ...prev, metrics: err?.message || 'Metrics unavailable' }));
      }));
    }
    if (canViewDiagnostics) {
      requests.push(ApiClient.get<DataRecord>('/internal/diagnostics').then(setDiagnostics).catch((err: any) => {
        setLoadErrors((prev) => ({ ...prev, diagnostics: err?.message || 'Diagnostics unavailable' }));
      }));
    }
    if (canViewOutbox) {
      requests.push(ApiClient.get('/internal/outbox').then(setOutbox).catch((err: any) => {
        setLoadErrors((prev) => ({ ...prev, outbox: err?.message || 'Outbox unavailable' }));
      }));
    }
    if (canViewDeliveries) {
      const query = new URLSearchParams({ page: String(deliveryPage), limit: '20' });
      if (appliedDeliveryFilters.status) query.set('status', appliedDeliveryFilters.status);
      if (appliedDeliveryFilters.channel) query.set('channel', appliedDeliveryFilters.channel);
      if (appliedDeliveryFilters.eventType) query.set('eventType', appliedDeliveryFilters.eventType);
      requests.push(ApiClient.get(`/internal/notifications/deliveries?${query.toString()}`).then(setDeliveries).catch((err: any) => {
        setLoadErrors((prev) => ({ ...prev, deliveries: err?.message || 'Notification deliveries unavailable' }));
      }));
    }

    await Promise.all(requests);
    setLoading(false);
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
      eventType: deliveryEventInput.trim(),
    });
  };

  if (!canViewAny) {
    return (
      <div style={wrap} role="alert">
        <div style={denied}>
          This screen requires at least one of <code>metrics.view</code>, <code>diagnostics.view</code>, <code>outbox.view</code>, or <code>notification.view_deliveries</code>.
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h2 style={h2}>🩺 System Health</h2>
      <p style={sub}>Read-only operational data. Each panel is requested only when its matching function is granted.</p>
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
              <p style={muted}>Read-only delivery diagnostics. Filters are applied by the existing paginated API.</p>
              <form onSubmit={applyDeliveryFilters} style={filterRow}>
                <label style={filterLabel}>Status
                  <select value={deliveryStatus} onChange={(event) => setDeliveryStatus(event.target.value)} style={select}>
                    <option value="">All</option><option value="PENDING">PENDING</option>
                    <option value="SENT">SENT</option><option value="FAILED">FAILED</option><option value="SKIPPED">SKIPPED</option>
                  </select>
                </label>
                <label style={filterLabel}>Channel
                  <select value={deliveryChannel} onChange={(event) => setDeliveryChannel(event.target.value)} style={select}>
                    <option value="">All</option><option value="SMS">SMS</option><option value="EMAIL">EMAIL</option><option value="PUSH">PUSH</option>
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
                    <span>{deliveryTotal} deliveries · Page {deliveryCurrentPage}</span>
                    <button type="button" style={smallBtn} disabled={deliveryPage <= 1 || loading} onClick={() => setDeliveryPage((page) => Math.max(1, page - 1))}>Previous</button>
                    <button type="button" style={smallBtn} disabled={!deliveryHasNextPage || loading} onClick={() => setDeliveryPage((page) => page + 1)}>Next</button>
                  </div>
                </>
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

const wrap: React.CSSProperties = { padding: '24px', maxWidth: 1200 };
const h2: React.CSSProperties = { margin: '0 0 8px', color: '#032B14' };
const sub: React.CSSProperties = { color: '#64748B', fontSize: 13, marginBottom: 12 };
const btn: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E2E8F0', background: '#fff', cursor: 'pointer', marginBottom: 12 };
const smallBtn: React.CSSProperties = { padding: '7px 11px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', cursor: 'pointer', fontSize: 12 };
const errBox: React.CSSProperties = { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 };
const loadingBox: React.CSSProperties = { padding: 20, textAlign: 'center', color: '#64748B' };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 12 };
const card: React.CSSProperties = { padding: 16, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 8, marginBottom: 12 };
const h4: React.CSSProperties = { margin: '0 0 8px', fontSize: 15, color: '#334155' };
const muted: React.CSSProperties = { color: '#64748B', fontSize: 12, margin: '0 0 10px' };
const filterRow: React.CSSProperties = { display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap', marginBottom: 12 };
const filterLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, color: '#475569', fontSize: 12 };
const select: React.CSSProperties = { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', minWidth: 120 };
const input: React.CSSProperties = { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 6, minWidth: 180 };
const pager: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: '#64748B', fontSize: 12 };
const note: React.CSSProperties = { marginTop: 16, fontSize: 12, color: '#64748B', background: '#F8FAFC', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' };
