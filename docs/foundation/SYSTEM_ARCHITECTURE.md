# System Architecture

## Architecture philosophy
MonieNaija will be designed as a regulated financial system: correctness, traceability, controlled change, and graceful recovery are more important than novelty. Start with clear domain boundaries and independently deployable operational responsibilities; extract services only when ownership, scale, reliability, or security warrants the added complexity.

## Target logical domains
- **Identity & access:** customer/agent/employee identity, authentication, authorization, device and session risk.
- **Customer & compliance:** profiles, KYC/KYB, consent, limits, sanctions/AML workflow and case management.
- **Accounts & ledger:** wallet/account state and an append-only, balanced double-entry ledger as the financial system of record.
- **Payments orchestration:** validated, idempotent payment intents and lifecycle coordination for NIP, virtual accounts, QR, merchant, bills, airtime/data, bulk, payroll and cards.
- **Channels:** mobile, web, agent, merchant, POS and partner APIs; channels do not mutate balances directly.
- **Risk & fraud:** policy decisions, signals, alerts, investigation and case outcomes.
- **Settlement & reconciliation:** provider records, internal records, exceptions, funding and settlement workflows.
- **Operations & data:** notifications, support, reporting, audit, observability and governed analytical exports.

These are future boundaries, not a mandate to create a service per bullet. Interfaces, ownership, and data access must remain explicit.

## Core invariants
1. Only the ledger can authoritatively record monetary value movement.
2. Every posted journal balances: total debits equal total credits in its currency and accounting unit.
3. Posted financial records are immutable; corrections are compensating entries linked to the original.
4. External requests and consumed messages are idempotent using durable keys and deterministic outcomes.
5. State transitions are explicit, validated, authorised, timestamped, and auditable.
6. No request is considered successful until its durable outcome and customer-safe response are known; ambiguous external outcomes enter controlled recovery/reconciliation.
7. Reconciliation is continuous, independent, and exception-driven—not a best-effort report.

## Data and integration design
Each domain owns its operational data. Cross-domain mutation occurs through versioned contracts, not shared tables. Synchronous APIs are used where an immediate bounded decision is essential; durable events communicate facts after committed state changes. Use the transactional outbox/inbox pattern (or an equivalently proven mechanism) to avoid losing or inventing events between a state change and publication. Events are facts, versioned, schema-governed, correlated, deduplicated, replay-safe, and never carry unnecessary sensitive data.

Partner integrations are isolated behind adapters with explicit timeout, retry, idempotency, circuit-breaker, rate-limit, credential-rotation, observability, and reconciliation behaviour. Do not treat a provider callback as sufficient proof of final financial settlement without defined verification.

## Scale, availability, and regions
Stateless channel and orchestration workloads should scale horizontally. Financial writes require a deliberately chosen consistency model and ordered ownership boundaries; availability must not create double-spend or divergent ledgers. Build for multi-region deployment through regional isolation, encrypted replication, tested failover, data-residency assessment, and explicit RTO/RPO targets. Choose active-active only where conflict, ordering, and recovery semantics are demonstrably safe; otherwise prefer a controlled active-passive approach.

## Trust boundaries and observability
Public channels, partner connections, administration, internal workloads, and data platforms are separate trust zones. Apply least privilege, authenticated/encrypted transport, audit trails, and network segmentation at each boundary. Every transaction and event carries correlation identifiers; logs, metrics, traces, ledger references, and partner references enable end-to-end investigation without exposing secrets or full sensitive data.

## Prohibited shortcuts
Direct balance updates outside the ledger; mutable posted entries; distributed transactions across uncontrolled partners; unbounded retries; shared production credentials; unaudited administrative changes; and treating eventual consistency as permission to show untrue balances.
