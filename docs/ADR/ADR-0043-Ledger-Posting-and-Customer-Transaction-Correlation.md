# ADR-0043: Ledger Posting and Customer Transaction Correlation

- **Status:** Proposed A5 implementation decision; Ledger integration implemented, pilot activation not approved
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Wallet, Ledger, Finance, Operations, Reconciliation, Security, Risk, and Customer Engineering
- **Scope:** Atomic internal transfer-to-Ledger posting, account validation, deterministic lock ordering, journal-line mapping, and lifecycle journal correlation
- **Task:** A5T05 — Ledger Posting and Financial Invariants Integration
- **Implementation status:** Runtime Ledger posting integration and tests added; no controller, route, scheduler, provider, settlement, or A5T06 recovery implementation added

## Context

A5T03 established the A2/A4/A3 consumer gate. A5T04 established durable transfer metadata and lifecycle states. A5T05 now needs to connect a `PROCESSING` A5 transfer lifecycle record to the existing Ledger posting boundary without creating a second balance or journal authority.

The selected effect is one internal same-currency customer-funds transfer:

```text
source LedgerAccount  --DEBIT--> amountMinor
 destination LedgerAccount  --CREDIT--> amountMinor
```

Ledger already owns account state, balance calculation, journals, lines, double-entry validation, idempotency, and deterministic account locking. A5 must supply explicit account assertions and correlate the resulting journal back to the transfer metadata. A transfer row may store `journalId` as a reference, but it does not become financial truth.

## Decision

### 1. Post through the existing Ledger boundary

`TransferLifecycleService.postToLedger(transferId, command)` is the A5T05 financial integration point. It accepts only a non-legacy A5 transfer in `PROCESSING` state and performs all writes in one PostgreSQL transaction:

```text
lock Transfer row
  -> reserve A5 Ledger-post idempotency
  -> lock source/destination LedgerAccount rows in sorted UUID order
  -> validate account dimensions and lifecycle
  -> LedgerService.postJournalInTransaction
  -> update Transfer status/journal reference
  -> Operations audit
  -> complete idempotency
  -> commit all changes atomically
```

The service does not call a controller, expose a route, create a scheduler, call an external rail, or write a balance. It calls only the existing `LedgerService.postJournalInTransaction` method for financial value movement.

### 2. Source/destination account mapping

The lifecycle metadata supplies explicit `sourceLedgerAccountId` and `destinationLedgerAccountId` values established by A3. The posting command maps them as follows:

| Transfer metadata            | Ledger posting                                                |
| ---------------------------- | ------------------------------------------------------------- |
| `sourceLedgerAccountId`      | One positive `DEBIT` line                                     |
| `destinationLedgerAccountId` | One positive `CREDIT` line                                    |
| `amountMinor`                | Same positive integer minor-unit amount on both lines         |
| `currency`                   | Journal currency and both account dimensions                  |
| `accountingUnit`             | Journal accounting unit, required to be `CUSTOMER_FUNDS`      |
| `correlationId`              | Journal correlation ID, with `transfer:<transferId>` fallback |
| transfer ID/command ID       | Minimal journal metadata for support correlation              |
| transfer reference/narration | Ledger reference/description where present                    |

The A5 post method does not add fees, commissions, FX, settlement, suspense, opening value, or additional lines. Any later multi-line or compensating-entry behavior requires a separate approved financial contract.

### 3. Ledger account validation

Before posting, A5 locks and validates both explicit accounts:

- both account IDs exist;
- both accounts are active;
- both accounts have the transfer currency;
- both accounts use `CUSTOMER_FUNDS`;
- both accounts are `LIABILITY` accounts with `CREDIT` normal balance;
- both accounts disallow negative balances; and
- source and destination account IDs are distinct.

`LedgerService.postJournalInTransaction` repeats its own authoritative account, currency, accounting-unit, balance, and journal validations. A5 does not replace or weaken those checks. A mismatch fails without a journal and is recorded as an explicit `FAILED` transfer metadata outcome when it is a known, safe rejection.

Currency and accounting-unit validation is conjunctive across:

```text
Transfer.currency
Transfer.accountingUnit
source LedgerAccount.currency/accountingUnit
 destination LedgerAccount.currency/accountingUnit
Ledger journal currency/accountingUnit
Ledger lines currency/accountingUnit
```

No implicit conversion, normalization to another account, or fallback accounting unit is permitted.

### 4. Deterministic locking and atomicity

The A5 transaction locks in this order:

1. Transfer metadata row by transfer UUID.
2. Source and destination LedgerAccount rows ordered lexicographically by UUID.
3. Ledger's own account/balance/journal rows through `postJournalInTransaction`.

The A5 account lock query always sorts the unique account IDs before applying the pessimistic write lock. Ledger applies its existing deterministic lock ordering again inside the same transaction. This prevents opposite source/destination request ordering from creating lock-order inversions.

The transfer update and Ledger journal/line inserts share the same transaction manager. If Ledger rejects the command, the known rejection is recorded as `FAILED` with no journal reference. If an unexpected database/transaction error occurs, the transaction rolls back and the transfer remains in its prior `PROCESSING` state for later recovery work; A5T06 owns the unknown-outcome recovery contract.

A successful post requires:

- exactly one Ledger journal returned by Ledger;
- exactly two customer-funds lines supplied by A5;
- equal debit and credit totals enforced by Ledger;
- a journal currency/accounting unit matching the transfer; and
- one transfer `journalId` correlation saved only after Ledger accepts the journal in the same transaction.

### 5. Idempotency and replay boundary

A5 uses a distinct Operations scope for the Ledger-post operation:

```text
wallet.transfer.ledger-post.v1
```

The caller key is namespaced with the transfer ID before reservation, and the request hash includes the immutable transfer account pair, amount, currency, accounting unit, transfer ID, and caller key. It remains distinct from:

- A5 gate scope `wallet.transfer.create.v1`;
- lifecycle metadata scope `wallet.transfer.lifecycle.v1`;
- state-transition scope `wallet.transfer.state.v1`; and
- Ledger's own journal idempotency key `transfer:<transferId>:ledger-post`.

Replay rules:

- same transfer/key/hash returns the original lifecycle view with `idempotencyReplay = true`;
- replay never calls Ledger a second time;
- a changed key payload is rejected by Operations;
- a second journal cannot be created by retrying the same logical post; and
- an unexpected transaction failure does not complete the posting idempotency record.

Full serialization/deadlock retry, commit-timeout verification, and unknown-outcome recovery remain A5T06 work. A5T05 does not add an unbounded retry loop or a local idempotency store.

### 6. Lifecycle correlation

On successful Ledger posting, the lifecycle service changes only metadata fields permitted by the A5T04 state contract:

```text
PROCESSING -> COMPLETED
Transfer.journalId = LedgerJournal.id
Transfer.completedAt = posting completion time
Transfer.stateReason = LEDGER_POSTED
```

The Transfer record is not used to calculate balances, verify journal totals, or replace Ledger history. Ledger remains authoritative for:

- LedgerAccount state;
- journal status and immutability;
- journal lines and debit/credit totals;
- account balances; and
- any reversal/compensating entry.

The transfer `journalId` is a correlation/reference field used by later support and reconciliation work. A5T08 remains responsible for independently checking that the transfer and journal relationship is consistent.

### 7. Failure behavior

Known failures that occur before a financial effect is committed are represented as explicit transfer metadata failure outcomes:

| Failure                                     | Transfer outcome                          | Journal effect                           |
| ------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| Missing source/destination LedgerAccount    | `FAILED`                                  | None                                     |
| Inactive/incompatible LedgerAccount         | `FAILED`                                  | None                                     |
| Currency mismatch                           | `FAILED`                                  | None                                     |
| Accounting-unit mismatch                    | `FAILED`                                  | None                                     |
| Ledger balance rejection/insufficient funds | `FAILED`                                  | None                                     |
| Unbalanced/rejected journal                 | `FAILED`                                  | None                                     |
| Unexpected database/transaction failure     | Transaction rollback; remains prior state | Rolled back; recovery remains later work |

A failed metadata outcome has no `journalId`, a failure code/message/status, and no completion timestamp. No failure path edits a posted journal or changes a balance outside Ledger.

## Alternatives considered

### Write debit/credit lines directly from TransferLifecycleService

Rejected. Ledger is the only financial authority and already owns balancing, account locks, balance checks, journal immutability, and line creation.

### Store a transfer balance or source/destination balance snapshot

Rejected. Balances are Ledger-derived and any copied snapshot could become a competing financial truth.

### Use the transfer idempotency key as the Ledger journal key without a scope distinction

Rejected. A5 command, lifecycle, and Ledger journal owners have different collision domains and retention rules. The Ledger child key remains distinct but deterministically linked.

### Post first and update Transfer later in a separate transaction

Rejected. A committed journal without a transfer correlation would be an uncontrolled discrepancy. The Ledger post and transfer journal reference must share one transaction boundary.

### Select Ledger accounts by customer reference or currency

Rejected. A3 supplies explicit source/destination account assertions. A5 must never select a replacement account from an opaque WalletAccount compatibility value, customer reference, alias, or currency.

## Consequences

### Positive

- Internal transfers use the existing double-entry Ledger authority.
- Source and destination account lock ordering is deterministic.
- Currency/accounting-unit mismatches fail before any journal is accepted.
- Transfer-to-journal correlation is atomic with the journal post.
- Same-request replay cannot create a second journal effect.
- Known failures remain explicit and journal-free.

### Future review items

- A5T06 must resolve commit-timeout/unknown outcomes from durable Transfer/Ledger/Operations evidence and define bounded retry behavior.
- A5T07 must add the approved transactional outbox fact without changing Ledger authority.
- A5T08 must independently reconcile journal balance, transfer status/reference, account ownership, currency, and Operations evidence.
- Finance and Ledger owners must approve the production chart/account and pilot posting configuration before activation.

## Explicitly out of scope

This ADR and A5T05 do not:

- implement A5T06 or later tasks;
- add serialization/deadlock retry loops beyond existing Ledger behavior;
- implement external providers, settlement, callbacks, suspense, notifications, or public APIs;
- create controllers, routes, schedulers, or external integrations;
- edit/delete posted Ledger journals or lines;
- implement reversals or financial corrections; or
- claim migration execution, Finance/Ledger approval, production deployment, or pilot activation.

## Implementation evidence

- [`src/transfer/transfer-lifecycle.service.ts`](../../src/transfer/transfer-lifecycle.service.ts)
- [`src/transfer/transfer-lifecycle.types.ts`](../../src/transfer/transfer-lifecycle.types.ts)
- [`src/transfer/transfer-lifecycle.ts`](../../src/transfer/transfer-lifecycle.ts)
- [`src/transfer/transfer.entity.ts`](../../src/transfer/transfer.entity.ts)
- [`src/ledger/ledger.service.ts`](../../src/ledger/ledger.service.ts)
- [`src/ledger/ledger.types.ts`](../../src/ledger/ledger.types.ts)
- [`src/transfer/transfer.module.ts`](../../src/transfer/transfer.module.ts)
- [`test/transfer-lifecycle.service.spec.ts`](../../test/transfer-lifecycle.service.spec.ts)
- [`A5-IMPLEMENTATION-PLAN.md`](../A5-IMPLEMENTATION-PLAN.md)
- [`ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md`](ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md)

## A5T05 verification record

- [x] Source and destination LedgerAccount IDs are explicit and validated.
- [x] Currency and `CUSTOMER_FUNDS` accounting-unit consistency is enforced.
- [x] Liability/credit/active/non-negative account invariants are checked before posting.
- [x] Deterministic transfer-row and sorted-account locking is implemented.
- [x] Ledger journals and debit/credit lines are created only through `LedgerService`.
- [x] Transfer journal references are saved only in the atomic posting transaction.
- [x] Known Ledger failures produce journal-free failed metadata outcomes.
- [x] Unexpected transaction failures do not complete the transfer or idempotency outcome.
- [x] Successful posting, balanced mapping, currency mismatch, accounting-unit mismatch, lock ordering, replay, and failure tests are present.
- [x] No controller, route, scheduler, provider, external integration, or A5T06 recovery implementation is introduced.
- [ ] Finance/Ledger approval and live migration/production execution evidence remain unresolved.
