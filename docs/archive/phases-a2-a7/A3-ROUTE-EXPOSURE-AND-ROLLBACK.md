# A3 Route Exposure, Deployment, and Rollback Evidence

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T09 — A3 Integration, Reconciliation, and Release Gate
- **Status:** Prepared for review; not approved for production activation
- **Classification:** Internal route/exposure and rollback evidence
- **Application changes in this task:** None

## 1. Exposure decision

A3T09 introduces no new HTTP controller, route, API version, public endpoint, partner endpoint, callback, or external integration.

The A3 runtime capabilities are currently service-owned and are not public exposure:

| Capability                            | Current owner                                             | Current exposure                                | A2 requirement                                                     |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| Customer-wallet metadata              | `CustomerWalletController` / `customer-wallet`            | Existing `/customers/:id/wallets` routes        | Protected customer/operator route; not financial account authority |
| Financial wallet and balance facade   | `WalletController` / `wallet`                             | Existing `/wallets` routes                      | Protected financial route; balance remains Ledger-derived          |
| Binding execution                     | `CustomerFinancialAccountBindingService` / `wallet`       | No A3 binding route                             | A2 principal and authorization required at service boundary        |
| Customer financial account read model | `CustomerFinancialAccountReadService` / `wallet`          | No A3 account-view route                        | A2 self/assigned scope required at service boundary                |
| Binding reconciliation                | `ReconciliationService`                                   | Existing internal reconciliation report surface | Existing internal route protection and read-only control boundary  |
| Binding repair                        | `CustomerFinancialAccountBindingRepairService` / `wallet` | No repair route                                 | A2 authorization plus privileged-action approval required          |

No A3 capability is public merely because a service or existing internal route exists. A separate approved route policy is required before any binding, account-view, or repair endpoint can be exposed.

## 2. Existing route boundaries retained

A3 leaves these existing route owners and paths unchanged:

- `/customers/:id/wallets...` — CustomerWallet metadata only.
- `/wallets...` — financial WalletAccount facade and Ledger-derived balance reads.
- `/internal/reconciliation/report` — independent reconciliation report.
- `/internal/reconciliation/trial-balance` — read-only trial balance.
- `/internal/reconciliation/finance` — finance verification.
- `/internal/reconciliation/accounts/:accountId/activity` — read-only account activity.

A3 does not merge `/customers/:id/wallets` with `/wallets`, does not expose Ledger IDs through a new public route, and does not add a customer-facing balance endpoint.

## 3. Deployment sequence evidence

The A3 schema and runtime package must be deployed in this order when production activation is approved:

1. Confirm A2 route/service protection, database backup, migration-head compatibility, and release owner.
2. Apply migration `1785753600021-CreateCustomerFinancialAccountBindings` using the existing migration runner.
3. Verify composite foreign keys, active uniqueness, source-version checks, compatibility trigger, and binding indexes.
4. Verify the production readiness expected migration head is `1785753600021 / CreateCustomerFinancialAccountBindings1785753600021`.
5. Deploy the A3 service/read/reconciliation/repair package behind existing internal access controls.
6. Run read-only A3 reconciliation and synthetic integration checks before allowing any operational use.
7. Enable an approved internal command/read route only after route policy, authorization, support ownership, and rollback evidence are signed off.

No step creates an opening balance, posts a journal, changes a LedgerLine, or changes a customer balance.

## 4. Rollback and stop conditions

### 4.1 Immediate stop conditions

Stop A3 activation and keep all A3 command/read/repair exposure disabled when any of the following occurs:

- migration application fails or the expected migration head is not `1785753600021`;
- binding reconciliation returns `ERROR` or query-unavailable evidence;
- duplicate active binding or ownership discrepancy is detected;
- currency/accounting-unit/LedgerAccount compatibility fails;
- A2 authorization or privileged approval is unavailable, stale, or mis-scoped;
- audit or idempotency evidence cannot be persisted;
- a customer read would fabricate an account or balance; or
- any A3 path attempts to post a journal or mutate financial value.

A readiness warning is not a repair authorization. Warning ownership and acceptance must follow existing Production/Maturity policy.

### 4.2 Application rollback

A previous application version must not be considered rollback-compatible solely because it does not call the new A3 services. The previous readiness contract may expect migration head `1785753600020`, while the A3 schema head is `1785753600021`.

Before an application rollback is approved:

- confirm whether the previous build can safely start with the A3 schema present;
- preserve the A3 binding table and evidence if the schema remains deployed;
- keep A3 routes/services disabled if the previous build cannot consume the new schema;
- do not remove or rewrite WalletAccount, LedgerAccount, journal, line, or balance records; and
- record the release decision, schema state, owner, and correlation ID.

A forward-compatible application rollback plan is a release-owner decision, not an automatic A3 behavior.

### 4.3 Schema rollback

Migration down is destructive to A3 binding metadata and must be treated as a controlled rollback, not an ordinary retry:

1. Disable all A3 binding/read/repair exposure.
2. Confirm no A3 binding operation is in progress.
3. Export or preserve required binding, audit, idempotency, reconciliation, and legal-hold evidence according to the approved retention policy.
4. Confirm Finance, Wallet, Ledger, Reconciliation, Operations, Security, and release-owner approval.
5. Revert only migration `1785753600021-CreateCustomerFinancialAccountBindings`.
6. Verify that source `customers`, `customer_wallets`, `wallet_accounts`, `ledger_accounts`, `ledger_journals`, and `ledger_lines` remain present and unchanged.
7. Keep the application unavailable or on a schema-compatible build until readiness passes.

The A3 migration down path must not be used to correct a financial discrepancy. It drops binding metadata and binding constraints only; financial correction belongs to Ledger/Finance processes outside A3T09.

## 5. Recovery boundaries

| Failure                        | Allowed A3 response                                        | Prohibited response                                | Owner                    |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------- | ------------------------ |
| Stale/duplicate/orphan binding | Reconciliation evidence and A3T08 approved metadata repair | Silent reassignment or source rewrite              | Wallet / Reconciliation  |
| Failed binding command         | Idempotent retry or pending/repair-required outcome        | Second account selection using a new arbitrary key | Wallet / Operations      |
| Ledger read failure            | Null/unavailable customer read with warning                | Fabricated balance                                 | Ledger / Wallet          |
| Audit/idempotency failure      | Fail closed and preserve error evidence                    | Report successful binding without evidence         | Operations               |
| Schema incompatibility         | Block readiness and deployment                             | Start with an unverified migration head            | Production / Operations  |
| Reconciliation `ERROR`         | Block release or require approved escalation               | Mutate rows to make report pass                    | Reconciliation / Finance |
| Authorization/approval failure | Reject command/repair                                      | Bypass A2 or privileged approval                   | Security / Operations    |

## 6. Rollback evidence status

- [x] No new A3 route or public API is introduced by A3T09.
- [x] Existing route ownership is documented.
- [x] Migration head and deployment sequence are identified.
- [x] Application rollback limitations are explicit.
- [x] Schema rollback preserves financial source tables in the documented procedure.
- [x] No A3 rollback path posts compensating journals or mutates balances.
- [ ] Live PostgreSQL apply/revert evidence is recorded.
- [ ] Accountable release-owner and Finance/Ledger rollback approval is recorded.

This document is a rollback decision input. It does not authorize deployment, exposure, migration revert, or A4/A5 activation.
