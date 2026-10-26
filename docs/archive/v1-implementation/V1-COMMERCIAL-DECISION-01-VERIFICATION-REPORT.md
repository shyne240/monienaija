# V1-COMMERCIAL-DECISION-01 — Commercial Decision Snapshot Foundation: Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**HEAD before:** `24f43959ef3934244f66be62a1a64df91dc82653` (V1-LIMIT-06 audit doc)
**HEAD after:** this task's commit (single commit on top of `24f4395`)
**Migration count:** 70 → **71** (`1785753600000`–`1785753600070`); latest = `CreateCommercialDecisionSnapshots1785753600070`
**Verdict:** FOUNDATION IMPLEMENTED AND VERIFIED. Runtime wiring into the 8 financial flows is deliberately future work (V1-COMMERCIAL-DECISION-02).

---

## 1. Task & scope boundary

Establish the durable, immutable record of the **commercial decision** associated with a transaction — answering *"what commercial configuration and decisions were applied to this transaction?"* — for fee calculation, commission allocation, reward/cashback calculation, and the limit decision.

**Hard scope boundaries honored (nothing below was violated):**

- NO fee/commission/reward/VAT/cashback rates or product pricing were invented.
- NO fee-bearing transactions were enabled; V1 flows remain fee-free and were not modified.
- NO fee/commission/reward rule engines or calculations were implemented (none exist in the codebase; none were added).
- NO duplication of the authoritative limit system — the snapshot stores limit-decision *evidence* (profile code, rule IDs + versions, reservation/usage ids, failure code) and never touches `limit_usage`/`limit_reservations`.
- NO second ledger, NO second transaction boundary, NO wallet balances in the snapshot, NO secrets/PINs/OTPs.
- FEE ≠ COMMISSION ≠ REWARD ≠ REVENUE ≠ LIMIT remain five distinct concepts — five distinct JSONB columns; never collapsed into one "fee" field.
- Fee-free representations are first-class: `feeMinor = "0"` with status `NOT_CONFIGURED`, commission `NONE`, reward `NONE`, limit `NOT_EVALUATED`.

## 2. What was built

| Artifact | Path | Purpose |
|---|---|---|
| Migration 0070 | `src/migrations/1785753600070-CreateCommercialDecisionSnapshots.ts` | Additive table + CHECK constraints + immutability trigger |
| Entity | `src/commercial-decision/commercial-decision-snapshot.entity.ts` | Typed model (no `@VersionColumn` — rows are write-once) |
| Service | `src/commercial-decision/commercial-decision-snapshot.service.ts` | Idempotent recording (standalone SERIALIZABLE wrapper + in-manager variant), validation, read paths |
| Defaults | `src/commercial-decision/commercial-decision.defaults.ts` | Documented factories for the fee-free / none-configured shapes |
| Controller | `src/commercial-decision/commercial-decision-snapshot.controller.ts` | Read-only workforce API |
| Module | `src/commercial-decision/commercial-decision.module.ts` | Registered in `AppModule` |
| Route policy | `src/authorization/route-policy-registry.ts` | `/api/v1/internal/commercial-decision*` → WORKFORCE_SESSION, OPERATOR/SERVICE/PRIVILEGED |
| Readiness guard | `src/production/production-readiness.service.ts` | Expected head bumped to `1785753600070` / `CreateCommercialDecisionSnapshots1785753600070` |
| Integration suite | `test/v1-commercial-decision-01-snapshot.integration.spec.ts` | 27 tests, real PostgreSQL |

## 3. Schema — `commercial_decision_snapshots`

**Identity & context:** `id` (uuid PK), `idempotency_key` (unique, ≤255), `request_hash` (sha-256 fingerprint of the decision payload), `product`, `direction`, `channel`, `principal_type` (`CUSTOMER`/`AGENT`), `principal_id`, `currency` (`^[A-Z]{3}$`), `principal_amount_minor` (≥0), `transaction_reference`, `correlation_id`, `journal_id`, `decided_at`, `created_by`.

**Decision sections (validated JSONB, not opaque blobs):**

| Column | Allowed `status` set | Shape |
|---|---|---|
| `fee_decision` | `NOT_CONFIGURED` / `ZERO` / `APPLIED` / `WAIVED` | FeeEngine-compatible fields (`paymentType`, `currency`, `amountMinor`, `feeMinor`, `vatMinor`, `totalMinor`, `ruleRefs[]`) |
| `commission_decision` | `NONE` / `ALLOCATED` | `allocations[]` (beneficiaryType/Id, amountMinor, basis, ruleId, ruleVersion) + `ruleRefs[]`; `ALLOCATED` requires non-empty allocations |
| `reward_decision` | `NONE` / `GRANTED` | `grants[]` (beneficiaryType/Id, rewardType, amountMinor, basis, ruleId, ruleVersion) + `ruleRefs[]`; `GRANTED` requires non-empty grants |
| `limit_decision` | `NOT_EVALUATED` / `APPROVED` / `REJECTED` | `profileCode`, `assignmentId`, `failureCode` (required when `REJECTED`), `ruleRefs[]`, `reservationIds[]`, `usageIds[]` — evidence only, never counters |
| `revenue_decision` | `NULL` / `NONE` / `RETAINED` | reserved for the future retained-amount representation |

Enforced by CHECK constraints (`chk_commercial_decision_*_status`, `jsonb_typeof = 'object'`), mirrored by service-level validation with structured `COMMERCIAL_DECISION_INVALID` errors.

**Lifecycle & correction columns:** `decision_status` (`PENDING`/`FINAL`; `FINAL` requires `finalized_at`), `configuration_version`, `snapshot_schema_version` (1), `supersedes_snapshot_id` (self-FK, RESTRICT) + `superseded_reason` (required when superseding), standard audit columns.

**Indexes:** unique `idempotency_key`; partial unique `(product, transaction_reference) WHERE supersedes_snapshot_id IS NULL` (one ORIGINAL decision per reference; corrections allowed); lookup indexes on principal, product+decided_at, decision_status, journal_id.

## 4. Immutability model

- **Database layer:** `BEFORE UPDATE OR DELETE` trigger `trg_commercial_decision_snapshots_immutable` raises
  `commercial_decision_snapshots is immutable: UPDATE|DELETE is not permitted; corrections require a new compensating snapshot`.
  Verified by real-SQL UPDATE/DELETE attempts in tests (both rejected; rows byte-identical afterwards).
- **Application layer:** the service exposes only `recordDecision`, `recordDecisionWithManager`, `findById`, `findByReference`, `list` — no update/delete/soft-delete paths exist (asserted by reflection test).
- **Corrections:** a NEW row with `supersedes_snapshot_id` pointing at the original plus a mandatory `superseded_reason`. The original is untouched and stays retrievable by id; `findByReference` returns the most recently recorded row (latest = current decision). No correction engine was built (out of scope per brief).
- The entity deliberately has **no `@VersionColumn`** (TypeORM optimistic locking would issue UPDATEs, which the trigger must reject).
- TRUNCATE remains available for provisioning/test tooling (row triggers don't fire for TRUNCATE), consistent with repository conventions.

## 5. Idempotency & concurrency

- `idempotency_key` is unique. Recreating with the same key and an identical canonical decision fingerprint (`request_hash` = sha-256 of deterministic canonical JSON of product/principal/currency/amount/reference/all decision sections/config version/schema version) returns the existing row with `replayed: true`.
- Same key + different payload → `409 COMMERCIAL_DECISION_IDEMPOTENCY_CONFLICT` (no silent overwrite).
- Second ORIGINAL (non-superseding) row for the same `(product, transaction_reference)` → `409 COMMERCIAL_DECISION_REFERENCE_CONFLICT`.
- `recordDecision` runs in its own `SERIALIZABLE` transaction with up to 5 retries on 40001/40P01.
- `recordDecisionWithManager(manager, input)` is the **future in-flow wiring point**: it joins an existing SERIALIZABLE boundary (no second boundary), and a rolled-back flow rolls the snapshot back with it (verified). A defensive 23505 re-fetch covers callers that ever pass a non-serializable manager.

## 6. Rule & version model (historical explainability)

- Rule references are captured inside the JSONB sections as `{ ruleId, ruleVersion, dimension?, limitValueMinor?, limitValueCount?, ... }` — capturing the limit system's `limit_rules.version` / `limit_profiles.version` at decision time.
- The snapshot never looks up "current" rule state later: after a rule's value/version is changed, previously recorded snapshots still carry the original `ruleId + ruleVersion + limitValueMinor` (verified end-to-end).
- `configuration_version` records the commercial configuration generation at decision time.
- This is the smallest immutable representation consistent with the architecture: references + versions, not full rule copies.

## 7. API (read-only, workforce-only)

| Route | Roles | Notes |
|---|---|---|
| `GET /api/v1/internal/commercial-decision-snapshots` | OPERATOR/SERVICE/PRIVILEGED | Filters: `product`, `principalType`, `principalId`, `decisionStatus`; deterministic pagination (`decided_at DESC, id DESC`), `page`/`limit` (≤100), `{page, limit, total, totalPages, data}` envelope |
| `GET /api/v1/internal/commercial-decision-snapshots/:id` | OPERATOR/SERVICE/PRIVILEGED | UUID validation, 404 when absent |

- Route-policy entry: WORKFORCE_SESSION, `commercial-decision-snapshot` resource; controller repeats role checks as defense-in-depth; SUPPORT/CUSTOMER/AGENT/AGGREGATOR all denied (403), unauthenticated 401.
- **Safe projection:** `request_hash` is never returned by any read path; the schema contains no secrets surface at all.
- **No mutating routes exist** — POST/PATCH/DELETE all 404 (verified over HTTP).
- No customer-facing commercial history surface was built (explicitly out of scope).

## 8. Financial integration decision — FOUNDATION ONLY

Snapshot creation is **not yet wired** to live financial flows. The brief sanctions this: *"If snapshot creation is not yet wired to live financial flows, explicitly test the foundation independently and state that runtime commercial integration remains future work."*

Blockers to wiring (all product/policy decisions, none invented here):

1. Per-flow capture semantics — which correlation/journal identifiers each of the 8 flows records on success vs. failure, and at which point inside each SERIALIZABLE boundary the snapshot is written.
2. Commercial policy — fee/commission/reward rules do not exist yet; wiring meaningful `APPLIED`/`ALLOCATED`/`GRANTED` decisions requires them (separate product decisions).
3. Correction policy — when and how compensating snapshots are produced operationally.

The `recordDecisionWithManager` API was designed exactly for that future wiring: it joins the flow's existing SERIALIZABLE boundary, preserving idempotency, ledger atomicity, and limit-reservation atomicity with no second transaction boundary.

**Financial safety verified:** recording snapshots (including APPROVED limit-decision evidence with reservation/usage ids) leaves `ledger_accounts`, `ledger_journals`, `ledger_lines`, `wallet_accounts`, `limit_usages`, `limit_reservations`, `limit_profiles`, `limit_rules`, `limit_assignments` byte-count-identical (before/after table-count diff test); the limit system remains the sole usage authority.

## 9. Capability registry

`COMMERCIAL_DECISION_SNAPSHOT`: `PLANNED` → **`BACKEND_IMPLEMENTED`** (lifecycle + backend), apiStatus `API_READY`, `enabled: false`, configurationStatus `NOT_CONFIGURED`, implementation/migration/test/doc references populated, version 2, blocker retained as `PRODUCT_DECISION` describing that runtime wiring awaits commercial policy decisions.

**Not touched (per brief):** FEE_ENGINE, COMMISSION_ENGINE, REWARD_ENGINE remain exactly as audited — no engine runtimes marked enabled, no fee-bearing products enabled.

## 10. Tests (real PostgreSQL 18.4, no mocks of the database)

`test/v1-commercial-decision-01-snapshot.integration.spec.ts` — **27/27 passing**, covering every required area:

| # | Required area | Tests |
|---|---|---|
| 1 | Migration/schema + validated JSONB | 01, 02 |
| 2 | Snapshot creation | 03 |
| 3 | Unique tx/reference association | 16 |
| 4 | Product | 03, 16, 25 |
| 5 | Currency | 03, 07 |
| 6 | Principal amount | 03, 07 |
| 7 | Fee-free decision | 04 (NOT_CONFIGURED, feeMinor 0) |
| 8 | No commission | 05 |
| 9 | No reward | 06 |
| 10 | Approved limit decision | 08 |
| 11 | Rejected limit representation | 09 (+failureCode validation in 07) |
| 12 | Limit profile/rule/version refs | 08, 10 |
| 13 | Immutable behavior | 11, 12, 13 |
| 14 | Duplicate/idempotent creation | 14, 15 |
| 15 | Concurrent creation | 17, 18 |
| 16 | Safe projection | 24 |
| 17 | Authorization | 21, 22, 23, 26 |
| 18 | No wallet/ledger mutation | 03, 08, 09, 19, 20 |
| 19 | Historical explainability after rule/config changes | 10 |
| + | Corrections via superseding rows | 12 |
| + | In-manager SERIALIZABLE boundary (future wiring point) + rollback atomicity | 19 |
| + | Pagination/filters/read-only surface | 25, 26, 27 |

## 11. Verification results

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `npm run build` (nest build) | exit 0 |
| ESLint — all new/changed files in this task | **0 errors, 0 warnings** |
| ESLint — repository-wide | ~1,157 errors remain, all pre-existing on untouched files (baseline was already failing; this task adds none) |
| New integration suite | 27/27 pass |
| Full integration regression (real PG) | **51/51 suites, 1183/1183 tests pass** (baseline at HEAD-before: 1156; +27 new) |
| Unit suite | 1764/1766 — the 2 failures are the pre-existing `external-reconciliation.service.spec.ts` failures present before this task (not hidden) |
| Limit system regression | v1-limit-01/02/03/05 suites all pass; 8-flow authoritative/concurrency-safe/idempotent behavior unchanged (no limit source file modified) |

Guard updates required by adding migration 0070 (all made, all passing): production-readiness constants + its unit spec, `migration-chain` count 70→71, latest-timestamp sets + head-name regexes in a8/a17/a18/a19/a20/v1-001/v1-003/v1-005/v1-006/v1-007/v1-hardening-06/07/09, head assertions in v1-capability-registry and v1-limit-01/02/03.

## 12. Unresolved decisions / open items

1. **UD-CD1 (per-flow capture semantics):** exact correlation/journal id captured per flow, and capture-on-failure policy. → V1-COMMERCIAL-DECISION-02.
2. **UD-CD2 (commercial policy):** fee/commission/reward rules, rates, VAT treatment — product decisions; nothing invented here.
3. **UD-CD3 (correction workflow):** who may produce compensating snapshots and under which audit requirements (foundation supports it; no engine built, per brief).
4. **UD-CD4 (retention/archival):** snapshot retention horizon and archival policy.
5. **UD-11 carry-over (V1-LIMIT-06):** maker-checker remains a product decision — unchanged by this task.

## 13. V1 boundary

NGN, in-house only. Nothing in this task touches Wallet→Bank, NIBSS, Wema, Providus, NinePSB, cards, airtime, or any other V2/external surface.

## 14. Next task

**V1-COMMERCIAL-DECISION-02 — Wire snapshot capture into the financial flows.** Scope sketch (requires product decisions UD-CD1/UD-CD2 first): pick one pilot flow, call `recordDecisionWithManager` inside its existing SERIALIZABLE boundary with the flow's idempotency key + correlation id, capture the authoritative limit-decision evidence (rule ids/versions/reservation ids) from the live reservation result, keep `feeMinor=0`/`NOT_CONFIGURED` until commercial policy exists, and extend this suite with end-to-end flow assertions.
