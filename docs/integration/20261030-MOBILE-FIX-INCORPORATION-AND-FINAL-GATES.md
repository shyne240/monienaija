# Mobile fix incorporation and final integration gates

**Date:** 2026-10-30
**Branch:** `integration/main-backend-frontend-20261030`
**Approved security baseline (start):** `3b488caddc2f68c28a5f06d1571dfd4311656a64`
**Source mobile fix:** `arena/ea070127-monienaija` @ `171ac75e43ab54e0ef85645845cd5cbf0428657e`

Scope: incorporate the ratified customer-mobile fix, verify the combined tree end-to-end and document release dependencies. No financial business rule, authorization policy, migration, payment provider or unrelated functionality was changed. No merge to `main`, no deploy, no production migration, no Report 30 implementation.

---

## 1. Branch state confirmation

| Check | Result |
|---|---|
| Integration branch tip before this work (`git ls-remote`) | `3b488cad…` — **exactly the approved baseline; the branch had not advanced unexpectedly** |
| `main` | `39a9e504…` (unchanged) |
| Source mobile branch `arena/ea070127-monienaija` | `171ac75e…` (as instructed) |
| Session lineage branch `arena/8e59e188-monienaija` | `06dc30b…` (untouched) |

---

## 2. Incorporated commit

`171ac75e` was inspected before cherry-picking. All three target files on the integration branch were **byte-identical to the commit's parent**, so the pick applied with **zero conflicts**:

| File | Integration blob before | Source commit | After |
|---|---|---|---|
| `apps/customer-mobile/src/services/api-client.ts` | `25a039e` | → `de06e07` | `de06e07` |
| `apps/customer-mobile/src/store/auth-store.ts` | `69e6c14` | → `b8b44de` | `b8b44de` |
| `apps/customer-mobile/__tests__/api-client.test.ts` | `36739b2` | → `f564066` | `f564066` |

Cherry-picked as `e0203ee` (with `(cherry picked from …)` provenance). All three files verify **byte-identical** to the source commit on the integration branch.

**No backend, authorization, migration or financial file changed:** `git diff --stat 3b488ca..HEAD -- src/ migrations/` is empty.

### The three fixes, as incorporated

1. **API URL prefix normalization** — `resolveCustomerApiUrl()` accepts bare origins (`http://10.0.2.2:3000`, `https://api.example.com`) and pre-prefixed bases (`…/api/v1`), and never double-prefixes. `setBaseUrl` now strips trailing slashes generally (not just one slash). This matches the backend's `app.setGlobalPrefix('api/v1')`.
2. **Correct bearer-session handling on 401** — a 401 now purges the stored session **only** when an authenticated bearer token was actually rejected and the failure is not a step-up/login rejection (`isStepUpOrLogin401`: PIN messages, "current password is incorrect", "invalid credentials", or the session/logout endpoints). Session purge also clears `auth_customer_id` and `auth_session_data` and notifies listeners (`onCustomerSessionExpired`) so the auth store resets instead of holding a dead session.
3. **Bodyless logout compatibility** — `Content-Type: application/json` is now sent only when a body exists, so `POST /customers/sessions/logout` with no body is not rejected by Fastify's empty-JSON guard.

### Preserved behaviours (verified, not assumed)

* **Pending transfer intents preserved:** `purgeExpiredCustomerSession()` deliberately does not touch `pending_wallet_transfer_intent:<customerId>`; the mobile unit test asserts no such key is removed.
* **Customer ownership / OTP / financial protections:** untouched in source; re-proven by the full PostgreSQL matrix (including `a23-customer-app`, `a5-transfer-lifecycle`, `a24-customer-transaction-pin-hardening`) and by the focused real-HTTP checks in §5.
* **FundWallet / Withdraw remain unregistered:** `navigation/types.ts` keeps the two keys for compilation, but `AppNavigator.tsx` registers neither screen. No customer funding/withdrawal API was invented.

---

## 3. Test results

### Backend

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | **PASS** — 0 errors |
| `npm run build` (nest build) | **PASS** — `dist/main.js` produced |
| `npm test` (unit/component) | **PASS — 222/222 suites, 2,571/2,571 tests**, 0 skipped |

### PostgreSQL integration matrix — complete, not sampled

| Check | Result |
|---|---|
| `PG_TEST_CONCURRENCY=1 npm run test:pg` | **PASS — 9/9 batches, 126/126 suites, 2,376/2,376 tests, 0 failures, 0 skipped** |
| Migration suites | **PASS** — `migration-chain`, `v1-release-01-production-readiness-migration-sync`, `notification-migration-upgrade-01`, `agent-application-access-migration-upgrade` |
| Isolated databases | Yes — every suite ran in its own `mn_it_*_ref5a88c0f173_*` disposable database; run id `ref5a88c0f173` |

Per-batch test counts: 635, 290, 324, 293, 254, 178, 234, 154, 14.

### Frontends

| App | TypeScript | Tests | Production build |
|---|---|---|---|
| Admin Web (`apps/admin-web`) | **PASS** (0 errors) | **PASS — 33/33 suites, 243/243 tests** | **PASS** — `vite build` → `dist/index.html` + bundle (1,241.59 kB, gzip 335.16 kB) |
| Customer Mobile (`apps/customer-mobile`) | **PASS** (0 errors) | **PASS — 14/14 suites, 118/118 tests** (was 114; +4 from the incorporated fix) | **PASS (bundle)** — `expo export --platform android` → 802 modules, Hermes `.hbc` 2.16 MB |
| Agent Mobile (`apps/agent-mobile`) | **PASS** (0 errors) | **PASS — 20/20 suites, 297/297 tests** | **PASS (bundle)** — `expo export --platform android` → Hermes `.hbc` 2.34 MB |

**No failing and no skipped tests in anything executed.**

---

## 4. Focused real-HTTP gate checks (task 9)

New durable suite: `test/final-integration-gates-focus.integration.spec.ts` (real `AppModule`, real PostgreSQL, real Fastify HTTP). **PASS — 6/6.**

| # | Check | Assertion |
|---|---|---|
| 1 | **Login** | `POST /api/v1/customers/sessions` → 200 with a bearer token; `GET /customers/me` → 200 |
| 2 | **API prefix** | `/api/v1/customers/me` → 200; `/customers/me` → **404**; `/api/v1/api/v1/customers/me` → **404** (the double-prefix trap) |
| 3 | **Logout (bodyless)** | `POST /api/v1/customers/sessions/logout` with no body and no Content-Type → 200 `{revoked:true}`; the same call with `Content-Type: application/json` and an empty body → **400**, documenting exactly why the client must omit the header |
| 4 | **Session expiry** | After logout the same bearer token is rejected on `/customers/me` → **401** |
| 5 | **Wrong PIN** | Transfer with wrong PIN → **401 "Invalid PIN"**; session still valid (`/customers/me` → 200); **no transfer row, no ledger journal, balance unchanged** |
| 6 | **Transfer ownership** | Customer B debiting A's wallet → **404** with no transfer created; the legitimate owner then transfers successfully (A: 50,000 → 40,000; B: 0 → 10,000) |

The suite was added to the repository (not a throwaway) so reviewers can re-run the gates directly. It raises the integration suite count from 126 to **127** for future `test:pg` runs; the 126-suite matrix result in §3 was produced before the file existed, and this suite was then run on its own (6/6).

---

## 5. Outstanding release dependencies (task 10)

These are **not defects in this integration** — they are dependencies that must close before a production release, and none of them can be satisfied by code alone in this repository:

1. **Production OIDC workforce login.** `A2_WORKFORCE_ENABLED` defaults to `false`. Real workforce authentication requires a deployed identity provider plus `A2_WORKFORCE_OIDC_ISSUER`, `…_JWKS_URI`, `…_AUDIENCE`, `…_CLIENT_ID` and session TTL. The only working login in this tree is `LocalAdminAuthenticationService`, which hard-refuses outside `NODE_ENV=development|test`. The dev mock-sandbox bypass is retired and must stay retired.
2. **Temporary credential rotation UI for customers.** The backend issues temporary workforce-created credentials that must be rotated via `POST /customers/credentials/rotate`. Agent Mobile implements this (`RotateCredentialScreen`), but **Customer Mobile does not** — `auth-store.ts` surfaces `rotationRequired` with an explicit "not yet supported in this app version" message rather than fabricating a session. Admin Web can issue and reissue temporary credentials for both agents and customers.
3. **Physical-device UAT.** This environment can only prove type-checking, unit suites, and a Metro/Hermes bundle export; it has no emulator, no APK/IPA build (EAS builds need cloud credentials), no secure-store hardware, and no real network conditions. Device UAT must cover: login/logout on both apps, session expiry UX, wrong-PIN handling with lockout, transfer intents surviving re-authentication, and deep links.
4. **Mobile owner ratification** of the four merge resolutions plus this incorporated fix, and the OI-01 disposition for the unregistered FundWallet/Withdraw screens.
5. **Admin Web owner ratification** of the four reconstructed merge files; **Product Owner** ratification of the selected V1 contract (`/customers/me/*`, OTP registration, generic customer commands disabled).

### Other open items carried forward (documented previously, unchanged)

* Provider-audit oversight is limited to SUPER_ADMIN/FINANCE_AUDITOR under the approved strict `audit.view` gate (Report 34 decision C); a dedicated provider-audit route remains a proposed follow-up.
* Readiness GET is financially read-only but writes one operational duration metric; decoupling proposal still awaits approval.

### Environment limitation

Embedded PostgreSQL cannot start from a clean install in this sandbox (`initdb` fails on `libpq.so.5`). Workaround (untracked, inside `node_modules`): symlink the bundled sonames (`libpq.so.5.18` → `libpq.so.5`, plus the ICU/OpenSSL sonames) and set `LD_LIBRARY_PATH` to `node_modules/@embedded-postgres/linux-x64/native/lib`, then `node scripts/embedded-pg.js`. This must be re-applied after any dependency reinstall and should be fixed at the image level.

---

## 6. Readiness for final independent acceptance

**Ready to be submitted for final independent acceptance.** The approved security baseline is intact, the ratified mobile fix is incorporated byte-identically with zero conflicts, the complete backend unit suite, the complete 126-suite PostgreSQL matrix (including migration chains), all three frontends' type-checks and suites, and all local production builds pass with zero failures and zero skips, and the six focused release gates pass over real HTTP.

Acceptance should still record the §5 dependencies as release conditions: production OIDC login, the customer credential-rotation UI, and physical-device UAT cannot be evidenced from this environment. This document authorizes no merge to `main`, no deployment, no production migration, no provider activation and no Report 30 implementation.
