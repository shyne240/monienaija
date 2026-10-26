# A5T02 — Customer-Aware Internal Transfer Command Contract

- **Phase:** A5 — Internal Financial Pilot
- **Task:** A5T02 — Customer-Aware Transfer Command and Correlation Contract
- **Status:** Documentation and contract design prepared for review; not a runtime implementation
- **Contract:** `InternalTransferCommandV1` / `InternalTransferResultV1`
- **Capability:** `wallet.transfer`
- **Action:** `create`
- **Scope:** `INTERNAL_CUSTOMER_TO_CUSTOMER`
- **Application, database, API, migration, controller, route, scheduler, and financial-runtime changes:** None

This document defines the stable command and correlation contract for the bounded A5 internal transfer pilot. It does not authorize a transfer, expose a route, create a transfer record, select an account, post a Ledger journal, or change any source of truth.

## 1. Contract boundary

The command is one protected request to move an explicitly declared positive amount from one internal customer-funds account to another. It is not a generic payment envelope and it is not an external-rail contract.

The version-one boundary is:

```text
wallet.transfer/create
  internal customer-to-customer
  same currency
  Customer.id source subject
  Customer.id destination counterparty
  explicit A3 bindings
  explicit WalletAccount and LedgerAccount assertions
  Ledger-owned financial effect when a later task implements execution
```

The contract deliberately carries identity assertions that a later command gate must verify. Carrying an ID is not proof that the referenced source is current, active, authorized, policy-eligible, owned by the declared customer, or safe to use.

The following terms are normative in this document:

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state or interpretation.
- **MAY** means an optional field or later implementation choice that cannot weaken an invariant.
- **Later command gate** means work assigned to A5T03 or a later task; it is not implemented here.

## 2. Command envelope

The logical normalized envelope is equivalent to the following. It is a contract example, not a TypeScript class or an API DTO:

```text
InternalTransferCommandV1 {
  contractVersion: 1
  commandType: "INTERNAL_TRANSFER"
  commandId: UUID

  capability: "wallet.transfer"
  action: "create"
  scope: "INTERNAL_CUSTOMER_TO_CUSTOMER"

  sourceCustomerId: UUID
  destinationCustomerId: UUID

  sourceCustomerWalletId: UUID
  destinationCustomerWalletId: UUID
  sourceBindingId: UUID
  destinationBindingId: UUID
  sourceWalletAccountId: UUID
  destinationWalletAccountId: UUID
  sourceLedgerAccountId: UUID
  destinationLedgerAccountId: UUID
  sourceBindingVersion: positive integer
  destinationBindingVersion: positive integer

  amountMinor: canonical decimal digit string
  currency: uppercase three-letter currency code
  accountingUnit: "CUSTOMER_FUNDS"
  reference: string | null
  narration: string | null

  authorizationContextReference: safe A2 reference
  policy: {
    contractVersion: positive integer
    capability: "wallet.transfer"
    action: "create"
    decision: A4 decision vocabulary
    decisionReference: safe A4 reference
    policyVersion: safe immutable version
    profileReference: safe profile reference
    profileVersion: safe profile version
    evidenceSnapshotReference: safe snapshot reference
    normalizedInputHash: SHA-256 hex
  }

  requestContext: {
    requestId: bounded request-attempt identifier
    correlationId: bounded workflow identifier
    traceId: bounded observability identifier | null
    causationId: bounded parent command/event identifier | null
    requestedAt: RFC 3339 UTC timestamp
  }

  idempotency: {
    scope: "wallet.transfer.create.v1"
    key: opaque bounded caller key
    requestHash: lowercase SHA-256 hex
  }
}
```

`commandId` and `requestHash` are command-boundary values. A caller may supply an opaque idempotency key, but the command owner derives the normalized request hash and must not trust a caller-controlled hash without recomputing it. The command owner resolves the durable command identity from the idempotency reservation when retries race.

The wire/API representation, authentication mechanism, route, HTTP status mapping, and persistence fields are intentionally not defined by this task.

## 3. Canonical identity contract

### 3.1 Customer identities

| Contract field          | Canonical source                  | Meaning                         | Required rule                                                         |
| ----------------------- | --------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `sourceCustomerId`      | `Customer.id` owned by `customer` | Sender and command subject      | MUST be a canonical Customer UUID; it is the A2/A4 subject projection |
| `destinationCustomerId` | `Customer.id` owned by `customer` | Receiving customer/counterparty | MUST be a canonical Customer UUID explicitly asserted by the command  |

The command has exactly two customer roles for this scope: source and destination. `sourceCustomerId` and `destinationCustomerId` MUST be different. There is no third customer identity hidden in a reference, alias, payment reference, account code, request ID, or policy result.

For A4 handoff, the policy subject is:

```text
subject.type = CUSTOMER
subject.customerId = sourceCustomerId
capability = wallet.transfer
action = create
```

The destination customer is an explicit transfer counterparty. A policy decision for the source subject does not authorize the destination, prove destination ownership, or choose the destination account. A later consumer may require additional approved evidence, but A5T02 does not invent a second policy authority.

`Customer.reference` is a separate customer-owned lookup/display value. It MUST NOT be accepted as `sourceCustomerId` or `destinationCustomerId`, and a UUID-shaped reference MUST NOT be treated as a Customer UUID without an explicit canonical lookup owned by `customer`.

### 3.2 CustomerWallet metadata identities

| Contract field                | Canonical source                               | Meaning                                                                   | A5 boundary                                                         |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `sourceCustomerWalletId`      | `CustomerWallet.id` owned by `customer-wallet` | Source provisioning/ownership metadata record used by the A3 binding      | Read/assert through A3; not a balance or financial-account identity |
| `destinationCustomerWalletId` | `CustomerWallet.id` owned by `customer-wallet` | Destination provisioning/ownership metadata record used by the A3 binding | Read/assert through A3; not a balance or financial-account identity |

The command MUST NOT use `CustomerWallet.type`, alias, currency, status, or opaque compatibility values to select a different account. CustomerWallet lifecycle and metadata remain owned by `customer-wallet`; A3 owns the explicit association used by this command.

### 3.3 A3 binding identities

| Contract field              | Canonical source                                             | Meaning                                                        | A5 boundary                                              |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------- |
| `sourceBindingId`           | `CustomerFinancialAccountBinding.id` owned by A3 in `wallet` | Explicit source customer-to-financial-account association      | Must be read and rechecked by the later A3 consumer gate |
| `destinationBindingId`      | `CustomerFinancialAccountBinding.id` owned by A3 in `wallet` | Explicit destination customer-to-financial-account association | Must be read and rechecked by the later A3 consumer gate |
| `sourceBindingVersion`      | A3 binding version                                           | Version assertion for the source association                   | A stale/missing version cannot be treated as current     |
| `destinationBindingVersion` | A3 binding version                                           | Version assertion for the destination association              | A stale/missing version cannot be treated as current     |

The binding tuple MUST prove the following for each side:

```text
binding.customerId       = side customer ID
binding.customerWalletId = side CustomerWallet ID
binding.walletAccountId  = side WalletAccount ID
binding.ledgerAccountId  = side LedgerAccount ID
```

An A3 binding is an association and control state. It is not an authorization decision, a policy decision, a mutable balance, or a journal.

### 3.4 Wallet identities

| Contract field               | Canonical source                     | Meaning                                      | A5 boundary                                                                  |
| ---------------------------- | ------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `sourceWalletAccountId`      | `WalletAccount.id` owned by `wallet` | Explicit source financial-wallet facade      | MUST be supplied/asserted; MUST NOT be selected by customer or currency scan |
| `destinationWalletAccountId` | `WalletAccount.id` owned by `wallet` | Explicit destination financial-wallet facade | MUST be supplied/asserted; MUST NOT be selected by customer or currency scan |

For compatibility with the existing transfer module, the current `sourceWalletId` and `destinationWalletId` values map only to these WalletAccount IDs. That compatibility mapping does not establish the A5 customer-aware command by itself.

A WalletAccount's `customerId` column is an opaque compatibility value under the existing model. It is not a substitute for `sourceCustomerId`, `destinationCustomerId`, or the A3 binding, and A5T02 does not normalize or rewrite it.

### 3.5 Financial-account and Ledger identities

| Contract field               | Canonical source                     | Meaning                                                      | A5 boundary                                                                           |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `sourceLedgerAccountId`      | `LedgerAccount.id` owned by `ledger` | Source financial account whose posted value is debited       | MUST equal the LedgerAccount reached through the source WalletAccount/A3 binding      |
| `destinationLedgerAccountId` | `LedgerAccount.id` owned by `ledger` | Destination financial account whose posted value is credited | MUST equal the LedgerAccount reached through the destination WalletAccount/A3 binding |

In this contract, **financial account identity means LedgerAccount identity** because Ledger owns financial accounts, journals, lines, balances, and posted value. The WalletAccount remains the financial wallet facade. There is no separate A5 financial-account identity.

If a later consumer uses `sourceFinancialAccountId` or `destinationFinancialAccountId` as a transport name, it MUST be an explicit alias of `sourceLedgerAccountId` or `destinationLedgerAccountId` and MUST resolve to the same UUID. Both names MUST NOT be stored as independent values. A5 MUST NOT create a new financial-account table, account code namespace, balance snapshot, or ownership authority.

### 3.6 Identity chain

The complete source and destination chains are independently explicit:

```text
sourceCustomerId
  -> sourceCustomerWalletId
  -> sourceBindingId
  -> sourceWalletAccountId
  -> sourceLedgerAccountId

destinationCustomerId
  -> destinationCustomerWalletId
  -> destinationBindingId
  -> destinationWalletAccountId
  -> destinationLedgerAccountId
```

A command is not identity-complete when any link is absent, mismatched, inferred, duplicated, or supplied only as a display/reference value.

## 4. Amount, currency, reference, and narration

### 4.1 Amount and currency

| Field            | Normal form                                      | Rule                                                                                                                                            |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `amountMinor`    | Base-10 digit string, no leading zero except `0` | MUST be greater than zero; zero, negative, fractional, exponent, signed, floating-point, and non-digit forms are invalid                        |
| `currency`       | Trimmed uppercase three-letter code              | MUST be explicit and equal across command, source WalletAccount, destination WalletAccount, both LedgerAccounts, and both A3 binding dimensions |
| `accountingUnit` | `CUSTOMER_FUNDS`                                 | MUST be explicit for this contract; Ledger remains the stored-dimension authority                                                               |

The command boundary serializes minor units as a string so a JSON number cannot lose integer precision. Internal implementations may use a safe integer/decimal representation, but binary floating-point arithmetic is prohibited. The exact maximum amount belongs to the later A4 limit and A5 pilot-control contracts; an amount that passes syntax is not automatically within the pilot envelope.

The A5T01 plan records NGN as the initial planning boundary. This contract requires one same-currency command but does not independently approve a currency rollout, FX, rate lookup, rounding, or cross-currency movement.

### 4.2 Business reference

`reference` is an optional caller/business-domain reference. It is trimmed, bounded according to the approved command boundary, and serialized as `null` when absent. It:

- is not a Customer UUID, WalletAccount ID, LedgerAccount ID, command ID, idempotency key, payment reference, or journal ID;
- is not a uniqueness or replay key unless a separate approved domain contract says so;
- cannot select or prove ownership of either account; and
- must not contain credentials, access tokens, raw risk/compliance notes, or unnecessary personal data.

A generated `paymentReference` is a separate internal financial-domain value returned only when a later transfer lifecycle creates it. It must never be used to replace the explicit identity tuple.

### 4.3 Narration

`narration` is an optional bounded human-readable description. It is trimmed and normalized for deterministic hashing, with absent and explicit `null` treated identically. It does not affect account selection, authorization, policy ownership, or Ledger authority. It must be minimized and must not carry secrets or unrestricted sensitive evidence.

A Ledger `journal.reference` or `journal.description` is a separate Ledger-owned value. A narration is not proof that a journal exists.

## 5. Authorization, policy, and binding references

### 5.1 A2 authorization context

`authorizationContextReference` points to the A2 context used for the protected command. The command contract carries a safe reference, not passwords, session tokens, refresh tokens, MFA proofs, recovery codes, or raw device/security material.

The reference does not authorize anything by itself. A later A5 consumer must obtain/recheck A2 authorization for:

```text
principal/service
source customer scope
capability/action
explicit source/destination account assertions where required
route/service audience
assurance and privileged approval requirements
current request context
```

A route's existence and a caller-supplied customer/account value are not A2 authorization.

### 5.2 A4 policy handoff

The `policy` object carries the safe, versioned references required to bind the command to the A4 `wallet.transfer/create` result:

- canonical subject: `sourceCustomerId`;
- capability: `wallet.transfer`;
- action: `create`;
- decision and decision reference;
- policy contract, policy, and profile versions;
- profile reference and definition/evidence hashes where approved;
- immutable evidence snapshot reference and normalized input hash; and
- expiry/review/currentness metadata where the A4 contract supplies it.

A5T02 does not select policy precedence or evaluate the result. `ALLOW` and `ALLOW_WITH_LIMITS` are not sufficient to execute. `PENDING_REVIEW`, `DENY`, `SUSPEND`, expired, superseded, stale, integrity-mismatched, conflicting, unavailable, or unknown policy evidence remains non-executable until a later approved result satisfies the consumer contract.

The command does not copy raw eligibility, risk, compliance, KYC, credential, or investigative payloads. A4 and its source domains remain the owners of those records.

### 5.3 A3 binding handoff

The source and destination binding objects are explicit assertions, not account selectors. A later consumer must check the current A3 binding/read/control result, including:

- canonical customer and CustomerWallet equality;
- WalletAccount and LedgerAccount relationship;
- currency and `CUSTOMER_FUNDS` accounting unit;
- source versions and currentness;
- active/non-closed/non-suspended state;
- uniqueness and ownership controls; and
- unresolved reconciliation or repair-required evidence.

A5T02 does not create, repair, reassign, suspend, close, or activate either binding.

## 6. Normalization and request-hash contract

### 6.1 Normalization rules

Before a request hash is computed, the command owner normalizes without changing the intended business value:

1. UUID identity fields are trimmed and serialized in lowercase canonical UUID form. Invalid UUIDs are rejected.
2. `capability` and `action` are lowercase registered policy keys. This command accepts only `wallet.transfer` and `create`.
3. `scope` and `accountingUnit` use their registered uppercase/lowercase contract forms.
4. `currency` is trimmed and uppercased.
5. `amountMinor` is parsed as a positive integer and reserialized as the canonical base-10 digit string.
6. Optional `reference` and `narration` values are trimmed; an absent or empty optional value becomes `null`; bounded text and safe-content rules apply.
7. `requestedAt` is serialized as an RFC 3339 UTC timestamp with a single normalized representation.
8. Safe policy and binding references are serialized exactly according to their versioned source contracts; raw source payloads are not hash material.
9. Object keys are sorted recursively for hashing. Arrays, if later introduced by an approved extension, retain their declared order.
10. Unknown fields, duplicate alternate identity fields, invalid nullability, and ambiguous representations are rejected rather than ignored.

### 6.2 Hash material

The request hash is:

```text
SHA-256(lowercase hex of canonical UTF-8 JSON)
```

The canonical semantic material includes:

```text
contractVersion
commandType
capability
action
scope
sourceCustomerId + sourceCustomerWalletId + sourceBindingId
  + sourceWalletAccountId + sourceLedgerAccountId + sourceBindingVersion
destinationCustomerId + destinationCustomerWalletId + destinationBindingId
  + destinationWalletAccountId + destinationLedgerAccountId + destinationBindingVersion
amountMinor
currency
accountingUnit
reference
narration
requestedAt
A4 capability/action, decision reference, policy version, profile reference,
  evidence snapshot reference, and normalized input hash
```

The exact serialization names and null handling above are part of the contract. Every field that changes the requested financial effect or the immutable execution assertion is included. The hash is not a substitute for checking current A2, A3, A4, Wallet, or Ledger state.

### 6.3 Excluded values

The following are excluded because they identify transport, observation, reservation, or later-created records rather than the requested effect:

```text
commandId
idempotency.scope and idempotency.key
requestId
traceId
correlationId
causationId
HTTP method/path/header formatting
actor display/presentation fields
authorization tokens and raw security material
paymentReference
transferId
journalId and journal reference
Ledger child idempotency key
AuditEvent.id
OutboxEvent.id
Reconciliation/discrepancy IDs
```

Excluding transport IDs does not make them untraceable. They remain in the correlation and operational records. Excluding `authorizationContextReference` from the business effect hash does not weaken A2; A2 must be rechecked for every attempt. Policy and explicit account assertions are included so the same idempotency key cannot silently change the declared policy/account execution context.

### 6.4 Replay and conflict rules

The proposed Operations idempotency scope is:

```text
wallet.transfer.create.v1
```

The later command implementation must use the Operations `IdempotencyService` or an approved contract-compatible boundary:

| Request condition                                          | Required logical result                                               | Financial mutation                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Same scope/key and same request hash with a durable result | Replay the original result, marked `replayed`                         | None; never a second journal                            |
| Same scope/key and different request hash                  | Idempotency conflict                                                  | None                                                    |
| Same scope/key while original is in progress               | Controlled in-progress conflict or durable pending lookup             | No concurrent second execution                          |
| Expired reservation                                        | New reservation only under approved Operations retention rules        | Does not erase or reuse prior transfer/journal identity |
| Different key but same command intent                      | A new command identity must still pass duplicate/financial safeguards | Must not create a duplicate effect                      |
| Unknown outcome after a client timeout                     | Return/retain `UNKNOWN` or approved `PENDING` evidence                | Never blindly retry or report optimistic success        |

`commandId` and `correlationId` for a replay refer to the original durable command chain where available. A new HTTP attempt receives a new `requestId` and may have a new `traceId`, but those values do not create a second financial command.

## 7. Correlation and traceability contract

### 7.1 Correlation chain

```text
A2-protected ingress
  requestId + traceId + correlationId
        |
        v
InternalTransferCommandV1
  commandId + source/destination identity tuples
  idempotency scope/key/hash + causationId
        |
        v
A4 decision and A3 binding assertions
  policy decision/version/evidence refs
  binding IDs/versions + WalletAccount/LedgerAccount IDs
        |
        v
Later transfer lifecycle and Ledger transaction
  transferId + journalId + journal/line account IDs
        |
        v
Operations and controls
  auditEventId + outboxEventId + aggregateId
  independent reconciliation/discrepancy evidence
```

Every link is owned by its source boundary and must be queryable through an approved read/support contract. A correlation search is observational; it cannot repair a command, binding, WalletAccount, LedgerAccount, journal, line, audit event, outbox fact, or policy decision.

### 7.2 Identifier ownership map

| Identifier                                              | Owner                            | Stable meaning                            | Must not be used as                                    |
| ------------------------------------------------------- | -------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `sourceCustomerId`, `destinationCustomerId`             | `customer`                       | Canonical customer UUIDs                  | Wallet, Ledger, policy, or authorization substitute    |
| `sourceCustomerWalletId`, `destinationCustomerWalletId` | `customer-wallet`                | Provisioning/ownership metadata UUIDs     | Financial account or balance identity                  |
| `sourceBindingId`, `destinationBindingId`               | A3 `wallet` capability           | Explicit association UUIDs                | A2 authorization or account-selection query key        |
| `sourceWalletAccountId`, `destinationWalletAccountId`   | `wallet`                         | Financial wallet-facade UUIDs             | Customer identity or Ledger value authority            |
| `sourceLedgerAccountId`, `destinationLedgerAccountId`   | `ledger`                         | Financial-account UUIDs                   | Wallet metadata, command identity, or balance snapshot |
| `commandId`                                             | A5 command boundary              | One logical requested command             | Idempotency key, payment reference, or journal ID      |
| `idempotency.scope` + `idempotency.key`                 | Operations with A5 command scope | Duplicate-request collision domain        | Customer/account identity or financial truth           |
| `requestHash`                                           | A5 command boundary/Operations   | Hash of normalized semantic request       | Authorization, policy decision, or account proof       |
| `requestId`                                             | Production/ingress               | One request attempt                       | Command identity or retry identity                     |
| `traceId`                                               | Observability                    | One telemetry trace                       | Financial uniqueness or authorization                  |
| `correlationId`                                         | Request/workflow context         | One evidence chain                        | Customer identity or Ledger truth                      |
| `causationId`                                           | Parent command/event producer    | Immediate parent fact                     | Correlation or command identity                        |
| `policyDecisionReference` / `policyVersion`             | A4                               | Versioned policy result identity          | A2 authorization or financial approval                 |
| `authorizationContextReference`                         | A2                               | Separate access-context reference         | A4 policy or customer identity                         |
| `transferId`                                            | Later A5 transfer lifecycle      | Durable internal transfer record          | Command reservation or journal truth                   |
| `paymentReference`                                      | Financial/payment domain         | Human/support lookup reference            | Account/customer identity or journal proof             |
| `journalId`                                             | Ledger                           | Durable posted journal identity           | Transfer request or outbox truth                       |
| `auditEventId`                                          | Operations                       | Append-only operational evidence identity | Financial posting or command outcome                   |
| `outboxEventId`                                         | Operations                       | Durable internal fact identity            | Transfer/Ledger truth or delivery guarantee            |
| reconciliation/discrepancy ID                           | Reconciliation/Finance           | Independent control evidence              | Repair instruction or source mutation authority        |

A Ledger journal idempotency key, if used by a later implementation, is Ledger-owned and must remain distinct from `wallet.transfer.create.v1` and its caller key. Its exact derivation and transaction mapping belong to A5T05/A5T06.

## 8. Request contract and result contract

### 8.1 Request

A valid request supplies all fields required to construct the normalized envelope:

```text
InternalTransferRequestV1 {
  sourceCustomerId
  destinationCustomerId
  sourceCustomerWalletId
  destinationCustomerWalletId
  sourceBindingId
  destinationBindingId
  sourceWalletAccountId
  destinationWalletAccountId
  sourceLedgerAccountId
  destinationLedgerAccountId
  sourceBindingVersion
  destinationBindingVersion
  amountMinor
  currency
  accountingUnit
  reference?
  narration?
  idempotencyKey
  authorizationContextReference
  policy handoff references
  requestId
  correlationId
  traceId?
  causationId?
  requestedAt
}
```

`commandId` and `requestHash` are produced/confirmed by the command boundary and returned in the normalized command/result context. A public transport is not implied by this shape.

### 8.2 Result

The logical result is:

```text
InternalTransferResultV1 {
  resultVersion: 1
  commandId
  outcome: COMPLETED | FAILED | PENDING | UNKNOWN
  replayed: boolean

  transferId: UUID | null
  sourceCustomerId
  destinationCustomerId
  sourceWalletAccountId
  destinationWalletAccountId
  sourceLedgerAccountId
  destinationLedgerAccountId
  amountMinor
  currency

  paymentReference: string | null
  journalId: UUID | null
  journalReference: string | null

  idempotency: {
    scope
    key
    requestHash
  }
  requestContext: {
    requestId
    correlationId
    traceId | null
    causationId | null
  }
  policyDecisionReference: safe reference | null
  auditEventId: UUID | null
  outboxEventId: UUID | null
  recoveryReference: safe reference | null
  failure: {
    code
    safeMessage
  } | null
  occurredAt
}
```

The result carries safe identity and correlation references only. It does not copy raw A2 security context, raw A4 evidence, unrestricted risk/compliance content, credentials, full journal lines, or a mutable balance snapshot.

Result invariants:

- `COMPLETED` MUST contain a durable `transferId`, one valid `journalId`, the explicit source/destination account IDs, and exact amount/currency. It is not valid merely because an idempotency record exists.
- `FAILED` means the failure has a verified non-financial effect for the command boundary. A possible committed journal is not represented as `FAILED`.
- `PENDING` means approved recovery/verification is outstanding and must include a durable transfer or recovery reference when one exists.
- `UNKNOWN` means the system cannot yet establish whether the financial effect committed. It must preserve the original command/correlation chain and must not claim that no journal exists.
- `replayed = true` is metadata on the original outcome and does not create a new transfer, payment reference, journal, audit event, or outbox fact.
- A command rejected before a durable transfer result may return a `CommandErrorV1` instead of this result shape. The error must still carry the request/correlation/idempotency context needed for safe support.

A5T02 defines the shape and truth requirements. A5T04 decides which lifecycle records are durable; A5T05 decides the Ledger mapping; A5T06 decides recovery and retry execution; A5T07 decides the approved outbox event fact.

## 9. Command error and pending/unknown vocabulary

The following is the reserved logical vocabulary for later consumer contracts. It is not an HTTP status map and does not implement any gate.

| Code                              | Category           | Meaning                                                                                                   | Required financial posture                               |
| --------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `COMMAND_INVALID`                 | Validation         | Envelope/version/unknown-field/format failure                                                             | No financial mutation                                    |
| `CAPABILITY_ACTION_UNSUPPORTED`   | Scope              | Capability, action, or internal scope is not the approved command                                         | No financial mutation                                    |
| `IDENTITY_INVALID`                | Identity           | A canonical UUID or required identity is absent/invalid                                                   | No financial mutation                                    |
| `IDENTITY_MISMATCH`               | Identity           | Source/destination customer, CustomerWallet, binding, wallet, or Ledger relationship disagrees            | No account selection or mutation                         |
| `SELF_TRANSFER`                   | Invariant          | Source and destination customer or account is the same for this scope                                     | No financial mutation                                    |
| `ACCOUNT_ASSERTION_MISMATCH`      | Identity           | Supplied account ID does not equal the explicit A3/Wallet/Ledger relationship                             | No account substitution                                  |
| `AMOUNT_INVALID`                  | Money              | Amount is not a positive canonical minor-unit integer                                                     | No financial mutation                                    |
| `CURRENCY_INVALID`                | Money              | Currency is absent, malformed, or not normalized                                                          | No financial mutation                                    |
| `CURRENCY_MISMATCH`               | Money              | Command, binding, wallet, or Ledger currency differs                                                      | No conversion or posting                                 |
| `ACCOUNTING_UNIT_MISMATCH`        | Money              | Dimension is not `CUSTOMER_FUNDS` or differs across records                                               | No posting                                               |
| `REFERENCE_INVALID`               | Input              | Reference violates bounded/safe-content rules                                                             | No financial mutation                                    |
| `NARRATION_INVALID`               | Input              | Narration violates bounded/safe-content rules                                                             | No financial mutation                                    |
| `AUTHORIZATION_REQUIRED`          | A2 gate            | A2 authorization/context is absent, denied, stale, or mis-scoped                                          | No financial mutation                                    |
| `POLICY_NOT_EXECUTABLE`           | A4 gate            | Policy is missing, non-allow, expired, superseded, stale, conflicting, or unavailable                     | No financial mutation                                    |
| `BINDING_NOT_ACTIVE`              | A3 gate            | Required source/destination binding is missing, stale, suspended, closed, repair-required, or unavailable | No account selection or posting                          |
| `ACCOUNT_NOT_ACTIVE`              | Wallet/Ledger gate | WalletAccount or LedgerAccount is not active/compatible                                                   | No posting                                               |
| `LIMIT_EXCEEDED`                  | Policy/control     | A later authoritative limit or pilot envelope is exceeded                                                 | No posting                                               |
| `COMMAND_DISABLED`                | Pilot control      | Later approved command/cohort control has disabled new commands                                           | No new financial effect                                  |
| `IDEMPOTENCY_KEY_CONFLICT`        | Operations         | Same scope/key is paired with a different request hash                                                    | No financial mutation                                    |
| `IDEMPOTENCY_IN_PROGRESS`         | Operations         | Same logical request is already executing or awaiting durable outcome                                     | No concurrent second effect                              |
| `COMMAND_DUPLICATE_CONFLICT`      | Command            | A different command identity would duplicate an existing financial intent/effect                          | No second effect                                         |
| `INSUFFICIENT_FUNDS`              | Ledger             | Ledger rejects the source debit under its balance rules                                                   | No successful journal                                    |
| `LEDGER_REJECTED`                 | Ledger             | Ledger rejects account, line, balance, or journal invariants                                              | No successful journal                                    |
| `LEDGER_UNAVAILABLE`              | Ledger             | Required Ledger read/post evidence is unavailable                                                         | Fail closed or controlled pending; no optimistic success |
| `OPERATIONS_EVIDENCE_UNAVAILABLE` | Operations         | Required audit/idempotency/outbox/request evidence cannot be safely committed                             | No untraceable execution                                 |
| `PENDING_RECOVERY`                | Recovery           | Durable command/transfer exists but approved verification or recovery remains                             | Do not report completed or retry blindly                 |
| `UNKNOWN_OUTCOME`                 | Recovery           | Commit/effect cannot be established from durable evidence                                                 | Preserve ambiguity; no optimistic success or blind retry |

A5T03 may refine the gate-specific mapping, and A5T04/A5T06 may refine lifecycle/recovery names, but they must preserve the distinctions between rejected, failed-with-no-effect, pending, and unknown. They must not turn a missing reference or ambiguous outcome into `COMPLETED`.

## 10. Command invariants

The following invariants define a valid future command before financial execution:

### Identity and scope

1. `sourceCustomerId` and `destinationCustomerId` are canonical Customer UUIDs and are not equal.
2. Every source and destination identity in the explicit tuple is present and syntactically valid.
3. Each A3 binding identifies the declared customer, CustomerWallet, WalletAccount, and LedgerAccount.
4. Each WalletAccount points to the declared LedgerAccount; a LedgerAccount ID cannot be supplied independently as a target selector.
5. The command is exactly `wallet.transfer/create` within `INTERNAL_CUSTOMER_TO_CUSTOMER`.
6. All financial targets are internal; provider, bank, NIBSS, settlement, callback, and external account identifiers are absent.

### Financial dimensions

7. `amountMinor` is a positive integer minor-unit value.
8. `currency` is explicit and identical across command, both customer-funds bindings, both WalletAccounts, and both LedgerAccounts.
9. `accountingUnit` is `CUSTOMER_FUNDS`.
10. No FX, conversion, rounding, fee, commission, tax, or hidden second journal is represented by the command.

### Authority and evidence

11. A2 authorization context, A4 policy references, and both A3 binding assertions are carried separately.
12. No A4 decision is interpreted as A2 authorization, account ownership, limit usage, or financial execution approval.
13. No command normalizer writes Customer, CustomerWallet, eligibility, restriction, limit, enrollment, permission, risk, compliance, binding, WalletAccount, LedgerAccount, policy, or reconciliation state to satisfy an invariant.
14. Ledger remains the only authority for posted financial accounts, journals, lines, balances, and value.

### Idempotency and correlation

15. The scope/key/hash contract distinguishes an identical replay from a changed-payload conflict.
16. Command, request, trace, correlation, causation, payment, journal, audit, outbox, and reconciliation identifiers remain distinct.
17. A timeout or unknown result retains the original command identity and correlation chain; it does not create a new target or a blind retry.
18. A result cannot claim a second journal merely because a caller used a second idempotency key.

### Result truth

19. `COMPLETED` requires a valid durable transfer-to-journal correlation.
20. `FAILED` cannot coexist with evidence that a financial journal may have committed.
21. `PENDING` and `UNKNOWN` are explicit non-success outcomes until later durable verification.
22. A payment reference, outbox event, audit event, correlation ID, or idempotency record cannot substitute for a Ledger journal.

## 11. Prohibited states and interpretations

A future A5 implementation MUST reject, hold, or route for controlled recovery rather than normalize any of these states:

- source or destination customer is missing, non-canonical, deleted, closed, or mismatched with its binding;
- source and destination customer IDs, WalletAccount IDs, or LedgerAccount IDs are equal for this customer-to-customer scope;
- a destination customer or account is inferred from a reference, alias, customer wallet, currency, payment reference, provider ID, or policy output;
- source/destination CustomerWallet, binding, WalletAccount, and LedgerAccount IDs do not form the explicit A3 chain;
- a caller supplies both a canonical ID and a conflicting alias/reference/alternate ID;
- `WalletAccount.customerId` is treated as a foreign key or used to repair canonical identity;
- a LedgerAccount is selected by account code, currency, or a wallet scan rather than by the explicit A3 relationship;
- a binding is `PENDING`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`, missing, stale, or Ledger-unavailable and is treated as active;
- a WalletAccount or LedgerAccount is inactive, closed, dimensionally incompatible, or has an unresolved reconciliation/control discrepancy;
- amount is zero, negative, fractional, floating-point, overflowed, or not canonical minor units;
- currency is implicit, cross-currency, or different across any asserted financial dimension;
- accounting unit is absent or not `CUSTOMER_FUNDS`;
- a caller attempts to encode fees, FX, settlement, external funding, or a second financial effect in narration/reference/metadata;
- A4 `ALLOW` is used as authorization, binding, account ownership, balance approval, or posting approval;
- required A2, A3, A4, idempotency, request, correlation, or trace evidence is absent or cannot be safely correlated;
- same idempotency scope/key is reused with a different request hash;
- an in-progress duplicate executes concurrently;
- a `COMPLETED` result lacks one valid journal, a journal lacks the declared accounts/currency, or a transfer lacks a durable correlation;
- a possible committed effect is reported as `FAILED`, `PENDING` is reported as success, or `UNKNOWN` is retried blindly;
- an audit or outbox record is treated as the source of financial truth;
- reconciliation, diagnostics, readiness, or support code is used as a writer to make the command pass; or
- an existing `/transfers` route is treated as A5-approved exposure merely because it is registered.

## 12. Transfer-to-journal-to-operations trace

The intended later trace is:

```text
sourceCustomerId / destinationCustomerId
  + CustomerWallet IDs
  + A3 binding IDs and versions
  + WalletAccount IDs
  + LedgerAccount IDs
        |
        v
commandId + idempotency scope/key/hash
  + requestId + traceId + correlationId + causationId
        |
        v
A2 authorization-context reference
  + A4 decision/profile/version/evidence references
        |
        v
transferId + paymentReference
        |
        v
Ledger journalId + journal reference + immutable lines
        |
        +--> Operations auditEventId
        +--> Operations outboxEventId / aggregateId
        +--> independent reconciliation/discrepancy evidence
```

The later implementation must make the links queryable by their owners. This document does not prescribe a join schema or migration. It only prohibits guessing a link from a display value or treating one owner's ID as another owner's truth.

## 13. Ownership boundaries

| Boundary                       | Owns                                                                                                          | Command contract may read/carry                                                | Command contract must not write or replace                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `customer`                     | `Customer.id`, customer reference, lifecycle, customer source data                                            | Source/destination canonical UUID assertions                                   | Customer identity, status, deletion, reference, or profile                                                                  |
| `customer-wallet`              | CustomerWallet metadata, type, currency, provisioning/ownership lifecycle                                     | CustomerWallet IDs and A3-approved source references                           | Wallet balance, financial account, binding, or Ledger value                                                                 |
| A3 `wallet` binding capability | Customer-to-financial-account association, binding state, versions, account read/control and repair boundary  | Source/destination binding/customer-wallet/wallet/Ledger IDs and read evidence | Binding creation/repair/reassignment, account provisioning, source repair, or mutation to make command pass                 |
| `wallet`                       | WalletAccount facade, wallet status, wallet-to-Ledger relationship                                            | Explicit WalletAccount IDs and dimensions                                      | Implicit account selection, wallet reassignment, balance mutation, or legacy identity rewrite                               |
| `ledger`                       | LedgerAccount, journals, lines, balances, posted value, financial invariants                                  | Explicit LedgerAccount IDs and later journal correlation                       | A5-local account/value authority, direct balance/line writes, journal mutation                                              |
| A2                             | Principal, authentication, sessions, MFA, authorization, protected route/service, privileged approval         | Safe authorization-context reference                                           | A5-local authorization replacement                                                                                          |
| A4                             | Capability/action namespace, policy profiles/versions, decisions, evidence references, explanations, recovery | Safe policy decision/profile/evidence references                               | A5-local policy precedence, source mutation, or authorization replacement                                                   |
| Operations                     | Audit, idempotency, request/correlation/trace context, outbox, metrics, diagnostics, readiness                | Operational IDs and scoped primitives                                          | A5-local idempotency/audit/outbox store or financial truth                                                                  |
| Reconciliation/Finance         | Independent read-only source/financial verification                                                           | Discrepancy/control reference                                                  | Source repair, balance correction, status clearing, or execution approval                                                   |
| A5 command boundary            | This command envelope and later transfer lifecycle integration                                                | All approved references above                                                  | Any competing source of identity, policy, account, balance, Ledger, audit, idempotency, outbox, or reconciliation authority |

## 14. Existing transfer compatibility classification

The current transfer surface is retained as an implementation input and is not silently reclassified as the A5 contract:

| Existing field/behavior                               | A5T02 relationship                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sourceWalletId`, `destinationWalletId`               | Equivalent to explicit `sourceWalletAccountId`, `destinationWalletAccountId` only; insufficient without customer, binding, and Ledger assertions |
| `amountMinor`, `currency`                             | Retained with the stricter canonical minor-unit/currency rules in this document                                                                  |
| `idempotencyKey`                                      | Retained as an opaque key under the proposed A5 scope; Operations ownership remains required                                                     |
| `reference`, `narration`                              | Retained as bounded business fields and included in the normalized request hash when durable                                                     |
| Existing transfer UUID                                | Candidate compatibility value for a later `transferId`; not a `commandId` and not evidence of A5 gates                                           |
| Existing `paymentReference`                           | Separate support/domain reference; not canonical identity or Ledger truth                                                                        |
| Existing `journalId`                                  | Ledger-owned result reference; completion requires a valid journal, not merely a non-null field                                                  |
| Current `COMPLETED`/`FAILED` statuses                 | Compatibility state only; A5T04 must define pending/unknown/recovery lifecycle before activation                                                 |
| Existing route                                        | Existing source surface; not A5-approved exposure and not an A2/A4/A3 gate                                                                       |
| Existing service hashing/locking/transaction behavior | Financial-core compatibility evidence; later A5 tasks must bind it to this customer-aware contract                                               |

No source field, status, route, or existing service behavior is changed by A5T02.

## 15. Privacy and support trace rules

A command/result/support trace is classified operational and financial evidence. It must:

- expose canonical IDs only to an A2-authorized audience with a legitimate support/control purpose;
- minimize customer and account metadata in broad logs and outbox payloads;
- redact tokens, credentials, raw risk/compliance content, KYC documents, device data, and unnecessary personal data;
- avoid copying full Ledger lines or mutable balances into command metadata;
- preserve the references required for independent reconciliation without making correlation identifiers customer identity; and
- audit restricted support/recovery reads through Operations.

A correlation ID or payment reference may make a record discoverable, but discoverability does not change its owner or sensitivity.

## 16. Review and implementation handoff

A5T02 is complete at the documentation/contract level when the ADR and this contract are reviewed together. Later work may consume them only with the following boundaries:

- **A5T03:** Recheck A2 authorization, A4 policy/currentness, A3 binding/account state, and fail-closed gate errors. It must not duplicate A4 precedence or repair bindings.
- **A5T04:** Define durable transfer lifecycle, immutable completion, and pending/unknown states. It must not reinterpret this result vocabulary as an optimistic success.
- **A5T05:** Map the explicit LedgerAccount pair to one balanced Ledger journal through Ledger. It must not create another account/value authority.
- **A5T06:** Implement Operations-backed idempotency, deterministic locking, bounded retries, and unknown-outcome verification. It must not retry an ambiguous effect blindly.
- **A5T07:** Define the minimal transactional outbox fact and preserve the Transfer/Ledger authorities.
- **A5T08:** Independently reconcile the customer/binding/wallet/Ledger/journal/Operations chain without source mutation.
- **A5T09/A5T10:** Approve pilot cohort, amount/currency envelope, disable/rollback, route exposure, and release evidence. No approval is implied here.

## 17. Verification record

- [x] Customer-aware internal transfer scope is explicit.
- [x] Source and destination canonical Customer UUIDs are distinct and explicitly named.
- [x] CustomerWallet, A3 binding, WalletAccount, financial-account/LedgerAccount identities and relationships are explicit.
- [x] Financial account identity remains Ledger-owned; no A5 financial-account authority is introduced.
- [x] Amount, currency, accounting unit, reference, narration, and normalization rules are defined.
- [x] A2 authorization, A4 policy, and A3 binding references remain separate and non-authoritative by themselves.
- [x] Command, transfer, idempotency, request, correlation, trace, causation, payment, journal, audit, outbox, and reconciliation identifiers remain distinct.
- [x] Deterministic request hashing, replay, changed-payload conflict, and unknown-outcome posture are defined.
- [x] Request/result shapes and error/pending/unknown vocabulary are defined without execution code.
- [x] Command invariants, prohibited states, ownership boundaries, privacy, and support trace rules are explicit.
- [x] Existing transfer behavior is classified as compatibility input rather than silently declared the A5 boundary.
- [x] No entity, migration, service, controller, API, route, scheduler, provider integration, financial posting, or runtime behavior is introduced.
- [ ] A2/A3/A4/Finance/Operations/Reconciliation/Security/Risk/Compliance approval and pilot activation are not claimed by this task.
