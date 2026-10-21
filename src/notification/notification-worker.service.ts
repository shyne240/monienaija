 
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { NOTIFICATION_PROVIDER_TOKEN } from './notification.constants';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import type { NotificationProvider } from './notification.types';

export interface NotificationWorkerTickResult {
  outboxProcessed: number;
  retriesClaimed: number;
  retriesSent: number;
  retriesFailed: number;
  retriesOptedOut: number;
}

interface ClaimedDeliveryRow {
  id: string;
  event_type: string;
  event_key: string;
  recipient_type: 'CUSTOMER' | 'AGENT';
  recipient_id: string;
  channel: 'SMS' | 'PUSH';
  destination: string;
  message: string | null;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  attempts: number;
}

/**
 * SMS-V1-01 — provider-neutral notification delivery worker.
 *
 * Narrowest mechanism required to make the V1 REQUIRED events deliverable:
 *   1. Drain pending outbox events (dispatch → delivery insert, in-transaction idempotent).
 *   2. Bounded retry of FAILED deliveries.
 *
 * Concurrency/idempotency design (no schema change, no general job platform):
 * - Outbox drain is serialized through the delivery unique key (event_key, recipient_id,
 *   channel): concurrent workers converge with ON CONFLICT DO NOTHING and never re-send.
 * - Retry claiming uses `FOR UPDATE SKIP LOCKED` inside a short transaction; the claim bumps
 *   updated_at, which doubles as a lease: a row only becomes re-eligible after its backoff
 *   delay computed FROM updated_at, so two workers in the same window cannot hold the same row.
 * - A deterministic provider Idempotency-Key (eventKey:recipientId:channel) makes even an
 *   adversarial double-submit idempotent at the provider (Robase contract, 24h replay window).
 *
 * Bounded retry: a delivery is retry-eligible while attempts < SMS_RETRY_MAX_ATTEMPTS and
 * updated_at <= NOW() - (SMS_RETRY_BASE_DELAY_SECONDS * 2^(attempts-1)). After exhaustion the
 * row remains auditable FAILED with last_error — the worker never blocks, never retries
 * indefinitely, and NEVER touches financial state.
 */
@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly configService: ConfigService,
    @Inject(NOTIFICATION_PROVIDER_TOKEN)
    @Optional()
    private readonly provider: NotificationProvider | null,
  ) {}

  private get enabled(): boolean {
    return this.configService.get<boolean>('NOTIFICATION_WORKER_ENABLED') === true;
  }

  private get pollIntervalMs(): number {
    return this.configService.get<number>('NOTIFICATION_WORKER_POLL_INTERVAL_MS') ?? 5_000;
  }

  private get batchSize(): number {
    return this.configService.get<number>('NOTIFICATION_WORKER_BATCH_SIZE') ?? 10;
  }

  private get maxAttempts(): number {
    return this.configService.get<number>('SMS_RETRY_MAX_ATTEMPTS') ?? 3;
  }

  private get baseDelaySeconds(): number {
    return this.configService.get<number>('SMS_RETRY_BASE_DELAY_SECONDS') ?? 60;
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Notification worker disabled (NOTIFICATION_WORKER_ENABLED != true)');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        // A tick failure must never crash the process; next tick retries.
        this.logger.warn(`Notification worker tick failed: ${(error as Error).message}`);
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Notification worker started (interval=${this.pollIntervalMs}ms, batch=${this.batchSize}, maxAttempts=${this.maxAttempts})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<NotificationWorkerTickResult> {
    const empty: NotificationWorkerTickResult = {
      outboxProcessed: 0,
      retriesClaimed: 0,
      retriesSent: 0,
      retriesFailed: 0,
      retriesOptedOut: 0,
    };
    if (this.running) return empty; // re-entrancy guard (single instance, overlapping ticks)
    this.running = true;
    try {
      const outboxProcessed = await this.dispatcher.processPendingOutboxEvents(this.batchSize);
      const { claimed, ...rest } = await this.retryFailedDeliveries(this.batchSize);
      return { outboxProcessed, retriesClaimed: claimed.length, ...rest };
    } finally {
      this.running = false;
    }
  }

  /**
   * Claim retry-eligible FAILED deliveries. Eligibility and the updated_at lease are one
   * atomic UPDATE … FOR UPDATE SKIP LOCKED — safe under concurrent workers and instances.
   */
  private async claimRetryEligible(limit: number): Promise<ClaimedDeliveryRow[]> {
    return this.dataSource.transaction(async (manager) => {
      // TypeORM's Postgres driver returns UPDATE…RETURNING results as the tuple
      // [records, affectedCount] (unlike INSERT…RETURNING, which yields records directly).
      // Unwrap defensively: only record arrays are claim rows.
      const raw: unknown = await manager.query(
        `UPDATE notification_deliveries c
            SET updated_at = NOW()
           FROM (
             SELECT id FROM notification_deliveries
              WHERE status = 'FAILED'
                AND attempts < $1
                AND destination NOT LIKE 'SKIPPED:%'
                AND updated_at <= NOW()
                      - ($2::numeric * POWER(2, attempts - 1)) * INTERVAL '1 second'
              ORDER BY updated_at ASC
              LIMIT $3
              FOR UPDATE SKIP LOCKED
           ) src
          WHERE c.id = src.id
          RETURNING c.id, c.event_type, c.event_key, c.recipient_type, c.recipient_id,
                    c.channel, c.destination, c.message, c.payload, c.correlation_id, c.attempts`,
        [this.maxAttempts, this.baseDelaySeconds, limit],
      );
      const rows = Array.isArray(raw) && Array.isArray((raw as unknown[])[0])
        ? ((raw as unknown[])[0] as ClaimedDeliveryRow[])
        : (raw as ClaimedDeliveryRow[]);
      return Array.isArray(rows) ? rows : [];
    });
  }

  private async retryFailedDeliveries(limit: number): Promise<{
    claimed: ClaimedDeliveryRow[];
    retriesSent: number;
    retriesFailed: number;
    retriesOptedOut: number;
  }> {
    const claimed = await this.claimRetryEligible(limit);
    let retriesSent = 0;
    let retriesFailed = 0;
    let retriesOptedOut = 0;

    for (const row of claimed) {
      try {
        // Re-check the SMS preference at retry time: an opt-out recorded after the initial
        // failure must be honored (security-critical events never surface here — the set is
        // empty for V1 — but the check is harmless and future-proof).
        if (row.recipient_type === 'CUSTOMER' && row.channel === 'SMS') {
          const optedOut = await this.isSmsOptedOut(row.recipient_id);
          if (optedOut) {
            await this.dataSource.query(
              `UPDATE notification_deliveries
                  SET status='SKIPPED', last_error='SMS_OPT_OUT', updated_at=NOW()
                WHERE id=$1 AND status='FAILED'`,
              [row.id],
            );
            retriesOptedOut += 1;
            continue;
          }
        }

        const result = this.provider
          ? await this.provider.send({
              channel: row.channel,
              destination: row.destination,
              message: (row.message ?? '').slice(0, 1000),
              payload: (row.payload ?? {}),
              correlationId: row.correlation_id,
              eventType: row.event_type,
              eventKey: row.event_key,
              recipientType: row.recipient_type,
              recipientId: row.recipient_id,
            })
          : { success: false, error: 'WORKER_NO_PROVIDER_CONFIGURED' };

        if (result.success) {
          // Conditional status guard: only a concurrent-safe FAILED→SENT transition persists.
          await this.dataSource.query(
            `UPDATE notification_deliveries
                SET status='SENT', attempts=attempts+1, provider_ref=$1, sent_at=NOW(),
                    last_error=NULL, updated_at=NOW()
              WHERE id=$2 AND status='FAILED'`,
            [result.providerRef ?? null, row.id],
          );
          retriesSent += 1;
        } else {
          const exhausted = row.attempts + 1 >= this.maxAttempts;
          await this.dataSource.query(
            `UPDATE notification_deliveries
                SET status='FAILED', attempts=attempts+1, last_error=$1, failed_at=NOW(), updated_at=NOW()
              WHERE id=$2 AND status='FAILED'`,
            [(result.error ?? 'Provider returned failure').slice(0, 1000), row.id],
          );
          retriesFailed += 1;
          if (exhausted) {
            this.logger.warn(
              `Notification delivery ${row.id} (${row.event_type}) terminally FAILED after ${this.maxAttempts} attempts: ${(result.error ?? '').slice(0, 200)}`,
            );
          }
        }
      } catch (error) {
        // Provider threw through isolation and/or DB hiccup: leave row FAILED for next cycle.
        // Never log provider payloads; message text is provider-safe by adapter contract.
        this.logger.warn(
          `Retry of notification delivery ${row.id} failed: ${(error as Error).message.slice(0, 500)}`,
        );
        retriesFailed += 1;
      }
    }

    return { claimed, retriesSent, retriesFailed, retriesOptedOut };
  }

  private async isSmsOptedOut(customerId: string): Promise<boolean> {
    try {
      const rows: Array<{ sms_enabled: boolean | null }> = await this.dataSource.query(
        `SELECT notification_sms_enabled AS sms_enabled FROM customer_preferences WHERE customer_id=$1 AND deleted_at IS NULL LIMIT 1`,
        [customerId],
      );
      return rows[0]?.sms_enabled === false;
    } catch {
      return false; // fail-safe: do not block retries on preference lookup errors
    }
  }
}
