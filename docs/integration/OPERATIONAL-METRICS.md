# Operational Metrics

ARENA 3D Group 17. Covers what is measured, what is exposed, and — importantly — what a metric's absence
means.

This document does not claim that a metrics platform, scraper, dashboard or alerting pipeline is deployed.
It describes the emitting side only.

---

## 1. The gap

Groups 14 and 15 built real observability primitives, and nothing consumed them:

| Built in | Method                                                                      | Callers before Group 17               |
| -------- | --------------------------------------------------------------------------- | ------------------------------------- |
| Group 14 | `WorkerLeaseService.health()` — pending, dead-lettered, stalled, oldest age | **none**                              |
| Group 14 | `WorkerLeaseService.deadLetters()`                                          | **none**                              |
| Group 15 | `WorkerScheduler.report()` — per-worker state                               | `/internal/workers` only (human pull) |

A signal that is computable but never collected is not observability. It is dead code with a comment
claiming otherwise. The dead-letter queue — the mechanism Group 14 added so a poison event could never
retry forever — was invisible unless an operator ran a query by hand.

---

## 2. Endpoints

Both behind `metrics.view`, the same permission as `/internal/metrics`. No new catalogue permission was
invented and no anonymous scrape route was added.

| Route                                      | Returns                                            |
| ------------------------------------------ | -------------------------------------------------- |
| `GET /api/v1/internal/operational-metrics` | JSON snapshot with `samples[]` and `unavailable[]` |
| `GET /api/v1/internal/metrics/prometheus`  | Prometheus text exposition (0.0.4)                 |

### 2.1 Metrics

| Metric                              | Type    | Labels   | Meaning                                               |
| ----------------------------------- | ------- | -------- | ----------------------------------------------------- |
| `outbox_pending`                    | gauge   | —        | Events awaiting delivery                              |
| `outbox_dead_lettered`              | gauge   | —        | Events that exhausted the ceiling; never retried      |
| `outbox_stalled_leases`             | gauge   | —        | Claimed events whose lease expired — a crashed worker |
| `outbox_oldest_pending_age_seconds` | gauge   | —        | Age of the oldest pending event (0 when empty)        |
| `worker_enabled`                    | gauge   | `worker` | Configured on (1) or off (0) in this process          |
| `worker_activity_observed`          | gauge   | `worker` | Any tick observed at all                              |
| `worker_consecutive_failures`       | gauge   | `worker` | Current failure streak                                |
| `worker_last_duration_ms`           | gauge   | `worker` | Duration of last completed tick                       |
| `worker_ticks_completed_total`      | counter | `worker` | Successful ticks since process start                  |
| `worker_ticks_failed_total`         | counter | `worker` | Failed ticks since process start                      |
| `worker_supervision_status`         | gauge   | `status` | One-hot: `ok` / `degraded` / `indeterminate`          |

Labels are restricted to `worker` (a fixed name from a closed set) and `status`. **No identifier ever
appears in a label** — not a customer, operation, or correlation id. This is both a cardinality limit and a
privacy boundary, and it is asserted in the suite.

---

## 3. Two rules that make these metrics usable

### 3.1 A missing metric is not a zero metric

`unavailable[]` names every signal that could not be collected. Verified against a real database with no
`outbox_events` table:

```
unavailable: [{ signal: "outbox", reason: "outbox queue state could not be read" }]
outbox samples: 0
worker samples: 27
```

The queue gauges are **absent**, not zero. A dashboard that shows "0 dead letters" during an incident when
the truth is "cannot read the dead-letter table" is actively harmful, and that is exactly the failure this
shape prevents.

Sources are collected independently: a database problem removes the queue series and leaves the worker
series intact. During an incident the worker signal is often the more useful half, so an endpoint that 500s
because one source failed would remove the wrong information.

### 3.2 Fleet-wide and process-local signals are different

| Signal     | Scope             | Why                                                      |
| ---------- | ----------------- | -------------------------------------------------------- |
| `outbox_*` | **Fleet-wide**    | Read from PostgreSQL; every instance sees the same queue |
| `worker_*` | **Process-local** | Observation of one instance's timers                     |

Mixing them without labelling would let a dashboard average away a dead instance. `worker_activity_observed: 0`
means _this process measured nothing_ — it is not evidence that the worker is down everywhere, and it is not
evidence that it is up.

---

## 4. Failure modes to expect

| Observation                                                                 | Likely cause                                                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outbox_dead_lettered` rising                                               | A permanent failure (bad account, contract change) or a provider outage past the ceiling. Read the DLQ; see the Group 14 runbook.                        |
| `outbox_stalled_leases` > 0 and rising                                      | A worker is dying mid-delivery. The lease expires and the row is reclaimable, so work is not lost — but it is being repeated.                            |
| `outbox_oldest_pending_age_seconds` climbing while `outbox_pending` is flat | Nothing is claiming. Check `worker_activity_observed` and `worker_supervision_status` **in each instance**.                                              |
| `worker_supervision_status{status="indeterminate"} 1`                       | No worker was observed at all in that process. Either everything is disabled, or the process is not the one running the timers. **This is not healthy.** |
| `worker_ticks_failed_total` climbing for one worker                         | That worker's own error path; read its logs (Group 16 keeps them redacted).                                                                              |

---

## 5. What is not implemented

- **No exporter, scraper, dashboard, or retention.** `prometheus()` renders text on request. Who scrapes
  it, how often, and where samples are stored is deployment configuration.
- **No histograms.** Only gauges and counters; `worker_last_duration_ms` is the latest observation, not a
  distribution. Percentiles are not available and are not claimed.
- **No alerting.** Every threshold in §4 is a human reading. Wiring them to a channel is Group 19.
- **No cardinality management beyond fixed label sets.** This is sufficient because the label domain is a
  closed set; if a future metric needs a dynamic label, that becomes a design question.
- **No metric for financial outcomes.** Reconciliation status, unresolved funds and ledger totals are
  separate read surfaces; they are not duplicated here.
- **`GET /metrics/prometheus` requires authentication.** Whether an unauthenticated scrape path should exist
  is a deployment and security decision, not one this group makes.

None of the above is claimed as working.
