# V1-REWARD-01 — Verification Report (Reward / Cashback Engine Foundation)

Date: 2026-09-28 (Africa/Lagos)
Base: `3a094ef` (V1-COMMISSION-01, pushed)
Scope: configurable Reward/Cashback Engine **machinery only** — ZERO policy configured,
zero runtime wiring, zero postings. Architecture: `docs/V1-REWARD-01-REWARD-ENGINE-ARCHITECTURE.md`.

---

## 1. Deliverables produced

| Artifact | Content |
|---|---|
| `src/migrations/1785753600074-CreateRewardRules.ts` | additive migration: `reward_rules` registry, 17 CHECKs, 4 FKs (products/customers/agent_classes/agents), partial unique identity index, 3 secondary indexes; **0 seed rows** |
| `src/reward/reward-rule.entity.ts` | entity + vocabularies (beneficiary CUSTOMER/AGENT, reward_type CASHBACK/BONUS/PROMOTION, bases PRINCIPAL/FEE/NET, 7 models, existing CustomerKycLevel reuse) |
| `src/reward/reward.calculator.ts` | pure deterministic mechanics: all 7 models, bigint bps floor division, FeeEngine clamp order, marginal tier ladder, fail-closed base resolution |
| `src/reward/reward-rule-resolver.service.ts` | read-only per-beneficiary-group resolver (+`resolveWithManager`): product/currency/active/window/NULL-or-equal targeting; highest-priority-wins; ties → `REWARD_RULE_AMBIGUOUS` 409; FEE/NET without evidence → fail-closed `REWARD_BASE_UNAVAILABLE` |
| `src/reward/reward-rule-registry.service.ts` + `.controller.ts` | workforce-only GET/POST/PATCH `/api/v1/internal/reward-rules` (no DELETE), audited, deterministic conditional-UPDATE optimistic locking (409 on race) |
| `src/reward/reward-rule-resolver.controller.ts` | workforce-only read-only `GET .../resolve` diagnostic |
| `src/reward/reward.engine.ts` / `reward.module.ts` / `reward.types.ts` | decision facade → exact existing snapshot `reward_decision` shape (grants + ruleRefs); `NONE` output byte-identical to `rewardNone()` |
| `src/commercial-decision/commercial-decision.defaults.ts` | + `rewardGranted()` (mirrors `commissionAllocated`; `rewardNone()` untouched); comment accuracy update only |
| `src/app.module.ts`, `src/authorization/route-policy-registry.ts` | module wiring; `/api/v1/internal/reward-rules` → WORKFORCE_SESSION (both classification blocks) |
| `src/capability-registry/capability.seed.ts` | REWARD_ENGINE → v2 (BACKEND_IMPLEMENTED / NOT_EXPOSED / disabled / NOT_CONFIGURED); + REWARD_RULES, + REWARD_RULE_RESOLVER (API_READY, disabled, NOT_CONFIGURED); CASHBACK notes-only (still PLANNED); entries 112 → **114** |
| `test/v1-reward-01-reward-engine.integration.spec.ts` | 16-test suite, real PostgreSQL |
| Migration-head guards | expected head `1785753600074`/`CreateRewardRules1785753600074` + count 75 across: `production-readiness.service.ts`, `production-readiness.spec`, `migration-chain` (75), `v1-capability-registry` (75 + 0074 + name), 16 whitelist specs (backward-compatible list/regex/if-else extensions) |

**Diff shape:** 31 files changed (12 new incl. docs), all additive or list extension;
no existing migration/flow/financial table modified.

## 2. Test evidence (real PostgreSQL 18.4, embedded)

```
test/v1-reward-01-reward-engine.integration.spec.ts ... PASS  16/16
```

Coverage of the task's required matrix: fixed ✓(03) percentage ✓(03) min ✓(03)
max ✓(03) min+max ✓(03) fixed+percentage ✓(03) tiered/bracketed ✓(04, marginal,
per-bracket floor) PRINCIPAL ✓(03-04) FEE ✓(05, evidence-only) NET ✓(05)
fee-evidence-absent fail-closed ✓(05) effective dates ✓(08) versioning ✓(08,
stale→409) disabled rules ✓(08) ambiguous rules ✓(09, 409) precedence ✓(09,
deterministic disambiguation) eligibility targeting ✓(06: customer, KYC level from
the EXISTING enum — invented levels rejected, agent, agent class, campaign_code,
untargeted + non-matching negatives) per-transaction cap mechanics ✓(03, MAX)
historical resolution ✓(08, `at`) concurrent configuration safety ✓(11, create race
1-winner/409 + deterministic version race) deterministic calculation ✓(14,
byte-identical incl. floor arithmetic) zero/unconfigured ✓(13, FIXED 0 → GRANTED '0'
≠ NONE) reward decision representation ✓(12 — persisted through the existing snapshot
service, schema untouched, immutability trigger holds, ruleRefs ruleType REWARD,
rewardType present per grant) financial isolation ✓(16 — ledger/limit/wallet/snapshot
untouched; `commission_rules` count remains 0 → commission behavior untouched)
workforce-only HTTP + diagnostic + no-DELETE ✓(15).

Regression suites (re-run focused):

```
migration-chain ................................. PASS  (75 migrations, head 0074)
v1-capability-registry .......................... PASS  (114 entries; 75 migrations)
v1-commission-01-commission-engine .............. PASS  15/15 (commission untouched)
production-readiness (unit) ..................... within unit suite below
```

Definitive full integration (after all fixes):

```
Test Suites: 62 passed, 62 total
Tests:       1325 passed, 1325 total     (61→62 suites, 1309→1325 tests vs COMMISSION-01 head)
```

Unit suite (`npm test`):

```
Tests: 2 failed, 1764 passed, 1766 total
FAIL test/external-reconciliation.service.spec.ts (the SAME 2 pre-existing,
     unrelated failures documented at COMMISSION-01 head — count unchanged)
```

## 3. Build / lint / type evidence

- `npx tsc --noEmit` — clean (twice: post-implementation and post-lint-fix).
- `npm run build` (nest) — clean; `dist/reward/*` emitted.
- eslint (repo config, error counts):
  - **All 12 new/changed src files + new suite + migration: 0 errors**
    (2 transient `no-useless-escape` findings in campaign-code regex literals were
    fixed and re-verified 0).
  - 13 legacy spec files touched by guard sweeps/report errors — **byte-identical
    counts on `git stash` baseline-compare** (e.g. v1-006: 37=37, hardening-09:
    27=27, limit-02: 9=9, limit-03: 11=11); → zero NEW lint issues introduced.

## 4. "No behavior change" verification

| Check | Result |
|---|---|
| Flow wiring | `grep` guard test asserts none of the 5 files implementing the 7 products contains `RewardEngine` or `reward_rules` — no flow touched |
| Production behavior | fee `NOT_CONFIGURED` / commission `NONE` / reward `NONE` across all 7 suites of commercial-decision + all commercial/limit suites in the 62/62 full run |
| Seeded reward rules | migration is DDL only; suite asserts `reward_rules` count = 0 at start; no seed/migration inserts exist |
| Rewards credited | none — no credit path exists; suite asserts `wallet_accounts` stays empty |
| Reward ledger entries | none — `ledger_journals`/`ledger_lines` counts unchanged across configuration + resolution; no ledger accounts created |
| Commission behavior | commission suite 15/15 unchanged; reward suite asserts `commission_rules` stays 0 during reward configuration/resolution |
| Snapshot schema/history | untouched (additive defaults builder only); immutability trigger exercised; no historical snapshot read/modified by the engine |
| Capability registry | reward entries BACKEND_IMPLEMENTED/API_READY as appropriate, **enabled=false, NOT_CONFIGURED** throughout; V2 entries untouched (registry suite green) |
| Migration count | 75 applied (`migration:show` [X] × 75); head `1785753600074`; all guards updated & green |

## 5. Incremental defect found & fixed during verification

1. Guard sweep missed `test/v1-limit-02`'s **no-space array style**
   (`'0073','0074'` vs `'0073', '0074'`); full-run exposed it deterministically in the
   suite's own head guard (1 test). Fixed by extending that array class; standalone
   15/15; sweep-completeness audit then proved no other unextended arrays; definitive
   full run 62/62.
2. Two `no-useless-escape` eslint findings in campaign-code regex literals
   (registry/resolver) — simplified to `[A-Z0-9_-]`; behavior identical; reward suite
   re-run 16/16.

## 6. Not done (by policy)

End-to-End Process Audit not started; no business-policy configuration; no reward
runtime wiring; no frequency/usage tables (boundary documented in architecture §6);
no accounting treatment chosen (options documented §12); 22-item unresolved policy
register recorded in architecture §13; no reversal behavior implemented (documented
design contract §14).

## 7. Commands used (canonical)

```
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija \
DB_PASSWORD=monienaija-pw NODE_ENV=test \
npx jest --config jest.integration.config.js --runInBand [spec]
npm test | npm run build | npx tsc --noEmit
npm run migration:run | npm run migration:show
npx eslint <files>            # + git stash baseline compare for legacy spec deltas
PG: node scripts/embedded-pg.js (PostgreSQL 18.4, port 5432)
```

Final status: **COMPLETE, evidence-based.**
