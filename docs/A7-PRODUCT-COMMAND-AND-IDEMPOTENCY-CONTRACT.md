# A7T05 — A7 Product Command Identity, Lifecycle, and Idempotency

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T05 — Product Command Identity, Lifecycle, and Idempotency
- **Status:** A7 product command/operation identity, request-hash, and product/provider idempotency contract defined; A6T05 external-operation identity reused (not replaced) as the A6 partner reference identity; A5 transfer command correlation, A6T05 external-operation identity, A2 authorization context, A4 product-policy decision reference, and A3 binding reference correlated under one A7 product command envelope; no A7 runtime product command implementation introduced beyond the read-only consumer contract and the documented identity/hashing/idempotency rules
- **Contract:** `A7ProductCommandContractV1` / `A7ProductCommandOperationV1` / `A7ProductCommandReplayV1` / `A7ProductCommandConflictV1` / `A7ProductCommandHandoffV1`
- **Identity namespaces:** `A7-PRODUCT-COMMAND` v1 (durable product command identity), `A7-PRODUCT-OPERATION` v1 (durable product operation identity), `A7-PRODUCT-IDEMPOTENCY.v1` (product internal idempotency scope), `A7-PRODUCT-PROVIDER-IDEMPOTENCY.v1` (product provider idempotency scope, sourced from A6T05)
- **Upstream authorities consumed (not replaced):** A1 canonical ownership, A2 authorization, A3 customer-to-financial-account binding, A4 product-policy profile (A7T03), A5 transfer/withdrawal/deposit command correlation, A6T05 external-operation identity and provider idempotency (ADR-0049), A6 partner-adapter boundary, A7 product catalog (A7T02), A7 product-policy profile (A7T03), A7 product customer-binding map (A7T04), `CustomerPreference` (intent authority), Operations `AuditService` / `IdempotencyService` / `OutboxService` (shared primitives)
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, and A8 changes:** None (A7T05 is a documentation and consumer-boundary artifact; the A6T05 `external_operations` and `external_operation_references` tables are read and a new A7T05 durable product command/operation record is documented but not yet persisted; the Operations `IdempotencyService`, `AuditService`, and `OutboxService` are the only idempotency, audit, and outbox authorities; no new table, no new column, no new index, no new trigger, no new entity, no new migration is introduced by A7T05)

This document defines the A7 product command identity, product operation record, request hashing, correlation, and product/provider idempotency behavior for the A7 first product (`VIRTUAL_ACCOUNT` v1) under the existing A2 / A3 / A4 / A5 / A6 / Operations authorities. It does not introduce a second customer-binding system, a second policy engine, a second authorization system, a second settlement authority, a second reconciliation engine, a second audit authority, a second idempotency authority, or a second outbox authority. It does not introduce a public API, a public route, a controller, a scheduler, a notification dispatcher, or a product execution path.

## 1. Contract boundary

### 1.1 Purpose

The A7 product command and idempotency contract is the durable boundary that binds the A7 first product's command identity, operation identity, request hash, correlation chain, and product/provider idempotency to the existing A2 / A3 / A4 / A5 / A6 / Operations authorities. The A7 product command envelope is consumed by A7T05 (this task), A7T07 (product lifecycle), A7T08 (product financial effect), and A7T09 (product reconciliation). The A7 product command envelope is not a second authority, a second reconciliation writer, a second financial effect, or a second notification.

```text
A2 authorization context (A2 principal, audience, scopes, customer access, request/correlation/trace/causation)
  + A4 product-policy decision reference (A7T03)
  + A3 internal account binding reference (A3 binding record id + version; A7T04 map)
  + A7 product catalog registration (A7T02: productKey, capabilityKey, action, productState, currency, accountingUnit, targetType)
  + A7 product customer-binding map reference (A7T04)
  + A6 partner reference (A6T05 externalOperationId + externalOperationReference + provider idempotency scope/key; per ADR-0049)
  + A7 product command identity (A7T05: productCommandId + productCommandReference)
  + A7 product operation identity (A7T05: productOperationId + productOperationReference)
  -> A7ProductCommandContractV1
       -> A7ProductCommandOperationV1
            A7 product command id
            A7 product operation id
            A7 product state
            A3 binding tuple
            A4 product-policy decision reference
            A2 authorization context reference
            A6 partner reference (sourced from A6T05)
            A7 product customer-binding map reference (A7T04)
            A7 product command request hash
            A7 product provider idempotency key (sourced from A6T05)
            request/correlation/trace/causation
       -> A7ProductCommandHandoffV1
            productOperationReference
            a6PartnerReference
            a4ProductPolicyDecisionReference
            a2AuthorizationContextReference
            a3BindingReference
            a7ProductCustomerBindingMapReference
```

The A7 product command and idempotency contract is a read-write contract against the shared Operations `IdempotencyService` and the A6T05 `ExternalOperationService`. It does not write to `Customer`, `CustomerWallet`, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, the A3 binding, the A4 policy/source, the A5 transfer history, the Wallet balances, the Ledger journals/lines, the `CustomerPreference`, the existing `VirtualAccount` row, or any source record outside its own durable A7 product command/operation record.

### 1.2 Normative language

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state, dependency, or interpretation.
- **SHOULD** means the default behavior unless a later approved product contract documents a safer alternative.
- **MAY** means an optional field or later product-extension point that cannot weaken an invariant.
- **A3 binding** means the A3 `CustomerFinancialAccountBinding` record that links `Customer.id` → `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`. A3 is the only customer-binding authority.
- **A4 product-policy decision** means the A4 `PolicyDecisionResult` produced by the A7T03 A4 product-policy service. A4 is the only policy authority.
- **A2 authorization context** means the A2 `AuthorizationDecision` produced by the existing A2 `AuthorizationService`. A2 is the only authorization authority.
- **A6T05 external-operation** means the A6T05 `ExternalOperation` record produced by the existing A6T05 `ExternalOperationService` (per ADR-0049). A6T05 is the only A6 partner reference authority.
- **A7 product customer-binding map** means the A7T04 `A7ProductCustomerBindingMapV1`. A7T04 is the only A7 product customer-binding authority.
- **A7 product command** means the A7T05 `A7ProductCommandContractV1` produced by the A7T05 product command service. A7T05 is the only A7 product command/operation authority.
- **A7 product operation** means the A7T05 `A7ProductCommandOperationV1` produced by the A7T05 product command service. A7T05 is the only A7 product operation authority.
- **Operations idempotency** means the shared Operations `IdempotencyService` (reused as-is). Operations is the only idempotency authority.
- **Operations audit** means the shared Operations `AuditService` (reused as-is). Operations is the only audit authority.
- **Operations outbox** means the shared Operations `OutboxService` (reused as-is). Operations is the only outbox authority.

### 1.3 Contract port shape

The logical A7 product command port is equivalent to:

```text
A7ProductCommandContractV1
  reserveProductCommand(
    command: A7ProductCommandCreateV1
  )
    -> A7ProductCommandReservationV1
       { kind: 'NEW' | 'REPLAY' | 'IN_PROGRESS' | 'CONFLICT' }
       { record: A7ProductCommandOperationV1 | null }

  completeProductCommand(
    reservationId: UUID,
    result: A7ProductCommandCompleteV1
  )
    -> A7ProductCommandOperationV1

  failProductCommand(
    reservationId: UUID,
    result: A7ProductCommandFailV1
  )
    -> A7ProductCommandOperationV1

  getProductCommandOperation(
    productCommandId: UUID
  )
    -> A7ProductCommandOperationV1 | null

  getProductCommandOperationByA6ExternalOperationId(
    externalOperationId: UUID
  )
    -> A7ProductCommandOperationV1 | null
```

The A7 product command port is read-only with respect to A2, A3, A4, A5, A6T05, A6 partner, A7 product catalog, A7T04 product customer-binding, Wallet, Ledger, `CustomerPreference`, and the existing `VirtualAccount` row. The A7 product command port is read-write only with respect to the shared Operations `IdempotencyService`, `AuditService`, and `OutboxService`, and the durable A7 product command/operation record.

### 1.4 Identity namespaces (frozen)

```text
contractName:           "A7-PRODUCT-COMMAND"
contractVersion:        1
identityNamespace:      "A7-PRODUCT-COMMAND"
operationNamespace:     "A7-PRODUCT-OPERATION"
idempotencyScope:       "A7-PRODUCT-IDEMPOTENCY.v1"
providerIdempotencyScope: "A7-PRODUCT-PROVIDER-IDEMPOTENCY.v1" (sourced from A6T05; reused)
auditEntityType:        "A7_PRODUCT_COMMAND"
```

Every A7 product command, product operation, replay, conflict, and handoff is part of `A7-PRODUCT-COMMAND` v1. A later identity version (v2) may add optional fields, optional evidence sources, or a second frozen product command shape; it MUST NOT weaken v1 invariants or silently re-broaden the v1 first-product command contract.

### 1.5 Selected first-product command envelope (frozen summary)

```text
productKey:           VIRTUAL_ACCOUNT
productVersion:       1
capabilityKey:        virtual-account.assign
                       virtual-account.inbound-funding
direction:            inbound
currency:             NGN
accountingUnit:       CUSTOMER_FUNDS
targetType:           BANK_ACCOUNT
partnerDependency:    NIBSS_NIP (A6 partner; planning rail; disabled-by-default)
internalCommandOwner: A7 product command boundary (A7T05)
internalBinding:      A3 (CustomerFinancialAccountBinding)
partnerReference:     A6T05 (ExternalOperation / ExternalOperationReference)
productPolicy:        A4 (A7T03 product-policy profile)
authorizationContext: A2 (AuthorizationDecision)
```

## 2. Canonical identity and identity-separation rules

### 2.1 Identity vocabulary

```text
A7ProductCommandIdV1                  UUID (canonical A7 product command id; generated by the A7T05 product command service)
A7ProductCommandReferenceV1           A7 product command reference ("a7-product-command:v1:<sha256(productCommandId)>")
A7ProductOperationIdV1                UUID (canonical A7 product operation id; generated by the A7T05 product command service)
A7ProductOperationReferenceV1         A7 product operation reference ("a7-product-operation:v1:<sha256(productOperationId)>")
A7ProductIdempotencyKeyV1             string (A7 internal idempotency key; keyed to the A7 internal idempotency scope "A7-PRODUCT-IDEMPOTENCY.v1")
A7ProductProviderIdempotencyKeyV1     string (A7 provider idempotency key; sourced from the A6T05 provider idempotency key; the A6T05 provider idempotency scope/key is reused, not duplicated)
CustomerIdV1                          UUID (canonical internal customer identity)
CustomerWalletIdV1                    UUID (canonical internal customer-wallet identity)
CustomerFinancialAccountBindingIdV1   UUID (A3 binding record id; reused from A3)
A6ExternalOperationIdV1               UUID (A6T05 external-operation id; reused from A6T05)
A6ExternalOperationReferenceV1        string (A6T05 external-operation reference; reused from A6T05)
A6ProviderIdempotencyKeyV1            string (A6T05 provider idempotency key; reused from A6T05)
A2AuthorizationContextReferenceV1     string (A2 authorization context reference; reused from A2)
A4ProductPolicyDecisionReferenceV1    string (A4 product-policy decision reference; reused from A7T03)
A7ProductCustomerBindingMapReferenceV1 string (A7T04 product customer-binding map reference; reused from A7T04)
RequestContext                        { requestId, correlationId, traceId, causationId } (reused from A5)
```

The canonical internal customer identity is `Customer.id`. The A3 binding tuple is the only source of `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`. The A6T05 external-operation record is the only source of the A6 partner reference. The A7 product command/operation identity is the only source of the A7 product command/operation reference. The four identities — `Customer.id`, the A3 binding tuple, the A6T05 external-operation record, and the A7 product command/operation record — remain distinct and correlated through the A7 product command envelope.

### 2.2 Identity-separation matrix

| Identity                                                            | Owner                                       | A7T05 read relationship                                                                                                  | A7T05 MUST NOT do                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `Customer.id`                                                        | Customer module                              | Correlation only; never internal account source                                                                         | Treat customer reference as virtual-account, partner reference, or product command    |
| `CustomerWallet.id`                                                  | Customer-wallet module                       | Read from A3 binding record; never infer                                                                                  | Treat customer-wallet id as virtual-account, partner reference, or product command   |
| `CustomerFinancialAccountBinding.id` / `bindingVersion`              | A3                                          | The only source of internal account tuple                                                                                 | Repair, reassign, activate, or close an A3 binding to make a product command pass   |
| `WalletAccount.id`                                                   | Wallet module                                | Read from A3 binding record                                                                                              | Derive from any other source                                                         |
| `LedgerAccount.id`                                                   | Ledger module                                | Read from A3 binding record                                                                                              | Derive from any other source                                                         |
| A4 `PolicyDecisionResult.decisionReference`                          | A4 (A7T03)                                  | Read the A4 product-policy decision reference                                                                            | Evaluate or mutate A4 policy/source evidence                                        |
| A2 `AuthorizationDecision.evaluatedAt` derived reference             | A2                                          | Read the A2 authorization context reference                                                                              | Issue, refresh, or substitute A2 authorization                                       |
| A6T05 `externalOperationId` / `externalOperationReference`           | A6T05 (per ADR-0049)                         | The only source of the A6 partner reference identity and the only authority for the A6 partner idempotency scope/key    | Issue, refresh, or substitute the A6 partner reference                                |
| A6T05 `providerIdempotencyScope` / `providerIdempotencyKey`          | A6T05 (per ADR-0049)                         | The only source of the A6 partner provider idempotency identity; the A7 product command references it, never substitutes it | Duplicate the A6T05 provider idempotency scope/key                                    |
| A7T04 `A7ProductCustomerBindingMapV1.mapReference`                   | A7T04                                       | The only source of the A7 product customer-binding map reference; the A7 product command references it                    | Re-derive the product customer-binding map inside the A7 product command            |
| A7T05 `productCommandId` / `productCommandReference`                  | A7T05                                       | The only source of the A7 product command identity                                                                        | Substitute the A3 binding tuple, the A4 product-policy decision, the A2 authorization, the A6T05 external-operation, or the A7T04 product customer-binding map |
| A7T05 `productOperationId` / `productOperationReference`             | A7T05                                       | The only source of the A7 product operation identity                                                                       | Substitute the A3 binding tuple, the A4 product-policy decision, the A2 authorization, the A6T05 external-operation, the A7 product command, or the A7T04 product customer-binding map |
| `VirtualAccount.{id, provider, accountNumber, accountName, bankCode, reference, status, assignedAt, deactivatedAt}` | existing `virtual-account` module (compatibility input) | Read as ownership evidence; never internal account source                                                                  | Mutate, deactivate, or reassign the existing `VirtualAccount` row                   |
| `payment_reference`                                                  | `payment` module (compatibility input)        | Read as cross-domain correlation evidence                                                                                  | Treat payment reference as internal account source                                   |
| A7 `productKey`                                                      | A7 product catalog (A7T02)                  | Read the A7 product catalog registration                                                                                  | Re-implement the A7 product catalog                                                  |

### 2.3 Canonical identity rules

- `Customer.id` MUST be the only canonical internal customer identity. A virtual-account identifier, a bank code, a bank account number, an A6 partner reference, an A6T05 provider idempotency key, a payment reference, a funding-instrument identifier, a beneficiary identifier, a notification identifier, a preference value, an A7 product command id, or an A7 product operation id MUST NOT become or substitute for `Customer.id`.
- The A3 `CustomerFinancialAccountBinding` record is the only source of `CustomerWallet.id`, `WalletAccount.id`, and `LedgerAccount.id`. The A7 product command service MUST read these ids from the A3 binding record and MUST NOT derive them from any other source.
- The A6T05 `ExternalOperation` record is the only source of the A6 partner reference identity (`externalOperationId` and `externalOperationReference`) and the only authority for the A6 partner provider idempotency scope/key. The A7 product command service MUST read the A6T05 `externalOperationId`, `externalOperationReference`, and `providerIdempotencyKey` from the existing A6T05 `ExternalOperationService` consumer boundary and MUST NOT duplicate, derive, or substitute them.
- The A7 product command service MUST generate one `productCommandId` (UUID) and one `productCommandReference` per A7 product command; the `productCommandId` is the durable A7 product command identity, and the `productCommandReference` is the deterministic derivative of that identity.
- The A7 product command service MUST generate one `productOperationId` (UUID) and one `productOperationReference` per A7 product operation; the `productOperationId` is the durable A7 product operation identity, and the `productOperationReference` is the deterministic derivative of that identity.
- The A7 product command service MUST read the A2 authorization context reference from the A2 `AuthorizationService` consumer boundary; the A7 product command service MUST NOT issue, refresh, or substitute the A2 authorization context.
- The A7 product command service MUST read the A4 product-policy decision reference from the A7T03 A4 product-policy service consumer boundary; the A7 product command service MUST NOT evaluate, mutate, or refresh the A4 product-policy decision.
- The A7 product command service MUST read the A7T04 product customer-binding map reference from the A7T04 `A7ProductCustomerBindingService` consumer boundary; the A7 product command service MUST NOT re-derive the product customer-binding map inside the A7 product command.
- The existing `VirtualAccount` row is a compatibility evidence record. The A7 product command service MUST read `VirtualAccount.{id, provider, accountNumber, accountName, bankCode, reference, status, assignedAt, deactivatedAt}` from the existing module and MUST NOT mutate the existing module to make a product command pass.

## 3. A7 product command envelope

### 3.1 Command envelope

```text
A7ProductCommandCreateV1 {
  contractName: "A7-PRODUCT-COMMAND"
  contractVersion: 1

  productKey: A7ProductKey
  productVersion: A7ProductVersion
  capabilityKey: A7ProductCapabilityKey
  action: A7ProductAction
  productState: A7ProductState

  customerId: UUID
  customerWalletId: UUID
  bindingId: UUID
  bindingVersion: number

  a7ProductCustomerBindingMapReference: string        (A7T04 map reference)
  a4ProductPolicyDecisionReference: string           (A4 PolicyDecisionResult.decisionReference)
  a2AuthorizationContextReference: string            (A2 AuthorizationDecision.evaluatedAt derived reference)
  a6ExternalOperationId: string                       (A6T05 externalOperationId)
  a6ExternalOperationReference: string                (A6T05 externalOperationReference)
  a6ProviderIdempotencyScope: string                  (A6T05 providerIdempotencyScope)
  a6ProviderIdempotencyKey: string                    (A6T05 providerIdempotencyKey)

  amountMinor: string | number | bigint              (positive integer minor units)
  currency: "NGN"
  accountingUnit: "CUSTOMER_FUNDS"

  idempotencyScope: "A7-PRODUCT-IDEMPOTENCY.v1"
  idempotencyKey: string
  requestHash: string

  requestContext: RequestContext
  causationId: string | null
}
```

The A7 product command envelope is the durable A7 product command input. The envelope is versioned, schema-validated, and idempotency-keyed. The A7 product command service does not trust a caller-supplied request hash; it derives the canonical request hash from the semantic material of the command.

### 3.2 Command rules

- A command MUST declare exactly one `productKey`, `productVersion`, `capabilityKey`, `action`, and `productState`.
- A command MUST declare a `customerId`, a `customerWalletId`, a `bindingId`, and a `bindingVersion`. The A7 product command service MUST NOT derive these ids from a virtual-account identifier, an A6 partner reference, a preference value, or product data.
- A command MUST declare a positive integer `amountMinor`, a `currency` of `NGN`, and an `accountingUnit` of `CUSTOMER_FUNDS`. The A7 product command service MUST reject any command with a non-`NGN` currency, a non-`CUSTOMER_FUNDS` accounting unit, a non-positive `amountMinor`, or a non-integer `amountMinor`.
- A command MUST declare an `a7ProductCustomerBindingMapReference`, an `a4ProductPolicyDecisionReference`, and an `a2AuthorizationContextReference`. The A7 product command service MUST re-validate the A7T04 product customer-binding map, the A4 product-policy decision, and the A2 authorization context before admitting the A7 product command; a missing, stale, denied, or unsupported reference MUST fail closed.
- A command MUST declare an `a6ExternalOperationId`, an `a6ExternalOperationReference`, an `a6ProviderIdempotencyScope`, and an `a6ProviderIdempotencyKey`. The A7 product command service MUST read the A6T05 external-operation record through the A6T05 `ExternalOperationService` consumer boundary and MUST verify that the supplied `a6ExternalOperationId`, `a6ExternalOperationReference`, `a6ProviderIdempotencyScope`, and `a6ProviderIdempotencyKey` match the A6T05 record. A mismatch MUST fail closed.
- A command MUST declare a non-empty `idempotencyKey` and a non-empty `requestHash`. The A7 product command service MUST validate the `idempotencyKey` against the A7 internal idempotency scope, MUST validate the `requestHash` against the canonical request hash derived from the command semantic material, and MUST NOT accept a caller-supplied `requestHash` as authoritative.
- A command MUST declare a valid `requestContext` (`requestId`, `correlationId`, `traceId`, `causationId`). The A7 product command service MUST preserve the `requestId`, `correlationId`, `traceId`, and `causationId` exactly as supplied.
- A command MUST declare a `contractName` of `A7-PRODUCT-COMMAND` and a `contractVersion` of `1`. A different `contractName` or `contractVersion` MUST fail closed.

## 4. A7 product operation record

### 4.1 Operation envelope

```text
A7ProductCommandOperationV1 {
  contractName: "A7-PRODUCT-COMMAND"
  contractVersion: 1
  productCommandId: UUID
  productCommandReference: string
  productOperationId: UUID
  productOperationReference: string
  productKey: A7ProductKey
  productVersion: A7ProductVersion
  capabilityKey: A7ProductCapabilityKey
  action: A7ProductAction
  productState: A7ProductState
  productOperationState: A7ProductCommandOperationState

  customerId: UUID
  customerWalletId: UUID
  bindingId: UUID
  bindingVersion: number
  walletAccountId: UUID
  ledgerAccountId: UUID
  currency: "NGN"
  accountingUnit: "CUSTOMER_FUNDS"
  amountMinor: string

  a7ProductCustomerBindingMapReference: string
  a4ProductPolicyDecisionReference: string
  a2AuthorizationContextReference: string
  a6ExternalOperationId: string
  a6ExternalOperationReference: string
  a6ProviderIdempotencyScope: string
  a6ProviderIdempotencyKey: string

  idempotencyScope: "A7-PRODUCT-IDEMPOTENCY.v1"
  idempotencyKey: string
  requestHash: string

  requestContext: RequestContext
  causationId: string | null
  replayed: boolean
  conflict: boolean
  conflictReason: string | null
  createdAt: string
  completedAt: string | null
  failedAt: string | null
  version: number
}
```

The A7 product operation record is the durable A7 product operation artifact. The record is produced by the A7 product command service from the A7 product command envelope, the A7T04 product customer-binding map, the A4 product-policy decision, the A2 authorization context, and the A6T05 external-operation record.

### 4.2 A7 product command operation state vocabulary

```text
A7ProductCommandOperationState:
  COMMAND_RESERVED       (A7 product command has been reserved against the A7 internal idempotency scope; no A7 product operation has been admitted)
  COMMAND_ADMITTED       (A7 product command has been admitted; the A7 product operation has been created and the A6T05 external-operation identity has been correlated)
  COMMAND_COMPLETED      (A7 product command has been completed; the A6T05 external-operation identity has been correlated and the A7 product operation is in a terminal state)
  COMMAND_FAILED         (A7 product command has been failed; the A6T05 external-operation identity has been correlated and the A7 product operation is in a terminal failure state)
  COMMAND_REPLAYED       (A7 product command has been replayed; the durable A7 product operation has been returned without a second uncontrolled provider or product effect)
  COMMAND_CONFLICTED     (A7 product command has been conflicted; the A7 internal idempotency scope/key has been used with a different request hash)
```

The A7 product command operation state vocabulary is a subset of the A7 product lifecycle vocabulary. The A7 product command service MUST NOT transition a `COMMAND_COMPLETED` or `COMMAND_FAILED` record back to `COMMAND_RESERVED` or `COMMAND_ADMITTED`. The A7 product command service MUST NOT transition a `COMMAND_REPLAYED` or `COMMAND_CONFLICTED` record to a non-terminal state. A7T07 owns the broader product lifecycle transitions.

## 5. Normalized product request hash

### 5.1 Hash material

The A7 product command service derives the canonical A7 product request hash from the semantic material of the command. The hash material includes:

```text
contractName
contractVersion
productKey
productVersion
capabilityKey
action
productState

customerId
customerWalletId
bindingId
bindingVersion

amountMinor
currency
accountingUnit

a7ProductCustomerBindingMapReference
a4ProductPolicyDecisionReference
a2AuthorizationContextReference
a6ExternalOperationId
a6ProviderIdempotencyScope
a6ProviderIdempotencyKey

correlationId
causationId
```

The hash material is serialized as canonical JSON (sorted object keys, declared array order) and hashed with `SHA-256`.

### 5.2 Hash exclusions

The A7 product command service MUST exclude the following values from the hash material because they identify transport, observation, or later-created identity rather than the requested A7 product effect:

```text
productCommandId
productCommandReference
productOperationId
productOperationReference

a6ExternalOperationReference   (replay-only transport; sourced from A6T05)

idempotencyKey
requestHash                    (caller-supplied; the A7 product command service derives its own canonical hash)
requestId
traceId
createdAt
completedAt
failedAt
version
replayed
conflict
conflictReason
```

### 5.3 Hash derivation

```text
A7ProductCommandRequestHash =
  SHA-256(lowercase hex of canonical UTF-8 JSON of A7ProductCommandRequestHashInputV1)
```

The A7 product command service MUST derive the canonical A7 product request hash from the A7 product command semantic material and MUST compare it to the caller-supplied `requestHash` exactly. A caller-supplied `requestHash` that does not match the canonical hash MUST fail closed.

## 6. Product/provider idempotency

### 6.1 A7 internal idempotency scope

```text
A7ProductInternalIdempotencyScope = "A7-PRODUCT-IDEMPOTENCY.v1"
A7ProductInternalIdempotencyKey   = a7 product command caller-supplied bounded key
A7ProductInternalIdempotencyHash  = A7 product request hash (A7T05-derived canonical hash)
```

The A7 product command service reserves the A7 internal idempotency scope/key/hash against the shared Operations `IdempotencyService` (the only internal idempotency authority). The A7 product command service MUST use a separate A7 internal idempotency scope from the A6T05 `external.partner.operation.v1` scope; the A7 internal idempotency scope and the A6T05 internal idempotency scope are distinct namespaces.

### 6.2 A7 provider idempotency scope (sourced from A6T05)

```text
A7ProductProviderIdempotencyScope = <A6T05 external.partner.operation.v1 provider scope>
A7ProductProviderIdempotencyKey   = <A6T05 externalOperationId-derived provider idempotency key>
```

The A7 product command service does NOT generate or maintain a separate A7 provider idempotency scope/key. The A7 product command service reads the A6T05 provider idempotency scope/key from the A6T05 `ExternalOperation` record (per ADR-0049) and references it inside the A7 product command operation envelope. The A7 product command service MUST NOT issue, refresh, or substitute the A6T05 provider idempotency scope/key.

### 6.3 Same-key/same-payload replay

For a same scope/key with a same request hash, the A7 product command service MUST return the durable original A7 product operation record with `replayed: true` and MUST NOT create a second A7 product operation record, a second A6T05 external-operation record, a second Ledger journal, or a second product financial effect.

### 6.4 Same-key/changed-payload conflict

For a same scope/key with a different request hash, the A7 product command service MUST return a deterministic conflict with `conflict: true`, `conflictReason: A7_PRODUCT_REQUEST_HASH_CONFLICT`, and MUST NOT create a second A7 product operation record, a second A6T05 external-operation record, a second Ledger journal, or a second product financial effect.

### 6.5 Different-key/same-internal-command-id duplicate

The A7 product command service MUST enforce a unique `(customerId, customerWalletId, bindingId, bindingVersion, a6ExternalOperationId)` constraint on the A7 product operation record. A second A7 product command with a different A7 internal idempotency key but a same `(customerId, customerWalletId, bindingId, bindingVersion, a6ExternalOperationId)` tuple MUST return the durable original A7 product operation record with `replayed: true`. A second A7 product command with a different `(customerId, customerWalletId, bindingId, bindingVersion)` tuple but a same A6T05 `externalOperationId` MUST fail closed with `A7_PRODUCT_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT`.

### 6.6 In-progress reservation

For a same scope/key with an in-progress reservation, the A7 product command service MUST return a deterministic conflict with `conflict: true`, `conflictReason: A7_PRODUCT_IDEMPOTENCY_IN_PROGRESS`, and MUST NOT create a second A7 product operation record.

## 7. Provider-reference uniqueness

The A7 product command service MUST verify that the A6T05 `externalOperationId` is unique across the A7 product operation record. The A6T05 `external_operations` table already enforces a unique `internalCommandId` constraint; the A7 product command service MUST treat the A6T05 `internalCommandId` as the durable internal command id and MUST NOT create a second A7 product operation record for the same A6T05 `internalCommandId`. The A6T05 `external_operation_references` table already enforces a unique `(partnerKey, referenceType, referenceValue)` constraint and a unique `(externalOperationId, referenceType, referenceValue)` constraint; the A7 product command service MUST treat those constraints as the authoritative provider-reference uniqueness boundary.

## 8. Operations audit, idempotency, outbox, metrics, diagnostics, and support-trace integration

The A7 product command service records the A7 product command/operation audit facts through the shared Operations `AuditService` (the only audit authority). The A7 product command service reserves the A7 internal idempotency scope/key through the shared Operations `IdempotencyService` (the only internal idempotency authority). The A7 product command service publishes the A7 product command/operation fact through the shared Operations `OutboxService` (the only outbox authority) as a non-financial, non-notification fact under the A7 product command operation classification. The A7 product command service records the A7 product command/operation metric through the shared Operations `MetricsService` (the only metrics authority). The A7 product command service records the A7 product command/operation diagnostic through the shared Operations `DiagnosticsService` (the only diagnostics authority). The A7 product command service produces the A7 product command/operation support-trace evidence using the canonical internal IDs, the A6T05 external-operation identity, the A4 product-policy decision reference, the A2 authorization context reference, and the A3 binding tuple. The A7 product command service does not introduce a module-local audit, idempotency, outbox, metrics, diagnostics, or support-trace authority.

## 9. Identity, replay, conflict, uniqueness, migration, and no-financial-side-effect tests

The A7 product command and idempotency contract is tested by:

- **Identity tests:** verify that `Customer.id`, the A3 binding tuple, the A4 product-policy decision reference, the A2 authorization context reference, the A6T05 external-operation identity, the A7 product command identity, the A7 product operation identity, the A7 internal idempotency scope/key, the A6T05 provider idempotency scope/key, the request/correlation/trace/causation identifiers, the journal id, the outbox id, and the audit id remain distinct.
- **Replay tests:** verify that a same scope/key with a same request hash returns the durable original A7 product operation record with `replayed: true` and does not create a second A7 product operation record, a second A6T05 external-operation record, a second Ledger journal, or a second product financial effect.
- **Conflict tests:** verify that a same scope/key with a changed request hash returns a deterministic conflict without creating a second A7 product operation record, a second A6T05 external-operation record, a second Ledger journal, or a second product financial effect.
- **Uniqueness tests:** verify that a different A7 internal idempotency key with a same `(customerId, customerWalletId, bindingId, bindingVersion, a6ExternalOperationId)` tuple returns the durable original A7 product operation record with `replayed: true`, and that a different `(customerId, customerWalletId, bindingId, bindingVersion)` tuple with a same A6T05 `externalOperationId` fails closed with `A7_PRODUCT_A6_EXTERNAL_OPERATION_MAPPING_CONFLICT`.
- **Migration tests:** verify that the A7 product command service does not introduce a new table, a new column, a new index, a new trigger, a new entity, or a new migration; the A7 product command service consumes the A6T05 `external_operations` and `external_operation_references` tables and the shared Operations `idempotency_records`, `outbox_events`, `audit_events`, and `operational_metrics` tables; the A7 product command service does not migrate or migrate-revert any source table.
- **No-financial-side-effect tests:** verify that the A7 product command service does not post a journal, mutate a balance, change an A3 binding, change an A4 policy/source record, change an A5 transfer/deposit/withdrawal record, change a `CustomerPreference` record, or dispatch a notification.
- **Audit tests:** verify that the A7 product command service records the A7 product command/operation audit fact through the shared Operations `AuditService` and that the audit fact carries the A7 product command reference, the A7 product operation reference, the A6T05 external-operation reference, the A4 product-policy decision reference, the A2 authorization context reference, the A3 binding tuple, the A7 internal idempotency scope/key, the A6T05 provider idempotency scope/key, and the request/correlation/trace/causation identifiers — and does NOT carry raw credentials, signatures, private keys, full risk/compliance content, or unrestricted customer data.
- **Outbox tests:** verify that the A7 product command service publishes the A7 product command/operation fact through the shared Operations `OutboxService` and that the outbox fact is non-financial, non-notification, and classified under the A7 product command operation classification.

## 10. A6 partner reference for a product flow

The A6 partner reference for a product flow is accepted only with the expected partner, capability, operation type, customer/account mapping, currency, amount, accounting unit, and product state context. The A7 product command service MUST verify the A6 partner reference context by reading the A6T05 `ExternalOperation` record and comparing the A6T05 `partnerKey`, `capabilityKey`, `operationType`, `customerId`, `walletAccountId`, `ledgerAccountId`, `currency`, `accountingUnit`, and `amountMinor` against the A7 product command envelope. A mismatch MUST fail closed with `A7_PRODUCT_A6_EXTERNAL_OPERATION_CONTEXT_MISMATCH`.

## 11. A7 product response or reference cannot by itself complete a Transfer, Deposit, Withdrawal, Ledger journal, or product financial effect

A product response, an A6 partner reference, an A6T05 external-operation record, an A7 product command record, an A7 product operation record, an A7 internal idempotency record, or an A7 product outbox fact cannot by itself complete a Transfer, Deposit, Withdrawal, Ledger journal, or product financial effect. The A7 product command service does not call a Transfer, Deposit, Withdrawal, or Ledger service; the A7 product command service does not post a Ledger journal; the A7 product command service does not mutate a balance; the A7 product command service does not dispatch a notification. A7T07 (product lifecycle), A7T08 (product financial effect), and A7T09 (product reconciliation) own the corresponding later boundaries.

## 12. Expired idempotency retention never reuses an old product operation, provider reference, journal, or financial identity

The A7 product command service consumes the shared Operations `IdempotencyService`. The shared Operations `IdempotencyService` already enforces the A7 internal idempotency scope/key retention interval (default 86,400 seconds = 24 hours). The A7 product command service MUST NOT retain an A7 internal idempotency record, an A6T05 provider idempotency record, an A7 product command record, an A7 product operation record, an A6T05 external-operation record, an A6T05 external-operation reference, a Ledger journal, a Ledger line, or a product financial effect beyond the approved retention interval. An expired A7 internal idempotency record MUST NOT be reused as a replay source; the A7 product command service MUST require a fresh A7 internal idempotency key and a fresh canonical request hash for every new A7 product command.

## 13. Prohibited edges

The A7 product command service MUST NOT:

- treat an A7 product command id, an A7 product operation id, an A6T05 external-operation id, an A6T05 external-operation reference, an A6T05 provider idempotency key, an A6 partner reference, a virtual-account identifier, a bank code, a bank account number, a payment reference, a funding-instrument identifier, a beneficiary identifier, a notification identifier, a preference value, or a customer reference as `Customer.id`, `CustomerWallet.id`, `WalletAccount.id`, or `LedgerAccount.id`;
- repair, reassign, activate, close, or suspend an A3 binding to make an A7 product command pass;
- deactivate, reassign, activate, or close an existing `VirtualAccount` row to make an A7 product command pass;
- issue, refresh, or substitute an A2 authorization context to make an A7 product command pass;
- evaluate, mutate, or refresh an A4 product-policy decision to make an A7 product command pass;
- issue, refresh, or substitute an A6T05 external-operation identity, an A6T05 external-operation reference, an A6T05 provider idempotency scope, or an A6T05 provider idempotency key to make an A7 product command pass;
- issue, refresh, or substitute an A7 product command id or an A7 product operation id to make an A7 product command pass;
- mutate the A6 partner boundary to make an A7 product command pass;
- mutate `CustomerPreference` to make an A7 product command pass;
- create a second customer-binding system, a second policy engine, a second authorization system, a second settlement authority, a second reconciliation engine, a second audit authority, a second idempotency authority, a second outbox authority, a second notification authority, or a second product command id;
- introduce a public, customer, partner, or support surface for the A7 product command;
- store raw credentials, raw callback signatures, full risk/compliance content, unrestricted customer data, or PAN/account secrets in the A7 product command/operation record or the audit metadata;
- treat a controlled denial, pending, or manual-review outcome as an A7 product success;
- retry an ambiguous A7 product outcome with a new A7 product command id, a new A7 product operation id, a new A6T05 external-operation id, a new A6T05 provider idempotency key, a new internal account, or a new financial effect;
- bypass the A2 authorization, the A4 product-policy, the A6 partner boundary, the A3 binding recheck, the A6T05 external-operation correlation, the A7T04 product customer-binding recheck, or the A7 product command reservation;
- post a journal, mutate a balance, repair a binding, change A4 policy/source records, or dispatch a notification;
- introduce a new module-local audit, idempotency, outbox, metrics, diagnostics, or support-trace authority.

## 14. Versioning rules

- The A7 product command and idempotency contract version `A7-PRODUCT-COMMAND` v1 defines this contract. A patch revision may clarify documentation; a minor revision may add optional fields, optional evidence sources, or a second frozen product command shape; a major revision is required for any change to required fields, identity semantics, request-hash semantics, idempotency semantics, A6T05 correlation semantics, or the first product's command envelope.
- Every A7 product command, A7 product operation, replay, conflict, and handoff identifies the contract version that produced it. Historical evidence remains interpretable under the version that produced it.
- A retired contract version MUST NOT be reactivated. A successor contract MUST be a new contract version with a new ADR.
- The A7 product command service does not introduce a parallel A3 binding, a parallel A4 product-policy, a parallel A2 authorization context, a parallel A6T05 external-operation identity, a parallel A6 partner boundary, a parallel A7 product catalog, a parallel A7T04 product customer-binding map, a parallel A5 transfer command, a parallel Wallet, a parallel Ledger, a parallel `CustomerPreference`, a parallel Operations audit, a parallel Operations idempotency, a parallel Operations outbox, a parallel Operations metrics, a parallel Operations diagnostics, or a parallel Reconciliation.

## 15. A7T05 verification record

- [x] A7 product command and idempotency contract defined as a read-write contract against the shared Operations `IdempotencyService`, `AuditService`, and `OutboxService`; the A6T05 external-operation identity and provider idempotency scope/key are reused (sourced from A6T05) rather than duplicated; the A2 authorization, A3 binding, A4 product-policy, A5 transfer command correlation, A6 partner boundary, A7 product catalog, and A7T04 product customer-binding map are consumed (not replaced) under the A7 product command envelope.
- [x] A3 binding recheck is the only source of `Customer.id` → `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`; the A7 product command service does not infer an internal account from a virtual-account identifier, a bank code, a bank account number, an A6 partner reference, a preference value, or product data.
- [x] A6T05 external-operation identity and provider idempotency scope/key are the only source of the A6 partner reference identity; the A7 product command service does not duplicate or substitute them.
- [x] A7 product command identity and A7 product operation identity are distinct from the A3 binding tuple, the A4 product-policy decision reference, the A2 authorization context reference, the A6T05 external-operation identity, the A6T05 provider idempotency scope/key, the A5 transfer/withdrawal/deposit command ids, the Ledger journal id, the Operations audit id, the Operations idempotency id, the Operations outbox id, and the Reconciliation discrepancy id.
- [x] A7 product request hash includes every field that changes the A7 product effect and excludes transport-only values, observation values, and secret material.
- [x] Same-key/same-payload replay returns the durable original A7 product operation record with `replayed: true` and does not create a second A7 product operation record, a second A6T05 external-operation record, a second Ledger journal, or a second product financial effect.
- [x] Same-key/changed-payload conflict returns a deterministic conflict without creating a second A7 product operation record, a second A6T05 external-operation record, a second Ledger journal, or a second product financial effect.
- [x] Provider reference is accepted only with the expected A6 partner, capability, operation type, customer/account mapping, currency, amount, accounting unit, and product state context; a mismatch fails closed.
- [x] Expired idempotency retention never reuses an old A7 product operation, an old A6T05 external-operation, an old A6T05 external-operation reference, an old Ledger journal, or an old product financial effect.
- [x] A7 product command service does not post a journal, mutate a balance, repair a binding, change A4 policy/source records, change A5 transfer/deposit/withdrawal records, change a `CustomerPreference` record, or dispatch a notification.
- [x] A2 authorization, A3 binding, A4 product-policy, A5 internal transfer, A6 partner, A6T05 external-operation identity, A7 product catalog, A7 product-policy profile, A7 product customer-binding, Wallet, Ledger, Operations, and Reconciliation authorities remain separate.
- [x] No A7 runtime product command service, entity, migration, repository, controller, API, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, or A8 work is introduced by A7T05.
- [x] The contract does not post a journal, mutate a balance, repair a binding, change A4 policy/source records, or dispatch a notification.

## 16. A7T05 handoff to later A7 tasks

This contract is consumed later as follows:

- **A7T06:** does not consume the A7 product command envelope; A7T06 reads `CustomerPreference.notifications` only.
- **A7T07:** consumes the A7 product command envelope to evaluate the A7 product lifecycle transitions and to trigger A4 re-evaluation when the A6T05 external-operation identity, the A6 partner reference, the A4 product-policy decision, the A2 authorization context, the A3 binding, or the A7T04 product customer-binding map changes.
- **A7T08:** consumes the A7 product command envelope to post the verified A7 product financial effect through the A6T08 settlement, suspense, and compensating-entry contracts; the A7T08 product financial effect is correlated to the A6T05 external-operation identity, the A7 product operation reference, and the A7 product customer-binding map reference.
- **A7T09:** consumes the A7 product command envelope to reconcile the A7 product operation, the A6T05 external-operation identity, the A6 partner reference, the A4 product-policy decision reference, the A2 authorization context reference, the A3 binding tuple, and the A7T04 product customer-binding map reference.
- **A7T10:** consumes the A7 product command envelope fields for the A6T10 / A7T10 data-classification matrix.
- **A7T11:** records the A7 product command and idempotency evidence in the A7 release-gate package.

No later task may weaken the A3 binding recheck, the A4 product-policy, the A2 authorization context, the A6 partner boundary, the A6T05 external-operation identity, the A7 product catalog, the A7T04 product customer-binding map, the A7 product command identity, the A7 product operation identity, the A7 internal idempotency scope/key, the A6T05 provider idempotency scope/key, the canonical A7 product request hash, the A7 product command operation state vocabulary, or the handoff.

## 17. Authoring note

The A7 plan reserves the proposed A7 ADR range `ADR-0054` through `ADR-0060`. ADR-0054 records the A7T02 product-catalog freeze. A7T03 introduced the A7 product-policy profile. A7T04 introduced the A7 product customer-binding. A7T05 introduces the A7 product command and idempotency contract; A7T05 records the A7 product command identity, the A7 product operation identity, the A7 product internal idempotency scope/key, the A6T05-sourced A7 product provider idempotency scope/key, the canonical A7 product request hash, the A7 product command operation state vocabulary, the same-key/same-payload replay and same-key/changed-payload conflict behavior, the provider-reference uniqueness boundary, the A6 partner reference context, the expired-idempotency retention rule, and the prohibited edges. A7T05 is a documentation and consumer-boundary artifact; A7T05 does not introduce a new runtime code, entity, migration, repository, service, controller, API, route, scheduler, notification dispatcher, public surface, fee, commission, settlement, reconciliation, or A8 work. A7T11 will record the A7T05 ADR-0055-or-later authoring evidence as part of the A7 release-gate package.
