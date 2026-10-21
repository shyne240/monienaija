# A6T08 — Settlement, Suspense, and Financial Exception Ownership Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T08 — Settlement, Suspense, and Financial Exception Ownership
- **Status:** Settlement, suspense, and exception ownership implemented
- **Contract:** `ExternalSettlementContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, provider, and reconciliation changes in this task:** Settlement boundary, suspense/exception ownership, compensating-entry contract, and Ledger integration implemented; reconciliation, public APIs, and provider communication remain outside A6T08

## 1. Settlement boundary

A6T08 introduces one Ledger-owned settlement boundary. It accepts only verified external-operation outcomes produced by A6T07 (`PENDING_VERIFICATION` lifecycle state with at least one accepted provider reference). It does not accept provider acknowledgements, callbacks, status queries, or non-verified lifecycle states.

```text
A6T07 verified outcome (PENDING_VERIFICATION + provider reference)
  -> ExternalSettlementService.settleVerifiedOutcome
    -> reserve settlement idempotency
    -> lock external operation row
    -> validate verified prerequisites
    -> post one balanced Ledger journal (Dr customer funds, Cr settlement asset)
    -> persist external_settlements row
    -> audit and outbox
```

## 2. Verified outcome prerequisites

| Prerequisite                                                | Failure code                                  |
| ----------------------------------------------------------- | --------------------------------------------- |
| External operation exists                                  | `EXTERNAL_OPERATION_NOT_FOUND`                |
| External operation not in terminal failed/cancelled state   | `INVALID_SETTLEMENT_STATE`                    |
| External operation lifecycle state is `PENDING_VERIFICATION`| `INVALID_SETTLEMENT_STATE`                    |
| External operation not already settled                      | `DUPLICATE_SETTLEMENT`                        |
| Settlement evidence references an accepted provider reference | `EVIDENCE_REFERENCE_MISSING`               |
| Settlement amount, currency, accounting unit match the operation | `SETTLEMENT_AMOUNT_MISMATCH` / `SETTLEMENT_CURRENCY_MISMATCH` / `SETTLEMENT_ACCOUNTING_UNIT_MISMATCH` |
| Internal `walletAccountId` and `ledgerAccountId` match the operation | `INTERNAL_ACCOUNT_MISMATCH`              |
| Settlement asset/clearing accounts exist, are active, and share currency/accounting unit | `SETTLEMENT_ACCOUNT_UNAVAILABLE` |
| A6 partner capability is enabled                            | `PARTNER_DISABLED`                            |
| Expected operation version matches the current version      | `STALE_OPERATION_VERSION`                     |
| Settlement idempotency key is supplied and stable           | `SETTLEMENT_KEY_INVALID`                      |

## 3. Settlement idempotency

- **Scope:** `external.partner.settlement.v1`
- **Key:** `a6-settlement:<sha256(externalOperationId + ":" + verifiedEvidenceHash + ":" + settlementDecision + ":" + lifecycleState)>`
- **Request hash:** canonical JSON of `{externalOperationId, decision, journalLines, accountIds, currency, accountingUnit, verifiedEvidenceHash, lifecycleState}`
- **Replay:** identical key + identical hash returns the original settlement view with `replayed: true`
- **Conflict:** identical key + different hash is rejected with `SETTLEMENT_IDEMPOTENCY_CONFLICT`
- **Retention:** 86,400 seconds

The settlement key is derived deterministically from the verified evidence hash. A re-verified outcome that uses the same evidence produces the same key and a replay; a different evidence produces a different key and a new settlement attempt that fails as `DUPLICATE_SETTLEMENT` if the original was already posted.

## 4. Journal mapping

```text
Dr  ledgerAccountId (customer funds)        amountMinor
Cr  settlementAssetAccountId (asset)         amountMinor
```

Journal fields:

- `idempotencyKey`: settlement key
- `currency`: `NGN`
- `accountingUnit`: `CUSTOMER_FUNDS`
- `reference`: external operation reference
- `description`: `a6-settlement:<partnerKey>:<capabilityKey>:<operationType>`
- `correlationId`: operation request context correlation
- `metadata`:
  - `externalOperationId`
  - `externalOperationReference`
  - `partnerKey`
  - `capabilityKey`
  - `operationType`
  - `verifiedProviderReferenceHash`
  - `verifiedProviderReferenceType`
  - `verifiedProviderReferenceValue`
  - `verifiedProviderReferenceNamespace`
  - `verifiedProviderSource`

## 5. Compensating-entry boundary

A compensating entry is a new Ledger journal with `reversalOfJournalId` set to the original settlement journal ID. The compensating entry is composed from the opposite-direction lines of the original journal, carries the same `currency`/`accountingUnit`, and writes the new `reversalJournalId` on the suspense entry.

Acceptance:

- The original settlement must exist and not already be reversed.
- A suspense entry must exist for the operation with `status` `OPEN` or `HELD`.
- The expected operation version must match the current version.
- A duplicate compensating entry under the same idempotency key returns the existing reversal.

The compensating-entry journal posts the inverse of the original settlement. It does not mutate the original journal, the original settlement row, or any completed A5 record.

## 6. Suspense and exception ownership

A suspense entry is written when settlement cannot proceed because the verified outcome is missing, mismatched, or unresolved. Suspense rows are immutable for A6T08 except for the `reversalJournalId` field that a compensating entry may populate.

| Field                | Value                                                |
| -------------------- | ---------------------------------------------------- |
| `externalOperationId`| UUID of the external operation                       |
| `reason`             | typed exception code (see below)                     |
| `status`             | `OPEN` or `HELD`                                     |
| `owner`              | `finance-ledger-suspense` (or approved owner)        |
| `ownerPrincipal`     | non-empty principal reference                        |
| `amountMinor`        | operation amount (string)                            |
| `currency`           | `NGN`                                                |
| `accountingUnit`     | `CUSTOMER_FUNDS`                                     |
| `evidenceReferenceHash` | SHA-256 of the verified provider reference value |
| `lifecycleState`     | operation state at suspension                        |
| `rejectionCode`      | typed exception code                                 |
| `reversalJournalId`  | nullable UUID of the compensating entry              |
| `createdAt`          | timestamp                                            |
| `updatedAt`          | timestamp                                            |

Reason vocabulary:

- `EVIDENCE_REFERENCE_MISSING`
- `SETTLEMENT_AMOUNT_MISMATCH`
- `SETTLEMENT_CURRENCY_MISMATCH`
- `SETTLEMENT_ACCOUNTING_UNIT_MISMATCH`
- `INTERNAL_ACCOUNT_MISMATCH`
- `SETTLEMENT_ACCOUNT_UNAVAILABLE`
- `STALE_OPERATION_VERSION`
- `SETTLEMENT_KEY_INVALID`
- `DUPLICATE_SETTLEMENT`
- `INVALID_SETTLEMENT_STATE`
- `PARTNER_DISABLED`
- `EXTERNAL_OPERATION_NOT_FOUND`
- `COMPENSATING_NOT_PERMITTED`

## 7. Rollback on failure

If the Ledger post fails for any reason after the idempotency reservation, the settlement service:

- marks the idempotency record as `FAILED` with the failure response body;
- writes no settlement row;
- writes no suspense row (because there is no verified evidence to attribute);
- leaves the external operation in its current verified state for the A6T07 boundary to recover;
- audits the failure with the typed exception code; and
- rethrows the typed exception so the caller (A6T07 recovery or A6T11 release gate) decides the next action.

A6T08 does not retry, silently clear, or rewrite the failed reservation. The Operations idempotency record is the replay-safe boundary for the failed settlement attempt.

## 8. Authoritative ownership

| Concern                                | Owner                                                        |
| -------------------------------------- | ------------------------------------------------------------ |
| Verified external outcome              | A6T07 lifecycle                                              |
| Customer funds account identity        | A3 binding + WalletAccount                                   |
| Settlement account identity            | Ledger/Finance                                               |
| Ledger journal execution               | `LedgerService`                                              |
| Settlement evidence persistence        | A6T08 (`external_settlements`)                               |
| Suspense evidence persistence          | A6T08 (`external_suspense_entries`)                          |
| Compensating entry decision            | A6T08 (called only against an existing suspense entry)       |
| Audit, idempotency, outbox             | Operations                                                   |
| Reconciliation evidence                | A6T09 (read-only)                                            |

## 9. Out of scope

- Provider communication
- Public API exposure
- Reconciliation queries and discrepancy ownership
- Notification delivery
- Currency, FX, fees, product expansion
- Automatic suspense clearing
- Editing posted journals, lines, balances, or completed A5 history
- A6T09 and later work
