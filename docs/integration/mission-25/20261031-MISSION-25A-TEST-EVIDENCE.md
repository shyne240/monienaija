# Mission 25A — Offline test and synthetic-probe evidence

- **Source snapshot:** `019de996950b07e9312af455ce0d9b840e6e14f1`
- **Audit date:** 2026-10-31 (Africa/Lagos)
- **Classification:** audit evidence; synthetic inputs only; not proof of sandbox or real delivery.

The [completeness report](./20261031-MISSION-25A-NOTIFICATION-BACKEND-AUDIT.md) describes source evidence, findings, and limitations. No application source, existing test, migration, configuration, dependency manifest, or lockfile was changed for this audit. No database was started or migrated, provider activated, deployment performed, or live SMS/email sent.

## Exact-install preparation

- Repository root: `npm ci --ignore-scripts --no-audit --no-fund` — exit **0**, 979 lockfile-resolved packages installed under ignored `node_modules`.
- `apps/admin-web`: the same command — exit **0**, 497 lockfile-resolved packages installed under ignored `node_modules`.
- These are test-only installs, not dependency upgrades; tracked manifests and lockfiles remained unchanged. The registry was used for the installs, **not** for the guarded test/probe executions below.

A test-only Node preload outside the repository blocked Node TCP/UDP connection and send methods, TLS, HTTP(S), DNS lookup/resolve methods and global `fetch`. After strengthening the initial guard, all three Jest sets and four probes were rerun with it; each final invocation printed `M25A_OFFLINE_GUARD blocked_attempts=0`. The 177 count is unique tests, not a sum of repeated runs. This preload is test instrumentation, not a general OS-level network firewall. Provider adapters in these tests/probes use fake transports; passing them does not verify any deployed configuration, database state, provider account, vendor acceptance, or end-user receipt.

## Executed tests

All invocations used Jest `--runInBand --no-cache --silent --runTestsByPath` and the offline preload. All exited **0**.

| Test set | Suites | Passed / total | Specific files and passed cases |
|---|---:|---:|---|
| Backend notification, security and adapters | 11 | **104 / 104** | `test/notification-provider-config.unit.spec.ts` 17; `src/admin/admin-notification.controller.spec.ts` 19; `test/resend-email-provider.unit.spec.ts` 20; `test/robase-notification-provider.unit.spec.ts` 14; `test/notification-email-template.unit.spec.ts` 7; `test/notification-reliability.unit.spec.ts` 5; `src/agent/agent-cash-to-cash-notification.spec.ts` 2; `test/notification-template-engine.spec.ts` 5; `src/notification/cash-to-cash-notification.spec.ts` 6; `test/notification-direct-security-logging.unit.spec.ts` 6; `src/notification/notification-worker-phone-recipient.spec.ts` 3. |
| A7 policy-boundary unit tests | 4 | **53 / 53** | `test/a7-product-notification-delivery.service.spec.ts` 31; `test/a7-product-notification-delivery.constants.spec.ts` 15; `test/a7-product-notification-delivery.module.spec.ts` 4; `test/a7-product-notification-delivery.types.spec.ts` 3. Repository and consumer ports are fakes; no channel provider was exercised. |
| Admin Web notification/provider components | 2 | **20 / 20** | `apps/admin-web/__tests__/notification-management.test.tsx` 13; `apps/admin-web/__tests__/provider-configuration.test.tsx` 7. API client methods are Jest mocks; this is not an HTTP/session or live browser/backend integration test. |
| **Total** | **17** | **177 / 177** | These results cover the named tests only. |

The backend provider unit suite contains mocked F-01 provider-reference/egress tests and the F-05 explicit DNS-boolean test; the Admin Web provider suite also covers its mocked F-05 form behavior. These passing tests are not a blanket certification of all provider governance or of real DNS. The separate governance failure below was not covered by those positive/negative scenarios.

## Synthetic probes (not database or provider integration)

Executed with Node, `ts-node/register/transpile-only`, `NODE_PATH` pointed at the ignored exact-install dependencies, and the same offline network guard. Fake managers, authorization, and transports were supplied. All final runs exited **0**, with **zero blocked network attempts**.

1. **Producer/consumer shape and presentation probe.** A support `message_added` event with exactly the producer-shaped fields `{ticketId, messageId, authorType, authorId}` yielded a notification receipt `QUARANTINED / SUPPORT_VISIBILITY_UNKNOWN` and zero delivery inserts; `isInternal` is absent. A `status_changed` payload shaped as `{ticketId, to: 'IN_PROGRESS'}` rendered `Your support ticket your request status changed to updated.` Mapped synthetic completed/failed transfer events yielded two/one CUSTOMER SMS intents, respectively; `deposit.completed`, `deposit.failed`, `withdrawal.completed`, and `withdrawal.failed` yielded no intents. A synthetic C2C-created event yielded one PHONE/SMS intent. An Agent lifecycle intent resolved to `AGENT_PHONE_DEPENDENCY_MISSING`; a PUSH resolution returned `PUSH_TOKEN_DEPENDENCY_MISSING`. Two channel rows for one customer event yielded two inbox items; captured SQL lacked an in-app-preference predicate or deduplication. Calling the temporary-credential response builder with `delivery.delivered=false` still returned a notice saying the credential was delivered. A direct read-only guard-method probe denied POST and allowed GET; a code-owned C2C preview used synthetic data. **None of these calls exercised an HTTP session, a PostgreSQL query, or an actual provider.**
2. **Governed-provider read-failure probe.** In a synthetic production-mode configuration with valid-shaped *fake* direct-environment Robase/Resend credentials and fake HTTP transports, healthy fake database rows marked SMS and EMAIL disabled yielded zero fake requests. Replacing the row reads with a simulated database exception caused two fake requests and two fake successes through the environment adapters; cached email selection also became `resend`. This establishes the source behavior under the stated prerequisites, not that any deployed environment has those credentials or that a real message was sent. Managed-environment mode has a different fail-closed fallback.
3. **Diagnostic-identifier probe.** A fake outbox manager supplied the same dummy credential-shaped sentinel as correlation and causation IDs: `enqueue` masked correlation but returned raw causation, and `mapEventToIntents` preserved the raw causation. A separate fake admin delivery row carrying the dummy value in both fields was returned verbatim by `AdminNotificationController.listDeliveries`, despite the shared diagnostic-identifier sanitizer masking the sentinel. Fake authorization simply allowed the call; no real HTTP authorization, database contents, or real secret was used or established. This is conditional on a reachable producer supplying unsafe causation or legacy unsafe values being present.
4. **Registry/UI policy mismatch probe.** A seed-shaped fake row for `customer.funding.approved`/SMS with `delivery_class=TRANSACTIONAL`, `is_locked=false`, and version 1, plus fake authorization, approval and audit objects, allowed `requestChange` to create a synthetic `REQUESTED` proposal to disable that event. This did **not** approve or execute the proposal; no real policy, session or database was changed. Source inspection separately shows the checker/execution path, and the existing unrun registry integration test explicitly expects a governed disable to execute. The Admin Web static catalogue labels the same trigger locked; this is a contract/policy alignment issue, not evidence that the SECURITY-class lock was bypassed.

An initial attempt to run probe 1 failed before the probe loaded because `reflect-metadata` was not resolvable from the external script's directory; adding `NODE_PATH` for the repo's installed dependencies fixed the **harness**. The successful result above is the final rerun.

## Inspected but not run

PostgreSQL integration test harnesses call migrations. The Mission 25A prohibition on migrations therefore excluded `test/v1-005-notification-delivery.integration.spec.ts`, `test/v1-006-customer-notification-inbox.integration.spec.ts`, `test/v1-email-notification-01.integration.spec.ts`, `test/sms-v1-01.integration.spec.ts`, `test/notification-reliability.integration.spec.ts`, `test/transfer-notification-producer-01.integration.spec.ts`, provider configuration/registry/upgrade suites, and their migration-chain dependencies. Their source was inspected only. Prior missions' successful PostgreSQL tests are historical and are **not** counted above.

No sandbox or live provider test, real message receipt, inbox acceptance, domain authentication, database content inspection, deployment readiness, or production environment inspection was performed. Brevo connection verification can make real vendor calls and was not invoked. Provider comments describing vendor contracts are repository assertions, not independently verified current vendor behavior.
