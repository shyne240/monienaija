# V1-ADMIN-FULL-SURFACE-AUDIT-01 — Admin Web Full Capability & Authorization Audit

**Type:** Factual-state audit. **This is NOT a UAT sign-off and does NOT declare Admin Web
V1 "complete."** Its purpose is to answer, with repo-grounded evidence: after months of
development, what Admin Web V1 functionality actually exists, what works, what is broken,
what is missing, and what was deliberately excluded. Human browser UAT (Chromium/Playwright)
is a separate, later stage and did not happen in this sandbox (no browser is available here).

**Baseline:** `origin/arena/01a10374-monienaija`, current tip at the time of this audit:
commit `e54a614` (Part A fix), parent `5bd79a5`.

Evidence in this report is drawn from four distinct categories, kept separate throughout:
1. **Real PostgreSQL/HTTP** — live `curl` calls against a running NestJS backend
   (`node dist/main.js`, port 3000) backed by a real embedded PostgreSQL instance, using a
   real `admin@monienaija.local` / FINANCE_ADMIN session obtained via the real
   `POST /internal/a2/workforce/local-admin-sessions` login endpoint. No mocks.
2. **Automated React/Jest tests** — `apps/admin-web`'s own Jest + Testing Library suite,
   and the backend's unit/integration Jest suites. Real component rendering in jsdom, not a
   browser.
3. **Repository inspection** — reading actual source (`apps/admin-web/src/**`,
   `src/**/*.controller.ts`, `src/authorization/route-policy-registry.ts`, `docs/V1/**`) to
   determine what is wired, what is a stub, and what documentation says.
4. **Actual browser/manual validation — NOT PERFORMED.** This sandbox has no Chromium,
   Playwright, or Puppeteer. No visual/interactive check of the rendered UI was possible or
   attempted. Every finding below about "the UI shows X" is derived from reading the React
   source and/or its Jest tests, not from looking at a rendered page.

---

## 1. Part A commit hash

`e54a614` — `fix(authorization): V1-ADMIN-FULL-SURFACE-AUDIT-01 Part A — real FINANCE_ADMIN
sessions reach the Admin Web customer-servicing API`, parent `5bd79a5` (the real,
fetch-confirmed tip of `origin/arena/01a10374-monienaija` at the time it was built). Pushed
and confirmed as a clean fast-forward: `5bd79a5..e54a614 arena/01a10374-monienaija`.

*(Factual note: during this session a stale local git `HEAD` was discovered and corrected
before this commit was built — see §18 for the full account. The commit above was built on
the corrected, real base and is not affected.)*

## 2. Root cause (Part A)

Three compounding defects prevented a real, successfully-authenticated FINANCE_ADMIN
workforce session (PRIVILEGED principal type, `WORKFORCE_SESSION` auth mode) from reaching
the `/api/v1/customers*` family of endpoints used by the Customer Directory screen:

1. **`src/authorization/runtime-access.guard.ts`** — the default branch only attempted
   Agent-session and Customer-session resolution for credential propagation; it never
   attempted A2-workforce or SUPPORT session resolution before giving up and throwing
   `UnauthorizedException` (401). A real, valid, non-expired FINANCE_ADMIN bearer token was
   therefore never even looked up.
2. **`src/authorization/authorization.service.ts`**, `checkCustomerScope()` — the SELF-access
   branch was `principal.type === 'CUSTOMER' && principal.customerId === resource.customerId
   ? undefined : 'CUSTOMER_SCOPE_MISMATCH'`, which forced `CUSTOMER_SCOPE_MISMATCH` for
   *every* non-CUSTOMER principal reaching that branch — including principal types that
   `allowedPrincipalTypes` had already approved (e.g. PRIVILEGED/OPERATOR).
3. **`src/authorization/route-policy-registry.ts`** — there was no explicit policy branch for
   the bare `/api/v1/customers` path, so it fell through to the generic catch-all requiring
   `requiredScopes: ['internal:access']` — a scope that is never granted to any role in this
   system (confirmed: no role definition anywhere grants `internal:access`).

The combination meant: an authenticated FINANCE_ADMIN request either 401'd (guard never
resolved the session) or 403'd (scope mismatch / ungranted scope), even though the backend
had a real, valid, persisted FINANCE_ADMIN session.

## 3. Part A files changed

Exactly 4 files, nothing else:
- `src/authorization/runtime-access.guard.ts` — added A2-workforce-then-SUPPORT session
  resolution attempts to the default branch before the final 401, preserving the existing
  fail-closed behavior for unauthenticated/garbage tokens and the already-correct
  `WORKFORCE_SESSION`-mode branch.
- `src/authorization/authorization.service.ts` — `checkCustomerScope()` SELF branch now
  returns `undefined` (no mismatch) for any already-allowed non-CUSTOMER principal type,
  instead of unconditionally forcing a mismatch.
- `src/authorization/route-policy-registry.ts` — added an explicit `/api/v1/customers`
  policy branch (`allowedPrincipalTypes: ['CUSTOMER','OPERATOR','SERVICE','PRIVILEGED']`,
  SUPPORT excluded per UAT-SEC-005/UAT-ADMIN-011); removed over-broad `SUPPORT` from the
  existing `/customers/:id` branch's `allowedPrincipalTypes` for the same reason.
- `test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts` (new) — real-PG
  integration regression tests: login → protected API → 200; logout → 401; garbage token →
  401; no token → 401.

**Verification at commit time:** `npm run build` clean; 9 targeted integration spec files /
125 tests passed; full unit suite 174 suites / 1823 tests passed.

---

## 4–13. Parts B–G — detailed findings

### Part B — Admin Web V1 inventory

`apps/admin-web` has **no router** (no react-router or equivalent) — `App.tsx` is a two-state
switch (`LoginScreen` vs `Layout`), and `Layout.tsx` holds a single `currentView` string in
local component state that conditionally renders one of 7 screens. There are no URLs/deep
links for any Admin Web view; "pages" below means "views reachable from the sidebar," not
routes.

| # | Capability | Frontend component | Backend endpoint(s) | Auth requirement | Class | Evidence |
|---|---|---|---|---|---|---|
| 1 | Operator identity/session display | `DashboardScreen.tsx` | none (reads client-side principal from login response) | n/a (post-login) | **A** | Real data from a real session; no API call needed |
| 2 | System financial health widgets | `DashboardScreen.tsx` | none — hardcoded "Not yet available" text | n/a | **E** | Literal strings in source; see §13 finding on `/internal/outbox` |
| 3 | Customer list/search/create | `CustomerDirectoryScreen.tsx` | `GET/POST /api/v1/customers` | WORKFORCE_SESSION, PRIVILEGED/OPERATOR/SERVICE/CUSTOMER | **A** | Live: `GET`→200, `POST`→201 (Part A fix) |
| 4 | Customer status update (Active/Suspend/Close) | `CustomerDirectoryScreen.tsx` | `PATCH /api/v1/customers/:id` | same, workforce-only enforced in controller | **A** | Live: 200 |
| 5 | Wallet list/provision per customer | `CustomerDirectoryScreen.tsx` | `GET/POST /api/v1/customers/:id/wallets` | same | **A*** | Live: `GET`→200; `POST`→409 for a fresh customer (see caveat below) |
| 6 | KYC view/assessment per customer | `CustomerDirectoryScreen.tsx` | `GET /api/v1/customers/:id/kyc`, `POST /api/v1/customers/:id/kyc-assessment` | same | **A*** | Live: `GET`→404 (none yet, correct), `POST`→409 (see caveat) |
| 7 | Ledger chart-of-accounts browsing | `LedgerOperationsScreen.tsx` | `GET /api/v1/ledger/accounts` | falls to catch-all, `internal:access` (never granted) | **D** | Live: 403 for FINANCE_ADMIN |
| 8 | Journal lookup by UUID | `LedgerOperationsScreen.tsx` | `GET /api/v1/ledger/journals/:id` | same catch-all | **D** | Live: 403 |
| 9 | Journal reversal (checker-signed) | `LedgerOperationsScreen.tsx` | `POST /api/v1/ledger/journals/:id/reversal` | same catch-all | **D** | Live: 403 |
| 10 | Journal reversal (maker approval request) | `LedgerOperationsScreen.tsx` | `POST /api/v1/internal/a2/workforce/approvals/request` | WORKFORCE_SESSION, any authenticated workforce principal (route-level) | **D*** | Live: 201, but `allowed:false, reason:"ROLE_MISSING", requiredRoles:["FINANCE_PREPARER"]` — see §13 |
| 11 | Transaction (deposit/withdrawal/transfer) lookup | `TransactionObservabilityScreen.tsx` | `GET /api/v1/deposits/:id`, `/withdrawals/:id`, `/transfers/:id` | catch-all, `internal:access` | **D** | Live: 403 (all three) |
| 12 | Fee simulator | `TransactionObservabilityScreen.tsx` | `POST /api/v1/fees/calculate` | catch-all, `internal:access` | **D** | Live: 403 |
| 13 | Sandbox deposit/withdrawal completion override | `TransactionObservabilityScreen.tsx` (self-labeled "Sandbox Utilities") | `POST /api/v1/deposits/:id/complete`, `/withdrawals/:id/complete` | catch-all, `internal:access` | **D** | Unreachable (depends on #11 first succeeding); self-documented in-app as a sandbox-only affordance |
| 14 | Reconciliation report (9 integrity checks + binding breaks) | `ReconciliationObservabilityScreen.tsx` | `GET /api/v1/internal/reconciliation/report` | generic `/internal/` branch, no extra scope | **A** | Live: 200, real data |
| 15 | Trial balance report | `ReconciliationObservabilityScreen.tsx` | `GET /api/v1/internal/reconciliation/trial-balance` | same | **A** | Live: 200, real data |
| 16 | Finance role assignment | `RoleAssignmentScreen.tsx` | `POST /api/v1/internal/a2/workforce/roles` | WORKFORCE_SESSION, no extra route policy (business rules enforced in service) | **A** | Live: 201, real assignment persisted |
| 17 | Finance role revocation | `RoleAssignmentScreen.tsx` | `DELETE /api/v1/internal/a2/workforce/roles/:principalId/:roleKey` | same, plus maker-checker quorum (`minimumApprovals:1`) enforced in service | **D*** | Live: 403 "Insufficient approvals" — correct by design, but the UI provides no way to obtain/see required `approvalIds` (no approvals-listing UI exists at all — see #19) |
| 18 | Privileged approval signature (checker approve) | `ApprovalsScreen.tsx` | `POST /api/v1/internal/a2/workforce/approvals/:id/approve` | same route-level laxity as #16 | **D** | Only reachable from the sidebar when `isController` (FINANCE_CONTROLLER role or `privileged:approve` scope) is true — **false for the only seeded test identity (FINANCE_ADMIN)**; no FINANCE_CONTROLLER local-dev account exists to verify actual UI reachability |
| 19 | Pending approvals listing | *(none — self-documented gap)* | *(none)* | n/a | **G** | `ApprovalsScreen.tsx` itself displays: "The current A2 workforce controller does not expose GET `/approvals` or GET `/approvals/:id`" |
| 20 | Login (local dev password) | `LoginScreen.tsx` | `POST /api/v1/internal/a2/workforce/local-admin-sessions` | public route, dev/test-only gate inside the service | **A** | Live: 200, confirmed repeatedly |
| 21 | Login (OIDC, "Advanced/engineering" panel) | `LoginScreen.tsx` | `POST /api/v1/internal/a2/workforce/sessions` | public route | **A** (wired) / untested live (no real IdP assertion available in sandbox) | code path identical to local-admin login, same guard |
| 22 | Bootstrap statement consumption ("Advanced" panel) | `LoginScreen.tsx` | `POST /api/v1/internal/a2/workforce/bootstrap` | public route, service-level gate | **A** (wired, deliberately disabled post-bootstrap) | Live: 403 "Bootstrap disabled" — correct, one-time ceremony already consumed |
| 23 | Logout | `Layout.tsx` → `auth-store.ts` | `DELETE /api/v1/internal/a2/workforce/sessions/:sessionId` | WORKFORCE_SESSION | **A** | Live: 200, session revoked, subsequent call with same token → 401 |

`*` = caveat explained in the relevant Part C/F section below; not a downgrade of the letter.

**Backend-only (Category C) capabilities with zero Admin Web UI**, confirmed live (`200` for
FINANCE_ADMIN) and confirmed to have no corresponding frontend file anywhere in
`apps/admin-web/src`:

| Capability | Backend endpoint(s) | Live result |
|---|---|---|
| Agent directory / lifecycle (suspend/terminate/reactivate/activate) / credentials | `AdminAgentController`, `AdminAgentLifecycleController`, `AdminAgentCredentialsController` (`/api/v1/internal/agents*`, `/api/v1/internal/admin/agents/*`) | `GET /internal/agents` → 200 |
| Aggregator directory | `AdminAggregatorController` (`/api/v1/internal/aggregators`) | 200 |
| Support ticket queue (list/assign/status/resolve/close/messages) | `SupportInternalController` (`/api/v1/internal/support/tickets*`) | 200 |
| Support/Agent/Customer admin credential issuance | `AdminSupportCredentialsController`, `AdminAgentCredentialsController`, `AdminCustomerCredentialsController` | not exercised destructively; routes confirmed mapped |
| Internal customer directory (admin projection, distinct from public `/customers`) | `AdminCustomerController` (`/api/v1/internal/customers*`) | 200 |
| Fee rule registry | `fee-rule-registry.controller.ts` (`/api/v1/internal/fee-rules`) | 200 |
| Commission rule registry/resolver | `commission-rule-registry/resolver.controller.ts` (`/api/v1/internal/commission-rules*`) | 200 |
| Reward rule registry/resolver | `RewardRuleRegistryController`/`Resolver` (`/api/v1/internal/reward-rules*`) | 200 |
| Limit catalog / assignment / operations | `limit-catalog/*.controller.ts`, `limit.controller.ts` (`/api/v1/internal/limit-*`) | 200 |
| Product catalog | `ProductCatalogController` (`/api/v1/internal/products`) | 200 |
| Capability registry | `CapabilityController` (`/api/v1/internal/capabilities`) | 200 |
| Notification delivery observability | `AdminNotificationController` (`/api/v1/internal/notifications/deliveries`) | 200 |
| Audit log | `operations.controller.ts` (`/api/v1/internal/audit`) | 200 |
| Outbox backlog | `operations.controller.ts` (`/api/v1/internal/outbox`) | **200** — see §13, this contradicts the Dashboard's own in-app claim |
| System metrics / diagnostics | `operations.controller.ts` (`/api/v1/internal/metrics`, `/internal/diagnostics`) | 200 |
| Customer funding-request approval queue | `CustomerFundingInternalController` (`/api/v1/internal/customer-funding-requests*`) | not exercised; routes confirmed mapped |

### Part C — Functional surface (16 named areas)

| Area | Finding |
|---|---|
| **Dashboard** | Identity/session panel real (Cat. A). Financial-health cards are static placeholder text (Cat. E) — and at least one of the three claims ("Outbox event backlog — Not yet available — Operations API gap") is **factually stale**: `GET /internal/outbox` exists and returns 200 live. |
| **Customer Directory/Servicing** | Cat. A, fully wired end-to-end after Part A. **Caveat:** a customer created through this exact screen (`status: ACTIVE` set directly) cannot immediately have a wallet provisioned or KYC approved through the same screen — the backend enforces `Customer onboarding must be COMPLETED before wallet provisioning` (409) and a KYC state machine that rejects `NOT_STARTED → APPROVED` (409) directly. This is a genuine auth-is-fine/workflow-is-incomplete gap in the UI's assumed happy path, not an authorization defect. |
| **Agent Management** | **No Admin Web UI at all.** Fully-built backend (directory, lifecycle transitions, credential issue/reissue) — Cat. C. |
| **Wallet/Ledger** | Ledger & Reversals screen is Cat. D — **100% non-functional for every endpoint it calls** (`ledger/accounts`, `ledger/journals/:id`, reversal), because the catch-all route policy requires `internal:access`, a scope that is never granted to *any* role in the system. Not self-labeled sandbox in the UI (unlike #13 below) — it is presented as a real desk, but is entirely broken for all roles. |
| **Transaction Ops (W2W/Cash-In/Cash-Out/C2C)** | This Admin Web screen is observability/override tooling only; it is Cat. D (403 on all calls, same `internal:access` gap). The underlying customer-facing deposit/withdrawal/transfer flows are separate code paths (CUSTOMER principal, different route policies) and are not affected by this gap — this is specifically an *admin/workforce access* gap to those records, not a break in the transactions themselves. |
| **Fee Ops** | Split finding: the Admin Web "Fee Simulator" (`POST /fees/calculate`) is Cat. D (403, `internal:access` gap). The real Fee Rule Registry (`/internal/fee-rules`) is fully functional (Cat. C) with zero UI. |
| **Commission Ops** | Backend-only (`/internal/commission-rules*`), fully functional (200), zero UI — Cat. C. |
| **Limits** | Backend-only (`/internal/limit-*`), fully functional (200), zero UI — Cat. C. |
| **Finance Role Admin** | Assign — Cat. A, live 201. Revoke — Cat. D*: correctly blocked by maker-checker quorum (by design, per `A2_MAKER_CHECKER_RULES_JSON`), but the UI has no way to discover/obtain the `approvalIds` it asks for, since there is no approvals-listing UI anywhere (see next row). |
| **Privileged Approvals/maker-checker** | Approve-by-ID exists (Cat. D — gated behind `isController` which is false for the only seeded identity); no listing UI exists at all (Cat. G, self-documented in the screen's own gap banner). |
| **Reconciliation & Breaks** | Reporting tier (9 integrity checks, binding discrepancies, trial balance) is Cat. A, fully live. The *break-resolution workflow* (resolve/acknowledge, audit trail for closure) does not exist anywhere in the repo, backend or frontend — Cat. G — and per `docs/V1/V1-SCOPE-CHALLENGE-01.md` this is **DECISION REQUIRED**, not an established V1 requirement nor an established V2 exclusion. This audit does not resolve that decision. |
| **Support** | Fully-built backend ticket queue (list/assign/status/resolve/close/messages) — zero Admin Web UI — Cat. C. |
| **Workforce Admin** | Only a thin slice (Finance Role Admin assign/revoke) is exposed in Admin Web. Broader workforce session/SUPPORT-user administration (`WorkforceAdministrationController`, `AdminSupportCredentialsController`) has no UI — Cat. C. |
| **Audit** | No dedicated Admin Web audit-log viewer. Backend `GET /internal/audit` is fully functional (200) — Cat. C. |
| **Notifications/Inbox** | Not a standalone Admin Web screen; only referenced as a disabled Dashboard placeholder. `GET /internal/notifications/deliveries` is a real, functional, live (200) backend endpoint — Cat. C, and the Dashboard's implicit "not available" framing for this area is imprecise (it only names "outbox event backlog," which is also actually live). |
| **Configuration** | Product catalog (`/internal/products`) is live and functional — Cat. C, zero UI. No other distinct "configuration" screen exists. |

### Part D — Doc reconciliation

| Capability | Documented V1? | UI exists? | Backend exists? | Auth works? | E2E works? | Status |
|---|---|---|---|---|---|---|
| Customer directory/search/create | Yes (A23 contract, Customer-* docs) | Yes | Yes | Yes (post Part A) | Yes | **Working** |
| Customer status lifecycle (suspend/close) | Yes | Yes | Yes | Yes | Yes | **Working** |
| Wallet provisioning | Yes | Yes | Yes | Yes | Conditional (needs COMPLETED onboarding first) | **Working with workflow prerequisite** |
| KYC assessment | Yes | Yes | Yes | Yes | Conditional (state machine transition rules) | **Working with workflow prerequisite** |
| Ledger account browsing / journal lookup / reversal | Not specifically an Admin Web UI requirement in any V1 contract found; the reversal *primitive* is documented V1 (`V1-SCOPE-CHALLENGE-01` §D) | Yes | Yes | **No — 403, `internal:access` never granted** | No | **Broken (authz gap, not a documented exclusion)** |
| Deposit/withdrawal/transfer admin lookup + fee calc | No explicit V1 Admin-Web requirement found | Yes | Yes | **No — same 403** | No | **Broken (authz gap)** |
| Reconciliation reporting (checks + trial balance) | Yes, explicitly "reporting exists today" per `V1-END-TO-END-PROCESS-AUDIT` §25-1 | Yes | Yes | Yes | Yes | **Working** |
| Reconciliation break resolution workflow | **Open / DECISION REQUIRED** per `V1-SCOPE-CHALLENGE-01` §C, not ratified either way | No | No | n/a | n/a | **Correctly unbuilt pending decision — not a bug** |
| Finance role assign | Yes (A2 workforce contract) | Yes | Yes | Yes | Yes | **Working** |
| Finance role revoke | Yes | Yes (form) | Yes | Yes (business-rule-gated) | Blocked by missing approval-sourcing UI | **Partially working — maker-checker correctly enforced, UI incomplete for it** |
| Privileged approval execute | Yes | Yes (gated) | Yes | Yes (route-level) | Reachability unverified for non-seeded FINANCE_CONTROLLER identity | **Unverified** |
| Privileged approval listing | No explicit V1 doc found requiring this specific UI, but implied by maker-checker UX | No | No | n/a | n/a | **Missing — self-documented gap** |
| Agent management UI | No Admin Web requirement found explicitly naming this; agent lifecycle itself is documented V1 | No | Yes | n/a | n/a | **Backend-only by omission, not an established exclusion** |
| Support ticket admin UI | No Admin Web requirement found | No | Yes | n/a | n/a | **Backend-only** |
| Aggregator/platform commission accounting | Explicitly excluded from V1 (`D-C-009`, `V1-SCOPE-CHALLENGE-01` §F) | No | Partial (fails closed by design) | n/a | n/a | **Correctly excluded** |
| Ops reversal workflow (maker-checker, reason capture, notifications) | **Open / DECISION REQUIRED**, documentation leans V2 (`V1-008`, `V1-HARDENING-10`, `V1-017`) | No | Partial (raw primitive exists, no workflow) | n/a | n/a | **Correctly unbuilt pending decision** |
| Push notifications | Explicitly deferred to V2 (`V1-005`, commercial-implementation audit) | No | Partial (resolves, no delivery substrate) | n/a | n/a | **Correctly excluded** |

### Part E — Sidebar/nav audit

The current 7-item sidebar (`Layout.tsx`) is gated by three role-derived booleans:
`isAdmin` (FINANCE_ADMIN role or `privileged:execute` scope), `isController`
(FINANCE_CONTROLLER role or `privileged:approve` scope), `isOperator` (any role at all —
i.e. true for every authenticated workforce principal).

| Sidebar item | Gate | True for FINANCE_ADMIN (the only seeded local identity)? |
|---|---|---|
| 📊 Operational Dashboard | always | Yes |
| 👥 Customer & KYC Servicing | `isOperator` | Yes |
| 📖 Ledger & Reversals | `isOperator` | Yes (but screen is 100% broken per Part C/D) |
| 💸 Transaction & Fee Ops | `isOperator` | Yes (but screen is 100% broken per Part C/D) |
| ⚖️ Reconciliation & Breaks | `isOperator` | Yes (fully functional) |
| 🔑 Finance Role Admin | `isAdmin` | Yes |
| ⚖️ Privileged Approvals | `isController` | **No** — FINANCE_ADMIN has neither the `FINANCE_CONTROLLER` role nor the `privileged:approve` scope (confirmed live: its scopes are exactly `["privileged:execute"]`). This sidebar item is invisible to the only identity that exists in this environment. |

**No hidden/unreachable modules beyond what is already listed were found** by inspecting
`apps/admin-web/src` exhaustively (7 screens total, confirmed by `find`). No evidence of
dead/orphaned screens, feature flags, or commented-out nav entries was found. The sidebar is
not missing an entry for any of the Category-C backend-only capabilities listed in Part B —
there is simply no UI code for them at all (not a hidden/gated nav item, an absent one).
This audit does **not** add any nav items — per task constraints, Category-C
backend-only-by-design items do not require a UI.

### Part F — Authorization audit (real FINANCE_ADMIN identity)

Identity used: `admin@monienaija.local`, principal
`https://local-dev-identity.monienaija.invalid:local-admin-credential:882fb3c173fcbd58cf1bca953634e15f`,
type `PRIVILEGED`, roles `["FINANCE_ADMIN"]`, scopes `["privileged:execute"]`,
assuranceLevel `MFA`. Role definition (live, from `A2_FINANCE_ROLES_JSON`):
`applicableActions: ["FINANCE_ROLE_ASSIGN","FINANCE_ROLE_REVOKE"]`, `makerEligible: true`,
`checkerEligible: false`, `administrativeCapability: true`.

| Endpoint family | Required | FINANCE_ADMIN has it? | Reaches backend? | Result | HTTP code |
|---|---|---|---|---|---|
| `GET/POST /customers*` | PRIVILEGED/OPERATOR/SERVICE/CUSTOMER principal type | Yes | Yes (Part A fix) | Success | 200/201 |
| `GET /customers/:id/wallets`, `/kyc` | same | Yes | Yes | Success / not-found | 200 / 404 |
| `POST /customers/:id/wallets`, `/kyc-assessment` | same, plus service-level state machine | Yes (auth) | Yes | Business-rule conflict | **409** |
| `PATCH /customers/:id` | workforce-only (enforced in controller) | Yes | Yes | Success | 200 |
| `GET /ledger/accounts`, `/ledger/journals/:id`, `POST .../reversal` | `internal:access` scope (catch-all) | **No** — no role in the system has this scope | Yes (authenticates), denied at authorization | Forbidden | **403** |
| `GET /deposits/:id`, `/withdrawals/:id`, `/transfers/:id`, `POST /fees/calculate` | same `internal:access` | No | Yes | Forbidden | **403** |
| `GET /internal/reconciliation/report`, `/trial-balance` | generic `/internal/` branch, PRIVILEGED/OPERATOR/SERVICE/SUPPORT, no extra scope | Yes | Yes | Success | **200** |
| `GET /internal/agents`, `/aggregators`, `/support/tickets`, `/customers` (admin), `/fee-rules`, `/commission-rules`, `/limit-profiles`, `/products`, `/reward-rules`, `/capabilities`, `/audit`, `/outbox`, `/metrics`, `/diagnostics`, `/notifications/deliveries` | same generic `/internal/` branch | Yes | Yes | Success | **200 (all)** |
| `POST /internal/a2/workforce/roles` (assign) | authenticated workforce session (no extra route policy; business rule enforced in service, `initiatingRoles: ["FINANCE_ADMIN"]`) | Yes | Yes | Success | **201** |
| `DELETE /internal/a2/workforce/roles/:p/:r` (revoke) | same route, plus `A2_MAKER_CHECKER_RULES_JSON` quorum (`minimumApprovals: 1`, approving role `FINANCE_CONTROLLER`) | Partially — can initiate, cannot self-approve | Yes | Business rule block | **403 "Insufficient approvals"** |
| `POST /internal/a2/workforce/approvals/:id/approve` | authenticated workforce session (route-level); deeper role check presumably inside the approval service | Unverified at role-granularity (only tested against a non-existent ID) | Yes | Not-found handled as Forbidden | **403 "Approval not found"** |
| `POST /internal/a2/workforce/approvals/request` (maker request) | authenticated workforce session (route-level); `applicableActions`/`requiredRoles` enforced per-action inside the service | **No** for `FINANCE_CONTROL_POLICY_ACTIVATE` specifically — that action's `initiatingRoles` is `["FINANCE_PREPARER"]` only, which FINANCE_ADMIN does not hold | Yes | Business rule block, HTTP success wrapping a denial | **201 body, `allowed:false, reason:"ROLE_MISSING"`** |
| `POST /internal/a2/workforce/bootstrap` | public route, service-level one-time gate | n/a (already consumed) | Yes | Already consumed | **403 "Bootstrap disabled"** |
| `DELETE /internal/a2/workforce/sessions/:id` (logout) | authenticated session owner | Yes | Yes | Success, token revoked | **200**, then subsequent calls → **401** |
| No token / garbage token on any protected route | — | — | Guard rejects before authorization | Fail-closed | **401** |

**Key finding:** the Admin Web Ledger screen's "Request Reversal Approval" button (shown to
any `isPreparer`-flagged user, which the frontend defines to include FINANCE_ADMIN) calls an
action (`FINANCE_CONTROL_POLICY_ACTIVATE`) whose real backend `initiatingRoles` is
`["FINANCE_PREPARER"]` only. **FINANCE_ADMIN is not eligible to initiate this specific
maker-checker action**, despite the UI presenting the control to it. This is a frontend/backend
role-model mismatch, not a security hole (the backend correctly denies it) — but it means the
button is dead for the one identity that exists in this environment.

### Part G — Real HTTP regression

**Category 1 — Real PostgreSQL/HTTP (strongest evidence, all live this session):**
- Full `login (200) → GET /customers (200) → DELETE session/logout (200) → GET /customers
  (401)` cycle, reconfirmed live against commit `e54a614`.
- No-token and garbage-token requests to `/customers` → 401 (fail-closed, both before and
  after Part A).
- 23 distinct Admin-Web-driven endpoints exercised with the real FINANCE_ADMIN session (full
  list and results in Part F's table) — explicit 200/201/403/404/409 outcomes recorded, no
  ambiguous or guessed results.
- Direct creation of a real customer, attempted wallet provisioning, attempted KYC
  assessment, and a status PATCH — all against the live embedded PostgreSQL database, not
  fixtures.
- 14 backend-only (Category C) endpoints confirmed live-reachable (200) with no
  corresponding Admin Web UI.

**Category 2 — Automated React/Jest tests (component-level, jsdom, not a browser):**
- `apps/admin-web` suite: **6 suites / 27 tests, all passing** (`app.test.tsx`,
  `auth-store.test.ts`, `customer-servicing.test.tsx`, `ledger-operations.test.tsx`,
  `reconciliation-observability.test.tsx`, `transaction-observability.test.tsx`).
- Backend integration suite (real embedded Postgres, `jest.integration.config.js
  --runInBand`): the 9 targeted specs including the new Part A regression spec, **125
  tests, all passing**.
- Backend unit suite: **174 suites / 1823 tests, all passing**.

**Category 3 — Repository inspection:** the entirety of Parts B–F above (route-policy
branches, controller route maps, frontend API call sites, role/scope/maker-checker config,
`docs/V1/*.md`) was established by reading source, not by inference.

**Category 4 — Actual browser/manual validation: NOT PERFORMED.** No Chromium, Playwright, or
Puppeteer exists in this sandbox. Nothing in this report should be read as confirming how the
Admin Web UI actually renders or behaves in a real browser — only that its source code calls
specific endpoints with specific results, and that its component tests pass under jsdom.

---

## 14. Remaining 401/403/404/500 issues

- **403 (by design, correct):** `internal:access`-gated catch-all for `ledger/*`,
  `deposits/*`, `withdrawals/*`, `transfers/*`, `fees/*` — scope is deliberately never
  granted (see task's own binding constraint not to unlock it); this is a known, reported
  brokenness of those Admin Web screens, not newly introduced and not fixed here.
- **403 (by design, correct):** finance role revocation without sufficient approvals;
  bootstrap re-consumption; approval-of-nonexistent-ID.
- **403 reused to mean "not found"**: `POST /approvals/:id/approve` on a non-existent ID
  returns 403 "Approval not found" rather than 404. This conflates authorization-denial with
  resource-absence at the HTTP layer and should be looked at (not fixed in this audit, per
  scope — audit-only).
- **No 500s observed** in any of the ~25 live calls made during this audit.
- **No remaining 401s** against the Part A-fixed endpoints; the 401/200/401 cycle is fully
  reproducible and was reconfirmed live this session.
- **Unresolved/unverified:** whether `POST /approvals/:id/approve` correctly denies a
  *real, existing* pending approval when called by a non-checker-eligible role (only tested
  against a nonexistent ID in this audit — a full maker→checker cross-role test was not
  constructed due to time).

## 15. Automated test results

- Admin Web (Jest + Testing Library): **6 suites / 27 tests passed**.
- Backend integration (real PG, `jest.integration.config.js --runInBand`): **9 suites / 125
  tests passed**, including the new Part A regression spec.
- Backend unit: **174 suites / 1823 tests passed**.
- `npm run build` (backend): clean.

## 16. Real PG/HTTP validation results

See Part G, Category 1 above — full table of ~25 live endpoint exercises in Part F, plus the
explicit login→200→logout→401 cycle reconfirmed live against commit `e54a614`.

## 17. Final commit hash(es)

- **`e54a614`** — Part A fix + dedicated regression test (pushed, verified as the real tip's
  direct child).
- No further source/test changes were made during Parts B–H; this audit is documentation-only
  (`docs/V1/V1-ADMIN-FULL-SURFACE-AUDIT-01-REPORT.md`, this file) and will be committed
  separately from the Part A fix, per the checkpoint instruction to keep Part A isolated.

## 18. Remaining blockers for human browser UAT

- **No Chromium/Playwright/Puppeteer in this sandbox** — nothing in this report (or any prior
  V1-ADMIN-* report) constitutes a real browser check. A human must visually walk through all
  7 Admin Web screens before any UAT sign-off.
- **Only one local identity is seeded** (`admin@monienaija.local`, FINANCE_ADMIN). The
  Privileged Approvals screen's real UI-reachability (`isController` gate) and the
  checker-approval flow's role enforcement cannot be confirmed end-to-end without a seeded
  FINANCE_CONTROLLER (or FINANCE_PREPARER, to test the maker side of
  `FINANCE_CONTROL_POLICY_ACTIVATE`) identity.
- **Three sidebar screens are confirmed non-functional** (Ledger & Reversals, Transaction &
  Fee Ops' lookup/calculator, and by extension Fee Ops' simulator) due to the `internal:access`
  scope gap — this is a pre-existing, previously-known, deliberately-not-fixed-here condition
  (see this task's binding constraints) that a human UAT pass will immediately encounter and
  must not mistake for a regression introduced by this audit.
- **Open product/governance decisions** (`V1-SCOPE-CHALLENGE-01` §11-C: aggregator
  self-service, reconciliation-break governance, ops-reversal workflow, internal
  settle-later commission release) remain genuinely undecided; no UAT pass can "pass" or
  "fail" functionality that was never built pending those decisions — it should be scoped
  out of any UAT checklist explicitly, not silently treated as a defect.
- **Process/environment note:** this audit's live verification ran against a fresh
  `node dist/main.js` + `npm run dev` (Vite) pair started in this session, backed by the
  existing embedded PostgreSQL instance with all 83 migrations and the standard local-dev
  seed. Any future UAT session will need to repeat this same bootstrap (see
  `scripts/embedded-pg.js`, `npm run migration:run`,
  `node scripts/local-dev-seed-admin.js`) since sandbox processes do not persist between
  sessions.

### Factual finding: stale git HEAD discovered and corrected this session

Before Part A's commit was finalized, this session discovered that its local git `HEAD`
(inherited from prior-turn state) pointed at a commit (`3d05aae`) that was a deep ancestor
(153 commits back) of the real `origin/arena/01a10374-monienaija` tip (`5bd79a5`), not its
descendant. A commit built on the stale base was rejected by `git push` as non-fast-forward;
diagnosis (`git fetch` + `git diff --stat <real-tip> <stale-commit>`) showed the working tree
already matched the real tip everywhere except the 4 genuinely-new Part A files, which were
rescued, the branch was hard-reset to the real tip, and the Part A fix was re-applied and
re-committed cleanly as `e54a614` directly on `5bd79a5`. No work was lost; the large body of
feature work visible in the repository (admin/agent/customer modules, ~90 test files,
`docs/V1/*`) was already correctly committed upstream in `5bd79a5`'s own history — it was
never "uncommitted," only invisible to a stale local checkout.
