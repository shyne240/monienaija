# ADR-0045: Customer Transaction State and Pending Outcomes

- **Status:** Proposed A5 implementation decision; metadata lifecycle implemented, financial execution not enabled
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Customer Engineering, Wallet, Ledger, Finance, Operations, Reconciliation, Security, Risk, Compliance, and Product
- **Scope:** Durable internal transfer metadata, lifecycle states, transition guards, immutable command identity, and pending/unknown outcome representation
- **Task:** A5T04 — Transfer State, Persistence, and Pending Outcomes
- **Implementation status:** Transfer lifecycle persistence, migration, state machine, Operations audit/idempotency integration, and tests added; no Ledger posting, balance mutation, journal creation, controller, route, scheduler, provider, or external integration added

## Context

A5T01 identified the existing `Transfer` entity and `TransferService` as compatibility/source behavior rather than a complete A5 command boundary. A5T02 defined the customer-aware command and correlation contract. A5T03 added the A2/A4/A3 consumer gate, but it deliberately returns a gate result and does not create a transfer lifecycle record or execute financial value movement.

A5 needs a durable metadata lifecycle before a later task can connect the approved command to Ledger. The lifecycle must distinguish:

- a command accepted into the internal transfer boundary;
- processing handoff;
- a controlled recovery wait;
- an unknown outcome whose financial effect cannot yet be established;
- a verified failure with no journal effect;
- cancellation before financial effect; and
- completion with an existing Ledger journal reference.

The lifecycle must not rewrite posted financial history or turn an ambiguous outcome into success by changing a row. Existing pre-A5 transfer rows also need to remain readable and operationally compatible while the new A5 fields are introduced through a nullable migration boundary.

## Decision

### 1. Extend the existing Transfer metadata record

The existing `transfers` table and `Transfer` entity remain the A5 transfer metadata authority. A5 does not create a second transaction table or a module-local state store.

New A5 lifecycle rows have a non-null `commandId` and contain the full customer-aware metadata tuple. Legacy rows created before A5 have `commandId = NULL` and remain compatibility records. The database migration keeps the new columns nullable for legacy preservation, while `TransferLifecycleService.createPending` requires the complete A5 command metadata for new records.

The A5 lifecycle service is:

```text
TransferLifecycleService.createPending(command)
TransferLifecycleService.transition(transferId, transition)
TransferLifecycleService.get(transferId)
```

It persists metadata only. It does not call `TransferService`, `LedgerService`, `PaymentReferenceService`, or any financial posting method.

### 2. Lifecycle state vocabulary

`TransferStatus` has the following states:

| State              | Meaning                                                                                 | Financial implication                                                                |
| ------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PENDING`          | The approved command metadata is durably accepted and awaits a later execution boundary | No journal or financial effect is implied                                            |
| `PROCESSING`       | A later execution boundary has begun processing the command                             | No journal is permitted in this metadata state; financial outcome is not yet claimed |
| `PENDING_RECOVERY` | Operational verification/recovery work is required and a recovery reference is present  | No success or failure is inferred                                                    |
| `UNKNOWN`          | The outcome cannot currently be established from durable evidence                       | Must not be reported as success or retried blindly                                   |
| `COMPLETED`        | The transfer has a valid existing Ledger journal reference and completion timestamp     | Posted value belongs to Ledger; this service does not create the journal             |
| `FAILED`           | The command has a failure code/message and verified no financial journal effect         | Terminal metadata outcome; no journal is allowed                                     |
| `CANCELLED`        | The command was cancelled before financial effect                                       | Terminal metadata outcome; no journal is allowed                                     |

`PENDING_RECOVERY` and `UNKNOWN` are intentionally separate. `PENDING_RECOVERY` identifies the operational recovery work; `UNKNOWN` records the unresolved outcome. Both require a durable `recoveryReference`.

### 3. State-transition rules

The normative state graph is:

```text
PENDING ----------> PROCESSING ----------> COMPLETED
  |                    |  \                  ^
  |                    |   \                 |
  |                    |    -> FAILED        |
  |                    v                      |
  +--------------> PENDING_RECOVERY ---------+
  |                    |  \                  |
  |                    |   -> PROCESSING     |
  |                    v                      |
  +--------------> UNKNOWN ------------------+
                       |                     |
                       +--> PENDING_RECOVERY
                       +--> FAILED
```

`PENDING` may also transition to `FAILED` or `CANCELLED` when no financial effect exists. The complete transition contract is:

| Current            | Allowed next states                                                | Required condition                                                                                          |
| ------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `PENDING`          | `PROCESSING`, `PENDING_RECOVERY`, `UNKNOWN`, `FAILED`, `CANCELLED` | Command metadata exists; uncertain states require recovery reference; failed state requires failure details |
| `PROCESSING`       | `COMPLETED`, `PENDING_RECOVERY`, `UNKNOWN`, `FAILED`               | Completion requires an existing journal reference; uncertain states require recovery reference              |
| `PENDING_RECOVERY` | `PROCESSING`, `COMPLETED`, `UNKNOWN`, `FAILED`                     | Existing or supplied recovery reference remains traceable                                                   |
| `UNKNOWN`          | `PENDING_RECOVERY`, `COMPLETED`, `FAILED`                          | Resolution requires the existing or supplied recovery reference                                             |
| `COMPLETED`        | None                                                               | Terminal and immutable                                                                                      |
| `FAILED`           | None                                                               | Terminal and immutable                                                                                      |
| `CANCELLED`        | None                                                               | Terminal and immutable                                                                                      |

The state machine rejects same-state updates as transitions, backward movement to `PENDING`, cancellation after `PROCESSING`, and every terminal-state mutation. Identical retries use Operations idempotency replay rather than a second state transition.

The executable guard is [`src/transfer/transfer-lifecycle.ts`](../../src/transfer/transfer-lifecycle.ts). It is a state guard only; it does not decide policy, account ownership, Ledger value, or recovery truth.

### 4. State-specific invariants

The lifecycle service and migration enforce these metadata invariants:

- Every new A5 row has a canonical command ID, source/destination customer IDs, CustomerWallet IDs, A3 binding IDs/versions, WalletAccount IDs, LedgerAccount IDs, amount, currency, accounting unit, request hash, request/correlation context, A2 reference, and A4 policy references.
- Command identity, source/destination account identity, amount, currency, idempotency scope/key, request hash, policy references, and request/correlation/trace/causation metadata are immutable after creation.
- `PENDING`, `PROCESSING`, `PENDING_RECOVERY`, and `UNKNOWN` do not claim a completed journal.
- `UNKNOWN` and `PENDING_RECOVERY` require a recovery reference.
- `FAILED` requires a failure code and has no journal or completion timestamp.
- `CANCELLED` has no journal or completion timestamp.
- `COMPLETED` requires an existing journal UUID and completion timestamp. A5T04 accepts the reference as metadata only; A5T05 owns Ledger validation/posting.
- A completed transfer cannot be edited into another outcome, have its journal reference cleared, or have its command identity changed.
- A recovery reference cannot be silently replaced during a recovery lifecycle.
- `version` is an optimistic-lock/version field and lifecycle transitions use a pessimistic row lock in the database transaction.

### 5. Persistence metadata

The lifecycle migration adds these groups of fields to `transfers`:

| Group                     | Fields                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Command identity          | `command_id`, command type/version, capability, action, command scope                                                         |
| Customer/account identity | Source/destination Customer, CustomerWallet, A3 binding/version, WalletAccount, and LedgerAccount IDs                         |
| A2/A4 evidence            | Authorization-context reference, policy decision/version/profile/version, snapshot reference, normalized policy input hash    |
| Request correlation       | Idempotency scope, request ID, correlation ID, trace ID, causation ID, requested-at timestamp, request hash                   |
| Existing business data    | Amount, currency, accounting unit, reference, narration, payment reference, journal reference                                 |
| Lifecycle/recovery        | Status, state reason, pending/processing/recovery/unknown/cancelled/completed timestamps, recovery reference, failure details |
| Concurrency               | `version` and `updated_at`                                                                                                    |

The migration adds foreign keys for canonical customer, CustomerWallet, A3 binding, and LedgerAccount references where the A5 fields are present. Legacy rows remain valid with nullable A5 metadata. New A5 metadata rows are constrained by the complete-command check.

The migration also installs a database trigger for A5 rows (`command_id IS NOT NULL`) that rejects identity/correlation mutation, illegal state transitions, completed-without-journal metadata, failed-with-journal metadata, and uncertain state without recovery reference. Legacy rows with `command_id IS NULL` remain outside the new trigger state graph so existing compatibility behavior is not silently rewritten by this task.

Migration file: [`src/migrations/1785753600023-AddTransferLifecycle.ts`](../../src/migrations/1785753600023-AddTransferLifecycle.ts).

### 6. Lifecycle creation and transitions

`TransferLifecycleService.createPending`:

1. Normalizes and validates the complete A5 metadata command.
2. Reserves the Operations-backed lifecycle idempotency scope `wallet.transfer.lifecycle.v1` using a namespaced key derived from the source command scope/key.
3. Creates one `PENDING` transfer metadata row with no journal and no payment reference.
4. Records an Operations audit fact through `AuditService`.
5. Completes the idempotency record with the durable transfer resource ID and metadata view.

`TransferLifecycleService.transition`:

1. Reserves the Operations-backed state scope `wallet.transfer.state.v1` using a deterministic transition request hash.
2. Locks the transfer metadata row and checks its A5 command identity and expected version.
3. Applies the state guard and state-specific metadata invariants.
4. Saves only lifecycle/recovery/failure/journal-reference metadata permitted by the transition.
5. Records the state transition through `AuditService`.
6. Completes the state idempotency record with the original metadata view.

The lifecycle scopes are distinct from the A5 gate scope `wallet.transfer.create.v1`, A4 policy scope, and any future Ledger journal scope. They do not create a second financial truth or permit a second financial effect.

### 7. Replay, immutability, and unknown outcomes

- A same-key/same-hash metadata create returns the original transfer ID and marks the view as an idempotency replay.
- A same-key/same-hash state transition returns the original transition result, even if the transfer has since moved to another state through a different command.
- A reused key with a changed request/transition hash is rejected by Operations.
- A completed/failed/cancelled state cannot be changed through a new key.
- An unknown state retains its original command ID, account tuple, policy references, request/correlation chain, and recovery reference until a controlled resolution is recorded.
- An unknown state is never resolved by deleting the row, clearing the journal reference, changing the command ID, or selecting another account.

## Alternatives considered

### Add a second A5 transfer table

Rejected. The existing `Transfer` record is the compatibility and financial-domain transaction record. A second table would create competing transaction identity and reconciliation joins.

### Keep only `COMPLETED` and `FAILED`

Rejected. A client timeout, interrupted execution, or uncertain commit cannot truthfully be represented as either success or failure. Explicit pending-recovery and unknown states preserve the ambiguity.

### Use nullable status fields without transition guards

Rejected. A row could be changed from completed to failed, an unknown outcome could be cleared, or command identity could be reassigned. Application and database guards are both required for A5 rows.

### Create a journal or payment reference when creating PENDING metadata

Rejected for A5T04. Metadata persistence does not create financial value. Ledger posting and payment-reference execution belong to later approved financial integration.

### Allow direct transition of legacy transfer rows through the A5 state service

Rejected. Legacy rows lack canonical customer/policy/binding metadata and remain compatibility inputs. They require an approved migration/adoption path rather than an implicit reinterpretation.

## Consequences

### Positive

- Transfer command identity and support correlation are durable before a later financial effect.
- Pending, failed, cancelled, recovery, and unknown outcomes are truthful and queryable.
- Completed metadata cannot be edited into a different financial history.
- Operations audit and idempotency remain the shared authorities.
- Migration up/down preserves legacy transfer rows and existing Ledger, Wallet, A2, A3, Operations, and Reconciliation records.
- No financial execution or balance authority is added to the lifecycle service.

### Future review items

- A5T05 must verify the journal reference and connect the lifecycle state to one balanced Ledger posting without adding a second state/value authority.
- A5T06 must define transactionally coherent gate/lifecycle/Ledger idempotency, serialization retry, and unknown-outcome recovery behavior.
- A5T07 must add the approved transactional outbox fact without treating it as transfer or Ledger truth.
- A5T08 must independently reconcile transfer state, identity tuple, journal reference, and Operations evidence.
- Legacy transfer adoption, if required, needs a separate reviewed migration/backfill decision and must not infer customer ownership from opaque wallet values.

## Explicitly out of scope

This ADR and A5T04 do not:

- call `LedgerService.postJournal` or any financial posting method;
- modify balances, create journals/lines, generate opening value, or perform reversals;
- implement A5T05, A5T06, A5T07, A5T08, A5T09, or A5T10;
- expose controllers, routes, public APIs, schedulers, providers, settlement, callbacks, notifications, or external integrations;
- create or repair Customer, CustomerWallet, A3 binding, policy, eligibility, risk, compliance, Wallet, Ledger, or reconciliation source records; or
- claim financial execution, production deployment, pilot activation, or accountable-owner approval.

## Implementation evidence

- [`src/transfer/transfer.entity.ts`](../../src/transfer/transfer.entity.ts)
- [`src/transfer/transfer.enums.ts`](../../src/transfer/transfer.enums.ts)
- [`src/transfer/transfer-lifecycle.ts`](../../src/transfer/transfer-lifecycle.ts)
- [`src/transfer/transfer-lifecycle.types.ts`](../../src/transfer/transfer-lifecycle.types.ts)
- [`src/transfer/transfer-lifecycle.service.ts`](../../src/transfer/transfer-lifecycle.service.ts)
- [`src/migrations/1785753600023-AddTransferLifecycle.ts`](../../src/migrations/1785753600023-AddTransferLifecycle.ts)
- [`src/transfer/transfer.module.ts`](../../src/transfer/transfer.module.ts)
- [`test/transfer-lifecycle.service.spec.ts`](../../test/transfer-lifecycle.service.spec.ts)
- [`A5-IMPLEMENTATION-PLAN.md`](../A5-IMPLEMENTATION-PLAN.md)
- [`A5-TRANSFER-COMMAND-CONTRACT.md`](../A5-TRANSFER-COMMAND-CONTRACT.md)
- [`ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md`](ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md)
- [`ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md`](ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md)

## A5T04 verification record

- [x] Pending, processing, pending-recovery, unknown, completed, failed, and cancelled states are defined.
- [x] Valid transitions and prohibited terminal/backward transitions are implemented and tested.
- [x] A5 transfer metadata includes command, customer, account, policy, request, correlation, journal, failure, and recovery references.
- [x] Command identity and correlation metadata are immutable for A5 rows.
- [x] Completed, failed, cancelled, pending-recovery, and unknown state invariants are explicit.
- [x] Operations audit and idempotency integration is implemented without a local store.
- [x] Legacy pre-A5 rows remain compatibility records and are not silently adopted.
- [x] Migration rollback removes only A5 lifecycle additions and restores the previous transfer constraints.
- [x] No Ledger posting, balance mutation, journal creation, financial execution, controller, route, scheduler, or external integration is introduced.
- [ ] A5T05 financial posting and Ledger verification remain intentionally incomplete.
