# ADR-0068 — B1 Commercial-Analytics Engine, Profitability Engine, and Commercial-Reconciliation Engine

- **Phase:** B1 — Commercial Platform
- **Task:** B1T09 — B1 Commercial-Analytics Engine, Profitability Engine, and Commercial-Reconciliation Engine
- **Status:** Accepted (B1T09 implementation)
- **Review snapshot:** `b1t09` (B1T09 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Context

B1T01 established the B1 commercial platform baseline and the first commercial scope. B1T02 established the B1 commercial catalog and commercial-boundary contract (`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`). B1T03 populated the first commercial scope registration. B1T04 implemented the B1 fee engine, commission engine, and revenue sharing decision engine. B1T05 implemented the B1 billing engine, invoice engine, and statement-generation engine. B1T06 implemented the B1 campaign engine, promotion engine, and coupon engine. B1T07 implemented the B1 referral engine, cashback engine, and loyalty engine. B1T08 implemented the B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine.

B1T09 implements the B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine for the B1 first commercial scope. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine is required by the B1T09 plan deliverable and the B1T02 commercial catalog and commercial-boundary contract. The B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine ADR records the architectural decisions for the B1 commercial-analytics decision engine, the B1 commercial-analytics profitability engine, the B1 commercial-analytics commercial-reconciliation engine, the B1 commercial-analytics consumer ports, the B1 commercial-analytics persistence, the B1 commercial-analytics versioning, the B1 commercial-analytics compatibility validation, the B1 commercial-analytics replay-safe decision engine, the B1 commercial-analytics audit / idempotency / outbox / metrics integration, and the B1 commercial-analytics explanation trace / rule trace / analytics trace.

## 2. Decision

### 2.1 B1 commercial-analytics engine

The B1 commercial-analytics engine is the B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine. The B1 commercial-analytics engine is the only B1 commercial-analytics engine for commercial analytics, profitability, and commercial reconciliation. The B1 commercial-analytics engine is a deterministic read-only commercial-analytics decision engine that produces a durable B1 commercial-analytics decision (commercial-analytics decision, profitability decision, or commercial-reconciliation decision) for a single commercial flow. The B1 commercial-analytics engine is a read-only decision/analysis engine; the B1 commercial-analytics engine never writes source records, never auto-repairs discrepancies, never rewrites history, never posts a journal, never mutates a balance, never executes a settlement, never executes a payout, never dispatches a notification, and never communicates with external partners.

The B1 commercial-analytics engine runs in a REPEATABLE READ, read-only TypeORM transaction. The B1 commercial-analytics engine never takes any write lock. The B1 commercial-analytics engine is bounded by the A4 policy limits; the B1 commercial-analytics engine never overrides A4. The B1 commercial-analytics engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 financial-invariants; the B1 commercial-analytics engine never posts to Ledger and never bypasses A5 financial-invariants. The B1 commercial-analytics engine is bounded by the A6 partner state, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 commercial-analytics engine never substitutes the A6 partner boundary. The B1 commercial-analytics engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 commercial-analytics engine never substitutes the A7 product boundary. The B1 commercial-analytics engine is bounded by the B1T03 commercial catalog, the B1T04 commercial decision, the B1T05 billing document, the B1T06 commercial-incentive decision, the B1T07 commercial-rewards decision, and the B1T08 commercial-financial-recognition decision; the B1 commercial-analytics engine consumes these decisions through approved read-only consumer boundary surfaces and never substitutes or overrides them.

The B1 commercial-analytics engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 commercial-analytics engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

### 2.2 B1 commercial-analytics decision kinds

The B1 commercial-analytics engine determines the applicable commercial KPI, the applicable commercial metric, the applicable trend analysis, the applicable product analytics, the applicable customer analytics, the applicable merchant analytics, the applicable partner analytics, the applicable profitability dimension, the applicable revenue attribution, the applicable cost attribution, the applicable profitability decision, the applicable commercial-reconciliation report, the applicable commercial-reconciliation evidence, the applicable commercial-reconciliation trace, the applicable commercial-reconciliation discrepancy, the customer eligibility, the merchant eligibility, the partner eligibility, the product eligibility, the tier eligibility, the period eligibility, the KPI availability, the profitability availability, and the reconciliation availability for the B1 first commercial scope. The B1 commercial-analytics engine produces three bounded decision kinds: commercial-analytics decision, profitability decision, and commercial-reconciliation decision.

### 2.3 B1 commercial-analytics consumer ports

The B1 commercial-analytics consumer ports are the canonical B1 commercial-analytics read-only consumer boundary surface for later B1 tasks (B1T10 commercial data classification / commercial disclosure / commercial support-trace surface, B1T11 commercial release gate).

The B1 commercial-analytics consumer ports expose seven functions:

1. `generateCommercialAnalyticsDecision(request)` — Returns the canonical B1 commercial-analytics decision for the supplied B1 commercial-analytics request. The generate is read-only; the B1 commercial-analytics engine never writes source records, never auto-repairs discrepancies, never dispatches a notification, or executes any financial effect.
2. `replaySafeGenerateCommercialAnalyticsDecision(request)` — Returns the canonical B1 commercial-analytics decision replay-safe result for the supplied B1 commercial-analytics request. The replay-safe generate is read-only; the B1 commercial-analytics engine never writes source records, never auto-repairs discrepancies, never dispatches a notification, or executes any financial effect.
3. `generateProfitabilityDecision(request)` — Returns the canonical B1 profitability decision for the supplied B1 profitability request. The generate is read-only; the B1 profitability engine never writes source records, never auto-repairs discrepancies, never dispatches a notification, or executes any financial effect.
4. `replaySafeGenerateProfitabilityDecision(request)` — Returns the canonical B1 profitability decision replay-safe result for the supplied B1 profitability request. The replay-safe generate is read-only; the B1 profitability engine never writes source records, never auto-repairs discrepancies, never dispatches a notification, or executes any financial effect.
5. `generateCommercialReconciliationDecision(request)` — Returns the canonical B1 commercial-reconciliation decision for the supplied B1 commercial-reconciliation request. The generate is read-only; the B1 commercial-reconciliation engine never writes source records, never auto-repairs discrepancies, never dispatches a notification, or executes any financial effect.
6. `replaySafeGenerateCommercialReconciliationDecision(request)` — Returns the canonical B1 commercial-reconciliation decision replay-safe result for the supplied B1 commercial-reconciliation request. The replay-safe generate is read-only; the B1 commercial-reconciliation engine never writes source records, never auto-repairs discrepancies, never dispatches a notification, or executes any financial effect.
7. `compatibilityCheck(request)` — Returns the canonical B1 commercial-analytics compatibility result for the supplied B1 commercial-analytics / profitability / commercial-reconciliation request. The compatibility check is read-only; the B1 commercial-analytics engine never writes source records, never auto-repairs discrepancies, never dispatches a notification, or executes any financial effect.

### 2.4 B1 commercial-analytics persistence

The B1 commercial-analytics decision is persisted in the `b1_commercial_analytics_decisions` table, introduced in `src/migrations/1785753600037-CreateB1CommercialAnalyticsDecisionTables.ts`. The `b1_commercial_analytics_decisions` table is the only B1 commercial-analytics decision persistence surface; the B1 commercial-analytics decision persistence is the only B1 commercial-analytics decision authority for the durable B1 commercial-analytics decision. The B1 commercial-analytics decision persistence does NOT introduce a second B1 commercial-analytics decision authority.

The B1 commercial-analytics decision persistence is configuration only. The B1 commercial-analytics decision persistence does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects. The B1 commercial-analytics decision persistence is a read-only contract against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, B1T06 commercial-incentive decision, B1T07 commercial-rewards decision, B1T08 commercial-financial-recognition decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.

### 2.5 B1 commercial-analytics versioning

The B1 commercial-analytics versioning contract is recorded in `B1CommercialAnalyticsDocumentVersioningContractV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09). The B1 commercial-analytics versioning contract records the B1 commercial-analytics decision version, the B1 commercial-analytics decision identity, the B1 commercial-analytics decision effective-from, the B1 commercial-analytics decision effective-to, the B1 commercial-analytics decision superseded-by reference, the B1 commercial-analytics decision supersedes reference, and the B1 commercial-analytics decision migration hint. The B1 commercial-analytics versioning contract is read-only; the B1 commercial-analytics engine does NOT publish a new B1 commercial-analytics decision version.

The B1 commercial-analytics versioning rules are:

1. The B1 commercial-analytics scope version is `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
2. The B1 commercial-analytics decision version is `1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
3. The B1 commercial-analytics version negotiation is exact-match (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09).
4. The B1 commercial-analytics engine does NOT support cross-catalog negotiation.
5. The B1 commercial-analytics engine does NOT support cross-billing-engine negotiation.
6. The B1 commercial-analytics engine does NOT support cross-campaign-engine negotiation.
7. The B1 commercial-analytics engine does NOT support cross-referral-engine negotiation.
8. The B1 commercial-analytics engine does NOT support cross-revenue-recognition-engine negotiation.
9. A later B1 commercial-analytics version (v2) MAY add optional fields, decision kinds, or extension points; a later B1 commercial-analytics version MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

### 2.6 B1 commercial-analytics compatibility validation

The B1 commercial-analytics compatibility validation is recorded in `B1CommercialAnalyticsEngineCompatibilityResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09). The B1 commercial-analytics compatibility validation verifies that the B1 commercial-analytics decision version is supported, that the B1 commercial-analytics scope key is supported, that the B1 commercial-analytics scope version is supported, that the B1 commercial-analytics decision kind is supported, that the B1 commercial-analytics currency is supported, that the B1 commercial-analytics accounting unit is supported, that the B1 commercial-analytics product dependency is supported, that the B1 commercial-analytics partner dependency is supported, that the B1 commercial-analytics commercial KPI is valid, that the B1 commercial-analytics commercial trend is valid, that the B1 commercial-analytics profitability dimension is valid, and that the B1 commercial-analytics plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

### 2.7 B1 commercial-analytics replay-safe decision engine

The B1 commercial-analytics replay-safe decision engine is recorded in `B1CommercialAnalyticsDecisionReplaySafeResultV1`, `B1ProfitabilityDecisionReplaySafeResultV1`, and `B1CommercialReconciliationDecisionReplaySafeResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09). The B1 commercial-analytics replay-safe decision engine uses the B1 commercial-analytics commercial-analytics internal idempotency scope (`b1.commercial-analytics-engine.commercial-analytics.idempotency.v1`), the B1 commercial-analytics profitability internal idempotency scope (`b1.commercial-analytics-engine.profitability.idempotency.v1`), the B1 commercial-analytics commercial-reconciliation internal idempotency scope (`b1.commercial-analytics-engine.commercial-reconciliation.idempotency.v1`), the B1 commercial-analytics internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial-analytics idempotency key, and the B1 commercial-analytics request hash (SHA-256 over the canonical request payload).

The B1 commercial-analytics replay rules are:

1. The B1 commercial-analytics replay window is 86_400 seconds (24 hours).
2. The B1 commercial-analytics replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial-analytics replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial-analytics replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial-analytics replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial-analytics replay rule inherits the A1-A7 replay rules.
7. The B1 commercial-analytics replay rule inherits the B1T03 catalog replay rule.
8. The B1 commercial-analytics replay rule inherits the B1T04 commercial decision replay rule.
9. The B1 commercial-analytics replay rule inherits the B1T05 billing document replay rule.
10. The B1 commercial-analytics replay rule inherits the B1T06 commercial-incentive decision replay rule.
11. The B1 commercial-analytics replay rule inherits the B1T07 commercial-rewards decision replay rule.
12. The B1 commercial-analytics replay rule inherits the B1T08 commercial-financial-recognition decision replay rule.
13. The B1 commercial-analytics replay rule is number-deterministic.

The B1 commercial-analytics decision hash is computed from the canonical B1 commercial-analytics decision payload (excluding the random `decisionId` and the `generatedAt` timestamp). The B1 commercial-analytics replay hash is computed from the B1 commercial-analytics decision hash, the B1 commercial-analytics request hash, the B1 commercial-analytics idempotency key, and the B1 commercial-analytics correlation id.

### 2.8 B1 commercial-analytics audit / idempotency / outbox / metrics integration

The B1 commercial-analytics engine emits B1 commercial-analytics audit facts through the shared Operations `AuditService` (the only audit authority), reserves B1 commercial-analytics idempotency records through the shared Operations `IdempotencyService` (the only internal idempotency authority), enqueues B1 commercial-analytics outbox events through the shared Operations `OutboxService` (the only outbox authority), and records B1 commercial-analytics metrics through the shared Operations `MetricsService` (the only metrics authority). The B1 commercial-analytics audit actor is `b1-commercial-analytics-engine`. The B1 commercial-analytics audit entity type is `B1_COMMERCIAL_ANALYTICS_DECISION`. The B1 commercial-analytics outbox event type is `B1CommercialAnalyticsDecisionDecided`. The B1 commercial-analytics outbox event classification is `INTERNAL_OPERATIONS`. The B1 commercial-analytics outbox event retention class is `OPERATIONS_DEFAULT`.

### 2.9 B1 commercial-analytics lifecycle vocabularies

The B1 commercial-analytics commercial-analytics state vocabulary is: `DRAFT`, `ACTIVE`, `SUSPENDED`, `RETIRED`, `ARCHIVED`. The B1 commercial-analytics profitability state vocabulary is: `DRAFT`, `ACTIVE`, `SUSPENDED`, `RETIRED`, `ARCHIVED`. The B1 commercial-analytics commercial-reconciliation state vocabulary is: `DRAFT`, `PENDING`, `IN_PROGRESS`, `RECONCILED`, `DISCREPANCY`, `CLOSED`. The B1 commercial-analytics decision outcome vocabulary is: `AVAILABLE`, `COMPLETED`, `RECONCILED`, `DISCREPANCY`, `REPLAYED`.

The B1 commercial-analytics commercial KPI vocabulary is: `GMV`, `NET_REVENUE`, `GROSS_PROFIT`, `NET_PROFIT`, `CUSTOMER_LIFETIME_VALUE`, `CUSTOMER_ACQUISITION_COST`, `FEE_VOLUME`, `COMMISSION_VOLUME`, `CAMPAIGN_UTILIZATION`, `COUPON_REDEMPTION_RATE`, `REFERRAL_CONVERSION_RATE`, `CASHBACK_UTILIZATION`, `LOYALTY_REDEMPTION_RATE`, `REVENUE_RECOGNITION_RATE`, `TAX_COMPLIANCE_RATE`, `COST_ALLOCATION_RATE`, `BILLING_ACCURACY`, `INVOICE_ACCURACY`, `STATEMENT_ACCURACY`, `RECONCILIATION_RATE`.

The B1 commercial-analytics commercial trend vocabulary is: `INCREASING`, `STABLE`, `DECREASING`, `VOLATILE`, `INSUFFICIENT_DATA`.

The B1 commercial-analytics discrepancy severity vocabulary is: `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. The B1 commercial-analytics discrepancy owner vocabulary is: `B1_COMMERCIAL_CATALOG_OWNER`, `B1_FEE_ENGINE_OWNER`, `B1_BILLING_ENGINE_OWNER`, `B1_CAMPAIGN_ENGINE_OWNER`, `B1_REFERRAL_ENGINE_OWNER`, `B1_REVENUE_RECOGNITION_ENGINE_OWNER`, `A5_LEDGER_OWNER`, `A6_PARTNER_OWNER`, `A7_PRODUCT_OWNER`, `OPERATIONS_OWNER`. The B1 commercial-analytics discrepancy recovery state vocabulary is: `OPEN`, `ACKNOWLEDGED`, `INVESTIGATING`, `PENDING_REMEDIATION`, `PENDING_OWNER_REVIEW`, `CLOSED_RESOLVED`, `CLOSED_ACCEPTED`, `CLOSED_WONT_FIX`. The B1 commercial-analytics discrepancy category vocabulary is: `COMMERCIAL_DECISION_DISCREPANCY`, `COMMERCIAL_FINANCIAL_EFFECT_DISCREPANCY`, `COMMERCIAL_BILLING_DISCREPANCY`, `COMMERCIAL_INVOICE_DISCREPANCY`, `COMMERCIAL_STATEMENT_DISCREPANCY`, `COMMERCIAL_CAMPAIGN_DISCREPANCY`, `COMMERCIAL_PROMOTION_DISCREPANCY`, `COMMERCIAL_COUPON_DISCREPANCY`, `COMMERCIAL_REFERRAL_DISCREPANCY`, `COMMERCIAL_CASHBACK_DISCREPANCY`, `COMMERCIAL_LOYALTY_DISCREPANCY`, `COMMERCIAL_REVENUE_RECOGNITION_DISCREPANCY`, `COMMERCIAL_TAX_DISCREPANCY`, `COMMERCIAL_COST_ACCOUNTING_DISCREPANCY`, `COMMERCIAL_PROFITABILITY_DISCREPANCY`, `COMMERCIAL_ANALYTICS_DISCREPANCY`. The B1 commercial-analytics profitability dimension vocabulary is: `PRODUCT`, `CUSTOMER`, `MERCHANT`, `PARTNER`, `CAMPAIGN`, `FEE`, `REVENUE`, `COST`.

### 2.10 B1 commercial-analytics execution boundary

The B1 commercial-analytics engine is a DECISION/ANALYSIS ENGINE ONLY. The B1 commercial-analytics engine produces deterministic analytical and reconciliation decisions that later B1 tasks may consume. The B1 commercial-analytics engine does NOT introduce a second Reconciliation authority, a second Analytics authority outside B1, a second Finance authority, or a second Ledger.

The B1 commercial-analytics engine NEVER dispatches notifications, executes financial effects, credits wallets, debits wallets, posts journals, mutates balances, performs settlements, performs payouts, performs reconciliation, communicates with external partners, auto-repairs discrepancies, or rewrites history. The B1 commercial-analytics engine is read-only against all existing A1-A7 and B1T01-B1T08 authorities. The B1 commercial-analytics engine is a read-write consumer of the shared Operations `IdempotencyService`, `AuditService`, `OutboxService`, and `MetricsService` only.

## 3. Consequences

### 3.1 Positive consequences

- The B1 commercial-analytics engine is the only B1 commercial-analytics engine for commercial analytics, profitability, and commercial reconciliation. The B1 commercial-analytics engine is the only B1 commercial-analytics authority; the B1 commercial-analytics engine does NOT introduce a second B1 commercial-analytics authority.
- The B1 commercial-analytics consumer ports are the canonical B1 commercial-analytics consumer ports. The B1 commercial-analytics consumer ports do NOT introduce a second B1 commercial-analytics consumer port.
- The B1 commercial-analytics decision persistence is the only B1 commercial-analytics decision persistence surface. The B1 commercial-analytics decision persistence does NOT introduce a second B1 commercial-analytics decision persistence surface.
- The B1 commercial-analytics versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration are the canonical B1 commercial-analytics surfaces. The B1 commercial-analytics versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration do NOT introduce a second B1 commercial-analytics authority.
- The B1 commercial-analytics decision is deterministic. Identical inputs ALWAYS produce identical B1 commercial-analytics decisions.
- The B1 commercial-analytics decision is replay-safe. A duplicate B1 commercial-analytics decision request returns the durable original B1 commercial-analytics decision.
- The B1 commercial-analytics engine is configuration only. The B1 commercial-analytics engine does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects.
- The B1 commercial-analytics engine is read-only against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, B1T06 commercial-incentive decision, B1T07 commercial-rewards decision, B1T08 commercial-financial-recognition decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.
- The B1 commercial-analytics engine is designed to be capable of supporting future commercial KPIs, commercial metrics, commercial trends, profitability dimensions, revenue attribution, cost attribution, discrepancy severities, discrepancy owners, discrepancy recovery states, and discrepancy categories without changing existing A1-A7 and B1T01-B1T08 authorities.

### 3.2 Negative consequences

- The B1 commercial-analytics decision persistence migration (`1785753600037-CreateB1CommercialAnalyticsDecisionTables`) is a new database migration. The B1 commercial-analytics decision persistence migration MUST be applied before any B1 commercial-analytics decision persistence record is created.
- The B1 commercial-analytics decision persistence adds a new database table (`b1_commercial_analytics_decisions`). The B1 commercial-analytics decision persistence table is the only B1 commercial-analytics decision persistence surface; the B1 commercial-analytics decision persistence table does NOT introduce a second B1 commercial-analytics decision persistence surface.
- The B1 commercial-analytics explanation trace, rule trace, and analytics trace are recorded for every B1 commercial-analytics decision. The B1 commercial-analytics explanation trace, rule trace, and analytics trace are NOT recorded for the B1 commercial-analytics decision failure record.
- The B1 commercial-analytics engine produces commercial-analytics decisions that later B1 tasks must consume. A future B1 task (out of B1T09 scope) MUST consume the B1 commercial-analytics decision through the B1 commercial-analytics consumer ports and MUST NOT bypass the B1 commercial-analytics engine.

## 4. Alternatives considered

### 4.1 B1 commercial-analytics engine as a service-only contract

The B1 commercial-analytics engine could be implemented as a service-only contract (without a database table). The B1 commercial-analytics engine as a service-only contract was rejected because the B1 commercial-analytics decision is a durable artifact and the B1 commercial-analytics decision MUST be queryable from the B1 commercial-analytics read-only consumer boundary surface. The B1 commercial-analytics engine as a service-only contract would require a B1 commercial-analytics decision in-memory cache, which is rejected because the B1 commercial-analytics decision is a single source of truth and the B1 commercial-analytics decision MUST be queryable across multiple B1 commercial-analytics engine instances.

### 4.2 B1 commercial-analytics engine with auto-repair

The B1 commercial-analytics engine could be implemented with auto-repair (e.g., the B1 commercial-reconciliation engine could automatically repair discrepancies, clear suspense, or issue correction entries). The B1 commercial-analytics engine with auto-repair was rejected because the B1 commercial-analytics engine is a DECISION/ANALYSIS ENGINE ONLY. The B1 commercial-analytics engine never auto-repairs discrepancies, never rewrites history, and never mutates source records. A future B1 task (out of B1T09 scope) MUST consume the B1 commercial-analytics decision through the B1 commercial-analytics consumer ports and MUST NOT bypass the B1 commercial-analytics engine.

### 4.3 B1 commercial-analytics engine as a second B1T08 commercial-financial-recognition engine

The B1 commercial-analytics engine could be implemented as a second B1T08 commercial-financial-recognition engine. The B1 commercial-analytics engine as a second B1T08 commercial-financial-recognition engine was rejected because the B1T08 commercial-financial-recognition engine is the only B1 commercial-financial-recognition engine for revenue recognition, tax / VAT, and cost accounting; the B1 commercial-analytics engine reuses the B1T08 commercial-financial-recognition decision through the existing B1T08 read-only consumer boundary.

### 4.4 B1 commercial-analytics engine as a second Reconciliation authority

The B1 commercial-analytics engine could be implemented as a second Reconciliation authority. The B1 commercial-analytics engine as a second Reconciliation authority was rejected because the B1 commercial-analytics engine is the only B1 commercial-reconciliation authority for the B1 decision envelope. The B1 commercial-analytics engine is a read-only consumer of the A6T09 external reconciliation, A7T09 product reconciliation, and B1T01-B1T08 reconciliation authorities.

### 4.5 B1 commercial-analytics engine as a second Analytics authority

The B1 commercial-analytics engine could be implemented as a second Analytics authority outside B1. The B1 commercial-analytics engine as a second Analytics authority outside B1 was rejected because the B1 commercial-analytics engine is the only B1 commercial-analytics engine. No analytics authority outside B1 is introduced by B1T09.

## 5. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T09 — B1 Commercial-Analytics, Profitability, and Commercial Reconciliation Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md` — B1 campaign engine, promotion engine, and coupon engine contract.
- `docs/B1-REFERRAL-ENGINE-CONTRACT.md` — B1 referral engine, cashback engine, and loyalty engine contract.
- `docs/B1-REVENUE-RECOGNITION-CONTRACT.md` — B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `docs/ADR/ADR-0065-B1-Campaign-Promotion-Coupon-Engine.md` — B1 campaign engine, promotion engine, and coupon engine ADR.
- `docs/ADR/ADR-0066-B1-Referral-Cashback-Loyalty-Engine.md` — B1 referral engine, cashback engine, and loyalty engine ADR.
- `docs/ADR/ADR-0067-B1-Revenue-Recognition-Tax-VAT-Cost-Accounting-Engine.md` — B1 revenue-recognition engine, tax / VAT engine, and cost-accounting engine ADR.
- `docs/B1-COMMERCIAL-ANALYTICS-CONTRACT.md` — B1 commercial-analytics engine, profitability engine, and commercial-reconciliation engine contract.
- `src/policy/b1-commercial-analytics-engine.types.ts` — B1 commercial-analytics engine types.
- `src/policy/b1-commercial-analytics-engine.constants.ts` — B1 commercial-analytics engine constants.
- `src/policy/b1-commercial-analytics-engine.entity.ts` — B1 commercial-analytics decision persistence entity.
- `src/policy/b1-commercial-analytics-engine.repository.ts` — B1 commercial-analytics engine repository.
- `src/policy/b1-commercial-analytics-engine.service.ts` — B1 commercial-analytics engine service.
- `src/policy/b1-commercial-analytics-engine.module.ts` — B1 commercial-analytics engine NestJS module.
- `src/migrations/1785753600037-CreateB1CommercialAnalyticsDecisionTables.ts` — B1 commercial-analytics decision persistence migration.
- `test/b1-commercial-analytics-engine.types.spec.ts` — B1 commercial-analytics engine types tests.
- `test/b1-commercial-analytics-engine.repository.spec.ts` — B1 commercial-analytics engine repository tests.
- `test/b1-commercial-analytics-engine.service.spec.ts` — B1 commercial-analytics engine service tests.
- `test/b1-commercial-analytics-engine.module.spec.ts` — B1 commercial-analytics engine module tests.
