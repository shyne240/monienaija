# V1-CUSTOMER-ONBOARDING-01 — Customer Registration + Phone Verification Foundation

**Baseline:** `4617389cee880fd11897e49fe5cf536812b28359`
**Authority:** `docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md` (hybrid model, SUB-1 phone verification, SUB-2/3 untouched by this task).
**Scope delivered:** the FIRST foundation slice only — customer-facing registration/capture + OTP phone verification, producing a `DRAFT` customer with a verified primary Nigerian phone. Nothing downstream (KYC/review/activation/wallet/credentials/PIN/readiness/retention) is implemented.

---

## 1. What this implementation establishes

### IMPLEMENTED

| Capability | Evidence |
|---|---|
| Customer-facing registration front door | 3 public routes (§2); `CustomerRegistrationService/Controller/Module` in `src/customer-registration/` |
| Nigerian phone normalization | shared service function: accepts `+234…`, `234…`, `0…`, bare 10-digit → canonical 10-digit NSN (`/^[789]\d{9}$/`) used everywhere downstream; E.164 kept only as SMS destination |
| Whole-system phone uniqueness | existing partial-unique index on `customer_contact_methods (type, normalized_value)` is the enforcement; new partial-unique indexes on the challenge table bound outstanding challenges/tokens |
| DRAFT-only customer creation | hard-coded `status: CustomerStatus.DRAFT` in the registration service; **not caller-controlled**; reference `mn-<canonical phone>` (lowercase per `chk_customers_reference`) |
| OTP challenge machinery | `customer_registration_phone_challenges` (migration `1785753600078`) — CSPRNG 6-digit code (`crypto.randomInt`), per-challenge salted PBKDF2-SHA256 (100k) digest, never plaintext; TTL 300 s; `ACTIVE→VERIFIED|EXPIRED|REVOKED` state machine; ≤1 ACTIVE and ≤1 VERIFIED-unconsumed per phone (partial unique indexes) |
| Phone verification + authoritative `verified_at` | successful verify flips the challenge `VERIFIED` and mints a **one-time registration token** (32 B random; only SHA-256 hash stored); completion consumes it and writes `customer_contact_methods.verified_at = challenge.verified_at` in the SAME transaction as customer creation |
| Abuse controls | 4 token buckets (§5) on the existing `A2SecurityRateLimitService`; per-challenge 5-attempt cap (mirrors credential lockout); 60 s resend cooldown; OTP constant-work compare (`timingSafeEqual`); challenge supersede (new issue revokes prior ACTIVE/VERIFIED-unconsumed) |
| Audit trail | events in §7; no OTP/token material in audits (fields `code*`, `token*` are redacted by `redactRecord` by design, and are never written in the first place) |
| Enumeration-safe responses | §6 contract |
| SMS delivery via existing substrate | existing `NOTIFICATION_PROVIDER_TOKEN` abstraction (robase when configured, console/test otherwise); event type registered in the security-critical taxonomy (`notification-security.constants.ts`) — header updated honestly: first OTP-class event, direct-send because persisting an outbox delivery record would persist the OTP (forbidden) |

### NOT YET IMPLEMENTED (deliberately, per task scope)

KYC progression · workforce review · activation (+ verified-phone enforcement at activation per SUB-1) · wallet orchestration · customer **credential issuance** (SUB-2: temp credential → forced first-login rotation) · transaction PIN setup · transaction-readiness enforcement · DRAFT retention/cleanup policy (SUB-3 retains DRAFTs; no reaper exists — none added). These remain the decided backlog in `docs/V1-CUSTOMER-ONBOARDING-DECISION-01.md` §12 phases 2–4.

### Preserved decided lifecycle

capture → **phone verification** → `DRAFT` → KYC progression → workforce review → workforce activation → wallet → credential establishment → PIN → transaction-ready → normal login. This task implements steps 1–3 only; steps 4–11 remain workforce/new build work.

---

## 2. Exact routes

All three are added to `RoutePolicyRegistry.PUBLIC_ROUTES` — the existing convention for unauthenticated paths (no session-bearing auth mode can apply pre-registration; CUSTOMER_LOGIN is for session issuance to existing customers). The internal fail-closed `POST /customers` is **unchanged** (still 401 for everyone).

| Method + Path | Purpose |
|---|---|
| `POST /api/v1/customers/registration/otp` | Request/resend a phone-verification OTP (generic response) |
| `POST /api/v1/customers/registration/otp/verify` | Verify OTP → one-time registration token |
| `POST /api/v1/customers/registration` | Consume token → create DRAFT customer + verified phone contact |

## 3. Payload/response shapes

**Request OTP** `{ "phone": "08012345678" }` (also `8…`, `+2348…`, `2348…`) → **200**
`{ "status": "OTP_REQUEST_ACCEPTED", "resendAfterSeconds": 60, "expiresInSeconds": 300 }` — identical for new/taken/cooldown/registered phones.

**Verify OTP** `{ "phone": "…", "code": "123456" }` → **200**
`{ "status": "PHONE_VERIFIED", "verificationToken": "<43-char base64url>", "expiresInSeconds": 900 }` — any failure is the same **400** `OTP verification failed`.

**Complete registration** `{ "phone": "…", "verificationToken": "…" }` → **201**
`{ "id", "reference": "mn-8012345678", "status": "DRAFT", "phone": "+234*****5678", "phoneVerifiedAt": "<iso8601>" }` — invalid/expired verification is **400** `Registration verification is invalid or expired`; phone claimed meanwhile is **409** `Registration could not be completed`.

No credential, wallet, PIN, or status field is accepted or emitted (client-injected `status:'ACTIVE'` is stripped by the global whitelist pipe and irrelevant regardless).

## 4. OTP challenge model (Part 3 outcome)

The audit's open question is resolved: `mfa_challenges` **cannot** represent the decided order (it requires NOT NULL `customer_id/enrollment_id/method_id/session_id` — an existing, session-bound subject), so a narrow dedicated store was added (1 migration, `customer_registration_phone_challenges`): `normalized_phone` (binding anchor), `destination_phone` (E.164), `code_salt` + `code_hash` (PBKDF2-SHA256, 100k, base64url), `verification_token_hash` (SHA-256), `status`, `attempt_count`, `issued_at/expires_at/verified_at/consumed_at/revoked_at`, optimistic `version`, timestamps. Unrelated MFA behavior untouched.

Anti-substitution/replay properties: challenge binds **normalized** phone only (plus-form = same key); verify success mints exactly one token (`verification_token_hash`), set once (`ALREADY_VERIFIED` replay guard); registration consumes it (`consumed_at`, one-shot — rolls back on failure so a legit verifier can retry); re-issue revokes prior ACTIVE and VERIFIED-unconsumed rows (single outstanding token per phone); registration lookup is by normalized phone, so a token cannot bind any other phone; constant-work hashing on the no-challenge path narrows the timing oracle.

## 5. Rate limits / attempt controls (Part 6)

All **operational configuration defaults** (documented in `customer-registration.constants.ts`; no repository/documented regulatory threshold exists, and none is claimed): OTP issue per phone 3/h (bucket), OTP issue per IP 20/h, OTP verify per phone 10/h, registration complete per IP 10/h — each a token bucket on the existing platform limiter (SERIALIZABLE pessimistic, self-auditing 429s, `Security request rate exceeded`). Per-challenge verify cap 5; cooldown 60 s; TTL 300 s; token TTL 900 s. Limits are per-dimension, so one abusive phone/IP cannot exhaust the system for others (proved by tests).

## 6. Enumeration behavior (Part 5)

| Event | Behavior |
|---|---|
| Register already-used phone | OTP request: generic 200, **no SMS, no challenge** (internal no-op). Completion via stolen-token scenario: 409 generic — the caller already proved phone possession, so no leak. |
| Register new phone | generic 200 + SMS + challenge (identical response shape/timing class) |
| OTP request (any state) | identical `{status:OTP_REQUEST_ACCEPTED,...}`; cooldown is also a generic no-op |
| OTP resend | same generic 200; after cooldown a fresh challenge supersedes the old |
| OTP verify (no challenge vs wrong code vs expired vs locked vs replay) | one generic 400 message; constant-work hashing when no challenge exists |
| Failed/expired OTP | same generic 400; `EXPIRED` flip visible only in DB |
| Rate-limit rejection | generic `Security request rate exceeded` (existing phrasing), no phone-state hint |

## 7. Audit events (Part 7)

Actor for all: `customer-self-service` (unauthenticated self-service semantics; no invented principal). On `CUSTOMER_REGISTRATION_CHALLENGE`: `OTP_REQUESTED`, `OTP_VERIFY_FAILED` (with reason), `OTP_VERIFIED`, `REGISTRATION_INITIATED`, `REGISTRATION_FAILED` (with reason), `OTP_DELIVERY_FAILED` (provider name only). On `CUSTOMER`: `CREATED` (extends the platform's existing CREATED audit with `registeredVia: 'customer-self-service'`). On `CUSTOMER_CONTACT_METHOD`: `CREATED`, `PHONE_VERIFIED` (`verified_at` value). Failure records COMMIT via the outcome-return pattern (error thrown outside the tx, same convention as `recordFailedAuthentication`), so the lockout/audit trail survives rejected attempts. No OTP or token material appears anywhere in the trail (test-proved).

## 8. Customer-status boundary (Part 8) — confirmation

This task performs exactly two state transitions: `NO CUSTOMER → DRAFT` and `UNVERIFIED PHONE → VERIFIED PHONE METADATA`. It never performs `DRAFT → ACTIVE` (activation remains the S-FIX-01 workforce-only PATCH, untouched and proved still 401/dead to this surface), never creates wallets/credentials/PINs, and writes no financial ledger rows (test-proved: `ledger_journals`, `ledger_lines`, `wallet_accounts`, `customer_financial_account_bindings` all stay empty; `customer_authentication_credentials` and `customer_transaction_pins` stay empty for the new customer).

## 9. Sandbox mobile screen relationship (Part 9)

`apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx` remains, per the decision doc §11.4 ruling, **unused/deprecated and NOT authoritative**. It is still wired in `AppNavigator`, still posts to the fail-closed internal `POST /customers`, still self-sets `status:'ACTIVE'`, and still creates no credential — it is incompatible with the real contract in §3 (OTP-challenge → token → complete). **Not touched in this task:** replacing it requires the mobile OTP-entry + token-handling + (later) first-credential-rotation screens, which is a deliberate scope expansion of a backend foundation task. Required future change (documented): replace the single-shot POST with the 3-call flow, handle the verification token client-side only, remove the fake "Wallet Created" success copy, and gate on the later first-credential step.

## 10. Delivered files

- `src/customer-registration/` — entity, service, controller, module, constants, 3 DTOs (new)
- `src/migrations/1785753600078-CreateCustomerRegistrationPhoneChallenges.ts` (new; **migration count: 1**)
- `src/authorization/route-policy-registry.ts` — 3 entries in PUBLIC_ROUTES (+ documented justification)
- `src/app.module.ts` — module registration (OTP `code` body field was already in pino redaction)
- `src/notification/notification-security.constants.ts` — first OTP-class event registered (+ honest header rewrite; no push, no second provider)
- `test/v1-customer-onboarding-01.integration.spec.ts` (new; 15 tests → proofs 1–26)

## 11. Validation (real PostgreSQL — embedded 18.4 in-sandbox, full migration chain, no mocks)

- New suite: **15/15 pass** (proofs 1–26 incl. DRAFT-only, normalization, uniqueness, replay/lockout/cooldown/binding/cross-context, enumeration equality, rate-limit 429s, audit-without-secret-leak, zero-ledger).
- Existing customer login/app (`a23-customer-app`): **PASS** (proof 27).
- Existing customer PIN hardening (`a24-customer-transaction-pin-hardening`): **PASS** (proof 28).
- Existing workforce activation boundary (`s-fix-01-customer-lifecycle-authorization`): **PASS** (proof 29).
- Guard/contract unit suites (`runtime-access.guard`, `a2-workforce-authentication.contract`): **18/18 pass**.
- `tsc --noEmit`: clean. `npm run build`: clean. ESLint: clean on all touched files. Prettier: clean.

## 12. Remaining customer onboarding gaps (unchanged backlog)

1. Workforce review surface + activation preconditions enforcing the verified phone (SUB-1 wiring at activation).
2. Customer credential issuance (SUB-2): server-generated temp credential, secure delivery, forced first-login rotation; rotation modeling decision on the customer credential store.
3. §23-3 remainder: KYC level-gating of activation/transactions/limits (decision-deferred).
4. Starter-bundle/atomicity decision + wallet provisioning actor.
5. Transaction-readiness: report → enforcement decision.
6. DRAFT retention values (operational configuration decision; DRAFTs currently persist by design SUB-3).
7. Mobile-app rebuild of the deprecated registration screen against this contract (+ the rotation flow when it lands).
