# Risk, Eligibility, and Compliance Authority Review

- Task: A1T06 — Risk, Eligibility, and Compliance Authority Review
- Scope: P1.3 eligibility and restrictions, P1.3 eligibility-era risk metadata, P1.9 compliance cases, P1.10 risk assessments, and future A4 policy decisions
- Classification: Documentation-only Architecture decision input
- Application code changed: None

## 1. Purpose

This review defines how customer eligibility, restrictions, risk assessments, compliance cases, and future policy decisions relate without introducing an AML, sanctions, fraud, monitoring, or automated policy engine.

The immediate goal is to distinguish authoritative source evidence from future action-specific policy output. A4 may implement policy decisions later; A1T06 only defines the decision boundary and precedence inputs.

## 2. Risk and compliance authority matrix

| Source or decision                       | Current owner                                         | Current authority                                        | Data represented                                                                             | Metadata/projection status              | Future use                                             | Consolidation recommendation                                                                         |
| ---------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Onboarding-era risk metadata             | `customer-onboarding`                                 | Historical onboarding assessment context only            | Earlier risk level, KYC status, assessment actor, onboarding evidence                        | Historical source metadata              | Preserve as evidence for previous onboarding decisions | Do not create new risk decisions here; map into P1.10 evidence during A1/A4.                         |
| Eligibility status                       | `customer-eligibility`                                | Current source of eligibility status until A4            | `PENDING`, `ELIGIBLE`, `INELIGIBLE`, `SUSPENDED`, `REVOKED`                                  | Current decision metadata               | Input to capability policy                             | Keep as the current eligibility writer until A4 defines a policy authority.                          |
| Customer restrictions                    | `customer-eligibility`                                | Current source of restriction records                    | `BLACKLISTED`, `FROZEN`, `LIMITED`, `MANUAL_REVIEW`, `NONE`                                  | Current restriction metadata            | Input to capability policy and product gates           | Keep source records; centralize precedence in A4.                                                    |
| Customer limit profile                   | `customer-eligibility`                                | Current limit configuration source                       | Count, amount, wallet-balance limits                                                         | Configuration metadata                  | Input to action-specific policy and later enforcement  | Keep configuration separate from policy output and transaction usage.                                |
| Product enrollment and permissions       | `customer-eligibility`                                | Current enrollment/permission metadata                   | Product status and operating permissions                                                     | Capability inputs, not authorization    | Input to A4 decision                                   | Do not let individual financial modules interpret these independently.                               |
| P1.3 eligibility-era risk representation | `customer-onboarding` / earlier risk storage          | Historical/compatibility risk metadata                   | Earlier customer risk level and assessment context                                           | Legacy evidence and compatibility data  | Migration/reference during A4                          | Prefer P1.10 for new manual assessment evidence; stop treating this as the future assessment writer. |
| Manual risk profile                      | `customer-risk-profile`                               | Preferred manual assessment evidence authority           | Assessment date, assessor, method, overall risk, review date, notes                          | Canonical assessment evidence for P1.10 | Input to A4 policy                                     | Continue as assessment evidence; do not make it an automated risk engine.                            |
| Risk factors and factor history          | `customer-risk-profile`                               | Preferred factor evidence authority                      | Category, score, weight, remarks, assessment version                                         | Append-only evidence                    | Input to explainable policy decisions                  | Preserve history; do not infer regulatory conclusions from a factor alone.                           |
| Compliance cases                         | `customer-compliance`                                 | Case-management and investigation-record authority       | Category, severity, status, assignments, comments, evidence metadata, resolution             | Operational compliance evidence         | Input to A4 policy when a case status is relevant      | Keep cases as records of review/work; do not turn case creation into automatic screening.            |
| Future policy decision                   | Future A4 policy boundary                             | Future authority for an action-specific result           | Allow, deny, suspend, or pending-review result, reasons, policy version, evidence references | Derived decision output                 | Consumer for financial/product commands                | Must not replace source evidence or write source statuses implicitly.                                |
| Financial execution outcome              | `ledger`, transfer/deposit/withdrawal/payment domains | Financial domains own execution state; ledger owns value | Authorized command outcome and journal state                                                 | Downstream result, not risk evidence    | Reconciliation and support                             | A4 must decide before execution; financial domains must not become risk authorities.                 |

## 3. Authority rules

1. **P1.10 is the preferred manual assessment evidence authority.** New manual risk assessments and risk-factor histories belong to `customer-risk-profile`.
2. **P1.3 remains the current eligibility and restriction source until A4.** A1T06 does not move eligibility or restriction writes.
3. **Compliance cases remain operational evidence.** A case records review work and evidence; it does not prove AML, sanctions, fraud, or PEP findings by itself.
4. **Policy decisions are separate from evidence.** A4 will evaluate versioned source facts for a specific capability/action and produce a decision without rewriting those facts.
5. **Financial modules are consumers of policy.** Transfer, deposit, withdrawal, payment, and wallet modules must not implement their own conflicting risk or eligibility rules.
6. **Audit is not a policy authority.** Audit records prove what happened; they do not decide whether an operation is permitted.
7. **Reconciliation is not a risk authority.** Reconciliation verifies financial consistency and does not evaluate customer risk.

## 4. Source evidence versus decision output

### Source evidence

Source evidence is an owned record of a fact, assessment, restriction, review, or configuration. Examples include:

- Onboarding completion and approval state.
- P1.3 eligibility status.
- Active restrictions.
- Customer limit configuration.
- Product enrollment and permission records.
- P1.10 manual risk assessment and factor history.
- Compliance case status, assignment, comments, and evidence metadata.
- Customer and account lifecycle state.

Source evidence:

- Has its own owner and lifecycle.
- Is persisted and audited by its owning domain.
- Is not silently overwritten by policy evaluation.
- May become stale and therefore carries version, timestamp, or review-due information.

### Decision output

A future A4 policy decision is an evaluated result for a defined subject, capability, action, and time. It should contain:

- Customer UUID.
- Requested capability or action.
- Decision: `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, or `SUSPEND`.
- Policy version.
- Evaluation timestamp.
- Expiry or review timestamp where applicable.
- Reason codes and human-readable explanation.
- Source evidence references and versions.
- Required obligations or next actions.

A policy decision:

- Is not a replacement for eligibility, risk, or compliance records.
- Must be reproducible from referenced source versions.
- Must not mutate the evidence it evaluated.
- Must be consumed by a financial or product command boundary only after authorization.

## 5. State precedence scenarios

These scenarios define A4 input and precedence requirements. They do not implement behavior in A1T06.

| Scenario                                    | Source state                                                       | Required policy interpretation                                         | Decision requirement                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Customer does not exist or is deleted       | No valid customer source                                           | No customer decision can be made                                       | `DENY` or no decision; never `ALLOW`.                                                                          |
| Onboarding incomplete                       | Onboarding is not `COMPLETED`                                      | Customer Foundation is incomplete                                      | Block activation-dependent capabilities; preserve the onboarding state.                                        |
| Eligibility pending                         | Eligibility is `PENDING`                                           | Current eligibility is unresolved                                      | `PENDING_REVIEW`; do not infer eligibility from a low risk score.                                              |
| Eligibility ineligible/revoked              | Eligibility is `INELIGIBLE` or `REVOKED`                           | Current eligibility blocks capability                                  | `DENY` for activation-dependent actions.                                                                       |
| Active BLACKLISTED restriction              | Restriction is `BLACKLISTED`                                       | Highest-severity blocking restriction                                  | `DENY`; no later low-risk evidence silently overrides it.                                                      |
| Active FROZEN restriction                   | Restriction is `FROZEN`                                            | Customer/account operations are restricted                             | `SUSPEND` or `DENY` according to the capability policy; do not automatically delete or rewrite source records. |
| Active MANUAL_REVIEW or LIMITED restriction | Restriction requires controlled handling                           | Capability may require review or constrained limits                    | `PENDING_REVIEW` or `ALLOW_WITH_LIMITS`; policy version must explain the result.                               |
| P1.10 CRITICAL risk                         | Current assessment is `CRITICAL`                                   | High-risk evidence requires an explicit policy decision                | Default safe outcome is `PENDING_REVIEW` or `DENY` until an approved policy specifies otherwise.               |
| Legacy `PROHIBITED` risk metadata           | P1.3/onboarding-era source contains `PROHIBITED`                   | Vocabulary does not directly equal P1.10 `CRITICAL`                    | A4 must define an explicit mapping; do not silently equate the values.                                         |
| Assessment review due date passed           | P1.10 evidence is stale                                            | Current risk evidence requires reassessment                            | `PENDING_REVIEW` until a valid current assessment exists.                                                      |
| Open high/critical compliance case          | Case status is open with high/critical severity                    | Review work is unresolved                                              | Policy may deny or require review; case creation alone must not be treated as an automated screening result.   |
| Resolved compliance case                    | Case is `RESOLVED` or `CLOSED`                                     | Historical evidence remains relevant but is not automatically blocking | Policy evaluates case resolution, age, evidence, and applicable product rule.                                  |
| Conflicting sources                         | Eligibility eligible but blacklist/frozen/critical evidence exists | No source may be silently discarded                                    | Conservative result is `PENDING_REVIEW` or `DENY` until A4 precedence is approved.                             |
| Low risk but missing factors/evidence       | Assessment is incomplete                                           | Low score is not sufficient evidence                                   | `PENDING_REVIEW`; source completeness is a prerequisite.                                                       |
| Customer closed                             | Customer lifecycle is `CLOSED`                                     | Customer is not operationally active                                   | `DENY` for activation and financial capabilities.                                                              |

## 6. A4 policy-engine input package

A4 should receive a normalized, read-only input package rather than querying arbitrary tables or embedding domain rules in financial services.

### Input envelope

```text
PolicyDecisionRequest
  customerId
  capability
  action
  requestedAt
  actorContext
  correlationId
  sourceEvidence
```

### Source evidence envelope

```text
sourceEvidence
  customer
    status
    version
    updatedAt
  onboarding
    status
    version
    completedAt
    approvalDecision
  eligibility
    status
    version
    statusChangedAt
  restrictions[]
    type
    active
    version
    reason
  limits
    profileVersion
    currency
    configuredLimits
  productEnrollment
    product
    status
    version
  permissions[]
    type
    enabled
    version
  riskAssessment
    profileVersion
    status
    overallRiskLevel
    assessmentDate
    reviewDueDate
    factors[]
    evidenceFreshness
  complianceCases[]
    category
    severity
    status
    assignedTo
    resolution
    updatedAt
  accountBinding
    bindingStatus
    accountReference
    currency
```

### Required output contract

```text
PolicyDecision
  customerId
  capability
  action
  decision
  policyVersion
  evaluatedAt
  expiresAt
  reasonCodes[]
  explanation
  sourceReferences[]
  obligations[]
```

### A4 constraints

- A4 reads source evidence through approved contracts.
- A4 does not own customer identity, onboarding, eligibility, restrictions, risk assessments, or compliance cases.
- A4 does not perform AML screening, sanctions screening, fraud detection, transaction monitoring, or machine learning.
- A4 does not post journals or mutate balances.
- A4 must record enough source versions to reproduce a decision.
- A4 must not make a decision from a single risk factor without the approved policy definition.

## 7. Data and audit observations

- P1.3 risk/eligibility and P1.10 risk-assessment records are sensitive customer and compliance data.
- Compliance case comments and evidence references may contain sensitive investigative information.
- Risk factors may contain sensitive reasoning and must not be exposed through generic financial APIs.
- Policy outputs should minimize source data and expose references/reasons rather than entire evidence payloads.
- Audit records must identify the source versions used for future decisions without copying unnecessary sensitive data.
- Retention, legal hold, and privileged access are A1/A2/A6 decisions, not A1T06 runtime work.

## 8. Required future decisions

A4 must decide:

1. Canonical risk-level mapping between legacy `PROHIBITED` and P1.10 `CRITICAL`.
2. Precedence between blacklist, frozen, manual-review, ineligible, and critical-risk states.
3. Whether stale risk assessments block every capability or only selected capabilities.
4. Which compliance-case categories and severities create pending review versus denial.
5. Whether limits are evaluated by A4 or by a downstream financial command boundary.
6. Which policy decisions require approval, expiration, or re-evaluation.
7. How decision explanations are exposed to support, customers, and operators.
8. How historical policy decisions are reproduced after source records change.

## 9. A1T06 acceptance evidence

A1T06 is complete when:

- P1.10 is identified as the preferred manual assessment evidence authority.
- P1.3 remains the current source of eligibility and restrictions until A4.
- Compliance cases are explicitly not treated as AML, sanctions, or fraud engines.
- Evidence records and policy outputs are clearly separated.
- Contradictory-state scenarios are documented.
- No automated screening or policy engine is implemented.
