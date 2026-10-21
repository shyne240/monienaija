import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthorizationPrincipal } from '../authorization/authorization.types';

interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  authorizationPrincipal?: AuthorizationPrincipal;
}

const VALID_STATUSES = new Set(['PENDING', 'SENT', 'FAILED', 'SKIPPED']);
const VALID_RECIPIENT_TYPES = new Set(['CUSTOMER', 'AGENT']);
const VALID_CHANNELS = new Set(['SMS', 'PUSH']);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

@Controller('internal/notifications')
export class AdminNotificationController {
  constructor(private readonly dataSource: DataSource) {}

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
    this.requireWorkforce(req);

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

    // Data — deterministic ordering created_at DESC, id DESC, safe projection only
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
      message: string | null;
      last_error: string | null;
      created_at: Date;
      updated_at: Date;
      sent_at: Date | null;
      failed_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT id, event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id, channel, status, attempts, provider_ref, correlation_id, causation_id, message, last_error, created_at, updated_at, sent_at, failed_at
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
      recipientId: r.recipient_id,
      channel: r.channel,
      status: r.status,
      attempts: r.attempts,
      providerRef: r.provider_ref,
      correlationId: r.correlation_id,
      causationId: r.causation_id,
      message: r.message,
      lastError: r.last_error,
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

  private requireWorkforce(req: AuthenticatedRequest): string {
    const principal = req.authorizationPrincipal;
    if (!principal) throw new UnauthorizedException('Authentication required');
    if (
      principal.type === 'AGENT' ||
      principal.type === 'CUSTOMER' ||
      (principal.type as string) === 'AGGREGATOR'
    ) {
      throw new UnauthorizedException('Privileged access required');
    }
    return principal.principalId;
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
