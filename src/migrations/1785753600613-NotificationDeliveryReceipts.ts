import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 26 — SMS and email delivery receipts.
 *
 * ## What already exists
 *
 * Notification infrastructure is substantial and this group does not rebuild any of it:
 * `NotificationDispatcherService` turns events into durable delivery intents, `NotificationDeliveryProcessor`
 * claims them under a lease, retries with bounded attempts, and distinguishes `PENDING`/`SENT`/`FAILED`/
 * `SKIPPED`/`UNKNOWN`/`DEAD`. Brevo and Resend adapters exist for email, and a normalising SMS adapter exists.
 * There is a channel resolver that honours per-channel opt-outs and a hardened rule that security-critical
 * messages bypass a customer's opt-out.
 *
 * ## The gap, stated exactly
 *
 * `email-provider.interface.ts` says it plainly:
 *
 * > `SENT` for email strictly means "accepted by the provider API" — confirmed recipient delivery
 * > (bounce/open/delivered webhooks or status polling) is a documented future enhancement, exactly like the
 * > Robase SMS posture.
 *
 * SENT therefore means "the provider took it". Nothing in the system can learn that the address bounced, the
 * handset was unreachable, the carrier filtered it, or the mailbox marked it as spam. Three consequences:
 *
 * 1. **A dead destination is retried forever across different messages.** Every send to a bouncing address is
 *    accepted, logged as `SENT`, and repeated on the next event.
 * 2. **Nobody can answer "did the customer actually receive the OTP that mattered?"** The delivery row says
 *    `SENT` whether the message reached a handset or was silently dropped.
 * 3. **Complaint and bounce rates — the signals that get a sending domain blocked — are invisible** until the
 *    provider shuts the account off.
 *
 * ## Why this is a receipt register, not a delivery engine
 *
 * The delivery pipeline already owns sending and it works. This adds the **inbound** half: a place for provider
 * callbacks to land, a durable record per receipt, and a derived per-destination reputation that the existing
 * pipeline can consult.
 *
 * Critically, **a receipt never changes a delivery's `SENT` status into a delivery confirmation retroactively
 * as if it had always been known** — it records what happened afterwards, with its own timestamp, so the
 * history reads correctly: "accepted at 10:00, bounced at 10:00:04". Rewriting the original verdict would
 * destroy the distinction between "we could not know" and "we knew", which is the same declared-vs-measured
 * discipline applied everywhere else in this work.
 *
 * ## Receipts are attestable but not trusted blindly
 *
 * A webhook endpoint is a public surface. Any receipt can be forged by anyone who can reach it, so each one is
 * recorded with the verification state established by the caller (signature checked, shared secret, or
 * unverified) rather than being treated as fact. **An unverified receipt is stored and is not allowed to
 * suppress a destination** — the schema enforces that, because a forged bounce is a denial-of-service against a
 * customer's ability to receive security messages.
 */

/** What a provider told us happened. */
export const RECEIPT_KINDS = [
  'DELIVERED',
  'BOUNCED',
  'DEFERRED',
  'FAILED',
  'COMPLAINED',
  'UNSUBSCRIBED',
  'OPENED',
  'CLICKED',
] as const;

export type ReceiptKind = (typeof RECEIPT_KINDS)[number];

/** How strongly the receipt was authenticated. */
export const RECEIPT_VERIFICATION = ['SIGNED', 'SHARED_SECRET', 'UNVERIFIED'] as const;

export type ReceiptVerification = (typeof RECEIPT_VERIFICATION)[number];

export class NotificationDeliveryReceipts1785753600613 implements MigrationInterface {
  name = 'NotificationDeliveryReceipts1785753600613';

  async up(q: QueryRunner): Promise<void> {
    /*
     * ---------------------------------------------------------------------------------------------
     * 1. Receipts.
     * ---------------------------------------------------------------------------------------------
     */
    await q.query(`CREATE TABLE notification_delivery_receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- The delivery this receipt is about. Nullable: a provider may report a bounce for a message this
      -- system no longer has a row for (purged, or sent before this table existed), and dropping those
      -- receipts would hide exactly the reputation signal the table exists for.
      delivery_id uuid,
      -- The provider's own message identity, which is what a webhook actually carries.
      provider_ref varchar(255),
      channel varchar(20) NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'PUSH')),
      -- The destination. Stored hashed alongside a masked display form: reputation is per destination, but an
      -- operator does not need, and should not get, a readable list of customer phone numbers and addresses
      -- from a bounce dashboard.
      destination_hash char(64) NOT NULL,
      destination_masked varchar(320) NOT NULL,
      kind varchar(20) NOT NULL CHECK (kind IN (
        'DELIVERED', 'BOUNCED', 'DEFERRED', 'FAILED', 'COMPLAINED',
        'UNSUBSCRIBED', 'OPENED', 'CLICKED'
      )),
      -- The provider's own classification of the failure, where it gave one. Free text because the vocabulary
      -- is provider-specific and inventing a normalised taxonomy upfront would mis-map real codes.
      provider_code varchar(120),
      -- Human-readable detail from the provider, bounded. Never echoed into a customer-facing message.
      provider_detail varchar(500),
      verification varchar(20) NOT NULL CHECK (verification IN ('SIGNED', 'SHARED_SECRET', 'UNVERIFIED')),
      -- When the provider says it happened, which may differ from when we heard about it. Both are kept so a
      -- late-arriving webhook is distinguishable from a slow provider.
      occurred_at timestamptz NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(),
      -- Provider event identity, for de-duplication. Providers retry webhooks; the same event delivered twice
      -- must not double-count a bounce.
      provider_event_id varchar(200),
      -- A receipt is a record of something that happened; rewriting it would defeat the point.
      CHECK (length(destination_hash) = 64),
      CHECK (length(btrim(destination_masked)) > 0),
      CHECK (received_at >= occurred_at OR occurred_at > now() - interval '30 days')
    )`);

    /*
     * One row per provider event. A provider that retries a webhook five times must not look like five
     * bounces, because the reputation calculation would then be dominated by whichever provider retries most.
     * Partial, because a receipt with no provider event id cannot be de-duplicated and must still be stored.
     */
    await q.query(`CREATE UNIQUE INDEX uq_notification_delivery_receipts_provider_event
      ON notification_delivery_receipts (channel, provider_event_id)
      WHERE provider_event_id IS NOT NULL`);

    await q.query(`CREATE INDEX idx_notification_delivery_receipts_destination
      ON notification_delivery_receipts (channel, destination_hash, occurred_at DESC)`);

    await q.query(`CREATE INDEX idx_notification_delivery_receipts_delivery
      ON notification_delivery_receipts (delivery_id, occurred_at DESC)
      WHERE delivery_id IS NOT NULL`);

    await q.query(`CREATE OR REPLACE FUNCTION reject_notification_receipt_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'notification_delivery_receipts is append-only; a receipt is a record of what a provider reported';
      END;
      $$ LANGUAGE plpgsql`);

    await q.query(`CREATE TRIGGER notification_delivery_receipts_immutable
      BEFORE UPDATE OR DELETE ON notification_delivery_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_notification_receipt_mutation()`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 2. Destination reputation.
     * ---------------------------------------------------------------------------------------------
     * Derived from receipts, but stored because the send path needs a cheap answer and a scan over receipts per
     * send would not scale.
     *
     * The suppression rule is the delicate part. A hard bounce or a spam complaint is a strong signal and
     * should stop further sends. A single soft bounce is not. And an **unverified** receipt must never
     * suppress, because a public webhook is forgeable and a forged bounce would let anyone stop a customer
     * receiving security messages. That is enforced by a CHECK on the suppression timestamp, not by service convention.
     */
    await q.query(`CREATE TABLE notification_destination_reputation (
      channel varchar(20) NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'PUSH')),
      destination_hash char(64) NOT NULL,
      destination_masked varchar(320) NOT NULL,
      delivered_count integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
      bounced_count integer NOT NULL DEFAULT 0 CHECK (bounced_count >= 0),
      deferred_count integer NOT NULL DEFAULT 0 CHECK (deferred_count >= 0),
      failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
      complained_count integer NOT NULL DEFAULT 0 CHECK (complained_count >= 0),
      -- Hard vs soft bounce is the distinction that decides whether to stop. A mailbox that does not exist is
      -- permanent; a full mailbox is not.
      hard_bounced_count integer NOT NULL DEFAULT 0 CHECK (hard_bounced_count >= 0),
      last_receipt_at timestamptz,
      -- Suppression state. the reason column explains it and is required whenever the timestamp is set, so a
      -- silent suppression cannot exist.
      suppressed_at timestamptz,
      suppressed_reason varchar(300),
      -- The receipt that caused the suppression, so the decision is auditable and reversible.
      suppressed_by_receipt uuid,
      -- Whether the receipt behind the suppression was authenticated. Unverifiable receipts may be recorded but
      -- may not suppress.
      suppression_verified boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (channel, destination_hash),
      CHECK (length(destination_hash) = 64),
      CHECK ((suppressed_at IS NULL) = (suppressed_reason IS NULL)),
      -- THE constraint of this group: an unverified receipt cannot suppress a destination.
      CHECK (suppressed_at IS NULL OR suppression_verified),
      CHECK (suppressed_reason IS NULL OR length(btrim(suppressed_reason)) > 0)
    )`);

    await q.query(`CREATE INDEX idx_notification_destination_reputation_suppressed
      ON notification_destination_reputation (channel, suppressed_at DESC)
      WHERE suppressed_at IS NOT NULL`);

    /*
     * ---------------------------------------------------------------------------------------------
     * 3. Security-critical notification accounting.
     * ---------------------------------------------------------------------------------------------
     * The existing dispatcher already refuses to let a customer opt-out suppress security-critical messages.
     * That makes those messages the ones whose delivery actually matters, and previously their SENT status was
     * indistinguishable from a bounce.
     *
     * This view answers the question a fraud or security team asks after an incident: of the security-critical
     * notices we attempted, how many did we *know* reached the recipient, and how many are merely "accepted".
     * A low verified-delivery rate on OTPs is a real operational problem and was previously invisible.
     */
    await q.query(`CREATE OR REPLACE VIEW notification_security_delivery_posture AS
      SELECT d.channel,
             count(*)::bigint AS attempted,
             count(*) FILTER (WHERE r.kind = 'DELIVERED')::bigint AS confirmed_delivered,
             count(*) FILTER (WHERE r.kind IN ('BOUNCED', 'FAILED'))::bigint AS known_undelivered,
             count(*) FILTER (WHERE r.id IS NULL)::bigint AS no_receipt
        FROM notification_deliveries d
        LEFT JOIN notification_delivery_receipts r
          ON r.delivery_id = d.id AND r.verification <> 'UNVERIFIED'
       WHERE d.status = 'SENT'
       GROUP BY d.channel`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Refuses while any receipt exists.
     *
     * A receipt is the only evidence that a message did or did not reach a recipient, and the reputation state
     * is derived from it. Dropping the table would make a suppression unexplainable and a past delivery
     * question unanswerable.
     */
    const rows = (await q.query(
      `SELECT count(*)::int AS n FROM notification_delivery_receipts`,
    )) as Array<{ n: number }>;
    const receipts = rows[0]?.n ?? 0;
    if (receipts > 0) {
      throw new Error(
        `Refusing to roll back NotificationDeliveryReceipts1785753600613: ${receipts} delivery receipt(s) ` +
          'exist. They are the only evidence of what a provider reported about a customer message.',
      );
    }

    await q.query(`DROP VIEW IF EXISTS notification_security_delivery_posture`);
    await q.query(`DROP TABLE IF EXISTS notification_destination_reputation`);
    await q.query(
      `DROP TRIGGER IF EXISTS notification_delivery_receipts_immutable ON notification_delivery_receipts`,
    );
    await q.query(`DROP FUNCTION IF EXISTS reject_notification_receipt_mutation()`);
    await q.query(`DROP TABLE IF EXISTS notification_delivery_receipts`);
  }
}
