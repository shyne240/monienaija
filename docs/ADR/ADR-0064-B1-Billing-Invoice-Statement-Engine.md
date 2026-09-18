# ADR-0064 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine

- **Phase:** B1 — Commercial Platform
- **Task:** B5T05 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine
- **Status:** Accepted (B1T05 implementation)
- **Review snapshot:** `b1t05` (B1T05 implementation commit; the A1-A7 phase evidence is committed; the A1-A7 phase result is `Prepared, not approved, not certified, not activated, not handed off to A8`; the B1 phase result is `Prepared, not approved, not certified, not activated, not handed off to B2`)

## 1. Context

B1T01 established the B1 commercial platform baseline and the first commercial scope. B1T02 established the B1 commercial catalog and commercial-boundary contract (`docs/B1-COMMERCIAL-CATALOG-CONTRACT.md`). B1T03 populated the first commercial scope registration with the actual B1 commercial plans, customer tiers, merchant tiers, partner tiers, product entitlements, commercial packages, commercial bundles, feature flags, dynamic limits, and subscription plans, and froze the B1 commercial catalog versioning, compatibility validation, replay-safe catalog lookup, and read-only consumer boundary surface for later B1 tasks. B1T04 implemented the B1 fee engine, commission engine, and revenue sharing decision engine and froze the B1 commercial decision consumer ports, the B1 commercial decision versioning, the B1 commercial decision compatibility validation, the B1 commercial decision replay-safe decision engine, and the B1 commercial decision audit / idempotency / outbox / metrics integration.

B1T05 implements the B1 billing engine, invoice engine, and statement-generation engine for the B1 first commercial scope. The B1 billing engine, invoice engine, and statement-generation engine is required by the B1T05 plan deliverable and the B1T02 commercial catalog and commercial-boundary contract. The B1 billing engine, invoice engine, and statement-generation engine ADR records the architectural decisions for the B1 billing document engine, the B1 billing document consumer ports, the B1 billing document persistence, the B1 billing document versioning, the B1 billing document compatibility validation, the B1 billing document replay-safe document generation engine, the B1 billing document audit / idempotency / outbox / metrics integration, and the B1 billing document explanation trace / rule trace.

## 2. Decision

### 2.1 B1 billing document engine

The B1 billing document engine is the B1 billing engine, invoice engine, and statement-generation engine. The B1 billing document engine is the only B1 billing document engine for billing records, invoices, and statements. The B1 billing document engine is a deterministic document generator that produces a durable B1 billing document (billing record, invoice, or statement) for a single commercial flow. The B1 billing document engine is a read-only document generator; the B1 billing document engine never posts a journal, mutates a balance, executes a settlement, executes a payout, creates a financial effect, repairs a binding, changes A4 policy / source records, modifies pricing catalogs, modifies commercial decisions, modifies product state, or dispatches a notification.

The B1 billing document engine is bounded by the A4 policy limits, the A4 policy obligations, the A4 policy currentness, and the A4 policy re-evaluation; the B1 billing document engine never overrides A4. The B1 billing document engine is bounded by the A3 binding recheck, the A5 Ledger account state, the A5 Ledger posting boundary, and the A5 financial-invariants; the B1 billing document engine never posts to Ledger. The B1 billing document engine is bounded by the A6 partner state, the A6 partner capability / version, the A6T08 settlement / suspense / compensating authority, and the A6T09 external reconciliation authority; the B1 billing document engine never substitutes the A6 partner boundary. The B1 billing document engine is bounded by the A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization contracts; the B1 billing document engine never substitutes the A7 product boundary. The B1 billing document engine is bounded by the B1T04 commercial decision; the B1 billing document engine consumes the B1T04 commercial decision read-only and never recalculates fee, commission, or revenue sharing.

The B1 billing document engine is idempotent, replay-safe, and conflict-safe under the shared Operations `IdempotencyService`. The B1 billing document engine never stores raw credentials, PAN / account secrets, PINs, OTPs, callback signatures, private keys, raw risk / compliance notes, or unnecessary customer data in broad records, logs, traces, events, or notification payloads.

### 2.2 B1 billing document consumer ports

The B1 billing document consumer ports are the canonical B1 billing document read-only consumer boundary surface for later B1 tasks (B1T08 revenue-recognition / tax / cost-accounting engine, B1T09 commercial analytics / profitability / commercial reconciliation engine, B1T10 commercial data classification / commercial disclosure / commercial support-trace surface, B1T11 commercial release gate).

The B1 billing document consumer ports expose seven functions:

1. `generateBillingRecord(request)` — Returns the canonical B1 billing record document for the supplied B1 billing record request. The generate billing record is read-only; the B1 billing record generate does NOT mutate any A1-A7 source record.
2. `replaySafeGenerateBillingRecord(request)` — Returns the canonical B1 billing record replay-safe result for the supplied B1 billing record request. The replay-safe generate billing record is read-only; the B1 billing record replay-safe generate does NOT mutate any A1-A7 source record.
3. `generateInvoice(request)` — Returns the canonical B1 invoice document for the supplied B1 invoice request. The generate invoice is read-only; the B1 invoice generate does NOT mutate any A1-A7 source record.
4. `replaySafeGenerateInvoice(request)` — Returns the canonical B1 invoice replay-safe result for the supplied B1 invoice request. The replay-safe generate invoice is read-only; the B1 invoice replay-safe generate does NOT mutate any A1-A7 source record.
5. `generateStatement(request)` — Returns the canonical B1 statement document for the supplied B1 statement request. The generate statement is read-only; the B1 statement generate does NOT mutate any A1-A7 source record.
6. `replaySafeGenerateStatement(request)` — Returns the canonical B1 statement replay-safe result for the supplied B1 statement request. The replay-safe generate statement is read-only; the B1 statement replay-safe generate does NOT mutate any A1-A7 source record.
7. `compatibilityCheck(request)` — Returns the canonical B1 billing document compatibility result for the supplied B1 billing document request. The compatibility check is read-only; the B1 billing document compatibility check does NOT mutate any A1-A7 source record.

### 2.3 B1 billing document persistence

The B1 billing document is persisted in the `b1_billing_documents` table, introduced in `src/migrations/1785753600033-CreateB1BillingDocumentTables.ts`. The `b1_billing_documents` table is the only B1 billing document persistence surface; the B1 billing document persistence is the only B1 billing document authority for the durable B1 billing document. The B1 billing document persistence does NOT introduce a second B1 billing document authority.

The B1 billing document persistence is configuration only. The B1 billing document persistence does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects. The B1 billing document persistence is a read-only contract against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.

### 2.4 B1 billing document versioning

The B1 billing document versioning contract is recorded in `B1BillingDocumentVersioningContractV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05). The B1 billing document versioning contract records the B1 billing document version, the B1 billing document identity, the B1 billing document effective-from, the B1 billing document effective-to, the B1 billing document superseded-by reference, the B1 billing document supersedes reference, and the B1 billing document migration hint. The B1 billing document versioning contract is read-only; the B1 billing document does NOT publish a new B1 billing document version.

The B1 billing document versioning rules are:

1. The B1 billing document scope version is `1` (frozen by `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
2. The B1 billing document document version is `1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
3. The B1 billing document version negotiation is exact-match (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
4. The B1 billing document does NOT support cross-scope negotiation (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05).
5. A later B1 billing document version (v2) MAY add optional fields, document kinds, or extension points; a later B1 billing document version MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

### 2.5 B1 billing document compatibility validation

The B1 billing document compatibility validation is recorded in `B1BillingDocumentCompatibilityResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05). The B1 billing document compatibility validation verifies that the B1 billing document version is supported, that the B1 billing document scope key is supported, that the B1 billing document scope version is supported, that the B1 billing document kind is supported, that the B1 billing document currency is supported, that the B1 billing document accounting unit is supported, that the B1 billing document product dependency is supported, that the B1 billing document partner dependency is supported, and that the B1 billing document plan / subscription / package / bundle / product entitlement are not in the B1 prohibited adjacent scopes.

### 2.6 B1 billing document replay-safe document generation engine

The B1 billing document replay-safe document generation engine is recorded in `B1BillingRecordReplaySafeResultV1`, `B1InvoiceReplaySafeResultV1`, and `B1StatementReplaySafeResultV1` (frozen by `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05). The B1 billing document replay-safe document generation engine uses the B1 billing document internal idempotency scope (`b1.billing-engine.idempotency.v1`), the B1 billing document invoice idempotency scope (`b1.billing-engine.invoice.idempotency.v1`), the B1 billing document statement idempotency scope (`b1.billing-engine.statement.idempotency.v1`), the B1 billing document idempotency retention (86_400 seconds = 24 hours), the B1 billing document idempotency key, and the B1 billing document request hash (SHA-256 over the canonical request payload).

The B1 billing document replay rules are:

1. The B1 billing document replay window is 86_400 seconds (24 hours).
2. The B1 billing document replay rule is exact-match required (the request hash MUST match).
3. The B1 billing document replay rule is idempotent (a duplicate generate returns the durable original document).
4. The B1 billing document replay rule is audit-traced (the replay is recorded in the shared Operations `AuditService`).
5. The B1 billing document replay rule expires after the replay window (an expired generate MUST NOT be replayed).
6. The B1 billing document replay rule inherits the A1-A7 replay rules (the A1-A7 replay rules are applied before the B1 billing document replay rule).
7. The B1 billing document replay rule inherits the B1T03 catalog replay rule (the B1T03 catalog replay rule is applied before the B1 billing document replay rule).
8. The B1 billing document replay rule inherits the B1T04 commercial decision replay rule (the B1T04 commercial decision replay rule is applied before the B1 billing document replay rule).

The B1 billing document hash is computed from the canonical B1 billing document payload (excluding the random `documentId` and the `generatedAt` timestamp). The B1 billing document replay hash is computed from the B1 billing document hash, the B1 billing document request hash, the B1 billing document idempotency key, and the B1 billing document correlation id.

### 2.7 B1 billing document audit / idempotency / outbox / metrics integration

The B1 billing document emits B1 billing document audit facts through the shared Operations `AuditService` (the only audit authority), reserves B1 billing document idempotency records through the shared Operations `IdempotencyService` (the only internal idempotency authority), enqueues B1 billing document outbox events through the shared Operations `OutboxService` (the only outbox authority), and records B1 billing document metrics through the shared Operations `MetricsService` (the only metrics authority). The B1 billing document audit actor is `b1-billing-engine`. The B1 billing document audit entity type is `B1_BILLING_DOCUMENT`. The B1 billing document outbox event type is `B1BillingDocumentGenerated`. The B1 billing document outbox event classification is `INTERNAL_OPERATIONS`. The B1 billing document outbox event retention class is `OPERATIONS_DEFAULT`.

The B1 billing document metric names are:

- `b1.billing-engine.billing-record` — the B1 billing record generate metric.
- `b1.billing-engine.invoice` — the B1 invoice generate metric.
- `b1.billing-engine.statement` — the B1 statement generate metric.
- `b1.billing-engine.replayed` — the B1 billing document replayed metric.
- `b1.billing-engine.conflict` — the B1 billing document conflict metric.
- `b1.billing-engine.incompatible` — the B1 billing document incompatible metric.
- `b1.billing-engine.query-unavailable` — the B1 billing document query unavailable metric.
- `b1.billing-engine.in-progress` — the B1 billing document in progress metric.
- `b1.billing-engine.replay-expired` — the B1 billing document replay expired metric.
- `b1.billing-engine.replay-conflict` — the B1 billing document replay conflict metric.
- `b1.billing-engine.invalid-command` — the B1 billing document invalid command metric.
- `b1.billing-engine.prohibited` — the B1 billing document prohibited metric.
- `b1.billing-engine.number-deterministic-mismatch` — the B1 billing document number deterministic mismatch metric.
- `b1.billing-engine.version-mismatch` — the B1 billing document version mismatch metric.
- `b1.billing-engine.scope-mismatch` — the B1 billing document scope mismatch metric.
- `b1.billing-engine.currency-mismatch` — the B1 billing document currency mismatch metric.
- `b1.billing-engine.accounting-unit-mismatch` — the B1 billing document accounting unit mismatch metric.
- `b1.billing-engine.product-mismatch` — the B1 billing document product mismatch metric.
- `b1.billing-engine.partner-mismatch` — the B1 billing document partner mismatch metric.
- `b1.billing-engine.audit-recorded` — the B1 billing document audit recorded metric.
- `b1.billing-engine.outbox-emitted` — the B1 billing document outbox emitted metric.

## 3. Consequences

### 3.1 Positive consequences

- The B1 billing document engine is the only B1 billing document engine for billing records, invoices, and statements. The B1 billing document engine is the only B1 billing document authority; the B1 billing document engine does NOT introduce a second B1 billing document authority.
- The B1 billing document consumer ports are the canonical B1 billing document consumer ports. The B1 billing document consumer ports do NOT introduce a second B1 billing document consumer port.
- The B1 billing document persistence is the only B1 billing document persistence surface. The B1 billing document persistence does NOT introduce a second B1 billing document persistence surface.
- The B1 billing document versioning, compatibility validation, replay-safe document generation engine, and audit / idempotency / outbox / metrics integration are the canonical B1 billing document surfaces. The B1 billing document versioning, compatibility validation, replay-safe document generation engine, and audit / idempotency / outbox / metrics integration do NOT introduce a second B1 billing document authority.
- The B1 billing document is deterministic. Identical inputs ALWAYS produce identical B1 billing documents.
- The B1 billing document is replay-safe. A duplicate B1 billing document request returns the durable original B1 billing document.
- The B1 billing document is configuration only. The B1 billing document does NOT calculate prices, fees, commissions, revenue sharing, invoices, statements, billing, promotions, cashback, loyalty, tax, cost-accounting, profitability, or financial effects.
- The B1 billing document is read-only against the existing A1 canonical identity, A2 authorization, A3 binding, A4 product-policy, A5 Ledger, A6 partner-adapter, A6T05 external-operation, A6T08 settlement / suspense / compensating, A6T09 external reconciliation, A6T10 data classification, A7 product catalog, A7 product-policy profile, A7T04 product customer-binding, A7T05 product command, A7T06 product notification, A7T07 product lifecycle, A7T08 product financial effect, A7T09 product reconciliation, A7T10 product data minimization, B1T03 commercial catalog, B1T04 commercial decision, `CustomerPreference`, and the shared Operations audit, idempotency, outbox, and metrics services.

### 3.2 Negative consequences

- The B1 billing document persistence migration (`1785753600033-CreateB1BillingDocumentTables`) is a new database migration. The B1 billing document persistence migration MUST be applied before any B1 billing document persistence record is created.
- The B1 billing document persistence adds a new database table (`b1_billing_documents`). The B1 billing document persistence table is the only B1 billing document persistence surface; the B1 billing document persistence table does NOT introduce a second B1 billing document persistence surface.
- The B1 billing document explanation trace and rule trace are recorded for every B1 billing document. The B1 billing document explanation trace and rule trace are NOT recorded for the B1 billing document failure record.

## 4. Alternatives considered

### 4.1 B1 billing document engine as a service-only contract

The B1 billing document engine could be implemented as a service-only contract (without a database table). The B1 billing document engine as a service-only contract was rejected because the B1 billing document is a durable artifact and the B1 billing document MUST be queryable from the B1 billing document read-only consumer boundary surface. The B1 billing document engine as a service-only contract would require a B1 billing document in-memory cache, which is rejected because the B1 billing document is a single source of truth and the B1 billing document MUST be queryable across multiple B1 billing document engine instances.

### 4.2 B1 billing document engine as a second A1 canonical identity

The B1 billing document engine could be implemented as a second A1 canonical identity (e.g., a new `B1_BILLING_DOCUMENT` canonical identity). The B1 billing document engine as a second A1 canonical identity was rejected because the B1 billing document engine does NOT introduce a new A1 canonical identity; the B1 billing document engine reuses the A1 canonical identity authority.

### 4.3 B1 billing document engine as a second B1T04 commercial decision engine

The B1 billing document engine could be implemented as a second B1T04 commercial decision engine. The B1 billing document engine as a second B1T04 commercial decision engine was rejected because the B1T04 commercial decision engine is the only B1 commercial decision engine for fee, commission, and revenue sharing; the B1 billing document engine reuses the B1T04 commercial decision through the existing B1T04 read-only consumer boundary.

## 5. References

- `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T05 — B1 Billing Engine, Invoice Engine, and Statement-Generation Engine.
- `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` — B1 commercial platform baseline and first-commercial-scope selection.
- `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` — B1 commercial catalog and commercial-boundary contract.
- `docs/B1-FEE-ENGINE-CONTRACT.md` — B1 fee engine, commission engine, and revenue sharing decision engine contract.
- `docs/ADR/ADR-0061-Commercial-Plan-Boundary.md` — B1 commercial plan boundary ADR.
- `docs/ADR/ADR-0062-B1-Commercial-Catalog-Persistence.md` — B1 commercial catalog persistence ADR.
- `docs/ADR/ADR-0063-B1-Fee-Engine-Commission-Engine-Revenue-Sharing-Engine.md` — B1 fee engine, commission engine, and revenue sharing decision engine ADR.
- `src/policy/b1-billing-engine.types.ts` — B1 billing engine, invoice engine, and statement-generation engine types.
- `src/policy/b1-billing-engine.constants.ts` — B1 billing engine, invoice engine, and statement-generation engine frozen constants.
- `src/policy/b1-billing-engine.entity.ts` — B1 billing document persistence entity.
- `src/policy/b1-billing-engine.repository.ts` — B1 billing engine, invoice engine, and statement-generation engine read-write consumer repository.
- `src/policy/b1-billing-engine.service.ts` — B1 billing engine, invoice engine, and statement-generation engine service.
- `src/policy/b1-billing-engine.module.ts` — B1 billing engine, invoice engine, and statement-generation engine NestJS module.
- `src/migrations/1785753600033-CreateB1BillingDocumentTables.ts` — B1 billing document persistence migration.
- `test/b1-billing-engine.types.spec.ts` — B1 billing engine types tests.
- `test/b1-billing-engine.repository.spec.ts` — B1 billing engine repository tests.
- `test/b1-billing-engine.service.spec.ts` — B1 billing engine service tests.
- `test/b1-billing-engine.module.spec.ts` — B1 billing engine module tests.
