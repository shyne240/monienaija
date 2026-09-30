# V1-CUSTOMER-ONBOARDING-DECISION-01 — Formal V1 Customer Entry Model

**Baseline recorded:** `f067360e978eee7ac5a2719911df39c38f7e9743` (HEAD == remote, verified + recovered before authoring).
**Task nature:** DECISION/DOCUMENTATION only. No implementation was performed: no source, migration, API, test, authentication, KYC, wallet, PIN, or notification change.
**Predecessor evidence:** `docs/V1-CUSTOMER-ONBOARDING-DECISION-AUDIT-01.md` (`f067360`), which opened the questions this document now answers.

### Status legend (used throughout)

| Tag | Meaning |
|---|---|
| **[DECIDED NOW]** | Formal V1 product decision recorded in this document. Binding as product direction. |
| **[NOT YET IMPLEMENTED]** | The capability the decision describes does **not** exist in code today. Nothing here is a claim of existing behavior. |
| **[REMAINING IMPLEMENTATION DETAIL]** | An open sub-question inside a decided area. Deliberately left to the implementation task(s); no answer is invented or implied here. |

---

## 1. Decision status

| # | Decision | Status |
|---|---|---|
| PRIMARY | Customer onboarding model = **HYBRID** — customer captures onboarding through a legitimate customer-facing path; KYC progression and final activation remain workforce-controlled. | **[DECIDED NOW]** — answers prior open decision **§23-1**. **[NOT YET IMPLEMENTED]** as a whole. |
| SUB-1 | Phone verification is **REQUIRED before final activation** (verified primary Nigerian phone before `ACTIVE`). | **[DECIDED NOW]** — answers prior open decision **§23-2** (mandatory: yes, before activation). Mechanism **[NOT YET IMPLEMENTED]**. |
| SUB-2 | First customer login credential = **server-generated temporary credential → securely provided to customer → first login → mandatory rotation → normal session** (the Agent-credential security principle extended to customers). | **[DECIDED NOW]**. Mechanism **[NOT YET IMPLEMENTED]**. |
| SUB-3 | Abandoned **DRAFT** customers are **retained as auditable onboarding records**, not immediately deleted. Expiry/cleanup policy = **separate operational configuration decision**. | **[DECIDED NOW]** (retention principle). Retention duration **NOT decided here — by design**. |

Cross-check result (details in §11): **no contradiction found** between these decisions and any existing V1 requirement; **no security invariant is violated**; **no decision is technically impossible** on the existing architecture. Nothing currently open in the repository was reinterpreted as already implemented.

---

## 2. Primary hybrid onboarding model — [DECIDED NOW]

**Definition.** Customer onboarding has two halves with a hard ownership boundary:

- **Customer-owned half (front door):** the customer initiates onboarding and captures their own information through a legitimate, dedicated customer-facing registration path. This is a *new, purpose-built* path — not the old sandbox screen and not an unauthenticated reuse of the internal `POST /customers`.
- **Workforce-owned half (control plane):** KYC assessment/progression and the final `DRAFT → ACTIVE` transition are performed **only by workforce principals**. Customer self-activation is disallowed; this preserves the security boundary fixed by S-FIX-01 (PATCH `/customers/:id` is workforce-only and is not loosened).

**Rationale anchors (from the prior audit):** the registration chain today is fail-closed for everyone (no reachable creation path), phone verification is metadata-only, and activation is already workforce-gated — so the hybrid model keeps every control the repository already hardened while adding the missing front door.

## 3. Customer lifecycle — [DECIDED NOW] (each step's implementation status noted)

| # | Lifecycle step | Owner | Today |
|---|---|---|---|
| 1 | Customer registration / capture | Customer-facing path | **[NOT YET IMPLEMENTED]** |
| 2 | Phone verification (primary Nigerian phone) | System (mechanism TBD) | **[NOT YET IMPLEMENTED]** (`verified_at` has no writer) |
| 3 | Customer record created → `DRAFT` | System/service | `CustomerService.create` exists; reachable path **[NOT YET IMPLEMENTED]** |
| 4 | KYC progression (assessment records, level/status) | Workforce | Machinery exists; levels currently **gate nothing** |
| 5 | Workforce review | Workforce | **[NOT YET IMPLEMENTED]** (no review/queue surface) |
| 6 | Workforce activation (`DRAFT → ACTIVE`) | Workforce | **Exists** (S-FIX-01-hardened PATCH); activation preconditions per SUB-1 **[NOT YET IMPLEMENTED]** |
| 7 | Wallet | System/customer | Machinery exists (explicit + lazy); actor/bundling in hybrid flow **[REMAINING IMPLEMENTATION DETAIL]** |
| 8 | Customer credential establishment (temp → first login → forced rotation) | Workforce (issuance) / Customer (rotation) | **[NOT YET IMPLEMENTED]** (see §5) |
| 9 | Transaction PIN | Customer (post-session) | **Exists** (`customers/me/transaction-pin` set/verify, session-gated) |
| 10 | Transaction-ready customer | Aggregate | Readiness **report** exists; enforcement **[REMAINING IMPLEMENTATION DETAIL]** |
| 11 | Normal login / use | Customer | **Exists** (sessions, PBKDF2, lockout, status binding) |

**Ordering note:** credential establishment (step 8) is deliberately placed *after* activation (step 6): the workforce activates a verified, reviewed customer first; only then is a temporary credential issued and rotated at first login; PIN follows inside an authenticated session. No step in this ordering conflicts with existing code.

## 4. Phone verification decision — [DECIDED NOW]; mechanism [NOT YET IMPLEMENTED]

- The customer **must** have a **verified primary Nigerian phone identity before becoming `ACTIVE`**. Verification is a precondition of the workforce activation step, enforced at activation time (the exact enforcing surface is implementation detail; the mandate itself is decided).
- The verification **mechanism is not implemented and not specified by this decision**. Repository facts that bound the choice: `customer_contact_methods.verified_at` exists with **no writer**; there is **no OTP generation machinery anywhere in V1** (explicitly documented in `notification-security.constants.ts`, which also reserves the security-critical dispatch slot for exactly such OTP-class events); a real transactional SMS provider (robase) + dispatcher/outbox exist.
- **[REMAINING IMPLEMENTATION DETAIL]:** OTP mechanism design (generation, hashing, expiry, cooldown, attempt caps, resend); challenge binding model for a *pre-activation* subject (phone-bound challenge store vs post-create customer-bound flow — lifecycle step 2 precedes step 3's usable record, so binding is non-trivial); whether verification failure blocks DRAFT creation or only activation (the mandate fixes only the activation boundary); enumeration-safe response policy; SIM-swap / re-verification lifecycle.

## 5. First-credential decision — [DECIDED NOW]; mechanism [NOT YET IMPLEMENTED]

- The customer credential lifecycle adopts the security principle already established for agents (V1-AGENT-CREDENTIALS-01): **server-generated temporary credential → secure out-of-band delivery to the customer → first login → mandatory rotation → normal customer session.**
- **Prohibited, explicitly:** hardcoded passwords; predictable passwords; sandbox credentials; plaintext password persistence; manual SQL. (Repository fact: the customer credential store already persists only hashes + algorithm metadata, and login uses PBKDF2-verify with lockout — these prohibitions are consistent with the existing store and add nothing it forbids.)
- Repository gap, recorded *without* claiming it is filled: the customer credential entity has **no rotation-required flag** (agent model does), and there is no customer temp-credential issuance service, no workforce-reachable issuance route for customers, and no forced-rotation gate on customer sessions.
- **[REMAINING IMPLEMENTATION DETAIL]:** rotation modeling (add a customer `rotation_required` analogue via migration vs achieve the same via reset-token consumption — schema decision left to implementation); issuance actor/scopes (mirroring the agent workforce roles is the precedent, exact set open); secure delivery boundary details (the agent doc's out-of-band precedent applies; whether any OTP-class share flows through the reserved notification slot is open); temp-credential expiry duration; reuse-of-agent machinery vs parallel customer service.

## 6. DRAFT retention decision — [DECIDED NOW]; cleanup policy deferred by design

- `DRAFT` customers are **retained as auditable onboarding records**. Immediate deletion on abandonment is **rejected**.
- Repository cross-check: **no reaper, TTL, or cleanup exists for customer DRAFTs** (only unrelated retention knobs: idempotency/audit/outbox). Retaining DRAFTs therefore requires **zero code change today** — it matches current de-facto behavior, now made deliberate.
- The exact **expiry/cleanup policy remains a separate operational configuration decision** (per the instruction: no retention duration is invented here). **[REMAINING IMPLEMENTATION DETAIL]:** future retention value, archival vs purge, reconciliation with the unique-phone index (retained DRAFTs hold their phone uniqueness claim — duplicate-phone lifecycle at re-registration is a consequence to design).

## 7. KYC/activation boundary — [DECIDED NOW]

- **KYC progression** (assessments, level/status transitions) is **workforce-controlled** in the hybrid model. The existing assessment machinery (state machine, customer kycLevel/kycStatus projection, audit) is the foundation; no customer self-assessment is introduced by this decision.
- **Activation is workforce-final** and now has **one decided mandatory precondition: verified primary phone (SUB-1).**
- **[REMAINING IMPLEMENTATION DETAIL] (this is the remaining §23-3 surface, intentionally not closed):** whether KYC *level/status* gates activation and/or transactions/limits beyond the phone precondition; which readiness checks (profile/address/identity doc/agreements/tasks/risk) gate activation vs merely populate the report; the review/queue surface for step 5. The audit's finding "KYC gates nothing" still stands as today's code fact — no gating was added by this decision.

## 8. Wallet / PIN / readiness relationship — recorded, current code facts preserved

- **Wallet:** creation is **not** a registration prerequisite in the hybrid flow (step 7 follows activation). Existing machinery (explicit `POST /customers/:id/wallets`; lazy creation on agent cash-in) stays. **[REMAINING IMPLEMENTATION DETAIL]:** who triggers wallet creation in the V1 hybrid flow (workforce/system at activation bundle vs customer self-service vs first-use lazy) and whether the §23-1 "starter bundle" concept (atomic creation of a minimum record set) is adopted — the bundle decision was part of open §23-1 and is *not* closed by this document.
- **PIN:** unchanged — set/verify post-session using existing endpoints; PIN is downstream of first login + rotation, before transactions. No decision changes PIN security (transaction-authorization secret, separate from password).
- **Readiness:** `calculateReadiness` remains a **report** (customerActive ∧ profile ∧ address ∧ identityDoc ∧ agreements ∧ tasks ∧ risk ≠ PROHIBITED ∧ onboarding APPROVED). **[REMAINING IMPLEMENTATION DETAIL]:** whether/when the aggregate becomes *enforcing*, and whether `verified_at` and KYC state join it (natural consequences of SUB-1/§23-3 answers, left to implementation).

## 9. Existing architecture reused (no change implied)

Customers: `CustomerService.create` (tx + 409 + CREATED audit); transition table; soft-delete; unique reference. Contact/identity: contact-method service, whole-DB normalized phone uniqueness index, profile/address/identity-document capture services. KYC: assessment state machine + projection. Activation: S-FIX-01 workforce-only PATCH + session status binding. Authn: authority/verification model, `runtime-access.guard` with `WORKFORCE_SESSION`-mode precedent for internal routes. Credentials/verification primitives: PBKDF2 pipeline, lockout (5 attempts), hashed sessions, credential history/security events, password-rotation pattern (`me/password`), reset-request/token machinery, `mfa_challenges` challenge pattern. Agent precedent: entire temp-credential issuance design (CSPRNG temp, expiresAt, rotation_required, one-slot index, reissue/revoke, audit taxonomy). Notifications: robase SMS provider/dispatcher/outbox, per-customer preference, **reserved security-critical slot**. Onboarding/reporting: onboarding tracking suite (#66), readiness calculator + both readiness endpoints. Rate limiting: token-bucket limiter (precedent, workforce-scoped today). Audit: `audit_events` + security-event taxonomy conventions. Admin/ops: customer read surfaces + onboarding tracking + audit-trail views.

## 10. Existing architecture still missing (decision-driven gap list — [NOT YET IMPLEMENTED])

1. **Customer-facing registration path** — dedicated public/registration authz mode, capture DTOs, enumeration-safe responses, duplicate-phone conflict UX, abuse/rate-limit categories for the public surface.
2. **Phone-verification machinery** — OTP generation (none exists), challenge storage & binding for the pre-activation subject, delivery wiring into the reserved security-critical slot, the `verified_at` writer, retry/cooldown/attempt policy.
3. **Workforce review surface** for step 5 (no review/queue exists; admin is read-only) + any scorer/checklist, scoped to decision scope.
4. **Activation preconditions** — verified-phone enforcement (SUB-1) and any §23-3 gating detail, applied to the existing workforce PATCH without loosening its actor restriction.
5. **Customer credential issuance** — temp-credential generation + hashing, rotation modeling (possible schema delta), workforce issuance route/service, secure delivery boundary, forced-rotation gate at customer login.
6. **Bundle/orchestration decision implementation** — if the starter-bundle concept is adopted (open), a single coordin/atomic creation of the minimum record set.
7. **Mobile-app reconciliation** — the real registration path must be wired into the customer app; see §11.4 for the deprecation ruling on the existing screen.
8. **Retention config (future)** — only after the separate operational decision sets values.

## 11. Contradiction check (cross-check of the decisions against the repository — results)

**11.1 Against open V1 decisions.** §23-1 (registration model): **closed by PRIMARY = HYBRID** — its bundle sub-question stays open by this document (§8). §23-2 (phone verification): **closed by SUB-1** (mandatory before activation; mechanism design open). §23-3 (KYC gating): **partially closed** — workforce-controlled KYC + workforce-final activation decided; level-gating detail remains open (§7). No residual wording in the E2E audit conflicts; matrix rows #1/#2/#4/#6/#10 gap descriptions are exactly the work items the hybrid model schedules.

**11.2 Against security invariants.** (a) S-FIX-01 boundaries — activation stays workforce-only and session status binding is untouched ✅. (b) Guard default-mode fail-closed posture — not loosened; the new front door is a dedicated mode, not a weakening of existing routes ✅. (c) Password hygiene — decided prohibitions match the existing hash-only credential store ✅. (d) Notification security taxonomy — SUB-1's mechanism is expected to consume the **reserved** OTP slot, consistent with its documented intent; no bypass of customer opt-out for transactional classes is introduced ✅. (e) Phone uniqueness index — compatible; re-registration/duplicate handling is scheduled work ✅. (f) Auditability — every new flow is required by this model to emit actor-stamped audit/security events, consistent with platform rules ✅. **No invariant violated.**

**11.3 Technical feasibility.** Nothing decided is impossible on existing architecture: the workforce-session route pattern exists (activation/admin proofs); the SMS substrate + reserved slot exist for OTP delivery; the agent credential design is an in-repo template for SUB-2; the customer credential store already carries expiry/hash/version/lockout fields needed for rotation semantics; the challenge/verify pattern exists (mfa_challenges). The two anticipated schema-level decisions (rotation modeling for customers; OTP challenge binding) are ordinary implementation work, not blockers. **Nothing reinterpreted as already implemented** — everywhere above, existence (works today) and gap (decided but unbuilt) are explicitly separated.

**11.4 The sandbox-era screen (special point — ruling).** `apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx`: verified to call `POST /customers` with a self-chosen reference *and* self-set `status: 'ACTIVE'`, to create **no credential and no phone verification**, and to display "sandbox environment" copy. **Ruling: it is NOT authoritative V1 behavior. It must remain unused/deprecated** — not wired into navigation for V1 and not treated as the registration path — until the real V1 hybrid onboarding path (§2–§5) is implemented and replaces it. Under the decided model its three core behaviors (public self-creation, self-activation, credential-less success) are all explicitly rejected.

**11.5 Other contradictions:** none found. The A23 customer-app contract (starts at login, no registration) predates this decision; the contract will require an extension when the registration path is implemented — recorded as future work, not a conflict.

## 12. Implementation sequencing (order only — no code in this task)

**Phase 1 — Front door:** registration authz mode + capture + duplicate-phone handling + enumeration-safe responses + public-surface rate limiting; OTP mechanism + `verified_at` writer + reserved-slot delivery; retire/deprecate the sandbox screen and wire the real path. *Exit:* a DRAFT with verified phone can be created end-to-end, audited, fail-closed elsewhere.

**Phase 2 — Control plane:** workforce review surface; activation preconditions (verified phone mandatory per SUB-1; §23-3 remaining detail decided); starter-bundle/atomicity decision resolved and applied (if adopted). *Exit:* only activation-eligible DRAFTs become ACTIVE, exclusively by workforce.

**Phase 3 — Credentials:** rotation modeling decision (+schema if chosen); temp-credential issuance service/route; secure delivery boundary; forced first-login rotation gate on customer sessions. *Exit:* first login requires rotation; no plaintext/predictable credentials anywhere; agent-pattern audit parity.

**Phase 4 — Readiness & use:** wallet provisioning actor decision; PIN flow confirmed downstream of rotated first login; readiness report-vs-enforce decision applied; normal login/use opens as the steady state. *Exit:* the §3 lifecycle runs start-to-finish without manual DB intervention.

The §23-3 remainder, starter-bundle question, rotation schema choice, delivery specifics, retention values, and review-surface scope are the **[REMAINING IMPLEMENTATION DETAIL]** items that future implementation task(s) must resolve per this document's decisions.

---

### Traceability
`docs/V1-CUSTOMER-ONBOARDING-DECISION-AUDIT-01.md` (all sections) · `docs/V1-END-TO-END-PROCESS-AUDIT.md` §21 rows 1/2/4/6/10/66 (verified 2026-09-30 against `f067360`: rows 674/675/679/683), §22 C-6 (row 763), §23-1/2/3, §24-1 · `docs/V1-AGENT-CREDENTIALS-01.md` (credential-security precedent) · `docs/A23-CUSTOMER-APP-CONTRACT.md` (pre-decision contract) · code re-verified at baseline: `route-policy-registry.ts` (default internal-route block, lines 564–577; no explicit `POST /customers` entry), `customer.controller.ts` (`requireWorkforce`, 54/108), `customer-authentication-credential.entity.ts` (no rotation flag), `mfa-execution.service.ts` (sole `verifiedAt` writer, unrelated), config/retention grep (no customer-DRAFT reaper), `notification-security.constants.ts` (no-OTP-generation statement, reserved slot) · `apps/customer-mobile/RegistrationScreen.tsx` (deprecated artifact, §11.4).
