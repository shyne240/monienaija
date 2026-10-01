# A5T01 — Internal Financial Pilot Baseline and Capability Selection

- **Phase:** A5 — Internal Financial Pilot
- **Task:** A5T01 — Internal Financial Pilot Baseline and Capability Selection
- **Status:** Baseline prepared for A5T02; no A5 runtime implementation introduced
- **Classification:** Documentation-only A5 implementation baseline
- **Review snapshot:** `d4e673d926ad42de6549a340bcc9484ece501e0b`
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Purpose and boundary

A5T01 establishes the current repository baseline for the first bounded internal financial pilot. It inventories the existing transfer, Wallet, Ledger, A2, A3, A4, Operations, Reconciliation, quote, fee, payment-reference, route, and support surfaces before A5 command implementation begins.

The recommended pilot selection is:

```text
capability: wallet.transfer
action: create
scope: internal customer-to-customer transfer
initial pilot currency: NGN, subject to the later A5 pilot-control decision
```

This is a planning selection, not a production activation or financial approval. A5T02-A5T10 must define and implement the approved command boundary, consumer gates, transaction state, Ledger integration, recovery, outbox, reconciliation, and pilot controls.

A5T01 preserves the following authorities:

```text
Customer.id                         -> canonical customer identity
CustomerWallet                      -> provisioning/ownership metadata
WalletAccount / CustomerWallet      -> wallet/account relationship boundaries
LedgerAccount                       -> financial account authority
Ledger journals/lines/balances       -> posted financial truth
A2 principal/authorization          -> runtime access authority
A3 binding/read/reconciliation      -> customer-to-account control authority
A4 policy decision                  -> capability/action eligibility authority
Operations                          -> audit/idempotency/outbox/diagnostics authority
Reconciliation                      -> independent read-only financial control
A5 transfer command                 -> future bounded execution authority only
```

A5 must not turn an existing transfer route, transfer record, policy result, account read, or diagnostic view into a competing authority.

## 2. Current repository baseline

### 2.1 Existing transfer surface

| Surface                    | Current repository artifact                                                                                                          | Current behavior                                                                                                                                                                                                                                       | A5T01 classification                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Transfer command service   | [`src/transfer/transfer.service.ts`](../src/transfer/transfer.service.ts)                                                            | Normalizes wallet IDs, amount, currency, reference, narration, and idempotency key; runs a serializable transaction; locks source/destination wallets in deterministic order; posts a two-line Ledger journal; stores completed/failed transfer state. | Existing financial compatibility implementation; not yet the complete A5 customer-aware command boundary.                  |
| Transfer persistence       | [`src/transfer/transfer.entity.ts`](../src/transfer/transfer.entity.ts), existing transfer migration                                 | Stores source/destination WalletAccount IDs, journal ID, payment reference, amount/currency, status, idempotency key, request hash, failure fields, and timestamps.                                                                                    | Existing transfer lifecycle/input. A5 must determine whether additional customer/policy/binding/state fields are required. |
| Transfer state             | [`src/transfer/transfer.enums.ts`](../src/transfer/transfer.enums.ts)                                                                | Current statuses are `COMPLETED` and `FAILED`.                                                                                                                                                                                                         | Compatibility state; pending/unknown/recovery behavior remains an A5 gap.                                                  |
| Transfer HTTP controller   | [`src/transfer/transfer.controller.ts`](../src/transfer/transfer.controller.ts)                                                      | `POST /transfers` creates a transfer and `GET /transfers/:transferId` reads one.                                                                                                                                                                       | Existing route surface; not evidence of A5-approved exposure. A2 route/data policy remains authoritative.                  |
| Wallet transaction history | [`src/transfer/wallet-transaction.controller.ts`](../src/transfer/wallet-transaction.controller.ts) and TransferService history read | Reads transfer history by wallet with pagination and sent/received direction.                                                                                                                                                                          | Existing read surface; A5 support/privacy/authorization gates remain to be reconciled.                                     |
| Transfer tests             | [`test/transfer.service.spec.ts`](../test/transfer.service.spec.ts)                                                                  | Covers successful transfer, failures, replay, changed-payload rejection, timeout-after-commit behavior, rollback, concurrency, and history.                                                                                                            | Existing implementation evidence; A5 must add customer/A2/A3/A4/pilot integration coverage.                                |

### 2.2 Existing transfer behavior that A5 must preserve or explicitly replace

The current `TransferService` already provides useful financial-core behavior:

- positive integer minor-unit amount validation;
- explicit currency validation;
- self-transfer rejection;
- active-wallet checks;
- source/destination currency matching;
- deterministic WalletAccount locking;
- serializable transaction execution;
- Ledger journal delegation;
- transfer request hashing;
- unique idempotency-key handling;
- failed-transfer result persistence for known failures; and
- retry-safe lookup after a client timeout where a committed transfer already exists.

The current implementation does **not** by itself establish the complete A5 boundary. In particular, the current service constructor does not perform the A5 sequence of:

```text
A2 authorization recheck
  -> A4 wallet.transfer/create current policy check
  -> A3 source/destination binding and account-control recheck
  -> transfer state + Ledger posting + Operations evidence
```

The current controller accepts source and destination WalletAccount IDs and an idempotency key. A5 must bind these values to the canonical customer and approved A3/A4 context rather than treating wallet IDs or route access as sufficient customer authorization.

### 2.3 Wallet and A3 account boundary

| Surface                     | Current artifact                                                                                                                                   | Current authority                                                                                  | A5 role                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Wallet facade               | [`src/wallet/wallet-account.entity.ts`](../src/wallet/wallet-account.entity.ts), [`src/wallet/wallet.service.ts`](../src/wallet/wallet.service.ts) | WalletAccount remains the financial wallet facade and stores the exact LedgerAccount relationship. | Consume approved WalletAccount identity/status/currency; do not create or reassign accounts.                 |
| Customer-to-account binding | [`src/wallet/customer-financial-account-binding.entity.ts`](../src/wallet/customer-financial-account-binding.entity.ts), binding services          | A3 owns explicit Customer-to-CustomerWallet-to-WalletAccount-to-LedgerAccount association.         | Recheck source and destination binding/read/control state before execution.                                  |
| A3 read model               | [`src/wallet/customer-financial-account-read.service.ts`](../src/wallet/customer-financial-account-read.service.ts)                                | A3 read boundary returns binding state, dimensions, warnings, and Ledger-derived balance.          | Use as account-control evidence; never infer an account from a reference, alias, currency, or policy output. |
| A3 reconciliation           | [`src/reconciliation/reconciliation.service.ts`](../src/reconciliation/reconciliation.service.ts), A3 reconciliation types                         | Independent read-only binding/source control.                                                      | A required unresolved discrepancy blocks or holds the pilot command; A5 cannot repair it.                    |
| A3 recovery                 | [`src/wallet/customer-financial-account-binding-repair.service.ts`](../src/wallet/customer-financial-account-binding-repair.service.ts)            | Privileged metadata-only binding repair.                                                           | A5 must not call repair as part of transfer execution or select a replacement account.                       |

A5 must preserve A3 states including `PENDING`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`, `MISSING_BINDING`, `STALE_BINDING`, and `LEDGER_UNAVAILABLE` as truthful non-active/control evidence.

### 2.4 Ledger and financial-core boundary

| Surface              | Current artifact                                                                                                                                           | Current authority/behavior                                                                                                                                   | A5 role                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Ledger accounts      | [`src/ledger/ledger-account.entity.ts`](../src/ledger/ledger-account.entity.ts), [`src/ledger/ledger.service.ts`](../src/ledger/ledger.service.ts)         | Ledger owns financial accounts, account type, normal balance, currency, accounting unit, active state, and balance reads.                                    | Reuse account and balance invariants; do not create an A5 balance authority.                            |
| Journal posting      | `LedgerService.postJournal` and `postJournalInTransaction`                                                                                                 | Validates balanced debit/credit lines, currency/accounting unit, account state, locks accounts deterministically, and prevents disallowed negative balances. | A5 transfer transaction delegates posting through this boundary.                                        |
| Journal/lines        | [`src/ledger/ledger-journal.entity.ts`](../src/ledger/ledger-journal.entity.ts), [`src/ledger/ledger-line.entity.ts`](../src/ledger/ledger-line.entity.ts) | Posted journal headers and lines are financial history and must not be edited/deleted for correction.                                                        | Persist a durable transfer-to-journal correlation and use compensating entries for approved correction. |
| Money representation | [`src/common/money.ts`](../src/common/money.ts), [`docs/ADR/ADR-0002-Money-Representation.md`](ADR/ADR-0002-Money-Representation.md)                       | Integer minor units and explicit currency; no floating-point financial arithmetic.                                                                           | Reuse exact amount/currency normalization and tests.                                                    |
| Financial invariants | [`test/financial-invariants.spec.ts`](../test/financial-invariants.spec.ts)                                                                                | Covers balanced journals, signed balances, reversals, conservation, and pre-transaction rejection.                                                           | A5 adds transfer-specific command/gate/recovery evidence without weakening these invariants.            |

The bounded pilot must produce one balanced internal journal: source customer-funds debit and destination customer-funds credit in one explicit currency/accounting unit. A5 must not mutate balances directly.

### 2.5 A2 runtime identity/access boundary

| Surface                           | Current artifact                                                                                                             | A5 role                                                                                                                       | Prohibited interpretation                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Principal and authorization types | [`src/authorization/authorization.types.ts`](../src/authorization/authorization.types.ts)                                    | Supply authenticated principal, customer scope, audience, roles/scopes, assurance, request context, and authorization result. | A4 policy eligibility is not A2 authorization.                      |
| Authorization service             | [`src/authorization/authorization.service.ts`](../src/authorization/authorization.service.ts)                                | Recheck the exact internal command/resource/customer scope before any mutation.                                               | A permission row, route parameter, or A4 `ALLOW` cannot replace A2. |
| Runtime route guard               | [`src/authorization/runtime-access.guard.ts`](../src/authorization/runtime-access.guard.ts)                                  | Retain protected route/service boundary for any later exposure.                                                               | Existing route registration is not pilot authorization.             |
| Route policy registry             | [`src/authorization/route-policy-registry.ts`](../src/authorization/route-policy-registry.ts)                                | Future A5 exposure must use an explicit approved route policy.                                                                | No A5 route is public by default.                                   |
| Security/privileged access        | A2 services, approval types, and [`docs/A2-SECURITY-DATA-PROTECTION-CHECKLIST.md`](A2-SECURITY-DATA-PROTECTION-CHECKLIST.md) | Use only where command/recovery scope requires it.                                                                            | A5 does not issue sessions, MFA, or approvals.                      |

The current transfer controller is not an A5 approval boundary by itself. A5T03 must reconcile the existing route/service path with A2 authorization before command execution.

### 2.6 A4 capability-policy boundary

| Surface                 | Current artifact                                                                                                                                              | A5 role                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer policy profile | `profile.wallet-transfer-create.v1` and `wallet.transfer/create` in [`src/policy/capability-policy.profiles.ts`](../src/policy/capability-policy.profiles.ts) | Request/reuse the current A4 policy result for the same Customer UUID, capability, action, context, and time.                                                        |
| Deterministic evaluator | [`src/policy/capability-policy.service.ts`](../src/policy/capability-policy.service.ts)                                                                       | Consume `ALLOW`/`ALLOW_WITH_LIMITS` only after A2 admission and before financial execution.                                                                          |
| Currentness/recovery    | [`src/policy/capability-policy-recovery.service.ts`](../src/policy/capability-policy-recovery.service.ts)                                                     | Reject expired, review-due, stale, conflicting, unavailable, superseded, pending, denied, suspended, or unknown policy outcomes as required by the command contract. |
| Limits and obligations  | A4 profile output, exact minor-unit limits, and recheck obligations                                                                                           | Use A4 output as policy evidence; enforce current usage/limits again at the execution boundary.                                                                      |
| Explanations            | [`src/policy/capability-policy-explanation.service.ts`](../src/policy/capability-policy-explanation.service.ts)                                               | Provide approved safe support/customer/operator explanation only after A2 audience authorization.                                                                    |
| A4 persistence/replay   | A4 policy entities, repositories, migration, and replay artifacts                                                                                             | Preserve policy decision/snapshot/profile references and no-source-mutation behavior.                                                                                |

A5 must not embed a second transfer eligibility/risk/restriction/limit evaluator. The current transfer service has no complete A4 gate and is therefore an A5 integration gap, not a second policy authority.

### 2.7 Operations and Reconciliation boundaries

| Surface                       | Current artifact                                                                                         | A5 role                                                                              | Prohibited behavior                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Audit                         | [`src/operations/audit.service.ts`](../src/operations/audit.service.ts), `AuditEvent`                    | Record safe command, policy, financial, and recovery facts through Operations.       | No direct audit-table writer or raw sensitive payload.    |
| Idempotency                   | [`src/operations/idempotency.service.ts`](../src/operations/idempotency.service.ts), `IdempotencyRecord` | Use scoped key/request hash and durable replay/conflict behavior.                    | No module-local in-memory idempotency authority.          |
| Outbox                        | [`src/operations/outbox.service.ts`](../src/operations/outbox.service.ts), `OutboxEvent`                 | Store a minimal transfer fact atomically with the owning transaction where approved. | No external publisher or event-as-financial-truth.        |
| Metrics/diagnostics/readiness | Operations and Production services                                                                       | Observe retry, failure, latency, outbox, readiness, and pilot controls.              | Metrics/diagnostics cannot authorize or repair.           |
| Reconciliation                | [`src/reconciliation/reconciliation.service.ts`](../src/reconciliation/reconciliation.service.ts)        | Independently verify transfer/journal/account/currency/control consistency.          | No report-driven source mutation or financial correction. |

## 3. Pilot scope selection

### 3.1 In scope

The A5T01 baseline selects the following bounded pilot for A5 implementation planning:

- Internal customer-to-customer transfer only.
- Capability `wallet.transfer`, action `create`.
- Same-currency transfer, initially constrained to NGN for the pilot boundary unless a later A5 control explicitly expands the approved currency set.
- One canonical customer subject and two explicitly identified WalletAccount/LedgerAccount targets.
- Active, current A3 binding/account-control evidence for the relevant customer/account scope.
- Current A2 authorization for the exact command/resource/customer scope.
- Current A4 `ALLOW` or `ALLOW_WITH_LIMITS` for `wallet.transfer/create` with valid expiry/review and exact limits.
- Positive integer minor-unit amount within the declared A4/pilot limits.
- One balanced Ledger journal: source debit and destination credit.
- Durable transfer state, command/request/correlation/causation trace, audit, idempotency, and minimal internal outbox fact.
- Independent read-only Reconciliation and support trace evidence.
- Controlled internal pilot cohort and command-level disable/rollback controls defined by later A5 tasks.

This selection is a bounded planning decision. It does not activate the pilot or authorize any existing route.

### 3.2 Explicitly out of scope

The following are not part of the A5T01 pilot selection:

- External banks, NIBSS, providers, settlement, callbacks, suspense, external funding, or partner reconciliation.
- Deposit, withdrawal, generic payment execution, bill payment, airtime, cards, QR, virtual accounts, payroll, savings, credit, or product expansion.
- Multi-currency conversion, FX, rate lookup, or cross-currency transfer.
- Fees, commissions, pricing, customer tiers, or product-specific financial state unless separately approved by a later A5 task.
- Public APIs, customer web/mobile channels, notification delivery, background schedulers, and external event publishing.
- A2 authentication/session/MFA/authorization implementation.
- A3 binding creation, repair, reassignment, or account provisioning.
- A4 policy/profile/risk/compliance/eligibility source mutation or policy redesign.
- Direct balance mutation, journal-line editing, financial correction, or reconciliation repair.
- A5 implementation of any command, entity, migration, controller, route, or runtime behavior in A5T01.

## 4. Authority and ownership matrix

| Concept                             | Authoritative owner                  | Current implementation evidence                                                        | A5 pilot use                                                     | Prohibited A5 write                                                      |
| ----------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Canonical customer identity         | `customer`                           | [`src/customer/customer.entity.ts`](../src/customer/customer.entity.ts), `Customer.id` | Subject of the transfer command and A2/A3/A4 checks              | Do not use `Customer.reference`, alias, or payment reference as identity |
| Customer-wallet metadata            | `customer-wallet`                    | CustomerWallet entities/service                                                        | Provisioning/ownership context only through A3                   | Do not make it a balance or transfer authority                           |
| Financial wallet facade             | `wallet`                             | `WalletAccount`, WalletService, A3 read/binding services                               | Explicit source/destination wallet targets                       | Do not select/reassign accounts implicitly                               |
| Customer/account binding            | A3 `wallet` binding capability       | `CustomerFinancialAccountBinding`, A3 read/reconciliation/repair                       | Verify source/destination binding and control state              | Do not bind, repair, reassign, suspend, or close from transfer execution |
| Financial accounts and posted value | `ledger`                             | LedgerAccount, LedgerJournal, LedgerLine, LedgerService                                | Post one balanced journal through Ledger                         | Do not write balances/journals/lines outside Ledger                      |
| Runtime access                      | A2                                   | AuthorizationService, RuntimeAccessGuard, route registry                               | Authorize exact command/resource/customer scope                  | Do not use A4 policy or permission metadata as authorization             |
| Capability policy                   | A4                                   | Policy evaluator, transfer profile, persistence/recovery/explanation artifacts         | Validate current `wallet.transfer/create` result and obligations | Do not duplicate policy precedence or rewrite policy records             |
| Transaction lifecycle               | Future A5 transfer command boundary  | Existing `Transfer` is compatibility input; A5 state contract is later                 | Own bounded transfer command state/correlation                   | Do not let an existing transfer route silently define A5 behavior        |
| Audit                               | Operations                           | AuditService/AuditEvent                                                                | Record safe command and financial lifecycle facts                | Do not write audit tables directly or include secrets                    |
| Idempotency                         | Operations with A5 command scope     | IdempotencyService/IdempotencyRecord                                                   | Reserve/replay/conflict command effects                          | Do not use wallet ID, payment reference, or correlation as key identity  |
| Outbox                              | Operations                           | OutboxService/OutboxEvent                                                              | Durable minimal internal transfer fact                           | Do not publish externally or treat event as financial truth              |
| Reconciliation                      | Reconciliation/Finance               | ReconciliationService and independent reports                                          | Verify source/financial consistency read-only                    | Do not repair rows or clear a failure from the report                    |
| Support/diagnostics                 | Operations/Production with A2 access | Diagnostics/readiness/request context plus A4 explanation                              | Trace command safely for approved support audiences              | Do not expose raw risk/compliance/credential/financial-control data      |

## 5. Current transfer gap and dependency register

The following gaps are implementation inputs for A5T02-A5T10. They are not implemented by A5T01.

| ID      | Current baseline finding                                                                                                                                                            | Impact on internal pilot                                                                    | Future task       | Required next action                                                      | Stop/rollback behavior                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A5-G001 | Existing transfer command is wallet-ID based and does not define a canonical Customer UUID command envelope.                                                                        | A transfer could be traceable to wallets without proving the customer/policy scope.         | A5T02             | Define customer/account/correlation/idempotency command contract.         | Keep the pilot command unavailable.                                 |
| A5-G002 | Existing `TransferService` does not establish the complete A2 authorization, A4 policy, and A3 binding gate sequence.                                                               | An existing route/service could execute without all A5 consumer gates.                      | A5T03             | Add one command-bound gate before any financial mutation.                 | Reject before transaction/ledger entry.                             |
| A5-G003 | Existing transfer status is `COMPLETED`/`FAILED` and does not model pending or unknown commit outcomes as an explicit A5 state.                                                     | Timeout/recovery behavior could be misreported as failure or success.                       | A5T04/A5T06       | Define durable pending/unknown/recovery states and lookup behavior.       | Preserve ambiguity and block financial retry.                       |
| A5-G004 | Existing transfer persistence contains journal/idempotency/failure fields but no complete A4 decision, A3 binding, customer, or recovery correlation contract.                      | Support and reconciliation cannot prove the full customer-to-policy-to-journal chain.       | A5T02/A5T04       | Define required immutable references and lifecycle fields.                | Keep incomplete records non-executable.                             |
| A5-G005 | Existing transfer path delegates Ledger posting and has serializable retry behavior, but A5 must prove command-level customer/account/policy gates and exact financial correlation. | Financial invariants may pass while the customer-aware command boundary remains incomplete. | A5T05/A5T06       | Integrate the approved gate output with Ledger posting and recovery.      | Stop on any identity/dimension/policy mismatch.                     |
| A5-G006 | Existing audit/outbox/metrics integrations are optional constructor dependencies in `TransferService`; no A5 transfer event contract is defined.                                    | A completed/failed transfer may lack the required atomic Operations evidence.               | A5T06/A5T07       | Define required transactional audit/outbox behavior and event schema.     | Fail closed or enter controlled recovery if evidence cannot commit. |
| A5-G007 | Existing Reconciliation is independent, but no A5 transfer-to-journal-to-account reconciliation trace is defined.                                                                   | A transfer could be operationally complete without an independent consistency check.        | A5T08             | Add read-only transfer reconciliation and support trace contract.         | Block pilot continuation on unresolved financial discrepancy.       |
| A5-G008 | Existing `/transfers` controller is registered before A5 pilot gates are implemented.                                                                                               | Route existence could be mistaken for approved pilot exposure.                              | A5T03/A5T09/A5T10 | Retain A2 route ownership and define a separate A5 exposure/disable gate. | Keep route/command disabled or protected.                           |
| A5-G009 | No pilot cohort, amount/currency envelope, kill switch, or explicit stop-condition contract exists.                                                                                 | A5 could broaden financial exposure before evidence is complete.                            | A5T09             | Define bounded cohort, limits, disable, rollback, and support controls.   | Stop new commands; preserve completed financial history.            |
| A5-G010 | No external settlement/provider boundary is required for the recommended internal transfer.                                                                                         | Adding provider behavior would expand scope and risk.                                       | A6                | Keep external integrations excluded from A5.                              | Reject/route external requests outside the pilot.                   |

## 6. Pilot stop conditions

A5 implementation or later pilot activation must stop when:

- A2 authorization or protected command context is missing, denied, stale, or mis-scoped.
- A4 policy is missing, expired, superseded, pending, denied, suspended, integrity-mismatched, or unavailable.
- A3 source/destination binding or account-control state is missing, stale, repair-required, closed, suspended, incompatible, or reconciliations are unresolved.
- Customer, WalletAccount, LedgerAccount, currency, or accounting-unit identity cannot be established explicitly.
- Amount/limit/usage evidence is missing, incompatible, stale, or exceeds the approved boundary.
- A transfer would require a second journal, direct balance write, in-place correction, or implicit account selection.
- Idempotency, audit, outbox, diagnostics, or request/correlation evidence cannot be persisted safely.
- Reconciliation reports an error, journal/transfer linkage is missing, or financial conservation fails.
- A timeout/unknown outcome cannot be verified from durable Transfer/Ledger/Operations evidence.
- A proposed change introduces external providers, settlement, notifications, public exposure, or an unapproved product capability.

The safe response is to reject or hold new commands, preserve evidence, and escalate to the owning boundary. It is never to weaken a gate or edit a source row.

## 7. Dependency and rollback assumptions

| Dependency          | Required A5 assumption                                                                    | If unavailable                     | Rollback/disable boundary                                              |
| ------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| A2                  | Principal and exact command authorization are current and auditable.                      | No command execution.              | Keep protected route/service unavailable.                              |
| A3                  | Source/destination bindings and dimensions are explicit/current.                          | No account selection or execution. | Leave binding/source state unchanged; use A3 recovery only through A3. |
| A4                  | Current policy result and immutable evidence/profile references are available.            | No policy-dependent execution.     | Preserve historical policy records; require new evaluation.            |
| Ledger              | Account locking, double-entry, balance, currency, and journal immutability are available. | No financial effect.               | Roll back the command transaction; never edit posted value.            |
| Operations          | Idempotency/audit/outbox/request context are durable.                                     | No untraceable command.            | Block or hold until evidence path is restored.                         |
| Reconciliation      | Independent transfer/journal/account checks are available.                                | No pilot progression or release.   | Preserve records; investigate without repair writes.                   |
| Support/diagnostics | Approved trace and safe audience filtering exist.                                         | No broad pilot exposure.           | Restrict support output to safe internal evidence.                     |

A5T01 does not select migration strategy, route exposure, cohort size, or financial rollback execution. Those decisions belong to A5T02-A5T10.

## 8. A5T01 validation record

- [x] Existing transfer, Wallet, Ledger, A2, A3, A4, Operations, Reconciliation, quote, fee, payment-reference, and route artifacts were reviewed.
- [x] Canonical ownership is identified for customer identity, accounts, policy, posting, audit, idempotency, outbox, and reconciliation.
- [x] Existing TransferService behavior is classified as compatibility input rather than silently declared the complete A5 command boundary.
- [x] The recommended internal customer-to-customer transfer pilot and its explicit exclusions are recorded.
- [x] Current transfer idempotency, failure, transaction, audit, outbox, route, and support gaps are assigned to later A5 tasks.
- [x] A5 dependencies, stop conditions, rollback assumptions, and prohibited capabilities are documented.
- [x] No application source, entity, migration, service, controller, API, route, scheduler, provider integration, financial behavior, or runtime activation was changed.

### Evidence limitations

- This baseline reviews committed source and architecture artifacts; it does not run live customer, wallet, Ledger, or reconciliation data census queries.
- Existing transfer tests prove compatibility behavior only. They do not prove that the A5 command gates, pilot controls, or A5 state model are implemented.
- A5T01 selects a bounded planning scope. A5T02-A5T10 must define, implement, test, and gate the command before any pilot activation.
