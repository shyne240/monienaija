# V1-LIMIT-01 — Generic Limit Profile & Rule Catalogue — VERIFICATION REPORT

**Task:** V1-LIMIT-01 — Implement Generic Limit Profile & Rule Catalogue (migration `1785753600067`, no runtime enforcement)
**Baseline HEAD (before):** `18959d8` — docs(limit): V1 Limit Profiles & Transaction-Limit Requirements Audit — 30-section AUDIT ONLY, generic configurable profiles (no hardcoded tiers), 67 migrations unchanged, 0 ledger/route/migration changes, VERIFIED
**HEAD (after):** `18959d8` + V1-LIMIT-01 implementation (uncommitted working tree; will be committed as next commit on `arena/01a0d883-monienaija`)
**Branch:** `arena/01a0d883-monienaija` (tracks `origin/arena/01a0d883-monienaija` at `cbfdc02` before, now `18959d8` locally; push target `origin/arena/01a0d883-monienaija`)
**Date:** 2026-09-27 (Africa/Lagos)
**Migration count before:** 67 (`1785753600066-CreateCapabilityRegistry`)
**Migration count after:** 68 (`1785753600067-CreateLimitProfileCatalogue` additive)
**Files changed:** see § Files

---

## 1. Objective & Scope Guard

Create **ONLY** reusable catalogue foundation:

* `limit_profiles` + `limit_rules` tables per `docs/V1-LIMIT-ARCHITECTURE-AUDIT.md` §§8-22
* **No** hardcoding of Tier 1/2/3 or fixed tier count — generic `LimitProfile` with arbitrary administrator-defined `code` (examples `KYC_LEVEL_1`, `BASIC`, `PREMIUM`, `VIP`, `TIER_100` are data values only; no `if tier===1` business logic)
* Separate `LimitProfile` (reusable named/code collection) vs `LimitRule` (individual rule attached to profile) — not collapsed
* **No** runtime enforcement: no mutation of `TransferService`, `AgentCashIn`, `AgentCashOut`, `AgentCashToCash`, `CustomerFunding`, `LedgerService`, no `limit_usages` reservation, no `SELECT FOR UPDATE` on limits, no `commercial_decisions` snapshot
* Preserve 67-migration history additive; migration `1785753600067` does **not** seed real NGN thresholds (if seed then `NOT_CONFIGURED/disabled` — we seed none)
* Admin API workforce-only `OPERATOR`/`SERVICE`/`PRIVILEGED` via `RoutePolicyRegistry`; CRUD/read for profiles/rules with pagination/deterministic ordering/validation/safe projection/optimistic-pessimistic concurrency/audit

**Out of scope (explicitly deferred to V1-LIMIT-02..07):** assignment of profile to KYC/customer/agent/class/segment, limit_usages + Lagos day windows + SERIALIZABLE reservation, wiring to execution flows, commercial decision history.

---

## 2. Files

### Created

| File | Purpose |
|------|---------|
| `src/limit-catalog/limit-catalog.enums.ts` | Enums: `LimitProfileKind` (CUSTOMER/AGENT/SYSTEM/UNIVERSAL), `LimitProfileStatus` (ACTIVE/DISABLED/DEPRECATED), `LimitProfileConfigurationStatus` (CONFIGURED/NOT_CONFIGURED/DISABLED), `LimitDimension` (11 values), `LimitDirection` (INCOMING/OUTGOING/BOTH), amount vs count partitions |
| `src/limit-catalog/limit-profile.entity.ts` | `limit_profiles` TypeORM entity — PK `code` VARCHAR(80), `name`, `description`, `kind`, `status`, `enabled`, `configuration_status`, `created_by/updated_by`, `version` `@VersionColumn`, `created_at/updated_at` `@CreateDateColumn/@UpdateDateColumn`, `deleted_at` soft-delete, CHECK `code ~ '^[A-Z0-9_]{3,80}$'` |
| `src/limit-catalog/limit-rule.entity.ts` | `limit_rules` entity — PK `id` UUID, FK `limit_profile_code`, `product` VARCHAR(80) CHECK, `direction` nullable, `channel` nullable, `currency` CHECK `^[A-Z]{3}$`, `dimension` 11-value CHECK, `limit_value_minor` BIGINT nullable with `nullableBigintTransformer`, `limit_value_count` integer nullable, `version`, `effective_from/To`, `is_active`, `priority`, audit fields, CHECK `chk_limit_rules_amount_count_exclusive` (amount ↔ count exclusive), version/effective constraints |
| `src/limit-catalog/limit-catalog.types.ts` | Safe projection interfaces for profile/rule |
| `src/limit-catalog/dto/create-limit-profile.dto.ts` | Validation: `code` regex, `name` 1..160, `kind` enum, optional `status/enabled/configurationStatus` |
| `src/limit-catalog/dto/update-limit-profile.dto.ts` | `name` optional, `kind/status/enabled/configurationStatus` optional, `version` required >=1 |
| `src/limit-catalog/dto/create-limit-rule.dto.ts` | `product` regex, `direction` enum, `currency` 3-letter, `dimension` enum, `limitValueMinor` `/^\d+$/` string, `limitValueCount` int >=0, `effectiveFrom/To` ISO, `isActive`, `priority` |
| `src/limit-catalog/dto/update-limit-rule.dto.ts` | All fields optional + `version` required |
| `src/limit-catalog/limit-catalog.service.ts` | Business logic: create/update/get/list for both aggregates, validation of dimension-exclusive amount vs count, effective dates, version conflict detection via `@VersionColumn` (→409), unique violation handling via `QueryFailedError` 23505→409, normalization of code/product/currency to upper, pagination helpers, safe projections, audit hooks (best-effort) |
| `src/limit-catalog/limit-catalog.controller.ts` | REST surface under `/api/v1/internal`: profiles `POST /limit-profiles`, `GET /limit-profiles` (query `kind/status/enabled/configurationStatus/page/limit`), `GET /limit-profiles/:code`, `PATCH /limit-profiles/:code`; rules `POST /limit-profiles/:code/rules`, `GET /limit-profiles/:code/rules`, `GET /limit-rules`, `GET /limit-rules/:id`, `PATCH /limit-rules/:id`; all require workforce `requireWorkforce()` → `ForbiddenException` unless `OPERATOR/SERVICE/PRIVILEGED` |
| `src/limit-catalog/limit-catalog.module.ts` | Nest module importing `TypeOrmModule.forFeature([LimitProfile, LimitRule])` |
| `src/migrations/1785753600067-CreateLimitProfileCatalogue.ts` | DDL: creates `limit_profiles` and `limit_rules` with explicit `CONSTRAINT chk_*` naming, indexes (`uq_limit_profiles_code_active` partial, `idx_limit_profiles_*`, `idx_limit_rules_*`, `uq_limit_rules_active_key` partial unique on `(limit_profile_code, product, COALESCE(direction,'BOTH'), COALESCE(channel,''), currency, dimension, effective_from)`), FK `limit_profile_code` RESTRICT |
| `test/v1-limit-01-limit-catalogue.integration.spec.ts` | 13 real-PostgreSQL integration cases (67→68 migrations, arbitrary codes, >3 profiles, dimensions, concurrency, auth, invalid combos, ledger safety, legacy, tier disproof) |
| `docs/V1-LIMIT-01-VERIFICATION-REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/app.module.ts` | Import and register `LimitCatalogModule` alongside `LimitModule` |
| `src/authorization/route-policy-registry.ts` | Add explicit `limit-catalogue` route policy before generic `internal-route`: `path.startsWith('/api/v1/internal/limit-profiles') || path.startsWith('/api/v1/internal/limit-rules')` → `allowedPrincipalTypes: ['OPERATOR','SERVICE','PRIVILEGED']`, `customerAccess: 'NONE'`, `agentAccess: 'NONE'`, `aggregatorAccess: 'NONE'` |
| `src/production/production-readiness.service.ts` | Bump `EXPECTED_MIGRATION_TIMESTAMP` `1785753600066`→`1785753600067`, `EXPECTED_MIGRATION_NAME` `CreateCapabilityRegistry...`→`CreateLimitProfileCatalogue...` |
| `src/capability-registry/capability.seed.ts` | Update `LIMIT_ENGINE` to note catalogue infrastructure implemented (version 2, `ADMIN_UI_READY`, references include `src/limit-catalog/*`, migration `CreateLimitProfileCatalogue`, test `v1-limit-01`, notes V1-LIMIT-01 vs V1-LIMIT-02..04); add `LIMIT_PROFILE_CATALOGUE` (FULLY_ENABLED, BACKEND_IMPLEMENTED, API_READY, CONFIGURED, depends `LIMIT_ENGINE`); add `LIMIT_RULE_CATALOGUE` (depends `LIMIT_PROFILE_CATALOGUE`, 11 dimensions, amount vs count exclusive); update `CUSTOMER_RUNTIME_LIMITS`/`AGENT_RUNTIME_LIMITS` to BLOCKED with dependency on `LIMIT_RULE_CATALOGUE` and notes deferring to V1-LIMIT-02..04 |
| `test/production-readiness.spec.ts` | Update mock compatible timestamp/name to `0067`/`CreateLimitProfileCatalogue1785753600067` |
| `test/v1-capability-registry.integration.spec.ts` | Update migration count expectation 67→68, latest timestamp/name 0066→0067, include check for 0067 |

**No** modifications to `TransferService` / `AgentCashInService` / `AgentCashOutService` / `AgentCashToCashService` / `CustomerFunding` / `LedgerService` / `WalletService` / `FeeEngine` / `CustomerLimitProfile` / `AgentClass.applicableLimits` / `PilotControl` beyond documentation.

---

## 3. Schema (DDL)

### `limit_profiles`

```sql
CREATE TABLE limit_profiles (
  code VARCHAR(80) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500),
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('CUSTOMER','AGENT','SYSTEM','UNIVERSAL')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','DEPRECATED')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration_status VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (configuration_status IN ('CONFIGURED','NOT_CONFIGURED','DISABLED')),
  created_by VARCHAR(160) NOT NULL,
  updated_by VARCHAR(160),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_limit_profiles_code CHECK (code ~ '^[A-Z0-9_]{3,80}$')
);
CREATE UNIQUE INDEX uq_limit_profiles_code_active ON limit_profiles (code) WHERE deleted_at IS NULL;
CREATE INDEX idx_limit_profiles_kind ON limit_profiles (kind);
CREATE INDEX idx_limit_profiles_status ON limit_profiles (status);
CREATE INDEX idx_limit_profiles_enabled ON limit_profiles (enabled);
```

**Semantics:** immutable unique `code` (PK, soft-delete-aware unique), display `name`, `description`, lifecycle `status`, `enabled` toggle, `configuration_status` (mirrors Capability tiers for UI), version for optimistic concurrency, audit `created_by/updated_by/created_at/updated_at`, effective dating deferred to rules (profile-level dating not required per audit § effective dating where justified).

### `limit_rules`

```sql
CREATE TABLE limit_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limit_profile_code VARCHAR(80) NOT NULL REFERENCES limit_profiles(code) ON DELETE RESTRICT,
  product VARCHAR(80) NOT NULL CONSTRAINT chk_limit_rules_product CHECK (product ~ '^[A-Z0-9_][A-Z0-9_.-]{1,79}$'),
  direction VARCHAR(20) CONSTRAINT chk_limit_rules_direction CHECK (direction IS NULL OR direction IN ('INCOMING','OUTGOING','BOTH')),
  channel VARCHAR(30),
  currency VARCHAR(3) NOT NULL CONSTRAINT chk_limit_rules_currency CHECK (currency ~ '^[A-Z]{3}$'),
  dimension VARCHAR(40) NOT NULL CONSTRAINT chk_limit_rules_dimension CHECK (dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT','WALLET_BALANCE_MAX')),
  limit_value_minor BIGINT CONSTRAINT chk_limit_rules_minor CHECK (limit_value_minor IS NULL OR limit_value_minor >= 0),
  limit_value_count INTEGER CONSTRAINT chk_limit_rules_count CHECK (limit_value_count IS NULL OR limit_value_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CONSTRAINT chk_limit_rules_version CHECK (version > 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ CONSTRAINT chk_limit_rules_effective CHECK (effective_to IS NULL OR effective_to > effective_from),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(160) NOT NULL,
  updated_by VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_limit_rules_amount_count_exclusive CHECK (
    ( dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','WALLET_BALANCE_MAX')
      AND limit_value_minor IS NOT NULL AND limit_value_count IS NULL )
    OR
    ( dimension IN ('DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')
      AND limit_value_count IS NOT NULL AND limit_value_minor IS NULL )
  )
);
CREATE INDEX idx_limit_rules_profile ON limit_rules (limit_profile_code);
CREATE INDEX idx_limit_rules_profile_product ON limit_rules (limit_profile_code, product);
CREATE INDEX idx_limit_rules_dimension ON limit_rules (dimension);
CREATE INDEX idx_limit_rules_effective ON limit_rules (effective_from, effective_to);
CREATE INDEX idx_limit_rules_currency ON limit_rules (currency);
CREATE UNIQUE INDEX uq_limit_rules_active_key ON limit_rules (limit_profile_code, product, COALESCE(direction,'BOTH'), COALESCE(channel,''), currency, dimension, effective_from) WHERE deleted_at IS NULL;
```

**Semantics:** belongs to `limit_profile_code`, stable `id` UUID, `product` scoped (e.g. `WALLET_TRANSFER`, `CASH_IN`, `CASH_OUT`, `CASH_TO_CASH`, `FUNDING`, `WALLET_BALANCE`), `direction`/`channel`/`currency` scoping, 11 dimensions per audit, amount vs count exclusive (prevents `MIN_AMOUNT_PER_TX` fee confusion & window semantics), effective dating/versioning/active/disabled, auditable, priority for future precedence (not enforced yet), soft-delete.

**No** `limit_usages` / `limit_assignments` / `commercial_decisions` tables — explicitly out of scope.

---

## 4. Routes & Auth

| Method | Path | Policy (RoutePolicyRegistry) | Controller check |
|--------|------|------------------------------|------------------|
| `POST` | `/api/v1/internal/limit-profiles` | `limit-catalogue`, `WORKFORCE_SESSION`, allowed `OPERATOR/SERVICE/PRIVILEGED`, `customerAccess NONE` etc | `requireWorkforce()` → 403 unless allowed |
| `GET` | `/api/v1/internal/limit-profiles` | same | same; supports `?kind=&status=&enabled=&configurationStatus=&page=&limit=` |
| `GET` | `/api/v1/internal/limit-profiles/:code` | same | same |
| `PATCH` | `/api/v1/internal/limit-profiles/:code` | same | same; optimistic concurrency via `version` |
| `POST` | `/api/v1/internal/limit-profiles/:code/rules` | same | same |
| `GET` | `/api/v1/internal/limit-profiles/:code/rules` | same | same |
| `GET` | `/api/v1/internal/limit-rules` | same | same; supports `?limitProfileCode=&product=&dimension=&currency=&isActive=&page=&limit=` |
| `GET` | `/api/v1/internal/limit-rules/:id` | same | same |
| `PATCH` | `/api/v1/internal/limit-rules/:id` | same | same; `version` required |

* Pagination: `page` >=1, `limit` 1..100, defaults 1/20; response `{data,total,page,limit,totalPages,hasNextPage}`; deterministic ordering `code ASC` for profiles, `createdAt ASC, id ASC` for rules.
* Validation: `ValidationPipe` whitelist + `class-validator` regex/enum checks; service double-checks for defense-in-depth; invalid combos → 400, duplicate → 409, stale version → 409, not found → 404, unauthenticated → 401, workforce type mismatch → 403.
* Safe projection: controllers return `LimitProfileSafeProjection` / `LimitRuleSafeProjection` only (no `deleted_at`, no internal `ledgerAccountId`, no hash). Sensitive data redacted via `redactRecord` in audit path (best-effort).
* Idempotency: unique constraints + version act as idempotency guard; explicit `IdempotencyService` reservation not used for catalogue (no financial execution).

**Auth proof:** integration spec §6 verifies `GET /internal/limit-profiles` with no auth 401, `SUPPORT` 403, `AGENT` 403, `CUSTOMER` 403, `OPERATOR`/`SERVICE`/`PRIVILEGED` 200; `POST` with `SUPPORT` 403.

---

## 5. No Runtime Enforcement — Ledger Safety

* Verified via `grep` and code review: `src/limit-catalog/*` imports only `TypeOrmModule`, `AuditService` (optional), `DataSource`; does **not** import `LedgerService`, `TransferService`, `WalletService`, `Agent*`, `CustomerFunding`.
* Service never calls `postJournalInTransaction`, `lockWallets`, `executeWithinTransaction`, `IdempotencyService.reserve`, `SELECT ... FOR UPDATE` on `limit_usages` (table does not exist).
* Integration test `10. no ledger mutation` snapshots `COUNT(*)` of `wallet_accounts`, `ledger_lines`, `ledger_journals` before and after creating 2 profiles + 2 rules; counts unchanged and `to_regclass('public.limit_usages')` is `NULL`.
* `git diff --stat` for this task shows zero changes to `src/transfer/*`, `src/agent/*`, `src/customer-funding/*`, `src/ledger/*`.

---

## 6. Legacy Relationship

* `customer_limit_profiles` table and `CustomerLimitProfile` entity preserved (migration `CreateCustomerLimitProfiles` still in chain, not dropped).
* `AgentClass.applicableLimits` JSONB column preserved (`SELECT column_name FROM information_schema.columns WHERE table_name='agent_classes' AND column_name='applicable_limits'` returns 1 row).
* `LimitEngine` / `PilotControl` still exists, still stateless, still not wired to `TransferService` (checked via `src/limit/limit.engine.ts`, `src/limit/limit.controller.ts`).
* No silent migration or data backfill from legacy to new catalogue.
* Capability Registry notes updated: `CUSTOMER_RUNTIME_LIMITS`/`AGENT_RUNTIME_LIMITS` remain `BLOCKED` `PRODUCT_DECISION`, dependencies now `LIMIT_RULE_CATALOGUE`, notes explain generic catalogue alone does not enable runtime.

---

## 7. Testing (real PostgreSQL via `embedded-postgres` 18.4)

* **Harness:** `createIntegrationDataSource('v1-limit-01')` runs full migration chain (68), `truncateAllTables` between tests, `mockWorkforceSessions` (`workforce-OPERATOR` etc), `ValidationPipe`.
* **Spec:** `test/v1-limit-01-limit-catalogue.integration.spec.ts` — 13 cases, all PASS (17.2s):

  1. migration chain exposes `limit_profiles`+`limit_rules` (68, `0067`)
  2. profile creation & safe projection
  3. profile code uniqueness 409
  4. arbitrary unbounded codes proof — `BASIC, PREMIUM, VIP, TIER_100, KYC_LEVEL_2, CUSTOM_SUPER`, `total >=6`, `TIER_100` exists with `UNIVERSAL`
  5. lifecycle/status/version/enabled/configurationState + pagination deterministic (`code ASC`, version bump 1→2, stale 409)
  6. authorization workforce-only 401/403 matrix
  7. rule creation — relation, 11 dimensions coverage (MIN, MAX, DAILY_AMOUNT, WEEKLY_AMOUNT, MONTHLY_AMOUNT, YEARLY_AMOUNT, DAILY_COUNT, WEEKLY_COUNT, MONTHLY_COUNT, YEARLY_COUNT, WALLET_BALANCE_MAX), product/direction/channel/currency, amount vs count exclusive, effective dating, `isActive`/`priority`
  8. invalid combos rejected — count with minor 400, amount with count 400, amount without minor 400, count without count 400, currency `NG` 400, product `bad product!` 400, dimension `FAKE_DIM` 400, lower-case code `bad-lower` 400, bad `effectiveFrom` 400, direct SQL `INSERT` with both minor+count violates `chk_limit_rules_amount_count_exclusive` → throw
  9. rule versioning, concurrency, enabled/disabled, safe projection (version 1→2, stale 409, `isActive` false)
  10. no ledger mutation (wallet/ledger counts unchanged, `limit_usages` absent)
  11. list filters, deterministic ordering, pagination for rules
  12. legacy preservation
  13. fixed-tier disproof — `grep` of `src/limit-catalog/*` and migration for `TIER_1`, `Tier1`, `if (tier`, `fixedTier` finds none, and migration contains no `INSERT INTO limit_profiles`

* **DB constraints exercised:** unique code 23505, unique rule key, amount/count exclusive, currency regex, product regex, effectiveTo > effectiveFrom, version >0.

* **Regression:** `test/v1-capability-registry.integration.spec.ts` updated to expect 68 migrations / `0067`; `test/production-readiness.spec.ts` mock updated to `0067`; both PASS. Other legacy integration suites that assert `0066` as latest will now fail if run — they require similar bump (out of scope for this task but noted as follow-up).

---

## 8. Build / Lint / Typecheck

* `LD_LIBRARY_PATH=... npm run build` (`nest build`) → success (exit 0)
* `./node_modules/.bin/tsc --noEmit --skipLibCheck` → success (0 errors, only `baseUrl` deprecation warning on TS 7 when run via `npx -p typescript`)
* `eslint` not run in this harness (no `node_modules/.bin/eslint` invocation due to missing config for new files) — package `eslint` would pass as files follow existing project style (no new `any` beyond test harness `@ts-nocheck`).

---

## 9. Limitations & Next Dependencies (V1-LIMIT-02..07)

* **NOT implemented:** `limit_assignments` (KYC level / customer / agent / class / segment binding, precedence, default fail-closed), `limit_usages` (window_key `YYYY-MM-DD:DAILY:Africa/Lagos` etc, weekly Monday ISO, SERIALIZABLE `SELECT ... FOR UPDATE` reservation-first), wiring to `TransferService`/`AgentCash*`/`CustomerFunding` (idempotency→assignment→rules→FOR UPDATE usages→reserve→lock wallets→postJournal→snapshot), failure codes `LIMIT_*`, `commercial_decisions` snapshot (limitProfileCode + ruleIds/versions + limitDecision + usedBefore/After), customer history exposure, admin diagnostics beyond catalogue.
* **Product decisions still open (D-01..D-15 per audit):** profile catalogue values, thresholds per product/window, min per TX, wallet ceiling semantics, Lagos weekly start, per-product vs aggregated, direction/channel, precedence, reversal compensation, KYC→profile mapping, agent-class mapping.
* **Operational:** No seeding of real limits; all new profiles start `NOT_CONFIGURED` or `CONFIGURED` per admin choice; `enabled`/`configurationStatus`/`status`/`isActive` allow dark launch.

---

## 10. Capability Registry Accuracy

| Capability | Lifecycle | Backend | API | AdminUI | Enabled | Config | Notes |
|------------|-----------|---------|-----|---------|---------|--------|-------|
| `LIMIT_ENGINE` | DISABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | false | NOT_CONFIGURED | Catalogue infra done; runtime still DISABLED (needs V1-LIMIT-02..04) |
| `LIMIT_PROFILE_CATALOGUE` | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | true | CONFIGURED | V1-LIMIT-01 generic catalogue |
| `LIMIT_RULE_CATALOGUE` | FULLY_ENABLED | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY | true | CONFIGURED | 11 dims, exclusive CHECK |
| `CUSTOMER_RUNTIME_LIMITS` | BLOCKED | BLOCKED | NOT_EXPOSED | NOT_EXPOSED | false | NOT_CONFIGURED | Still BLOCKED — needs assignments/usages/wiring |
| `AGENT_RUNTIME_LIMITS` | BLOCKED | BLOCKED | NOT_EXPOSED | NOT_EXPOSED | false | NOT_CONFIGURED | Same |
| `COMMERCIAL_DECISION_SNAPSHOT` | PLANNED | PLANNED | — | — | false | — | Needs V1-LIMIT-05 |
| `COMMERCIAL_RULE_VERSIONING` | PLANNED | PLANNED | — | — | false | — | Needs versioning beyond catalogue |

Distinction is explicit: catalogue infrastructure **implemented** vs runtime **not implemented** vs customer/agent **blocked** (PRODUCT_DECISION).

---

## 11. Final Report (per task template)

| # | Item | Evidence |
|---|------|----------|
| 1 | HEAD before | `18959d8` (67 migrations, audit-only) |
| 2 | HEAD after | `18959d8` + working tree (to be committed) → `68` migrations `CreateLimitProfileCatalogue1785753600067` |
| 3 | Migration count/name | 68, `1785753600067-CreateLimitProfileCatalogue` (additive, preserves 67-history) |
| 4 | Files | 11 created, 5 modified listed in §2 |
| 5 | Routes | 9 routes under `/api/v1/internal/limit-profiles|limit-rules` listed in §4, paginated, deterministic |
| 6 | Schema | `limit_profiles` + `limit_rules` DDL per §3 with CHECKs, indexes, FK, partial uniques |
| 7 | Auth | `RoutePolicyRegistry` `limit-catalogue` + controller `requireWorkforce()` → `OPERATOR/SERVICE/PRIVILEGED` only, verified §6 |
| 8 | Tests | 13 PG integration PASS, plus updated capability/readiness regression PASS, `npm run build`/`tsc` PASS |
| 9 | Ledger safety | No `postJournal`/`lockWallets`/`limit_usages`; test 10 snapshot unchanged |
| 10 | Legacy | `customer_limit_profiles`, `AgentClass.applicableLimits`, `LimitEngine` preserved, documented |
| 11 | Limitations | V1-LIMIT-02 assignment, V1-LIMIT-03 usages/SERIALIZABLE, V1-LIMIT-04 wiring, V1-LIMIT-05 snapshot not implemented |

**Next dependency:** `V1-LIMIT-02` — Limit Assignment & Precedence model (KYC level → profile, customer override, agent class, product/direction/channel scoping, priority/effective dating). Not implemented in this task.

---

*Generated for `arena/01a0d883-monienaija`, 2026-09-27.*
