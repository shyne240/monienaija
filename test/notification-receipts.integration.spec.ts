import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';

import { NotificationReceiptService } from '../src/notification/notification-receipt.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
  truncateAllTables,
} from './support/pg-harness';

/**
 * ARENA 3D Group 26 — SMS and email delivery receipts.
 *
 * The properties under test:
 *
 * 1. **A receipt never rewrites the original verdict.** `SENT` keeps meaning "the provider accepted it"; the
 *    bounce is a separate fact with its own time. If this were collapsed, a system that had no feedback would be
 *    indistinguishable from one that ignored it.
 * 2. **An unverified receipt cannot suppress.** A public webhook is forgeable, and a forged bounce would let
 *    anyone stop a customer receiving a one-time code. Enforced in the schema, so a service bug cannot break it.
 * 3. **A soft bounce or deferral never suppresses.** A full mailbox is temporary.
 * 4. **Provider retries do not multiply.** The same event delivered five times is one bounce.
 */
describe('Group 26 — notification delivery receipts', () => {
  let db: DataSource;
  let service: NotificationReceiptService;

  const phone = `+234803${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, '0')}`;
  const email = `g26.${randomUUID().slice(0, 8)}@example.com`;

  beforeAll(async () => {
    db = await createIntegrationDataSource('g26rcpt');
    service = new NotificationReceiptService(db);
  }, 180_000);

  afterAll(async () => {
    await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await truncateAllTables(db);
  });

  function receipt(overrides: Partial<Parameters<typeof service.recordReceipt>[0]> = {}) {
    return {
      channel: 'EMAIL' as const,
      kind: 'DELIVERED' as const,
      destination: email,
      verification: 'SIGNED' as const,
      occurredAt: new Date(),
      ...overrides,
    } as Parameters<typeof service.recordReceipt>[0];
  }

  describe('receipts are recorded as separate facts', () => {
    it('records a delivery receipt', async () => {
      const result = await service.recordReceipt(receipt());

      expect(result.recorded).toBe(true);
      expect(result.duplicate).toBe(false);
      const reputation = await service.reputation('EMAIL', email);
      expect(Number(reputation?.delivered_count)).toBe(1);
    });

    it('does not alter the originating delivery verdict', async () => {
      /*
       * The core discipline. A delivery marked SENT stays SENT; the bounce is recorded beside it with its own
       * timestamp. Rewriting SENT into a failure would erase the fact that the system had no way to know at the
       * time, which is exactly the distinction that matters when explaining a missed OTP.
       */
      const rows: Array<{ id: string }> = await db.query(
        `INSERT INTO notification_deliveries (
           event_type, event_key, recipient_type, recipient_id, channel, destination, payload, status, sent_at
         ) VALUES ('OTP_REQUESTED', $1, 'CUSTOMER', $2, 'EMAIL', $3, '{}'::jsonb, 'SENT', now())
         RETURNING id`,
        [`g26-${randomUUID()}`, `cust-${randomUUID().slice(0, 8)}`, email],
      );
      const deliveryId = firstRow(rows, 'seeded delivery').id;

      await service.recordReceipt(receipt({ kind: 'BOUNCED', hardBounce: true, deliveryId }));

      const after: Array<{ status: string; sent_at: Date | null }> = await db.query(
        `SELECT status, sent_at FROM notification_deliveries WHERE id = $1`,
        [deliveryId],
      );
      expect(firstRow(after, 'delivery').status).toBe('SENT');
      expect(firstRow(after, 'delivery').sent_at).not.toBeNull();
    });

    it('refuses a receipt with no destination', async () => {
      await expect(service.recordReceipt(receipt({ destination: '  ' }))).rejects.toThrow(
        /identify the destination/i,
      );
    });

    it('refuses a malformed occurrence time', async () => {
      await expect(
        service.recordReceipt(receipt({ occurredAt: new Date('nonsense') })),
      ).rejects.toThrow(/time the provider reported/i);
    });

    it('stores a hash and a masked form, never the raw destination', async () => {
      // A bounce dashboard must not become a readable list of customer phone numbers and addresses.
      await service.recordReceipt(receipt());

      const rows: Array<{ destination_hash: string; destination_masked: string }> = await db.query(
        `SELECT destination_hash, destination_masked FROM notification_delivery_receipts`,
      );
      const stored = firstRow(rows, 'receipt');
      expect(stored.destination_hash).toHaveLength(64);
      expect(stored.destination_hash).not.toContain('@');
      expect(stored.destination_masked).toContain('***');
      expect(stored.destination_masked).not.toBe(email);
    });

    it('masks a phone number down to the last four digits', async () => {
      await service.recordReceipt(receipt({ channel: 'SMS', destination: phone }));
      const rows: Array<{ destination_masked: string }> = await db.query(
        `SELECT destination_masked FROM notification_delivery_receipts WHERE channel = 'SMS'`,
      );
      const masked = firstRow(rows, 'sms receipt').destination_masked;
      expect(masked.endsWith(phone.slice(-4))).toBe(true);
      expect(masked).not.toBe(phone);
    });
  });

  describe('provider retries do not multiply receipts', () => {
    it('ignores the same provider event delivered twice', async () => {
      /*
       * Providers retry webhooks. Counting each retry would let whichever provider retries hardest dominate the
       * reputation calculation, and would make a single bounce look like an outage.
       */
      const eventId = `evt-${randomUUID()}`;
      const first = await service.recordReceipt(
        receipt({ kind: 'BOUNCED', providerEventId: eventId }),
      );
      const second = await service.recordReceipt(
        receipt({ kind: 'BOUNCED', providerEventId: eventId }),
      );
      const third = await service.recordReceipt(
        receipt({ kind: 'BOUNCED', providerEventId: eventId }),
      );

      expect(first.recorded).toBe(true);
      expect(second.duplicate).toBe(true);
      expect(third.duplicate).toBe(true);
      expect(second.recorded).toBe(false);

      const reputation = await service.reputation('EMAIL', email);
      expect(Number(reputation?.bounced_count)).toBe(1);
    });

    it('records receipts without an event id separately', async () => {
      // Not every provider supplies one; those cannot be de-duplicated and must not be silently dropped.
      await service.recordReceipt(receipt());
      await service.recordReceipt(receipt());
      const reputation = await service.reputation('EMAIL', email);
      expect(Number(reputation?.delivered_count)).toBe(2);
    });
  });

  describe('suppression requires permanent, verified evidence', () => {
    it('suppresses on a hard bounce', async () => {
      const result = await service.recordReceipt(receipt({ kind: 'BOUNCED', hardBounce: true }));

      expect(result.suppressed).toBe(true);
      const check = await service.isSuppressed('EMAIL', email);
      expect(check.suppressed).toBe(true);
      expect(check.reason).toMatch(/Permanent delivery failure/i);
    });

    it('suppresses on a spam complaint', async () => {
      const result = await service.recordReceipt(receipt({ kind: 'COMPLAINED' }));
      expect(result.suppressed).toBe(true);
      expect((await service.isSuppressed('EMAIL', email)).reason).toMatch(/spam/i);
    });

    it('does NOT suppress on a soft bounce', async () => {
      // A full mailbox is temporary. Suppressing here cuts off a customer whose only problem was timing.
      const result = await service.recordReceipt(receipt({ kind: 'BOUNCED', hardBounce: false }));
      expect(result.suppressed).toBe(false);
      expect((await service.isSuppressed('EMAIL', email)).suppressed).toBe(false);
    });

    it('does NOT suppress on a deferral', async () => {
      // The case most likely to be added by mistake: greylisting and full mailboxes both produce deferrals.
      const result = await service.recordReceipt(receipt({ kind: 'DEFERRED' }));
      expect(result.suppressed).toBe(false);
      expect((await service.isSuppressed('EMAIL', email)).suppressed).toBe(false);
    });

    it('does NOT suppress on an unverified receipt, even a hard bounce', async () => {
      /*
       * A public webhook is forgeable. A forged bounce would let anyone stop a customer receiving a one-time
       * code, so an unauthenticated receipt is recorded for the record and is not acted on.
       */
      const result = await service.recordReceipt(
        receipt({ kind: 'BOUNCED', hardBounce: true, verification: 'UNVERIFIED' }),
      );

      expect(result.recorded).toBe(true);
      expect(result.suppressed).toBe(false);
      expect((await service.isSuppressed('EMAIL', email)).suppressed).toBe(false);
    });

    it('enforces the verified-only rule in the database, not just the service', async () => {
      // A service bug must not be able to produce an unverified suppression.
      await service.recordReceipt(receipt());
      await expect(
        db.query(
          `UPDATE notification_destination_reputation
              SET suppressed_at = now(), suppressed_reason = 'forged', suppression_verified = false
            WHERE channel = 'EMAIL'`,
        ),
      ).rejects.toThrow();
    });

    it('refuses a suppression with no stated reason', async () => {
      // A silent suppression cannot exist: it is invisible to the customer and must be explainable.
      await service.recordReceipt(receipt());
      await expect(
        db.query(
          `UPDATE notification_destination_reputation
              SET suppressed_at = now(), suppression_verified = true
            WHERE channel = 'EMAIL'`,
        ),
      ).rejects.toThrow();
    });

    it('accepts SHARED_SECRET as sufficient authentication', async () => {
      const result = await service.recordReceipt(
        receipt({ kind: 'COMPLAINED', verification: 'SHARED_SECRET' }),
      );
      expect(result.suppressed).toBe(true);
    });
  });

  describe('suppression is reviewable and reversible', () => {
    it('lists suppressed destinations', async () => {
      await service.recordReceipt(receipt({ kind: 'COMPLAINED' }));
      const suppressed = await service.suppressedDestinations();
      expect(suppressed).toHaveLength(1);
      expect(suppressed[0]?.verified).toBe(true);
      expect(suppressed[0]?.destinationMasked).toContain('***');
    });

    it('lifts a suppression and clears the send-path block', async () => {
      await service.recordReceipt(receipt({ kind: 'COMPLAINED' }));
      expect((await service.isSuppressed('EMAIL', email)).suppressed).toBe(true);

      await service.liftSuppression({
        channel: 'EMAIL',
        destination: email,
        liftedBy: 'support-lead',
        reason: 'Customer confirmed they did not report spam; provider mis-attributed the event.',
      });

      expect((await service.isSuppressed('EMAIL', email)).suppressed).toBe(false);
    });

    it('keeps the counters after a lift, because the history is evidence', async () => {
      await service.recordReceipt(receipt({ kind: 'COMPLAINED' }));
      await service.liftSuppression({
        channel: 'EMAIL',
        destination: email,
        liftedBy: 'support-lead',
        reason: 'reviewed',
      });

      const reputation = await service.reputation('EMAIL', email);
      expect(Number(reputation?.complained_count)).toBe(1);
      expect(reputation?.suppressed_at).toBeNull();
    });

    it('refuses to lift a suppression without naming who did it or why', async () => {
      await service.recordReceipt(receipt({ kind: 'COMPLAINED' }));
      await expect(
        service.liftSuppression({
          channel: 'EMAIL',
          destination: email,
          liftedBy: '  ',
          reason: 'x',
        }),
      ).rejects.toThrow(/named principal/i);
      await expect(
        service.liftSuppression({
          channel: 'EMAIL',
          destination: email,
          liftedBy: 'a',
          reason: '  ',
        }),
      ).rejects.toThrow(/must state why/i);
    });
  });

  describe('reputation is per destination and per channel', () => {
    it('does not mix SMS and email reputation', async () => {
      // The same string used as both a phone and an address is not the same destination.
      await service.recordReceipt(receipt({ channel: 'EMAIL', kind: 'BOUNCED', hardBounce: true }));
      const sms = await service.isSuppressed('SMS', email);
      expect(sms.suppressed).toBe(false);
    });

    it('accumulates counters across kinds', async () => {
      await service.recordReceipt(receipt({ kind: 'DELIVERED' }));
      await service.recordReceipt(receipt({ kind: 'DELIVERED' }));
      await service.recordReceipt(receipt({ kind: 'DEFERRED' }));
      await service.recordReceipt(receipt({ kind: 'FAILED' }));

      const reputation = await service.reputation('EMAIL', email);
      expect(Number(reputation?.delivered_count)).toBe(2);
      expect(Number(reputation?.deferred_count)).toBe(1);
      expect(Number(reputation?.failed_count)).toBe(1);
    });

    it('answers a lookup for an unknown destination without failing the send', async () => {
      // A reputation lookup failure must never stop a message; the pipeline's own policy checks remain
      // authoritative.
      const result = await service.isSuppressed('EMAIL', 'nobody@example.invalid');
      expect(result.suppressed).toBe(false);
      expect(result.reason).toBeNull();
    });
  });

  describe('security-critical delivery posture', () => {
    it('separates confirmed delivery from mere provider acceptance', async () => {
      /*
       * The question a security team asks after an incident. Before receipts, every attempt looked identically
       * SENT and a low actual delivery rate on OTPs was invisible.
       */
      async function sentDelivery(): Promise<string> {
        const rows: Array<{ id: string }> = await db.query(
          `INSERT INTO notification_deliveries (
             event_type, event_key, recipient_type, recipient_id, channel, destination, payload, status, sent_at
           ) VALUES ('OTP_REQUESTED', $1, 'CUSTOMER', 'c1', 'SMS', $2, '{}'::jsonb, 'SENT', now())
           RETURNING id`,
          [`g26-${randomUUID()}`, phone],
        );
        return firstRow(rows, 'delivery').id;
      }

      const deliveredId = await sentDelivery();
      const bouncedId = await sentDelivery();
      await sentDelivery(); // no receipt at all

      await service.recordReceipt(
        receipt({ channel: 'SMS', kind: 'DELIVERED', destination: phone, deliveryId: deliveredId }),
      );
      await service.recordReceipt(
        receipt({
          channel: 'SMS',
          kind: 'BOUNCED',
          hardBounce: true,
          destination: phone,
          deliveryId: bouncedId,
        }),
      );

      const posture = await service.securityDeliveryPosture();
      const sms = posture.find((entry) => entry.channel === 'SMS');
      expect(sms?.attempted).toBe(3);
      expect(sms?.confirmedDelivered).toBe(1);
      expect(sms?.knownUndelivered).toBe(1);
      expect(sms?.noReceipt).toBe(1);
    });

    it('ignores unverified receipts in the posture, because they prove nothing', async () => {
      const rows: Array<{ id: string }> = await db.query(
        `INSERT INTO notification_deliveries (
           event_type, event_key, recipient_type, recipient_id, channel, destination, payload, status, sent_at
         ) VALUES ('OTP_REQUESTED', $1, 'CUSTOMER', 'c1', 'SMS', $2, '{}'::jsonb, 'SENT', now())
         RETURNING id`,
        [`g26-${randomUUID()}`, phone],
      );
      const deliveryId = firstRow(rows, 'delivery').id;

      await service.recordReceipt(
        receipt({
          channel: 'SMS',
          kind: 'BOUNCED',
          hardBounce: true,
          destination: phone,
          deliveryId,
          verification: 'UNVERIFIED',
        }),
      );

      const posture = await service.securityDeliveryPosture();
      const sms = posture.find((entry) => entry.channel === 'SMS');
      // An unauthenticated bounce is not knowledge; the delivery counts as having no receipt.
      expect(sms?.knownUndelivered).toBe(0);
      expect(sms?.noReceipt).toBe(1);
    });
  });

  describe('receipts are evidence', () => {
    it('refuses to rewrite or delete a receipt', async () => {
      const result = await service.recordReceipt(receipt());
      await expect(
        db.query(`UPDATE notification_delivery_receipts SET kind = 'DELIVERED' WHERE id = $1`, [
          result.receiptId,
        ]),
      ).rejects.toThrow(/append-only/i);
      await expect(
        db.query(`DELETE FROM notification_delivery_receipts WHERE id = $1`, [result.receiptId]),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses to roll back while any receipt exists', async () => {
      await service.recordReceipt(receipt());

      const { NotificationDeliveryReceipts1785753600613 } = await import(
        '../src/migrations/1785753600613-NotificationDeliveryReceipts'
      );
      const migration = new NotificationDeliveryReceipts1785753600613();
      const runner = { query: (sql: string) => db.query(sql) };

      await expect(
        migration.down(runner as unknown as Parameters<typeof migration.down>[0]),
      ).rejects.toThrow(/Refusing to roll back/i);
    });
  });
});
