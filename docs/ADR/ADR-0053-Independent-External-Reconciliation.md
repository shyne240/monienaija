# ADR-0053: Independent External Reconciliation, Certification, and Support Trace

- **ADR ID:** ADR-0053
- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T09 — Independent External Reconciliation, Certification, and Support Trace
- **Status:** Implemented
- **Date:** 2026-08-08
- **Decision owners:** A6 partner owner, Finance/Ledger, Reconciliation, Support, and Operations owners
- **Authoritative boundary:** `ExternalReconciliationContractV1`
- **Selected partner:** `NIBSS_NIP`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Application, database, API, callback, partner, settlement, suspense, audit, outbox, and reconciliation changes in this task:** Independent read-only reconciliation engine, discrepancy vocabulary, support trace, and partner certification fingerprint; no source mutation, no provider communication, no public API, no additional provider integration

## 1. Decision

A6T09 introduces a single, Ledger-adjacent, read-only external reconciliation boundary that:

1. Compares one external operation, its provider references, callback receipts, settlement record, suspense entries, reversal entries, Ledger journal, audit evidence, and outbox evidence using `REPEATABLE READ` read-only PostgreSQL transactions.
2. Uses approved domain repository and service reads (`ExternalOperationService.get`, `ExternalOperationService.getInTransaction`, `ExternalSettlementService.getByOperation`, `ExternalSettlementService.getSuspenseForOperation`, `ExternalOperationService.recordProviderReferenceInTransaction` is not used) and source-table SQL queries for evidence that is not surfaced through services.
3. Returns a deterministic `ExternalReconciliationReport` that contains a `PASS`, `WARNING`, or `ERROR` status, a typed `ExternalReconciliationDiscrepancy[]` list, a read-only `ExternalReconciliationTrace`, and a `PartnerCertificationEvidence` fingerprint.
4. Never mutates any source record (Customer, funding instrument, A3 binding, Wallet, Ledger, external operation, callback, settlement, suspense, audit, outbox, idempotency, or partner reference).
5. Uses a typed `ExternalReconciliationDiscrepancyCode` vocabulary and `ExternalReconciliationOwner` responsibility map to assign each discrepancy to a recovery owner.
6. Produces a `ExternalReconciliationSupportTrace` that classifies fields by sensitivity (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`) so that downstream support, operations, and finance views can use only the minimum necessary fields.
7. Generates a deterministic `PartnerCertificationEvidence` fingerprint that names the partner, capability, contract version, adapter version, and the expected vs. observed evidence set, without storing secret material.

## 2. Reconciliation boundary

```text
ExternalReconciliationService.reconcileOperation(externalOperationId)
  -> dataSource.transaction('REPEATABLE READ', SET TRANSACTION READ ONLY)
    -> load operation, references, callback receipts, settlement, suspense, journals, audit, outbox
    -> evaluate discrepancies (pure function)
    -> build support trace with sensitivity classification
    -> compute certification fingerprint
    -> return read-only report
```

The reconciliation engine is the only owner of discrepancy classification. The service never writes audit, outbox, idempotency, or external fact records.

## 3. Discrepancy vocabulary

```text
OPERATION_NOT_FOUND                ERROR    RECONCILIATION
ORPHAN_OPERATION                   ERROR    RECONCILIATION
OPERATION_CURRENCY_MISMATCH        ERROR    FINANCE
OPERATION_ACCOUNTING_UNIT_MISMATCH ERROR    FINANCE
AMOUNT_MISMATCH                    ERROR    FINANCE
CURRENCY_MISMATCH                  ERROR    FINANCE
ACCOUNTING_UNIT_MISMATCH           ERROR    FINANCE
PARTNER_CAPABILITY_MISMATCH        ERROR    PARTNER_OWNER
CUSTOMER_ACCOUNT_MAPPING_MISMATCH  ERROR    WALLET
LIFECYCLE_NOT_VERIFIED             ERROR    PARTNER_OWNER
LIFECYCLE_TERMINAL                 ERROR    PARTNER_OWNER
LIFECYCLE_FAILED                   ERROR    PARTNER_OWNER
LIFECYCLE_CANCELLED                ERROR    PARTNER_OWNER
MISSING_PROVIDER_REFERENCE         ERROR    PARTNER_OWNER
DUPLICATE_PROVIDER_REFERENCE       ERROR    PARTNER_OWNER
PROVIDER_REFERENCE_NAMESPACE_MISMATCH WARNING PARTNER_OWNER
PROVIDER_REFERENCE_MAPPING_MISMATCH    ERROR    PARTNER_OWNER
MISSING_CALLBACK_RECEIPT           WARNING  PARTNER_OWNER
DUPLICATE_CALLBACK_RECEIPT         WARNING  PARTNER_OWNER
CALLBACK_AUTHENTICITY_REJECTED     ERROR    SECURITY
CALLBACK_REPLAY                    ERROR    SECURITY
CALLBACK_AMOUNT_MISMATCH           ERROR    PARTNER_OWNER
CALLBACK_CURRENCY_MISMATCH         ERROR    PARTNER_OWNER
CALLBACK_REFERENCE_MISMATCH        ERROR    PARTNER_OWNER
MISSING_SETTLEMENT                 WARNING  RECONCILIATION
DUPLICATE_SETTLEMENT               ERROR    FINANCE
SETTLEMENT_NOT_POSTED              WARNING  RECONCILIATION
SETTLEMENT_AMOUNT_MISMATCH         ERROR    FINANCE
SETTLEMENT_CURRENCY_MISMATCH       ERROR    FINANCE
SETTLEMENT_ACCOUNTING_UNIT_MISMATCH ERROR   FINANCE
SETTLEMENT_EVIDENCE_MISMATCH       ERROR    FINANCE
SETTLEMENT_CORRELATION_MISMATCH    ERROR    RECONCILIATION
SETTLEMENT_REVERSAL_ORPHAN         ERROR    FINANCE
SETTLEMENT_REVERSAL_DUPLICATE      ERROR    FINANCE
MISSING_JOURNAL                    ERROR    FINANCE
JOURNAL_CORRELATION_MISMATCH       ERROR    RECONCILIATION
JOURNAL_BALANCE_MISMATCH           ERROR    FINANCE
JOURNAL_REVERSAL_ORPHAN            ERROR    FINANCE
JOURNAL_REVERSAL_DUPLICATE         ERROR    FINANCE
MISSING_SUSPENSE_ENTRY             WARNING  RECONCILIATION
SUSPENSE_REVERSAL_DUPLICATE        ERROR    FINANCE
SUSPENSE_REVERSAL_MISSING          ERROR    FINANCE
SUSPENSE_AGED_OPEN                 WARNING  RECONCILIATION
SUSPENSE_AGED_HELD                 ERROR    FINANCE
MISSING_AUDIT_EVIDENCE             WARNING  RECONCILIATION
DUPLICATE_AUDIT_EVIDENCE           WARNING  RECONCILIATION
AUDIT_CORRELATION_MISMATCH         WARNING  RECONCILIATION
MISSING_OUTBOX_FACT                WARNING  RECONCILIATION
DUPLICATE_OUTBOX_FACT              WARNING  RECONCILIATION
OUTBOX_CORRELATION_MISMATCH        WARNING  RECONCILIATION
OUTBOX_PAYLOAD_MISMATCH            ERROR    RECONCILIATION
MISSING_IDEMPOTENCY_REPLAY         WARNING  RECONCILIATION
IDEMPOTENCY_HASH_MISMATCH          ERROR    RECONCILIATION
QUERY_UNAVAILABLE                  ERROR    RECONCILIATION
```

## 4. Authoritative ownership

| Concept                                       | Owner                                           |
| --------------------------------------------- | ----------------------------------------------- |
| Reconciliation engine                         | A6T09 (`ExternalReconciliationService`)         |
| Discrepancy classification                     | A6T09 (pure evaluator)                          |
| Discrepancy recovery owner assignment         | A6T09 (typed owner vocabulary)                  |
| Source fact reads                             | A6T09 (read-only SQL + domain services)         |
| Support trace classification                  | A6T09                                           |
| Partner certification fingerprint              | A6T09                                           |
| Audit, idempotency, outbox                    | Operations                                      |
| Ledger authority                              | A5 (`LedgerService`)                            |
| Settlement evidence                           | A6T08 (`ExternalSettlementService`)              |
| Suspense ownership                            | A6T08 (`finance-ledger-suspense`)               |
| Compensation authority                        | A6T08 (compensating journal)                    |
| External lifecycle authority                  | A6T07 (`ExternalOperationLifecycleService`)     |
| Callback authenticity                         | A6T06 (`PartnerCallbackAuthenticationService`)  |
| Partner connectivity                          | A6T03 (`PartnerConnectionService`)              |

## 5. Read-only and replay safety

The reconciliation engine wraps every operation in:

```text
dataSource.transaction('REPEATABLE READ', SET TRANSACTION READ ONLY)
```

No `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` SQL is issued from the engine. The engine does not call `save`, `update`, `delete`, or any write method on the domain services or repositories. The reconciliation may be run repeatedly with deterministic output.

## 6. Support trace sensitivity

| Field                                | Class           |
| ------------------------------------ | --------------- |
| `externalOperationId`                | INTERNAL        |
| `externalOperationReference`         | INTERNAL        |
| `customerId`                         | CONFIDENTIAL    |
| `walletAccountId`                    | CONFIDENTIAL    |
| `customerLedgerAccountId`            | CONFIDENTIAL    |
| `settlementAssetLedgerAccountId`     | CONFIDENTIAL    |
| `partnerKey`                         | INTERNAL        |
| `capabilityKey`                      | INTERNAL        |
| `partnerReferences[].referenceValue` | CONFIDENTIAL    |
| `callback.payload.amountMinor`       | CONFIDENTIAL    |
| `callback.signatureHash`             | RESTRICTED      |
| `callback.payloadHash`               | RESTRICTED      |
| `journal.totalMinor`                 | CONFIDENTIAL    |
| `journal.metadata`                   | CONFIDENTIAL    |
| `auditEvent.payload`                 | RESTRICTED      |
| `outbox.payload`                     | RESTRICTED      |
| `discrepancy.message`                | INTERNAL        |
| `discrepancy.code`                   | INTERNAL        |
| `supportClassification`              | INTERNAL        |

The support trace never contains raw PAN, CVV, PIN, OTP, callback secrets, signing keys, customer risk notes, or partner-confidential material.

## 7. Certification evidence

The certification fingerprint contains:

- `partnerKey`, `capabilityKey`, `capabilityVersion`, `adapterVersion`
- `contractName`, `contractVersion`
- `expectedChecks`: a deterministic list of expected check names
- `observedChecks`: the actual check names produced by the engine
- `fingerprint`: `sha256(partnerKey|capabilityKey|contractVersion|adapterVersion|expectedChecks|observedChecks|reportStatus)`
- `evidenceHash`: `sha256(operationId|settlementId|journalId|outboxId|auditId|callbackIds|referenceIds)`
- `contractReference` and `contractDocument` reference the ADR-0053 document and `ExternalReconciliationContractV1` for support evidence

The certification fingerprint is informational and is never used to authorize or bypass reconciliation, settlement, or audit checks.

## 8. Authoritative source boundaries

| Source                                 | Read path                                    | Not used                                  |
| -------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `external_operations`                  | Domain service + SQL facts                   | Direct `UPDATE`/`DELETE`                  |
| `external_operation_references`        | Domain service + SQL facts                   | Direct modification                       |
| `external_callback_receipts`           | Domain service + SQL facts                   | Direct modification                       |
| `external_settlements`                 | Domain service + SQL facts                   | Direct modification                       |
| `external_suspense_entries`            | Domain service + SQL facts                   | Direct modification                       |
| `ledger_journals` / `ledger_lines`     | SQL facts                                    | `LedgerService` writes                    |
| `audit_events`                         | SQL facts                                    | `AuditService` writes                     |
| `outbox_events`                        | SQL facts                                    | `OutboxService` writes                    |
| `idempotency_records`                  | SQL facts (replay hint, no mutation)         | Reservation or completion                 |
| `customer`, `customer_wallets`, etc.   | Not consulted (out of A6T09 scope)           | (placeholder for A3 evidence)             |

## 9. Prohibited behavior

- No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` from the engine.
- No call to `save`, `update`, `delete`, `record*`, `complete*`, `fail*` on domain services.
- No provider call, partner HTTP request, callback, status query, statement/report fetch, or reconciliation writer.
- No new audit, outbox, idempotency, or external fact rows.
- No use of `ExternalSettlementService.recordSuspense` or `recordCompensatingEntry` to "fix" a discrepancy.
- No claim that reconciliation evidence is sufficient to release a partner; release requires separate A6T11 governance.
- No claim that reconciliation evidence is sufficient to bypass the A6T08 settlement boundary; suspicious discrepancies must be raised as A6T08 suspense or compensating entries only after separate, approved compensating owner action.

## 10. Acceptance evidence

- `docs/A6-EXTERNAL-RECONCILIATION-CONTRACT.md` documents the full contract.
- `test/external-reconciliation.service.spec.ts` exercises successful reconciliation, missing settlement, missing journal, missing suspense, provider/internal mismatch, duplicate settlement, replay consistency, read-only behavior, certification evidence, and support trace.
- The engine performs no write SQL and no write method calls.
- The engine is registered in the existing `ReconciliationModule` so it can be consumed by the A6 module and future A6T11 release gate.
- The engine produces a deterministic certification fingerprint that can be diffed across runs and saved as release evidence.
