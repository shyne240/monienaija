# Integrity Monitoring

ARENA 3D Group 18. Covers how financial integrity is verified, how results are retained, and how to tell a
new problem from a known one.

This document does not claim that any alerting, paging or remediation is automated. §5 states what is not
implemented.

---

## 1. What already existed

The ledger is protected at write time, and that protection is real:

- `assert_ledger_journal_balanced` — a database trigger that refuses to commit a journal whose lines do not
  sum to its total, wrong currency, or a negative account balance.
- `reject_ledger_mutation` — journals and lines are immutable once posted.
- `ReconciliationService` — **eleven** cross-table checks: journal balance, line/account integrity,
  orphaned entries, wallet balances derived from the ledger, currency and accounting-unit consistency,
  customer financial account bindings, verified inbound without a resolution, completed payment journals,
  failed transfer attempts, and wallet liability account ownership.

Verified against a real database: all eleven return `PASS` on a clean schema.

## 2. What was missing

`runReconciliation()` was **stateless**. It returned a report and persisted nothing. Three consequences:

| Question                                                  | Answerable before |
| --------------------------------------------------------- | ----------------- |
| "Is the ledger balanced right now?"                       | Yes               |
| "Was it balanced yesterday, and when did it stop?"        | **No**            |
| "Is this failure new, or has it been failing for a week?" | **No**            |

The third is the one that costs money. A system showing `ERROR` on `journal_balance_integrity` after a week
of `ERROR` is a known problem being worked. The same check flipping from `PASS` to `ERROR` between two runs
is a **new incident** and is far more urgent. From a single report the two are identical.

---

## 3. What Group 18 adds

### 3.1 Durable, append-only snapshots

`integrity_snapshots` (one row per run) and `integrity_check_results` (one row per check per run).
Append-only is enforced by a **database trigger**, not only by convention — the evidence used to decide
whether a drift is new must not be editable. `UPDATE` and `DELETE` are refused with
`restrict_violation`.

Each check result stores a `finding_count`, because "3 mismatches" and "3000 mismatches" call for very
different responses and a bare `ERROR` loses that.

### 3.2 Drift detection

| Yesterday | Today     | `change`         | Meaning                                  |
| --------- | --------- | ---------------- | ---------------------------------------- |
| `ERROR`   | `ERROR`   | —                | Known, stable problem                    |
| `PASS`    | `ERROR`   | `newly-failing`  | **New incident**                         |
| `PASS`    | `WARNING` | `newly-degraded` | **New degradation**                      |
| `ERROR`   | `PASS`    | `recovered`      | Recovery — confirm it holds              |
| —         | any       | `new`            | First ever observation, not a regression |

`regressionDetected` is true only for `newly-failing` and `newly-degraded`. **This is the field an alert
should key on, not the aggregate status** — a system that has been failing for a week must not page on every
run, or the alert is muted within a day and stops working.

A check seen for the first time is reported as `new`, not as a regression. Treating first sight as
regression would fire on every deployment that adds a check.

### 3.3 "When did this last pass?"

```sql
SELECT r.check_name,
       max(s.observed_at) FILTER (WHERE r.status = 'PASS') AS last_passed_at
  FROM integrity_check_results r JOIN integrity_snapshots s ON s.id = r.snapshot_id
 GROUP BY r.check_name;
```

Exposed at `GET /api/v1/internal/integrity/last-passes`.

---

## 4. Endpoints

All behind `diagnostics.view` — the same permission as `/internal/diagnostics`, no new catalogue permission.

| Route                                     | Purpose                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `GET /internal/integrity`                 | Run checks, record a snapshot, return verdict + drift |
| `GET /internal/integrity/history?limit=N` | Recent snapshots, newest first                        |
| `GET /internal/integrity/last-passes`     | Per check: last status and when it last passed        |

**Recording is deliberate, not incidental.** A check evaluated only when someone looks is unmeasured
between looks, and the history that makes drift meaningful never accumulates.

---

## 5. Operating it

1. **On `regressionDetected: true`** — read `drift[]` for the check and its `findingCount`. A newly-failing
   balance check is an incident, not a backlog item.
2. **On a stable `ERROR`** — confirm it is being worked. `last-passes` shows how long it has been failing;
   if that window is long, the problem is not new but the response may have stalled.
3. **On `recovered`** — confirm the recovery holds for at least two runs before closing. A check that
   alternates is worse than one that fails, because it hides.
4. **On `snapshot: null`** — the run was evaluated but **not recorded**. `record()` never throws, because a
   reconciliation probe also runs inside readiness and diagnostics; failing those because the _history_
   table is unavailable would turn an observability problem into an availability problem. Treat a null
   snapshot as "history is incomplete", not as "integrity is fine".

### 5.1 What is not implemented

- **No scheduled evaluation.** Snapshots are recorded when the endpoint is called. A cron or worker that
  calls it on an interval is Group 15's supervision model applied to a new consumer and is not wired here.
- **No alerting.** `regressionDetected` is returned; nothing sends it anywhere. Group 19.
- **No automatic remediation or repair.** Nothing in this group mutates business data — every check runs in
  a read-only transaction. A repair requires a human decision and an audited path.
- **No retention or archival.** Snapshots grow without bound; pruning is a deployment policy that must
  respect the append-only trigger (a partition drop or an explicit archival step, not a `DELETE`).
- **No external verification.** These checks compare the application's own tables to each other. Whether a
  provider's ledger agrees is external reconciliation, a different service.
- **Snapshots are not evidence of production history.** Nothing here has been run against a production
  database; the behaviour is verified against disposable fixtures only.

None of the above is claimed as working.
