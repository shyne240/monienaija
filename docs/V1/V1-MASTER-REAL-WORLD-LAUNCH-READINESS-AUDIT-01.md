# V1-MASTER-03: Real-World V1 Launch Readiness & Unknown-Gaps Adversarial Audit

**Date:** 2026-10-02  
**Audit Boundary:** Entire MonieNaija V1 System (Backend, Agent Mobile, Customer Mobile, Admin Web, Infrastructure, Operations)  
**Branch:** `arena/01a0fcf7-monienaija`  
**HEAD Commit:** `c7bc3b04d33465f31df5748066b3b46e177c47e2`  
**Classification Discipline:** Multi-Perspective Adversarial Audit (Product Owner, Nigerian Wallet User, Agent, Support, Finance/Reconciliation, Security, Ops)  

---

## 1. Executive Summary

This document performs an exhaustive, adversarial product-readiness audit of the MonieNaija V1 system. While recent milestones successfully established backend core ledger invariants, 81 TypeORM migrations, and a mature Agent Mobile interface (232/232 passing tests), evaluating the system from the perspective of real Nigerian market participants reveals critical architectural, operational, and user experience gaps that would lead to immediate failure if launched to real users tomorrow.

### High-Level Summary of Findings
1. **Customer Mobile Disconnect:** While Agent Mobile is mature, Customer Mobile (`apps/customer-mobile`) remains an early sandbox prototype that requires raw 36-character UUIDs for transfers, calls legacy sandbox deposit/withdrawal mock endpoints, and lacks PIN setup, support, receipts, or Cash-to-Cash claiming.
2. **Customer Onboarding Deadlock:** Public registration creates a `DRAFT` customer with no password and no wallet. Zero self-service activation or credential creation exists; every user requires manual workforce intervention to be activated and issued a temporary password.
3. **Double-Debit Risk on App Relaunch:** Client-side idempotency keys are generated in volatile React state (`useState`). If a transaction times out and the user force-quits the app, the key is lost; re-entering the transaction creates a new key and double-debits the account.
4. **Permanent PIN Lockout:** No admin or self-service unlock workflow exists for locked transaction PINs (`failedCount >= 5`), permanently bricking accounts from transacting.
5. **Zero Agent Commission Payouts:** Commission calculations remain decoupled from financial execution (`commissionNone()` in all flows), meaning Agents earn ₦0.00 for all daily transactions.
6. **Notification Blindspots:** No SMS notifications are emitted for Cash-to-Wallet (Cash-In) or Wallet-to-Cash (Cash-Out), leaving customers with zero instant proof of electronic credit or debit.
7. **Incomplete Financial Reconciliation:** The automated reconciliation engine does not verify Agent Funding Pools, Cash-to-Cash escrow/transit accounts, or commercial fee/commission ledgers.

---

## 2. Current Repository State & Subsystem Inventory

### 2.1 Git & Source State
* **Branch:** `arena/01a0fcf7-monienaija`
* **HEAD:** `c7bc3b04d33465f31df5748066b3b46e177c47e2`
* **Working Tree:** Clean
* **Automated Tests:** 232 / 232 PASS (`apps/agent-mobile/__tests__/`)
* **TypeScript & NestJS Build:** Clean compilation (`dist/`)

### 2.2 Subsystem Implementation Classification

| Subsystem | Location | Implementation Status | Real-World State |
|---|---|---|---|
| **Agent Mobile App** | `apps/agent-mobile/` | **A. Actually Implemented** | Feature-complete for V1 Agent operations (Login, C2W, W2C, C2C, CLM, PIN, History, Support, Rotate Credential). |
| **Customer Mobile App** | `apps/customer-mobile/` | **B. Partially Implemented** / **D. Mobile/UI Missing** | Prototype state. Calls legacy endpoints (`/transfers`, `/deposits`, `/withdrawals`), lacks PIN, phone lookup, receipts, support. |
| **Admin Web App** | `apps/admin-web/` | **B. Partially Implemented** | Directory, reconciliation, and transaction observability implemented; lacks customer PIN unlock and agent float adjustment tools. |
| **Backend API Surface** | `src/` | **A. Actually Implemented** | Full Fastify/NestJS REST surface across customer, agent, admin, support, notification, and commercial rules. |
| **Database & Migrations**| `src/migrations/` | **A. Actually Implemented** | 81 TypeORM migrations sequential and isolated. PostgreSQL 16+ required. |
| **Ledger & Accounting** | `src/ledger/` | **A. Actually Implemented** | Immutable double-entry ledger with atomic journal entries across all core movements. |
| **Commercial Fees** | `src/fee-rules/` | **A. Actually Implemented** | Pure BigInt minor-unit fee calculator; journals remain principal-only awaiting fee revenue account provisioning. |
| **Agent Commissions** | `src/commission/` | **C. Backend-Only** | Decision engine implemented; explicitly decoupled from financial flows (all flows emit `NONE`). |
| **Limit Enforcement** | `src/limit-catalog/` | **A. Actually Implemented** | Multi-dimensional limits (per-tx, daily, monthly, velocity) evaluated within transaction managers. |
| **SMS Notifications** | `src/notification/` | **F. Environment Dependency** | Robase adapter and in-process Postgres outbox worker implemented; blocked on `ROBASE_API_KEY`. |
| **Support & Disputes** | `src/support/` | **A. Actually Implemented (Backend)** | Multi-channel ticket system with categories, messages, and internal notes. UI present in Agent Mobile only. |

---

## 3. Critical V1 Gaps (Class A — Must Address Before Launch)

### GAP-A01: Customer Mobile App Disconnected from Production V1 Backend
* **Evidence:** `apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx`, `WithdrawScreen.tsx`, `FundWalletScreen.tsx`.
* **Real-World Scenario:** A customer downloads the app, tries to send money to a friend's phone number, but the screen prompts: `Recipient Wallet ID (UUID)` (e.g. `5e6f7g8h-...`). Tapping Withdraw or Fund Wallet triggers mock "Sandbox Simulated Outflow" banners.
* **Why It Matters:** The mobile application cannot be used by real humans. Nigerian users identify accounts by phone number or NUBAN, never by database UUID.
* **Current Behavior:** Calls raw `/transfers` with UUIDs; calls mock `/deposits` and `/withdrawals`.
* **Required V1 Behavior:**
  1. `SendMoneyScreen` must call `GET /customers/me/recipient?identifier=<phone>` to resolve recipient name, then execute `POST /customers/me/transfers` with recipient phone, amount, and customer transaction PIN.
  2. Implement Cash-to-Cash Claim screen (`POST /customers/me/cash-to-cash/claim`) so customers can claim money directly into their wallet.
  3. Replace sandbox Deposit/Withdraw screens with proper V1 instructions (e.g. "Visit an authorized MonieNaija Agent to deposit/withdraw cash").
* **Required Work:** Mobile Engineering (`apps/customer-mobile`).

### GAP-A02: Customer Registration Deadlock (No Self-Service Password or Wallet Provisioning)
* **Evidence:** `src/customer-registration/customer-registration.controller.ts` vs `src/admin/admin-customer-credentials.controller.ts`.
* **Real-World Scenario:** 1,000 customers download MonieNaija, enter their phone number, receive and verify OTP. The backend creates a `DRAFT` customer. The customers cannot set a password, cannot log in, and receive no further instructions.
* **Why It Matters:** Zero customers can onboard without manual administrative intervention. An operator must manually query the database or admin panel, activate the customer, and click "Issue Temporary Password" for each user.
* **Current Behavior:** `CustomerRegistrationService.completeRegistration` creates only a `DRAFT` customer and verified phone record. No credentials or active wallets are provisioned.
* **Required V1 Behavior:** Provide an automated V1 Tier-0/Tier-1 self-onboarding pathway where verifying the phone challenge allows the user to immediately set their login password, provisions their primary NGN wallet, activates the customer, and issues an active login session.
* **Required Work:** Backend (`src/customer-registration/`) & Mobile (`apps/customer-mobile/`).

### GAP-A03: In-Memory Idempotency Destruction Leading to Double Debits on App Relaunch
* **Evidence:** `apps/agent-mobile/src/screens/authenticated/cash-in/CashToWalletConfirmScreen.tsx`, `apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx`.
* **Real-World Scenario:** An Agent executes a ₦50,000 Cash-to-Wallet transaction. The network drops after the server commits the transaction. The agent sees a spinner/timeout, panics, force-kills the app, and reopens it. The in-memory `idempotencyKey` is destroyed. The agent enters ₦50,000 again with a newly generated idempotency key. The backend processes it as a fresh transaction, debiting the Agent float a second time (₦100,000 total debited).
* **Why It Matters:** Financial loss and severe dispute between Agent, Customer, and Platform.
* **Current Behavior:** Idempotency keys are generated in React `useState` / `useEffect` and lost upon unmount or app restart.
* **Required V1 Behavior:**
  1. Persist in-flight transaction idempotency keys in `AsyncStorage` / `SecureStorage` with transaction parameters.
  2. Before initiating a new transaction to the same recipient and amount within 5 minutes, warn the user and check recent transaction history or re-submit the persisted idempotency key.
* **Required Work:** Mobile Engineering (`apps/agent-mobile`, `apps/customer-mobile`).

### GAP-A04: Permanent Account Lockout on PIN Failure (No Admin or Self-Service Unlock)
* **Evidence:** `src/agent-authentication/agent-authentication.service.ts` line 400, `src/customer/customer-transaction-pin.service.ts`, `src/admin/admin-agent-credentials.controller.ts`.
* **Real-World Scenario:** An Agent or Customer enters the wrong transaction PIN 5 times. The backend sets `accountLocked = true`. The user calls customer support. Support finds that there is no endpoint or tool in the admin panel to unlock the PIN.
* **Why It Matters:** Users are permanently locked out of all financial transactions. The only remediation is manual SQL execution in production.
* **Current Behavior:** `pin.accountLocked = true` permanently denies PIN verification. No admin unlock endpoint exists in `AdminAgentCredentialsController` or `AdminCustomerCredentialsController`.
* **Required V1 Behavior:**
  1. Create workforce endpoints `POST /internal/admin/agents/:id/pin/unlock` and `POST /internal/admin/customers/:id/pin/unlock`.
  2. Create support ticket escalation workflow for PIN reset/unlock.
* **Required Work:** Backend (`src/admin/`, `src/agent-authentication/`, `src/customer/`) & Admin Web.

---

## 4. High V1 Gaps (Class B — Strongly Needed for Credible V1 Launch)

### GAP-B01: Zero Commission Payout to Agents
* **Evidence:** `src/commission/commission.engine.ts` line 24 ("every V1 flow still records commission status NONE via commissionNone()").
* **Real-World Scenario:** An Agent performs 50 Cash-In and Cash-Out transactions during a hot business day in Lagos. At the end of the day, the Agent checks their earnings: Total Commission Earned = ₦0.00. The Agent shuts down the app and returns to their previous POS terminal.
* **Why It Matters:** Nigerian agency banking is entirely driven by transaction commissions. Zero commission guarantees immediate agent abandonment.
* **Current Behavior:** Backend calculates commercial decisions but emits `commissionNone()` for ledger execution.
* **Required V1 Behavior:** Provide a clear V1 operational policy: either wire instant commission float crediting for completed Cash-In/Cash-Out/C2C initiation, or document an automated end-of-day batch settlement schedule so agents know when and how their commission will be credited.
* **Required Work:** Product Policy, Backend (`src/commission/`, `src/agent/`).

### GAP-B02: Missing Cash-In & Cash-Out Customer SMS Notifications
* **Evidence:** `src/notification/notification-event-map.ts` (Catalogue excludes `CASH_IN` and `CASH_OUT` events from intent mapping).
* **Real-World Scenario:** A customer hands ₦20,000 physical cash to an Agent. The Agent taps "Credit Wallet". The customer stands waiting for an SMS alert on their phone. No SMS arrives because no notification intent is mapped for Cash-In. The customer refuses to leave the agent's stall, suspecting fraud.
* **Why It Matters:** In cash-dominant markets, the instant SMS receipt is the primary customer trust mechanism.
* **Current Behavior:** Only internal wallet-to-wallet transfers (`transfer.completed`) and funding requests trigger SMS intents.
* **Required V1 Behavior:** Map `agent.cash_in` and `agent.cash_out` to instant SMS notifications delivering principal amount, agent name/location, and short reference to the customer's verified phone.
* **Required Work:** Backend (`src/notification/notification-event-map.ts`).

### GAP-B03: Agent History Receipt Unavailability on Cache Eviction
* **Evidence:** `apps/agent-mobile/src/screens/authenticated/TransactionReceiptScreen.tsx` line 26 ("NO detail endpoint exists by design... The row is looked up in the TanStack query cache... If the row isn't in cache... 'This receipt is not loaded'").
* **Real-World Scenario:** An Agent opens their app to show proof of a transaction completed yesterday to a disputing customer. The app reloaded, so memory cache is empty. The Agent navigates from an external notification or filtered search: the receipt screen displays "This receipt is not loaded. Open it from your transaction history."
* **Why It Matters:** Agents cannot reliably produce receipts upon request for past transactions.
* **Current Behavior:** Receipt screen strictly depends on cached list items; no server query by transaction ID exists for agents.
* **Required V1 Behavior:** Implement `GET /agents/me/transactions/:id` on the backend and use it as a fallback in `TransactionReceiptScreen.tsx` when query cache is missing.
* **Required Work:** Backend (`src/agent/agent-transaction-history.service.ts`) & Mobile (`apps/agent-mobile`).

### GAP-B04: Customer Mobile Lacks In-App Support & Dispute Ticketing
* **Evidence:** `apps/customer-mobile/src/screens/` (No support screens or contact buttons).
* **Real-World Scenario:** A customer experiences a failed transfer where funds were deducted. The customer looks for "Help", "Support", or "Report an Issue" in `apps/customer-mobile` and finds nothing.
* **Why It Matters:** Forces all customer disputes to unmanaged public channels or app store reviews.
* **Current Behavior:** Backend has full customer support API (`POST /customers/me/support-tickets`), but `apps/customer-mobile` has zero UI.
* **Required V1 Behavior:** Port `SupportScreen`, `CreateTicketScreen`, and `TicketDetailScreen` from `apps/agent-mobile` to `apps/customer-mobile`.
* **Required Work:** Mobile Engineering (`apps/customer-mobile`).

---

## 5. Medium V1 Gaps (Class C — Important with Known Workaround)

### GAP-C01: Lack of Visual Image / PDF Receipt Export for WhatsApp Sharing
* **Evidence:** `apps/agent-mobile/src/components/AgentReceipt.tsx` line 200 (`Share.share({ message: receipt.shareText })`).
* **Real-World Scenario:** An Agent finishes a Cash-to-Cash transfer. The customer asks: "Send me the receipt on WhatsApp so I can forward it to my brother in Kano." The Agent shares text: `MoneyNaija — Agent Receipt\nCash→Cash Receipt\nStatus: COMPLETED...`. The brother in Kano rejects the text message, demanding a real branded graphic slip.
* **Why It Matters:** Nigerian financial transactions rely heavily on visual receipt image sharing. Text receipts are easily faked and widely distrusted.
* **Workaround:** Agents can take a screenshot of the `AgentReceipt` card.
* **Required V1 / Post-V1 Behavior:** Integrate `react-native-view-shot` to capture the receipt Card as a branded PNG and share via system share sheet.
* **Required Work:** Mobile Engineering (`apps/agent-mobile`, `apps/customer-mobile`).

### GAP-C02: Automated Financial Reconciliation Omits Agent Float & Escrow Accounts
* **Evidence:** `src/reconciliation/reconciliation.service.ts` line 40.
* **Real-World Scenario:** Finance team runs nightly reconciliation (`POST /internal/reconciliation/run`). The report returns `PASS`. However, an Agent funding pool had an orphaned balance discrepancy of ₦500,000, and ₦2,000,000 in expired Cash-to-Cash transit funds were never returned to sender floats. The reconciliation report did not catch either issue.
* **Why It Matters:** Silent ledger drift in agent float accounts and escrow transit ledgers.
* **Workaround:** Finance must run manual SQL queries against `agent_funding_pool` and `cash_to_cash_transfers`.
* **Required V1 Behavior:** Add automated reconciliation checks:
  1. `agent_funding_pool_balances_ledger_derived` (Agent pool electronic balance vs ledger account).
  2. `cash_to_cash_transit_integrity` (Active + Expired + Claimed transfer sums vs Transit ledger).
* **Required Work:** Backend (`src/reconciliation/`).

---

## 6. Decision-Required Items (Class G)

### DEC-01: W2C Customer Authorization Mechanism on Agent Hardware
* **Issue:** In `apps/agent-mobile/src/screens/authenticated/cash-out/WalletToCashOtpScreen.tsx`, the current flow requires the Customer to physically type their 4-digit secret Transaction PIN into the Agent's personal Android device.
* **Risk:** Severe PIN theft / shoulder surfing risk. Customers in Nigeria are trained never to type their PIN on an agent's personal phone.
* **Product Options:**
  * Option A (Current): Customer enters PIN on Agent device (simplest for V1, requires customer trust).
  * Option B (SMS OTP): Backend sends a one-time 6-digit withdrawal authorization OTP to the customer's phone; customer reads the OTP to the agent.
  * Option C (Customer App Authorization): Agent initiates request; customer receives in-app approval prompt on their own phone.
* **Owner:** Product Owner / Security Lead.

### DEC-02: Cash-to-Cash Expiry Refund Destination
* **Issue:** When a Cash-to-Cash transfer expires after 7 days (`CASH_TO_CASH_EXPIRY_SECONDS=604800`) without being claimed, funds are released from the Transit ledger account.
* **Risk:** The sender may have deposited physical cash at Agent A. Does the refund automatically credit Agent A's float (with an obligation for Agent A to give cash back to the sender), or does it require the sender to visit any MonieNaija agent with their transfer reference?
* **Owner:** Finance / Operations Lead.

---

## 7. Customer Mobile Deep-Dive Audit

| Feature Area | Current State in `apps/customer-mobile` | Gap Severity | Action Required |
|---|---|---|---|
| **Authentication & Login** | Implemented (`LoginScreen.tsx` calls `POST /customers/login`). | Low | Works if credentials exist. |
| **Phone Verification** | Missing OTP verify screen (`RegistrationScreen` has mock inputs). | **CRITICAL** | Implement OTP request & verify flow (`/customers/registration/otp`). |
| **Password Setup / Rotation** | Missing password set & rotate screens. | **CRITICAL** | Implement `RotateCredentialScreen` (`/customers/credentials/rotate`). |
| **Transaction PIN Setup** | Missing completely. | **CRITICAL** | Implement `SetTransactionPinScreen` (`/customers/me/transaction-pin`). |
| **Recipient Lookup** | Missing. Asks for raw UUID. | **CRITICAL** | Call `GET /customers/me/recipient?identifier=<phone>`. |
| **Wallet-to-Wallet Transfer**| Calls raw `/transfers` without PIN. | **CRITICAL** | Call `POST /customers/me/transfers` with PIN & resolved phone. |
| **Cash-to-Cash Claim** | Missing completely. | **HIGH** | Implement `CashToCashClaimScreen` (`/customers/me/cash-to-cash/claim`). |
| **Funding & Withdrawal** | Calls legacy sandbox `/deposits` and `/withdrawals`. | **CRITICAL** | Replace with real V1 agent-assisted or funding request flows. |
| **Transaction Receipts** | Missing completely. | **HIGH** | Port `AgentReceipt` component to customer mobile. |
| **Support & Disputes** | Missing completely. | **HIGH** | Port Support screens to customer mobile. |

---

## 8. Agent Mobile Deep-Dive Audit

| Feature Area | Current State in `apps/agent-mobile` | Gap Severity | Action Required |
|---|---|---|---|
| **Authentication & MFA** | Fully verified (232 tests pass). | None | Ready. |
| **Cash-to-Wallet (C2W)** | Fully verified with phone resolution & PIN. | Low | Add in-flight idempotency persistence across app kills. |
| **Wallet-to-Cash (W2C)** | Fully verified with customer PIN authorization. | Low | Resolve Decision DEC-01 (PIN vs OTP). |
| **Cash-to-Cash (C2C)** | Fully verified with 8-digit claim code generation. | Low | Ready. |
| **C2C Claim Assist** | Fully verified with claim code & phone check. | None | Ready. |
| **PIN Management** | Implemented (Set & Verify PIN). | **CRITICAL** | Implement unlock handling when `accountLocked=true`. |
| **Receipts** | Text share implemented. | **MEDIUM** | Add image capture export (GAP-C01); add backend detail endpoint (GAP-B03). |
| **Support** | Ticket creation, list, and details implemented. | None | Ready. |

---

## 9. Transaction & Lost-Response Recovery Audit

### 9.1 The Lost-Response Timeline
```
[Agent Device] ───────── POST /agents/me/cash-in ─────────► [Backend API]
                                                                  │
                                                        [DB: Commit Tx]
                                                        Float Debited: -₦50,000
                                                        Wallet Credited: +₦50,000
                                                                  │
[Agent Device] ◄─────── (Network Drops / Timeout) ──────── ─ ─ ─ ─┘
     │
[UI Shows: "Network Error. Please Retry"]
     │
[Scenario A: Agent presses Retry on same screen]
     └── Uses same in-memory idempotencyKey ──► Backend returns REPLAYED result. (SAFE)
     │
[Scenario B: Agent force-quits app, restarts, and re-enters transfer]
     └── Generates NEW idempotencyKey ────────► Backend debits another ₦50,000! (CATASTROPHIC)
```

### 9.2 Transaction Query & Disambiguation Deficiencies
* The Agent Mobile app currently has **no background outbox** or pending transaction reconciler.
* The backend does not expose a "Lookup by client hash/parameters" endpoint to verify if an unknown transaction completed before issuing a new one.

---

## 10. Receipts and Proof Audit

| Criterion | Customer App | Agent App | Real-World Evaluation |
|---|---|---|---|
| Immediate Post-Tx Proof | **NO** (Navigates to Home) | **YES** (Success Screen + Receipt Card) | Customer app fails completely; Agent app succeeds. |
| Re-open from History | **NO** | **PARTIAL** (Works only if in TanStack cache) | Severe flaw if agent app reloads. |
| Unique Reference Display | **NO** | **YES** (Shows Reference & Operation ID) | Agent receipt contains stable references. |
| Fee & Commission Breakdown| **NO** | **YES** (Shows Fee & Principal) | Transparent on Agent side. |
| Image Export (WhatsApp) | **NO** | **NO** (Text-only share) | Sub-optimal for Nigerian commercial culture. |

---

## 11. Support and Dispute Investigation Audit

### 11.1 Support Identifier Availability
When an Agent or Customer creates a support ticket:
* Backend schema (`support_tickets` in `src/support/support-ticket.entity.ts`) supports: `relatedTransferId`, `fundingRequestId`, `category`, `priority`, `subject`, `description`.
* **Investigation Gap:** The support system does **not** automatically link the `journalId` or ledger entry to the support ticket. Support officers must manually copy the `relatedTransferId` and query the raw database or `admin-customer.controller.ts` transaction logs to locate corresponding ledger journals.

---

## 12. Operations & Reconciliation Audit

### 12.1 Financial Accounting Health Check
* Double-entry bookkeeping is mathematically sound across existing journal lines (Debits == Credits).
* **Missing Observability:** No administrative dashboard view exists for:
  1. Unclaimed Cash-to-Cash escrow liability balance.
  2. Total agent electronic float across all active agents vs platform bank holding account.
  3. Cumulative fee revenue awaiting provisioning.

---

## 13. Agent Commission Reality Audit

| Dimension | Architectural State | Real-World Agent Experience |
|---|---|---|
| **Commission Calculation** | Fully implemented in `CommissionCalculator` (`src/commission/`). | Mathematical rules exist in code. |
| **Transaction Execution** | All flows emit `commissionNone()`. | **Agent receives ₦0.00.** |
| **Float Balance Impact** | Float is debited full principal; no commission added. | Agent loses money on operations. |
| **Commission Reporting** | Unified history reports `item.commission = null`. | Agent sees zero earnings history. |

---

## 14. Limits, Risk & Security Audit

* **Enforced Controls:**
  * Daily, monthly, and per-transaction limits enforced inside database transactions (`LimitEnforcementService`).
  * PIN failure lockout after 5 consecutive failed attempts.
  * Idempotency replay protection within 24 hours.
* **Security Strengths:**
  * PINs and passwords hashed with PBKDF2 / Argon2; never logged, returned, or persisted in plaintext.
  * Audit logs record previous and new values with sensitive credential redaction.
* **Security Gaps:**
  * No rate limiting on public PIN verification endpoints beyond account lockout.
  * Workforce temporary passwords have 72-hour lifetime (recommend reducing to 24 hours for security).

---

## 15. Account & Device Recovery Audit

| Failure Scenario | Agent Recovery Path | Customer Recovery Path | Real-World Evaluation |
|---|---|---|---|
| **Forgotten Password** | Contact Admin → Admin issues temporary password via internal API. | Contact Admin → Admin issues temporary password via SMS. | Operational bottleneck; no customer self-service password reset. |
| **Locked PIN** | **NO PATH EXISTS** (Permanent Lockout). | **NO PATH EXISTS** (Permanent Lockout). | **CRITICAL FLAW**. |
| **Lost Phone / New Device** | Reinstall app → Log in with phone & password → MFA challenge. | Reinstall app → Log in with phone & password. | Functional if credentials remembered. |
| **Session Expiry** | 401 triggers token refresh; fallback to Login screen. | 401 removes token and navigates to Login. | Handled gracefully. |

---

## 16. Communications & Notification Audit

| Critical Event | Customer Notification | Agent Notification | Regulatory / UX Impact |
|---|---|---|---|
| **Cash-In (C2W)** | **NONE** (Omitted from map) | In-app screen only | **HIGH RISK** — Customer has no proof of credit. |
| **Cash-Out (W2C)** | **NONE** (Omitted from map) | In-app screen only | **HIGH RISK** — Customer has no proof of debit. |
| **Transfer Completed** | SMS to Sender & Receiver | N/A | Functional. |
| **C2C Code Generation** | SMS to Beneficiary Phone | In-app screen only | Functional. |
| **Account Suspension** | **NONE** | **NONE** (Phone model missing) | User discovers lockout only upon next login attempt. |

---

## 17. Real-World Cash Operations Stress-Test

1. **Cash Mismatch at Counter:**
   * Customer gives ₦10,000 cash; Agent mistakenly types ₦1,000 and credits wallet.
   * Customer walks away before agent notices.
   * **Result:** Agent has excess physical cash, customer is under-credited. The app provides no "Amend / Top-up" shortcut.
2. **Delayed Customer PIN in Queue:**
   * Agent initiates Wallet-to-Cash; hands phone to customer for PIN.
   * Customer hesitates, forgets PIN, or leaves device hanging.
   * **Result:** Agent's app is locked in modal state; agent cannot serve the next customer until modal is dismissed or times out.

---

## 18. Infrastructure Handoff Consistency Verification

Audit of `V1-AGENT-MOBILE-17-RELEASE-INFRASTRUCTURE-HANDOFF.md`:
* **Redis Absence:** Verified accurate. Codebase uses Postgres outbox table `notification_deliveries` with `FOR UPDATE SKIP LOCKED`.
* **Worker Execution:** Verified accurate. `NotificationWorkerService` runs in-process inside NestJS upon setting `NOTIFICATION_WORKER_ENABLED=true`.
* **Staging Host & DNS:** Host `staging-api.monienaija.ng` returns `ENOTFOUND` as documented. DNS and SSL configuration instructions are exact and complete.
* **Environment Variables:** All 26 environment variables in the handoff document match `src/config/environment.ts` schema and defaults.

---

## 19. V1 Scope Boundary & Non-Goals Confirmation

To prevent scope creep, the following remain strictly **OUT OF V1 SCOPE / V2 ONLY**:
* Direct NIBSS NIP Outbound Bank Transfers
* Physical Debit / Virtual Cards
* Foreign Currency (USD / FX) Wallets
* Utility Bill Payments (Airtime, Data, Power, Cable TV)
* Biometric Authentication (FaceID / Fingerprint)
* Native Push Notifications (APNs / FCM device-token infrastructure)
* Third-Party Merchant Checkout SDKs

---

## 20. Comprehensive Gap Inventory Table

| Priority | Gap Identifier & Description | Current Codebase State | Real-World Consequence | Required Before V1? | Subsystem Area |
|---|---|---|---|---|---|
| **A (CRITICAL)** | **GAP-A01: Customer Mobile Prototype Disconnect** | Calls raw UUID `/transfers`, sandbox mock `/deposits`, lacks PIN & receipts. | Customers cannot send money to phone numbers or use wallet. | **YES** | Mobile (`customer-mobile`) |
| **A (CRITICAL)** | **GAP-A02: Customer Registration Deadlock** | Creates `DRAFT` user; no self-service password or wallet creation. | 100% of registered customers locked out awaiting manual admin touch. | **YES** | Backend & Mobile |
| **A (CRITICAL)** | **GAP-A03: In-Memory Idempotency Loss** | Idempotency keys stored in volatile React component state. | Double-debiting of agent float or customer wallet on app relaunch. | **YES** | Mobile (`agent-mobile`, `customer-mobile`) |
| **A (CRITICAL)** | **GAP-A04: Permanent PIN Lockout** | `accountLocked=true` on 5 failed attempts; no admin unlock API. | Users permanently locked out of transactions forever. | **YES** | Backend & Admin Web |
| **B (HIGH)** | **GAP-B01: Zero Agent Commission Payout** | Commission calculations decoupled (`commissionNone()`). | Agents earn ₦0.00 and immediately abandon the platform. | **YES** | Product Policy & Backend |
| **B (HIGH)** | **GAP-B02: Missing Cash-In/Out Customer SMS** | No SMS intent mapped for `agent.cash_in` or `agent.cash_out`. | Customers receive zero proof of cash deposit or withdrawal. | **YES** | Backend (`notification`) |
| **B (HIGH)** | **GAP-B03: Agent History Receipt Cache Loss** | No `GET /agents/me/transactions/:id` endpoint. | Receipts cannot be viewed after app reload or query cache eviction. | **YES** | Backend & Mobile |
| **B (HIGH)** | **GAP-B04: Customer Mobile Missing Support UI** | No support ticket screens in `apps/customer-mobile`. | Customers have no in-app dispute resolution mechanism. | **YES** | Mobile (`customer-mobile`) |
| **C (MEDIUM)** | **GAP-C01: No Visual Receipt Image Export** | Text-only sharing via `Share.share`. | Text receipts distrusted/rejected by recipients on WhatsApp. | NO (Workaround: Screenshot) | Mobile |
| **C (MEDIUM)** | **GAP-C02: Reconciliation Omits Agent Float** | Reconciliation checks only customer wallets and transfers. | Undetected financial drift in agent float accounts. | NO (Workaround: Manual SQL) | Backend (`reconciliation`) |
| **G (DECISION)**| **DEC-01: W2C Customer PIN on Agent Device** | Customer enters PIN on agent's phone. | High risk of PIN theft and customer hesitation. | **YES** | Product / Security |
| **G (DECISION)**| **DEC-02: Expired C2C Transfer Refund Destination** | Funds return to transit account. | Unclear operational refund procedure for cash depositors. | **YES** | Operations / Finance |

---

## 21. THE 10 THINGS MOST LIKELY TO SURPRISE US AFTER LAUNCH

1. **The "Silent Sign-up" Avalanche:** Thousands of users will sign up, receive the registration SMS OTP, verify it successfully, and immediately hit a dead end because the system created them in `DRAFT` status with no password, no wallet, and no way to log in.
2. **The "App Restart" Double-Debit Disaster:** An agent experiencing network lag during a ₦100,000 cash-in will restart the app to clear the spinner, re-enter the transfer, and inadvertently debit their float twice because the volatile idempotency key was reset.
3. **The "Locked Out Forever" Support Crisis:** Hundreds of agents and customers who mistype their PIN 5 times will contact support, only for support agents to discover there is no button or API endpoint anywhere in the system to unlock their accounts.
4. **The Agent Strike Over ₦0.00 Commissions:** Agents will enthusiastically process cash transactions on day one, check their balance at night, find ₦0.00 in commissions credited, conclude they were scammed by MonieNaija, and refuse to open the app again.
5. **The Customer Stall Standoff:** Customers depositing physical cash at an agent kiosk will refuse to leave the kiosk because no SMS credit alert arrives on their phone, accusing the agent of pocketing their physical cash.
6. **The Unusable Customer Send Money Screen:** Customers opening the newly launched mobile app to send money will be baffled when asked to input a 36-character hexadecimal UUID string instead of their recipient's phone number.
7. **The Vanishing Past Receipts:** An agent trying to pull up a receipt from three days ago to resolve a customer dispute will be greeted with "This receipt is not loaded. Open it from your transaction history" because the query cache was evicted upon app restart.
8. **The WhatsApp Receipt Rejection:** When agents share transaction proofs via WhatsApp, counterparties will dismiss the plain text messages as easily forged text and refuse to release goods or cash without a visual stamped slip.
9. **The Unmonitored Float Drift:** Finance will review nightly green reconciliation checks and believe all ledgers are balanced, completely unaware that the reconciliation service does not audit Agent Funding Pools or Cash-to-Cash escrow transit accounts.
10. **The Customer PIN Privacy Revolt:** Customers withdrawing cash will refuse to type their secret banking PIN into an agent's greasy, unverified personal Android smartphone, stalling queue operations across agent locations.

---

## 22. Recommended Implementation Order

1. **Phase 1: Critical Customer & Security Blockers (Days 1–3)**
   - Fix Customer Registration to automatically create active credentials and primary wallet on phone verification (GAP-A02).
   - Implement workforce PIN unlock endpoints and admin web controls (GAP-A04).
   - Add persistent client-side idempotency storage to prevent double debits on app restart (GAP-A03).
2. **Phase 2: Customer Mobile Core Alignment (Days 4–7)**
   - Wire `SendMoneyScreen` to phone recipient resolver and customer PIN authorization (GAP-A01).
   - Port PIN setup, credential rotation, and support ticket screens to `apps/customer-mobile` (GAP-A01, GAP-B04).
   - Replace legacy sandbox mock screens with V1 cash-in/cash-out instructions.
3. **Phase 3: Operational & Notification Hardening (Days 8–10)**
   - Map `agent.cash_in` and `agent.cash_out` to instant customer SMS notifications (GAP-B02).
   - Implement `GET /agents/me/transactions/:id` detail endpoint for permanent receipt rendering (GAP-B03).
   - Clarify and implement Agent commission credit policy (GAP-B01).
   - Expand automated reconciliation to audit Agent Funding Pools and Cash-to-Cash transit accounts (GAP-C02).
