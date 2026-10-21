# A4T09 — Policy Re-evaluation and Recovery Runbook Evidence

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T09 — Re-evaluation, Expiry, Conflict, and Recovery Controls
- **Contract:** `A4-POLICY-REEVALUATION.v1`
- **Status:** Runtime recovery contract and service evidence; no route, scheduler, migration, or financial execution
- **Owner:** A4 Capability & Policy Engine boundary, with Operations owning audit/idempotency/diagnostic adapters

## 1. Purpose and boundary

This runbook describes the safe operator/support interpretation of A4 decision currentness and re-evaluation results. It is evidence for the A4T09 lifecycle implementation; it is not a production activation or an A4T10 release approval.

A4 re-evaluation:

- consumes a new immutable A4T03 evidence snapshot and an immutable A4T06 policy/profile reference;
- reuses the deterministic A4T07 evaluator;
- appends a replacement decision when a new result is required;
- preserves the old decision, snapshot reference, policy version, hashes, and lineage;
- uses A2 authorization through the evaluator and does not grant authorization itself; and
- writes only A4 decision/idempotency/audit/diagnostic facts through their declared ports.

A4 recovery never repairs Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, CustomerWallet, A3 binding, WalletAccount, Ledger, posted value, or reconciliation records.

There is intentionally no scheduler, notification sender, external provider, financial command, controller, public API, or route exposure in A4T09. A later approved caller may invoke the service with a current snapshot and A2 context.

## 2. Currentness states

`getCurrentEffectiveDecision` returns a read-only result. It never changes the stored decision.

| State                                   | Meaning                                                                                                                                                                                 | Required handling                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CURRENT`                               | The stored profile is active, the decision is within `expiresAt`/`reviewAt`, and a current immutable snapshot has the same normalized input hash and no required freshness degradation. | A downstream consumer must still re-check A2, A3, limits, and financial invariants.      |
| `EXPIRED`                               | `expiresAt` is present and is at or before the checked time.                                                                                                                            | Request a new evaluation; never extend the old decision.                                 |
| `REVIEW_DUE`                            | `reviewAt` is present and is at or before the checked time.                                                                                                                             | Route to the declared review/re-evaluation owner.                                        |
| `STALE_EVIDENCE`                        | Required evidence is stale or the current snapshot hash differs from the stored hash.                                                                                                   | Collect a new approved snapshot and re-evaluate.                                         |
| `MISSING_EVIDENCE` / `DELETED_EVIDENCE` | Required source evidence is absent or explicitly deleted.                                                                                                                               | Fail closed; do not infer a source default.                                              |
| `CONFLICTING_EVIDENCE`                  | Source collection or normalized evidence reports conflicting versions/values.                                                                                                           | Keep the result non-current and require controlled review or a new coherent snapshot.    |
| `UNAVAILABLE_EVIDENCE`                  | A required source or current read is unavailable.                                                                                                                                       | Retry only through the bounded re-evaluation path; otherwise keep the outcome non-allow. |
| `POLICY_VERSION_RETIRED`                | The historical profile is retired.                                                                                                                                                      | Preserve it for replay; evaluate with the active replacement profile.                    |
| `POLICY_VERSION_SUPERSEDED`             | A different profile version is effective for the capability/action.                                                                                                                     | Supply a snapshot compatible with the active profile and create a new decision.          |
| `UNKNOWN`                               | Integrity, request, or lifecycle evidence cannot be trusted.                                                                                                                            | Block and escalate with the diagnostic code; never return an allow.                      |

A historical `ALLOW` or `ALLOW_WITH_LIMITS` is not current merely because it remains readable. The published static A4 profiles in this implementation carry a 15-minute immutable validity interval in the profile definition hash; a later profile version may choose a different approved interval without changing historical decisions.

## 3. Re-evaluation procedure

1. **Identify the immutable predecessor.** Record `previousDecisionReference` when replacing an expired, review-due, stale, conflicting, unavailable, or superseded decision. Do not edit the predecessor.
2. **Resolve the active profile.** Verify the profile lifecycle state and `definitionHash`. A retired or superseded version cannot be used as a new current decision.
3. **Capture a new normalized snapshot.** The snapshot must match the customer/capability/action/evidence profile and must pass its SHA-256 integrity check. Source owners remain responsible for source truth.
4. **Validate freshness.** Required `STALE`, `MISSING`, `DELETED`, `CONFLICTING`, `UNAVAILABLE`, or `RESTRICTED` evidence is explicit. An optimistic default is prohibited.
5. **Evaluate deterministically.** A4T07 produces the decision for the supplied profile and snapshot. If evidence is degraded, the recovery service preserves or applies a fail-closed `PENDING_REVIEW`/`DENY` result as required by the A4 precedence contract.
6. **Persist append-only evidence.** A replacement result may carry `supersedesDecisionReference`; the old result and snapshot remain unchanged. No balance, journal, binding, or reconciliation repair is performed.
7. **Audit the lifecycle.** Operations-compatible audit facts use safe references, hashes, profile/version data, trigger, state, and request/correlation context. Raw risk, compliance, credentials, tokens, and unrestricted snapshot data are excluded.
8. **Return the recovery contract.** A downstream caller must inspect `state`, `recovery.state`, `decision`, `expiresAt`, and `reviewAt`. It must not treat a recovery response as A2 authorization or financial execution approval.

## 4. Fail-closed recovery matrix

| Condition                            | A4 result behavior                                                                                                                                                                                                     | Support/operations action                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Stale required source                | Re-evaluate; an allow is converted to `PENDING_REVIEW` if the evaluator did not already produce a stricter state.                                                                                                      | Obtain a new source-owner snapshot; do not edit the stale source through A4.                   |
| Conflicting source versions          | Re-evaluate only against a coherent snapshot; otherwise return `PENDING_REVIEW` with a conflict reason and manual-review recovery state.                                                                               | Escalate to the source owner and retain both immutable references.                             |
| Source unavailable                   | Bounded retries may occur. If the source remains unavailable, return `RETRY_SCHEDULED` or `UNKNOWN_OUTCOME` without a decision, or a deterministic non-allow result when evaluation has a controlled snapshot outcome. | Retry through an approved caller; investigate diagnostics. Do not fabricate evidence.          |
| Missing/deleted customer evidence    | Preserve a fail-closed `DENY` outcome where the customer identity gate applies.                                                                                                                                        | Verify Customer source ownership; no A4 repair.                                                |
| Missing other required evidence      | Preserve or produce `PENDING_REVIEW`/profile-specific non-allow behavior.                                                                                                                                              | Obtain evidence through the approved adapter.                                                  |
| Expired/review-due decision          | Mark current lookup non-current; create a new immutable decision from a new snapshot.                                                                                                                                  | Do not change `expiresAt` or `reviewAt` on the old record.                                     |
| Retired/superseded policy version    | Keep historical result queryable; block re-evaluation with the retired/inapplicable version.                                                                                                                           | Select the active policy version and capture a compatible snapshot.                            |
| Authorization denial                 | No policy result is created by the evaluator; re-evaluation returns a blocked recovery contract or the underlying A2 denial is propagated by the caller.                                                               | Re-establish A2 context; never use A4 recovery to bypass A2.                                   |
| Unknown outcome after evaluator call | Query durable A4 evidence by the normalized request/snapshot linkage before retrying.                                                                                                                                  | If found, recover it; if absent after bounded attempts, retain `UNKNOWN_OUTCOME` and escalate. |

## 5. Retry, idempotency, and concurrency controls

- Re-evaluation reuses the A4T02/A4T07 Operations scope `policy.capability-decision.v1`; its request hash includes the normalized evaluation request, snapshot reference/hash, trigger, and predecessor reference.
- Same key plus the same hash returns the durable replacement result with `REPLAYED`; it does not call A4T07 again.
- Same key plus a changed hash returns a conflict and creates no new decision.
- A local bounded-concurrency guard prevents duplicate work in one process. Operations idempotency remains the cross-process authority.
- Evaluation attempts are bounded (`maxAttempts`); transient failures use bounded exponential delay. A4T09 does not create a scheduler.
- Before a retry after an exception, the service checks durable A4 decision evidence using the deterministic evaluator request hash, snapshot hash, policy version, and capability scope.
- A durable result found after an exception is reported as recovered. A missing result after the retry bound is reported as `RETRY_SCHEDULED` or `UNKNOWN_OUTCOME`, never as an allow.
- Idempotency record expiry may permit a new command reservation, but it never recycles a decision reference, snapshot reference, policy version, or predecessor identity.

## 6. Diagnostic and audit evidence

Safe audit actions include:

```text
REEVALUATION_REQUESTED
REEVALUATION_RETRY
REEVALUATION_RECOVERED
REEVALUATION_REPLAYED
REEVALUATION_CONFLICT
REEVALUATION_BLOCKED
REEVALUATION_RETRY_SCHEDULED
REEVALUATION_UNKNOWN_OUTCOME
DECISION_REEVALUATED
```

Each fact carries the A4 re-evaluation reference, canonical customer UUID, capability/action, policy version where known, request/snapshot hashes, trigger, outcome, attempt bound, and request/correlation context. Diagnostic records use bounded codes such as `A4_DURABLE_RESULT_RECOVERED`, `A4_UNKNOWN_OUTCOME_VERIFIED`, `A4_EVIDENCE_UNAVAILABLE`, and `A4_REEVALUATION_CONCURRENCY_BOUND`.

Diagnostic and audit views are observational. They cannot authorize a request, change an evidence source, repair an A3 binding, or change financial value.

## 7. Prohibited recovery actions

Operators and support consumers must not:

- edit an old decision's expiry, reason, policy version, snapshot hash, or lineage;
- replace a stale/conflicting source row from the policy recovery service;
- convert `PENDING_REVIEW`, `DENY`, or `SUSPEND` into `ALLOW` outside a new deterministic evaluation;
- use a diagnostic/readiness/reconciliation result as policy evidence or a repair command;
- use an A4 result as A2 authentication, authorization, MFA, privileged approval, or A3 binding;
- retry a financial command from an unknown policy-evaluation outcome; or
- expose this service through a route without a separate A2 audience/data-exposure decision.

## 8. Test evidence

The A4T09 automated suite covers:

- explicit profile validity and expired current-effective lookup;
- append-only re-evaluation and predecessor lineage;
- stale, conflicting, unavailable, and source-changed evidence;
- fail-closed non-allow behavior and snapshot immutability;
- bounded transient retries;
- durable verification after an unknown outcome;
- idempotent replay and changed-payload conflict; and
- current-effective source/version checks.

This evidence does not claim database migration execution, production activation, route exposure, scheduler deployment, or A4 phase approval. Those are later governance/release concerns.
