import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import {
  redactDeliveryRecipientId,
  sanitizeDeliveryErrorCode,
  sanitizeProviderRefForBoundary,
} from '../notification/provider-security';
import { NotificationProviderConfigService } from '../notification/notification-provider-config.service';
import { sanitizeDiagnosticIdentifier } from '../common/sensitive-data-redaction';

/**
 * ARENA 4 — Notification Operations (administrative visibility over the EXISTING delivery
 * infrastructure).
 *
 * This service is deliberately read-only. The approved V1 scope for the notification deliveries
 * surface is "No retry/replay/mutation controls"
 * (docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md §notification deliveries page, restated in
 * docs/ARENA3-NOTIFICATION-FINAL-CLOSURE-REPORT-20261027.md). Recovery is the worker's bounded
 * automatic retry, not an operator action. Adding a manual retry would be a new requirement and a
 * new authorization-policy decision, so no such route exists here (a POST is intentionally absent,
 * not merely disabled) and every payload states `manualRetrySupported: false` with the policy
 * reference.
 *
 * It also never duplicates delivery state: every number is an aggregate over
 * `notification_deliveries`, `notification_delivery_attempts` and `notification_outbox_receipts`,
 * which the dispatcher/processor already own. No new engine, no new table, no provider call.
 */

export type NotificationOperationsStatus =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED'
  | 'UNKNOWN'
  | 'DEAD';

export interface NotificationOperationsSummaryInput {
  /** Bounded window in hours; 1..168. Ignored when `from` is supplied explicitly. */
  hours: number;
  /**
   * Explicit window bounds, for callers that resolve a period elsewhere (the dashboard widget
   * resolves `today`/`7d`/`30d`/custom to a from/to range and must not be silently clamped to the
   * 168-hour ceiling). Both must be supplied together; `to` defaults to now.
   */
  from?: Date;
  to?: Date;
  channel?: 'SMS' | 'PUSH' | 'EMAIL';
  /** True only after a server-side `notification.provider.view` decision succeeded. */
  includeProviderIdentity: boolean;
}

export interface DeliveryStatusCount {
  status: NotificationOperationsStatus;
  count: number;
}

export interface ChannelStatusCount {
  channel: string;
  status: NotificationOperationsStatus;
  count: number;
}

export interface FailureDiagnostic {
  errorCode: string;
  count: number;
  lastSeenAt: Date | string | null;
}

export interface DeliveryAttemptView {
  attemptNumber: number;
  status: string;
  /** Sanitized through the same allow-list the delivery projection uses. */
  reason: string | null;
  claimedAt: Date | string | null;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
}

export interface NotificationOperationsSummary {
  generatedAt: Date;
  /** The window actually aggregated. `from`/`to` are half-open: `created_at >= from AND < to`. */
  window: { hours: number; from: Date; to: Date };
  filters: { channel: string | null };
  totals: {
    deliveries: number;
    byStatus: DeliveryStatusCount[];
    byChannelAndStatus: ChannelStatusCount[];
  };
  retryBacklog: {
    pending: number;
    failedAwaitingRetry: number;
    dead: number;
    unknown: number;
    oldestPendingAt: Date | string | null;
    nextScheduledRetryAt: Date | string | null;
  };
  failureDiagnostics: FailureDiagnostic[];
  /** Outbox consumer checkpoints (delivery-independent, notification consumer only). */
  outboxReceipts: Array<{ status: string; count: number }>;
  provider: {
    projectionScope: 'FULL' | 'MINIMAL';
    channels: Array<{
      channel: 'SMS' | 'PUSH' | 'EMAIL';
      available: boolean;
      provider?: string;
      source?: string;
      enabled?: boolean;
      lifecycleState?: string;
    }>;
  };
  retryPolicy: {
    manualRetrySupported: false;
    manualRetryPolicyReference: string;
    automaticRetry: {
      maxAttempts: number | null;
      baseDelaySeconds: number | null;
      visibility: 'FULL' | 'MINIMAL';
    };
  };
}

export interface NotificationDeliveryOperationDetail {
  delivery: {
    id: string;
    eventType: string;
    eventKey: string;
    aggregateType: string | null;
    aggregateId: string | null;
    recipientType: string;
    recipientId: string;
    channel: string;
    status: NotificationOperationsStatus;
    attempts: number;
    providerRef: string | null;
    correlationId: string | null;
    causationId: string | null;
    errorCode: string | null;
    nextAttemptAt: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
    sentAt: Date | string | null;
    failedAt: Date | string | null;
  };
  /** Immutable, fenced per-attempt evidence written by NotificationDeliveryProcessor. */
  attempts: DeliveryAttemptView[];
  idempotency: {
    eventKey: string;
    recipientType: string;
    channel: string;
    uniqueOn: 'EVENT_KEY_RECIPIENT_CHANNEL';
    /** A delivery row is the idempotent materialization of its outbox event. */
    materialization: 'ONE_ROW_PER_OUTBOX_EVENT_RECIPIENT_CHANNEL';
  };
  retry: {
    /** No manual control exists: read-only by approved product policy. */
    manualRetrySupported: false;
    manualRetryPolicyReference: string;
    automaticRetryState:
      | 'DELIVERED'
      | 'AWAITING_AUTOMATIC_RETRY'
      | 'TERMINAL_EXHAUSTED'
      | 'TERMINAL_PERMANENT'
      | 'OUTCOME_UNKNOWN'
      | 'SUPPRESSED'
      | 'NOT_STARTED';
    automaticRetry: {
      maxAttempts: number | null;
      baseDelaySeconds: number | null;
      visibility: 'FULL' | 'MINIMAL';
    };
  };
  provider: {
    projectionScope: 'FULL' | 'MINIMAL';
    channel: 'SMS' | 'PUSH' | 'EMAIL';
    available: boolean;
    provider?: string;
    lifecycleState?: string;
  };
  /**
   * The upstream outbox event this delivery is the materialization of, plus the notification
   * consumer's receipt for it. This is what lets an operator connect "SMS failed" to "the event
   * that produced it was suppressed / published / never taken", instead of stopping at a status.
   *
   * Three outcomes are kept distinct on purpose:
   *  - `FOUND`   — the event row was read; its state is the state of the event, not of the delivery.
   *  - `NOT_FOUND` — no event row is addressable by this delivery's event key (purged by retention,
   *    or written before key-based linkage). The delivery record remains the authoritative verdict.
   *  - `UNAVAILABLE` — the event could not be queried at all. No conclusion is available; this is
   *    never rendered as a healthy or empty state.
   * Only status/attempt/timestamp facts cross this boundary. The event `payload` and the event
   * `last_error` free text stay behind `outbox.view`, which is a different capability.
   */
  relatedEvent: NotificationRelatedEvent;
  /**
   * Provider-reported outcomes for this delivery (the append-only receipt ledger). `items` is a
   * bounded newest-first window and says so; an empty list with `availability: 'NONE_RECORDED'` is
   * genuinely "the provider told us nothing about this message", not a read failure.
   */
  providerReceipts: NotificationProviderReceiptTrace;
}

export interface NotificationRelatedEvent {
  availability: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';
  /** Stated so a reader can tell what was consulted, and when. */
  checkedAt: string;
  source: string;
  reason?: string;
  id?: string;
  eventType?: string;
  status?: string;
  attempts?: number;
  occurredAt?: Date | string | null;
  publishedAt?: Date | string | null;
  availableAt?: Date | string | null;
  /** True when the event row carries an error string; the text itself is not projected here. */
  eventHasError?: boolean;
  receipt?: {
    status: string;
    reason: string | null;
    attempts: number;
    nextAttemptAt: Date | string | null;
    updatedAt: Date | string | null;
  } | null;
}

export interface NotificationProviderReceiptTrace {
  availability: 'AVAILABLE' | 'NONE_RECORDED' | 'UNAVAILABLE';
  checkedAt: string;
  source: string;
  reason?: string;
  limit: number;
  returned: number;
  items: Array<{
    id: string;
    kind: string;
    verification: 'SIGNED' | 'SHARED_SECRET' | 'UNVERIFIED';
    /** Closed-set vendor classification only; anything unrecognized is dropped rather than echoed. */
    providerCode: string | null;
    occurredAt: Date | string;
    receivedAt: Date | string;
  }>;
}

const NOTIFICATION_CONSUMER_NAME = 'notification.v1';
const PROVIDER_RECEIPT_LIMIT = 10;

export const MANUAL_RETRY_POLICY_REFERENCE =
  'docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md#notification-deliveries-READ-ONLY';

const VALID_STATUSES: readonly NotificationOperationsStatus[] = [
  'PENDING',
  'SENT',
  'FAILED',
  'SKIPPED',
  'UNKNOWN',
  'DEAD',
];

const RECEIPT_STATUSES = [
  'MATERIALIZED',
  'SUPPRESSED',
  'UNSUPPORTED',
  'QUARANTINED',
  'FAILED',
] as const;

/**
 * Automatic-retry state is derived from the persisted row, never inferred from a provider call.
 * `UNKNOWN` is never treated as retryable: an ambiguous provider outcome must not be replayed
 * automatically (see NotificationDeliveryProcessor).
 */
export function deriveAutomaticRetryState(
  status: NotificationOperationsStatus,
  attempts: number,
): NotificationDeliveryOperationDetail['retry']['automaticRetryState'] {
  switch (status) {
    case 'SENT':
      return 'DELIVERED';
    case 'SKIPPED':
      return 'SUPPRESSED';
    case 'UNKNOWN':
      return 'OUTCOME_UNKNOWN';
    case 'FAILED':
      return attempts > 0 ? 'AWAITING_AUTOMATIC_RETRY' : 'NOT_STARTED';
    case 'DEAD':
      return attempts > 0 ? 'TERMINAL_EXHAUSTED' : 'TERMINAL_PERMANENT';
    case 'PENDING':
    default:
      return attempts > 0 ? 'AWAITING_AUTOMATIC_RETRY' : 'NOT_STARTED';
  }
}

@Injectable()
export class NotificationOperationsService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly providerConfig?: NotificationProviderConfigService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async summary(input: NotificationOperationsSummaryInput): Promise<NotificationOperationsSummary> {
    const hours = Math.min(Math.max(Math.trunc(input.hours) || 24, 1), 168);
    const to = input.to instanceof Date && !Number.isNaN(input.to.getTime()) ? input.to : new Date();
    const from =
      input.from instanceof Date && !Number.isNaN(input.from.getTime())
        ? input.from
        : new Date(to.getTime() - hours * 60 * 60 * 1000);
    const windowClause = `created_at >= $1::timestamptz AND created_at < $2::timestamptz`;
    const channel = input.channel ?? null;
    const channelFilter = channel ? ' AND channel=$3' : '';
    const windowParams: unknown[] = channel ? [from, to, channel] : [from, to];

    const byChannelAndStatus = await this.dataSource.query<ChannelStatusCount[]>(
      `SELECT channel, status, count(*)::int AS count
         FROM notification_deliveries
        WHERE ${windowClause}${channelFilter}
        GROUP BY channel, status
        ORDER BY channel, status`,
      windowParams,
    );

    const byStatus = new Map<NotificationOperationsStatus, number>();
    for (const status of VALID_STATUSES) byStatus.set(status, 0);
    let deliveries = 0;
    for (const row of byChannelAndStatus) {
      deliveries += row.count;
      if (VALID_STATUSES.includes(row.status)) {
        byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + row.count);
      }
    }

    const backlogRows = await this.dataSource.query<
      Array<{
        pending: number;
        failed: number;
        dead: number;
        unknown: number;
        oldest_pending_at: Date | null;
        next_scheduled_retry_at: Date | null;
      }>
    >(
      `SELECT
         count(*) FILTER (WHERE status='PENDING')::int AS pending,
         count(*) FILTER (WHERE status='FAILED')::int AS failed,
         count(*) FILTER (WHERE status='DEAD')::int AS dead,
         count(*) FILTER (WHERE status='UNKNOWN')::int AS unknown,
         min(created_at) FILTER (WHERE status='PENDING') AS oldest_pending_at,
         min(next_attempt_at) FILTER (WHERE status='FAILED') AS next_scheduled_retry_at
       FROM notification_deliveries
       WHERE ${windowClause}${channelFilter}`,
      windowParams,
    );
    const backlog = backlogRows[0];

    const failureRows = await this.dataSource.query<
      Array<{ last_error: string | null; count: number; last_seen_at: Date | null }>
    >(
      `SELECT last_error, count(*)::int AS count, max(updated_at) AS last_seen_at
         FROM notification_deliveries
        WHERE status IN ('FAILED','DEAD','UNKNOWN')
          AND last_error IS NOT NULL
          AND ${windowClause}${channelFilter}
        GROUP BY last_error
        ORDER BY count DESC, last_error
        LIMIT 25`,
      windowParams,
    );
    // Aggregate AFTER sanitization so two unsafe raw strings cannot leak by frequency and no
    // provider payload text survives the boundary. Unknown shapes collapse to UNCLASSIFIED.
    const failures = new Map<string, FailureDiagnostic>();
    for (const row of failureRows) {
      const errorCode = sanitizeDeliveryErrorCode(row.last_error) ?? 'UNCLASSIFIED';
      const existing = failures.get(errorCode);
      if (existing) {
        existing.count += row.count;
        if (
          row.last_seen_at &&
          (!existing.lastSeenAt || new Date(row.last_seen_at) > new Date(existing.lastSeenAt))
        ) {
          existing.lastSeenAt = row.last_seen_at;
        }
      } else {
        failures.set(errorCode, {
          errorCode,
          count: row.count,
          lastSeenAt: row.last_seen_at,
        });
      }
    }

    const receiptRows = await this.dataSource.query<Array<{ status: string; count: number }>>(
      `SELECT status, count(*)::int AS count
         FROM notification_outbox_receipts
        WHERE consumer_name='notification.v1'
        GROUP BY status`,
      [],
    );
    const receiptCounts = new Map<string, number>();
    for (const row of receiptRows) receiptCounts.set(row.status, row.count);

    return {
      generatedAt: new Date(),
      window: { hours, from, to },
      filters: { channel },
      totals: {
        deliveries,
        byStatus: VALID_STATUSES.map((status) => ({
          status,
          count: byStatus.get(status) ?? 0,
        })),
        byChannelAndStatus,
      },
      retryBacklog: {
        pending: backlog?.pending ?? 0,
        failedAwaitingRetry: backlog?.failed ?? 0,
        dead: backlog?.dead ?? 0,
        unknown: backlog?.unknown ?? 0,
        oldestPendingAt: backlog?.oldest_pending_at ?? null,
        nextScheduledRetryAt: backlog?.next_scheduled_retry_at ?? null,
      },
      failureDiagnostics: Array.from(failures.values())
        .sort((a, b) => b.count - a.count || a.errorCode.localeCompare(b.errorCode))
        .slice(0, 10),
      outboxReceipts: RECEIPT_STATUSES.map((status) => ({
        status,
        count: receiptCounts.get(status) ?? 0,
      })),
      provider: await this.providerProjection(input.includeProviderIdentity),
      retryPolicy: this.retryPolicy(input.includeProviderIdentity),
    };
  }

  async deliveryDetail(
    deliveryId: string,
    includeProviderIdentity: boolean,
  ): Promise<NotificationDeliveryOperationDetail> {
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        event_type: string;
        event_key: string;
        aggregate_type: string | null;
        aggregate_id: string | null;
        recipient_type: string;
        recipient_id: string;
        channel: string;
        status: NotificationOperationsStatus;
        attempts: number;
        provider_ref: string | null;
        correlation_id: string | null;
        causation_id: string | null;
        last_error: string | null;
        next_attempt_at: Date | null;
        created_at: Date;
        updated_at: Date;
        sent_at: Date | null;
        failed_at: Date | null;
      }>
    >(
      `SELECT id, event_type, event_key, aggregate_type, aggregate_id, recipient_type,
              recipient_id, channel, status, attempts, provider_ref, correlation_id,
              causation_id, last_error, next_attempt_at, created_at, updated_at, sent_at,
              failed_at
         FROM notification_deliveries
        WHERE id=$1
        LIMIT 1`,
      [deliveryId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Notification delivery not found');

    // Attempt evidence only. No lease token, destination, payload, message, rendered content or
    // raw provider error ever crosses this boundary.
    const attempts = await this.dataSource.query<
      Array<{
        attempt_number: number;
        status: string;
        reason: string | null;
        claimed_at: Date | null;
        started_at: Date | null;
        finished_at: Date | null;
      }>
    >(
      `SELECT attempt_number, status, reason, claimed_at, started_at, finished_at
         FROM notification_delivery_attempts
        WHERE delivery_id=$1
        ORDER BY attempt_number ASC
        LIMIT 50`,
      [deliveryId],
    );

    const provider = await this.providerProjection(includeProviderIdentity);
    const channelProjection = provider.channels.find((item) => item.channel === row.channel);
    const relatedEvent = await this.readRelatedEvent(row.event_key);
    const providerReceipts = await this.readProviderReceipts(deliveryId);

    return {
      delivery: {
        id: row.id,
        eventType: sanitizeDiagnosticIdentifier(row.event_type) ?? '[REDACTED]',
        eventKey: sanitizeDiagnosticIdentifier(row.event_key) ?? '[REDACTED]',
        aggregateType: sanitizeDiagnosticIdentifier(row.aggregate_type) ?? null,
        aggregateId: sanitizeDiagnosticIdentifier(row.aggregate_id) ?? null,
        recipientType: row.recipient_type,
        recipientId: redactDeliveryRecipientId(row.recipient_type, row.recipient_id),
        channel: row.channel,
        status: row.status,
        attempts: row.attempts,
        providerRef: sanitizeProviderRefForBoundary(row.provider_ref),
        correlationId: sanitizeDiagnosticIdentifier(row.correlation_id) ?? null,
        causationId: sanitizeDiagnosticIdentifier(row.causation_id) ?? null,
        errorCode: sanitizeDeliveryErrorCode(row.last_error),
        nextAttemptAt: row.next_attempt_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        sentAt: row.sent_at,
        failedAt: row.failed_at,
      },
      attempts: attempts.map((attempt) => ({
        attemptNumber: attempt.attempt_number,
        status: attempt.status,
        reason: sanitizeDeliveryErrorCode(attempt.reason),
        claimedAt: attempt.claimed_at,
        startedAt: attempt.started_at,
        finishedAt: attempt.finished_at,
      })),
      idempotency: {
        eventKey: sanitizeDiagnosticIdentifier(row.event_key) ?? '[REDACTED]',
        recipientType: row.recipient_type,
        channel: row.channel,
        uniqueOn: 'EVENT_KEY_RECIPIENT_CHANNEL',
        materialization: 'ONE_ROW_PER_OUTBOX_EVENT_RECIPIENT_CHANNEL',
      },
      retry: {
        manualRetrySupported: false,
        manualRetryPolicyReference: MANUAL_RETRY_POLICY_REFERENCE,
        automaticRetryState: deriveAutomaticRetryState(row.status, row.attempts),
        automaticRetry: this.retryPolicy(includeProviderIdentity).automaticRetry,
      },
      provider: {
        projectionScope: provider.projectionScope,
        channel: row.channel as 'SMS' | 'PUSH' | 'EMAIL',
        available: channelProjection?.available ?? false,
        ...(includeProviderIdentity
          ? {
              provider: channelProjection?.provider,
              lifecycleState: channelProjection?.lifecycleState,
            }
          : {}),
      },
      relatedEvent,
      providerReceipts,
    };
  }

  /**
   * Event linkage is read defensively. A missing `event_key` match is a real, reportable state
   * (retention purge, pre-linkage write) and a query failure is a different one; neither is allowed
   * to fail the delivery detail, because the delivery row is the authoritative verdict and an
   * operator investigating a failure must still get it.
   */
  private async readRelatedEvent(eventKey: string): Promise<NotificationRelatedEvent> {
    const checkedAt = new Date().toISOString();
    const source = 'outbox_events + notification_outbox_receipts (consumer ' + NOTIFICATION_CONSUMER_NAME + ')';
    if (!eventKey) {
      return {
        availability: 'NOT_FOUND',
        checkedAt,
        source,
        reason: 'this delivery carries no event key, so no upstream event is addressable from it',
      };
    }
    try {
      const rows = await this.dataSource.query<
        Array<{
          id: string;
          event_type: string;
          status: string;
          attempts: number;
          occurred_at: Date;
          published_at: Date | null;
          available_at: Date;
          last_error: string | null;
          receipt_status: string | null;
          receipt_reason: string | null;
          receipt_attempts: number | null;
          receipt_next_attempt_at: Date | null;
          receipt_updated_at: Date | null;
        }>
      >(
        `SELECT o.id, o.event_type, o.status, o.attempts, o.occurred_at, o.published_at,
                o.available_at, o.last_error,
                r.status AS receipt_status, r.reason AS receipt_reason,
                r.attempts AS receipt_attempts, r.next_attempt_at AS receipt_next_attempt_at,
                r.updated_at AS receipt_updated_at
           FROM outbox_events o
           LEFT JOIN notification_outbox_receipts r
             ON r.outbox_event_id = o.id AND r.consumer_name = $2
          WHERE o.event_key = $1
          LIMIT 1`,
        [eventKey, NOTIFICATION_CONSUMER_NAME],
      );
      const event = rows[0];
      if (!event) {
        return {
          availability: 'NOT_FOUND',
          checkedAt,
          source,
          reason:
            'no outbox event is addressable by this delivery event key (retention-purged, or written before key-based linkage)',
        };
      }
      return {
        availability: 'FOUND',
        checkedAt,
        source,
        id: event.id,
        eventType: sanitizeDiagnosticIdentifier(event.event_type) ?? '[REDACTED]',
        status: event.status,
        attempts: Number(event.attempts ?? 0),
        occurredAt: event.occurred_at,
        publishedAt: event.published_at,
        availableAt: event.available_at,
        eventHasError: event.last_error !== null && event.last_error !== undefined,
        receipt:
          event.receipt_status === null || event.receipt_status === undefined
            ? null
            : {
                status: event.receipt_status,
                reason: event.receipt_reason,
                attempts: Number(event.receipt_attempts ?? 0),
                nextAttemptAt: event.receipt_next_attempt_at,
                updatedAt: event.receipt_updated_at,
              },
      };
    } catch {
      return {
        availability: 'UNAVAILABLE',
        checkedAt,
        source,
        reason: 'the outbox event and consumer receipt could not be read by this surface',
      };
    }
  }

  private async readProviderReceipts(
    deliveryId: string,
  ): Promise<NotificationProviderReceiptTrace> {
    const checkedAt = new Date().toISOString();
    const source = 'notification_delivery_receipts (append-only provider receipts)';
    try {
      const rows = await this.dataSource.query<
        Array<{
          id: string;
          kind: string;
          verification: string;
          provider_code: string | null;
          occurred_at: Date;
          received_at: Date;
        }>
      >(
        `SELECT id, kind, verification, provider_code, occurred_at, received_at
           FROM notification_delivery_receipts
          WHERE delivery_id = $1
          ORDER BY occurred_at DESC, received_at DESC
          LIMIT $2`,
        [deliveryId, PROVIDER_RECEIPT_LIMIT],
      );
      const items = rows.map((receipt) => ({
        id: receipt.id,
        kind: receipt.kind,
        verification: (
          ['SIGNED', 'SHARED_SECRET', 'UNVERIFIED'].includes(receipt.verification)
            ? receipt.verification
            : 'UNVERIFIED'
        ) as NotificationProviderReceiptTrace['items'][number]['verification'],
        // The raw provider detail is free text and is never projected; only a recognized
        // closed-set classification code survives.
        providerCode: sanitizeDeliveryErrorCode(receipt.provider_code),
        occurredAt: receipt.occurred_at,
        receivedAt: receipt.received_at,
      }));
      return {
        availability: items.length === 0 ? 'NONE_RECORDED' : 'AVAILABLE',
        checkedAt,
        source,
        limit: PROVIDER_RECEIPT_LIMIT,
        returned: items.length,
        items,
        ...(items.length === 0
          ? {
              reason:
                'the provider has reported nothing about this message; absence of a receipt is not evidence of delivery or failure',
            }
          : {}),
      };
    } catch {
      return {
        availability: 'UNAVAILABLE',
        checkedAt,
        source,
        limit: PROVIDER_RECEIPT_LIMIT,
        returned: 0,
        items: [],
        reason: 'provider receipts could not be read by this surface',
      };
    }
  }

  /**
   * Channel dispatch availability is operational fact. Provider identity, lifecycle and retry
   * tuning are only projected after a server-side `notification.provider.view` decision, matching
   * the existing provider-status projection tiers.
   */
  private async providerProjection(
    includeProviderIdentity: boolean,
  ): Promise<NotificationOperationsSummary['provider']> {
    const channels: NotificationOperationsSummary['provider']['channels'] = [
      { channel: 'SMS', available: false },
      { channel: 'PUSH', available: false },
      { channel: 'EMAIL', available: false },
    ];
    if (!this.providerConfig) {
      return {
        projectionScope: includeProviderIdentity ? 'FULL' : 'MINIMAL',
        channels,
      };
    }
    const overview = await this.providerConfig.getOverview();
    const smsAvailable = Boolean(
      overview.sms.enabled &&
        (overview.sms.provider === 'console' || overview.sms.gates.configured) &&
        !overview.sms.misconfigurationCode,
    );
    const emailAvailable = Boolean(
      overview.email.enabled &&
        overview.email.provider !== 'none' &&
        (overview.email.provider === 'console' || overview.email.gates.configured) &&
        !overview.email.misconfigurationCode,
    );
    channels[0] = includeProviderIdentity
      ? {
          channel: 'SMS',
          available: smsAvailable,
          provider: overview.sms.provider,
          source: overview.sms.source,
          enabled: overview.sms.enabled,
          lifecycleState: overview.sms.lifecycleState,
        }
      : { channel: 'SMS', available: smsAvailable };
    channels[2] = includeProviderIdentity
      ? {
          channel: 'EMAIL',
          available: emailAvailable,
          provider: overview.email.provider,
          source: overview.email.source,
          enabled: overview.email.enabled,
          lifecycleState: overview.email.lifecycleState,
        }
      : { channel: 'EMAIL', available: emailAvailable };
    return {
      projectionScope: includeProviderIdentity ? 'FULL' : 'MINIMAL',
      channels,
    };
  }

  private retryPolicy(
    includeProviderIdentity: boolean,
  ): NotificationOperationsSummary['retryPolicy'] {
    const read = (key: string, fallback: number): number => {
      const raw = this.configService?.get<number | string>(key);
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
    };
    return {
      manualRetrySupported: false,
      manualRetryPolicyReference: MANUAL_RETRY_POLICY_REFERENCE,
      automaticRetry: includeProviderIdentity
        ? {
            maxAttempts: read('SMS_RETRY_MAX_ATTEMPTS', 3),
            baseDelaySeconds: read('SMS_RETRY_BASE_DELAY_SECONDS', 60),
            visibility: 'FULL',
          }
        : {
            maxAttempts: null,
            baseDelaySeconds: null,
            visibility: 'MINIMAL',
          },
    };
  }
}

export const NOTIFICATION_OPERATIONS_VALID_STATUSES = VALID_STATUSES;
