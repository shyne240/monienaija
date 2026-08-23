# MoneyNaija Roadmap & Governance Register

This file is the authoritative engineering execution, prioritization, and sequencing map for the MoneyNaija platform. Every future implementation task must consult this file first to verify boundary rules, expected deliverables, predecessor tasks, and forbidden scopes.

---

## PROJECT GOVERNANCE / LOCKED DIRECTIONS

The following directions represent the absolute architectural limits of the MoneyNaija platform and are locked against opportunistic modification:

1. **F1/F2 Preservation:** Task codes `F1` (Customer Mobile Foundation) and `F2` (Customer Mobile Functional Screens) represent completed customer-mobile history. These must **never** be renamed, reinterpreted, or altered.
2. **W-Series Active Priority:** Task code `W1` represents the **Admin Web Foundation**. Development of the Admin / Operations Web Portal is now the **highest active frontend priority**.
3. **Customer Mobile Frozen:** The Customer Mobile Application remains frozen at its current `F2` status. No further mobile screen, capability expansion, or feature addition is authorized merely because its frontend exists.
4. **Third-Party Integrations Frozen:** All NIBSS NIP, external payment processors, bank adapters, and virtual account provider integrations remain **strictly frozen and bypassed** via clean sandbox simulated completions. No production external partner credentials may be committed or deployed.
5. **B2F07 Parked:** Phase `B2F07` (Accounts Receivable and Invoice-Accounting Boundary) remains **strictly parked, untouched, and unstarted**.
6. **No Contract Inventions:** If a required back-office admin capability lacks an API/controller endpoint, the frontend **must not fabricate an endpoint or silently simulate production backend outcomes**. These must be reported explicitly as Backend API Gaps.
7. **Maximum Backend Reuse:** The Admin Web Portal must reuse existing and verified backend capabilities (such as standard double-entry ledger queries, KYC assessment commands, and A2 maker-checker workflows).
8. **Unique Task Codes:** Every future implementation, test expansion, or deployment task must have a unique, explicit roadmap code (such as `W1`, `W2`, etc.).
9. **Authoritative Reference:** Every future Arena task must consult this `roadmap.md` first before any source, test, or config file changes are made.
10. **Predecessor Invariance:** Completed tasks must never be reimplemented, refactored, or redesigned.
11. **Fail-Closed Stop:** Arena agents **MUST STOP** immediately and notify operators if a proposed task conflicts with this `roadmap.md` or any accepted ADR.
12. **NO NEXT CLIENT APPLICATION UNTIL THE CURRENT ADMIN/INTERNAL OPERATIONS MILESTONE PASSES HUMAN ACCEPTANCE TESTING.**
13. **ARENA AUTOMATED VERIFICATION IS A DEVELOPMENT QUALITY GATE. IT DOES NOT SUBSTITUTE FOR FINAL HUMAN ACCEPTANCE TESTING.**

---

## HUMAN ACCEPTANCE TESTING GATE

The final Admin milestone must stop before we move to the next client application. The sequence must be:

```text
Arena implementation
  -> Arena automated verification
  -> clean local commit
  -> STOP
  -> human acceptance testing
  -> defect correction if required
  -> milestone accepted
  -> authorize next client/application
```

No future Customer Mobile, Agent, Merchant, or third-party work may begin until this human verification gate is fully satisfied and formally approved.

---

## 1. Unified Sequence of Execution

MoneyNaija is an in-house mobile-money company. To operate the business entirely on our own database ledger infrastructure, development follows this authoritative maturity order:

```text
       CORE BANKING BACKEND (A1-A7, B1, B2F09-PRE)
                    ↓
  WORKFORCE / ADMIN AUTHENTICATION & AUTHORIZATION
                    ↓
      ADMIN / OPERATIONS WEB PORTAL (W-Series)
                    ↓
  IN-HOUSE CUSTOMER / AGENT / MERCHANT OPERATIONS
                    ↓
       TRANSACTION MONITORING + RECONCILIATION
                    ↓
        CUSTOMER MOBILE CHANNEL (F1/F2)
                    ↓
            AGENT / MERCHANT CHANNELS
                    ↓
 THIRD-PARTY BANK / NIBSS / PAYMENT RAIL INTEGRATIONS
```

---

## 2. Reconstructed Project State Map

The current execution status of every MoneyNaija segment is tracked below:

### A. Core Backend & Platforms
* **A1 (Identity):** **COMPLETE** — Canonical Customer identity models, conventions (`src/customer`).
* **A2 (Authorization):** **COMPLETE** — OIDC Workforce validation, workforce sessions, and maker-checker structures.
* **A3 (Customer Binding):** **COMPLETE** — Wallet-to-ledger mappings (`src/customer-wallet`, `src/wallet`).
* **A4 (Policy):** **COMPLETE** — Pilot restrictions and capability rules (`src/policy`, `src/limit`).
* **A5 (Ledger):** **COMPLETE** — Double-entry balanced posting, reversals (`src/ledger`).
* **A6 (External Partners):** **COMPLETE** — Callback ingestion, exception check constraints.
* **A7 (Product Layer):** **COMPLETE** — Product lifecycle commands (`src/policy/a7-*`).
* **B1 (Commercial Platform):** **COMPLETE** — Fees math, campaigns, catalogs (`src/policy/b1-*`, `src/fee`).
* **B2F09-PRE (Treatment Foundation):** **COMPLETE** — Provenance accounting treatments (`src/policy/b2f-*`).
* **B2 (Finance Platform):** **NOT STARTED** — Slated for future `B2F` planning.

### B. Admin / Operations Web Portal
* **W1 (Admin Web Foundation):** **COMPLETE** — boilerplate React Web shell, OIDC & Sandbox bootstrap authentication, localStorage token caching, and role-locked sidebar menus (Completed on 2026-08-23).
* **W2 (Admin Functional Modules):** **COMPLETE** — Customer search listings, detail cards view, status suspension updates, KYC assessment verifications, and primary NGN wallet provisioning (Completed on 2026-08-23).
* **W3 (Admin Functional Modules):** **COMPLETE** — Chart of Accounts, immutable double-entry journal logs, visual debits/credits auditing, and compensating reversals triggers (Completed on 2026-08-23).
* **W4 (Admin Functional Modules):** **COMPLETE** — In-house transaction observability, sandbox simulated completion triggers, and a read-only Fee Simulator (Completed on 2026-08-23).
* **W5+ (Admin Functional Modules):** **NOT STARTED** — Reserved for future back-office interfaces.

### C. Customer Mobile Channel
* **F1 (Customer Mobile Foundation):** **COMPLETE** — Native navigation, Zustand, API Client, design theme.
* **F2 (Customer Mobile Screens):** **COMPLETE** — Functional login, onboarding, sandbox deposits, transfers, and transactions history covered by 31 passing unit tests.

### D. Future Agent & Merchant Channels
* **Agent App:** **NOT STARTED** (Requires `B5` backend).
* **Merchant App:** **NOT STARTED** (Requires `B5` backend).

### E. Internal Operations & Reconciliation
* **Closed-Loop Lifecycles:** **COMPLETE** — Deposits, transfers, and withdrawals can be executed on PostgreSQL.
* **Administrative Cockpit:** **NOT STARTED** (Exposed on backend APIs, but requires the Admin Portal frontend).

### F. Third-Party Integrations
* **NIBSS NIP, Bank Integrations:** **FROZEN / BYPASSED** (Simulated cleanly inside internal ledger).

---

## 3. The W-Series Admin Portal Roadmap

To implement the back-office control plane cleanly, subsequent Admin Web tasks are partitioned as follows:

### W1 — Admin Web Foundation & Workforce Login (COMPLETE)
* **Purpose:** Establishes the boilerplate web shell, OIDC/Bootstrap login, principal store, and role-locked sidebars.
* **Backend APIs Consumed:** `POST /internal/a2/workforce/sessions`, `DELETE /internal/a2/workforce/sessions/:id`, `POST /internal/a2/workforce/bootstrap`, `POST /internal/a2/workforce/roles`, `DELETE /internal/a2/workforce/roles/:principalId/:roleKey`, `POST /internal/a2/workforce/approvals/:id/approve`.
* **Backend API Gaps:** Listing and reading approvals (`GET /approvals`).
* **Tests:** 9 assertions covering auth-store and navigation.

### W2 — Administrative Customer, KYC, & Wallet Management (COMPLETE)
* **Purpose:** Manage and service customer accounts, verifications, and wallets.
* **Backend APIs Consumed:** `POST /customers`, `GET /customers`, `GET /customers/:id`, `PATCH /customers/:id`, `POST /customers/:id/kyc-assessment`, `POST /customers/:id/wallets`, `GET /customers/:id/wallets`.
* **Backend API Gaps:** Advanced multi-status querying at the controller level.
* **Admin Web Functionality:** Search, view profiles, suspend users, verify KYC documents, provision primary NGN wallets.
* **Tests:** 4 comprehensive test suites covering validation, creation, kobo Naira mapping, and role restrictions.

### W3 — Ledger Operations, Audits, & Reversals (COMPLETE)
* **Purpose:** Monitor double-entry accounting entries, change logs, and execute reversals.
* **Backend APIs Consumed:** `GET /ledger/accounts`, `GET /ledger/journals/:id`, `POST /ledger/journals/:id/reversal`.
* **Backend API Gaps:** `GET /operations/audits` (operational audit viewer), `GET /operations/outbox` (dispatch event tracing), `GET /ledger/journals` (journals query listing).
* **Admin Web Functionality:** Ledger tree monitoring, double-entry journal posting lines tracing, manual reversal maker requests, and controller reversals triggers.
* **Tests:** 4 comprehensive test suites covering account loading, balance divisions, debit/credit tabular mappings, and role-locked overrides.
* **Blocks Completion Gate:** **YES**.

### W4 — In-House Transaction Observability & Sandbox Utilities (COMPLETE)
* **Purpose:** Track, calculate fees, and execute sandbox transactions.
* **Backend APIs Consumed:** `GET /deposits/:id`, `GET /withdrawals/:id`, `GET /transfers/:id`, `POST /fees/calculate`, `POST /deposits/:id/complete`, `POST /withdrawals/:id/complete`.
* **Backend API Gaps:** Persistent general fee config tables and CRUD endpoints (Calculations rules must be supplied in DTO), global transactions listing `/transfers` and `/deposits`.
* **Admin Web Functionality:** Tracking transaction status, running fee simulator calculations, manual sandbox adjustments triggers.
* **Tests:** 2 comprehensive test suites asserting dynamic fee calculations and sandbox completing triggers.
* **Blocks Completion Gate:** **YES**.

### W5 — Independent Reconciliation & Breaks Management (NOT STARTED)
* **Purpose:** Trigger matching runs and reconcile breaks.
* **Backend APIs Consumed:** `POST /reconciliation/runs`.
* **Backend API Gaps:** GET reconcile discrepancy matches detail and breaks reporting controller.
* **Admin Web Functionality:** Triggering matching runs, tracking logs.
* **Tests:** Run triggers verification.
* **Blocks Completion Gate:** **YES**.

---

## 4. Formal Admin Completion Gate

Before the **`ADMIN WEB / INTERNAL OPERATIONS COMPLETE`** milestone is formally signed off and accepted:
1. **Workforce Authentication:** OIDC and Sandbox Bootstrap tokens must log in operators cleanly and enforce sidebar permissions for `FINANCE_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, and `FINANCE_AUDITOR` roles.
2. **Customer Servicing:** Operators must be able to create, search, suspend, and view customer profiles.
3. **KYC Verification:** Operators must be able to approve/reject identity documents (`customer_kyc_assessments` populated).
4. **Wallet Provisioning:** Operators must be able to bind primary NGN accounts and view balances in Naira.
5. **Transaction Tracking:** Tracing deposits, transfers, and withdrawals must work.
6. **Ledger Auditing:** Tracing transactions to double-entry debit/credit lines must work.
7. **Reversals:** Manual reversals must execute via checker approvals.
8. **Reconciliation:** Independent matching runs must execute.
9. **All W1–W5 Gaps Resolved or Deferred:** All documented backend gaps must either be resolved by additive controller paths or formally deferred to post-MVP production phases.
10. **In-House Lifecycle Proved:** End-to-end sandbox money movements (Onboard -> Provision -> Fund -> P2P -> Withdraw) must operate flawlessly on the local PostgreSQL database.

---

## 5. W1 — Admin Web Foundation Implementation Record

* **Completed Date:** 2026-08-23
* **Files Created:**
  * `apps/admin-web/package.json` — React, TypeScript, and Jest configs.
  * `apps/admin-web/tsconfig.json` — Strict compiler checks.
  * `apps/admin-web/jest.config.js` — Test runner setups.
  * `apps/admin-web/src/config/index.ts` — API endpoints and DEV_AUTH_MOCK variables.
  * `apps/admin-web/src/services/api-client.ts` — Authentication headers and payload bindings.
  * `apps/admin-web/src/store/auth-store.ts` — Zustand store managing OIDC login, bootstrap Statement, session recovery, and logout.
  * `apps/admin-web/src/screens/unauthenticated/LoginScreen.tsx` — Login views with OIDC and Bootstrap.
  * `apps/admin-web/src/screens/authenticated/DashboardScreen.tsx` — Operator landing views and gaps reporting.
  * `apps/admin-web/src/screens/authenticated/ApprovalsScreen.tsx` — Direct approvals triggering.
  * `apps/admin-web/src/screens/authenticated/RoleAssignmentScreen.tsx` — Admin roles allocation.
  * `apps/admin-web/src/screens/authenticated/Layout.tsx` — Master sidebar shell and role-aware navigation.
  * `apps/admin-web/src/App.tsx` & `apps/admin-web/src/index.tsx` — App entrypoints.
* **Backend APIs Consumed:**
  * `POST /api/v1/internal/a2/workforce/sessions` — Workforce session establishment.
  * `DELETE /api/v1/internal/a2/workforce/sessions/:id` — Session revocation logout.
  * `POST /api/v1/internal/a2/workforce/bootstrap` — Sandbox bootstrap consumption.
  * `POST /api/v1/internal/a2/workforce/roles` — Role assignments.
  * `DELETE /api/v1/internal/a2/workforce/roles/:principalId/:roleKey` — Role revocations.
  * `POST /api/v1/internal/a2/workforce/approvals/:id/approve` — Checker signatures approval.
* **ADMIN API GAPS Discovered:**
  * **ADMIN API GAP 1:** `GET /internal/a2/workforce/approvals` list query is missing at controller level (prevents listing pending queues).
  * **ADMIN API GAP 2:** `GET /internal/a2/workforce/approvals/:id` detail view query is missing at controller level.
  * **ADMIN API GAP 3:** `GET /operations/audits` search query is missing at controller level (prevents reading operation audit trails).
  * **ADMIN API GAP 4:** `GET /operations/outbox` event search is missing.
* **Testing Scope:** Covered 9 comprehensive assertions over session lifecycles, and role-locked menu navigation (Fails closed on unauthorised views).
* **Next Authorized Task:** `W2` — Administrative Customer and Wallet Servicing.

---

## 6. W2 — Administrative Customer, KYC, & Wallet Management Implementation Record

* **Completed Date:** 2026-08-23
* **Files Created:**
  * `apps/admin-web/src/screens/authenticated/CustomerDirectoryScreen.tsx` — Functional search, KYC assessments, and NGN provisioning screen.
  * `apps/admin-web/__tests__/customer-servicing.test.tsx` — Test suites asserting listings, creations, status patch locks, and KYC DTOs.
* **Files Modified:**
  * `apps/admin-web/src/screens/authenticated/Layout.tsx` — Integrated sidebar mapping and dynamic views.
* **Backend APIs Consumed:**
  * `POST /customers` — Creates Customer profile references (individual segments).
  * `GET /customers` — List/search active customer directory records.
  * `GET /customers/:id` — Reads specific profile metadata details.
  * `PATCH /customers/:id` — Updates customer status (ACTIVE, SUSPENDED, CLOSED).
  * `POST /customers/:id/kyc-assessment` — Submits KYC assessment levels (NONE, LEVEL_1, LEVEL_2, LEVEL_3).
  * `POST /customers/:id/wallets` — Provisions primary/savings NGN kobo wallets.
  * `GET /customers/:id/wallets` — Retrieves active NGN wallet bindings.
* **ADMIN API Gaps Discovered:**
  * **ADMIN API GAP 5:** GET `/customers` advanced multi-status cross-matching query filters are unexposed at the controller query DTO level.
* **Testing Scope:** Covered 4 robust test suites asserting validation errors handling, Naira-to-kobo formatting divisions, and checker roles security.
* **Next Candidate Task:** `W3` — Ledger Operations, Audits, & Reversals.

---

## 7. W3 — Ledger Operations, Audits, & Reversals Implementation Record

* **Completed Date:** 2026-08-23
* **Files Created:**
  * `apps/admin-web/src/screens/authenticated/LedgerOperationsScreen.tsx` — Chart of accounts visual listing and compensating reversals screen.
  * `apps/admin-web/__tests__/ledger-operations.test.tsx` — Unit test assertions for accounts balance checks, debit/credit listings, and roles.
* **Files Modified:**
  * `apps/admin-web/src/screens/authenticated/Layout.tsx` — Integrated ledger sidebar tab.
  * `apps/admin-web/jest.config.js` — Enabled dual-resolutions root fallback paths.
* **Backend APIs Consumed:**
  * `GET /ledger/accounts` — Reads list of ledger accounts and balances.
  * `GET /ledger/journals/:id` — Audits a single double-entry journal.
  * `POST /ledger/journals/:id/reversal` — Posts compensating reversed journal entry.
* **ADMIN API GAPS Discovered:**
  * **ADMIN API GAP 6:** GET `/ledger/journals` query listing is unexposed at the controller level.
* **Testing Scope:** Covered 4 robust assertions checking balance divisions, debit/credit tabular columns, and maker-checker reversal signatures.
* **Next Candidate Task:** `W4` — In-House Transaction Observability & Sandbox Utilities.

---

## 8. W4 — In-House Transaction Observability & Sandbox Utilities Implementation Record

* **Completed Date:** 2026-08-23
* **Files Created:**
  * `apps/admin-web/src/screens/authenticated/TransactionObservabilityScreen.tsx` — Sandbox execution completion overrides and read-only Fee Simulator.
  * `apps/admin-web/__tests__/transaction-observability.test.tsx` — Unit test assertions for tracking detail views, sandbox button complete clicks, and simulated calculations.
* **Files Modified:**
  * `apps/admin-web/src/screens/authenticated/Layout.tsx` — Integrated Transaction & Fee Ops sidebar tab.
* **Backend APIs Consumed:**
  * `GET /deposits/:id` — Inspects sandbox deposit states.
  * `GET /withdrawals/:id` — Inspects sandbox outflow states.
  * `GET /transfers/:id` — Audits specific P2P transfer states.
  * `POST /fees/calculate` — Simulates fee pricing rules against the math engine.
  * `POST /deposits/:id/complete` — Executes sandbox simulated deposit completion.
  * `POST /withdrawals/:id/complete` — Executes sandbox simulated withdrawal completion.
* **ADMIN API GAPS Discovered:**
  * **ADMIN API GAP 7:** GET `/transfers` and GET `/deposits` global transaction backlog listing queries are missing at controller levels.
* **Testing Scope:** Covered 2 comprehensive suites checking sandbox complete button overrides and calculation result formats.
* **Next Candidate Task:** `W5` — Independent Reconciliation & Breaks Management.
