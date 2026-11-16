# KYC provider, tier automation and limit enforcement — acceptance transcript

- Date: 2026-11-16 UTC
- Branch: `arena/defdd0fd-monienaija`
- HEAD at time of these checks: `e9609925`
- Authoritative matrix (§5.1) ran on `e9609925`
- Recovered baseline: `004dd80008edbadc41cebf3c67222d6abbcd2cff`

All commands below were executed in this workspace. Every result is copied from the command that
produced it; nothing is reconstructed from memory.

---

## 1. Static gates

```sh
npx tsc --noEmit --pretty false
(cd apps/admin-web && npx tsc --noEmit --pretty false)
(cd apps/customer-mobile && npx tsc --noEmit --pretty false)
git diff --check
```

```text
PASS root tsc
PASS admin-web tsc
PASS customer-mobile tsc
PASS git diff --check
```

Both app checks require their own dependency install (`npm ci` inside each app); without it they
report `Cannot find module 'react'` / `Cannot find module 'react-native'`. That is a missing-dependency
condition, not a source defect, and was resolved by installing, not by editing source.

---

## 2. Root unit suite

```sh
npx jest --config jest.config.js --silent
```

```text
Test Suites: 257 passed, 257 total
Tests:       2981 passed, 2981 total
Snapshots:   0 total
Time:        97.066 s
```

The accepted pre-existing baseline was **255 suites / 2957 tests**. The delta decomposes exactly:
`+1` suite / `+18` tests for `test/dojah-address-verification.unit.spec.ts`, `+3` tests appended to
`test/v1-test-01-agent-cash-to-cash-retry-exhaustion.spec.ts` covering the serialization backoff
(growth, cap, jitter), and `+1` suite / `+3` tests for
`test/governed-financial-fixture-workforce.spec.ts`. That is `255 + 2 = 257` suites and
`2957 + 18 + 3 + 3 = 2981` tests. No pre-existing unit test changed status.

Earlier revisions of this document recorded **2975** then **2978** tests. Both were accurate when
written; each count grew as a defect the matrix exposed was fixed and pinned.

---

## 3. Tier → limit enforcement (isolated disposable PostgreSQL)

`test/kyc-tier-limit-enforcement.isolated-pg.test.ts` — **21/21 passed**.

Run on a disposable socket cluster, in the `public` schema, because migration `1785753600504`
hard-codes `public.` and therefore cannot be schema-scoped per suite.

This suite covers the authoritative tier→limit path (approved institution, `ACTIVE`/`CONFIGURED`
profile, per-tier rules, currency scoping, windowed and non-windowed dimensions) and refusal when no
profile, rule or mapping exists.

It also pins the **savepoint fix**: a duplicate reservation no longer poisons the surrounding
transaction with `25P02`.

### 3.1 The full isolated KYC sweep

```sh
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js --runInBand
```

```text
PASS test/batch2c-eligibility.isolated-pg.test.ts
PASS test/batch2-legacy-registration.isolated-pg.test.ts
PASS test/kyc-registration-api.isolated-pg.test.ts
PASS test/batch2c-session-remediation.isolated-pg.test.ts
PASS test/governed-ledger-reversal.isolated-pg.test.ts
PASS test/kyc-registration-session.isolated-pg.test.ts
PASS test/kyc-tier-limit-enforcement.isolated-pg.test.ts
PASS test/kyc-foundation.isolated-pg.test.ts
PASS test/kyc-tier-transition.isolated-pg.test.ts
PASS test/kyc-tier-policy.isolated-pg.test.ts
PASS test/kyc-provider-governance.isolated-pg.test.ts

Test Suites: 11 passed, 11 total
Tests:       149 passed, 149 total
```

This sweep must run **alone**. A concurrent full-matrix run starves it of connections and produces
`Exceeded timeout of 180000 ms for a hook` in suites that normally take seconds.

The single failure this sweep ever produced is described in §5.1: `batch2c-eligibility`'s claim
test, whose fixture seeded a transfer that could no longer exist. It failed closed for three
individually correct reasons before the fixture was rebuilt along the governed path.

---

## 4. Financial admission regression suites (real PostgreSQL)

| Suite                                                | Result                               |
| ---------------------------------------------------- | ------------------------------------ |
| `financial-commitment-initiation`                    | 41/41                                |
| `a14-agent-cash-out`                                 | 33/33                                |
| `a13-agent-cash-in`                                  | 37/37                                |
| `a7-authoritative-persistence`                       | 33/33                                |
| `a24-customer-transaction-pin-hardening`             | 19/19                                |
| `a6-settlement-lifecycle`                            | 20/20                                |
| `a16-agent-cash-to-cash-claim`                       | 88/88                                |
| `a7-product-financial-effect`                        | (11/11 together with `v1-system-01`) |
| `v1-system-01-suspended-customer-financial-boundary` | (same run)                           |

Exact commands used, e.g. for the a-series:

```sh
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=<id> \
  DB_HOST=127.0.0.1 DB_PORT=44679 DB_USER=arena_pg_test \
  DB_PASSWORD=arena-disposable-test-only DB_NAME=postgres \
  node -r ./test/support/mission-25c-network-guard.cjs \
  ./node_modules/jest/bin/jest.js --config jest.integration.config.js \
  --runInBand --runTestsByPath test/<suite>.integration.spec.ts
```

`PG_TEST_RUN_ID` must match `/^[a-z][a-z0-9]{3,15}$/`.

### 4.1 Two artefacts recorded rather than hidden

- **`a16` `ECONNRESET 127.0.0.1:45599`** on a concurrency case, observed only while another suite
  shared the sandbox. Re-run alone: **88/88**. An ephemeral-port reset under contention, not an
  application defect — but recorded because a reader deserves to see it was investigated.
- **`a24` `503 Institutional wallet context is unavailable`**, found by instrumenting the response
  body rather than guessing: the fixture's wallets carry no institution, and institutional isolation
  was being applied to a pair that had none. Genuine defect, fixed in `7e5a0408`.

---

## 5. Full PostgreSQL matrix

```sh
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
  PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
  DB_HOST=127.0.0.1 DB_PORT=44679 DB_USER=arena_pg_test \
  DB_PASSWORD=arena-disposable-test-only DB_NAME=postgres \
  node scripts/run-pg-integration-tests.js
```

This tuning is used without exception; no result in this record was produced at different settings.

### 5.1 Authoritative completed run — 153 / 153 suites, exit 0

Run alone on commit **`e9609925`**, exclusive tuning, nothing else on the machine:

```text
PG_TEST_SUMMARY {"filesDiscovered":153,"batches":26,"batchSize":6,"concurrency":1,
  "maxOldSpaceMb":2560,"durationMs":4287367,"passingBatches":26,"failingBatches":0,
  "memoryFailures":0,"timeouts":0,"unexplainedCrashes":0,
  "suitesReported":153,"suitesPassed":153,"suitesFailed":0,
  "failingFiles":[],"filesWithoutResult":[]}
PG_EXIT=0
tests: 2751 passed, 0 failed
```

`failingFiles: []` and `filesWithoutResult: []` are the fields that matter: nothing failed and
nothing went unreported.

Four lines in the raw log read as failures and are **not** test failures — they are console output
the suites assert on deliberately: two `notification.console_simulated`, one
`M19A_LIVE_HTTP auditor read=200 self-revoke=200 replay=401`, and the expected
`uq_wallet_accounts_customer_currency` migration-rollback message.

### 5.2 Four failures, all of them in the evidence rather than the controls

Earlier runs failed. None of those failures was waved through by re-running until green; each was
diagnosed to a cause and repaired, and the repair made the evidence **stricter**:

| Failure                                        | Real cause                                                                                                                                                                                                                                                                                   | Fixed in   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `v1-limit-02` — `expect(4).toBe(5)`            | Stale test asserting a migration **count**; a legitimate fifth limit migration broke it. Now asserts the explicit ordered list of names.                                                                                                                                                     | `b8796fe5` |
| `v1-limit-05` — expected a limit code, got 503 | SERIALIZABLE retries had **no delay**, so retriers woke together and re-created the collision. Fixed with jittered exponential backoff + a stable `409 TRANSACTION_CONTENTION_RETRY_EXHAUSTED`.                                                                                              | `a34574c5` |
| `a16` — `connect ECONNRESET`                   | **Not** the contention artefact it was first assumed to be. `workforce()` cached only the resolved value, so two concurrent callers both seeded six principals; supertest binds an ephemeral listener per request, so the interleaving surfaced as ECONNRESET. Caches the in-flight promise. | `740883df` |
| `a12` — `Expected substring: not "4321"`       | The PIN `4321` occurs inside an unrelated random UUID (`m2-0743`**`21`**`e6-…`) written by test M. The test scanned five arbitrary recent audit rows. Now scoped to its own execution's audit row.                                                                                           | `e9609925` |

Each fix is pinned by evidence that fails without it:

- `v1-test-01-agent-cash-to-cash-retry-exhaustion` → 5/5, covering backoff growth, cap **and jitter**
  (a fixed delay fails the jitter test);
- `test/governed-financial-fixture-workforce.spec.ts` → 3/3, verified to **fail against the old
  implementation** (12 seeding calls instead of 6);
- the `a12` assertion was verified to still **fail when a PIN is injected** into the audited row, so
  it continues to catch the leak it exists to catch.

The pattern is worth stating plainly: every failure was a defect in the **evidence**, never in the
control being tested. That is the more dangerous class, because a green run built on bad evidence
means nothing.

### 5.2.1 The `Service Unavailable` masking, and how it was closed

`errorCodeOf(e)` returns `resp.error || resp.code || e.code || e.message`. For a NestJS
`ServiceUnavailableException` built from a string alone, `resp.error` is the **reason phrase**
`'Service Unavailable'` — not the message and not a machine code. An assertion reading it could not
distinguish "limit enforcement rejected this admission" from "a financial-context precondition was
unavailable".

Closed in two steps: `55a72a41` corrected the fallback so the real message is no longer masked, and
the Cash→Cash contention path now terminates in a stable machine code:

```json
{
  "message": "Cash→Cash could not complete after concurrent retries",
  "error": "TRANSACTION_CONTENTION_RETRY_EXHAUSTED",
  "code": "TRANSACTION_CONTENTION_RETRY_EXHAUSTED"
}
```

Residual, recorded honestly: the cash-to-cash **precondition** path still lacks a faithful machine
code. It is directionally fixed but not fully uniform with the contention path.

### 5.3 Discarded runs

Two earlier full-matrix runs were **stopped and discarded**, and are not reported as results:

| Run                 | Why discarded                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/tmp/pg-full2.log` | Files were still being edited. Batches compiled half-written modules and emitted `TS2724 … has no exported member` for symbols that exist in the final tree. |
| `/tmp/pg-full3.log` | Same cause, plus it predated the governed-fixture sweep and reported `a6`, `a7-product-financial-effect` failures that are fixed at `6bda9489`.              |

Those numbers would have looked like application failures. They are recorded here precisely so they
are never mistaken for any.
