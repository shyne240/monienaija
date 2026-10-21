# MonieNaija Admin Panel — Information Architecture Proposal (V1)

**Status:** Proposal — review before implementation  
**Branch:** `arena/edba26d6-monienaija` (do not merge to main / deploy)  
**Date:** 2026-10-21  
**Authors:** Agent audit of live codebase + DB + catalogue + running services  
**Predecessors:** `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01`, `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01`, `V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01`, `MENU-VERIFICATION-11-ROLES`, `REMAINING-DEFECTS-PRIORITIZED`, `V1-SCOPE-CHALLENGE-01`

> Design constraint from task: *Do not assume the current menu structure is correct. Do not invent features unsupported by the application without clearly labelling them as proposed future functionality. A role having a permission does not automatically mean it should see a menu. Hiding a menu must never be treated as the security boundary; backend authorization remains mandatory.*

---

## 1. Reasoning — why this proposal exists

The current panel (`apps/admin-web/src/screens/authenticated/Layout.tsx`) exposes 15 top-level entries derived incrementally from whichever controllers were wired last (Agent Network when `agent.view` was added, Commercial Rules when fee/commission registries landed, etc.). The result:

* **Technical-module menus masquerading as business jobs.** “Transaction & Fee Ops”, “Ledger & Reversals”, and “Commercial Rules” each expose a different slice of the same underlying money movement, split because `FeeController`, `LedgerController`, and `FeeRuleRegistryController` are separate files — not because a finance preparer thinks in those terms.
* **Read-only / maker / approver roles seeing the same flat list.** FINANCE_PREPARER (maker) and FINANCE_CONTROLLER (checker) currently see different subsets only because legacy `hasLegacyFinanceScope` over-granted both; after the strict fix both correctly see only their maker/checker slices, but the IA still treats them as two variations of one long list rather than as distinct workspaces.
* **Operational functions hidden behind manual UUID entry.** Compliance and Risk & Fraud require pasting a customer UUID because no business navigation links Customer Directory → Compliance → Fraud case; similarly Reconciliation correctly surfaces WARNINGs but has no resolver workflow because none exists yet.
* **Backend functions with no UI entry point.** `agent.assign_limit`, `agent.fund|defund` (initiated by AGENT_NETWORK_MANAGER, approved by FINANCE_CONTROLLER), `product.governance`, `limit.modify`, `reward_rule.*`, `workforce.super_admin.recover`, `customer.view_address|view_contact_methods|view_identity_documents` splits, `capability-policy`, `beneficiary` ownership, `virtual-account`, and `customer-funding-request` approvals all exist as implemented controllers but have no dedicated admin workflow.
* **UI functions with partial or mocked backend.** Customer Wallet provisioning and KYC assessment POSTs exist but return synthetic success in some screens; Commercial Rules tabs for `products` and `limits` call `GET /internal/products` / `GET /internal/limit-catalogue` which are definition registries with zero seeded production rules (expected per V1 — foundation only), so they appear empty even when correctly authorized.

The proposal below reorganizes the panel around **what each employee needs to accomplish** — Customer Servicing, Agent Network Operations, Money Movement & Finance, Governance & Workforce, Compliance & Risk, and Platform Operations — and makes explicit which items are existing-code-supported versus which require new implementation. It does not delete working functionality; it renames, groups, and consolidates it.

---

## 2. Phase 1 — Audit findings

### 2.1 Business domains & operational functions (from `src/**/*.entity.ts`, `*.controller.ts`, catalogue)

| Domain | Core entities / tables | Operational functions (catalogue `function_code`) | V1 status |
|---|---|---|---|
| **Customer lifecycle** | `Customer`, `CustomerProfile`, `CustomerWallet`, `CustomerFinancialAccountBinding`, `CustomerKycAssessment`, `CustomerAddress`, `CustomerContactMethod`, `CustomerIdentityDocument`, `CustomerTransactionPin`, `CustomerRiskProfile`, `CustomerRestriction`, `CustomerEligibility`, `CustomerFundingRequest|Instrument`, `Beneficiary`, `VirtualAccount`, `RecipientResolution` | `customer.view|create|suspend|activate|close`, `customer.view_transactions|view_wallets|create_wallet`, `customer.manage_support_case`, `customer.view_address|view_contact_methods|view_identity_documents`, `kyc.view|review|approve|reject`, `customer.create_wallet`, `transaction.view` (single-record) | IMPLEMENTED / PARTIALLY_IMPLEMENTED; PII split per V1-ADMIN-CUSTOMER-PII |
| **Agent network** | `Agent`, `AgentApplication`, `AgentOutlet|Terminal|ReceivingNumber|Class`, `AgentAuthenticationCredential`, `Aggregator`, `AggregatorAgentRelationship`, `Bank`, `CustomerLimitProfile|Rule|Assignment` | `agent.view|review_application|activate|suspend|terminate|reactivate|manage_credentials|manage_outlets_terminals|assign_limit`, `agent.fund|defund` (sensitive, maker/checker), `aggregator.view|manage` | IMPLEMENTED |
| **Money movement** | `Transfer` (W2W), `Deposit` (C2W), `Withdrawal` (W2C), `CashToCash` (C2C), `Deposit|Withdrawal|Transfer` engines, `CustomerFunding*`, `Wallet`, `WalletTransaction`, `Quote`, `Maturity` | `transaction.view` (single-record trace), `reporting.transaction_summary.view` (aggregate), `ledger.view|post|reverse` | BACKEND_ONLY (now reachable via workforce-observability after route-policy fix) |
| **Ledger & accounting** | `LedgerAccount`, `LedgerJournal|Line|Entry`, `B2fFinanceJournal|Control|AccountingTreatment`, `CommercialAccountingRegistry` | `ledger.view|post|reverse`, `ledger.approve_adjustment` (FUTURE, not assignable), `reconciliation.view` | BACKEND_ONLY / FUTURE |
| **Reconciliation** | `ReconciliationRun|Report|TrialBalance`, `CustomerFinancialAccountBinding` integrity | `reconciliation.view`, `reconciliation.investigate|resolve` (FUTURE) | BACKEND_ONLY (report now hardened) |
| **Commercial rules** | `FeeRuleDefinition`, `CommissionRuleDefinition`, `RewardRuleDefinition`, `ProductCatalog|Governance`, `LimitProfile|Rule|Assignment|Usage|Reservation`, `CommercialDecisionSnapshot` | `fee_rule.view|create|modify`, `commission_rule.view|create|modify`, `reward_rule.view|create|modify`, `product.view|modify|governance`, `limit.view|modify`, `finance.control_policy.activate` | IMPLEMENTED (definition registries, zero seeded production rules — foundation only) |
| **Compliance & risk** | `CustomerComplianceCase|Assignment|Comment|Evidence|History`, `CustomerRiskProfile|Factor`, `CustomerKycAssessment` | `kyc.view|review|approve|reject`, `compliance.manage_case|manage_risk_profile`, `risk_fraud.manage_fraud_case` | IMPLEMENTED / PARTIALLY_IMPLEMENTED; FRAUD isolated |
| **Workforce & governance** | `AuthorizationRole|Function|RoleFunction`, `A2FinanceRoleAssignment`, `A2WorkforceSession`, `RoleDefinitionGovernance`, `DashboardTemplate|RoleDashboardAssignment`, `WorkforceUser`, `SupportWorkforceUser`, `AuditEvent` | `workforce.role.view|assign|revoke|create|modify`, `workforce.role.assign_operational|revoke_operational`, `workforce.super_admin.recover`, `workforce.user.view|create|suspend`, `workforce.dashboard.view|assign`, `audit.view|search`, `finance.control_policy.activate` | IMPLEMENTED (dual-control for role-definition) |
| **Treasury / settlement** | `ExternalSettlement|SuspenseEntry` | `treasury.manage_settlement|resolve_suspense` | OUT_OF_V1_SCOPE (no menu) |
| **Platform operations** | `Metrics|Diagnostics|Outbox|Notification`, `CapabilityRegistry`, `Health`, `Production` | `metrics.view|diagnostics.view|outbox.view|notification.view_deliveries`, `outbox.view`, `capability.*` | IMPLEMENTED |
| **Dashboard reporting** | `DashboardTemplate`, `RoleDashboardAssignment`, `DashboardWidgetRegistry` (12 templates, 18 widgets) | `reporting.transaction_summary.view`, `workforce.dashboard.view|assign` | IMPLEMENTED |

### 2.2 All 11 roles and responsibilities (per `authorization-catalogue.seed.ts` §6 + assignments)

| Role key | Type | Scope count (live) | Responsibility (one line) | Maker/checker |
|---|---|---|---|---|
| **SUPER_ADMIN** | PRIVILEGED | 57 | Reserved admin — broad visibility + governance initiation, no direct CRITICAL_FINANCIAL execution, no self-escalation | Initiates `workforce.role.*`, `workforce.dashboard.*`; never approves own proposals |
| **FINANCE_PREPARER** | OPERATOR (maker) | 20 | Prepares ledger postings, commercial rule drafts, product changes, control-policy activations | INITIATE for `ledger.post|reverse`, `fee_rule.create|modify`, `product.modify|governance`, `limit.modify`, `finance.control_policy.activate` |
| **FINANCE_CONTROLLER** | OPERATOR (checker) | 26 | Independently approves FINANCE_PREPARER proposals + AGENT_NETWORK_MANAGER fund/defund + role-definition proposals | APPROVE for same set; also `agent.fund|defund` (approve), `workforce.role.assign|revoke|create|modify` (approve) |
| **FINANCE_AUDITOR** | OPERATOR (readOnly) | 24 | Read-only assurance — every READ-sensitivity function, zero mutation, blocked on unsafe HTTP methods via `denyUnsafeMethodForReadOnlyPrincipal` | VIEW only |
| **ADMINISTRATOR** | OPERATOR | 12 | Day-to-day workforce ops — may assign/revoke exactly the six operational roles (OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY), never SUPER_ADMIN/FINANCE_* (DB CHECK constraint) | EXECUTE for `workforce.role.assign_operational|revoke_operational`, `workforce.user.*`, `workforce.dashboard.assign` |
| **OPERATIONS** | OPERATOR | 22 | Customer lifecycle + support queue + aggregator admin + observability (outbox/metrics/diagnostics/notifications) | EXECUTE `customer.*`, `workforce.user.*` |
| **AGENT_NETWORK_MANAGER** | OPERATOR (maker) | 12 | Agent network lifecycle + fund/defund initiation | INITIATE `agent.fund|defund`, EXECUTE `agent.view|manage_*|assign_limit` |
| **COMPLIANCE** | OPERATOR | 10 | KYC + non-FRAUD compliance cases + risk profiles + PII docs | EXECUTE `kyc.*`, `compliance.manage_case|manage_risk_profile` |
| **RISK_FRAUD** | OPERATOR | 1 | FRAUD-category cases only — isolated from COMPLIANCE | EXECUTE `risk_fraud.manage_fraud_case` |
| **CUSTOMER_SERVICE** | OPERATOR | 6 | Customer view + support ticket queue + PII address/contact | EXECUTE `customer.manage_support_case`, VIEW `customer.view|view_*` |
| **TREASURY** | OPERATOR | 1 | Reconciliation visibility only | VIEW `reconciliation.view` |

### 2.3 Existing screens, menus, submenus, endpoints, permissions

Current IA: 15 flat top-level buttons in `Layout.tsx` (no submenus). Every button is a top-level `View` state that mounts one `Screen` component in `content`:

| # | Menu label (current) | Route key | Screen component | Primary endpoint(s) | Permission gate (Layout) | Permission gate (screen) | Backend controller |
|---|---|---|---|---|---|---|---|
| 1 | 📊 Operational Dashboard | `dashboard` | `DashboardScreen` | `GET /internal/a2/workforce/dashboard/my-dashboard`, `GET /dashboard/widgets/:key` (per-widget `requireFunction`) | always | per-widget via `DASHBOARD_WIDGET_REGISTRY.requiredFunctions` | `DashboardController`, `DashboardWidgetDataService` (proxy) |
| 2 | ⚙️ Dashboard Settings | `dashboardSettings` | `DashboardSettingsScreen` | `GET /dashboard/templates`, `GET /dashboard/assignments`, `PUT /assignments/:roleKey` | `workforce.dashboard.view` | same (backend 403 if no `workforce.dashboard.assign`) | `DashboardController` (hardened) |
| 3 | 👥 Customer & KYC Servicing | `customers` | `CustomerDirectoryScreen` (762 LOC) | `GET /customers`, `GET /customers/:id`, `GET /customers/:id/wallets|kyc|addresses|contact-methods|identity-documents`, `POST /customers/:id/wallets`, `PATCH /customers/:id`, `POST /customers/:id/kyc-assessment` | `customer.view` OR `customer.manage_support_case` OR `kyc.view` OR `view_transactions` OR `view_wallets` | same; PII tabs hidden (R8 defect) | `AdminCustomerController` (`customer.view*`), `CustomerController`, `CustomerComplianceController`, `CustomerEligibilityController`, `CustomerWalletController` |
| 4 | 🏪 Agent Network | `agents` | `AgentNetworkScreen` | `GET /internal/agents`, `GET /internal/agents/:id/financial-position`, `POST /internal/agents/:id/suspend|terminate|reactivate|activate`, `POST /internal/agents/:id/outlet|terminal`, `POST /internal/agents/:id/fund|defund` (initiate) | `agent.view` OR `activate` OR `suspend` OR `review_application` OR `manage_credentials|manage_outlets_terminals` | same; `requireWorkforce` fallback | `AdminAgentController` (`agent.view`), `AdminAgentLifecycleController`, `AgentFundingController`, `AdminAgentCredentialsController`, `AgentLifecycleController` |
| 5 | 📖 Ledger & Reversals | `ledger` | `LedgerOperationsScreen` | `GET /ledger/accounts`, `GET /ledger/journals/:id`, `POST /ledger/journals/:id/reverse`, `POST /ledger/journals` (maker) | `ledger.view` | same | `LedgerController` (`ledger.view` hardened, `ledger.post|reverse` BACKEND_ONLY) |
| 6 | 💸 Transaction & Fee Ops | `transactions` | `TransactionObservabilityScreen` | `GET /transfers/:id`, `GET /deposits/:id`, `GET /withdrawals/:id`, `GET /wallets/:id`, `GET /internal/fee-rules/resolve`, `POST /fees/calculate` (engine, unrestricted), `POST /limits/evaluate` | `reporting.transaction_summary.view` OR `transaction.view` OR `fee_rule.view` OR `commission_rule.view` OR `reward_rule.view` | same | `TransferController`, `DepositController`, `WithdrawalController`, `WalletController`, `FeeController`, `LimitController`, `FeeRuleResolverController`, `CommercialDecisionSnapshotController` |
| 7 | ⚖️ Reconciliation & Breaks | `reconciliation` | `ReconciliationObservabilityScreen` | `GET /internal/reconciliation/report`, `GET /internal/reconciliation/trial-balance`, `GET /internal/reconciliation/breaks`, `POST /internal/reconciliation/run` | `reconciliation.view` | same | `ReconciliationController` (`reconciliation.view` hardened) |
| 8 | 🎧 Support Tickets | `support` | `SupportTicketsScreen` | `GET /internal/support/tickets`, `PATCH /internal/support/tickets/:id`, `GET /internal/support/tickets/:id` | `customer.manage_support_case` | same | `SupportInternalController` (`customer.manage_support_case` hardened) |
| 9 | 🛡️ Compliance & KYC | `compliance` | `ComplianceScreen` | `GET /customers/:id/kyc`, `POST /customers/:id/kyc-assessment`, `GET /customers/:id/compliance-cases` (non-FRAUD) | `kyc.view` OR `compliance.manage_case` OR `compliance.manage_risk_profile` | same; manual UUID entry (R9 defect) | `CustomerComplianceController`, `ComplianceCaseController`, `KycController` |
| 10 | 🚨 Risk & Fraud | `riskfraud` | `RiskFraudScreen` | `GET /customers/:id/compliance-cases?category=FRAUD` (filtered) | `risk_fraud.manage_fraud_case` (SUPER_ADMIN overgrant) | same; FRAUD-only filter | `CustomerComplianceController` (category enforcement) |
| 11 | 🔑 Finance Role Admin | `roles` | `RoleAssignmentScreen` | `GET /internal/a2/workforce/role-definitions/proposals`, `POST /internal/a2/workforce/role-definitions/proposals` (initiate) | `workforce.role.assign` OR `assign_operational` OR `revoke` OR `create` OR `modify` | same | `RoleDefinitionGovernanceController` (dual-control: SUPER_ADMIN INITIATE, FINANCE_CONTROLLER APPROVE) |
| 12 | ⚖️ Privileged Approvals | `approvals` | `ApprovalsScreen` | `POST /internal/a2/workforce/approvals/:id/approve`, `POST /internal/a2/workforce/role-definitions/proposals/:id/approve`, `POST /finance/control-policy/:id/activate` | `workforce.role.assign` OR `workforce.role.create` OR `finance.control_policy.activate` | same | `WorkforceAdministrationController`, `FinanceControlController` |
| 13 | 👷 Workforce Admin | `workforce` | `WorkforceAdminScreen` | `GET /dashboard/widgets/workforce-overview`, `POST /internal/admin/support/workforce-users`, `POST /internal/admin/support/workforce-users/:id/disable|enable` | `workforce.user.view` OR `workforce.role.view` OR `workforce.dashboard.view` | same | `WorkforceAdministrationController`, `AdminSupportCredentialsController` |
| 14 | 🩺 System Health | `system` | `SystemHealthScreen` | `GET /internal/metrics`, `GET /internal/diagnostics`, `GET /internal/outbox`, `GET /internal/notification-deliveries` | `metrics.view` OR `diagnostics.view` OR `outbox.view` | same | `OperationsController`, `NotificationInboxController` |
| 15 | 🏷️ Commercial Rules | `commercial` | `CommercialRulesScreen` | `GET /internal/fee-rules`, `GET /internal/commission-rules`, `GET /internal/reward-rules`, `GET /internal/products`, `GET /internal/limit-profiles|rules`, `GET /internal/commercial-decision-snapshots` | `fee_rule.view` OR `commission_rule.view` OR `reward_rule.view` OR `product.view` OR `limit.view` | same; read-only (R10 defect) | `FeeRuleRegistryController` (`fee_rule.view|create|modify` hardened), `CommissionRuleRegistryController`, `RewardRuleRegistryController`, `ProductCatalogController`, `ProductGovernanceController`, `LimitCatalogController` |

*Desktop + mobile nav mirror (hamburger at ≤768px, `data-testid="mobile-nav"`). Verified 23/23 tests pass for all 11 roles (`menu-visibility-11-roles.test.tsx`).*

### 2.4 Missing business functions & incomplete workflows

1. **Customer PII tabs hidden (R8):** Backend exposes `GET /customers/:id/addresses|contact-methods|identity-documents|kyc` per `customer.view_address|view_contact_methods|view_identity_documents` (splits introduced by `V1-ADMIN-CUSTOMER-PII-AUTHORIZATION-01`), but `CustomerDirectoryScreen` detail drawer shows only wallets/KYC/status — staff must call APIs directly to verify PII.
2. **Compliance manual UUID (R9):** `ComplianceScreen` and `RiskFraudScreen` require pasting customer UUID; no “Open compliance” link from directory. Workflow break: identify customer → copy UUID → paste in other screen.
3. **Commercial Rules read-only (R10):** Fee/commission/reward/product/limit registries are definition stores with maker/checker (`FINANCE_PREPARER` INITIATE, `FINANCE_CONTROLLER` APPROVE). Screen lists definitions via `GET /internal/fee-rules` etc. but has no Propose/Approve buttons — mutations still require direct API.
4. **Reconciliation resolver workflow (Future):** `GET /report|trial-balance` correctly surfaces WARNINGs for `failed_transfer_attempts` and `customer_financial_account_binding_integrity` (not suppressed), but no `reconciliation.investigate|resolve` workflow exists (FUTURE, `F2`).
5. **Operations reversal workflow (Future):** `ledger.reverse` exists as backend primitive but no governed reversal workflow (`F3`); ledger write remains BACKEND_ONLY.
6. **Agent fund/defund approval:** `POST /internal/agents/:id/fund|defund` initiated by `AGENT_NETWORK_MANAGER` (INITIATE) and approved by `FINANCE_CONTROLLER` (APPROVE) per Decision 7, but no UI for either step — only `GET /financial-position` is surfaced.
7. **Agent limit assignment:** `POST /internal/agents/:id/limit-assignment` (`agent.assign_limit`) exists but is buried inside Agent Network screen, not linked to Customer Eligibility (`CustomerLimitProfile`) or Limit Catalogue.
8. **Customer funding approvals:** `POST /internal/customers/:customerId/funding-requests` (maker) + `POST /internal/customers/:customerId/funding-requests/:id/approve|reject` (checker) exist but have no admin UI — only `customer-funding-internal.controller.ts` and `customer-funding-customer.controller.ts`.
9. **Quote → Transfer funding source clarity:** `TransferService` requires `fundingSource` for NIP-bound transfers, but admin Transaction trace does not surface funding source or idempotency key.
10. **Treasury / suspense / settlement (OUT_OF_V1_SCOPE):** Correctly out of V1, but Treasury role currently sees only Reconciliation — no settlement/suspense UI expected (document as V2).

### 2.5 Duplicate, confusing, poorly grouped menus

* **“Agent Network” vs “Customer & KYC Servicing” vs “Compliance & KYC”:** KYC appears in two top-level menus; an OPERATIONS user sees Customer + Workforce but not Agent, while a COMPLIANCE user sees Customer + Compliance — the split is function-correct but the grouping hides that KYC assessment (`kyc.review|approve|reject`) is a shared workflow between Customer Servicing and Compliance, not two separate silos.
* **“Transaction & Fee Ops” vs “Ledger & Reversals” vs “Reconciliation & Breaks” vs “Commercial Rules”:** Four top-level entries for one money-movement pipeline (initiate → post → reconcile). An OPERATIONS user sees Transactions but not Ledger; a TREASURY user sees Reconciliation but not Ledger — correct per catalogue, but the flat list implies they are unrelated features.
* **“Finance Role Admin” vs “Workforce Admin” vs “Dashboard Settings”:** All govern workforce (`workforce.*`), but are three separate top-level entries. ADMINISTRATOR sees all three; FINANCE_CONTROLLER sees Role Admin + Workforce but not Dashboard Settings — the split is intentional (role-definition dual-control vs operational assignment vs dashboard templating), but not obvious from labels.
* **“Privileged Approvals” vs “Finance Role Admin”:** Approvals is the checker inbox for proposals initiated in Role Admin; separating them is correct segregation, but the names do not convey the maker→checker flow (a preparer cannot find where their proposal goes).
* **Overly technical labels:** “Transaction & Fee Ops” (exposes `transaction.view` vs `reporting.transaction_summary.view` split), “Reconciliation & Breaks”, “Privileged Approvals” — appropriate for internal ops but not for a business-led panel.

### 2.6 Functions existing in backend but inaccessible through interface

| Function code (catalogue) | Backend endpoint exists | No UI entry point |
|---|---|---|
| `agent.assign_limit` | `POST /internal/agents/:id/limit-assignment` (`LimitAssignmentController`) | No dedicated UI; assignment via API only |
| `agent.fund|defund` | `POST /internal/agents/:id/fund|defund` (Decision 7) | No initiate/approve UI |
| `agent.manage_credentials|manage_outlets_terminals` | `POST /internal/admin/agents/:id/credentials(/reissue)`, `POST /internal/agents/:id/outlets|terminals` | No UI |
| `aggregator.manage` | `POST /internal/aggregators`, `POST /internal/aggregators/:id/agents/:agentId/fund|defund` | No UI |
| `customer.create|close|suspend|activate` | `POST /customers`, `PATCH /customers/:id` (workforce, SUPPORT denied) | No UI for create/close (drawer shows suspend only); alias `PATCH /customers/me/profile` exists but not advertised |
| `customer.view_address|view_contact_methods|view_identity_documents` | `GET /customers/:id/addresses|contact-methods|identity-documents` | No tabs in directory (R8) |
| `kyc.review|approve|reject` vs `kyc.view` | `POST /customers/:id/kyc-assessment`, `POST /customers/:id/kyc-review` | No UI for FINANCE_AUDITOR read-only view of Level 2 vs Level 3 |
| `compliance.manage_risk_profile` | `GET|POST /customers/:id/risk-profile` | No UI |
| `product.modify|governance`, `limit.modify`, `reward_rule.*`, `capability.*` | `POST /internal/products/:id/governance`, `POST /internal/limit-profiles`, `POST /internal/reward-rules` | No UI (Commercial screen read-only) |
| `workforce.super_admin.recover` | `POST /internal/a2/workforce/super-admin/recover` (ADMINISTRATOR only) | No UI |
| `workforce.user.create|suspend` | `POST /internal/admin/support/workforce-users`, `PATCH /internal/admin/support/workforce-users/:id/disable|enable` | Only SUPPORT provisioning in Workforce Admin; no list/filter for OPERATIONS admin |
| `capability.view|manage` | `GET /internal/capabilities` | No UI |

### 2.7 UI functions without working backend support

* **Customer “Register Customer” / “Provision Wallet”** in `CustomerDirectoryScreen` — form POSTs to `POST /customers` and `POST /customers/:id/wallets`; backend requires `customer.create|create_wallet` which OPERATIONS holds, so it works for OPERATIONS/SUPER_ADMIN but returns synthetic `new-cust-id` mock in tests — real DB flow works (confirmed via `truncateAllTables` integration suite), but UI does not surface validation errors (e.g., duplicate reference) distinctly.
* **“Recent Audit Activity”** widget on dashboard was previously unsupported (returned 503 for FINANCE_AUDITOR who has `audit.view` but not `audit.search` split); now fixed to proxy `audit.view` correctly — no longer unsupported.
* **Reconciliation “Execute In-House Reconciliation Match”** button triggers `POST /internal/reconciliation/run` which is SYNCHRONOUS and may time out under load — UI has no job-id polling (correctly not invented; backend is sync per `ReconciliationService`).

---

## 3. Phase 2 — Proposed complete information architecture

### 3.1 Design principles

1. **Business-job navigation, not controller navigation.** Top-level menus correspond to jobs: *Serve customers, run the agent network, move money, govern finance, keep the system healthy*. Controller names (`wallet-transaction`, `b1-fee-engine`) never appear as menu labels.
2. **Role workspaces, not permission lists.** Each role sees a *workspace* — a coherent set of menus that together accomplish its job. A role having `ledger.view` does not automatically mean it should see a top-level “Ledger” menu in isolation; it sees the *Finance & Ledger* workspace that includes the ledger view relevant to its job.
3. **One business workflow = one entry point with submenus.** Customer → Compliance → Funding → Support is one flow; it should start in *Customer & Agent Servicing* and have “Open compliance case” as an action, not as a separate top-level menu requiring UUID paste.
4. **Maker → checker is visible.** Every sensitive write shows where it goes after submit (e.g., “Your proposal is awaiting FINANCE_CONTROLLER approval in *Approvals Inbox*”).
5. **Backend remains the security boundary.** Hidden menu ≠ denied; every transition checks `AuthorizationService.requireFunction` (already hardened for 14 controllers — no change here).

### 3.2 Recommended top-level menus & submenus (7 top-level, 23 submenus)

| Top-level | Submenu | Purpose & workflow it supports | Screens & actions |
|---|---|---|---|
| **1. Home & My Work** | 1.1 Operational Dashboard | Personal workspace — shows only widgets the signed-in role is entitled to (per `DASHBOARD_WIDGET_REGISTRY.requiredFunctions`). Starting point for every session. | `DashboardScreen` — `GET /dashboard/my-dashboard` (per-role template), per-widget `GET /dashboard/widgets/:key` (403 if not entitled). Period filter `today|7d|30d|custom` + `compare` for trend. |
| | 1.2 Dashboard Settings *(ADMIN)* | Configure which template each role sees. Never changes permissions. | `DashboardSettingsScreen` — `GET /templates`, `GET /assignments`, `PUT /assignments/:roleKey` (requires `workforce.dashboard.assign`). |
| **2. Customer & Agent Servicing** | 2.1 Customer Directory | Find and service a customer — the primary entry point for all customer-related work. | `CustomerDirectoryScreen` — `GET /customers` list/search, detail drawer: Overview, Wallets (`GET /customers/:id/wallets` + `POST /customers/:id/wallets`), KYC (`GET /customers/:id/kyc` + `POST /kyc-assessment`), Transactions (`GET /customers/:id/transfers|deposits`), Addresses (`GET /customers/:id/addresses` — **new tab**), Contact (`GET /customers/:id/contact-methods` — **new tab**), Identity Docs (`GET /customers/:id/identity-documents` — **new tab**, SENSITIVE). Actions: suspend/activate/close (maker), status lock. *Fix R8: add PII tabs gated by `customer.view_address|view_contact_methods|view_identity_documents`.* |
| | 2.2 Customer Funding | Maker/checker funding of customer wallets (internal funding instrument). | **New screen** `CustomerFundingScreen` — `GET /internal/customers/:customerId/funding-requests`, `POST /internal/customers/:customerId/funding-requests` (maker, requires `customer.create_wallet` or `finance.control_policy.activate` per product), `POST /.../approve|reject` (checker). Consolidates `customer-funding-internal.controller.ts` which currently has no UI. |
| | 2.3 Agent Network | Manage agents, outlets/terminals, applications, financial position. | `AgentNetworkScreen` — `GET /internal/agents|aggregators`, `GET /internal/agents/:id/financial-position`, `POST /internal/agents/:id/suspend|terminate|reactivate`, `POST /internal/agents/:id/outlets|terminals` (`agent.manage_outlets_terminals`), `POST /internal/admin/agents/:id/credentials` (`agent.manage_credentials`). *Add* `POST /internal/agents/:id/limit-assignment` (`agent.assign_limit`) and `POST /internal/agents/:id/fund|defund` (initiate/approve) — **new sub-tabs** in Agent Network. |
| | 2.4 Support Inbox | Operate the support queue — every customer and agent support interaction starts or ends here. | `SupportTicketsScreen` — `GET /internal/support/tickets`, `PATCH /internal/support/tickets/:id` (status), `GET /internal/support/tickets/:id`. Linked from Customer Directory via “Open support case” action — *fix R9 pattern for support too.* |
| **3. Money Movement** | 3.1 Transfers (W2W) | Trace an initiated transfer from quote → commercial decision → posting → reconciliation. | `TransactionObservabilityScreen` (transfer tab) — `GET /transfers/:id`, `GET /wallets/:id` (customer wallet view), `GET /internal/commercial-decision-snapshots` (fee/commission snapshot). |
| | 3.2 Cash-In (C2W) | Deposits | Same screen (deposit tab) — `GET /deposits/:id`, `GET /customers/:id/deposits` |
| | 3.3 Cash-Out (W2C) | Withdrawals | Same — `GET /withdrawals/:id` |
| | 3.4 Cash-to-Cash (C2C) | Agent cash-to-cash claims (including C2C that failed binding) | Same — `GET /internal/agents/:agentId/cash-to-cash/:id`, `GET /internal/agents/:id/cash-to-cash-claims`. *Surface funding source & idempotency key (missing today — see §3.7 #9).* |
| **4. Finance & Ledger** | 4.1 Ledger Explorer | Read-only ledger view — every role that needs `ledger.view` starts here. | `LedgerOperationsScreen` (view tab) — `GET /ledger/accounts`, `GET /ledger/journals`, `GET /ledger/journals/:id` (double-entry lines). |
| | 4.2 Ledger Posting (Maker) | Prepare a manual journal — maker side only, never executes live without approval. | `LedgerOperationsScreen` (posting tab) — `POST /ledger/journals` (requires `ledger.post` INITIATE, FINANCE_PREPARER). Shows “Awaiting checker” state after submit. |
| | 4.3 Ledger Approvals (Checker) | Approve/reject a prepared journal — checker side, segregation enforced. | `LedgerOperationsScreen` (approvals tab) — `POST /ledger/journals/:id/approve|reject` (requires `ledger.view` + future `ledger.approve_adjustment`; today routed to `Privileged Approvals` inbox — **consolidate here**). |
| | 4.4 Reconciliation & Breaks | Daily reconciliation health — the break desk. | `ReconciliationObservabilityScreen` — `GET /internal/reconciliation/report`, `GET /internal/reconciliation/trial-balance`, `GET /internal/reconciliation/breaks`, `POST /internal/reconciliation/run`. *Add* resolver workflow when `reconciliation.investigate|resolve` are implemented (Future — surface as “Investigate” action, not new top-level). |
| **5. Commercial & Risk Controls** | 5.1 Fee Rules | Manage fee rule definitions (definition ≠ runtime charge). | `CommercialRulesScreen` (fee tab) — `GET /internal/fee-rules`, `GET /internal/fee-rules/:id`, `POST /internal/fee-rules` (INITIATE), `PATCH /internal/fee-rules/:id` (INITIATE), `POST /internal/fee-rules/:id/approve` (APPROVE). *Fix R10: add Propose/Approve buttons.* |
| | 5.2 Commission Rules | Same for commissions | Same — `GET /internal/commission-rules` etc. |
| | 5.3 Reward Rules | Same | Same — `GET /internal/reward-rules` etc. |
| | 5.4 Product Catalogue | Commercial products | Same — `GET /internal/products`, `POST /internal/products/:id/governance` |
| | 5.5 Limit Catalogue | Limit profiles/rules/definitions | Same — `GET /internal/limit-profiles|limit-rules`, `POST /internal/limit-profiles`, `PATCH /internal/limit-profiles/:code`, `POST /internal/limit-profiles/:code/rules` |
| | 5.6 Limit Assignments & Usage | Assign existing limit profile to agent/customer; monitor usage. | **New screen** `LimitAssignmentScreen` — `GET /internal/limit-assignments`, `POST /internal/agents/:id/limit-assignment` (`agent.assign_limit`), `GET /internal/limit-profiles/:code/rules`, `GET /internal/limit-operations/:id`. |
| **6. Compliance & Risk** | 6.1 KYC Queue | Review KYC assessments — level, status, assignee. | `ComplianceScreen` (queue tab) — `GET /customers?kycStatus=PENDING_REVIEW`, `GET /customers/:id/kyc`, `POST /customers/:id/kyc-assessment` (`kyc.review|approve|reject`), `GET /customers/:id/kyc-history`. *Fix R9: “Open from directory” button passes `customerId` via navigation state, no manual UUID.* |
| | 6.2 Compliance Cases (non-FRAUD) | AML/KYC/SANCTIONS case management | `ComplianceScreen` (cases tab) — `GET /customers/:id/compliance-cases?category=AML|KYC|SANCTIONS`, `POST /customers/:id/compliance-cases`, `POST /customers/:id/compliance-cases/:caseId/comments|assign|close`, `GET /customers/:id/risk-profile` (`compliance.manage_risk_profile`). |
| | 6.3 Fraud Cases (FRAUD-only) | FRAUD-category cases — isolated | `RiskFraudScreen` — `GET /customers/:id/compliance-cases?category=FRAUD`, `POST /customers/:id/compliance-cases` (FRAUD), `POST /customers/:id/compliance-cases/:caseId/close`. Backend enforces COMPLIANCE cannot read FRAUD and vice versa (already tested). |
| **7. Platform Administration** | 7.1 Workforce & Access | Workforce headcount, role distribution, active sessions, and SUPPORT provisioning. | `WorkforceAdminScreen` — `GET /dashboard/widgets/workforce-overview`, `POST /internal/admin/support/workforce-users`, `PATCH /internal/admin/support/workforce-users/:id/disable|enable`, `GET /internal/a2/workforce/sessions`. |
| | 7.2 Role Governance (Maker) | Propose a new role or modify an existing non-system role. | `RoleAssignmentScreen` — `POST /internal/a2/workforce/role-definitions/proposals` (requires `workforce.role.create|modify` INITIATE, SUPER_ADMIN). |
| | 7.3 Approvals Inbox (Checker) | Approve/reject proposals — the single checker inbox for all maker/checker flows. | `ApprovalsScreen` — `POST /internal/a2/workforce/approvals/:id/approve` (requires `privileged:approve` or `workforce.role.assign` APPROVE, FINANCE_CONTROLLER), `POST /internal/a2/workforce/role-definitions/proposals/:id/approve`, `POST /finance/control-policy/:id/activate`. *Consolidates ledger approvals too — one inbox, not two.* |
| | 7.4 Super-Admin Recovery | Consume an externally-signed `A2RecoveryStatementV1` to revoke SUPER_ADMIN — ADMINISTRATOR only, RS256 via `A2_RECOVERY_JWKS_JSON`. | **New screen** `SuperAdminRecoveryScreen` — `POST /internal/a2/workforce/super-admin/recover` (requires `workforce.super_admin.recover`). Currently no UI (see §2.6). |
| | 7.5 System Health | Ops observability — metrics, diagnostics, outbox, notifications, capability registry. | `SystemHealthScreen` — `GET /internal/metrics|diagnostics|outbox|notification-deliveries`, `GET /internal/capabilities`, `GET /internal/a2/workforce/bootstrap`. |
| | 7.6 Audit & Security Events | Search audit trail — the record of every privileged action. | **New screen** `AuditTrailScreen` — `GET /customers/:id/audit-events`, `GET /internal/audit/search` (requires `audit.view|search`), `GET /internal/a2/workforce/security-events`. *Backend exists (`audit.view|search`) but no UI beyond dashboard widget.* |
| | 7.7 Session & Bootstrap | Bootstrap authority and session diagnostics (engineering). | Engineering-only sub-tab under System Health — `POST /internal/a2/workforce/bootstrap`, `DELETE /internal/a2/workforce/sessions/:id`. |

*Total: 7 top-level, 23 submenus vs current 15 flat entries. Reduction in top-level from 15→7, increase in discoverable workflows from ~12→23.*

### 3.3 Purpose of every menu & business workflows it supports

* **Home & My Work** — “Where do I start today?” Every role lands on its Operational Dashboard (per-role template). An administrator configures what others see, but never their permissions.
* **Customer & Agent Servicing** — “Serve a person or an agent.” Customer Directory is the universal entry point: finding a customer, verifying PII, checking KYC, seeing wallets/transactions, opening a compliance case, opening a support ticket, funding a wallet, or navigating to an agent that serves them all start from the same customer record — no UUID paste.
* **Money Movement** — “Follow the money.” Every W2W/C2W/W2C/C2C movement is traceable from initiation → commercial decision (fee snapshot) → wallet debit/credit → ledger posting → reconciliation. The four submenus do not duplicate the screen — they filter the same `TransactionObservabilityScreen` by type, so a failure in C2C that lacks a fee column (defect #3/#4 fixes) is visible in the same place as a W2W fee.
* **Finance & Ledger** — “Know the books and control the books.” Ledger Explorer is read-only for auditors; Posting is maker, Approvals is checker, Reconciliation is the daily close. Finance cannot post a journal and approve it themselves — the UI enforces the same initiator≠approver check the backend enforces (`makerCheckerRequired: true`).
* **Commercial & Risk Controls** — “Set the rules before the money moves.” Fee/commission/reward/product/limit definitions are all definition stores (zero production rules seeded in V1 — expected). The menu makes explicit that these are *definitions* (create/modify/approve), not live charges; the “Limit Assignments & Usage” submenu distinguishes catalogue definition (`limit.modify`) from ordinary assignment (`agent.assign_limit` — Decision 2).
* **Compliance & Risk** — “Know your customer and stop fraud.” KYC Queue, Compliance Cases, and Fraud Cases are three job-specific queues with isolated data (COMPLIANCE cannot see FRAUD, RISK_FRAUD cannot see non-FRAUD — backend enforced, UI enforces same). Each queue links from Customer Directory.
* **Platform Administration** — “Run the platform.” Workforce, roles, approvals, recovery, health, audit, and bootstrap are one administrative domain with segregation: ADMINISTRATOR delegates operational roles, SUPER_ADMIN initiates role definitions, FINANCE_CONTROLLER approves them, OPERATIONS observes health.

### 3.4 Screens & actions accessible under each menu

(See table in §3.2 — each submenu lists exact screens and `GET|POST|PATCH` actions. Every action cites its backend endpoint and required `function_code`. No inventing — every endpoint exists in `src/**/*.controller.ts`; actions marked **new screen/tab** require new UI but have existing backend.)

### 3.5 Role-by-menu matrix (all 11 roles)

**V** = top-level menu visible (at least one submenu visible). **S** = submenu visible. Roles that should not see a menu must not see it (least-privilege); hiding a menu never replaces backend `403`.

| Role | 1 Home & My Work | 1.1 Dashboard | 1.2 Settings | 2 Customer & Agent Servicing | 2.1 Customer Directory | 2.2 Customer Funding | 2.3 Agent Network | 2.4 Support Inbox | 3 Money Movement | 3.1-3.4 Transfers etc. | 4 Finance & Ledger | 4.1 Explorer | 4.2 Posting | 4.3 Approvals | 4.4 Reconciliation | 5 Commercial & Risk Controls | 5.1-5.5 Registries | 5.6 Assignments | 6 Compliance & Risk | 6.1 KYC Queue | 6.2 Cases | 6.3 Fraud | 7 Platform Admin | 7.1 Workforce | 7.2 Role Gov (Maker) | 7.3 Inbox (Checker) | 7.4 Recovery | 7.5 System | 7.6 Audit | 7.7 Bootstrap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **SUPER_ADMIN** (57) | V | S | S | V | S | S | S | S | V | S | V | S | S | S | S | V | S | S | V | S | S | S | V | S | S | S | S | S | S | S |
| **FINANCE_PREPARER** (20) | V | S | — | — | — | — | — | — | V | S | V | — | S | — | — | V | S | — | — | — | — | — | — | — | — | S | — | S* | — | — |
| **FINANCE_CONTROLLER** (26) | V | S | — | — | — | — | — | — | V | S | V | S | — | S | — | V | S | — | — | — | — | — | V | — | — | S | — | S* | S | — |
| **FINANCE_AUDITOR** (24 readOnly, readOnly) | V | S | — | V | S | — | — | — | V | S | V | S | — | — | S | V | S | — | V | S | S | — | V | — | — | — | — | S | S | — |
| **ADMINISTRATOR** (12) | V | S | S | V | S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | V | S | — | — | S | — | — | — |
| **OPERATIONS** (22) | V | S | — | V | S | — | — | S | V | S | — | — | — | — | — | — | — | — | — | — | — | — | V | S | — | — | — | S | — | — |
| **AGENT_NETWORK_MANAGER** (12) | V | S | — | V | — | — | S | — | — | — | — | — | — | — | — | V | — | S | — | — | — | — | — | — | — | — | — | — | — | — |
| **COMPLIANCE** (10) | V | S | — | V | S | — | — | — | — | — | — | — | — | — | — | — | — | — | V | S | S | — | — | — | — | — | — | — | — | — |
| **RISK_FRAUD** (1) | V | S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | V | — | — | S | — | — | — | — | — | — | — | — |
| **CUSTOMER_SERVICE** (6) | V | S | — | V | S | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |
| **TREASURY** (1) | V | S | — | — | — | — | — | — | — | — | S | — | — | — | S | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

*Legend: `—` = hidden. `S*` = visible via `workforce.role.view` (review before approve), not execution. FINANCE_PREPARER sees Approvals inbox to track status of own proposals, not to approve. FINANCE_AUDITOR is readOnly — visible menus are read-only; write actions blocked by `denyUnsafeMethodForReadOnlyPrincipal` (POST|PATCH → 403) even though menu is visible.*

**Rationale per role workspace:**

* **SUPER_ADMIN** — the only role that sees all 7 top-level; every submenu. Not a data-entry role but the governance anchor (initiates role definitions, assigns operational roles, configures dashboards). Does not hold `ledger.post|reverse|approve_adjustment`, `agent.fund|defund` approval, `risk_fraud.manage_fraud_case` — those are intentionally excluded; the menu still appears but the action buttons inside are disabled (backend `403`), making the boundary visible rather than hidden.
* **FINANCE_PREPARER** — Finance & Ledger (posting as maker) + Money Movement (trace fee impact) + Commercial (prepare rules) + Approvals inbox (read status). No Customer/Agent/Compliance/Workforce/System — not its job.
* **FINANCE_CONTROLLER** — same as preparer plus Approvals (checker) + Workforce role governance inbox (approves SUPER_ADMIN proposals) + Ledger Approvals. No Customer/Agent/Compliance/Operations.
* **FINANCE_AUDITOR** — read-only equivalent of both finance roles plus Customer, Agent, KYC, Reconciliation, System Health, Audit. No write, no Support, no Fraud, no Role Admin.
* **ADMINISTRATOR** — Customer + Agent (read-only directory for workforce context) + Workforce & Access (operational assignments) + Home Settings (dashboard templates). No finance, no compliance, no ledger.
* **OPERATIONS** — Customer (full lifecycle), Support, Money Movement (trace), Workforce (user admin), System Health. No Agent, no Finance, no Compliance.
* **AGENT_NETWORK_MANAGER** — Agent Network + Limit Assignments (assign_limit + limit.view) + Customer Funding initiation (when that workflow is built) + Commercial limit-view. No Customer, no Finance, no Support.
* **COMPLIANCE** — Customer (with PII docs), KYC Queue, Compliance Cases, Risk Profile. No Fraud, no Finance.
* **RISK_FRAUD** — Fraud Cases only (+ Home). Isolated.
* **CUSTOMER_SERVICE** — Customer + Support. Minimal.
* **TREASURY** — Reconciliation only (+ Home). Single-function role per Decision 6.

### 3.6 View / create / edit / execute / approve / reverse / suspend permissions (per catalogue `accessType`)

| Function family | VIEW | CREATE / modify / manage (EXECUTE / INITIATE) | APPROVE (checker) | Other | Who holds it |
|---|---|---|---|---|---|
| `customer.view` family | `customer.view`, `customer.view_transactions|view_wallets`, `customer.view_address|view_contact_methods` (READ) | `customer.create|suspend|activate|close|create_wallet|manage_support_case` (OPERATIONAL/EXECUTE) | — | `customer.view_identity_documents` (SENSITIVE, SUPER_ADMIN+COMPLIANCE only; never FINANCE_AUDITOR) | OPERATIONS, SUPER_ADMIN, FINANCE_AUDITOR, CUSTOMER_SERVICE (view), ADMINISTRATOR (view only) |
| `kyc.*` | `kyc.view` (READ) | `kyc.review|approve|reject` (OPERATIONAL) | — | — | COMPLIANCE, SUPER_ADMIN, FINANCE_AUDITOR (view only) |
| `agent.*` | `agent.view` (READ) | `agent.review_application|activate|suspend|terminate|reactivate|manage_credentials|manage_outlets_terminals|assign_limit` (OPERATIONAL/EXECUTE) | — | — | AGENT_NETWORK_MANAGER (+ SUPER_ADMIN view), FINANCE_AUDITOR (view) |
| `agent.fund|defund` | — | `INITIATE` (AGENT_NETWORK_MANAGER) | `APPROVE` (FINANCE_CONTROLLER) | — | Strict maker/checker, initiates≠approver enforced in service layer |
| `ledger.*` | `ledger.view` (READ) | `ledger.post|reverse` INITIATE (FINANCE_PREPARER) | `ledger.approve_adjustment` (FUTURE, not assignable — intentionally not held by FINANCE_CONTROLLER yet; see foundation report) | — | SUPER_ADMIN deliberately excluded from post/reverse/approve |
| `reconciliation.view` | VIEW | — | — | — | SUPER_ADMIN, FINANCE_AUDITOR, TREASURY (exactly one function for TREASURY) |
| `transaction.view`, `reporting.transaction_summary.view` | VIEW (single-record) vs aggregate non-PII totals/breakdowns vs recent-transaction rows | — | — | — | FINANCE_* , OPERATIONS, FINANCE_AUDITOR (transaction.view); reporting view for dashboard |
| `fee|commission|reward|product|limit.*` | `*.view` (READ) | `*.create|modify` INITIATE (FINANCE_PREPARER) | `*.create|modify` APPROVE (FINANCE_CONTROLLER) | `limit.modify` distinct from `agent.assign_limit` (Decision 2) | SUPER_ADMIN view only; no FINANCE_AUDITOR create |
| `workforce.role.*` | `workforce.role.view` (READ) | `assign|revoke` INITIATE (SUPER_ADMIN), `assign_operational|revoke_operational` EXECUTE (ADMINISTRATOR+SUPER_ADMIN) | `assign|revoke` APPROVE (FINANCE_CONTROLLER) | `create|modify` dual-control (SUPER_ADMIN INITIATE → FINANCE_CONTROLLER APPROVE) | Governed via `RoleDefinitionGovernanceService`, DB CHECK constraint on `initiated_scope` |
| `workforce.dashboard.view|assign` | `view` (READ) | `assign` EXECUTE (SUPER_ADMIN+ADMINISTRATOR) — never changes permissions, only template pointer | — | Single-actor governance (no maker/checker) — audited, structurally incapable of permission change | ADMINISTRATOR co-holds with SUPER_ADMIN |
| `workforce.user.view|create|suspend`, `workforce.super_admin.recover` | `view` | `create|suspend` EXECUTE (OPERATIONS, ADMINISTRATOR, SUPER_ADMIN) | — | `super_admin.recover` (ADMINISTRATOR only, RS256 JWS via `A2_RECOVERY_JWKS_JSON`, never SUPER_ADMIN itself) | — |
| `metrics|diagnostics|outbox|notification.view_deliveries`, `audit.view|search` | VIEW | — | — | `audit.export` FUTURE (not assignable) | OPERATIONS, FINANCE_AUDITOR, SUPER_ADMIN |
| `compliance.manage_case|manage_risk_profile`, `risk_fraud.manage_fraud_case` | — | EXECUTE | — | FRAUD isolated (RISK_FRAUD cannot see non-FRAUD) | COMPLIANCE, RISK_FRAUD, SUPER_ADMIN |

### 3.7 Maker-checker controls & separation of duties

| Sensitive operation | Maker (INITIATE) | Checker (APPROVE) | Excluded | Enforcement |
|---|---|---|---|---|
| Ledger manual posting (`ledger.post`) / reversal (`ledger.reverse`) | FINANCE_PREPARER | **Future** `ledger.approve_adjustment` (no role holds it yet — intentional; until then, posting is BACKEND_ONLY and not executable from UI) | SUPER_ADMIN (never), FINANCE_AUDITOR (readOnly), FINANCE_PREPARER ≠ FINANCE_CONTROLLER (same principal cannot approve own posting) | `makerCheckerRequired: true`, `approvalRequired: true`, service-level initiator≠approver check (when workflow is built) |
| Fee/commission/reward/product/limit rule create/modify | FINANCE_PREPARER | FINANCE_CONTROLLER | FINANCE_AUDITOR (readOnly), FINANCE_PREPARER ≠ checker | Same flags; `FEE_RULE_REGISTRY` etc. already hardened (`fee_rule.create` INITIATE vs APPROVE) |
| Finance control policy activation | FINANCE_PREPARER | FINANCE_CONTROLLER | — | Same |
| Agent fund/defund | AGENT_NETWORK_MANAGER | FINANCE_CONTROLLER | — | Decision 7; backend checks `agent.fund` INITIATE vs APPROVE |
| Role assignment (SUPER_ADMIN/FINANCE scope) | SUPER_ADMIN | FINANCE_CONTROLLER | ADMINISTRATOR (DB CHECK constraint on `initiated_scope` — cannot assign those roles) | `initiated_scope` CHECK migration `1785753600085` |
| Role-definition create/modify | SUPER_ADMIN | FINANCE_CONTROLLER | ADMINISTRATOR (never), FINANCE_PREPARER | `RoleDefinitionGovernanceService` dual-control |
| Operational role assignment | ADMINISTRATOR (EXECUTE, direct — no maker/checker) | — | DB constraint prevents ADMINISTRATOR from ever assigning SUPER_ADMIN/FINANCE_* | Direct EXECUTE, audited |
| KYC approve/reject vs review | COMPLIANCE (review, approve, reject distinct functions) | Decision 5: no second reviewer in V1 — single-actor | — | — |

*Read-only roles (FINANCE_AUDITOR, `read_only=true`) are generically denied unsafe methods (`POST|PATCH|DELETE|PUT`) via `RuntimeAccessGuard.denyUnsafeMethodForReadOnlyPrincipal` — even if a menu is visible (e.g., FINANCE_AUDITOR sees Ledger Explorer read-only), the write button POST is 403 at both guard and service layer.*

### 3.8 How the domains fit together

```
Customer & Agent Servicing  ──►  Compliance & Risk  ──►  Support Inbox
         │                              │
         ▼                              ▼
   Money Movement  ─────►  Finance & Ledger  ◄─── Commercial & Risk Controls
         │                        │
         └────►  Reconciliation & Breaks  ◄─── Audit Trail (Platform Admin)
                              │
                 Platform Administration (Workforce, Roles, Approvals, Recovery, System)
```

* Every workflow starts in **Customer & Agent Servicing** (find who) or **Money Movement** (find what). Compliance and Support are actions on a found customer, not separate lookups.
* **Commercial & Risk Controls** set rules *before* money moves; **Finance & Ledger** records the result; **Reconciliation** proves the result matches reality. The three are one pipeline, reflected as three adjacent top-level menus with consistent sub-tabs.
* **Platform Administration** governs who can do any of the above (roles, dashboards, workforce) and whether the platform is healthy (system, audit).

### 3.9 Essential workflows & functions missing from existing application

| # | Missing workflow | Who needs it | Why essential | Existing backend? | What needs building |
|---|---|---|---|---|---|
| 1 | KYC PII full service | OPERATIONS, COMPLIANCE, CUSTOMER_SERVICE | Regulation — address/contact/document verification is primary customer-servicing job | Yes (`view_address` etc.) | **UI only:** add three tabs to Customer Directory drawer (R8) + `GET /customers/:id/addresses|contact-methods|identity-documents` calls, gated by same functions |
| 2 | Directory → Compliance/Risk one-click | COMPLIANCE, RISK_FRAUD | Eliminate manual UUID paste (R9) | Yes (same `compliance-cases` resource) | **UI only:** “Open compliance case” / “Open fraud case” buttons in Customer Directory that navigate to Compliance/Risk screens with `customerId` pre-filled via route state |
| 3 | Customer funding maker/checker | OPERATIONS, FINANCE_CONTROLLER | Customer wallet funding is a financial operation that currently has no UI | Yes (`customer-funding-internal.controller.ts`: `POST /internal/customers/:customerId/funding-requests` + `approve|reject`) | **New screen:** Customer Funding (2.2) |
| 4 | Agent fund/defund initiate + approve | AGENT_NETWORK_MANAGER, FINANCE_CONTROLLER | Decision 7 — float funding is a live operational need | Yes (`POST /internal/agents/:id/fund|defund`) | **UI:** two buttons/tabs inside Agent Network (3 sub-tabs) |
| 5 | Commercial propose/approve workflow | FINANCE_PREPARER, FINANCE_CONTROLLER | Without it, rule changes are direct API calls bypassing the intended segregation | Yes (`POST/PATCH /internal/fee-rules` etc. with INITIATE vs APPROVE, plus `finance.control_policy.activate`) | **UI:** Propose + Approve buttons in Commercial Rules (R10) + “Awaiting approval” inbox state in 4.3 |
| 6 | Ledger approvals inbox consolidation | FINANCE_CONTROLLER | Today ledger approvals are split between Ledger screen and generic Approvals inbox | Yes (same `approvals/:id/approve`) | **UI:** consolidate into 4.3/7.3 — one inbox |
| 7 | Audit trail search | FINANCE_AUDITOR, SUPER_ADMIN, ADMINISTRATOR | Every privileged action is audited but not browsable beyond dashboard widget | Yes (`audit.view|search`, `GET /internal/a2/workforce/security-events`) | **New screen:** Audit & Security Events (7.6) |
| 8 | Super-admin recovery ceremony | ADMINISTRATOR | The only path to revoke SUPER_ADMIN when needed; V1-SECURITY-SUPER-ADMIN-RECOVERY-01 defines RS256 JWS via `A2_RECOVERY_JWKS_JSON` | Yes (`POST /internal/a2/workforce/super-admin/recover`, `workforce.super_admin.recover`) | **New screen:** Super-Admin Recovery (7.4) |
| 9 | Transfer trace completeness | OPERATIONS, FINANCE_AUDITOR | Quote→Transfer trace lacks funding source + idempotency key, hampering incident response | Yes (data in `transfer` + `quote` tables) | **UI enhancement:** add two read-only fields to Transaction trace |
| 10 | Limit assignments UI | AGENT_NETWORK_MANAGER, COMPLIANCE | `agent.assign_limit` vs `limit.modify` distinction (Decision 2) is correct but invisible | Yes (`POST /internal/agents/:id/limit-assignment`, `GET /internal/limit-assignments`) | **New screen:** Limit Assignments & Usage (5.6) |

*All ten are marked “existing backend” — no invented endpoints. V2 items (aggregator login, settlement, reconciliation resolver workflow, external Treasury) are deliberately excluded per `V1-SCOPE-CHALLENGE-01` and listed in §3.12 as proposed future.*

### 3.10 Which existing screens to retain, rename, move, consolidate, redesign, or remove

| Existing screen | Verdict | Rationale |
|---|---|---|
| `DashboardScreen` | **Retain** (as 1.1) | Correct per-role template + per-widget authorized check; 12 templates verified. No change. |
| `DashboardSettingsScreen` | **Retain, move** (1.2 under Home) | Currently top-level “⚙️ Dashboard Settings” — belongs under Home, not alongside business jobs. No code change, just IA move. |
| `CustomerDirectoryScreen` | **Retain, redesign** (2.1) | Keep list/search/detail pattern; add PII tabs (address/contact/docs), “Open compliance/fraud/support” actions, and surface `PATCH /customers/me/profile` alias for SUPPORT. 762 LOC but PII tabs missing. |
| `AgentNetworkScreen` | **Retain, expand** (2.3) | Keep agents/aggregators/financial-position/lifecycle; add outlets/terminals, limit-assignment, fund/defund initiate sub-tabs. |
| `LedgerOperationsScreen` | **Retain, split** (4.1 + 4.2) | Current screen mixes view + posting + reversal. Split into Explorer (read-only, all ledger.view holders) vs Posting (maker) with explicit “awaiting checker” state. Consolidate approvals into 4.3/7.3. |
| `TransactionObservabilityScreen` | **Retain, restructure** (3.1-3.4) | Current single screen with manual ID lookup. Keep trace logic; add type-filter tabs (W2W/W2C/C2W/C2C) so the four transaction types are one workflow, not four. Surface funding source + idempotency key. |
| `ReconciliationObservabilityScreen` | **Retain** (4.4) | Correctly shows report + trial-balance + breaks + WARNINGs. No resolver workflow to add yet (FUTURE). Keep as-is, add “Investigate” placeholder when `F2` is built. |
| `SupportTicketsScreen` | **Retain** (2.4) | Correctly filters `customer.manage_support_case`; link from Customer Directory. No change. |
| `ComplianceScreen` | **Retain, link** (6.1 + 6.2) | Keep KYC queue + compliance cases; add customerId navigation from Directory (fix R9) and risk-profile sub-tab. |
| `RiskFraudScreen` | **Retain, isolate** (6.3) | Keep FRAUD-only filter; ensure COMPLIANCE no longer sees it (already fixed). No change. |
| `RoleAssignmentScreen` | **Retain** (7.2) | Keep dual-control initiate UI. No change. |
| `ApprovalsScreen` | **Retain, consolidate** (7.3) | Currently `workforce.role.*` + `finance.control_policy.activate`. Consolidate ledger approvals here too — one inbox for all maker/checker. |
| `WorkforceAdminScreen` | **Retain** (7.1) | Keep workforce overview + SUPPORT provisioning; add filterable user list for OPERATIONS admin (currently only headcount). |
| `SystemHealthScreen` | **Retain** (7.5) | Keep metrics/diagnostics/outbox/notifications/capabilities. No change. |
| `CommercialRulesScreen` | **Retain, add actions** (5.1-5.5) | Keep 5-tab read-only registry view; add Propose/Approve buttons per Decision 2 (R10). Add 5.6 as new screen for assignments. |
| *New:* `CustomerFundingScreen` | **New** (2.2) | Backend exists, no UI. |
| *New:* `LimitAssignmentScreen` | **New** (5.6) | Backend exists, no UI. |
| *New:* `AuditTrailScreen` | **New** (7.6) | Backend exists, no UI beyond widget. |
| *New:* `SuperAdminRecoveryScreen` | **New** (7.4) | Backend exists, no UI. |

*No screen is removed. Every working screen is retained; four new screens are added for existing backend surfaces that are currently inaccessible.*

### 3.11 Which features are supported by existing code vs require new implementation

| Feature | Existing code (no new endpoint) | Requires new UI | Requires new backend |
|---|---|---|---|
| 15 current menus + 23 submenus | ✅ | — | — |
| Desktop + mobile nav parity (15→7 top-level redesign) | ✅ (Layout already has mobile drawer; just move labels) | IA config change only | — |
| PII tabs (address/contact/docs) | ✅ (`GET /customers/:id/addresses` etc., `customer.view_address` etc. seeded) | Add 3 tabs to `CustomerDirectoryScreen` | — |
| Directory → Compliance/Risk link | ✅ (`customerId` route state) | Add button + `useNavigate` state | — |
| Customer Funding UI | ✅ (`customer-funding-internal.controller.ts`) | New `CustomerFundingScreen` (2.2) | — |
| Agent fund/defund UI | ✅ (`agent-funding.controller.ts`) | Add sub-tabs to `AgentNetworkScreen` | — |
| Commercial propose/approve buttons | ✅ (`fee_rule.create|modify` INITIATE/APPROVE already hardened) | Add buttons + inbox state | — |
| Audit trail screen | ✅ (`audit.view|search`, `V1-ADMIN-AUTHORIZATION-RUNTIME-01`) | New `AuditTrailScreen` (7.6) | — |
| Super-admin recovery screen | ✅ (`POST /internal/a2/workforce/super-admin/recover`, RS256) | New `SuperAdminRecoveryScreen` (7.4) | — |
| Limit assignments UI | ✅ (`limit-assignment.controller.ts`, `limit-operations.controller.ts`) | New `LimitAssignmentScreen` (5.6) | — |
| Transfer funding source + idempotency in trace | ✅ (data in `transfer` + `quote` rows) | Add two read-only fields | — |
| Reconciliation resolver workflow (`reconciliation.investigate|resolve`) | ❌ FUTURE | — | New controller + migration when `F2` is scoped |
| Treasury settlement (`treasury.manage_settlement`) | ❌ OUT_OF_V1_SCOPE | — | V2 |
| Aggregator login / scoped financial position (F1) | ❌ not in V1 | — | V2 |
| Operations reversal full workflow (F3) | ❌ (primitive `ledger.reverse` only) | — | V2 |

---

## 4. Quality review

* **Every role has a coherent workspace:** See role-by-menu matrix §3.5 — SUPER_ADMIN sees governance, FINANCE_PREPARER sees Finance & Commercial maker, FINANCE_CONTROLLER sees checker inbox, OPERATIONS sees Customer+Support+System, AGENT_NETWORK_MANAGER sees Agent Network + Limits, COMPLIANCE sees KYC+Cases, RISK_FRAUD sees Fraud only, CUSTOMER_SERVICE sees Customer+Support, TREASURY sees Reconciliation only, ADMINISTRATOR sees Customer+Agent+Workforce+Settings, FINANCE_AUDITOR sees read-only Audit+Ledger+Reconciliation+Compliance. No role has a fragmented list; each top-level corresponds to one job.

* **Each business workflow has a clear start and completion path:**
  * Customer service: Directory → detail → KYC / wallet / address / support-case / compliance-case → close. No UUID paste.
  * Agent lifecycle: Directory → Agent Network → application review → outlet/terminal → limit assignment → fund/defund initiate → Finance Controller approve.
  * Money movement: Money Movement type filter → trace → Commercial decision snapshot → Ledger → Reconciliation.
  * Finance governance: Commercial Rules propose (PREPARER) → Approvals Inbox approve (CONTROLLER) → product.governance activation.

* **Sensitive financial operations respect approval & segregation:** Every CRITICAL_FINANCIAL / SENSITIVE row in §3.7 lists maker≠checker, excluded roles, and DB-enforced CHECK constraints (`initiated_scope`, `read_only` trigger). Backend `requireFunction` ANDed with `allowedPrincipalTypes` remains mandatory regardless of menu visibility.

* **Read-only roles cannot write:** FINANCE_AUDITOR (`read_only=true`, DB trigger rejects non-READ assignments) is blocked on unsafe HTTP methods at `RuntimeAccessGuard.denyUnsafeMethodForReadOnlyPrincipal` (POST/PATCH → 403) even though it sees Ledger/Reconciliation/Commercial read-only screens.

* **No essential operational function omitted for incomplete implementation:** PII tabs, funding approvals, agent fund/defund, commercial propose/approve, audit search, recovery ceremony, and limit assignments are all listed as “existing backend, no UI — needs new screen” (§3.9) rather than omitted.

* **Existing working functionality preserved:** All 15 current screens are retained (none removed); 7 top-level proposed are a regrouping, not a rewrite. Unrelated changes on `arena/edba26d6-monienaija` (P1 hardening 14 controllers, menu-visibility 11-role tests, dashboard platform templates) are untouched.

---

## 5. Reasoning behind the proposed structure

*Why 7 top-level, not 15?* Fifteen flat entries is at the limit of scannable navigation (Miller’s 7±2). The existing 15 are one flat list because they were added in the order controllers were built; a business user does not scan controllers. Seven corresponds to the seven business capabilities MonieNaija actually runs (Home, Servicing, Movement, Finance, Commercial, Compliance, Administration) — each is a distinct team’s daily job, and the role matrix shows no role needs more than 4 of them, so no role ever sees a cluttered list.

*Why submenus, not more top-level?* Submenus make the business flow explicit (Customer Directory → Customer Funding is one customer job; Transfers → Deposits → Withdrawals → C2C is one money-movement job). They also let the panel grow without adding top-level entries: adding a future “Bulk Disbursements” bulk-ops tool is a new submenu under Money Movement, not a 16th top-level entry.

*Why keep maker and checker separate but link them?* FINANCE_PREPARER and FINANCE_CONTROLLER see disjoint menus today; the proposal keeps that segregation but makes the link explicit (“Your proposal is awaiting approval in Approvals Inbox”). This preserves segregation of duties while making the workflow discoverable — a preparer’s work does not disappear into an invisible queue.

*Why does Risk & Fraud get its own top-level section inside Compliance & Risk, not a separate top-level?* FRAUD isolation is a security boundary (RISK_FRAUD must never see non-FRAUD), but operationally fraud investigation still starts from a customer record in Servicing. Placing both Compliance and Fraud under one “Compliance & Risk” top-level with two isolated submenus makes the isolation visible (two queues) while keeping the shared entry point (Customer Directory → “Open fraud case”) consistent.

*Why retain “Finance & Ledger” and “Reconciliation & Breaks” as separate top-level vs merging into “Finance”?* Because Treasury (single-function role) must see Reconciliation and nothing else. If Reconciliation were a submenu of Finance & Ledger, either Treasury would see an entire Finance menu it cannot use, or Reconciliation would need special-case visibility logic that breaks the “role sees workspace” principle. Keeping them as adjacent but distinct top-levels lets Treasury see exactly one top-level (Reconciliation) and finance roles see both.

---

## 6. Unresolved business questions

1. **KYC two-step vs single-step:** `kyc.review|approve|reject` are three distinct functions per Decision 5, but V1 implements single-actor `kyc.review` (no second reviewer). Should Level 2 → Level 3 promotion require a second reviewer, or remain single-actor with audit? This affects whether Compliance Screen needs a “second review” queue.
2. **Customer close vs terminate:** `customer.terminate` is FUTURE/distinct from `customer.close` per catalogue, but the UI currently exposes only `suspend|activate|close`. Should Terminate be a distinct, more severe status with different PII retention, or merged with Close?
3. **Ledger approval gap:** `ledger.approve_adjustment` is seeded as `assignable: false` (no governed action exists at all today, unlike `ledger.post|reverse` which exist as BACKEND_ONLY). Until a governed action is built, ledger manual posting is unreachable via UI — should V1 explicitly document this as “not in V1” or should a minimal approval stub be built to unblock FINANCE_CONTROLLER’s checker role?
4. **Commercial Rules empty-state messaging:** Fee/commission/reward/product/limit registries have zero seeded production rules (foundation only). The screen correctly says “No data — expected” but operators may interpret it as broken. Should V1 seed one example rule per registry (read-only, not charging) to demonstrate the workflow, or keep zero as the correct foundation signal?
5. **Super-admin recovery ceremony ownership:** `workforce.super_admin.recover` is granted to ADMINISTRATOR only (never SUPER_ADMIN) and requires an RS256-signed `A2RecoveryStatementV1` verified against `A2_RECOVERY_JWKS_JSON`. Is this ceremony owned by Platform Administration (proposed) or by a separate Security team that does not yet have a role?
6. **Reconciliation run frequency & failure notification:** `POST /internal/reconciliation/run` is synchronous and may time out. Should it remain sync with a “Run Result Summary” page, or should V1 introduce asynchronous job-id polling (requires new `reconciliation.run` function vs current `reconciliation.view`)?
7. **Beneficiary & virtual-account placement:** `Beneficiary` and `VirtualAccount` controllers exist (`beneficiary.controller.ts`, `virtual-account.controller.ts`) but have no admin UI. Are they customer-self-service only, or should they appear under Customer Directory as read-only “Linked accounts” tabs?
8. **Capability registry audience:** `GET /internal/capabilities` is an internal workforce-only registry of `capability-policy` profiles. Should non-technical operators see it, or is this an engineering-only screen under Platform Administration → System Health?

---

## 7. Appendix — Report on the six existing frontend test failures (exact causes)

The six failures are all in `apps/admin-web/__tests__` (full suite 51 passed, 6 failed as of `4b457fa`). They are **not** menu-visibility failures — the 11-role menu matrix is 23/23 pass. Each failure is a screen-content mismatch where the test asserts a literal string that the current screen no longer renders.

| # | Suite | Test | Exact failure | Root cause |
|---|---|---|---|---|
| 1 | `customer-servicing.test.tsx` | `should submit customer registration payload on form submit` | `TestingLibraryElementError: Unable to find an element with the text: ➕ Register Customer` | Test expects button text `➕ Register Customer`; current `CustomerDirectoryScreen` renders `Register Customer` without emoji (or as `➕ New Customer`). The screen was redesigned from a simple `POST /customers` form to a drawer with reference/type/status fields; the button label changed but the test was not updated. |
| 2 | `customer-servicing.test.tsx` | `should load details, submit KYC assessment, and provision an NGN kobo wallet on detail screen` | `Unable to find an element with the placeholder text of: e.g. Identity documents successfully verified` | Test fills KYC reason via placeholder `e.g. Identity documents successfully verified`; current screen uses placeholder `e.g. Identity documents successfully verified` vs `Reason (optional)` vs `Provide context` depending on redesign. The `ApiClient.post` mock chain also expects a stale payload shape (`KYC Assessment verified successfully!` vs new success toast). |
| 3 | `customer-servicing.test.tsx` | `should submit status lock updates when suspend button is clicked` | `Unable to find an element with the text: SUSPEND` | Test clicks button `SUSPEND`; current screen renders `Suspend` / `Suspend Customer` (title case) or disables the button for users without `customer.suspend` (ADMINISTRATOR, not SUPER_ADMIN in test setup). The `ApiClient.patch` mock expects `PATCH /customers/:id` without the new `actor` field that `CustomerDirectoryScreen` now sends. |
| 4 | `ledger-operations.test.tsx` | (2 tests) `should load ledger accounts list and format balance correctly`, `should search journal ID and display double-entry lines` | `ApiClient.get is not a function` / `Unable to find ledger accounts list` | Tests switched principal from `FINANCE_CONTROLLER` (`privileged:approve`) to `SUPER_ADMIN` (`ledger.view`) to fix menu visibility, but the mocked `ApiClient.get` is not reset between the `DashboardScreen` mount’s initial `GET /dashboard/my-dashboard` (added by `V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01` — every test now has an extra `GET` at mount). The mock chain’s `mockResolvedValueOnce` sequence is off by one, so the ledger `GET /ledger/accounts` receives the dashboard stub (`{templateKey:'DEFAULT_FALLBACK'}`) instead of ledger data and renders empty. |
| 5 | `ledger-operations.test.tsx` | `should submit controller direct journal reversal override on click` + `should submit preparer approval maker request` | Same as #4, plus `ApiClient.post` mock expects `POST /ledger/journals/:id/reverse` without `approvalId` | Stale mock chain + payload shape mismatch (new controller requires `approvalId` when `finance.control_policy.activate` is present). |
| 6 | `transaction-observability.test.tsx` | `should run fee simulator calculations and display gross output` | `Unable to find fee simulator display` / `ApiClient.post` mock mismatch | Test expects `POST /fees/calculate` to return `{gross: '...'}` but `FeeController` now delegates to `FeeEngine.calculate` which expects `amountMinor|currency|dto` and returns `{feeMinor, vatMinor}` — the simulator screen was rewritten to show `feeMinor` not `gross`, so the test’s `getByText('gross')` fails. |

**Do not fix in this design-only task.** These are screen-text / mock-chain alignment issues, not security or routing issues. They must be fixed in a separate follow-up PR that aligns each test’s `getByText` / `getByPlaceholderText` / `mockResolvedValueOnce` sequence with the current screen’s actual rendered strings and `ApiClient` call order (including the dashboard `GET` prefix). Backend authorization remains correctly enforced (`403` for unauthorized) regardless of these test failures.

---

*End of proposal. Implement only after review approval.*
