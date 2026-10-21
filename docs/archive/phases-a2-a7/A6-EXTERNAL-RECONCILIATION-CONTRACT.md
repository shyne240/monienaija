# A6T09 — External Reconciliation, Certification, and Support Trace Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T09 — Independent External Reconciliation, Certification, and Support Trace
- **Status:** Implemented
- **Contract:** `ExternalReconciliationContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, partner, settlement, suspense, audit, outbox, and reconciliation changes in this task:** Read-only reconciliation engine, discrepancy vocabulary, support trace, and certification fingerprint; no source mutation, no provider communication, no public API, no additional provider integration

## 1. Contract purpose

A6T09 introduces a single, read-only reconciliation boundary that compares one external operation, its provider references, callback receipts, settlement, suspense, reversal, Ledger journal, audit, outbox, and idempotency evidence. The boundary produces a deterministic discrepancy report, a support trace with classified sensitivity, and a partner certification fingerprint. The boundary never mutates source records.

## 2. Inputs

```ts
{
  externalOperationId: string;     // required, UUID
  generatedAt?: string;            // optional, ISO-8601
  includeReplayHash?: boolean;     // default false
}
```

The `generatedAt` defaults to the current timestamp. The `includeReplayHash` flag includes the deterministic support-trace hash so the same facts can be diffed across runs.

## 3. Read path

The boundary uses:

- `dataSource.transaction('REPEATABLE READ', ...)` + `SET TRANSACTION READ ONLY`
- `ExternalOperationService.get(externalOperationId)` (read-only, A6T05)
- `ExternalOperationService.getInTransaction(manager, externalOperationId)` (read-only, A6T05)
- `ExternalSettlementService.getByOperation(externalOperationId)` (read-only, A6T08)
- `ExternalSettlementService.getSuspenseForOperation(externalOperationId)` (read-only, A6T08)
- Direct `SELECT` SQL for `external_operation_references`, `external_callback_receipts`, `ledger_journals`, `ledger_lines`, `audit_events`, `outbox_events`, and `idempotency_records` (read-only, A6T09)

The boundary never calls any write method (`save`, `update`, `delete`, `record*`, `complete*`, `fail*`).

## 4. Output

```ts
{
  contractName: 'A6-EXTERNAL-RECONCILIATION',
  contractVersion: 1,
  generatedAt: string,
  readOnly: true,
  status: 'PASS' | 'WARNING' | 'ERROR',
  externalOperationId: string,
  operation: ExternalReconciliationOperationFact | null,
  references: ExternalReconciliationReferenceFact[],
  callbacks: ExternalReconciliationCallbackFact[],
  settlement: ExternalReconciliationSettlementFact | null,
  suspenseEntries: ExternalReconciliationSuspenseFact[],
  journal: ExternalReconciliationJournalFact | null,
  journalLines: ExternalReconciliationJournalLineFact[],
  auditEvents: ExternalReconciliationAuditFact[],
  outboxEvents: ExternalReconciliationOutboxFact[],
  idempotencyHints: ExternalReconciliationIdempotencyHint[],
  discrepancies: ExternalReconciliationDiscrepancy[],
  trace: ExternalReconciliationTrace,
  certification: PartnerCertificationEvidence,
  replayHash: string | null,
  repairPerformed: false
}
```

## 5. Discrepancy vocabulary

| Code                                            | Severity | Owner          |
| ----------------------------------------------- | -------- | -------------- |
| `OPERATION_NOT_FOUND`                           | ERROR    | RECONCILIATION |
| `ORPHAN_OPERATION`                              | ERROR    | RECONCILIATION |
| `OPERATION_CURRENCY_MISMATCH`                   | ERROR    | FINANCE        |
| `OPERATION_ACCOUNTING_UNIT_MISMATCH`            | ERROR    | FINANCE        |
| `AMOUNT_MISMATCH`                               | ERROR    | FINANCE        |
| `CURRENCY_MISMATCH`                             | ERROR    | FINANCE        |
| `ACCOUNTING_UNIT_MISMATCH`                      | ERROR    | FINANCE        |
| `PARTNER_CAPABILITY_MISMATCH`                   | ERROR    | PARTNER_OWNER  |
| `CUSTOMER_ACCOUNT_MAPPING_MISMATCH`             | ERROR    | WALLET         |
| `LIFECYCLE_NOT_VERIFIED`                        | ERROR    | PARTNER_OWNER  |
| `LIFECYCLE_TERMINAL`                            | ERROR    | PARTNER_OWNER  |
| `LIFECYCLE_FAILED`                              | ERROR    | PARTNER_OWNER  |
| `LIFECYCLE_CANCELLED`                           | ERROR    | PARTNER_OWNER  |
| `MISSING_PROVIDER_REFERENCE`                    | ERROR    | PARTNER_OWNER  |
| `DUPLICATE_PROVIDER_REFERENCE`                  | ERROR    | PARTNER_OWNER  |
| `PROVIDER_REFERENCE_NAMESPACE_MISMATCH`         | WARNING  | PARTNER_OWNER  |
| `PROVIDER_REFERENCE_MAPPING_MISMATCH`           | ERROR    | PARTNER_OWNER  |
| `MISSING_CALLBACK_RECEIPT`                      | WARNING  | PARTNER_OWNER  |
| `DUPLICATE_CALLBACK_RECEIPT`                    | WARNING  | PARTNER_OWNER  |
| `CALLBACK_AUTHENTICITY_REJECTED`                | ERROR    | SECURITY       |
| `CALLBACK_REPLAY`                               | ERROR    | SECURITY       |
| `CALLBACK_AMOUNT_MISMATCH`                      | ERROR    | PARTNER_OWNER  |
| `CALLBACK_CURRENCY_MISMATCH`                    | ERROR    | PARTNER_OWNER  |
| `CALLBACK_REFERENCE_MISMATCH`                   | ERROR    | PARTNER_OWNER  |
| `MISSING_SETTLEMENT`                            | WARNING  | RECONCILIATION |
| `DUPLICATE_SETTLEMENT`                          | ERROR    | FINANCE        |
| `SETTLEMENT_NOT_POSTED`                         | WARNING  | RECONCILIATION |
| `SETTLEMENT_AMOUNT_MISMATCH`                    | ERROR    | FINANCE        |
| `SETTLEMENT_CURRENCY_MISMATCH`                  | ERROR    | FINANCE        |
| `SETTLEMENT_ACCOUNTING_UNIT_MISMATCH`           | ERROR    | FINANCE        |
| `SETTLEMENT_EVIDENCE_MISMATCH`                  | ERROR    | FINANCE        |
| `SETTLEMENT_CORRELATION_MISMATCH`               | ERROR    | RECONCILIATION |
| `SETTLEMENT_REVERSAL_ORPHAN`                    | ERROR    | FINANCE        |
| `SETTLEMENT_REVERSAL_DUPLICATE`                 | ERROR    | FINANCE        |
| `MISSING_JOURNAL`                               | ERROR    | FINANCE        |
| `JOURNAL_CORRELATION_MISMATCH`                  | ERROR    | RECONCILIATION |
| `JOURNAL_BALANCE_MISMATCH`                      | ERROR    | FINANCE        |
| `JOURNAL_REVERSAL_ORPHAN`                       | ERROR    | FINANCE        |
| `JOURNAL_REVERSAL_DUPLICATE`                    | ERROR    | FINANCE        |
| `MISSING_SUSPENSE_ENTRY`                        | WARNING  | RECONCILIATION |
| `SUSPENSE_REVERSAL_DUPLICATE`                   | ERROR    | FINANCE        |
| `SUSPENSE_REVERSAL_MISSING`                     | ERROR    | FINANCE        |
| `SUSPENSE_AGED_OPEN`                            | WARNING  | RECONCILIATION |
| `SUSPENSE_AGED_HELD`                            | ERROR    | FINANCE        |
| `MISSING_AUDIT_EVIDENCE`                        | WARNING  | RECONCILIATION |
| `DUPLICATE_AUDIT_EVIDENCE`                      | WARNING  | RECONCILIATION |
| `AUDIT_CORRELATION_MISMATCH`                    | WARNING  | RECONCILIATION |
| `MISSING_OUTBOX_FACT`                           | WARNING  | RECONCILIATION |
| `DUPLICATE_OUTBOX_FACT`                         | WARNING  | RECONCILIATION |
| `OUTBOX_CORRELATION_MISMATCH`                   | WARNING  | RECONCILIATION |
| `OUTBOX_PAYLOAD_MISMATCH`                       | ERROR    | RECONCILIATION |
| `MISSING_IDEMPOTENCY_REPLAY`                    | WARNING  | RECONCILIATION |
| `IDEMPOTENCY_HASH_MISMATCH`                     | ERROR    | RECONCILIATION |
| `QUERY_UNAVAILABLE`                             | ERROR    | RECONCILIATION |

## 6. Discrepancy priority

A discrepancy is escalated to ERROR when any of the following conditions is true:

- a financial invariant is violated (amount, currency, accounting unit, journal balance);
- a customer/owner/correlation is broken;
- a callback was rejected or replayed;
- a settlement, journal, or reversal is duplicated, orphaned, or missing for a posted settlement;
- the query layer returned an error.

A discrepancy is a WARNING when:

- a soft-mismatch exists that does not break a financial invariant (e.g., audit correlation drift, missing outbox fact, suspense aged but open, callback receipt missing);
- a secondary field is inconsistent but the primary financial effect is correct.

## 7. Status aggregation

| Condition                                         | Status    |
| ------------------------------------------------- | --------- |
| any ERROR discrepancy                              | `ERROR`   |
| any WARNING discrepancy                            | `WARNING` |
| otherwise                                          | `PASS`    |

## 8. Support trace sensitivity

| Field class           | Fields                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `PUBLIC`              | none                                                                                            |
| `INTERNAL`            | `externalOperationId`, `externalOperationReference`, `partnerKey`, `capabilityKey`, `discrepancy.code`, `discrepancy.message` |
| `CONFIDENTIAL`        | `customerId`, `walletAccountId`, `customerLedgerAccountId`, `settlementAssetLedgerAccountId`, `amountMinor`, `currency`, `accountingUnit` |
| `RESTRICTED`          | `signatureHash`, `payloadHash`, callback signature, audit `previousValues`/`newValues`, outbox `payload`, journal `metadata` |

Support, Operations, Reconciliation, and Finance views must use the minimum-necessary field set and approved audience controls. The trace never contains raw PAN, CVV, PIN, OTP, signing keys, customer risk notes, or partner confidential material.

## 9. Certification fingerprint

The `PartnerCertificationEvidence` contains:

```ts
{
  partnerKey: 'NIBSS_NIP',
  capabilityKey: 'external.wallet.withdrawal.settlement',
  capabilityVersion: '1',
  adapterVersion: 'a6-adapter-1',
  contractName: 'A6-EXTERNAL-RECONCILIATION',
  contractVersion: 1,
  contractReference: 'docs/ADR/ADR-0053-Independent-External-Reconciliation.md',
  contractDocument: 'docs/A6-EXTERNAL-RECONCILIATION-CONTRACT.md',
  expectedChecks: string[],     // deterministic from the contract
  observedChecks: string[],     // from the report
  fingerprint: string,          // sha256 of partnerKey|capabilityKey|contractVersion|adapterVersion|expectedChecks|observedChecks|reportStatus
  evidenceHash: string,          // sha256 of operationId|settlementId|journalId|outboxId|auditId|callbackIds|referenceIds
  producedAt: string,
  notes: 'Read-only certification evidence; not a release gate on its own'
}
```

## 10. Replay safety

The engine can be invoked repeatedly with the same inputs and produces the same deterministic report (timestamps aside). The `replayHash` is the `sha256` of the sorted `discrepancy.code:discrepancy.message` list plus the fact-key fingerprint. It is omitted by default.

## 11. Read-only enforcement

The engine never issues write SQL. The `withReadOnlyTransaction` helper sets `SET TRANSACTION READ ONLY` and uses `REPEATABLE READ` isolation. The engine's only direct SQL is `SELECT` and `SET TRANSACTION READ ONLY`. The engine does not call any service write method.

## 12. Prohibited behavior

- No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` from the engine.
- No mutation of any source record through domain services.
- No use of `recordSuspense`, `recordCompensatingEntry`, `transition`, `recordProviderReference`, or any other write method.
- No provider call, partner HTTP, or callback.
- No claim that the engine is a release gate on its own; release requires separate A6T11 governance.

## 13. Out of scope

- A6T10 data minimization and consent controls.
- A6T11 release gate and A7 handoff.
- Provider statement/report ingestion.
- Automatic reconciliation repair.
- Production certification sign-off.
