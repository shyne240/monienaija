# ADR-0050 — Settlement, Suspense, and Exception Ownership

- **ADR ID:** ADR-0050
- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T08 — Settlement, Suspense, and Financial Exception Ownership
- **Status:** Implemented
- **Authoritative boundary:** `ExternalSettlementContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, provider, reconciliation, and public-channel changes in this task:** Settlement boundary, suspense and compensating-entry contract, exception ownership, replay-safe deterministic settlement execution through the Ledger; no provider call, no reconciliation writer, no public API

## 1. Decision

A6T08 establishes a single, Ledger-owned settlement boundary that:

1. Posts at most one balanced, double-entry, currency-labelled, accounting-unit-compatible Ledger journal for each verified external outcome.
2. Refuses to create or settle a financial effect from a non-verified external lifecycle state. The boundary treats `CREATED`, `SUBMITTING`, and the A6T07 in-flight states as non-settlable.
3. Routes unmatched, delayed, disputed, partially verified, or ambiguous value into an explicit suspense entry with a named exception owner rather than crediting, debiting, or clearing customer value.
4. Uses new compensating Ledger journals (with `reversalOfJournalId`) for any later financial correction; it never mutates posted journals, lines, balances, or completed A5 records.
5. Persists a separate durable settlement record per verified outcome and an idempotency scope distinct from the operation and lifecycle scopes so a duplicate or replayed verified outcome cannot create a second settlement.
6. Records every settlement, suspense, reversal, and exception-ownership decision through `Operations` audit, idempotency, and outbox primitives.
7. Rejects settlement when a stale lifecycle version, a settled external operation, a terminal failure, a missing internal account, a disabled external capability, or a non-matching amount/currency/accounting-unit is supplied.
8. Stops accepting new settlement when the external capability is disabled; previously posted history is preserved.

## 2. Settlement boundary

```text
A6T07 verified external-operation lifecycle
  PENDING_VERIFICATION (verified provider outcome, callback, or status report)
                       |
                       v
ExternalSettlementService.settleVerifiedOutcome
  - requires external operation not in a terminal non-settled state
  - requires external operation lifecycle state is PENDING_VERIFICATION (or equivalent)
  - reserves A6 settlement idempotency
  - locks the external operation row pessimistically
  - resolves the internal customer funds WalletAccount/LedgerAccount
  - resolves the approved settlement asset/clearing Ledger accounts
  - composes a balanced double-entry journal
  - posts through LedgerService.postJournalInTransaction
  - persists external_settlements evidence
  - audits the settled, suspense, or rejected outcome
```

The settlement boundary is the only writer of Ledger value for the selected external flow. No other A6 module, partner adapter, callback processor, or status verifier posts a journal.

## 3. Verified outcome prerequisites

Settlement is permitted only when:

- the external operation exists, is not in a terminal non-settled state, and is not already settled (the `external_settlements` table is empty for the operation);
- the external operation lifecycle is in a verified state (`PENDING_VERIFICATION` or a comparable A6T07 verified state that has not been silently rewritten);
- the supplied `expectedVersion` matches the current optimistic version of the operation;
- the supplied `amountMinor`, `currency`, and `accountingUnit` match the operation exactly;
- the internal `walletAccountId` and `ledgerAccountId` match the operation exactly;
- the supplied settlement idempotency key is a stable SHA-256-derived identifier (`a6-settlement:<sha256>`) that does not change across replays;
- the Operations `A6_PARTNER_ENABLED` capability is enabled (the A6 partner is not disabled); and
- the settlement evidence references at least one accepted provider reference recorded by `ExternalOperationService` (acknowledgement, callback, status query, or statement).

A duplicate settlement, a stale version, a changed payload under the same key, a terminal non-settled state, a terminal failed/cancelled state, a missing evidence reference, a disabled partner, or a Ledger account mismatch fails closed with a typed `ExternalSettlementException`.

## 4. Journal mapping

The settlement journal is composed from the operation fields and the approved settlement accounts:

```text
Dr  WalletAccount/LedgerAccount  (customer funds source)   amountMinor
Cr  Settlement Asset Account     (clearing destination)   amountMinor
```

The accounts are validated by `LedgerService` for:

- active state;
- matching `currency` (`NGN`);
- matching `accountingUnit` (`CUSTOMER_FUNDS`);
- sufficient balance on the customer WalletAccount (negative balance disallowed);
- a non-reversal reference (the journal is not itself a reversal of another journal).

The journal `idempotencyKey` is the supplied settlement key, the `reference` is the external operation reference, the `description` records the partner, capability, and operation type, the `metadata` records the verified provider reference identifiers, the `correlationId` is the operation request-context correlation, and the `reversalOfJournalId` is set only when this is a compensating entry.

## 5. Suspense and exception ownership

When settlement is rejected because finality or matching is unresolved, the boundary writes an `external_suspense_entries` row with:

- the external operation ID and reference;
- a `reason` vocabulary drawn from the typed exception codes;
- a `status` of `OPEN` or `HELD`;
- an `owner` named by an owner reference (e.g. `finance-ledger-suspense`) and a non-empty `ownerPrincipal`;
- the operation amount/currency/accounting unit;
- the verified provider reference identifier that triggered the suspense;
- the typed exception code;
- the `lifecycleState` at the moment of suspension; and
- the `rejection` evidence used to record the decision.

A suspense entry is reopened only by a later A6T08 compensating or resolving flow; the row is not silently edited. The `OPEN` and `HELD` statuses are terminal for A6T08; only the A6T09 reconciliation owner or a privileged recovery action can clear the entry, and that clearing is recorded in the audit table.

## 6. Compensating-entry boundary

A compensating entry is a new journal with `reversalOfJournalId` set to the original settlement journal ID. The boundary:

- rejects compensating entries that target a journal already reversed;
- rejects compensating entries that are not requested for an `OPEN` or `HELD` suspense entry;
- composes the opposite-direction lines for every line in the original journal;
- carries the same `currency`, `accountingUnit`, and verified evidence references in the metadata; and
- records the original settlement ID and the suspense entry ID in the compensating journal metadata and in the suspense entry `reversalJournalId` field.

A compensating entry cannot be applied to a settlement that has not been posted, to a suspense entry that is not open, or to an external operation whose `expectedVersion` does not match the current operation version. The compensating-entry flow does not mutate the original journal, the original settlement row, or any completed A5 record.

## 7. Idempotency and replay safety

Settlement uses a dedicated Operations idempotency scope `external.partner.settlement.v1` with a deterministic settlement key derived from the external operation ID, the settlement decision, and the verified evidence hash. The settlement record, the journal, and the audit are persisted in a single SERIALIZABLE PostgreSQL transaction owned by the settlement service. The settlement service reserves the idempotency record before reading or locking the external operation row.

A replayed settlement with the same key and payload returns the original settlement view with `replayed: true`. A replayed settlement with the same key and a different payload is rejected with `SETTLEMENT_IDEMPOTENCY_CONFLICT`. A settlement that was posted but whose transaction is retried produces the same journal ID and the same settlement view.

## 8. Disable and rollback

Disabling the external capability (via `A6_PARTNER_ENABLED=false`) prevents new settlement submissions from being admitted. The disable check is applied in the same transaction that reserves the settlement idempotency; previously posted settlements, suspense entries, and compensating entries remain immutable in the Ledger and in the settlement tables. The settlement boundary does not delete, edit, or rewrite completed A5, A6, or Ledger history.

## 9. Authoritative ownership

| Concept                              | Owner                                                        |
| ------------------------------------ | ------------------------------------------------------------ |
| Settlement execution                 | A6T08 settlement boundary (`ExternalSettlementService`)      |
| Journal authority                    | `LedgerService` (A5)                                         |
| Verified external outcome            | A6T07 lifecycle (`ExternalOperationLifecycleService`)        |
| Internal customer funds account      | A3 binding/WalletAccount                                     |
| Settlement accounts                  | Ledger/Finance (`SettlementAccountService` role lookups)     |
| Suspense accounts                    | Ledger/Finance (read through `SettlementAccountService`)     |
| Compensating entry decision          | A6T08 settlement boundary + Finance/Privileged approval      |
| Audit, idempotency, outbox           | Operations                                                   |
| Independent reconciliation evidence  | A6T09 reconciliation (read-only)                             |

## 10. Prohibited behavior

The settlement boundary does not:

- post a journal from a callback, a status query, an outbox fact, a provider reference, or a non-verified lifecycle state;
- credit or debit customer value without an approved verified outcome and a balanced, double-entry, currency-labelled, accounting-unit-compatible journal;
- mutate posted journals, lines, balances, or completed A5 history;
- edit, delete, or silently clear a suspense entry;
- create a second settlement record for the same external operation under a different key;
- treat a partner acknowledgement, callback, or status query as settled value;
- bypass the Ledger authority to write balances or lines directly; or
- skip Operations audit, idempotency, or outbox evidence.

## 11. Acceptance evidence

- `docs/A6-SETTLEMENT-SUSPENSE-AND-EXCEPTION-CONTRACT.md` captures the full runtime contract.
- `test/external-settlement.service.spec.ts` exercises successful settlement, duplicate prevention, suspense routing, compensating-entry boundary, replay safety, stale lifecycle rejection, invalid settlement state, audit evidence, Ledger correlation, and rollback on failure.
- The A6T08 migration (`1785753600029-CreateExternalSettlementTables.ts`) creates `external_settlements` and `external_suspense_entries` with constraints that prevent duplicate settlement and prevent state changes that bypass the boundary.
- The settlement service uses only the approved `LedgerService`, `SettlementAccountService`, `ExternalOperationService`, `ExternalOperationLifecycleService`, and Operations primitives.
- The settlement boundary performs no provider communication and exposes no public API.
