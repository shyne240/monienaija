# F-01 Historical Provider-Reference Remediation — Integration Record (Arena 2 `789b6073`)

**Date:** 2026-10-29
**Integrator:** Arena 3 (pinned branch `arena/8e59e188-monienaija`)
**Status:** INTEGRATED — all local gates green at the time of writing. **Arena 4's NO-GO on `fd6a32b` remains in force until Arena 4 independently reviews this integrated SHA.** This is an integration record, not an acceptance or production-readiness claim. Provider activation remains dark.

---

## 1. Provenance and merge topology

| Item | SHA |
|---|---|
| Prior integrated application (Arena 4 review target) | `fd6a32b5acffd295b62ca4d346c38f128f336043` |
| Prior branch HEAD (integration record `SPRINT1-NOTIFICATION-RELIABILITY-INTEGRATION-20261028.md`) | `60e7f567a029fed3cdfe0ce327a5c9109ca390ea` |
| Arena 4 fresh acceptance of `fd6a32b` — **NO-GO**, single HIGH blocker (historical delivery `provider_ref` disclosure) + R-01/R-02 open items | `507a099b3cb8910df9634cd0b08f8e3c94c770cb` (`docs/audit/20261028/sprint1-security-acceptance/12-FRESH-INDEPENDENT-ACCEPTANCE-fd6a32b5-20261029.md`) |
| Arena 2 remediation (branch `arena/ea070127-monienaija` tip) | `789b6073ec3e8708c2e6966d2208c560694d543d` — **parent is exactly `fd6a32b`** |
| **Integrated application merge commit** | **`30c34453988ec2779905134adee27aa51cf4f400`** (`60e7f56` × `789b6073`) |

- `merge-base(60e7f56, 789b6073)` = `fd6a32b`: Arena 2 built directly on the integrated application; this branch's only post-`fd6a32b` commit was the docs record → **zero-conflict merge** (verified independently; ort strategy, no manual resolution required).
- Post-merge delta vs `60e7f56` = exactly the remediation's 10 files, +1631/−152 — no collateral changes.
- No reset/rebase/force-push; sibling branch tips re-verified untouched (`ea070127`@`789b6073`, `92fd33dd`@`d212c66`, `870f970d`@`507a099`, base@`3d05aae`).
- A sandbox revert occurred between turns (local checkout stale at `3d05aae`, 0 files with content absent from the remote tip — proven before restore); recovery was local-only `git reset --hard origin/arena/8e59e188-monienaija` to `60e7f56`, after which the merge proceeded. No work was lost.

### Changed files (10)

`src/admin/admin-notification.controller.ts` (diagnostics projection sanitized; P0-02 allowlist relocated verbatim), `src/common/sensitive-data-redaction.ts` (+provider-ref text redaction), `src/notification/notification-delivery.entity.ts` (TypeORM `provider_ref` column transformer, both directions), `src/notification/notification-dispatcher.service.ts` (read-back + duplicate/idempotency-conflict return paths sanitized; `listDeliveriesForEventKey` replaces `SELECT *` with an explicit column list + per-row sanitization), `src/notification/provider-security.ts` (+200: centralized `SAFE_DELIVERY_ERROR_CODES`/`sanitizeDeliveryErrorCode`/`redactDeliveryRecipientId`, delivery-ref boundary helpers), `src/operations/audit.service.ts` (provider-ref audit keys sanitized on WRITE for all notification audit payloads, composing with the existing read-side projection and the compliance/provider restriction layers).

Tests: NEW `test/f01-historical-provider-ref-security.unit.spec.ts` (310 lines), NEW `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts` (882 lines), reconciled `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` (+9/−7: assertions STRENGTHENED — raw refs must now be absent and opaque `pvr1:` required; P0-02 message non-projection assertions untouched), `src/admin/admin-notification.controller.spec.ts` (+73).

---

## 2. Arena 4 required-acceptance verification (report 12, F-01)

| Arena 4 requirement | Status in merged tree |
|---|---|
| Sanitize every delivery-reference read projection via a deterministic, scope-aware boundary before HTTP or internal service return | ✓ diagnostics controller projection; entity transformer `from` covers all ORM loads; `sanitizeProviderRefForBoundary` is deterministic per key material |
| No raw values in duplicate dispatch results or event-key lookup results | ✓ both dispatcher read-back paths wrapped; `listDeliveriesForEventKey` sanitized (provider_ref, last_error allowlist, recipient redaction) and no longer `SELECT *` |
| Retain no raw value in logs/audit | ✓ `redactSensitiveText` masks non-`pvr1:` provider-ref values; audit.service sanitizes provider-ref keys on write; existing read-side projection retained |
| Regression tests seeding raw historical rows for Robase/Brevo/Resend/unknown provider names across authorized diagnostics, duplicate dispatch and event-key lookup | ✓ disclosure suite tests 1–2 (seeded sentinels incl. `xkeysib-`-shaped credential/financial material; zero exposure asserted across HTTP, duplicate dispatch, event-key lookup, ORM loads, logs, audit projections; safe `pvr1:` refs preserved) |
| Preserve the exact existing delivery-status/minimal-projection policy (P0-02) | ✓ allowlist moved verbatim to provider-security (`UNCLASSIFIED` collapse intact); rendered message/raw last_error still never projected; hardening-09 P0-02 assertions untouched and passing |
| Unauthorized callers unaffected | ✓ disclosure suite test 3 (401 unauthenticated/non-workforce, 403 FUNCTION_MISSING) |
| Verify after app restart and through the key-rotation policy (R-01) | ✓ disclosure suite test 4: deterministic across restarts for a fixed keyring; stored `pvr1:` tokens preserved across synthetic key rotation; fails closed in production without durable secrets |
| Immutable audit rows remain immutable; sanitize at read boundaries (no destructive data migration chosen) | ✓ no migration added; historical DB rows untouched; sanitization is read/return-boundary only |

**R-01 (MEDIUM, reference stability across rotation):** the remediation's restart/rotation/fail-closed test provides the technical evidence Arena 4 asked for; the *policy* decision (whether cross-rotation correlation is required, dedicated versioned HMAC key) remains an explicit open Security/platform-secrets decision — not resolved by this integration.
**R-02 (LOW/conditional, shared-outbox `available_at` semantics):** unchanged; remains a conditional cross-consumer contract decision between the outbox owner and notification owner before any scheduled-event producer uses the field.

---

## 3. Regression evidence (integrator's own execution on the merged tree `30c3445`, sandbox, embedded PostgreSQL 18.4, synthetic providers only)

| Gate | Result |
|---|---|
| Backend `npm run build` | PASS |
| Backend `npx tsc --noEmit` | PASS |
| Complete backend unit suite | **207/207 suites · 2082/2082 tests PASS** (+1 suite/+6 tests vs `fd6a32b`: new F-01 historical unit spec) |
| Admin Web `ts:check` / tests / build | PASS · **27/27 · 188/188 PASS** (unchanged — remediation touches no Admin Web files) · PASS |
| Focused PG batch A (`f01bat1`): **historical-delivery-disclosure (NEW)**, hardening-09 diagnostics (reconciled), provider-configuration-01 (F-01..F-05 incl. tests 12/13/14), sprint1-delivery-authorization, compliance-authorization | **5/5 suites · 80/80 PASS** |
| Focused PG batch B (`f01bat2`): notification-reliability, transfer-notification-producer-01, v1-005 delivery, email-01, migration-chain | **5/5 suites · 81/81 PASS** |
| **Complete sequential PG suite** (run id `f01full1`, `PG_TEST_CONCURRENCY=1`, log `full-pg-f01-historical-integration.log`) | **125/125 files · 2355/2355 tests — all passed** (9/9 batches exit 0, ~41 min; vs the `fd6a32b` full run's 124 files · 2351 tests: +1 suite/+4 tests, exactly the new disclosure suite) |

Per-batch totals (tests passed, all equal total): 652 / 298 / 358 / 225 / 219 / 223 / 179 / 143 / 58 = **2355**. Runner summary line: `=== PG integration suite: 9 batch(es), 125 files, concurrency=1 — all passed ===`.

No real vendor calls or credentials; no provider activation; no production migration or deployment; no mobile work; D-01/D-04 untouched; no automatic C2C expiry disposition.

---

## 4. Unresolved items and limitations

- **Arena 4 NO-GO on the notification release remains in force** until fresh independent review of the SHA below. Arena 4's operational-readiness and production-authorization NO-GOs (monitoring, quarantine reconciliation/redrive, retention, key-rotation operations, staging, dark-launch) are unaffected by this code integration and remain open.
- R-01 policy decision and R-02 contract decision remain open (see §2).
- Carried-forward open decisions remain open and unclaimed: D-01, D-04, per-worker customer assignments, global case-number collision (409 oracle), notification dark-launch limits, scoped-audit surface design, provider-activation prerequisites, receipt retention/legal-hold/alerting/redrive design, other producers' audience contracts (deposit/withdrawal, agent cash, C2C claim/expiry, support).
- Complete-PG evidence is from the integrator's environment only; Arena 4 has previously hit time caps on full sequential runs and treats owner counts as claims.
- No browser UAT; Admin Web evidence is typecheck/tests/build. Lint baseline unchanged (pre-existing failures).
- Historical raw rows remain on disk by design (immutable-evidence policy); sanitization is enforced at every read/return/audit/log boundary. If a destructive data migration is ever chosen instead, Arena 4's idempotency/rollback criteria would apply — none was added here.

---

## 5. Arena 4 handoff

- **Review target (integrated application SHA): `30c34453988ec2779905134adee27aa51cf4f400`** — branch `arena/8e59e188-monienaija`, pushed (this record is committed as its child).
- Merge parents: `60e7f56` (prior docs HEAD over application `fd6a32b`) × `789b6073` (Arena 2 remediation, child of `fd6a32b`).
- Remediation-specific entry points: `test/v1-sprint1-f01-historical-delivery-disclosure.integration.spec.ts` (4 tests), `test/f01-historical-provider-ref-security.unit.spec.ts`, reconciled hardening-09 tests 9/12.
- Suggested focus: re-run the exact `xkeysib-HISTORICAL_SENTINEL…` HTTP probe from report 12 against the diagnostics endpoint; duplicate-dispatch and event-key-lookup sentinel sweeps; ORM-load path; log/audit capture; restart determinism and rotation behavior (R-01 evidence); P0-02 policy invariance; then the complete sequential PG suite to completion.
