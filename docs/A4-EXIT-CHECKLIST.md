# A4 Exit Checklist

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T10 — A4 Integration, Reconciliation, and Release Gate
- **Status:** Prepared for accountable-owner review; **not approved**
- **Classification:** Documentation-only phase-exit checklist
- **Approval package:** [`A4-APPROVAL-PACKAGE.md`](A4-APPROVAL-PACKAGE.md)
- **Integration matrix:** [`A4-INTEGRATION-MATRIX.md`](A4-INTEGRATION-MATRIX.md)
- **A5 handoff:** [`A4-A5-HANDOFF-PACKAGE.md`](A4-A5-HANDOFF-PACKAGE.md)

## 1. A4 task evidence

| Task  | Required evidence                                                                                              | Current repository evidence                                                                                                                                                                                                                                                | Status                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A4T01 | Baseline, source ownership, freshness, privacy, capability inventory, and A2/A3 handoff inputs                 | [`A4-POLICY-BASELINE.md`](A4-POLICY-BASELINE.md), [`A4-SOURCE-EVIDENCE-MATRIX.md`](A4-SOURCE-EVIDENCE-MATRIX.md), [`A4-CAPABILITY-INVENTORY.md`](A4-CAPABILITY-INVENTORY.md)                                                                                               | Prepared; owner approval pending                                        |
| A4T02 | Authority, capability/action, request/result, A2/A3 separation                                                 | [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR/ADR-0036-Customer-Capability-Policy-Authority.md), [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](A4-POLICY-REQUEST-RESULT-CONTRACT.md)                                                                                 | Prepared; formal ADR approval pending                                   |
| A4T03 | Source adapter and immutable snapshot boundary                                                                 | [`A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md`](A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md), [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](A4-NORMALIZED-EVIDENCE-SNAPSHOT.md), runtime hash consumer                                                                                      | Contract/evaluator evidence prepared; production adapter wiring pending |
| A4T04 | Normative state vocabulary, precedence, conflict, and stale behavior                                           | [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR/ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md), [`A4-POLICY-PRECEDENCE-MATRIX.md`](A4-POLICY-PRECEDENCE-MATRIX.md)                                                                     | Runtime-aligned; formal ADR approval pending                            |
| A4T05 | Capability profiles, enrollment, permissions, A3 requirements, exact limits, and obligations                   | [`ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md`](ADR/ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md), [`A4-CAPABILITY-PROFILE-CONTRACT.md`](A4-CAPABILITY-PROFILE-CONTRACT.md), static profiles                                          | Implemented/tested at service boundary; profile governance pending      |
| A4T06 | Immutable policy version/decision/snapshot persistence and replay contract                                     | [`ADR-0040-Policy-Versioning-and-Reproducibility.md`](ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md), [`A4-POLICY-PERSISTENCE-CONTRACT.md`](A4-POLICY-PERSISTENCE-CONTRACT.md)                                                                                     | Logical contract only; no entities/migrations/repositories              |
| A4T07 | Deterministic evaluator, decision result, A2 authorization, limits, audit/idempotency ports                    | `src/policy/capability-policy.service.ts`, `src/policy/capability-policy.profiles.ts`, [`test/capability-policy.service.spec.ts`](../test/capability-policy.service.spec.ts)                                                                                               | Implemented/tested at service boundary                                  |
| A4T08 | Audience-specific explanation, reason ordering, obligations, limits, privacy filtering                         | `src/policy/capability-policy-explanation.service.ts`, [`ADR-0039-Customer-Visible-Decision-Reasons.md`](ADR/ADR-0039-Customer-Visible-Decision-Reasons.md), [`test/capability-policy-explanation.service.spec.ts`](../test/capability-policy-explanation.service.spec.ts) | Implemented/tested; no route exposed                                    |
| A4T09 | Expiry/currentness, re-evaluation, source freshness, retries, idempotency, recovery, diagnostics               | `src/policy/capability-policy-recovery.service.ts`, [`A4-POLICY-RECOVERY-RUNBOOK.md`](A4-POLICY-RECOVERY-RUNBOOK.md), [`test/capability-policy-recovery.service.spec.ts`](../test/capability-policy-recovery.service.spec.ts)                                              | Implemented/tested at service boundary                                  |
| A4T10 | Integration, rollback, ADR review, operational recovery, security/privacy evidence, exit, approval, A5 handoff | This A4T10 documentation package                                                                                                                                                                                                                                           | Prepared; approval pending                                              |

## 2. A4 acceptance criteria

### Authority and source boundaries

- [x] A4 is one action-specific policy decision authority; source owners remain authoritative for their evidence.
- [x] `Customer.id` is the canonical customer identity throughout A4 contracts/runtime evidence.
- [x] A2 authentication/authorization, A4 policy eligibility, A3 binding/read state, Ledger financial truth, Reconciliation, and future A5 execution remain separate.
- [x] No A4 path writes Customer, onboarding, eligibility, restriction, limit, enrollment, permission, risk, compliance, CustomerWallet, A3 binding, WalletAccount, LedgerAccount, journal, line, balance, or reconciliation source records.
- [x] No A4 path uses readiness, metrics, diagnostics, dashboards, or reconciliation as a source repair writer.

### Determinism and reproducibility

- [x] Capability/action profiles and policy versions are explicitly referenced in runtime results.
- [x] Normalized evidence snapshots carry source references, freshness, classifications, and deterministic input hashes.
- [x] Repeated A4T07 evaluation of the same request/profile/snapshot is deterministic at the service boundary.
- [x] A4T09 replay and changed-payload conflict behavior is tested.
- [x] Historical supersession/expiry behavior preserves old decision references instead of rewriting them.
- [ ] Physical A4T06 persistence, immutable snapshot attachments, historical reconstruction, and migration evidence are implemented and approved.

### Precedence, failure, and recovery

- [x] Decision strictness and capability-specific precedence are explicit and tested.
- [x] Missing, stale, conflicting, restricted, deleted, and unavailable evidence cannot silently produce an unexplained allow.
- [x] Expired, review-due, retired, superseded, and integrity-mismatched decisions cannot satisfy current-effective allow checks.
- [x] Re-evaluation is bounded, idempotent, correlation-aware, and uses the shared Operations idempotency scope.
- [x] Unknown evaluation outcomes are checked against durable evidence before retry.
- [x] Manual-review, blocked, retry-required, recovered, and unknown-outcome states are represented.
- [x] Recovery audit and diagnostic evidence is defined without exposing raw sensitive data.
- [ ] Operations production adapters, on-call ownership, and recovery drill evidence are approved.

### Explainability, security, and privacy

- [x] Customer/support/Operations/Internal Services explanation filtering is deterministic and audience-specific.
- [x] Raw normalized evidence, risk notes, compliance comments, security secrets, credentials, device data, journal lines, and mutable balances are excluded from explanation output.
- [x] Future route exposure remains subject to A2 route/data-exposure policy.
- [x] A4T10 includes security/privacy/retention/legal-hold review evidence and open conditions.
- [ ] Security, Privacy/Legal, Compliance, and Support owners approve the A4 data-exposure and retention boundary.

### Integration and release gate

- [x] Each registered capability/action maps to source evidence, profile, precedence, decision vocabulary, limits/obligations, and consumer gates in [`A4-INTEGRATION-MATRIX.md`](A4-INTEGRATION-MATRIX.md).
- [x] A2/A3 handoff inputs and prohibited edges are linked.
- [x] No A5 transfer, deposit, withdrawal, payment, outbox consumer, external provider, settlement, A6, A7, or A8 implementation is present in A4T10.
- [x] No A4 route, scheduler, notification, entity, migration, or financial execution is introduced by A4T10.
- [x] Full repository tests, lint, build, TypeScript, and formatting validation passed.
- [x] Documentation link validation is included in the A4T10 validation record.
- [ ] A4 ADR review, owner approvals, physical persistence decision, deployment/rollback evidence, and release approval are recorded.

## 3. Release validation record

The implementation baseline was validated with:

```text
npm test -- --runInBand
  Test Suites: 39 passed, 39 total
  Tests:       189 passed, 189 total

npm run lint          PASS
npm run build         PASS
npm run format:check  PASS
npx tsc --noEmit --pretty false  PASS
```

The validation is implementation evidence. It does not claim live PostgreSQL migration execution, production deployment, approved route exposure, A4 persistence activation, or owner approval.

## 4. Open release conditions

| Condition                               | Severity                                | Owner                                      | Required evidence/mitigation                                                                    | Current state                                    |
| --------------------------------------- | --------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A2 phase/route/security approval        | Blocker for protected integration       | Security / Architecture / Operations       | Complete A2 approval and route/data-exposure review                                             | Pending; existing A2 packages remain conditional |
| A3 binding/read/reconciliation approval | Blocker for account-dependent consumers | Wallet / Ledger / Finance / Reconciliation | Complete A3 approval and handoff conditions                                                     | Pending; existing A3 package remains conditional |
| A4 ADR-0036 through ADR-0040 approval   | Blocker for policy governance           | Architecture and decision owners           | Record approve/return decisions and conditions                                                  | Pending                                          |
| Physical A4T06 persistence              | Blocker for durable production A4       | A4 / Database / Operations                 | Approve and implement entities/repositories/migrations/retention/replay evidence                | Not implemented; logical contract only           |
| Production Operations adapter wiring    | High                                    | Operations / A4                            | Wire shared audit/idempotency/diagnostics/persistence contracts and test transactionality       | Port-level evidence only                         |
| Source adapter production wiring        | High                                    | A4 / source owners                         | Implement approved minimum-field read adapters and snapshot attachment controls                 | Contract/runtime consumer evidence only          |
| Security/privacy/retention/holds        | High                                    | Security / Privacy/Legal / Compliance      | Approve classifications, support/audience access, retention, legal holds, and incident controls | Review pending                                   |
| Route exposure                          | High if exposed                         | A2 / Security / Operations                 | Approve protected route/data contract or keep service internal                                  | No A4 route exists                               |
| Profile validity/expiry governance      | Medium                                  | Product / Risk / Compliance / Architecture | Approve profile-specific validity/review intervals and lifecycle controls                       | Static implementation interval requires review   |
| A5 handoff                              | Blocked until A4 exit                   | Architecture / A5 owners                   | Approve handoff contract and all A2/A3/A4 gates                                                 | Prepared but blocked                             |

## 5. Exit result

**Implementation result:** A4T01-A4T09 evidence is present and automated validation passes at the declared service/contract boundaries.

**Phase result:** **NOT APPROVED / CONDITIONAL.** A4 must not be treated as production-approved or as authorization to begin A5 until the unchecked release conditions, ADR reviews, owner approvals, persistence decision, privacy/retention review, deployment/rollback evidence, and A5 handoff decision are recorded.
