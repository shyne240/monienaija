# ADR-0042: Financial Command Authorization and Policy Evaluation

- **Status:** Proposed A5 implementation decision; runtime gate implemented, pilot activation not approved
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Security, Customer Engineering, Wallet, Ledger, Finance, Operations, Reconciliation, Risk, Compliance, and Product
- **Scope:** A2 authorization, A4 policy, A3 account-binding, and Operations consumer gates for the bounded internal transfer command
- **Task:** A5T03 — Authorization, Policy, and Account-Binding Consumer Gates
- **Implementation status:** Runtime gate and tests added; no transfer persistence, Ledger posting, balance mutation, journal creation, controller, route, scheduler, provider, or external integration added

## Context

A5T02 defined the customer-aware `InternalTransferCommandV1` contract for:

```text
capability: wallet.transfer
action: create
scope: INTERNAL_CUSTOMER_TO_CUSTOMER
```

The existing transfer implementation can post a Wallet/Ledger effect from WalletAccount IDs, but the existing path is not evidence that the full A5 command boundary has passed. Before a later task can introduce transfer lifecycle persistence or Ledger posting, the command must consume and independently recheck:

1. A2 authorization for the exact source customer and transfer action.
2. A4 policy for the same canonical customer, capability, action, policy/profile version, evidence scope, limits, obligations, and validity window.
3. A3 source and destination customer-to-financial-account binding and ownership state.
4. Operations idempotency and audit primitives without creating a transfer-local authority.

A4 `ALLOW` is not A2 authorization, an account binding, a balance check, or financial execution approval. A3 `ACTIVE` is not authorization or policy eligibility. A command gate must preserve those separations and fail closed when any required evidence is absent, stale, conflicting, inactive, or unavailable.

## Decision

### 1. One internal gate service, no new exposure

The existing `transfer` module contains the A5 consumer gate service:

```text
InternalTransferGateService.validate(command)
```

The service consumes the A5T02 command contract and returns an `InternalTransferGateResult` only when all gate conditions pass. The result is a gate result, not a transfer result: it contains no `transferId`, journal ID, balance, or financial posting outcome.

The service is registered in the existing modular monolith through `TransferModule`. It is not exposed by a controller, route, API, scheduler, provider adapter, or external event publisher. Existing transfer controllers remain compatibility surfaces and are not reclassified as A5-approved exposure by this ADR.

The gate has no write access to Customer, CustomerWallet, A3 binding, WalletAccount, LedgerAccount, policy, reconciliation, or transfer lifecycle records. Its only durable writes are through the existing Operations audit/idempotency contracts and the existing A4 policy evaluator's approved persistence boundary.

### 2. Normative gate sequence

For a new logical command, the sequence is:

```text
normalize customer-aware command
        |
        v
A2 AuthorizationService recheck
        |
        v
Operations A5 idempotency reservation
        |
        v
A4 evidence collection + CapabilityPolicyEvaluationService
        |
        v
A4 result subject/scope/currentness/limit/obligation validation
        |
        v
A3 read-only source binding validation
        |
        v
A3 read-only destination binding validation
        |
        v
Operations audit fact + idempotency completion
        |
        v
InternalTransferGateResult
```

A2 is checked before an idempotency replay is returned. This prevents a caller with a revoked or mis-scoped principal from using a previously passed gate as a new access decision. A replay does not rerun A4 or A3 and does not create a second financial effect; it returns the durable original gate result only after the current A2 check succeeds.

The gate never calls Ledger posting and never enters a financial transaction. A5T04 and later tasks own the transfer lifecycle and financial transaction boundary.

### 3. A2 authorization integration

The gate reuses `AuthorizationService.authorize` with a dedicated protected resource/action:

```text
resourceType: wallet-transfer-command
action: wallet:transfer:create
```

The resource carries:

- `sourceCustomerId` as the canonical customer scope;
- `commandId` as the logical command resource identity; and
- an explicit source/destination WalletAccount scope for audit/context correlation.

Principal rules are delegated to A2:

- A `CUSTOMER` principal must be authorized for `SELF` access to the source Customer UUID.
- An internal `SERVICE`, `OPERATOR`, or `PRIVILEGED` principal must satisfy the A2 transfer scope and assigned/approved customer access rules.
- Unsupported principal types, invalid principals, missing scopes, customer-scope mismatch, audience mismatch, or other A2 denials fail closed.

The gate does not implement authentication, sessions, MFA, revocation, route protection, privileged approval, or a second authorization evaluator. `AuthorizationService` remains the authority and records its own authorization audit fact through Operations.

The destination customer is a transfer counterparty, not the command actor. A2 authorization for the source customer does not prove destination ownership; that is an A3 binding responsibility.

### 4. A4 policy evaluation integration

The gate reuses both A4 runtime boundaries:

- `PolicySourceEvidenceCoordinator` collects the approved, minimized source snapshot.
- `CapabilityPolicyEvaluationService` evaluates the exact A4 request and persists/replays its own policy decision through A4's existing Operations-backed adapters.

The constructed A4 request is fixed to:

```text
subject.type = CUSTOMER
subject.customerId = sourceCustomerId
capability = wallet.transfer
action = create
evidenceProfile = profile.wallet-transfer-create.v1
targetBindingId = sourceBindingId
```

The A4 request carries the A2 decision/context and the A5 request/correlation context. It uses a namespaced A4 policy idempotency key derived from the stable A5 command ID; the A4 policy scope remains distinct from the A5 transfer-gate scope.

The gate accepts only an A4 result that satisfies all of the following:

- subject is the same canonical source Customer UUID;
- capability is `wallet.transfer` and action is `create`;
- profile reference is `profile.wallet-transfer-create.v1`;
- any supplied policy-version, profile-version, decision-reference, snapshot-reference, and normalized-input-hash assertions match;
- decision is `ALLOW` or `ALLOW_WITH_LIMITS`;
- evidence collection is `COMPLETE` and the evidence freshness summary is entirely `CURRENT`;
- the result snapshot and normalized input hash match the collected immutable snapshot;
- the result has a valid future `expiresAt` and no due `reviewAt`;
- required downstream obligations include `RECHECK_A2_AUTHORIZATION` and `RECHECK_A3_BINDING`; and
- an `ALLOW_WITH_LIMITS` result contains a currency-matching, single-transaction minor-unit limit that covers the requested amount.

`PENDING_REVIEW`, `DENY`, `SUSPEND`, missing, stale, expired, superseded, conflicting, integrity-invalid, unavailable, or otherwise mismatched policy evidence becomes `POLICY_NOT_EXECUTABLE`. The gate does not recompute A4 precedence, mutate evidence, change eligibility, change restrictions, reserve limit usage, or treat A4 output as financial approval.

The A4 evidence collection may include the A3 account-binding evidence reader, but that policy evidence is not a substitute for the explicit source and destination A3 validation that follows it.

### 5. A3 read-only binding and ownership integration

The A5 gate consumes the A3-owned read-only method:

```text
CustomerFinancialAccountBindingService.validateActiveBinding(assertion)
```

For both source and destination, the assertion contains:

```text
Customer.id
CustomerWallet.id
CustomerFinancialAccountBinding.id
WalletAccount.id
LedgerAccount.id
expected currency
expected accounting unit
expected binding version
```

The A3 validation checks, without mutation or balance reads:

- binding existence and exact identity tuple;
- binding version and source Customer/CustomerWallet versions;
- binding state is `ACTIVE`;
- Customer exists, is not deleted, and is `ACTIVE`;
- CustomerWallet exists, is not deleted, is owned by that Customer, is `ACTIVE`, has matching currency/version, and has ownership evidence;
- WalletAccount exists, is `ACTIVE`, has matching currency, and points to the declared LedgerAccount;
- LedgerAccount exists, is active, is a customer-funds liability account with credit normal balance, matching currency/accounting unit, and negative balances disabled; and
- all command dimensions match the asserted records.

The validator does not use `WalletAccount.customerId`, Customer.reference, alias, currency, account code, payment reference, or policy output as an account selector. It does not repair, reassign, activate, suspend, close, or provision a binding/account. A missing, stale, non-active, ownership-mismatched, or dimensionally incompatible result is mapped to a deterministic A5 gate failure.

### 6. Operations audit and idempotency integration

A5 uses the existing Operations primitives through explicit adapters:

```text
A5 idempotency scope: wallet.transfer.create.v1
A4 policy scope:       policy.capability-decision.v1
```

The A5 idempotency adapter uses `IdempotencyService` and stores only a redacted gate result or safe gate failure in the existing `idempotency_records` table. It does not create an A5 transfer table or local cache.

Rules:

- Same scope/key and same request hash returns the original gate result with `replayed = true`.
- Same scope/key and a different request hash fails with `IDEMPOTENCY_KEY_CONFLICT`.
- An in-progress duplicate fails with `IDEMPOTENCY_IN_PROGRESS`.
- A gate failure is durably marked through the Operations primitive so the same command can replay the same deterministic failure rather than re-running a potentially changed gate.
- Idempotency expiry remains governed by Operations retention and does not reuse any future transfer, journal, payment, or financial identity.

The A5 audit adapter records `PASSED`, `REJECTED`, and `REPLAYED` gate facts through `AuditService`. Facts contain only the canonical IDs, command/request/correlation references, policy decision/version references, request hash, actor, and safe failure code. Raw policy evidence, credentials, tokens, balances, and full ledger payloads are excluded.

If required Operations evidence cannot be recorded for a passed gate, the gate fails closed with `OPERATIONS_EVIDENCE_UNAVAILABLE`. No Ledger or transfer mutation has occurred in A5T03.

### 7. Deterministic failure vocabulary

The gate maps failures to stable codes without exposing source-specific exception text as a new authority:

| Gate code                                              | Boundary                | Meaning                                                                          |
| ------------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------- |
| `COMMAND_INVALID` / `IDENTITY_INVALID`                 | Command                 | Envelope, context, or canonical identity is invalid                              |
| `CAPABILITY_ACTION_UNSUPPORTED`                        | A5 scope                | Command is outside `wallet.transfer/create` internal scope                       |
| `AUTHORIZATION_REQUIRED`                               | A2                      | Authorization is missing, denied, invalid, or unavailable                        |
| `POLICY_NOT_EXECUTABLE`                                | A4                      | Policy is denied, pending, suspended, stale, expired, mismatched, or unavailable |
| `BINDING_NOT_ACTIVE`                                   | A3                      | Binding is missing, stale, inactive, ownership-ambiguous, or unavailable         |
| `ACCOUNT_NOT_ACTIVE`                                   | Wallet/Ledger dimension | WalletAccount or LedgerAccount is unavailable/inactive                           |
| `IDENTITY_MISMATCH` / `ACCOUNT_ASSERTION_MISMATCH`     | A3/Wallet/Ledger        | Explicit source/destination identity relationships disagree                      |
| `ACCOUNT_DIMENSION_MISMATCH` / `CURRENCY_MISMATCH`     | Financial dimensions    | Currency, accounting unit, account type, or relationship is incompatible         |
| `IDEMPOTENCY_KEY_CONFLICT` / `IDEMPOTENCY_IN_PROGRESS` | Operations              | Duplicate request is changed or currently executing                              |
| `OPERATIONS_EVIDENCE_UNAVAILABLE`                      | Operations              | Required audit/idempotency evidence cannot be safely established                 |

Every failure is non-executable. A gate failure never creates a journal, changes a balance, repairs a binding, changes policy, or selects a replacement account.

### 8. Gate result boundary

A passed result includes:

- command ID, request hash, idempotency scope/key, and replay marker;
- source/destination canonical customer and financial-account identifiers;
- normalized amount, currency, and accounting unit;
- the A2 authorization view;
- the safe A4 decision/profile/version/snapshot/limit/obligation view;
- validated source and destination A3 binding views; and
- request/correlation/trace/causation context.

It deliberately excludes:

- transfer lifecycle identity, because A5T04 is not implemented;
- journal, line, balance, or posted-value identity, because A5T05 is not implemented;
- public response/API semantics;
- raw policy evidence or A2 security material; and
- any claim that money moved.

A `PASSED` gate means only that the command may be handed to a later approved execution boundary. It is not financial execution approval by itself.

## Alternatives considered

### Let the existing TransferService perform the gates locally

Rejected for A5T03. The existing service is WalletAccount-ID based, has optional Operations integrations, and has no complete A2/A4/A3 customer-aware contract. Gate logic must be explicit and testable before later Ledger integration.

### Accept an A4 `ALLOW` without a second A2 check

Rejected. Policy eligibility and runtime authorization answer different questions and have different owners. A2 is checked at the A5 command boundary and on replay.

### Treat A4 account-binding evidence as sufficient A3 validation

Rejected. A4 evidence is a versioned policy snapshot. A5 must recheck the explicit source and destination A3 tuple and current account dimensions immediately before a later financial boundary.

### Read or write balances to prove the gate

Rejected for A5T03. Ledger-derived balance and posting invariants belong to later financial integration. The A3 validator checks account identity and dimensions without creating a financial effect.

### Use an in-memory replay map or transfer-local idempotency table

Rejected. Operations owns durable idempotency. A5 uses the shared PostgreSQL-backed primitive and keeps the A5 scope distinct from A4 policy and future Ledger scopes.

### Add a protected route for the gate

Rejected. A5T03 is an internal service boundary only. Route exposure remains subject to A2 route/data controls and later A5 release work.

## Consequences

### Positive

- A2, A4, and A3 remain separate, ordered, independently testable prerequisites.
- The gate cannot mistake policy eligibility for authorization or account ownership.
- Both source and destination financial-account relationships are explicit and ownership-checked.
- Duplicate, changed-payload, and in-progress gate requests have deterministic outcomes without transfer persistence.
- Operations audit and idempotency remain the shared authorities.
- No Ledger posting, balance mutation, journal creation, transfer lifecycle state, public API, or external integration is introduced.

### Trade-offs and future review items

- A2's current resource policy carries the account scope as contextual data; a later security review may require a richer first-class multi-account authorization resource contract.
- A4 evaluation currently collects the full required policy evidence profile before the gate consumes the decision; evidence latency and transaction boundaries require Operations review before pilot execution.
- A3 binding validation is read-only and does not include independent reconciliation writes; A5T08 remains responsible for independent discrepancy reporting.
- A5T04 must define how a passed gate is associated with durable transfer state and how pending/unknown outcomes are represented.
- A5T05/A5T06 must place Ledger posting, account locking, financial idempotency, and recovery in one transaction boundary.

## Explicitly out of scope

This ADR and A5T03 do not:

- create or modify Transfer entities, transfer migrations, transfer lifecycle state, or public transaction history;
- call `TransferService` to post value;
- call `LedgerService.postJournal`, create journals/lines, mutate balances, or perform reversals;
- implement A5T04 or any later A5 task;
- alter Customer, CustomerWallet, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding source records, WalletAccount, LedgerAccount, policy records, or reconciliation records;
- expose a route, controller, API, scheduler, provider, bank, NIBSS, settlement, callback, notification, or external integration; or
- claim A2/A3/A4/Finance/Security/Risk/Compliance/Operations approval or pilot activation.

## Implementation evidence

- [`src/transfer/internal-transfer-gate.service.ts`](../../src/transfer/internal-transfer-gate.service.ts)
- [`src/transfer/internal-transfer-gate.types.ts`](../../src/transfer/internal-transfer-gate.types.ts)
- [`src/transfer/internal-transfer-gate.adapters.ts`](../../src/transfer/internal-transfer-gate.adapters.ts)
- [`src/transfer/transfer.module.ts`](../../src/transfer/transfer.module.ts)
- [`src/wallet/customer-financial-account-binding.service.ts`](../../src/wallet/customer-financial-account-binding.service.ts)
- [`src/wallet/customer-financial-account-binding.types.ts`](../../src/wallet/customer-financial-account-binding.types.ts)
- [`test/internal-transfer-gate.service.spec.ts`](../../test/internal-transfer-gate.service.spec.ts)
- [`A5-IMPLEMENTATION-PLAN.md`](../A5-IMPLEMENTATION-PLAN.md)
- [`A5-TRANSFER-COMMAND-CONTRACT.md`](../A5-TRANSFER-COMMAND-CONTRACT.md)
- [`A4-A5-HANDOFF-PACKAGE.md`](../A4-A5-HANDOFF-PACKAGE.md)
- [`ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md`](ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md)

## A5T03 verification record

- [x] A2 authorization is rechecked for the exact internal transfer source-customer scope.
- [x] A4 evidence collection and `CapabilityPolicyEvaluationService` are consumed for `wallet.transfer/create`.
- [x] A4 subject, capability, action, profile, policy version, evidence scope, expiry, review, obligations, and limits are validated.
- [x] A3 validates both explicit source and destination customer-to-financial-account tuples read-only.
- [x] Customer and CustomerWallet ownership/version state is checked without source mutation.
- [x] WalletAccount and LedgerAccount dimensions and lifecycle are checked without Ledger posting or balance mutation.
- [x] Operations-backed A5 idempotency and audit adapters are provided.
- [x] Authorization failure, policy denial, missing binding, inactive binding, successful gate, replay, and changed-payload tests are present.
- [x] No transfer persistence, journal, line, balance, controller, route, scheduler, provider, or external integration was introduced.
- [ ] Accountable-owner approval and pilot activation remain unresolved and are not claimed.
