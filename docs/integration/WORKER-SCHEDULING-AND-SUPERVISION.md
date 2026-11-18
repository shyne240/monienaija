# Background Worker Scheduling and Supervision

ARENA 3D Group 15. Covers how background work is scheduled in this application, what the supervisor
observes, and — importantly — what neither of them guarantees.

This document does not claim that any worker has run in production, that a fleet has been exercised, or that
work is progressing anywhere. It describes what the code does and, in §5, states the gaps as gaps.

---

## 1. The decision that shaped this group

Group 14 established that the existing ownership mechanisms are correct: banking dispatch has a real
database lease with fencing, KYC reevaluation is serialised by `ON CONFLICT DO NOTHING`, and the outbox claim
is now `FOR UPDATE SKIP LOCKED`.

So the obvious move — "add a scheduler that owns the workers" — would have been wrong. It would have created
a **second** ownership mechanism competing with the ones that already work: a scheduler deciding when to run
banking dispatch, while the database lease decides who may dispatch. Two authorities over one concern is how
double-dispatch bugs are born.

**Group 15 therefore adds supervision, not scheduling.** Every worker keeps its own driver:

| Worker                    | Driver                                            | Cross-process guarantee                   |
| ------------------------- | ------------------------------------------------- | ----------------------------------------- |
| Agent cash-to-cash expiry | own `setInterval`, `CASH_TO_CASH_EXPIRY_WORKER_*` | PostgreSQL transfer locks                 |
| KYC tier reevaluation     | own `setInterval`, `KYC_TIER_WORKER_*`            | `ON CONFLICT DO NOTHING` on expiry events |
| Banking dispatch          | own `setInterval`, `BANKING_DISPATCH_*`           | database lease + fence counter            |
| Notification delivery     | own `setInterval`, `NOTIFICATION_WORKER_*`        | outbox claim + `SKIP LOCKED`              |

The supervisor attaches to each tick as an **observer**. It wraps the call, records timing and outcome, and
returns the result untouched. It never starts, stops, re-times, or retries anything.

The integration is deliberately optional: each worker holds a nullable supervisor reference, and when it is
absent the tick runs exactly as before. Supervision must never be a precondition for financial work.

---

## 2. What the supervisor answers

`GET /api/v1/internal/workers` (behind `diagnostics.view`, the same permission as `/internal/diagnostics` —
no new catalogue permission was invented).

Per worker:

| Field                               | Meaning                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `enabled`                           | Whether configuration enables it **in this process** |
| `scheduled`                         | Whether a driver is attached here                    |
| `pollIntervalMs`                    | The configured interval, not a default guess         |
| `lastStartedAt` / `lastCompletedAt` | When, per this instance                              |
| `lastDurationMs`                    | How long the last tick took                          |
| `consecutiveFailures`               | Current failure streak                               |
| `totalCompleted` / `totalFailed`    | Since process start                                  |
| `state`                             | See below                                            |
| `activityObserved`                  | **False means nothing was measured**                 |

### 2.1 States

| State                 | Meaning                                                    | Operator action            |
| --------------------- | ---------------------------------------------------------- | -------------------------- |
| `DISABLED`            | Configured off. Nothing measured.                          | None — this is a decision  |
| `AWAITING_FIRST_TICK` | Enabled, no tick observed yet. **Not health.**             | Investigate if it persists |
| `HEALTHY`             | Recent successful completion.                              | None                       |
| `STALE`               | A tick that should have completed has not.                 | Investigate                |
| `FAILING`             | The last tick threw. Still scheduled, not completing work. | Read `lastError`           |

### 2.2 The aggregate status

- `ok` — at least one worker observed, every enabled worker observed and healthy.
- `degraded` — something is `FAILING` or `STALE`.
- `indeterminate` — **nothing was measured**, or an enabled worker has never ticked.

`indeterminate` is the important one. A supervisor that reports `ok` when every worker is switched off is
worse than no supervisor: it converts an unmeasured system into an apparently-checked one. This is asserted
in `test/worker-supervision.spec.ts`, including the case where all four are disabled.

`disabled` and `neverObserved` are reported as **separate lists**. They share the property of having measured
nothing, but the operator action is opposite: one is a configuration decision, the other is a fault.

### 2.3 Staleness is measured, not assumed

A worker is stale when `now - lastCompletedAt > pollIntervalMs × 3`. Three intervals, because one missed poll
is jitter or a slow batch and three is a pattern. The multiplier is a constructor argument, and the clock is
injectable so the behaviour is tested without sleeping.

---

## 3. Configuration is not duplicated

The registry reads the **same environment keys through the same `ConfigService`** as each worker. A second
set of supervisor-specific keys would let the registry and the worker disagree about whether that worker is
running — and the registry's answer would look authoritative while being wrong.

One subtlety, recorded because it was a real mistake during development: banking's interval key is
`BANKING_DISPATCH_POLL_INTERVAL_MS`, **not** `BANKING_DISPATCH_WORKER_POLL_INTERVAL_MS` like the other three.
The first draft of the registry guessed the uniform pattern. That failure is silent — the registry reports a
default while the worker runs on a configured value — so the exact key strings are pinned in a test.

Banking enablement is also not the obvious rule. Its module factory enables dispatch when
`BANKING_DISPATCH_WORKER_ENABLED` is unset **and** `BANKING_ENABLED` is on outside tests. The registry mirrors
that resolution rather than reading one key, and both branches are tested.

---

## 4. What the supervisor cannot see

Stated because the payload could otherwise be over-read:

- **It is process-local.** It reports this instance. It does not know whether another instance is alive.
- **It is not a liveness proof for the queue.** A worker can be `HEALTHY` — ticking successfully — while the
  queue is not draining, because every tick finds nothing to do. Whether _work is progressing_ is a property
  of the database (queue depth, lease expiry, dead-letter count), not of this report.
- **It says nothing about external submission outcomes.** A tick can complete successfully and the provider
  can still reject the request. Provider outcomes live in the operation lifecycle, not here.
- **It does not measure recovery.** Declared recovery objectives (Group 13) and measured recovery
  performance remain distinct; nothing here observes an actual RPO or RTO.

---

## 5. What is not automated

- **No fleet-wide scheduler, no leader election, no distributed cron.** Each instance runs its own timers.
  That is safe because correctness rests on the database mechanisms in §1, not on one instance being chosen.
  Adding leader election would be a second authority over the same concern.
- **Staleness is not alerting.** There are no thresholds wired to a notification channel; the report is
  pull-only. Group 19 (alerting) and Group 17 (metrics export) own that.
- **No retry policy lives in the supervisor.** Retries belong to each worker: banking uses a bounded attempt
  count with a lease, the outbox uses the Group 14 ceiling and dead-letter state. A supervisor that retried
  would bypass those bounds.
- **No automatic restart of a failing worker.** A `FAILING` worker stays scheduled and keeps trying on its
  own interval; the report makes the failure visible rather than attempting repair.
- **No back-pressure.** If a batch takes longer than the interval, the worker's own overlap guard skips the
  next tick, and the supervisor records the long duration. Nothing here tunes batch size.

None of the above is claimed as implemented. Each is named with the group that owns it.
