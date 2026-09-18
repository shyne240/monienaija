# ADR-0063 — B1 Fee Engine, Commission Engine, and Revenue Sharing Decision Engine

- **Phase:** B1 — Commercial Platform
- **Task:** B1T04 — B1 Fee Engine, Commission Engine, and Revenue Sharing Decision Engine
- **Status:** Accepted (B1T04 implementation)
- **Review snapshot:** `b1t04` (B1T04 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Context

B1T01 established the B1 commercial platform baseline and the first commercial scope. B1T02 established the B1 commercial catalog and commercial-boundary contract (`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`). B1T03 populated the first commercial scope registration with the actual B1 commercial plans, customer tiers, merchant tiers, partner tiers, product entitlements, commercial packages, commercial bundles, feature flags, dynamic limits, and subscription plans, and froze the B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface for later B1 tasks. B1T04 implements the B1 fee engine, commission engine, and revenue sharing decision engine for the B1 first commercial scope.

The B1 fee engine, commission engine, and revenue sharing decision engine ADR is required by the B1T04 plan and the B1T02 commercial catalog and commercial-boundary contract. The B1 fee engine, commission engine, and revenue sharing decision engine ADR records the architectural decisions for the B1 commercial decision engine, the B1 commercial decision consumer ports, the B1 commercial decision persistence, the B1 commercial decision versioning, the B1 commercial decision compatibility validation, the B1 commercial decision replay-safe decision engine, the B1 commercial decision audit / idempotency / outbox / metrics integration, and the B1 commercial decision explanation trace / rule trace.

## 2. Decision

### 2.1 B1 commercial decision engine

The B1 commercial decision engine is the B1 fee engine, commission engine, and revenue sharing decision engine. The B1 commercial decision engine is the only B1 commercial decision engine for fee, commission, and revenue sharing. The B1 commercial decision engine is a deterministic calculator that computes the B1 commercial decision for a single commercial flow. The B1 commercial decision engine is a read-only service; the B1 commercial decision engine never posts a journal, mutates a balance, repairs a binding, changes A4 policy / source records, or dispatches a notification.

The B1 commercial decision engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 commercial decision engine never overrides A4. The B1 commercial decision engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 commercial decision engine never posts to Ledger. The B1 commercial decision engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 commercial decision engine never substitutes the A6 partner boundary. The B1 commercial decision engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 commercial decision engine never substitutes the A7 product boundary.

The B1 commercial decision engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 commercial decision engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

### 2.2 B1 commercial decision consumer ports

The B1 commercial decision consumer ports are the canonical B1 commercial decision read-only consumer boundary surface for later B1 tasks (B1T05 billing / invoice / statement engine, B1T06 campaign / promotion / coupon engine, B1T07 referral / cashback / loyalty engine, B1T08 revenue-recognition / tax / cost-accounting engine, B1T09 commercial analytics / profitability / commercial reconciliation engine, B1T10 commercial data classification / commercial disclosure / commercial support-trace surface, B1T11 commercial release gate).

The B1 commercial decision consumer ports expose three functions:

1. `evaluate(request)` — Returns the canonical B1 commercial decision record for the supplied B1 commercial decision request. The evaluate is read-only; the B1 commercial decision evaluate does NOT mutate any A1-A7 source record.
2. `replaySafeEvaluate(request)` — Returns the canonical B1 commercial decision replay-safe result for the supplied B1 commercial decision request. The replay-safe evaluate is read-only; the B1 commercial decision replay-safe evaluate does NOT mutate any A1-A7 source record.
3. `compatibilityCheck(request)` — Returns the canonical B1 commercial decision compatibility result for the supplied B1 commercial decision request. The compatibility check is read-only; the B1 commercial decision compatibility check does NOT mutate any A1-A7 source record.

### 2.3 B1 commercial decision persistence

The B1 commercial decision is persisted in the `b1_commercial_decisions` table, introduced in `src/migrations/1785753600032-CreateB1CommercialDecisionTables.ts`. The `b1_commercial_decisions` table is the only B1 commercial decision persistence surface; the B1 commercial decision persistence is the only B1 commercial decision authority for the durable B1 commercial decision. The B1 commercial decision persistence does NOT introduce a second B1 commercial decision authority.

The B1 commercial decision persistence is configuration only. The B1 commercial decision persistence does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects. The B1 commercial decision persistence is a read-only contract against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A6 partner-adapter, A6T10 data classification, A7 product catalog, and the shared Operations audit, idempotency, outbox, and metrics services.

### 2.4 B1 commercial decision versioning

The B1 commercial decision versioning contract is recorded in `B1CommercialDecisionVersioningContractV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial decision versioning contract records the B1 commercial decision version, the B1 commercial decision identity, the B1 commercial decision effective-from, the B1 commercial decision effective-to, the B1 commercial decision superseded-by reference, the B1 commercial decision supersedes reference, and the B1 commercial decision migration hint. The B1 commercial decision versioning contract is read-only; the B1 commercial decision does NOT publish a new B1 commercial decision version.

The B1 commercial decision versioning rules are:

1. The B1 commercial decision scope version is `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
2. The B1 commercial decision decision version is `1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
3. The B1 commercial decision version negotiation is exact-match (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
4. The B1 commercial decision does NOT support cross-catalog negotiation (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04).
5. A later B1 commercial decision version (v2) MAY add optional fields, decision kinds, or commercial-extension points; a later B1 commercial decision version MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

### 2.5 B1 commercial decision compatibility validation

The B1 commercial decision compatibility validation is recorded in `B1CommercialDecisionCompatibilityResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial decision compatibility validation verifies that the B1 commercial decision version is supported, that the B1 commercial decision scope key is supported, that the B1 commercial decision scope version is supported, that the B1 commercial decision decision kind is supported, that the B1 commercial decision currency is supported, that the B1 commercial decision accounting unit is supported, that the B1 commercial decision product dependency is supported, that the B1 commercial decision partner dependency is supported, and that the B1 commercial decision plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

### 2.6 B1 commercial decision replay-safe decision engine

The B1 commercial decision replay-safe decision engine is recorded in `B1CommercialDecisionReplaySafeResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04). The B1 commercial decision replay-safe decision engine uses the B1 commercial decision internal idempotency scope (`b1.commercial-decision.idempotency.v1`), the B1 commercial decision internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial decision idempotency key (the request idempotency key), and the B1 commercial decision request hash (SHA-256 over the canonical request payload).

The B1 commercial decision replay rules are:

1. The B1 commercial decision replay window is 86_400 seconds (24 hours).
2. The B1 commercial decision replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial decision replay rule is idempotent (a duplicate lookup returns the durable original decision outcome).
4. The B1 commercial decision replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial decision replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial decision replay rule inherits the A1-A7 replay rules (the A1-A7 replay rules are applied before the B1 commercial decision replay rule).
7. The B1 commercial decision replay rule inherits the B1T03 catalog replay rule (the B1T03 catalog replay rule is applied before the B1 commercial decision replay rule).

The B1 commercial decision hash is computed from the canonical B1 commercial decision payload (excluding the random `decisionId` and the `generatedAt` timestamp). The B1 commercial decision replay hash is computed from the B1 commercial decision hash, the B1 commercial decision request hash, the B1 commercial decision idempotency key, and the B1 commercial decision correlation id.

### 2.7 B1 commercial decision audit / idempotency / outbox / metrics integration

The B1 commercial decision emits B1 commercial decision audit facts through the shared Operations `AuditService` (the only audit authority), reserves B1 commercial decision idempotency records through the shared Operations `IdempotencyService` (the only internal idempotency authority), enqueues B1 commercial decision outbox events through the shared Operations `OutboxService` (the only outbox authority), and records B1 commercial decision metrics through the shared Operations `MetricsService` (the only metrics authority). The B1 commercial decision audit actor is `b1-fee-engine`. The B1 commercial decision audit entity type is `B1_COMMERCIAL_DECISION`. The B1 commercial decision outbox event type is `B1CommercialDecisionDecided`. The B1 commercial decision outbox event classification is `INTERNAL_OPERATIONS`. The B1 commercial decision outbox event retention class is `OPERATIONS_DEFAULT`.

The B1 commercial decision metric names are:

- `b1.commercial-decision.evaluate` — the B1 commercial decision evaluate metric.
- `b1.commercial-decision.replayed` — the B1 commercial decision replayed metric.
- `b1.commercial-decision.conflict` — the B1 commercial decision conflict metric.
- `b1.commercial-decision.incompatible` — the B1 commercial decision incompatible metric.
- `b1.commercial-decision.feature-flag-disabled` — the B1 commercial decision feature flag disabled metric.
- `b1.commercial-decision.dynamic-limit-exceeded` — the B1 commercial decision dynamic limit exceeded metric.
- `b1.commercial-decision.query-unavailable` — the B1 commercial decision query unavailable metric.
- `b1.commercial-decision.a4-policy-denied` — the B1 commercial decision A4 policy denied metric.
- `b1.commercial-decision.a3-binding-invalid` — the B1 commercial decision A3 binding invalid metric.
- `b1.commercial-decision.a5-ledger-invariant-broken` — the B1 commercial decision A5 ledger invariant broken metric.
- `b1.commercial-decision.a6-partner-incompatible` — the B1 commercial decision A6 partner incompatible metric.
- `b1.commercial-decision.a7-product-incompatible` — the B1 commercial decision A7 product incompatible metric.
- `b1.commercial-decision.b1-catalog-incompatible` — the B1 commercial decision B1 catalog incompatible metric.
- `b1.commercial-decision.b1-catalog-missing` — the B1 commercial decision B1 catalog missing metric.
- `b1.commercial-decision.in-progress` — the B1 commercial decision in progress metric.
- `b1.commercial-decision.replay-expired` — the B1 commercial decision replay expired metric.
- `b1.commercial-decision.replay-conflict` — the B1 commercial decision replay conflict metric.
- `b1.commercial-decision.break-glass-denied` — the B1 commercial decision break glass denied metric.

## 3. Consequences

### 3.1 Positive consequences

- The B1 commercial decision engine is the only B1 commercial decision engine for fee, commission, and revenue sharing. The B1 commercial decision engine is the only B1 commercial decision authority; the B1 commercial decision engine does NOT introduce a second B1 commercial decision authority.
- The B1 commercial decision consumer ports are the canonical B1 commercial decision consumer ports. The B1 commercial decision consumer ports do NOT introduce a second B1 commercial decision consumer port.
- The B1 commercial decision persistence is the only B1 commercial decision persistence surface. The B1 commercial decision persistence does NOT introduce a second B1 commercial decision persistence surface.
- The B1 commercial decision versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration are the canonical B1 commercial decision surfaces. The B1 commercial decision versioning, compatibility validation, replay-safe decision engine, and audit / idempotency / outbox / metrics integration do NOT introduce a second B1 commercial decision authority.
- The B1 commercial decision is deterministic. Identical inputs ALWAYS produce identical B1 commercial decisions.
- The B1 commercial decision is replay-safe. A duplicate B1 commercial decision request returns the durable original B1 commercial decision outcome.
- The B1 commercial decision is configuration only. The B1 commercial decision does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects.
- The B1 commercial decision is read-only against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A6 partner-adapter, A6T10 data classification, A7 product catalog, and the shared Operations audit, idempotency, outbox, and metrics services.

### 3.2 Negative consequences

- The B1 commercial decision persistence migration (`1785753600032-CreateB1CommercialDecisionTables`) is a new database migration. The B1 commercial decision persistence migration MUST be applied before any B1 commercial decision persistence record is created.
- The B1 commercial decision persistence adds a new database table (`b1_commercial_decisions`). The B1 commercial decision persistence table is the only B1 commercial decision persistence surface; the B1 commercial decision persistence table does NOT introduce a second B1 commercial decision persistence surface.
- The B1 commercial decision explanation trace and rule trace are recorded for every B1 commercial decision. The B1 commercial decision explanation trace and rule trace are NOT recorded for the B1 commercial decision failure record.

## 4. Alternatives considered

### 4.1 B1 commercial decision engine as a service-only contract

The B1 commercial decision engine could be implemented as a service-only contract (without a database table). The B1 commercial decision engine as a service-only contract was rejected because the B1 commercial decision is a durable artifact and the B1 commercial decision MUST be queryable from the B1 commercial decision read-only consumer boundary surface. The B1 commercial decision engine as a service-only contract would require a B1 commercial decision in-memory cache, which is rejected because the B1 commercial decision is a single source of truth and the B1 commercial decision MUST be queryable across multiple B1 commercial decision engine instances.

### 4.2 B1 commercial decision engine as a second A1 canonical identity

The B1 commercial decision engine could be implemented as a second A1 canonical identity (e.g., a new `B1_COMMERCIAL_DECISION` canonical identity). The B1 commercial decision engine as a second A1 canonical identity was rejected because the B1 commercial decision engine does NOT introduce a new A1 canonical identity; the B1 commercial decision engine reuses the A1 canonical identity authority.

### 4.3 B1 commercial decision engine as a second B1T03 commercial catalog

The B1 commercial decision engine could be implemented as a second B1T03 commercial catalog. The B1 commercial decision engine as a second B1T03 commercial catalog was rejected because the B1T03 commercial catalog is the only B1T03 commercial catalog authority; the B1 commercial decision engine reuses the B1T03 commercial catalog through the existing B1T03 read-only consumer boundary.

## 5. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T04 — B1 Fee Engine and Commission Engine (Revenue Sharing).
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `src/policy/b1-fee-engine.types.ts` — B1 fee engine, commission engine, and revenue sharing decision engine types.
- `src/policy/b1-fee-engine.constants.ts` — B1 fee engine, commission engine, and revenue sharing decision engine frozen constants.
- `src/policy/b1-fee-engine.entity.ts` — B1 commercial decision persistence entity.
- `src/policy/b1-fee-engine.repository.ts` — B1 fee engine, commission engine, and revenue sharing decision engine read-write consumer repository.
- `src/policy/b1-fee-engine.service.ts` — B1 fee engine, commission engine, and revenue sharing decision engine service.
- `src/policy/b1-fee-engine.module.ts` — B1 fee engine, commission engine, and revenue sharing decision engine NestJS module.
- `src/migrations/1785753600032-CreateB1CommercialDecisionTables.ts` — B1 commercial decision persistence migration.
- `test/b1-fee-engine.types.spec.ts` — B1 fee engine types tests.
- `test/b1-fee-engine.constants.spec.ts` — B1 fee engine constants tests.
- `test/b1-fee-engine.repository.spec.ts` — B1 fee engine repository tests.
- `test/b1-fee-engine.service.spec.ts` — B1 fee engine service tests.
- `test/b1-fee-engine.module.spec.ts` — B1 fee engine module tests.
