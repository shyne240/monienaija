# ADR-0022: Risk, Compliance, and Eligibility Decision Authority

- **Status:** Proposed for A1 architecture review
- **Date:** 2026-08-05
- **Decision owners:** Risk, Compliance, Product, Security, Finance, Operations, and Architecture
- **Scope:** Future A4 capability and policy decisions; A1 authority and contract inputs only
- **Task:** A1T11 — Draft ADR-0022 and ADR-0023
- **Implementation status:** Decision input only; no policy engine, screening engine, API, or runtime behavior is implemented

## Context

The Customer Foundation contains several kinds of customer operating evidence:

- Onboarding completion, agreements, tasks, and approval decisions.
- Current eligibility, restrictions, limit configuration, enrollment, and permissions.
- P1.3/onboarding-era risk metadata retained for historical compatibility.
- P1.10 manual risk assessments, factors, review dates, and assessment history.
- P1.9 compliance cases, assignments, comments, evidence metadata, and resolution history.
- Future customer-to-financial-account binding and financial account state.

These records answer different questions. An eligibility record is not a risk assessment, a compliance case is not proof of an automated screening result, and a policy decision is not a replacement for any source record. Without an authority boundary, each financial module could interpret the same evidence differently or treat an operational record as an authorization result.

A1T06 and the canonical ownership matrix establish the evidence owners. A4 needs a single, versioned, explainable decision contract that consumes those sources without taking ownership of them.

## Decision

### 1. Source evidence authority

| Evidence                                                 | Source authority until A4                              | Role in a future decision                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Customer existence, lifecycle, profile/KYC status        | `customer`                                             | Establishes the subject and baseline identity; a deleted/closed customer cannot receive an activation decision.                   |
| Onboarding status and approval evidence                  | `customer-onboarding`                                  | Supplies onboarding completeness and approval evidence; it does not authorize financial execution.                                |
| Eligibility status and restrictions                      | `customer-eligibility`                                 | Remains the current source of eligibility and restriction state until A4 is live.                                                 |
| Limits, enrollment, and operating permissions            | `customer-eligibility`                                 | Supplies configured capability inputs; permissions are not a substitute for A2 principal authorization.                           |
| Manual risk assessments and factors                      | `customer-risk-profile` preferred for new evidence     | Supplies dated, versioned assessment evidence and factor history; a factor alone is not a decision.                               |
| Onboarding-era/P1.3 risk metadata                        | Historical onboarding/eligibility source               | Preserves historical evidence until an explicit mapping to the P1.10 vocabulary is approved.                                      |
| Compliance cases and evidence metadata                   | `customer-compliance`                                  | Records review work and source evidence; case creation alone is not AML, sanctions, fraud, PEP, or transaction-monitoring output. |
| Customer-to-financial-account binding and account status | Future A3 binding / `wallet` / `ledger`                | Supplies account existence, currency, ownership mapping, and financial-state constraints; it does not replace policy authority.   |
| Authentication and authorization context                 | Future A2 identity/access boundary                     | Identifies the principal and permissions for the requested command; it is separate from customer risk evidence.                   |
| Financial execution outcome                              | `ledger` and the respective financial lifecycle domain | Records what happened after an approved command; it cannot retroactively create the policy decision.                              |

A source owner remains responsible for validation, lifecycle, history, retention, and corrections to its records. A4 reads source evidence through approved contracts and records enough versions/references to reproduce a decision.

### 2. Future A4 policy authority

A4 is the future authority for an action-specific capability decision. A decision is valid only for the declared:

- Customer UUID or other approved subject.
- Product/capability and requested action.
- Evaluation time and actor/principal context.
- Policy version.
- Source evidence versions and freshness.
- Decision outcome.
- Expiry or reassessment time where applicable.

The policy result should use a bounded vocabulary such as:

- `ALLOW`
- `ALLOW_WITH_LIMITS`
- `PENDING_REVIEW`
- `DENY`
- `SUSPEND`

The exact vocabulary and customer-facing explanations require A4 product, Risk, Compliance, Security, and Legal review. A1 does not implement the evaluator.

A policy decision must include or reference:

- Stable reason codes and a human-readable explanation.
- Source record IDs, versions, and evidence timestamps.
- Obligations, next actions, or approval requirements.
- Correlation ID and request/command context where a command requested the decision.
- A reproducibility input hash or equivalent evidence snapshot reference where approved.

### 3. Decision precedence inputs

The following precedence constraints are A4 inputs, not an A1 policy engine:

1. No valid customer means no activation decision; never infer `ALLOW` from a reference or stale projection.
2. Incomplete onboarding blocks activation-dependent capabilities until the approved policy says otherwise.
3. Current eligibility and active restrictions remain authoritative source state until A4 produces a decision.
4. `BLACKLISTED`, `FROZEN`, `MANUAL_REVIEW`, and `LIMITED` restrictions must not be silently overridden by low-risk evidence.
5. Stale, incomplete, or contradictory risk evidence requires an explicit policy outcome; a low score is not sufficient evidence.
6. `PROHIBITED` onboarding-era risk metadata and P1.10 `CRITICAL` risk are not silently treated as equivalent. A4 must approve a vocabulary mapping.
7. An open compliance case may require review or a capability-specific block, but case creation alone does not prove an automated screening finding.
8. A policy result must not rewrite eligibility, restrictions, risk assessments, compliance cases, onboarding records, or financial state.
9. Financial commands consume a policy decision only after A2 authorization and A3 account-binding checks applicable to the command.

The detailed state scenarios remain in [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](../RISK-COMPLIANCE-AUTHORITY-REVIEW.md).

### 4. Policy versioning and reproducibility

A future A4 policy version is immutable once used for a decision. A policy change creates a new version and does not rewrite historical decisions. Each decision must be reproducible from:

- Policy version and effective interval.
- Source record identifiers and optimistic/history versions where available.
- Evaluation timestamp and requested capability/action.
- Actor/principal context needed for the decision.
- Normalized input values or a protected evidence snapshot reference.
- Reason and obligation definitions used by that version.

A source record may later change. That does not invalidate a historical decision; it may require a new decision or reassessment according to the policy. Historical decisions are evidence of what the approved policy saw at the time, not current source truth.

### 5. Prohibited policy ownership

A4 must not own or directly write:

- Customer identity, profile, KYC, onboarding, eligibility, restriction, limit, enrollment, permission, risk, or compliance source records.
- Credential hashes, authentication metadata, sessions, or authorization roles.
- Wallet balances, ledger accounts, journals, lines, or reconciliation results.
- Provider callbacks, settlement state, or external screening results without a separately approved adapter boundary.

Financial modules must not embed competing risk, eligibility, restriction, or compliance precedence. They consume the approved policy contract and retain execution authority only for their own lifecycle and the ledger contract.

## Alternatives considered

### Let each financial module evaluate eligibility and risk independently

Rejected. It creates inconsistent decisions, makes policy changes non-deterministic, and prevents reproducible support or compliance investigation.

### Make compliance-case creation an automatic screening result

Rejected. A case is a workflow/evidence record. Automated AML, sanctions, fraud, PEP, and transaction-monitoring capabilities require separate data, provider, model, approval, and operational decisions.

### Replace source records with a policy status column

Rejected. Source evidence and derived decisions have different lifecycles, owners, retention rules, and audit requirements. A policy result must reference evidence rather than overwrite it.

### Use the manual risk score as the policy decision

Rejected. Risk is one evidence source. Capability decisions also require customer lifecycle, onboarding, restrictions, eligibility, limits, enrollment, authorization, account state, and capability-specific rules.

### Permit an unversioned policy result

Rejected. Without a policy version, source versions, and evaluation time, a historical decision cannot be reproduced or explained.

## Consequences

### Positive

- Evidence ownership remains clear while A4 receives one decision contract.
- Policy outcomes are explainable, versioned, and reproducible.
- Financial commands no longer need to interpret source evidence independently.
- Compliance and risk records retain their investigative and evidentiary meaning.
- A2 authorization, A3 account binding, and A5 financial execution remain separate gates.

### Trade-offs

- A4 must maintain an evidence adapter/read contract for multiple source domains.
- Contradictory or stale evidence may produce `PENDING_REVIEW` rather than an immediate answer.
- Policy versioning and historical reproducibility require storage and retention decisions.
- The initial A1 package does not decide every capability-specific precedence rule.

## Dependencies

- **ADR-0001/0003:** domain boundaries and durable, correlated facts.
- **ADR-0004/0005:** ledger authority and independent reconciliation.
- **ADR-0012/0013/0014:** customer, onboarding, eligibility, limits, enrollment, permissions, and restrictions.
- **ADR-0019:** authentication metadata remains separate from runtime access.
- **A1T05:** customer and adjacent ownership decisions.
- **A1T06:** risk, eligibility, and compliance authority review.
- **A1T07:** identifier, privacy, retention, legal-hold, and external-sharing controls.
- **ADR-0021:** canonical domain ownership and prohibited shared writes.
- **A2:** principal authentication and authorization context.
- **A3:** canonical customer-to-financial-account binding.
- **A4:** policy evaluator and versioned decision implementation.
- **A5:** financial commands that consume policy decisions.

## Verification

A1T11 verification for this ADR requires:

- Evidence-owner matrix review against A1T06 and the canonical ownership matrix.
- State-precedence scenario review without adding an automated policy engine.
- Policy input/output and versioning contract review.
- Explicit check that no AML, sanctions, fraud, or transaction-monitoring implementation is included.
- Cross-reference review against ADR-0021, ADR-0023, A4 inputs, and A5 inputs.
