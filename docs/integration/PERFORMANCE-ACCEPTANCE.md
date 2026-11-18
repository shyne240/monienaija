# Performance acceptance

Group 28. Scope: what can honestly be concluded about performance from this environment, and what cannot.

## The trap this group refuses

There was no performance harness at all. The obvious deliverable is a table of numbers — "p99 transfer latency
84 ms", "1,900 requests/second" — presented as acceptance evidence.

Every one of those numbers would be fabricated. This environment is a single Postgres instance on one machine,
with synthetic data, no network, no connection-pool contention, no concurrent load and no second application
node. A latency figure measured here describes this machine. Publishing it as acceptance evidence would be the
performance equivalent of an alert channel reporting a delivery it never performed.

So this group measures the one performance property that **is** the same in production as it is here: **the query
plan**.

## Why plan shape transfers and timing does not

A statement that sequentially scans a table at 1,000 rows sequentially scans it at 10 million rows. The plan is a
property of the schema, the indexes and the query text — all of which are identical between this environment and
production. What changes is how long the same plan takes, and that depends entirely on hardware that is not
represented here.

"Does this hot query use an index?" therefore has a truthful answer here. "How fast is it?" does not.

## What is measured

Eight hot paths the application actually issues, each with the index it must use:

| Hot path                          | Why it is hot                                           |
| --------------------------------- | ------------------------------------------------------- |
| `audit-by-entity`                 | every detail page and every investigation               |
| `audit-by-time-range`             | the evidence export (Group 23 keyset paging)            |
| `transfer-by-idempotency-key`     | the idempotency replay check on every transfer          |
| `ledger-lines-by-journal`         | every statement and reconciliation read                 |
| `outbox-due-events`               | the outbox worker claim query — scanned on _every tick_ |
| `notification-deliveries-pending` | the notification worker claim query                     |
| `disputes-by-customer`            | the duplicate-dispute check when a dispute is opened    |
| `fraud-findings-open`             | read on every operations-centre request                 |

`outbox-due-events` deserves emphasis: it runs once per worker tick regardless of whether there is work. A
sequential scan there is not a slow page, it is a permanent tax on the whole system.

## Three rules that keep the report honest

**1. A small table is `NOT_MEASURED`, never `PASS`.** Postgres correctly prefers a sequential scan on a small
table. Measuring a plan at 12 rows and reporting a pass would claim a plan was validated when the planner was
never under realistic cardinality. Each hot path declares a `minRows` threshold; below it the finding is
`NOT_MEASURED` with the row count and the reason. The harness _seeds_ bounded volume in the test so real plans are
obtained, but it will not pretend when it has not.

**2. Parameters are realistic values, never `NULL`.** This is the subtlest failure and it bit during
development. Substituting `NULL` for `$1` is convenient, and it silently destroys the measurement: the planner
sees `entity_type = NULL`, proves the predicate can never be true, and returns a bare `Result` node that touches
no table. The harness then "measures" a plan that never scans anything and reports a pass.

**Verified by mutation:** forcing every parameter to `NULL` failed exactly the four plan-shape tests and nothing
else. Real values are literally load-bearing. (`PREPARE`/`EXECUTE` was tried first and does not work: Postgres
rejects bound parameters in an `EXECUTE` argument list, so the values have to be in the statement text.)

**3. `EXPLAIN` without `ANALYZE`.** The harness plans queries; it never executes them. That makes it safe to run
against a database holding real data, which is when someone would actually want to run it.

## The harness can fail

A harness that cannot fail is not a harness. With 1,200 seeded audit events the entity lookup passes using
`idx_audit_events_entity_time`; dropping that index makes the same query report `ERROR` with a sequential scan
and takes the aggregate verdict with it. That is asserted, not assumed.

The report also confirms the range index added in Group 23 (`idx_audit_events_occurred_at`) is the one the
evidence export actually uses — an index nobody uses is just write amplification.

## Aggregate verdict

`ERROR` if any measured hot path seq-scans. `WARNING` if anything could not be measured. `PASS` only when every
hot path was measured and used an index. A `WARNING` never reads as a pass.

## What is explicitly not measured

Recorded in the report's `notMeasured` list rather than silently omitted:

- **Latency and throughput.** Not representative of production hardware, topology or load. No number is
  produced, and there is a structural test asserting the report contains no timing field and no latency or
  throughput value.
- **Concurrency and contention.** One connection pool on one machine cannot reproduce lock contention under
  concurrent transfers.
- **Worker tick cost under a real backlog.** The claim queries are planned, but the cost of a full outbox drain
  is a runtime property.
- **Index bloat and write amplification.** Needs weeks of real write traffic.
- **End-to-end user-perceived latency.** Needs a real network and a real browser; Group 31's browser acceptance
  covers correctness, not timing.
- **Connection-pool sizing.** A capacity decision that depends on the production topology, which is not known
  here.

## How to use it

Run against a database seeded with representative volume; every hot path should report `MEASURED` and `PASS`. Any
`ERROR` names the offending table and the plan node. Any `WARNING` names why it could not measure — treat it as a
gap to close, not as success.

## Honest summary

This accepts **plan shape and index coverage**, which are real and transferable. It does **not** accept latency,
throughput, capacity or concurrency, because those cannot be established here, and it says so in the output
rather than in a footnote.
