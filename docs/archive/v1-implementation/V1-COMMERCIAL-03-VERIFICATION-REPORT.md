# V1-COMMERCIAL-03 — Fee Rule Schema Foundation: Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `d04bef7019f3371e6b51605e2849ede2285f1795` (V1-COMMERCIAL-02)
**Ending HEAD:** this task's commit (single commit on top of `d04bef7`)
**Migration count:** 72 → **73** (`1785753600000`–`1785753600072`); latest = `CreateFeeRules1785753600072`
**Verdict:** SCHEMA + ADMINISTRATION FOUNDATION IMPLEMENTED AND VERIFIED — **ZERO fee rules seeded, ZERO runtime wiring, ZERO rates invented.** V1 flows remain fee-free.

---

## 1. Files changed

**Created (9)**

| Path | Purpose |
|---|---|
| `src/migrations/1785753600072-CreateFeeRules.ts` | Additive migration: `fee_rules` table + constraints + identity index |
| `src/fee-rules/fee-rule.entity.ts` | `fee_rules` entity (VersionColumn optimistic locking, soft-delete column, CHECK parity) |
| `src/fee-rules/fee-rule-registry.service.ts` | Registry service: validated create/update, version checks, audit, safe projection |
| `src/fee-rules/fee-rule-registry.controller.ts` | Workforce-only `GET/POST/PATCH /api/v1/internal/fee-rules` |
| `src/fee-rules/fee-rules.module.ts` | Module registered in `AppModule` |
| `test/v1-commercial-03-fee-rule-schema.integration.spec.ts` | 14-test real-PostgreSQL suite |
| `docs/V1-COMMERCIAL-03-VERIFICATION-REPORT.md` | This report |

**Modified (24, all scoped):** `src/app.module.ts` (module registration), `src/authorization/route-policy-registry.ts` (route policy entry), `src/capability-registry/capability.seed.ts` (new FEE_RULES entry + FEE_ENGINE blocker text), `src/product-catalog/product-catalog-seed.service.ts` (reseed() TRUNCATE CASCADE — required once `fee_rules` references `products`), `src/production/production-readiness.service.ts` (expected head 0072), plus migration-guard assertions in 19 test files (latest-timestamp sets, head-name regexes, counts).

**NOT modified (git diff verified):** no flow service (transfer, cash-in/out, cash-to-cash, customer/agent funding), no limit source, no wallet/ledger code, no commercial-decision-snapshot code, no previous migration.

## 2. Schema design — `fee_rules`

```
fee_rules(
  id UUID PK,
  product_code VARCHAR(80) NOT NULL REFERENCES products(code) ON DELETE RESTRICT,
  currency VARCHAR(3) CHECK '^[A-Z]{3}$',
  flat_fee_minor BIGINT NULL CHECK >= 0,
  percentage_bps INTEGER NULL CHECK 0..10000,
  minimum_fee_minor BIGINT NULL CHECK >= 0,
  maximum_fee_minor BIGINT NULL CHECK >= 0,
  vat_bps INTEGER NULL CHECK 0..10000,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ NULL CHECK (effective_to IS NULL OR effective_to > effective_from),
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by, updated_by, version (>0), created_at, updated_at, deleted_at,
  CHECK (flat_fee_minor IS NOT NULL OR percentage_bps IS NOT NULL),          -- no parameter-less rules
  CHECK (min IS NULL OR max IS NULL OR min <= max)                            -- FeeEngine's own invariant
)
UNIQUE (product_code, currency, effective_from) WHERE deleted_at IS NULL      -- deterministic identity
+ indexes: product, currency, is_active, effective_from
```

Terminology preserved verbatim from the authoritative `FeeRule` contract (`src/fee/fee.types.ts`): flatFeeMinor / percentageBps / minimumFeeMinor / maximumFeeMinor / vatBps. All monetary values stored as BIGINT minor units (repository convention, `nullableBigintTransformer`).

### Integrity invariants (all DB-enforced, all proven by test 01)
- `product_code` must reference an existing `products.code` (FK RESTRICT → unknown product = `23503`).
- Monetary values ≥ 0; negative money rejected (`23514`).
- BPS values bounded `[0, 10000]` — **not an invented business limit**: 10000 = 100% is the `BASIS_POINTS` unit definition already established by `FeeEngine` (`const BASIS_POINTS = 10_000n`).
- `minimum_fee_minor <= maximum_fee_minor` when both present — the exact invariant FeeEngine enforces at calculation time.
- `effective_to > effective_from` when present.
- At least one pricing parameter required — ZERO/FREE is expressed *explicitly* as `flat_fee_minor = 0`.
- `version > 0`.
- Deterministic identity uniqueness: one live rule per `(product_code, currency, effective_from)`.
- No arbitrary business limits invented (no invented maximum percentage beyond the bps unit, no invented fee caps, no invented KYC/tier constraints).

### Relationship to `products.code`
`products.code` (V1-COMMERCIAL-02) is the FK target and the single canonical product identity. No second product-code system was created. Deleting/erasing a product that has rules is blocked by RESTRICT (deprecation is the catalogue's path anyway).

## 3. Pricing models

| Model | Expressible now | How |
|---|---|---|
| 1. ZERO/FREE | ✅ | `flat_fee_minor = 0` (explicit) |
| 2. FLAT | ✅ | flat only |
| 3. PERCENTAGE | ✅ | percentage only |
| 4. PERCENTAGE + MINIMUM | ✅ | percentage + minimum_fee_minor |
| 5. PERCENTAGE + MAXIMUM | ✅ | percentage + maximum_fee_minor |
| 6. PERCENTAGE + MIN + MAX | ✅ | all three |
| 7. FLAT + PERCENTAGE | ✅ | FeeEngine already sums both |
| 8. TIERED/BRACKETED | ⏸ deferred | **Documented:** not a row shape here; a future additive child table (`fee_rule_tiers` referencing `fee_rules.id`) will carry brackets. The identity uniqueness index does not obstruct this because tiers are child rows, not `fee_rules` rows. No pricing DSL introduced. |

Test 04 creates one rule per non-tiered model (synthetic test values only); test 05 proves `FeeEngine.calculate` consumes the stored parameters unchanged.

## 4. Eligibility / precedence — deliberately NOT modelled

Fee rules target **products only**. No KYC_LEVEL_1/2/3, no BASIC/PREMIUM/VIP, no agent-class names, no customer tiers, no hardcoded precedence numbers exist in this schema — none of those are authoritative repository structures yet. The repository's generic targeting pattern is `limit_assignments` (subject_type/subject_id/precedence separated from `limit_rules`); if fee eligibility is later needed, the analogous **separate fee-assignment/targeting table** is the consistent design. Documented, not duplicated: this task builds fee rules, not the resolver.

## 5. Versioning behavior

- Optimistic locking via `@VersionColumn` (repository convention shared by limit_rules/limit_profiles/products): every successful update bumps `version`; stale-version PATCH → `409`; concurrent writers → exactly one winner (test 08, real concurrency).
- **Identity is immutable on update** — `product_code`, `currency`, `effective_from` cannot change via PATCH; a different identity is a different rule. Only pricing parameters, `effective_to`, `priority`, `isActive` update.
- All administrative changes are audited (`audit_events`, entityType `FEE_RULE`, previous/new values) — historical admin changes remain explainable.
- Historical explainability for decisions: the Commercial Decision Snapshot practice (V1-COMMERCIAL-DECISION-01) captures `{ruleId, ruleVersion}` + effective values inside `fee_decision.ruleRefs`; test 13 records such a reference, then bumps the rule to v2, and proves the snapshot stays byte-identical. Snapshot schema/behavior untouched — no UPDATE/DELETE added.

## 6. Effective-date behavior

`effective_from` (defaults to now, settable — future-dated policy allowed) and `effective_to` (nullable open-ended window, must be after `effective_from`). The schema supports future-dated commercial policy **without any runtime activation**: nothing reads these dates in any flow. No business dates invented or seeded.

## 7. API routes & authorization

| Route | Method | Roles | Behavior |
|---|---|---|---|
| `/api/v1/internal/fee-rules` | GET | OPERATOR/SERVICE/PRIVILEGED | List; filters productCode/currency/isActive; deterministic ordering (productCode ASC, effectiveFrom ASC, id ASC); pagination ≤100/page; validation 400s |
| `/api/v1/internal/fee-rules/:id` | GET | same | Safe projection; UUID validation 400; unknown 404 |
| `/api/v1/internal/fee-rules` | POST | same | Create definition; product must exist (404 unknown), all invariants validated; duplicate identity → 409 |
| `/api/v1/internal/fee-rules/:id` | PATCH | same | `version` required; optimistic-lock 409; identity immutable |
| — | DELETE | — | **Does not exist (404)** — rules are deactivated (`isActive=false`) or ended (`effectiveTo`), never erased |

Authorization: RoutePolicyRegistry block for `/api/v1/internal/fee-rules` (WORKFORCE_SESSION, OPERATOR/SERVICE/PRIVILEGED) + controller defense-in-depth. Unauthenticated 401; CUSTOMER/AGENT/AGGREGATOR/SUPPORT 403 (all tested). No customer- or agent-facing fee administration exists. Safe projection carries rule-definition facts only; the schema holds no secrets, credentials or request hashes.

## 8. Seed data — NONE

`fee_rules` is created **empty** and stays empty: no seed service, no migration INSERTs, no test that leaves production policy behind (test suites run in dedicated per-process databases and truncate). Test 02 proves zero rules after bootstrap and all 7 products still `configurationStatus = NOT_CONFIGURED`. Products are not marked commercially enabled by this task.

## 9. Capability Registry changes

- **New entry `FEE_RULES`**: lifecycle/backend BACKEND_IMPLEMENTED, apiStatus API_READY, configurationStatus **NOT_CONFIGURED** (zero rules), `enabled: false`, dependencies ['PRODUCT_CATALOGUE'], blocker PRODUCT_DECISION documenting that rates/KYC pricing/agent-class pricing/VAT/precedence remain unapproved.
- **`FEE_ENGINE`**: statuses unchanged (lifecycle DISABLED, enabled false, NOT_CONFIGURED); only blocker text/notes/migrationReferences updated to state that the `fee_rules` schema now exists with zero rules and runtime charging stays disabled.
- **Untouched:** COMMISSION_ENGINE, REWARD_ENGINE and every other entry — nothing marked implemented merely because fee rules exist.

## 10. Tests — exact results (real PostgreSQL 18.4)

**New suite `test/v1-commercial-03-fee-rule-schema.integration.spec.ts` — 14/14 passed**, covering required areas: (01) migration/schema + product FK + DB-layer integrity; (03) valid creation; (01/03) negative values, min>max, effective-date integrity rejected; (07) version behavior; (03/06) product association; (06) duplicate/identity behavior; (09) workforce authorization; (10) safe projection; (07) administrative audit; (08) concurrent update/version protection; (02) no fee rules seeded; (04/05) pricing-model expressiveness + FeeEngine compatibility; (12) no financial mutation; (13) snapshot historical safety; (14) no runtime wiring (source-level proof across all 7 flow services).

| Suite / check | Result |
|---|---|
| v1-commercial-03 (new) | **14/14 pass** |
| Focused regression: commercial-02, commercial-decision-01, limit-01/02/03/05, capability-registry, migration-chain | **138/138 pass** |
| **Full integration run** | **53/53 suites, 1213/1213 tests pass** (was 52/1199 at `d04bef7`) |
| Migration chain (clean DB, all migrations) | pass — **73 migrations**, zero pending, entity↔schema consistent |
| Unit suite | 1764/1766 — the 2 failures are the pre-existing `external-reconciliation.service.spec.ts` failures present before this task (not hidden) |
| `tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| ESLint — every file created/modified by this task | **0 errors, 0 warnings** |
| ESLint — repository-wide | still failing with only pre-existing errors in untouched files (honest baseline; this task adds none) |

## 11. Proof of no financial mutation

Test 12 diffs `ledger_accounts`, `ledger_journals`, `ledger_lines`, `wallet_accounts`, `limit_usages`, `limit_reservations`, `commercial_decision_snapshots` row counts before/after create + update + list — byte-identical. Test 14 source-scans all seven flow services (transfer, cash-in, cash-out, cash-to-cash init/claim, customer funding, agent funding) and proves none references `FeeRuleRegistryService` or `fee_rules`. The full 1213-test integration run exercises every financial flow unmodified.

## 12. Proof that no production fee rules were seeded

Test 02 (bootstrap → `count(fee_rules) = 0`, all products NOT_CONFIGURED); migration 0072 contains no INSERT statements; no seed service exists in `src/fee-rules/`; the capability registry records configurationStatus NOT_CONFIGURED.

## 13. Unresolved product/accounting decisions

1. **UD-CD2 (carried):** actual fee rates, flat/percentage values, min/max caps per product — product/accounting decisions; nothing invented.
2. **UD-FR1:** KYC-level / agent-class / segment fee eligibility — requires the eligibility/targeting design (see §4) + product decisions.
3. **UD-FR2:** fee precedence semantics when effective windows overlap (priority exists as a column; the resolver's selection algorithm is future work).
4. **UD-FR3:** VAT treatment — `vat_bps` column exists per existing FeeRule terminology; no rate, no regulatory decision.
5. **UD-FR4:** tiered/bracketed pricing shape — deferred additive child table (§3).

## 14. Remaining dependencies (dependency order)

1. **Commercial Resolver foundation** — resolve "which fee rule applies for product X at time T" (read-only, no charging).
2. **Snapshot wiring (V1-COMMERCIAL-DECISION-02)** — record fee decisions inside flow SERIALIZABLE boundaries via `recordDecisionWithManager`, once policy exists.
3. **Runtime fee enablement** — only after approved rates + resolver + pilot gating (product decisions).

## 15. Recommended next task (exact)

**V1-COMMERCIAL-04 — COMMERCIAL RESOLVER FOUNDATION (read-only):** a workforce-exercised resolver service that, given `(product_code, currency, at)`, selects the applicable `fee_rules` row(s) by effective window + `is_active` + priority (deterministic, tie-safe), returns the resolved rule definition or `NOT_CONFIGURED`, and is tested against real PostgreSQL with synthetic rules — still with **zero production rules seeded, zero flow wiring, zero charging**. This consumes exactly the two foundations delivered (products.code + fee_rules) and unblocks snapshot wiring once commercial policy is approved.
