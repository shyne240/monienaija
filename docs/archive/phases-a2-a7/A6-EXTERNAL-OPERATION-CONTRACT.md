# A6T05 — External Operation Identity and Provider Reference Contract

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T05 — External Operation Identity, References, and Provider Idempotency
- **Status:** Implemented identity/idempotency contract; provider communication and external lifecycle not implemented
- **Contract:** `ExternalOperationContractV1`
- **Selected capability:** `external.wallet.withdrawal.settlement`
- **Partner key:** `NIBSS_NIP`
- **Currency:** `NGN`
- **Application, database, API, controller, route, scheduler, provider, callback, settlement, and financial-runtime changes outside the operation/reference metadata boundary:** None

This document defines the durable logical-operation boundary for A6 external settlement. It does not define a provider wire protocol, callback behavior, settlement decision, external lifecycle state machine, or financial execution path.

## 1. Identity boundary

### 1.1 One logical operation

The A6T05 operation is one logical provider-facing intent associated with one existing internal withdrawal resource:

```text
A6T04 verified target mapping result
  + internal withdrawal/resource ID
  + internal command ID
  + canonical Customer.id
  + explicit WalletAccount/LedgerAccount IDs
  + amount/currency/accounting unit
  + Operations idempotency scope/key
  + request/correlation/trace/causation context
        |
        v
one durable externalOperationId
one deterministic externalOperationReference
one deterministic provider idempotency key
one provider-reference collection
```

A provider request is not sent by this task. The operation record is an immutable identity/correlation anchor for later A6T06/A6T07/A6T08 work.

### 1.2 Identifier ownership

| Identifier                     | Owner                          | Meaning                                                                | Must not be used as                                             |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `customerId`                   | Customer                       | Canonical internal customer identity.                                  | Provider identity, authorization, or financial truth.           |
| `walletAccountId`              | Wallet                         | Internal financial-wallet facade.                                      | External account or balance authority.                          |
| `ledgerAccountId`              | Ledger                         | Internal financial account.                                            | Provider account or operation identity.                         |
| `resourceId`                   | Withdrawal/payment lifecycle   | Existing internal withdrawal resource.                                 | External-operation or provider-reference identity.              |
| `internalCommandId`            | A6 command owner               | One logical command identity.                                          | Provider transaction ID or idempotency key.                     |
| `internalIdempotencyScope/key` | Operations                     | Internal duplicate-request collision domain.                           | Provider idempotency or financial truth.                        |
| `requestHash`                  | A6 command/operation boundary  | Hash of normalized semantic request.                                   | Authorization, policy, account ownership, or provider response. |
| `externalOperationId`          | A6 external-operation boundary | Durable UUID for one provider-facing operation.                        | Provider reference or Ledger journal.                           |
| `externalOperationReference`   | A6 external-operation boundary | Deterministic support/correlation reference derived from operation ID. | Customer identity or settlement proof.                          |
| `providerIdempotencyScope/key` | A6/partner boundary            | Partner-facing duplicate collision identity.                           | Internal Operations scope/key.                                  |
| `providerReference`            | Partner/provider namespace     | Provider request/operation/transaction/settlement reference.           | Customer, Wallet, Ledger, command, or financial truth.          |
| `journalId`                    | Ledger                         | Posted internal financial journal.                                     | Provider operation or settlement acceptance.                    |
| `auditEventId`                 | Operations                     | Immutable operational evidence.                                        | Operation result or financial truth.                            |
| `outboxEventId`                | Operations                     | Durable internal fact.                                                 | Provider delivery or settlement proof.                          |
| `reconciliationId`             | Reconciliation/Finance         | Independent discrepancy/control evidence.                              | Repair instruction or operation identity.                       |

## 2. Create command contract

```text
CreateExternalOperationCommandV1 {
  partnerKey: "NIBSS_NIP"
  capabilityKey: "external.wallet.withdrawal.settlement"
  operationType: "OUTBOUND_BANK_SETTLEMENT"
  resourceType: "WITHDRAWAL"
  resourceId: UUID
  internalCommandId: UUID

  customerId: Customer.id UUID
  walletAccountId: WalletAccount.id UUID
  ledgerAccountId: LedgerAccount.id UUID
  targetMappingReference: "a6-target:" + SHA-256 hex

  amountMinor: positive canonical minor-unit digit string
  currency: "NGN"
  accountingUnit: "CUSTOMER_FUNDS"

  idempotencyKey: opaque bounded caller key
  requestContext: {
    requestId
    correlationId
    traceId
  }
  causationId: bounded parent command/event identifier | null
}
```

The command does not carry a provider response or provider reference. A6T04 supplies `targetMappingReference`; A6T05 validates its shape but does not reconstruct or replace the mapping.

## 3. Request hash contract

### 3.1 Included semantic fields

The canonical request hash includes:

```text
contractVersion
partnerKey
capabilityKey
operationType
resourceType
resourceId
internalCommandId
customerId
walletAccountId
ledgerAccountId
targetMappingReference
amountMinor
currency
accountingUnit
```

Every included field can change the requested external effect or its immutable internal execution assertion.

### 3.2 Excluded transport/observation fields

The hash excludes:

```text
internal idempotencyKey
provider idempotency scope/key
externalOperationId
externalOperationReference
requestId
correlationId
traceId
causationId
provider request/operation/transaction references
adapter attempt marker
provider response data
credentials, tokens, signatures, and secret material
```

Exclusion from the hash does not remove these values from the durable correlation chain. They are persisted or returned through their owning boundaries with appropriate classification.

### 3.3 Canonicalization

Before hashing:

- UUIDs are trimmed and lowercased.
- Partner/capability/operation/resource keys use their registered exact values.
- `amountMinor` is parsed and reserialized as a base-10 digit string.
- Currency is trimmed and uppercased; A6T05 accepts `NGN` only.
- `accountingUnit` is exactly `CUSTOMER_FUNDS`.
- Target mapping reference is lowercased and validated against `^a6-target:[a-f0-9]{64}$`.
- Object keys are sorted recursively for canonical JSON.
- Request context and idempotency key are retained as correlation/duplicate inputs but excluded from the semantic hash.

The hash is:

```text
SHA-256(lowercase hex of canonical UTF-8 JSON)
```

## 4. Generated external identities

For a newly created operation:

```text
externalOperationId = UUID generated once
externalOperationReference =
  external-operation:v1:<sha256(NIBSS_NIP + ":" + externalOperationId + ":external-operation")>
providerIdempotencyScope = nibss.nip.external-operation.v1
providerIdempotencyKey =
  nibss.nip.external-operation.v1:<sha256(externalOperationId)>
```

The generated values are persisted in `external_operations` and remain immutable. A retry or replay MUST use the same values.

The internal `correlationId`, `requestId`, `traceId`, and `causationId` are preserved from the create command. They are not replaced by `externalOperationReference` or provider IDs.

## 5. Operations idempotency behavior

### 5.1 Internal scope

```text
scope: external.partner.operation.v1
key: caller-provided idempotency key
requestHash: A6T05-derived semantic hash
```

The `IdempotencyService` reservation and external-operation insert occur in the same database transaction. A failure to complete the Operations record rolls back the external-operation/reference metadata transaction.

### 5.2 Replay/conflict table

| Request condition                                              | Result                                                                                     | External operation mutation | Provider effect |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------- | --------------- |
| Same scope/key and same hash with completed reservation        | Original operation result with `replayed = true`.                                          | None.                       | None.           |
| Same scope/key and changed hash                                | Deterministic idempotency conflict.                                                        | None.                       | None.           |
| Same scope/key while reservation is in progress                | Controlled in-progress conflict.                                                           | None.                       | None.           |
| Different scope/key but same `internalCommandId` and same hash | Original operation result with `replayed = true`.                                          | No second operation.        | None.           |
| Different scope/key and changed command hash                   | Command/operation conflict or new logical command only after owner-level duplicate checks. | No silent reuse.            | None in A6T05.  |
| Provider reference already belongs to another operation        | Provider-reference conflict.                                                               | No remapping.               | None.           |
| Same provider reference repeated for the same operation        | Existing reference with `replayed = true`.                                                 | None.                       | None.           |

A6T05 does not make a provider call, so it cannot claim that a provider effect occurred or did not occur. It only ensures that the internal logical operation and provider-reference namespaces cannot be duplicated by this boundary.

## 6. Provider-reference contract

### 6.1 Reference model

```text
ExternalOperationReferenceV1 {
  id: UUID
  externalOperationId: UUID
  partnerKey: "NIBSS_NIP"
  referenceType:
    REQUEST | OPERATION | TRANSACTION | SETTLEMENT |
    CALLBACK | STATEMENT_ROW | PROVIDER_IDEMPOTENCY
  referenceValue: bounded printable opaque provider value
  namespace: partner/provider namespace
  source:
    REQUEST | ACKNOWLEDGEMENT | STATUS_QUERY |
    CALLBACK | STATEMENT | REPORT
  observedAt: RFC3339 UTC timestamp
  createdAt: RFC3339 UTC timestamp
  replayed: boolean
}
```

The table supports future callback/report references but A6T05 does not authenticate or process those events. A6T06 owns callback authenticity/replay handling.

### 6.2 Reference normalization

- `partnerKey` must be the selected `NIBSS_NIP` key.
- `referenceType` and `source` must use registered enums.
- `referenceValue` is trimmed printable ASCII up to 255 characters; raw payloads are not accepted.
- `namespace` is bounded to provider-safe alphanumeric/reference characters.
- `observedAt` must be a valid timestamp; it is evidence time, not settlement time.
- Reference value matching is exact after safe trim; A6T05 does not perform fuzzy matching, case folding, or provider-specific interpretation.

### 6.3 Uniqueness

The database enforces:

```text
(partnerKey, referenceType, referenceValue) UNIQUE
(externalOperationId, referenceType, referenceValue) UNIQUE
```

This prevents one provider transaction/reference from being mapped to two external operations and prevents duplicate reference rows for one operation.

## 7. Persistence contract

### 7.1 `external_operations`

The A6T05 record persists:

```text
operationVersion
partnerKey
capabilityKey
operationType
resourceType/resourceId
internalCommandId
customerId
walletAccountId
ledgerAccountId
targetMappingReference
amountMinor/currency/accountingUnit
internalIdempotencyScope/key
providerIdempotencyScope/key
requestHash
requestId/correlationId/traceId/causationId
createdAt/updatedAt/version
```

Identity/correlation fields are immutable. The record does not own a provider status, callback state, settlement state, suspense state, journal ID, or financial outcome yet; later A6T07/A6T08 work must extend the boundary without rewriting the identity.

### 7.2 `external_operation_references`

The reference table stores minimal provider-reference facts and is independently queryable by operation or partner/reference namespace. It does not store raw provider responses, credentials, signatures, target secrets, or full settlement payloads.

### 7.3 Migration and rollback

Migration `1785753600026-CreateExternalOperations` creates both tables, constraints, indexes, foreign keys, immutable-identity triggers, and rollback statements. It does not modify or backfill existing Withdrawal, Transfer, Deposit, Customer, Wallet, Ledger, Operations, Outbox, or Reconciliation rows.

## 8. Audit contract

The service records safe shared Operations audit facts:

```text
entityType: A6_EXTERNAL_OPERATION
entityId: externalOperationId
action: CREATED | REPLAYED | PROVIDER_REFERENCE_RECORDED
actor: a6-external-operation
correlationId/requestId
newValues:
  operation/reference/correlation IDs
  customer/account/resource IDs
  target mapping reference
  amount/currency/accounting unit
  internal/provider idempotency scope/key
  request hash
  provider reference type/namespace/hash where applicable
```

The provider reference value itself is not copied into generic audit values; a SHA-256 reference hash is recorded. Operations remains the audit authority.

## 9. Failure posture

A6T05 fails closed for:

- unsupported partner/capability/operation/resource type;
- invalid UUID, amount, currency, accounting unit, target mapping, request context, or idempotency key;
- changed payload under a retained internal idempotency key;
- duplicate internal command with a different semantic hash;
- provider reference mapped to another external operation;
- malformed provider-reference value/namespace/source; and
- unavailable or mismatched partner configuration.

No A6T05 failure authorizes a provider retry, callback transition, settlement, suspense release, Ledger post, balance mutation, or source-record repair.

## 10. Handoff to later tasks

- **A6T06:** may record authenticated callback references through the durable reference contract, but must validate authenticity and replay before lifecycle use.
- **A6T07:** may add external lifecycle state and bounded retry/recovery while preserving operation/reference identity.
- **A6T08:** may correlate verified provider/settlement evidence to Ledger without treating the operation record as financial truth.
- **A6T09:** may reconcile provider references, operation identity, settlement/suspense, journals, reports, and audit evidence read-only.
- **A6T10:** must apply field-level classification, retention, legal holds, and support access to provider references and raw evidence.
- **A6T11:** must include operation/replay/reference evidence in the selected-flow integration trace.

## 11. Verification record

- [x] One durable external-operation identity is generated per logical command.
- [x] Deterministic external-operation references and provider idempotency keys are generated.
- [x] Request hashes are derived from normalized semantic fields and exclude transport-only values.
- [x] Internal Operations idempotency is distinct from provider idempotency.
- [x] Same-key replay, changed-payload conflict, same-command replay, and provider-reference conflict are defined and tested.
- [x] Provider references are partner-scoped, reference-type-scoped, durable, immutable, and replay-safe.
- [x] Internal and provider identifiers remain distinct and correlated.
- [x] Audit values are safe/minimized and use the shared Operations service.
- [x] No provider communication, callback processing, settlement, financial execution, route, controller, scheduler, or external integration is included.
- [ ] A6T06 callback processing and A6T07 lifecycle/recovery remain intentionally incomplete.
