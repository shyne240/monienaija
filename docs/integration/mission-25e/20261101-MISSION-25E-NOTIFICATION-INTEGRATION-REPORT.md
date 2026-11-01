# MISSION 25E — Notification System Controlled Integration and Independent Regression Verification

**Arena 3 · integration of Mission 25C (backend) and Mission 25D (Admin Web)**
Date: 2026-11-01
Integration branch: `integration/mission-25e-notification-integration`
Baseline: `019de996950b07e9312af455ce0d9b840e6e14f1` (`integration/mission-23-fast-uri-security`)

**Verdict: CONDITIONAL PASS — WITH EXPLICIT LIMITATIONS.**
The integration is technically sound and independently verified: both remediation sets are in, nothing outside them came in, and every executable gate is green. It is **not** a declaration that the notification system is complete or production-ready. H-07 (secret binding) is unresolved, H-04 (deposit/withdrawal policy) is unresolved, H-06 (trigger-lock disagreement) is unresolved and now demonstrated to be a **server-side enforcement gap, not just a labelling difference**, and several notification capabilities remain deliberately deferred.

---

## A. Baseline, source commits, integration branch

| Item | Value |
|---|---|
| Baseline | `019de996950b07e9312af455ce0d9b840e6e14f1` — `integration/mission-23-fast-uri-security` (Mission 24: PASS; Ordinary Agent V1 closed) |
| Arena 1 — Mission 25C, backend | `9fc00b104d3ca5cdd1141048d76e7d799cafd9aa` — `arena/92fd33dd-monienaija` |
| Arena 2 — Mission 25D, Admin Web | `e99f5f83a0ca8bc09cbfb4787923106e12f158cc` — `arena/ea070127-monienaija` |
| Integration branch | `integration/mission-25e-notification-integration` |
| Integration merges | `d2ff64f` (Arena 1, `--no-ff`), `762629e` (Arena 2, `--no-ff`) |
| Conflicts | **0** |

All three pins were verified as **real commit objects** and each was additionally equal to its branch tip at assessment time — the pins were used, not substituted. Both implementation commits descend **directly** from the baseline (`git merge-base` = `019de99…` for both), so this integration is a clean two-arm join with no unrelated history.

**Final integration SHA and pinned evidence tip** are recorded in §L once the full PostgreSQL matrix completed; a file cannot contain the hash of the commit that contains it, so §L gives the property to verify (`git diff <tip> <session-branch>` is empty) alongside the literal hashes.

---

## B. Phase A — compatibility findings

Executed read-only, before any branch was touched. Full record: `evidence/phase-a-assessment.txt`.

1. **Zero file overlap.** A1 touched 25 files (12 `src/`, 5 `test/`, 5 `docs/`, 2 new specs, 1 test guard); A2 touched 12 files, **all** under `apps/admin-web/`. Intersection: **0**. A1 changed no Admin Web file; A2 changed no backend file — the requirement was verified by diff, not assumed.
2. **No dependency or migration surface.** Neither side changed `package.json` or `package-lock.json`; neither added a migration. There is therefore no migration-order dependency and no lockfile reconciliation.
3. **Contract comparison — 11/11 endpoints real.** Every endpoint A2 consumes exists on the backend (`events`, `templates`, `templates/preview`, `changes`, `changes/:id`, `changes/:id/execute`, `provider-status`, `provider-config`, `proposals` + approve/reject/activate, `test-send`, `deliveries`, `outbox-receipts`). A2's three `/changes` bodies match the server's strict `onlyKeys` allowlists **exactly** (CONFIGURATION / TEMPLATE / TEMPLATE_ROLLBACK). Response envelopes match (`{items:[…]}` vs `{data,…}`); A2 additionally parses defensively, so envelope drift is tolerated rather than fatal.
4. **One contract subtlety found and checked, not assumed.** The backend rejects an empty body sent with `Content-Type: application/json`. A2's primary execute path sends **no body and no content-type** (verified: `api-client.ts` only sets the header when a body exists) and its retry path sends `{}`. Both were executed against the real backend: no-body → **200 applied**; `{}` after consumption → **409 already consumed**. No incompatibility.
5. **A2's claim that the EMAIL deliveries filter is live** was checked against the baseline rather than trusted: `VALID_CHANNELS = {SMS, PUSH, EMAIL}` is already present at `019de99` (an earlier Arena 3 widening). Confirmed true.
6. **Security direction of the incoming work.** A1 tightens only: support messages now require an explicit `isInternal:false` **and** re-verify the committed message/author/ticket/recipients under share locks; environment-only external providers were removed (env credentials no longer mark a channel enabled); diagnostic identifiers are sanitised at write, read, log and outbox-payload boundaries; the credentials response now carries a truthful `deliveryStatus`. No new permission string, no role-function grant, no authorization catalogue change on either side.

**Phase A verdict: PASS → integration authorised.** No material incompatibility, unverified commit, scope expansion or security regression was found.

---

## C. Integration diff and inventory

**37 files changed, +4,144 / −979** versus the baseline — exactly the union of the two authorised commit sets (25 + 12), verified by diffing the file sets (`diff` of union vs integrated = empty; no extra, no missing file).

| Group | Files |
|---|---|
| Backend source (`src/`) | 12 — `admin-notification-provider.controller.ts`, `admin-notification.controller.ts`, `admin-customer-credentials.controller.ts`, `common/sensitive-data-redaction.ts`, `notification/brevo-email-provider.ts`, `notification/notification-dispatcher.service.ts`, `notification/notification-event-map.ts`, `notification/notification-provider-config.service.ts`, `notification/notification-template.service.ts`, `notification/notification.types.ts`, `operations/outbox.service.ts`, `support/support.service.ts` |
| Backend tests | 5 modified integration specs (`notification-reliability`, `v1-005`, `v1-006`, `v1-email-notification-01`, `v1-customer-credentials-01`) + **2 new** unit specs (`mission-25c-provider-routing`, `mission-25c-notification-diagnostics`) + `test/support/mission-25c-network-guard.cjs` |
| Mission docs | 5 Arena 1 documents (25A audit + evidence, 25C remediation + evidence, Arena 2 contract) |
| Admin Web source | 8 — `NotificationManagementScreen`, `NotificationTemplateWorkspace`, `ProviderConfigurationWorkspace`, `ApprovalsScreen`, `CustomerPersonalInformationPanel`, `SystemHealthScreen`, `services/notification-domain.ts`, `services/notification-management-api.ts` |
| Admin Web tests | 4 modified suites (notification-management, provider-configuration, customer-personal-information, menu-visibility-11-roles) |

No integration-specific correction was required or made. Nothing was force-pushed, rewritten or discarded; no Arena 1 or Arena 2 branch was modified.

---

## D. Test results — actual counts, exit codes, and what was *not* run

| Gate | Result | Exit |
|---|---|---|
| Backend unit/regression (`npx jest --runInBand`) | **228 suites / 2,701 tests, 0 failed** | 0 |
| PostgreSQL integration matrix (9 batches, serial) | **131 suites / 2,433 tests, 0 failed, 0 skipped** | 0 |
| Backend `tsc --noEmit` | clean | 0 |
| Backend `npm run build` | `dist/main.js` | 0 |
| Admin Web `tsc --noEmit` | clean | 0 |
| Admin Web Jest | **37 suites / 284 tests, 0 failed** | 0 |
| Admin Web `vite build` | 380 modules transformed | 0 |
| Notification API matrix (real HTTP, compiled build) | **61 / 61** | 0 |
| Notification console real-browser suite | **57 / 57** | 0 |
| Customer preferences real-browser suite | **8 / 8** | 0 |

Deltas versus the Mission 23 baseline: unit **+2 suites / +51 tests** (exactly the two Mission 25C specs); Admin Web **+8 tests, same suite count** (Mission 25D extends four existing suites); PostgreSQL **same 131 suites, +6 tests**. No suite appeared, disappeared or was skipped in any runner.

**Skips and limits, stated plainly:** no test anywhere in this mission was auto-skipped, and there are no `test.skip` additions in the integrated diff. What this mission did **not** do: no live SMS/email was sent; no vendor account, sender-domain, DNS or receipt path was exercised; the provider "verification" and "test-send" flows were exercised only against the local console and against a deliberately unconfigured external provider (fail-closed path), never against a real vendor.

---

## E. Independent verification of the 25C / 25D remediations

| Finding | Verified here |
|---|---|
| **H-01** env→governed routing bypass | **FIXED, proven on the integrated build.** With `robase`/`brevo` credentials valid-shaped in the environment and **no governed row**, `provider-status` reports `source: ENVIRONMENT` but `enabled:false`, `configured:false`, `lifecycleState: NOT_CONFIGURED`, all gates false, and `test-send` returns **400 `PROVIDER_NOT_CONFIGURED`** for SMS and EMAIL. No outbound connection attempted. A malformed/missing key refuses at **startup**. Evidence: `evidence/failclosed-external-provider.txt` |
| **H-02** diagnostic identifier leakage | **FIXED at the boundaries.** Delivery/outbox projections sanitise `eventType/eventKey/aggregate*/correlationId/causationId`; unknown shapes project `[REDACTED]`/null. Observed in HTTP responses and in the console (recipients render truncated, never a raw phone). |
| **H-03** support visibility / recipient binding | **FIXED, exercised end-to-end.** A legacy `support.ticket.message_added` fact **without** `isInternal:false` was classified **QUARANTINED / SUPPORT_VISIBILITY_UNKNOWN** by the real consumer and produced **zero deliveries**. |
| **H-04** deposit/withdrawal | **Correctly still blocked.** All four event types are absent from the catalogue; a `CONFIGURATION` change for `deposit.completed` is refused 400 "Unknown notification event"; facts for `deposit.completed` and `withdrawal.failed` were classified **QUARANTINED / EVENT_TYPE_UNSUPPORTED** with **zero deliveries**. |
| **H-05** credential-delivery truthfulness | Present in the response contract (`deliveryStatus` ∈ `NOT_CONFIRMED|SIMULATED|PROVIDER_ACCEPTED` + notice); covered by the modified `v1-customer-credentials-01` integration suite in the PG matrix. |
| **H-06** trigger-lock disagreement | **Recorded, not fixed — and now shown to matter.** See §G.1. |
| **H-07** secret binding | **Unresolved. No claim made.** See §G.2. |
| **M-01** support status `to` | Covered by the PG suite; template renders allowlisted status only. |
| **M-04** read-only auditor preview | Preserved. Security preview refused (400). Read-only control rendered **disabled** with `title="Requires notification.manage_configuration"`. |
| **M-05** `UNKNOWN`/`DEAD` filters | **FIXED in Admin Web.** Both states are now present in the console's status treatment. |
| **25D F-01…F-13** | Confirmed by behaviour, not by claim: zero background 4xx/403 for **all 11 roles**, scoped rendering for the partial-access role, approve→execute applied through the UI, no false success messaging, secret-free provider surfaces. |

**Notification dispatch / idempotency / quarantine / failure handling** are covered by the PostgreSQL matrix (`notification-reliability`, `v1-005`, `v1-006`, `v1-email-notification-01`) and independently by the live quarantine run above. **Governance audit attribution** was read out of the database: `NOTIFICATION_CHANGE_REQUESTED` is attributed to the **maker's** principal with the action fingerprint, while `NOTIFICATION_CONFIGURATION_CHANGED` is attributed to the **checker's** different principal plus the `approvalId` — maker and executor are separately attributable. **Template preview and variable validation**: positive preview returns synthetic samples with `variablesUsed`; a body containing `{{otp}}`/`{{api_key}}` is refused 400 "Unsafe notification content"; an unexpected request field is refused 400 "Unexpected request field".

---

## F. Security regression results

| Property | Result |
|---|---|
| Provider fail-closed without governance | **PASS** — 400 `PROVIDER_NOT_CONFIGURED`, no egress (§E H-01) |
| Console simulation never promotes readiness | **PASS** — `lifecycleState: CONSOLE_ONLY`, gates all false, `deliveryTested` not promoted |
| Secrets never in provider responses or DOM | **PASS** — no key-shaped string in API payloads or in either provider panel |
| Test-send destination masked | **PASS** — `+**********000` in response, in audit, and in the UI |
| SECURITY events locked server-side | **PASS** — `locked:true`, `editable:false`, template read/preview/change all refused 400 |
| Read-only principal cannot manage configuration | **PASS** — control disabled + titled with the missing function |
| Maker ≠ checker | **PASS** — self-approval refused **403**; execute before approval refused **400**; replay after consumption **409** |
| Console permissions across 11 roles | **PASS** — full: SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS; approvals-only: FINANCE_CONTROLLER (deliveries/receipts **403**); none: the remaining seven |
| Background 400/403 (N-02 / N-04) | **PASS — 0 across all 11 roles**, and 0 across a deep multi-tab session as SUPER_ADMIN and as FINANCE_CONTROLLER |
| No unauthorized messages from blocked facts | **PASS** — quarantined facts produced **0** delivery rows |
| Destination/identifier exposure in UI | **PASS** — recipients truncated, no raw phone numbers rendered |
| Financial / agent boundaries | Not modified by either arm; covered by the PG matrix (§D). |

One correction I want on the record: three assertions in my first browser run and three in my first API run failed. **All six were defects in my harness**, not in the product — an empty-body request I sent with a JSON content-type that Admin Web never sends; a table-presence check on surfaces that correctly render an empty state; a receipts "tab" that is actually a section; a `textContent` match that picked up the status `<select>` option labels; and treating a correctly **disabled** button as a false promise. I re-ran each with the assertion fixed and verified the underlying behaviour at row/element level rather than declaring the first number. Final numbers above are from the corrected runs.

---

## G. Unresolved findings and policy dependencies

### G.1 H-06 — the trigger-lock disagreement is an enforcement gap, not a label

Verified on the integrated build:

| Event | Backend (`notification_event_configurations`) | Admin Web (static catalogue) |
|---|---|---|
| `customer.funding.approved` | `is_locked=false`, editable, v1 | `toggleLocked=true` |
| `customer.funding.rejected` | `is_locked=false`, editable, v1 | `toggleLocked=true` |
| `transfer.completed` | `is_locked=false`, editable, v1 | `toggleLocked=true` |

The console computes its lock as *registry lock (authoritative) OR static baseline lock*. For these three events only the **static** half applies — so the lock exists only in the browser.

**Demonstrated consequence (probe run, then deliberately left unapproved and unexecuted):** `POST /internal/notifications/changes {type: CONFIGURATION, eventType: "customer.funding.approved", channel: SMS, enabled: false, expectedVersion: 1, …}` → **201 CREATED** with an approval ID. A maker can therefore open a governed proposal to disable a notification the console presents as policy-locked, and a checker can approve and execute it.

- **What this is:** a governance/policy enforcement gap. The UI lock is presentation, not an authorization boundary.
- **What this is not:** privilege escalation — the actor still needs the maker permission, MFA, and an independent checker.
- **Contrast:** the three SECURITY events *are* server-enforced (`is_locked=true`, template operations refused server-side). Only the D-N8 funding/transfer claim is UI-only.
- **Not changed here.** Which of the two interpretations is authoritative is a product/governance decision (D-N8). Either the backend must seed/enforce those locks, or the console must stop claiming them. **Arena 3 records this; it does not pick.**

### G.2 H-07 — ENV_SECRET approval binding (unresolved security finding)

The four-character display fingerprint does not cryptographically bind a mutable environment secret to checker approval: activation and sends re-read environment material, so the secret can change outside the approved proposal. **Nothing in this mission claims otherwise**, and the integrated UI presents fingerprints as display-only ("masked 4-character fingerprints are displayed here"). No secret-rotation policy was invented. **This must be resolved before any live external provider use.** Recommendation: a separately reviewed secret-binding/rotation design.

### G.3 H-04 — deposit/withdrawal notification policy

`deposit.completed`, `deposit.failed`, `withdrawal.completed`, `withdrawal.failed` remain **policy-blocked**. Verified they are absent from the catalogue, refused at the change-request API, and quarantined (`EVENT_TYPE_UNSUPPORTED`) with zero deliveries. No recipient, channel or disclosure rule was invented. This needs a product/security decision.

### G.4 Deferred functionality — explicitly not delivered

PUSH delivery (no token/provider path; `push.available=false`), customer opt-out editing, manual delivery retry execution (the control exists but is a request/audit affordance, not a delivery retry), marketing broadcasts, bounce/complaint automation and receipt ingestion, independent in-app notification policy (M-02), Agent contact resolution (M-03), and stored preference→producer wiring (M-06) **remain deferred**. Nothing here should be read as these being complete.

### G.5 Additional divergence found during verification (new, recorded)

**Customer notification preferences:** the Admin Web deliberately shows a "Preference visibility is restricted" notice to `CUSTOMER_SERVICE` and issues **no request**, while `GET /customers/:id/preferences` returns **200** for that same role over HTTP. The UI is the stricter of the two; the endpoint would serve the data if called directly. Same family as G.1 (UI-only policy), lower severity (read of preference flags, `customer.view`-gated). Not changed here.

---

## H. Confirmation of boundaries

- **No live SMS or email was sent.** Every send path in this mission was either the local console (simulation), a suppressed/skipped delivery, or a fail-closed 400. The integration tests ship a test-only egress guard (`test/support/mission-25c-network-guard.cjs`) restricting sockets to loopback; the real-browser and HTTP verification ran against a disposable database on that same loopback.
- **No production deployment**, no `main` merge, no provider activation, no credential activation, no DNS or vendor changes.
- **No unauthorized financial, security or product-policy change.** No permission, role grant, migration, financial posting path or notification policy was added. The only configuration *values* changed during verification were a single ordinary trigger toggled **through the governed maker-checker path** and restored through the same path; the disposable database was never treated as production.
- **No invented notification behaviour.** Unsupported events were quarantined, not mapped.
- The accepted Ordinary Agent V1 baseline is preserved: 228 backend suites, the full PostgreSQL matrix, and the Admin Web suite are green, including the D-01 agent-read guards and workforce maker-checker suites.

---

## I. Verdict

**CONDITIONAL PASS — WITH EXPLICIT LIMITATIONS.**

**Technically:** the integration is correct and independently verified. Both remediations are present, the merged set is exactly the authorised union (37 files, 0 conflicts, 0 out-of-scope files), every gate is green, the 11-role authorization model and maker-checker separation behave correctly end-to-end in a real browser, and the provider/credential paths fail closed when governance is absent — the single most important property of Mission 25C.

**As production readiness:** this is **not** a statement that the notification system is complete or safe to switch on. Four things stand between this branch and live use, and none of them is an integration defect:
1. **H-07** — secret binding/rotation must be designed and reviewed (blocks any `ENV_SECRET` production use).
2. **H-04** — deposit/withdrawal recipient/channel/content policy must be decided.
3. **H-06** — the funding/transfer lock must be enforced on one side or the other; today the console's claim is not enforced by the server.
4. **Deferred capabilities** (§G.4) remain deferred.

**Recommendation to Arena 4: accept the integration for independent security review, with G.1–G.5 carried as explicit limitations.** Do not treat this branch as approved for live provider activation.

---

## J. Reproduce

```bash
git worktree add -b integration/mission-25e-notification-integration <dir> 019de996950b07e9312af455ce0d9b840e6e14f1
cd <dir> && npm ci
git merge --no-ff 9fc00b104d3ca5cdd1141048d76e7d799cafd9aa   # Arena 1, 0 conflicts
git merge --no-ff e99f5f83a0ca8bc09cbfb4787923106e12f158cc   # Arena 2, 0 conflicts
(cd apps/admin-web && npm ci)

npx jest --runInBand                                          # 228 / 2,701
node scripts/embedded-pg.js && node scripts/prepare-pg-test-env.js --force
PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg           # 131 / 2,433
npx tsc --noEmit && npm run build
(cd apps/admin-web && npx tsc --noEmit && npx jest && npm run build)

# disposable database, then real HTTP + real browser
node /tmp/mkdb.cjs monienaija_e2e && DB_NAME=monienaija_e2e npm run migration:run
DB_NAME=monienaija_e2e NODE_ENV=development node scripts/local-dev-seed-11-roles.js
DB_NAME=monienaija_e2e NODE_ENV=development node dist/main.js
env -u ADMIN_WEB_API_BASE_URL npm run dev --prefix apps/admin-web -- --host 0.0.0.0

node evidence/harness/m25e-api.cjs                            # 61/61
node evidence/harness/m25e-browser.cjs                        # 57/57
```

Chromium for the browser runs was sourced from the npm registry (`@sparticuz/chromium@153.0.0`, brotli payloads plus its `al2023` shared-library bundle, giving **Chromium 153.0.8010.0**) because the Playwright CDN is unreachable from this sandbox. It is a real browser, launched with `--no-sandbox` and driven by Playwright.

**Evidence:** `evidence/` — `phase-a-assessment.txt`, `integration-inventory.txt`, `unit-test-summary.txt`, `pg-matrix-summary.txt`, `build-toolchain-summary.txt`, `failclosed-external-provider.txt`, `quarantine-and-deliveries.txt`, `h06-and-divergences.txt`, `governance-audit-attribution.txt`, `template-preview-and-variable-validation.txt`, the raw `*results.json` / role matrix / H-06 probe JSONs, the four harnesses, and **26 screenshots** (11 role consoles + provider/deliveries/receipts/approvals/preferences states).

---

## K. What I would hand to Arena 1 and Arena 2 next (not part of this mission)

- **Arena 1 / governance:** decide H-06 direction; if D-N8 requires those three transactional events to be non-disableable, enforce `is_locked` server-side rather than relying on the console.
- **Arena 1 / security:** design the H-07 secret-binding and rotation mechanism.
- **Arena 2:** align the customer-preferences visibility policy with the backend (G.5), or document the intentional restriction.
- **Product:** approve or reject the H-04 deposit/withdrawal contract.

---

## L. Pins

| Ref | How to verify |
|---|---|
| `integration/mission-25e-notification-integration` | the **verified tip** — every gate in this report ran on this tree. Its literal SHA is the last non-merge commit's parent lineage on the branch; read it with `git rev-parse` rather than from this file. |
| Arena 1 merge | `d2ff64f` — stable, will not move |
| Arena 2 merge | `762629e` — stable, will not move |
| Baseline | `019de996950b07e9312af455ce0d9b840e6e14f1` — stable |
| Session mirror `arena/8e59e188-monienaija` | carries **exactly this tree**: `git diff <integration-tip> origin/arena/8e59e188-monienaija` is empty |

A file cannot contain the hash of the commit that contains it, so the tip is pinned by that verifiable property instead of by a number that would be stale the moment it was written.
