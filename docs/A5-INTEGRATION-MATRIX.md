# A5 Integration and Evidence Matrix

- **Phase:** A5 — Internal Financial Pilot
- **Task:** A5T10 — A5 Integration, Pilot Release Gate, and A6 Handoff
- **Status:** Evidence package prepared; approval and activation pending
- **Classification:** Documentation-only integration and phase-exit evidence
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None
- **Evidence snapshot:** `31bda45785305546879491427a5ea53b5b4c47fa`

## 1. Purpose and evidence boundary

This matrix integrates the committed A5T01-A5T09 implementation artifacts for the bounded internal customer-to-customer transfer pilot:

```text
wallet.transfer/create
scope: INTERNAL_CUSTOMER_TO_CUSTOMER
initial planning currency: NGN, subject to pilot-control approval
```

It distinguishes:

- committed source, runtime, migration, test, and documentation evidence;
- design alignment and local automated validation;
- live database migration, deployment, route exposure, production, and operational evidence; and
- governance, accountable-owner approval, Finance/Ledger approval, and pilot activation.

No checkbox in this document claims live execution, production deployment, owner approval, or financial activation unless explicitly identified as such.

## 2. Task-to-evidence matrix

| Task                                                | Committed implementation/documentation evidence                                                                                                                                                                            | Boundary integrated                                                                                                                                                       | Automated evidence                                                            | Current status                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **A5T01 — Pilot baseline and capability selection** | [`A5-PILOT-BASELINE.md`](A5-PILOT-BASELINE.md), transfer/Wallet/Ledger/A2/A3/A4/Operations/Reconciliation inventories                                                                                                      | Internal customer-to-customer transfer selected; external rails, settlement, deposits, withdrawals, product expansion, and public exposure excluded                       | Source/document review record                                                 | Baseline committed; approval/activation not claimed                             |
| **A5T02 — Customer-aware command and correlation**  | [`ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md`](ADR/ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md), [`A5-TRANSFER-COMMAND-CONTRACT.md`](A5-TRANSFER-COMMAND-CONTRACT.md)                 | Canonical source/destination customer, WalletAccount, A3 binding, LedgerAccount, amount/currency, policy, request, correlation, causation, and idempotency references     | Contract documented; downstream tests consume the shape                       | Implemented as contract evidence; approval pending                              |
| **A5T03 — Consumer gates**                          | [`ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md`](ADR/ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md), `InternalTransferGateService`, A3 read-only binding validation               | A2 authorization -> pilot gate -> A4 evaluation -> A3 source/destination validation; no Ledger effect before gates                                                        | `test/internal-transfer-gate.service.spec.ts`, A4 tests                       | Runtime gate implemented/tested                                                 |
| **A5T04 — Lifecycle and pending outcomes**          | [`ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md`](ADR/ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md), `Transfer` metadata fields, lifecycle migration, state guard, `TransferLifecycleService` | Durable command/customer/account/policy/request/correlation/recovery metadata; `PENDING`, `PROCESSING`, `PENDING_RECOVERY`, `UNKNOWN`, `COMPLETED`, `FAILED`, `CANCELLED` | `test/transfer-lifecycle.service.spec.ts`                                     | Runtime persistence/lifecycle implemented/tested; migration application pending |
| **A5T05 — Ledger posting**                          | [`ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md`](ADR/ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md), `postToLedger`, existing `LedgerService`                                         | Sorted account locks -> account/dimension checks -> balanced debit/credit Ledger post -> transfer journal reference                                                       | Lifecycle/Ledger posting tests; existing financial invariant tests            | Runtime integration implemented/tested; Finance/Ledger approval pending         |
| **A5T06 — Retry and recovery**                      | [`ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md`](ADR/ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md), bounded retry and verification in `TransferLifecycleService`                                           | Same logical identity across serialization/deadlock retry; commit-timeout verification; deterministic unknown recovery                                                    | Serialization, deadlock, exhaustion, timeout, unknown, and replay tests       | Runtime resilience implemented/tested                                           |
| **A5T07 — Transactional outbox**                    | `transfer.completed` event contract, `OutboxService.enqueueOnce`, outbox event migration/entity fields                                                                                                                     | Ledger/Transfer/audit/idempotency/outbox facts share the successful posting transaction; deterministic event key prevents duplicates                                      | `test/outbox.service.spec.ts`, lifecycle outbox rollback/replay/payload tests | Runtime outbox implemented/tested; no external publisher                        |
| **A5T08 — Independent reconciliation**              | `TransferReconciliationService`, discrepancy types, read-only repeatable-read boundary                                                                                                                                     | Transfer -> journal -> lines -> outbox -> `LEDGER_POSTED` audit evidence; deterministic discrepancy report                                                                | `test/transfer-reconciliation.service.spec.ts`                                | Runtime read-only reconciliation implemented/tested                             |
| **A5T09 — Pilot controls**                          | [`ADR-0046-Pilot-Limits-Cohorts-and-Rollback.md`](ADR/ADR-0046-Pilot-Limits-Cohorts-and-Rollback.md), `PilotControlService`, durable control migration, environment stop switch                                            | A2 -> emergency stop -> durable enabled/cohort/currency/amount/usage/safety checks -> audit; disable stops new admission only                                             | `test/pilot-control.service.spec.ts`, gate pilot-control tests                | Runtime controls implemented/tested; activation pending                         |
| **A5T10 — Integration and phase exit**              | This package: integration matrix, route/rollback, ADR review, recovery runbook, exit checklist, approval package, A6 handoff                                                                                               | End-to-end evidence, unresolved approvals, prohibited edges, release/disable/rollback boundaries                                                                          | Full repository validation recorded below                                     | Prepared; not approved                                                          |

## 3. End-to-end implementation trace

```text
A2 authenticated principal and exact authorization
                         |
                         v
A5 customer-aware InternalTransferCommandV1
  Customer.id source/destination + explicit WalletAccount/LedgerAccount assertions
  amountMinor + currency + accountingUnit + command/request/idempotency/correlation
                         |
                         v
A5T09 pilot admission
  environment emergency stop
  durable enabled control + canonical Customer.id cohort
  currency/transaction/daily usage limits + safety thresholds
                         |
                         v
A4 wallet.transfer/create evaluation
  immutable evidence snapshot + policy/profile/version + expiry/review
  ALLOW or ALLOW_WITH_LIMITS + obligations + limits
                         |
                         v
A3 source/destination binding recheck
  CustomerWallet -> binding -> WalletAccount -> LedgerAccount
  ownership/version/lifecycle/dimension/control checks
                         |
                         v
Transfer lifecycle metadata
  PENDING -> PROCESSING
  command/customer/account/policy/request/recovery references
                         |
                         v
Atomic Ledger posting transaction
  sorted Ledger account locks
  balanced source DEBIT + destination CREDIT
  Transfer journalId correlation
  Operations audit + idempotency + transfer.completed outbox fact
                         |
                         v
A5T06 durable recovery
  bounded retry / replay / timeout verification / UNKNOWN recovery
                         |
                         v
A5T08 independent control report
  journal/line/account/currency/unit + outbox + audit evidence
  read-only discrepancies and support trace
```

A5 is an execution boundary and integration point, not a replacement for A2, A3, A4, Wallet, Ledger, Operations, Outbox, or Reconciliation.

## 4. Authority and ownership matrix

| Concept                         | Authoritative owner                                   | A5 integration behavior                                                        | Prohibited A5 behavior                                                          |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Canonical customer identity     | `customer` / `Customer.id`                            | Carry and reconcile source/destination UUIDs                                   | Use reference, alias, payment reference, provider ID, or command ID as identity |
| Pilot cohort/limits/kill switch | A5 pilot control boundary with A2-authorized mutation | Admit/deny new commands; audit decisions                                       | Modify Customer eligibility or completed financial history                      |
| A2 access                       | A2                                                    | Recheck exact principal/customer/action scope                                  | Treat A4 allow or pilot allow as authorization                                  |
| A4 policy                       | A4                                                    | Consume current decision, limits, obligations, expiry, and evidence references | Recompute policy precedence or mutate policy/source records                     |
| Customer-to-account binding     | A3 Wallet binding capability                          | Validate explicit source/destination tuples read-only                          | Infer, repair, reassign, or activate a binding                                  |
| Wallet facade                   | Wallet                                                | Carry WalletAccount IDs and relationship evidence                              | Maintain a second balance or select an account implicitly                       |
| Financial accounts and value    | Ledger                                                | Lock/post/reconcile through Ledger contracts                                   | Write balances, journals, or lines directly                                     |
| Transfer lifecycle              | A5 transfer boundary                                  | Persist metadata/state and journal reference                                   | Become the balance or journal authority                                         |
| Audit/idempotency/outbox        | Operations                                            | Use shared durable services and scopes                                         | Create local stores or treat facts as financial truth                           |
| Reconciliation                  | Reconciliation/Finance                                | Independently read and classify discrepancies                                  | Repair source rows or clear discrepancies                                       |
| External integrations           | A6/later owners                                       | None in A5                                                                     | Call banks, NIBSS, providers, settlement, callbacks, or partners                |

## 5. Integration scenarios and evidence

| Scenario                                                                                           | Expected result                                                                    | Evidence                                                                  |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Current A2 authorization, pilot admission, A4 allow, A3 bindings, Ledger accounts, and outbox path | One completed transfer, one balanced journal, one completed event fact             | Gate/lifecycle/Ledger/outbox tests and existing financial invariant tests |
| Pilot disabled or emergency stop active                                                            | New command denied; no A4 evaluation, lifecycle creation, or Ledger effect         | Pilot-control and gate tests                                              |
| Customer outside cohort                                                                            | `PILOT_COHORT_DENIED`; completed history unchanged                                 | Pilot-control test                                                        |
| Transaction/daily customer limit exceeded                                                          | Deterministic pilot denial; no financial mutation                                  | Pilot-control tests                                                       |
| A2 denied                                                                                          | `AUTHORIZATION_REQUIRED`; no pilot admission/effect                                | Gate test                                                                 |
| A4 denied/pending/expired                                                                          | `POLICY_NOT_EXECUTABLE`; no account execution                                      | Gate/A4 tests                                                             |
| Missing/stale/inactive A3 binding                                                                  | Binding failure; no Ledger effect                                                  | Gate/lifecycle tests                                                      |
| Currency/accounting-unit/account mismatch                                                          | Journal-free failure or reconciliation discrepancy                                 | Ledger/lifecycle and reconciliation tests                                 |
| Serialization/deadlock                                                                             | Bounded same-identity retry                                                        | A5T06 tests                                                               |
| Timeout after commit                                                                               | Verify durable completed Transfer/Ledger/outbox evidence without second post/event | A5T06/outbox tests                                                        |
| Unknown durable outcome                                                                            | Deterministic recovery reference and `UNKNOWN` state; no blind retry               | A5T06 tests                                                               |
| Outbox insert failure                                                                              | Transfer/Ledger/audit/idempotency transaction rolls back                           | A5T07 rollback test                                                       |
| Duplicate/replayed completed post                                                                  | Original journal/event result; no second Ledger/outbox effect                      | A5T06/A5T07 replay tests                                                  |
| Missing/duplicate/mismatched journal or event evidence                                             | Read-only deterministic discrepancy report                                         | A5T08 reconciliation tests                                                |
| Safety threshold breached                                                                          | New pilot admission denied; completed history unaffected                           | Pilot-control safety test                                                 |

## 6. Readiness and no-mutation evidence

- A2 authorization remains the access authority; A5 pilot admission is an additional release control.
- A4 remains the policy authority; A5 does not duplicate risk/restriction/eligibility/compliance precedence.
- A3 binding validation and A5T08 reconciliation are read-only with respect to source records.
- Ledger remains the only authority for financial accounts, journals, lines, balances, and posted value.
- Transfer stores lifecycle/correlation metadata and a journal reference; it does not calculate financial value.
- Operations owns audit, idempotency, outbox, metrics, and diagnostics.
- `transfer.completed` outbox payloads are minimal, versioned, redacted, and event-key protected.
- Pilot disable stops new admission; it does not cancel, reverse, delete, or edit completed transactions.
- No public API, route, scheduler, broker, external event publisher, external provider, settlement, or A6 implementation is included.

## 7. Outstanding evidence and approvals

The repository contains implementation artifacts and local automated evidence, but the following are not claimed as complete:

| Evidence/decision                             | Current state                         | Required owner/action                                                          |
| --------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| A2 phase/route/data-exposure approval         | Pending                               | Security/Architecture/Operations review                                        |
| A3 phase/binding/read/reconciliation approval | Pending                               | Wallet/Ledger/Finance/Reconciliation review                                    |
| A4 ADR-0036 through ADR-0040 approval         | Pending                               | Architecture/Product/Risk/Compliance/Security/Finance review                   |
| A5 ADR-0041 through ADR-0046 approval         | Pending                               | Architecture and accountable owners                                            |
| Live migrations through `1785753600025`       | Not claimed                           | Database/Operations controlled apply and rollback evidence                     |
| Pilot control activation                      | Not claimed; durable seed is disabled | Product/Risk/Finance/Security/Compliance approval and authorized configuration |
| Production emergency-stop configuration       | Not claimed                           | Operations/Release ownership                                                   |
| Finance/Ledger posting approval               | Pending                               | Finance/Ledger owners                                                          |
| Reconciliation/support on-call ownership      | Pending                               | Operations/Reconciliation/Support                                              |
| A6 external partner/settlement readiness      | Out of scope                          | A6 planning and governance only after A5 exit                                  |

## 8. Validation record

The A5 implementation snapshot was validated locally with:

```text
npm test -- --runInBand
  Test Suites: 46 passed, 46 total
  Tests:       253 passed, 253 total

npm run lint          PASS
npm run build         PASS
npm run format:check  PASS
```

The validation is repository implementation evidence. It does not claim live PostgreSQL migration execution, production deployment, route exposure, pilot activation, financial owner approval, or A5 approval.
