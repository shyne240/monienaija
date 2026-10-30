# Sprint 1 — P0-02 Notification Delivery Diagnostics: Remediation Record & Arena 4 Re-review Handoff

**Date:** 2026-10-28
**Arena:** 3 (pinned branch `arena/8e59e188-monienaija`)
**Remediation application SHA:** ``56ee049ca4c04c0914e29508f5dd36c120603f0d``
**Prior integrated application SHA (Arena 4 NO-GO target):** `5a5ad8a5e130da1dc598508914a0a14e48c8735f`
**Arena 4 acceptance report:** `docs/audit/20261028/sprint1-security-acceptance/08-FINAL-INDEPENDENT-ACCEPTANCE-20261028.md` (Arena 4 docs commit `773c028620c5df693204d8cd53880f19300ad028`, branch `arena/870f970d-monienaija` — fetched and inspected; **not merged**, docs-only, and Arena 2's newer provider-configuration work `1f6decd` was deliberately NOT integrated)
**Status:** remediated and regression-verified. **Sprint 1 is NOT accepted** — Arena 4 must independently retest (§7).

---

## 1. Defect (as independently found by Arena 4)

P0-02 authorization was correct (`notification.view_deliveries` audited function gate, role/type denials, PHONE masking), but the `GET /api/v1/internal/notifications/deliveries` projection still returned:

1. the stored **rendered `message`** — Arena 4 reproduced `Your funding of NGN 5,000.00 has been approved.` in a real-HTTP+PG response (financial amounts / recipient-specific content disclosed to any authorized global reader);
2. the **raw `last_error`** string — an unverified disclosure surface for provider error prose.

## 2. Remediation (smallest safe patch — one backend controller + its contract consumers)

### 2.1 Backend — `src/admin/admin-notification.controller.ts` (only file with logic changes)

- The `message` column is **no longer selected** from `notification_deliveries` and never appears in the response.
- `last_error` is read **solely** to derive a sanitized **`errorCode`**:
  - **Closed allowlist** of fixed first-party operational codes (the complete set written by `NotificationDispatcherService`, `NotificationChannelResolverService`, and `NotificationWorkerService`): `SKIPPED`, `EVENT_DISABLED`, `UNSAFE_MESSAGE`, `SMS_OPT_OUT`, `EMAIL_OPT_OUT`, `PUSH_OPT_OUT`, `PUSH_TOKEN_DEPENDENCY_MISSING`, `CUSTOMER_PHONE_MISSING`, `CUSTOMER_EMAIL_MISSING`, `AGENT_PHONE_DEPENDENCY_MISSING`, `AGENT_EMAIL_DEPENDENCY_MISSING`, `INVALID_PHONE_RECIPIENT`, `UNSUPPORTED_RECIPIENT`.
  - Any other non-null value (arbitrary/provider prose) collapses to the fixed sentinel **`UNCLASSIFIED`**; null stays null.
  - Raw values remain stored in the database for authorized server-side investigation. **No message "preview"** is exposed (deferred pending data-owner schema approval, per Arena 4's remediation note).
- **Preserved unchanged:** audited `requireFunction('notification.view_deliveries')` authorization (checked before query validation), 401/403 semantics, pagination (1..100, deterministic `created_at DESC, id DESC`), all filters, PHONE/email recipient masking (`redactRecipientId`), `destination`/`payload` exclusion, and every operational metadata field (id, eventType, eventKey, aggregate, recipientType, masked recipientId, channel, status, attempts, providerRef, correlationId, causationId, createdAt/updatedAt/sentAt/failedAt).
- **Not touched:** SMS/email dispatch, delivery history writes, retry/worker behaviour, limit or compliance logic, authorization grants/catalogue, provider configuration, secrets, migrations, financial operations.

### 2.2 Admin Web (mirrors the narrowed API contract — not a frontend-only hide)

- `notification-domain.ts`: `NotificationDeliveryRecord` drops `message`/`lastError`, adds `errorCode: string | null` (documented).
- `SystemHealthScreen.tsx`: deliveries table column `lastError → errorCode` ("Error code"). The **outbox** table keeps its `lastError` column (separate `outbox.view` surface, unchanged — see §3).
- `NotificationManagementScreen.tsx`: inspector "Last Error / Skip Reason" → "Error / Skip Code" (`errorCode`); deliveries table column likewise; the inspector's "Rendered Safe Message" block is **removed** (its data source no longer exists).
- Tests updated to the new contract (`notification-management.test.tsx` mocks + inspector assertion now use `errorCode: 'UNCLASSIFIED'`; `admin-shared-panels.test.tsx` mock likewise).

## 3. Requirement-6 verification — other notification/diagnostics surfaces checked for the same leak

| Surface | Finding | Action |
|---|---|---|
| `GET /internal/notifications/provider-status` | Masked fingerprints only (no destinations, no credentials) — unchanged | none needed |
| `POST /internal/notifications/test-send` | Response returns masked destination + bounded `errorCode` (`String(result.error).slice(0,160)`, adapters return stable codes, never prose/bodies/credentials); sent content is FIXED safe test text, never template-driven; audit row stores masked destination + errorCode | none needed |
| Notification registry APIs (events/templates/changes) | Separate maker-checker governance contract; template bodies are configuration data shown to their governed editors, not delivery diagnostics; `preview` uses fixed server samples | none needed (untouched) |
| `GET /internal/outbox` (`outbox.view`) | Adjacent generic surface. **Verified:** notification outbox `last_error` is only ever written as the fixed code `NOTIFICATION_DISPATCH_FAILED` (dispatcher raw SQL); `OutboxService.markFailed` (arbitrary string, 255 cap) has **no production caller**; outbox payloads are redacted at enqueue (C2C `redactPayload` allowlist); rendered messages never enter outbox payload (rendering happens at dispatch, stored only in `notification_deliveries.message` — now unprojected). Arena 4 explicitly classified this route as "not the same route or entitlement" and warned against accidentally changing it | unchanged, documented |
| Generic audit (`GET /internal/audit`, dashboard audit-trail) | A1 filtering of restricted case records + `COMPLIANCE_*` facts intact; delivery authorization audit rows contain principal/function/resource only (D1 test asserts no destination/secrets in audit `new_values`) | none needed |
| Rendered message storage | `notification_deliveries.message` remains stored (worker retry re-render safety path, `assertSafe` checks) — only its HTTP projection was removed | by design |

## 4. Security regression tests added (real HTTP + PostgreSQL)

- **`test/v1-sprint1-notification-delivery-authorization.integration.spec.ts`**
  - **D1 extended:** rendered-message sentinel absence — including the exact Arena 4 reproduction string — plus `message`/`lastError` property removal on every row.
  - **New D2:** distinctive sentinels seeded into rendered `message` (SMS financial + EMAIL OTP-style + C2C), `payload` (secret token), `destination` (email + raw phone), `last_error` (provider-secret-like `sk_live_...` prose and an unknown internal reason), across **SMS + EMAIL channels, SENT/FAILED/SKIPPED statuses, and a PHONE recipient**; asserts **no sentinel appears anywhere in `JSON.stringify(response.body)`** (nested objects included), raw fragments (`sk_live`, amount, OTP) absent, `message`/`lastError`/`destination`/`payload` properties gone from every row, `errorCode` classification exact (`UNCLASSIFIED` for prose, allowlisted `SMS_OPT_OUT` passthrough, null for SENT), PHONE masking preserved (`*******777`), CUSTOMER UUID preserved, and all operational metadata + pagination intact.
- **`test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts`:** FAILED row asserts `errorCode: 'UNCLASSIFIED'` + raw `Simulated...` string absent from the whole body; SKIPPED row asserts allowlisted `PUSH_TOKEN_DEPENDENCY_MISSING`; safe-projection test asserts `message`/`lastError` properties removed and financial message content (`NGN 100.00 approved`, `REF-123`) absent from the serialized body.
- **`src/admin/admin-notification.controller.spec.ts` (+2 unit tests, 18/18):** allowlist passthrough / `UNCLASSIFIED` collapse with provider-key sentinel absence / null handling; and a projection-SQL test asserting the data query never selects `message` while still reading `last_error` for classification only.
- **Authorization behavior (requirement 10)** is covered by the unchanged, still-green A/B/C sections of the sprint1 spec: seeded-catalogue exclusivity (SUPER_ADMIN/FINANCE_AUDITOR/OPERATIONS only), real-session 200s for authorized roles, 403 FUNCTION_MISSING for genuine SUPPORT/disabled-role sessions, 401 for missing/malformed tokens, CUSTOMER/AGENT/AGGREGATOR rejection, query-parameter bypass attempts, and FILTER behavior for authorized roles.

## 5. Test matrix — executed on the remediation SHA (integrator's own execution)

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Backend production build | `npm run build` | ✅ clean |
| 2 | Backend TypeScript check | `npx tsc --noEmit -p tsconfig.json` | ✅ clean |
| 3 | Complete backend unit suite | `npm run test` | ✅ **203/203 suites · 2044/2044 tests · 0 failures** (+2 new P0-02 unit tests vs the 2042 pre-remediation count) |
| 4 | Admin Web typecheck | `cd apps/admin-web && npm run ts:check` | ✅ clean |
| 5 | Complete Admin Web suite | `cd apps/admin-web && npm test` | ✅ **26/26 suites · 181/181 tests · 0 failures** |
| 6 | Admin Web production build | `cd apps/admin-web && npm run build` | ✅ built |
| 7 | Targeted real-PG notification battery | `NODE_ENV=test PG_TEST_RUN_ID=p002fix1 npx jest --config jest.integration.config.js --runInBand` on sprint1-authorization, hardening-09, v1-005, notification-registry, v1-email-notification-01 | ✅ **5/5 suites · 96/96 tests** |
| 8 | **Complete sequential PostgreSQL integration suite** | `PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=p002full node scripts/run-pg-integration-tests.js` | ✅ **121/121 files · 2319/2319 tests · 0 failures** — runner verdict: `=== PG integration suite: 9 batch(es), 121 files, concurrency=1 — all passed ===` (run id `p002full`, log `full-pg-p002-remediation.log`, gitignored). +1 test vs the pre-remediation full run (2318) = the new D2 sentinel regression.

| Batch | Files | Tests | Failures |
|---|---|---|---|
| 1/9 | 15 | 652/652 | 0 |
| 2/9 | 15 | 298/298 | 0 |
| 3/9 | 15 | 366/366 | 0 |
| 4/9 | 15 | 229/229 | 0 |
| 5/9 | 15 | 219/219 | 0 |
| 6/9 | 15 | 223/223 | 0 |
| 7/9 | 15 | 179/179 | 0 |
| 8/9 | 15 | 144/144 | 0 |
| 9/9 | 1 | 9/9 | 0 |
| **Total** | **121** | **2319/2319** | **0** | |

No gate was skipped for time; no browser UAT, live provider delivery, production migration, or deployment was performed or is claimed (unchanged posture).

## 6. Remaining risks / explicitly NOT resolved by this remediation

1. **D-01 and D-04 remain OPEN product/security decisions** (compliance role/entitlement scope incl. per-worker customer assignment; fraud/category taxonomy ratification). This remediation does not touch them and does not claim their resolution; P0-01 remains CONDITIONAL PASS pending those decisions.
2. **Global case-number collision (409 existence oracle)** — unchanged, awaiting an identifier/API policy decision.
3. `UNCLASSIFIED` trades raw-error triage detail for safety; operators needing the raw string must query the database directly under existing access controls. If richer triage is needed, a **provider-error classification taxonomy** should be approved and implemented at the writer side (dispatcher/worker), not by re-exposing raw strings.
4. `GET /internal/outbox` still projects outbox `payload` and (fixed-code) `lastError` to `outbox.view` holders — a pre-existing generic operational surface outside P0-02 scope (Arena 4: "not the same route or entitlement"); flagged here for visibility, unchanged by design.
5. Rendered messages remain stored in `notification_deliveries.message` (required for retry re-render safety checks); retention/redaction policy for stored content is a separate data-governance decision.
6. Notification dark-launch constraints unchanged (no live provider evidence, workers not activated, EMAIL registry-disabled).

## 7. Arena 4 re-review handoff

**Target for re-review:** application SHA ``56ee049ca4c04c0914e29508f5dd36c120603f0d`` on `arena/8e59e188-monienaija` (parent chain: ``56ee049ca4c04c0914e29508f5dd36c120603f0d`` → `ef596ee` (docs) → `5a5ad8a` (prior NO-GO application SHA) — the only application delta from the reviewed tree is this remediation; diff it directly: `git diff 5a5ad8a..`56ee049ca4c04c0914e29508f5dd36c120603f0d``).

Suggested independent procedure:

1. Fetch `arena/8e59e188-monienaija`; verify tip/ancestry (`5a5ad8a`, `22d3ec8`, `cdf5203`, `a7898e2`, `2fe5a2e` all ancestors; no history rewrite).
2. Confirm the delta touches only the 9 files in §2/§4 (one backend controller + spec, two PG specs, four Admin Web files, no migrations/catalogue/config/secrets/financial logic).
3. Re-run the Arena 4 reproduction: seed `notification_deliveries` with `message='Your funding of NGN 5,000.00 has been approved.'` and a provider-prose `last_error`; GET deliveries as a `notification.view_deliveries` holder; assert the rendered text and raw error appear **nowhere** in the response JSON, `errorCode` is `UNCLASSIFIED`, and D2-style sentinels (payload, destination, PHONE raw recipient, provider-key-like error) are absent across SMS/EMAIL/FAILED/SKIPPED rows.
4. Re-verify authorization is unchanged: authorized roles 200, function-less workforce 403 FUNCTION_MISSING, customer/agent/aggregator rejected, unauthenticated 401, PHONE masking intact, pagination/filters intact.
5. Re-run gates 1–8 of §5 independently (embedded PG harness; sequential runner) and update the acceptance report with the remediation SHA, evidence, and a new per-P0 verdict.
6. P0-01's CONDITIONAL PASS still depends on signed D-01/D-04 decisions — outside this remediation.

## 8. Remote verification record

- Remediation commit `56ee049ca4c04c0914e29508f5dd36c120603f0d` pushed to `origin/arena/8e59e188-monienaija` (`ef596ee..56ee049`) **before** the complete PG rerun started; the working tree was clean and HEAD did not move during the run, so gate 8 executed on exactly the pushed application commit.
- This document is a docs-only commit on top of `56ee049`; no application code changed after the regression run.
- No reset, rebase, force-push, or history rewrite; `main`, `arena/92fd33dd-monienaija`, `arena/ea070127-monienaija`, and `arena/870f970d-monienaija` untouched; Arena 4's docs and Arena 2's newer provider-configuration work were fetched for inspection only and **not merged**.
- Post-push verification (HEAD == origin tip, clean tree, ancestry) recorded in the mission log at push time.
