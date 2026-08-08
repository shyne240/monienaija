# ADR-0049: External Operation Identity, Reference, and Idempotency

- **Status:** Proposed A6 implementation decision; A6T05 identity and persistence boundary implemented, provider communication not implemented
- **Date:** 2026-08-08
- **Scope:** Durable external-operation identity, provider-reference mapping, request hashing, internal/provider idempotency separation, deterministic reference generation, replay detection, and Operations audit
- **Task:** A6T05 — External Operation Identity, References, and Provider Idempotency
- **Selected capability:** NGN `external.wallet.withdrawal.settlement` through `NIBSS_NIP`
- **Implementation status:** External-operation/reference entities, migration, Operations-backed replay/conflict handling, deterministic references, provider-reference uniqueness, and audit integration added; no provider call, callback processing, settlement, or financial execution added

## Context

A6T01 selected one bounded external flow and A6T02/A6T03 established a provider-neutral adapter and disabled-by-default connection boundary. A6T04 produces a deterministic, opaque target mapping handle after A2 authorization, A4 policy assertion, A3 internal account validation, source-owner verification, bank-directory checks, and consent assertion validation.

The repository did not previously have an external-operation record or provider-reference namespace. Existing internal IDs and references are not interchangeable:

```text
Customer.id
WalletAccount.id
LedgerAccount.id
Withdrawal/Deposit/Transfer ID
internal command ID
Operations idempotency scope/key
request/correlation/trace/causation IDs
A6 external-operation ID/reference
provider idempotency scope/key
provider request/operation/transaction reference
callback/statement/report reference
Ledger journal ID
Operations audit/outbox IDs
Reconciliation discrepancy ID
```

A6T05 must establish the durable correlation and duplicate boundary without calling a provider or deciding financial settlement. A provider response, callback, external reference, or idempotency record is not financial truth.

## Decision

### 1. Durable external-operation record

A6T05 uses one A6-owned `external_operations` record for the selected operation identity and immutable request/correlation assertions. It is metadata and integration state, not a balance, journal, settlement, or provider truth authority.

The record contains:

- contract/operation version;
- selected partner, capability, and operation type;
- internal resource type/ID and internal command ID;
- canonical customer, WalletAccount, and LedgerAccount IDs supplied by the upstream A3/A6 boundary;
- A6T04 target mapping reference;
- positive amount, explicit NGN currency, and `CUSTOMER_FUNDS` accounting unit;
- internal Operations idempotency scope/key and derived request hash;
- partner/provider idempotency scope/key;
- request, correlation, trace, and causation identifiers; and
- immutable creation/update/version metadata.

A6T05 does not add an external lifecycle state machine. A6T07 owns submitted, pending, unknown, manual-review, failed, and provider-outcome lifecycle behavior. A6T05 records the operation identity that those later states will reference.

### 2. External-operation identity and reference generation

For a new logical operation:

```text
externalOperationId = UUID generated once and durably retained
externalOperationReference =
  external-operation:v1:<sha256(NIBSS_NIP + ":" + externalOperationId + ":external-operation")>
providerIdempotencyScope = nibss.nip.external-operation.v1
providerIdempotencyKey =
  nibss.nip.external-operation.v1:<sha256(externalOperationId)>
```

The UUID is the durable operation identity. The operation reference and provider idempotency key are deterministic derivatives of that identity. A replay returns the original values and never creates a new operation identity.

The internal request/correlation context is preserved from the command. A6T05 does not replace a caller's `requestId`, `correlationId`, `traceId`, or `causationId` with a new transport attempt value.

### 3. Provider request hashing

The service derives the request hash from canonical semantic material. It does not trust a caller-supplied hash.

The hash material includes:

```text
contract/operation version
partnerKey
capabilityKey
operationType
resourceType + resourceId
internalCommandId
customerId
walletAccountId
ledgerAccountId
targetMappingReference
amountMinor
currency
accountingUnit
```

The canonical serializer sorts object keys recursively and preserves declared array order. The hash is:

```text
SHA-256(lowercase hex of canonical UTF-8 JSON)
```

The following values are excluded because they identify transport, observation, or later-created identity rather than the requested external effect:

```text
internal idempotency key
provider idempotency key
externalOperationId
externalOperationReference
requestId
correlationId
traceId
causationId
provider response/reference values
adapter attempt markers
HTTP method/path/header formatting
credentials, tokens, signatures, and raw secret material
```

The target mapping reference already binds the approved A6T04 source, target version, bank, policy, consent, currency, and internal account context. A6T05 does not reconstruct or replace that mapping.

### 4. Operations-backed internal idempotency

The shared Operations `IdempotencyService` remains the internal replay/conflict authority:

```text
scope: external.partner.operation.v1
key: caller-provided bounded key
requestHash: A6T05-derived semantic hash
```

For a new request:

1. Normalize and validate the command.
2. Derive the semantic request hash.
3. Reserve the Operations scope/key/hash in the same transaction that creates the external-operation record.
4. Generate one external-operation ID and derived references.
5. Persist the operation and its provider-idempotency reference atomically.
6. Record a safe Operations audit fact.
7. Complete the Operations idempotency record with the external-operation ID and safe result.

For a replay:

- same scope/key/hash returns the original external-operation ID/reference/provider key and marks the result `replayed = true`;
- same scope/key with a changed hash raises a deterministic conflict without creating a row or provider effect;
- an in-progress reservation raises a controlled conflict; and
- a different idempotency key with the same internal command ID and same hash replays the existing external operation rather than creating a duplicate.

The A6 provider idempotency scope/key remains distinct from the Operations scope/key. A6T05 does not call or retry a provider.

### 5. Provider-reference persistence and uniqueness

Provider references are stored in `external_operation_references`, separate from the operation record because one operation may receive multiple references:

```text
REQUEST
OPERATION
TRANSACTION
SETTLEMENT
CALLBACK
STATEMENT_ROW
PROVIDER_IDEMPOTENCY
```

Each reference retains:

- external-operation ID;
- partner key;
- reference type;
- opaque provider value;
- partner/provider namespace;
- evidence source (`REQUEST`, `ACKNOWLEDGEMENT`, `STATUS_QUERY`, `CALLBACK`, `STATEMENT`, or `REPORT`); and
- observed/created timestamps.

The database enforces uniqueness for:

```text
(partnerKey, referenceType, referenceValue)
(externalOperationId, referenceType, referenceValue)
```

A same-operation replay of the same provider reference returns the existing reference with `replayed = true`. A provider reference already mapped to another external operation raises a conflict. A6T06 later owns callback authenticity and callback processing; the reference table's future `CALLBACK` source value does not mean callbacks are implemented by A6T05.

### 6. Immutable identity and migration boundary

The migration adds:

```text
external_operations
external_operation_references
```

It adds foreign keys from the operation record to the existing internal `withdrawals`, `customers`, `wallet_accounts`, and `ledger_accounts` records. It does not change those source tables or post any financial value.

Database constraints enforce:

- selected NIBSS/NIP partner and outbound bank-settlement capability;
- selected `WITHDRAWAL` resource type;
- positive amount, NGN currency, and `CUSTOMER_FUNDS` accounting unit;
- valid A6T04 target mapping reference;
- SHA-256 request hash;
- positive operation/version values; and
- provider-reference namespace/type/value shape.

Database triggers reject mutation of immutable operation identity/correlation fields and provider-reference facts. Later lifecycle fields, if required by A6T07, must be added without weakening these identity constraints.

Migration up/down is migration-controlled and preserves all pre-existing Customer, Wallet, Ledger, A2, A3, A4, A5, Operations, Outbox, and Reconciliation records.

### 7. Operations audit

A6T05 records safe facts through the shared `AuditService`:

```text
entityType: A6_EXTERNAL_OPERATION
action: CREATED | REPLAYED | PROVIDER_REFERENCE_RECORDED
entityId: externalOperationId
actor: a6-external-operation
correlationId + requestId
safe operation/customer/account/target/request-hash references
provider-reference hash/type/namespace when a reference is recorded
```

Raw provider reference values are stored only in the restricted external-reference record and are hashed in audit values. Credentials, signatures, raw provider responses, target secrets, balances, journal lines, and unrestricted risk/compliance content are excluded.

## Alternatives considered

### Use the provider reference as the internal operation ID

Rejected. Provider references are partner-scoped, may arrive late, may be absent, and are not canonical internal identity. A6 owns a durable external-operation ID first.

### Use a local in-memory idempotency map

Rejected. Process memory is not durable and cannot protect against restart or concurrent execution. Operations owns internal idempotency.

### Use one global provider-reference namespace

Rejected. Different providers/reference types have separate collision domains. Uniqueness is scoped by partner and reference type.

### Generate a new provider idempotency key for every retry

Rejected. A new key could create a second external effect after an ambiguous response. A6T05 derives one provider key from the original external-operation ID.

### Store raw provider payloads in the external-operation record

Rejected. The operation stores minimal identity/correlation facts. Restricted evidence storage and callback/report handling belong to later A6 tasks and A6T10 data controls.

### Mutate the Withdrawal or Ledger record during operation creation

Rejected. A6T05 creates only its own operation/reference metadata and Operations evidence. A5/payment lifecycle and Ledger remain separate authorities.

## Consequences

### Positive

- One logical internal command maps to one durable external-operation identity.
- Same-key replays, changed-payload conflicts, same-command duplicates, and provider-reference collisions are deterministic.
- Provider references remain separate, partner-scoped, and queryable.
- Provider idempotency is stable across later retries without making the adapter an idempotency authority.
- Operations audit and idempotency remain shared infrastructure authorities.
- No provider call, callback processing, settlement, balance mutation, or financial execution is possible from A6T05.

### Future review items

- A6T06 must validate callback authenticity and map callback references using this reference boundary.
- A6T07 must add lifecycle/retry/timeout/circuit/unknown states without mutating identity fields.
- A6T08 must correlate verified external outcomes with Ledger settlement/suspense decisions.
- A6T09 must independently reconcile external references, operations, settlement, journals, and reports.
- A6T10 must finalize provider-reference classification, retention, legal hold, support access, and data-sharing controls.

## Explicitly out of scope

This ADR and A6T05 do not:

- call NIBSS, a bank, or any provider;
- create callbacks, webhook routes, status queries, statement readers, provider clients, schedulers, brokers, or external integrations;
- process a provider response or decide whether a provider request was accepted or settled;
- implement external lifecycle states, bounded retries, circuit breakers, unknown-outcome recovery, settlement, suspense, or reconciliation;
- modify Customer, CustomerWallet, funding instruments, beneficiaries, banks, A3 bindings, A4 policy, Wallet, Ledger, Transfer, Deposit, Withdrawal, journal, line, balance, or reconciliation source records;
- create a local audit/idempotency authority outside Operations;
- expose a controller, route, public API, partner API, or customer-facing result; or
- implement A6T06 or any later A6, A7, or A8 task.

## Implementation evidence

- [`src/partner/external-operation.entity.ts`](../../src/partner/external-operation.entity.ts)
- [`src/partner/external-operation-reference.entity.ts`](../../src/partner/external-operation-reference.entity.ts)
- [`src/partner/external-operation.enums.ts`](../../src/partner/external-operation.enums.ts)
- [`src/partner/external-operation.types.ts`](../../src/partner/external-operation.types.ts)
- [`src/partner/external-operation.service.ts`](../../src/partner/external-operation.service.ts)
- [`src/partner/partner.module.ts`](../../src/partner/partner.module.ts)
- [`src/migrations/1785753600026-CreateExternalOperations.ts`](../../src/migrations/1785753600026-CreateExternalOperations.ts)
- [`src/operations/idempotency.service.ts`](../../src/operations/idempotency.service.ts)
- [`src/operations/audit.service.ts`](../../src/operations/audit.service.ts)
- [`docs/A6-PARTNER-ADAPTER-CONTRACT.md`](../A6-PARTNER-ADAPTER-CONTRACT.md)
- [`docs/A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md`](../A6-EXTERNAL-FUNDING-INSTRUMENT-CONTRACT.md)
- [`docs/A6-IMPLEMENTATION-PLAN.md`](../A6-IMPLEMENTATION-PLAN.md)

## A6T05 verification record

- [x] Durable external-operation identity and immutable internal correlation fields are implemented.
- [x] External-operation reference generation is deterministic from the durable operation ID.
- [x] Provider idempotency scope/key is distinct and deterministically derived from the external-operation ID.
- [x] A6T05 derives canonical request hashes and does not trust caller-supplied hashes.
- [x] Operations-backed same-key/same-payload replay and same-key/changed-payload conflict behavior are implemented.
- [x] Same internal command ID cannot create a second external operation for the same request hash.
- [x] Provider references are durable, partner/reference-type scoped, unique, and replay-safe.
- [x] Provider identities remain separate from Customer, Wallet, Ledger, command, lifecycle, audit, outbox, and reconciliation identities.
- [x] Operations audit records safe operation/reference evidence.
- [x] No provider communication, callbacks, settlement, financial execution, controller, route, scheduler, or external integration is introduced.
- [ ] A6T06 callback processing and A6T07 lifecycle/recovery remain intentionally incomplete.
