# ADR-0037: Risk, Restriction, Compliance, and Limit Precedence

- **Status:** Proposed A4 decision input; no runtime implementation
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Risk, Compliance, Product, Security, Finance, Operations, Customer Engineering, Wallet, Ledger, and Reconciliation
- **Scope:** Normative precedence and conflict resolution for A4 capability policy evidence
- **Task:** A4T04 — Policy State Vocabulary and Precedence Matrix
- **Implementation status:** Documentation-only decision input; no evaluator, entity, migration, service, controller, API, persistence, or runtime behavior is introduced

## Context

A4T01 and A4T03 established that A4 consumes separately owned evidence:

- `customer` owns canonical identity and lifecycle;
- `customer-onboarding` owns workflow/readiness evidence;
- `customer-eligibility` owns eligibility, restrictions, configured limits, enrollment, and operating permissions;
- `customer-risk-profile` owns P1.10 manual risk evidence;
- onboarding-era risk remains historical/compatibility evidence;
- `customer-compliance` owns case evidence, not an automated screening result;
- A3 owns customer-to-financial-account binding and read/control state;
- `wallet`/`ledger` own financial account dimensions and financial value; and
- A2 owns authentication and authorization.

The source vocabularies can disagree. Examples include an eligible customer with an active blacklist, an active enrollment with a revoked eligibility state, a low current P1.10 risk profile with a legacy `PROHIBITED` risk record, an active A3 binding with a stale source version, or a current account read with a reconciliation error.

A4 needs deterministic behavior that fails closed without selecting one source as a silent replacement for another. The precedence model must preserve source ownership, collect all relevant evidence, make the strictest applicable outcome explicit, and leave source repair to the owning domain or A3 recovery boundary.

## Decision

### 1. Normative precedence authority

The A4 policy boundary applies the precedence rules in this ADR to a normalized immutable evidence snapshot and a registered capability/action profile.

A4 does not change source records to resolve a conflict. It records:

- every applicable source reference and version;
- every applicable reason code and evidence state;
- the selected precedence tier; and
- the resulting bounded A4 decision.

The final decision is selected by the following strictness order:

```text
DENY
  > SUSPEND
  > PENDING_REVIEW
  > ALLOW_WITH_LIMITS
  > ALLOW
```

The order is a decision aggregation rule. It does not mean that A4 owns or changes the source state that caused the result.

### 2. A2 access is an external gate

A2 authentication and authorization are evaluated before a protected policy request/read is accepted:

- missing, invalid, expired, or denied A2 context stops the protected request at the A2 boundary;
- an A2 denial is not rewritten as an A4 customer `DENY` policy result;
- an A2 `allowed = true` result does not imply customer eligibility or product access; and
- A4 consumes the A2 context as a separate evidence/access reference.

A4 precedence begins only after the request is validly admitted to policy evaluation.

### 3. Precedence tiers

| Tier | Evidence condition                                                                                                                                                                                                                                                                                                                                          | Default A4 outcome                                                   | Notes                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | A2 access missing/denied                                                                                                                                                                                                                                                                                                                                    | No A4 policy result; A2 access denial                                | Authentication/authorization remains outside policy precedence.                                                                                       |
| P1   | Invalid canonical subject, missing/deleted customer identity, unknown capability/action, unavailable policy profile, or invalid policy contract                                                                                                                                                                                                             | `DENY` or safe contract error                                        | No policy allow can exist without a valid subject and registered policy scope.                                                                        |
| P2   | Explicit terminal block: customer `CLOSED`, onboarding `REJECTED` where activation is required, eligibility `INELIGIBLE`/`REVOKED`, active `BLACKLISTED`, closed required enrollment, known exceeded limit, or closed required A3 binding                                                                                                                   | `DENY`                                                               | Terminal/source-explicit blocks outrank suspension, review, limits, and allow. A4 does not mutate the source.                                         |
| P3   | Explicit reversible suspension: customer/eligibility suspension, active `FROZEN` restriction, suspended required enrollment, or suspended required A3 binding/account                                                                                                                                                                                       | `SUSPEND`                                                            | Suspension is not closure and does not authorize A4 to reactivate or suspend a source.                                                                |
| P4   | Unresolved evidence: missing required non-identity evidence, stale/review-due evidence, unavailable/degraded reads, source ownership/dimension conflict, `PENDING` onboarding/eligibility/enrollment, manual review, P1.10 `CRITICAL`, open high/critical compliance case, or A3 `PENDING`/`REPAIR_REQUIRED`/`STALE`/`MISSING_BINDING`/`LEDGER_UNAVAILABLE` | `PENDING_REVIEW`                                                     | Uncertainty never becomes an allow. A later capability profile may make a condition stricter, but may not make unresolved evidence silently positive. |
| P5   | All declared source prerequisites are current and compatible: customer active, onboarding sufficient, eligibility eligible, restrictions non-blocking, required enrollment active, required permission enabled, A3 binding/account current, and no unresolved control state                                                                                 | Continue to limit/allow evaluation                                   | Passing one source class cannot override a higher-priority block from another class.                                                                  |
| P6   | Declared configured limits and obligations are current and within the capability profile                                                                                                                                                                                                                                                                    | `ALLOW_WITH_LIMITS` when limits/obligations apply; otherwise `ALLOW` | A4 does not account usage or execute money movement. A4T05 defines capability-specific limit inputs and enforcement handoff.                          |

### 4. Decision aggregation

The evaluator that is implemented later must use this logical sequence:

1. Validate the A4T02 request subject, capability, action, contract version, and policy-profile reference.
2. Confirm the A2 request/access gate has admitted the policy request.
3. Consume one immutable A4T03 evidence snapshot; do not query arbitrary source tables or mutate the snapshot.
4. Collect all applicable source conditions rather than stopping at the first observed block.
5. Map each condition to its precedence tier and candidate outcome using this ADR and the registered capability profile.
6. Select the strictest applicable outcome using `DENY > SUSPEND > PENDING_REVIEW > ALLOW_WITH_LIMITS > ALLOW`.
7. Include all applicable stable reason codes/source references, ordered deterministically by tier and code.
8. Return `ALLOW_WITH_LIMITS` only when no `DENY`, `SUSPEND`, or `PENDING_REVIEW` condition applies and the declared limit/obligation contract is satisfied.
9. Return `ALLOW` only when no stricter condition applies and no required limit/obligation remains unresolved.
10. Never update a source row, A3 binding, wallet, ledger, reconciliation report, or readiness record as part of the result.

This is a normative decision model for later evaluation. It is not executable runtime code in A4T04.

## 5. Source ownership and conflict resolution

### 5.1 Source authority rule

A4 does not rank one domain's source record above another domain's source record as a general data-ownership rule. Each domain remains authoritative for its own concept:

| Concept                                                | Authoritative source                                                     | Derived or compatibility values cannot override it                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Customer identity/lifecycle                            | `customer`                                                               | Customer reference, onboarding view, eligibility view, A2 principal, policy output |
| Onboarding workflow/readiness                          | `customer-onboarding`                                                    | Eligibility, risk, operating status, policy output                                 |
| Eligibility/restrictions/limits/enrollment/permissions | `customer-eligibility`                                                   | Operating-status projection, risk profile, compliance case, policy output          |
| Manual risk evidence                                   | P1.10 `customer-risk-profile`; legacy onboarding risk remains historical | A single risk factor, local operating status, policy output                        |
| Compliance case evidence                               | `customer-compliance`                                                    | Case number, policy output, risk score, A2 authorization                           |
| Customer/account association                           | A3 binding capability                                                    | Opaque WalletAccount customer value, alias, payment reference, policy output       |
| Financial dimensions/value                             | `wallet`/`ledger`                                                        | Customer metadata, A4 snapshot, A4 decision, readiness/report                      |
| Runtime access                                         | A2                                                                       | A4 policy result, permission row, customer reference                               |

When a derived view disagrees with its source, the source record remains the source and the disagreement is captured as evidence drift. A4 does not silently trust a projection merely because it is convenient to read.

### 5.2 Conflict outcome rule

A conflict is not resolved by deleting, rewriting, or arbitrarily selecting a source. The default conflict result is `PENDING_REVIEW` unless an explicit terminal or suspension condition already applies:

- an explicit terminal block maps to `DENY`;
- an explicit suspension maps to `SUSPEND`;
- unresolved identity/ownership/dimension/freshness conflict maps to `PENDING_REVIEW`;
- a known disabled/closed entitlement maps to `DENY`; and
- a known exceeded limit maps to `DENY`.

All relevant conflicting source references remain attached to the evidence/decision record.

## 6. Normative state precedence by source class

### 6.1 Customer lifecycle

| Customer state/evidence     | Outcome          | Rule                                                                                      |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Missing or deleted customer | `DENY`           | There is no valid policy subject.                                                         |
| `CLOSED`                    | `DENY`           | Closed customer cannot receive an activation or financial capability allow.               |
| `SUSPENDED`                 | `SUSPEND`        | Customer source suspension blocks active use without closing the customer.                |
| `DRAFT`                     | `PENDING_REVIEW` | Customer identity exists but is not an active source for activation-dependent capability. |
| `ACTIVE`                    | Continue         | Other evidence gates still apply.                                                         |

### 6.2 Onboarding

| Onboarding state/evidence                          | Outcome                                                | Rule                                                                        |
| -------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Missing required onboarding                        | `PENDING_REVIEW`                                       | No activation evidence is fabricated.                                       |
| `NOT_STARTED`, `IN_PROGRESS`, or `AWAITING_REVIEW` | `PENDING_REVIEW` for capabilities requiring completion | The workflow is unresolved.                                                 |
| `APPROVED` but not `COMPLETED`                     | `PENDING_REVIEW` for capabilities requiring completion | Approval is not completion and is not authorization.                        |
| `REJECTED`                                         | `DENY` for activation-dependent capability             | Rejected workflow cannot be treated as ready.                               |
| `COMPLETED` with current readiness evidence        | Continue                                               | Eligibility, risk, compliance, account, and capability requirements remain. |
| Readiness unavailable/stale                        | `PENDING_REVIEW`                                       | A readiness projection cannot be replaced by an optimistic default.         |

### 6.3 Eligibility

| Eligibility state/evidence                | Outcome                                          | Rule                                                                    |
| ----------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| Missing required eligibility              | `PENDING_REVIEW`                                 | Absence is not eligibility.                                             |
| `PENDING`                                 | `PENDING_REVIEW`                                 | Eligibility is unresolved.                                              |
| `ELIGIBLE`                                | Continue                                         | Does not override restrictions, risk, compliance, account, or A2 gates. |
| `INELIGIBLE` or `REVOKED`                 | `DENY`                                           | Explicit source block.                                                  |
| `SUSPENDED`                               | `SUSPEND`                                        | Explicit reversible source unavailability.                              |
| Stale/unavailable/conflicting eligibility | `PENDING_REVIEW` unless a stronger block applies | Preserve source evidence and do not infer current eligibility.          |

### 6.4 Restrictions

Restrictions apply after identity validation and before enrollment, permission, limit, or allow aggregation.

| Active restriction                         | Outcome                                         | Rule                                                                                                             |
| ------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BLACKLISTED`                              | `DENY`                                          | Highest restriction block; cannot be overridden by low risk, enrollment, permission, or limit evidence.          |
| `FROZEN`                                   | `SUSPEND`                                       | Blocks active use; A4 does not change the source restriction.                                                    |
| `MANUAL_REVIEW`                            | `PENDING_REVIEW`                                | Requires controlled review unless a stronger deny/suspend applies.                                               |
| `LIMITED`                                  | Continue to limit evaluation                    | May produce `ALLOW_WITH_LIMITS` only when all other gates pass and the capability profile supplies exact limits. |
| `NONE` or no active restriction            | Continue                                        | No blocking restriction is present in the current source read.                                                   |
| Restriction read missing/unavailable/stale | `PENDING_REVIEW` when restrictions are required | A failed restriction read is not equivalent to no restriction.                                                   |

### 6.5 Risk evidence

A4 preserves risk source vocabulary and does not create an automated risk engine.

| Risk evidence                                                            | Outcome                                                                                                                    | Rule                                                                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Legacy `PROHIBITED`                                                      | `DENY` for activation/product/financial capabilities                                                                       | This is an explicit historical prohibition; it is not silently relabelled as P1.10 `CRITICAL`.                  |
| P1.10 `CRITICAL` current profile                                         | `PENDING_REVIEW` by default                                                                                                | A later capability profile may make this stricter (`DENY`) but may not make it an unqualified allow.            |
| P1.10 `HIGH`                                                             | `PENDING_REVIEW` when the capability profile requires review; otherwise continue only if the profile explicitly permits it | High risk is not globally equivalent to prohibited; an absent profile mapping is conservative `PENDING_REVIEW`. |
| P1.10 `MEDIUM` or `LOW`                                                  | Continue when current and complete                                                                                         | A score/factor cannot override other restrictions, compliance, lifecycle, or account conditions.                |
| Missing current risk where profile requires it                           | `PENDING_REVIEW`                                                                                                           | Legacy/historical evidence cannot silently stand in for a required current profile.                             |
| Review due date passed, stale, conflicting, or unavailable risk evidence | `PENDING_REVIEW`                                                                                                           | Low or historical risk does not prove current evidence.                                                         |
| Single factor without a valid profile                                    | `PENDING_REVIEW`                                                                                                           | A factor is evidence, not a policy decision.                                                                    |

### 6.6 Compliance evidence

Compliance cases remain investigation/workflow evidence. Case existence is not an automated screening result.

| Compliance evidence                                                | Outcome                                                                      | Rule                                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Open/under-review/escalated/pending-customer high or critical case | `PENDING_REVIEW` for capabilities whose profile requires compliance evidence | Review work is unresolved; no automatic finding is inferred.                                                                           |
| Open case with lower severity                                      | Continue or `PENDING_REVIEW` according to the registered capability profile  | A4T05/profile mapping controls whether the case affects the capability; absence of a mapping is not an allow for a required case gate. |
| Resolved/closed case                                               | Continue with historical reference                                           | Resolution does not automatically erase history or create a block.                                                                     |
| Case read unavailable/restricted/stale                             | `PENDING_REVIEW` when compliance evidence is required                        | No broad case payload is exposed to bypass the read boundary.                                                                          |
| Explicit `BLACKLISTED`/`FROZEN` restriction alongside a case       | Restriction outcome wins                                                     | The case does not weaken an authoritative restriction.                                                                                 |

### 6.7 Enrollment

| Enrollment state/evidence                | Outcome                                                 | Rule                                                                                            |
| ---------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Required enrollment missing or `CLOSED`  | `DENY`                                                  | No active entitlement is established.                                                           |
| `PENDING`                                | `PENDING_REVIEW`                                        | Enrollment is not active.                                                                       |
| `ACTIVE`                                 | Continue                                                | Does not override eligibility, restriction, risk, compliance, permission, binding, or A2 gates. |
| `SUSPENDED`                              | `SUSPEND`                                               | Active product use is unavailable until source reactivation and re-evaluation.                  |
| Stale/unavailable/conflicting enrollment | `PENDING_REVIEW` unless a stronger source block applies | Do not select another product/enrollment record.                                                |

### 6.8 Operating permission

| Permission evidence                                                | Outcome                                       | Rule                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------- |
| Required permission missing or `enabled = false`                   | `DENY`                                        | Absence or disabled state does not grant the operation.               |
| Required permission enabled and current                            | Continue                                      | It is a policy input, not A2 authorization.                           |
| Permission source stale/unavailable/restricted/conflicting         | `PENDING_REVIEW`                              | Fail closed without assuming enabled or disabled state.               |
| Permission conflicts with `BLACKLISTED`/`FROZEN`/eligibility block | Stronger restriction/eligibility outcome wins | An enabled permission cannot override a higher-priority source block. |

### 6.9 A3 binding, Wallet, and Ledger state

These states apply only when the capability profile requires a financial-account/binding context.

| A3/account evidence                                                                       | Outcome                                                                    | Rule                                                                                  |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| No required binding                                                                       | `PENDING_REVIEW`                                                           | A4 cannot infer or choose an account.                                                 |
| Binding `PENDING`                                                                         | `PENDING_REVIEW`                                                           | Provisioning/confirmation is incomplete.                                              |
| Binding `ACTIVE` and all source dimensions current                                        | Continue                                                                   | A3 binding state is necessary but not sufficient for A4 policy allow or A5 execution. |
| Binding `SUSPENDED` or known Wallet/Customer source suspension                            | `SUSPEND`                                                                  | A4 does not reactivate or mutate the source.                                          |
| Binding `REPAIR_REQUIRED`, `STALE_BINDING`, ownership mismatch, or unresolved discrepancy | `PENDING_REVIEW`                                                           | A3 recovery/reconciliation owns the problem; no account reassignment is permitted.    |
| Binding `CLOSED` or terminal financial source closure                                     | `DENY`                                                                     | Closed identity/account cannot be reused by policy.                                   |
| `LEDGER_UNAVAILABLE` or incompatible Wallet/Ledger dimensions                             | `PENDING_REVIEW`                                                           | No fabricated balance, account compatibility, or financial allow.                     |
| A3 reconciliation `ERROR` for required account scope                                      | `PENDING_REVIEW` unless a stronger deny/suspend applies                    | Reconciliation remains read-only; A4 cannot clear the error.                          |
| A3 reconciliation `WARNING`                                                               | Does not independently block unless profile requires a clean control state | The warning remains attached to evidence and must not be hidden.                      |

### 6.10 Limits and obligations

A4T04 defines only the common precedence boundary. A4T05 defines capability-specific limit profiles and usage enforcement.

| Limit evidence                                                               | Outcome                                                                                        | Rule                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Declared limit exceeded by known authoritative usage                         | `DENY`                                                                                         | A limit breach is a policy block for the declared action.                  |
| Current configured limits available and action is within limits              | `ALLOW_WITH_LIMITS` when the profile returns obligations/limits; otherwise continue to `ALLOW` | The result must carry exact currency-labelled limits/obligations.          |
| Required limit profile missing, stale, unavailable, or incompatible currency | `PENDING_REVIEW`                                                                               | Do not use caller-supplied values or a zero/default limit.                 |
| No limit profile required for the capability                                 | Continue                                                                                       | No artificial limit is invented.                                           |
| Limit read conflicts with currency/account context                           | `PENDING_REVIEW` or `DENY` if the request itself is invalid                                    | No conversion or source mutation; A4T05 defines exact capability handling. |

## 7. Conflict-resolution matrix

When evidence classes disagree, A4 records all applicable conditions and selects the strictest outcome. It does not rewrite any source.

| Conflict                                                              | Selected outcome                                                                    | Reason                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Customer `ACTIVE` versus `CLOSED`                                     | `DENY`                                                                              | Terminal customer lifecycle wins.                                                                |
| Customer `ACTIVE` versus `SUSPENDED`                                  | `SUSPEND`                                                                           | Reversible source suspension wins over active state.                                             |
| Eligibility `ELIGIBLE` versus `INELIGIBLE`/`REVOKED`                  | `DENY`                                                                              | Explicit eligibility block wins.                                                                 |
| Eligibility `ELIGIBLE` versus `SUSPENDED`                             | `SUSPEND`                                                                           | Explicit eligibility suspension wins.                                                            |
| Eligibility `ELIGIBLE` versus active `BLACKLISTED`                    | `DENY`                                                                              | Restriction block wins over eligibility.                                                         |
| Permission enabled versus active `FROZEN`/`BLACKLISTED`               | `SUSPEND`/`DENY` respectively                                                       | Permission cannot override restriction.                                                          |
| Enrollment `ACTIVE` versus eligibility `INELIGIBLE`/`REVOKED`         | `DENY`                                                                              | Enrollment cannot override eligibility.                                                          |
| Enrollment `ACTIVE` versus `FROZEN` restriction                       | `SUSPEND`                                                                           | Frozen source condition wins.                                                                    |
| Legacy `PROHIBITED` versus P1.10 `LOW`/`MEDIUM`/`HIGH`                | `DENY` for activation/product/financial capability                                  | Legacy prohibition remains explicit and is not silently remapped.                                |
| P1.10 `CRITICAL` versus low/current evidence                          | `PENDING_REVIEW` by default                                                         | Current critical evidence requires an explicit policy review; low evidence does not override it. |
| Open high/critical compliance case versus otherwise eligible customer | `PENDING_REVIEW` where compliance evidence is required                              | Case state is unresolved evidence, not an automatic finding.                                     |
| Binding `ACTIVE` versus `REPAIR_REQUIRED`/`STALE_BINDING`             | `PENDING_REVIEW`                                                                    | A3 control conflict cannot be silently resolved as active.                                       |
| Wallet `ACTIVE` versus Ledger inactive/incompatible                   | `PENDING_REVIEW`                                                                    | Ledger/Wallet financial dimensions remain authoritative; no source is changed.                   |
| Requested currency versus source currency mismatch                    | `DENY` for invalid request; `PENDING_REVIEW` for source drift                       | A4 never converts or rewrites currency.                                                          |
| Current source versus `UNAVAILABLE` duplicate read                    | `PENDING_REVIEW` unless a stronger explicit block applies                           | The failed read cannot be assumed current or empty.                                              |
| Current source versus stale source version                            | `PENDING_REVIEW` unless a stronger explicit block applies                           | No stale source is silently selected as current.                                                 |
| Current source versus soft-deleted source                             | Active/non-deleted source governs current use; deleted reference remains historical | If the active source cannot be established, `PENDING_REVIEW`; no deletion mutation.              |

## 8. Degraded-evidence model

“Degraded” means a required evidence set is not fully current or complete even if some source reads succeed. Degraded evidence includes:

- `INCOMPLETE` snapshot coverage;
- `UNAVAILABLE` source reads;
- stale/review-due source versions;
- conflicting ownership/dimensions/statuses;
- restricted fields not readable under the current A2 context;
- A3 reconciliation errors/warnings;
- missing current risk/compliance/eligibility/limit evidence where the profile requires it; and
- policy-profile/source-schema mismatch.

Rules:

1. Degraded evidence cannot produce `ALLOW` or `ALLOW_WITH_LIMITS`.
2. A stronger explicit `DENY` or `SUSPEND` remains the selected result when present.
3. Otherwise degraded evidence produces `PENDING_REVIEW`.
4. A degraded result carries safe reason codes, source references, freshness states, and correlation context.
5. A4 does not downgrade a source classification, hide a warning, or repair a source to remove degradation.
6. A transient read failure may be retried by a later A4 recovery path, but a retry creates a new snapshot and cannot mutate the old one.

## 9. Deterministic reason and result rules

For the same:

```text
contract version
+ policy version
+ capability/action
+ requested/as-of time
+ normalized evidence snapshot
+ declared policy context
```

the selected outcome, reason-code set, obligation/limit output, and freshness summary must be identical.

Reason-code rules:

- collect all applicable reasons, not only the first failed check;
- sort reason codes by precedence tier and then stable code order;
- preserve source references and versions for every reason that depends on source evidence;
- do not expose raw risk/compliance text in the reason code;
- do not create an A2 denial reason from an A4 policy result or vice versa; and
- do not report a repair, reconciliation, or source mutation as a policy success.

A `PENDING_REVIEW` result must state what evidence class or review condition is unresolved. A `DENY` result must identify the applicable policy block without exposing restricted source details. A `SUSPEND` result must identify the suspension class without instructing A4 to mutate the source.

## 10. Explicit A4T04 out of scope

This ADR does not:

- implement the evaluator or any runtime policy code;
- create capability profiles, product registry records, or limit-usage enforcement;
- create entities, migrations, services, controllers, APIs, repositories, or persistence;
- assemble source evidence or create the A4T03 snapshot;
- create customer-visible reason explanations or audience-specific disclosure rules beyond the safe boundary;
- modify Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A2, A3, Wallet, Ledger, Operations, or Reconciliation records; or
- implement A5 financial commands, external providers, settlement, screening, notifications, or product activation.

## Dependencies and references

- [`A4-IMPLEMENTATION-PLAN.md`](../A4-IMPLEMENTATION-PLAN.md)
- [`A4-POLICY-BASELINE.md`](../A4-POLICY-BASELINE.md)
- [`A4-SOURCE-EVIDENCE-MATRIX.md`](../A4-SOURCE-EVIDENCE-MATRIX.md)
- [`A4-CAPABILITY-INVENTORY.md`](../A4-CAPABILITY-INVENTORY.md)
- [`A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md`](../A4-SOURCE-EVIDENCE-ADAPTER-CONTRACT.md)
- [`A4-NORMALIZED-EVIDENCE-SNAPSHOT.md`](../A4-NORMALIZED-EVIDENCE-SNAPSHOT.md)
- [`A4-POLICY-REQUEST-RESULT-CONTRACT.md`](../A4-POLICY-REQUEST-RESULT-CONTRACT.md)
- [`ADR-0036-Customer-Capability-Policy-Authority.md`](ADR-0036-Customer-Capability-Policy-Authority.md)
- [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](../RISK-COMPLIANCE-AUTHORITY-REVIEW.md)
- [`CROSS-CUTTING-CONTRACTS.md`](../CROSS-CUTTING-CONTRACTS.md)
- [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](../IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)
- [`ADR-0002-Money-Representation.md`](ADR-0002-Money-Representation.md)
- [`ADR-0004-Wallet-and-Ledger.md`](ADR-0004-Wallet-and-Ledger.md)
- [`ADR-0005-Independent-Reconciliation.md`](ADR-0005-Independent-Reconciliation.md)
- [`ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md)

## A4T04 verification record

- [x] A normative strictness order is defined: `DENY > SUSPEND > PENDING_REVIEW > ALLOW_WITH_LIMITS > ALLOW`.
- [x] A2 authorization is explicitly kept outside A4 policy precedence.
- [x] Customer lifecycle, onboarding, eligibility, restrictions, risk, compliance, enrollment, permissions, A3 binding, Wallet/Ledger, reconciliation, and limit evidence have explicit baseline rules.
- [x] Missing, stale, deleted, unavailable, restricted, conflicting, and degraded evidence behavior is defined without silent optimistic defaults.
- [x] Legacy `PROHIBITED` and P1.10 `CRITICAL` risk vocabularies remain distinct with explicit outcomes.
- [x] Source conflicts preserve all evidence and never mutate a source or silently select a replacement authority.
- [x] Deterministic aggregation and reason-code ordering are defined.
- [x] `ALLOW_WITH_LIMITS` is reserved for current evidence with explicit limit/obligation output; usage enforcement remains later work.
- [x] No runtime evaluator, source adapter, entity, migration, service, controller, API, persistence, or financial behavior is implemented.
- [ ] A4T05 capability-specific product/enrollment/permission/limit profiles.
- [ ] A4T07 runtime evaluator implementation.
