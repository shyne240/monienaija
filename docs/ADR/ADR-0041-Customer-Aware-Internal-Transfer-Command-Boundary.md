# ADR-0041: Customer-Aware Internal Transfer Command Boundary

- **Status:** Proposed A5 decision input; not approved for runtime activation
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Customer Engineering, Wallet, Ledger, Finance, Operations, Reconciliation, Security, Risk, Compliance, and Product
- **Scope:** The command, identity, money, correlation, and result boundary for one internal customer-to-customer transfer
- **Task:** A5T02 — Customer-Aware Transfer Command and Correlation Contract
- **Implementation status:** Documentation-only contract; no entity, migration, service, controller, API, route, scheduler, financial posting, or runtime behavior is introduced

## Context

A5T01 selected one bounded pilot capability:

```text
capability: wallet.transfer
action: create
scope: internal customer-to-customer transfer
```

The repository already has a `TransferService` that accepts source and destination `WalletAccount` IDs, an amount, currency, reference, narration, and an idempotency key. That service is useful compatibility and financial-core input, but its current command shape does not establish the complete A5 boundary. In particular, a wallet ID is not proof of customer identity, a route is not proof of A2 authorization, and an existing transfer record does not by itself preserve the A2-to-A4-to-A3-to-Ledger correlation chain.

The repository has deliberately separate identity and value graphs:

```text
Customer.id
  -> CustomerWallet metadata
  -> A3 CustomerFinancialAccountBinding
  -> WalletAccount facade
  -> LedgerAccount financial account
  -> Ledger journals and lines
```

Each arrow is an explicit relationship owned or controlled by the relevant boundary. A customer reference, `WalletAccount.customerId` compatibility value, wallet alias, payment reference, provider identifier, account code, command ID, correlation ID, or idempotency key cannot replace an explicit canonical relationship.

A5T02 therefore needs a stable, customer-aware command contract before any later task can implement gates, transfer state, Ledger posting, recovery, outbox facts, or pilot exposure. The contract must make retries and investigation traceable while preserving A2, A3, A4, Wallet, Ledger, Operations, and Reconciliation ownership.

## Decision

### 1. Define one bounded command contract

A5 defines a versioned logical command named `InternalTransferCommandV1`. It is a contract for a protected internal command, not a public API shape and not an instruction to execute a transfer.

The command represents one requested movement of a positive amount of one currency from an explicitly identified source customer/account tuple to an explicitly identified destination customer/account tuple. Both financial targets are internal MonieNaija accounts. The command does not represent a bank transfer, deposit, withdrawal, external payment, settlement, provider operation, FX conversion, fee, commission, or product enrollment.

The command has these required semantic dimensions:

```text
command type/version
capability/action and internal scope
one source Customer.id (the command subject)
one destination Customer.id (the explicit counterparty)
source and destination A3 binding assertions
source and destination WalletAccount IDs
source and destination LedgerAccount IDs
positive integer minor-unit amount
explicit currency and accounting unit
optional business reference and narration
A2 authorization-context reference
A4 policy decision/profile/evidence references
request, correlation, trace, and causation context
scoped idempotency key and derived request hash
```

The normative field-level contract is in [`A5-TRANSFER-COMMAND-CONTRACT.md`](../A5-TRANSFER-COMMAND-CONTRACT.md). The command owner must not add alternate identity fields that make one logical transfer addressable through multiple competing values.

### 2. Canonical customer identity and transfer sides

`Customer.id` is the only canonical customer identity.

- `sourceCustomerId` is the sender and the command subject. The A4 policy subject projection is `subject.type = CUSTOMER` and `subject.customerId = sourceCustomerId`.
- `destinationCustomerId` is the explicitly asserted receiving customer. It is a second canonical `Customer.id`, not a customer reference or display value.
- The command must carry both IDs explicitly for the customer-to-customer scope. The destination customer must never be inferred from a wallet, alias, currency, payment reference, or policy result.
- `sourceCustomerId` and `destinationCustomerId` must not be equal for this capability. A self-transfer is a prohibited command state, not a special case that may bypass the customer/account gates.
- A2 authorizes the authenticated caller or service for the source-customer command scope. The destination identity does not become an actor merely because it receives value.
- A4 evaluates the declared capability/action for the declared policy subject. A policy result for the source customer does not authorize the destination account, prove destination ownership, or select either financial target.

The command may use the name `customerId` in an internal A4 projection only when it is explicitly documented as the source/subject value. It must not create a third, independently supplied customer identity.

### 3. Canonical financial identity tuple

For each side, the command carries one complete identity assertion:

```text
customerId
+ customerWalletId
+ bindingId
+ walletAccountId
+ ledgerAccountId
+ binding/source versions where supplied by A3
```

The source and destination tuples are independently validated. The relationships must be equivalent to:

```text
binding.customerId              = side.customerId
binding.customerWalletId        = side.customerWalletId
binding.walletAccountId         = side.walletAccountId
binding.ledgerAccountId         = side.ledgerAccountId
walletAccount.ledgerAccountId   = side.ledgerAccountId
```

Within this architecture, the **financial account identity is the `LedgerAccount.id` owned by Ledger**. The `WalletAccount.id` is the financial wallet facade and the `CustomerWallet.id` is provisioning/ownership metadata. There is no independent A5 financial-account table or A5 balance identifier. If a future transport uses a field named `sourceFinancialAccountId` or `destinationFinancialAccountId`, that field must be an explicitly documented alias of the corresponding `sourceLedgerAccountId` or `destinationLedgerAccountId`; it must not introduce a second account identity.

A5 carries the `WalletAccount` and `LedgerAccount` IDs as assertions supplied by the A3 binding/read boundary. A5 does not discover an account by scanning `WalletAccount.customerId`, customer reference, wallet alias, account code, currency, or policy output, and it does not repair or reassign a binding to make the tuple match.

### 4. Explicit internal financial scope

The version-one command is restricted to:

- `capability = wallet.transfer`;
- `action = create`;
- `scope = INTERNAL_CUSTOMER_TO_CUSTOMER`;
- two explicitly identified internal customer-funds account tuples;
- one currency shared by source wallet, destination wallet, source LedgerAccount, destination LedgerAccount, and the command;
- `accountingUnit = CUSTOMER_FUNDS`; and
- no conversion, rounding, external rail, fee, commission, suspense, settlement, or provider reference.

A5T01 records NGN as the initial planning currency boundary subject to a later pilot-control decision. This ADR does not activate NGN or any other currency and does not make a syntactically valid ISO currency a product approval. A later pilot-control task must approve the actual currency and amount envelope.

### 5. Money, reference, and narration contract

Money follows [ADR-0002](ADR-0002-Money-Representation.md):

- `amountMinor` is a positive integer represented in the serialized command as a canonical base-10 digit string. It is never a floating-point major-unit value.
- Zero, negative, fractional, signed, exponent, whitespace-padded, or non-canonical amount representations are invalid at the command boundary.
- `currency` is trimmed, uppercased, and validated as an explicit three-letter currency code. Source and destination dimensions must match it exactly after normalization.
- The amount is subject to the later A4 limit and A5 pilot envelope. The command contract does not calculate or reserve usage.
- `accountingUnit` is explicit and is `CUSTOMER_FUNDS` for this pilot contract. Ledger remains authoritative for the stored dimension.

`reference` is an optional normalized business reference for customer/support lookup. `narration` is an optional normalized description. Both are distinct from identity and value:

- they do not select a customer, wallet, financial account, or LedgerAccount;
- they do not prove payment, settlement, authorization, or ownership;
- they are included in the request hash when they are persisted or returned as part of the command result;
- they have bounded length and must not contain credentials, tokens, raw risk/compliance evidence, or unnecessary personal data; and
- an internally generated `paymentReference` and a Ledger `journal.reference` remain distinct result/correlation values.

Fees, commissions, tax, FX, and multi-line products are not hidden in `amountMinor`, `reference`, or `narration`.

### 6. A2, A4, and A3 references are assertions, not replacements for authority

The command carries safe references needed for a later consumer gate:

| Contract input                                  | Meaning                                                                                                                      | Authority retained by source                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A2 authorization-context reference              | Identifies the separate authenticated principal, audience, assurance, scope, and authorization context used for the command  | A2 remains the authority for authentication, sessions, MFA, authorization, protected routes, and privileged approval |
| A4 capability/action                            | `wallet.transfer` and `create` for this command                                                                              | A4 owns capability/action policy namespace                                                                           |
| A4 decision reference/version/profile reference | Identifies the policy decision, profile, policy version, contract version, and safe evidence context consumed by the command | A4 owns policy decision, profile, version, explanation, and recovery authority                                       |
| A4 snapshot/input references                    | Minimized snapshot reference, normalized input hash, source versions/freshness, and currentness/recovery information         | A4 and its source owners retain evidence ownership; raw evidence is not copied into the command                      |
| A3 source/destination binding references        | Explicit binding IDs, customer-wallet IDs, wallet IDs, LedgerAccount IDs, dimensions, and source versions                    | A3 owns customer-to-financial-account binding, account reads, reconciliation, and repair                             |

An A4 `ALLOW` or `ALLOW_WITH_LIMITS` is evidence for a later consumer gate. It is not A2 authorization, destination ownership, A3 binding activation, a usage reservation, a balance check, or Ledger execution approval. Missing, stale, expired, superseded, conflicting, or unavailable references cannot be normalized into an allow state by the command contract.

### 7. Stable command identity and correlation

The following values remain distinct:

- `commandId` identifies one logical command intent and remains stable across retries of that intent.
- `idempotency.scope` and `idempotency.key` identify the caller-visible duplicate-request collision domain. The proposed A5 scope is `wallet.transfer.create.v1`.
- `requestHash` is a lowercase SHA-256 digest of the normalized semantic request. It detects a changed payload under a reused idempotency key; it is not a customer or financial identity.
- `requestId` identifies one ingress/request attempt.
- `traceId` identifies an observability trace and has no business uniqueness.
- `correlationId` joins one command/workflow evidence chain across A2, A4, A3, Transfer, Ledger, Operations, support, and Reconciliation.
- `causationId` identifies the immediate parent command or event when this command is derived from another fact. It is not interchangeable with correlation.
- `transferId` identifies the later durable transfer lifecycle record and is not the command ID or idempotency key.
- `paymentReference` is a domain/support lookup value and is not financial truth.
- `journalId` identifies the Ledger journal, and `journalReference` is a Ledger/domain reference. Neither is a command ID.
- `auditEventId`, `outboxEventId`, and any reconciliation/discrepancy ID identify Operations or control evidence and cannot replace the Transfer or Ledger record.

No implementation may collapse these identifiers into one overloaded `reference` field.

### 8. Request hash and retry boundary

The normalized request hash must be deterministic across equivalent serializations. The hash algorithm is SHA-256 over canonical JSON with sorted object keys, explicit `null` for omitted optional business fields, UTF-8 encoding, and lowercase hexadecimal output.

The hash material includes every normalized semantic command field that can change the requested effect or the durable command result, including:

```text
contract version and command type
capability, action, and internal scope
source and destination customer/account identity tuples
source and destination binding assertions and relevant expected versions
amountMinor, currency, and accountingUnit
reference and narration
A4 capability/action and the immutable policy decision/profile/version references
requestedAt when it is the declared evaluation time for the command
```

The hash excludes values that identify transport, observation, or the reservation rather than the requested effect:

```text
commandId
idempotency scope/key
requestId
traceId
correlationId
causationId
HTTP headers, route formatting, and actor presentation fields
raw tokens, credentials, or sensitive source payloads
paymentReference, transferId, journalId, auditEventId, and outboxEventId generated later
```

The exclusion of an A2 request/trace reference from the business hash does not weaken A2. A2 authorization must be rechecked by the later command gate on every attempt. The inclusion of immutable A4 decision references and explicit account assertions prevents a reused key from silently changing the policy/account assertion while retaining the appearance of the same command. Exact recheck and recovery behavior is deferred to A5T03, A5T04, and A5T06.

The Operations idempotency primitive remains the operational authority. A same-scope/same-key/same-hash request may replay the durable original outcome; a same-scope/same-key/different-hash request is a conflict; an in-progress duplicate is not permission to execute a second effect. Idempotency expiration does not make a prior command, transfer, journal, or payment reference reusable.

### 9. Command result and unknown-outcome boundary

The result contract has one logical result shape and a deliberately small outcome vocabulary:

```text
COMPLETED  -> a durable transfer and one valid Ledger journal are verified
FAILED     -> the command was rejected or failed with verified absence of a financial effect
PENDING    -> a durable command/transfer record exists but approved recovery or verification is outstanding
UNKNOWN    -> the financial commit/effect cannot yet be established from durable evidence
```

`REPLAYED` is response metadata indicating that the result is the durable result of an earlier identical command; it is not a fifth financial state. A `COMPLETED` result must contain the transfer and journal correlation. `FAILED` must not be used when a journal may have committed. `PENDING` and `UNKNOWN` are not optimistic success, are not permission to retry blindly, and are not repaired by changing an identifier or selecting a new account.

A5T02 defines this vocabulary and the result references only. A5T04 owns the later lifecycle/state-machine and persistence decision; A5T05 owns Ledger posting; A5T06 owns timeout, retry, and recovery execution. This ADR does not add those runtime behaviors.

### 10. Ownership and prohibited writes

| Concept                                                  | Canonical owner                | A5 command use                                                                     | A5 prohibited write or interpretation                                                                                 |
| -------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Customer identity and lifecycle                          | `customer`                     | Read `Customer.id` for source and destination assertions                           | Do not use or rewrite `Customer.reference`, status, version, or deletion state to make a command pass                 |
| CustomerWallet                                           | `customer-wallet`              | Read metadata/provisioning identity used by A3 binding                             | Do not treat it as a balance, financial account, authorization, or policy authority                                   |
| Customer-to-account binding                              | A3 `wallet` binding capability | Consume explicit source/destination binding IDs and current read/control evidence  | Do not create, repair, reassign, suspend, close, or infer a binding during command normalization                      |
| WalletAccount                                            | `wallet`                       | Consume explicit wallet-facade IDs and status/currency assertions                  | Do not select, create, reassign, or mutate a wallet from a customer reference, alias, or currency                     |
| LedgerAccount, journals, lines, balances                 | `ledger`                       | Carry account IDs as assertions; later posting may occur only through Ledger       | Do not create accounts, write balances, post lines, or edit/delete posted history                                     |
| A2 access                                                | A2                             | Carry authorization-context reference                                              | Do not treat A4 policy, a route parameter, or a permission string as authorization                                    |
| A4 policy                                                | A4                             | Carry the declared capability/action and safe decision/version/evidence references | Do not recalculate precedence or mutate eligibility, restriction, limit, risk, compliance, enrollment, or policy rows |
| Audit, idempotency, outbox, diagnostics, request context | Operations                     | Correlate through Operations contracts                                             | Do not create local competing stores or treat an outbox/audit fact as financial truth                                 |
| Reconciliation                                           | Reconciliation/Finance         | Supply independent read-only control evidence later                                | Do not update source rows or clear a discrepancy from a command path                                                  |
| Internal transfer command                                | A5 command boundary            | Own the contract and later command lifecycle                                       | Does not become a replacement identity, policy, account, Ledger, or reconciliation authority                          |

### 11. Alternatives considered

#### Keep the existing WalletAccount-only command

Rejected for A5. It can identify two wallet rows but cannot, by itself, prove the canonical source/destination customer scope or preserve A3 binding and A4 policy references. It remains compatibility input until the approved A5 command is integrated.

#### Infer the customer from `WalletAccount.customerId` or `Customer.reference`

Rejected. The current wallet field is an opaque compatibility value, and the customer reference belongs to a different namespace. Inference would make ambiguous metadata a financial identity authority.

#### Carry only a customer ID and let the command find accounts

Rejected. A customer may have multiple metadata/account candidates and source states. A5 must receive explicit A3 account assertions and must not select a financial target from a customer, currency, alias, or policy result.

#### Use one universal reference for command, payment, journal, and correlation

Rejected. These values have different owners, lifecycles, retention, uniqueness, and recovery semantics. A single overloaded reference would make replay and reconciliation ambiguous.

#### Treat A4 `ALLOW` as complete execution approval

Rejected. A4 policy, A2 authorization, A3 binding, account state, limits/usage, Ledger invariants, idempotency, and recovery answer different questions and remain separate gates.

#### Put financial-account identity in a new A5 table

Rejected for A5T02. Ledger already owns financial accounts and posted value. A5 carries explicit LedgerAccount IDs through the A3 binding contract and does not create a second financial identity or balance authority.

### 12. Consequences

#### Positive

- The pilot has one explicit source subject and one explicit destination customer without making a display reference authoritative.
- Wallet, financial-account, and Ledger identities remain queryable as separate canonical values.
- A2, A3, and A4 context can be correlated without being collapsed into one authorization or identity value.
- Same-payload replay, changed-payload conflict, timeout investigation, journal lookup, audit lookup, outbox lookup, and independent reconciliation have a common chain.
- The contract fails closed on missing or contradictory identity and dimension assertions.
- The design remains inside the existing modular monolith and introduces no new runtime authority.

#### Trade-offs and unresolved review items

- A5T03 must decide how current A2 authorization, A4 currentness, and A3 binding reads are rechecked at execution time.
- A5T04 must turn the result vocabulary into a durable transfer state machine without misrepresenting unknown outcomes.
- A5T05/A5T06 must define the Ledger child-idempotency and transaction/recovery mapping without reusing the caller key as a second authority.
- Account-binding source versions and policy references may become stale between command creation and execution; stale evidence must fail closed rather than be silently refreshed into a different command.
- Finance, Security, Risk, Compliance, Operations, and Reconciliation approval is still required before any pilot command is enabled.

## Explicitly out of scope

This ADR and A5T02 do not:

- implement or call a transfer service, command handler, gate, policy evaluator, account-binding read, Ledger post, or recovery worker;
- add or modify an entity, migration, database constraint, repository, service, controller, API, route, scheduler, outbox consumer, or financial record;
- expose `/transfers` or any other route as an A5-approved pilot route;
- create a Customer, CustomerWallet, WalletAccount, LedgerAccount, journal, line, balance, audit, idempotency, outbox, policy, binding, or reconciliation record;
- select a pilot cohort, approve an amount/currency limit, issue an authorization, or claim financial execution approval;
- implement external banks, NIBSS, providers, settlement, callbacks, notifications, deposits, withdrawals, fees, FX, or product expansion; or
- migrate or rewrite legacy `WalletAccount.customerId` values.

## Dependencies and references

- [`A5-IMPLEMENTATION-PLAN.md`](../A5-IMPLEMENTATION-PLAN.md)
- [`A5-PILOT-BASELINE.md`](../A5-PILOT-BASELINE.md)
- [`A5-TRANSFER-COMMAND-CONTRACT.md`](../A5-TRANSFER-COMMAND-CONTRACT.md)
- [`A5-COMMAND-CORRELATION-INPUTS.md`](../A5-COMMAND-CORRELATION-INPUTS.md)
- [`A4-A5-HANDOFF-PACKAGE.md`](../A4-A5-HANDOFF-PACKAGE.md)
- [`ADR-0002-Money-Representation.md`](ADR-0002-Money-Representation.md)
- [`ADR-0003-Event-Driven-Architecture.md`](ADR-0003-Event-Driven-Architecture.md)
- [`ADR-0004-Wallet-and-Ledger.md`](ADR-0004-Wallet-and-Ledger.md)
- [`ADR-0005-Independent-Reconciliation.md`](ADR-0005-Independent-Reconciliation.md)
- [`ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md)
- [`ADR-0031-Customer-to-Financial-Account-Identity-Binding.md`](ADR-0031-Customer-to-Financial-Account-Identity-Binding.md)
- [`ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md`](ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md)
- [`ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md`](ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md)
- [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR-0036-Customer-Capability-Policy-Authority.md)
- [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md)
- [`ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md`](ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md)
- [`ADR-0039-Customer-Visible-Decision-Reasons.md`](ADR-0039-Customer-Visible-Decision-Reasons.md)
- [`ADR-0040-Policy-Versioning-and-Reproducibility.md`](ADR-0040-Policy-Versioning-and-Reproducibility.md)

## A5T02 verification record

- [x] The bounded internal customer-to-customer capability/action/scope is named.
- [x] Source and destination canonical `Customer.id` semantics are explicit.
- [x] Source and destination CustomerWallet, A3 binding, WalletAccount, and LedgerAccount identities are explicit.
- [x] Financial-account identity is kept Ledger-owned; no second A5 account authority is introduced.
- [x] Positive integer minor-unit amount, explicit currency, accounting unit, reference, and narration rules are defined.
- [x] A2, A4, and A3 references are carried without being treated as replacements for their authorities.
- [x] Command, idempotency, request, correlation, trace, causation, payment, journal, audit, outbox, and reconciliation identifiers remain distinct.
- [x] Deterministic normalization, request-hash inputs/exclusions, replay, changed-payload conflict, and in-progress behavior are defined.
- [x] Request/result and pending/unknown vocabulary is defined without implementing a lifecycle or recovery worker.
- [x] Prohibited identity, financial, authority, and runtime states are documented in the companion contract.
- [x] No application source, entity, migration, service, controller, API, route, scheduler, provider, financial posting, or runtime behavior is introduced.
- [ ] Accountable-owner approval and pilot activation are intentionally not claimed by this documentation task.
