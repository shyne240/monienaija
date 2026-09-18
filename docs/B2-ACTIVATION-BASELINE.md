# B2T01 — Customer Activation Platform Baseline and First Public Commercial Scope Selection

- **Phase:** B2 — Customer Activation and Public Commercial Platform
- **Task:** B2T01 — Customer Activation Platform Baseline and First Public Commercial Scope Selection
- **Status:** Baseline prepared for B2T02; no B2 runtime implementation introduced
- **Classification:** Documentation-only B2 implementation baseline
- **Review snapshot:** `205ffe1` (B1 release gate prepared `205ffe1`; B1 phase result `Prepared — not approved, not live-certified, not activated, not handed off to B2` per `B1-EXIT-CHECKLIST.md` §9; B2 implementation plan `docs/B2-IMPLEMENTATION-PLAN.md` committed; A1–A7 + B1 phase evidence committed)
- **Selected first activation cohort:** `b2.activation.cohort.inbound-funding.v1` (bounded onboarding envelope, bounded activation envelope, bounded public-surface envelope, bounded credential envelope, bounded webhook envelope, bounded governance envelope) for the frozen B1 first commercial scope `commercial.virtual-account.inbound-funding.v1` under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`
- **Application, database, API, migration, controller, route, scheduler, credential, secret, webhook, sandbox, public surface, activation, commercial, and financial-runtime changes in this task:** None

## 1. Purpose and boundary

B2T01 establishes the current repository baseline for the first bounded customer-activation and public commercial platform capability. It inventories the existing activation-adjacent surfaces (existing customer, customer-authentication, customer-onboarding, customer-eligibility, customer-risk-profile, customer-preference, customer-wallet, customer-funding-instrument, customer-beneficiary, customer-compliance, wallet, ledger, operations, partner, reconciliation, policy, product-governance, payment/quote/fee/limit, B1 `policy/b1-*` commercial engines and contracts, and the A7 `policy/a7-*` / `virtual-account` product contracts) and selects one bounded first activation cohort — `b2.activation.cohort.inbound-funding.v1` — without treating existing activation metadata, public routes, credentials, sandbox data, webhook registrations, quotas, rate-limit metadata, consent records, or self-service flows as B2-approved behavior.

B2 is an Architecture phase. B2T01 is documentation-only. It is not a customer activation, a merchant activation, an agent activation, a commercial activation, a public API exposure, an API authentication, an API consumer enrollment, a webhook registration, a webhook delivery, a developer onboarding, an API credential issuance, a sandbox activation, an API documentation publication, an API versioning activation, an API quota grant, a rate-limit lift, a customer-consent activation, a marketing-consent activation, a public commercial route exposure, a commercial self-service activation, an activation rollback, or a release-gate decision. B2T01 records:

- the existing activation-adjacent module and route inventory (customer, customer-authentication, customer-onboarding, customer-eligibility, customer-risk-profile, customer-preference, customer-wallet, customer-funding-instrument, customer-beneficiary, customer-compliance, wallet, ledger, operations, partner, reconciliation, policy, product-governance, payment/quote/fee/limit, B1 commercial platform baseline/catalog/fee/billing/campaign/referral/revenue-recognition/analytics/governance, A7 product catalog/boundary/customer-binding/command/notification/lifecycle/financial-effect/reconciliation/data-minimization);
- the activation candidate matrix (customer/merchant/agent segment, residential filter, eligibility percentile, direction, capability, currency, accounting unit, partner dependency, fee/commission/billing tier reference, data fields, required consent purposes — service vs marketing);
- one selected B2 first activation cohort `b2.activation.cohort.inbound-funding.v1` (bounded onboarding envelope, bounded activation envelope, bounded public-surface envelope, bounded credential envelope, bounded webhook envelope, bounded governance envelope) with explicit A2 audience, internal activation owner, partner dependency, prohibited adjacent cohorts/channels, and minimum activation surface;
- the existing activation-adjacent gap register, including credential life-cycle gap, sandbox fixture gap, webhook replay gap, consent enforcement gap, public-route A2 scope gap, and activation-reconciliation gap;
- the activation identifier, credential, secret, webhook, data-sharing, consent, retention, and legal-hold inventory;
- the B2 dependency, risk, certification, stop-condition, activation-rollback, and internal-history-preservation register; and
- the compatibility classification for the existing activation-adjacent modules, `CustomerPreference`/`CustomerConsent`/`MarketingConsent`, B1 commercial metadata, A6 partner/scheme metadata, and A7 product metadata.

B2T01 is deliberately bounded to one first activation cohort for the frozen `commercial.virtual-account.inbound-funding.v1`. B2T01 does not select a second activation cohort, a second B1 commercial scope, a second partner beyond `NIBSS_NIP`, a second currency, a second accounting unit, a second region beyond `NG`, a public commercial surface beyond the bounded API + webhook surface, a second customer tier, a second merchant tier, a second partner tier, a second product entitlement, a second feature flag, a second quota, a second rate-limit bucket, a second webhook event type beyond `b2.activation.*`/`b2.webhook.test`, or a second consented channel beyond the bounded consent purposes. Each additional cohort, product, scope, region, currency, or partner is a separate reviewed capability and is out of scope for B2T01.

## 2. B2 entry conditions and baseline assumptions

### 2.1 B2 entry conditions inherited from the B1 handoff

B2 is blocked from being treated as a release authorization. Per `docs/B1-B2-HANDOFF-PACKAGE.md` §2 (status `BLOCKED`), `docs/B1-B2-HANDOFF-PACKAGE.md` §7 (B2 entry conditions), `docs/B1-EXIT-CHECKLIST.md` §9 (phase result `Prepared — not approved, not live-certified, not activated, not handed off to B2`), and `docs/B1-APPROVAL-PACKAGE.md` §2/§4 (no-go, all owners `Pending`), the B1 and prior phase gates are the precondition for any B2 activation implementation. B2 must not begin implementation until the following B1 and A1–A7 prerequisites are independently approved and recorded:

1. A1 phase exit and accountable-owner approval; A1 canonical ownership/identifier/privacy/retention/legal-hold/cross-cutting contracts committed.
2. A2 route/data-exposure, service audience/scope/assurance, privileged-action/step-up, secret, and protected-ingress approval for any B2 public surface, webhook-management surface, and activation control surface.
3. A3 binding/read/reconciliation approval for any B2 activation / credential / webhook / public-route surface that consumes a Customer-to-Financial-Account binding.
4. A4 policy mapping (capability, tier, entitlement, limit, obligation, currentness, re-evaluation, reason codes) for `commercial.virtual-account.inbound-funding.v1` and for any B2 activation cohort capability.
5. A5 ledger, account, state, posting, journal correlation, settlement-account, suspense, compensating-entry, financial-invariants, and independent-reconciliation approval for any B2 surface that reads a ledger-backed account.
6. A6 partner capability/version (`NIBSS_NIP`), callback authenticity/replay/freshness, settlement/suspense/compensating, external reconciliation (A6T09), and external-rail data-classification/minimization/consent/retention/secret/disclosure/support-trace/partner-payload validation (A6T10) owner approval for any B2 flow that depends on the A6 partner.
7. A7 product catalog/boundary (ADR-0054 `VIRTUAL_ACCOUNT` v1), customer-binding, command/operation identity, notification delivery (A7T06 under `CustomerPreference.notifications`), lifecycle, financial-effect, reconciliation, and data-minimization owner approval for any B2 flow that depends on the A7 first product.
8. B1 commercial catalog/plan-boundary (ADR-0061/ADR-0062 frozen `commercial.virtual-account.inbound-funding` v1), pricing/plan/tier/entitlement/package/bundle catalog (B1T03), fee/commission/revenue-sharing (B1T04), billing/invoice/statement (B1T05), campaign/promotion/coupon (B1T06), referral/cashback/loyalty (B1T07), revenue-recognition/tax/cost-accounting (B1T08), analytics/profitability/commercial-reconciliation (B1T09), governance/classification/idempotency/audit/approvals/feature-flag (B1T10), and B1 release gate (B1T11 `BLOCKED` until all B1 owners `Granted`) owner approval before any B2 public behavior.
9. Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, and partner review and approval for any B2 public commercial surface.

B2T01 records that none of the above B1/A1–A7 approvals are claimed by this baseline. B2T01 is a planning artifact. B2T01 does not begin B2T02 or any later B2 task until the B1→B2 entry conditions above are independently approved and recorded and the B1 release gate transitions from `BLOCKED` to `APPROVED`.

### 2.2 B2T01 baseline assumptions

The B2T01 baseline records the following assumptions, all subject to B1→B2 release-gate review and revisable by B2T12 evidence:

- A1–A7 and B1 phases are committed and unchanged at snapshot `205ffe1`; B1 first scope `commercial.virtual-account.inbound-funding` v1 is frozen under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`.
- A2 authenticated principal, audience/scope/assurance, authorization, privileged-action, protected-ingress, and security-event contracts are committed and unchanged; A2 is the only authentication vault and the only privileged-action approval authority.
- A3 canonical Customer-to-Financial-Account binding, ownership, lifecycle, currency, accounting-unit, and repair/reconciliation contracts are committed and unchanged; A3 remains the only binding authority.
- A4 capability/action policy, tier/entitlement/limit/obligation, evidence snapshot, expiry/re-evaluation, and currentness contracts are committed and unchanged; A4 remains the only policy authority and the only risk/compliance/limit precedence evaluator.
- A5 customer-aware command/correlation, lifecycle, ledger, operations (audit/idempotency/outbox/metrics/diagnostics), outbox, unknown-outcome, and independent-reconciliation patterns are committed and unchanged; Ledger remains the only financial value authority.
- A6 partner-adapter boundary (`NIBSS_NIP` planning rail), callback authenticity/replay/freshness, settlement/suspense/compensating, external reconciliation (A6T09) and data-classification/minimization (A6T10) are committed and unchanged; A6 is the only partner authority and A6T10 is the only data-classification authority.
- A7 product catalog/boundary/product customer-binding/command/notification/lifecycle/financial-effect/reconciliation/data-minimization contracts (`VIRTUAL_ACCOUNT` v1) are committed and unchanged; A7 is the only product authority.
- B1 commercial platform baseline, catalog/plan-boundary, fee/commission, billing/invoice/statement, campaign/promotion/coupon, referral/cashback/loyalty, revenue-recognition/tax/cost-accounting, analytics/profitability/commercial-reconciliation, and governance/classification/idempotency/audit/approvals/feature-flag surfaces are committed and unchanged; B1 is the only commercial-decision authority.
- `CustomerPreference.notifications` is the only customer delivery-intent authority for any B2T09 webhook that would cause a notification-class message; B2T06 `CustomerConsent`/`MarketingConsent` are the only activation/marketing intent authorities and never replace delivery intent.
- The shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, and `DiagnosticsService` are the only audit, idempotency, outbox, metrics, and diagnostics authorities; B2 supplies B2 activation/credential/webhook/consent audit, idempotency, outbox, metrics, and diagnostics through approved read-only consumer boundaries.
- The first activation cohort `b2.activation.cohort.inbound-funding.v1` is the only B2 cohort for the B2 critical path, subject to B2T01 review and to the prohibited-adjacent-cohort registry.
- `Merchant.id` and `Agent.id` are distinct cohort identities that reference `Customer.id` as beneficial owner where a natural person is the beneficial owner and that never replace `Customer.id` as the A1 identity.

### 2.3 B2T01 baseline non-assumptions

The B2T01 baseline does not record the following:

- B2 does not select a second activation cohort.
- B2 does not select a second B1 commercial scope beyond `commercial.virtual-account.inbound-funding` v1.
- B2 does not select a second partner beyond `NIBSS_NIP`, a second currency beyond `NGN`, a second accounting unit beyond `CUSTOMER_FUNDS`, or a second region beyond `NG`.
- B2 does not select a second public commercial surface, a second public API version beyond `v1` at T01, a second sandbox partition beyond partition-isolated `sandbox`, or a customer-cohort expansion beyond the bounded segment rule.
- B2 does not select a public commercial route without an A2 audience/scope, an unauthenticated public commercial mutation, a raw-credential store, or a raw-secret log.
- B2 does not select a marketing-campaign or marketing-notification beyond the marketing-consent intent record.
- B2 does not select a cross-region, cross-currency, B3 scale, B3 selective extraction, or B3 production rollout.
- B2 does not authorize any B2 public API, credential, webhook, or activation.

## 3. Current repository baseline

The B2T01 baseline records the current repository baseline for the first bounded activation capability. The baseline is documentation-only and modifies no application source.

### 3.1 Existing activation-adjacent module and route inventory

The following existing modules, services, controllers, entities, and contracts are reviewed by B2T01 as activation-adjacent compatibility input. None is treated as B2-approved activation behavior; all are classified as compatibility input only.

| Existing module / service / controller / entity | Path | Activation-adjacent surface | Classification |
| --- | --- | --- | --- |
| `customer` module (controller, service, module, types, entity) | `src/customer/` | customer profile, identity document metadata, KYC metadata, audit, soft delete, optimistic versioning | Compatibility input; `Customer.id` is the only canonical identity; B2 consumes `Customer` read-only |
| `customer-authentication` module | `src/customer-authentication/` | credential metadata, recovery metadata, lockout, credential history | Compatibility input; A2 is the only authentication vault; B2 consumes metadata read-only |
| `customer-onboarding` module | `src/customer-onboarding/` | onboarding workflow, tasks, approvals, readiness, agreements | Compatibility input; B2T03 will extend activation-readiness as a read-only attestation keyed by `Customer.id` |
| `customer-eligibility` module | `src/customer-eligibility/` | eligibility, restrictions, limits, enrollment, permissions, operating status | Compatibility input; A4 is the only eligibility authority; B2 consumes eligibility read-only |
| `customer-risk-profile` module | `src/customer-risk-profile/` | risk assessments, risk level, assessment history | Compatibility input; A4 is the only risk precedence authority |
| `customer-preference` module | `src/customer-preference/` | notification/security/language/theme preferences, preference history | Compatibility input; `CustomerPreference.notifications` is the only delivery-intent authority |
| `customer-wallet` module | `src/customer-wallet/` | non-financial wallet provisioning, alias, ownership, history | Compatibility input; A3 binding is the only financial mapping authority |
| `customer-funding-instrument` module | `src/customer-funding-instrument/` | funding-instrument registration, ownership, verification metadata | Compatibility input; A3 binding is the only financial mapping authority |
| `customer-beneficiary` module | `src/customer-beneficiary/` | customer-owned trusted-recipient beneficiary, ownership, history | Compatibility input; A3 binding is the only binding authority |
| `customer-compliance` module | `src/customer-compliance/` | compliance cases, KYC, AML case metadata, history | Compatibility input; A4/Legal/Risk/Compliance are the only compliance authorities |
| `wallet` module | `src/wallet/` | wallet facade, liability account projection | Compatibility input; `WalletAccount` remains the facade; Ledger is the only financial value authority |
| `ledger` module | `src/ledger/` | journal, line, balance, account, settlement, suspense, compensating entry | Compatibility input; Ledger is the only financial value authority |
| `operations` module | `src/operations/` | audit, idempotency, outbox, metrics, diagnostics, request context, retention, shutdown | Compatibility input; Operations primitives are the only audit/idempotency/outbox/metrics/diagnostics authorities |
| `partner` module | `src/partner/` | partner-adapter, callback, external-operation/lifecycle, settlement, reconciliation, data-minimization, circuit-breaker | Compatibility input; A6 is the only partner authority |
| `reconciliation` module | `src/reconciliation/` | external/internal reconciliation, discrepancy classification | Compatibility input; A6T09/A7T09/B1T09 are the only reconciliation authorities; B2 reconciliation will be read-only |
| `policy` module (including `a7-*` and `b1-*` submodules) | `src/policy/` | `a7-product-*` product/policy/lifecycle/financial-effect/reconciliation/data-minimization; `b1-*` commercial catalog/fee/billing/campaign/referral/revenue-recognition/analytics/governance | Compatibility input; A4 is the only policy evaluator, A7 is the only product authority, B1 is the only commercial-decision authority; B2 consumes B1 catalog as read-only |
| `product-governance` module | `src/product-governance/` | product launch governance records, versions, audit, reports | Compatibility input; Product Governance is the only product governance evidence authority |
| `authorization` module | `src/authorization/` | authorization, RBAC/ABAC | Compatibility input; A2 is the only authorization authority |
| `health`, `production`, `maturity`, `pilot`, `deposit`, `withdrawal`, `transfer`, `payment`, `fee`, `limit`, `quote`, `bank`, `beneficiary` | `src/health/`, `src/production/`, `src/maturity/`, `src/pilot/`, `src/transfer/`, `src/payment/`, `src/fee/`, `src/limit/`, `src/quote/`, `src/bank/` | health/readiness, pilot controls, transfer/payment lifecycle, fee/quote/limit | Compatibility input; A5 internal financial pilot is the only money-moving authority; B2 never becomes a ledger journal source |
| Existing public-route surface (`health.controller`, `app.module` controllers) | `src/app.module.ts`, `src/health/` | existing internal/platform health, app wiring | Compatibility input; no existing public commercial API is approved; every new B2 public route requires A2 audience/scope |
| Existing activation-adjacent classification | n/a | n/a | All existing surfaces classified as compatibility input and not B2 activation authorities; B2 does not activate a cohort/credential/sandbox/webhook/consent/public-route record in B2T01 |

### 3.2 Activation-adjacent surface inventory summary

The B2T01 baseline records the activation-adjacent surface inventory summary:

- customer-authenticated domains: 8 modules (`customer`, `customer-authentication`, `customer-onboarding`, `customer-eligibility`, `customer-risk-profile`, `customer-preference`, `customer-wallet`, `customer-funding-instrument`) + `customer-beneficiary` + `customer-compliance`;
- wallet/ledger/operations: 3 modules (`wallet`, `ledger`, `operations`) with 7 sub-services (audit, idempotency, outbox, metrics, diagnostics, request context, retention);
- partner/reconciliation/policy: 1 `partner` module (adapter, callback, external-operation, settlement, reconciliation, data-minimization, circuit-breaker), 1 `reconciliation` module, 1 `policy` module with 15+ submodules (`a7-product-*` ×9, `b1-*` ×7, capability/policy);
- product governance: 1 `product-governance` module, 1 `authorization` module, 1 `health` module, 1 `production`/`maturity`/`pilot` triad;
- commercial: 7 B1 `policy/b1-*` engines (`commercial-catalog`, `fee`, `billing`, `campaign`, `referral`, `revenue-recognition`, `commercial-analytics`, `commercial-governance`);
- product: 9 A7 `policy/a7-*` services (`catalog`, `policy`, `customer-binding`, `command`, `notification-delivery`, `lifecycle`, `financial-effect`, `reconciliation`, `data-minimization`) + 1 `virtual-account` module (compatibility input only);
- existing internal routes: `health` + app-wired controllers; no existing B2 public commercial API, no existing B2 webhook, no existing B2 consumer/credential is approved.

The B2T01 baseline does not enumerate every file; it enumerates categories and classifies the surface as compatibility input. B2T02 will perform the detailed public catalog/route review.

### 3.3 Compatibility classification

The B2T01 baseline classifies the following existing activation-adjacent surfaces as compatibility input only:

- existing `customer` / `customer-authentication` / `customer-onboarding` / `customer-eligibility` / `customer-risk-profile` / `customer-preference` / `customer-wallet` / `customer-funding-instrument` / `customer-beneficiary` / `customer-compliance` — compatibility input; `Customer.id` remains the only canonical identity; B2 consumes them read-only and never redefines identity/eligibility/preference.
- existing `wallet` / `ledger` — compatibility input; `WalletAccount` remains the facade, Ledger the only financial value authority; B2 never posts a journal.
- existing `operations` primitives (`AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, `DiagnosticsService`) — compatibility input; B2 reuses them read-only and never introduces a second audit/idempotency/outbox vault.
- existing `partner` module and sub-services — compatibility input; A6 is the only partner authority (`NIBSS_NIP` planning rail).
- existing `reconciliation` module — compatibility input; A6T09/A7T09/B1T09 are the only reconciliation authorities; B2 reconciliation will read from them and never write source records.
- existing `policy` module (`a7-*`, `b1-*`, capability/policy) — compatibility input; A4 is the only policy evaluator, A7 is the only product authority, B1 is the only commercial-decision authority.
- existing `product-governance` / `authorization` / `health` / `production` / `maturity` / `pilot` / `fee` / `quote` / `limit` — compatibility input; they remain the only authorities in their domains.
- existing app health/internal routes — compatibility input; no existing route is treated as B2 public commercial API approval.

## 4. B2 first activation cohort selection

### 4.1 First activation cohort

The B2T01 baseline selects exactly one bounded first activation cohort for the first B1 commercial scope:

```text
b2-cohort-key:      b2.activation.cohort.inbound-funding
b2-cohort-version:  1
b2-cohort-dir:      inbound funding (customer-facing activation of B1 commercial.virtual-account.inbound-funding v1)
capability:         commercial.virtual-account.inbound-funding (B1 capability under product.virtual-account)
b1-plan reference:  commercial.virtual-account.inbound-funding.v1 (B1 frozen scope)
a7 product ref:     VIRTUAL_ACCOUNT v1 (provider-backed virtual account, inbound funding)
a6 partner ref:     NIBSS_NIP (planning rail; only approved partner)
currency:           NGN
accounting unit:    CUSTOMER_FUNDS
region:             NG (only)
segment rule:       existing VERIFIED Customer with (i) KYC VERIFIED, (ii) CustomerRisk not PROHIBITED/CRITICAL-blocked, (iii) A3 binding VERIFIED for WalletAccount/LedgerAccount (NGN/CUSTOMER_FUNDS), (iv) A4 ELIGIBLE for product.virtual-account + B1 tier/entitlement COMPATIBLE, (v) CustomerConsent GRANTED for purpose B2_ACTIVATION — without fixing a production rollout percent, cohort size, or residency city beyond NG.
customer/merchant/agent composition:  Customer cohort ONLY at T01 (merchant/agent onboarding deferred to B2T04; their cohort keys are prohibited at T01)
audience:           public:commercial:activation:b2:inbound-funding:read and public:commercial:activation:b2:inbound-funding:write (A2 audience pair)
activation owner:   B2 Commercial Activation (owner: B2T05 workflow; accountable: Product + Commercial + Architecture)
partner dep:        NIBSS_NIP (virtual-account identifier provisioning already depends on A6; activation inherits the dependency read-only)
data fields:        activationReference, canonical Customer.id, activationCohortKey, b1PlanKey, a7ProductKey, virtualAccountId (where already-provisioned), consentPurpose, activationState, idempotencyKey, requestHash, auditActor, auditEntityType, outboxEventType, createdAt — all hashed/excluded per B2 idempotency contract (payload hash excludes activationReference/createdAt)
```

The first activation cohort `b2.activation.cohort.inbound-funding.v1` is the only B2 cohort for the B2 critical path. It is the only cohort for which B2T02–B2T12 may emit activation, credential, version, quota, webhook, or public-route behavior.

### 4.2 First activation cohort envelopes

The first activation cohort is bounded to six envelopes. Each envelope is read-only or B2-internal and never posts a journal, mutates a balance, repairs a binding, changes A4 policy/source records, or dispatches a notification beyond enqueuing an A7T06-compatible delivery intent.

#### 4.2.1 Bounded onboarding envelope

Covers the customer activation-readiness attestation that B2T03 will emit (P1.2 KYC `VERIFIED` + A3 binding `VERIFIED` + A4 `ELIGIBLE` + B1 tier/entitlement `COMPATIBLE` + `CustomerConsent` `GRANTED`). Merchant/agent onboarding (`Merchant.id`, `Agent.id`) is not in the T01 cohort but is within the envelope's future extension; at T01 the envelope contains only the customer attestation shape and the FK guard that prevents a second writable `Customer`.

#### 4.2.2 Bounded activation envelope

Covers the activation workflow request/result `B2ActivationRequestV1`/`B2ActivationResultV1` with states `PENDING_VERIFICATION`/`PENDING_CONSENT`/`PENDING_APPROVAL`/`ACTIVE`/`SUSPENDED`/`REVOKED`/`EXPIRED`/`REJECTED`, the self-service `suspend`/`revoke` shape, and the correlation `activationReference` that is distinct from B1 commercial-decision, A6 external operation, A7 product command/operation, and A5 journal identifiers.

#### 4.2.3 Bounded public-surface envelope

Covers the public API catalog/route-exposure contract that B2T02 will freeze: `POST /commercial/activations`, `GET /commercial/activations/{id}`, `GET /commercial/catalog|plans|tiers`, `GET /activations/{id}`, `POST /activations/{id}/suspend|revoke` — each annotated with A2 audience/scope, idempotency scope, quota cost, rate-limit tier, version `v1`, and consent purpose. No route beyond this minimal surface is in the T01 envelope.

#### 4.2.4 Bounded credential envelope

Covers the consumer/credential/quota/rate-limit lifecycle that B2T08 will implement: `ApiConsumerV1` (`DEVELOPER`/`MERCHANT`/`AGENT`/`PARTNER`, `DRAFT`→`ACTIVE`→`SUSPENDED`→`REVOKED`), `ApiCredentialV1` (`API_KEY`/`CLIENT_CREDENTIALS`, `ISSUED`→`ROTATED`→`REVOKED`→`EXPIRED`, hash-only `secretHash`), `ApiQuotaV1` (`ALLOCATED`→`EXCEEDED`), `ApiRateLimitV1` (`ALLOWED`→`THROTTLED`, `TOKEN_BUCKET`). At T01 the envelope records only the contract shape; no credential/consumer/quota/bucket is issued.

#### 4.2.5 Bounded webhook envelope

Covers webhook registration/delivery/verification that B2T09 will implement: `WebhookRegistrationV1` (`PENDING_VERIFICATION`→`VERIFIED`→`SUSPENDED`→`REVOKED`, HTTPS-only allowlisted URL, `secretHash` only, `HMAC_SHA256`), `WebhookDeliveryV1` (`ENQUEUED`→`DELIVERED`→`FAILED_RETRYABLE`→`DEAD_LETTER`, `Delivery-Id` replay protection, 300s freshness, bounded retry 5 with exponential backoff). At T01 the envelope records only the events `b2.activation.*` + `b2.webhook.test`.

#### 4.2.6 Bounded governance envelope

Covers customer consent + marketing consent intent authorities that B2T06 will implement (`CustomerConsentV1` purposes `B2_ACTIVATION`/`B2_SELF_SERVICE`/`B2_COMMERCIAL`, `MarketingConsentV1` purpose `MARKETING_COMMERCIAL_OFFER` channels `email`/`sms`/`push`/`inApp`, states `GRANTED`/`REVOKED`/`EXPIRED`), the A2 privileged-action approval surface they reuse, and the data-classification/minimization alignment to A6T10/A7T10/B1T10 that B2T01 preserves.

### 4.3 Activation candidate matrix

The B2T01 baseline records the following activation candidate matrix for `b2.activation.cohort.inbound-funding.v1`. The matrix is the B2T01 selection rationale and is frozen at v1 for the T01 cohort selection.

| Field | Selected value for the first activation cohort | Rationale |
| --- | --- | --- |
| B2 cohort key | `b2.activation.cohort.inbound-funding` | Mirrors the frozen B1 scope `commercial.virtual-account.inbound-funding` v1; avoids inventing a second scope, product, or partner |
| B2 cohort version | `1` | First version; frozen; subsequent versions require a separate B2 cycle |
| Direction | inbound funding (customer-facing activation of the B1 inbound-funding commercial capability) | Matches `VIRTUAL_ACCOUNT` v1 inbound funding direction |
| Capability | `commercial.virtual-account.inbound-funding` (B1 capability under `product.virtual-account`) | Reuses the only `Approved` (when B1 approved) commercial capability; no new capability at T01 |
| Currency | `NGN` | Matches `VIRTUAL_ACCOUNT` v1 and `NIBSS_NIP` planning rail; no second currency at T01 |
| Accounting unit | `CUSTOMER_FUNDS` | Matches `VIRTUAL_ACCOUNT` v1 and existing settlement accounting unit |
| Region | `NG` | Only region in scope at T01; cross-region is B3 |
| Customer segment rule | `KYC VERIFIED` + `CustomerRisk ∉ {PROHIBITED, CRITICAL-blocked}` + `A3 binding VERIFIED (NGN/CUSTOMER_FUNDS)` + `A4 ELIGIBLE for product.virtual-account + B1 tier/entitlement COMPATIBLE` + `CustomerConsent GRANTED (B2_ACTIVATION)` | Deterministic, fixture-testable eligibility composition; no residency city beyond `NG`, no rollout percent fixed at T01 |
| Merchant/agent segment | `Prohibited` at T01 | Merchant (`Merchant.id`) and agent (`Agent.id`) cohorts require B2T04 verification/approval and a beneficial-owner trace; at T01 the customer cohort is the only active segment |
| Partner dependency | `NIBSS_NIP` (planning rail) | Reuses the only approved A6 partner; no new partner, credential, or callback at T01 |
| B1 fee/commission reference | `bounded; B1T04 fee/commission decision consumed read-only` | B2 consumes B1T04 as the only fee/commission source |
| B1 billing/invoice/statement reference | `bounded; B1T05 outputs consumed read-only; not rendered as financial truth` | B2 reads B1T05 as minimized public data under A2 audience, never as ledger truth |
| Campaign/promotion/coupon reference | `bounded; B1T06 outputs consumed read-only` | No second campaign engine |
| Referral/cashback/loyalty reference | `bounded; B1T07 outputs consumed read-only` | No second loyalty engine |
| Revenue-recognition/tax/cost reference | `bounded; B1T08 outputs consumed read-only; not a tax event` | B2 exposes them as minimized commercial data, never as a tax ledger event |
| Analytics/profitability/reconciliation reference | `bounded; B1T09 read-only outputs consumed read-only` | B2 reconciliation reads B1T09 and never writes source records |
| Notification surface | `CustomerPreference.notifications` is the only delivery-intent authority (A7T06); B2 activation/marketing intents are separate (B2T06) | B2 never dispatches beyond enqueuing an A7T06-compatible delivery intent |
| A2 audience pair | `public:commercial:activation:b2:inbound-funding:read`, `public:commercial:activation:b2:inbound-funding:write` | Every new B2 public route carries this pair; no unauthenticated public commercial mutation |
| Data fields at T01 | `activationReference`, `Customer.id`, `activationCohortKey`, `b1PlanKey`, `a7ProductKey`, `virtualAccountId` (where already-provisioned), `consentPurpose` (`B2_ACTIVATION`), `activationState`, `idempotencyKey`, `requestHash`, `auditActor`, `auditEntityType`, `outboxEventType`, `createdAt` | Hashed/excluded per B2 idempotency contract (payload hash excludes `activationReference`/`createdAt`); minimized, classified |
| API credentials at T01 | `Prohibited` (issuance at B2T08) | B2T01 records the contract shape only; no `ApiConsumer`/`ApiCredential` at T01 |
| Webhook events at T01 | `b2.activation.succeeded`, `b2.activation.suspended`, `b2.webhook.test` (challenge) | No `b1.commercial.invoice.created` or marketing webhook at T01 beyond the minimal 2 + test; additional events require B2T09 review |
| Rate-limit/quota at T01 | `Prohibited` (enforcement at B2T08) | Contract shape only; no bucket/quota allotted at T01 |
| Rollback assumption | Per-cohort/per-consumer/per-route/per-webhook disable + environment `B2_ACTIVATION_ENABLED=false` + A6 circuit-breaker; all preserve A5/A6/A7/B1/Ledger/CustomerPreference/Operations history | Authored in detail by B2T11 (out of scope for T01) |

### 4.4 Prohibited adjacent cohorts and channels

The first activation cohort `b2.activation.cohort.inbound-funding.v1` is bounded; the following adjacent cohorts/channels are explicitly prohibited at T01 and require a separate reviewed capability/ADR and release boundary:

- a second customer cohort beyond the `NGN`/`CUSTOMER_FUNDS`/`NG` inbound-funding `VERIFIED` segment (e.g., a savings or lending product cohort) — requires a separate A7+B1+B2 cycle;
- a merchant cohort (`merchantProfile` business/tax/settlement-verified) and any agent cohort (`agentProfile` network/terminal-verified) — requires B2T04 verification/approval and a beneficial-owner `Customer.id` trace; at T01 they are registered but remain `Prohibited`;
- a webhook event beyond `b2.activation.succeeded`/`suspended`/`b2.webhook.test` (e.g., `b1.commercial.invoice.created` minimized or any marketing-class webhook) — requires B2T09 review and Privacy classification;
- a public commercial route without an A2 audience/scope, an unauthenticated `POST /commercial/activations`, or a public route that infers an A3 binding or `CustomerPreference` — prohibited at all B2 times;
- a raw-credential store (any table/log/trace/event/webhook body containing `clientSecret`, webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key) — prohibited at all B2 times;
- a marketing-campaign beyond the marketing-consent intent record (`MarketingConsentV1` purpose `MARKETING_COMMERCIAL_OFFER` channels `email`/`sms`/`push`/`inApp`) — requires a separate B2 marketing-content cycle;
- an API version beyond `v1` (`v2`), a second public surface, a second sandbox partition beyond partition-isolated `sandbox`, an unbounded retry loop, or a second partner marketplace — prohibited at T01;
- a cross-currency (`USD`/`KES`/`EUR`…), cross-region (region ≠ `NG`), second B1 commercial scope, second commercial partner beyond `NIBSS_NIP`, or broad customer-activation rollout — requires B2 expansion (or B3 for region/currency) and is out of scope for the T01 cohort;
- a second customer-consent purpose beyond `B2_ACTIVATION`/`B2_SELF_SERVICE`/`B2_COMMERCIAL`, a second marketing-consent purpose, or a consentless activation — prohibited at T01;
- a public-channel native screen (mobile/web/PWA), USSD/SMS banking, card/QR/merchant rail, bulk/payroll, agent-network, biller aggregator, FX, lending, or savings product exposure — prohibited at T01.

## 5. Authority and ownership matrix

The B2T01 baseline records the B2 authority and ownership matrix. The matrix is the B2T01 selection rationale and is frozen at v1 for the T01 cohort.

| Authority | Owner | B2 consumption boundary | B2 does not introduce |
| --- | --- | --- | --- |
| A1 canonical ownership/identifier/privacy/retention/legal-hold | A1 owner | B2 is a read-only consumer of A1 | B2 does not introduce a second canonical-ownership/identifier/privacy/retention/legal-hold authority |
| A2 authenticated principal/audience/scope/assurance/authorization/privileged-action/protected-ingress/security-event | A2 owner | B2 is a read-only consumer of A2; B2 activation/consumer/credential/webhook approvals reuse the A2 privileged-action and step-up surface; every B2 public route carries an A2 audience/scope | B2 does not introduce a second authenticated-principal/audience/authorization/privileged-action/protected-ingress/security-event authority |
| A3 canonical Customer-to-Financial-Account binding/ownership/lifecycle/currency/accounting-unit/repair/reconciliation | A3 owner | B2 is a read-only consumer of A3; B2 supplies activation-binding data to A3, not the other way around; B2 never repairs or infers a binding from public input | B2 does not introduce a second Customer-to-Financial-Account binding/ownership/lifecycle/currency/accounting-unit/repair/reconciliation authority |
| A4 capability/action policy, tier/entitlement/limit/obligation/evidence/expiry/re-evaluation/currentness | A4 owner | B2 is a read-only consumer of A4; B2 supplies activation-eligibility data to A4, not the other way around; A4 remains the only policy authority and the only risk/compliance/limit precedence evaluator | B2 does not introduce a second capability/action policy/limit/obligation/evidence/expiry/re-evaluation/currentness authority |
| A5 customer-aware command/correlation/lifecycle/ledger/operations/outbox/unknown-outcome/pilot-disable/independent-reconciliation | A5 owner | B2 is a read-only consumer of A5; B2 supplies activation data to A5, not the other way around; Ledger is the only financial value authority | B2 does not introduce a second customer-aware command/correlation/lifecycle/ledger/operations/outbox/unknown-outcome/pilot-disable/independent-reconciliation authority |
| A6 partner-adapter/capability/version/callback/provider-idempotency/settlement/suspense/external-reconciliation/data-minimization | A6 owner | B2 is a read-only consumer of A6 through the existing A7 product layer and the B2 webhook boundary (only `b2-webhook` may call a consumer URL); A6 is the only partner authority | B2 does not introduce a second partner-adapter/capability/version/callback/provider-idempotency/settlement/suspense/external-reconciliation/data-minimization authority |
| A7 product catalog/boundary/customer-binding/command/notification/lifecycle/financial-effect/reconciliation/data-minimization | A7 owner | B2 is a read-only consumer of A7 through existing read-only consumer boundaries; B2 never dispatches beyond enqueuing an A7T06-compatible delivery intent | B2 does not introduce a second product catalog/boundary/customer-binding/command/notification/lifecycle/financial-effect/reconciliation/data-minimization authority |
| B1 catalog/plan-boundary/pricing/plan/tier/entitlement/package/bundle/fee/commission/revenue-sharing/billing/invoice/statement/campaign/promotion/coupon/referral/cashback/loyalty/revenue-recognition/tax/cost-accounting/analytics/profitability/commercial-reconciliation/governance/classification/idempotency/audit/approvals/feature-flag/release-gate | B1 commercial owner | B2 is a read-only consumer of B1 through the frozen `commercial.virtual-account.inbound-funding` v1; every B2 public `GET /commercial/*` reads B1 minimized and audience-scoped | B2 does not introduce a second catalog/plan/fee/commission/billing/invoice/statement/campaign/promotion/coupon/referral/cashback/loyalty/revenue/tax/cost/analytics/commercial-reconciliation/classification/idempotency/audit/approvals/feature-flag authority |
| `CustomerPreference` (including `NotificationPreference`) customer delivery-intent | A1/A2/A7 owner | B2 is a read-only consumer of `CustomerPreference`; B2 never redefines delivery intent; B2 activation/marketing intents (B2T06) are separate and are consumed alongside `CustomerPreference` | B2 does not introduce a second customer delivery-intent/consent/preference/notification authority |
| `CustomerConsent` / `MarketingConsent` activation/marketing intent | B2T06 owner (B2) | B2T06 is the only B2 consent intent authority; B2T05 and B2T09 consume it read-only | B2 does not introduce a second customer-consent/marketing-consent vault; at T01 the records are contract shapes only |
| A6T10 `ExternalDataClassificationRegistry`/`ExternalDataMinimizationService`/`ExternalDataControlAuditContext` | A6T10 owner | B2 is a read-only consumer of A6T10; B2T06-B2T11 register B2 activation/credential/webhook/consent/public-route fields in the registry | B2 does not introduce a second data classification/minimization/data-control audit/consent/disclosure/retention/legal-hold/secret/support-trace/partner-payload validation authority |
| A6T09 `ExternalReconciliationService` | A6T09 owner | B2 is a read-only consumer of A6T09 via the B2 reconciliation read-only boundary | B2 does not introduce a second external-reconciliation authority |
| A7T09 `A7ProductReconciliationService` / B1T09 `B1CommercialReconciliationEngine` | A7T09/B1T09 owner | B2 is a read-only consumer of A7T09 and B1T09 via the B2 reconciliation read-only boundary | B2 does not introduce a second product/commercial-reconciliation authority |
| Shared Operations `AuditService`/`IdempotencyService`/`OutboxService`/`MetricsService`/`DiagnosticsService` | Operations owner | B2 is a read-only consumer of shared Operations services; B2 never introduces a second audit/idempotency/outbox/metrics/diagnostics authority | B2 does not introduce a second audit/idempotency/outbox/metrics/diagnostics authority |
| Wallet/Reconciliation/Support + Finance/Tax/Security/Privacy/Legal/Risk/Compliance | respective owners | B2 is a read-only consumer of each | B2 does not introduce a second wallet/reconciliation/support/finance/tax/security/privacy/legal/risk/compliance authority |
| B2 activation/consumer/credential/sandbox/version/quota/rate-limit/webhook-registration/webhook-delivery/customer-consent/marketing-consent/public-route/release-gate | B2 public-platform owner | B2 is the only authority for B2 activation at T01 (contract only); B2T02–B2T12 will define the B2 surface | B2 does not introduce a second B2 activation authority before B2T12 release gate is approved |

## 6. Existing activation-adjacent gap register

The B2T01 baseline records the existing activation-adjacent gap register:

| Gap | Description | Owner | B2T02–B2T12 mitigation |
| --- | --- | --- | --- |
| GAP-B2-001 | No B2 public API catalog exists; no existing app controller is approved as a B2 public commercial API | B2 public-platform owner | B2T02 will define the B2 public API catalog and route-exposure contract |
| GAP-B2-002 | No B2 activation workflow exists; `CustomerPreference` alone is not an activation state machine | B2 public-platform owner | B2T05 will define the B2 activation workflows and self-service |
| GAP-B2-003 | No B2 customer activation-readiness attestation exists; `CustomerOnboarding` alone is not activation-ready | B2T03 owner | B2T03 will define the B2 customer onboarding extension as a read-only attestation keyed by `Customer.id` |
| GAP-B2-004 | No B2 merchant onboarding exists | B2T04 owner | B2T04 will define merchant onboarding (business/tax/settlement-verified, beneficial-owner trace) |
| GAP-B2-005 | No B2 agent onboarding exists | B2T04 owner | B2T04 will define agent onboarding (network/terminal-verified, supervising `Merchant.id`/`Customer.id` link) |
| GAP-B2-006 | No B2 customer-consent intent authority exists; `CustomerPreference` is delivery intent, not activation/marketing intent | B2T06 owner | B2T06 will define `CustomerConsentV1` (`B2_ACTIVATION`/`B2_SELF_SERVICE`/`B2_COMMERCIAL`) |
| GAP-B2-007 | No B2 marketing-consent intent authority exists | B2T06 owner | B2T06 will define `MarketingConsentV1` (`MARKETING_COMMERCIAL_OFFER` per channel) |
| GAP-B2-008 | No B2 API documentation / versioning contract exists | B2T07 owner | B2T07 will define the OpenAPI v1 `docs/api/B2-OPENAPI-v1.yaml` and `v1` + `Accept` + `Deprecation`/`Sunset` negotiation |
| GAP-B2-009 | No B2 sandbox exists; no existing fixture is approved as a sandbox partition | B2T07 owner | B2T07 will define the partition-isolated `sandbox` keyed by `consumerReference` + `sandboxId` |
| GAP-B2-010 | No B2 developer onboarding exists | B2T07 owner | B2T07 will define `POST /developers` + `POST /consumers/{consumerId}/onboard` |
| GAP-B2-011 | No B2 `ApiConsumer` registry exists | B2T08 owner | B2T08 will define `ApiConsumerV1` (`DRAFT`→`ACTIVE`→`SUSPENDED`→`REVOKED`) |
| GAP-B2-012 | No B2 `ApiCredential` lifecycle exists | B2T08 owner | B2T08 will define `ApiCredentialV1` (`ISSUED`→`ROTATED`→`REVOKED`→`EXPIRED`, hash-only `secretHash`) |
| GAP-B2-013 | No B2 `ApiQuota` exists | B2T08 owner | B2T08 will define `ApiQuotaV1` (`ALLOCATED`→`EXCEEDED`, calendar-day window) |
| GAP-B2-014 | No B2 `ApiRateLimit` / token-bucket exists | B2T08 owner | B2T08 will define `ApiRateLimitV1` (`ALLOWED`→`THROTTLED`, `TOKEN_BUCKET`, `X-RateLimit-*`/`X-Quota-*`) |
| GAP-B2-015 | No B2 webhook registration exists | B2T09 owner | B2T09 will define `WebhookRegistrationV1` (`PENDING_VERIFICATION`→`VERIFIED`→`SUSPENDED`→`REVOKED`, HTTPS-only allowlist, `HMAC_SHA256`) |
| GAP-B2-016 | No B2 webhook delivery exists | B2T09 owner | B2T09 will define `WebhookDeliveryV1` (`ENQUEUED`→`DELIVERED`→`FAILED_RETRYABLE`→`DEAD_LETTER`, `Delivery-Id`, 300s freshness, bounded retry 5) |
| GAP-B2-017 | No B2 webhook verification contract exists; A6 callback authenticity/replay/freshness is not the B2 consumer verification contract | B2T09 owner | B2T09 will define `X-Monienaija-Signature` + `X-Monienaija-Timestamp` + `X-Monienaija-Delivery-Id` with `hmacSha256(secret, body + timestamp)` |
| GAP-B2-018 | No B2 public API authentication integration exists; existing A2 audience does not yet annotate B2 routes | B2T10 owner | B2T10 will integrate every B2 public route with A2 `aud`/`scope`/`exp` + consumer `ACTIVE` + credential liveness + consent/quota/rate-limit checks |
| GAP-B2-019 | No B2 activation data classification exists | B2 public-platform owner | B2T11 (+ B2T06) will register B2 activation/credential/webhook/consent/public-route fields in the A6T10 registry read-only |
| GAP-B2-020 | No B2 public reconciliation exists | B2 public-platform owner | B2T12 will implement the B2 read-only reconciliation (REPEATABLE READ) for activation/credential/quota/rate-limit/webhook/public-route |
| GAP-B2-021 | No B2 activation disable exists | B2T11 owner | B2T11 will define per-cohort/per-consumer/per-route/per-webhook disable + `B2_ACTIVATION_ENABLED=false` |
| GAP-B2-022 | No B2 activation rollback exists | B2T11 owner | B2T11 will define `b2.activation.rollback` that preserves A5/A6/A7/B1/Ledger history |
| GAP-B2-023 | No B2 commercial release gate / B2→B3 handoff exists | B2 release owner | B2T12 will define the B2 release gate (proposed B2 range ADR-0072..ADR-0083) and `docs/B2-B3-HANDOFF-PACKAGE.md` |
| GAP-B2-024 | No B2→B3 production ramp exists | B3 owner (out of scope for B2T01) | B3 (out of scope for B2) |

## 7. Implementation assumptions, exclusions, prohibited edges, rollback, and stop conditions

### 7.1 Implementation assumptions

The B2T01 baseline records the following implementation assumptions, all subject to B2 release-gate review and revisable by B2T12 evidence:

- B2T01 selects exactly one bounded first activation cohort `b2.activation.cohort.inbound-funding.v1` and freezes it at v1; the cohort is the only B2 cohort for the B2 critical path.
- B2 is a read-only consumer of A1–A7 and B1; B2 supplies activation/credential/webhook/consent data to A1–A7/B1 and Operations, not the other way around.
- A1–A7 and B1 remain the only authorities in their domains; B2 does not introduce a second authority in any domain before B2T12 release gate approval.
- The A7 first product `VIRTUAL_ACCOUNT` v1 and the B1 first scope `commercial.virtual-account.inbound-funding` v1 are the only A7/B1 capabilities for which the B2 first cohort may emit an activation or public read.
- The A6 partner `NIBSS_NIP` is the only partner for which the B2 first cohort may depend; B2T01 does not select a second A6 partner beyond the planning rail.
- `NGN` is the only currency and `CUSTOMER_FUNDS` the only accounting unit for which the B2 first cohort may emit an activation; `NG` is the only region at T01.
- At T01 the merchant/agent cohorts are `Prohibited`; B2T01 freezes the cohort as customer-only and records their future `Merchant.id`/`Agent.id` keys as prohibited adjacent cohorts for B2T04 expansion.
- B2T01 does not select a pricing scheme, fee structure, commission model, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition standard, tax/VAT scheme, cost-accounting methodology, or profitability model beyond the frozen B1 catalogue — B2 consumes B1 as read-only commercial data.
- B2T01 does not select a public commercial route without an A2 audience/scope, a raw-credential store, a marketing-campaign, a native screen, or a partner marketplace; these remain B2T02–B2T11 deliverables.
- B2T01 does not create or modify any application source, entity, migration, service, controller, API, route, scheduler, credential, secret, webhook, sandbox, public surface, activation, or runtime behavior.

### 7.2 Exclusions

The B2T01 baseline records the following exclusions:

- B2 does not implement a public commercial API, API authentication, webhook registration, webhook delivery, sandbox, credential, quota, rate limit, activation workflow, or consent record in B2T01; B2T02–B2T11 will define each surface in detail.
- B2 does not select a second activation cohort, a second B1 scope, a second partner, a second currency, a second accounting unit, a second region, a second customer tier, a second merchant tier, a second partner tier, a second consent purpose beyond `B2_ACTIVATION`/`B2_SELF_SERVICE`/`B2_COMMERCIAL` + `MARKETING_COMMERCIAL_OFFER`, a second public API version beyond `v1` at T01, or a second webhook event beyond `b2.activation.*`/`b2.webhook.test` at T01.
- B2 does not begin B2T02 or any later B2 task in B2T01; B2T01 is a documentation-only baseline and introducing B2T02 runtime design beyond the cohort/route shape is an explicit B2T01 failure.
- B2 does not begin B3 scale/selective extraction/cloud/observability/multi-region/cross-currency/second-scope/second-partner beyond `NIBSS_NIP` or production ramp in B2T01; B3 is the future phase after B2.
- B2 does not begin A8 scale/service-topology/regional/partner/product/capacity/mobile/web/marketing-notification beyond the funded A7/B1/B2 plan surfaces in B2T01.
- B2 does not claim any A1, A2, A3, A4, A5, A6, A7, B1, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, or partner approval in B2T01; B2T01 records that those approvals are prerequisites for B2T02–B2T12 and remain `Pending` until the B1→B2 release gate is `APPROVED` and each B2 task's acceptance criteria are satisfied.

### 7.3 Prohibited edges

The B2T01 baseline records the following prohibited edges (the B2 prohibited edges are also enumerated in `docs/B2-IMPLEMENTATION-PLAN.md` §11; B2T01 references the full list):

- B2 does not treat an activation, credential, webhook registration/delivery, sandbox session, API version, quota allotment, rate-limit bucket, or public-route hit as canonical Customer/Merchant/Agent identity, A2 authorization, A3 binding, A4 policy, A5 ledger, A6 partner, A7 product, B1 commercial decision, `CustomerPreference` intent, or marketing-consent intent.
- B2 does not select a `WalletAccount`/`LedgerAccount` from a customer/merchant/agent reference, consumer/credential reference, activation reference, webhook reference, or commercial reference.
- B2 does not post a journal, mutate a balance, clear suspense, or edit a posted journal/line outside Ledger and Finance-approved correction boundaries.
- B2 does not dispatch a notification for an activation, credential, webhook, consent, or public-route event beyond enqueuing an A7T06-compatible delivery intent to `OutboxService`.
- B2 does not mutate completed A5 transfer, A6 settlement/suspense/journal, A7 product operation, A7 financial-effect, A7 reconciliation, A7 data-minimization, B1 commercial decision, or Ledger history for activation/credential/consent/webhook/route correction.
- B2 does not invent a second audit, idempotency, outbox, metrics, diagnostics, customer-binding, policy, authorization, notification, settlement, reconciliation, classification, retention, legal-hold, secret, disclosure, support, webhook, credential, consent, or `CustomerPreference` authority.
- B2 does not begin B3 scale, B3 selective extraction, B3 cloud/observability, B3 multi-region, B3 cross-currency, B3 second scope, B3 second partner beyond `NIBSS_NIP`, or B3 production ramp in B2T01.

### 7.4 Rollback assumptions

The B2T01 baseline records the following rollback assumptions:

- B2 disable (per-cohort/per-consumer/per-route/per-webhook) and environment `B2_ACTIVATION_ENABLED=false` + A6 circuit-breaker stop new B2 public activation without rewriting A5/A6/A7/B1/Ledger/`CustomerPreference`/Operations history.
- B2 activation rollback (`b2.activation.rollback`) transitions `PENDING_*`/`ACTIVE` activations to `SUSPENDED`/`REVOKED` with reason `ROLLBACK` and preserves the existing A7 first product, the A6 partner boundary, the A5 ledger, the A3 binding, the A4 policy, the B1 commercial plan, the `CustomerConsent`/`MarketingConsent` history, and the Operations audit/idempotency/outbox/metrics/diagnostics.
- B2 rollback procedures preserve the existing activation-adjacent module surface (customer, wallet, ledger, operations, partner, reconciliation, policy, product-governance, payment/quote/fee/limit, B1 commercial platform, A7 product surface).
- B2 rollback procedures preserve the existing A1–A7/B1 partner-certification, settlement/suspense/compensating, external-reconciliation, and data-minimization state.
- B2 rollback procedures do not require mutating any source record; B2T01 records that B2 is a read-only consumer of A1–A7/B1 and a read-only consumer of Operations services and that `WebhookDeliveryV1.deliveryId` is the idempotency key for replay.
- B2 disable and rollback procedures will be authored by B2T11 (out of scope for B2T01).

### 7.5 Stop conditions

The B2T01 baseline records the following stop conditions:

- B2 release-gate review stops if the first activation cohort key/segment rule/prohibited adjacent cohorts are changed without a separate B2 cycle.
- B2 release-gate review stops if any B2 activation is made for a live customer/merchant/agent cohort beyond `b2.activation.cohort.inbound-funding.v1`.
- B2 release-gate review stops if any B2 activation bypasses `CustomerConsent` `GRANTED` (where required), `MarketingConsent` `GRANTED` (where a marketing-class message would be sent), or `CustomerPreference.notifications` (where a notification-class message would be sent).
- B2 release-gate review stops if any B2 public route is exposed without an A2 audience/scope or if any public commercial mutation is unauthenticated.
- B2 release-gate review stops if any B2 public behavior stores raw credentials, `clientSecret`, webhook `secret`, PAN, account secret, PIN, OTP, callback signature, or private key in a broad record/log/trace/event/webhook body.
- B2 release-gate review stops if any B2 behavior posts a journal, mutates a balance, repairs a binding, changes A4 policy/source records, or dispatches a notification beyond an enqueued delivery intent.
- B2 release-gate review stops if any B2 behavior bypasses A1/A2/A3/A4/A5/A6/A7/B1/`CustomerPreference`/Operations/A6T10 data-control authorities.
- B2 release-gate review stops if any B2 behavior is made for a second activation cohort, a second B1 scope, a second partner beyond `NIBSS_NIP`, a second currency/region/accounting unit, a second product entitlement beyond the T01 minimized surface, or a public commercial API outside `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md`.
- B2 release-gate review stops if B2 begins B3 scale/selective extraction/cloud/observability/multi-region/cross-currency/second-scope/second-partner beyond `NIBSS_NIP` or production ramp.
- B2 release-gate review stops if any unresolved B2 implementation risk is unowned or unaddressed.
- B2 release-gate review stops if any B2 prohibited edge is detected.

## 8. Compatibility assessment

The B2T01 baseline records the compatibility assessment for the first bounded activation capability.

### 8.1 Existing activation-adjacent module compatibility

The B2T01 baseline classifies the following existing activation-adjacent modules as compatibility input only:

- existing `customer` / `customer-authentication` / `customer-onboarding` / `customer-eligibility` / `customer-risk-profile` / `customer-preference` / `customer-wallet` / `customer-funding-instrument` / `customer-beneficiary` / `customer-compliance` — compatibility input; B2T03 will extend the customer activation-readiness attestation as a read-only projection keyed by `Customer.id`.
- existing `wallet` / `ledger` — compatibility input; Ledger is the only financial value authority; B2 will be a read-only consumer of A5 ledger-backed account state.
- existing `operations` primitives — compatibility input; B2 will reuse `AuditService`/`IdempotencyService`/`OutboxService`/`MetricsService`/`DiagnosticsService` for activation/credential/webhook/consent events.
- existing `partner` / `reconciliation` — compatibility input; A6/A7T09/B1T09 are the only reconciliation authorities; B2 reconciliation will read from A6T09/A7T09/B1T09.
- existing `policy` submodules (`a7-*`, `b1-*`, capability/policy) — compatibility input; A4 remains the only policy evaluator, A7 the only product authority, B1 the only commercial-decision authority.
- existing `authorization` / `product-governance` / `health` / `production` / `maturity` / `pilot` / `fee` / `quote` / `limit` — compatibility input; B2 will reuse A2 authorization and product-governance evidence read-only.

### 8.2 CustomerPreference and CustomerConsent compatibility

The B2T01 baseline records that `CustomerPreference.notifications` is the only customer delivery-intent authority for any B2 activation that would cause a notification-class message. B2 consumes `CustomerPreference` and never redefines delivery intent. B2T06 `CustomerConsent` (purposes `B2_ACTIVATION`/`B2_SELF_SERVICE`/`B2_COMMERCIAL`) and `MarketingConsent` (purpose `MARKETING_COMMERCIAL_OFFER` channels `email`/`sms`/`push`/`inApp`) are the only activation/marketing intent authorities; they are consumed alongside `CustomerPreference` and never replace it. At T01 the consent records are contract shapes only, not live records.

### 8.3 A6 partner / scheme compatibility

The B2T01 baseline records that the A6 partner `NIBSS_NIP` planning rail is the only partner for which the B2 first cohort may depend. B2 consumes A6 through the existing A7 product layer and through the B2 webhook boundary (only `b2-webhook` may call a consumer URL). The A6 phase result remains `NOT APPROVED / CONDITIONAL` per `docs/A7-APPROVAL-PACKAGE.md` §3.1 and `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` §8.3; B2T01 does not claim partner certification, live migration execution, or production activation.

### 8.4 A7 product compatibility

The B2T01 baseline records that the A7 first product `VIRTUAL_ACCOUNT` v1 (inbound funding, provider-backed virtual account, `NIBSS_NIP`, `NGN`, `CUSTOMER_FUNDS`) is the only A7 product for which the B2 first cohort may emit an activation or public read. B2 consumes the A7 product layer through existing read-only consumer boundaries and never substitutes the A7 product boundary. The A7 phase result remains `Prepared, not approved, not certified, not activated, not handed off to A8` per `docs/A7-EXIT-CHECKLIST.md` §4 (`docs/A7-A8-HANDOFF-PACKAGE.md` §4).

### 8.5 B1 commercial compatibility

The B2T01 baseline records that the B1 first scope `commercial.virtual-account.inbound-funding` v1 is the only B1 capability for which the B2 first cohort may emit an activation or public `GET /commercial/*` read. B2 consumes the B1 commercial catalog as the B1 invariant: B1 provides the commercial catalog and plan-boundary contract, the B1 commercial-decision data `A4` consumes, and the B1 commercial-tier/entitlement/subscription data `A3` consumes. The B1 phase result remains `Prepared — not approved, not live-certified, not activated, not handed off to B2` per `docs/B1-EXIT-CHECKLIST.md` §9 (`docs/B1-B2-HANDOFF-PACKAGE.md` §2 `BLOCKED`).

### 8.6 A1–A7 + B1 dependency compatibility

The B2T01 baseline records the A1–A7 + B1 dependencies as follows:

- A1 — dependency satisfied (A1 committed); B2 surface requires no new canonical-ownership/identifier/privacy/retention decision at T01.
- A2 — dependency satisfied (A2 committed; B2 surface requires A2 audience/scope/privileged-action approval before B2T02–B2T12, every new B2 public route requires an A2 audience).
- A3 — dependency satisfied (A3 committed; B2 surface requires A3 binding/read/reconciliation approval before B2T02–B2T12; B2 never repairs bindings).
- A4 — dependency satisfied (A4 committed; B2 surface requires A4 policy mapping before B2T02–B2T12; A4 remains the only policy authority).
- A5 — dependency satisfied (A5 committed; B2 surface requires A5 ledger/account/state/posting/financial-invariants and Operations primitives approval).
- A6 — dependency partially satisfied (A6 committed; A6 partner is not connected/certified; A6 phase result `NOT APPROVED / CONDITIONAL`; B2 surface requires A6 callback/settlement/suspense/reconciliation/data-minimization approval before B2T02–B2T12).
- A7 — dependency partially satisfied (A7 committed; A7 phase result `Prepared, not approved, not certified, not activated, not handed off to A8`; B2 surface requires A7 product catalog/boundary/customer-binding/command/notification/lifecycle/financial-effect/reconciliation/data-minimization approval).
- B1 — dependency partially satisfied (B1 committed; B1 phase result `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2 surface requires B1 catalog/fee/billing/campaign/referral/revenue-recognition/analytics/governance approval before B2T02–B2T12).
- Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, partner — dependency requires review and approval before B2T02–B2T12; B2T01 does not claim any such approval.

## 9. Implementation readiness and entry conditions for B2T02

B2T02 may begin only when:

- B2T01 is committed and reviewed (this document).
- The B2 implementation plan is committed (`docs/B2-IMPLEMENTATION-PLAN.md`).
- The A1–A7 and B1 release-gate evidence packages remain committed and unchanged by B2T01.
- The A1–A7 + B1 phase results remain `Prepared` (A1–A5), `NOT APPROVED / CONDITIONAL` (A6), `Prepared, not approved, not certified, not activated, not handed off to A8` (A7), and `Prepared — not approved, not live-certified, not activated, not handed off to B2` (B1, `BLOCKED`).
- The A6 partner-adapter/callback/settlement/suspense/reconciliation/data-minimization contracts (A6T02–A6T10) and the A7 product contracts (A7T02–A7T10) and the B1 commercial contracts (B1T02–B1T10) remain committed and unchanged by B2T01.
- The B1 catalog `commercial.virtual-account.inbound-funding` v1 remains frozen at v1; the B2 cohort `b2.activation.cohort.inbound-funding` v1 is frozen at v1 and the first cohort selection is reviewed and approved by the B2 activation owner (Product + Commercial + Architecture), the B1 commercial owner, the A7 product owner, and the A6 partner owner (all pending at T01).
- No B2 runtime, entity, migration, repository, service, controller, module, API, route, scheduler, credential, secret, webhook, sandbox, public surface, activation, product, notification, B3, or A8 work is introduced by B2T01.
- B2T02 must still author the first B2 ADRs in the proposed B2 range (`ADR-0072`–`ADR-0083`) — at least ADR-0072 (activation scope) and ADR-0073 (public API/route exposure boundary) — and must still pass its own acceptance criteria before any B2T03+ implementation begins.
- B2T01 does not authorize B2T02 or any later B2 task to bypass the B1→B2 entry conditions, the B2 plan §5 non-goals, or the A1–A7/B1 release-gate approvals.

B2T01 is a planning artifact. It does not authorize B2T02 or any later B2 task to begin runtime work.

## 10. B2T01 validation record

- [x] Existing `customer`, `customer-authentication`, `customer-onboarding`, `customer-eligibility`, `customer-risk-profile`, `customer-preference`, `customer-wallet`, `customer-funding-instrument`, `customer-beneficiary`, `customer-compliance`, `wallet`, `ledger`, `operations`, `partner`, `reconciliation`, `policy` (`a7-*`, `b1-*`, capability/policy), `product-governance`, `authorization`, `health`/`production`/`maturity`/`pilot`/`fee`/`quote`/`limit`/`bank` and A7 product + B1 commercial surfaces have been reviewed.
- [x] One bounded first activation cohort is selected: `b2.activation.cohort.inbound-funding.v1` (bounded onboarding/activation/public-surface/credential/webhook/governance envelopes) for the frozen B1 first scope `commercial.virtual-account.inbound-funding` v1 under `VIRTUAL_ACCOUNT` v1, partner `NIBSS_NIP`, currency `NGN`, accounting unit `CUSTOMER_FUNDS`, region `NG`.
- [x] The selected cohort's key, version, segment rule (`KYC VERIFIED` + `CustomerRisk ∉ {PROHIBITED, CRITICAL-blocked}` + `A3 binding VERIFIED (NGN/CUSTOMER_FUNDS)` + `A4 ELIGIBLE for product.virtual-account + B1 tier/entitlement COMPATIBLE` + `CustomerConsent GRANTED (B2_ACTIVATION)`), customer/merchant/agent composition (Customer only at T01; merchant/agent `Prohibited`), consent purposes (`B2_ACTIVATION` at T01), A2 audience pair (`public:commercial:activation:b2:inbound-funding:read/write`), internal activation owner (B2 Commercial Activation), partner dependency (`NIBSS_NIP`), data fields (`activationReference`/`Customer.id`/`activationCohortKey`/`b1PlanKey`/`a7ProductKey`/`virtualAccountId`/`consentPurpose`/`activationState`/`idempotencyKey`/`requestHash`/`auditActor`/`auditEntityType`/`outboxEventType`/`createdAt` with hash-excluded fields), and prohibited adjacent cohorts/channels are explicit.
- [x] The existing activation-adjacent modules are classified as compatibility input, not as evidence of a B2 activation boundary.
- [x] The existing `CustomerPreference.notifications` is classified as the only customer delivery-intent authority; B2 will consume but never redefine delivery intent; `CustomerConsent`/`MarketingConsent` are classified as distinct activation/marketing intent authorities (B2T06 shapes only at T01).
- [x] A1, A2, A3, A4, A5, A6, A7, B1, B2, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Support, Product, Commercial, and `CustomerPreference`/`CustomerConsent`/`MarketingConsent` dependencies are mapped.
- [x] The A1 canonical ownership/identifier/privacy/retention/legal-hold/cross-cutting contracts are inherited as the A1 authority boundary; B2 does not duplicate or replace them.
- [x] The A2 authenticated principal/audience/authorization/privileged-action/protected-ingress/security-event contracts are inherited as the A2 authority boundary; B2 does not duplicate or replace them and every new B2 public route requires an A2 audience/scope.
- [x] The A3 canonical Customer-to-Financial-Account binding/ownership/lifecycle/currency/accounting-unit/repair/reconciliation contracts are inherited as the A3 authority boundary; B2 does not duplicate or replace them.
- [x] The A4 capability/action policy/limits/obligations/evidence/expiry/re-evaluation/currentness contracts are inherited as the A4 authority boundary; B2 does not duplicate or replace them.
- [x] The A5 customer-aware command/correlation/lifecycle/ledger/operations/outbox/unknown-outcome/pilot-disable/independent-reconciliation patterns are inherited as the A5 authority boundary; B2 does not duplicate or replace them.
- [x] The A6 partner-adapter/capability/version/callback/provider-idempotency/settlement/suspense/external-reconciliation/data-minimization contracts are inherited as the A6 authority boundary; B2 does not duplicate or replace them.
- [x] The A7 product contracts are inherited as the A7 authority boundary; B2 does not duplicate or replace them.
- [x] The B1 commercial catalog/plan-boundary/campaign/referral/revenue-recognition/etc. contracts are inherited as the B1 authority boundary; B2 is a read-only consumer of the frozen `commercial.virtual-account.inbound-funding` v1 and never becomes a B1 authority.
- [x] The A6T10 `ExternalDataClassificationRegistry`/`ExternalDataMinimizationService`/`ExternalDataControlAuditContext` and A7T10/B1T10 data-classification/minimization/control-audit surfaces are inherited as the data-classification authority boundary; B2 does not duplicate or replace them.
- [x] The A6T09 `ExternalReconciliationService` / A7T09 / B1T09 reconciliation surfaces are inherited as the reconciliation authority boundary; B2 does not duplicate or replace them.
- [x] The shared Operations `AuditService`/`IdempotencyService`/`OutboxService`/`MetricsService`/`DiagnosticsService` are inherited as the operations authority boundary; B2 does not duplicate or replace them.
- [x] A1–A7 + B1 handoff entry conditions are recorded; B2T01 does not claim any A1/A2/A3/A4/A5/A6/A7/B1/Finance/Tax/Security/Privacy/Legal/Risk/Compliance/Operations/Reconciliation/Support/Product/Commercial/partner approval.
- [x] A6 phase result is `NOT APPROVED / CONDITIONAL`; A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; B1 phase result is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`); B2T01 does not claim partner certification, live migration, production activation, or B2 approval.
- [x] No application source, entity, migration, repository, service, controller, module, API, route, scheduler, credential, secret, webhook, sandbox, public surface, activation, product, notification, B3, or A8 work is created by B2T01.
- [x] B2T01 is a planning artifact; it does not authorize B2T02 or any later B2 task to begin runtime work.
- [x] B2T01 does not begin B3 scale/selective extraction/cloud/observability/multi-region/cross-currency/second-scope/second-partner beyond `NIBSS_NIP` or production ramp.
- [x] No ADR is authored by B2T01; the B2T01 baseline records that B2T02 must still author the first B2 ADRs in the proposed B2 range (`ADR-0072`–`ADR-0083`).
- [x] The first activation cohort `b2.activation.cohort.inbound-funding.v1` is frozen at v1 and recorded as the B2T01 selection, with prohibited adjacent cohorts/channels, A2 audience pair, and data fields explicit.

### Evidence limitations

- This baseline reviews committed source, migrations, architecture inventories, A1–A7 + B1 release-gate evidence, the B2 implementation plan, and the existing activation-adjacent module/service/controller/entity inventory; it does not call a partner, query live provider systems, inspect live customer/bank data, certify NIBSS, or verify settlement availability.
- The A6 partner is **not** connected or certified; A6 phase result is `NOT APPROVED / CONDITIONAL`. The first activation cohort's inbound-funding flow depends on the A6 partner, which remains in this state.
- The A7 first product is `Prepared, not approved, not certified, not activated, not handed off to A8`. The first activation cohort depends on the A7 first product, which remains in this state.
- The B1 commercial scope is `Prepared — not approved, not live-certified, not activated, not handed off to B2` (`BLOCKED`). The first activation cohort's commercial exposure depends on the B1 first scope, which remains in this state.
- B2T01 does not claim that A1/A2/A3/A4/A5/A6/A7/B1/Finance/Tax/Security/Privacy/Legal/Risk/Compliance/Operations/Reconciliation/Support/Product/Commercial/partner owners have approved the first activation cohort or any B2 surface.
- B2T01 does not author any B2 ADR. The first B2 ADRs will be authored by B2T02 (at least ADR-0072 and ADR-0073).
- B2T02–B2T12 must define, implement, test, and gate the B2 public API catalog, route-exposure contract, customer/merchant/agent onboarding, activation workflows, consent, documentation/versioning/sandbox/developer onboarding, credentials/consumers/quotas/rate limits, webhook registration/delivery/verification, public API authentication, activation rollback/disable, and the B2 release gate before any B2 public commercial operation is considered.
- B2T01 records the bounded first activation cohort `b2.activation.cohort.inbound-funding.v1` as a planning artifact; B2T01 does not authorize any B2 activation, public API, credential, sandbox, webhook, consent, or commercial operation, and B2 remains `Planned` (not prepared) until B2T02 commits the first B2 ADRs.
