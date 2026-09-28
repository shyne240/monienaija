# S-FIX-01 — Customer Lifecycle Authorization + Session/Status Binding Hardening
## Verification Report

Date: 2026-09-28 · Branch: `arena/01a0d883-monienaija`
Authoritative input: `docs/V1-END-TO-END-PROCESS-AUDIT.md` (contradictions C-3, C-4; security
decisions §24-1, §24-6; matrix rows #4, #61–65 adjacency reviewed for scope).

---

### 1. Starting HEAD

`7fb64bc1ed321b9c32db6a561b3928a2ab0fbff5` — the pushed V1 Process Audit commit.
(Workspace rolled back to the old base once during this session; recovered via
fetch + `reset --hard` to the verified remote tip `7fb64bc` before any modification.
All work was built on top of exactly that commit.)

### 2. Final HEAD

Implementation commit: **`c44085d8fa1cc5fdc4d0f10d5ab5b787c2b0a541`** (contains every code, test,
and audit-addendum change listed §3 except this report). This report is committed as the
next commit on the same branch; the final branch HEAD is that report commit — recorded in
the session's final report and verifiable via `git log`. Both commits were pushed to
`origin/arena/01a0d883-monienaija` and local HEAD == remote HEAD with a clean tree.

### 3. Exact files changed

| File | Change |
|---|---|
| `src/authorization/route-policy-registry.ts` | New route block: `PATCH /api/v1/customers/:id` (excluding `me`) → `authenticationMode: WORKFORCE_SESSION`, workforce-only policy (`SUPPORT/OPERATOR/SERVICE/PRIVILEGED`, `customerAccess:'NONE'`, `agentAccess:'NONE'`). Placed before the generic customers block; `/customers/me/*` self-service block untouched. |
| `src/customer/customer.controller.ts` | Controller-level `requireWorkforce(req)` assertion on `@Patch(':id') update()` only (mirrors the established `admin/*.controller.ts` pattern: rejects AGENT/CUSTOMER/AGGREGATOR with `401 'Privileged access required'`). All other endpoints on this controller unchanged. |
| `src/customer-authentication/authentication-session.service.ts` | Injects `Repository<Customer>` (entity already registered in the module's `forFeature` — no module change). `validate()` now denies sessions whose customer's **current** status is not `ACTIVE` (`CUSTOMER_STATUS_INELIGIBLE`), after token/audience/revocation/expiry checks and before `lastSeenAt` touch. |
| `src/customer-authentication/authentication-session.types.ts` | Validation reason union extended with `'CUSTOMER_STATUS_INELIGIBLE'`. |
| `src/customer-authentication/authentication-execution.service.ts` | `authenticate()`: after successful password verification, denies session-bound authentication when `customer.status !== 'ACTIVE'` → `CUSTOMER_STATUS_INELIGIBLE` + security audit row `AUTHENTICATION_STATUS_INELIGIBLE`; placed after verification (no existence/status oracle) and without consuming failed-authentication (lockout) budget. Failure-reason union extended. |
| `test/authentication-session.service.spec.ts` | Fixture supplies customer-status stub (default ACTIVE); **new unit test**: SUSPENDED/DRAFT/soft-deleted(CLOSED) customers → `CUSTOMER_STATUS_INELIGIBLE`. |
| `test/authentication-execution.service.spec.ts` | Fixture customer gains `status` (default ACTIVE, overridable); **new unit test** proving DRAFT/SUSPENDED denial after password verification without lockout consumption. |
| `test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts` | **NEW** real-PG + real-HTTP spec, 7 tests covering all 8 required proofs (§8/§9). |
| `docs/V1-END-TO-END-PROCESS-AUDIT.md` | Precise addendum only: §22 remediation-status note (C-3/C-4 → RESOLVED by S-FIX-01; other contradictions unchanged) and §24 items 1 & 6 marked RESOLVED. No audit content altered. |
| `docs/S-FIX-01-VERIFICATION-REPORT.md` | **NEW** — this report. |

Not changed: any migration (count remains **75**), any module wiring, any financial
(ledger/transfer/funding/wallet/commercial/limit) code, any agent-side code, any
authentication rewrite (both bindings reuse the existing execution/session services).

### 4. Exact security findings addressed

**C-3 — Customer self-activation / lifecycle authorization (§24-1).**
Before: `PATCH /api/v1/customers/:id` (the **only** customer lifecycle-transition surface;
`UpdateCustomerDto = {status, actor}`) fell into the generic `/api/v1/customers/*` route
block (`allowedPrincipalTypes: [CUSTOMER, SUPPORT, OPERATOR, SERVICE, PRIVILEGED],
customerAccess: SELF`). The runtime guard authenticates only AGENT/CUSTOMER sessions on
that block, so in practice the **only** principal that could actually reach the lifecycle
route was a CUSTOMER SELF session — a customer could self-activate (DRAFT→ACTIVE on its
own row) and self-unsuspend; genuine workforce callers received 401. The `me`-alias
(`PATCH /customers/me`) also route-matched the same handler (`:id='me'`).

**C-4 — Session/status non-binding (§24-6).**
Before: login (`AuthenticationExecutionService.authenticate`) validated credential status
+ account-lock + soft-delete only — `customers.status` (DRAFT/SUSPENDED) was never
consulted; session validation (`AuthenticationSessionService.validate`) consulted the
session table only. DRAFT/SUSPENDED customers could log in and hold fully valid sessions.

### 5. Before/after authorization behavior

| Operation | Before | After |
|---|---|---|
| `PATCH /customers/:id` with CUSTOMER SELF token | 200 — lifecycle status written (self-activation possible) | **403** (guard: customer token on workforce route). No status write; no audit write. |
| `PATCH /customers/:id` with workforce session | 401 (unreachable — no workforce authentication path on the route) | **200** via workforce session (all 4 V1 workforce types; no new hierarchy); service performs transition, audit `STATUS_UPDATED` written |
| `PATCH /customers/me` self token | reached `update(:id='me')` handler | **401** (`requireWorkforce` — controller-level assertion) |
| `PATCH /customers/:id` no/unknown token | 401 | 401 (unchanged) |
| `PATCH /customers/:id` AGENT token | (unreachable via policy: agentAccess absent → deny) | **403** (`Agent not allowed on workforce route`) |
| `PATCH /customers/:id` workforce-issued session of type CUSTOMER/AGGREGATOR (masquerade) | n/a | **401** (controller `requireWorkforce`) |
| `GET /customers/:id` self / cross | 200 / 403 (SELF scope) | **unchanged** (regression-proven) |
| `/customers/me/*` self-service surface | unchanged | **unchanged** (regression-proven: a23–a26, 70 tests) |

### 6. Customer lifecycle state behavior

- Intended authoritative actor for **every** lifecycle transition (DRAFT→ACTIVE,
  ACTIVE↔SUSPENDED, →CLOSED): **workforce principal** (SUPPORT/OPERATOR/SERVICE/PRIVILEGED —
  the repository's existing workforce model; no new roles introduced).
- Transition map (`assertCustomerTransition`) unchanged — V1 semantics preserved.
- CLOSED remains terminal and fail-closed: CLOSED sets `deletedAt` (soft delete), so even a
  workforce reactivation attempt gets 404 (proven), and the transition map would 409 if
  reached. No re-open path exists.
- KYC-before-activation gating remains **unimplemented by design** (audit A4/§23 product
  territory — deliberately out of scope).

### 7. Session/status behavior

Derived status semantics (from the V1 transition map + audit-documented intent; no guessing):

| Customer status | Login | Existing unexpired session at request time |
|---|---|---|
| ACTIVE | allowed | valid (unchanged) |
| DRAFT (pre-activation) | **denied** (401) — activation is a workforce act | **invalid** (`CUSTOMER_STATUS_INELIGIBLE`) |
| SUSPENDED | **denied** (401) | **invalid** while suspended |
| CLOSED (terminal, soft-deleted) | **denied** (401; pre-existing `deletedAt` gate + new gate) | **invalid** permanently |

Binding = **request-time, on current status** (no session-revocation architecture):
- Denial determinism proven: ACTIVE→SUSPENDED → very next request 401; login 401.
- Reactivation restores an unexpired session without re-login (status becomes ACTIVE again;
  session row was never revoked). This is the documented, deliberate consequence of
  request-time binding, chosen over introducing revocation machinery per the task's
  constraint ("narrowest correct binding… no unnecessary session revocation architecture").
  If product later wants suspension to permanently kill sessions, that is an additive
  strengthening, not a correctness fix.
- Status checks are performed **after** credential verification at login (no account/status
  enumeration oracle) and **without** consuming lockout budget; denials record
  `AUTHENTICATION_STATUS_INELIGIBLE` audit rows.
- `PENDING`/`TERMINATED` are agent-side states: agent flows hold separate service-level
  ineligibility guards (verified during inspection); unchanged by this task.

### 8. Tests added/changed

| Suite | Tests | Focus |
|---|---|---|
| `test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts` (NEW) | 7 | Real PG + real HTTP: (0) route-policy assertions incl. unchanged me-surface; (1) CUSTOMER SELF PATCH→403, no write, no audit; (2) OPERATOR activates DRAFT→ACTIVE 200, SUPPORT suspends 200, DB + `audit_events(STATUS_UPDATED)` asserts; (3) no-token 401, unknown-token 401, workforce-CUSTOMER masquerade 401, real AGENT token 403; (4+5) DRAFT login 401, SUSPENDED session 401 + login 401, CLOSED login 401; (7) deterministic session across suspend→reactivate→close; (8) alternate-route escalation checks (self GET 200, cross-customer GET 403, workforce PATCH→404 on missing customer, `PATCH /customers/me`→401). |
| `test/authentication-execution.service.spec.ts` | +1 (6 total) | Login binding: DRAFT/SUSPENDED → `CUSTOMER_STATUS_INELIGIBLE` after password verification, no lockout budget, audit row. |
| `test/authentication-session.service.spec.ts` | +1 (6 total) | Validate binding: SUSPENDED/DRAFT/soft-deleted(CLOSED) → `CUSTOMER_STATUS_INELIGIBLE`; ACTIVE remains valid. |

### 9. Real-PG test results (real local PostgreSQL, `embedded-postgres` + pg-harness; no mocks)

| Batch | Suites | Result |
|---|---|---|
| S-FIX-01 focused | s-fix-01-customer-lifecycle-authorization | **7/7 pass** |
| Customer-app core (login, profile, sessions, receiving identity, PIN, Wallet→Wallet, me/status) | a23, a24, a25, a26 | **70/70 pass** |
| Funding history, notifications (delivery + inbox), support, beneficiaries, unified history | v1-001, v1-005, v1-006, v1-007, v1-hardening-01, hardening-04 | **155/155 pass** |
| Workforce sessions, agent auth/app, admin foundation, admin writes, transfer spine | a2-workforce-session, a7, a21, a22, v1-003, a5-transfer-lifecycle | **99/99 pass** |
| **Integration total** | 17 suites | **331/331 pass, 0 fail** |

### 10. Regression results

- Full **unit** suite: **1766 pass / 2 fail** — the 2 fails are the pre-existing
  `external-reconciliation.service.spec.ts` failures, identical to the audited baseline
  (ec9d341: 1764 pass + 2 same fails; delta = my +2 new unit tests passing). That spec
  shares no imports with any changed file; reconciliation module untouched.
- Authz/session unit battery (a2 contract/configuration/oidc, runtime-access guard,
  authorization service, customer-auth runtime/service): **85/85 pass**.
- No financial semantics altered: no ledger/transfer/funding/wallet/commercial/limit code
  touched; migration count unchanged (75); capability seed untouched (114 entries).

### 11. TypeScript / build / lint results

- `npx tsc --noEmit`: **clean (0 errors)**.
- `npm run build` (nest build): **clean**.
- `eslint` on all 8 changed files: **0 problems**. (Repo-wide baseline carries ~1122
  pre-existing lint errors in other files — this change adds none.)

### 12. Remaining security findings (unchanged, tracked in the audit)

- §24-2 finance-role enforcement depth (funding routes use principal-type only) — open.
- §24-3 privileged-approval consumption breadth — open.
- §24-4 MFA requirement mapping — open (machinery PARTIAL by design).
- §24-5 workforce suspension semantics — open.
- Credential-creation surface (`POST /customers/:id/authentication-credentials`) authenticates
  only AGENT/CUSTOMER sessions on the generic customers block (workforce unreachable) —
  pre-existing anomaly recorded in audit A1/C-6 territory; login-eligibility negates its
  exploitability for inactive customers after this task, but the actor-model question is
  unchanged and open.
- Notification delivery remains console/test-provider only (C-7; S-FIX scope excludes SMS).

### 13. Findings deliberately left outside scope, and why

| Item | Why |
|---|---|
| Finance-role enforcement (§24-2) | Task instruction: do not expand unless directly part of the **same** authorization/session boundary. Funding maker/checker routes are a distinct workforce-session surface with their own 403 contract; changes there are independent of C-3/C-4 and cannot be folded in safely without broadening scope. |
| Active session revocation on suspension/CLOSE | Request-time status binding already enforces the invariant deterministically; per task: "do not introduce an unnecessary session revocation architecture". Revision semantics documented §7. |
| Receiving money while SUSPENDED | Recipient/wallet-side behavior is governed by wallet status + recipient resolution, not sessions; task prohibits altering financial semantics. Unchanged by design. |
| KYC-before-activation gating | Audit §23 product decision (P-DEC territory); audit A4 explicitly defers it. |
| Registration OTP / self-serve signup | Audit §23-1 product decision; C-6. |
| Agent session/status binding (agent-side PENDING/SUSPENDED/TERMINATED) | Separate boundary with existing service-level guards (agent eligibility is enforced per-operation); task scope is the customer boundary. |
| H-10 staleness (C-1), registry drift (C-5) | Documentation-history contradictions; no behavior to fix here. |

### 14. Status

**VERIFIED.** Both audit-designated security invariants are implemented and proven against
real PostgreSQL + real HTTP; all 8 required proof categories are covered by passing tests;
331/331 focused+regression integration tests pass; unit baseline unchanged except the 2 new
passing tests; tsc/build/lint clean; no unrelated behavior changed.
