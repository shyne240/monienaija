import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';

import {
  NOTIFICATION_EMAIL_PROVIDER_TOKEN,
  NOTIFICATION_EMAIL_TEMPLATE_TOKEN,
  NOTIFICATION_PROVIDER_TOKEN,
} from './notification.constants';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { NotificationDeliveryProcessor } from './notification-delivery-processor';
import { appendCustomerEmailIntents, mapEventToIntents } from './notification-event-map';
import { CodeNotificationEmailTemplateService } from './notification-email-template.service';
import { NoneEmailProvider } from './email-provider.interface';
import { ConsoleNotificationProvider } from './notification-provider.interface';
import { NotificationTemplateService, canonicalNotificationEvent } from './notification-template.service';
import { NotificationProviderConfigService } from './notification-provider-config.service';
import { isSecurityCriticalNotificationEvent } from './notification-security.constants';
import type { NotificationEmailTemplateLookup, NotificationIntent, NotificationProvider, NotificationTemplateKey } from './notification.types';

export interface DispatchCommand {
  eventType: string;
  eventKey?: string | null;
  aggregateType?: string | null;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
  occurredAt?: Date | null;
}

export interface DispatchResult {
  generated: number;
  dispatched: number;
  skipped: number;
  failed: number;
  deliveries: Array<{
    id: string;
    recipientType: string;
    recipientId: string;
    channel: string;
    destination: string;
    status: string;
    providerRef: string | null;
  }>;
}

interface OutboxRow {
  id: string;
  event_type: string;
  event_key: string | null;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  causation_id: string | null;
  occurred_at: Date;
}

const CONSUMER = 'notification.v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly channelResolver: NotificationChannelResolverService,
    private readonly templateService: NotificationTemplateService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN) @Optional() private readonly injectedProvider: NotificationProvider | null,
    @Inject(NOTIFICATION_EMAIL_PROVIDER_TOKEN) @Optional() private readonly injectedEmailProvider: NotificationProvider | null,
    @Inject(NOTIFICATION_EMAIL_TEMPLATE_TOKEN) @Optional() private readonly injectedEmailTemplates: NotificationEmailTemplateLookup | null,
    @Optional() private readonly providerConfig?: NotificationProviderConfigService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private get provider(): NotificationProvider { return this.injectedProvider ?? new ConsoleNotificationProvider(); }
  private get emailProvider(): NotificationProvider { return this.injectedEmailProvider ?? new NoneEmailProvider(); }
  private get emailTemplates(): NotificationEmailTemplateLookup {
    return this.injectedEmailTemplates ?? new CodeNotificationEmailTemplateService(this.templateService);
  }

  /**
   * Materialize all intents in one transaction. The legacy direct-call convenience still
   * attempts newly inserted rows, but only AFTER that transaction commits. A caller-supplied
   * manager only materializes; it can never make a provider call before its owner commits.
   * Refresh provider configuration before entering a transaction: the configuration service
   * uses its own database connection and must not exhaust the pool while row locks are held.
   * A caller supplying its own manager is responsible for refreshing configuration before
   * opening that transaction; the outbox subscriber performs that refresh itself.
   */
  async dispatch(command: DispatchCommand, manager?: EntityManager): Promise<DispatchResult> {
    if (manager) return this.materialize(command, manager);
    await this.providerConfig?.refreshRuntimeCache();
    const result = await this.dataSource.transaction((tx) => this.materialize(command, tx));
    const processor = new NotificationDeliveryProcessor({
      dataSource: this.dataSource,
      resolver: this.channelResolver,
      templates: this.templateService,
      smsProvider: this.provider,
      emailProvider: this.emailProvider,
      maxAttempts: this.config?.get<number>('SMS_RETRY_MAX_ATTEMPTS') ?? 3,
      baseDelaySeconds: this.config?.get<number>('SMS_RETRY_BASE_DELAY_SECONDS') ?? 60,
    });
    // Only new rows are PENDING in the returned list; duplicates are never re-submitted here.
    for (const delivery of result.deliveries) {
      if (delivery.status !== 'PENDING' || !(delivery as { inserted?: boolean }).inserted) continue;
      await processor.processOne(delivery.id);
      const rows = await this.dataSource.query<Array<{ status: string; provider_ref: string | null }>>(
        `SELECT status, provider_ref FROM notification_deliveries WHERE id=$1`, [delivery.id],
      );
      if (rows[0]) {
        delivery.status = rows[0].status;
        delivery.providerRef = rows[0].provider_ref;
        if (delivery.status === 'SENT') result.dispatched += 1;
        else if (['FAILED', 'DEAD', 'UNKNOWN'].includes(delivery.status)) result.failed += 1;
        else if (delivery.status === 'SKIPPED') result.skipped += 1;
      }
    }
    for (const delivery of result.deliveries) delete (delivery as { inserted?: boolean }).inserted;
    return result;
  }

  private async materialize(command: DispatchCommand, manager: EntityManager): Promise<DispatchResult> {
    const eventType = command.eventType?.trim();
    if (!eventType) throw new Error('eventType is required');
    if (isSecurityCriticalNotificationEvent(eventType)) throw new Error('Security notifications cannot use the outbox dispatcher');
    const eventKey = command.eventKey?.trim() ||
      (command.occurredAt ? `${eventType}:${command.aggregateId ?? 'no-agg'}:${command.occurredAt.toISOString()}` : '');
    if (!eventKey || eventKey.length > 180) throw new Error('A stable eventKey or occurredAt is required');
    const payload = command.payload ?? {};
    const safePayload = this.templateService.redactPayload(payload, eventType);
    const result: DispatchResult = { generated: 0, dispatched: 0, skipped: 0, failed: 0, deliveries: [] };

    // A completed internal transfer needs both sides; a producer missing either side is
    // quarantined for the Arena 3 producer handoff rather than partially acknowledged.
    if (eventType === 'transfer.completed' && (!payload.sourceCustomerId || !payload.destinationCustomerId)) return result;
    // A missing internal/public marker is not evidence that a support message is public.
    if (eventType === 'support.ticket.message_added' && payload.isInternal !== false) return result;
    let intents = mapEventToIntents(eventType, payload, {
      correlationId: command.correlationId ?? null,
      causationId: command.causationId ?? null,
    });
    if (intents.length === 0 && eventType.startsWith('support.ticket.') && this.templateService.definition(eventType)) {
      const ticketId = typeof payload.ticketId === 'string' ? payload.ticketId : command.aggregateId;
      if (ticketId && UUID_PATTERN.test(ticketId)) {
        const rows = await manager.query<Array<{ customer_id: string | null; agent_id: string | null }>>(
          `SELECT customer_id, agent_id FROM support_tickets WHERE id=$1 LIMIT 1`, [ticketId],
        );
        const row = rows[0];
        let templateKey = eventType;
        if (eventType === 'support.ticket.status_changed') {
          const status = payload.status ?? payload.to ?? payload.newStatus;
          if (status === 'RESOLVED') templateKey = 'support.ticket.resolved';
          else if (status === 'CLOSED') templateKey = 'support.ticket.closed';
        }
        const fallback: NotificationIntent[] = [];
        if (row?.customer_id) fallback.push({ recipientType: 'CUSTOMER', recipientId: row.customer_id, channel: 'SMS', templateKey });
        if (row?.agent_id) fallback.push({ recipientType: 'AGENT', recipientId: row.agent_id, channel: 'SMS', templateKey });
        intents = fallback;
      }
    }
    if (this.emailProvider.name !== 'none') intents = appendCustomerEmailIntents(eventType, intents);

    for (const intent of intents) {
      if (intent.recipientType !== 'PHONE' && !UUID_PATTERN.test(intent.recipientId)) {
        throw new Error('Invalid notification recipient');
      }
      const enabled = intent.channel === 'SMS' || intent.channel === 'EMAIL'
        ? await this.templateService.isEventEnabled(manager, eventType, intent.channel) : true;
      const resolved = enabled
        ? await this.channelResolver.resolve(intent.recipientType, intent.recipientId, intent.channel, manager, eventType)
        : { destination: null, reason: 'EVENT_DISABLED' };
      const email = enabled && intent.channel === 'EMAIL'
        ? await this.emailTemplates.buildEmail(intent.templateKey as NotificationTemplateKey, safePayload, manager) : null;
      const message = !enabled ? 'Notification disabled.' : intent.channel === 'SMS'
        ? (await this.templateService.renderActive(manager, intent.templateKey, 'SMS', safePayload)).body
        : email ? email.text : this.templateService.buildMessage(intent.templateKey, safePayload);
      const destination = resolved.destination ?? `SKIPPED:${resolved.reason ?? 'UNKNOWN'}`;
      const status = resolved.destination ? 'PENDING' : 'SKIPPED';
      const inserted = await manager.query<Array<{ id: string }>>(
        `INSERT INTO notification_deliveries
          (event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id,
           channel, destination, payload, message, rendered_subject, rendered_html, status,
           attempts, last_error, correlation_id, causation_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,0,$14,$15,$16,NOW(),NOW())
         ON CONFLICT (event_key, recipient_id, channel) DO NOTHING RETURNING id`,
        [eventType, eventKey, command.aggregateType ?? null, command.aggregateId ?? null,
          intent.recipientType, intent.recipientId, intent.channel, destination,
          JSON.stringify({ ...safePayload, _templateKey: intent.templateKey }), message,
          email?.subject ?? null, email?.html ?? null, status, resolved.reason ?? null,
          command.correlationId ?? null, command.causationId ?? null],
      );
      let delivery: DispatchResult['deliveries'][number] & { inserted?: boolean };
      if (inserted[0]) {
        result.generated += 1;
        if (status === 'SKIPPED') result.skipped += 1;
        delivery = { id: inserted[0].id, recipientType: intent.recipientType, recipientId: intent.recipientId,
          channel: intent.channel, destination, status, providerRef: null, inserted: true };
      } else {
        const existing = await manager.query<Array<{ id: string; status: string; provider_ref: string | null; destination: string }>>(
          `SELECT id, status, provider_ref, destination FROM notification_deliveries
            WHERE event_key=$1 AND recipient_id=$2 AND channel=$3 LIMIT 1`,
          [eventKey, intent.recipientId, intent.channel],
        );
        if (!existing[0]) throw new Error('Notification idempotency conflict unavailable');
        delivery = { id: existing[0].id, recipientType: intent.recipientType, recipientId: intent.recipientId,
          channel: intent.channel, destination: existing[0].destination, status: existing[0].status,
          providerRef: existing[0].provider_ref };
      }
      result.deliveries.push(delivery);
    }
    return result;
  }

  /** Independent subscriber; no writes to shared outbox status, attempts, or other consumers. */
  async processPendingOutboxEvents(limit = 10): Promise<number> {
    await this.providerConfig?.refreshRuntimeCache();
    let processed = 0;
    for (let i = 0; i < Math.max(0, Math.min(500, limit)); i += 1) {
      let selectedId: string | null = null;
      try {
        const found = await this.dataSource.transaction(async (manager) => {
          const events = await manager.query<OutboxRow[]>(
            `SELECT o.id, o.event_type, o.event_key, o.schema_version, o.aggregate_type, o.aggregate_id,
                    o.payload, o.correlation_id, o.causation_id, o.occurred_at
               FROM outbox_events o LEFT JOIN notification_outbox_receipts r
                 ON r.outbox_event_id=o.id AND r.consumer_name=$1
              WHERE r.outbox_event_id IS NULL OR
                    (r.status='FAILED' AND r.next_attempt_at <= NOW())
              ORDER BY o.created_at, o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [CONSUMER],
          );
          const event = events[0];
          if (!event) return false;
          selectedId = event.id;
          let status: 'MATERIALIZED' | 'SUPPRESSED' | 'UNSUPPORTED' | 'QUARANTINED';
          let reason: string | null = null;
          const canonical = canonicalNotificationEvent(event.event_type);
          if (isSecurityCriticalNotificationEvent(event.event_type)) {
            status = 'QUARANTINED'; reason = 'SECURITY_DIRECT_ONLY';
          } else if (!this.templateService.definition(canonical)) {
            status = 'QUARANTINED'; reason = 'EVENT_TYPE_UNSUPPORTED';
          } else if (event.schema_version !== 1) {
            status = 'QUARANTINED'; reason = 'UNSUPPORTED_SCHEMA_VERSION';
          } else if (event.event_type === 'support.ticket.message_added' && event.payload?.isInternal === true) {
            status = 'SUPPRESSED'; reason = 'INTERNAL_SUPPORT_MESSAGE';
          } else if (event.event_type === 'support.ticket.message_added' && event.payload?.isInternal !== false) {
            status = 'QUARANTINED'; reason = 'SUPPORT_VISIBILITY_UNKNOWN';
          } else {
            const result = await this.dispatch({ eventType: event.event_type, eventKey: event.event_key,
              aggregateType: event.aggregate_type, aggregateId: event.aggregate_id, payload: event.payload ?? {},
              correlationId: event.correlation_id, causationId: event.causation_id, occurredAt: event.occurred_at }, manager);
            status = result.deliveries.length > 0 ? 'MATERIALIZED' : 'QUARANTINED';
            if (status === 'QUARANTINED') reason = 'NO_NOTIFICATION_INTENTS';
          }
          await manager.query(
            `INSERT INTO notification_outbox_receipts
              (consumer_name, outbox_event_id, status, reason, attempts, next_attempt_at)
             VALUES ($1,$2,$3,$4,1,NULL)
             ON CONFLICT (consumer_name, outbox_event_id) DO UPDATE SET
               status=EXCLUDED.status, reason=EXCLUDED.reason,
               attempts=notification_outbox_receipts.attempts+1, next_attempt_at=NULL, updated_at=NOW()`,
            [CONSUMER, event.id, status, reason],
          );
          return true;
        });
        if (!found) break;
        processed += 1;
      } catch {
        // No bound parameters, exception messages, event payloads or destinations enter logs.
        this.logger.warn({ event: 'notification.materialization_failed' });
        if (!selectedId) break;
        try {
          await this.dataSource.query(
            `INSERT INTO notification_outbox_receipts
              (consumer_name, outbox_event_id, status, reason, attempts, next_attempt_at)
             VALUES ($1,$2,'FAILED','MATERIALIZATION_FAILED',1,NOW()+INTERVAL '60 seconds')
             ON CONFLICT (consumer_name, outbox_event_id) DO UPDATE SET
               attempts=notification_outbox_receipts.attempts+1,
               status=CASE WHEN notification_outbox_receipts.attempts+1 >= 5 THEN 'QUARANTINED' ELSE 'FAILED' END,
               reason=CASE WHEN notification_outbox_receipts.attempts+1 >= 5 THEN 'MATERIALIZATION_EXHAUSTED' ELSE 'MATERIALIZATION_FAILED' END,
               next_attempt_at=CASE WHEN notification_outbox_receipts.attempts+1 >= 5 THEN NULL ELSE NOW()+INTERVAL '60 seconds' END,
               updated_at=NOW()
             WHERE notification_outbox_receipts.status='FAILED'`, [CONSUMER, selectedId],
          );
        } catch { break; }
      }
    }
    return processed;
  }

  async listDeliveriesForEventKey(eventKey: string): Promise<Array<Record<string, unknown>>> {
    return this.dataSource.query(`SELECT * FROM notification_deliveries WHERE event_key=$1 ORDER BY created_at ASC`, [eventKey]);
  }
}
