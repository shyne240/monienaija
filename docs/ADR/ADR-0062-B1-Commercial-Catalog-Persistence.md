# ADR-0062 — B1 Commercial Catalog Persistence

- **Phase:** B1 — Commercial Platform
- **Task:** B1T03 — B1 Commercial Catalogs, Plans, Tiers, Entitlements, Packages, and Bundles
- **Status:** Accepted (B1T03 implementation)
- **Review snapshot:** `b1t03` (B1T03 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Context

B1T01 established the B1 commercial platform baseline and the first commercial scope. B1T02 established the B1 commercial catalog and commercial-boundary contract (`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`). B1T03 populates the first commercial scope registration with the actual B1 commercial plans, customer tiers, merchant tiers, partner tiers, product entitlements, commercial packages, commercial bundles, feature flags, dynamic limits, and subscription plans, and freezes the B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface for later B1 tasks (B1T04 fee / commission / revenue-sharing engine, B1T05 billing / invoice / statement engine, B1T06 campaign / promotion / coupon engine, B1T07 referral / cashback / loyalty engine, B1T08 revenue-recognition / tax / cost-accounting engine, B1T09 commercial analytics / profitability / commercial reconciliation engine, B1T10 commercial data classification / commercial idempotency / commercial audit / commercial approval / feature flag surface, and B1T11 commercial release gate).

The B1 commercial catalog persistence ADR is required by the B1T03 plan and the B1T02 commercial catalog and commercial-boundary contract. The B1 commercial catalog persistence ADR records the architectural decisions for the B1 commercial catalog persistence, the B1 commercial catalog versioning, the B1 commercial catalog compatibility validation, the B1 commercial catalog replay-safe catalog lookup, the B1 commercial catalog read-only consumer boundary surface, and the B1 commercial catalog audit / idempotency / outbox / metrics integration.

## 2. Decision

### 2.1 B1 commercial catalog persistence

The B1 commercial catalog is persisted in the `b1_commercial_catalog_registrations` table, introduced in `src/migrations/1785753600031-CreateB1CommercialCatalogTables.ts`. The `b1_commercial_catalog_registrations` table is the only B1 commercial catalog persistence surface; the B1 commercial catalog persistence is the only B1 commercial catalog authority for the durable B1 commercial catalog registration. The B1 commercial catalog persistence does NOT introduce a second A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating-entry, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, Wallet, Ledger, Operations, Outbox, Idempotency, Metrics, Diagnostics, Reconciliation, or `CustomerPreference` authority.

The B1 commercial catalog persistence is configuration only. The B1 commercial catalog persistence does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects. The B1 commercial catalog persistence is a read-only contract against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A6 partner-adapter, A6T10 data classification, A7 product catalog, and the shared Operations audit, idempotency, outbox, and metrics services.

### 2.2 B1 commercial catalog versioning

The B1 commercial catalog versioning contract is recorded in `B1CommercialCatalogVersioningContractV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 and re-asserted by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §5.1). The B1 commercial catalog versioning contract records the B1 commercial catalog version, the B1 commercial catalog identity, the B1 commercial catalog effective-from, the B1 commercial catalog effective-to, the B1 commercial catalog superseded-by reference, the B1 commercial catalog supersedes reference, and the B1 commercial catalog migration hint. The B1 commercial catalog versioning contract is read-only; the B1 commercial catalog does NOT publish a new B1 commercial catalog version.

The B1 commercial catalog versioning rules are:

1. The B1 commercial catalog scope version is `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
2. The B1 commercial catalog plan, package, bundle, entitlement, tier, subscription, feature flag, dynamic limit, and pricing versions are all `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3, §3.4, §3.5, §4.1).
3. The B1 commercial catalog version negotiation is exact-match (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §5.1).
4. The B1 commercial catalog does NOT support cross-catalog negotiation (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §5.1).
5. A later B1 commercial catalog version (v2) MAY add optional fields, capability metadata, a second frozen commercial scope, or commercial-extension points; a later B1 commercial catalog version MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §1.4).

### 2.3 B1 commercial catalog compatibility validation

The B1 commercial catalog compatibility validation is recorded in `B1CommercialCatalogCompatibilityResultV1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §5.2 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial catalog compatibility validation verifies that the B1 commercial catalog version is supported, that the B1 commercial scope key is supported, that the B1 commercial scope version is supported, that the B1 commercial capability is supported, that the B1 commercial currency is supported, that the B1 commercial accounting unit is supported, that the B1 commercial product dependency is supported, that the B1 commercial partner dependency is supported, and that the B1 commercial catalog lookup key is not in the B1 prohibited adjacent scopes.

The B1 commercial catalog compatibility rules are:

1. The B1 commercial catalog compatibility check rejects a lookup with an invalid contract name (`B1_COMMERCIAL_CATALOG_INVALID_COMMAND`).
2. The B1 commercial catalog compatibility check rejects a lookup with an invalid contract version (`B1_COMMERCIAL_CATALOG_INVALID_COMMAND`).
3. The B1 commercial catalog compatibility check rejects a lookup with an invalid scope key (`B1_COMMERCIAL_CATALOG_INCOMPATIBLE`).
4. The B1 commercial catalog compatibility check rejects a lookup with an invalid scope version (`B1_COMMERCIAL_CATALOG_INCOMPATIBLE`).
5. The B1 commercial catalog compatibility check rejects a lookup with an invalid currency (`B1_COMMERCIAL_CATALOG_INCOMPATIBLE`).
6. The B1 commercial catalog compatibility check rejects a lookup with an invalid accounting unit (`B1_COMMERCIAL_CATALOG_INCOMPATIBLE`).
7. The B1 commercial catalog compatibility check rejects a lookup with an unsupported capability (`B1_COMMERCIAL_CATALOG_UNSUPPORTED_CAPABILITY`).
8. The B1 commercial catalog compatibility check rejects a lookup with a prohibited adjacent scope (`B1_COMMERCIAL_CATALOG_PROHIBITED`).

### 2.4 B1 commercial catalog replay-safe catalog lookup

The B1 commercial catalog replay-safe catalog lookup is recorded in `B1CommercialCatalogReplaySafeResultV1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §6 and re-asserted by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial catalog replay-safe catalog lookup uses the B1 commercial catalog internal idempotency scope (`b1.commercial-catalog.idempotency.v1`), the B1 commercial catalog internal idempotency retention (86_400 seconds = 24 hours), the B1 commercial catalog idempotency key, and the B1 commercial catalog request hash (SHA-256 over the canonical request payload).

The B1 commercial catalog replay rules are:

1. The B1 commercial catalog replay window is 86_400 seconds (24 hours).
2. The B1 commercial catalog replay rule is exact-match required (the request hash MUST match).
3. The B1 commercial catalog replay rule is idempotent (a duplicate lookup returns the durable original lookup outcome).
4. The B1 commercial catalog replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 commercial catalog replay rule expires after the replay window (an expired lookup MUST NOT be replayed).
6. The B1 commercial catalog replay rule inherits the A1-A7 replay rules (the A1-A7 replay rules are applied before the B1 commercial catalog replay rule).

### 2.5 B1 commercial catalog read-only consumer boundary surface

The B1 commercial catalog read-only consumer boundary surface is recorded in `B1CommercialCatalogConsumerPortsV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 and re-asserted by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §10). The B1 commercial catalog read-only consumer boundary surface exposes the B1 commercial catalog lookup, the B1 commercial catalog replay-safe lookup, and the B1 commercial catalog compatibility check as the canonical read-only consumer boundary surface for later B1 tasks (B1T04, B1T05, B1T06, B1T07, B1T08, B1T09, B1T10, B1T11).

The B1 commercial catalog read-only consumer boundary rules are:

1. The B1 commercial catalog lookup is read-only; the B1 commercial catalog lookup does NOT mutate any A1-A7 source record.
2. The B1 commercial catalog replay-safe lookup is read-only; the B1 commercial catalog replay-safe lookup does NOT mutate any A1-A7 source record.
3. The B1 commercial catalog compatibility check is read-only; the B1 commercial catalog compatibility check does NOT mutate any A1-A7 source record.
4. The B1 commercial catalog read-only consumer boundary surface is the only B1 commercial catalog surface exposed to later B1 tasks; later B1 tasks MUST NOT call the B1 commercial catalog persistence schema directly.

### 2.6 B1 commercial catalog audit / idempotency / outbox / metrics integration

The B1 commercial catalog emits B1 commercial catalog audit facts through the shared Operations `AuditService` (the only audit authority), reserves B1 commercial catalog idempotency records through the shared Operations `IdempotencyService` (the only internal idempotency authority), enqueues B1 commercial catalog outbox events through the shared Operations `OutboxService` (the only outbox authority), and records B1 commercial catalog metrics through the shared Operations `MetricsService` (the only metrics authority). The B1 commercial catalog audit actor is `b1-commercial-catalog`. The B1 commercial catalog audit entity type is `B1_COMMERCIAL_CATALOG`. The B1 commercial catalog outbox event type is `B1CommercialCatalogRegistered`. The B1 commercial catalog outbox event classification is `INTERNAL_OPERATIONS`. The B1 commercial catalog outbox event retention class is `OPERATIONS_DEFAULT`.

The B1 commercial catalog metric names are:

- `b1.commercial-catalog.lookup` — the B1 commercial catalog lookup metric.
- `b1.commercial-catalog.replayed` — the B1 commercial catalog replayed metric.
- `b1.commercial-catalog.conflict` — the B1 commercial catalog conflict metric.
- `b1.commercial-catalog.incompatible` — the B1 commercial catalog incompatible metric.
- `b1.commercial-catalog.query-unavailable` — the B1 commercial catalog query-unavailable metric.

## 3. Consequences

### 3.1 Positive consequences

- The B1 commercial catalog persistence is the only B1 commercial catalog authority for the durable B1 commercial catalog registration. The B1 commercial catalog persistence is the only B1 commercial catalog persistence surface; the B1 commercial catalog persistence does NOT introduce a second B1 commercial catalog authority.
- The B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface are the canonical B1 commercial catalog surfaces. The B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface do NOT introduce a second B1 commercial catalog authority.
- The B1 commercial catalog audit / idempotency / outbox / metrics integration is the only B1 commercial catalog audit / idempotency / outbox / metrics integration. The B1 commercial catalog audit / idempotency / outbox / metrics integration does NOT introduce a second audit / idempotency / outbox / metrics authority.
- The B1 commercial catalog is configuration only. The B1 commercial catalog does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects.
- The B1 commercial catalog is read-only against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A6 partner-adapter, A6T10 data classification, A7 product catalog, and the shared Operations audit, idempotency, outbox, and metrics services.

### 3.2 Negative consequences

- The B1 commercial catalog persistence migration (`1785753600031-CreateB1CommercialCatalogTables`) is a new database migration. The B1 commercial catalog persistence migration MUST be applied before any B1 commercial catalog persistence record is created.
- The B1 commercial catalog persistence adds a new database table (`b1_commercial_catalog_registrations`). The B1 commercial catalog persistence table is the only B1 commercial catalog persistence surface; the B1 commercial catalog persistence table does NOT introduce a second B1 commercial catalog persistence surface.

## 4. Alternatives considered

### 4.1 B1 commercial catalog persistence as a service-only contract

The B1 commercial catalog persistence could be implemented as a service-only contract (without a database table). The B1 commercial catalog persistence as a service-only contract was rejected because the B1 commercial catalog persistence is a configuration record and the B1 commercial catalog persistence MUST be queryable from the B1 commercial catalog read-only consumer boundary surface. The B1 commercial catalog persistence as a service-only contract would require a B1 commercial catalog in-memory cache, which is rejected because the B1 commercial catalog is a single source of truth and the B1 commercial catalog MUST be queryable across multiple B1 commercial catalog instances.

### 4.2 B1 commercial catalog persistence as a second A1 canonical identity

The B1 commercial catalog persistence could be implemented as a second A1 canonical identity (e.g., a new `B1_COMMERCIAL_CATALOG` canonical identity). The B1 commercial catalog persistence as a second A1 canonical identity was rejected because the B1 commercial catalog persistence does NOT introduce a new A1 canonical identity; the B1 commercial catalog persistence reuses the A1 canonical identity authority.

### 4.3 B1 commercial catalog as a second A7 product catalog

The B1 commercial catalog could be implemented as a second A7 product catalog. The B1 commercial catalog as a second A7 product catalog was rejected because the A7 product catalog is the only A7 product catalog authority; the B1 commercial catalog reuses the A7 product catalog through the existing A7 read-only consumer boundary.

## 5. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 — B1 Pricing Catalog, Plan Catalog, Subscription Plan, Customer Tier, Merchant Tier, Partner Tier, Product Entitlement, Product Packaging, and Bundle Catalog.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `src/policy/b1-commercial-catalog.types.ts` — B1 commercial catalog types.
- `src/policy/b1-commercial-catalog.constants.ts` — B1 commercial catalog frozen constants.
- `src/policy/b1-commercial-catalog.entity.ts` — B1 commercial catalog persistence entity.
- `src/policy/b1-commercial-catalog.repository.ts` — B1 commercial catalog read-write consumer repository.
- `src/policy/b1-commercial-catalog.service.ts` — B1 commercial catalog service.
- `src/policy/b1-commercial-catalog.module.ts` — B1 commercial catalog NestJS module.
- `src/migrations/1785753600031-CreateB1CommercialCatalogTables.ts` — B1 commercial catalog persistence migration.
- `test/b1-commercial-catalog.types.spec.ts` — B1 commercial catalog types tests.
- `test/b1-commercial-catalog.constants.spec.ts` — B1 commercial catalog constants tests.
- `test/b1-commercial-catalog.repository.spec.ts` — B1 commercial catalog repository tests.
- `test/b1-commercial-catalog.service.spec.ts` — B1 commercial catalog service tests.
- `test/b1-commercial-catalog.module.spec.ts` — B1 commercial catalog module tests.
