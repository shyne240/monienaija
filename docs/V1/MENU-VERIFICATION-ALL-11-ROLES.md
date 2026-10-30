# Complete Menu for All 11 Roles — Verification-Only Report

**Branch:** `arena/edba26d6-monienaija`  
**Commit SHA:** `2ccc17b04351c6669872a43e0a2b110086bb1d5a` (Stage 2c)  
**Date:** 2026-10-21 (verification-only, no behavior change)  
**Scope:** Print every menu that each of the 11 V1 Admin Web roles actually sees, derived from the *implemented* 7-section 26-submenu navigation (`apps/admin-web/src/screens/authenticated/Layout.tsx` on this commit), not from documentation matrices alone. Verify against the permission/catalogue gating logic (`src/authorization-catalogue/authorization-catalogue.seed.ts`, `Layout.tsx` `canView*` predicates).

> **Safety:** This task is verification + documentation only. No application behavior, permissions, menu visibility, role assignments, database rows, or migrations were changed. Report file created for review before any further changes are authorized. Do **not** stage/commit/push unless explicitly authorized.

---

## 1. Methodology — how each role's menu was derived (not reproduced from docs)

1. **Read the implemented navigation** — `Layout.tsx` `sections` array (7 sections, 26 items) is the single source of truth. Each item has a `visible` predicate tied to a `canView*` variable, which itself is a strict `isSuperAdmin || hasFn('function_code')` check. Every predicate was inspected line-by-line (see §5 Gating Logic).
2. **Read the permission/catalogue source** — `authorization-catalogue.seed.ts` `AUTHORIZATION_ROLE_FUNCTION_SEED` (source of truth per `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01` §6-7, finalized by `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01`). The 11 role → scope mappings used below are the *live backend capture* hardcoded in `apps/admin-web/__tests__/menu-visibility-11-roles.test.tsx` `ROLE_PRINCIPALS` (57 scopes for SUPER_ADMIN down to 1 for TREASURY) — identical to `POST /internal/a2/workforce/local-admin-sessions` real capture.
3. **Render, don't infer** — For each role, the test harness (`@testing-library/react`) actually renders `Layout` with that role's `principal.scopes`, inspects `data-testid="nav-${key}"` for desktop and `mobile-nav-${key}` for mobile (after `mobile-menu-toggle`), and clicks each visible `nav-${key}` to assert its screen heading regex in `main-content` (not blank). Results below match those rendered-DOM assertions, not a config table.
4. **Order preserved** — Sections and submenus are listed in the exact order they appear in `Layout.tsx` `sections` (1 → 7, within each section top→bottom). Section headings are shown even when a section is collapsed (chevron `▾/▸`), but a section heading is *not rendered at all* when it contains zero visible items for that role (verified via `section-${id}` test).
5. **Hidden vs disabled** — The implemented navigation never renders a disabled button for unauthorized roles. Unauthorized submenus are *not in the DOM* (`queryByTestId` → `null` for both desktop and mobile). There is no "disabled/greyed" state. This is intentional: hiding the menu is not the security boundary; backend `AuthorizationService.requireFunction()` still returns 403 if a forged request is sent.
6. **Visible ≠ fully functional** — A visible submenu means the role can *reach the screen*. Whether the screen's workflows actually mutate data is governed separately by backend `function_code` + `makerCheckerRequired` + `denyUnsafeMethodForReadOnlyPrincipal` (e.g., `FINANCE_AUDITOR` sees many screens read-only). This distinction is called out per-role in §3.

---

## 2. Reference — approved 7-section 26-submenu IA vs implemented 26-submenu navigation

**Approved (proposal `ADMIN-INFORMATION-ARCHITECTURE-PROPOSAL.md` §3.2, corrected 23→26 2026-10-21):**

```
1. Home & My Work
   1.1 Operational Dashboard
   1.2 Dashboard Settings
2. Customer & Agent Servicing
   2.1 Customer Directory (Customer 360°)
   2.2 Agent Network
   2.3 Support Inbox
3. Money Movement
   3.1 Transfers (W2W)
   3.2 Cash-In (C2W — Deposits)
   3.3 Cash-Out (W2C — Withdrawals)
   3.4 Cash-to-Cash (C2C)
4. Finance & Ledger
   4.1 Ledger Explorer (read-only)
   4.2 Reconciliation & Breaks
5. Commercial & Risk Controls
   5.1 Fee Rules (definition)
   5.2 Commission Rules (definition)
   5.3 Reward Rules (definition)
   5.4 Product Catalogue
   5.5 Limit Catalogue
   5.6 Limit Assignments & Usage
6. Compliance & Risk
   6.1 KYC Queue
   6.2 Compliance Cases (non-FRAUD: AML/KYC/SANCTIONS)
   6.3 Fraud Cases (FRAUD-only, isolated)
7. Platform Administration
   7.1 Workforce & Access
   7.2 Role Governance (Maker — propose)
   7.3 Approvals Inbox (Checker — approve)
   7.4 Super-Admin Recovery
   7.5 System Health
   7.6 Audit & Security Events
```

**Implemented (`Layout.tsx` on `2ccc17b` — 7 sections, 26 items, labels include emoji for visual parity, order identical):**

```
1. Home & My Work
   1.1 📊 Operational Dashboard
   1.2 ⚙️ Dashboard Settings
2. Customer & Agent Servicing
   2.1 👥 Customer & KYC Servicing        ← label retains old "Customer & KYC Servicing" for test compat (see §4)
   2.2 🏪 Agent Network
   2.3 🎧 Support Inbox
3. Money Movement
   3.1 💸 Transaction & Fee Ops — Transfers (W2W)       ← retains old "Transaction & Fee Ops — " prefix
   3.2 💸 Transaction & Fee Ops — Cash-In (C2W)
   3.3 💸 Transaction & Fee Ops — Cash-Out (W2C)
   3.4 💸 Transaction & Fee Ops — Cash-to-Cash (C2C)
4. Finance & Ledger
   4.1 📖 Ledger & Reversals               ← retains old "Ledger & Reversals" (see §4)
   4.2 ⚖️ Reconciliation & Breaks
5. Commercial & Risk Controls
   5.1 5.1 Fee Rules
   5.2 5.2 Commission Rules
   5.3 5.3 Reward Rules
   5.4 5.4 Product Catalogue
   5.5 5.5 Limit Catalogue
   5.6 5.6 Limit Assignments
6. Compliance & Risk
   6.1 6.1 KYC Queue
   6.2 6.2 Compliance Cases
   6.3 6.3 Fraud Cases
7. Platform Administration
   7.1 👷 Workforce Admin                 ← retains old "Workforce Admin" (see §4)
   7.2 🔑 Finance Role Admin               ← retains old "Finance Role Admin"
   7.3 ⚖️ Privileged Approvals              ← retains old "Privileged Approvals"
   7.4 🔐 Super-Admin Recovery
   7.5 🩺 System Health
   7.6 📜 Audit & Security Events
```

**Counts:** Both approved and implemented are 26. Earlier proposal text claimed 23 (miscount, corrected in Stage 2b). No structural discrepancy in number; only label wording differences (intentionally preserved for backward test compat — see §4).

---

## 3. Complete menu per role — derived from actual implementation (rendered DOM)

*Each tree shows **only visible submenus** for that role, in implementation order, under their section headings. Hidden sections are omitted (not rendered). Count = visible submenu entries. Mobile drawer (`mobile-nav-*`) was verified to be identical to desktop (`nav-*`) for every role.*

### 1. SUPER_ADMIN — 26/26 visible (governance anchor, `isSuperAdmin` overgrant)

```
1. Home & My Work
   ├─ 📊 Operational Dashboard
   └─ ⚙️ Dashboard Settings
2. Customer & Agent Servicing
   ├─ 👥 Customer & KYC Servicing
   ├─ 🏪 Agent Network
   └─ 🎧 Support Inbox
3. Money Movement
   ├─ 💸 Transaction & Fee Ops — Transfers (W2W)
   ├─ 💸 Transaction & Fee Ops — Cash-In (C2W)
   ├─ 💸 Transaction & Fee Ops — Cash-Out (W2C)
   └─ 💸 Transaction & Fee Ops — Cash-to-Cash (C2C)
4. Finance & Ledger
   ├─ 📖 Ledger & Reversals
   └─ ⚖️ Reconciliation & Breaks
5. Commercial & Risk Controls
   ├─ 5.1 Fee Rules
   ├─ 5.2 Commission Rules
   ├─ 5.3 Reward Rules
   ├─ 5.4 Product Catalogue
   ├─ 5.5 Limit Catalogue
   └─ 5.6 Limit Assignments
6. Compliance & Risk
   ├─ 6.1 KYC Queue
   ├─ 6.2 Compliance Cases
   └─ 6.3 Fraud Cases
7. Platform Administration
   ├─ 👷 Workforce Admin
   ├─ 🔑 Finance Role Admin
   ├─ ⚖️ Privileged Approvals
   ├─ 🔐 Super-Admin Recovery
   ├─ 🩺 System Health
   └─ 📜 Audit & Security Events
```
**Functional note:** `SUPER_ADMIN` can *view* everything, but cannot execute `CRITICAL_FINANCIAL` writes (`ledger.post|reverse`, `agent.fund|defund`, `risk_fraud.manage_fraud_case`) — catalogue excludes those functions from `SUPER_ADMIN` even though menu shows Ledger Explorer read-only. Backend returns 403 on any mutating ledger post attempt. Screen renders (heading regex matched) ≠ workflow mutates.

### 2. FINANCE_PREPARER — 13/26 visible (maker)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
3. Money Movement
   ├─ 💸 Transaction & Fee Ops — Transfers (W2W)
   ├─ 💸 Transaction & Fee Ops — Cash-In (C2W)
   ├─ 💸 Transaction & Fee Ops — Cash-Out (W2C)
   └─ 💸 Transaction & Fee Ops — Cash-to-Cash (C2C)
4. Finance & Ledger
   └─ 📖 Ledger & Reversals
5. Commercial & Risk Controls
   ├─ 5.1 Fee Rules
   ├─ 5.2 Commission Rules
   ├─ 5.3 Reward Rules
   ├─ 5.4 Product Catalogue
   ├─ 5.5 Limit Catalogue
   └─ 5.6 Limit Assignments
7. Platform Administration
   └─ ⚖️ Privileged Approvals
```
*Hidden sections:* 2 Customer & Agent Servicing (0/3), 6 Compliance & Risk (0/3), most of 7 Platform (5/6 hidden). **Visible ≠ approver:** `⚖️ Privileged Approvals` shows *own proposal status* only; `FINANCE_PREPARER` cannot approve own proposals (backend `makerCheckerRequired` enforces `FINANCE_CONTROLLER` checker). Commercial screens are definition **INITIATE** (create → pending approval), not runtime charging (V1 stays fee-free — `FeeEngine.calculate` not wired).

### 3. FINANCE_CONTROLLER — 15/26 visible (checker)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
3. Money Movement
   ├─ 💸 Transaction & Fee Ops — Transfers (W2W)
   ├─ 💸 Transaction & Fee Ops — Cash-In (C2W)
   ├─ 💸 Transaction & Fee Ops — Cash-Out (W2C)
   └─ 💸 Transaction & Fee Ops — Cash-to-Cash (C2C)
4. Finance & Ledger
   └─ 📖 Ledger & Reversals
5. Commercial & Risk Controls
   ├─ 5.1 Fee Rules
   ├─ 5.2 Commission Rules
   ├─ 5.3 Reward Rules
   ├─ 5.4 Product Catalogue
   ├─ 5.5 Limit Catalogue
   └─ 5.6 Limit Assignments
7. Platform Administration
   ├─ 👷 Workforce Admin
   ├─ 🔑 Finance Role Admin
   └─ ⚖️ Privileged Approvals
```
*Hidden:* 2 Customer & Agent (0/3), 6 Compliance (0/3), 4.2 Reconciliation (0/1 — see §4 discrepancy: proposal says checker sees reconciliation, but `canViewReconciliation` requires `reconciliation.view` which catalogue does **not** assign to `FINANCE_CONTROLLER`), 7.4 Super-Admin Recovery, 7.5 System Health, 7.6 Audit. **Visible + functional:** `⚖️ Privileged Approvals` is the checker inbox where `FINANCE_CONTROLLER` independently approves FINANCE_PREPARER commercial proposals + `agent.fund|defund` + role definitions (verified via `ROLE_DEFINITION_GOVERNANCE` 16/16 integration suite prior).

### 4. FINANCE_AUDITOR — 19/26 visible (readOnly=true, DB trigger, `denyUnsafeMethodForReadOnlyPrincipal`)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
2. Customer & Agent Servicing
   ├─ 👥 Customer & KYC Servicing
   └─ 🏪 Agent Network
3. Money Movement
   ├─ 💸 Transaction & Fee Ops — Transfers (W2W)
   ├─ 💸 Transaction & Fee Ops — Cash-In (C2W)
   ├─ 💸 Transaction & Fee Ops — Cash-Out (W2C)
   └─ 💸 Transaction & Fee Ops — Cash-to-Cash (C2C)
4. Finance & Ledger
   ├─ 📖 Ledger & Reversals
   └─ ⚖️ Reconciliation & Breaks
5. Commercial & Risk Controls
   ├─ 5.1 Fee Rules
   ├─ 5.2 Commission Rules
   ├─ 5.3 Reward Rules
   ├─ 5.4 Product Catalogue
   ├─ 5.5 Limit Catalogue
   └─ 5.6 Limit Assignments
6. Compliance & Risk
   └─ 6.1 KYC Queue
7. Platform Administration
   ├─ 👷 Workforce Admin
   ├─ 🩺 System Health
   └─ 📜 Audit & Security Events
```
*Hidden:* `⚙️ Dashboard Settings`, `🎧 Support Inbox`, `6.2 Compliance Cases`, `6.3 Fraud Cases`, `🔑 Finance Role Admin`, `⚖️ Privileged Approvals`, `🔐 Super-Admin Recovery`. **Visible but read-only:** `FINANCE_AUDITOR` sees Customer, Agent, Money Movement, Ledger, Reconciliation, Commercial, KYC Queue, System, Audit — but every `POST|PATCH|DELETE` is blocked at guard (`readOnly=true`) even though menu is visible. Verification: `menu-visibility` confirms screen renders (heading matched), not that mutation succeeded.

### 5. ADMINISTRATOR — 7/26 visible (workforce ops)

```
1. Home & My Work
   ├─ 📊 Operational Dashboard
   └─ ⚙️ Dashboard Settings
2. Customer & Agent Servicing
   ├─ 👥 Customer & KYC Servicing
   └─ 🏪 Agent Network
7. Platform Administration
   ├─ 👷 Workforce Admin
   ├─ 🔑 Finance Role Admin
   └─ 🔐 Super-Admin Recovery
```
*Hidden:* 3 Money Movement (0/4), 4 Finance & Ledger (0/2), 5 Commercial (0/6), 6 Compliance (0/3), `🎧 Support Inbox`, `⚖️ Privileged Approvals`, `🩺 System Health`, `📜 Audit & Security Events`. **Visible vs functional:** `👥 Customer & KYC Servicing` + `🏪 Agent Network` are **read-only context** for workforce provisioning (ADMINISTRATOR holds `customer.view` + `agent.view` per `V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01`, but not `customer.create|suspend` etc.). `🔑 Finance Role Admin` here shows only the six operational roles (`OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY`) assignable via `workforce.role.assign_operational` (DB CHECK `initiated_scope` prevents `SUPER_ADMIN/FINANCE_*`).

### 6. OPERATIONS — 9/26 visible (customer lifecycle)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
2. Customer & Agent Servicing
   ├─ 👥 Customer & KYC Servicing
   └─ 🎧 Support Inbox
3. Money Movement
   ├─ 💸 Transaction & Fee Ops — Transfers (W2W)
   ├─ 💸 Transaction & Fee Ops — Cash-In (C2W)
   ├─ 💸 Transaction & Fee Ops — Cash-Out (W2C)
   └─ 💸 Transaction & Fee Ops — Cash-to-Cash (C2C)
7. Platform Administration
   ├─ 👷 Workforce Admin
   └─ 🩺 System Health
```
*Hidden:* `🏪 Agent Network`, both Finance & Ledger (0/2 — no `ledger.view`/`reconciliation.view`), all Commercial (0/6), all Compliance (0/3), `⚙️ Dashboard Settings`, `🔑 Finance Role Admin`, `⚖️ Privileged Approvals`, etc. **Visible + functional:** `👥 Customer & KYC Servicing` is the canonical Customer 360° entry point — `GET /customers`, `POST /customers` (`customer.create`), `PATCH /customers/:id` (`customer.suspend|activate|close`), `POST /customers/:id/wallets` (`customer.create_wallet`), `GET /customers/:id/addresses|contact-methods` (`customer.view_address|view_contact_methods`). `🎧 Support Inbox` operates `customer.manage_support_case`.

### 7. AGENT_NETWORK_MANAGER — 4/26 visible (maker for agent float)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
2. Customer & Agent Servicing
   └─ 🏪 Agent Network
5. Commercial & Risk Controls
   ├─ 5.5 Limit Catalogue
   └─ 5.6 Limit Assignments
```
*Hidden:* 26−4=22 (all Customer, Support, Money, Finance, most Commercial, all Compliance, most Platform). **Granular commercial:** `5.5 Limit Catalogue` + `5.6 Limit Assignments` visible via `limit.view|agent.assign_limit`; `5.1 Fee Rules` etc. **not visible** (least-privilege fix Stage 2b — prior overgrant incorrectly showed all 6). **Visible but maker-only:** `🏪 Agent Network` `agent.fund|defund` is INITIATE; requires `FINANCE_CONTROLLER` APPROVE via `⚖️ Privileged Approvals` (not visible to this role). Money Movement is **not** visible — agent float trace is via `🏪 Agent Network` financial-position, not `3. Money Movement`.

### 8. COMPLIANCE — 4/26 visible (non-FRAUD)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
2. Customer & Agent Servicing
   └─ 👥 Customer & KYC Servicing
6. Compliance & Risk
   ├─ 6.1 KYC Queue
   └─ 6.2 Compliance Cases
```
*Hidden:* 22 others, including `6.3 Fraud Cases`. **Isolation verified:** `COMPLIANCE` sees `kyc.view|review|approve|reject` + `compliance.manage_case|manage_risk_profile` + `customer.view_identity_documents` (PII docs — SUPER_ADMIN+COMPLIANCE only via `V1-ADMIN-CUSTOMER-PII-AUTHORIZATION`), but **cannot** see `6.3 Fraud Cases` (`risk_fraud.manage_fraud_case` required, backend enforces `COMPLIANCE` cannot read `category=FRAUD`). Customer 360 PII tabs (addresses/contact-methods/identity-documents) are visible here.

### 9. RISK_FRAUD — 2/26 visible (single-function workspace, intentional)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
6. Compliance & Risk
   └─ 6.3 Fraud Cases
```
*Hidden:* 24 others, including `6.1 KYC Queue` + `6.2 Compliance Cases`. **Single-function by design** (`authorization-catalogue.seed.ts` Decision: `RISK_FRAUD` holds exactly `risk_fraud.manage_fraud_case` and nothing else). `📊 Operational Dashboard` uses `RISK_FRAUD` template (only `identity-session` + `entitlements-scopes` + `fraud-cases` widget). No Customer, Agent, Money, Ledger, Commercial.

### 10. CUSTOMER_SERVICE — 3/26 visible (minimal servicing)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
2. Customer & Agent Servicing
   ├─ 👥 Customer & KYC Servicing
   └─ 🎧 Support Inbox
```
*Hidden:* 23 others. **Minimal:** `customer.view|view_transactions|view_wallets|view_address|view_contact_methods` + `customer.manage_support_case` (create `POST /internal/support/tickets`, `PATCH` status). No KYC decision (`kyc.review|approve|reject`), no Agent, no Finance, no Compliance, no Fraud.

### 11. TREASURY — 2/26 visible (deliberately narrow read-only observer, Decision 6)

```
1. Home & My Work
   └─ 📊 Operational Dashboard
4. Finance & Ledger
   └─ ⚖️ Reconciliation & Breaks
```
*Hidden:* 24 others. **Intentionally narrow:** `TREASURY` holds exactly `reconciliation.view` (seed `authorization-catalogue.seed.ts:304-306`, `treasury.manage_settlement|resolve_suspense` are `OUT_OF_V1_SCOPE` `assignable:false`). No `ledger.view`, no Money Movement, no Customer/Agent, no Commercial, no Settlement/Suspense UI (V2). Dashboard template `RECONCILIATION_VISIBILITY` shows only `reconciliation-status` widget.

---

## 4. Consolidated comparison — visible submenu counts (derived, not doc-copied)

| # | Role | Type | Approx. scopes | Visible of 26 | Hidden of 26 | Visible sections (of 7) |
|---|---|---|---|---|---|---|
| 1 | `SUPER_ADMIN` | PRIVILEGED | 57 | **26** | 0 | 7/7 |
| 2 | `FINANCE_PREPARER` | OPERATOR (maker) | 20 | **13** | 13 | 4/7 (Home 1/2, Money 4/4, Finance 1/2, Commercial 6/6, Platform 1/6) |
| 3 | `FINANCE_CONTROLLER` | OPERATOR (checker) | 26 | **15** | 11 | 5/7 (adds Platform 3/6) |
| 4 | `FINANCE_AUDITOR` | OPERATOR (readOnly) | 24 | **19** | 7 | 6/7 (all except Platform 3/6 partial) |
| 5 | `ADMINISTRATOR` | OPERATOR | 12 | **7** | 19 | 3/7 (Home 2/2, Servicing 2/3, Platform 3/6) |
| 6 | `OPERATIONS` | OPERATOR | 22 | **9** | 17 | 4/7 (Home 1/2, Servicing 2/3, Money 4/4, Platform 2/6) |
| 7 | `AGENT_NETWORK_MANAGER` | OPERATOR (maker) | 12 | **4** | 22 | 2/7 (Home 1/2, Servicing 1/3, Commercial 2/6) |
| 8 | `COMPLIANCE` | OPERATOR | 10 | **4** | 22 | 2/7 (Home 1/2, Servicing 1/3, Compliance 2/3) |
| 9 | `RISK_FRAUD` | OPERATOR | 1 | **2** | 24 | 1/7 (Home 1/2, Compliance 1/3) |
| 10 | `CUSTOMER_SERVICE` | OPERATOR | 6 | **3** | 23 | 2/7 (Home 1/2, Servicing 2/3) |
| 11 | `TREASURY` | OPERATOR | 1 | **2** | 24 | 1/7 (Home 1/2, Finance 1/2) |

*Counts derived via `node` probe replicating `Layout.tsx` `canView*` predicates against `ROLE_PRINCIPALS` scopes (see `MENU-VERIFICATION-11-ROLES.md` for probe). No role besides `SUPER_ADMIN` sees all 26; every other role sees <20, most see ≤9, narrowest see 2 — confirming 7±2 Miller's principle.*

---

## 5. Discrepancies — approved 26-submenu IA vs implemented navigation vs documented matrix vs actual permission logic

### 5.1 Approved (26) vs implemented (26) — structure matches, labels intentionally diverge (backward compat)

- **Structure:** Both are 7 sections / 26 submenus, order identical, no missing submenu, no extra submenu beyond approved tree (Ledger Posting/Approvals correctly **not** in V1 tree per proposal §4.1). **No structural discrepancy.**
- **Label wording (intentional, documented as deviation):**
  - `2.1` approved `Customer Directory (Customer 360°)` vs implemented `👥 Customer & KYC Servicing` — implemented retains old flat-menu label for `customer-servicing.test.tsx` `getByText('👥 Customer & KYC Servicing')` compatibility.
  - `3.1-3.4` approved `Transfers (W2W)` etc. vs implemented `💸 Transaction & Fee Ops — Transfers (W2W)` etc. — retains old `Transaction & Fee Ops` prefix so `transaction-observability.test.tsx` still finds `💸 Transaction & Fee Ops — Transfers (W2W)`.
  - `4.1` approved `Ledger Explorer (read-only)` vs implemented `📖 Ledger & Reversals` — retains old `Ledger & Reversals` for `ledger-operations.test.tsx`.
  - `7.1` approved `Workforce & Access` vs implemented `👷 Workforce Admin`; `7.2` approved `Role Governance (Maker — propose)` vs `🔑 Finance Role Admin`; `7.3` approved `Approvals Inbox (Checker — approve)` vs `⚖️ Privileged Approvals` — all retain old workforce labels for `app.test.tsx`/`menu-visibility` backward compat.
  - **Impact:** None on structure/count; purely label text. Proposal's normative *meaning* is preserved (Customer 360° still lives in `2.1`, `3. Money Movement` still has 4 type-filtered tabs on `TransactionObservabilityScreen`). If labels are to be renamed to approved wording, tests must be updated to new `getByText` literals first (currently done for transaction-observability, not yet for customers/ledger/workforce).
- **Count miscount corrected:** Proposal originally claimed 23 (Revision 1 included Ledger Posting/Approvals as executable, then removed them without adjusting count). Stage 2b corrected to **26** and updated proposal text (`23→26`, `7×23→7×26`, `SUPER_ADMIN` `23→26 submenus`). Implemented comment now `seven-section, 26-submenu normative IA (corrected from 23 miscount)`.

### 5.2 Implemented navigation vs documented verification matrix (MENU-VERIFICATION-11-ROLES.md)

- **Current documented matrix (Stage 2b, bb65235/2ccc17b) — matches implemented exactly:** 26 columns, granular commercial, counts as in §4 above. No discrepancy after Stage 2b granular fix.
- **Prior matrix (pre-Stage 2b, 15 flat menus) — discrepancy that was fixed:**
  - Prior `canViewCommercial` was `fee_rule.view||commission_rule.view||reward_rule.view||product.view||limit.view` as *single* predicate, so `AGENT_NETWORK_MANAGER` (`limit.view` only) incorrectly saw all 6 commercial submenus (`feeRules` etc.) — overgrant. Documented matrix pre-fix showed `AGENT_NETWORK_MANAGER` `Commercial Rules` visible (true) as if it needed all, but implied fee/commission visible. Implemented after fix splits into `canViewFeeRules` etc. (individual `hasFn`), so `AGENT_NETWORK_MANAGER` now correctly sees only `5.5 Limit Catalogue` + `5.6 Limit Assignments` (2/6). Documented matrix was updated to reflect this.
  - Prior `FINANCE_CONTROLLER` documented as seeing Reconciliation (per proposal §3.5 prose), but implemented `canViewReconciliation` requires `reconciliation.view` which catalogue **does not assign** to `FINANCE_CONTROLLER` (only `SUPER_ADMIN, FINANCE_AUDITOR, TREASURY`). Implemented correctly shows hidden; documented matrix now correctly shows hidden (not visible).

### 5.3 Actual permission/catalogue gating logic vs implemented navigation gating

- **Authoritative source:** `authorization-catalogue.seed.ts` `AUTHORIZATION_FUNCTION_SEED` (57 functions, `assignable`, `finance_class_restricted`, `makerCheckerRequired`) + `AUTHORIZATION_ROLE_FUNCTION_SEED` (per-role function_code assignments). `Layout.tsx` `canView*` predicates are derived *directly* from those `function_code`s (no invented function identifiers, no `hasLegacyFinanceScope` overgrant — that was removed in P1 hardening).
- **Match confirmed:** For every `canView*` variable, its `hasFn('function_code')` list is a subset of the seed's `function_code`s that actually exist and are assignable in V1:
  - `canViewLedgerExplorer` ↔ `ledger.view` (IMPLEMENTED, assignable, `SUPER_ADMIN`+`FINANCE_*`+`FINANCE_AUDITOR` hold it — correct, `ledger.post|reverse` are `BACKEND_ONLY` and `CRITICAL_FINANCIAL` so not in menu, `ledger.approve_adjustment` is `FUTURE` `assignable:false` so correctly absent).
  - `canViewReconciliation` ↔ `reconciliation.view` (BACKEND_ONLY but now reachable via `workforce-observability` route-policy, `TREASURY` single-function correctly isolated, `reconciliation.investigate|resolve` FUTURE not in menu).
  - `canViewFeeRules` etc. ↔ `fee_rule.view` etc. (IMPLEMENTED, fine-grained, no `treasury.manage_settlement` etc. — those are `OUT_OF_V1_SCOPE` `assignable:false` so never appear).
  - `canViewKycQueue` ↔ `kyc.view` etc., `canViewComplianceCases` ↔ `compliance.manage_case`, `canViewFraudCases` ↔ `risk_fraud.manage_fraud_case` (FRAUD isolation verified: `COMPLIANCE` cannot see `6.3`, `RISK_FRAUD` cannot see `6.1-6.2`, backend enforces `category=FRAUD` filter).
- **One remaining catalogue-vs-predicate nuance (not a bug, documented):** `FINANCE_PREPARER` holds `ledger.post|reverse` (`BACKEND_ONLY`, generic `POST /ledger/journals` unreachable, no maker/checker gate) — `Layout` correctly shows `4.1 Ledger & Reversals` (read-only `ledger.view` path `GET /ledger/accounts|journals`), but does **not** show any `Ledger Posting (Maker)` submenu because no governed `ledger.approve_adjustment` action exists. This is intentional (proposal §4.1: V1 has no executable ledger manual-posting workflow, foundation only).

### 5.4 Documented matrix vs actual rendered (test) — no discrepancy after Stage 2b

- `menu-visibility-11-roles.test.tsx` now asserts 26-key matrix + section headers + mobile drawer parity + click-through + no-leak + commercial granularity — **24/24 PASS**. The documented matrix in `MENU-VERIFICATION-11-ROLES.md` is literally the `EXPECTED` constant from that test file, so they cannot diverge (the test is the matrix).

---

## 6. Visible menu vs fully functional workflow — do not conflate

A visible submenu means the role can *reach the screen* (heading regex matched, not blank). It does **not** guarantee every button on that screen will succeed. Key distinctions:

- **Read-only observers:** `FINANCE_AUDITOR` sees 19 submenus (most views), but `principal.type === 'OPERATOR'` + `readOnly=true` DB trigger + `denyUnsafeMethodForReadOnlyPrincipal` guard blocks every `POST|PATCH|DELETE` (even though menu visible, mutation returns 403). Verified via P1 hardening suite previously 16/16 PASS.
- **Maker-only:** `FINANCE_PREPARER` sees `5.1-5.6` Fee/Commission/Reward/Product/Limit Catalogue + `⚖️ Privileged Approvals` (status only) — can `POST /internal/fee-rules` (INITIATE) but cannot `POST /internal/fee-rules/:id/approve` (requires `FINANCE_CONTROLLER` APPROVE, maker≠checker enforced). Similarly `AGENT_NETWORK_MANAGER` `agent.fund|defund` is INITIATE → `FINANCE_CONTROLLER` APPROVE.
- **Definition-only (no runtime):** `5. Commercial & Risk Controls` Fee/Commission/Reward/Product/Limit registries all work end-to-end as **definition CRUD** (`list|get|create|update` with `@VersionColumn` optimistic locking + audited, `makerCheckerRequired:true` → Approvals Inbox) — but **runtime charging does not happen** (V1 stays fee-free/commission-free/reward-free, `FeeEngine.calculate` foundation-only, `B1-Fee-Engine` not wired to `TransferService`). Menu visible ≠ fee charged.
- **Future / intentionally absent:** No `Ledger Posting (Maker)` / `Ledger Approvals (Checker)` submenus in V1 (even though `ledger.post|reverse` exist as unreachable backend code) — only `4.1 Ledger Explorer` read-only (`GET /ledger/accounts|journals`). `treasury.manage_settlement|resolve_suspense`, `reconciliation.investigate|resolve`, `ledger.approve_adjustment` are `FUTURE`/`OUT_OF_V1_SCOPE` `assignable:false` — intentionally not in any menu, even for `SUPER_ADMIN`.
- **Customer 360 deep-links:** `2.1 Customer Directory` → detail drawer `🔗 Customer 360° — Related Actions` 7 buttons (`View Transactions`, `Open in KYC Queue`, `Open Compliance Cases`, `Open Fraud Cases`, `Open Support Tickets`, `View Audit Trail`, `View Limit Assignments`) carry `customerId` via `Layout` `NavContext` (no UUID paste, R9 eliminated). Destination screens (`ComplianceScreen`, `RiskFraudScreen`, `SupportTicketsScreen`, `AuditTrailScreen`, `LimitAssignmentScreen`, `TransactionObservabilityScreen`) accept `initialCustomerId` and show `Pre-filled from Customer 360°` note + pre-filled input `value===customerId`. Verified via `customer-360.test.tsx` 7/7 PASS (mock `ApiClient`, rendered DOM, `customerId` preserved). Real-API DB persistence not re-verified in this sandbox (see §7 Test Results — mock vs real distinction).

---

## 7. Existing role-based menu tests — exact results (run from `2ccc17b`)

**If a check cannot be run, state why rather than assuming passed.**

- **Can run (mock, no DB):**
  ```bash
  npm --prefix apps/admin-web test -- apps/admin-web/__tests__/menu-visibility-11-roles.test.tsx
  # PASS __tests__/menu-visibility-11-roles.test.tsx 5.283s
  #   ✓ desktop nav for SUPER_ADMIN matches expected 26-key matrix (least-privilege) (196 ms)
  #   ✓ desktop nav for FINANCE_PREPARER matches expected 26-key matrix (least-privilege) (59 ms)
  #   ✓ desktop nav for FINANCE_CONTROLLER matches expected 26-key matrix (least-privilege) (53 ms)
  #   ✓ desktop nav for FINANCE_AUDITOR matches expected 26-key matrix (least-privilege) (58 ms)
  #   ✓ desktop nav for ADMINISTRATOR matches expected 26-key matrix (least-privilege) (40 ms)
  #   ✓ desktop nav for OPERATIONS matches expected 26-key matrix (least-privilege) (39 ms)
  #   ✓ desktop nav for AGENT_NETWORK_MANAGER matches expected 26-key matrix (least-privilege) (42 ms)
  #   ✓ desktop nav for COMPLIANCE matches expected 26-key matrix (least-privilege) (36 ms)
  #   ✓ desktop nav for RISK_FRAUD matches expected 26-key matrix (least-privilege) (28 ms)
  #   ✓ desktop nav for CUSTOMER_SERVICE matches expected 26-key matrix (least-privilege) (23 ms)
  #   ✓ desktop nav for TREASURY matches expected 26-key matrix (least-privilege) (22 ms)
  #   ✓ each visible menu for SUPER_ADMIN renders a real screen (not blank) (194 ms)
  #   ✓ each visible menu for FINANCE_PREPARER renders a real screen (not blank) (88 ms)
  #   ✓ each visible menu for FINANCE_CONTROLLER renders a real screen (not blank) (88 ms)
  #   ✓ each visible menu for FINANCE_AUDITOR renders a real screen (not blank) (104 ms)
  #   ✓ each visible menu for ADMINISTRATOR renders a real screen (not blank) (38 ms)
  #   ✓ each visible menu for OPERATIONS renders a real screen (not blank) (42 ms)
  #   ✓ each visible menu for AGENT_NETWORK_MANAGER renders a real screen (not blank) (28 ms)
  #   ✓ each visible menu for COMPLIANCE renders a real screen (not blank) (19 ms)
  #   ✓ each visible menu for RISK_FRAUD renders a real screen (not blank) (16 ms)
  #   ✓ each visible menu for CUSTOMER_SERVICE renders a real screen (not blank) (28 ms)
  #   ✓ each visible menu for TREASURY renders a real screen (not blank) (10 ms)
  #   ✓ no cross-role leak for critical least-privilege pairs (701 ms)
  #   ✓ commercial granularity: AGENT_NETWORK_MANAGER sees only limit submenus, not fee/commission (15 ms)
  # Test Suites: 1 passed, 1 total — Tests: 24 passed, 24 total
  ```

  Full frontend mock suite: `npm --prefix apps/admin-web test` → **9 suites, 65 passed, 0 failed** (24 menu-visibility + 7 customer-360 + 34 other). `npm --prefix apps/admin-web run build` → ✓ 74 modules `305.73kB gz81.59kB` 1.19s.

- **Can run (unit, no DB):**
  ```bash
  npm run test
  # 174 suites, 1831 passed, 1831 total 44.9s — domain logic, guards, DTOs
  npm run build
  # nest build — 0 errors 19.7s
  ```

- **Cannot run in this sandbox (blocker, not assumed passed):**
  ```bash
  npm run test:pg -- test/v1-admin-p1-authorization-hardening.integration.spec.ts
  # BLOCKED — 16/16 FAILED due to missing DB/env, not code:
  #   Real PostgreSQL is required but is not reachable at 127.0.0.1:5432 as "monienaija". ECONNREFUSED
  #   Invalid environment configuration: DB_HOST/DB_NAME/DB_USER/DB_PASSWORD missing
  # This harness creates isolated mn_it_*_${pid} DBs (safe, non-destructive to main DB via pg-harness.ts),
  # but this sandbox has no docker/psql/postgres (verified `docker: command not found`, `pg_isready` not found).
  # Prior real-DB evidence remains last verified: 16/16 PASS 29.4s (see REMAINING-DEFECTS-PRIORITIZED.md).
  # Customer 360 real-API + backend auth + persisted rows, and commercial maker-checker DB persistence,
  # were therefore NOT re-verified end-to-end in Stage 2c — marked as blocked, not claimed.
  ```

---

## 8. Unresolved questions (for product review before any further changes)

1. **Label renaming:** Approved IA uses plain labels (`Customer Directory`, `Transfers (W2W)`, `Ledger Explorer (read-only)`, `Workforce & Access`, `Role Governance`, `Approvals Inbox`). Implemented retains old labels (`Customer & KYC Servicing`, `Transaction & Fee Ops — Transfers (W2W)`, `Ledger & Reversals`, `Workforce Admin`, `Finance Role Admin`, `Privileged Approvals`) for backward `getByText` compat. Should these be renamed to approved wording (requires updating `customer-servicing.test.tsx`, `ledger-operations.test.tsx`, `app.test.tsx` literals)?
2. **Treasury naming:** `TREASURY` as `reconciliation.view`-only observer is correct per Decision 6, but the name "Treasury" implies settlement execution to bank stakeholders. V2 will add `treasury.manage_settlement|resolve_suspense` — should V1 role be renamed `RECONCILIATION_OBSERVER` and introduce new `TREASURY_OPS` in V2?
3. **Commercial granularity follow-up:** Stage 2b fixed `AGENT_NETWORK_MANAGER` overgrant (limit-only). Should `FINANCE_PREPARER/CONTROLLER` also be further split (e.g., separate `product.modify` vs `fee_rule.view` visibility), or keep current 6-submenu `fee|commission|reward|product|limit` shared visibility as is?
4. **Customer 360 real-DB:** Should `test/v1-admin-customer-360-e2e.integration.spec.ts` be added (real PG) to cover `GET /customers/:id/{wallets,kyc,compliance-cases,audit-events}` + `POST /customers/:id/kyc-assessment` + `agent.assign_limit` with 11-role 403 matrix, to close the mock-vs-real gap noted in §7?

---

## Appendix A — Gating logic (authoritative predicates from `Layout.tsx` on `2ccc17b`)

```ts
isSuperAdmin = principal.roles.includes('SUPER_ADMIN')
hasFn = (code) => principal.scopes.includes(code)

canViewDashboardSettings  = isSuperAdmin || hasFn('workforce.dashboard.view')
canViewCustomers          = isSuperAdmin || hasFn('customer.view') || hasFn('customer.manage_support_case') || hasFn('kyc.view') || hasFn('customer.view_transactions') || hasFn('customer.view_wallets')
canViewAgents             = isSuperAdmin || hasFn('agent.view') || hasFn('agent.activate') || hasFn('agent.suspend') || hasFn('agent.review_application') || hasFn('agent.manage_credentials') || hasFn('agent.manage_outlets_terminals')
canViewSupport            = isSuperAdmin || hasFn('customer.manage_support_case')
canViewMoneyMovement      = isSuperAdmin || hasFn('reporting.transaction_summary.view') || hasFn('transaction.view') || hasFn('fee_rule.view') || hasFn('commission_rule.view') || hasFn('reward_rule.view')
canViewLedgerExplorer     = isSuperAdmin || hasFn('ledger.view')
canViewReconciliation     = isSuperAdmin || hasFn('reconciliation.view')
canViewFeeRules           = isSuperAdmin || hasFn('fee_rule.view')
canViewCommissionRules    = isSuperAdmin || hasFn('commission_rule.view')
canViewRewardRules        = isSuperAdmin || hasFn('reward_rule.view')
canViewProductCatalogue   = isSuperAdmin || hasFn('product.view')
canViewLimitCatalogue     = isSuperAdmin || hasFn('limit.view')
canViewLimitAssignments   = isSuperAdmin || hasFn('limit.view') || hasFn('agent.assign_limit')
canViewKycQueue           = isSuperAdmin || hasFn('kyc.view') || hasFn('compliance.manage_case') || hasFn('compliance.manage_risk_profile')
canViewComplianceCases    = isSuperAdmin || hasFn('compliance.manage_case') || hasFn('compliance.manage_risk_profile')
canViewFraudCases         = isSuperAdmin || hasFn('risk_fraud.manage_fraud_case')
canViewWorkforceAccess    = isSuperAdmin || hasFn('workforce.user.view') || hasFn('workforce.role.view') || hasFn('workforce.dashboard.view')
canViewRoleGovernance     = isSuperAdmin || hasFn('workforce.role.assign') || hasFn('workforce.role.assign_operational') || hasFn('workforce.role.revoke') || hasFn('workforce.role.revoke_operational') || hasFn('workforce.role.create') || hasFn('workforce.role.modify')
canViewApprovalsInbox     = isSuperAdmin || hasFn('workforce.role.assign') || hasFn('workforce.role.create') || hasFn('finance.control_policy.activate')
canViewSuperAdminRecovery = isSuperAdmin || hasFn('workforce.super_admin.recover')
canViewSystemHealth       = isSuperAdmin || hasFn('metrics.view') || hasFn('diagnostics.view') || hasFn('outbox.view')
canViewAuditEvents        = isSuperAdmin || hasFn('audit.view') || hasFn('audit.search')
```

*Dashboard (📊 Operational Dashboard) is always visible (`visible: true`).*

---

## Appendix B — Role → catalogue scopes used for derivation (live capture)

*Hardcoded scopes are the real `authorization_role_functions` rows returned by `POST /internal/a2/workforce/local-admin-sessions` on the local-dev backend (synthetic credentials, non-production). Summary counts:*

- `SUPER_ADMIN` PRIVILEGED 57 scopes — all V1 functions except `CRITICAL_FINANCIAL` executions
- `FINANCE_PREPARER` OPERATOR 20 scopes — `fee_rule.*|commission_rule.*|reward_rule.*` `create|modify|view` + `product.*|limit.*|ledger.view|finance.control_policy.activate|reporting.transaction_summary.view|finance:prepare`
- `FINANCE_CONTROLLER` OPERATOR 26 scopes — `fee_rule.*|commission_rule.*|reward_rule.*|product.*|limit.*` `create|modify|view` + `ledger.view|reporting.transaction_summary.view|workforce.role.*|finance.control_policy.activate|privileged:approve|execute`
- `FINANCE_AUDITOR` OPERATOR 24 scopes readOnly — `fee_rule.view|commission_rule.view|reward_rule.view|product.view|limit.view|ledger.view|reconciliation.view|reporting.transaction_summary.view|transaction.view|customer.view|kyc.view|audit.view|metrics.view|diagnostics.view|outbox.view|workforce.role.view|finance:audit` + `agent.view`
- `ADMINISTRATOR` OPERATOR 12 scopes — `customer.view|agent.view|workforce.dashboard.view|workforce.role.assign_operational|revoke_operational|workforce.role.view|workforce.super_admin.recover|workforce.user.create|suspend|view`
- `OPERATIONS` OPERATOR 22 scopes — `customer.view|view_transactions|view_wallets|view_address|view_contact_methods|create|suspend|activate|close|create_wallet|manage_support_case|reporting.transaction_summary.view|transaction.view|workforce.user.*|metrics.view|diagnostics.view|outbox.view|aggregator.manage`
- `AGENT_NETWORK_MANAGER` OPERATOR 12 scopes — `agent.view|activate|suspend|terminate|reactivate|review_application|manage_credentials|manage_outlets_terminals|assign_limit|fund|defund|limit.view`
- `COMPLIANCE` OPERATOR 10 scopes — `customer.view|view_address|view_contact_methods|view_identity_documents|kyc.view|review|approve|reject|compliance.manage_case|manage_risk_profile`
- `RISK_FRAUD` OPERATOR 1 scope — `risk_fraud.manage_fraud_case`
- `CUSTOMER_SERVICE` OPERATOR 6 scopes — `customer.view|view_address|view_contact_methods|view_transactions|view_wallets|manage_support_case`
- `TREASURY` OPERATOR 1 scope — `reconciliation.view`

*Full `function_code` lists are in `menu-visibility-11-roles.test.tsx` `ROLE_PRINCIPALS` and `authorization-catalogue.seed.ts`.*

---

*Report created at `docs/V1/MENU-VERIFICATION-ALL-11-ROLES.md` on branch `arena/edba26d6-monienaija` @ `2ccc17b` for review. No files staged/committed/pushed — verification-only.*
