# Final independent F-01 remediation acceptance — `30c3445`

**Review date:** 2026-10-29 (Africa/Lagos)
**Repository:** `shyne240/monienaija`
**Exact application SHA reviewed:** `30c34453988ec2779905134adee27aa51cf4f400`
**Arena 2 remediation:** `789b6073ec3e8708c2e6966d2208c560694d543d`
**Integration report:** `549f6d6b7b2d8abe01a91f6981ebb5e64bd8f319:docs/SPRINT1-F01-HISTORICAL-PROVIDER-REF-INTEGRATION-20261029.md`
**Prior Arena 4 report:** `docs/audit/20261028/sprint1-security-acceptance/12-FRESH-INDEPENDENT-ACCEPTANCE-fd6a32b5-20261029.md`
**Scope:** independent, documentation-only acceptance. No application, test, migration, production configuration, infrastructure, mobile, or deployment changes were retained.

## Final verdicts

1. **Technical security acceptance: NO-GO.** The original HIGH historical-delivery-reference disclosure is closed on the tested HTTP diagnostics, dispatcher duplicate/lookup, TypeORM entity, audit, and provider-reference persistence/read paths. However, an additional F-01 error-text/log projection bypass remains in `redactSensitiveText()`: a malformed value beginning with a syntactically valid `pvr1:` token plus a sensitive suffix is treated as safe in full. A disposable, temporary test reproduced the sentinel in a client error body and a 500 error log. This violates the requested zero-sentinel condition for error/log projections.
2. **Operational readiness: NO-GO.** R-01 (cross-key-rotation reference semantics), R-02 (`available_at` scheduling semantics), monitoring/alerting, quarantine reconciliation/redrive, retention/legal hold, and dark-launch procedures remain unresolved or unverified. The complete PostgreSQL suite did not complete in this sandbox; the focused PostgreSQL acceptance battery did pass.
3. **Production authorization: NO-GO.** Keep providers disabled. This review did not use live Robase/Brevo/Resend credentials or calls, run production migrations, execute financial operations, or deploy. Do not infer production approval from the F-01 remediation or developer-reported suite totals.

The integration report's reported 2,082 backend unit tests and 188 Admin Web tests were independently rerun and matched. Its reported 2,355 PostgreSQL tests were **not** independently confirmed as a complete run; see the exact partial-run record below.

## Findings and dispositions

### F-01 — Original HIGH historical delivery-reference disclosure: REMEDIATED on tested database/read boundaries

**Disposition: PASS for the original raw historical `notification_deliveries.provider_ref` vulnerability.** I independently inspected the merged implementation and ran the new disclosure suite against disposable PostgreSQL with synthetic, sentinel-bearing rows for Robase, Brevo, Resend, an unknown gateway, and a harness-lookalike unknown provider.

The following boundaries now sanitize historical raw delivery references before return:

- `src/admin/admin-notification.controller.ts:125-155` — delivery diagnostics HTTP projection.
- `src/notification/notification-dispatcher.service.ts:116-122, 208-217` — direct-send read-back and duplicate/idempotency-conflict result.
- `src/notification/notification-dispatcher.service.ts:297-331` — explicit-column event-key lookup; provider references and error codes sanitized, recipient IDs redacted, rendered message/payload/destination/lease values excluded.
- `src/notification/notification-delivery.entity.ts:95-109` — TypeORM `provider_ref` transformer sanitizes both `from` (entity load) and `to` (entity persistence).
- `src/operations/audit.service.ts:25-42, 172-285` — provider-reference keys recursively sanitized on all audit writes and audit read projections, including nested payloads and nonstandard notification entity types.
- `src/common/sensitive-data-redaction.ts:53-59` — raw provider-reference text redaction was added for exception/error text.

The change is non-destructive: no migration rewrites historical evidence. Already-safe opaque `pvr1:` values are preserved. Unknown provider labels receive an `external` token scope with provider-specific domain separation. In production, raw-reference hashing fails closed if no durable key material is available rather than falling back to a process-ephemeral key.

**Independent reproduction coverage:** the new `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts` was run against a disposable PostgreSQL database. It seeds unique credential/financial sentinels and checks authorized diagnostics, unauthorized access, duplicate dispatch/idempotency, event-key lookup, entity reads, audit write/read projections, stdout/stderr and processor logs, safe-error projections, restart determinism, rotation behavior, and production secret failure. All four tests in that suite passed as part of the 17-suite PostgreSQL run. The existing hardening-09 diagnostics suite also passed with strengthened F-01 assertions while retaining its P0-02 checks.

#### F-01 residual R-03 — MEDIUM: malformed `pvr1`-prefixed error text bypasses the text redactor

**Status: FAIL for the complete F-01 error-text/log projection criterion.** `src/common/sensitive-data-redaction.ts:57` uses a negative lookahead that exempts a value once it *starts with* `pvr1:<scope>:<32 hex>` and reaches a word boundary. It does not require the whole provider-reference value to be a valid token. Therefore a value such as:

`providerRef=pvr1:brevo:0123456789abcdef0123456789abcdef:F01_SUFFIX_SENTINEL_TX_NGN_999000`

is returned unchanged by `redactSensitiveText()`.

**Reproduction:** a temporary, uncommitted Jest probe passed a `BadRequestException` containing that string to `GlobalExceptionFilter`. The HTTP 400 `message` retained the full suffix sentinel. The same probe passed an `Error` containing it through the 500 path; `logger.error` received the full suffix sentinel in `errorMessage`. Result: 1 test passed because it asserted the reproduced leaks. The temporary probe was removed immediately; no test or application modification remains in the review worktree.

**Exploitability qualification:** I did not find a current notification endpoint that accepts a raw provider reference and directly interpolates it into an exception. The tested database/entity/dispatcher/audit paths sanitize the reference before return, so this probe does not show that a historical delivery row currently reaches the exception filter. It does show that the generic error/log boundary fails open for the specified string shape. Since the acceptance request explicitly includes log/error-text projections and zero raw sentinel exposure, I am not waiving it.

**Severity:** Medium / P2, conditional projection bypass; it could disclose sensitive suffix content if a malformed or attacker-controlled provider reference is placed in an exception message.
**Owner:** Notification Security / Platform HTTP error-handling owner.
**Acceptance criteria:** validate the entire captured value as a canonical token before exempting it; redact the complete value otherwise. Add regression cases for valid token plus colon suffix, appended credential/financial sentinel, JSON-quoted forms, whitespace, and ordinary exact canonical tokens. Re-run the temporary GlobalExceptionFilter scenario for both 4xx body and 5xx structured log. No application fix was made in this review.

### R-01 — Provider-reference HMAC rotation semantics: POLICY OPEN

Independent code/test review confirms:

- With identical durable keyring material, historical raw references produce deterministic digests across application restarts.
- Already-persisted valid `pvr1:` tokens are passed through unchanged when the synthetic encryption keyring rotates.
- A raw, not-yet-normalized historical reference is re-derived from the active keyring and therefore changes digest across rotation. The new integration test explicitly asserts this behavior.
- Missing durable secret material in `NODE_ENV=production` fails closed for raw references; the exercised endpoint returns a safe 500 instead of exposing the raw value. Production provider environment secrets are also supported as durable fallback material where configured.

**Disposition:** no raw-reference disclosure observed; stability for stored opaque tokens is verified. Cross-rotation correlation for raw historical rows remains intentionally unstable and is an open Security/platform-secrets policy decision. Do not describe the key-rotation policy as fully resolved. Operations must decide whether unlinkability is acceptable or whether a dedicated, versioned HMAC key with an explicit old-key read strategy is required. No production rotation was performed.

### R-02 — Shared-outbox `available_at` scheduling contract: OPEN

`NotificationDispatcherService.processPendingOutboxEvents()` still does not filter shared `outbox_events` on `available_at`. The independently passing reliability suite intentionally demonstrates that a future-available event can be materialized immediately by the notification subscriber. The independent consumer does not alter shared outbox status or retry state, which is good isolation, but the cross-consumer not-before meaning remains unresolved.

**Disposition:** conditional integration risk, not an unconditional code failure. Before scheduling notification events with `available_at`, the shared-outbox owner and notification owner must specify whether the timestamp is a global not-before gate or only a retry schedule for the existing outbox consumer. Test the chosen contract. No contract decision was made here.

### D-01 / D-04 — Compliance governance decisions: OPEN

Neither decision is resolved by this notification remediation and neither was changed in this review.

- **D-01 — Product + Security:** confirm compliance workforce roles/functions and per-subresource read/write entitlements, whether an independent read-only function is needed, and whether access must be customer/team/case-assignment scoped. Do not characterize existing category/function checks as an approved per-worker subject-assignment policy.
- **D-04 — Compliance Product + Security:** ratify the category taxonomy and permitted non-fraud mapping. Future categories remain denied by default; AML/SANCTIONS overlap requires an explicit additional function.

### Operational prerequisites: OPEN / not demonstrated

Monitoring and alert thresholds for FAILED/UNKNOWN/DEAD/QUARANTINED records; human reconciliation and authorized redrive procedures; receipt/delivery retention and legal holds; keyring and HMAC-reference rotation runbooks; provider-dark-launch controls; staged smoke testing; and incident ownership remain separate operational gates. UNKNOWN sends must not be blindly retried. No operational or governance prerequisite is considered closed by the F-01 code change.

## F-01 through F-05 and regression matrix

| Area | Verdict | Independent evidence and limits |
|---|---|---|
| **F-01 historical reference reads** | **PASS** for diagnostics, duplicate dispatch, event-key lookup, TypeORM loads and audit boundaries; **FAIL** for malformed canonical-token-prefix error text (`R-03`) | Historical sentinels across Robase/Brevo/Resend/unknown scopes absent in those tested surfaces; entity, direct dispatcher and event-key helper outputs were safe. Temporary global error-filter probe reproduced suffix leakage in a 4xx body and 5xx log. |
| **F-02 pinned egress / SSRF / DNS / redirects** | **PASS** | Independently executed provider-configuration integration suite's fake-transport checks for exact hosts, lookalikes, ports, IP literals, redirects, DNS rebinding and malicious persisted URLs. No live external provider call. |
| **F-03 concurrent quota and failure durability** | **PASS** | Provider-configuration PostgreSQL suite passed concurrent quota and persistence-failure retention cases. No provider credentials or live sends. |
| **F-04 restricted P0-02 diagnostics projection** | **PASS** | Hardening-09 suite passed authorized-role and denied-role cases, safe error-code-only fields, omitted message/raw last_error and restricted response projection after remediation. |
| **F-05 strict Brevo SPF/DKIM/DMARC booleans** | **PASS** | Provider-configuration suite passed omitted/mistyped-value rejection with no mutation and explicit `false` behavior. |
| Receipts, atomic materialization, retries, fencing | **PASS in focused suite** | Receipt independence, idempotent replay, transactional rollback/recovery, concurrent claims, lease fencing, and stale-owner behavior passed. |
| UNKNOWN/DEAD and ambiguous acceptance | **PASS in focused suite** | Ambiguous timeout / accepted-then-status-write-failure became UNKNOWN and was not blindly resent; definite failures were bounded and became DEAD. |
| Verified contacts, preferences, E.164 and privacy | **PASS in focused suites** | Preference and verified-contact rechecks, fail-closed lookup outage, C2C registered-number safeguards, Nigerian phone normalization, fake Robase E.164 transport and safe-content assertions passed. |
| Transfer producer and accounting | **PASS in focused suites** | Authoritative recipient contract, replay idempotency, atomic event/financial transaction, balanced journal/accounting invariants and sensitive-field exclusion passed. |
| Migration 100→101 / clean chain | **PASS in focused suites** | Upgrade and migration-chain suites passed. Migration 0101's legacy PENDING/FAILED UNKNOWN and old PUBLISHED quarantine behavior remained intact; no production migration run. |
| Authorization / MFA / maker-checker / Admin Web | **PASS for tested paths** | Provider configuration and notification authorization suites passed; backend enforces independent approval/MFA. Full Admin Web typecheck/test/build passed. No browser UAT or production operator test. |

## Independent test/check record

All execution used a clean detached worktree at the exact SHA and disposable embedded PostgreSQL with test-only configuration. Synthetic credentials and fake/local transports only. The dirty root checkout was not used or modified.

| Command/check | Independent result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | PASS |
| `npm run build` (backend) | PASS |
| `./node_modules/.bin/jest --runInBand` (backend unit suite) | **207 suites / 2,082 tests passed** |
| In `apps/admin-web`: `npm run ts:check && npm test -- --runInBand && npm run build` | **27 suites / 188 tests passed; build passed.** Vite emitted its existing >500 kB chunk warning (largest output about 1.24 MB). |
| `PG_TEST_RUN_ID=f01probe30c ./node_modules/.bin/jest --config jest.integration.config.js --runInBand` plus the explicit 18 paths listed below | **17 suites / 282 tests passed**. The unit-only `test/f01-historical-provider-ref-security.unit.spec.ts` was excluded by the integration Jest config; it was included in the 2,082-test backend unit run. |
| Temporary `test/f01-error-text-probe.tmp.spec.ts`, `./node_modules/.bin/jest --runInBand test/f01-error-text-probe.tmp.spec.ts` | **1 test passed**; the test asserted and reproduced both 4xx response-body and 5xx log leakage. File removed immediately; not retained. |
| Full `PG_TEST_RUN_ID=f01ind30c PG_TEST_CONCURRENCY=2 npm run test:pg` | **INCOMPLETE.** Attempted for the sandbox's 30-minute command limit, then stopped. Complete batches 1 and 3 reported 15 suites / 635 tests and 15 suites / 324 tests passed (959 tests total). Other active batches exited by signal or were stopped; no aggregate pass/fail result. This does not independently verify 125/2,355. |
| Real Robase/Brevo/Resend calls, production credentials, production key rotation, production migration, deploy, financial operations | **NOT RUN / prohibited by scope** |

The focused PostgreSQL integration paths were:

`test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts`, `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts`, `test/v1-notification-provider-configuration-01.integration.spec.ts`, `test/notification-reliability.integration.spec.ts`, `test/transfer-notification-producer-01.integration.spec.ts`, `test/a5-payment-lifecycle.integration.spec.ts`, `test/a5-transfer-lifecycle.integration.spec.ts`, `test/migration-chain.integration.spec.ts`, `test/notification-migration-upgrade-01.integration.spec.ts`, `test/customer-compliance-authorization.integration.spec.ts`, `test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`, `test/v1-005-notification-delivery.integration.spec.ts`, `test/v1-006-customer-notification-inbox.integration.spec.ts`, `test/v1-email-notification-01.integration.spec.ts`, `test/sms-v1-01.integration.spec.ts`, `test/notification-registry.integration.spec.ts`, and `test/v1-003-admin-operational-writes.integration.spec.ts` (17 files collected; the passed unit-only spec path supplied in the command was not selected by the integration config).

## Required closure and owners

1. **P2 / Notification Security + HTTP error handling:** fix the `pvr1` prefix exemption in `redactSensitiveText`; only a complete canonical token may bypass redaction. Add the 4xx-body and 5xx-log regressions described under R-03. This is the remaining technical NO-GO criterion.
2. **Security + platform secrets:** record the R-01 policy for cross-rotation correlation; preserve the documented behavior that existing opaque tokens stay unchanged and raw legacy rows re-hash under the active key.
3. **Outbox + notification owners / Product:** decide and test R-02 before any scheduled-event producer relies on `available_at` as a not-before contract.
4. **SRE + Release:** complete full PostgreSQL suite to completion and provide monitoring, quarantine reconciliation/redrive, retention/legal-hold, backup/restore, key-rotation, staged smoke and dark-launch evidence before production readiness review.
5. **Compliance Product + Security:** resolve D-01 and D-04 through their owning governance process. This report does not authorize changes to compliance access.

## Provenance and change boundary

This is a fresh review of application SHA `30c34453988ec2779905134adee27aa51cf4f400`, not an acceptance of Arena 3's report. The prior report and all earlier audit documents are preserved. Only this new report is to be committed and pushed to the pinned `arena/870f970d-monienaija` branch. The source-review worktree returned clean after all test probes; the temporary test file was removed. No application or test changes are included in the deliverable.
