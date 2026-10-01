# V1-UAT-MASTER-01 — MonieNaija V1 MASTER UAT CATALOGUE

- **Baseline:** `7eaae111e609ceaea6585370b1b4f24002bf24e4` (`arena/01a0d883-monienaija`)
- **Type:** Documentation deliverable only. Generated directly from the current repository surface
  (controllers/routes/DTOs/entities), the authoritative V1 scope corpus, and `V1-FINAL-GAP-AUDIT-01`
  (V1 STATUS: COMPLETE · UAT STATUS: READY). This document introduces **zero code changes**.
- **Purpose:** definitive manual User Acceptance Test catalogue for MonieNaija V1. A human tester
  executes each test physically, records the actual result, marks the outcome, attaches evidence,
  and returns the completed catalogue for defect analysis.
- **Rule for the tester:** if reality differs from "Expected Result", mark FAIL (or BLOCKED when the
  test is impeded) — never edit/steps to force a pass. Suspected defects get a Defect ID and continue.

---

## SECTION 0 — HOW TO USE THIS CATALOGUE

### 0.1 Test record format
Every test card uses these fields (mandatory):

| Field | Meaning |
|---|---|
| Test ID | Stable ID (`UAT-AREA-NNN`). Never renumber; defects and regressions reference these IDs. |
| Area | Functional area + test family |
| Priority | `P0` critical V1 acceptance path · `P1` important V1 workflow · `P2` secondary V1 behavior · `P3` usability/operational observation |
| Role | Persona that physically executes the step |
| Preconditions | State that must already exist (usually earlier P0 tests passed) |
| Test Data | Input values; `[PLACEHOLDERS]` must be filled from §1 |
| Purpose | What acceptance criterion the test proves |
| Steps | Physical steps (app / workforce console / API client / SMS on the real handset) |
| Expected Result | User-visible behavior that must occur for PASS |
| Actual Result | Tester records what really happened |
| Result | PASS · FAIL · BLOCKED · NOT TESTED |
| Evidence Reference | Screenshot/recording/SMS/transaction-ID reference (see §3) |
| Defect ID | Link to defect register when FAIL |
| Tester Notes | Free text |
| Retest Status | After a fix: `RETEST REQUIRED` / outcome of rerun |

### 0.2 Financial record block
Every financial test ends with this line; the tester fills **all** blanks. Balances are recorded
in the app's displayed unit (NGN) **and** the transfer's `amountMinor`/`kobo` value where visible.

```
BEFORE BALANCE: ____ | AMOUNT: ____ | FEE: ____ | VAT: ____ | COMMISSION: ____ (agent-side only)
AFTER BALANCE: ____ | TRANSACTION ID: ____ | TIMESTAMP: ____ | IDEMPOTENCY-KEY: ____
```

### 0.3 Access model used in steps
- "Customer app" / "Agent app": the application surface backed by `/api/v1/customers/**` and
  `/api/v1/agents/**`. Session tokens are obtained only through the documented login flows.
- "Workforce console": workforce-authenticated surface backed by `/api/v1/internal/**`
  (A2 OIDC session; bootstrap per `docs/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`).
- Some verification steps are marked **[ADMIN VERIFY]**: performed by a workforce observer, not the
  primary tester. The tester never inspects database tables unless a step says **[ADMIN VERIFY]**.
- The backend enforces currency as minor units (`amountMinor`, kobo). If a UI displays naira,
  record both where possible.

### 0.4 Priority discipline
Priorities describe severity of a failure, not optionality: **every P0 test must PASS before the
overall status can be PASSED** (see §11). P1 failure blocks release sign-off until product decision.
P2/P3 failures may ship as `PASSED WITH OPEN P2/P3 ITEMS` per §11 rules.

---

## SECTION 1 — TEST DATA PREPARATION

Prepare the following before starting Section 4. **Never write real credentials/secrets into this
document** — store them in the team's secret store; use placeholders here.

| Ref | Type | How established (legitimate application/admin path only) | Required starting state |
|---|---|---|---|
| `[TEST CUSTOMER A PHONE]` | Customer A | Full flow: registration OTP → workforce activation → credential issuance → rotation → PIN set (Sections 4.1–4.4) | ACTIVE, PIN set, wallet funded to **₦50,000 (5,000,000 kobo)** via the customer funding process (worker request + checker approval — test 4.9) |
| `[TEST CUSTOMER B PHONE]` | Customer B | Same as Customer A | ACTIVE, PIN set, wallet funded to **₦5,000 (500,000 kobo)**; also registered as Customer A's **verified beneficiary** via the customer app beneficiary flow |
| `[TEST AGENT A PHONE]` | Agent A | Public application (`POST /agents/applications`) → admin approval → activation → credential issuance → rotation | ACTIVE class per policy, wallet funded **₦100,000** via workforce `fund` |
| `[TEST AGENT B PHONE]` | Agent B | Same as Agent A | ACTIVE, wallet funded **₦20,000**; used in permissions/cross-Agent negative tests |
| `[WORKFORCE OPERATOR]` | Workforce OPERATOR | Bootstrap/OIDC provisioning (runbook) | Can approve funding checkers, lifecycle actions; **cannot** perform SUPPORT-prohibited items |
| `[WORKFORCE SUPPORT]` | Workforce SUPPORT | Bootstrap/OIDC provisioning | Can view, create funding requests (maker); **cannot** approve/reject as checker or run lifecycle ops |
| `[WORKFORCE PRIVILEGED]` | Workforce PRIVILEGED | Bootstrap/OIDC provisioning | Full admin; used only for environment/incident steps |
| `[AGGREGATOR REF]` | Aggregator rel. data | Workforce aggregator console (`/internal/aggregators`) | One aggregator + relationship to Agent B (funding-attribution tests only) |
| `[NIGERIAN MSISDN POOL]` | Real NG SIMs | Physical SIMs on real carrier networks (MTN/Airtel/Glo/9mobile coverage preferred) | For Section 9 |
| Device pool | Physical devices | Real Android/iOS handset + one desktop browser | For device/browser evidence |

Non-secrets allowed in the document: IDs references and masked phones (`+234 80•• ••• 123`).

---

## SECTION 2 — DEPLOYMENT PRECONDITIONS (environment checklist)

A test is **BLOCKED**, not FAILED, if a precondition below is missing. Verify before Section 4.

| # | Check | Expected value | Verified (Y/N) | Evidence |
|---|---|---|---|---|
| ENV-01 | `NOTIFICATION_SMS_PROVIDER` | `robase` (NOT `console`) | | |
| ENV-02 | `ROBASE_API_KEY` | Present, live key (`robe_…` prefix) — value **never** written in this doc | | |
| ENV-03 | `NOTIFICATION_WORKER_ENABLED` | `true` (deliveries actually dispatched) | | |
| ENV-04 | SMS sender identity | Robase workspace sender identity registered/approved | | |
| ENV-05 | `A2_WORKFORCE_ENABLED` + OIDC | Issuer/JWKS/audience/client configured; workforce sign-in works | | |
| ENV-06 | `A2_BOOTSTRAP_*` | One-time bootstrap completed; bootstrap disabled/locked afterwards per runbook | | |
| ENV-07 | Commercial accounting envs | `COMMERCIAL_ACCOUNTING_ENABLED=true`, `COMMERCIAL_ACCOUNTING_VAT_TREATMENT=<approved value>`, `COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT=<approved value>`, `COMMERCIAL_COMMISSION_RECOGNITION_TIMING=<approved value>` per `V1-COMMERCIAL-ACCOUNTING-DECISION-REVIEW-01` | | |
| ENV-08 | Database | `DB_*` reachable from app; `DB_SSL` per policy; 80 migrations applied (tip `1785753600079-AddCustomerCredentialRotation`) | | |
| ENV-09 | Limits/policy | Default limit profile catalogue seeded/assigned per approved values | | |
| ENV-10 | `A6_PARTNER_ENABLED` | `false` (NIBSS adapter is V2) — confirm not accidentally enabled | | |
| ENV-11 | Deployment runtime | `NODE_ENV=production`, health `/api/v1/health[/ready]` returns OK, readiness report (migration pin …0079) green | | |
| ENV-12 | Retention/limits envs | `CASH_TO_CASH_EXPIRY_SECONDS` per pilot value (default 604800 = 7 days); OTP/PIN/lockout knobs at defaults unless documented | | |

---

## SECTION 3 — EVIDENCE GUIDE

Useful evidence per test type. Mask personal data where the report leaves the trust boundary.

- **Screenshots / screen recordings** of every attempted operation (before → during → after).
- **Transaction IDs + timestamps** for any financial step (from the app's transfer detail/history).
- **Before/after balances** (customer + agent wallet views).
- **SMS screenshots** from the receiving handset (OTP, credential, funding approved/rejected,
  C2C claimed/expired notifications). Mask the sender OK; keep timestamps visible.
- **Error messages** verbatim (toast/banner/response body) — negative tests are judged on these.
- **Workforce/admin evidence** for [ADMIN VERIFY] steps (console screenshots).
- **IDEMPOTENCY-KEY values** used in duplicate/retry tests.
- Never attach: passwords, full OTP codes *after use* (capture then blur is fine), raw API keys,
  session tokens.

---

## SECTION 4 — CUSTOMER ONBOARDING & AUTHENTICATION (families REG / ONB / AUTH)

### 4.1 `UAT-REG-*` — Customer registration & phone OTP (12 tests)

**UAT-REG-001** · Area: Customer/Registration · **P0** · Role: New customer (no account)
- Preconditions: ENV-01..05 green; `[TEST CUSTOMER A PHONE]` is a real NG SIM in hand.
- Test Data: real phone `[TEST CUSTOMER A PHONE]` (enter in `+234…` format).
- Purpose: Prove the public registration front door sends a real OTP by SMS.
- Steps: 1. Open customer app registration. 2. Enter phone, submit registration OTP request (`POST /customers/registration/otp` behind the app).
- Expected: Acceptable response (no internal error); SMS with an OTP code arrives on the real handset; no ACTIVE customer, wallet, or credential is created at this stage.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-002** · Area: Customer/Registration · **P0** · Role: Same tester (immediate)
- Purpose: OTP verification accepts the delivered code.
- Steps: 1. Enter the exact OTP received in REG-001 into verify step.
- Expected: Phone marked verified for registration purposes; clear success indication; SMS/app do not reveal any further secret.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-003** · Area: Customer/Registration · **P0** · Role: Same tester
- Purpose: Registration completion creates a DRAFT customer bound to the verified phone.
- Steps: 1. Complete the registration form (`POST /customers/registration`) using the verified phone. 2. [ADMIN VERIFY] Locate the customer in workforce console.
- Expected: Customer exists with `DRAFT` status and verified phone metadata; **login is NOT possible yet**; no wallet/credential exists.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-004** · Area: Customer/Registration · **P1** · Role: New tester
- Test Data: invalid formats — `+23480`, `12345`, letters, foreign country prefix.
- Purpose: Nigerian-format validation on registration.
- Steps: Attempt OTP request with each invalid format.
- Expected: Each rejected with a clear user-facing format error; no SMS sent for invalid formats; no crash.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-005** · Area: Customer/Registration · **P0** (negative) · Role: Same tester
- Purpose: Wrong OTP is rejected and counted.
- Steps: 1. Request OTP for `[TEST CUSTOMER B PHONE]`. 2. Enter a deliberately wrong code.
- Expected: Verification refused with a neutral error (no hint which part is wrong); correct code still usable afterwards unless attempt cap disclosed by app messaging.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-006** · Area: Customer/Registration · **P1** (negative) · Role: Same tester
- Purpose: OTP attempt cap engages (lockout/cooldown messaging after repeated wrong codes).
- Steps: Repeat wrong-code verification until the platform refuses further attempts.
- Expected: After the platform's cap, a clear "too many attempts / wait" user message appears; subsequent attempts are blocked or rate-limited; no security exception/stack trace is shown.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-007** · Area: Customer/Registration · **P1** · Role: Same tester
- Purpose: Resend-OTP behavior (cooldown and code rotation).
- Steps: 1. Request OTP. 2. Resend. 3. Try the FIRST code after resend where cooldown allows; then try the LATEST code.
- Expected: Resend is allowed but rate-limited (no SMS storm); the *latest* issued code is the usable one per the platform's documented cooldown semantics; codes are never echoed to any screen/SMS other than one delivery.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-008** · Area: Customer/Registration · **P2** (documented decision) · Role: Tester
- Purpose: Retained-DRAFT duplicate phone behavior matches the onboarding decision record
  (`V1-CUSTOMER-ONBOARDING-DECISION-01`: abandoned DRAFTs are retained auditable records; exact
  duplicate-phone lifecycle is a documented consequence).
- Steps: 1. Register `[TEST CUSTOMER C PHONE]` to DRAFT, stop. 2. Re-start registration with the same phone.
- Expected: The platform consistently either (a) resumes/re-challenges the existing DRAFT or (b) refuses with a clear message — **record which**, and that no second ACTIVE-claiming record appears. Any other behavior = FAIL.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-009** · Area: Customer/Registration · **P0** (negative) · Role: Same tester
- Purpose: A phone that is registered but never activated cannot log in.
- Steps: After REG-003 (DRAFT exists), attempt customer login for that phone by all available means.
- Expected: Login impossible (no credential exists / DRAFT principal cannot authenticate); no session is established.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-010** · Area: Customer/Registration · **P1** (negative) · Role: Same tester
- Purpose: OTP expiry is enforced.
- Steps: Request an OTP on a scratch phone; intentionally wait past the OTP validity window (record platform-indicated expiry if shown; otherwise sample at 10/20/30 min where ENV-12 documents TTL).
- Expected: Expired code rejected with a clear expired-code message; a fresh code still works.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-011** · Area: Customer/Registration · **P1** (abuse) · Role: Same tester
- Purpose: Unauthenticated registration endpoints are bounded by per-phone/per-IP rate limits.
- Steps: Fire 20+ OTP requests in rapid succession for one phone.
- Expected: Requests begin failing with an obvious rate-limit/cooldown message; backend stays healthy; the legitimate flow (after cooldown) still works.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-REG-012** · Area: Customer/Registration · **P2** · Role: Same tester
- Purpose: Registration cannot be used to enumerate accounts.
- Steps: Request OTP for a phone that already belongs to ACTIVE Customer A vs a fresh phone; compare messages/timing.
- Expected: Responses do not reveal account existence (neutral wording); consistent behavior across both.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 4.2 `UAT-ONB-*` — Workforce review, KYC & activation (8 tests)

**UAT-ONB-001** · Area: Customer/Onboarding · **P1** · Role: [WORKFORCE OPERATOR]
- Preconditions: REG-003 passed (Customer A DRAFT, phone verified).
- Purpose: Workforce can find and review the DRAFT customer.
- Steps: 1. Sign in workforce console. 2. Open customers list; search the DRAFT by phone.
- Expected: Customer visible with DRAFT status, verified-phone state, created timestamp; SUPPORT-only account can also view but cannot act (see SEC tests).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ONB-002** · Area: Customer/Onboarding · **P0** · Role: [WORKFORCE OPERATOR]
- Purpose: Activation of the verified-phone DRAFT succeeds (hybrid model step: workforce-controlled activation).
- Steps: Activate Customer A via the lifecycle control (`PATCH /internal/customers/:id` activation action).
- Expected: Status becomes ACTIVE; activation entry visible in the customer's admin history; customer receives notification (SMS/inbox).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ONB-003** · Area: Customer/Onboarding · **P0** (negative) · Role: [WORKFORCE OPERATOR]
- Test Data: a second DRAFT whose phone was entered but NOT OTP-verified.
- Purpose: Verified-phone activation precondition is enforced (binding SUB-1 decision).
- Steps: Attempt activation of the unverified-phone DRAFT.
- Expected: Action refused with clear reason (verified phone required); status unchanged; event visible to [ADMIN VERIFY].
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ONB-004** · Area: Customer/Onboarding · **P1** · Role: [WORKFORCE OPERATOR]
- Purpose: Lifecycle suspension/termination/reactivation controls work and are role-gated (SUPPORT denied — see SEC-005).
- Steps: 1. Suspend Customer C (scratch). 2. Confirm customer app login/actions restricted. 3. Reactivate. (Terminate is exercised as SEC/AGENT variant via a scratch customer where safe.)
- Expected: Each transition applied with reason capture; restricted access while suspended; audit trail shown in customer 360 view.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ONB-005** · Area: Customer/Onboarding · **P0** (security) · Role: Tester (customer side)
- Purpose: Customer self-activation is impossible (S-FIX-01 boundary).
- Steps: As the customer (still DRAFT or ACTIVE), attempt every reachable action that could flip status; also attempt direct calls to the workforce activation route with the customer's session.
- Expected: No customer-side path changes own status; workforce route rejects customer credentials (401/403).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ONB-006** · Area: Customer/Onboarding · **P2** · Role: [WORKFORCE OPERATOR]
- Purpose: KYC machinery is visible/operable by workforce (assessments, level/status projection); KYC *level gating beyond the phone precondition is a documented deferred decision* — record observed behavior, do not fail on absence of additional gating.
- Steps: Open KYC view for Customer A; record level/status fields and any action available.
- Expected: KYC view renders the available assessment record/projection without error.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ONB-007** · Area: Customer/Onboarding · **P0** · Role: [WORKFORCE OPERATOR] + Customer A
- Purpose: Wallet establishment post-activation via the documented operational path (explicit wallet creation; lazy creation on agent cash-in is also legitimate).
- Steps: 1. Trigger wallet creation for Customer A through the documented path (`POST /internal/customers/:id/wallets` or wallet appears on first agent cash-in). 2. Customer A opens wallet view.
- Expected: Wallet exists, NGN, zero balance initially; customer sees wallet + zero balance.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ONB-008** · Area: Customer/Onboarding · **P1** · Role: Customer A + [WORKFORCE OPERATOR]
- Purpose: End-to-end readiness for credential issuance — activation is a hard precondition for credential issuance.
- Steps (two attempts): 1. As workforce, try issuing a credential for a DRAFT (pre-activation scratch customer). 2. Then for ACTIVE Customer A (continue to AUTH-001).
- Expected: (1) refused/blocked with clear reason; (2) proceeds (next section).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 4.3 `UAT-AUTH-*` — Customer credentials, rotation, sessions (12 tests)

**UAT-AUTH-001** · Area: Authentication/Credentials · **P0** · Role: [WORKFORCE OPERATOR] + Customer A
- Purpose: Workforce issues the customer's first credential; the temporary secret arrives **only** via direct SMS to the customer.
- Test Data: `[TEST CUSTOMER A PHONE]`.
- Steps: 1. Issue credential from customer 360 (`POST /internal/customers/:id/authentication-credentials` behind console). 2. Watch the workforce screen AND the handset.
- Expected: SMS with the temporary credential reaches the handset; the workforce display **does not persistently show** the full temporary secret after issuance (capture whatever is shown at issuance and note retention); issuance event recorded [ADMIN VERIFY]; no SMS content leaks into app logs/screens beyond the delivery itself.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-002** · Area: Authentication/Credentials · **P0** (security) · Role: [WORKFORCE SUPPORT]
- Purpose: SUPPORT (or any non-authorized workforce role) cannot issue customer credentials.
- Steps: Attempt the same issuance action while signed in as SUPPORT.
- Expected: Refused (403/structured denial); attempt traceable [ADMIN VERIFY].
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-003** · Area: Authentication/Credentials · **P0** · Role: Customer A
- Purpose: First login with the temporary credential forces rotation (no app use before rotation).
- Steps: 1. Login with phone + temporary credential. 2. Immediately attempt to open wallet/history and any other area before rotating.
- Expected: Login accepted into a **rotation-required** state; all functional areas refused with a rotation-required message until rotation completes.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-004** · Area: Authentication/Credentials · **P0** · Role: Customer A
- Purpose: Rotation to a self-chosen credential succeeds and unlocks the account.
- Steps: 1. Complete rotation (choose new password meeting policy: length/rules shown). 2. Re-enter app.
- Expected: Rotation accepted; full session established; app areas become reachable; security event visible [ADMIN VERIFY].
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-005** · Area: Authentication/Credentials · **P0** (negative) · Role: Customer A
- Purpose: Old temporary credential is dead after rotation.
- Steps: Attempt login using the OLD temporary credential post-rotation.
- Expected: Refused with neutral invalid-credential message; no lockout semantics applied against the NEW credential for this single try.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-006** · Area: Authentication/Credentials · **P1** (negative, config-dependent) · Role: Customer C prep
- Purpose: Temporary credential expiry is honored (TTL per deployment).
- Steps: 1. Issue credential for scratch Customer C. 2. Deliberately wait past the temp-credential validity window (ENV/runbook value; if 24h, use a shortened test-window build or mark BLOCKED with reason). 3. Attempt login.
- Expected: Login refused with expired-credential messaging or neutral refusal; re-issuance by workforce restores access path.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-007** · Area: Authentication/Credentials · **P0** (negative) · Role: Customer A
- Purpose: Wrong-password attempts are counted; account survives a few failures (no lock until policy cap).
- Steps: Enter wrong password 2–3 times, then the correct one.
- Expected: Each wrong try gets neutral error; correct login succeeds before cap; failed-counter visible [ADMIN VERIFY] resets or remains visible per policy.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-008** · Area: Authentication/Credentials · **P1** (negative) · Role: Customer A + [WORKFORCE PRIVILEGED]
- Purpose: Credential locks after repeated failures; authorized workforce unlock path exists.
- Test Data: keep failing the password until the platform's lock engages; record how many attempts.
- Steps: 1. Trigger lock. 2. Confirm login now refused even with correct password. 3. Workforce uses the unlock control (`…/authentication-credentials/:id/unlock`) where policy permits, or awaits documented unlock policy. 4. Login with correct password.
- Expected: Deterministic lock; clear user message; workforce unlock re-enables login (or documented waiting policy applies) — record both; events visible [ADMIN VERIFY].
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-009** · Area: Authentication/Credentials · **P0** · Role: Customer A
- Purpose: Normal login/logout happy path.
- Steps: Login with (post-rotation) credentials; open dashboard; logout explicitly.
- Expected: Login works; session established; logout returns to auth gate.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-010** · Area: Authentication/Credentials · **P0** (security) · Role: Customer A
- Purpose: Logout invalidates the session server-side.
- Steps: After logout, retry any previously-working action (refresh/open wallet) using the same session context.
- Expected: All actions refused as unauthenticated until a fresh login.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-011** · Area: Authentication/Credentials · **P1** (security) · Role: [WORKFORCE OPERATOR]
- Purpose: Rotation-required cannot be sidestepped by issuing ANOTHER credential (re-issuance produces a fresh rotation-required state, not a bypass).
- Steps: For an ACTIVE customer mid-rotation-required, issue a second credential. Observe login state.
- Expected: New credential still lands in rotation-required before functional access; prior credential's state consistent (record: replaced/disabled per policy).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AUTH-012** · Area: Authentication/Credentials · **P2** · Role: Customer A
- Purpose: Password-history policy resists immediate reuse of the current password during rotation/change.
- Steps: During a later password change, try reusing the current password.
- Expected: Refusal with clear policy message (if history depth policy is active; record the observed policy).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 4.4 `UAT-PIN-*` — Customer Transaction PIN (10 tests)

**UAT-PIN-001** · Area: Customer/Transaction PIN · **P0** · Role: Customer A (ACTIVE, rotated, logged in)
- Purpose: Customer sets a 4–12 digit Transaction PIN via the customer app.
- Steps: Open PIN setup (`POST /customers/me/transaction-pin` behind the app); set `[TEST CUSTOMER A PIN]` (6-digit suggestion: not the phone's last digits).
- Expected: PIN accepted; success confirmation shows **no PIN digits**; no workforce involvement was required (PIN is customer-secret by decision).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-002** · Area: Customer/Transaction PIN · **P1** (negative) · Role: Customer A
- Test Data: `123` (3 digits), `1234567890123` (13 digits), `12ab`, empty.
- Purpose: PIN format rules reject non-conforming values.
- Steps: Try each invalid value at PIN set.
- Expected: Each rejected with a clear format message (4–12 digits only); current valid PIN unchanged (verify with PIN-003).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-003** · Area: Customer/Transaction PIN · **P0** · Role: Customer A
- Purpose: Explicit PIN self-verification returns success for the correct PIN.
- Steps: Use the verify action (`POST /customers/me/transaction-pin/verify`) with the correct PIN.
- Expected: `verified: true` style success; failed-attempt evidence counters (if visible via admin) reset on success.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-004** · Area: Customer/Transaction PIN · **P0** (negative) · Role: Customer B (fresh counter)
- Purpose: Repeated wrong PIN attempts engage the lockout policy (5 attempts by design).
- Steps: Enter a wrong PIN up to 5 times via verify (or a transfer), counting responses.
- Expected: Each wrong attempt: neutral failure (no "digit n wrong" hints); by the 5th committed wrong attempt the platform reports PIN LOCKED; [ADMIN VERIFY] lock state visible (`PIN_LOCKED` event).
- Actual (count attempts until lock): ____ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-005** · Area: Customer/Transaction PIN · **P0** (negative) · Role: Customer B (locked)
- Purpose: While locked, even the CORRECT PIN is refused — lockout cannot be verified-through.
- Steps: Use PIN-verify with the actually-correct PIN while locked; try a transfer too.
- Expected: Both refused as locked (401/locked class error), `verified: false`; no partial success.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-006** · Area: Customer/Transaction PIN · **P0** · Role: Customer B (locked)
- Purpose: Customer self-recovery by rotating to a new PIN clears the lock.
- Steps: 1. Perform PIN set with a NEW PIN (`[TEST CUSTOMER B PIN2]`). 2. Verify the new PIN. 3. Optionally attempt a small transfer.
- Expected: Rotation accepted even while locked; verify succeeds; a real transfer succeeds; old PIN no longer valid.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-007** · Area: Customer/Transaction PIN · **P0** (security) · Role: Customer A
- Purpose: Login password is NOT a transaction PIN — an independent factor is enforced.
- Steps: Attempt a transfer/PIN-verify using the account **password** where the PIN is required.
- Expected: Refused (format rejection or invalid PIN) — the two secrets never substitute.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-008** · Area: Customer/Transaction PIN · **P2** · Role: Tester (visual)
- Purpose: PIN secrecy in the interface.
- Steps: Inspect PIN fields, success screens, history/detail, notifications; [ADMIN VERIFY] audit event payloads carry no PIN or hash.
- Expected: PIN never displayed/echoed; only boolean/success states; no PIN in SMS/notifications/audit payloads.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-009** · Area: Customer/Transaction PIN · **P1** (security) · Role: Tester
- Purpose: PIN endpoints require an authenticated ACTIVE customer session.
- Steps: Attempt PIN set/verify (a) logged out, (b) with an expired session, (c) valid session.
- Expected: (a,b) refused as unauthenticated; (c) works.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-PIN-010** · Area: Customer/Transaction PIN · **P2** · Role: Customer A
- Purpose: Independency of factors — changing the login password does not silently change/kill the PIN.
- Steps: 1. Change login password. 2. Verify the existing PIN + perform a small transfer.
- Expected: PIN still valid; no re-creation forced; both factors continue independently.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 4.5 `UAT-CUST-*` — Customer app surfaces (10 tests)

**UAT-CUST-001** · Area: Customer App · **P0** · Role: Customer A
- Purpose: Wallet visibility — wallet list + balance.
- Steps: Open wallets (`GET /customers/me/wallets`, `…/balance` behind the app).
- Expected: NGN wallet with current balance shown; before value recorded for later financial tests.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-002** · Area: Customer App · **P0** · Role: Customer A
- Purpose: Receiving identity — the customer's own receiving phone/number display.
- Steps: Open receiving identity/number views (`/customers/me/receiving-identity`, `/receiving-number`).
- Expected: Accurate, unmasked-to-owner value (= own phone); format consistent.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-003** · Area: Customer App · **P0** · Role: Customer A
- Purpose: Transaction/transfer history lists entries with IDs, amounts, counterparties, timestamps.
- Steps: Open transfers and transactions views after any financial test has created entries.
- Expected: Entries match performed operations exactly (amounts, direction, status); paginated lists consistent.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-004** · Area: Customer App · **P0** (commercial display) · Role: Customer A
- Purpose: Transfer detail shows the financial breakdown: amount, **fee**, **VAT**, status, references.
- Steps: Open one completed transfer's detail.
- Expected: fee/vat values (or explicit zero) displayed consistently with the charged values in the balance movement; policy snapshot/reference visible where the app exposes it.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-005** · Area: Customer App · **P1** · Role: Customer A
- Purpose: Financial-position/dashboard aggregates equal the sum of visible movements (spot check).
- Steps: Compare `financial-position`/dashboard totals against an independently computed expected value (before balance + known flows).
- Expected: Values agree; discrepancies FAIL.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-006** · Area: Customer App · **P1** · Role: Customer A
- Purpose: Beneficiary management — add Customer B as beneficiary, see verified status, then remove.
- Steps: Add `[TEST CUSTOMER B PHONE]` as beneficiary per app flow (including any verification step the app requires); confirm listing; delete.
- Expected: Add/verify appear as designed; foreign-resolution errors are neutral; deletion works (then re-add for W2W-008).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-007** · Area: Customer App · **P1** · Role: Customer A
- Purpose: Profile view/edit.
- Steps: View profile; update an editable non-identity field; view sessions list.
- Expected: Update persists; identity-critical fields behave per policy (read-only or verified-change flow — record which); sessions list shows current device.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-008** · Area: Customer App · **P1** (notifications) · Role: Customer A
- Purpose: Notification inbox receives V1 events (funding approved/rejected, transfers, C2C events, support).
- Steps: Trigger one of each from other tests; read inbox (`GET /customers/me/notifications`).
- Expected: Entries present, ordered, readable, no secrets (no PIN/OTP/password content).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-009** · Area: Customer App · **P1** (support) · Role: Customer A
- Purpose: Customer creates and tracks a support ticket; a workforce update is reflected.
- Steps: 1. Create ticket w/ subject+message (`POST /customers/me/support/tickets`). 2. Workforce updates status/adds message (ADMIN-006). 3. Customer re-opens ticket list/detail.
- Expected: Ticket created with ID/status; status/message visible on refresh; conversation coherent.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CUST-010** · Area: Customer App · **P2** · Role: Customer A
- Purpose: Status view (`/customers/me/status`) shows account state without overexposure.
- Steps: Open status screen.
- Expected: ACTIVE state shown; no sensitive internals (no raw flags beyond customer-appropriate view). Record fields shown.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 5 — FINANCIAL FLOWS (families W2W / W2C / C2W / C2C)

> Every financial card records the financial record block (§0.2). "kobo" = `amountMinor` where the
> app/API exposes minor units. Idempotency: the app sends `Idempotency-Key` on transfers; duplicate-
> test steps reuse the same key deliberately. For API-client steps, endpoints are named for the tester.

### 5.1 `UAT-W2W-*` — Wallet→Wallet (14 tests)

**UAT-W2W-001** · Area: Financial/W2W · **P0** · Role: Customer A → Customer B
- Preconditions: A funded ₦50,000; B funded ₦5,000; both ACTIVE with PIN set; `[TX KOBO AMT]` = ₦2,500.
- Steps: 1. Record both BEFORE balances. 2. A initiates transfer to B's wallet (`POST /customers/me/transfers`, destination wallet + `pin`). 3. Record AFTER balances, transfer ID; 4. check both histories; 5. [ADMIN VERIFY] audit/outbox entries exist.
- Expected: 201/created, completed status; A debited amount (+ fee+VAT if configured), B credited amount; both histories show the movement; transfer detail shows fee/VAT rows; notification/inbox entries.
- Financial block: BEFORE A ____ B ____ | AMT ____ FEE ____ VAT ____ | AFTER A ____ B ____ | TXN ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-002** · Area: Financial/W2W · **P0** (negative) · Role: Customer B (₦5,000 max)
- Steps: Attempt transfer of ₦6,000 from B to A.
- Expected: Refused with clear insufficient-balance message; **zero balance movement**; no partial journal; failed attempt visible in history only if the platform records failed attempts there (record observed); [ADMIN VERIFY] no ledger residue.
- Financial block: BEFORE B ____ | AMT ____ | AFTER B ____ (must equal BEFORE) | TXN ID: none expected
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-003** · Area: Financial/W2W · **P0** (negative) · Role: Customer A
- Test Data: amount `0`, `-500`, non-numeric, absurdly large (beyond policy).
- Expected: Each rejected with format/amount message; no movement.
- Financial block: BEFORE ____ → AFTER ____ (unchanged) | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-004** · Area: Financial/W2W · **P1** (negative) · Role: Customer A
- Test Data: non-existent wallet ID / deleted beneficiary.
- Expected: Rejected with neutral not-found/unresolvable message (no enumeration hints); no movement.
- Financial block: unchanged. | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-005** · Area: Financial/W2W · **P0** (negative) · Role: Customer A
- Steps: Valid transfer details but WRONG PIN.
- Expected: 401-class refusal ("invalid transaction PIN"); **no transfer created**; balance unchanged; failed-count observable [ADMIN VERIFY].
- Financial block: BEFORE ____ → AFTER ____ (unchanged); no TXN ID created
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-006** · Area: Financial/W2W · **P0** (negative) · Role: Customer B (PIN locked prep) — if PIN-004/005 already executed
- Steps: Attempt transfer while PIN locked, correct PIN supplied.
- Expected: Refused as locked; no transfer; balance unchanged.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-007** · Area: Financial/W2W · **P0** (security) · Role: Customer A
- Steps: Submit transfer with the PIN field omitted entirely.
- Expected: Refused (PIN required) — there is **no code path** completing a W2W without PIN; balance unchanged.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-008** · Area: Financial/W2W · **P1** · Role: Customer A → beneficiary (Customer B)
- Steps: Transfer using the saved beneficiary (mutually exclusive with raw wallet ID); try also sending BOTH identifiers (must be rejected).
- Expected: Beneficiary path succeeds; dual-identifier request rejected with a clear rule message.
- Financial block: BEFORE A/B ____ AMT ____ FEE ____ VAT ____ AFTER A/B ____ TXN ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-009** · Area: Financial/W2W · **P0** (idempotency) · Role: Customer A
- Steps: Submit a valid transfer; then resubmit the EXACT same request with the SAME `Idempotency-Key` (double-send/retry).
- Expected: One transfer only; repeated response returns the original result (same ID/status); balance moved exactly once.
- Financial block: BEFORE ____ AMT ____ AFTER ____ (single movement) | TXN ID: one | KEY: ______
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-010** · Area: Financial/W2W · **P1** (concurrency/retry) · Role: Customer A
- Steps: Rapidly double-tap the same transfer from two app contexts with the same key; then attempt the same operation with a DIFFERENT key (expect a second legitimate transfer OR a conflict message — record which, and that no half-created state exists).
- Expected: Same key → one movement; different key → deterministic second transfer or explicit conflict; never a partial/duplicated-side post.
- Financial block: record each movement precisely | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-011** · Area: Financial/W2W · **P2** (negative) · Role: Customer A
- Test Data: currency other than NGN (e.g., `USD`) if the UI allows free entry; malformed reference.
- Expected: Refused with unsupported-currency/format message; no movement.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-012** · Area: Financial/W2W · **P1** (negative) · Role: [WORKFORCE OPERATOR] + suspended Customer C
- Steps: Suspend scratch customer; attempt its W2W transfer while suspended; reactivate afterwards.
- Expected: Transfer refused while suspended with clear messaging; reactivation restores ability.
- Financial block: unchanged during suspension | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-013** · Area: Financial/W2W · **P2** · Role: Customer A
- Steps: Send transfer with narration/reference; open both parties' histories.
- Expected: Narration/reference displayed consistently to both sides; amounts rendered identically; timestamps sane (Africa/Lagos).
- Financial block: standard | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2W-014** · Area: Financial/W2W (commercial) · **P0** · Role: Customer A
- Purpose: Fee + VAT actually charged agree with the commercial configuration and the detail view; snapshot reference present.
- Steps: Complete a fee-bearing transfer; read transfer detail (`feeMinor/vatMinor` or UI rows); compare with expected value under ENV-07's approved treatment.
- Expected: Charged fee/VAT equal the configured computation; history/detail consistent; absent fee = explicit zero, never a phantom debit.
- Financial block: BEFORE ____ AMT ____ FEE ____ VAT ____ AFTER ____ TXN ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 5.2 `UAT-W2C-*` — Wallet→Cash via Agent cash-out (12 tests)

**UAT-W2C-001** · Area: Financial/W2C · **P0** · Role: Customer A at Agent A's position
- Preconditions: Agent A ACTIVE funded ₦100,000; Customer A ≥₦40,000. Amount ₦3,000.
- Steps: 1. Record balances (customer wallet, agent float view). 2. Agent starts cash-out; customer supplies transaction PIN; platform issues agent OTP (receiving-number channel). 3. Complete with OTP.
- Expected: Customer wallet debited amount (+fee/VAT if configured); agent position credited per flow semantics; physical cash handed to customer (record); histories + notifications both sides.
- Financial block: BEFORE cust ____ agent ____ | AMT ____ FEE ____ VAT ____ COMM ____ | AFTER cust ____ agent ____ | TXN ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-002** · Area: Financial/W2C · **P0** (negative) · Role: Customer A at Agent A
- Steps: Cash-out with WRONG customer PIN.
- Expected: Refused before OTP issuance (PIN verified first by design); zero movement; agent may not proceed.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-003** · Area: Financial/W2C · **P0** (negative) · Role: Customer A at Agent A
- Steps: Correct PIN, then deliberately WRONG/expired agent OTP at the final step.
- Expected: Cash-out refused/cancelled; no wallet movement; clear retry path; PIN failure counters not incorrectly advanced by OTP failure (record observed).
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-004** · Area: Financial/W2C · **P1** (negative) · Role: Customer B with locked PIN
- Steps: Attempt cash-out while customer PIN locked.
- Expected: Refused as locked; agent informed neutrally.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-005** · Area: Financial/W2C · **P0** (negative) · Role: Customer B
- Steps: Cash-out exceeding wallet balance.
- Expected: Refused insufficient balance; no movement.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-006** · Area: Financial/W2C · **P0** (negative) · Role: suspended scratch Agent
- Steps: [WORKFORCE OPERATOR] suspends scratch agent; attempt cash-out there.
- Expected: Refused — suspended agents cannot initiate/operate financial actions; clear message; reactivate after.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-007** · Area: Financial/W2C · **P1** (negative) · Role: terminated scratch Agent
- Steps: Terminated agent attempts app access/cash-out.
- Expected: Terminal refusal (auth or action level); no movement.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-008** · Area: Financial/W2C · **P1** (idempotency) · Role: Customer A at Agent A
- Steps: Same cash-out submitted twice with the same idempotency key (agent app retry).
- Expected: Single movement; duplicate returns original state; no duplicate cash release.
- Financial block: one movement | KEY: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-009** · Area: Financial/W2C · **P1** (limits) · Role: Customer A at Agent A
- Steps: Attempt cash-out above the agent's per-transaction limit (from ENV-09 values).
- Expected: Refused with limit message citing the plane (per-transaction); smaller compliant amount succeeds.
- Financial block: first unchanged, then standard | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-010** · Area: Financial/W2C · **P2** (negative) · Role: Agent A
- Test Data: amount 0/non-numeric at cash-out form.
- Expected: Refused format; no movement.
- Financial block: unchanged | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-011** · Area: Financial/W2C · **P0** · Role: Agent A
- Purpose: Histories/positions reconcile after cash-out (agent transactions view + customer history + [ADMIN VERIFY] agent financial position).
- Steps: After W2C-001/-009 success, compare agent `transactions`/`financial-position` totals with recorded movements.
- Expected: Exact agreement; pending/reserved entries absent after completion.
- Financial block: totals recorded | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-W2C-012** · Area: Financial/W2C · **P2** (notifications) · Role: Customer A + Agent A
- Expected: Both sides receive completion SMS/inbox entries with amount + reference; no PIN/OTP echoed in notifications.
- Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 5.3 `UAT-C2W-*` — Cash→Wallet: customer funding + agent cash-in (13 tests)

**UAT-C2W-001** · Area: Financial/C2W · **P0** · Role: Customer A → [WORKFORCE SUPPORT] maker
- Purpose: Customer cash deposit request lifecycle: request/create → approval path engagement.
- Steps: 1. Customer hands ₦10,000 cash at the service point; the request is created against Customer A (`POST /internal/customers/:id/funding-requests`, maker = SUPPORT). 2. View request pending state from customer app (`GET /customers/me/funding-requests`, `/funding-history`).
- Expected: Request visible PENDING with amount; no balance change yet; SMS/inbox request-known notification where configured.
- Financial block: BEFORE cust ____ | AMT ₦10,000 | AFTER must equal BEFORE while pending | REQUEST ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-002** · Area: Financial/C2W · **P0** · Role: [WORKFORCE OPERATOR] checker (≠ maker)
- Steps: Approve the PENDING request from C2W-001 (`POST /customer-funding-requests/:id/approve`).
- Expected: Approval lands; customer wallet credited exactly ₦10,000 (no fee, non-fee-bearing policy); customer history shows FUNDING credit with reference; approval notification received.
- Financial block: BEFORE cust ____ FEE must be 0 VAT 0 | AFTER cust = BEFORE+10,000 | TXN ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-003** · Area: Financial/C2W · **P0** (negative) · Role: [WORKFORCE OPERATOR]
- Steps: Create a second request for Customer B (₦1,000); REJECT it with reason.
- Expected: Request marked REJECTED; no credit; customer sees rejection + reason; notification received.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-004** · Area: Financial/C2W · **P0** (separation of duties) · Role: [WORKFORCE SUPPORT] maker
- Steps: The maker (SUPPORT) attempts to approve THEIR OWN request; then OPERATOR approves it.
- Expected: Self-approval refused (maker ≠ checker enforced); second-operator approval succeeds.
- Financial block: unchanged until checker approves | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-005** · Area: Financial/C2W · **P1** (roles) · Role: [WORKFORCE OPERATOR] + [WORKFORCE SUPPORT]
- Steps: OPERATOR creates a request (allowed maker); SUPPORT attempts to approve it (checker = OPERATOR-class required).
- Expected: SUPPORT approval refused; OPERATOR-class approval by a different operator works.
- Financial block: standard | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-006** · Area: Financial/C2W · **P0** · Role: Customer A
- Purpose: Customer funding history reflects the full audit trail of states.
- Steps: After 001–005, open customer funding history/requests; verify each entry's state transitions (pending→approved/rejected) and references.
- Expected: History complete and consistent with admin view ([ADMIN VERIFY] same list from `GET /customers/:id/funding-requests`).
- Financial block: list evidence | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-007** · Area: Financial/C2W · **P0** (idempotency) · Role: [WORKFORCE OPERATOR]
- Steps: Re-submit the APPROVAL for an already-approved request; also re-submit create with same idempotency key if the console exposes one.
- Expected: No double credit; deterministic conflict/idempotent response; one movement total.
- Financial block: BEFORE ____ AFTER single-credit ____ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-008** · Area: Financial/C2W · **P1** (negative) · Role: [WORKFORCE OPERATOR]
- Test Data: invalid amount (0/negative), unknown customer reference.
- Expected: Refused with clear message; nothing created (or request never reaches PENDING).
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-009** · Area: Financial/C2W (security) · **P0** · Role: Customer A (attempting self-service)
- Steps: Customer attempts to create/approve their own funding via any reachable customer surface.
- Expected: Customer app exposes only READ funding views; creation/approval remain workforce paths — any attempt refused.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-010** · Area: Financial/C2W · **P2** · Role: [WORKFORCE OPERATOR]
- Steps: Queue view of open funding requests (`GET /customer-funding-requests`) — pagination/filter sanity.
- Expected: Queue accurate vs customer histories; no phantom entries.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-011** · Area: Financial/C2W (agent cash-in) · **P0** · Role: Agent A serving Customer B
- Purpose: Agent cash deposit (cash-in) credits customer wallet instantly from agent float.
- Steps: 1. Record agent float + customer wallet BEFORE. 2. Cash-in ₦2,000 to Customer B's receiving identity (`POST /agents/cash-in`). 3. Record AFTER both sides.
- Expected: Customer credited (per policy: fee/VAT per commercial config on this flow); agent float debited per flow semantics; both histories updated; [ADMIN VERIFY] positions reconcile.
- Financial block: BEFORE agent ____ cust ____ | AMT ____ FEE ____ VAT ____ COMM ____ | AFTER agent ____ cust ____ | TXN ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-012** · Area: Financial/C2W (agent cash-in) · **P0** (negative) · Role: Agent B (₦20,000 float)
- Steps: Cash-in amount exceeding available float (e.g. ₦25,000).
- Expected: Refused insufficient/available-float message; customer NOT credited.
- Financial block: unchanged both sides | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2W-013** · Area: Financial/C2W (agent cash-in) · **P2** (notifications) · Role: Customer B + Agent B
- Expected: Successful cash-in notifies customer (SMS/inbox) with amount/reference; agent receipt observable; no secrets in bodies.
- Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 5.4 `UAT-C2C-*` — Agent Cash→Cash (create / claim / expiry) (16 tests)

**UAT-C2C-001** · Area: Financial/C2C · **P0** · Role: Agent A
- Purpose: Cash-to-cash send creation — funds reserved from agent float; claim code issued.
- Test Data: ₦4,000; recipient = walk-in identity `+23480••••C2C1` (real SIM).
- Steps: 1. Record agent float BEFORE. 2. Create (`POST /agents/cash-to-cash`). 3. Record the issued transfer reference/hashed code artifact shown; float AFTER.
- Expected: Reservation reflected (reserved/unclaimed amount visible in agent financial-position); fee/commission display per config; claim code delivered per flow (never echoed in plain logs); history shows CREATED/UNCLAIMED state.
- Financial block: BEFORE agent ____ AVAIL ____ RESERVED ____ | AMT ____ FEE ____ VAT ____ COMM ____ | AFTER avail/reserved ____ | ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-002** · Area: Financial/C2C · **P0** · Role: Agent A + recipient walk-in
- Purpose: Successful claim by recipient agent-side flow.
- Steps: 1. At Agent B, recipient presents code + identity. 2. Claim (`POST /agents/cash-to-cash/claim`).
- Expected: Claim succeeds on first valid attempt; settlement moved (unclaimed → claimed) exactly once; both parties notified; physical cash handed (record).
- Financial block: RESERVED ↓ by AMT; claimed-entry balance correct | TXN/CLAIM ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-003** · Area: Financial/C2C · **P0** (negative) · Role: walk-in at Agent B
- Steps: Present a deliberately WRONG code.
- Expected: Refused neutral invalid-code error; no movement; attempt counted (record messaging).
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-004** · Area: Financial/C2C · **P0** (negative) · Role: walk-in
- Steps: Attempt to claim an ALREADY-CLAIMED transfer a second time.
- Expected: Refused (already claimed/final state); no double payout.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-005** · Area: Financial/C2C · **P1** (negative) · Role: walk-in
- Steps: Present correct code but mismatched recipient identity/phone where the flow requires a match.
- Expected: Refused with neutral mismatch messaging (no opportunity for partial payout).
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-006** · Area: Financial/C2C (expiry) · **P0** · Role: tester + [WORKFORCE OPERATOR] scheduling help
- Preconditions: A short-lived C2C is created; environment expiry window per ENV-12 (7 days default; UAT build may use a shortened window — record which).
- Steps: 1. Create C2C, do not claim. 2. Wait past expiry (or advance scheduled expiry processing timebox). 3. Attempt claim afterwards.
- Expected: Transfer state transitions to EXPIRED; claim refused (expired), neutral error.
- Financial block: timestamp evidence ____ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-007** · Area: Financial/C2C (expiry) · **P0** · Role: Agent A
- Purpose: Expiry RESTORES the sender funds (reservation released back to available/balance).
- Steps: After C2C-006 expiry, re-read agent financial position and wallet; compare reserved/available vs pre-creation values (net of fee rules if fees non-refundable — record observed policy).
- Expected: Principal restored exactly; no stranded reservation; expiry entry in history [ADMIN VERIFY].
- Financial block: BEFORE-expiry reserved ____ → AFTER-expiry reserved 0 / returned ____ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-008** · Area: Financial/C2C · **P1** · Role: Agent A
- Steps: Agent history/transaction views show the C2C lifecycle entries (created → claimed/expired) with correct labels and amounts.
- Expected: Unified history (V1 feature #59) accurate across all three lifecycle samples produced by this family.
- Financial block: list evidence | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-009** · Area: Financial/C2C (limits) · **P1** · Role: Agent A
- Steps: Attempt C2C creation above per-transaction limit; then cumulatively-several under-limit transfers to hit the daily/cumulative limit (seed values from ENV-09).
- Expected: Per-tx refusal on over-limit creation; cumulative refusal once cap reached; messages identify the plane.
- Financial block: refused items unchanged; accepted ones recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-010** · Area: Financial/C2C · **P0** (negative) · Role: suspended scratch Agent
- Steps: [WORKFORCE] suspend scratch agent; attempt create + claim there.
- Expected: Both refused while suspended; reactivate after.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-011** · Area: Financial/C2C (idempotency) · **P1** · Role: Agent A
- Steps: Same creation submitted twice with the same idempotency key.
- Expected: Single reservation; duplicate returns original result; claim proceeds once.
- Financial block: one reservation | KEY: ______ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-012** · Area: Financial/C2C (negative) · **P2** · Role: Agent A
- Test Data: amount 0/negative/non-numeric at creation.
- Expected: Refused format; nothing created/reserved.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-013** · Area: Financial/C2C · **P1** (negative) · Role: Agent B (₦20,000 float)
- Steps: Create C2C above available float.
- Expected: Refused insufficient available balance (reservation would overdraft); nothing reserved.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-014** · Area: Financial/C2C · **P2** (privacy) · Role: Tester (visual)
- Steps: Inspect screens/history/SMS for the claim code and recipient details on non-recipient surfaces.
- Expected: Claim code never exposed to unauthorized surfaces; recipient identity minimally exposed (masked where appropriate).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-015** · Area: Financial/C2C (notifications) · **P0** · Role: Agent A + recipient
- Expected: Creation notifies per design (claim-ready), claim confirms both sides, expiry notifies sender; timing sane (seconds–minutes); no full code content in post-claim/expiry messages.
- Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-C2C-016** · Area: Financial/C2C · **P2** (reconciliation surface) · Role: [WORKFORCE OPERATOR]
- Steps: [ADMIN VERIFY] Unclaimed/reserved totals in reconciliation + agent financial position while 1–2 C2C are mid-life; confirm they net to zero after completion.
- Expected: Reserved balances visible and coherent; nothing stranded in final reconciliations.
- Financial block: totals recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 6 — AGENT NETWORK (families AGENT / FUND)

### 6.1 `UAT-AGENT-*` — Agent lifecycle, app surfaces, restrictions (14 tests)

**UAT-AGENT-001** · Area: Agent/Application · **P0** · Role: Prospective agent (public)
- Steps: Submit application from the public agent application surface (`POST /agents/applications`) with `[TEST AGENT A PHONE]` data; include an obviously incomplete second application to observe validation.
- Expected: Valid application accepted with reference; incomplete/invalid rejected with clear field errors; no approval/activation implied yet.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-002** · Area: Agent/Approval · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Review AGENT-001's application; APPROVE it; create a second application and REJECT it with reason.
- Expected: Approved moves onward with class/limits defaults per policy; rejected marked with reason; both visible in admin lists.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-003** · Area: Agent/Activation · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Activate the approved agent (`POST /internal/admin/agents/:id/activate`).
- Expected: ACTIVE status; limits/class assignment visible; activation event [ADMIN VERIFY].
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-004** · Area: Agent/Credentials · **P0** · Role: [WORKFORCE OPERATOR] + Agent A
- Steps: Issue agent credential; agent receives temporary credential (SMS channel per agent-credentials flow).
- Expected: Temp credential delivered out-of-band; not persistently displayed; issuance event recorded.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-005** · Area: Agent/Credentials · **P0** · Role: Agent A
- Steps: First agent login with temp credential; confirm rotation-required gate; rotate to own credential.
- Expected: Rotation blocked all app use until done; post-rotation login works; old temp dead.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-006** · Area: Agent/App · **P0** · Role: Agent A
- Steps: Normal agent login; open profile/capabilities/receiving-number surfaces (`GET /agents/me/profile|capabilities|receiving-identity|receiving-number` family).
- Expected: Own data renders; capabilities reflect class; receiving number accurate.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-007** · Area: Agent/Wallet · **P0** · Role: Agent A
- Steps: Open financial position (`GET /agents/me/financial-position`).
- Expected: Available + reserved/committed totals rendered; matches recorded ₦100,000 funding ± test movements.
- Financial block: position totals recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-008** · Area: Agent/App · **P1** · Role: Agent A
- Steps: Outlets/terminals lists (`/agents/me/outlets[/:id]`, `/terminals[/:id]`).
- Expected: Assigned outlets/terminals listed (or empty state if unassigned — record).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-009** · Area: Agent/History · **P0** · Role: Agent A
- Purpose: Unified transaction history (V1 feature #59).
- Steps: After executing cash-in, cash-out, C2C create/claim/expiry, funding/defunding samples, open `/agents/me/transactions`.
- Expected: Every executed operation appears exactly once with correct type, direction, amounts, status, timestamps; no missing types.
- Financial block: cross-check vs Section 5 records | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-010** · Area: Agent/Status · **P0** (negative) · Role: [WORKFORCE OPERATOR] + scratch Agent
- Steps: Suspend scratch agent; from agent app attempt: login, cash-in, cash-out, C2C create.
- Expected: All refused (auth or action-level); clear messaging; existing sessions challenged.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-011** · Area: Agent/Status · **P1** (negative) · Role: [WORKFORCE OPERATOR]
- Steps: Terminate scratch agent; attempt login/action; then reactivate and verify operational again where policy allows.
- Expected: Terminal refusal while terminated; reactivation per policy restores access (record lifecycle allowed/disallowed as implemented).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-012** · Area: Agent/Support · **P1** · Role: Agent A
- Steps: Agent creates support ticket (`POST /agents/me/support/tickets`); workforce updates it; agent re-reads.
- Expected: Ticket lifecycle works parallel to customer support; messages coherent.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-013** · Area: Agent/Capabilities · **P1** · Role: [WORKFORCE OPERATOR]
- Steps: Change agent class/capability assignment for scratch agent; observe capability surface and one gated action (e.g., a class without C2C capability attempts create).
- Expected: Capability change effective; disallowed class actions refused coherently.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-AGENT-014** · Area: Agent/Security eventing · **P2** · Role: [WORKFORCE OPERATOR]
- Steps: [ADMIN VERIFY] security events trail for agent credential issuance/rotation/failed attempts in admin views.
- Expected: Events present, timestamped, secret-free.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 6.2 `UAT-FUND-*` — Agent funding / defunding, maker-checker, aggregator attribution (6 tests)

**UAT-FUND-001** · Area: Agent/Funding · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Fund Agent A ₦100,000 (`POST /internal/agents/:id/fund`); record agent position before/after.
- Expected: Position increases exactly; funding event + notification; **non-fee-bearing** (no fee/VAT rows on this operation).
- Financial block: BEFORE ____ AMT 100,000 FEE 0 VAT 0 | AFTER ____ | ID ____
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FUND-002** · Area: Agent/Funding · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Defund Agent A ₦20,000 (`POST /internal/agents/:id/defund`); verify position decreases exactly; non-fee-bearing.
- Financial block: standard | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FUND-003** · Area: Agent/Funding · **P0** (negative) · Role: [WORKFORCE OPERATOR]
- Steps: Attempt defund above available/committable amount (respecting current reservations).
- Expected: Refused with clear availability reason; position unchanged.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FUND-004** · Area: Agent/Funding · **P0** (roles) · Role: [WORKFORCE SUPPORT] + [WORKFORCE OPERATOR]
- Steps: SUPPORT attempts fund/defund; OPERATOR performs it; also record any maker/checker pairing behaviors.
- Expected: Role boundaries per registry enforced (record exact observed denials); [ADMIN VERIFY] attempts auditable.
- Financial block: unchanged on denials | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FUND-005** · Area: Agent/Funding (aggregator) · **P1** · Role: [WORKFORCE OPERATOR] using `[AGGREGATOR REF]`
- Steps: Fund Agent B through the aggregator relationship (`POST /internal/aggregators/:agg/agents/:id/fund`); view aggregator/agent attribution surfaces.
- Expected: Funding attributed to the aggregator; agent position increases; **no commission accrues to the aggregator** (V1 decision — see exclusions).
- Financial block: attribution recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FUND-006** · Area: Agent/Funding (idempotency/id) · **P1** · Role: [WORKFORCE OPERATOR]
- Steps: Replay the SAME funding submission (same idempotency key if console sends one; otherwise back-to-back identical submits with recorded reference) — observe duplicate protection; then fund with a fresh reference as control.
- Expected: No duplicate credit for replayed submission; control credits once.
- Financial block: movements counted | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 7 — COMMERCIAL (families LIM / FEE / COMM)

### 7.1 `UAT-LIM-*` — Limits (6 tests)

**UAT-LIM-001** · Area: Commercial/Limits · **P1** · Role: [WORKFORCE OPERATOR]
- Steps: Inspect assigned limit profiles for Agent A and Customer A (admin limit surfaces per limit catalogue/assignment).
- Expected: Profiles visible with values matching ENV-09 pilot configuration; versions/references present.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-LIM-002** · Area: Commercial/Limits · **P0** · Role: Agent A (financial flow)
- Steps: Trigger a per-transaction limit breach (e.g., oversize cash-in), then a compliant amount.
- Expected: Breach refused with explicit limit reason + authoritative remaining value where exposed; compliant amount succeeds; same-day usage accumulates correctly afterwards.
- Financial block: usage before/after recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-LIM-003** · Area: Commercial/Limits · **P1** · Role: Agent A
- Steps: Accumulate same-day usage to the daily/cumulative cap via multiple compliant transactions.
- Expected: Once cap reached, further same-day transactions refused; refusal references cumulative plane; counters visible to [ADMIN VERIFY] (limit usage/diagnostics).
- Financial block: running usage recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-LIM-004** · Area: Commercial/Limits · **P1** · Role: Customer A
- Steps: Trigger the customer-side limit plane (per-tx and/or cumulative per policy) via W2W attempts; verify customer-visible messaging.
- Expected: Clear refusal mentioning the applicable plane; correct amounts still succeed below the plane.
- Financial block: unchanged on refusal | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-LIM-005** · Area: Commercial/Limits · **P2** · Role: [WORKFORCE OPERATOR]
- Steps: Change an agent limit assignment; immediately attempt an amount between the old and new values [ADMIN VERIFY] diagnostics.
- Expected: Assignment change takes effect deterministically (record propagation semantics); diagnostics agree with behavior.
- Financial block: behavior evidence | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-LIM-006** · Area: Commercial/Limits · **P2** · Role: [WORKFORCE OPERATOR]
- Purpose: No limit "bypass by splitting" within the same day beyond policy intent (recording behavioral observation, not enforcing a rule the platform does not define).
- Steps: Split an over-limit amount into two under-limit rapid transfers; record outcomes.
- Expected: Per-tx plane passes; cumulative plane (if configured) eventually refuses — record exact planes observed.
- Financial block: usage recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 7.2 `UAT-FEE-*` — Fees & VAT display/policy (6 tests)

**UAT-FEE-001** · Area: Commercial/Fees · **P0** · Role: Customer A
- Purpose: Fee-bearing W2W displays assessed fee + VAT equal to the applied charges (cross-checked with W2W-014).
- Steps: Compare pre-transaction quote/expectation (where the app shows one) vs post-transaction detail rows (`fee`/`vat`).
- Expected: Quote (if shown) == charged; charged == balance movement decomposition; VAT treatment matches ENV-07 (exclusive add-on vs inclusive) exactly.
- Financial block: quoted ____ charged fee ____ vat ____ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FEE-002** · Area: Commercial/Fees · **P0** (policy) · Role: [WORKFORCE OPERATOR]
- Purpose: V1 non-fee-bearing flows stay non-fee: customer funding approvals, agent funding, agent defunding.
- Steps: Verify each of its financial records shows fee=0, vat=0 rows (or no fee line), no fee/VAT debit in movements.
- Financial block: three evidences | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FEE-003** · Area: Commercial/Fees · **P1** · Role: Customer A
- Purpose: Failed/rejected transactions carry NO fee/VAT residues anywhere in history/balances.
- Steps: Re-check histories after earlier negative tests (wrong PIN, insufficient, limit refusals).
- Expected: Balance unchanged; no fee entries exist for failed attempts; where failed attempts are listed at all, they show zero charge.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FEE-004** · Area: Commercial/Fees · **P1** · Role: Agent A [ADMIN VERIFY]
- Purpose: Agent-side flows (cash-in/cash-out/C2C) apply fees per commercial decision + display them.
- Steps: For each executed agent family sample, record fee/VAT rows [ADMIN VERIFY] decision snapshot references on the transfer records.
- Expected: Applied values match the configured product/fee rules; snapshot references present and resolvable; unconfigured product combos fail closed rather than silently charging a default.
- Financial block: per-flow fee/vat rows | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FEE-005** · Area: Commercial/Fees · **P2** · Role: [WORKFORCE OPERATOR]
- Steps: Display/verify fee rule catalogue + resolver inputs for each product (product catalogue; fee-rule rows).
- Expected: Values match the approved commercial decision pack; no unapproved local edits; kobo/naira conversions exact (no rounding drift observed over 10 sample computations).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-FEE-006** · Area: Commercial/Fees · **P2** (VAT sanity) · Role: Tester
- Steps: Independently compute VAT for a ₦1,000 and a ₦999,999 fee-bearing sample per ENV-07 treatment; compare with displayed figures.
- Expected: Displayed VAT matches computation on both extremes; no rounding anomalies beyond documented policy (record rounding rule observed).
- Financial block: two computations | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

### 7.3 `UAT-COMM-*` — Commissions (4 tests)

**UAT-COMM-001** · Area: Commercial/Commission · **P1** · Role: Agent A [ADMIN VERIFY]
- Purpose: Commission accrual on qualifying agent transactions is computed per commission rules and is visible [ADMIN VERIFY] in agent financial/commission surfaces.
- Steps: After agent cash-in/cash-out/C2C samples, view agent position [ADMIN VERIFY] accrued commission amounts; cross-check one amount by hand vs rule.
- Expected: Accrual matches rule computation; amount traceable to source transaction; surfaces show accrual state recognized per ENV-07 timing (immediate/netting behavior per approved treatment).
- Financial block: source txn ____ accrual ____ expected ____ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-COMM-002** · Area: Commercial/Commission · **P1** · Role: Agent A
- Purpose: Where the approved treatment nets commission to the agent wallet (`AGENT_WALLET_NETTING`), the agent-side position reflects it; where a payable-recognition treatment applies, the agent wallet does NOT move silently.
- Steps: Read agent financial position before/after qualifying transactions; record observed treatment behavior against ENV-07.
- Expected: Behavior consistent with the configured treatment; no unexplained extra credit/debit.
- Financial block: before/after recorded | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-COMM-003** · Area: Commercial/Commission · **P2** · Role: [WORKFORCE OPERATOR]
- Purpose: Non-commissionable flows per rules base (funding/defunding/customer funding) accrue NOTHING.
- Steps: [ADMIN VERIFY] commission surfaces for the funding family from §6.2/§5.3.
- Expected: Zero accruals listed for those references.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-COMM-004** · Area: Commercial/Commission (exclusion sentinel) · **P0** · Role: [WORKFORCE OPERATOR]
- Purpose: V1 boundary sentinel — aggregators/platform NEVER accrue commission in V1 (no mislabeled revenue).
- Steps: Run aggregator-attributed funding (FUND-005) + any agent transactions under aggregator relationship paths; [ADMIN VERIFY] commission views for aggregator/platform entries.
- Expected: NO aggregator/platform commission lines anywhere; fail-closed posture intact (e.g., any attempted unprovenanced platform allocation would surface a hard error rather than silent accounting — observe + record if configuration attempts are out of scope).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 8 — WORKFORCE / OPERATIONS & ADMIN (family ADMIN, 12 tests)

**UAT-ADMIN-001** · Area: Operations/Access · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Workforce sign-in through OIDC (ENV-05); note identity; sign out; sign in with wrong/expired OIDC subject (negative).
- Expected: Valid workforce session established; wrong identity refused; session TTL behaves (record approx TTL observed).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-002** · Area: Operations/Customers · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Customer list + search + view 360 for Customer A (profile, wallets, balance, transactions, support tickets).
- Expected: Full read model accurate vs customer app data; pagination sane; support role can view but not mutate (record).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-003** · Area: Operations/Agents · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Agent investigation — Agent A's financial position, transactions, lifecycle, relationships (aggregator attribution).
- Expected: Ledger-derived position equals app-side tally from earlier tests; relationships correct.
- Financial block: position reconciliation evidence | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-004** · Area: Operations/Reconciliation · **P0** · Role: [WORKFORCE OPERATOR] (finance lane if split)
- Steps: Run reconciliation report + trial balance after a full test day's activity.
- Expected: `violations == 0` (acceptance gate); any WARNINGS enumerated and explainable (record with screenshots); equivalents balanced (assets = liabilities structure).
- Financial block: report hash/evidence | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-005** · Area: Operations/Reconciliation · **P1** · Role: [WORKFORCE OPERATOR]
- Steps: Finance verification + per-account activity views for a sample of system accounts (fees, VAT payable, commission payable, unclaimed C2C).
- Expected: Movements aggregate to sampled test transactions; no unexplained residuals; timestamps in Lagos TZ.
- Financial block: sampled totals | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-006** · Area: Operations/Support · **P1** · Role: [WORKFORCE SUPPORT/OPERATOR]
- Steps: Operate the support queue: assign customer+agent tickets, add messages, change statuses to resolve/close.
- Expected: Full lifecycle works; customer/agent-visible statuses flow through (observe in their apps on CUST-009/AGENT-012); closed tickets immutable thereafter (record behavior).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-007** · Area: Operations/Notifications · **P1** · Role: [WORKFORCE OPERATOR]
- Steps: Open notification delivery diagnostics; locate today's OTP/credential/funding/C2C deliveries; inspect statuses.
- Expected: Deliveries enumerated with provider status (sent/failed), attempts, timestamps; failures (if any) show retry/end state — matches handsets' realities from Section 9.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-008** · Area: Operations/Audit · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: [ADMIN VERIFY] Audit evidence spot-check: activation, credential issuance, funding approve-reject, PIN lock, transfer, C2C claims — confirm event trail exists, carries actor + timestamp + metadata, and contains NO secrets (no PIN, no OTP, no passwords/keys).
- Expected: All sampled actions auditable; zero secret leakage in any sampled event.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-009** · Area: Operations/Versioning · **P2** · Role: [WORKFORCE OPERATOR]
- Steps: Read `/internal/version` (public internal surface); confirm deployed build matches UAT baseline reference; capture health/ready responses.
- Expected: Versions match declared build; readiness reports migration tip …0079 and no violations.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-010** · Area: Operations/Aggregators · **P1** · Role: [WORKFORCE PRIVILEGED]
- Steps: Create aggregator (if `[AGGREGATOR REF]` unused) + lifecycle (suspend/reactivate), assign Agent B relationship, view list/detail.
- Expected: CRUD + relationship works; aggregator does NOT log in itself (no portal — exclusion), finance queries answered via existing agent/position views.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-011** · Area: Operations/Lifecycle controls · **P1** · Role: [WORKFORCE OPERATOR]
- Steps: On scratch entities, run customer lifecycle (suspend/reactivate/terminate) with reasons; verify each transition visible in audit + customer-app behavior synced.
- Expected: Transitions authoritative; SUPPORT cannot perform them (see SEC-005); audit complete.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-ADMIN-012** · Area: Operations/Incident posture · **P2** · Role: [WORKFORCE PRIVILEGED]
- Steps: Review operational surfaces for an incident-style query: "find the transfer with ID X end-to-end" — trace through customer 360 → transaction detail → reconciliation activity [ADMIN VERIFY] event trail.
- Expected: Complete, coherent trace without database access (UI surfaces only) for the sampled transaction; gaps recorded as P2 defects/observations.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 9 — SECURITY & AUTHORIZATION (family SEC, 12 tests)

**UAT-SEC-001** · Area: Security/Data isolation · **P0** · Role: Customer A vs Customer B
- Steps: From A's session, try accessing B's surfaces: wallets, balance, transfers, profile, funding history — via any UI deep-link or direct URL manipulation; repeat from B to A.
- Expected: Every attempt refused (401/403) or neutral not-found; **no read mutation leaks**; alerts not exposed.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-002** · Area: Security/Data isolation · **P0** · Role: Customer A
- Steps: Attempt a transfer naming Customer B's wallet ID as SOURCE while A is logged in (A has A's PIN).
- Expected: Refused (ownership enforced server-side); no movement in either wallet.
- Financial block: all unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-003** · Area: Security/Role boundaries · **P0** · Role: Customer A
- Steps: Try every reachable workforce operation with customer session (approve funding, activate customer, internal dashboards, funding approvals, reconciliation).
- Expected: Everything refused; zero mutation; [ADMIN VERIFY] attempts visible in logs.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-004** · Area: Security/Role boundaries · **P0** · Role: Agent A
- Steps: Same attempts with agent session (fund self, approve requests, internal views).
- Expected: Refused; agent cannot self-fund under any surface.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-005** · Area: Security/Role boundaries · **P0** · Role: [WORKFORCE SUPPORT]
- Steps: As SUPPORT: attempt customer/agent lifecycle ops (suspend/terminate/reactivate/activate), checker operations on approvals, credential issuance, unauthorize exports if any.
- Expected: Each refused (SUPPORT is read + funding-maker + support-queue only per registry); [ADMIN VERIFY] denials auditable.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-006** · Area: Security/Agent isolation · **P0** · Role: Agent A vs Agent B
- Steps: A tries B's profile/position/outlets/history surfaces; B's receiving-numbers; B's C2C artifacts.
- Expected: Refused/isolated everywhere; C2C codes of B unusable by A except through legitimate claim path with recipient present.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-007** · Area: Security/State restrictions · **P0** · Role: suspended agent + terminated customer (scratch)
- Steps: Suspended agent: initiate cash-in/out/C2C. Terminated customer: login + actions.
- Expected: Refused at action level; existing sessions invalidated or refused; zero financial movement anywhere.
- Financial block: unchanged | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-008** · Area: Security/PIN boundary · **P0** · Role: Customer A
- Steps: Attempt W2W without PIN (W2W-007), W2C with bogus PIN (W2C-002), PIN verify spam until lock (PIN-004) — consolidate the evidence references here as the authorization-boundary subset.
- Expected: Every PIN-required action blocked without valid PIN; no bypass path exists in any exposure surface found.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-009** · Area: Security/Credential rotation gate · **P0** · Role: Customer C (rotation-required state)
- Steps: Hold a rotation-required session and attempt: wallet read, transfer, PIN set, history — before rotating.
- Expected: All refused with rotation-required messaging; only the rotation action works.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-010** · Area: Security/Session integrity · **P0** · Role: Customer A
- Steps: Capture the working session token (dev tools); logout; replay the token against wallet/history endpoints.
- Expected: Replayed token useless (session invalidated server-side); fresh login required.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-011** · Area: Security/Session & device · **P1** · Role: Customer A
- Steps: Same account, TWO concurrent sessions (two devices); logout on device-1; observe device-2; then change password; observe sessions.
- Expected: Behavior matches policy (record: independent sessions vs revocation-on-password-change); nothing permits device-2 to keep mutating after revocation-class events if policy so defines.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-SEC-012** · Area: Security/Transport & storage hygiene · **P1** · Role: Tester (technical)
- Steps: Inspect network traffic (HTTPS only — no plaintext secrets); confirm app does not persist PIN/password in address bars/history; confirm sensitive inputs are masked; confirm no tokens in browser storage that logs expose casually (record storage model observed).
- Expected: TLS everywhere; masked secrets; no console/log leakage of tokens or PIN/OTP.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 10 — REAL-WORLD / NIGERIA PHYSICAL TESTS (family NIG, 10 tests)

> Run on real Nigerian SIMs (at least two carriers), on physical devices, in cellular conditions.
> Record carrier, location (city), and time for latency trials. These exist because headless tests cannot prove them.

**UAT-NIG-001** · Area: Real-world/SMS · **P0** · Role: Tester + real SIM pool
- Steps: Register with a fresh `+234…` number on MTN; repeat with Airtel/Glo/9mobile SIMs as available; record which delivered.
- Expected: OTP SMS arrives on each tested carrier; handset displays sensible sender identity (ENV-04).
- Latency per carrier: ______ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-002** · Area: Real-world/OTP latency · **P0** · Role: Tester
- Steps: Measure OTP arrival latency over 10 requests at different times of day; record min/median/max.
- Expected: Median ≤ ~30s typical; larger delays recorded (and flagged as P2 ops item if provider-caused); codes still validate within TTL (ENV-12).
- Latency log: ____________________ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-003** · Area: Real-world/OTP resilience · **P1** · Role: Tester
- Steps: One OTP intentionally delayed (airplane mode ON for 3–4 min at request time → OFF); try expired-window code afterwards (correlate with TTL).
- Expected: Delayed delivery accepted if within TTL; expired rejection behaves per REG-010; user messaging guides re-request.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-004** · Area: Real-world/OTP ordering · **P1** · Role: Tester
- Steps: Request OTP three times rapidly (respecting cooldowns), receive three SMS potentially OUT OF ORDER; try the FIRST code, then the LATEST code.
- Expected: Semantics match REG-007 (latest-usable); user confusion minimized by messaging (e.g., "use the most recent code" where implemented — record).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-005** · Area: Real-world/Network loss · **P0** · Role: Tester
- Steps: Airplane-mode ON mid-transfer (after PIN submit), leave 30s, THEN re-enable and resend with the SAME idempotency key/app retry; check history.
- Expected: Exactly one transfer (or a clean failure state) — never double-charge; clear UI state after recovery; [ADMIN VERIFY] one journal.
- Financial block: movements counted ____ | Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-006** · Area: Real-world/Network quality · **P1** · Role: Tester
- Steps: Operate the four financial flows on EDGE/3G throttling (dev-tools throttle or rural area): measure success + timeout messaging.
- Expected: Flows complete or fail cleanly with retry guidance; no stuck "loading forever" states; optimistic->confirmed transition accurate.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-007** · Area: Real-world/Switching networks · **P1** · Role: Tester
- Steps: Mid-session, toggle Wi-Fi ↔ mobile data repeatedly; continue actions including one transfer.
- Expected: Session intact (or clean re-auth per policy); actions complete; no phantom duplicate operations.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-008** · Area: Real-world/SMS failure path · **P1** · Role: Tester + [WORKFORCE OPERATOR]
- Steps: Register a number on a carrier with delivery issues OR temporarily force non-delivery (device blocked-airplane window exceeding retry TTL); observe notification diagnostics [ADMIN VERIFY] and retry behavior.
- Expected: Platform retries bounded (ENV: retry cap), final FAILED status visible in diagnostics; user gets actionable guidance (resend); no infinite retry.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-009** · Area: Real-world/Phone formats · **P1** · Role: Tester
- Steps: Enter phone as `080…`, `+234…`, `234…` at registration/login/transfer-receiving surfaces.
- Expected: Acceptable local formats normalize to canonical `+234…` (record accepted set); stored/displayed consistently; no duplicate identity from format variants.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-NIG-010** · Area: Real-world/Device & browser · **P1** · Role: Tester
- Steps: Full smoke pass (register→activate→PIN→one W2W→one C2C claim) on: Android Chrome, iOS Safari, one desktop browser; record crashes/blank screens/input focus issues.
- Expected: No crashes; consistent rendering of currency (₦ + comma grouping), buttons, OTP/PIN keyboards (numeric pad on mobile for PIN/OTP where feasible); orientation changes don't lose state.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 11 — DEPLOYMENT CONFIGURATION SANITY TESTS (family CFG, 8 tests)

**UAT-CFG-001** · Area: Deployment/SMS · **P0** · Role: [WORKFORCE PRIVILEGED]
- Steps: Verify live SMS path end-to-end (new registration OTP to a fresh SIM); confirm provider console shows production-mode traffic; confirm `console` provider is NOT in use.
- Expected: Delivery proven on the Robase production configuration; no console/test fallback active.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CFG-002** · Area: Deployment/Worker · **P0** · Role: [WORKFORCE PRIVILEGED]
- Steps: Trigger an SMS event; observe worker processing (delivery transitions pending→sent in diagnostics during the run).
- Expected: Worker live; no queue backlog growth (diagnostic counts stable across the day).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CFG-003** · Area: Deployment/Sender identity · **P1** · Role: Tester
- Steps: Inspect sender ID on received SMS across events (OTP, credential, funding, C2C).
- Expected: Consistent approved sender identity; no "unknown sender" variance across events.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CFG-004** · Area: Deployment/Workforce auth · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Full OIDC login/logout cycle; TTL observation; bootstrap runbook state: confirm bootstrap is disabled/secured post-provisioning.
- Expected: OIDC functional; no bootstrap backdoor active; config evidence captured (no secret values).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CFG-005** · Area: Deployment/Commercial config · **P0** · Role: [WORKFORCE OPERATOR]
- Steps: Cross-check ENV-07 values vs observed charge behavior in FEE-001/004 + commission treatment in COMM-001/002; verify a deliberately unconfigured sample product (if any exists in catalogue) fails closed rather than charging defaults.
- Expected: All values coherent; fail-closed posture demonstrable on unprovenanced sample.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CFG-006** · Area: Deployment/Limits config · **P1** · Role: [WORKFORCE OPERATOR]
- Steps: Match live limit values against the pilot policy sheet (ENV-09): one per-tx, one daily/cumulative.
- Expected: Values equal the policy sheet; mismatch = FAIL/BLOCKED finding (then fix config, RETEST).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CFG-007** · Area: Deployment/Data config · **P1** · Role: [WORKFORCE PRIVILEGED]
- Steps: Confirm DB connectivity/SSL posture evidence from deployment; migrations applied = 80 (tip …0079); health/ready + readiness endpoints all green (violations==0).
- Expected: All checks green; screenshots captured.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-CFG-008** · Area: Deployment/Boundary sentinel · **P0** · Role: [WORKFORCE PRIVILEGED]
- Steps: Confirm `A6_PARTNER_ENABLED=false` and no NIBSS/bank traffic; confirm notification config has NO push provider settings active; confirm no secret printed in startup/process logs sampled.
- Expected: V2-only rails fully inert; zero secret exposure in sampled logs (redaction working).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 12 — GENERAL USABILITY (family UX, 6 tests)

**UAT-UX-001** · Area: Usability · **P3** · Role: First-time tester (no brief)
- Steps: Complete registration→activation→PIN→first transfer with NO documentation or coaching.
- Expected: Flow completable unaided; confusion points noted as notes/P3 items (single-word errors like foreign jargon = defect notes).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-UX-002** · Area: Usability · **P3** · Role: Tester
- Steps: Read every error message met during negative tests: clarity, actionability, language level.
- Expected: Messages tell the user what to do next (resend, correct, contact support) without technical jargon or leaked internals (no stack traces/UUIDs unless support reference is intentional).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-UX-003** · Area: Usability · **P3** · Role: Tester
- Steps: Currency rendering sanity across screens (₦ symbol, kobo→naira conversion, comma grouping, negative/zero formatting).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-UX-004** · Area: Usability · **P3** · Role: Tester
- Steps: Transaction history readability (labels direction "Sent/Received", counterparties, date formats, status badges) for a non-technical user.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-UX-005** · Area: Usability · **P3** · Role: Tester
- Steps: Support flow from customer viewpoint end-to-end (how easy to find, create, follow, close).
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

**UAT-UX-006** · Area: Usability · **P3** · Role: Tester
- Steps: Accessibility quick pass — contrast on key actions, font scale tolerance, numeric keypad on PIN/OTP fields, tab order on desktop.
- Actual: ______ | Result: ☐PASS ☐FAIL ☐BLOCKED ☐NOT TESTED | Evidence: ____ | Defect: ____ | Notes: ____ | Retest: ____

## SECTION 13 — DO NOT TEST AS V1 REQUIREMENTS (explicit V1 exclusions)

These are **V2/excluded**. If they are missing or inert, that is CORRECT — record nothing as a V1 failure.

| # | Excluded item | Repository stance |
|---|---|---|
| X-01 | Push notifications / device tokens (registration, FCM/APNS delivery) | V2. Machinery exists; delivery substrate deliberately absent (`PUSH_TOKEN_DEPENDENCY_MISSING` honest skip). V1 security notifications are SMS-based. |
| X-02 | Rewards crediting (points, wallets of rewards, cashback) | V2. Reward-rule engine machinery exists un-wired by decision. |
| X-03 | Aggregator self-service login / scoped aggregator portal/position | DECISION PENDING (§23-9) — not a V1 UAT acceptance criterion unless subsequently ratified into V1. Workforce admin for aggregators IS in V1 (ADMIN-010). |
| X-04 | External commission payout rails (settle/settlement execution to banks) | V2 (DP-08: payout rail V2-parked). Internal accrual + wallet-netting ARE V1-tested (COMM-001/002). |
| X-05 | External bank / NIBSS / provider settlement | V2. A6 adapter scaffold exists disabled (`A6_PARTNER_ENABLED=false`) — CFG-008 verifies inertness. |
| X-06 | Bank integration feature surface (NIP transfers, bank withdrawals to external accounts) | V2. |
| X-07 | Aggregator / platform commission accounting | V2. Fail-closed sentinel is COMM-004. |
| X-08 | External payout of any kind (cash-out to external rails) | V2. |
| X-09 | Reconciliation-break resolver workflow (resolve/acknowledge endpoints) | DECISION PENDING (§25-1) — not a V1 UAT acceptance criterion; reconciliation REPORTING is tested (ADMIN-004/005). |
| X-10 | Operations reversal UI workflow (transfer reversal w/ reason + maker/checker) | DECISION PENDING (V1-017), provisionally V2 — not a V1 UAT acceptance criterion. Corrective-ledger primitives are internal; do not test as user feature. |
| X-11 | Internal settle-later commission release rail (D-C-014 mechanism choice) | DECISION PENDING — accrual and immediate netting are tested (COMM-001/002); release cadence is not a UAT criterion. |
| X-12 | KYC level hard-gating beyond verified-phone precondition; enforcing aggregate readiness flag | DECISION PENDING (§23-3) — record observations in ONB-006 but no pass/fail on extra gating. |
| X-13 | DRAFT cleanup/TTL duration values | DECISION PENDING (ops-config) — retention of abandoned DRAFTs is intentional; cleanup scheduling is not UAT. |
| X-14 | Merchant QR / card payments / PoS integrated flows / agents-only marketplace | Not V1 scope (never built). |
| X-15 | Multi-currency (USD/etc.), FX | V1 is NGN-only (W2W-011 expects non-NGN rejection). |
| X-16 | Auto-provisioned wallets at activation (atomic "starter bundle") | Deferred decision; wallet creation via documented operational paths is tested (ONB-007, C2W-011 lazy creation). |

**Tester rule:** finding any X-item absent/inert is PASS-by-exclusion; record evidence only where the
exclusion sentinel tests (CFG-008, COMM-004) explicitly ask for it.

## SECTION 14 — PRE-EXISTING ENGINEERING OBSERVATIONS (not defects to fix during UAT)

| O-ID | Area | Observation | UAT handling |
|---|---|---|---|
| O-01 | Transaction PIN counters | Under highly concurrent brute-force submissions, failed-count increments can be lost (existing per-attempt transactional counter pattern shared with login lockout); lockout engages by the 5th **committed** failure. Sequential enforcement is exact. | PIN-004 uses sequential attempts; document O-01 reference if UAT uses automated bursts. |
| O-02 | Documentation | One historical contract note references a legacy `X-Transaction-Pin` header convention; superseded by the in-body `pin` convention (recorded in A24 verification). | Use `pin` body field; no action. |
| O-03 | Hardening backlog | P2 conveniences recorded previously (admin list display names, journal correlation helper, support linked-transaction join) — conveniences, not V1 gaps. | Note if observed awkward during ADMIN tests; not FAIL. |

## SECTION 15 — UAT SUMMARY & SIGN-OFF

### 15.1 Overall counters (fill on completion)
| Metric | Count |
|---|---|
| Functional UAT test cases | 183 |
| Deployment configuration checks (CFG-001..008) | 8 |
| **Total test items** | **191** |
| Not tested | ____ |
| Passed | ____ |
| Failed | ____ |
| Blocked | ____ |
| Retest required | ____ |
| **P0 failures** | ____ |
| **P1 failures** | ____ |
| Open defects (IDs) | ____ |
| Blocked test IDs | ____ |
| **OVERALL UAT STATUS** | NOT STARTED / IN PROGRESS / BLOCKED / FAILED / PASSED WITH OPEN P2/P3 ITEMS / PASSED |

### 15.2 Grouped totals
| Group | Families | Tests |
|---|---|---|
| Customer (registration/onboarding/PIN/app) | REG 12 + ONB 8 + PIN 10 + CUST 10 | 40 |
| Agent (lifecycle/app/funding) | AGENT 14 + FUND 6 | 20 |
| Authentication (credentials/rotation/sessions) | AUTH 12 | 12 |
| Security & authorization | SEC 12 | 12 |
| Financial flows | W2W 14 + W2C 12 + C2W 13 + C2C 16 | 55 |
| Commercial (limits/fees/VAT/commission) | LIM 6 + FEE 6 + COMM 4 | 16 |
| Operations / administration | ADMIN 12 | 12 |
| Notifications & real-world SMS (dedicated) | NIG 10 | 10 |
| Usability | UX 6 | 6 |
| Deployment checks | CFG 8 (configuration verification) | 8 |
| **Total** | | **191** |

### 15.3 Priority profile
| Priority | Definition | Count |
|---|---|---|
| P0 | Critical V1 acceptance path (must-pass) | 98 |
| P1 | Important V1 workflow | 63 |
| P2 | Secondary V1 behavior | 24 |
| P3 | Usability/operational observation | 6 |
| **Total** | | **191** |

### 15.4 Pass rules
- `PASSED`: 100% of P0 passed; 0 open P1 failures (or product-owner waiver recorded per defect); P2/P3 open items listed.
- `FAILED`: any P0 failure unresolved at sign-off, or P1 failures without waiver.
- `BLOCKED`: any P0 BLOCKED by missing environment (Section 2) — fix environment, then RETEST.
- `PASSED WITH OPEN P2/P3 ITEMS`: P0/P1 clean; residual P2/P3 defects recorded with owners/dates.

### 15.5 Sign-off
| Role | Name | Signature | Date |
|---|---|---|---|
| Lead tester | ____ | ____ | ____ |
| Product owner | ____ | ____ | ____ |
| Engineering owner | ____ | ____ | ____ |

UAT start date: ______ completion date: ______ environment/version tested: `7eaae111e609ceaea6585370b1b4f24002bf24e4` + deployment candidate SHA ______
