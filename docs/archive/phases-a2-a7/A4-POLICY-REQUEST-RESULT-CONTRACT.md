# A4T02 — Policy Request and Result Contract

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T02 — Capability Policy Authority and Request/Result Contract
- **Contract:** `A4-CAPABILITY-POLICY.v1`
- **Status:** Proposed A4 contract input; no evaluator or runtime implementation
- **Owner:** A4 Capability & Policy Engine boundary in the existing modular monolith
- **Application, database, API, migration, and runtime changes in this task:** None

## 1. Purpose and boundary

This document defines the logical version-one request/result contract for an A4 action-specific policy decision. It gives future A4 implementation tasks and future consumers one canonical vocabulary without implementing source adapters, precedence evaluation, persistence, routes, or financial commands.

The contract answers:

```text
For this canonical Customer, capability, action, evaluation time,
access context, and requested evidence profile,
what policy decision applies under the selected immutable policy version?
```

It does not answer:

- whether the caller is authenticated or authorized — A2;
- whether a customer-to-account binding exists or can be repaired — A3;
- whether a journal may be posted or a balance may change — Ledger/A5; or
- whether a compliance case is an automated screening finding — Compliance/A4 boundary remains explicit.

The contract is logical documentation, not a TypeScript DTO or public API. A4T06 later decides persistence fields and migrations; A4T07 later implements evaluation.

## 2. Contract and policy versioning

### 2.1 Envelope version

Every request and result uses:

```text
contractVersion = 1
contractName    = A4-CAPABILITY-POLICY
```

A changed field meaning, normalization rule, decision meaning, or required field creates a new contract version. A transport/API version is separate and is not defined by A4T02.

### 2.2 Policy version

`policyVersion` identifies the immutable A4 policy definition used for a result. It is not:

- a source-record version;
- an A2 session, token, authorization, or MFA version;
- an A3 binding version;
- a migration timestamp;
- an API version; or
- an idempotency key.

The request may carry an optional `policyVersionHint` for a controlled replay or reproducibility request. If absent, the later evaluator selects the effective policy version for the requested capability/action/time. A result must always identify the policy version actually used.

Policy-version creation, effective intervals, activation, immutable historical storage, and retirement are A4T06 work. A4T02 defines only the contract requirement.

## 3. Canonical capability and action namespace

### 3.1 Namespace grammar

A4 policy keys use lowercase ASCII-safe, dot-separated names. They are policy identifiers, not URLs or source-record IDs.

```text
segment    = [a-z][a-z0-9-]{0,31}
capability = segment "." segment ("." segment)?
action     = segment ("." segment)?
```

Additional rules:

- `capability` is 2–3 segments and has a maximum serialized length of 128 characters.
- `action` is 1–2 segments and has a maximum serialized length of 64 characters.
- Surrounding whitespace is rejected; no Unicode folding, route parsing, or provider-specific normalization is applied.
- Slashes, HTTP methods, URL paths, UUIDs, customer references, wallet aliases, payment references, provider IDs, case numbers, correlation IDs, and idempotency keys are forbidden in capability/action keys.
- A key is valid only when registered by the A4 policy authority and mapped to a policy profile. Syntax validity alone does not make a key executable or allow-producing.
- Capability/action key ownership is distinct from the ownership of source values such as `CustomerOperatingPermissionType` or `CustomerProductEnrollment.product`.

### 3.2 Capability meaning

`capability` identifies the bounded product or operational capability being evaluated. `action` identifies the operation requested against that capability.

The initial A4 namespace examples are:

| Capability key            | Action examples                 | Current repository input mapping                                            | Contract status                                                    |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `wallet.transfer`         | `create`, `read`                | Transfer lifecycle, `TRANSFER` permission, quote type, wallet/account state | Candidate mapping; profile registration is later A4 work           |
| `wallet.deposit`          | `create`, `complete`            | Deposit lifecycle, `DEPOSIT` permission, quote type, account state          | Candidate mapping; no deposit policy implementation in A4T02       |
| `wallet.withdrawal`       | `create`, `process`, `complete` | Withdrawal lifecycle, `WITHDRAW` permission, quote type, account state      | Candidate mapping; no withdrawal execution in A4T02                |
| `wallet.payment`          | `create`, `use`                 | `PAYMENT` permission and payment/quote support                              | Candidate mapping; product-specific profile is later work          |
| `customer.product`        | `enroll`, `activate`, `use`     | Product enrollment metadata and operating permissions                       | Candidate mapping; A4 does not create a product registry           |
| `product.virtual-account` | `use`, `deactivate`             | Existing virtual-account metadata and `VIRTUAL_ACCOUNT` permission          | Candidate mapping; external/provider activation remains outside A4 |
| `wallet.account`          | `read`                          | A3 account read/binding state and A2 access                                 | Candidate read policy; A4 does not replace A3/A2 read authority    |
| `channel.api`             | `use`                           | `API` permission and A2 service/audience context                            | Candidate channel policy; A4 does not issue API credentials        |

These examples do not authorize A5 or any product implementation. A4T05 defines which capabilities are in scope, their required evidence, and their capability-specific actions.

### 3.3 Existing values that are not A4 keys

The following remain separate namespaces:

- `CustomerOperatingPermissionType` values such as `TRANSFER` and `BILL_PAYMENT`;
- normalized `CustomerProductEnrollment.product` strings;
- A2 route actions such as `METHOD:/api/v1/...`;
- quote/payment types such as `TRANSFER`, `DEPOSIT`, and `WITHDRAWAL`;
- financial entity lifecycle actions;
- A3 actions such as `wallet:account-binding:read`; and
- provider, payment, case, customer-reference, correlation, and idempotency values.

A4 mappings must be explicit and auditable. A route name, enum value, or permission row cannot become policy identity by string coincidence.

## 4. Logical request contract

The following is the version-one logical shape. It is not an executable DTO.

```text
PolicyDecisionRequestV1
  contractName: "A4-CAPABILITY-POLICY"
  contractVersion: 1
  subject
    type: "CUSTOMER"
    customerId: canonical Customer.id UUID
  capability: canonical A4 capability key
  action: canonical A4 action key
  requestedAt: ISO-8601 timestamp
  evaluationContext
    currency?: explicit three-letter currency when required
    channel?: registered channel key when required
    product?: registered product key when required
    targetBindingId?: explicit A3 binding assertion when required
    declaredContext?: capability-owned, versioned fields only
  actorContext
    principalType
    principalId
    customerId?
    audience?
    assuranceLevel?
    authorizationDecision
  sourceEvidenceRequest
    evidenceProfile
    asOf
    requiredSourceClasses[]
  policyVersionHint?
  requestContext
    requestId
    correlationId
    traceId?
    causationId?
  idempotencyContext?
    scope
    key
```

### 4.1 Request field contract

| Field                                         | Required                               | Normalization/validation                                                 | Meaning and ownership                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contractName`                                | Yes                                    | Exactly `A4-CAPABILITY-POLICY`                                           | Identifies the policy contract, not a service or route.                                                                                                                                            |
| `contractVersion`                             | Yes                                    | Integer `1` for this contract                                            | Envelope interpretation.                                                                                                                                                                           |
| `subject.type`                                | Yes                                    | Exactly `CUSTOMER` in version one                                        | Limits the current contract to customer-subject decisions.                                                                                                                                         |
| `subject.customerId`                          | Yes                                    | Lowercase hyphenated canonical UUID                                      | Must resolve to `Customer.id`; no reference or alias substitution.                                                                                                                                 |
| `capability`                                  | Yes                                    | Canonical namespace grammar and registered A4 key                        | Policy authority owns the key and its profile mapping.                                                                                                                                             |
| `action`                                      | Yes                                    | Canonical namespace grammar and action registered for the capability     | Not an HTTP method/path and not an A2 authorization action.                                                                                                                                        |
| `requestedAt`                                 | Yes                                    | Valid ISO-8601 timestamp with timezone                                   | Evaluation-time input and part of the reproducibility context.                                                                                                                                     |
| `evaluationContext.currency`                  | Capability-dependent                   | Trimmed uppercase three-letter code                                      | Required when a policy profile has a currency dimension; no conversion occurs.                                                                                                                     |
| `evaluationContext.channel`                   | Capability-dependent                   | Registered lowercase policy key                                          | Channel context, not an authentication credential or provider ID.                                                                                                                                  |
| `evaluationContext.product`                   | Capability-dependent                   | Registered lowercase product key                                         | Product context, not a product registry or enrollment mutation.                                                                                                                                    |
| `evaluationContext.targetBindingId`           | Capability-dependent                   | Explicit A3 binding UUID assertion                                       | Identifies an explicitly supplied A3 target; it never authorizes A4 to search or reassign an account.                                                                                              |
| `evaluationContext.declaredContext`           | Optional                               | Only fields declared by the capability profile; no arbitrary raw payload | A future capability-specific context extension. A4T05 defines financial/limit context; A4T02 does not implement it.                                                                                |
| `actorContext`                                | Required at protected boundary         | Supplied by A2; presentation fields are not trusted                      | Carries access context separately from customer policy evidence.                                                                                                                                   |
| `sourceEvidenceRequest.evidenceProfile`       | Yes                                    | A4 policy-profile reference, not a table name                            | Requests the minimum evidence profile for the capability/action.                                                                                                                                   |
| `sourceEvidenceRequest.asOf`                  | Yes                                    | Equal to or explicitly derived from `requestedAt`                        | Evidence collection target time; freshness windows are later capability/profile decisions.                                                                                                         |
| `sourceEvidenceRequest.requiredSourceClasses` | Derived/required                       | A4-owned source-class keys, not arbitrary table names                    | Declares required categories such as `CUSTOMER`, `ONBOARDING`, `ELIGIBILITY`, `RESTRICTIONS`, `LIMITS`, `ENROLLMENT`, `PERMISSIONS`, `RISK`, `COMPLIANCE`, `ACCOUNT_BINDING`, and `AUTHORIZATION`. |
| `policyVersionHint`                           | Optional                               | Immutable A4 policy-version reference                                    | Replay/reproduction assertion only; it cannot select an unregistered or unavailable version.                                                                                                       |
| `requestContext.requestId`                    | Required                               | Production request identifier                                            | Transport attempt identity; not business identity.                                                                                                                                                 |
| `requestContext.correlationId`                | Required                               | Bounded propagated correlation value                                     | Joins evidence; not customer identity or authorization.                                                                                                                                            |
| `requestContext.traceId`                      | Optional                               | Production trace value                                                   | Observability context; not a policy input.                                                                                                                                                         |
| `requestContext.causationId`                  | Optional                               | Immediate parent command/event reference                                 | Causation evidence; not a customer or resource ID.                                                                                                                                                 |
| `idempotencyContext.scope`                    | Required for durable/retryable request | Version-one scope is `policy.capability-decision.v1`                     | Operations command-deduplication scope; not a resource namespace.                                                                                                                                  |
| `idempotencyContext.key`                      | Required for durable/retryable request | Opaque trimmed value, bounded by Operations rules                        | Retry identity only; must not contain secrets, PII, or resource identity.                                                                                                                          |

### 4.2 Actor and access context

The logical `actorContext` is a minimized A2-supplied context:

```text
actorContext
  principalType
  principalId
  customerId?
  audience?
  assuranceLevel?
  authorizationDecision
    allowed
    reason?
    resourceType
    resourceId?
    customerId?
    action
    evaluatedAt
    requiredScopes[]
    requiredRoles[]
```

A4 must not accept an unverified actor string, role claim, scope, session value, or customer reference as proof of access. The A2 authorization decision remains a separate result. If it is denied, the protected policy request/read cannot proceed as an authorized operation; A4 must not turn the denial into a product-policy `DENY` that implies the customer itself is ineligible.

### 4.3 Source-evidence request boundary

The caller does not select arbitrary tables or raw fields. The A4 policy authority resolves `evidenceProfile` and the registered capability/action to a minimum source-class request. A4T03 later defines the adapter and normalized snapshot.

Source-class keys are logical categories:

```text
CUSTOMER
ONBOARDING
ELIGIBILITY
RESTRICTIONS
LIMITS
ENROLLMENT
PERMISSIONS
RISK
COMPLIANCE
ACCOUNT_BINDING
AUTHORIZATION
```

The request does not contain raw compliance comments, KYC documents, credentials, tokens, MFA proofs, device fingerprints, ledger lines, or an unrestricted `SELECT *` instruction.

## 5. Normalization, request hash, and idempotency

### 5.1 Normalized business request

The canonical business request includes:

- contract version;
- canonical customer UUID;
- capability and action keys;
- requested/evaluation time;
- policy version hint, when supplied;
- declared capability context that can affect the decision;
- explicit target-binding assertion, when required; and
- evidence-profile/source-class request.

The request context, transport headers, presentation-only actor labels, and idempotency key are carried for evidence but are not themselves business identity.

### 5.2 Request hash

A4 uses the Operations request-hash convention for durable/retryable requests:

```text
requestHash = lowercase SHA-256(canonical JSON(normalized business request))
```

The hash must:

- serialize object keys deterministically;
- include every normalized field that can change the requested policy result;
- include `requestedAt` when time affects evidence or policy selection;
- include a `policyVersionHint` when supplied;
- exclude `requestId`, `correlationId`, `traceId`, `causationId`, transport headers, idempotency key, and presentation-only actor fields unless an approved policy explicitly makes a field decision-relevant; and
- never contain raw credentials, secrets, or unnecessary customer data outside the declared canonical request.

The same `(scope, key)` with a different hash is a conflict. An idempotency key is not a policy version, decision ID, customer ID, account ID, or permanent resource identity.

## 6. Logical result contract

The following is the version-one logical shape. It is not an executable DTO or persisted entity.

```text
PolicyDecisionResultV1
  contractName: "A4-CAPABILITY-POLICY"
  contractVersion: 1
  decisionReference
  subject
    type: "CUSTOMER"
    customerId
  capability
  action
  decision
  policyVersion
  requestedAt
  evaluatedAt
  expiresAt?
  reviewAt?
  reasonCodes[]
  explanation
  obligations[]
  limits[]?
  sourceReferences[]
  evidenceContext
    collectedAt
    normalizedInputHash
    freshnessSummary
  authorizationContextReference
  requestContext
    requestId
    correlationId
    traceId?
    causationId?
```

### 6.1 Result field contract

| Field                                 | Required                                                                                                    | Meaning and boundary                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decisionReference`                   | Required for a durable result; optional only for a read-through result before A4 persistence is implemented | Opaque A4 decision identity; not a customer/account/ledger identity. A4T06 defines physical persistence.                                                              |
| `subject`                             | Yes                                                                                                         | Echoes the canonical `Customer.id` subject; no customer reference substitution.                                                                                       |
| `capability` / `action`               | Yes                                                                                                         | Echoes normalized registered policy keys.                                                                                                                             |
| `decision`                            | Yes                                                                                                         | Exactly `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, or `SUSPEND`.                                                                                         |
| `policyVersion`                       | Yes                                                                                                         | Immutable policy definition used for this result.                                                                                                                     |
| `requestedAt`                         | Yes                                                                                                         | Request evaluation time supplied by the caller/context.                                                                                                               |
| `evaluatedAt`                         | Yes                                                                                                         | Time the A4 policy authority evaluated the evidence.                                                                                                                  |
| `expiresAt`                           | Conditional                                                                                                 | Expiry for results that cannot remain current indefinitely; later policy profiles define requirements.                                                                |
| `reviewAt`                            | Conditional                                                                                                 | Reassessment/review time where the result or evidence requires review.                                                                                                |
| `reasonCodes[]`                       | Yes                                                                                                         | Stable machine-readable reasons; detailed audience mapping is A4T08 work.                                                                                             |
| `explanation`                         | Yes, minimized                                                                                              | Safe bounded explanation or explanation key; no raw restricted evidence or secrets.                                                                                   |
| `obligations[]`                       | Conditional                                                                                                 | Required next action, review, verification, or consumer condition; it does not mutate the source.                                                                     |
| `limits[]`                            | Required for `ALLOW_WITH_LIMITS` unless a safe `limitReference` is supplied                                 | Explicit currency-labelled exact limits or a safe reference. Monetary values are minor-unit integer strings, never floating point. Detailed semantics are A4T05 work. |
| `sourceReferences[]`                  | Yes for a decision that claims evidence evaluation                                                          | Source type, source record ID/reference, source version/timestamp, observed-at time, and freshness state; raw evidence is excluded.                                   |
| `evidenceContext.collectedAt`         | Yes                                                                                                         | Time the evidence snapshot used by the result was collected.                                                                                                          |
| `evidenceContext.normalizedInputHash` | Yes for reproducibility                                                                                     | Hash of the normalized evidence/request inputs used by the later evaluator.                                                                                           |
| `evidenceContext.freshnessSummary`    | Yes                                                                                                         | Minimized summary of current/stale/missing/conflicting/unavailable source conditions; final precedence is A4T04.                                                      |
| `authorizationContextReference`       | Yes for protected requests                                                                                  | Reference/summary proving which A2 context was supplied; it is not a replacement for the A2 decision.                                                                 |
| `requestContext`                      | Yes                                                                                                         | Request/correlation/trace/causation references for support and replay.                                                                                                |

### 6.2 Decision semantics

| Decision            | Contract meaning                                                                                                              | Explicit non-meaning                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ALLOW`             | A4 policy conditions pass for the declared customer/capability/action under the selected policy version and evidence context. | Not authentication, A2 authorization, A3 account binding, financial posting permission, or product provisioning.    |
| `ALLOW_WITH_LIMITS` | Policy permits the capability/action only with the returned exact limits or obligations.                                      | Not approval of an amount, balance, journal, or transaction usage; downstream command enforcement remains required. |
| `PENDING_REVIEW`    | Required policy evidence or review condition is unresolved.                                                                   | Not an allow, not a temporary authorization, and not a command to mutate source status.                             |
| `DENY`              | Policy does not permit the declared capability/action for this policy evaluation.                                             | Not a customer lifecycle mutation, compliance finding, or financial reversal.                                       |
| `SUSPEND`           | Policy result requires the capability/action to remain unavailable until a defined condition is resolved.                     | Not an instruction to suspend Customer, WalletAccount, LedgerAccount, enrollment, or any other source.              |

### 6.3 Reason codes and explanations

A4T02 establishes the result shape and stable-code requirement, not the full reason catalogue. A reason code must:

- be stable across transport/API versions;
- be attributable to the policy version and evidence context;
- avoid raw comments, risk narratives, credentials, case evidence, or internal secrets;
- distinguish policy outcome from A2 denial, A3 control state, source unavailability, and financial execution failure; and
- support a later audience-specific explanation mapping.

A4T08 owns the customer/support/operator explanation catalogue. A4T04 owns the source-precedence conditions that generate the codes.

### 6.4 Obligations and limits

An obligation is a safe, typed policy requirement such as a review, verification, enrollment, or downstream check. It contains only the minimum required information:

```text
PolicyObligation
  code
  required
  dueAt?
  expiresAt?
  reference?
```

For `ALLOW_WITH_LIMITS`, a limit item must use an explicit currency whenever it is monetary:

```text
PolicyLimit
  type
  currency?
  amountMinor?
  count?
  period?
  limitReference?
```

Rules:

- `amountMinor` is a non-negative integer string in the declared currency.
- A monetary limit without currency is invalid.
- A safe `limitReference` may be returned instead of a sensitive or capability-specific value when the consumer can resolve it through an approved contract.
- A4 does not update usage counters, debit balances, post journals, or reserve money.
- A4T05 defines which configured limit and usage inputs apply to each capability/action.

## 7. Policy result versus adjacent results

| Result type                | Authority                              | Subject/question                                                               | A4 contract relationship                          |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Authentication result      | A2 authentication execution            | Is the principal authenticated?                                                | Required context; not included as A4 decision.    |
| Authorization decision     | A2 `AuthorizationService`/route policy | May this principal request/read/execute this resource/action?                  | Must remain separately available and auditable.   |
| A4 policy decision         | A4 policy authority                    | Does this customer/capability/action satisfy the declared policy?              | Defined by this contract.                         |
| A3 account/binding read    | A3 / Wallet / Ledger read boundary     | Does an explicit customer/account binding exist and remain control-consistent? | Source/control input; not A4 authority.           |
| Financial execution result | A5/financial domain/Ledger             | What happened when an authorized command executed?                             | Downstream; never inferred from `ALLOW`.          |
| Reconciliation result      | Reconciliation / Finance               | Do source and financial records reconcile?                                     | Independent control input; never a policy writer. |

A consumer must retain these results separately. A single boolean such as `canOperate` or `allowed` is insufficient to replace the complete contract.

## 8. Controlled non-allow and error boundary

The contract requires a deterministic, safe non-allow path for:

- invalid or non-canonical customer subject;
- unknown, unregistered, deprecated, or malformed capability/action;
- absent or invalid policy version;
- missing, stale, conflicting, restricted, or unavailable required evidence;
- missing or stale A2 access context for a protected request;
- unresolved or non-active A3 binding/account control state;
- changed request payload under an existing idempotency key; and
- unknown durable outcome where the policy result cannot be verified.

A4T02 does not decide whether each condition maps to `PENDING_REVIEW`, `DENY`, or `SUSPEND`; A4T04 and capability profiles do. It does require that none of these conditions silently produces an unexplained `ALLOW`.

Contract errors must expose a stable safe error code and request/correlation context without returning credentials, raw risk/compliance evidence, internal SQL, or unrestricted source payloads.

## 9. A2/A3 consumer gates

### A2 gate

Before a protected policy request or result read is accepted:

1. A2 supplies the authenticated principal and current authorization decision.
2. The decision identifies the resource/action/customer scope being requested.
3. A4 records a safe reference/summary to the A2 context, not secrets or raw tokens.
4. A2 denial remains an access denial; it is not rewritten as a customer policy result.

### A3 gate

For a capability that requires a financial account:

1. The consumer supplies or resolves an explicit A3 binding assertion through the A3 contract.
2. A3/Wallet/Ledger source dimensions and current binding/read state are rechecked according to the consumer contract.
3. An A4 `ALLOW` does not make a missing, stale, suspended, repair-required, closed, or ledger-unavailable binding usable.
4. A4 never repairs or reassigns the binding.

### A5 future consumer gate

A5 may consume the A4 result only after independently checking:

- current A2 authorization;
- A3 binding/account state;
- currency/accounting-unit and financial wallet invariants;
- command idempotency, ledger locking, and transaction rules; and
- its own execution, outbox, recovery, and reconciliation contracts.

No A5 implementation is part of A4T02.

## 10. Examples for contract review

These are logical examples, not executable requests and not approvals of the named capabilities.

### Example A — canonical transfer policy request

```text
contractName: A4-CAPABILITY-POLICY
contractVersion: 1
subject.type: CUSTOMER
subject.customerId: canonical Customer.id UUID
capability: wallet.transfer
action: create
requestedAt: 2026-08-07T10:00:00Z
evaluationContext.currency: NGN
evaluationContext.targetBindingId: explicit A3 binding assertion
actorContext: A2 principal + authorization decision
sourceEvidenceRequest.evidenceProfile: wallet.transfer.v1
sourceEvidenceRequest.asOf: 2026-08-07T10:00:00Z
requestContext.correlationId: propagated correlation value
idempotencyContext.scope: policy.capability-decision.v1
idempotencyContext.key: opaque caller key
```

A4T02 defines how this request is named and represented. A4T03 later assembles evidence; A4T04/A4T05 later define policy rules; A5 remains the future execution consumer.

### Example B — limited outcome

```text
decision: ALLOW_WITH_LIMITS
policyVersion: immutable A4 policy version
reasonCodes: [CAPABILITY_ALLOWED_WITH_LIMIT]
limits:
  - type: DAILY_TRANSACTION_AMOUNT
    currency: NGN
    amountMinor: "500000"
obligations:
  - code: RECHECK_EXECUTION_LIMIT
    required: true
```

The result does not post a journal, reserve funds, or prove A2 authorization. The downstream command must perform its own usage and financial checks.

### Example C — unresolved A3 state

```text
capability: wallet.transfer
action: create
A3 binding state: REPAIR_REQUIRED
```

The contract requires a non-allow result selected by the later capability/precedence profile. A4 does not repair the binding or infer a replacement account.

### Example D — A2 denial

```text
A2 authorization: denied / CUSTOMER_SCOPE_MISMATCH
```

The protected policy request/read is rejected at the A2 access boundary. This is not recorded as an A4 customer `DENY` decision unless a separately authorized policy evaluation was actually performed.

## 11. Explicit A4T02 out of scope

This contract does not:

- implement a source-evidence adapter or normalized snapshot;
- define the normative risk/restriction/compliance/eligibility precedence matrix;
- define every capability profile or limit enforcement rule;
- create policy entities, migrations, repositories, services, controllers, routes, or APIs;
- evaluate a request or choose a policy version at runtime;
- persist a decision or implement retry/recovery behavior;
- create a reason-code catalogue for all audiences;
- modify Customer Foundation, A2, A3, Wallet, Ledger, Operations, or Reconciliation source code; or
- implement A5 financial commands, external providers, settlement, screening, notifications, or product activation.

## 12. A4T02 verification record

- [x] A4 is named as the single authority for action-specific capability policy definitions and decision outputs.
- [x] Customer UUID is the canonical policy subject.
- [x] Capability and action grammar, ownership, normalization, registration, and non-canonical namespaces are explicit.
- [x] Version-one request fields include subject, capability, action, requested time, actor/access context, evidence request, correlation context, policy-version hint, and idempotency context.
- [x] Version-one result fields include decision, policy version, evaluation/expiry context, reasons, explanation, obligations/limits, source references, evidence hash, and correlation references.
- [x] The decision vocabulary is bounded to `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, and `SUSPEND`.
- [x] `ALLOW` and `ALLOW_WITH_LIMITS` are explicitly not A2 authorization, A3 binding, or financial execution approval.
- [x] A2 and A3 consumer gates and prohibited interpretations are explicit.
- [x] Sensitive source data, credentials, raw compliance evidence, balances, journals, and lines are excluded from the contract by default.
- [x] No runtime evaluator, evidence adapter, precedence matrix, persistence, API, entity, migration, service, controller, or test is implemented.
- [ ] A4T03 source-evidence adapter and snapshot implementation.
- [ ] A4T04 normative precedence and conflict matrix.
- [ ] A4T05 capability profiles and limit enforcement contract.
- [ ] A4T06 policy-version and decision persistence implementation.
