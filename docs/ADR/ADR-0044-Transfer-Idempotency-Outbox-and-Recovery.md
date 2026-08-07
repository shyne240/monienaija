# ADR-0044: Transfer Idempotency, Outbox, and Recovery

- **Status:** Proposed A5 resilience decision; A5T06 recovery implementation added, outbox deferred
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Operations, Ledger, Finance, Reconciliation, Security, Wallet, and Customer Engineering
- **Scope:** Internal transfer idempotency, bounded transaction retry, commit-timeout verification, and unknown-outcome recovery
- **Tasks:** A5T06 — Idempotency, Concurrency, and Transaction Recovery; A5T07 — Transactional Outbox and Internal Transfer Event Contract
- **Implementation status:** A5T06 retry/recovery behavior and tests added; A5T07 outbox implementation is not included

## Context

A5T04 added durable transfer lifecycle states and A5T05 connected `PROCESSING` transfers to the existing Ledger posting boundary. A Ledger post can still encounter PostgreSQL serialization/deadlock failures, a client-visible timeout after a commit, or an error whose commit outcome cannot be established locally.

The safe boundary must:

- reuse Operations idempotency rather than create a local map/table;
- retry only known PostgreSQL serialization/deadlock failures, with a bounded attempt count;
- preserve the same transfer identity, account pair, amount, and Ledger child idempotency key across retries;
- verify durable Transfer and Ledger evidence before reporting success after an ambiguous error; and
- persist `UNKNOWN` with a deterministic recovery reference when no financial outcome can be established.

An unknown result must never become an optimistic success or a blind financial retry. Ledger remains the only authority for journals, lines, balances, and posted value.

## Decision

### 1. Bounded retry boundary

`TransferLifecycleService.postToLedger` runs the existing atomic posting operation in a `SERIALIZABLE` transaction with a maximum of three attempts.

Only PostgreSQL errors with these SQLSTATE codes are retried:

```text
40001  serialization_failure
40P01  deadlock_detected
```

The retry uses the same:

- transfer ID;
- source/destination LedgerAccount IDs;
- amount, currency, and accounting unit;
- Ledger child idempotency key `transfer:<transferId>:ledger-post`; and
- Operations Ledger-post idempotency scope/key/request hash.

A fourth attempt is never made. When all three attempts fail with a retryable transaction error, the service returns a deterministic bounded-retry conflict and does not report a financial success. No unbounded loop, distributed cache, scheduler, broker, or provider retry is introduced.

Non-retryable `QueryFailedError` values and explicit HTTP/domain rejections are not converted into blind retries. Known Ledger rejections retain the A5T05 journal-free failure behavior. Unexpected non-HTTP failures are treated as potentially ambiguous and enter durable verification.

### 2. Commit-timeout and ambiguous-outcome verification

When the atomic posting call raises an unexpected non-HTTP error after the transaction boundary may have committed, A5 verifies durable evidence in this order:

1. Read the Transfer row by its immutable transfer ID.
2. If the transfer is `COMPLETED` with a journal ID, read that exact Ledger journal through `LedgerService.getJournal`.
3. Verify journal identity, child idempotency key, currency, accounting unit, total, exactly two lines, source debit, destination credit, and exact amount/dimensions.
4. If the journal evidence is valid, return the committed transfer result without posting again.
5. If the transfer is still `PROCESSING` but has a valid journal reference, resolve it through the existing lifecycle transition to `COMPLETED` with the deterministic recovery reference.
6. If the transfer is already an explicit `FAILED`, `CANCELLED`, `UNKNOWN`, or `PENDING_RECOVERY` outcome without a journal, return that durable outcome.
7. If the transfer remains unresolved and no valid journal evidence exists, transition it to `UNKNOWN` with a deterministic recovery reference.
8. If durable verification or unknown-state persistence itself is unavailable, throw `TransferOutcomeUnknownException` with the same recovery reference and do not claim success.

The recovery reference is derived from the immutable transfer ID and Ledger-post purpose:

```text
transfer-recovery:<sha256(transferId + ":ledger-post")>
```

The reference is stable across repeated verification attempts and is stored in the A5 lifecycle state. It is not a command ID, idempotency key, journal ID, or financial authority.

### 3. Duplicate and replay protection

A5T06 reuses the existing Operations-backed Ledger-post scope:

```text
wallet.transfer.ledger-post.v1
```

The Ledger-post reservation is distinct from the A5 gate, lifecycle metadata, state-transition, and Ledger journal scopes. Same-key/same-hash behavior returns the stored lifecycle result with replay metadata. A changed request hash is rejected. A replay never calls Ledger a second time.

Ledger's own child idempotency key remains the final financial duplicate guard. The transfer lifecycle cannot create a second journal by changing its state, using another trace ID, or retrying after a timeout.

### 4. Unknown state rules

`UNKNOWN` is a truthful non-success state:

- it retains the original command/account/policy/request/correlation identity;
- it has the deterministic recovery reference;
- it does not claim that a journal is absent when evidence is unavailable;
- it does not authorize a new account target;
- it does not instruct a caller to retry blindly; and
- it can only be resolved by a later controlled recovery with the same recovery lineage.

A verified `COMPLETED` transfer is never downgraded to `UNKNOWN`. A completed row with missing or invalid journal evidence raises an unknown-outcome error rather than editing the completed row. Independent Reconciliation remains responsible for reporting that discrepancy.

### 5. Atomicity and authority boundaries

The retry/recovery code does not write Ledger rows directly. It uses:

- `TransferLifecycleService` for transfer metadata/state;
- `LedgerService` for journal/line posting and journal reads; and
- `IdempotencyService` for durable Operations reservations and replays.

The transfer and Ledger journal update remain one transaction for each posting attempt. A transaction that fails before commit rolls back the transfer update, Ledger journal/line writes, and idempotency completion together. A timeout after commit is resolved from durable evidence rather than from a new financial write.

No audit/outbox record is treated as financial truth. A5T06 records the recovery/state audit through the existing lifecycle service; the transactional outbox event contract is A5T07 work.

## Alternatives considered

### Retry every exception

Rejected. A timeout, integrity error, application bug, or unknown database failure cannot safely be treated as a retryable serialization failure. Only SQLSTATE `40001` and `40P01` receive bounded transaction retry.

### Retry with a new command or Ledger idempotency key

Rejected. A new logical identity could create a second journal after an ambiguous commit. Retries retain the original transfer and child Ledger idempotency identity.

### Treat a client timeout as failure

Rejected. The transaction may have committed. Durable Transfer/Ledger evidence must be checked before a failure or retry decision.

### Treat a client timeout as success

Rejected. A request response or idempotency key is not financial truth. Success requires a verified Transfer-to-Ledger correlation.

### Use an in-memory recovery registry

Rejected. Process memory is not durable and would not protect against restart or concurrent workers. Operations and the authoritative Transfer/Ledger records provide the durable evidence.

### Add a scheduler or broker for recovery

Rejected for A5T06. Recovery is a bounded command/service path. Background scheduling, external publishing, and outbox delivery remain outside this task.

## Consequences

### Positive

- Serialization/deadlock handling is bounded and deterministic.
- Duplicate requests cannot create a second Ledger effect.
- Commit-timeout results are verified from Transfer and Ledger evidence.
- Unknown outcomes remain explicit and support-traceable.
- Ledger remains the sole authority for financial value.
- A5T07 can add its event fact later without changing retry or financial authority.

### Future review items

- A5T07 must define the minimal transactional outbox fact and its immutable event payload without adding a broker or external publisher.
- A5T08 must independently reconcile unknown/recovered transfers and journal evidence.
- Operations must confirm retention, diagnostics, alerting, and support ownership for repeated unknown outcomes.
- Finance/Ledger must approve live posting and recovery runbooks before pilot activation.

## Explicitly out of scope

This ADR and A5T06 do not:

- implement the transactional outbox or any external event publisher;
- add controllers, public APIs, routes, schedulers, brokers, providers, settlement, callbacks, or notifications;
- alter Customer, Wallet, A3 binding, A4 policy, Ledger source records, or reconciliation records to make a retry pass;
- edit/delete posted journals or lines;
- implement automatic financial correction or reversal; or
- claim live migration, production deployment, pilot activation, or approval evidence.

## Implementation evidence

- [`src/transfer/transfer-lifecycle.service.ts`](../../src/transfer/transfer-lifecycle.service.ts)
- [`src/transfer/transfer-lifecycle.types.ts`](../../src/transfer/transfer-lifecycle.types.ts)
- [`src/transfer/transfer-lifecycle.ts`](../../src/transfer/transfer-lifecycle.ts)
- [`src/transfer/transfer.entity.ts`](../../src/transfer/transfer.entity.ts)
- [`src/ledger/ledger.service.ts`](../../src/ledger/ledger.service.ts)
- [`src/operations/idempotency.service.ts`](../../src/operations/idempotency.service.ts)
- [`test/transfer-lifecycle.service.spec.ts`](../../test/transfer-lifecycle.service.spec.ts)
- [`A5-IMPLEMENTATION-PLAN.md`](../A5-IMPLEMENTATION-PLAN.md)
- [`ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md`](ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md)
- [`ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md`](ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md)

## A5T06 verification record

- [x] Serialization and deadlock failures use bounded three-attempt retries.
- [x] Retries retain the same logical transfer and Ledger idempotency identity.
- [x] Commit-timeout verification reads durable Transfer/Ledger evidence before returning success.
- [x] Unknown outcomes receive deterministic recovery references and explicit lifecycle state.
- [x] Duplicate replay does not invoke Ledger a second time.
- [x] Retry exhaustion is deterministic and non-success.
- [x] Unexpected failures do not silently become success or trigger blind financial retry.
- [x] The transactional outbox remains intentionally unimplemented for A5T07.
- [ ] Operations recovery runbook, live deployment, and pilot approval evidence remain unresolved.
