# V1-CUSTOMER-LIFECYCLE-FOUNDATION-01: Customer Self-Service Lifecycle Foundation

| Metadata | Value |
| :--- | :--- |
| **Document ID** | `V1-CUSTOMER-LIFECYCLE-FOUNDATION-01` |
| **Task Reference** | `V1-CUSTOMER-01` |
| **Gap Addressed** | `GAP-A02` (Customer Registration DRAFT Deadlock) |
| **Status** | `VERIFIED` / `IMPLEMENTED` |
| **Date** | `2026-10-02` |
| **Author** | Arena.ai Engineering Core |
| **Component Scope** | `src/customer-registration/`, `src/customer-authentication/`, `src/customer-app/`, `src/wallet/` |

---

## 1. Executive Summary & Problem Resolution

### 1.1 Problem Statement (GAP-A02 Resolution)
Prior to this implementation, the customer onboarding pipeline ended in a critical deadlock:
1. Public endpoints (`POST /customers/registration/otp`, `POST /customers/registration/otp/verify`, `POST /customers/registration`) created customers strictly in `DRAFT` status with a verified phone record.
2. The registration payload did not accept or store a password, did not provision a primary wallet, and did not issue a session token.
3. Customers remained trapped in `DRAFT` status indefinitely unless an administrator manually executed three sequential privileged workforce actions:
   - `PATCH /customers/:id` (transitioning `DRAFT` $\to$ `ACTIVE`).
   - `POST /customers/:id/wallets` (provisioning primary NGN wallet).
   - `POST /internal/admin/customers/:id/credentials` (generating and dispatching a temporary password via SMS, requiring mandatory first-login rotation).

### 1.2 Delivered Solution
Under `V1-CUSTOMER-01`, a production-grade, secure customer self-service lifecycle is established:
1. **Self-Service Registration Completion:** Customers submit their phone number, OTP verification token, desired password ($\ge 8$ chars), optional display name, and optional idempotency key to `POST /api/v1/customers/registration`.
2. **Atomic Provisioning & PBKDF2 Password Hashing:** Within a single PostgreSQL `SERIALIZABLE` transaction:
   - The OTP verification token is consumed.
   - The password is hashed using PBKDF2-HMAC-SHA256 ($10,000$ iterations) and saved to `customer_authentication_credentials` with `status = ACTIVE` and `rotationRequired = false`.
   - A primary NGN `WalletAccount` is provisioned atomically alongside its double-entry liability `LedgerAccount` (`WALLET-${walletId}`, normal balance `CREDIT`, accounting unit `CUSTOMER_FUNDS`).
   - Customer status transitions directly to `ACTIVE` (the verified primary phone prerequisite is satisfied).
   - Optional `CustomerProfile` is created.
3. **Multi-Identifier Customer Authentication:** Customers can immediately authenticate via `POST /api/v1/customers/sessions` or `POST /api/v1/customers/login` using any of:
   - **Normalized Nigerian Phone Number:** Local format (e.g. `08012345678`), E.164 (e.g. `+2348012345678`), or canonical (e.g. `8012345678`).
   - **Customer Reference:** e.g. `mn-8012345678`.
   - **Customer UUID:** e.g. `00000000-0000-4000-8000-000000000001`.
4. **Backward Compatibility:** Requests omitting `password` continue to produce `DRAFT` customers without credentials or wallets, preserving full compatibility with workforce-reviewed onboarding paths.

---

## 2. End-to-End Customer Lifecycle Architecture

```
                                  CUSTOMER SELF-SERVICE REGISTRATION LIFECYCLE
                                  ──────────────────────────────────────────

 [1. User Enters Phone] ────────► POST /api/v1/customers/registration/otp
                                         │
                                         ├─► Normalizes to 10-digit canonical (e.g. 8012345678)
                                         ├─► Applies per-IP (20/hr) & per-phone (3/hr) rate limits
                                         ├─► Generates CSPRNG 6-digit OTP & PBKDF2 salt/hash
                                         └─► Dispatches SMS via NotificationProvider
                                         │
 [2. User Submits OTP] ─────────► POST /api/v1/customers/registration/otp/verify
                                         │
                                         ├─► Validates OTP (PBKDF2 timingSafeEqual, max 5 attempts)
                                         ├─► Generates 32-byte CSPRNG verificationToken
                                         └─► Returns { status: "PHONE_VERIFIED", verificationToken }
                                         │
 [3. User Sets Password] ───────► POST /api/v1/customers/registration
                                         │  (Payload: phone, verificationToken, password, displayName)
                                         │
                                         ▼ [SERIALIZABLE TRANSACTION]
                                         ├─► Validates & consumes verificationToken
                                         ├─► Creates Customer (status: ACTIVE, reference: mn-8012345678)
                                         ├─► Creates CustomerContactMethod (PHONE, verified_at: NOW())
                                         ├─► Creates CustomerProfile (displayName)
                                         ├─► Hashes password (PBKDF2-HMAC-SHA256, 10,000 iter)
                                         ├─► Creates CustomerAuthenticationCredential (status: ACTIVE)
                                         ├─► Provisions Primary NGN WalletAccount & Liability LedgerAccount
                                         ├─► Emits non-leaking Audit Events
                                         └─► Returns CompleteRegistrationView + Wallet metadata
                                         │
                                         ▼
 [4. Immediate Login] ──────────► POST /api/v1/customers/sessions  (or /customers/login)
                                         │  (Identifier: Phone "08012345678" OR "mn-8012345678" OR UUID)
                                         │
                                         ├─► Resolves Customer & active PBKDF2 Credential
                                         ├─► Verifies Password & asserts CustomerStatus == ACTIVE
                                         ├─► Issues Customer Session (JWT / Bearer Token)
                                         └─► Client accesses /customers/me, /dashboard, /transfers
```

---

## 3. Detailed Component Specifications

### 3.1 Registration Front-Door (`src/customer-registration/`)
* **`CustomerRegistrationController`:**
  * Route: `POST /api/v1/customers/registration/otp` — Request 6-digit phone verification OTP.
  * Route: `POST /api/v1/customers/registration/otp/verify` — Verify OTP and receive one-time `verificationToken` (TTL 15 minutes).
  * Route: `POST /api/v1/customers/registration` — Complete registration.
* **`CompleteRegistrationDto`:**
  ```typescript
  export class CompleteRegistrationDto {
    phone!: string;            // Validated Nigerian mobile
    verificationToken!: string;// 32-byte base64url one-time token
    password?: string;         // Optional for backward compatibility, min 8 max 128 chars
    displayName?: string;      // Optional profile display name
    idempotencyKey?: string;   // Optional client idempotency key
  }
  ```
* **`CustomerRegistrationService.completeRegistration` Logic:**
  * Hashes `verificationToken` with SHA-256 and validates match against active challenge.
  * Checks that phone is not already bound to another customer (`CustomerContactMethod`).
  * If `password` is supplied:
    * Sets `customer.status = CustomerStatus.ACTIVE`.
    * Creates `CustomerAuthenticationCredential` with `hashAlgorithm = PBKDF2`, `rotationRequired = false`, `status = ACTIVE`.
    * Calls `WalletService.createWalletInTransaction` to create an active primary NGN wallet and liability ledger account `WALLET-${id}`.
    * Returns `wallet: { id, currency: "NGN", status: "ACTIVE" }` in response.
  * If `password` is omitted:
    * Sets `customer.status = CustomerStatus.DRAFT`.
    * Does not create credentials or wallet (workforce-review mode).

### 3.2 Customer Authentication & Login (`src/customer-authentication/`, `src/customer-app/`)
* **`AuthenticationExecutionService.authenticate`:**
  * Resolves caller identity across 3 formats:
    1. **UUID:** Checked against `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
    2. **Reference:** Checked against `mn-<canonical phone>` or generic customer reference.
    3. **Nigerian Phone Number:** Canonicalized to 10-digit national number (e.g. `8012345678`) and resolved via `CustomerContactMethod` where `type = PHONE` and `deletedAt IS NULL`.
  * Verifies PBKDF2 password hash using `timingSafeEqual`.
  * Enforces `CustomerStatus == ACTIVE`. If customer is `DRAFT` or `SUSPENDED`, records `AUTHENTICATION_STATUS_INELIGIBLE` audit and fails without session.
  * Enforces lockout policy: 5 consecutive failed attempts lock the credential (`accountLocked = true`).
  * Emits `AUTHENTICATED` audit event with credential ID and customer ID.
* **`CustomerAppController.login` (`POST /api/v1/customers/sessions` & `POST /api/v1/customers/login`):**
  * Accepts `customerId`, `identifier`, or `phone`.
  * Issues session token with `AuthenticationSessionService`.

---

## 4. Security & Audit Invariants

| Security Domain | Mechanism | Invariant Verified |
| :--- | :--- | :--- |
| **Plaintext Secret Protection** | PBKDF2-HMAC-SHA256 ($10,000$ iterations, $16$-byte salt, $32$-byte digest) | No plaintext password or OTP is ever logged, stored in outbox, or returned in API views. |
| **Enumeration Resistance** | Constant generic responses on OTP requests & failures | Identical HTTP 200 returned for taken vs untaken numbers on OTP request; generic HTTP 400 on verification failures. |
| **Token Replay Protection** | `consumed_at` timestamp + SHA-256 token hash | Verification tokens are strictly one-time use; replay attempts fail with HTTP 400. |
| **Double-Entry Balance Conservation** | `LedgerAccount` (`WALLET-${id}`) created atomically with `WalletAccount` | Total liability ledger credits equal wallet balance; zero floating balances. |
| **Lifecycle State Machine** | Verified primary phone prerequisite enforced before `ACTIVE` status | Unverified phone numbers can never hold active credentials or wallets. |

---

## 5. Verification Evidence

### 5.1 Unit Tests
* **`test/customer-registration.service.spec.ts` (7 tests, PASS):**
  * Normalization of all Nigerian phone formats (`080...`, `+23480...`, `80...`).
  * End-to-end OTP request, SMS dispatch, verification, and registration completion.
  * PBKDF2 credential creation with `rotationRequired = false`.
  * Atomic wallet and liability ledger account creation.
  * Audit trail validation (zero leakage of password or token).
  * Consumed token replay rejection.
  * Backward compatibility for DRAFT registration without password.
* **`test/authentication-execution.service.spec.ts` (9 tests, PASS):**
  * Authentication by Customer UUID.
  * Authentication by Customer Reference (`mn-8012345678`).
  * Authentication by Nigerian phone number (`08012345678`, `+2348012345678`).
  * Password failure tracking & credential lockout.
  * Ineligible status rejection (DRAFT/SUSPENDED).
* **`test/customer-app.login.spec.ts` (7 tests, PASS):**
  * `CustomerAppController` login & loginAlias routing for phone, reference, and UUID.

### 5.2 Integration Tests
* **`test/v1-customer-self-service-lifecycle.integration.spec.ts` (Real PostgreSQL Suite):**
  * Verifies live database state across `customers`, `customer_contact_methods`, `customer_authentication_credentials`, `wallet_accounts`, and `ledger_accounts`.
  * Verifies immediate login and authenticated access to `GET /customers/me`, `GET /customers/me/profile`, and `GET /customers/me/dashboard`.

---

## 6. API Reference Summary

### `POST /api/v1/customers/registration/otp`
* **Request:** `{ "phone": "08012345678" }`
* **Response (200):**
  ```json
  {
    "status": "OTP_REQUEST_ACCEPTED",
    "resendAfterSeconds": 60,
    "expiresInSeconds": 300
  }
  ```

### `POST /api/v1/customers/registration/otp/verify`
* **Request:** `{ "phone": "08012345678", "code": "123456" }`
* **Response (200):**
  ```json
  {
    "status": "PHONE_VERIFIED",
    "verificationToken": "k8X9...32bytes...",
    "expiresInSeconds": 900
  }
  ```

### `POST /api/v1/customers/registration`
* **Request:**
  ```json
  {
    "phone": "08012345678",
    "verificationToken": "k8X9...32bytes...",
    "password": "CustomerSecurePassword123!",
    "displayName": "Chinedu Eze"
  }
  ```
* **Response (201):**
  ```json
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "reference": "mn-8012345678",
    "status": "ACTIVE",
    "phone": "+234*****5678",
    "phoneVerifiedAt": "2026-10-02T12:00:00.000Z",
    "wallet": {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "currency": "NGN",
      "status": "ACTIVE"
    }
  }
  ```

### `POST /api/v1/customers/sessions` (or `POST /api/v1/customers/login`)
* **Request:**
  ```json
  {
    "phone": "08012345678",
    "password": "CustomerSecurePassword123!"
  }
  ```
* **Response (200):**
  ```json
  {
    "accessToken": "ey...",
    "tokenType": "Bearer",
    "expiresAt": "2026-10-02T13:00:00.000Z",
    "customerId": "550e8400-e29b-41d4-a716-446655440000",
    "sessionId": "770e8400-e29b-41d4-a716-446655440002"
  }
  ```
