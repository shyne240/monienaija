/**
 * ARENA 3D Group 14 — worker infrastructure: ownership, leases, and dead letters.
 *
 * ## What was actually wrong
 *
 * Four background workers run in this application (agent cash-to-cash expiry, KYC tier reevaluation,
 * banking dispatch, notification delivery) plus the outbox. Inspecting them rather than assuming:
 *
 *  - **Banking dispatch already has a real database lease** with a fencing counter, and is correct. It is
 *    the model the others are measured against, not something to replace.
 *  - **KYC reevaluation is safe without a lease** by construction: it marks work in
 *    `kyc_tier_expiry_events` with `ON CONFLICT DO NOTHING` and the insert result gates the effect, so two
 *    instances racing produce one effect. Its `setInterval` plus a private `active` promise is an
 *    in-process mutual exclusion, which is sufficient *because* the database is the real serialiser.
 *  - **The outbox has a genuine defect.** `claimPending` uses `pessimistic_write`, which *blocks* a
 *    second worker rather than skipping past its rows, so workers queue behind each other for no
 *    benefit. Worse, `markFailed` increments no ceiling: an event that always fails returns to PENDING
 *    forever, every retry delay, indefinitely. There is no dead-letter state, so a poison event is
 *    indistinguishable from a busy one and no operator can ever be told "this will never succeed".
 *
 * This module fixes the outbox claim path and introduces the missing dead-letter concept, without
 * replacing the workers that are already correct.
 *
 * ## No in-memory queue
 *
 * Nothing here holds work in process memory. A claim is a database row update; a lease is a timestamp;
 * a dead letter is a status. A process that dies leaves nothing stranded and nothing double-run, because
 * it never held anything in the first place.
 */
import { Injectable, Optional } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** Default ceiling on delivery attempts before an event is dead-lettered. Configurable, not magic. */
export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 12;

/** How long a claimed-but-unfinished event stays owned by one worker. */
export const DEFAULT_LEASE_MS = 60_000;

/**
 * Unwraps a TypeORM `query()` result into plain rows.
 *
 * `DataSource.query()` returns rows directly for SELECT, but for a data-modifying statement with a
 * `RETURNING` clause the driver hands back `[rows, affectedCount]`. Treating that tuple as a row array
 * yields a row whose fields are all `undefined` and whose only key is `"0"` — which then surfaces as an
 * opaque "Invalid time value" far from the cause. Unwrapping explicitly keeps that ambiguity out of every
 * call site.
 */
function rowsOf<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  // The tuple form is exactly two elements whose first is an array of row objects. Keying on the row
  // shape rather than on the count being a `number` matters: a single-row `RETURNING` can produce a
  // count the driver types differently, and a wrong guess here silently returns zero rows.
  const first: unknown = result[0];
  const second: unknown = result[1];
  if (result.length === 2 && Array.isArray(first) && !Array.isArray(second)) {
    return first as T[];
  }
  return result as T[];
}

/** Accepts either a `Date` (extended protocol) or a string (simple protocol). */
function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export interface ClaimOptions {
  limit?: number;
  leaseMs?: number;
  /** Worker identity recorded on the claim, so a stuck event names its owner. */
  workerId: string;
}

export interface ClaimedEvent {
  id: string;
  attempts: number;
  leaseExpiresAt: string;
  workerId: string;
}

export interface DeadLetterRecord {
  id: string;
  eventType: string;
  aggregateType: string;
  attempts: number;
  lastError: string | null;
  deadLetteredAt: string;
  workerId: string | null;
}

/**
 * Why a separate interface rather than extending `OutboxService`.
 *
 * `OutboxService` is transaction-scoped by design — every method takes an `EntityManager` so the caller
 * controls the transaction, which is correct for the write path. The claim path has the opposite
 * requirement: it must run in its *own* short transaction so that claiming does not hold a lock for the
 * duration of delivery. Keeping them apart makes that difference explicit rather than a subtlety in how
 * a caller happens to pass a manager.
 */
@Injectable()
export class WorkerLeaseService {
  /**
   * The ceiling is a constructor argument for testability, **not** an injected dependency.
   *
   * It was originally a defaulted parameter, which Nest reads as a dependency at index 0 and fails to
   * resolve — caught by the AppModule boot test, not by the unit suite, because unit tests instantiate the
   * class directly. `@Optional()` keeps both paths working: DI leaves it undefined, direct construction can
   * pass a smaller ceiling.
   */
  private readonly defaultMaxAttempts: number;

  constructor(@Optional() defaultMaxAttempts?: number) {
    this.defaultMaxAttempts = defaultMaxAttempts ?? DEFAULT_MAX_DELIVERY_ATTEMPTS;
  }

  /**
   * Claims a bounded batch of due events for one worker.
   *
   * `FOR UPDATE SKIP LOCKED` is the important part. With `pessimistic_write` (a plain `FOR UPDATE`), a
   * second worker blocks on the first worker's rows and then processes them after the first commits —
   * it waits for work that no longer exists. `SKIP LOCKED` makes the second worker walk past those rows
   * and take the next ones, which is what "two workers make progress" actually means.
   *
   * The claim also writes a lease. An event whose lease has expired becomes claimable again, so a worker
   * that died mid-delivery does not strand its batch.
   */
  async claim(manager: EntityManager, options: ClaimOptions): Promise<ClaimedEvent[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    const rows = rowsOf<{ id: string; attempts: number; lease_expires_at: Date | string }>(
      await manager.query(
        `WITH due AS (
         SELECT id FROM outbox_events
          WHERE status = 'PENDING'
            AND available_at <= NOW()
            AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())
          ORDER BY available_at ASC, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE outbox_events e
          SET attempts = e.attempts + 1,
              lease_expires_at = NOW() + ($2::int * INTERVAL '1 millisecond'),
              lease_owner = $3,
              claimed_at = NOW()
         FROM due
        WHERE e.id = due.id
        RETURNING e.id, e.attempts, e.lease_expires_at`,
        [limit, leaseMs, options.workerId],
      ),
    );
    // The driver returns `timestamptz` as a `Date` over the extended protocol but as a string over the
    // simple protocol. Normalising is not defensive padding: `new Date(date)` throws "Invalid time value"
    // on an already-parsed Date, and that turned every claim into a crash.
    return rows.map((row) => ({
      id: row.id,
      attempts: row.attempts,
      leaseExpiresAt: toIsoString(row.lease_expires_at),
      workerId: options.workerId,
    }));
  }

  /**
   * Records a failed delivery.
   *
   * Below the ceiling the event returns to PENDING after the backoff. **At or above it the event is
   * dead-lettered**: it stops consuming worker capacity, it stops being retried, and it appears in a
   * list an operator can act on. A retry loop that never terminates is not resilience, it is a slow leak
   * that also guarantees nobody is ever told about the failure.
   */
  async fail(
    manager: EntityManager,
    eventId: string,
    errorMessage: string,
    options: { retryDelaySeconds?: number; maxAttempts?: number } = {},
  ): Promise<{ deadLettered: boolean; attempts: number }> {
    const retryDelaySeconds = Math.max(options.retryDelaySeconds ?? 60, 1);
    const maxAttempts = options.maxAttempts ?? this.defaultMaxAttempts;
    const rows = rowsOf<{ attempts: number; dead_lettered: boolean }>(
      await manager.query(
        `UPDATE outbox_events
          SET last_error = $2,
              lease_expires_at = NULL,
              lease_owner = NULL,
              status = CASE WHEN attempts >= $3 THEN 'DEAD_LETTERED' ELSE 'PENDING' END,
              available_at = CASE
                WHEN attempts >= $3 THEN available_at
                ELSE NOW() + ($4::int * INTERVAL '1 second')
              END,
              dead_lettered_at = CASE WHEN attempts >= $3 THEN NOW() ELSE dead_lettered_at END
        WHERE id = $1
        RETURNING attempts, (status = 'DEAD_LETTERED') AS dead_lettered`,
        [eventId, errorMessage.slice(0, 255), maxAttempts, retryDelaySeconds],
      ),
    );
    const row = rows[0];
    if (!row) throw new Error(`Outbox event ${eventId} was not found`);
    return { deadLettered: row.dead_lettered, attempts: row.attempts };
  }

  /** Releases a claim without counting it as a failure — a graceful shutdown path. */
  async release(manager: EntityManager, eventIds: readonly string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const rows = rowsOf<{ id: string }>(
      await manager.query(
        `UPDATE outbox_events
          SET lease_expires_at = NULL, lease_owner = NULL, attempts = GREATEST(attempts - 1, 0)
        WHERE id = ANY($1::uuid[]) AND status = 'PENDING'
        RETURNING id`,
        [eventIds],
      ),
    );
    return rows.length;
  }

  /**
   * The dead-letter queue.
   *
   * Deliberately read-only from this service. Requeueing a dead letter is an operator action with an
   * audit trail (Group 20's operations centre), not something a worker does to itself on a timer — that
   * would restore the infinite retry with extra steps.
   */
  async deadLetters(manager: EntityManager, limit = 100): Promise<DeadLetterRecord[]> {
    const rows = await manager.query<
      Array<{
        id: string;
        event_type: string;
        aggregate_type: string;
        attempts: number;
        last_error: string | null;
        dead_lettered_at: string;
        lease_owner: string | null;
      }>
    >(
      `SELECT id, event_type, aggregate_type, attempts, last_error, dead_lettered_at, lease_owner
         FROM outbox_events
        WHERE status = 'DEAD_LETTERED'
        ORDER BY dead_lettered_at ASC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 1000)],
    );
    return rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      attempts: row.attempts,
      lastError: row.last_error,
      deadLetteredAt: toIsoString(row.dead_lettered_at),
      workerId: row.lease_owner,
    }));
  }

  /**
   * Liveness of the queue, for metrics.
   *
   * `stalled` counts events whose lease expired while still claimed — the signature of a crashed worker.
   * Without it, a worker that dies leaves events that look merely "in progress" forever.
   */
  async health(manager: EntityManager): Promise<{
    pending: number;
    deadLettered: number;
    stalled: number;
    oldestPendingAgeSeconds: number | null;
  }> {
    const rows = await manager.query<
      Array<{ pending: number; dead_lettered: number; stalled: number; oldest_age: string | null }>
    >(
      `SELECT
         count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
         count(*) FILTER (WHERE status = 'DEAD_LETTERED')::int AS dead_lettered,
         count(*) FILTER (
           WHERE status = 'PENDING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= NOW()
         )::int AS stalled,
         EXTRACT(EPOCH FROM (NOW() - min(available_at) FILTER (WHERE status = 'PENDING')))::text
           AS oldest_age
       FROM outbox_events`,
    );
    const row = rows[0];
    if (!row) return { pending: 0, deadLettered: 0, stalled: 0, oldestPendingAgeSeconds: null };
    return {
      pending: row.pending,
      deadLettered: row.dead_lettered,
      stalled: row.stalled,
      oldestPendingAgeSeconds: row.oldest_age === null ? null : Math.floor(Number(row.oldest_age)),
    };
  }
}
