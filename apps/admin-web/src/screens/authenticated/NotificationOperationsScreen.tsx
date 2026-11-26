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
  type NotificationProviderReceiptTrace,
  type NotificationRelatedEvent,
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

/** Timestamps are shown with an explicit fallback so "absent" never renders as a blank cell. */
function formatStamp(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return 'not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'not recorded' : date.toLocaleString();
}

/**
 * `datetime-local` inputs hold a wall-clock string, not an instant. Converting both ways keeps the
 * drill-down window the same moment on the wire that the card aggregated, whatever the browser's zone.
 */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toInstant(localValue: string): string {
  if (!localValue) return '';
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export const NotificationOperationsScreen: React.FC<{
  /** Queue prefilter handed over by the dashboard exception card. */
  initialStatus?: string;
  /** The card's half-open window, carried through so the list matches the number it came from. */
  initialWindow?: { from: string; to: string; exclusive: boolean };
  /** Correlation drill-down into the audit workspace, offered only when that view is reachable. */
  onOpenAuditSearch?: (correlationId: string) => void;
}> = ({ initialStatus, initialWindow, onOpenAuditSearch }) => {
  const scopes = useAuthStore((state) => state.principal?.scopes);
  const canView = scopes?.includes('notification.view_deliveries') ?? false;
  return canView ? (
    <NotificationOperationsWorkspace
      initialStatus={initialStatus}
      initialWindow={initialWindow}
      onOpenAuditSearch={onOpenAuditSearch}
    />
  ) : (
    <Alert tone="danger" title="Notification operations unavailable">
      This workspace requires the <code>notification.view_deliveries</code> authorization function.
    </Alert>
  );
};

const NotificationOperationsWorkspace: React.FC<{
  initialStatus?: string;
  initialWindow?: { from: string; to: string; exclusive: boolean };
  onOpenAuditSearch?: (correlationId: string) => void;
}> = ({ initialStatus, initialWindow, onOpenAuditSearch }) => {
  const [summary, setSummary] = useState<NotificationOperationsSummary | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryPage | null>(null);
  const [detail, setDetail] = useState<NotificationDeliveryDetail | null>(null);
  const initialFilters: Filters = {
    ...(STATUS_OPTIONS.includes(initialStatus ?? '')
      ? { ...emptyFilters(), status: initialStatus as string }
      : emptyFilters()),
    from: toLocalInput(initialWindow?.from),
    to: toLocalInput(initialWindow?.to),
  };
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  /**
   * True only while the queue is answering the card's request. An operator who edits `Created to` is
   * making an ordinary queue query, and the historical inclusive bound applies again — the flag is not a
   * sticky mode, it is the drill-down's contract.
   */
  const [toExclusive, setToExclusive] = useState(initialWindow?.exclusive === true);
  const [appliedExclusive, setAppliedExclusive] = useState(initialWindow?.exclusive === true);
  /**
   * Whether the queue itself reported the exclusive upper bound on the page being displayed. The client
   * knowing what it *asked for* is not enough for the sentence below: if a queue answer arrives without a
   * reported `window`, this screen already says the bound is unknown and tells the reader to treat the count
   * as inclusive — and that warning must not be contradicted, in the same paragraph, by a claim that the two
   * counts are meant to be equal.
   */
  const serverConfirmedExclusiveUpperBound = deliveries?.window?.upperBound === 'exclusive';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async (criteria: Filters, exclusiveUpperBound: boolean) => {
    setLoading(true);
    setError('');
    try {
      const [nextSummary, nextDeliveries] = await Promise.all([
        Arena4OperationsApi.notificationSummary(24),
        Arena4OperationsApi.notificationDeliveries({
          ...criteria,
          // ISO on the wire; the exclusive bound only travels with an upper bound to exclude.
          from: toInstant(criteria.from) || undefined,
          to: toInstant(criteria.to) || undefined,
          toExclusive: exclusiveUpperBound && criteria.to ? true : undefined,
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
    void load(applied, appliedExclusive);
  }, [applied, appliedExclusive, load]);

  /**
   * Both trace objects are read as optional even though the current contract always sends them:
   * a payload from a build that predates the trace (or a truncated read) must degrade to an explicit
   * "no trace available" statement, not to a render error that removes the whole detail panel — the
   * operator still needs the delivery record itself to do their job.
   */
  const relatedEvent = detail?.relatedEvent as NotificationRelatedEvent | undefined;
  const providerReceipts = detail?.providerReceipts as NotificationProviderReceiptTrace | undefined;

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
          setAppliedExclusive(toExclusive);
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
            // Editing the upper bound turns this into an ordinary queue query: the inclusive bound returns.
            onChange={(event) => {
              setFilters({ ...filters, to: event.target.value });
              setToExclusive(false);
            }}
            value={filters.to}
          />
        </Field>
        <Button type="submit" variant="primary" disabled={loading}>
          Apply filters
        </Button>
      </form>

      {initialFilters.status && applied.status === initialFilters.status ? (
        /*
         * This workspace was opened from somewhere else — a dashboard exception tile or a health
         * finding — with a status already chosen. Saying so keeps the pre-filter visible instead of
         * letting it read as the natural state of the page: the table below is deliberately narrowed,
         * while the aggregate cards are window-wide and were not narrowed with it.
         */
        <p className="a4-ops__muted" data-testid="a4-prefilter-note">
          Opened with Status = {initialFilters.status} already applied, from the record you came
          from. Clear it above to see the whole window — note that the summary counts beside it are
          window-wide and are not narrowed by this filter.
        </p>
      ) : null}

      {applied.from || applied.to ? (
        /*
         * The count below is only meaningful next to the interval that produced it, and two different
         * intervals are in play by design: the dashboard card's half-open window, and the queue's
         * historical inclusive bound. Whichever one was applied is stated here as the server reported it,
         * so a number on this page and a number on the dashboard can be compared honestly — and so an
         * operator who changes a field sees the boundary description change with it.
         */
        <p className="a4-ops__muted" data-testid="a4-applied-window">
          Applied window: {applied.from || 'any time'}
          {' → '}
          {applied.to || 'no upper bound'}
          {' · '}
          <code>
            {deliveries?.window?.boundary ??
              'the queue did not report which upper bound it used — treat this count as inclusive of the end of the window'}
          </code>
          {appliedExclusive && applied.to && serverConfirmedExclusiveUpperBound ? (
            <span data-testid="a4-applied-window-card-match">
              {
                ' — the same interval the dashboard exception card aggregated, so the two counts are meant '
              }
              to be equal.
            </span>
          ) : null}
        </p>
      ) : null}

      {loading ? (
        <p role="status">Loading notification operations…</p>
      ) : summary ? (
        <>
          <p className="a4-ops__muted" data-testid="a4-summary-generated-at">
            Aggregates computed{' '}
            {summary.generatedAt
              ? new Date(summary.generatedAt).toLocaleString()
              : 'without a reported time'}{' '}
            · window {summary.window.hours}h from {new Date(summary.window.from).toLocaleString()}
            {summary.window.to ? ` to ${new Date(summary.window.to).toLocaleString()}` : ''} · these
            counts are for the summary window only and do not describe the filtered table below.
          </p>

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
            <h3>Outbox consumer checkpoints</h3>
            {(summary.outboxReceipts ?? []).length === 0 ? (
              <p className="a4-ops__muted" data-testid="a4-outbox-receipts-unavailable">
                The delivery summary did not return consumer checkpoint counts. Absence here means
                the figure was not provided, not that no receipts exist.
              </p>
            ) : (
              <ul>
                {(summary.outboxReceipts ?? []).map((row) => (
                  <li key={row.status}>
                    {row.status}: {row.count}
                  </li>
                ))}
              </ul>
            )}
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
            <h4>Delivery trace</h4>
            <p className="a4-ops__muted">
              Each step below is read from the store that owns it, at the time stated. A step that
              could not be read is labelled as unread rather than as healthy.
            </p>
            {relatedEvent && providerReceipts ? (
              <ol className="a4-ops__trace" data-testid="a4-delivery-trace">
                <li>
                  <strong>Event raised</strong>
                  {relatedEvent.availability === 'FOUND' ? (
                    <>
                      <span>
                        Outbox event {relatedEvent.id} · {relatedEvent.eventType} · status{' '}
                        {relatedEvent.status} · {relatedEvent.attempts} delivery attempt(s) by the
                        publisher
                        {relatedEvent.eventHasError
                          ? ' · the event row records an error string (its text stays behind outbox.view)'
                          : ''}
                      </span>
                      <span className="a4-ops__muted">
                        occurred {formatStamp(relatedEvent.occurredAt)} · published{' '}
                        {formatStamp(relatedEvent.publishedAt)}
                      </span>
                    </>
                  ) : (
                    <span data-testid="a4-trace-event-not-read">
                      {relatedEvent.availability === 'NOT_FOUND'
                        ? 'No upstream outbox event is addressable from this delivery.'
                        : 'The upstream outbox event could not be read by this surface.'}{' '}
                      {relatedEvent.reason} — this is not evidence about the event&rsquo;s health.
                    </span>
                  )}
                  <span className="a4-ops__muted">
                    Checked {formatStamp(relatedEvent.checkedAt)} · source {relatedEvent.source}
                  </span>
                </li>
                <li>
                  <strong>Event consumed by the notification worker</strong>
                  {relatedEvent.receipt ? (
                    <span>
                      Consumer receipt {relatedEvent.receipt.status}
                      {relatedEvent.receipt.reason
                        ? ` · reason ${relatedEvent.receipt.reason}`
                        : ''}
                      {relatedEvent.receipt.status !== 'MATERIALIZED'
                        ? ' · no delivery row was created by this event for this consumer, so a "missing delivery" finding here is explained by suppression or quarantine, not by a lost message'
                        : ''}
                      {` · ${relatedEvent.receipt.attempts} processing attempt(s) · next attempt ${formatStamp(relatedEvent.receipt.nextAttemptAt)} · updated ${formatStamp(relatedEvent.receipt.updatedAt)}`}
                    </span>
                  ) : (
                    <span data-testid="a4-trace-receipt-absent">
                      {relatedEvent.availability === 'FOUND'
                        ? 'No consumer receipt row exists for this event, so the materialization decision was never recorded.'
                        : 'No consumer receipt could be read because the event itself was not available to this surface.'}
                    </span>
                  )}
                </li>
                <li>
                  <strong>Delivery outcome</strong>
                  <span>
                    {detail.delivery.status} · {detail.delivery.channel} ·{' '}
                    {detail.delivery.recipientType} {detail.delivery.recipientId} ·{' '}
                    {detail.delivery.attempts} attempt(s) · errorCode{' '}
                    {detail.delivery.errorCode ?? 'none recorded'} · failedAt{' '}
                    {formatStamp(detail.delivery.failedAt)} · nextAttemptAt{' '}
                    {formatStamp(detail.delivery.nextAttemptAt)}
                  </span>
                </li>
                <li>
                  <strong>Provider-reported outcome</strong>
                  {providerReceipts.availability === 'AVAILABLE' ? (
                    <ul>
                      {providerReceipts.items.map((receipt) => (
                        <li key={receipt.id} data-testid="a4-provider-receipt">
                          {receipt.kind} · verification {receipt.verification} ·{' '}
                          {receipt.providerCode ?? 'no recognized provider classification'} ·
                          provider time {formatStamp(receipt.occurredAt)} · received{' '}
                          {formatStamp(receipt.receivedAt)}
                        </li>
                      ))}
                      {providerReceipts.returned >= providerReceipts.limit ? (
                        <li className="a4-ops__muted">
                          Showing the {providerReceipts.limit} most recent receipts for this
                          delivery.
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <span data-testid="a4-provider-receipts-none">
                      {providerReceipts.availability === 'NONE_RECORDED'
                        ? 'The provider reported nothing about this message.'
                        : 'Provider receipts could not be read by this surface.'}{' '}
                      {providerReceipts.reason ?? ''} Absence of a provider receipt is not evidence
                      of delivery or of failure.
                    </span>
                  )}
                  <span className="a4-ops__muted">
                    Checked {formatStamp(providerReceipts.checkedAt)} · source{' '}
                    {providerReceipts.source}
                  </span>
                </li>
                <li>
                  <strong>Channel availability now</strong>
                  <span>
                    {detail.provider.channel}:{' '}
                    {detail.provider.available ? 'available' : 'unavailable'}
                    {detail.provider.provider ? ` (${detail.provider.provider})` : ''} · projection{' '}
                    {detail.provider.projectionScope}
                  </span>
                </li>
              </ol>
            ) : (
              <p className="a4-ops__muted" data-testid="a4-delivery-trace-unavailable">
                This delivery record was returned without a trace projection, so the upstream event,
                the consumer receipt and the provider receipts cannot be confirmed from this
                surface. Nothing here should be read as &ldquo;the event was fine&rdquo;.
              </p>
            )}
            {onOpenAuditSearch && detail.delivery.correlationId ? (
              <Button
                size="sm"
                data-testid="open-audit-from-delivery"
                onClick={() => onOpenAuditSearch(String(detail.delivery.correlationId))}
              >
                Trace this request in audit events →
              </Button>
            ) : null}
            {detail.delivery.correlationId ? (
              <p className="a4-ops__muted">
                Correlation identifier (sanitized by the server): {detail.delivery.correlationId}
              </p>
            ) : null}
          </div>

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
