# A4 Capability & Policy Engine Approval Package

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T10 — A4 Integration, Reconciliation, and Release Gate
- **Status:** Prepared for accountable-owner approval; **not approved**
- **Classification:** Documentation-only approval and release evidence
- **Application, database, API, migration, scheduler, and financial-runtime changes in this task:** None

## 1. Executive summary

A4 provides a single action-specific capability policy boundary over canonical Customer, onboarding, eligibility, restriction, limit, enrollment, permission, risk, compliance, A2, A3, Wallet, Ledger, Operations, and Reconciliation evidence.

The committed implementation evidence includes:

- A4 authority, request/result, source snapshot, precedence, profile, persistence/replay, explanation, and recovery contracts;
- deterministic policy evaluation with bounded decision states;
- exact limit and obligation output without usage/balance mutation;
- audience-specific explanation redaction;
- expiry, current-effective lookup, stale/conflicting/unavailable evidence handling;
- append-only re-evaluation, policy supersession, bounded retry, idempotency, unknown-outcome verification, audit, and diagnostics; and
- integration, route/rollback, operational recovery, ADR review, exit, and A5 handoff evidence in this package.

The package is **not an A4 approval**. Physical A4T06 persistence, production Operations/source adapters, live deployment/rollback evidence, security/privacy/retention review, upstream A2/A3 approvals, and accountable owner decisions remain open.

A4 does not begin A5, expose a route, create financial value, change source records, run a scheduler, call providers, or publish an external event.

## 2. Evidence index

| Evidence                                                                                                                               | Purpose                                                                                       | Current status                         |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------- |
| [`A4-IMPLEMENTATION-PLAN.md`](A4-IMPLEMENTATION-PLAN.md)                                                                               | Canonical A4 task order, dependencies, acceptance, and phase boundary                         | Source of truth                        |
| [`A4-INTEGRATION-MATRIX.md`](A4-INTEGRATION-MATRIX.md)                                                                                 | A4T01-A4T09 integration trace, capability mapping, test/replay/no-mutation evidence           | Prepared                               |
| [`A4-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A4-ROUTE-EXPOSURE-AND-ROLLBACK.md)                                                               | No-route decision, future deployment sequence, disable and rollback controls                  | Prepared; deployment pending           |
| [`A4-ADR-REVIEW-STATUS.md`](A4-ADR-REVIEW-STATUS.md)                                                                                   | ADR-0036 through ADR-0040 implementation alignment and open review                            | Prepared; approval pending             |
| [`A4-OPERATIONAL-RECOVERY-RUNBOOK.md`](A4-OPERATIONAL-RECOVERY-RUNBOOK.md)                                                             | Operations, Support, Security, A2, A3, Ledger, Reconciliation, and incident recovery evidence | Prepared; owner review pending         |
| [`A4-EXIT-CHECKLIST.md`](A4-EXIT-CHECKLIST.md)                                                                                         | Acceptance criteria, validation, blockers, and phase-exit result                              | Prepared; not approved                 |
| [`A4-A5-HANDOFF-PACKAGE.md`](A4-A5-HANDOFF-PACKAGE.md)                                                                                 | Permitted A4 output, consumer gates, prohibited edges, and A5 entry conditions                | Prepared; handoff blocked              |
| [`A4-POLICY-BASELINE.md`](A4-POLICY-BASELINE.md)                                                                                       | A4T01 ownership and local decision-surface baseline                                           | Prepared                               |
| [`A4-SOURCE-EVIDENCE-MATRIX.md`](A4-SOURCE-EVIDENCE-MATRIX.md)                                                                         | Source owner, minimum read fields, freshness, classification, and unsafe conditions           | Prepared                               |
| [`A4-CAPABILITY-INVENTORY.md`](A4-CAPABILITY-INVENTORY.md)                                                                             | Candidate capability/action and current input inventory                                       | Prepared                               |
| [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR/ADR-0036-Customer-Capability-Policy-Authority.md)                             | A4 authority and identity boundary                                                            | Proposed; implementation-aligned       |
| [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR/ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md)     | Normative precedence and conflict behavior                                                    | Proposed; implementation-aligned       |
| [`ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md`](ADR/ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md) | Profile, enrollment, permission, and limit boundary                                           | Proposed; implementation-aligned       |
| [`ADR-0039-Customer-Visible-Decision-Reasons.md`](ADR/ADR-0039-Customer-Visible-Decision-Reasons.md)                                   | Audience-specific explanation and privacy boundary                                            | Proposed; implementation-aligned       |
| [`ADR-0040-Policy-Versioning-and-Reproducibility.md`](ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md)                           | Immutable history, replay, retention, and lineage contract                                    | Proposed; physical persistence pending |
| `src/policy/capability-policy*.ts`                                                                                                     | A4T07/T08 runtime contract/evaluator/explanation implementation                               | Implemented/tested at service boundary |
| `src/policy/capability-policy-recovery*.ts`                                                                                            | A4T09 currentness/re-evaluation/recovery implementation                                       | Implemented/tested at service boundary |
| `test/capability-policy*.spec.ts`                                                                                                      | Policy, explanation, and recovery test evidence                                               | Passed                                 |
| [`A3-A4-HANDOFF-PACKAGE.md`](A3-A4-HANDOFF-PACKAGE.md)                                                                                 | A3 account/binding inputs and prohibited edges                                                | Upstream approval pending              |
| [`A2-SECURITY-DATA-PROTECTION-CHECKLIST.md`](A2-SECURITY-DATA-PROTECTION-CHECKLIST.md)                                                 | A2 security/privacy input boundary                                                            | Upstream review pending                |

## 3. Decisions requested from accountable owners

Owners are asked to approve, return with conditions, or reject the following decisions:

1. A4 is the single action-specific capability policy authority and does not replace source, A2, A3, Wallet, Ledger, Operations, or Reconciliation authority.
2. `Customer.id` remains the canonical customer subject and non-canonical references remain prohibited as identity.
3. The A4T02 decision vocabulary, policy version, source snapshot, result hash, expiry/review, reason, obligation, and consumer contracts are acceptable.
4. A4T04 strictness, conflict, stale, restricted, unavailable, legacy-risk, compliance-case, A3, and limit behavior is acceptable.
5. A4T05 profile mappings, exact minor-unit/currency limit rules, enrollment/permission boundary, and downstream usage enforcement separation are acceptable.
6. A4T06 immutability, lineage, replay, retention, privacy, and legal-hold requirements are acceptable before physical persistence is introduced.
7. A4T07 deterministic evaluation, A2 separation, no-source-mutation, and no-financial-side-effect behavior is acceptable.
8. A4T08 audience filtering and sensitive-evidence redaction are acceptable for any future authorized consumer.
9. A4T09 expiry, re-evaluation, recovery, retry, idempotency, conflict, unknown-outcome, and diagnostic controls are acceptable.
10. The current service/contract implementation should remain internal and unexposed until the A4 route/data-exposure and physical persistence gates are approved.
11. A4 may prepare the A5 handoff, but no A5 financial command or activation may begin from this package alone.

## 4. Owner approval register

The package does not fabricate signatures, approvals, dates, or risk acceptance.

| Owner/review                   | Required decision                                                                                | Approver | Decision/date | Conditions/comments                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | -------- | ------------- | -------------------------------------------------------------------------- |
| Architecture                   | A4 authority, policy/profile versioning, precedence, boundaries, and phase exit                  | Pending  | Pending       | Review ADR-0036 through ADR-0040 and unresolved persistence/TTL conditions |
| Product                        | Capability profile set, product/enrollment mapping, customer-facing outcome semantics            | Pending  | Pending       | Confirm profile scope and no product activation in A4                      |
| Risk                           | Risk evidence vocabulary, stale/review-due behavior, critical/high review, profile validity      | Pending  | Pending       | Confirm no automated screening is implied                                  |
| Compliance                     | Compliance case interpretation, review outcomes, evidence classification                         | Pending  | Pending       | Confirm case state is not screening output                                 |
| Security                       | A2 separation, principal/audience access, route exposure, privileged recovery, incident controls | Pending  | Pending       | Approve no-route/default-deny posture and future exposure gates            |
| Privacy/Legal                  | Data minimization, classification, retention, legal holds, customer/support disclosures          | Pending  | Pending       | Approve A4 snapshot/decision/explanation handling                          |
| Operations                     | Audit/idempotency/diagnostics/recovery support and production adapter ownership                  | Pending  | Pending       | Approve recovery runbook, retention split, and unknown-outcome handling    |
| Customer Engineering / Support | Customer/support explanations and support operating model                                        | Pending  | Pending       | Approve safe reason/obligation catalogue and access scopes                 |
| Wallet / A3                    | Binding/account state as read-only policy evidence and A5 handoff boundary                       | Pending  | Pending       | Upstream A3 approval and route/read conditions required                    |
| Ledger / Finance               | Financial dimensions, Ledger-derived values, no balance/journal mutation, reconciliation gate    | Pending  | Pending       | Confirm A4 never becomes financial authority                               |
| Reconciliation                 | Independent read-only control evidence and no-repair boundary                                    | Pending  | Pending       | Confirm unresolved control states fail closed                              |
| Production / Release           | Deployment, disable, rollback, migration, readiness, incident ownership                          | Pending  | Pending       | No A4 activation until physical/runtime conditions are approved            |
| A5 owner                       | Handoff inputs, downstream gates, prohibited edges                                               | Pending  | Pending       | Handoff remains blocked until A4/A2/A3 approvals                           |

## 5. Security and privacy review evidence

A4 security/privacy review consumes the existing A1/A2 controls and applies them to policy snapshots, decision records, explanations, recovery diagnostics, and future audience access.

| Review area                    | Required A4 control                                                                                                                                              | Evidence                                                                                                                                                                                                                                                                                           | Current status                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Canonical identity             | Store/use only `Customer.id` as policy subject; keep references, aliases, provider IDs, case numbers, request IDs, and idempotency keys typed and non-canonical. | [`A4-POLICY-BASELINE.md`](A4-POLICY-BASELINE.md), [`ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md)                                                                                                                     | Implemented/aligned; owner approval pending                 |
| Risk/compliance minimization   | Keep risk/compliance values minimized, classified, and reference-based; never copy raw notes/comments or treat cases as screening output.                        | [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](A4-NORMALIZED-EVIDENCE-SNAPSHOT.md), [`ADR-0039-Customer-Visible-Decision-Reasons.md`](ADR/ADR-0039-Customer-Visible-Decision-Reasons.md)                                                                                                                   | Implemented/aligned; Risk/Compliance/Privacy review pending |
| A2 security data               | Exclude passwords, tokens, recovery values, MFA proofs, device fingerprints, privileged fingerprints, and authorization secrets from A4 payloads.                | [`A2-SECURITY-DATA-PROTECTION-CHECKLIST.md`](A2-SECURITY-DATA-PROTECTION-CHECKLIST.md), [`A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md`](A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md)                                                                                                                         | Boundary aligned; A2 approval pending                       |
| Audience filtering             | Customer/Support/Operations/Internal Services receive only approved reason, source, provenance, obligation, and limit fields.                                    | `src/policy/capability-policy-explanation.service.ts`, `test/capability-policy-explanation.service.spec.ts`                                                                                                                                                                                        | Implemented/tested; future route review pending             |
| Financial-control minimization | Do not copy journal lines, posted value, mutable balances, or account ownership into policy/explanation output.                                                  | [`A3-A4-HANDOFF-PACKAGE.md`](A3-A4-HANDOFF-PACKAGE.md), [`ADR-0040-Policy-Versioning-and-Reproducibility.md`](ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md)                                                                                                                               | Boundary aligned; Finance/Ledger approval pending           |
| Retention and legal holds      | Separate A4 policy/profile/snapshot retention from Operations idempotency retention; preserve holds and lineage.                                                 | [`RETENTION-POLICY.md`](RETENTION-POLICY.md), [`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md), [`ADR-0040-Policy-Versioning-and-Reproducibility.md`](ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md) | Logical contract; schedule/hold approval pending            |
| Incident evidence              | Audit/diagnostic evidence is safe, access-controlled, correlated, and cannot become a source writer or bypass.                                                   | [`A4-OPERATIONAL-RECOVERY-RUNBOOK.md`](A4-OPERATIONAL-RECOVERY-RUNBOOK.md), [`A2-OPERATIONAL-RECOVERY-RUNBOOK.md`](A2-OPERATIONAL-RECOVERY-RUNBOOK.md)                                                                                                                                             | Prepared; Operations/Security/Privacy approval pending      |

Security/privacy review questions remain open until owners record audience access and future route policy, source classifications and restricted-field purpose, snapshot/decision retention and legal-hold behavior, support/operator/internal-service minimization, secret/redaction/incident controls, and any profile-specific expiry, limit, account, or risk data requiring additional classification.

## 6. Open risk and release-condition register

| Risk/condition                                                   | Severity                                   | Owner                                      | Required mitigation / rollback                                                   | Current state                                 |
| ---------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------- |
| A2 approval and protected data-exposure review pending           | Blocker                                    | Security / Architecture / Operations       | Complete A2 approval; keep A4 unexposed until then                               | Open                                          |
| A3 binding/read/reconciliation approval pending                  | Blocker for account-dependent capabilities | Wallet / Ledger / Finance / Reconciliation | Complete A3 approval and handoff conditions                                      | Open                                          |
| ADR-0036 through ADR-0040 formal approval pending                | Blocker for policy governance              | Architecture / decision owners             | Record approve/return decisions and conditions                                   | Open                                          |
| A4T06 physical persistence not implemented                       | Blocker for durable production activation  | A4 / Database / Operations                 | Approve entities/repositories/migrations/retention/replay and migration rollback | Open; logical contract only                   |
| Production Operations adapter wiring not present                 | High                                       | Operations / A4                            | Wire shared audit/idempotency/diagnostics/persistence contracts transactionally  | Open; ports/fakes only                        |
| Production source adapter/snapshot attachment wiring not present | High                                       | A4 / source owners                         | Implement approved minimum-field adapters and immutable attachment retention     | Open; contract/runtime consumer evidence only |
| Profile-specific validity/expiry governance pending              | Medium                                     | Product / Risk / Compliance / Architecture | Approve static validity and future version lifecycle policy                      | Open                                          |
| Security/privacy/support output review pending                   | High                                       | Security / Privacy/Legal / Support         | Approve audiences, classifications, safe reasons, support access, holds          | Open                                          |
| No A4 route approved                                             | High if exposed                            | A2 / Security / Operations                 | Keep services internal; approve route/data contract before exposure              | Safe default; no route exists                 |
| Live deployment/rollback drill absent                            | High                                       | Production / Operations                    | Run controlled canary/disable/rollback after runtime wiring                      | Open                                          |
| A5 handoff prerequisites not approved                            | Blocker for A5                             | Architecture / A5 owners                   | Complete A4 exit and A2/A3 gates; preserve prohibited-edge register              | Blocked                                       |

## 6. Approval outcome rules

- **Approve:** Record accountable owner, date, conditions, evidence references, and follow-up owner.
- **Approve with conditions:** Record each condition, severity, owner, due date, mitigation, and disable/rollback behavior. A condition cannot silently weaken A2/A3/financial/privacy boundaries.
- **Return with comments:** Keep A4 `NOT APPROVED / CONDITIONAL`; record required changes and re-review scope.
- **Reject:** Require a revised or superseding ADR/contract decision before any affected activation.
- **No response:** Remains `PENDING`; no production activation or A5 start is authorized.

## 7. Recommendation and approval result

**Recommendation:** `PENDING — DO NOT ACTIVATE A4 FOR PRODUCTION AND DO NOT BEGIN A5.`

The repository has implementation and automated evidence at the declared service/contract boundary. Approval requires resolution and recording of the open conditions above. This package is a decision input, not a signature or release authorization.
