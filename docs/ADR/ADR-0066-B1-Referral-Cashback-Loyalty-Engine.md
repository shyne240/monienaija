# ADR-0066 — B1 Referral Engine, Cashback Engine, and Loyalty Engine

- **Phase:** B1 — Commercial Platform
- **Task:** B1T07 — B1 Referral Engine, Cashback Engine, and Loyalty Engine
- **Status:** Accepted (B1T07 implementation)
- **Review snapshot:** `b1t07` (B1T07 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Context

B1T01 established the B1 commercial platform baseline and the first commercial scope. B1T02 established the B1 commercial catalog and commercial-boundary contract (`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`). B1T03 populated the first commercial scope registration with the actual B1 commercial plans, customer tiers, merchant tiers, partner tiers, product entitlements, commercial packages, commercial bundles, feature flags, dynamic limits, and subscription plans, and froze the B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface for later B1 tasks. B1T04 implemented the B1 fee engine, commission engine, and revenue sharing decision engine. B1T05 implemented the B1 billing engine, invoice engine, and statement-generation engine. B1T06 implemented the B1 campaign engine, promotion engine, and coupon engine.

B1T07 implements the B1 referral engine, cashback engine, and loyalty engine for the B1 first commercial scope. The B1 referral engine, cashback engine, and loyalty engine is required by the B1T07 plan deliverable and the B1T02 commercial catalog and commercial-boundary contract. The B1 referral engine, cashback engine, and loyalty engine ADR records the architectural decisions for the B1 commercial-rewards engine, the B1 commercial-rewards consumer ports, the B1 commercial-rewards persistence, the B1 commercial-rewards versioning, the B1 commercial-rewards compatibility validation, the B1 commercial-rewards replay-safe decision engine, the B1 commercial-rewards audit / idempotency / outbox / metrics integration, and the B1 commercial-rewards explanation trace / rule trace.

## 2. Decision

### 2.1 B1 commercial-rewards engine

The B1 commercial-rewards engine is the B1 referral engine, cashback engine, and loyalty engine. The B1 commercial-rewards engine is the only B1 commercial-rewards engine for referrals, cashback, and loyalty. The B1 commercial-rewards engine is a deterministic commercial-rewards decision engine that produces a durable B1 commercial-rewards decision (referral reward decision, cashback calculation decision, or loyalty earning decision) for a single commercial flow. The B1 commercial-rewards engine is a read-only decision engine; the B1 commercial-rewards engine never posts a journal, mutates a balance, executes a settlement, executes a payout, redeems cashback, awards loyalty balances, redeems loyalty balances, executes referral rewards, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies invoices, modifies statements, modifies commercial decisions, modifies pricing catalogs, modifies product state, or dispatches a notification.

The B1 commercial-rewards engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 commercial-rewards engine never overrides A4. The B1 commercial-rewards engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 commercial-rewards engine never posts to Ledger. The B1 commercial-rewards engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 commercial-rewards engine never substitutes the A6 partner boundary. The B1 commercial-rewards engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 commercial-rewards engine never substitutes the A7 product boundary. The B1 commercial-rewards engine is bounded by the B1T04 commercial decision; the B1 commercial-rewards engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing. The B1 commercial-rewards engine is bounded by the B1T05 billing document; the B1 commercial-rewards engine consumes the B1T05 billing document read-only and never modifies invoices, statements, or other billing documents. The B1 commercial-rewards engine is bounded by the B1T06 commercial-incentive decision; the B1 commercial-rewards engine consumes the B1T06 commercial-incentive decision read-only and never substitutes or overrides the B1T06 commercial-incentive decision.

The B1 commercial-rewards engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 commercial-rewards engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

### 2.2 B1 commercial-rewards decision kinds

The B1 commercial-rewards engine determines the applicable referral eligibility, the applicable referral relationship, the applicable referral hierarchy, the applicable referral qualification, the applicable referral reward, the applicable cashback eligibility, the applicable cashback campaign, the applicable cashback calculation, the applicable cashback rule evaluation, the applicable loyalty program, the applicable loyalty tier, the applicable loyalty earning, the applicable loyalty point policy, the applicable loyalty redemption eligibility, the customer eligibility, the merchant eligibility, the partner eligibility, the product eligibility, the activation rules, the expiration, the usage limits, the campaign limits, the cashback limits, the loyalty limits, and the replay eligibility for the B1 first commercial scope. The B1 commercial-rewards engine produces three bounded decision kinds: referral reward decision, cashback calculation decision, and loyalty earning decision.

### 2.3 B1 commercial-rewards consumer ports

The B1 commercial-rewards consumer ports are the canonical B1 commercial-rewards read-only consumer boundary surface for later B1 tasks (B1T08 revenue-recognition / tax / cost-accounting engine, B1T09 commercial analytics / profitability / commercial reconciliation engine, B1T10 commercial data classification / commercial disclosure / commercial support-trace surface, B1T11 commercial release gate).

The B1 commercial-rewards consumer ports expose seven functions:

1. `generateReferralRewardDecision(request)` — Returns the canonical B1 referral reward decision for the supplied B1 referral request. The generate is read-only; the B1 referral engine never posts a journal, mutates a balance, executes referral rewards, dispatches a notification, or executes any financial effect.
2. `replaySafeGenerateReferralRewardDecision(request)` — Returns the canonical B1 referral reward decision replay-safe result for the supplied B1 referral request. The replay-safe generate is read-only; the B1 referral engine never posts a journal, mutates a balance, executes referral rewards, dispatches a notification, or executes any financial effect.
3. `generateCashbackCalculationDecision(request)` — Returns the canonical B1 cashback calculation decision for the supplied B1 cashback request. The generate is read-only; the B1 cashback engine never posts a journal, mutates a balance, redeems cashback, dispatches a notification, or executes any financial effect.
4. `replaySafeGenerateCashbackCalculationDecision(request)` — Returns the canonical B1 cashback calculation decision replay-safe result for the supplied B1 cashback request. The replay-safe generate is read-only; the B1 cashback engine never posts a journal, mutates a balance, redeems cashback, dispatches a notification, or executes any financial effect.
5. `generateLoyaltyEarningDecision(request)` — Returns the canonical B1 loyalty earning decision for the supplied B1 loyalty earning request. The generate is read-only; the B1 loyalty engine never posts a journal, mutates a balance, awards loyalty balances, redeems loyalty balances, dispatches a notification, or executes any financial effect.
6. `replaySafeGenerateLoyaltyEarningDecision(request)` — Returns the canonical B1 loyalty earning decision replay-safe result for the supplied B1 loyalty earning request. The replay-safe generate is read-only; the B1 loyalty engine never posts a journal, mutates a balance, awards loyalty balances, redeems loyalty balances, dispatches a notification, or executes any financial effect.
7. `compatibilityCheck(request)` — Returns the canonical B1 commercial-rewards compatibility result for the supplied B1 referral / cashback / loyalty request. The compatibility check is read-only; the B1 commercial-rewards engine never posts a journal, mutates a balance, executes referral rewards, redeems cashback, awards loyalty balances, dispatches a notification, or executes any financial effect.

### 2.4 B1 commercial-rewards persistence

The B1 commercial-rewards decision is persisted in the `b1_referral_decisions` table, introduced in `src/migrations/1785753600035-CreateB1ReferralDecisionTables.ts`. The `b1_referral_decisions` table is the only B1 commercial-rewards decision persistence surface; the B1 commercial-rewards decision persistence is the only B1 commercial-rewards decision authority for the durable B1 commercial-rewards decision. The B1 commercial-rewards decision persistence does NOT introduce a second B1 commercial-rewards decision authority.

The B1 commercial-rewards decision persistence is configuration only. The B1 commercial-rewards decision persistence does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects. The B1 commercial-rewards decision persistence is a read-only contract against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, B1T06 commercial-incentive decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.

### 2.5 B1 commercial-rewards versioning

The B1 commercial-rewards versioning contract is recorded in `B1ReferralDocumentVersioningContractV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07). The B1 commercial-rewards versioning contract records the B1 commercial-rewards decision version, the B1 commercial-rewards decision identity, the B1 commercial-rewards decision effective-from, the B1 commercial-rewards decision effective-to, the B1 commercial-rewards decision superseded-by reference, the B1 commercial-rewards decision supersedes reference, and the B1 commercial-rewards decision migration hint. The B1 commercial-rewards versioning contract is read-only; the B1 commercial-rewards engine does NOT publish a new B1 commercial-rewards decision version.

The B1 commercial-rewards versioning rules are:

1. The B1 commercial-rewards scope version is `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
2. The B1 commercial-rewards decision version is `1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
3. The B1 commercial-rewards version negotiation is exact-match (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
4. The B1 commercial-rewards engine does NOT support cross-catalog negotiation (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
5. The B1 commercial-rewards engine does NOT support cross-billing-engine negotiation (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
6. The B1 commercial-rewards engine does NOT support cross-campaign-engine negotiation (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07).
7. A later B1 commercial-rewards version (v2) MAY add optional fields, decision kinds, or extension points; a later B1 commercial-rewards version MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

### 2.6 B1 commercial-rewards compatibility validation

The B1 commercial-rewards compatibility validation is recorded in `B1ReferralEngineCompatibilityResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07). The B1 commercial-rewards compatibility validation verifies that the B1 commercial-rewards decision version is supported, that the B1 commercial-rewards scope key is supported, that the B1 commercial-rewards scope version is supported, that the B1 commercial-rewards decision kind is supported, that the B1 commercial-rewards currency is supported, that the B1 commercial-rewards accounting unit is supported, that the B1 commercial-rewards product dependency is supported, that the B1 commercial-rewards partner dependency is supported, that the B1 commercial-rewards relationship / hierarchy / qualification / tier / point-policy are valid, that the B1 commercial-rewards usage limits are valid, and that the B1 commercial-rewards plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

### 2.7 B1 commercial-rewards replay-safe decision engine

The B1 commercial-rewards replay-safe decision engine is recorded in `B1ReferralRewardReplaySafeResultV1`, `B1CashbackCalculationReplaySafeResultV1`, and `B1LoyaltyEarningReplaySafeResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07). The B1 commercial-rewards replay-safe decision engine uses the B1 commercial-rewards referral internal idempotency scope (`b1.referral-engine.referral.idempotency.v1`), the B1 commercial-rewards cashback internal idempotency scope (`b1.referral-engine.cashback.idempotency.v1`), the B1 commercial-rewards loyalty internal idempotency scope (`b1.referral-engine.loyalty.idempotency.v1`), the B1 commercial-rewards internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial-rewards idempotency key, and the B1 commercial-rewards request hash (SHA-256 over the canonical request payload).

The B1 commercial-rewards replay rules are:

1. The B1 commercial-rewards replay window is 86_400 seconds (24 hours).
2. The B1 commercial-rewards replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial-rewards replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial-rewards replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial-rewards replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial-rewards replay rule inherits the A1-A7 replay rules (the A1-A7 replay rules are applied before the B1 commercial-rewards replay rule).
7. The B1 commercial-rewards replay rule inherits the B1T03 catalog replay rule (the B1T03 catalog replay rule is applied before the B1 commercial-rewards replay rule).
8. The B1 commercial-rewards replay rule inherits the B1T04 commercial decision replay rule (the B1T04 commercial decision replay rule is applied before the B1 commercial-rewards replay rule).
9. The B1 commercial-rewards replay rule inherits the B1T05 billing document replay rule (the B1T05 billing document replay rule is applied before the B1 commercial-rewards replay rule).
10. The B1 commercial-rewards replay rule inherits the B1T06 commercial-incentive decision replay rule (the B1T06 commercial-incentive decision replay rule is applied before the B1 commercial-rewards replay rule).
11. The B1 commercial-rewards replay rule is number-deterministic (the B1 commercial-rewards decision hash is the canonical B1 commercial-rewards decision hash).

The B1 commercial-rewards decision hash is computed from the canonical B1 commercial-rewards decision payload (excluding the random `decisionId` and the `generatedAt` timestamp). The B1 commercial-rewards replay hash is computed from the B1 commercial-rewards decision hash, the B1 commercial-rewards request hash, the B1 commercial-rewards idempotency key, and the B1 commercial-rewards correlation id.

### 2.8 B1 commercial-rewards audit / idempotency / outbox / metrics integration

The B1 commercial-rewards engine emits B1 commercial-rewards audit facts through the shared Operations `AuditService` (the only audit authority), reserves B1 commercial-rewards idempotency records through the shared Operations `IdempotencyService` (the only internal idempotency authority), enqueues B1 commercial-rewards outbox events through the shared Operations `OutboxService` (the only outbox authority), and records B1 commercial-rewards metrics through the shared Operations `MetricsService` (the only metrics authority). The B1 commercial-rewards audit actor is `b1-referral-engine`. The B1 commercial-rewards audit entity type is `B1_REFERRAL_DECISION`. The B1 commercial-rewards outbox event type is `B1ReferralDecisionDecided`. The B1 commercial-rewards outbox event classification is `INTERNAL_OPERATIONS`. The B1 commercial-rewards outbox event retention class is `OPERATIONS_DEFAULT`.

The B1 commercial-rewards metric names are:

- `b1.referral-engine.referral` — the B1 referral reward decision generate metric.
- `b1.referral-engine.cashback` — the B1 cashback calculation decision generate metric.
- `b1.referral-engine.loyalty` — the B1 loyalty earning decision generate metric.
- `b1.referral-engine.replayed` — the B1 commercial-rewards decision replayed metric.
- `b1.referral-engine.conflict` — the B1 commercial-rewards decision conflict metric.
- `b1.referral-engine.incompatible` — the B1 commercial-rewards decision incompatible metric.
- `b1.referral-engine.query-unavailable` — the B1 commercial-rewards decision query unavailable metric.
- `b1.referral-engine.in-progress` — the B1 commercial-rewards decision in progress metric.
- `b1.referral-engine.replay-conflict` — the B1 commercial-rewards decision replay conflict metric.
- `b1.referral-engine.replay-expired` — the B1 commercial-rewards decision replay expired metric.
- `b1.referral-engine.number-conflict` — the B1 commercial-rewards decision number conflict metric.
- `b1.referral-engine.expired` — the B1 commercial-rewards decision expired metric.
- `b1.referral-engine.usage-limit-exceeded` — the B1 commercial-rewards decision usage limit exceeded metric.
- `b1.referral-engine.not-applicable` — the B1 commercial-rewards decision not applicable metric.
- `b1.referral-engine.hierarchy-invalid` — the B1 commercial-rewards hierarchy invalid metric.
- `b1.referral-engine.qualification-insufficient` — the B1 commercial-rewards qualification insufficient metric.
- `b1.referral-engine.tier-insufficient` — the B1 commercial-rewards tier insufficient metric.
- `b1.referral-engine.point-policy-incompatible` — the B1 commercial-rewards point policy incompatible metric.
- `b1.referral-engine.a4-policy-denied` — the B1 commercial-rewards A4 policy denied metric.
- `b1.referral-engine.a3-binding-invalid` — the B1 commercial-rewards A3 binding invalid metric.
- `b1.referral-engine.a5-ledger-invariant-broken` — the B1 commercial-rewards A5 ledger invariant broken metric.
- `b1.referral-engine.a6-partner-incompatible` — the B1 commercial-rewards A6 partner incompatible metric.
- `b1.referral-engine.a7-product-incompatible` — the B1 commercial-rewards A7 product incompatible metric.
- `b1.referral-engine.catalog-incompatible` — the B1 commercial-rewards catalog incompatible metric.
- `b1.referral-engine.catalog-missing` — the B1 commercial-rewards catalog missing metric.
- `b1.referral-engine.decision-not-found` — the B1 commercial-rewards decision not found metric.
- `b1.referral-engine.decision-incompatible` — the B1 commercial-rewards decision incompatible metric.
- `b1.referral-engine.billing-document-not-found` — the B1 commercial-rewards billing document not found metric.
- `b1.referral-engine.billing-document-incompatible` — the B1 commercial-rewards billing document incompatible metric.
- `b1.referral-engine.campaign-decision-not-found` — the B1 commercial-rewards campaign decision not found metric.
- `b1.referral-engine.campaign-decision-incompatible` — the B1 commercial-rewards campaign decision incompatible metric.
- `b1.referral-engine.promotion-decision-not-found` — the B1 commercial-rewards promotion decision not found metric.
- `b1.referral-engine.promotion-decision-incompatible` — the B1 commercial-rewards promotion decision incompatible metric.
- `b1.referral-engine.coupon-decision-not-found` — the B1 commercial-rewards coupon decision not found metric.
- `b1.referral-engine.coupon-decision-incompatible` — the B1 commercial-rewards coupon decision incompatible metric.

### 2.9 B1 commercial-rewards lifecycle vocabularies

The B1 commercial-rewards referral state vocabulary is: `DRAFT`, `ACTIVE`, `PAUSED`, `EXPIRED`, `RETIRED`. The B1 commercial-rewards cashback state vocabulary is: `CREATED`, `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED`. The B1 commercial-rewards loyalty state vocabulary is: `DRAFT`, `ACTIVE`, `SUSPENDED`, `RETIRED`, `ARCHIVED`. The B1 commercial-rewards decision outcome vocabulary is: `ELIGIBLE`, `APPLIED`, `REJECTED`, `REPLAYED`.

### 2.10 B1 commercial-rewards execution boundary

The B1 commercial-rewards engine is a DECISION ENGINE ONLY. The B1 commercial-rewards engine produces deterministic commercial reward decisions that later execution layers may consume. The B1 commercial-rewards engine does NOT introduce a second Ledger, a second Wallet, a second Billing authority, a second Campaign authority, a second cashback-redemption authority, a second loyalty-balance authority, a second referral-reward-execution authority, a second cashback-authority, a second loyalty-authority, or a second referral-authority.

The B1 commercial-rewards engine NEVER dispatches notifications, executes financial effects, credits wallets, debits wallets, posts journals, redeems cashback, awards loyalty balances, redeems loyalty balances, executes referral rewards, performs payouts, performs settlements, performs reconciliation, or communicates with external partners. The B1 commercial-rewards engine is read-only against all existing A1-A7 and B1T01-B1T06 authorities. The B1 commercial-rewards engine is a read-write consumer of the shared Operations `IdempotencyService`, `AuditService`, `OutboxService`, and `MetricsService` only.

## 3. Consequences

### 3.1 Positive consequences

- The B1 commercial-rewards engine is the only B1 commercial-rewards engine for referrals, cashback, and loyalty. The B1 commercial-rewards engine is the only B1 commercial-rewards authority; the B1 commercial-rewards engine does NOT introduce a second B1 commercial-rewards authority.
- The B1 commercial-rewards consumer ports are the canonical B1 commercial-rewards consumer ports. The B1 commercial-rewards consumer ports do NOT introduce a second B1 commercial-rewards consumer port.
- The B1 commercial-rewards decision persistence is the only B1 commercial-rewards decision persistence surface. The B1 commercial-rewards decision persistence does NOT introduce a second B1 commercial-rewards decision persistence surface.
- The B1 commercial-rewards versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration are the canonical B1 commercial-rewards surfaces. The B1 commercial-rewards versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration do NOT introduce a second B1 commercial-rewards authority.
- The B1 commercial-rewards decision is deterministic. Identical inputs ALWAYS produce identical B1 commercial-rewards decisions.
- The B1 commercial-rewards decision is replay-safe. A duplicate B1 commercial-rewards decision request returns the durable original B1 commercial-rewards decision.
- The B1 commercial-rewards engine is configuration only. The B1 commercial-rewards engine does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects.
- The B1 commercial-rewards engine is read-only against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, B1T05 billing document, B1T06 commercial-incentive decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.
- The B1 commercial-rewards engine is designed to be capable of supporting future marketing campaigns, onboarding cashback, merchant cashback, seasonal cashback, loyalty tiers, loyalty programs, loyalty point policies, referral campaigns, referral programs, and customer loyalty prerequisites without changing existing A1-A7 authorities.

### 3.2 Negative consequences

- The B1 commercial-rewards decision persistence migration (`1785753600035-CreateB1ReferralDecisionTables`) is a new database migration. The B1 commercial-rewards decision persistence migration MUST be applied before any B1 commercial-rewards decision persistence record is created.
- The B1 commercial-rewards decision persistence adds a new database table (`b1_referral_decisions`). The B1 commercial-rewards decision persistence table is the only B1 commercial-rewards decision persistence surface; the B1 commercial-rewards decision persistence table does NOT introduce a second B1 commercial-rewards decision persistence surface.
- The B1 commercial-rewards explanation trace and rule trace are recorded for every B1 commercial-rewards decision. The B1 commercial-rewards explanation trace and rule trace are NOT recorded for the B1 commercial-rewards decision failure record.
- The B1 commercial-rewards engine produces commercial-rewards decisions that later execution layers must consume. A future execution layer (out of B1T07 scope) MUST consume the B1 commercial-rewards decision through the B1 commercial-rewards consumer ports and MUST NOT bypass the B1 commercial-rewards engine.

## 4. Alternatives considered

### 4.1 B1 commercial-rewards engine as a service-only contract

The B1 commercial-rewards engine could be implemented as a service-only contract (without a database table). The B1 commercial-rewards engine as a service-only contract was rejected because the B1 commercial-rewards decision is a durable artifact and the B1 commercial-rewards decision MUST be queryable from the B1 commercial-rewards read-only consumer boundary surface. The B1 commercial-rewards engine as a service-only contract would require a B1 commercial-rewards decision in-memory cache, which is rejected because the B1 commercial-rewards decision is a single source of truth and the B1 commercial-rewards decision MUST be queryable across multiple B1 commercial-rewards engine instances.

### 4.2 B1 commercial-rewards engine as a second A1 canonical identity

The B1 commercial-rewards engine could be implemented as a second A1 canonical identity (e.g., a new `B1_REFERRAL_DECISION` canonical identity). The B1 commercial-rewards engine as a second A1 canonical identity was rejected because the B1 commercial-rewards engine does NOT introduce a new A1 canonical identity; the B1 commercial-rewards engine reuses the A1 canonical identity authority.

### 4.3 B1 commercial-rewards engine as a second B1T04 commercial decision engine

The B1 commercial-rewards engine could be implemented as a second B1T04 commercial decision engine. The B1 commercial-rewards engine as a second B1T04 commercial decision engine was rejected because the B1T04 commercial decision engine is the only B1 commercial decision engine for fee, commission, and revenue sharing; the B1 commercial-rewards engine reuses the B1T04 commercial decision through the existing B1T04 read-only consumer boundary.

### 4.4 B1 commercial-rewards engine as a second B1T05 billing engine

The B1 commercial-rewards engine could be implemented as a second B1T05 billing engine. The B1 commercial-rewards engine as a second B1T05 billing engine was rejected because the B1T05 billing engine is the only B1 commercial-financial-effect engine for billing, invoicing, and statement generation; the B1 commercial-rewards engine reuses the B1T05 billing engine through the existing B1T05 read-only consumer boundary.

### 4.5 B1 commercial-rewards engine as a second B1T06 commercial-incentive engine

The B1 commercial-rewards engine could be implemented as a second B1T06 commercial-incentive engine. The B1 commercial-rewards engine as a second B1T06 commercial-incentive engine was rejected because the B1T06 commercial-incentive engine is the only B1 commercial-incentive engine for campaigns, promotions, and coupons; the B1 commercial-rewards engine reuses the B1T06 commercial-incentive decision through the existing B1T06 read-only consumer boundary.

### 4.6 B1 commercial-rewards engine with execution

The B1 commercial-rewards engine could be implemented with execution (e.g., the B1 referral engine could execute a referral reward, the B1 cashback engine could execute a cashback redemption, the B1 loyalty engine could award a loyalty balance). The B1 commercial-rewards engine with execution was rejected because the B1 commercial-rewards engine is a DECISION ENGINE ONLY. A future execution layer (out of B1T07 scope) MUST consume the B1 commercial-rewards decision through the B1 commercial-rewards consumer ports and MUST execute the B1 commercial-rewards decision through the appropriate A1-A7 and B1T01-B1T06 authorities (Ledger, Wallet, Billing, Campaign, etc.).

## 5. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T07 — B1 Referral, Cashback, and Loyalty Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/B1-BILLING-ENGINE-CONTRACT.md` — B1 billing engine, invoice engine, and statement-generation engine contract.
- `docs/B1-CAMPAIGN-ENGINE-CONTRACT.md` — B1 campaign engine, promotion engine, and coupon engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `docs/ADR/ADR-0064-B1-Billing-Invoice-Statement-Engine.md` — B1 billing engine, invoice engine, and statement-generation engine ADR.
- `docs/ADR/ADR-0065-B1-Campaign-Promotion-Coupon-Engine.md` — B1 campaign engine, promotion engine, and coupon engine ADR.
- `docs/B1-REFERRAL-ENGINE-CONTRACT.md` — B1 referral engine, cashback engine, and loyalty engine contract.
- `src/policy/b1-referral-engine.types.ts` — B1 referral engine types.
- `src/policy/b1-referral-engine.constants.ts` — B1 referral engine constants.
- `src/policy/b1-referral-engine.entity.ts` — B1 referral decision persistence entity.
- `src/policy/b1-referral-engine.repository.ts` — B1 referral engine repository.
- `src/policy/b1-referral-engine.service.ts` — B1 referral engine service.
- `src/policy/b1-referral-engine.module.ts` — B1 referral engine NestJS module.
- `src/migrations/1785753600035-CreateB1ReferralDecisionTables.ts` — B1 referral decision persistence migration.
- `test/b1-referral-engine.types.spec.ts` — B1 referral engine types tests.
- `test/b1-referral-engine.repository.spec.ts` — B1 referral engine repository tests.
- `test/b1-referral-engine.service.spec.ts` — B1 referral engine service tests.
- `test/b1-referral-engine.module.spec.ts` — B1 referral engine module tests.
