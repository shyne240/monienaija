# Arena 3D — continuation record

This is the durable, tracked continuation record required by the mission. It is updated **before**
approaching tool-call limits so completed implementation is never left exclusively in an
uncommitted working tree.

**Latest pushed commit:** see the top of `git log --oneline -5` on `arena/defdd0fd-monienaija`.
**Current active branch:** `arena/defdd0fd-monienaija`.
**Base commit branched from:** `004dd80008edbadc41cebf3c67222d6abbcd2cff`.

---

## 1. Recovery source

| Question                                     | Answer                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Previous active arena branch                  | `arena/5b239ff5-monienaija` (Arena 3C)                                                                |
| **Exact recovery source commit**              | `004dd80008edbadc41cebf3c67222d6abbcd2cff` — *`feat(kyc): govern assurance capabilities and test policies`* |
| Was the mission's `69a09bb` checkpoint final? | **No.** `git ls-remote origin refs/heads/arena/5b239ff5-monienaija` returns `004dd80`, which is 10,798 insertions ahead of the named `69a09bb` checkpoint. |
| Is any remote Arena 3C HEAD newer than 004dd80? | **No.** Verified with `git ls-remote` after a full `git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune`. `69a09bb` does not exist in the remote at all, so the mission-prompt checkpoint reference was superseded by Arena 3C's later work. |
| Unified application acceptance baseline       | `75300342666b7acc25207667a4a262fb23d4e191` (= remote `arena/ca576774-monienaija`) — confirmed present and unmodified. |
| Recovery method                               | The active branch was created from `004dd80` directly. No cherry-pick, reset or replay was needed: the branch **is** the recovered tree. Nothing was overwritten and no frozen branch was modified. |

`004dd80` is a shallow-clone grafted root in this sandbox (`git rev-list --count` = 1, no parent
recorded). This is a clone-depth artifact only; the tree is complete and `git cat-file -t` resolves
every path.

## 2. Environment established

Measured in this sandbox, not assumed:

| Resource     | Value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| CPU          | 2 vCPU                                                                |
| RAM          | 3,939 MB total / 3,661 MB available                                   |
| Disk         | 21 GB total, 19 GB available on `/`                                   |
| Node / npm   | v22.22.3 / 10.9.8                                                      |
| PostgreSQL   | 18.4 embedded (`@embedded-postgres/linux-x64`), disposable socket-only |
| Dependencies | `npm ci` — 979 packages, clean install                                |

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

| Count | Message                                                                     | Root cause                                                                                      |
| ----- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 139   | `HttpException: No active limit profile is assigned for this financial operation` | `requireConfiguration: true` added to entry points that previously ran without it                |
| 25    | `HttpException: Institutional KYC tier-limit enforcement is operationally disabled` | `requireKycTierPolicy: true` on CUSTOMER paths with `KYC_TIER_LIMIT_ENFORCEMENT_ENABLED` unset |
| 1     | `HttpException: No applicable financial limit rules are configured for this operation` | same class as above                                                                    |

These are **real regressions in the recovered tree**: the accepted unified baseline
(`75300342`) set neither flag, and its 153 suites / 2,750 tests passed. They must be repaired
without weakening the mission-mandated fail-closed controls.

## 4. Implementation matrix — see `MONIENAIJA-KYC-PROVIDER-AND-TIER-AUTOMATION-HANDOFF.md`

The full classification table with evidence links is maintained in the final handoff document.

## 5. Outstanding implementation

1. Repair baseline regression: separate *legacy preserved-configuration* admission from
   *tier-bound fail-closed* admission so both the accepted financial regressions and the new
   fail-closed controls hold simultaneously.
2. Tier-to-limit acceptance suite (no coverage exists today).
3. Provider capability matrix + documented Dojah address/enhanced operations behind the existing
   `DojahAssuranceContract` boundary.
4. Final consolidated acceptance at the corrected tuning.

## 6. Exact next action

Implement the tier-limit enforcement flag semantics fix in
`src/limit-catalog/limit-enforcement.service.ts` and `src/limit-catalog/institution-kyc-limit-policy.service.ts`,
then re-run the 8 failing integration suites and the root unit suite.
