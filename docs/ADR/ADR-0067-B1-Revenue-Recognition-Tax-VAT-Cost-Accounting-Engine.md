# ADR-0067 — B1 Revenue-Recognition Engine, Tax / VAT Engine, and Cost-Accounting Engine

- **Phase:** B1 — Commercial Platform
- **Task:** B1T08 — B1 Revenue-Recognition Engine, Tax / VAT Engine, and Cost-Accounting Engine
- **Status:** Accepted (B1T08 implementation)
- **Review snapshot:** `b1t08` (B1T08 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Context

B1T01 established the B1 commercial platform baseline and the first commercial scope. B1T02 established the B1 commercial catalog and commercial-boundary contract (`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`). B1T03 populated the first commercial scope registration with the actual B1 commercial plans, customer tiers, merchant tiers, partner tiers, product entitlements, commercial packages, commercial bundles, feature flags, dynamic limits, and subscription plans, and froze the B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface for later B1 tasks. B1T04 implemented the B1 fee engine, commission engine, and revenue sharing decision engine. B1T05 implemented the B1 billing engine, invoice engine, and statement-generation engine. B1T06 implemented the B1 campaign engine, promotion engine, and coupon engine. B1T07 implemented the B1 referral engine, cashback engine, and loyalty engine.

B1T08 implements the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine for the B1 first commercial scope. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine is required by the B1T08 plan deliverable and the B1T02 commercial catalog and commercial-boundary contract. The B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine ADR records the architectural decisions for the B1 commercial-financial-recognition engine, the B1 commercial-financial-recognition consumer ports, the B1 commercial-financial-recognition persistence, the B1 commercial-financial-recognition versioning, the B1 commercial-financial-recognition compatibility validation, the B1 commercial-financial-recognition replay-safe decision engine, the B1 commercial-financial-recognition audit / idempotency / outbox / metrics integration, and the B1 commercial-financial-recognition explanation trace / rule trace / recognition trace.

## 2. Decision

### 2.1 B1 commercial-financial-recognition engine

The B1 commercial-financial-recognition engine is the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine. The B1 commercial-financial-recognition engine is the only B1 commercial-financial-recognition engine for revenue recognition, tax / VAT, and cost accounting. The B1 commercial-financial-recognition engine is a deterministic commercial-financial-recognition decision engine that produces a durable B1 commercial-financial-recognition decision (revenue-recognition decision, tax / VAT decision, or cost-accounting decision) for a single commercial flow. The B1 commercial-financial-recognition engine is a read-only recognition engine; the B1 commercial-financial-recognition engine never posts a journal, mutates a balance, executes a settlement, executes a payout, redeems cashback, awards loyalty balances, redeems loyalty balances, executes referral rewards, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies invoices, modifies statements, modifies commercial decisions, modifies pricing catalogs, modifies product state, or dispatches a notification.

The B1 commercial-financial-recognition engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 commercial-financial-recognition engine never overrides A4. The B1 commercial-financial-recognition engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 commercial-financial-recognition engine never posts to Ledger and never bypasses A5 financial-invariants. The B1 commercial-financial-recognition engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 commercial-financial-recognition engine never substitutes the A6 partner boundary. The B1 commercial-financial-recognition engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 commercial-financial-recognition engine never substitutes the A7 product boundary. The B1 commercial-financial-recognition engine is bounded by the B1T04 commercial decision; the B1 commercial-financial-recognition engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing. The B1 commercial-financial-recognition engine is bounded by the B1T05 billing document; the B1 commercial-financial-recognition engine consumes the B1T05 billing document read-only and never modifies invoices, statements, or other billing documents. The B1 commercial-financial-recognition engine is bounded by the B1T06 commercial-incentive decision; the B1 commercial-financial-recognition engine consumes the B1T06 commercial-incentive decision read-only and never substitutes or overrides the B1T06 commercial-incentive decision. The B1 commercial-financial-recognition engine is bounded by the B1T07 commercial-rewards decision; the B1 commercial-financial-recognition engine consumes the B1T07 commercial-rewards decision read-only and never redeems cashback, awards loyalty balances, redeems loyalty balances, or executes referral rewards.

The B1 commercial-financial-recognition engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 commercial-financial-recognition engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

### 2.2 B1 commercial-financial-recognition decision kinds

The B1 commercial-financial-recognition engine determines the applicable revenue-recognition policy, the applicable deferred-revenue schedule, the applicable recognized-revenue schedule, the applicable recognition event, the applicable recognition method, the applicable tax / VAT policy, the applicable tax / VAT jurisdiction, the applicable tax / VAT category, the applicable tax / VAT exemption, the applicable tax / VAT evidence, the applicable cost-accounting policy, the applicable cost category, the applicable cost-allocation method, the applicable direct cost, the applicable indirect cost, the applicable acquisition cost, the applicable operational cost, the applicable allocated cost, the customer eligibility, the merchant eligibility, the partner eligibility, the product eligibility, the tier eligibility, the period eligibility, the recognition-basis eligibility, the tax-policy eligibility, the cost-allocation eligibility, and the replay eligibility for the B1 first commercial scope. The B1 commercial-financial-recognition engine produces three bounded decision kinds: revenue-recognition decision, tax / VAT decision, and cost-accounting decision.

### 2.3 B1 commercial-financial-recognition consumer ports

The B1 commercial-financial-recognition consumer ports are the canonical B1 commercial-financial-recognition read-only consumer boundary surface for later B1 tasks (B1T09 commercial analytics / profitability / commercial reconciliation engine, B1T10 commercial data classification / commercial disclosure / commercial support-trace surface, B1T11 commercial release gate).

The B1 commercial-financial-recognition consumer ports expose seven functions:

1. `generateRevenueRecognitionDecision(request)` — Returns the canonical B1 revenue-recognition decision for the supplied B1 revenue-recognition request. The generate is read-only; the B1 revenue-recognition engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
2. `replaySafeGenerateRevenueRecognitionDecision(request)` — Returns the canonical B1 revenue-recognition decision replay-safe result for the supplied B1 revenue-recognition request. The replay-safe generate is read-only; the B1 revenue-recognition engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
3. `generateTaxVatDecision(request)` — Returns the canonical B1 tax / VAT decision for the supplied B1 tax / VAT request. The generate is read-only; the B1 tax / VAT engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
4. `replaySafeGenerateTaxVatDecision(request)` — Returns the canonical B1 tax / VAT decision replay-safe result for the supplied B1 tax / VAT request. The replay-safe generate is read-only; the B1 tax / VAT engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
5. `generateCostAccountingDecision(request)` — Returns the canonical B1 cost-accounting decision for the supplied B1 cost-accounting request. The generate is read-only; the B1 cost-accounting engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
6. `replaySafeGenerateCostAccountingDecision(request)` — Returns the canonical B1 cost-accounting decision replay-safe result for the supplied B1 cost-accounting request. The replay-safe generate is read-only; the B1 cost-accounting engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.
7. `compatibilityCheck(request)` — Returns the canonical B1 commercial-financial-recognition compatibility result for the supplied B1 revenue-recognition / tax / VAT / cost-accounting request. The compatibility check is read-only; the B1 commercial-financial-recognition engine never posts a journal, mutates a balance, executes financial effects, dispatches a notification, or executes any financial effect.

### 2.4 B1 commercial-financial-recognition persistence

The B1 commercial-financial-recognition decision is persisted in the `b1_revenue_recognition_decisions` table, introduced in `src/migrations/1785753600036-CreateB1RevenueRecognitionDecisionTables.ts`. The `b1_revenue_recognition_decisions` table is the only B1 commercial-financial-recognition decision persistence surface; the B1 commercial-financial-recognition decision persistence is the only B1 commercial-financial-recognition decision authority for the durable B1 commercial-financial-recognition decision. The B1 commercial-financial-recognition decision persistence does NOT introduce a second B1 commercial-financial-recognition decision authority.

The B1 commercial-financial-recognition decision persistence is configuration only. The B1 commercial-financial-recognition decision persistence does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects. The B1 commercial-financial-recognition decision persistence is a read-only contract against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, B1T06 commercial-incentive decision, B1T07 commercial-rewards decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.

### 2.5 B1 commercial-financial-recognition versioning

The B1 commercial-financial-recognition versioning contract is recorded in `B1RevenueRecognitionDocumentVersioningContractV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08). The B1 commercial-financial-recognition versioning contract records the B1 commercial-financial-recognition decision version, the B1 commercial-financial-recognition decision identity, the B1 commercial-financial-recognition decision effective-from, the B1 commercial-financial-recognition decision effective-to, the B1 commercial-financial-recognition decision superseded-by reference, the B1 commercial-financial-recognition decision supersedes reference, and the B1 commercial-financial-recognition decision migration hint. The B1 commercial-financial-recognition versioning contract is read-only; the B1 commercial-financial-recognition engine does NOT publish a new B1 commercial-financial-recognition decision version.

The B1 commercial-financial-recognition versioning rules are:

1. The B1 commercial-financial-recognition scope version is `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
2. The B1 commercial-financial-recognition decision version is `1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
3. The B1 commercial-financial-recognition version negotiation is exact-match (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08).
4. The B1 commercial-financial-recognition engine does NOT support cross-catalog negotiation.
5. The B1 commercial-financial-recognition engine does NOT support cross-billing-engine negotiation.
6. The B1 commercial-financial-recognition engine does NOT support cross-campaign-engine negotiation.
7. The B1 commercial-financial-recognition engine does NOT support cross-referral-engine negotiation.
8. A later B1 commercial-financial-recognition version (v2) MAY add optional fields, decision kinds, or extension points; a later B1 commercial-financial-recognition version MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

### 2.6 B1 commercial-financial-recognition compatibility validation

The B1 commercial-financial-recognition compatibility validation is recorded in `B1RevenueRecognitionEngineCompatibilityResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08). The B1 commercial-financial-recognition compatibility validation verifies that the B1 commercial-financial-recognition decision version is supported, that the B1 commercial-financial-recognition scope key is supported, that the B1 commercial-financial-recognition scope version is supported, that the B1 commercial-financial-recognition decision kind is supported, that the B1 commercial-financial-recognition currency is supported, that the B1 commercial-financial-recognition accounting unit is supported, that the B1 commercial-financial-recognition product dependency is supported, that the B1 commercial-financial-recognition partner dependency is supported, that the B1 commercial-financial-recognition accounting basis is valid, that the B1 commercial-financial-recognition tax jurisdiction is valid, that the B1 commercial-financial-recognition cost-allocation method is valid, that the B1 commercial-financial-recognition recognition policy is valid, and that the B1 commercial-financial-recognition plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

### 2.7 B1 commercial-financial-recognition replay-safe decision engine

The B1 commercial-financial-recognition replay-safe decision engine is recorded in `B1RevenueRecognitionDecisionReplaySafeResultV1`, `B1TaxVatDecisionReplaySafeResultV1`, and `B1CostAccountingDecisionReplaySafeResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08). The B1 commercial-financial-recognition replay-safe decision engine uses the B1 commercial-financial-recognition revenue-recognition internal idempotency scope (`b1.revenue-recognition-engine.revenue-recognition.idempotency.v1`), the B1 commercial-financial-recognition tax / VAT internal idempotency scope (`b1.revenue-recognition-engine.tax-vat.idempotency.v1`), the B1 commercial-financial-recognition cost-accounting internal idempotency scope (`b1.revenue-recognition-engine.cost-accounting.idempotency.v1`), the B1 commercial-financial-recognition internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial-financial-recognition idempotency key, and the B1 commercial-financial-recognition request hash (SHA-256 over the canonical request payload).

The B1 commercial-financial-recognition replay rules are:

1. The B1 commercial-financial-recognition replay window is 86_400 seconds (24 hours).
2. The B1 commercial-financial-recognition replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial-financial-recognition replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial-financial-recognition replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial-financial-recognition replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial-financial-recognition replay rule inherits the A1-A7 replay rules.
7. The B1 commercial-financial-recognition replay rule inherits the B1T03 catalog replay rule.
8. The B1 commercial-financial-recognition replay rule inherits the B1T04 commercial decision replay rule.
9. The B1 commercial-financial-recognition replay rule inherits the B1T05 billing document replay rule.
10. The B1 commercial-financial-recognition replay rule inherits the B1T06 commercial-incentive decision replay rule.
11. The B1 commercial-financial-recognition replay rule inherits the B1T07 commercial-rewards decision replay rule.
12. The B1 commercial-financial-recognition replay rule is number-deterministic.

The B1 commercial-financial-recognition decision hash is computed from the canonical B1 commercial-financial-recognition decision payload (excluding the random `decisionId` and the `generatedAt` timestamp). The B1 commercial-financial-recognition replay hash is computed from the B1 commercial-financial-recognition decision hash, the B1 commercial-financial-recognition request hash, the B1 commercial-financial-recognition idempotency key, and the B1 commercial-financial-recognition correlation id.

### 2.8 B1 commercial-financial-recognition audit / idempotency / outbox / metrics integration

The B1 commercial-financial-recognition engine emits B1 commercial-financial-recognition audit facts through the shared Operations `AuditService` (the only audit authority), reserves B1 commercial-financial-recognition idempotency records through the shared Operations `IdempotencyService` (the only internal idempotency authority), enqueues B1 commercial-financial-recognition outbox events through the shared Operations `OutboxService` (the only outbox authority), and records B1 commercial-financial-recognition metrics through the shared Operations `MetricsService` (the only metrics authority). The B1 commercial-financial-recognition audit actor is `b1-revenue-recognition-engine`. The B1 commercial-financial-recognition audit entity type is `B1_REVENUE_RECOGNITION_DECISION`. The B1 commercial-financial-recognition outbox event type is `B1RevenueRecognitionDecisionDecided`. The B1 commercial-financial-recognition outbox event classification is `INTERNAL_OPERATIONS`. The B1 commercial-financial-recognition outbox event retention class is `OPERATIONS_DEFAULT`.

### 2.9 B1 commercial-financial-recognition lifecycle vocabularies

The B1 commercial-financial-recognition revenue-recognition state vocabulary is: `DRAFT`, `PENDING`, `RECOGNIZED`, `DEFERRED`, `CANCELLED`, `RETIRED`. The B1 commercial-financial-recognition tax / VAT state vocabulary is: `DRAFT`, `PENDING`, `ASSESSED`, `EXEMPTED`, `DECLARED`, `CANCELLED`, `RETIRED`. The B1 commercial-financial-recognition cost-accounting state vocabulary is: `DRAFT`, `PENDING`, `ALLOCATED`, `RECOGNIZED`, `AMORTIZED`, `CANCELLED`, `RETIRED`. The B1 commercial-financial-recognition decision outcome vocabulary is: `ELIGIBLE`, `APPLIED`, `REJECTED`, `REPLAYED`.

### 2.10 B1 commercial-financial-recognition execution boundary

The B1 commercial-financial-recognition engine is a RECOGNITION ENGINE ONLY. The B1 commercial-financial-recognition engine produces deterministic commercial accounting-recognition decisions that later finance authorities may consume. The B1 commercial-financial-recognition engine does NOT introduce a second Ledger, a second Finance authority, a second Billing authority, a second Campaign authority, a second cashback-redemption authority, a second loyalty-balance authority, a second referral-reward-execution authority, a second revenue-recognition-posting authority, a second tax-vat-posting authority, a second cost-accounting-posting authority, a second cashback-authority, a second loyalty-authority, a second referral-authority, or a second settlement-authority.

The B1 commercial-financial-recognition engine NEVER dispatches notifications, executes financial effects, credits wallets, debits wallets, posts journals, redeems cashback, awards loyalty balances, redeems loyalty balances, executes referral rewards, performs payouts, performs settlements, performs reconciliation, or communicates with external partners. The B1 commercial-financial-recognition engine is read-only against all existing A1-A7 and B1T01-B1T07 authorities. The B1 commercial-financial-recognition engine is a read-write consumer of the shared Operations `IdempotencyService`, `AuditService`, `OutboxService`, and `MetricsService` only.

## 3. Consequences

### 3.1 Positive consequences

- The B1 commercial-financial-recognition engine is the only B1 commercial-financial-recognition engine for revenue recognition, tax / VAT, and cost accounting. The B1 commercial-financial-recognition engine is the only B1 commercial-financial-recognition authority; the B1 commercial-financial-recognition engine does NOT introduce a second B1 commercial-financial-recognition authority.
- The B1 commercial-financial-recognition consumer ports are the canonical B1 commercial-financial-recognition consumer ports. The B1 commercial-financial-recognition consumer ports do NOT introduce a second B1 commercial-financial-recognition consumer port.
- The B1 commercial-financial-recognition decision persistence is the only B1 commercial-financial-recognition decision persistence surface. The B1 commercial-financial-recognition decision persistence does NOT introduce a second B1 commercial-financial-recognition decision persistence surface.
- The B1 commercial-financial-recognition versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration are the canonical B1 commercial-financial-recognition surfaces. The B1 commercial-financial-recognition versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration do NOT introduce a second B1 commercial-financial-recognition authority.
- The B1 commercial-financial-recognition decision is deterministic. Identical inputs ALWAYS produce identical B1 commercial-financial-recognition decisions.
- The B1 commercial-financial-recognition decision is replay-safe. A duplicate B1 commercial-financial-recognition decision request returns the durable original B1 commercial-financial-recognition decision.
- The B1 commercial-financial-recognition engine is configuration only. The B1 commercial-financial-recognition engine does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects.
- The B1 commercial-financial-recognition engine is read-only against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, B1T06 commercial-incentive decision, B1T07 commercial-rewards decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.
- The B1 commercial-financial-recognition engine is designed to be capable of supporting future revenue-recognition schedules, deferred-revenue schedules, tax / VAT categories, tax / VAT jurisdictions, cost-allocation methods, cost categories, revenue recognition policies, and tax / VAT policies without changing existing A1-A7 authorities.

### 3.2 Negative consequences

- The B1 commercial-financial-recognition decision persistence migration (`1785753600036-CreateB1RevenueRecognitionDecisionTables`) is a new database migration. The B1 commercial-financial-recognition decision persistence migration MUST be applied before any B1 commercial-financial-recognition decision persistence record is created.
- The B1 commercial-financial-recognition decision persistence adds a new database table (`b1_revenue_recognition_decisions`). The B1 commercial-financial-recognition decision persistence table is the only B1 commercial-financial-recognition decision persistence surface; the B1 commercial-financial-recognition decision persistence table does NOT introduce a second B1 commercial-financial-recognition decision persistence surface.
- The B1 commercial-financial-recognition explanation trace, rule trace, and recognition trace are recorded for every B1 commercial-financial-recognition decision. The B1 commercial-financial-recognition explanation trace, rule trace, and recognition trace are NOT recorded for the B1 commercial-financial-recognition decision failure record.
- The B1 commercial-financial-recognition engine produces commercial-financial-recognition decisions that later execution layers must consume. A future execution layer (out of B1T08 scope) MUST consume the B1 commercial-financial-recognition decision through the B1 commercial-financial-recognition consumer ports and MUST NOT bypass the B1 commercial-financial-recognition engine.

## 4. Alternatives considered

### 4.1 B1 commercial-financial-recognition engine as a service-only contract

The B1 commercial-financial-recognition engine could be implemented as a service-only contract (without a database table). The B1 commercial-financial-recognition engine as a service-only contract was rejected because the B1 commercial-financial-recognition decision is a durable artifact and the B1 commercial-financial-recognition decision MUST be queryable from the B1 commercial-financial-recognition read-only consumer boundary surface. The B1 commercial-financial-recognition engine as a service-only contract would require a B1 commercial-financial-recognition decision in-memory cache, which is rejected because the B1 commercial-financial-recognition decision is a single source of truth and the B1 commercial-financial-recognition decision MUST be queryable across multiple B1 commercial-financial-recognition engine instances.

### 4.2 B1 commercial-financial-recognition engine as a second A1 canonical identity

The B1 commercial-financial-recognition engine could be implemented as a second A1 canonical identity (e.g., a new `B1_REVENUE_RECOGNITION_DECISION` canonical identity). The B1 commercial-financial-recognition engine as a second A1 canonical identity was rejected because the B1 commercial-financial-recognition engine does NOT introduce a new A1 canonical identity; the B1 commercial-financial-recognition engine reuses the A1 canonical identity authority.

### 4.3 B1 commercial-financial-recognition engine as a second B1T04 commercial decision engine

The B1 commercial-financial-recognition engine could be implemented as a second B1T04 commercial decision engine. The B1 commercial-financial-recognition engine as a second B1T04 commercial decision engine was rejected because the B1T04 commercial decision engine is the only B1 commercial decision engine for fee, commission, and revenue sharing; the B1 commercial-financial-recognition engine reuses the B1T04 commercial decision through the existing B1T04 read-only consumer boundary.

### 4.4 B1 commercial-financial-recognition engine as a second B1T05 billing engine

The B1 commercial-financial-recognition engine could be implemented as a second B1T05 billing engine. The B1 commercial-financial-recognition engine as a second B1T05 billing engine was rejected because the B1T05 billing engine is the only B1 commercial-financial-effect engine for billing, invoicing, and statement generation; the B1 commercial-financial-recognition engine reuses the B1T05 billing engine through the existing B1T05 read-only consumer boundary.

### 4.5 B1 commercial-financial-recognition engine as a second B1T06 commercial-incentive engine

The B1 commercial-financial-recognition engine could be implemented as a second B1T06 commercial-incentive engine. The B1 commercial-financial-recognition engine as a second B1T06 commercial-incentive engine was rejected because the B1T06 commercial-incentive engine is the only B1 commercial-incentive engine for campaigns, promotions, and coupons; the B1 commercial-financial-recognition engine reuses the B1T06 commercial-incentive decision through the existing B1T06 read-only consumer boundary.

### 4.6 B1 commercial-financial-recognition engine as a second B1T07 commercial-rewards engine

The B1 commercial-financial-recognition engine could be implemented as a second B1T07 commercial-rewards engine. The B1 commercial-financial-recognition engine as a second B1T07 commercial-rewards engine was rejected because the B1T07 commercial-rewards engine is the only B1 commercial-rewards engine for referrals, cashback, and loyalty; the B1 commercial-financial-recognition engine reuses the B1T07 commercial-rewards decision through the existing B1T07 read-only consumer boundary.

### 4.7 B1 commercial-financial-recognition engine with execution

The B1 commercial-financial-recognition engine could be implemented with execution (e.g., the B1 revenue-recognition engine could post a revenue-recognition entry, the B1 tax / VAT engine could post a tax / VAT entry, the B1 cost-accounting engine could post a cost-accounting entry). The B1 commercial-financial-recognition engine with execution was rejected because the B1 commercial-financial-recognition engine is a RECOGNITION ENGINE ONLY. A future execution layer (out of B1T08 scope) MUST consume the B1 commercial-financial-recognition decision through the B1 commercial-financial-recognition consumer ports and MUST execute the B1 commercial-financial-recognition decision through the appropriate A1-A7 and B1T01-B1T07 authorities (Ledger, Wallet, Billing, Campaign, etc.).

## 5. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T08 — B1 Revenue-Recognition, Tax / VAT, and Cost-Accounting Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md` — B1 campaign engine, promotion engine, and coupon engine contract.
- `docs/B1-REFERRAL-ENGINE-CONTRACT.md` — B1 referral engine, cashback engine, and loyalty engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `docs/ADR/ADR-0065-B1-Campaign-Promotion-Coupon-Engine.md` — B1 campaign engine, promotion engine, and coupon engine ADR.
- `docs/ADR/ADR-0066-B1-Referral-Cashback-Loyalty-Engine.md` — B1 referral engine, cashback engine, and loyalty engine ADR.
- `docs/B1-REVENUE-RECOGNITION-CONTRACT.md` — B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract.
- `src/policy/b1-revenue-recognition-engine.types.ts` — B1 revenue-recognition engine types.
- `src/policy/b1-revenue-recognition-engine.constants.ts` — B1 revenue-recognition engine constants.
- `src/policy/b1-revenue-recognition-engine.entity.ts` — B1 revenue-recognition decision persistence entity.
- `src/policy/b1-revenue-recognition-engine.repository.ts` — B1 revenue-recognition engine repository.
- `src/policy/b1-revenue-recognition-engine.service.ts` — B1 revenue-recognition engine service.
- `src/policy/b1-revenue-recognition-engine.module.ts` — B1 revenue-recognition engine NestJS module.
- `src/migrations/1785753600036-CreateB1RevenueRecognitionDecisionTables.ts` — B1 revenue-recognition decision persistence migration.
- `test/b1-revenue-recognition-engine.types.spec.ts` — B1 revenue-recognition engine types tests.
- `test/b1-revenue-recognition-engine.repository.spec.ts` — B1 revenue-recognition engine repository tests.
- `test/b1-revenue-recognition-engine.service.spec.ts` — B1 revenue-recognition engine service tests.
- `test/b1-revenue-recognition-engine.module.spec.ts` — B1 revenue-recognition engine module tests.
