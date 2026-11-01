# Mission 25G — final test evidence

**Final verification:** 2026-11-01 13:38 UTC. The original nine-batch PostgreSQL run completed successfully; no replacement full run was needed. Counts from separate runs overlap and must not be added together. The [sanitized final machine-readable summary](evidence/test-summary.json) includes per-suite names and batch totals. The [earlier snapshot](evidence/test-summary-snapshot.json) is retained as a historical record of the previously incomplete run, not the final result. No test result is a production-readiness certificate.

## Completed executions

| Execution | Suites | Cases | Skipped/pending | Exit | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Full backend unit/regression, clean process environment | 229/229 passed | 2,713/2,713 passed | 0 | 0 | Pass |
| Full backend PostgreSQL regression, original nine-batch run | 132/132 passed | 2,452/2,452 passed | 0 | 0 | Pass; all nine batch exits also 0 |
| Focused preference policy/controller and existing service unit tests | 2/2 passed | 16/16 passed | 0 | 0 | Pass; also included in the full unit run |
| Final real-guard preference/audit PostgreSQL integration | 1/1 passed | 19/19 passed | 0 | 0 | Pass |
| Minimal-environment PostgreSQL smoke: 25G plus Mission 19A logout | 2/2 passed | 27/27 passed | 0 | 0 | Pass |
| Full backend unit, initial example-env-preloaded attempt | 226 passed, 3 failed, 229 total | 2,710 passed, 3 failed, 2,713 total | 0 | 1 | Failed from environment contamination; not a pass |
| Isolated rerun of the three affected unit files | 3/3 passed | 17/17 passed | 0 | 0 | Pass; then full clean rerun above |
| Baseline CUSTOMER_SERVICE GET red reproduction | 0 passed, 1 failed | 0 passed, 1 failed, 17 total | 16 filtered out | 1 | Expected failure against unchanged 25E: observed 200 instead of 403 |
| Baseline spoofed-actor red reproduction | 0 passed, 1 failed | 0 passed, 1 failed, 17 total | 16 filtered out | 1 | Expected failure against unchanged 25E: forged actor persisted |
| Pre-projection-fix SUPER_ADMIN audit red reproduction | 0 passed, 1 failed | 0 passed, 1 failed, 19 total | 18 filtered out | 1 | Expected failure: preference audit values returned |
| Pre-projection-fix SUPPORT audit red reproduction | 0 passed, 1 failed | 0 passed, 1 failed, 19 total | 18 filtered out | 1 | Expected failure: preference audit values returned |

The first audit-red attempt additionally failed test compilation due to a regex escape; it is not a runtime security reproduction. The initial full-unit attempt injected the full public `.env.example`: an empty `A6_PARTNER_SANDBOX_BASE_URL` looked configured and `CASH_TO_CASH_EXPIRY_WORKER_BATCH_SIZE` and `CASH_TO_CASH_EXPIRY_WORKER_STATEMENT_TIMEOUT_MS` were strings rather than defaults. The affected files were `partner-connection.service.spec.ts`, `agent-cash-to-cash-expiry-worker.spec.ts` and `mission-15a-expiry-status.spec.ts`. The isolated three-file and full guard-only reruns passed without modifying unrelated production code.

## Full PostgreSQL matrix: complete

The original run used `npm run test:pg`, `PG_TEST_RUN_ID=m25gfull1`, concurrency 1, batch size 15, synthetic local environment and the Node egress guard. It exited **0**; all nine batch exits were **0**. The final log contains 132 suite `PASS` lines, zero `FAIL` lines and the runner's `all passed` summary:

| Batch | Suites passed | Tests passed | Skipped | Batch exit |
| --- | ---: | ---: | ---: | ---: |
| 1 | 15 | 646 | 0 | 0 |
| 2 | 15 | 276 | 0 | 0 |
| 3 | 15 | 333 | 0 | 0 |
| 4 | 15 | 293 | 0 | 0 |
| 5 | 15 | 267 | 0 | 0 |
| 6 | 15 | 170 | 0 | 0 |
| 7 | 15 | 236 | 0 | 0 |
| 8 | 15 | 154 | 0 | 0 |
| 9 | 12 | 77 | 0 | 0 |
| **Total** | **132** | **2,452** | **0** | **all 0** |

`/home/user/m25g-pg-final1.log` is the full local log. The run includes the 25G real-guard suite, Mission 19A logout, customer-profile/Customer 360, customer compliance, notification registry/reliability/email and notification migration-upgrade suites, as well as financial and authorization regressions. No new 25G migration exists. Some intentional contention/negative cases caused PostgreSQL serialization and duplicate-key messages in the disposable server log; their test suites passed and they are not hidden suite failures.

After the suite, a query found **zero** remaining `mn_it_*` integration databases. The disposable PostgreSQL process was then stopped and its temporary socket directory removed; no production database was involved.

## What the focused real-guard suite covers

- Authenticated customer self GET, history, HEAD, POST and PATCH; cross-customer and anonymous denial, including equivalent GET denials for existent and nonexistent targets.
- All 11 seeded workforce roles, real persisted synthetic A2 sessions, CUSTOMER_SERVICE direct API and TREASURY without `customer.view`, plus separate AGENT and SUPPORT sessions.
- Read-only unsafe-method restriction; no unauthorized preference, history or business-audit mutations.
- Spoofed and omitted body actors bound to the actual customer principal; unchanged historical actor/audit rows.
- Percent-encoded paths, descendants and unsupported `/me/preferences`; generic audit and dashboard projection filtering including legacy decisions, preserved unrelated audit visibility and HTTP opt-in rejection.
- Authorized workforce customer profile access remains separate; existing notification opt-out at materialization and pre-send, with opt-in delivery only to a fake provider.

Customer, AGENT and SUPPORT sessions and A2 workforce session validation are real application paths backed by disposable PostgreSQL. The workforce identities are synthetic and established by the test harness, not by an external identity provider. Only the notification transport is replaced with a fake.

## Static and isolation checks

`npx tsc --noEmit`, `npm run build`, ESLint for all changed TypeScript source/test files, and `git diff --check` each completed successfully (exit 0) after the final executable code changes. No whole-repository lint pass is claimed. Tests used disposable PostgreSQL 18.4 on loopback, distinct test-database namespaces, synthetic test settings, and `test/support/mission-25c-network-guard.cjs` to block non-loopback Node-process DNS/socket/fetch egress. No real vendor send, external identity-provider authentication, production DB, real credential, deployment or provider activation was tested.

## Local raw artifacts and hashes

The following files are outside the Git repository and contain raw test output; they are not included in the patch. Hashes below allow matching the evidence without embedding logs or test data.

| Artifact under `/home/user/` | SHA-256 |
| --- | --- |
| `m25g-pg-final1.log` | `126e9560e50bca50005516b2170e563ab2723b8cce599a3906a80e02b55c0c61` |
| `m25g-unit-final3.json` | `d4bb5da73b4e75e9ec19afd9b3dc336706d19415b0402d844a148ca707bd932d` |
| `m25g-unit-final2.json` | `cac547f773b262595be17ac812e17356863282074e190f4b550e49d394b86982` |
| `m25g-unit-config-check.json` | `e3f6d5f71feb5e609ef7b384fdb495ce88a508c2bfca7609e735384de896ab3c` |
| `m25g-unit-target1.json` | `f04515fc6e6c8583e6de688215158027a317f3beed3dc17e0836efd86b66314f` |
| `m25g-target3.json` | `1f59975de224435994298c04fa12f11680ee1f63b7da6b6cd481cc1c90040e40` |
| `m25g-pg-minimal.json` | `dd233a192503450d69e61f64272fc75ea4f5c07b9d17fcaf97a6b4719d02f6e0` |
| `m25g-red-customer-service.json` | `99c657ec77f20d2822fa3e03b756f08211db3057e11db53e43df214060887e3a` |
| `m25g-red-actor.json` | `9b77ed20ed66b7a0556a941c92b9b773d4e0969b6e184e1739d822a4c376d402` |
| `m25g-audit-red2.json` | `114bbbe5f0e5ad130287bb22013b2af9f998b34c3a58de169f308b9a07be517e` |
| `m25g-audit-red3.json` | `69e014c69b9153943356a7e9c1fd747c5ecc24a3188e5651858a55cec1010737` |

## Not executed or not complete

No new Admin Web browser/unit suite was run for 25G; whole-repository lint was not run as a 25G clean-pass check; H-07 implementation, migration, binding/rotation tests and external-delivery tests were not performed; no real SMS, email, credentials or identity provider was used. Mission 25E's reported suite/browser totals are historical evidence, not a 25G rerun or independent reapproval.
