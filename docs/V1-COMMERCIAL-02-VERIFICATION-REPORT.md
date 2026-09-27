# V1-COMMERCIAL-02 — Product Catalogue Foundation: Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `1e1dbc03948f8222c67a47624d8437a56c395ac9` (V1-COMMERCIAL-DECISION-01)
**Ending HEAD:** this task's commit (single commit on top of `1e1dbc0`)
**Migration count:** 71 → **72** (`1785753600000`–`1785753600071`); latest = `CreateProductCatalogue1785753600071`
**Verdict:** FOUNDATION IMPLEMENTED AND VERIFIED — the catalogue answers *"What product is this?"* and nothing else. No commercial rates, no flow wiring, no runtime behavior changes.

---

## 1. Files changed (23 modified + 8 created)

**Created**

| Path | Purpose |
|---|---|
| `src/migrations/1785753600071-CreateProductCatalogue.ts` | Additive migration: `products` table |
| `src/product-catalog/product-catalog.enums.ts` | Domain/status/configuration-status/scope vocabulary + code pattern |
| `src/product-catalog/product.entity.ts` | `products` entity (VersionColumn optimistic locking, soft-delete column, CHECK parity with the migration) |
| `src/product-catalog/product-catalog.seed.ts` | The 7 V1 product seed entries + explicit out-of-scope guard list |
| `src/product-catalog/product-catalog.service.ts` | Catalogue service: validated create/update, version-checked audited writes, list/get, safe projection |
| `src/product-catalog/product-catalog-seed.service.ts` | Idempotent bootstrap seeding (CapabilitySeedService convention) |
| `src/product-catalog/product-catalog.controller.ts` | Workforce-only `GET/POST/PATCH /api/v1/internal/products` |
| `src/product-catalog/product-catalog.module.ts` | Module, registered in `AppModule` |
| `test/v1-commercial-02-product-catalogue.integration.spec.ts` | 16-test real-PostgreSQL suite |
| `docs/V1-COMMERCIAL-02-VERIFICATION-REPORT.md` | This report |

**Modified (all scoped):** `src/app.module.ts` (module registration), `src/authorization/route-policy-registry.ts` (route policy entry), `src/capability-registry/capability.seed.ts` (PRODUCT_CATALOGUE entry only), `src/production/production-readiness.service.ts` (expected migration head 0071), and migration-guard assertions in `test/production-readiness.spec.ts`, `test/migration-chain.integration.spec.ts`, `test/v1-capability-registry.integration.spec.ts`, `test/v1-limit-01/02/03`, `test/a8/a17/a18/a19/a20`, `test/v1-001/003/005/006/007`, `test/v1-hardening-06/07/09` (latest-timestamp sets + head-name regexes only).

No limit source files, no flow services, no wallet/ledger code, and no commercial-decision-snapshot code were modified (git diff verified).

## 2. Migration

`1785753600071-CreateProductCatalogue.ts` — additive only; no previous migration rewritten.

```
products(
  code VARCHAR(80) PRIMARY KEY  CHECK (code ~ '^[A-Z0-9_]{3,80}$'),
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500),
  domain VARCHAR(20) CHECK IN (CUSTOMER,AGENT,AGGREGATOR,FINANCE,SUPPORT,PLATFORM),
  currency VARCHAR(3) CHECK '^[A-Z]{3}$',
  product_scope VARCHAR(10) DEFAULT 'V1' CHECK IN (V1,V2),
  status VARCHAR(20) DEFAULT 'ACTIVE' CHECK IN (ACTIVE,DISABLED,DEPRECATED),
  enabled BOOLEAN DEFAULT FALSE,
  configuration_status VARCHAR(20) DEFAULT 'NOT_CONFIGURED' CHECK IN (CONFIGURED,NOT_CONFIGURED,DISABLED),
  created_by, updated_by, version (>0), created_at, updated_at, deleted_at
)
+ idx_products_domain / scope / status / enabled
```

Notes on deliberate choices:
- **No effective dates** — `limit_rules` carries them because rule validity windows matter; the catalogue has no current architectural consumer for effective dates (avoids unjustified fields).
- **No rate/price/limit columns at all** — commercial configuration separation is enforced structurally (test 01 asserts none exist).
- **Soft-delete column present** per repository convention (limit_profiles/limit_rules), but no API erases rows — deprecation is a status transition.
- The code CHECK pattern is a strict subset of the existing `limit_rules.product` pattern, so every catalogue code is already valid wherever product codes are consumed.

## 3. Catalogue model

Answers **"What product is this?"** — identity (`code`, `name`, `description`), classification (`domain`), applicability (`currency`, `product_scope`), lifecycle (`status`, `enabled`, `configuration_status`), governance (`version`, audit columns, soft-delete). It does **not** answer *"How much does this product cost?"* — fee/commission/reward rates and limit thresholds belong to separate rule systems that do not yet exist; nothing here accepts or stores them.

## 4. Canonical product-code decision

**Decision: `products.code` IS the single authoritative product identity, carrying exactly the identifiers the runtime already uses.** Inspection results:

| Source inspected | What it contains | Relationship to `products.code` |
|---|---|---|
| Runtime flow services (`TransferService`, `AgentCashIn/OutService`, `AgentCashToCashService`, `CustomerFundingService`, `AgentFundingService`) | limit-enforcement `product` values: the 7 codes | **Identical** — the catalogue seeds exactly these |
| `limit_rules.product` / `limit_usages.product` | VARCHAR(80) product codes | Consumes the same codes; CHECK-compatible |
| `commercial_decision_snapshots.product` (V1-COMMERCIAL-DECISION-01) | VARCHAR(80) product codes | Consumes the same codes; test 16 proves agreement |
| `QuotePaymentType` (`src/quote/quote.enums.ts`) | TRANSFER / DEPOSIT / WITHDRAWAL | **Different concept** (quote payment types) — left untouched, documented; the audit doc's assumption that it held product codes was stale |
| `AgentService` (`src/agent/agent-service.enum.ts`) | CASH_IN / CASH_OUT / CASH_TO_CASH / AGENT_FUNDING / AGENT_DEFUNDING with aliases | Agent service vocabulary — left untouched; aliases (CASH_IN ≙ CASH_TO_WALLET) already documented in that file |
| Capability Registry codes | WALLET_TO_WALLET, WALLET_TO_BANK, … | Registry capability identities — left untouched |

No competing code system was created; nothing was renamed or duplicated.

## 5. Seeded V1 products (exactly 7)

| Code | Domain | Currency | Scope | Status | Enabled | Configuration |
|---|---|---|---|---|---|---|
| WALLET_TRANSFER | CUSTOMER | NGN | V1 | ACTIVE | true | NOT_CONFIGURED |
| WALLET_TO_CASH | AGENT | NGN | V1 | ACTIVE | true | NOT_CONFIGURED |
| CASH_TO_WALLET | AGENT | NGN | V1 | ACTIVE | true | NOT_CONFIGURED |
| CASH_TO_CASH | AGENT | NGN | V1 | ACTIVE | true | NOT_CONFIGURED |
| CUSTOMER_FUNDING | FINANCE | NGN | V1 | ACTIVE | true | NOT_CONFIGURED |
| AGENT_FUNDING | FINANCE | NGN | V1 | ACTIVE | true | NOT_CONFIGURED |
| AGENT_DEFUNDING | FINANCE | NGN | V1 | ACTIVE | true | NOT_CONFIGURED |

`enabled: true` reflects that these flows genuinely exist and run; `configurationStatus: NOT_CONFIGURED` reflects that no commercial pricing exists for any of them — both honest, per registry semantics.

**Explicitly NOT seeded (guarded by tests):** Wallet→Bank, Bank→Wallet, NIBSS, Wema, Providus, NinePSB, cards, dollar cards, airtime, data, electricity, cable, betting, any non-NGN product, any V2-scoped row. AGGREGATOR_FUNDING is not a runtime product code (aggregator funding executes under AGENT_FUNDING/AGENT_DEFUNDING product codes with aggregator-specific audit actions) and was therefore not seeded.

## 6. API routes & authorization

| Route | Method | Roles | Behavior |
|---|---|---|---|
| `/api/v1/internal/products` | GET | OPERATOR/SERVICE/PRIVILEGED | List; filters domain/status/enabled/configurationStatus/productScope; deterministic `code ASC` pagination (≤100/page); input validation 400s |
| `/api/v1/internal/products/:code` | GET | same | Single safe projection; 404 unknown |
| `/api/v1/internal/products` | POST | same | Register future products; code pattern + enum + currency validation; duplicate → 409; default `enabled: false` |
| `/api/v1/internal/products/:code` | PATCH | same | `version` required (optimistic concurrency → 409 on stale/conflict); audited; no code mutation |
| — | DELETE | — | **Does not exist (404)** — deprecation via status |

Authorization: RoutePolicyRegistry maps `/api/v1/internal/products` → WORKFORCE_SESSION with OPERATOR/SERVICE/PRIVILEGED; controller re-checks as defense-in-depth. Unauthenticated → 401; CUSTOMER/AGENT/AGGREGATOR/SUPPORT → 403 (all tested). No customer/agent-facing product configuration endpoints exist.

**Auditability:** CREATED/UPDATED events recorded to `audit_events` (entityType `PRODUCT`, deterministic UUID entity id derived from the code, previous/new values).

**Safe projection:** responses contain catalogue facts only (code, name, description, domain, currency, productScope, status, enabled, configurationStatus, createdBy, updatedBy, version, timestamps) — no secrets surface exists in the schema.

## 7. Versioning / historical safety

- `@VersionColumn` optimistic locking: concurrent PATCH with the same version → exactly one winner, loser gets 409 (verified with real concurrency).
- Catalogue changes can never make an old commercial decision ambiguous: snapshots store product identity as immutable strings; test 15 renames, disables and deprecates WALLET_TRANSFER after recording a snapshot and proves the snapshot stays byte-identical and still immutable (UPDATE/DELETE trigger unchanged — no UPDATE/DELETE behavior was added to snapshots; the snapshot schema was not modified).

## 8. Capability Registry changes

- `PRODUCT_CATALOGUE`: DESIGNED → **BACKEND_IMPLEMENTED** (lifecycle + backend), apiStatus NOT_EXPOSED → **API_READY**, configurationStatus NOT_CONFIGURED → **CONFIGURED** (seeded), `enabled` stays **false** (no commercial rule system references the catalogue yet; runtime enablement is a separate decision), implementation/migration/test/doc references populated, version 2, blocker description documents the canonical-code decision and remaining wiring work.
- **Untouched:** FEE_ENGINE, COMMISSION_ENGINE, REWARD_ENGINE, COMMERCIAL_DECISION_SNAPSHOT and every other entry — nothing marked implemented merely because the catalogue exists.

## 9. Tests and exact results (real PostgreSQL 18.4)

**New suite `test/v1-commercial-02-product-catalogue.integration.spec.ts` — 16/16 passed**, covering: migration schema + DB-layer code/domain/currency validation (01); exact 7-product seed with honest defaults (02); idempotent non-destructive reseeding (03); uniqueness + V2/out-of-scope absence + NGN-only (04); validated create + audit + financial non-mutation (05); create validation matrix (06); version-checked audited updates (07); concurrent single-writer (08); status/deprecation/filter behavior, zero CONFIGURED commercial rows (09); authn/authz (10); workforce access + safe projection (11); filters/ordering/pagination validation (12); no DELETE route (13); zero wallet/ledger/limit/snapshot mutation from catalogue operations (14); snapshot immutability + historical safety under catalogue changes (15); canonical identity agreement with runtime codes and snapshots (16).

| Suite | Result |
|---|---|
| v1-commercial-02 (new) | **16/16 pass** |
| **Full integration run** | **52/52 suites, 1199/1199 tests pass** (was 51/1183 at `1e1dbc0`) |
| Migration chain (clean DB, all migrations) | pass — 72 migrations, zero pending, entity↔schema consistent |
| Unit suite | 1764/1766 — the 2 failures are the pre-existing `external-reconciliation.service.spec.ts` failures present before this task |
| `tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| ESLint — all files created/modified by this task | **0 errors, 0 warnings** |
| ESLint — repository-wide | still failing with only pre-existing errors in untouched files (honest baseline; this task adds none) |

## 10. Ledger / wallet / limit mutation proof

Test 14 diffs `ledger_accounts`, `ledger_journals`, `ledger_lines`, `wallet_accounts`, `limit_usages`, `limit_reservations`, `commercial_decision_snapshots` row counts before/after create + update operations — byte-identical. The full suite additionally runs all 8-flow limit/financial suites unmodified (1199/1199), proving no behavioral drift.

## 11. Unresolved product/business decisions

1. **UD-CD2 (carried):** fee/commission/reward/VAT/tax rates and pricing tiers — product/accounting decisions; nothing invented.
2. **UD-PC1:** whether any future V1 product beyond the established seven will exist (e.g., bills) — currently none; adding one is a product decision + a simple catalogue registration.
3. **UD-PC2:** per-product commercial enablement dates/gating (`pilot_controls` interplay) when fee-bearing products are eventually approved.
4. **UD-PC3:** admin-UI exposure for the catalogue (adminUiStatus remains NOT_EXPOSED — no UI scope in this task).

## 12. Remaining commercial-engine dependencies (dependency order)

1. **Commercial rule schemas** (fee rules first): tables referencing `products.code` + rule versioning — requires product decisions on rates (UD-CD2) before seeding any values; schema can be designed fee-free.
2. **Commercial resolver foundation:** resolves "which rules apply for product X" without charging anything yet.
3. **Snapshot wiring (V1-COMMERCIAL-DECISION-02):** record decisions inside flow SERIALIZABLE boundaries via `recordDecisionWithManager`.

## 13. Recommended next task (exact)

**V1-COMMERCIAL-03 — COMMERCIAL RULE SCHEMA FOUNDATION (fee rules, versioned, fee-free):** additive migration for a versioned `fee_rules` table keyed to `products.code` (`paymentType`-compatible fields mirroring existing `FeeRule` terminology: flatFeeMinor, percentageBps, minimumFeeMinor, maximumFeeMinor, vatBps, effectiveFrom/effectiveTo, priority, isActive), CHECK-constrained, workforce-only read API, capability registry FEE_SCHEMA state only — with **no rules seeded** (rates remain product decisions) and no runtime wiring. If product decisions on rates land first, the alternative is **V1-COMMERCIAL-DECISION-02** (wire snapshot capture into a pilot flow via `recordDecisionWithManager`); both depend only on what this task delivered.
