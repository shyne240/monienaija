# Ordinary Agent V1 — Cash-to-Cash expiry execution (OA-40)

## Scope and baseline

Assignment: completion backlog B1 / finding G1 / requirement OA-40: production execution of the existing expiry sweep. Exact integrated baseline `b8a5b94ee55aad7407dd78068428b3e97236ce8e` was fetched and safely incorporated on `arena/92fd33dd-monienaija`, retaining prior history. No reset, rebase, force-push, main merge, deployment or production migration execution.

**Audit-source limitation:** `docs/ordinary-agent-v1/completion-audit-20261027/` is absent from that baseline and the resulting checkout. B1/G1/OA-40 identifiers come from the assignment, not independently reviewed audit files. This report supplies implementation evidence for the described execution gap; it does not claim formal closure of an unavailable audit or approval of expired-funds disposition.

## Implementation and financial boundary

- `src/agent/agent-cash-to-cash-expiry-worker.service.ts`: Nest lifecycle provider registered in `AgentModule`, using the existing notification-worker pattern (config opt-in, background timer, bounded ticks, in-process non-overlap). Startup immediately sweeps persisted due work, then polls. One batch per tick; there is no unbounded backlog-drain loop.
- `src/agent/agent-cash-to-cash-expiry.service.ts`: existing SERIALIZABLE sweep with bounded serialization/deadlock retries and `FOR UPDATE SKIP LOCKED`. Expiry, deterministic ordering (`expires_at`, `created_at`, `id`) and audit insertion occur in one transaction. Production sweep cutoff uses PostgreSQL time, not host time. Explicit `now` remains available to existing tests/internal callers; the worker never supplies it.
- Worker transactions set transaction-local PostgreSQL statement and idle-in-transaction timeouts. Limits/timeouts are validated. A failed transaction rolls back and remains eligible next poll. These are **per-statement/database-idle bounds, not a hard wall-clock deadline for a complete batch or a broken network connection**.
- `src/main.ts`: SIGTERM/SIGINT shutdown hooks enabled. Worker stops scheduling, disallows further ticks and awaits the active batch before database teardown. Sudden process termination relies on PostgreSQL transaction rollback/recovery. No cursor, lease, external queue or migration is required.
- Multiple enabled application instances are supported: row locks and atomic state/audit updates are the cross-process safety boundary. The in-memory running flag only suppresses same-instance overlap. Replays select only due UNCLAIMED rows; committed EXPIRED rows do not receive another expiry audit. Claim and expiry retain the existing shared transfer-row locking rules.

**Expiry changes lifecycle and audit only. It creates no journal, refunds no Agent, credits no beneficiary, and does not release or redistribute money.** Principal remains in the existing `CASH_TO_CASH-UNCLAIMED-NGN` liability. CUSTOMER_WALLET and AGENT_CASH accounting/settlement models are unchanged. No new event publication, notification template or beneficiary SMS was introduced. Expired-funds disposition remains an owner decision. Existing initiation expiry duration and claim-time deadline enforcement are unchanged.

## Configuration and startup

All settings go through the existing validated environment/ConfigService pipeline:

| Setting | Default | Accepted values |
| --- | --- | --- |
| `CASH_TO_CASH_EXPIRY_WORKER_ENABLED` | `false` | literal `true` or `false` |
| `CASH_TO_CASH_EXPIRY_WORKER_POLL_INTERVAL_MS` | `60000` | integer 1000–3600000 |
| `CASH_TO_CASH_EXPIRY_WORKER_BATCH_SIZE` | `100` | integer 1–1000 |
| `CASH_TO_CASH_EXPIRY_WORKER_STATEMENT_TIMEOUT_MS` | `10000` | integer 100–60000 |

Enable only after operational authorization. Set `CASH_TO_CASH_EXPIRY_WORKER_ENABLED=true` in the application environment and restart through the normal deployment supervisor. Use the normal built backend (`npm run build`, then `npm start`); no second executable or cron service is needed. Example defaults are in `.env.example`. Application availability is required: this in-process worker does not run while all application instances are down. A subsequent startup catches up due persisted rows.

Start with one enabled instance if controlling expiry throughput is important; each enabled replica can process one batch per interval. Replicas are correctness-safe, but aggregate throughput/load increases with replica count. A full batch is not proof that the backlog is empty. Increase capacity only with database monitoring. Existing SERIALIZABLE retries are bounded per tick; subsequent polls retry failed work indefinitely without losing due rows.

## Monitoring and recovery

Structured Nest log payloads (route through the existing application log pipeline):

- `c2c_expiry_worker_disabled`, `c2c_expiry_worker_started` (interval), `c2c_expiry_worker_stopped`.
- `c2c_expiry_tick_started`: correlation ID and limit.
- `c2c_expiry_tick_completed`: same correlation ID, committed expired count, limit, batchFull and durationMs; zero-count successes are logged too.
- `c2c_expiry_tick_failed`: correlation ID, durationMs and a bounded SQLSTATE or `EXPIRY_SWEEP_FAILED`. SQLSTATE `57014` indicates statement cancellation/timeout. No raw driver message, SQL parameter, phone, code or transfer-ID list is logged.

A timer firing during an active tick is skipped; no overlapping transaction is started. An unmatched started event therefore matters even if the process is alive. Aggregate completed/failed events into counters and duration distributions in the deployment's log/monitoring system. **This change does not provision a dashboard, alert rule, heartbeat endpoint or external scheduler.**

Recommended operational alerts:

1. No startup/completed signals from an instance expected to be enabled; a started tick without completion/failure beyond the approved batch runtime; repeated failures.
2. Persistent full batches or rising due backlog/oldest due age. At defaults, alert on no completion for several poll intervals; tune for observed database runtime and backlog SLO, not just HTTP readiness.
3. Database lock/connection pressure or repeated `57014`, `40001`, `40P01` failures.

Read-only backlog/expiry evidence (restrict access and use normal operational DB tooling):

```sql
SELECT count(*) AS due_count, min(expires_at) AS oldest_due_at
FROM cash_to_cash_transfers
WHERE status = 'UNCLAIMED' AND expires_at <= clock_timestamp();

SELECT count(*) AS expired_count, sum(principal_minor) AS expired_principal_minor
FROM cash_to_cash_transfers WHERE status = 'EXPIRED';

SELECT correlation_id, count(*) AS expired_count, max(occurred_at) AS latest_at
FROM audit_events WHERE action = 'CASH_TO_CASH_EXPIRED'
GROUP BY correlation_id ORDER BY latest_at DESC LIMIT 20;
```

The second query reports retained principal metadata, **not** authorization to spend/refund it. Accounting reconciliation must continue using the existing ledger controls. Inspect duplicate terminal-state/audit anomalies with approved restricted-access tooling, not customer-facing APIs.

For transient DB/audit failures: restore the dependency and allow the next tick/restart to retry. For persistent data/audit errors: investigate and repair through approved processes; the worker deliberately fails the whole batch rather than marking unaudited expiry or silently dropping a poison row. Repeated permanent failures can stall a batch and require operator action. For stuck network/client shutdown, use supervisor termination/grace policies; database rollback and restart recovery, not an in-memory checkpoint, preserve correctness. Do not race an active tick with manual database mutation.

Disable by setting the worker flag false and restarting gracefully. This stops future sweeps, does not revert committed EXPIRED transfers, does not extend claim deadlines and does not move funds. There is no schema rollback or automatic expiry reversal in this delivery.

## Capability registry and integration handoff

Only `CASH_TO_CASH_EXPIRY` seed metadata was corrected, with implementation evidence: remove the false DEBIT-unclaimed/CREDIT-Agent refund claim; describe the worker/state/audit behavior; change FULLY_ENABLED to BACKEND_IMPLEMENTED and API_READY to NOT_EXPOSED; mark operational configuration NOT_CONFIGURED, and add source/test/runbook references (seed version 2). The catalog availability flag is not a runtime worker-enable signal.

The existing seed service inserts missing codes but **does not overwrite an existing capability row**. This source correction therefore does not repair an already-populated production registry automatically. Have the authorized registry owner review/apply the same evidence-backed metadata through the existing versioned/audited capability update process. Do not truncate/reseed a populated registry or infer activation from static seed metadata.

ARENA 2: **no HTTP request/response, authorization, mobile or admin-web contract change**. Worker operational state is not exposed as a new API. No funding controller, product-catalog module or authorization catalogue was changed. No new migration is required by this task; normal baseline schema prerequisites still apply. No production schema was executed here.

## Verification

- Backend build: `npm run build` PASS.
- Full backend units: `npx jest --runInBand` — **194 suites / 1974 tests PASS**.
- PostgreSQL integration: claim A16, expiry A17 and V1 capability registry — **3 suites / 139 tests PASS** (87 claim, 30 expiry, 22 registry). A17 adds automatic startup execution, bounded/concurrent execution, restart/repetition, audit-failure rollback/retry and actual PostgreSQL statement-timeout recovery. Existing expiry tests cover claim races, idempotency, accounting conservation, absence of automatic refunds/beneficiary credit and migration-chain integrity.
- Lifecycle units cover disabled scheduling, immediate/repeated polling, failure recovery, non-overlap, shutdown waiting, validation and truthful capability metadata.
- Test setup uses sequential transfer creation, then concurrent **expiry workers**. Concurrent initiation of unrelated financial fixtures is not required to prove expiry concurrency. No production financial logic or migration was changed to accommodate fixture setup.

This is targeted PostgreSQL verification, not a claim that the entire platform's integration suite passed. Restart tests exercise fresh worker instances over durable rows and transaction failure recovery; they are not a full process/network chaos test. Prior expired-funds policy and formal audit acceptance remain outside this implementation.
