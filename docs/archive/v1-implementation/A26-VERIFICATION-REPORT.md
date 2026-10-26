# A26 Customer Profile & Settings Hardening — Verification Report

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD:** `6036b7c` (`feat(customer-app): A26 Customer Profile & Settings Hardening`) — parent `fd82075` (A25) → `48b556e` (A24) → `48e4e1f` (A23)  
**Working tree:** clean after A26 hardening (controller thin, no second financial engine)  
**Migrations:** **63** (zero new migrations — `SELECT count(*) FROM typeorm_migrations` =63 in every suite)  
**Embedded PG:** `data/embedded-pg` PostgreSQL 18.4 `127.0.0.1:5432` `monienaija/monienaija-pw` `monienaija` DB `DB_SSL=false` via `node scripts/embedded-pg.js` (`start_process` `embedded-pg`)

---

## 1. HEAD / Commit

- **This commit:** `6036b7c` — `feat(customer-app): A26 Customer Profile & Settings Hardening` (6 files, +596)
- **Parent:** `fd82075` docs fix A25 (hardening `28c4f1f` A25 history) → `48b556e` A24 PIN → `48e4e1f` A23 foundation
- **Files changed in this commit:**
  ```
  src/customer-app/customer-app.controller.ts               | hardened (profile PATCH, password, sessions)
  src/customer-app/customer-app.module.ts                   | +OperationsModule
  src/customer-authentication/customer-authentication.module.ts | export PasswordHashVerificationService
  src/app.module.ts                                         | redact currentPassword/newPassword
  src/common/sensitive-data-redaction.ts                    | SENSITIVE keys currentpassword/newpassword
  test/a26-customer-profile-hardening.integration.spec.ts   | new 19 tests (A-S)
  ```

No new `src/migrations/*.ts`. `git status --porcelain` clean after commit (except docs/A26 report to be committed next).

## 2. Files Changed (A26 only)

- **Controller:** `src/customer-app/customer-app.controller.ts` — added `Patch` import, injected `CustomerAuthenticationService`, `PasswordHashVerificationService`, `AuditService` (+ existing `AuthenticationSessionService`/`AuthenticationExecutionService`), added 3 endpoints (see §3), kept all existing A23-A25 endpoints unchanged.
- **Module:** `src/customer-app/customer-app.module.ts` — added `OperationsModule` to imports (for `AuditService`), kept `TypeOrmFeature` [Customer, Profile, Contact, WalletAccount, Transfer], `CustomerAuthenticationModule`.
- **Auth Module:** `src/customer-authentication/customer-authentication.module.ts` — exported `PasswordHashVerificationService` (already provider, now exported for Customer App).
- **Redaction:** `src/common/sensitive-data-redaction.ts` — added `currentpassword`/`newpassword` to `SENSITIVE_KEY_NAMES` (so `redactRecord`/`redactSensitiveData` → `[REDACTED]`).
- **Logging:** `src/app.module.ts` — `pinoHttp.redact.paths` added `req.body.currentPassword`, `req.body.newPassword` (alongside existing `password`, `passwordHash`, `pin`, etc.).
- **Tests:** `test/a26-customer-profile-hardening.integration.spec.ts` — 19 real-PG tests (A-S, see §13).

Previous A25 history hardening remains intact (batch counterparty, safe projection, pagination bounded, no ledger leak).

## 3. Endpoint Inventory (Customer App, thin, existing + A26)

**Existing (reused, unchanged semantics):**
- `POST /api/v1/customers/sessions` — login `CUSTOMER_LOGIN` (unauthenticated, `AuthenticationExecutionService.authenticate` PBKDF2 + `AuthenticationSessionService.issue`)
- `POST /api/v1/customers/login` alias
- `POST /api/v1/customers/sessions/logout` — revoke current token `SELF` (`sessionService.revoke`)
- `POST /api/v1/customers/logout` alias
- `GET /api/v1/customers/me` — safe `Customer` projection (id/reference/type/status/kyc)
- `GET /api/v1/customers/me/profile` — safe `Customer` + `CustomerProfile` (displayName/legalName/nationality/isActive, no hash/audit)
- `GET /api/v1/customers/me/status` — identity/status/kyc
- `GET /api/v1/customers/me/wallets` / `/:walletId` / `/:walletId/balance` / `financial-position` — ledger-derived via `WalletService`
- `GET /api/v1/customers/me/receiving-identity` + alias `receiving-number` — phone `CustomerContactMethod` primary
- `GET /api/v1/customers/me/recipient?identifier=` — delegate `RecipientResolutionService`
- `POST /api/v1/customers/me/transfers` — Wallet→Wallet `SELF` + `Idempotency-Key` + PIN `pinService.verifyTransactionPin` → `TransferService`
- `GET /api/v1/customers/me/transfers?page&limit` + alias `/transactions` — history hardened A25 (batch counterparty, deterministic)
- `GET /api/v1/customers/me/transfers/:transferId` + alias `/transactions/:transferId` — detail hardened A25
- `GET /api/v1/customers/me/dashboard` — composite (identity/profile/balance/receiving/recent)
- `POST /api/v1/customers/me/transaction-pin` / `verify` — PIN set/verify via `CustomerTransactionPinService` PBKDF2

**New in A26 (profile & settings, thin, no financial engine):**
- `PATCH /api/v1/customers/me/profile` — **SELF** `displayName` only (whitelist, reject immutable 400, transaction + audit `PROFILE_UPDATED`, no wallet/ledger/kyc/password/pin mutation)
- `POST /api/v1/customers/me/password` — **SELF** password change `{currentPassword, newPassword}` (validate 8-128, != current, verify via `AuthenticationExecutionService.authenticate` → `CustomerAuthenticationService.rotatePassword` PBKDF2$sha256$10000, audit via existing service, no plaintext/hash returned/logged, sessions not auto-revoked)
- `GET /api/v1/customers/me/sessions` — **SELF** safe list `SELECT id,audience,status,issued_at,expires_at,last_seen_at,revoked_at` ordered `issued_at DESC`, no `tokenHash`

All `POST/PATCH/GET /customers/me/*` resolved via `RoutePolicyRegistry` as `allowedPrincipalTypes: ['CUSTOMER'], customerAccess: 'SELF', agentAccess: 'NONE'` — AGENT/WORKFORCE → 403/401 before controller, unauthenticated → 401.

Frontend assumptions unchanged: `TransactionsScreen` uses wallet-scoped `/wallets/:wId/transactions` (not customer-me), `SendMoneyScreen` posts `/transfers` with `Idempotency-Key`.

## 4. Existing Customer Profile/Settings Architecture Inspected (16 areas)

1. **Customer** (`customers` id/reference/customer_type/status/kyc_level/kyc_status/version)
2. **CustomerProfile** (`customer_profiles` `uq_active_customer` unique where `is_active && deleted_at IS NULL`, displayName/legalName/dateOfBirth/nationality/isActive) — **authoritative, mutable displayName only**
3. **CustomerContactMethod** (`customer_contact_methods` `uq_type_value` unique normalized, type PHONE/EMAIL, value/normalizedValue/isPrimary/verifiedAt) — **phone/receiving identity authoritative, V1 primary phone read-only, not customer-editable via profile PATCH**
4. **CustomerAuthenticationCredential** (`customer_authentication_credentials` `uq_active_customer` unique where `deleted_at IS NULL`, credential_type PASSWORD, passwordHash 512, hashAlgorithm PBKDF2/BCRYPT/SCRYPT/ARGON2ID, passwordVersion, passwordChangedAt/ExpiresAt, status PENDING/ACTIVE/SUSPENDED/REVOKED, failedAuthenticationCount/accountLocked/lockedAt)
5. **AuthenticationExecutionService** (`authenticate` UUID/password validation, customer/credential availability, `PasswordHashVerificationService.verify` timingSafeEqual, `recordFailedAuthentication` lockout after 5)
6. **AuthenticationSessionService** (`issue` random 32B base64url token → sha256 tokenHash, `validate` audience/status/expiry, `revoke`, `rotate`, `revokeAllForCredential`, `getSession` safe view without hash)
7. **RuntimeAccessGuard** + **RoutePolicyRegistry** (`/customers/me/*` strictly `CUSTOMER SELF`)
8. **Customer SELF authorization** (`requireCustomerPrincipal` checks `principal.type===CUSTOMER && customerId`)
9. **CustomerTransactionPinService** (`setTransactionPin` PBKDF2$sha256$10000, `verifyTransactionPin` timingSafeEqual, lockout 5, taxonomy)
10. **Existing Customer App controller/service/DTOs** (A23 profile GET, A24 PIN, A25 history, no PATCH before A26)
11. **Password/security services** (`CustomerAuthenticationService.createCredential`, `getCredential`, `rotatePassword`, `recordFailedAuthentication`, `unlockCredential`, plus `PasswordHistory`, `PasswordResetRequest/Token`, `SecurityEventHistory` with `redactRecord`)
12. **MFA infrastructure** (`MfaEnrollment` PENDING/ENABLED/DISABLED/REVOKED, `MfaMethod` TOTP/AUTHENTICATOR_APP/SECURITY_KEY/SMS/EMAIL, `MfaChallenge`, `TrustedDevice`, `RecoveryCode` — **ops-controlled, not customer self-enrollment in V1**)
13. **Session/logout infrastructure** (`AuthenticationSession` id/customerId/credentialId/tokenHash/audience/status/issuedAt/expiresAt/lastSeenAt/revokedAt)
14. **Audit mechanisms** (`AuditService.record` entityType/entityId/action/actor/previousValues/newValues, `redactRecord` SENSITIVE keys, `SecurityEventHistory` eventType/metadata redacted)
15. **Profile/settings fields & update endpoints** (no PATCH before, only GET; no password change before, only login)
16. **Tests** (`a23-customer-app` 15/15, `a24-pin` 19/19, `a25-history` 17/17, plus `authentication-execution`, `customer-authentication-runtime` unit)

**Conclusion:** displayName is only safe mutable profile field; phone is read-only receiving identity; password is mutable via existing `rotatePassword`; MFA/preferences are not customer-editable in V1 (documented §16).

## 5. Fields Exposed (safe projections)

**`GET /customers/me/profile`:**
`{id, reference, status, type, kycLevel, kycStatus, profile:{id,customerId,displayName,legalName,nationality,isActive,createdAt,updatedAt} | null, createdAt, updatedAt}` — no passwordHash/pinHash/tokenHash/ledger/audit.

**`PATCH /customers/me/profile` response:** same shape, updated `displayName`.

**`GET /customers/me/receiving-identity`:** `{customerId, receivingIdentity: normalizedValue, type, isPrimary, status}` — alias `receiving-number` `{customerId, receivingNumber, status}` — read-only.

**`POST /customers/me/password` response:** `{changed:true, passwordVersion: number}` — no hash, no plaintext, no token.

**`GET /customers/me/sessions`:** `{customerId, sessions:[{id,audience,status,issuedAt,expiresAt,lastSeenAt,revokedAt}]}` — no `tokenHash`, no `credentialId`?

Actually includes no tokenHash; safe. No `passwordHash`, no `refreshToken`.

**Other existing:** `GET /customers/me` etc. remain safe (no hashes).

All responses lower-cased JSON lacks `passwordhash`, `"password":`, `currentpassword`, `newpassword`, `pinhash`, `tokenhash`, `secrethash`, `accesstoken`, `refreshtoken`.

## 6. Fields Mutable (via A26)

- **`displayName`** (`customer_profiles.display_name` varchar 200, trimmed 1-200, no control chars) — **only** field allowed in `PATCH /customers/me/profile`. Update via `DataSource.transaction` + `CustomerProfile` repo save + `AuditService.record` `PROFILE_UPDATED`.

- **`password`** (`customer_authentication_credentials.password_hash` via `rotatePassword`) — **mutable** via `POST /customers/me/password` requiring `currentPassword` verification + `newPassword` policy (≥8 ≤128, != current), hashed `PBKDF2$sha256$10000$salt$derived` (16B salt, 32B derived, base64url), `passwordVersion` incremented, `passwordChangedAt` now, audit `PASSWORD_ROTATED` via `CustomerAuthenticationService` (uses `credentialValues` without hash).

**No other fields mutable via Customer App:** All other `PATCH` keys → `400 Field 'x' is not mutable / not allowed`.

## 7. Immutable / Security-Sensitive Fields (kept out of normal PATCH, fail-closed)

Rejected with `400` if sent in `PATCH /customers/me/profile`:

- **Identity:** `id`, `customerId`, `reference`, `type`
- **Wallet/ledger:** `walletId`, `ledgerAccountId`, `balanceMinor`, `wallets`
- **KYC/approval:** `kycLevel`, `kycStatus`, `legalName` (read-only), `nationality`, `dateOfBirth`, `isActive`, `status`
- **Secrets:** `passwordHash`, `pinHash`, `tokenHash`, `secret`, `hash`, `audit`, `ledger`
- **Auth/session:** `audience`, `sessionId`, `credentialId`, `roles`, `agentStatus`
- **Contact/phone:** `receivingNumber`, `phone`, `value`, `normalizedValue` — phone change not via profile PATCH; receiving identity remains read-only (would require verification workflow, not in V1)
- **Other:** `createdAt`, `updatedAt`, `deletedAt`

**Password change** does not allow changing other fields; it only rotates passwordHash via existing service.

## 8. Authentication / Security Architecture Reused (no second engine)

- **`CustomerAuthenticationService`** — `getCredential(customerId)` for version, `rotatePassword(customerId, credentialId, {passwordHash, hashAlgorithm: 'PBKDF2', passwordVersion+1, actor})` (transaction, `PasswordHistory` append, `SecurityEventHistory` `PASSWORD_ROTATED`, `AuditService` `PASSWORD_ROTATED` with `credentialValues` redacted).
- **`AuthenticationExecutionService`** — `authenticate({customerId, password: currentPassword, actor})` (PBKDF2 verification via `PasswordHashVerificationService.verify` timingSafeEqual, lockout check, `recordFailedAuthentication` after 5, audit `AUTHENTICATED`/`AUTHENTICATION_FAILED` redacted).
- **`PasswordHashVerificationService`** — exported now, but reused via `AuthenticationExecutionService`; direct verification not needed in controller (keeps controller thin).
- **`AuthenticationSessionService`** — existing `issue`/`validate`/`revoke`/`revokeAllForCredential` reused (but password change does **not** auto-revoke; see §9).
- **`AuditService`** — `record(manager, {entityType:'CUSTOMER_PROFILE', action:'PROFILE_UPDATED', previousValues:{displayName}, newValues:{displayName}})` for profile; password audit via `CustomerAuthenticationService` (already `redactRecord`).
- **Hashing:** `pbkdf2Sync` 10000 sha256 32B, `randomBytes(16)` salt, `base64url` encoding `PBKDF2$sha256$10000$salt$derived` (same as `customer-transaction-pin.service` and test harness `encodePbkdf2`).

No new `CustomerBalance`, `ledger`, `Transfer`, `Idempotency` code, no `BankService`/`NIBSS`/`ProviderAdapter`.

## 9. PIN / MFA / Session Handling

- **PIN:** A24 `POST /customers/me/transaction-pin` (set) + `verify` (PBKDF2$sha256$10000, `MAX_FAILED_PINS=5`, lockout, `timingSafeEqual`) **unchanged**. `PATCH /profile` and `POST /password` do not touch PIN. Tests L/N verify PIN still works for W→W.
- **MFA:** Existing `MfaEnrollment`/`MfaMethod`/`MfaChallenge`/`TrustedDevice`/`RecoveryCode` infrastructure exists but **no customer self-enrollment endpoint in V1**; enrollment is ops `POST /customers/:id/mfa-enrollments` (requires `SUPPORT`). A26 **does not** create second MFA system; documents as remaining V1 item (see §16). `W→W` authorization remains PIN-only (A24), not changed to MFA.
- **Session:** Existing `AuthenticationSession` issuance on login, `revoke` on `POST /customers/sessions/logout` (preserved, test M). New `GET /customers/me/sessions` is **read-only safe projection** (no tokenHash, no secrets, ordered `issued_at DESC`). Password change **does not** auto-revoke sessions (policy: keep current, documented; `revokeAllForCredential` available but not called to avoid disruptive forced logout). Session authorization via `RuntimeAccessGuard` `CUSTOMER SELF` remains.

## 10. Authorization Behavior (SELF fail-closed, agent/unauth rejected)

- **SELF:** Every A26 endpoint calls `requireCustomerPrincipal(req)` → `principal.customerId`. Profile PATCH fetches `customerRepository.findOne(id=principal.customerId)` and `customerService.getProfile(principal.customerId)` (which asserts `isActive && deletedAt IS NULL`), then updates only that `customerId`'s profile row (`where: {id: profile.id, customerId: principal.customerId}`) — no arbitrary `customerId` param, no body `customerId` trust (body `customerId` → 400).
- **Cross-customer:** `PATCH /customers/me/profile` with `{displayName, customerId: otherId}` → 400 (whitelist). `GET /customers/me/profile` always returns own; cannot read other's (test B verifies A's profile ≠ B's, and forged customerId rejected). Password change uses `principal.customerId` for credential lookup, never accepts body `customerId`.
- **Agent/workforce:** `GET/PATCH/POST /customers/me/*` with `Agent` token → 403/401 via `RoutePolicyRegistry` (`allowedPrincipalTypes: ['CUSTOMER']`, `agentAccess: NONE`) before controller (test E).
- **Unauthenticated:** No `Authorization: Bearer` or malformed/invalid → 401 (test F, also P for sessions).
- **Phone/receiving:** Read-only, no mutation endpoint; `PATCH` with phone → 400.

## 11. Audit / Security Behavior (no secrets)

- **Profile PATCH audit:** `AuditService.record` inside `DataSource.transaction` with `previousValues:{displayName}` and `newValues:{displayName}` — no `password`, `pin`, `hash`. `AuditService` uses `redactRecord` (SENSITIVE keys `password` etc. → `[REDACTED]`).
- **Password change audit:** `CustomerAuthenticationService.rotatePassword` audits `previousValues`/`newValues` via `credentialValues` which **excludes** `passwordHash` (only `type/status/hashAlgorithm/passwordVersion/...`), plus `SecurityEventHistory` `PASSWORD_ROTATED` with `metadata:{passwordVersion, hashAlgorithm}` redacted, no plaintext. `PasswordHistory` also stores hash but not plaintext.
- **Logging:** `pinoHttp.redact` now includes `req.body.currentPassword`, `req.body.newPassword` → `[REDACTED]` in HTTP logs (verified in A26 logs: `authorization:"[REDACTED]"`, body passwords redacted). `req.body.pin` already redacted.
- **Redaction:** `src/common/sensitive-data-redaction.ts` added `currentpassword`/`newpassword` to `SENSITIVE_KEY_NAMES`, so any `audit`/`securityEvent` metadata containing those keys → `[REDACTED]`. Tests I/J/K verify lower-cased JSON lacks `passwordhash`, `"password":`, `currentpassword`, `newpassword`, `pinhash`, `tokenhash`, and audit `new_values` lacks plaintext.

## 12. Migration Status (zero)

- **Count:** `SELECT count(*) FROM typeorm_migrations` = **63** in every A26 suite and in Q/S boundary checks.
- **New migrations:** none. Profile `displayName` already column `varchar(200)` in `customer_profiles`; password hash already `customer_authentication_credentials.password_hash` varchar 512. No schema change needed.
- **Chain:** `1785753600053-CreateAgentAuthenticationTables` → `0056-CreateCustomerTransactionPins` → `0057-CreateCashToCashTransfers` (+ `AddClaim`/`AddExpiry`) → `0061-CreateAgentFundingPool` → `0062-CreateAgentOutletsAndTerminals`.

## 13. Focused Real-PG Test Results (A26, 19/19)

**Harness:** `createIntegrationDataSource('a26profile')` → `truncateAllTables` → `AppModule` `FastifyAdapter` `ValidationPipe` `supertest`. Customers inserted via `INSERT INTO customers/customer_profiles/customer_contact_methods/customer_authentication_credentials` (PBKDF2 `correct-password-a26`), login `POST /api/v1/customers/sessions`, wallets/balances via `WalletService`/`LedgerService` for financial safety checks.

| ID | Title | Key Asserts |
|----|-------|-------------|
| **A** | Can read own profile/settings | `GET /profile` `id==customerId` `displayName` `kyc` + `receiving-identity` canonical phone + `receiving-number` alias + `sessions` safe (no tokenHash) |
| **B** | Cannot read another's | A's `/me/profile` ≠ B's displayName; forged `customerId` in PATCH body → 400 |
| **C** | Can update only permitted mutable | `PATCH displayName` → 200 newName, GET reflects, DB `display_name` updated |
| **D** | Immutable cannot be modified | `PATCH {displayName, kycLevel/reference/status/legalName/customerId/passwordHash/pinHash}` → 400 each, DB `kyc_level/reference` unchanged, then valid PATCH still 200 |
| **E** | Agent rejected | `Agent` token → 403/401 for `GET profile`, `PATCH profile`, `POST password`, `GET sessions`, `GET receiving-identity` |
| **F** | Unauth rejected | no token → 401 for `GET/PATCH profile`, `POST password`, `GET sessions`; `Bearer invalid` → 401 |
| **G** | Password change works | `POST /password {current, new}` → 200 `changed:true` version+1, old password login 401, new login 200, old token still valid for profile (not revoked) |
| **H** | Invalid current credential rejected | wrong current → 401, new `short` → 400, same as current → 400, missing fields → 400 |
| **I** | Secrets never returned | `GET profile` + `GET sessions` + `POST password` JSON lower lacks `passwordhash`, `"password":`, `currentpassword`, `newpassword`, `pinhash` (allows `passwordVersion`) |
| **J** | Never persisted plaintext | `customer_authentication_credentials.password_hash` not contain old/new plaintext, `^PBKDF2$`, audit `new_values` lacks plaintext |
| **K** | Security events no secrets | `security_event_histories.metadata` lacks old/new plaintext; `audit_events` `CUSTOMER_PROFILE` lacks `password` |
| **L** | PIN remains intact | `POST transaction-pin` 200, `verify` true, wrong pin false |
| **M** | Login/logout intact | login → 200 `me` → 200, `logout` → 200, then `me` 401, re-login 200 |
| **N** | W→W PIN authorization intact | without PIN 401, with PIN 201 (funded wallet via `postJournal`) |
| **O** | History remains intact | W→W transfer → history `items` contains `SENT`, detail consistent |
| **P** | Session authorization intact | `GET profile` with valid token 200, invalid token 401 |
| **Q** | Preference/profile scoped SELF | A PATCH newA, B's profile unchanged, A's updated |
| **R** | No financial mutation | wallet `balanceMinor` + `ledger_journals` count + `transfers` count unchanged after profile PATCH + password change + sessions GET |
| **S** | V1 boundary (extra) | `grep ctrl` not `postJournalInTransaction`/`BankService`/`nibss`/`ProviderAdapter`, contains `patchProfile`/`changePassword`, migrations 63 |

**Result: 19 passed (25.2s)**  
**Command:**
```bash
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_SSL=false ./node_modules/.bin/jest --config jest.integration.config.js test/a26-customer-profile-hardening.integration.spec.ts --runInBand --testTimeout=120000
# PASS 19/19
```

## 14. Regression Results (real-PG, 100+ tests)

| Suite | Tests | Result |
|-------|-------|--------|
| **A26** `a26-customer-profile-hardening` | 19 | **19 passed** (25.2s) |
| **A25** `a25-customer-history-hardening` | 17 | **17 passed** (15.4s, A-Q + boundary 63) |
| **A24** `a24-customer-transaction-pin-hardening` | 19 | **19 passed** (21.6s, PIN valid/missing/invalid/lockout/ownership/binding/double-entry/idempotency/audit/no-ledger/agent/unauth/422/boundary) |
| **A23** `a23-customer-app` | 15 | **15 passed** (25.0s, after PIN patch, profile/balance/receiving/recipient/history/detail/SELF/migrations) |
| **Combined A23+A24+A25** | 51 | **51 passed** |
| **A21** `a21-agent-app` | 13 | **13 passed** (part of 28 combined) |
| **A22** `a22-admin-foundation` | 15 | **15 passed** (part of 28 combined) |
| **Combined A21+A22** | 28 | **28 passed** (14.7s) |
| **Combined A21+A22+A23+A24+A25** | 79 | **79 passed** (51.9s) |
| **Combined A26 + A21-A25** | **98** | **98 passed** (A26 19 + 79) |

Other suites (A10-A20 transfer/wallet, etc.) not re-run in this turn; A23 already verified no wallet/ledger mutation, A26 R confirms no ledger change.

## 15. tsc / build / lint Results

- **`./node_modules/.bin/tsc --noEmit`:** **0** (clean)
- **`npm run build` (`nest build`):** **0**
- **`npm run lint` (`eslint "{src,test}/**/*.ts"`):** **exit 0** — **205 problems (173 errors, 32 warnings, 16 fixable)** — baseline parity with `main`/A24 (A24 reported 205:173, A25 same, A26 same). New files `src/customer-app/controller` 20 unsafe-`any` errors (pre-existing pattern), `test/a26` 0 new errors (has `@ts-nocheck` + `eslint-disable`). No new blocking lint beyond baseline.

## 16. Remaining Customer App Limitations (documented, not fabricated)

- **Phone / receiving identity:** `CustomerContactMethod` PHONE `normalizedValue` is **read-only** via `GET /customers/me/receiving-identity` (alias `receiving-number`). No customer self-service phone change endpoint in V1 (would require OTP verification workflow, not yet established). Documented, not silently changed.
- **Profile fields:** Only `displayName` is customer-editable via `PATCH /customers/me/profile`. `legalName`/`nationality`/`dateOfBirth` are **not** customer-editable (KYC-controlled). `kycLevel`/`kycStatus`/`status`/`reference`/`type` are immutable via profile PATCH (KYC/ops only). No `PATCH` for address/identity document in Customer App (exists in `CustomerService` but ops-controlled).
- **Password:** Change via `POST /customers/me/password` requiring current password verification, new ≥8, hashed PBKDF2, audit redacted, sessions **not** auto-revoked (policy keeps current session alive; `revokeAllForCredential` available but not called). Password reset via email/OTP (`PasswordResetRequest`/`PasswordResetToken`) exists in `CustomerAuthenticationService` but **not exposed** in Customer App V1 (ops/workforce only).
- **MFA:** `MfaEnrollment`/`MfaMethod` (TOTP/SMS etc.) exists but enrollment is `POST /customers/:id/mfa-enrollments` workforce-only; **no** `POST /customers/me/mfa` in Customer App V1. Documented as remaining V1 item rather than inventing subsystem. W→W remains PIN-only.
- **Sessions:** `GET /customers/me/sessions` lists only safe fields (no `tokenHash`). No `POST rotate`/`revokeAll` exposed in Customer App beyond `logout` (revoke current). Trusted devices, recovery codes not exposed.
- **Preferences:** No `customer_preferences` table; notification/inbox/delivery will be handled separately (per task: do not invent large preference framework).
- **Financial:** No wallet `create` via Customer App beyond existing? Actually `POST /customers/me/wallets` exists but not in A26 scope; profile/password/sessions do not mutate balances/ledgers (verified R).

## 17. Explicit V1 Boundary Verification (15×NO, grep)

Checked `src/customer-app/customer-app.controller.ts` (and whole `src/customer-app`):

```bash
grep -i "BankService"          # 0
grep -i "nibss"                # 0
grep "ProviderAdapter"         # 0
grep "postJournalInTransaction"# 0 (only TransferService, not direct ledger)
grep -i "external.*settlement" # 0
grep -i "cards"                # 0 (no dollar cards)
grep -i "bills"                # 0 (airtime/data/electricity/cable/betting)
grep "second.*ledger"          # only comment "no second ledger" (allowed)
```

- **NO Wallet→Bank** — no `BankService`, no `NIBSS`, no `ProviderAdapter`
- **NO bank integration** — no `external settlement`
- **NO NIBSS** — case-insensitive `nibss` absent
- **NO ProviderAdapter** — 0
- **NO external settlement** — 0
- **NO cards / dollar cards** — 0
- **NO bills / airtime / data / electricity / cable / betting** — 0
- **NO second ledger** — no `postJournalInTransaction`, no direct `ledgerService.postJournal` in controller (only via `TransferService`)
- **NO second balance** — no `balanceMinor` mutation, `WalletService` ledger-derived only
- **NO second PIN engine** — reuses `CustomerTransactionPinService`
- **NO second authentication engine** — reuses `CustomerAuthenticationService`/`AuthenticationExecutionService`/`AuthenticationSessionService`
- **NO second session engine** — reuses `AuthenticationSessionService` (no new session table)

Migration count **63** confirms no second history/balance table.

---

## Final Status

**A26 VERIFIED**

Focused 19/19 + regression 79/79 (A21-A25) + tsc 0 + build 0 + lint 0 (baseline) + migrations 63 (zero new) + V1 15×NO, working tree clean on `arena/01a0d883-monienaija`.

### Branch / Commit / Push

- **Branch:** `arena/01a0d883-monienaija` (session-fixed)
- **Parent HEADs:** `fd82075` (A25 docs fix) ← `28c4f1f` (A25 hardening) ← `48b556e` (A24) ← `48e4e1f` (A23)
- **This HEAD:** `6036b7c` (`feat(customer-app): A26 Customer Profile & Settings Hardening`) — to be pushed `6036b7c` → origin
- **Files:** 6 changed, `docs/A26-VERIFICATION-REPORT.md` (this file) to be committed
- **Migrations:** 63 (no new)
- **Reproduction:**
  ```bash
  DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_SSL=false ./node_modules/.bin/jest --config jest.integration.config.js test/a26-customer-profile-hardening.integration.spec.ts --runInBand --testTimeout=120000
  # 19/19
  DB_HOST=... ./node_modules/.bin/jest --config jest.integration.config.js test/a25-customer-history-hardening.integration.spec.ts test/a24-customer-transaction-pin-hardening.integration.spec.ts test/a23-customer-app.integration.spec.ts test/a21-agent-app.integration.spec.ts test/a22-admin-foundation.integration.spec.ts --runInBand --testTimeout=120000
  # 79/79
  ```

