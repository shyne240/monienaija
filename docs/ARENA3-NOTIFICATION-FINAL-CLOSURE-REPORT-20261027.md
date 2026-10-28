# ARENA 3 — Notification Module: Final Closure & Regression Report

**Date:** 2026-10-27
**Branch:** `arena/8e59e188-monienaija` (pinned; no other branch touched)
**Final application SHA:** `73eb1ca9b2ea74e063751ad71a34b76091537302`
**Predecessor (integrated baseline):** `301290b620ec723e9d6087856fe51d240d52a7db` — integration report: `docs/ARENA3-SMS-EMAIL-NOTIFICATION-INTEGRATION-REPORT-20261027.md`
**Scope discipline:** focused closure only — no architecture redesign, no unrelated development, no deployment, no notification-worker activation, no production migrations, no changes to `main`, no mobile development. All prior commits preserved (no reset/rebase/force-push).

---

## 1. Baseline verification (mission step 1)

| Check | Result |
|---|---|
| `git fetch` + HEAD vs origin at mission start | HEAD == origin == `301290b620ec723e9d6087856fe51d240d52a7db` ✅ |
| Working tree | clean (0 dirty files) ✅ |
| Ancestry of integrated source commits (`a254ba0`, `3b2b88d`, `775e29f`, `ee39766`) | all ANCESTOR_OK of HEAD ✅ |
| Existing integration report present | `docs/ARENA3-SMS-EMAIL-NOTIFICATION-INTEGRATION-REPORT-20261027.md` ✅ |
| Embedded PostgreSQL for integration runs | OPEN on 5432 ✅ |

## 2. Defects corrected (mission step 2) — commit `73eb1ca`

### Defect A — stale `UNWIRED_OUTBOX` label for `cash_to_cash.created` (FIXED)

- **Evidence gathered:** the backend enqueues `cash_to_cash.created` via `enqueueOnce` **inside the SERIALIZABLE cash-to-cash transfer transaction** (`src/agent/agent-cash-to-cash.service.ts:568`), and the registry seed (`src/notification/notification-defaults-v1.ts`) enables **SMS** for this event (EMAIL disabled). A grep of `agent-cash-to-cash-claim.service.ts`, `agent-cash-to-cash-expiry.service.ts`, and `agent-cash-to-cash-expiry-worker.service.ts` confirmed **zero** enqueue/outbox emitters for `cash_to_cash.claimed` / `cash_to_cash.expired`.
- **Correction (`apps/admin-web/src/services/notification-domain.ts`):** `cash_to_cash.created` runtimeTriggerState changed `UNWIRED_OUTBOX → LIVE_OUTBOX` with the wiring evidence recorded in-code. The label describes **trigger wiring + registry enablement only — never worker runtime state**; per-channel `enabled` flags continue to come from live registry data (`mapRegistryEvent`), so the console displays LIVE for SMS and disabled for EMAIL exactly as configured. Descriptions/securityNotes updated to the unified variable names (`{{sender_name}}`, `{{amount}}`, `{{locator_clause}}`).
- **Honesty preserved:** `cash_to_cash.claimed` and `cash_to_cash.expired` **remain `UNWIRED_OUTBOX`** with explicit "(no backend trigger wired yet)" comments — no ACTIVE/LIVE display for events without an emitter. No admin-web test pinned the stale label, so no test was weakened.

### Defect B — empty-amount C2C rendering failed OPEN (FIXED, fail-closed)

- **Defect:** `NotificationTemplateService.render()` resolved `amount` / `amount_clause` to `''` when the redacted payload carried no valid `amountMinor` (redaction keeps only `/^[1-9][0-9]*$/`), and the message rendered with the amount **silently omitted** — a financial notification without its committed principal.
- **Correction (`src/notification/notification-template.service.ts`):** for `cash_to_cash.created`, when the template uses `amount` or `amount_clause` and the resolved amount is empty, `render()` now throws `BadRequestException('Cash-to-Cash notification amount unavailable')`.
  - **Fail-safe path:** the render block sits outside the per-intent delivery insert try; the throw propagates to the outbox drain catch, which marks the event `FAILED` with `last_error = NOTIFICATION_DISPATCH_FAILED` and schedules a bounded `+60s` automatic retry. **Nothing is sent; no amount is ever fabricated.** Any deliveries inserted for earlier intents before the throw are protected by the `ON CONFLICT (event_key, recipient_id, channel) DO NOTHING` idempotency key on redrain.
  - **Correct formatting of the valid principal retained:** `formatNgn` exact BigInt minor-unit conversion (`'250000' → 'NGN 2500.00'`, regex `/^\d{1,15}$/`).
  - **Financial accounting untouched:** the guard is in notification rendering only; the cash-to-cash ledger, hold/release, and outbox enqueue logic are unmodified.
  - **Maker-checker preview unaffected:** `preview()` passes fixed server-side sample data (valid `amountMinor`), so the guard cannot break governed preview/validation flows.
- **Tests:** `src/notification/cash-to-cash-notification.spec.ts` — new fail-closed regression (missing / `'0'` / `'not-a-number'` / `'-2500'` / `'2500.50'` / `' 2500'` / `'002500'` / `'1e3'` all throw; valid `'250000'` renders `NGN 2500.00`); suite 6/6. `test/notification-email-template.unit.spec.ts` — the email seam contract updated from "renders generically with empty payload" to the approved fail-closed contract (empty payload rejects; valid principal renders exactly). All pre-existing C2C specs pass valid `amountMinor`, so the guard breaks none.

### Defect C — manual delivery retry (DEFERRED BY REQUIREMENT — no endpoint invented)

- **Requirement inspection result:** manual retry is **not part of the approved V1 requirements**:
  - `docs/V1/V1-ADMIN-WEB-PAGE-INVENTORY-01.md` (notification deliveries page): the approved surface is read-only — **"No retry/replay/mutation controls"**.
  - `docs/ARENA2-NOTIFICATION-API-CONTRACT-AND-DEPENDENCIES-20261027.md`: manual retry explicitly labelled **"(Optional ARENA 3 enhancement)"** / BLOCKED.
  - The approved V1 retry mechanism is the **automatic bounded worker retry**: `SMS_RETRY_MAX_ATTEMPTS=3`, `SMS_RETRY_BASE_DELAY_SECONDS=60`, exponential backoff, `FOR UPDATE SKIP LOCKED`, isolated from all financial services (`docs/V1/V1-AGENT-MOBILE-17-RELEASE-INFRASTRUCTURE-HANDOFF.md` lines 103–104, 196; same env vars in `docs/V1/V1-GO-LIVE-01-PRODUCTION-INFRASTRUCTURE-READINESS.md`).
- **Action taken:** **no** manual-retry endpoint, route, or admin mutation was created — doing so without an established requirement + authorization policy would violate the closure mandate and the read-only V1 surface. Automatic bounded retries are retained unchanged. `apps/admin-web/src/services/notification-management-api.ts` comment + console `blockedExplanation` reworded from "BLOCKED on ARENA 3" (implying an omission) to an honest **DEFERRED** framing citing the V1 read-only requirement, so the UI never claims a capability gap was accidental. The `manual-retry-blocked` testid contract is unchanged (test asserts presence only).

## 3. Notification governance audit (mission step 3 — documentation only; NO policy changed)

All findings verified against server-side source at `73eb1ca`. Nothing in this section was modified by this closure mission.

| Governance property | Finding | Evidence |
|---|---|---|
| Notification-specific permissions | Catalogue seeds exactly two: `notification.view_deliveries` (read deliveries/diagnostics) and `notification.test_send` (scoped provider test sends, rate-limited **5/hour**) | `src/authorization-catalogue/authorization-catalogue.seed.ts`; `src/admin/admin-notification-provider.controller.ts` |
| Registry route access | All `/api/v1/internal/notifications/{events,templates*,changes*}` routes are `WORKFORCE_SESSION`-only, principal types `OPERATOR`/`PRIVILEGED`, customer/agent/aggregator access `NONE`; guards run **before** controllers | `src/authorization/route-policy-registry.ts:710–724` |
| Maker restrictions | Change requests (CONFIGURATION / TEMPLATE / TEMPLATE_ROLLBACK) require role `SUPER_ADMIN` + `notification.view_deliveries` + **recent MFA** (`minimumAssurance: 'MFA'`); reason 5–500 chars, safety-asserted, rejects long digit runs | governed-action policies; `src/notification/notification-registry.service.ts` / `.controller.ts` |
| Checker restrictions | Approval requires role `FINANCE_CONTROLLER` + scope `privileged:approve` + MFA, executed through the workforce approvals API (`POST /internal/a2/workforce/approvals/:id/approve`), then a separate `POST /changes/:approvalId/execute` consumption step | `src/authorization/governed-action.registry.ts:174–186` |
| Independent approval (maker ≠ checker) | `selfApprovalProhibited: true`; server rejects `requesterPrincipalId === approverPrincipalId` with `SELF_APPROVAL_FORBIDDEN` | `src/authorization/governed-action.registry.ts:182`; `src/authorization/privileged-action-approval.service.ts:467` |
| Template/event-config authorization | CONFIGURATION changes carry `expectedVersion` optimistic concurrency; only one active template per (event, channel) via partial unique index `uq_notification_template_active`; direct `is_active=true` writes rejected — activation only through governed approval/execute | migration `098-CreateNotificationTemplateRegistry`; registry service |
| Audit-trail integrity | Every request/approval/execution writes audit rows; template + configuration history is append-only (DB-trigger protected); provider-status exposes **masked fingerprints only** | migration 098 triggers; `admin-notification-provider.controller.ts` |
| Server-side enforcement | **Yes** — all of the above is enforced by guards/services in the backend. Admin-web UI permission gating is a mirror for UX only, never the enforcement point | route-policy registry + registry/approval services |

**Granular-permission recommendation (PENDING explicit product-owner approval — not implemented):** the current interim policy concentrates maker power in `SUPER_ADMIN` and approval in `FINANCE_CONTROLLER`. A workforce-compatible refinement would split `notification.view_deliveries` into `notification.configuration.read`, `notification.configuration.write`, `notification.templates.approve`, and `notification.deliveries.read`, map them onto workforce function codes (so a dedicated Notification Operations function could maker while Finance retains independent approval), and add a per-event lock override permission for the 6 locked security events. **This remains a recommendation only; the interim maker/checker policy is unchanged and still flagged for product-owner ratification.**

## 4. Complete regression on the final corrected application commit (mission step 4)

Executed on `73eb1ca` (working tree clean; HEAD did not move during the runs).

| Gate | Command | Result |
|---|---|---|
| Backend production build | `npm run build` | ✅ clean |
| Backend complete unit suite | `npm run test` | ✅ **201/201 suites, 2019/2019 tests, 0 failures** (was 2018; +1 new fail-closed regression test) |
| Targeted real-PG pre-commit sanity (all defect surfaces) | `jest --config jest.integration.config.js --runInBand` on a15, v1-email-notification-01, notification-registry, sms-v1-01, v1-005 | ✅ 5/5 suites, 90/90 tests (run id `clsgt1`) |
| **Complete sequential PostgreSQL integration suite (post-fix, full rerun — no targeted substitution)** | `PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=closurefull1 node scripts/run-pg-integration-tests.js` | ✅ **119/119 files, 2276/2276 tests, 0 failures** — runner verdict: `=== PG integration suite: 8 batch(es), 119 files, concurrency=1 — all passed ===` (run id `closurefull1`, log `full-pg-closure.log`) |
| Admin-web typecheck | `npm run ts:check` (tsc) | ✅ clean |
| Admin-web complete unit suite | `npm test` | ✅ **26/26 suites, 179/179 tests, 0 failures** |
| Admin-web production build | `npm run build` (vite) | ✅ built |
| Cross-surface contract coverage | included in the PG suite: registry API contract, email seam, locator contract, workforce approval round-trips | ✅ |
| C2C accounting / idempotency / privacy regression | a15/a16/a17 (PG) + `cash-to-cash-notification.spec.ts` + `cash-to-cash-locator-contract.spec.ts` (unit) | ✅ |

**Full sequential PostgreSQL integration run — per-batch detail** (run id `closurefull1`, concurrency=1, executed on `73eb1ca` after the final application-code correction; log preserved at `full-pg-closure.log`):

| Batch | Files | Tests | Failures |
|---|---|---|---|
| 1/8 | 15 | 519/519 | 0 |
| 2/8 | 15 | 500/500 | 0 |
| 3/8 | 15 | 334/334 | 0 |
| 4/8 | 15 | 214/214 | 0 |
| 5/8 | 15 | 172/172 | 0 |
| 6/8 | 15 | 192/192 | 0 |
| 7/8 | 15 | 186/186 | 0 |
| 8/8 | 14 | 159/159 | 0 |
| **Total** | **119** | **2276/2276** | **0** |

This is a complete fresh rerun of the entire integration suite on the corrected commit — not a targeted substitution. It includes the C2C accounting/idempotency/privacy clusters (a15/a16/a17), the notification registry + email seam suites, the locator-contract suite, and all SMS/PUSH legacy suites.

No test was skipped, stubbed out, or weakened to pass; the only test content changed in this mission is `test/notification-email-template.unit.spec.ts` test 2, which previously pinned the Defect-B fail-open behavior and now pins the approved fail-closed contract (empty C2C payload must reject; valid principal must render exactly).

## 5. Completion evidence — real PostgreSQL tests only (mission step 5)

Every claim below maps to executed real-PG (or, where noted, unit) tests at `73eb1ca`. No browser UAT was performed (no browser automation available); no live production-provider delivery was tested (providers remain test doubles in-repo); no readiness claim relies on either.

| Required evidence | Where proven (real PG unless noted) |
|---|---|
| Template changes persist | `test/notification-registry.integration.spec.ts` (11 tests) |
| Maker-checker enforced (incl. self-approval rejection, MFA) | `test/notification-registry.integration.spec.ts` |
| Approved versions become active (single active per event+channel) | `test/notification-registry.integration.spec.ts` |
| Active SMS+EMAIL templates control rendering | `test/v1-email-notification-01.integration.spec.ts` (registry-driven render tests) + email-seam fail-closed unit tests |
| Disabled events suppressed (SKIPPED/EVENT_DISABLED, nothing sent) | `test/v1-email-notification-01.integration.spec.ts` |
| C2C events idempotent (single outbox event on replay; delivery ON CONFLICT) | `test/a15-agent-cash-to-cash.integration.spec.ts` (+ a16 claim, a17 expiry) |
| Unregistered-beneficiary PHONE recipients supported | migration `099-AllowPhoneNotificationRecipients` + `src/notification/cash-to-cash-notification.spec.ts` (unit) + a15/a16 |
| Transfer credentials excluded from notification payloads (redaction allowlist) | `src/notification/cash-to-cash-notification.spec.ts` (unit) + a15/a16 privacy assertions |
| Public locator filters to active eligible agents only | `test/cash-to-cash-locator-contract.spec.ts` + a15/a16 |
| SMS/PUSH legacy behavior intact | `test/sms-v1-01.integration.spec.ts`, `test/v1-005-notification-delivery.integration.spec.ts`, notification cluster |
| Empty-amount C2C fails closed, never fabricates (Defect B) | `src/notification/cash-to-cash-notification.spec.ts` (unit, 6/6) + seam unit contract; dispatch FAILED-path behavior covered by dispatcher unit specs |

## 6. Final capability matrix

| # | Capability | Status at `73eb1ca` |
|---|---|---|
| 1 | SMS channel (legacy V1 path) | ✅ COMPLETE — unchanged, regression-proven |
| 2 | PUSH channel (legacy) | ✅ COMPLETE — unchanged |
| 3 | EMAIL channel infrastructure (provider seam, layout, escaping, subject safety) | ✅ COMPLETE |
| 4 | DB-backed template registry (maker-checker, versioning, rollback, activation) | ✅ COMPLETE |
| 5 | Per-event/per-channel enablement with locked security events | ✅ COMPLETE |
| 6 | Redaction/allowlist rendering on ALL channels | ✅ COMPLETE |
| 7 | PHONE recipients for unregistered C2C beneficiaries | ✅ COMPLETE |
| 8 | C2C outbox emission (created) + idempotency | ✅ COMPLETE |
| 9 | Admin console: events, templates, change requests, provider status, test sends, deliveries | ✅ COMPLETE (honest states; Defect A corrected) |
| 10 | Fail-closed financial-amount rendering (Defect B) | ✅ COMPLETE — new in this closure |
| 11 | Automatic bounded delivery retry | ✅ COMPLETE (worker present but **not activated** — staging prerequisite) |
| 12 | Manual delivery retry | ⏸ DEFERRED BY REQUIREMENT (V1 surface is read-only; needs new requirement + authorization policy — Defect C finding) |

## 7. Remaining limitations

1. **No live provider delivery evidence** — SMS/EMAIL providers in test are doubles; real provider credentials/verification belong to staging activation.
2. **No browser UAT** — admin console verified via component tests against the real API contract, not a browser session.
3. `cash_to_cash.claimed` / `cash_to_cash.expired` have **no backend outbox emitters** (honestly labelled UNWIRED_OUTBOX); wiring them is future scope, not a V1 requirement.
4. EMAIL is registry-**disabled for all 23 events** at seed (dark-launch posture); enabling per event is a governed configuration change.
5. Notification workers are **not activated** in any environment by this mission.
6. Retry of a fail-closed Defect-B event is bounded — if the payload never gains a valid amount (should be impossible given enqueue-time redaction), the event terminates FAILED with a visible `last_error`, by design.

## 8. Outstanding policy decisions (product owner)

1. **Ratify or replace the interim maker/checker policy** (maker = SUPER_ADMIN + `notification.view_deliveries` + MFA; checker = FINANCE_CONTROLLER + `privileged:approve` + MFA). No change was made silently.
2. **Granular notification permission model** (§3 recommendation) — PENDING explicit approval.
3. **Manual delivery retry** — decide whether to commission a requirement + authorization policy (would add a governed mutation to a currently read-only V1 surface).
4. **Security-event reclassification and PIN-unlock flows** remain policy blockers carried over from prior audits (unchanged).
5. **EMAIL enablement schedule** per event (currently all disabled).

## 9. Staging activation prerequisites

1. Product-owner ratification of §8.1 (maker/checker policy).
2. Real provider credentials configured via env (SMS + optional EMAIL), with `provider-status` fingerprints verified; test sends exercised through `POST /test-send` (rate-limited).
3. Notification worker activation with `SMS_RETRY_MAX_ATTEMPTS=3` / `SMS_RETRY_BASE_DELAY_SECONDS=60` (or approved overrides) — currently deliberately NOT activated.
4. Run migrations 096→099 in staging order (clean-install + upgrade + rollback proofs exist from the integration mission).
5. Governed enablement of EMAIL per event via maker-checker change requests (dark-launch: keep disabled until provider verification passes).
6. Monitoring/alerting on outbox `FAILED` events (including `NOTIFICATION_DISPATCH_FAILED` from the Defect-B guard) before enabling live traffic.

## 10. Staging-readiness verdict

**READY FOR STAGING (dark-launch posture), conditional on §9.** At `73eb1ca` the complete backend unit suite (201/201 · 2019/2019), the complete sequential real-PostgreSQL integration suite (complete sequential real-PostgreSQL integration suite rerun on the final corrected commit: 119/119 files · 2276/2276 tests · 0 failures), and the complete admin-web gates (tsc · 26/26 · 179/179 · production build) pass with zero failures; all three closure defects are resolved or requirement-deferred with evidence; governance is server-side enforced and documented; no financial accounting, Ordinary Agent V1 contract, or previously integrated work was altered. This verdict covers **automated testing evidence only** — it asserts neither browser UAT nor live production-provider delivery, neither of which has been performed.

## 11. Remote verification record

- Fix commit `73eb1ca9b2ea74e063751ad71a34b76091537302` pushed to `origin/arena/8e59e188-monienaija` (`301290b..73eb1ca`); remote tip verified equal to local HEAD **before** the full PostgreSQL rerun started, so the entire regression in §4 executed on the pushed application commit.
- This report is a docs-only commit on top of `73eb1ca` on the pinned branch; no application code changed after the regression run.
- No reset, rebase, force-push, or history rewrite at any point; all prior commits preserved. No branch other than `arena/8e59e188-monienaija` was touched; `main` untouched.
- Post-push verification (HEAD == origin tip, clean tree) recorded in the mission log at push time.
