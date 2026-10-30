# ADR-0001: Domain-oriented, ledger-centred architecture

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owners:** Chief Software Architect; future Engineering, Security, Risk and Operations owners

## Context
A Nigerian mobile-money platform must expand across channels and products while preserving financial correctness, auditability, partner isolation, compliance controls, and reliable recovery. A monolithic shared-data model makes these boundaries and responsibilities difficult to enforce; premature microservices create avoidable distributed-system risk.

## Decision
Adopt a domain-oriented architecture with explicit bounded contexts and contracts. The double-entry ledger is the authoritative financial record; channels and payment orchestration may request value movement but cannot directly update balances. Begin with the simplest deployable topology that preserves domain ownership, transactional integrity, observability, and access boundaries. Extract independently deployable services only where justified by scale, security, fault isolation, ownership, or release cadence. Use versioned APIs/events and owned data stores; prohibit cross-domain shared-table writes.

## Alternatives considered
1. **Single shared-database application:** faster initially but weakens ownership, audit boundaries, and safe independent evolution.
2. **Microservice per capability from day one:** maximises isolation but adds substantial consistency, operational, and delivery complexity before it is needed.
3. **Vendor-led core as sole system of record:** can accelerate integrations but risks opaque controls, lock-in, and insufficient ownership of critical financial truth.

## Consequences
Teams must invest in contracts, correlation, access controls, reconciliation, and operational ownership. Some workflows will be asynchronous and need customer-safe pending/recovery states. This enables incremental horizontal scaling and controlled regional deployment while retaining the option to evolve topology deliberately.
