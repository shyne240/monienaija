# ARENA 3 — Staged Consolidation and Final Fixture Remediation (completion report)

**Branch:** `arena/8e59e188-monienaija` (Arena-assigned; never renamed, never merged into another arena)
**Base:** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`
**Final pushed SHA:** `c08c208` (last code/test commit) · branch tip: the docs commit that records
this line — `git log -1 arena/8e59e188-monienaija` is authoritative.
**Scope:** integration of Arena 2, fixture remediation, migration of the legacy-registration suites, and
full verification. No financial business logic was authored here, no production authorization was
weakened, no test was deleted, skipped or loosened.

---

## 1. Branch history produced by this mission

| SHA       | What                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `3d05aae` | Arena 3 base (contains Arena 1 Batch 2C tip `780ec76` merged as `1c2bae6`)                               |
| `fde13ce` | pre-consolidation tip — 136/139 suites green, 3 legacy-registration suites red (tag `arena3-pre-arena2`) |
| `4cc8a9c` | **merge of Arena 2** `9466cc2b26bdc030cf1fd6588fea5f1fae2941f7` into this branch only                    |
| `e668427` | portability fix for Arena 2's new isolated session suite (no assertion changed)                          |
| `174b440` | prettier pass on that suite — six-fixture remediation verified green here                                |
| `a7b12cd` | `v1-customer-onboarding-02` (9/9) and `v1-customer-credentials-01` (13/13) migrated                      |
| `fc70937` | `v1-customer-onboarding-01` migrated (20/20) — all three legacy suites green                             |
| `d4db6be` | `s-fix-01` test 7 re-pointed at Arena 2's (stronger) session-revocation contract                         |
| `557a115` | removed the last repo-wide lint warning (unused `eslint-disable`)                                        |

---

## 2. Arena 2 integration

Arena 2 was integrated with `git merge 9466cc2b` on this branch only. Nothing was pushed to
`arena/ea070127-monienaija`, and Arena 1's unfinished financial work was **not** merged.

**One conflict**, in `test/kyc-foundation.isolated-pg.test.ts`:

- Arena 3 had replaced that file's hand-rolled cluster-provenance block with the shared
  `test/support/kyc-isolated-cluster.ts` contract (marker + manifest + `data_directory` match +
  socket-only + minimum server version).
- Arena 2 had extended the same file's hand-built schema so that `authentication_sessions` carries
  `credential_id`, `onboarding_password_version`, `issued_at`, `last_seen_at`, `revoked_at`,
  `revoke_reason`, `version` (credential-version binding) and had added a
  `CustomerFinancialEligibilityService` stub.
- Resolution: **both** intents kept — Arena 2's schema/eligibility changes, driven through Arena 3's
  shared provenance helper (the duplicated provenance block was not restored).

Both implementations were preserved everywhere else; the merge is additive:

| Area                                   | Arena 2 contribution preserved                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CustomerFinancialEligibilityService`  | `lockMode` parameter, read-only `SHARE` vs financial-mutation `UPDATE` lock selection                                              |
| `AuthenticationSessionService`         | credential binding (`requireBoundCredential`), `validateInManager`, audience normalisation, revocation accounting, `revokeAllFor*` |
| `CustomerService`                      | revokes every session on `SUSPENDED`/`CLOSED` **and on leaving `SUSPENDED`**                                                       |
| KYC tier transition / exception review | new exception-review hooks and transition guards                                                                                   |
| Mobile onboarding auth                 | `mobile-onboarding-auth.service.ts` + `auth-store.ts` + `RegistrationScreen.tsx`                                                   |
| `PostgresKycStore`                     | session/ownership-aware reads                                                                                                      |
| Evidence fixtures                      | controlled evidence contract used by the isolated suites                                                                           |
| Isolated PG execution                  | new `test/…batch2c-session-remediation.isolated-pg.test.ts` (967 lines)                                                            |
| Credential-version binding             | `onboarding_password_version` on every session row                                                                                 |

Arena 2's new isolated suite originally hard-coded one developer's absolute socket path
(`/home/user/m25c-isolated-pgsocket/kyc-batch1-*`), a fixed port, a `data_directory` regex and a
PostgreSQL-16-only version check. It now uses the shared provenance contract like the other eight
isolated suites (`e668427`). **No assertion was changed.**

---

## 3. Fixture remediation (six suites)

All six were green at `174b440`:

| Suite                                  | Was   | Cause                                                                                                 | Now       |
| -------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- | --------- |
| `v1-admin-authorization-kyc-01`        | 23/29 | review body shape (`NONE` + governed reason for manual holds); approval needs real MAC-bound evidence | **29/29** |
| `v1-admin-authorization-hardening-01`  | 34/36 | `SUSPENDED → ACTIVE` runs the eligibility gate; customer built outside the helper                     | **36/36** |
| `mission-16a-agent-read-authorization` | 0/4   | session issuance gated; suite minted tokens from a raw-SQL customer                                   | **4/4**   |
| `v1-limit-02-limit-assignment`         | 17/18 | limit profiles `ASSIGN_A..D` never seeded                                                             | **18/18** |
| `batch-01-customer-servicing`          | 2/4   | helper MAC derived from requested rather than stored identity columns; `DRAFT → ACTIVE` eligibility   | **4/4**   |
| `local-dev-11-roles`                   | 0/5   | seed script required `dist/` unconditionally                                                          | **5/5**   |

`batch-01` keeps its arbitrary customer statuses and its rejection scenarios: `makeCustomerFinanciallyEligible`
still refuses to force `status='ACTIVE'`, and only suites that prove `DRAFT → ACTIVE` opt in via `allowDraft`.

`local-dev-11`: the role fixture and the authorization catalogue were compared role by role — both
hold the **same 11 roles**, so the fixture was correct and the failure was purely the missing build.
No authorization assertion was touched.

---

## 4. The three legacy-registration suites

Arena 1's `05a38f4` makes `POST /customers/registration` fail closed (503). These three suites used
that route only as _setup_. Each was re-pointed at the implemented onboarding/credential lifecycle,
using `test/support/controlled-onboarding.ts`: a draft customer plus a phone whose OTP and
single-use token are obtained and consumed for real (`verified_at` is never fabricated).

| Suite                        | Before | Now       |
| ---------------------------- | ------ | --------- |
| `v1-customer-onboarding-01`  | 9/20   | **20/20** |
| `v1-customer-onboarding-02`  | 1/9    | **9/9**   |
| `v1-customer-credentials-01` | 0/13   | **13/13** |

Assertions that inherently depend on the closed public completion route are re-expressed as
`503`/fail-closed assertions (and in onboarding-01 as "anonymous internal create is 401 and creates
zero customers"), never as skips. The re-mapping keeps every legacy property under test:

- token single-use and replay-inertness (`attempt_count` stays 0 after six bogus consumptions, then the
  real token consumes exactly once), phone binding, and enumeration resistance — all through
  `CustomerService.updateContactMethod` / `consumePhoneVerificationToken`;
- resend cooldown, per-IP OTP issuance cap (reachable replacement for the now-unreachable
  completion-per-IP bucket), and the audit trail of the events the implemented flow actually emits
  (plus absence of the retired `CUSTOMER_REGISTRATION_CHALLENGE` / `REGISTRATION_INITIATED` events).

No unsafe legacy registration was restored and no test was deleted or skipped.

---

## 5. Verification

Every figure is from a real run on the disposable local PostgreSQL cluster, no live provider, no
production secret, no real transaction. Complete runs and reruns are reported separately.

| Check                                                                                   | Result                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`                                                                          | exit 0                                                                                                                                                           |
| `eslint "{src,test}/**/*.ts"`                                                           | exit 0 — 0 errors, **0 warnings**                                                                                                                                |
| Backend unit regression, `--maxWorkers=1`, at `557a115`                                 | **237/237 suites, 2 827/2 827 tests**                                                                                                                            |
| Full bounded PG inventory at `557a115` (single consolidated run, runId `r8659a96b87ea`) | **139 discovered / 139 reported — 139 passed, 0 failed**, 24/24 batches, 0 memory failures, 0 timeouts, 0 unexplained crashes, **2 516 / 2 516 tests**, 50.0 min |
| Isolated KYC + session suites (`run-isolated-kyc-tests.js`)                             | **9/9 suites, 98/98 tests** (includes Arena 2's new session-remediation suite)                                                                                   |
| Customer mobile: `jest`                                                                 | **14/14 suites, 125/125 tests**                                                                                                                                  |
| Customer mobile: `tsc --noEmit`                                                         | exit 0                                                                                                                                                           |
| Three legacy suites, bounded batch                                                      | **3/3 suites, 42/42 tests**                                                                                                                                      |
| `s-fix-01` in isolation after `d4db6be`                                                 | **7/7**                                                                                                                                                          |

Inventory bisection used to reach this point, each a complete run of its own:

| Run                                                    | Scope          | Result                                                                                                |
| ------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------- |
| `rad879fe3e9c5` at `fc70937` (superseded by `d4db6be`) | 139 discovered | 138 passed / 1 failed (`s-fix-01` test 7), 0 memory failures, 0 timeouts, 2 615/2 616 tests, 62.4 min |
| `r8659a96b87ea` at `557a115` (**final**)               | 139 discovered | **139 passed / 0 failed**, 24/24 batches, 0 memory/timeout/crash, **2 516/2 516**, 50.0 min           |
| `final14` at `557a115` (aborted, contaminated)         | 139 discovered | discarded — see note below, batch 1 hit a 30 s `beforeEach` timeout                                   |

Note on `final14`: that run was started while the full backend unit regression and the repo-wide
eslint pass were running on the same 2-core / 3.9 GB sandbox. `v1-admin-authorization-customer-read-01`
timed out inside `beforeEach` at `truncateAllTables`, and the unit run itself lost three workers to
`SIGKILL`. Both artefacts were re-run with the box otherwise idle: the unit suite came back **237/237**
and the inventory was restarted cleanly. Neither was a code regression.

---

## 6. Newly discovered regressions

**One**, found and fixed inside this mission:

`s-fix-01-customer-lifecycle-authorization` test 7 asserted that after `SUSPENDED → ACTIVE` the
_original_ bearer token becomes usable again ("session was never revoked"). Arena 2 changed that
contract by design: `CustomerService.updateStatus` revokes every session when the customer is
suspended or closed **and when it was suspended**, so a reactivated customer must re-authenticate.

The assertion now encodes the stronger rule (`d4db6be`): the old token returns **401**, the session row
is `REVOKED`, and a fresh login on the reactivated customer returns **200**. Nothing was relaxed — the
security expectation was raised.

No other regression was found: the 136 suites that were green at `fde13ce` stayed green through the
Arena 2 merge and the four remediation commits.

---

## 7. Remaining blockers

None for this mission's scope. Explicitly outstanding, and owned elsewhere:

- **Arena 1** must decide the future of `POST /customers/registration` (still fail-closed 503 by
  design). The re-pointed suites prove the implemented lifecycle instead; they do not re-open the route.
- Arena 1's unfinished financial implementation is **not** merged here and must not be assumed present.
- No claim of production readiness is made. Everything above is test/infrastructure evidence on a
  disposable cluster.

---

## 8. Readiness for Arena 1's forthcoming financial implementation

- Both implementations (Arena 1 Batch 2C and Arena 2 CD-12/CD-13) coexist on this branch without
  either being reduced; the eligibility gate, credential binding and lock-mode split are all intact.
- The full 139-suite inventory and the 237-suite unit matrix are green at the final SHA, so Arena 1 has
  a trustworthy baseline to diff future financial work against.
- The harness is bounded, memory-safe and classified: heap failures, timeouts and crashes are reported
  separately from test failures, so new financial regressions cannot hide inside infrastructure noise.
- Fixtures are governed, opt-in and fail-closed by default: financial eligibility and trusted evidence
  are granted only where a suite asks for them.

---

## 9. Constraints respected

- No financial business logic authored; no production financial path changed.
- No production authorization, eligibility or KYC rule relaxed; no bypass for test evidence.
- No test deleted, skipped, renamed away or given a looser expectation.
- No live provider, real transaction, production secret or deployment.
- No merge into `main`, no push to another arena's branch, no force-push, no history rewrite.
- Logs for every run quoted above were kept in the sandbox (`final13/final15`, `unit-final2`,
  `iso-final`, `mobile2`, `t3`, `lint-final`).
