# Mission 25C — test evidence and limitations

**Status: NOT READY FOR ARENA 3 INTEGRATION.** This is a reporting-only handoff for the uncommitted working tree. There is no pushed Mission 25C implementation commit. The recorded results below came from completed commands earlier in this session; the raw `/home/user` logs and disposable PostgreSQL process did not survive the environment restoration, so they cannot now be independently inspected. No test was rerun during this reporting-only turn.

## Completed checks

| Check | Result | Scope and qualification |
|---|---|---|
| Final guarded root `npm test` | **228 suites, 2,701 passed, 0 failed, 0 skipped; exit 0** | Final working-tree implementation and test-only guard, including notification, provider fakes, security and authorization units. No vendor delivery is implied. |
| Earlier broad serial PostgreSQL regression | **26 suites, 524 passed, 0 failed, 0 skipped; exit 0** | Nine serial batches of 90, 133, 58, 39, 47, 30, 87, 24 and 16 tests. This preceded final runtime checks for malformed resolved secrets, missing endpoints and sender/reply-to metadata. |
| Post-hardening PostgreSQL financial lifecycle/provider/email batch | **3 suites, 79 passed, 0 failed, 0 skipped; batch exit 0** | `a5-payment-lifecycle`, provider configuration/governance and email HTTP, including malformed rotated-secret test-send preflight. The encompassing six-suite invocation exited 1 because another suite had one stale expected count, described below. |
| Corrected PostgreSQL quarantine/credential/registry rerun | **3 suites, 39 passed, 0 failed, 0 skipped; exit 0** | Includes the four unsupported deposit/withdrawal outcomes quarantined with no notifications, credential outcomes, and registry governance. |
| Final-guard PostgreSQL provider/email/reliability rerun | **3 suites, 57 passed, 0 failed, 0 skipped; exit 0** | Provider governance, authorized and unauthorized HTTP, unreadable/incomplete settings, public support producer-to-consumer, malformed/forged event quarantine and diagnostics. |
| Focused post-hardening units | **4 suites, 71 passed, 0 failed, 0 skipped; exit 0** | Provider routing, diagnostic masking, provider configuration and email templates. Four additional verification cases were subsequently covered by the final full unit suite. |
| Previous real-PG notification/support/provider/auth subset | **14 suites, 214 passed, 0 failed, 0 skipped; exit 0** | Earlier implementation snapshot. |
| Previous real-PG Ordinary Agent/workforce/auth subset | **12 suites, 308 passed, 0 failed, 0 skipped; exit 0** | Earlier implementation snapshot, including cash workflows, logout, MFA and role authorization. |
| Additional focused PG reruns | **4 suites/92**, **2 suites/39**, and **1 suite/17**, all passed with exit 0 | Earlier support/delivery/inbox, provider preflight, and diagnostic-projection checkpoints, respectively. They overlap the broader runs and are not additive coverage. |
| `npx tsc --noEmit` | **exit 0** | After the final implementation changes. |
| `npm run build` | **exit 0** | After the final implementation changes. |
| Selected ESLint | **14 baseline-clean changed files, exit 0** | Five other changed files retain **215 pre-existing errors both before and after, with zero new errors by rule/message**. Their ESLint invocation exits 1; whole-repository lint was not shown to pass. |
| `git diff --check` | **exit 0** | Most recent verification of the current restored worktree. |

## Failed attempts, corrections and unknowns

- The first post-hardening six-suite PostgreSQL command had **5 suites passing and 1 failing; 117 tests passed and 1 failed, exit 1**. Adding four quarantined financial facts correctly increased a diagnostics list from five to nine; the old expected count was updated, and the affected three-suite rerun passed 39/39. The earlier passing three-suite batch was 79/79.
- A focused unit command referenced one nonexistent test path and one new test selected the wrong fake email provider: **2 suites failed, 2 passed; 1 test failed and 63 passed, exit 1**. Both test-only mistakes were corrected; the four-suite rerun passed 71/71 and the final full unit suite passed.
- An earlier PG reliability check selected a nonexistent receipt `id` and failed one test; the query was corrected to `outbox_event_id` and later reruns passed. Another earlier diagnostic fixture attempted to update an immutable outbox fact; it was replaced with a legacy-shaped insert and later passed. No production schema or immutable business fact was changed to satisfy either test.
- The first full unit attempt had three Fastify failures because the test preload blocked numeric wildcard bind lookup. The guard was corrected, the suite passed, and the final guard additionally blocks promise-based and resolver DNS APIs.
- A final seven-suite Agent/authorization PostgreSQL rerun was started, but its process and log were unavailable after environment restoration. **Its outcome and skip count are unknown; it is not counted as passed.** The earlier 26-suite run did cover those domains before the final provider-hardening change.
- No skips were reported in the completed final root suite, 26-suite broad run or the completed focused PG reruns above. The unknown final Agent/authorization rerun cannot be assigned a skip count.
- Earlier Mission 25A ran **17 suites/177 tests**, with no PostgreSQL tests or live delivery; see [Mission 25A test evidence](20261031-MISSION-25A-TEST-EVIDENCE.md).

## Security and isolation

The PostgreSQL evidence used a disposable local PostgreSQL 18.4 UTF8 cluster at loopback port 55432, synthetic credentials, run-namespaced databases and the actual repository migration chain. Immediately before the last seven-suite rerun, a query showed no non-system databases remained. The environment and last process later disappeared, so cleanup after that final attempt cannot be independently confirmed.

Adapters were fake transports or non-production console simulation, never real SMS/email. The test-only `test/support/mission-25c-network-guard.cjs` was self-tested against external socket, callback/promise DNS and fetch paths while permitting loopback; SHA-256 `0efeb688e4caf17b351e6221d3619b945d6b88542066214eb431cb1ff3e4df18`. It is **not an OS firewall** and does not prove safety of unrelated native subprocesses. No production database, real provider activation, live delivery or deployment was used.

## Reproduction shape

Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` and `DB_ADMIN_NAME` for a newly created **disposable local test cluster** only. Never run integration tests against production. Then:

```sh
export NODE_ENV=test NODE_OPTIONS="--require=$PWD/test/support/mission-25c-network-guard.cjs"
npm test
PG_TEST_RUN_ID=m25cverify PG_TEST_BATCH_SIZE=3 PG_TEST_CONCURRENCY=1 \
  node scripts/run-pg-integration-tests.js --runTestsByPath \
  test/v1-email-notification-01.integration.spec.ts \
  test/v1-notification-provider-configuration-01.integration.spec.ts \
  test/notification-reliability.integration.spec.ts
npx tsc --noEmit
npm run build
```

The full 26-suite list comprised `v1-admin-authorization-hardening-01`, `v1-007-support-ticket`, `v1-email-notification-01`, `a16-agent-cash-to-cash-claim`, `v1-006-customer-notification-inbox`, `v1-005-notification-delivery`, `v1-sprint1-notification-delivery-authorization`, `v1-hardening-09-admin-notification-delivery-diagnostics`, `notification-reliability`, `v1-notification-provider-configuration-01`, `v1-customer-credentials-01`, `sms-v1-01`, `a21-agent-app`, `v1-sprint1-f01-historical-delivery-disclosure`, `a17-agent-cash-to-cash-expiry`, `notification-registry`, `v1-agent-mfa-api-01`, `mission-19a-workforce-logout`, `a14-agent-cash-out`, `a13-agent-cash-in`, `a15-agent-cash-to-cash`, `transfer-notification-producer-01`, `mission-15a-agent-sessions`, `mission-16a-agent-read-authorization`, `v1-admin-authorization-foundation-01`, and `notification-migration-upgrade-01` (all under `test/` with suffix `.integration.spec.ts`).
