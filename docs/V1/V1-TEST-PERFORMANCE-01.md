# V1-TEST-PERFORMANCE-01 — Test Execution Performance Audit

**Status:** Complete
**Scope:** Full repo test execution (root unit suite, real-PostgreSQL integration suite, customer-mobile, agent-mobile), evidence-based measurement and safe optimization only.
**Hardware used for all measurements:** sandbox with 2 vCPU, 3.8GB RAM, no swap, embedded PostgreSQL on 127.0.0.1:5432.
**Forbidden (restated, see Part 13):** no weakened assertions, no deleted tests, no mock/SQLite substitution for real-PostgreSQL tests, no removed DB isolation, no altered financial/ledger/idempotency/auth behavior, no branding changes, no `ProductCatalogService` changes, no skipped integration tests, no removed concurrency/idempotency tests, no raised timeouts to hide hangs, no suppressed open-handle warnings without a root-cause fix.

---

## Part 1 — Baseline (all 5 commands)

| Command | Suites | Tests | Wall-clock | Pass/Fail | Workers |
|---|---|---|---|---|---|
| `npm run test` (root unit) | 173 | 1809 | 49.5–50.3s (3 runs) | 173/173, 1809/1809 pass | `--runInBand` (1 worker) |
| `npm run test:pg` (integration) | 92 | 1690 | **902s (15.03min)**, clean epoch-timestamp measurement | 92/92, 1690/1690 pass | `--runInBand` per batch, 7 batches run strictly sequentially (`PG_TEST_CONCURRENCY=1`) |
| `npm run test:all` (unit + pg, sequential) | 265 | 3499 | derived: 50.3 + 902 = 952.3s (15.87min); confirmed by direct measurement after optimization, see Part 9 | 265/265, 3499/3499 pass | — |
| `apps/customer-mobile` `npm run test` | 12 | 98 | 14.5–16.7s (2 runs) | 12/12, 98/98 pass | jest-expo default parallel workers |
| `apps/agent-mobile` `npm run test` | 18 | 261 | 24.5–26.4s (3 runs) | 18/18, 261/261 pass | jest-expo default parallel workers |

A first `npm run test:pg` run (also concurrency=1) was executed before the clean-timing run above; it also passed 92/92 suites, 1690/1690 tests with 0 failures, but its wall-clock was lost to a shell pipe-redirection artifact (`time cmd | tee` sends `time`'s own report to a stream `tee` does not capture). It was cross-checked via first-to-last HTTP access-log timestamp span (887.0s) as a sanity check, then a second run was performed with explicit `date +%s` epoch-timestamp bracketing around the command (immune to the pipe issue) to get the authoritative 902s figure used throughout this report.

DB server itself (embedded PostgreSQL) is already running for the full session; its own startup time is not part of any `npm run` command above and is not a bottleneck for these commands as invoked in normal developer/CI usage (one long-lived server, many short-lived test-client connections).

---

## Part 2 — Ranked bottlenecks

1. **Serial batch execution in the integration runner (primary, ~85% of total wall-clock).** `test:pg` splits 92 files into 7 batches of up to 15 and, at the old default `PG_TEST_CONCURRENCY=1`, runs the 7 OS processes one after another. This is the single largest cost in the whole 5-command baseline (902s of ~982s, or pick any aggregate) — confirmed by direct experiment: running 2 batches concurrently (`PG_TEST_CONCURRENCY=2`) cuts the exact same workload from 902s to ~505s average.
2. **Default `--runInBand` on the root unit suite (secondary, 173 files/1809 tests).** Confirmed single-threaded by design decision from a prior task, not because any test needs it — `--maxWorkers=2` reproduced identical pass counts 3 separate times at ~48% less wall-clock.
3. **Default parallel (multi-worker) execution on both mobile suites being *slower* than serial, not faster.** For small suites (12 and 18 files respectively) on a 2-core box, Jest's per-worker startup/teardown overhead (spinning up `jest-expo`'s React Native environment per worker) outweighs any parallel gain; `--runInBand` was 2.4x faster for customer-mobile and ~1.5x faster for agent-mobile, both confirmed over multiple repeated runs.
4. **Per-suite PostgreSQL migration cost**, already addressed by a prior closed task (migration-template cloning via `ensureMigrationTemplateDatabase` in `test/support/pg-harness.ts`): ~930-1050ms from-scratch migration vs ~55-90ms via template clone, per suite. This mechanic was re-verified working correctly this session (zero orphaned databases after every run, confirmed via direct `pg_database` queries) and is not re-engineered — it is reused as-is.
5. **ts-jest/TypeScript compilation and NestJS DI container bootstrap per suite file.** Inherent per-file cost in both the unit and integration suites; not something safely eliminable without a redesign (see Part 8 — rejected as out of scope for this task given isolation/correctness requirements).
6. Network/DB-roundtrip latency itself is not a meaningful bottleneck — it is local loopback to an already-running Postgres server; individual HTTP-in-process request/response cycles observed in logs were typically single-digit to low-double-digit milliseconds.
7. No evidence found of: retries, test duplication, worker-pool cold-start thrashing beyond the above, or open-handle-induced hangs causing wasted wall-clock (see Part 7 below — the only prior-identified hang, Task 6's `cash-to-wallet.test.tsx`, remains fixed and does not recur in the current suite).

---

## Part 3 — Integration harness deep-dive (11 questions)

1. **Does every suite get its own DB?** Yes — `test/support/pg-harness.ts` creates a uniquely-named database per suite (via its own naming scheme), not shared across files.
2. **Full migration chain per suite?** No — a migration *template* database is built once per OS process (`ensureMigrationTemplateDatabase`), and every suite's database is created by `CREATE DATABASE ... TEMPLATE <template>` (a fast file-level clone), not by re-running all TypeORM migrations from scratch per suite.
3. **Per-suite timings?** Measured in a prior closed task: ~930-1050ms from-scratch vs ~55-90ms via template clone. Individual integration suite `Time:` values observed this session ranged ~5-15s per file (dominated by actual HTTP-in-process test assertions, not DB setup).
4. **Is DB isolation actually needed?** Yes — suites create overlapping entity data (customers, agents, wallets, transactions) with assertions on exact row counts/state; sharing a DB across suites would make tests order-dependent and flaky. Isolation is a hard requirement, not incidental.
5. **Is the harness parallel-safe?** Yes, at the OS-process level — confirmed by 3 full clean concurrency=2 runs (92/92 suites, 1690/1690 tests, 0 failures, 0 nondeterminism, 0 orphaned databases every time).
6. **Any shared mutable state across suites?** None found. `grep` across `src/` for module-level `let`/`var`/static `Map()`/`Set()` singletons returned zero matches. The outbox pattern (`src/operations/outbox.service.ts`, `outbox-event.entity.ts`) is DB-table-backed, not an in-memory singleton — it cannot leak state between suite processes.
7. **Worker-safe DB naming?** Yes — migration-template databases are named using the owning process's pid (`migrationTemplateDatabaseName()` in `pg-harness.ts`); per-suite databases use their own unique names. Two concurrent batch processes never collide.
8. **Fixed ports?** No — the NestJS app under test is driven in-process via `supertest` (no real TCP listener bound), so there is no port-conflict risk between concurrently-running batches. The one real fixed port in the whole stack is PostgreSQL itself (5432), which is a single shared server correctly designed for many concurrent client connections.
9. **Cleanup races?** `test/support/pg-template-sweep.ts` runs as `globalSetup`/`globalTeardown` per Jest process and only ever touches that same process's own pid-scoped template name — verified this session via direct `pg_database` queries showing 0 leftover `mn_it_*` databases after every successful full run, and the mechanism for templates cloning is independent across concurrent processes (no race demonstrated across 3 concurrency=2 runs totaling 3x92 suites).
10. **Jest-native `maxWorkers>1` for the integration config itself?** Deliberately kept at `maxWorkers: 1` in `jest.integration.config.js` — this is correct and intentional. The OS-process-level batching done by `scripts/run-pg-integration-tests.js` is the actual parallelism mechanism; each spawned Jest process is single-worker internally because the pid-scoped template-naming scheme assumes one process per pid (a Jest-internal worker pool sharing one pid would collide on the same template name).
11. **Any evidence of flakiness/nondeterminism introduced by concurrency?** None across 3 full concurrency=2 runs (1690/1690 identical pass count each time) plus the original, never-modified default (concurrency=1, also 1690/1690). The one known pre-existing flaky test from the prior closed PG report (`ProductCatalogService.updateProduct()` optimistic-lock race) was not observed to recur in any of this session's runs and remains explicitly out of scope (forbidden: do not touch `ProductCatalogService`).

---

## Part 4 — Parallelization safety analysis

| Factor | Status | Evidence |
|---|---|---|
| Embedded PostgreSQL | Single shared server, designed for concurrent client connections | No connection errors/pool exhaustion across any concurrency=2 run |
| Shared server (app under test) | None — app driven in-process via supertest, no bound port | No port conflicts observed |
| DB names | Unique per suite, pid-scoped for templates | 0 orphaned/colliding databases across all runs |
| Migrations | Template-clone, pid-scoped | Re-verified working, no interference across concurrent processes |
| Env vars | No test mutates shared process-wide env state observed to leak cross-suite | — |
| Global state | None found in `src/` (see Part 3.6) | grep audit, 0 matches |
| Fixed ports | None in the test harness itself | — |
| Filesystem paths | No shared-path fixtures found between integration suites | — |
| Singletons | None found | grep audit |
| Shared queues/outbox | DB-table-backed, not in-memory | Confirmed via source read |
| Audit state | DB-table-backed (append-only ledger/audit tables), not process-memory | Consistent with no-shared-state finding |
| Fixtures | Per-suite, not shared mutable files | — |

**Conclusion: "max CPU workers" is explicitly rejected as a goal.** The practical safe ceiling on this specific 2-vCPU/3.8GB hardware is:
- Unit suite: `--maxWorkers=2` (matches core count). `--maxWorkers=4` reliably drives the sandbox into near-total memory exhaustion (confirmed 3.8Gi/3.8Gi used, effective hang, required manual `kill -9` cleanup) — **never recommend above 2 on this class of hardware.**
- Integration suite: `PG_TEST_CONCURRENCY=2` (matches core count), validated 3 times full-scale, zero issues. `PG_TEST_CONCURRENCY=4` was bounded-experimented (11-file/4-batch subset, not the full suite, specifically to limit blast radius) and reliably drove memory to <150MB available with no forward progress for 25+ seconds before being deliberately killed — consistent with the unit-suite finding. **Never recommend above 2 on this class of hardware;** on a machine with materially more RAM and cores, a higher value may be safe but was not validated here and must be re-measured independently, not assumed.

---

## Part 5 — Open-handle / hang sweep

No new hang-causing open handles were found this session. The sweep covered: unresolved Promises, timers (real and fake), event listeners, HTTP/TCP servers, DB connections/DataSources, streams. Two pre-existing patterns in agent-mobile (`__tests__/home.test.tsx:102`, `__tests__/transactions-history.test.tsx:106`) were reviewed and confirmed non-hang-causing (do not hold the process open; tests complete and exit normally) — left unmodified per the forbidden list (no fixes applied where nothing is actually broken).

The one real, previously-confirmed hang in this codebase's test history — Task 6's `cash-to-wallet.test.tsx` — was already fixed in a prior closed task (`820ecee`) and does not recur; `apps/agent-mobile`'s `cash-to-wallet.test.tsx` passed cleanly in every run this session, including under the new `--runInBand` flag.

No evidence of never-resolving mocks, leaked `DataSource` instances, or unclosed listeners contributing to wall-clock in either the unit or integration suite — the dominant costs are legitimate CPU/IO work (test assertions, hashing, DB round-trips), not waiting on dead handles.

---

## Part 6 — Unit test performance experiments

| Config | Runs | Wall-clock | Result |
|---|---|---|---|
| `--runInBand` (prior default) | 3 | 49.5s, 50.3s, ~50s | 173/173, 1809/1809 pass each time |
| `--maxWorkers=2` | 3 | 25.3s, 26.6s, 26.0s | 173/173, 1809/1809 pass each time, zero correctness issues |
| `--maxWorkers=4` | 1 (aborted) | N/A — effective hang | Near-total memory exhaustion (3.8Gi/3.8Gi used), required manual `kill -9` cleanup. **Unsafe, do not use.** |

No test in the root unit suite was found to depend on cross-file global state or execution ordering (confirmed both by the grep audit in Part 3.6 and by 3 clean, deterministic `--maxWorkers=2` runs producing identical pass counts to the serial baseline). `--maxWorkers=2` is implemented as the new default (see Part 11).

---

## Part 7 — Integration test performance experiments (controlled)

| Config | Runs | Wall-clock | Result |
|---|---|---|---|
| `PG_TEST_CONCURRENCY=1` (prior default) | 1 (clean-timed; a 2nd informal run also passed but lost its wall-clock to a shell artifact) | 902s (15.03min) | 92/92 suites, 1690/1690 tests pass |
| `PG_TEST_CONCURRENCY=2` | 3 | 513s, 477s, 524s (avg 504.7s, 8.41min) | 92/92 suites, 1690/1690 tests pass **every time**, 0 orphaned databases, memory peaked ~3.2-3.7GB/3.8GB (stable, no swap, no crash) |
| `PG_TEST_CONCURRENCY=4` | 1 bounded experiment (11 files / 4 batches, not full suite) | Aborted after 25s, no progress | Memory driven to <150MB available; deliberately killed before risking the shared Postgres server; 9 orphaned databases from the aborted run were found and cleanly dropped afterward, confirming the harness's self-healing drop-if-exists logic works for a *future* run reusing the same pid, but does not retroactively clean up a differently-pid'd aborted run — a residual manual-cleanup note, not a correctness bug (see Part 16) |

`PG_TEST_CONCURRENCY=2` was repeated 3 times (exceeding the required 2-3x) specifically because it is the change being adopted as the new default — each run independently confirmed the identical 1690-test pass count, ruling out nondeterminism, deadlocks, port conflicts, and data duplication/loss from the added OS-process-level parallelism.

---

## Part 8 — Are migrations the main cost? Safe dedup assessment

No. Per-suite migration cost was already minimized by the prior closed task's template-clone mechanism (~55-90ms per suite vs ~930-1050ms from scratch) and re-verified intact and correct this session. The dominant remaining cost is **serial batch-process execution**, not migration repetition — directly demonstrated by the concurrency=2 experiment cutting total wall-clock by ~44% while *migration cost per suite is unchanged* (each batch process still independently builds its own template once).

Further migration dedup options considered and explicitly rejected:
- **A single shared template database across all batch processes:** would reintroduce a cross-process shared resource and require coordination/locking to avoid one process dropping a template mid-use by another — added complexity and a new correctness risk, for a cost (~1-1.5s per process, 7 times per run) that is negligible (<1% of the 505s concurrency=2 total).
- **Transactional rollback instead of per-suite databases:** rejected — would reduce isolation (shared connection/transaction semantics across what are currently independent, fully-isolated real databases) and risks masking real cross-transaction bugs the current design is built to catch. This directly conflicts with the "no removed DB isolation" constraint.
- **Worker-scoped (vs suite-scoped) databases:** the current design is already effectively worker(process)-scoped for templates and suite-scoped for actual test data — no further restructuring found to be safe or necessary.

**Conclusion: migrations are not the main cost and the existing template mechanism is sufficient; no further migration-dedup change is implemented.**

---

## Part 9 — Test classification

| Class | Examples | Notes |
|---|---|---|
| Unit (fast, parallel-safe) | 173 root `*.spec.ts` files | No cross-file shared state found; safe at `--maxWorkers=2` |
| Integration (real-PG, HTTP-in-process) | 92 `test/*.integration.spec.ts` | Each suite owns a dedicated DB; safe at `PG_TEST_CONCURRENCY=2` (OS-process-level, not Jest-worker-level) |
| Mobile (jest-expo, RN environment) | 12 customer-mobile + 18 agent-mobile | Small suite counts; per-worker environment startup overhead makes `--runInBand` faster than Jest's default parallel workers |
| Expensive/serial-only | None confirmed to *require* serial execution for correctness — serial was previously a blanket default, not a per-test necessity | — |
| Redundant/duplicated | None found | No duplicate test execution, no retried suites |

No deletions were made. Project separation already exists correctly (root `jest.config.js` vs `jest.integration.config.js` vs each mobile app's own `jest.config.js`) and is left as-is — each targets a genuinely different environment (plain Node/TypeScript unit, real-Postgres HTTP-in-process integration, React-Native/jest-expo).

---

## Part 10 — Targets vs measured results

| Command | Before | After | Improvement |
|---|---|---|---|
| `npm run test` | 50.3s | 26.0s | **~48%** |
| `npm run test:pg` | 902s (15.03min) | ~505s avg (8.41min) | **~44%** |
| `npm run test:all` | 952.3s (15.87min, derived) | 546s (9.1min, directly measured) | **~43%** |
| `apps/customer-mobile` test | 15.6s avg | 6.8s | **~56%** |
| `apps/agent-mobile` test | 25.5s avg | 16.9s | **~34%** |

All improvements came from **matching parallelism to actual core count (2) and to actual per-suite overhead characteristics**, not from weakening any test, removing isolation, or increasing timeouts.

---

## Part 11 — Optimizations implemented (smallest safe set)

1. **Root `package.json`:** `"test": "jest --runInBand"` → `"test": "jest --maxWorkers=2"`.
2. **`apps/customer-mobile/package.json`:** `"test": "jest --watchAll=false"` → `"test": "jest --watchAll=false --runInBand"`.
3. **`apps/agent-mobile/package.json`:** `"test": "jest --watchAll=false"` → `"test": "jest --watchAll=false --runInBand"`.
4. **`scripts/run-pg-integration-tests.js`:** default `PG_TEST_CONCURRENCY` changed from `1` to `2` (still overridable via env var; `PG_TEST_MAX_OLD_SPACE_MB` left unchanged at `3072`, matching exactly what was validated). Module-header documentation rewritten to record the measured evidence and the explicit concurrency=4 rejection, so a future reader does not need to re-derive this from scratch.

Nothing else changed. `jest.integration.config.js`'s `maxWorkers: 1` is intentionally untouched (parallelism for integration tests happens at the OS-process/batch level, not inside Jest's own worker pool — see Part 3.10). No test file, migration, harness logic, or production code was modified.

---

## Part 12 — Financial-safety regression after optimization

The full unit suite (`npm run test`, `--maxWorkers=2`) and full integration suite (`npm run test:pg`, `PG_TEST_CONCURRENCY=2`) were both run to 100% completion post-optimization (see Part 1/7/9 numbers) with **zero change in pass count, zero new failures, zero skipped tests** versus the pre-optimization baseline. This full-suite run inherently includes every financial/idempotency/concurrency/auth-sensitive suite; the following were specifically confirmed passing in the post-optimization run's logs:

- `test/v1-w2w-recovery-audit-01.integration.spec.ts` (customer W2W recovery/audit)
- `test/a5-transfer-lifecycle.integration.spec.ts`, `test/transfer-lifecycle.service.spec.ts`, `test/transfer.service.spec.ts`, `test/transfer-reconciliation.service.spec.ts`, `test/internal-transfer-gate.service.spec.ts` (W2W transfer lifecycle/reconciliation)
- `test/v1-customer-05-transaction-pin-security.integration.spec.ts`, `test/a24-customer-transaction-pin-hardening.integration.spec.ts` (customer PIN-auth)
- `test/v1-agent-05-transaction-pin-security.integration.spec.ts` (agent PIN-auth)
- `test/a13-agent-cash-in.integration.spec.ts`, `test/a14-agent-cash-out.integration.spec.ts` (agent Cash-In/Out)
- `test/a15-agent-cash-to-cash.integration.spec.ts`, `test/a16-agent-cash-to-cash-claim.integration.spec.ts`, `test/a17-agent-cash-to-cash-expiry.integration.spec.ts`, `test/v1-commercial-decision-03c-cash-to-cash-snapshot.integration.spec.ts` (agent Cash-to-Cash + claim/expiry/snapshot)
- `test/v1-test-01-agent-cash-to-cash-retry-exhaustion.spec.ts` (agent idempotency/retry-exhaustion)
- `test/v1-agent-mobile-idempotency-persistence-01.integration.spec.ts` (Task 5/6 agent mobile idempotency persistence)
- `test/v1-mobile-idempotency-recovery-01.integration.spec.ts` (Task 5/6 mobile idempotency recovery)
- Both mobile apps' full suites, including every idempotency-relevant file (`cash-to-cash.test.tsx`, `cash-to-cash-claim.test.tsx`, `cash-to-wallet.test.tsx`, `wallet-to-cash.test.tsx`, `transfer.test.tsx`, `pending-operation.test.ts`, `agent-api.test.ts`, `api-client.test.ts` — agent-mobile 18/18 and customer-mobile 12/12, all passing) run under the newly-added `--runInBand` flag.

**Result: identical to pre-optimization baseline in every respect — same pass counts, no new flakiness, no nondeterminism.**

---

## Part 13 — Restated do-not-touch list

No changes were made to: financial/ledger/idempotency/authentication logic, `ProductCatalogService`, CORS configuration (confirmed intentional/safe, standing), `wallet_accounts`/`customer_wallets` handling, branding, V2 features, test assertions (none weakened or removed), DB isolation (none removed), Jest timeouts (none raised), or open-handle warnings (none suppressed — only genuinely confirmed-safe patterns left alone).

---

## Part 14 — Summary

Baseline `test:all` (sequential unit + integration) took ~15.87 minutes. The root cause was serial execution at a parallelism level (1) far below this sandbox's actual core count (2), in both the unit suite (`--runInBand`) and the integration batch runner (`PG_TEST_CONCURRENCY=1`), plus a mismatched default (parallel workers) on the two small mobile suites where per-worker startup overhead exceeded any theoretical parallel gain. After matching concurrency to the measured, safe ceiling for this hardware (2, confirmed repeatedly; 4 confirmed unsafe/OOM-inducing on both axes), `test:all` now completes in ~9.1 minutes (~43% faster), with identical pass counts (3499/3499) and zero correctness regressions across 3+ repeated validation runs for every changed command.

---

*(See the final 16-section report delivered in the session for exact commit hash, working-tree state, and recommended standard commands.)*
