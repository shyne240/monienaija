# B2 Customer Activation and Public Commercial Platform — Implementation Plan

> **Superseded-for-sequencing notice (2026-08-09):** This is the historical plan that produced the preserved B2T01–B2T10 artifacts. It no longer defines the authoritative B2 platform. B2 is now Finance Platform under [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md); completed artifacts are classified in [`PLATFORM-ARTIFACT-CLASSIFICATION.md`](PLATFORM-ARTIFACT-CLASSIFICATION.md). Historical B2T11 and B2T12 **must not be executed**. Existing identifiers, migrations, ADRs, contracts, events, scopes, source, and tests remain unchanged.

- **Phase:** Historical B2 label — Customer Activation and Public Commercial Platform
- **Status:** Planned
- **Scope:** Customer-facing commercial activation (customer, merchant, and agent onboarding, commercial activation workflows, public API exposure and authentication, API consumers, webhook registration/delivery/verification, developer onboarding, API credentials, sandbox, API documentation, API versioning, API quotas, rate limiting, customer consent and marketing consent, public commercial routes, commercial self-service, activation rollback, and production readiness) built on the frozen B1 commercial foundation
- **Implementation order:** Architecture phase after the completed A1 Foundation Consolidation, A2 Runtime Identity & Access, A3 Customer-to-Financial Account Binding, A4 Capability & Policy Engine, A5 Internal Financial Pilot, A6 External Partners & Settlement, A7 Product Expansion Infrastructure, and B1 Commercial Platform
- **Number of implementation tasks:** 12
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`PHASES.md`](PHASES.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md), [`B1-IMPLEMENTATION-PLAN.md`](B1-IMPLEMENTATION-PLAN.md), [`B1-EXIT-CHECKLIST.md`](B1-EXIT-CHECKLIST.md), [`B1-B2-HANDOFF-PACKAGE.md`](B1-B2-HANDOFF-PACKAGE.md), [`B1-APPROVAL-PACKAGE.md`](B1-APPROVAL-PACKAGE.md), [`B1-INTEGRATION-MATRIX.md`](B1-INTEGRATION-MATRIX.md), [`B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md`](B1-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md), [`A7-IMPLEMENTATION-PLAN.md`](A7-IMPLEMENTATION-PLAN.md), [`A6-IMPLEMENTATION-PLAN.md`](A6-IMPLEMENTATION-PLAN.md), [`A5-IMPLEMENTATION-PLAN.md`](A5-IMPLEMENTATION-PLAN.md), [`A4-IMPLEMENTATION-PLAN.md`](A4-IMPLEMENTATION-PLAN.md), [`A3-IMPLEMENTATION-PLAN.md`](A3-IMPLEMENTATION-PLAN.md), [`A2-IMPLEMENTATION-PLAN.md`](A2-IMPLEMENTATION-PLAN.md), [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md)
- **Proposed B2 ADR range:** ADR-0072 through ADR-0083 (ADR-0061 through ADR-0069 is already used by B1; ADR-0070 through ADR-0071 is reserved for B1 expansion; ADR-0054 through ADR-0060 is already used by A7; ADR-0053 is already used by A6T09; ADR-0047 through ADR-0052 is already used by A6; B2 reserves the next contiguous range. Each B2T task may own one ADR; subsequent B2 expansions, B3, or later phases will require their own ADR in a later range or extension of this one and are out of scope for this plan.)

This document is a planning artifact only. It creates no application source, entity, migration, service, controller, API, route, scheduler, credential, secret, webhook, sandbox, public surface, commercial activation, or runtime behavior.

## 1. Official phase title

**B2 — Customer Activation and Public Commercial Platform**

B2 is an Architecture phase and is not a Product Roadmap milestone. It introduces the customer-facing activation layer that exposes the frozen B1 commercial foundation through governed public APIs, authenticated access, and controlled webhook delivery, after A1-A7 and B1 have established canonical identity, authorization, customer-binding, policy, internal lifecycle, ledger, external-partner, product, and commercial-platform authorities. B2 does not begin B3 scale, B3 selective extraction, B3 cloud/observability extraction, B3 multi-region, B3 cross-currency, B3 second commercial partner beyond `NIBSS_NIP`, B3 partner marketplace, or second commercial scope beyond `commercial.virtual-account.inbound-funding` v1 unless a separate reviewed capability and ADR explicitly adds one.

B2 must not be treated as permission to expose a public API, activate a customer, merchant, or agent, enroll a developer, deliver a webhook, grant a quota, or lift a rate limit merely because an API route, credential, or B1 commercial contract exists. Customer, merchant, and agent verification, A2 authentication/authorization, A3 binding, A4 policy eligibility, A5 ledger, A6 partner, A7 product, B1 commercial plan/tier/entitlement, consent, idempotency, audit, reconciliation, data classification, Finance/Ledger/Tax, Security, Privacy, Legal, Risk, Compliance, Support, Product, Commercial, and release gates remain explicit inputs and exit conditions.

## 2. Phase objective

Introduce the customer-facing activation and public commercial platform so that verified customers, merchants, and agents can self-serve bounded commercial capabilities through a single, versioned, governed, documented public surface rather than through internal tooling, ad-hoc partner calls, or per-product bespoke routes. The platform must:

- provide one explicit commercial activation contract and public route catalog that prevent public-surface behavior from becoming a source authority in Customer, Wallet, Ledger, A2, A3, A4, A5, A6, A7, B1, Operations, or Reconciliation;
- extend the A2 authentication boundary with API-key / client-credential / scoped-token authentication that reuses A2 token/session/mfa/privileged-action and never invents a second credential vault;
- extend the A4 policy machinery with a read-only activation-eligibility consumer that reuses A4 capability, tier, entitlement, limit, and obligation evaluation;
- extend the A3 binding boundary with a read-only activation-binding consumer that reuses A3 verified ownership without inferring or repairing bindings from public input;
- expose B1 commercial capabilities (pricing, fees, commissions, billing, invoices, statements, campaigns, promotions, coupons, referrals, cashback, loyalty) as read-only, consented, rate-limited public resources through the B1 plan boundary;
- introduce a merchant and agent onboarding model distinct from customer onboarding and distinct from `CustomerPreference`, with explicit verification, approval, and suspension vocabulary;
- introduce a public API identity (consumer, credential, sandbox, production) distinct from internal command, A6 external operation, A7 product command/operation, and B1 commercial-decision identifiers;
- introduce a webhook-registration, webhook-delivery, and webhook-verification boundary consistent with A6 callback authenticity/replay/freshness and the A6T10 / A7T10 / B1T10 data-classification matrix and A1 retention/legal-hold controls;
- introduce a developer-onboarding, API-credential, sandbox, documentation, versioning, quota, and rate-limit boundary that never stores raw secrets, PANs, PINs, OTPs, or partner credentials in broad records, logs, traces, or events;
- honor `CustomerPreference.notifications` and the explicit B2 customer-consent and marketing-consent records as customer intent authorities (B2 never redefines intent);
- provide commercial activation workflows with explicit pending, verified, suspended, revoked, and rollback states and no automatic financial correction;
- independently reconcile activation, credential, quota, rate-limit, webhook, and public-route evidence read-only without writing source records;
- prove a complete identity-to-binding-to-policy-to-B1-commercial-decision-to-activation-to-public-API-to-webhook-to-reconciliation trace for the first selected activation cohort without allowing an activation, credential, webhook, or public-route event to replace A1, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, Operations, Outbox, or Reconciliation authority;
- provide commercial self-service that consumes Customer/A2/A3/A4/B1 and never becomes an authorization, binding-repair, policy, or ledger authority; and
- preserve disable and rollback that stop new activation without rewriting A5, A6, A7, B1, or Ledger history.

B2 must not be treated as permission to enable public commercial routes, customer activation, merchant activation, agent activation, developer onboarding, API credentials, sandbox, API documentation, API versioning, API quotas, rate limiting, webhook registration, webhook delivery, webhook verification, or production rollout merely because a B2 contract or B2 plan exists. B2 must not be treated as permission to onboard a second `NIBSS_NIP`-beyond partner, a second currency, a second accounting unit, or a second B1 commercial scope.

## 3. B2 boundary and task summaries

### 3.1 Customer-activation boundary

B2 does not preselect an activation cohort size, residential filter, eligibility percentile, region beyond `NG`, currency beyond `NGN`, accounting unit beyond `CUSTOMER_FUNDS`, or channel beyond the bounded API + webhook surface. B2T01 must select the bounded first activation cohort/segment for the first B1 commercial scope `commercial.virtual-account.inbound-funding` v1, record the activation key, customer/merchant/agent segment rule, consented notification surface, partner dependency, and prohibited adjacent cohorts, before any B2 implementation proceeds.

The selected first activation shape must be one of the following bounded shapes, subject to B2T01 evidence and review:

```text
B2 customer-facing activation of the frozen B1 first commercial scope
+ bounded onboarding envelope (customer onboarding, merchant onboarding, agent onboarding)
+ bounded activation envelope (commercial activation workflows, self-service, consent-gated)
+ bounded public-surface envelope (public commercial routes, API versioning/documentation, sandbox)
+ bounded credential envelope (API consumers, credentials, quotas, rate limits)
+ bounded webhook envelope (registration, delivery, verification)
+ bounded governance envelope (customer consent, marketing consent, activation rollback)
```

B2 must not simultaneously implement mobile/web/PWA native screens, card/bills/airtime/QR/merchant/agent-network/bulk/payroll/savings/credit/lending/FX products, cross-region, cross-currency, second commercial scope, or second external partner beyond `NIBSS_NIP`. Each additional scope, product, region, currency, or partner requires a separate reviewed capability decision and must not be smuggled into the first activation cohort.

### 3.2 One-line summary of every task

| Task      | One-line summary                                                                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B2T01** | Establish the B2 activation baseline, select one bounded first activation cohort/segment for `commercial.virtual-account.inbound-funding` v1, and record prohibited edges and rollback assumptions. |
| **B2T02** | Define the B2 public API catalog and route-exposure contract that keep public-surface behavior outside canonical authorities.                                                                       |
| **B2T03** | Implement customer onboarding extension for activation (verification, eligibility re-check, and activation-ready state without creating a second identity authority).                               |
| **B2T04** | Implement merchant and agent onboarding (verification, approval, and suspension without creating a second boarding authority).                                                                      |
| **B2T05** | Implement commercial activation workflows, public commercial routes, and commercial self-service that consume B1 and never become a policy/ledger authority.                                        |
| **B2T06** | Implement customer consent and marketing consent (intent authorities consumed via A6T10/A7T10/B1T10 controls without inventing a parallel consent vault).                                           |
| **B2T07** | Implement API documentation, versioning, sandbox, and developer onboarding that provide a single versioned documented surface.                                                                      |
| **B2T08** | Implement API credentials, consumers, quotas, and rate limiting that enforce A2 authentication and never store raw secrets.                                                                         |
| **B2T09** | Implement webhook registration, delivery, and verification that reuse A6 callback authenticity/replay/freshness and the data-classification matrix.                                                 |
| **B2T10** | Integrate public API authentication with A2 audience/authorization and expose B1 commercial capabilities as consented, rate-limited public resources.                                               |
| **B2T11** | Implement activation rollback, commercial disable, and operational recovery that stop new activation without rewriting financial history.                                                           |
| **B2T12** | Validate the complete B2 platform, certify the first activation cohort, and prepare the release gate and B3 handoff without beginning B3.                                                           |

### 3.3 Commercial activation boundary

A B2 activation, credential, quota, webhook, documentation version, or public-route entry is not financial truth by itself. A successful B2 activation flow must establish, through the approved contracts:

- one canonical internal customer/merchant/agent identity chain (A1 + A2 + A3 verification);
- one distinct B2 activation identity (B2T05) and public-consumer/credential identity (B2T08) and webhook-registration identity (B2T09), each distinct from B1 commercial-decision, A6 external operation, A7 product command/operation, and A5 journal identifiers;
- one validated A4 policy decision (capability, tier, entitlement, limit, obligation) with policy version, evidence, expiry, and currentness — A4 remains the only policy authority, B2 supplies only activation data A4 consumes;
- one verified customer consent record and, where marketing notifications are sent, one marketing-consent record (B2T06) — `CustomerPreference.notifications` remains the customer delivery-intent authority;
- one approved B1 commercial plan/tier/entitlement/feature-flag/billing/campaign/referral context for `commercial.virtual-account.inbound-funding` v1;
- one truthful Ledger-owned financial effect only after B1-commercial plus A5/A6/A7/B1 evidence is satisfied (Ledger remains the only financial value authority);
- one independent B2 reconciliation trace covering activation, credential/consumer, quota/rate-limit, webhook, and public-route evidence without writing source records; and
- one rate-limited, versioned, documented, authenticated public request that respects the caller’s quota and the B1 commercial release gate.

An activation event, credential, quota grant, webhook delivery, or public-route hit cannot become a financial command, A2 authorization, A3 binding repair, A4 policy decision, A5 ledger record, A6 settlement/suspense, A7 product operation, B1 commercial decision, or `CustomerPreference` mutation without the owning boundary’s verification.

### 3.4 Existing implementation inputs

B2 consumes and must preserve:

- A1 canonical ownership, identifier, privacy, retention, legal-hold, minimization, external-sharing, and cross-cutting contracts.
- A2 authenticated principal, session/token, audience/scope, authorization, privileged-action, protected-ingress, and security-event contracts.
- A3 canonical Customer-to-Financial-Account binding, ownership, lifecycle, currency, accounting-unit, and repair/reconciliation contracts.
- A4 capability/action policy, tier/entitlement/limit/obligation, evidence snapshot, expiry/re-evaluation, and currentness contracts.
- A5 customer-aware command/correlation, lifecycle, ledger, operations (audit/idempotency/outbox/metrics/diagnostics), outbox, unknown-outcome, and pilot-control patterns.
- A6 partner-adapter, callback-authenticity/replay/freshness, settlement/suspense/compensating, external reconciliation (A6T09), and external-rail data-classification/minimization (A6T10).
- A7 product catalog/boundary, customer-binding, command/operation, notification delivery (A7T06), lifecycle, financial-effect, reconciliation, and data-minimization.
- B1 catalog/plan boundary (`commercial.virtual-account.inbound-funding` v1 frozen), fee/commission, billing/invoice/statement, campaign/promotion/coupon, referral/cashback/loyalty, revenue-recognition/tax/cost-accounting, analytics/profitability/reconciliation, governance/classification/idempotency/audit/approvals/feature-flag, and release gate (B1T11 `BLOCKED` until approved).
- `CustomerPreference` (including `NotificationPreference`) as the customer delivery-intent authority; B2 consumes it and never redefines it.
- Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, request context, readiness, retention, and shutdown primitives.

Existing public routes, credentials, rate limits, webhooks, sandbox data, or commercial metadata must not be treated as B2-approved behavior merely because they exist.

## 4. B2 scope

B2 includes:

- One bounded first activation cohort for `commercial.virtual-account.inbound-funding` v1 selected through B2T01 (explicit segment rule, customer/merchant/agent eligibility, consented notification surface, partner dependency, prohibited adjacent cohorts).
- A B2 public API catalog and route-exposure contract (B2T02) that prevents public-surface behavior from becoming a source authority.
- Customer onboarding extension for activation (B2T03) that reuses `Customer`, KYC, `CustomerOnboarding`, and `CustomerRisk` authorities.
- Merchant onboarding and agent onboarding (B2T04) — verification, approval, suspension — as distinct non-customer cohorts with explicit ownership and without creating a second `Customer` authority.
- Commercial activation workflows, public commercial routes, and commercial self-service (B2T05) consuming B1 and never becoming an A2/A3/A4/A5/B1 authority.
- Customer consent and marketing consent (B2T06) — intent authorities consumed through A6T10/A7T10/B1T10 controls, distinct from A2 authorization and `CustomerPreference` delivery intent.
- API documentation, API versioning, sandbox, and developer onboarding (B2T07) — single versioned documented surface, deterministic version negotiation, fixture-based sandbox data.
- API credentials, API consumers, API quotas, and rate limiting (B2T08) — scoped token / API-key lifecycle, consumer registry, quota allotment, and token-bucket / sliding-window enforcement through A2.
- Webhook registration, webhook delivery, and webhook verification (B2T09) — idempotent registration, at-least-once delivery via transactional outbox + retry with exponential backoff and dead-letter, HMAC-SHA256 signature verification, replay protection, and freshness window.
- Public API authentication (B2T10) — A2 audience/scope verification for every public commercial route; B1 commercial capabilities exposed as authenticated, consented, rate-limited resources.
- Activation rollback, commercial disable, and operational recovery (B2T11) — per-cohort, per-consumer, per-route, per-webhook disable; environment emergency-stop; history preservation.
- B2 sandbox/certification fixtures, contract tests, fixture-based webhook/rate-limit/consent tests, release evidence, and B3 handoff boundaries (B2T12).
- Independent B2 reconciliation (read-only) for activation, credential, quota, rate-limit, and webhook evidence.

## 5. B2 non-goals

B2 does not implement:

- A second customer identity vault, a second customer-wallet balance, a second ledger, a second journal authority, a second suspense truth source, or a second reconciliation writer.
- A second authentication vault; password hashing/verification, session/token minting beyond A2-scoped public tokens, or bypass of A2 assurance remains A2.
- Binding repair or reassignment from public input; A3 remains the only binding authority.
- A second policy evaluator; A4 precedence, risk/restriction/compliance/limit evaluation remains A4.
- Mutation of `Customer`, `CustomerWallet`, eligibility, restrictions, enrollment, risk, compliance, A3 binding, Wallet/Ledger, or source `CustomerPreference` records to make an activation pass.
- Replacement of the A5 ledger, A6 partner adapter, A7 product layer, B1 catalog/plan boundary, or Operations audit/idempotency/outbox.
- A second pricing catalog, fee/commission engine, billing/invoice engine, campaign/coupon/referral/loyalty/revenue-recognition/tax/cost/profitability/analytics engine, or second data-classification registry.
- FX, cross-currency conversion, savings interest, lending, credit scoring, chargebacks, disputes, card schemes, QR/merchant rails beyond the `VIRTUAL_ACCOUNT` product boundary, or product expansion beyond the `VIRTUAL_ACCOUNT` v1 product unless a separate A7+B1 cycle adds one.
- Mobile/web/PWA native screens, USSD/SMS banking, or app-store distribution; those remain product channel work outside B2 public API scope.
- Unbounded background workers, an unowned broker, a new service-extraction topology, Kafka/RabbitMQ introduction, or a scheduler without an approved Operations/runtime boundary.
- Automatic financial correction, automatic suspense clearing, automatic activation repair, in-place journal/line mutation, or silent financial correction.
- A second external partner beyond `NIBSS_NIP`, a partner marketplace, or cross-region rollout (`NG` only in B2).
- Marketing-campaign content generation, marketing-audience builder, or marketing analytics beyond the marketing-consent intent record; B2T06 records consent intent, not marketing content.
- Production ramp or broad cohort expansion merely because B2 implementation artifacts exist.
- B3 cloud/observability extraction, B3 multi-region, B3 cross-currency, B3 second scope, or B3 selective service extraction.

## 6. Governing architectural boundaries

1. `Customer.id` remains the only canonical internal customer identity; `Merchant.id` and `Agent.id` are distinct cohort identities that reference `Customer.id` where a natural person is the beneficial owner and that never replace `Customer.id` as the A1 identity for policy/binding/consent.
2. A2 authenticates and authorizes every public B2 request (API or webhook-management) through A2 audience/scope/assurance verification and privileged-action approval where required. A credential, webhook registration, customer consent, or marketing consent cannot grant A2 authorization.
3. A4 owns capability, risk, restriction, eligibility, compliance, tier, entitlement, limit, and obligation policy. B2 activation workflows consume the current A4 decision; B2 never duplicates or overrides A4 precedence and never invents a second risk/compliance engine.
4. A3 owns the explicit Customer-to-Financial-Account binding. B2T03–T05 must use verified internal account assertions supplied by A3; B2 never chooses, infers, or repairs an account from a public request, credential, webhook, or commercial reference.
5. `CustomerPreference` (including `NotificationPreference`) is the customer delivery-intent authority for notifications; B2T06 customer-consent and marketing-consent are activation/marketing intent authorities that are consumed alongside `CustomerPreference` and that never replace delivery intent.
6. `WalletAccount` remains the financial wallet facade; `Ledger` remains the sole authority for financial accounts, journals, lines, balances, posted value, settlement/suspense/compensating entries, and correction outside Finance-approved boundaries.
7. External side effects and internal database transactions have different commit boundaries. B2 must represent the gap with durable activation, credential, quota, webhook-registration, webhook-delivery, and manual-review states and must verify webhook delivery through signed delivery receipts and idempotent consumer handling.
8. Operations owns audit, idempotency, outbox, metrics, diagnostics, request context, readiness, retention, and operational lifecycle. B2 reuses those primitives rather than creating local substitutes or a second idempotency/audit/outbox vault.
9. Reconciliation remains independent and read-only. B2 activation/credential/quota/rate-limit/webhook/public-route reports cannot repair source records, authorize activations, or lift limits.
10. Activation, onboarding, credential, quota, rate-limit, webhook-registration, webhook-delivery, customer-consent, marketing-consent, and public-route data are minimized, classified, access-controlled, redacted, and retained only under A1 + A6T10 / A7T10 / B1T10 approved controls.
11. B2 is a bounded public-platform boundary inside the existing modular monolith. It does not create a microservice or topology change based only on activation cohort.
12. Every B2 activation, consumer, credential, sandbox session, documented version, quota grant, rate-limit bucket, webhook registration, webhook delivery, and public-route hit is scoped to an approved activation key and carries an internal correlation chain without treating the external reference as canonical internal identity.
13. B2 may use the A5 transactional outbox as a durable internal intent/fact boundary for webhook dispatch and notification intent, but no webhook row, outbox row, API route hit, or activation event may be treated as a Ledger record, a customer intent beyond its scoped authority, or a delivery confirmation beyond the verified receipt.
14. Disabling an activation cohort, a public route, a consumer, a credential, a webhook registration, or a sandbox scope stops new public activity without deleting, rewriting, or masking completed internal, partner, product, commercial, or Ledger history.
15. A B2 activation, credential, webhook, or public-route effect never becomes a financial command, A2 authorization, A3 binding repair, A4 policy decision, B1 commercial decision, or Ledger record.

## 7. Dependencies and required inputs

### A1 inputs

- Canonical ownership matrix; identifier, reference, and correlation conventions (`Customer.id`, `Merchant.id`, `Agent.id`, activation/consumer/credential/webhook/rate-limit identifiers).
- Data classification (`PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED`/`HIGHLY_RESTRICTED`), retention, legal-hold, minimization, external-sharing, and privacy controls.

### A2 inputs

- Authenticated principal, audience, scope/role, assurance, authorization decision, request/correlation/trace/causation context.
- Protected route/service action policy for each B2 public route, webhook-management route, and control route.
- Privileged-action approval and step-up for cohort onboarding approval, credential rotation/issuance, webhook-registration approval, quota override, rate-limit override, and emergency disable/rollback.

### A3 inputs

- Canonical Customer UUID and explicit internal account binding references supplied read-only.
- `CustomerWallet`/`WalletAccount`/`LedgerAccount` IDs, ownership, currency (`NGN`), accounting unit (`CUSTOMER_FUNDS`), type, normal balance, active state, versions, control/reconciliation state.
- No permission for B2 to repair or reassign a binding as part of an activation.

### A4 inputs

- Capability/action policy decision (version, reference, evidence hash, expiry/review, reason codes, obligations, exact limits, tier/entitlement/feature-flag) currentness — B2 is a read-only activation-eligibility consumer.

### A5 inputs

- Customer-aware command/correlation contract; lifecycle and pending/unknown-outcome patterns; ledger posting, account locking, journal correlation, settlement-account support, compensating-entry boundaries.
- Operations idempotency, audit, outbox, metrics, diagnostics, readiness, retention, request-context primitives.
- Pilot disable/stop-condition/rollback patterns adapted so a public/activation boundary cannot rewrite A5 history.

### A6 inputs

- Partner-adapter boundary, capability/version for `NIBSS_NIP`; provider idempotency, callback authenticity/replay/freshness, settlement/suspense/compensating, external reconciliation (A6T09), and data-minimization/consent/retention/secret/disclosure/support-trace/partner-payload validation (A6T10).

### A7 inputs

- Product catalog/boundary (`VIRTUAL_ACCOUNT` v1, ADR-0054), customer-binding map, command/operation identity, notification delivery (A7T06 under `CustomerPreference`), lifecycle, financial-effect, reconciliation, and data-minimization contracts.

### B1 inputs

- Frozen catalog/plan boundary `commercial.virtual-account.inbound-funding` v1 (B1T02/B1T03), pricing/plan/tier/entitlement/package/bundle, fee/commission/revenue-sharing (B1T04), billing/invoice/statement (B1T05), campaign/promotion/coupon (B1T06), referral/cashback/loyalty (B1T07), revenue-recognition/tax/cost-accounting (B1T08), analytics/profitability/reconciliation (B1T09), and governance/classification/idempotency/audit/approvals/feature-flag (B1T10) — all consumed as read-only commercial data by B2, with the B1 release gate `BLOCKED` until independently approved.

### B2-specific inputs

- `CustomerPreference` (including `NotificationPreference`) as the delivery-intent authority; B2 never redefines delivery intent.
- `CustomerConsent` and `MarketingConsent` intent authorities (B2T06) — explicit opt-in/opt-out per purpose, separate from `CustomerPreference`.
- Merchant and agent verification evidence (where the first activation cohort includes merchant/agent segments).
- A2 audience repertoire for each public B2 route; B2 does not expose an unauthenticated public commercial route.

## 8. Sequential task breakdown

### B2T01 — B2 Activation Baseline and First Activation Cohort Selection

- **Type:** Documentation and architecture baseline
- **ADR input:** ADR-0072 — B2 Activation Scope and Cohort Boundary (proposed)

#### Objective

Inventory the current activation-adjacent surfaces (existing onboarding flows, merchant/agent metadata, public routes, credentials, sandbox data, webhook registrations, quota/rate-limit metadata, consent records, self-service flows) and select one bounded first activation cohort for `commercial.virtual-account.inbound-funding` v1 without treating existing metadata, routes, or commercial data as B2-approved behavior.

#### Deliverables

- `docs/B2-ACTIVATION-BASELINE.md`.
- Existing activation-adjacent module and route inventory (customer/merchant/agent onboarding, activation workflows, public commercial routes, consumers, credentials, sandbox, documentation, versioning, quotas, rate limits, webhooks, consent, self-service).
- Activation candidate matrix covering customer/merchant/agent segment, residential filter, eligibility percentile, direction, capability, currency, accounting unit, partner dependency, fee/commission/billing tier reference, data fields, and required consent purposes (service vs marketing).
- One selected B2 first activation cohort (bounded: cohort key, cohort version, segment rule — e.g., inbound-funding cohort of existing verified `VIRTUAL_ACCOUNT` customers filtered by KYC tier + policy eligibility + consent granted — without fixing production rollout percent), with explicit A2 audience, internal activation owner, partner dependency, prohibited adjacent cohorts/channels, and minimum activation surface.
- Existing activation-adjacent gap register (credential life-cycle gap, sandbox fixture gap, webhook replay gap, consent enforcement gap, public-route A2 scope gap).
- Activation identifier, credential, secret, data-sharing, consent, retention, and legal-hold inventory.
- B2 dependency, risk, certification, stop-condition, activation-rollback, and internal-history-preservation register.
- Compatibility classification for existing activation-adjacent modules, `CustomerPreference`, B1 commercial metadata, and A7 product metadata.

#### Acceptance criteria

- Exactly one bounded first activation cohort is selected, or implementation is blocked pending that selection.
- The cohort key, cohort version, segment rule, customer/merchant/agent eligibility composition, consent purposes, internal activation owner, partner dependency, data fields, and prohibited adjacent cohorts/channels are explicit.
- Existing public-route, credential, webhook, or commercial metadata is classified as compatibility input, not as evidence of a B2 activation boundary.
- `CustomerPreference.notifications` remains the delivery-intent authority; B2T06 consent purposes are recorded as distinct activation/marketing intent authorities and not conflated with delivery intent.
- A1, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Support, Product, Commercial, and partner dependencies are mapped.
- No activation cohort, public route, credential, sandbox scope, webhook, or consent record is created/activated by this task.

#### Dependencies

- A1-A7 + B1 committed artifacts and handoff packages (B1-B2 BLOCKED until approved).
- Existing activation-adjacent inventories and public-route inventory.
- A1 identifier/privacy/retention controls and A2 audience/authorization repertoire.

#### Explicitly out of scope

- Activating a customer, merchant, agent, commercial capability, public route, credential, sandbox, webhook, or consent.
- A second activation cohort, a second B1 commercial scope, a second partner, a second currency/region.
- A public commercial API, public channel wiring, or broad customer activation.
- Beginning any B2T02-B2T12 implementation.

### B2T02 — B2 Public API Catalog and Route-Exposure Contract

- **Type:** Documentation and runtime contract design
- **ADR:** ADR-0072 — B2 Activation Scope and Cohort Boundary (proposed; extended) and ADR-0073 — B2 Public API and Route Exposure Boundary (proposed)

#### Objective

Define the B2 public API catalog, the B2 route-exposure contract, and the B2 public-surface extension points that keep public behavior outside Customer, Wallet, Ledger, A2, A3, A4, A5, A6, A7, B1, Operations, and Reconciliation authorities. Apply the boundary to the first selected activation cohort.

#### Deliverables

- `docs/B2-PUBLIC-API-CATALOG-CONTRACT.md`.
- Public API catalog with a single frozen registration for the first activation cohort and an extension contract for future cohorts.
- Public route catalog: `GET /commercial/activations`, `POST /commercial/activations`, `GET /commercial/catalog`, `GET /commercial/plans`, `GET /commercial/tiers`, `POST /webhooks/registrations`, `POST /auth/token`, and health/support read routes — each annotated with A2 audience/scope, idempotency scope, quota cost, rate-limit tier, version, and consent purpose.
- Route-exposure interface and normalized public-request / public-result / public-audit types with distinct B2 `activationReference` / `consumerReference` / `credentialReference` / `webhookRegistrationReference` / `webhookDeliveryReference`.
- Public-surface extension contract for future cohorts without requiring a B1 commercial scope change.
- Public API sandbox/fixture contract and public-catalog tests.
- Explicit boundary for activation, credential, webhook-registration, webhook-delivery, quota, rate-limit, customer-consent, marketing-consent, and public-route.

#### Acceptance criteria

- Domain modules consume an explicit B2 public API catalog and route-exposure contract rather than reaching into customer, wallet, ledger, partner, product, commercial, or reconciliation modules directly.
- Every public B2 route carries an A2 audience/scope check and a distinct B2 public-surface identity that never overlaps internal command / A6 operation / A7 product operation / B1 commercial-decision identifiers.
- Public fields are schema-validated, bounded, classified (A6T10 `PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED`/`HIGHLY_RESTRICTED`), and mapped without using a public reference, credential reference, webhook reference, or consent reference as Customer, Wallet, Ledger, command, or journal identity.
- Unsupported capabilities, malformed requests, wrong audience, expired token, wrong environment, or unavailable activation fails closed or enters declared recovery (not auto-activated).
- Public-catalog tests use deterministic fixtures and do not require live partner or live product calls.
- The contract does not post a journal, mutate a balance, repair a binding, change A4 policy/source, or dispatch a notification beyond the A7T06 delivery contract.

#### Dependencies

- B2T01.
- A1 canonical ownership/identifier contracts; A2 protected-service/secret/audience; A3 binding/ownership; A4 capability/currentness.
- A5 command/correlation/Operations/outbox/recovery; A6 partner/callback/settlement/suspense/external-reconciliation; A7 product layer; B1 catalog/plan boundary.

#### Explicitly out of scope

- Activating a customer/merchant/agent, commercial capability, credential, webhook, or consent.
- A second cohort/scope/partner/channel or broad customer activation.
- Beginning any B2T03-B2T12 implementation.

### B2T03 — B2 Customer Onboarding Extension for Activation

- **Type:** Runtime onboarding extension implementation (read-only extension of Customer Foundation)
- **ADR input:** ADR-0074 — B2 Customer Onboarding for Activation (proposed)

#### Objective

Implement the B2 customer onboarding extension that makes a verified customer activation-ready without creating a second `Customer` authority. The extension consumes `Customer`, `CustomerOnboarding`, `CustomerFundingInstrument`, `CustomerRisk`, KYC, and identity-document metadata and emits an activation-ready attestation that B2T05 activation workflows consume read-only.

#### Deliverables

- `docs/B2-CUSTOMER-ONBOARDING-CONTRACT.md`.
- Customer activation-readiness model: `verificationState` (`UNVERIFIED`/`PENDING`/`VERIFIED`/`SUSPENDED`/`BLOCKED`), `activationEligibility` (`ELIGIBLE`/`INELIGIBLE`/`REQUIRES_CONSENT`), and `activationReadyAt` — derived, not stored as a second authoritative customer record.
- Read-only consumer boundary to A1 `Customer` / P1.2 KYC / `CustomerOnboarding` evidence; read-only to A3 binding verified state; read-only to A4 `ELIGIBLE` decision for `commercial.virtual-account.inbound-funding` v1.
- Activation-readiness persistence where durable (separate B2 activation-readiness table with FK to `Customer.id`, not a mutated `Customer` row).
- Operations audit/idempotency/outbox/metrics/diagnostics integration for customer activation-readiness events.
- Customer onboarding replay-safe, conflict-safe, and uniqueness tests using fixtures of P1.2 KYC + A4 eligibility + A3 binding.

#### Acceptance criteria

- `Customer.id` remains the only canonical identity; the B2 customer activation-readiness record is a projection/attestation keyed by `Customer.id` and never creates a second writable Customer.
- An activation-ready attestation is emitted only when KYC `VERIFIED` + A3 binding `VERIFIED` + A4 policy `ELIGIBLE` + customer consent (where required) `GRANTED` are all satisfied.
- A duplicate attestation request returns the durable original outcome; a changed payload under the same idempotency scope is rejected without mutation.
- The extension never writes `Customer`, `CustomerWallet`, eligibility, `CustomerPreference`, or A3 binding records.
- No live onboarding partner call is required; fixture-based tests are sufficient for the contract.
- No activation is dispatched by this task; B2T05 owns the workflow that consumes the attestation.

#### Dependencies

- B2T01, B2T02.
- P1.2 `CustomerOnboarding`/`CustomerRisk`, A2 session/authorization, A3 binding, A4 policy, `CustomerPreference` intent, B1 catalog/plan boundary.
- `IdempotencyService`, `AuditService`, `OutboxService`.

#### Explicitly out of scope

- Merchant or agent onboarding (B2T04).
- Public commercial route wiring or webhook delivery; marketing-consent onboarding beyond the required customer-consent check.
- Implementing B2T05 activation workflows, B2T08 credentials, or B2T11 rollback beyond fixture coverage of this extension.

### B2T04 — B2 Merchant and Agent Onboarding

- **Type:** Runtime cohort onboarding implementation
- **ADR input:** ADR-0074 (extended) and ADR-0075 — B2 Merchant and Agent Onboarding (proposed)

#### Objective

Implement merchant and agent onboarding for activation: verification, privileged approval, and suspension, for merchant/agent segments that are distinct from `Customer` yet traceable to a beneficial-owner `Customer.id` where applicable, without creating a second `Customer` or duplicating the A4 policy evaluator.

#### Deliverables

- `docs/B2-MERCHANT-AGENT-ONBOARDING-CONTRACT.md`.
- Merchant onboarding model: `merchantProfile` (business type, registration reference, tax identifier reference, settlement-account reference — not PAN/raw credentials), `merchantVerificationState` (`DRAFT`/`PENDING_VERIFICATION`/`VERIFIED`/`SUSPENDED`/`REVOKED`), beneficial-owner `Customer.id` link where required.
- Agent onboarding model: `agentProfile` (agent network, terminal reference, collection-mode reference), `agentVerificationState` (same vocabulary), supervising `Merchant.id` / `Customer.id` link.
- Verification and privileged-approval flows (A2 `PrivilegedActionApproval` reuse — only approval authority); suspension/revocation flows that suppress future activations without deleting history.
- Merchant/agent persistence where durable (separate `merchant_profile`, `agent_profile`, `merchant_agent_binding` tables with FKs to `Customer.id` where applicable; no second `Customer` table).
- Operations audit/idempotency/outbox integration.
- Merchant/agent replay-safe, conflict-safe, approval-gated, fixture-based tests.

#### Acceptance criteria

- No second writable `Customer` table or second canonical identity is introduced; `Merchant.id` and `Agent.id` are distinct cohort identifiers with explicit beneficial-owner traces.
- Merchant/agent onboarding is approved only through the A2 privileged-action surface; no onboarding bypasses A2 or A4.
- Verified state requires evidence (registration/tax/settlement reference validation) and is never inferred from public input.
- Suspension/revocation is explicit, audit-recorded, and never auto-clears; history is preserved.
- Fixture tests cover `VERIFIED`→`SUSPENDED`→`REVOKED` transitions and approval-denied flows without live corporate-registry calls.
- The onboarding models never infer A3 account bindings or `CustomerPreference`.

#### Dependencies

- B2T01, B2T02, B2T03.
- A2 privileged-action, A4 policy (merchant-eligible/agent-eligible capability where the plan uses them), A3 binding verification for the beneficial-owner `Customer.id`.
- `IdempotencyService`, `AuditService`, `OutboxService`.

#### Explicitly out of scope

- Customer onboarding (B2T03) beyond beneficial-owner trace.
- Commercial activation workflows (B2T05), consent beyond business-consent check, public routes/webhooks/credentials.
- Implementing merchant settlement rails beyond `NIBSS_NIP` or a new currency.

### B2T05 — B2 Commercial Activation Workflows, Public Commercial Routes, and Commercial Self-Service

- **Type:** Runtime activation-orchestration implementation
- **ADR input:** ADR-0076 — B2 Commercial Activation Workflow and Self-Service (proposed)

#### Objective

Implement the B2 commercial activation workflows, the public commercial routes that serve `GET /commercial/catalog|plans|tiers` and `POST /commercial/activations`, and the commercial self-service that together consume B1 commercial capabilities as authenticated, consented, rate-limited public resources. The workflows are the only B2 activation authority; they remain read-only with respect to A4 policy and A3 binding and never post to Ledger.

#### Deliverables

- `docs/B2-COMMERCIAL-ACTIVATION-CONTRACT.md`.
- Activation workflow: request `POST /commercial/activations` with `B2ActivationRequestV1` (cohort key, consumer reference, idempotency key, customer/merchant/agent identifier, requested plan/tier/entitlement, consent purpose, idempotency scope); result `B2ActivationResultV1` with states `PENDING_VERIFICATION` / `PENDING_CONSENT` / `PENDING_APPROVAL` / `ACTIVE` / `SUSPENDED` / `REVOKED` / `EXPIRED` / `REJECTED`; correlation `activationReference` distinct from B1/A6/A7 identifiers.
- Public read routes `GET /commercial/catalog`, `GET /commercial/plans/{planKey}`, `GET /commercial/tiers/{tierKey}` that expose minimized B1 catalog data through A6T10 classification and A2 audience.
- Self-service routes `GET /activations/{id}`, `POST /activations/{id}/suspend`, `POST /activations/{id}/revoke` (A2 privileged-action where required).
- Workflow persistence where durable (`b2_activation`, `b2_activation_event` with REPEATABLE READ read for reconciliation consumers).
- Workflow replay-safe, conflict-safe, idempotency-scoped (hash payload excludes `activationReference`/`createdAt`), consent-gated, quota-aware, and rate-limit-aware tests.
- Fixture-based activation tests covering `PENDING_*`→`ACTIVE`→`SUSPENDED`→`REVOKED`, consent-denied `REJECTED`, tier-ineligible `REJECTED`, and same-key/changed-payload conflict.

#### Acceptance criteria

- The B2 activation workflow is the only B2 activation authority; B2T03/B2T04 supply onboarding attestations consumed read-only, B2T06 supplies consent consumed read-only, B2T08 supplies consumer/credential/quota consumed read-only, B2T09 supplies webhook registration consumed read-only.
- An activation reaches `ACTIVE` only when customer/merchant/agent `VERIFIED` + A3 binding `VERIFIED` + A4 `ELIGIBLE` with current obligations + B1 plan/tier/entitlement `COMPATIBLE` + customer consent `GRANTED` + (where marketing notifications will be sent) marketing consent `GRANTED` + quota not exceeded + rate limit not exceeded + A2 audience verified.
- Duplicate `POST /commercial/activations` with same idempotency key and payload returns original `activationReference`; changed payload under same scope is `CONFLICTED` without mutation.
- No activation workflow posts a journal, repairs a binding, mutates A4 policy, or dispatches a notification beyond enqueuing a delivery intent to `OutboxService` for A7T06-compatible delivery.
- Self-service `suspend`/`revoke` is audit-recorded via `AuditService` and is idempotent.
- Public read routes return only minimized data approved for the caller's audience (A6T10 external-rail classification reused).

#### Dependencies

- B2T01, B2T02, B2T03, B2T04, B2T06, B2T08, B2T10.
- A4 policy/eligibility/currentness, A3 binding, B1 catalog/tier/entitlement/plan, `CustomerPreference` intent, `IdempotencyService`, `AuditService`, `OutboxService`.

#### Explicitly out of scope

- Consent management UI (B2T06 owns the records, B2T05 enforces them).
- Credential/quota/rate-limit issuance (B2T08); sandbox/developer onboarding (B2T07); webhooks (B2T09); public API authentication beyond the A2 audience check already in the contract.
- Implementing merchant settlement, FX, or second scope/partner/currency.

### B2T06 — B2 Customer Consent and Marketing Consent

- **Type:** Runtime consent-intent implementation
- **ADR input:** ADR-0077 — B2 Customer Consent and Marketing Consent (proposed)

#### Objective

Introduce the B2 customer-consent and marketing-consent intent authorities as explicit consented purposes for activation and for commercial notifications, consumed alongside `CustomerPreference.notifications` without inventing a parallel customer intent vault and without redefining delivery intent.

#### Deliverables

- `docs/B2-CONSENT-CONTRACT.md`.
- Customer consent model: `CustomerConsentV1` (purpose `B2_ACTIVATION`, `B2_SELF_SERVICE`, `B2_COMMERCIAL`, scopes `customerId` + cohort key, states `GRANTED`/`REVOKED`/`EXPIRED`, legal-hold-aware retention).
- Marketing consent model: `MarketingConsentV1` (purpose `MARKETING_COMMERCIAL_OFFER`, channels `email`/`sms`/`push`/`inApp`, states `GRANTED`/`REVOKED`/`EXPIRED`, explicit double-opt-in reference where policy requires it).
- Consent registration, revocation, and query APIs (`POST /consents`, `DELETE /consents/{id}`, `GET /consents`) — each A2-authenticated, audit-recorded, and idempotent.
- Consent reuse contract: B2T05 activation workflow and B2T09 webhook delivery consume consent read-only; A7T06 notification dispatcher consumes `CustomerPreference.notifications` + marketing consent for marketing-class messages; B2T06 never dispatches directly.
- A6T10 classification/retention/legal-hold/secret/disclosure alignment: both consent types register their fields in the A6T10 registry read-only, reuse A1 retention/legal-hold, and are minimization-tested.
- Consent fixture tests covering `GRANTED`→`REVOKED`→`GRANTED`, idempotent revocation, same-subject/purpose conflict, and legal-hold `REVOKE` suppression.

#### Acceptance criteria

- `CustomerConsent` and `MarketingConsent` are the only B2 consent intent authorities; `CustomerPreference` remains the only delivery-intent authority.
- No B2 consent record is inferred from external data, partner response, B1 commercial data, A4 policy, or `CustomerPreference`; consent is explicit (`POST /consents` with principal authentication).
- Activation `PENDING_CONSENT` resolves to `ACTIVE` only when the required consent purpose is `GRANTED` and current; revoking a required purpose transitions `ACTIVE` activations to `SUSPENDED` without deleting history.
- Marketing-class notifications are dispatched only when marketing consent `GRANTED` is current (A7T06 enforces this; B2T06 supplies the intent).
- Consent data is classified, retained, and disclosed only under A6T10 / A1 approved controls (never `PUBLIC` raw consent payload in support trace).
- No consent state grants A2 authorization or bypasses A4.

#### Dependencies

- B2T01, B2T02; A2 authentication/privileged-action; A1 classification/retention/legal-hold; A6T10 registry/minimization; A7T06 delivery intent.
- `AuditService`, `IdempotencyService`, `OutboxService`.

#### Explicitly out of scope

- Customer portal UI for consent; marketing campaign authoring; notification delivery itself (A7T06).
- Implementing activation workflows (B2T05), credentials (B2T08), or webhooks (B2T09) beyond consuming consent.

### B2T07 — B2 API Documentation, Versioning, Sandbox, and Developer Onboarding

- **Type:** Runtime public-surface documentation and onboarding implementation
- **ADR input:** ADR-0078 — B2 API Versioning, Documentation, Sandbox, and Developer Onboarding (proposed)

#### Objective

Provide the single versioned documented public surface that developers consume to integrate with B2: OpenAPI documentation, deterministic version negotiation, a fixture-based sandbox that never touches Ledger/partner/product truth, and developer onboarding that never stores raw secrets.

#### Deliverables

- `docs/B2-API-DOCUMENTATION-CONTRACT.md` and deterministically generated `docs/api/B2-OPENAPI-v1.yaml` (OpenAPI 3.1) covering all B2 public routes (activations, catalog/plans/tiers, consents, webhook registrations, auth/token, sandbox, webhook delivery receipts, quota/rate-limit headers).
- API versioning contract: URL-prefix `v1` plus `Accept: application/vnd.monienaija.v1+json` + `B2-Api-Version` response header; negotiation table (`REQUESTED`→`NEGOTIATED`→`DEPRECATED`→`SUNSET`); sunset policy with 90-day deprecation notice and machine-readable `Sunset` header.
- Sandbox contract: isolated `sandbox` partition keyed by `consumerReference` + `sandboxId`, seeded with deterministic B1-copy fixtures (catalog/plans/tiers/activations/webhook registrations), `sandbox` data never leaks to production via FK/scope-key guard; sandbox reset `POST /sandbox/reset` (A2-authenticated, idempotent, audit-recorded).
- Developer onboarding: `POST /developers` (profile, contact, verification `PENDING`→`VERIFIED`), `POST /consumers/{consumerId}/onboard` (links `Developer.id`→`Consumer.id`, A2 privileged-action where required), onboarding event via `OutboxService`.
- Documentation/Versioning/Sandbox/Developer persistence where durable (separate `b2_developer`, `b2_api_version`, `b2_sandbox_session` tables; docs are the SSOT for the contract).
- Version-negotiation, sandbox-isolation, and developer-onboarding fixture tests.

#### Acceptance criteria

- The OpenAPI file is the only documented contract for B2 public routes; every public route in the catalog (B2T02) appears in the OpenAPI and every OpenAPI operation appears in the catalog.
- `GET` on `/commercial/catalog` with no `Accept` header negotiates to `v1` (latest stable); `Accept: v1` on a `v2`-unknown route fails closed with `406`; deprecated version returns `Deprecation: true` + `Sunset`.
- Sandbox reads never escape the sandbox partition key (verified by FK-scope and fixture test `sandboxId`≠`productionId` and ledger/partner invariant tests).
- Developer onboarding never stores raw credentials, PANs, PINs, OTPs, or partner tokens; secrets are referenced as hashes/metadata only where needed.
- Documentation, versioning, sandbox, and developer onboarding never become an A2/A3/A4/B1 authority.
- Fixture tests prove deterministic version negotiation without live partner calls.

#### Dependencies

- B2T01, B2T02, B2T08; A2 audience/authorization; A1 classification; B1 catalog (sandbox fixtures are B1 copies); `AuditService`/`IdempotencyService`/`OutboxService`.

#### Explicitly out of scope

- Full developer portal UI; API-key issuance (B2T08); webhook delivery/receipt (B2T09); public API authentication beyond audience/version negotiation.
- Implementing activation workflows (B2T05) or credentials beyond the onboarding link.

### B2T08 — B2 API Credentials, Consumers, Quotas, and Rate Limiting

- **Type:** Runtime credential-lifecycle and traffic-control implementation
- **ADR input:** ADR-0079 — B2 API Credentials and Consumer Identity (proposed) and ADR-0080 — B2 Quotas and Rate Limiting (proposed)

#### Objective

Introduce the B2 API consumer registry, the B2 API-credential lifecycle, and the B2 quota/rate-limit enforcement that together gate every public B2 request through A2 authentication and never store or log raw secrets, PANs, PINs, or OTPs.

#### Deliverables

- `docs/B2-API-CREDENTIALS-CONTRACT.md` and `docs/B2-QUOTA-RATE-LIMIT-CONTRACT.md`.
- Consumer model: `ApiConsumerV1` (consumerId, type `DEVELOPER`/`MERCHANT`/`AGENT`/`PARTNER`, displayName, owner `Customer.id` / `Merchant.id` / `Agent.id` link, audience/scope set, states `DRAFT`/`ACTIVE`/`SUSPENDED`/`REVOKED`).
- Credential model: `ApiCredentialV1` (credentialId, consumerId, kind `API_KEY`/`CLIENT_CREDENTIALS`, `keyId`/`clientId` prefix, `secretHash` (argon2/bcrypt, never raw secret storage), `scopes`, expiry, rotation `nextKeyId`, states `ISSUED`/`ROTATED`/`REVOKED`/`EXPIRED`).
- Credential lifecycle: `POST /credentials` (issue — returns secret once, then only `keyId`/`secretHash` stored), `POST /credentials/{id}/rotate` (new secret once, old secret grace window 5 minutes), `DELETE /credentials/{id}` (revoke), all A2 privileged-action where required, audit-recorded, idempotent.
- Quota model: `ApiQuotaV1` (consumerId, route-group e.g., `commercial.read`/`commercial.write`/`webhooks.manage`, limit per day/month, window `UTC` calendar day, states `ALLOCATED`/`EXCEEDED`).
- Rate-limit model: `ApiRateLimitV1` (consumerId, bucket e.g., `global`/`commercial/activations:write`/`webhooks:delivery`, capacity + refill tokens per second, strategy `TOKEN_BUCKET`, states `ALLOWED`/`THROTTLED`).
- Enforcement: token-bucket middleware reads `Authorization: Bearer <A2-scoped-token>` derived from credential exchange; every public route checks `ApiConsumer.ACTIVE` + `ApiCredential` not `REVOKED`/`EXPIRED` + quota not `EXCEEDED` + rate-limit not `THROTTLED` before admission; `429` with `Retry-After` + `X-RateLimit-*` + `X-Quota-*` headers.
- Persistence where durable (`b2_api_consumer`, `b2_api_credential`, `b2_api_quota`, `b2_rate_limit_bucket` with FKs to consumer; no raw secret column, only `secretHash`).
- Credential/consumer/quotab/rate-limit fixture tests covering issue→rotate→revoke, quota `EXCEEDED`→`ALLOCATED` on window rollover, and token-bucket `ALLOWED`→`THROTTLED`→`ALLOWED`.

#### Acceptance criteria

- `ApiConsumer` is the only B2 consumer authority; `ApiCredential` is the only B2 credential authority; no second consumer/credential vault is introduced.
- A raw secret is never stored in any table, log, trace, event, or webhook payload; only `keyId`/`clientId`/`secretHash`/metadata are persisted; secret is returned only once at issuance/rotation and is hashed immediately.
- A revoked or expired credential fails closed with `401`; a suspended consumer fails closed with `403`; no revoked/expired credential grants quota or rate-limit allowance.
- Quota `EXCEEDED` fails closed with `429` + `X-Quota-Remaining: 0`; window rollover resets to `ALLOCATED` without manual repair.
- Rate-limit `THROTTLED` fails closed with `429` + `Retry-After` and never bypasses A2 or A4 or consent.
- The credential/quota/rate-limit lifecycle is append-audit-recorded via `AuditService` and idempotent via `IdempotencyService` (same-key/same-payload → replay, same-key/changed-payload → conflict).
- No credential/quota/rate-limit effect posts to Ledger or repairs a binding.

#### Dependencies

- B2T01, B2T02, B2T07; A2 privileged-action/session/token exchange; A1 secret/identifier controls; `AuditService`/`IdempotencyService`/`OutboxService`/`MetricsService`.

#### Explicitly out of scope

- OAuth/OIDC federation beyond client-credentials; mobile biometric; social login.
- Webhook delivery (B2T09) beyond consuming consumer liveness; developer onboarding beyond the consumer link.
- Implementing public commercial activation beyond the credential gate.

### B2T09 — B2 Webhook Registration, Delivery, and Verification

- **Type:** Runtime webhook-lifecycle implementation
- **ADR input:** ADR-0081 — B2 Webhook Registration, Delivery, and Verification (proposed)

#### Objective

Introduce the B2 webhook-registration, webhook-delivery, and webhook-verification boundary that delivers activation and commercial-event notifications to a consumer-controlled URL with at-least-once guarantee, signed authenticity, replay protection, and freshness, reusing A6 callback authenticity/replay/freshness and the A6T10/A7T10/B1T10 data-classification matrix.

#### Deliverables

- `docs/B2-WEBHOOK-CONTRACT.md`.
- Registration model: `WebhookRegistrationV1` (registrationId, consumerId, `url` (HTTPS only, allowlisted hosts), events `b2.activation.succeeded` / `b2.activation.suspended` / `b1.commercial.invoice.created` (minimized) / `b2.webhook.test`, states `PENDING_VERIFICATION`→`VERIFIED`→`SUSPENDED`→`REVOKED`, `secretHash` for HMAC, `hmacAlgorithm` `HMAC_SHA256`).
- Delivery model: `WebhookDeliveryV1` (deliveryId, registrationId, event, `bodyHash`, `signature` `sha256=...`, attempt `1..5`, states `ENQUEUED`/`DELIVERED`/`FAILED_RETRYABLE`/`FAILED_PERMANENT`/`DEAD_LETTER`, `nextAttemptAt` with exponential backoff 1s/10s/60s/300s, `responseStatus`/`responseLatencyMs`).
- Verification contract: consumer verifies `X-Monienaija-Signature: sha256=<hex(hmacSha256(secret, body + timestamp))>` + `X-Monienaija-Timestamp` within 300s freshness + `X-Monienaija-Delivery-Id` idempotency; replay beyond idempotency window or mismatched HMAC is `REPLAYED`/`INVALID_SIGNATURE`.
- Delivery guarantee: `OutboxService` durable enqueue + transactional publish after activation/commercial event; retry worker with bounded concurrency (Operations scheduler, owned broker) and dead-letter queue (`b2_webhook_dead_letter`).
- Registration/Delivery persistence where durable (`b2_webhook_registration`, `b2_webhook_delivery`, `b2_webhook_dead_letter`; no raw secret, only `secretHash` stored; `secret` returned once at `PENDING_VERIFICATION`).
- Replay-safe, verification, retry, dead-letter, and sandbox-webhook fixture tests.

#### Acceptance criteria

- `WebhookRegistration` is the only B2 webhook-registration authority; no second registration vault or second webhook scheduler is introduced.
- Registration reaches `VERIFIED` only after a `b2.webhook.test` challenge ping to the registered URL succeeds with a valid `200` + echo of `X-Monienaija-Challenge`; wrong-URL or wrong-response stays `PENDING_VERIFICATION`.
- Every delivery carries `X-Monienaija-Signature` + `X-Monienaija-Timestamp` + `X-Monienaija-Delivery-Id`; consumer can verify with the once-returned secret + HMAC-SHA256 without any raw secret appearing in logs/traces.
- Retry is bounded (at most 5 attempts, last to dead-letter); no unbounded retry loop; a consumer acknowledgement `200` with matching `deliveryId` transitions `DELIVERED` idempotently.
- Replay of a past delivery outside the idempotency TTL or with stale `Timestamp` is `REPLAYED` and never re-executes an activation.
- Webhook events carry only minimized data approved for the consumer's audience (A6T10 classification reused); `CustomerPreference` + marketing consent is honored for any webhook that would cause a notification-class message.

#### Dependencies

- B2T01, B2T02, B2T08, B2T05; A6 callback authenticity/replay/freshness (pattern reuse); A6T10 data-classification/minimization; A2 privileged-action for registration approval where required; `AuditService`/`IdempotencyService`/`OutboxService`/`MetricsService`.

#### Explicitly out of scope

- Inbound partner webhooks (A6); A7 notification delivery beyond the webhook-triggered intent that B2T09 enqueues.
- Implementing activation workflows (B2T05) or credentials (B2T08) beyond consuming them.

### B2T10 — B2 Public API Authentication and B1 Commercial Capability Exposure

- **Type:** Runtime public-surface authentication integration
- **ADR input:** ADR-0082 — B2 Public API Authentication and B1 Capability Exposure (proposed)

#### Objective

Integrate public B2 API authentication with the A2 audience/authorization boundary so that every public commercial route is an A2-protected, quota-aware, rate-limit-aware, consent-gated read of the frozen B1 commercial catalog/plan/tier/entitlement and of the B2 activation state.

#### Deliverables

- `docs/B2-PUBLIC-API-AUTHENTICATION-CONTRACT.md`.
- Authentication flow: `POST /auth/token` exchanges `clientId` + `clientSecret` for an A2-scoped JWT (`aud` = caller audience, `sub` = `consumerId`, `scope` = consumer audience/scope set, `exp` short-lived 15 minutes); every public B2 route validates `aud`/`scope`/`exp` + consumer `ACTIVE` + credential not revoked + consent `GRANTED` (where required) + A4 `ELIGIBLE` + quota + rate limit before admission.
- B1 capability exposure as public resources: `GET /commercial/catalog`, `GET /commercial/plans`, `GET /commercial/activations/{id}` — each reads B1 via approved read-only consumer boundaries (B1T02 catalog, B1T03 tier/entitlement, B1T05 billing where the activation is entitled) without creating a second catalog.
- Consumer-scoped visibility: each consumer sees only its audience-eligible plans/tiers/entitlements/activations; no consumer infers `Customer.id` ownership, A3 bindings, or `CustomerPreference` across consumers.
- Public-route rate-limit/quota/consent-aware tests and B1-consumer fixture tests (no live partner/product call required).

#### Acceptance criteria

- Every public B2 route is A2 audience/scope-protected; an unauthenticated, wrong-audience, expired-token, or wrong-scope request fails closed with `401`/`403` without touching B1 or A4.
- A public `GET /commercial/plans/{planKey}` for a plan outside the consumer's audience/scope is `404` (not `403` leak) and is audit-recorded without leaking plan existence across audiences.
- A public `GET` that would expose billing data for an unactivated or unconsented consumer is `403`/`404` with `REASON_CONSENT_REQUIRED` or `REASON_ACTIVATION_REQUIRED`.
- Public `POST /commercial/activations` that reaches `ACTIVE` has been gated by B2T05 workflow, which in turn gated by B2T03/B2T04 + A3 + A4 + B1 + B2T06 + B2T08.
- No public API path mutates A3 bindings, A4 policy, B1 decisions, or Ledger.
- The public API authentication contract does not create a second session/token vault; it reuses A2 `AuthenticationSession` / `PrivilegedActionApproval` primitives.

#### Dependencies

- B2T01, B2T02, B2T05, B2T06, B2T07, B2T08, B2T09; A2 audience/token verification; A4 policy currentness; A3 binding recency; B1 catalog/plan boundary; `CustomerPreference` delivery intent.

#### Explicitly out of scope

- Credential issuance/rotation/quota/rate-limit issuance (B2T08); webhook delivery (B2T09); activation workflow (B2T05); sandbox/developer onboarding (B2T07) beyond the consumer audience set.

### B2T11 — B2 Activation Rollback, Commercial Disable, and Operational Recovery

- **Type:** Runtime disable/rollback and runbook implementation
- **ADR input:** ADR-0082 (extended) and ADR-0083 — B2 Activation Rollback and Commercial Disable (proposed)

#### Objective

Ensure that B2 activation, the B1 commercial capabilities behind it, and the B2 public surface can be disabled per-cohort, per-consumer, per-route, per-webhook, and per-environment without rewriting A5, A6, A7, B1, or Ledger history, and that the operational recovery runbook records incident classification, evidence sources, decision matrix, support-trace contract, and ownership/stop conditions.

#### Deliverables

- `docs/B2-ACTIVATION-ROUTE-EXPOSURE-AND-ROLLBACK.md` (B2 route exposure review + disable/rollback procedures; B1 route doc remains unchanged).
- Per-type disable: `POST /admin/activations/disable` (cohort), `POST /admin/consumers/{id}/suspend`, `POST /admin/credentials/{id}/revoke`, `POST /admin/routes/{route}/disable`, `POST /admin/webhooks/{id}/suspend`, and environment emergency-stop (`B2_ACTIVATION_ENABLED=false` + A6 circuit-breaker + B1 commercial disable preserved).
- Rollback: `POST /admin/activations/{id}/rollback` transitions `PENDING_*` / `ACTIVE` activations to `SUSPENDED`/`REVOKED` with reason `ROLLBACK`, preserves all completed Ledger/partner/product/commercial histories, and records the rollback as an audit fact.
- `docs/B2-OPERATIONAL-RECOVERY-RUNBOOK.md` (operating principles, evidence sources — `b2_activation`, `b2_api_consumer`, `b2_api_credential`, `b2_webhook_*`, `CustomerConsent`/`MarketingConsent` — incident categories `INC-B2-001..INC-B2-0NN`, recovery procedure `detect→triage→contain→eradicate→recover→document`, decision matrix, support-trace `PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED`, ownership/stop conditions).
- Disable/rollback fixture tests: disable→new request `403`/`429`, rollback preserves history, emergency-stop idempotency, and reconciliation no-mutation proof.

#### Acceptance criteria

- Any B2 disable or rollback preserves all completed `Customer`/`CustomerWallet`, `Merchant`/`Agent`, `CustomerConsent`/`MarketingConsent`, `b2_activation` events, `ApiConsumer`/`ApiCredential`/`ApiQuota`/`WebhookRegistration`/`WebhookDelivery` events, `CustomerPreference` history, Operations audit/idempotency/outbox history, A5 transfer/journal, A6 partner/settlement/suspense, A7 product operation, B1 commercial-decision, and Ledger history.
- A disabled cohort/consumer/route/webhook causes every new matching public request to fail closed with `403`/`404`/`429` and never mutates a source record.
- Rollback never posts a journal, clears suspense, or edits a posted journal/line outside Finance-approved correction.
- The operational recovery runbook classifies at least activation, onboarding, consent, credential, quota, rate-limit, webhook, and public-route incidents and maps each to an owner and a stop condition that blocks the next recovery step until satisfied.
- No B2 disable/rollback introduces a second audit, idempotency, outbox, or reconciliation authority.

#### Dependencies

- B2T01-B2T10; A2 privileged-action; A5 disable patterns; A6 circuit-breaker; B1 commercial disable; Operations audit/idempotency/outbox/metrics/diagnostics; `DISASTER-RECOVERY.md`/`RUNBOOK.md` read-only cross-references.

#### Explicitly out of scope

- Live production disable exercise (documented as a future drill); implementing activation/workflows/credentials/webhooks beyond consuming them.

### B2T12 — B2 Integration, Cohort Certification, Release Gate, and B3 Handoff

- **Type:** Integration and phase-exit evidence
- **ADR review:** the proposed B2 ADR range (ADR-0072 through ADR-0083)

#### Objective

Validate the complete B2 customer-activation and public commercial platform for the bounded first activation cohort and prepare the B2 release gate and the B3 handoff without beginning B3 scale/selective extraction/cloud/observability/multi-region/cross-currency/second-scope/second-partner work.

#### Deliverables

- `docs/B2-INTEGRATION-MATRIX.md` (task-to-evidence matrix B2T01→B2T12 + A1→B2 end-to-end trace).
- `docs/B2-ADR-REVIEW-STATUS.md` (proposed B2 ADR range vs committed evidence; any unauthored required ADR = blocker).
- `docs/B2-OPERATIONAL-RECOVERY-RUNBOOK.md` (if not already frozen at B2T11, then validated here).
- `docs/B2-EXIT-CHECKLIST.md` (acceptance checklist, unresolved blockers, explicit B2 phase result).
- `docs/B2-APPROVAL-PACKAGE.md` (owner approval register, no-go/go recommendation, go conditions, explicit non-claims, implementation-vs-production distinction).
- `docs/B2-B3-HANDOFF-PACKAGE.md` (bounded handoff to B3, prohibited edges, B3 entry conditions, blocked handoff status).
- `docs/B2-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md` (route exposure review + rollback-safe procedure; `partner-callback.controller` remains A2-protected; every new B2 public route is authenticated/rate-limited/quota-gated; no new notification channel is wired).
- End-to-end identity→binding→policy→B1-commercial→activation→public-API→webhook→reconciliation trace for the first activation cohort.
- Certification fixtures covering customer/merchant/agent onboarding verification, activation workflow, consent-gating, consumer/credential/quotas/rate-limit, sandbox doc/versioning, webhook registration/delivery/verification, and disable/rollback.
- Cross-reference with `B1-B2-HANDOFF-PACKAGE.md` entry conditions shown satisfied.

#### Acceptance criteria

- The first activation cohort maps to A1 identity, A2 audience, A3 binding, A4 eligibility, A5 ledger, A6 partner `NIBSS_NIP`, A7 product `VIRTUAL_ACCOUNT` v1, B1 plan `commercial.virtual-account.inbound-funding` v1, B2 activation workflow, B2 consent, B2 consumer/credential/quotas/rate-limits, B2 webhook registration, and read-only B2 reconciliation.
- One verified activation produces at most one traceable B2 activation effect that consumes exactly one B1 commercial-decision context and is reconcilable without source mutation.
- Duplicate/changed-payload/rejected/expired/replayed/delayed/circuit-open/throttled/quota-exceeded/consent-revoked/disabled public operations have deterministic safe outcomes (`REPLAYED`/`CONFLICTED`/`REJECTED`/`EXPIRED`/`THROTTLED`/`EXCEEDED`).
- B2 reconciliation reconciles to B1 commercial decisions, A5 ledger, A6 partner, A7 product, and the B2 activation/webhook/credential state without direct source mutation.
- Support can trace a B2 activation/credential/webhook while raw secrets (credential secret, webhook secret), PANs, PINs, OTPs, callback signatures, partner confidential material, and unrestricted risk/compliance data remain protected.
- Disable/circuit-breaker/activation-rollback controls stop new public activity without rewriting completed history.
- Activation-specific logic is isolated from canonical Customer, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, Operations, and Reconciliation authorities.
- No unapproved second activation cohort, second B1 scope, second partner, public route without A2 audience, or broad customer activation is included.
- All unresolved B2 risks have an owner, severity, mitigation, stop condition, certification requirement, and rollback behavior.
- B3 handoff conditions are explicit and do not claim that B2 proves all future scale/region/capacity/partner/cohort behavior.

#### Dependencies

- B2T01-B2T11; A1-A7 + B1 phase artifacts and handoff packages; Finance/Ledger/Tax/Security/Privacy/Legal/Risk/Compliance/Operations/Reconciliation/Support/Product/Commercial/Partner review inputs.

#### Explicitly out of scope

- B3 cloud/observability extraction, multi-region, cross-currency, second scope/partner, selective service extraction, production ramp.

## 9. B2 critical path

```text
B2T01 Activation baseline and first activation cohort selection
  -> B2T02 Public API catalog and route-exposure contract
  -> B2T03 Customer onboarding extension for activation
  -> B2T04 Merchant and agent onboarding
  -> B2T05 Commercial activation workflows, public commercial routes, commercial self-service
  -> B2T06 Customer consent and marketing consent
  -> B2T07 API documentation, versioning, sandbox, developer onboarding
  -> B2T08 API credentials, consumers, quotas, rate limiting
  -> B2T09 Webhook registration, delivery, verification
  -> B2T10 Public API authentication and B1 capability exposure
  -> B2T11 Activation rollback, commercial disable, operational recovery
  -> B2T12 Integration, cohort certification, release gate, B3 handoff
```

B2T01 must select the single first activation cohort before any B2 implementation. B2T02 must freeze the public catalog/route contract before any B2 public behavior. B2T03 (customer activation-readiness) and B2T04 (merchant/agent onboarding) may proceed in parallel after B2T02 but both must be ADS-ready before B2T05 activation workflows can consume them. B2T06 (consent) may be built in parallel with B2T03-B2T04 but must be committed before any `ACTIVE` activation. B2T07 (docs/versioning/sandbox/developer) and B2T08 (credentials/quotas/rate limits) and B2T09 (webhooks) may be designed in parallel because they share the B2 consumer identity, but no `ACTIVE` activation or public B1 read beyond the catalog may be admitted before B2T07 + B2T08 + B2T10's audience checks exist. B2T10 (public API authentication) integrates A2 audience with every public route and must follow B2T02/B2T07/B2T08. B2T11 (disable/rollback) is cross-cutting and is committed before B2T12 can gate. B2T12 is blocked until B2T01-B2T11 evidence is complete. B3 remains outside B2 and may not begin until the B2 release gate and B2→B3 handoff are independently approved.

## 10. B2 integration trace

```text
A1 canonical ownership / identifier / privacy / retention / legal-hold / cross-cutting contracts
                         |
                         v
A2 authenticated principal / protected internal + public surface
  audience / scope / assurance / privileged-action
                         |
                         v
A4 current capability decision (B2 supplies activation-eligibility data; A4 remains policy authority)
  capability / action + policy version + tier / entitlement / limit / obligation + expiry
                         |
                         v
A3 internal account / customer-binding recheck (B2 supplies activation-binding data; A3 remains binding authority)
  Customer.id -> CustomerWallet -> A3 binding -> WalletAccount -> LedgerAccount
                         |
                         v
B1 catalog / plan boundary commercial.virtual-account.inbound-funding v1
  pricing / fee / commission / billing / campaign / referral / revenue / classification (read-only consumer)
                         |
                         v
B2 customer onboarding (B2T03) / merchant + agent onboarding (B2T04)
  PENDING_VERIFICATION -> VERIFIED -> SUSPENDED / REVOKED (A2-approved)
                         |
                         v
B2 customer consent + marketing consent (B2T06) + CustomerPreference.notifications
  GRANTED / REVOKED / EXPIRED (legal-hold aware)
                         |
                         v
B2 activation workflow (B2T05) consuming onboarding attestations + consent + A4 + A3 + B1
  POST /commercial/activations (idempotent) -> PENDING_* -> ACTIVE -> SUSPENDED / REVOKED
                         |
                         v
B2 developer onboarding (B2T07) -> B2 consumer + credential (B2T08)
  ApiConsumer ACTIVE + ApiCredential ISSUED/ROTATED (secretHash only) + audience/scope
                         |
                         v
B2 quota + rate limiting (B2T08) -> token bucket (allowed / throttled / exceeded)
                         |
                         v
A2 public authentication (B2T10) for every public B2 route
  aud / scope / exp + consumer ACTIVE + credential not revoked + consent + quota + rate limit
                         |
                         v
B2 public commercial routes (B2T05/T10): GET /commercial/catalog | plans | tiers (minimized, audience-scoped)
                         |
                         v
B2 API documentation + versioning (B2T07): OpenAPI v1 + Accept/Sunset negotiation + sandbox isolation
                         |
                         v
B2 webhook registration (B2T09): PENDING_VERIFICATION (challenge ping) -> VERIFIED
  HMAC_SHA256(secretHash), HTTPS-only, idempotency registration
                         |
                         v
B2 webhook delivery (B2T09): Outbox enqueue -> ENQUEUED -> DELIVERED (200 echo) / FAILED_RETRYABLE -> DEAD_LETTER
  X-Monienaija-Signature + Timestamp (300s freshness) + Delivery-Id (replay protection, 5 attempts, exponential backoff)
                         |
                         v
A7 product notification dispatcher (A7T06) under CustomerPreference.notifications
  delivery intent (outbox) -> delivery fact (audit) -> deduplication (idempotency), marketing-consent gated
                         |
                         v
Operations + independent control evidence
  audit + idempotency + transactional outbox + metrics + diagnostics
  B1 commercial decisions + B2 activations + webhook deliveries + credentials + quotas
  A6T09 / A7T09 external/product reconciliation read-only; B1T09 read-only; B2 read-only reconciliation
                         |
                         v
B2 disable / rollback / commercial disable control
  per-cohort / per-consumer / per-route / per-webhook / environment emergency-stop
  Ledger / A5 / A6 / A7 / B1 history preserved
```

The chain above is the only B2 public-activation authority chain. A B2 activation, credential, webhook, consent, public-route hit, quota grant, or rate-limit bucket cannot become financial truth, an A2 authorization, an A3 binding repair, an A4 policy decision, a B1 commercial decision, an A5 ledger record, an A6 settlement/suspense, an A7 product operation, an Operations audit/idempotency/outbox mutation, or a `CustomerPreference` mutation without the owning boundary's verification.

## 11. B2 prohibited edges

- B2 treats an activation, credential, webhook registration/delivery, sandbox session, API version, quota allotment, rate-limit bucket, or public-route hit as canonical `Customer`/`Merchant`/`Agent` identity, A2 authorization, A3 binding, A4 policy, A5 ledger, A6 partner, A7 product, B1 commercial decision, `CustomerPreference` intent, or marketing-consent intent.
- B2 selects a `WalletAccount`/`LedgerAccount` from a customer/merchant/agent reference, consumer/credential reference, activation reference, webhook reference, or commercial reference.
- B2 writes `Customer`, `CustomerWallet`, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding, A4 policy/source, `CustomerPreference`, `CustomerConsent`, or `MarketingConsent` records to make an activation pass.
- B2 embeds a second risk/compliance/sanctions/fraud/eligibility/limit precedence engine.
- B2 calls a bank/NIBSS/provider, SMS/email/push provider, or any external channel from Customer/Wallet/Ledger/A5/A6/A7T06/Reconciliation/diagnostics/readiness/support or an unapproved controller instead of the A6 partner boundary or the A7T06 notification dispatcher or the B2 webhook delivery boundary (only `b2-webhook` is permitted to call a consumer webhook URL).
- B2 accepts an unauthenticated, stale, replayed, malformed, wrong-audience, wrong-environment, wrong-consent, or wrong-consumer activation, credential exchange, webhook registration, or webhook delivery receipt.
- B2 retries an ambiguous activation outcome with a new activation/credential/webhook identity without verified A2/A4/A3/B1/B2 reconciliation evidence.
- B2 posts a journal, mutates a balance, clears suspense, or edits a posted journal/line outside Ledger and Finance-approved correction boundaries.
- B2 treats a public acknowledgement, webhook `200`, credential issuance, or activation `ACTIVE` as settled value or credits/debits a customer before approved A5 ledger evidence exists.
- B2 creates an independent activation-reconciliation, credential-reconciliation, webhook-reconciliation, consent-reconciliation, quota-reconciliation, rate-limit-reconciliation, audit, idempotency, outbox, metrics, diagnostics, notification, tier, entitlement, consent, retention, legal-hold, secret, disclosure, or release-gate authority.
- B2 stores raw credentials, `clientSecret`, webhook secret, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, or unnecessary customer data in broad records, logs, traces, events, or webhook bodies.
- B2 exposes a public route without A2 audience/scope on that route.
- B2 broadens the first activation cohort, the A6 partner dependency, the A7 product boundary, or the B1 fixed scope without a separate reviewed capability decision and release boundary.
- B2 mutates completed A5 transfer, A6 settlement/suspense/journal, A7 product operation, B1 commercial decision, or Ledger history for activation/credential/consent/webhook/route correction.
- B2 begins B3 scale/selective extraction/cloud/observability/multi-region/cross-currency/second-scope/second-partner beyond `NIBSS_NIP` or production ramp beyond the separately approved release boundary.
- B2 converts an activation, credential, webhook, or public-route hit into a financial command, A2 authorization, A3 binding repair, A4 policy decision, B1 commercial decision, or Ledger record.

## 12. B2 phase exit criteria

B2 implementation is complete only when:

- The first activation cohort has an explicit cohort key, segment rule, capability, currency (`NGN`), accounting unit (`CUSTOMER_FUNDS`), data, consent purposes, internal activation owner, partner dependency, prohibited-edge/adjacent-cohort/adjacent-channel list, and notification/support/reporting contract for `commercial.virtual-account.inbound-funding` v1.
- The B2 public API catalog and route-exposure contract are stable and prevent public-surface behavior from becoming a source authority in canonical modules.
- Activation-eligibility data extends, not replaces, A4 precedence; verified activation-eligibility is `READINESS` only, not `ELIGIBLE`.
- Activation-binding data extends, not replaces, A3 recheck; B2 never repairs or reassigns a binding from public input.
- B2 activation, consumer, credential, sandbox, webhook-registration, webhook-delivery, API version, quota, rate-limit, customer-consent, and marketing-consent identifiers remain distinct and queryable and never overlap B1/A6/A7/A5 identifiers.
- Activation, credential, webhook-registration, webhook-delivery, consent, quota, and rate-limit events honor `CustomerPreference.notifications` and the A6T10/A7T10/B1T10 plus B2 classification controls; no B2 engine becomes an A2/A3/A4/A5/A6/A7/B1 authority.
- Customer, merchant, and agent onboarding are bounded, approval-gated, and support-traceable; merchant/agent `VERIFIED` requires evidence and is never inferred.
- Activation workflows, public read routes, self-service suspend/revoke, and consent-gated transitions are bounded, audit-recorded, and replay-safe.
- API documentation is the SSOT for every public route; API versioning negotiates deterministically (`406`/ `Deprecation`/`Sunset`); sandbox is partition-isolated (`sandbox` never leaks to `production`); developer onboarding links `Developer.id`→`ApiConsumer` without storing raw secrets.
- Consumer/credential/quotas/rate-limit lifecycle is bounded; raw secrets are never stored or logged; `401`/`403`/`429` with `Retry-After`/`X-RateLimit-*`/`X-Quota-*` is deterministic and never bypasses A2/A4/consent.
- Webhook registration is challenge-verified (`PENDING_VERIFICATION`→`VERIFIED` via `b2.webhook.test` echo); webhook delivery is at-least-once, signed (HMAC-SHA256), replay-protected (`Delivery-Id`), freshness-checked (300s), bounded-retry (5, exponential backoff, dead-letter), and audit-traced without leaking raw secrets.
- Public API authentication verifies `aud`/`scope`/`exp` + consumer `ACTIVE` + credential liveness + consent + quota + rate limit on every public B2 route; B1 capabilities are exposed as authenticated, consented, rate-limited resources with audience-scoped visibility (wrong-audience is `404`, not `403` leak).
- Activation/credential/webhook/route/consumer disable and environment emergency-stop stop new public activity without rewriting A5/A6/A7/B1/Ledger history.
- Independent B2 reconciliation (read-only, REPEATABLE READ) detects missing/duplicate/orphan/delayed/mismatched/stale/unresolved activation/credential/quota/rate-limit/webhook/public-route evidence without writing source records, using a frozen, severity-classified, owner-assigned discrepancy vocabulary.
- B2 certification fixtures and tests cover activation, verification, consent, idempotency, credential lifecycle, quota/rate-limit, documentation/versioning/sandbox, webhook registration/delivery/verification, authentication, and rollback/disable.
- Data sharing, consent, retention, legal-hold, secret, support, and customer/internal disclosure controls are explicit and tested at the public boundary via the A6T10/A7T10/B1T10 + B2 register.
- B2 disable/rollback controls are fixture-proven; no production mutation of financial history.
- A1, A2, A3, A4, A5, A6, A7, B1, B2, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Support, Commercial, and `CustomerPreference`/`CustomerConsent`/`MarketingConsent` authorities remain separate.
- No B3 scale/selective extraction/cloud/observability/multi-region/cross-currency/second-scope/second-partner beyond `NIBSS_NIP` or production ramp is included.
- B2→B3 handoff is documented without claiming that B2 proves all future scale/region/capacity/cohort/partner behavior.

## 13. B2 release criteria

B2 may be promoted from **Prepared** to **Approved** only when, in addition to §12, all of the following release criteria are independently reviewed and signed:

- All B1 release-gate approvals remain `Approved` and have not been invalidated by any B2 change to shared contracts (catalog/route/consent/data-classification).
- All public B2 routes appear in the frozen `B2-OPENAPI-v1.yaml` and all OpenAPI operations appear in the public catalog; OpenAPI lint (`@readme/openapi` or equivalent) and `npm run lint` for the B2 contract files pass.
- The cohort definition (§12 first bullet) is signed by Commercial/Product/Architecture and is reconciled to `B1-IMPLEMENTATION-PLAN.md` first scope `commercial.virtual-account.inbound-funding` v1 and to the B1-B2 handoff entry conditions.
- The verification evidence for customer/merchant/agent onboarding is approved by Legal/Risk/Compliance/Operations (KYC/tax/registration fixtures approved; no live corporate-registry bypass).
- The consent purposes (`B2_ACTIVATION`, `B2_COMMERCIAL`, `MARKETING_COMMERCIAL_OFFER`) are approved by Privacy/Security/Legal and are registered in A6T10 with explicit retention/legal-hold.
- The A2 audience/scope matrix for every public B2 route is approved by Security/Architecture (every route carries a non-`public` audience, no unauthenticated commercial mutation).
- The credential secret handling (hash-only storage, single-time secret return, 5-minute rotation grace window) is approved by Security with evidence that no raw secret appears in logs/traces.
- The webhook HMAC-SHA256, freshness 300s, replay `Delivery-Id`, bounded retry 5, dead-letter, and HTTPS-only allowlist are approved by Security/Privacy (raw webhook secret appears once at registration, then hash only).
- The rate-limit token-bucket capacities and quota windows are approved by Product/Commercial/Operations and are fixture-proven (`429` with `Retry-After`/`X-RateLimit-*`/`X-Quota-*`).
- The disable/rollback procedures (§11) are approved by Operations/Reconciliation/Support and are fixture-proven (new requests fail closed, history preserved).
- Finance/Ledger/Tax approve that B2 activation never becomes a ledger posting outside approved correction boundaries (A5 ledger authority preserved).
- Local automated validation passes: `npm test`, `npm run lint`, `npm run build`, `npm run format:check` at the B2T12 commit with a clean working tree; migration ordering `src/migrations` still contiguous (`1785753600031..0038` for B1 plus B2 `17…` series with no interleave).
- Documentation cross-references resolve (every `](*.md)` link target committed).

No criterion may be waived; any `Pending`/`Blocked` criterion sustains the `Prepared — not approved` release result.

## 14. B2 handoff to B3

B2 may provide B3 with:

- the B2 activation baseline, cohort key/version, segment rule, and prohibited adjacent cohorts/channels;
- the B2 public API catalog/route-exposure contract, OpenAPI v1, versioning contract (`v1` + `Accept` + `Deprecation`/`Sunset`), and sandbox contract;
- the B2 customer/merchant/agent onboarding and activation-readiness attestations (not mutable onboarding decisions);
- the B2 activation workflows, states `PENDING_*`/`ACTIVE`/`SUSPENDED`/`REVOKED`/`REJECTED`, and self-service;
- the B2 `CustomerConsent`/`MarketingConsent` intent authorities and the `CustomerPreference` delivery-intent consumption pattern;
- the B2 developer-onboarding, documentation, versioning, sandbox, consumer, credential (hash-only), quota, and rate-limit contracts;
- the B2 webhook-registration/delivery/verification contract (HMAC-SHA256, freshness, replay, bounded retry, dead-letter);
- the B2 public API authentication and B1 capability exposure patterns (A2 audience/scope + consent + quota + rate limit on every public route);
- the B2 activation-rollback, commercial-disable, route-disable, consumer-suspend, webhook-suspend, and environment emergency-stop procedures and runbook.

B2 must not provide B3 with:

- A2 session secrets, credential `clientSecret`, webhook `secret`, bank/NIBSS/partner tokens, certificates, signing keys, callback secrets, partner confidential material, or unrestricted risk/compliance evidence;
- raw KYC/risk/compliance/investigative/security/device/support-restricted data or customer PIN/OTP payloads;
- mutable balances, posted journal/line data as a new source of truth, or financial correction authority;
- permission to treat an activation reference, consumer reference, credential reference, webhook registration/delivery reference, API version, quota grant, rate-limit bucket, or public-route hit as ledger truth;
- permission to bypass A1 identity, A2 authorization, A3 binding, A4 policy, A5 lifecycle, A6 partner, A7 product, B1 commercial, Ledger, Operations, or Reconciliation controls;
- second activation cohort, second B1 scope, second partner, public route without A2 audience, or broad customer activation.

B3 remains responsible for scale/selective extraction, cloud/observability extraction, multi-region, cross-currency, second scope/partner, partner marketplace, capacity/fan-out, and production ramp. B3 may not begin until the B2 release gate and B2→B3 handoff are independently approved.

## 15. B2 plan verification record

- [x] Official phase title is B2 — Customer Activation and Public Commercial Platform.
- [x] B2 is positioned after B1 and before B3; implementation order `A1→A2→A3/A4→A5→A6→A7→B1→B2` is explicit.
- [x] B2 requires one bounded first activation cohort for the frozen `commercial.virtual-account.inbound-funding` v1 instead of an implicit multi-cohort/catalog.
- [x] A1, A2, A3, A4, A5, A6, A7, B1, Wallet, Ledger, Operations, Outbox, Reconciliation, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Support, Product, Commercial, and `CustomerPreference`/`CustomerConsent`/`MarketingConsent` dependencies are explicit.
- [x] Public API catalog and route-exposure contract keep public-surface behavior outside canonical authorities.
- [x] Activation/customer/merchant/agent onboarding extend, not replace, Customer/A3 verification and A2 approval.
- [x] Activation-eligibility data extends, not replaces, A4 precedence; activation `ACTIVE` requires A4 `ELIGIBLE`.
- [x] Consent is explicit, revokable, and distinct: `CustomerConsent` + `MarketingConsent` (intent) alongside `CustomerPreference.notifications` (delivery intent); webhook/activation dispatch honors both.
- [x] Every public B2 route carries an A2 audience/scope; no unauthenticated public commercial mutation exists.
- [x] B2 never stores raw secrets (credential secret, webhook secret, PAN, PIN, OTP, callback signature, private key) in broad records/logs/traces/events/webhook bodies.
- [x] B2 commercial exposure is a constrained read of the frozen B1 plan; B2 never becomes a B1 fee/billing/campaign/referral/revenue/tax/analytics authority.
- [x] Webhook registration/delivery/verification reuse A6 callback authenticity/replay/freshness and the A6T10/A7T10/B1T10 data-classification matrix.
- [x] B2 reconciliation is read-only with respect to all source records.
- [x] Data sharing, consent, retention, legal-hold, secret, and disclosure controls reuse A6T10/A7T10/B1T10 and A1 cross-cutting controls; B2 does not invent a parallel consent or privacy vault.
- [x] B2 prohibited edges, disable/rollback boundaries, B3 handoff, and B3 exclusion are explicit.
- [x] Proposed B2 ADR range ADR-0072..ADR-0083 is documented and does not renumber existing ADRs (ADR-0047..ADR-0052 A6; ADR-0053 A6T09; ADR-0054..ADR-0060 A7; ADR-0061..ADR-0071 B1).
- [x] No application source, entity, migration, service, controller, API, route, scheduler, credential, secret, webhook, sandbox, public surface, activation, or runtime behavior is created by this planning task.

## 16. B2T01 plan evidence record (placeholder)

B2T01 will record:

- [ ] `docs/B2-ACTIVATION-BASELINE.md` — the first activation cohort selection, gap register, risk/certification/rollback register, and compatibility classification.

## 17. B2T12 plan evidence record (placeholder)

B2T12 will record:

- [ ] `docs/B2-INTEGRATION-MATRIX.md` — end-to-end task-to-evidence matrix and the `A1→A2→A4→A3→A6→A7T05→A7T07→A7T08→A7T09→B1T04→B1T05→B1T08→B1T09→B2T05→B2T08→B2T09→B2T10` trace for the first activation cohort.
- [ ] `docs/B2-COMMERCIAL-ROUTE-EXPOSURE-AND-ROLLBACK.md` — B2 public-route exposure review, B2 per-cohort/per-consumer/per-route/per-webhook disable, environment emergency-stop, and rollback-safe procedure; every new B2 public route is A2 audience/scope-protected, rate-limited, quota-gated; no new notification channel is wired outside A7T06.
- [ ] `docs/B2-ADR-REVIEW-STATUS.md` — review of ADR-0072..ADR-0083 against committed evidence; any required unauthored ADR is a release-gate blocker.
- [ ] `docs/B2-OPERATIONAL-RECOVERY-RUNBOOK.md` — operating principles, evidence sources, incident classification, recovery procedure, decision matrix, support-trace contract, and ownership/stop conditions for the first activation cohort and the shared B2 public platform.
- [ ] `docs/B2-EXIT-CHECKLIST.md` — B2 acceptance checklist, unresolved blockers, and explicit B2 phase result.
- [ ] `docs/B2-APPROVAL-PACKAGE.md` — owner approval register, no-go/go recommendation, go conditions, and explicit non-claims.
- [ ] `docs/B2-B3-HANDOFF-PACKAGE.md` — bounded handoff to B3, prohibited edges, B3 entry conditions, and blocked handoff status.
- [ ] Local automated validation passes: `npm test`, `npm run lint`, `npm run build`, `npm run format:check`.
- [ ] B2T12 introduces no application source, entity, migration, service, controller, API, route, scheduler, credential, secret, webhook, sandbox, public surface, activation, or runtime behavior beyond the documented evidence package.
- [ ] B2T12 does not begin B3 or any scale/selective-extraction/multi-region/cross-currency/second-scope/second-partner beyond the first activation cohort.
