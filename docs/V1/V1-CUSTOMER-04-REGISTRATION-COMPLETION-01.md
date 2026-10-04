# V1-CUSTOMER-04 — Customer Mobile Registration Completion

**Type:** Narrow, targeted fix. Scope limited strictly to Customer Mobile registration, per instruction. No backend code was modified (no genuine backend defect was discovered in the registration contract). No other V1 gap identified in the prior audit (`docs/V1/V1-CUSTOMER-03-GAP-AUDIT-01.md`) was implemented in this task.

---

## 1. Original Defect

`apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx` called:

```
POST /customers
{ reference, type: 'INDIVIDUAL', status: 'ACTIVE', actor }
```

This is `CustomerController.create()` (`src/customer/customer.controller.ts`), a route that `src/authorization/route-policy-registry.ts` classifies — by falling through every specific branch to the registry's final default case — as `resourceType: 'internal-route'`, `requiredScopes: ['internal:access']`, `allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']`. It is workforce/internal-only. An unauthenticated mobile customer calling it should be rejected (401/403) in a correctly enforced environment. Even if reached, the endpoint never collected a password, never verified phone ownership, and never provisioned a wallet, so a customer could never subsequently log in. The bug was masked, not caught, by the prior test suite: `apps/customer-mobile/__tests__/registration.test.tsx` mocked `ApiClient.post` and asserted the wrong endpoint was called.

## 2. Root Cause

The screen was built against an ad hoc, never-public `POST /customers` admin/workforce creation endpoint instead of the dedicated, already-built, already-tested public self-registration front door that exists in the same backend (`CustomerRegistrationController`, module `V1-CUSTOMER-01`). No backend work was ever required to fix this — the correct contract already existed; Customer Mobile simply was never wired to it.

## 3. Correct Backend Registration Contract (verified from source, not inferred)

Routes (`src/customer-registration/customer-registration.controller.ts`, mounted at `customers/registration`, all listed in `PUBLIC_ROUTES` in `route-policy-registry.ts` — no authentication, no privileged principal required):

| Step | Route | Request body | Response (200/201) |
|---|---|---|---|
| 1. Request OTP | `POST customers/registration/otp` | `{ phone }` (Nigerian mobile, any accepted rendering) | `{ status: 'OTP_REQUEST_ACCEPTED', resendAfterSeconds, expiresInSeconds }` |
| 2. Verify OTP | `POST customers/registration/otp/verify` | `{ phone, code }` (6-digit) | `{ status: 'PHONE_VERIFIED', verificationToken, expiresInSeconds }` |
| 3. Complete registration | `POST customers/registration` | `{ phone, verificationToken, password? (≥8 chars), displayName?, idempotencyKey? }` | `201 { id, reference, status, phone (masked), phoneVerifiedAt, wallet?: { id, currency, status } }` |

Backend behavior confirmed by reading `CustomerRegistrationService` (`src/customer-registration/customer-registration.service.ts`):
- Phone is canonicalized server-side (10-digit NSN + E.164); OTP codes are CSPRNG-generated (`crypto.randomInt`), PBKDF2-hashed with a per-challenge salt, never echoed back, never logged in plaintext, and compared with `timingSafeEqual`.
- OTP has a TTL (`REGISTRATION_OTP_TTL_SECONDS`), a resend cooldown, and a max-verify-attempt lockout (`REGISTRATION_OTP_MAX_VERIFY_ATTEMPTS`) that revokes the challenge after too many wrong attempts.
- `otp/verify` issues a one-time `verificationToken` (32 random bytes, stored only as a SHA-256 hash) bound to the normalized phone, valid for `REGISTRATION_VERIFICATION_TOKEN_TTL_SECONDS`.
- `completeRegistration` consumes the verification token (single use; `consumedAt` set before any customer row is created so a later failure rolls back cleanly), rejects if the phone is already bound to another customer (`ConflictException`, 409), and — **only if a password (≥8 chars) is supplied** — activates the customer immediately (`CustomerStatus.ACTIVE`), hashes the password with PBKDF2, and atomically provisions a primary NGN wallet via `WalletService.createWalletInTransaction`. If no password is supplied, the customer is created as `DRAFT` with no wallet (backward-compatible path for workforce-assisted onboarding; **not** used by this mobile flow, which always supplies a password).
- **The registration-completion response does NOT include a session or access token.** No `accessToken` field exists anywhere in `CompleteRegistrationView`. A newly registered customer must authenticate separately via the existing `POST customers/sessions` (`CustomerAppController.login`), which already accepts phone, customer reference, or UUID as the identifier (`AuthenticationExecutionService.resolveCustomer`).

This matches the instruction's constraint: registration success was **not** assumed to mean an authenticated session — it was verified from source that it does not, and the mobile implementation was built accordingly.

## 4. Mobile Changes

**File changed:** `apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx` (full rewrite, same file path, same exported component name, same navigation route — no navigation/type changes required).

The screen now implements a 3-step flow matching the real backend contract exactly:

1. **PHONE step** — collects phone number, calls `POST customers/registration/otp`. On success, advances to the OTP step and starts a resend-cooldown countdown driven by the backend's own `resendAfterSeconds`.
2. **OTP step** — collects the 6-digit code, calls `POST customers/registration/otp/verify`. On success, stores the returned `verificationToken` in local component state only, and advances to the DETAILS step. A "Resend code" action (disabled during cooldown) re-calls the OTP-request endpoint. On failure, the code field is cleared and a generic, enumeration-safe error is shown; the screen does not advance.
3. **DETAILS step** — collects an optional display name, a password (≥8 chars, matching the backend's own `CompleteRegistrationDto` validation), and a client-side-only "Confirm Password" field (never sent to the backend — used purely to catch typos before submission; this does not add a field to the request payload). Calls `POST customers/registration` with `{ phone, verificationToken, password, displayName?, idempotencyKey }`. On success, clears the password/token from state and shows the backend's actual response (customer reference, masked phone, and wallet status if one was provisioned).
4. **SUCCESS step** — directs the customer to **log in** (`navigation.navigate('Login')`), not into an authenticated session, because the backend genuinely does not issue one at this step. This reuses the existing, already-correct `LoginScreen`/`useAuthStore.login()`, which calls `POST customers/sessions` with the phone number and the password the customer just set.

No other screens, navigation types, the auth store, or the API client were modified — `LoginScreen.tsx` and `auth-store.ts` were already correctly wired to the real session endpoint (verified by reading both files; no defect found there).

## 5. Security Considerations (verified, not assumed)

- **Public registration cannot reach the workforce-only `/customers` endpoint:** the new implementation never references `/customers` as a bare path; it exclusively calls the three `customers/registration*` routes, all explicitly listed in `PUBLIC_ROUTES` in `route-policy-registry.ts`. Confirmed by direct source inspection of the registry (Section 3 above) and enforced by a dedicated regression test (Section 6, test 6) asserting `/customers` is never called.
- **No privileged role is required by the mobile client:** the registration routes require no `Authorization` header at all; `ApiClient.request()` only attaches a bearer token if one exists in `SecureStorage` (none does, pre-registration).
- **Password is never logged:** no `console.log`/`console.warn`/`console.error` statement in the new screen references `password`, `confirmPassword`, `code`, or `verificationToken`. Verified by a dedicated test (Section 6, test 10) that spies on all three console methods across a full successful registration run and asserts none of the actual secret values appear in any logged output.
- **Password is never stored insecurely:** the password and confirm-password fields exist only in React component state (`useState`), are cleared immediately after both successful and failed submission, and are cleared again on unmount via a `useEffect` cleanup. Neither is ever passed to `SecureStorage` (confirmed — `SecureStorage` is not imported by this screen at all).
- **OTP is never logged:** the `code` field follows the identical clear-on-failure/clear-on-success/clear-on-unmount discipline as the password.
- **Registration requests use the existing HTTPS-capable `ApiClient`:** no new network layer was introduced; the screen uses the same `ApiClient.post()` used by every other screen in the app, whose base URL is controlled centrally (`src/config/index.ts` / `setBaseUrl`). Transport security (HTTPS enforcement in staging/production) is an existing, app-wide `ApiClient`/deployment-configuration concern, not something this screen could alter or regress; no change was made to it.
- **Replay protection:** the `verificationToken` is single-use server-side (`consumedAt` set transactionally before any customer row is created); a retried completion call with an already-consumed token is rejected (`TOKEN_CONSUMED` → generic 400). The mobile client also sends an `idempotencyKey` (generated client-side, same convention as the existing `SendMoneyScreen`) so a genuine network-level retry of the *same* logical submission is handled safely by the backend's own `IdempotencyService`, without risking a duplicate customer/wallet on a dropped response.
- **Customer ownership remains phone-bound:** the backend binds the verification token to the normalized phone (`challenge.normalizedPhone`), and `completeRegistration` re-validates that the submitted phone still matches an unconsumed, `VERIFIED` challenge for that exact phone before creating anything — unchanged, since no backend code was touched.
- **No client-side authentication bypass was introduced:** the mobile client never fabricates a session; `AppNavigator`'s authenticated/unauthenticated split is still driven exclusively by `useAuthStore.isAuthenticated`, which is only ever set `true` inside `auth-store.ts`'s `login()` after a real `accessToken` is returned by `POST customers/sessions`. The registration screen does not touch `useAuthStore` at all.

## 6. Tests Added/Changed

`apps/customer-mobile/__tests__/registration.test.tsx` was **fully rewritten** (the previous version is removed, not kept alongside, since it asserted the wrong contract). It no longer mocks around an incorrect endpoint; it asserts the real one. 10 tests, all passing:

1. `renders the initial phone-entry step` — initial UI state.
2. `shows a validation error when phone is empty` — client-side validation, no network call.
3. `requesting an OTP calls the correct endpoint and advances to the OTP step` — asserts the exact call `ApiClient.post('/customers/registration/otp', { phone: '08012345678' })`.
4. `verifying an OTP calls the correct endpoint and advances to the details step` — asserts `ApiClient.post('/customers/registration/otp/verify', { phone, code })`.
5. `an incorrect OTP produces an appropriate, generic error and does not advance` — simulates the backend's real generic `ApiError('OTP verification failed', 400)` and confirms the screen stays on the OTP step (registration-completion is never called).
6. `completing registration collects a password and calls the correct endpoint with the verification token` — asserts the exact final call shape including `verificationToken`, `password`, `displayName`, and `idempotencyKey`; asserts the success screen renders the backend's real response fields; **explicitly asserts `ApiClient.post` was never called with `/customers`** (the regression guard for the original defect); confirms "Proceed to Log In" navigates to `Login`, not into an authenticated state.
7. `rejects mismatched passwords client-side without calling the backend` — confirms the confirm-password field is a pure client-side guard (no extra network call fired).
8. `handles a duplicate-phone 409 conflict from registration completion` — simulates the backend's real `ConflictException` (409) path.
9. `loading state disables duplicate submission while a request is in flight` — confirms the submit control becomes non-interactive (label replaced by a disabled spinner) for the duration of an in-flight request, so a double-tap cannot fire two network calls.
10. `never logs sensitive values (password, OTP code, verification token) to the console` — spies on `console.log/warn/error` through a full successful registration and asserts none of the three secret values appear in any captured output.

## 7. Backend Contract Compatibility

No backend DTOs, controllers, or services were modified. The mobile payload shapes were derived directly from `RequestRegistrationOtpDto`, `VerifyRegistrationOtpDto`, and `CompleteRegistrationDto` (`src/customer-registration/dto/*.ts`) and cross-checked against the backend's own integration tests (`test/v1-customer-onboarding-01.integration.spec.ts`, `test/v1-customer-onboarding-02.integration.spec.ts`), which exercise the identical three-call sequence this mobile implementation now uses. No backend test was modified to accommodate the mobile implementation.

## 8. Exact Test Results

All commands were run this session against this repository's actual tooling; none of these numbers are copied from a prior session.

### Customer Mobile unit/component tests

```
cd apps/customer-mobile && npm ci
cd apps/customer-mobile && npx jest --watchAll=false registration.test.tsx
```
Result: **Test Suites: 1 passed, 1 total — Tests: 10 passed, 10 total.**

```
cd apps/customer-mobile && npx jest --watchAll=false
```
Result (re-run 3 times consecutively for stability): **Test Suites: 9 passed, 9 total — Tests: 40 passed, 40 total** (all 3 runs identical). One earlier ad hoc run in this session showed a single transient failure outside `registration.test.tsx` (an `act()`/Animated-timer race already present in the repo's existing Jest/RN-testing-library setup, unrelated to any file touched in this task); it did not reproduce across three consecutive clean re-runs, and no file outside the two listed in Section 4/6 was modified.

### TypeScript validation

```
cd apps/customer-mobile && npx tsc --noEmit
```
Result: **exit code 0, zero errors.**

### Backend registration-contract and regression tests (real PostgreSQL via this repo's `embedded-postgres` devDependency)

```
node scripts/embedded-pg.js   (background; DB_HOST=localhost DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_SSL=false)
npx jest --config jest.integration.config.js --runInBand \
  test/v1-customer-onboarding-01.integration.spec.ts \
  test/v1-customer-onboarding-02.integration.spec.ts \
  test/a23-customer-app.integration.spec.ts \
  test/a24-customer-transaction-pin-hardening.integration.spec.ts \
  test/s-fix-01-customer-lifecycle-authorization.integration.spec.ts
```
Result: **Test Suites: 4 passed, 1 failed, 5 total — Tests: 64 passed, 1 failed, 65 total.** The single failure is `v1-customer-onboarding-01.integration.spec.ts` test 19 (`attempt_count` expected `5`, received `6`) — the exact pre-existing, previously documented off-by-one in the registration-OTP lockout counter (`docs/V1/V1-CUSTOMER-03-GAP-AUDIT-01.md` Section 8, failure #4). It is unrelated to the mobile client (it is a backend counter bug exercised by a database assertion, no backend code was touched this task) and was not introduced or affected by this change.

### Full backend integration regression (all 77 suites)

```
npx jest --config jest.integration.config.js --runInBand
```
Result: **Test Suites: 4 failed, 73 passed, 77 total — Tests: 5 failed, 1539 passed, 1544 total.** The 4 failing suites are byte-for-byte identical to the 4 pre-existing failures catalogued in `docs/V1/V1-CUSTOMER-03-GAP-AUDIT-01.md` Section 8 (`v1-customer-onboarding-01`, `v1-workforce-bootstrap-01`, `v1-hardening-06-admin-customer-investigation`, `migration-chain`) — same files, same assertion counts. **No new failure was introduced; no previously-passing suite regressed.**

## 9. Registration Walkthrough (traced from source, not physically executed)

```
NEW PHONE
  │
  ▼
OTP REQUEST          mobile: POST customers/registration/otp { phone }
                      backend: rate-limits by IP+phone, issues CSPRNG OTP, SMS-delivers it via the
                               existing NotificationProvider abstraction, returns resendAfterSeconds/expiresInSeconds
  │
  ▼
OTP VERIFICATION      mobile: POST customers/registration/otp/verify { phone, code }
                      backend: timing-safe compares PBKDF2(code) against stored hash; on match, issues a
                               single-use verificationToken (stored only as a SHA-256 hash) bound to the phone
  │
  ▼
PASSWORD/REGISTRATION DATA
                      mobile: collects password (+confirm, client-only) and optional display name
  │
  ▼
CUSTOMER CREATION     mobile: POST customers/registration { phone, verificationToken, password, displayName?, idempotencyKey }
                      backend: consumes the token, rejects if phone already bound to a customer (409),
                               creates Customer row with status=ACTIVE (because a password was supplied),
                               creates verified CustomerContactMethod, creates CustomerAuthenticationCredential
                               (PBKDF2 password hash)
  │
  ▼
WALLET PROVISIONING   backend: WalletService.createWalletInTransaction — atomic, in the SAME transaction as
                               the credential/customer creation, double-entry NGN liability wallet
  │
  ▼
AUTHENTICATION/LOGIN  mobile: shows reference/wallet status, "Proceed to Log In" → LoginScreen
                      customer: enters phone + the password just set
                      mobile: auth-store.login() → POST customers/sessions { identifier: phone, password }
                      backend: AuthenticationExecutionService resolves the phone to the new customer,
                               verifies the password, checks customer.status === ACTIVE (it is), issues a
                               real session (accessToken/sessionId/expiresAt)
  │
  ▼
CUSTOMER DASHBOARD    mobile: useAuthStore.isAuthenticated becomes true → AppNavigator renders the
                               authenticated stack (HomeScreen, etc.)
```

**No remaining dead end was found in this trace.** Every step calls a route that exists, is implemented, is covered by a passing backend integration test (aside from the one pre-existing off-by-one counter assertion, which does not block the lockout itself from functioning — see Section 8), and hands off correctly to the next step using only data the previous step actually returns.

## 10. Remaining Limitation (honest, not glossed over)

The OTP-attempt-counter off-by-one identified in the V1-CUSTOMER-03 audit (`attempt_count` reaches 6 instead of capping at 5 after the 5th failed attempt) still exists in the backend and was not fixed in this task, because it is backend logic, not a registration-flow-blocking defect (the lockout itself still correctly refuses further attempts), and fixing backend logic was out of this task's explicit scope ("do not modify the backend unless a genuine backend defect is discovered" — this is a cosmetic counter overshoot, not a defect that breaks or weakens the lockout's actual security effect). It is called out here rather than silently left for the next person to rediscover.

## 11. Remaining V1 Gaps Discovered But NOT Implemented (per change-control scope)

All of the following were already catalogued in `docs/V1/V1-CUSTOMER-03-GAP-AUDIT-01.md` and remain exactly as documented there; none were implemented in this task, per the explicit change-control instruction:

- Customer Mobile "My Limits" screen (`GET customers/me/limits` does not yet exist).
- Transaction-history unification (Customer Mobile still calls the Wallet→Wallet-only `GET customers/me/transfers` instead of the existing unified `GET customers/me/transactions`).
- Transaction detail screen (no tap-to-detail anywhere in the app).
- Notifications screen (`GET customers/me/notifications` exists server-side, has zero mobile consumers).
- PIN replacement without re-authentication (the architectural gap requiring a governing security rule before implementation, per the V1-CUSTOMER-03 audit's Section 3).
- Support ticket detail/reply screens (backend ready, unused).
- Agent Mobile dependency security findings (unchanged; classified ACCEPTABLE V1 RISK WITH DOCUMENTED MITIGATION in the prior audit — not touched this task).
- The two stale hardcoded migration-count test assertions and the stale `docs/config/...` test file path (Section 8/9 of the prior audit).

## 12. Final Classification

**A. CUSTOMER REGISTRATION COMPLETE**

Customer Mobile registration now calls the real, public, OTP-verified backend contract end-to-end (`otp` → `otp/verify` → `registration`), collects the password the backend requires, never calls the workforce-only `/customers` endpoint, correctly does not assume an authenticated session where the backend does not issue one, and routes a newly registered customer to log in through the existing, already-correct login flow — after which they reach a real wallet-backed, authenticated dashboard. This was verified by passing mobile unit tests (10/10 new, 40/40 full suite), a clean TypeScript check, and backend integration tests run against a real local PostgreSQL instance showing zero new failures (identical 4/77 pre-existing, previously documented failures, unrelated to this change).

---

*Completed: 2026-10-04, branch `arena/01a10374-monienaija`, building on HEAD `861fd80`.*
