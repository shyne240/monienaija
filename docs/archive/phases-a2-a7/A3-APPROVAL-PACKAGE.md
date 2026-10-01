# A3 Customer-to-Financial Account Binding Approval Package

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T09 — A3 Integration, Reconciliation, and Release Gate
- **Status:** Prepared for accountable-owner approval; not approved
- **Scope:** A3 integration, reconciliation, operations, recovery, review, handoff, and exit evidence
- **Application, schema, migration, and runtime changes in this task:** None

## 1. Executive summary

A3 now has committed implementation evidence for:

- canonical Customer-to-CustomerWallet identity boundaries;
- an explicit Wallet-owned customer-to-financial-account binding record;
- WalletAccount-to-LedgerAccount compatibility and active uniqueness controls;
- authorized, idempotent binding execution;
- an authorized read-only Ledger-derived customer account view;
- independent binding/source reconciliation and drift diagnostics; and
- privileged, auditable, metadata-only repair outcomes.

The A3 implementation does not post journals, modify balances, create transfers, call external providers, or make CustomerWallet a financial authority. No binding/read/repair HTTP route was introduced without an approved exposure contract.

The package is **not an A3 approval**. The current repository still has pending A1/A2/A3 accountable-owner approvals, no live PostgreSQL migration/revert evidence in this environment, missing ADR-0034/ADR-0035 records, and unresolved ADR registry/cardinality documentation conflicts.

## 2. Evidence index

| Evidence                                                                                                                                              | A3 purpose                                                        | Status                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| [`A3-IMPLEMENTATION-PLAN.md`](A3-IMPLEMENTATION-PLAN.md)                                                                                              | Canonical task order, dependencies, acceptance, and exit criteria | Source of truth                             |
| [`A3-BINDING-BASELINE.md`](A3-BINDING-BASELINE.md)                                                                                                    | A3T01 identity map and gap register                               | Prepared                                    |
| [`ADR-0031-Customer-to-Financial-Account-Identity-Binding.md`](ADR/ADR-0031-Customer-to-Financial-Account-Identity-Binding.md)                        | A3T02 binding authority and identity decision                     | Proposed; approval pending                  |
| [`ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md`](ADR/ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md)                          | A3T03 deterministic mapping contract                              | Proposed; approval pending                  |
| [`ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md`](ADR/ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md)              | A3T02 lifecycle and deactivation decision                         | Proposed; approval pending                  |
| [`A3-BINDING-OWNERSHIP-MATRIX.md`](A3-BINDING-OWNERSHIP-MATRIX.md)                                                                                    | Source ownership, reads, writes, uniqueness, lifecycle            | Prepared; approval pending                  |
| [`A3-WALLET-LEDGER-MAPPING-CONTRACT.md`](A3-WALLET-LEDGER-MAPPING-CONTRACT.md)                                                                        | Request/result, dimension, replay, concurrency, failure contract  | Prepared; approval pending                  |
| [`A3-INTEGRATION-MATRIX.md`](A3-INTEGRATION-MATRIX.md)                                                                                                | A3T01-A3T08 integration and test trace                            | Prepared                                    |
| [`A3-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A3-ROUTE-EXPOSURE-AND-ROLLBACK.md)                                                                              | Exposure, deployment, rollback, and stop conditions               | Prepared                                    |
| [`A3-ADR-REVIEW-STATUS.md`](A3-ADR-REVIEW-STATUS.md)                                                                                                  | A3 and governing ADR review disposition                           | Prepared; open conditions remain            |
| [`A3-EXIT-CHECKLIST.md`](A3-EXIT-CHECKLIST.md)                                                                                                        | A3 acceptance, release, and exit gates                            | Prepared; not approved                      |
| [`A3-A4-HANDOFF-PACKAGE.md`](A3-A4-HANDOFF-PACKAGE.md)                                                                                                | A4/A5 handoff inputs and prohibited edges                         | Prepared; handoff blocked until A3 approval |
| [`src/migrations/1785753600021-CreateCustomerFinancialAccountBindings.ts`](../src/migrations/1785753600021-CreateCustomerFinancialAccountBindings.ts) | A3T04 persistence migration                                       | Implemented; live apply/revert pending      |
| [`src/wallet/customer-financial-account-binding.service.ts`](../src/wallet/customer-financial-account-binding.service.ts)                             | A3T05 binding execution                                           | Implemented/tested                          |
| [`src/wallet/customer-financial-account-read.service.ts`](../src/wallet/customer-financial-account-read.service.ts)                                   | A3T06 authorized read model                                       | Implemented/tested                          |
| [`src/reconciliation/reconciliation.service.ts`](../src/reconciliation/reconciliation.service.ts)                                                     | A3T07 independent binding drift control                           | Implemented/tested                          |
| [`src/wallet/customer-financial-account-binding-repair.service.ts`](../src/wallet/customer-financial-account-binding-repair.service.ts)               | A3T08 authorized repair/recovery                                  | Implemented/tested                          |

ADR-0034 and ADR-0035 are referenced by the A3 plan but are not currently present as committed ADR files. Their absence is an open approval condition, not an inferred approval.

## 3. Approval decisions requested

Accountable owners are asked to approve or return the following decisions:

1. A3 has one binding authority in `wallet`; Customer, CustomerWallet, WalletAccount, Ledger, Operations, A2, and Reconciliation retain their source/control ownership.
2. The A3 binding record and execution preserve Ledger authority and create no monetary value.
3. Active uniqueness, Customer-plus-currency scope, lifecycle states, closure, repair-required behavior, and ownership-transfer prohibition are acceptable.
4. Binding execution and repair require A2 authorization; repair additionally requires A2 privileged-action approval and separation of duties.
5. Read models expose only authorized, minimized, Ledger-derived financial information and never persist balances in Customer metadata.
6. Reconciliation is independent, read-only, and cannot repair source/binding rows.
7. A3 may hand A4 account/binding evidence and A5 binding prerequisites only after this approval is recorded.
8. No A4/A5/A6/A7/A8 implementation is included in this A3 package.

## 4. Owner approval register

| Owner                        | Required decision                                                                     | Approver | Decision/date | Conditions                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------- | -------- | ------------- | ----------------------------------------------------------------------------- |
| Customer Engineering         | Customer UUID, CustomerWallet ownership, source version, metadata boundary            | Pending  | Pending       | Must resolve customer-wallet ownership and same-currency candidate handling   |
| Wallet Engineering           | Binding authority, WalletAccount lifecycle, account provisioning/replay, repair state | Pending  | Pending       | Must approve no implicit account reassignment and route boundary              |
| Ledger Engineering           | LedgerAccount compatibility, immutability, no journal/balance mutation                | Pending  | Pending       | Must approve live schema/invariant inspection                                 |
| Finance                      | Financial-account ownership, currency/accounting unit, reconciliation severity        | Pending  | Pending       | Must approve `CUSTOMER_FUNDS` and release-blocking discrepancies              |
| Reconciliation               | Independent queries, discrepancy classes, evidence retention, no repair writes        | Pending  | Pending       | Must approve A3T07 report and A3T08 handoff semantics                         |
| Operations                   | Audit/idempotency/diagnostics, recovery evidence, support ownership                   | Pending  | Pending       | Must approve retention/correlation and incident evidence                      |
| Security / A2                | Principal, authorization, privileged approval, data exposure                          | Pending  | Pending       | Must approve protected service/route exposure and repair separation of duties |
| Architecture / release owner | A3 boundary, ADR status, rollback, A4/A5 handoff                                      | Pending  | Pending       | Must resolve missing ADR records and registry conflicts                       |

No approval, signature, date, or risk acceptance is claimed by this document.

## 5. Open risks and release conditions

| Risk/condition                                                                         | Severity               | Owner                                    | Required disposition                                              | Current state                   |
| -------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------- | ----------------------------------------------------------------- | ------------------------------- |
| A2 approval remains pending                                                            | Blocker                | Security / Architecture                  | Record A2 entry/exit approval before A3/A4 activation             | Open                            |
| A3 owner approval remains pending                                                      | Blocker                | Architecture / release owner             | Complete owner register above                                     | Open                            |
| ADR-0034 and ADR-0035 records are absent                                               | High                   | Architecture                             | Draft/review before final A3 ADR gate                             | Open                            |
| ADR-0031/0032/0033 numbering conflicts with ADR-INVENTORY                              | Medium                 | Architecture                             | Reconcile registry without changing decision history              | Open                            |
| ADR-0031 contains an inconsistent legacy same-currency trade-off sentence              | High                   | Architecture / Wallet / Finance          | Reconcile normative cardinality before schema/production approval | Open                            |
| Live PostgreSQL migration apply/revert not executed                                    | Blocker for production | Operations / Database / Ledger           | Run controlled apply/revert and constraint inspection             | Open                            |
| No approved A3 binding/read/repair route                                               | High for exposure      | A2 / Security / Wallet                   | Approve route policy before HTTP exposure                         | Open; services remain unexposed |
| `REPAIR_REQUIRED → PENDING` requires a later authorized binding retry to become active | High                   | Wallet / Operations                      | Approve and test the pending retry path before A3 activation      | Open condition                  |
| Customer-plus-currency exceptions may leave metadata candidates non-active             | Medium                 | Customer Engineering / Product / Finance | Resolve account-class policy without weakening uniqueness         | Open                            |
| Older module/schema inventory contains stale migration-head prose                      | Medium                 | Architecture / Operations                | Reconcile documentation before migration release                  | Open                            |

## 6. A4 and A5 handoff decision

A3 can provide A4 with:

- canonical Customer UUID;
- CustomerWallet provisioning and ownership evidence through its source contract;
- binding state and source-version references;
- WalletAccount/LedgerAccount identity and explicit currency/accounting-unit context;
- Ledger-derived account state and read-only control status; and
- A2 principal/authorization context without treating authorization as policy eligibility.

A3 cannot authorize A4 policy activation or A5 financial execution. A4/A5 must wait for the A3 approval and all required handoff conditions in [`A3-A4-HANDOFF-PACKAGE.md`](A3-A4-HANDOFF-PACKAGE.md).

## 7. Approval result

**Recommendation:** `PENDING — DO NOT ACTIVATE A3 FOR PRODUCTION OR BEGIN A4/A5 IMPLEMENTATION.`

The implementation and automated evidence are prepared. The phase exit is not approved until the open blockers, owner register, live database evidence, ADR records, and route/exposure conditions are resolved and recorded.
