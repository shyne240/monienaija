# ADR-0065 — B1 Campaign Engine, Promotion Engine, and Coupon Engine

- **Phase:** B1 — Commercial Platform
- **Task:** B1T06 — B1 Campaign Engine, Promotion Engine, and Coupon Engine
- **Status:** Accepted (B1T06 implementation)
- **Review snapshot:** `b1t06` (B1T06 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Context

B1T01 established the B1 commercial platform baseline and the first commercial scope. B1T02 established the B1 commercial catalog and commercial-boundary contract (`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`). B1T03 populated the first commercial scope registration with the actual B1 commercial plans, customer tiers, merchant tiers, partner tiers, product entitlements, commercial packages, commercial bundles, feature flags, dynamic limits, and subscription plans, and froze the B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface for later B1 tasks. B1T04 implemented the B1 fee engine, commission engine, and revenue sharing decision engine. B1T05 implemented the B1 billing engine, invoice engine, and statement-generation engine.

B1T06 implements the B1 campaign engine, promotion engine, and coupon engine for the B1 first commercial scope. The B1 campaign engine, promotion engine, and coupon engine is required by the B1T06 plan deliverable and the B1T02 commercial catalog and commercial-boundary contract. The B1 campaign engine, promotion engine, and coupon engine ADR records the architectural decisions for the B1 commercial-incentive engine, the B1 commercial-incentive consumer ports, the B1 commercial-incentive persistence, the B1 commercial-incentive versioning, the B1 commercial-incentive compatibility validation, the B1 commercial-incentive replay-safe decision engine, the B1 commercial-incentive audit / idempotency / outbox / metrics integration, and the B1 commercial-incentive explanation trace / rule trace.

## 2. Decision

### 2.1 B1 commercial-incentive engine

The B1 commercial-incentive engine is the B1 campaign engine, promotion engine, and coupon engine. The B1 commercial-incentive engine is the only B1 commercial-incentive engine for campaigns, promotions, and coupons. The B1 commercial-incentive engine is a deterministic incentive-decision engine that produces a durable B1 commercial-incentive decision (campaign decision, promotion decision, or coupon decision) for a single commercial flow. The B1 commercial-incentive engine is a read-only decision engine; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes a settlement, executes a payout, executes cashback, executes rewards, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies invoices, modifies statements, modifies commercial decisions, modifies pricing catalogs, modifies product state, or dispatches a notification.

The B1 commercial-incentive engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 commercial-incentive engine never overrides A4. The B1 commercial-incentive engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 commercial-incentive engine never posts to Ledger. The B1 commercial-incentive engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 commercial-incentive engine never substitutes the A6 partner boundary. The B1 commercial-incentive engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 commercial-incentive engine never substitutes the A7 product boundary. The B1 commercial-incentive engine is bounded by the B1T04 commercial decision; the B1 commercial-incentive engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing. The B1 commercial-incentive engine is bounded by the B1T05 billing document; the B1 commercial-incentive engine consumes the B1T05 billing document read-only and never modifies invoices, statements, or other billing documents.

The B1 commercial-incentive engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 commercial-incentive engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

### 2.2 B1 commercial-incentive decision kinds

The B1 commercial-incentive engine determines the applicable campaign, the applicable promotion, the applicable coupon, the customer eligibility, the merchant eligibility, the partner eligibility, the product eligibility, the activation rules, the priority, the stacking rules, the exclusivity rules, the expiration, the usage limits, the campaign limits, the coupon limits, and the replay eligibility for the B1 first commercial scope. The B1 commercial-incentive engine produces three bounded decision kinds: campaign decision, promotion decision, and coupon decision.

### 2.3 B1 commercial-incentive consumer ports

The B1 commercial-incentive consumer ports are the canonical B1 commercial-incentive read-only consumer boundary surface for later B1 tasks (B1T07 referral / cashback / loyalty engine, B1T08 revenue-recognition / tax / cost-accounting engine, B1T09 commercial analytics / profitability / commercial reconciliation engine, B1T10 commercial data classification / commercial disclosure / commercial support-trace surface, B1T11 commercial release gate).

The B1 commercial-incentive consumer ports expose seven functions:

1. `generateCampaignDecision(request)` — Returns the canonical B1 campaign decision for the supplied B1 campaign request. The generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
2. `replaySafeGenerateCampaignDecision(request)` — Returns the canonical B1 campaign decision replay-safe result for the supplied B1 campaign request. The replay-safe generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
3. `generatePromotionDecision(request)` — Returns the canonical B1 promotion decision for the supplied B1 promotion request. The generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
4. `replaySafeGeneratePromotionDecision(request)` — Returns the canonical B1 promotion decision replay-safe result for the supplied B1 promotion request. The replay-safe generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
5. `generateCouponDecision(request)` — Returns the canonical B1 coupon decision for the supplied B1 coupon request. The generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
6. `replaySafeGenerateCouponDecision(request)` — Returns the canonical B1 coupon decision replay-safe result for the supplied B1 coupon request. The replay-safe generate is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.
7. `compatibilityCheck(request)` — Returns the canonical B1 commercial-incentive compatibility result for the supplied B1 campaign / promotion / coupon request. The compatibility check is read-only; the B1 commercial-incentive engine never posts a journal, mutates a balance, executes cashback, executes rewards, dispatches a notification, or executes any financial effect.

### 2.4 B1 commercial-incentive persistence

The B1 commercial-incentive decision is persisted in the `b1_campaign_decisions` table, introduced in `src/migrations/1785753600034-CreateB1CampaignDecisionTables.ts`. The `b1_campaign_decisions` table is the only B1 commercial-incentive decision persistence surface; the B1 commercial-incentive decision persistence is the only B1 commercial-incentive decision authority for the durable B1 commercial-incentive decision. The B1 commercial-incentive decision persistence does NOT introduce a second B1 commercial-incentive decision authority.

The B1 commercial-incentive decision persistence is configuration only. The B1 commercial-incentive decision persistence does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects. The B1 commercial-incentive decision persistence is a read-only contract against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.

### 2.5 B1 commercial-incentive versioning

The B1 commercial-incentive versioning contract is recorded in `B1CampaignDocumentVersioningContractV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06). The B1 commercial-incentive versioning contract records the B1 commercial-incentive decision version, the B1 commercial-incentive decision identity, the B1 commercial-incentive decision effective-from, the B1 commercial-incentive decision effective-to, the B1 commercial-incentive decision superseded-by reference, the B1 commercial-incentive decision supersedes reference, and the B1 commercial-incentive decision migration hint. The B1 commercial-incentive versioning contract is read-only; the B1 commercial-incentive engine does NOT publish a new B1 commercial-incentive decision version.

The B1 commercial-incentive versioning rules are:

1. The B1 commercial-incentive scope version is `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
2. The B1 commercial-incentive decision version is `1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
3. The B1 commercial-incentive version negotiation is exact-match (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
4. The B1 commercial-incentive engine does NOT support cross-catalog negotiation (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
5. The B1 commercial-incentive engine does NOT support cross-billing-engine negotiation (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06).
6. A later B1 commercial-incentive version (v2) MAY add optional fields, decision kinds, or extension points; a later B1 commercial-incentive version MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

### 2.6 B1 commercial-incentive compatibility validation

The B1 commercial-incentive compatibility validation is recorded in `B1CampaignEngineCompatibilityResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06). The B1 commercial-incentive compatibility validation verifies that the B1 commercial-incentive decision version is supported, that the B1 commercial-incentive scope key is supported, that the B1 commercial-incentive scope version is supported, that the B1 commercial-incentive decision kind is supported, that the B1 commercial-incentive currency is supported, that the B1 commercial-incentive accounting unit is supported, that the B1 commercial-incentive product dependency is supported, that the B1 commercial-incentive partner dependency is supported, that the B1 commercial-incentive stacking rules are valid, that the B1 commercial-incentive exclusivity rules are valid, that the B1 commercial-incentive usage limits are valid, and that the B1 commercial-incentive plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

### 2.7 B1 commercial-incentive replay-safe decision engine

The B1 commercial-incentive replay-safe decision engine is recorded in `B1CampaignDecisionReplaySafeResultV1`, `B1PromotionDecisionReplaySafeResultV1`, and `B1CouponDecisionReplaySafeResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06). The B1 commercial-incentive replay-safe decision engine uses the B1 commercial-incentive campaign internal idempotency scope (`b1.campaign-engine.campaign.idempotency.v1`), the B1 commercial-incentive promotion internal idempotency scope (`b1.campaign-engine.promotion.idempotency.v1`), the B1 commercial-incentive coupon internal idempotency scope (`b1.campaign-engine.coupon.idempotency.v1`), the B1 commercial-incentive internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial-incentive idempotency key, and the B1 commercial-incentive request hash (SHA-256 over the canonical request payload).

The B1 commercial-incentive replay rules are:

1. The B1 commercial-incentive replay window is 86_400 seconds (24 hours).
2. The B1 commercial-incentive replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial-incentive replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial-incentive replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial-incentive replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial-incentive replay rule inherits the A1-A7 replay rules (the A1-A7 replay rules are applied before the B1 commercial-incentive replay rule).
7. The B1 commercial-incentive replay rule inherits the B1T03 catalog replay rule (the B1T03 catalog replay rule is applied before the B1 commercial-incentive replay rule).
8. The B1 commercial-incentive replay rule inherits the B1T04 commercial decision replay rule (the B1T04 commercial decision replay rule is applied before the B1 commercial-incentive replay rule).
9. The B1 commercial-incentive replay rule inherits the B1T05 billing document replay rule (the B1T05 billing document replay rule is applied before the B1 commercial-incentive replay rule).

The B1 commercial-incentive decision hash is computed from the canonical B1 commercial-incentive decision payload (excluding the random `decisionId` and the `generatedAt` timestamp). The B1 commercial-incentive replay hash is computed from the B1 commercial-incentive decision hash, the B1 commercial-incentive request hash, the B1 commercial-incentive idempotency key, and the B1 commercial-incentive correlation id.

### 2.8 B1 commercial-incentive audit / idempotency / outbox / metrics integration

The B1 commercial-incentive engine emits B1 commercial-incentive audit facts through the shared Operations `AuditService` (the only audit authority), reserves B1 commercial-incentive idempotency records through the shared Operations `IdempotencyService` (the only internal idempotency authority), enqueues B1 commercial-incentive outbox events through the shared Operations `OutboxService` (the only outbox authority), and records B1 commercial-incentive metrics through the shared Operations `MetricsService` (the only metrics authority). The B1 commercial-incentive audit actor is `b1-campaign-engine`. The B1 commercial-incentive audit entity type is `B1_CAMPAIGN_DECISION`. The B1 commercial-incentive outbox event type is `B1CampaignDecisionDecided`. The B1 commercial-incentive outbox event classification is `INTERNAL_OPERATIONS`. The B1 commercial-incentive outbox event retention class is `OPERATIONS_DEFAULT`.

The B1 commercial-incentive metric names are:

- `b1.campaign-engine.campaign` — the B1 campaign decision generate metric.
- `b1.campaign-engine.promotion` — the B1 promotion decision generate metric.
- `b1.campaign-engine.coupon` — the B1 coupon decision generate metric.
- `b1.campaign-engine.replayed` — the B1 commercial-incentive decision replayed metric.
- `b1.campaign-engine.conflict` — the B1 commercial-incentive decision conflict metric.
- `b1.campaign-engine.incompatible` — the B1 commercial-incentive decision incompatible metric.
- `b1.campaign-engine.query-unavailable` — the B1 commercial-incentive decision query unavailable metric.
- `b1.campaign-engine.in-progress` — the B1 commercial-incentive decision in progress metric.
- `b1.campaign-engine.replay-conflict` — the B1 commercial-incentive decision replay conflict metric.
- `b1.campaign-engine.replay-expired` — the B1 commercial-incentive decision replay expired metric.
- `b1.campaign-engine.number-conflict` — the B1 commercial-incentive decision number conflict metric.
- `b1.campaign-engine.expired` — the B1 commercial-incentive decision expired metric.
- `b1.campaign-engine.usage-limit-exceeded` — the B1 commercial-incentive decision usage limit exceeded metric.
- `b1.campaign-engine.not-applicable` — the B1 commercial-incentive decision not applicable metric.
- `b1.campaign-engine.a4-policy-denied` — the B1 commercial-incentive A4 policy denied metric.
- `b1.campaign-engine.a3-binding-invalid` — the B1 commercial-incentive A3 binding invalid metric.
- `b1.campaign-engine.a5-ledger-invariant-broken` — the B1 commercial-incentive A5 ledger invariant broken metric.
- `b1.campaign-engine.a6-partner-incompatible` — the B1 commercial-incentive A6 partner incompatible metric.
- `b1.campaign-engine.a7-product-incompatible` — the B1 commercial-incentive A7 product incompatible metric.
- `b1.campaign-engine.catalog-incompatible` — the B1 commercial-incentive catalog incompatible metric.
- `b1.campaign-engine.catalog-missing` — the B1 commercial-incentive catalog missing metric.
- `b1.campaign-engine.decision-not-found` — the B1 commercial-incentive decision not found metric.
- `b1.campaign-engine.decision-incompatible` — the B1 commercial-incentive decision incompatible metric.
- `b1.campaign-engine.billing-document-not-found` — the B1 commercial-incentive billing document not found metric.
- `b1.campaign-engine.billing-document-incompatible` — the B1 commercial-incentive billing document incompatible metric.

### 2.9 B1 commercial-incentive lifecycle vocabularies

The B1 commercial-incentive campaign state vocabulary is: `DRAFT`, `ACTIVE`, `PAUSED`, `EXPIRED`, `RETIRED`. The B1 commercial-incentive promotion state vocabulary is: `CREATED`, `ACTIVE`, `EXPIRED`, `CANCELLED`. The B1 commercial-incentive coupon state vocabulary is: `CREATED`, `ACTIVE`, `REDEEMED`, `EXPIRED`, `CANCELLED`. The B1 commercial-incentive decision outcome vocabulary is: `ELIGIBLE`, `APPLIED`, `REJECTED`, `REPLAYED`.

## 3. Consequences

### 3.1 Positive consequences

- The B1 commercial-incentive engine is the only B1 commercial-incentive engine for campaigns, promotions, and coupons. The B1 commercial-incentive engine is the only B1 commercial-incentive authority; the B1 commercial-incentive engine does NOT introduce a second B1 commercial-incentive authority.
- The B1 commercial-incentive consumer ports are the canonical B1 commercial-incentive consumer ports. The B1 commercial-incentive consumer ports do NOT introduce a second B1 commercial-incentive consumer port.
- The B1 commercial-incentive decision persistence is the only B1 commercial-incentive decision persistence surface. The B1 commercial-incentive decision persistence does NOT introduce a second B1 commercial-incentive decision persistence surface.
- The B1 commercial-incentive versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration are the canonical B1 commercial-incentive surfaces. The B1 commercial-incentive versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration do NOT introduce a second B1 commercial-incentive authority.
- The B1 commercial-incentive decision is deterministic. Identical inputs ALWAYS produce identical B1 commercial-incentive decisions.
- The B1 commercial-incentive decision is replay-safe. A duplicate B1 commercial-incentive decision request returns the durable original B1 commercial-incentive decision.
- The B1 commercial-incentive engine is configuration only. The B1 commercial-incentive engine does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects.
- The B1 commercial-incentive engine is read-only against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.
- The B1 commercial-incentive engine is designed to be capable of supporting future marketing campaigns, onboarding promotions, referral campaigns, merchant promotions, seasonal campaigns, coupon codes, promotional pricing, product bundles, and loyalty prerequisites without changing existing A1-A7 authorities.

### 3.2 Negative consequences

- The B1 commercial-incentive decision persistence migration (`1785753600034-CreateB1CampaignDecisionTables`) is a new database migration. The B1 commercial-incentive decision persistence migration MUST be applied before any B1 commercial-incentive decision persistence record is created.
- The B1 commercial-incentive decision persistence adds a new database table (`b1_campaign_decisions`). The B1 commercial-incentive decision persistence table is the only B1 commercial-incentive decision persistence surface; the B1 commercial-incentive decision persistence table does NOT introduce a second B1 commercial-incentive decision persistence surface.
- The B1 commercial-incentive explanation trace and rule trace are recorded for every B1 commercial-incentive decision. The B1 commercial-incentive explanation trace and rule trace are NOT recorded for the B1 commercial-incentive decision failure record.

## 4. Alternatives considered

### 4.1 B1 commercial-incentive engine as a service-only contract

The B1 commercial-incentive engine could be implemented as a service-only contract (without a database table). The B1 commercial-incentive engine as a service-only contract was rejected because the B1 commercial-incentive decision is a durable artifact and the B1 commercial-incentive decision MUST be queryable from the B1 commercial-incentive read-only consumer boundary surface. The B1 commercial-incentive engine as a service-only contract would require a B1 commercial-incentive decision in-memory cache, which is rejected because the B1 commercial-incentive decision is a single source of truth and the B1 commercial-incentive decision MUST be queryable across multiple B1 commercial-incentive engine instances.

### 4.2 B1 commercial-incentive engine as a second A1 canonical identity

The B1 commercial-incentive engine could be implemented as a second A1 canonical identity (e.g., a new `B1_CAMPAIGN_DECISION` canonical identity). The B1 commercial-incentive engine as a second A1 canonical identity was rejected because the B1 commercial-incentive engine does NOT introduce a new A1 canonical identity; the B1 commercial-incentive engine reuses the A1 canonical identity authority.

### 4.3 B1 commercial-incentive engine as a second B1T04 commercial decision engine

The B1 commercial-incentive engine could be implemented as a second B1T04 commercial decision engine. The B1 commercial-incentive engine as a second B1T04 commercial decision engine was rejected because the B1T04 commercial decision engine is the only B1 commercial decision engine for fee, commission, and revenue sharing; the B1 commercial-incentive engine reuses the B1T04 commercial decision through the existing B1T04 read-only consumer boundary.

### 4.4 B1 commercial-incentive engine as a second B1T05 billing engine

The B1 commercial-incentive engine could be implemented as a second B1T05 billing engine. The B1 commercial-incentive engine as a second B1T05 billing engine was rejected because the B1T05 billing engine is the only B1 commercial-financial-effect engine for billing, invoicing, and statement generation; the B1 commercial-incentive engine reuses the B1T05 billing engine through the existing B1T05 read-only consumer boundary.

## 5. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T06 — B1 Campaign, Promotion, and Coupon Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `src/policy/b1-campaign-engine.types.ts` — B1 campaign engine types.
- `src/policy/b1-campaign-engine.constants.ts` — B1 campaign engine constants.
- `src/policy/b1-campaign-engine.entity.ts` — B1 campaign decision persistence entity.
- `src/policy/b1-campaign-engine.repository.ts` — B1 campaign engine repository.
- `src/policy/b1-campaign-engine.service.ts` — B1 campaign engine service.
- `src/policy/b1-campaign-engine.module.ts` — B1 campaign engine NestJS module.
- `src/migrations/1785753600034-CreateB1CampaignDecisionTables.ts` — B1 campaign decision persistence migration.
- `test/b1-campaign-engine.types.spec.ts` — B1 campaign engine types tests.
- `test/b1-campaign-engine.repository.spec.ts` — B1 campaign engine repository tests.
- `test/b1-campaign-engine.service.spec.ts` — B1 campaign engine service tests.
- `test/b1-campaign-engine.module.spec.ts` — B1 campaign engine module tests.
