# V1-END-TO-END PROCESS AUDIT — V1-PROCESS-AUDIT-01

**Date:** 2026-09-28 (Africa/Lagos)
**Branch:** `arena/01a0d883-monienaija`
**HEAD audited:** `ec9d341f7dd5f5efaf550b3c6ca852f099123c0f` (V1-REWARD-01, pushed; remote verified identical)
**Mode:** AUDIT / DOCUMENTATION ONLY — **0 source changes, 0 migrations, 0 behavior changes**
**Migrations:** **75** (`1785753600000` → `1785753600074-CreateRewardRules`)
**Continuation lineage:** V1-HARDENING-10 (`5c34185`, 66 migrations) → LIMIT-01..06 → COMMERCIAL-02..04 → DECISION-01..03E → COMMISSION-01 (`3a094ef`) → REWARD-01 (`ec9d341`)

---

## 1. Executive Summary

This audit re-asks, for the current HEAD, the only question that matters:

> **Can a real actor complete each V1 business process from beginning to end using the existing implementation?**

It does not count services or controllers; it traces actors, entry points, authorization,
state transitions, financial/ledger/limit/commercial effects, idempotency, failure
paths, notifications and visibility — from code, migrations, tests, the Capability
Registry and prior verification reports.

**Headline findings:**

1. **The financial core is end-to-end executable.** All seven V1 money processes
   (W→W, Cash→Wallet, Wallet→Cash, Cash→Cash initiation + claim, Customer Funding
   with maker/checker, Agent Funding, Agent Defunding) run inside SERIALIZABLE
   transactions with double-entry ledger posting, runtime limit enforcement
   (LIMIT-04), immutable commercial decision snapshots (DECISION-02/03A–03E),
   idempotency, audit and notifications. Fee is NOT_CONFIGURED, commission NONE,
   reward NONE **by deliberate policy** — that is not a defect.
2. **Customer registration is a back-office workflow, not a self-serve journey — and
   is the weakest verified chain.** Registration is workforce-initiated
   (`POST /api/v1/customers` → `DRAFT`, `kyc NONE/NOT_STARTED`), with **no phone
   verification step implemented** (`verified_at` is never set by any business
   process) and **no OTP delivery mechanism** for registration. Wallet creation,
   credential creation, PIN setup and activation are separate manual steps. The
   journey is executable but only through multiple workforce operations touching
   several endpoints; several lifecycle questions are **UNDEFINED — PRODUCT
   DECISION REQUIRED** (§4, §23).
3. **A concrete authorization anomaly was identified:** `PATCH /api/v1/customers/:id`
   (status lifecycle: DRAFT→ACTIVE / SUSPENDED / CLOSED) is classified by the
   RoutePolicyRegistry block for `/api/v1/customers/:id` which allows
   `CUSTOMER` principals with `customerAccess: SELF`, and `CustomerController` has
   no workforce-only guard. A customer with a valid session could potentially
   self-transition lifecycle status (incl. self-activation). Separately, customer
   login validates **credential + account lock**, not `customers.status`, so a
   DRAFT/SUSPENDED customer with active credentials can obtain a session.
   **SECURITY DECISION REQUIRED** (§12, §22, §24). Not fixed in this task (per mandate).
4. **Workforce role model is two-layered and only the coarse layer is enforced.**
   Principal types `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` are enforced everywhere;
   finance role keys (`FINANCE_PREPARER/CONTROLLER/AUDITOR/ADMIN`) exist as an
   assignment registry with bootstrap discipline, but customer-funding enforcement
   checks only principal-type + `maker≠checker` (202/403) — role keys are never
   consulted in the funding path. Older docs claiming "approve = OPERATOR" overstate
   the narrowing. **SECURITY/PRODUCT DECISION REQUIRED; NOT silently reconciled** (§22).
5. **Everything that is NOT_IMPLEMENTED/BLOCKED is blocked by an explicit decision,
   not by missing engineering:** fee charging policy, commission policy (16-item
   register), reward policy (22-item register), reconciliation break-resolution
   governance (accounting), external SMS/Push providers (deployment), V2 scope
   (12 exclusions). The Reward/Commission engines are machinery-complete and
   intentionally unconfigured.

**Counts (Section 21 matrix — 74 audited processes):** see §27 for exact tallies —
COMPLETE **51** · PARTIAL **10** · BACKEND_ONLY **2** · METADATA_ONLY **1** ·
NOT_IMPLEMENTED **4** · BLOCKED (product **5**, incl. fee/commission/reward policy and
reversal; security/approval-depth deficits classified as PARTIAL rows **#61–65** with
decisions in §24; accounting **1**) · V2 separately enumerated (not V1 gaps).

---

## 2. Audit Methodology

For every process: **(1–25)** the mandatory checklist — actor, entry point,
preconditions, inputs, validation, authentication, authorization, initial state,
transitions, approvals, financial effect, ledger effect, limit effect, commercial
effect, idempotency, concurrency, audit, notifications, success terminal state,
failure terminal states, retry, duplicate/replay, visibility, surface, executability.

Sources, in order of authority:
1. Source code (`src/…` — cited inline), migrations (`src/migrations/…`, 75).
2. Route authorization (`src/authorization/route-policy-registry.ts`,
   `authorization.service.ts`, `runtime-access.guard.ts`).
3. Integration tests (`test/*.integration.spec.ts`, 62 suites / 1325 tests green at
   the audited tree's final verification runs).
4. Capability Registry seed (114 entries, live source of truth for capability state).
5. Prior verification reports/audits in `docs/` (260 files). Where they disagree
   with the current code, the disagreement is recorded — **not reconciled** (§22).

Status vocabulary (exactly one per process):

| Status | Definition |
|---|---|
| **COMPLETE** | Evidence supports a real actor executing the journey end-to-end today (API + authorization + durable effects + terminal states + failure semantics). |
| **PARTIAL** | Journey executes, but with documented non-launch-blocking gaps (surface, convenience, or visibility) OR executes only through multiple un-orchestrated steps. |
| **BACKEND_ONLY** | Durable backend behavior exists but no actor-reachable entry point for the stated actor. |
| **METADATA_ONLY** | Schema/config/registry exists, nothing executes with it at runtime. |
| **NOT_IMPLEMENTED** | No executable path exists. |
| **BLOCKED — PRODUCT DECISION** | Absent because an explicit product decision is pending (machinery may exist). |
| **BLOCKED — SECURITY DECISION** | Absent/at-risk because an explicit security decision is pending. |
| **BLOCKED — ACCOUNTING DECISION** | Absent because an explicit accounting/governance decision is pending. |
| **V2 / OUT_OF_SCOPE** | Explicitly outside the V1 boundary (never a V1 gap). |

UI note: this repository is the backend. "Customer App / Agent App UI" appears only
as the API surfaces those clients would consume (`A23/A21` contracts); actual UI
implementation is outside the repository and marked accordingly.

---

## 3. V1 Boundary

**In scope (internal NGN ecosystem):** Customer platform+wallet, Ledger, W→W,
Customer Funding, Agent platform, Cash→Wallet, Wallet→Cash, Cash→Cash, Agent
Funding/Defunding, Aggregator, Outlets, Terminals, Admin, Finance Operations,
Support, Notifications, Runtime Limits, Product Catalogue, Fee infrastructure,
Commercial Decision Snapshot, Commission Engine, Reward Engine.

**V2 / OUT_OF_SCOPE (12, per V1-008 §2 / boundary docs):** Wallet→Bank,
Bank→Wallet live provider, NIBSS, Wema, Providus, NinePSB, external settlement,
cards, dollar cards, airtime, data, electricity, cable, betting, non-NGN.
Repository spot-check confirms no implementations: no `wema|providus|ninepsb`
references, `src/partner/nibss-nip` callback is an internal stub, currency CHECKs
are NGN-centric. Modules `bank/`, `virtual-account/`, `partner/`, `payment/`,
`quote/` are **external/V2-oriented parked surfaces** (registry scope V2, 12 V2
capability entries) — excluded from the V1 matrices below.

---

## 4. A — Customer Registration & Lifecycle

### 4.1 What the code actually establishes (registration in detail)

**Entry point:** `POST /api/v1/customers` → `CustomerController.create()` →
`CustomerService.create()`. There is **no public/self-serve registration endpoint**
(`grep register|signup` in customer surfaces: none; A23 Customer-App contract
contains no registration route — it starts at login).

**Authorization:** no explicit route-policy block matches `POST /api/v1/customers`
(the closest block requires a trailing `/api/v1/customers/`), so it falls to the
**registry default**: `internal-route`, `allowedPrincipalTypes:
SUPPORT/OPERATOR/SERVICE/PRIVILEGED`, scope `internal:access`.
⇒ **Registration actor = any workforce principal.** Not maker/checker-gated.

**Records created (exactly one, in one transaction):**
`customers` row `{id, reference, type, status: DRAFT (default), kycLevel: NONE,
kycStatus: NOT_STARTED, version: 1}` + `audit_events` `CUSTOMER/CREATED`.
Unique `reference` → retry of same reference → **409 Conflict**. **No phone
uniqueness is enforced anywhere in this path** (contact methods are a separate,
later POST).

**The detailed registration questionnaire, answered from code:**

| Question | Evidence-based answer |
|---|---|
| What starts registration? | Workforce `POST /api/v1/customers` (SUPPORT/OPERATOR/SERVICE/PRIVILEGED via default route policy) |
| Records created / order | `customers` (DRAFT) + audit; no wallet, no profile, no contact method, no credentials |
| Validations | reference format/unique (409), type enum, UUID; `ValidationPipe` |
| Phone verification required? | **No.** `customer_contact_methods.verified_at` exists but **nothing in the codebase sets it** (only MFA-challenge internals set an unrelated `verifiedAt` on `mfa_challenges`) |
| OTP actually delivered? | **Not for registration.** No registration OTP flow exists. MFA method types (TOTP/SMS/EMAIL) + challenge machinery exist for MFA enrollment, but notification delivery is Console/Test only (§16) |
| KYC required before activation? | **No.** `CustomerService.updateStatus` enforces only the status transition table; no KYC precondition |
| KYC states | `kycLevel: NONE/LEVEL_1/LEVEL_2/LEVEL_3`; `kycStatus: NOT_STARTED → PENDING → APPROVED/REJECTED` (+ re-open to PENDING) via `POST /customers/:id/kyc-assessment` |
| Created as PENDING or ACTIVE? | **DRAFT** (explicit default) |
| What causes activation? | `PATCH /api/v1/customers/:id {status:'ACTIVE'}` — transition DRAFT→ACTIVE always legal |
| Automatic or manual? | Manual, via PATCH |
| Who can activate? | **Route policy allows CUSTOMER (SELF) + all workforce types; controller has no workforce-only guard → see §22 C-3 (SECURITY DECISION). Intended actor per docs: workforce** |
| When is the wallet created? | **Not at registration.** Explicit `POST /customers/:id/wallet` (customer-wallet controller) / `POST /wallets` (wallet controller), or **lazy creation inside Cash→Wallet / Wallet→Cash** (`agent-cash-in.service` / `agent-cash-out.service` call `createWallet` idempotently) |
| When is the receiving number created? | Nothing is "created": `GET /customers/me/receiving-identity` derives it from the **primary PHONE contact method** (`normalizedValue`, else value) — so it exists once a phone contact method is recorded (add via `POST /customers/:id/contact-method`); recipient resolution maps phone → customer → wallet |
| When can the customer log in? | When credentials exist (`POST /customers/:id/authentication-credentials`) **and** the credential is ACTIVE and not account-locked. **Login validates the credential, not `customers.status`** (see §22 C-4) |
| When can the customer receive money? | When a wallet exists (lazy on first Cash→Wallet, or explicit) and the counterparty can resolve them (phone) — **independent of status=ACTIVE in the verified code paths** (transfer service checks *wallet* status ACTIVE, not customer status) |
| When can the customer send money? | Login + `POST /customers/me/transaction-pin` set + `POST /customers/me/transfers` (PIN verified; wallet ACTIVE; limits enforced; see §5) |
| Transaction PIN usable when? | Immediately after setup via `POST /customers/me/transaction-pin` (`A24` 17/17) |
| Registration abandoned | DRAFT persists; transition DRAFT→* allowed later (DRAFT→SUSPENDED/CLOSED also legal); no cleanup/reaper exists |
| OTP fails | **N/A — no registration OTP exists** (UNDEFINED — PRODUCT DECISION REQUIRED whether one is required) |
| Phone already registered | **Not detected** — no uniqueness over contact methods in creation flows; duplicate phones only surface indirectly at recipient resolution ambiguity |
| Registration retried | Same reference → 409; new reference → a second, unrelated customer row is created |
| Downstream step fails | Each later step (profile/contact/credentials/wallet/PIN/onboarding) is its own endpoint + transaction; a mid-journey failure leaves the completed subset persisted (no saga/rollback across steps) |
| Onboarding metadata | `POST/GET/PATCH /customers/:id/onboarding`, agreements, onboarding-tasks, approval, `GET …/onboarding-readiness` exist (admin-side tracking) — **tracking only; gates nothing** |

### 4.2 Process verdicts (A1–A12)

| # | Process | Status | Basis / missing step |
|---|---|---|---|
| A1 | Registration | **PARTIAL** | Executes (workforce, DRAFT, audit, 409 retry) but no phone verification, no public path, no bundled activation |
| A2 | Phone verification | **METADATA_ONLY** | `verified_at` column; no process writes it; no OTP |
| A3 | Authentication/session creation | **COMPLETE** | `POST /customers/login|sessions` → `executionService.authenticate` → `sessionService.issue`; lockout, failed attempts, rotation, reset tokens (`customer-authentication`) |
| A4 | Customer activation | **PARTIAL** | Mechanically complete (transition map + audit); actor-set/KYC-gating anomalies (§22 C-3/C-4) pending SECURITY/PRODUCT decision |
| A5 | Profile creation | **COMPLETE** | `POST /customers/:id/profile` + `GET /customers/me/profile` (A26) |
| A6 | KYC status/progression | **PARTIAL** | Assessment endpoints + status machine exist; progression gates nothing (wallet/limits/PIN unaffected by KYC level — no eligibility consumption found); class differentiation unconfigured by design |
| A7 | Wallet creation | **COMPLETE** | Explicit endpoints + lazy idempotent creation in Cash→Wallet/Wallet→Cash; ledger-derived balance, `allowNegativeBalance: false` on customer-funds wallets |
| A8 | Receiving identity / number | **COMPLETE** | Phone-based receiving identity + recipient resolution (A9) |
| A9 | Transaction PIN setup | **COMPLETE** | `POST /customers/me/transaction-pin` + `/verify` (A24); agent PIN separately (§9) |
| A10 | Becoming transaction-ready | **PARTIAL** | All pieces exist but unbundled (credential → login → PIN → wallet); `GET /customers/me/status` + admin `GET …/onboarding-readiness` report readiness but enforce nothing |
| A11 | Suspension/reactivation | **COMPLETE** | Transition map ACTIVE↔SUSPENDED (+CLOSED terminal), audited, `deletedAt` on CLOSED |
| A12 | Password/session management | **COMPLETE** | Full credential lifecycle incl. reset requests/tokens, MFA enrollments/methods, trusted devices, recovery codes, security events, session list/logout |

**Idle questions the repository cannot answer (recorded, not invented):**
whether self-serve registration is a V1 requirement; whether phone verification/OTP
is mandatory pre-activation; whether KYC must gate wallets/transactions; whether
CLOSED customers require data handling. → all **§23 PRODUCT DECISIONS**.

---

## 5. B — Customer Transaction Processes

Per-flow traces are built from the wired implementation (`transfer.service.ts`,
`agent-cash-in/out.service.ts`, `agent-cash-to-cash*.ts`,
`customer-funding.service.ts`), the LIMIT-04 wiring evidence and the
DECISION-02/03A–03E snapshot reports.

Reference trace (all six follow this spine with product-specific deltas):

```
request (actor token)
→ authN (CUSTOMER session / AGENT session)
→ authZ (route policy: CUSTOMER SELF / AGENT SELF + eligibility)
→ recipient/agent/customer resolution + ownership checks
→ amount/currency validation (bigint minor, NGN)
→ [LIMITS] LimitEnforcementService.enforceWithManager
     (profile resolve → MIN/MAX → WALLET_BALANCE_MAX → DAILY/WEEKLY/MONTHLY/YEARLY
      _AMOUNT/_COUNT; reservation RESERVED, FAIL → 4xx code; later COMMIT or RELEASE)
→ [LEDGER] postJournalInTransaction (SERIALIZABLE, balanced DR=CR)
→ limit reservations COMMITTED (or RELEASED on failure)
→ [SNAPSHOT] commercial_decision_snapshots INSERT
     (fee NOT_CONFIGURED, commission NONE, reward NONE, limit evidence)
→ entity row terminal save (COMPLETED / CLAIMED / APPROVED …) + audit + outbox
→ notifications (outbox → dispatcher → deliveries)
→ history/visibility (unified customer history / admin views)
```

Snapshot ordering is success-point placement (DECISION-02 §): ledger + limits commit
**then** snapshot insert, atomically — **failed transactions record no snapshot**
(failure is the FAILED row + audit). That is the documented, tested behavior.

| # | Process | Status | Key verified facts |
|---|---|---|---|
| B1 | Wallet→Wallet | **COMPLETE** | `POST /customers/me/transfers`; PIN verified; recipient via `destinationWalletId`/phone; wallet-ACTIVE checks; `SERIALIZABLE`; idempotency `commandId` (replay → original result; conflict → 409); limits enforced (`v1-limit-04` 28 tests); snapshot + unified history; failure → FAILED row with `failureCode` (INSUFFICIENT_FUNDS, LIMIT_*, RECIPIENT_*, PIN_INVALID…) |
| B2 | Customer Funding | **COMPLETE** | maker/checker (§7). Customer-facing history `GET /customers/me/funding-history` |
| B3 | Cash→Wallet (agent cash-in) | **COMPLETE** | `POST /agents/me/cash-in`; agent eligibility (PENDING/SUSPENDED/TERMINATED → ineligible); agent PIN; capabilities; limits; lazy customer-wallet creation; DR funding-pool / CR customer wallet; snapshot (03A) |
| B4 | Wallet→Cash (agent cash-out) | **COMPLETE** | mirror of B3; customer balance guard; snapshot (03B) |
| B5 | Cash→Cash initiation | **COMPLETE** | `POST /agents/me/cash-to-cash`; UNCLAIMED row + transfer code hash + beneficiary phone (canonical 10-digit) + `expires_at` (default 7 days, env-configurable); DR agent wallet / CR unclaimed liability; snapshot (03C) |
| B6 | Cash→Cash claim | **COMPLETE** | `POST /agents/me/cash-to-cash/:id/claim`; OTP(=transfer code) hash compare; beneficiary phone binding; identity verification (KYC/IdentityDocument reuse); failed-attempt counter + `is_locked/lock_reason` lockout; DR unclaimed / CR claimant wallet; claim resets counters; snapshot (03C) |

**Failure/retry behavior (matrix detail in §20):** insufficient balance →
FAILED/4xx no posting; invalid recipient → 4xx; suspended actor → ineligible/403;
invalid PIN → 4xx + attempt handling; OTP failure → attempt++ → lockout; limit
rejection → 4xx + reservation RELEASED; duplicate request → 200/201 replay of the
original (`IdempotencyService.reserve` + unique keys); conflicting idempotency →
409; concurrency → SERIALIZABLE + optimistic `version`; rollback → whole-journal
atomicity (partial effects impossible — verified by suites); notification failure →
isolated (logged FAILED delivery; **never rolls back the financial transaction**);
commercial rule ambiguity → the engines' fail-closed 409 (only reachable once a
future approved wiring calls them — today no flow invokes commission/reward);
unconfigured policy → normal path (fee NOT_CONFIGURED / commission NONE / reward
NONE), not an error.

---

## 6. C — Commercial Process

Seven distinct pieces, three states kept scrupulously separate:

| Piece | TECHNICAL CAPABILITY | PRODUCTION POLICY CONFIGURED | RUNTIME POLICY ENABLED |
|---|---|---|---|
| 1. Product Catalogue (`products`, 7 V1 codes, FK target of all rule systems) | **COMPLETE** (registry + seed + API) | **Yes** (7 products seeded) | Referenced by rule systems as FK; not a runtime gate |
| 2. Fee Rule Registry (`fee_rules` + admin API) | **COMPLETE** | **NO — zero rules** | n/a |
| 3. Fee Resolution (`FeeRuleResolverService` + in-flow call) | **COMPLETE — wired as EVIDENCE into all 7 flows** (DECISION-02/03A–03E) | NO rules → every resolution answers "no rule" | Flows record `feeNotConfigured` shape; **no money charged ever** |
| 4. Limit Resolution/Enforcement (`limit_profiles/rules/assignments/usages/reservations` + `LimitEnforcementService`) | **COMPLETE — wired into the financial flows** (LIMIT-04: reservation-before-posting, commit/release, Lagos windows) | **TEST/seed assignments exist in test DBs; production rule *values* = product decision** (H-03 vocabulary now has a schema) | Enforcing where assignments exist; MIN/MAX/WALLET_BALANCE_MAX authoritative |
| 5. Commercial Decision Snapshot | **COMPLETE — all 7 flows, immutable, idempotency-keyed, workforce read API** | n/a (records whatever the decision states were) | Capturing fee NOT_CONFIGURED / commission NONE / reward NONE + limit evidence |
| 6. Commission Engine (+registry) | **COMPLETE machinery** (COMMISSION-01) | **NO — zero rules, not a defect** | NOT wired into any flow (static guard test) |
| 7. Reward Engine (+registry) | **COMPLETE machinery** (REWARD-01) | **NO — zero rules, not a defect** | NOT wired into any flow (static guard test) |

Per-product commercial state (identical shape for all 7): product identity seeded;
limit behavior enforced where assigned; fee resolution returns `NOT_CONFIGURED`
(charge = 0); commission decision `NONE`; reward decision `NONE`; snapshot recorded
on success only; the commercial decision IS recorded; rules are technically
supported but **unconfigured**. No VAT/tax anywhere (never invented; §25).

---

## 7. D — Customer Funding

| Path | Status | Trace verdict |
|---|---|---|
| **D1. Customer→Customer funding** | **BLOCKED — PRODUCT DECISION** | The requirement itself is unestablished: customers cannot create funding requests (`customer-funding-customer.controller` exposes only `GET /customers/me/funding-history`); customer-to-customer value movement exists as **B1 (W→W)**. Whether a distinct customer-initiated funding-request process must exist is **UNDEFINED — PRODUCT DECISION REQUIRED** |
| **D2. Agent/Cash→Wallet** | **COMPLETE** | = B3 |
| **D3. Operations→Customer funding (maker/checker)** | **COMPLETE** | Full trace below |

D3 trace (verified in `customer-funding.service.ts`, V1-001 26/26):
Maker (workforce principal, any of 4 types) `POST /internal/customers/:customerId/
funding-requests` → row `customer_funding_requests` `{PENDING, makerId, makerType,
reference, idempotency_key, request_hash, version}` (unique idempotency → replay
safe) + audit. Checker `POST /internal/customer-funding-requests/:id/approve` →
**`makerId !== checkerId` enforced (403)** (`maker!==checker`), SERIALIZABLE,
`DEBIT funding-pool / CREDIT customer wallet` (balanced journal), status
PENDING→APPROVED with optimistic `version`, audit + outbox → notifications +
customer history. Reject `POST …/reject` → PENDING→REJECTED, **no journal posted**,
audit + outbox.

Explicitly verified: maker cannot self-approve (403) ✓; non-workforce (CUSTOMER/
AGENT) rejected at controller (403) ✓; rejection creates no financial transaction ✓;
duplicate approval → version/idempotency guard (4xx) ✓ (state already APPROVED→
regress impossible → 404/409); rollback atomic ✓; limit rejection → normal 4xx path
(funding is ADMIN-directed; limit wiring per LIMIT-04 where applicable) ✓; customer
visibility via funding history + unified transactions (`type=FUNDING`) ✓; admin
listing `GET /internal/customer-funding-requests` ✓.

---

## 8. E — Agent Lifecycle

| # | Step | Status | Evidence |
|---|---|---|---|
| E1–E3 | Application create / class select / submit | **COMPLETE** | Public applicant surface `POST /api/v1/agents/applications` (+`:id`, `:id/submit`) — unauthenticated by design (`AGENT_LOGIN` mode; ownership via `applicantReference`); states DRAFT→SUBMITTED(→UNDER_REVIEW) |
| E4–E5 | Review / approve (+reject) | **COMPLETE** | Internal admin `POST /internal/agents/applications/:id/approve|reject` (workforce); states →APPROVED/REJECTED |
| E6–E7 | Agent creation / activation | **COMPLETE** | `POST /internal/admin/agents/applications/:id/activate` (V1-003); transition PENDING→ACTIVE |
| E8 | Login | **COMPLETE** | `POST /agents/login`, `POST /agents/sessions` (`AGENT_LOGIN`; A7 13/13) |
| E9 | Transaction PIN | **COMPLETE** | `agent_transaction_pins` entity + PIN verified inside financial executions (cash-in/cash-out/financial-execution services) |
| E10 | Wallet/float | **COMPLETE** | Reuses `wallet_accounts` (`customerId = agentId`, CUSTOMER_FUNDS liability); H-07 financial position; lazy/explicit creation |
| E11 | Receiving number | **COMPLETE** | `agent_receiving_numbers` canonical 10-digit + collision discipline vs customers (A9) |
| E12 | Capabilities/services | **COMPLETE** | `agent_service_capabilities`, `GET /agents/me/capabilities` (A10) |
| E13 | Limits | **COMPLETE (machinery)** | Legacy `agent_classes.applicable_limits` JSON + modern limit assignments; enforcement wired (LIMIT-04) |
| E14–E15 | Outlets / Terminals | **COMPLETE** | Full CRUD + lifecycle (A20) |
| E16 | Suspension | **COMPLETE (with §8.1 caveats)** | `POST /internal/admin/agents/:id/suspend` OPERATOR/SERVICE/PRIVILEGED (SUPPORT denied); transition ACTIVE→SUSPENDED |
| E17 | Reactivation | **COMPLETE** | SUSPENDED→ACTIVE |
| E18 | Termination | **COMPLETE** | →TERMINATED (terminal; TERMINATED→ACTIVE fail-closed) |

### 8.1 Suspension/termination consequences (verified)

| Question | Evidence-based answer |
|---|---|
| New transactions for suspended agent? | **Blocked.** Cash-in/out services treat `AGENT_PENDING/SUSPENDED/TERMINATED/NOT_FOUND/DELETED` as **ineligible** (explicit reasons); same family of guard for financial executions |
| Existing accepted (in-flight) transactions? | V1 flows are synchronous; no asynchronous accepted-then-suspended state exists |
| Cash→Cash pending/unclaimed at suspension? | Unclaimed rows persist unchanged; **claim is executed by/for the claimant** (beneficiary phone + transfer code + identity), not an agent-wallet action — the claimant journey is unaffected (claimant CUSTOMER receives credit). The initiating agent cannot run new cash flows |
| Agent wallet balance? | Untouched (no forfeiture logic); visible via financial-position |
| Physical cash assumptions | **UNDEFINED — PRODUCT DECISION REQUIRED** — ledger models the electronic side (`AGENT_FUNDING_POOL`); physical float reconciliation with a suspended/terminated agent is not modeled |
| Claim/redeem after suspension/termination? | Claimant-side claim still executable (not an agent privilege); agent-side new flows blocked |
| Customer experience sending to suspended agent? | Recipient-side customer flows do not reference agent status; cash-in with that agent is refused (ineligible) |

---

## 9. F — Agent Financial Processes

All seven are **COMPLETE** (backend, authorized, idempotent, ledger-balanced,
snapshotted since 03E), with commission/reward deliberately `NONE` (engines
available, unconfigured — **not an implementation failure**):

| # | Process | Verified essentials |
|---|---|---|
| F1 Agent Funding | `POST /internal/agents/:id/fund` (workforce 4 types incl. SUPPORT); DR `AGENT_FUNDING_POOL` / CR agent wallet; SERIALIZABLE; snapshot (03E); audit; position visibility |
| F2 Agent Defunding | mirror (`/defund`), DR agent wallet / CR pool; overdraft protected (wallet non-negative; pool may go negative as ASSET pool) |
| F3 Cash→Wallet | = B3 |
| F4 Wallet→Cash | = B4 |
| F5 Cash→Cash initiation | = B5 |
| F6 Cash→Cash claim | = B6 |
| F7 Agent financial position | `GET /agents/me/financial-position` + `GET /internal/agents/:id/financial-position` (H-07 16/16; ledger-derived; safe projection) |

Authorization: agent self surface = `AGENT SELF` (+ eligibility, capabilities, PIN);
workforce funding surface = route-policy `internal/agents` block
(SUPPORT/OPERATOR/SERVICE/PRIVILEGED). Idempotency: funding/cash flows use
`IdempotencyService.reserve` + unique keys; concurrency SERIALIZABLE + optimistic
versions; notifications via outbox intents (incl. agent lifecycle events — with the
agent-SMS channel dependency noted in §16).

---

## 10. G — Cash→Cash Special Lifecycle

```
Agent (eligible, PIN, limits)  POST /agents/me/cash-to-cash
  → status UNCLAIMED;  DR agent wallet / CR CASH_TO_CASH-UNCLAIMED liability
  → transfer code (hash stored), beneficiary phone (canonical 10d), expires_at set
  → snapshot(03C) + audit + outbox
Claimant (phone match + code + identity docs)  POST …/:id/claim
  → OTP(transfer-code) hash check;  failed attempts++ → is_locked (+lock_reason)
  → IDENTITY VERIFICATION (KYC/IdentityDocument reuse)
  → DR unclaimed / CR claimant customer wallet
  → status CLAIMED (counters & locks reset); snapshot + audit + notifications
Auto (scheduled sweep, CASH_TO_CASH_EXPIRY_SECONDS, default 7d)
  → status EXPIRED;  DR unclaimed / CR agent-side pool (see note)
  → snapshot + audit + notification;  NOT a refund of any customer payment
```

| Aspect | State |
|---|---|
| Transfer code | Generated at initiation; only **hash** persisted; physical/verbal conveyance (no SMS) |
| Phone binding | Enforced (`beneficiary_phone` canonical compare, 400 on mismatch) |
| OTP | The transfer code itself (format-validated input); no separate OTP issuance |
| Identity verification | Present (KYC/IdentityDocument reuse) before credit |
| Failed verification / retry / lockout | Attempt counter per transfer; `is_locked` + `lock_reason` at threshold; 403 when locked; success resets counters |
| Agent relationships | Initiating agent recorded; outlet/terminal attribution supported (A20 metadata) |
| Expiry vs financial reversal | **Expiry is its own lifecycle event** sweeping unclaimed liability back toward the agent funding side; there is **no automatic refund** and no invented reversal (funds already sit in platform/liability accounts) |
| Commercial snapshot | Recorded on initiation + claim (+expiry evidence per 03C report); success-point rule applies |
| Limit usage | Enforced at initiation per LIMIT-04 wiring; claim side documented in 03C/LIMIT-04 reports |
| Notifications | `cash_to_cash claimed/expired` intents in the dispatcher catalogue |
| Support investigation | Customer/agent ticket creation with `relatedTransferId`/funding linkage + admin unified views |

**Verdict: COMPLETE.**

---

## 11. H — Aggregator

| # | Item | Status | Evidence |
|---|---|---|---|
| H1 | Creation | **COMPLETE** | `POST /internal/aggregators` (workforce) (A18) |
| H2 | Lifecycle | **COMPLETE** | suspend/reactivate/terminate; statuses ACTIVE/SUSPENDED/TERMINATED |
| H3 | Agent relationships | **COMPLETE** | `POST /internal/aggregators/:agg/agents` (attach); `aggregator_agent_relationships` |
| H4 | Funding via aggregator | **COMPLETE** | `POST /internal/aggregators/:agg/agents/:id/fund` — requires ACTIVE relationship; source = platform pool (V1: no aggregator ledger account, by design) |
| H5 | Visibility | **COMPLETE** | `GET /internal/aggregators`, `/:id`, `/:agg/agents` |
| H6 | Permissions | **PARTIAL** | Workforce-only administration; aggregators have **no login/API principal surface of their own** (AUTH principal type `AGGREGATOR` exists in the enum for future/partner scope, but no aggregator session/issue path in V1 codebase surface) |
| H7 | Financial position | **PARTIAL** | No aggregator-scoped position endpoint (documented as not a V1 requirement: relationship-only); agent positions + reconciliation cover traceability |
| H8 | Commission relationship | **BLOCKED — PRODUCT DECISION** | Registry supports `AGGREGATOR` recipient type (COMMISSION-01); **zero rules configured**; no allocation policy exists (16-item register) |

---

## 12. I — Backend / Workforce Users (inventory-first)

### 12.1 Actual principals and auth mechanisms (from code)

| Principal type | How authenticated | Session |
|---|---|---|
| CUSTOMER | `POST /customers/login` → credential (PBKDF2) + account-lock → session | customer_sessions |
| AGENT | `POST /agents/login` / `POST /agents/sessions` | agent sessions (`AGENT_LOGIN`) |
| AGGREGATOR | enum exists; no V1 issuance path found | — |
| SUPPORT / OPERATOR / SERVICE / PRIVILEGED | `POST /internal/a2/workforce/sessions {idToken}` (OIDC, `WORKFORCE_ASSERTION` → session) | workforce_sessions (A2) |

**Finance/additional role machinery (A2):** `A2FinanceRoleAssignment` registry
(`FINANCE_PREPARER / FINANCE_CONTROLLER / FINANCE_AUDITOR / FINANCE_ADMIN`);
bootstrap endpoint creates the first `FINANCE_ADMIN` exactly once (hard guard);
`FINANCE_ADMIN` assignment by API is prohibited thereafter. Workforce config carries
`financeRoles`, `makerCheckerRules`, `rateLimits`, `trustedProxies`, session TTL,
JWKS. Privileged-action workflow exists: `POST /internal/a2/workforce/approvals/request`,
`approvals/:id/approve` with states REQUESTED→APPROVED/REJECTED/CANCELLED/CONSUMED/
EXPIRED (+EMERGENCY_ACTIVE/REVOKED) — a generic maker/checker engine for privileged
actions. MFA: `AssuranceLevel PASSWORD|MFA`; MFA enrollment/method machinery
(customer-auth + workforce config).

### 12.2 Role-by-role (as enforced today)

| Role (principal type) | Purpose (observed) | Available actions (route-policy enforced) | Maker/checker | Notes |
|---|---|---|---|---|
| SUPPORT | Front-line ops/read + maker | Customer/agent/aggregator/ticket/notification investigation (H-06/07/09); create funding requests (maker); fund/defund agents; create aggregators; **denied** on agent lifecycle transitions, fee/commission/reward registries, admin-lifecycle | maker in customer funding (checker blocked from self) | Broadest read surface |
| OPERATOR | Operations control | + agent lifecycle (suspend/terminate/reactivate/activate), approve funding (checker), commercial config registries | checker in customer funding | Lifecycle authority |
| SERVICE | System/service ops | + PATCH customer records, broad operational writes | both roles possible | Service integrations |
| PRIVILEGED | Privileged administration | + everything incl. legacy/restricted admin; workforce bootstrap/approvals surface | both possible | Highest tier; privileged-approval engine available |

Granular/finance-role permissions: **assignment registry exists but is NOT consulted
by the funding flow** (principal-type only). Configurable-role capability for
Support/Ops/Finance-Maker/Finance-Checker/Agent-Ops/Compliance/Reconciliation/
Supervisor/Privileged-Admin: **partially supportable** — assignment + approval
machinery + scopes exist; enforcement would require wiring role keys into
route/service policy = **SECURITY DECISION REQUIRED** (explicitly not implemented).

MFA requirements: assurance-level machinery exists; **which actions REQUIRE MFA is
not enforced/defined** (SECURITY DECISION). Workforce suspension/deactivation:
workforce-authentication entity carries status fields (exact lifecycle API not
verified in this pass → INSUFFICIENT EVIDENCE; recorded in §24). Scope restrictions:
`customer/agent/aggregatorAccess: NONE/SELF/ASSIGNED/ANY` exist per principal and
are enforced by the runtime guard (`ASSIGNED` used for scoped workforce views).

---

## 13. J — Finance Operations

| # | Operation | Request | Approval | Execution | Rejection | Reversal | Investigation | Classify |
|---|---|---|---|---|---|---|---|---|
| J1 Customer funding maker | SUPPORT/any-workforce POST request | n/a (creates PENDING) | — | — | — | investigation via lists | **COMPLETE** |
| J2 Customer funding checker | — | `POST …/approve` (maker≠checker, version-checked) | atomic DR pool/CR wallet | `POST …/reject` no journal | none (V2/decision) | H-06 unified + reconciliation | **COMPLETE** |
| J3 Agent funding | direct workforce action | single-action (no maker/checker, by design note) | atomic | n/a | none | H-07 | **COMPLETE** |
| J4 Agent defunding | mirror | mirror | atomic | n/a | none | H-07 | **COMPLETE** |
| J5 Funding investigation | — | — | — | — | — | `GET /internal/customer-funding-requests*` + customer 360 + reconciliation | **COMPLETE** |
| J6 Financial position | — | — | — | — | — | customer/agent ledger-derived positions | **COMPLETE** |
| J7 Reconciliation | — | — | — | — | — | 9-check report, trial-balance, finance, account activity (read-only) | **COMPLETE** |
| J8 Reconciliation breaks | — | — | — | — | — | **NO break-resolution workflow exists** (no table/endpoint) | **BLOCKED — ACCOUNTING DECISION** |
| J9 Privileged financial operations | — | approvals engine exists (request/approve/consume) | — | — | — | consumption wiring breadth unproven → **PARTIAL** |

No reversal workflow anywhere (ledger `reverseJournal` capability exists; ops surface
absent intentionally — V2/product+accounting). Not invented here.

---

## 14. K — Admin Operations (action classes)

Legend: **R** read-only · **OM** operational mutation · **FM** financial mutation ·
**M/C** maker/checker · workforce principal tiers in brackets.

| # | Action | Class | Verdict |
|---|---|---|---|
| K1 Customer investigation (`GET /internal/customers/:id(+transactions|wallets|balance|support-tickets)`) | R (SUPPORT+) | **COMPLETE** |
| K2/K3/K4 wallet/balance/history | R | **COMPLETE** |
| K5 Customer support tickets mgmt | OM | **COMPLETE** |
| K6 Agent investigation (`GET /internal/agents/:id`, financial-position) | R | **COMPLETE** |
| K7 Agent financial position | R | **COMPLETE** |
| K8 Agent lifecycle transitions | OM (OPERATOR+) | **COMPLETE** |
| K9 Aggregator management | OM (SUPPORT+) | **COMPLETE** |
| K10 Notification diagnostics | R (SUPPORT+) | **COMPLETE** |
| K11 Commercial configuration (fee/commission/reward/product registries) | OM (OPERATOR+) | **COMPLETE machinery / policy deliberately empty** |
| K12 Limit configuration (profiles/rules/assignments) | OM | **COMPLETE** |
| K13 Product configuration | OM → catalogue read; product writes restricted (governance docs) | **COMPLETE (backend)** |
| K14 Audit/event investigation (`GET /internal/audit/events`) | R | **COMPLETE** |
| K15 Reconciliation | R | **COMPLETE** |

No irreversible hard-deletes found in admin surfaces (soft-delete/deactivation
discipline). Customer financial mutations exist **only** through the maker/checker
funding process (FM + M/C) — correct containment.

---

## 15. L — Support

`support_tickets` (OPEN→IN_PROGRESS→RESOLVED→CLOSED; categories incl.
TRANSFER/FUNDING/WALLET/CASH_IN/CASH_OUT/CASH_TO_CASH/PROFILE/PIN/AUTHENTICATION/
AGENT_FUNDING/OUTLET/TERMINAL/OTHER; priorities; `assignedTo`;
`relatedTransferId`/`fundingRequestId` indexed; optimistic version; soft delete) +
`support_ticket_messages` (immutable; `isInternal` privacy).

| # | Item | Status |
|---|---|---|
| L1 Customer ticket creation | **COMPLETE** (`POST /customers/me/support/tickets`, SELF) |
| L2 Agent ticket creation | **COMPLETE** (`POST /agents/me/support/tickets`) |
| L3 Internal ticket creation | **COMPLETE** (`POST /internal/support/tickets`) |
| L4 Assignment | **COMPLETE** (`POST …/assign`) |
| L5 Messages | **COMPLETE** |
| L6 Internal messages | **COMPLETE** — never dispatched to notification deliveries (filter verified by tests) |
| L7 Resolve / L8 Close | **COMPLETE** |
| L9 Reopen | **NOT_IMPLEMENTED** (CLOSED terminal; no reopen transition found) |
| L10/L11 Transaction/funding linkage | **COMPLETE** (loose FKs + indexed references; join convenience = P2 per prior audits) |
| L12 Audit | **COMPLETE** |
| L13/L14/L15 visibility | Customer/Agent self views + workforce `GET /internal/support/tickets(+:id|/messages)` + customer 360 alias — **COMPLETE** |

---

## 16. M — Notifications

Chain (verified end-to-end): event → `outbox_events` → `NotificationDispatcherService`
→ `mapEventToIntents` catalogue (17 intents: funding approved/rejected, transfer
completed, support×5, cash-to-cash claimed/expired, agent lifecycle…; internal
support notes filtered) → channel resolver (Customer SMS via primary contact method
= authoritative; **Agent SMS → SKIPPED: agent phone dependency missing**; **Push →
SKIPPED: no device-token table V1**) → template (NGN formatting, safe content) →
redacted payload → `notification_deliveries` (idempotent
`(event_key,recipient,channel)` upsert; PENDING→SENT/FAILED/SKIPPED) →
**provider = Console/Test only** (`NOTIFICATION_PROVIDER_TOKEN` factory; no
Twilio/Termii/FCM credentials anywhere) → customer inbox → admin diagnostics.

| Surface | Status |
|---|---|
| Provider-neutral pipeline, idempotent delivery rows, safe projections | **COMPLETE** |
| Customer inbox (`GET /customers/me/notifications`, hides SKIPPED) | **COMPLETE** |
| Admin diagnostics (`GET /internal/notifications/deliveries`, SUPPORT) | **COMPLETE** |
| Real SMS provider | **NOT_IMPLEMENTED (external)** — deployment config (Termii/Twilio), not code debt; *SENT here means console-delivered* |
| Real Push provider | **NOT_IMPLEMENTED (external)** — plus missing token store by design |
| Agent SMS channel | **PARTIAL** — SKIPPED with documented missing-dependency reason |

Retry: delivery row lifecycle + dispatcher idempotency exists; provider-level retry
is provider concern (Console/Test trivial). Notification failure **never** reverses
financial state (isolated by design).

---

## 17. N — Business State Tables

Terminal = bold. Invalid transitions fail closed (409) everywhere shown.

| Entity | States | Legal transitions (actor) | Terminal |
|---|---|---|---|
| Customer | DRAFT·ACTIVE·SUSPENDED·CLOSED | DRAFT→ACTIVE/SUSPENDED/CLOSED (PATCH, see §22 C-3); ACTIVE→SUSPENDED/CLOSED; SUSPENDED→ACTIVE/CLOSED | **CLOSED** (sets deletedAt) |
| Customer KYC status | NOT_STARTED·PENDING·APPROVED·REJECTED | NOT_STARTED→PENDING; PENDING→APPROVED/REJECTED; APPROVED/REJECTED→PENDING (re-open) | none |
| Customer credential | PENDING·ACTIVE·SUSPENDED·REVOKED | per credential lifecycle service (rotation/lockout/unlock) | **REVOKED** |
| Agent | PENDING·ACTIVE·SUSPENDED·TERMINATED | PENDING→ACTIVE/TERMINATED; ACTIVE→SUSPENDED/TERMINATED; SUSPENDED→ACTIVE/TERMINATED (admin lifecycle; TERMINATED→ACTIVE fail-closed) | **TERMINATED** |
| Agent application | DRAFT·SUBMITTED·UNDER_REVIEW·APPROVED·REJECTED | applicant submit; admin approve/reject | **APPROVED / REJECTED** |
| Aggregator | ACTIVE·SUSPENDED·TERMINATED | workforce lifecycle ops | **TERMINATED** |
| Wallet | ACTIVE·SUSPENDED·CLOSED | wallet/ledger services (+transfer requires ACTIVE on both sides) | **CLOSED** |
| Funding request | PENDING·APPROVED·REJECTED | maker create (PENDING) → checker approve/reject (maker≠checker) | **APPROVED / REJECTED** |
| Transfer (W→W) | PENDING·PROCESSING·PENDING_RECOVERY·UNKNOWN·COMPLETED·FAILED·CANCELLED | synchronous spine: →COMPLETED / →FAILED (failureCode); recovery states exist for infra paths | **COMPLETED / FAILED / CANCELLED** |
| Cash→Cash | UNCLAIMED·CLAIMED·EXPIRED (+lock fields, failed_attempts) | initiate (UNCLAIMED) → claim (CLAIMED, claimant) → expiry sweep (EXPIRED) | **CLAIMED / EXPIRED** |
| Support ticket | OPEN·IN_PROGRESS·RESOLVED·CLOSED | workforce assign/status/resolve/close; no reopen | **CLOSED** |
| Notification delivery | PENDING·SENT·FAILED·SKIPPED | dispatcher/provider outcome | **SENT / FAILED / SKIPPED** |
| Commercial snapshot | immutable on INSERT | corrections only via `supersedes_snapshot_id` compensating rows | **immutable** |
| Limit reservation | RESERVED·COMMITTED·RELEASED | enforce (RESERVED) → commit after ledger / release on failure | **COMMITTED / RELEASED** |
| Fee/Commission/Reward rule | is_active × effective window × version | workforce PATCH (optimistic version; no DELETE) | soft-delete/deactivate |
| Privileged action approval | REQUESTED·APPROVED·REJECTED·CANCELLED·CONSUMED·EXPIRED·EMERGENCY_ACTIVE·EMERGENCY_REVOKED | approval engine | **CONSUMED/EXPIRED/…** |
| Password reset request | REQUESTED·IN_PROGRESS·COMPLETED·EXPIRED·CANCELLED·REJECTED (+token ACTIVE/USED/EXPIRED/REVOKED) | customer-auth service | **COMPLETED/…** |

---

## 18. O — Actor / Permission Matrix

Cells: ✅ can execute · ◑ scoped/partial · — not possible · **D** by decision pending.

| Action ↓ / Actor → | Customer | Agent | Aggregator | SUPPORT | OPERATOR | SERVICE | PRIVILEGED |
|---|---|---|---|---|---|---|---|
| Self login/session | ✅ | ✅ | — | ✅(OIDC) | ✅ | ✅ | ✅ |
| W→W send | ✅(SELF+PIN) | — | — | — | — | — | — |
| Cash→Wallet (agent op) | (beneficiary) | ✅ | — | — | — | — | — |
| Cash→Cash initiate/claim | (claimant=B6*) | ✅ | — | — | — | — | — |
| Own wallets/balance/history | ✅ | ✅(position) | — | ◑(investigate any) | ◑ | ◑ | ◑ |
| Set own transaction PIN | ✅ | ✅ | — | — | — | — | — |
| Create customer (registration) | — | — | — | ✅ | ✅ | ✅ | ✅ |
| PATCH customer lifecycle status | **⚠ self? (§22 C-3)** | — | — | ✅ | ✅ | ✅ | ✅ |
| Create funding request (maker) | — | — | — | ✅ | ✅ | ✅ | ✅ |
| Approve/reject funding (checker) | — | — | — | ✅(≠maker) | ✅(≠maker) | ✅(≠maker) | ✅(≠maker) |
| Agent fund/defund | — | — | — | ✅ | ✅ | ✅ | ✅ |
| Agent lifecycle transitions | — | — | — | — | ✅ | ✅ | ✅ |
| Agent application approve/activate | — | — | — | — | ✅ | ✅ | ✅ |
| Aggregator create/lifecycle | — | — | — | ✅ | ✅ | ✅ | ✅ |
| Support tickets (create/self) | ✅ | ✅ | — | manage | manage | manage | manage |
| Commercial registries (fee/comm/reward/products/limits) | — | — | — | **—**(fee/comm/reward) / ✅(limits?)** | ✅ | ✅ | ✅ |
| Notification diagnostics | — | — | — | ✅ | ✅ | ✅ | ✅ |
| Reconciliation (read) | — | — | — | ✅ | ✅ | ✅ | ✅ |
| Privileged approvals request/approve | — | — | — | ◑(config) | ◑ | ◑ | ✅ |
| Workforce bootstrap / finance roles | — | — | — | — | — | — | ✅(bootstrap once) |

*claim executes with claimant identity even though present at an agent surface.
**limit registry blocks predate the fee/commission/reward blocks (LIMIT-01/02 docs);
commercial-rule registries are OPERATOR+ (V1-COMMERCIAL-03/04, COMMISSION-01,
REWARD-01). Text cells marked **D** where enforcement depth awaits the §24 security
decision.

---

## 19. P — Financial Effect Matrix

Per successful flow (all journals balanced DR=CR, SERIALIZABLE; fee always 0;
commission NONE; reward NONE; snapshot on success only):

| Flow | Debit | Credit | Ledger journal | Limit reservation→usage | Snapshot | Physical cash |
|---|---|---|---|---|---|---|
| W→W | source wallet (CUSTOMER_FUNDS liability) | destination wallet | yes (+principal only) | yes (sender-side rules) | yes | none |
| Customer funding (approve) | funding pool (platform) | customer wallet | yes | per wiring where assigned | yes (03D) | none |
| Cash→Wallet | agent funding pool (ASSET) | customer wallet (lazy create allowed) | yes | yes | yes (03A) | agent receives cash (off-ledger assumption) |
| Wallet→Cash | customer wallet | agent funding pool | yes | yes | yes (03B) | agent pays cash out |
| Cash→Cash initiation | agent wallet | C2C-UNCLAIMED liability | yes | yes | yes (03C) | agent receives cash |
| Cash→Cash claim | C2C-UNCLAIMED | claimant customer wallet | yes | per wiring | yes | agent hands cash |
| Cash→Cash expiry | C2C-UNCLAIMED | agent/pool side (03C/A17 evidence) | yes | n/a (release path) | yes | return of electronic value to initiating side — **not a refund** |
| Agent funding | AGENT_FUNDING_POOL ASSET | agent wallet liability | yes | n/a | yes (03E) | operations cash-in to float |
| Agent defunding | agent wallet | AGENT_FUNDING_POOL | yes | n/a | yes (03E) | float returns cash |

Contra-entries for fees/commission/reward: **none exist** (no such postings today;
the accounting-treatment registers — commission §16-item, reward §22-item — define
what *would be* required, deliberately uncreated).

---

## 20. Q — Failure / Retry / Idempotency Matrix

| Failure | W→W | Funding (maker/checker) | Cash→Wallet / Wallet→Cash | Cash→Cash init/claim | Agent fund/defund |
|---|---|---|---|---|---|
| Duplicate request | original result replayed (idempotent, no double post) | same (unique idempotency keys) | same | init replay-safe; claim replay-safe | replay-safe |
| Conflicting idempotency (same key, different payload) | 409 | 409 | 409 | 409 | 409 |
| Insufficient balance | FAILED row `INSUFFICIENT_FUNDS`, no posting | n/a (pool may go negative on asset side) | 4xx (out)/lazy wallet | 4xx | 4xx on agent wallet (defund) |
| Limit rejection | 4xx `LIMIT_*`, reservation RELEASED, FAILED row | 4xx where wired | 4xx + release | 4xx + release | where wired |
| Authorization failure | 401/403 (SELF, PIN) | 403 (workforce-only; maker≠checker) | 403/400 (eligibility) | 403 (locked)/400 (phone mismatch) | workforce types only |
| PIN failure | 4xx (attempts) | n/a | 4xx | n/a (code=OTP) | n/a |
| OTP failure | n/a | n/a | n/a | claim attempts++ → `is_locked` 403 | n/a |
| Concurrency | SERIALIZABLE + optimistic version; suites prove single-winner | same | same | same | same |
| TX rollback | whole-flow atomic; no partial journal possible | atomic | atomic | atomic | atomic |
| Notification failure | delivery FAILED, flow unaffected (never reverses) | same | same | same | same |
| Commercial rule ambiguity | unreachable today (engines not wired); engines fail closed 409 when wired | same | same | same | same |
| Configuration missing | normal: fee NOT_CONFIGURED, commission NONE, reward NONE | — | — | — | — |

Retry guidance embedded in behavior: idempotent keys make client retries safe;
failed rows are terminal and queryable (history shows `failureCode`); locked
transfer codes require new initiation (or support flow); reservations auto-release.

---

## 21. R — Process Completeness Matrix (74 rows)

Status legend per §2. "Decision" column: P=product, S=security, A=accounting.

| # | Process | Actor | Entry point | Final state | Fin. effect | AuthZ | Notif. | Audit | Status | Missing step | Decision / follow-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
|1|Registration|workforce|POST /customers|DRAFT|none|default workforce|—|✓|PARTIAL|phone verification, public path, bundling|P: §23-1|
|2|Phone verification|—|—|—|—|—|—|—|METADATA_ONLY|whole process (only verified_at column)|P: §23-2|
|3|Customer login|customer|POST /customers/login|session|none|CUSTOMER_LOGIN|—|✓|COMPLETE|—|—|
|4|Activation|workforce(intended)|PATCH /customers/:id|ACTIVE|none|see ⚠|—|✓|PARTIAL|KYC-gating, actor narrowing|S: §24-1|
|5|Profile creation|workforce/customer|POST /customers/:id/profile|persisted|none|route policy|—|✓|COMPLETE|—|—|
|6|KYC progression|workforce|POST :id/kyc-assessment|APPR/REJ|none|workforce|—|✓|PARTIAL|gates nothing|P: §23-3|
|7|Wallet creation|workforce/lazy|POST wallets / lazy cash flows|ACTIVE|ledger acct|policy|—|✓|COMPLETE|—|—|
|8|Receiving identity|system|contact methods|ACTIVE|none|—|—|✓|COMPLETE|—|—|
|9|Transaction PIN setup|customer/agent|POST me/transaction-pin|set|none|SELF|—|✓|COMPLETE|—|—|
|10|Transaction-ready aggregate|customer|multi-step|ready|—|—|—|✓|PARTIAL|no orchestrated single path|P: §23-1|
|11|Suspend/reactivate|workforce|PATCH|ACTIVE/SUSP|none|⚠ as #4|—|✓|COMPLETE|—|—|
|12|Password/session mgmt|customer|customer-auth routes|managed|none|SELF/workforce|—|✓|COMPLETE|—|—|
|13|W→W|customer|POST me/transfers|COMPLETED/FAILED|yes|SELF+PIN|✓|✓|COMPLETE|—|—|
|14|Customer funding (ops)|workforce|funding-requests|APPR/REJ|yes|M/C|✓|✓|COMPLETE|—|—|
|15|Cash→Wallet|agent|POST agents/me/cash-in|COMPLETED|yes|AGENT SELF+PIN|✓|✓|COMPLETE|—|—|
|16|Wallet→Cash|agent|me/cash-out|COMPLETED|yes|same|✓|✓|COMPLETE|—|—|
|17|Cash→Cash initiation|agent|me/cash-to-cash|UNCLAIMED|yes|same|✓|✓|COMPLETE|—|—|
|18|Cash→Cash claim|claimant via agent surface|me/cash-to-cash/:id/claim|CLAIMED|yes|phone+code+KYC|✓|✓|COMPLETE|—|—|
|19|Cash→Cash expiry|scheduler|sweep|EXPIRED|yes (unclaimed→agent side)|n/a|✓|✓|COMPLETE|—|—|
|20|Agent funding|workforce|internal/agents/:id/fund|posted|yes|4 tiers|✓|✓|COMPLETE|—|—|
|21|Agent defunding|workforce|…/defund|posted|yes|4 tiers|✓|✓|COMPLETE|—|—|
|22|Agent application|applicant|public applications|APPR/REJ|none|AGENT_LOGIN+workforce|✓|✓|COMPLETE|—|—|
|23|Agent activation|workforce|admin …/activate|ACTIVE|none|OPERATOR+|✓|✓|COMPLETE|—|—|
|24|Agent login|agent|POST agents/login|session|none|AGENT_LOGIN|—|✓|COMPLETE|—|—|
|25|Agent PIN/capabilities/receiving number|agent|me/*|provisioned|none|SELF|—|✓|COMPLETE|—|—|
|26|Agent lifecycle (suspend/reactivate/terminate)|workforce|admin/agents/:id/*|SUSP/TERM|none|OPERATOR+|✓|✓|COMPLETE|physical-cash handling open|P: §23-8|
|27|Outlets & terminals|workforce/aggregator-link|…/outlets|TERM/SUSP|none|privileged|—|✓|COMPLETE|—|—|
|28|Agent financial position|agent/workforce|me/financial-position / internal|derived|read|SELF+workforce|—|✓|COMPLETE|—|—|
|29|Aggregator creation & lifecycle|workforce|internal/aggregators|TERM|none|workforce|—|✓|COMPLETE|—|—|
|30|Aggregator↔agent link & fund-via|workforce|:agg/agents|posted|yes|workforce|—|✓|COMPLETE|—|—|
|31|Aggregator login/API|aggregator|—|—|—|—|—|—|BACKEND_ONLY*|principal type exists; no issuance|P: §23-9|
|32|Aggregator financial position|workforce|—|—|—|—|—|—|PARTIAL|no scoped endpoint (traceable via agent/recon)|P: §23-9|
|33|Support ticket lifecycle (all 3 creators)|customer/agent/workforce|…/support/tickets|CLOSED|none|SELF/workforce|✓|✓|COMPLETE|—|—|
|34|Ticket reopen|—|—|—|—|—|—|—|NOT_IMPLEMENTED|transition absent|P: §23-10|
|35|Notification pipeline|system|outbox→dispatcher|SENT/FAILED/SKIPPED|none|—|✓|✓|COMPLETE|—|—|
|36|Real SMS delivery|provider|—|—|—|—|—|—|NOT_IMPLEMENTED (external)|Termii/Twilio config|deployment|
|37|Real Push delivery|provider|—|—|—|—|—|—|NOT_IMPLEMENTED (external)|FCM/APNS + token store|deployment|
|38|Agent SMS channel|system|resolver|SKIPPED|—|—|—|✓|PARTIAL|agent-phone dependency|—|
|39|Customer notification inbox|customer|me/notifications|read|read|SELF|—|—|COMPLETE|—|—|
|40|Admin notification diagnostics|workforce|internal/notifications/deliveries|read|read|SUPPORT+|—|—|COMPLETE|—|—|
|41|Product catalogue|workforce|product-catalog API|seeded(7)|none|OPERATOR+|—|✓|COMPLETE|—|—|
|42|Fee rule registry + resolver|workforce|fee-rules API|definitions only|none|OPERATOR+|—|✓|COMPLETE (machinery)|policy empty by design|—|
|43|Fee charging|flow|runtime|NOT_CONFIGURED|none|—|—|✓|BLOCKED — PRODUCT|pricing policy lands in fee_rules|P: §23-4|
|44|Commercial decision snapshot|flow|all 7 flows|immutable record|records|workforce read|—|✓|COMPLETE|—|—|
|45|Limit definition/assignment|workforce|limit-catalog APIs|assigned|none|OPERATOR+|—|✓|COMPLETE|—|—|
|46|Runtime limit enforcement|flow|LimitEnforcementService|ALLOW/REJECT|usage tracked|—|—|✓|COMPLETE|production rule VALUES pending|P: §23-5|
|47|Commission engine + registry|workforce|commission-rules API|definitions only|none|OPERATOR+|—|✓|COMPLETE (machinery)|—|—|
|48|Commission charging/posting|flow|—|NONE|none|—|—|✓|BLOCKED — PRODUCT(+A)|16-item register|P: §23-6|
|49|Reward engine + registry|workforce|reward-rules API|definitions only|none|OPERATOR+|—|✓|COMPLETE (machinery)|—|—|
|50|Reward crediting/posting|flow|—|NONE|none|—|—|✓|BLOCKED — PRODUCT(+A)|22-item register incl. accounting|P: §23-7|
|51|Admin customer 360|workforce|internal/customers/*|read|read|SUPPORT+|—|—|COMPLETE|—|—|
|52|Admin agent investigation|workforce|internal/agents/*|read|read|SUPPORT+|—|—|COMPLETE|—|—|
|53|Admin support/recon/audit consoles|workforce|internal/*|read|read|SUPPORT+|—|—|COMPLETE|—|—|
|54|Reconciliation reporting|workforce|internal/reconciliation/*|violations view|read|workforce|—|✓|COMPLETE|—|—|
|55|Reconciliation break resolution|workforce|—|—|—|—|—|—|BLOCKED — ACCOUNTING|no workflow/table|A: §25-1|
|56|Reversal (ops)|workforce|—|—|—|—|—|—|BLOCKED — PRODUCT+V2|reverseJournal exists, no workflow|P/A: §23-11|
|57|Beneficiary registry|workforce|internal beneficiaries|registered|none|workforce|—|✓|BACKEND_ONLY|customer app surface + W→W integration|P: §23-12|
|58|Customer unified history|customer/workforce|me/transactions; internal|read|read|SELF/SUPPORT|—|—|COMPLETE|—|—|
|59|Agent unified history|agent/workforce|—|—|—|—|—|—|NOT_IMPLEMENTED|new service + type decisions|P: §23-13|
|60|Finance role assignment registry|PRIVILEGED|a2/workforce/roles|assigned|none|privileged|—|✓|COMPLETE (machinery)|enforcement not consulted|S: §24-2|
|61|Finance-role-based enforcement|workforce|—|—|—|—|—|✓|PARTIAL|funding path uses principal-type only|S: §24-2|
|62|Privileged action approvals|workforce|a2/workforce/approvals|CONSUMED|none|privileged tiers|—|✓|PARTIAL|breadth of consumption wiring|S: §24-3|
|63|MFA requirement policy|—|config/machinery|—|—|—|—|—|PARTIAL|requirement mapping absent|S: §24-4|
|64|Workforce session establishment|workforce|a2/workforce/sessions|session|none|OIDC|—|✓|COMPLETE|—|—|
|65|Workforce suspension/deactivation|workforce|entity status fields|?|none|?|—|✓|PARTIAL|lifecycle API breadth unverified|S: §24-5|
|66|Customer onboarding tracking|workforce|:id/onboarding*|readiness|none|workforce|—|✓|COMPLETE (as tracking)|gates nothing|—|
|67|Customer→Customer funding (D1)|customer|—|—|—|—|—|—|BLOCKED — PRODUCT|requirement unestablished|P: §23-14|
|68|Agent cash eligibility guards|system|services|ineligible|prevents fin. effect|—|—|✓|COMPLETE|—|—|
|69|Idempotency infrastructure|system|all money flows|replay-safe|prevents duplicates|—|—|✓|COMPLETE|—|—|
|70|Audit event pipeline|system|all mutations|immutable|—|—|—|✓|COMPLETE|—|—|
|71|Outbox/event pipeline|system|all money flows|PUBLISHED|—|—|✓|✓|COMPLETE|—|—|
|72|Safe projections (sensitive-field hiding)|system|all read APIs|redacted|—|—|—|✓|COMPLETE|—|—|
|73|Health/readiness endpoints|any|api/v1/health|ok|read|public|—|—|COMPLETE|—|—|
|74|Capability registry console|workforce|capability API|114 entries|read|workforce|—|✓|COMPLETE|—|—|

\*BACKEND_ONLY here means: the type/principal exists in auth enums but no V1
session-issuing surface — by prior design, not defect.

---

## 22. S — Contradictions (recorded, NOT reconciled)

| # | Source A | Source B | Concrete difference | Likely impact | Decision required |
|---|---|---|---|---|---|
| C-1 | **V1-HARDENING-10 §12/§13** (limits "not enforced", no commercial snapshots, 66 migrations) | **LIMIT-04 + DECISION-02/03 docs + code** (enforcement wired in flows; snapshots in all 7; 75 migrations) | Same runtime, opposite claims — lineage drift: H-10 predates LIMIT/COMMERCIAL tasks | None for behavior (H-10 is superseded); readers of H-10 alone get a stale picture | None for code; supersession recorded here |
| C-2 | **A2 finance-role docs + V1-001 narrative** ("maker SUPPORT, checker OPERATOR"/finance roles) | `customer-funding-internal.controller.ts` + `customer-funding.service.ts` | Enforcement accepts **all four** workforce types for maker and for checker; only `maker≠checker` is guaranteed; `FINANCE_*` keys never consulted in the funding path | Broader approval authority than the narrative implies | **SECURITY/PRODUCT**: either wire role keys or amend the documented intent |
| C-3 | Docs imply workforce-driven customer lifecycle | `route-policy-registry.ts` (`/api/v1/customers/:id` allows `CUSTOMER` SELF) + `CustomerController` (no workforce-only guard) + `customer.service.ts` (transitions incl. DRAFT→ACTIVE) | A customer principal may be able to **self-PATCH own lifecycle status** (self-activate, self-unsuspend) — no code-level barrier found | Self-activation bypasses the intended back-office activation | **SECURITY**: confirm intended actor set; add narrowing guard in a later fix task (not fixed here) |
| C-4 | "When can the customer log in?" (business intent: after activation) | login path (`customer-app.controller.ts` → `executionService.authenticate` + `sessionService.issue`) | Authentication validates **credential status + account lock only**; `customers.status` (DRAFT/SUSPENDED/CLOSED) is never consulted on the session path | DRAFT/SUSPENDED customers with credentials can hold valid sessions (combined with C-3: self-activation) | **SECURITY**: bind sessions to customer status (decision + later fix) |
| C-5 | `docs/V1-CAPABILITY-REGISTRY.md` (279-line static snapshot from an earlier era) | Live seed `capability.seed.ts` (114 entries incl. limit/commercial/commission/reward states) | Doc is historical/drifted vs live source | Reader confusion only (registry itself is suite-verified) | None (treat seed as authoritative) |
| C-6 | A23 Customer-App contract (no registration) + code (internal-only creation) | Business expectation of self-serve signup (implied by typical wallet UX) | Registration is back-office only; A23 starts at login | Product-scope ambiguity for launch UX | **PRODUCT**: is self-serve registration V1 or later? (§23-1) |
| C-7 | Notification deliveries "SENT" semantics | §16 provider reality (Console/Test) | SENT = console/test-write, not carrier delivery | Misread as real SMS delivery | None (documented); deployment config pending |
| C-8 | Old docs: "approve = OPERATOR / reject = PRIVILEGED" (H-10 §8 phrasing) | Controller accepts all 4 workforce types for both | Same as C-2 (consolidated) | — | covered by C-2 |

---

## 23. Product Decisions Required

1. **Registration model (P)** — self-serve public signup vs back-office-only; required starter bundle (profile/phone/credentials/wallet); abandoned-registration cleanup. *(A1, §4)*
2. **Phone verification (P)** — is verified phone mandatory before activation/transactions? If yes: OTP delivery mechanism + `verified_at` writer + retries. *(A2)*
3. **KYC gating (P)** — what (if anything) each KYC level unlocks; whether KYC status must gate wallets/transactions/limits. *(A6)*
4. **Fee policy (P)** — per-product fee rates/precedence/VAT; lands in `fee_rules` (machinery ready). *(C, §6)*
5. **Limit policy values (P)** — authoritative values/semantics per product (H-03's 10 questions + which profiles are assigned in production). *(C)*
6. **Commission policy (P)** — full 16-item register (recipients, splits, precedence, accounting), then a wiring pilot. *(H8, §6)*
7. **Reward policy (P)** — full 22-item register incl. funding source, caps/frequency usage-state design, accounting. *(§6)*
8. **Agent suspension/termination physical cash handling (P)** — float reconciliation expectations. *(E, §8.1)*
9. **Aggregator self-service surface (P)** — whether aggregators get their own login/position surface (current: relationship-only). *(H6/H7)*
10. **Support reopen policy (P)** — reopen transitions or "new ticket" convention. *(L9)*
11. **Reversal policy (P+A)** — when ledger reversals become an ops workflow (V2-graded today). *(J9)*
12. **Beneficiary exposure (P)** — customer-app beneficiary management + W→W beneficiaryId integration (UX polish). *(§21-57)*
13. **Agent unified transaction history (P)** — require or reject a unified agent history abstraction (types/counterparty/direction). *(§21-59)*
14. **Customer-initiated funding (D1) (P)** — does it exist as a process at all? *(D1)*
15. **Expired cash-to-cash handling nuance (P)** — confirm expiry crediting semantics vs any refund expectations (no auto-refund exists today). *(G)*

## 24. Security Decisions Required

1. **Customer lifecycle actor narrowing (S)** — remove `CUSTOMER` self from lifecycle PATCH (or add controller guard); until decided, self-activation is possible. *(C-3)*
2. **Role-key enforcement depth (S)** — wire `FINANCE_PREPARER/CONTROLLER` (+future roles) into funding + other financial routes, or accept principal-type-only enforcement and amend docs. *(C-2)*
3. **Privileged-approval consumption breadth (S)** — decide which dangerous actions REQUIRE approval tickets. *(§21-62)*
4. **MFA requirement mapping (S)** — which actors/actions require which assurance level. *(§21-63)*
5. **Workforce suspension semantics (S)** — lifecycle API + session revocation on suspension (evidence insufficient today). *(§21-65)*
6. **Session/customer-status binding (S)** — bind login/session validity to `customers.status`; revoke on suspension. *(C-4)*

## 25. Accounting Decisions Required

1. **Reconciliation break-resolution governance (A)** — resolver roles, resolve-vs-acknowledge, audit/outbox duties; reporting exists today. *(J8)*
2. **Reward grant accounting treatment (A)** — payable vs promo-expense vs contra-revenue vs wallet credit vs deferred liability + payable timing + reversal/expiry linkage (reward engine is decision-only today). *(reward register 15–22)*
3. **Commission accounting treatment (A)** — expense/payable families, settlement mechanism (commission engine is decision-only). *(commission register)*
4. **Fee/VAT treatment (A)** — only when fee policy (§23-4) is set. *
5. **Funding pool / cash-to-cash physical reconciliation (A)** — pool accounting confirmation incl. physical cash touchpoints at agents. *(P, §8.1)*

## 26. Recommended Follow-up Tasks (dependency order; no work started)

1. **P-DEC: Commercial pricing policy pack** (fees → commission → reward precedence/funding/accounting; the only business dependency for engine configuration) — prerequisite for any wiring pilot.
2. **S-FIX-01: Customer lifecycle authorization narrowing + session/status binding** (C-3 + C-4, single coherent fix task).
3. **S-DEC→FIX: Finance-role enforcement decision**, then (if approved) role-key wiring for funding/financial routes.
4. **P-DEC: Registration & verification model** (self-serve vs back-office, phone verification, KYC gating) → implementation task only after decision.
5. **A-DEC: Reconciliation break-resolution governance** → minimal workflow if approved.
6. **P-DEC: Agent history / aggregator surface / beneficiary exposure bundles** — accept/reject each as product work.
7. **Deployment config (non-code):** SMS/Push providers (Termii/FCM), OIDC JWKS, expiry windows, DB SSL.
8. Only after 1: **controlled commission/reward wiring pilots** (per-recipient/per-beneficiary, behind approval) with the engines' fail-closed guards.

---

## 27. Final Report (evidence-based)

| Item | Value |
|---|---|
| Starting HEAD | `ec9d341` (remote-verified at audit start after workspace rebuild; overlay matched tree exactly, 0 pending changes) |
| Final HEAD | `ec9d341` + this document's audit-only commit (see commit message) |
| Migration count | **75** (`ls src/migrations` = 75; head `1785753600074-CreateRewardRules`) |
| Files changed | **1** (`docs/V1-END-TO-END-PROCESS-AUDIT.md`) — 0 source / 0 migration / 0 route / 0 authorization / 0 ledger / 0 notification / 0 workflow changes |
| Processes audited | **74** (matrix §21; counts machine-verified against the table) |
| COMPLETE | **51** |
| PARTIAL | **10** (#1,4,6,10,32,38,61,62,63,65) |
| BACKEND_ONLY | **2** (#31 aggregator API, #57 beneficiaries) |
| METADATA_ONLY | **1** (#2 phone verification) |
| NOT_IMPLEMENTED | **4** (#34 reopen, #36/37 real providers, #59 agent history) |
| BLOCKED — PRODUCT | **5** (#43 fees, #48 commission, #50 reward, #56 reversal, #67 D1 funding) |
| BLOCKED — SECURITY | **0** (security/approval-depth deficits are executable-but-shallow → classified PARTIAL #61–65; decisions in §24) |
| BLOCKED — ACCOUNTING | **1** (#55 reconciliation breaks; fee/commission/reward accounting aspects counted under their PRODUCT rows by design of this audit) |
| V2 / OUT_OF_SCOPE | **12** boundary exclusions (audited for absence, not counted as V1 processes) |
| Product decisions | **15** (§23) |
| Security decisions | **6** (§24) |
| Accounting decisions | **5** (§25) |
| Contradictions | **8** (§22) — none silently reconciled |
| Test baselines consulted | 62 integration suites / 1325 tests green at the audited tree (reward-01 definitive run; no new tests authored — audit only) |
| Recommended next remediation task | **S-FIX-01 (customer lifecycle authorization + session/status binding)** in parallel with **P-DEC commercial pricing policy pack** (§26-1/26-2) |

**Conclusion:** MonieNaija V1's *financial and operational backend* does form a
coherent, executable system **for the processes that have responsible actor journeys
defined today** — money movement, funding governance, agent operations, support,
notifications (neutral delivery), investigation and reconciliation reporting. The
weakest coherent-chain is **customer onboarding/registration** (workforce-driven,
verification-less, unbundled) and the sharpest concrete defect-class found is the
**lifecycle authorization/session-status binding gap (C-3/C-4)** — both are
decision-gated, documented here, and deliberately **not fixed** in this audit.
V1 is therefore **not "complete" by capability inventory**; it is *executable per
process with explicit, itemized decisions pending*.
