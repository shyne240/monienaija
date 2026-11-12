# ARENA 3 — PostgreSQL Regression Infrastructure Remediation

**Branch:** `arena/8e59e188-monienaija`
**Base:** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`
**Prerequisite merged in:** Arena 1 Batch 2C tip `780ec761245851cd6a1c201663ce0bc3777a5549` (merge commit `1c2bae6`)
**Scope:** test infrastructure and fixture compatibility only. No financial business-logic
remediation, no production authorization weakening, no skipped or deleted tests.

> Status marker: sections marked **NOT VERIFIED** were not completed in this sandbox and must not be
> read as passing.

---

## 1. What this mission actually had to fix

The Batch 2C consolidation introduced a governed financial-eligibility gate
(`CustomerFinancialEligibilityService.require`) that every wallet and financial path now goes
through. It requires, for the customer: ACTIVE and not synthetic, `kyc_status='APPROVED'` at
`LEVEL_1`/`LEVEL_2`, no manual holds, no identity conflicts, **exactly one verified primary phone
contact**, **trusted KYC evidence**, and a `decideTier()` result of ELIGIBLE with a current,
unexpired APPROVED assessment. It also requires the migration-seeded KYC singleton rows to exist.

Dozens of older integration suites predate that gate and create customers with direct SQL. Those
suites are about something else entirely (limits, fee/commission accounting, PIN hardening,
notifications), so their fixtures — not their assertions, and never the gate — had to change.

Four distinct, independently diagnosed failure classes appeared:

| # | Symptom | Root cause | Remediation |
|---|---|---|---|
| A | `ConflictException: Customer financial policy is unavailable` | `TRUNCATE ... RESTART IDENTITY CASCADE` also empties three migration-seeded KYC singletons | `restoreKycSingletons()` immediately after every truncate |
| B | `ConflictException: Trusted KYC evidence is unavailable` | customer has no identity parts / no evidence at all (raw SQL), and the production reader is (correctly) fail-closed | shared governed fixture + explicit test evidence-reader override |
| C | `ConflictException: Wallet owner requires review` | wallet owner was a bare `randomUUID()`, which `wallet_owner_class()` classifies as `REVIEW` | canonical eligible-customer fixture |
| D | migration-chain assertions fail on a **correct** chain | hand-maintained "acceptable latest migration" allowlists had gone stale | derive the expectation from `src/migrations` |

---

## 2. Deliverables

### 2.1 Shared PostgreSQL harness (`test/support/pg-harness.ts`)

- `truncateAllTables()` now restores the migration-seeded KYC singletons after the wholesale
  `TRUNCATE`, so suite order can never matter:
  - `kyc_tier_policy_head` (`{singleton, version=0}`)
  - `kyc_provider_configuration` (all providers disabled, no routes, version 0)
  - `kyc_registration_synthetic_provider_lock` (`provider='SYNTHETIC'`)
- Every suite that truncates on its own (11 of them) also calls `restoreKycSingletons()`
  immediately after its `TRUNCATE`.
- The restoration is guarded by table existence, so it is safe on a partially-migrated schema.

### 2.2 Governed fixtures (`test/support/kyc-test-fixtures.ts`, 514 lines)

- `KYC_INITIAL_SINGLETON_STATE` — the migration-seeded initial state, transcribed from migrations
  0104/0108/0109/0110 and asserted against a freshly truncated database.
- `restoreKycSingletons` / `resetKycSingletons`.
- `seedGovernedTierPolicy` — a reusable **governed** tier policy (real rows, real version head).
- `seedIdentityEvidence` — real `kyc_consents`, `kyc_verification_attempts`, `kyc_identity_claims`
  rows written in exactly the columns the production read path uses, MAC-bound to the test anchor.
- `makeCustomerFinanciallyEligible` — satisfies **every** gate precondition for an existing
  customer, idempotently, promoting/verifying an existing phone in place rather than adding a
  second one.
- `createEligibleCustomer` — creates the customer *and* completes it, for suites that only need
  "some customer with a wallet".

### 2.3 Trusted test evidence (`test/support/kyc-test-evidence-reader.ts`, 221 lines)

- A **test-only** subclass of `KycTierEvidenceReader`; no application module references it.
- Refuses to construct unless `NODE_ENV === 'test'`; trust anchor is a per-process random key.
- **Not eligible by default**: `mode` defaults to `UNAVAILABLE`, which returns `null` and therefore
  preserves fail-closed behaviour. A suite must opt in with `{ mode: 'ELIGIBLE' }`.
- Reads real rows, so an "eligible" customer still needs genuine consent-backed evidence in the
  database. Nothing is fabricated in memory.
- Installed only via an explicit `.overrideProvider(KycTierEvidenceReader)` next to the `DataSource`
  override. **No production bypass was added.**

### 2.4 Migration-head expectations

Two suites (`v1-limit-02-limit-assignment`, `v1-007-support-ticket`) asserted that the newest
applied migration was one of a hand-written list of timestamps — and `v1-007` additionally carried a
regex listing every migration name up to `ConfigureTransactionNotificationEvents…0103`. Both lists
had gone stale and failed on a *correct* chain (`WalletOwnerClassification…0116` is the current
head). The property under test — "the applied chain reaches the current head" — is preserved; the
expectation is now derived from `src/migrations`.

### 2.5 Isolated KYC suite integration (deliverable 4) — COMPLETE

- `scripts/run-isolated-kyc-tests.js` + `jest.isolated-kyc.config.js` + `test/support/kyc-isolated-cluster.ts`.
- No machine-specific absolute paths: the cluster is socket-only inside a per-run temporary
  directory, and the disposable-cluster guard is evidence-based (marker + manifest), not path-based.
- Spawns Jest with the egress guard preloaded (`-r test/support/mission-25c-network-guard.cjs`).
- Result: **8/8 suites, 88/88 tests, exit 0** (see §4).

### 2.6 Background worker lifecycle (deliverable 5) — COMPLETE, coordinated with Arena 1

`KycTierWorker` polled automatically inside every `AppModule`-booting suite, racing fixture setup
and keeping transactions open during teardown. It is now explicitly configurable:

- `KYC_TIER_WORKER_ENABLED` — defaults **ON** outside tests (production behaviour unchanged) and
  **OFF** under `NODE_ENV=test`; an explicit value always wins, so a test that exercises the worker
  can turn it back on.
- `KYC_TIER_WORKER_POLL_INTERVAL_MS` — default 30000, bounded 250 ms–1 h.

This is a production-source change of configuration surface only (no behaviour change when the
variable is set as before); it was made deliberately visible in its own commit (`a4f0c45`) for Arena
1 review rather than buried in a test batch.

### 2.7 Bounded regression execution (deliverable 3) — COMPLETE

`scripts/run-pg-integration-tests.js`:

- Bounded batches, each a **fresh child process** with its own heap ceiling
  (`PG_TEST_BATCH_SIZE`, `PG_TEST_CONCURRENCY`, `PG_TEST_MAX_OLD_SPACE_MB`); the OS reclaims memory
  between batches, which is what removes the heap exhaustion.
- Strict argument validation (a zero batch size cannot hang the runner), run-namespace propagation
  so every generated database shares one identifier.
- Classifies heap exhaustion, timeouts and unexplained crashes **separately** from ordinary test
  failure, so an infrastructure defect can never be reported as a business-logic failure.
- New in this mission: per-suite outcomes parsed from Jest's own `PASS`/`FAIL` lines, per-batch
  `Tests:` tallies, and a failure taxonomy (memory, timeout, KYC policy/evidence fixture, migration
  catalogue, duplicate key, authorization, HTTP status, setup, assertion), emitted on stdout and in
  `PG_TEST_SUMMARY` / `PG_TEST_SUMMARY_PATH`. The taxonomy names the **observed symptom**; it never
  asserts whose defect a failure is.

---

## 3. Coordination with Arena 1 and Arena 2

- Arena 1 (`arena/44f00580-monienaija`, `780ec761`) is merged in as a prerequisite; this branch does
  not modify it.
- Arena 2 (`arena/ea070127-monienaija`, `9466cc2`) is **not** merged (`do not merge yet`).
- Only one production file group was touched (worker configuration, §2.6). No financial logic,
  authorization policy, routing or migration was changed.
- No commit, branch, rebase or force-push was performed against another arena's branch.

---

## 4. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `eslint "{src,test}/**/*.ts"` | exit 0 |
| Isolated KYC suites (`node scripts/run-isolated-kyc-tests.js`) | 8/8 suites, 88/88 tests, exit 0 |
| Fixture contract suite | 8/8 |
| `v1-007-support-ticket` | 31/31 |
| `v1-limit-02-limit-assignment` | 19/19 |
| `v1-001-customer-funding` | passing |
| `a13`–`a17` agent cash suites | 33/33 |
| `v1-commercial-accounting-01` | 33/33 |
| `v1-commercial-scenario-matrix-01` | 27/27 |
| `v1-commission-runtime-wiring` | 24/24 |
| `v1-fee-runtime-wiring` | 14/14 |
| `notification-reliability` | 21/21 |
| Full bounded PG inventory | see §5 |

### Recovered vs newly completed

The sandbox was reset mid-mission; the worktree was re-cloned to the branch base and only the pushed
commits survived. Recovery and continuation were done on top of the remote tip `2b2f39b`:
restored the lint cleanup and the runner taxonomy commit, and then completed the canonical-customer
fixture (`createEligibleCustomer`) and the commercial-suite wiring that had been lost uncommitted.

---

## 5. Full bounded PG inventory

Command (the recommended bounded invocation):

```bash
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
PG_TEST_SUMMARY_PATH=pg-summary.json npm run test:pg
```

Result: **PENDING — filled in from the run in progress.**

---

## 6. Reproducing

```bash
npm ci --ignore-scripts
node scripts/prepare-pg-test-env.js --create-if-missing   # writes .env for the embedded cluster
EMBEDDED_PG_CONFIRM_DISPOSABLE=yes node scripts/embedded-pg.js &   # or any disposable local PG
npm run test:pg
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js
```

## 7. What this mission did **not** do

- No test was deleted, skipped or weakened to reach green.
- No production authorization was loosened, and no bypass was added for test evidence.
- No live provider, secret, real transaction or deployment was involved.
- Business-logic failures that remain are reported as such and left red.
