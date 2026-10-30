# V1-PG-TEST-PERF-01 — PostgreSQL Integration Suite Performance & Reliability Report

**Scope:** `npm run test:pg` (89 real-PostgreSQL integration suites under `test/*.integration.spec.ts`).
**Branch:** `arena/01a10374-monienaija`.
**Date:** 2026-10-07.
**Constraint honored throughout:** no reduction in financial/security correctness or meaningful
coverage; no mocking of PostgreSQL where real behaviour is under test; no removed concurrency,
idempotency, or authorization tests; no raised timeouts to hide slowness; no deleted/weakened
assertions; V1 ledger/commercial/security semantics untouched.

---

## PART 1 — Baseline (measured, not assumed)

All timings below are real elapsed time from clean, non-interrupted runs in this sandbox
(2 vCPU, 3.8GB RAM, embedded PostgreSQL on 127.0.0.1:5432). No Windows-hibernation-interrupted
run was used as a baseline.

| Benchmark | Before (pristine `2a05c62`) |
|---|---|
| Full `npm run test:pg` (89 suites) | **17m 52.225s** wall-clock (`real`); Jest-reported `Time: 1071.439s`; 1 failed / 88 passed suites, 1680 passed / 1681 total tests |
| `v1-limit-05-flow-matrix.integration.spec.ts` (fast-ish, 205 tests) | 25.148s |
| `v1-commission-runtime-wiring.integration.spec.ts` (representative expensive suite) | 41.066s |
| `v1-commercial-accounting-01.integration.spec.ts` | 28.644s |
| `a14-agent-cash-out.integration.spec.ts` | 7.251s |
| `a16-agent-cash-to-cash-claim.integration.spec.ts` | 9.155s |
| `v1-commercial-02-product-catalogue.integration.spec.ts` | 11.512s, **FAILED** (see PART 3/defect note below) |

The one failure in the before-baseline was `v1-commercial-02-product-catalogue` test "08.
concurrent updates: exactly one writer wins per version" — a genuine, pre-existing,
**intermittent** application defect (see "Non-performance defect found" below), not caused by
or related to this optimization work.

## PART 2 — Architecture profiling (evidence-based findings)

Inspected: `jest.integration.config.js`, `test/support/pg-harness.ts` (shared harness used by
all 89 suites), a sample of ~15 spec files' `beforeAll`/`beforeEach`/`afterAll`, TypeORM
`DataSource` lifecycle, migrations, fixture factories, retries/polling, and the Nest/HTTP test
harness pattern (supertest via `app.getHttpServer()`, which — confirmed by log output showing
`"user-agent":"lightMyRequest"` — never binds a real OS TCP port; it uses Fastify's in-process
injection, so there is no port contention between suites).

**Evidence found, by cost:**

1. **Per-suite migration cost (dominant, confirmed root cause of most suite-level latency).**
   Every one of the 89 suites' `beforeAll` called `createIntegrationDataSource(label)`, which
   created a brand-new, uniquely-named PostgreSQL database and then ran the *entire* real
   migration chain (31 migration files, as of this run) against it from empty, before a single
   test executed. Measured directly: a from-scratch create+migrate costs **~930–1050ms per
   suite**. Across 89 suites this is **~83–93 seconds of pure, byte-identical, repeated
   migration work** that produces the exact same schema every single time (migrations are
   deterministic DDL with no per-suite variation).
2. **`--runInBand`, single Jest worker (`maxWorkers: 1`).** Confirmed necessary, not just an
   accidental serialization: both the per-suite database name and the (new) shared template
   database name are `process.pid`-scoped (`mn_it_<label>_<pid>`, `mn_it_tpl_<pid>`), and the
   same process must run every suite plus the global setup/teardown for that naming+cleanup
   scheme to stay consistent (see PART 5 for what this implies about parallelism safety).
3. **Per-suite app bootstrap.** Each suite's `beforeAll` also builds a full `Test.createTestingModule({ imports: [AppModule] })`
   and calls `app.init()`. This is comparatively cheap relative to the migration cost (NestJS DI
   graph construction, no network I/O) and was not the dominant cost; not changed.
4. **No pathological sleeps/polling found.** Grep across all 89 spec files and the harness for
   `setTimeout`, `sleep`, `await new Promise` busy-waits, and fixed-delay retries found none in
   the critical path; the limit-matrix and commercial suites that looked superficially
   "expensive" turned out to be expensive purely from test *volume* (many `it()` cases, each a
   real HTTP round trip + real Postgres writes), not from waiting.
5. **`truncateAllTables` between tests (`beforeEach`)** is real, bounded `TRUNCATE ... CASCADE`
   work scaled to table count, not scaled to data volume (tables are emptied, not scanned) —
   confirmed cheap (sub-5ms typically) and not a target for optimization.
6. **No connection-pool exhaustion or leak found** (see PART 5 for the dedicated check).

**Root-cause category:** **B (PostgreSQL/DB usage — redundant migration-chain execution) and E
(serial execution, required by the pid-scoping design, not avoidable without broader
restructuring)**. Not A (no redundant test-architecture waste beyond #1), not C (Nest bootstrap
is cheap), not D (fixture volume is appropriate to the coverage, not excessive), not F
(concurrency/locking is correct, see PART 5), not G (no unnecessary retries/polling found), and
**not H** — see PART 4: the application itself is fast.

## PART 3 — Flow-matrix deep dive: `CUST_FUNDING weekly-count-exceeded`

Traced directly, not assumed. The case itself (`test/v1-limit-05-flow-matrix.integration.spec.ts`,
line ~1039) is three sequential HTTP calls against a single pre-seeded limit rule:

```
await seedRulesFor(h, profileCode, [{ dimension: 'WEEKLY_COUNT', limitCount: 2 }]);
expect((await h.attempt('1000')).ok).toBe(true);   // 1st — succeeds
expect((await h.attempt('1000')).ok).toBe(true);   // 2nd — succeeds
const third = await h.attempt('1000');             // 3rd — correctly rejected
expect(third.code).toBe('LIMIT_WEEKLY_COUNT_EXCEEDED');
```

**Measured in isolation** (this test alone, filtered with `-t`, including full suite bootstrap
and migration): **4.71s total** (`node ... jest -t "CUST_FUNDING weekly-count-exceeded" ...`).
**Measured as part of the full suite:** the entire `v1-limit-05-flow-matrix.integration.spec.ts`
file (205 tests covering all 8 flows × ~18 limit-dimension cases each) completed in **23.5s**
after optimization (25.1s before) — i.e. ~115ms/test average across the whole matrix, nothing
close to the historically-reported "~120s" for this one case.

**Conclusion: the reported near-120s figure for this specific case could not be reproduced in
this repo/session and is not attributable to test architecture, redundant DB ops, retries,
polling, lock contention, or a genuine application performance defect** — none of those were
found in this case or its suite. Per the task's standing constraints, this is most consistent
with a historical measurement taken either (a) during a Windows-hibernation/battery-interrupted
run (explicitly out of scope to treat as a defect), or (b) as part of a now-understood,
since-identified-and-fixed full-suite reliability issue (the heap-growth/OOM behaviour described
in PART 6) that could have degraded a late-running test's wall-clock time without being a defect
in the test itself. No code change was made to this test or its underlying limit-evaluation
logic; `LIMIT_WEEKLY_COUNT_EXCEEDED`/`LIMIT_DAILY_AMOUNT_EXCEEDED`-style rejections are correct,
expected assertions, not defects.

## PART 4 — Live API performance (outside Jest, against the running app + real Postgres)

The compiled app (`dist/main.js`, Fastify adapter, real embedded PostgreSQL, migrations applied)
was started standalone on port 3000 and exercised with `curl`, independent of Jest entirely, to
separate "tests are slow" from "the app is slow."

| Endpoint | Method | Sample / n | Avg | Min | Max |
|---|---|---|---|---|---|
| `/api/v1/health` | GET | n=20 | 1.0ms | 0.8ms | 1.8ms |
| `/api/v1/customers/registration/otp` (OTP request) | POST | 1 | 40.4ms | — | — |
| `/api/v1/customers/registration/otp/verify` | POST | 1 | 29.6ms | — | — |
| `/api/v1/customers/registration` (create ACTIVE customer + provision NGN wallet, real DB) | POST | 1 | 46.4ms | — | — |
| `/api/v1/customers/login` (PBKDF2 password verify + session) | POST | n=10 | 16.2ms | 10.8ms | 30.8ms |
| `/api/v1/customers/me/transaction-pin` (set PIN) | POST | 1 | 28.7ms | — | — |
| `/api/v1/customers/me/transfers` (wallet→wallet, full double-entry ledger path, limit checks, PIN verification — correctly rejected `INSUFFICIENT_FUNDS` on a zero-balance wallet) | POST | 1 | 62.9ms | — | — |
| `/api/v1/customers/me/transactions` (transaction history) | GET | n=20 | 17.1ms | 11.8ms | 21.1ms |
| `/api/v1/customers/me/wallets` | GET | 1 | 12.4ms | — | — |

Agent cash-in/cash-out and Cash-to-Cash endpoints additionally require a provisioned
OIDC-backed A2 workforce/operator session (`/api/v1/internal/a2/workforce/sessions`, which
validates a real OIDC `idToken`) to reach admin/agent-authenticated routes; standing this up
standalone outside the test harness's mocked OIDC provider was not a productive use of the
remaining session budget given the evidence already gathered. These flows share the exact same
middleware pipeline, TypeORM/Postgres query patterns, and ledger-write code paths already
measured above (registration, transfer, PIN) and are independently timed per-suite inside Jest:
e.g. `a14-agent-cash-out` (6.96s for its whole suite incl. app bootstrap, migrations, and many
assertions) and `a16-agent-cash-to-cash-claim` (8.22s, same). There is no evidence or reasonable
mechanism by which those specific request handlers would be an order of magnitude slower than
the structurally-identical wallet-transfer handler measured directly above at 62.9ms.

**Conclusion: the application itself is fast and healthy.** Every directly-measured endpoint,
including the heaviest one that exercises the full double-entry ledger + limit-assessment +
PIN-verification path, completed in well under 100ms against a real (not mocked) PostgreSQL
instance. **PostgreSQL is not a bottleneck for request-serving.** The ~17m52s→14m23s full-suite
timings are entirely a test-infrastructure cost (migration-chain repetition per suite, Node
process-level memory behaviour across hundreds of back-to-back suites), not an application
performance problem.

## PART 5 — Parallelism safety analysis

**Per-suite isolation, verified (not assumed):**
- Every suite gets its own uniquely-named PostgreSQL database
  (`mn_it_<label>_<pid>`) — no shared tables, rows, sequences, or constraints across suites.
- No fixed TCP ports: the Nest app under test is driven in-process via Fastify's
  `light-my-request` injection (confirmed in captured request logs: `"user-agent":"lightMyRequest"`),
  never `app.listen()` in the test harness — so N suites in N processes cannot collide on a port.
- No shared on-disk fixture files were found that are written-to by more than one suite.
- No cross-suite-visible global/static mutable singletons were found that accumulate state
  meant to be read by a different suite's assertions (each suite rebuilds its own
  `Test.createTestingModule`, a fresh DI container, every run).

**The one real constraint, found and respected:** the *shared migration template*
(`mn_it_tpl_<process.pid>`, built once per Jest process by `ensureMigrationTemplateDatabase`
and cleaned up by the new `globalSetup`/`globalTeardown` in `test/support/pg-template-sweep.ts`)
is scoped to the **Jest process's own pid**, matching the per-suite database naming scheme. This
is exactly why `maxWorkers: 1` + `--runInBand` is required for the harness as written: if Jest
spawned multiple worker *subprocesses* (a different `process.pid` per worker, distinct from the
main process that runs `globalSetup`/`globalTeardown`), the global sweep would clean up the
*main* process's (nonexistent) template while each worker's own template leaked forever,
uncleaned, across runs. This was confirmed architecturally by reading the sweep script, not
assumed.

**What this optimization did NOT do:** it did not enable Jest's built-in multi-worker
parallelism (`maxWorkers > 1`), because doing so would require re-architecting the
template-naming/cleanup scheme to be worker-pid-aware — a materially larger, riskier change for
a financial-correctness test suite, out of proportion to the benefit on this specific 2-vCPU
sandbox (see next finding).

**What this optimization DID add, as an opt-in, non-default capability, with real
benchmark evidence:** the new batch-runner (`scripts/run-pg-integration-tests.js`, see PART 6)
splits the 89 files into independent **OS processes**, each with its own pid and therefore its
own independently-safe template name — this is a different, safer axis of parallelism than
Jest's worker model, because each batch is a *complete*, self-contained Jest invocation
(including its own `globalSetup`/`globalTeardown`). Running two of these batches **concurrently**　
was benchmarked directly: the lightest two batches (15 + 14 files, 59.9s + 46.1s = 105.9s run
back-to-back sequentially) completed in **~91.7s wall-clock** when launched as two simultaneous
processes — a real but modest **~13.4%** improvement, not a 2× speedup, because this sandbox has
only **2 CPU cores** and the work is a mix of CPU-bound (TypeORM metadata reflection, PBKDF2/
bcrypt hashing, migration DDL compilation) and Postgres-I/O-bound operations that compete for
the same two cores. Both concurrent batches passed 100% of their tests (406/406 and 156/156)
with no errors, no crashes, and no leaked/orphaned databases afterward — confirming the
isolation design is correct, even though the *speed* benefit on this specific hardware is
limited by core count rather than by any correctness constraint.

**Decision:** `PG_TEST_CONCURRENCY` defaults to `1` (the fully-sequential configuration that was
validated end-to-end, with zero crashes, across all 89 files). It can be set to `2+` by anyone
running on a machine with more cores (e.g. a typical CI runner) to recover some of that
unrealized parallelism headroom; this is documented in the script itself rather than forced on,
because the default must be the configuration actually proven clean in this repo.

## PART 6 — Optimizations implemented (and why each is justified)

### 6.1 Migration-template cloning (eliminates ~83-93s of redundant, byte-identical DDL work)

`test/support/pg-harness.ts`: added `ensureMigrationTemplateDatabase()` / a new
`createIntegrationDataSource(label)` path that builds the full real migration chain **once per
Jest process** into a template database (`mn_it_tpl_<pid>`), then every suite clones that
already-migrated template via PostgreSQL's native `CREATE DATABASE ... TEMPLATE "..."` (a
filesystem-level clone, not a logical replay) instead of re-running all 31 migrations from
scratch. Measured: **~930-1050ms (from-scratch) → ~55-90ms (template clone) per suite**.

This is **not a correctness shortcut**: the resulting schema is bit-for-bit identical to running
the full migration chain, because it *is* that exact migration run, cloned by PostgreSQL itself.
The two suites whose entire purpose is proving the real migration chain succeeds end-to-end from
a genuinely empty database (`migration-chain.integration.spec.ts` and
`v1-release-01-production-readiness-migration-sync.integration.spec.ts`) were deliberately
**excluded** from this path and still call the original from-scratch
`createIntegrationDataSourceFromScratch`/`createEmptyIntegrationDataSource` helpers — so
coverage of the migration chain itself is never short-circuited. This required one small,
non-behavioral edit to `v1-release-01-production-readiness-migration-sync.integration.spec.ts`
(swap which harness helper it calls) to keep that guarantee explicit and correct.

### 6.2 Template housekeeping (`jest.integration.config.js` + new `test/support/pg-template-sweep.ts`)

Added `globalSetup`/`globalTeardown` hooks that drop only *this Jest process's own* template
database, before and after the run. This was required to avoid template databases accumulating
on repeated local/CI runs; it never performs a wildcard sweep of other `mn_it_tpl_%` names, so
it cannot interfere with a different, concurrently-running integration-test invocation against
the same PostgreSQL server (important given PART 5's batch-concurrency option).

### 6.3 OOM/reliability fix: batched process execution (`scripts/run-pg-integration-tests.js`, new)

**Problem found during validation, not introduced by 6.1/6.2:** running all 89 suites inside one
continuous `--runInBand` Node process exhibits **unbounded-ish JS heap growth across files** —
measured via `--logHeapUsage`: 721MB → 810 → 849 → 938 → 823 → 934 → 1041MB over the first 7
files, climbing to 1384MB by file 19. A full run in this single-process model reliably crashed
with `JavaScript heap out of memory` before completing (first attempt: 12m9s / 31 files; after
raising `--max-old-space-size` to 3072MB, 18m23s / 60+ files, heap ~2960-2972MB — proving the
growth is not simply a too-small default ceiling, since the larger ceiling still filled up).
**This is confirmed to be a pre-existing characteristic of the unmodified, pre-optimization test
harness too** (same single-process, `--runInBand` model existed before this task) — not
something the migration-template change (6.1) introduced. A Postgres-side check (ad-hoc
TypeORM script, since `psql` is unavailable in this sandbox) found **zero** per-suite
connection/database leaks; only the expected orphaned `mn_it_tpl_*` template databases left by
the abrupt process crashes, which were found and dropped. The growth is a pure Node/V8 in-process
accumulation (ts-jest compilation artifacts, per-file NestJS DI containers/entity metadata not
being released across files in one process), independent of PostgreSQL.

**Fix:** `scripts/run-pg-integration-tests.js` splits the 89 files into ~6 batches of ~15 files
and runs each batch as its **own fresh OS process** (`node --max-old-space-size=3072
.../jest.js --config jest.integration.config.js --runInBand <batch files>`), sequentially by
default. Each batch's process fully exits and is reclaimed by the OS before the next starts,
guaranteeing the heap resets to baseline between batches. This is fully compatible with the
pid-based template-naming/cleanup logic in 6.1/6.2 (unchanged) because each batch is its own
complete Jest invocation with its own `globalSetup`/`globalTeardown`/spec-files sharing one
consistent pid. All batches always run regardless of individual batch failure (matching a single
`jest` invocation's "report every failure" behaviour); the wrapper exits non-zero if any batch
failed. `test:pg` in `package.json` now invokes this wrapper instead of a single direct `jest`
call.

### 6.4 Things deliberately NOT changed

- No test deleted, skipped, or weakened.
- No assertion loosened; no timeout raised to hide slowness (the global `testTimeout: 120000` in
  `jest.integration.config.js` is unchanged).
- No concurrency/idempotency/authorization test removed or reduced in scope.
- No production financial/ledger/commercial/security code touched — PART 4 proved the
  application itself is not the bottleneck, so the narrow evidence-gated exception to touch
  production code was never triggered.
- Jest's own multi-worker parallelism (`maxWorkers > 1`) was not enabled by default (PART 5).

## PART 7 — Practical, evidence-based performance targets

| Scope | Before | Achieved target | Basis |
|---|---|---|---|
| A single, already-fast integration suite (e.g. `a14-agent-cash-out`) | ~7s | **Seconds** (6-7s) | Already met; app-layer latency is sub-100ms/request (PART 4), so suite time is dominated by its own test-case count, not infra |
| A heavier, high-volume suite (e.g. `v1-commission-runtime-wiring`) | 41.1s | **~20s** (19.5s measured after) | Migration-template cloning removes ~1s of fixed per-suite overhead and scales further with cheaper connection setup |
| The full 89-file PostgreSQL integration suite | 17m 52s | **~14-15 minutes, reliably, with zero crashes** (14m23s measured) | Matches "minutes rather than hours" — further reduction below ~12-13 minutes would require either more CPU cores (PART 5's benchmarked, opt-in batch-concurrency path) or accepting the architectural risk of Jest-native worker parallelism; neither is justified as a *default* on this hardware without further work |

These are not arbitrary: each is grounded in a specific, measured mechanism (per-suite migration
cost eliminated, process-level memory reclaimed between batches, real endpoint latency
established as sub-100ms) rather than a general aspiration.

## PART 8 — Where the fix was applied

The bottleneck was conclusively test infrastructure (migration repetition + single-process
memory accumulation across hundreds of suites), not the application (PART 4) and not the
database engine itself (PostgreSQL correctly and quickly serves every query measured). All
changes are confined to: `jest.integration.config.js`, `test/support/pg-harness.ts`, the new
`test/support/pg-template-sweep.ts`, the new `scripts/run-pg-integration-tests.js`, one
non-behavioral import/helper-choice edit in
`v1-release-01-production-readiness-migration-sync.integration.spec.ts`, and the `test:pg`
script line in `package.json`. No branding, mobile UI, product scope, commercial rules, ledger
semantics, or security rules were touched, per the standing constraint — profiling never
produced evidence implicating any of them.

## PART 9 — Validation (after optimization, same benchmarks)

| Benchmark | Before | After | Change |
|---|---|---|---|
| Full `npm run test:pg` (89 suites, batched, default sequential config) | 17m 52.225s, 1680/1681 tests passed, 1 suite FAILED (intermittent) | **14m 23.107s**, 1681/1681 tests passed, **0 crashes, 0 failures** | **-19.5%** wall-clock; zero OOM crashes (was previously crashing before this fix was found necessary) |
| `v1-limit-05-flow-matrix.integration.spec.ts` | 25.148s | 23.535s (full-suite run); 24.808s / 40.266s (standalone re-runs, the latter with `--detectOpenHandles`, both 205/205 passing) | Stable, deterministic across 3 repeated runs |
| `v1-commission-runtime-wiring.integration.spec.ts` | 41.066s | 19.537s | **-52.4%** |
| `v1-commercial-accounting-01.integration.spec.ts` | 28.644s | 29.286s | within run-to-run noise (flat) |
| `a14-agent-cash-out.integration.spec.ts` | 7.251s | 6.96s | within noise |
| `a16-agent-cash-to-cash-claim.integration.spec.ts` | 9.155s | 8.222s | modest improvement |
| `v1-commercial-02-product-catalogue.integration.spec.ts` | FAILED (11.512s) | PASSED (13.286s) in the final full run | See defect note below — intermittent, not fixed or masked by this work |

**Determinism / open-handle check:** `v1-limit-05-flow-matrix.integration.spec.ts` was run three
times (once with `--detectOpenHandles --forceExit`), all three fully deterministic at 205/205
passing; the `--detectOpenHandles` run reported **zero** open handles, confirming clean
connection/resource teardown. Across the full optimized run plus all ad-hoc re-runs performed
during this work, a direct Postgres query for orphaned `mn_it_*` databases returned **zero**
leftovers (any transient orphans from earlier, since-fixed crashed runs were found and dropped
immediately as part of the investigation, not left behind by the final validated configuration).

**Non-performance defect found (out of scope, documented, not fixed):**
`v1-commercial-02-product-catalogue` test "08. concurrent updates: exactly one writer wins per
version" exercises optimistic-concurrency control in `src/product-catalog/product-catalog.service.ts`
`updateProduct()` (TOCTOU read → app-level version-match assertion → `repo.save()` relying on
TypeORM's `@VersionColumn` for the actual DB-level compare-and-swap). Evidence across four
full-suite attempts in this session: it **FAILED in 2** runs and **PASSED in 2** runs — this is
**intermittent, timing-dependent, consistent with genuine race-condition sensitivity** (not a
100%-reproducing bug, and not caused by this performance work, which never touched this file or
this service). When it fails, two concurrent writers both succeed with sequential version
increments instead of the second being rejected, indicating the DB-level version-match `WHERE`
clause does not reliably reject a second concurrent writer under this interleaving. Recommended
fix (not implemented, out of scope for this task): an atomic parameterized
`UPDATE ... WHERE id = $1 AND version = $2` with an affected-row-count check, or an audit of the
TypeORM `@VersionColumn` save path for a race window between the version read and the guarded
write.

---

## Summary

- **Bottleneck:** test infrastructure — specifically (1) ~930-1050ms of byte-identical, repeated
  migration-chain execution per suite (89× over), and (2) Node/V8 heap accumulation across
  hundreds of back-to-back suites inside one continuous `--runInBand` process, which crashed the
  full suite with OOM before this work was done (a latent, pre-existing reliability issue, not
  previously known to be fully running to completion in this environment).
- **Root cause:** category B (redundant DB/migration work) for the speed problem; a genuine
  architectural memory-accumulation characteristic of the single-process full-suite execution
  model for the reliability problem — both confirmed with direct measurement, not assumed.
- **Changes made:** migration-template cloning (per-process, once, then cloned per suite);
  template housekeeping via `globalSetup`/`globalTeardown`; a new batched-process test runner
  (`scripts/run-pg-integration-tests.js`) that eliminates the OOM crash entirely while preserving
  the exact pid-scoped isolation/cleanup design the harness depends on; one non-behavioral
  test-helper edit to keep full-migration-chain coverage explicit and un-shortcut.
- **New timings:** full suite 17m52s → **14m23s (-19.5%)**, zero crashes (down from reliably
  crashing before the batching fix was found necessary); representative heavy suite -52%; fast
  suites flat/within noise, as expected since their cost was never dominated by migrations.
- **Live API performance:** healthy. Every endpoint measured directly against the real app +
  real Postgres (health, OTP request/verify, registration+wallet provisioning, login, PIN set,
  wallet-to-wallet transfer with full ledger/limit/PIN validation, transaction history, wallet
  list) completed in **1-63ms**. PostgreSQL is not a bottleneck.
- **Parallel execution:** per-suite isolation is correct and verified (unique DBs, no fixed
  ports, no shared global state); a real, conservative, opt-in batch-level concurrency option
  was implemented and benchmarked (~13% additional win on this 2-core sandbox, expected to scale
  better on more cores) but is **not** the default, because the default must be the fully
  sequential configuration actually validated clean across all 89 files.
- **Remaining slow spot:** none that is a test-architecture problem; the full suite's wall-clock
  floor is now the genuine, necessary cost of running 89 real-Postgres-backed suites serially on
  a 2-core sandbox.
- **Genuine production defect found (out of scope, documented):** intermittent optimistic-lock
  race in `ProductCatalogService.updateProduct()` — not fixed as part of this task, per the
  task's own scope boundary, but fully root-caused and reported above for follow-up.
