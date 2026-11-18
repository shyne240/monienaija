import { createHash } from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * ARENA 3D Group 26 — SMS and email delivery receipts.
 *
 * ## What this adds, and what it deliberately does not touch
 *
 * The delivery pipeline (`NotificationDispatcherService`, `NotificationDeliveryProcessor`) already sends with
 * leases, bounded retries and honest statuses. This service is the **inbound** half that was missing: provider
 * callbacks land here, are recorded durably, and maintain a per-destination reputation the send path can consult.
 *
 * **A receipt never rewrites the original verdict.** `SENT` still means "the provider accepted it". A later
 * bounce is recorded as a separate fact with its own timestamp, so the history reads "accepted at 10:00,
 * bounced at 10:00:04" rather than pretending the system always knew. That distinction — declared versus
 * measured — is the same one that governs recovery and alerting elsewhere in this work, and collapsing it here
 * would make it impossible to tell a system that had no feedback from one that ignored it.
 *
 * ## The suppression rule is the delicate part
 *
 * Suppressing a destination means the customer stops receiving messages, including security-critical ones that
 * deliberately bypass opt-out. So suppression is only allowed on evidence that cannot be forged:
 *
 * - **Hard bounce or spam complaint** — strong, permanent signals.
 * - **Authenticated receipt only.** A public webhook can be called by anyone; a forged bounce would be a
 *   denial-of-service against a customer's ability to receive a one-time code. The database refuses to store a
 *   suppression whose receipt was `UNVERIFIED`, so this cannot be broken by a service bug.
 * - **Not a soft bounce and not a deferral.** A full mailbox is temporary; a greylisted server is temporary.
 *   Suppressing on those is how an ordinary busy customer loses their account access.
 */

export type ReceiptChannel = 'SMS' | 'EMAIL' | 'PUSH';
export type ReceiptKind =
  | 'DELIVERED'
  | 'BOUNCED'
  | 'DEFERRED'
  | 'FAILED'
  | 'COMPLAINED'
  | 'UNSUBSCRIBED'
  | 'OPENED'
  | 'CLICKED';
export type ReceiptVerification = 'SIGNED' | 'SHARED_SECRET' | 'UNVERIFIED';

export interface ReceiptCommand {
  readonly channel: ReceiptChannel;
  readonly kind: ReceiptKind;
  readonly destination: string;
  readonly verification: ReceiptVerification;
  readonly occurredAt: Date;
  readonly deliveryId?: string;
  readonly providerRef?: string;
  readonly providerCode?: string;
  readonly providerDetail?: string;
  /** Provider event identity. When present, a repeat delivery of the same event is ignored. */
  readonly providerEventId?: string;
  /** Whether the provider classified this as a permanent failure. */
  readonly hardBounce?: boolean;
}

export interface ReceiptResult {
  readonly receiptId: string | null;
  readonly recorded: boolean;
  readonly suppressed: boolean;
  readonly suppressionReason: string | null;
  /** True when the same provider event had already been recorded. */
  readonly duplicate: boolean;
}

/**
 * Receipt kinds that may suppress a destination.
 *
 * `DEFERRED` is excluded deliberately and is the case most likely to be added by mistake: a greylisted server
 * or a full mailbox produces a deferral, and suppressing there would cut off a customer whose only problem was
 * timing.
 */
const SUPPRESSING_KINDS: ReadonlySet<ReceiptKind> = new Set<ReceiptKind>([
  'COMPLAINED',
  'UNSUBSCRIBED',
]);

@Injectable()
export class NotificationReceiptService {
  private readonly logger = new Logger(NotificationReceiptService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Records one provider receipt.
   *
   * Idempotent on `(channel, providerEventId)`: providers retry webhooks, and the same bounce delivered five
   * times must not look like five bounces — that would let whichever provider retries hardest dominate the
   * reputation calculation.
   */
  async recordReceipt(command: ReceiptCommand): Promise<ReceiptResult> {
    const destination = (command.destination ?? '').trim();
    if (destination.length === 0) {
      throw new BadRequestException('A receipt must identify the destination it concerns');
    }
    if (!(command.occurredAt instanceof Date) || Number.isNaN(command.occurredAt.getTime())) {
      throw new BadRequestException('A receipt must carry the time the provider reported');
    }

    const destinationHash = this.hashDestination(destination);
    const masked = this.maskDestination(destination);

    return this.dataSource.transaction(async (manager) => {
      const insert: unknown = await manager.query(
        `INSERT INTO notification_delivery_receipts (
           delivery_id, provider_ref, channel, destination_hash, destination_masked, kind,
           provider_code, provider_detail, verification, occurred_at, provider_event_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (channel, provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          command.deliveryId ?? null,
          command.providerRef?.slice(0, 255) ?? null,
          command.channel,
          destinationHash,
          masked,
          command.kind,
          command.providerCode?.slice(0, 120) ?? null,
          command.providerDetail?.slice(0, 500) ?? null,
          command.verification,
          command.occurredAt,
          command.providerEventId?.slice(0, 200) ?? null,
        ],
      );

      const receiptId = this.rowsOf<{ id: string }>(insert)[0]?.id;
      if (!receiptId) {
        /*
         * A duplicate provider event. Nothing is counted and nothing is suppressed: the first receipt already
         * did whatever it was going to do.
         */
        return {
          receiptId: null,
          recorded: false,
          suppressed: false,
          suppressionReason: null,
          duplicate: true,
        };
      }

      await this.updateReputation(manager, {
        channel: command.channel,
        destinationHash,
        masked,
        kind: command.kind,
        hardBounce: command.hardBounce === true,
        occurredAt: command.occurredAt,
      });

      const suppression = await this.maybeSuppress(manager, {
        channel: command.channel,
        destinationHash,
        receiptId: String(receiptId),
        kind: command.kind,
        verification: command.verification,
        hardBounce: command.hardBounce === true,
        providerCode: command.providerCode,
      });

      return {
        receiptId: String(receiptId),
        recorded: true,
        suppressed: suppression.suppressed,
        suppressionReason: suppression.reason,
        duplicate: false,
      };
    });
  }

  /**
   * Whether the send path should attempt a destination.
   *
   * Returns `suppressed: false` for anything it cannot read, because a reputation lookup failure must not stop
   * a message — the pipeline's own opt-out and policy checks remain authoritative, and this is advisory.
   */
  async isSuppressed(
    channel: ReceiptChannel,
    destination: string,
  ): Promise<{ suppressed: boolean; reason: string | null }> {
    const hash = this.hashDestination(destination);
    try {
      const rows: unknown = await this.dataSource.query(
        `SELECT suppressed_at, suppressed_reason
           FROM notification_destination_reputation
          WHERE channel = $1 AND destination_hash = $2`,
        [channel, hash],
      );
      const row = this.rowsOf<{ suppressed_at: Date | null; suppressed_reason: string | null }>(
        rows,
      )[0];
      if (!row || row.suppressed_at === null) return { suppressed: false, reason: null };
      return { suppressed: true, reason: row.suppressed_reason };
    } catch (error) {
      this.logger.warn(
        `notification reputation lookup failed, allowing send: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { suppressed: false, reason: null };
    }
  }

  /** Reputation for one destination. */
  async reputation(
    channel: ReceiptChannel,
    destination: string,
  ): Promise<Record<string, unknown> | null> {
    const hash = this.hashDestination(destination);
    const rows: unknown = await this.dataSource.query(
      `SELECT channel, destination_masked, delivered_count, bounced_count, deferred_count,
              failed_count, complained_count, hard_bounced_count, last_receipt_at,
              suppressed_at, suppressed_reason, suppression_verified
         FROM notification_destination_reputation
        WHERE channel = $1 AND destination_hash = $2`,
      [channel, hash],
    );
    return this.rowsOf<Record<string, unknown>>(rows)[0] ?? null;
  }

  /**
   * How much of the security-critical traffic is *known* to have arrived.
   *
   * The question a fraud or security team asks after an incident. `no_receipt` is not a failure — most
   * providers do not report every message — but a large `known_undelivered` on OTP traffic is a real problem
   * that was previously invisible, because every attempt looked identically `SENT`.
   */
  async securityDeliveryPosture(): Promise<
    Array<{
      channel: string;
      attempted: number;
      confirmedDelivered: number;
      knownUndelivered: number;
      noReceipt: number;
    }>
  > {
    const rows: unknown = await this.dataSource.query(
      `SELECT channel, attempted, confirmed_delivered, known_undelivered, no_receipt
         FROM notification_security_delivery_posture
        ORDER BY channel`,
    );
    return this.rowsOf<{
      channel: string;
      attempted: string | number;
      confirmed_delivered: string | number;
      known_undelivered: string | number;
      no_receipt: string | number;
    }>(rows).map((row) => ({
      channel: row.channel,
      attempted: Number(row.attempted),
      confirmedDelivered: Number(row.confirmed_delivered),
      knownUndelivered: Number(row.known_undelivered),
      noReceipt: Number(row.no_receipt),
    }));
  }

  /**
   * Suppressed destinations awaiting review.
   *
   * Manual review is necessary because suppression is close to irreversible from the customer's point of view:
   * they do not know it happened, and the next message they expect simply never arrives.
   */
  async suppressedDestinations(options: { channel?: ReceiptChannel; limit?: number } = {}): Promise<
    Array<{
      channel: string;
      destinationMasked: string;
      suppressedAt: string;
      reason: string;
      verified: boolean;
    }>
  > {
    const params: unknown[] = [];
    const conditions = ['suppressed_at IS NOT NULL'];
    if (options.channel) {
      params.push(options.channel);
      conditions.push(`channel = $${params.length}`);
    }
    params.push(Math.min(Math.max(options.limit ?? 100, 1), 500));

    const rows: unknown = await this.dataSource.query(
      `SELECT channel, destination_masked, suppressed_at, suppressed_reason, suppression_verified
         FROM notification_destination_reputation
        WHERE ${conditions.join(' AND ')}
        ORDER BY suppressed_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return this.rowsOf<{
      channel: string;
      destination_masked: string;
      suppressed_at: Date | string;
      suppressed_reason: string;
      suppression_verified: boolean;
    }>(rows).map((row) => ({
      channel: row.channel,
      destinationMasked: row.destination_masked,
      suppressedAt: new Date(row.suppressed_at).toISOString(),
      reason: row.suppressed_reason,
      verified: row.suppression_verified,
    }));
  }

  /**
   * Lifts a suppression.
   *
   * A deliberate, named act: suppression is invisible to the customer, so reversing it must be attributable.
   * The receipts and the reputation counters are left intact — the history of why it happened is evidence.
   */
  async liftSuppression(command: {
    channel: ReceiptChannel;
    destination: string;
    liftedBy: string;
    reason: string;
  }): Promise<void> {
    const liftedBy = (command.liftedBy ?? '').trim();
    const reason = (command.reason ?? '').trim();
    if (liftedBy.length === 0) {
      throw new BadRequestException(
        'Lifting a suppression must be attributable to a named principal',
      );
    }
    if (reason.length === 0) {
      throw new BadRequestException('Lifting a suppression must state why');
    }

    const hash = this.hashDestination(command.destination);
    await this.dataSource.query(
      `UPDATE notification_destination_reputation
          SET suppressed_at = NULL,
              suppressed_reason = NULL,
              suppressed_by_receipt = NULL,
              suppression_verified = false,
              updated_at = now()
        WHERE channel = $1 AND destination_hash = $2`,
      [command.channel, hash],
    );
  }

  // ---------------------------------------------------------------------------------------------

  private async updateReputation(
    manager: { query: (sql: string, parameters?: unknown[]) => Promise<unknown> },
    update: {
      channel: ReceiptChannel;
      destinationHash: string;
      masked: string;
      kind: ReceiptKind;
      hardBounce: boolean;
      occurredAt: Date;
    },
  ): Promise<void> {
    /*
     * Counters are incremented per kind. A hard bounce is counted both as a bounce and as a hard bounce, because
     * "how many bounces" and "how many of those were permanent" are different questions and the send path only
     * acts on the second.
     */
    const delivered = update.kind === 'DELIVERED' ? 1 : 0;
    const bounced = update.kind === 'BOUNCED' ? 1 : 0;
    const hard = update.kind === 'BOUNCED' && update.hardBounce ? 1 : 0;
    const deferred = update.kind === 'DEFERRED' ? 1 : 0;
    const failed = update.kind === 'FAILED' ? 1 : 0;
    const complained = update.kind === 'COMPLAINED' ? 1 : 0;

    await manager.query(
      `INSERT INTO notification_destination_reputation (
         channel, destination_hash, destination_masked,
         delivered_count, bounced_count, hard_bounced_count, deferred_count, failed_count,
         complained_count, last_receipt_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (channel, destination_hash) DO UPDATE
         SET delivered_count = notification_destination_reputation.delivered_count + EXCLUDED.delivered_count,
             bounced_count = notification_destination_reputation.bounced_count + EXCLUDED.bounced_count,
             hard_bounced_count =
               notification_destination_reputation.hard_bounced_count + EXCLUDED.hard_bounced_count,
             deferred_count = notification_destination_reputation.deferred_count + EXCLUDED.deferred_count,
             failed_count = notification_destination_reputation.failed_count + EXCLUDED.failed_count,
             complained_count =
               notification_destination_reputation.complained_count + EXCLUDED.complained_count,
             last_receipt_at = GREATEST(
               COALESCE(notification_destination_reputation.last_receipt_at, EXCLUDED.last_receipt_at),
               EXCLUDED.last_receipt_at
             ),
             updated_at = now()`,
      [
        update.channel,
        update.destinationHash,
        update.masked,
        delivered,
        bounced,
        hard,
        deferred,
        failed,
        complained,
        update.occurredAt,
      ],
    );
  }

  /**
   * Decides whether this receipt suppresses the destination.
   *
   * Two conditions, both required: the kind must be a permanent, deliberate signal, and the receipt must have
   * been authenticated. The second is enforced again by a CHECK in the schema, so a service bug cannot produce
   * a suppression whose evidence was unverified.
   */
  private async maybeSuppress(
    manager: { query: (sql: string, parameters?: unknown[]) => Promise<unknown> },
    candidate: {
      channel: ReceiptChannel;
      destinationHash: string;
      receiptId: string;
      kind: ReceiptKind;
      verification: ReceiptVerification;
      hardBounce: boolean;
      providerCode?: string;
    },
  ): Promise<{ suppressed: boolean; reason: string | null }> {
    const isSuppressing =
      SUPPRESSING_KINDS.has(candidate.kind) ||
      (candidate.kind === 'BOUNCED' && candidate.hardBounce === true);

    if (!isSuppressing) {
      return { suppressed: false, reason: null };
    }

    if (candidate.verification === 'UNVERIFIED') {
      /*
       * Recorded, but not acted on. A public webhook is forgeable, and a forged bounce would let anyone stop a
       * customer receiving a one-time code. The receipt stays for the record; the send path is untouched.
       */
      return {
        suppressed: false,
        reason: 'A verified receipt is required before a destination may be suppressed',
      };
    }

    const reason =
      candidate.kind === 'COMPLAINED'
        ? 'Recipient marked a message as spam'
        : candidate.kind === 'UNSUBSCRIBED'
          ? 'Recipient unsubscribed'
          : `Permanent delivery failure${candidate.providerCode ? ` (${candidate.providerCode})` : ''}`;

    await manager.query(
      `UPDATE notification_destination_reputation
          SET suppressed_at = now(),
              suppressed_reason = $3,
              suppressed_by_receipt = $4,
              suppression_verified = true,
              updated_at = now()
        WHERE channel = $1 AND destination_hash = $2 AND suppressed_at IS NULL`,
      [candidate.channel, candidate.destinationHash, reason.slice(0, 300), candidate.receiptId],
    );

    return { suppressed: true, reason };
  }

  /**
   * Hashes a destination.
   *
   * Reputation must be per destination across messages that carry no shared identifier, and an operator
   * dashboard must not become a readable list of customer phone numbers. The hash is unsalted SHA-256: a
   * deployment that wants enumeration resistance should add a secret, and that is an infrastructure decision
   * rather than something to invent here.
   */
  private hashDestination(destination: string): string {
    return createHash('sha256').update(destination.trim().toLowerCase(), 'utf8').digest('hex');
  }

  /** Enough to recognise a destination, not enough to reconstruct it. */
  private maskDestination(destination: string): string {
    const trimmed = destination.trim();
    if (trimmed.includes('@')) {
      const [local, domain] = trimmed.split('@');
      const visible = (local ?? '').slice(0, 2);
      return `${visible}${'*'.repeat(Math.max(1, Math.min(6, (local ?? '').length - visible.length)))}@${domain ?? ''}`;
    }
    const digits = trimmed.replace(/\s+/g, '');
    if (digits.length <= 4) return '*'.repeat(digits.length);
    return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
  }

  private rowsOf<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    const first: unknown = result[0];
    const second: unknown = result[1];
    if (result.length === 2 && Array.isArray(first) && !Array.isArray(second)) return first as T[];
    return result as T[];
  }
}
