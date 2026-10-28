import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuthorizationService } from '../authorization/authorization.service';
import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const VALID_STATUSES = new Set(['PENDING', 'SENT', 'FAILED', 'SKIPPED', 'UNKNOWN', 'DEAD']);
const VALID_RECEIPT_STATUSES = new Set(['MATERIALIZED', 'SUPPRESSED', 'UNSUPPORTED', 'QUARANTINED', 'FAILED']);
const SAFE_RECEIPT_REASONS = new Set([
  'EVENT_TYPE_UNSUPPORTED', 'UNSUPPORTED_SCHEMA_VERSION', 'SECURITY_DIRECT_ONLY',
  'INTERNAL_SUPPORT_MESSAGE', 'SUPPORT_VISIBILITY_UNKNOWN', 'NO_NOTIFICATION_INTENTS',
  'MATERIALIZATION_FAILED', 'MATERIALIZATION_EXHAUSTED', 'LEGACY_PUBLISHED_UNVERIFIED',
]);

/**
 * SPRINT1-P0-02 REMEDIATION (Arena 4 independent acceptance, 08-FINAL report): the diagnostics
 * projection previously returned the stored rendered `message` and the raw `last_error` string.
 * Rendered content can carry transaction amounts and recipient-specific data, and provider
 * error strings are an unverified disclosure surface. Both fields are removed from the SQL
 * projection and the JSON response. Failure/skip triage keeps a CLOSED allowlist of fixed
 * first-party operational codes (written by NotificationDispatcherService,
 * NotificationChannelResolverService and NotificationWorkerService — never provider prose);
 * any other non-null stored error is exposed only as the fixed sentinel 'UNCLASSIFIED'.
 * The raw value remains in the database for authorized server-side investigation; no
 * "preview" of message content is exposed pending data-owner approval.
 */
const SAFE_DELIVERY_ERROR_CODES: ReadonlySet<string> = new Set([
  'SKIPPED',
  'EVENT_DISABLED',
  'UNSAFE_MESSAGE',
  'SMS_OPT_OUT',
  'EMAIL_OPT_OUT',
  'PUSH_OPT_OUT',
  'PUSH_TOKEN_DEPENDENCY_MISSING',
  'CUSTOMER_PHONE_MISSING',
  'CUSTOMER_EMAIL_MISSING',
  'AGENT_PHONE_DEPENDENCY_MISSING',
  'AGENT_EMAIL_DEPENDENCY_MISSING',
  'INVALID_PHONE_RECIPIENT',
  'UNSUPPORTED_RECIPIENT',
  'SMS_PREFERENCE_UNAVAILABLE',
  'EMAIL_PREFERENCE_UNAVAILABLE',
  'PUSH_PREFERENCE_UNAVAILABLE',
  'CUSTOMER_PHONE_VERIFIED_MISSING',
  'CUSTOMER_EMAIL_VERIFIED_MISSING',
  'CUSTOMER_PHONE_INVALID',
  'PHONE_RECIPIENT_UNVERIFIED',
  'DESTINATION_CHANGED',
  'SECURITY_DIRECT_ONLY',
  'PRE_SEND_FAILED',
  'PROVIDER_OR_CONTENT_UNAVAILABLE',
  'PROVIDER_OUTCOME_UNKNOWN',
  'PROVIDER_REJECTED_RETRYABLE',
  'PROVIDER_REJECTED_OR_EXHAUSTED',
  'LEASE_EXPIRED_AFTER_START',
  'LEASE_EXPIRED_BEFORE_SEND',
  'ATTEMPTS_EXHAUSTED',
  'LEGACY_DELIVERY_OUTCOME_UNKNOWN',
]);

/** Maps a stored last_error to a safe response code: allowlisted code, 'UNCLASSIFIED', or null. */
function sanitizeDeliveryErrorCode(lastError: string | null): string | null {
  if (lastError === null || lastError === undefined || lastError.trim() === '') return null;
  return SAFE_DELIVERY_ERROR_CODES.has(lastError) ? lastError : 'UNCLASSIFIED';
}
const VALID_RECIPIENT_TYPES = new Set(['CUSTOMER', 'AGENT', 'PHONE']);
// ARENA3-NOTIFICATION-EMAIL: EMAIL rows are filterable in delivery diagnostics.
const VALID_CHANNELS = new Set(['SMS', 'PUSH', 'EMAIL']);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Redacts direct recipient identifiers (such as unregistered Cash-to-Cash beneficiary phone
 * numbers stored in `recipient_id` for `recipient_type = 'PHONE'`) while preserving opaque
 * `CUSTOMER` and `AGENT` UUIDs. Raw destination values are never projected.
 */
function redactRecipientId(recipientType: string, recipientId: string): string {
  if (recipientType !== 'PHONE' && isUuid(recipientId)) {
    return recipientId;
  }
  if (recipientId.includes('@')) {
    const [local = '', domain = ''] = recipientId.split('@');
    const keep = Math.min(2, local.length);
    return `${local.slice(0, keep)}***@${domain}`;
  }
  const digits = recipientId.replace(/\D/g, '');
  if (digits.length === 0) {
    return '***';
  }
  const keep = Math.min(3, digits.length);
  return `${recipientId.slice(0, Math.max(0, recipientId.length - keep)).replace(/\d/g, '*')}${digits.slice(-keep)}`;
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
      eventType: r.event_type,
      eventKey: r.event_key,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      recipientType: r.recipient_type,
      recipientId: redactRecipientId(r.recipient_type, r.recipient_id),
      channel: r.channel,
      status: r.status,
      attempts: r.attempts,
      providerRef: r.provider_ref,
      correlationId: r.correlation_id,
      causationId: r.causation_id,
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
      `SELECT count(*)::text AS count FROM notification_outbox_receipts WHERE consumer_name=$1${filter}`, params,
    );
    const rows = await this.dataSource.query<Array<{
      outbox_event_id: string; status: string; reason: string | null; attempts: number;
      next_attempt_at: Date | null; created_at: Date; updated_at: Date;
    }>>(
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
        reason: row.reason === null ? null : SAFE_RECEIPT_REASONS.has(row.reason) ? row.reason : 'UNCLASSIFIED',
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total, page, limit, totalPages, hasNextPage: page < totalPages,
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
    if (!Number.isSafeInteger(v) || v < 1) throw new BadRequestException('page must be a positive integer');
    return v;
  }

  private parseLimit(raw?: string): number {
    if (raw === undefined || raw === null || raw === '') return 20;
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v < 1 || v > 100) throw new BadRequestException('limit must be between 1 and 100');
    return v;
  }

  private parseEnum(raw: string | undefined, allowed: Set<string>, field: string): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const upper = trimmed.toUpperCase();
    if (!allowed.has(upper)) throw new BadRequestException(`${field} must be one of ${Array.from(allowed).join(', ')}`);
    return upper;
  }

  private parseString(raw: string | undefined, field: string, maxLen: number): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > maxLen) throw new BadRequestException(`${field} must be at most ${maxLen} characters`);
    return trimmed;
  }

  private parseUuid(raw: string | undefined, field: string): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (!isUuid(trimmed)) throw new BadRequestException(`${field} must be a UUID`);
    return trimmed;
  }
}
