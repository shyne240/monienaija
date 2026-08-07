# ADR-0039: Customer-Visible Decision Reasons

- **Status:** Proposed A4 decision input; no public route or runtime exposure
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Product, Customer Engineering, Support, Operations, Risk, Compliance, Security, Finance, and Privacy/Data owners
- **Scope:** Audience-specific, read-only explanation of immutable A4 policy decisions
- **Task:** A4T08 — Explainability, Decision Reasons, and Consumer Read Contract
- **Implementation status:** A4T08 implementation uses a read-only explanation service; no controller, API route, persistence, migration, financial execution, or route exposure is introduced

## Context

A4T07 produces deterministic policy results containing:

- customer/capability/action;
- policy profile/version and definition hash;
- decision and internal reason codes;
- obligations and exact policy limits;
- A4T03 snapshot/policy evidence references and freshness summary;
- request/correlation context; and
- A4T06 hashes and immutable decision references.

The raw A4T07 result is not suitable for every audience. Risk and compliance reason codes, source IDs, binding references, policy hashes, and operational context can expose sensitive evidence or internal control details. At the same time, a customer needs a truthful explanation, support needs a safe troubleshooting view, Operations needs provenance, and internal services need a stable machine contract.

## Decision

### 1. Single read-only explanation boundary

A4 owns one read-only explanation boundary that transforms an immutable `PolicyDecisionResult` into an audience-specific `PolicyExplanationResult`.

The explanation service:

- never changes the underlying decision;
- never re-evaluates policy;
- never re-reads or mutates source evidence;
- never creates a new decision, policy version, snapshot, or financial state;
- never exposes an audience with more data than its policy; and
- never becomes a controller or route by merely existing.

The service consumes A4T07 output and preserves A4T06 policy/snapshot/result references according to the audience policy.

### 2. Supported audiences

| Audience            | Purpose                                                           | Allowed information                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CUSTOMER`          | Truthful customer-facing explanation after A2 authorization       | Decision, capability/action, policy version, evaluation/review times, safe reason codes/messages, safe obligations, and exact policy limits where appropriate.                                             |
| `CUSTOMER_SUPPORT`  | Assigned support investigation and customer communication         | Customer-safe reasons plus controlled support metadata, decision/provenance references, freshness summaries, safe obligations, and limits. No raw risk/compliance evidence.                                |
| `OPERATIONS`        | Internal operational diagnostics and release/support traceability | Internal reason codes, decision/profile/snapshot hashes and references, safe source references/versions/freshness, obligations, limits, request context, and collection state. No normalized raw evidence. |
| `INTERNAL_SERVICES` | Approved internal service-to-service consumption                  | Stable internal reason codes, policy/profile/snapshot references, source references/versions/freshness, obligations, limits, and deterministic provenance. No credentials or unrestricted source payloads. |

A2 remains responsible for authenticating and authorizing access to each audience. This ADR defines filtering after an authorized caller has been admitted; it does not implement route policy.

### 3. Reason-code ordering

Reason codes are deduplicated and sorted deterministically before audience mapping:

```text
IDENTITY
CUSTOMER
ONBOARDING
ELIGIBILITY
RESTRICTION
LEGACY_RISK
RISK
COMPLIANCE
ENROLLMENT
PERMISSION
BINDING
ACCOUNT
RECONCILIATION
LIMIT
EVIDENCE
CAPABILITY
then lexical code order within a category
```

The order is independent of database row order, JSON property order, transport IDs, or caller presentation. Audience mapping occurs after internal ordering and deduplication so equivalent hidden reasons cannot produce nondeterministic output.

### 4. Customer filtering

Customer output must:

- map internal risk, compliance, restricted restriction, and control reasons to safe generic reason codes;
- never expose raw risk levels, factor values, assessor details, case numbers, case severity, comments, evidence references, credentials, device data, or authorization details;
- omit source references and internal snapshot/profile/definition hashes;
- omit internal A2 recheck obligations or map them to a safe next-action only where customer communication requires it;
- expose only exact policy limits/remaining values that the approved product contract permits; and
- use static message keys or bounded safe explanations, never a raw A4T07 explanation string supplied by an untrusted source.

Examples of safe mappings:

| Internal reason family                                   | Customer reason code         |
| -------------------------------------------------------- | ---------------------------- |
| `RISK_*`, `LEGACY_RISK_*`, `COMPLIANCE_*`, manual review | `ADDITIONAL_REVIEW_REQUIRED` |
| Active blacklist/terminal policy block                   | `CAPABILITY_NOT_AVAILABLE`   |
| Frozen or explicit suspension                            | `CAPABILITY_SUSPENDED`       |
| Onboarding not complete                                  | `ONBOARDING_REQUIREMENT`     |
| Enrollment missing/closed                                | `ENROLLMENT_REQUIRED`        |
| Permission missing/disabled                              | `PERMISSION_REQUIRED`        |
| Binding/account/reconciliation issue                     | `ACCOUNT_REVIEW_REQUIRED`    |
| Limit exceeded                                           | `LIMIT_EXCEEDED`             |
| Current constrained allow                                | `CAPABILITY_LIMITED`         |

These codes explain the customer-visible outcome without exposing the source evidence that caused it.

### 5. Support filtering

Customer Support output may include:

- stable support-safe reason codes and message keys;
- decision, policy version, decision reference, profile reference/version, and request/correlation context;
- source class/type and freshness state; and
- safe obligations and exact policy limits.

Support output must not include:

- raw risk/compliance reason codes where they disclose restricted evidence;
- source IDs or references for Highly Restricted risk/compliance/authorization classes;
- raw normalized snapshot values;
- credentials, tokens, MFA/device data, or privileged approval material; or
- internal policy definition payloads.

### 6. Operations and Internal Services filtering

Operations and approved Internal Services may receive:

- original deterministic internal reason codes;
- decision/profile/policy/snapshot references and hashes;
- safe source IDs, versions, classifications, and freshness states;
- collection status and freshness summary;
- obligations and limits, including safe internal limit references; and
- request/correlation/trace/causation context.

They must not receive:

- raw normalized evidence values unless a separate classified source contract explicitly authorizes them;
- raw compliance comments/evidence or risk notes/factor remarks;
- credentials, tokens, MFA proofs, device fingerprints, or privileged action fingerprints; or
- a capability to write back to source records.

### 7. Obligations and limits

Obligations are filtered by audience, deduplicated, and ordered with required obligations first and then lexical code order.

- Customer: expose safe next-action obligations; hide internal A2/A3 references and raw obligation references.
- Customer Support: expose safe support obligations without restricted source references.
- Operations/Internal Services: preserve machine-readable obligation codes and approved references.

Limits are copied from the immutable A4T07 result, never recomputed:

- customer/support may receive currency, configured amount/count, period, and remaining values when approved;
- operations/internal services may also receive safe `limitReference`; and
- no audience receives a balance source, journal line, credential, or raw evidence payload through the explanation contract.

### 8. Immutable provenance

The explanation result may expose only the provenance permitted by its audience:

```text
customer:
  no internal decision/snapshot/source references

customer support:
  decision/profile/snapshot references and safe freshness metadata

operations/internal services:
  decision/profile/snapshot references, hashes, source references,
  versions, freshness, collection status, and request context
```

The explanation service must preserve the original `policyVersion`, `decisionReference`, `normalizedInputHash`, and `resultHash` where the audience policy permits them. It must not create a new hash that could be mistaken for a new policy decision.

### 9. Sensitive-data rules

- Explanation messages are selected from a static safe catalogue; raw source reason text is never interpolated.
- A source reference is not the same as raw evidence, but Highly Restricted source IDs remain hidden from customer and support audiences.
- Policy/profile/snapshot hashes are operational provenance, not customer-facing content by default.
- The explanation result contains no `normalizedValue` field.
- A2 authorization is required before any audience-specific result is returned through a future route.
- The service is read-only and cannot call repair, recovery, source mutation, or financial execution paths.

## Alternatives considered

### Return raw A4T07 reason codes to customers

Rejected. Risk, compliance, restriction, account, and internal control reasons can expose sensitive evidence and are not customer-safe explanations.

### Create a separate explanation record in customer metadata

Rejected. Explanation is a read projection of an immutable decision. Customer metadata must not become a policy or decision source.

### Let support receive the full evidence snapshot

Rejected. Support needs a purpose-bound minimized view; raw risk/compliance/KYC/security data requires separate source-owner access and A2 controls.

### Generate a new decision while explaining an old decision

Rejected. A4T08 must preserve the immutable A4T07 result and A4T06 provenance. Re-evaluation belongs to A4T09.

### Expose a route from the explanation service by default

Rejected. A2 owns route and audience authorization. A4T08 creates only a read-only service contract.

## Consequences

### Positive

- Customers receive truthful explanations without restricted source disclosure.
- Support can troubleshoot with safe provenance instead of broad evidence exports.
- Operations and internal services retain deterministic machine-readable context.
- Explanation mapping cannot alter policy outcomes or source authorities.
- A4T06 replay/reference hashes remain linked to the original result.

### Trade-offs

- Multiple audience contracts require a maintained reason/obligation catalogue.
- Support and operations still need A2 purpose-bound access to any deeper source investigation.
- A customer-safe reason may be less specific than the internal source condition.
- Future route exposure requires a separate A2/data-classification decision.

## Dependencies and references

- [`A4-IMPLEMENTATION-PLAN.md`](../A4-IMPLEMENTATION-PLAN.md)
- [`A4-POLICY-BASELINE.md`](../A4-POLICY-BASELINE.md)
- [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](../A4-POLICY-REQUEST-RESULT-CONTRACT.md)
- [`A4-POLICY-PERSISTENCE-CONTRACT.md`](../A4-POLICY-PERSISTENCE-CONTRACT.md)
- [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](../A4-NORMALIZED-EVIDENCE-SNAPSHOT.md)
- [`A4-POLICY-PRECEDENCE-MATRIX.md`](../A4-POLICY-PRECEDENCE-MATRIX.md)
- [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR-0036-Customer-Capability-Policy-Authority.md)
- [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md)
- [`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md)
- [`A2-SECURITY-DATA-PROTECTION-CHECKLIST.md`](../A2-SECURITY-DATA-PROTECTION-CHECKLIST.md)

## A4T08 verification record

- [x] Audience-specific outputs are defined for Customer, Customer Support, Operations, and Internal Services.
- [x] Deterministic internal reason-code ordering and deduplication are implemented.
- [x] Customer-safe and support-safe reason mappings do not expose sensitive risk/compliance/security evidence.
- [x] Obligations and limits are filtered by audience and remain read-only.
- [x] Policy version, snapshot, source, and result provenance is preserved only according to audience policy.
- [x] Explanation output contains no normalized source values or raw A4T07 explanation text.
- [x] A2 remains the access/route authority and A4T08 introduces no route.
- [x] A4T09 re-evaluation, expiry, retry, and recovery workflows remain out of scope.
