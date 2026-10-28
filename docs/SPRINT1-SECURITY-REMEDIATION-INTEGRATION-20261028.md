# Sprint 1 Security Remediation Integration Record — Arena 2 `7d703a3` merged into the combined application

**Date:** 2026-10-28
**Integrator:** Arena 3 (pinned branch `arena/8e59e188-monienaija`)
**Status:** INTEGRATED — all local gates green. **Arena 4's NO-GO remains in force until Arena 4 completes a fresh independent review of the integrated application SHA.** This record is an integration/verification report, not an acceptance or production-readiness claim.

---

## 1. Provenance and merge topology

| Item | SHA |
|---|---|
| Prior combined application (pre-remediation) | `96cd6e68e61646938cbc3f6e78aa3f00ddc6cb9a` |
| Prior branch docs HEAD (first parent) | `73326c9116d0b001fb9419d229eb7b5fef405354` |
| Arena 4 NO-GO review record | `c3535601eaf36aa883be1d9b0ad488b1e6678309` (`docs/audit/20261028/sprint1-security-acceptance/10-COMBINED-SPRINT1-PROVIDER-INDEPENDENT-REVIEW-20261028.md`) |
| Arena 2 security remediation (second parent) | `7d703a3e830baf3fafd876b663a442b541af8f2a` (parent `fa08e71`) |
| **Integrated application merge commit** | **`fe06ea8f7f6345db1542a17995c1d17b2aa07631`** |

- `git merge-base(73326c9, 7d703a3)` = `fa08e71` — already an ancestor of the combined app via merge `96cd6e6`, so the merge applied exactly Arena 2's remediation delta.
- Merge performed with `--no-ff`; **zero conflicts** (ort strategy auto-merged `NotificationManagementScreen.tsx`, `notification-domain.ts`, `audit.service.ts`). This independently confirms Arena 2's read-only clean-merge simulation.
- Post-merge delta vs `73326c9` = exactly the remediation's 18 files, +2317/−352 — no collateral changes from this side.
- Ancestry verified: `7d703a3` ANCESTOR of HEAD; `96cd6e6` ANCESTOR of HEAD; no rebase, no history rewrite, no force-push. Branch pushed fast-forward `73326c9..fe06ea8`.

### Changed files (18)

New: `src/notification/provider-security.ts` (675 lines — closed vendor error-code allowlists, pinned origins/endpoints, DNS/IP egress guards, pinned HTTPS fetch), `src/notification/resend-email-provider.ts` hardening.

Backend: `robase-notification-provider.ts`, `brevo-email-provider.ts`, `notification-provider-config.controller.ts`, `notification-provider-config.service.ts`, `admin/admin-notification-provider.controller.ts`, `operations/audit.service.ts`, `operations/operations.controller.ts`.

Admin Web: `ProviderConfigurationWorkspace.tsx`, `NotificationManagementScreen.tsx`, `notification-domain.ts`, `notification-management-api.ts`, `provider-configuration.test.tsx`.

Tests: `notification-provider-config.unit.spec.ts` (+274), `robase-notification-provider.unit.spec.ts` (+42), `v1-email-notification-01.integration.spec.ts`, `v1-notification-provider-configuration-01.integration.spec.ts` (+563).

---

## 2. Finding-by-finding verification in the merged tree

Source inspection below was performed by the integrator on the merged tree at `fe06ea8`; each finding is additionally covered by executable tests (section 3) that passed on real PostgreSQL in this integration run.

### F-01 (HIGH) — upstream provider error leakage → CLOSED
- `provider-security.ts` defines **closed** allowlists: `CLOSED_ROBASE_ERROR_TYPES`, `CLOSED_BREVO_ERROR_CODES`, `CLOSED_RESEND_ERROR_CODES`, `CLOSED_TRANSPORT_ERROR_NAMES`; `classify*()` maps anything outside the set to a fixed fallback. `normalizeProviderErrorCode()` re-normalizes at service/controller boundaries with `PROVIDER_FAILURE`/`VERIFY_FAILED` fallbacks.
- All three providers construct error strings only from closed vocabulary: `ROBASE_HTTP_<safeStatus>:<closedType>`, `BREVO_HTTP_<safeStatus>:<closedCode>`, `*_NETWORK:<closedName>`, `*_EGRESS_BLOCKED`, `*_TIMEOUT`. The prior broad-char regex (`ROBASE_HTTP_<status>:<errorType>` with arbitrary `errorType`) that Arena 4 exploited is gone.
- **Persisted diagnostics:** `last_test_error_code` / `last_verification_error` writes pass through `normalizeProviderErrorCode` (service lines ~1679/1715/1744/1828).
- **Audit records:** test-send audit `newValues.errorCode` is normalized before `auditService.record` (admin controller).
- **Logs:** every `logger.warn` in the Brevo/Robase/Resend providers emits only fixed `msg`/`reason` strings, `formatSafeHttpStatus`, and closed classify outputs — no upstream response bodies, messages, or exception text.
- **Delivery diagnostics (P0-02 path):** unchanged — `admin-notification.controller.ts` has zero diff vs `73326c9`; the 13-code `SAFE_DELIVERY_ERROR_CODES` → `UNCLASSIFIED` allowlist is intact.
- Test 9 of the provider-configuration suite strips credential-like and financial sentinels across test-send, verify, provider-status, provider-config APIs, PostgreSQL columns, audit JSON, and logs.

### F-02 (HIGH) — arbitrary HTTPS base URLs → CLOSED
- `PINNED_PROVIDER_ORIGINS`: robase → `https://api.robase.dev`, brevo → `https://api.brevo.com`, resend → `https://api.resend.com`. `validatePinnedProviderBaseUrl()` rejects non-HTTPS, embedded credentials, query/fragment, any port (including explicit `:443`), path suffixes, IP literals, trailing dots, and non-canonical syntax before the allowlist check.
- Enforced at **proposal** (controller parse), **activation / DB load / verification** (`isPinnedProviderBaseUrl(row.provider, row.base_url ?? default)` with `PROVIDER_BASE_URL_UNTRUSTED` recorded on tamper), and **every outbound request** (`isPinnedProviderEndpointUrl` before each send; `createPinnedProviderHttpFetch` re-validates origin).
- `createPinnedProviderHttpFetch`: single DNS lookup, every resolved address screened by `isForbiddenOutboundIp` (private/loopback/link-local/metadata ranges), the resolved IP is pinned into `https.request`'s `lookup` (no TOCTOU re-resolution / DNS-rebinding window), `redirect: 'error'` plus explicit 3xx rejection (redirect bodies never buffered), response size cap.
- All three providers default to the pinned fetch → **worker dispatch is covered** without per-call configuration.
- Admin Web: base-URL inputs are read-only; `validateProviderConfigProposalDraft` enforces the same pinned origins client-side.
- Test 10 rejects unpinned public hosts, lookalikes, custom ports, IP literals, redirects, DNS rebinding, and tampered DB `base_url` values without sending credentials.

### F-03 (MEDIUM) — raceable 5/hr test-send limit → CLOSED
- `POST test-send` now reserves quota **atomically before any provider HTTP I/O**: `pg_advisory_xact_lock(hashtext('notification_test_send_quota_v1'), hashtext(principalId))` serializes per-principal bursts across requests and processes; the rolling-hour count and an immutable `NOTIFICATION_TEST_SEND_QUOTA` audit row commit in one transaction; over-limit requests throw 429 inside the locked transaction.
- Legacy `NOTIFICATION_TEST_SEND` rows without a matching reservation still count (no grandfathering gap).
- Post-send persistence (`recordTestSendOutcome`, final audit) is isolated: failures are caught/logged with SQL-state only and **cannot drop the committed reservation**; failed attempts are never refunded.
- The verify path received the same treatment (`notification_provider_verify_quota_v1` advisory lock + `NOTIFICATION_PROVIDER_VERIFY_RESERVED`).
- Test 11 runs the **exact Arena 4 reproducer**: 2 prior attempts + 8 simultaneous → exactly 3×201 and 5×429, outbound provider calls strictly capped at 5; plus a second principal with upstream 503s and an injected post-send DB trigger failure — quota still holds at 5 and the 11th attempt is 429.

### F-04 (MEDIUM) — MINIMAL status over-exposure → CLOSED
- `GET /internal/notifications/provider-status` for a `notification.view_deliveries`-only principal now returns **only**: `channels`, `projectionScope: 'MINIMAL'`, and per-channel coarse `available` booleans (push always `false`). Provider identity, `enabled`/`configured`/`deliveryTested` gates, lifecycle state, key fingerprints, sender config, lastTest details, base URLs, and worker state are all removed from the projection (both the overview-backed and env-fallback branches). Suite test 6 asserts the strict coarse schema.

### F-05 (LOW) — `Boolean()` coercion in proposals → CLOSED
- `parseProposeBody()` uses strict readers: `readRequiredBoolean`/`readOptionalBoolean` demand `typeof === 'boolean'`; `readOptionalInt`/`readRequiredNonNegativeInt` demand `Number.isInteger`. String `"false"`, numeric booleans, `null`, arrays, objects, and non-integers are rejected 400 **before any state mutation**; unknown fields are rejected against an allowlist. Suite test 12 covers the type matrix.

### Admin Web ninth-tab gating → CLOSED
- `deriveNotificationPermissions().canViewProviderConfig` is now strictly `has('notification.provider.view')` (the `view_deliveries` fallback and role-based maker/checker fallbacks were removed). `NotificationManagementScreen` filters the tab list (`visibleTabs`), redirects an unauthorized `initialTab === 'providerConfig'` to `overview`, and guards panel rendering with the same permission.
- **No grant expansion:** `authorization-catalogue.seed.ts` has zero diff vs `73326c9`. FINANCE_CONTROLLER retains `notification.provider.view` + `notification.provider.configure`(APPROVE), so the tightened derive flags still authorize the designated approver role — verified by the admin-web suite (27/27 · 187) and the provider-configuration role matrix (suite test 6/7).

### Provider audit-read auditability → CLOSED
- `OperationsController` audit listing now routes **every** read that is allowed (or targets provider audit entity types) through `AuthorizationService.authorize()`, which records an `AUTHORIZATION_DECISION` audit event — closing the gap where provider audit-read authorization decisions were not auditable.
- `audit.service.ts` composes three restriction layers in one query: (1) the Sprint 1 compliance-case filters (entity types + `COMPLIANCE_` reason-prefix hiding) — intact and passing; (2) the provider-audit hiding (`NOTIFICATION_PROVIDER_CONFIG`, `NOTIFICATION_TEST_SEND`, **plus the new `NOTIFICATION_TEST_SEND_QUOTA`**) unless the caller holds `notification.provider.view`; (3) records remain in `audit_events` for authorized oversight (suite test 7 re-proves DB preservation + oversight delegation).

---

## 3. Sprint 1 P0 invariants and preserved controls (instructions 10–11)

| Control | Status at `fe06ea8` |
|---|---|
| P0-01 (notification delivery authorization composition) | `admin-notification.controller.ts` zero diff; delivery-auth suite PASS |
| P0-02 (deliveries projection allowlist, no rendered messages / raw provider errors) | Zero diff on the deliveries surface; `SAFE_DELIVERY_ERROR_CODES` → `UNCLASSIFIED` intact; hardening-09 diagnostics suite PASS |
| P0-03 | Covered by the passing Sprint 1 delivery/diagnostics suites |
| Migration 100 + chain 098→099→100 | `src/migrations/` zero diff; migration-chain suite PASS |
| AES-256-GCM secrets, versioned keyring, rotation, AAD binding | Untouched; lifecycle suite test 4 (rotation reset, fail-closed missing key) PASS |
| Maker-checker, MFA assurance, self-approval prohibition | Untouched; suite tests 2–4 PASS |
| Financial controls / Ordinary Agent V1 contracts | No files in scope; full unit suite green |
| Authorization grants | No new grants; catalogue seed zero diff |
| New migrations introduced by remediation | None |

---

## 4. Regression evidence (all executed by the integrator on the merged tree, sandbox, real embedded PostgreSQL 18.4)

| Gate | Command / scope | Result |
|---|---|---|
| Backend build | `npm run build` (nest build) | PASS, no errors |
| Backend typecheck | `npx tsc --noEmit -p tsconfig.json` | PASS, no errors |
| Complete unit suite | `npm run test` | **204/204 suites · 2060/2060 tests PASS** (+3 vs pre-remediation 2057) |
| Admin Web typecheck | `npm run ts:check` | PASS |
| Admin Web tests | `npm test` | **27/27 suites · 187/187 tests PASS** (+1 vs 186; includes tab-gating tests) |
| Admin Web build | `npm run build` (vite) | PASS |
| Focused PG batch A (run id `remfoc1`) | provider-configuration-01 (+563 lines: F-01 sentinels, F-02 egress, F-03 concurrency, F-04 schema, F-05 types, role matrix, audit isolation), email-notification-01, sprint1-delivery-authorization, customer-compliance-authorization, migration-chain — `--runInBand`, real PG + real HTTP boundary | **5/5 suites · 92/92 tests PASS** |
| Focused PG batch B (run id `remfoc2`) | hardening-09 delivery diagnostics, v1-005 notification delivery, notification-migration-upgrade-01, v1-customer-08-limits-view, v1-limit-03-limit-usage | **5/5 suites · 78/78 tests PASS** |
| **Complete sequential PG suite** (run id `remfull`) | `PG_TEST_CONCURRENCY=1 node scripts/run-pg-integration-tests.js`, all 9 batches, log `full-pg-security-remediation.log` | **122/122 files · 2331/2331 tests PASS · 0 failures** ("all passed"; every batch exit 0) |

No real Robase/Brevo/Resend API keys were used; no live provider requests were made (tests inject transport overrides / sentinel keys); no provider was activated outside the test database; no production migration or deployment occurred.

Per-batch results (complete run `remfull`, all exit 0):

| Batch | Files | Tests |
|---|---|---|
| 1/9 | 15 passed | 652 passed |
| 2/9 | 15 passed | 298 passed |
| 3/9 | 15 passed | 345 passed |
| 4/9 | 15 passed | 235 passed |
| 5/9 | 15 passed | 216 passed |
| 6/9 | 15 passed | 233 passed |
| 7/9 | 15 passed | 156 passed |
| 8/9 | 15 passed | 177 passed |
| 9/9 | 2 passed | 19 passed |
| **Total** | **122 passed** | **2331 passed** |

(+4 tests vs the 2327 of the pre-remediation full run on `96cd6e6` — the new Arena 2 integration assertions.)

---

## 5. Unresolved items and limitations (carried forward — NOT resolved by this integration)

- **Arena 4 NO-GO is still in force.** Acceptance requires a fresh Arena 4 independent review of `fe06ea8`.
- Carried-forward open decisions from prior reviews remain open and are explicitly not claimed resolved: D-01, D-04, per-worker customer assignments, global case-number collision (409 oracle), notification dark-launch limits, scoped-audit surface design, provider-activation prerequisites.
- Arena 4's own environment previously timed out on complete sequential PG runs (1800 s cap); the complete-run evidence above is from the integrator's environment only. Arena 4 should re-verify per its own methodology.
- Browser UAT was not performed; Admin Web verification is via automated tests and typecheck only.
- Lint gate remains failing at repository baseline (pre-existing); per-file parity was not worsened (no lint regressions introduced by the merge were observed in touched files' compile/test behavior).
- Test counts reported here come exclusively from the integrator's own execution on the merged tree.

---

## 6. Arena 4 handoff

- **Review target:** `fe06ea8f7f6345db1542a17995c1d17b2aa07631` (branch `arena/8e59e188-monienaija`, pushed).
- Parents: `73326c9` (prior docs HEAD over combined app `96cd6e6`) × `7d703a3` (Arena 2 remediation of the F-01..F-05 NO-GO).
- Remediation-specific test entry points: `test/v1-notification-provider-configuration-01.integration.spec.ts` tests 6, 7, 9, 10, 11, 12; `apps/admin-web/src/features/notifications/__tests__/provider-configuration.test.tsx`; `test/notification-provider-config.unit.spec.ts`; `test/robase-notification-provider.unit.spec.ts`.
- Suggested focus: F-01 sentinel sweeps across all eight leak surfaces, F-02 egress/rebinding probes, F-03 exact 2-prior + 8-concurrent reproducer, F-04 strict MINIMAL schema assertion, F-05 JSON type matrix, ninth-tab gating for a `view_deliveries`-only principal, and `AUTHORIZATION_DECISION` recording on provider audit reads.
