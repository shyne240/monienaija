# ADR-0008: Database-backed operational resilience primitives

- **Status:** Proposed for domain review
- **Date:** 2026-08-03
- **Decision owners:** Future Platform, Ledger, Finance, Risk, and Operations owners

## Context

MonieNaija's money engine already uses PostgreSQL transactions, deterministic account locking, and durable domain records. M7 needs operational evidence and retry-safe primitives without introducing Redis, a message broker, external delivery, or background workers.

## Decision

- Use PostgreSQL as the distributed idempotency store with a scoped key, request hash, durable outcome, expiration, replay count, and cleanup operation.
- Persist audit events in an append-only table. Database triggers reject audit updates and deletes.
- Persist outbox facts in the same transaction as the domain change. Outbox status and retry metadata are mutable, but event identity, aggregate, event type, and payload are immutable. No external publisher is included.
- Store operational counters in PostgreSQL through best-effort atomic upserts so metrics cannot make a financial transaction fail.
- Run diagnostics and reconciliation from read-only database queries. Readiness includes database, migration, reconciliation, and outbox signals; liveness remains process-only.
- Retry only bounded PostgreSQL serialization/deadlock failures. Do not add unbounded retries or a distributed cache.

## Alternatives considered

1. **Redis as the idempotency store:** rejected because M7 explicitly keeps the operational dependency set within PostgreSQL.
2. **Kafka/RabbitMQ for the outbox:** rejected because M7 stores durable facts only; external delivery belongs to later scope.
3. **Mutable audit rows:** rejected because financial and operational history must remain tamper-evident.
4. **Metrics that block financial writes:** rejected because observability degradation must not corrupt or reject money movement.

## Consequences

PostgreSQL carries additional operational writes and requires indexes, retention cleanup, and capacity monitoring. Outbox events can accumulate without a publisher, so diagnostics expose pending/failed counts. Internal endpoints are not production-public APIs until authentication and authorization exist. The existing ledger remains the only source of monetary truth.
