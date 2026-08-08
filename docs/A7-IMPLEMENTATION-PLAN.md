# A7 Product Expansion Infrastructure — Implementation Plan

- **Phase:** A7 — Product Expansion Infrastructure
- **Status:** Planned
- **Scope:** Shared product-expansion infrastructure (product catalog/boundary, product-specific policy profiles, product customer-binding, product command/lifecycle, notification delivery, product financial-effect boundaries, independent product reconciliation, product data minimization, and public/support/reporting surface contracts) plus one first bounded product (provider-backed virtual account) selected and constrained by A7T01
- **Implementation order:** Architecture phase after the completed A1 Foundation Consolidation, A2 Runtime Identity & Access, A3 Customer-to-Financial Account Binding, A4 Capability & Policy Engine, A5 Internal Financial Pilot, and A6 External Partners & Settlement
- **Number of implementation tasks:** 11
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`PHASES.md`](PHASES.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md), [`A6-IMPLEMENTATION-PLAN.md`](A6-IMPLEMENTATION-PLAN.md), [`A6-A7-HANDOFF-PACKAGE.md`](A6-A7-HANDOFF-PACKAGE.md), [`A6-INTEGRATION-MATRIX.md`](A6-INTEGRATION-MATRIX.md)
- **Proposed A7 ADR range:** ADR-0054 through ADR-0060 (ADR-0053 is already used by A6T09 Independent External Reconciliation, which is outside the A6 reserved range; A7 reserves the next contiguous range. Each A7T task may own one ADR; subsequent A7 products will require their own ADR in a later range or extension of this one and are out of scope for this plan.)

This document is a planning artifact only. It creates no application source, entity, migration, service, controller, API, route, scheduler, notification dispatcher, public channel, product, financial behavior, or runtime activation.

## 1. Official phase title

**A7 — Product Expansion Infrastructure**

A7 is an Architecture phase and is not a Product Roadmap milestone. It introduces the shared infrastructure for adding new financial products one at a time, plus one first bounded product (provider-backed virtual account), after A6 has established the external partner, callback, settlement, suspense, and external-reconciliation boundaries. A7 does not begin A8 scale/extraction, broad customer activation, mobile/web channels, marketing onboarding, or product catalogue expansion beyond the selected first product.

A7 must not be treated as permission to activate a product merely because a product contract, notification dispatcher, or public surface exists. Product selection, capability policy mapping, A2 audience/authorization, A3 binding, A4 eligibility, A5 internal lifecycle, A6 partner/settlement (where applicable), Finance/Ledger, Reconciliation, Security, Privacy, Legal, Risk, Compliance, Support, and release gates remain explicit phase inputs and exit conditions.

## 2. Phase objective

Introduce the shared product-expansion infrastructure and one first bounded product—selected and constrained by A7T01—so that subsequent products can be added under the same common access, policy, ledger, event, and reconciliation contracts. The shared infrastructure must:

- provide one explicit product catalog and product-boundary contract that prevents product-specific behavior from becoming a source authority in Customer, Wallet, Ledger, A2, A3, A4, A5, A6, Operations, or Reconciliation;
- extend the A4 capability/profile machinery with a product-specific profile contract that is still governed by A4 precedence;
- extend the A3 customer-binding boundary with a product-specific binding map without inferring or repairing internal accounts;
- introduce a product command and product operation identity distinct from internal command, A6 external operation, callback, settlement, and journal identities;
- provide a notification delivery infrastructure that consumes `CustomerPreference.notifications` and the A6T10 / A7T10 data-classification matrix without inventing a new customer intent or consent authority;
- post only verified product financial effects through the existing Ledger boundary and represent unmatched, delayed, disputed, or ambiguous product value through approved suspense, compensating, or exception controls where applicable to the product;
- independently reconcile product operation, customer/account mapping, financial effect, audit, outbox, and idempotency evidence read-only;
- share the data-minimization, consent, classification, retention, legal-hold, secret, and disclosure controls with A6T10 without creating a parallel privacy authority;
- expose a minimized, audience-aware public/support/reporting surface through approved A2 audience controls without treating preferences, support views, or product data as A2 authorization; and
- prove a complete identity-to-customer-binding-to-policy-to-product-command-to-Ledger-to-outbox-to-reconciliation trace for the first selected product without allowing a product event, preference value, product command ID, or product reference to replace A2, A3, A4, A5, A6, Wallet, Ledger, Operations, or Reconciliation authority.

The first product (provider-backed virtual account) must be limited to a bounded flow: assign/activate a virtual account identifier, receive inbound funds, post the verified financial effect through the A6 partner boundary, and represent the product operation through product lifecycle states. It must not introduce savings interest, lending, fees beyond what the A6 partner contract already allows, or product pricing/marketing flows.

A7 must not be treated as permission to add bills/airtime, QR/merchant, agent/assisted, card, bulk/payroll, or savings/credit products. Each additional product requires a separate reviewed capability decision and a future ADR in a separate A7-product cycle; that cycle is out of scope for this plan.

## 3. A7 boundary and task summaries

### 3.1 Selected product-expansion boundary

A7 does not preselect a product, product flow, partner, currency, pricing model, or notification channel in this planning document. A7T01 must select one bounded first product from the approved candidate set, record the product key, capability, internal command owner, partner dependency (where applicable), direction of value, currency, accounting unit, data fields, prohibited adjacent products, and the minimum notification/support/reporting surface, before implementation proceeds.

The selected first product must be one of the following bounded shapes, subject to A7T01 evidence and review:

```text
virtual account assignment, inbound funding, and lifecycle under the existing A6 partner boundary
```

A7 must not simultaneously implement inbound cards, QR/merchant, bills/airtime, agent/assisted, bulk/payroll, savings, or credit as part of the first product. A second product or a second partner (other than the already-approved A6 partner for the selected first product) requires a separate capability decision and must not be smuggled into the first product contract.

### 3.2 One-line summary of every task

| Task | One-line summary |
| --- | --- |
| **A7T01** | Establish the product-expansion baseline, select one bounded first product, and record prohibited edges, risks, certification inputs, and rollback assumptions. |
| **A7T02** | Define the A7 product catalog, product-boundary contract, and shared product-extension points that keep product-specific behavior outside canonical authorities. |
| **A7T03** | Extend the A4 capability/policy machinery with a product-specific profile, product eligibility, and product-limit/decision contract that does not create a second policy evaluator. |
| **A7T04** | Define product customer-binding, ownership, and explicit internal/external account mapping that does not infer or repair A3 bindings from product data. |
| **A7T05** | Define product command identity, product operation record, request hashing, correlation, and product/provider idempotency behavior. |
| **A7T06** | Implement the notification delivery infrastructure that consumes approved customer preferences and A6T10/A7T10 data controls without creating a new consent authority. |
| **A7T07** | Implement the product lifecycle, bounded retry, manual-review, unknown-outcome, and recovery boundary without creating a duplicate A6 lifecycle authority. |
| **A7T08** | Integrate verified product financial effects with Ledger, suspense, compensating-entry, and Finance/Ledger-approved chart dimensions for the selected first product. |
| **A7T09** | Implement independent product reconciliation, discrepancy classification, certification evidence, and support recovery trace that is read-only with respect to all source records. |
| **A7T10** | Define product data minimization, consent, classification, retention, secret, and customer/partner/support disclosure controls consistent with the A6T10 matrix. |
| **A7T11** | Validate the complete A7 shared infrastructure and first product and prepare the release gate, rollback package, and A8 handoff without starting A8. |

### 3.3 Product financial-effect boundary

A product command, product acknowledgement, product event, virtual-account identifier, provider reference, callback, statement, or outbox fact is not financial truth by itself. A successful A7 product flow must establish, through the approved contracts:

- one canonical internal customer and account identity chain (A3 + Wallet + Ledger);
- one distinct product command and product operation identity (A7T05);
- one A4 product-specific policy decision with policy version, evidence, expiry, limits, and obligations;
- one validated partner, capability, and contract version when the product crosses the A6 partner boundary;
- one truthful product lifecycle state for assigned, pending, active, suspended, failed, settled, or closed outcomes;
- one Ledger-owned financial effect only after the approved settlement evidence and financial invariants are satisfied (A8T08 / A6T08);
- one A6 partner-driven settlement, suspense, or external reconciliation path where the product depends on the A6 partner; and
- one independent reconciliation trace covering internal and external evidence (A7T09).

A product side effect that is not atomic with a PostgreSQL transaction by assertion alone must be persisted in a pending/recovery state and verified through the approved A6 partner status, callback, statement, product reconciliation, or A5 internal lifecycle path. A7 must never retry a product command blindly or report optimistic product success.

### 3.4 Existing implementation inputs

A7 consumes and must preserve:

- A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts;
- A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts;
- A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts;
- A4 capability/action policy, limits, obligations, evidence snapshot, expiry, re-evaluation, and currentness contracts;
- A5 customer-aware command/correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns;
- A6 partner-adapter boundary, capability/version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization;
- `CustomerPreference` (including `NotificationPreference`) as the customer intent authority for notification delivery; A7 delivers, it does not redefine intent;
- existing `virtual-account` module metadata as a compatibility input, not evidence of an A7 product boundary;
- Operations AuditService, IdempotencyService, OutboxService, MetricsService, DiagnosticsService, request context, readiness, retention, and shutdown primitives; and
- independent Reconciliation and Finance verification patterns.

Existing product, preference, virtual-account, deposit, withdrawal, payment, transfer, wallet, and ledger routes and metadata must not be treated as A7-approved exposure merely because they exist in the repository.

## 4. A7 scope

A7 includes:

- One approved first product (provider-backed virtual account) selected through A7T01.
- A shared product catalog and product-boundary contract that prevents product-specific behavior from becoming a source authority in domain modules.
- Product-specific A4 capability/profile/limit/decision extension without duplicating A4 precedence.
- Product-specific A3 customer-binding and internal account mapping without inferring or repairing A3 bindings.
- Distinct internal command, product command, product operation, partner reference, callback, settlement, journal, suspense, audit, outbox, and reconciliation identifiers for product flows.
- Provider-facing request idempotency and Operations-backed idempotency with deterministic normalized request hashes for product commands.
- Notification delivery infrastructure that consumes approved `CustomerPreference.notifications` and A6T10/A7T10 data controls, including preference changes, channel selection, deduplication, delivery lifecycle, suppression, and read-only delivery audit.
- Bounded product retry, manual-review, status-verification, timeout, unknown-outcome, and recovery behavior that reuses A6 lifecycle vocabulary where applicable.
- Settlement, suspense, compensating-entry, and Ledger integration for the first product under the existing Ledger authority and the A6 partner boundary where applicable.
- Independent product reconciliation, discrepancy classification, certification evidence, and support trace that is read-only with respect to all source records.
- Data minimization, consent/mandate, classification, retention, legal-hold, secret, and customer/support disclosure controls consistent with the A6T10 matrix.
- Public/support/reporting read surface contracts that expose minimum necessary data through approved A2 audience controls.
- Product sandbox/certification fixtures, contract tests, fixture-based notification tests, release evidence, rollback/disable behavior, and A8 handoff boundaries.

## 5. A7 non-goals

A7 does not implement:

- Authentication, sessions, MFA, authorization, route protection, privileged-action issuance, or customer identity; those remain A2 responsibilities.
- Customer-to-financial-account binding, binding repair, account reassignment, account provisioning, or account ownership inference; those remain A3 responsibilities.
- Capability/risk/eligibility/restriction/compliance/limit precedence or a second policy evaluator; those remain A4 responsibilities.
- Mutation of Customer, CustomerWallet, customer eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding, WalletAccount, or source `CustomerPreference` records to make a product pass.
- Replacement of the A5 internal transfer lifecycle, A6 partner boundary, Ledger authority, Operations authority, outbox authority, pilot-control boundary, or independent reconciliation authority.
- A second customer wallet balance, settlement ledger, journal authority, suspense truth source, product-reference identity authority, notification intent authority, or reconciliation writer.
- AML, sanctions, fraud, PEP, transaction-monitoring, automated screening, risk scoring, or external compliance decision engines. A7 consumes approved A4/security/compliance contracts and does not invent their precedence.
- FX, cross-currency conversion, product pricing, fees, commissions, taxes, savings interest, lending, chargebacks, disputes, card schemes, QR/merchant rails, biller aggregators, agent networks, payroll, bulk payments, savings products, credit products, or any other product expansion beyond the selected first product unless a separate approved capability plan explicitly adds one of them.
- Public customer activation, broad rollout, mobile/web channels, customer portal changes, marketing consent, or general customer onboarding; those remain later product/channel work.
- Unbounded background workers, an unowned broker, a new service-extraction topology, or a product-specific scheduler without an approved Operations/runtime boundary.
- Automatic reconciliation repair, automatic suspense clearing, in-place journal/line/balance mutation, or silent financial correction.
- A second partner (other than the already-approved A6 partner for the selected first product) or a partner marketplace.
- Production product activation, live product rollout, regulatory launch, or broad cohort merely because A7 implementation artifacts exist.
- A8 Scale & Selective Extraction.
- Notification or customer-messaging behaviour that bypasses the approved `CustomerPreference.notifications` authority or that creates a new customer intent/consent/notification record.

## 6. Governing architectural boundaries

A7 must preserve the following rules from A1-A6 and the financial core:

1. `Customer.id` is the only canonical internal customer identity. Customer references, aliases, case numbers, beneficiary references, funding-instrument IDs, payment references, command IDs, correlation IDs, provider IDs, partner references, product keys, virtual-account identifiers, and notification identifiers remain distinct values.
2. A2 authenticates and authorizes the initiating principal and protects internal product, callback, notification, support, and control surfaces. A product event, preference value, or partner callback cannot grant A2 authorization.
3. A4 owns action-specific capability, risk, restriction, eligibility, compliance, limit, and obligation policy. A7 consumes the current result and must not duplicate or override A4 precedence; product-specific A4 profiles extend, not replace, A4 authority.
4. A3 owns the explicit Customer-to-Financial-Account binding. A7 must use verified internal account assertions and must never choose an account from a customer reference, product identifier, preference value, partner reference, or virtual-account identifier.
5. `CustomerPreference` (including `NotificationPreference`) is the customer intent authority for delivery. A7 delivers according to that intent; it does not invent or replace the intent.
6. `WalletAccount` remains the financial wallet facade, and `Ledger` remains the sole authority for financial accounts, journals, lines, balances, posted value, settlement entries, suspense entries, and compensating entries.
7. External side effects and internal database transactions have different commit boundaries. A7 must represent the gap with durable lifecycle, idempotency, callback, status-verification, suspense, reconciliation, or manual-review states.
8. Operations owns audit, idempotency, outbox, metrics, diagnostics, request context, readiness, retention, and operational lifecycle. A7 must reuse those primitives rather than create local substitutes.
9. Reconciliation remains independent and read-only. Product reports, notification delivery audit, diagnostics, readiness, and support views cannot repair source records or authorize product financial effects.
10. Notification delivery, product data, preference data, customer funding data, risk/compliance evidence, and financial-control data are minimized, classified, access-controlled, redacted, and retained only under approved controls.
11. A7 is a bounded product-expansion boundary inside the existing modular monolith. It does not create a microservice or topology change based only on product scope.
12. Every product command and notification must be scoped to an approved product and must carry an internal correlation chain without treating the product identifier or notification reference as canonical internal identity.
13. A7 may use the A5 transactional outbox as a durable internal intent/fact boundary, but no notification dispatcher, callback, product command, or financial-execution process may treat an outbox row as a Ledger record, a customer intent, or a delivery confirmation.
14. Disabling a product or its notification surface stops new product admission and outbound delivery without deleting, rewriting, or masking completed internal financial history.
15. A notification delivery never becomes a financial command, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.

## 7. Dependencies and required inputs

### A1 inputs

- Canonical ownership matrix and prohibited shared-writer decisions.
- Customer, funding-instrument, beneficiary, bank, payment, financial, provider-reference, preference, and product-identifier conventions.
- Data classification, retention, legal-hold, minimization, external-sharing, and privacy controls.

### A2 inputs

- Authenticated principal, customer scope, audience, assurance, roles/scopes, authorization decision, and request/correlation/trace/causation context.
- Protected route/service action policy for the selected product command, product callback (where applicable), internal notification control paths, and public/support/reporting surfaces.
- Privileged approval and step-up requirements for product configuration, emergency access, settlement exceptions, suspense actions, notification suppression overrides, and recovery where required.

### A3 inputs

- Canonical Customer UUID and explicit internal source/destination account binding references.
- CustomerWallet, WalletAccount, and LedgerAccount IDs and ownership relationships.
- Currency, accounting unit, account type, normal balance, active state, source versions, control state, and reconciliation state.
- Read-only missing, stale, pending, suspended, repair-required, closed, and Ledger-unavailable states.
- No permission for A7 to repair or reassign an internal binding as part of a product command.

### A4 inputs

- Selected product capability/action policy decision.
- Policy/profile/version, decision reference, evidence snapshot, normalized input hash, expiry/review, reason codes, obligations, exact limits, and currentness/recovery result.
- A2 authorization-context reference and downstream recheck obligation.
- Explicit policy treatment for product counterparties, currencies, limits, and lifecycle states.

### A5 inputs

- Customer-aware command and correlation contract.
- Transfer/deposit/withdrawal/legacy-virtual-account lifecycle and pending/unknown outcome patterns.
- Ledger posting, account locking, journal correlation, settlement-account support, and compensating-entry boundaries.
- Operations idempotency, audit, outbox, metrics, diagnostics, readiness, retention, and request-context primitives.
- Pilot disable/stop-condition/rollback patterns, adapted so a product boundary cannot rewrite A5 history.
- Independent internal financial reconciliation evidence.

### A6 inputs

- Partner-adapter boundary, partner capability/version, and selected A6 partner for the first product.
- Provider request idempotency, reference uniqueness, callback authenticity, replay protection, and freshness.
- Settlement, suspense, compensating-entry, external reconciliation, and external-rail data minimization.
- Provider credentials, signing keys, callback secrets, and reference model.

### A7-specific inputs

- `CustomerPreference` (including `NotificationPreference`) as the customer intent authority for delivery.
- Existing `virtual-account` module metadata as a compatibility input, not as evidence of an A7 product boundary.
- Operations notification-related primitives: outbox for delivery intent, audit for delivery fact, idempotency for delivery deduplication.
- A1 ADR-0023/ADR-0024 identifier, privacy, retention, and external-sharing controls.
- Selected partner sandbox/certification contract (inherited from A6) and the A6 partner enablement state.

## 8. Sequential task breakdown

### A7T01 — Product Expansion Baseline and First-Product Selection

- **Type:** Documentation and architecture baseline
- **ADR input:** ADR-0054 — Virtual Account Product Boundary (proposed)

#### Objective

Inventory the current product-adjacent surfaces (existing `virtual-account` module, `CustomerPreference` notification intent, partner/scheme metadata, callback contract, settlement contract, suspense contract, public/support/reporting surfaces) and select one bounded first product—provider-backed virtual account—without treating existing metadata or routes as A7-approved behavior.

#### Deliverables

- `docs/A7-PRODUCT-EXPANSION-BASELINE.md`.
- Existing product-adjacent module and route inventory (virtual-account, customer-preference, payment, deposit, withdrawal, wallet, ledger, partner, reconciliation, support).
- Product candidate matrix covering direction, capability, currency, partner dependency, provider reference, callback, settlement, suspense, notification channel, public/support surface, prohibited adjacent products, and rollback assumptions.
- One selected A7 first product (provider-backed virtual account) with explicit internal command owner, partner dependency, currency, accounting unit, data fields, and prohibited adjacent products.
- Existing product-adjacent gap register, including notification delivery, public surface, and product preference enforcement.
- Product identifier, credential, secret, data-sharing, consent, retention, and legal-hold inventory.
- A7 dependency, risk, certification, stop-condition, product-rollback, and internal-history-preservation register.
- Compatibility classification for existing `virtual-account` module, `CustomerPreference.notifications`, and A6 partner/scheme metadata.

#### Acceptance criteria

- Exactly one bounded first product is selected for the implementation critical path, or implementation is blocked pending that selection.
- The selected product key, direction, currency, accounting unit, internal command owner, partner dependency, data fields, and prohibited adjacent products are explicit.
- Existing `virtual-account` module metadata is classified as compatibility input, not as evidence of an A7 product boundary.
- Existing `CustomerPreference.notifications` is classified as the customer intent authority; A7 will deliver, not redefine.
- A1, A2, A3, A4, A5, A6, Wallet, Ledger, Operations, Reconciliation, Finance, Security, Privacy, Support, and partner dependencies are mapped.
- No product, partner, callback, settlement, credential, schema, API, route, notification dispatcher, or runtime behavior is changed by this task.

#### Dependencies

- A2, A3, A4, A5, and A6 completed implementation artifacts.
- `docs/A6-A7-HANDOFF-PACKAGE.md`.
- `docs/A6-IMPLEMENTATION-PLAN.md` and `docs/A6-INTEGRATION-MATRIX.md`.
- Existing `virtual-account`, `customer-preference`, partner, and reconciliation inventories.
- A1 identifier, privacy, retention, and external-sharing inputs.

#### Explicitly out of scope

- Activating the first product, calling a partner for a new product flow, creating a second product, creating a new partner, exposing a public surface, dispatching a notification, or beginning a notification dispatcher implementation.

### A7T02 — A7 Product Catalog and Product-Boundary Contract

- **Type:** Documentation and runtime contract design
- **ADR:** ADR-0054 — Virtual Account Product Boundary (proposed)

#### Objective

Define the A7 product catalog, the shared product-boundary contract, and the product-extension points that keep product-specific behavior outside Customer, A2, A3, A4, A5, A6, Wallet, Ledger, and Operations authorities. Apply the boundary to the first selected product.

#### Deliverables

- `docs/ADR/ADR-0054-Virtual-Account-Product-Boundary.md` (proposed ADR range; ADR-0054 is reserved for the first product contract; A7T02 may also align with ADR-0055 if the catalog contract is split from the first-product contract in implementation).
- `docs/A7-PRODUCT-CATALOG-CONTRACT.md`.
- A7 product catalog with a single frozen registration for the first product (`virtual-account`/inbound/NGN/`CUSTOMER_FUNDS`) and an extension contract for future products.
- Product boundary interface and normalized product request/result/audit types.
- Product capability/version, accounting unit, currency, and internal-command-owner contract.
- Internal product-catalog consumer contract (Operations, A2, A4, A6 partner, and reporting) without changing their authorities.
- Product sandbox/fixture contract and product-independent catalog tests.
- Explicit boundary for product command, product acknowledgement, product callback, product reconciliation, and product notification.

#### Acceptance criteria

- Domain modules consume an explicit A7 product catalog and product-boundary contract rather than reaching into virtual-account, payment, wallet, ledger, or partner modules directly.
- A7 product requests carry an internal correlation chain and a distinct product command/operation identity.
- Product fields are schema-validated, bounded, classified, and mapped without using a product identifier or virtual-account string as Customer, Wallet, Ledger, command, or journal identity.
- Unsupported product capabilities, malformed product responses, wrong product versions, and unavailable product flows fail closed or enter a declared recovery state.
- Product catalog tests use deterministic fixtures and do not require live partner calls to prove the catalog contract.
- The contract does not post a journal, mutate a balance, repair a binding, change A4 policy/source records, or dispatch a notification.

#### Dependencies

- A7T01.
- A1 canonical ownership and identifier contracts.
- A2 protected service and secret boundary.
- A3 account-binding and ownership contract.
- A4 capability/action and currentness contract.
- A5 command/correlation, Operations, outbox, recovery, and reconciliation contracts.
- A6 partner-adapter, callback, settlement, suspense, and external reconciliation contracts.
- ADR-0003, ADR-0005, ADR-0008, ADR-0023, ADR-0024, ADR-0036, ADR-0047.

#### Explicitly out of scope

- Activating the first product, calling a partner for a new product flow, creating a second product, creating a notification dispatcher, exposing a public surface, or beginning any A7T03–A7T11 implementation.

### A7T03 — Product-Specific Policy Profile, Eligibility, and Limit Extension

- **Type:** Runtime policy-extension implementation
- **ADR inputs:** ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040 (reused under A4 authority) and the proposed ADR-0054

#### Objective

Extend the A4 capability/policy machinery with a product-specific profile, product eligibility, and product-limit/decision contract so the first product can request a policy decision without creating a second policy evaluator or duplicating A4 precedence.

#### Deliverables

- `docs/A7-PRODUCT-POLICY-PROFILE-CONTRACT.md`.
- A7 product-policy profile registration that points to the A4 profile registry and the first product's capability/action set.
- Product eligibility, restriction, product-limit, and product-obligation contract that defers precedence to A4.
- A4 re-evaluation trigger when product-level evidence (e.g., a partner-cleared virtual-account assignment) becomes available, without re-implementing A4 evaluator.
- Product policy version, profile hash, normalized input hash, expiry/review, and reason-code mapping.
- Reuse of A4 decision vocabulary (`ALLOW`/`ALLOW_WITH_LIMITS`/`PENDING_REVIEW`/`DENY`/`SUSPEND`).
- Product policy read and audit tests.

#### Acceptance criteria

- A4 remains the only authority for policy precedence; A7 does not invent a second evaluator.
- A7 product policy profiles are versioned, persisted via the A4 persistence contract, and replayable through the A4 history.
- A product decision cannot be used as A2 authentication, authorization, privileged approval, or A3 account binding.
- `ALLOW_WITH_LIMITS` carries explicit currency-labelled product limits and obligations; it never implies an amount or balance was approved implicitly.
- `PENDING_REVIEW`, `DENY`, and `SUSPEND` fail closed for product execution.
- Missing, stale, expired, contradicted, or unavailable product evidence produces a deterministic non-allow outcome.
- The product policy contract does not call a partner, dispatch a notification, or expose a public surface.

#### Dependencies

- A7T01 and A7T02.
- A4 evaluator, profile, evidence, persistence, recovery, and read contracts.
- A2 authorization and request-context contracts.
- A3 binding/read evidence contract.
- Operations audit, idempotency, and diagnostics primitives.

#### Explicitly out of scope

- Creating a second policy evaluator, mutating A4 source records, calling a partner, dispatching a notification, or implementing a public surface.

### A7T04 — Product Customer-Binding, Ownership, and Internal Account Mapping

- **Type:** Runtime consumer-boundary implementation
- **ADR inputs:** ADR-0031, ADR-0032, ADR-0033, ADR-0051 (reused) and the proposed ADR-0054

#### Objective

Define the product customer-binding, ownership, and explicit internal/external account mapping for the first product so the product never infers or repairs an A3 binding from product data, a virtual-account identifier, or a partner reference.

#### Deliverables

- `docs/A7-PRODUCT-CUSTOMER-BINDING-CONTRACT.md`.
- Product customer-binding consumer contract: virtual-account identifier, A3 internal account binding, customer UUID, partner identity, and provider-side reference mapping.
- Verification, ownership, status, expiry, consent/mandate, currency, limit, and product-purpose checks.
- Tokenized or reference-only handoff from the product to the A6 partner boundary.
- Explicit mapping matrix between canonical `Customer.id`, A3 binding, selected virtual account, A6 partner identity, and provider-side reference.
- Missing, stale, revoked, blocked, expired, mismatched, or unavailable virtual-account behavior.
- Product customer-binding, ownership, stale-version, privacy, and no-source-mutation tests.

#### Acceptance criteria

- A2 authorization and A4 policy are checked before a product customer-binding is admitted.
- A3 supplies the internal WalletAccount/LedgerAccount identity; A7 never chooses an internal account from a virtual-account identifier, preference value, partner reference, or product data.
- Only approved, owned, verified, current, purpose-compatible, and consented metadata can be passed to the product command.
- Raw PAN, account passwords, CVV, PIN, OTP, token secret, signing key, or equivalent credential material is never stored or copied into a general A7 command/event payload.
- A virtual-account or customer-binding status change causes a controlled denial, pending, or re-evaluation; it does not silently rewrite a product operation or internal financial history.
- A3 binding records are not mutated to make a product command pass.

#### Dependencies

- A7T01, A7T02, and A7T03.
- A2 authorization and privileged-action contracts.
- A3 binding/read/reconciliation contracts.
- A4 external capability policy, obligations, limits, and currentness result.
- Existing `customer-funding-instrument`, `customer-beneficiary`, `virtual-account`, `payment`, A5 command-correlation, and A6 partner contracts.
- ADR-0016, ADR-0017, ADR-0023, ADR-0024, ADR-0031, ADR-0032, ADR-0033, ADR-0051.

#### Explicitly out of scope

- Mutating A3 binding records, registering a new product, calling a partner beyond the A6 boundary, creating a notification dispatcher, or exposing a public surface.

### A7T05 — Product Command Identity, Lifecycle, and Idempotency

- **Type:** Runtime command and persistence contract implementation
- **ADR inputs:** ADR-0041, ADR-0044, ADR-0045, ADR-0049, ADR-0054 (proposed)

#### Objective

Define the durable product command identity, product operation record, request hashing, correlation, and product/provider idempotency behavior so the first product's command, partner reference, callback, settlement, and reconciliation evidence remain distinct and replay-safe.

#### Deliverables

- `docs/A7-PRODUCT-COMMAND-AND-IDEMPOTENCY-CONTRACT.md`.
- Versioned product command request/result contract.
- Internal product command, product operation, product/provider idempotency key, and request-hash contract.
- Same-key/same-payload replay and same-key/changed-payload conflict behavior for product commands.
- Provider-reference uniqueness and product-scoped reference mapping for product flows.
- Product operation persistence/migration package where a durable record is required.
- Operations audit, idempotency, outbox, metrics, diagnostics, and support-trace integration for product flows.
- Identity, replay, conflict, uniqueness, migration, and no-financial-side-effect tests.

#### Acceptance criteria

- `Customer.id`, internal command ID, A5 transfer/deposit/withdrawal ID, A6 external-operation ID, A7 product command ID, product operation ID, provider idempotency key, provider transaction/reference ID, callback event ID, journal ID, and outbox ID remain distinct.
- The normalized product request hash includes every field that changes the product effect and excludes transport-only values and secrets.
- An identical product retry returns the durable original product outcome or controlled pending state without a second uncontrolled provider or product effect.
- A changed payload under the same product or provider idempotency scope is rejected without financial mutation.
- A provider reference for a product flow is accepted only with the expected partner, operation, capability, customer/account mapping, currency, amount, and product state context.
- A product response or reference cannot by itself complete a Transfer, Deposit, Withdrawal, Ledger journal, or product financial effect.
- Expired idempotency retention never reuses an old product operation, provider reference, journal, or financial identity.

#### Dependencies

- A7T01-A7T04.
- A5 command/correlation, lifecycle, idempotency, outbox, recovery, and journal-correlation contracts.
- A6 external operation, partner idempotency, reference uniqueness, and callback contracts.
- Operations `IdempotencyService`, `AuditService`, `OutboxService`, and request-context primitives.
- ADR-0003, ADR-0008, ADR-0023, ADR-0044, ADR-0049.

#### Explicitly out of scope

- Implementing the product lifecycle states (A7T07), product financial effect (A7T08), notification delivery (A7T06), or public/support surfaces (A7T10).

### A7T06 — Notification Delivery Infrastructure and Preferences Enforcement

- **Type:** Runtime notification infrastructure implementation
- **ADR:** new ADR in the proposed A7 range (resolves the first product's notification contract)

#### Objective

Implement the A7 notification delivery infrastructure that consumes approved `CustomerPreference.notifications` and the A6T10 / A7T10 data-classification matrix without creating a new customer intent, consent, or notification authority.

#### Deliverables

- `docs/A7-NOTIFICATION-DELIVERY-CONTRACT.md`.
- Notification delivery boundary: dispatcher, channel selection (in-app, email, SMS, push), template reference, audience policy, and deduplication contract.
- Notification event identity, correlation chain, preference reference, and minimal payload contract.
- `CustomerPreference.notifications` read contract (the customer intent authority remains the existing `customer-preference` module; A7 does not invent a parallel preference store).
- Bounded retry, suppression, manual-review, and unknown-outcome delivery states.
- A2 audience/authorization enforcement for any internal control surface.
- Operations audit, idempotency, outbox, and diagnostics integration for delivery facts.
- Sensitive-data, redaction, consent, access-scope, retention, and no-secret-leakage tests.
- No public, mobile, web, partner, or push provider is wired by A7T06; A7T06 establishes the delivery boundary and the outbox contract only.

#### Acceptance criteria

- A7 does not create a new customer intent, consent, or preference record. It reads from `CustomerPreference.notifications` and writes only delivery facts through Operations.
- Notification payloads are minimized and do not include raw credentials, signatures, full risk/compliance content, or unnecessary customer data.
- A notification never becomes a financial command, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.
- A delivery retry, suppression, manual-review, and unknown-outcome state is explicit and support-traceable.
- Delivery audit uses the shared `AuditService`; delivery deduplication uses the shared `IdempotencyService`; delivery intent uses the shared `OutboxService`.
- A notification preference change does not retroactively rewrite past delivery decisions.
- A7T06 introduces no public, mobile, web, or partner channel implementation; only the dispatcher boundary, the outbox contract, and the audit/idempotency integration are committed.

#### Dependencies

- A7T01 and A7T02.
- Existing `customer-preference` module (intent authority), `NotificationPreference` entity, and preference history.
- A2 protected route, audience, secret, security-event, and route/data-exposure contracts.
- A6T10 / A7T10 data classification, retention, legal-hold, and disclosure contracts.
- Operations `AuditService`, `IdempotencyService`, `OutboxService`, request context, and diagnostics primitives.

#### Explicitly out of scope

- Implementing a live email, SMS, push, or web-channel provider; exposing a public or customer channel; storing customer consent beyond the existing `CustomerPreference` and A6T10 / A7T10 contracts; or invoking the product lifecycle (A7T07), product financial effect (A7T08), or public/support surface (A7T10).

### A7T07 — Product Lifecycle, Retry, Manual Review, and Unknown Outcomes

- **Type:** Runtime resilience and lifecycle implementation
- **ADR inputs:** ADR-0045, ADR-0047, ADR-0049, and the proposed A7 range

#### Objective

Represent and recover product commands across assignment, partner acknowledgement, callback/report waiting, timeout, retry, outage, rate limit, rejection, settlement-pending, manual-review, and unknown outcomes without creating duplicate product or financial effects or duplicating the A6 lifecycle authority.

#### Deliverables

- Product lifecycle state vocabulary and transition guards (extending, not replacing, the A6 lifecycle vocabulary where applicable).
- Durable product lifecycle fields for product command, customer/account, A4 product-policy, funding/target, partner, provider reference, callback, settlement, journal, failure, recovery, and reconciliation references.
- Migration and rollback package where product lifecycle persistence requires schema changes.
- Bounded product retry policy distinguishing safe transport retry, partner rejection, rate limit, timeout, status-query, and ambiguous commit outcomes.
- Manual-review and hold states for unresolved product, partner, callback, statement, or settlement evidence.
- Lifecycle, concurrency, retry, timeout, outage, replay, unknown, and no-duplicate-effect tests.

#### Acceptance criteria

- Every product command has a durable state and canonical internal correlation before or atomically with the outbound intent.
- A partner timeout or connection failure is not interpreted as product success or rejection without approved evidence.
- Product retries preserve the same logical operation, partner idempotency identity, customer/account pair, amount, currency, and product capability context.
- A provider-accepted or potentially committed product is verified through the supported A6 status/callback/report/reconciliation path before a new submission decision.
- Unknown, pending, manual-review, and failed product outcomes are truthful, support-traceable, and cannot trigger blind financial retry.
- Product lifecycle transitions cannot clear a partner reference, journal reference, settlement reference, or recovery reference without an approved correction/recovery boundary.
- No unbounded retry loop, unowned scheduler, or local product idempotency/audit store is introduced.
- The A6 lifecycle authority is not duplicated; the product lifecycle reuses or extends A6 vocabulary and transitions through A6T07 boundaries.

#### Dependencies

- A7T01-A7T05.
- A5 lifecycle, unknown-outcome, retry, outbox, Ledger, reconciliation, and pilot-disable patterns.
- A6 lifecycle, retry, circuit-breaker, status-verification, and unknown-outcome recovery patterns.
- Operations metrics, diagnostics, readiness, idempotency, audit, and request-context contracts.
- Selected A6 partner timeout, status-query, rate-limit, and outage behavior.

#### Explicitly out of scope

- Settlement accounting, automatic suspense resolution, dispute/chargeback products, public status APIs, or any A7T08 / A7T09 / A7T10 implementation.

### A7T08 — Product Financial Effect, Settlement, and Ledger Integration

- **Type:** Runtime financial integration and control implementation
- **ADR inputs:** ADR-0043, ADR-0050, and the proposed A7 range

#### Objective

Post only verified product financial outcomes through the existing Ledger boundary and represent unmatched, delayed, disputed, or ambiguous product value through approved suspense, compensating, or exception controls. Reuse the A6 settlement, suspense, and compensating-entry contracts where the product depends on the A6 partner.

#### Deliverables

- `docs/A7-PRODUCT-FINANCIAL-EFFECT-CONTRACT.md`.
- Product event-to-Ledger journal/line mapping for the first product.
- Approved product settlement, clearing, suspense, and customer-funds account dimensions where required by Finance/Ledger.
- Double-entry, currency, accounting-unit, account-state, balance, lock, and journal-correlation contract for the first product.
- Product operation-to-settlement-to-journal correlation and idempotency mapping.
- Suspense entry, aging, hold, release, manual-review, exception-owner, and compensating-entry contract reused from A6T08.
- Provider rejection, duplicate settlement, unmatched report, partial settlement, currency mismatch, amount mismatch, and ambiguous-finality behavior.
- Financial invariant, settlement idempotency, suspense, rollback/disable, and no-direct-write tests for the first product.

#### Acceptance criteria

- Ledger remains the only authority for posted financial value, settlement accounts, suspense balances, journals, lines, and compensating entries.
- A product command, partner acknowledgement, callback, or external reference cannot create product financial value without the approved evidence and execution boundary.
- One verified product outcome produces at most one correlated Ledger effect for the logical operation.
- Product settlement and suspense entries are balanced, currency-labelled, accounting-unit-compatible, and subject to Ledger account and lock invariants.
- Unmatched, delayed, disputed, partially verified, or ambiguous product value enters an explicit suspense or manual-review state rather than being silently credited, debited, or cleared.
- Corrections and reversals use new approved compensating Ledger entries and never mutate posted journals, lines, balances, or completed A5/A6 records.
- Disabling the product or its A6 partner dependency stops new admission/submission without rewriting completed product, settlement, or financial history.

#### Dependencies

- A7T03, A7T04, A7T05, and A7T07.
- A3 internal account binding and A5 Ledger/journal/correction contracts.
- A6 partner settlement, suspense, compensating-entry, and external-reconciliation contracts.
- Existing `LedgerService`, `SettlementAccountService`, payment references, financial invariant tests, and Operations primitives.
- Finance/Ledger-approved chart and settlement/suspense dimensions for the first product.
- ADR-0002, ADR-0004, ADR-0005, ADR-0008, ADR-0043, ADR-0044, ADR-0050.

#### Explicitly out of scope

- Ledger redesign, unauthorized chart expansion, FX, fees/commissions, savings interest, lending, customer credit beyond approved product limits, automatic suspense clearing, or external financial correction outside Ledger/Finance ownership.

### A7T09 — Independent Product Reconciliation, Certification, and Support Trace

- **Type:** Runtime control, reconciliation, and support implementation
- **ADR inputs:** ADR-0005, ADR-0008, ADR-0050, ADR-0053, and the proposed A7 range

#### Objective

Independently compare product commands, A6 partner responses, callbacks, statements/reports, product operations, settlement/suspense, Ledger journals, audit, outbox, and internal lifecycle evidence without repairing source records, and classify any discrepancy.

#### Deliverables

- `docs/A7-PRODUCT-RECONCILIATION-CONTRACT.md`.
- Product-to-A6-partner-to-settlement-to-journal reconciliation query/report for the first product.
- Independent checks for product key, capability, partner reference, callback authenticity/receipt, product state, internal customer/account mapping, amount, currency, accounting unit, journal correlation, settlement/suspense, idempotency, audit, outbox, and statement/report completeness.
- Discrepancy vocabulary for missing/duplicate/mismatched product operations, callback replay, orphan product operations, missing/duplicate settlement, amount/currency mismatch, stale reports, suspense aging, partner outage, and unresolved unknown outcomes.
- Classified support trace containing canonical internal IDs, partner/provider references, product operation, callback, settlement, journal, suspense, audit, outbox, and reconciliation references.
- Product certification fixtures and evidence for the first product across happy path, rejection, duplicate, callback replay, delayed report, outage, timeout, settlement mismatch, suspense, and rollback cases.
- Read-only, drift, failure, unknown-outcome, report-unavailable, and no-repair tests.

#### Acceptance criteria

- Reconciliation queries source tables and approved provider/report evidence independently of product command write methods, A6 partner write methods, and settlement write methods.
- A provider report or callback without a valid product operation, or an internal product settlement without valid provider evidence, is reported as a controlled discrepancy.
- Customer/account ownership, partner/capability mapping, product state, amount, currency, accounting-unit, status, reference, and journal mismatches are explicit.
- Duplicate, delayed, out-of-order, missing, or replayed product facts cannot create a second financial effect or be silently discarded.
- Reconciliation never updates Customer, preferences, A3 bindings, Wallet, Ledger, product, audit, outbox, policy, or source partner records to make a report pass.
- Support can trace the product operation without exposing secrets, raw callback signatures, full funding credentials, unrestricted risk/compliance data, or unnecessary customer data.
- Product certification evidence identifies the exact product/contract/version and is separate from production activation evidence.

#### Dependencies

- A7T05-A7T08.
- Existing A3/A5/A6 reconciliation, Operations audit/idempotency/outbox/diagnostics, Ledger, payment-reference, and support-trace contracts.
- Selected A6 partner statement/report and reconciliation capabilities.
- A1 data classification, retention, legal-hold, and support-access controls.

#### Explicitly out of scope

- Automatic source repair, automatic suspense clearing, provider-side correction, external dispute resolution, production certification sign-off, customer-facing reporting channels, and any A7T10 implementation.

### A7T10 — Product Data Minimization, Consent, Classification, Retention, Secret, and Disclosure Controls

- **Type:** Documentation, privacy, security, and runtime data-boundary implementation
- **ADR inputs:** ADR-0024, ADR-0052, and the proposed A7 range

#### Objective

Ensure that A7 shares, stores, logs, traces, retains, and exposes only the minimum approved customer, product, preference, financial, provider, credential, risk, compliance, and consent evidence required by the first product and by the shared product-expansion infrastructure. Reuse the A6T10 data-classification matrix and the A1 privacy/retention controls; do not invent a parallel privacy authority.

#### Deliverables

- `docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md`.
- Product data-field inventory and partner/preference/support-sharing matrix.
- Consent/mandate/terms evidence contract for the first product and its notification surface.
- Field-level classification, redaction, encryption/tokenization, access, retention, deletion, and legal-hold rules for product flows.
- Product request/response/callback/outbox/audit/diagnostic/support/notification payload minimization contract.
- Credential, certificate, signature, token, and secret handling/rotation boundary reused from A6T10.
- Customer/internal/support disclosure, correction, and incident-preservation contract without implementing notification delivery (delivery is A7T06; classification is A7T10).
- Sensitive-data, redaction, consent, access-scope, retention, and no-secret-leakage tests for the first product and the shared infrastructure.

#### Acceptance criteria

- The first product receives only approved fields for the selected capability, purpose, jurisdiction, and lifecycle state.
- Consent or mandate evidence is explicit, current, purpose-bound, revocable where applicable, and distinct from A2 authorization, A4 policy eligibility, and `CustomerPreference` intent.
- Raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, and unnecessary identity documents are excluded from general product records, notification payloads, and observability.
- Product payloads and external references are classified and retained according to the A6T10 / A7T10 matrix; ordinary cleanup cannot delete held evidence.
- Support, Operations, Reconciliation, and notification views use minimum necessary fields and approved audience controls.
- A product data-sharing, consent, or preference failure fails closed or enters a declared manual-review state; it never defaults to product transmission or notification dispatch.
- A7 does not create a new customer identity, consent, preference, product, compliance, risk, authorization, or notification authority.

#### Dependencies

- A7T01-A7T09.
- A1 ADR-0023/ADR-0024 identifier, privacy, retention, legal-hold, and external-sharing inputs.
- A2 secret, route, audience, privileged-access, and security-event contracts.
- A3 account ownership and A4 policy/obligation contracts.
- A6T10 data classification matrix and external-rail data controls.
- `CustomerPreference` and `NotificationPreference` intent authority.

#### Explicitly out of scope

- Legal approval itself, customer portal/mobile disclosure screens, marketing consent, general data-platform redesign, A7T11 release-gate, A8 scale/extraction, and any notification delivery implementation (A7T06 owns delivery).

### A7T11 — A7 Integration, Product Certification, Release Gate, and A8 Handoff

- **Type:** Integration and phase-exit evidence
- **ADR review:** the proposed A7 ADR range (the same range as the A7 plan reserves for product and infrastructure ADRs)

#### Objective

Validate the complete A7 shared product-expansion infrastructure and the first bounded product, and prepare the A7 release gate and A8 handoff without beginning A8 scale/extraction or broad product activation.

#### Deliverables

- `docs/A7-INTEGRATION-MATRIX.md`.
- `docs/A7-ROUTE-EXPOSURE-AND-ROLLBACK.md`.
- `docs/A7-ADR-REVIEW-STATUS.md`.
- `docs/A7-OPERATIONAL-RECOVERY-RUNBOOK.md`.
- `docs/A7-EXIT-CHECKLIST.md`.
- `docs/A7-APPROVAL-PACKAGE.md`.
- `docs/A7-A8-HANDOFF-PACKAGE.md`.
- End-to-end identity-to-customer-binding-to-product-policy-to-product-command-to-A6-partner-to-callback/report-to-settlement/suspense-to-Ledger-to-outbox-to-reconciliation trace for the first product.
- Product sandbox/certification evidence for product command, product validation, product idempotency, callback authenticity, replay, duplicate, outage, timeout, status verification, settlement, suspense, reconciliation, data minimization, notification delivery (fixture-based only), and rollback.
- Product operation, provider reference, callback, settlement, suspense, journal, audit, outbox, notification, and reconciliation correlation evidence.
- Route/data-exposure, credential, disable, product rollback, internal financial-history preservation, notification suppression override, and support recovery evidence.
- A8 entry conditions and prohibited-edge register.

#### Acceptance criteria

- The first selected product maps to A2 authorization, A3 binding, A4 policy, A5 command/ledger/Operations patterns, the A6 partner boundary, the A7 product command, the A7 notification dispatcher, the A7 product reconciliation, and the A7 product data controls.
- One verified product command produces at most one traceable internal financial effect and one approved internal operational fact where the selected flow requires it.
- Duplicate, changed-payload, partner-rejected, callback-replayed, delayed, out-of-order, timed-out, circuit-open, unavailable, unknown, and product-disabled operations have deterministic safe outcomes.
- Product settlement and suspense evidence reconciles to the A6 partner/statement evidence and Ledger without direct source mutation.
- Support can trace a product operation while provider credentials, callback secrets, raw funding data, preference data, and unrestricted risk/compliance data remain protected.
- Disable/circuit-breaker/product-rollback controls stop new product activity without rewriting completed A5, A6, or Ledger history.
- Product-specific logic is isolated from canonical Customer, A2, A3, A4, A5, A6, Wallet, Ledger, Operations, and Reconciliation authorities.
- The notification dispatcher honours `CustomerPreference.notifications` and the A6T10 / A7T10 data controls; it cannot be repurposed as an A2 authorization, A3 binding, A4 policy, or Ledger record.
- No unapproved second product, second partner, public API, mobile/web channel, broad customer activation, A8 extraction, or production rollout is included.
- All unresolved implementation risks have an owner, severity, mitigation, stop condition, certification requirement, and rollback/disable behavior.
- A8 handoff conditions are explicit and do not claim that A7 proves all future scale, regional, capacity, or extraction behavior.

#### Dependencies

- A7T01-A7T10.
- A1-A6 phase artifacts and handoff packages.
- Existing `virtual-account`, `customer-preference`, partner, payment, deposit, withdrawal, Wallet, Ledger, Operations, and Reconciliation modules.
- Selected A6 partner sandbox/certification evidence.
- Finance/Ledger, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, and partner review inputs.

#### Explicitly out of scope

- A8 Scale & Selective Extraction.
- Public APIs, mobile/web channels, marketing consent, broad customer activation, additional products, additional partner onboarding, A8 extraction, and production rollout beyond the separately approved release boundary.

## 9. A7 critical path

```text
A7T01 Product expansion baseline and first-product selection
  -> A7T02 A7 product catalog and product-boundary contract
  -> A7T03 Product-specific A4 policy profile and limit extension
  -> A7T04 Product customer-binding, ownership, and internal account mapping
  -> A7T05 Product command identity, lifecycle, and idempotency
  -> A7T06 Notification delivery infrastructure and preferences enforcement
  -> A7T07 Product lifecycle, retry, manual review, and unknown outcomes
  -> A7T08 Product financial effect, settlement, and Ledger integration
  -> A7T09 Independent product reconciliation and support trace
  -> A7T10 Product data minimization, consent, and disclosure controls
  -> A7T11 A7 integration, product certification, release gate, and A8 handoff
```

A7T01 must select the single first product before any product-specific implementation. A7T02 and A7T03 may be designed in parallel after A7T01, but no product command may be admitted before the product catalog, product-boundary contract, and product-policy profile are defined. A7T04 and A7T05 may be designed together because product customer-binding, product command identity, and A6 partner reference must remain one correlation contract. A7T06 (notification delivery) can be designed in parallel with A7T05 after A7T02, but no notification may be dispatched before A6T10 / A7T10 classification and the existing `CustomerPreference.notifications` intent authority are honored. A7T07 must be designed before any retry or callback can advance a product financial lifecycle. A7T08 cannot post a product financial effect or suspense value until A7T05–A7T07 establish verified product outcomes. A7T09 may prepare independent product queries alongside A7T05–A7T08 but cannot pass until product operation and settlement records exist. A7T10 must pass before any product payload, notification payload, or callback evidence is accepted. A7T11 is blocked until all selected-first-product evidence is complete. A8 remains outside A7.

## 10. A7 integration trace

```text
A2 authenticated principal / protected internal command context
                         |
                         v
A4 current product capability decision (A7T03)
  capability/action + policy version + product limits + obligations + expiry
                         |
                         v
A3 internal account/customer-binding recheck (A7T04)
  Customer.id -> CustomerWallet -> A3 binding -> WalletAccount -> LedgerAccount
  -> A7 product customer-binding map (virtual-account identifier, partner identity, provider-side reference)
                         |
                         v
A7 product command (A7T05)
  internal product command/operation ID
  A4 product policy reference + A3 binding reference + A6 partner dependency
  amountMinor + currency + accountingUnit
  product idempotency + provider idempotency + correlation/causation
                         |
                         v
A7 product catalog and product-boundary contract (A7T02)
  approved product/contract/version
  normalized product request/result envelope
                         |
                         v
A6 partner adapter and isolated transport (reused from A6)
  approved A6 partner/capability/version
  authenticated request + provider reference/acknowledgement
                         |
                         v
A7 product lifecycle (A7T07) reusing A6 lifecycle vocabulary
  submitted / pending / retry / unknown / manual review / settled / failed
                         |
                         v
A6 callback authenticity, replay, and freshness (reused from A6)
  callback event identity + provider reference + replay state
                         |
                         v
A7 product financial effect, settlement, and Ledger integration (A7T08)
  verified product decision
  Ledger-owned journal/lines
  suspense or controlled exception where finality/matching is unresolved
                         |
                         v
A7 notification dispatcher (A7T06) under CustomerPreference.notifications
  delivery intent (outbox) -> delivery fact (audit) -> deduplication (idempotency)
  sensitive-payload redaction (A6T10 / A7T10)
                         |
                         v
Operations and independent control evidence
  audit + idempotency + transactional outbox
  A6 partner/internal references + A7 product operation + A7 notification + support trace
  A7 independent product reconciliation (A7T09) + discrepancy owner
                         |
                         v
A7 release control
  product disable + A6 circuit-breaker + rollback
  internal financial history preserved
```

A7 is a product-expansion boundary, not a replacement for A2 authentication/authorization, A3 binding, A4 policy, A5 internal lifecycle, A6 partner, Wallet, Ledger, Operations, or Reconciliation. A product event, preference value, product command ID, partner reference, or notification delivery record cannot become financial truth, A2 authorization, A3 binding, A4 policy, or customer intent without the owning boundary's verification.

## 11. A7 prohibited edges

- A7 treats a product event, partner response, callback, statement, provider reference, preference value, notification delivery record, or outbox fact as canonical Customer identity, A2 authorization, A3 binding, A4 policy, or Ledger truth.
- A7 selects a WalletAccount/LedgerAccount from a customer reference, virtual-account identifier, preference value, partner reference, or product data.
- A7 writes Customer, CustomerWallet, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, funding-instrument ownership, beneficiary ownership, A3 binding, A4 policy/source, or `CustomerPreference` records to make a product pass.
- A7 embeds a second risk, compliance, sanctions, fraud, eligibility, restriction, or limit precedence engine.
- A7 calls a bank/NIBSS/provider, an SMS provider, an email provider, a push provider, or any external channel from Customer, Wallet, Ledger, A5, A6, Reconciliation, diagnostics, readiness, support, or an unapproved controller instead of the isolated A6 partner boundary or the A7 notification dispatcher.
- A7 accepts an unauthenticated, stale, replayed, malformed, wrong-partner, wrong-environment, or wrong-product callback or notification.
- A7 retries an ambiguous product outcome with a new product, partner, or financial identity without verified A6 partner status/reconciliation evidence.
- A7 posts a journal, mutates a balance, clears suspense, or edits a posted journal/line outside Ledger and Finance-approved correction boundaries.
- A7 treats a partner acknowledgement or product event as settled value or credits/debits a customer before the approved settlement evidence exists.
- A7 creates an independent product-reference, settlement, suspense, audit, idempotency, outbox, metrics, diagnostics, notification intent, or reconciliation authority.
- A7 stores raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, unrestricted risk/compliance content, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.
- A7 exposes a public customer, mobile, web, or partner API merely because a product contract or notification dispatcher exists; A2 route/data controls remain required.
- A7 adds bills/airtime, QR/merchant, agent/assisted, card, bulk/payroll, savings, credit, FX, fees, commissions, product pricing, marketing consent, or other product expansion unless a separate reviewed capability plan explicitly adds one of them.
- A7 broadens the selected first product, the A6 partner dependency, or the customer cohort without a separate capability decision and release boundary.
- A7 mutates completed A5 transfer/deposit/withdrawal history, A6 settlement history, or Ledger history to reconcile a product, partner, or notification discrepancy.
- A7 converts a notification delivery into a financial command, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.
- A7 begins A8, public APIs, mobile/web channels, marketing consent, broad customer activation, product expansion beyond the first selected product, or service extraction.

## 12. A7 phase exit criteria

A7 implementation is complete only when:

- The first selected product has an explicit product key, capability, currency, data, consent, internal command, partner dependency, prohibited-edge, and notification/support/reporting contract.
- The A7 product catalog and product-boundary contract are stable and prevent product-specific behavior from becoming a source authority in canonical modules.
- Product-specific A4 policy profiles are versioned, replayable, and governed by A4 precedence.
- Product customer-binding and internal account mapping never infer or repair A3 bindings from product data, virtual-account identifiers, or partner references.
- Product command, product operation, partner reference, callback event, internal command, idempotency, journal, settlement, suspense, audit, outbox, notification, and reconciliation identifiers remain distinct and queryable.
- Notification delivery honors `CustomerPreference.notifications` and the A6T10 / A7T10 data controls; the dispatcher cannot become an A2, A3, A4, or Ledger authority.
- Product retries, manual review, status verification, outages, and unknown outcomes are bounded, support-traceable, and reuse A6 lifecycle vocabulary where applicable.
- Verified product outcomes create at most one balanced Ledger-owned financial effect, or enter explicit pending/suspense/manual-review/reconciliation state.
- Suspense, exception, reversal, and correction behavior preserves immutable Ledger history and assigns ownership without automatic source repair.
- Independent product reconciliation detects missing, duplicate, orphan, delayed, mismatched, stale, and unresolved product/partner/settlement evidence without writing source records.
- Product certification fixtures and tests cover product command, callback, replay, duplicate, outage, timeout, status query, settlement, suspense, reconciliation, data minimization, notification delivery (fixture-based only), and rollback behavior.
- Data sharing, consent, retention, legal-hold, secret, support, and customer/internal disclosure controls are explicit and tested at the selected boundary.
- Disable and rollback controls stop new product and notification activity without rewriting A5, A6, or Ledger financial history.
- A1, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, Outbox, Reconciliation, and `CustomerPreference` authorities remain separate.
- No A8 scale/extraction, public API, notification channel implementation, mobile/web channel, marketing consent, unapproved second product, unapproved second partner, or broad customer activation is included.
- A7-to-A8 handoff is documented without claiming that A7 proves future scale, regional, capacity, or extraction behavior or broad production activation.

## 13. A7 handoff to A8

A7 may provide later phases with:

- the A7 product catalog, product-boundary contract, and product-extension contract;
- product-specific A4 policy profiles and the shared A4 authority boundary;
- product customer-binding, ownership, and internal/external account mapping;
- product command identity, product operation, product/provider idempotency, and request-hash patterns;
- the A7 notification dispatcher, the A7T06 delivery intent/fact/deduplication contract, and the A6T10 / A7T10 data controls;
- A7 product lifecycle, retry, manual review, status-verification, and unknown-outcome recovery patterns;
- A7 product settlement, suspense, compensating-entry, and internal correlation patterns;
- independent A7 product reconciliation, statement/report, discrepancy, certification fingerprint, and support-trace patterns;
- A7 product data minimization, consent, classification, retention, secret, and access controls; and
- A7 product disable, rollback, and internal-history-preservation evidence.

A7 must not provide later phases with:

- bank, NIBSS, partner, SMS, email, push, or other external credentials, tokens, certificates, signing keys, callback secrets, partner confidential material, or unrestricted risk/compliance evidence;
- raw KYC, risk, compliance, investigative, security, device, support-restricted, or customer PIN/OTP payloads;
- mutable balances, posted journal/line data as a new source of truth, or financial correction authority;
- permission to treat an outbox event, payment reference, command ID, provider reference, callback ID, external reference, product reference, notification delivery record, or suspense row as Ledger truth;
- permission to bypass A2 authorization, A3 binding, A4 policy, A5 internal lifecycle, A6 partner, A7 product, Ledger, Operations, or Reconciliation controls;
- permission to infer an internal account, product customer-binding, or `CustomerPreference` from external data, partner response, or product data;
- a claim that the first selected product proves all product reliability, partner reliability, settlement finality, or notification delivery reliability;
- a second product, second partner, public route, mobile/web/partner API, marketing consent, or product catalogue;
- permission to mutate completed A5 transfer, A6 settlement, A6 suspense, A6 journal, A7 product operation, or Ledger history for product, partner, or notification correction;
- permission to skip A8 scale, regional, capacity, extraction, or operational review;
- permission to treat fixture-based product certification as live A6 partner or live notification delivery; and
- ADR-0048 itself is not part of A7; it is the A6T03 decision record and must be authored/approved before any partner-specific transport / credential / signing / key-rotation evidence is claimed, irrespective of A7 progress.

A8 remains responsible for scale, regional resilience, capacity, service-extraction criteria, event-contract ownership and schema evolution, and regional data and failover strategy. A8 may not begin implementation until the A7 release gate and the A7-to-A8 handoff are independently approved.

## 14. A7 plan verification record

- [x] Official phase title is A7 — Product Expansion Infrastructure.
- [x] A7 is positioned after A6 and before A8.
- [x] A7 requires one bounded first product (provider-backed virtual account) instead of an implicit multi-product catalogue.
- [x] A1, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Security, Privacy, Support, partner, and `CustomerPreference` dependencies are explicit.
- [x] Product catalog and product-boundary contract keep product-specific behavior outside canonical authorities.
- [x] Product-specific A4 policy profiles extend, not replace, A4 precedence.
- [x] Product customer-binding and internal account mapping never infer or repair A3 bindings from product data.
- [x] Notification delivery honors `CustomerPreference.notifications` and the A6T10 / A7T10 data controls; it is not a new consent, preference, or financial authority.
- [x] Product lifecycle, retry, manual review, status verification, and unknown outcomes reuse A6 vocabulary where applicable.
- [x] Verified product outcomes create at most one balanced Ledger-owned financial effect, or enter explicit pending/suspense/manual-review/reconciliation state.
- [x] Independent product reconciliation is read-only with respect to all source records.
- [x] Data minimization, consent, classification, retention, legal-hold, secret, and disclosure controls are explicit and consistent with A6T10.
- [x] A7 prohibited edges, rollback/disable boundaries, A8 handoff, and A8 exclusion are explicit.
- [x] Proposed A7 ADR range is documented and does not renumber existing ADRs (ADR-0053 is already used by A6T09; the proposed A7 range is ADR-0054 through ADR-0060).
- [x] No application source, entity, migration, service, controller, API, route, scheduler, notification dispatcher, public channel, product, financial behavior, or runtime activation is created by this planning task.

## 15. A7T11 plan evidence record (placeholder)

A7T11 will record:

- [ ] `docs/A7-INTEGRATION-MATRIX.md` records the end-to-end task-to-evidence matrix and the A2 → A4 → A3 → A6 → A7T05 → A7T07 → A7T08 → A7T09 trace for the first selected product.
- [ ] `docs/A7-ROUTE-EXPOSURE-AND-ROLLBACK.md` records A7 product disable, notification disable, A6 circuit-breaker, environment emergency-stop, and rollback-safe procedure; the `partner-callback.controller` remains an A2-protected internal surface, no new public route is approved, and no new notification channel is approved.
- [ ] `docs/A7-ADR-REVIEW-STATUS.md` reviews the proposed A7 ADR range against committed implementation evidence and records any ADR in the proposed A7 range that is not yet authored as a release-gate blocker.
- [ ] `docs/A7-OPERATIONAL-RECOVERY-RUNBOOK.md` records operating principles, evidence sources, incident classification, recovery procedure, decision matrix, support-trace contract, and ownership / stop conditions for the first selected product and the shared product-expansion infrastructure.
- [ ] `docs/A7-EXIT-CHECKLIST.md` records the A7 acceptance checklist, unresolved blockers, and the explicit A7 phase result.
- [ ] `docs/A7-APPROVAL-PACKAGE.md` records the owner approval register, no-go recommendation, go conditions, and explicit non-claims.
- [ ] `docs/A7-A8-HANDOFF-PACKAGE.md` records the bounded handoff to A8, the prohibited edges, the A8 entry conditions, and the blocked handoff status.
- [ ] Local automated validation passes: `npm test`, `npm run lint`, `npm run build`, `npm run format:check`.
- [ ] A7T11 introduces no application source, entity, migration, service, controller, API, route, scheduler, notification dispatcher, public channel, product, financial behavior, or runtime activation.
- [ ] A7T11 does not begin A8 or any product-roadmap expansion beyond the first selected product.
