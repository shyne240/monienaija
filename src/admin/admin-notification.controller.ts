import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';
import { sanitizeDiagnosticIdentifier } from '../common/sensitive-data-redaction';
import {
  redactDeliveryRecipientId,
  sanitizeDeliveryErrorCode,
  sanitizeProviderRefForBoundary,
} from '../notification/provider-security';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const VALID_STATUSES = new Set(['PENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNKNOWN', 'DEAD']);
const VALID_RECEIPT_STATUSES = new Set([
  'MATERIALIZED',
  'SUPPRESSED',
  'UNSUPPORTED',
  'QUARANTINED',
  'FAILED',
]);
const SAFE_RECEIPT_REASONS = new Set([
  'EVENT_TYPE_UNSUPPORTED',
  'UNSUPPORTED_SCHEMA_VERSION',
  'SECURITY_DIRECT_ONLY',
  'INTERNAL_SUPPORT_MESSAGE',
  'SUPPORT_VISIBILITY_UNKNOWN',
  'NO_NOTIFICATION_INTENTS',
  'MATERIALIZATION_FAILED',
  'MATERIALIZATION_EXHAUSTED',
  'LEGACY_PUBLISHED_UNVERIFIED',
]);

const VALID_RECIPIENT_TYPES = new Set(['CUSTOMER', 'AGENT', 'PHONE']);
// ARENA3-NOTIFICATION-EMAIL: EMAIL rows are filterable in delivery diagnostics.
const VALID_CHANNELS = new Set(['SMS', 'PUSH', 'EMAIL']);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

@Controller('internal/notifications')
export class AdminNotificationController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('deliveries')
  async listDeliveries(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') statusRaw?: string,
    @Query('recipientType') recipientTypeRaw?: string,
    @Query('channel') channelRaw?: string,
    @Query('eventType') eventTypeRaw?: string,
    @Query('recipientId') recipientIdRaw?: string,
    // ARENA 4 — bounded search and time-window filters over the same read-only projection.
    // No new columns are projected; these only narrow rows.
    @Query('search') searchRaw?: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    /**
     * ARENA 6 — explicit upper-bound semantics. The dashboard exception card aggregates over a
     * half-open window (`created_at >= from AND created_at < to`), so a drill-down from that card has to
     * ask for the same interval or the list and the number disagree by exactly the rows stamped at `to`.
     * Omitting this keeps the long-standing inclusive bound (`<=`), which is what existing API callers and
     * ordinary queue visits get; the applied bound is echoed in `window` so the screen can say which one it
     * is showing rather than leaving the reader to infer it.
     */
    @Query('toExclusive') toExclusiveRaw?: string,
  ) {
    await this.requireFunction(req, 'notification.view_deliveries');

    // Pagination — deterministic, bounded 1..100, bad request on invalid
    const page = this.parsePage(pageRaw);
    const limit = this.parseLimit(limitRaw);
    const offset = (page - 1) * limit;

    // Filters — validate strictly, throw 400 on invalid
    const status = this.parseEnum(statusRaw, VALID_STATUSES, 'status');
    const recipientType = this.parseEnum(recipientTypeRaw, VALID_RECIPIENT_TYPES, 'recipientType');
    const channel = this.parseEnum(channelRaw, VALID_CHANNELS, 'channel');
    const eventType = this.parseString(eventTypeRaw, 'eventType', 180);
    const recipientId = this.parseUuid(recipientIdRaw, 'recipientId');
    const search = this.parseString(searchRaw, 'search', 120);
    const from = this.parseTimestamp(fromRaw, 'from');
    const to = this.parseTimestamp(toRaw, 'to');
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before to');
    }
    const toExclusive = this.parseBooleanFlag(toExclusiveRaw, 'toExclusive');

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (recipientType) {
      conditions.push(`recipient_type = $${idx++}`);
      params.push(recipientType);
    }
    if (channel) {
      conditions.push(`channel = $${idx++}`);
      params.push(channel);
    }
    if (eventType) {
      conditions.push(`event_type = $${idx++}`);
      params.push(eventType);
    }
    if (recipientId) {
      conditions.push(`recipient_id = $${idx++}`);
      params.push(recipientId);
    }
    if (search) {
      // Escape LIKE metacharacters so a caller cannot turn the filter into a wildcard scan.
      const escaped = search.replace(/[\\%_]/g, (character) => `\\${character}`);
      conditions.push(
        `(event_key ILIKE $${idx} ESCAPE '\\' OR event_type ILIKE $${idx} ESCAPE '\\' OR aggregate_id::text ILIKE $${idx} ESCAPE '\\')`,
      );
      params.push(`%${escaped}%`);
      idx += 1;
    }
    if (from) {
      conditions.push(`created_at >= $${idx++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(toExclusive ? `created_at < $${idx++}` : `created_at <= $${idx++}`);
      params.push(to);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM notification_deliveries ${whereClause}`,
      params,
    );
    const total = Number(countRows[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const hasNextPage = page < totalPages;

    // Data — deterministic ordering created_at DESC, id DESC, safe projection only.
    // SPRINT1-P0-02: `message` is never selected; `last_error` is read ONLY to derive the
    // sanitized `errorCode` below and is never projected raw. `destination` and `payload`
    // were and remain excluded.
    const dataParams = [...params, limit, offset];
    const limitIdx = idx++;
    const offsetIdx = idx++;
    const rows: Array<{
      id: string;
      event_type: string;
      event_key: string;
      aggregate_type: string | null;
      aggregate_id: string | null;
      recipient_type: string;
      recipient_id: string;
      channel: string;
      status: string;
      attempts: number;
      provider_ref: string | null;
      correlation_id: string | null;
      causation_id: string | null;
      last_error: string | null;
      created_at: Date;
      updated_at: Date;
      sent_at: Date | null;
      failed_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id, channel, status, attempts, provider_ref, correlation_id, causation_id, last_error, created_at, updated_at, sent_at, failed_at
         FROM notification_deliveries
         ${whereClause}
         ORDER BY created_at DESC, id DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataParams,
    );

    // Safe projection — expose only operationally safe fields; hide destination/payload/credentials
    const data = rows.map((r) => ({
      id: r.id,
      eventType: sanitizeDiagnosticIdentifier(r.event_type) ?? '[REDACTED]',
      eventKey: sanitizeDiagnosticIdentifier(r.event_key) ?? '[REDACTED]',
      aggregateType: sanitizeDiagnosticIdentifier(r.aggregate_type) ?? null,
      aggregateId: sanitizeDiagnosticIdentifier(r.aggregate_id) ?? null,
      recipientType: r.recipient_type,
      recipientId: redactDeliveryRecipientId(r.recipient_type, r.recipient_id),
      channel: r.channel,
      status: r.status,
      attempts: r.attempts,
      providerRef: sanitizeProviderRefForBoundary(r.provider_ref),
      correlationId: sanitizeDiagnosticIdentifier(r.correlation_id) ?? null,
      causationId: sanitizeDiagnosticIdentifier(r.causation_id) ?? null,
      errorCode: sanitizeDeliveryErrorCode(r.last_error),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      sentAt: r.sent_at,
      failedAt: r.failed_at,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages,
      hasNextPage,
      // The interval actually applied, stated with the bound used. A count is only comparable to another
      // count if the reader can see which edge each one took, and the dashboard card's half-open window is
      // one edge away from the queue's historical inclusive bound.
      window: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        upperBound: to ? (toExclusive ? 'exclusive' : 'inclusive') : 'none',
        boundary:
          !from && !to
            ? 'no time window applied — every delivery row is in scope'
            : from && to
              ? toExclusive
                ? 'created_at >= from AND created_at < to (half-open, UTC)'
                : 'created_at >= from AND created_at <= to (inclusive upper bound, UTC)'
              : from
                ? 'created_at >= from, no upper bound'
                : 'created_at < to (half-open, UTC)',
      },
    };
  }

  /** Notification-only checkpoints: no shared status, event payload, destination or content. */
  @Get('outbox-receipts')
  async listOutboxReceipts(
    @Req() req: AuthenticatedRequest,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('status') statusRaw?: string,
  ) {
    await this.requireFunction(req, 'notification.view_deliveries');
    const page = this.parsePage(pageRaw);
    const limit = this.parseLimit(limitRaw);
    const status = this.parseEnum(statusRaw, VALID_RECEIPT_STATUSES, 'status');
    const params: unknown[] = ['notification.v1'];
    const filter = status ? ' AND status=$2' : '';
    if (status) params.push(status);
    const count = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM notification_outbox_receipts WHERE consumer_name=$1${filter}`,
      params,
    );
    const rows = await this.dataSource.query<
      Array<{
        outbox_event_id: string;
        status: string;
        reason: string | null;
        attempts: number;
        next_attempt_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >(
      `SELECT outbox_event_id,status,reason,attempts,next_attempt_at,created_at,updated_at
       FROM notification_outbox_receipts WHERE consumer_name=$1${filter}
       ORDER BY created_at DESC, outbox_event_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    );
    const total = Number(count[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return {
      data: rows.map((row) => ({
        outboxEventId: row.outbox_event_id,
        status: row.status,
        reason:
          row.reason === null
            ? null
            : SAFE_RECEIPT_REASONS.has(row.reason)
              ? row.reason
              : 'UNCLASSIFIED',
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
    };
  }

  private requireFunction(req: AuthenticatedRequest, functionCode: string): Promise<string> {
    return this.auth.requireFunction(
      req.authorizationPrincipal,
      functionCode,
      'internal-notifications',
      ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED'],
      { deniedStatus: 401 },
    );
  }

  private parsePage(raw?: string): number {
    if (raw === undefined || raw === null || raw === '') return 1;
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v < 1)
      throw new BadRequestException('page must be a positive integer');
    return v;
  }

  private parseLimit(raw?: string): number {
    if (raw === undefined || raw === null || raw === '') return 20;
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v < 1 || v > 100)
      throw new BadRequestException('limit must be between 1 and 100');
    return v;
  }

  private parseEnum(
    raw: string | undefined,
    allowed: Set<string>,
    field: string,
  ): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const upper = trimmed.toUpperCase();
    if (!allowed.has(upper))
      throw new BadRequestException(`${field} must be one of ${Array.from(allowed).join(', ')}`);
    return upper;
  }

  private parseString(raw: string | undefined, field: string, maxLen: number): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > maxLen)
      throw new BadRequestException(`${field} must be at most ${maxLen} characters`);
    return trimmed;
  }

  private parseTimestamp(raw: string | undefined, field: string): Date | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const value = new Date(trimmed);
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException(`${field} must be an ISO-8601 timestamp`);
    }
    return value;
  }

  /**
   * Strict three-state flag: absent means "the caller did not ask", so the historical behaviour stands;
   * a value that is neither true nor false is a bad request rather than a silently ignored filter.
   */
  private parseBooleanFlag(raw: string | undefined, field: string): boolean {
    if (raw === undefined || raw === null || raw === '') return false;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === '1') return true;
    if (trimmed === 'false' || trimmed === '0') return false;
    throw new BadRequestException(`${field} must be true or false`);
  }

  private parseUuid(raw: string | undefined, field: string): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (!isUuid(trimmed)) throw new BadRequestException(`${field} must be a UUID`);
    return trimmed;
  }
}
