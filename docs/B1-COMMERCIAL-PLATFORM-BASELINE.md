# B1T01 — Commercial Platform Baseline and First-Commercial-Scope Selection

- **Phase:** B1 — Commercial Platform
- **Task:** B1T01 — Commercial Platform Baseline and First-Commercial-Scope Selection
- **Status:** Baseline prepared for B1T02; no B1 runtime implementation introduced
- **Classification:** Documentation-only B1 implementation baseline
- **Review snapshot:** `7662c18` (B1 implementation plan committed; A1-A7 phase evidence committed; A1-A7 phase results are independent; the A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`)
- **Selected first commercial scope:** `commercial.virtual-account.inbound-funding.v1` (bounded commercial-decision envelope, bounded commercial-financial-effect envelope, bounded commercial-incentive envelope, bounded commercial-analytics envelope) under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`
- **Application, database, API, migration, controller, route, scheduler, pricing, fee, commission, revenue, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, tax / VAT, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, public-channel, and financial-runtime changes in this task:** None

## 1. Purpose and boundary

B1T01 establishes the current repository baseline for the first bounded commercial-platform capability. It inventories the existing commercial-adjacent surfaces (existing `fee` module, existing `quote` module, existing `limit` module, existing `payment-quote` entity, existing `customer-preference` module, existing `customer-beneficiary` module, existing `transfer` module, existing `payment` module, existing settlement-account service, existing `ledger` module, existing `partner` module, existing `reconciliation` module, and existing A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts) and selects one bounded first commercial scope — `commercial.virtual-account.inbound-funding.v1` — without treating existing commercial metadata, fees, commissions, billing cycles, or invoice formats as B1-approved behavior.

B1 is an Architecture phase. B1T01 is documentation-only. It is not a commercial activation, a pricing activation, a fee activation, a commission activation, a billing activation, an invoice activation, a statement activation, a campaign activation, a promotion activation, a coupon activation, a referral activation, a cashback activation, a loyalty activation, a tax activation, a cost-accounting activation, a profitability activation, a commercial-analytics activation, a customer-tier activation, a merchant-tier activation, a partner-tier activation, an entitlement activation, a feature-flag activation, a dynamic-limit activation, a subscription activation, a product-package activation, a bundle activation, a commercial-approval activation, a commercial-audit activation, a commercial-idempotency activation, a commercial-reconciliation activation, a commercial-data-classification activation, a commercial-retention activation, a commercial-legal-hold activation, a commercial-secret activation, a commercial-disclosure activation, a commercial-release-gate activation, a public commercial surface, or a release-gate decision. B1T01 records:

- the existing commercial-adjacent module and route inventory (`fee`, `quote`, `limit`, `payment-quote`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, settlement-account, `ledger`, `partner`, `reconciliation`, support);
- the commercial candidate matrix (direction, capability, currency, partner dependency, fee structure, commission model, revenue-sharing rule, billing cycle, invoice format, statement format, campaign / promotion / coupon rule, referral / cashback / loyalty rule, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, profitability model, customer tier, merchant tier, partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial release gate, and rollback assumptions);
- one selected B1 first commercial scope `commercial.virtual-account.inbound-funding.v1` (bounded commercial-decision envelope, bounded commercial-financial-effect envelope, bounded commercial-incentive envelope, bounded commercial-analytics envelope) with explicit internal commercial-decision owner, partner dependency (where applicable), currency, accounting unit, data fields, and prohibited adjacent commercial scopes;
- the existing commercial-adjacent gap register, including commercial-decision delivery, commercial-financial-effect delivery, commercial-incentive delivery, public commercial surface, and commercial preference enforcement;
- the commercial-decision identifier, credential, secret, data-sharing, consent, retention, and legal-hold inventory;
- the B1 dependency, risk, certification, stop-condition, commercial-rollback, and internal-history-preservation register; and
- the compatibility classification for the existing commercial-adjacent modules, `CustomerPreference`, A6 partner / scheme metadata, and A7 product metadata.

B1T01 is deliberately bounded to one first commercial scope: `commercial.virtual-account.inbound-funding.v1` under the existing A7 first product `VIRTUAL_ACCOUNT` v1. B1T01 does not select a second commercial scope, a second commercial partner, a second currency, a second accounting unit, a second customer tier, a second merchant tier, a second partner tier, a second product entitlement, a second feature flag, a second dynamic limit, a second subscription plan, a second product package, a second bundle, a notification channel, a public surface, a pricing model, a fees model, a commissions model, a revenue-sharing model, a billing cycle, an invoice format, a statement format, a campaign, a promotion, a coupon, a referral program, a cashback program, a loyalty program, a revenue-recognition standard, a tax / VAT scheme, a cost-accounting methodology, a profitability model, a commercial analytics report, a customer-cohort expansion, a merchant-cohort expansion, a partner-cohort expansion, an FX capability, savings interest, lending, a cross-region rollout, a cross-currency rollout, a B2 public-channel implementation, a B2 marketing-consent onboarding, or any other commercial expansion. Each additional commercial scope is a separate B1 cycle and is out of scope for B1T01.

## 2. B1 entry conditions and baseline assumptions

### 2.1 B1 entry conditions inherited from the A7 handoff

B1 is blocked from being treated as a release authorization. Per [`docs/A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md) §4 and the A7 release-gate cross-references in [`docs/A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) §3, the A1-A7 phases are the precondition for any B1 commercial implementation. B1 must not begin implementation until the following A1-A7 prerequisites are independently approved and recorded:

1. A1 phase exit and accountable-owner approval.
2. A2 route / data-exposure, service audience, security, and privileged-access approval for any B1 surface.
3. A3 binding / read / reconciliation approval for any B1 commercial-decision / commercial-financial-effect / commercial-billing / commercial-invoice / commercial-statement / commercial-campaign / commercial-promotion / commercial-coupon / commercial-referral / commercial-cashback / commercial-loyalty / commercial-revenue-recognition / commercial-tax / commercial-cost-accounting / commercial-profitability / commercial-analytics / commercial-reconciliation surface.
4. A4 policy mapping for any B1 commercial capability, including external-risk / compliance evidence, limits, currentness, and re-evaluation.
5. A5 Ledger, account, state, posting, settlement, suspense, compensating-entry, financial-invariants, and financial-correction approval for any B1 commercial-financial-effect / commercial-billing / commercial-invoice / commercial-statement / commercial-revenue-recognition / commercial-tax / commercial-cost-accounting surface.
6. A6 partner capability, callback, settlement, suspense, compensating-entry, external-reconciliation, and data-minimization owner approval for any B1 commercial flow that depends on the A6 partner.
7. A7 product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, and product data-minimization owner approval for any B1 commercial flow that depends on an A7 product.
8. Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, and partner review and approval for any B1 commercial flow.

B1T01 records that none of the above A1-A7 approvals are claimed by this baseline. B1T01 is a planning artifact. B1T01 does not begin B1T02 or any later B1 task until the A1-A7 prerequisites above are independently approved and recorded.

### 2.2 B1T01 baseline assumptions

The B1T01 baseline records the following assumptions, all of which are subject to A1-A7 release-gate review and may be revised by B1T11 evidence:

- A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts are committed and unchanged.
- A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts are committed and unchanged.
- A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts are committed and unchanged.
- A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, and currentness contracts are committed and unchanged.
- A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns are committed and unchanged.
- A6 partner-adapter boundary, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization are committed and unchanged.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts are committed and unchanged.
- The existing A7 first product `VIRTUAL_ACCOUNT` v1 (provider-backed virtual account, inbound funding, `NIBSS_NIP` planning rail, `NGN`, `CUSTOMER_FUNDS`) is the only A7 product for which the B1 first commercial scope may emit a commercial-decision.
- `CustomerPreference.notifications` is the only customer intent authority for any B1 commercial notification dispatch; B1 never redefines the intent and never bypasses A7T06.
- The existing A6T10 `ExternalDataClassificationRegistry`, `ExternalDataMinimizationService`, and `ExternalDataControlAuditContext` are the only data-classification, data-minimization, and data-control audit authorities; B1 supplies the B1 commercial-decision data these authorities consume through approved read-only consumer boundaries.
- The existing A6T09 `ExternalReconciliationService` is the only external reconciliation authority; B1 supplies the B1 commercial-reconciliation engine output through the B1T09 commercial-reconciliation contract, which consumes A6T09 and A7T09 read-only.
- The shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, and `DiagnosticsService` are the only audit, idempotency, outbox, metrics, and diagnostics authorities; B1 supplies the B1 commercial-decision audit, B1 commercial-decision idempotency, B1 commercial-decision outbox, B1 commercial-decision metrics, and B1 commercial-decision diagnostics through approved read-only consumer boundaries to these services.

### 2.3 B1T01 baseline non-assumptions

The B1T01 baseline does not record the following:

- B1 does not select a second commercial scope.
- B1 does not select a second commercial partner.
- B1 does not select a second currency.
- B1 does not select a second accounting unit.
- B1 does not select a second customer tier, merchant tier, or partner tier.
- B1 does not select a second product entitlement, feature flag, dynamic limit, subscription plan, product package, or bundle.
- B1 does not select a second fee structure, commission model, revenue-sharing rule, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, or profitability model.
- B1 does not select a public commercial surface, a public commercial API, a public commercial channel, a mobile commercial channel, a web commercial channel, a marketing-consent surface, or a customer-cohort expansion.
- B1 does not select a cross-region rollout, a cross-currency rollout, or a B2 customer-activation rollout.
- B1 does not select a second commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate.

## 3. Current repository baseline

The B1T01 baseline records the current repository baseline for the first bounded commercial-platform capability. The baseline is documented-only and does not modify any application source.

### 3.1 Existing commercial-adjacent module and route inventory

The following existing modules, services, controllers, and entities are reviewed by B1T01 as commercial-adjacent compatibility input. None of the following is treated as B1-approved commercial behavior; all are classified as compatibility input only.

| Existing module / service / controller / entity | Path | Commercial-adjacent surface | Classification |
| --- | --- | --- | --- |
| `fee` module (engine, controller, module, types) | `src/fee/` | fee rule, fee calculation, fee schedule | Compatibility input; existing A1-A5 fee surface is reused by A5 and is not a B1 commercial authority |
| `quote` module (service, controller, module, types, enums) | `src/quote/` | payment quote, quote request, quote response | Compatibility input; existing A1-A5 quote surface is reused by A5 and is not a B1 commercial authority |
| `limit` module (engine, controller, module, types) | `src/limit/` | per-customer / per-product / per-channel limit | Compatibility input; existing A4 limit surface is the only limit authority; B1 supplies commercial-decision data to A4, not the other way around |
| `payment-quote` entity | `src/quote/payment-quote.entity.ts` | payment quote persistence | Compatibility input; existing A1-A5 quote persistence is reused by A5 and is not a B1 commercial authority |
| `customer-preference` module (controller, service, module, types, enums) | `src/customer-preference/` | customer notification preference, customer security preference, customer language preference, customer theme preference, preference history | Compatibility input; `CustomerPreference.notifications` is the only customer intent authority; B1 consumes `CustomerPreference` and never redefines the intent |
| `customer-beneficiary` module (controller, service, module, types, enums) | `src/customer-beneficiary/` | customer-owned beneficiary, beneficiary ownership, beneficiary history, beneficiary verification | Compatibility input; A3 binding is the only binding authority; B1 supplies commercial-decision data to A3, not the other way around |
| `transfer` module (service, controller, module, types, enums, lifecycle) | `src/transfer/` | transfer command, transfer lifecycle, transfer events, internal transfer gate | Compatibility input; A5 transfer / deposit / withdrawal lifecycle is the only internal lifecycle authority; B1 consumes A5 and never rewrites A5 history |
| `payment` module (service, controller, module, types, enums, lifecycle) | `src/payment/` | payment command, payment lifecycle, payment reference, settlement account | Compatibility input; A5 payment lifecycle is the only internal payment authority; B1 consumes A5 and never rewrites A5 history |
| `settlement-account` service | `src/payment/settlement-account.service.ts` | settlement account, settlement account support | Compatibility input; A5 settlement account is the only settlement account authority; B1 consumes A5 and never rewrites A5 history |
| `ledger` module (service, controller, module, types) | `src/ledger/` | journal, line, balance, account, settlement, suspense, compensating entry | Compatibility input; A5 Ledger is the only financial value authority; B1 supplies commercial-decision data to A5, not the other way around |
| `partner` module (partner-adapter, callback, external-operation, external-settlement, external-reconciliation, external-data-minimization, partner-circuit-breaker) | `src/partner/` | A6 partner-adapter, A6T05 external-operation, A6T06 callback, A6T08 external-settlement, A6T09 external-reconciliation, A6T10 external-data-minimization, A6 partner-circuit-breaker | Compatibility input; A6 is the only partner authority; B1 consumes A6 through the existing A7 product layer and never substitutes the A6 partner boundary |
| `reconciliation` module (service, evaluator, types, enums) | `src/reconciliation/` | external reconciliation, internal reconciliation, discrepancy classification | Compatibility input; A6T09 external reconciliation and A7T09 product reconciliation are the only reconciliation authorities; B1T09 commercial-reconciliation engine reads from A6T09 and A7T09 and never writes source records |
| A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization | `src/policy/a7-product-*.ts`, `src/policy/a7-product-*.spec.ts` | product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, product data-minimization | Compatibility input; A7 is the only product authority; B1 consumes the A7 product layer through the existing A7 read-only consumer boundaries and never substitutes the A7 product boundary |
| Existing commercial-adjacent module / service / controller / entity classification | n/a | n/a | All existing commercial-adjacent surfaces are classified as compatibility input and are not B1 commercial authorities; B1 does not activate, route-expose, schedule, or persist any commercial-decision / commercial-financial-effect / commercial-billing / commercial-invoice / commercial-statement / commercial-campaign / commercial-promotion / commercial-coupon / commercial-referral / commercial-cashback / commercial-loyalty / commercial-revenue-recognition / commercial-tax / commercial-cost-accounting / commercial-profitability / commercial-analytics / commercial-reconciliation record in B1T01 |

### 3.2 Commercial-adjacent surface inventory summary

The B1T01 baseline records the commercial-adjacent surface inventory summary:

- existing fee: 1 module, 1 controller, 1 engine, 1 types file;
- existing quote: 1 module, 1 controller, 1 service, 1 types file, 1 enums file, 1 entity;
- existing limit: 1 module, 1 controller, 1 engine, 1 types file;
- existing customer-preference: 1 module, 1 controller, 1 service, 1 types file, 1 enums file, 1 entity, 4 sub-entities (language, notification, security, theme), 1 history entity;
- existing customer-beneficiary: 1 module, 1 controller, 1 service, 1 types file, 1 enums file, 1 entity, 3 sub-entities (history, ownership, verification);
- existing transfer: 1 module, 1 controller, 1 service, 1 types file, 1 enums file, 1 entity, 4 lifecycle files, 1 internal-transfer-gate file;
- existing payment: 1 module, 1 controller, 1 service, 1 types file, 1 enums file, 1 entity, 1 reference entity, 3 lifecycle files, 1 settlement-account service, 1 payment-support file;
- existing ledger: 1 module, 1 controller, 1 service, 1 types file;
- existing partner: 1 module, 1 callback controller, 1 callback service, 1 callback-ingestion service, 1 callback-authentication service, 1 callback-secret source, 1 partner-adapter, 1 partner-circuit-breaker, 1 external-operation, 1 external-operation-lifecycle, 1 external-settlement, 1 external-reconciliation, 1 external-data-minimization;
- existing reconciliation: 1 module, 1 service, 1 evaluator, 1 types file, 1 enums file;
- existing A7 product surface: 9 modules, 9 services, 9 repositories, 9 types files, 9 constants files, 4 test files per module.

The B1T01 baseline does not enumerate every existing commercial-adjacent file; the baseline enumerates the categories and classifies the surface as compatibility input. B1T02 will perform a detailed module-by-module review.

### 3.3 Compatibility classification

The B1T01 baseline classifies the following existing commercial-adjacent surfaces as compatibility input only:

- existing `fee` module, controller, engine, and types — compatibility input; existing A1-A5 fee surface is reused by A5; B1 is a read-only consumer of A5 fee state; B1 does not introduce a second fee engine; B1 does not post to A5 fee state.
- existing `quote` module, controller, service, types, and `payment-quote` entity — compatibility input; existing A1-A5 quote surface is reused by A5; B1 is a read-only consumer of A5 quote state; B1 does not introduce a second quote engine; B1 does not post to A5 quote state.
- existing `limit` module, controller, engine, and types — compatibility input; existing A4 limit surface is the only limit authority; B1 supplies commercial-decision data to A4, not the other way around; B1 does not introduce a second limit engine.
- existing `customer-preference` module, controller, service, types, enums, and entities — compatibility input; `CustomerPreference.notifications` is the only customer intent authority; B1 consumes `CustomerPreference` and never redefines the intent.
- existing `customer-beneficiary` module, controller, service, types, enums, and entities — compatibility input; A3 binding is the only binding authority; B1 supplies commercial-decision data to A3, not the other way around.
- existing `transfer` module, controller, service, types, enums, entity, lifecycle, and internal-transfer-gate — compatibility input; A5 transfer lifecycle is the only internal lifecycle authority; B1 consumes A5 and never rewrites A5 history.
- existing `payment` module, controller, service, types, enums, entity, reference entity, lifecycle, settlement-account, and payment-support — compatibility input; A5 payment lifecycle is the only internal payment authority; B1 consumes A5 and never rewrites A5 history.
- existing `ledger` module, controller, service, and types — compatibility input; A5 Ledger is the only financial value authority; B1 supplies commercial-decision data to A5, not the other way around; B1 does not post to A5 Ledger.
- existing `partner` module and its sub-services — compatibility input; A6 is the only partner authority; B1 consumes A6 through the existing A7 product layer and never substitutes the A6 partner boundary.
- existing `reconciliation` module, service, evaluator, types, and enums — compatibility input; A6T09 external reconciliation and A7T09 product reconciliation are the only reconciliation authorities; B1T09 commercial-reconciliation engine reads from A6T09 and A7T09 and never writes source records.
- existing A7 product surface — compatibility input; A7 is the only product authority; B1 consumes the A7 product layer through the existing A7 read-only consumer boundaries and never substitutes the A7 product boundary.

## 4. B1 first commercial scope selection

### 4.1 First commercial scope

The B1T01 baseline selects exactly one bounded first commercial scope:

```text
commercial-scope-key:    commercial.virtual-account.inbound-funding
commercial-scope-version: 1
direction:               inbound funding to provider-backed virtual account
capability:              product.virtual-account (lifecycle action)
partner dependency:      NIBSS_NIP (selected A6 partner; planning rail)
currency:                NGN
accounting unit:         CUSTOMER_FUNDS
internal lifecycle input: existing A7 first product VIRTUAL_ACCOUNT v1
external target input:    A6 partner-issued virtual-account identifier, A6 callback / report, A6 settlement
```

The first commercial scope is a single bounded commercial scope under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`. The first commercial scope is the only B1 commercial scope for the B1 critical path.

### 4.2 First commercial scope envelopes

The first commercial scope `commercial.virtual-account.inbound-funding.v1` is bounded to four envelopes. Each envelope is read-only or B1-internal; no envelope posts a journal, mutates a balance, repairs a binding, changes A4 policy / source records, or dispatches a notification.

#### 4.2.1 Bounded commercial-decision envelope

The bounded commercial-decision envelope covers the B1 commercial-decision data that the A7T05 product command and the A7T08 product financial effect consume through approved read-only consumer boundaries. The envelope is the B1T04 fee, commission, and revenue-sharing engine output; the envelope is the B1T03 pricing, plan, subscription, customer-tier, merchant-tier, partner-tier, product-entitlement, product-packaging, and bundle catalog; the envelope is the B1T10 feature flag surface; the envelope does not include any B1T05, B1T06, B1T07, B1T08, or B1T09 surface.

The bounded commercial-decision envelope covers:

- pricing reference, pricing version, pricing classification, pricing scope, pricing effective-from, pricing effective-to;
- fee reference, fee version, fee classification, fee scope, fee effective-from, fee effective-to;
- commission reference, commission version, commission classification, commission scope, commission effective-from, commission effective-to;
- revenue-sharing reference, revenue-sharing version, revenue-sharing classification, revenue-sharing scope, revenue-sharing effective-from, revenue-sharing effective-to;
- plan reference, plan version, plan classification, plan scope, plan effective-from, plan effective-to;
- subscription reference, subscription version, subscription classification, subscription scope, subscription start, subscription end, subscription renewal, subscription cancellation;
- customer-tier reference, customer-tier version, customer-tier eligibility, customer-tier limits, customer-tier feature flags;
- merchant-tier reference, merchant-tier version, merchant-tier eligibility, merchant-tier limits, merchant-tier feature flags;
- partner-tier reference, partner-tier version, partner-tier eligibility, partner-tier limits, partner-tier feature flags;
- product-entitlement reference, product-entitlement version, product-entitlement scope, product-entitlement effective-from, product-entitlement effective-to;
- product-package reference, product-package version, product-package composition, product-package effective-from, product-package effective-to;
- bundle reference, bundle version, bundle composition, bundle effective-from, bundle effective-to;
- feature flag reference, feature flag version, feature flag scope, feature flag effective-from, feature flag effective-to;
- dynamic limit reference, dynamic limit version, dynamic limit scope, dynamic limit effective-from, dynamic limit effective-to.

The bounded commercial-decision envelope does not cover:

- billing, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue recognition, tax / VAT, cost accounting, profitability, or commercial analytics (these are covered by B1T05, B1T06, B1T07, B1T08, B1T09 respectively and are out of scope for the first commercial scope's decision envelope).

#### 4.2.2 Bounded commercial-financial-effect envelope

The bounded commercial-financial-effect envelope covers the B1 commercial-financial-effect data that the A7T08 product financial effect consumes through approved read-only consumer boundaries. The envelope is the B1T05 billing, invoice, and statement-generation engine output; the envelope does not post to A5 Ledger; the envelope is the B1T08 revenue-recognition, tax / VAT, and cost-accounting engine output; the envelope does not bypass A5 financial-invariants.

The bounded commercial-financial-effect envelope covers:

- billing reference, billing version, billing classification, billing scope, billing cycle, billing currency, billing accounting unit;
- invoice reference, invoice version, invoice classification, invoice scope, invoice format;
- statement reference, statement version, statement classification, statement scope, statement format;
- revenue-recognition reference, revenue-recognition version, revenue-recognition standard, revenue-recognition scope, revenue-recognition effective-from, revenue-recognition effective-to;
- tax / VAT reference, tax / VAT version, tax / VAT scheme, tax / VAT scope, tax / VAT effective-from, tax / VAT effective-to;
- cost-accounting reference, cost-accounting version, cost-accounting methodology, cost-accounting scope, cost-accounting effective-from, cost-accounting effective-to.

The bounded commercial-financial-effect envelope does not cover:

- commercial-decision engine output (covered by the bounded commercial-decision envelope);
- commercial-incentive engine output (covered by the bounded commercial-incentive envelope);
- commercial-analytics engine output (covered by the bounded commercial-analytics envelope).

#### 4.2.3 Bounded commercial-incentive envelope

The bounded commercial-incentive envelope covers the B1 commercial-incentive data that the A7T05 product command and the A7T06 product notification consume through approved read-only consumer boundaries. The envelope is the B1T06 campaign, promotion, and coupon engine output; the envelope is the B1T07 referral, cashback, and loyalty engine output; the envelope never dispatches a notification; the envelope never posts to A5 Ledger.

The bounded commercial-incentive envelope covers:

- campaign reference, campaign version, campaign classification, campaign scope, campaign effective-from, campaign effective-to;
- promotion reference, promotion version, promotion classification, promotion scope, promotion effective-from, promotion effective-to;
- coupon reference, coupon version, coupon classification, coupon scope, coupon effective-from, coupon effective-to;
- referral reference, referral version, referral classification, referral scope, referral effective-from, referral effective-to;
- cashback reference, cashback version, cashback classification, cashback scope, cashback effective-from, cashback effective-to;
- loyalty reference, loyalty version, loyalty classification, loyalty scope, loyalty effective-from, loyalty effective-to.

The bounded commercial-incentive envelope does not cover:

- commercial-decision engine output (covered by the bounded commercial-decision envelope);
- commercial-financial-effect engine output (covered by the bounded commercial-financial-effect envelope);
- commercial-analytics engine output (covered by the bounded commercial-analytics envelope).

#### 4.2.4 Bounded commercial-analytics envelope

The bounded commercial-analytics envelope covers the B1 commercial-analytics data that the A7T09 product reconciliation and the Operations reconciliation, support, and audit consumers read through approved read-only consumer boundaries. The envelope is the B1T09 commercial-analytics, profitability, and commercial-reconciliation engine output; the envelope never writes source records; the envelope never auto-repairs.

The bounded commercial-analytics envelope covers:

- commercial-analytics reference, commercial-analytics version, commercial-analytics classification, commercial-analytics scope, commercial-analytics effective-from, commercial-analytics effective-to;
- profitability reference, profitability version, profitability classification, profitability scope, profitability effective-from, profitability effective-to;
- commercial-reconciliation reference, commercial-reconciliation version, commercial-reconciliation classification, commercial-reconciliation scope, commercial-reconciliation effective-from, commercial-reconciliation effective-to.

The bounded commercial-analytics envelope does not cover:

- commercial-decision engine output (covered by the bounded commercial-decision envelope);
- commercial-financial-effect engine output (covered by the bounded commercial-financial-effect envelope);
- commercial-incentive engine output (covered by the bounded commercial-incentive envelope).

### 4.3 Commercial candidate matrix

The B1T01 baseline records the following commercial candidate matrix for the first commercial scope `commercial.virtual-account.inbound-funding.v1`. The matrix is the B1T01 selection rationale and is frozen at v1.

| Field | Selected value for the first commercial scope | Rationale |
| --- | --- | --- |
| Commercial-scope key | `commercial.virtual-account.inbound-funding` | Matches the existing A7 first product key `VIRTUAL_ACCOUNT` and direction `inbound funding`; avoids inventing a new product, partner, currency, or capability |
| Commercial-scope version | `1` | First version; frozen; subsequent versions require a separate B1 cycle |
| Direction | inbound funding to provider-backed virtual account | Matches the existing A7 first product direction |
| Capability | `product.virtual-account` (lifecycle action) | Matches the existing A7 first product capability and action |
| Currency | `NGN` | Matches the existing A7 first product currency and the existing A6 partner planning rail |
| Accounting unit | `CUSTOMER_FUNDS` | Matches the existing A7 first product accounting unit and the existing A6 settlement accounting unit |
| Partner dependency | `NIBSS_NIP` (planning rail) | Reuses the existing A6 partner; no new partner; no new credential; no new callback |
| Fee structure | bounded; emitted by B1T04 fee engine | The B1T04 fee engine output is the only B1 fee source; A5 fee state is reused; B1 does not introduce a second fee structure |
| Commission model | bounded; emitted by B1T04 commission engine | The B1T04 commission engine output is the only B1 commission source; B1 does not introduce a second commission model |
| Revenue-sharing rule | bounded; emitted by B1T04 revenue-sharing engine | The B1T04 revenue-sharing engine output is the only B1 revenue-sharing source; B1 does not introduce a second revenue-sharing rule |
| Billing cycle | bounded; emitted by B1T05 billing engine | The B1T05 billing engine output is the only B1 billing source; B1 does not introduce a second billing cycle |
| Invoice format | bounded; emitted by B1T05 invoice engine | The B1T05 invoice engine output is the only B1 invoice source; B1 does not introduce a second invoice format |
| Statement format | bounded; emitted by B1T05 statement-generation engine | The B1T05 statement-generation engine output is the only B1 statement source; B1 does not introduce a second statement format |
| Campaign / promotion / coupon rule | bounded; emitted by B1T06 campaign, promotion, and coupon engine | The B1T06 engine output is the only B1 commercial-incentive source for campaign, promotion, and coupon; B1 does not introduce a second campaign, promotion, or coupon rule |
| Referral / cashback / loyalty rule | bounded; emitted by B1T07 referral, cashback, and loyalty engine | The B1T07 engine output is the only B1 commercial-incentive source for referral, cashback, and loyalty; B1 does not introduce a second referral, cashback, or loyalty rule |
| Revenue-recognition standard | bounded; emitted by B1T08 revenue-recognition engine | The B1T08 revenue-recognition engine output is the only B1 revenue-recognition source; B1 does not introduce a second revenue-recognition standard |
| Tax / VAT scheme | bounded; emitted by B1T08 tax / VAT engine | The B1T08 tax / VAT engine output is the only B1 tax / VAT source; B1 does not introduce a second tax / VAT scheme |
| Cost-accounting methodology | bounded; emitted by B1T08 cost-accounting engine | The B1T08 cost-accounting engine output is the only B1 cost-accounting source; B1 does not introduce a second cost-accounting methodology |
| Profitability model | bounded; emitted by B1T09 profitability engine | The B1T09 profitability engine output is the only B1 profitability source; B1 does not introduce a second profitability model |
| Customer tier | bounded; emitted by B1T03 customer-tier catalog | The B1T03 customer-tier catalog output is the only B1 customer-tier source; B1 does not introduce a second customer tier |
| Merchant tier | bounded; emitted by B1T03 merchant-tier catalog | The B1T03 merchant-tier catalog output is the only B1 merchant-tier source; B1 does not introduce a second merchant tier |
| Partner tier | bounded; emitted by B1T03 partner-tier catalog | The B1T03 partner-tier catalog output is the only B1 partner-tier source; B1 does not introduce a second partner tier |
| Product entitlement | bounded; emitted by B1T03 product-entitlement catalog | The B1T03 product-entitlement catalog output is the only B1 product-entitlement source; B1 does not introduce a second product entitlement |
| Feature flag | bounded; emitted by B1T10 feature flag surface | The B1T10 feature flag surface output is the only B1 feature flag source; A4 remains the only policy authority |
| Dynamic limit | bounded; emitted by B1T10 dynamic-limit surface | The B1T10 dynamic-limit surface output is the only B1 dynamic-limit source; A4 remains the only limit authority |
| Subscription plan | bounded; emitted by B1T03 subscription plan catalog | The B1T03 subscription plan catalog output is the only B1 subscription source; B1 does not introduce a second subscription plan |
| Product package | bounded; emitted by B1T03 product-package catalog | The B1T03 product-package catalog output is the only B1 product-package source; B1 does not introduce a second product package |
| Bundle | bounded; emitted by B1T03 bundle catalog | The B1T03 bundle catalog output is the only B1 bundle source; B1 does not introduce a second bundle |
| Commercial approval | bounded; reused from A2 privileged-action approval surface | The A2 privileged-action approval surface is the only approval authority; B1 reuses A2; B1 does not introduce a second commercial approval |
| Commercial audit | bounded; reused from shared Operations `AuditService` | The shared Operations `AuditService` is the only audit authority; B1 reuses it; B1 does not introduce a second commercial audit |
| Commercial idempotency | bounded; reused from shared Operations `IdempotencyService` | The shared Operations `IdempotencyService` is the only idempotency authority; B1 reuses it; B1 does not introduce a second commercial idempotency |
| Commercial reconciliation | bounded; emitted by B1T09 commercial-reconciliation engine | The B1T09 commercial-reconciliation engine output is the only B1 commercial-reconciliation source; A6T09 and A7T09 are read-only inputs; B1 does not introduce a second commercial reconciliation |
| Commercial data classification | bounded; reused from A6T10 `ExternalDataClassificationRegistry` | The A6T10 `ExternalDataClassificationRegistry` is the only data-classification authority; B1 reuses it; B1 does not introduce a second commercial data classification |
| Commercial release gate | bounded; emitted by B1T11 commercial release gate | The B1T11 commercial release gate is the only B1 commercial release gate; B1T01 records that no B1 commercial release gate is currently in effect; B1T11 will define, implement, test, and gate the B1 commercial release gate before any B1 commercial operation is considered |
| Rollback assumption | B1 disable and rollback procedures stop new B1 commercial activity without rewriting A5, A6, A7, or Ledger history; B1 disable and rollback procedures preserve the existing A7 first product, the existing A6 partner boundary, the existing A5 Ledger, the existing A3 binding, the existing A4 policy, and the existing `CustomerPreference` intent | The B1 disable and rollback procedures will be authored by B1T11 (out of scope for B1T01) |

### 4.4 Prohibited adjacent commercial scopes

The first commercial scope `commercial.virtual-account.inbound-funding.v1` is bounded; the following adjacent commercial scopes are explicitly prohibited for the first commercial scope and require a separate B1 cycle:

- a second commercial scope under the existing A7 first product `VIRTUAL_ACCOUNT` v1 (e.g., `commercial.virtual-account.outbound-settlement` is out of scope for the first commercial scope and requires a separate B1 cycle);
- a commercial scope under any future A7 product (e.g., savings, lending, bills, airtime, QR / merchant, agent-assisted, card, bulk / payroll, FX) — out of scope for the first commercial scope and requires a separate A7 cycle plus a separate B1 cycle;
- a commercial scope under any second commercial partner (other than the already-approved A6 partner `NIBSS_NIP` planning rail) — out of scope for the first commercial scope and requires a separate A6 cycle plus a separate B1 cycle;
- a commercial scope under a second currency (e.g., `KES`, `GHS`, `ZAR`, `USD`, `EUR`, `GBP`) — out of scope for the first commercial scope and requires a separate A1 cycle plus a separate B1 cycle;
- a commercial scope under a second accounting unit (e.g., `MERCHANT_FUNDS`, `PLATFORM_FUNDS`, `ESCROW_FUNDS`) — out of scope for the first commercial scope and requires a separate A5 cycle plus a separate B1 cycle;
- a commercial scope under a public commercial surface, a public commercial API, a mobile commercial channel, a web commercial channel, a marketing-consent surface, or a customer-cohort expansion — out of scope for the first commercial scope and requires a separate B2 cycle;
- a commercial scope under a cross-region rollout or a cross-currency rollout — out of scope for the first commercial scope and requires a separate B2 cycle;
- a commercial scope under a second commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate — out of scope for the first commercial scope and requires a separate B1 cycle plus a separate B1T11 release-gate review.

## 5. Authority and ownership matrix

The B1T01 baseline records the B1 authority and ownership matrix. The matrix is the B1T01 selection rationale and is frozen at v1.

| Authority | Owner | B1 consumption boundary | B1 does not introduce |
| --- | --- | --- | --- |
| A1 canonical ownership, identifier, privacy, retention, legal-hold, cross-cutting | A1 owner | B1 is a read-only consumer of A1 | B1 does not introduce a second canonical-ownership, identifier, privacy, retention, legal-hold, or cross-cutting authority |
| A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, security-event | A2 owner | B1 is a read-only consumer of A2; B1 commercial approvals reuse the A2 privileged-action and step-up approval surface | B1 does not introduce a second authenticated-principal, audience, authorization, privileged-action, protected-ingress, or security-event authority |
| A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, repair/reconciliation | A3 owner | B1 is a read-only consumer of A3; B1 supplies commercial-decision data to A3, not the other way around | B1 does not introduce a second Customer-to-Financial-Account binding, ownership, account-lifecycle, currency, accounting-unit, or repair/reconciliation authority |
| A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, currentness | A4 owner | B1 is a read-only consumer of A4; B1 supplies commercial-decision data to A4, not the other way around; A4 remains the only policy authority | B1 does not introduce a second capability / action policy, limit, obligation, evidence-snapshot, expiry / re-evaluation, or currentness authority |
| A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, independent-reconciliation | A5 owner | B1 is a read-only consumer of A5; B1 supplies commercial-decision data to A5, not the other way around; A5 Ledger is the only financial value authority; A5 transfer / deposit / withdrawal lifecycle is the only internal lifecycle authority | B1 does not introduce a second customer-aware command, correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, or independent-reconciliation authority |
| A6 partner-adapter, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, external-rail data minimization | A6 owner | B1 is a read-only consumer of A6 through the existing A7 product layer; B1 supplies commercial-decision data to A6 through the A6 partner boundary, not the other way around; A6 is the only partner authority | B1 does not introduce a second partner-adapter, partner capability / version, callback, provider-idempotency, settlement, suspense, external-reconciliation, or external-rail data-minimization authority |
| A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization | A7 owner | B1 is a read-only consumer of A7 through the existing A7 read-only consumer boundaries; B1 supplies commercial-decision data to A7, not the other way around; A7 is the only product authority | B1 does not introduce a second product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, or product data-minimization authority |
| `CustomerPreference` (including `NotificationPreference`) customer intent | A1 / A2 / A7 owner | B1 is a read-only consumer of `CustomerPreference`; B1 never redefines the intent; B1 never dispatches a notification directly; B1 commercial notification dispatch is owned by A7T06 through `CustomerPreference` | B1 does not introduce a second customer intent, consent, preference, or notification authority |
| A6T10 `ExternalDataClassificationRegistry`, `ExternalDataMinimizationService`, `ExternalDataControlAuditContext` | A6T10 owner | B1 is a read-only consumer of A6T10 through approved read-only consumer boundaries; B1T10 commercial data classification, commercial data minimization, commercial consent validation, commercial disclosure projection, commercial retention classification, commercial legal-hold, commercial secret handling, commercial support-trace data minimization, and commercial payload validation reuse A6T10 | B1 does not introduce a second data classification, data minimization, data-control audit, consent, disclosure, retention, legal-hold, secret, support-trace, or partner-payload validation authority |
| A6T09 `ExternalReconciliationService` | A6T09 owner | B1 is a read-only consumer of A6T09 through the B1T09 commercial-reconciliation engine read-only consumer boundary | B1 does not introduce a second external-reconciliation authority |
| A7T09 `A7ProductReconciliationService` | A7T09 owner | B1 is a read-only consumer of A7T09 through the B1T09 commercial-reconciliation engine read-only consumer boundary | B1 does not introduce a second product-reconciliation authority |
| A7T08 `A7ProductFinancialEffectService` | A7T08 owner | B1 is a read-only consumer of A7T08 through the A7 product financial-effect read-only consumer boundary; B1 supplies commercial-decision data to A7T08, not the other way around | B1 does not introduce a second product-financial-effect authority |
| A7T06 `A7ProductNotificationDeliveryService` | A7T06 owner | B1 is a read-only consumer of A7T06 through the A7 product notification read-only consumer boundary; B1 never dispatches a notification directly; B1 commercial notification dispatch is owned by A7T06 through `CustomerPreference` | B1 does not introduce a second product-notification-delivery authority |
| Shared Operations `AuditService` | Operations owner | B1 is a read-only consumer of the shared Operations `AuditService`; B1T10 commercial audit reuses the shared Operations `AuditService`; B1 never introduces a second audit authority | B1 does not introduce a second audit authority |
| Shared Operations `IdempotencyService` | Operations owner | B1 is a read-only consumer of the shared Operations `IdempotencyService`; B1T10 commercial idempotency reuses the shared Operations `IdempotencyService`; B1 never introduces a second idempotency authority | B1 does not introduce a second idempotency authority |
| Shared Operations `OutboxService` | Operations owner | B1 is a read-only consumer of the shared Operations `OutboxService`; B1T10 commercial outbox reuses the shared Operations `OutboxService`; B1 never introduces a second outbox authority | B1 does not introduce a second outbox authority |
| Shared Operations `MetricsService` | Operations owner | B1 is a read-only consumer of the shared Operations `MetricsService`; B1T10 commercial metrics reuses the shared Operations `MetricsService`; B1 never introduces a second metrics authority | B1 does not introduce a second metrics authority |
| Shared Operations `DiagnosticsService` | Operations owner | B1 is a read-only consumer of the shared Operations `DiagnosticsService`; B1T10 commercial diagnostics reuses the shared Operations `DiagnosticsService`; B1 never introduces a second diagnostics authority | B1 does not introduce a second diagnostics authority |
| Wallet, Reconciliation, Support | Wallet / Reconciliation / Support owner | B1 is a read-only consumer of Wallet, Reconciliation, and Support | B1 does not introduce a second wallet, reconciliation, or support authority |
| Finance, Tax, Security, Privacy, Legal, Risk, Compliance | Finance / Tax / Security / Privacy / Legal / Risk / Compliance owner | B1 is a read-only consumer of Finance, Tax, Security, Privacy, Legal, Risk, Compliance | B1 does not introduce a second finance, tax, security, privacy, legal, risk, or compliance authority |
| B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, commercial-analytics, commercial-package, commercial-bundle, commercial-approval, commercial-audit, commercial-idempotency, commercial-reconciliation, commercial-classification, commercial-retention, commercial-legal-hold, commercial-secret, commercial-disclosure, commercial-release-gate | B1 commercial owner | B1 is the only authority for B1 commercial decisions; B1T02-B1T10 will define the B1 commercial surface | B1 does not introduce a second B1 commercial authority before B1T11 commercial release gate is approved |

## 6. Existing commercial-adjacent gap register

The B1T01 baseline records the existing commercial-adjacent gap register:

| Gap | Description | Owner | B1T02-B1T11 mitigation |
| --- | --- | --- | --- |
| GAP-B1-001 | No B1 commercial catalog exists; the existing `fee` and `quote` modules are reused by A5 and are not B1 commercial authorities | B1 commercial owner | B1T02 will define the B1 commercial catalog and plan-boundary contract |
| GAP-B1-002 | No B1 pricing catalog exists; the existing `quote` module and `payment-quote` entity are reused by A5 and are not B1 pricing authorities | B1 commercial owner | B1T03 will define the B1 pricing catalog as part of the B1 catalog surface |
| GAP-B1-003 | No B1 fee engine exists; the existing `fee` engine is reused by A5 and is not a B1 fee authority | B1 commercial owner | B1T04 will define the B1 fee engine as a read-only consumer of A5 fee state |
| GAP-B1-004 | No B1 commission engine exists; the existing `fee` engine does not implement the B1 commission model | B1 commercial owner | B1T04 will define the B1 commission engine as a read-only consumer of A5 fee state and A6 partner state |
| GAP-B1-005 | No B1 revenue-sharing engine exists; the existing `fee` engine does not implement the B1 revenue-sharing model | B1 commercial owner | B1T04 will define the B1 revenue-sharing engine as a read-only consumer of A5 fee state and A6 partner state |
| GAP-B1-006 | No B1 billing engine exists; the existing `payment` and `transfer` modules are reused by A5 and are not B1 billing authorities | B1 commercial owner | B1T05 will define the B1 billing engine as a read-only consumer of A5 payment / transfer state |
| GAP-B1-007 | No B1 invoice engine exists; the existing `payment` and `transfer` modules are reused by A5 and are not B1 invoice authorities | B1 commercial owner | B1T05 will define the B1 invoice engine as a read-only consumer of A5 payment / transfer state |
| GAP-B1-008 | No B1 statement-generation engine exists; the existing `payment` and `transfer` modules are reused by A5 and are not B1 statement authorities | B1 commercial owner | B1T05 will define the B1 statement-generation engine as a read-only consumer of A5 payment / transfer state |
| GAP-B1-009 | No B1 campaign engine exists | B1 commercial owner | B1T06 will define the B1 campaign engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-010 | No B1 promotion engine exists | B1 commercial owner | B1T06 will define the B1 promotion engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-011 | No B1 coupon engine exists | B1 commercial owner | B1T06 will define the B1 coupon engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-012 | No B1 referral engine exists | B1 commercial owner | B1T07 will define the B1 referral engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-013 | No B1 cashback engine exists | B1 commercial owner | B1T07 will define the B1 cashback engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-014 | No B1 loyalty engine exists | B1 commercial owner | B1T07 will define the B1 loyalty engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-015 | No B1 revenue-recognition engine exists | B1 commercial owner | B1T08 will define the B1 revenue-recognition engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-016 | No B1 tax / VAT engine exists | B1 commercial owner | B1T08 will define the B1 tax / VAT engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-017 | No B1 cost-accounting engine exists | B1 commercial owner | B1T08 will define the B1 cost-accounting engine as a read-only consumer of A5 / A6 / A7 / `CustomerPreference` state |
| GAP-B1-018 | No B1 commercial-analytics engine exists | B1 commercial owner | B1T09 will define the B1 commercial-analytics engine as a read-only consumer of A5 / A6 / A6T09 / A7 / A7T09 state |
| GAP-B1-019 | No B1 profitability engine exists | B1 commercial owner | B1T09 will define the B1 profitability engine as a read-only consumer of A5 / A6 / A7 state |
| GAP-B1-020 | No B1 commercial-reconciliation engine exists | B1 commercial owner | B1T09 will define the B1 commercial-reconciliation engine as a read-only consumer of A5 / A6 / A6T09 / A7 / A7T09 state |
| GAP-B1-021 | No B1 commercial data classification exists | B1 commercial owner | B1T10 will define the B1 commercial data classification as a read-only consumer of A6T10 `ExternalDataClassificationRegistry` |
| GAP-B1-022 | No B1 commercial data minimization exists | B1 commercial owner | B1T10 will define the B1 commercial data minimization as a read-only consumer of A6T10 `ExternalDataMinimizationService` |
| GAP-B1-023 | No B1 commercial consent validation exists | B1 commercial owner | B1T10 will define the B1 commercial consent validation as a read-only consumer of A6T10 consent authority |
| GAP-B1-024 | No B1 commercial disclosure projection exists | B1 commercial owner | B1T10 will define the B1 commercial disclosure projection as a read-only consumer of A6T10 disclosure projection |
| GAP-B1-025 | No B1 commercial retention classification exists | B1 commercial owner | B1T10 will define the B1 commercial retention classification as a read-only consumer of A6T10 retention classification |
| GAP-B1-026 | No B1 commercial legal-hold exists | B1 commercial owner | B1T10 will define the B1 commercial legal-hold as a read-only consumer of A6T10 legal-hold |
| GAP-B1-027 | No B1 commercial secret handling exists | B1 commercial owner | B1T10 will define the B1 commercial secret handling as a read-only consumer of A6T10 secret classification |
| GAP-B1-028 | No B1 commercial support-trace data minimization exists | B1 commercial owner | B1T10 will define the B1 commercial support-trace data minimization as a read-only consumer of A6T10 support-trace projection |
| GAP-B1-029 | No B1 commercial payload validation exists | B1 commercial owner | B1T10 will define the B1 commercial payload validation as a read-only consumer of A6T10 partner-payload validation |
| GAP-B1-030 | No B1 commercial audit exists | B1 commercial owner | B1T10 will define the B1 commercial audit as a read-only consumer of the shared Operations `AuditService` |
| GAP-B1-031 | No B1 commercial idempotency exists | B1 commercial owner | B1T10 will define the B1 commercial idempotency as a read-only consumer of the shared Operations `IdempotencyService` |
| GAP-B1-032 | No B1 commercial approval exists | B1 commercial owner | B1T10 will define the B1 commercial approval as a read-only consumer of the A2 privileged-action and step-up approval surface |
| GAP-B1-033 | No B1 feature flag surface exists | B1 commercial owner | B1T10 will define the B1 feature flag surface as a read-only consumer boundary for every product |
| GAP-B1-034 | No B1 commercial release gate exists | B1 release owner | B1T11 will define the B1 commercial release gate as the only B1 commercial release gate |
| GAP-B1-035 | No B1 public commercial surface, public commercial API, mobile commercial channel, web commercial channel, marketing-consent surface, or customer-cohort expansion exists | B2 release owner (out of scope for B1) | B2 (out of scope for B1) |
| GAP-B1-036 | No B1 cross-region rollout or cross-currency rollout exists | B2 release owner (out of scope for B1) | B2 (out of scope for B1) |

## 7. Implementation assumptions, exclusions, prohibited edges, rollback, and stop conditions

### 7.1 Implementation assumptions

The B1T01 baseline records the following implementation assumptions, all of which are subject to A1-A7 release-gate review and may be revised by B1T11 evidence:

- B1T01 selects exactly one bounded first commercial scope `commercial.virtual-account.inbound-funding.v1` and freezes it at v1.
- B1 is a read-only consumer of A1-A7; B1 supplies commercial-decision data to A1-A7, not the other way around.
- A1-A7 remain the only authorities in their respective domains; B1 does not introduce a second authority in any domain.
- The A7 first product `VIRTUAL_ACCOUNT` v1 is the only A7 product for which the B1 first commercial scope may emit a commercial-decision; B1T01 does not select a second A7 product.
- The A6 partner `NIBSS_NIP` is the only partner for which the B1 first commercial scope may emit a commercial-decision; B1T01 does not select a second A6 partner.
- The currency `NGN` is the only currency for which the B1 first commercial scope may emit a commercial-decision; B1T01 does not select a second currency.
- The accounting unit `CUSTOMER_FUNDS` is the only accounting unit for which the B1 first commercial scope may emit a commercial-decision; B1T01 does not select a second accounting unit.
- B1T01 does not select a pricing scheme, fee structure, commission model, revenue-sharing rule, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, profitability model, customer tier, merchant tier, partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate; B1T02-B1T10 will define each surface in detail.
- B1T01 does not select a public commercial surface, public commercial API, mobile commercial channel, web commercial channel, marketing-consent surface, customer-cohort expansion, merchant-cohort expansion, partner-cohort expansion, cross-region rollout, or cross-currency rollout; B1T01 records that B2 is the future phase for any of these surfaces.
- B1T01 does not select a B1 commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate authority; B1T01 records that B1T10 will define the B1 commercial data classification, commercial idempotency, commercial audit, commercial approvals, and feature flag surface as a read-only consumer of A6T10, A1, A2, and the shared Operations services, and B1T11 will define the B1 commercial release gate.
- B1T01 does not create or modify any application source, entity, migration, service, controller, API, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, or runtime activation.

### 7.2 Exclusions

The B1T01 baseline records the following exclusions:

- B1 does not implement a pricing scheme, fee structure, commission model, revenue-sharing rule, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, profitability model, customer tier, merchant tier, partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate in B1T01; B1T02-B1T10 will define each surface in detail.
- B1 does not select a second commercial scope, a second commercial partner, a second currency, a second accounting unit, a second customer tier, a second merchant tier, a second partner tier, a second product entitlement, a second feature flag, a second dynamic limit, a second subscription plan, a second product package, a second bundle, a public commercial surface, a public commercial API, a mobile commercial channel, a web commercial channel, a marketing-consent surface, a customer-cohort expansion, a merchant-cohort expansion, a partner-cohort expansion, a cross-region rollout, or a cross-currency rollout in B1T01.
- B1 does not begin B1T02 or any later B1 task in B1T01; B1T01 is a documentation-only baseline.
- B1 does not begin B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation in B1T01; B2 is the future phase.
- B1 does not begin A8 scale / extraction, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation in B1T01; A8 is the future phase after A7.
- B1 does not claim any A1, A2, A3, A4, A5, A6, A7, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, or partner approval in B1T01; B1T01 records that those approvals are prerequisites for B1T02-B1T11 and remain pending until A1-A7 release-gate review is complete.

### 7.3 Prohibited edges

The B1T01 baseline records the following prohibited edges (the B1 prohibited edges are also enumerated in the B1 plan §11; the B1T01 baseline does not enumerate the full list and references the B1 plan §11 for the full list):

- B1 does not treat a commercial event, plan, tier, entitlement, feature flag, dynamic limit, fee, commission, revenue-sharing rule, billing entry, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition entry, tax / VAT entry, cost-accounting entry, profitability report, or commercial analytics report as canonical Customer identity, A2 authorization, A3 binding, A4 policy, A5 Ledger, A6 partner, A7 product, Operations audit, Operations idempotency, Operations outbox, or `CustomerPreference` intent.
- B1 does not select a WalletAccount / LedgerAccount from a customer reference, commercial reference, plan reference, tier reference, entitlement reference, fee reference, commission reference, billing reference, invoice reference, campaign reference, promotion reference, coupon reference, referral reference, cashback reference, loyalty reference, revenue-recognition reference, tax reference, cost-accounting reference, or analytics reference.
- B1 does not post a journal, mutate a balance, clear suspense, or edit a posted journal / line outside Ledger and Finance-approved correction boundaries.
- B1 does not dispatch a notification for a commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, or commercial-analytics event; B1 commercial notification dispatch is owned by A7T06 through the `CustomerPreference` intent authority.
- B1 does not mutate completed A5 transfer, A6 settlement, A6 suspense, A6 journal, A7 product operation, A7 product financial effect, A7 product reconciliation, A7 product data-minimization, or Ledger history for commercial, partner, or notification correction.
- B1 does not invent a second audit, idempotency, outbox, metrics, diagnostics, customer-binding, policy, authorization, notification, settlement, reconciliation, classification, retention, legal-hold, secret, disclosure, support, or `CustomerPreference` authority.
- B1 does not begin B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.

### 7.4 Rollback assumptions

The B1T01 baseline records the following rollback assumptions:

- B1 disable and rollback procedures stop new B1 commercial activity without rewriting A5, A6, A7, or Ledger history.
- B1 disable and rollback procedures preserve the existing A7 first product, the existing A6 partner boundary, the existing A5 Ledger, the existing A3 binding, the existing A4 policy, the existing `CustomerPreference` intent, and the existing Operations audit / idempotency / outbox / metrics / diagnostics.
- B1 disable and rollback procedures preserve the existing commercial-adjacent module surface (`fee`, `quote`, `limit`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, `ledger`, `partner`, `reconciliation`, A7 product surface).
- B1 disable and rollback procedures preserve the existing A1-A7 partner-certification, settlement, suspense, compensating-entry, external-reconciliation, and data-minimization state.
- B1 disable and rollback procedures do not require mutating any source record; B1T01 records that B1 is a read-only consumer of A1-A7 and a read-only consumer of the shared Operations services.
- B1 disable and rollback procedures will be authored by B1T11 (out of scope for B1T01).

### 7.5 Stop conditions

The B1T01 baseline records the following stop conditions:

- B1 release-gate review stops if the first commercial scope is changed without a separate B1 cycle.
- B1 release-gate review stops if any B1 commercial decision is made for a live customer cohort, a live partner cohort, or a live product cohort.
- B1 release-gate review stops if any B1 commercial engine posts a journal, mutates a balance, repairs a binding, changes A4 policy / source records, or dispatches a notification.
- B1 release-gate review stops if any B1 commercial decision bypasses A1, A2, A3, A4, A5, A6, A7, `CustomerPreference`, the shared Operations services, or the A6T10 data-control authorities.
- B1 release-gate review stops if any B1 commercial decision is made for a second commercial scope, a second commercial partner, a second currency, a second accounting unit, a second customer tier, a second merchant tier, a second partner tier, a second product entitlement, a second feature flag, a second dynamic limit, a second subscription plan, a second product package, a second bundle, a public commercial surface, a public commercial API, a mobile commercial channel, a web commercial channel, a marketing-consent surface, a customer-cohort expansion, a merchant-cohort expansion, a partner-cohort expansion, a cross-region rollout, or a cross-currency rollout.
- B1 release-gate review stops if B1 begins B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.
- B1 release-gate review stops if any unresolved B1 implementation risk is unowned or unaddressed.
- B1 release-gate review stops if any B1 prohibited edge is detected.

## 8. Compatibility assessment

The B1T01 baseline records the compatibility assessment for the first bounded commercial-platform capability.

### 8.1 Existing commercial-adjacent module compatibility

The B1T01 baseline classifies the following existing commercial-adjacent modules as compatibility input only:

- existing `fee` module — compatibility input; existing A1-A5 fee surface is reused by A5 and is not a B1 commercial authority; B1 supplies commercial-decision data to A5, not the other way around;
- existing `quote` module — compatibility input; existing A1-A5 quote surface is reused by A5 and is not a B1 commercial authority; B1 supplies commercial-decision data to A5, not the other way around;
- existing `limit` module — compatibility input; existing A4 limit surface is the only limit authority; B1 supplies commercial-decision data to A4, not the other way around;
- existing `customer-preference` module — compatibility input; `CustomerPreference.notifications` is the only customer intent authority; B1 consumes `CustomerPreference` and never redefines the intent;
- existing `customer-beneficiary` module — compatibility input; A3 binding is the only binding authority; B1 supplies commercial-decision data to A3, not the other way around;
- existing `transfer` module — compatibility input; A5 transfer / deposit / withdrawal lifecycle is the only internal lifecycle authority; B1 consumes A5 and never rewrites A5 history;
- existing `payment` module — compatibility input; A5 payment lifecycle is the only internal payment authority; B1 consumes A5 and never rewrites A5 history;
- existing `settlement-account` service — compatibility input; A5 settlement account is the only settlement account authority; B1 consumes A5 and never rewrites A5 history;
- existing `ledger` module — compatibility input; A5 Ledger is the only financial value authority; B1 supplies commercial-decision data to A5, not the other way around; B1 does not post to A5 Ledger;
- existing `partner` module — compatibility input; A6 is the only partner authority; B1 consumes A6 through the existing A7 product layer and never substitutes the A6 partner boundary;
- existing `reconciliation` module — compatibility input; A6T09 external reconciliation and A7T09 product reconciliation are the only reconciliation authorities; B1T09 commercial-reconciliation engine reads from A6T09 and A7T09 and never writes source records;
- existing A7 product surface — compatibility input; A7 is the only product authority; B1 consumes the A7 product layer through the existing A7 read-only consumer boundaries and never substitutes the A7 product boundary.

### 8.2 CustomerPreference compatibility

The B1T01 baseline records that `CustomerPreference.notifications` is the only customer intent authority for any B1 commercial notification dispatch. B1 consumes `CustomerPreference` and never redefines the intent. B1 never dispatches a notification directly; B1 commercial notification dispatch is owned by A7T06 through `CustomerPreference`.

### 8.3 A6 partner / scheme compatibility

The B1T01 baseline records that the A6 partner `NIBSS_NIP` is the only partner for which the B1 first commercial scope may emit a commercial-decision. B1 consumes A6 through the existing A7 product layer and never substitutes the A6 partner boundary. The A6 partner is **not** connected or certified; the A6 phase result is `NOT APPROVED / CONDITIONAL` per [`docs/A7-APPROVAL-PACKAGE.md`](A7-APPROVAL-PACKAGE.md) §3.1.

### 8.4 A7 product compatibility

The B1T01 baseline records that the A7 first product `VIRTUAL_ACCOUNT` v1 is the only A7 product for which the B1 first commercial scope may emit a commercial-decision. B1 consumes the A7 product layer through the existing A7 read-only consumer boundaries and never substitutes the A7 product boundary. The A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8` per [`docs/A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md) §4.

### 8.5 A1-A7 dependency compatibility

The B1T01 baseline records the A1-A7 dependencies as follows:

- A1 — dependency satisfied (A1 implementation committed);
- A2 — dependency satisfied (A2 implementation committed; B1 surface requires A2 audience / authorization approval before B1T02-B1T11 implementation);
- A3 — dependency satisfied (A3 implementation committed; B1 surface requires A3 binding / read / reconciliation approval before B1T02-B1T11 implementation);
- A4 — dependency satisfied (A4 implementation committed; B1 surface requires A4 policy mapping before B1T02-B1T11 implementation; A4 remains the only policy authority);
- A5 — dependency satisfied (A5 implementation committed; B1 surface requires A5 Ledger, account, state, posting, settlement, suspense, compensating-entry, financial-invariants, and financial-correction approval before B1T02-B1T11 implementation);
- A6 — dependency partially satisfied (A6 implementation committed; A6 partner is not connected or certified; A6 phase result is `NOT APPROVED / CONDITIONAL`; B1 surface requires A6 partner capability, callback, settlement, suspense, compensating-entry, external-reconciliation, and data-minimization owner approval before B1T02-B1T11 implementation);
- A7 — dependency partially satisfied (A7 implementation committed; A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; B1 surface requires A7 product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, and product data-minimization owner approval before B1T02-B1T11 implementation);
- Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, and partner — dependency requires review and approval before B1T02-B1T11 implementation.

## 9. Implementation readiness and entry conditions for B1T02

B1T02 may begin only when:

- B1T01 is committed and reviewed.
- The B1 implementation plan is committed (this is now true; [`docs/B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md)).
- The A1, A2, A3, A4, A5, A6, and A7 release-gate evidence packages remain committed and unchanged by B1T01.
- The A1, A2, A3, A4, A5, A6, and A7 phase results remain `Prepared` (A1, A2, A3, A4, A5), `Prepared` (A6 — `NOT APPROVED / CONDITIONAL`), and `Prepared, not approved, not certified, not activated, not handed off to A8` (A7).
- The A6 partner-adapter, callback, settlement, suspense, reconciliation, and data-minimization contracts (A6T02-A6T10) remain committed and unchanged by B1T01.
- The A7 product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, and product data-minimization contracts (A7T02-A7T10) remain committed and unchanged by B1T01.
- The first commercial scope `commercial.virtual-account.inbound-funding.v1` is frozen at v1 and the first commercial scope selection is reviewed and approved by the B1 commercial owner, the A7 product owner, and the A6 partner owner.
- No B1 runtime, entity, migration, repository, service, controller, module, API, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, public surface, test, product, notification, B2, or A8 work is introduced by B1T01.
- B1T02 must still author the first B1 ADR in the proposed B1 ADR range (`ADR-0061`–`ADR-0071`) and must still pass its own acceptance criteria before any B1T03+ implementation begins.
- B1T01 does not authorize B1T02, B1T03, or any later B1 task to bypass the A1-A7 release-gate approvals or the B1 plan §5 non-goals.

B1T01 is a planning artifact. It does not authorize B1T02, B1T03, or any later B1 task to begin runtime work.

## 10. B1T01 validation record

- [x] Existing `fee`, `quote`, `limit`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, `settlement-account`, `ledger`, `partner`, `reconciliation`, and A7 product surface have been reviewed.
- [x] One bounded first commercial scope is selected: `commercial.virtual-account.inbound-funding.v1` (bounded commercial-decision envelope, bounded commercial-financial-effect envelope, bounded commercial-incentive envelope, bounded commercial-analytics envelope) under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail, currency `NGN`, accounting unit `CUSTOMER_FUNDS`.
- [x] The selected first commercial scope's direction, currency, accounting unit, internal commercial-decision owner, partner dependency, data fields, and prohibited adjacent commercial scopes are explicit.
- [x] The existing commercial-adjacent modules (`fee`, `quote`, `limit`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, `settlement-account`, `ledger`, `partner`, `reconciliation`, A7 product surface) are classified as compatibility input, not as evidence of a B1 commercial boundary.
- [x] The existing `CustomerPreference.notifications` is classified as the customer intent authority; B1 will consume, it will not redefine intent.
- [x] A1, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Support, Commercial, and `CustomerPreference` dependencies are mapped.
- [x] The A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts are inherited as the A1 authority boundary; B1 does not duplicate or replace them.
- [x] The A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts are inherited as the A2 authority boundary; B1 does not duplicate or replace them.
- [x] The A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts are inherited as the A3 authority boundary; B1 does not duplicate or replace them.
- [x] The A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, and currentness contracts are inherited as the A4 authority boundary; B1 does not duplicate or replace them.
- [x] The A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns are inherited as the A5 authority boundary; B1 does not duplicate or replace them.
- [x] The A6 partner-adapter, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization contracts are inherited as the A6 authority boundary; B1 does not duplicate or replace them.
- [x] The A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts are inherited as the A7 authority boundary; B1 does not duplicate or replace them.
- [x] The A6T10 `ExternalDataClassificationRegistry`, `ExternalDataMinimizationService`, and `ExternalDataControlAuditContext` are inherited as the A6T10 data-classification, data-minimization, and data-control audit authority boundary; B1 does not duplicate or replace them.
- [x] The A6T09 `ExternalReconciliationService` and the A7T09 `A7ProductReconciliationService` are inherited as the external-reconciliation and product-reconciliation authority boundary; B1 does not duplicate or replace them.
- [x] The shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, and `DiagnosticsService` are inherited as the operations authority boundary; B1 does not duplicate or replace them.
- [x] A1-A7 handoff entry conditions are recorded; B1T01 does not claim any A1, A2, A3, A4, A5, A6, A7, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, or partner approval.
- [x] A6 phase result is `NOT APPROVED / CONDITIONAL`; A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; B1T01 does not claim partner certification, live migration execution, or production activation.
- [x] No application source, entity, migration, repository, service, controller, module, API, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, test, product, notification, public surface, or A8 / B2 work is created by B1T01.
- [x] B1T01 is a planning artifact; it does not authorize B1T02 or any later B1 task to begin runtime work.
- [x] B1T01 does not begin B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.
- [x] B1T01 does not begin A8 scale / extraction, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation.
- [x] No ADR is authored by B1T01; the B1T01 baseline records that B1T02 must still author the first B1 ADR in the proposed B1 ADR range (`ADR-0061`–`ADR-0071`).
- [x] The first commercial scope `commercial.virtual-account.inbound-funding.v1` is frozen at v1 and recorded as the B1T01 selection.

### Evidence limitations

- This baseline reviews committed source, migrations, architecture inventories, A1-A7 release-gate evidence, the A7 release-gate evidence package, the B1 implementation plan, and the existing commercial-adjacent module / service / controller / entity inventory; it does not call a partner, query live provider systems, inspect live customer / bank data, certify NIBSS, or verify settlement availability.
- The A6 partner is **not** connected or certified; A6 phase result is `NOT APPROVED / CONDITIONAL`. The first commercial scope's inbound funding flow depends on the A6 partner, which remains in this state.
- The A7 first product is `Prepared, not approved, not certified, not activated, not handed off to A8`. The first commercial scope depends on the A7 first product, which remains in this state.
- B1T01 does not claim that A1, A2, A3, A4, A5, A6, A7, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, or partner owners have approved the first commercial scope or any B1 surface.
- B1T01 does not author any B1 ADR. The first B1 ADR will be authored by B1T02.
- B1T02-B1T11 must define, implement, test, and gate the B1 commercial catalog, the B1 plan-boundary contract, the B1 pricing / plan / subscription / tier / entitlement / package / bundle catalog, the B1 fee / commission / revenue-sharing engine, the B1 billing / invoice / statement engine, the B1 campaign / promotion / coupon engine, the B1 referral / cashback / loyalty engine, the B1 revenue-recognition / tax / cost-accounting engine, the B1 commercial-analytics / profitability / commercial-reconciliation engine, the B1 commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag surface, and the B1 commercial release gate before any B1 commercial operation is considered.
- B1T01 records the bounded first commercial scope `commercial.virtual-account.inbound-funding.v1` as a planning artifact; B1T01 does not authorize any B1 commercial operation, pricing, fee, commission, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue recognition, tax / VAT, cost accounting, profitability, analytics, customer tier, merchant tier, partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate.
