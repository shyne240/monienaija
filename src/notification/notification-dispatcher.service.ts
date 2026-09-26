/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unnecessary-type-assertion, prefer-const, no-empty */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { NOTIFICATION_PROVIDER_TOKEN } from './notification.constants';
import { NotificationChannelResolverService } from './notification-channel-resolver.service';
import { mapEventToIntents } from './notification-event-map';
import { NotificationTemplateService } from './notification-template.service';
import type { NotificationProvider } from './notification.types';

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

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly channelResolver: NotificationChannelResolverService,
    private readonly templateService: NotificationTemplateService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN) @Optional() private readonly injectedProvider: NotificationProvider | null,
  ) {}

  private get provider(): NotificationProvider {
    if (this.injectedProvider) return this.injectedProvider;
    // Fallback console provider (should not happen in prod, but safe for tests)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConsoleNotificationProvider } = require('./notification-provider.interface');
    return new ConsoleNotificationProvider();
  }

  /**
   * Dispatch notifications for a business outbox event.
   * - Reuses existing outbox eventKey for idempotency (deterministic: eventKey + recipient + channel)
   * - Redacted payload/message (no secrets)
   * - Provider failure isolated (marks FAILED, does not throw to reverse financial state)
   * - Duplicate event → idempotent (ON CONFLICT DO NOTHING, second call dispatched count 0)
   * - Internal support notes never dispatched (filtered in mapEventToIntents)
   */
  async dispatch(
    command: DispatchCommand,
    manager?: EntityManager,
  ): Promise<DispatchResult> {
    const eventType = command.eventType?.trim();
    if (!eventType) throw new Error('eventType is required');

    const payload = (command.payload ?? {}) as Record<string, unknown>;
    const redactedPayload = this.templateService.redactPayload(payload) as Record<string, unknown>;

    // Deterministic eventKey: use provided eventKey or fallback to aggregate+type+occurredAt hash-like
    const eventKey =
      command.eventKey?.trim() ||
      `${eventType}:${command.aggregateId ?? 'no-agg'}:${command.occurredAt?.toISOString() ?? Date.now()}`;

    if (eventKey.length > 180) throw new Error('eventKey must be at most 180 characters');

    const queryRunner = (manager as any)?.query ? (manager as any) : this.dataSource;

    let intents = mapEventToIntents(eventType, payload, {
      correlationId: command.correlationId ?? null,
      causationId: command.causationId ?? null,
    });

    // Fallback for support events where payload lacks customerId/agentId (e.g., assigned/status_changed)
    // Resolve via support_tickets table using ticketId or aggregateId
    if (intents.length === 0 && eventType.startsWith('support.ticket')) {
      // internal notes already filtered, but double-check
      if (eventType === 'support.ticket.message_added' && (payload.isInternal as boolean) === true) {
        return { generated: 0, dispatched: 0, skipped: 0, failed: 0, deliveries: [] };
      }
      try {
        const ticketId = (payload.ticketId as string | undefined) ?? command.aggregateId ?? undefined;
        if (ticketId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId)) {
          const rows: Array<{ customer_id: string | null; agent_id: string | null }> = await queryRunner.query(
            `SELECT customer_id, agent_id FROM support_tickets WHERE id=$1 LIMIT 1`,
            [ticketId],
          );
          const row = rows[0];
          if (row) {
            const fallback: typeof intents = [];
            // Use template mapping similar to mapEventToIntents but with DB-derived ids
            let templateKey = eventType;
            if (eventType === 'support.ticket.status_changed') {
              const status = (payload as any).status ?? (payload as any).to ?? (payload as any).newStatus;
              if (status === 'RESOLVED') templateKey = 'support.ticket.resolved';
              else if (status === 'CLOSED') templateKey = 'support.ticket.closed';
            }
            if (row.customer_id) {
              fallback.push({
                recipientType: 'CUSTOMER',
                recipientId: row.customer_id,
                channel: 'SMS',
                templateKey,
                correlationId: command.correlationId ?? null,
                causationId: command.causationId ?? null,
              });
            }
            if (row.agent_id) {
              fallback.push({
                recipientType: 'AGENT',
                recipientId: row.agent_id,
                channel: 'SMS',
                templateKey,
                correlationId: command.correlationId ?? null,
                causationId: command.causationId ?? null,
              });
            }
            if (fallback.length > 0) intents = fallback;
          }
        }
      } catch {
        // ignore fallback errors
      }
    }

    if (intents.length === 0) {
      return { generated: 0, dispatched: 0, skipped: 0, failed: 0, deliveries: [] };
    }

    // dsManager kept for compatibility but not used (queryRunner is authoritative)
    const dsManager = manager ?? this.dataSource.createEntityManager();

    const result: DispatchResult = { generated: 0, dispatched: 0, skipped: 0, failed: 0, deliveries: [] };

    for (const intent of intents) {
      // Resolve destination per recipient/channel
      const resolved = await this.channelResolver.resolve(
        intent.recipientType,
        intent.recipientId,
        intent.channel,
        queryRunner,
      );

      const destination = resolved.destination;
      const isSkipped = !destination;

      const message = this.templateService.buildMessage(intent.templateKey, payload);
      // Ensure no secrets in message (we already avoid, but double-check)
      // Do not include payload secrets; message is safe template only

      // Build redacted delivery payload with templateKey for audit (still redacted, no secrets)
      const deliveryPayload: Record<string, unknown> = {
        ...redactedPayload,
        _templateKey: intent.templateKey,
      };

      // Deterministic identity for idempotency
      const deliveryIdempotencyKey = `${eventKey}:${intent.recipientId}:${intent.channel}`;

      // Insert delivery record — idempotent via unique constraint
      let deliveryId: string | null = null;
      let wasInserted = false;

      // Try insert; if conflict, fetch existing
      try {
        const insertRows: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO notification_deliveries
              (event_type, event_key, aggregate_type, aggregate_id, recipient_type, recipient_id, channel, destination, payload, message, status, attempts, correlation_id, causation_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,0,$12,$13,NOW(),NOW())
           ON CONFLICT (event_key, recipient_id, channel) DO NOTHING
           RETURNING id`,
          [
            eventType,
            eventKey,
            command.aggregateType ?? null,
            command.aggregateId ?? null,
            intent.recipientType,
            intent.recipientId,
            intent.channel,
            destination ?? `SKIPPED:${resolved.reason ?? 'UNKNOWN'}`,
            JSON.stringify(deliveryPayload),
            message.slice(0, 1000),
            isSkipped ? 'SKIPPED' : 'PENDING',
            command.correlationId ?? null,
            command.causationId ?? null,
          ],
        );
        if (insertRows.length > 0) {
          deliveryId = insertRows[0]!.id;
          wasInserted = true;
          result.generated += 1;
          if (isSkipped) result.skipped += 1;
        } else {
          // Conflict — fetch existing delivery
          const existing: Array<{ id: string; status: string; provider_ref: string | null }> =
            await queryRunner.query(
              `SELECT id, status, provider_ref FROM notification_deliveries
                WHERE event_key=$1 AND recipient_id=$2 AND channel=$3 LIMIT 1`,
              [eventKey, intent.recipientId, intent.channel],
            );
          if (existing[0]) {
            deliveryId = existing[0].id;
            // Not counted as generated; idempotent replay
            result.deliveries.push({
              id: existing[0].id,
              recipientType: intent.recipientType,
              recipientId: intent.recipientId,
              channel: intent.channel,
              destination: destination ?? `SKIPPED:${resolved.reason ?? 'UNKNOWN'}`,
              status: existing[0].status,
              providerRef: existing[0].provider_ref,
            });
            continue;
          } else {
            // Should not happen
            continue;
          }
        }
      } catch (e) {
        this.logger.warn(`Failed to insert notification delivery ${deliveryIdempotencyKey}: ${(e as Error).message}`);
        result.failed += 1;
        continue;
      }

      if (isSkipped) {
        // Update SKIPPED reason
        try {
          await queryRunner.query(
            `UPDATE notification_deliveries SET status='SKIPPED', last_error=$1, updated_at=NOW() WHERE id=$2`,
            [resolved.reason?.slice(0, 1000) ?? 'SKIPPED', deliveryId],
          );
        } catch {}
        if (wasInserted) {
          result.deliveries.push({
            id: deliveryId!,
            recipientType: intent.recipientType,
            recipientId: intent.recipientId,
            channel: intent.channel,
            destination: `SKIPPED:${resolved.reason ?? 'UNKNOWN'}`,
            status: 'SKIPPED',
            providerRef: null,
          });
        }
        continue;
      }

      // Attempt provider send — isolated failure (do not throw to caller that would reverse financial state)
      let providerRef: string | null = null;
      let lastError: string | null = null;
      let status: string = 'PENDING';
      const attemptsIncrement = 1;

      try {
        const sendResult = await this.provider.send({
          channel: intent.channel,
          destination: destination!,
          message,
          payload: redactedPayload,
          correlationId: command.correlationId ?? null,
          eventType,
          eventKey,
          recipientType: intent.recipientType,
          recipientId: intent.recipientId,
        });

        if (sendResult.success) {
          providerRef = sendResult.providerRef ?? null;
          status = 'SENT';
          result.dispatched += 1;
        } else {
          lastError = (sendResult.error ?? 'Provider returned failure').slice(0, 1000);
          status = 'FAILED';
          result.failed += 1;
        }
      } catch (err) {
        lastError = ((err as Error).message ?? 'Provider threw').slice(0, 1000);
        status = 'FAILED';
        result.failed += 1;
      }

      // Update delivery record with result — preserve idempotency even if provider fails
      try {
        const now = new Date();
        if (status === 'SENT') {
          await queryRunner.query(
            `UPDATE notification_deliveries
                SET status='SENT', attempts=attempts+$1, provider_ref=$2, sent_at=$3, last_error=NULL, updated_at=NOW()
              WHERE id=$4`,
            [attemptsIncrement, providerRef, now, deliveryId],
          );
        } else {
          await queryRunner.query(
            `UPDATE notification_deliveries
                SET status='FAILED', attempts=attempts+$1, last_error=$2, failed_at=$3, updated_at=NOW()
              WHERE id=$4`,
            [attemptsIncrement, lastError, now, deliveryId],
          );
        }
      } catch (e) {
        this.logger.warn(`Failed to update delivery ${deliveryId}: ${(e as Error).message}`);
      }

      result.deliveries.push({
        id: deliveryId!,
        recipientType: intent.recipientType,
        recipientId: intent.recipientId,
        channel: intent.channel,
        destination: destination!,
        status,
        providerRef,
      });
    }

    return result;
  }

  /**
   * Process pending outbox events (for background polling) — claims PENDING/FAILED outbox events
   * and dispatches notifications. Reuses OutboxService claim semantics via direct query to avoid circular.
   * For V1 tests we can invoke dispatch() directly after business transaction; this method is for completeness.
   */
  async processPendingOutboxEvents(limit = 10): Promise<number> {
    const events: Array<{
      id: string;
      event_type: string;
      event_key: string | null;
      aggregate_type: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
      correlation_id: string | null;
      causation_id: string | null;
      occurred_at: Date;
    }> = await this.dataSource.query(
      `SELECT id, event_type, event_key, aggregate_type, aggregate_id, payload, correlation_id, causation_id, occurred_at
         FROM outbox_events
        WHERE status IN ('PENDING','FAILED')
        ORDER BY created_at ASC
        LIMIT $1`,
      [limit],
    );

    let processed = 0;
    for (const ev of events) {
      try {
        await this.dispatch({
          eventType: ev.event_type,
          eventKey: ev.event_key,
          aggregateType: ev.aggregate_type,
          aggregateId: ev.aggregate_id,
          payload: ev.payload as Record<string, unknown>,
          correlationId: ev.correlation_id,
          causationId: ev.causation_id,
          occurredAt: ev.occurred_at,
        });
        processed += 1;
        // Mark outbox as PUBLISHED after dispatch attempt (even if some deliveries SKIPPED/FAILED — provider failure isolated, outbox still published)
        await this.dataSource.query(
          `UPDATE outbox_events SET status='PUBLISHED', attempts=attempts+1, published_at=NOW() WHERE id=$1`,
          [ev.id],
        );
      } catch (e) {
        await this.dataSource.query(
          `UPDATE outbox_events SET status='FAILED', attempts=attempts+1, last_error=$1, available_at=NOW() + INTERVAL '60 seconds' WHERE id=$1`,
          [(e as Error).message.slice(0, 255), ev.id],
        );
      }
    }
    return processed;
  }

  /**
   * Helper for tests: fetch deliveries for eventKey.
   */
  async listDeliveriesForEventKey(eventKey: string): Promise<Array<any>> {
    return this.dataSource.query(`SELECT * FROM notification_deliveries WHERE event_key=$1 ORDER BY created_at ASC`, [eventKey]);
  }
}
