# 01 — Ordinary Agent V1 Requirement-Level Completeness Matrix

**Audit SHA:** `b8a5b94ee55aad7407dd78068428b3e97236ce8e` · All statuses verified against source at this SHA; test evidence cites suites executed green here (full PG run `intfull3` 116/116 · 2237/2237; unit 193/193 · 1969/1969; mobile 20/20 · 297/297; admin-web 25/25 · 167/167) unless noted.

**Layer symbols:** ✔ present+tested · ◐ partial · ✖ absent · ⊘ n/a (not required at that layer).
**Classification vocabulary (mission §7):** COMPLETE · PARTIAL · MISSING · POLICY_BLOCKED · UNVERIFIED · OUT_OF_SCOPE.
**Severity:** H = blocks functional-completion declaration or production operation · M = blocks a bounded approved behaviour or needs owner ruling · L = polish/future.

**Approval-reference shorthand:** `72D` = docs/requirements/MonieNaija_72_Decisions_Scope_Archive.md · `A21` = docs/V1/A21-AGENT-APP-CONTRACT.md · `SPEC` = docs/V1/V1-AGENT-MOBILE-APPLICATION-SPEC-01.md · `MATRIX` = docs/V1/V1-AGENT-MOBILE-COMPLETENESS-MATRIX-01.md · `REG` = docs/V1/V1-CAPABILITY-REGISTRY.md · `C2C6` = docs/APPROVED-C2C-SIX-DIGIT-REDEMPTION-CONTRACT.md · `UATP` = docs/A4-ORDINARY-AGENT-UAT-PLAN.md (scenario matrix) · `S3R` = docs/ARENA3-SPRINT3-FINAL-INTEGRATION-REPORT-20261027.md.

---

## A. Agent onboarding and approval

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-01 | Public agent application create/read/update/submit with unified approval lifecycle | 72D 01–43 ("apply publicly or be registered by authorized internal staff") | ✔ `agent-application-public.controller` (POST/GET/PATCH/:id/submit) | ✔ | ⊘ (excluded by SPEC §3/§11) | ✔ review/approve/reject/activate in AgentNetworkScreen | ✔ public routes policy-registered; applicant access secured by migration `…095` (token hash, `select:false`) | application-access suites; `agent-application-access-migration-upgrade` 1/1; a8 lifecycle | No public applicant UI (OA-02) | M | — | COMPLETE (backend/API/admin path) |
| OA-02 | Public applicant self-service UI (web/mobile form) | 72D wording implies a public channel; no V1 UI spec found authoring one | ⊘ | ⊘ | ✖ (excluded by spec) | ✖ (workforce portal is not applicant-facing) | ⊘ | none (no surface) | Scope ruling: is API + workforce-led registration sufficient for V1, or is a public web form required? | M | Owner scope decision | PARTIAL (backend-complete; UI scope unresolved) |
| OA-03 | Staff-initiated registration + approval/activation workflow (`POST internal/agents/applications/:id/activate`) | 72D; REG `AGENT_APPLICATION`/`AGENT_APPROVAL`/`AGENT_ACTIVATION` | ✔ `agent-lifecycle.controller`, `admin-agent-lifecycle.controller` | ✔ | ⊘ | ✔ AgentNetworkScreen (approve/reject/activate buttons wired to real endpoints) | ✔ workforce functions + declared gates | a8; v1-003 admin operational writes; UATP application/activation lane | — | — | — | COMPLETE |
| OA-04 | Application rejection reason capture + applicant notification | 72D lifecycle; rejection_reason column | ✔ entity field + workflow | ✔ | ⊘ | ✔ reject flow | ✔ | a8/v1-003 | Applicant notification not enqueued (see OA-56) | L | D-notification | PARTIAL (notification leg) |
| OA-05 | Agent identity data model (reference, class binding, business/contact metadata jsonb) | A21 §1 | ✔ `agent.entity`, `agent-application.entity` | ✔ | ⊘ | ✔ | ✔ | migration chain suites | — | — | — | COMPLETE |

## B. Lifecycle and status

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-06 | Statuses PENDING/ACTIVE/SUSPENDED/TERMINATED with activate/suspend/reactivate/terminate | A21 §1; REG `AGENT_LIFECYCLE` | ✔ | ✔ internal | ◐ status surfaced; dedicated suspended/terminated screens missing (MATRIX OPS-1/2) | ✔ all four actions wired | ✔ admin-agent-lifecycle guards; capability fail-closed on non-ACTIVE | a8 24+ tests; v1-003 | Mobile polish screens | L | — | COMPLETE (backend/admin); PARTIAL (mobile polish only) |
| OA-07 | Capability/financial denial for non-ACTIVE agents (fail closed) | A21 §3 | ✔ `AgentServiceCapabilityService` reason `INACTIVE_AGENT` | ✔ | ✔ fail-closed CTAs | ✔ | ✔ | a10/a11; a8 | — | — | — | COMPLETE |
| OA-08 | Receiving number auto-provisioned on ACTIVE (idempotent ensure), revoked on TERMINATED, never re-allocated | A21; REG `AGENT_RECEIVING_NUMBER` | ✔ `ensureForAgent` (lifecycle-triggered), revoke semantics | ✔ GET self/internal/admin (read-only by design) | ✔ display (PRO-3) | ✔ load/display | ✔ SELF policy; internal gate | a9; v1-agent-09 receiving-number suites | Manual re-allocation ops deliberately absent (never re-allocated) | — | — | COMPLETE |
| OA-09 | Agent session invalidation on lifecycle/credential events | S3R §5; A1 handoff §2 | ✔ reissue revokes credential + sessions | ✔ | ✔ 401 purge default | ✔ reissue confirm dialog states invalidation | ✔ | v1-agent-credentials-01; a16 transaction-bound revocation | — | — | — | COMPLETE |

## C. Identity, authentication, credentials

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-10 | Agent login (PBKDF2, tokenHash sessions, 15-min TTL, ACTIVE-only) | A21 §2.1 | ✔ | ✔ POST /agents/sessions,/login | ✔ LoginScreen + auth-store | ⊘ (workforce has own auth) | ✔ AGENT_LOGIN public route policy | a7 HTTP; v1-agent-credentials-01 | — | — | — | COMPLETE |
| OA-11 | Mandatory first-login credential rotation | SPEC §5 | ✔ /agents/credentials/rotate | ✔ | ✔ RotateCredentialScreen (navigation gate) | ⊘ | ✔ rotation branch cannot establish session | credentials-01; mobile rotate tests 4 | — | — | — | COMPLETE |
| OA-12 | Normal credential (password) change after rotation | SPEC §5 recorded BACKEND GAP + founder decision | ✖ (no route) | ✖ | ✖ correctly hidden | ✔ workaround: reissue+invalidate (`AgentCredentialPanel`) | ⊘ | workaround tested (credentials-01) | Founder decision pending | M | D3 register | POLICY_BLOCKED |
| OA-13 | Workforce credential issue/reissue one-time temp credential (72h, rotate-at-first-login) | Admin ops need implied by OA-01/03 | ✔ admin-agent-credentials (POST :id/credentials, /reissue) | ✔ | ⊘ | ✔ panel with explicit uncertainty guidance | ✔ privileged workforce | v1-agent-credentials-01; admin-web suite | — | — | — | COMPLETE |
| OA-14 | Logout/self session revoke | A21 §2.1 | ✔ | ✔ | ✔ | ⊘ | ✔ SELF | a7; mobile store tests | — | — | — | COMPLETE |
| OA-15 | No secrets persisted/logged (passwordHash/pinHash/tokenHash/transferCode redaction) | A21 §4 | ✔ | ✔ | ✔ secure-store token-only | ✔ one-time credential not stored by screen | ✔ | redaction assertions a20/a7; mobile SEC tests | — | — | — | COMPLETE |

## D. KYC and verification

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-16 | Agent appointment/verification by MonieNaija staff (application review = V1 agent KYC) | 72D ("MonieNaija appoints and verifies Agents") | ✔ review/approve workflow + evidence in metadata jsonb | ✔ | ⊘ | ✔ review screens | ✔ | a8/v1-003 | No structured agent-KYC document model (by V1 design; 72D-56 compliance lifecycle is future scope) | — | 72D-56 future | COMPLETE (V1 scope) |
| OA-17 | Customer KYC gate on C2C redemption (wallet mode: authoritative APPROVED; cash mode: current unexpired assessment) | C2C6; a16 | ✔ | ✔ | ✔ error surfaces | ✔ monitoring | ✔ | a16 (expired cash assessment rejected; wallet APPROVED required) | Wallet-mode assessment-expiry consistency ruling | M | D4 register | COMPLETE (as approved); POLICY_BLOCKED (freshness harmonization) |
| OA-18 | Claim entitlement binds beneficiary verified primary phone (canonicalized) | C2C6 §1 | ✔ | ✔ | ✔ canonicalization client+server | ⊘ | ✔ | a16; Phase 7 spec (`3e6e614`) | — | — | — | COMPLETE |

## E. Agent classes and capabilities

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-19 | Agent class catalogue CRUD (code/name/applicableServices/applicableLimits/isActive) | A21 §1; REG `AGENT_CLASSES` | ✔ agent-class.controller POST/PATCH | ✔ | ⊘ | ✔ AgentClassesScreen + class catalog loader | ✔ workforce | a10; v1-003 | Class pricing PLANNED (product decision) | L | — | COMPLETE |
| OA-20 | Class-bound capability evaluation (canonical CASH_IN/CASH_OUT/CASH_TO_CASH/AGENT_FUNDING/AGENT_DEFUNDING) fail-closed | A21 §1; REG `AGENT_CAPABILITIES` | ✔ | ✔ /agents/me/capabilities | ✔ capability chips w/ reasons | ✔ | ✔ | a10/a11 | — | — | — | COMPLETE |
| OA-21 | Class assignment at approval; reclassification of active agents | 72D-68/69 (tiers future); S3R F5 | ◐ assignment at approval only; PATCH :id/class route deliberately absent | ✖ reclassification | ⊘ | ✔ visible+disabled panel ("Policy blocked") with dependency note | ✔ | Sprint 3 policy tests + admin-web fixtures | Seven governance decisions (S3R §4.1) | M | D5 register | POLICY_BLOCKED |
| OA-22 | Capability registry introspection for workforce | REG §API | ✔ /internal/capabilities | ✔ | ⊘ | ✔ (registry-driven UI states) | ✔ WORKFORCE_SESSION | capability-registry suite | — | — | — | COMPLETE |

## F. Agent float and wallet

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-23 | Ledger-derived agent wallet (wallet_accounts keyed by agentId; no cached balance column — prohibited) | A21 §1/§6 | ✔ | ✔ /agents/me/financial-position | ✔ balance w/ staleness + retry | ✔ financial position endpoint | ✔ SELF | a19/a21; harness asserts no `agents.balance*` column | — | — | — | COMPLETE |
| OA-24 | Platform funding pool account (AGENT_FUNDING_POOL-NGN) double-entry against agent wallet | a19; S3R | ✔ | ✔ internal | ⊘ (funding is workforce-only) | ✔ | ✔ | a19 (pool present; journals balanced) | — | — | — | COMPLETE |
| OA-25 | Float position visible to authorized workforce (agent.view) | S3R P1 contract | ✔ GET /internal/agents/:id/financial-position | ✔ | ⊘ | ✔ | ✔ agent.view gate; 403 FUNCTION_MISSING | workforce suites; v1-sprint3-agent-history-workforce 13/13 | — | — | — | COMPLETE |

## G. Funding and defunding (maker-checker)

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-26 | Funding request initiate (ANM `agent.fund`) with direction FUND/DEFUND, amountMinor, reason | S3R; A2 docs; 72D funding controls | ✔ agent-funding + governance services | ✔ POST /internal/agents/:id/funding-requests | ⊘ (workforce function) | ✔ AgentFundingPanel initiation form | ✔ scope+function checks; SUPER_ADMIN excluded (Decision 7) | a19; funding-approvals-inbox suites | — | — | — | COMPLETE |
| OA-27 | Independent approval/execute/reject (FC `agent.fund`/`agent.defund` APPROVE + MFA assurance; maker≠checker) | S3R; A2 finance contract | ✔ | ✔ execute/reject endpoints | ⊘ | ✔ ApprovalsScreen + PendingFundingApprovalsQueue + panel execute/reject | ✔ MFA session assurance; same-actor prohibition | a19; inbox suites (156-test targeted batch); admin-web 25/25 | — | — | — | COMPLETE |
| OA-28 | Global funding inbox (status PENDING/EXECUTED/REJECTED, direction filter, pagination 1..50) | S3R P5; A2 doc | ✔ | ✔ GET /internal/agents/funding-requests | ⊘ | ✔ live inbox, 403 fail-closed clears data | ✔ FC+MFA; no agent.view required | v1-funding-approvals-inbox; admin-web suites | — | — | — | COMPLETE |
| OA-29 | Ledger effect: pool ↔ agent wallet journals balanced; defunding respects available balance | a19 | ✔ | ✔ | ⊘ | ✔ | ✔ | a19 journal/balance assertions | — | — | — | COMPLETE |

## H. Cash-in (Cash→Wallet)

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-30 | Cash-in execution: agent float → customer wallet journal, idempotencyKey unique per agent, PIN required | A21 §2.3; REG `CASH_TO_WALLET` | ✔ agent-cash-in.service | ✔ POST /agents/cash-in | ✔ 4-screen flow (recipient→amount→confirm→success) | ✔ via history/observability | ✔ AGENT SELF + capability + PIN | a13; a11/a12; mobile C2W suite | Fee schedule = policy (OA-49) | — | — | COMPLETE |
| OA-31 | Recipient resolution + name confirmation; AGENT recipients blocked; internal IDs stripped | MATRIX C2W-2 | ✔ /recipients/resolve | ✔ | ✔ | ⊘ | ✔ | a13; mobile tests 2–4 | — | — | — | COMPLETE |
| OA-32 | Failure taxonomy (insufficient float, limit, PIN locked, 403/5xx/network) with no partial posting | SPEC §5; UATP | ✔ | ✔ | ✔ tested per branch | ✔ monitoring | ✔ | a12/a13; mobile tests 15–19 | — | — | — | COMPLETE |

## I. Cash-out (Wallet→Cash, Method 1 co-present)

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-33 | Cash-out execution: customer wallet → agent float, agent PIN + customer PIN + purpose-bound customer OTP (WALLET_TO_CASH) | A21 §2.3; REG `WALLET_TO_CASH`; MFA-API-01 | ✔ agent-cash-out + desk-OTP (direct provider send, never outbox-persisted) | ✔ POST /agents/cash-out; POST /agents/me/mfa-challenges | ✔ 4-screen flow + MfaChallengeCard consumption (OTP + both PINs) | ✔ monitoring | ✔ | a14; v1-agent-mfa-api-01; mobile W2C suites | — | — | — | COMPLETE |
| OA-34 | OTP lockout/expiry/replay rejection | a14 hardening | ✔ | ✔ | ✔ error surfaces | ✔ | ✔ | a14; mfa-api-01 | — | — | — | COMPLETE |
| OA-35 | W2C Method 2 (customer transfer → agent receiving number): no agent-side electronic handover confirmation (must NOT be invented); disputes via support | MATRIX W2C2 | ✔ receiving-number credit path (customer-side transfer) | ✔ | ⊘ by design | ✔ monitoring | ✔ | a9 | — | — | — | COMPLETE (per approved scope) |

## J. Cash-to-Cash initiation

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-36 | Initiation: agent float hold → unclaimed liability journal; transferCode hash stored, never plaintext; expiresAt | A21 §2.3; C2C6 | ✔ agent-cash-to-cash.service (SERIALIZABLE) | ✔ POST /agents/cash-to-cash | ✔ 4-screen flow + display-once transferCode card | ✔ CashToCashOperationsScreen (read-only) | ✔ AGENT SELF + capability + PIN | a15; v1-agent-cash-to-cash-operations | — | — | — | COMPLETE |
| OA-37 | Required senderPhone (explicitly collected, canonicalized, not inferred) | C2C6 §1 | ✔ DTO required + service canonicalization | ✔ | ✔ collected on recipient screen | ✔ visible in monitoring | ✔ | a15; Phase 7 spec negatives | — | — | — | COMPLETE |
| OA-38 | Commercial decision snapshot at initiation; ONE commission event (CASH_TO_CASH_INITIATION), claim never a second event | V1-COMMERCIAL-DECISION-03C (in-code); v1-commission-01 | ✔ snapshot wiring; commissionNone on claim by design | ✔ | ✔ server-returned fee/commission fields displayed only | ✔ | ✔ | commercial snapshot suites; v1-commission-runtime-wiring test 22 | Fee/rule values = policy (OA-49) | — | — | COMPLETE (mechanism) |
| OA-39 | Expiry semantics: expires_at enforced at claim (pre-check + re-check under posting lock); late expiry rolls back posting | ARENA1 sprint doc; a17 | ✔ | ✔ 409 "Transfer has expired and cannot be claimed" | ✔ history statuses | ✔ expires_at/expired_at columns in monitoring | ✔ | a17 (incl. pg_sleep late-deadline); a16 test 39 | **Status sweep trigger absent** (OA-40) | — | — | COMPLETE (financial enforcement) |

## K. Cash-to-Cash expiry lifecycle & claim/redemption

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-40 | UNCLAIMED→EXPIRED status transition sweep + audit + expired event | REG `CASH_TO_CASH_EXPIRY` (claimed FULLY_ENABLED); migration `…059` | ◐ service complete (`expireDueTransfers`/`expireOne`, SERIALIZABLE, SKIP LOCKED, idempotent, audit rows) but **zero production callers**; no scheduler dep in repo; no ops endpoint | ✖ trigger | ⊘ | ◐ monitoring shows raw dates, not transitioned status | ⊘ | a17 calls the service directly | **Wire a trigger**: governed ops endpoint and/or bootstrap interval (mechanism choice needs owner ruling; disposition of funds stays D2) | **H** | D2 (disposition) is separable | **PARTIAL** |
| OA-41 | Claim by UUID: transferCode + beneficiary verification + OTP (CASH_TO_CASH_CLAIM) + method-specific PIN rules (AGENT_CASH requires PIN; CUSTOMER_WALLET rejects PIN) | C2C6 item 12; a16 | ✔ single canonical `AgentCashToCashClaimService.execute()` | ✔ POST /agents/cash-to-cash/claim | ✔ claim flow (legacy + number) | ✔ | ✔ claimant Agent session-bound | a16 (87 tests) | — | — | — | COMPLETE |
| OA-42 | CUSTOMER_WALLET accounting: debit unclaimed liability + credit verified beneficiary wallet | C2C6 accounting; S3R P3 | ✔ | ✔ | ✔ | ✔ | ✔ | a16 persisted-journal assertions | — | — | — | COMPLETE |
| OA-43 | AGENT_CASH accounting: debit unclaimed liability + credit Agent B float WITHOUT beneficiary wallet credit | C2C6; S3R P3 | ✔ | ✔ | ✔ | ✔ | ✔ | a16 exact-journal tests | — | — | — | COMPLETE |
| OA-44 | Exactly-once settlement: idempotency, replay→REPLAYED, concurrent method race, conflicting-key rejection | UATP; C2C6 | ✔ | ✔ incl. GET claims/:transferId recovery (same-Agent audit bound) | ✔ pending-operation persistence + recovery UX | ✔ | ✔ | a16 races; mobile idempotency-persistence suite | — | — | — | COMPLETE |
| OA-45 | Atomic five-attempt transfer-code lockout (incl. concurrent bad-code races); non-enumerating uniform 404 | ARENA1 sprint items 3–4; C2C6 item 7 | ✔ atomic SQL counting (S2 hardening) | ✔ `C2C_CLAIM_NOT_AVAILABLE` | ✔ | ✔ | ✔ | a16 S2 tests | — | — | — | COMPLETE |
| OA-46 | Session/credential revocation during in-flight claim aborts posting | ARENA1 handoff §2; S3R | ✔ transaction-bound revalidation | ✔ | ✔ | ⊘ | ✔ | a16 revocation tests | — | — | — | COMPLETE |

## L. Six-digit public locator (Sprint 3)

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-47 | Six-character transferNumber (leading zeros preserved) + canonical senderPhone pair; UNIQUE, immutable, never recycled; CSPRNG allocation with bounded retries → 409 | C2C6 §§2–5; migration `…096` | ✔ | ✔ | ✔ rendered as text ("000042") | ✔ | ✔ | a15/a16 incl. collision-vs-expired; migration guards | — | — | — | COMPLETE |
| OA-48 | claim-by-number + recover-by-number (original idempotency key; never consumes OTP; no method switch after ambiguity) + DB-backed rate budgets (20/agent, 100/sender, 10/pair per 60s) → 429/404/503 envelopes | C2C6 items 3/4/8/10 | ✔ single settlement path via locator adapter | ✔ POST claim-by-number, claims/recover-by-number | ✔ number-entry classification (6-digit vs legacy code), method lock after ambiguous outcome | ✔ | ✔ | a15/a16/a17 + mfa-api (149 targeted); Phase 7 spec 8/8 | — | — | — | COMPLETE |
| OA-49 | Fee/VAT values on C2C: `feeMinor=0n`, `vatMinor=0n` hardcoded; cash-in/out carry no fee concept; zero commission rules configured by design | C2C6 (server-returned values only); 72D-44..53 archived; scope-challenge §11-D (machinery complete, "no invented rates") | ✔ mechanism (commercial engine, accrual+netting proven 170/170 + settlement-01 8/8) | ✔ fields present | ✔ displays server values only | ✔ history commission display | ✔ | commercial suites | Fee schedule + commission plan values require product/compliance approval (register D3) | M | D3 | POLICY_BLOCKED (values) / COMPLETE (mechanism) |
| OA-50 | Public locator copy/share never exposes secret transferCode; receipt/share text safe-fields-only | C2C6 item 11 | ✔ SafeCashToCashResult omits code | ✔ | ✔ `buildPublicCashToCashLocatorShareText`; code in-memory display-once, cleared on unmount; never in nav params/store/logs | ✔ | ✔ | locator-contract unit 2/2; mobile SEC tests; a16 | — | — | — | COMPLETE |

## M. OTP / transfer-code / PIN authorization

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-51 | Transaction PIN set/change/verify (PBKDF2, never returned), lockout after failures | A21 §2.1; V1-AGENT-05 | ✔ me/transaction-pin (+/change,/verify) | ✔ | ✔ TransactionPinManage + SetTransactionPin screens | ✔ status view | ✔ SELF | v1-agent-05-transaction-pin-security suite; mobile PIN suites | — | — | — | COMPLETE |
| OA-52 | Administrative PIN unlock/reset | S3R F6; MATRIX PIN-5 | ✖ deliberately absent (no privileged bypass) | ✖ | ⊘ | ✔ visible+disabled ("Policy blocked") + audit-reason form shell | ✔ | Sprint 3 policy tests | Seven governance decisions (S3R §4.2) | M | D6 | POLICY_BLOCKED |
| OA-53 | Purpose-bound OTP (WALLET_TO_CASH desk OTP; CASH_TO_CASH_CLAIM customer OTP), expiry/replay rejection, direct provider send (never persisted via outbox) | MFA-API-01; desk-otp service §209 comment | ✔ | ✔ mfa-challenges | ✔ MfaChallengeCard consumed by W2C + claim flows | ⊘ | ✔ purpose binding asserted | v1-agent-mfa-api-01; a14/a16 | — | — | — | COMPLETE |

## N. Limits

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-54 | Limit catalogue + assignment workflow (FP initiate / FC approve maker-checker), effective-dated | 72D-54; S3R | ✔ limit-catalog (assignment service/controller, diagnostics) | ✔ internal | ⊘ | ✔ LimitAssignmentScreen | ✔ limit.view/limit.modify catalogue grants | v1-limit-02 + limit suites (reconciled at `449ff8d`) | — | — | — | COMPLETE |
| OA-55 | Runtime enforcement before ledger in same SERIALIZABLE manager; commit failure rolls back entire posting; usage tracking; most-restrictive-wins | 72D-54; ARENA1 sprint item 2 | ✔ `LimitEnforcementService` wired in `agent-financial-execution.service` (V1-LIMIT-04 comment) | ✔ | ✔ limit-error UX (OPS-5/LIM-2) | ✔ | ✔ | a11/a12; a16 limit-failure rollback + fresh-OTP same-key retry | — | — | — | COMPLETE |
| OA-56 | Agent-facing limits READ surface (values/used/remaining) | REG `AGENT_RUNTIME_LIMITS` BLOCKED/PRODUCT_DECISION | ✖ product-level | ✖ | ✖ | ⊘ | ⊘ | — | Product decision (register D-extra) | L | decision | POLICY_BLOCKED |
| OA-57 | Hierarchical ceilings beyond class limits (tier/aggregator/branch) | 72D-54 archived future scope | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | Future phase | — | — | OUT_OF_SCOPE (V1) |

## O. Receipts and history

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-58 | Unified agent transaction history (6 types, pagination, type filter, minor-unit amounts, commission + counterparty projection) — agent-facing | V1-AGENT-HISTORY-01; A21 supersession note | ✔ agent-transaction-history.service | ✔ GET /agents/me/transactions | ✔ TransactionsScreen (sole-source binding, filter+pagination, receipt nav) | ⊘ | ✔ SELF | v1-agent-history-01; mobile suites | — | — | — | COMPLETE |
| OA-59 | Workforce unified history for one agent (agent.view; 403 fail-closed; same projection) | S3R P1/P5 | ✔ GET /internal/agents/:id/transactions | ✔ | ⊘ | ✔ AgentUnifiedHistoryPanel + normalizer reconciled to backend shape (`18a9686`) | ✔ agent.view; workforce principal types; Agent tokens 403 | v1-sprint3-agent-history-workforce 13/13; admin-web bridge test | — | — | — | COMPLETE |
| OA-60 | Receipts: client-side render from authoritative result/history data; safe fields; C2C receipt/share exclude secret code; claim receipt recovery endpoint (same-Agent) | MATRIX RCP; C2C6 item 11 | ✔ result contracts + GET claims/:transferId (REPLAYED semantics) | ✔ | ✔ TransactionReceiptScreen + per-flow success screens + Share | ✔ C2C ops "Inspect receipt" | ✔ ownership-bound recovery | a16 recovery tests; mobile receipt suites | Receipt IMAGE export = decision (RCP-3, unratified) | L | decision | COMPLETE (text/share); OUT_OF_SCOPE-pending-decision (image) |
| OA-61 | Per-id transaction detail endpoint | MATRIX HIS-5 DECISION-REQUIRED (A21 list-derived design) | ✖ by design | ✖ | ✔ list-derived receipt works | ✔ | ⊘ | — | Ratify non-requirement | L | decision | OUT_OF_SCOPE (pending ratification) |

## P. Failure, ambiguity, idempotency

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-62 | Idempotency on all financial writes (unique key + requestHash; prior-result replay; conflicting payload rejected) | A21 §4 | ✔ | ✔ | ✔ persisted pending-operation keys survive app restart | ⊘ | ✔ | a12–a17; v1-agent-mobile-idempotency-persistence-01 | — | — | — | COMPLETE |
| OA-63 | Ambiguous-outcome recovery: 503 C2C_RETRY_REQUIRED (<500ms→404 mask, 100ms timing floor) + recover-by-number with ORIGINAL key; method lock after ambiguity | C2C6 item 10 | ✔ | ✔ | ✔ recovery UX + hidden "change payout method" | ✔ | ✔ | a16; Phase 7 spec | Timing floor documented as NOT constant-time | — | — | COMPLETE |
| OA-64 | Failed-transaction rollback completeness (journal, transfer state, limit usage, idempotency reservation) | ARENA1 sprint items 2/4 | ✔ | ✔ | ✔ failure taxonomy | ✔ | ✔ | a16 injected limit-commit failure; fresh-OTP same-key retry exactly-once | — | — | — | COMPLETE |
| OA-65 | Operations reversal workflow (reason capture, maker-checker, notifications) | Scope-challenge §4-D (V1-017 open "V1?") | ◐ primitive only (`LedgerService.reverseJournal`, double-reversal-proof) + generic ledger route | ◐ | ✖ | ✖ ops-level UI | ◐ | primitive suites | Product decision then contained build | M | register D-extra | PARTIAL / DECISION (provisional V2 by record) |

## Q. Ledger, reconciliation, audit

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-66 | Double-entry ledger (accounts/journals/lines, balanced, BIGINT minor units) as sole financial truth | A21 §1; A3 wallet-ledger contract | ✔ | ✔ internal | ⊘ | ✔ LedgerOperationsScreen | ✔ | financial-invariant suites; every a1x journal assertion | — | — | — | COMPLETE |
| OA-67 | Reconciliation reporting (9-check report, trial balance, per-account activity, discrepancy evaluator) | Scope-challenge §11-D | ✔ reconciliation module | ✔ | ⊘ | ✔ ReconciliationObservabilityScreen | ✔ | reconciliation suites | Break-resolution workflow = decision (§25-1) | L | decision | COMPLETE (reporting); PARTIAL (workflow by decision) |
| OA-68 | Immutable audit trail across agent flows (no secrets in payloads) | UATP admin/audit lane; A21 §4 | ✔ AuditService used by lifecycle/funding/claims/expiry | ✔ | ⊘ | ✔ AuditTrailScreen | ✔ | a16 audit-provenance; expiry audit rows; v1-003 | — | — | — | COMPLETE |
| OA-69 | Independent balance recomputation from persisted lines (conservation) | UATP reconciliation lane | ✔ | ✔ | ⊘ | ✔ | ✔ | UATP-lane assertions inside a16/a19 (debit=credit per journal/currency) | — | — | — | COMPLETE |

## R. Notifications

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-70 | Notification machinery: event map, templates, outbox, dispatcher, worker (setInterval drain), retry, SMS adapter (Robase), customer inbox | A7 contract; scope-challenge §11-D | ✔ | ✔ | ⊘ (customer app has inbox) | ✔ diagnostics screen | ✔ | sms-v1 family; worker unit tests | — | — | — | COMPLETE (machinery) |
| OA-71 | OTP delivery to customers/agents (direct provider send; never outbox) | desk-otp design | ✔ ConsoleNotificationProvider seam + SMS adapter | ✔ | ✔ challenge UX | ⊘ | ✔ | mfa-api-01; desk-otp suites | — | — | — | COMPLETE |
| OA-72 | C2C lifecycle notifications (created/claimed/expired) to beneficiary/parties | C2C6 §6 (verbatim: initiation service "does not currently emit that generic created notification"; beneficiary SMS requires notification-ownership approval) | ◐ templates render the public pair safely; **no enqueue anywhere** | ⊘ | ✔ approved handoff = agent-presented pair + share text (implemented) | ⊘ | ⊘ | template unit tests (locator-contract) | Ownership decision D8, then small wiring build | M | D8 | PARTIAL / POLICY_BLOCKED (contract-conformant today) |
| OA-73 | Agent lifecycle notifications (activated/suspended/terminated/reactivated/application approved/rejected) | Event-map entries marked "future outbox events"; MATRIX NOT-1 claimed ✔ (contradicted by source — see 00 §5.2) | ✖ enqueue | ⊘ | ⊘ | ⊘ | ⊘ | — | Owner ruling: ratify SMS-only-none for V1 or wire enqueue | M | decision | MISSING (low-severity; never authoritatively required for V1) |
| OA-74 | Agent in-app notification inbox | MATRIX NOT-2 | ✖ (customer-only route) | ✖ | ✖ | ⊘ | ⊘ | — | Decision: build route OR ratify no-inbox V1 | L | decision | POLICY_BLOCKED / DECISION |
| OA-75 | Push notifications / device tokens | Scope-challenge §11-A.1 (V2 by record) | ⊘ | ⊘ | ⊘ | ⊘ | ⊘ | — | V2 | — | — | OUT_OF_SCOPE (V1) |

## S. Administrative oversight (Ordinary Agent V1 operations)

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-76 | Agent directory/list/detail + financial position for authorized workforce | REG ADMIN_AGENT_* | ✔ internal/agents GET list/:id/financial-position | ✔ | ⊘ | ✔ AgentNetworkScreen | ✔ agent.view catalogue (SA/FA/ANM/ADMINISTRATOR) | v1-003; workforce suites | — | — | — | COMPLETE |
| OA-77 | C2C monitoring (search/filter/pagination, receipt inspect, expiry columns) — read-only by design | a-ops controller; UATP admin lane | ✔ GET internal/admin/cash-to-cash/transfers | ✔ | ⊘ | ✔ CashToCashOperationsScreen | ✔ workforce | v1-agent-cash-to-cash-operations | Admin ops actions (force-expire/reverse) intentionally absent → OA-65/D2 | — | — | COMPLETE (monitoring) |
| OA-78 | Outlet/terminal management (create, lifecycle suspend/reactivate/terminate) workforce-owned; agent reads own | A21 §2.2 note; 72D-58 archived deeper scope | ✔ outlet/terminal services + internal routes | ✔ | ✔ read-only lists (detail screens absent = polish) | ✔ list + lifecycle + creation forms in AgentNetworkScreen | ✔ workforce gates | a20; v1-003 | Mobile detail screens (L) | L | — | COMPLETE |
| OA-79 | Support tickets: agent create/list/detail/messages + workforce servicing | MATRIX SUP-1 (UAT-AGENT-012); REG SUPPORT_SERVICING | ✔ agents/me/support/** + support module | ✔ | ✔ Support screens (3) | ✔ SupportTicketsScreen | ✔ | v1-007 (32s suite green at `449ff8d`); mobile support suites | Transaction-linked drafting depth (SUP-2) minor decision | L | — | COMPLETE |
| OA-80 | Workforce administration (roles/functions/assignments, super-admin recovery, local admin bootstrap) | B9/A2 workforce contracts; S3R | ✔ authorization-catalogue + local-admin-auth + workforce modules | ✔ | ⊘ | ✔ WorkforceAdminScreen, RoleAssignmentScreen, SuperAdminRecoveryScreen | ✔ | workforce-bootstrap/security suites | — | — | — | COMPLETE |

## T. Security and operational controls (cross-cutting)

| ID | Requirement | Approval ref | Backend | API | Mobile | AdminWeb | Authz | Test evidence | Outstanding | Sev | Dep | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| OA-81 | Route-policy registry + RuntimeAccessGuard (principal types, SELF binding, cross-agent 404, customer-denied) | A21 §3 | ✔ | ✔ | ✔ 401/403 handling | ✔ 403 fail-closed | ✔ | a11; a21; route-policy suites | — | — | — | COMPLETE |
| OA-82 | WORKFORCE_SESSION hardening enforcing only declared gates, controller parity | S3R P2 | ✔ | ✔ | ⊘ | ✔ no unexpected 401/403 drift | ✔ | 8-suite parity batch (156/156) + full run | — | — | — | COMPLETE |
| OA-83 | Rate limiting: locator budgets (DB-backed), desk-OTP throttles, login protections | C2C6; a14 | ✔ | ✔ 429 envelopes | ✔ | ⊘ | ✔ | a15/a16 budget tests | attempts-table retention job (ops tooling) | L | — | COMPLETE |
| OA-84 | Secrets hygiene: hashing (PBKDF2), no plaintext codes, log/audit redaction, masked phones in workforce projections | A21 §4; S3R P5 | ✔ | ✔ | ✔ | ✔ masked `803***6543` rendering | ✔ | redaction tests across a7/a16/a20/a21 + admin bridge test | — | — | — | COMPLETE |
| OA-85 | Production-readiness migration sync guard (startup refuses schema drift) | v1-release-01 rationale; `d23c51b` | ✔ marker synced to `…096` | ✔ | ⊘ | ⊘ | ⊘ | v1-release-01 3/3; unit fixture 7/7 (`c4b037a`) | — | — | — | COMPLETE |
| OA-86 | Screenshot/privacy guard on PIN/transferCode screens (FLAG_SECURE) | MATRIX SEC-7 DECISION | ⊘ | ⊘ | ✖ | ⊘ | ⊘ | — | Decision before device release | L | decision | POLICY_BLOCKED / DECISION |

## U. Release, UAT, deployment (explicitly separated from functional completion)

| ID | Requirement | Approval ref | Status | Classification |
|---|---|---|---|---|
| OA-87 | Browser Admin Web UAT journeys | UATP; A4 sprint-3 doc | Never executed anywhere (environment lacks browser libs) | UNVERIFIED (environment-blocked; prerequisites documented) |
| OA-88 | Physical Android/iOS device UAT (spec phase 11; REL-5) | SPEC; MATRIX REL-5 | Never executed (no adb/KVM/Xcode) | UNVERIFIED (environment-blocked) |
| OA-89 | Staging deployment + release infrastructure handoff | docs/V1/V1-AGENT-MOBILE-15/16/17, V1-INFRA-01, V1-GO-LIVE-01/02 | Documentation exists; execution out of this audit's scope | UNVERIFIED (deployment-prep phase) |
| OA-90 | Dependency vulnerability remediation (root 0 / admin-web 2 / agent-mobile 21 advisories at `b8a5b94`) | S3R §8.D | Audited, not upgraded (lockfile stability) | PARTIAL (security-owner review pending) |
| OA-91 | Release assets pipeline (icon/splash) | MATRIX REL-3 | Deliberately omitted like customer app | POLICY_BLOCKED / DECISION (pre-device-UAT) |
| OA-92 | Aggregator self-service, branches, aggregator liquidity/portal, tiers/hybrid progression, training, POS lifecycle, disputes/reversals ops, network intelligence, campaigns, incentives, external settlement/payout rails, push | 72D 44–72 archived future scope; scope-challenge §11-A | Not built (correct per sequencing decision) | OUT_OF_SCOPE (V1) |

---

## Summary counts

| Classification | Rows (counting split rows once at their dominant classification) |
|---|---|
| COMPLETE | 60 |
| PARTIAL | 8 (OA-02, OA-04, OA-06 mobile-polish leg, OA-40, OA-65, OA-67 workflow leg, OA-72, OA-90) |
| MISSING | 1 (OA-73 — never authoritatively required for V1; low severity) |
| POLICY_BLOCKED | 8 (OA-12, OA-21, OA-49 values leg, OA-52, OA-56, OA-74, OA-86, OA-91) |
| UNVERIFIED (environment/deployment-blocked, not implementation-suspect) | 3 (OA-87, OA-88, OA-89) |
| OUT_OF_SCOPE (V1) | 6 (OA-57, OA-60 image leg, OA-61, OA-75, OA-92 + W2C2 confirmations-by-design) |

The single HIGH-severity functional row is **OA-40 (expiry sweep trigger)**. Every money-moving row (OA-23…OA-50, OA-54/55, OA-62…OA-64, OA-66…OA-69) is COMPLETE with executed PostgreSQL/HTTP evidence.
