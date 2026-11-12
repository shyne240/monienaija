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

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `eslint "{src,test}/**/*.ts"` | exit 0 |
| Isolated KYC (`KYC_ISOLATED_CONFIRM_DISPOSABLE=yes node scripts/run-isolated-kyc-tests.js`) | **8/8 suites, 88/88 tests, exit 0** |
| Full bounded PG inventory, baseline (before this session's fixes) | 139 discovered, **87 passed / 52 failed**, 0 memory failures, 0 timeouts, 0 crashed batches, 41.7 min, 1 992/2 517 tests |
| Full bounded PG inventory, after the fixture work | 139 discovered, **124 passed / 15 failed**, 0 memory failures, 0 timeouts, 0 crashed batches, 52.6 min, **2 447/2 516 tests** |
| Suites re-verified individually after that inventory | +6 green (`p0-p1` 41/41, `v1-hardening-06` 15/15, `transfer-notification-producer-01` 4/4, `v1-agent-mfa-api-01` 13/13, `v1-admin-authorization-customer-read-01` 54/54, `s-fix-01` 7/7) |
| **Current standing** | **130 / 139 suites** (see the caveat in §6) |

Individual suites verified green after remediation (real PostgreSQL):

`a12` 19/19 · `a24` 19/19 · `a13`–`a17` 33/33 · `a23` (failures fixed, suite remains red for one
Arena-1 item, §6) · `hardening-04` 26/26 · `v1-003` 21/21 · `v1-005` 23/23 · `v1-006` 23/23 ·
`v1-007` 31/31 · `v1-001` · `v1-commercial-accounting-01` 33/33 · `v1-commercial-scenario-matrix-01`
27/27 · `v1-commission-runtime-wiring` 24/24 · `v1-fee-runtime-wiring` 14/14 ·
`v1-hardening-01-customer-beneficiary` 30/30 · `v1-limit-02` (migration head fixed) ·
`v1-limit-04` 28/28 · `v1-limit-05-flow-matrix` 205/205 · `v1-commercial-decision-02` 10/10 ·
`v1-commercial-decision-03a` 8/8 · `v1-system-01` 5/5 · `sms-v1-01` 12/12 ·
`notification-reliability` 21/21 · `mission-25g` 19/19 · `h04-h06-notification-upgrade` 1/1 ·
`notification-migration-upgrade-01` 2/2 · `mission-25o-credential-binding-upgrade` 2/2 ·
`kyc-fixture-contract` 8/8.

---

## 6. Remaining failures and their causes

**Caveat, stated plainly:** the 130/139 figure is composed of the last complete inventory (124) plus the
six suites that were re-verified individually after it. It is **not** a single consolidated run of the
finished tree; re-running the whole inventory would take ~55 minutes and was not done again in this
session. 124/139 is the number from one real, complete, bounded run.

Remaining 9 suites and their observed causes:

| Suite | Observed symptom | Cause classification |
|---|---|---|
| `v1-customer-onboarding-01` | 8× `201 → 503` | **Arena 1 behaviour**: `CustomerRegistrationService.completeRegistration` always fails closed (commit `05a38f4`, "Fail closed legacy onboarding pending trusted KYC"). The suite exercises the legacy route. |
| `v1-customer-onboarding-02` | 8× `201 → 503` | same |
| `v1-customer-credentials-01` | 13× `201 → 503` | same |
| `v1-admin-authorization-kyc-01` | 5× `201 → 409` | KYC-assessment write for a raw-SQL customer; the assessment/eligibility invariants are not yet satisfied by that suite's own fixture |
| `v1-admin-authorization-hardening-01` | 2 assertions `Expected: 200` | customer session issuance now gated; that suite builds its customer outside the shared helper |
| `mission-16a-agent-read-authorization` | 4× `Expected 200 / Received 409` | customer-token flow gated on eligibility; suite mints tokens directly |
| `batch-01-customer-servicing` | 1× `Trusted KYC evidence is unavailable`, 1× `200 → 409` | its seed helper inserts customers with an arbitrary status passed in by the caller, so it was deliberately **not** blanket-completed (that would break its own rejection cases) |
| `v1-limit-02-limit-assignment` | 1× `Expected 201 / Received 404` on `POST /internal/limit-assignments` | the subject is a raw-SQL customer; the assignment write now reports the subject as not found |
| `local-dev-11-roles` | 5 deep-equality assertions on a seed subprocess result | role-seed fixture drift, unrelated to KYC eligibility |

None of these was made green by deleting, skipping or weakening a test, and none involved a
production-code change. They are left visible for the follow-up that owns them (Arena 1 for the
registration behaviour; a further fixture pass for the last four).

- **Arena-1-attributable behaviour change (not a fixture defect, deliberately not worked around):**
  the legacy customer-registration path is hard-disabled in production code
  (`CustomerRegistrationService.completeRegistration` always fails closed with 503
  "Customer registration is temporarily unavailable", commit `05a38f4`). `v1-customer-onboarding-01`,
  `v1-customer-onboarding-02` and `v1-customer-credentials-01` exercise that legacy route and now
  correctly receive 503. Re-enabling it, or asserting around it, would be a production/behaviour change
  and belongs to Arena 1's scope.
- **Remaining assertion failures** in the admin-authorization and support suites are reported as they
  stand, with the exact first symptom recorded in the run summary; they were not "fixed" by relaxing
  expectations.

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
