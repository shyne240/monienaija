# V1-MASTER-04: Critical Gap Verification, WhatsApp MFA Architecture & Transaction Reference Audit

**Date:** 2026-10-02  
**Audit Scope:** Verification of Critical V1 Gaps, WhatsApp MFA Feasibility, Transaction Reference Architecture, and Dependency-Aware Implementation Roadmap  
**Branch:** `arena/01a0fcf7-monienaija`  
**HEAD Commit:** `29deb7997622cda2d58a34d7a4d78b0f59a0e683`  
**Classification Discipline:** Deep Code Inspection, Threat Modeling, Financial Invariants, and Operational Realism  

---

## 1. Current Repository Truth

A line-by-line inspection of the MonieNaija codebase at current HEAD establishes the following ground truths:

| Subsystem / Layer | Source Location | Verified Code State | Gap / Risk Classification |
|---|---|---|---|
| **Agent Mobile** | `apps/agent-mobile/` | 17 Jest suites, 232/232 tests pass. Mature UI for Login, C2W, W2C, C2C, C2C-Claim, PIN, Support, Receipts. | **Production-Ready UI** (Minor gaps: volatile idempotency & cache-only receipt retrieval). |
| **Customer Mobile** | `apps/customer-mobile/` | Legacy prototype. `SendMoneyScreen` takes raw UUIDs; `WithdrawScreen` and `FundWalletScreen` call sandbox mock `/deposits` and `/withdrawals`. | **CRITICAL GAP (GAP-A01)**: Completely disconnected from real V1 backend. |
| **Customer Registration**| `src/customer-registration/` | Public endpoints (`/otp`, `/otp/verify`, `/`) create `DRAFT` customer with verified phone. No password or wallet created. | **CRITICAL GAP (GAP-A02)**: Onboarding deadlock without manual workforce intervention. |
| **Transaction Idempotency**| `src/operations/idempotency.service.ts` | Backend strictly enforces 24h replay deduplication. Mobile apps store keys in `useRef` / `useState` in volatile memory. | **CRITICAL GAP (GAP-A03)**: Key loss on force-quit/relaunch leads to fresh keys and duplicate debits. |
| **Transaction PIN** | `src/agent-authentication/`, `src/customer/` | PIN hashed with PBKDF2; `failedCount >= 5` locks account (`accountLocked=true`). No admin unlock API exists. | **CRITICAL GAP (GAP-A04)**: Permanent lockout on 5 bad PIN attempts. |
| **Agent Commissions** | `src/commission/` | Decision calculator implemented; all financial flows emit `commissionNone()` by design. | **HIGH GAP (GAP-B01)**: Agents receive ₦0.00 earnings on all transactions. |
| **SMS Notifications** | `src/notification/` | In-process Postgres outbox worker with `FOR UPDATE SKIP LOCKED`. Robase adapter verified. Ommits C2W and W2C. | **HIGH GAP (GAP-B02)**: Missing Cash-In & Cash-Out SMS alerts to customers. |
| **Transaction Receipts** | `apps/agent-mobile/src/components/` | `AgentReceipt.tsx` renders text-only share. Backend lacks `GET /agents/me/transactions/:id` detail endpoint. | **HIGH GAP (GAP-B03)** & **MEDIUM GAP (GAP-C01)**: Receipt loss on cache eviction. |
| **Customer Support** | `src/support/` | Full backend support API (`POST /customers/me/support-tickets`). Zero UI in `apps/customer-mobile`. | **HIGH GAP (GAP-B04)**: No in-app dispute UI for customers. |
| **Reconciliation Engine**| `src/reconciliation/` | Reconciles customer wallets and transfers. Completely omits `agent_funding_pool` and `cash_to_cash_transfers`. | **MEDIUM GAP (GAP-C02)**: Blind to agent float drift and escrow transit imbalance. |
| **Transaction References**| `src/agent/`, `src/transfer/` | Deterministic references generated across all flows (`CASH_IN-tx-...`, `CASH_OUT-tx-...`, `CASH_TO_CASH-...`). | **NOT A GAP**: Public customer-facing reference system is fully implemented in backend. |

---

## 2. Verification of GAP-A01: Customer Mobile Implementation

### 2.1 Trace of Customer Financial Screens
1. **Wallet-to-Wallet (`SendMoneyScreen.tsx`):**
   * Prompts user for `Recipient Wallet ID (UUID)` (e.g. `5e6f7g8h-...`) with regex validation `/^[0-9a-f]{8}-[0-9a-f]{4}.../i`.
   * Submits `POST /transfers` with `sourceWalletId`, `destinationWalletId`, `amountMinor`.
   * Does **not** resolve recipient phone number to legal name (`GET /customers/me/recipient`).
   * Does **not** require or accept Customer Transaction PIN.
   * On success, immediately navigates to `Home` without displaying a confirmation receipt.
2. **Wallet Funding (`FundWalletScreen.tsx`):**
   * Displays banner: *"⚙️ Sandbox Simulated Transfer"*.
   * Calls `POST /deposits` then immediately calls `POST /deposits/:id/complete` (Legacy sandbox mock).
3. **Withdrawal (`WithdrawScreen.tsx`):**
   * Displays banner: *"⚙️ Sandbox Simulated Outflow"*.
   * Calls `POST /withdrawals` then immediately calls `POST /withdrawals/:id/complete` (Legacy sandbox mock).
4. **Cash-to-Cash Claim:**
   * **Missing completely** in `apps/customer-mobile`.
5. **PIN Management & Support:**
   * **Missing completely** in `apps/customer-mobile`.

### 2.2 Verification Conclusion
**VERIFIED CRITICAL GAP (GAP-A01):** `apps/customer-mobile` is completely decoupled from the production V1 NestJS backend. It cannot be used by real customers until aligned with `CustomerAppController` endpoints.

---

## 3. Verification of GAP-A02: Customer Registration & Onboarding Lifecycle

### 3.1 Trace of Customer Onboarding Flow
```
[1. User Enters Phone] ──► POST /customers/registration/otp (OTP sent via SMS)
                                 │
[2. User Enters OTP]   ──► POST /customers/registration/otp/verify (Returns verificationToken)
                                 │
[3. User Submits Form] ──► POST /customers/registration (Creates DRAFT customer + Phone record)
                                 │
                            [DEAD END]
  - No Password Set (Customer cannot set password in registration)
  - No Session Issued (No JWT or session token returned)
  - No Wallet Provisioned (WalletAccount is NOT created)
  - Status remains DRAFT
                                 │
                    [MANUAL WORKFORCE BOTTLENECK]
  - Workforce Admin must call: PATCH /customers/:id (status -> ACTIVE)
  - Workforce Admin must call: POST /customers/:id/wallets (Provision wallet binding)
  - Workforce Admin must call: POST /internal/admin/customers/:id/credentials
    (Generates random temporary password, sends via SMS, sets rotationRequired=true)
                                 │
[4. Customer Receives SMS] ──► Logs in with temporary password (POST /customers/login)
                                 │
[5. Mandatory Password Change] ─► POST /customers/credentials/rotate
                                 │
[6. Mandatory PIN Setup] ──────► POST /customers/me/transaction-pin
```

### 3.2 Verification Conclusion
**VERIFIED CRITICAL GAP (GAP-A02):** Self-service customer onboarding is impossible in the current codebase. Every registered customer is orphaned in `DRAFT` status until an admin manually activates them and provisions credentials. A self-service V1 onboarding endpoint must be provided.

---

## 4. Verification of GAP-A03: Idempotency & Lost-Response Recovery

### 4.1 Resolution of Contradiction
* **Previous Arena Report Claim:** "One idempotency key per logical transaction."
* **V1-MASTER-03 Claim:** "Idempotency keys are stored in volatile React component state."
* **Code Inspection Reality (`CashToWalletAmountScreen.tsx` line 28):**
  ```typescript
  const idempotencyKeyRef = useRef<string>(route.params.amountMinor ? '' : newIdempotencyKey('c2w'));
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey('c2w');
  ```
* **The Exact Failure Scenario:**
  1. An Agent initiates a ₦50,000 Cash-to-Wallet transaction. `idempotencyKeyRef.current` = `"tx-c2w-agent1-1727900000000-abc123456"`.
  2. Agent taps "Credit Wallet". Backend commits transaction and debits agent float.
  3. Network drops; mobile client catches `NetworkError` and renders: *"Network error. Please check your connection and retry."*
  4. If the Agent taps retry on the same screen: The same key is re-sent, and the backend safely returns `replayed: true`.
  5. **IF THE AGENT FORCE-QUITS THE APP OR NAVIGATES BACK TO HOME:** The React component unmounts and the memory reference is destroyed.
  6. The Agent opens Cash-to-Wallet again. `CashToWalletAmountScreen` mounts anew and generates a **NEW** key: `"tx-c2w-agent1-1727900005000-xyz987654"`.
  7. The Agent submits. The backend treats this as a distinct transaction and debits the agent float a second time!

### 4.2 Verification Conclusion
**VERIFIED CRITICAL GAP (GAP-A03):** Backend idempotency is authoritative, but client-side idempotency key generation is volatile. Persistent storage of in-flight transaction keys (e.g. in `AsyncStorage` / `SecureStorage`) is required to prevent double-debiting upon app relaunch.

---

## 5. Verification of GAP-A04: Transaction PIN Lockout Handling

### 5.1 Trace of PIN Verification & Lockout
* **Lockout Rule (`AgentAuthenticationService` line 400 & `CustomerTransactionPinService`):**
  * Maximum failed attempts: **5 consecutive failures**.
  * Upon 5th failure: `failedCount = 5`, `accountLocked = true`, `lockedAt = NOW()`, `lockReason = 'EXCESSIVE_FAILED_ATTEMPTS'`.
  * Lock duration: **Permanent** (There is no TTL or auto-unlock timer).
* **Workforce Recovery APIs (`src/admin/`):**
  * `AdminAgentCredentialsController`: Exposes `issueInitialCredential` and `reissueInitialCredential` (passwords only). **Zero PIN unlock endpoints.**
  * `AdminCustomerCredentialsController`: Exposes `issueInitialCredential` and `reissueInitialCredential` (passwords only). **Zero PIN unlock endpoints.**

### 5.2 Verification Conclusion
**VERIFIED CRITICAL GAP (GAP-A04):** Once locked, an Agent or Customer is permanently barred from financial execution. An administrative PIN unlock route (`POST /internal/admin/agents/:id/pin/unlock` and `POST /internal/admin/customers/:id/pin/unlock`) must be added to the backend.

---

## 6. Verification of Commission Implementation & Commercial Policy

### 6.1 Code Inspection of Commission Engine
* **Source:** `src/commission/commission.engine.ts` lines 20–26:
  ```typescript
  // Produces a commission DECISION REPRESENTATION in the exact shape the existing
  // Commercial Decision Snapshot already supports... It does NOT charge, post, split or settle
  // anything, and it is NOT called by any financial flow today — every V1 flow still records
  // commission status NONE via commissionNone(), exactly as before.
  ```
* **Ledger Reality:** All V1 ledger journals record principal-only movements. No commission accounts are credited or debited.

### 6.2 Commercial Decision Status
* **Status:** **DECISION REQUIRED (DEC-03)**.
* **Product Determination:** In Nigerian agency banking, agents expect either:
  * **Model A (Instant Netting / Float Credit):** Agent float is credited commission immediately upon cash-in/cash-out completion.
  * **Model B (Accrual & Batch Settlement):** Commission accrues in a separate ledger account and is settled to the agent float nightly or weekly.
* V1 launch requires a clear commercial decision on whether Model A or Model B is active.

---

## 7. Verification of Customer Cash-In / Cash-Out Communications

### 7.1 Notification Catalogue Audit
* **Source:** `src/notification/notification-event-map.ts`.
* **Events Mapped to SMS:**
  * `customer.funding.approved` / `rejected` → SMS to customer.
  * `transfer.completed` / `failed` → SMS to sender and recipient.
  * `support.ticket.*` → SMS to customer/agent.
  * `cash_to_cash.claimed` / `expired` → SMS to claimant/agent.
* **Omissions in Codebase:**
  * `CASH_IN` (Cash-to-Wallet) → **NO SMS INTENT MAPPED**.
  * `CASH_OUT` (Wallet-to-Cash) → **NO SMS INTENT MAPPED**.
* **Impact:** A customer depositing cash at an agent stall receives no SMS confirmation from MonieNaija.

### 7.2 Verification Conclusion
**VERIFIED HIGH GAP (GAP-B02):** `agent.cash_in` and `agent.cash_out` must be mapped to customer SMS notification templates.

---

## 8. Verification of Receipt Retrieval & Historical Reproduction

### 8.1 Agent Receipt Trace
* **Component:** `apps/agent-mobile/src/screens/authenticated/TransactionReceiptScreen.tsx`.
* **Behavior:** When opened by `itemId`, the screen searches TanStack Query cache (`queryClient.getQueriesData({ queryKey: ['agent-transactions', agentId] })`).
* **Failure Condition:** If the app restarts, cache is cleared, or user deep-links to a receipt from 2 weeks ago, the screen displays: *"This receipt is not loaded. Open it from your transaction history."*
* **Root Cause:** Backend has no `GET /api/v1/agents/me/transactions/:id` detail endpoint.

### 8.2 Customer Receipt Trace
* **Status:** Completely missing in `apps/customer-mobile`.

### 8.3 Verification Conclusion
**VERIFIED HIGH GAP (GAP-B03):** Backend must provide `GET /api/v1/agents/me/transactions/:id` and `GET /api/v1/customers/me/transactions/:id` to guarantee permanent, server-authoritative receipt regeneration.

---

## 9. Verification of Customer Support Subsystem

### 9.1 Backend vs Mobile State
* **Backend:** `SupportCustomerController` (`src/support/support-customer.controller.ts`) is fully implemented with:
  * `POST /api/v1/customers/me/support-tickets`
  * `GET /api/v1/customers/me/support-tickets`
  * `GET /api/v1/customers/me/support-tickets/:id`
  * `POST /api/v1/customers/me/support-tickets/:id/messages`
* **Customer Mobile:** `apps/customer-mobile/` contains zero support screens.

### 9.2 Verification Conclusion
**VERIFIED HIGH GAP (GAP-B04):** Customer Mobile must implement support ticket creation and messaging screens.

---

## 10. Verification of Financial Reconciliation

### 10.1 Code Inspection of `ReconciliationService`
* **Source:** `src/reconciliation/reconciliation.service.ts`.
* **Active Checks:**
  1. `wallet_balances_ledger_derived` (Customer wallets vs ledger accounts).
  2. `journal_integrity` (Sum of Debits == Sum of Credits per journal).
  3. `trial_balance` (Conservation across accounting units).
  4. `transfer_reconciliation` (Transfer table status vs ledger journals).
* **Missing Checks:**
  1. `agent_funding_pool` float balances vs ledger.
  2. `cash_to_cash_transfers` escrow/transit liability vs claimed/expired states.
  3. Commercial fee decisions vs ledger revenue accounts.

### 10.2 Verification Conclusion
**VERIFIED MEDIUM GAP (GAP-C02):** Reconciliation engine must be extended to verify agent float balances and Cash-to-Cash transit accounts.

---

## 11. Customer PIN on Agent Device: Security & Transaction Binding Audit

Per product direction, the customer entering their transaction PIN on the Agent's mobile device is an **accepted V1 operational model** (analogous to a Nigerian POS terminal).

### 11.1 Concrete Security Audit of Implementation

| Security Property | Implementation in Code | Verification Status |
|---|---|---|
| **PIN Confidentiality from Agent** | `secureTextEntry` enabled; input masked with `••••`. | **PASS** |
| **Volatile In-Memory Clearing** | PIN state cleared on submit, on unmount (`useEffect(() => () => setPin(''), [])`), and on error. | **PASS** |
| **No Persistence** | PIN is never written to `AsyncStorage`, `SecureStorage`, or device SQLite. | **PASS** |
| **No Navigation Leakage** | PIN is never passed in React Navigation `route.params`. | **PASS** |
| **No Logging / Telemetry** | PIN is excluded from console logs and error serializer. | **PASS** |
| **Transport Encryption** | PIN transmitted via HTTPS POST body to `/agents/me/cash-out`. | **PASS** (Requires staging SSL) |
| **Server-Side Verification** | Verified against PBKDF2 hash via `CustomerTransactionPinService`. | **PASS** |
| **Transaction Binding** | PIN verified in same transaction as principal, agentId, and customerId. | **PASS** |
| **Attempt Limit & Lockout** | Failed attempts increment `failedCount`; locks after 5 attempts. | **PASS** |
| **OTP Binding & Expiry** | Customer withdrawal OTP generated server-side with 5-minute expiry. | **PASS** |

### 11.2 Verification Conclusion
**ACCEPTED V1 MODEL — SECURITY VERIFIED:** The PIN-on-terminal flow satisfies all core security and binding invariants. No architectural change is required for V1.

---

## 12. Transaction Reference Architecture Verification

### 12.1 Identifier Taxonomy & Invariants

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 IDENTIFIER TAXONOMY                                    │
├───────────────────────────────┬───────────────────────────────────┬────────────────────┤
│ Identifier Type               │ Example Value                     │ Scope & Purpose    │
├───────────────────────────────┼───────────────────────────────────┼────────────────────┤
│ 1. Internal Database ID       │ e.g. 5e6f7g8h-1a2b-3c4d-5e6f-...  │ UUID Primary Key   │
│ 2. Ledger Journal ID          │ e.g. 9b8a7c6d-4e5f-6a7b-8c9d-...  │ Double-Entry Audit │
│ 3. Idempotency Key            │ tx-c2w-agent1-1727900000000-abc1  │ Network Dedupe     │
│ 4. Public Transaction Ref     │ CASH_IN-tx-c2w-agent1-17279000... │ Customer Receipt   │
└───────────────────────────────┴───────────────────────────────────┴────────────────────┘
```

### 12.2 Verification Findings
* **Generation & Uniqueness:** References are deterministically derived or generated via `PaymentReferenceService` / `randomBytes` across all financial services.
* **Database Persistence:** Persisted in `transfers.reference`, `cash_to_cash_transfers.reference`, `ledger_journals.reference`.
* **Exposure:** Returned in API responses, rendered on `AgentReceipt.tsx`, and included in unified history projections.
* **Conclusion:** **ITEM ALREADY SOLVED.** An authoritative transaction reference system exists and is consistent across all backend services.

---

## 13. WhatsApp Verification & MFA Architecture Investigation

### 13.1 Strategic Rationale in Nigerian Market
* **Telco SMS Fragility:** Nigerian carriers frequently suffer from DND (Do Not Disturb) blocking, gateway downtime, and high per-SMS unit costs.
* **WhatsApp Ubiquity:** WhatsApp has near-100% penetration among Nigerian smartphone users and offers high delivery rates over Wi-Fi and mobile data.

### 13.2 WhatsApp Security & Threat Analysis
* **Core Rule:** *"User controls WhatsApp ≠ user owns the phone number."*
* **Threat Vectors:**
  1. **SIM Swap / Number Recycling:** Telcos recycle numbers after 90 days of inactivity; WhatsApp accounts can remain active on old devices.
  2. **WhatsApp Account Takeover:** Social engineering ("Send me the 6-digit WhatsApp code") is frequent in Nigeria.
  3. **Multi-Device Sync:** WhatsApp Web sessions on public computers can expose incoming OTP messages.
* **Security Recommendation:**
  * WhatsApp must **SUPPLEMENT** SMS, not completely replace it.
  * WhatsApp OTP alone must **NEVER** be sufficient to reset transaction PINs or execute high-risk password recoveries without workforce/KYC step-up.

### 13.3 Multi-Channel Provider Architecture
The repository's `NotificationModule` should be extended to a provider-neutral `VerificationDeliveryService`:

```
                    ┌─────────────────────────────────┐
                    │  NotificationDispatcherService  │
                    └────────────────┬────────────────┘
                                     │
                   ┌─────────────────┴─────────────────┐
                   ▼                                   ▼
        ┌──────────────────────┐            ┌──────────────────────┐
        │  RobaseSmsProvider   │            │ WhatsAppCloudProvider │
        │ (Bearer robe_<hex>)  │            │  (Meta / Termii API) │
        └──────────────────────┘            └──────────────────────┘
```

### 13.4 Use Case Classification Matrix

| MFA / Verification Use Case | Security Risk Level | Recommended Channel Strategy | Recommended Scope |
|---|---|---|---|
| **Registration Phone Verification** | Medium | User chooses: SMS (Default) or WhatsApp | **POST-LAUNCH** |
| **Login MFA (New Device)** | Medium | User chooses: SMS or WhatsApp | **POST-LAUNCH** |
| **Wallet-to-Cash Withdrawal OTP** | High | **SMS Primary; WhatsApp as explicit user-initiated fallback** | **POST-LAUNCH** (V1: SMS) |
| **Transaction PIN Reset / Unlock** | Critical | **NEVER WhatsApp-only.** Multi-factor or workforce required | **WORKFORCE / KYC** |
| **Password Reset** | Critical | **NEVER WhatsApp-only.** Multi-factor or workforce required | **WORKFORCE / KYC** |
| **Transaction Receipts & Alerts** | Low | Highly recommended for user convenience | **POST-LAUNCH** |

---

## 14. Receipt Image Export Analysis (WhatsApp Sharing)

### 14.1 User Experience vs Security Evaluation
* **Commercial Reality:** Nigerian customers and merchants distrust plain-text receipts (which can be faked in Notes apps) and demand branded graphic receipts with status badges and transaction stamps for WhatsApp sharing.
* **Technical Implementation:**
  * Can be implemented using `react-native-view-shot` to capture the existing `AgentReceipt` React component into a PNG image and invoke `Share.share({ url: imageUri })`.
* **V1 Classification:** **MEDIUM V1 (Phase 3 Mobile Polish)**. Not an initial launch blocker because manual OS screenshotting is an established zero-code workaround.

---

## 15. Infrastructure Handoff Consistency Verification

Audit of `V1-AGENT-MOBILE-17-RELEASE-INFRASTRUCTURE-HANDOFF.md` against current code:
* **Redis Status:** Verified absent. All queues utilize Postgres `notification_deliveries` with `FOR UPDATE SKIP LOCKED`.
* **Worker Runtime:** Verified. `NotificationWorkerService` executes in-process when `NOTIFICATION_WORKER_ENABLED=true`.
* **Environment Schema:** All 26 variables match `src/config/environment.ts`.
* **Conclusion:** **INFRASTRUCTURE SPECIFICATION IS ACCURATE AND COMPLETE.**

---

## 16. Comprehensive Summary Tables

### VERIFIED CRITICAL V1 GAPS (Class A)
1. **GAP-A01:** Customer Mobile application is decoupled from backend API (calls raw UUIDs, sandbox deposits/withdrawals, lacks PIN).
2. **GAP-A02:** Customer registration produces `DRAFT` accounts with no password, wallet, or login pathway without manual admin intervention.
3. **GAP-A03:** In-memory idempotency key generation is volatile; app force-quit/relaunch during lost response creates double debits.
4. **GAP-A04:** Permanent account lockout on 5 failed PIN attempts with zero admin unlock endpoint or tool.

### VERIFIED HIGH V1 GAPS (Class B)
1. **GAP-B01:** Zero agent commission payout (`commissionNone()` hardcoded across all flows).
2. **GAP-B02:** Missing customer SMS notifications on Cash-In (C2W) and Cash-Out (W2C).
3. **GAP-B03:** Agent transaction receipts cannot be loaded by ID upon app cache eviction.
4. **GAP-B04:** Customer Mobile application has zero support ticket or dispute UI.

### DECISIONS REQUIRED (Class G)
1. **DEC-01 (PIN on Agent Device):** **RESOLVED / ACCEPTED** for V1 (terminal model analogous to Nigerian POS).
2. **DEC-02 (Expired C2C Refund):** Clarify whether expired transit funds credit originating Agent float or require sender voucher claim.
3. **DEC-03 (Commission Payout Model):** Choose between instant float netting vs nightly batch accrual for agent commissions.

### ITEMS ALREADY SOLVED (Class F)
1. **Double-Entry Ledger Invariants:** Mathematical conservation verified across all journal postings.
2. **Public Transaction References:** Stable, deterministic, human-readable references implemented across all flows.
3. **Customer PIN Confidentiality on Terminal:** Masked inputs, zero logging, zero storage, transaction binding verified.
4. **Agent Mobile Core UI:** 232 automated tests passing; complete feature coverage for agent operations.

### V2 / EXCLUDED ITEMS (Class E)
1. Direct NIBSS NIP Outbound Bank Settlements.
2. Physical & Virtual Debit Cards.
3. Foreign Currency / USD Wallets.
4. Utility Bill Payments (Airtime, Data, Power, Cable).
5. Biometric Authentication (FaceID / Fingerprint).
6. Native Push Notification Infrastructure (APNs / FCM).

---

## 17. TOP 10 REMAINING UNKNOWN RISKS

1. **The Registration "DRAFT" Deadlock:** 100% of newly registered users will be unable to log in because the registration front-door does not set passwords or provision wallets.
2. **The App-Kill Double-Debit Hazard:** An agent restarting their phone during a timed-out ₦100,000 cash-in will lose the idempotency key and double-debit their float upon re-entry.
3. **The Irreversible PIN Lockout Trap:** Honest users mistyping their PIN 5 times will be permanently locked out with no admin unlock route existing in the codebase.
4. **The Agent Commission Rebellion:** Agents discovering ₦0.00 commission credited after a full day of float operations will instantly boycott the app.
5. **The Missing Cash-In SMS Distrust:** Customers handing physical cash to agents will refuse to leave kiosks without an instant SMS credit alert.
6. **The Unusable UUID Customer Send Screen:** Customers attempting to send money will be blocked by a form requiring 36-character database UUIDs instead of phone numbers.
7. **The Evicted Receipt Black Hole:** Agents attempting to show receipts for older transactions after app reload will be blocked by missing backend detail endpoints.
8. **The WhatsApp Text Receipt Rejection:** Counterparties will reject plain text messages as easily forged text and demand visual stamped slips.
9. **The Unaudited Agent Float Drift:** Nightly automated reconciliation will report green while ignoring agent funding pool and Cash-to-Cash escrow drift.
10. **The Telco SMS Outage Nightmare:** Heavy reliance on single-provider SMS without a WhatsApp fallback will cause onboarding stalls during carrier outages.

---

## 18. Dependency-Aware Implementation Sequence

```
========================================================================================
                          DEPENDENCY-AWARE ROADMAP
========================================================================================

PHASE 1: FOUNDATION & BACKEND CRITICAL GAPS (Prerequisite for Mobile)
  ├── 1.1: Customer Self-Service Registration & Wallet Binding (GAP-A02)
  │        [Files: src/customer-registration/, src/customer-authentication/]
  ├── 1.2: Workforce PIN Unlock Endpoints (GAP-A04)
  │        [Files: src/admin/admin-agent-credentials.controller.ts, admin-customer-credentials.controller.ts]
  ├── 1.3: Cash-In & Cash-Out Customer SMS Notifications (GAP-B02)
  │        [Files: src/notification/notification-event-map.ts, src/agent/agent-cash-in.service.ts]
  └── 1.4: Transaction Detail Endpoints for Receipts (GAP-B03)
           [Files: src/agent/agent-transaction-history.service.ts, src/customer-app/]

PHASE 2: CUSTOMER MOBILE ALIGNMENT (Requires Phase 1 Backend)
  ├── 2.1: Customer Mobile API Client & Session Store Modernization (GAP-A01)
  │        [Files: apps/customer-mobile/src/services/api-client.ts, src/store/auth-store.ts]
  ├── 2.2: Customer Registration & Phone OTP Verification UI (GAP-A01, GAP-A02)
  │        [Files: apps/customer-mobile/src/screens/unauthenticated/RegistrationScreen.tsx]
  ├── 2.3: Customer Transaction PIN Setup & Manage Screens (GAP-A01)
  │        [Files: apps/customer-mobile/src/screens/authenticated/pin/]
  ├── 2.4: Phone-Based Send Money & PIN Authorization Screen (GAP-A01)
  │        [Files: apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx]
  ├── 2.5: Cash-to-Cash Claim Screen & Receipt Viewing (GAP-A01)
  │        [Files: apps/customer-mobile/src/screens/authenticated/cash-claim/]
  └── 2.6: Customer Support Ticket Creation & Messaging UI (GAP-B04)
           [Files: apps/customer-mobile/src/screens/authenticated/support/]

PHASE 3: FINANCIAL SAFETY & OPERATIONAL HARDENING
  ├── 3.1: Persistent In-Flight Idempotency Key Storage (GAP-A03)
  │        [Files: apps/agent-mobile/src/utils/format.ts, apps/customer-mobile/]
  ├── 3.2: Automated Reconciliation for Agent Float & C2C Transit (GAP-C02)
  │        [Files: src/reconciliation/reconciliation.service.ts]
  └── 3.3: Agent Commission Netting / Accrual Execution (GAP-B01 / DEC-03)
           [Files: src/commission/, src/agent/agent-financial-execution.service.ts]

PHASE 4: POST-LAUNCH ENHANCEMENTS
  ├── 4.1: Receipt PNG Graphic Image Export via react-native-view-shot (GAP-C01)
  └── 4.2: WhatsApp Verification & MFA Delivery Provider Integration (Sections 13-17)
========================================================================================
```
