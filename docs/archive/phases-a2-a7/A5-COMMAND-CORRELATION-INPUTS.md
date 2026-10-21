# A5 Command-Correlation Inputs

- **Task:** A1T11 — Draft ADR-0022 and ADR-0023
- **Status:** Future A5 contract input; not an implementation
- **Scope:** Customer-aware financial command identity, idempotency, correlation, causation, audit, journal, outbox, and reconciliation links
- **Application code, API, entity, migration, and configuration changes:** None
- **Authority decisions:** [`ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md`](ADR/ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md) and [`ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md)

## 1. Purpose and boundary

This package defines the identifiers A5 Internal Financial Pilot must carry when a protected, customer-aware command reaches a financial lifecycle and the ledger. It makes retries and investigation traceable without treating all identifiers as one value.

A5 may implement a bounded internal flow later. This document does not add a transfer, deposit, withdrawal, account-binding, authorization, ledger, outbox, or API implementation.

## 2. Command envelope

A customer-aware financial command should be represented by a contract equivalent to:

```text
FinancialCommand
  commandType
  commandVersion
  commandId
  customerId                 # canonical Customer UUID
  sourceWalletId             # canonical WalletAccount UUID, when applicable
  destinationWalletId        # canonical WalletAccount UUID, when applicable
  capability
  action
  idempotency
    scope
    key
    requestHash
  requestContext
    requestId
    correlationId
    traceId
    causationId               # parent command/event when applicable
  actorContext                # A2 authenticated principal/service/approval context
  requestedAt
  amountMinor
  currency
  businessReference          # optional domain reference, never a source of value
```

The exact command fields depend on the selected A5 pilot. `customerId`, wallet IDs, amount/currency, and financial references are included only when the command’s approved contract requires them. A customer reference, case number, beneficiary/funding reference, provider ID, or alias must be resolved to a canonical internal ID before the financial command boundary.

## 3. Identifier ownership and scope

| Field / identifier              | Owner                                                                 | Scope and rule                                                                   | A5 use                                                                                              |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Customer UUID                   | `customer`                                                            | Canonical immutable UUID                                                         | Anchors customer authorization/account-binding lookup; never a balance source                       |
| Wallet UUID                     | `wallet`                                                              | Immutable `WalletAccount.id`                                                     | Identifies financial wallet facade; ledger mapping is checked before posting                        |
| Ledger account/journal/line IDs | `ledger`                                                              | Immutable ledger record IDs; line number scoped to journal                       | Financial posting and reconciliation evidence                                                       |
| Command ID                      | Command owner / A5 financial domain                                   | One ID for one logical command; format is defined by the command contract        | Joins command logs/audit with its source request; not an idempotency key unless explicitly declared |
| Idempotency scope               | Command owner with Operations                                         | Names the command/tenant/operation collision domain                              | Prevents unrelated commands from competing for one key                                              |
| Idempotency key                 | Caller/command owner; stored by Operations or financial command table | `(scope, key)` unique while retained/unexpired; opaque, trimmed, case-preserving | Same request may replay original outcome; changed request hash conflicts                            |
| Request hash                    | Command owner                                                         | Canonical request payload, 64-character SHA-256 hex in current primitive         | Detects changed payload under a reused idempotency key; never includes raw secret in logs           |
| Request ID                      | Production/HTTP boundary                                              | One HTTP request attempt; generated or safely propagated                         | Links ingress, response, error, and audit context                                                   |
| Trace ID                        | Production/observability boundary                                     | One distributed trace; no business uniqueness                                    | Joins logs/telemetry; not used for financial identity                                               |
| Correlation ID                  | Production/HTTP and workflow owner                                    | One command/workflow chain; printable bounded value                              | Joins command, audit, decision, journal, outbox, callback, and reconciliation evidence              |
| Causation ID                    | Immediate command/event producer                                      | Parent command/event identity; required for derived facts where applicable       | Explains why a command/event exists; distinct from correlation                                      |
| Policy decision ID/version      | Future A4 policy authority                                            | Immutable decision ID and policy version for the requested action                | Proves that the command consumed the correct decision; policy is not rewritten by A5                |
| Payment/business reference      | Payment or financial domain                                           | Domain-specific/global registry rule                                             | Customer/support lookup and external reconciliation; never financial truth                          |
| Provider reference              | Future A6 adapter/provider                                            | `(provider, identifier type, value)`                                             | Carries external result only after validation and mapping; not canonical identity                   |
| Audit event ID                  | Operations                                                            | Immutable audit record ID                                                        | Records command/action/entity without copying sensitive payloads                                    |
| Outbox event ID                 | Operations/event owner                                                | Immutable durable fact ID                                                        | Links committed source mutation to future delivery/replay                                           |

## 4. Correlation chain

```text
HTTP / internal command ingress
  requestId + traceId + correlationId
        |
        v
A2 principal + A4 policy decision + A3 account binding
  policyDecisionId/version + customerId + walletId
        |
        v
A5 command reservation
  commandId + scope/key + requestHash
        |
        v
One database transaction
  domain lifecycle record
  audit event: auditId + entityId + requestId + correlationId
  ledger journal/lines: journalId + ledger IDs + correlationId
  outbox fact: eventId + aggregateId + event type
  future event envelope: correlationId + causationId + schema/version
        |
        v
Recovery, support, callback, and reconciliation
  payment/provider reference + mapped internal IDs + same correlation chain
```

Every link must be queryable by its owner without requiring a consumer to guess from a display reference. A correlation search is read-only evidence; it cannot mutate the command, ledger, audit, or outbox record.

## 5. Idempotency and retry contract

Before executing a retryable A5 command, the command owner must:

1. Normalize and validate the command, including canonical IDs, amount, currency, capability, and action.
2. Compute a deterministic request hash from the normalized command, excluding transport-only values that do not change the requested effect.
3. Reserve `(scope, idempotencyKey)` using the Operations primitive or an approved equivalent in the same command boundary.
4. Return the durable original outcome for an identical completed request.
5. Reject a reused key with a different request hash.
6. Represent an in-progress duplicate as a controlled conflict/recovery state rather than executing twice.
7. Record the durable resource ID in the idempotency outcome where available.
8. Keep the source command, audit, financial journal, and outbox fact atomic according to the selected A5 flow.

Expiration permits a future reservation only under the approved retention policy. It does not make a prior transfer, journal, or payment reference reusable and does not authorize a second financial effect without a new command identity.

## 6. Policy and authorization handoff

A5 must receive, validate, and bind:

- A2 authenticated principal/service identity and authorization/approval context.
- A4 policy decision for the same customer, capability, action, policy version, and effective time.
- A3 customer-to-financial-account mapping for every wallet/account involved.
- Ledger currency/account state and financial invariants.

A5 must fail closed when a required identity, authorization, policy, binding, or currency relationship is missing or stale. A5 does not recalculate risk, eligibility, restrictions, or compliance precedence and does not write source evidence.

## 7. Audit, ledger, outbox, and reconciliation requirements

- The domain lifecycle record, audit event, ledger journal/lines where applicable, and transactional outbox fact commit atomically or enter an explicitly defined pending/recovery state.
- `ledger` owns posted financial truth. A payment reference, command ID, correlation ID, or outbox payload cannot substitute for a journal.
- Operations owns audit and outbox persistence. A5 does not create module-local audit or event stores.
- Outbox payloads contain minimal versioned facts, aggregate identity, event identity, correlation/causation metadata, and source references; they do not copy credentials, raw identity documents, risk notes, compliance comments, or full ledger records.
- Reconciliation reads the source tables independently and uses ledger/journal/payment/correlation mappings to identify divergence. It does not repair a mismatch by editing source facts.
- Failed or ambiguous execution is represented as pending/recovery/reconciliation work. It is never silently reported as successful because a request or idempotency key exists.

## 8. A5 support and recovery queries

The approved support/reconciliation contract should be able to trace a command by:

- Canonical customer UUID.
- Wallet UUID and ledger account/journal IDs.
- Command ID and idempotency `(scope, key)`.
- Request, correlation, trace, and causation IDs.
- Policy decision ID/version.
- Payment/business reference.
- Outbox event ID and aggregate ID.
- Provider reference after A6, without trusting it as internal identity.

These queries must be access-controlled in A2, minimized under A1T07 classification/retention controls, and audited when they expose restricted financial, risk, compliance, credential, or device metadata.

## 9. A5 entry checklist

Before A5 implementation begins, accountable owners must confirm:

- [ ] A2 principal and authorization context is available.
- [ ] A4 policy decision request/result and version checks are approved.
- [ ] A3 customer-to-financial-account binding and repair/reconciliation contract is approved.
- [ ] Command ID, idempotency scope/key/hash, request, trace, correlation, and causation semantics are approved.
- [ ] Audit and outbox use the Operations primitives.
- [ ] Ledger posting and journal correlation rules are approved.
- [ ] Duplicate, timeout, serialization failure, outbox failure, and ambiguous-outcome behavior is defined.
- [ ] Reconciliation and support can trace a command without mutating source facts.
- [ ] Sensitive payload minimization, retention, legal-hold, and access rules are approved.
- [ ] No A5 implementation is introduced by this A1 document.
