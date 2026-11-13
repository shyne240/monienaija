# ARENA 3 — PostgreSQL Regression Infrastructure Remediation (final report)

**Branch:** `arena/8e59e188-monienaija`
**Base:** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (Arena 3 base)
**Prerequisite merged in:** Arena 1 Batch 2C tip `780ec761245851cd6a1c201663ce0bc3777a5549` (merge commit `1c2bae6`)
**Scope:** test infrastructure and fixture compatibility only. No financial business-logic
remediation, no production authorization weakening, no skipped or deleted tests, no live providers.

---

## 1. Recovered state after the interruption

The mission was interrupted by a sandbox reset that re-cloned the worktree to the **branch base**, not
to the work in progress. Only what had been pushed survived. Recovery was performed from the remote
branch tip and verified before continuing:

| Item | State found | Action |
|---|---|---|
| Worktree | reset to `3d05aae` (branch base), containing **none** of the mission's files | discarded; it was an unrelated snapshot |
| Remote branch | `origin/arena/8e59e188-monienaija` = `2b2f39b` with 8 mission commits | recovered with `git reset --hard origin/...` |
| Lost local-only commits | lint cleanup + runner failure taxonomy | re-applied (§3.1) |
| Lost uncommitted work | `createEligibleCustomer` + 82 commercial-suite wallet sites | re-derived (§3.2, §3.3) |
| `node_modules`, embedded PostgreSQL, `.env`, all logs | gone | rebuilt from scratch (§7) |

No work was restarted from zero, and no recovered commit was rewritten.

---

## 2. What had to be fixed, and why

Batch 2C routes every wallet and financial path through `CustomerFinancialEligibilityService.require`,
gates **session issuance** on the same check, and classifies wallet owners with
`wallet_owner_class()`. Dozens of older suites create customers with direct SQL. Those fixtures — never
the gate, never the assertions — had to change. Five distinct failure classes were diagnosed:

| # | Symptom | Root cause | Remediation |
|---|---|---|---|
| A | `Customer financial policy is unavailable` | a wholesale `TRUNCATE` also empties three migration-seeded KYC singletons | `restoreKycSingletons()` after every truncate shape |
| B | `Trusted KYC evidence is unavailable` | raw-SQL customer: no identity parts, no evidence; production reader is fail-closed | shared governed fixture + explicit test evidence reader |
| C | `Customer is not eligible for financial access` | customer not ACTIVE/APPROVED with a current assessment | same fixture, placed before the wallet |
| D | `Wallet owner requires review` | wallet owner was a bare `randomUUID()` (`wallet_owner_class` → `REVIEW`) | canonical eligible-customer fixture |
| E | migration-chain assertions fail on a **correct** chain | hand-maintained "acceptable head" lists / exact upgrade sets | derive from `src/migrations` |

---

## 3. Deliverables

### 3.1 Bounded runner and its reporting (`scripts/run-pg-integration-tests.js`)

- Bounded batches, each a **fresh child process** with its own heap ceiling
  (`PG_TEST_CONCURRENCY`, `PG_TEST_BATCH_SIZE`, `PG_TEST_MAX_OLD_SPACE_MB`); the OS reclaims memory
  between batches, which is what removes heap exhaustion. Strict argument validation; one run
  namespace propagated to every generated database.
- Heap exhaustion, timeouts and unexplained crashes are classified **separately** from ordinary test
  failure, so an infrastructure defect can never be reported as a business-logic failure.
- New: per-suite outcomes parsed from Jest's own `PASS`/`FAIL` lines, per-batch `Tests:` tallies, and a
  failure taxonomy (memory, timeout, KYC policy/evidence, migration catalogue, duplicate key,
  authorization, HTTP status, setup, assertion), emitted on stdout and in `PG_TEST_SUMMARY`.
  The taxonomy names the **observed symptom**; it never asserts ownership of a failure.

### 3.2 Governed fixtures (`test/support/kyc-test-fixtures.ts`)

`KYC_INITIAL_SINGLETON_STATE`, `restoreKycSingletons`, `resetKycSingletons`, `seedGovernedTierPolicy`,
`seedIdentityEvidence`, `makeCustomerFinanciallyEligible`, and `createEligibleCustomer` (creates a
customer *and* satisfies the whole gate). All write real rows in the columns the production read path
uses, MAC-bound to the test trust anchor. `makeCustomerFinanciallyEligible` deliberately **does not**
force `status='ACTIVE'`, so a suite that creates a suspended customer to assert rejection keeps its
precondition.

Two later corrections in the same helper (both found by real failures, not by inspection):

- **The seeded MAC is now derived from the rows the database actually holds.** The helper used to
  compute the identity MAC from the *requested* defaults, while `COALESCE` kept any identity value a
  suite had already set (a suite that pinned its own date of birth, for example). The trusted reader
  binds to the stored values, so those customers were permanently `IDENTITY_MISMATCH` → 409. The MAC
  is now computed from the stored profile/contact rows.
- **`allowDraft` (default `false`).** Activation (`PATCH /customers/:id` → `ACTIVE`) runs the gate with
  `requireActive = false`, so a `DRAFT` customer must already be eligible *before* it is activated.
  Suites proving that `DRAFT → ACTIVE` succeeds opt in; nothing else changes, so rejection
  preconditions are preserved.

### 3.3 Trusted test evidence (`test/support/kyc-test-evidence-reader.ts`)

Test-only subclass of `KycTierEvidenceReader`; refuses to construct outside `NODE_ENV=test`; per-process
random trust anchor; **not eligible by default** (`UNAVAILABLE` returns `null`, preserving fail-closed
behaviour); installed only through an explicit `.overrideProvider(...)` in a suite that asks for it.
No production bypass was added.

### 3.4 Background worker (`src/kyc-verification/kyc-tier-worker.service.ts`, `kyc-tier.module.ts`, `config/environment.ts`)

`KYC_TIER_WORKER_ENABLED` (default ON outside tests, OFF under `NODE_ENV=test`, explicit value always
wins) and `KYC_TIER_WORKER_POLL_INTERVAL_MS` (default 30 s, bounded 250 ms–1 h). Production behaviour
is unchanged unless the variable is set; the change is isolated in its own commit (`a4f0c45`) for Arena
1 review.

### 3.5 Portable isolated KYC execution

`scripts/run-isolated-kyc-tests.js` + `jest.isolated-kyc.config.js` + `test/support/kyc-isolated-cluster.ts`:
socket-only disposable cluster in a per-run temp directory, evidence-based disposable guard (marker +
manifest, no absolute paths), egress guard preloaded. This is the only deliverable that had already been
completed and verified in the earlier segment; it was re-verified here (§5).

### 3.6 Fixture adoption across the suite inventory

Adopted in small, individually verified batches: agent cash suites a13–a17, the four commercial /
accounting suites, the notification suites, the session-issuing customer suites, the wallet-helper
suites, and the remaining `randomUUID` wallet owners. Every batch was compiled (`tsc`), linted and
spot-run before it was committed.

### 3.7 Fixtures that had to be corrected rather than adopted

- `test/support/mission15a-fixture.ts` grew an **opt-in** `trustedEvidence` option: suites that need a
  real customer session (session issuance passes the financial gate) install the test reader
  explicitly; suites that do not, keep the fail-closed production reader. Used by
  `mission-16a-agent-read-authorization` only.
- `v1-admin-authorization-kyc-01` now sends the body shape the assessment contract actually accepts:
  `APPROVED` carries the requested tier and is evaluated from locked evidence; `PENDING`/`REJECTED`
  are **manual holds** and must carry `level: 'NONE'` plus one of `EVIDENCE_REVOKED` /
  `IDENTITY_CONFLICT` / `MANUAL_REVIEW`. Approving also needs real evidence, so the suite seeds the
  governed policy and MAC-bound evidence. Tier 2 additionally required dropping the default policy's
  `PHONE` rule, a type the trusted read path cannot produce from `kyc_verification_attempts` — noted
  here because it is a real limitation of the fixture default, not a test trick.
- `scripts/local-dev-seed-11-roles.js` required `../dist/*` unconditionally, so in a source checkout
  every invocation died with `MODULE_NOT_FOUND` (that was the entire `local-dev-11-roles` failure).
  It now uses the compiled build when one exists and otherwise registers `ts-node`
  (`transpileOnly`) and loads the TypeScript sources. Seeding logic and every refusal guard are
  unchanged.

---

## 4. Coordination with Arena 1 and Arena 2

- Arena 1 (`arena/44f00580-monienaija`, `780ec761`) is merged as a prerequisite; this branch never
  modified it, rebased it or pushed to it.
- Arena 2 (`arena/ea070127-monienaija`, `9466cc2b`) was **not** merged (explicitly deferred).
- Production-source changes: only the worker configuration surface (§3.4). No financial logic,
  authorization policy, routing or migration was altered.
- Remaining failures that belong to Arena 1's behaviour are listed in §6 and were deliberately **not**
  papered over.

---

## 5. Verification

All figures below were produced **at the final commit of this branch**, on a disposable local
PostgreSQL cluster, with no live provider, no production secret and no real transaction.

| Check | Result |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `eslint "{src,test}/**/*.ts"` | **exit 0** (0 errors, 0 warnings) |
| Isolated KYC (`KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js`) | **8/8 suites, 88/88 tests, exit 0**, 38.8 s |
| Full bounded PG inventory (single consolidated run, runId `rc2952a987db0`) | **139 discovered / 139 reported — 136 passed, 3 failed**, 0 memory failures, 0 timeouts, 0 unexplained crashes, 23/24 batches green, **71.8 min**, **2 484 / 2 516 tests** |
| Failure categories in that run | `HTTP_STATUS=30`, `ASSERTION=2`, 4 `UNCLASSIFIED` console-capture entries (not test failures) |
| Baseline for comparison (same harness, before this work) | 87 passed / 52 failed of 139, 1 992/2 517 tests, 41.7 min |
| Intermediate inventory (before this last pass) | 124 passed / 15 failed, 2 447/2 516 tests, 52.6 min |

The 3 remaining failures are **one cause**, and it is not a fixture defect — see §6.

Fixed in this last pass, each verified individually before the consolidated run:

| Suite | Was | Cause | Now |
|---|---|---|---|
| `v1-limit-02-limit-assignment` | 17/18 | limit profiles `ASSIGN_A..D` were never seeded, so the assignment write returned 404 | **18/18** |
| `s-fix-01-customer-lifecycle-authorization` | 6/7 | activation gate on a raw-SQL customer | **7/7** |
| `v1-admin-authorization-kyc-01` | 23/29 | review body shape (`NONE` + governed reason for manual holds) and missing approval evidence | **29/29** |
| `v1-admin-authorization-hardening-01` | 34/36 | `SUSPENDED → ACTIVE` runs the eligibility gate; customer built outside the helper | **36/36** |
| `mission-16a-agent-read-authorization` | 0/4 | customer session issuance gated; suite minted tokens from a raw-SQL customer | **4/4** |
| `batch-01-customer-servicing` | 2/4 | `IDENTITY_MISMATCH` from the helper MAC bug (§3.2) + `DRAFT → ACTIVE` eligibility | **4/4** |
| `local-dev-11-roles` | 0/5 | seed script required `dist/` (§3.7) | **5/5** |

Earlier passes on this branch took the inventory from 87 → 124 green (§3.6); this pass took it to 136.

Regression safety: the shared helpers changed in this pass (`kyc-test-fixtures`,
`mission15a-fixture`, the seed script), so 9 suites that lean on them were re-run as a bounded batch
before the consolidated run — all 9 green (`p0-p1` 41/41, `s-fix-01` 7/7,
`transfer-notification-producer-01` 4/4, `v1-admin-authorization-customer-read-01`,
`v1-agent-mfa-api-01`, `v1-hardening-01` 30/30, `v1-hardening-06` 15/15, `v1-limit-02` 18/18,
`v1-limit-05-flow-matrix` 205/205) — and the consolidated run itself re-covered all 139.

Individual suites verified green at some point after remediation (real PostgreSQL): `a12` 19/19 ·
`a24` 19/19 · `a13`–`a17` 33/33 · `hardening-04` 26/26 · `v1-003` 21/21 · `v1-005` 23/23 ·
`v1-006` 23/23 · `v1-007` 31/31 · `v1-commercial-accounting-01` 33/33 ·
`v1-commercial-scenario-matrix-01` 27/27 · `v1-commission-runtime-wiring` 24/24 ·
`v1-fee-runtime-wiring` 14/14 · `v1-limit-04` 28/28 · `v1-limit-05-flow-matrix` 205/205 ·
`v1-commercial-decision-02` 10/10 · `v1-commercial-decision-03a` 8/8 · `v1-system-01` 5/5 ·
`sms-v1-01` 12/12 · `notification-reliability` 21/21 · `mission-25g` 19/19 ·
`h04-h06-notification-upgrade` 1/1 · `notification-migration-upgrade-01` 2/2 ·
`mission-25o-credential-binding-upgrade` 2/2 · `kyc-fixture-contract` 8/8.

One observed flake, recorded for honesty: in an **aborted** earlier attempt of the consolidated run
(killed for time-box reasons, superseded by runId `rc2952a987db0`), `v1-limit-04-limit-runtime`
failed once on "23 WALLET_TRANSFER concurrent identical idempotencyKey" (`expected 5 successes,
received 4`). It passed in the previous inventory, in the regression batch, and in the final
consolidated run. It is a genuine concurrency-timing flake in the suite, not a fixture dependency,
and it was not touched.

---

## 6. Remaining failures and their causes

**136 / 139 suites, 2 484 / 2 516 tests, from one complete bounded run — not a composed figure.**

The remaining 3 suites and all 32 failing tests share a single cause, and it is Arena 1's:

| Suite | Failing tests | Observed symptom |
|---|---|---|
| `v1-customer-onboarding-01` | 11 | `201 → 503` on registration (2 of them assert side effects of the blocked call) |
| `v1-customer-onboarding-02` | 8 | `201 → 503` on registration/activation setup |
| `v1-customer-credentials-01` | 13 | `201 → 503` on credential provisioning setup |

`CustomerRegistrationService.completeRegistration` fails closed by design (Arena 1 commit `05a38f4`,
"Fail closed legacy onboarding pending trusted KYC"): every request answers 503
"Customer registration is temporarily unavailable". These three suites drive that legacy route as
*setup* for their real assertions, so they cannot pass while the route is closed. Re-opening it, or
asserting around the 503, would be a production/behaviour change — explicitly out of this mission's
scope (§8) and left to Arena 1.

Everything else that was red at the start of the remediation is green, and none of it was made green
by deleting, skipping, or weakening a test:

- No test was removed, renamed away, `xit`/`skip`ped, or given a looser expectation to pass.
- One assertion was **updated with a written reason** where the business contract
  genuinely changed (`v1-admin-authorization-kyc-01` F1: a customer that must be financially eligible
  to hold a session now legitimately has a current APPROVED assessment, so its own `/kyc` read is
  `200` with `status: APPROVED` instead of the historic `404`; the property under test — "the CUSTOMER
  request reached the service, it was not blocked by the function check" — is unchanged).
- No production authorization, eligibility or KYC rule was relaxed. The only production-source change
  on this branch remains the worker configuration surface (§3.4).

---

## 7. Environment reconstruction (this sandbox)

```bash
npm ci --ignore-scripts
# embedded PostgreSQL needs these symlinks in this image before initdb will run:
#   libpq.so.5, libssl.so, libcrypto.so, libicuuc.so.60, libicudata.so.60, libicui18n.so.60
node scripts/prepare-pg-test-env.js --create-if-missing   # writes the git-ignored .env
# start a disposable cluster (or point DB_* at any disposable local PostgreSQL)
npm run test:pg
KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js
```

Recommended bounded invocation (the one used for every run in this report):

```bash
NODE_ENV=test PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes \
PG_TEST_CONCURRENCY=1 PG_TEST_BATCH_SIZE=6 PG_TEST_MAX_OLD_SPACE_MB=2560 \
PG_TEST_SUMMARY_PATH=pg-summary.json npm run test:pg
```

---

## 8. What this mission did not do

- No test deleted, skipped or weakened to reach green; no assertion relaxed except where the
  expectation itself was a stale hand-maintained list (class E), which was replaced by a derived
  expectation that is strictly stronger.
- No production authorization loosened; no bypass for test evidence; KYC-rejection suites still get
  fail-closed evidence unless they explicitly ask for eligible evidence.
- No live provider, secret, real transaction or deployment; no merge into `main` or into another
  arena's branch; no force-push or history rewrite.
- The three still-red suites were **not** touched: their blocker is Arena 1's fail-closed legacy
  registration, and working around it here would hide a real behaviour change owned by another arena.
