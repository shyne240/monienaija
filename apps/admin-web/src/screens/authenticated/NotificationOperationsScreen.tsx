import React, { useCallback, useEffect, useState } from 'react';

import { Alert, Button, Field, PageHeader } from '../../design-system/primitives';
import {
  StructuredColumn,
  StructuredKeyValueList,
  StructuredRecordTable,
} from '../../components/StructuredData';
import {
  Arena4OperationsApi,
  describeHttpError,
  type NotificationDeliveryDetail,
  type NotificationDeliveryPage,
  type NotificationOperationsSummary,
} from '../../services/arena4-operations-api';
import { useAuthStore } from '../../store/auth-store';
import './arena4-operations.css';

/**
 * ARENA 4 — Notification Operations.
 *
 * Read-only administrative visibility over the existing delivery infrastructure: status counts,
 * failure diagnostics, per-attempt retry history, idempotency identity and channel/provider
 * availability. There is no manual retry control because the approved V1 deliveries surface is
 * explicitly read-only; the only retry mechanism is the worker's bounded automatic retry.
 */

const DELIVERY_COLUMNS: StructuredColumn[] = [
  { key: 'eventType', label: 'Event' },
  { key: 'channel', label: 'Channel' },
  { key: 'recipientType', label: 'Recipient type' },
  { key: 'recipientId', label: 'Recipient' },
  { key: 'status', label: 'Status' },
  { key: 'attempts', label: 'Attempts' },
  { key: 'errorCode', label: 'Last error code' },
  { key: 'createdAt', label: 'Created' },
];

const STATUS_OPTIONS = ['', 'PENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNKNOWN', 'DEAD'];
const CHANNEL_OPTIONS = ['', 'SMS', 'PUSH', 'EMAIL'];

interface Filters {
  status: string;
  channel: string;
  search: string;
  from: string;
  to: string;
}

const emptyFilters = (): Filters => ({ status: '', channel: '', search: '', from: '', to: '' });

export const NotificationOperationsScreen: React.FC = () => {
  const scopes = useAuthStore((state) => state.principal?.scopes);
  const canView = scopes?.includes('notification.view_deliveries') ?? false;
  return canView ? (
    <NotificationOperationsWorkspace />
  ) : (
    <Alert tone="danger" title="Notification operations unavailable">
      This workspace requires the <code>notification.view_deliveries</code> authorization function.
    </Alert>
  );
};

const NotificationOperationsWorkspace: React.FC = () => {
  const [summary, setSummary] = useState<NotificationOperationsSummary | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryPage | null>(null);
  const [detail, setDetail] = useState<NotificationDeliveryDetail | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters());
  const [applied, setApplied] = useState<Filters>(emptyFilters());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async (criteria: Filters) => {
    setLoading(true);
    setError('');
    try {
      const [nextSummary, nextDeliveries] = await Promise.all([
        Arena4OperationsApi.notificationSummary(24),
        Arena4OperationsApi.notificationDeliveries({
          ...criteria,
          page: 1,
          limit: 20,
        }),
      ]);
      setSummary(nextSummary);
      setDeliveries(nextDeliveries);
    } catch (loadError) {
      setError(describeHttpError(loadError, 'Notification operations could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(applied);
  }, [applied, load]);

  const openDetail = async (row: Record<string, unknown>) => {
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) return;
    setDetailError('');
    try {
      setDetail(await Arena4OperationsApi.notificationDelivery(id));
    } catch (detailFailure) {
      setDetail(null);
      setDetailError(describeHttpError(detailFailure, 'Delivery detail could not be loaded.'));
    }
  };

  return (
    <section className="a4-ops" aria-label="Notification operations">
      <PageHeader
        title="Notification operations"
        description="Read-only delivery status, failure diagnostics and retry history over the existing notification infrastructure."
      />

      <p className="a4-ops__notice" data-testid="a4-notification-readonly-notice">
        This surface is read-only. Manual retry is not part of the approved V1 notification
        deliveries policy, so no retry request is available or issued. Recovery is the worker's
        bounded automatic retry.
      </p>

      {error ? (
        <Alert tone="danger" title="Unable to load notification operations">
          {error}
        </Alert>
      ) : null}

      <form
        className="a4-ops__filters"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ ...filters });
        }}
      >
        <Field label="Status" htmlFor="a4-notification-status">
          <select
            id="a4-notification-status"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option || 'ALL'} value={option}>
                {option || 'All statuses'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Channel" htmlFor="a4-notification-channel">
          <select
            id="a4-notification-channel"
            value={filters.channel}
            onChange={(event) => setFilters({ ...filters, channel: event.target.value })}
          >
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option || 'ALL'} value={option}>
                {option || 'All channels'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search event, key or aggregate" htmlFor="a4-notification-search">
          <input
            id="a4-notification-search"
            type="search"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </Field>
        <Field label="Created from" htmlFor="a4-notification-from">
          <input
            id="a4-notification-from"
            type="datetime-local"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </Field>
        <Field label="Created to" htmlFor="a4-notification-to">
          <input
            id="a4-notification-to"
            type="datetime-local"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={loading}>
          Apply filters
        </Button>
      </form>

      {loading ? (
        <p role="status">Loading notification operations…</p>
      ) : summary ? (
        <>
          <div className="a4-ops__grid">
            <div className="a4-ops__card">
              <h3>Deliveries (last 24h)</h3>
              <p className="a4-ops__metric">{summary.totals.deliveries.toLocaleString()}</p>
              <p className="a4-ops__muted">
                {summary.totals.byStatus
                  .filter((row) => row.count > 0)
                  .map((row) => `${row.status} ${row.count}`)
                  .join(' · ') || 'No deliveries recorded in this window'}
              </p>
            </div>
            <div className="a4-ops__card">
              <h3>Retry backlog</h3>
              <p className="a4-ops__metric">{summary.retryBacklog.failedAwaitingRetry}</p>
              <p className="a4-ops__muted">
                Pending {summary.retryBacklog.pending} · Dead {summary.retryBacklog.dead} · Unknown{' '}
                {summary.retryBacklog.unknown}
              </p>
              <p className="a4-ops__muted">
                Next scheduled retry:{' '}
                {summary.retryBacklog.nextScheduledRetryAt
                  ? new Date(summary.retryBacklog.nextScheduledRetryAt).toLocaleString()
                  : 'none scheduled'}
              </p>
            </div>
            <div className="a4-ops__card">
              <h3>Channels</h3>
              <p className="a4-ops__muted" data-testid="a4-notification-provider-scope">
                Projection: {summary.provider.projectionScope}
              </p>
              <ul>
                {summary.provider.channels.map((channel) => (
                  <li key={channel.channel}>
                    {channel.channel}: {channel.available ? 'available' : 'unavailable'}
                    {channel.provider ? ` (${channel.provider})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="a4-ops__card">
            <h3>Failure diagnostics</h3>
            {summary.failureDiagnostics.length === 0 ? (
              <p className="a4-ops__muted">No sanitized failure codes in this window.</p>
            ) : (
              <table className="a4-ops__table">
                <thead>
                  <tr>
                    <th scope="col">Error code</th>
                    <th scope="col">Count</th>
                    <th scope="col">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.failureDiagnostics.map((row) => (
                    <tr key={row.errorCode}>
                      <td>{row.errorCode}</td>
                      <td>{row.count}</td>
                      <td>{row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <StructuredRecordTable
            rows={deliveries?.data ?? []}
            columns={DELIVERY_COLUMNS}
            emptyMessage="No deliveries match these filters."
            onViewDetails={(row) => {
              void openDetail(row);
            }}
          />
          <p className="a4-ops__muted">
            {deliveries
              ? `${deliveries.total} matching deliveries · page ${deliveries.page} of ${deliveries.totalPages || 1}`
              : ''}
          </p>
        </>
      ) : null}

      {detailError ? (
        <Alert tone="danger" title="Delivery detail unavailable">
          {detailError}
        </Alert>
      ) : null}

      {detail ? (
        <section className="a4-ops__detail" aria-label="Notification delivery detail">
          <h3>
            Delivery {detail.delivery.id}{' '}
            <span className="a4-ops__pill">{detail.delivery.status}</span>
          </h3>
          <StructuredKeyValueList data={detail.delivery} />
          <div>
            <h4>Idempotency</h4>
            <p className="a4-ops__muted">
              Unique on {detail.idempotency.uniqueOn}; materialization{' '}
              {detail.idempotency.materialization}. Event key: {detail.idempotency.eventKey}
            </p>
          </div>
          <div>
            <h4>Retry history</h4>
            <table className="a4-ops__table">
              <thead>
                <tr>
                  <th scope="col">Attempt</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Claimed</th>
                  <th scope="col">Finished</th>
                </tr>
              </thead>
              <tbody>
                {detail.attempts.map((attempt) => (
                  <tr key={attempt.attemptNumber}>
                    <td>{attempt.attemptNumber}</td>
                    <td>{attempt.status}</td>
                    <td>{attempt.reason ?? '—'}</td>
                    <td>
                      {attempt.claimedAt ? new Date(attempt.claimedAt).toLocaleString() : '—'}
                    </td>
                    <td>
                      {attempt.finishedAt ? new Date(attempt.finishedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
                {detail.attempts.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No attempt evidence recorded.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div>
            <h4>Automatic retry</h4>
            <p className="a4-ops__muted">
              State: {detail.retry.automaticRetryState}. Manual retry supported:{' '}
              {detail.retry.manualRetrySupported ? 'yes' : 'no'}.
            </p>
            <p className="a4-ops__muted">
              {detail.retry.automaticRetry.maxAttempts !== null
                ? `Bounded automatic retry: ${detail.retry.automaticRetry.maxAttempts} attempts, ${detail.retry.automaticRetry.baseDelaySeconds}s base delay.`
                : 'Retry tuning requires the notification.provider.view function.'}
            </p>
            <p className="a4-ops__muted">
              Policy reference: {detail.retry.manualRetryPolicyReference}
            </p>
          </div>
        </section>
      ) : null}
    </section>
  );
};
