# V1-AGENT-MOBILE-COMPLETENESS-MATRIX-01 — Authoritative V1 Agent Mobile Product-Completeness Audit

**Task:** V1-AGENT-MOBILE-05 (AUDIT ONLY — no code changed)
**Repository truth as of:** commit `26d73c6d5585186b9ac030e644b10a5c86a01d96` (`feat(agent-mobile): implement cash-to-wallet`), branch `arena/01a0d883-monienaija`, local == remote verified.
**Audit date:** 2026-10-02

---

## A. Executive summary

V1 Agent Mobile currently consists of **four committed phases** — foundation+auth (`6e211e8`), home/account operating context (`3c01bee`), reusable MFA challenge flow (`2de7cce`), and Cash→Wallet (`26d73c6`) — implemented against the existing, UAT-passed Agent backend. **122 requirements** were audited across 20 areas. Distribution: **45 MOBILE-COMPLETE**, **5 BACKEND-ONLY**, **12 MOBILE-PARTIAL**, **39 NOT-IMPLEMENTED**, **6 BLOCKED**, **5 DECISION-REQUIRED**, **10 V2/EXCLUDED**.

**Headline results:**

- **45 MOBILE-COMPLETE** — authentication/session end-to-end (login, mandatory credential rotation, restore, expiry purge, invalid-credential handling, logout, secure storage), full home/account operating context (identity, class, status, financial position, receiving number, fail-closed capabilities, outlets/terminals lists), all Cash→Wallet rows except the shared receipt dependency, cross-cutting security invariants, and the reused UX patterns (confirmation, duplicate-submit, failure taxonomy, idempotency).
- **5 BACKEND-ONLY** — powers ready on the backend without any mobile surface: unified transaction-history list/read, Agent support tickets (`/agents/me/support/**`), transaction PIN set, PIN verify, PIN change, and the outlet/terminal *detail* surfaces.
- **12 MOBILE-PARTIAL** — the reusable customer-MFA challenge card (shipped, awaiting its first consuming flow), operational-state messaging (suspended/terminated handled generically), PIN lockout guidance (message-only), session-expired dedicated UX, read-only disabled-outlet/terminal presentation, back/cancel + accessibility sweeps, history placeholder, and release assets pipeline.
- **39 NOT-IMPLEMENTED** within approved V1 scope — dominated by the remaining money flows (W2C Method 1, C2C initiation, C2C claim), unified history UI, the shared receipt renderer + per-flow receipt views, support UI, and PIN management UI.
- **6 BLOCKED / 5 DECISION-REQUIRED** — Agent in-app notification inbox (no Agent-facing inbox route exists), commission dashboards, limits read surface, normal credential-change route (backend gaps/product decisions); and decisions around per-id transaction detail (explicitly not needed for receipts per A21 design), receipt image export, outlet/terminal transactional attribution, screenshot guarding, and asset pipeline.
- **10 V2/EXCLUDED** — verified against spec §3/§11 (onboarding/application, funding/defunding actions, receiving-number ops, W2C-Method-2 second confirmation, preferences, bank/NIBSS/cards/airtime/bills/rewards, push-only dependencies).
- **No defects found in Cash→Wallet (V1-AGENT-MOBILE-04)** — it conforms to the audited contract; its remaining item is the *shared receipt renderer* dependency, not a defect.

**Receipt verdict (§K/J):** receipts ARE an explicit V1 product requirement (V1-AGENT-MOBILE-04 mandate + UAT-C2W-013 "agent receipt observable"). Rendering **can be entirely client-side** from authoritative result/history data; **image export is NOT currently required** by any authoritative source → the dedicated receipt task should cover a shared view + share-text export, with image export marked DECISION-REQUIRED, and **no transaction-detail endpoint is required** for receipts (list-derived data suffices; per A21 design).

**Recommended next implementation task (§L):** `V1-AGENT-MOBILE-06` — **Transaction History + shared Receipt renderer** (unblocks history-verifiable success screens and the receipts requirement across Cash→Wallet and the flows that follow), then Cash→Cash initiation (+ display-once transferCode), then Wallet→Cash + Cash→Cash claim (cash-out OTP UI reusing the MFA challenge component), then Support UI + PIN management + operational hardening.

---

## B. Authoritative sources inspected

| # | Source | Evidence used |
|---|---|---|
| 1 | Project continuation handoff (task briefs V1-AGENT-MOBILE-01…05) | Phase scope, terminology, mandates |
| 2 | `docs/V1/V1-AGENT-MOBILE-APPLICATION-SPEC-01.md` | §2 exact routes, §3 screens/nav, §5 + §5.1 compatibility matrix & gaps, §8 phase ordering, §11 exclusions, §13 implementation status |
| 3 | `docs/V1/A21-AGENT-APP-CONTRACT.md` | "history receipts PARTIAL" design basis, per-id detail route absence |
| 4 | `docs/V1/V1-PRODUCT-COMPLETION-AUDIT.md` §7 | Agent App audit (historic; partially superseded — see §G conflict log) |
| 5 | `docs/V1/V1-CAPABILITY-REGISTRY.md` | AGENT (22) FULLY_ENABLED/API_READY; `AGENT_COMMISSION` PLANNED/PRODUCT_DECISION; `AGENT_RUNTIME_LIMITS` BLOCKED/PRODUCT_DECISION |
| 6 | `docs/V1-AGENT-APP-RECOVERY-AUDIT-01.md` (untracked workspace artifact) | Systematic branch/history recovery findings that established the app did not exist pre-MOBILE-01 |
| 7 | `docs/uat/V1-UAT-MASTER-01.md` | UAT-AGENT-001…014 lanes, UAT-C2W-013 (agent receipt + notifications), UAT-W2C-012, UAT-CUST-008 (notification model), support lanes |
| 8 | `docs/V1/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md` | Operational readiness conventions |
| 9 | `docs/V1/V1-SCOPE-CHALLENGE-01.md`, `docs/V1/V1-COMMERCIAL-*` | Exclusions and commercial-policy boundaries (no invented rates) |
| 10 | Backend source: `src/agent/*`, `src/agent-authentication/*`, `src/support/*`, `src/notification/*`, `src/authorization/route-policy-registry.ts`, DTOs | Exact controller/service/DTO contracts (cash-in/-out/-to-cash/claim, recipients/resolve, agents/me/*, agents/me/support, mfa-challenges, transaction-pin) |
| 11 | `apps/agent-mobile/**` source + `__tests__` (10 suites, 92 assertions at baseline) + `git log -- apps/agent-mobile` | Repository-truth implementation status |
| 12 | `apps/customer-mobile/**` | Architectural precedent (no notification center, no in-app receipt exporter, no clipboard dep) |
| 13 | Backend test suites cited:`a9/a13–a17/a19–a21`, `v1-003`, `v1-agent-history-01`, `v1-agent-mfa-api-01`, UAT Agent family | Integration evidence of backend contracts |

**Documentation conflict recorded (not rewritten):** `V1-PRODUCT-COMPLETION-AUDIT.md` §7 "Agent App Audit" lists Agent history as PARTIAL and support as NOT IMPLEMENTED. Both were subsequently closed at the backend: unified history by V1-AGENT-HISTORY-01 (`GET /agents/me/transactions`) and Agent support by `agents/me/support/tickets` (UAT-AGENT-012 lane). This matrix supersedes those rows for CURRENT truth; the historical document itself is left untouched per task constraints.

---

## C. Definition of MOBILE-COMPLETE

A row is **MOBILE-COMPLETE** only when all of the following hold:

1. The required backend capability exists and is contract-verified;
2. The mobile UI exists in `apps/agent-mobile` at repository truth;
3. The mobile/backend contract is verified (typed binding + tests against the documented contract);
4. Security requirements hold (no secret persistence/logging, fail-closed authorization, session hygiene);
5. Important error/loading/empty/retry states exist;
6. Integration/regression tests exist where the phase mandates them;
7. No known dependency prevents a real agent from actually using it.

**Overall status vocabulary used (exactly):** `MOBILE-COMPLETE`, `BACKEND-ONLY`, `MOBILE-PARTIAL`, `NOT-IMPLEMENTED`, `BLOCKED`, `V2/EXCLUDED`, `DECISION-REQUIRED`.

Each row also distinguishes: **Backend** (implemented/tested), **Mobile UI** (present), **Integration evidence** (suites/commit), **Security status**.

---

## D. Complete requirement matrix (76 rows)

Legend: Backend status = ✔ exists+tested / ◐ exists-partial / ✖ absent. Mobile status = ✔ shipped / ◐ partial / ✖ absent / ⊘ n-a (out of V1 scope).

### D.1 Authentication & session (area: AUTH)

| ID | Requirement | Source | Backend | Mobile UI | Integration evidence | Security | Overall status | Next action |
|---|---|---|---|---|---|---|---|---|
| AUTH-1 | Agent login (`POST /agents/sessions`) | spec §5; a20/a21 | ✔ | ✔ | 6e211e8; `auth-store.test` 9, `login.test` 4 | fail-closed; no mocks/bypass | **MOBILE-COMPLETE** | — |
| AUTH-2 | Mandatory first-login credential rotation (`POST /agents/credentials/rotate`, navigation gate, ≥8 local rule; backend enforces) | spec §5 | ✔ | ✔ | 6e211e8; `rotate-credential.test` 4 | rotation-branch cannot establish a session | **MOBILE-COMPLETE** | — |
| AUTH-3 | Session restoration w/ expiry purge (expo-secure-store) | spec §4 | ✔ | ✔ | 6e211e8; store tests | token-only persistence | **MOBILE-COMPLETE** | — |
| AUTH-4 | Logout (remote revoke best-effort + local purge) | spec §5 | ✔ | ✔ | 6e211e8; store tests | — | **MOBILE-COMPLETE** | — |
| AUTH-5 | Invalid-credential handling (401 → error, no session) | spec §5 | ✔ | ✔ | 6e211e8; store failures | — | **MOBILE-COMPLETE** | — |
| AUTH-6 | Unauthorized 401 → stored-session purge (default for all calls; PIN-only 401 carve-out on cash-in — documented) | spec §4 | ✔ | ✔ | 26d73c6; `api-client.test` 8 | default purge verified; carve-out tested | **MOBILE-COMPLETE** | — |
| AUTH-7 | Session-expired UX (message + path back to login via logout/manual re-auth) | spec §4 | ✔ | ◐ | 3c01bee (describeApiError 401 message at query level) | — | **MOBILE-PARTIAL** | dedicated "session expired → auto route to Login" polish in hardening phase |
| AUTH-8 | Normal credential change post-rotation (`POST /customers/me/password` mirror exists for customers, no agent route) | spec §5 BACKEND GAP | ✖ | ✖ (correctly hidden) | — | — | **BLOCKED** (backend route absent; founder decision recorded in spec) | keep hidden; revisit only if backend adds route |

### D.2 Agent onboarding / application (OBC)

| ID | Requirement | Source | Backend | Mobile UI | Evidence | Overall status |
|---|---|---|---|---|---|---|
| OBC-1 | Agent application start/submission | `agent-application-public.controller.ts`; UAT-AGENT-001 | ✔ public surface | ✖ | spec §3/§11: **not in V1 Mobile** | **V2/EXCLUDED** (workforce-led; do not build without decision) |
| OBC-2 | Application status/approval messaging | UAT-AGENT-002/003; workforce admin | ✔ | ✖ | spec §3 excluded | **V2/EXCLUDED** |
| OBC-3 | Agent class selection during onboarding | agent-authentication/app flows | ✔ | ⊘ | excluded | **V2/EXCLUDED** |

### D.3 Agent profile/account (PRO)

| ID | Requirement | Source | Backend | Mobile UI | Evidence | Overall status | Action |
|---|---|---|---|---|---|---|---|
| PRO-1 | Identity/reference/status | spec §3 | ✔ | ✔ | 3c01bee home+account; tests | **MOBILE-COMPLETE** | — |
| PRO-2 | Agent class (code/name) | spec §5 | ✔ | ✔ | 3c01bee (`agents/me/profile`) | **MOBILE-COMPLETE** | — |
| PRO-3 | MonieNaija receiving number (+copy-compatible) | spec §5 | ✔ | ✔ | 3c01bee (selectable text; clipboard dep deliberately not added — customer precedent) | **MOBILE-COMPLETE** | optional native copy in receipts task |
| PRO-4 | Available electronic balance (financial position) | spec §5 | ✔ | ✔ | 3c01bee; loading/error/retry/no-wallet/staleness | **MOBILE-COMPLETE** | — |
| PRO-5 | Capability chips (fail-closed, reasons) | spec §3/§5 | ✔ | ✔ | 3c01bee `CapabilitiesList`; tests | **MOBILE-COMPLETE** | — |
| PRO-6 | Outlets list presentation | spec §3 | ✔ | ✔ | 3c01bee account surface | **MOBILE-COMPLETE** | — |
| PRO-7 | Terminals list presentation | spec §3 | ✔ | ✔ | 3c01bee account surface | **MOBILE-COMPLETE** | — |
| PRO-8 | Outlet/terminal **detail** surfaces (`/me/outlets/:id`, `/me/terminals/:id`) | spec §3 OutletDetail/TerminalDetail | ✔ | ✖ | not built | **BACKEND-ONLY** | optional read-only detail screens in polish phase |
| PRO-9 | Limits read surface (agent/class limits, used/remaining) | registry `AGENT_RUNTIME_LIMITS` BLOCKED/PRODUCT_DECISION | ✖ product-level | ✖ | — | **BLOCKED** (backend product decision) | none until decision |

### D.4 Agent transaction PIN (PIN area)

| ID | Requirement | Source | Backend | Mobile UI | Evidence | Overall status | Action |
|---|---|---|---|---|---|---|---|
| PIN-1 | PIN used in transaction authorization | spec §5 | ✔ A11 | ✔ in C2W | 26d73c6 | **MOBILE-COMPLETE** (per-flow entry) | reused in C2C/W2C when built |
| PIN-2 | PIN **set** (`POST /agents/me/transaction-pin`) | spec §5 | ✔ | ✖ | — | **BACKEND-ONLY** | PIN management screens (spec phase 4) |
| PIN-3 | PIN **verify** surface (`.../transaction-pin/verify`) | spec §5 | ✔ | ✖ | — | **BACKEND-ONLY** | same phase (possibly fold into set/change UX) |
| PIN-4 | PIN change/rotation | route same as set (auth) | ◐ (set overwrote = change) | ✖ | — | **BACKEND-ONLY** | PIN management |
| PIN-5 | PIN lockout/recovery UX | a14-otp-hardening; backend `PIN_LOCKED` | ✔ backend locks | ◐ message only in C2W errors ("PIN locked — contact support") | 26d73c6 | **MOBILE-PARTIAL** | dedicated lockout guidance screen + support link |
| PIN-6 | PIN separation from login credential | spec §4 | ✔ | ✔ | never stored/logged; tests 22-in-C2W | **MOBILE-COMPLETE** | — |

### D.5 Outlet/terminal operations (OUT)

| ID | Requirement | Source | Backend | Mobile UI | Overall status | Note |
|---|---|---|---|---|---|---|
| OUT-1 | Outlet list/status display | a19/a20 | ✔ | ✔ | **MOBILE-COMPLETE** | Account surface |
| OUT-2 | Outlet **selection** for transactions | cash-in DTO (no outlet fields) | ✖ (not in contract) | ⊘ | **DECISION-REQUIRED** → currently NOT required by backend; attribution is agent-level | record only if later spec asks attribution |
| OUT-3 | Terminal list/status display | a19 | ✔ | ✔ | **MOBILE-COMPLETE** | Account surface |
| OUT-4 | Terminal **selection/binding** | backend transactional DTOs (no terminal param) | ✖ in contract | ⊘ | **DECISION-REQUIRED** → currently NOT required | same |
| OUT-5 | Disabled terminal/unavailable outlet handling in mobile | read-only surfaces + status pills | ✔ read surface | ◐ status displayed; no dedicated screens exist for actions (none required since read-only) | **MOBILE-PARTIAL** | adequate for read-only V1 |

### D.6 Cash→Wallet (C2W)

| ID | Requirement | Source | Backend | Mobile UI | Evidence | Overall status |
|---|---|---|---|---|---|---|---|
| C2W-1 | Recipient entry + validation | spec §5 | ✔ | ✔ | 26d73c6; tests 1–2 | **MOBILE-COMPLETE** |
| C2W-2 | Recipient resolution + name confirmation | `/recipients/resolve` | ✔ | ✔ | tests 2–4 incl. AGENT-recipient block, ownerId stripped | **MOBILE-COMPLETE** |
| C2W-3 | Amount entry (NGN, numeric, >0, ≤2dp) | DTO | ✔ | ✔ | tests 5/5b | **MOBILE-COMPLETE** |
| C2W-4 | Fee presentation (preview) | backend: no preview exists | ✖ (n/a) | ⊘ | per-spec: none shown — correct | **V2/EXCLUDED** for C2W preview; server truth on result if any |
| C2W-5 | Agent PIN at authorize | A11 | ✔ | ✔ | tests 7,9 | **MOBILE-COMPLETE** |
| C2W-6 | Confirmation screen (authoritative only) | spec §4 | ✔ | ✔ | test 6 | **MOBILE-COMPLETE** |
| C2W-7 | Idempotency (body+header), replay → "Already recorded" | A12 | ✔ | ✔ | tests 10,11,21/23 | **MOBILE-COMPLETE** |
| C2W-8 | Success (server reference/status/amount/time) | result contract | ✔ | ✔ | tests 12–14 | **MOBILE-COMPLETE** |
| C2W-9 | Failure taxonomy (insufficient balance, limit, 403, PIN-401, 5xx, network) | spec §5 | ✔ | ✔ | tests 15–19 | **MOBILE-COMPLETE** |
| C2W-10 | History refresh/invalidation | TanStack conventions | ✔ list exists | ✔ | test 20 | **MOBILE-COMPLETE** |
| C2W-11 | Receipt view | V1 receipts mandate; UAT-C2W-013 | ✔ result data | ✖ shared renderer missing | **NOT-IMPLEMENTED** → **dependency RCP-1** |
| C2W-12 | Receipt share/export (text) | UAT-C2W-013 "observable" | ✔ | ✖ | **NOT-IMPLEMENTED** (with RCP-1) |

### D.7 Wallet→Cash Method 1 (W2C — customer co-present)

| ID | Requirement | Source | Backend | Mobile UI | Overall status | Dependency |
|---|---|---|---|---|---|---|
| W2C-1 | Customer identifier + amount entry | DTO | ✔ | ✖ | **NOT-IMPLEMENTED** | next-after-history phase |
| W2C-2 | Agent PIN | A11 | ✔ | ⊘ (pattern ready) | **NOT-IMPLEMENTED** | reuse C2W entry pattern |
| W2C-3 | Customer PIN | DTO `customerPin` | ✔ | ✖ | **NOT-IMPLEMENTED** | same |
| W2C-4 | Customer OTP challenge UX | MFA-API-01 + MOBILE-03 | ✔ | ◐ reusable MfaChallengeCard ready (purpose `WALLET_TO_CASH`); no OTP-input route (by contract) | **MOBILE-PARTIAL** | OTP input field rendered at authorize step of the flow (endpoint = cash-out body) |
| W2C-5 | Authorization: failure/lockout surfaces | a14 + otp-hardening | ✔ | ✖ | **NOT-IMPLEMENTED** | — |
| W2C-6 | Success/failure + status | result contract | ✔ | ✖ | **NOT-IMPLEMENTED** | — |
| W2C-7 | Receipt | receipts mandate | ✔ | ✖ | **NOT-IMPLEMENTED** | RCP-1 |
| W2C-8 | History entry | unified history | ✔ | ✖ | **NOT-IMPLEMENTED** | HIS-1 |

### D.8 Wallet→Cash Method 2 (customer-to-Agent transfer then cash-out handover)

| ID | Requirement | Source | Overall status |
|---|---|---|---|
| W2C2-1 | Normal customer transfer → agent receiving number | customer-app surface; no Agent endpoint | **V2/EXCLUDED** for Agent Mobile — no agent mobile surface exists in spec; agent simply sees the credit via balance/history |
| W2C2-2 | Second electronic cash-handover confirmation for agent | spec screens: none listed; backend: no route | **V2/EXCLUDED** (physical handover is outside the electronic ledger by design; **no such confirmation must not be invented**) |
| W2C2-3 | Dispute path | support tickets (SUP-1) | covered by SUPER surface once built (**NOT-IMPLEMENTED**; generic support lane) |

### D.9 Cash→Cash initiation (C2C)

| ID | Requirement | Source | Backend | Mobile UI | Overall status | Notes |
|---|---|---|---|---|---|---|
| C2C-1 | Beneficiary phone entry/validation | DTO | ✔ | ✖ | **NOT-IMPLEMENTED** |
| C2C-2 | Amount + agent PIN entry | DTO | ✔ | ⊘ pattern ready | **NOT-IMPLEMENTED** |
| C2C-3 | Fee/commission presentation in result (server-returned `feeMinor/vatMinor/totalMinor`) | spec §5 response | ✔ | ✖ | **NOT-IMPLEMENTED** | display returned values only; never computed |
| C2C-4 | Confirmation | spec §4 | ✔ pattern ready | ✖ | **NOT-IMPLEMENTED** |
| C2C-5 | **transferCode display-once** + copy + warning; never re-derived/re-shown | spec §3/§4 | ✔ | ✖ | **NOT-IMPLEMENTED** | critical security row |
| C2C-6 | No unsafe persistence of transferCode | spec §4 | n/a until built | ✖ | **NOT-IMPLEMENTED** | must assert in tests |
| C2C-7 | Idempotency/replay | A12 | ✔ | ✖ | **NOT-IMPLEMENTED** |
| C2C-8 | Receipt + history | receipts mandate | ✔ | ✖ | **NOT-IMPLEMENTED** | RCP-1 + HIS-1 |
| C2C-9 | Expiry presentation (history status only; initiation response lacks expiresAt — known MINOR gap) | spec §5 | ◐ | ✖ | **NOT-IMPLEMENTED** | present via history statuses (UNCLAIMED/CLAIMED/EXPIRED) |

### D.10 Cash→Cash claim / redemption (CLM)

| ID | Requirement | Source | Backend | Mobile UI | Overall status |
|---|---|---|---|---|---|
| CLM-1 | Transfer code + exact beneficiary phone entry | claim DTO | ✔ | ✖ | **NOT-IMPLEMENTED** |
| CLM-2 | Customer identity (customerId) + OTP flow (`purpose=CASH_TO_CASH_CLAIM`) | MFA-API-01 + MOBILE-03 | ✔ | ◐ reusable component ready | **MOBILE-PARTIAL** |
| CLM-3 | Claim execution (claim endpoint) success/pending/rejection | a16/a17 | ✔ | ✖ | **NOT-IMPLEMENTED** |
| CLM-4 | Failed verification / OTP lockout surfaces | a14-otp-hardening/analogous | ✔ | ✖ | **NOT-IMPLEMENTED** |
| CLM-5 | Claimability/expiry state messaging | lifecycle | ✔ statuses | ✖ | **NOT-IMPLEMENTED** |
| CLM-6 | Receipt / co-present payout record + history | receipts mandate | ✔ | ✖ | **NOT-IMPLEMENTED** |

### D.11 Transaction history (HIS)

| ID | Requirement | Source | Backend | Mobile UI | Overall status | Action |
|---|---|---|---|---|---|---|
| HIS-1 | Unified history list (type filter, pagination, refresh) | V1-AGENT-HISTORY-01; UAT-AGENT-009 | ✔ | ✖ (placeholder route only) | **NOT-IMPLEMENTED** | spec phase 7 — top next task |
| HIS-2 | Item fields (reference, status, direction, fee, commission where returned, timestamps, narration) | history service item shape | ✔ | ✖ | **NOT-IMPLEMENTED** |
| HIS-3 | Empty/error/loading/retry states | conventions | n/a | ✖ | **NOT-IMPLEMENTED** |
| HIS-4 | Detail view from list item (list-derived fields ONLY) | A21 design | ✔ | ✖ | **NOT-IMPLEMENTED** |
| HIS-5 | Per-id transaction detail endpoint | spec §5 MINOR GAP | ✖ | — | **DECISION-REQUIRED** (not needed for receipts per A21; do not invent) |
| HIS-6 | Commission column/breakdown in history rows where returned | `AgentHistoryCommission` | ✔ backend | ✖ | **NOT-IMPLEMENTED** (with HIS-1) |

### D.12 Receipts (RCP)

| ID | Requirement | Source | Backend | Mobile UI | Overall status | Finding |
|---|---|---|---|---|---|---|
| RCP-1 | **Shared reusable receipt renderer** (view) for C2W now, reusable by W2C/C2C/CLM | V1 receipts mandate (MOBILE-04); UAT-C2W-013 | ✔ authoritative result/history data | ✖ | **NOT-IMPLEMENTED** — highest-priority infrastructure row | render entirely client-side; safe fields only |
| RCP-2 | Receipt share (text/clipboard share) | UAT "observable" language | ✔ | ✖ | **NOT-IMPLEMENTED** | with RCP-1 |
| RCP-3 | Receipt **image export** | — | n/a | ✖ | **DECISION-REQUIRED** — no authoritative V1 source demands image export; would need a new dependency (inspect carefully) | confirm before adding deps |
| RCP-4 | Receipts must never show internal IDs/PIN/OTP/transferCode (except its own display-once record) | spec §4/§10 | ✔ | n/a | tied to RCP-1 | tested |
| RCP-5 | Receipt re-render after restart (history-derived) | A21 list-derived principle | ✔ list fields | ✖ | **NOT-IMPLEMENTED** (with HIS-1) |

### D.13 Notifications (NOT)

| ID | Requirement | Source | Backend | Mobile UX | Overall status |
|---|---|---|---|---|---|
| NOT-1 | SMS notifications for agent-side events (provider-delivered at backend) | notification subsystem (`agent.*` events, robase) | ✔ backend | ⊘ | **V2/EXCLUDED** for app surface (delivery occurs without app) — document |
| NOT-2 | Agent in-app **notification inbox** | notification-inbox controller = CUSTOMER-only route (`customers/me/notifications`) | ✖ (no agent inbox route) | ✖ | **BLOCKED** → **DECISION-REQUIRED** (add backend route or formally note OTG via SMS only) |
| NOT-3 | Cash→Cash lifecycle notifications observation | UAT line 115 | ✔ backend SMS | ✖ | **V2/EXCLUDED** app-side (server-driven); appears via history statuses |
| NOT-4 | Credential/security event notifications | UAT-AGENT-014 | ✔ backend | ⊘ | **V2/EXCLUDED** app-side for V1 Mobile |
| NOT-5 | Preference handling | — | ✖ | ✖ | **V2/EXCLUDED** (no V1 requirement found) |

### D.14 Support (SUP)

| ID | Requirement | Source | Backend | Mobile UI | Overall status | Action |
|---|---|---|---|---|---|---|
| SUP-1 | Support ticket create/list/detail/messages (`/agents/me/support/**`) | UAT-AGENT-012; controller verified | ✔ | ✖ | **BACKEND-ONLY** | support UI phase |
| SUP-2 | Transaction-linked support (reference-scoped subject/body composition) | product UX pattern (customer-app precedent) | ◐ generic | ✖ | **NOT-IMPLEMENTED** — DECISION on linkage depth |
| SUP-3 | W2C Method 2 disputes / Cash→Cash redemption issues | UAT-W2C-012 adjacent | ✔ generic tickets | ✖ | **NOT-IMPLEMENTED** (via SUP-1) |
| SUP-4 | Escalation/preferences | — | ✖ | ✖ | **V2/EXCLUDED** |

### D.15 Operational state (OPS)

| ID | Requirement | Source | Backend | Mobile UI | Overall status | Action |
|---|---|---|---|---|---|---|
| OPS-1 | Agent suspended → action denial messaging | UAT-AGENT-010; 403 surfaces | ✔ | ◐ 403 message path + capability chips remain visible post-refresh | **MOBILE-PARTIAL** | dedicated suspended-account screen + login denial polish |
| OPS-2 | Agent terminated → login/action denial | UAT-AGENT-011 | ✔ backend | ◐ login fail-closed generic | **MOBILE-PARTIAL** | explicit message path |
| OPS-3 | Service disabled (capability denial) | capabilities API | ✔ | ✔ fail-closed CTAs | **MOBILE-COMPLETE** | — |
| OPS-4 | Outlet unavailable / terminal disabled | read-only status pills | ✔ | ◐ displayed; no actions exist | **MOBILE-PARTIAL** (adequate) | — |
| OPS-5 | Limits exceeded errors | execution-time server errors | ✔ | ✔ C2W handled; same pattern for later flows | **MOBILE-COMPLETE (as required)** richer surfaces tied to LIM-1 decision |
| OPS-6 | Insufficient balance | A12 | ✔ | ✔ (C2W-tested) reuse per flow | **MOBILE-COMPLETE (pattern)** |
| OPS-7 | Provider-unavailable/maintenance surfaced state | — | ◐ generic 5xx sanitize | ◐ shared describeApiError | **MOBILE-PARTIAL** | hardening phase |

### D.16 Commissions (COM)

| ID | Requirement | Source | Backend | Mobile UI | Overall status |
|---|---|---|---|---|---|
| COM-1 | Per-transaction commission in history rows | `AgentHistoryCommission` | ✔ backend | ✖ | **NOT-IMPLEMENTED** (with HIS-1) |
| COM-2 | Commission aggregates (earned/pending/settled dashboard) | registry = `AGENT_COMMISSION` PLANNED/PRODUCT_DECISION | ✖ | ✖ | **BLOCKED** (product decision; no invented rates) |
| COM-3 | Commission presentation within receipts | receipts mandate | ◐ history rows only | ✖ | **NOT-IMPLEMENTED** (with RCP-1 where fields exist) |

### D.17 Limits (LIM)

| ID | Requirement | Source | Backend | Mobile UI | Overall status |
|---|---|---|---|---|---|
| LIM-1 | Read limits (values/used/remaining) | registry `AGENT_RUNTIME_LIMITS` BLOCKED | ✖ product-level | ✖ | **BLOCKED** (decision) |
| LIM-2 | Limit failure UX on executions | A12 | ✔ | ✔ pattern in C2W | **MOBILE-COMPLETE (as required)** |
| LIM-3 | Agent-class limits messaging | class pricing PLANNED | ✖ | ✖ | **BLOCKED** (decision) |

### D.18 Security & privacy (SEC)

| ID | Requirement | Source / evidence | Overall status |
|---|---|---|---|
| SEC-1 | No secrets in navigation params | PIN never in params (C2W design); tests | **MOBILE-COMPLETE** |
| SEC-2 | No PIN/OTP/transferCode persistence | store keys token-only; tests assert `SecureStorage.set` unused by PIN/OTP flows | **MOBILE-COMPLETE** (transferCode: enforce when C2C ships — test gate C2C-6) |
| SEC-3 | No sensitive logging (incl. console.*) | static scans every phase; tests 22 | **MOBILE-COMPLETE** |
| SEC-4 | Internal IDs hidden (ownerId strip; ledger/journal/customer ids never rendered) | bindings/tests | **MOBILE-COMPLETE** |
| SEC-5 | Secure token storage + 401 purge default | store+client tests | **MOBILE-COMPLETE** |
| SEC-6 | No DEV_AUTH_MOCK / bypass anywhere | scans each phase | **MOBILE-COMPLETE** |
| SEC-7 | Screenshot/privacy guard (e.g. FLAG_SECURE on PIN/transferCode screens) | no authoritative V1 requirement found | **DECISION-REQUIRED** (recommend when C2C transferCode ships) |
| SEC-8 | Retry behavior cannot duplicate money | idempotency verified C2W; pattern per flow | **MOBILE-COMPLETE (pattern)** |

### D.19 UX completeness (UX)

| ID | Requirement | Evidence | Overall status | Action |
|---|---|---|---|---|
| UX-1 | Loading/empty/error/retry states per data surface | home/account implemented + hardening tests | **MOBILE-COMPLETE (for built surfaces)**; required for every later flow |
| UX-2 | Confirmation screens | C2W pattern | **MOBILE-COMPLETE (pattern)** |
| UX-3 | Duplicate-submit protection | mutations + disabled buttons, tests 11 | **MOBILE-COMPLETE (pattern)** |
| UX-4 | Network failure guidance | describeApiError NetworkError branch | **MOBILE-COMPLETE** |
| UX-5 | Stale-data indication | “Updated HH:MM” + pull-to-refresh | **MOBILE-COMPLETE (as required)** |
| UX-6 | Back/cancellation mid-flow (incl. PIN state shedding) | ConfirmScreen unmount clear; full-flow back review pending | **MOBILE-PARTIAL** | hardening sweep once flows exist |
| UX-7 | Accessibility basics (labels, focus, contrast) | testID coverage; no formal a11y review yet | **MOBILE-PARTIAL** | hardening phase |

### D.20 Build & release readiness (REL)

| ID | Requirement | Evidence | Overall status | Action |
|---|---|---|---|---|
| REL-1 | Expo config + app identity (`moneynaija-agent`, `ng.monienaija.agent`) + SDK 52 | `npx expo config` verified each phase | **MOBILE-COMPLETE** | — |
| REL-2 | Environment/base-URL strategy (configurable; emulator default) | `src/config/index.ts` | **MOBILE-COMPLETE (V1 dev/emulator)** production override documented via `setBaseUrl` |
| REL-3 | Android/iOS buildability + assets (icon/splash) | assets deliberately omitted like customer app (not in repo) | **MOBILE-PARTIAL** | decide asset pipeline before device UAT (DECISION) |
| REL-4 | No dev-only auth paths / hardcoded secrets | scans each phase | **MOBILE-COMPLETE** | — |
| REL-5 | Real-device UAT (spec phase 11) | not started | **NOT-IMPLEMENTED** | after flows land |

---

## E. Financial-flow matrix

| Flow | Backend | Mobile UI today | Status | Reads for next steps |
|---|---|---|---|---|
| **Cash → Wallet** | ✔ a13 | ✔ full 4-screen flow | **MOBILE-COMPLETE** | receipt view once RCP-1 lands |
| **Wallet → Cash Method 1** (co-present, agent PIN + customer PIN + customer OTP) | ✔ a14 + MFA-API-01 | ✖ (MFA card ready) | **NOT-IMPLEMENTED** | after C2C: CustomerID entry → amount → PIN+OTP authorize → result |
| **Wallet → Cash Method 2** | (customer transfer → agent receiving no.) | n/a per spec | **V2/EXCLUDED** (no emulator-confirmation; only support disputes) |
| **Cash → Cash initiation** | ✔ a15–a17 | ✖ | **NOT-IMPLEMENTED** | next after history + receipt (display-once discipline) |
| **Cash → Cash claim** | ✔ a16/a17 + MFA-API-01 | ✖ (MFA card ready) | **NOT-IMPLEMENTED** | after W2C |
| **Cash → Cash expiry** | ✔ sweep + statuses | history will show | **MOBILE-PENDING via HIS-1** |
| **Agent funding/defunding** | ✔ workforce-only | n/a | **V2/EXCLUDED** |

## F. Cross-cutting product capabilities

| Capability | Status | Note |
|---|---|---|
| Identity/operating context | MOBILE-COMPLETE | home+account |
| Shared receipt renderer | **NOT-IMPLEMENTED (REQUIRED)** | highest-priority infra |
| Notifications in-app | **BLOCKED/DECISION** | no agent inbox route |
| Support | **BACKEND-ONLY** | controller ready |
| Commissions | PARTIAL/BLOCKED split | row-wise |
| Limits | PARTIAL/BLOCKED split | row-wise |
| PIN management | **BACKEND-ONLY** | set/verify routes exist |
| Outlet/terminal attribution | **DECISION-REQUIRED** → currently not required by contracts | record for future |
| Transaction detail endpoint | **DECISION-REQUIRED** → not needed for receipts | preserve A21 design |

## G. Missing-but-required V1 capabilities (by requirement authority)

1. **Unified transaction history** (spec §3/§8 phase 7; V1-AGENT-HISTORY-01 feature #59; UAT-AGENT-009).
2. **Receipts** — shared renderer + view (MOBILE-04 mandate; UAT-C2W-013), same component reused by W2C/C2C/CLM.
3. **Cash→Cash initiation** incl. display-once transferCode discipline (spec §3, §4).
4. **Wallet→Cash Method 1** (spec §3/§5; MFA ready).
5. **Cash→Cash claim assist** (spec §3; MFA ready).
6. **Transaction PIN management** (spec §3/§8 phase 4; set/verify routes exist).
7. **Support UI** (UAT-AGENT-012; controller ready).
8. Operational-state messaging polish (suspended/terminated dedicated states — UAT-AGENT-010/011).

## H. Backend-only capabilities that still need mobile UX

- History list + row details
- Support tickets CRUD
- Transaction PIN set/verify
- Outlet/terminal detail surfaces (optional, read-only)
- Wallet→Cash + Cash→Cash (+claim) executions
- OTP issuance binding exists in UI (reusable component) — flows need to *consume* it

## I. Mobile-partial capabilities

- Customer-MFA challenge UX (ready, unconsumed by transaction screens)
- Operational-state messaging (generic 403 path)
- PIN lockout guidance (message-only)
- Back/cancel discipline + accessibility sweep
- Outlet/terminal disabled-state presentation (adequate read-only)
- Session-expired dedicated UX
- Release assets pipeline

## J. Blocked / decision-required capabilities

| Item | Blocker / decision |
|---|---|
| Agent notification inbox | no Agent-facing inbox route exists — build backend route OR formally record "SMS-only V1" (DECISION-REQUIRED) |
| Per-id transaction detail endpoint | presumed-unnecessary per A21 list-derived design — confirm non-requirement (DECISION-REQUIRED) |
| Receipt image export | no authoritative V1 source requires it; text-share should ship with RCP-1; image = DECISION-REQUIRED |
| Commission dashboard | registry PLANNED/PRODUCT_DECISION (BLOCKED) |
| Limits read surface | registry BLOCKED/PRODUCT_DECISION |
| Normal agent credential change | backend route absent (spec §5 gap) — BLOCKED |
| Outlet/terminal attributional selection | no backend parameter exists — DECISION-REQUIRED (likely deliberate) |

## K. Explicit V2 / exclusions (verified against spec §3/§11)

Agent onboarding/application UI · agent funding/defunding actions · receiving number allocation/ops · outlet/terminal management (CRUD) · bank transfers · NIBSS/external payouts · cards · airtime · bills · rewards · push-only dependencies · aggregator portal · W2C-Method-2 second electronic confirmation · notification preferences UI.

## L. Recommended implementation order (next tasks)

1. **V1-AGENT-MOBILE-06 — Transaction History (list + list-derived detail) + shared Receipt renderer** (RCP-1 + HIS-1…4; receipts client-side from authoritative result/history data).
2. **V1-AGENT-MOBILE-07 — Cash→Cash initiation** (C2C-1…9 incl. display-once transferCode tests C2C-6).
3. **V1-AGENT-MOBILE-08 — Wallet→Cash Method 1** (Customer ID → amount → agent PIN + customer PIN + OTP consumed via MfaChallengeCard).
4. **V1-AGENT-MOBILE-09 — Cash→Cash claim assist** (CLM-*).
5. **V1-AGENT-MOBILE-10 — Transaction PIN management + operational-state polish + support UI** (PIN-2…5, OPS-1/2, SUP-1…3).
6. **V1-AGENT-MOBILE-11 — Hardening + release-readiness + real-device UAT** (UX-6/7, SEC-7 decision, REL-3, REL-5) + decisions on NOT-2/HIS-5/RCP-3.

Ordering rationale: history+receipts first because every money flow afterwards gains verifiable result/history surfaces and the receipt component immediately completes Cash→Wallet.

## M. Verification/test requirements for remaining capabilities

Per flow: API-binding tests (endpoint/body/option discipline), flow-screen suites (entry → validation → confirm → authorize → success/failure taxonomy), PIN/OTP/transferCode non-persistence + non-logging assertions, duplicate-submit, 401/403/5xx/network mapping, history invalidation, capability gating, plus full-suite regressions (`npm test`, `npm run ts:check`, `npx expo config`). Real-PG backend suites remain the contract authority (a13–a17, a21, history, MFA) — do not re-derive with mocks; mobile mocks never claim backend verification. New UAT lanes: run UAT-AGENT-009…012 on a real device once HIS/SUP ship.

## N. "What we must NOT forget" checklist

- [ ] **Receipts** — shared renderer + text-share now; image export decision; safe fields; C2W first then reuse per flow (RCP-1…5)
- [ ] **Notifications** — decide agent inbox (backend route) vs documented SMS-only V1 (NOT-2); lifecycle SMS already server-side (NOT-1/3/4)
- [ ] **Support** — agent tickets create/list/detail/messages UI; transaction-linked drafting (SUP-1…3)
- [ ] **Transaction detail/history** — unified history first; per-id detail endpoint remains DECISION-REQUIRED, receipts do NOT need it (HIS-1…5)
- [ ] **Commissions** — display where history returns it; aggregates are product-decision BLOCKED, never invent rates (COM-1…3)
- [ ] **Limits** — error UX done; read-surface blocked on product decision (LIM-1…3)
- [ ] **Outlet/terminal selection** — currently not required by any transaction contract; do not invent attribution (OUT-2/4)
- [ ] **Agent application/status** — stays out of mobile (workforce-led; spec §3/§11) (OBC-*)
- [ ] **PIN management** — set/change/verify + lockout guidance UI (PIN-2…5)
- [ ] **Operational status** — dedicated suspended/terminated messaging + fail-closed surfaces (OPS-1/2)
- [ ] **Loading/error/empty/retry states** — mandatory on every new surface (UX-1)
- [ ] **Security/privacy** — no secrets in params/storage/logs; internal IDs hidden; screenshot guard decision before C2C transferCode ships (SEC-1…7)
- [ ] **Build/release readiness** — assets pipeline decision, production base-URL override, device UAT (REL-3/5)
- [ ] **Cash→Cash display-once discipline** — transferCode shown once, safe copy, never persisted (C2C-5/6)
- [ ] **W2C Method 2** — remember: NO second electronic cash-handover confirmation; disputes route through support (W2C2-*)

---

*Audit complete. No application code, backend code, migrations, tests, or dependencies were modified. Only this document was added. Do not begin implementation of the recommended next task from this audit.*
