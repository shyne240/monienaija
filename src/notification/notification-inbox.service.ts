import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface NotificationInboxItem {
  id: string;
  type: string;
  category: string;
  title: string;
  message: string;
  createdAt: Date;
  reference: string | null;
  channel: string; // application-facing semantics, not provider detail
  status: string; // user-facing availability, not raw delivery mechanics
}

export interface NotificationInboxResult {
  items: NotificationInboxItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
  };
}

function toCategory(eventType: string): string {
  if (eventType.startsWith('customer.funding')) return 'FUNDING';
  if (eventType.startsWith('transfer.')) return 'TRANSFER';
  if (eventType.startsWith('cash_to_cash') || eventType.startsWith('cash-to-cash')) return 'CASH_TO_CASH';
  if (eventType.startsWith('support.ticket')) return 'SUPPORT';
  if (eventType.startsWith('agent.')) return 'AGENT';
  return 'GENERAL';
}

function toTitle(eventType: string): string {
  const map: Record<string, string> = {
    'customer.funding.approved': 'Funding Approved',
    'customer.funding.rejected': 'Funding Rejected',
    'customer.funding.requested': 'Funding Request Received',
    'transfer.completed': 'Transfer Completed',
    'transfer.failed': 'Transfer Failed',
    'support.ticket.created': 'Support Ticket Created',
    'support.ticket.assigned': 'Support Ticket Assigned',
    'support.ticket.status_changed': 'Support Ticket Updated',
    'support.ticket.resolved': 'Support Ticket Resolved',
    'support.ticket.closed': 'Support Ticket Closed',
    'support.ticket.message_added': 'Support Ticket Update',
    'cash_to_cash.claimed': 'Cash-to-Cash Claimed',
    'cash_to_cash.expired': 'Cash-to-Cash Expired',
    'cash_to_cash.created': 'Cash-to-Cash Created',
  };
  return map[eventType] ?? eventType;
}

@Injectable()
export class NotificationInboxService {
  constructor(private readonly dataSource: DataSource) {}

  async listForCustomer(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<NotificationInboxResult> {
    this.assertUuid(customerId, 'customerId');
    const normalizedPage = this.normalizePage(page);
    const normalizedLimit = this.normalizeLimit(limit);
    const offset = (normalizedPage - 1) * normalizedLimit;

    // Count total for pagination — only CUSTOMER own notifications, exclude SKIPPED (not user-facing)
    const countRows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM notification_deliveries
        WHERE recipient_type='CUSTOMER' AND recipient_id=$1 AND status != 'SKIPPED'`,
      [customerId],
    );
    const total = Number(countRows[0]?.count ?? '0');
    const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);

    // Fetch items — deterministic newest first
    const rows: Array<{
      id: string;
      event_type: string;
      payload: Record<string, unknown>;
      message: string | null;
      created_at: Date;
      aggregate_id: string | null;
    }> = await this.dataSource.query(
      `SELECT id, event_type, payload, message, created_at, aggregate_id
         FROM notification_deliveries
        WHERE recipient_type='CUSTOMER' AND recipient_id=$1 AND status != 'SKIPPED'
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [customerId, normalizedLimit, offset],
    );

    const items: NotificationInboxItem[] = rows.map((r) => {
      const eventType: string = r.event_type;
      let payload: Record<string, unknown>;
      if (typeof r.payload === 'string') {
        try {
          payload = JSON.parse(r.payload) as Record<string, unknown>;
        } catch {
          payload = {};
        }
      } else {
        payload = (r.payload ?? {}) ;
      }
      // Safe reference — prefer public reference, fallback to aggregate short id, never ledger/journal
      const reference =
        (payload.reference as string | undefined) ??
        (payload.fundingRequestId as string | undefined)?.slice(0, 8) ??
        (payload.transferId as string | undefined)?.slice(0, 8) ??
        (payload.ticketId as string | undefined)?.slice(0, 8) ??
        (r.aggregate_id ? r.aggregate_id.slice(0, 8) : null);
      // User-facing status — hide raw delivery mechanics, map to availability
      // PENDING/SENT/FAILED all mean notification is available in app inbox
      const status = 'AVAILABLE';
      return {
        id: r.id,
        type: eventType,
        category: toCategory(eventType),
        title: toTitle(eventType),
        message: r.message ?? '',
        createdAt: r.created_at,
        reference: reference ?? null,
        channel: 'IN_APP',
        status,
      };
    });

    return {
      items,
      pagination: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        totalPages,
        hasNextPage: normalizedPage < totalPages,
      },
    };
  }

  private assertUuid(value: string, fieldName: string): string {
    const v = value?.trim();
    if (!v || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
      throw new BadRequestException(`${fieldName} must be a UUID`);
    }
    return v;
  }

  private normalizePage(page: number): number {
    if (!Number.isSafeInteger(page) || page < 1) throw new BadRequestException('page must be a positive integer');
    return page;
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new BadRequestException('limit must be between 1 and 100');
    return limit;
  }
}
