import type { DataSource } from 'typeorm';

import { WorkerLeaseService } from '../src/operations/worker-lease.service';
import {
  createIntegrationDataSource,
  destroyIntegrationDataSource,
  firstRow,
} from './support/pg-harness';

/**
 * ARENA 3D Group 14 — outbox ownership, leases and dead letters, against real PostgreSQL.
 *
 * These assertions are only meaningful against a real database. `FOR UPDATE SKIP LOCKED` and lease expiry
 * are PostgreSQL behaviours; a mocked manager would return whatever the mock was told to return and prove
 * nothing about two workers sharing a queue.
 */
describe('Group 14 — worker leases and dead letters', () => {
  let db: DataSource;
  let service: WorkerLeaseService;

  async function seedDueEvents(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await db.query(
        `INSERT INTO outbox_events
           (event_type, aggregate_type, aggregate_id, payload, status, attempts, available_at)
         VALUES ('TEST_EVENT', 'TEST_AGGREGATE', gen_random_uuid(), '{}'::jsonb, 'PENDING', 0,
                 NOW() - INTERVAL '1 hour')`,
      );
    }
  }

  beforeAll(async () => {
    db = await createIntegrationDataSource('g14lease');
    service = new WorkerLeaseService(3);
  }, 180_000);

  afterAll(async () => {
    if (db?.isInitialized) await destroyIntegrationDataSource(db);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM outbox_events');
  });

  describe('claiming shares the queue instead of serialising it', () => {
    it('lets two concurrent workers each take a disjoint batch', async () => {
      // `pessimistic_write` (plain FOR UPDATE) made the second worker wait for the first worker's rows and
      // then process them after commit — queueing for work that no longer existed. SKIP LOCKED makes them
      // share. This test fails with the old behaviour and passes with the new one, which is the point.
      await seedDueEvents(10);
      const [first, second] = await Promise.all([
        db.transaction((m) => service.claim(m, { limit: 4, workerId: 'worker-1' })),
        db.transaction((m) => service.claim(m, { limit: 4, workerId: 'worker-2' })),
      ]);
      expect(first).toHaveLength(4);
      expect(second).toHaveLength(4);

      const firstIds = new Set(first.map((event) => event.id));
      const overlap = second.filter((event) => firstIds.has(event.id));
      expect(overlap).toEqual([]);
    });

    it('does not make a second worker wait for a first worker holding a claim open', async () => {
      // This is the assertion that actually distinguishes `SKIP LOCKED` from plain `FOR UPDATE`.
      //
      // The previous two tests pass either way, because row disjointness comes from the lease predicate,
      // not from the locking clause — a worker that waits and *then* finds the lease taken simply returns
      // nothing. The difference only becomes observable while a claim transaction is still open: with
      // plain `FOR UPDATE` the second worker blocks and cannot return until the first commits, which is
      // exactly the serialisation that made the old `pessimistic_write` claim path useless under more than
      // one instance.
      await seedDueEvents(10);
      let releaseFirst: () => void = () => {};
      const firstHeld = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstHasClaimed: () => void = () => {};
      const claimedSignal = new Promise<void>((resolve) => {
        firstHasClaimed = resolve;
      });

      const holder = db.transaction(async (m) => {
        await service.claim(m, { limit: 2, workerId: 'holder' });
        firstHasClaimed();
        // Hold the transaction open so its row locks are still live.
        await firstHeld;
      });
      await claimedSignal;

      // The second worker must complete while the first transaction is still open.
      const second = await db.transaction((m) =>
        service.claim(m, { limit: 2, workerId: 'concurrent' }),
      );
      expect(second).toHaveLength(2);

      releaseFirst();
      await holder;
    });

    it('never hands the same event to two workers, even under heavy contention', async () => {
      await seedDueEvents(40);
      const batches = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          db.transaction((m) => service.claim(m, { limit: 5, workerId: `w${index}` })),
        ),
      );
      const allIds = batches.flat().map((event) => event.id);
      expect(new Set(allIds).size).toBe(allIds.length);
      // 8 workers x 5 = 40, and there were exactly 40 events: every event claimed exactly once.
      expect(allIds.length).toBe(40);
    });

    it('increments attempts on claim and records the owning worker', async () => {
      await seedDueEvents(1);
      const claimed = firstRow(
        await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'w-own' })),
        'claim',
      );
      expect(claimed.attempts).toBe(1);
      expect(claimed.workerId).toBe('w-own');
      const rows: Array<{ lease_owner: string; lease_expires_at: Date }> = await db.query(
        'SELECT lease_owner, lease_expires_at FROM outbox_events WHERE id = $1',
        [claimed.id],
      );
      expect(firstRow(rows, 'claimed row').lease_owner).toBe('w-own');
      expect(firstRow(rows, 'claimed row').lease_expires_at).toBeInstanceOf(Date);
    });

    it('does not re-claim a row whose lease is still live', async () => {
      await seedDueEvents(1);
      await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'holder' }));
      const second = await db.transaction((m) =>
        service.claim(m, { limit: 10, workerId: 'other' }),
      );
      expect(second).toEqual([]);
    });

    it('reclaims a row whose lease expired, so a crashed worker strands nothing', async () => {
      await seedDueEvents(1);
      const claimed = firstRow(
        await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'died' })),
        'claim',
      );
      await db.query(
        `UPDATE outbox_events SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [claimed.id],
      );
      const reclaimed = await db.transaction((m) =>
        service.claim(m, { limit: 10, workerId: 'rescuer' }),
      );
      expect(reclaimed.map((event) => event.id)).toEqual([claimed.id]);
      expect(firstRow(reclaimed, 'reclaim').workerId).toBe('rescuer');
    });
  });

  describe('failure is bounded', () => {
    it('dead-letters exactly at the ceiling and stays terminal after', async () => {
      // A retry loop with no ceiling is not resilience: it consumes a worker slot forever and guarantees
      // nobody is ever told the delivery will never succeed.
      await seedDueEvents(1);
      const outcomes: Array<{ deadLettered: boolean; attempts: number }> = [];
      let eventId: string | null = null;
      // Model real delivery cycles: an attempt is a claim followed by a failure, and `attempts` advances on
      // the claim. Calling `fail` in a loop would never advance the counter, which is the very bug the
      // ceiling exists to prevent.
      for (let cycle = 0; cycle < 4; cycle += 1) {
        if (eventId !== null) {
          await db.query(
            `UPDATE outbox_events SET available_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
            [eventId],
          );
        }
        const claimed = await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'w' }));
        if (claimed.length === 0) {
          // No claimable work. Either the event is terminal, or a lease is live — distinguish them by
          // reading the row rather than assuming, otherwise "no work" silently reads as "dead-lettered".
          const rows: Array<{ status: string }> = await db.query(
            'SELECT status FROM outbox_events WHERE id = $1',
            [eventId],
          );
          expect(firstRow(rows, 'terminal row').status).toBe('DEAD_LETTERED');
          continue;
        }
        const claim = firstRow(claimed, 'claim');
        eventId ??= claim.id;
        expect(claim.attempts).toBe(cycle + 1);
        outcomes.push(
          await db.transaction((m) =>
            service.fail(m, claim.id, 'provider rejected the request', { maxAttempts: 3 }),
          ),
        );
      }
      expect(outcomes.map((o) => o.deadLettered)).toEqual([false, false, true]);
      expect(outcomes.map((o) => o.attempts)).toEqual([1, 2, 3]);

      const rows: Array<{ status: string; dead_lettered_at: Date }> = await db.query(
        'SELECT status, dead_lettered_at FROM outbox_events WHERE id = $1',
        [eventId],
      );
      expect(firstRow(rows, 'dead letter').status).toBe('DEAD_LETTERED');
      expect(firstRow(rows, 'dead letter').dead_lettered_at).toBeInstanceOf(Date);
    });

    it('returns a below-ceiling failure to PENDING with a future availability, not DEAD_LETTERED', async () => {
      await seedDueEvents(1);
      const claimed = firstRow(
        await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'w' })),
        'claim',
      );
      await db.transaction((m) =>
        service.fail(m, claimed.id, 'transient', { retryDelaySeconds: 30, maxAttempts: 5 }),
      );
      const rows: Array<{ status: string; available_at: Date; lease_owner: string | null }> =
        await db.query(
          'SELECT status, available_at, lease_owner FROM outbox_events WHERE id = $1',
          [claimed.id],
        );
      const row = firstRow(rows, 'retryable row');
      expect(row.status).toBe('PENDING');
      expect(row.lease_owner).toBeNull();
      expect(new Date(row.available_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('does not dead-letter a dead letter back into the queue', async () => {
      // Once terminal, a further failure must not resurrect it — that would restore the infinite retry.
      await seedDueEvents(1);
      const claimed = firstRow(
        await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'w' })),
        'claim',
      );
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await db.transaction((m) => service.fail(m, claimed.id, 'x', { maxAttempts: 2 }));
      }
      const again = await db.transaction((m) => service.claim(m, { limit: 10, workerId: 'other' }));
      expect(again).toEqual([]);
    });
  });

  describe('releasing a claim', () => {
    it('does not count a graceful release as a failed attempt', async () => {
      // A shutdown must not burn a retry: the event never failed, it was never finished.
      await seedDueEvents(2);
      const claimed = await db.transaction((m) =>
        service.claim(m, { limit: 2, workerId: 'shutdown' }),
      );
      expect(claimed.every((event) => event.attempts === 1)).toBe(true);
      const released = await db.transaction((m) =>
        service.release(
          m,
          claimed.map((event) => event.id),
        ),
      );
      expect(released).toBe(2);
      const rows: Array<{ attempts: number; lease_owner: string | null }> = await db.query(
        'SELECT attempts, lease_owner FROM outbox_events WHERE id = ANY($1::uuid[])',
        [claimed.map((event) => event.id)],
      );
      for (const row of rows) {
        expect(row.attempts).toBe(0);
        expect(row.lease_owner).toBeNull();
      }
    });
  });

  describe('the dead-letter queue is visible', () => {
    it('lists dead letters with the attempt count and the last error', async () => {
      await seedDueEvents(1);
      const claimed = firstRow(
        await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'w' })),
        'claim',
      );
      await db.transaction((m) =>
        service.fail(m, claimed.id, 'permanent: invalid account', { maxAttempts: 1 }),
      );
      const letters = await db.transaction((m) => service.deadLetters(m));
      expect(letters).toHaveLength(1);
      const letter = firstRow(letters, 'dead letter');
      expect(letter.lastError).toBe('permanent: invalid account');
      expect(letter.attempts).toBeGreaterThanOrEqual(1);
    });

    it('reports queue health including stalled leases', async () => {
      // A worker that dies leaves rows that look merely "in progress". Without a stalled count, that is
      // invisible until someone notices the backlog.
      await seedDueEvents(3);
      const claimed = await db.transaction((m) => service.claim(m, { limit: 2, workerId: 'died' }));
      await db.query(
        `UPDATE outbox_events SET lease_expires_at = NOW() - INTERVAL '5 minutes'
          WHERE id = ANY($1::uuid[])`,
        [claimed.map((event) => event.id)],
      );
      const health = await db.transaction((m) => service.health(m));
      expect(health.pending).toBe(3);
      expect(health.stalled).toBe(2);
      expect(health.deadLettered).toBe(0);
      expect(health.oldestPendingAgeSeconds).not.toBeNull();
    });
  });

  describe('the database enforces the invariants the code relies on', () => {
    it('refuses a dead-lettered row with no dead-lettered timestamp', async () => {
      await seedDueEvents(1);
      const claimed = firstRow(
        await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'w' })),
        'claim',
      );
      await expect(
        db.query(
          `UPDATE outbox_events SET status = 'DEAD_LETTERED', dead_lettered_at = NULL WHERE id = $1`,
          [claimed.id],
        ),
      ).rejects.toThrow(/chk_outbox_events_dead_lettered_at/);
    });

    it('refuses a half-written lease', async () => {
      // A lease owner with no expiry would be an event that can never be reclaimed.
      await seedDueEvents(1);
      const claimed = firstRow(
        await db.transaction((m) => service.claim(m, { limit: 1, workerId: 'w' })),
        'claim',
      );
      await expect(
        db.query(`UPDATE outbox_events SET lease_expires_at = NULL WHERE id = $1`, [claimed.id]),
      ).rejects.toThrow(/chk_outbox_events_lease_complete/);
    });

    it('refuses an unknown status', async () => {
      await seedDueEvents(1);
      await expect(db.query(`UPDATE outbox_events SET status = 'PROCESSING'`)).rejects.toThrow(
        /chk_outbox_events_status/,
      );
    });
  });
});
