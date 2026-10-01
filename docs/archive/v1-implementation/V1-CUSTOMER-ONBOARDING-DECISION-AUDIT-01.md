# V1-CUSTOMER-ONBOARDING-DECISION-AUDIT-01 — The Real V1 Customer Entry Path

**Baseline audited:** `a077d8b7d8e48c970ac52356120721907497a59c`
**Nature:** AUDIT + DECISION ANALYSIS ONLY. No source, migration, API, test, entity, wallet, PIN, KYC, limit, financial, or notification change was made or proposed as implemented. **No decision is made in this document.**

---

## 1. Current customer onboarding state (Part 1)

### 1.1 The chain as it exists today, step by step

| Step | Code reality | Reachability reality | Classification |
|---|---|---|---|
| **CREATE** `customers` row | `CustomerService.create` — transactional DRAFT insert, unique-reference 409, `CUSTOMER/CREATED` audit | `POST /api/v1/customers` matches **no** specific registry block → falls to the registry **default** (`internal-route`, principal types SUPPORT/OPERATOR/SERVICE/PRIVILEGED, scope `internal:access`). The E2E audit (§4.1) reads this as "registration actor = any workforce principal" at the *policy* level; at the *enforcement* level the guard's default (PRINCIPAL) mode never validates workforce tokens (verified in `runtime-access.guard.ts` — default path tries Agent, then Customer sessions only), so **no presented credential can satisfy the route: it is fail-closed for everyone**. | **BLOCKED** (service IMPLEMENTED, HTTP unreachable) |
| **PHONE BIND** contact method | `POST /customers/:id/contact-method` → `customer_contact_methods` (unique `(type, normalizedValue)` where not deleted — Nigerian phone uniqueness IS enforced at DB level; recipient resolution normalizes phones; `verified_at` column exists) | Policy design permits CUSTOMER-SELF + workforce; enforcement = only an **already-logged-in CUSTOMER SELF** can reach it (workforce is unauthenticated in PRINCIPAL mode). | **PARTIAL** |
| **PHONE VERIFY** | `verified_at` is written **by nothing** anywhere in `src/` (verified by repository-wide search; the only `verifiedAt` writers are unrelated MFA-challenge internals) | n/a | **NOT IMPLEMENTED** (metadata-only) |
| **CREDENTIAL (first password)** | `CustomerAuthenticationService.createCredential` — conflict-guarded insert, audit, **requires the caller to supply a pre-computed `passwordHash`** | `POST /customers/:id/authentication-credentials` — same policy/reachability problem (only CUSTOMER SELF can reach it, which presupposes a session created by an existing credential — chicken-and-egg). No server-side temp-credential generation, no `rotation_required` equivalent for customers (the Agent model added in V1-AGENT-CREDENTIALS-01 does not extend here). | **BLOCKED** for first credential (machinery PARTIAL) |
| **KYC** | `POST /customers/:id/kyc-assessment` → `CustomerKycAssessment` records + transition-checked `kycLevel/kycStatus` update | Same reachability pattern as contact-method (workforce cannot authenticate here); and **progression gates nothing** (E2E A6: wallets/limits/PIN ignore KYC level). | **PARTIAL** |
| **ACTIVATION** | `PATCH /api/v1/customers/:id` — lifecycle transitions; since S-FIX-01 the route is `WORKFORCE_SESSION`-mode with a controller workforce assertion | **REACHABLE by workforce** (OPERATOR/SERVICE/PRIVILEGED; SUPPORT allowed by policy). Transition table only; no KYC/readiness precondition. | **IMPLEMENTED** (workforce-only by design) |
| **WALLET** | `walletService.createWallet` idempotent; **lazy creation** inside Cash→Wallet/Wallet→Cash agent flows; explicit `POST /customers/:id/wallets` (customer-wallet controller, same CUSTOMER-SELF effective reachability) | Wallets arise from transactions or self-service post-login; **not bundled** with any registration. | **IMPLEMENTED** (unbundled) |
| **PIN** | `POST /customers/me/transaction-pin` + `/verify` (A24: 17/17 green) — separate table, hash, lockout | Requires an authenticated session (i.e., post-credential). | **IMPLEMENTED** |
| **TRANSACTION READY aggregate** | `GET /customers/:id/onboarding-readiness` (workforce vocabulary) + `GET /customers/me/status` (customer) — readiness **reported** (customerActive, profile, address, identity doc, required agreements, required tasks, risk, onboarding APPROVED) but **enforces nothing** | Reports exist both sides. | **PARTIAL** (no orchestrated path) |
| **LOGIN** | `POST /api/v1/customers/sessions` — PBKDF2 verify, lockout (5), **status binding** (S-FIX-01: non-ACTIVE denied post-verification), hashed session tokens, safe views | Fully reachable. | **IMPLEMENTED** |

### 1.2 Part-1 direct answers

- **A. Can a Customer be created via an authorized application API?** **NO.** The route registry intends workforce types, but the enforcement chain authenticates no workforce principal on that route.
- **B. Exactly where is creation blocked?** Route-policy default (`route-policy-registry.ts` final block) × guard default mode (`runtime-access.guard.ts`, PRINCIPAL path validates only Agent/Customer tokens).
- **C. Can a workforce operator create a Customer through the platform?** **NO** (only via direct DB writes — how every integration test does it today).
- **D. Can a customer self-register?** **NO.** The mobile app ships `RegistrationScreen.tsx` that *attempts* `POST /customers` (even self-setting `status: 'ACTIVE'`), but the backend rejects it fail-closed; the screen is a sandbox-era artifact (its success copy literally says "sandbox environment", and it never creates credentials — login after it would be impossible regardless).
- **E. Can phone ownership be verified?** **NO** — no writer for `verified_at` exists.
- **F. Can a password be established?** Not for a first credential via any reachable path (chicken-and-egg + caller-pre-computed-hash contract). Password *change* for an already-credentialed customer works (`POST /customers/me/password`).
- **G. Can a transaction PIN be established?** Yes — but only after login (i.e., downstream of F).
- **H. Can a wallet be created/bound?** Yes (explicit self-create post-login; lazy in agent flows), but not bundled with entry.
- **I. Can the Customer become ACTIVE?** Yes — workforce `PATCH /customers/:id` (S-FIX-01 hardened).
- **J. What KYC state is required?** None, by current code: nothing gates on `kycLevel/kycStatus` (decision §23-3).
- **K. What prevents the full chain?** Two hard blockers (CREATE unreachable; FIRST-CREDENTIAL unreachable/incomplete), plus three decision-gaps (PHONE-VERIFY absent, KYC non-gating, no orchestrated bundle).

### 1.3 Part 4 — the distinctions (do not confuse)

**Login ≠ registration.** Login (`/customers/sessions`) continually proves possession of an existing credential; it creates nothing. **Registration** would create the `customers` row. **Phone verification** would prove ownership and write `verified_at`. **Password creation** would write the first credential hash. **PIN creation** writes the *transaction-authorization* secret (separate table, separate lifecycle, post-session). **KYC** is assessment evidence + level/status state. **Activation** is the lifecycle transition that S-FIX-01 binds sessions to. **Wallet creation** provisions the financial container (lazy or explicit). All eight are independent code paths; exactly two of them (login + PIN post-session) work end-to-end today without manual DB help.

---

## 2. Evidence from existing V1 requirements (Part 5)

All V1 evidence is **internal to this repository's audit chain** (the original product catalogue is itself preserved there):

1. **74-process matrix (`docs/V1-END-TO-END-PROCESS-AUDIT.md` §21):**
   - **#1 Registration** — PARTIAL: *"phone verification, public path, bundling"* missing → product decision §23-1.
   - **#2 Phone verification** — **METADATA_ONLY** (only the `verified_at` column exists) → decision §23-2.
   - **#4 Activation** — PARTIAL (KYC-gating, actor narrowing) → security decision §24-1, **later RESOLVED by S-FIX-01** (workforce-exclusive actor + session/status binding).
   - **#6 KYC progression** — PARTIAL: *"gates nothing"* → decision §23-3.
   - **#10 Transaction-ready aggregate** — PARTIAL: *"no orchestrated single path"* → decision §23-1.
   - **#66 Onboarding tracking** — **COMPLETE (as tracking)**, explicitly *"gates nothing."*
2. **§23-1 (Registration model, product decision — OPEN):** *"self-serve public signup vs back-office-only; required starter bundle (profile/phone/credentials/wallet); abandoned-registration cleanup."* **This is the exact decision this audit feed into; no document answers it.**
3. **§23-2 (Phone verification, OPEN):** *"is verified phone mandatory before activation/transactions? If yes: OTP delivery mechanism + verified_at writer + retries."*
4. **§23-3 (KYC gating, OPEN):** *"what (if anything) each KYC level unlocks; whether KYC status must gate wallets/transactions/limits."*
5. **Contradiction C-6 (§22):** *"A23 Customer-App contract (no registration) + code (internal-only creation)" vs "business expectation of self-serve signup (implied by typical wallet UX)"* → explicitly deferred to **PRODUCT decision** — now amplified by direct evidence: `apps/customer-mobile/.../RegistrationScreen.tsx` **assumes** self-serve registration that the backend rejects.
6. **A23 Customer-App contract:** deliberately starts at login; registration is absent by contract, not by accident.
7. **§26.4 (recommended order):** *"P-DEC: Registration & verification model (self-serve vs back-office, phone verification, KYC gating) → implementation task only after decision."*
8. **E2E conclusion:** *"The weakest coherent-chain is customer onboarding/registration (workforce-driven, verification-less, unbundled)."*

**Verdict on §5's questions:** self-registration is **not** explicitly required anywhere; back-office creation is **not** explicitly required anywhere; phone verification is **not** explicitly required (only asked); credential issuance is implicitly required (login can't functionally begin) but its model is undecided; KYC gating is explicitly undecided; wallet bundling is explicitly undecided (part of §23-1's "starter bundle"); the only **contradiction** is C-6 plus the mobile screen; **no existing product decision answers the model choice.**

---

## 3. Existing reusable machinery (what V1 already provides)

| Area | Reusable primitive | Caveat |
|---|---|---|
| Customer record | `CustomerService.create` (tx, audit, 409) | needs a workforce-reachable route |
| Profile/address/identity/contact capture | service commands + audits for all four | routes effectively CUSTOMER-SELF only today |
| Phone uniqueness | DB unique index `(type, normalizedValue)` + canonical normalization | service surfaces need 409 mapping on conflict |
| Lifecycle | transition table + S-FIX-01 workforce PATCH + session/status binding | activation precondition policy is a decision |
| Credential store | credential entity (expiry, version, lockout, status), PBKDF2 pipeline, failed-attempt + history + security events, `rotatePassword` | first-write path + temp/rotation semantics must be added (Agent precedent exists: `rotation_required`, 72 h temp, forced rotation) |
| Password-reset machinery | requests + tokens + `issuePasswordResetToken` + `rotatePassword` + reset-view endpoints | no public token-consumption route; `passwordHash` DTO contract is caller-computed |
| OTP-adjacent infra | `MfaExecutionService.issue/verifyChallenge`, `mfa_challenges` store, attempt/expiry patterns | **No OTP *generation* machinery in V1** (`notification-security.constants.ts`, verified 2026-09: "no OTP generation machinery"; security-critical notification set intentionally **EMPTY**); challenge DTOs are caller-supplied-hash |
| SMS delivery | `RobaseNotificationProvider` (real transactional SMS API), dispatcher/worker/outbox, per-customer SMS preference, opt-out, security-critical bypass mechanism (reserved) | currently transactional events only; an OTP-class event type + template must be added at design time (the bypass hook is already reserved for it) |
| Customer inbox | `GET /customers/me/notifications` | delivery-side only |
| PIN | set/verify service + endpoints (post-session) | nothing |
| Wallet | idempotent create + lazy creation in flows | nothing |
| Authorization | route registry modes (CUSTOMER_LOGIN / AGENT_LOGIN / WORKFORCE_SESSION precedents), controller-level actor assertions | a registration mode would mirror AGENT_LOGIN's applicant pattern |
| Agent issuance precedent | V1-AGENT-CREDENTIALS-01: workforce-issued 72 h temporary credential + `rotation_required` + forced first-login rotation + reissue revocation | the closest proven in-repo template for assisted credential issuance |
| Rate limiting | `A2SecurityRateLimitService` (token-bucket, audited) | categories are workforce-scoped; a public-registration category is new |
| Audit | `AuditService` + `security_event_histories` taxonomy | event names to be defined, not invented here |

---

## 4. Option A — assisted / back-office onboarding (Part 2)

**Model:** workforce operator creates the customer, captures identity, (optionally) verifies phone, sets up a temporary credential, progresses KYC, activates; customer logs in, rotates credential, sets PIN.

**Reusable as-is:** customer create service; all capture services; KYC assessment service; activation route (already workforce); audit framework; the **Agent issuance template** (temp credential + forced rotation + reissue semantics) adapted to the customer credential store; readiness reporting for operator QA.

**Exactly missing (new build):**
1. Workforce-reachable customer-creation route (`/internal/...` pattern, WORKFORCE_SESSION; actor model mirroring admin controllers; possibly maker/checker via existing approval engine — decision).
2. Workforce-reachable capture routes (profile/address/identity/contact) OR a single orchestrating "create customer bundle" service that writes the §23-1 starter set in one transaction (bundle contents = part of the §23-1 decision).
3. First-credential issuance for customers: server-side generation + PBKDF2 + `passwordExpiresAt` + forced-rotation semantics (customer store has expiry/version; **no rotation flag exists** — either a matching migration or a reset-token–based invitation: issue `PasswordResetToken` internally + public token-bound consume route that accepts the new password and hashes server-side; both reuse existing primitives).
4. Phone verification policy: either (a) operator-attested verification written as `verified_at` with evidence reference, or (b) the same OTP machinery required by Option B (subset) executed staff-side.
5. KYC-gating policy application at activation (decision §23-3; currently activation has no precondition).
6. Audit events for issuance/invitation (names only; conventions exist).
7. Duplicate-phone conflict surfacing (409 mapping; index already enforces).

**Not required:** public routes, OTP delivery, self-service KYC data entry surfaces, anti-automation controls.

## 5. Option B — OTP-verified self-registration (Part 3)

**Model:** customer enters Nigerian phone → OTP proves ownership → creates credentials → completes onboarding/KYC → wallet/readiness → login.

**Reusable as-is:** phone normalization + uniqueness index; login/session/PIN post-credential path; readiness reporting; customer-app self-service surfaces (contact method, profile PATCH, wallet create); the notification provider + dispatcher + reserved security-critical bypass; MFA challenge verification patterns and lockout/rate-limit patterns; audit framework.

**Exactly missing (new build):**
1. Public registration route(s) in a new unauthenticated mode (mirroring the `AGENT_LOGIN` applicant precedent; request/response discipline to avoid phone enumeration).
2. **OTP generation machinery — currently does not exist at all** (CSPRNG code, per-attempt hashing, cooldown, attempt caps, expiry, resend policy). Storage binding for a *pre-customer* subject (phone) — `mfa_challenges` is customer-bound; a registration-challenge store (or reset-token-style store) is new schema (+migration decision).
3. OTP delivery through the reserved security-critical class: new event type + template + `verified_at` writer on `customer_contact_methods` upon successful challenge.
4. Public credential-creation endpoint accepting plaintext over TLS and hashing server-side (pattern exists in `customers/me/password`; the public variant is new).
5. Abuse/velocity control for public endpoints: new rate-limit categories (the existing limiter is workforce-scoped), resend cooldowns, disposable-number policy (decision), generic responses.
6. KYC model decision for self-service: self-capture (new forms/routes) + workforce review/queue (new surface), vs back-office-only KYC (then activation stays assisted — a hybrid A/B model, itself a §23-1 sub-decision).
7. Activation semantics decision: auto-activate DRAFT→ACTIVE on passing defined gates (new code + policy) vs workforce activation of self-registered accounts (hybrid).
8. Starter-bundle orchestration (same §23-1 decision content as Option A).

## 6. Exact gaps side-by-side

| Gap | Option A | Option B |
|---|---|---|
| Customer creation route | workforce internal route (small) | public route + registration mode (new surface) |
| Credential issuance | temp-credential or reset-token invitation (Agent template reusable) | public plaintext→hash endpoint (pattern exists internally) |
| Forced first-login rotation | `rotation_required` equivalent needed (customer store lacks it — schema decision) | same need |
| Phone verification | optional-by-decision (attested or staff-side OTP) | mandatory core: OTP generation+delivery+`verified_at` writer (largest new block) |
| Rate limiting / abuse | none new | new public categories + enumeration resistance |
| KYC | workforce assessment route reachability | self-capture + review surfaces OR hybrid |
| Activation | exists (workforce, workforce-only) | keep assisted (hybrid) or add gated auto-activation (new) |
| Starter bundle tx (§23-1) | decision required | decision required |
| Duplicate phone handling | 409 mapping | 409 mapping + enumeration-safe errors |
| Sessions/PIN/wallet downstream | nothing | nothing |
| Schema surface | 0–1 migration (rotation flag, if not reset-token route) | 1–2 migrations (OTP challenge store; rotation flag if adopted) |

## 7. Security / operational implications (Part 6 — no ranking)

- **Fraud/abuse:** A concentrates risk in insider misuse — mitigated by the existing audit-decision trail, possibly maker/checker; B concentrates risk in automation/velocity/SIM-swap — mitigated by rate limits, OTP attempt caps, cooldowns, and KYC gating depth (all but the second are new).
- **Phone verification:** A can ship without verified phone (then `verified_at` remains decorative until O/S decision), or adopt staff-side OTP; B *is* phone verification — it lands §23-2 by construction.
- **Credential issuance:** A mirrors the just-proven Agent pattern (72 h temp + rotation), keeping plaintext strictly server-side; B never exposes a plaintext handoff to staff but must harden the public set-password endpoint (TLS, policy, leak-resistant errors).
- **KYC:** A keeps KYC staff-attested (regulatory comfort; onus on process); B defers or stages KYC (self-attestation + review queue) — the gating question (§23-3) dominates either way.
- **Activation:** A is one step inside an existing workforce route; B must decide whether non-staff can flip the account that S-FIX-01 made workforce-gated — touching a security boundary deliberately.
- **Auditability:** A inherits complete operator attribution (every mutation actor-stamped); B attributes the early chain to the registrant and must still anchor the OTP issuance/verification events as security events.
- **Support operations:** A needs staff onboarding tooling (the admin surface is read-only today); B needs OTP support tooling (resend, lockout reset, SIM-change recovery — none exist).
- **Duplicate accounts:** DB uniqueness (phone) is enforced; both options must add graceful duplicate handling; B additionally must not leak existence (enumeration).
- **SIM/phone ownership:** A records operator evidence (attestation quality varies); B cryptographically proves possession at registration time only (ongoing SIM-swap exposure is a separate lifecycle question in both).
- **First login:** A: temp-rotation-bound (proven pattern). B: immediate with self-chosen password; the forced-rotation question disappears unless post-registration verification demands it.
- **PIN setup / wallet:** identical after login in both models (existing self-service + lazy flows).

## 8. Minimum V1 legitimate-onboarding state (Part 7 — repository-derived)

From the readiness aggregate (`calculateReadiness`), the login gate (S-FIX-01), and the transfer path (A23/A24), a *completely* legitimate V1 customer converges on:

1. **Customer record** exists with unique reference (DB constraint), audit `CREATED` with a legitimate actor.
2. **Primary Nigerian phone contact** present, normalized, DB-unique — *(verified via `verified_at` IFF decision §23-2 says mandatory — undecided).*
3. **Password credential** ACTIVE, hashed (PBKDF2-class), not locked/expired — established without manual DB.
4. **Lifecycle status ACTIVE** through the workforce-gated transition (S-FIX-01) — activation-precondition policy is part of decisions §23-1/§23-3.
5. **KYC state per decision §23-3** (today: no gate; if decided, `kycStatus=APPROVED` at the decided level before transactions).
6. **Wallet** (explicit or lazy-first-use), ACTIVE status.
7. **Transaction PIN** set (post-session, existing path).
8. **Onboarding evidence set** if the readiness definition is adopted as *enforced*: profile + address + identity document + required agreements + required tasks + risk-not-PROHIBITED + onboarding APPROVED.
9. **Auditability**: every step carries `audit_events`/security events with actor attribution; none of steps 1–8 performed by direct SQL.

Items 1, 3, and the activation-precondition/verification decisions are the minimum deltas versus today; items 5/8 are decision content, not code facts.

## 9. Contradictions and open decisions

- **C-6 live in code:** `apps/customer-mobile/RegistrationScreen.tsx` expects public self-registration (and even self-activation), which the backend correctly fails closed. Whichever model is chosen, this screen must be reconciled (rewired to the chosen path or removed).
- **Policy vs. enforcement gap on `/customers/*`:** registry policies name workforce types on routes whose mode cannot authenticate them (activation PATCH excepted). Any A-model will need the internal-route pattern; this is mechanical, documented, and must not be papered over by loosening the guard's default mode.
- **`createCredential`'s caller-computed-hash contract** is an internal-tooling API shape; neither option should expose it to a public caller as-is.
- **Open decisions (verbatim, unchanged):** §23-1 registration model + starter bundle + abandoned-registration cleanup; §23-2 phone-verification mandatory/optional + mechanism; §23-3 KYC gating; plus the sub-questions this audit surfaced: agent-style `rotation_required` for customers (schema) vs reset-token invitation (no schema); activation semantics under self-registration (hybrid vs auto); support tooling for OTP under B.

## 10. The exact decision needed next

A single primary decision (as recorded open in E2E §23-1), with three mandatory sub-decisions:

> **PRIMARY:** Which V1 customer-entry model — **A (assisted/back-office)**, **B (OTP-verified self-registration)**, or an explicitly-defined **hybrid** (B for capture + A for KYC/activation)?
>
> **SUB-1 (§23-2):** Is verified phone mandatory before (a) activation, (b) transactions, (c) neither?
> **SUB-2:** First-credential mechanism — Agent-style workforce temporary credential + forced rotation (needs a customer `rotation_required` schema decision) OR reset-token invitation/consumption (needs a public token-bound consume route) OR self-chosen password at registration (Option B)?
> **SUB-3:** Starter bundle (§23-1): exactly which records the entry path must create atomically (profile/phone/credential/wallet/onboarding record), and what happens to abandoned DRAFTs.

**This audit makes none of these decisions.** Implementation (if any) must follow the decision, per the repository's own sequencing rule (§26.4: implementation task only after the decision).

---

### Traceability
`docs/V1-END-TO-END-PROCESS-AUDIT.md` §4 (A1/A2/A6/A10), §21 rows 1/2/4/6/10/66, §22 C-6, §23-1/2/3, §24-1, §26.4, §27 conclusion · `docs/V1-BOOTSTRAP-AUDIT-01.md` §5/§6.1 · `docs/V1-AGENT-CREDENTIALS-01.md` (issuance precedent) · `docs/A23-CUSTOMER-APP-CONTRACT.md` (no-registration contract) · code: `runtime-access.guard.ts`, `route-policy-registry.ts`, `customer.service.ts`, `customer-authentication.service.ts`, `customer-onboarding.service.ts` (`calculateReadiness`), `notification-security.constants.ts` (no-OTP-generation statement, reserved bypass) · `apps/customer-mobile/RegistrationScreen.tsx` (contradiction artifact).
