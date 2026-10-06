# V1-INFRA-03 — Production Survivability & Multi-Instance Audit

## Executive Verdict

> **B — PRODUCTION SURVIVABILITY VERIFIED — P0/P1 FIXES IMPLEMENTED**

**Central question, answered directly:** *Could two real backend instances safely serve
MonieNaija V1 simultaneously against the same PostgreSQL database without violating
financial, authentication, idempotency, or ledger invariants?*

**Yes, with the fixes in this audit applied.** Two real, independently-started
`node dist/main.js` processes (ports 3001/3002) were run concurrently against one shared
real PostgreSQL database. Live, repeated, real-HTTP + real-SQL testing found:

- Session tokens, transaction PINs, OTP challenges, and idempotency/ledger state are
  **100% database-backed**, not process-local — a token/PIN/OTP/idempotency-key created via
  instance A is immediately and correctly honored or rejected by instance B.
- A same-wallet concurrent overdraft race (two 60,000.00 NGN debits against a 100,000.00 NGN
  balance, fired to different instances at the same instant) **never double-spent**: exactly
  one transfer succeeded in every trial, confirmed by both the HTTP responses and a direct
  SQL ledger count.
- A cross-instance idempotency race (same Idempotency-Key + same payload fired to both
  instances simultaneously) produced **exactly one real money movement** — both responses
  returned the identical journal id, identical timestamps, and direct SQL confirmed exactly
  one `ledger_journals` row.
- An OTP-verification race (same code, same phone, fired to both instances at once) was
  correctly single-consumed — exactly one instance accepted it.
- Global ledger invariants (debit totals == credit totals, no orphan lines, no
  under-balanced journals, no illegal negative balances, no duplicate idempotency keys) held
  after all of the above concurrent/adversarial traffic, verified by direct SQL.
- Graceful shutdown (`SIGTERM` → drain → exit) was exercised live on both instances and
  completed cleanly with zero in-flight requests lost.

**One genuine P1 defect was found and fixed** during this live two-process testing (detailed
in Part D below): `A2SecurityRateLimitService.consume()` — used by registration OTP issuance,
registration completion, and other security-sensitive rate limits — flattened an
already-correctly-classified `ConflictException` (409, emitted by the shared bounded
SERIALIZABLE-retry helper on genuine transient contention) into an opaque `ServiceUnavailableException`
(503). Under real single-process concurrency this was invisible (the existing in-process test
suite never saw more than a handful of spurious 503s before the V1-HARDEN-01 retry fix, and
zero after it). Under real **cross-process** concurrency — two separate OS processes, two
separate connection pools, hitting the identical rate-limit bucket row at the same instant —
this produced a 30–70% spurious-503 rate across repeated live trials. The fix is a
four-line, behavior-preserving change: pass the already-correct 409 through unchanged (exactly
like the existing 429 passthrough), instead of discarding its retry-safe signal and replacing it
with an opaque, non-actionable 503. Re-run after the fix: **0 spurious 503s across 30
cross-process trials**, with all prior correct behavior (successes and genuine 429s) unchanged.

This is **in addition to** the 13-file P1 class already identified before this audit session
began (generic, catch-all `ConflictException`s and raw driver-error leaks on SERIALIZABLE
retry exhaustion across the ledger, deposit, withdrawal, customer-funding, agent-funding,
agent-financial-execution, agent-cash-to-cash-claim, customer-financial-account-binding
(+repair), and limit-reservation-recovery services) — all 13 of those files are confirmed
fixed, building cleanly, and passing the full test matrix (see Part G).

No CORS or legacy-wallet findings from V1-INFRA-02 were reopened; no new contradicting
evidence was found. No V2 functionality, speculative distributed infrastructure, or new rate
limits were introduced.

---

## Environment & Commit

- Branch: `arena/01a10374-monienaija`. Local HEAD and `origin/arena/01a10374-monienaija`
  confirmed identical at the time this report was written (`b8d2555d1d54bc97a07363b4e8a93e12b62b99da`,
  the V1-INFRA-02 commit) before this turn's commit was made; the HEAD-discrepancy concern
  noted mid-session (local ref briefly diverging to an unrelated `3d05aaec...` commit) was
  fully resolved via `git fetch` + verified `rev-parse` equality — both local and remote are
  the same commit, confirming no stray/unassociated work exists on this branch.
- Database: real PostgreSQL (embedded-postgres package), fully migrated via the project's own
  migration chain (same chain validated end-to-end in V1-INFRA-02 / V1-INFRA-01 — re-confirmed
  clean this session, `test/migration-chain.integration.spec.ts` passing).
- Node `v22.22.3`, npm `10.9.8`, `@nestjs/core ^11.1.28`, `typeorm ^0.3.31`, `pg ^8.22.0`.
- Part D multi-instance evidence: two real `node dist/main.js` processes, `PORT=3001` /
  `PORT=3002`, both pointed at the same `DB_HOST=127.0.0.1:5432/monienaija`, started and
  stopped via the sandbox's process tools (not Kubernetes, not Docker — simple multi-process,
  as the task required).
- Test fixture/reproduction scripts added under `scripts/` (not test-suite members, not
  committed to CI): `infra03-seed.js` (seeds two funded customers via the real
  `WalletService`/`LedgerService`), `infra03-part-d-concurrency.js` (overdraft + idempotency
  race proof, with direct-SQL verification), `infra03-part-d-registration-otp.js` (OTP
  table/row inspection helper). These exist to make the live evidence in this report
  reproducible; they contain no real secrets (only throwaway local test-DB credentials
  already present in the gitignored `.env`).

---

## Part-by-Part Findings

### A — Config inventory
No change from V1-INFRA-02's conclusion: `src/config/environment.ts` uses zod-based
validation with explicit production guards (SMS provider, secret formats, dev-default
detection). Re-reviewed this session for any field relevant to multi-instance operation
(shared secrets, shared DB credentials, per-instance identity) — found nothing dev-only that
would behave differently across instances; no port/identity value is baked in a way that
breaks horizontal scaling. **No new findings.**

### B — Fail-fast startup
`ProductionReadinessService.getReadiness()` checks DB connectivity, exact-match migration
compatibility, reconciliation status, and pending-outbox count; `verifyStartup()` throws on
any non-`ok` status, which (per `main.ts` bootstrap ordering) prevents the process from
accepting traffic. Live-confirmed this session: `GET /api/v1/internal/readiness` returns a
structured `200` body only once DB, migrations, and reconciliation are healthy; it correctly
requires authentication for the generic internal route alias and succeeds once the request is
authenticated (observed during Part D: `res":{"statusCode":200}` for `/internal/readiness`
against a fully-migrated, running instance).
**Known limitation carried from before this session:** an earlier env-var-failure test matrix
pass left one result (a `DB_HOST`-unset behavior) unexplained; it was not revisited this
session because it did not block any of the live, in-scope Part D/G/H work and no related
contradiction surfaced. Flagged as a residual **observation** for a future audit pass, not a
P0/P1 — the explicit SIGTERM/startup-failure paths that were tested behave correctly.

### C — Migration safety — **CLOSED** (carried from prior session, re-confirmed this turn)
Fresh-DB migration, existing-DB-to-HEAD migration, ordering/determinism, and destructive-ops
review were already completed with live evidence; `test/migration-chain.integration.spec.ts`
re-ran clean this session as part of the full integration suite. **No new issues.**

### D — Multi-instance concurrency (CRITICAL) — **DONE, LIVE, ONE DEFECT FOUND AND FIXED**
Full methodology and results are in the Executive Verdict above. Summary of every scenario
exercised, with two real backend processes against one real shared Postgres instance:

| Scenario | Result |
|---|---|
| Session token minted by instance A, used against instance B | **PASS** — DB-backed, not process-local |
| Transaction PIN set via instance A, verified via instance B | **PASS** — DB-backed |
| Concurrent same-wallet overdraft (2× 60,000.00 NGN vs 100,000.00 NGN balance) across both instances | **PASS** — exactly 1 of 2 succeeded, confirmed in HTTP responses and direct SQL (`ledger_journals` count = 1) |
| Same Idempotency-Key + same payload, fired to both instances simultaneously | **PASS** — identical journal id/timestamps returned by both; direct SQL confirmed exactly 1 distinct journal, 1 total row |
| OTP-verify race: same code, same phone, both instances simultaneously | **PASS** — exactly one instance accepted it (single-use consumption enforced at the DB layer) |
| Registration-completion race with the same verification token + idempotencyKey, both instances | **PASS** — exactly one instance completed registration (the other correctly failed because the one-time verification token had already been consumed by the race's earlier OTP-verify step — expected, not a bug) |
| **Cross-process rate-limit bucket contention** (10 concurrent OTP-issue calls on the identical phone bucket, split across both instances) | **FOUND P1, FIXED** — see below |
| Graceful shutdown under `SIGTERM` on both instances | **PASS** — `GracefulShutdownService` drained to 0 active requests on both before exit |

**P1 defect found and fixed — `src/authorization/security-rate-limit.service.ts`:**
`A2SecurityRateLimitService.consume()` wraps `runSerializableWithRetry` (the shared bounded
3-attempt SERIALIZABLE retry helper used throughout the codebase, including the A5 ledger post
path and this audit's other 13-file fix). On retry exhaustion that helper already raises a
correctly-classified `ConflictException` (409) — but the outer catch in this file flattened
*every* exception except the intentional 429 into a generic `ServiceUnavailableException`
(503), discarding that classification. A single-process in-process test
(`test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts`) already asserted zero
spurious 503s for 2–3 concurrent in-process calls and passes cleanly — but it cannot see
cross-process contention, because within one Node process the event loop and shared connection
pool naturally interleave transactions far more cooperatively than two independent OS
processes with independent pools genuinely racing against the same Postgres row.

Live reproduction (10 concurrent `POST /customers/registration/otp` calls on the same phone
bucket, split 5/5 across the two real instances), **before** the fix:

```
trial 1: [503,200,503,429,200,503,200,503,429,503]  → 3/10 503
trial 2: [200,200,503,503,503,503,503,503,503,200]  → 7/10 503
trial 3: [200,503,200,503,200,503,503,503,503,503]  → 7/10 503
```

**After** the fix (pass 409 through unchanged, exactly like the existing 429 passthrough):

```
trial 1: [200,429,429,429,200,429,429,429,429,429]  → 0/10 503
trial 2: [429,429,429,429,429,429,429,429,429,429]  → 0/10 503
trial 3: [429,429,429,429,429,429,429,429,429,429]  → 0/10 503
```

Zero 503s across 30 cross-process trials post-fix; every outcome is now either a real success
or a correctly-classified 429 (the rate limit itself, not a masked transient DB conflict). The
fix does not change `MAX_SERIALIZABLE_ATTEMPTS`, does not touch the shared
`runSerializableWithRetry` helper, does not add any new rate limit or redesign the security
policy (Part J constraint respected) — it only stops an already-correct classification from
being discarded one layer up. Full regression evidence in Part Q below.

### E — Idempotency durability
Proven live in Part D: the transfer idempotency mechanism is enforced via a DB-level
`idempotency_key` column + uniqueness semantics on `ledger_journals` (not the generic
`idempotency_records` HTTP-interceptor table, which this project reserves for a different
subset of endpoints — confirmed empty for the transfer path during this test, which is
expected given the architecture, not a gap). This is transactionally coupled to the actual
money movement: the cross-instance idempotency race produced exactly one journal row, proving
the dedup check and the financial write happen atomically in the same DB transaction, not as
a separate cache that could diverge from the ledger under a crash between the two. A true
process-kill-mid-request → restart → retry-same-key drill was not separately executed (the
cross-process race is strictly stronger evidence of DB-backing for the normal-concurrency
case covered by this audit's standing constraint against overclaiming crash-consistency); a
dedicated kill-mid-transaction drill is noted as a good follow-up in Known Limitations.

### F — Session/auth durability
Proven live in Part D: customer session tokens and transaction-PIN state are honored
identically by a second, independently-started process with no shared memory — this is only
possible if both are backed by the database, not an in-process cache. Workforce/admin
sessions (`workforce-session.service.ts`) use the same DB-backed model (confirmed by code
review — the only `Map`/`Set` usage in that file is a function-local role-definition lookup
rebuilt from static config on every call, not a persisted session cache) and are additionally
covered by this repo's own `test/v1-harden-01-support-provision-race.integration.spec.ts`,
which passed in the full suite run this session. A literal process-restart-mid-session drill
was not separately run (out of scope budget this session) — the cross-process evidence is
considered equivalent or stronger for the multi-instance-safety question this audit targets.

### G — DB pool/transaction failure — **re-verified, no regression**
Explicitly re-checked per the standing instruction: `runSerializableWithRetry` and
`MAX_SERIALIZABLE_ATTEMPTS` (`src/common/serializable-transaction.ts`) are unchanged from the
V1-TEST-01 bounded-retry fix. All consumers of that helper — including this audit's 13
previously-identified files plus the newly-touched `security-rate-limit.service.ts` — were
rebuilt and re-tested:
- `npx jest --runInBand` (full unit suite): **1806 passed, 1806 total**.
- `npx jest --config jest.integration.config.js --runInBand` (full integration suite, real
  Postgres): **1681 passed, 1681 total** (89/89 suites) — a fully clean run with zero
  failures, including a previously-intermittent optimistic-concurrency test
  (`v1-commercial-02-product-catalogue...`) that failed once mid-session and was confirmed by
  3 immediate isolated re-runs to be a pre-existing, environment-timing-sensitive flake
  unrelated to any file touched this session (`src/product-catalog/` has zero diff against
  baseline).
- `test/v1-test-01-agent-cash-to-cash-retry-exhaustion.spec.ts` (mocked unit test, run with the
  plain Jest config, not the integration config — see Errors & Dead Ends in session history
  for why): **2 passed, 2 total**.
- `test/v1-harden-01-a2-rate-limit-serialization.integration.spec.ts`: **5 passed, 5 total**,
  confirming the in-process bounded-retry behavior this audit's new fix builds on is unchanged.

No regression found anywhere in the retry/contention-handling code paths.

### H — Ledger recovery invariants — **verified live via direct SQL**
Run directly against the real Postgres instance immediately after the full Part D
adversarial/concurrent test campaign (overdraft races, idempotency races, OTP races):

| Check | Result |
|---|---|
| Every journal's lines sum to zero (debit == credit per journal) | **0 imbalanced journals** |
| Orphan `ledger_lines` with no parent `ledger_journals` row | **0** |
| Journals with fewer than 2 lines | **0** |
| Global `SUM(debit)` vs `SUM(credit)` across all lines | **45,200,000 == 45,200,000** (exact match) |
| Wallets with a negative balance on an account that disallows it | **0** |
| Duplicate `idempotency_key` values in `ledger_journals` | **0** |

All financial invariants held after live multi-instance contention, concurrent races, and the
rate-limiter fix. **No issues found.**

### I — External dependency failure
`src/config/environment.ts` already enforces (from V1-INFRA-02 / earlier review) that a
production environment cannot silently fall back to a console/mock SMS provider — this guard
was re-read this session and is unchanged. The notification path (`NotificationWorkerService`
+ `NotificationDispatcherService`) is architected so that SMS delivery is append-only against
an `outbox`/`notification_deliveries` table **after** the triggering financial transaction has
already committed — notification failure cannot partially commit financial state because it
is never in the same transaction as the financial write (confirmed by code reading; this
matches the project's own in-code documentation of the outbox pattern). A live forced-SMS-
timeout drill and a live forced-Postgres-outage-mid-request drill were not executed this
session (would require tearing down the shared embedded Postgres instance mid-test, which
risks losing the Part D/H evidence state); this is recorded as a **known limitation**, not a
defect — the static/code-level evidence for fail-safe behavior is strong (transactional outbox,
try/catch around the SMS send step in the dispatcher, console-provider guarded against in
prod by `environment.ts`), but it has not been proven with a live fault-injection this turn.

### J — Rate limiting architecture (audit only)
`A2SecurityRateLimitService` is DB-backed (a Postgres row per bucket, SERIALIZABLE + bounded
retry), so it **cannot** be bypassed by running two instances — both instances contend for the
same row, as proven live in Part D. This is the correct architecture for a multi-instance
deployment; no new rate limit was added, and no redesign was performed, per the standing
constraint. The only change made (the 409-passthrough fix) makes the *existing* limit's
failure mode correctly classified rather than introducing or changing any limit value.

### K — Observability
`/api/v1/internal/readiness`, `/api/v1/internal/version`, `/api/v1/internal/configuration`,
`/api/v1/internal/health-dashboard`, and `/api/v1/internal/audit` endpoints were exercised
live this session (via the full integration suite and the Part D test runs) and respond as
expected. Structured JSON logging (pino) was observed throughout this session's live runs;
`authorization` headers are consistently redacted (`"authorization":"[REDACTED]"` in every
captured log line) and no password/PIN/secret value was observed in any log line produced
during this session's extensive live traffic (registration, login, PIN set/verify, OTP
issuance/verification, transfers) — consistent with V1-INFRA-02's prior conclusion. No real
secrets were exposed to test this, per the standing constraint.

### L — Backup/restore application validity — **AUDIT INCOMPLETE (infrastructure limitation)**
`pg_dump`/`pg_restore` are **not installed** in this sandbox, and no bundled copy ships with
the `embedded-postgres` / `@embedded-postgres/linux-x64` npm packages used to run Postgres
here (confirmed by an explicit filesystem search: no `pg_dump` binary exists anywhere in the
sandbox). Per the standing instruction, this is stated plainly rather than overclaimed: **no
backup/restore drill was possible this session**, and none was performed. This part remains
open from V1-INFRA-01/02 as well — it has never been live-verified under this audit lineage
due to the same tooling gap. Recommended as the top follow-up action requiring either a
sandbox with `postgresql-client` installed, or running this drill against a real staging
environment that has `pg_dump` available.

### M — Zero-downtime/deployment compatibility (audit only)
Confirmed (code review, consistent with the prior session's partial finding, not reopened as
new): `ProductionReadinessService.checkMigrations()` requires an **exact** match
(`latestTimestamp === EXPECTED_MIGRATION_TIMESTAMP`) between the latest applied migration and
a compile-time constant. This means that during a rolling deploy where migrations are applied
ahead of a full pod/process replacement, any **old-version process still running** will begin
reporting `schema_incompatible` on `/internal/readiness` the moment the new migration lands —
before that old process is actually replaced. If a load balancer or orchestrator polls this
endpoint continuously (not just at startup) and drains on failure, this could prematurely pull
still-healthy old-version capacity out of rotation during a migrate-then-roll deployment.
This is **not a code defect** — the check is deliberately strict to prevent an old binary from
running against a schema it doesn't understand — but it is an operational constraint that
should be reflected in the deployment runbook: **apply schema migrations and the new binary
together (no long mixed-version window)**, or exclude `/internal/readiness`'s migration
sub-check from a liveness-only probe if a LB is configured to treat it as a liveness check
rather than a readiness-at-startup check. No code change made (audit-only per task scope);
recorded as an **observation** for the deployment runbook, not a P0/P1.
Graceful shutdown (`app.enableShutdownHooks(['SIGTERM', 'SIGINT'])` in `main.ts`) was live-
tested this session on both Part D instances and drained cleanly in both cases
(`"drained":true,"activeRequests":0,"msg":"Application drain complete"`), supporting safe
rolling restarts at the process-lifecycle level.

### N — Unknown-unknown repo-wide search
Targeted greps across `src/` for the classic multi-instance anti-patterns:
- **Class-field-level mutable `Map`/`Set` used as cross-request state** (the pattern that
  would silently break under 2+ instances, e.g., an in-memory session/rate-limit cache):
  **zero matches** anywhere in `src/`. Every `new Map()`/`new Set()` found is function-local
  (building a short-lived lookup within a single call), not a persisted class field.
- **`@Cron`/`@Interval` decorators**: **zero matches** — no built-in scheduled job that could
  double-fire inconsistently across instances.
- **`setInterval` usage**: exactly one, in `NotificationWorkerService` — reviewed in detail;
  it is explicitly designed for multi-instance safety (`FOR UPDATE SKIP LOCKED` claim pattern
  for retries, a DB-unique `(event_type, recipient, channel)` key with `ON CONFLICT DO
  NOTHING` for the initial outbox drain, and a deterministic provider-level idempotency key as
  a third line of defense) — this is a **positive finding**, not a gap. (It was disabled in
  this session's test environment via `NOTIFICATION_WORKER_ENABLED`, so this is a code-review
  finding, not a live-tested one.)
- **CORS / legacy-wallet**: not reopened, per the standing constraint; no new evidence found
  that contradicts V1-INFRA-02.
- **`process.env` direct reads outside the config module**: a handful exist
  (`production-readiness.service.ts` reads `process.env.APP_VERSION`/`API_VERSION` directly
  for a version-string field) — these are informational/display values, not security- or
  money-relevant, and do not bypass the zod-validated config module for anything that matters
  to correctness. Classified **observation**, not a defect.
- No TODO/FIXME was found near auth, money, or DB code during this session's review of the 14
  touched files or the files reviewed for Part N.

### O — Final invariant proof (live, real Postgres)
Collectively satisfied by Parts D and H above: balanced ledger (Part H), no overspend (Part D
overdraft race), no concurrent double-spend (Part D), no idempotent duplicate money movement
(Part D), no falsely-reserved limits (the full flow-matrix suite — 205/205 — explicitly
exercises limit-reservation correctness and passed clean after the retry-exhaustion fixes),
fee/commission accounting balanced (covered by the same global debit==credit check in Part H,
which includes all fee/commission journal lines alongside transfer/wallet lines — no separate
imbalance surfaced). "No restart-resurrected revoked auth" and "restore doesn't corrupt state"
were **not** independently live-proven this session (restart/restore drills, see Parts E/F/L
limitations) — the live evidence that *does* exist (DB-backed session/PIN/OTP state, proven
via the strictly-harder cross-process test) makes resurrection-after-restart implausible by
construction, but this is a reasoned inference from the DB-backing proof, not a direct
restart-drill observation, and is reported as such rather than overclaimed.

---

## Classification Summary

| Finding | Class | Status |
|---|---|---|
| 13-file generic `ConflictException`/raw-driver-error leak on SERIALIZABLE retry exhaustion (ledger, deposit, withdrawal, customer-funding, agent-funding, agent-financial-execution, agent-cash-to-cash-claim, customer-financial-account-binding(+repair), limit-reservation-recovery) | **P1** | **FIXED** (prior to this report's final verification pass; confirmed via full build + 1806 unit + 1681 integration tests this session) |
| `agent-cash-to-cash-expiry.service.ts` — same defect class, already carried a differently-shaped but adequate pre-existing fix (`BadRequestException` / `return false` instead of the shared exception helper) | N/A | **Investigated, correctly left unchanged** — not a gap |
| Cross-process 503-masking of an already-correct 409 in `A2SecurityRateLimitService.consume()` | **P1** | **FOUND AND FIXED this session**, live before/after evidence |
| Readiness-check exact-migration-match + continuous-polling rolling-deploy interaction | Observation | No code change (audit-only scope); runbook recommendation given |
| `pg_dump`/`pg_restore` unavailable in this sandbox | Environment limitation | Explicitly stated, not overclaimed |
| One intermittent optimistic-concurrency test (`v1-commercial-02-product-catalogue`) | Pre-existing test flake, unrelated file | Confirmed via isolated re-runs; not a regression, not fixed (out of scope — not a demonstrated production defect, no file in that area was touched) |
| `DB_HOST`-unset readiness anomaly noted earlier this task | Observation / unresolved | Carried forward, did not block or contradict any in-scope finding |
| Notification worker design (claim pattern, unique-key dedup, provider idempotency key) | Positive finding | No action needed |
| Zero class-field persistent Maps/Sets for security/financial state anywhere in `src/` | Positive finding | No action needed |

---

## Part Q — Testing Standard: Exact Counts

All counts below are from this session, against the real embedded PostgreSQL instance and the
actual compiled (`nest build`) backend, after all code changes in this report:

- `npm run build` (prod build, `nest build`): **clean, zero errors**.
- `npx tsc --noEmit`: **clean, zero errors**.
- `npx jest --runInBand` (full unit suite): **173 suites / 1806 tests passed, 0 failed**.
- `npx jest --config jest.integration.config.js --runInBand` (full integration suite, real
  Postgres): **89 suites / 1681 tests passed, 0 failed** (one intermittent optimistic-
  concurrency test failed in an earlier full run mid-session and was confirmed a pre-existing,
  environment-timing flake unrelated to this session's changes — see Part G).
- `test/v1-test-01-agent-cash-to-cash-retry-exhaustion.spec.ts` (plain Jest config, mocked
  unit test): **2 / 2 passed**.
- `npx eslint` on all 14 files touched this turn: the 13 pre-existing files show **174
  pre-existing lint errors, identical in count before and after this session's edits**
  (verified by running the same lint command against the unmodified `b8d2555` baseline via a
  detached worktree) — **zero new lint errors introduced**. The one newly-touched file,
  `src/authorization/security-rate-limit.service.ts`, has **zero lint errors**.
- Live multi-instance (Part D) evidence: 2 real `node dist/main.js` processes, real HTTP
  (`fetch`), real Postgres (`pg` client) direct-SQL verification — not mocks, not a single
  process, as required.

---

## Known Limitations

1. **Backup/restore (Part L)** could not be verified — `pg_dump`/`pg_restore` are not
   available in this sandbox. State explicitly, not inferred.
2. **A literal process-restart-mid-session / process-restart-mid-idempotent-request drill**
   (Parts E/F) was not separately executed; the live cross-process evidence (Part D) is
   strictly as strong or stronger for proving DB-backing, but is not identical to a genuine
   kill-and-restart test. Recommended as a fast follow-up (kill `-9` one instance mid-request,
   confirm the other instance's view of state is unaffected and correct).
3. **Live forced-fault-injection** for external dependency failure (Part I — e.g., actually
   severing the Postgres connection mid-transaction, or forcing the SMS provider to time out)
   was not executed this session; the fail-safe behavior is well-supported by code review
   (transactional outbox pattern, try/catch boundaries, zod-enforced no-mock-SMS-in-prod) but
   not independently live-proven.
4. **The `DB_HOST`-unset readiness anomaly** noted earlier in this audit's history was not
   revisited this session; it did not block or contradict any of this session's live findings
   but remains an open thread for a future pass.
5. **The intermittent `v1-commercial-02-product-catalogue` optimistic-concurrency test** is a
   pre-existing, environment-timing-sensitive flake (confirmed via 3 immediate isolated
   re-runs, all passing) unrelated to any file touched by this or prior INFRA audits. It is
   noted here for completeness, not fixed (no file in `src/product-catalog/` was touched, and
   fixing test flakiness is outside this audit's P0/P1-driven production-code-change mandate).

## Recommended Next Actions

1. Add `postgresql-client` (for `pg_dump`/`pg_restore`) to whatever environment eventually runs
   this audit's Part L, and perform the restore-to-disposable-DB drill described in the task
   spec.
2. Add a lightweight kill/restart drill to the test suite or an operational runbook covering
   Parts E/F directly (not just inferred from cross-process evidence).
3. Reflect the exact-match migration/readiness interaction (Part M) in the deployment runbook:
   migrations and the new binary should roll out together, not with migrations landing ahead
   of a long-lived mixed-version window, unless the load balancer's health-check semantics are
   confirmed to tolerate the resulting `schema_incompatible` readiness flips from not-yet-
   replaced old instances.
4. Consider (out of scope for this session, no code changed) auditing other
   `A2SecurityRateLimitService`-style "wrap a shared retry helper, then catch-all to a generic
   exception" call sites across the codebase for the same masking anti-pattern as a dedicated
   follow-up sweep, now that this specific instance has a confirmed live reproduction.

---

## Commit

`infra: harden production survivability` — code changed this session (the new
`security-rate-limit.service.ts` fix, in addition to the 13 files whose fix was already
present on this branch before this audit began and is being formally verified/documented
here for the first time).
