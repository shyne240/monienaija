# Arena 3D — continuation record

This is the durable, tracked continuation record required by the mission. It is updated **before**
approaching tool-call limits so completed implementation is never left exclusively in an
uncommitted working tree.

**Latest pushed commit:** see the top of `git log --oneline -5` on `arena/defdd0fd-monienaija`.
**Current active branch:** `arena/defdd0fd-monienaija`.
**Base commit branched from:** `004dd80008edbadc41cebf3c67222d6abbcd2cff`.

> **Current position — read this first.** Everything below is a chronological log; earlier
> checkpoints describe states that have since been superseded and are kept only as history. The
> authoritative current state is **Checkpoint 9** at the end of this document.
>
> | Gate                                      | Current result                     |
> | ----------------------------------------- | ---------------------------------- |
> | Root unit suite                           | 257/257 suites, 2981/2981 tests    |
> | Full PostgreSQL matrix (authoritative)    | 153/153 suites, 2751 tests, exit 0 |
> | Isolated KYC sweep (11 suites, run alone) | 11/11 suites, 149/149 tests        |
>
> Sections §5 "Outstanding implementation" and §6 "Exact next action" at lines ~93 are from the
> **first** checkpoint and are fully discharged; do not action them.

---

## 1. Recovery source

| Question                                        | Answer                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Previous active arena branch                    | `arena/5b239ff5-monienaija` (Arena 3C)                                                                                                                                                                                                                  |
| **Exact recovery source commit**                | `004dd80008edbadc41cebf3c67222d6abbcd2cff` — _`feat(kyc): govern assurance capabilities and test policies`_                                                                                                                                             |
| Was the mission's `69a09bb` checkpoint final?   | **No.** `git ls-remote origin refs/heads/arena/5b239ff5-monienaija` returns `004dd80`, which is 10,798 insertions ahead of the named `69a09bb` checkpoint.                                                                                              |
| Is any remote Arena 3C HEAD newer than 004dd80? | **No.** Verified with `git ls-remote` after a full `git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune`. `69a09bb` does not exist in the remote at all, so the mission-prompt checkpoint reference was superseded by Arena 3C's later work. |
| Unified application acceptance baseline         | `75300342666b7acc25207667a4a262fb23d4e191` (= remote `arena/ca576774-monienaija`) — confirmed present and unmodified.                                                                                                                                   |
| Recovery method                                 | The active branch was created from `004dd80` directly. No cherry-pick, reset or replay was needed: the branch **is** the recovered tree. Nothing was overwritten and no frozen branch was modified.                                                     |

`004dd80` is a shallow-clone grafted root in this sandbox (`git rev-list --count` = 1, no parent
recorded). This is a clone-depth artifact only; the tree is complete and `git cat-file -t` resolves
every path.

## 2. Environment established

Measured in this sandbox, not assumed:

| Resource     | Value                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| CPU          | 2 vCPU                                                                 |
| RAM          | 3,939 MB total / 3,661 MB available                                    |
| Disk         | 21 GB total, 19 GB available on `/`                                    |
| Node / npm   | v22.22.3 / 10.9.8                                                      |
| PostgreSQL   | 18.4 embedded (`@embedded-postgres/linux-x64`), disposable socket-only |
| Dependencies | `npm ci` — 979 packages, clean install                                 |

Dependency install note: `node_modules` was absent, so `npm ci` was executed. No lockfile change.

## 3. Baseline acceptance (run before any change)

Executed on the recovered tree at `004dd80`, before implementing anything.

### 3.1 Root unit suite — PASS

```sh
NODE_ENV=test node -r ./test/support/mission-25c-network-guard.cjs \
  ./node_modules/jest/bin/jest.js --runInBand
```

```text
Test Suites: 255 passed, 255 total
Tests:       2957 passed, 2957 total
UNIT_EXIT=0
```

### 3.2 PostgreSQL integration matrix — BASELINE HAS A REGRESSION

```sh
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_CONCURRENCY=1 \
  PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
  DB_HOST=127.0.0.1 DB_PORT=<disposable> DB_USER=arena_pg_test \
  DB_PASSWORD=arena-disposable-test-only DB_NAME=postgres \
  node scripts/run-pg-integration-tests.js
```

Environment note (required, documented in `scripts/prepare-pg-test-env.js`): a first attempt without
a prepared `.env` failed **409 tests** with `Workforce authentication disabled` / `401`. That is an
environment defect, not an application defect — the suites deliberately do not override
`A2_WORKFORCE_CONFIG`. Running `node scripts/prepare-pg-test-env.js --create-if-missing` (git-ignored
`.env`, committed public placeholders only) removed it.

**Remaining genuine failures on the recovered tree** (observed, not yet fixed at the time of this
entry):

| Count | Message                                                                                | Root cause                                                                                     |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 139   | `HttpException: No active limit profile is assigned for this financial operation`      | `requireConfiguration: true` added to entry points that previously ran without it              |
| 25    | `HttpException: Institutional KYC tier-limit enforcement is operationally disabled`    | `requireKycTierPolicy: true` on CUSTOMER paths with `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` unset |
| 1     | `HttpException: No applicable financial limit rules are configured for this operation` | same class as above                                                                            |

These are **real regressions in the recovered tree**: the accepted unified baseline
(`75300342`) set neither flag, and its 153 suites / 2,750 tests passed. They must be repaired
without weakening the mission-mandated fail-closed controls.

## 4. Implementation matrix — see `MONIENAIJA-KYC-PROVIDER-AND-TIER-AUTOMATION-HANDOFF.md`

The full classification table with evidence links is maintained in the final handoff document.

## 5. Outstanding implementation

1. Repair baseline regression: separate _legacy preserved-configuration_ admission from
   _tier-bound fail-closed_ admission so both the accepted financial regressions and the new
   fail-closed controls hold simultaneously.
2. Tier-to-limit acceptance suite (no coverage exists today).
3. Provider capability matrix + documented Dojah address/enhanced operations behind the existing
   `DojahAssuranceContract` boundary.
4. Final consolidated acceptance at the corrected tuning.

## 6. Exact next action

Implement the tier-limit enforcement flag semantics fix in
`src/limit-catalog/limit-enforcement.service.ts` and `src/limit-catalog/institution-kyc-limit-policy.service.ts`,
then re-run the 8 failing integration suites and the root unit suite.

---

# Checkpoint 4 — post-activation semantics repair and address verification

**HEAD at this checkpoint: `8fe022d2`** (preceding: `7e5a0408`, `a3072b27`, `e3947e52`, `5f414863`,
recovered from `004dd80008edbadc41cebf3c67222d6abbcd2cff`).

## 4.1 Activation semantics (the 165-error class is closed)

`LimitEnforcementService.resolveTierEnforcement()` now resolves one of three modes instead of
conflating "the rollout is not activated" with "there is no policy":

| Mode                | Condition                       | Admission behaviour                               |
| ------------------- | ------------------------------- | ------------------------------------------------- |
| `ENFORCED`          | tier-limit rollout flag is on   | Full tier-bound admission; missing policy rejects |
| (throws)            | flag off **and** production     | Fail closed — production never runs unenforced    |
| `LEGACY_UNENFORCED` | flag off **and** not production | Accepted baseline contract applies                |

The flag remains `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED=false` by default, so enabling tier-bound
admission is an explicit, reviewable production decision rather than an accident of deployment.

## 4.2 Three further genuine regressions found and repaired

Fixing activation semantics exposed three suites that were failing for real reasons, all of them
rollout regressions rather than bad expectations:

| Suite                          | Symptom                                           | Root cause                                                                                                                                                                                                                         | Repair                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a13-agent-cash-in`            | `503` on A12 regression smoke                     | `agent-financial-execution` refused **any** call without a `limit` block; baseline guarded on `service && limit`                                                                                                                   | A declared scope is still always enforced and absent enforcement still fails closed; only the no-scope internal path passes                                     |
| `a24-customer-transaction-pin` | `503 Institutional wallet context is unavailable` | `transfer.service` refused every wallet pair without an institution, but `wallet_accounts.institution_id` is nullable **by design** (migration `1785753600401`) and the accepted baseline moved money between unattributed wallets | Cross-institution and half-attributed pairs are refused; an entirely unattributed legacy pair proceeds to the tier-bound gate, which fails closed in production |
| `a7-authoritative-persistence` | `PermissionDenied` on policy insert               | Fixture wrote `state='APPROVED'` directly, which the protected-authority trigger correctly refuses                                                                                                                                 | Fixture uses the governed maker/checker path (`seedGovernedTierPolicy`)                                                                                         |

`a24` additionally had **no** tier policy at all although Wallet→Wallet admission is tier-bound. New
helper `approveTcpInstitutionKycTierLimitPolicy()` builds a real institution-scoped mapping through
the protected services for loopback-TCP suites (the pre-existing helper is socket-cluster bound).

## 4.3 Tier-limit acceptance suite — committed

`test/kyc-tier-limit-enforcement.isolated-pg.test.ts`, **21/21 PASS**, run in `public` on an isolated
disposable socket cluster. It covers the authoritative tier→limit mapping, per-tier resolution,
windowed and non-windowed dimensions, currency scoping, and refusal when no profile/rule/mapping
exists.

It also captured a **real production defect**: the reservation insert caught `23505` in JavaScript,
but PostgreSQL had _already aborted the transaction_, so every later statement failed with `25P02`
and a legitimate admission was refused. Fixed with `SAVEPOINT limit_reservation_insert` /
`ROLLBACK TO` / `RELEASE`, and pinned by a dedicated race-survival test.

**General rule recorded for future work:** a caught statement error aborts the whole PostgreSQL
transaction. A JavaScript `catch` that continues is insufficient — always `SAVEPOINT`/`ROLLBACK TO`.

## 4.4 Dojah address verification — now implementable, and implemented

The repository's `kyc-future-capabilities` commentary claimed no address endpoint is documented. That
assumption is **stale**: Dojah documents `POST /api/v1/kyc/address` (submission) and
`GET /api/v1/kyc/address?reference_id=…` (polling), with an asynchronous result.

Because the endpoint is asynchronous, the adapter is built so the two dangerous readings are
impossible:

- a **submission** returns only an opaque reference — it can never be read as a verification, and an
  accepted-but-unreferenced response is `OUTCOME_UNKNOWN`;
- a **poll** reports `verified=true` only for `completed` **with** a positive provider indication and
  a collected address. `completed` alone, an unrecognised status, or a non-2xx is unverified or throws.

Photos, coordinates and neighbour references are parsed past and never surfaced, matching the
repository's decision not to persist address imagery. The transport is a **separate type** from the
read-only identity transport, so no existing adapter can begin issuing a billable POST; it keeps fixed
origins, pinned DNS, forbidden-IP refusal, bounded bodies, no redirect following and no retries.

13 unit tests: `test/dojah-address-verification.unit.spec.ts`.

## 4.5 Verification status at this checkpoint

| Suite                                    | Result                          |
| ---------------------------------------- | ------------------------------- |
| `kyc-tier-limit-enforcement` (isolated)  | 21/21 PASS                      |
| `a13-agent-cash-in`                      | 37/37 PASS                      |
| `a7-authoritative-persistence`           | 33/33 PASS                      |
| `a24-customer-transaction-pin-hardening` | 19/19 PASS                      |
| `dojah-address-verification` (unit)      | 13/13 PASS                      |
| `financial-commitment-initiation`        | 41/41 PASS                      |
| `a14-agent-cash-out`                     | 33/33 PASS                      |
| Root unit baseline                       | 255/255 suites, 2957/2957 tests |

`tsc --noEmit`, ESLint and Prettier are clean on every changed file.

**A full-matrix run was invalidated mid-flight by concurrent edits** — batches compiled
half-written modules and reported spurious `TS2724` import errors. It was discarded rather than
reported. The matrix must only be run against a committed, quiescent tree; that run is in progress.

## 4.6 Remaining work

1. Complete the full PG matrix on the quiescent tree and record the exact totals here.
2. Close the enforcement call-site gaps below.
3. Write the final handoff `docs/integration/MONIENAIJA-KYC-PROVIDER-AND-TIER-AUTOMATION-HANDOFF.md`.

### Known enforcement gaps (must be closed before this mission can be called complete)

| Call site                                     | Gap                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `agent-cash-to-cash.service.ts:668-676`       | AGENT side admitted with no limit check at all                                                 |
| `agent-cash-to-cash-claim.service.ts:721-745` | CUSTOMER branch calls `enforce` with neither `requireConfiguration` nor `requireKycTierPolicy` |
| `agent-funding.service.ts:1036+`              | AGENT-only funding path with no limit check                                                    |

---

# Checkpoint 5 — governed fixtures swept, matrix re-based

**HEAD: `6bda9489`** (`e51d216d`, `85f15c9f`, `b4ffa7d0`, `8fe022d2`, `6f2f603c`, `7e5a0408`,
`a3072b27`, `e3947e52`, `5f414863`).

## 5.1 One pattern, three sweeps

The full matrix kept surfacing the same defect class, and each sweep found it by **running** rather
than by reading:

| Sweep | Files                                                                         | Symptom                                                 |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1     | `a7-authoritative-persistence`                                                | `PermissionDenied` — direct `state='APPROVED'` insert   |
| 2     | `a6-settlement-lifecycle`                                                     | `KYC proposals must begin in REQUESTED state` (6 cases) |
| 3     | `governed-financial-fixture`, `a7-product-financial-effect`, `v1-system-01-…` | same, including the **shared canonical fixture**        |

All now publish through `seedGovernedTierPolicy`, i.e. real maker/checker. The guard was correct
every time; the fixtures were the thing bypassing it. `governed-financial-fixture` mattered most
because every Arena 3B institutional suite inherits it.

Verified: `a6` 20/20, `a7-product-financial-effect` + `v1-system-01` 11/11.

## 5.2 A discarded run, and a contention artefact

`/tmp/pg-full2.log` and `/tmp/pg-full3.log` were **both invalidated by concurrent edits** — batches
compiled half-written modules and reported `TS2724` for symbols that exist. Neither run is reported
as a result.

Separately, `a16` reported one `ECONNRESET 127.0.0.1:45599` on a concurrency case while another
suite shared the sandbox. Re-run alone: **88/88 PASS**. Recorded so the artefact is not mistaken for
an application defect — but also not silently dropped.

**Rule:** the matrix runs only against a committed, quiescent tree, and nothing else heavy shares the
sandbox while it does.

## 5.3 Enforcement audit (read-only, completed)

Every `postJournal`/`postJournalInTransaction` call site was audited:

| Site                                    | Verdict                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `transfer.service`                      | enforced                                                                                                                   |
| `agent-cash-to-cash.service`            | enforced (an earlier note claiming a gap was **stale**)                                                                    |
| `agent-cash-to-cash-claim.service`      | **was a real gap** — CUSTOMER branch had neither flag; fixed                                                               |
| `agent-financial-execution.service`     | enforced                                                                                                                   |
| `agent-funding.service`                 | enforced                                                                                                                   |
| `customer-funding.service`              | enforced                                                                                                                   |
| `withdrawal.service`                    | generic route returns `403 Generic withdrawal commands are disabled`; reachable only via `financial-commitment` (enforced) |
| `inbound-funding.service`               | reached only through A7 admission authority (`UNAVAILABLE` → 503)                                                          |
| `deposit.service`, `transfer-lifecycle` | no monetary admission path                                                                                                 |

## 5.4 Next action

Authoritative full matrix at `PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6
PG_TEST_MAX_OLD_SPACE_MB=2560` on `6bda9489`; append exact totals to both this record and §10 of the
handoff. Then re-run the root unit suite (a new unit file was added).

---

# Checkpoint 6 — the boundary inspector was lying, and a real privilege leak

**HEAD: `b4f733b2`** (pushed).

## 6.1 Three defects in the code that proves the boundary

`test/protected-authority-boundary.integration.spec.ts` failed. Each cause was a real defect in the
control itself, which is the worst possible place for one:

| #   | Defect                                                                                                                                                                                                                                                                                                                                                   | Consequence                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The **runtime** inspection cast `'protected_authority.fn()'::regprocedure`. That cast resolves the name through the schema and needs `USAGE` on it — which the runtime role deliberately lacks.                                                                                                                                                          | The runtime role was denied by the very control it was trying to demonstrate. The error was swallowed into `unavailable`, so production readiness could **never** verify an actually-correct configuration. |
| 2   | `kyc_governance_write` wrapped a **multi-row** query in a scalar subquery (no aggregate, `relname IN` two tables).                                                                                                                                                                                                                                       | Any deployment with both governance tables present raised `more than one row returned by a subquery used as an expression`, again surfacing as a boundary failure.                                          |
| 3   | **Real privilege leak.** `scripts/sql/provision-database-roles-after-migrations.sql` grants runtime `INSERT/UPDATE/DELETE ON ALL TABLES`, then re-revokes only the original six KYC tables. Migration `1785753600504` revokes runtime write on the three `institution_kyc_limit_*` tables, but this script runs **afterwards** and silently restored it. | The ordinary application credential could forge the very tier→limit policy it is then checked against.                                                                                                      |

Fixes: catalog lookup instead of the schema-dependent cast; aggregate added to the subquery; the three
tables re-revoked explicitly, and `authority_inspection` now verifies it.

**`protected-authority-boundary` 7/7 PASS.**

## 6.2 Scheduler trap — recorded so it is not repeated

Two full runs were invalidated by **sharing the machine**:

- the matrix and the isolated KYC sweep were run concurrently;
- suites that normally take seconds hit `Exceeded timeout of 180000 ms for a hook`
  (`v1-w2w-recovery-audit-01`, `batch2c-eligibility`);
- one sweep died with no jest summary at all, only application logs.

**Rule:** exactly one heavy suite process at a time. Both contaminated runs were discarded, not
reported. A `beforeAll` timeout in this workspace is evidence of contention, not of an application
defect — re-run it alone before believing it.

## 6.3 Outstanding

1. Authoritative full matrix, alone, on `b4f733b2`.
2. Isolated KYC sweep (11 suites), alone, after the matrix — count the suites individually if the
   runner produces no summary.
3. Append exact totals to this record and to §10 of the handoff.

---

# Checkpoint 7 — authoritative matrix green, and the last fixture that lied

**HEAD: `a34574c5` (matrix + unit), `e0ef1d22` (isolated sweep repair), both pushed.**

This checkpoint is the first one where every gate is green **on the same quiescent tree**, with each
heavy run executed alone.

## 7.1 The authoritative full PostgreSQL matrix — PASS

Command (exactly as run, exclusive config):

```
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
DB_HOST=127.0.0.1 DB_PORT=44679 DB_USER=arena_pg_test \
DB_PASSWORD=arena-disposable-test-only DB_NAME=postgres \
node scripts/run-pg-integration-tests.js
```

| Measure         | Result                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------- |
| Exit code       | **0**                                                                                     |
| Suites          | **153 / 153 PASS**                                                                        |
| Tests           | **2751 PASS, 0 fail**                                                                     |
| Batches         | 26 / 26                                                                                   |
| Runner counters | `failingBatches:0 memoryFailures:0 timeouts:0 unexplainedCrashes:0 filesWithoutResult:[]` |
| Wall clock      | 4,586,984 ms                                                                              |

Raw sanitized transcript: `/tmp/pg-definitive.log` (discardable sandbox path; totals above are the
durable record).

Four lines in the log read as "failures" and are **not** test failures — they are benign console
output asserted on purpose by the suites: two `notification.console_simulated`, one
`M19A_LIVE_HTTP auditor read=200`, and the expected `uq_wallet_accounts_customer_currency`
migration-rollback message.

## 7.2 Root unit suite — PASS

`npx jest --config jest.config.js --silent` → **256/256 suites, 2978/2978 tests**, 81.2 s.

> **Superseded — this was the correct count at `a34574c5` only.** The authoritative current figure is
> **257/257 suites, 2981/2981 tests**. The extra suite and three tests are the fixture-race
> regression test added in `740883df`; nothing here was wrong when written, but a reader who stops at
> this line will quote a stale number.

Re-run at `740883df`, after the fixture race was fixed and pinned by
`test/governed-financial-fixture-workforce.spec.ts`:
**257/257 suites, 2981/2981 tests**, 97.066 s.

## 7.3 The isolated KYC sweep found one real defect — in a fixture

Running the 11 isolated KYC suites **alone** (`/tmp/iso5.log`) gave 10/11 suites and 148/149 tests.
The single failure was genuine and not contention:

`test/batch2c-eligibility.isolated-pg.test.ts` → _"bound wallet-redemption claim wiring rolls back
OTP with a failed posting and serializes funded claims"_.

### What it actually exposed

The test seeded a CUSTOMER wallet-redemption claim the **legacy** way: a destination wallet with no
institutional attribution, funded into the shared `CASH_TO_CASH-UNCLAIMED-NGN` platform account.
Once tier-bound admission and the ledger's institutional-context resolver existed, that seeding
described a transfer that can no longer exist. It failed closed three times in a row, each for a
**correct** reason:

| Attempt | Failure                                                                                        | Verdict on the guard                                                              |
| ------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1       | 503 `LIMIT_PROFILE_MISSING` — "Institution and customer are required for tier-bound admission" | **Correct.** A customer claim into a real wallet is a financial boundary.         |
| 2       | `Ledger account … is not attributed to the journal's institution`                              | **Correct.** Attributed suspense debited against an unattributed platform source. |
| 3       | attribution refused: wallet ledger account "already has posted financial history"              | **Correct.** Attributing after posting would fabricate historical attribution.    |

None of these were worked around. The fixture was rebuilt to follow the governed production path:

1. enrol the customer at a fixture institution;
2. approve a `CASH_TO_CASH` tier→limit policy for it;
3. attribute the destination wallet **before** it carries posted history;
4. fund from the institution's own settlement asset into that institution's suspense liability —
   never mixing an unattributed account with an attributed one;
5. insert `cash_to_cash_funding_evidence`, which is what binds a transfer to its funding
   institution and selects the obligation account.

**No assertion was weakened.** The injected settlement failure and the serialization contract are
still exactly what the test verifies.

### Result

`/tmp/iso10.log` → `batch2c-eligibility` **18/18 PASS**.
`/tmp/iso11.log` → isolated KYC sweep **11/11 suites, 149/149 tests PASS**, exit 0.

## 7.4 Where the numbers now stand

| Gate                                      | Result                             |
| ----------------------------------------- | ---------------------------------- |
| Root unit suite                           | 257/257 suites, 2981/2981 tests    |
| Full PostgreSQL matrix                    | 153/153 suites, 2751 tests, exit 0 |
| Isolated KYC sweep (11 suites, run alone) | 11/11 suites, 149/149 tests        |
| `protected-authority-boundary`            | 7/7                                |
| `a16-agent-cash-to-cash-claim`            | 88/88                              |
| Retry-backoff unit tests                  | 5/5                                |

## 7.5 Next action

1. Confirm the full matrix still passes on `e0ef1d22` (the tree the isolated sweep was repaired on),
   since the fixture changed after `a34574c5`; record the totals here and in §10 of the handoff.
2. Refresh `docs/integration/acceptance/kyc-provider-tier-automation-acceptance.sanitized.md`:
   §5.1 still carries the superseded `pg-final3` 151/2 table.

---

# Checkpoint 8 — the "contention artefact" was a fixture race

**HEAD: `740883df` (pushed).**

## 8.1 Why this checkpoint exists

A full matrix on the `e0ef1d22` tree failed one suite:

```
FAIL test/a16-agent-cash-to-cash-claim.integration.spec.ts (67.82 s)
  ● A16 Agent Cash→Cash CLAIM (real PostgreSQL)
    › concurrent initiation collisions reserve distinct immutable locator pairs

    connect ECONNRESET 127.0.0.1:46801
```

This had already been seen once and recorded as a sandbox-contention artefact, because the suite
passes 88/88 alone. That explanation was not good enough: this time **nothing else shared the
machine**, and the runner reported `concurrency: 1`. Rather than re-run until green, the mechanism
was traced.

## 8.2 The actual defect

`GovernedFinancialFixture.workforce()` cached only the **resolved** value:

```ts
if (!this.workforceCache) {
  const entries = await Promise.all(...);   // both callers read undefined here
  this.workforceCache = Object.fromEntries(entries);
}
return this.workforceCache;
```

Two callers arriving before the first seeding finishes both observe `undefined` and both seed.

The failing test calls `initiateTransfer()` twice inside one `Promise.all`, and each call reaches
`fixture.affiliateAgent` / `fixture.attributeWallet`, hence `workforce()`. Both seeded a duplicate
set of six principals and both issued supertest requests. The suite never calls `listen()` — it uses
`app.init()` — so **supertest binds an ephemeral listener per request**; interleaved requests from
concurrent supertest instances produced `ECONNRESET` on the ephemeral port.

So the error was a transport symptom of a fixture initialisation race, entirely unrelated to the
claim behaviour the test exists to verify.

## 8.3 The fix, and the bug the fix introduced

Cache the **in-flight promise**, assigned before the first `await`, so a second caller joins the work:

```ts
this.workforcePromise ??= (async () => { ...seed...; this.workforceCache = workforce; ... })();
return this.workforcePromise;
```

The regression test then failed against the first version of this fix, because a **rejected** promise
stayed cached and poisoned every later caller — turning one transient seeding failure into "the whole
fixture is unusable". The `.catch` now clears the cache before rethrowing.

`test/governed-financial-fixture-workforce.spec.ts` pins all three properties with no database:

| Test                                            | Property                                          |
| ----------------------------------------------- | ------------------------------------------------- |
| exactly one seeding pass for concurrent callers | 6 seeding calls, not 12; both get the same object |
| later calls reuse the cache                     | still 6 calls                                     |
| a failed pass is not cached                     | retry succeeds; 12 calls total                    |

**The test was verified to fail against the old implementation** (12 instead of 6 seeding calls) and
pass against the new one. That is the difference between a regression test and decoration.

## 8.4 Verification

- `governed-financial-fixture-workforce` → **3/3 PASS**
- `a16-agent-cash-to-cash-claim` alone → **88/88 PASS**, twice (before and after the rejection fix)

Also corrected a stale identifier in a doc comment: `resolveTierEnforcementMode` →
`resolveTierEnforcement`. It was prose only, so it invalidated no compiled artifact — but it is the
kind of thing that sends the next reader looking for a function that does not exist.

## 8.5 Decisive confirmation, observed inside the matrix

The point of fixing a race is that it stops happening **under load**, not that it reproduces green in
isolation. In the definitive run, `a16` executed at batch 3 position 4 — i.e. six parallel-capable
suites deep into a 26-batch matrix — and reported:

```text
PASS test/a16-agent-cash-to-cash-claim.integration.spec.ts (60.035 s)
```

Same suite, same concurrent `Promise.all`, same machine: FAIL with `ECONNRESET` before the fix, PASS
inside the full matrix after it. That is the evidence that matters.

## 8.6 Next action

Authoritative full matrix on `740883df`, run alone. Totals to be appended to §7 and to §10 of the
handoff, replacing the earlier run only if the earlier run's numbers are no longer reproducible.

---

# Checkpoint 9 — the matrix's last failure was a substring, not a secret

**HEAD: `e9609925` (pushed).**

## 9.1 The definitive run at `740883df`

Run alone, exclusive tuning, nothing else on the machine:

```text
PG_TEST_SUMMARY {"filesDiscovered":153,"batches":26,"suitesReported":153,
  "suitesPassed":152,"suitesFailed":1,"passingBatches":25,"failingBatches":1,
  "memoryFailures":0,"timeouts":0,"unexplainedCrashes":0,"filesWithoutResult":[]}
PG_EXIT=1
```

One failure:

```text
● A12 Agent financial execution foundation (real PostgreSQL)
  › Q. PIN/secrets do not appear in result/audit

  expect(received).not.toContain(expected)
  Expected substring: not "4321"
```

**This was not a secret leak.** The test read the five most recent
`AGENT_FINANCIAL_EXECUTION` audit rows — which include evidence written by _other_ tests — and
searched the serialised JSON for the PIN. Test M had run immediately before and written:

```json
"idempotencykey": "m2-074321e6-6d74-41e3-8696-9b5aefe18ef9"
```

That random UUID contains the substring `4321`. The PIN `4321` appears nowhere in the audit row.

So the assertion was a coin flip over unrelated random identifiers. It would fail whenever any recent
UUID, journal id or hash happened to contain the PIN — and it inspected rows that have nothing to do
with the PIN under test.

## 9.2 The fix, and why it is stricter rather than weaker

The obvious "fix" — deleting the assertion, or scanning fewer rows — would have removed a real
security check to make a run go green. Instead the query now selects the audit row belonging to the
execution **this test just created**:

```sql
SELECT new_values, previous_values FROM audit_events
 WHERE entity_type='AGENT_FINANCIAL_EXECUTION'
   AND new_values->>'journalId' = $1     -- res.journalId
```

plus `expect(audits).toHaveLength(1)`. The evidence under test is now exactly the evidence this
execution produced.

Verified in **both** directions, because a passing test proves nothing on its own:

| Direction                                          | Result                                         |
| -------------------------------------------------- | ---------------------------------------------- |
| Real tree                                          | 19/19 PASS                                     |
| PIN injected into the audited row (`"pin":"4321"`) | **FAILS** — the assertion still catches a leak |

## 9.3 Where this leaves the mission

Across three definitive runs the same pattern held: **every** matrix failure was a test that could not
distinguish its own evidence from everyone else's.

| Failure                             | Real cause                                                 | Produced by |
| ----------------------------------- | ---------------------------------------------------------- | ----------- |
| `v1-limit-05` concurrent `C2C_INIT` | SERIALIZABLE retries with no delay                         | `a34574c5`  |
| `a16` concurrent initiation         | `workforce()` seeding race (6 callers seeded instead of 1) | `740883df`  |
| `a12` PIN-leak assertion            | `"4321"` inside an unrelated random UUID                   | `e9609925`  |

None was an application defect in the control under test; all three were defects in the _evidence_,
and all three were repaired so the evidence became sharper.

The acceptance suites themselves were already correct. What was wrong was what they measured.

## 9.4 The authoritative matrix — PASS

Run alone on `e9609925`, exclusive tuning, nothing else on the machine:

```text
PG_TEST_SUMMARY {"filesDiscovered":153,"batches":26,"batchSize":6,"concurrency":1,
  "maxOldSpaceMb":2560,"durationMs":4287367,"passingBatches":26,"failingBatches":0,
  "memoryFailures":0,"timeouts":0,"unexplainedCrashes":0,
  "suitesReported":153,"suitesPassed":153,"suitesFailed":0,
  "failingFiles":[],"filesWithoutResult":[]}
PG_EXIT=0
tests: 2751 passed, 0 failed
```

`failingFiles: []` and `filesWithoutResult: []` are the two fields that matter: no suite failed and
none went unreported. This is the tree the acceptance record cites.

### Every gate, on the final tree

| Gate                                      | Result                                 |
| ----------------------------------------- | -------------------------------------- |
| Full PostgreSQL matrix                    | **153/153 suites, 2751 tests, exit 0** |
| Root unit suite                           | **257/257 suites, 2981/2981 tests**    |
| Isolated KYC sweep (11 suites, run alone) | **11/11 suites, 149/149 tests**        |

**All three re-run on `e9609925` itself after the matrix completed**, so the record is not stitched
together from different trees:

```text
npx jest --config jest.config.js --silent
  Test Suites: 257 passed, 257 total
  Tests:       2981 passed, 2981 total
  Time:        80.982 s

KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js --runInBand
  Test Suites: 11 passed, 11 total
  Tests:       149 passed, 149 total
  exit:        0
```

Three gates, one commit, all green.

## 9.5 Next action

Write these totals into handoff §10 and acceptance §5.1, replacing the superseded `a34574c5` run.
