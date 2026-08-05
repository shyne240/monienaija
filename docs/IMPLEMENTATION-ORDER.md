# Post-Customer-Foundation Implementation Order

- **Task:** A1T08 — Canonical Ownership, Roadmap, and Dependency Package
- **Classification:** Documentation-only architecture synthesis
- **Application code, API, entity, migration, and configuration changes:** None

## Naming rule

This document orders **Architecture phases A1-A8**. It does not renumber, replace, or redefine the permanent Product Roadmap P1.0-P1.15. Product-to-Architecture dependencies are maintained in [`ROADMAP.md`](ROADMAP.md), the graph in [`DEPENDENCY-GRAPH.md`](DEPENDENCY-GRAPH.md), and the ownership decisions in [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md). The complete optimized A1 task breakdown is maintained in [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md).

## 1. Mandatory critical path

```text
M0-M9 Engineering & Financial Core
            |
            v
P1.0-P1.10 Customer Foundation
            |
            v
A1 Foundation Consolidation
            |
            +--> A2 Runtime Identity & Access
            |
            +--> A3 Customer-to-Financial Account Binding  --+
            |                                                  |
            +--> A4 Capability & Policy Engine              --+--> A5 Internal Financial Pilot
                                                               |
                                                               v
                                                A6 External Partners & Settlement
                                                               |
                                                               v
                                                A7 Product Expansion Infrastructure
                                                               |
                                                               v
                                                A8 Scale & Selective Extraction
                                                               |
                                                               v
                                      Runtime activation and controlled Product Roadmap delivery
```

A3 and A4 may be designed in parallel after A1. Production implementation of A3 may require A2 authorization and protected-route evidence, but A5 cannot begin until A2, A3, and A4 gates have all passed.

## 2. A1 internal task order

The optimized A1 plan is executed in the following order; the merged original tasks remain exactly as defined in the canonical plan:

| Order | Task                                                          | Required output                                                               | Dependency                 |
| ----: | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
|     1 | A1T01 — Baseline and ADR Inventory                            | Baseline and ADR inventory                                                    | None                       |
|     2 | A1T02 — Platform and Customer Foundation Inventory            | M0-M9 and P1.0-P1.10 capability inventory                                     | A1T01                      |
|     3 | A1T03 — Module, Schema, and API Inventory                     | Current module/schema/API ownership inventory                                 | A1T01, A1T02               |
|     4 | A1T04 — Cross-Cutting Contract and Trust-Boundary Inventory   | Shared contract and trust-boundary inventory                                  | A1T02, A1T03               |
|     5 | A1T05 — Customer and Adjacent Model Overlap Review            | Authority/projection and overlap decisions                                    | A1T02-A1T04                |
|     6 | A1T06 — Risk, Eligibility, and Compliance Authority Review    | Risk/compliance source-evidence and decision inputs                           | A1T02-A1T04                |
|     7 | A1T07 — Identifier, Privacy, and Retention Controls           | Identifier, data classification, retention, and sharing controls              | A1T02-A1T04                |
|     8 | A1T08 — Canonical Ownership, Roadmap, and Dependency Package  | Canonical matrix, roadmap mapping, dependency graph, and implementation order | A1T05-A1T07                |
|     9 | A1T09 — Reconstruct ADR-0012                                  | Customer Foundation decision record                                           | A1T01, A1T02, A1T05, A1T08 |
|    10 | A1T10 — Draft ADR-0020 and ADR-0021                           | A1 scope and canonical ownership ADRs                                         | A1T05, A1T08, A1T09        |
|    11 | A1T11 — Draft ADR-0022 and ADR-0023                           | Risk/policy and identifier ADRs                                               | A1T06, A1T07, A1T08        |
|    12 | A1T12 — Draft ADR-0024 Data Classification and Privacy        | Data classification/privacy ADR                                               | A1T07, A1T08, A1T10, A1T11 |
|    13 | A1T13 — Consolidated Inventory and Cross-Document Consistency | Final consistent architecture package                                         | A1T09-A1T12                |
|    14 | A1T14 — A1 Review Package and Exit Evidence                   | A1 approval and A2 entry package                                              | A1T13                      |

A1T10, A1T11, and A1T12 may be designed in parallel after A1T08 where their documented dependencies are satisfied. A1T13 remains blocked until all three packages and A1T09 are complete.

## 3. Ordered Architecture work packages

| Order | Architecture phase                       | Must produce                                                                                                       | Cannot proceed without                                                           |
| ----: | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
|     0 | A1 Foundation Consolidation              | Canonical ownership, architecture inventory, identifier/privacy boundaries, ADR-0012, ADR-0020-0024 review package | P1.0-P1.10 inventory and A1 exit approval                                        |
|     1 | A2 Runtime Identity & Access             | Authentication, sessions/tokens, MFA execution, authorization, privileged access                                   | A1 exit, security threat model, and A1 ownership decisions                       |
|     2 | A3 Customer-to-Financial Account Binding | Customer-wallet to ledger-account mapping, idempotent provisioning, repair, and reconciliation                     | A1 canonical identity; A2 authorization for protected operations                 |
|     3 | A4 Capability & Policy Engine            | Versioned, explainable capability decision                                                                         | A1 risk/identifier decisions; A2 access boundary; P1.3/P1.9/P1.10 consolidation  |
|     4 | A5 Internal Financial Pilot              | Customer-aware, authorized, ledger-backed transfer or other bounded internal flow                                  | A2, A3, A4, reconciliation, rollback, and support evidence                       |
|     5 | A6 External Partners & Settlement        | Isolated bank/NIBSS adapters, callbacks, settlement, suspense                                                      | Internal pilot evidence, privacy review, and partner approval                    |
|     6 | A7 Product Expansion Infrastructure      | Shared contracts for products, jobs, APIs, support, channels, and notifications                                    | Common policy, ledger, events, reconciliation, governance, and partner contracts |
|     7 | A8 Scale & Selective Extraction          | Evidence-led topology, regional resilience, recovery, and selective extraction                                     | Production volume, DR, SLO, outbox, reconciliation, and capacity evidence        |

## 4. Work that may run in parallel

The following work may be designed in parallel but may not bypass the critical path:

- A1T10, A1T11, and A1T12 after A1T08 and their documented dependencies.
- A2 threat modeling, credential protection design, and authorization model design after A1 ownership inputs.
- A3 mapping design and reconciliation query design after A1 identity decisions; protected execution waits for A2 where applicable.
- A4 policy matrix workshops with Risk, Compliance, Product, and Finance after A1 risk and identifier decisions.
- A3 and A4 architecture design after A1; A5 implementation still waits for A2, A3, and A4 gates.
- A5 transfer-pilot test-plan and failure-mode design before implementation, without activating commands.
- A6 partner due diligence and settlement design before the A5 gate, without calling external rails.
- A8 capacity-model preparation before measured production evidence.

Parallel design work must not expose an API, add a migration, authorize a product, or publish sensitive data before its dependency gate is passed.

## 5. Order constraints

1. Do not expose current internal APIs publicly before A2.
2. Do not let customer-wallet metadata become a ledger balance source.
3. Do not wire eligibility, risk, compliance, privacy, or retention rules independently into each financial module.
4. Do not activate external rails before A5 has reconciliation and rollback evidence.
5. Do not add product-specific financial logic before A2-A5 policy, authorization, idempotency, audit, and reconciliation contracts exist.
6. Do not extract services merely because the module count increases.
7. Do not let a projection, dashboard, metrics record, or readiness view write to its source authority.
8. Do not use a customer reference, case number, beneficiary/funding reference, provider ID, or correlation value as a replacement for a canonical internal ID.
9. Do not delete held data or pending outbox facts through ordinary retention cleanup.

## 6. Phase gate evidence

Each Architecture phase must attach:

- Approved ADRs and an explicit decision owner.
- Migration and rollback plan where schema changes are introduced.
- Unit, integration, concurrency, and failure tests as applicable.
- Audit-event evidence.
- Idempotency and optimistic-lock evidence.
- Observability and support ownership.
- Security/privacy/risk review.
- Reconciliation evidence for financial state.
- Product governance and release approval.
- Evidence that disabling the phase does not corrupt earlier authoritative records.

## 7. A1T08 acceptance evidence

- [x] Product Roadmap P1.0-P1.15 remains unchanged and separate from A1-A8.
- [x] A1 internal tasks and their dependencies are ordered according to the canonical implementation plan.
- [x] A3/A4 parallel design and A5's A2/A3/A4 dependency are explicit.
- [x] Prohibited cross-domain dependency edges are recorded.
- [x] No application code, API, schema, migration, module, or runtime configuration is introduced.
