# A3T02 — Binding Ownership and Financial Account Lifecycle Matrix

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T02 — Binding Ownership and Financial Account Lifecycle Contract
- **Status:** Proposed for accountable-owner approval
- **Date:** 2026-08-06
- **Decision scope:** Source ownership, binding authority, lifecycle authority, uniqueness, shared reads, prohibited writes, deactivation, and repair boundary
- **Application changes:** None
- **Database/data changes:** None

## 1. Decision summary

The **`wallet` bounded context, through a co-located A3 account-binding capability, is the single authoritative owner and writer of the binding record and binding lifecycle**.

This matrix does not make `wallet` the owner of Customer identity, CustomerWallet metadata, or ledger value:

- `customer` remains the authority for `Customer.id`, customer reference, and customer lifecycle.
- `customer-wallet` remains the authority for CustomerWallet provisioning metadata, ownership, aliases, and history.
- `wallet` remains the authority for WalletAccount and its relationship to a LedgerAccount, and additionally owns the A3 binding association.
- `ledger` remains the sole authority for LedgerAccount state, journals, lines, posted value, and ledger-derived balances.
- `operations` remains the authority for audit, idempotency, outbox, diagnostics, and operational evidence.
- `reconciliation` remains an independent, read-only control.
- A2 remains the authority for authenticated principal, authorization, MFA, session, and privileged-action context.

The binding capability owns an association, not a new financial account and not a copied balance.

> **ADR numbering note:** The A3 plan assigns ADR-0031 and ADR-0033 to the two A3 decisions represented here. `docs/ADR-INVENTORY.md` contains older conflicting future-number assignments. This matrix follows the A3 plan and does not modify the inventory.

## 2. Canonical ownership matrix

| Concept / record                                          | Canonical source owner                                                       | A3 binding role                                                                                             | Lifecycle authority                                                                    | Permitted writes                                                                        | Permitted shared reads                                                                                              | Prohibited writes                                                                                              | Required controls                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Customer identity (`Customer.id`)                         | `customer`                                                                   | Binding uses the canonical UUID as the customer subject                                                     | `customer` owns `Customer.status` and deletion state                                   | Customer service writes customer identity and lifecycle through its contract            | Binding and approved readers may verify UUID, status, deletion, and version                                         | Binding cannot create, update, delete, suspend, close, or transfer a customer                                  | A2 authorization; customer source audit; canonical UUID only                                                           |
| Customer reference (`Customer.reference`)                 | `customer`                                                                   | Compatibility/display lookup only; never binding identity                                                   | `customer`                                                                             | Customer service only                                                                   | Restricted lookup when explicitly required                                                                          | Binding cannot rewrite a reference or use it as financial identity/authorization                               | ADR-0023 namespace and privacy controls                                                                                |
| Customer-wallet provisioning (`CustomerWallet`)           | `customer-wallet`                                                            | Required metadata input; `CustomerWallet.id` is one binding edge                                            | `customer-wallet` owns `PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`                      | Customer-wallet service writes metadata status/type/currency/version under its contract | Binding may read UUID, customer UUID, type, currency, status, deletion, and version                                 | Binding cannot write CustomerWallet status, currency, type, ownership, history, aliases, or balance fields     | Existing P1.4 state machine; audit/history; optimistic version                                                         |
| Wallet ownership (`WalletOwnership`)                      | `customer-wallet`                                                            | Evidence that CustomerWallet belongs to the Customer UUID                                                   | `customer-wallet`; ownership is immutable in A3                                        | Customer-wallet provisioning creates ownership evidence                                 | Binding/reconciliation may compare `walletId` and `customerId`                                                      | Binding cannot transfer ownership, rewrite owner UUID, or create a competing ownership authority               | Foreign-key and customer-pair consistency checks; audit/history                                                        |
| Wallet aliases/history                                    | `customer-wallet`                                                            | No binding identity role                                                                                    | `customer-wallet`                                                                      | Customer-wallet service only                                                            | Binding may read history/alias only when a controlled diagnostic requires it                                        | Binding cannot use alias as identity or change history                                                         | Identifier, privacy, and append-only history controls                                                                  |
| Binding record and association state                      | `wallet` A3 account-binding capability                                       | Authoritative association of Customer UUID, CustomerWallet UUID, WalletAccount UUID, and LedgerAccount UUID | Binding capability owns `PENDING`, `ACTIVE`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`  | Binding command/lifecycle contract only                                                 | Customer-wallet read model, financial consumers, Operations, and Reconciliation may read approved minimized results | Binding cannot write any source record outside its own authority; no balance/journal mutation                  | A2 authorization; Operations audit/idempotency; active-edge uniqueness; optimistic version; independent reconciliation |
| Financial wallet (`WalletAccount`)                        | `wallet`                                                                     | One binding edge; financial facade for the mapped account                                                   | `wallet` owns `ACTIVE`, `SUSPENDED`, `CLOSED`                                          | Wallet service writes WalletAccount and wallet-to-ledger relation under its contract    | Binding may verify UUID, currency, status, ledger relation, and source version                                      | Binding cannot rewrite opaque `customerId`, change financial status as an implicit cascade, or mutate balances | Wallet/ledger trigger; currency/accounting-unit checks; audit/idempotency                                              |
| Opaque wallet customer value (`WalletAccount.customerId`) | `wallet` compatibility field; canonical customer identity remains `customer` | Compatibility evidence only; not a binding key                                                              | `wallet` source retention/history rules                                                | Existing wallet owner only, under an approved compatibility contract                    | Restricted baseline/reconciliation classification                                                                   | Binding cannot cast, normalize, rewrite, or use it as proof of Customer ownership                              | ADR-0023; restricted handling; no silent migration                                                                     |
| Ledger account (`LedgerAccount`)                          | `ledger`                                                                     | One binding edge through WalletAccount.ledgerAccountId                                                      | `ledger` owns account type, normal balance, currency, accounting unit, and `is_active` | Ledger account service/ledger owner only                                                | Binding may verify account UUID, compatibility dimensions, and active state                                         | Binding cannot change account type, normal balance, currency, unit, activity, or account ownership             | Ledger invariants; wallet-account trigger; Finance/Ledger audit                                                        |
| Journals, lines, and balances                             | `ledger`                                                                     | No binding authority; binding only references the account                                                   | `ledger`                                                                               | Ledger commands only; corrections are compensating entries                              | Authorized financial reads and independent reconciliation                                                           | Customer-wallet, binding, reports, readiness, or reconciliation cannot update/delete/post/copy value           | Immutable posted records; exact minor units; independent reconciliation                                                |
| Audit events                                              | `operations`                                                                 | Binding mutations produce audit facts through the Operations contract                                       | `operations`                                                                           | `AuditService` only                                                                     | Authorized Operations/Finance/Security readers                                                                      | Binding cannot write `audit_events` directly or log secrets/raw sensitive payloads                             | Immutable audit, redaction, retention, correlation                                                                     |
| Idempotency records                                       | `operations` with command-owner scope                                        | Binding commands use scoped reservation/replay contract                                                     | `operations`                                                                           | `IdempotencyService` only                                                               | Command owner and Operations may inspect approved status                                                            | Binding cannot use an idempotency key as a resource ID or bypass request-hash conflict behavior                | Scoped key, canonical request hash, expiry, replay, conflict                                                           |
| Outbox/operational evidence                               | `operations`                                                                 | Optional transactional fact only where a later A3 command contract approves it                              | `operations`                                                                           | `OutboxService` and approved operational contracts                                      | Operations/release controls may read minimized facts                                                                | Binding cannot publish externally or use readiness/outbox as source authority                                  | Transactional outbox, minimal payload, retention, no external A6 behavior                                              |
| Reconciliation report/discrepancy                         | `reconciliation` with Finance                                                | Independent evidence about binding/source consistency                                                       | `reconciliation` owns report result only                                               | Read-only queries/report generation                                                     | Binding owner and authorized operators may read discrepancy evidence                                                | Reconciliation cannot repair, close, reopen, reassign, or mutate source/binding records from a report          | `REPEATABLE READ`/read-only transaction; severity/owner; no shared write                                               |
| Authenticated principal and authorization                 | A2 runtime boundary                                                          | Required context before a protected binding mutation/read                                                   | A2 owns principal/session/MFA/authorization/approval                                   | A2 runtime services only                                                                | Binding consumes principal, decision, resource/action scope, correlation, and approval context                      | Binding cannot implement a competing role, MFA, session, or approval authority                                 | Fail closed; protected internal route; immutable security/audit evidence                                               |

## 3. Binding identity and cardinality rules

### 3.1 Logical binding edges

Each logical binding contains one value from each required identity edge:

```text
Customer.id
  + CustomerWallet.id
  + WalletAccount.id
  + WalletAccount.ledgerAccountId = LedgerAccount.id
```

The binding also evaluates explicit `currency`, `accountingUnit`, source lifecycle state, source versions, and binding lifecycle state. These are contract dimensions, not permission to duplicate source financial value.

### 3.2 Active uniqueness

| Scope               | Active cardinality                                                    | Rationale                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomerWallet.id` | At most one active binding                                            | One metadata provisioning record cannot claim two active financial wallets.                                                                                       |
| `WalletAccount.id`  | At most one active binding                                            | One financial wallet cannot be assigned to two customer-wallet records.                                                                                           |
| `LedgerAccount.id`  | At most one active binding                                            | Preserves the existing one-wallet-to-one-ledger-account relationship and avoids shared financial ownership.                                                       |
| `Customer.id`       | Zero or many bindings                                                 | A customer may have multiple explicitly provisioned wallet metadata records and currencies.                                                                       |
| Customer/currency   | At most one active binding for a canonical Customer UUID and currency | Multiple metadata candidates cannot be silently selected or merged; non-active candidates require controlled handling or a later approved account-class decision. |
| Historical binding  | Historical identity remains attributable and is not reused            | Closure or repair does not erase ownership evidence or permit silent reassignment.                                                                                |

The legacy `wallet_accounts(customer_id, currency)` uniqueness constraint remains a local opaque-value rule. It does not replace the canonical active-binding uniqueness rules and does not permit rewriting legacy values.

### 3.3 Active financial dimensions

An active binding requires:

- `CustomerWallet.currency = WalletAccount.currency`;
- `WalletAccount.ledgerAccountId = LedgerAccount.id`;
- `LedgerAccount.currency = WalletAccount.currency`;
- `LedgerAccount.accounting_unit = 'CUSTOMER_FUNDS'`;
- compatible customer-funds liability account type and credit normal balance;
- `allow_negative_balance = FALSE`; and
- active source states under Section 4.

No binding state may make incompatible financial dimensions appear compatible. A3 does not change money, balances, journals, or lines.

## 4. Lifecycle authority matrix

### 4.1 Source lifecycle states

| Source         | States/field                                                  | Meaning for an active binding                                                                          | Deactivation authority                       |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Customer       | `DRAFT`, `ACTIVE`, `SUSPENDED`, `CLOSED`, soft deletion       | Only `ACTIVE` and not deleted can satisfy the customer identity precondition                           | `customer` only                              |
| CustomerWallet | `PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`                    | Only `ACTIVE` and not deleted can satisfy the metadata precondition                                    | `customer-wallet` only                       |
| WalletAccount  | `ACTIVE`, `SUSPENDED`, `CLOSED`                               | Only `ACTIVE` can satisfy the financial-wallet precondition                                            | `wallet` only                                |
| LedgerAccount  | `is_active` boolean plus account dimensions                   | `TRUE` and compatible dimensions required; `FALSE` is non-active and may require repair classification | `ledger` only                                |
| Binding        | `PENDING`, `ACTIVE`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED` | `ACTIVE` only when all source preconditions and uniqueness checks pass                                 | A3 binding capability only for binding state |

### 4.2 Binding state rules

| Binding state     | Meaning                                                                    | Read/command implication                                                                           | Next states                                           |
| ----------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `PENDING`         | Awaiting approved source preconditions or binding completion               | Must not be represented as an active financial account                                             | `ACTIVE`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`    |
| `ACTIVE`          | All identity, ownership, source, dimension, and uniqueness conditions pass | May be consumed by later authorized A3/A5 contracts; state alone does not authorize money movement | `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`              |
| `SUSPENDED`       | Known reversible unavailability at a source or binding level               | Fail closed for active financial use; no automatic reactivation                                    | `ACTIVE`, `REPAIR_REQUIRED`, `CLOSED`                 |
| `REPAIR_REQUIRED` | Ambiguous, inconsistent, stale, missing, or partial-failure state          | Must be surfaced as unresolved; no reassignment or financial command                               | `PENDING` after controlled review/repair, or `CLOSED` |
| `CLOSED`          | Terminal binding closure                                                   | Never active again; source rows and history remain preserved                                       | None                                                  |

### 4.3 Normative transition rules

```text
PENDING -> ACTIVE
PENDING -> SUSPENDED
PENDING -> REPAIR_REQUIRED
PENDING -> CLOSED

ACTIVE -> SUSPENDED
ACTIVE -> REPAIR_REQUIRED
ACTIVE -> CLOSED

SUSPENDED -> ACTIVE
SUSPENDED -> REPAIR_REQUIRED
SUSPENDED -> CLOSED

REPAIR_REQUIRED -> PENDING
REPAIR_REQUIRED -> CLOSED

CLOSED -> terminal
```

- `REPAIR_REQUIRED` never transitions directly to `ACTIVE`.
- `CLOSED` never reopens or changes ownership.
- Reactivation always requires explicit authorization, current source reads, uniqueness checks, and audit evidence.
- Source status changes do not silently mutate other source rows or automatically reactivate a binding.

## 5. Source-state to binding-state decision table

This table defines the lifecycle input for A3 implementation. It is a contract decision, not a runtime implementation in A3T02.

| Observed source condition                                                                               | Binding outcome                                              | Required handling                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Customer `ACTIVE`, CustomerWallet `ACTIVE`, WalletAccount `ACTIVE`, LedgerAccount active and compatible | `ACTIVE` permitted                                           | Verify versions/uniqueness; require authorized binding mutation.                                        |
| Customer or CustomerWallet is `DRAFT`/`PENDING` and no conflicting source                               | `PENDING`                                                    | Wait for approved source activation; do not infer financial readiness.                                  |
| CustomerWallet or WalletAccount is `SUSPENDED` and identity/dimensions remain consistent                | `SUSPENDED`                                                  | Fail closed; source owner controls reactivation; binding owner must explicitly recheck before `ACTIVE`. |
| Customer is `SUSPENDED`                                                                                 | `SUSPENDED`                                                  | Customer owner controls reactivation; A3 does not implement policy or customer status changes.          |
| Customer, CustomerWallet, or WalletAccount is `CLOSED` and closure is confirmed                         | `CLOSED`                                                     | Preserve history; no reopening or reassignment.                                                         |
| LedgerAccount `is_active = FALSE` without a controlled reversible reason                                | `REPAIR_REQUIRED`                                            | Ledger/Finance must classify the state; binding cannot guess closure or suspension.                     |
| Any missing Customer, CustomerWallet, WalletAccount, or LedgerAccount                                   | `REPAIR_REQUIRED`                                            | Fail closed; no fabricated account or replacement assignment.                                           |
| Customer UUID, CustomerWallet customer UUID, or ownership evidence differs                              | `REPAIR_REQUIRED`                                            | Preserve all source values; controlled investigation only.                                              |
| Currency or accounting unit differs                                                                     | `REPAIR_REQUIRED`                                            | Fail closed; no conversion, mutation, or automatic remapping.                                           |
| More than one active binding claims an edge                                                             | `REPAIR_REQUIRED`                                            | Duplicate exception; no source row is edited by reconciliation or report.                               |
| Source timeout or ambiguous transaction result                                                          | `PENDING` or `REPAIR_REQUIRED` depending on durable evidence | Do not report active success without durable binding and independent verification.                      |

## 6. Deactivation, closure, and reassignment rules

### 6.1 Source owners

- `customer` may change only Customer identity/lifecycle under its source contract.
- `customer-wallet` may change only CustomerWallet metadata, ownership, aliases, and provisioning history under ADR-0015.
- `wallet` may change only WalletAccount state and its wallet-to-ledger relationship under its financial contract.
- `ledger` may change only LedgerAccount state and ledger-owned financial records under Ledger/Finance authority.
- A source owner must not use another source table as a shadow lifecycle writer.

### 6.2 Binding owner

The A3 binding capability may:

- create or update the binding association and its own lifecycle state after A2 authorization;
- mark the binding non-active when a controlled source check detects suspension, closure, mismatch, or repair requirement;
- record audit, idempotency, version, reason, and correlation evidence; and
- expose a minimized association result through an approved read contract.

It may not:

- update source lifecycle/status fields;
- mutate or copy balances, journals, or journal lines;
- change source ownership IDs in place;
- silently rewrite `WalletAccount.customerId`; or
- reassign a closed/repair-required binding to another source identity.

### 6.3 Transfer prohibition

Ownership transfer is prohibited in A3:

- `WalletOwnership` is immutable.
- Customer UUID, CustomerWallet UUID, WalletAccount UUID, and LedgerAccount UUID are immutable binding subjects.
- An existing binding cannot be updated to point to a different customer or account to clear a discrepancy.
- A future transfer would require a separately approved workflow, maker-checker controls, legal/retention review, and independent reconciliation.

## 7. Shared-read and prohibited-write edge matrix

| Reader/writer          | Allowed read                                                                              | Allowed write                                                      | Explicitly prohibited                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| A3 binding capability  | Customer, CustomerWallet, WalletAccount, LedgerAccount identity/state/dimension contracts | Binding record and binding lifecycle only                          | Customer, CustomerWallet, WalletAccount source compatibility value, LedgerAccount, journals, lines, balances, reconciliation reports |
| Customer-wallet module | Its own metadata and approved binding status/read result                                  | Its own metadata/ownership/alias/history                           | Financial wallet, ledger, binding record, balance, posted journals/lines                                                             |
| Wallet module          | Its own financial wallet and approved CustomerWallet source contract                      | WalletAccount and approved binding association                     | Customer source records, CustomerWallet source records, ledger posted value outside Ledger contract                                  |
| Ledger module          | Its own accounts, journals, lines, balances                                               | Ledger accounts and journals/lines through Ledger authority        | Customer identity, CustomerWallet, binding lifecycle, direct metadata ownership                                                      |
| Reconciliation         | Direct read-only source tables and binding records                                        | Report/control evidence only where existing contract permits       | Any source, binding, wallet, or ledger repair mutation                                                                               |
| Operations             | Operational facts and approved resource metadata                                          | Audit/idempotency/outbox through existing services                 | Domain source writes or financial value changes                                                                                      |
| A2                     | Principal/session/authorization/approval context                                          | Runtime access/security state through A2                           | A3-local replacement authorization or unapproved financial policy                                                                    |
| Read model/report      | Approved binding and ledger-derived read contracts                                        | Projection/cache only where later approved, never source authority | Balance storage, source mutation, status fabrication, access bypass                                                                  |

## 8. Required operational and control evidence

A3 implementation must preserve the following evidence boundaries:

- A2 principal, action, resource, scope, authorization decision, MFA/approval context where required, and correlation/request/trace context.
- Operations audit with previous/new binding state and source resource IDs, excluding secrets and unnecessary sensitive payloads.
- Scoped idempotency key and canonical request hash for retryable binding commands.
- Optimistic version/stale-state evidence for binding and source records where applicable.
- Independent reconciliation result covering identity, ownership, lifecycle, currency, accounting unit, and wallet-to-ledger relationship.
- Explicit pending, suspended, repair-required, or closed outcome for ambiguous or failed state transitions.
- Retention and legal-hold classification for binding records, audit facts, reconciliation evidence, and repair history.

Readiness, dashboards, and reports may consume this evidence but cannot become lifecycle writers.

## 9. Matrix-to-ADR consistency checks

| Check                             | ADR-0031 location       | ADR-0033 location       | Matrix evidence                                 |
| --------------------------------- | ----------------------- | ----------------------- | ----------------------------------------------- |
| Single binding owner              | Decision §1             | Lifecycle authority §1  | Binding record row names `wallet` A3 capability |
| Customer identity authority       | Decision §2 and §7      | Source lifecycle §2     | Customer row names `customer`                   |
| CustomerWallet metadata authority | Decision §7 and §8      | Source lifecycle §2     | CustomerWallet row names `customer-wallet`      |
| WalletAccount authority           | Decision §1, §7, and §8 | Source lifecycle §2     | Financial wallet row names `wallet`             |
| Ledger value/account authority    | Decision §4 and §8      | Source lifecycle §2     | Ledger/journals row names `ledger`              |
| Active uniqueness                 | Decision §3             | Active conjunction §4   | Cardinality §3                                  |
| Lifecycle states/transitions      | Decision §5             | State machine §3        | Lifecycle §4 and source table §5                |
| Ownership transfer prohibition    | Decision §6             | Transfer §6             | Transfer prohibition §6                         |
| A2 authorization                  | Decision §9             | Operational controls §8 | A2 row and controls §8                          |
| Operations audit/idempotency      | Decision §9             | Operational controls §8 | Operations row and controls §8                  |
| Independent reconciliation        | Decision §9             | Operational controls §8 | Reconciliation row and controls §8              |

## 10. A3T03 handoff boundary

A3T03 may define the wallet-provisioning-to-ledger-account mapping contract only from these recorded decision-input boundaries:

1. The binding owner is `wallet`/A3 account-binding capability.
2. CustomerWallet remains a metadata source and does not create or mutate financial value.
3. WalletAccount remains the financial wallet facade; LedgerAccount remains the financial account/value authority.
4. An active binding is one-to-one at CustomerWallet, WalletAccount, and LedgerAccount edges, with at most one active binding per canonical Customer UUID and currency.
5. Customer identity is `Customer.id`; opaque customer references are compatibility evidence only.
6. Currency and accounting-unit mismatch fails closed.
7. Source lifecycle mismatch produces a non-active or repair-required binding outcome.
8. A2 authorization, Operations evidence, and independent Reconciliation remain required dependencies.
9. No schema, migration, provisioning command, balance read model, repair executor, or runtime API is approved by this matrix.

## 11. Validation and approval record

A3T02 validation must confirm:

- [x] The matrix names one authoritative binding owner.
- [x] Every customer, metadata, wallet, ledger, binding, Operations, Reconciliation, and A2 concept has a source/lifecycle owner.
- [x] Active uniqueness is explicit for CustomerWallet, WalletAccount, and LedgerAccount edges.
- [x] Customer and currency cardinality is explicit without using opaque legacy values as canonical identity.
- [x] Shared reads and prohibited writes preserve source ownership and the ledger financial boundary.
- [x] Binding lifecycle, deactivation, closure, repair-required, and transfer-prohibition rules are explicit.
- [x] A2 authorization, Operations audit/idempotency, and independent Reconciliation dependencies are explicit.
- [x] ADR-0031 and ADR-0033 are cross-referenced consistently.
- [ ] Customer Engineering approval is recorded.
- [ ] Wallet approval is recorded.
- [ ] Ledger approval is recorded.
- [ ] Finance approval is recorded.
- [ ] Reconciliation approval is recorded.

The matrix is a proposed decision input. No accountable-owner approval is fabricated by this document, and no later A3 task may treat the matrix as formally approved until the review record is completed.

## 12. Explicitly out of scope

This matrix does not:

- create the binding entity/table, migration, foreign keys, indexes, or repository;
- implement provisioning, binding commands, read models, reconciliation queries, repair, or APIs;
- migrate or rewrite `WalletAccount.customerId` or any financial/customer source record;
- create or mutate ledger accounts, journals, lines, balances, or financial transactions;
- implement authentication, authorization, MFA, privileged approval, A4 policy, A5 money movement, A6 providers, or settlement; or
- resolve the stale ADR-number registry outside the A3 decision documents.
