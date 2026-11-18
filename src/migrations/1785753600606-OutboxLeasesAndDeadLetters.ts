import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ARENA 3D Group 14 — outbox ownership leases and a dead-letter state.
 *
 * ## The two defects this fixes
 *
 * 1. **Claiming blocked instead of skipping.** `OutboxService.claimPending` used TypeORM's
 *    `pessimistic_write`, which emits a plain `FOR UPDATE`. A second worker therefore *waited* on the
 *    first worker's rows and then processed them after the first committed — it queued for work that no
 *    longer existed. Under more than one instance this serialises delivery while looking like
 *    concurrency. `FOR UPDATE SKIP LOCKED` is what makes two workers actually share the queue.
 *
 * 2. **Failure was unbounded.** `markFailed` returned an event to PENDING with a delay and incremented
 *    `attempts`, but nothing ever consulted `attempts`. A permanently failing event retried forever, so
 *    it consumed a worker slot on every poll indefinitely — and, because there was no terminal state, no
 *    operator could ever be told that it would never succeed. A retry loop without a ceiling is not
 *    resilience; it is a slow leak that also guarantees the failure is never surfaced.
 *
 * ## Design points
 *
 * - A lease is a **timestamp compared against the database clock**, not a held connection and not a
 *   client-supplied time. A worker that dies mid-delivery leaves a lease that expires on its own; a
 *   worker with a skewed clock cannot steal a live one.
 * - `lease_owner` records **who** claimed the event, so a stuck row names a process rather than being an
 *   anonymous "in progress".
 * - `DEAD_LETTERED` is terminal. Requeueing is an audited operator action (Group 20), never a timer —
 *   a timer that requeues dead letters is the infinite retry with extra steps.
 * - `attempts` is retained on the dead letter, because "failed 12 times" and "failed once" call for
 *   completely different investigation.
 *
 * ## Why new columns rather than a new table
 *
 * The lease belongs to the event's lifecycle, not beside it. A separate table would need its own cleanup
 * and could disagree with the event's status — precisely the class of inconsistency this migration
 * exists to remove.
 */
export class OutboxLeasesAndDeadLetters1785753600606 implements MigrationInterface {
  name = 'OutboxLeasesAndDeadLetters1785753600606';

  async up(q: QueryRunner): Promise<void> {
    // Lease and dead-letter columns. All nullable so existing rows remain valid.
    await q.query(`ALTER TABLE outbox_events
      ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS lease_owner varchar(160),
      ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz`);

    // Widen the status domain. The original CHECK allowed only PENDING/PUBLISHED/FAILED; DEAD_LETTERED is
    // a distinct terminal outcome, not a flavour of FAILED, because FAILED still retries.
    await q.query(`ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS chk_outbox_events_status`);
    await q.query(`ALTER TABLE outbox_events
      ADD CONSTRAINT chk_outbox_events_status
      CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD_LETTERED'))`);

    // A dead letter must record when it became one; otherwise "how long has this been stuck?" is
    // unanswerable, which is the question the dead-letter list exists to answer.
    await q.query(`ALTER TABLE outbox_events
      ADD CONSTRAINT chk_outbox_events_dead_lettered_at
      CHECK (
        (status = 'DEAD_LETTERED' AND dead_lettered_at IS NOT NULL)
        OR (status <> 'DEAD_LETTERED')
      )`);

    // A lease owner without an expiry (or the reverse) is a half-written claim. Refusing it here means a
    // bug in the claim path fails loudly at the row rather than producing an event that can never be
    // reclaimed because its expiry is NULL.
    await q.query(`ALTER TABLE outbox_events
      ADD CONSTRAINT chk_outbox_events_lease_complete
      CHECK (
        (lease_expires_at IS NULL AND lease_owner IS NULL)
        OR (lease_expires_at IS NOT NULL AND lease_owner IS NOT NULL)
      )`);

    // Claim query support: due PENDING rows ordered by availability. Partial, because PUBLISHED rows are
    // the overwhelming majority once the system has run for a while and are never claimed.
    await q.query(`CREATE INDEX IF NOT EXISTS idx_outbox_events_claimable
      ON outbox_events (available_at, id)
      WHERE status = 'PENDING'`);

    // Dead-letter listing support.
    await q.query(`CREATE INDEX IF NOT EXISTS idx_outbox_events_dead_lettered
      ON outbox_events (dead_lettered_at)
      WHERE status = 'DEAD_LETTERED'`);
  }

  async down(q: QueryRunner): Promise<void> {
    /*
     * Deliberately partial, and deliberately non-destructive of evidence.
     *
     * Dropping the columns would delete the record of which events were dead-lettered and who claimed
     * what — the only evidence of a delivery that never succeeded. The indexes and the widened CHECK can
     * go, because they carry no information; the columns and any DEAD_LETTERED rows stay.
     *
     * Rolling this migration back while dead letters exist would also violate the CHECK this method
     * reinstates. Rather than silently rewriting those rows to FAILED (which would put them back into the
     * unbounded retry this migration removed), the down() refuses when any exist.
     */
    const dead = (await q.query(
      `SELECT count(*)::text AS n FROM outbox_events WHERE status = 'DEAD_LETTERED'`,
    )) as Array<{ n: string }>;
    if (Number(dead[0]?.n ?? '0') > 0) {
      throw new Error(
        'Refusing to roll back: dead-lettered outbox events exist. Rolling back would return them to ' +
          'unbounded retry. Resolve or archive them first.',
      );
    }
    await q.query(`DROP INDEX IF EXISTS idx_outbox_events_dead_lettered`);
    await q.query(`DROP INDEX IF EXISTS idx_outbox_events_claimable`);
    await q.query(
      `ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS chk_outbox_events_lease_complete`,
    );
    await q.query(
      `ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS chk_outbox_events_dead_lettered_at`,
    );
    await q.query(`ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS chk_outbox_events_status`);
    await q.query(`ALTER TABLE outbox_events
      ADD CONSTRAINT chk_outbox_events_status
      CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))`);
    // Columns intentionally retained.
  }
}
