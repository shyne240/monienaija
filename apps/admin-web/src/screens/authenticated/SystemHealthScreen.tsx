import './operational-surfaces.css';
import './system-health.css';
import { Button, PageHeader } from '../../design-system/primitives';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../../services/api-client';
import { NotificationManagementApi } from '../../services/notification-management-api';
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
  const generations = useRef({health:0, deliveries:0, receipts:0});
  useEffect(() => () => { generations.current.health++; generations.current.deliveries++; generations.current.receipts++; }, []);
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
  const [panelLoading, setPanelLoading] = useState<Record<string, boolean>>({ metrics: canViewMetrics, diagnostics: canViewDiagnostics, outbox: canViewOutbox });
  const [deliveryLoading, setDeliveryLoading] = useState(canViewDeliveries);

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
      const res = await NotificationManagementApi.listOutboxReceipts({ page: 1, limit: 20, status: statusFilter || undefined });
      if (generation !== generations.current.receipts) return;
      if (res.status === 'BLOCKED') throw new Error(res.message);
      setOutboxReceipts(res.data);
    } catch (err: any) {
      if (generation === generations.current.receipts) setOutboxReceiptsError(err?.message || 'Notification outbox receipts unavailable');
    } finally {
      if (generation === generations.current.receipts) setOutboxReceiptsLoading(false);
    }
  }, [canViewDeliveries]);

  const fetchCore = useCallback(() => {
    const generation = ++generations.current.health;
    setLoadErrors(previous => ({ ...previous, metrics: '', diagnostics: '', outbox: '' }));
    setPanelLoading({ metrics: canViewMetrics, diagnostics: canViewDiagnostics, outbox: canViewOutbox });
    const read = (key: string, path: string, validate: (value: unknown) => boolean, commit: (value: any) => void) => {
      void ApiClient.get(path).then(value => {
        if (!validate(value)) throw new Error(`${key === 'metrics' ? 'Metrics' : key === 'diagnostics' ? 'Diagnostics' : 'Outbox'} returned an invalid response.`);
        if (generation === generations.current.health) commit(value);
      }).catch((err: any) => {
        if (generation === generations.current.health) setLoadErrors(previous => ({ ...previous, [key]: err?.message || `${key} unavailable` }));
      }).finally(() => {
        if (generation === generations.current.health) setPanelLoading(previous => ({ ...previous, [key]: false }));
      });
    };
    if (canViewMetrics) read('metrics', '/internal/metrics', value => isRecord(value) && isRecord(value.metrics), setMetrics);
    if (canViewDiagnostics) read('diagnostics', '/internal/diagnostics', value => isRecord(value) && typeof value.status === 'string', setDiagnostics);
    if (canViewOutbox) read('outbox', '/internal/outbox', validList, setOutbox);
  }, [canViewMetrics, canViewDiagnostics, canViewOutbox]);

  const fetchDeliveries = useCallback(async () => {
    if (!canViewDeliveries) return;
    const generation = ++generations.current.deliveries;
    setDeliveryLoading(true); setDeliveries(null);
    setLoadErrors(previous => ({ ...previous, deliveries: '' }));
    try {
      const result = await NotificationManagementApi.listDeliveries({ page: deliveryPage, limit: 20,
        status: appliedDeliveryFilters.status || undefined, channel: appliedDeliveryFilters.channel || undefined,
        recipientType: appliedDeliveryFilters.recipientType || undefined, eventType: appliedDeliveryFilters.eventType || undefined });
      if (generation !== generations.current.deliveries) return;
      if (result.status === 'BLOCKED') throw new Error(result.message);
      setDeliveries(result.data);
    } catch (err: any) {
      if (generation === generations.current.deliveries) setLoadErrors(previous => ({ ...previous, deliveries: err?.message || 'Notification deliveries unavailable' }));
    } finally {
      if (generation === generations.current.deliveries) setDeliveryLoading(false);
    }
  }, [canViewDeliveries, deliveryPage, appliedDeliveryFilters]);

  useEffect(() => { fetchCore(); }, [fetchCore]);
  useEffect(() => { void fetchDeliveries(); }, [fetchDeliveries]);
  const loading = Object.values(panelLoading).some(Boolean) || deliveryLoading;

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

  const draftChanged = deliveryStatus !== appliedDeliveryFilters.status || deliveryChannel !== appliedDeliveryFilters.channel || deliveryRecipientType !== appliedDeliveryFilters.recipientType || deliveryEventInput.trim() !== appliedDeliveryFilters.eventType;
  const appliedSummary = [appliedDeliveryFilters.status && `Status: ${appliedDeliveryFilters.status}`, appliedDeliveryFilters.channel && `Channel: ${appliedDeliveryFilters.channel}`, appliedDeliveryFilters.recipientType && `Recipient: ${appliedDeliveryFilters.recipientType}`, appliedDeliveryFilters.eventType && `Event: ${appliedDeliveryFilters.eventType}`].filter(Boolean).join(' · ') || 'All deliveries';
  const refresh = () => { fetchCore(); void fetchDeliveries(); };

  return (
    <div className="mn-operational mn-system-health health-redesign" style={wrap}>
      <PageHeader eyebrow="System administration" title="System Health" description="Read-only operational data. Each panel is requested only when its matching function is granted." />
      <div className="health-redesign__boundary" role="note"><strong>Read-only diagnostics</strong><span>Metrics, diagnostics, outbox events and notification receipts are separate sources; one does not imply the health or delivery state of another. No workers or deliveries are started here.</span></div>
      <div className="health-redesign__toolbar"><nav className="health-redesign__nav" aria-label="System health sections">
        {canViewMetrics && <a href="#health-metrics">Metrics</a>}{canViewDiagnostics && <a href="#health-diagnostics">Diagnostics</a>}{canViewOutbox && <a href="#health-outbox">Outbox events</a>}{canViewDeliveries && <a href="#health-deliveries">Deliveries &amp; receipts</a>}
      </nav><Button onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button></div>
      <div className="health-redesign__overview">
        {canViewMetrics && <section id="health-metrics" tabIndex={-1} className="health-redesign__panel" aria-label="Metrics">
          <p className="health-redesign__eyebrow">OPERATIONAL METRICS</p><h2>Metrics</h2>
          {panelLoading.metrics ? <div className="health-redesign__state" role="status">Loading metrics…</div> : loadErrors.metrics ? <div className="health-redesign__error" role="alert">{loadErrors.metrics}</div> : <>
            <p className="health-redesign__sub">Generated {metrics?.generatedAt && Number.isFinite(new Date(metrics.generatedAt).getTime()) ? new Date(metrics.generatedAt).toLocaleString() : 'time unavailable'}</p>
            <StructuredRecordTable rows={metricRows} columns={[{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }]} showDetails={false} emptyMessage="No metric values were returned." />
          </>}
        </section>}
        {canViewDiagnostics && <section id="health-diagnostics" tabIndex={-1} className="health-redesign__panel" aria-label="Diagnostics">
          <p className="health-redesign__eyebrow">SERVICE DIAGNOSTICS</p><h2>Diagnostics</h2>
          {panelLoading.diagnostics ? <div className="health-redesign__state" role="status">Loading diagnostics…</div> : loadErrors.diagnostics ? <div className="health-redesign__error" role="alert">{loadErrors.diagnostics}</div> : <StructuredKeyValueList data={diagnostics} />}
        </section>}
      </div>
      {canViewOutbox && <section id="health-outbox" tabIndex={-1} className="health-redesign__panel" aria-label="Outbox recent events">
        <p className="health-redesign__eyebrow">EVENT TRANSPORT</p><h2>Outbox (recent events)</h2><p className="health-redesign__sub">Recent records returned by the outbox service; this is not a delivery history.</p>
        {panelLoading.outbox ? <div className="health-redesign__state" role="status">Loading outbox events…</div> : loadErrors.outbox ? <div className="health-redesign__error" role="alert">{loadErrors.outbox}</div> : <StructuredRecordTable rows={outboxRows} columns={OUTBOX_COLUMNS} emptyMessage="No outbox events were returned." />}
      </section>}
      {canViewDeliveries && <section id="health-deliveries" tabIndex={-1} className="health-redesign__panel" aria-label="Notification deliveries">
        <div className="health-redesign__heading"><div><p className="health-redesign__eyebrow">NOTIFICATION OBSERVABILITY</p><h2>Notification Deliveries</h2><p className="health-redesign__sub">Read-only delivery diagnostics. Filtered results and outbox receipts are separate reads.</p></div>
          {onOpenNotifications && <Button size="sm" data-testid="open-notification-management-btn" onClick={onOpenNotifications}>Manage SMS &amp; Email Notifications →</Button>}
        </div>
        <form onSubmit={applyDeliveryFilters} className="health-redesign__filters" aria-label="Delivery filters">
          <label>Status<select value={deliveryStatus} onChange={event => setDeliveryStatus(event.target.value)}><option value="">All</option><option value="PENDING">PENDING</option><option value="SENT">SENT</option><option value="FAILED">FAILED</option><option value="DEAD">DEAD</option><option value="UNKNOWN">UNKNOWN</option><option value="SKIPPED">SKIPPED</option></select></label>
          <label>Channel<select value={deliveryChannel} onChange={event => setDeliveryChannel(event.target.value)}><option value="">All</option><option value="SMS">SMS</option><option value="EMAIL">EMAIL</option><option value="PUSH">PUSH</option></select></label>
          <label>Recipient type<select value={deliveryRecipientType} onChange={event => setDeliveryRecipientType(event.target.value)}><option value="">All</option><option value="CUSTOMER">CUSTOMER</option><option value="AGENT">AGENT</option><option value="PHONE">PHONE</option><option value="WORKFORCE">WORKFORCE</option></select></label>
          <label>Event type<input value={deliveryEventInput} onChange={event => setDeliveryEventInput(event.target.value)} maxLength={180} /></label>
          <Button type="submit" variant="primary">Search</Button>
        </form>
        <p className="health-redesign__applied">Applied filters: {appliedSummary}{draftChanged && <strong> · Filters changed; search to apply.</strong>}</p>
        {deliveryLoading ? <div className="health-redesign__state" role="status">Loading notification deliveries…</div> : loadErrors.deliveries ? <div className="health-redesign__error" role="alert">{loadErrors.deliveries}</div> : deliveries && <>
          <p className="health-redesign__sub">Read-only delivery diagnostics. Showing loaded page ({deliveryRows.length} rows on Page {deliveryCurrentPage}) out of {deliveryTotal} matching delivery records.</p>
          <StructuredRecordTable rows={deliveryRows} columns={DELIVERY_COLUMNS} emptyMessage="No notification deliveries were returned for these filters." />
          <div className="health-redesign__pager"><span>Showing {deliveryRows.length} of {deliveryTotal} matching deliveries · Page {deliveryCurrentPage}</span>
            <Button size="sm" disabled={deliveryPage <= 1 || deliveryLoading} onClick={() => setDeliveryPage(page => Math.max(1, page - 1))}>Previous</Button>
            <Button size="sm" disabled={!deliveryHasNextPage || deliveryLoading} onClick={() => setDeliveryPage(page => page + 1)}>Next</Button>
          </div>
        </>}
        <section className="health-redesign__receipts" aria-label="Notification outbox receipts">
          <div className="health-redesign__heading"><div><h3>Notification Outbox Receipts</h3><p className="health-redesign__sub">An independent first-page read, limited to 20 receipts.</p></div>
            <Button size="sm" data-testid="system-health-load-outbox-receipts-btn" disabled={outboxReceiptsLoading} onClick={() => void fetchOutboxReceiptsOnDemand()}>{outboxReceiptsLoading ? 'Loading receipts…' : 'Inspect Outbox Receipts'}</Button>
          </div>
          {outboxReceiptsLoading && <div className="health-redesign__state" role="status">Loading notification outbox receipts…</div>}
          {outboxReceiptsError && <div role="alert" className="health-redesign__error">{outboxReceiptsError}</div>}
          {outboxReceipts && <div data-testid="system-health-outbox-receipts-panel"><StructuredRecordTable rows={extractRecords(outboxReceipts)} columns={OUTBOX_RECEIPT_COLUMNS} emptyMessage="No notification outbox receipts returned." /></div>}
          {!outboxReceipts && !outboxReceiptsLoading && !outboxReceiptsError && <div className="health-redesign__state">Receipts have not been loaded.</div>}
        </section>
      </section>}
      <div style={note}>Server-side catalogue functions govern each panel: <code>metrics.view</code>, <code>diagnostics.view</code>, <code>outbox.view</code>, and <code>notification.view_deliveries</code>.</div>
    </div>
  );
};

const wrap: React.CSSProperties = { padding: 'clamp(16px, 3vw, 32px)', maxWidth: 1440 };
const denied: React.CSSProperties = { background: '#FFF7ED', border: '1px solid #FDBA74', color: '#92400E', padding: 12, borderRadius: 8, fontSize: 13 };
const note: React.CSSProperties = { marginTop: 16, fontSize: 12, color: 'var(--mn-text-secondary, #52655f)', background: 'var(--mn-surface-canvas, #f5f8f6)', padding: 10, borderRadius: 6, border: '1px solid var(--mn-border-subtle, #dde7e2)' };
