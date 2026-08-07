# ADR-0038: Product Eligibility and Limit Enforcement Contract

- **Status:** Proposed A4 decision input; no runtime implementation
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Product, Risk, Compliance, Finance, Security, Operations, Customer Engineering, Wallet, Ledger, and Reconciliation
- **Scope:** Capability-specific evidence requirements, enrollment/permission evaluation, product eligibility, obligations, and exact limit boundaries
- **Task:** A4T05 — Product Eligibility, Enrollment, Permission, and Limit Contract
- **Implementation status:** Documentation-only contract input; no capability evaluator, entity, migration, service, controller, API, persistence, or runtime behavior is introduced

## Context

A4T01 identified current capability-shaped source values and local decision surfaces:

- `CustomerEligibility` owns eligibility status;
- `CustomerRestriction` owns active restrictions;
- `CustomerLimitProfile` owns configured limits;
- `CustomerProductEnrollment` owns product enrollment metadata;
- `CustomerOperatingPermission` owns operating permission metadata;
- onboarding readiness and customer operating status are source-domain projections;
- `CustomerRiskProfile` owns manual risk evidence;
- `CustomerComplianceCase` owns compliance case evidence;
- A2 owns authentication and authorization; and
- A3/Wallet/Ledger own account binding, account state, dimensions, and value.

The repository also has a compatibility [`LimitEngine`](../../src/limit/limit.engine.ts) that evaluates caller-supplied limits and usage for transfer, deposit, and withdrawal. It does not load the authoritative `CustomerLimitProfile`, policy version, eligibility, restrictions, enrollment, permissions, risk, compliance, A2, or A3 evidence. It also does not cover every configured limit dimension, including daily count and wallet-balance limits.

If every financial/product module interprets these sources independently, the platform can produce divergent decisions. If callers supply the limit configuration, a caller can appear to choose its own policy. A4 therefore needs capability-specific profiles that identify required evidence and a clear separation between:

```text
source configuration
  -> A4 policy obligations/limits
  -> later command-bound usage and execution enforcement
```

## Decision

### 1. A4 capability-profile authority

The A4 Capability & Policy Engine owns a versioned logical profile for each registered capability/action. A profile declares:

- the capability/action namespace key;
- required and optional source-evidence classes;
- customer lifecycle and onboarding requirements;
- eligibility and restriction requirements;
- product-enrollment and operating-permission requirements;
- risk and compliance evidence requirements;
- A3 account/binding requirements where applicable;
- exact limit configuration and usage inputs;
- policy obligations and allowed outcome states; and
- downstream consumer gates.

A profile is a policy definition, not a product registry or source record. It cannot create, update, suspend, close, or replace any enrollment, permission, eligibility, restriction, risk, compliance, wallet, ledger, or binding record.

The logical profile contract is defined in [`A4-CAPABILITY-PROFILE-CONTRACT.md`](../A4-CAPABILITY-PROFILE-CONTRACT.md). Physical profile/version persistence is A4T06 work.

### 2. Evidence requirement vocabulary

Every profile uses an explicit requirement mode:

| Requirement mode      | Meaning                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `REQUIRED_CURRENT`    | Source class must be present, attributable, readable, and current under the profile freshness rule.                                 |
| `REQUIRED_ACTIVE`     | Source record must exist and be in an active/usable source state.                                                                   |
| `REQUIRED_IF_CONTEXT` | Source is required only when the request context declares the relevant product, channel, currency, account, or operation dimension. |
| `OPTIONAL_REFERENCE`  | Source may enrich reason/evidence context but its absence does not itself block the profile.                                        |
| `NOT_USED`            | Profile does not use the source class; no unrelated source data should be collected.                                                |

A missing `REQUIRED_CURRENT` or `REQUIRED_ACTIVE` source never silently becomes a positive source. A4T04 supplies the default non-allow outcome for degraded evidence.

### 3. Product eligibility boundary

A4 product eligibility is a derived policy condition, not a source status. For a profile that requires product eligibility, A4 evaluates the declared combination of:

- canonical customer lifecycle;
- onboarding/readiness evidence;
- current eligibility status;
- active restrictions;
- product enrollment state;
- operating permission state;
- current/manual risk evidence where required;
- relevant compliance case evidence; and
- A3/account state where the capability needs a financial account.

A4 does not mutate the source records to make the combination pass. `CustomerEligibilityService` remains the source writer for eligibility, restrictions, limits, enrollment, and permissions.

### 4. Enrollment contract

A profile must declare one enrollment requirement:

| Enrollment requirement | Meaning                                                                                                                     | Missing/closed state                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `REQUIRED_ACTIVE`      | Matching normalized product enrollment must be `ACTIVE` and current.                                                        | `DENY` under A4T04 for a required entitlement.                                         |
| `REQUIRED_CURRENT`     | Matching enrollment must exist and be current; its action-specific state is evaluated by the profile.                       | `PENDING_REVIEW` if evidence cannot establish current state.                           |
| `NOT_REQUIRED`         | The action does not require an existing enrollment.                                                                         | Absence is neutral; eligibility/restriction/permission rules still apply.              |
| `ENROLLMENT_ACTION`    | The request is itself an enrollment/activation decision. Existing active enrollment must not be required as a precondition. | Source eligibility/restrictions and action-specific approval requirements still apply. |

A4 does not create a product catalogue. The profile maps a capability key to the source-owner product string without taking ownership of that source string.

### 5. Permission contract

A profile must declare whether an operating permission is required and which source permission type maps to the capability/action:

| Permission requirement | Meaning                                                                                           | Missing/disabled state                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `REQUIRED_ENABLED`     | The matching `CustomerOperatingPermission` must exist, be current, and have `enabled = true`.     | `DENY`; absence is not permission.                     |
| `REQUIRED_CURRENT`     | The permission row must be readable/current; the profile may apply an action-specific state rule. | `PENDING_REVIEW` when its state cannot be established. |
| `NOT_REQUIRED`         | No Customer Operating Permission is used by this profile.                                         | Neutral; A2 authorization remains separate.            |

An enabled permission is policy evidence only. It never replaces:

- A2 authentication, authorization, or privileged approval;
- A3 binding/account checks; or
- downstream financial command authorization and invariants.

### 6. Risk and compliance profile boundary

A profile must state whether current risk and compliance evidence is required. A4T05 does not create screening or scoring behavior.

- P1.10 `CustomerRiskProfile` is the preferred current manual-risk evidence source.
- Onboarding-era `PROHIBITED` remains distinct and follows the hard outcome defined by ADR-0037.
- P1.10 `CRITICAL`, stale, review-due, missing, or unavailable evidence follows ADR-0037 and cannot silently become an allow.
- Compliance case state is evidence. Case creation/category alone is not an automated AML, sanctions, fraud, PEP, or transaction-monitoring result.
- A profile may require case state for a capability, but it must identify category/severity/status semantics without copying raw comments or investigative evidence.

### 7. Exact limit boundary

A4 defines a logical exact limit evaluation contract. It does not execute usage checks or mutate usage state.

#### Authoritative configuration

Configured limits come from `CustomerLimitProfile` through the `customer-eligibility` source contract:

```text
currency
 dailyTransactionCount
 dailyTransactionAmountMinor
 singleTransactionAmountMinor
 monthlyTransactionAmountMinor
 walletBalanceMinor
 profileVersion
```

- All monetary values are non-negative integer minor-unit strings.
- Currency is explicit and must match any request/account currency required by the profile.
- `null`/absent means no configured limit for that dimension; it does not mean zero.
- Caller-supplied limits to the existing `LimitEngine` are compatibility inputs, not authoritative A4 configuration.

#### Usage and financial context

Where a profile evaluates usage, the usage context must come from an approved downstream command/usage contract rather than from an untrusted caller:

```text
dailyUsedCount?
dailyUsedAmountMinor?
monthlyUsedAmountMinor?
currentLedgerBalanceMinor?  // only when a wallet-balance limit is required
usageAsOf
usageSourceReference
```

A current Ledger-derived balance may be read for a wallet-balance rule, but A4 does not store it as a mutable balance source. If usage or balance evidence is missing, stale, incompatible, or unavailable, the result follows ADR-0037 and cannot be an unqualified allow.

#### Limit result

The logical limit result is one of:

```text
NOT_APPLICABLE
WITHIN_LIMITS
EXCEEDED
INCOMPATIBLE
UNAVAILABLE
```

- `NOT_APPLICABLE` means the profile declares no limit evaluation for the action.
- `WITHIN_LIMITS` produces exact limit/obligation output and may contribute to `ALLOW_WITH_LIMITS`.
- `EXCEEDED` contributes to `DENY`.
- `INCOMPATIBLE` contributes to `DENY` for an invalid request or `PENDING_REVIEW` for unresolved source drift, according to ADR-0037.
- `UNAVAILABLE` contributes to `PENDING_REVIEW`.

The detailed logical request/result shape is in [`A4-CAPABILITY-PROFILE-CONTRACT.md`](../A4-CAPABILITY-PROFILE-CONTRACT.md). A4T07 later implements it; A5 owns command-bound usage and execution.

### 8. A2/A3 and downstream boundaries

A4 capability profiles may require A2 and A3 evidence, but they do not own those decisions:

- A2 authorization is always a separate gate for protected policy requests and command consumers.
- A3 binding/account state is required only for profiles that declare a financial-account context.
- An A4 allow cannot make a missing, stale, suspended, repair-required, closed, or ledger-unavailable A3 binding usable.
- A5 must recheck A2, A3, financial dimensions, idempotency, ledger locking, and execution invariants.
- A4 does not call financial commands, post journals, update balances, or produce external-provider effects.

## Alternatives considered

### Let each financial command read and apply `CustomerLimitProfile` independently

Rejected. It would duplicate policy precedence and create inconsistent enrollment, restriction, risk, compliance, and limit behavior. A4 supplies one profile/decision boundary while the financial command retains execution authority.

### Treat `CustomerOperatingPermission` as authorization

Rejected. It is customer capability metadata. A2 owns principal authentication and authorization, including role, scope, customer access, audience, and assurance.

### Treat an active product enrollment as sufficient eligibility

Rejected. Enrollment can become stale or conflict with eligibility, restrictions, risk, compliance, customer lifecycle, or account state. A profile evaluates the declared evidence combination.

### Reuse `LimitEngine` as the A4 authority without a source contract

Rejected. The current engine accepts caller-supplied configuration and usage and supports only transfer/deposit/withdrawal amount checks. A4 requires source-owned configuration, explicit currency, profile/version evidence, and a clear usage boundary.

### Store current usage or balances in policy metadata

Rejected. Ledger remains the balance authority and a downstream command/usage boundary owns usage accounting. A4 may reference a current read but must not create a mutable financial source.

### Create a product registry during A4T05

Rejected. A4 profiles map declared capability keys to existing enrollment/permission source values; product catalogue ownership is outside A4T05.

## Consequences

### Positive

- Each capability declares its exact evidence and consumer gates.
- Enrollment and permissions remain source metadata while policy decisions are centralized.
- Customer limit configuration is separated from caller input and command-time usage.
- Exact minor-unit/currency rules prevent ambiguous limit results.
- Financial modules can consume a stable policy contract without becoming risk or eligibility authorities.
- A2 authorization, A3 binding, A4 policy, and A5 execution remain independently auditable.

### Trade-offs

- Every new capability requires an explicit profile and source mapping.
- Existing `LimitEngine` behavior is not sufficient for all configured limit dimensions and must be reconciled in later implementation.
- Some capabilities will return `PENDING_REVIEW` when their evidence is incomplete rather than guessing.
- Profile versioning, decision persistence, and usage provenance require later A4 implementation work.

## Dependencies and references

- [`A4-IMPLEMENTATION-PLAN.md`](../A4-IMPLEMENTATION-PLAN.md)
- [`A4-POLICY-BASELINE.md`](../A4-POLICY-BASELINE.md)
- [`A4-CAPABILITY-INVENTORY.md`](../A4-CAPABILITY-INVENTORY.md)
- [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](../A4-POLICY-REQUEST-RESULT-CONTRACT.md)
- [`A4-POLICY-PRECEDENCE-MATRIX.md`](../A4-POLICY-PRECEDENCE-MATRIX.md)
- [`A4-SOURCE-EVIDENCE-MATRIX.md`](../A4-SOURCE-EVIDENCE-MATRIX.md)
- [`A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md`](../A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md)
- [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](../A4-NORMALIZED-EVIDENCE-SNAPSHOT.md)
- [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR-0036-Customer-Capability-Policy-Authority.md)
- [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md)
- [`ADR-0002-Money-Representation.md`](ADR-0002-Money-Representation.md)
- [`ADR-0004-Wallet-and-Ledger.md`](ADR-0004-Wallet-and-Ledger.md)
- [`ADR-0005-Independent-Reconciliation.md`](ADR-0005-Independent-Reconciliation.md)
- [`ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md)

## A4T05 verification record

- [x] Capability-profile ownership and versioning boundaries are defined.
- [x] Product eligibility evidence requirements are separated from source ownership.
- [x] Enrollment requirement modes and outcomes are defined.
- [x] Permission requirement modes and the separation from A2 authorization are defined.
- [x] Risk and compliance evidence requirements preserve the A4T04 vocabulary and prohibited edges.
- [x] Exact limit configuration, currency, minor-unit, usage, and balance-read boundaries are defined.
- [x] `WITHIN_LIMITS`, `EXCEEDED`, `INCOMPATIBLE`, `UNAVAILABLE`, and `NOT_APPLICABLE` limit results are defined.
- [x] A4 `ALLOW_WITH_LIMITS` is separated from A5 usage/execution enforcement.
- [x] No product registry, source mutation, financial command, entity, migration, service, controller, API, persistence, evaluator, or runtime behavior is implemented.
- [ ] A4T06 physical policy-profile/version and decision persistence.
- [ ] A4T07 runtime profile/evidence evaluation.
