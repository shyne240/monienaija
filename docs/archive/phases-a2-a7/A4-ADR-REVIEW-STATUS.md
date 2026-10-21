# A4 ADR Review Status

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T10 — A4 Integration, Reconciliation, and Release Gate
- **Status:** Review register prepared; formal approval pending
- **Classification:** Documentation-only ADR review evidence
- **Application, database, API, migration, scheduler, and financial-runtime changes in this task:** None

## 1. Review rule

A4T10 reviews ADR-0036 through ADR-0040 against the committed A4T01-A4T09 artifacts. “Implementation-aligned” means that the current source/tests preserve the documented boundary. It does not mean an ADR is approved for production.

No signature, owner approval, risk acceptance, live migration result, or production activation is fabricated in this register.

## 2. A4 ADR register

| ADR                                                                                                                                 | Decision                                                                                                                                                                                  | Committed implementation alignment                                                                                                                                           | Current status                                      | Open review condition                                                                                                                                   | Accountable owners                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [ADR-0036 — Customer Capability Policy Authority](ADR/ADR-0036-Customer-Capability-Policy-Authority.md)                             | A4 is the single authority for action-specific, versioned capability policy decisions; `Customer.id`, A2, A3, Wallet, Ledger, Operations, and Reconciliation remain separate authorities. | `src/policy/capability-policy.types.ts`, profile registry, evaluator, explanation, recovery contracts, and tests use the declared subject/authority separation.              | Proposed / implementation-aligned                   | Formal Architecture, Product, Risk, Security, A2/A3, Wallet/Ledger, Operations, and Reconciliation review.                                              | Architecture / Product / Risk / Security / Finance / Operations |
| [ADR-0037 — Risk, Restriction, Compliance, and Limit Precedence](ADR/ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md)  | Strictness order is `DENY > SUSPEND > PENDING_REVIEW > ALLOW_WITH_LIMITS > ALLOW`; degraded/conflicting evidence fails closed.                                                            | `CapabilityPolicyEvaluationService` aggregates all candidate outcomes; recovery evidence validation prevents stale/conflicting/unavailable evidence from producing an allow. | Proposed / implementation-aligned                   | Confirm capability-specific exceptions, legacy `PROHIBITED` treatment, stale windows, compliance-case interpretation, and formal owner approval.        | Architecture / Risk / Compliance / Product / Finance            |
| [ADR-0038 — Product Eligibility and Limit Enforcement Contract](ADR/ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md) | Profiles declare enrollment, permission, A3, risk/compliance, and exact limit boundaries; A4 does not own execution-time usage.                                                           | `capability-policy.profiles.ts`, evaluator limit checks, obligations, and profile/recovery tests implement the declared service-level boundary.                              | Proposed / implementation-aligned                   | Approve static profile set, profile lifecycle, validity intervals, source-owned limit configuration, usage provenance, and downstream command boundary. | Product / Risk / Finance / Wallet / Ledger / Operations         |
| [ADR-0039 — Customer-Visible Decision Reasons](ADR/ADR-0039-Customer-Visible-Decision-Reasons.md)                                   | Explanations are read-only, audience-specific, minimized, and redacted; A2 owns route/audience authorization.                                                                             | `capability-policy-explanation.service.ts` and explanation tests cover Customer, Customer Support, Operations, and Internal Services filtering. No route is registered.      | Proposed / implementation-aligned                   | Security/Privacy review of reason catalogue, source classification, support access, customer messages, and any future route.                            | Security / Privacy/Legal / Support / Operations / Product       |
| [ADR-0040 — Policy Versioning and Reproducibility](ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md)                           | Profile/decision/snapshot history is immutable, hash-linked, replayable, append-only, retained, and separate from source/financial truth.                                                 | A4T06 entities, repositories, immutable snapshot/decision migration, hash/lineage/replay support, retention metadata, and Operations adapters are present.                   | Proposed / implementation-aligned; approval pending | Live migration/rollback, retention schedule, legal holds, and formal owner review remain open.                                                          | Architecture / Operations / Database / Privacy/Legal / Finance  |

## 3. Governing cross-review

| Governing input                                                                                                                       | A4 dependency check                                                                                               | Current status                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [ADR-0021 — Canonical Customer Model and Ownership Rules](ADR/ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md)        | A4 uses `Customer.id` as canonical identity and does not promote metadata/projections to source authority.        | Alignment recorded; formal upstream governance remains pending where applicable. |
| [ADR-0022 — Risk, Compliance, and Eligibility Decision Authority](ADR/ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md) | A4 consumes source evidence and does not create AML/sanctions/fraud/screening engines or rewrite source records.  | Alignment recorded; Risk/Compliance owner review remains required.               |
| [ADR-0023 — Customer Identifier and Reference Conventions](ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md)             | References, aliases, provider IDs, case numbers, request IDs, and idempotency keys remain non-canonical.          | Alignment recorded; owner approval remains pending.                              |
| [ADR-0024 — Customer Data Classification, Retention, and Privacy](ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md) | A4 snapshots/decisions/explanations minimize and classify risk, compliance, security, and financial-control data. | Security/Privacy/Legal review remains pending.                                   |
| [A3-A4 handoff package](A3-A4-HANDOFF-PACKAGE.md)                                                                                     | A4 treats A3 binding/read/control evidence as read-only input and never infers or repairs account identity.       | A3 approval and handoff conditions remain pending.                               |
| [A2 route and rollback evidence](A2-ROUTE-EXPOSURE-AND-ROLLBACK.md)                                                                   | No A4 route is exposed without A2 route/data-exposure approval.                                                   | No A4 route exists; future approval required.                                    |
| [Cross-cutting contracts](CROSS-CUTTING-CONTRACTS.md)                                                                                 | A4 uses Operations audit/idempotency/diagnostic ports and retains independent Reconciliation ownership.           | Production adapter wiring and phase approval remain pending.                     |

## 4. Cross-document consistency checks

- [x] A4 authority is distinct from Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A2, A3, Wallet, Ledger, Operations, and Reconciliation authorities.
- [x] `Customer.id` is the canonical subject in the A4 request/result/runtime types.
- [x] The A4 decision vocabulary is bounded and the strictness order is consistent across A4T04, A4T07, A4T08, and A4T09.
- [x] Profile, snapshot, decision, explanation, and recovery references preserve policy/source/result linkage without copying raw evidence.
- [x] A2 authorization, A4 policy eligibility, A3 binding, Ledger financial truth, and downstream execution remain separate.
- [x] Expiry, review due, stale/conflicting/unavailable evidence, retry, idempotency, unknown outcome, and supersession behavior are represented in A4T09.
- [x] Customer/support/operator/internal explanation filtering is consistent with ADR-0039 and A2 data-exposure ownership.
- [x] No A4 source writer, route, scheduler, financial command, external provider, outbox consumer, or A5 implementation is introduced by A4T10.
- [x] The current source/test validation record is linked in [`A4-INTEGRATION-MATRIX.md`](A4-INTEGRATION-MATRIX.md).
- [ ] ADR-0036 through ADR-0040 are approved by accountable owners.
- [x] Physical A4T06 persistence entities, repositories, migration, retention metadata, and replay artifacts are implemented.
- [ ] Physical A4T06 migration application/rollback and durable production activation are reviewed.
- [ ] Security/privacy/retention/legal-hold review is approved.
- [ ] A2/A3 entry and phase approvals are recorded.

## 5. Review disposition

**Recommendation:** `PENDING — IMPLEMENTATION-ALIGNED, NOT APPROVED FOR PRODUCTION ACTIVATION.`

A4T10 records the evidence and unresolved decisions. It does not convert Proposed ADRs into approved production policy, and it does not authorize A5 implementation.
