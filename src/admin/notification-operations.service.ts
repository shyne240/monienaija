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
  /** Bounded window in hours; 1..168. */
  hours: number;
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
  window: { hours: number; from: Date };
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
}

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
    const channel = input.channel ?? null;
    const channelFilter = channel ? ' AND channel=$2' : '';
    const windowParams: unknown[] = channel ? [hours, channel] : [hours];

    const byChannelAndStatus = await this.dataSource.query<ChannelStatusCount[]>(
      `SELECT channel, status, count(*)::int AS count
         FROM notification_deliveries
        WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')${channelFilter}
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
       WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')${channelFilter}`,
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
          AND created_at >= NOW() - ($1::int * INTERVAL '1 hour')${channelFilter}
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
      window: { hours, from: new Date(Date.now() - hours * 60 * 60 * 1000) },
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
    };
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
