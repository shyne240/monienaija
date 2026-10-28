import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

import type { NotificationChannelResolverService } from './notification-channel-resolver.service';
import type { NotificationTemplateService } from './notification-template.service';
import { canonicalNotificationEvent } from './notification-template.service';
import { isSecurityCriticalNotificationEvent } from './notification-security.constants';
import type { NotificationProvider, NotificationSendResult } from './notification.types';

interface DeliveryRow {
  id: string;
  event_type: string;
  event_key: string;
  recipient_type: 'CUSTOMER' | 'AGENT' | 'PHONE';
  recipient_id: string;
  channel: 'SMS' | 'PUSH' | 'EMAIL';
  destination: string;
  message: string | null;
  payload: Record<string, unknown>;
  rendered_subject: string | null;
  rendered_html: string | null;
  correlation_id: string | null;
  attempts: number;
  lease_token: string;
}

type Outcome = 'SENT' | 'FAILED' | 'UNKNOWN' | 'DEAD' | 'SKIPPED' | 'LOST';
export interface DeliveryBatchResult {
  claimed: number;
  sent: number;
  failed: number;
  optedOut: number;
  suppressed: number;
}

export interface DeliveryProcessorOptions {
  dataSource: DataSource;
  resolver: NotificationChannelResolverService;
  templates: NotificationTemplateService;
  smsProvider: NotificationProvider | null;
  emailProvider: NotificationProvider | null;
  maxAttempts: number;
  baseDelaySeconds: number;
  leaseSeconds?: number;
}

/**
 * A claim has a unique owner token and a durable attempt BEFORE any external call. An expired
 * CLAIMED attempt is safe to recover; an expired STARTED attempt is UNKNOWN and never retried
 * automatically. Provider idempotency windows are intentionally not assumed to be universal.
 */
export class NotificationDeliveryProcessor {
  private readonly maxAttempts: number;
  private readonly baseDelaySeconds: number;
  private readonly leaseSeconds: number;

  constructor(private readonly options: DeliveryProcessorOptions) {
    this.maxAttempts = Math.max(1, Math.min(20, Math.floor(Number(options.maxAttempts) || 3)));
    this.baseDelaySeconds = Math.max(1, Math.min(86400, Math.floor(Number(options.baseDelaySeconds) || 60)));
    this.leaseSeconds = Math.max(1, Math.min(3600, Math.floor(Number(options.leaseSeconds) || 120)));
  }

  async processBatch(limit: number): Promise<DeliveryBatchResult> {
    await this.recoverExpiredLeases(Math.max(1, Math.min(500, limit * 2)));
    const summary: DeliveryBatchResult = { claimed: 0, sent: 0, failed: 0, optedOut: 0, suppressed: 0 };
    for (let i = 0; i < Math.max(0, Math.min(500, limit)); i += 1) {
      const row = await this.claim();
      if (!row) break;
      summary.claimed += 1;
      const outcome = await this.execute(row);
      if (outcome === 'SENT') summary.sent += 1;
      else if (outcome === 'SKIPPED') {
        const rows = await this.options.dataSource.query<Array<{ last_error: string | null }>>(
          `SELECT last_error FROM notification_deliveries WHERE id=$1`, [row.id],
        );
        if (rows[0]?.last_error?.endsWith('_OPT_OUT')) summary.optedOut += 1;
        else summary.suppressed += 1;
      } else if (outcome !== 'LOST') summary.failed += 1;
    }
    return summary;
  }

  /** Immediate compatibility path: claim only the newly inserted row, after its transaction commits. */
  async processOne(id: string): Promise<Outcome | null> {
    const row = await this.claim(id);
    return row ? this.execute(row) : null;
  }

  /** Public for deterministic operational recovery/testing; no provider is invoked here. */
  async recoverExpiredLeases(limit = 100): Promise<number> {
    return this.options.dataSource.transaction(async (manager) => {
      const expired = await manager.query<Array<{ id: string; attempts: number; lease_token: string }>>(
        `SELECT id, attempts, lease_token FROM notification_deliveries
          WHERE lease_token IS NOT NULL AND lease_expires_at <= NOW()
          ORDER BY lease_expires_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [Math.max(1, Math.min(500, limit))],
      );
      for (const row of expired) {
        const attempts = await manager.query<Array<{ status: string }>>(
          `SELECT status FROM notification_delivery_attempts WHERE delivery_id=$1 AND lease_token=$2`,
          [row.id, row.lease_token],
        );
        // Missing attempt evidence is also ambiguous, not safe to resend.
        const ambiguous = attempts[0]?.status !== 'CLAIMED';
        const status = ambiguous ? 'UNKNOWN' : row.attempts >= this.maxAttempts ? 'DEAD' : 'FAILED';
        const reason = ambiguous ? 'LEASE_EXPIRED_AFTER_START' : 'LEASE_EXPIRED_BEFORE_SEND';
        await manager.query(
          `UPDATE notification_delivery_attempts SET status=$1, reason=$2, finished_at=NOW()
            WHERE delivery_id=$3 AND lease_token=$4 AND status IN ('CLAIMED','STARTED')`,
          [ambiguous ? 'UNKNOWN' : 'FAILED', reason, row.id, row.lease_token],
        );
        await manager.query(
          `UPDATE notification_deliveries SET status=$1::varchar, last_error=$2, lease_token=NULL,
             lease_expires_at=NULL, next_attempt_at=CASE WHEN $1::varchar='FAILED'
               THEN NOW() + ($3::integer * INTERVAL '1 second') ELSE NULL END,
             failed_at=NOW(), updated_at=NOW() WHERE id=$4 AND lease_token=$5`,
          [status, reason, this.backoff(row.attempts), row.id, row.lease_token],
        );
      }
      return expired.length;
    });
  }

  private backoff(attempt: number): number {
    return Math.min(86400, this.baseDelaySeconds * 2 ** Math.max(0, Math.min(16, attempt - 1)));
  }

  private async claim(id?: string): Promise<DeliveryRow | null> {
    return this.options.dataSource.transaction(async (manager) => {
      // Also terminalize records that became exhausted through an earlier process/config change.
      await manager.query(
        `UPDATE notification_deliveries SET status='DEAD', last_error='ATTEMPTS_EXHAUSTED', updated_at=NOW()
          WHERE status IN ('PENDING','FAILED') AND lease_token IS NULL AND attempts >= $1`,
        [this.maxAttempts],
      );
      const rows = await manager.query<DeliveryRow[]>(
        `SELECT * FROM notification_deliveries
          WHERE status IN ('PENDING','FAILED') AND lease_token IS NULL AND attempts < $1
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            AND ($2::uuid IS NULL OR id=$2)
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [this.maxAttempts, id ?? null],
      );
      const row = rows[0];
      if (!row) return null;
      const token = randomUUID();
      const number = row.attempts + 1;
      await manager.query(
        `UPDATE notification_deliveries SET attempts=$1, lease_token=$2,
           lease_expires_at=NOW()+($3::integer * INTERVAL '1 second'), updated_at=NOW() WHERE id=$4`,
        [number, token, this.leaseSeconds, row.id],
      );
      await manager.query(
        `INSERT INTO notification_delivery_attempts (delivery_id, attempt_number, lease_token, status)
         VALUES ($1,$2,$3,'CLAIMED')`, [row.id, number, token],
      );
      return { ...row, attempts: number, lease_token: token };
    });
  }

  private async markStarted(row: DeliveryRow): Promise<boolean> {
    return this.options.dataSource.transaction(async (manager) => {
      const locked = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM notification_deliveries WHERE id=$1 AND lease_token=$2
          AND lease_expires_at > NOW() AND status IN ('PENDING','FAILED') FOR UPDATE`,
        [row.id, row.lease_token],
      );
      if (!locked[0]) return false;
      const attempt = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM notification_delivery_attempts WHERE delivery_id=$1 AND lease_token=$2
          AND status='CLAIMED' FOR UPDATE`, [row.id, row.lease_token],
      );
      if (!attempt[0]) return false;
      await manager.query(
        `UPDATE notification_delivery_attempts SET status='STARTED', started_at=NOW()
          WHERE delivery_id=$1 AND lease_token=$2 AND status='CLAIMED'`,
        [row.id, row.lease_token],
      );
      return true;
    });
  }

  private async finish(
    row: DeliveryRow,
    outcome: Exclude<Outcome, 'LOST'>,
    reason: string | null,
    providerRef: string | null = null,
  ): Promise<boolean> {
    return this.options.dataSource.transaction(async (manager: EntityManager) => {
      const locked = await manager.query<Array<{ id: string }>>(
        `SELECT id FROM notification_deliveries WHERE id=$1 AND lease_token=$2 FOR UPDATE`,
        [row.id, row.lease_token],
      );
      if (!locked[0]) return false; // a later owner/recovery has fenced this worker
      const attemptStatus = outcome === 'SENT' ? 'ACCEPTED' : outcome === 'UNKNOWN' ? 'UNKNOWN' :
        outcome === 'SKIPPED' ? 'SUPPRESSED' : 'FAILED';
      await manager.query(
        `UPDATE notification_delivery_attempts SET status=$1, reason=$2, finished_at=NOW()
          WHERE delivery_id=$3 AND lease_token=$4`,
        [attemptStatus, reason, row.id, row.lease_token],
      );
      await manager.query(
        `UPDATE notification_deliveries SET status=$1::varchar, last_error=$2, provider_ref=$3,
           sent_at=CASE WHEN $1::varchar='SENT' THEN NOW() ELSE sent_at END,
           failed_at=CASE WHEN $1::varchar IN ('FAILED','DEAD','UNKNOWN') THEN NOW() ELSE failed_at END,
           next_attempt_at=CASE WHEN $1::varchar='FAILED' THEN NOW()+($4::integer * INTERVAL '1 second') ELSE NULL END,
           lease_token=NULL, lease_expires_at=NULL, updated_at=NOW() WHERE id=$5 AND lease_token=$6`,
        [outcome, reason, providerRef, this.backoff(row.attempts), row.id, row.lease_token],
      );
      return true;
    });
  }

  private failureOutcome(result: NotificationSendResult, attempt: number): 'FAILED' | 'DEAD' | 'UNKNOWN' {
    if (result.failureDisposition === 'UNKNOWN') return 'UNKNOWN';
    if (result.failureDisposition === 'PERMANENT') return 'DEAD';
    if (result.failureDisposition === 'RETRYABLE') return attempt >= this.maxAttempts ? 'DEAD' : 'FAILED';
    // Only an explicit non-ambiguous HTTP client rejection can be retried without assuming
    // provider idempotency. 408 and 409 may represent an accepted/in-flight request.
    const http = /^(?:ROBASE|BREVO|RESEND)_HTTP_(4\d\d)(?::|$)/.exec(result.error ?? '');
    const code = Number(http?.[1]);
    if (code >= 400 && code <= 499 && code !== 408 && code !== 409) {
      return attempt >= this.maxAttempts ? 'DEAD' : 'FAILED';
    }
    return 'UNKNOWN';
  }

  private async execute(row: DeliveryRow): Promise<Outcome> {
    let started = false;
    try {
      let suppression: string | null = null;
      if (isSecurityCriticalNotificationEvent(row.event_type)) suppression = 'SECURITY_DIRECT_ONLY';
      else if ((row.channel === 'SMS' || row.channel === 'EMAIL') &&
        !(await this.options.templates.isEventEnabled(this.options.dataSource, row.event_type, row.channel))) {
        suppression = 'EVENT_DISABLED';
      }
      try {
        this.options.templates.assertSafe(row.message ?? '');
        if (row.rendered_subject) this.options.templates.assertSafe(row.rendered_subject);
        if (canonicalNotificationEvent(row.event_type) === 'cash_to_cash.created' &&
          /\b\d{6}\b/.test(row.message ?? '') && /\b[789]\d{9}\b/.test(row.message ?? '')) {
          suppression = 'UNSAFE_MESSAGE';
        }
      } catch { suppression = 'UNSAFE_MESSAGE'; }

      if (!suppression) {
        const destination = await this.options.resolver.resolve(
          row.recipient_type, row.recipient_id, row.channel, this.options.dataSource, row.event_type,
        );
        if (!destination.destination) suppression = destination.reason ?? 'DESTINATION_UNAVAILABLE';
        else if (destination.destination !== row.destination) suppression = 'DESTINATION_CHANGED';
      }
      if (suppression) return (await this.finish(row, 'SKIPPED', suppression)) ? 'SKIPPED' : 'LOST';

      const provider = row.channel === 'EMAIL' ? this.options.emailProvider : this.options.smsProvider;
      if (!provider || (row.channel === 'EMAIL' && (!row.rendered_subject || !row.rendered_html))) {
        const status = row.attempts >= this.maxAttempts ? 'DEAD' : 'FAILED';
        return (await this.finish(row, status, 'PROVIDER_OR_CONTENT_UNAVAILABLE')) ? status : 'LOST';
      }
      if (!(await this.markStarted(row))) return 'LOST';
      started = true;
      let result: NotificationSendResult;
      try {
        result = await provider.send({
          channel: row.channel,
          destination: row.destination,
          message: row.message ?? '',
          payload: row.payload ?? {},
          correlationId: row.correlation_id,
          eventType: row.event_type,
          eventKey: row.event_key,
          recipientType: row.recipient_type,
          recipientId: row.recipient_id,
          ...(row.channel === 'EMAIL' ? { subject: row.rendered_subject!, html: row.rendered_html! } : {}),
        });
      } catch {
        result = { success: false, failureDisposition: 'UNKNOWN' };
      }
      const outcome = result.success ? 'SENT' : this.failureOutcome(result, row.attempts);
      const reason = outcome === 'SENT' ? null : outcome === 'UNKNOWN' ? 'PROVIDER_OUTCOME_UNKNOWN' :
        outcome === 'DEAD' ? 'PROVIDER_REJECTED_OR_EXHAUSTED' : 'PROVIDER_REJECTED_RETRYABLE';
      const saved = await this.finish(row, outcome, reason, result.success ? result.providerRef ?? null : null);
      return saved ? outcome : 'LOST';
    } catch {
      // Once STARTED is durable a failed status write may hide provider acceptance. Leave the
      // lease untouched so expiry recovery records UNKNOWN, never a blind resend.
      if (started) return 'UNKNOWN';
      try {
        const outcome = row.attempts >= this.maxAttempts ? 'DEAD' : 'FAILED';
        return (await this.finish(row, outcome, 'PRE_SEND_FAILED')) ? outcome : 'LOST';
      } catch {
        // A database outage leaves the durable CLAIMED lease for safe expiry recovery.
        return 'FAILED';
      }
    }
  }
}
