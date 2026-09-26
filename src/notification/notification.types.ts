export type NotificationChannel = 'SMS' | 'PUSH';
export type NotificationRecipientType = 'CUSTOMER' | 'AGENT';
export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

/**
 * Provider-neutral dispatch abstraction.
 * V1-005 uses Console/Test adapter (replaceable, not invented credentials).
 * Reporting distinguishes: NOTIFICATION EVENT GENERATED (outbox) vs DISPATCHED (delivery SENT) vs PROVIDER DELIVERY (providerRef).
 */
export interface NotificationSendRequest {
  channel: NotificationChannel;
  destination: string;
  message: string;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  eventType: string;
  eventKey: string;
  recipientType: NotificationRecipientType;
  recipientId: string;
}

export interface NotificationSendResult {
  success: boolean;
  providerRef?: string | null;
  error?: string | null;
}

export interface NotificationProvider {
  readonly name: string;
  send(request: NotificationSendRequest): Promise<NotificationSendResult>;
}

export interface NotificationIntent {
  recipientType: NotificationRecipientType;
  recipientId: string;
  channel: NotificationChannel;
  // templateKey helps safe message generation
  templateKey: string;
  correlationId?: string | null;
  causationId?: string | null;
}

/**
 * Explicit event catalogue → recipient/channel/template mapping.
 * PRODUCT SCOPE: Push + SMS only (no Email unless authoritative).
 * Customer vs Agent clearly distinguished; fallback documented.
 */
export type EventNotificationMapping = {
  eventType: string;
  intents: (payload: Record<string, unknown>, outbox: { correlationId: string | null; causationId: string | null }) => NotificationIntent[];
  required: boolean;
  possible: boolean;
  fallback: string;
};

/**
 * Canonical outbox event types reused (no second outbox):
 * - transfer.completed
 * - customer.funding.approved / customer.funding.rejected (and requested but not required)
 * - support.ticket.created / assigned / status_changed / resolved / closed / message_added
 * - cash_to_cash.claimed / expired (mapped if payload present)
 * - agent.* (lifecycle) — dependency, resolved via Agent contact future
 */
