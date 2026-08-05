# ADR-0020: Foundation Closure and Scope Boundary

- **Status:** Proposed for A1 architecture review
- **Date:** 2026-08-05
- **Decision owners:** Architecture, Engineering, Security, Risk, Compliance, Finance, Operations, Product, and accountable release owners
- **Scope:** A1 Foundation Consolidation
- **Task:** A1T10 — Draft ADR-0020 and ADR-0021

## Context

MonieNaija has completed the M0-M9 Engineering and Financial Core and the P1.0-P1.10 Customer Foundation. Before runtime identity, customer-to-financial-account binding, policy enforcement, or financial activation begins, the current models and shared operational contracts need one documented architectural boundary.

The repository contains customer identity and lifecycle metadata, ledger-backed financial records, operations primitives, and adjacent beneficiary, funding-instrument, authentication, risk, and compliance models. These are intentionally separate capabilities, but a later phase could accidentally treat a projection as an authority, add a duplicate writer, or activate an internal route before the A2 trust boundary exists.

A1 therefore needs a closure decision that says what the foundation is, what it is not, which documents are authoritative inputs, and which conditions must be satisfied before A2-A8 work is treated as approved.

## Decision

### 1. A1 is consolidation, not feature implementation

A1 Foundation Consolidation is a documentation and architecture decision phase. It:

- Confirms the M0-M9 and P1.0-P1.10 baseline without renumbering or replacing the Product Roadmap P1.0-P1.15.
- Reconciles ADR-0001 through ADR-0019 and preserves their history.
- Identifies one authoritative owner for each major concept.
- Disposes of current customer, wallet, beneficiary, risk, compliance, authentication, identifier, privacy, and retention overlaps.
- Defines dependencies, prohibited edges, decision inputs, and entry conditions for A2-A8.

A1 does **not** add or change:

- Runtime authentication, sessions, authorization, or protected-route behavior.
- Customer-to-ledger account binding or financial activation.
- A policy engine, automated AML, sanctions, fraud, or transaction monitoring.
- External bank/NIBSS/provider adapters, callbacks, settlement, or notification delivery.
- APIs, controllers, services, DTOs, entities, modules, migrations, tests, or runtime configuration.

### 2. A1 evidence package

The A1 package is assembled from the following reviewable artifacts:

| Evidence                                                                                                                                | Purpose                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`A1-IMPLEMENTATION-PLAN.md`](../A1-IMPLEMENTATION-PLAN.md)                                                                             | Canonical task order and scope                                                    |
| [`ADR-INVENTORY.md`](../ADR-INVENTORY.md)                                                                                               | ADR chronology, status, and missing-record determination                          |
| [`PLATFORM-CUSTOMER-INVENTORY.md`](../PLATFORM-CUSTOMER-INVENTORY.md)                                                                   | M0-M9 and P1.0-P1.10 capability baseline                                          |
| [`MODULE-SCHEMA-API-INVENTORY.md`](../MODULE-SCHEMA-API-INVENTORY.md)                                                                   | Current module, schema, migration, and route ownership                            |
| [`CROSS-CUTTING-CONTRACTS.md`](../CROSS-CUTTING-CONTRACTS.md)                                                                           | Shared audit, idempotency, outbox, readiness, reconciliation, and trust contracts |
| [`CUSTOMER-ADJACENT-OVERLAP-REVIEW.md`](../CUSTOMER-ADJACENT-OVERLAP-REVIEW.md)                                                         | Customer and adjacent-domain overlap decisions                                    |
| [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](../RISK-COMPLIANCE-AUTHORITY-REVIEW.md)                                                         | Risk, eligibility, compliance, and future-policy authority inputs                 |
| [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](../IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)                                               | Identifier, classification, retention, legal-hold, and external-sharing controls  |
| [`CANONICAL-OWNERSHIP-MATRIX.md`](../CANONICAL-OWNERSHIP-MATRIX.md)                                                                     | Synthesized authority, projection, target-phase, and prohibited-edge decisions    |
| [`ROADMAP.md`](../ROADMAP.md), [`DEPENDENCY-GRAPH.md`](../DEPENDENCY-GRAPH.md), [`IMPLEMENTATION-ORDER.md`](../IMPLEMENTATION-ORDER.md) | Product/Architecture mapping and dependency sequence                              |
| [`ADR-0012-Customer-Foundation.md`](ADR-0012-Customer-Foundation.md)                                                                    | Reconstructed Customer Foundation decision                                        |

A document is evidence of a decision input or baseline; it is not permission to implement a later phase.

### 3. A1 closure conditions

A1 may be proposed for approval only when:

1. The original Product Roadmap P1.0-P1.15 is preserved exactly.
2. Architecture phases use A1-A8 names consistently.
3. Every major concept has an authoritative owner and a metadata/projection classification.
4. Financial balances, posted journals, and ledger lines remain ledger-owned.
5. Duplicate wallet, beneficiary, risk, compliance, authentication, and identifier writers have a disposition.
6. Identifier, privacy, retention, legal-hold, and external-sharing inputs are documented and assigned to later enforcement owners.
7. A2-A5 boundaries, dependencies, prohibited edges, and rollback assumptions are explicit.
8. ADR-0012 and proposed ADR-0020 through ADR-0024 have a recorded review status.
9. The final A1 review package names accountable owners, open risks, decision dates, and A2 entry conditions.

These are review gates, not runtime checks added by A1.

### 4. Authority and change control

- A1 documents are the architecture baseline until an approved ADR or later phase decision supersedes them.
- A later phase may refine an implementation contract only when it preserves the ownership and financial invariants or records an explicitly approved superseding decision.
- No team may infer approval from a document link, a readiness report, or the existence of an existing internal route.
- Any change to an authoritative owner, financial boundary, identifier convention, privacy classification, or retention rule requires an ADR or an approved decision-log entry under the architecture governance process.

## Alternatives considered

### Treat A1 as another product implementation phase

Rejected. A1 exists to prevent runtime activation from inheriting unresolved ownership and trust-boundary conflicts. Product Roadmap milestones remain separate and unchanged.

### Refactor or merge all overlapping modules during A1

Rejected. The current foundation is metadata and lifecycle infrastructure with existing history. Merging tables or modules during documentation consolidation would introduce migration, compatibility, and financial risks before ownership is approved.

### Start A2-A5 before A1 is closed

Rejected. Runtime access, account binding, policy decisions, and financial commands depend on stable identity and authority rules. Parallel design is allowed where the dependency graph permits it; production activation is not.

### Declare existing internal routes production-public

Rejected. Validation and request context do not provide authentication or authorization. A2 owns the runtime trust boundary.

## Consequences

### Positive

- The Customer Foundation remains usable without being mistaken for a protected runtime platform.
- Future phases have one reference point for authority, projection, identifier, privacy, retention, and dependency decisions.
- Financial truth remains isolated in the ledger while account binding is designed separately.
- Later ADRs can ratify focused decisions without silently replacing earlier ADRs.
- Documentation changes can be reviewed and rolled back independently of application behavior.

### Trade-offs

- A1 does not resolve every implementation detail required by A2-A8.
- Some schedules, policy precedence, provider mappings, and operational warning semantics remain explicit future decisions.
- Existing duplicate or legacy models remain in place until their owning consolidation phase is approved.
- Formal A1 approval still requires accountable owner review; a proposed ADR is not an accepted production gate.

## Dependencies

- **ADR-0001:** domain-oriented architecture and owned boundaries.
- **ADR-0002:** exact money and currency representation.
- **ADR-0003:** durable events, ownership, correlation, causation, and replay safety.
- **ADR-0004 through ADR-0011:** financial, resilience, production, maturity, and governance decisions requiring review.
- **ADR-0012 through ADR-0019:** Customer Foundation identity, onboarding, eligibility, wallet metadata, funding instruments, beneficiaries, preferences, and authentication metadata.
- **A1T01-A1T09:** baseline, inventories, cross-cutting contracts, overlap reviews, identifier controls, synthesized package, and Customer Foundation ADR reconstruction.
- **ADR-0021:** canonical domain ownership rules drafted with this decision package.
- **ADR-0022 through ADR-0024:** planned risk/policy, identifier, and privacy decisions that must remain consistent with A1 closure.

## Future-phase boundaries

- **A2:** runtime identity, authentication, authorization, privileged actions, and secret/device handling enforcement.
- **A3:** explicit customer-wallet to ledger-backed account binding, repair, and reconciliation.
- **A4:** versioned capability and policy decisions using source evidence without owning that evidence.
- **A5:** one bounded internal financial command with policy, authorization, idempotency, audit, outbox, recovery, and reconciliation.
- **A6:** external providers, callbacks, settlement, data minimization, and partner retention.
- **A7-A8:** product expansion, event delivery, operational scale, and selective extraction.

## Verification

A1T10 verification for this ADR requires:

- ADR structure and status check.
- Scope/non-scope review confirming no code, migration, API, module, or runtime behavior is introduced.
- Cross-reference review against the A1 plan, inventories, ownership matrix, roadmap, dependency graph, ADR-0012, and ADR-0021.
- Decision approval checklist completion by accountable owners before A1 exit.
