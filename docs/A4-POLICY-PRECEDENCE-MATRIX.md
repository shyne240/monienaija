# A4T04 — Policy Precedence and Conflict Matrix

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T04 — Policy State Vocabulary and Precedence Matrix
- **Status:** Prepared as the normative A4T04 policy decision input
- **Related ADR:** [`ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md`](ADR/ADR-0037-Risk-Restriction-Compliance-and-Limit-Precedence.md)
- **Classification:** Documentation-only policy decision and conflict matrix
- **Application, database, API, migration, persistence, and runtime changes in this task:** None

## 1. Purpose

This matrix defines how a later A4 evaluator must combine normalized evidence from A4T03 into one deterministic outcome for the A4T02 request/result contract.

It covers:

- customer lifecycle and onboarding;
- eligibility and restrictions;
- risk and compliance evidence;
- product enrollment and operating permissions;
- A3 binding, Wallet, Ledger, and reconciliation control state;
- configured limits and obligations;
- missing, stale, deleted, unavailable, restricted, conflicting, and degraded evidence; and
- deterministic aggregation, reason collection, and conflict outcomes.

It does not implement an evaluator. It does not create source records, policy records, or financial behavior.

## 2. Result strictness order

A later evaluator must select the strictest applicable result:

```text
DENY
  > SUSPEND
  > PENDING_REVIEW
  > ALLOW_WITH_LIMITS
  > ALLOW
```

The strictness order is applied after the A2 access gate. An A2 denial is an access result and does not become an A4 policy `DENY`.

| Priority | Result              | Meaning                                                                                               |
| -------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| 1        | `DENY`              | An explicit terminal, invalid, prohibited, or exceeded condition prevents the declared policy action. |
| 2        | `SUSPEND`           | An explicit reversible suspension makes the declared action unavailable.                              |
| 3        | `PENDING_REVIEW`    | Evidence is unresolved, stale, unavailable, conflicting, restricted, or awaiting review.              |
| 4        | `ALLOW_WITH_LIMITS` | All required evidence passes and explicit current limits/obligations constrain the action.            |
| 5        | `ALLOW`             | All required evidence passes and no limit/obligation changes the outcome.                             |

A selected result never authorizes A2 access, changes an A3 binding, or executes an A5 financial command.

## 3. Baseline source-state matrix

### 3.1 Customer and onboarding

| Evidence class       | State                                             | Policy result                                | Reason family                           | Notes                                                         |
| -------------------- | ------------------------------------------------- | -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Customer             | Missing/deleted                                   | `DENY`                                       | `IDENTITY_MISSING` / `IDENTITY_DELETED` | No valid policy subject exists.                               |
| Customer             | `CLOSED`                                          | `DENY`                                       | `CUSTOMER_CLOSED`                       | Terminal lifecycle.                                           |
| Customer             | `SUSPENDED`                                       | `SUSPEND`                                    | `CUSTOMER_SUSPENDED`                    | A4 does not reactivate the customer.                          |
| Customer             | `DRAFT`                                           | `PENDING_REVIEW`                             | `CUSTOMER_NOT_ACTIVE`                   | Not a current active source for activation-dependent actions. |
| Customer             | `ACTIVE`                                          | Continue                                     | None                                    | Other source classes still apply.                             |
| Onboarding           | Missing when required                             | `PENDING_REVIEW`                             | `ONBOARDING_MISSING`                    | Absence is not completion.                                    |
| Onboarding           | `NOT_STARTED` / `IN_PROGRESS` / `AWAITING_REVIEW` | `PENDING_REVIEW` when completion is required | `ONBOARDING_INCOMPLETE`                 | Workflow is unresolved.                                       |
| Onboarding           | `APPROVED` but not `COMPLETED`                    | `PENDING_REVIEW` when completion is required | `ONBOARDING_NOT_COMPLETED`              | Approval is evidence, not authorization or completion.        |
| Onboarding           | `REJECTED`                                        | `DENY` for activation-dependent action       | `ONBOARDING_REJECTED`                   | Rejected workflow cannot satisfy activation.                  |
| Onboarding           | `COMPLETED` with current readiness                | Continue                                     | None                                    | Other evidence classes still apply.                           |
| Onboarding/readiness | Stale/unavailable/restricted                      | `PENDING_REVIEW`                             | `ONBOARDING_EVIDENCE_DEGRADED`          | Never replace with an optimistic ready state.                 |

### 3.2 Eligibility and restrictions

| Evidence class | State                                | Policy result                                  | Reason family                   | Notes                                                                       |
| -------------- | ------------------------------------ | ---------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| Eligibility    | Missing when required                | `PENDING_REVIEW`                               | `ELIGIBILITY_MISSING`           | No eligibility is inferred.                                                 |
| Eligibility    | `PENDING`                            | `PENDING_REVIEW`                               | `ELIGIBILITY_PENDING`           | Eligibility is unresolved.                                                  |
| Eligibility    | `ELIGIBLE`                           | Continue                                       | None                            | Does not override restrictions, risk, compliance, A3, or A2.                |
| Eligibility    | `INELIGIBLE` / `REVOKED`             | `DENY`                                         | `ELIGIBILITY_BLOCKED`           | Explicit source block.                                                      |
| Eligibility    | `SUSPENDED`                          | `SUSPEND`                                      | `ELIGIBILITY_SUSPENDED`         | Reversible source unavailability.                                           |
| Eligibility    | Stale/unavailable/conflicting        | `PENDING_REVIEW` unless stronger result exists | `ELIGIBILITY_EVIDENCE_DEGRADED` | Preserve all source references.                                             |
| Restriction    | Active `BLACKLISTED`                 | `DENY`                                         | `RESTRICTION_BLACKLISTED`       | Highest restriction block; no low-risk or enrollment evidence overrides it. |
| Restriction    | Active `FROZEN`                      | `SUSPEND`                                      | `RESTRICTION_FROZEN`            | A4 does not change the restriction.                                         |
| Restriction    | Active `MANUAL_REVIEW`               | `PENDING_REVIEW`                               | `RESTRICTION_MANUAL_REVIEW`     | Review is unresolved.                                                       |
| Restriction    | Active `LIMITED`                     | Continue to limit evaluation                   | `RESTRICTION_LIMITED`           | May lead to `ALLOW_WITH_LIMITS` only after all other gates pass.            |
| Restriction    | `NONE` / no active restriction       | Continue                                       | None                            | A complete current read is required when restrictions are required.         |
| Restriction    | Missing/unavailable/stale/restricted | `PENDING_REVIEW` when required                 | `RESTRICTION_EVIDENCE_DEGRADED` | A failed restriction read is not no restriction.                            |

### 3.3 Risk and compliance

| Evidence class  | State                                                             | Policy result                                                                       | Reason family                   | Notes                                                                            |
| --------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| Legacy risk     | `PROHIBITED`                                                      | `DENY` for activation/product/financial capability                                  | `LEGACY_RISK_PROHIBITED`        | Explicit historical prohibition; not relabelled as P1.10 `CRITICAL`.             |
| Legacy risk     | `LOW`/`MEDIUM`/`HIGH` only                                        | `PENDING_REVIEW` when a current P1.10 profile is required                           | `CURRENT_RISK_EVIDENCE_MISSING` | Historical evidence cannot silently replace current evidence.                    |
| P1.10 risk      | Missing when required                                             | `PENDING_REVIEW`                                                                    | `RISK_PROFILE_MISSING`          | No low-risk default.                                                             |
| P1.10 risk      | `CRITICAL` current                                                | `PENDING_REVIEW` by default                                                         | `RISK_CRITICAL_REVIEW`          | A capability profile may make this stricter, never silently allow it.            |
| P1.10 risk      | `HIGH` current                                                    | `PENDING_REVIEW` where profile requires review; otherwise profile-controlled        | `RISK_HIGH`                     | No global silent equivalence to prohibited. An unmapped required use is pending. |
| P1.10 risk      | `MEDIUM`/`LOW` current and complete                               | Continue                                                                            | None                            | A score/factor cannot override stronger evidence.                                |
| P1.10 risk      | Closed, review-due, stale, unavailable, restricted, or incomplete | `PENDING_REVIEW` when required                                                      | `RISK_EVIDENCE_DEGRADED`        | Preserve dates, versions, and source kind.                                       |
| Compliance case | Open/under-review/escalated/pending-customer, high/critical       | `PENDING_REVIEW` where compliance evidence is required                              | `COMPLIANCE_REVIEW_OPEN`        | Case evidence is not an automated screening conclusion.                          |
| Compliance case | Open, low/medium                                                  | Profile-controlled; default `PENDING_REVIEW` where the profile requires case review | `COMPLIANCE_CASE_OPEN`          | Category/severity/status mapping is explicit in the later capability profile.    |
| Compliance case | Resolved/closed                                                   | Continue with historical reference                                                  | None                            | Resolution does not erase history or automatically create a block.               |
| Compliance case | Missing when no case exists                                       | Neutral if the profile does not require a case; `PENDING_REVIEW` if required        | `COMPLIANCE_EVIDENCE_MISSING`   | No case is not the same as a screening result.                                   |
| Compliance case | Stale/unavailable/restricted/conflicting                          | `PENDING_REVIEW` when required                                                      | `COMPLIANCE_EVIDENCE_DEGRADED`  | No unrestricted case payload is copied.                                          |

### 3.4 Enrollment and permissions

| Evidence class | State                                    | Policy result    | Reason family                  | Notes                                            |
| -------------- | ---------------------------------------- | ---------------- | ------------------------------ | ------------------------------------------------ |
| Enrollment     | Required row missing                     | `DENY`           | `ENROLLMENT_REQUIRED`          | No active entitlement is established.            |
| Enrollment     | `PENDING`                                | `PENDING_REVIEW` | `ENROLLMENT_PENDING`           | Not active.                                      |
| Enrollment     | `ACTIVE`                                 | Continue         | None                           | Does not override source blocks or A2.           |
| Enrollment     | `SUSPENDED`                              | `SUSPEND`        | `ENROLLMENT_SUSPENDED`         | Product use is unavailable.                      |
| Enrollment     | `CLOSED`                                 | `DENY`           | `ENROLLMENT_CLOSED`            | Terminal enrollment cannot be treated as active. |
| Enrollment     | Stale/unavailable/conflicting            | `PENDING_REVIEW` | `ENROLLMENT_EVIDENCE_DEGRADED` | Do not select another product record.            |
| Permission     | Required row missing                     | `DENY`           | `PERMISSION_MISSING`           | Absence is not permission.                       |
| Permission     | `enabled = false`                        | `DENY`           | `PERMISSION_DISABLED`          | Explicit source decision blocks the action.      |
| Permission     | `enabled = true` and current             | Continue         | None                           | Not A2 authorization.                            |
| Permission     | Stale/unavailable/restricted/conflicting | `PENDING_REVIEW` | `PERMISSION_EVIDENCE_DEGRADED` | Do not assume enabled or disabled.               |

### 3.5 A3 binding, Wallet, Ledger, and control evidence

| Evidence class  | State                                                | Policy result                                                            | Reason family                                     | Notes                                              |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------- |
| A3 binding      | Required binding missing                             | `PENDING_REVIEW`                                                         | `BINDING_MISSING`                                 | A4 cannot infer or choose an account.              |
| A3 binding      | `PENDING`                                            | `PENDING_REVIEW`                                                         | `BINDING_PENDING`                                 | Provisioning/confirmation is incomplete.           |
| A3 binding      | `ACTIVE` with current compatible sources             | Continue                                                                 | None                                              | Necessary, not sufficient, for an A4 allow.        |
| A3 binding      | `SUSPENDED`                                          | `SUSPEND`                                                                | `BINDING_SUSPENDED`                               | A4 cannot reactivate.                              |
| A3 binding      | `REPAIR_REQUIRED`                                    | `PENDING_REVIEW`                                                         | `BINDING_REPAIR_REQUIRED`                         | A3 recovery/reconciliation owns the issue.         |
| A3 binding      | `STALE_BINDING`                                      | `PENDING_REVIEW`                                                         | `BINDING_STALE`                                   | Source versions must be revalidated.               |
| A3 binding      | `CLOSED`                                             | `DENY`                                                                   | `BINDING_CLOSED`                                  | Binding identity is terminal.                      |
| A3 read/control | `LEDGER_UNAVAILABLE`                                 | `PENDING_REVIEW`                                                         | `LEDGER_READ_UNAVAILABLE`                         | Never normalize unavailable balance to zero.       |
| Wallet/Ledger   | Source dimension mismatch or inactive Ledger account | `PENDING_REVIEW`                                                         | `ACCOUNT_DIMENSION_CONFLICT` / `ACCOUNT_INACTIVE` | No account mutation or compatibility repair by A4. |
| Reconciliation  | Required scope `ERROR`                               | `PENDING_REVIEW` unless stronger result exists                           | `RECONCILIATION_ERROR`                            | Reconciliation remains read-only.                  |
| Reconciliation  | `WARNING`                                            | Does not independently block unless profile requires clean control state | `RECONCILIATION_WARNING`                          | Warning remains in evidence and cannot be hidden.  |

### 3.6 Limits and obligations

| Evidence class   | State                                                          | Policy result                                                   | Reason family             | Notes                                         |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------- | --------------------------------------------- |
| Configured limit | Known authoritative usage exceeds declared limit               | `DENY`                                                          | `LIMIT_EXCEEDED`          | A4 does not mutate usage or balance.          |
| Configured limit | Current profile and usage are available and within constraints | `ALLOW_WITH_LIMITS` when the profile returns limits/obligations | `LIMITED_ALLOW`           | Exact currency-labelled output is required.   |
| Limit profile    | Missing/stale/unavailable/incompatible when required           | `PENDING_REVIEW`                                                | `LIMIT_EVIDENCE_DEGRADED` | Do not use caller-supplied or default values. |
| Limit profile    | Not required by capability profile                             | Continue                                                        | None                      | No artificial limit is invented.              |

## 4. Conflict-resolution matrix

The following pairwise conflicts are normative defaults. All applicable evidence and reason references remain in the snapshot/result.

| Conflicting evidence                                      | Winning outcome                                               | Reason                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Customer `ACTIVE` vs `CLOSED`                             | `DENY`                                                        | Terminal customer state wins.                                                |
| Customer `ACTIVE` vs `SUSPENDED`                          | `SUSPEND`                                                     | Reversible suspension wins over active state.                                |
| Eligibility `ELIGIBLE` vs `INELIGIBLE`/`REVOKED`          | `DENY`                                                        | Explicit eligibility block wins.                                             |
| Eligibility `ELIGIBLE` vs `SUSPENDED`                     | `SUSPEND`                                                     | Eligibility suspension wins.                                                 |
| Eligibility `ELIGIBLE` vs active `BLACKLISTED`            | `DENY`                                                        | Restriction block wins.                                                      |
| Permission enabled vs active `BLACKLISTED`                | `DENY`                                                        | Permission cannot override blacklist.                                        |
| Permission enabled vs active `FROZEN`                     | `SUSPEND`                                                     | Permission cannot override freeze.                                           |
| Enrollment `ACTIVE` vs eligibility `INELIGIBLE`/`REVOKED` | `DENY`                                                        | Enrollment cannot override eligibility.                                      |
| Enrollment `ACTIVE` vs `FROZEN`                           | `SUSPEND`                                                     | Freeze makes use unavailable.                                                |
| Legacy `PROHIBITED` vs current low/medium/high risk       | `DENY` for activation/product/financial capability            | Explicit legacy prohibition wins without vocabulary erasure.                 |
| P1.10 `CRITICAL` vs low/current evidence                  | `PENDING_REVIEW` by default                                   | Critical evidence requires explicit review; low evidence cannot override it. |
| Open high/critical compliance case vs otherwise eligible  | `PENDING_REVIEW` where compliance is required                 | Open case is unresolved evidence, not an automatic screening finding.        |
| A3 `ACTIVE` vs `REPAIR_REQUIRED`/`STALE_BINDING`          | `PENDING_REVIEW`                                              | A3 control conflict cannot be silently treated as active.                    |
| Wallet `ACTIVE` vs Ledger inactive/incompatible           | `PENDING_REVIEW`                                              | Financial dimension conflict remains unresolved.                             |
| Requested currency vs source currency mismatch            | `DENY` for invalid request; `PENDING_REVIEW` for source drift | No conversion or source mutation.                                            |
| Current source vs unavailable duplicate read              | `PENDING_REVIEW` unless stronger block exists                 | Failed read cannot be treated as empty/current.                              |
| Current source vs stale source version                    | `PENDING_REVIEW` unless stronger block exists                 | Stale source cannot be selected silently.                                    |

## 5. Degraded-evidence matrix

| Degraded condition                      | Snapshot representation                        | Default outcome                         | Allow exception                                                                                     |
| --------------------------------------- | ---------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Required source class absent            | `MISSING` item and `INCOMPLETE` collection     | `PENDING_REVIEW`                        | None for required evidence; explicit terminal source blocks remain stronger.                        |
| Source read timeout/failure             | `UNAVAILABLE` item or `UNAVAILABLE` collection | `PENDING_REVIEW`                        | None; retry creates a new collection/snapshot.                                                      |
| Required source version assertion fails | `STALE` item                                   | `PENDING_REVIEW`                        | None for a capability that requires current evidence.                                               |
| Risk review due date passed             | `STALE` risk item                              | `PENDING_REVIEW`                        | Only a capability profile that does not require current risk may continue.                          |
| Source relationship/ownership mismatch  | `CONFLICTING` item(s)                          | `PENDING_REVIEW`                        | Explicit `DENY`/`SUSPEND` conditions still win.                                                     |
| Restricted field not readable           | `RESTRICTED` item                              | `PENDING_REVIEW`                        | None without a new authorized read context.                                                         |
| A3 reconciliation `ERROR`               | Control evidence with error                    | `PENDING_REVIEW`                        | Stronger terminal/suspension outcome may win.                                                       |
| A3 reconciliation `WARNING`             | Control evidence with warning                  | Profile-controlled                      | A profile may permit continuation only if it explicitly accepts the warning.                        |
| Policy profile/source-schema mismatch   | Snapshot/profile conflict                      | `PENDING_REVIEW` or safe contract error | Never an implicit allow.                                                                            |
| Mixed current and degraded sources      | Complete item set plus degraded states         | Strictest applicable outcome            | An unrelated optional source may remain neutral only when the profile explicitly marks it optional. |

General rule: degraded evidence never produces `ALLOW` or `ALLOW_WITH_LIMITS` for a capability that requires that evidence.

## 6. Deterministic aggregation model

The later evaluator must implement the following logical behavior:

```text
if A2 access gate is not admitted:
    return A2 access denial; do not create an A4 policy result

validate customer subject, capability, action, contract, and policy profile
collect one immutable A4T03 snapshot
collect every applicable source condition and reason
map each condition to an outcome tier
selectedOutcome = strictest(outcomes)

if selectedOutcome is DENY, SUSPEND, or PENDING_REVIEW:
    return selectedOutcome with all applicable safe reasons/references

if current limit/obligation constraints apply:
    return ALLOW_WITH_LIMITS with exact currency-labelled output

return ALLOW
```

The logical algorithm must be deterministic for identical:

```text
contractVersion
+ policyVersion
+ capability/action
+ requested/as-of time
+ declared context
+ normalized snapshot
```

Reason codes are sorted by precedence tier, then stable code order. Source references are sorted using the snapshot ordering contract. No evaluator may short-circuit in a way that loses a stronger or independently relevant source condition.

## 7. Scenario matrix

| Scenario                                                                                                                                          | Required evidence                          | Expected baseline outcome                              | Reason                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Active customer, completed onboarding, eligible, no active restriction, current risk/compliance, active enrollment/permission, current A3 binding | All required classes `CURRENT`             | `ALLOW` or `ALLOW_WITH_LIMITS`                         | Final limit/obligation profile determines the last step.         |
| Eligible customer with active blacklist                                                                                                           | Eligibility plus `BLACKLISTED` restriction | `DENY`                                                 | Blacklist is a terminal restriction block.                       |
| Eligible customer with active frozen restriction                                                                                                  | Eligibility plus `FROZEN` restriction      | `SUSPEND`                                              | Freeze is a reversible source suspension.                        |
| Customer onboarding awaiting review                                                                                                               | Onboarding `AWAITING_REVIEW`               | `PENDING_REVIEW` for activation-dependent capability   | Completion evidence is unresolved.                               |
| Customer eligibility revoked                                                                                                                      | Eligibility `REVOKED`                      | `DENY`                                                 | Explicit eligibility block.                                      |
| Current P1.10 `CRITICAL` risk with no hard restriction                                                                                            | Risk profile current/critical              | `PENDING_REVIEW` by default                            | Critical risk requires explicit policy review.                   |
| Legacy `PROHIBITED` risk with current low P1.10 risk                                                                                              | Both risk source kinds present             | `DENY` for activation/product/financial capability     | Explicit legacy prohibition is not silently remapped.            |
| Open high compliance case with otherwise eligible source                                                                                          | Compliance case open/high                  | `PENDING_REVIEW` where compliance evidence is required | Case is unresolved evidence, not automated screening.            |
| Active enrollment but disabled required permission                                                                                                | Enrollment active, permission disabled     | `DENY`                                                 | Enrollment cannot grant a disabled operation.                    |
| Active permission but enrollment closed                                                                                                           | Permission enabled, enrollment closed      | `DENY`                                                 | Permission cannot grant a closed product entitlement.            |
| Active binding with stale CustomerWallet source version                                                                                           | A3 `STALE_BINDING`                         | `PENDING_REVIEW`                                       | A4 cannot use stale account ownership evidence.                  |
| Active binding with Ledger unavailable                                                                                                            | A3 `LEDGER_UNAVAILABLE`                    | `PENDING_REVIEW`                                       | No fabricated balance/account state.                             |
| Current all-source evidence with configured limit within usage                                                                                    | Current limit and usage                    | `ALLOW_WITH_LIMITS`                                    | Limit obligation must be returned exactly and currency-labelled. |
| Current all-source evidence with known limit exceeded                                                                                             | Limit usage exceeds configured limit       | `DENY`                                                 | Explicit limit block.                                            |
| Required evidence read unavailable                                                                                                                | `UNAVAILABLE`                              | `PENDING_REVIEW`                                       | Retry/recovery is separate and source-preserving.                |

## 8. Ownership and prohibited edges

- A4 does not write Customer, onboarding, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, CustomerWallet, A3 binding, WalletAccount, LedgerAccount, journal, line, balance, or reconciliation records.
- A4 does not resolve a conflict by rewriting a source or selecting a replacement account.
- A2 authorization is never inferred from an enabled permission or an `ALLOW` policy result.
- An A3 `ACTIVE` binding is never inferred from a policy result, customer reference, alias, payment reference, provider ID, or balance.
- Compliance cases remain case evidence; no case state is silently transformed into automated screening output.
- A4 does not turn `SUSPEND`, `DENY`, or `PENDING_REVIEW` into source lifecycle commands.
- Reconciliation and readiness remain read-only controls.
- No financial journal, line, balance, opening value, fee, or external-provider state is created by precedence evaluation.

## 9. Explicit A4T04 out of scope

This matrix does not:

- implement a runtime evaluator or source adapter;
- define every capability-specific enrollment, permission, product, or limit profile;
- create policy entities, migrations, services, controllers, APIs, persistence, or tests;
- create customer-visible reason explanations or unrestricted support views;
- mutate or repair any source, A3 binding, Wallet, Ledger, Operations, or Reconciliation record; or
- begin A4T05, A4T06, A4T07, A4T08, A4T09, A4T10, or A5.

## 10. A4T04 verification record

- [x] Normative outcome strictness is defined.
- [x] Customer lifecycle and onboarding precedence is defined.
- [x] Eligibility and restriction precedence is defined.
- [x] Risk source-kind, risk level, review-due, and legacy `PROHIBITED` behavior is defined.
- [x] Compliance case category/severity/status behavior is defined without creating a screening engine.
- [x] Enrollment and permission precedence is defined.
- [x] A3 binding/read, Wallet/Ledger, and reconciliation control precedence is defined.
- [x] Configured-limit and obligation outcomes are bounded without beginning A4T05 enforcement implementation.
- [x] Missing, stale, deleted, unavailable, restricted, conflicting, and degraded evidence behavior is explicit.
- [x] Conflicts preserve source evidence and do not mutate source records.
- [x] Deterministic aggregation, reason collection, and ordering rules are defined.
- [x] No runtime evaluation or application behavior is implemented.
- [ ] A4T05 capability-specific profiles and limit enforcement contract.
- [ ] A4T07 deterministic policy evaluator.
