# Mission 16 — Ordinary Agent V1 Integration, Full Regression & Real-Browser E2E

**Date:** 2026-10-31
**Integration branch:** `integration/mission-16-ordinary-agent-v1`
**Accepted baseline:** `9588329d639ab45b76ffe648ba2ef00951384ca2` (`integration/main-backend-frontend-20261030`)
**Arena 1 (backend) merged:** `arena/92fd33dd-monienaija` @ `c223ff2` (f61adad, 9eb456e, c223ff2)
**Arena 2 (admin web) merged:** `arena/ea070127-monienaija` @ `0c65825`

---

## 1. VERDICT — **PASS with one open defect returned to Arena 1**

Ordinary Agent V1 **is technically integrated and genuinely functional**. Every workflow stage in
the mission brief was exercised against the real backend, real PostgreSQL and a real browser, and
all of it works end-to-end. One pre-existing backend suite now fails as a **direct consequence of
Arena 1's shared authorization-guard change**; the denial itself still holds (no access is granted),
but an established 401 contract became 403. That is returned to Arena 1 rather than papered over.

| Gate | Result |
|---|---|
| Merge of both branches | **Clean — zero conflicts** (disjoint file sets) |
| Backend unit suite | **224 suites / 2,603 tests passed, exit 0** |
| Complete PostgreSQL suite (129 files, 9 batches) | **128 / 129 suites; 2,413 passed / 2 failed, exit 1** |
| TypeScript (`tsc --noEmit`, backend) | exit 0 |
| TypeScript (`tsc --noEmit`, admin-web) | exit 0 |
| Admin Web tests | **35 suites / 257 tests passed** |
| Admin Web production build | **success** (380 modules) |
| Real-browser E2E (Chromium 153, real backend + real DB) | **15 / 15 steps passed** |
| Real-HTTP API + authorization matrix | **68 / 68 checks passed** |
| Integration defects found | **3** (2 fixed here, 1 returned to Arena 1) |

The single failing suite is **not** an Ordinary Agent V1 functional failure: the resource is still
denied to the caller. Details, with reproduction, in §7 (D-01).

---

## 2. Integration approach

Both mission branches were rooted at the accepted baseline (`git merge-base` = `9588329` for both),
so integration was two `--no-ff` merges onto `integration/mission-16-ordinary-agent-v1` created from
`9588329`:

| Merge | Source | Files | Conflicts |
|---|---|---|---|
| 1 | `arena/92fd33dd-monienaija` | 25 (backend `src/`, `test/`, docs) | none |
| 2 | `arena/ea070127-monienaija` | 18 (admin-web `apps/admin-web/`) | none |

Arena 1 touched only `src/` + `test/`; Arena 2 touched only `apps/admin-web/`. **The change sets are
disjoint**, which is why the merges were mechanical. Nothing was rebased, rewritten or force-pushed;
`main` was never touched.

---

## 3. API contract compatibility — verified against running code, not just documents

I read both handoffs and then **verified each contract against the actual controllers** and against
live HTTP responses. This is where all three defects were found: Arena 2 had built its client against
*assumed* response shapes and *assumed* mutation permissions, and its own mock-based tests encoded
those same assumptions, so they passed while the real backend disagreed.

| # | Contract | Arena 1 reality | Arena 2 assumption | Verdict |
|---|---|---|---|---|
| 1 | `PATCH /internal/outlets/:id` body | `UpdateOutletMetadataDto`: `expectedVersion` + `name`/`displayName`/`addressLine`/`city`/`state`/`country`. **No `code`.** `forbidNonWhitelisted: true` | sent `code` on **every** save | **D-02 FIXED** |
| 2 | `PATCH /internal/terminals/:id` body | `UpdateTerminalMetadataDto`: `expectedVersion` + `label`/`serialNumber`. **No `code`** | sent `code` on **every** save | **D-02 FIXED** |
| 3 | `POST .../sessions/revoke` response | `{ agentId, revokedSessionCount }` | read `revokedCount` (+ aliases, none matching) | **D-03 FIXED** |
| 4 | `GET .../cash-to-cash/expiry-status` | `{ asOf, dueCount, oldestDueAt, expiredCount, worker: { configuredEnabled, schedulerRunning, tickInProgress, pollIntervalMs, batchSize } }` | read flat `workerEnabled` only | **D-03 FIXED** |
| 5 | `POST .../applications/:id/activate` precondition | approval creates the Agent in **PENDING**; `agentId` is set at approval | rendered Activate only when `APPROVED && !app.agentId` → **never true** | **D-04 FIXED** |
| 6 | Permission: `GET /internal/agents*` | `agent.view` + OPERATOR/SERVICE/PRIVILEGED (+SUPPORT type, but SUPPORT has no `agent.view`) | gated client-side on `agent.view` | **match** |
| 7 | Permission: outlets/terminals GET vs PATCH | GET `agent.view`; PATCH `agent.manage_outlets_terminals` | same | **match** |
| 8 | Permission: `expiry-status` | `transaction.view` | same | **match** |
| 9 | Permission: `sessions/revoke` | `agent.manage_credentials` | same | **match** |
| 10 | Application create/submit | public + one-time applicant capability | strips token, uses workforce principal | **match** (verified both paths) |

All ten were exercised over real HTTP (evidence: `evidence/api-results.json`).

---

## 4. Integration defects

### D-02 — Outlet/Terminal metadata save returned 400 on every attempt (FIXED, integration-owned)

**Severity: HIGH (feature-breaking).** Admin Web sent `code` in the PATCH body. `code` is not in the
DTO and `src/main.ts` sets `forbidNonWhitelisted: true`, so **every** outlet/terminal metadata save
was rejected `400` before reaching the service. The UI also rendered an editable "Code" field for a
field the API explicitly does not allow changing.

**Fix (frontend + its test):** removed `code` from `UpdateAgentOutletMetadataInput` /
`UpdateAgentTerminalMetadataInput` and from the request bodies, removed the two un-editable Code
inputs and their validation, and corrected Arena 2's own test which had asserted the bad payload.
`code` remains creatable via `POST` (where it *is* supported) — creation was never broken.

**Proof it was a real 400 and is now a real 200:** API-12/API-18 send `code` deliberately and assert
`400`; API-11/API-17 send the corrected body and assert `200` with a version bump. Browser E2E-07 and
E2E-08 save through the UI and assert the observed network call ends `-> 200`.

### D-03 — Session-revocation count and worker state rendered as "unknown" (FIXED, integration-owned)

**Severity: MEDIUM (misleading UI, no data corruption).** Two response-shape mismatches in
`ordinary-agent-admin-api.ts`:
- revocation read `revokedCount`; backend sends **`revokedSessionCount`** → a successful revocation
  of N sessions displayed no count.
- expiry status read flat `workerEnabled`; backend sends a **nested `worker` object** → the console
  could not tell an operator whether the expiry worker was enabled.

**Fix:** both parsers now read the real shape first (aliases retained for tolerance), and the nested
`configuredEnabled` / `schedulerRunning` / `tickInProgress` / `pollIntervalMs` / `batchSize` plus
`asOf` are surfaced. Verified live: API-21b returned `revokedSessionCount=1` after a genuine Agent
login, API-26b returned `worker.configuredEnabled=false`, and E2E-09/E2E-10 assert the values render
in the browser.

**Why Arena 2's tests missed this:** their fixtures used the *assumed* shapes, so the tests were
green against a contract the backend does not implement. Eight regression tests were added in
`apps/admin-web/__tests__/mission16-agent-api-contract.test.ts` that feed the **real** backend shapes.

### D-04 — Agent activation unreachable from the console (FIXED, integration-owned)

**Severity: MEDIUM (workflow dead-end).** `canActivateFromApp = app.status === 'APPROVED' && !app.agentId`.
The backend sets `agentId` **at approval** and creates the Agent as **PENDING**; a separate
`agent.activate` transition is required to reach ACTIVE. So the condition could never be satisfied,
and the Agent drawer offers only Suspend/Terminate/Reactivate — meaning a newly approved Agent was
stuck in PENDING with no UI path to activate it.

**Fix:** activation is offered when the application is `APPROVED` and the linked Agent is not already
known to be ACTIVE; the backend remains the authority (it answers 409 for invalid transitions, and
that error is surfaced rather than swallowed). Verified: E2E-05 now performs review → approve →
activate in the browser, and E2E-05b confirms the Agent then appears **ACTIVE** in the directory.

### D-01 — A22 admin-foundation suite: 401 became 403 (OPEN, returned to Arena 1)

**Severity: MEDIUM (contract/test regression; NOT an authorization bypass).**
`test/a22-admin-foundation.integration.spec.ts` tests 2 and 3 expect **401**; the merged tree returns
**403**. Deterministic — reproduced in isolation: `2 failed, 13 passed, 15 total`.

**Cause (verified in the diff):** Arena 1 added a dedicated route-policy branch for
`GET /api/v1/internal/agents[/:id[/financial-position]]` with `requiredFunctions: ['agent.view']`
and `allowedPrincipalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']`. Those paths previously
fell through to the generic `/api/v1/internal/` rule and rejected a CUSTOMER/AGENT principal as
unauthenticated (401). The new branch recognises the principal and then denies it on type/function
→ 403.

**Why I did not "fix" it:** the change is Arena 1's, the security outcome is unchanged (the resource
is still denied — nothing is exposed), and rewriting a security assertion to accept 403 to obtain a
green run is exactly the kind of weakening this programme forbids. The correct owner decides whether
a) the guard should preserve 401 for non-workforce principals, or b) the A22 contract is formally
re-specified to 403 with the test updated deliberately.

**Reproduce:**
```bash
cd <branch> && NODE_ENV=test PG_TEST_RUN_ID=a22repro \
  LOAD_LIBRARY_PATH=... ./node_modules/.bin/jest --config jest.integration.config.js --runInBand \
  test/a22-admin-foundation.integration.spec.ts
# ● 2. Customer cannot access admin (mock customer workforce token): expected 401, got 403
# ● 3. Agent cannot access admin: expected 401, got 403
```

---

## 5. Verification results (own execution)

### 5.1 Backend unit — complete suite
```
NODE_ENV=test LOG_LEVEL=silent jest --runInBand
Test Suites: 224 passed, 224 total
Tests:       2603 passed, 2603 total        exit 0
```

### 5.2 PostgreSQL — complete suite, not a targeted subset
```
PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg
=== PG integration suite: 9 batch(es), 129 files, concurrency=1 — FAILED ===
Suites: 128 passed, 1 failed (129 total)
Tests:  2413 passed, 2 failed (2415 total)   exit 1
Failing: test/a22-admin-foundation.integration.spec.ts (D-01)
```
Batch detail in `evidence/pg-matrix-summary.txt`. Note the suite count rose 127 → 129 because Arena 1
adds four mission suites (and the runner repartitions).

### 5.3 Static checks
| Check | Result |
|---|---|
| `tsc --noEmit` backend | exit 0, no diagnostics |
| `tsc --noEmit` admin-web | exit 0, no diagnostics |
| ESLint — Arena 1's new backend files (controller, 2 DTOs) | **exit 0, clean** |
| ESLint — legacy services Arena 1 touched (`outlet.service.ts`, `terminal.service.ts`, `agent-lifecycle.service.ts`) | **51 errors — PRE-EXISTING** (Arena 1 documented baseline 61 → current 53; no new rule categories) |
| `vite build` admin-web | success |

Pre-existing lint debt is reported separately from new code: **new code is clean; the failures are
inherited**.

### 5.4 Admin Web
```
jest --watchAll=false
Test Suites: 35 passed, 35 total
Tests:       257 passed, 257 total
```
(Including 8 new contract tests added by this mission and the corrected outlet/terminal payload test.)

---

## 6. Real-browser E2E — actual backend, actual PostgreSQL, actual Chromium

**Environment:** Chromium 153.0.8010.0 driven by Playwright; Admin Web served by the Vite dev server
(same-origin `/api/v1` proxy); NestJS booted from `dist/main.js` against a **dedicated disposable
database** (`monienaija_e2e`, 102 migrations applied from clean). No mocked API responses anywhere —
the harness records every real HTTP call and each assertion reads the live DOM.

| Step | Result |
|---|---|
| E2E-00 Seed Agent + outlet + terminal + credential (real HTTP) | PASS |
| E2E-01 Login against live backend session | PASS |
| E2E-02 Create Agent Class with canonical services | PASS |
| E2E-03 Create Agent application as editable DRAFT | PASS |
| E2E-04 Edit DRAFT then submit into review queue | PASS |
| E2E-05 Review → approve → activate | PASS |
| E2E-05b Activated Agent appears ACTIVE in directory | PASS |
| E2E-06 Create Outlet and Terminal | PASS |
| E2E-07 Outlet metadata PATCH → 200 | PASS |
| E2E-08 Terminal metadata PATCH → 200 | PASS |
| E2E-09 Issue credential; invalidate sessions with real count | PASS |
| E2E-10 Cash-to-Cash expiry status renders worker state | PASS |
| E2E-11 Agent drawer deep-link to Agent-filtered Support Tickets | PASS |
| E2E-12 Restricted role (CUSTOMER_SERVICE) blocked, no forbidden fetch | PASS |
| E2E-13 No false success message on a rejected request | PASS |
| **Total** | **15 / 15** |

Screenshots: `evidence/screenshots/` (16 full-page PNGs, one per milestone).
Machine-readable: `evidence/e2e-results.json`. Harness: `harness/m16-e2e.cjs`.

### Honest note on E2E harness quality
Early iterations of this harness **produced false positives** — assertions like
`/ACTIVE/.test(pageText)` and `/draft/i.test(body)` passed on pages where nothing had happened. I
found them, replaced them with evidence-based assertions (row status must change, the network call
must end `-> 200`, the value must render), and added negative control steps (E2E-12 asserts a
restricted role triggers **zero** Agent reads; E2E-13 asserts no success banner accompanies a failure).
The 15/15 above is from the strict version. A separate diagnostic confirmed the earlier
"passes" would have been wrong.

---

## 7. Real-HTTP API + authorization matrix

**68 / 68 checks passed** (`evidence/api-results.json`). Coverage:

- **Auth:** 401 unauthenticated, 401 malformed token, agent token denied the workforce surface.
- **Lifecycle:** class → application → DRAFT edit → submit → review → approve → activate → Agent ACTIVE.
- **Outlets/Terminals:** create, read, PATCH 200 + version bump, `code` rejected 400, stale version
  409, missing `expectedVersion` 400, missing row 404.
- **Credentials/sessions:** issue (one-time secret), first-login rotation, real session, **revoke → 1**
  and the revoked session then 401, idempotent second revoke → 0.
- **Lifecycle states:** suspend → 200, illegal re-suspend → 409, reactivate → 200.
- **Cash-to-Cash:** read-only expiry status (nested `worker`), oversight transfer list.
- **Receiving number:** workforce read under `agent.view`.
- **Error matrix:** 400, 401, 403, 404, 409 all exercised; **501 not applicable** — no route in the
  reviewed surface returns it (noted rather than fabricated).
- **Transaction PIN boundary:** Agent sets its own PIN (200); **no workforce unlock/reset route
  exists (404)** — product decision **D6 remains disabled**, preserved as required.
- **Funding maker-checker:** maker 201 (no journal), maker cannot self-approve (403), maker cannot
  execute (403), independent `FINANCE_CONTROLLER` checker sees the pending request, approves (201),
  executes (201).
- **Multi-role authorization (7 synthetic roles):**

| Role | outlets (`agent.view`) | expiry (`transaction.view`) | sessions/revoke |
|---|---|---|---|
| AGENT_NETWORK_MANAGER | **404** (granted, entity absent) | 403 | 404 (granted, entity absent) |
| FINANCE_AUDITOR | **404** (granted) | **200** | 403 |
| OPERATIONS | 403 | **200** | 403 |
| CUSTOMER_SERVICE | 403 | 403 | 403 |
| COMPLIANCE | 403 | 403 | 403 |
| RISK_FRAUD | 403 | 403 | 403 |
| TREASURY | 403 | 403 | 403 |

`404` after authorization proves the function gate passed and only the lookup failed; `403` proves
denial. This is the correct discriminator and it matches Arena 1's documented intent.

---

## 8. Review of Arena 1's shared authorization guard change

Arena 1 flagged `runtime-access.guard.ts` for review. Assessment:

**What it does.** When a *marked* route (`auditDeniedWorkforceFunction`) with exactly one required
function is denied at the guard, it calls `authorizationService.authorize(...)` to record a denied
decision **before** throwing the existing `ForbiddenException`.

**Why it is safe.** `authorize()` is the auditing wrapper; it returns a decision and does **not**
throw on denial (only `requireFunction` throws), so the request is still rejected with 403. The flag
is scoped to explicitly marked Mission 15A policies, and the response contract is unchanged.

**What I verified.** The 403 denials behave identically with and without the flag (role matrix above);
allowed requests still produce exactly one controller-level decision; no unrelated route was
generalised. The one consequence I did find is **D-01** — not from this flag, but from the sibling
route-policy additions in the same commit (401 → 403 for non-workforce principals on
`GET /internal/agents`).

**Stale C2C expiry capability metadata — confirmed, NOT changed (correct).**
`src/capability-registry/capability.seed.ts` still declares `CASH_TO_CASH_EXPIRY` with
`apiStatus: NOT_EXPOSED` and `adminUiStatus: NOT_EXPOSED`, while a read-only
`GET /internal/admin/cash-to-cash/expiry-status` now exists and the Admin Web renders it. This is
**governed-evidence staleness, not a functional defect**, and Arena 1 explicitly reserved the update
for the registry owner so nobody implies a sweep endpoint or enables the worker. I left it untouched
and record it as **GOV-01 (LOW, owner: capability-registry owner)**.

---

## 9. Unresolved defects and follow-ups

| ID | Severity | Owner | Status |
|---|---|---|---|
| **D-01** — A22 suite expects 401, guard returns 403 for non-workforce principals on `GET /internal/agents*` | **MEDIUM** | **Arena 1 (backend)** | **OPEN — returned, not worked around** |
| **GOV-01** — `CASH_TO_CASH_EXPIRY` capability metadata still `NOT_EXPOSED` for a now-exposed read-only status route | LOW | capability-registry owner | OPEN (deliberately untouched) |
| **AW-01** — Admin Web login: with no `ADMIN_WEB_API_BASE_URL` the build injects `''` via Vite `define`, so the `''`→`/api/v1` dev fallback in `src/config/index.ts` can **never** run; dev users must export the variable or login fails with "Admin API base URL is not configured" | **MEDIUM (DX / Product-Owner-reported)** | **Arena 2** | OPEN — reproduced in-browser (screenshot `01-login-dashboard.png` from the pre-config run); **does not block** E2E once `ADMIN_WEB_API_BASE_URL=/api/v1` is set |
| **AW-02** — Onboarding queue shows the internal `AGENT-APP-…` reference but not the applicant reference typed by the operator, making rows hard to correlate | LOW | Arena 2 | OPEN (design follow-up) |
| **AW-03** — Outdated login visual design | LOW | Arena 2 | Product Owner observation, recorded as follow-up |
| **AW-04** — Funding maker-checker has no Admin Web UI badge explaining "request ≠ posted money"; behaviour is correct but the copy is thin | LOW | Arena 2 | Observation |

Deliberately preserved as-is (no policy invented): **D1** physical cash handover, **D2** expired-funds
disposition, **D3** fees/VAT, **D4** KYC freshness, **D5** reclassification, **D6** PIN recovery (no
workforce reset route — verified 404), **D8/D9** notifications, **D10/D11**, **D12** reversals.
The expiry worker remains **opt-in and disabled** (`configuredEnabled=false`, verified live).

---

## 10. Boundaries honoured

No deployment; no live provider activation; no production database operation (all work on a
disposable `monienaija_e2e` database and `mn_it_*` test databases); no merge into `main`; no policy
changes; no financial-posting, maker-checker or authorization-catalogue semantics modified. Arena 1's
and Arena 2's intended functionality was preserved; the three fixes restore the contract the backend
actually implements.

---

## 11. Recommendation to Arena 4

**PASS for Ordinary Agent V1 functional integration**, with **D-01 as the single blocking item** for a
clean full-suite run. D-01 is an error-semantics regression owned by Arena 1 — access is still
correctly denied, so it is not a security defect, but it does mean this branch cannot claim 129/129.

Suggested acceptance path:
1. Arena 1 resolves D-01 (preserve 401 for non-workforce principals, or formally re-specify to 403
   and update the A22 test deliberately).
2. Re-run the complete matrix; expect 129 suites / 2,415 tests / exit 0.
3. Arena 2 addresses AW-01 (dev login ergonomics) — needed for any future E2E run to be
   reproducible without tribal knowledge.

---

## 12. Reproduce

```bash
# backend
npm ci --ignore-scripts && npm run build
node scripts/prepare-pg-test-env.js
LD_LIBRARY_PATH=$PWD/node_modules/@embedded-postgres/linux-x64/native/lib node scripts/embedded-pg.js &
NODE_ENV=test LOG_LEVEL=silent ./node_modules/.bin/jest --runInBand          # 224 suites
PG_TEST_CONCURRENCY=1 NODE_ENV=test npm run test:pg                          # 129 suites

# admin web
cd apps/admin-web && npm ci --ignore-scripts && ./node_modules/.bin/jest --watchAll=false
ADMIN_WEB_API_BASE_URL=/api/v1 ADMIN_WEB_DEV_PROXY_TARGET=http://localhost:3000 \
  ./node_modules/.bin/vite --port 5173 --host 0.0.0.0

# e2e (needs a Chromium binary; this sandbox had none and playwright's CDN is blocked,
# so a packaged Chromium was extracted from the npm registry)
node docs/integration/mission-16/harness/m16-api.cjs
LD_LIBRARY_PATH=<chromium-libs> node docs/integration/mission-16/harness/m16-e2e.cjs
```
