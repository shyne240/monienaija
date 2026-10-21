# A3 to A4/A5 Handoff Package

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T09 — A3 Integration, Reconciliation, and Release Gate
- **Status:** Handoff prepared; blocked until A3 and prerequisite approvals are recorded
- **Application changes in this task:** None

## 1. Handoff purpose

This package defines what A4 and A5 may consume from the A3 binding boundary and what they must not infer or write. It supplements the earlier A2 handoff input in [`A3-A4-HANDOFF-CHECKLIST.md`](A3-A4-HANDOFF-CHECKLIST.md) without modifying that completed A2 artifact.

A3 provides identity/account association and truthful read/control state. It does not provide product policy, transaction authorization, external settlement, or financial correction.

## 2. A4 permitted inputs

A4 Capability & Policy Engine may consume through approved source contracts:

- canonical `Customer.id` UUID;
- CustomerWallet provisioning type, currency, lifecycle, ownership evidence, and source version;
- customer-to-financial-account binding state and source-version evidence;
- WalletAccount identity/status/currency and its exact LedgerAccount relationship;
- LedgerAccount identity/status/currency/accounting unit/account type/normal balance as approved financial evidence;
- Ledger-derived read information through the A3 read model, with no balance copy into policy/customer metadata;
- A3 reconciliation status, discrepancy type, severity, owner, and recovery state as control evidence; and
- A2 authenticated principal/assurance/authorization context as access evidence only.

A4 must distinguish:

- customer lifecycle from CustomerWallet provisioning lifecycle;
- A2 authorization from product eligibility/policy;
- binding state from payment/transaction execution state;
- Ledger-derived balance from metadata or policy output; and
- reconciliation warnings/errors from successful financial execution.

## 3. A4 prohibited edges

A4 must not:

- replace A2 authentication, authorization, MFA, session, or privileged approval;
- use a Customer reference, wallet alias, provider ID, payment reference, or idempotency key as financial identity;
- write Customer, CustomerWallet, WalletAccount, LedgerAccount, binding, journal, line, or balance source records to make a policy result pass;
- reinterpret an unresolved `REPAIR_REQUIRED`, `STALE_BINDING`, `MISSING_BINDING`, or `LEDGER_UNAVAILABLE` state as active account eligibility;
- create customer tiers, product pricing, fees, commissions, or account classes inside the A3 handoff; or
- start A5 money movement, external provider, settlement, or payment recovery behavior.

## 4. A5 entry dependencies

A5 Internal Financial Pilot remains blocked until all of the following are approved:

- A2 authenticated principal and authorization context;
- A3 canonical binding, idempotency, read, reconciliation, and repair boundaries;
- A4 versioned policy request/result and explainability contract;
- Ledger command, journal correlation, audit, outbox, and recovery contracts;
- currency/accounting-unit and account-state checks; and
- independent Reconciliation release evidence.

A3T09 does not begin A5. It records the dependency only.

## 5. Handoff readiness

| Condition                                                 | Status             | Evidence / next action                                             |
| --------------------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| Canonical Customer UUID and account IDs are distinct      | Prepared           | A3T01 baseline and A3T02 ADRs                                      |
| Binding ownership and lifecycle are explicit              | Prepared           | A3T02 ADRs and matrix; formal approval pending                     |
| Mapping dimensions and idempotency are explicit           | Prepared           | A3T03 contract; formal approval pending                            |
| Binding persistence exists                                | Implemented/tested | A3T04 entity/migration/persistence tests; live DB evidence pending |
| Binding execution is authorized/idempotent/audited        | Implemented/tested | A3T05 service tests                                                |
| Account read model is authorized/Ledger-derived/read-only | Implemented/tested | A3T06 service tests; approved route pending                        |
| Drift report is independent/read-only                     | Implemented/tested | A3T07 service/tests                                                |
| Repair is privileged/audited/idempotent/metadata-only     | Implemented/tested | A3T08 service/tests                                                |
| A2 approval                                               | Pending            | Complete A2 approval package                                       |
| A3 approval                                               | Pending            | Complete A3 approval package                                       |
| A4 policy contract                                        | Not started by A3  | A4 planning/approval only                                          |
| A5 financial command                                      | Not started by A3  | A5 planning/approval only                                          |

## 6. Handoff result

**A4/A5 handoff status:** `BLOCKED — A3 approval and prerequisite contracts are pending`.

No A4 or A5 implementation is included in the A3T09 package.
