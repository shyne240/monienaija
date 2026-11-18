# Operations Centre

ARENA 3D Group 20. One ranked view of what needs attention, aggregated from the signals built in Groups
14–19.

This document describes a **read surface**. No remediation, acknowledgement or resolution is offered, and
that is deliberate — see §4.

---

## 1. Why it exists

By Group 19 the system could answer many specific questions, each behind its own endpoint: queue depth, dead
letters, stalled leases, per-worker state, supervision status, integrity drift, alert conditions. An operator
starting a shift had to know which of a dozen endpoints to call, in what order, and how to combine the
answers.

That is a filing cabinet, not an operations centre.

`GET /api/v1/internal/operations-centre` returns a single ranked list of things that need attention, plus an
explicit statement of what could not be determined.

---

## 2. The rule that shapes it

**Nothing here decides anything new.** Every item is derived from the service that already owns the verdict:

| Item area     | Source                                    | Group |
| ------------- | ----------------------------------------- | ----- |
| `INTEGRITY`   | `IntegrityMonitoringService.lastPasses()` | 18    |
| `QUEUE`       | `WorkerLeaseService.health()`             | 14    |
| `WORKER`      | `WorkerSupervisorService.report()`        | 15    |
| `SUPERVISION` | `AlertingService.evaluate()`              | 19    |

Re-deriving a verdict here would create a second source of truth that can disagree with the endpoint an
operator is simultaneously looking at — and the operator would have no way to know which was right. The
centre ranks and presents; it does not adjudicate.

---

## 3. Reading the response

```jsonc
{
  "clear": false,
  "partial": true,
  "items": [
    /* ranked: IMMEDIATE → ROUTINE → INFO, then CRITICAL → WARNING → INFO */
  ],
  "unavailable": [{ "area": "...", "reason": "..." }],
  "counts": { "immediate": 2, "routine": 4, "info": 0 },
  "scope": "Read-only aggregation...",
}
```

### 3.1 `clear` means measured-and-clear

`clear: true` requires **both** an empty `items` list **and** an empty `unavailable` list.

A view reporting `clear` while a source was unreadable is the same failure as a supervisor reporting healthy
when it measured nothing: it converts an unmeasured system into an apparently-checked one. When any source
fails, `partial` is `true` and the area is named with a reason.

### 3.2 One condition, one item

Duplicate entries are how an operator learns to distrust a list, so the centre suppresses them:

- the dead-letter backlog appears once (`queue:dead-letters`), not again as `alert:outbox.dead-letters`;
- an indeterminate supervision state appears once, not as both a supervisor item and an alert;
- a failing worker appears once, under `worker:<name>:FAILING`, not again as a generic alert.

Two of these were real duplicates found by inspecting actual output during development, and both now have
regression tests.

### 3.3 Ids are stable across polls

`integrity:journal_balance_integrity`, `queue:dead-letters`, `worker:notification-delivery:STALE`. An id that
changed per poll would make a UI flicker and make "is this the same problem?" unanswerable — which is exactly
the question drift detection (Group 18) exists to answer.

### 3.4 Passing checks are not listed

A passing integrity check is not an item needing attention. Listing it would bury the failing ones.

---

## 4. Read-only, and why

There is no acknowledge, resolve, retry, requeue or replay here. Those are **audited write paths** that
require their own authority decision (Groups 21–22), and each carries real risk — requeueing a dead letter
re-submits an external operation; "resolving" an integrity failure without fixing the data hides it.

A test asserts the service has exactly one method (`view`). If someone adds a mutation surface, that test
fails and the authority question gets asked rather than assumed.

---

## 5. What is not implemented

- **No write actions.** By design; see §4.
- **No history or trend.** The centre reports _now_. Integrity history is Group 18's endpoint; alert
  suppression state is Group 19's.
- **No alert delivery.** `unavailable` reflects rules the evaluator reported as not-evaluated; nothing is
  sent anywhere.
- **No financial figures.** Reconciliation status, unresolved funds and ledger totals live in their own read
  surfaces, which have their own permissions. Aggregating money into an operations view would widen access to
  it.
- **No scheduling.** The view is computed when requested.
- **No UI.** This is the API. Whether an admin-web screen consumes it is not part of this group.

None of the above is claimed as working.
