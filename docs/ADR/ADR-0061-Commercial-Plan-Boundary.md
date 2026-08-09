# ADR-0061 — Commercial Plan Boundary

- **ADR ID:** ADR-0061
- **Phase:** B1 — Commercial Platform
- **Task:** B1T02 — B1 Commercial Catalog and Plan-Boundary Contract
- **Status:** Proposed B1 implementation decision; B1T02 contract design only, no B1 runtime catalog, commercial-boundary, pricing, fee, commission, revenue-sharing, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition, tax / VAT, cost-accounting, profitability, analytics, feature flag, approval, or reconciliation implementation introduced
- **Date:** 2026-08-09
- **Scope:** B1 commercial catalog, commercial-boundary contract, first commercial scope frozen registration, commercial identity vocabulary, commercial catalog versioning, commercial capability registration, commercial plan registration, commercial package registration, commercial bundle registration, commercial dependency declaration, compatibility rules, ownership boundaries, consumer contracts, version negotiation rules, fail-closed behavior, prohibited dependencies, integration boundaries, replay expectations, and compatibility with future commercial scopes
- **Authoritative boundary:** `CommercialCatalogContractV1` / `CommercialBoundaryContractV1` per [`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`](../B1-COMMERCIAL-CATALOG-CONTRACT.md)
- **Selected first commercial scope (frozen registration):** `commercial.virtual-account.inbound-funding` v1 / `commercial.virtual-account.inbound-funding.fee` and `commercial.virtual-account.inbound-funding.commission` (revenue sharing) / inbound funding to provider-backed virtual account / `NGN` / `CUSTOMER_FUNDS` / under the existing A7 first product `VIRTUAL_ACCOUNT` v1 / under the existing A6 partner `NIBSS_NIP` planning rail
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, product, financial-runtime, public-channel, and B2 changes:** None

This ADR is the decision record for the B1T02 commercial-catalog and commercial-boundary contract. It records the catalog freeze, the first commercial scope's frozen registration, the commercial dependency declaration, the commercial compatibility rules, the commercial ownership boundaries, the commercial consumer contracts, the commercial version negotiation rules, the commercial fail-closed behavior, the commercial prohibited dependencies, the commercial integration boundaries, the commercial replay expectations, and the commercial compatibility with future commercial scopes. It introduces no new runtime code, entity, migration, service, controller, API, route, scheduler, notification dispatcher, public surface, pricing, fee, commission, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition, tax / VAT, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, release gate, or B2 work.

## 1. Context

B1T01 established the first bounded B1 commercial scope (`commercial.virtual-account.inbound-funding` v1, inbound funding, `NGN`, `CUSTOMER_FUNDS`, under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail) and recorded the A1-A7 handoff entry conditions, the B1 commercial-adjacent gap register, the B1 commercial-adjacent module compatibility classification, the B1 dependency map, the B1 authority and ownership matrix, the B1 implementation assumptions and exclusions, the B1 prohibited edges, the B1 rollback assumptions, the B1 stop conditions, and the B1T02 entry conditions. B1T01 is documentation-only and does not implement the B1 commercial catalog or the B1 commercial-boundary contract.

B1T02 must define the B1 commercial catalog, the B1 plan-boundary contract, the B1 commercial-extension points, the first commercial scope's frozen registration, the commercial catalog's compatibility rules, the commercial consumer contracts, the commercial version negotiation rules, the commercial fail-closed behavior, the commercial prohibited dependencies, the commercial integration boundaries, the commercial replay expectations, and the commercial compatibility with future commercial scopes. B1T02 must keep commercial-specific behavior outside Customer, `CustomerPreference`, A2, A3, A4, A5, A6, A7, Wallet, Ledger, and Operations authorities.

The repository does not currently have a B1 commercial catalog, a B1 commercial-boundary contract, or a B1 commercial module. The A1-A7 implementation artifacts are committed and unchanged; the A7 release-gate evidence package is `Prepared, not approved, not certified, not activated, not handed off to A8`.

## 2. Problem statement

B1 must add bounded commercial capabilities one at a time under the common A1 canonical ownership, A2 authorization, A3 binding, A4 policy, A5 internal lifecycle, A6 partner, A7 product, Wallet, Ledger, Operations, and `CustomerPreference` contracts. Without a shared B1 commercial catalog and B1 plan-boundary contract, commercial-specific behavior would have to be implemented in each commercial engine, and commercial-specific engines would have to reach into `fee`, `quote`, `limit`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, `settlement-account`, `ledger`, `partner`, `reconciliation`, the A7 product layer, or other canonical modules to discover what they may do. That pattern would silently re-broaden A6, re-introduce competing source authorities, and make B1 release-gate evidence impossible to evaluate.

The B1 commercial catalog and B1 plan-boundary contract must therefore:

- provide one explicit B1 commercial catalog and B1 plan-boundary contract that prevent commercial-specific behavior from becoming a source authority in Customer, `CustomerPreference`, Wallet, Ledger, A2, A3, A4, A5, A6, A7, Operations, or Reconciliation;
- record the first commercial scope (`commercial.virtual-account.inbound-funding` v1) as a single frozen registration with explicit commercial dependency declaration, commercial compatibility rules, commercial ownership boundaries, commercial consumer contracts, commercial version negotiation rules, commercial fail-closed behavior, commercial prohibited dependencies, commercial integration boundaries, commercial replay expectations, and commercial compatibility with future commercial scopes;
- declare the existing A7 first product `VIRTUAL_ACCOUNT` v1, the existing A6 partner `NIBSS_NIP` planning rail, the existing A6T10 data-classification matrix, the existing A6T09 external reconciliation, the existing A7T09 product reconciliation, the existing A7T08 product financial effect, the existing A7T06 product notification delivery, and the existing `CustomerPreference` as the only commercial dependencies for the first commercial scope;
- declare the shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, and `DiagnosticsService` as the only operations dependencies for the first commercial scope;
- fail closed on any prohibited edge, second commercial scope, second commercial partner, second authority, or unapproved capability;
- preserve A1, A2, A3, A4, A5, A6, A7, Wallet, Ledger, Operations, Reconciliation, and `CustomerPreference` as separate authorities; and
- be deterministic, idempotent, sandbox/fixture-testable, and B2-exclusion-aware.

## 3. Decision

B1T02 freezes `B1-COMMERCIAL-CATALOG` v1 and `B1-COMMERCIAL-BOUNDARY` v1 with the following decisions:

### 3.1 B1 commercial catalog and commercial-boundary contracts

- B1 introduces `CommercialCatalogContractV1` and `CommercialBoundaryContractV1` as the shared B1 commercial catalog and B1 commercial-boundary interface designs.
- `CommercialCatalogContractV1` exposes `getRegistration`, `listRegistrations`, `assertCompatible`, `getPlan`, `getPackage`, and `getBundle`. The catalog is read-only, deterministic, and idempotent.
- `CommercialBoundaryContractV1` exposes `execute` and `getCapabilities` and `assertCompatible`. The boundary is a contract design; B1T02 does not implement it.
- Domain modules consume the catalog and the boundary rather than reaching into `fee`, `quote`, `limit`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, `settlement-account`, `ledger`, `partner`, `reconciliation`, the A7 product layer, or any other canonical module directly.

### 3.2 First commercial scope frozen registration

- The first commercial scope is `commercial.virtual-account.inbound-funding` v1, the only ACTIVE entry in `B1-COMMERCIAL-CATALOG` v1.
- The first commercial scope has two capabilities: `commercial.virtual-account.inbound-funding.fee` and `commercial.virtual-account.inbound-funding.commission` (revenue sharing).
- The first commercial scope is inbound funding only, `NGN` only, `CUSTOMER_FUNDS` only, under the existing A7 first product `VIRTUAL_ACCOUNT` v1, under the existing A6 partner `NIBSS_NIP` planning rail.
- The first commercial scope has a closed commercial-state vocabulary (`COMMERCIAL_DECISION_PENDING`, `COMMERCIAL_DECISION_ADMITTED`, `COMMERCIAL_DECISION_SUPPRESSED`, `COMMERCIAL_DECISION_FAILED`, `COMMERCIAL_DECISION_REPLAYED`, `COMMERCIAL_DECISION_DISABLED`) and a closed set of prohibitions (second commercial scope, second commercial partner, second currency, second accounting unit, second customer tier, second merchant tier, second partner tier, second product entitlement, second feature flag, second dynamic limit, second subscription plan, second product package, second bundle, public commercial surface, public commercial API, mobile commercial channel, web commercial channel, marketing-consent surface, customer-cohort expansion, merchant-cohort expansion, partner-cohort expansion, cross-region rollout, cross-currency rollout, second commercial authority, B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, B2 broad customer activation, A8 scale / extraction, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, A8 notification channel implementation).

### 3.3 Commercial dependency declaration

- The first commercial scope declares ten explicit commercial dependencies: A1 canonical ownership, A6T10 data classification, A7T05 product command, A7T08 product financial effect, A5 Ledger, A4 policy, A3 binding, `CustomerPreference`, A6 partner `NIBSS_NIP`, and Operations audit.
- The first commercial scope does not declare any other commercial dependency; any additional commercial dependency requires a separate B1 cycle plus a separate B1 ADR.

### 3.4 Commercial compatibility rules

- The first commercial scope records eight explicit commercial compatibility rules: currency must equal `NGN`, accounting unit must equal `CUSTOMER_FUNDS`, partner dependency must equal `NIBSS_NIP`, product dependency must equal `VIRTUAL_ACCOUNT` v1, capability must be one of the registered capabilities, currency / accounting unit / partner dependency / product dependency combination must be in the B1T03 catalog, effective-from / effective-to must be in the B1T03 catalog, and customer tier / merchant tier / partner tier / entitlement / feature flag / dynamic limit must be in the B1T03 catalog.

### 3.5 Commercial ownership boundaries

- B1 is a read-only consumer of A1, A2, A3, A4, A5, A6, A7, `CustomerPreference`, A6T10, A6T09, A7T09, A7T08, A7T06, and the shared Operations services.
- B1 does not introduce a second canonical identity, a second audit authority, a second idempotency authority, a second outbox authority, a second metrics authority, a second diagnostics authority, a second customer-binding authority, a second policy authority, a second authorization authority, a second notification authority, a second settlement authority, a second suspense authority, a second compensating-entry authority, a second reconciliation authority, a second classification authority, a second retention authority, a second legal-hold authority, a second secret authority, a second disclosure authority, a second support-trace authority, a second partner-payload-validation authority, a second Ledger authority, a second Wallet authority, a second product authority, a second partner authority, a second `CustomerPreference` authority, or a second commercial authority in any of the above domains.

### 3.6 Commercial consumer contracts

- B1T02 defines the B1 commercial consumer contracts: A1 read-only consumer contract, A2 read-only consumer contract, A3 read-only consumer contract, A4 read-only consumer contract, A5 read-only consumer contract, A6 read-only consumer contract, A7 read-only consumer contract, `CustomerPreference` and A6T10 read-only consumer contract, A6T09 read-only consumer contract, A7T09 read-only consumer contract, A7T08 read-only consumer contract, A7T06 read-only consumer contract, and Operations read-only consumer contract.
- The consumer contracts are a contract design; B1T02 does not implement the consumer contracts runtime.

### 3.7 Commercial version negotiation rules

- B1T02 defines the B1 commercial version negotiation rules: the boundary MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION` for any version mismatch; the boundary MUST respond with the current registration for any version match; cross-catalog negotiation (e.g., `B1-COMMERCIAL-CATALOG` v1 against `B1-COMMERCIAL-CATALOG` v2) is out of scope and MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION`.

### 3.8 Commercial fail-closed behavior

- B1T02 defines the B1 commercial fail-closed behavior: unsupported commercial capabilities, malformed commercial responses, wrong commercial plan versions, and unavailable commercial flows fail closed or enter a declared recovery state.
- The B1 commercial catalog and commercial-boundary contract MUST emit one of the B1_COMMERCIAL_CATALOG failure codes on any prohibited edge, second commercial scope, second commercial partner, second authority, or unapproved capability.
- The B1 commercial catalog and commercial-boundary contract MUST NOT silently re-broadcast, silently re-broadcast with masking, or silently fall through to a different commercial scope.

### 3.9 Commercial prohibited dependencies

- B1T02 defines the B1 commercial prohibited dependencies: the B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second pricing engine, a second fee engine, a second commission engine, a second revenue-sharing engine, a second billing engine, a second invoice engine, a second statement-generation engine, a second campaign engine, a second promotion engine, a second coupon engine, a second referral engine, a second cashback engine, a second loyalty engine, a second revenue-recognition engine, a second tax / VAT engine, a second cost-accounting engine, a second commercial-analytics engine, a second profitability engine, a second commercial-reconciliation engine, a second commercial data classification, a second commercial idempotency, a second commercial audit, a second commercial approvals, a second feature flag surface, a second commercial release gate, a second B2 customer-activation rollout, a second B2 public-channel implementation, a second B2 marketing-consent onboarding, a second B2 cross-region or cross-currency rollout, a second B2 partner onboarding beyond the already-approved A6 partner, a second B2 broad customer activation, a second A8 scale / extraction, a second public commercial API, a second public commercial channel, a second mobile commercial channel, a second web commercial channel, or a second marketing-consent surface.

### 3.10 Commercial integration boundaries

- B1T02 defines the B1 commercial integration boundaries: A1, A2, A3, A4, A5, A6, A7, `CustomerPreference` and A6T10, A6T09, A7T09, A7T08, A7T06, and shared Operations services. The B1 commercial catalog and commercial-boundary contract integrate with each authority through the corresponding read-only consumer contract.
- The B1 commercial catalog and commercial-boundary contract do not integrate with any B1T03-B1T11 engine runtime, any B2 surface, any A8 surface, any public commercial surface, any public commercial API, any mobile commercial channel, any web commercial channel, or any marketing-consent surface.

### 3.11 Commercial replay expectations

- B1T02 defines the B1 commercial replay expectations: commercial-decision replay is allowed only within the commercial-decision replay window (`issuedAt + 86400s`); commercial-decision replay is supported only for the same commercialDecisionId, the same commercialScopeKey, the same commercialScopeVersion, the same commercialCapabilityKey, the same commercialCapabilityVersion, the same commercialAction, the same currency, the same accountingUnit, the same partnerDependency, the same productDependency, the same requestContext.correlationId, and the same requestContext.requestId.
- Commercial-decision replay is idempotent under the shared Operations `IdempotencyService` (read-only consumer boundary).
- Commercial-decision replay is replay-safe under the shared Operations `AuditService` (read-only consumer boundary).

### 3.12 Commercial compatibility with future commercial scopes

- B1T02 defines the B1 commercial compatibility with future commercial scopes: a later B1 cycle may add a second frozen commercial scope, a commercial scope under a future A7 product, a commercial scope under a second commercial partner, a commercial scope under a second currency, a commercial scope under a second accounting unit, a public commercial surface, a cross-region rollout, or a second commercial authority; each such expansion requires a separate B1 cycle plus a separate B1 ADR.
- A later B1 catalog version (v2) may add optional fields, capability metadata, a second frozen commercial scope, or commercial-extension points; a later B1 catalog version (v2) MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

## 4. Rationale

The B1 commercial catalog and B1 plan-boundary contract are an anti-corruption and isolation boundary between canonical authorities and one approved commercial scope. The catalog and boundary translate commercial-specific vocabulary (commercial reference, plan reference, tier reference, entitlement reference, feature flag reference, dynamic limit reference, package reference, bundle reference, fee reference, commission reference, revenue-sharing reference, billing reference, invoice reference, statement reference, campaign reference, promotion reference, coupon reference, referral reference, cashback reference, loyalty reference, revenue-recognition reference, tax / VAT reference, cost-accounting reference, profitability reference, analytics reference) into provider-neutral, partner-neutral, product-neutral, customer-neutral, and ledger-neutral values.

The catalog and boundary do not decide whether a commercial result is an internal financial outcome, an A2 authorization, an A3 binding, an A4 policy decision, an A5 Ledger record, an A6T08 settlement / suspense / compensating entry, an A6T09 external reconciliation mutation, an A7 product command, an A7 product operation, an A7 product financial effect, an A7 product reconciliation mutation, an A7 product data-minimization mutation, an Operations audit / idempotency / outbox mutation, or a `CustomerPreference` mutation. The catalog and boundary are the only B1 commercial-decision identity source; A1-A7 remain the only canonical identity authorities in their respective domains.

The catalog and boundary preserve A1-A7 authority separation. The catalog and boundary do not mutate any A1-A7 source record. The catalog and boundary are bounded by the A4 policy limits, the A3 binding recheck, the A5 Ledger posting boundary, the A6 partner boundary, the A7 product boundary, and the shared Operations audit / idempotency / outbox / metrics / diagnostics.

The catalog and boundary are deterministic, idempotent, replay-safe, sandbox/fixture-testable, and B2-exclusion-aware. The catalog and boundary are commercial-independent of any B1 commercial-decision engine, B1 commercial-financial-effect engine, B1 commercial-incentive engine, or B1 commercial-analytics engine.

## 5. Consequences

### 5.1 Positive consequences

- B1 has one explicit B1 commercial catalog and B1 plan-boundary contract that prevent commercial-specific behavior from becoming a source authority in Customer, `CustomerPreference`, Wallet, Ledger, A2, A3, A4, A5, A6, A7, Operations, or Reconciliation.
- B1 has one frozen first commercial scope `commercial.virtual-account.inbound-funding` v1 with explicit commercial dependency declaration, commercial compatibility rules, commercial ownership boundaries, commercial consumer contracts, commercial version negotiation rules, commercial fail-closed behavior, commercial prohibited dependencies, commercial integration boundaries, commercial replay expectations, and commercial compatibility with future commercial scopes.
- B1 has explicit commercial consumer contracts for A1, A2, A3, A4, A5, A6, A7, `CustomerPreference` and A6T10, A6T09, A7T09, A7T08, A7T06, and shared Operations services.
- B1 has explicit commercial version negotiation rules, commercial fail-closed behavior, commercial prohibited dependencies, commercial integration boundaries, commercial replay expectations, and commercial compatibility with future commercial scopes.
- B1 is a read-only consumer of A1-A7 and the shared Operations services; B1 does not introduce a second canonical identity in any A1-A7 domain.
- B1 is bounded by the A4 policy limits, the A3 binding recheck, the A5 Ledger posting boundary, the A6 partner boundary, the A7 product boundary, and the shared Operations audit / idempotency / outbox / metrics / diagnostics.
- B1 does not begin B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.
- B1 does not begin A8 scale / extraction, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation.

### 5.2 Negative consequences

- B1T02 does not implement the B1 commercial catalog runtime, the B1 commercial-boundary runtime, the B1 commercial-decision engine, the B1 fee / commission / revenue-sharing engine, the B1 billing / invoice / statement engine, the B1 campaign / promotion / coupon engine, the B1 referral / cashback / loyalty engine, the B1 revenue-recognition / tax / VAT / cost-accounting engine, the B1 commercial-analytics / profitability / commercial-reconciliation engine, the B1 commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag surface, or the B1 commercial release gate. B1T03-B1T11 must implement each surface.
- B1T02 does not predefine any B1 commercial plan, B1 commercial package, B1 commercial bundle, B1 commercial customer tier, B1 commercial merchant tier, B1 commercial partner tier, B1 commercial product entitlement, B1 commercial feature flag, B1 commercial dynamic limit, B1 commercial subscription plan, B1 commercial pricing rule, B1 commercial fee rule, B1 commercial commission rule, B1 commercial revenue-sharing rule, B1 commercial billing cycle, B1 commercial invoice format, B1 commercial statement format, B1 commercial campaign, B1 commercial promotion, B1 commercial coupon, B1 commercial referral, B1 commercial cashback, B1 commercial loyalty, B1 commercial revenue-recognition standard, B1 commercial tax / VAT scheme, B1 commercial cost-accounting methodology, B1 commercial profitability model, B1 commercial analytics report, B1 commercial approval, B1 commercial audit policy, B1 commercial idempotency scheme, B1 commercial reconciliation model, B1 commercial data-classification rule, B1 commercial retention rule, B1 commercial legal-hold rule, B1 commercial secret classification, B1 commercial disclosure audience maximum, B1 commercial support-trace classification, B1 commercial release gate, or B1 commercial release-gate evidence package.
- B1T02 does not authorize B1T03 or any later B1 task to begin runtime work; B1T03-B1T11 must still author their own B1 ADR, must still pass their own acceptance criteria, and must still be approved by the B1 release-gate review.
- B1T02 does not authorize any B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.
- B1T02 does not authorize any A8 scale / extraction, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation.

## 6. Alternatives considered

### 6.1 Alternative A — Skip the B1 commercial catalog and B1 plan-boundary contract

**Rejected.** Without a shared B1 commercial catalog and B1 plan-boundary contract, commercial-specific behavior would have to be implemented in each B1 commercial-decision engine, B1 commercial-financial-effect engine, B1 commercial-incentive engine, and B1 commercial-analytics engine, and commercial-specific engines would have to reach into `fee`, `quote`, `limit`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, `settlement-account`, `ledger`, `partner`, `reconciliation`, the A7 product layer, or other canonical modules to discover what they may do. That pattern would silently re-broaden A6, re-introduce competing source authorities, and make B1 release-gate evidence impossible to evaluate.

### 6.2 Alternative B — Implement a B1 commercial catalog runtime and B1 plan-boundary runtime in B1T02

**Rejected.** B1T02 is a documentation-only contract design task; B1T03 will define the actual B1 commercial catalog and B1 plan-boundary runtime surfaces; B1T04-B1T11 will implement the B1 commercial-decision engine, the B1 fee / commission / revenue-sharing engine, the B1 billing / invoice / statement engine, the B1 campaign / promotion / coupon engine, the B1 referral / cashback / loyalty engine, the B1 revenue-recognition / tax / VAT / cost-accounting engine, the B1 commercial-analytics / profitability / commercial-reconciliation engine, the B1 commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag surface, and the B1 commercial release gate. Implementing the B1 commercial catalog runtime or the B1 plan-boundary runtime in B1T02 would violate the B1T02 scope and the B1T02 documentation-only constraint.

### 6.3 Alternative C — Define a second pricing, fee, commission, or revenue-sharing engine in B1T02

**Rejected.** B1T02 defines the B1 commercial catalog and B1 plan-boundary contract only; B1T02 does not predefine any B1 pricing rule, B1 fee rule, B1 commission rule, B1 revenue-sharing rule, B1 billing cycle, B1 invoice format, B1 statement format, B1 commercial campaign, B1 commercial promotion, B1 commercial coupon, B1 commercial referral, B1 commercial cashback, B1 commercial loyalty, B1 commercial revenue-recognition standard, B1 commercial tax / VAT scheme, B1 commercial cost-accounting methodology, B1 commercial profitability model, B1 commercial analytics report, B1 commercial approval, B1 commercial audit policy, B1 commercial idempotency scheme, B1 commercial reconciliation model, B1 commercial data-classification rule, B1 commercial retention rule, B1 commercial legal-hold rule, B1 commercial secret classification, B1 commercial disclosure audience maximum, B1 commercial support-trace classification, B1 commercial release gate, or B1 commercial release-gate evidence package. The B1 prohibited dependencies in §3.9 explicitly forbid any second B1 commercial authority.

### 6.4 Alternative D — Begin B1T03 or any later B1 task in B1T02

**Rejected.** B1T02 is a documentation-only contract design task; B1T03-B1T11 must still author their own B1 ADR, must still pass their own acceptance criteria, and must still be approved by the B1 release-gate review. Beginning B1T03 or any later B1 task in B1T02 would violate the B1T02 scope and the B1T02 documentation-only constraint.

## 7. Cross-references

- [`docs/B1-IMPLEMENTATION-PLAN.md`](../B1-IMPLEMENTATION-PLAN.md) — the B1 implementation plan §8 B1T02
- [`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`](../B1-COMMERCIAL-CATALOG-CONTRACT.md) — the B1T02 contract design
- [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](../B1-COMMERCIAL-PLATFORM-BASELINE.md) — the B1T01 baseline and first commercial scope selection
- [`docs/A7-IMPLEMENTATION-PLAN.md`](../A7-IMPLEMENTATION-PLAN.md) — the A7 implementation plan
- [`docs/A7-PRODUCT-CATALOG-CONTRACT.md`](../A7-PRODUCT-CATALOG-CONTRACT.md) — the A7T02 product catalog and product-boundary contract
- [`docs/ADR/ADR-0054-Virtual-Account-Product-Boundary.md`](ADR-0054-Virtual-Account-Product-Boundary.md) — the A7T02 product boundary ADR
- [`docs/ADR/ADR-0005-Independent-Reconciliation.md`](ADR-0005-Independent-Reconciliation.md) — the A5 independent reconciliation ADR
- [`docs/ADR/ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md) — the A1 operational resilience ADR
- [`docs/ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR-0023-Customer-Identifier-and-Reference-Conventions.md) — the A1 identifier and reference conventions ADR
- [`docs/ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md) — the A1 data classification, retention, and privacy ADR
- [`docs/ADR/ADR-0036-Customer-Capability-Policy-Authority.md`](ADR-0036-Customer-Capability-Policy-Authority.md) — the A4 capability policy authority ADR
- [`docs/ADR/ADR-0047-External-Partner-Adapter-Boundary.md`](ADR-0047-External-Partner-Adapter-Boundary.md) — the A6 partner adapter boundary ADR
- [`docs/ADR/ADR-0050-Settlement-Suspense-and-Exception-Ownership.md`](ADR-0050-Settlement-Suspense-and-Exception-Ownership.md) — the A6T08 settlement, suspense, and exception ownership ADR
- [`docs/ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md`](ADR-0052-External-Rail-Data-Minimization-and-Consent.md) — the A6T10 external rail data minimization and consent ADR
- [`docs/ADR/ADR-0053-Independent-External-Reconciliation.md`](ADR-0053-Independent-External-Reconciliation.md) — the A6T09 independent external reconciliation ADR
- [`docs/ADR/ADR-0054-Virtual-Account-Product-Boundary.md`](ADR-0054-Virtual-Account-Product-Boundary.md) — the A7T02 virtual account product boundary ADR
