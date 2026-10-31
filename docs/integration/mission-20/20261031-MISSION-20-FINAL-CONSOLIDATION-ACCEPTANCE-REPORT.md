# MISSION 20 — Final Ordinary Agent V1 Consolidation and Acceptance Verification

**Arena:** 3 (integration owner)
**Date:** 2026-10-31
**Branch:** `integration/mission-20-ordinary-agent-v1-final` @ `6027c4689791d10f84bcbda19f4231f509583f3d`
**Merge commits:** `a4121f4` (Arena 1) → `aa894cb` (Arena 2) → `6027c46` (verification + this report)
**Baseline:** `integration/mission-17-ordinary-agent-v1-acceptance` @ `bee4c00d1458128f3cc1e6d745983a16e3fc0ad8`
**Verdict: PASS — recommend Arena 4 final technical acceptance.** Both target defects (K-01, N-01) are independently verified resolved, with no regression in any previously closed correction and no loss of any Mission 17 fix.

---

## 1. Integrated commits

| Source | Commit | Content |
|---|---|---|
| Arena 1 — Mission 19A | `2d5ab3a339995522d585ada427b0b6d11f43bc82` | K-01 correction: `runtime-access.guard.ts`, `workforce-session.service.ts` + 3 test files |
| Arena 1 — handoff | `3e66a31a2f327fd0e5fa5891a13975ab61eb3d72` (branch tip) | `docs/integration/mission-19/…HANDOFF.md` + sanitized evidence `.txt` |
| Arena 2 — Mission 19B | `f9884ccced5f2124caaec8b6a590ddf6443aa879` | N-01 correction: `admin-shell.css` + new shell test |

**Ancestry checked before merging.** Each branch tip sat directly on the Mission 17 baseline — Arena 1 by exactly two commits (`git rev-list --count bee4c00..origin/arena/92fd33dd` → 2), Arena 2 by exactly one — so no unrelated work could be carried in by a merge. The two diffs share **no files** (`comm -12` empty).

### Changed-file summary (9 files vs the Mission 17 baseline)

```
apps/admin-web/__tests__/m1-shell-sidebar-scroll-n01.test.tsx   | 370 +++++++++ (new)
apps/admin-web/src/screens/authenticated/admin-shell.css        |  40 ++-   (N-01)
docs/integration/mission-19/…MISSION-19A-WORKFORCE-LOGOUT-HANDOFF.md | 58 +++
docs/integration/mission-19/evidence/workforce-logout-http-status.txt | 56 +++
src/authorization/runtime-access.guard.ts                       |  22 +-
src/authorization/workforce-session.service.ts                  |  16 +-     (K-01)
test/mission-19a-workforce-logout.guard.spec.ts                 | 125 +++++ (new)
test/mission-19a-workforce-logout.integration.spec.ts           | 274 +++++++ (new)
test/workforce-session-principal-type.spec.ts                   |   1 +
```

No migration, no capability seed, no role/function grant, and **no file carrying a Mission 16/17 fix** was modified. The only Admin Web source change is presentation CSS.

---

## 2. How each correction works (reviewed, not assumed)

**K-01 (Arena 1).** The blanket `denyUnsafeMethodForReadOnlyPrincipal` check blocked the logout the UI already performs. The guard now skips *only that method check* for a `DELETE` whose decoded `params.id`, the principal's own `sessionId`, and the exact raw path (`/api/v1/internal/a2/workforce/sessions/<id>`, query string excluded) all agree, **and** only when the bearer was validated by the A2 workforce service (a SUPPORT fallback cannot claim it). Route policy, the controller, the DTO and the service's ownership check still run. Separately, `validate()` no longer `save()`s a stale entity — it issues a status-conditional update and **fails closed if no row was affected**, and the expiry transition is likewise conditional. That is the race fix: a validation that read `ACTIVE` can no longer write `ACTIVE` back over a concurrent revocation.

**N-01 (Arena 2).** The sidebar itself no longer scrolls; `.mn-nav` becomes the single scroll region (`flex: 1 1 auto; min-height: 0; overflow-y: auto`) and the logout panel is taken out of that context (`flex-shrink: 0`, own top border and background). The same treatment is applied to the compact drawer, plus a `max-height: 420px` fallback. Presentation only — no nav item, route, guard or permission changed.

---

## 3. K-01 — independently verified over real HTTP (6/6)

Harness `harness/m20-k01.cjs`: genuine password logins for every role, real bearer tokens over TCP against the running backend on the disposable `monienaija_e2e` database, plus **direct read-only PostgreSQL inspection** of `a2_workforce_sessions` so the stored state is proven, not just the HTTP status. Nothing is mocked.

| Check | Result |
|---|---|
| **K01-1** FINANCE_AUDITOR revokes its **own** current session | read before = **200**, `readOnlyPrincipal=true`, `DELETE` = **200** |
| **K01-2** revoked bearer immediately returns **401** | read after = **401**, stored row = **REVOKED**, `revoked_at` set |
| **K01-3** cross-session revocation stays denied | sibling session → **403** (survives: 200/ACTIVE), other principal → **403** (survives: 200/ACTIVE), unknown id → **403** |
| **K01-4** unrelated unsafe methods stay denied | 4/7 candidate routes proved reachable *and* discriminator-valid, **all four → 403** for the auditor |
| **K01-5** validation race cannot resurrect a revoked session | 12 interleaved trials: logout 200 in all, stored status **REVOKED in 12/12**, every post-revocation read **401** |
| **K01-6** the other ten roles keep their logout behaviour | all ten: read 200 → logout **200** → replay **401** → stored **REVOKED** |

**K01-4 methodology (important).** My first version simply asserted "403" on a fixed probe list and produced a false negative: one probe URL did not exist (404) and one failed authentication before the read-only check (401). I rebuilt the check so each probe is first exercised as **SUPER_ADMIN** to prove the route is genuinely reachable for a non-read-only principal, and only then required to be 403 for the auditor. The strongest row is `DELETE /internal/a2/workforce/sessions/:id` → **admin 200 vs auditor 403**: the very route that now succeeds for the auditor's *own* session still denies a sibling session, which isolates the exception to self-revocation. (Probe side effect: `POST /internal/agents/classes` created one inactive class named `probe` in the disposable test database. No production data involved, and no database was reset.)

**K01-5 caveat, stated plainly.** My HTTP-level race check is *statistical* — it creates a real interleaving 12 times and asserts the invariant each time; it cannot prove atomicity. The deterministic proof is Arena 1's committed integration test (`test/mission-19a-workforce-logout.integration.spec.ts`), which drives a controlled PostgreSQL interleaving, and it **passes in the full matrix below**.

---

## 4. N-01 — independently verified with real Chromium pointer input (188/188)

Harness `harness/m20-n01.cjs`. Every authorized navigation item is opened by a **plain mouse click**: no `force: true`, no keyboard activation, no synthetic events, no per-item `scrollIntoView`, no retry-on-failure. Playwright's hit-target check ("element intercepts pointer events") therefore turns an obscured item into a **failed click** rather than a silent pass.

All 11 roles logged in through the real form with their **own original credentials** from `scripts/local-dev-seed-11-roles.js` (no SUPER_ADMIN stand-in, no injected token), at four viewports:

| Viewport | Checks | Pointer clicks opening a real screen | Blocked walks |
|---|---|---|---|
| 1500×1000 desktop rail | 46/46 | 98 (11 roles) | none |
| 1280×720 smaller rail | 46/46 | 98 | none |
| 1024×620 shortest rail | 46/46 | 98 | none |
| 480×860 compact drawer | 46/46 | 98 | none |

**392 pointer clicks total, zero blocked.** Per role and viewport the harness also asserted the dashboard template the backend served for that role, the sidebar set equal to its least-privilege matrix (missing *and* over-granted items both fail), that logout is pointer-reachable and returns to the login form, and that no uncaught JavaScript error occurred.

**The exact Mission 17 regressions — now clickable at every viewport:**

| Role → item | 1500×1000 | 1280×720 | 1024×620 | drawer 480×860 |
|---|---|---|---|---|
| SUPER_ADMIN → 5.4 Product Catalogue | **OK** | **OK** | **OK** | **OK** |
| SUPER_ADMIN → 5.5 Limit Catalogue | **OK** | **OK** | **OK** | **OK** |
| FINANCE_AUDITOR → 5.6 Limit Assignments | **OK** | **OK** | **OK** | **OK** |

### 4.1 Negative control — the suite demonstrably goes red

A green pointer suite is worthless if it cannot fail. Using the **identical script, browser and credentials**, and changing only `admin-shell.css`:

| Stylesheet being served | Product Catalogue | Limit Catalogue | Limit Assignments |
|---|---|---|---|
| Baseline (Mission 17) | **BLOCKED** | **BLOCKED** | **BLOCKED** |
| Mission 19B (this branch) | OK | OK | OK |

The Mission 17 CSS reproduced the defect exactly ("`locator.click: Timeout`" — the logout panel intercepting the pointer), and the corrected CSS resolves it. Evidence: `n01-negative-control-baseline-m17-css.json` / `…-fixed-19b-css.json`.

---

## 5. Full regression (all from my own execution on the merged tree)

| Gate | Command | Result |
|---|---|---|
| Backend unit | `jest --runInBand` | **225 suites / 2,632 tests passed**, exit **0** |
| **Complete PostgreSQL matrix** | `PG_TEST_CONCURRENCY=1 npm run test:pg` | **131 suites / 2,427 tests passed**, 9/9 batches, exit **0** |
| TypeScript (backend) | `tsc --noEmit` | exit **0** |
| TypeScript (admin-web) | `tsc --noEmit` | exit **0** |
| Admin Web tests | `npm test` | **37 suites / 276 tests passed**, exit **0** |
| Admin Web build | `vite build` | exit **0**, 380 modules; bundle fail-closed (**0** × `api/v1`, **0** × `localhost`) |
| Backend build | `npm run build` | exit **0** |
| Ordinary Agent V1 browser E2E | `m20-e2e.cjs` | **15/15** |
| API + authorization matrix | `m20-api.cjs` | **68/68** |
| K-01 real HTTP | `m20-k01.cjs` | **6/6** |
| N-01 real browser | `m20-n01.cjs` | **188/188** |

Deltas vs Mission 17 are exactly the added regressions: unit +1 suite / +23 tests, PG +1 suite / +8 tests, admin-web +1 suite / +3 tests. Every previously closed suite still passes, including `a22-admin-foundation` (D-01), `mission-16a-agent-read-authorization` (D-01) and `mission-15a-management`.

---

## 6. Previously closed corrections — rechecked, still good

| Item | Evidence on this branch |
|---|---|
| **D-01** agent read 401/403 contract | `a22-admin-foundation` and `mission-16a-agent-read-authorization` **PASS** in the full PG run |
| **D-02** outlet/terminal metadata save | E2E-07 `PATCH /internal/outlets/:id → 200`; E2E-08 `PATCH /internal/terminals/:id → 200` |
| **D-03** revocation count + nested worker shape | E2E-09 revoke `→ 200` with the true count; E2E-10 `expiry-status → 200` with `worker{configuredEnabled:false,…}` |
| **D-04** approved-Agent activation | E2E-05 completed review → approve → **activate** in the browser |
| **AW-01** local start without the env var | Vite started with `env -u ADMIN_WEB_API_BASE_URL`; login through its proxy **HTTP 201**; all 15 E2E steps and all 188 N-01 checks ran through that path; production bundle still fail-closed |
| **K-01 / N-01** | §3 / §4 |

---

## 7. Policy-disabled functionality — verified still disabled

- **Cash-to-Cash expiry worker stays OFF:** `GET /internal/admin/cash-to-cash/expiry-status → 200` with `worker = {configuredEnabled:false, schedulerRunning:false, tickInProgress:false}`. No refund, release or journal disposition exists on this surface; nothing was activated.
- **No PIN reset/unlock route:** `POST /internal/admin/agents/:id/pin/reset → 404`, `POST /internal/agents/:id/pin/unlock → 404`, `POST /internal/admin/cash-to-cash/expire-now → 404`.
- **Security notifications remain non-templatable:** `GET /internal/notifications/templates?eventType=customer.registration.phone_verification… → 400 "Security notifications cannot use editable templates"`.
- **GOV-01 preserved:** `capability.seed.ts` still carries `apiStatus/adminUiStatus = NOT_EXPOSED` for `CASH_TO_CASH_EXPIRY`; `git diff` for that file against the Mission 17 baseline is **empty**. Recorded as a non-blocking governance follow-up, as instructed; the endpoint authorizes on `transaction.view` at both registry and controller, so the stale metadata does not decide access.

---

## 8. Remaining findings

**No blocking finding. No required acceptance test failed.**

| ID | Severity | Status |
|---|---|---|
| **GOV-01** stale `CASH_TO_CASH_EXPIRY` capability metadata | Low, non-blocking | Open by design — governance follow-up for the registry owner. Not touched. |
| **N-02** Notification console pre-fetches template counts for security-classified events, drawing `400` refusals | Low (UI) | Pre-existing, unchanged. The backend control is correct; the console asks for templates it can never edit. |
| **N-03** FINANCE_CONTROLLER's "Agent Network" item opens an explicit "Not entitled … require agent.view" notice plus the funding maker panel | Low, by design | Least-privilege behaviour, no data leak. Recorded (`entitlementNotices=[agents]`), never silently ignored. |
| **N-04** Notification console calls `GET /internal/configuration` → 403 for roles without that function | Low (UI) | Pre-existing, handled cleanly. |

Items N-02…N-04 are pre-existing observations carried from Mission 17; I did not widen the mission to fix them. The N-01 fix is presentation-only and touched no navigation logic.

---

## 9. Methodology note — my own harness defects, corrected before reporting

1. **A would-be false pass in the N-01 harness.** My first run reported 37 failures whose detail was *every nav key missing* for all 11 roles in the three rail viewports. The cause was my own code: `openDrawer()` returns "ready" (`true`) for rail modes, and the viewport selector treated that as "we are in drawer mode", so rail runs read the drawer selector that does not exist. Because that same run also passed ~98 pointer clicks per viewport, the naive reading would have been "the nav set check is flaky, ignore it". It was a real harness bug and I fixed the selector; a check whose failure mode is "reports everything missing" is not evidence of anything.
2. **A false negative in K-01.** Described in §3: asserting a bare 403 on hand-picked probes produced a failure (401/404) that said nothing about the read-only control. Rebuilt with SUPER_ADMIN reachability pre-checks.
3. **The negative control** (§4.1) exists precisely because I did not want to present 188 green pointer clicks without showing the harness can go red on the pre-correction stylesheet.

---

## 10. Reproduce

```bash
# disposable database (never a reset of any existing database)
node -e '…pg Client…CREATE DATABASE monienaija_e2e'
DB_NAME=monienaija_e2e npm run migration:run
DB_NAME=monienaija_e2e NODE_ENV=development node scripts/local-dev-seed-admin.js
DB_NAME=monienaija_e2e NODE_ENV=development node scripts/local-dev-seed-11-roles.js

# suites
NODE_ENV=test LOG_LEVEL=silent ./node_modules/.bin/jest --runInBand
PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg
(cd apps/admin-web && ./node_modules/.bin/tsc --noEmit && npm test && npm run build)

# app, exactly as a developer would start it (no ADMIN_WEB_API_BASE_URL)
DB_NAME=monienaija_e2e NODE_ENV=development node dist/main.js
(cd apps/admin-web && env -u ADMIN_WEB_API_BASE_URL npm run dev -- --host 0.0.0.0)

# evidence
DB_NAME=monienaija_e2e node harness/m20-k01.cjs                 # 6/6
LD_LIBRARY_PATH=/tmp/chrome/lib node harness/m20-n01.cjs        # 188/188
LD_LIBRARY_PATH=/tmp/chrome/lib node harness/m20-e2e.cjs        # 15/15
node harness/m20-api.cjs                                        # 68/68
LD_LIBRARY_PATH=/tmp/chrome/lib node harness/m20-n01-negative-control.cjs <label>
```

Chromium 153.0.8010.0 is extracted from the pinned `@sparticuz/chromium` dependency (Playwright's CDN is unreachable here); `LD_LIBRARY_PATH` must point at its bundled `lib`.

---

## 11. Deliverables and recommendation

**Branch:** `integration/mission-20-ordinary-agent-v1-final`
**Evidence:** `docs/integration/mission-20/evidence/` — `pg-matrix-summary.txt`, `unit-test-summary.txt`, `admin-web-summary.txt`, `k01-matrix.txt`, `n01-matrix.txt`, both negative-control JSONs, `recheck-summary.txt`, `policy-disabled.txt`, `aw-01-transport.txt`, raw `*-results.json`, and 28 screenshots (15 E2E steps + 12 N-01 viewport captures + final states).
**Harnesses:** `docs/integration/mission-20/harness/` (`m20-k01.cjs`, `m20-n01.cjs`, `m20-n01-negative-control.cjs`, `m20-e2e.cjs`, `m20-api.cjs`).

**Recommendation to Arena 4: accept this branch as the final Ordinary Agent V1 technical acceptance candidate and proceed with final technical acceptance.** K-01 and N-01 are resolved and independently demonstrated (with a negative control proving N-01's harness detects the original defect); every previously closed item re-verified; the full PostgreSQL matrix, unit suite, Admin Web suite, type checks and builds are green; policy-disabled functionality is untouched. The only open items are the non-blocking governance record GOV-01 and three pre-existing UI observations that predate this mission and were deliberately left alone.

**Boundaries honoured:** no merge into `main`, no deployment, no provider activation, no existing database reset (a fresh disposable database was created), no credential changes (the original 11-role fixture was used as-is), no product-policy modification, and no push to any Arena branch.
