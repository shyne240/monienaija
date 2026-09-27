# V1-COMMERCIAL-04 — Fee Rule Resolution Foundation: Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `2b1e58a3fce1673a4d6b471042a75d87d4536685` (V1-COMMERCIAL-03)
**Final HEAD:** this task's commit (single commit on top of `2b1e58a`)
**Migration count:** **73 — UNCHANGED.** Inspection found no schema deficiency: every matching condition (product, currency, active, soft-delete, effective window, priority) is already expressible on `fee_rules`. No migration was required and none was added.
**Verdict:** READ-ONLY RESOLUTION FOUNDATION IMPLEMENTED AND VERIFIED — zero calculation, zero charging, zero flow wiring, zero seeded rules. V1 remains fee-free.

---

## 1. Files changed (5; git status verified minimal)

| Path | Change | Purpose |
|---|---|---|
| `src/fee-rules/fee-rule-resolver.service.ts` | created | `FeeRuleResolverService` — deterministic read-only resolution contract |
| `src/fee-rules/fee-rule-resolver.controller.ts` | created | workforce-only read-only diagnostic route |
| `src/fee-rules/fee-rules.module.ts` | modified | registers resolver service + controller, exports service |
| `src/capability-registry/capability.seed.ts` | modified | new `FEE_RULE_RESOLVER` entry; `FEE_RULES` notes/blocker text (version 1→2, statuses unchanged) |
| `test/v1-commercial-04-fee-rule-resolver.integration.spec.ts` | created | 19-test real-PostgreSQL suite |

**NOT touched (diff verified):** no migration files, no flow services (transfer, cash-in/out, cash-to-cash, funding), no wallet/ledger/limit code, no commercial-decision-snapshot code, no FeeEngine (`src/fee/`), no route policy (the existing `/api/v1/internal/fee-rules` prefix rule already covers the new diagnostic path).

## 2. Resolver contract

```ts
FeeRuleResolverService.resolve(input: {
  productCode: string;
  currency?: string;   // defaults to 'NGN' — exact match only, no conversion
  at?: Date | string;  // evaluation timestamp; defaults to now; past timestamps first-class
}): Promise<FeeRuleResolution>

FeeRuleResolution =
  | { status: 'RESOLVED';      productCode; currency; evaluatedAt; rule: { ruleId, ruleVersion, flatFeeMinor, percentageBps, minimumFeeMinor, maximumFeeMinor, vatBps, effectiveFrom, effectiveTo, priority } }
  | { status: 'NOT_CONFIGURED'; productCode; currency; evaluatedAt }          // no applicable rule — normal V1 state, never an exception
  | { status: 'AMBIGUOUS';      productCode; currency; evaluatedAt; ambiguousRuleIds: string[] (sorted ASC); ambiguousPriority }
```

`resolveWithManager(manager, input)` is also exposed (mirrors the `LimitProfileResolverService` convention) so a future flow integration can resolve inside its own SERIALIZABLE transaction. Both variants are strictly read-only.

**Version semantics:** the result carries the exact applicable row — `ruleId` + `ruleVersion` + fee parameters + effective window — selected in the SAME single query. There is no second "current state" lookup after selection, so historical resolutions stay explainable and the result contains everything the Commercial Decision Snapshot practice needs later (`ruleId`, `ruleVersion`, parameters). Snapshot code was not modified.

## 3. Authoritative matching conditions (all required)

- `product_code` exact match (authoritative `products.code` identity — no second catalogue)
- `currency` exact match (USD/GBP/EUR never match an NGN rule; no conversion)
- `is_active = true`
- `deleted_at IS NULL` (soft-deleted rules ignored)
- `effective_from <= at AND (effective_to IS NULL OR at < effective_to)`

### Effective-date convention (single, documented)
**`effective_from <= at < effective_to`** for bounded rules — the exact convention already established by `LimitProfileResolverService` (`effective_from <= $1 AND (effective_to IS NULL OR $2 < effective_to)`). A rule without `effective_to` is open-ended. No other time interpretation exists.

### Priority convention (preserved, not invented)
**Highest priority wins.** This is the repository's established convention: `LimitProfileResolverService` selects `ORDER BY precedence DESC`, and the fee_rules migration already documents that "overlapping windows are resolved later by priority/effective dates." Lower number does NOT win.

### Tie/ambiguity behavior (critical safety property)
If two or more applicable rules share the highest priority, **no approved business tie-break exists, so none is invented.** The resolver returns an explicit deterministic `AMBIGUOUS` result listing the conflicting rule ids sorted ASC (the sort only makes the ambiguity report deterministic — it never selects a winner). No silent selection by physical order, UUID order, createdAt, or `LIMIT 1`. Documented deviation from `LimitProfileResolverService` (which tie-breaks by `effective_from DESC, created_at DESC` for limits): for commercial pricing the brief explicitly forbids silent tie-breaks, because the resolver must never make commercial policy by accident.

## 4. Historical resolution behavior

Pure function of the `at` parameter — tested with windowed rules v1 `[T1, T2)` and v2 `[T2, ∞)`:
- `at < T1` → `NOT_CONFIGURED`
- `T1 <= at < T2` → v1 (exact row, version, parameters)
- `at >= T2` → v2 (seam included per `<=`)
- Mutating/deactivating the CURRENT rule never rewrites the historical window's answer (test 12 proves both).

## 5. NOT_CONFIGURED semantics and the ZERO distinction

- `NOT_CONFIGURED` = no applicable active fee rule exists. It is an expected answer (zero production rules today), returned as a value, never thrown.
- `NOT_CONFIGURED ≠ ZERO`: an approved zero-fee policy would be an explicit rule (`flat_fee_minor = 0`) that resolves as `RESOLVED` with `flatFeeMinor = '0'` (test 16 proves both branches). No such rule is seeded.
- Input validation follows existing conventions: malformed productCode/currency/at → `BadRequestException` (400); a syntactically valid product code absent from the catalogue resolves deterministically to `NOT_CONFIGURED` (no exception).

## 6. API surface & authorization

One workforce-only **read-only** diagnostic (no customer/agent surface, no quote endpoint, no CRUD duplication):

```
GET /api/v1/internal/fee-rules/resolve?productCode=&currency=&at=
```

- RoutePolicyRegistry: covered by the existing `/api/v1/internal/fee-rules` rule — `WORKFORCE_SESSION`, `OPERATOR/SERVICE/PRIVILEGED`; controller adds defense-in-depth checks (unauthenticated 401, CUSTOMER/AGENT/AGGREGATOR/SUPPORT 403 — all tested).
- Responses are safe projections of the resolution contract: `status`, identities, evaluatedAt, and (when RESOLVED) ruleId/ruleVersion/parameters/window/priority. AMBIGUOUS is a 200 carrying the explicit conflict report; NOT_CONFIGURED is a 200. No internal database details beyond rule-definition facts (no secrets exist in the schema).
- The static `resolve` segment takes routing precedence over the registry's parametric `fee-rules/:id` (find-my-way static priority; test 17 verifies both routes behave correctly).

## 7. Capability Registry changes

- **New `FEE_RULE_RESOLVER`**: BACKEND_IMPLEMENTED / API_READY / **NOT_CONFIGURED** / `enabled: false`; dependencies `['FEE_RULES', 'PRODUCT_CATALOGUE']`; blocker PRODUCT_DECISION (zero production rules; read-only; not wired; FEE_ENGINE stays runtime-disabled).
- **`FEE_RULES`**: statuses unchanged; blocker text/notes updated (version 1→2) to record that the registry is now consumed by the read-only resolver without schema change.
- **Untouched:** `FEE_ENGINE` (still DISABLED/enabled=false/NOT_CONFIGURED), COMMISSION_ENGINE, REWARD_ENGINE and every other entry. Commercial pricing is NOT marked configured or enabled anywhere.

## 8. Tests — exact results (real PostgreSQL 18.4)

**New suite `test/v1-commercial-04-fee-rule-resolver.integration.spec.ts` — 19/19 passed**, using synthetic test rows created through the registry service (production `fee_rules` remains empty). Coverage mapped to the required areas:

| # | Area | Test |
|---|---|---|
| 1 | no rules → NOT_CONFIGURED | 01 |
| 2 | product mismatch → NOT_CONFIGURED | 02 |
| 3 | currency mismatch (USD/GBP/EUR) | 03 |
| 4 | inactive rule ignored | 04 |
| 5 | soft-deleted rule ignored | 05 |
| 6 | effective_from boundary (inclusive) | 06 |
| 7 | effective_to boundary (exclusive) | 07 |
| 8 | open-ended rule | 08 |
| 9 | single applicable rule (+ manager variant) | 09 |
| 10–11 | multiple applicable / priority selection (highest wins) | 10 |
| 12 | same-priority ambiguity → explicit deterministic AMBIGUOUS | 11 |
| 13 | historical version resolution (+ no current-state leakage) | 12 |
| 14 | overlapping windows (distinct priority resolves, same priority ambiguous) | 13 |
| 15 | deterministic result (10× identical) | 14 (+ AMBIGUOUS determinism in 11) |
| 16 | safe failure: malformed 400 / unknown product NOT_CONFIGURED | 15 |
| 16b | NOT_CONFIGURED ≠ explicit zero rule | 16 |
| — | workforce authorization + HTTP diagnostics + route coexistence | 17 |
| 17–20 | no wallet/ledger/limit/reservation/snapshot mutation | 18 |
| — | zero-seed proof + no flow wiring (source-level) | 19 |

## 9. Regression results

| Suite | Result |
|---|---|
| V1-COMMERCIAL-02 Product Catalogue | PASS (within focused run) |
| V1-COMMERCIAL-03 Fee Rule Schema | PASS |
| Commercial Decision Snapshot (decision-01) | PASS |
| Limit suites 01 / 02 / 03 | PASS |
| Capability registry + migration chain | PASS |
| Focused regression total | **143/143 tests** |
| **Full integration suite** | **54/54 suites, 1232/1232 tests** (was 53/1213 at `2b1e58a`) |
| Unit suite | 1764/1766 — the 2 failures are the pre-existing `external-reconciliation.service.spec.ts` failures present before this task |
| `tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| ESLint — every file created/modified by this task | **0 errors, 0 warnings** |
| ESLint — repository-wide | still failing with only pre-existing errors in untouched files (honest baseline; this task adds none) |

## 10. Financial mutation proof

Test 18 snapshots row counts of `ledger_accounts`, `ledger_journals`, `ledger_lines`, `wallet_accounts`, `limit_usages`, `limit_reservations`, `commercial_decision_snapshots`, executes 75 resolution calls (RESOLVED / NOT_CONFIGURED / unknown-product paths), and asserts byte-identical counts. Test 19 source-scans all seven flow services proving none references `FeeRuleResolverService`/`resolveWithManager`, and scans the resolver source proving it contains no INSERT/UPDATE/DELETE statements. The full 1232-test integration run exercises every financial flow unmodified. The resolver writes nothing: one parameterized SELECT per call.

## 11. Zero-seed proof

Test 19 asserts `count(fee_rules) = 0` after a full application bootstrap and all 7 products `configurationStatus = NOT_CONFIGURED`. No seed code exists in the resolver module; no migration was added.

## 12. Unresolved commercial decisions (unchanged, carried forward)

- UD-CD2: actual fee rates, flat/percentage values, min/max caps — product/accounting.
- UD-FR1: KYC-level / agent-class / segment fee eligibility — separate assignment/targeting design.
- UD-FR2: tie-break policy for same-priority overlaps — **the resolver deliberately refuses to invent one (returns AMBIGUOUS)** until a business policy is approved.
- UD-FR3: VAT treatment and rates.
- UD-FR4: tiered/bracketed pricing shape (future additive child table).

## 13. Blockers

None for this foundation. The resolver resolves to NOT_CONFIGURED today by design (zero rules). Runtime fee charging additionally requires approved rates + snapshot wiring + product decisions — all out of scope and untouched.

## 14. Exact next dependency

**V1-COMMERCIAL-DECISION-02 — Snapshot wiring for commercial decisions:** record fee/limit/commercial decisions via `recordDecisionWithManager` inside the existing flow SERIALIZABLE boundaries, consuming `FeeRuleResolverService.resolveWithManager` so snapshots capture `ruleId` + `ruleVersion` + effective parameters at decision time. This MUST remain gated: with zero production rules it records NOT_CONFIGURED decisions only, and no charging occurs until approved rates exist. Alternatively, if product wants configuration tooling first: workforce administration of the first approved fee policies (still zero charging) — a product/accounting decision.
