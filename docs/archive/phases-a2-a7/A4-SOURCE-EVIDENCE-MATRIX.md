# A4T01 — Source-Evidence and Freshness Matrix

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T01 — Policy Baseline and Source-Evidence Inventory
- **Status:** Prepared as A4T01 input; normative precedence remains A4T04 work
- **Classification:** Documentation-only source ownership and read-boundary inventory
- **Application, database, API, migration, and runtime changes in this task:** None

## 1. Purpose

This matrix identifies the source records A4 may read, the owning authority, the minimum evidence fields currently available, freshness/version signals, data classification, permitted A4 use, and unsafe conditions that must not be silently converted into an allow result.

The matrix is an inventory, not a policy evaluator. It deliberately does not decide whether a particular missing, stale, conflicting, or restricted condition becomes `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, or `SUSPEND`. Capability-specific precedence is A4T04 work.

## 2. Evidence-state vocabulary

A4T01 uses the following neutral evidence states. They describe source quality and availability; they are not the A4 decision vocabulary.

| Evidence state | Meaning                                                                                                                                              | Required A4 treatment in later tasks                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `CURRENT`      | Source exists, is not deleted/closed beyond its allowed use, has the required version/timestamp, and satisfies the capability freshness requirement. | May be included in the normalized evidence snapshot.                                                           |
| `STALE`        | Source version, review date, timestamp, binding source version, or policy freshness requirement is no longer current.                                | Preserve the source reference and stale reason; never silently use it as current evidence.                     |
| `MISSING`      | Required source row or required source relationship does not exist.                                                                                  | Preserve the absence explicitly; do not fabricate a default source or allow.                                   |
| `DELETED`      | The row is soft-deleted or otherwise outside the active source set.                                                                                  | Treat as unavailable for active policy use while retaining the source reference for history/hold handling.     |
| `CONFLICTING`  | Two source values, dimensions, owners, or versions cannot be safely combined.                                                                        | Preserve all relevant source references and defer to the later precedence contract.                            |
| `UNAVAILABLE`  | The approved read contract fails, times out, or cannot establish a reliable snapshot.                                                                | Return controlled evidence-unavailable information; do not treat a failed read as an empty or positive source. |
| `RESTRICTED`   | The source exists but the current caller or policy path cannot read the required classified field.                                                   | Fail closed or require an approved higher-assurance/read scope; do not bypass classification.                  |

## 3. Source-to-owner-to-read matrix

| Evidence source                              | Current owner and repository artifact                                                                                                                                                                                             | Minimum current fields / states                                                                                                                                                                                                                                                                                                             | Version and freshness signals                                                                                                              | Classification                                           | Permitted A4 use                                                                                                                        | Unsafe or incomplete condition                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer identity and lifecycle              | [`Customer`](../src/customer/customer.entity.ts), [`customer.enums.ts`](../src/customer/customer.enums.ts) in `customer`                                                                                                          | `id`, `status` (`DRAFT`, `ACTIVE`, `SUSPENDED`, `CLOSED`), `version`, `updatedAt`, `deletedAt`; `reference` is lookup/display only                                                                                                                                                                                                          | `version`, `updatedAt`, `deletedAt`, read timestamp                                                                                        | Restricted                                               | Canonical policy subject and baseline lifecycle evidence                                                                                | Missing/deleted customer, non-active lifecycle, stale version, or use of `reference` as identity must not become an allow.                                                   |
| Onboarding workflow                          | [`CustomerOnboarding`](../src/customer-onboarding/customer-onboarding.entity.ts), [`CustomerOnboardingService`](../src/customer-onboarding/customer-onboarding.service.ts) in `customer-onboarding`                               | `status` (`NOT_STARTED`, `IN_PROGRESS`, `AWAITING_REVIEW`, `APPROVED`, `REJECTED`, `COMPLETED`), `version`, started/approved/rejected/completed timestamps                                                                                                                                                                                  | `version`, `updatedAt`, lifecycle timestamp, read timestamp                                                                                | Restricted                                               | Activation/readiness evidence for capabilities that require completed onboarding                                                        | Missing workflow, `REJECTED`, incomplete status, stale version, or readiness not evaluated must not be treated as completed evidence.                                        |
| Onboarding readiness                         | `CustomerOnboardingService.getReadiness` and [`customer-onboarding.types.ts`](../src/customer-onboarding/customer-onboarding.types.ts)                                                                                            | `status` (`READY`/`NOT_READY`), `canComplete`, `missing[]`, `checks`, `evaluatedAt`; checks include customer active, profile, address, identity document, agreements, tasks, risk allowed, and not rejected                                                                                                                                 | `evaluatedAt` plus source versions/timestamps used by the service                                                                          | Restricted                                               | Minimized readiness evidence; the source records remain authoritative                                                                   | A readiness projection is stale when its source snapshot is stale or changed; `READY` is not A2 authorization or an A4 allow.                                                |
| Eligibility status                           | [`CustomerEligibility`](../src/customer-eligibility/customer-eligibility.entity.ts) and [`CustomerEligibilityService`](../src/customer-eligibility/customer-eligibility.service.ts) in `customer-eligibility`                     | `customerId`, `onboardingId`, `status` (`PENDING`, `ELIGIBLE`, `INELIGIBLE`, `SUSPENDED`, `REVOKED`), `reason`, `statusChangedAt`, `reviewedBy`, `version`, `updatedAt`, `deletedAt`                                                                                                                                                        | `version`, `statusChangedAt`, `updatedAt`, `deletedAt`, read timestamp                                                                     | Restricted                                               | Current eligibility source input for a declared capability/action                                                                       | Missing, deleted, pending, ineligible, suspended, revoked, or stale eligibility requires explicit later policy handling.                                                     |
| Active restrictions                          | [`CustomerRestriction`](../src/customer-eligibility/customer-restriction.entity.ts) and eligibility enums/service                                                                                                                 | `type` (`NONE`, `LIMITED`, `MANUAL_REVIEW`, `FROZEN`, `BLACKLISTED`), `isActive`, `reason`, `version`, `updatedAt`, `deletedAt`                                                                                                                                                                                                             | `version`, `updatedAt`, active flag, deletion state, read timestamp                                                                        | Restricted to Highly Restricted when reason is sensitive | Blocking, review, or limited-capability evidence according to a later precedence rule                                                   | A restriction read that omits active rows, is stale, or is unauthorized cannot be treated as no restriction.                                                                 |
| Customer limit profile                       | [`CustomerLimitProfile`](../src/customer-eligibility/customer-limit-profile.entity.ts) and eligibility service                                                                                                                    | `currency`, daily transaction count, daily/single/monthly transaction amounts in minor units, wallet-balance limit in minor units, `version`, `updatedAt`, `deletedAt`                                                                                                                                                                      | `version`, `updatedAt`, currency, deletion state, read timestamp                                                                           | Restricted financial/customer data                       | Configured policy-limit input with explicit currency and exact integer values                                                           | Missing, deleted, stale, or currency-incompatible profile; caller-supplied limits from `LimitEngine` are not authoritative customer configuration.                           |
| Product enrollment                           | [`CustomerProductEnrollment`](../src/customer-eligibility/customer-product-enrollment.entity.ts) and eligibility service                                                                                                          | `customerId`, normalized `product`, `status` (`PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`), `reason`, `statusChangedAt`, `version`, `updatedAt`, `deletedAt`                                                                                                                                                                                 | `version`, `statusChangedAt`, `updatedAt`, deletion state, read timestamp                                                                  | Restricted                                               | Capability/product enrollment input; product string is an existing metadata namespace, not yet the A4 capability namespace              | Missing, deleted, pending, suspended, closed, stale, or ambiguous product enrollment must not be treated as active enrollment.                                               |
| Operating permissions                        | [`CustomerOperatingPermission`](../src/customer-eligibility/customer-operating-permission.entity.ts) and [`customer-eligibility.enums.ts`](../src/customer-eligibility/customer-eligibility.enums.ts)                             | Permission `type` (`DEPOSIT`, `WITHDRAW`, `TRANSFER`, `PAYMENT`, `BILL_PAYMENT`, `AIRTIME`, `CARD`, `VIRTUAL_ACCOUNT`, `QR_PAYMENT`, `USSD`, `API`), `enabled`, `reason`, `version`, `updatedAt`, `deletedAt`                                                                                                                               | `version`, `updatedAt`, enabled flag, deletion state, read timestamp                                                                       | Restricted                                               | Capability-input metadata after a later action mapping                                                                                  | An enabled permission is not an A2 authorization decision; missing, stale, or duplicate permission records require explicit handling.                                        |
| Onboarding-era risk metadata                 | [`customer-onboarding/customer-risk-profile.entity.ts`](../src/customer-onboarding/customer-risk-profile.entity.ts) and onboarding enums/service                                                                                  | `riskLevel` (`LOW`, `MEDIUM`, `HIGH`, `PROHIBITED`), rationale, assessor, `isCurrent`, `version`, timestamps, `deletedAt`                                                                                                                                                                                                                   | `version`, `updatedAt`, `isCurrent`, deletion state, read timestamp                                                                        | Highly Restricted                                        | Historical/compatibility evidence only until an explicit mapping is defined                                                             | `PROHIBITED` cannot be silently converted to P1.10 `CRITICAL`; missing or historical-only evidence cannot be treated as current assessment evidence.                         |
| P1.10 manual risk profile                    | [`CustomerRiskProfile`](../src/customer-risk-profile/customer-risk-profile.entity.ts), [`CustomerRiskProfileService`](../src/customer-risk-profile/customer-risk-profile.service.ts), history entities in `customer-risk-profile` | `status` (`ACTIVE`, `CLOSED`), `assessmentDate`, `assessedBy`, `assessmentMethod`, `overallRiskLevel` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), `reviewDueDate`, notes, `version`, timestamps, `deletedAt`                                                                                                                                     | `version`, `assessmentDate`, `reviewDueDate`, `updatedAt`, status, deletion state, read timestamp                                          | Highly Restricted                                        | Preferred manual risk evidence; use only the minimum fields needed by the capability policy                                             | Closed/deleted profile, review due date passed, missing factors, stale version, or restricted notes must not be replaced by a low-risk default.                              |
| Risk factors and history                     | [`CustomerRiskFactor`](../src/customer-risk-profile/customer-risk-factor.entity.ts), factor/profile history entities and service                                                                                                  | Factor category, score, weight, remarks, profile ID/version, history action/time; current factors are soft-deleted/replaced on reassessment                                                                                                                                                                                                 | Factor/profile version, created/updated timestamps, deletion state, assessment date                                                        | Highly Restricted                                        | Explainability or rule input only where the capability profile explicitly requires it                                                   | A single factor is not a policy decision; raw remarks and sensitive reasoning must not enter broad policy responses.                                                         |
| Compliance case state                        | [`CustomerComplianceCase`](../src/customer-compliance/customer-compliance-case.entity.ts), compliance enums/service/history                                                                                                       | `category` (`KYC`, `AML`, `SANCTIONS`, `FRAUD`, `PEP`, `DOCUMENT`, `ACCOUNT_REVIEW`, `MANUAL_REVIEW`, `OTHER`), `severity` (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), `status` (`OPEN`, `UNDER_REVIEW`, `PENDING_CUSTOMER`, `ESCALATED`, `RESOLVED`, `CLOSED`), assignment, resolution, opened/closed time, `version`, `updatedAt`, `deletedAt` | `version`, `updatedAt`, opened/closed time, status, deletion state, read timestamp                                                         | Highly Restricted                                        | Minimized case category/severity/status/resolution reference where a policy rule requires it                                            | Case existence or category alone is not an automated screening result; comments and evidence metadata are restricted by default.                                             |
| A3 customer/account binding                  | [`CustomerFinancialAccountBinding`](../src/wallet/customer-financial-account-binding.entity.ts), [`customer-financial-account-read.types.ts`](../src/wallet/customer-financial-account-read.types.ts), A3 handoff docs            | Customer UUID, CustomerWallet UUID, WalletAccount UUID, LedgerAccount UUID, `currency`, `accountingUnit`, binding `state` (`PENDING`, `ACTIVE`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`), source customer/wallet versions, binding version, control references                                                                             | Binding source versions, binding version, `updatedAt`, A3 reconciliation timestamp/status, read timestamp                                  | Highly Restricted financial/control data                 | Account existence, exact identity relationship, dimensions, lifecycle, and control-state input for capabilities that require an account | `MISSING_BINDING`, `STALE_BINDING`, `REPAIR_REQUIRED`, non-active state, ownership mismatch, or unresolved reconciliation discrepancy cannot become active account evidence. |
| A3 account read and Ledger-derived balance   | [`CustomerFinancialAccountReadService`](../src/wallet/customer-financial-account-read.service.ts), A3 read types, [`LedgerService`](../src/ledger/ledger.service.ts)                                                              | Read states include `ACTIVE`, `PENDING`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`, `MISSING_BINDING`, `STALE_BINDING`, `LEDGER_UNAVAILABLE`; active balance is returned from Ledger and is not stored by A3                                                                                                                                 | A3 source-version checks, Ledger read timestamp, currency/accounting unit, A3 warnings/control status                                      | Highly Restricted financial data                         | Use account/control state; request a current Ledger-derived value only through an approved capability contract when truly required      | A balance read is not policy authority, not account ownership, and not a stored policy snapshot. `LEDGER_UNAVAILABLE` is not zero balance.                                   |
| Wallet and Ledger source dimensions          | [`WalletAccount`](../src/wallet/wallet-account.entity.ts), [`LedgerAccount`](../src/ledger/ledger-account.entity.ts), Wallet/Ledger services                                                                                      | Wallet status/currency/ledgerAccountId; Ledger account type, normal balance, currency, accounting unit, negative-balance setting, active state                                                                                                                                                                                              | Current source read timestamp; A3 binding carries customer and CustomerWallet source versions; no universal A4 freshness policy exists yet | Highly Restricted financial control data                 | Verify account compatibility and financial dimensions for a capability input                                                            | A4 cannot change wallet/ledger state or infer a customer binding from opaque `WalletAccount.customerId`, account code, alias, or currency.                                   |
| A2 principal and authorization context       | [`authorization.types.ts`](../src/authorization/authorization.types.ts), [`AuthorizationService`](../src/authorization/authorization.service.ts), A2 threat/route evidence                                                        | Principal type, principal ID, optional customer UUID/session/audience, roles, scopes, customer access, assigned customers, assurance; decision allowed/reason, resource, action, required scopes/roles, evaluatedAt                                                                                                                         | `evaluatedAt`, session/token lifecycle, request/correlation/trace context, current authorization decision                                  | Restricted to Highly Restricted security data            | Separate access context and request correlation; verify that a caller may request/read a policy decision                                | A2 `allowed` is not product eligibility; missing, stale, revoked, or unauthorized context cannot be replaced by customer metadata.                                           |
| Operations audit/idempotency/request context | [`CROSS-CUTTING-CONTRACTS.md`](CROSS-CUTTING-CONTRACTS.md), Operations services/entities                                                                                                                                          | Audit event entity/action/actor/safe values; idempotency scope/key/request hash/status; request/correlation/trace IDs                                                                                                                                                                                                                       | Audit occurrence, idempotency expiry/status, request attempt IDs, correlation/trace timestamps                                             | Confidential to Highly Restricted by payload             | Correlate and protect retryable A4 decisions; preserve minimum source references and outcome evidence                                   | Correlation IDs, request IDs, idempotency keys, and audit IDs are not customer identity, policy input truth, or authorization credentials.                                   |
| A3 reconciliation/control evidence           | [`ReconciliationService`](../src/reconciliation/reconciliation.service.ts), A3 discrepancy types, A3 integration matrix                                                                                                           | Report status, generatedAt, checked counts, discrepancy type, severity, owner, recovery state, scope, source IDs, message                                                                                                                                                                                                                   | `generatedAt`, query/read transaction, source versions, report status                                                                      | Highly Restricted financial/control data                 | Control signal for unresolved binding/account evidence and release/read behavior                                                        | Reconciliation is read-only. A4 cannot call repair or mutate source rows to produce an allow.                                                                                |

## 4. Read-contract and ownership rules

### 4.1 A4 may read

- Canonical customer and source record IDs required for the declared capability.
- Source status/lifecycle, versions, timestamps, deletion state, and normalized evidence values required by the capability profile.
- A3 binding/account state and exact financial dimensions through the A3/Wallet/Ledger read boundaries.
- A2 principal/authorization context as a separate security input.
- Operations correlation/idempotency/audit context required to make a decision traceable.

### 4.2 A4 must not read by default

- Passwords, password hashes, access/session tokens, reset tokens, recovery codes, MFA proofs, device fingerprints, or privileged action fingerprints.
- Full KYC documents, raw identity-document contents, unrestricted compliance comments/evidence, raw risk notes, or broad customer profile payloads.
- Full ledger history, journal lines, account activity, or balances unless a specific capability contract establishes a minimum necessary Ledger-derived read.
- Other customers’ source data merely because a support or service principal exists.

### 4.3 A4 must not write

A4T01 establishes no A4 write authority over Customer, onboarding, eligibility, restrictions, limits, enrollments, permissions, risk profiles/factors, compliance cases, CustomerWallet, A3 bindings, WalletAccount, LedgerAccount, journals, lines, balances, Reconciliation, or A2 security records.

## 5. Freshness and reproducibility observations

The repository currently provides mixed freshness signals rather than one A4 freshness contract:

| Signal                        | Current sources                                                                                         | A4T01 observation                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Optimistic version            | Customer Foundation records, A3 binding, risk, compliance, eligibility, limits, enrollment, permissions | Preserve source version in the future normalized evidence snapshot where present.                       |
| `updatedAt` / `createdAt`     | Most TypeORM entities                                                                                   | Useful for ordering and audit context, but not sufficient by itself to define capability freshness.     |
| Status-change timestamps      | Onboarding, eligibility, enrollment, restrictions, compliance lifecycle                                 | Preserve when a policy rule depends on the recency of a state transition.                               |
| Risk review due date          | P1.10 `CustomerRiskProfile.reviewDueDate`                                                               | A policy may need to classify a profile as review-due/stale; A4T04 defines the outcome.                 |
| A3 source versions            | Customer and CustomerWallet versions stored on the binding                                              | A3 already distinguishes stale binding source snapshots; A4 must not discard that state.                |
| Authorization evaluation time | A2 `AuthorizationDecision.evaluatedAt`                                                                  | Authorization must be current for the protected request; it is separate from source evidence freshness. |
| Reconciliation report time    | A3/reconciliation `generatedAt`                                                                         | Control evidence is time-bound and cannot be treated as a repair or source update.                      |
| Ledger read time/dimensions   | Ledger-derived balance/read response                                                                    | A current financial read is a point-in-time input, not a mutable A4 balance authority.                  |

A4T01 does not choose freshness windows. A4T02-A4T05 must define capability-specific freshness, source-version requirements, and stale/conflict behavior.

## 6. Minimum normalized evidence shape for later A4 design

The following is an inventory shape for A4T02/A4T03 review, not a runtime DTO or implementation:

```text
PolicyEvidenceSnapshot
  subject
    customerId
    customerStatus
    customerVersion
    customerDeleted
  onboarding
    status
    readinessStatus
    readinessEvaluatedAt
    version
  eligibility
    status
    version
    statusChangedAt
  restrictions[]
    type
    active
    version
  limits
    profileVersion
    currency
    configuredLimits
  enrollment[]
    product
    status
    version
  permissions[]
    type
    enabled
    version
  risk
    sourceKind
    profileVersion
    status
    riskLevel
    assessmentDate
    reviewDueDate
    factorReferences
  complianceCases[]
    category
    severity
    status
    resolutionReference
    version
  accountBinding
    bindingId
    customerWalletId
    walletAccountId
    ledgerAccountId
    state
    currency
    accountingUnit
    sourceVersions
    controlState
  accessContext
    principalType
    principalId
    customerScope
    assurance
    authorizationDecisionReference
  evidenceContext
    collectedAt
    sourceReferences[]
    freshnessStates[]
    normalizedInputHash
```

The final shape must be capability-specific and privacy-minimized. A4 must not persist this entire envelope as a replacement for the source records.

## 7. A4T01 validation record

- [x] Source owners and read roles are identified for all planned A4 evidence classes.
- [x] Current source fields, states, version/timestamp signals, deletion behavior, and classification are recorded.
- [x] A2 principal/authorization context is kept separate from A4 policy evidence.
- [x] A3 binding/account/read/control states are kept separate from A4 policy outcomes and Ledger financial truth.
- [x] Missing, stale, deleted, conflicting, unavailable, and restricted evidence states are defined without assigning final policy precedence.
- [x] Existing local decision views and caller-supplied limit evaluation are not promoted to central policy authority.
- [x] No runtime customer values or sensitive source payloads were copied into this documentation.
- [x] No application source, entity, migration, service, controller, API, test, or runtime behavior was changed.
