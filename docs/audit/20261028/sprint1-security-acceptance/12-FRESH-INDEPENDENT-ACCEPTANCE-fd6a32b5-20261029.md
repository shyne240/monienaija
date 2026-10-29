# Fresh independent security, reliability and integration acceptance — `fd6a32b5`

**Review date:** 2026-10-29 (Africa/Lagos)
**Repository:** `shyne240/monienaija`
**Exact application SHA reviewed:** `fd6a32b5acffd295b62ca4d346c38f128f336043`
**Integration documentation reviewed:** `60e7f567a029fed3cdfe0ce327a5c9109ca390ea`, `docs/SPRINT1-NOTIFICATION-RELIABILITY-INTEGRATION-20261028.md`
**Scope:** documentation/review only. No application, test, migration, configuration, infrastructure, mobile, or production changes were retained.

## Verdicts

- **Technical acceptance: NO-GO.** F-01 remains open for historical raw provider references in delivery diagnostics and internal delivery-return paths. A disposable-PostgreSQL HTTP probe reproduced the disclosure.
- **Operational readiness: NO-GO / not demonstrated.** The independently run backend and Admin Web suites passed, as did 16 focused PostgreSQL suites, but the complete PostgreSQL suite was not rerun; production monitoring, quarantine reconciliation/redrive, retention, and key-rotation operations were not exercised in production-like infrastructure. No real provider credentials or vendor calls were used.
- **Production authorization: NO-GO.** No provider activation, production migration, financial operation, or deployment is authorized by this review. Keep notification activation dark. Resolve the F-01 blocker and complete operational prerequisites before a separate authorization decision.

The integration document's claimed counts were treated as claims. Independent backend and Admin Web runs matched those counts. The integration document's 124-suite/2,351-test PostgreSQL result was **not** independently repeated; the focused subset below is the only PostgreSQL acceptance evidence in this review.

## Findings

### F-01 — HIGH: historical delivery provider references are returned raw

**Disposition: FAIL; technical blocker.** New provider responses are substantially better protected: Robase, Brevo and Resend 2xx identifiers are converted to opaque `pvr1:<vendor>:<digest>` references; malformed identifiers fail closed; the integration suite also exercises these references through test-send, provider configuration/status, direct delivery materialization, retry writes, PostgreSQL, audit records and captured logs. Historical `notification_provider_configurations.last_test_provider_ref` values and historical notification-test audit values are sanitized at their respective read boundaries / normalization path. Those controls do not cover historical delivery rows.

`src/admin/admin-notification.controller.ts` directly maps `notification_deliveries.provider_ref` to `providerRef` (around line 222 in the reviewed tree). `src/notification/notification-provider-config.service.ts` normalizes historical configuration `last_test_provider_ref` values, not `notification_deliveries`. New writes are sanitized by the adapters and `NotificationDeliveryProcessor`, but that does not change rows already written by older builds or otherwise inserted before the fix. The dispatcher also returns the stored value unchanged on an idempotency-conflict/duplicate path, and `listDeliveriesForEventKey()` uses `SELECT *`; those are additional internal service return paths to cover, although no HTTP caller for the latter was found in this source review.

**Reproduction (disposable embedded PostgreSQL only; no production data):** used the existing `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` test harness, inserted a `SENT` delivery whose historical `provider_ref` was the unique raw sentinel `xkeysib-HISTORICAL_SENTINEL_TX_NGN_750000_ACCT_1234567890`, then called authorized `GET /api/v1/internal/notifications/deliveries?status=SENT` with the harness's `SUPPORT` workforce token. The endpoint returned that exact sentinel in `data[].providerRef`. The one-test probe passed (1 passed, 21 skipped); the temporary test modification was restored immediately and the exact-SHA review worktree returned clean. This proves exposure to an authenticated role permitted to view delivery diagnostics; it does not prove that any deployed historical row contains sensitive data.

**Risk and limits:** a permitted operations/support reader can receive raw provider-controlled historical reference text that may contain credential-like, financial, or other sensitive material. New write paths mitigate future rows, but any legacy production rows remain exposed until their read projection is sanitized or rows are safely normalized. The integration report says providers remained dark outside tests, so the existence of such production rows is not established; the endpoint behavior is nevertheless unsafe if legacy rows exist.

**Owner:** Notification / Admin API owners, with Security review.
**Required acceptance:** sanitize every delivery-reference read projection using a deterministic, scope-aware boundary before HTTP or internal service return; do not expose raw values in duplicate dispatch results or event-key lookup results; retain no raw value in logs/audit. Add regression tests that seed raw historical rows for Robase/Brevo/Resend/unknown provider names and assert the authorized diagnostics response, direct duplicate dispatch result and event-key lookup contain no sentinel. Preserve the exact existing delivery-status/minimal-projection policy. Verify the result after app restart and through the key-rotation policy described below. If a data migration is chosen, prove idempotency, preservation of unrelated evidence and safe rollback/forward recovery; immutable audit rows should remain immutable and be sanitized at read boundaries.

### R-01 — MEDIUM operational limitation: reference derivation changes on key rotation

The provider-reference HMAC key is derived from the canonical **entire** `NOTIFICATION_PROVIDER_ENCRYPTION_KEYRING_JSON` contents when present, otherwise the single encryption key, otherwise the adapter credential when supplied, and finally a process-ephemeral fallback. A controlled synthetic-key experiment using `deriveSafeVendorProviderRef()` showed: identical inputs and unchanged keyring produce the same reference; adding a keyring entry changes the reference for the same vendor ID; changing the API-key fallback also changes the reference. Sorting makes key ordering immaterial, but not key-set/value changes. This is not a plaintext disclosure and does not invalidate already stored opaque tokens. It does mean that recomputing a reference, including when sanitizing a raw historical value on read, is not stable across encryption-keyring or provider-credential rotation. There is no independent reference-HMAC key/version/dual-key policy evidenced in this implementation.

**Owner:** Security / platform secrets operations.
**Required acceptance:** explicitly choose and document whether cross-rotation correlation is required. If required, use a dedicated, versioned HMAC key with an explicit old-key verification/read strategy and rotation tests; do not couple provider-reference stability implicitly to encryption-keyring contents. If unlinkability across rotation is intentional, document that operational consequence and verify that old references do not need to be recomputed for support, audits, or incident correlation. No production key rotation was performed.

### R-02 — LOW / conditional contract: shared-outbox `available_at` is not a notification not-before gate

The notification subscriber query selects the oldest eligible `outbox_events` row without a predicate on `available_at`. The PostgreSQL reliability suite itself seeds a shared event with a future `available_at` and expects the notification subscriber to materialize it immediately. The shared `OutboxService` uses `available_at <= NOW()` for its own worker, so a future value has an established scheduling/retry meaning there. Whether that is a cross-consumer not-before promise is unresolved in the integration record. No current production event schedule was exercised.

**Disposition:** record as a conditional integration contract, not an unconditional defect: if `available_at` is intended to prohibit any consumer from acting before that time, early notifications are possible. Before scheduled events use this field, the outbox owner and notification owner must decide and test whether notification consumption honors it or intentionally has independent timing. Do not silently change the current independent-consumer behavior without resolving that contract.

## Acceptance matrix

| Area | Result | Independent evidence / limitation |
|---|---|---|
| **F-01 — provider data non-disclosure** | **FAIL (historical-delivery surface); PASS for tested new-write and provider-config/audit surfaces** | Provider-config integration suite passed its 2xx sentinel battery for Robase/Brevo/Resend, malformed and overlong/control-character IDs, delivery processor/direct dispatch/retry persistence, captured logs, configuration rows and audit reads. A separate HTTP probe reproduced raw historical `notification_deliveries.provider_ref` disclosure. |
| **F-02 — pinned egress / SSRF / redirects / DNS rebinding** | **PASS in focused fake-transport tests** | Provider-configuration integration suite passed exact-host, deceptive/lookalike host, port/path/IP, redirect, malicious persisted URL, DNS-rebinding and no-credential-forwarding probes. No live provider call or external DNS/provider operation was performed. |
| **F-03 — test-send quota and failure durability** | **PASS in focused PostgreSQL suite** | Provider-configuration integration suite passed concurrent multi-instance quota enforcement and persistence-failure quota retention cases. No real provider call. |
| **F-04 — delivery-only MINIMAL status / role boundary** | **PASS in focused PostgreSQL suite** | Hardening-09 diagnostics suite passed exact restricted projection and role/authorization cases, and delivered only safe diagnostic codes rather than rendered messages/raw errors. F-01 is a separate provider-reference field and remains a failure. |
| **F-05 — strict provider-configuration booleans** | **PASS in focused PostgreSQL suite** | Provider-configuration integration tests rejected omitted/mistyped Brevo SPF/DKIM/DMARC booleans without database/audit mutation, accepted explicit `false`, and left unrelated providers unaffected. |
| Shared-outbox isolation and receipt lifecycle | **PASS in focused reliability tests** | Receipt independence, unchanged shared outbox rows/other-consumer receipts, idempotent replay, rollback/recovery, quarantine and unsupported-schema handling passed. Notification materialization did not call a provider inside the materialization transaction. See conditional `available_at` note. |
| Atomic materialization, idempotency, retry bounds | **PASS in focused reliability tests** | Multi-recipient insert rollback was atomic; receipt retry recovered; concurrent claims yielded one send per delivery; definite rejections bounded to DEAD; ambiguous timeout became UNKNOWN without blind resend. |
| Lease fencing and ambiguous acceptance | **PASS in focused reliability tests** | Expired pre-send claim recovered and stale owner was fenced. A provider-accepted send followed by forced SENT-commit failure became UNKNOWN after lease expiry and was not sent again. |
| Nigerian destination, verified contacts, preferences, privacy | **PASS in focused reliability / provider tests** | Verified contact and preference checks, fail-closed lookup outage, preference recheck immediately before send, C2C unregistered-phone exception boundary, E.164-only Robase transport and safe-message projection passed. C2C registered-but-unverified and opted-out numbers were suppressed. |
| Transfer producer contract and accounting | **PASS in focused PostgreSQL tests** | Real transfer flow tests verified authoritative source/destination identity, success/failure audience, outbox/financial transaction atomicity, no duplicate replay, balanced journal/accounting invariants and exclusion of journal/request/payment prose and sensitive transfer credentials from customer messages. `a5-payment-lifecycle` and `a5-transfer-lifecycle` also passed. |
| Migration 100→101 and clean chain | **PASS in focused PostgreSQL tests** | `notification-migration-upgrade-01` and `migration-chain` passed. Migration 0101 quarantines legacy PENDING/FAILED deliveries as UNKNOWN and prior PUBLISHED outbox events as QUARANTINED rather than blindly replaying them. It does not sanitize historical `notification_deliveries.provider_ref`, which is the F-01 gap. No production migration was run. |
| Admin auth, MFA, maker-checker, quotas and egress governance | **PASS for tested paths** | Provider config tests exercised independent proposer/checker, MFA assurance, self-approval denial, activation gates, audit restrictions and F-02/F-03 cases. The Admin Web build/tests passed; security enforcement is server-side, not inferred from UI-only tests. |
| Reference/keyring stability and key rotation | **CONDITIONAL / operational decision required** | Stable with unchanged key material; changes on keyring or API-key rotation. No production key rotation or live vendor test. |
| D-01 / D-04 | **OPEN; not decided or altered** | See section below. |

## Reliability and product constraints

- The consumer uses an independent receipt table and does not update shared outbox status, attempts, error text, or other consumers' receipts. Materialization and receipt commit are transactional; provider calls occur only after materialization, in the delivery processor.
- Delivery processing uses durable attempt numbers and lease tokens. Expired pre-send claims can retry; expired STARTED attempts become UNKNOWN and are not automatically resent. Confirmed provider rejections retry within configured bounds and eventually become DEAD; ambiguous outcomes do not blindly resend.
- Transfer notifications are separate from financial posting. Transfer producer integration tests verified event creation in the financial transaction and unchanged journal/ledger state after notification processing. Customer messages exclude transfer credentials, journal IDs, request hashes, payment references and rejection prose.
- Configurable SMS/email template governance remains; retry uses the immutable rendered email snapshot. No automatic expired C2C disposition was added or accepted. Manual notification retry remains deferred. No mobile or production activation work was done.
- No claim is made that every product event has a producer/audience contract. Product-owner decisions remain necessary for uncovered event families and any future schedule semantics.

## D-01 and D-04 decisions

Both remain **OPEN** and were intentionally left untouched.

- **D-01 — Product + Security:** approve exact compliance workforce roles/functions and per-subresource read/write entitlements, decide whether a separate read-only capability is needed, and decide whether workforce access requires customer/team/case assignment. Existing category/function checks are not an approved per-worker customer-assignment policy.
- **D-04 — Compliance Product + Security:** ratify the case-category taxonomy and permitted non-fraud mapping. Future categories must remain denied by default; AML/SANCTIONS overlap requires an explicit additional function, not silent broadening of fraud access.

These are not represented as resolved by the notification reliability work and must be carried into the appropriate compliance/product acceptance.

## Test and check record

All tests ran against the clean detached worktree at the exact application SHA, with a disposable embedded PostgreSQL database and test-only credentials. `.env` and test database files were generated locally; no production configuration or data was used. The historical-ref probe's temporary test edit was restored, and the application review worktree was clean at completion.

| Command/check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS (no diagnostics) |
| `npm run build` (backend) | PASS (`nest build`) |
| `./node_modules/.bin/jest --runInBand` (backend unit suite) | **206 suites passed; 2,076 tests passed** |
| `npm run ts:check && npm test -- --runInBand` (`apps/admin-web`) | **27 suites passed; 188 tests passed** |
| `npm run build` (`apps/admin-web`) | PASS; Vite emitted a non-blocking warning that a minified chunk is larger than 500 kB (largest output about 1.24 MB) |
| `PG_TEST_RUN_ID=fd6accept1 ./node_modules/.bin/jest --config jest.integration.config.js --runInBand` followed by the 16 explicit files listed below | **16 suites passed; 278 tests passed** |
| Temporary raw historical-ref HTTP probe using the hardening-09 fixture; run ID `fd6hist1` | **1 passed; 21 skipped**; raw sentinel was returned; fixture restored |
| `ts-node` synthetic-key HMAC experiment | unchanged material stable; adding keyring key changes same-ID reference; API-key fallback rotation changes same-ID reference |
| Full PostgreSQL integration suite (`test:pg`, expected 124 suites / 2,351 tests per integration report) | **NOT RUN in full.** Focused subset only; this is incomplete independent coverage, not a failure count. |
| Live Robase/Brevo/Resend, production key rotation, production migration/deployment, financial operation | **NOT RUN / prohibited by scope** |

The 16 PostgreSQL files were:

`test/v1-notification-provider-configuration-01.integration.spec.ts`, `test/notification-reliability.integration.spec.ts`, `test/transfer-notification-producer-01.integration.spec.ts`, `test/a5-payment-lifecycle.integration.spec.ts`, `test/a5-transfer-lifecycle.integration.spec.ts`, `test/migration-chain.integration.spec.ts`, `test/notification-migration-upgrade-01.integration.spec.ts`, `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts`, `test/customer-compliance-authorization.integration.spec.ts`, `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`, `test/v1-005-notification-delivery.integration.spec.ts`, `test/v1-006-customer-notification-inbox.integration.spec.ts`, `test/v1-email-notification-01.integration.spec.ts`, `test/sms-v1-01.integration.spec.ts`, `test/notification-registry.integration.spec.ts`, and `test/v1-003-admin-operational-writes.integration.spec.ts`.

## Prioritized closure criteria and owners

1. **P1 / Security + Notification + Admin API:** close F-01 by sanitizing historical delivery references on every read/return boundary; add regressions for authorized HTTP diagnostics, idempotent duplicate dispatch, event-key lookup, unknown provider scope, and no raw sentinel in logs/DB/audit projections. Re-run the F-01 suite and independent historical-row probe.
2. **P1 / Platform Security:** document the HMAC-reference key lifecycle and the accepted cross-rotation behavior. If continuity is required, implement a dedicated versioned HMAC key and migration/dual-version plan; test same reference across process restarts and planned rotation without exposing raw IDs.
3. **P1 / SRE + Product + Notification:** publish an operational runbook for UNKNOWN/DEAD/QUARANTINED delivery and receipt reconciliation, alerts, retention/legal holds and authorized redrive (no automatic retry of UNKNOWN). Decide whether `outbox_events.available_at` is a cross-consumer not-before contract before scheduling notifications.
4. **P1 / Release + Platform:** complete the full sequential PostgreSQL run and production-like operational checks; provide evidence for monitoring, DB migration backup/restore and compatibility, dark-launch controls, exact keyring configuration, and incident response. Keep all providers disabled pending independent production authorization.
5. **Product + Security / Compliance Product + Security:** record signed D-01 and D-04 decisions in their owning compliance process; this review does not make those decisions.

## Provenance and change boundary

This report is a fresh review of `fd6a32b5acffd295b62ca4d346c38f128f336043`; it does not carry forward the previous `fe06ea8` verdict as evidence. The application review tree was clean before and after the tests. Only this report is to be committed and pushed to `arena/870f970d-monienaija`; prior reports are preserved. The dirty root checkout and all peer branches/work were left untouched.
