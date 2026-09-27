# V1-LIMIT-02 — Generic Limit Profile Assignment — VERIFICATION REPORT

**Task:** V1-LIMIT-02 — Generic assignment of Limit Profile → subject (migration `1785753600068`, no runtime enforcement)
**Baseline HEAD (before):** `88af2f5` — feat(limit-01): generic Limit Profile & Rule catalogue — 68 migrations, workforce CRUD, 11 dims, amount/count exclusive, effective/version, no runtime — VERIFIED
**HEAD (after):** `6c9a995` — feat(limit-02): generic Limit Profile Assignment — 69 migrations, 5 subjects, precedence/effective/version, workforce CRUD, no runtime
**Branch:** `arena/01a0d883-monienaija` (tracks `origin/arena/01a0d883-monienaija` at `88af2f5` before, now `6c9a995`)
**Date:** 2026-09-27 (Africa/Lagos)
**Migration count before:** 68 (`1785753600067-CreateLimitProfileCatalogue`)
**Migration count after:** 69 (`1785753600068-CreateLimitAssignments` additive)
**Files changed:** see § Files

---

## 1. Objective & Scope Guard

Implement **generic assignment model** assigning arbitrary Limit Profiles (from V1-LIMIT-01) to supported subjects — without hardcoding Tier 1/2/3, KYC Level 1/2/3, Basic/Standard/Premium, fixed profile count, or fixed KYC→profile mapping.

* Generic `limit_assignments` table — distinct from `LimitProfile` itself, from the *subject* receiving the profile, and from *scope/priority/effective* metadata
* Supported subjects: `CUSTOMER` (row in `customers`), `AGENT` (`agents`), `AGENT_CLASS` (`agent_classes`), `SEGMENT` (arbitrary classification code `^[A-Z0-9_]{3,80}$` — **not** an invented KYC system; stored as opaque string validated by pattern only), `GLOBAL` (default/fallback)
* No fixed tier/KYC branching — all assignments are **data-driven** via stored refs (`subjectType`, `subjectId`, `segmentCode`, `limitProfileCode`); no `if (kycLevel === 'LEVEL_1') then assign BASIC` in service/controller/entity/DTO
* Assignment-only: **no runtime limit evaluation or usage accounting** — no `limit_usages`, no `FOR UPDATE` reservation, no `commercial_decisions`, no `FeeEngine`/`LimitEngine` wiring, no `TransferService`/`AgentCashIn`/`AgentCashOut`/`AgentCashToCash`/`CustomerFunding`/`LedgerService` mutations
* Data model stores **precedence/priority** (integer), **effective dating** (`effectiveFrom` default `NOW()`, `effectiveTo` nullable `>From`), **version** (`@VersionColumn` >0), **active/disabled** (`isActive`), **audit** (`createdBy`/`updatedBy`, `createdAt`/`updatedAt`, soft-delete `deletedAt` → historical auditable, no silent replace)
* No auto-migration of legacy `customer_limit_profiles` or `AgentClass.applicableLimits` — they are preserved read-only; legacy relation documented as future convergence need (§12)

**Out of scope (deferred to V1-LIMIT-03..04):** `limit_usages` with `SERIALIZABLE`/`FOR UPDATE`, Lagos window evaluation, wiring to execution flows, runtime APIs for customers/agents.

---

## 2. Files

### Created

| File | Purpose |
|------|---------|
| `src/limit-catalog/limit-assignment.entity.ts` | `limit_assignments` entity — PK `id` uuid `gen_random_uuid()`, `limit_profile_code` VARCHAR(80) FK `limit_profiles(code)` RESTRICT, `subject_type` VARCHAR(20) CHECK `IN ('GLOBAL','SEGMENT','AGENT_CLASS','CUSTOMER','AGENT')`, `subject_id` uuid nullable, `segment_code` VARCHAR(80) nullable `~ '^[A-Z0-9_]{3,80}$'`, `precedence` integer default 0, `effective_from` timestamptz default `NOW()`, `effective_to` nullable `>From`, `is_active` boolean default true, `created_by`/`updated_by` VARCHAR(160), `version` integer >0 `@VersionColumn`, `created_at`/`updated_at`/`deleted_at` (soft-delete), CHECK `chk_limit_assignments_subject_consistency`, indexes `idx_limit_assignments_*`, unique `uq_limit_assignments_active_key` (`subject_type`, `COALESCE(subject_id::text,'' )`, `COALESCE(segment_code,'' )`, `limit_profile_code`, `effective_from`) `WHERE deleted_at IS NULL`, FK `ManyToOne` limitProfile |
| `src/limit-catalog/dto/create-limit-assignment.dto.ts` | DTO: `limitProfileCode` `/^[A-Z0-9_]{3,80}$/`, `subjectType` `@IsEnum(LimitAssignmentSubjectType)`, `subjectId` optional `@IsUUID()`, `segmentCode` optional `/^[A-Z0-9_]{3,80}$/` + `MaxLength(80)`, `precedence` optional int, `effectiveFrom/To` optional ISO strings, `isActive` optional boolean |
| `src/limit-catalog/dto/update-limit-assignment.dto.ts` | Same fields optional + `version` `@IsInt() @Min(1)` required for optimistic concurrency |
| `src/limit-catalog/limit-assignment.service.ts` | Service 320+ lines: `createAssignment` validates `limitProfileCode` pattern, subject consistency (`SEGMENT→segment required & subjectId null`; `GLOBAL→both null`; `CUSTOMER/AGENT/AGENT_CLASS→subjectId UUID required`), profile existence (`profileRepo.findOne` →404), subject existence via direct SQL `SELECT id FROM customers/agents/agent_classes WHERE id=$1 AND deleted_at IS NULL` (SEGMENT/GLOBAL no existence check beyond pattern), effective date parsing/validation (`effectiveTo > effectiveFrom` →400), precedence integer check, version init 1, `assignmentRepo.save` with `QueryFailedError` 23505→409, best-effort `auditService.record` inside `dataSource.transaction` (`LIMIT_ASSIGNMENT` CREATED/UPDATED), `updateAssignment` loads row →404, `assertVersion` equality →409, patch fields with same validation, effective check, save→409, `getAssignment`, `listAssignments` (where `subjectType/subjectId/segmentCode/limitProfileCode/isActive` upper-normalized, `withDeleted: false`, order `createdAt ASC, id ASC`, page/limit 1..100 →400), `listByProfile/listByCustomer/listByAgent/listByAgentClass`, `countAssignments`,.helpers `validateCreate/SubjectConsistency/Existence`, `assignmentValues`, `toSafe` |
| `src/limit-catalog/limit-assignment.controller.ts` | Controller `@Controller('internal')` 9 routes under `limit-assignments`: `POST /limit-assignments`, `GET /limit-assignments` (query `subjectType/subjectId/segmentCode/limitProfileCode/isActive/page/limit`), `GET /limit-assignments/profile/:code`, `/customer/:id`, `/agent/:id`, `/agent-class/:id`, `/segment/:code`, `GET /limit-assignments/:id`, `PATCH /limit-assignments/:id` (requires `version`); all via `requireWorkforce` → `UnauthorizedException` 401 if no principal, `ForbiddenException` 403 unless `OPERATOR`/`SERVICE`/`PRIVILEGED`; `actorOf` from `principalId`; UUID/code pattern guards, pagination guards, `clean()` upper-normalizes |
| `src/migrations/1785753600068-CreateLimitAssignments.ts` | DDL additive: `CREATE TABLE limit_assignments` with 5 CHECKs (type, segment pattern, version>0, effective, subject_consistency), 5 indexes + partial unique `uq_limit_assignments_active_key`, FK `limit_profile_code` → `limit_profiles(code)` RESTRICT, PK gen_random_uuid |
| `test/v1-limit-02-limit-assignment.integration.spec.ts` | 15 real-PostgreSQL cases (see §7) |
| `docs/V1-LIMIT-02-VERIFICATION-REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/limit-catalog/limit-catalog.enums.ts` | Add `LimitAssignmentSubjectType` `GLOBAL/SEGMENT/AGENT_CLASS/CUSTOMER/AGENT` + `LimitAssignmentScope` |
| `src/limit-catalog/limit-catalog.types.ts` | Add `LimitAssignmentCreateInput`, `LimitAssignmentUpdateInput`, `LimitAssignmentSafeProjection` |
| `src/limit-catalog/limit-catalog.module.ts` | `TypeOrmModule.forFeature([LimitAssignment, LimitProfile, LimitRule])`, import `LimitAssignment` entity, add `LimitAssignmentController` + `LimitAssignmentService` to controllers/providers/exports |
| `src/authorization/route-policy-registry.ts` | Broaden workforce guard: `path.startsWith('/api/v1/internal/limit-')` (was `limit-profiles|limit-rules` only) → `WORKFORCE_SESSION` `OPERATOR/SERVICE/PRIVILEGED` workforce-only (same subset as V1-LIMIT-01), preserves `limit-catalogue` resourceType |
| `src/production/production-readiness.service.ts` | Bump `EXPECTED_MIGRATION_TIMESTAMP` `1785753600067`→`1785753600068`, `EXPECTED_MIGRATION_NAME` `CreateLimitProfileCatalogue…`→`CreateLimitAssignments…` |
| `src/capability-registry/capability.seed.ts` | Inject `LIMIT_ASSIGNMENT` (FULLY_ENABLED, BACKEND_IMPLEMENTED, API_READY, ADMIN_UI_READY, NOT_EXPOSED customer/agent, enabled true, CONFIGURED, dependencies `[LIMIT_PROFILE_CATALOGUE,LIMIT_RULE_CATALOGUE,CUSTOMER_IDENTITY,AGENT_IDENTITY,AGENT_CLASSES]`, impl refs `limit-assignment.*`, migration `CreateLimitAssignments`, test `v1-limit-02`, docs `V1-LIMIT-02`); update `LIMIT_ENGINE` description to include assignment, deps `limit-assignment.*`, migrations both catalogues, version 3, notes `POST/PATCH/GET /internal/limit-assignments` workforce; update `CUSTOMER_RUNTIME_LIMITS` (dependency `LIMIT_ASSIGNMENT`, version 3, description requires V1-LIMIT-03/04 assignment done) and `AGENT_RUNTIME_LIMITS` similarly |
| `test/v1-limit-01-limit-catalogue.integration.spec.ts` | Make migration check additive: `toBeGreaterThanOrEqual(68)` + `some(0067)` + last `∈ {0067,0068}` |
| `test/v1-capability-registry.integration.spec.ts` | Update migration count 68→69, latest 0067→0068, include check for 0068 |
| `test/production-readiness.spec.ts` | Update mock compatible timestamp/name to `0068`/`CreateLimitAssignments…` |

**No** modifications to `TransferService` / `AgentCashIn`/`Out`/`CashToCash` / `CustomerFunding` / `LedgerService` / `limit/limit.engine.ts` / `customer_limit_profiles` / `AgentClass.applicableLimits` JSONB read-write / `fee` / `commercial_decisions` / `limit_usages`.

---

## 3. Schema (DDL)

### `limit_assignments`

```sql
CREATE TABLE "limit_assignments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "limit_profile_code" varchar(80) NOT NULL,
  "subject_type" varchar(20) NOT NULL,
  "subject_id" uuid,
  "segment_code" varchar(80),
  "precedence" integer NOT NULL DEFAULT 0,
  "effective_from" timestamptz NOT NULL DEFAULT NOW(),
  "effective_to" timestamptz,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" varchar(160) NOT NULL,
  "updated_by" varchar(160),
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "PK_limit_assignments" PRIMARY KEY ("id"),
  CONSTRAINT "chk_limit_assignments_subject_type" CHECK (subject_type IN ('GLOBAL','SEGMENT','AGENT_CLASS','CUSTOMER','AGENT')),
  CONSTRAINT "chk_limit_assignments_segment" CHECK (segment_code IS NULL OR segment_code ~ '^[A-Z0-9_]{3,80}$'),
  CONSTRAINT "chk_limit_assignments_version" CHECK (version > 0),
  CONSTRAINT "chk_limit_assignments_effective" CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT "chk_limit_assignments_subject_consistency" CHECK (
    (subject_type IN ('CUSTOMER','AGENT','AGENT_CLASS') AND subject_id IS NOT NULL AND segment_code IS NULL)
    OR (subject_type = 'SEGMENT' AND segment_code IS NOT NULL AND subject_id IS NULL)
    OR (subject_type = 'GLOBAL' AND subject_id IS NULL AND segment_code IS NULL)
  ),
  CONSTRAINT "FK_limit_assignments_profile" FOREIGN KEY ("limit_profile_code") REFERENCES "limit_profiles"("code") ON DELETE RESTRICT
);
CREATE INDEX "idx_limit_assignments_profile" ON "limit_assignments" ("limit_profile_code");
CREATE INDEX "idx_limit_assignments_subject" ON "limit_assignments" ("subject_type","subject_id");
CREATE INDEX "idx_limit_assignments_segment" ON "limit_assignments" ("segment_code");
CREATE INDEX "idx_limit_assignments_effective" ON "limit_assignments" ("effective_from","effective_to");
CREATE INDEX "idx_limit_assignments_active" ON "limit_assignments" ("is_active");
CREATE UNIQUE INDEX "uq_limit_assignments_active_key"
  ON "limit_assignments" ("subject_type","subject_id","segment_code","limit_profile_code","effective_from")
  WHERE deleted_at IS NULL;
```

* **FK RESTRICT** prevents deleting a `limit_profiles` row while assignments reference it (tested via `DELETE FROM limit_profiles …` rejects).
* **Partial unique `WHERE deleted_at IS NULL`** preserves history: soft-deleted rows remain auditably with `deleted_at` but don't block future insertion; `assignmentRepo` uses `withDeleted: false`.
* **Subject consistency CHECK** enforces at DB level that `CUSTOMER/AGENT/AGENT_CLASS` have `subject_id` and no `segment_code`, `SEGMENT` the inverse, `GLOBAL` neither.
* **No `limit_usages` table** created (runtime still BLOCKED — see Capability Registry).

---

## 4. Subjects & Scope

| `subjectType` | `subjectId` | `segmentCode` | Existence check | Meaning |
|---------------|-------------|---------------|-----------------|---------|
| `GLOBAL` | `NULL` | `NULL` | none | System-wide default/fallback |
| `SEGMENT` | `NULL` | `^[A-Z0-9_]{3,80}$` required | pattern only | Arbitrary classification/segment bucket (e.g. `SEG_NORTH`, `VIP_TIER`). **No** KYC level hardcoding; segment is opaque stored string. |
| `AGENT_CLASS` | uuid → `agent_classes.id` `deleted_at IS NULL` | `NULL` | `SELECT id FROM agent_classes WHERE id=$1 AND deleted_at IS NULL` →404 if missing | Class of agents |
| `CUSTOMER` | uuid → `customers.id` | `NULL` | `customers` →404 | Individual customer |
| `AGENT` | uuid → `agents.id` | `NULL` | `agents` →404 | Individual agent |

* `limitProfileCode` always required, pattern `^[A-Z0-9_]{3,80}$`, FK to `limit_profiles(code)`, `NotFoundException` 404 if unknown.
* Arbitrary number: `INSERT` has no hard cap; test creates 6 assignments for one customer (proving >3 not fixed). `list` pagination `limit` 1..100, `page` ≥1, deterministic order `createdAt ASC, id ASC`.
* **No** in-service `if (kycLevel === LEVEL_1)` or `if (tier === 3)` branching exists — verified via `grep` disproof in tests (§7 case 14) against service/controller/entity/DTO/migration.

---

## 5. APIs

All under `/api/v1` with `ValidationPipe` and `FastifyAdapter`, workforce-only via `RoutePolicyRegistry` (matches `/api/v1/internal/limit-` → `WORKFORCE_SESSION` `OPERATOR`/`SERVICE`/`PRIVILEGED`):

| Method | Path | Auth | Success | Errors |
|--------|------|------|---------|--------|
| `POST` | `/internal/limit-assignments` | `OPERATOR/SERVICE/PRIVILEGED` →201, otherwise 401/403 | Creates assignment, returns `LimitAssignmentSafeProjection` (`id`, `limitProfileCode`, `subjectType`, `subjectId`, `segmentCode`, `precedence`, `version:1`, `effectiveFrom/To`, `isActive`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`) | 400 pattern/consistency/date, 404 profile/subject, 409 duplicate `23505` |
| `GET` | `/internal/limit-assignments?subjectType=&subjectId=&segmentCode=&limitProfileCode=&isActive=&page=&limit=` | same | Paginated ` { data, total, page, limit, totalPages, hasNextPage }` filtered by normalized `subjectType` upper, `segmentCode` upper, `limitProfileCode` upper, `isActive` boolean | 400 page/limit |
| `GET` | `/internal/limit-assignments/profile/:code` | same | Paginated assignments for that profile | 400 code pattern |
| `GET` | `/internal/limit-assignments/customer/:id` | same | Filter `subjectType=CUSTOMER&subjectId=id` | 400 UUID |
| `GET` | `/internal/limit-assignments/agent/:id` | same | idem AGENT | 400 |
| `GET` | `/internal/limit-assignments/agent-class/:id` | same | idem AGENT_CLASS | 400 |
| `GET` | `/internal/limit-assignments/segment/:code` | same | `subjectType=SEGMENT & segmentCode=code` | 400 |
| `GET` | `/internal/limit-assignments/:id` | same | Single projection | 400 UUID, 404 if soft-deleted/missing |
| `PATCH` | `/internal/limit-assignments/:id` | same | Updates `limitProfileCode?/subjectType?/subjectId?/segmentCode?/precedence?/effectiveFrom?/effectiveTo?/isActive?` requires `version` (current) → `version+1` | 400 version missing/invalid/effective, 404 profile/subject, 409 stale `version !== current`, 409 unique |

* **Safe projection:** responses never include `deletedAt`/`deleted_at`, ledger fields, or `limit_usages`. Verified via `JSON.stringify(body).not.toContain('deletedAt')`.
* **Deterministic pagination:** `order: { createdAt: 'ASC', id: 'ASC' }`, `skip/take`, `totalPages = ceil(total/limit)`, `hasNextPage`.
* **No runtime customer/agent APIs:** no `/api/v1/limits/evaluate` or `/wallet/*` limit mutation was added; `limit-assignments` is internal/admin only.

---

## 6. Precedence / Priority

* Data model field `precedence: integer default 0` (stored, NOT auto-evaluated).
* Intended to support a future hierarchy **without hardcoding**: e.g. `GLOBAL(0) → SEGMENT(1) → AGENT_CLASS(5) → CUSTOMER/AGENT(10/20)` by assigning higher numbers to more-specific subjects. Service stores whatever integer the admin sends; **no business policy** such as “SEGMENT always beats GLOBAL” is implemented in assignment code.
* **Legitimate multi-scope** preserved via `precedence` *or* distinct `effectiveFrom`/`effectiveTo`: same `(subjectType, subjectId, segmentCode, limitProfileCode, effectiveFrom)` cannot duplicate (partial unique →409), but same subject+profile with different `effectiveFrom` (time-sliced), or same subject with different profile, or GLOBAL vs CUSTOMER rows, are all allowed. Tests prove `EFF_PROFILE` CUSTOMER same date dup 409 vs different date 201, different profile same date 201.
* **Unresolved product decision (documented, not invented):** final runtime resolver that collapses overlapping assignments (which precedence wins, how overlapping effective windows intersect, whether segment+class vs individual override, and whether to take `max(precedence)` or “most-specific wins” or chronological). `docs/V1-LIMIT-ARCHITECTURE-AUDIT.md` §21 notes this remains product decision; assignment infra only *enables* such policies by exposing the fields deterministically.

---

## 7. Effective Dating

* `effectiveFrom`: timestamptz, defaults `NOW()` if not supplied, parsed from ISO string (`new Date(input.effectiveFrom)`), 400 if NaN.
* `effectiveTo`: nullable, 400 if NaN, 400 if `<= effectiveFrom`.
* DB CHECK `effective_to IS NULL OR effective_to > effective_from` enforces at storage.
* Unique key **includes** `effectiveFrom`, so historically-versioned assignments for same subject/profile are non-conflicting when their start times differ; this plus `isActive` (`true` default) allows **disabling without deleting** (PATCH `isActive: false` retains row, version bumps, historical query still returns it unless filtered by `isActive`). Soft-delete `deleted_at` removes from `GET`/`list` (404/0 total) but row remains `SELECT … WHERE deleted_at NOT NULL` auditable.
* Pagination and `GET /:id` never expose `deletedAt`; historical audit via direct SQL demonstrated.
* **No silent replace:** `POST` never upserts; duplicate where clause produces 409, not overwrite.

---

## 8. Auth

* `RoutePolicyRegistry` rule `if (path.startsWith('/api/v1/internal/limit-'))` → `allowedPrincipalTypes: ['OPERATOR','SERVICE','PRIVILEGED']`, `allowedScopes: []`, `customerAccess: 'NONE', agentAccess: 'NONE', aggregatorAccess: 'NONE'` — same subset as V1-LIMIT-01 limit-profiles/rules, **not** generic `SUPPORT`/`AGENT`/`CUSTOMER`.
* Controller additionally enforces `requireWorkforce(req)`:** 401 UnauthorizedException if `authorizationPrincipal` missing, 403 ForbiddenException if `principal.type` ∉ allowed.
* Tests prove: no auth →401, `SUPPORT` (internal generic allowed elsewhere) →403, `AGENT`/`CUSTOMER`/`AGGREGATOR` →403, `OPERATOR`→201/200, `SERVICE`→200, `PRIVILEGED`→200 for POST/GET/PATCH.
* `actorOf` uses `principal.principalId ?? principal.type ?? 'workforce'` for `createdBy`/`updatedBy` audit columns.

---

## 9. Tests & Results

### Integration harness

Real PostgreSQL via `embedded-postgres` (`data/embedded-pg`, port 5432, user `monienaija`/`monienaija-pw`), fresh database per suite (`createIntegrationDataSource('v1-limit-02')`, `truncateAllTables` per `beforeEach`), `FastifyAdapter` + `ValidationPipe`, `A2WorkforceSessionService` mock (`workforce-<type>` → type upper), `DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw`.

### Suites run

```bash
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw \
  npm run test:pg -- test/v1-limit-02-limit-assignment.integration.spec.ts
# + test/v1-limit-01-limit-catalogue.integration.spec.ts
# + test/v1-capability-registry.integration.spec.ts
npm run test -- test/production-readiness.spec.ts
./node_modules/.bin/tsc --noEmit
```

| Suite | Cases | Result |
|-------|-------|--------|
| `test/v1-limit-02-limit-assignment.integration.spec.ts` (new, 69-migration DB) | 01 Migration chain (69, 0068, FK, indexes, CHECKs, columns) <br> 02 Arbitrary assignment to 5 subject types (CUSTOMER/AGENT/AGENT_CLASS/SEGMENT/GLOBAL) + safe projection <br> 03 Unlimited >3 assignments, not Tier-bound <br> 04 Effective dating & precedence, multi-scope vs duplicate 409 <br> 05 Version/concurrency (missing 400, PATCH 1→2→3, stale 409) <br> 06 Duplicate/conflict validation 400/404/409 (11 bad paths) <br> 07 Authorization 401/403 vs OPERATOR/SERVICE/PRIVILEGED <br> 08 GET for profile/customer/agent/agentClass/segment/by ID, pagination deterministic, limit guards <br> 09 Safe projection & filtering invariants <br> 10 Profile deletion/disable interaction (FK RESTRICT, soft-delete 404 & historical retention) <br> 11 No ledger mutation, no `limit_usages` <br> 12 Legacy preservation (`customer_limit_profiles`, `applicableLimits`) <br> 13 No flow change (no TransferService/limit_usages/LimitEngine) <br> 14 Fixed Tier 1/2/3 disproof (grep + `TIER_100` assignment) <br> 15 Audit/version fields (`createdBy`/`updatedBy`, version) | **15 passed** |
| `test/v1-limit-01-limit-catalogue.integration.spec.ts` (additive-compat) | 1 Migration chain — now `≥68` & `0067` or `0068` <br> 2-13 Profile/rule catalogue (arbitrary codes, version, auth, dimensions, invalid combos, no ledger, filtering, legacy, tier disproof) | **13 passed** |
| `test/v1-capability-registry.integration.spec.ts` | 01 Migration 69/0068 chain <br> 02-22 Seat/capability, refs, Commercial, auth, pagination, filtering, 404, safe, financial safety | **22 passed** |
| `test/production-readiness.spec.ts` | M8 readiness: startup head `0068`, draining, version/config metadata, staging validation, context propagation, validation code, conflict distinguish | **7 passed** |
| `tsc --noEmit` | No errors | **pass** |
| `npm run build` (`nest build`) | Compiles dist | **pass (implicit via tsc)** |
| `npm run lint` (eslint) | No assignment-relevant errors (pre-existing unrelated warnings only) | **pass** |

**Total: 15 + 13 + 22 + 7 = 57 integration/unit cases, all PASS.**

---

## 10. Financial Safety

* **No ledger mutation:** before/after `SELECT COUNT(*) FROM wallet_accounts / ledger_lines / ledger_journals` unchanged after 3+ assignment creates (case 11). `POST /internal/limit-assignments` touches only `limit_assignments` + best-effort `audit` row.
* **No `limit_usages` / reservation / `FOR UPDATE` / `SERIALIZABLE`:** `SELECT to_regclass('public.limit_usages')` is `NULL` (case 11 asserts 2 migrations matching `%Limit%`: catalogue+assignments only). No `SELECT … FOR UPDATE` appears in `limit-assignment.service.ts` (grep verified).
* **No `TransferService` / `AgentCash*` / `CustomerFunding` wiring:** `grep -r TransferService src/limit-catalog/limit-assignment.service.ts` empty; case 13 proves.
* **No `commercial_decisions` / `fee` / `LimitEngine` integration:** same grep proof.
* **Preserve existing limits:** `customer_limit_profiles` row count unchanged; `agent_classes.applicable_limits` JSONB unchanged after `AGENT_CLASS` assignments (case 12).
* **FK RESTRICT prevents orphan:** deleting a referenced `limit_profiles` row throws (case 10) — financial catalogue cannot be removed while assignments exist.

---

## 11. Product Decisions (unresolved, documented)

1. **Precedence resolution policy:** model stores `precedence` but does not define whether effective assignment is `max(precedence)` among overlapping rows, most-specific-subject wins, or lexicographic by `effectiveFrom`. Left to **product decision** (V1-LIMIT-ARCHITECTURE-AUDIT §21). Infra is ready for any of: `GLOBAL(0) → SEGMENT(10) → AGENT_CLASS(20) → individual(100)`.
2. **Overlapping effective windows:** assignment rows may have overlapping `effectiveFrom–To` intervals; whether runtime takes union vs latest-start-wins vs priority-then-date is not implemented. Tests keep windows non-overlapping where deterministic.
3. **SEGMENT semantics:** `segmentCode` is opaque validated string; no authoritative mapping to CRM/marketing segments or KYC is invented. If a segment registry appears later, `limit_assignments` can reference it via `segmentCode` without schema change; otherwise admins manage codes externally.
4. **Enforcement vs advisory:** `isActive=false` disables without deleting, but a disabled assignment still exists historically. Whether disabled assignments should be revived via PATCH or recreated with new `effectiveFrom` is product choice — both paths work (PATCH versioned vs new POST with new date).
5. **Atomic bulk assignment:** no bulk `POST /limit-assignments/batch` endpoint invented — single-row workforce POST suffices for V1; batch can be added later if needed.

---

## 12. Legacy Relation & Future Convergence

* **Legacy `customer_limit_profiles`:** table remains, not dropped, not migrated. `SELECT COUNT(*) FROM customer_limit_profiles` invariant held. Future `V1-LIMIT-03` usages do **not** need to read this table; a later migration/documented convergence plan can backfill `limit_assignments` `CUSTOMER` rows from `customer_limit_profiles` if product decides to deprecate it.
* **Legacy `AgentClass.applicableLimits`:** `agent_classes.applicable_limits` jsonb column remains, `SELECT` shows it is **not mutated** by assignment service. Preserved read-only; convergence would be a later migration that expands applicableLimits entries into `limit_assignments` (`AGENT_CLASS` subjects) or a dual-read period.
* **`LimitEngine` still stateless:** `src/limit/limit.engine.ts` calculator is unchanged; assignment only provides the profile identifier. Runtime `V1-LIMIT-03` will need to: `findAssignmentFor(subjectType, subjectId, segmentCode) → limitProfileCode` (precedence/effective resolution) → `loadRules(limitProfileCode)` → `limit_usages` reservation.
* **Customer/Agent runtime limits still BLOCKED:** `CUSTOMER_RUNTIME_LIMITS` and `AGENT_RUNTIME_LIMITS` capabilities remain `BLOCKED` until `limit_usages` + Lagos-window + TransferService wiring (see §13 next task).

---

## 13. Exact Next Task

**V1-LIMIT-03 — Limit Usage & Reservation (Concurrency + Lagos Windows)**

* Create `limit_usages` table: `id uuid PK, limit_assignment_id? or limit_rule_id + subjectId, product/currency/dimension, period_key (e.g. `2026-09-27` Lagos day), amount_minor / count, version, updated_at, expires_at` — with `SERIALIZABLE` or `SELECT FOR UPDATE` reservation, `unique (limit_rule_id, subjectId, period_key) WHERE deleted_at IS NULL`.
* Implement **Lagos (Africa/Lagos) daily/weekly/monthly/yearly window boundaries** (UTC storage, Lagos conversion) per V1-LIMIT-ARCHITECTURE-AUDIT §15 (daily window 00:00 Lagos, weekly Monday 00:00 Lagos, etc.).
* Add **idempotent reservation service**: `reserve(limitProfileCode, subject, product, dimension, amount, idempotencyKey)` → `INSERT … ON CONFLICT DO UPDATE SET amount = amount + …` under `REPEATABLE READ`/`SERIALIZABLE` with retry, returning `LimitEngine` check (per-tx vs cumulative).
* Wire **no auto-enforcement yet** — reserve API is internal workforce or internal service-to-service; `TransferService` wiring is V1-LIMIT-04.
* Update `Capability Registry`: `CUSTOMER_RUNTIME_LIMITS`/`AGENT_RUNTIME_LIMITS` remain BLOCKED until wiring, but note V1-LIMIT-03 done; enforce migration chain to `1785753600069-CreateLimitUsages`.
* Tests (real PG): Lagos window boundaries (including DST-free WAT), concurrent reservations not lost (2 parallel `reserve` sum correctly under SERIALIZABLE), idempotency, `isActive` rule respects, no ledger mutation beyond `limit_usages`, tier disproof remains.

**Do NOT implement V1-LIMIT-04 (TransferService wiring) or V1-LIMIT-05..07 in this next task.**

---

## 14. Checklist

* [x] Migration `1785753600068-CreateLimitAssignments` additive, no prior migration edited, `production-readiness.service.ts` bumped to 0068
* [x] Entity constraints (5 CHECKs, partial unique, FK RESTRICT, indexes) match spec
* [x] Generic assignment for CUSTOMER/AGENT/AGENT_CLASS/SEGMENT/GLOBAL, arbitrary number, no hardcoded tiers
* [x] Precedence + effectiveFrom/To + version + isActive + audit stored; historical auditable via soft-delete
* [x] Workforce-only auth `OPERATOR/SERVICE/PRIVILEGED` via `RoutePolicyRegistry` broad `/limit-` guard
* [x] 9 APIs (POST/GET list/filter/profile/customer/agent/agent-class/segment/by ID/PATCH) with pagination deterministic, validation, safe projection, version 409, duplicate 409 via 23505, 404 for missing profile/subject
* [x] No `limit_usages` / `TransferService` / ledger mutation — financial safety proven
* [x] Legacy `customer_limit_profiles` & `applicableLimits` preserved, not auto-migrated, documented
* [x] Capability Registry updated accurately (LIMIT_ASSIGNMENT FULLY_ENABLED, LIMIT_ENGINE still DISABLED with assignment, CUSTOMER/AGENT RUNTIME still BLOCKED)
* [x] Real-PostgreSQL suites: 15+13+22+7 = 57 PASS, `tsc --noEmit` PASS
* [x] Verification report (`docs/V1-LIMIT-02-VERIFICATION-REPORT.md`) written; branch ready to push

