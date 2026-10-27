# ARENA 3 — CASH-TO-CASH EXPIRY WORKER INTEGRATION REPORT

- **Date:** 2026-10-27
- **Integration branch:** `arena/8e59e188-monienaija` (pushed to this branch only; no main merge, no deployment, no production migration, no force-push)
- **Sprint 3 integrated application baseline (verified):** `b8a5b94ee55aad7407dd78068428b3e97236ce8e`
- **ARENA 1 expiry-worker source (verified):** `507b4e1a6510de0d42443e5f9a376e5b17105061` = tip of `origin/arena/92fd33dd-monienaija`, a single commit ("feat(agent): add bounded observable cash-to-cash expiry worker") whose parent chain contains `b8a5b94` directly
- **Pre-merge ARENA 3 documentation tip (verified):** `aa91c3e6982a71d6d90a84157fdf7dee66fcb750` (completion audit `e90a208` + notification audit `aa91c3e`, both documentation-only)
- **Final integrated merge commit:** `823293e` (full SHA in git log; recorded in §8)
- **Sandbox note:** a workspace reset was recovered before integration by fetch + ancestry verification (`3d05aae`-era staleness → origin tip fast-forward, local-only) — no shared history rewritten. Environment rebuilt afterwards (`npm ci` 552 pkgs, `.env` via `prepare-pg-test-env.js`, embedded PostgreSQL 18.4 fresh cluster).

---

## 1. What was merged (changed files, exact)

`git diff b8a5b94..507b4e1` — 10 files, +400/−10:

| File | Change |
|---|---|
| `src/agent/agent-cash-to-cash-expiry-worker.service.ts` | NEW (84 lines): opt-in Nest lifecycle worker — `CASH_TO_CASH_EXPIRY_WORKER_ENABLED` gate checked at init AND per tick; bounded one-batch-per-poll `setInterval` (unref'd); in-process single-flight (overlap → SKIPPED); immediate startup catch-up of persisted due rows; `onModuleDestroy` stops scheduling and AWAITS the active batch before DB teardown; failure logs carry only bounded 5-char SQLSTATE (never driver prose/parameters) |
| `src/agent/agent-cash-to-cash-expiry.service.ts` | +18/−4 hardening, backward compatible: validated optional `limit`/`statementTimeoutMs` inputs; transaction-local `statement_timeout` + `idle_in_transaction_session_timeout` via `set_config(..., true)` (never session-global); production cutoff from PostgreSQL `clock_timestamp()` instead of host clock (explicit `now` remains for tests/internal callers — the worker never supplies it); deterministic ordering tie-break `expires_at, created_at, id` |
| `src/agent/agent.module.ts` | worker registered as provider |
| `src/main.ts` | `app.enableShutdownHooks(['SIGTERM','SIGINT'])` (worker drain on graceful stop) |
| `src/config/environment.ts` | 4 new validated env keys: `CASH_TO_CASH_EXPIRY_WORKER_ENABLED` (bool, **default false**), `_POLL_INTERVAL_MS` (1000–3_600_000, default 60_000), `_BATCH_SIZE` (1–1000, default 100), `_STATEMENT_TIMEOUT_MS` (100–60_000, default 10_000) |
| `.env.example` | documented defaults, "state/audit only, NEVER a refund" |
| `src/capability-registry/capability.seed.ts` | `CASH_TO_CASH_EXPIRY` restated to version 2: lifecycle `FULLY_ENABLED`→`BACKEND_IMPLEMENTED`, apiStatus `API_READY`→`NOT_EXPOSED`, configurationStatus `CONFIGURED`→`NOT_CONFIGURED`, worker implementation/test references added, note: "Worker is disabled by default; production enablement/monitoring is an operational prerequisite" |
| `test/a17-agent-cash-to-cash-expiry.integration.spec.ts` | +104: four production-execution PG tests (§5) |
| `test/agent-cash-to-cash-expiry-worker.spec.ts` | NEW unit spec (5 tests): disabled-by-default (no timer/work), start→poll→bounded-failure-log→next-tick recovery, overlap skip + shutdown awaits active transaction, config-bound validation, seed-description honesty assertions |
| `docs/ordinary-agent-v1/cash-to-cash-expiry-execution.md` | NEW operational runbook (enablement, monitoring events, restart/replica semantics, limitations) |

**Conflicts: NONE.** Pre-merge analysis: the ARENA 3 side after `b8a5b94` is documentation-only (`docs/ordinary-agent-v1/completion-audit-20261027/**`, `docs/ARENA3-NOTIFICATION-INFRASTRUCTURE-AUDIT-20261027.md`); the ARENA 1 side touches zero of those paths (`comm -12` on both file lists = empty). All prior history preserved; normal `git merge --no-ff`.

## 2. Ancestry and remote verification (executed)

- `git merge-base --is-ancestor` TRUE at the merge commit for: `b8a5b94` (Sprint 3 baseline), `507b4e1` (ARENA 1 source), `aa91c3e` and `e90a208` (both audit documentation commits) — both source commits are ancestors of the final integrated HEAD.
- Pushed `aa91c3e..823293e → arena/8e59e188-monienaija`; post-push `git rev-parse HEAD == origin/arena/8e59e188-monienaija` and `git status --porcelain` empty (clean tree).
- All four Sprint 3 source HEADs (A1 `d0d8f6c`, A2 `3ace151`, A3 `bad1b9b`, A4 `270cf8f`) remain ancestors transitively through `b8a5b94`.

## 3. Contract-invariance confirmation (instruction 6)

`git diff b8a5b94..HEAD --name-only` contains **no** change to any Cash-to-Cash contract surface: `agent-cash-to-cash.service.ts` (initiation), `agent-cash-to-cash-claim.service.ts` / `-claim.controller.ts` / `agent-cash-to-cash.controller.ts` (claim-by-number, legacy UUID claim, recover-by-number, receipt recovery), all DTOs, `agent-financial-execution.service.ts`, `agent-desk-otp.*` (OTP), PIN routes/services, `limit-catalog/*` (limits), funding, and history services are byte-identical to the baseline. The expiry-service delta adds only optional validated inputs, transaction-local timeouts, a DB-clock default (existing explicit-`now` callers unchanged) and an ordering tie-break — the claim-path deadline semantics (`expires_at <= clock_timestamp()` conditional transitions, deadline re-check under the posting lock) are untouched. The full regression (§5) re-proves every one of these contracts on the merged tree: initiation/claim/recovery/ledger/OTP/PIN/lockout/idempotency/limits suites all green.

## 4. Financial-boundary confirmation (instruction 8)

Expiry remains **state + audit only**: the new a17 test "production execution is bounded, restart-safe and concurrent without journals or refunds" asserts, from persisted state, that across worker-driven expirations (a) `ledger_journals` count is unchanged, (b) the `CASH_TO_CASH-UNCLAIMED-NGN` liability balance is unchanged, and (c) agent float balances are unchanged. No refund, release or redistribution path exists in the diff; expired-funds disposition remains an open owner decision (register D2) and is explicitly NOT decided or implemented here.

## 5. Regression results (own execution, merged tree `823293e`)

| Gate | Command | Result |
|---|---|---|
| Backend production build | `npm run build` | **PASS** (exit 0) |
| Backend complete unit suite | `npm run test` | **194/194 suites · 1974/1974 tests PASS** (baseline 193/1969 + new worker unit spec 1 suite/5 tests) |
| Complete sequential PostgreSQL integration | `PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=intexpw1 node scripts/run-pg-integration-tests.js` (log `expiry-worker-full-pg.log`, gitignored) | **116/116 suites · 2241/2241 tests PASS · runner EXIT=0** (baseline 2237 + 4 new a17 production-execution tests; zero FAIL lines) |
| a17 specifically | inside the full run | PASS (7.2s) — including: bounded/restart-safe/concurrent execution without journals or refunds; audit-failure → whole-sweep rollback + restart retry processes the persisted due row exactly once; statement-timeout → FAILED tick, row stays UNCLAIMED, next tick expires it; startup auto-executes persisted due rows without a manual tick |
| Worker default posture | unit spec + env schema | **Disabled by default verified** (instruction 9): `CASH_TO_CASH_EXPIRY_WORKER_ENABLED` defaults false; unit test asserts no timer and no work at init when unset; tick() re-checks the gate at runtime |

**Admin Web / Agent Mobile (instruction 12): NOT re-run — justification, not omission.** `git diff b8a5b94..HEAD -- apps/` is EMPTY and no `package.json`/lockfile changed anywhere: both application trees are byte-identical to the Sprint 3 baseline whose gates were executed green at that exact tree (admin-web: `npm ci`, tsc 0 errors, 25/25 suites · 167/167 tests, vite production build PASS; agent-mobile: `npm ci`, tsc 0 errors, 20/20 suites · 297/297 tests — recorded in `docs/ARENA3-SPRINT3-FINAL-INTEGRATION-REPORT-20261027.md` §7). No shared contract changed: the merge adds no endpoint/DTO/response field, touches no frontend file, and the only externally visible data change (capability-seed row `CASH_TO_CASH_EXPIRY` v2, surfaced via workforce-only `GET /internal/capabilities`) is not consumed by any frontend code or pinned by any app test (verified by grep). Re-running the app suites would re-measure identical bytes.

**Lint:** no changed-file lint regression — the merged files arrive as-committed from ARENA 1 (their own gate); no ARENA 3 file edits occurred in this integration (documentation report only).

## 6. Capability-registry metadata: existing-data impact (instruction 10)

The seed change ships as **code** only. Verified in `capability-seed.service.ts`: `seedIfEmpty()` performs a FULL seed only into an empty registry; against a non-empty registry it INSERTS missing codes and **never updates existing rows**. The registry API is read-only (`GET`, `GET summary`, `GET :code` — no PATCH/POST).

**Consequence / required existing-data update:** any already-seeded database (long-lived dev/staging, and any future production registry) will keep the stale version-1 `CASH_TO_CASH_EXPIRY` row (`FULLY_ENABLED` / `API_READY` / `CONFIGURED`) — the honest version-2 metadata appears only in freshly seeded databases (as in every suite of this regression run, all fresh per-suite clusters). Before staging/production reliance on registry truth, ownership must run an approved registry data refresh (governed operator reseed or a future governed update endpoint). **No production or existing-environment change was executed here**, per the mission. Fresh-database deployments pick up version 2 automatically at bootstrap.

## 7. Operational requirements and outstanding limitations

**Enablement (operational prerequisite, NOT done here and must not be done in production without authorization):** set `CASH_TO_CASH_EXPIRY_WORKER_ENABLED=true` in the application environment and restart via the normal deployment supervisor (built backend, `npm start`); tune `_POLL_INTERVAL_MS/_BATCH_SIZE/_STATEMENT_TIMEOUT_MS` within validated bounds only. Monitoring: structured log events `c2c_expiry_worker_disabled|started|stopped`, `c2c_expiry_tick_started|completed|failed` (correlationId, expiredCount, batchFull, durationMs, bounded SQLSTATE only). Runbook: `docs/ordinary-agent-v1/cash-to-cash-expiry-execution.md`.

**Limitations (carried from the source, honestly recorded):**
1. In-process worker — does not run while ALL application instances are down; startup catch-up recovers due rows afterwards (tested). No cron/external queue.
2. Multiple enabled replicas are correctness-safe (row locks + `SKIP LOCKED` are the cross-process boundary; tested concurrent) but multiply throughput/load; start with one enabled instance; a full batch does not prove an empty backlog.
3. Statement/idle-in-transaction timeouts bound per-statement database work — NOT a hard wall-clock deadline for a whole batch or a broken network connection; sudden process kill relies on PostgreSQL transaction rollback.
4. Expired-funds disposition (refund/forfeiture) remains an owner policy decision (register D2) — untouched.
5. `cash_to_cash.expired` NOTIFICATION emission is still not wired (notification audit F-M9/OA-72): the worker changes status+audit only, by explicit design; notification feature work is forbidden during this integration and remains backlog P2-2/P3 territory.
6. Registry existing-data refresh outstanding (§6).
7. Browser/device UAT posture unchanged (none executed anywhere; not applicable to a backend worker beyond the recorded environment limitation).

## 8. Delivery record and baseline suitability

- **Final integrated commit SHA:** `823293e` (merge commit; full SHA recorded via `git rev-parse HEAD` at push time and reproducible from `git log`), then this report as the subsequent documentation commit on the same branch.
- Both source commits confirmed ancestors (§2); remote HEAD == local HEAD; working tree clean at delivery.
- **Unresolved defects found by this integration: NONE.** Zero conflicts, zero failed suites/tests across build/unit/full-PG, no contract drift, no new lint surface.
- **Suitability as the next development baseline: YES.** The merged tree is the verified successor baseline for the notification-development programme (audit `aa91c3e`): it closes Ordinary Agent V1 backlog B1/OA-40's execution gap with the financial boundary intact, keeps the worker dark by default, and leaves the notification pipeline untouched — the recommended P0/P1 notification tasks (assertSafe no-op removal, template registry, event configuration, EMAIL channel) can start from this SHA without interfering with expiry semantics. Note for that work: the expiry worker provides the in-repo pattern precedent (config-gated lifecycle worker) already cited by the notification audit, and `cash_to_cash.expired` emission should be wired together with the expiry sweep in backlog P2-2/P3-1 per the notification audit §4.7.6.
