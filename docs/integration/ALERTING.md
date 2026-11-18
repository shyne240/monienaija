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

---

## Group 38 — delivery: from a seam to a signed webhook

Until this group the delivery seam had exactly one implementation, `NoneAlertChannel`, which reported
`delivered: false` with a reason. That was the correct default — an unconfigured deployment must not appear to have
paged anyone — but it means **no alert had ever left the process**. "Alerting works" was a statement about
evaluation, suppression and deduplication, and nothing else.

`src/operations/alert-webhook.channel.ts` adds the missing implementation.

### Configuration

| Setting                    | Behaviour                                                                 |
| -------------------------- | ------------------------------------------------------------------------- |
| neither set                | `NoneAlertChannel`: evaluated and recorded, nobody paged, and the report says so |
| `ALERT_WEBHOOK_URL` + `ALERT_WEBHOOK_SECRET` | a signed HTTPS webhook                                          |
| only one of the two        | **throws at startup** — half-configured must not run dark while claiming to be on |
| `ALERT_WEBHOOK_TIMEOUT_MS` | default 5000; a non-positive or unparseable value throws                   |

URLs must be `https`. Plain `http` is accepted only for a loopback host outside production, which is what the local
receiver in the test uses — an alert body names outages, queues and failures, so a cleartext one is an intelligence
feed for anyone on the path.

### What the receiver gets

```
POST <url>
content-type: application/json
x-monienaija-timestamp: 1700000000000
x-monienaija-signature: sha256=<hex HMAC-SHA256 over `${timestamp}.${body}`>

{"dedupeKey":"…","ruleId":"…","severity":"CRITICAL","urgency":"IMMEDIATE","summary":"…","observedAt":"…","context":{…}}
```

`verifyAlertSignature` is exported so a receiver checks the **exact bytes** the sender signed, not a
re-serialisation — key order, whitespace and unicode escaping would otherwise differ and a valid alert would be
rejected. It also enforces a timestamp window (default 300s), because a signature that is valid forever is a
signature in name only.

### Why `delivered` is not a guess

`delivered: true` means the receiver answered 2xx. A non-2xx, a timeout, a DNS failure or a TLS refusal is
`delivered: false` with the reason, which `AlertingService` records in `dispatched[].reason`. A channel that
returned `true` on a failed POST would make the alerting system lie at exactly the moment it exists to be honest.

### Proven, over a real socket

`test/alert-delivery.spec.ts` — 12 cases. The receiver is a real `node:http` server on `127.0.0.1`, so the
request, the headers, the HMAC over the raw body and the status code are all genuine: delivery to a 204, signature
verification, tampered body / wrong secret / replayed timestamp all rejected, `503` reported as not delivered,
a receiver that never answers reported as a timeout, and an unreachable port reported as a failure. Configuration
cases cover the dark default, the half-configured refusal, the cleartext refusal and a nonsense timeout.

### What this still does not do — unchanged, and now stated more narrowly

- **No paging provider, on-call system or human was contacted.** Delivery is proven to a receiver in this
  repository, not to PagerDuty, Opsgenie or a phone.
- **No retry, no dead-letter, no escalation.** A failed delivery is reported in `dispatched[].reason` and then
  forgotten. There is no acknowledgement, no on-call rotation and no scheduled evaluation; alerts are evaluated
  when the endpoint is called.
- **No receipt beyond the HTTP status.** A 204 means the receiver accepted it, not that a human saw it.

The release blocker was therefore **narrowed, not removed**: `alert_delivery_unproven` became
`alert_delivery_not_observed_against_a_real_channel`.
