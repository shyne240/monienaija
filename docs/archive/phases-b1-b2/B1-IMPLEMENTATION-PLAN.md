# B1 Commercial Platform — Implementation Plan

- **Phase:** B1 — Commercial Platform
- **Status:** Planned
- **Scope:** Reusable commercial foundation (commercial catalog and plan boundary, pricing catalog, fee and commission engines, billing and invoice engines, campaign/promotion/coupon engines, referral/cashback/loyalty engines, revenue recognition and tax/VAT/cost accounting, commercial analytics and profitability, commercial reconciliation, commercial data classification and feature flags, commercial audit and idempotency, commercial approvals, commercial release gate, and B2 handoff) consumed by every existing and future A7 product and by every future product
- **Implementation order:** Architecture phase after the completed A1 Foundation Consolidation, A2 Runtime Identity & Access, A3 Customer-to-Financial Account Binding, A4 Capability & Policy Engine, A5 Internal Financial Pilot, A6 External Partners & Settlement, and A7 Product Expansion Infrastructure
- **Number of historical implementation tasks:** 11 (B1T01–B1T11, unchanged)
- **Implemented extension:** B1T12 — B1 Commercial Payment-Term and Invoice Due-Date Extension; ADR-0091 accepted; bounded internal runtime implemented with no production term seeded or activated. Detailed scope: [`B2F07-PREREQUISITE-WORK-PACKAGES.md`](B2F07-PREREQUISITE-WORK-PACKAGES.md).
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`PHASES.md`](PHASES.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md), [`A7-IMPLEMENTATION-PLAN.md`](A7-IMPLEMENTATION-PLAN.md), [`A7-A8-HANDOFF-PACKAGE.md`](A7-A8-HANDOFF-PACKAGE.md), [`A7-INTEGRATION-MATRIX.md`](A7-INTEGRATION-MATRIX.md), [`A7-EXIT-CHECKLIST.md`](A7-EXIT-CHECKLIST.md), [`A6-IMPLEMENTATION-PLAN.md`](A6-IMPLEMENTATION-PLAN.md), [`A5-IMPLEMENTATION-PLAN.md`](A5-IMPLEMENTATION-PLAN.md), [`A4-IMPLEMENTATION-PLAN.md`](A4-IMPLEMENTATION-PLAN.md), [`A3-IMPLEMENTATION-PLAN.md`](A3-IMPLEMENTATION-PLAN.md), [`A2-IMPLEMENTATION-PLAN.md`](A2-IMPLEMENTATION-PLAN.md), [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md)
- **Historical B1 ADR range:** ADR-0061 through ADR-0071 (ADR-0061–ADR-0069 authored for the original scope; ADR-0070/ADR-0071 remain historical reserved slots and are not reassigned by this extension.)
- **Implemented extension ADR:** ADR-0091 → B1T12; accepted and implemented.

This document is a planning artifact only. It creates no application source, entity, migration, service, controller, API, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, or runtime activation.

## 1. Official phase title

**B1 — Commercial Platform**

B1 is an Architecture phase and is not a Product Roadmap milestone. It introduces the shared commercial foundation that every existing and future product will consume after A1-A7 have established the canonical identity, authorization, customer-binding, policy, ledger, external-partner, and product-layer authorities. B1 does not begin B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 product-roadmap expansion beyond the existing A7 first product, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.

B1 must not be treated as permission to issue a fee, commission, charge, invoice, credit, debit, refund, rebate, discount, promotion, coupon, cashback, loyalty, tax, or revenue-recognition event merely because a commercial plan, engine, or contract exists. Plan selection, capability eligibility, A2 audience/authorization, A3 binding, A4 policy, A5 ledger, A6 partner, A7 product, Finance/Ledger, Security, Privacy, Legal, Risk, Compliance, Tax, Audit, Reconciliation, Support, Product, Commercial, and release gates remain explicit phase inputs and exit conditions.

## 2. Phase objective

Introduce the shared commercial foundation so that every existing and future product can consume a single, versioned, governed, read-only commercial surface rather than re-implementing pricing, fees, commissions, billing, invoicing, statements, campaigns, promotions, coupons, referrals, cashback, loyalty, revenue recognition, tax/VAT, cost accounting, profitability, commercial analytics, customer tiers, merchant tiers, partner tiers, product entitlements, feature flags, dynamic limits, subscription plans, product packaging, bundles, commercial approvals, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, or commercial release gates. The commercial foundation must:

- provide one explicit commercial catalog and plan-boundary contract that prevents commercial-specific behavior from becoming a source authority in Customer, Wallet, Ledger, A2, A3, A4, A5, A6, A7, Operations, or Reconciliation;
- extend the A4 capability / profile / limit / eligibility / obligation machinery with a read-only commercial-decision consumer (A4 remains the only policy authority; B1 only supplies the data A4 consumes);
- extend the A3 customer-binding boundary with a read-only commercial-tier / commercial-entitlement / commercial-subscription consumer (A3 remains the only binding authority; B1 only supplies the commercial metadata);
- expose pricing, fee, commission, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue recognition, tax/VAT, cost accounting, profitability, and commercial analytics as read-only consumer services to every product (the A7 product command service, the A7 product financial-effect service, the A7 product reconciliation service, the A7 product data-minimization service, and every future product consume B1);
- introduce a commercial-decision identity distinct from internal command, A6 external operation, A7 product command, A7 product operation, settlement, journal, suspense, audit, outbox, and reconciliation identifiers;
- introduce a commercial-decision data-minimization and data-classification boundary consistent with the A6T10 / A7T10 data-classification matrix and the A1 data classification, retention, and legal-hold controls;
- post only verified commercial-financial effects through the existing A5 Ledger boundary (B1 never creates a new Ledger authority, a new journal authority, a new financial-invariants engine, a new financial-value authority, a new settlement authority, a new suspense authority, or a new compensating-entry authority);
- independently reconcile commercial-decision, commercial-financial-effect, commercial-settlement, commercial-revenue-recognition, commercial-tax, and commercial-cost-accounting evidence read-only without writing source records;
- prove a complete identity-to-customer-binding-to-policy-to-product-command-to-A6-partner-to-settlement-to-Ledger-to-reconciliation-to-commercial-decision-to-commercial-financial-effect-to-commercial-revenue-recognition trace for the existing A7 first product without allowing a commercial event, plan, tier, entitlement, or revenue-recognition entry to replace A1, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, Outbox, or Reconciliation authority.

B1 must not be treated as permission to enable pricing, fees, commissions, billing, invoicing, statements, campaigns, promotions, coupons, referrals, cashback, loyalty, revenue recognition, tax/VAT, cost accounting, profitability, commercial analytics, customer tiers, merchant tiers, partner tiers, product entitlements, feature flags, dynamic limits, subscription plans, product packaging, bundles, commercial approvals, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, or commercial release gates merely because a B1 contract or B1T11 evidence package exists. B1 must not be treated as permission to begin B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.

## 3. B1 boundary and task summaries

### 3.1 Commercial-platform boundary

B1 does not preselect a commercial plan, pricing scheme, fee structure, commission model, revenue-sharing rule, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral program, cashback rule, loyalty program, revenue-recognition standard, tax/VAT scheme, cost-accounting methodology, profitability model, customer tier, merchant tier, partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit policy, commercial idempotency scheme, commercial reconciliation model, commercial data-classification rule, or commercial release gate. B1T01 must select the bounded first commercial scope from the approved candidate set, record the commercial scope, plan key, plan version, capability, customer tier, merchant tier, partner tier, internal commercial-decision owner, partner dependency (where applicable), direction of value, currency, accounting unit, data fields, prohibited adjacent commercial scopes, and the minimum commercial surface, before any B1 implementation proceeds.

The selected first commercial scope must be one of the following bounded shapes, subject to B1T01 evidence and review:

```text
B1 commercial read-only consumer of A5 Ledger, A6 partner, A7 product layer
+ bounded commercial-decision envelope (pricing, fee, commission, plan, tier, entitlement, feature flag, dynamic limit)
+ bounded commercial-financial-effect envelope (billing, invoice, statement, revenue recognition, tax/VAT, cost accounting)
+ bounded commercial-incentive envelope (campaign, promotion, coupon, referral, cashback, loyalty)
+ bounded commercial-analytics envelope (profitability, commercial reconciliation, commercial release gate)
```

B1 must not simultaneously implement cross-region commercial rollout, cross-currency commercial rollout, partner onboarding beyond the already-approved A6 partner, customer onboarding, public commercial API, public commercial channel, or product-roadmap expansion beyond the existing A7 first product. A second commercial scope or a second commercial partner (other than the already-approved A6 partner for the existing A7 first product) requires a separate reviewed capability decision and must not be smuggled into the first commercial scope.

### 3.2 One-line summary of every task

| Task | One-line summary |
| --- | --- |
| **B1T01** | Establish the commercial-platform baseline, select one bounded first commercial scope, and record prohibited edges, risks, certification inputs, and rollback assumptions. |
| **B1T02** | Define the B1 commercial catalog and plan-boundary contract that keep commercial-specific behavior outside canonical authorities. |
| **B1T03** | Define the B1 pricing catalog, plan catalog, subscription plan, customer tier, merchant tier, partner tier, product entitlement, and product packaging / bundle catalog that products consume through read-only consumer boundaries. |
| **B1T04** | Implement the B1 fee engine and commission engine that compute fee, commission, and revenue-sharing decisions through a read-only consumer boundary; the engines never post to Ledger. |
| **B1T05** | Implement the B1 billing engine, invoice engine, and statement-generation engine that produce period-end commercial documents; the engines never post to Ledger and never bypass A5. |
| **B1T06** | Implement the B1 campaign, promotion, and coupon engine that produce commercial-incentive decisions; the engine never posts to Ledger and never dispatches notifications. |
| **B1T07** | Implement the B1 referral, cashback, and loyalty engine that produce commercial-incentive decisions; the engine never posts to Ledger and never dispatches notifications. |
| **B1T08** | Implement the B1 revenue-recognition, tax/VAT, and cost-accounting engine that produce commercial-financial-recognition evidence; the engine never posts to Ledger and never bypasses A5 financial-invariants. |
| **B1T09** | Implement the B1 commercial analytics, profitability, and commercial reconciliation that read from A5, A6, A7, and the B1 commercial-decision envelope; the engine never writes source records and never auto-repairs. |
| **B1T10** | Implement the B1 commercial data classification, commercial idempotency, commercial audit, commercial approvals, and feature flag surface that products consume through read-only consumer boundaries. |
| **B1T11** | Validate the complete B1 commercial-platform foundation, prepare the commercial release gate, and prepare the B2 handoff without beginning B2. |

### 3.3 Commercial-decision boundary

A B1 commercial-decision identity, plan, tier, entitlement, feature flag, dynamic limit, fee, commission, revenue-sharing rule, billing entry, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition entry, tax/VAT entry, cost-accounting entry, profitability report, or commercial analytics report is not financial truth by itself. A successful B1 commercial flow must establish, through the approved contracts:

- one canonical internal customer and account identity chain (A3 + Wallet + Ledger);
- one distinct B1 commercial-decision identity (B1T02) and B1 commercial-financial-effect identity (B1T05 / B1T07 / B1T08);
- one validated A4 policy decision with policy version, evidence, expiry, limits, and obligations (A4 remains the only policy authority; B1 is a read-only commercial-decision consumer);
- one truthful Ledger-owned financial effect only after the approved commercial-financial-evidence is satisfied (A5 Ledger is the only financial value authority; A6T08 settlement / suspense / compensating is the only settlement authority; A7T08 product financial effect is the only product financial effect authority);
- one A6 partner-driven settlement, suspense, or external reconciliation path where the commercial flow depends on the A6 partner;
- one A7 product-driven product command, product operation, product lifecycle, product financial effect, and product reconciliation path where the commercial flow depends on the existing A7 first product; and
- one independent B1 commercial reconciliation trace covering B1 commercial-decision, B1 commercial-financial-effect, A5 Ledger, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A7 product command / product financial effect / product reconciliation, and the shared Operations audit / idempotency / outbox.

A commercial event, plan, tier, entitlement, feature flag, dynamic limit, fee, commission, revenue-sharing rule, billing entry, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition entry, tax/VAT entry, cost-accounting entry, profitability report, or commercial analytics report cannot become a financial source of truth, an A2 authorization, an A3 binding repair, an A4 policy decision, an A5 Ledger record, an A6T08 settlement / suspense / compensating entry, an A6T09 external reconciliation mutation, an A7 product command, an A7 product operation, an A7 product financial effect, an A7 product reconciliation mutation, an A7 product data-minimization mutation, an Operations audit / idempotency / outbox mutation, or a `CustomerPreference` mutation without the owning boundary's verification.

### 3.4 Existing implementation inputs

B1 consumes and must preserve:

- A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts.
- A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts.
- A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts.
- A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, and currentness contracts.
- A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns.
- A6 partner-adapter boundary, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization.
- A7 product catalog / product-boundary contract, product customer-binding, product command / product operation, product notification delivery, product lifecycle, product financial effect, product reconciliation, and product data minimization.
- `CustomerPreference` (including `NotificationPreference`) as the customer intent authority for delivery; B1 consumes `CustomerPreference` and never redefines the intent.
- Operations AuditService, IdempotencyService, OutboxService, MetricsService, DiagnosticsService, request context, readiness, retention, and shutdown primitives.
- Independent Reconciliation, Finance verification, and Tax verification patterns.

Existing commercial, pricing, fee, commission, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, tax, revenue-recognition, cost-accounting, profitability, analytics, customer-tier, merchant-tier, partner-tier, entitlement, feature flag, dynamic limit, subscription, package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, or commercial release gate routes, plans, fees, commissions, tiers, entitlements, or other commercial metadata must not be treated as B1-approved behavior merely because they exist in the repository.

## 4. B1 scope

B1 includes:

- One approved first commercial scope (bounded commercial-decision envelope, bounded commercial-financial-effect envelope, bounded commercial-incentive envelope, bounded commercial-analytics envelope) selected through B1T01.
- A B1 commercial catalog and plan-boundary contract that prevent commercial-specific behavior from becoming a source authority in domain modules.
- A B1 commercial-decision extension that supplies A4 with the read-only commercial-decision data A4 consumes (A4 remains the only policy authority).
- A B1 commercial-decision extension that supplies A3 with the read-only commercial-tier / commercial-entitlement / commercial-subscription data A3 consumes (A3 remains the only binding authority).
- A B1 pricing catalog, plan catalog, subscription plan, customer tier, merchant tier, partner tier, product entitlement, and product packaging / bundle catalog exposed as read-only consumer services to every product.
- A B1 fee engine, commission engine, and revenue-sharing engine exposed as read-only consumer services to every product.
- A B1 billing engine, invoice engine, and statement-generation engine that produce period-end commercial documents; the engines never post to Ledger and never bypass A5.
- A B1 campaign, promotion, and coupon engine that produce commercial-incentive decisions; the engine never posts to Ledger and never dispatches notifications.
- A B1 referral, cashback, and loyalty engine that produce commercial-incentive decisions; the engine never posts to Ledger and never dispatches notifications.
- A B1 revenue-recognition, tax/VAT, and cost-accounting engine that produce commercial-financial-recognition evidence; the engine never posts to Ledger and never bypasses A5 financial-invariants.
- A B1 commercial analytics, profitability, and commercial reconciliation that read from A5, A6, A7, and the B1 commercial-decision envelope; the engine never writes source records and never auto-repairs.
- A B1 commercial data classification, commercial idempotency, commercial audit, commercial approvals, and feature flag surface exposed as read-only consumer services to every product.
- B1 commercial sandbox / certification fixtures, contract tests, fixture-based commercial tests, release evidence, rollback / disable behavior, and B2 handoff boundaries.

## 5. B1 non-goals

B1 does not implement:

- Authentication, sessions, MFA, authorization, route protection, privileged-action issuance, or customer identity; those remain A2 responsibilities.
- Customer-to-financial-account binding, binding repair, account reassignment, account provisioning, or account ownership inference; those remain A3 responsibilities.
- Capability / risk / eligibility / restriction / compliance / limit / obligation precedence or a second policy evaluator; those remain A4 responsibilities.
- Mutation of Customer, CustomerWallet, customer eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding, WalletAccount, or source `CustomerPreference` records to make a commercial event pass.
- Replacement of the A5 internal transfer lifecycle, A6 partner boundary, A7 product layer, Ledger authority, Operations authority, outbox authority, pilot-control boundary, or independent reconciliation authority.
- A second customer wallet balance, settlement ledger, journal authority, suspense truth source, product-reference identity authority, notification intent authority, or reconciliation writer.
- AML, sanctions, fraud, PEP, transaction-monitoring, automated screening, risk scoring, or external compliance decision engines. B1 consumes approved A4 / security / compliance contracts and does not invent their precedence.
- A second pricing catalog, fee engine, commission engine, revenue-sharing engine, billing engine, invoice engine, statement engine, campaign engine, promotion engine, coupon engine, referral engine, cashback engine, loyalty engine, revenue-recognition engine, tax/VAT engine, cost-accounting engine, profitability engine, commercial analytics engine, or commercial reconciliation engine.
- FX, cross-currency conversion, product pricing, fees, commissions, taxes, savings interest, lending, chargebacks, disputes, card schemes, QR / merchant rails, biller aggregators, agent networks, payroll, bulk payments, savings products, credit products, or any other commercial expansion beyond the selected first commercial scope unless a separate approved capability plan explicitly adds one of them.
- Public customer activation, broad rollout, mobile / web channels, customer-portal changes, marketing consent, or general customer onboarding; those remain later product / channel work.
- Unbounded background workers, an unowned broker, a new service-extraction topology, or a commercial-specific scheduler without an approved Operations / runtime boundary.
- Automatic commercial-decision repair, automatic commercial-financial-effect repair, automatic commercial-settlement clearing, automatic commercial-revenue-recognition reversal, automatic commercial-tax correction, automatic commercial-cost-accounting adjustment, in-place commercial-decision mutation, or silent commercial correction.
- A second commercial partner (other than the already-approved A6 partner for the existing A7 first product) or a commercial partner marketplace.
- Production commercial activation, live commercial rollout, regulatory commercial launch, or broad commercial cohort merely because B1 implementation artifacts exist.
- B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.
- Notification or customer-messaging behavior that bypasses the approved `CustomerPreference.notifications` authority or that creates a new customer intent / consent / notification record.
- Wallet, Ledger, Operations, Outbox, Idempotency, Metrics, Diagnostics, Reconciliation, or `CustomerPreference` second authority.

## 6. Governing architectural boundaries

B1 must preserve the following rules from A1-A7 and the financial core:

1. `Customer.id` is the only canonical internal customer identity. Customer references, aliases, case numbers, beneficiary references, funding-instrument IDs, payment references, command IDs, correlation IDs, provider IDs, partner references, product keys, virtual-account identifiers, commercial-decision references, commercial-plan references, commercial-tier references, commercial-entitlement references, commercial-feature-flag references, commercial-fee references, commercial-commission references, commercial-billing references, commercial-invoice references, commercial-statement references, commercial-campaign references, commercial-promotion references, commercial-coupon references, commercial-referral references, commercial-cashback references, commercial-loyalty references, commercial-revenue-recognition references, commercial-tax references, commercial-cost-accounting references, commercial-profitability references, commercial-analytics references, commercial-package references, commercial-bundle references, commercial-approval references, commercial-audit references, commercial-idempotency references, commercial-reconciliation references, commercial-classification references, commercial-release-gate references, and notification identifiers remain distinct values.
2. A2 authenticates and authorizes the initiating principal and protects internal commercial, product, callback, notification, support, and control surfaces. A commercial event, plan value, tier value, entitlement value, fee value, commission value, billing value, invoice value, campaign value, promotion value, coupon value, referral value, cashback value, loyalty value, revenue-recognition value, tax value, cost-accounting value, profitability value, or analytics value cannot grant A2 authorization.
3. A4 owns action-specific capability, risk, restriction, eligibility, compliance, limit, and obligation policy. B1 consumes the current A4 result and must not duplicate or override A4 precedence; B1 is a read-only commercial-decision consumer that supplies A4 with the commercial data A4 consumes.
4. A3 owns the explicit Customer-to-Financial-Account binding. B1 must use verified internal account assertions supplied by A3 and must never choose an account from a customer reference, commercial reference, plan value, tier value, entitlement value, fee value, commission value, billing value, invoice value, campaign value, promotion value, coupon value, referral value, cashback value, loyalty value, revenue-recognition value, tax value, cost-accounting value, profitability value, or analytics value.
5. `CustomerPreference` (including `NotificationPreference`) is the customer intent authority for delivery. B1 consumes the existing `CustomerPreference` and does not invent or replace the intent.
6. `WalletAccount` remains the financial wallet facade, and `Ledger` remains the sole authority for financial accounts, journals, lines, balances, posted value, settlement entries, suspense entries, and compensating entries.
7. External side effects and internal database transactions have different commit boundaries. B1 must represent the gap with durable commercial-decision, commercial-idempotency, commercial-audit, commercial-classification, commercial-reconciliation, or manual-review states.
8. Operations owns audit, idempotency, outbox, metrics, diagnostics, request context, readiness, retention, and operational lifecycle. B1 must reuse those primitives rather than create local substitutes.
9. Reconciliation remains independent and read-only. B1 commercial-decision reports, B1 commercial-financial-effect reports, B1 commercial-revenue-recognition reports, B1 commercial-tax reports, B1 commercial-cost-accounting reports, B1 commercial-profitability reports, B1 commercial-analytics reports, and B1 commercial reconciliation reports cannot repair source records or authorize commercial-financial effects.
10. Commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, commercial-analytics, customer-funding, risk / compliance, financial-control, and notification data are minimized, classified, access-controlled, redacted, and retained only under approved controls.
11. B1 is a bounded commercial-platform boundary inside the existing modular monolith. It does not create a microservice or topology change based only on commercial scope.
12. Every B1 commercial decision, commercial-financial effect, commercial-billing entry, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics entry is scoped to an approved commercial plan and carries an internal correlation chain without treating the commercial reference as canonical internal identity.
13. B1 may use the A5 transactional outbox as a durable internal intent / fact boundary, but no commercial engine, billing engine, campaign engine, promotion engine, coupon engine, referral engine, cashback engine, loyalty engine, revenue-recognition engine, tax engine, cost-accounting engine, profitability engine, or analytics engine may treat an outbox row as a Ledger record, a customer intent, a tax event, or a delivery confirmation.
14. Disabling a commercial plan or a commercial engine stops new commercial decisions and outbound commercial-financial effects without deleting, rewriting, or masking completed internal financial history.
15. A B1 commercial engine, commercial-financial effect, commercial-billing entry, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, or commercial-analytics report never becomes a financial command, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.

## 7. Dependencies and required inputs

### A1 inputs

- Canonical ownership matrix and prohibited shared-writer decisions.
- Customer, funding-instrument, beneficiary, bank, payment, financial, provider-reference, preference, commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, commercial-analytics, and commercial-package-identifier conventions.
- Data classification, retention, legal-hold, minimization, external-sharing, and privacy controls.

### A2 inputs

- Authenticated principal, customer scope, audience, assurance, roles / scopes, authorization decision, and request / correlation / trace / causation context.
- Protected route / service action policy for the selected commercial plan, commercial engine, internal commercial control paths, and public / support / reporting surfaces.
- Privileged approval and step-up requirements for commercial plan configuration, commercial engine configuration, emergency commercial access, commercial settlement exceptions, commercial suspense actions, commercial notification suppression overrides, commercial approval overrides, and commercial recovery where required.

### A3 inputs

- Canonical Customer UUID and explicit internal source / destination account binding references.
- CustomerWallet, WalletAccount, and LedgerAccount IDs and ownership relationships.
- Currency, accounting unit, account type, normal balance, active state, source versions, control state, and reconciliation state.
- Read-only missing, stale, pending, suspended, repair-required, closed, and Ledger-unavailable states.
- No permission for B1 to repair or reassign an internal binding as part of a commercial decision.

### A4 inputs

- Selected commercial capability / action policy decision.
- Policy / profile / version, decision reference, evidence snapshot, normalized input hash, expiry / review, reason codes, obligations, exact limits, and currentness / recovery result.
- A2 authorization-context reference and downstream recheck obligation.
- Explicit policy treatment for commercial counterparties, currencies, limits, tiers, entitlements, feature flags, and lifecycle states.
- B1 is a read-only consumer of A4; A4 may read commercial-decision data from B1 but A4 remains the only policy authority.

### A5 inputs

- Customer-aware command and correlation contract.
- Transfer / deposit / withdrawal / legacy-virtual-account lifecycle and pending / unknown outcome patterns.
- Ledger posting, account locking, journal correlation, settlement-account support, and compensating-entry boundaries.
- Operations idempotency, audit, outbox, metrics, diagnostics, readiness, retention, and request-context primitives.
- Pilot disable / stop-condition / rollback patterns, adapted so a commercial boundary cannot rewrite A5 history.
- Independent internal financial reconciliation evidence.
- B1 is a read-only consumer of A5 Ledger; B1 never posts a journal, never mutates a balance, never clears suspense, and never edits a posted journal / line outside Ledger and Finance-approved correction boundaries.

### A6 inputs

- Partner-adapter boundary, partner capability / version, and selected A6 partner for the existing A7 first product.
- Provider request idempotency, reference uniqueness, callback authenticity, replay protection, and freshness.
- Settlement, suspense, compensating-entry, external reconciliation, and external-rail data minimization.
- Provider credentials, signing keys, callback secrets, and reference model.
- B1 commercial flows that depend on the A6 partner consume the A6 partner boundary through the existing A7 product layer (B1 does not introduce a second A6-partner-style boundary).

### A7 inputs

- A7 product catalog / product-boundary contract (A7T02).
- A7 product customer-binding map (A7T04).
- A7 product command / product operation identity (A7T05).
- A7 product notification delivery (A7T06).
- A7 product lifecycle (A7T07).
- A7 product financial effect (A7T08).
- A7 product reconciliation (A7T09).
- A7 product data minimization (A7T10).
- B1 commercial flows that depend on the existing A7 first product consume the existing A7 product layer through the A7 read-only consumer boundaries (B1 does not introduce a second A7-product-style boundary).

### B1-specific inputs

- `CustomerPreference` (including `NotificationPreference`) as the customer intent authority for delivery; B1 consumes the existing `CustomerPreference` and never redefines the intent.
- A1 ADR-0023 / ADR-0024 identifier, privacy, retention, and external-sharing controls.
- Selected A6 partner sandbox / certification contract (inherited from A6) and the A6 partner enablement state.
- Selected A7 first product (provider-backed virtual account, v1) and the A7 product catalog / product-boundary / product customer-binding / product command / product notification delivery / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts.
- Operations commercial-decision audit, commercial-decision idempotency, commercial-decision outbox, commercial-decision metrics, and commercial-decision diagnostics reuse the shared Operations audit / idempotency / outbox / metrics / diagnostics.

## 8. Sequential task breakdown

### B1T01 — Commercial Platform Baseline and First-Commercial-Scope Selection

- **Type:** Documentation and architecture baseline
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed)

#### Objective

Inventory the current commercial-adjacent surfaces (existing pricing schemes, fees, commissions, billing cycles, invoice formats, statement formats, campaign / promotion / coupon rules, referral / cashback / loyalty programs, revenue-recognition standards, tax / VAT schemes, cost-accounting methodologies, profitability models, customer / merchant / partner tiers, product entitlements, feature flags, dynamic limits, subscription plans, product packages, bundles, commercial approval rules, commercial audit policies, commercial idempotency schemes, commercial reconciliation models, commercial data-classification rules, and commercial release gates) and select one bounded first commercial scope without treating existing commercial metadata, fees, commissions, billing cycles, or invoice formats as B1-approved behavior.

#### Deliverables

- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`.
- Existing commercial-adjacent module and route inventory (pricing, fees, commissions, billing, invoicing, statements, campaigns, promotions, coupons, referrals, cashback, loyalty, revenue recognition, tax / VAT, cost accounting, profitability, analytics, customer tiers, merchant tiers, partner tiers, entitlements, feature flags, dynamic limits, subscriptions, packages, bundles, commercial approvals, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial release gate).
- Commercial candidate matrix covering direction, capability, currency, partner dependency, fee structure, commission model, revenue-sharing rule, billing cycle, invoice format, statement format, campaign / promotion / coupon rule, referral / cashback / loyalty rule, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, profitability model, customer tier, merchant tier, partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial release gate, and rollback assumptions.
- One selected B1 first commercial scope (bounded commercial-decision envelope, bounded commercial-financial-effect envelope, bounded commercial-incentive envelope, bounded commercial-analytics envelope) with explicit internal commercial-decision owner, partner dependency (where applicable), currency, accounting unit, data fields, prohibited adjacent commercial scopes.
- Existing commercial-adjacent gap register, including commercial-decision delivery, commercial-financial-effect delivery, commercial-incentive delivery, public commercial surface, and commercial preference enforcement.
- Commercial-decision identifier, credential, secret, data-sharing, consent, retention, and legal-hold inventory.
- B1 dependency, risk, certification, stop-condition, commercial-rollback, and internal-history-preservation register.
- Compatibility classification for existing commercial-adjacent modules, `CustomerPreference`, A6 partner / scheme metadata, and A7 product metadata.

#### Acceptance criteria

- Exactly one bounded first commercial scope is selected for the implementation critical path, or implementation is blocked pending that selection.
- The selected commercial scope, plan key, plan version, capability, customer tier, merchant tier, partner tier, internal commercial-decision owner, partner dependency, data fields, and prohibited adjacent commercial scopes are explicit.
- Existing commercial-adjacent module metadata is classified as compatibility input, not as evidence of a B1 commercial boundary.
- Existing `CustomerPreference.notifications` is classified as the customer intent authority; B1 will consume, not redefine.
- A1, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Support, Product, Commercial, and partner dependencies are mapped.
- No commercial plan, fee, commission, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition entry, tax / VAT entry, cost-accounting entry, profitability report, analytics report, customer tier, merchant tier, partner tier, entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, or commercial release gate is changed by this task.

#### Dependencies

- A1-A7 completed implementation artifacts.
- A1-A7 handoff packages.
- A1-A7 integration matrices.
- Existing commercial-adjacent inventories.
- A1 identifier, privacy, retention, and external-sharing inputs.

#### Explicitly out of scope

- Activating a commercial plan, pricing scheme, fee structure, commission model, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, profitability model, customer / merchant / partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, or commercial release gate.
- A second commercial scope or a second commercial partner (other than the already-approved A6 partner for the existing A7 first product).
- A public commercial API, a public commercial channel, marketing consent, or a customer-cohort expansion.
- Dispatching a notification for a commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, or commercial-analytics event.
- Beginning any B1T02-B1T11 implementation.

### B1T02 — B1 Commercial Catalog and Plan-Boundary Contract

- **Type:** Documentation and runtime contract design
- **ADR:** ADR-0061 — Commercial Plan Boundary (proposed)

#### Objective

Define the B1 commercial catalog, the B1 plan-boundary contract, and the B1 commercial-extension points that keep commercial-specific behavior outside Customer, Wallet, Ledger, A2, A3, A4, A5, A6, A7, Operations, and Reconciliation authorities. Apply the boundary to the first selected commercial scope.

#### Deliverables

- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`.
- B1 commercial catalog with a single frozen registration for the first commercial scope and an extension contract for future commercial scopes.
- Commercial boundary interface and normalized commercial-decision request / result / audit types.
- Commercial capability / version, plan version, plan key, accounting unit, currency, customer tier, merchant tier, partner tier, and internal commercial-decision owner contract.
- Internal commercial-decision consumer contract (Operations, A2, A4, A6 partner, A7 product, and reporting) without changing their authorities.
- Commercial sandbox / fixture contract and commercial-independent catalog tests.
- Explicit boundary for commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics.

#### Acceptance criteria

- Domain modules consume an explicit B1 commercial catalog and plan-boundary contract rather than reaching into commercial-adjacent, product, wallet, ledger, partner, or reconciliation modules directly.
- B1 commercial requests carry an internal correlation chain and a distinct B1 commercial-decision identity.
- Commercial fields are schema-validated, bounded, classified, and mapped without using a commercial reference, plan reference, tier reference, entitlement reference, fee reference, commission reference, billing reference, invoice reference, campaign reference, promotion reference, coupon reference, referral reference, cashback reference, loyalty reference, revenue-recognition reference, tax reference, cost-accounting reference, or analytics reference as Customer, Wallet, Ledger, command, or journal identity.
- Unsupported commercial capabilities, malformed commercial responses, wrong commercial plan versions, and unavailable commercial flows fail closed or enter a declared recovery state.
- Commercial catalog tests use deterministic fixtures and do not require live partner or live product calls to prove the catalog contract.
- The contract does not post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.

#### Dependencies

- B1T01.
- A1 canonical ownership and identifier contracts.
- A2 protected service and secret boundary.
- A3 account-binding and ownership contract.
- A4 capability / action and currentness contract.
- A5 command / correlation, Operations, outbox, recovery, and reconciliation contracts.
- A6 partner-adapter, callback, settlement, suspense, and external-reconciliation contracts.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0047, ADR-0054.

#### Explicitly out of scope

- Activating a commercial plan, pricing scheme, fee structure, commission model, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, profitability model, customer / merchant / partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, or commercial release gate.
- A second commercial scope or a second commercial partner (other than the already-approved A6 partner for the existing A7 first product).
- A public commercial API, a public commercial channel, marketing consent, or a customer-cohort expansion.
- Beginning any B1T03-B1T11 implementation.

### B1T03 — B1 Pricing Catalog, Plan Catalog, Subscription Plan, Customer Tier, Merchant Tier, Partner Tier, Product Entitlement, Product Packaging, and Bundle Catalog

- **Type:** Runtime catalog and persistence contract implementation
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed); ADR-0062 — Commercial Catalog Persistence (proposed)

#### Objective

Define the B1 pricing catalog, plan catalog, subscription plan, customer tier, merchant tier, partner tier, product entitlement, and product packaging / bundle catalog exposed to every product through read-only consumer boundaries. The B1 catalogs are the only commercial-decision data source; A4, A7, and every future product consume the B1 catalogs through approved read-only consumer boundaries.

#### Deliverables

- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (extends B1T02 contract; documents the B1 catalog surface, the catalog-versioning contract, and the read-only consumer boundary).
- Pricing catalog: base price list, price-list version, currency, accounting unit, partner / customer / merchant / product / plan scope, effective-from / effective-to, and price-classification metadata.
- Plan catalog: plan key, plan version, customer tier eligibility, merchant tier eligibility, partner tier eligibility, product eligibility, capability eligibility, plan limits, plan entitlements, plan feature flags, plan dynamic limits, plan onboarding rules, plan offboarding rules, and plan classification metadata.
- Subscription plan: subscription key, subscription version, billing cycle, billing currency, billing accounting unit, plan reference, customer reference, start / end / renewal / cancellation states, and subscription classification metadata.
- Customer tier: tier key, tier version, eligibility rules, dynamic limits, feature flags, and tier classification metadata.
- Merchant tier: tier key, tier version, eligibility rules, dynamic limits, feature flags, and tier classification metadata.
- Partner tier: tier key, tier version, eligibility rules, dynamic limits, feature flags, and tier classification metadata.
- Product entitlement: entitlement key, entitlement version, product reference, plan reference, tier reference, capability reference, scope reference, and entitlement classification metadata.
- Product packaging / bundle: package key, package version, plan references, entitlement references, price references, effective-from / effective-to, and package classification metadata.
- Commercial catalog persistence migration where durable records are required.
- Operations audit, idempotency, outbox, metrics, diagnostics, and support-trace integration for commercial-catalog events.
- Identity, replay, conflict, uniqueness, migration, and no-financial-side-effect tests.

#### Acceptance criteria

- `Customer.id`, internal command ID, A5 transfer / deposit / withdrawal ID, A6 external-operation ID, A7 product command ID, A7 product operation ID, B1 commercial-decision ID, B1 commercial-financial-effect ID, B1 commercial-billing ID, B1 commercial-invoice ID, B1 commercial-statement ID, B1 commercial-campaign ID, B1 commercial-promotion ID, B1 commercial-coupon ID, B1 commercial-referral ID, B1 commercial-cashback ID, B1 commercial-loyalty ID, B1 commercial-revenue-recognition ID, B1 commercial-tax ID, B1 commercial-cost-accounting ID, B1 commercial-profitability ID, B1 commercial-analytics ID, A6 provider idempotency key, A6 provider transaction / reference ID, A6 callback event ID, A5 journal ID, suspense ID, settlement ID, audit event ID, outbox event ID, and notification dispatch ID remain distinct.
- The normalized commercial-decision request hash includes every field that changes the commercial-decision effect and excludes transport-only values and secrets.
- A duplicate commercial-decision request returns the durable original commercial-decision outcome or a controlled pending state without a second uncontrolled commercial-decision effect.
- A changed payload under the same commercial-decision idempotency scope is rejected without commercial-decision mutation.
- A commercial-decision reference for a commercial flow is accepted only with the expected plan, customer tier, merchant tier, partner tier, product, capability, currency, accounting unit, and lifecycle state context.
- A commercial-decision response or reference cannot by itself complete a Transfer, Deposit, Withdrawal, Ledger journal, A6T08 settlement, A7 product financial effect, A7 product command, A7 product operation, or B1 commercial-financial effect.
- Expired commercial-decision idempotency retention never reuses an old commercial-decision operation, B1 reference, or commercial-decision identity.
- The B1 catalogs do not post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.

#### Dependencies

- B1T01, B1T02.
- A5 command / correlation, Operations, outbox, recovery, and reconciliation contracts.
- A6 partner-adapter, callback, settlement, suspense, and external-reconciliation contracts.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, and request-context primitives.
- ADR-0003, ADR-0008, ADR-0023, ADR-0024, ADR-0044, ADR-0049, ADR-0054.

#### Explicitly out of scope

- Activating a commercial plan, pricing scheme, fee structure, commission model, billing cycle, invoice format, statement format, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition standard, tax / VAT scheme, cost-accounting methodology, profitability model, customer / merchant / partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, or commercial release gate.
- Implementing the B1T04 fee / commission engine, the B1T05 billing / invoice / statement engine, the B1T06 campaign / promotion / coupon engine, the B1T07 referral / cashback / loyalty engine, the B1T08 revenue-recognition / tax / cost-accounting engine, the B1T09 commercial analytics / profitability / commercial reconciliation engine, the B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, or the B1T11 commercial release gate.

### B1T04 — B1 Fee Engine and Commission Engine (Revenue Sharing)

- **Type:** Runtime commercial-decision engine implementation
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed); ADR-0063 — Commercial Fee and Commission Engine (proposed)

#### Objective

Implement the B1 fee engine and commission engine that compute fee, commission, and revenue-sharing decisions for a commercial flow. The B1 fee engine and commission engine are the only B1 commercial-decision engines for fee, commission, and revenue-sharing; the engines consume the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries; the engines never post to Ledger and never bypass A5.

#### Deliverables

- `docs/B1-FEE-ENGINE-CONTRACT.md`.
- Fee engine: fee request / result / audit types; fee engine consumes the B1 pricing catalog (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; fee engine emits commercial-decision events through the shared Operations `OutboxService` and records commercial-decision facts through the shared Operations `AuditService`.
- Commission engine: commission request / result / audit types; commission engine consumes the B1 pricing catalog (B1T03), the B1 partner-tier catalog (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; commission engine emits commercial-decision events through the shared Operations `OutboxService` and records commercial-decision facts through the shared Operations `AuditService`.
- Revenue-sharing engine: revenue-sharing request / result / audit types; revenue-sharing engine consumes the B1 pricing catalog (B1T03), the B1 partner-tier catalog (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; revenue-sharing engine emits commercial-decision events through the shared Operations `OutboxService` and records commercial-decision facts through the shared Operations `AuditService`.
- Fee, commission, and revenue-sharing engine read-only consumer boundaries to A4, A5, A6, A7, and the shared Operations `IdempotencyService`.
- Fee, commission, and revenue-sharing replay-safe, conflict-safe, and uniqueness tests.
- Fee, commission, and revenue-sharing fixture-based tests; no live partner or live product call is required.

#### Acceptance criteria

- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine are the only B1 commercial-decision engines for fee, commission, and revenue-sharing.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine consume the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine emit commercial-decision events through the shared Operations `OutboxService` and record commercial-decision facts through the shared Operations `AuditService` (the shared `OutboxService` and the shared `AuditService` are the only outbox and audit authorities).
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 fee engine, the B1 commission engine, and the B1 revenue-sharing engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

#### Dependencies

- B1T01, B1T02, B1T03.
- A4 capability / policy / limit / obligation / currentness / re-evaluation contract.
- A3 binding / ownership / recheck contract.
- A5 Ledger / account / state / posting / financial-invariants contract.
- A6 partner / callback / settlement / suspense / compensating / external-reconciliation contract.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contract.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, and request-context primitives.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0044, ADR-0047, ADR-0049, ADR-0050, ADR-0052, ADR-0053, ADR-0054.

#### Explicitly out of scope

- Activating a fee, commission, or revenue-sharing decision for a live customer cohort, a live partner cohort, or a live product cohort.
- Posting a fee, commission, or revenue-sharing decision to the A5 Ledger.
- Implementing the B1T05 billing / invoice / statement engine, the B1T06 campaign / promotion / coupon engine, the B1T07 referral / cashback / loyalty engine, the B1T08 revenue-recognition / tax / cost-accounting engine, the B1T09 commercial analytics / profitability / commercial reconciliation engine, the B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, or the B1T11 commercial release gate.

### B1T05 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine

- **Type:** Runtime commercial-financial-effect engine implementation
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed); ADR-0064 — Commercial Billing and Invoice Engine (proposed)

#### Objective

Implement the B1 billing engine, invoice engine, and statement-generation engine that produce period-end commercial documents (billing entries, invoices, statements). The B1 billing, invoice, and statement engines are the only B1 commercial-financial-effect engines for billing, invoicing, and statement generation; the engines consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries; the engines never post to Ledger and never bypass A5; the engines never dispatch notifications.

#### Deliverables

- `docs/B1-BILLING-ENGINE-CONTRACT.md`.
- Billing engine: billing request / result / audit types; billing engine consumes the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; billing engine emits commercial-financial-effect events through the shared Operations `OutboxService` and records commercial-financial-effect facts through the shared Operations `AuditService`.
- Invoice engine: invoice request / result / audit types; invoice engine consumes the B1 catalogs (B1T03), the B1 billing engine output, the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; invoice engine emits commercial-financial-effect events through the shared Operations `OutboxService` and records commercial-financial-effect facts through the shared Operations `AuditService`.
- Statement-generation engine: statement request / result / audit types; statement-generation engine consumes the B1 catalogs (B1T03), the B1 billing engine output, the B1 invoice engine output, the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; statement-generation engine emits commercial-financial-effect events through the shared Operations `OutboxService` and records commercial-financial-effect facts through the shared Operations `AuditService`.
- Billing, invoice, and statement engine read-only consumer boundaries to A4, A5, A6, A7, and the shared Operations `IdempotencyService`.
- Billing, invoice, and statement engine replay-safe, conflict-safe, uniqueness, no-financial-side-effect, and no-notification-dispatch tests.
- Billing, invoice, and statement fixture-based tests; no live partner or live product call is required.

#### Acceptance criteria

- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are the only B1 commercial-financial-effect engines for billing, invoicing, and statement generation.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine emit commercial-financial-effect events through the shared Operations `OutboxService` and record commercial-financial-effect facts through the shared Operations `AuditService`.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 billing engine, the B1 invoice engine, and the B1 statement-generation engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

#### Dependencies

- B1T01, B1T02, B1T03, B1T04.
- A4 capability / policy / limit / obligation / currentness / re-evaluation contract.
- A3 binding / ownership / recheck contract.
- A5 Ledger / account / state / posting / financial-invariants contract.
- A6 partner / callback / settlement / suspense / compensating / external-reconciliation contract.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contract.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, and request-context primitives.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0044, ADR-0047, ADR-0049, ADR-0050, ADR-0052, ADR-0053, ADR-0054.

#### Explicitly out of scope

- Activating a billing entry, invoice, or statement for a live customer cohort, a live partner cohort, or a live product cohort.
- Posting a billing entry, invoice, or statement to the A5 Ledger.
- Dispatching a notification for a billing entry, invoice, or statement.
- Implementing the B1T06 campaign / promotion / coupon engine, the B1T07 referral / cashback / loyalty engine, the B1T08 revenue-recognition / tax / cost-accounting engine, the B1T09 commercial analytics / profitability / commercial reconciliation engine, the B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, or the B1T11 commercial release gate.

### B1T06 — B1 Campaign, Promotion, and Coupon Engine

- **Type:** Runtime commercial-incentive engine implementation
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed); ADR-0065 — Commercial Campaign, Promotion, and Coupon Engine (proposed)

#### Objective

Implement the B1 campaign engine, promotion engine, and coupon engine that produce commercial-incentive decisions. The B1 campaign, promotion, and coupon engines are the only B1 commercial-incentive engines for campaigns, promotions, and coupons; the engines consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries; the engines never post to Ledger and never dispatch notifications.

#### Deliverables

- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md`.
- Campaign engine: campaign request / result / audit types; campaign engine consumes the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; campaign engine emits commercial-incentive events through the shared Operations `OutboxService` and records commercial-incentive facts through the shared Operations `AuditService`.
- Promotion engine: promotion request / result / audit types; promotion engine consumes the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; promotion engine emits commercial-incentive events through the shared Operations `OutboxService` and records commercial-incentive facts through the shared Operations `AuditService`.
- Coupon engine: coupon request / result / audit types; coupon engine consumes the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; coupon engine emits commercial-incentive events through the shared Operations `OutboxService` and records commercial-incentive facts through the shared Operations `AuditService`.
- Campaign, promotion, and coupon engine read-only consumer boundaries to A4, A5, A6, A7, and the shared Operations `IdempotencyService`.
- Campaign, promotion, and coupon engine replay-safe, conflict-safe, uniqueness, no-financial-side-effect, and no-notification-dispatch tests.
- Campaign, promotion, and coupon fixture-based tests; no live partner or live product call is required.

#### Acceptance criteria

- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are the only B1 commercial-incentive engines for campaigns, promotions, and coupons.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine consume the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine emit commercial-incentive events through the shared Operations `OutboxService` and record commercial-incentive facts through the shared Operations `AuditService`.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 campaign engine, the B1 promotion engine, and the B1 coupon engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

#### Dependencies

- B1T01, B1T02, B1T03, B1T04, B1T05.
- A4 capability / policy / limit / obligation / currentness / re-evaluation contract.
- A3 binding / ownership / recheck contract.
- A5 Ledger / account / state / posting / financial-invariants contract.
- A6 partner / callback / settlement / suspense / compensating / external-reconciliation contract.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contract.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, and request-context primitives.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0044, ADR-0047, ADR-0049, ADR-0050, ADR-0052, ADR-0053, ADR-0054.

#### Explicitly out of scope

- Activating a campaign, promotion, or coupon for a live customer cohort, a live partner cohort, or a live product cohort.
- Posting a campaign, promotion, or coupon to the A5 Ledger.
- Dispatching a notification for a campaign, promotion, or coupon.
- Implementing the B1T07 referral / cashback / loyalty engine, the B1T08 revenue-recognition / tax / cost-accounting engine, the B1T09 commercial analytics / profitability / commercial reconciliation engine, the B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, or the B1T11 commercial release gate.

### B1T07 — B1 Referral, Cashback, and Loyalty Engine

- **Type:** Runtime commercial-incentive engine implementation
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed); ADR-0066 — Commercial Referral, Cashback, and Loyalty Engine (proposed)

#### Objective

Implement the B1 referral engine, cashback engine, and loyalty engine that produce commercial-incentive decisions. The B1 referral, cashback, and loyalty engines are the only B1 commercial-incentive engines for referrals, cashback, and loyalty; the engines consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries; the engines never post to Ledger and never dispatch notifications.

#### Deliverables

- `docs/B1-REFERRAL-ENGINE-CONTRACT.md`.
- Referral engine: referral request / result / audit types; referral engine consumes the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; referral engine emits commercial-incentive events through the shared Operations `OutboxService` and records commercial-incentive facts through the shared Operations `AuditService`.
- Cashback engine: cashback request / result / audit types; cashback engine consumes the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; cashback engine emits commercial-incentive events through the shared Operations `OutboxService` and records commercial-incentive facts through the shared Operations `AuditService`.
- Loyalty engine: loyalty request / result / audit types; loyalty engine consumes the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; loyalty engine emits commercial-incentive events through the shared Operations `OutboxService` and records commercial-incentive facts through the shared Operations `AuditService`.
- Referral, cashback, and loyalty engine read-only consumer boundaries to A4, A5, A6, A7, and the shared Operations `IdempotencyService`.
- Referral, cashback, and loyalty engine replay-safe, conflict-safe, uniqueness, no-financial-side-effect, and no-notification-dispatch tests.
- Referral, cashback, and loyalty fixture-based tests; no live partner or live product call is required.

#### Acceptance criteria

- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are the only B1 commercial-incentive engines for referrals, cashback, and loyalty.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine consume the B1 catalogs (B1T03), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine emit commercial-incentive events through the shared Operations `OutboxService` and record commercial-incentive facts through the shared Operations `AuditService`.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 referral engine, the B1 cashback engine, and the B1 loyalty engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

#### Dependencies

- B1T01, B1T02, B1T03, B1T04, B1T05, B1T06.
- A4 capability / policy / limit / obligation / currentness / re-evaluation contract.
- A3 binding / ownership / recheck contract.
- A5 Ledger / account / state / posting / financial-invariants contract.
- A6 partner / callback / settlement / suspense / compensating / external-reconciliation contract.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contract.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, and request-context primitives.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0044, ADR-0047, ADR-0049, ADR-0050, ADR-0052, ADR-0053, ADR-0054.

#### Explicitly out of scope

- Activating a referral reward, cashback, or loyalty point for a live customer cohort, a live partner cohort, or a live product cohort.
- Posting a referral reward, cashback, or loyalty point to the A5 Ledger.
- Dispatching a notification for a referral reward, cashback, or loyalty point.
- Implementing the B1T08 revenue-recognition / tax / cost-accounting engine, the B1T09 commercial analytics / profitability / commercial reconciliation engine, the B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, or the B1T11 commercial release gate.

### B1T08 — B1 Revenue-Recognition, Tax / VAT, and Cost-Accounting Engine

- **Type:** Runtime commercial-financial-recognition engine implementation
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed); ADR-0067 — Commercial Revenue Recognition, Tax / VAT, and Cost Accounting (proposed)

#### Objective

Implement the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine that produce commercial-financial-recognition evidence. The B1 revenue-recognition, tax / VAT, and cost-accounting engines are the only B1 commercial-financial-recognition engines for revenue recognition, tax / VAT, and cost accounting; the engines consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries; the engines never post to Ledger and never bypass A5 financial-invariants; the engines never dispatch notifications.

#### Deliverables

- `docs/B1-REVENUE-RECOGNITION-CONTRACT.md`.
- Revenue-recognition engine: revenue-recognition request / result / audit types; revenue-recognition engine consumes the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; revenue-recognition engine emits commercial-financial-recognition events through the shared Operations `OutboxService` and records commercial-financial-recognition facts through the shared Operations `AuditService`.
- Tax / VAT engine: tax / VAT request / result / audit types; tax / VAT engine consumes the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; tax / VAT engine emits commercial-financial-recognition events through the shared Operations `OutboxService` and records commercial-financial-recognition facts through the shared Operations `AuditService`.
- Cost-accounting engine: cost-accounting request / result / audit types; cost-accounting engine consumes the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; cost-accounting engine emits commercial-financial-recognition events through the shared Operations `OutboxService` and records commercial-financial-recognition facts through the shared Operations `AuditService`.
- Revenue-recognition, tax / VAT, and cost-accounting engine read-only consumer boundaries to A4, A5, A6, A7, and the shared Operations `IdempotencyService`.
- Revenue-recognition, tax / VAT, and cost-accounting engine replay-safe, conflict-safe, uniqueness, no-financial-side-effect, and no-notification-dispatch tests.
- Revenue-recognition, tax / VAT, and cost-accounting fixture-based tests; no live partner or live product call is required.

#### Acceptance criteria

- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are the only B1 commercial-financial-recognition engines for revenue recognition, tax / VAT, and cost accounting.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state through approved read-only consumer boundaries.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine emit commercial-financial-recognition events through the shared Operations `OutboxService` and record commercial-financial-recognition facts through the shared Operations `AuditService`.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 engines never override A4.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 engines never post to Ledger and never bypass A5 financial-invariants.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 engines never substitute the A6 partner boundary.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 engines never substitute the A7 product boundary.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine are idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`.
- The B1 revenue-recognition engine, the B1 tax / VAT engine, and the B1 cost-accounting engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

#### Dependencies

- B1T01, B1T02, B1T03, B1T04, B1T05, B1T06, B1T07.
- A4 capability / policy / limit / obligation / currentness / re-evaluation contract.
- A3 binding / ownership / recheck contract.
- A5 Ledger / account / state / posting / financial-invariants contract.
- A6 partner / callback / settlement / suspense / compensating / external-reconciliation contract.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contract.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, and request-context primitives.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0044, ADR-0047, ADR-0049, ADR-0050, ADR-0052, ADR-0053, ADR-0054.

#### Explicitly out of scope

- Activating a revenue-recognition entry, tax / VAT entry, or cost-accounting entry for a live customer cohort, a live partner cohort, or a live product cohort.
- Posting a revenue-recognition entry, tax / VAT entry, or cost-accounting entry to the A5 Ledger.
- Dispatching a notification for a revenue-recognition entry, tax / VAT entry, or cost-accounting entry.
- Implementing the B1T09 commercial analytics / profitability / commercial reconciliation engine, the B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, or the B1T11 commercial release gate.

### B1T09 — B1 Commercial Analytics, Profitability, and Commercial Reconciliation

- **Type:** Runtime read-only commercial-analytics and reconciliation engine implementation
- **ADR input:** ADR-0061 — Commercial Plan Boundary (proposed); ADR-0068 — Commercial Analytics, Profitability, and Commercial Reconciliation (proposed)

#### Objective

Implement the B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine that read from the A5 Ledger, the A6 partner, the A7 product, and the B1 commercial-decision envelope. The B1 commercial-analytics, profitability, and commercial-reconciliation engines are the only B1 commercial-analytics engines; the engines never write source records and never auto-repair; the engines run in a REPEATABLE READ, read-only TypeORM transaction.

#### Deliverables

- `docs/B1-COMMERCIAL-ANALYTICS-CONTRACT.md`.
- Commercial-analytics engine: commercial-analytics request / result / audit types; commercial-analytics engine consumes the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the B1 campaign / promotion / coupon decisions (B1T06), the B1 referral / cashback / loyalty decisions (B1T07), the B1 revenue-recognition / tax / VAT / cost-accounting outputs (B1T08), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; commercial-analytics engine runs in a REPEATABLE READ, read-only TypeORM transaction.
- Profitability engine: profitability request / result / audit types; profitability engine consumes the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the B1 revenue-recognition / tax / VAT / cost-accounting outputs (B1T08), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, and the A7 product state; profitability engine runs in a REPEATABLE READ, read-only TypeORM transaction.
- Commercial-reconciliation engine: commercial-reconciliation request / result / audit types; commercial-reconciliation engine consumes the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the B1 campaign / promotion / coupon decisions (B1T06), the B1 referral / cashback / loyalty decisions (B1T07), the B1 revenue-recognition / tax / VAT / cost-accounting outputs (B1T08), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, the A6T09 external reconciliation snapshot, and the A7 product state; commercial-reconciliation engine runs in a REPEATABLE READ, read-only TypeORM transaction.
- Commercial-analytics, profitability, and commercial-reconciliation engine read-only consumer boundaries to A4, A5, A6, A6T09, A7, and the shared Operations `IdempotencyService`.
- Commercial-analytics, profitability, and commercial-reconciliation replay-safe, conflict-safe, no-source-mutation, no-auto-repair, and read-only tests.
- Commercial-analytics, profitability, and commercial-reconciliation fixture-based tests; no live partner or live product call is required.

#### Acceptance criteria

- The B1 commercial-analytics engine, the B1 profitability engine, and the B1 commercial-reconciliation engine are the only B1 commercial-analytics engines; the engines never write source records and never auto-repair.
- The B1 commercial-analytics engine, the B1 profitability engine, and the B1 commercial-reconciliation engine run in a REPEATABLE READ, read-only TypeORM transaction; the engines never take any write lock.
- The B1 commercial-analytics engine, the B1 profitability engine, and the B1 commercial-reconciliation engine consume the B1 catalogs (B1T03), the B1 fee / commission decisions (B1T04), the B1 billing / invoice / statement outputs (B1T05), the B1 campaign / promotion / coupon decisions (B1T06), the B1 referral / cashback / loyalty decisions (B1T07), the B1 revenue-recognition / tax / VAT / cost-accounting outputs (B1T08), the A4 policy decision, the A3 binding recheck, the A5 Ledger account state, the A6 partner state, the A6T09 external reconciliation snapshot, and the A7 product state through approved read-only consumer boundaries.
- The B1 commercial-analytics engine, the B1 profitability engine, and the B1 commercial-reconciliation engine never post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.
- The B1 commercial-reconciliation engine classifies commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, and commercial-cost-accounting discrepancies through a frozen, severity-classified, owner-assigned, recovery-state-assigned vocabulary.
- The B1 commercial-reconciliation engine is the only B1 commercial-decision / commercial-financial-effect / commercial-billing / commercial-invoice / commercial-statement / commercial-campaign / commercial-promotion / commercial-coupon / commercial-referral / commercial-cashback / commercial-loyalty / commercial-revenue-recognition / commercial-tax / commercial-cost-accounting reconciliation authority.
- The B1 commercial-analytics engine, the B1 profitability engine, and the B1 commercial-reconciliation engine never store raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.
- The B1 commercial-reconciliation engine supports trace classifies the B1 commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics fields for the A1 data classification, retention, legal-hold, and support-access controls; the B1 commercial-reconciliation engine uses the A1 PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED vocabulary.

#### Dependencies

- B1T01, B1T02, B1T03, B1T04, B1T05, B1T06, B1T07, B1T08.
- A4 capability / policy / limit / obligation / currentness / re-evaluation contract.
- A3 binding / ownership / recheck contract.
- A5 Ledger / account / state / posting / financial-invariants contract.
- A6 partner / callback / settlement / suspense / compensating / external-reconciliation contract.
- A6T09 external reconciliation snapshot.
- A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contract.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, and request-context primitives.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0044, ADR-0047, ADR-0049, ADR-0050, ADR-0052, ADR-0053, ADR-0054.

#### Explicitly out of scope

- Auto-repair, auto-clearing, or auto-issuing of any commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, or commercial-cost-accounting record.
- Implementing the B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, or the B1T11 commercial release gate.

### B1T10 — B1 Commercial Data Classification, Commercial Idempotency, Commercial Audit, Commercial Approvals, and Feature Flag Surface

- **Type:** Runtime commercial-operations, commercial-data-boundary, and commercial-policy surface implementation
- **ADR input:** ADR-0024, ADR-0052, and the proposed B1 range (ADR-0061, ADR-0069)

#### Objective

Ensure that B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics data are shared, stored, logged, traced, retained, classified, and disclosed only under approved controls. Reuse the A6T10 data-classification matrix and the A1 data classification, retention, and legal-hold controls; do not invent a parallel commercial privacy authority. Provide the B1 commercial idempotency, commercial audit, and commercial approval surface that every commercial engine consumes. Provide the B1 feature flag surface that every product consumes.

#### Deliverables

- `docs/B1-COMMERCIAL-DATA-CLASSIFICATION-MATRIX.md`.
- B1 commercial data-classification extension: register the B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics data fields in the A6T10 `ExternalDataClassificationRegistry` (the only A6T10 data classification authority) through approved read-only consumer boundaries.
- B1 commercial data-minimization contract: B1 commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics data minimization contract that reuses the A6T10 `ExternalDataMinimizationService` (the only A6T10 data minimization authority).
- B1 commercial consent validation: B1 commercial consent assertion that reuses the A6T10 consent record (the only A6T10 consent authority) through approved read-only consumer boundaries; B1 commercial consent is distinct from A2 authorization, A4 policy eligibility, and `CustomerPreference` intent.
- B1 commercial disclosure projection: B1 commercial disclosure projection that reuses the A6T10 disclosure projection (the only A6T10 disclosure authority) through approved read-only consumer boundaries.
- B1 commercial retention classification: register the B1 commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics datasets in the A6T10 retention classification (the only A6T10 retention authority) through approved read-only consumer boundaries.
- B1 commercial legal-hold integration: B1 commercial legal-hold that reuses the A6T10 legal-hold (the only A6T10 legal-hold authority) through approved read-only consumer boundaries.
- B1 commercial secret handling: B1 commercial secret classification that registers the B1 commercial secret categories in the A6T10 secret classification (the only A6T10 secret authority) through approved read-only consumer boundaries.
- B1 commercial support-trace data minimization: B1 commercial support-trace projection that reuses the A6T10 support-trace projection (the only A6T10 support-trace authority) through approved read-only consumer boundaries.
- B1 commercial payload validation: B1 commercial payload validation that reuses the A6T10 partner-payload validation (the only A6T10 partner-payload validation authority) through approved read-only consumer boundaries.
- B1 commercial audit integration: B1 commercial audit integration that reuses the shared Operations `AuditService` (the only audit authority) through approved read-only consumer boundaries.
- B1 commercial idempotency: B1 commercial idempotency that reuses the shared Operations `IdempotencyService` (the only idempotency authority) through approved read-only consumer boundaries.
- B1 commercial approvals: B1 commercial approvals that reuses the A2 privileged-action and step-up approval surface (the only approval authority) through approved read-only consumer boundaries.
- B1 feature flag surface: B1 feature flag surface that exposes a read-only consumer boundary to every product; B1 is the only B1 feature flag surface; A4 remains the only policy authority; B1 supplies the feature flag data A4 and every product consume.
- B1 commercial data-classification, commercial idempotency, commercial audit, commercial approval, and feature flag replay-safe, conflict-safe, no-source-mutation, and read-only tests.
- B1 commercial data-classification, commercial idempotency, commercial audit, commercial approval, and feature flag fixture-based tests; no live partner or live product call is required.

#### Acceptance criteria

- B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics data are shared, stored, logged, traced, retained, classified, and disclosed only under approved controls.
- B1 commercial data-classification, data-minimization, consent validation, disclosure projection, retention classification, legal-hold, secret classification, support-trace projection, and partner-payload validation reuse the A6T10 data-classification matrix and the A1 data classification, retention, and legal-hold controls; B1 does not invent a parallel commercial privacy authority.
- B1 commercial audit and B1 commercial idempotency reuse the shared Operations `AuditService` and `IdempotencyService`; B1 does not invent a parallel commercial audit or commercial idempotency authority.
- B1 commercial approvals reuse the A2 privileged-action and step-up approval surface; B1 does not invent a parallel commercial approval authority.
- B1 feature flag surface is the only B1 feature flag surface; B1 supplies the feature flag data A4 and every product consume through approved read-only consumer boundaries; A4 remains the only policy authority.
- B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics data are never stored with raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data.
- B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics payload validation reuses the A6T10 partner-payload validation; B1 does not invent a parallel commercial payload validation authority.

#### Dependencies

- B1T01, B1T02, B1T03, B1T04, B1T05, B1T06, B1T07, B1T08, B1T09.
- A1 identifier, privacy, retention, legal-hold, and external-sharing controls.
- A2 secret, route, audience, privileged-access, and security-event contracts.
- A3 account ownership and A4 policy / obligation contracts.
- A6T10 data classification matrix and external-rail data controls.
- A7 product data-minimization contract.
- `CustomerPreference` and `NotificationPreference` intent authority.
- Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, request context, and diagnostics primitives.
- ADR-0024, ADR-0052, ADR-0061, ADR-0069.

#### Explicitly out of scope

- Legal approval itself, customer portal / mobile commercial disclosure screens, marketing consent, general data-platform redesign, B2 customer-activation rollout, B2 public-channel implementation, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.
- Any B1 commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, or commercial-cost-accounting notification dispatch (B1 commercial notification dispatch is owned by A7T06 through the `CustomerPreference` intent authority; B1 never dispatches a notification directly).
- Implementing the B1T11 commercial release gate.

### B1T11 — B1 Commercial Integration, Commercial Plan Certification, Commercial Release Gate, and B2 Handoff

- **Type:** Integration and phase-exit evidence
- **ADR review:** the proposed B1 ADR range (the same range as the B1 plan reserves for commercial and infrastructure ADRs; ADR-0061 through ADR-0071)

#### Objective

Validate the complete B1 commercial-platform foundation and the bounded first commercial scope, and prepare the B1 commercial release gate and the B2 handoff without beginning B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.

#### Deliverables

- `docs/B1-INTEGRATION-MATRIX.md`.
- `docs/B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`.
- `docs/B1-ADR-REVIEW-STATUS.md`.
- `docs/B1-OPERATIONAL-RECOVERY-RUNBOOK.md`.
- `docs/B1-EXIT-CHECKLIST.md`.
- `docs/B1-APPROVAL-PACKAGE.md`.
- `docs/B1-B2-HANDOFF-PACKAGE.md`.
- End-to-end identity-to-customer-binding-to-policy-to-product-command-to-A6-partner-to-settlement-to-Ledger-to-reconciliation-to-commercial-decision-to-commercial-financial-effect-to-commercial-revenue-recognition trace for the existing A7 first product.
- Commercial sandbox / certification evidence for commercial-decision, commercial-validation, commercial-idempotency, fee, commission, revenue-sharing, billing, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue recognition, tax / VAT, cost accounting, profitability, analytics, data minimization, and rollback.
- Commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, commercial-analytics, and commercial-reconciliation correlation evidence.
- Commercial route / data-exposure, commercial credential, commercial disable, commercial rollback, internal financial-history preservation, commercial notification suppression override, and commercial support recovery evidence.
- B2 entry conditions and prohibited-edge register.

#### Acceptance criteria

- The first commercial scope maps to A1 identity, A2 authorization, A3 binding, A4 policy, A5 Ledger, A6 partner, A7 product, B1 commercial-decision, B1 commercial-financial-effect, B1 commercial-revenue-recognition, B1 commercial-tax, B1 commercial-cost-accounting, and B1 commercial reconciliation.
- One verified commercial-decision produces at most one traceable B1 commercial-financial effect and one approved B1 commercial-financial-recognition evidence where the selected flow requires it.
- Duplicate, changed-payload, partner-rejected, callback-replayed, delayed, out-of-order, timed-out, circuit-open, unavailable, unknown, plan-disabled, and product-disabled commercial operations have deterministic safe outcomes.
- B1 commercial-reconciliation evidence reconciles to the A6 partner / statement evidence, the A5 Ledger, and the A7 product without direct source mutation.
- Support can trace a B1 commercial-decision while provider credentials, callback secrets, raw funding data, preference data, and unrestricted risk / compliance data remain protected.
- Disable / circuit-breaker / commercial-rollback controls stop new commercial activity without rewriting completed A5, A6, A7, or Ledger history.
- Commercial-specific logic is isolated from canonical Customer, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, and Reconciliation authorities.
- B1 does not invent a new customer identity, consent, preference, product, compliance, risk, authorization, or notification authority.
- No unapproved second commercial scope, second commercial partner, public commercial API, mobile / web commercial channel, broad customer activation, B2 customer-activation rollout, B2 public-channel implementation, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation is included.
- All unresolved B1 implementation risks have an owner, severity, mitigation, stop condition, certification requirement, and rollback / disable behavior.
- B2 handoff conditions are explicit and do not claim that B1 proves all future commercial rollout, regional, capacity, customer-cohort, or partner-onboarding behavior.

#### Dependencies

- B1T01-B1T10.
- A1-A7 phase artifacts and handoff packages.
- Existing commercial-adjacent, `CustomerPreference`, partner, payment, deposit, withdrawal, wallet, ledger, operations, and reconciliation modules.
- Selected A6 partner sandbox / certification evidence.
- Finance / Ledger, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, and partner review inputs.

#### Explicitly out of scope

- B2 customer-activation rollout.
- B2 public APIs, mobile / web channels, marketing consent, broad customer activation, additional commercial scopes, additional commercial partner onboarding, or B2 production rollout beyond the separately approved release boundary.

### B1T12 — B1 Commercial Payment-Term and Invoice Due-Date Extension

- **Type:** Implemented bounded B1 extension cycle; no production term active
- **ADR:** ADR-0091
- **Owner:** B1 Commercial Platform
- **Detailed authoritative scope:** [`B2F07-PREREQUISITE-WORK-PACKAGES.md`](B2F07-PREREQUISITE-WORK-PACKAGES.md)

B1T12 defines versioned commercial payment terms, binds an approved selected term to B1 invoice evidence, and exposes deterministic due-date provenance through the canonical B1 read boundary. It does not reopen or modify historical B1T03/B1T05 task definitions, invent a payment-term value, implement AR/AP, post a journal, execute payment, or move payment-term authority into B2 Finance.

No Net 7, Net 15, Net 30, or other production term is authorized. The runtime supports bounded `ELAPSED_DAYS` values only through explicit versioned definitions and controlled activation; no default, seed, bootstrap term, or automatic activation exists.

## 9. B1 critical path

```text
B1T01 Commercial platform baseline and first-commercial-scope selection
  -> B1T02 B1 commercial catalog and plan-boundary contract
  -> B1T03 B1 pricing catalog, plan catalog, subscription plan, customer tier, merchant tier, partner tier, product entitlement, product packaging, and bundle catalog
  -> B1T04 B1 fee engine and commission engine (revenue sharing)
  -> B1T05 B1 billing engine, invoice engine, and statement-generation engine
  -> B1T06 B1 campaign, promotion, and coupon engine
  -> B1T07 B1 referral, cashback, and loyalty engine
  -> B1T08 B1 revenue-recognition, tax / VAT, and cost-accounting engine
  -> B1T09 B1 commercial analytics, profitability, and commercial reconciliation
  -> B1T10 B1 commercial data classification, commercial idempotency, commercial audit, commercial approvals, and feature flag surface
  -> B1T11 B1 commercial integration, commercial plan certification, commercial release gate, and B2 handoff
```

B1T01 must select the single first commercial scope before any B1 commercial implementation. B1T02 and B1T03 may be designed in parallel after B1T01, but no B1 commercial engine may be admitted before the B1 commercial catalog, the B1 plan-boundary contract, and the B1 catalogs (B1T03) are defined. B1T04 (fee / commission / revenue-sharing) and B1T06 (campaign / promotion / coupon) and B1T07 (referral / cashback / loyalty) may be designed together because they share the B1 commercial-decision envelope, but no B1 commercial-financial-effect may be admitted before B1T05 (billing / invoice / statement). B1T05 must be designed before B1T08 (revenue recognition / tax / VAT / cost accounting) can reuse B1T05 outputs. B1T08 must be designed before B1T09 (commercial analytics / profitability / commercial reconciliation) can consume B1T08 outputs. B1T10 (commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag) is a cross-cutting surface that may be designed in parallel with B1T04-B1T09 but is committed before B1T11 (commercial release gate) can pass. B1T11 is blocked until B1T01-B1T10 evidence is complete. B2 remains outside B1 and may not begin implementation until the B1 commercial release gate and the B1-to-B2 handoff are independently approved.

## 10. B1 integration trace

```text
A1 canonical ownership / identifier / privacy / retention / legal-hold / cross-cutting contracts
                         |
                         v
A2 authenticated principal / protected internal commercial / product / callback / notification / support / control surface
                         |
                         v
A4 current product / commercial capability decision (B1 supplies commercial-decision data to A4; A4 remains the only policy authority)
  capability / action + policy version + product limits + obligations + expiry + commercial tier / plan / entitlement / feature-flag / dynamic-limit
                         |
                         v
A3 internal account / customer-binding recheck (B1 supplies commercial-tier / commercial-entitlement / commercial-subscription data to A3; A3 remains the only binding authority)
  Customer.id -> CustomerWallet -> A3 binding -> WalletAccount -> LedgerAccount
  -> A7 product customer-binding map (B1 consumes the A7 product customer-binding map through approved read-only consumer boundaries)
  -> B1 commercial-decision map (commercial tier, commercial plan, commercial entitlement, commercial feature flag, commercial dynamic limit, commercial fee, commercial commission, commercial revenue sharing, commercial billing, commercial invoice, commercial statement, commercial campaign, commercial promotion, commercial coupon, commercial referral, commercial cashback, commercial loyalty, commercial revenue recognition, commercial tax, commercial cost accounting, commercial profitability, commercial analytics)
                         |
                         v
A7 product command (A7T05; B1 supplies the commercial-decision data the A7 product command consumes through approved read-only consumer boundaries)
  internal product command / operation ID
  A4 product policy reference + A3 binding reference + A6 partner dependency + B1 commercial-decision reference
  amountMinor + currency + accountingUnit
  product idempotency + provider idempotency + correlation / causation
                         |
                         v
B1 commercial catalog and plan-boundary contract (B1T02)
  approved commercial scope / plan / contract / version
  normalized commercial-decision request / result envelope
  B1 commercial-decision data: pricing, fee, commission, revenue sharing, plan, tier, entitlement, feature flag, dynamic limit, subscription, package, bundle
                         |
                         v
B1 pricing catalog, plan catalog, subscription plan, customer tier, merchant tier, partner tier, product entitlement, product packaging, and bundle catalog (B1T03)
                         |
                         v
B1 fee engine and commission engine (revenue sharing) (B1T04)
  B1 fee / commission / revenue-sharing decision
                         |
                         v
A6 partner adapter and isolated transport (A6T02; reused from A6; B1 consumes the A6 partner boundary through the existing A7 product layer)
  approved A6 partner / capability / version
  authenticated request + provider reference / acknowledgement
                         |
                         v
A7 product lifecycle (A7T07) reusing A6 lifecycle vocabulary
  submitted / pending / retry / unknown / manual review / settled / failed
                         |
                         v
A6 callback authenticity, replay, and freshness (A6T06; reused from A6)
  callback event identity + provider reference + replay state
                         |
                         v
A7 product financial effect, settlement, and Ledger integration (A7T08)
  verified product decision
  Ledger-owned journal / lines
  suspense or controlled exception where finality / matching is unresolved
                         |
                         v
B1 billing engine, invoice engine, and statement-generation engine (B1T05)
  B1 commercial-financial-effect events
                         |
                         v
B1 campaign, promotion, and coupon engine (B1T06)
  B1 commercial-incentive events
                         |
                         v
B1 referral, cashback, and loyalty engine (B1T07)
  B1 commercial-incentive events
                         |
                         v
A7 notification dispatcher (A7T06) under CustomerPreference.notifications
  delivery intent (outbox) -> delivery fact (audit) -> deduplication (idempotency)
  sensitive-payload redaction (A6T10 / A7T10 / B1T10)
                         |
                         v
B1 revenue-recognition, tax / VAT, and cost-accounting engine (B1T08)
  B1 commercial-financial-recognition events
                         |
                         v
Operations and independent control evidence
  audit + idempotency + transactional outbox
  A6 partner / internal references + A7 product operation + A7 notification + B1 commercial-decision + B1 commercial-financial-effect + B1 commercial-financial-recognition + support trace
  A6T09 external reconciliation (A7T09 reads A6T09; B1T09 reads A6T09 and A7T09)
  B1 commercial analytics, profitability, and commercial reconciliation (B1T09) + discrepancy owner
  B1 commercial data classification, commercial idempotency, commercial audit, commercial approvals, and feature flag surface (B1T10)
                         |
                         v
B1 commercial release control
  commercial disable + A6 circuit-breaker + B1 commercial-rollback + Ledger / A5 history preserved + A7 product-rollback preserved
```

The chain above is the only B1 commercial authority chain. A B1 commercial event, plan, tier, entitlement, feature flag, dynamic limit, fee, commission, revenue-sharing rule, billing entry, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition entry, tax / VAT entry, cost-accounting entry, profitability report, or commercial analytics report cannot become financial truth, an A2 authorization, an A3 binding repair, an A4 policy decision, an A5 Ledger record, an A6T08 settlement / suspense / compensating entry, an A6T09 external reconciliation mutation, an A7 product command, an A7 product operation, an A7 product financial effect, an A7 product reconciliation mutation, an A7 product data-minimization mutation, an Operations audit / idempotency / outbox mutation, or a `CustomerPreference` mutation without the owning boundary's verification.

## 11. B1 prohibited edges

- B1 treats a commercial event, plan, tier, entitlement, feature flag, dynamic limit, fee, commission, revenue-sharing rule, billing entry, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition entry, tax / VAT entry, cost-accounting entry, profitability report, or commercial analytics report as canonical Customer identity, A2 authorization, A3 binding, A4 policy, A5 Ledger, A6 partner, A7 product, Operations audit, Operations idempotency, Operations outbox, or `CustomerPreference` intent.
- B1 selects a WalletAccount / LedgerAccount from a customer reference, commercial reference, plan reference, tier reference, entitlement reference, fee reference, commission reference, billing reference, invoice reference, campaign reference, promotion reference, coupon reference, referral reference, cashback reference, loyalty reference, revenue-recognition reference, tax reference, cost-accounting reference, or analytics reference.
- B1 writes Customer, CustomerWallet, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding, A4 policy / source, or `CustomerPreference` records to make a commercial event pass.
- B1 embeds a second risk, compliance, sanctions, fraud, eligibility, restriction, or limit precedence engine.
- B1 calls a bank / NIBSS / provider, an SMS provider, an email provider, a push provider, or any external channel from Customer, Wallet, Ledger, A5, A6, A7T06, Reconciliation, diagnostics, readiness, support, or an unapproved controller instead of the A6 partner boundary or the A7T06 notification dispatcher.
- B1 accepts an unauthenticated, stale, replayed, malformed, wrong-partner, wrong-environment, or wrong-commercial-plan callback or commercial-decision.
- B1 retries an ambiguous commercial outcome with a new commercial-decision, partner, or financial identity without verified A6 partner / A7 product / B1 commercial reconciliation evidence.
- B1 posts a journal, mutates a balance, clears suspense, or edits a posted journal / line outside Ledger and Finance-approved correction boundaries.
- B1 treats a commercial acknowledgement or commercial event as settled value or credits / debits a customer before the approved A5 Ledger evidence exists.
- B1 creates an independent commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, commercial-analytics, commercial-reconciliation, commercial-audit, commercial-idempotency, commercial-outbox, commercial-metrics, commercial-diagnostics, commercial-notification, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-dynamic-limit, commercial-subscription, commercial-package, commercial-bundle, commercial-approval, commercial-classification, commercial-retention, commercial-legal-hold, commercial-secret, commercial-disclosure, or commercial-release-gate authority.
- B1 stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or commercial-decision payloads.
- B1 exposes a public customer, mobile, web, or partner commercial API merely because a commercial-decision contract or commercial engine exists; A2 route / data controls remain required.
- B1 broadens the selected first commercial scope, the A6 partner dependency, or the customer cohort without a separate reviewed capability decision and release boundary.
- B1 mutates completed A5 transfer, A6 settlement, A6 suspense, A6 journal, A7 product operation, or Ledger history for commercial, partner, or notification correction.
- B1 begins B2 customer-activation rollout, B2 public commercial APIs, B2 mobile / web commercial channels, B2 marketing consent, B2 broad customer activation, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 production rollout.
- B1 converts a commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, or commercial-analytics report into a financial command, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.

## 12. B1 phase exit criteria

B1 implementation is complete only when:

- The first commercial scope has an explicit commercial scope key, capability, currency, data, consent, internal commercial-decision owner, partner dependency (where applicable), prohibited-edge, and notification / support / reporting contract.
- The B1 commercial catalog and plan-boundary contract are stable and prevent commercial-specific behavior from becoming a source authority in canonical modules.
- B1 commercial-decision data extends, not replaces, A4 precedence.
- B1 commercial-decision data extends, not replaces, A3 binding recheck.
- B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, and commercial-analytics identifiers remain distinct and queryable.
- B1 commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, and commercial-cost-accounting events honor `CustomerPreference.notifications` and the A6T10 / A7T10 / B1T10 data controls; the B1 commercial engines cannot become an A2, A3, A4, A5, A6, or A7 authority.
- B1 fee, commission, revenue-sharing, billing, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue recognition, tax / VAT, cost accounting, profitability, and analytics engines are bounded, support-traceable, and reuse A1-A7 vocabulary where applicable.
- B1 commercial-decision engines never post a journal, never mutate a balance, never clear suspense, and never edit a posted journal / line outside Ledger and Finance-approved correction boundaries.
- B1 commercial-financial-effect, commercial-revenue-recognition, commercial-tax, and commercial-cost-accounting engines create at most one balanced A5 Ledger-owned financial effect, or enter explicit pending / suspense / manual-review / commercial-reconciliation state.
- B1 commercial-financial-effect, commercial-revenue-recognition, commercial-tax, and commercial-cost-accounting engines preserve immutable A5 Ledger history and assign ownership without automatic source repair.
- Independent B1 commercial reconciliation detects missing, duplicate, orphan, delayed, mismatched, stale, and unresolved commercial-decision, commercial-financial-effect, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, and commercial-cost-accounting evidence without writing source records.
- B1 commercial certification fixtures and tests cover commercial-decision, commercial-validation, commercial-idempotency, fee, commission, revenue sharing, billing, invoice, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue recognition, tax / VAT, cost accounting, profitability, analytics, data minimization, and rollback behavior.
- Data sharing, consent, retention, legal-hold, secret, support, and customer / internal disclosure controls are explicit and tested at the selected commercial boundary.
- B1 commercial disable and rollback controls stop new commercial activity without rewriting A5, A6, A7, or Ledger financial history.
- A1, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Support, Commercial, and `CustomerPreference` authorities remain separate.
- No B2 customer-activation rollout, B2 public commercial API, B2 mobile / web commercial channel, B2 marketing consent, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation is included.
- B1-to-B2 handoff is documented without claiming that B1 proves all future commercial rollout, regional, capacity, customer-cohort, or partner-onboarding behavior or broad production activation.

## 13. B1 handoff to B2

B1 may provide later phases with:

- the B1 commercial catalog, B1 plan-boundary contract, and B1 commercial-extension contract;
- B1 commercial-decision, commercial-plan, commercial-tier, commercial-entitlement, commercial-feature-flag, commercial-fee, commercial-commission, commercial-billing, commercial-invoice, commercial-statement, commercial-campaign, commercial-promotion, commercial-coupon, commercial-referral, commercial-cashback, commercial-loyalty, commercial-revenue-recognition, commercial-tax, commercial-cost-accounting, commercial-profitability, commercial-analytics, and commercial-reconciliation data and contracts;
- B1 commercial-decision identity, commercial-decision idempotency, commercial-decision request-hash, and commercial-decision correlation patterns;
- the B1 fee engine, the B1 commission engine, the B1 revenue-sharing engine, the B1 billing engine, the B1 invoice engine, the B1 statement-generation engine, the B1 campaign engine, the B1 promotion engine, the B1 coupon engine, the B1 referral engine, the B1 cashback engine, the B1 loyalty engine, the B1 revenue-recognition engine, the B1 tax / VAT engine, the B1 cost-accounting engine, the B1 commercial-analytics engine, the B1 profitability engine, the B1 commercial-reconciliation engine, the B1 commercial data-classification surface, the B1 commercial idempotency surface, the B1 commercial audit surface, the B1 commercial approvals surface, the B1 feature flag surface, and the B1 commercial release gate;
- B1 commercial-decision retry, manual review, status verification, and unknown-outcome recovery patterns;
- B1 commercial disable, rollback, and internal-history-preservation evidence; and
- B1 commercial support-trace classification for the A1 data classification, retention, legal-hold, and support-access controls.

B1 must not provide later phases with:

- bank, NIBSS, partner, SMS, email, push, or other external credentials, tokens, certificates, signing keys, callback secrets, partner confidential material, or unrestricted risk / compliance evidence;
- raw KYC, risk, compliance, investigative, security, device, support-restricted, or customer PIN / OTP payloads;
- mutable balances, posted journal / line data as a new source of truth, or financial correction authority;
- permission to treat an outbox event, payment reference, command ID, provider reference, callback ID, external reference, product reference, notification delivery record, suspense row, commercial-decision reference, commercial-financial-effect reference, commercial-billing reference, commercial-invoice reference, commercial-statement reference, commercial-campaign reference, commercial-promotion reference, commercial-coupon reference, commercial-referral reference, commercial-cashback reference, commercial-loyalty reference, commercial-revenue-recognition reference, commercial-tax reference, commercial-cost-accounting reference, commercial-profitability reference, commercial-analytics reference, or commercial-reconciliation reference as Ledger truth;
- permission to bypass A1 identity, A2 authorization, A3 binding, A4 policy, A5 internal lifecycle, A6 partner, A7 product, B1 commercial-platform, Ledger, Operations, or Reconciliation controls;
- permission to infer an internal account, commercial customer-binding, commercial-plan eligibility, commercial-tier eligibility, commercial-entitlement, commercial-feature-flag, or `CustomerPreference` from external data, partner response, commercial data, or product data;
- a claim that the first selected commercial scope proves all commercial-decision reliability, fee reliability, commission reliability, revenue-sharing reliability, billing reliability, invoice reliability, statement reliability, campaign reliability, promotion reliability, coupon reliability, referral reliability, cashback reliability, loyalty reliability, revenue-recognition reliability, tax / VAT reliability, cost-accounting reliability, profitability reliability, or commercial-analytics reliability;
- a second commercial scope, second commercial partner, public commercial route, mobile / web / partner commercial API, marketing consent, or commercial catalogue;
- permission to mutate completed A5 transfer, A6 settlement, A6 suspense, A6 journal, A7 product operation, B1 commercial-decision, B1 commercial-financial-effect, B1 commercial-billing, B1 commercial-invoice, B1 commercial-statement, B1 commercial-campaign, B1 commercial-promotion, B1 commercial-coupon, B1 commercial-referral, B1 commercial-cashback, B1 commercial-loyalty, B1 commercial-revenue-recognition, B1 commercial-tax, B1 commercial-cost-accounting, B1 commercial-profitability, B1 commercial-analytics, or Ledger history for commercial, partner, or notification correction;
- permission to skip B2 customer-activation rollout, B2 public-channel implementation, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, B2 broad customer activation, or B2 production rollout review;
- permission to treat fixture-based commercial certification as live A6 partner, live A7 product, or live commercial dispatch; and
- ADR-0048 itself is not part of B1; it is the A6T03 decision record and must be authored / approved before any partner-specific transport / credential / signing / key-rotation evidence is claimed, irrespective of B1 progress.

B2 remains responsible for customer-activation rollout, public-channel implementation, marketing-consent onboarding, cross-region or cross-currency rollout, partner onboarding beyond the already-approved A6 partner, broad customer activation, commercial-cohort expansion, commercial-product expansion, and production rollout. B2 may not begin implementation until the B1 commercial release gate and the B1-to-B2 handoff are independently approved.

## 14. B1 plan verification record

- [x] Official phase title is B1 — Commercial Platform.
- [x] B1 is positioned after A7 and before B2.
- [x] B1 requires one bounded first commercial scope instead of an implicit multi-scope commercial catalogue.
- [x] A1, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Support, Commercial, and `CustomerPreference` dependencies are explicit.
- [x] Commercial catalog and plan-boundary contract keep commercial-specific behavior outside canonical authorities.
- [x] Commercial-decision data extends, not replaces, A4 precedence.
- [x] Commercial-decision data extends, not replaces, A3 binding recheck.
- [x] Notification dispatch honors `CustomerPreference.notifications` and the A6T10 / A7T10 / B1T10 data controls; B1 does not invent a new consent, preference, or notification authority.
- [x] Commercial engines are bounded by A1-A7 vocabulary and the existing A4 / A5 / A6 / A7 / Operations authorities.
- [x] B1 commercial engines never post a journal, never mutate a balance, never clear suspense, and never edit a posted journal / line outside Ledger and Finance-approved correction boundaries.
- [x] B1 commercial reconciliation is read-only with respect to all source records.
- [x] B1 data minimization, consent, classification, retention, legal-hold, secret, and disclosure controls reuse the A6T10 data-classification matrix and the A1 data classification, retention, and legal-hold controls; B1 does not invent a parallel commercial privacy authority.
- [x] B1 prohibited edges, rollback / disable boundaries, B2 handoff, and B2 exclusion are explicit.
- [x] Proposed B1 ADR range is documented and does not renumber existing ADRs (ADR-0047 through ADR-0052 are A6; ADR-0053 is A6T09; ADR-0054 through ADR-0060 are A7; the proposed B1 range is ADR-0061 through ADR-0071).
- [x] No application source, entity, migration, service, controller, API, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, or runtime activation is created by this planning task.

## 15. B1T11 plan evidence record (placeholder)

B1T11 will record:

- [ ] `docs/B1-INTEGRATION-MATRIX.md` records the end-to-end task-to-evidence matrix and the A1 → A2 → A4 → A3 → A6 → A7T05 → A7T07 → A7T08 → A7T09 → B1T04 → B1T05 → B1T08 → B1T09 trace for the first selected commercial scope.
- [ ] `docs/B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md` records B1 commercial disable, A6 circuit-breaker, environment emergency-stop, and rollback-safe procedure; the `partner-callback.controller` remains an A2-protected internal surface, no new public commercial route is approved, and no new commercial notification channel is approved.
- [ ] `docs/B1-ADR-REVIEW-STATUS.md` reviews the proposed B1 ADR range against committed implementation evidence and records any ADR in the proposed B1 range that is not yet authored as a release-gate blocker.
- [ ] `docs/B1-OPERATIONAL-RECOVERY-RUNBOOK.md` records operating principles, evidence sources, incident classification, recovery procedure, decision matrix, support-trace contract, and ownership / stop conditions for the first selected commercial scope and the shared B1 commercial-platform infrastructure.
- [ ] `docs/B1-EXIT-CHECKLIST.md` records the B1 acceptance checklist, unresolved blockers, and the explicit B1 phase result.
- [ ] `docs/B1-APPROVAL-PACKAGE.md` records the owner approval register, no-go recommendation, go conditions, and explicit non-claims.
- [ ] `docs/B1-B2-HANDOFF-PACKAGE.md` records the bounded handoff to B2, the prohibited edges, the B2 entry conditions, and the blocked handoff status.
- [ ] Local automated validation passes: `npm test`, `npm run lint`, `npm run build`, `npm run format:check`.
- [ ] B1T11 introduces no application source, entity, migration, service, controller, API, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, or runtime activation.
- [ ] B1T11 does not begin B2 or any commercial-roadmap expansion beyond the first selected commercial scope.
