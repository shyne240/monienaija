# A4T05 — Capability Profile and Limit Contract

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T05 — Product Eligibility, Enrollment, Permission, and Limit Contract
- **Contract:** `A4-CAPABILITY-PROFILE.v1`
- **Status:** Proposed capability-profile contract; no runtime evaluator
- **Owner:** A4 Capability & Policy Engine boundary
- **Application, database, API, migration, persistence, and runtime changes in this task:** None

## 1. Purpose and boundary

This document defines the capability-specific policy profile used to request evidence, evaluate product eligibility, require enrollment and permission, apply A4T04 precedence, return obligations, and evaluate exact configured limits.

A profile is a declarative policy contract. It is not:

- an entity or persisted policy definition;
- a product catalogue;
- a source record or source writer;
- A2 authentication/authorization;
- A3 account binding;
- a financial command; or
- a runtime evaluator.

Profile persistence and policy-version storage are A4T06. Runtime profile/evidence evaluation is A4T07. Customer-visible explanation mapping is A4T08.

## 2. Logical profile contract

```text
CapabilityPolicyProfileV1
  profileKey
  profileVersion
  capability
  actions[]
  subjectType: CUSTOMER
  evidenceRequirements
    customer
    onboarding
    eligibility
    restrictions
    limits
    enrollment
    permissions
    risk
    compliance
    accountBinding
    authorization
  productEligibility
  enrollmentRequirement
  permissionRequirement
  riskRequirement
  complianceRequirement
  accountBindingRequirement
  limitRequirement
  allowedDecisions[]
  obligations[]
  consumerGates[]
```

### 2.1 Profile identity

- `profileKey` is an A4-owned lowercase policy key, distinct from a source product string.
- `profileVersion` is immutable once used for a decision.
- `capability` and `actions[]` use the A4T02 namespace grammar.
- A profile applies only to `subjectType = CUSTOMER` in version one.
- A profile cannot be selected from a customer reference, wallet alias, payment reference, provider ID, route path, or idempotency key.
- An unregistered, deprecated, or unavailable profile produces the A4T04 safe contract/non-allow path.

## 3. Evidence requirement contract

Each source class has one profile requirement mode:

| Mode                  | Profile meaning                                                                       | Missing/stale/unavailable behavior                                                          |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `REQUIRED_CURRENT`    | Current source version/timestamp/freshness and source identity are required.          | `PENDING_REVIEW` unless a stronger A4T04 outcome applies.                                   |
| `REQUIRED_ACTIVE`     | Source record must be current and in the active source state required by the profile. | Explicit closed/disabled absence can be `DENY`; unreadable/stale state is `PENDING_REVIEW`. |
| `REQUIRED_IF_CONTEXT` | Required only when declared product/channel/currency/account context applies.         | Apply the mode for the declared context; otherwise `NOT_APPLICABLE`.                        |
| `OPTIONAL_REFERENCE`  | Source may add evidence/reason context but is not a blocking prerequisite.            | Absence is neutral; an explicit blocking state still follows A4T04.                         |
| `NOT_USED`            | Profile does not use the source class.                                                | Do not collect unrelated fields.                                                            |

### 3.1 Evidence requirement rules

- `Customer.id` and current customer lifecycle are required for every customer profile.
- A2 authorization is a separate required consumer gate for protected policy requests/reads, even when the profile does not use customer product evidence.
- A3 binding/account evidence is required only for profiles whose action needs a financial account or account-specific state.
- Risk and compliance requirements are explicit per profile; a profile cannot silently use a low-risk source as a replacement for missing current risk evidence.
- A profile may require a source reference without copying the source payload.
- A profile cannot weaken an explicit A4T04 `DENY` or `SUSPEND` condition.

## 4. Product eligibility contract

`productEligibility` declares the source combination required for a capability/action. It is a derived policy condition, not a write to `CustomerEligibility`.

```text
ProductEligibilityRequirement
  customerLifecycle: ACTIVE_REQUIRED
  onboarding: COMPLETED_REQUIRED | CURRENT_REQUIRED | NOT_REQUIRED
  eligibility: ELIGIBLE_REQUIRED | CURRENT_REQUIRED | NOT_REQUIRED
  restrictions: NO_BLOCKING_RESTRICTION | PROFILE_CONTROLLED | NOT_REQUIRED
  risk: CURRENT_REQUIRED | PROFILE_CONTROLLED | NOT_REQUIRED
  compliance: CURRENT_REQUIRED | PROFILE_CONTROLLED | NOT_REQUIRED
  accountState: ACTIVE_REQUIRED | PROFILE_CONTROLLED | NOT_REQUIRED
```

Baseline rules:

- `CLOSED`, `INELIGIBLE`, `REVOKED`, and `BLACKLISTED` are terminal policy blocks under A4T04.
- `SUSPENDED`/`FROZEN` source states are suspension outcomes under A4T04.
- `PENDING_REVIEW`, stale, unavailable, conflicting, or restricted evidence is never silently accepted as current.
- `ELIGIBLE` does not override risk, compliance, enrollment, permission, A3, or A2 requirements.
- `canOperate` from the existing operating-status projection is not a substitute for this profile contract.

## 5. Enrollment evaluation contract

### 5.1 Enrollment modes

| Mode                | Required source behavior                                                                                  | Profile result boundary                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQUIRED_ACTIVE`   | A matching `CustomerProductEnrollment` product key exists, is not deleted, current, and `ACTIVE`.         | Active enrollment can pass this gate; missing/closed is `DENY`, pending is `PENDING_REVIEW`, suspended is `SUSPEND`.                                |
| `REQUIRED_CURRENT`  | A matching enrollment exists and is current; profile defines whether non-active state is review or block. | No active entitlement is inferred from a stale or ambiguous row.                                                                                    |
| `NOT_REQUIRED`      | No existing enrollment is required for the action.                                                        | Absence is neutral; eligibility/restriction/permission gates still apply.                                                                           |
| `ENROLLMENT_ACTION` | The action creates/changes enrollment through its source owner.                                           | Existing active enrollment is not required; A4 only decides whether the requested enrollment action is permitted. A4 does not execute the mutation. |

### 5.2 Enrollment key mapping

The profile owns an explicit mapping:

```text
A4 capability/action key
  -> source CustomerProductEnrollment.product key
```

The mapping must:

- preserve the source owner's normalized product key;
- be versioned with the profile;
- never infer a product key from a route, customer reference, alias, or provider ID; and
- never create a second product registry in A4T05.

## 6. Permission evaluation contract

### 6.1 Permission modes

| Mode               | Required source behavior                                                                           | Profile result boundary                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `REQUIRED_ENABLED` | Matching `CustomerOperatingPermission.type` exists, is current, not deleted, and `enabled = true`. | Missing/disabled is `DENY`; stale/unavailable/conflicting is `PENDING_REVIEW`. |
| `REQUIRED_CURRENT` | Matching permission row is readable/current; profile may define the action-specific enabled state. | Unknown current state is not treated as enabled.                               |
| `NOT_REQUIRED`     | No Customer Operating Permission is used by the profile.                                           | A2 authorization remains required where the request is protected.              |

### 6.2 Baseline permission mappings

| A4 capability family      | Candidate action              | Source permission type                                  |
| ------------------------- | ----------------------------- | ------------------------------------------------------- |
| `wallet.transfer`         | `create`                      | `TRANSFER`                                              |
| `wallet.deposit`          | `create`/`complete`           | `DEPOSIT`                                               |
| `wallet.withdrawal`       | `create`/`process`/`complete` | `WITHDRAW`                                              |
| `wallet.payment`          | `create`/`use`                | `PAYMENT`                                               |
| `product.virtual-account` | `use`/`deactivate`            | `VIRTUAL_ACCOUNT`                                       |
| `channel.api`             | `use`                         | `API`                                                   |
| `customer.product`        | `enroll`/`activate`           | Profile-controlled; no universal permission is inferred |

These mappings are policy-profile inputs. They do not transfer ownership of the source permission enum or replace A2 route/action authorization.

## 7. Risk and compliance requirements by profile

A profile must choose one risk and one compliance requirement mode. The profile may be stricter than the A4T04 baseline, but never less strict than an explicit terminal/suspension outcome.

### 7.1 Risk modes

- `CURRENT_REQUIRED`: current P1.10 profile, factor completeness, assessment date, review due date, and source version are required.
- `PROFILE_CONTROLLED`: profile declares whether `HIGH`/`CRITICAL`/legacy evidence requires review or denial.
- `NOT_REQUIRED`: no risk evidence is collected for the declared action; this does not authorize a financial/product action by itself.

`ONBOARDING_LEGACY` risk evidence may be retained as a reference. A profile cannot silently treat legacy `PROHIBITED` as P1.10 `CRITICAL`; A4T04 defines the terminal `DENY` baseline for activation/product/financial capability.

### 7.2 Compliance modes

- `CURRENT_REQUIRED`: current case state relevant to the profile must be collected, minimized, and fresh.
- `PROFILE_CONTROLLED`: category, severity, status, and resolution mapping is declared by the profile.
- `NOT_REQUIRED`: no compliance case state is required for the declared action; this does not create a screening result.

Open/under-review/escalated/pending-customer high/critical case evidence remains `PENDING_REVIEW` where required. Case creation is never treated as automatic AML, sanctions, fraud, PEP, or transaction-monitoring output.

## 8. A3 account-binding requirement

Profiles that require a financial account declare one mode:

| Mode                  | Required A3/account state                                                                                                                                  | Result boundary                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ACTIVE_REQUIRED`     | Explicit A3 binding is `ACTIVE`; Customer/CustomerWallet/Wallet/Ledger relationships, currency, accounting unit, and control state are current/compatible. | `PENDING`, `STALE_BINDING`, `REPAIR_REQUIRED`, `MISSING_BINDING`, or `LEDGER_UNAVAILABLE` cannot allow; `SUSPENDED`/`CLOSED` follow A4T04. |
| `CURRENT_REQUIRED`    | A3 binding/account evidence is current for the requested context, with action-specific active-state rules.                                                 | No account inference or reassignment.                                                                                                      |
| `REQUIRED_IF_CONTEXT` | Account evidence is required only when target binding/account context is declared.                                                                         | A4 does not discover an account from an opaque value or currency.                                                                          |
| `NOT_REQUIRED`        | Capability does not require a financial account at policy stage.                                                                                           | A2 and all other declared policy gates remain.                                                                                             |

A4 profiles do not mutate A3 binding, WalletAccount, LedgerAccount, journals, lines, balances, reconciliation, or readiness records.

## 9. Exact limit-evaluation contract

### 9.1 Limit requirement modes

| Mode                               | Meaning                                                                                          | Missing/unsupported behavior                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `NOT_APPLICABLE`                   | No limit evaluation is part of the capability/action profile.                                    | `NOT_APPLICABLE`; no artificial limit is created.                                |
| `CONFIGURATION_REQUIRED`           | CustomerLimitProfile configuration is required, but usage is evaluated by a downstream boundary. | Missing/stale/incompatible configuration is `PENDING_REVIEW`.                    |
| `USAGE_REQUIRED`                   | Authoritative current usage must be supplied by the later command/usage boundary.                | Missing/stale/unavailable usage is `PENDING_REVIEW`.                             |
| `CONFIGURATION_AND_USAGE_REQUIRED` | Both source-owned configuration and current usage are required.                                  | Any missing/stale/unavailable input is `PENDING_REVIEW`; known breach is `DENY`. |

### 9.2 Authoritative configuration shape

The source-owned configuration is the following logical value from `CustomerLimitProfile`:

```text
ConfiguredCustomerLimitsV1
  profileVersion
  currency
  dailyTransactionCount?
  dailyTransactionAmountMinor?
  singleTransactionAmountMinor?
  monthlyTransactionAmountMinor?
  walletBalanceMinor?
```

Rules:

- `profileVersion` is required when the profile is used.
- Currency is an uppercase three-letter code and is required for every monetary field.
- Amounts are non-negative integer minor-unit strings.
- Count is a non-negative integer.
- `null`/absent means the dimension is not configured; it does not mean zero.
- Caller-supplied configuration in the existing `LimitEngine` request is not authoritative A4 configuration.

### 9.3 Usage/context shape

```text
PolicyLimitUsageContextV1
  amountMinor
  currency
  dailyUsedCount?
  dailyUsedAmountMinor?
  monthlyUsedAmountMinor?
  projectedWalletBalanceMinor?
  usageAsOf
  usageSourceReference
```

Rules:

- `amountMinor` is a positive integer minor-unit string for an amount-bearing action.
- Every amount is in the declared currency.
- `dailyUsedCount`, `dailyUsedAmountMinor`, `monthlyUsedAmountMinor`, and `projectedWalletBalanceMinor` are authoritative usage/read inputs from a later approved command/financial read boundary, not caller-controlled policy configuration.
- `projectedWalletBalanceMinor` may be used only when the profile declares a wallet-balance limit and the Ledger-derived read contract supplies it.
- A4 does not calculate, reserve, debit, credit, or persist usage/balance.

### 9.4 Limit evaluation result shape

```text
PolicyLimitEvaluationV1
  status: NOT_APPLICABLE | WITHIN_LIMITS | EXCEEDED | INCOMPATIBLE | UNAVAILABLE
  capability
  action
  profileVersion
  currency?
  checks[]
    dimension
    configuredValue?
    observedValue?
    proposedValue?
    remainingValue?
    passed
    reasonCode?
  effectiveLimits
  usageAsOf?
  evaluatedAt
  limitReference?
```

Supported check dimensions:

```text
SINGLE_TRANSACTION_AMOUNT
DAILY_TRANSACTION_COUNT
DAILY_TRANSACTION_AMOUNT
MONTHLY_TRANSACTION_AMOUNT
WALLET_BALANCE
```

Evaluation rules:

- `SINGLE_TRANSACTION_AMOUNT`: proposed amount must be less than or equal to configured single-transaction amount when configured.
- `DAILY_TRANSACTION_COUNT`: current usage count plus the declared operation must be less than or equal to configured daily count when configured.
- `DAILY_TRANSACTION_AMOUNT`: current daily used amount plus proposed amount must be less than or equal to configured daily amount when configured.
- `MONTHLY_TRANSACTION_AMOUNT`: current monthly used amount plus proposed amount must be less than or equal to configured monthly amount when configured.
- `WALLET_BALANCE`: projected Ledger-derived wallet balance must satisfy configured wallet-balance limit when configured; A4 does not derive or store the balance.
- `WITHIN_LIMITS` returns the exact configured dimensions and remaining values appropriate to the profile.
- `EXCEEDED` maps to A4T04 `DENY`.
- `INCOMPATIBLE` maps to `DENY` for an invalid request or `PENDING_REVIEW` for source/currency drift according to A4T04.
- `UNAVAILABLE` maps to `PENDING_REVIEW`.

### 9.5 Existing LimitEngine boundary

The current [`LimitEngine`](../src/limit/limit.engine.ts) is compatibility decision tooling:

- it accepts caller-supplied configuration and usage;
- it supports `TRANSFER`, `DEPOSIT`, and `WITHDRAWAL` payment types;
- it evaluates single, daily amount, and monthly amount checks; and
- it does not evaluate daily count, wallet-balance caps, A4 policy profiles, or source-owned `CustomerLimitProfile` configuration.

A4T05 defines the required source/usage contract but does not modify or replace the existing engine. A later implementation task must reconcile this compatibility boundary before treating it as an A4 policy implementation.

## 10. Capability profile matrix

The following profiles are the initial A4 contract set derived from A4T01/A4T02. They are profile definitions, not activated products or runtime behavior.

| Profile key                              | Capability/action                 | Customer/onboarding                                | Eligibility/restrictions                                  | Enrollment                                                        | Permission                                                     | Risk/compliance                             | A3 binding                                            | Limits                                                      | Allowed policy result set                                         |
| ---------------------------------------- | --------------------------------- | -------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `profile.wallet-transfer-create.v1`      | `wallet.transfer` / `create`      | Customer `ACTIVE`; onboarding `COMPLETED_REQUIRED` | `ELIGIBLE_REQUIRED`; no blocking restriction              | `REQUIRED_ACTIVE` for mapped transfer product where declared      | `REQUIRED_ENABLED: TRANSFER`                                   | `CURRENT_REQUIRED` / `CURRENT_REQUIRED`     | `ACTIVE_REQUIRED`                                     | `CONFIGURATION_AND_USAGE_REQUIRED`                          | `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, `SUSPEND` |
| `profile.wallet-deposit-create.v1`       | `wallet.deposit` / `create`       | Customer `ACTIVE`; onboarding `COMPLETED_REQUIRED` | `ELIGIBLE_REQUIRED`; no blocking restriction              | `REQUIRED_ACTIVE` where deposit product enrollment is declared    | `REQUIRED_ENABLED: DEPOSIT`                                    | `CURRENT_REQUIRED` / `CURRENT_REQUIRED`     | `ACTIVE_REQUIRED`                                     | `CONFIGURATION_AND_USAGE_REQUIRED`                          | `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, `SUSPEND` |
| `profile.wallet-withdrawal-create.v1`    | `wallet.withdrawal` / `create`    | Customer `ACTIVE`; onboarding `COMPLETED_REQUIRED` | `ELIGIBLE_REQUIRED`; no blocking restriction              | `REQUIRED_ACTIVE` where withdrawal product enrollment is declared | `REQUIRED_ENABLED: WITHDRAW`                                   | `CURRENT_REQUIRED` / `CURRENT_REQUIRED`     | `ACTIVE_REQUIRED`                                     | `CONFIGURATION_AND_USAGE_REQUIRED`                          | `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, `SUSPEND` |
| `profile.wallet-payment-create.v1`       | `wallet.payment` / `create`       | Customer `ACTIVE`; onboarding `COMPLETED_REQUIRED` | `ELIGIBLE_REQUIRED`; no blocking restriction              | `REQUIRED_ACTIVE` for mapped payment product                      | `REQUIRED_ENABLED: PAYMENT`                                    | `CURRENT_REQUIRED` / `CURRENT_REQUIRED`     | `ACTIVE_REQUIRED` when wallet-backed                  | `CONFIGURATION_AND_USAGE_REQUIRED` where configured         | `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, `SUSPEND` |
| `profile.customer-product-enroll.v1`     | `customer.product` / `enroll`     | Customer `ACTIVE`; onboarding `COMPLETED_REQUIRED` | `ELIGIBLE_REQUIRED`; no `BLACKLISTED`/`FROZEN`            | `ENROLLMENT_ACTION`                                               | `NOT_REQUIRED` unless a product profile declares one           | `PROFILE_CONTROLLED` / `PROFILE_CONTROLLED` | `NOT_REQUIRED` unless the product requires an account | `NOT_APPLICABLE` unless the enrollment has a declared limit | `ALLOW`, `PENDING_REVIEW`, `DENY`, `SUSPEND`                      |
| `profile.product-virtual-account-use.v1` | `product.virtual-account` / `use` | Customer `ACTIVE`; onboarding `CURRENT_REQUIRED`   | `ELIGIBLE_REQUIRED`; no blocking restriction              | `REQUIRED_ACTIVE` mapped to the source product key                | `REQUIRED_ENABLED: VIRTUAL_ACCOUNT`                            | `PROFILE_CONTROLLED` / `PROFILE_CONTROLLED` | `REQUIRED_IF_CONTEXT`                                 | `NOT_APPLICABLE` unless profile adds a declared limit       | `ALLOW`, `PENDING_REVIEW`, `DENY`, `SUSPEND`                      |
| `profile.wallet-account-read.v1`         | `wallet.account` / `read`         | Customer current where customer-scoped             | A3/read-state controlled; no product eligibility implied  | `NOT_REQUIRED`                                                    | `NOT_REQUIRED` in policy; A2 authorization required separately | `NOT_REQUIRED`                              | `CURRENT_REQUIRED`                                    | `NOT_APPLICABLE`                                            | `ALLOW`, `PENDING_REVIEW`, `DENY`, `SUSPEND`                      |
| `profile.channel-api-use.v1`             | `channel.api` / `use`             | Customer current where customer-scoped             | `ELIGIBLE_REQUIRED` when customer capability is requested | `REQUIRED_ACTIVE` where product enrollment declares API access    | `REQUIRED_ENABLED: API` plus A2 service/audience gate          | `PROFILE_CONTROLLED` / `PROFILE_CONTROLLED` | `REQUIRED_IF_CONTEXT`                                 | `NOT_APPLICABLE` unless a product profile declares one      | `ALLOW`, `PENDING_REVIEW`, `DENY`, `SUSPEND`                      |

### 10.1 Profile interpretation rules

- A profile row declares required evidence; it does not grant the result by itself.
- A4T04 strictness and conflict rules apply to every profile.
- `ALLOW_WITH_LIMITS` is available only when the profile declares limit/obligation output and the limit result is `WITHIN_LIMITS`.
- A profile cannot make `BLACKLISTED`, explicit terminal lifecycle, known exceeded limits, or closed required enrollment into an allow.
- A profile cannot convert A2 authorization into eligibility or an A3 binding into policy permission.
- Candidate profile keys remain documentation until a later policy-version/evaluator implementation registers them.

## 11. Obligations by capability boundary

Profiles may declare obligations such as:

| Obligation                        | Applicable boundary                     | Meaning                                                                          |
| --------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| `RECHECK_A2_AUTHORIZATION`        | All protected requests                  | Consumer must verify current A2 authorization before execution/read exposure.    |
| `RECHECK_A3_BINDING`              | Account-required capability             | Consumer must re-read explicit binding/account state before financial execution. |
| `RECHECK_EXECUTION_LIMIT`         | Amount/usage-bearing capability         | Later command/usage boundary must evaluate current usage and configured limits.  |
| `REQUIRE_ACTIVE_ENROLLMENT`       | Enrolled product capability             | Consumer must confirm matching active source enrollment.                         |
| `REQUIRE_CURRENT_RISK_REVIEW`     | Profile requiring current risk          | Current manual risk/review evidence must remain valid.                           |
| `MANUAL_REVIEW_REQUIRED`          | Review outcome                          | No execution until a later policy decision resolves review.                      |
| `RECONCILIATION_CONTROL_REQUIRED` | Profile requiring clean account control | Consumer must not treat an unresolved required A3 control error as active.       |

Obligations are policy output references. They do not instruct A4 to mutate the source and do not replace the downstream command contract.

## 12. Explicit A4T05 out of scope

This contract does not:

- implement profile resolution, enrollment evaluation, permission evaluation, limit evaluation, or runtime policy evaluation;
- create or update CustomerEligibility, enrollment, permission, restriction, risk, compliance, CustomerWallet, A3 binding, WalletAccount, or Ledger records;
- create a product registry, product activation flow, usage ledger, or financial command;
- create entities, migrations, services, controllers, APIs, repositories, persistence, or tests;
- implement policy-version storage, decision history, or immutable profile persistence;
- modify or replace the current `LimitEngine`; or
- begin A4T06, A4T07, A4T08, A4T09, A4T10, A5, A6, A7, or A8.

## 13. A4T05 verification record

- [x] The logical capability-profile contract and profile requirement modes are defined.
- [x] Product eligibility requirements are separated from source ownership and A2 authorization.
- [x] Enrollment modes and source product-key mapping rules are defined.
- [x] Permission modes and initial capability-to-permission mappings are defined.
- [x] Risk and compliance requirement modes preserve A4T04 precedence and source vocabulary.
- [x] A3 account-binding requirement modes and consumer gates are defined.
- [x] Exact limit configuration, usage-context, check dimensions, statuses, and result semantics are defined.
- [x] Current `LimitEngine` limitations and compatibility boundary are documented without changing code.
- [x] Initial customer capability profiles are defined without activating products or financial commands.
- [x] Obligations and downstream consumer boundaries are defined.
- [x] No evaluator, entity, migration, service, controller, API, persistence, test, or runtime behavior is implemented.
- [ ] A4T06 policy-profile/version and decision persistence.
- [ ] A4T07 runtime policy evaluation.
