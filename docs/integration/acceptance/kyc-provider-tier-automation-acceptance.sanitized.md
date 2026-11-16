# KYC provider, tier automation and limit enforcement — acceptance transcript

- Date: 2026-11-16 UTC
- Branch: `arena/defdd0fd-monienaija`
- HEAD at time of these checks: `96d96416` (working tree clean)
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
Test Suites: 256 passed, 256 total
Tests:       2975 passed, 2975 total
Snapshots:   0 total
Time:        115.677 s
```

The accepted pre-existing baseline was **255 suites / 2957 tests**. The delta is exactly the new
`test/dojah-address-verification.unit.spec.ts` (1 suite, 18 tests), i.e.
`255 + 1 = 256` and `2957 + 18 = 2975`. No pre-existing unit test changed status.

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

**Status: in progress at the time this file was written; totals appended in §5.1 when complete.**

### 5.1 Discarded runs

Two earlier full-matrix runs were **stopped and discarded**, and are not reported as results:

| Run                 | Why discarded                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/tmp/pg-full2.log` | Files were still being edited. Batches compiled half-written modules and emitted `TS2724 … has no exported member` for symbols that exist in the final tree. |
| `/tmp/pg-full3.log` | Same cause, plus it predated the governed-fixture sweep and reported `a6`, `a7-product-financial-effect` failures that are fixed at `6bda9489`.              |

Those numbers would have looked like application failures. They are recorded here precisely so they
are never mistaken for any.
