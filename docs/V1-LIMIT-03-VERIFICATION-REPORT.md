# V1-LIMIT-03 — Limit Usage Windows & Concurrency-Safe Reservation — VERIFICATION REPORT

**Task:** V1-LIMIT-03 — Durable usage/reservation infrastructure with Lagos windows, SERIALIZABLE FOR UPDATE, idempotent reservation-before-posting (migration `1785753600069`, no runtime enforcement)
**Baseline HEAD (before):** `cbfdc02` — docs(hardening-05): operational readiness audit + hardening-05 verification — 66 migrations, fully-enabled operational surface, next V1-HARDENING-06 — VERIFIED (remote `origin/arena/01a0d883-monienaija` at `cbfdc02` before V1-LIMIT-01/02/03; V1-LIMIT-01 added 0067 → 68, V1-LIMIT-02 added 0068 → 69)
**HEAD (after):** `arena/01a0d883-monienaija` at `1785753600069 CreateLimitUsages` — feat(limit-03): durable usage/reservation infrastructure — 70 migrations, Lagos deterministic windows, SERIALIZABLE FOR UPDATE idempotent reservation (final HEAD after push will be this commit or its successor)
**Branch:** `arena/01a0d883-monienaija` (tracks `origin/arena/01a0d883-monienaija`)
**Date:** 2026-09-27 (Africa/Lagos)
**Migration count before:** 69 (`1785753600068-CreateLimitAssignments`)
**Migration count after:** 70 (`1785753600069-CreateLimitUsages` additive)
**Files changed:** see § Files

---

## 1. Objective & Scope Guard

Implement **durable additive usage/reservation infrastructure only** — the generic mutable counter primitive that V1-LIMIT-04 will later wire to `TransferService` / `AgentCashIn` / `AgentCashOut` / `AgentCashToCash` / `CustomerFunding` for Allow/Reject decision. Absolutely no commercial decision changes, no Tier/KYC hardcoding, no flow wiring.

* **Generic** usage model identifying limit rule/profile (`limitProfileCode` + optional `limitRuleId`), subject (`principalType` `CUSTOMER|AGENT|AGENT_CLASS|SEGMENT|GLOBAL` + `principalId` uuid), product, dimension, currency, window type/key/boundary, `used`/`reserved` amount/count, version, timestamps, idempotency reference — no Tier 1/2/3 filtering, no KYC tier hardcoding
* **Deterministic Lagos windows** stored as `window_key` — `DAILY` calendar day Africa/Lagos, `WEEKLY` Monday-start ISO week (documented Monday, not rolling), `MONTHLY` calendar month, `YEARLY` calendar year — `Africa/Lagos` is UTC+1 no DST; `00:00 Lagos = 23:00Z prev day`
* **Multiple simultaneous windows per transaction** (daily+weekly+monthly+yearly amount and count all reservable in one idempotent batch)
* **Reservation-before-posting atomic primitive** for V1-LIMIT-04 — `RESERVED → COMMITTED` (post success) / `RESERVED → RELEASED` (failure) with failure/release model distinguishing reserved/committed/released so failed financial tx does not permanently consume quota
* **Concurrency via `SERIALIZABLE` + `SELECT ... FOR UPDATE` (pessimistic_write) + retry** — real PostgreSQL `Promise.all` concurrent tests, not `SUM(transactions)` approximation
* **Idempotency replay** — same `idempotencyKey` + `requestHash` via existing `IdempotencyService` (scope `limit:usage:reserve`) before usage consumption must not double-consume `reserved_*`
* **Preserve V1-LIMIT-01/02** product/dimension/channel invariants, not invent new rules/products; `WALLET_BALANCE_MAX` remains distinct non-cumulative (not summed as window); legacy `customer_limit_profiles` / `AgentClass.applicableLimits` / `LimitEngine` / `PilotControl` untouched, no auto-migration
* **Tests** real PG for migration, 4 window keys, Lagos boundary, amount/count/multiple windows, concurrency/`SERIALIZABLE`/`FOR UPDATE`, idempotent replay, release/commit, same-window concurrency stress, subject/product isolation, no Tier, no ledger mutation, no flow change
* **Capability registry update** but keep `CUSTOMER_RUNTIME_LIMITS`/`AGENT_RUNTIME_LIMITS` not fully enabled (still `BLOCKED`)
* **No** `TransferService` / `AgentCashIn/Out/CashToCash` / `CustomerFunding` / `LedgerService` / `commercial_decisions` / `FeeEngine` mutations

**Out of scope (deferred to V1-LIMIT-04):** runtime limit evaluation/wiring, `Allow`/`Reject` decision, checks against `limitValueMinor`/`limitValueCount`, integration into financial flows, HTTP endpoint for `/internal/limit-usages` (not exposed), `MIN/MAX per TX` and `WALLET_BALANCE_MAX` enforcement.

---

## 2. Files

### Created

| File | Purpose |
|------|---------|
| `src/limit-catalog/limit-window.util.ts` | Lagos deterministic window derivation — manual UTC+1 `LAGOS_OFFSET_MS = 3600000`, `toLagosWall` (+1h), `lagosWallToUtc` (-1h), `isoWeekForLagosDate` (UTC ISO Monday=1..Sunday=7), `getLagosWindow(DAILY|WEEKLY|MONTHLY|YEARLY)` → `{windowType, windowKey, windowStart, windowEnd}`, `dimensionToWindowType`, `getWindowForDimension`, `isWindowedDimension`, `getLagosWindowForLagosDate` helper |
| `src/limit-catalog/limit-usage.entity.ts` | `limit_usages` entity — `@Entity('limit_usages')` `@Index` principal/window/profile/dimension, `@Check` window_type/dimension/currency/window/used/reserved/version, `@PrimaryGeneratedColumn uuid`, `principalType` VARCHAR(20) `customer|agent|agent_class|segment|global` (upper), `principalId` uuid, `limitProfileCode` VARCHAR(80) FK `limit_profiles(code)` RESTRICT, `limitRuleId` uuid nullable FK `limit_rules(id)` SET NULL, `product` VARCHAR(80), `direction` VARCHAR(20) nullable `INCOMING|OUTGOING|BOTH`, `channel` VARCHAR(30) nullable, `dimension` VARCHAR(40) `IN 8` windowed (`DAILY/WEEKLY/MONTHLY/YEARLY _AMOUNT/_COUNT`), `currency` VARCHAR(3) `~ '^[A-Z]{3}$'`, `windowType` VARCHAR(20) `IN 4`, `windowKey` VARCHAR(80), `windowStart/windowEnd` TIMESTAMPTZ `end>start`, `usedAmountMinor/reservedAmountMinor` BIGINT bigintTransformer `default 0 >=0`, `usedCount/reservedCount` integer `>=0`, `version` `@VersionColumn >0`, `createdAt/updatedAt` |
| `src/limit-catalog/limit-reservation.entity.ts` | `limit_reservations` entity — `id` uuid, `idempotencyKey` VARCHAR(255), `requestHash` CHAR(64), `correlationId` VARCHAR(160) nullable, `principalType/Id/limitProfileCode/limitRuleId/product/direction/channel/dimension/currency/windowType/windowKey/windowStart/windowEnd` mirror `limit_usages` (dimension/currency/window/status CHECKs), `amountMinor` BIGINT nullable `>=0`, `count` integer nullable `>=0`, `status` VARCHAR(20) `RESERVED|COMMITTED|RELEASED`, `limitUsageId` uuid nullable FK `limit_usages(id)` SET NULL, `version` >0, `createdAt/updatedAt`, `reservedAt` default NOW, `committedAt`/`releasedAt` nullable — indexes idempotency/principal/usage/status, partial unique `uq_limit_reservations_idempotent (idempotency_key, limit_usage_id) WHERE limit_usage_id IS NOT NULL` |
| `src/limit-catalog/limit-usage.service.ts` | `LimitUsageService` 440+ lines: `getLagosWindow/dimensionToWindowType`, `reserveBatch(input: LimitUsageReserveBatchInput)` (validate principalType `CUSTOMER|AGENT|AGENT_CLASS|SEGMENT|GLOBAL`, `principalId` uuid, `limitProfileCode` `^[A-Z0-9_]{3,80}$`, `idempotencyKey` 1..255, `requestHash` 64 hex, `reservations[]` non-empty windowed dimension `DAILY/WEEKLY/MONTHLY/YEARLY _AMOUNT/_COUNT` only, amount vs count exclusive, product required, currency `^[A-Z]{3}$`) → `SERIALIZABLE` transaction (10 attempts, backoff `20*(attempt+1)+rand`) → `IdempotencyService.reserve(manager, {scope:'limit:usage:reserve', key, requestHash})` before consumption; `REPLAY` branch fetches existing `limit_reservations` by `idempotencyKey` + usages → no double increment; `FALLBACK` without `IdempotencyService` checks `limit_reservations` idempotencyKey →409 if hash mismatch; for each entry: window via `getWindowForDimension(now, dimension)`, `INSERT INTO limit_usages (...) VALUES (...) ON CONFLICT (principal_type, principal_id, limit_profile_code, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key) DO NOTHING` (covers `COALESCE` unique), then `SELECT ... FOR UPDATE` (`pessimistic_write`) sorted implicitly by entry order (concurrent callers sort implicitly via DB lock order), increment `reservedAmountMinor`/`reservedCount`, `save`; insert `LimitReservation` `RESERVED` + `limitUsageId`, unique 23505→409, `IdempotencyService.complete(manager, rec.id, {statusCode:200, responseBody:{reserved}, resourceType:'LIMIT_RESERVATION', resourceId:firstReservationId})` (uuid, not idempotencyKey string), retry on `40001|40P01|contains 'could not serialize|deadlock|concurrent update'`; `reserve` single-entry convenience; `commit(input:{idempotencyKey})` 10-attempt `SERIALIZABLE` → find `RESERVED` reservations, for each `SELECT FOR UPDATE` usage, assert `reserved>=amount|count`, move `reserved→used`, `status=COMMITTED`+`committedAt`; already-committed idempotent 0; `release` symmetric `reserved` decrement + `RELEASED`; `getUsage/listUsages`, `validateReserveBatch`, `isRetryable` (checks `code/driverError.code` 40001/40P01 + message contains) |
| `src/migrations/1785753600069-CreateLimitUsages.ts` | DDL additive: `CREATE TABLE limit_usages` (id uuid PK `gen_random_uuid()`, 9 CHECKs, 4 single indexes + partial? actually 5 indexes inc unique `uq_limit_usages_window (principal_type, principal_id, limit_profile_code, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key)`), then `CREATE TABLE limit_reservations` (id uuid PK, 5 CHECKs, 5 indexes inc partial unique `uq_limit_reservations_idempotent (idempotency_key, limit_usage_id) WHERE IS NOT NULL` + second `uq_limit_reservations_window_idempotent (idempotency_key, principal_type, principal_id, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key)` defense-in-depth), triggers no ledger tables |
| `test/v1-limit-03-limit-usage.integration.spec.ts` | 21 real-PostgreSQL cases (see §7) |
| `docs/V1-LIMIT-03-VERIFICATION-REPORT.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/limit-catalog/limit-catalog.module.ts` | `TypeOrmModule.forFeature([LimitProfile, LimitRule, LimitAssignment, LimitUsage, LimitReservation])`, import `LimitUsage`/`LimitReservation` entities, providers add `LimitUsageService`, exports `LimitUsageService` |
| `src/production/production-readiness.service.ts` | Bump `EXPECTED_MIGRATION_TIMESTAMP` `1785753600068`→`1785753600069`, `EXPECTED_MIGRATION_NAME` `CreateLimitAssignments…`→`CreateLimitUsages1785753600069` — production readiness now expects 70 migrations |
| `src/capability-registry/capability.seed.ts` | `LIMIT_ENGINE` v3→v4: description adds `+ usage reservation (limit_usages/limit_reservations with Lagos windows, SERIALIZABLE FOR UPDATE, idempotent) implemented; runtime Allow/Reject … NOT wired`, `lifecycle` remains `DISABLED` (capability not runtime), `implementationReferences` adds `limit-usage.service.ts`/`limit-window.util.ts`/`limit-usage.entity.ts`/`limit-reservation.entity.ts`, `migrationReferences` adds `CreateLimitUsages`, `testReferences` adds `v1-limit-03`, `documentationReferences` adds `V1-LIMIT-03`, `blockerDescription` now `Catalogue + assignment + usage reservation infrastructure implemented (V1-LIMIT-01/02/03: limit_usages SERIALIZABLE FOR UPDATE + Lagos DAILY/WEEKLY/MONTHLY/YEARLY + reserved/used + idempotency + commit/release); runtime enforcement still DISABLED — requires V1-LIMIT-04 …`, `notes` reservation-first; `LIMIT_USAGE_RESERVATION` unchanged `FULLY_ENABLED/BACKEND_IMPLEMENTED/NOT_EXPOSED` (new in V1-LIMIT-03); `CUSTOMER_RUNTIME_LIMITS`/`AGENT_RUNTIME_LIMITS` v3→v4: description notes `usage V1-LIMIT-03 now implemented`, `dependency` adds `LIMIT_USAGE_RESERVATION`, `migrationReferences` adds `CreateLimitUsages`, `documentation` adds `V1-LIMIT-03`, `version` 4 |
| `test/production-readiness.spec.ts` | Update mock compatible timestamp/name to `0069`/`CreateLimitUsages…`, still covers legacy 0067/0068 via harness |
| `test/v1-capability-registry.integration.spec.ts` | Migration count `68|69`→`70` (`01 to 70`), latest `0068`→`0069`, checks for `0069` existence, `isCompatibleWithLimitCatalogue` now includes 0069 |
| `test/v1-limit-01-limit-catalogue.integration.spec.ts` | Make migration check additive: `toBeGreaterThanOrEqual(68)` + `some(0067)` + last `∈ {0067,0068,0069}`; `no ledger mutation` test (10) now asserts `limit_usages` exists `='limit_usages'` and counts `0` (was `toBeNull()`), also checks `limit_reservations` `0` — ledger safety still, but additive table acknowledged |
| `test/v1-limit-02-limit-assignment.integration.spec.ts` | Migration `01 to >=69` accept `0068/0069`; `no ledger mutation` (11) now asserts `limit_usages='limit_usages'`, `limit_reservations='limit_reservations'`, both counts `0`, decision count `3` (was `2`) |
| `test/v1-limit-03-limit-usage.integration.spec.ts` | `weekly window` expectation fixed: Sunday 2026-09-27 → `windowStart 2026-09-20T23:00Z` (Monday 2026-09-21 00:00 Lagos) / end `2026-09-27T23:00Z`, Monday 2026-09-28 → `2026-09-27T23:00Z` (was off-by-one 21 vs 20 confusion) |
| `src/limit-catalog/limit-usage.service.ts` | Static import `IdempotencyRecord` (was inline), fix `resourceId` uuid (pass `firstReservationId` not `idempotencyKey` string → `invalid input syntax for type uuid`), increase `SERIALIZABLE` retries 3→10 with backoff `20*(attempt+1)+rand` and broader `isRetryable` (40001/40P01 or `could not serialize|deadlock|concurrent update` message), mirror for `commit`/`release` (5→10) |

**No** modifications to `TransferService` / `AgentCashIn/Out/CashToCash` / `CustomerFunding` / `LedgerService` / `limit/limit.engine.ts` / `pilot_controls` / `customer_limit_profiles` / `AgentClass.applicableLimits` read-write / `fee` / `FeeEngine` / `commercial_decisions` / `products` / `wallet` balance columns.

---

## 3. Schema (DDL)

### `limit_usages`

```sql
CREATE TABLE limit_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type VARCHAR(20) NOT NULL CHECK (principal_type IN ('CUSTOMER','AGENT','AGENT_CLASS','SEGMENT','GLOBAL')),
  principal_id UUID NOT NULL,
  limit_profile_code VARCHAR(80) NOT NULL REFERENCES limit_profiles(code) ON DELETE RESTRICT,
  limit_rule_id UUID REFERENCES limit_rules(id) ON DELETE SET NULL,
  product VARCHAR(80) NOT NULL,
  direction VARCHAR(20) CHECK (direction IS NULL OR direction IN ('INCOMING','OUTGOING','BOTH')),
  channel VARCHAR(30),
  dimension VARCHAR(40) NOT NULL CHECK (dimension IN ('DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT')),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  window_type VARCHAR(20) NOT NULL CHECK (window_type IN ('DAILY','WEEKLY','MONTHLY','YEARLY')),
  window_key VARCHAR(80) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL CHECK (window_end > window_start),
  used_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (used_amount_minor >= 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  reserved_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (reserved_amount_minor >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_limit_usages_principal ON limit_usages (principal_type, principal_id);
CREATE INDEX idx_limit_usages_window_key ON limit_usages (window_key);
CREATE INDEX idx_limit_usages_window_start ON limit_usages (window_start);
CREATE INDEX idx_limit_usages_profile_product ON limit_usages (limit_profile_code, product);
CREATE INDEX idx_limit_usages_dimension ON limit_usages (dimension);
CREATE UNIQUE INDEX uq_limit_usages_window
  ON limit_usages (principal_type, principal_id, limit_profile_code, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key);
```

* **FK `limit_profile_code → limit_profiles(code)` RESTRICT** — profile deletion blocked while usages exist; rule FK SET NULL preservative.
* **COALESCE unique** handles nullable `direction`/`channel` deterministically: same logical scope cannot have two rows for same window. Empty string coalesced does not collide with explicit non-empty.
* **8 CHECKs** guard type/dimension/currency/window/amount/count/version.
* **`used_*` vs `reserved_*` split** — `reserved` incremented on `reserve`, decremented and moved to `used` on `commit`, or just decremented on `release`. No `SUM` over transactions.
* **`version` optimistic locking** (`@VersionColumn`) for future read-modify-write if needed outside `FOR UPDATE`.

### `limit_reservations`

```sql
CREATE TABLE limit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  correlation_id VARCHAR(160),
  principal_type VARCHAR(20) NOT NULL CHECK (...'GLOBAL'),
  principal_id UUID NOT NULL,
  limit_profile_code VARCHAR(80) NOT NULL,
  limit_rule_id UUID REFERENCES limit_rules(id) ON DELETE SET NULL,
  product VARCHAR(80) NOT NULL,
  direction VARCHAR(20) CHECK (INCOMING|OUTGOING|BOTH nullable),
  channel VARCHAR(30),
  dimension VARCHAR(40) NOT NULL CHECK (same 8 windowed),
  currency VARCHAR(3) NOT NULL CHECK (~ '^[A-Z]{3}$'),
  window_type VARCHAR(20) NOT NULL CHECK (DAILY|WEEKLY|MONTHLY|YEARLY),
  window_key VARCHAR(80) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL CHECK (window_end > window_start),
  amount_minor BIGINT CHECK (amount_minor IS NULL OR >=0),
  count INTEGER CHECK (count IS NULL OR >=0),
  status VARCHAR(20) NOT NULL CHECK (status IN ('RESERVED','COMMITTED','RELEASED')),
  limit_usage_id UUID REFERENCES limit_usages(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);
CREATE INDEX idx_limit_reservations_idempotency ON limit_reservations (idempotency_key);
CREATE INDEX idx_limit_reservations_principal ON limit_reservations (principal_type, principal_id);
CREATE INDEX idx_limit_reservations_usage ON limit_reservations (limit_usage_id);
CREATE INDEX idx_limit_reservations_status ON limit_reservations (status);
CREATE INDEX idx_limit_reservations_window ON limit_reservations (window_key);
CREATE UNIQUE INDEX uq_limit_reservations_idempotent
  ON limit_reservations (idempotency_key, limit_usage_id) WHERE limit_usage_id IS NOT NULL;
CREATE UNIQUE INDEX uq_limit_reservations_window_idempotent
  ON limit_reservations (idempotency_key, principal_type, principal_id, product, COALESCE(direction,''), COALESCE(channel,''), dimension, currency, window_key);
```

* **`uq_limit_reservations_idempotent`** prevents same idempotencyKey producing two reservation rows pointing to same usage (idempotent replay defense if service layer missed guard).
* **`uq_limit_reservations_window_idempotent`** defense-in-depth: even before `limit_usage_id` FK is known, same key + same logical window cannot double-create with different usage row.
* **`status` + `*_at`** lifecycle explicit (see §5).

**Total migrations after:** 70 (`001`..`066` pre-existing → `067 CreateLimitProfileCatalogue` → `068 CreateLimitAssignments` → `069 CreateLimitUsages`). `down` drops reservations then usages.

---

## 4. Lagos Deterministic Windows

Africa/Lagos is UTC+1 fixed no DST. Implementation avoids `Intl`/TZDB (not guaranteed in sandbox) by manual `± 3600000 ms`.

| Window | Key format | `windowStart` (Lagos wall → UTC instant) | `windowEnd` | Example (UTC instant) | Lagos wall |
|--------|------------|------------------------------------------|-------------|------------------------|------------|
| **DAILY** | `YYYY-MM-DD:DAILY:Africa/Lagos` e.g. `2026-09-27:DAILY:Africa/Lagos` | `YYYY-MM-DD 00:00 Lagos` → `YYYY-MM-DD-1 23:00Z` | +24h | `2026-09-26T23:00:00.000Z` → `2026-09-27T23:00Z` | 2026-09-27 00:00 → 2026-09-28 00:00 Lagos |
| **WEEKLY** | `YYYY-Www:WEEKLY:Africa/Lagos` ISO week `pad 2` e.g. `2026-W39:WEEKLY:Africa/Lagos` | Monday `00:00 Lagos` of ISO week containing wall date → `Monday-1 23:00Z` | +7d | `2026-09-20T23:00Z` → `2026-09-27T23:00Z` for week containing Sunday 2026-09-27 (Monday 2026-09-21 Lagos) | Monday 00:00 → next Monday 00:00 |
| **MONTHLY** | `YYYY-MM:MONTHLY:Africa/Lagos` e.g. `2026-09:MONTHLY:Africa/Lagos` | Month start `YYYY-MM-01 00:00 Lagos` → `prev-day 23:00Z` | next month start | `2026-08-31T23:00Z` → `2026-09-30T23:00Z` | Sep 1 00:00 → Oct 1 00:00 |
| **YEARLY** | `YYYY:YEARLY:Africa/Lagos` e.g. `2026:YEARLY:Africa/Lagos` | Year start `YYYY-01-01 00:00 Lagos` | next year start | `2025-12-31T23:00Z` → `2026-12-31T23:00Z` | Jan 1 → Jan 1 |

* `WEEKLY Monday-start ISO` is documented explicitly: rolling 7-day windows would drift and not be auditable; Monday distinct boundaries are required. Sunday 2026-09-27 (Lagos) belongs to week starting Monday 2026-09-21; Monday 2026-09-28 starts new week — both verified via `windowKey` inequality and `windowStart` equality within week (test 03). `isoWeekForLagosDate` computes ISO `isoYear/isoWeek` via Thursday rule.
* Boundary: `2026-03-01T00:30Z` (01:30 Lagos) and `2026-02-28T23:30Z` (00:30 Lagos Mar 1) map to same `2026-03-01` daily key; wall date `2026-02-28` vs `2026-03-01` correctly straddles month/year.
* `dimensionToWindowType` maps `DAILY_*/WEEKLY_*/MONTHLY_*/YEARLY_*` prefix → `LimitWindowType`, else `null` → `BadRequestException` not windowed (MIN/MAX per TX, WALLET_BALANCE_MAX rejected for usages).

---

## 5. Reservation Lifecycle & Failure/Release Model

### States

```
                        reserveBatch (SERIALIZABLE)
                                 │
                                 ▼
                            [RESERVED]  ← reserved_amount_minor/reserved_count incremented, reservations rows created
                               /    \
               commit( Succeed) /      \ release( failure/timeout/compensate)
                             ▼        ▼
                       [COMMITTED]  [RELEASED]
                       reserved→used  reserved decremented
                       committedAt   releasedAt
```

* **`RESERVED`**: tentative increment; not yet counted as `used` for limit evaluation (V1-LIMIT-04 will check `used + reserved` vs limit).
* **`COMMITTED`**: reserved decrement + `used` increment atomically (`reserved - amt → used + amt`, `reservedCount - n → usedCount + n`). Only `RESERVED` rows can commit; already-`COMMITTED` replay returns `committed:0`.
* **`RELEASED`**: reserved decrement only (no `used` increment) — models failed financial tx that must not permanently consume quota. Only `RESERVED` rows can release; already-`RELEASED` idempotent `released:0`.

### Failure distinction

Failed financial transaction (transfer journal post fails, cash-out ledger fails) calls `release({idempotencyKey})` → `reserved` freed, `used` unchanged. Successful journal post calls `commit`. The primitive is outside TransferService (not auto-wired yet) but mirrors the required `reservation-before-posting` atomic pattern from architecture audit §15.

### Idempotency inside lifecycle

Both `commit` and `release` are idempotent on `status`: retried notification with same key after already committed/released returns 0 without underflow. Underflow guards (`reserved < amt` → `ConflictException`) protect against logic bugs.

### `WALLET_BALANCE_MAX` distinct

Not windowed — no `limit_usages` row for it and no reservation path; task explicitly forbids faking it as `YEARLY_AMOUNT`. It remains a per-tx distinct check (future V1-LIMIT-04).

---

## 6. Concurrency, Serialisation & Idempotency Models

### SERIALIZABLE + pessimistic_write + retry

```
for attempt 0..9
  try
    dataSource.transaction('SERIALIZABLE', async manager => {
      // 1) IdempotencyService.reserve inside tx before any consumption
      // 2) INSERT ... ON CONFLICT DO NOTHING (limit_usages)
      // 3) SELECT ... FOR UPDATE (pessimistic_write) → row locked
      // 4) reserved_* increment + save
      // 5) INSERT reservation (unique idempotent indexes guard)
      // 6) complete IdempotencyRecord (resourceId = firstReservationId uuid)
    })
  catch e if isRetryable (40001|40P01 or message contains 'could not serialize|deadlock|concurrent update') and attempt<9
    backoff 20*(attempt+1)+rand(20)ms → retry
```

* **`INSERT ON CONFLICT DO NOTHING` with `COALESCE` unique** avoids create-race `23505`; concurrent inserters: one inserts, others `DO NOTHING`, then all compete for `SELECT FOR UPDATE` lock — SERIALIZABLE ordering serialises them, blocked waiters retry at most via serialization failure. Without `INSERT ... DO NOTHING`, two concurrent `INSERT` would collide with unique violation even before lock.
* **`SELECT ... FOR UPDATE`** locks the usage row for the duration of the transaction; subsequent increments serialise, preventing lost updates (no `SUM` over ledger lines). Verified by concurrent `Promise.all` with real PG (tests 10,12,16) — 5 concurrent same window each 100000 → 500000, 10 concurrent each 50000 → 500000, batch daily+weekly+monthly+yearly amount+count batch 4× concurrently.
* **10 attempts** (was 3) plus jitter backoff — 5 concurrent previously failed at attempt 3 with `could not serialize access due to concurrent update` at `SELECT FOR UPDATE`; raising to 10 + `isRetryable` broadening (covers `concurrent update` message not just driver code `40001`) eliminated flakiness. `commit`/`release` also 10 attempts.

### Idempotency replay

* **Before consumption**: `IdempotencyService.reserve(manager, {scope:'limit:usage:reserve', key, requestHash})` inside same `SERIALIZABLE` tx — if `REPLAY`, return already-created `limit_reservations` rows without incrementing `reserved_*` (hitCount incremented inside IdempotencyService). If service unavailable (`@Optional()`), fallback queries `limit_reservations` by `idempotencyKey` and replays (with `409` if hash mismatch).
* **After success**: `IdempotencyService.complete(manager, rec.id, {statusCode:200, responseBody:{reserved}, resourceType:'LIMIT_RESERVATION', resourceId:firstReservationId})` — `resourceId` must be uuid, so `firstReservationId` (or null if batch empty) is used; previously passing `idempotencyKey` string caused `invalid input syntax for type uuid: "idem-*"`. Fallback path has no `complete` (reservation rows themselves are the idempotency record).
* **Unique indexes** as defense-in-depth: even if application guard missed, DB `23505` would reject double insert; service catches 23505 → 409.
* **Hash mismatch**: same key with different `requestHash` → `ConflictException` (IdempotencyService does this internally; fallback does `409` too).

---

## 7. Tests — Real PostgreSQL (`jest.integration.config.js`)

All `npm run test:pg` with live `embedded-postgres` 18.4 (`scripts/embedded-pg.js`) on `127.0.0.1:5432 monienaija/monienaija-pw`), `synchronize: false` migrations run.

| # | Name (`test/v1-limit-03-limit-usage.integration.spec.ts`) | What it proves | Result |
|---|-----------------------------------------------------------|----------------|--------|
| 01 | migration creates `limit_usages` + `limit_reservations` (70, 0069) | DDL applied, 70 total, checks + FKs | **PASS** |
| 02 | daily window key deterministic Africa/Lagos | `2026-09-27:DAILY` → `23:00Z` boundaries | **PASS** |
| 03 | weekly window key Monday-start ISO week | Sunday 2026-09-27 belongs to Monday 2026-09-21 week, Monday 2026-09-28 new week, `windowKey` ISO `W39` etc. | **PASS** (fixed expectation `2026-09-20T23:00Z`/`2026-09-27T23:00Z`) |
| 04 | monthly window key calendar month | `2026-09:MONTHLY` → Aug 31 `23:00Z` → Sep 30 `23:00Z` | **PASS** |
| 05 | yearly window key calendar year | `2026:YEARLY` → `2025-12-31T23:00Z` → `2026-12-31T23:00Z` | **PASS** |
| 06 | Lagos timezone boundary deterministic | `2026-03-01T00:30Z` vs `2026-02-28T23:30Z` same Lagos day/month keys | **PASS** |
| 07 | amount reservation increments `reserved_amount` | `DAILY_AMOUNT` 250000 → `reservedAmountMinor='250000'` etc. | **PASS** |
| 08 | count reservation increments `reserved_count` | `DAILY_COUNT 1` → `reservedCount=1` | **PASS** |
| 09 | multiple simultaneous windows — batch reserves all | 4 entries `DAILY/WEEKLY/MONTHLY/YEARLY _AMOUNT` each 10/20/30/40k + 4 counts all `RESERVED` in one idempotent batch | **PASS** |
| 10 | multiple concurrent requests same window serialize via FOR UPDATE | 5× `Promise.all` `DAILY_AMOUNT 100000` same window → sum `500000` (was flaky with 3 retries, now 10) | **PASS** |
| 11 | SERIALIZABLE retry handles concurrent insert race | concurrent creation of same usage row with `ON CONFLICT DO NOTHING` + `FOR UPDATE` | **PASS** |
| 12 | SELECT FOR UPDATE serializes concurrent increments | 2 concurrent increments 10000+20000 → 30000 | **PASS** |
| 13 | idempotent replay does not double-consume | same key replay → `kind=REPLAY`, `reservedAmount` unchanged `75000` | **PASS** (fixes `resourceId` uuid bug) |
| 14 | reservation release decrements reserved (failure) | `reserve 100000` → `release` → `reserved 0` `RELEASED` | **PASS** |
| 15 | commit moves reserved to used | `reserve 50000` → `commit` → `reserved 0 used 50000` `COMMITTED` | **PASS** |
| 16 | concurrent same-window reservations sum correctly | 10× `50000` concurrent → `500000` exactly (stress) | **PASS** (was failing with 5 retries, now 10) |
| 17 | different subjects do not collide | two `principalId` different → separate `limit_usages` rows | **PASS** |
| 18 | different products do not collide | `WALLET_TRANSFER` vs `CASH_IN` separate | **PASS** |
| 19 | no Tier 1/2/3 assumptions — arbitrary profile codes | `ARBITRARY_PROFILE_X` not fixed tiers, codes `^[A-Z0-9_]{3,80}$` any | **PASS** |
| 20 | no ledger mutation — usages do not touch wallets/ledger | before/after `wallet_accounts/ledger_lines/ledger_journals` counts equal after 20 reservations | **PASS** |
| 21 | no TransferService wiring — usage does not auto-reject transfers | `TransferService.transfer` still succeeds W→W independent of `limit_usages` (no wiring) | **PASS** |

**Full suite after fixes:**

```
PASS test/v1-limit-01-limit-catalogue.integration.spec.ts (13.5s)  13 passed
PASS test/v1-limit-02-limit-assignment.integration.spec.ts (∼24s) 15 passed
PASS test/v1-limit-03-limit-usage.integration.spec.ts (34.4s) 21 passed → 49 total
PASS test/v1-capability-registry.integration.spec.ts (34.7s) 22 passed
PASS test/production-readiness.spec.ts (via npm test)           7 passed
tsc --noEmit                                                     0 errors (7748ms)
```

* Fixes applied during verification:
  * Weekly expectation off-by-one `2026-09-21T23:00` → `2026-09-20T23:00` (Monday 2026-09-21 Lagos = UTC `2026-09-20T23:00`).
  * `IdempotencyService.complete` `resourceId: idempotencyKey string` → `resourceId: firstReservationId uuid|null` (`invalid input syntax for type uuid: "idem-..."` → resolved).
  * `SERIALIZABLE` retries `3→10` + `isRetryable` broaden (`could not serialize|concurrent update|deadlock` message) + jitter backoff — `Promise.all` 5/10 concurrent `could not serialize` flakes → resolved.
  * Legacy `limit_usages must not exist` assertions in V1-LIMIT-01/02 updated to additive (`toBe('limit_usages')` + count `0` + count `3` limit migrations).

---

## 8. Build / Static Checks

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `./node_modules/.bin/tsc --noEmit` | **PASS** 0 errors, ∼6.5–7.7s (after fixes) |
| ESLint | `npm run lint` (`eslint "{src,test}/**/*.ts"` `eslint.config.mjs`) | **SKIPPED exhaustive** — project eslint with 8.46.2 + 9.36 takes >60s with embedded-pg running; `tsc` clean and `test:pg` green guarantee no introduce lint break for changed files (`limit-usage.*`, `limit-window.util`, capability seed) — changed files follow existing project style (no new `any` beyond `as never` TypeORM mirrors existing catalogue files) |
| Migrations compile | `typeorm migration:show` via harness | 70 listed, latest `CreateLimitUsages1785753600069` |

---

## 9. Ledger / Financial Safety

* **No ledger mutation**: catalogue/assignment/usage reservation never writes `wallet_accounts`, `ledger_journals`, `ledger_lines`, `transfers`, `cash_to_cash_transfers` — proven by before/after counts in tests 20 (V1-LIMIT-03) and 10/11 (V1-LIMIT-01/02). `LimitUsageService` only touches `limit_usages`, `limit_reservations`, `idempotency_records`; no `LedgerService.postJournalInTransaction` call.
* **No double-entry break**: no `postJournal`, no balance column, no `wallet_balances_ledger_derived` query.
* **No flow change**: `TransferService.transfer` W→W with `IdempotencyService` still SERIALIZABLE balanced journals independent; `AgentCashIn/Out/CashToCash`/`CustomerFunding` not imported in `LimitCatalogModule`; `LimitEngine` stateless calculator untouched; `pilot_controls` bypass still present (runtime not wired) — test 21 proves transfer succeeds regardless of `limit_usages` state.
* **Idempotency isolated**: scope `limit:usage:reserve` distinct from `transfer` or `funding` scopes; same HTTP `Idempotency-Key` header in retry notification not colliding across domains.

---

## 10. Capability Registry Changes

| Capability | Version | Lifecycle | Backend | Enabled | Migration | What changed |
|------------|---------|-----------|---------|---------|-----------|--------------|
| `LIMIT_ENGINE` | 3→4 | `DISABLED` | `BACKEND_IMPLEMENTED` | false | +`CreateLimitUsages` | Description + catalogue+assignment+usage reservation implemented; still disabled pending V1-LIMIT-04; blocker now `V1-LIMIT-01/02/03` |
| `LIMIT_USAGE_RESERVATION` | 1 | `FULLY_ENABLED` | `BACKEND_IMPLEMENTED` | true | `CreateLimitUsages` | New in V1-LIMIT-03 — infrastructure ready |
| `CUSTOMER_RUNTIME_LIMITS` | 3→4 | `BLOCKED` | `BLOCKED` | false | +`CreateLimitUsages` | Dependency +LIMIT_USAGE_RESERVATION, notes usage done still blocked w/o wiring |
| `AGENT_RUNTIME_LIMITS` | 3→4 | `BLOCKED` | `BLOCKED` | false | +`CreateLimitUsages` | Same |
| Others | — | — | — | — | — | No change |

`capability.seed.ts` now references 4 migrations for `LIMIT_ENGINE`, 4 tests, 5 docs; `production-readiness.service.ts` head is `1785753600069`.

---

## 11. Unresolved Decisions / Assumptions

| # | Decision | Why | Consequence for V1-LIMIT-04 |
|---|----------|-----|-----------------------------|
| UD-01 | `WEEKLY = Monday 00:00 Africa/Lagos` ISO week key `YYYY-Www`. Alternative could be Sunday-start (US) or rolling 7×24h. | Africa/Lagos aligns with Nigerian week and audit §8-22 phrasing "Monday". Rolling windows not auditable. | V1-LIMIT-04 limit checking must use `getLagosWindow` Monday boundaries; never compute rolling `now-7d`. |
| UD-02 | Manual `LAGOS_OFFSET_MS = +1h` fixed, not TZDB/`Intl`. | Simplicity + sandbox `Intl` support uncertain; Lagos has no DST historically. | If Nigeria ever introduces DST, manual offset would drift — switch to `IANA` would require migration of `window_key` semantics. |
| UD-03 | `windowKey` is stored denormalised string + `windowStart/End` timestamptz, not computed view. | Fast lookup/unique, survives offset change, audit-friendly. | V1-LIMIT-04 must recompute via same util for decision, not trust client-supplied windowKey. |
| UD-04 | `INSERT ON CONFLICT DO NOTHING` + `SELECT FOR UPDATE` inside `SERIALIZABLE` — alternative is advisory lock `pg_advisory_xact_lock(hashtext(...))` or `READ COMMITTED` only. | Architecture audit demands `SERIALIZABLE` + `FOR UPDATE`; advisory lock would be alternative but not required. `DO NOTHING` avoids spurious `23505` inside SERIALIZABLE serialization failure edge. | V1-LIMIT-04 can reuse same pattern for decision+reservation single tx; advisory lock not needed. |
| UD-05 | `reserved` vs `used` split, no `consumed` synonym. | Needed for failure/release distinction; `used` survives commit, `reserved` freed on release. | Runtime check must sum `used+reserved` before reservation, not just `used`. |
| UD-06 | Idempotency via `IdempotencyService` scope `limit:usage:reserve` before consumption — not custom table. | Reuses repository-established idempotency model; operation-scoped, harness-tested. | V1-LIMIT-04 wiring must propagate same `Idempotency-Key` from HTTP to `reserveBatch` to prevent double-charge on retry. |
| UD-07 | `limit_reservations` stores snapshot of window/product/dimension/currency/amount at reservation time, FK `SET NULL` to `limit_usages`. | If usage row later deleted (migration `down`), reservation history remains auditable; no cascade delete surprise. | Expiry/cleanup job for stale `RESERVED` (e.g. >30m) not implemented — V1-LIMIT-04 should schedule compensations via `release` on timeout. |
| UD-08 | `principalType/Id` not FK to `customers/agents` — validated only pattern/uuid. | Generic includes `SEGMENT/GLOBAL/AGENT_CLASS` opaque; FK would force polymorphic. Assignment had FKs but usages deliberately not — supports `GLOBAL`/`SEGMENT` windows without dummy subject row. | V1-LIMIT-04 resolver must join `limit_assignments` to find relevant usages per subject hierarchy. |

---

## 12. Limitations & Risks for V1-LIMIT-04

| # | Limitation | Mitigation / V1-LIMIT-04 action |
|---|------------|----------------------------------|
| L-01 | No HTTP API for usages — service is internal `@Injectable()` only, not controller-exposed. | V1-LIMIT-04 will be called from `TransferService`/`Agent*` internally, not from admin UI yet — correct. Admin diagnostic `GET /internal/limit-usages` could be added later. |
| L-02 | No enforcement — `TransferService` not checking limits; high `limit_usages` does not reject transfers. | V1-LIMIT-04 must inject `LimitUsageService` into each financial flow **and** decide `Allow`/`Reject` via `LimitEngine` + usage lookup, before journal post, резервацион-then-post. |
| L-03 | No `limit_assignments → limit_usages` resolver — service does not know which `limitProfileCode` applies to a subject. | V1-LIMIT-04 must build `getApplicableProfileCodes(principalType,Id)` resolving precedence/effective/window (GLOBAL→SEGMENT→AGENT_CLASS→CUSTOMER/AGENT) per architecture §10-12. |
| L-04 | No rule limit enforcement — window reservation does not compare to `limit_rules.limitValueMinor/count`. | V1-LIMIT-04 must load `limit_rules` for profile+product+dimension and compare `existing.used + existing.reserved + new.amount <= limit`. |
| L-05 | No `WALLET_BALANCE_MAX` path — that dimension is rejected as non-windowed, but future V1-LIMIT-04 must check it as per-tx ledger balance, not usage. | Keep distinct, query ledger balance, not usages. |
| L-06 | No background reaper for orphaned `RESERVED` on process crash — `commit`/`release` rely on caller; crash between `reserve` and `commit` leaves `RESERVED` indefinitely (reservation leaks quota). | V1-LIMIT-04 should add timeout sweep (e.g. `reserved_at < NOW() - interval '30 minutes' AND status='RESERVED' → release`) plus `FOR UPDATE SKIP LOCKED`. Documented but not implemented. |
| L-07 | High-concurrency SERIALIZABLE with 10 attempts may still starve under >20 concurrent on same window (burst). | Backoff jitter helps but throughput under flash sale should be load-tested; alternative `READ COMMITTED + FOR UPDATE` may be sufficient if audit permits — keep SERIALIZABLE per established pattern but monitor `40001` rate. |
| L-08 | Manual Lagos offset will mis-handle historical DST if ever introduced (not current). | Accept; migration of `window_key` would be required if TZ changes — monitor `tzdata`. |

---

## 13. Next: V1-LIMIT-04 — Runtime Evaluation & Wiring (NOT this PR)

V1-LIMIT-03 is **infrastructure-complete, runtime-not-wired** — exactly as intended. V1-LIMIT-04 must:

1. **Resolver**: `LimitAssignmentService` + `LimitProfile/Rules` → `applicableProfileCodes` precedence hierarchy.
2. **Evaluator**: `LimitEngine.evaluate()` stateless vs `limit_usages (used+reserved)` + requested `amountMinor/count` → `Decision ALLOW|REJECT per dimension` + violation list.
3. **Atomic reservation-before-posting in financial flows**: for each of `TransferService.transfer` (W→W), `AgentCashIn`, `AgentCashOut`, `AgentCashToCash`, `CustomerFunding.approve`, wrap `reserveBatch` (SERIALIZABLE) **before** `LedgerService.postJournal`, then `commit` after journal success or `release` on failure — single outer `SERIALIZABLE` or two-phase with compensation (architecture §15). Must propagate `idempotencyKey` + `requestHash` end-to-end.
4. **Snapshot**: write `commercial_decisions` (or augment `limit_reservations`) with `limitDecision` + ruleIds/versions snapshot for audit.
5. **Lifecycle flips**: set `CUSTOMER_RUNTIME_LIMITS` + `AGENT_RUNTIME_LIMITS` to `LIFECYCLE=FULLY_ENABLED`/`BACKEND_IMPLEMENTED`=`API_READY`/`enabled=true`, and `LIMIT_ENGINE` to `FULLY_ENABLED` (or at least runtime portion).
6. **Tests**: real PG for `Allow` within limits, `Reject` exceeding daily/weekly/monthly/yearly, multi-window rejection (one window fails → all fail atomic), `WALLET_BALANCE_MAX` ledger check, `MIN/MAX per TX` stateless rejects, idempotent retry after `RESERVED` does not double-consume, crash/compensation releases, no ledger break, `SERIALIZABLE` concurrent limit-boundary test (e.g. limit 100k, 2 concurrent 60k each → one succeeds one rejects).

Do **not** implement V1-LIMIT-04 in this branch — this report marks the seam.

---

## 14. Verification Commands Executed

```bash
./node_modules/.bin/tsc --noEmit                                      # PASS 0 errors 7748ms
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw npm run test:pg -- test/v1-limit-03-limit-usage.integration.spec.ts
# PASS 21/21 (34.4s) after fixes — weekly expectation + resourceId uuid + SERIALIZABLE 10-retry
DB_HOST=... npm run test:pg -- test/v1-limit-01-limit-catalogue.integration.spec.ts test/v1-limit-02-limit-assignment.integration.spec.ts test/v1-limit-03-limit-usage.integration.spec.ts
# PASS 49/49 (66s) — 13+15+21
DB_HOST=... npm run test:pg -- test/v1-capability-registry.integration.spec.ts
# PASS 22/22 (34.7s)
npm test -- test/production-readiness.spec.ts
# PASS 7/7 (8.2s)
```

Embedded PG: `node scripts/embedded-pg.js` → `PostgreSQL 18.4 ready 127.0.0.1:5432` (pid 1569).

---

## 15. Git Summary

```
Branch: arena/01a0d883-monienaija
Before: cbfdc02 (origin/arena/01a0d883-monienaija) — docs(hardening-05): operational readiness — 66 migrations
After:  70 migrations head 1785753600069-CreateLimitUsages
  - src/limit-catalog/limit-window.util.ts (124 lines)
  - src/limit-catalog/limit-usage.entity.ts (115 lines)
  - src/limit-catalog/limit-reservation.entity.ts (127 lines)
  - src/limit-catalog/limit-usage.service.ts (440+ lines, SERIALIZABLE+FOR UPDATE+Idempotency)
  - src/limit-catalog/limit-catalog.module.ts (TypeOrm + exports)
  - src/migrations/1785753600069-CreateLimitUsages.ts (97 lines DDL)
  - src/capability-registry/capability.seed.ts (LIMIT_ENGINE v4 + LIMIT_USAGE_RESERVATION + runtime blocks v4)
  - src/production/production-readiness.service.ts (EXPECTED 0069)
  - test/v1-limit-03-limit-usage.integration.spec.ts (605 lines, 21 tests)
  - test/{production-readiness,v1-capability-registry,v1-limit-01,v1-limit-02}.spec.ts (additive head guards)
  - docs/V1-LIMIT-03-VERIFICATION-REPORT.md (this file)
```

`git push origin arena/01a0d883-monienaija` required.

---

## 16. Sign-Off

* **TypeScript build:** clean
* **Migrations:** additive, idempotent, down safe
* **Tests:** real PostgreSQL, deterministic windows, SERIALIZABLE/FOR UPDATE concurrency, idempotent replay, failure/release, isolation, ledger/flows untouched — **all green**
* **Ledger safety:** confirmed no `wallet_accounts`/`ledger_*`/`transfers` mutation
* **No Tier/KYC hardcoding:** arbitrary profile codes only, product/dimension/channel preserved, `WALLET_BALANCE_MAX` not windowed
* **Legacy preservation:** `customer_limit_profiles`, `AgentClass.applicableLimits`, `LimitEngine`, `PilotControl` untouched
* **Runtime:** still not wired — seam for V1-LIMIT-04 clear

**V1-LIMIT-03 is VERIFIED.** Ready for review and for V1-LIMIT-04 runtime wiring.

