// ARENA3-NOTIFICATION-EMAIL: EMAIL widened alongside SMS/PUSH. Migration
// 1785753600097-AddEmailNotificationChannel replaces the DB CHECK constraint;
// existing SMS/PUSH rows are untouched.
export type NotificationChannel = 'SMS' | 'PUSH' | 'EMAIL';
// ARENA4-INTEGRATION: PHONE widened for unregistered Cash-to-Cash beneficiaries. Migration
// 1785753600099-AllowPhoneNotificationRecipients widens recipient_type + recipient_id.
export type NotificationRecipientType = 'CUSTOMER' | 'AGENT' | 'PHONE';
export type NotificationDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED' | 'UNKNOWN' | 'DEAD';

/**
 * Provider-neutral dispatch abstraction.
 * V1-005 uses Console/Test adapter (replaceable, not invented credentials).
 * Reporting distinguishes an outbox event and durable delivery from provider acceptance.
 * A provider reference or SENT status does not confirm end-recipient delivery.
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
  /** EMAIL only — sanitized subject (header-injection-safe). Ignored by SMS/PUSH providers. */
  subject?: string;
  /** EMAIL only — escaped HTML body. `message` always carries the plain-text equivalent. */
  html?: string;
}

export interface NotificationSendResult {
  success: boolean;
  providerRef?: string | null;
  error?: string | null;
  /** Explicit provider knowledge; absence is treated conservatively as an ambiguous outcome. */
  failureDisposition?: 'RETRYABLE' | 'PERMANENT' | 'UNKNOWN';
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
 * ARENA3-NOTIFICATION-EMAIL — template/rendering seam shared with Arena 1.
 *
 * Arena 1 owns the canonical event/template configuration and the future database-backed
 * template registry. This interface is the coordination contract: Arena 1's registry
 * implements it and is bound to NOTIFICATION_EMAIL_TEMPLATE_TOKEN (notification.constants.ts),
 * replacing the code-backed default (CodeNotificationEmailTemplateService). Dispatcher and
 * worker consume ONLY this interface — zero changes needed when the registry lands.
 * Keys mirror the existing NotificationTemplateService switch (SMS/Push wording parity:
 * the plain-text body must remain identical to buildMessage for the same key).
 */
export type NotificationTemplateKey =
  | 'customer.funding.approved'
  | 'customer.funding.rejected'
  | 'customer.funding.requested'
  | 'transfer.completed'
  | 'transfer.failed'
  | 'support.ticket.created'
  | 'support.ticket.assigned'
  | 'support.ticket.status_changed'
  | 'support.ticket.resolved'
  | 'support.ticket.closed'
  | 'support.ticket.message_added'
  | 'cash_to_cash.claimed'
  | 'cash_to_cash.expired'
  | 'cash_to_cash.created'
  | 'agent.application.approved'
  | 'agent.application.rejected'
  | 'agent.activated'
  | 'agent.suspended'
  | 'agent.terminated'
  | 'agent.reactivated';

export type NotificationTemplatePayload = Record<string, unknown>;

export interface RenderedEmail {
  /** Sanitized subject — never contains CR/LF/control characters, bounded, no internal event names. */
  subject: string;
  /** Plain-text body — identical wording to the SMS/Push message for the same template key. */
  text: string;
  /** Fully escaped HTML body (fixed minimal layout, no scripts/external resources/dynamic styles). */
  html: string;
}

/**
 * INTEGRATION (Phase 3): `query` carries the persistent template registry connection
 * (dispatcher queryRunner / worker DataSource). When provided, implementations MUST render
 * from the registry's ACTIVE approved EMAIL version (fail-closed when unavailable) so code
 * and database template systems can never silently disagree. When omitted (unit contexts),
 * the frozen code defaults are used — they are byte-identical to the migration-seeded
 * registry defaults.
 */
export interface NotificationEmailQuery {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export interface NotificationEmailTemplateLookup {
  buildEmail(
    templateKey: NotificationTemplateKey,
    payload: NotificationTemplatePayload,
    query?: NotificationEmailQuery,
  ): Promise<RenderedEmail>;
}

/**
 * Canonical outbox event types reused (no second outbox):
 * - transfer.completed
 * - customer.funding.approved / customer.funding.rejected (and requested but not required)
 * - support.ticket.created / assigned / status_changed / resolved / closed / message_added
 * - cash_to_cash.claimed / expired (mapped if payload present)
 * - agent.* (lifecycle) — dependency, resolved via Agent contact future
 */
