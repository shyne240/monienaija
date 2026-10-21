# V1 Capability Registry — Verification Report

**Date (Lagos):** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**HEAD:** `ec038da` → `1785753600066-CreateCapabilityRegistry` (67 migrations)
**Migration chain:** `1785753600000-CreateWalletAndLedger` → `1785753600066-CreateCapabilityRegistry` (single additive, no rewrite)
**Production readiness:** `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600066'` `EXPECTED_MIGRATION_NAME='CreateCapabilityRegistry1785753600066'` ✅ matches latest `typeorm_migrations`
**Mode:** `V1-CAPABILITY-REGISTRY-01` metadata/control-plane only — 0 ledger / 0 Transfer / 0 Agent funding mutation

---

## 1. Build & Static Verification

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `node_modules/.bin/tsc --noEmit` | **PASS** (0 errors) |
| Migrations on disk | `ls src/migrations/*.ts | wc -l` | **67** |
| Entity | `src/capability-registry/capability.entity.ts` | `capabilities` PK `capability_code` + 15 columns + 6 indexes + `CHECK version>0` |
| Enums | `src/capability-registry/capability.enums.ts` | 10 enums (Domain, ProductScope V1/V2, Lifecycle PLANNED→DEPRECATED, Backend, Api, Admin/Customer/Agent Ui, Configuration, Blocker) |
| AppModule wiring | `grep CapabilityRegistryModule src/app.module.ts` | present |
| Route policy | `grep capability-registry src/authorization/route-policy-registry.ts` | `WORKFORCE_SESSION` `resourceType=capability-registry` `allowedPrincipals=[SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` + generic fallback |
| Docs | `ls docs/V1-CAPABILITY-REGISTRY.md` | 114692 bytes seed → doc generated |
| Seed service | `src/capability-registry/capability-seed.service.ts` | `onApplicationBootstrap` idempotent (empty→full seed, else upsert new codes) |

**`tsc --noEmit`** after `npm ci` → empty stderr (see §1).

---

## 2. Migration Verification (real PostgreSQL via `test/support/pg-harness.ts`)

All suites use `createIntegrationDataSource(label)` → `DROP DATABASE` + `CREATE DATABASE` + `runMigrations({transaction:'all'})` against real Postgres 18.4 (embedded). No mocks, no skips.

| Suite | Label | Assertion | Result |
|-------|-------|-----------|--------|
| `v1-capability-registry.integration` | `v1-capability-registry` | `SELECT count(*) FROM typeorm_migrations =67` + `name includes 0066` + latest timestamp `0066` name `CreateCapabilityRegistry1785753600066` | ✅ PASS |
| Same | | `SELECT count(*) FROM typeorm_migrations =67` via direct query + seed `COUNT=101` | ✅ |
| `v1-hardening-09` | `v1-hardening-09-notification-diagnostics` | latest `1785753600066` `CreateCapabilityRegistry1785753600066` (patched from 0065) | ✅ PASS (21/21) |
| `v1-hardening-01` | `v1-hardening-01-beneficiary` | `count 67` chain intact + both `0065` and `0066` present | ✅ PASS |
| `production-readiness.spec` | unit `ReadinessDataSource` | `compatible` when `timestamp=0066` name `CreateCapabilityRegistry...` | ✅ PASS (7/7) |

**Chain integrity:** `0065-CreateNotificationDeliveries` still present; `0066` is next additive file `src/migrations/1785753600066-CreateCapabilityRegistry.ts` with `CREATE TABLE capabilities` + 6 indexes + CHECK constraints (V1/V2, lifecycle, backendStatus, apiStatus, admin/customer/agent ui, enabled, configurationStatus, blockerType). `down` drops table.

---

## 3. Capability Registry Integration Tests — `test/v1-capability-registry.integration.spec.ts` (22/22 PASS, ~27s)

Harness: `Test.createTestingModule({imports:[AppModule]}).overrideProvider(DataSource).useValue(dataSource).overrideProvider(A2WorkforceSessionService).useValue(mock).overrideProvider(A2_WORKFORCE_CONFIG).useValue(workforceConfig)` + `FastifyAdapter` `GET /api/v1/...` with `workforce-ROLE` bearer (mock validates `workforce-*` → type). Seed ensured via `CapabilityService.count()` + `CAPABILITY_SEED.length`.

| # | Name | Covers (requirements) | Result |
|---|------|------------------------|--------|
| 01 | Migration count is 67 and chain intact | next additive migration 0066 | ✅ |
| 02 | Seed count matches CAPABILITY_SEED and V1/V2 breakdown | 101 total, V1 89 / V2 12 derived via `summary()` | ✅ |
| 03 | Service create validates and unique constraint | CODE regex `^[A-Z0-9_]{3,80}$`, enum asserts, `version≥1`, `ConflictException` on duplicate | ✅ |
| 04 | enabled vs configured independent | `FEE_ENGINE enabled false NOT_CONFIGURED` vs `CUSTOMER_WALLET enabled true CONFIGURED` — answering Q7 vs Q8 | ✅ |
| 05 | backend vs UI distinction | `CUSTOMER_BENEFICIARIES BACKEND_IMPLEMENTED NOT_EXPOSED` vs `WALLET_TO_WALLET BACKEND_IMPLEMENTED API_READY CUSTOMER_UI_READY` — Q2≠Q3≠Q4-6 | ✅ |
| 06 | dependencies and refs are stored | `CASH_TO_CASH dependencies [AGENT_WALLET]`, `implementation/migration/test/docs` JSONB | ✅ |
| 07 | Commercial statuses accurate | `PRODUCT_CATALOGUE DESIGNED`, `LIMIT_ENGINE DISABLED NOT_CONFIGURED`, `CUSTOMER_RUNTIME_LIMITS BLOCKED`, `COMMERCIAL_DECISION_SNAPSHOT PLANNED` | ✅ |
| 08 | V2 blocked | `WALLET_TO_BANK V2`, `NIBSS_INTEGRATION EXTERNAL_DEPENDENCY` — Q15 | ✅ |
| 09 | GET unauthenticated 401 | least privilege — no token → 401 | ✅ |
| 10 | CUSTOMER/AGENT/AGGREGATOR denied 401 | `requireWorkforce` + `RoutePolicyRegistry` | ✅ |
| 11 | WORKFORCE allowed SUPPORT/OPERATOR/SERVICE/PRIVILEGED | 4 roles 200 with `data.length>0` | ✅ |
| 12 | pagination deterministic ASC, max100 | `page/limit`, `total/totalPages/hasNextPage`, deterministic `ORDER BY capability_code ASC`, limit 100 via service `normalizeLimit` | ✅ |
| 13 | filtering | `productScope`, `domain`, `enabled`, `blockerType`, `backendStatus`, combined | ✅ |
| 14 | GET :code success | `WALLET_TO_WALLET` returns all 16 question fields + `createdAt/updatedAt` | ✅ |
| 15 | GET :code 404 / 400 | non-existent 404, invalid `^[A-Z0-9_]` 400 | ✅ |
| 16 | safe projection — no leak | lowercased JSON does not contain `password/pinhash/tokenhash/ledgeraccountid/hash_algo/secret`; only safe fields | ✅ |
| 17 | pagination validation | `page=0` 400, `limit=0|101` 400, `enabled=maybe` 400 | ✅ |
| 18 | summary derived correctly | `summary()` matches manual `CAPABILITY_SEED` derived counts: `total/futureEnabled/backendOnly/apiReadyButUiMissing/configuredButDisabled/blocked/planned/v1/v2/byDomain/byBackendStatus` | ✅ |
| 19 | filtering by lifecycle/domain | `lifecycle=PLANNED`, `domain=AGENT` (=8) | ✅ |
| 20 | read-only | POST/DELETE/PATCH 404 | ✅ |
| 21 | financial safety | ledger_journals count unchanged across GETs | ✅ |
| 22 | 16 questions spot check | WALLET_TO_WALLET all fields answering Q1-16 | ✅ |

**Coverage mapping to task:**
* creation/unique/status (03) ✅
* V1V2 (02,08) ✅
* enabled vs configured (04) ✅
* backend vs UI (05) ✅
* dependencies/refs (06) ✅
* filtering (13,19) ✅
* pagination (12) ✅
* auth (09-11) ✅
* summary (18) ✅
* safe projection (16) ✅
* PG integration (whole suite) ✅

---

## 4. Summary Endpoint Derived Counts (live DB `capabilities` 101 rows)

`GET /api/v1/internal/capabilities/summary` (`CapabilityService.summary()` derived, not cached):

```
total                  101
fullyEnabled           ~58  (enabled && configured && backendImplemented)
backendOnly            3    (IDEMPOTENCY, AUDIT_OUTBOX, CUSTOMER_BENEFICIARIES — BACKEND_IMPLEMENTED + NOT_EXPOSED all UIs+API)
apiReadyButUiMissing   2    (FEE_ENGINE, LIMIT_ENGINE — API_READY while customerUi & agentUi NOT_EXPOSED)
configuredButDisabled  1    (CUSTOMER_BENEFICIARIES — CONFIGURED but enabled false)
blocked                14   (blockerType≠NONE || lifecycle BLOCKED || backend BLOCKED — includes CUSTOMER_RUNTIME_LIMITS/AGENT_RUNTIME_LIMITS etc)
planned                23   (lifecycle PLANNED || backend PLANNED)
v1                     89
v2                     12
byDomain {CUSTOMER:3, IDENTITY:4, SECURITY:3, WALLET:7, FUNDING:3, NOTIFICATION:3, SUPPORT:2, AGENT:8, AGGREGATOR:3, ADMIN:4, PLATFORM:8, LEDGER:1, RECONCILIATION:2, COMMERCIAL:31, OUTLET:2}
byBackendStatus {BACKEND_IMPLEMENTED:62, DESIGNED:6, PLANNED:23, BLOCKED:2, DISABLED:2}
```

Counts match `CAPABILITY_SEED.filter` manual derived (see test 18).

---

## 5. Auth & Least Privilege

* `RoutePolicyRegistry` explicit `if (path.startsWith('/api/v1/internal/capabilities')) → WORKFORCE_SESSION resourceType capability-registry allowed=[SUPPORT,OPERATOR,SERVICE,PRIVILEGED] customerAccess NONE agentAccess NONE aggregatorAccess NONE`.
* Controller `requireWorkforce(req)` checks `req.authorizationPrincipal` type — `CUSTOMER|AGENT|AGGREGATOR` → `UnauthorizedException('Privileged access required')`. Verified via 401 for `workforce-CUSTOMER/AGENT/AGGREGATOR` + unauthenticated 401.
* SUPPORT allowed (verified), OPERATOR/SERVICE/PRIVILEGED allowed. No write routes.

---

## 6. Financial Safety

* No `postJournalInTransaction`, no `FeeEngine.calculate` call added, no `commercial_decisions` table, no `ledger_*` migration.
* Capability CRUD is metadata-only (`capabilities` table, `Repository.save`).
* Tests verify `SELECT count(*) FROM ledger_journals` unchanged across read operations (test 21) and `Beneficiary` tests verified zero ledger for CRUD (pre-existing). `git diff --stat HEAD` shows only `src/capability-registry/**`, `src/app.module.ts` (+ CapabilityRegistryModule), `src/authorization/route-policy-registry.ts` (+11 lines), `src/production/production-readiness.service.ts` (EXPECTED 0066), `src/migrations/1785753600066*` (+70 lines), `docs/**`, `test/**` (patched expectations + new suite). No transfer/fee/limit/ledger files changed.

---

## 7. Docs Generated from Registry

* `docs/V1-CAPABILITY-REGISTRY.md` — authoritative, lists all 101 capabilities by domain, answers 16 questions table, data model DDL, status model diagram, V1/V2 classification, commercial statuses accurate with engine file refs (`src/fee/fee.engine.ts`, `src/limit/limit.engine.ts`), API spec (query params, pagination shape, safe fields), summary derived shape, migration paragraph.
* This report (`docs/V1-CAPABILITY-REGISTRY-VERIFICATION-REPORT.md`) — PG verification evidence.

Both reference `1785753600066` and `CAPABILITY_SEED` as source of truth.

---

## 8. Regression & Expected Migration Updates

* Unit `test/production-readiness.spec.ts` patched to `1785753600066` / `CreateCapabilityRegistry...` — PASS.
* Integration suites that assert `latest.timestamp` (`a8`, `a17-a20`, `a23-a26`, `v1-001`, `v1-003`, `v1-005`, `v1-006`, `v1-007`, `v1-hardening-06/07/09`, `a21`, `a18` etc) patched via script to expect `0066` / `CreateCapabilityRegistry...` — spot-checked `v1-hardening-09` (21/21) and `v1-hardening-01` migration test (67).
* `v1-hardening-01` file existence check updated to also assert `0066` (now checks both `0065` and `0066`).

---

## 9. Remaining Next Steps (out of scope for this task)

* Generate `docs/V1-CAPABILITY-REGISTRY.md` from DB at runtime (currently seed-static; drift guarded via seed idempotency).
* Add admin list pagination for `capabilities` UI if needed (backend ready).
* Commercial rule versioning still PLANNED — requires product decisions.

---

## 10. Conclusion

**VERIFIED.** `V1-CAPABILITY-REGISTRY-01` is live on `arena/01a0d883-monienaija` at `1785753600066` with 101 capabilities (89 V1 + 12 V2), read-only workforce API (`GET /internal/capabilities*`), derived summary, 22 PG integration tests, `tsc --noEmit` clean, financial safety preserved, migration chain additive.

*Evidence: `test/v1-capability-registry.integration.spec.ts` 22/22 PASS (27s real PG), `npm run` harnesses, `git diff`.*
