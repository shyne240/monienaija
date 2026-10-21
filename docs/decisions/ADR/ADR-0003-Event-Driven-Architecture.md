# ADR-0003: Use durable domain events with transactional publication

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owners:** Chief Software Architect; future Platform and Domain owners

## Context
Payments, notifications, fraud, compliance, settlement, reporting, and partner workflows need timely but decoupled communication. Direct synchronous chains amplify outages and make independent scaling difficult. At-least-once delivery and partner retries create duplicates and ordering uncertainty.

## Decision
Use an event-driven architecture for committed domain facts across bounded contexts. A domain change and its event are made durable atomically through a transactional outbox or equivalent proven pattern; consumers use an inbox/deduplication record and idempotent handlers. Events have an owner, versioned schema, unique event ID, correlation/causation IDs, occurrence time, classification, retention policy, and minimal data. Consumers tolerate duplicate, delayed, and out-of-order delivery. Events do not replace authoritative commands, authorization, ledger posting, reconciliation, or query models.

## Alternatives considered
1. **Synchronous request chaining:** simpler for a narrow flow but couples availability and creates fragile failure cascades.
2. **Best-effort asynchronous notifications:** decoupled but loses auditability and can silently drop critical work.
3. **Exactly-once delivery assumption:** not portable across databases, brokers, and partners; it obscures necessary idempotency.

## Consequences
Teams must own schemas and compatibility, monitor lag and dead-letter/recovery paths, secure event payloads, and test replay. Eventual consistency must be explicit in product states. Sensitive data is minimized and governed; consumers cannot infer ledger truth without their authorised source.
