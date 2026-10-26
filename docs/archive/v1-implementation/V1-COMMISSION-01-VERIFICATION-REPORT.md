# V1-COMMISSION-01 — Verification Report

**Task:** Commission Engine FOUNDATION for MonieNaija V1 — configurable commission machinery
only. Actual rates, bases, recipient allocation, eligibility policy, precedence policy, effective
dates policy and enablement remain UNCONFIGURED pending explicit product/accounting decisions.

**Branch:** `arena/01a0d883-monienaija` (base: `978088f` V1-COMMERCIAL-DECISION-03E).

---

## 1. Deliverables

| Artifact | Purpose |
| --- | --- |
| `src/migrations/1785753600073-CreateCommissionRules.ts` | Additive migration: `commission_rules` registry (zero rows seeded) |
| `src/commission/commission-rule.entity.ts` | TypeORM entity + vocabularies (7 models, 3 bases, 3 recipient types) |
| `src/commission/commission.calculator.ts` | Pure deterministic calculation mechanics (all 7 models) |
| `src/commission/commission-rule-resolver.service.ts` | Read-only per-recipient resolution: eligibility, windows, precedence, fail-closed ambiguity/base-unavailability |
| `src/commission/commission-rule-registry.service.ts` + `.controller.ts` | Workforce-only administration (GET/POST/PATCH, no DELETE), audited, optimistic-versioned |
| `src/commission/commission-rule-resolver.controller.ts` | Workforce-only read-only resolution diagnostic |
| `src/commission/commission.engine.ts` | Decision-representation facade → exact `commission_decision` snapshot shape |
| `src/commission/commission.module.ts` (+ `app.module.ts`, `route-policy-registry.ts`) | Module wiring + workforce route policy |
| `src/commercial-decision/commercial-decision.defaults.ts` | `commissionAllocated()` builder (NONE shape untouched) |
| `src/capability-registry/capability.seed.ts` | `COMMISSION_ENGINE` advanced honestly; new `COMMISSION_RULES` + `COMMISSION_RULE_RESOLVER` entries; notes-only updates on the three allocation capabilities |
| `test/v1-commission-01-commission-engine.integration.spec.ts` | 15-test real-PostgreSQL suite |
| `docs/V1-COMMISSION-01-COMMISSION-ENGINE-ARCHITECTURE.md` | Architecture + ledger analysis + 16-item unresolved policy register |
| 19 guard spec updates + `production-readiness.service.ts` | Migration head 0072 → **0073**, count 73 → **74** (consequence of the additive migration) |

## 2. Pre-meditation evidence (existing primitives reused, none duplicated)

- Rule registry mirrors `fee_rules` discipline (FK→`products.code`, bps over 10 000, effective
  window, priority, optimistic version, soft delete, audited workforce admin).
- Decision representation reuses the existing `commercial_decision_snapshots.commission_decision`
  JSONB contract (`NONE`/`ALLOCATED`, allocation keys) — **no snapshot schema change, no snapshot
  re-design, no mutation of historical snapshots**.
- Targeting reuses existing `agent_classes` / `agents` / `aggregators` identities (FK RESTRICT).
- Calculation reuses `src/common/money` bigint/bps conventions and FeeEngine floor/clamp order.
- Administration reuses workforce auth (`RoutePolicyRegistry`, OPERATOR/SERVICE/PRIVILEGED) and
  `AuditService`. No new capability/auth mechanisms.

## 3. Hard boundaries — verification statements and where proven

1. **ZERO production commission rules seeded** — registry starts empty in migration chain; assert
   in suite test 02 (`countRules == 0` post-catalogue seed).
2. **No commission charging** — engine has no posting path; flows do not reference it: test 02
   static-scans all seven flow services for `CommissionEngine`/`commission_rules` references
   (none); test 15 proves wallets/ledger/limit/snapshots unchanged after configuration+resolution.
3. **Flows unchanged, commission stays NONE** — empty-registry engine output is byte-equal to
   `commissionNone()` (test 02); full commercial-decision suites (01/02/03A–03E) re-run green
   (§5).
4. **NOT_CONFIGURED ≠ ZERO** — unconfigured → `status NONE`; explicit FIXED 0 → `ALLOCATED` with
   `amountMinor '0'` (test 13).
5. **No invented precedence policy** — highest `priority` wins; equal-priority ⇒ 409
   `COMMISSION_RULE_AMBIGUOUS` with rule ids (test 09). Scope hierarchy deliberately unhardcoded;
   documented unresolved (register #11).
6. **No invented allocation split** — concurrent AGENT/AGGREGATOR/PLATFORM rules deliver
   independent unrelated amounts (test 07).
7. **FEE/NET bases never fabricate fee evidence** — 400 `COMMISSION_BASE_UNAVAILABLE` without
   evidence; exact amounts with evidence (test 05).
8. **Immutability/history** — ALLOCATED decisions persist through the existing snapshot (same
   service, same JSONB columns) and snapshot UPDATE is rejected by trigger; rule updates are
   optimistic-versioned and audited (tests 08, 11, 12).
9. **Concurrent configuration safety** — identical concurrent creates → one 409; concurrent
   same-version updates → one 409 via explicit `WHERE version` predicate (test 11). *(The generic
   `repo.save()` optimistic lock was proven insufficient for this service's update path; the
   deterministic conditional UPDATE is the shipped mechanism — same observable contract as
   V1-COMMERCIAL-03's concurrent-winner test.)*
10. **Ledger** — no commission accounts created; required future account families (commission
    payable LIABILITY, commission expense/EXPENSE-or-contra, platform REVENUE) documented with
    rationale in architecture §10; A18 aggregator financial boundary respected (no aggregator
    balance inventing).
11. **Capability registry** — no capability marked enabled/configured; engine advanced to
    implemented-but-disabled evidence state only (§6).
12. **No reward engine, no fee charging, no VAT, no V2, no bank/provider integration, no E2E
    process audit** — none touched.

## 4. Test matrix coverage (real PostgreSQL, no mocks of persistence)

| Required by task | Covered in |
| --- | --- |
| fixed commission | test 03 |
| percentage commission | test 03 |
| minimum / maximum / min+max | test 03 |
| flat + percentage | test 03 |
| tiered/bracketed (marginal, per-bracket floor) | test 04 |
| PRINCIPAL base | tests 03/04/06/07 |
| FEE base (explicit evidence) / fail-closed | test 05 |
| NET base (explicit evidence) / fail-closed | test 05 |
| effectiveFrom/effectiveTo windows + historical `at` | test 08 |
| versioning + stale versions | tests 08/09/11 |
| disabled rules | test 08 |
| precedence | test 09 |
| ambiguity (fail closed) | test 09 |
| agent-class targeting | test 06 |
| agent targeting | test 06 |
| aggregator targeting | tests 05/06/07 |
| multiple allocation recipients | test 07 |
| zero/unconfigured distinction | tests 02/13 |
| historical rule resolution | test 08 (+ version capture in 12) |
| concurrent configuration safety | test 11 |
| immutability/history of decisions | test 12 |
| schema CHECK coherence + identity uniqueness | tests 01/10 |
| workforce-only administration + diagnostic | test 14 |
| no financial side effects | tests 02/15 |

All rule data in tests is synthetic TEST-ONLY; nothing is seeded by migrations or app seeds.

## 5. Verification results

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `nest build` | clean |
| ESLint changed files (14 src/module/migration/guard files + new spec) | **0 errors** (two resolver findings fixed: untyped-row stringification and assertion style) |
| Guard-edit specs baseline cross-check (`v1-capability-registry`, `v1-limit-01`, `migration-chain`) | 0 flagged lines inside diff hunks; only pre-existing baseline errors remain; counts unchanged-or-reduced after stash compare |
| New suite `v1-commission-01` | **15/15 passed** |
| Migration chain (real PG, empty → 74 migrations) | 15/15 passed |
| Commercial suites 02/03/04 | 49/49 passed |
| Decision suites 01/02/03A/03B | 53/53 passed |
| Decision suites 03C/03D/03E + a19 | 57/57 passed |
| Limit suites 01–04 | 77/77 passed |
| Capability registry suite | 22/22 passed |
| **Full integration suite (clean final run)** | **61/61 suites, 1309/1309 tests passed** |
| Unit suite (`npm test`) | 1764 passed / **2 pre-existing failures** in `external-reconciliation.service.spec.ts` (unchanged, unrelated — same failures predating this task) |

## 6. Capability Registry changes (accurate, nothing over-marked)

- `COMMISSION_ENGINE` v1→v2: lifecycle PLANNED→BACKEND_IMPLEMENTED; backendStatus
  PLANNED→BACKEND_IMPLEMENTED; apiStatus stays **NOT_EXPOSED** (the engine itself has no HTTP
  surface); **enabled stays false; configurationStatus stays NOT_CONFIGURED; blocker stays
  PRODUCT_DECISION** (actual policy absent); dependencies FEE_ENGINE →
  `['COMMISSION_RULES','COMMISSION_RULE_RESOLVER','PRODUCT_CATALOGUE']` (accurate: commission is
  independent of the fee engine; schema FK is products); implementation/migration/test/doc
  references added.
- `COMMISSION_RULES` (new v1): registry foundation — BACKEND_IMPLEMENTED, API_READY (workforce
  internal GET/POST/PATCH), enabled false, NOT_CONFIGURED, PRODUCT_DECISION blocker.
- `COMMISSION_RULE_RESOLVER` (new v1): read-only resolution + workforce diagnostic — same
  evidence state (BACKEND_IMPLEMENTED / API_READY / disabled / NOT_CONFIGURED).
- `AGENT_COMMISSION`, `AGGREGATOR_COMMISSION`, `PLATFORM_REVENUE_ALLOCATION`: stay
  PLANNED/PRODUCT_DECISION; notes clarified only (foundation exists, no policy configured).
- UIs all NOT_EXPOSED; **no capability marked enabled/configured**. Entry count 110 → 112.

## 7. Migration summary

- Added exactly ONE additive migration: `1785753600073-CreateCommissionRules`
  (`CREATE TABLE commission_rules` + indexes; **zero data seeds**).
- Migration count 73 → **74**; head name/timestamp updated in `production-readiness.service.ts`
  and the 19 migration-observant specs (list/chain/count guards), preserving their backward-
  compatibility accept-lists exactly as their authors designed (updates, not deletions).
- Existing financial tables untouched; existing migrations untouched.

## 8. Full-suite history & final result (transparency)

- Run 1 (intermediate, during development): 59/61 suites — 2 suites failed to compile because the
  run started while a lint-fix refactor of the resolver was mid-save (TS1109 transient); all 1272
  executed tests passed. State was fixed immediately (`tsc`+`nest build` clean, commission suite
  15/15 afterwards).
- Run 2: 1308/1309 — the single failure was the product-catalogue suite's same-version
  optimistic-concurrency race (`winners == 1`) under full-suite load: a **pre-existing** READ
  COMMITTED scheduling flake on an unmodified service (0 files of this task touch
  `src/product-catalog`); that suite passes 16/16 standalone, three consecutive times.
- **Run 3 (definitive): 61/61 suites, 1309/1309 tests — all green.**

## 9. Immediate next dependency (unchanged)

Next business dependency remains the **approved commercial pricing policy** (per-product
fee/commission/reward rules, precedence, currency and effective-date semantics). A later
controlled task may then wire `CommissionEngine.decideWithManager` into flows — never before the
unresolved policy register (architecture doc §12, items 1–16) is answered by product/accounting,
and never answered in code.
