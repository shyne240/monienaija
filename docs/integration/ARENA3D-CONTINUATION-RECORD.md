# Arena 3D — continuation record

This is the durable, tracked continuation record required by the mission. It is updated **before**
approaching tool-call limits so completed implementation is never left exclusively in an
uncommitted working tree.

**Latest pushed commit:** see the top of `git log --oneline -5` on `arena/defdd0fd-monienaija`.
**Current active branch:** `arena/defdd0fd-monienaija`.
**Base commit branched from:** `004dd80008edbadc41cebf3c67222d6abbcd2cff`.

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
