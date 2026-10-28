# Sprint 1 + Hardened SMS/Email Provider Configuration — Integration Record & Arena 4 Handoff

**Date:** 2026-10-28
**Arena:** 3 (pinned branch `arena/8e59e188-monienaija`)
**Integrated application SHA:** `96cd6e68e61646938cbc3f6e78aa3f00ddc6cb9a` (merge commit; application tip of the pinned branch)
**Prior re-accepted application SHA:** `56ee049ca4c04c0914e29508f5dd36c120603f0d` (Arena 4 CONDITIONAL GO — **applies only to that pre-provider tree and is NOT carried forward**)
**Arena 4 final re-acceptance:** `docs/audit/20261028/sprint1-security-acceptance/09-FINAL-INDEPENDENT-REACCEPTANCE-20261028.md` (report commit `37622a56472ec9b6f9bb47c7f3028c89fb7059cc`, branch `arena/870f970d-monienaija` — fetched and inspected, not merged)
**Integrated Arena 2 work:** branch `arena/ea070127-monienaija` tip `fa08e71f0f38434e106a38a78e5a750b8ab7a1f5` = `1f6decd` (governed Robase SMS & Brevo email provider configuration) + `fa08e71` (provider-status projection hardening, provider/test-send audit visibility restriction, DB error sanitization). Merge base with the pinned branch: `cdf5203` (Arena 2's P0-02 fix, already integrated in Sprint 1).
**Status:** integrated and regression-verified by the integrator. **NOT accepted — the combined application requires a fresh independent Arena 4 security review (§8).**

---

## 1. Provenance and merge topology

Verified at integration time via `git ls-remote` / `git fetch`:

| Ref | SHA | Verification |
|---|---|---|
| `arena/8e59e188-monienaija` (pinned, pre-merge) | `b39a2efc7b25dfca3c5868f669cf13661e9570ce` | == mission-stated documentation HEAD; parent `56ee049` == mission-stated remediated application SHA |
| `arena/ea070127-monienaija` | `fa08e71f0f38434e106a38a78e5a750b8ab7a1f5` | == mission-stated Arena 2 final commit; parent `1f6decd`, grandparent `cdf5203` |
| `arena/870f970d-monienaija` | `37622a56472ec9b6f9bb47c7f3028c89fb7059cc` | Arena 4 re-acceptance report commit (docs-only; fetched for inspection, **not merged**) |
| Merge base | `cdf52030f0cae09f169a1fb333e9292f4d74f135` | already an ancestor of the pinned branch via the Sprint 1 integration merge `5a5ad8a` |

```
b39a2ef (Sprint 1 docs HEAD) ── 56ee049 (P0-02 remediation) ── 5a5ad8a/bebd7bd (Sprint 1 merges) ── 2fe5a2e (audited baseline)
                                                                                                          │
fa08e71 (A2 hardening) ── 1f6decd (A2 provider config) ── cdf5203 (merge base) ───────────────────────────┘

96cd6e6 = merge --no-ff of fa08e71 into b39a2ef   ← integrated application SHA
<this document> = docs-only commit on top of 96cd6e6
```

No reset, rebase, force-push, cherry-pick, or history rewrite. All source branches preserved untouched (`arena/ea070127-monienaija` remains at `fa08e71`, `arena/870f970d-monienaija` at `37622a5`, `arena/92fd33dd-monienaija` at `22d3ec8`); `main` untouched.

## 2. Merge conflicts and resolutions

**Git reported zero conflicted paths** — the merge applied cleanly. The mission's five flagged risk files resolved as follows:

| File | Both sides? | Outcome |
|---|---|---|
| `src/operations/audit.service.ts` | YES (A1 compliance filters vs A2 provider-audit filters, same `list()` method, disjoint insertion regions) | Auto-merged; **semantically verified post-merge** (§3.1) — all 8 `andWhere` blocks present (3 base + 3 compliance + 2 provider), both opt-in mechanisms intact and independent |
| `src/operations/operations.controller.ts` | NO (only A2 changed it; A1's audit changes live in the service) | Clean take of A2's provider-oversight gating on `GET /internal/audit` |
| `apps/admin-web/src/services/notification-domain.ts` | YES (P0-02 `errorCode` delivery record vs A2 provider-config types — disjoint regions) | Auto-merged; both verified present (§3.2) |
| `apps/admin-web/src/services/notification-management-api.ts` | NO (unchanged on the pinned side since `cdf5203`) | Clean take of A2's version |
| `apps/admin-web/src/screens/authenticated/NotificationManagementScreen.tsx` | YES (P0-02 inspector/table `errorCode` changes vs A2 provider-workspace tab — disjoint regions) | Auto-merged; P0-02 UI verified intact and no re-introduced `message`/`lastError` rendering (§3.2) |

Because clean auto-merge does not prove semantic safety, every dual-touched security surface was re-inspected in the merged tree (§3) and re-tested end-to-end (§4).

## 3. Security invariants independently checked in the integrated tree

### 3.1 BOTH audit restriction layers preserved (instruction 4)

- **Compliance layer (A1, P0-01):** `AuditService.list(query, options)` still hides `CUSTOMER_COMPLIANCE_CASE` + 4 child entity types, case-route `AUTHORIZATION_DECISION` records (current `customer-compliance-case` resourceType and legacy `%/compliance-cases%` action shapes), and `A4_POLICY_DECISION` facts with `COMPLIANCE_`-prefixed (or malformed) reason codes — unless the internal `includeComplianceCaseRecords` opt-in is passed. The HTTP audit controller never exposes that option as a query override (A2's rewritten `getAudit` does not add it). The maturity consumer retains its count-only (`limit: 1`) trusted opt-in.
- **Provider layer (A2):** `list()` additionally hides `NOTIFICATION_PROVIDER_CONFIG` / `NOTIFICATION_TEST_SEND` entity types and `PRIVILEGED_ACTION_APPROVAL` records linked to `NOTIFICATION_PROVIDER_CONFIG_PROPOSAL` (via `new_values->>'resourceType'` or the approvals-table EXISTS check) unless the symbol-keyed internal flag is set. The flag is only set by `listWithNotificationProviderOversight()`, which `OperationsController.getAudit` calls **only after** a server-side audited `authorize()` decision grants `notification.provider.view` (non-audited `evaluate()` when the query does not target provider entity types). Records remain intact in `audit_events` for authorized oversight.
- **Composition verified:** `listWithNotificationProviderOversight` delegates through `list()` with default options → a provider-oversight caller still cannot see compliance case records; a compliance opt-in caller still cannot see provider records. The two restrictions are independent, both default-on, and neither is reachable from a query parameter.

### 3.2 P0-02 remediation preserved (instruction 5)

- `AdminNotificationController` in the merged tree: SQL still **never selects `message`**; `last_error` is read solely to derive `errorCode` through the closed 13-code allowlist / `UNCLASSIFIED` / null sanitizer; `redactRecipientId` PHONE/email masking intact; `requireFunction('notification.view_deliveries')` runs before any query parsing; pagination/filters/ordering unchanged. (File untouched by the merge.)
- Admin Web: `NotificationDeliveryRecord` still exposes `errorCode` (no `message`/`lastError`); NotificationManagementScreen inspector shows "Error / Skip Code", the "Rendered Safe Message" block remains removed, table column renders `errorCode`; SystemHealthScreen deliveries column unchanged; A2's new provider workspace introduces **no** delivery message/lastError rendering (grep-verified).
- Real-PG sentinel suites re-executed on the merged tree: sprint1 delivery-authorization (incl. D2 sentinels across SMS/EMAIL/SENT/FAILED/SKIPPED/PHONE) and hardening-09 diagnostics — PASS (§4).

### 3.3 P0-01 and P0-03 preserved without grant expansion (instruction 6)

- `git diff b39a2ef..96cd6e6` touches **no** compliance file (`customer-compliance*`, dashboard, maturity guard logic beyond A2's unrelated none) and **no** limit-catalog file; the `limit.view` exact-path route policies and controller check are byte-identical; `customer-compliance-access.guard.ts` and its category binding unchanged.
- Catalogue delta contains **only** the two new provider functions and their six grants (§5.2) — no modification to any existing function, role, or grant (no expansion of `notification.view_deliveries`, `limit.view`, compliance functions, or role memberships).
- Focused real-PG suites for both surfaces re-executed on the merged tree: compliance authorization (21 tests) and limit diagnostics (13 tests incl. function-less 403 + bypass probes) — PASS (§4).

### 3.4 Provider-configuration security behavior verified (instruction 8)

| Behavior | Evidence in merged tree |
|---|---|
| AES-256-GCM credential encryption | `notification-secret-encryption.service.ts`: `ALGORITHM='aes-256-gcm'`, `createCipheriv/Decipheriv` with explicit authTag length, per-secret random IV, AAD bound to `monienaija:notification-provider-secret:v1:{channel}:{keyVersion}` |
| Key rotation | Versioned keyring: `activeKeyVersion` + `keyVersions[]` (decrypt with any known version, encrypt with active), `KEY_VERSION_PATTERN` validation, `PROVIDER_ENCRYPTION_KEY_VERSION_MISSING` fail-closed error code |
| SUPER_ADMIN maker / FINANCE_CONTROLLER independent checker | `notification-provider-config.service.ts`: `INITIATOR_ROLE='SUPER_ADMIN'`, `APPROVER_ROLE='FINANCE_CONTROLLER'`, `GOVERNANCE_RESOURCE_TYPE='NOTIFICATION_PROVIDER_CONFIG_PROPOSAL'` through the workforce privileged-action approval flow (`selfApprovalProhibited`, `SELF_APPROVAL_FORBIDDEN` server-side) |
| MFA | `minimumAssurance: 'MFA'` on the governed proposal policy |
| Robase SMS / Brevo email adapters | `robase-notification-provider.ts`, `brevo-email-provider.ts` (test doubles in-repo; no live calls made) |
| FULL/MINIMAL provider-status projections | `admin-notification-provider.controller.ts`: `notification.provider.view` → `projectionScope:'FULL'` (non-secret operational config + masked fingerprints); otherwise `MINIMAL` channel booleans only |
| Provider audit restrictions | §3.1 provider layer |
| Safe DB exception handling | `safeDbOperation` wrapper (fa08e71) — sanitized error codes, no raw DB error text to clients |
| Test-send rate limiting + masked destinations | Durable 5 provider-reaching attempts per principal per rolling hour; masked destination in response and audit; fixed safe content |
| Fail-closed dispatch | EMAIL provider missing/unconfigured → fail-closed (no console fallback unlike SMS test path); disabled events persist safe fixed message; encryption keys unavailable → fail-closed error codes; worker/dispatcher behavior regression-proven by v1-005 / v1-email-notification-01 / notification-registry suites (§4) |

## 4. Test matrix — executed on the integrated SHA `96cd6e6` (integrator's own execution)

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Backend production build | `npm run build` | ✅ clean |
| 2 | Backend TypeScript check | `npx tsc --noEmit -p tsconfig.json` | ✅ clean |
| 3 | Complete backend unit suite | `npm run test` | ✅ **204/204 suites · 2057/2057 tests · 0 failures** (was 203/2044; +1 suite/+13 tests from A2's `notification-provider-config.unit.spec.ts` (594 lines) + production-readiness updates) |
| 4 | Admin Web typecheck | `cd apps/admin-web && npm run ts:check` | ✅ clean |
| 5 | Complete Admin Web suite | `cd apps/admin-web && npm test` | ✅ **27/27 suites · 186/186 tests · 0 failures** (+1 suite/+5 tests from A2's `provider-configuration.test.tsx`) |
| 6 | Admin Web production build | `cd apps/admin-web && npm run build` | ✅ built |
| 7 | Targeted real-PG security battery, batch 1 (`pcfgt1`) | compliance-authorization + sprint1-notification-delivery-authorization + hardening-09 diagnostics + limit-05 diagnostics + **v1-notification-provider-configuration-01** (A2's 1434-line suite: encryption, key rotation, maker-checker + MFA + self-approval denial, FULL/MINIMAL projections, audit restrictions, fail-closed dispatch, test-send limits) | ✅ **5/5 suites · 83/83 tests** |
| 8 | Targeted real-PG battery, batch 2 (`pcfgt2`) | v1-003-admin-operational-writes (audit endpoint) + notification-migration-upgrade-01 (chain 098→099→100 upgrade path) + v1-005-notification-delivery + v1-email-notification-01 + notification-registry | ✅ **5/5 suites · 78/78 tests** |
| 9 | **Complete sequential PostgreSQL integration suite** | `PG_TEST_CONCURRENCY=1 NODE_ENV=test PG_TEST_RUN_ID=pcfgfull node scripts/run-pg-integration-tests.js` | ✅ **122/122 files · 2327/2327 tests · 0 failures** — runner verdict: `=== PG integration suite: 9 batch(es), 122 files, concurrency=1 — all passed ===` (run id `pcfgfull`, log `full-pg-provider-integration.log`, gitignored). Executed on the exact pushed merge commit `96cd6e6` with a clean working tree throughout. 122 files = the prior 121 + A2's `v1-notification-provider-configuration-01`; no timeout, no incomplete batch, no skipped file. |

Cross-branch regression coverage (instruction 9): the dual-modified surfaces are covered by re-executing, unmodified and unweakened, both branches' own suites on the merged tree — A1's compliance suite, the P0-02 sentinel suites (D1/D2 + hardening-09), the limit diagnostics suite, and A2's provider-configuration suites (which themselves assert provider-audit hiding and the composed audit filtering). No assertion was weakened anywhere; the only test-content deltas in the merged tree are A2's own pre-reviewed updates (migration-count assertions for head 100 in a19/a20/a8/v1-003/v1-007/v1-limit-02/notification-migration-upgrade/production-readiness).

**Complete sequential PostgreSQL run — per-batch detail** (run id `pcfgfull`, concurrency=1, on `96cd6e6`):

| Batch | Files | Tests | Failures |
|---|---|---|---|
| 1/9 | 15 | 652/652 | 0 |
| 2/9 | 15 | 298/298 | 0 |
| 3/9 | 15 | 345/345 | 0 |
| 4/9 | 15 | 248/248 | 0 |
| 5/9 | 15 | 196/196 | 0 |
| 6/9 | 15 | 236/236 | 0 |
| 7/9 | 15 | 165/165 | 0 |
| 8/9 | 15 | 176/176 | 0 |
| 9/9 | 2 | 11/11 | 0 |
| **Total** | **122** | **2327/2327** | **0** |

(Net +1 suite / +8 tests vs the pre-merge 121/2319 run: A2's provider-configuration suite added, plus A2's own pre-reviewed count adjustments; batch composition shifted with the new file. No test was weakened; per-suite assertions were not modified by the integrator.)

## 5. Changed files and migration verification (instruction 7)

### 5.1 Merge delta (`git diff --name-only b39a2ef..96cd6e6` — 33 files, +9541/−216)

- **Backend (new):** `notification-provider-config.{controller,service}.ts`, `notification-secret-encryption.service.ts`, `brevo-email-provider.ts`, migration `1785753600100-CreateNotificationProviderConfiguration.ts`.
- **Backend (modified):** `admin-notification-provider.controller.ts` (FULL/MINIMAL + safeDbOperation), `notification-dispatcher.service.ts` / `notification-worker.service.ts` (fail-closed provider gating), `notification.module.ts`, `app.module.ts`, `audit.service.ts` (+provider filter, composed with A1's), `operations.controller.ts` (audit oversight gating), `authorization-catalogue.seed.ts`, `sensitive-data-redaction.ts`, `config/environment.ts`, `.env.example`, `production-readiness.service.ts`, `robase-notification-provider.ts` lineage.
- **Admin Web (new):** `ProviderConfigurationWorkspace.tsx`, `provider-configuration.test.tsx`; **(modified):** `NotificationManagementScreen.tsx` (provider tab; P0-02 surfaces intact), `navigation-access.ts`, `notification-domain.ts`, `notification-management-api.ts`.
- **Tests (A2's own):** `notification-provider-config.unit.spec.ts`, `v1-notification-provider-configuration-01.integration.spec.ts`, migration-count/readiness updates in a19/a20/a8, v1-003, v1-007, v1-limit-02, notification-migration-upgrade-01, production-readiness.
- **Not touched by the merge:** compliance sources, limit-catalog sources, route-policy-registry, `admin-notification.controller.ts` (P0-02), financial/ledger/transfer logic, existing migrations 001–099.

### 5.2 Migration 100 & catalogue verification

- Migration chain confirmed in tree: `…098-CreateNotificationTemplateRegistry` → `…099-AllowPhoneNotificationRecipients` → **`1785753600100-CreateNotificationProviderConfiguration`**; `production-readiness.service.ts` expects timestamp `1785753600100` / name `CreateNotificationProviderConfiguration1785753600100`; `production-readiness.spec.ts` and `notification-migration-upgrade-01` (clean-install + upgrade path) pass on real PG.
- Catalogue delta adds **exactly two functions**: `notification.provider.view` (OPERATIONS domain, READ, assignable) and `notification.provider.configure` (OPERATIONS domain, PRIVILEGED, assignable, `makerCheckerRequired`, `approvalRequired`) — and **exactly six grants**: SUPER_ADMIN view+INITIATE (maker), FINANCE_CONTROLLER view+APPROVE (independent checker), FINANCE_AUDITOR view, OPERATIONS view. No other function, role, grant, or access type changed; no existing entitlement broadened.
- `.env.example` / `config/environment.ts` additions are provider-configuration env plumbing (encryption keyring, provider enablement) — **no real secrets committed**; no production configuration was executed or deployed.

## 6. Explicitly NOT done / NOT claimed

- No live external SMS/email request, no real provider credentials, no production migration, no deployment, no financial transaction (instruction 12). Providers exercised only via in-repo test doubles.
- Arena 4's CONDITIONAL GO on `56ee049` is **not carried forward**; the combined application `96cd6e6` is unreviewed by Arena 4.
- No browser UAT; Admin Web verified via typecheck, component/unit tests, and production build only.
- Notification workers remain **not activated**; EMAIL remains registry-disabled per event (dark launch); provider activation is a staging decision gated on §7 prerequisites.

## 7. Unresolved decisions and production blockers (carried forward, NOT resolved by this integration)

1. **D-01 (Product + Security, OPEN):** compliance role/entitlement scope — global-within-category access remains; **per-worker customer assignment is not implemented or decided**; interim VIEW-grant interpretation is not an approved grant.
2. **D-04 (Compliance Product + Security, OPEN):** case-category taxonomy ratification; future categories fail closed; AML/SANCTIONS overlap requires an explicit new function.
3. **Global case-number collision (OPEN):** caller-supplied case numbers remain globally unique; 409 existence oracle across customers/categories persists pending an identifier policy.
4. **Scoped audit surface (OPEN):** compliance-case and now provider-config audit records are hidden from generic views; authorized scoped review surfaces need approved policy.
5. **Provider activation prerequisites (NEW, from A2's design):** real Robase/Brevo credentials provisioned via the governed maker-checker flow only; `NOTIFICATION_PROVIDER_*` encryption keyring configured with rotation procedure; worker activation flag decisions; staging test-send verification before enablement; monitoring of fail-closed dispatch outcomes.
6. Dark-launch posture and prior notification limitations unchanged (no live delivery evidence; `cash_to_cash.claimed/.expired` unwired; manual retry deferred by V1 requirement).
7. Arena 4's full-suite completion gate: their independent rerun did not complete previously; the integrator's complete run on this SHA is recorded in §4 gate 9 and remains owner-supplied evidence until independently reproduced.

## 8. Arena 4 handoff — fresh independent security review of the combined application

**Target:** application SHA `96cd6e68e61646938cbc3f6e78aa3f00ddc6cb9a` on `arena/8e59e188-monienaija` (this document is the docs-only commit on top). The prior CONDITIONAL GO does **not** transfer.

Suggested procedure (independent checkout; do not trust this record):

1. Fetch; verify `96cd6e6` parents are `b39a2ef` and `fa08e71`; verify `56ee049`, `22d3ec8`, `cdf5203`, `a7898e2`, `2fe5a2e` are ancestors; verify source branch tips unchanged (`arena/ea070127-monienaija` == `fa08e71`).
2. Diff review: `git diff 56ee049..96cd6e6` (== A2's 33-file delta) — confirm no compliance/limit/P0-02 controller changes, catalogue delta limited to §5.2, no secrets in `.env.example`/config.
3. Re-run the P0 sentinel battery on the merged tree: sprint1 delivery-authorization (D1/D2), hardening-09, compliance authorization, limit-05 diagnostics — plus A2's provider-configuration-01 suite.
4. Adversarial probes for the composition specifically:
   - `GET /internal/audit?entityType=NOTIFICATION_PROVIDER_CONFIG` **without** `notification.provider.view` → records hidden (filtered list, not an error oracle); **with** the function → visible, while compliance-case records remain hidden from the same view;
   - `GET /internal/audit?entityType=CUSTOMER_COMPLIANCE_CASE` by any generic caller → hidden (compliance filter not weakened by the provider oversight path);
   - deliveries endpoint: re-run the rendered-message/raw-lastError reproduction → absent; `errorCode` allowlist behavior intact; PHONE masking intact;
   - provider-status as non-`provider.view` principal → MINIMAL projection only; no fingerprints/config;
   - provider config mutation as non-SUPER_ADMIN or without MFA → denied; self-approval → `SELF_APPROVAL_FORBIDDEN`;
   - encrypted at rest: DB `notification_provider_configuration` rows contain ciphertext only (no plaintext API keys); decryption requires the matching key version; missing key → fail-closed, no dispatch.
5. Independently complete the full sequential PG suite to a final aggregate (the integrator's run: §4 gate 9).
6. Record a fresh per-surface verdict (P0-01/P0-02/P0-03/provider-configuration) with exact SHAs; only Arena 4 may declare acceptance. Production approval remains a separate release/security process.

## 9. Remote verification record

- Merge commit `96cd6e68e61646938cbc3f6e78aa3f00ddc6cb9a` pushed to `origin/arena/8e59e188-monienaija` (`b39a2ef..96cd6e6`) **before** the complete PG run started; remote tip verified equal to local HEAD at push time, and HEAD did not move during the run — gate 9 executed on exactly the pushed application commit.
- This document is a docs-only commit on top of `96cd6e6`; no application code changed after the regression run.
- Post-push state: HEAD == origin tip, working tree clean; ancestry of `fa08e71`, `1f6decd`, `56ee049`, `5a5ad8a`, `22d3ec8`, `cdf5203`, `a7898e2`, `2fe5a2e` all verified ANCESTOR_OK.
- No reset, rebase, force-push, or history rewrite; `main` and all Arena source branches untouched; Arena 4's report branch fetched for inspection only.
