# ADR-0036: Customer Capability Policy Authority

- **Status:** Proposed A4 decision input; no runtime implementation
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Product, Risk, Compliance, Security, Finance, Operations, Customer Engineering, Wallet, Ledger, and Reconciliation
- **Scope:** The authoritative boundary for versioned, action-specific customer capability/policy decisions
- **Task:** A4T02 — Capability Policy Authority and Request/Result Contract
- **Implementation status:** Documentation-only decision input; no entity, migration, service, controller, API, evaluator, or runtime behavior is introduced

## Context

A4T01 identified several existing evidence owners and decision-like surfaces:

- `customer` owns canonical `Customer.id` and customer lifecycle.
- `customer-onboarding` owns onboarding workflow and readiness evidence.
- `customer-eligibility` owns eligibility, restrictions, configured limits, product enrollment, and operating permissions.
- `customer-risk-profile` owns P1.10 manual risk assessments, factors, and histories.
- `customer-compliance` owns compliance cases, assignments, evidence metadata, resolution, and histories.
- A3 owns the explicit Customer-to-Financial-Account binding and read/control boundary.
- `wallet` and `ledger` own financial wallet/account state and posted financial value.
- A2 owns runtime principal, authentication, authorization, sessions, MFA, route protection, and privileged access.
- Operations owns audit, idempotency, outbox, request context, diagnostics, and operational evidence.
- Reconciliation independently verifies financial/source consistency and is read-only.

The repository also contains local decision-like surfaces that are not a central policy authority:

- onboarding readiness;
- customer operating status;
- eligibility transition checks;
- caller-supplied `LimitEngine` evaluation;
- manual risk assessment output;
- compliance case workflow state;
- A2 authorization decisions; and
- A3 customer financial-account read/control state.

Those outputs answer different questions and have different owners. Without one policy authority, future financial or product modules could interpret the same evidence differently, treat a customer permission as authorization, treat a risk score as a product decision, treat an A3 account read as eligibility, or silently overwrite source records to make an action pass.

## Decision

### 1. Single A4 policy authority

The **A4 Capability & Policy Engine boundary is the single authoritative owner of action-specific capability policy decisions and policy-definition versions**.

The A4 policy boundary is a capability within the existing modular monolith. It is not a new financial authority, identity authority, source-evidence owner, or microservice boundary.

A4 owns:

- the canonical policy request/result contract;
- the registered capability/action namespace and its policy-profile mappings;
- policy-definition versions and their effective intervals once later persistence is implemented;
- the decision vocabulary, reason/obligation contract, and decision lifecycle; and
- the policy decision output for a declared customer, capability, action, and evaluation time.

A4 does **not** own or rewrite the evidence used to make a decision. A policy decision is a derived, versioned result with its own authority boundary; it is not a replacement for eligibility, restrictions, risk, compliance, onboarding, account, authorization, or financial source state.

### 2. Policy subject and identity

A version-one A4 policy request has one canonical subject:

```text
subject.type = CUSTOMER
subject.customerId = Customer.id
```

Rules:

1. `Customer.id` is the only canonical customer identity in the A4 policy contract.
2. `Customer.reference`, wallet aliases, payment references, provider IDs, compliance case numbers, route parameters, correlation IDs, request IDs, and idempotency keys are not customer identity.
3. A customer reference may be included only as a separately owned lookup/display value when an approved source contract requires it; it never becomes the policy subject.
4. A capability that is account-specific must receive an explicit A3 binding/resource assertion. A4 must not discover or select a WalletAccount by customer reference, opaque `WalletAccount.customerId`, currency, alias, or account code.
5. A policy result for a customer does not grant a global customer status. It is valid only for its declared capability, action, policy version, evidence, and evaluation time.

### 3. Capability and action authority

A4 owns the canonical policy namespace. Existing permission enum values, product enrollment strings, HTTP routes, quote payment types, and financial lifecycle method names remain source or compatibility values until explicitly mapped into an A4 policy profile.

The logical namespace is:

```text
capability = <domain>.<resource>[.<variant>]
action     = <verb>[.<qualifier>]
```

Normalization and ownership rules are defined in [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](../A4-POLICY-REQUEST-RESULT-CONTRACT.md). In summary:

- capability and action are lowercase, bounded, ASCII-safe, dot-separated policy keys;
- HTTP methods, URL paths, route parameters, UUIDs, customer references, provider IDs, payment references, and idempotency keys are not capability/action identity;
- an unregistered or deprecated key cannot produce an implicit allow;
- A4 owns the mapping from a capability/action to its required evidence and policy version; and
- source modules retain ownership of their own permission/enrollment values and do not become A4 policy writers.

Examples such as `wallet.transfer` + `create` are namespace examples, not permission to implement a transfer or begin A5.

### 4. Policy decision authority versus adjacent authorities

| Authority                  | Owns                                                                                                | A4 relationship                                                             | Explicitly not transferred to A4                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `customer`                 | Customer UUID, reference, lifecycle, profile/KYC evidence                                           | A4 reads canonical subject/lifecycle evidence                               | Customer identity or lifecycle writes                                     |
| `customer-onboarding`      | Onboarding workflow, approvals, agreements, tasks, readiness                                        | A4 reads onboarding evidence                                                | Onboarding completion/rejection/approval writes                           |
| `customer-eligibility`     | Eligibility, restrictions, configured limits, enrollment, permissions                               | A4 reads source evidence and later maps it into a policy profile            | Eligibility/restriction/limit/enrollment/permission writes                |
| `customer-risk-profile`    | Manual risk assessments, factors, and histories                                                     | A4 reads minimized risk evidence and freshness signals                      | Automated risk scoring or assessment mutation                             |
| `customer-compliance`      | Case workflow, assignments, comments, evidence, resolution, history                                 | A4 reads minimized case references/state where a policy profile requires it | Screening, case mutation, or investigative authority                      |
| A2 runtime identity/access | Principal, authentication, sessions, MFA, authorization, privileged access, routes                  | A4 consumes an A2 context and must preserve its decision separately         | Authentication, authorization, route, session, MFA, or approval authority |
| A3 binding capability      | Customer-to-financial-account association, binding lifecycle, read/control state                    | A4 reads binding/account evidence                                           | Binding, repair, reassignment, provisioning, or account lifecycle writes  |
| `wallet` / `ledger`        | Financial wallet/account state, journals, lines, balances, posted value                             | A4 reads approved account dimensions/control state                          | Financial account, journal, line, balance, or posted-value writes         |
| Operations                 | Audit, idempotency, outbox, request/correlation/trace, diagnostics                                  | A4 reuses operational contracts                                             | Local audit/idempotency authority or business identity                    |
| Reconciliation / Finance   | Independent financial/source control evidence                                                       | A4 may consume control status as evidence                                   | Repair, source mutation, or policy decision authority                     |
| A4 policy boundary         | Capability/action policy definitions, policy versions, decision outputs, reason/obligation contract | Central decision authority                                                  | Ownership of any evidence source or financial execution                   |
| Future A5 consumer         | Authorized financial command and execution lifecycle                                                | Consumes A4 result after A2/A3 checks                                       | A4 does not implement A5 commands or posting                              |

### 5. Policy result boundary

A4 produces exactly one bounded decision for a normalized request and effective policy version:

```text
ALLOW
ALLOW_WITH_LIMITS
PENDING_REVIEW
DENY
SUSPEND
```

The result is not:

- an authenticated principal;
- an A2 authorization decision;
- an A3 account binding or account status mutation;
- an eligibility or restriction source record;
- an automated AML, sanctions, fraud, PEP, or monitoring finding;
- a financial command authorization by itself;
- a ledger posting or balance result; or
- a general customer operating status.

The result contract defines the following semantic boundary without selecting the detailed precedence rules reserved for A4T04:

| Decision            | A4 meaning                                                                                                 | Downstream implication                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ALLOW`             | The declared policy conditions are satisfied for the requested capability/action and evaluated evidence.   | A consumer may continue only after its own A2 authorization, A3 binding, and command checks pass.   |
| `ALLOW_WITH_LIMITS` | The policy conditions are satisfied subject to explicit, currency-labelled limits or obligations.          | The consumer must enforce the returned obligations/limits; A4 does not account usage or move money. |
| `PENDING_REVIEW`    | Required evidence, freshness, conflict, or review condition is unresolved.                                 | No active execution is permitted until a later valid decision satisfies the consumer contract.      |
| `DENY`              | The policy does not permit the declared capability/action under the evaluated policy version and evidence. | The consumer must not execute the action; A4 does not mutate the blocking source.                   |
| `SUSPEND`           | The capability/action is unavailable because a source or policy condition requires suspension.             | The consumer must fail closed; A4 does not suspend or close the source record.                      |

### 6. Versioning and historical identity

The contract has two distinct version concepts:

1. **Contract version** — identifies the request/result envelope interpretation, beginning at `1`.
2. **Policy version** — an immutable A4 policy-definition identity selected for a decision.

A policy version:

- is assigned by the A4 policy authority;
- is immutable once used for a decision;
- cannot be silently reused for changed rule content;
- is returned in every durable decision result; and
- is distinct from source record versions, A2 session/token versions, A3 binding versions, API versions, migration timestamps, and idempotency keys.

Policy-version persistence, activation intervals, immutable decision records, retention, and migration are A4T06 work. This ADR defines the authority and contract requirement only; it does not create those records.

### 7. Request/result and evidence boundary

The A4 request must carry:

- canonical customer subject;
- canonical capability and action keys;
- requested/evaluation time;
- A2 actor/access context as supplied by the A2 boundary;
- request, correlation, and optional causation context;
- an idempotency context where a durable/retryable decision is requested; and
- a policy-owned source-evidence request/profile reference rather than arbitrary table access.

The A4 result must carry:

- canonical customer subject;
- capability/action;
- bounded decision;
- contract and policy versions;
- evaluation and expiry/review times where applicable;
- stable reason codes and minimized explanation reference;
- source references, source versions/freshness, and normalized input hash;
- obligations and currency-labelled limit output or a safe limit reference where applicable; and
- request/correlation/decision references sufficient for support and replay.

The exact logical fields and normalization rules are in [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](../A4-POLICY-REQUEST-RESULT-CONTRACT.md). A4T02 does not assemble source evidence, evaluate precedence, persist entities, or run an evaluator.

### 8. Ownership of policy reads and writes

A4 may:

- read approved source contracts;
- normalize the minimum evidence required by a registered capability profile;
- select an immutable policy version;
- produce a policy result and safe reason/obligation references; and
- persist or audit a policy result only in a later approved A4 implementation task.

A4 may not:

- write any source record used as evidence;
- use policy output to change a source status;
- treat a readiness, reconciliation, metric, or dashboard result as a source writer;
- copy mutable balances, journal lines, credentials, raw compliance evidence, or unrestricted risk reasoning into a policy authority; or
- expose a policy route outside the A2 route/data-exposure boundary.

### 9. A2 and A3 separation rules

#### A2

A2 must authenticate and authorize the caller or service before a protected policy request/read. A4 consumes the result; it does not reimplement the A2 policy engine.

A2 `allowed = true` means the caller may request the protected resource/action under A2 scope. It does not mean the customer is eligible for a product or capability. A4 `ALLOW` means the policy evidence passed for the declared customer/capability/action. It does not mean the caller is authorized to execute a financial command.

#### A3

A3 provides explicit account/binding evidence. A4 may require a binding state or account dimension as an input to a capability profile, but it cannot infer a binding or make an account active.

`MISSING_BINDING`, `STALE_BINDING`, `REPAIR_REQUIRED`, `PENDING`, `SUSPENDED`, `CLOSED`, and `LEDGER_UNAVAILABLE` remain A3/read/control states. They are evidence conditions that a later A4 capability profile evaluates; they are not silently converted into an active account or changed by A4.

### 10. Alternatives considered

#### Let `customer-eligibility` own A4 policy decisions

Rejected. It owns eligibility, restrictions, limits, enrollment, and permissions as source metadata. Making it the policy authority would give a source domain responsibility for risk, compliance, onboarding, A2, A3, and capability-specific precedence outside its ownership.

#### Let each financial/product module decide locally

Rejected. Local checks already exist for compatibility reasons, but independent policy interpretation would produce divergent eligibility, risk, restriction, and limit outcomes and would make historical decisions non-reproducible.

#### Let A2 authorization be the policy result

Rejected. Authentication/authorization answers who may request or execute an action. A4 answers whether the declared customer/capability/action satisfies product and risk policy evidence. They require separate owners, inputs, audit, and failure semantics.

#### Let `CustomerEligibilityService.getOperatingStatus` be the A4 authority

Rejected. The view does not contain the full A4 source set, capability/action scope, policy version, evidence hash, source references, expiry, or reproducibility contract.

#### Let A3 or Ledger own capability policy

Rejected. A3 owns customer/account association and Ledger owns financial value. Neither should own product eligibility, risk, compliance, or capability policy.

#### Create a separate policy microservice now

Rejected for A4T02. A4 requires a logical policy authority and contract, not a topology change. Extraction requires measured evidence and a later architecture decision.

### 11. Consequences

#### Positive

- One policy decision authority prevents divergent financial/product interpretations.
- Source domains retain their own evidence, lifecycle, retention, and correction authority.
- A2 authorization and A3 binding remain explicit prerequisites rather than being hidden inside policy output.
- Policy results can be versioned, explained, replayed, and consumed by later commands without copying source truth.
- Existing local decision views can remain compatibility inputs while the A4 contract is introduced deliberately.

#### Trade-offs

- A4 must maintain mappings from several source vocabularies to capability-specific policy profiles.
- A4T04 must make difficult precedence decisions for contradictory/stale risk, restriction, compliance, eligibility, and account evidence.
- A4T05 must separate configured limits from execution-time usage and product-specific enforcement.
- A4T06 must preserve sensitive evidence references and historical decisions without broad data duplication.
- Consumers must perform multiple gates: A2 authorization, A4 policy, A3 binding/account checks, and their own execution invariants.

## Dependencies and references

- [`A4-IMPLEMENTATION-PLAN.md`](../A4-IMPLEMENTATION-PLAN.md)
- [`A4-POLICY-BASELINE.md`](../A4-POLICY-BASELINE.md)
- [`A4-SOURCE-EVIDENCE-MATRIX.md`](../A4-SOURCE-EVIDENCE-MATRIX.md)
- [`A4-CAPABILITY-INVENTORY.md`](../A4-CAPABILITY-INVENTORY.md)
- [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](../A4-POLICY-REQUEST-RESULT-CONTRACT.md)
- [`A3-A4-HANDOFF-PACKAGE.md`](../A3-A4-HANDOFF-PACKAGE.md)
- [`A3-A4-HANDOFF-CHECKLIST.md`](../A3-A4-HANDOFF-CHECKLIST.md)
- [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](../RISK-COMPLIANCE-AUTHORITY-REVIEW.md)
- [`CROSS-CUTTING-CONTRACTS.md`](../CROSS-CUTTING-CONTRACTS.md)
- [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](../IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)
- [`ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md`](ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md)
- [`ADR-0002-Money-Representation.md`](ADR-0002-Money-Representation.md)
- [`ADR-0004-Wallet-and-Ledger.md`](ADR-0004-Wallet-and-Ledger.md)
- [`ADR-0005-Independent-Reconciliation.md`](ADR-0005-Independent-Reconciliation.md)
- [`ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md)

## A4T02 verification record

- [x] One A4 policy authority is named without creating a new runtime module or topology.
- [x] Customer UUID is the canonical policy subject and non-canonical references are prohibited as identity.
- [x] Capability and action namespace ownership and normalization boundaries are defined.
- [x] Policy decisions are explicitly distinct from A2 authorization, A3 binding/read state, source evidence, and financial execution.
- [x] The bounded decision vocabulary and non-allow semantics are defined without implementing precedence evaluation.
- [x] Contract-version and policy-version responsibilities are separated.
- [x] Request/result fields include subject, capability, action, requested time, actor/access context, correlation, evidence request/references, policy version, reasons, obligations, expiry, and reproducibility context.
- [x] `ALLOW_WITH_LIMITS` requires explicit currency-labelled limits/obligations or a safe reference and does not authorize amount movement.
- [x] Ownership, prohibited writes, privacy, audit, idempotency, and A2/A3 handoff boundaries are explicit.
- [x] No entity, migration, service, controller, API, evaluator, precedence matrix, evidence adapter, or runtime behavior is implemented.
- [ ] A4T03 source-evidence adapter and snapshot implementation.
- [ ] A4T04 normative precedence and conflict matrix.
- [ ] A4T05 capability profiles and limit enforcement boundary.
