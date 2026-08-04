# Post-Customer-Foundation Implementation Order

## Naming rule

This document orders **Architecture phases A1-A8**. It does not renumber, replace, or redefine the permanent Product Roadmap P1.0-P1.15. Product-to-Architecture dependencies are maintained in [`ROADMAP.md`](ROADMAP.md). The complete optimized A1 task breakdown is maintained in [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md).

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
            v
A2 Runtime Identity & Access
            |
            v
A3 Customer-to-Financial Account Binding
            |
            v
A4 Capability & Policy Engine
            |
            v
A5 Internal Financial Pilot
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

## 2. Ordered work packages

| Order | Architecture phase                       | Must produce                                                                     | Cannot proceed without                                    |
| ----: | ---------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
|     0 | A1 Foundation Consolidation              | Ownership matrix, architecture inventory, ADR-0012, overlap decisions            | P1.0-P1.10 inventory                                      |
|     1 | A2 Runtime Identity & Access             | Authentication, sessions/tokens, MFA execution, authorization, privileged access | Security threat model and A1 ownership                    |
|     2 | A3 Customer-to-Financial Account Binding | Customer-wallet to ledger-account mapping, idempotent provisioning, repair       | A1 canonical identity and A2 authorization                |
|     3 | A4 Capability & Policy Engine            | Versioned, explainable capability decision                                       | P1.3, P1.9, P1.10 consolidation and A2                    |
|     4 | A5 Internal Financial Pilot              | Customer-aware, authorized, ledger-backed transfer                               | A2, A3, A4, reconciliation                                |
|     5 | A6 External Partners & Settlement        | Isolated bank/NIBSS adapters, callbacks, settlement, suspense                    | Internal pilot evidence and partner approval              |
|     6 | A7 Product Expansion Infrastructure      | Shared contracts for products, jobs, APIs, support, and channels                 | Common policy, ledger, events, reconciliation, governance |
|     7 | A8 Scale & Selective Extraction          | Evidence-led topology and regional resilience                                    | Production volume, DR, and capacity evidence              |

## 3. Work that may run in parallel

The following work may be designed in parallel but may not bypass the critical path:

- A1 ADR drafting, data-classification review, and ownership workshops.
- A2 threat modeling, credential protection design, and authorization model design.
- A3 mapping design and reconciliation query design.
- A4 policy matrix workshops with Risk, Compliance, Product, and Finance.
- A5 transfer pilot test-plan and failure-mode design.
- A6 partner due diligence and settlement design.
- A8 capacity-model preparation.

Parallel design work must not expose an API, add a migration, or authorize a product before its dependency gate is passed.

## 4. Order constraints

1. Do not expose current internal APIs publicly before A2.
2. Do not let customer-wallet metadata become a ledger balance source.
3. Do not wire eligibility, risk, or compliance rules independently into each financial module.
4. Do not activate external rails before A5 has reconciliation and rollback evidence.
5. Do not add product-specific financial logic before A2-A5 policy, authorization, idempotency, audit, and reconciliation contracts exist.
6. Do not extract services merely because the module count increases.

## 5. Phase gate evidence

Each Architecture phase must attach:

- Approved ADRs.
- Migration and rollback plan.
- Unit, integration, concurrency, and failure tests as applicable.
- Audit-event evidence.
- Idempotency and optimistic-lock evidence.
- Observability and support ownership.
- Security/privacy/risk review.
- Reconciliation evidence for financial state.
- Product governance and release approval.
