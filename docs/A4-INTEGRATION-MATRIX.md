# A4 Integration and Evidence Matrix

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T10 — A4 Integration, Reconciliation, and Release Gate
- **Status:** Evidence package prepared; phase approval pending
- **Classification:** Documentation-only integration and phase-exit evidence
- **Application, database, API, migration, scheduler, and financial-runtime changes in this task:** None
- **Implementation evidence baseline:** `09471065891e1e5d63f96af6c7a04b470bfd376c`

## 1. Purpose and evidence boundary

This matrix is the A4T10 integration trace for A4T01-A4T09. It maps the committed policy contracts, runtime services, tests, source boundaries, operational controls, and remaining release conditions.

A4 is an action-specific policy boundary inside the existing modular monolith. It is not an authentication authority, A3 binding authority, Ledger authority, reconciliation repair mechanism, financial command, or product activation service.

The repository contains implementation evidence for A4T07-A4T09, but the A4T06 physical persistence contract remains logical only and no A4 controller or route is exposed. This matrix deliberately distinguishes implementation evidence from production activation, owner approval, live database evidence, and release approval.

## 2. Task-to-evidence matrix

| Task                                                     | Committed documentation/runtime evidence                                                                                                                                                                         | Integration boundary verified                                                                                                                                        | Automated evidence                                                                                                                | Current release status                                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **A4T01 — Baseline and source-evidence inventory**       | [`A4-POLICY-BASELINE.md`](A4-POLICY-BASELINE.md), [`A4-SOURCE-EVIDENCE-MATRIX.md`](A4-SOURCE-EVIDENCE-MATRIX.md), [`A4-CAPABILITY-INVENTORY.md`](A4-CAPABILITY-INVENTORY.md)                                     | Customer, onboarding, eligibility, limits, enrollment, permissions, risk, compliance, A2, A3, Wallet, Ledger, Operations, and Reconciliation owners remain distinct. | Documentation/source review evidence.                                                                                             | Prepared; owner approval remains pending.                                                                   |
| **A4T02 — Authority and request/result contract**        | [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR/ADR-0036-Customer-Capability-Policy-Authority.md), [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](A4-POLICY-REQUEST-RESULT-CONTRACT.md)                       | `Customer.id`, capability/action, policy result, A2 authorization, A3 binding, and financial execution are separate contracts.                                       | Contract behavior is exercised by A4T07 tests.                                                                                    | Runtime-aligned; formal ADR approval remains pending.                                                       |
| **A4T03 — Normalized evidence and immutable snapshot**   | [`A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md`](A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md), [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](A4-NORMALIZED-EVIDENCE-SNAPSHOT.md)                                                   | Snapshot scope, source references, freshness states, classifications, canonical hash, and no-source-mutation rules are defined.                                      | `calculateSnapshotInputHash` and immutable snapshot assertions are exercised by A4 runtime tests. No production adapter is wired. | Contract/runtime-consumer evidence prepared; production adapter integration remains future work.            |
| **A4T04 — Precedence and conflict matrix**               | [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR/ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md), [`A4-POLICY-PRECEDENCE-MATRIX.md`](A4-POLICY-PRECEDENCE-MATRIX.md)           | `DENY > SUSPEND > PENDING_REVIEW > ALLOW_WITH_LIMITS > ALLOW`; source conflicts are collected and fail closed.                                                       | Deny/suspend/review precedence is covered by `test/capability-policy.service.spec.ts` and recovery conflict tests.                | Runtime-aligned; formal ADR approval remains pending.                                                       |
| **A4T05 — Profiles, enrollment, permission, and limits** | [`ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md`](ADR/ADR-0038-Product-Eligibility-and-Limit-Enforcement-Contract.md), [`A4-CAPABILITY-PROFILE-CONTRACT.md`](A4-CAPABILITY-PROFILE-CONTRACT.md) | Eight static capability profiles map evidence, enrollment, permissions, A3 requirements, obligations, and exact limits.                                              | Current/disabled/missing enrollment, disabled permission, exceeded/unavailable limit tests.                                       | Runtime-aligned; physical profile lifecycle and owner approval remain pending.                              |
| **A4T06 — Versioning and reproducibility**               | [`ADR-0040-Policy-Versioning-and-Reproducibility.md`](ADR/ADR-0040-Policy-Versioning-and-Reproducibility.md), [`A4-POLICY-PERSISTENCE-CONTRACT.md`](A4-POLICY-PERSISTENCE-CONTRACT.md)                           | Immutable profile/decision/snapshot linkage, hashes, lineage, expiry, replay, retention, and legal-hold requirements are defined.                                    | Runtime ports/fakes support decision, replay, and recovery tests. No A4 entities, migrations, or production repositories exist.   | Logical contract only; physical persistence is an A4 release condition.                                     |
| **A4T07 — Deterministic policy evaluation**              | `src/policy/capability-policy.service.ts`, `src/policy/capability-policy.profiles.ts`, `src/policy/capability-policy.types.ts`                                                                                   | A2 authorization is consumed separately; A4 evaluates immutable snapshots and never calls financial execution or mutates source records.                             | `test/capability-policy.service.spec.ts`; targeted and full-suite validation passed.                                              | Implemented/tested at service boundary; production wiring/persistence remains pending.                      |
| **A4T08 — Explainability and consumer read contract**    | `src/policy/capability-policy-explanation.service.ts`, `src/policy/capability-policy-explanation.types.ts`, [`ADR-0039-Customer-Visible-Decision-Reasons.md`](ADR/ADR-0039-Customer-Visible-Decision-Reasons.md) | Customer, support, Operations, and Internal Services outputs are read-only and redacted by audience. No route is exposed.                                            | `test/capability-policy-explanation.service.spec.ts`; sensitive-data/replay consistency tests passed.                             | Implemented/tested at service boundary; A2 route/data-exposure approval remains pending.                    |
| **A4T09 — Re-evaluation and recovery**                   | `src/policy/capability-policy-recovery.service.ts`, recovery enums/types, [`A4-POLICY-RECOVERY-RUNBOOK.md`](A4-POLICY-RECOVERY-RUNBOOK.md)                                                                       | Expiry, review due, stale/conflicting/unavailable evidence, supersession, retry, idempotency, unknown outcome, concurrency, and fail-closed recovery are explicit.   | `test/capability-policy-recovery.service.spec.ts`; 10 tests passed.                                                               | Implemented/tested at service boundary; Operations adapter and production recovery approval remain pending. |
| **A4T10 — Integration and release gate**                 | This package: integration, route/rollback, ADR review, operational recovery, exit, approval, and A5 handoff documents.                                                                                           | Evidence, open conditions, disable/rollback behavior, and handoff prohibitions are recorded without claiming activation.                                             | Full repository validation recorded in Section 8.                                                                                 | Prepared; not approved.                                                                                     |

## 3. Capability/action integration matrix

These are the static profiles currently registered by A4T07. Registration is policy-profile evidence, not product activation or financial execution authority.

| Profile                                  | Capability/action                 | Required policy evidence                                                                                                   | Key precedence/limit behavior                                                                       | Downstream consumer gate                                                               |
| ---------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `profile.wallet-transfer-create.v1`      | `wallet.transfer` / `create`      | Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding, A2 context | All A4T04 tiers; exact NGN/declared-currency limits; `ALLOW_WITH_LIMITS` only with effective limits | A2 recheck, A3 binding recheck, execution-time usage/limit check, financial invariants |
| `profile.wallet-deposit-create.v1`       | `wallet.deposit` / `create`       | Same financial source set with deposit permission/enrollment mapping                                                       | Known breach is `DENY`; missing/stale configuration or usage is non-allow                           | A2/A3/limit/ledger checks; deposit execution remains outside A4                        |
| `profile.wallet-withdrawal-create.v1`    | `wallet.withdrawal` / `create`    | Same financial source set with withdrawal permission/enrollment mapping                                                    | Suspension/terminal blocks outrank limits; no balance mutation                                      | A2/A3/limit/ledger checks; withdrawal execution remains outside A4                     |
| `profile.wallet-payment-create.v1`       | `wallet.payment` / `create`       | Financial source set with payment permission/enrollment; A3 binding when context requires it                               | Exact configured/usage limits; unresolved source state is `PENDING_REVIEW`                          | A2 authorization, A3/account checks, financial command invariants                      |
| `profile.customer-product-enroll.v1`     | `customer.product` / `enroll`     | Customer, onboarding, eligibility, restrictions; risk/compliance profile-controlled                                        | Enrollment action does not require active enrollment; A4 does not execute enrollment mutation       | A2 authorization and source-owner enrollment command, if later approved                |
| `profile.product-virtual-account-use.v1` | `product.virtual-account` / `use` | Customer, onboarding, eligibility, restrictions, enrollment, permission; A3 binding if context requires it                 | Non-active enrollment/permission and A3 issues fail closed                                          | A2/A3/product-owner checks; provider/product activation remains outside A4             |
| `profile.wallet-account-read.v1`         | `wallet.account` / `read`         | Customer and current A3 binding/account state; A2 remains separate                                                         | Missing/stale/closed/ledger-unavailable account state is not an active read allow                   | A2 read authorization and A3/Ledger read contract                                      |
| `profile.channel-api-use.v1`             | `channel.api` / `use`             | Customer, eligibility, restrictions, permission; enrollment/binding if context requires it                                 | A2 service/audience authorization remains independent from customer policy                          | A2 route/service authorization and future channel contract                             |

Every result remains scoped to the declared canonical `Customer.id`, capability, action, requested/as-of time, policy version, and immutable evidence snapshot. No profile grants a general customer status.

## 4. End-to-end integration trace

```text
A2 authenticated principal / authorization context
                       |
                       v
A4 PolicyDecisionRequest
  Customer.id + capability + action + requested/as-of + correlation
                       |
                       v
A4T03 approved read boundary / immutable snapshot
  source IDs + versions + freshness + classifications + input hash
                       |
                       v
A4 profile registry + immutable policy definition
  profile version + policy version + definition hash
                       |
                       v
A4T07 deterministic evaluator
  A4 decision + reason codes + obligations + limits + expiry/review
                       |
             +---------+----------+
             |                    |
             v                    v
A4T08 audience read       A4T09 currentness/recovery
  safe explanations        expiry/source/policy/retry handling
             |                    |
             +---------+----------+
                       v
Future authorized consumer
  A2 recheck + A3 binding recheck + financial/product invariants
```

The trace proves separation, not production activation. A4T07-A4T09 are service-level artifacts with ports for persistence, idempotency, audit, current evidence, profile lifecycle, and diagnostics. The application module does not expose an A4 controller or route.

## 5. Integration scenario evidence

| Scenario                                   | Expected policy/recovery behavior                                                       | Evidence                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Current financial evidence and exact usage | `ALLOW_WITH_LIMITS` with explicit currency-labelled limits and recheck obligations      | `test/capability-policy.service.spec.ts`             |
| Active blacklist plus critical risk        | `DENY`; all applicable reasons are retained; source snapshot remains unchanged          | `test/capability-policy.service.spec.ts`             |
| Frozen restriction                         | `SUSPEND`; no source suspension mutation                                                | `test/capability-policy.service.spec.ts`             |
| Stale risk evidence                        | `PENDING_REVIEW` / manual-review recovery; stale reason is explicit                     | `test/capability-policy-recovery.service.spec.ts`    |
| Conflicting source class                   | Fail-closed `PENDING_REVIEW`; conflicting source class remains referenced               | `test/capability-policy-recovery.service.spec.ts`    |
| Unavailable collection                     | Controlled non-allow/manual review or bounded retry state; no fabricated allow          | `test/capability-policy-recovery.service.spec.ts`    |
| Expired or review-due decision             | Current-effective lookup is non-current; old result/review timestamp is not rewritten   | `test/capability-policy-recovery.service.spec.ts`    |
| Policy profile retired/superseded          | Historical result remains queryable; re-evaluation with inapplicable version is blocked | `test/capability-policy-recovery.service.spec.ts`    |
| Transient evaluator failure                | Bounded retry with `REEVALUATION_RETRY` audit evidence                                  | `test/capability-policy-recovery.service.spec.ts`    |
| Unknown evaluator outcome                  | Durable A4 result is checked before retry; verified result is recovered                 | `test/capability-policy-recovery.service.spec.ts`    |
| Same re-evaluation request                 | Original durable replacement is replayed under the Operations idempotency scope         | `test/capability-policy-recovery.service.spec.ts`    |
| Changed payload under same key             | Conflict; no second decision effect                                                     | `test/capability-policy-recovery.service.spec.ts`    |
| Customer explanation                       | Sensitive risk/compliance/source references are redacted                                | `test/capability-policy-explanation.service.spec.ts` |
| Operations/internal explanation            | Safe provenance and internal reason codes are available without normalized raw evidence | `test/capability-policy-explanation.service.spec.ts` |

## 6. Authority and no-mutation verification

| Boundary          | Verified rule                                                                                                                                       | Evidence/status                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Customer identity | `Customer.id` is the only canonical customer subject; references/aliases are not substituted.                                                       | A4T01/A4T02 contracts; runtime request normalization tests.                 |
| Source ownership  | A4 consumes immutable snapshots and never writes Customer Foundation, eligibility, enrollment, permission, risk, compliance, or onboarding records. | A4T03 contracts; snapshot immutability tests; no source writer in A4 files. |
| A2                | A2 authorization is evaluated through `PolicyAuthorizationPort`; A4 policy result is not authorization.                                             | A4T07 code/tests; A2 route and authorization evidence.                      |
| A3                | Binding/account state is evidence; A4 never binds, repairs, reassigns, provisions, or closes an account.                                            | A3/A4 handoff; A4 binding-state tests; no A3 writer in A4 files.            |
| Wallet/Ledger     | Limits and account dimensions are read-only policy inputs; A4 does not post journals or change balances.                                            | A4T05/A3 handoff; financial invariants and A4 no-side-effect tests.         |
| Reconciliation    | Reconciliation remains independent and read-only; A4 only consumes control evidence where a profile requires it.                                    | A3 reconciliation docs; no A4 reconciliation writer.                        |
| Operations        | Audit/idempotency/diagnostic ports are reused; A4 does not create a competing operational authority.                                                | A4T07/A4T09 types and audit/replay tests.                                   |
| Privacy           | Customer/support views hide sensitive internal reasons and source references; no normalized source values enter explanation output.                 | ADR-0039 implementation and tests; A2 security/privacy inputs.              |
| A5                | No financial command, outbox consumer, external provider, settlement, or A5 route is introduced.                                                    | Source inventory and diff boundary; A5 remains handoff-only.                |

## 7. Persistence, reconciliation, and deployment limitations

- A4T06 defines the physical persistence requirements, but this branch contains no A4 profile/decision/snapshot entities, migrations, or production repositories.
- A4T07/A4T09 use ports and test fakes for decision storage, idempotency, audit, profile lifecycle, current evidence, and diagnostics. Wiring to the existing Operations/TypeORM services is not claimed.
- A4 has no independent financial reconciliation writer or repair path. A3/Reconciliation remains the owner of binding/source control evidence.
- A4 has no controller, route, scheduler, notification path, external provider, or financial execution path. Route exposure and rollback are documented separately in [`A4-ROUTE-EXPOSURE-AND-ROLLBACK.md`](A4-ROUTE-EXPOSURE-AND-ROLLBACK.md).
- These limitations are release conditions or future architecture work, not reasons to weaken the documented boundaries.

## 8. Automated validation record

Validation on the A4T09 baseline passed:

```text
npm test -- --runInBand
  Test Suites: 39 passed, 39 total
  Tests:       189 passed, 189 total

npm run lint          PASS
npm run build         PASS
npm run format:check  PASS
npx tsc --noEmit --pretty false  PASS
```

Targeted A4 evidence also passed:

```text
npx jest test/capability-policy.service.spec.ts \
  test/capability-policy-explanation.service.spec.ts \
  test/capability-policy-recovery.service.spec.ts --runInBand
  Test Suites: 3 passed
  Tests:       21 passed
```

The validation demonstrates repository/test behavior. It does not claim live PostgreSQL migration, production deployment, owner approval, route activation, or A4 phase approval.

## 9. Integration gate result

- **A4 contract integration:** Prepared and runtime-aligned.
- **A4 deterministic evaluation integration:** Implemented/tested through service ports and immutable snapshots.
- **A4 explanation integration:** Implemented/tested as a read-only, audience-filtered service with no route.
- **A4 recovery integration:** Implemented/tested with expiry, currentness, retry, idempotency, conflict, and unknown-outcome controls.
- **Physical persistence integration:** Pending; A4T06 remains a logical contract.
- **Operations production adapter integration:** Pending; ports are not wired into a production A4 module.
- **Route/exposure integration:** No A4 route exists; any future exposure requires A2 approval.
- **A4 approval/release:** Pending accountable-owner review and unresolved conditions in the A4 exit/approval package.
- **A5 handoff:** Prepared but blocked until A4 and upstream A2/A3 gates are approved.

This matrix is evidence for A4T10 review. It is not a production activation or approval signature.
