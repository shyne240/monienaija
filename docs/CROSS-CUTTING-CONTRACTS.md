# Cross-Cutting Contracts and Trust Boundaries

- Task: A1T04 — Cross-Cutting Contract and Trust-Boundary Inventory
- Scope: Existing platform contracts used by M0-M9 and P1.0-P1.10
- Classification: Documentation-only baseline
- Application code changed: None

## 1. Purpose

This document defines the shared contracts that future Architecture phases must reuse. It does not introduce a new implementation, service, API, entity, migration, or runtime behavior.

The purpose is to prevent each domain from independently recreating audit, idempotency, outbox, readiness, error, correlation, transaction, or shutdown behavior.

## 2. Contract matrix

| Contract                   | Current owner                 | Implementation                                                       | Atomicity / consistency                                                                                     | Required consumers                                                | Current status                                                   |
| -------------------------- | ----------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Immutable audit            | Operations                    | `AuditService`, `AuditEvent`, `audit_events`                         | Audit writes occur in the same transaction as domain mutations. Audit rows are append-only.                 | Every mutating domain.                                            | Implemented.                                                     |
| Idempotency                | Operations                    | `IdempotencyService`, `IdempotencyRecord`, `idempotency_records`     | Request key and request hash produce one durable outcome; changed payload reuse is rejected.                | Financial commands and future retryable commands.                 | Implemented PostgreSQL primitive.                                |
| Transactional outbox       | Operations                    | `OutboxService`, `OutboxEvent`, `outbox_events`                      | Domain fact and outbox record commit atomically.                                                            | Future event-producing domains.                                   | Durable storage implemented; external publisher is not included. |
| Operational metrics        | Operations                    | `MetricsService`, `OperationalMetric`, `operational_metrics`         | Best-effort operational updates must not cause financial writes to fail.                                    | All operationally measured domains.                               | Implemented.                                                     |
| Diagnostics                | Operations                    | `DiagnosticsService`                                                 | Read-only operational queries.                                                                              | Production readiness, operators, support.                         | Implemented.                                                     |
| Independent reconciliation | Finance / Reconciliation      | `ReconciliationService` and read-only queries                        | Queries source tables independently rather than calling write services.                                     | Production readiness, maturity, Finance, release gates.           | Implemented.                                                     |
| Production readiness       | Production                    | `ProductionReadinessService`                                         | Database, exact migration head, reconciliation, and outbox signals are evaluated before listener readiness. | Application bootstrap and release process.                        | Implemented.                                                     |
| Request context            | Production / HTTP             | Request, correlation, and trace IDs                                  | IDs are generated or propagated at the HTTP boundary and included in responses and logs.                    | Controllers, logs, audit-aware commands, support.                 | Implemented.                                                     |
| API version metadata       | Production / HTTP             | API version service and response header                              | Version information is additive and visible on responses.                                                   | HTTP clients, operators, future partner APIs.                     | Implemented for `v1`.                                            |
| DTO validation             | HTTP boundary                 | Global `ValidationPipe`                                              | Transform, whitelist, and forbidden unknown properties are applied before domain services.                  | Every controller DTO.                                             | Implemented.                                                     |
| Error contract             | HTTP boundary                 | Global exception filter                                              | Errors expose stable status, code, message, and request context without internal details.                   | Every controller.                                                 | Implemented.                                                     |
| TypeORM transactions       | Domain services               | `DataSource.transaction`                                             | Related domain, history, audit, and outbox writes commit or roll back together.                             | All mutating services.                                            | Implemented convention.                                          |
| Optimistic locking         | Domain entities               | TypeORM `VersionColumn` and expected-version fields where applicable | Stale updates are rejected rather than silently overwriting newer state.                                    | Mutable customer and future activation records.                   | Implemented selectively; future phases must preserve it.         |
| Soft deletion              | Domain entities               | `DeleteDateColumn`/`deletedAt` and partial indexes                   | Historical rows remain available while active uniqueness excludes deleted rows where defined.               | Customer Foundation and future metadata domains.                  | Implemented convention.                                          |
| Financial locking          | Ledger                        | Deterministic account locking in ledger transactions                 | Concurrent postings cannot create negative or divergent customer-funds balances.                            | Wallet, transfer, deposit, withdrawal, future financial commands. | Implemented financial invariant.                                 |
| Money representation       | Common / Ledger               | Minor-unit parsing and currency normalization                        | No floating-point financial arithmetic; currency compatibility is explicit.                                 | Every financial domain.                                           | Implemented.                                                     |
| Graceful shutdown          | Production                    | `RequestTrackerService`, shutdown hooks, drain behavior              | New requests are rejected during drain; active requests receive bounded completion time.                    | HTTP runtime and deployments.                                     | Implemented.                                                     |
| Configuration validation   | Production / Config           | Environment validation and safe configuration view                   | Invalid configuration fails startup; secrets are not exposed in safe views.                                 | Bootstrap, deployment, operators.                                 | Implemented.                                                     |
| Migration control          | TypeORM / Production          | Migration files and expected migration-head validation               | Schema changes are explicit and startup rejects incompatible heads.                                         | Every schema-changing phase.                                      | Implemented.                                                     |
| Retention maintenance      | Maturity / Operations         | Retention preview and manual execution                               | Cleanup is bounded and does not remove pending outbox or required history.                                  | Operators and governance.                                         | Implemented manually; retention policy requires governance.      |
| Product readiness          | Product Governance / Maturity | Governance records, reports, readiness checks                        | Missing evidence warns; blocked evidence fails readiness.                                                   | Product, Regulatory, Risk, Operations, launch owners.             | Implemented; formal review remains required.                     |

## 3. Trust-boundary map

```text
Untrusted or internal HTTP caller
        |
        v
Fastify HTTP boundary
  - API version metadata
  - request/correlation/trace context
  - DTO transformation and validation
  - global error contract
        |
        v
Controller
  - route ownership
  - no direct table mutation
        |
        v
Domain service transaction
  - domain state transition
  - optimistic-lock checks
  - idempotency claim where required
  - audit event
  - append-only history
  - transactional outbox fact where required
        |
        v
PostgreSQL
  - domain tables
  - audit_events
  - idempotency_records
  - outbox_events
  - metrics and governance metadata
        |
        +-----------------------------+
        |                             |
        v                             v
Ledger authority                 Read-only controls
  - journals/lines               - reconciliation
  - ledger-derived balances      - diagnostics
  - immutable postings            - readiness
        |                             |
        v                             v
Financial consumers             Operations and release gates
```

### Current trust-boundary limitation

The HTTP boundary currently provides validation and request context, but runtime authentication and authorization are not implemented. Internal routes therefore require deployment/network restriction and must not be treated as public production APIs. A2 owns the runtime trust boundary.

### Future external boundary

External bank, NIBSS, notification, partner, and delivery systems are not current dependencies. A6/A7 must isolate them behind adapters, timeout/retry rules, idempotency, callback validation, data minimization, and reconciliation.

## 4. Contract ownership and usage rules

### Audit

- Domains call the existing `AuditService`; they do not write `audit_events` directly.
- Audit calls occur inside the same transaction as the mutation.
- Audit values must exclude plaintext credentials, raw tokens, secrets, and unnecessary sensitive data.
- Audit rows are immutable and queryable through internal operations routes.

### Idempotency

- A command owner defines the idempotency-key scope and request hash.
- Identical retries return the durable original outcome.
- A changed command under an existing key is rejected.
- In-memory flags and best-effort local deduplication are not substitutes for `IdempotencyService`.
- Read-only queries do not require idempotency claims.

### Outbox

- Domain facts are written transactionally with their source mutation.
- The outbox payload is minimal, versioned, correlated, and free of unnecessary sensitive data.
- Event consumers must tolerate duplicate, delayed, and out-of-order delivery.
- No domain may publish externally before its durable state and outbox fact commit.
- The current foundation stores outbox facts but does not include a broker or publisher.

### Metrics and diagnostics

- Metrics are operational observations, not business truth.
- Metrics degradation must not reject a financial transaction.
- Diagnostics are read-only and must not repair records by mutation.
- Financial truth is obtained from the ledger and independent reconciliation, not dashboards.

### Reconciliation

- Reconciliation queries source tables independently of application write services.
- Reconciliation does not mutate financial rows to make a check pass.
- Any error enters controlled investigation and recovery.
- Warning semantics must be formally clarified before A5; a warning requires ownership and risk acceptance, while an error blocks readiness.

### Transactions and locking

- Related writes use one TypeORM transaction.
- Domain history, audit, and outbox records are part of that transaction where applicable.
- Financial commands use ledger locking and invariant enforcement; customer metadata must never update balances.
- Optimistic versions are checked on mutable records.

### Soft deletion and retention

- Active uniqueness indexes exclude soft-deleted rows only when the domain permits replacement.
- Records with non-reusable global identifiers must retain uniqueness after soft deletion.
- History, audit, security, compliance, and financial records require explicit retention decisions before deletion.
- No hard-delete convenience method is a substitute for a retention policy.

### HTTP and errors

- Controllers accept DTOs only.
- Unknown properties are rejected.
- Services validate route UUIDs and business transitions.
- Errors use the existing global exception contract.
- Internal route status is not equivalent to public authorization.

## 5. Future-phase usage map

| Architecture phase                       | Required cross-cutting contracts                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 Foundation Consolidation              | Document and ratify ownership, audit, idempotency, outbox, readiness, trust, and data-boundary rules.                                               |
| A2 Runtime Identity & Access             | Request context, error contract, audit, security-event history, configuration validation, secret minimization, and protected-route boundary.        |
| A3 Customer-to-Financial Account Binding | Transactions, optimistic locking, idempotency, audit, migration control, ledger authority, and reconciliation.                                      |
| A4 Capability & Policy Engine            | Versioned policy decisions, evidence references, audit, request context, optimistic locking, and deterministic reads.                               |
| A5 Internal Financial Pilot              | Idempotency, deterministic ledger locks, transactional outbox, audit, metrics, diagnostics, reconciliation, and recovery.                           |
| A6 External Partners & Settlement        | Adapter boundary, callback idempotency, outbox/inbox, timeouts, bounded retries, correlation, settlement reconciliation, and data minimization.     |
| A7 Product Expansion Infrastructure      | Event schemas, background-job reliability, notification intent, support/reporting contracts, governance gates, and product-specific reconciliation. |
| A8 Scale & Selective Extraction          | Event ownership, lag metrics, capacity, SLOs, DR, regional boundaries, observability, and extraction criteria.                                      |

## 6. Prohibited duplicate implementations

The following implementations are prohibited in future modules:

- Direct writes to `audit_events` outside `AuditService`.
- Per-module idempotency flags instead of `IdempotencyService`.
- External publication directly from a domain transaction without an outbox fact.
- Mutable wallet or ledger balance columns as financial truth.
- Reconciliation by calling the same service that performed the write.
- Unbounded retry loops.
- Module-local request/correlation ID generation that replaces HTTP context.
- Module-local error envelopes that bypass the global exception filter.
- Reimplementation of migration-head checks in individual modules.
- Independent authorization logic embedded in payment, wallet, transfer, deposit, or withdrawal services.
- Treating metrics, dashboards, or policy projections as authoritative source data.
- Adding external integration clients directly to customer metadata modules.

## 7. Current gaps

1. Runtime authentication and authorization are not implemented.
2. Outbox facts are durable, but external publishing and inbox consumption are not part of the foundation.
3. Policy decisions are not yet centralized.
4. Customer-wallet metadata is not canonically bound to ledger-backed accounts.
5. Internal endpoint exposure remains a deployment/network responsibility until A2.
6. Reconciliation warning acceptance and release escalation require formal clarification.
7. Event schema ownership and retention require later ADRs.

## 8. A1T04 acceptance evidence

A1T04 is complete when:

- Every shared contract is assigned an owner.
- Trust boundaries and current limitations are documented.
- Future phases have explicit contract-usage requirements.
- Duplicate implementations are prohibited by documented rules.
- Audit, idempotency, outbox, metrics, diagnostics, reconciliation, readiness, request context, error, transaction, locking, soft-deletion, retention, and migration contracts are covered.
- The document links to existing module/schema/API and architecture inventories rather than recreating them.
- No application code or behavior is changed.
