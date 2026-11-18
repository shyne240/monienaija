# Alerting

ARENA 3D Group 19. Covers what conditions are evaluated, how severity and urgency differ, and how repeated
and flapping conditions are suppressed.

**No alert has been delivered to any human by this system.** The default channel records and delivers
nothing, and no vendor is selected. That is a deliberate posture, not an unfinished part — see §5.

---

## 1. Severity is not urgency

The single most useful distinction in this design.

|              | Answers                              | Values                           |
| ------------ | ------------------------------------ | -------------------------------- |
| **Severity** | How bad is the condition?            | `INFO` / `WARNING` / `CRITICAL`  |
| **Urgency**  | Should this interrupt someone _now_? | `IMMEDIATE` / `ROUTINE` / `INFO` |

Two examples from the rules, both tested:

- **40 dead letters** → `CRITICAL` severity, **`ROUTINE`** urgency. It is severe, but a stable backlog is a
  known condition. Paging on it every evaluation is how a channel gets muted within a week — and a muted
  channel also hides the incident that matters.
- **1 stalled lease** → `CRITICAL` severity, **`IMMEDIATE`** urgency. The count is tiny; the condition is
  that a worker is dying mid-delivery _right now_.

Collapsing severity into urgency produces either a channel that cries wolf or one that under-reports.

---

## 2. Rules

| Rule                               | Source                              | Severity                   | Urgency                       |
| ---------------------------------- | ----------------------------------- | -------------------------- | ----------------------------- |
| `outbox.dead-letters`              | Group 14 DLQ                        | CRITICAL ≥10, else WARNING | ROUTINE                       |
| `outbox.stalled-leases`            | Group 14 leases                     | CRITICAL                   | IMMEDIATE                     |
| `outbox.backlog`                   | Group 17 metrics                    | WARNING                    | ROUTINE                       |
| `worker.failing`                   | Group 15 supervision                | WARNING                    | IMMEDIATE after 3 consecutive |
| `worker.stale`                     | Group 15 supervision                | CRITICAL                   | IMMEDIATE                     |
| `worker.supervision-indeterminate` | Group 15                            | WARNING                    | ROUTINE                       |
| `integrity.stale-failure`          | Group 18 history                    | CRITICAL                   | ROUTINE                       |
| `integrity.regression`             | Group 18, at the integrity endpoint | —                          | —                             |

`integrity.regression` is **not emitted here**. Regressions come from `/internal/integrity`, which performs
the drift comparison. Re-running reconciliation inside the alert evaluator would make alerting a second
caller of a read-only scan, with its own cost and failure modes, and a second source of integrity truth. The
evaluator reports it as `skipped` with that reason rather than pretending to cover it.

### 2.1 Backlog thresholds are configuration

`outbox.backlog` fires only when a depth or age tolerance is configured. With neither set the rule is
**satisfied** and the runbook says so explicitly. Inventing a backlog threshold would be inventing an
operational policy nobody agreed to.

---

## 3. Two suppressions, both necessary

### 3.1 Deduplication keys the condition, not the occurrence

`dedupeKey` is `worker.stale:banking-dispatch` — a **condition** identifier. The same condition re-observed
is one alert with a repeat counter, not two alerts. If the key included a timestamp or an observation id,
every evaluation would be a new alert and deduplication would accomplish nothing.

### 3.2 Flapping suppression

A condition that clears and returns within `flapWindowMs` (default 5 minutes) is the **same incident**. An
oscillating check otherwise produces a stream nobody reads, and trains operators to ignore the channel.

After the window elapses, the condition re-alerts. A resolved-then-recurring problem is genuinely new
information at that point.

---

## 4. Silence is never ambiguous

Three distinct states, and the payload keeps them distinct:

| Observation           | Meaning                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| Rule in `satisfied`   | Checked, healthy                                                            |
| Rule in `skipped`     | **Could not be checked** — with the reason                                  |
| Alert in `suppressed` | Condition active and already reported                                       |
| Nothing at all        | Should not happen; a rule neither satisfied, skipped, nor alerting is a bug |

`GET /internal/alerts` reports `satisfied` and `skipped` alongside `alerts`. `GET /internal/alerts/active`
lists currently-suppressed conditions. Without the latter, "no alert" and "alert suppressed as an ongoing
condition" look identical from outside, and an operator cannot tell whether the system is quiet or muted.

Each source is evaluated independently: a database failure silences the outbox rules and leaves the worker
rules running, because the worker signal usually explains the database problem.

---

## 5. Delivery

`AlertChannel` is a seam with a **dark default**. `NoneAlertChannel` records the alert and returns
`delivered: false` with the reason "no alert channel is configured". An unconfigured deployment therefore
never appears to have paged anyone.

`deliveryConfigured` and `channel` are included in every response so a caller cannot mistake an evaluation
for a notification.

### 5.1 What is not implemented

- **No vendor integration.** No PagerDuty, Slack, Opsgenie or SMTP webhook adapter exists. Which product to
  use and what it costs is the product owner's decision; inventing an integration would also invent an
  entitlement.
- **No delivery guarantee, retry, or dead-letter for alerts.** A failed delivery is reported in
  `dispatched[].reason` and then forgotten. Alert delivery is not transactionally important in the way event
  delivery is, and building a retry loop for it without knowing the channel would be guesswork.
- **No escalation policy, on-call rotation, or acknowledgement.** Those live in whatever paging product is
  eventually chosen.
- **No scheduled evaluation.** Alerts are evaluated when the endpoint is called. A timer calling it on an
  interval is Group 15's supervision model applied to a new consumer and is not wired.
- **No push path for `integrity.regression`.** The evaluation that produces it is on the integrity endpoint;
  connecting that to the alert state is not implemented.
- **Suppression state is in-process.** It is not shared across instances, so two instances each deduplicate
  independently. For a single-instance deployment that is correct; for a fleet it would double-report. That
  limitation is named rather than hidden.

None of the above is claimed as working.
