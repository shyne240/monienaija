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

---

## 1. Unified Sequence of Execution

MoneyNaija is an in-house mobile-money company. To operate the business entirely on our own database ledger infrastructure, development follows this authoritative maturity order:

```text
       CORE BACKEND (A1-A7, B1, B2F09-PRE)
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
* **W2+ (Admin Functional Modules):** **NOT STARTED** — Reserved for future back-office interfaces.

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

* **`W1` — Admin Web Foundation & Workforce Login:** Establishes the boilerplate web shell, authenticates OIDC and Sandbox Bootstrap tokens, implements the central React state container, and enforces role-locked menu navigation.
* **`W2` — Back-Office Customer & Wallet servicing:** Functional screen layouts for administrative customer search, profile verification, active NGN wallet provisioning, and status suspension toggles.
* **`W3` — Ledger Operations, Approvals & Audits:** Exposes read-only views for double-entry ledger postings, logs for maker-checker reviews, and manual reversing controls.

---

## 4. W1 — Admin Web Foundation Implementation Record

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

