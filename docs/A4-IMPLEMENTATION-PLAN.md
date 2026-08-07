# A4 Capability & Policy Engine — Implementation Plan

- **Phase:** A4 — Capability & Policy Engine
- **Status:** Planned
- **Scope:** A single, versioned, explainable, and reproducible capability/policy decision boundary for customer and product actions
- **Implementation order:** Architecture phase after the A1 ownership/risk/privacy inputs and the A2 runtime trust boundary and A3 account-binding implementation boundary
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`PHASES.md`](PHASES.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md), [`A3-A4-HANDOFF-PACKAGE.md`](A3-A4-HANDOFF-PACKAGE.md)

This document is a planning artifact only. It creates no application source, entity, migration, service, controller, test, route, or runtime behavior.

## 1. Official phase title

**A4 — Capability & Policy Engine**

A4 is an Architecture phase and is not a Product Roadmap milestone. It supplies a policy decision contract to later financial and product commands; it does not implement A5 money movement or activate a product.

## 2. Phase objective

Convert canonical customer, onboarding, eligibility, restriction, limit, enrollment, permission, risk, compliance, customer-account, and account-state evidence into one action-specific policy decision that is:

- deterministic for the same policy version and evidence snapshot;
- versioned and historically reproducible;
- explainable through stable reason codes and bounded messages;
- explicit about expiry, obligations, limits, and required review;
- separate from A2 authentication/authorization and A3 account binding; and
- safe for future financial commands to consume without allowing policy code to mutate source records or financial value.

The initial decision vocabulary is bounded to:

```text
ALLOW
ALLOW_WITH_LIMITS
PENDING_REVIEW
DENY
SUSPEND
```

`ALLOW` or `ALLOW_WITH_LIMITS` is never authorization by itself. A future command must still pass A2 authorization, A3 account-binding, and its own financial invariants before execution.

## 3. A4 scope

A4 includes:

- One named policy authority for capability/action decisions.
- A normalized policy request and result contract.
- A read-only source-evidence assembly boundary for existing Customer Foundation, risk, compliance, and A3 records.
- Capability and action vocabulary, product-enrollment mapping, permission requirements, and policy-profile inputs.
- Precedence rules for onboarding, eligibility, restrictions, limits, enrollment, permissions, risk evidence, compliance cases, customer lifecycle, and A3 account state.
- Explicit handling for missing, stale, contradictory, expired, or unavailable evidence.
- Immutable policy-version definitions and immutable decision history where persistence is required for reproducibility.
- Source identifiers, versions, timestamps, freshness, normalized-input hashes, reason codes, explanations, obligations, and expiry references sufficient to reproduce a decision without copying unnecessary sensitive evidence.
- A deterministic evaluator that consumes evidence and produces a policy decision without writing to source authorities.
- A minimized decision/read contract for future financial commands, support, operators, and approved customer-facing consumers.
- Re-evaluation, expiry, conflict, retry, idempotency, audit, diagnostics, and recovery behavior for policy decisions.
- A4 integration, reconciliation of policy evidence references, rollback, and A4/A5 handoff documentation.

### 3.1 Source evidence consumed by A4

A4 may consume approved, versioned, read-only evidence from:

| Evidence                                                                          | Source authority                                         | A4 use                                                                                                                                     |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer identity, lifecycle, deletion, and version                               | `customer`                                               | Canonical subject and baseline lifecycle gate. `Customer.id` remains the only canonical customer identity.                                 |
| Onboarding workflow, readiness, approvals, and completion state                   | `customer-onboarding`                                    | Activation and capability evidence; completion is not authorization.                                                                       |
| Eligibility status and status version                                             | `customer-eligibility`                                   | Current eligibility input until A4 produces a decision.                                                                                    |
| Active restrictions                                                               | `customer-eligibility`                                   | Blocking, review, or limited-capability input according to the approved precedence matrix.                                                 |
| Limit profile                                                                     | `customer-eligibility`                                   | Exact currency-labelled configuration input; A4 does not mutate usage or balances.                                                         |
| Product enrollment and operating permissions                                      | `customer-eligibility`                                   | Capability/product evidence; these records are not A2 authorization.                                                                       |
| Manual risk profile, factors, review due date, and history references             | `customer-risk-profile` and retained onboarding evidence | Risk evidence and freshness input; a factor or score alone is not a policy decision.                                                       |
| Compliance case category, severity, status, assignment, and resolution references | `customer-compliance`                                    | Case evidence input; a case is not an automated AML, sanctions, fraud, PEP, or monitoring result.                                          |
| Customer-to-financial-account binding state and source dimensions                 | A3 binding/read contracts, `wallet`, and `ledger`        | Account existence, ownership, currency, accounting-unit, lifecycle, and control-state input. A4 never infers or rewrites account identity. |
| A2 principal, assurance, authorization, and request context                       | A2 runtime identity/access boundary                      | Separate access evidence and correlation context. A4 does not replace A2 authorization.                                                    |

A4 must request only the minimum fields required by the capability policy. Raw credentials, tokens, MFA proofs, device fingerprints, compliance comments, unrestricted investigative evidence, ledger history, and unnecessary customer profile data must not be copied into policy records or generic decision responses.

## 4. A4 non-goals

A4 does not implement:

- Authentication, sessions, MFA, authorization, privileged approval, route protection, or security principal issuance; those remain A2 responsibilities.
- Customer identity, onboarding, eligibility, restriction, limit, enrollment, permission, risk, or compliance source ownership.
- Customer-to-financial-account binding, WalletAccount provisioning, account reassignment, reconciliation repair, or A3 lifecycle mutation.
- Transfers, deposits, withdrawals, payments, fees, commissions, settlement, external banks, NIBSS, provider callbacks, suspense, or any other A5/A6 financial execution.
- Ledger account creation, journal posting, journal-line mutation, balance mutation, opening value, or financial correction.
- AML, sanctions, fraud, PEP, transaction-monitoring, automated screening, machine-learning, or external risk-scoring engines.
- Product provisioning, product catalogue ownership, pricing, fees, commissions, customer tiers, or product-specific financial state.
- Direct enforcement of transaction usage counters or mutation of limit-consumption records. A4 returns policy limits and obligations; a later command boundary owns execution-time usage enforcement.
- Silent conversion of legacy `PROHIBITED` risk values into P1.10 `CRITICAL` values without an explicit approved mapping.
- Treating a low risk score, compliance-case creation, A2 role, customer reference, wallet alias, payment reference, provider ID, or idempotency key as sufficient identity or authorization evidence.
- A new microservice or service-extraction boundary based only on policy requirements.
- Public or customer-facing route exposure without the A2 route and data-exposure contract.

## 5. Governing architectural boundaries

A4 must preserve the following rules from A1, A2, and A3:

1. `Customer.id` remains canonical customer identity. References, aliases, case numbers, payment references, provider identifiers, and operation IDs remain non-canonical values.
2. Each source domain retains one authoritative writer. A4 reads source evidence and never changes the source to make a decision pass.
3. `customer-onboarding` owns onboarding evidence; `customer-eligibility` owns eligibility, restrictions, limits, enrollment, and permissions; `customer-risk-profile` owns manual risk evidence; and `customer-compliance` owns case evidence.
4. A2 owns authentication, principal context, authorization, MFA, session, route, and privileged-access decisions. A4 policy eligibility is a separate decision and cannot be substituted for authorization.
5. A3 owns the explicit customer-to-financial-account binding boundary. A4 consumes binding state and approved account evidence but cannot bind, repair, reassign, suspend, close, or provision financial accounts.
6. `wallet` remains the financial wallet facade and `ledger` remains the authority for financial accounts, journals, lines, balances, and posted value.
7. A4 may consume a ledger-derived value only through an approved read contract where a capability rule requires it. A4 cannot persist a mutable balance snapshot as financial truth.
8. Operations owns audit, idempotency, outbox, metrics, diagnostics, request context, and readiness primitives. A4 must reuse them rather than create local substitutes.
9. Reconciliation remains independent and read-only. A policy result, dashboard, readiness check, or evidence projection cannot repair source records.
10. Sensitive risk, compliance, credential, device, and financial data is minimized, classified, access-controlled, and not copied into a broad policy payload.
11. A4 produces a decision for a declared customer/capability/action/time scope. It does not grant a general customer status or global permission.

## 6. Sequential task breakdown

### A4T01 — Policy Baseline and Source-Evidence Inventory

- **Type:** Documentation and architecture baseline
- **ADR input:** ADR-0036 — Customer Capability Policy Authority

#### Objective

Inventory the existing evidence sources, capability-like fields, current local decision views, policy gaps, data classifications, and A3/A2 handoff inputs before defining the A4 runtime contract.

#### Deliverables

- `docs/A4-POLICY-BASELINE.md`.
- `docs/A4-SOURCE-EVIDENCE-MATRIX.md`.
- `docs/A4-CAPABILITY-INVENTORY.md`.
- Source-to-owner-to-read-contract matrix covering Customer, onboarding, eligibility, limits, enrollment, permissions, risk, compliance, A2, A3, Wallet, Ledger, Operations, and Reconciliation.
- Existing local eligibility/operating-status/limit decision inventory.
- Capability/action namespace census and duplicate-policy register.
- Evidence freshness, version, deletion, privacy, retention, and legal-hold observations.
- A4 implementation risk and dependency register.

#### Acceptance criteria

- Every A4 input source has one authoritative owner and a documented read boundary.
- Source evidence is distinguished from derived policy output and from A2 authorization.
- Existing `CustomerEligibilityService`, operating-status view, and `LimitEngine` behavior is classified as source/configuration or compatibility behavior rather than silently declared the A4 authority.
- A3 binding and Ledger-derived account state are identified as read-only inputs; no balance or account identity inference is introduced.
- Missing, stale, soft-deleted, contradictory, and unavailable evidence classes are enumerated.
- Capability and action names are identified without beginning product or A5 command implementation.
- The inventory contains no new source writer, API, entity, migration, or runtime behavior.

#### Dependencies

- A1 risk/compliance/eligibility authority review and canonical ownership matrix.
- A1 identifier, privacy, retention, and cross-cutting contract inputs.
- A2 principal/authorization and protected-context contracts.
- A3 binding/read-model handoff package.
- Existing Customer Foundation, Operations, Wallet, Ledger, and Reconciliation inventories.

### A4T02 — Capability Policy Authority and Request/Result Contract

- **Type:** Documentation and contract design
- **ADR:** ADR-0036 — Customer Capability Policy Authority

#### Objective

Define the single A4 policy authority and the stable request/result contract that future commands and approved readers consume.

#### Deliverables

- `docs/ADR/ADR-0036-Customer-Capability-Policy-Authority.md`.
- `docs/A4-POLICY-REQUEST-RESULT-CONTRACT.md`.
- Capability/action namespace and normalization rules.
- Policy request envelope containing the canonical subject, capability, action, requested-at time, actor/access context, correlation context, and source-evidence request.
- Policy result envelope containing customer UUID, capability, action, bounded decision, policy version, evaluation time, expiry/review time, reason codes, explanation, source references, obligations, and policy-limit output where applicable.
- Contract distinction between a policy decision, an A2 authorization decision, an A3 binding/read result, and a financial execution result.

#### Acceptance criteria

- Every policy request has an explicit subject, capability, action, evaluation time, and correlation context.
- The result vocabulary is exactly bounded to the approved A4 decision states and defines whether each state permits any later command step.
- `ALLOW_WITH_LIMITS` carries explicit currency-labelled limit/obligation data or a safe reference to it; it never means an amount or balance was approved implicitly.
- `PENDING_REVIEW`, `DENY`, and `SUSPEND` fail closed for later execution until the consuming contract handles them explicitly.
- A policy decision cannot be used as A2 authentication, authorization, privileged approval, or A3 account binding.
- Unknown capability/action, missing policy version, missing required source evidence, and invalid subject identity have deterministic non-allow outcomes.
- The contract is versioned, correlation-aware, minimized, and independently reviewable without implementing an evaluator.

#### Dependencies

- A4T01.
- A1 ADR-0022, ADR-0023, and ADR-0024 inputs.
- A2 authenticated principal and authorization context contract.
- A3 canonical Customer-to-financial-account binding/read contract.
- Operations request-context, audit, idempotency, and error contracts.

### A4T03 — Normalized Source-Evidence Adapter and Snapshot Contract

- **Type:** Runtime read-boundary implementation
- **ADR inputs:** ADR-0022, ADR-0023, ADR-0024, ADR-0036

#### Objective

Assemble a deterministic, read-only, privacy-minimized evidence snapshot from source-owner contracts without embedding policy precedence or mutating source records.

#### Deliverables

- A4 source-evidence adapter interfaces and normalized types in the approved policy owner module.
- Read adapters for Customer, onboarding/readiness, eligibility, restrictions, limit profile, product enrollment, operating permissions, manual risk profile/factors, compliance cases, A2 context, and A3 binding/account state.
- Source version, updated-at, deletion, freshness, and evidence-availability fields.
- Canonical evidence serialization and input hash contract.
- Missing, stale, contradictory, unavailable, and restricted-data representations.
- Source-adapter unit and contract tests.
- No source mutation or policy decision persistence in this task.

#### Acceptance criteria

- Adapters read through approved owner contracts or repositories and never write source tables.
- Every normalized evidence item identifies its source type, source ID, version or timestamp, and classification appropriate to the policy use.
- A4 never treats a customer reference, risk factor, compliance case number, wallet alias, or A2 authorization result as canonical financial identity.
- Raw credential, token, MFA, device, compliance-comment, investigative, and unnecessary profile payloads are excluded from the normalized snapshot.
- A missing or stale source is represented explicitly; it is never replaced by an optimistic default.
- The same source state normalizes to the same canonical evidence hash independent of read ordering or transport metadata.
- A3 binding states such as `MISSING_BINDING`, `STALE_BINDING`, `REPAIR_REQUIRED`, and `LEDGER_UNAVAILABLE` remain distinguishable from policy outcomes.

#### Dependencies

- A4T02.
- Customer Foundation source entities/services and read contracts.
- A2 authenticated principal/access context.
- A3 read-only binding/account contract.
- Operations data classification, request context, and diagnostics contracts.

### A4T04 — Policy State Vocabulary and Precedence Matrix

- **Type:** Documentation and ADR decision
- **ADR:** ADR-0037 — Risk, Restriction, Compliance, and Limit Precedence

#### Objective

Define the normative precedence and conflict behavior that turns multiple evidence sources into a capability-specific policy outcome without silently discarding a higher-severity or fresher source.

#### Deliverables

- `docs/ADR/ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`.
- `docs/A4-POLICY-PRECEDENCE-MATRIX.md`.
- State vocabulary mapping for customer lifecycle, onboarding, eligibility, restrictions, risk levels, compliance cases, enrollment, permissions, A3 binding states, and evidence freshness.
- Conflict and stale-evidence decision table.
- Explicit mapping decision for legacy `PROHIBITED` risk metadata versus P1.10 `CRITICAL` risk.
- Capability-specific outcome scenarios for activation, account use, product access, and future financial-command prerequisites.

#### Acceptance criteria

- Closed/deleted customer, missing customer, rejected/incomplete onboarding, revoked/ineligible eligibility, and missing source evidence cannot produce `ALLOW`.
- `BLACKLISTED`, `FROZEN`, `MANUAL_REVIEW`, and `LIMITED` restrictions have explicit precedence and cannot be silently overridden by low-risk evidence.
- Stale or review-due risk evidence has deterministic handling and cannot become a current allow solely because its score is low.
- Compliance case creation is not treated as an automated screening result; case category, severity, status, and resolution are interpreted only through explicit policy rules.
- Legacy and current risk vocabularies have an explicit mapping or remain distinct with a controlled non-allow outcome.
- A3 non-active or unresolved binding/account states cannot be presented as active financial capability.
- The matrix defines behavior for contradictory eligibility, restriction, risk, compliance, enrollment, permission, and account evidence.
- The precedence result is a policy decision and never a source mutation, authorization decision, or financial execution result.

#### Dependencies

- A4T01 through A4T03.
- A1 `RISK-COMPLIANCE-AUTHORITY-REVIEW.md` and ADR-0022.
- A1 canonical ownership and privacy/retention controls.
- A2 authorization-context contract.
- A3 binding/read-state contract.

### A4T05 — Product Eligibility, Enrollment, Permission, and Limit Contract

- **Type:** Documentation and contract design
- **ADR:** ADR-0038 — Product Eligibility and Limit Enforcement Contract

#### Objective

Define how a named capability or product action uses enrollment, operating permissions, eligibility, and exact limit configuration while keeping execution-time enforcement outside A4.

#### Deliverables

- `docs/ADR/ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md`.
- `docs/A4-CAPABILITY-PROFILE-CONTRACT.md`.
- Capability-profile matrix mapping capabilities/actions to required enrollment, permission, eligibility, account, restriction, risk, compliance, and limit inputs.
- `ALLOW_WITH_LIMITS` obligation and limit-result contract.
- Exact minor-unit and explicit-currency rules for all policy limit values.
- Boundary contract between A4 policy evaluation and the existing `LimitEngine`/future A5 command usage checks.
- Product enrollment and permission normalization rules without creating a product registry.

#### Acceptance criteria

- Each capability/action declares its required source evidence and its allowed policy outcomes.
- Product enrollment remains metadata owned by `customer-eligibility`; A4 does not create, update, suspend, or close enrollment records.
- Operating permissions are treated as policy inputs and never as A2 principal authorization.
- Limit values are integer minor units with explicit currency and cannot be converted through floating-point arithmetic.
- The contract distinguishes configured limits from current transaction usage and defines which later command boundary supplies usage evidence.
- A missing, expired, incompatible-currency, or stale limit profile has deterministic non-allow behavior.
- No capability profile creates a wallet, account, transfer, payment, fee, external-provider call, or product-specific financial state.
- Financial services receive one policy contract rather than implementing independent eligibility, restriction, risk, or limit precedence.

#### Dependencies

- A4T02 and A4T04.
- Existing `customer-eligibility` entities/services and `LimitEngine` compatibility behavior.
- A3 account-binding and currency/account-state contract.
- A2 authorization boundary.
- ADR-0002 money representation and ADR-0022 policy-authority inputs.

### A4T06 — Policy Versioning, Decision Persistence, and Reproducibility

- **Type:** Runtime persistence implementation
- **ADR:** ADR-0040 — Policy Versioning and Reproducibility

#### Objective

Persist immutable policy versions and policy decisions with enough normalized evidence references to reproduce historical outcomes without replacing source authorities or storing mutable financial truth.

#### Deliverables

- `docs/ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md`.
- Approved A4 policy-definition and policy-decision entities/repositories in the policy owner module.
- Migration package for policy-version and decision persistence where the approved design requires database state.
- Immutable policy-version lifecycle and effective-interval rules.
- Decision persistence fields for canonical customer UUID, capability/action, decision, policy version, evaluation/expiry times, reason codes, explanation reference, obligations/limit output, source IDs/versions, evidence hash, and correlation context.
- Repository contract for historical lookup, current-effective decision lookup, and reproducibility inspection.
- Persistence and migration tests, including rollback and immutability checks.

#### Acceptance criteria

- A policy version is immutable after it is used for a decision; a changed rule set creates a new version.
- Historical decisions remain attributable to the policy version and source evidence seen at evaluation time.
- The same policy version and normalized evidence produce the same decision and reason-code set.
- Decisions do not copy credentials, raw compliance evidence, mutable balances, journal lines, or source lifecycle fields as writable authority.
- Decision records cannot rewrite Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, WalletAccount, LedgerAccount, journal, line, or reconciliation records.
- Expiry and effective intervals are explicit; an expired decision cannot be treated as current `ALLOW` without a new evaluation.
- Policy persistence uses Operations audit, approved idempotency, optimistic locking where mutable control records exist, migration control, and retention-safe history handling.
- Migration up/down and persistence tests preserve all A1/A2/A3 source tables and financial invariants.

#### Dependencies

- A4T02 through A4T05.
- Operations audit, idempotency, request-context, migration, and retention contracts.
- A1 privacy, identifier, and legal-hold inputs.
- A2 principal/access context.
- A3 binding/read evidence contract.

### A4T07 — Deterministic Policy Evaluation Service

- **Type:** Runtime command/read implementation
- **ADR inputs:** ADR-0036 through ADR-0040

#### Objective

Implement the policy evaluator that combines the normalized evidence snapshot, capability profile, and immutable policy version into one persisted or read-through decision.

#### Deliverables

- A4 policy evaluator service and command/result types.
- Policy-version selection and effective-interval resolution.
- Precedence evaluation for lifecycle, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, and A3 account evidence.
- Deterministic reason-code and obligation generation.
- A2 authorization-context separation and fail-closed handling for missing/stale access context.
- Operations audit/idempotency integration for retryable decision requests.
- Unit, contract, replay, changed-payload, concurrency, conflict, and failure tests.

#### Acceptance criteria

- One request produces one deterministic, versioned decision for the declared customer/capability/action/time scope.
- The evaluator never calls a financial command, posts a journal, changes a balance, provisions an account, or changes an A3 binding.
- The evaluator never writes source evidence to make `ALLOW` or `ALLOW_WITH_LIMITS` possible.
- Missing, stale, contradictory, unavailable, or unrecognized evidence fails closed according to ADR-0037 rather than silently defaulting to `ALLOW`.
- A2 authorization is checked or consumed through the established A2 contract, but policy eligibility remains a separate result.
- Identical retries return the durable original decision; changed payloads under the same idempotency scope conflict; concurrent evaluations cannot create ambiguous current decisions.
- `ALLOW_WITH_LIMITS` returns exact, currency-labelled obligations and limits; it does not perform usage accounting.
- Reason codes and explanations identify the applicable policy rules and source references without exposing restricted raw evidence.
- Reconciliation/readiness/diagnostics services are not used as policy writers.

#### Dependencies

- A4T03 through A4T06.
- A2 authorization and request-context contracts.
- A3 binding/read contract.
- Operations audit/idempotency/diagnostics primitives.
- Existing Customer Foundation, risk, compliance, and eligibility read boundaries.

### A4T08 — Explainability, Decision Reasons, and Consumer Read Contract

- **Type:** Runtime read-model and contract implementation
- **ADR:** ADR-0039 — Customer-Visible Decision Reasons

#### Objective

Expose a minimized, audience-aware policy result that explains the decision without revealing sensitive investigative, risk, authentication, or financial-control data.

#### Deliverables

- `docs/ADR/ADR-0039-Customer-Visible-Decision-Reasons.md`.
- A4 policy decision view/DTO/read service.
- Stable reason-code catalogue and audience-specific explanation mapping.
- Customer, support/operator, service, and future financial-command consumer contracts.
- Obligation, next-action, review, and expiry representation.
- Data classification/redaction tests and read-only tests.
- Approved route integration only where an A2 route policy explicitly exists; otherwise service-owned exposure remains internal.

#### Acceptance criteria

- Every decision exposes the customer UUID, capability/action, decision, policy version, evaluation time, expiry/review time, reason codes, and applicable obligations through the approved contract.
- Customer-visible explanations do not reveal raw compliance comments, risk notes, assessor identities, restricted case evidence, security data, authorization secrets, or internal rule details beyond the approved reason vocabulary.
- Support/operator views may be more detailed only through A2 authorization and approved data classifications.
- A2 authorization, A4 policy eligibility, A3 binding state, and A5 financial execution state remain distinct in the response model.
- Expired, superseded, pending-review, denied, suspended, and unavailable decisions are represented truthfully and cannot be presented as active authorization.
- Read paths never mutate policy decisions, source evidence, account state, balances, journals, or reconciliation records.
- The consumer contract is stable, versioned, correlation-aware, and safe for future A5 integration without implementing A5.

#### Dependencies

- A4T02, A4T06, and A4T07.
- ADR-0024 privacy/classification controls.
- A2 authorization and route/data-exposure contracts.
- A3 binding/read-state contract.
- Operations audit and diagnostics contracts.

### A4T09 — Re-evaluation, Expiry, Conflict, and Recovery Controls

- **Type:** Runtime lifecycle and recovery implementation
- **ADR inputs:** ADR-0037, ADR-0039, and ADR-0040

#### Objective

Provide controlled behavior when policy versions expire, source evidence changes, a decision becomes stale, a request is retried, or policy evaluation cannot produce a safe current result.

#### Deliverables

- A4 decision re-evaluation and current-effective lookup contract.
- Expiry and review-due handling without rewriting historical decisions.
- Source-version conflict and stale-evidence outcomes.
- Policy-version retirement and supersession behavior that preserves historical reproducibility.
- Retry, idempotency, unknown-outcome, and bounded concurrency handling.
- Manual-review/blocked/retry recovery states and operational diagnostics.
- A4 recovery and support runbook evidence.
- Failure, replay, expiry, source-change, policy-change, and recovery tests.

#### Acceptance criteria

- A source update never silently edits an old policy decision; it causes a new evaluation or an explicit stale/non-current result.
- Expired or superseded decisions cannot satisfy a current allow check without a valid replacement decision.
- A missing or unavailable source produces a controlled `PENDING_REVIEW`, `DENY`, or `SUSPEND` outcome according to the capability profile; it never produces a fabricated allow.
- A policy-version change preserves historical decisions and does not reinterpret past outcomes under the new version.
- Re-evaluation is idempotent and correlation-safe; changed requests conflict and unknown transaction outcomes are verified from durable evidence before retry.
- Recovery changes A4 decision metadata/evidence only. It never repairs Customer, eligibility, risk, compliance, wallet, ledger, or reconciliation source records.
- Diagnostics and runbooks do not become policy writers or authorization bypasses.
- No scheduler, notification, external provider, financial command, or A5 implementation is introduced solely to perform re-evaluation.

#### Dependencies

- A4T06 through A4T08.
- Operations idempotency, audit, diagnostics, retention, and request-context contracts.
- A2 authorization/privileged-action context where manual review or administrative action is required.
- A3 binding and Reconciliation read-only outcomes.

### A4T10 — A4 Integration, Reconciliation, and Release Gate

- **Type:** Integration and phase-exit evidence
- **ADR review:** ADR-0036 through ADR-0040

#### Objective

Validate the complete A4 policy boundary and prepare the A4-to-A5 handoff without beginning A5 financial-command implementation.

#### Deliverables

- `docs/A4-INTEGRATION-MATRIX.md`.
- `docs/A4-ROUTE-EXPOSURE-AND-ROLLBACK.md`.
- `docs/A4-ADR-REVIEW-STATUS.md`.
- `docs/A4-OPERATIONAL-RECOVERY-RUNBOOK.md`.
- `docs/A4-EXIT-CHECKLIST.md`.
- `docs/A4-APPROVAL-PACKAGE.md`.
- `docs/A4-A5-HANDOFF-PACKAGE.md`.
- End-to-end identity-to-evidence-to-policy-decision-to-consumer trace.
- Policy-version, evidence-hash, reason-code, expiry, source-conflict, authorization-separation, retry, and recovery evidence.
- A4 migration/readiness/rollback evidence where A4T06 persistence introduces schema changes.
- A5 handoff conditions and prohibited-edge register.

#### Acceptance criteria

- Each planned capability/action maps to its source evidence, precedence rules, policy version, decision vocabulary, and consumer contract.
- Deterministic replay produces the same decision for the same policy version and normalized evidence.
- Historical decisions remain reproducible after source and policy changes.
- Missing, stale, contradictory, restricted, and unavailable evidence never produces an unexplained allow.
- A2 authorization remains separate from A4 policy eligibility; A3 binding and Ledger remain separate from policy output.
- No source record, CustomerWallet record, A3 binding, WalletAccount, LedgerAccount, journal, line, balance, reconciliation report, or financial command is mutated by A4 policy evaluation or read paths.
- Customer/support/operator explanations are minimized and classified correctly.
- No A5 transfer, deposit, withdrawal, payment, outbox consumer, external provider, settlement, A6, A7, or A8 implementation is included.
- A4 tests, lint, build, formatting, persistence migration tests where applicable, contract tests, concurrency/replay tests, authorization-separation tests, and no-source-mutation checks are represented.
- All unresolved implementation risks have an owner, severity, mitigation, and rollback/disable behavior; the A4 package does not claim production activation merely because implementation evidence exists.

#### Dependencies

- A4T01 through A4T09.
- A1 risk, identifier, privacy, retention, ownership, and cross-cutting contracts.
- A2 runtime identity/access boundary.
- A3 binding/read/reconciliation/recovery boundary.
- Existing Customer Foundation, Operations, Wallet, Ledger, and Reconciliation modules.

## 7. A4 critical path

```text
A4T01 Policy baseline and source-evidence inventory
  -> A4T02 Policy authority and request/result contract
  -> A4T03 Normalized source-evidence adapter and snapshot
  -> A4T04 Policy vocabulary and precedence matrix
  -> A4T05 Capability, enrollment, permission, and limit contract
  -> A4T06 Policy versioning and decision persistence
  -> A4T07 Deterministic policy evaluator
  -> A4T08 Explainability and consumer read contract
  -> A4T09 Re-evaluation, expiry, conflict, and recovery
  -> A4T10 A4 integration and release gate
```

A4T04 and A4T05 may conduct design review in parallel after A4T03, but A4T06 cannot persist policy definitions/decisions until both contracts are settled. A4T07 cannot evaluate until source normalization, precedence, capability profiles, and persistence contracts exist. A4T08 may prepare read-contract examples alongside A4T07, but its acceptance waits for the evaluator output. A4T09 cannot change historical decisions and must consume A4T06-A4T08 outcomes. A5 implementation remains outside A4 and requires A2, A3, and A4 dependencies together.

## 8. A4 integration trace

```text
A2 authenticated principal / authorization context
                       |
                       v
PolicyDecisionRequest(customerId, capability, action, requestedAt, correlation)
                       |
                       v
A4 source-evidence adapters
  - Customer / onboarding
  - eligibility / restrictions / limits / enrollment / permissions
  - manual risk evidence
  - compliance case evidence
  - A3 binding/account state
                       |
                       v
Normalized evidence snapshot + source versions + input hash
                       |
                       v
Versioned A4 policy definition + precedence + capability profile
                       |
                       v
PolicyDecision
  - ALLOW / ALLOW_WITH_LIMITS / PENDING_REVIEW / DENY / SUSPEND
  - policy version
  - reasons / explanation
  - source references / evidence hash
  - obligations / limits
  - expiry / review time
                       |
                       v
Future authorized command consumer
  - A2 authorization rechecked
  - A3 account binding rechecked
  - A5 financial invariants and execution remain downstream
```

A4 is the policy decision authority only. It is not the source authority for the evidence and is not the authority for authentication, account binding, financial value, or command execution.

## 9. A4 prohibited edges

- A4 writes Customer, onboarding, eligibility, restriction, limit, enrollment, permission, risk, compliance, CustomerWallet, binding, WalletAccount, LedgerAccount, journal, line, balance, or reconciliation source records to make a decision pass.
- A4 treats `ALLOW` as authentication, authorization, privileged approval, account ownership, or financial execution authorization.
- A4 treats `DENY`, `SUSPEND`, or `PENDING_REVIEW` as a command to mutate or close a source record.
- A4 uses customer references, wallet aliases, payment references, provider IDs, case numbers, or idempotency keys as canonical customer or financial identity.
- A4 makes compliance-case creation equivalent to automated AML, sanctions, fraud, PEP, or transaction-monitoring output.
- A4 embeds divergent policy checks in transfer, deposit, withdrawal, payment, wallet, or ledger services.
- A4 copies mutable ledger balances into policy/source metadata or treats policy history as financial truth.
- A4 stores raw credentials, tokens, MFA proofs, device fingerprints, unrestricted compliance comments, or unnecessary sensitive evidence in general policy outputs.
- A4 calls external banks, NIBSS, settlement, screening providers, notification providers, or partner systems.
- A4 exposes a route merely because a policy service exists; A2 route and data-exposure controls remain required.
- A4 uses readiness, metrics, diagnostics, or reconciliation reports as policy mutation or source-repair mechanisms.
- A4 begins A5 financial commands or any A6-A8 implementation.

## 10. A4 phase exit criteria

A4 implementation is complete only when:

- Every in-scope capability/action has a versioned policy profile and deterministic source-evidence contract.
- The A4 policy authority and request/result contract are stable and consumer-reviewable.
- Policy decisions are reproducible from immutable policy versions, normalized evidence references, source versions, and input hashes.
- Precedence for lifecycle, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, and A3 account state is explicit and tested.
- `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, and `SUSPEND` semantics are explicit, explainable, and fail closed.
- A2 authorization, A3 account binding, A4 policy, and A5 execution boundaries remain separate.
- Historical decisions are immutable and expiry/re-evaluation behavior is controlled.
- No A4 path mutates source records, ledger value, posted journals/lines, balances, or reconciliation evidence.
- Audit, idempotency, correlation, privacy, diagnostics, migration, rollback, and support contracts are integrated where applicable.
- Unit, contract, persistence, integration, concurrency, replay, stale-evidence, conflict, failure, and no-source-mutation tests pass.
- A4-to-A5 handoff is documented without implementing A5.

## 11. A4 handoff to A5

A4 may provide A5 with:

- canonical `Customer.id`;
- capability/action and requested-at context;
- policy decision and policy version;
- stable reason codes and approved explanation/obligation data;
- source evidence references, source versions, evidence freshness, and normalized input hash;
- expiry/review time and re-evaluation requirements;
- exact currency-labelled limit/obligation outputs where applicable; and
- a separate reference to A2 authorization and A3 binding/account-state evidence.

A4 must not provide A5 with:

- authentication secrets, tokens, MFA proofs, device fingerprints, or privileged approval payloads;
- raw compliance comments, unrestricted risk notes, or unnecessary customer/KYC data;
- a claim that A4 policy approval is sufficient to execute a financial command;
- a mutable balance or journal source;
- an account binding inferred from a customer reference or policy result; or
- an external-provider, settlement, or financial-recovery result.

A5 remains responsible for command authorization re-checks, A3 binding checks, ledger locking/posting, idempotency, outbox, transaction recovery, and independent financial reconciliation.
