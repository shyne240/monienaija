# MISSION 17 — Final Ordinary Agent V1 Integration and Acceptance Candidate

**Arena:** 3 (integration owner)
**Date:** 2026-10-31
**Branch:** `integration/mission-17-ordinary-agent-v1-acceptance`
**Baseline:** `integration/mission-16-ordinary-agent-v1` @ `c355430f7d302ed29ada12615092c60ac857c4a5`
**Integrated corrections:**

| Arena | Branch | Commit | Scope |
|---|---|---|---|
| Arena 1 | `arena/92fd33dd-monienaija` | `8a1f6fe937a6e84d668658649559d5623f8e2b73` (D-01) | `src/authorization/*`, 3 test files |
| Arena 1 | same branch tip | `dcac034bf6d37bf5cd4cd747b3ca9c45d336ffe2` (handoff doc — docs only) | 1 markdown file |
| Arena 2 | `arena/ea070127-monienaija` | `f5abc0986b1d80e4780b14516a6583e5f523c59e` (AW-01) | Admin Web config/vite + 1 test file |

**Merge commits on this branch:** `409edaf` (Arena 1) → `93b6007` (Arena 2) → `c1d41f7a2476f0c91bd3051de4e2c2941cc463dc` (verification + this report; the only commit after the merges, and it changes no application code).
**Verdict: PASS — recommend Arena 4 independent acceptance.**

---

## 1. Verdict and recommendation

Every gate required by the mission has been executed on the combined tree and is green, including the **complete** PostgreSQL suite (not a targeted subset) which now passes **130/130 suites and 2,419/2,419 tests with exit code 0** — the single Mission 16 failure (D-01) is closed and the suite that contained it (`a22-admin-foundation`) passes unchanged.

**Recommendation to Arena 4:** accept this branch as the final Ordinary Agent V1 integration candidate for independent acceptance. There is **no blocking defect**. The four open items recorded in §9 are (a) a documented, pre-existing behavior of a read-only principal (K-01), (b) stale governance metadata the registry owner reserved (GOV-01), and (c) three pre-existing Admin Web presentation/hygiene observations (N-01…N-04) that are all present in the accepted baseline and are **not** caused by this consolidation. None of them is a demonstrated security defect, a financial defect, or a functional blocker for the Ordinary Agent V1 workflows.

I did **not** fix, work around, or re-specify any of them, and I did not weaken any assertion to reach a green run (§10 records two of my own harness defects that produced false results before I corrected them).

---

## 2. Integration method — ancestry and diff inspection, not blind merges

Both Arena branches were fetched read-only (no push to, or modification of, either branch) and inspected **before** merging:

```
$ git rev-list --count c355430..origin/arena/92fd33dd-monienaija   -> 2
$ git rev-list --count c355430..origin/arena/ea070127-monienaija    -> 1
```

Each correction is exactly the commit(s) the mission named, sitting directly on the Mission 16 baseline — no unrelated work was carried along. The diff each Arena branch introduces over the baseline:

| Arena 1 (2 commits) | Arena 2 (1 commit) |
|---|---|
| `src/authorization/route-policy-registry.ts` (+3) | `apps/admin-web/src/config/build-config.ts` |
| `src/authorization/runtime-access.guard.ts` (+11) | `apps/admin-web/src/config/index.ts` |
| `test/mission-15a-route-policy.spec.ts` | `apps/admin-web/vite.config.ts` |
| `test/runtime-access.guard.spec.ts` | `apps/admin-web/__tests__/local-dev-api-config.test.ts` (new, 16 tests) |
| `test/mission-16a-agent-read-authorization.integration.spec.ts` (new) | |
| `docs/integration/mission-16/…-MISSION-16A-BACKEND-AUTHORIZATION-HANDOFF.md` (docs) | |

**File overlap between the two corrections: none** (`comm -12` on the two file lists is empty). Both merges applied with `--no-ff` and zero conflicts.

**Total change over the Mission 16 baseline — exactly 10 files:**

```
apps/admin-web/__tests__/local-dev-api-config.test.ts
apps/admin-web/src/config/build-config.ts
apps/admin-web/src/config/index.ts
apps/admin-web/vite.config.ts
docs/integration/mission-16/20261031-MISSION-16A-BACKEND-AUTHORIZATION-HANDOFF.md
src/authorization/route-policy-registry.ts
src/authorization/runtime-access.guard.ts
test/mission-15a-route-policy.spec.ts
test/mission-16a-agent-read-authorization.integration.spec.ts
test/runtime-access.guard.spec.ts
```

No migration, no capability seed, no role/function grant, no financial logic, and no Mission 16 integration fix was modified by these corrections.

---

## 3. D-01 — CLOSED (401 contract restored, no access granted)

**Defect (Mission 16):** `a22-admin-foundation` tests 2–3 expected **401** and received **403** on `GET /api/v1/internal/agents` after Arena 1's new route-policy branch put an `agent.view` catalogue gate ahead of the controller's own 401.

**Arena 1's correction, as reviewed:** a new opt-in flag `rejectNonWorkforcePrincipalWith401` on the route resolution, set **only** for `GET`/`HEAD` on the Agent directory, Agent detail and Agent financial-position. In `runtime-access.guard.ts` the guard returns the controller's established 401 **after** workforce validation and **before** the declared function gate, for `AGENT`/`CUSTOMER`/`AGGREGATOR` principal types.

**What I verified about it (not taken on trust):**

- The flag is scoped to those three read shapes; the registry test asserts `rejectNonWorkforcePrincipalWith401` is `undefined` for Agent transactions, Agent outlets, Agent applications, the customer directory and `POST …/suspend`. So the 401 precedence is **not** global.
- The `agent.view` gate is **not** skipped for workforce principals: the guard test proves an `OPERATOR` without `agent.view` still gets **403 `FUNCTION_MISSING`**, with `evaluate()` called with `requiredFunctions: ['agent.view']` and `authorize()` called once (audit preserved).
- Real non-workforce sessions still get **403** (the genuine Agent/Customer token fallback path is unchanged) — only the synthetic-validator results A22 uses get 401. The distinction is documented in the handoff, and the pre-existing A22 assertions were **not** edited.
- Mission 16's denial-audit flag (`auditDeniedWorkforceFunction`) and the Sprint 3 catalogue-gate comments are intact in the merged guard.

**Closure evidence (my execution, real PostgreSQL):**

| Check | Mission 16 (before) | Mission 17 (after) |
|---|---|---|
| `test/a22-admin-foundation.integration.spec.ts` | FAIL — 2 failed / 13 passed | **PASS** |
| `test/mission-16a-agent-read-authorization.integration.spec.ts` | did not exist | **PASS** (new suite) |
| Complete PG matrix | 128/129 suites, 2,413/2,415 tests, **exit 1** | **130/130 suites, 2,419/2,419 tests, exit 0** |

**D-01: CLOSED.**

---

## 4. AW-01 — CLOSED (local start without hand-set env var, production still fail-closed)

**Defect (Mission 16):** with `ADMIN_WEB_API_BASE_URL` unset, Vite's `define` injected `''`, so the `''` → `/api/v1` dev fallback in `src/config/index.ts` could never execute and local login failed with "Admin API base URL is not configured".

**Arena 2's correction, as reviewed:** `resolveAdminBuildConfig` now distinguishes a **local dev serve** (`command === 'serve'` + `mode === 'development'` + `NODE_ENV !== 'production'`) from a static build. In a dev serve an unset URL resolves to the same-origin `/api/v1`, and `vite.config.ts` attaches a dev-server proxy to `http://127.0.0.1:3000` (`ADMIN_WEB_DEV_PROXY_TARGET` overridable). A `vite build` still resolves an unset URL to `''` and additionally **throws** on a loopback `ADMIN_WEB_API_BASE_URL`.

**Verification (my execution):**

| Check | Result |
|---|---|
| Vite dev server started with `env -u ADMIN_WEB_API_BASE_URL` | started, no error |
| Login through the dev server, no env var — `POST http://127.0.0.1:5173/api/v1/internal/a2/workforce/local-admin-sessions` | **HTTP 201**, `accessToken` present, `principal.roles=[SUPER_ADMIN]`, 66 scopes |
| Real-browser E2E (15 steps) and 11-role sweep (37 checks) | both ran **through that proxy**, no env var set |
| `apps/admin-web` jest | 36 suites / 273 tests pass, incl. `local-dev-api-config.test.ts` (16) |
| `vite build` | success, 380 modules |
| Production bundle fail-closed | `api/v1` occurrences **0**, `localhost` occurrences **0** |
| `tsc --noEmit` (admin-web) | exit 0 |

**AW-01: CLOSED.** The production fail-closed property is preserved, not traded away for the dev convenience.

---

## 5. Mission 16 integration fixes — preserved (verified in the merged tree)

| Fix | Evidence in this branch |
|---|---|
| **D-02** outlet/terminal metadata PATCH no longer sends `code` (was 400 on every save) | `UpdateAgentOutletMetadataInput` / `UpdateAgentTerminalMetadataInput` no longer declare or forward `code`; `updateAgentOutletMetadata` body builder has no `code` line. Live: `PATCH /internal/outlets/:id -> 200`, `PATCH /internal/terminals/:id -> 200` (E2E-07/08). |
| **D-03** revocation count + expiry status shape | `revokedSessionCount` checked first in `revokeAgentActiveSessions`; expiry view reads nested `worker{…}` and `asOf`. Live: `GET /internal/admin/cash-to-cash/expiry-status -> 200`, `worker{configuredEnabled,schedulerRunning,tickInProgress,pollIntervalMs,batchSize}` + `asOf`. |
| **D-04** approved-Agent activation reachable | `canActivateFromApp = APPROVED && (!agentId \|\| linkedAgent.status === 'PENDING')` with the `INTEGRATION FIX (Mission 16)` comment intact. Live: E2E-05 completed review → approve → activate in the browser. |

The Admin Web service file and screen are **byte-identical to the Mission 16 baseline** (`git diff c355430 HEAD -- apps/admin-web/src/screens/authenticated apps/admin-web/src/services` is empty), which is the strongest available statement that nothing was lost in consolidation.

---

## 6. Full regression results (all from my own execution on the merged tree)

| Gate | Command | Result |
|---|---|---|
| Backend unit | `NODE_ENV=test LOG_LEVEL=silent jest --runInBand` | **224 suites / 2,609 tests passed**, exit 0 |
| **Complete PostgreSQL matrix** | `PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg` | **130 suites / 2,419 tests passed**, 9/9 batches, **exit 0** |
| TypeScript (backend) | `tsc --noEmit` | exit 0 |
| TypeScript (admin-web) | `tsc --noEmit` | exit 0 |
| Admin Web tests | `npm test` (jest) | **36 suites / 273 tests passed** |
| Admin Web build | `vite build` | success, 380 modules; bundle fail-closed |
| Backend build | `npm run build` | exit 0 |
| ESLint — files touched by the corrections | `eslint src/authorization/… test/mission-1…` | **exit 0 (clean)** |
| ESLint — repository-wide | `eslint "{src,test}/**/*.ts"` | 1,351 errors / 80 warnings, **all pre-existing**; none in the files this mission touched |

Deltas vs the Mission 16 baseline are exactly what the corrections add: unit +6 tests, PG +1 suite / +4 tests, admin-web +1 suite / +16 tests.

PG batch detail (sequential, own execution): 635 + 290 + 324 + 293 + 267 + 170 + 236 + 154 + 50 = **2,419**.

---

## 7. Real-browser Ordinary Agent V1 E2E — 15/15

Chromium **153.0.8010.0**, Vite dev server (no `ADMIN_WEB_API_BASE_URL`), NestJS from `dist/` on :3000, disposable database `monienaija_e2e`. No mocked responses: every assertion follows a real HTTP round-trip and a real DOM.

| Step | Result | Evidence |
|---|---|---|
| E2E-00 seed Agent (real HTTP) | PASS | agent/outlet/terminal/credential created |
| E2E-01 real browser login | PASS | sidebar rendered |
| E2E-02 Agent Class with canonical services | PASS | listed, selectable for application |
| E2E-03 DRAFT created | PASS | internal ref `AGENT-APP-0DE47ACF`, row in queue |
| E2E-04 edit DRAFT → submit | PASS | row status `SUBMITTED` |
| E2E-05 review → approve → **activate** | PASS | row status `APPROVED`, activation banner |
| E2E-05b agent appears in directory | PASS | `status=ACTIVE` |
| E2E-06 outlet + terminal creation | PASS | both rendered |
| E2E-07 outlet PATCH | PASS | `PATCH /internal/outlets/… -> 200` |
| E2E-08 terminal PATCH | PASS | `PATCH /internal/terminals/… -> 200` |
| E2E-09 credential issue + session revocation count | PASS | `POST …/sessions/revoke -> 200`, true count rendered |
| E2E-10 C2C expiry status (nested worker shape) | PASS | `GET …/expiry-status -> 200`, worker state shown |
| E2E-11 Agent drawer → Agent-filtered Support Tickets | PASS | deep link navigated |
| E2E-12 restricted role blocked, zero forbidden fetches | PASS | `CUSTOMER_SERVICE`: nav hidden, agent reads 0 |
| E2E-13 no false success message on rejection | PASS | 1 non-2xx observed, no false success |

## 8. API / authorization matrix — 68/68

Real HTTP against the running backend with real tokens for 7 synthetic principals: workflow endpoints, permission probes (400/401/403/404/409 exercised), and the cross-role denials. Highlights: `AGENT_NETWORK_MANAGER` outlets **404** (authorized, entity absent — proves the function gate passes) versus expiry **403** (denied); `CUSTOMER_SERVICE`, `COMPLIANCE` and `RISK_FRAUD` denied `agent.view` (403); `FINANCE_AUDITOR` read-only: expiry 200, revoke 403.

---

## 9. All 11 original workforce roles — real browser, original credentials

**No role was replaced, no new credential introduced.** The fixture is the repository's own `scripts/local-dev-seed-11-roles.js` (idempotent, deterministic `MonieNaija_<ROLE>_123!` passwords, manifest written outside the repo with mode 600). Its `--verify` mode reports `login: ok` and `exactRole: true` for all 11 principals, i.e. nine-plus distinct role identities, not one SUPER_ADMIN standing in for everything.

**37/37 checks passed.** For each role, in a real Chromium session: login through the real form → role-specific dashboard template served by the backend and rendered → sidebar nav set **exactly equal** to the committed least-privilege matrix (a missing item *and* an over-granted item both fail) → every visible nav item activated and its screen heading rendered.

| Role | Scopes | Dashboard template (backend → rendered) | Nav items | Screens verified |
|---|---|---|---|---|
| SUPER_ADMIN | 66 | `EXECUTIVE_GOVERNANCE` | 25 | 25/25 |
| FINANCE_PREPARER | 20 | `FINANCE_PREPARATION` | 8 | 8/8 |
| FINANCE_CONTROLLER | 28 | `FINANCIAL_CONTROL_APPROVALS` | 11 | 11/11 |
| FINANCE_AUDITOR | 25 | `FINANCIAL_AUDIT_ASSURANCE` | 20 | 20/20 |
| ADMINISTRATOR | 12 | `WORKFORCE_ADMINISTRATION` | 8 | 8/8 |
| OPERATIONS | 27 | `TRANSACTION_OPERATIONS` | 10 | 10/10 |
| AGENT_NETWORK_MANAGER | 13 | `AGENT_NETWORK_MANAGEMENT` | 5 | 5/5 |
| COMPLIANCE | 13 | `COMPLIANCE_KYC` | 4 | 4/4 |
| RISK_FRAUD | 1 | `FRAUD_CASE_MONITORING` | 2 | 2/2 |
| CUSTOMER_SERVICE | 6 | `CUSTOMER_SERVICING` | 3 | 3/3 |
| TREASURY | 1 | `RECONCILIATION_VISIBILITY` | 2 | 2/2 |

- **98 screen activations** in total; every one rendered its real screen.
- **28/28** navigation keys defined in the shell are reachable by at least one role — no module is orphaned.
- **Logout / login switching:** logout returns to the login form, a page reload does **not** restore a session (storage cleared), and a different role logs in on the same browser context (TREASURY 2 items → SUPER_ADMIN 25 items), then back.
- **No uncaught JavaScript errors** and no unhandled rejections across the entire sweep.
- Every non-2xx response the UI generated was classified and is listed in §9.1; unexplained ones: **0**.

### 9.1 Remaining defects and known follow-ups (recorded, not fixed — out of mission scope)

| ID | Severity | Item | Owning area | Status |
|---|---|---|---|---|
| **K-01** | **Low–Medium** | **FINANCE_AUDITOR server-side logout returns 403** — `DELETE /internal/a2/workforce/sessions/:id` → `403 "Read-only principal may not perform this operation"`, and **the token remains usable afterwards (200)**. The client clears local state and returns to the login screen, so the UI behaves correctly, but the server-side session is **not revoked** and lives until expiry. Measured across all 11 roles: **only FINANCE_AUDITOR** is affected; the other ten revoke correctly (200, token dead with 401). Full matrix in `evidence/logout-matrix.txt`. | Backend authorization (read-only principal policy) | **Known follow-up** — recorded as the mission instructed; `denyUnsafeMethodForReadOnlyPrincipal` is a deliberate control and I did not weaken it to make logout succeed. |
| **GOV-01** | Low | `CASH_TO_CASH_EXPIRY` capability metadata still `apiStatus/adminUiStatus = NOT_EXPOSED` although the read-only status surface exists. Confirmed **untouched** in this tree. Not used for authorization; runtime authorization is `transaction.view` at both registry and controller. | Capability registry owner (Arena 1 reserved) | Known follow-up, unchanged. |
| **N-01** | Medium (UI, pre-existing) | **The sidebar's "Log out session" panel overlays nav items.** `.mn-shell__logout { margin-top: auto }` inside a scrolling flex sidebar whose content overflows makes the logout button sit in normal flow *over* the nav list and travel with the scroll, covering a ~56 px band. At 1500×1000, **SUPER_ADMIN cannot click "5.4 Product Catalogue" or "5.5 Limit Catalogue"** with a pointer (FINANCE_AUDITOR: "5.6 Limit Assignments"). Keyboard (Tab/Enter) works and the screens are correct. Screenshot: `evidence/screenshots/nav-overlap-defect-*.png`. **Pre-existing:** the rule comes from `d7a8af4` (M1 shell) and `admin-shell.css`/`Layout.tsx` are byte-identical to the accepted Mission 16 baseline — it is not caused by this consolidation. | Admin Web shell (Arena 2) | Recorded; did **not** modify M1 presentation CSS during a consolidation mission. |
| **N-02** | Low (UI, pre-existing) | Notification console pre-fetches template counts for security-classified events (`customer.registration.phone_verification`, `customer.credentials.temporary_credential`, `agent.desk.customer_otp`) → `400 "Security notifications cannot use editable templates"` (52 such responses across the sweep, all policy refusals). The backend is correct and the policy-disabled feature is preserved; the console simply asks for something it can never edit. | Admin Web (Arena 2) | Recorded. |
| **N-03** | Low (product/UX, by design) | FINANCE_CONTROLLER's "Agent Network" item opens a screen that renders an explicit **"Not entitled: Agent directory … require agent.view"** notice plus the funding maker panel, because the role holds `agent.fund`/`agent.defund` but not `agent.view`. Deliberate least-privilege behaviour, clearly explained to the operator; no data leak. | Product (nav composition) | Recorded as observation. |
| **N-04** | Low (UI) | Notification console calls `GET /internal/configuration` → 403 for FINANCE_CONTROLLER (no configuration function). Handled cleanly, no leak. | Admin Web (Arena 2) | Recorded. |
| **N-05** | Informational | An in-flight `GET …/dashboard/widgets/reconciliation-status` can receive 401 during a logout/login transition (request made after the token was cleared). Cancelled cleanly; no user-visible error. | Admin Web (Arena 2) | Recorded. |

**Blocking for Arena 4 acceptance: none.** K-01 is a security-hygiene item on a single read-only role; GOV-01 is governance metadata; N-01…N-04 are pre-existing presentation issues that also exist in the accepted baseline.

### 9.2 Unresolved product-policy decisions and policy-disabled functionality — preserved

Verified live on this tree, unchanged:

- **C2C expiry worker remains opt-in and OFF**: `expiry-status` → `worker.configuredEnabled = false`, `schedulerRunning = false`, `tickInProgress = false`; amount-free, audit-only, no refund/journal. No worker was activated.
- **No workforce PIN reset/unlock route**: `POST /internal/admin/agents/:id/pin/reset` and `POST /internal/agents/:id/pin/unlock` → **404** (D6 policy intact).
- **Security notifications cannot use editable templates**: enforced (the 400s in N-02 are that control working).
- **GOV-01 metadata**: untouched.
- **Gate D / production readiness**: not asserted; no deployment, no provider activation, no production database operation, no main merge, no financial-policy change.

---

## 10. Methodology note — two harness defects I found and corrected

Recording this because the numbers above are only meaningful if the harness is honest.

1. **A false pass.** My first 11-role run reported `R-…-03 … 0 screens walked, all headings rendered` as PASS for a role whose nav was empty — a vacuously true assertion. It was fixed by requiring `walked === expected.size`; the passing criterion can no longer be satisfied by doing nothing.
2. **Two wrong selectors.** I looked for `desktop-nav-<key>` testids that do not exist (the rail items are `nav-<key>`) and did not expand collapsed nav groups (items are `hidden` until expanded), and I did not sign out between roles so later "logins" inherited the previous session. All three produced failures that looked like product defects. Corrected before the reported run.

In addition, the run reports `pointerBlocked=[…]` per role rather than silently retrying: those are the N-01 items activated by keyboard instead of mouse, so the overlap defect is visible in the evidence instead of being absorbed by retry logic.

---

## 11. How to reproduce

```bash
# disposable database + migrations
node -e '…pg Client…CREATE DATABASE monienaija_e2e'
DB_NAME=monienaija_e2e npm run migration:run

# fixtures (original 11-role identities, deterministic local-dev credentials)
DB_NAME=monienaija_e2e NODE_ENV=development node scripts/local-dev-seed-admin.js
DB_NAME=monienaija_e2e NODE_ENV=development node scripts/local-dev-seed-11-roles.js
DB_NAME=monienaija_e2e NODE_ENV=development node scripts/local-dev-seed-11-roles.js --verify

# unit + complete PG matrix
NODE_ENV=test LOG_LEVEL=silent ./node_modules/.bin/jest --runInBand
PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg

# run the app exactly as a developer would (NO ADMIN_WEB_API_BASE_URL)
DB_NAME=monienaija_e2e NODE_ENV=development node dist/main.js
cd apps/admin-web && env -u ADMIN_WEB_API_BASE_URL npm run dev -- --host 0.0.0.0

# real-browser evidence
LD_LIBRARY_PATH=/tmp/chrome/lib node harness/m17-e2e.cjs    # 15/15
node harness/m17-api.cjs                                      # 68/68
LD_LIBRARY_PATH=/tmp/chrome/lib node harness/m17-roles.cjs    # 37/37
```

Chromium 153.0.8010.0 is extracted from the pinned `@sparticuz/chromium` dependency (Playwright's CDN is unreachable in this environment); `LD_LIBRARY_PATH` must point at its bundled `lib`.

---

## 12. Deliverables

| Item | Location |
|---|---|
| Final integration branch | `integration/mission-17-ordinary-agent-v1-acceptance` |
| Report | `docs/integration/mission-17/20261031-MISSION-17-FINAL-INTEGRATION-ACCEPTANCE-REPORT.md` |
| PG matrix summary | `evidence/pg-matrix-summary.txt` |
| Unit summary | `evidence/unit-test-summary.txt` |
| 11-role matrix | `evidence/role-matrix.txt`, `evidence/role-results.json` |
| Logout behavior matrix | `evidence/logout-matrix.txt` |
| AW-01 transport + bundle proof | `evidence/aw-01-transport.txt` |
| E2E / API results | `evidence/e2e-results.json`, `evidence/api-results.json` |
| Screenshots (30) | `evidence/screenshots/` — 15 E2E steps, 11 role dashboards, logout/login switching, N-01 overlap defect |
| Harnesses | `harness/m17-e2e.cjs`, `harness/m17-api.cjs`, `harness/m17-roles.cjs` |

**Boundaries honoured:** no merge into `main`, no deployment, no live provider activation, no production database operation, no financial-policy change, no push to any Arena branch, no rewrite of another agent's history, no weakening of a security assertion.
