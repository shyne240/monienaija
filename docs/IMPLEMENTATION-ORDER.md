# Post-Customer-Foundation Implementation Order

## 1. Mandatory critical path

```text
P1.0-P1.10 Customer Foundation
            |
            v
P2.0 Model and ownership consolidation
            |
            v
P2.1 Runtime identity, authentication, authorization
            |
            v
P2.2 Customer-to-ledger account binding
            |
            v
P2.3 Canonical capability and risk policy
            |
            v
P2.4 Internal financial pilot
            |
            v
P2.5 External partners and settlement
            |
            v
P2.6 Product expansion
            |
            v
P2.7 Scale and selective extraction
```

## 2. Ordered work packages

| Order | Work package                | Must produce                                                                     | Cannot proceed without                                            |
| ----: | --------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
|     0 | Customer Foundation closure | Ownership matrix, architecture inventory, ADR-0012, overlap decisions            | P1.0-P1.10 inventory                                              |
|     1 | Runtime trust boundary      | Authentication, sessions/tokens, MFA execution, authorization, privileged access | Security threat model and P2.0 ownership                          |
|     2 | Account identity binding    | Customer-wallet to ledger-account mapping, idempotent provisioning, repair       | P2.0 canonical identity and P2.1 authorization                    |
|     3 | Policy decision service     | Versioned, explainable capability decision                                       | P1.3, P1.9, P1.10 consolidation and P2.1                          |
|     4 | Internal transfer pilot     | Customer-aware, authorized, ledger-backed transfer                               | P2.1, P2.2, P2.3, reconciliation                                  |
|     5 | External funding/settlement | Isolated bank/NIBSS adapters, callbacks, settlement, suspense                    | Internal pilot evidence and partner approval                      |
|     6 | Product activation          | One approved product at a time                                                   | Common policy, ledger, events, reconciliation, product governance |
|     7 | Scale/extraction            | Evidence-led topology and regional resilience                                    | Production volume, DR, and capacity evidence                      |

## 3. Work that may run in parallel

The following work may be designed in parallel but may not bypass the critical path:

- P2.0 ADR drafting, data-classification review, and ownership workshops.
- P2.1 threat modeling, credential protection design, and authorization model design.
- P2.2 mapping design and reconciliation query design.
- P2.3 policy matrix workshops with Risk, Compliance, Product, and Finance.
- P2.4 transfer pilot test-plan and failure-mode design.
- P2.5 partner due diligence and settlement design.
- P2.7 capacity-model preparation.

Parallel design work must not expose an API, add a migration, or authorize a product before its dependency gate is passed.

## 4. Order constraints

1. Do not expose current internal APIs publicly before P2.1.
2. Do not let customer-wallet metadata become a ledger balance source.
3. Do not wire eligibility, risk, or compliance rules independently into each financial module.
4. Do not activate external rails before the internal pilot has reconciliation and rollback evidence.
5. Do not add product-specific financial logic before policy, authorization, idempotency, audit, and reconciliation contracts exist.
6. Do not extract services merely because the module count increases.

## 5. Phase gate evidence

Each work package must attach:

- Approved ADRs.
- Migration and rollback plan.
- Unit, integration, concurrency, and failure tests as applicable.
- Audit-event evidence.
- Idempotency and optimistic-lock evidence.
- Observability and support ownership.
- Security/privacy/risk review.
- Reconciliation evidence for financial state.
- Product governance and release approval.
