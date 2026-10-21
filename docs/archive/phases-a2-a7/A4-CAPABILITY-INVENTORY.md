# A4T01 — Capability and Policy-Input Inventory

- **Phase:** A4 — Capability & Policy Engine
- **Task:** A4T01 — Policy Baseline and Source-Evidence Inventory
- **Status:** Capability inventory prepared; A4T02 owns the normative namespace and policy contract
- **Classification:** Documentation-only capability-input and handoff inventory
- **Application, database, API, migration, and runtime changes in this task:** None

## 1. Purpose and scope

This inventory records current capability-shaped metadata, route actions, local decision surfaces, limit tooling, account-state inputs, and candidate policy scopes visible in the committed repository.

The entries labelled **candidate** are not the final A4 capability/action namespace. A4T02 must define the canonical namespace, normalization, versioning, and request/result contract. A4T01 must not rename current source values, add a product registry, or wire policy behavior into financial services.

## 2. Current capability-shaped source inputs

| Current input               | Owner / artifact                                                                                                          | Current values or shape                                                                                                         | Current meaning                        | A4T01 classification                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| Eligibility status          | `customer-eligibility` / [`CustomerEligibility`](../src/customer-eligibility/customer-eligibility.entity.ts)              | `PENDING`, `ELIGIBLE`, `INELIGIBLE`, `SUSPENDED`, `REVOKED`                                                                     | Current source eligibility state       | Policy input; not final A4 decision                                             |
| Restriction type            | `customer-eligibility` / [`CustomerRestriction`](../src/customer-eligibility/customer-restriction.entity.ts)              | `NONE`, `LIMITED`, `MANUAL_REVIEW`, `FROZEN`, `BLACKLISTED` with `isActive`                                                     | Current restriction metadata           | Policy input; precedence is A4T04                                               |
| Product enrollment          | `customer-eligibility` / [`CustomerProductEnrollment`](../src/customer-eligibility/customer-product-enrollment.entity.ts) | Normalized product string plus `PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`                                                       | Product/capability enrollment metadata | Policy input; no product registry exists                                        |
| Operating permission type   | [`customer-eligibility.enums.ts`](../src/customer-eligibility/customer-eligibility.enums.ts)                              | `DEPOSIT`, `WITHDRAW`, `TRANSFER`, `PAYMENT`, `BILL_PAYMENT`, `AIRTIME`, `CARD`, `VIRTUAL_ACCOUNT`, `QR_PAYMENT`, `USSD`, `API` | Customer operating-permission metadata | Candidate capability mapping; not A2 authorization                              |
| Customer limit profile      | `customer-eligibility` / [`CustomerLimitProfile`](../src/customer-eligibility/customer-limit-profile.entity.ts)           | Daily count, daily/single/monthly amount, wallet-balance limit, explicit currency                                               | Stored configuration                   | Policy-limit input; usage enforcement is downstream                             |
| Onboarding readiness        | `customer-onboarding` / [`CustomerOnboardingService`](../src/customer-onboarding/customer-onboarding.service.ts)          | `READY`/`NOT_READY`, `canComplete`, missing checks                                                                              | Workflow evidence                      | Activation prerequisite input; not authorization                                |
| Manual risk profile         | `customer-risk-profile` / [`CustomerRiskProfile`](../src/customer-risk-profile/customer-risk-profile.entity.ts)           | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`; active/closed; review due date; factors                                                    | Manual assessment evidence             | Policy input; not automated risk screening                                      |
| Onboarding-era risk profile | `customer-onboarding` / [`customer-risk-profile.entity.ts`](../src/customer-onboarding/customer-risk-profile.entity.ts)   | `LOW`, `MEDIUM`, `HIGH`, `PROHIBITED`; current marker                                                                           | Historical compatibility evidence      | Policy input only after explicit vocabulary mapping                             |
| Compliance case             | `customer-compliance` / [`CustomerComplianceCase`](../src/customer-compliance/customer-compliance-case.entity.ts)         | Categories, severity, status, assignment, resolution                                                                            | Investigation/workflow evidence        | Policy input by approved category/severity/status rules; not a screening result |
| Customer lifecycle          | `customer` / [`customer.enums.ts`](../src/customer/customer.enums.ts)                                                     | `DRAFT`, `ACTIVE`, `SUSPENDED`, `CLOSED`                                                                                        | Identity lifecycle                     | Baseline capability gate input                                                  |
| Customer-wallet lifecycle   | `customer-wallet`                                                                                                         | `PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`                                                                                      | Provisioning metadata lifecycle        | A3/account capability input; not a policy source writer                         |
| A3 binding/read state       | A3 binding/read contracts                                                                                                 | `ACTIVE`, `PENDING`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`, `MISSING_BINDING`, `STALE_BINDING`, `LEDGER_UNAVAILABLE`         | Customer-to-account control/read state | Financial capability input; not policy authorization                            |
| A2 authorization context    | `AuthorizationPrincipal` / `AuthorizationDecision`                                                                        | Principal type, roles, scopes, customer scope, assurance, allowed/denied                                                        | Runtime access decision                | Separate access prerequisite; not product eligibility                           |

## 3. Existing local decision surfaces

These surfaces are implemented before A4 and must be treated as source or compatibility behavior, not as a central A4 result.

| Surface                            | Current contract                                                                                                                                             | Current route/service                                                                         | What it does not provide                                                                                                      | A4 disposition                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Onboarding readiness               | `status`, `canComplete`, `missing[]`, evidence checks, `evaluatedAt`                                                                                         | `CustomerOnboardingService.getReadiness`; `GET /api/v1/customers/:id/onboarding-readiness`    | No policy version, reason catalogue, A2 authorization result, A3 account state, or capability-specific outcome                | Read as onboarding evidence; do not wrap or rename as A4 allow/deny.                         |
| Operating status                   | `status`, `canOperate`, eligibility status, active restrictions, active enrollments, enabled permissions, blocked reasons                                    | `CustomerEligibilityService.getOperatingStatus`; `GET /api/v1/customers/:id/operating-status` | Does not include P1.10 risk, compliance precedence, A3 control state, policy version, source hash, or capability/action scope | Compatibility projection only; A4 reassembles source evidence.                               |
| Eligibility transition gate        | Requires completed onboarding and no active blacklist for `ELIGIBLE`; active enrollment requires eligible and no active frozen restriction                   | `CustomerEligibilityService` mutation logic                                                   | Does not define all future capability precedence or A2 access                                                                 | Preserve source transition rules; A4 consumes resulting state.                               |
| Limit profile                      | Persists configured exact limits and currency                                                                                                                | Customer eligibility limit-profile routes                                                     | Does not track transaction usage or produce a versioned capability decision                                                   | Treat as configuration input.                                                                |
| `LimitEngine`                      | Caller supplies customer/wallet/payment type/amount/limits/usage; returns `allowed`, reasons, remaining limits; supports `TRANSFER`, `DEPOSIT`, `WITHDRAWAL` | `POST /api/v1/limits/evaluate`; [`LimitEngine`](../src/limit/limit.engine.ts)                 | Does not read `CustomerLimitProfile`, policy versions, restrictions, risk, compliance, enrollment, A2, or A3 evidence         | Compatibility evaluator; A4T05 defines the boundary to future command enforcement.           |
| Manual risk assessment             | Creates/reassesses current profile and records factor/profile history                                                                                        | `CustomerRiskProfileService`; `/api/v1/customers/:id/risk-profile`                            | Does not evaluate capability access or automated screening                                                                    | Evidence authority only.                                                                     |
| Compliance case lifecycle          | Creates/updates cases, assignments, comments, evidence, resolution, and history                                                                              | `CustomerComplianceService`; `/api/v1/customers/:id/compliance-cases`                         | Does not produce a screening or policy result                                                                                 | Evidence authority only.                                                                     |
| A3 customer financial account read | Returns authorized account views, binding/read state, warnings, and Ledger-derived balance for a fresh active binding                                        | `CustomerFinancialAccountReadService`; no A3 controller route                                 | Does not decide product eligibility or authorize financial execution                                                          | Read account/control evidence only; A4 must not store balance as policy truth.               |
| A2 authorization                   | Returns `AuthorizationDecision` with allowed/denied, reason, resource/action, scopes/roles, customer scope, and evaluated time                               | `AuthorizationService`, runtime guard, route policy registry                                  | Does not decide eligibility, risk, restrictions, enrollment, limits, or product access                                        | Separate mandatory access input; never substitute A4 policy result for it.                   |
| Reconciliation/readiness           | Reports financial/control status, discrepancy types, severity, owner, recovery state, and migration/readiness signals                                        | `ReconciliationService`, Production/Maturity services                                         | Does not repair, authorize, or decide customer capability                                                                     | Read-only control evidence; unresolved errors must remain visible to later policy contracts. |

## 4. Candidate capability/action census

The following candidates are derived from current permission types, routes, source modules, and future architecture dependencies. They are inventory labels only. A4T02 must define the canonical representation and whether each candidate is in the initial policy set.

| Candidate capability family       | Current action-shaped evidence                                                                                                         | Current route/module evidence                                                | Required A4 policy inputs                                                                                                                | Current status and boundary                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Customer activation / account use | Onboarding readiness, eligibility, restrictions, enrollment, risk, compliance, customer lifecycle                                      | Customer onboarding/eligibility routes; A3 account read                      | Customer lifecycle, onboarding, eligibility, restrictions, risk/compliance freshness, A3 binding state, A2 authorization                 | No single current policy decision exists. A4 may define activation-dependent profiles without mutating source state.                   |
| Transfer                          | Permission `TRANSFER`; `QuotePaymentType.TRANSFER`; `POST /api/v1/transfers`; existing `TransferService` wallet/status/currency checks | `transfer`, `wallet`, `limit`, `quote`, `ledger`                             | Customer/account state, enrollment/permission, restrictions, eligibility, risk/compliance, currency/limits, A3 binding, A2 authorization | Future A5 consumer; A4 must not implement transfer authorization or posting in A4.                                                     |
| Deposit                           | Permission `DEPOSIT`; `QuotePaymentType.DEPOSIT`; deposit routes and lifecycle                                                         | `deposit`, `payment`, `wallet`, `ledger`, `limit`                            | Eligibility, enrollment/permission, restrictions, customer/account state, currency/limits, A3 binding, A2 authorization                  | Existing internal financial lifecycle; A4 only defines policy input/output contract. External funding remains A6.                      |
| Withdrawal                        | Permission `WITHDRAW`; `QuotePaymentType.WITHDRAWAL`; withdrawal routes and lifecycle                                                  | `withdrawal`, `payment`, `wallet`, `ledger`, `limit`                         | Eligibility, enrollment/permission, restrictions, limits, risk/compliance, account state, A3 binding, A2 authorization                   | Existing internal financial lifecycle; A4 does not execute or recover withdrawals.                                                     |
| Generic payment                   | Permission `PAYMENT`; payment-reference/quote support                                                                                  | `payment`, `quote`, fee/financial consumers                                  | Capability-specific product enrollment, permission, limits, risk/compliance, A2, A3, account state                                       | Current payment support is shared infrastructure; no central A4 payment policy exists.                                                 |
| Bill payment                      | Permission `BILL_PAYMENT`                                                                                                              | No dedicated bill-payment runtime module in current inventory                | Product enrollment, permission, eligibility, restrictions, limits, risk/compliance, A2; external/provider inputs are out of A4           | Candidate only; no bill-payment implementation belongs in A4T01 or A4.                                                                 |
| Airtime                           | Permission `AIRTIME`                                                                                                                   | No dedicated airtime runtime module in current inventory                     | Product enrollment, permission, eligibility, restrictions, limits, risk/compliance, A2                                                   | Candidate only; product/provider implementation belongs later.                                                                         |
| Card                              | Permission `CARD`                                                                                                                      | No card command module in current inventory                                  | Product enrollment, permission, eligibility, restrictions, risk/compliance, A2, account state where applicable                           | Candidate only; no card product implementation in A4.                                                                                  |
| Virtual account                   | Permission `VIRTUAL_ACCOUNT`; `virtual-account` metadata routes                                                                        | `virtual-account` metadata module                                            | Enrollment, permission, eligibility, restrictions, A2, account/binding evidence as applicable                                            | Existing local metadata tooling is not external virtual-account activation; A6/provider boundaries remain separate.                    |
| QR payment                        | Permission `QR_PAYMENT`                                                                                                                | No dedicated QR runtime module in current inventory                          | Product enrollment, permission, eligibility, restrictions, limits, risk/compliance, A2                                                   | Candidate only; no QR/merchant payment implementation in A4.                                                                           |
| USSD                              | Permission `USSD`                                                                                                                      | No dedicated USSD runtime module in current inventory                        | Product enrollment, permission, eligibility, restrictions, risk/compliance, A2                                                           | Candidate channel capability only; channel implementation is out of A4.                                                                |
| API access                        | Permission `API`; A2 service principal and route scope                                                                                 | A2 route policy and service-principal context                                | A2 audience/scopes, customer/product enrollment, eligibility, restrictions, A4 policy profile                                            | Policy input may distinguish API capability from runtime route authorization. A4 does not issue API credentials.                       |
| Product enrollment                | Enrollment product/status transitions                                                                                                  | `POST/PATCH /api/v1/customers/:id/product-enrollment`                        | Customer lifecycle, eligibility, restrictions, product-specific enrollment rules, A2 authorization                                       | Source metadata operation, not a generic A4 allow. A4 must not mutate enrollment.                                                      |
| Account/balance read              | A3 read policy and binding/read states                                                                                                 | A3 service-only read; existing `/wallets/:walletId/balance` is Wallet facade | A2 authorization, A3 binding/read state, Ledger-derived balance contract, privacy classification                                         | A3/A2 boundary remains authoritative; A4 should not duplicate this read or expose an A4 policy as balance access.                      |
| Quote creation/use                | Quote lifecycle and `QuotePaymentType`                                                                                                 | `/api/v1/quotes`, quote use route                                            | Future command capability, configured limits, product enrollment, A2/A3 as applicable                                                    | Decision tooling currently has no central policy version; A4 may define consumer contract but does not change quote behavior in A4T01. |

## 5. Candidate namespace observations

### 5.1 Current namespaces are not one namespace

The repository currently has several independently owned identifiers:

- Permission enum values such as `TRANSFER` and `BILL_PAYMENT`.
- Product enrollment strings normalized by the eligibility service.
- HTTP route/action strings generated by A2 route policy.
- Payment/quote types such as `TRANSFER`, `DEPOSIT`, and `WITHDRAWAL`.
- Financial lifecycle entity names and command operations such as create, complete, process, fail, cancel, and use.
- A3 binding/read actions such as `wallet:account-binding:read`.

These values overlap semantically but are not interchangeable. A4T02 must define the canonical capability/action namespace and explicit mappings rather than assuming route names or enum values are policy identity.

### 5.2 Candidate normalization requirements

The later A4 contract must determine:

- Whether capability and action are separate fields or a single stable key.
- Whether product/channel/operation dimensions are part of the policy scope.
- How current permission types map to capability keys.
- How product enrollment strings map to capability profiles without creating a product registry prematurely.
- How financial command actions map to policy requests without starting A5.
- How policy version, source schema version, and input hash bind to the request.
- How unknown, deprecated, or unmapped capability keys fail closed.

A customer reference, wallet alias, payment reference, provider ID, route parameter, idempotency key, or correlation ID must never be used as the capability subject or financial identity.

## 6. A2/A3 handoff inputs for capability policy

### 6.1 A2 access context

A4 may receive:

- `AuthorizationPrincipal.type`, `principalId`, optional `customerId`, `sessionId`, `audience`, roles, scopes, customer access, assigned customer IDs, and assurance level.
- `AuthorizationDecision.allowed`, denial reason, resource type/ID, customer ID, action, required scopes/roles, and `evaluatedAt`.
- Request, correlation, trace, and causation context.

A4 must not:

- authenticate a principal or validate credentials/tokens in place of A2;
- infer eligibility from an A2 role, scope, session, or assurance level;
- issue a privileged approval or replace A2 route policy; or
- store raw password/token/MFA/device/approval material in a policy decision.

### 6.2 A3 account/binding context

A4 may receive:

- Canonical Customer UUID and CustomerWallet ownership/provisioning evidence.
- Binding ID, CustomerWallet ID, WalletAccount ID, LedgerAccount ID, binding state, currency, accounting unit, source versions, and control/reconciliation references.
- WalletAccount and LedgerAccount compatibility state through the A3/Wallet/Ledger read contracts.
- A3 read states and warnings, including missing, stale, suspended, repair-required, closed, and Ledger-unavailable outcomes.
- A3 reconciliation discrepancy class, severity, owner, recovery state, and generated-at timestamp where a capability requires control evidence.

A4 must not:

- infer a binding from `WalletAccount.customerId`, a customer reference, wallet alias, account code, payment reference, provider ID, or currency;
- use a policy decision to create, repair, reassign, suspend, close, or activate a binding; or
- persist an A3/Ledger balance snapshot as policy or customer metadata truth.

### 6.3 Handoff contract gaps recorded by A4T01

| Gap                                          | Current evidence                                                                     | A4 consequence                                                      | Next A4 task |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------ |
| No canonical policy request/action namespace | Current permissions, routes, quote types, and lifecycle methods use separate values  | A request could be evaluated under an ambiguous scope               | A4T02        |
| No central source snapshot                   | Current services expose separate views/read methods                                  | Policy could combine stale or incomplete sources                    | A4T03        |
| No normative precedence                      | Operating status has local precedence only                                           | Financial/product consumers could disagree                          | A4T04        |
| No capability profile/limit boundary         | LimitEngine accepts caller-supplied values and only covers three quote payment types | Configured limits, usage, and policy obligations could be conflated | A4T05        |
| No versioned policy decision                 | No A4 policy entity/version/result exists                                            | Historical decisions cannot be reproduced                           | A4T06        |
| No A4 consumer/read boundary                 | No A4 policy service/controller/DTO exists                                           | A2/A3 outputs could be mistaken for policy                          | A4T07/A4T08  |

## 7. A4T01 implementation boundary

A4T01 creates no capability implementation. It does not:

- add a capability enum, policy enum, DTO, entity, migration, repository, service, controller, route, or test;
- modify `CustomerEligibilityService`, `LimitEngine`, financial services, A2 authorization, A3 binding/read services, or reconciliation;
- define final policy precedence or reason-code semantics;
- create a product catalogue or product enrollment authority;
- authorize, execute, or recover a financial command; or
- call an external screening, bank, NIBSS, notification, or provider service.

## 8. A4T01 validation record

- [x] Current capability-shaped source values and permission types are inventoried.
- [x] Current route/action surfaces and their owning modules are inventoried.
- [x] Existing onboarding, operating-status, limit, risk, compliance, A2 authorization, A3 account-read, and reconciliation decision-like surfaces are distinguished from a future A4 policy result.
- [x] Candidate capability/action namespaces are recorded without presenting them as final A4 contract values.
- [x] A2 access inputs and A3 binding/account inputs are documented with prohibited interpretations.
- [x] Current capability gaps are assigned to later A4 tasks without starting those tasks.
- [x] No application source, entity, migration, service, controller, route, test, or runtime behavior was changed.
