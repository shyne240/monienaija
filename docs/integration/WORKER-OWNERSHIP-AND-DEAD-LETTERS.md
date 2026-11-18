# Worker Ownership, Leases and Dead Letters

ARENA 3D Group 14. Covers the background workers in this application: which of them were already
correct, which had a real defect, and what an operator should do when a queue stalls or an event is
dead-lettered.

This document is deliberately narrow. It does not claim that any worker has been run in production, that
delivery to a live provider has been accepted, or that any external system has confirmed receipt.

---

## 1. What was actually wrong

Group 14 began by reading the four workers and the outbox rather than assuming all of them needed the same
treatment. Three findings:

| Component             | State on inspection                                                                                                                                                                                                                                                                                                                     | Action taken                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Banking dispatch      | **Already correct.** Real database lease, `fence` counter incremented per acquisition, database-clock expiry, bounded attempts, append-only attempt history.                                                                                                                                                                            | None. It is the model the others are measured against.                   |
| KYC tier reevaluation | **Safe without a lease.** Work is marked in `kyc_tier_expiry_events` with `ON CONFLICT DO NOTHING`, and the insert result gates the effect, so two instances racing produce one effect. Its `setInterval` + private `active` promise is in-process mutual exclusion, which is sufficient _because the database is the real serialiser_. | None. Adding a lease here would add a failure mode without removing one. |
| Outbox                | **Genuinely broken, twice.**                                                                                                                                                                                                                                                                                                            | Fixed (below).                                                           |

### 1.1 The claim blocked instead of skipping

`OutboxService.claimPending` used TypeORM's `pessimistic_write`, which emits a plain `FOR UPDATE`. A second
worker therefore **waited** on the first worker's rows and then processed them _after_ the first committed —
queueing for work that no longer existed. Under more than one instance this serialises delivery while
looking like concurrency.

This was measured, not assumed. `test/worker-leases.integration.spec.ts` holds a claim transaction open and
requires a second worker to complete while it is still open. Against `FOR UPDATE` that test **blocks for
120 s and times out**; against `FOR UPDATE SKIP LOCKED` it completes in ~30 ms.

Critically, the _obvious_ concurrency test does not catch this. Two workers claiming concurrently still get
disjoint batches under plain `FOR UPDATE`, because row disjointness comes from the lease predicate — a
worker that waits and then finds the lease taken simply returns nothing. The defect is only observable
while a claim transaction is still open. A guard that cannot fail is not a guard, and the first version of
this suite could not.

### 1.2 Failure was unbounded

`markFailed` returned an event to `PENDING` after a delay and incremented `attempts`, but **nothing ever
consulted `attempts`**. A permanently failing event retried forever, consuming a worker slot on every poll
indefinitely — and, because there was no terminal state, no operator could ever be told it would never
succeed.

A retry loop without a ceiling is not resilience. It is a slow leak that also guarantees the failure is
never surfaced.

---

## 2. What changed

### 2.1 Schema — `1785753600606-OutboxLeasesAndDeadLetters`

| Column             | Meaning                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `lease_expires_at` | Database-clock deadline. Compared against `NOW()`, never a client timestamp.                        |
| `lease_owner`      | Which worker holds the claim. A stuck row names a process instead of being anonymous "in progress". |
| `claimed_at`       | When the current claim was taken.                                                                   |
| `dead_lettered_at` | When the event became terminal.                                                                     |

`status` gains **`DEAD_LETTERED`** alongside `PENDING` / `PUBLISHED` / `FAILED`. It is a distinct terminal
outcome, _not_ a flavour of `FAILED`, because `FAILED` still retries.

Three CHECK constraints make the invariants enforceable rather than merely intended:

- `chk_outbox_events_status` — the status domain.
- `chk_outbox_events_dead_lettered_at` — a dead letter must record when it became one.
- `chk_outbox_events_lease_complete` — an owner without an expiry is a half-written claim, and would be an
  event that can never be reclaimed. Refused at the row.

### 2.2 `WorkerLeaseService`

`src/operations/worker-lease.service.ts`. Separate from `OutboxService` on purpose: `OutboxService` is
transaction-scoped (every method takes an `EntityManager` so the caller controls the transaction, correct
for the write path), while claiming must run in its **own short transaction** so a claim does not hold a
lock for the duration of delivery. Keeping them apart makes that difference explicit.

| Method        | Behaviour                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `claim`       | `FOR UPDATE SKIP LOCKED`, bounded batch, writes lease + owner, increments `attempts`.                 |
| `fail`        | Below ceiling → `PENDING` with backoff. At/above ceiling → `DEAD_LETTERED`.                           |
| `release`     | Graceful-shutdown path. Clears the lease and **decrements** `attempts` — a shutdown is not a failure. |
| `deadLetters` | Read-only listing with attempt count and last error.                                                  |
| `health`      | `pending` / `deadLettered` / `stalled` / `oldestPendingAgeSeconds`.                                   |

`stalled` counts rows whose lease expired while still claimed — the signature of a crashed worker. Without
it, a worker that dies leaves events that look merely "in progress" forever.

**Nothing is held in process memory.** A claim is a row update, a lease is a timestamp, a dead letter is a
status. A process that dies leaves nothing stranded and nothing double-run, because it never held anything.

### 2.3 Requeueing is not automatic

`deadLetters` is read-only from this service. Requeueing a dead letter is an **audited operator action**
(Group 20's operations centre), never a timer — a timer that requeues dead letters is the infinite retry
with extra steps.

---

## 3. Operating the dead-letter queue

### 3.1 Reading it

```sql
SELECT id, event_type, aggregate_type, attempts, last_error, dead_lettered_at, lease_owner
  FROM outbox_events
 WHERE status = 'DEAD_LETTERED'
 ORDER BY dead_lettered_at ASC;
```

`attempts` is retained deliberately: **"failed 12 times" and "failed once" call for completely different
investigation.** An event that failed the ceiling repeatedly is probably a code or contract defect; one that
failed once at the ceiling is probably a provider outage.

### 3.2 Triage

1. Read `last_error`. It is sanitised to 255 characters and redacted on the write path, so it identifies the
   failure without carrying credentials.
2. Decide whether the cause was **transient** (provider down, timeout) or **permanent** (invalid account,
   schema rejection, deleted aggregate).
3. Only then requeue — and requeue by resetting the row deliberately, with the reason recorded:

```sql
UPDATE outbox_events
   SET status = 'PENDING', attempts = 0, available_at = NOW(),
       dead_lettered_at = NULL, lease_owner = NULL, lease_expires_at = NULL
 WHERE id = $1
   AND status = 'DEAD_LETTERED';
```

The `AND status = 'DEAD_LETTERED'` guard matters: without it, a re-run after a worker has already reclaimed
the row silently resets a live claim.

### 3.3 What not to do

- **Do not requeue on a timer.** That restores the unbounded retry this group removed.
- **Do not raise the ceiling to make the queue look clear.** The ceiling is the mechanism by which a
  permanently failing event becomes visible. If the ceiling is too low for a known-flaky dependency, raise
  it _for that dependency_ and record why.
- **Do not delete dead letters to clear a dashboard.** They are the only evidence of a delivery that never
  succeeded.

---

## 4. Rollback

`down()` is deliberately partial and refuses when it would destroy evidence:

- If **any** `DEAD_LETTERED` rows exist, `down()` **throws**. Rolling back would reinstate the
  three-value CHECK, which those rows violate — and the tempting repair (silently rewriting them to
  `FAILED`) would put them straight back into the unbounded retry this migration exists to remove.
- Indexes and constraints are dropped; the **columns and their data are retained**.

This is the same reasoning as Group 11: roll-forward, not destructive rollback.

---

## 5. What is not automated

Stated plainly so nobody assumes more coverage than exists:

- **No scheduler runs these workers in this repository.** `WorkerLeaseService` is the ownership and
  dead-letter primitive; which process calls `claim` on what interval is deployment configuration (Group 15).
- **`OutboxService`'s write path was not rewritten.** It gained `SKIP LOCKED` on the claim; the delivery
  loop that consumes the claim is caller-side and unchanged.
- **No alerting.** `health()` exposes `deadLettered` and `stalled` counts with no thresholds and no
  notification. Wiring thresholds to an alert channel is Group 19.
- **No automatic DLQ draining, no age-based expiry, no metrics export.** Group 17 (metrics) and Group 19
  (alerting).
- **`claim` is not benchmarked** beyond the contention tests here (8 concurrent workers, 40 events, each
  claimed exactly once). Throughput under sustained load is unmeasured.

None of the above is claimed as working. Each is named as a gap with the group that owns it.
