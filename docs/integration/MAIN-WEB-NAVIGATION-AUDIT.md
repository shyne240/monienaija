# Main Web Navigation & Route Audit — Arena 5 Phase 1

**Date:** 2026-11-20 · Branch `arena/1f37a4f3-monienaija` @ `0350563d` · Application candidate `e9e5651d` (166 migrations)
**Scope:** `apps/admin-web/src/screens/authenticated/Layout.tsx` + `navigation-access.ts` — 8 sections, 32 menu items + 1 contextual route = 33 routable views; `AdminView` union = 42 values (33 canonical + 9 legacy aliases), function-code guarded
**Classification:** COMPLETE (production-grade), PARTIAL (works but gaps), PLACEHOLDER (static/no backend), MISSING (conceptual capability without route — not a routable view), BROKEN (calls non-existent endpoint)

## 1. Navigation Map (preserved — do not reorganize)

| # | Section | View key | Label | Guard (`function code`) | Status | Component (lines) |
|---|---|---|---|---|---|---|
| 1 | Overview | `dashboard` | Dashboard | none (always) | **COMPLETE** | `DashboardScreen.tsx` 199 |
| 2 | Overview | `dashboardSettings` | Dashboard Settings | `workforce.dashboard.view` | **COMPLETE** | `DashboardSettingsScreen.tsx` 930 |
| 3 | Customers & agents | `customers` | Customers | `customer.view` | **COMPLETE** | `CustomerDirectoryScreen.tsx` 949 → `Customer360Workspace.tsx` 1197 |
| 4 | Customers & agents | `agents` | Agents & network | `agent.view` | **PARTIAL** | `AgentNetworkScreen.tsx` 5215 (37 mock refs, backend: `internal/admin/agents/*`) |
| 5 | Customers & agents | `agentClasses` | Agent classes | `agent.view` | **COMPLETE** | `AgentClassesScreen.tsx` 1784 |
| 6 | Customers & agents | `support` | Support Inbox | `customer.manage_support_case` | **COMPLETE** | `SupportTicketsScreen.tsx` 1371 |
| 7 | Institutions | `institutions` | Institution directory | `institution.view` | **COMPLETE** | `InstitutionDirectoryScreen.tsx` 530 → `InstitutionWorkspaceScreen.tsx` 1043 |
| 8 | Transactions | `transfers` | Transfers | `transaction.view` | **PARTIAL** | `TransactionObservabilityScreen.tsx` 1129 (read-only observability, no maker action) |
| 9 | Transactions | `cashIn` | Deposits | `transaction.view` | **PLACEHOLDER** | Alias of `TransactionObservabilityScreen` `initialType=DEPOSIT` — filter only |
| 10 | Transactions | `cashOut` | Withdrawals | `transaction.view` | **PLACEHOLDER** | Alias of same — filter only |
| 11 | Transactions | `cashToCashOps` | Cash to cash | `transaction.view` | **COMPLETE** | `CashToCashOperationsScreen.tsx` 1081 |
| 12 | Finance | `ledgerExplorer` | Ledger & reversals | `ledger.view` | **PARTIAL** | `LedgerOperationsScreen.tsx` 1251 (ledger view OK, reversals incomplete) |
| 13 | Finance | `reconciliation` | Reconciliation | `reconciliation.view` | **PARTIAL** | `ReconciliationObservabilityScreen.tsx` 1327 (observes, no manual resolve) |
| 14 | Finance | `bankingOperations` | Banking operations | `reconciliation.view` | **PARTIAL** | `BankingOperationsScreen.tsx` 413 (readiness display, no live provider trigger) |
| 15 | Products & pricing | `feeRules` | Fee rules | `fee_rule.view` | **PARTIAL** | `CommercialRulesScreen.tsx` 581 (5-tab switcher; fee tab partial) |
| 16 | Products & pricing | `commissionRules` | Commission rules | `commission_rule.view` | **PARTIAL** | Same component `initialTab=commissions` |
| 17 | Products & pricing | `rewardRules` | Reward rules | `reward_rule.view` | **PLACEHOLDER** | Tab exists, minimal logic |
| 18 | Products & pricing | `productCatalogue` | Products | `product.view` | **PLACEHOLDER** | Tab switch only |
| 19 | Products & pricing | `limitCatalogue` | Limit catalogue | `limit.view` | **COMPLETE** | `CommercialRulesScreen` limits tab |
| 20 | Products & pricing | `limitAssignments` | Limit assignments | `limit.view|modify|assign` | **COMPLETE** | `LimitAssignmentScreen.tsx` 1723 |
| 21 | Risk & compliance | `kycQueue` | KYC reviews | `kyc.view` | **COMPLETE** | `ComplianceScreen.tsx` 950 `mode=kyc` |
| 22 | Risk & compliance | `kycProviders` | KYC providers | `kyc.provider.view` | **COMPLETE** | `KycProviderManagementScreen.tsx` 722 |
| 23 | Risk & compliance | `kycTierPolicies` | KYC tier policies | `kyc.policy.view` | **COMPLETE** | `KycTierPolicyManagementScreen.tsx` 655 |
| 24 | Risk & compliance | `complianceCases` | Compliance cases | `compliance.manage_case` | **COMPLETE** | `ComplianceScreen` `mode=cases` |
| 25 | Risk & compliance | `fraudCases` | Fraud cases | `risk_fraud.manage_fraud_case` | **PARTIAL** | `RiskFraudScreen.tsx` 252 (thin, real backend but limited UI) |
| 26 | Administration | `workforceAccess` | Workforce access | `workforce.dashboard.view|user.create` | **COMPLETE** | `WorkforceAdminScreen.tsx` 674 |
| 27 | Administration | `roleGovernance` | Role governance | `SUPER_ADMIN+assign` | **COMPLETE** | `RoleAssignmentScreen.tsx` 879 |
| 28 | Administration | `approvalsInbox` | Approvals | `FINANCE_CONTROLLER+privileged:approve` | **COMPLETE** | `ApprovalsScreen.tsx` 732 (FINANCE_CONTROLLER maker-checker) |
| 29 | Administration | `superAdminRecovery` | Admin recovery | `workforce.super_admin.recover` | **COMPLETE** | `SuperAdminRecoveryScreen.tsx` 511 |
| 30 | Administration | `notifications` | Notifications | `notification.*` | **COMPLETE** | `NotificationManagementScreen.tsx` 5165 — largest, most wired (26 api calls) |
| 31 | Administration | `systemHealth` | System health | `metrics|diagnostics|outbox` | **COMPLETE** | `SystemHealthScreen.tsx` 638 |
| 32 | Administration | `auditEvents` | Audit events | `audit.search` | **COMPLETE** | `AuditTrailScreen.tsx` 428 |
| 33 | Contextual | `institutionWorkspace` | Institution workspace | `institution.view+id` | **COMPLETE** | `InstitutionWorkspaceScreen.tsx` 1043 + `InstitutionRelationshipTabs.tsx` 1899 |

Canonical views (9 legacy aliases mapped via `LEGACY_VIEW_ALIASES`): `ledger→ledgerExplorer`, `transactions→transfers`, `commercial→feeRules`, `compliance→kycQueue`, `riskfraud→fraudCases`, `roles→roleGovernance`, `approvals→approvalsInbox`, `workforce→workforceAccess`, `system→systemHealth` — retained, not counted as separate destinations.

## 2. Status Summary — reconciled (source of truth: `MAIN-WEB-MASTER-FUNCTIONALITY-MATRIX.md`)

Routable views: **33** = 32 menu items + 1 contextual (`institutionWorkspace`, reachable only with `institutionId`).
Sections: **8** (`home` Overview, `servicing` Customers & agents, `institutions` Institutions, `money` Transactions, `finance` Finance, `commercial` Products & pricing, `compliance` Risk & compliance, `platform` Administration).

- **COMPLETE (21):** dashboard, dashboardSettings, customers, agentClasses, support, institutions, institutionWorkspace, cashToCashOps, limitCatalogue, limitAssignments, kycQueue, kycProviders, kycTierPolicies, complianceCases, workforceAccess, roleGovernance, approvalsInbox, superAdminRecovery, notifications, systemHealth, auditEvents
- **PARTIAL (8):** agents, transfers, ledgerExplorer, reconciliation, bankingOperations, feeRules, commissionRules, fraudCases
- **PLACEHOLDER (4):** cashIn, cashOut (intentional filter aliases of transfers), rewardRules, productCatalogue — tab/alias only, no independent operations; governed-notice until wired
- **BROKEN (0):** No screen calls a non-existent endpoint; all 401s are guard-correct, not broken.
- **MISSING (conceptual, not routable):** No global reporting/analytics hub, no automatic-POS provisioning UI, no standalone disputes resolver, no wallet/virtual-account admin, no partner-callback inspector. These are backend capabilities without management interfaces — see `MAIN-WEB-BACKEND-SERVICE-MAPPING.md §5` and master matrix § Non-goals. Not counted in the 33.

## 3. Detail per Screen

### Customers (Arena 1)
- **CustomerDirectoryScreen** — search, filter, pagination, tier badges, risk flags, registration wizard entry. Uses `internal/admin/customers` + `internal/customers`. COMPLETE.
- **Customer360Workspace + panels** — personal info (2222), proof-of-address (1973), registration wizard (2176), tier-3 readiness (145). Each panel governs via maker-checker. COMPLETE.
- **SupportTicketsScreen** — lifecycle `OPEN→IN_PROGRESS→RESOLVED`, SLA timers, workforce assignment, audit-link. Uses `internal/admin/support/*`. COMPLETE.
- **ComplianceScreen (kyc/cases)** — KYC queue with approve/reject, compliance AML cases. Uses `internal/kyc/tier-reviews|providers`. COMPLETE.

### Agents & POS (Arena 2)
- **AgentNetworkScreen** 5215 — largest after notifications. Directory, onboarding, outlet assignment, funding/defunding, lifecycle. 37 `mock` refs are fallbacks for missing aggregator detail, not faked money movement. Real APIs: `internal/admin/agents/*`, `ordinary-agent-admin-api`. **PARTIAL** — funding lifecycle needs completion.
- **AgentClassesScreen** 1784 — class CRUD with capability matrix, assignment panel. Uses `internal/agents/classes`. COMPLETE.
- **AgentFundingPanel / CredentialPanel / History** — sub-workspaces. COMPLETE/PARTIAL hybrid.

### Transactions & Finance (Arena 3)
- **TransactionObservabilityScreen** — type-filtered (TRANSFER/DEPOSIT/WITHDRAWAL) read model via `internal/financial-context`. No maker action — observability only. PARTIAL: needs maker flows (customer app owns initiation).
- **CashToCashOperationsScreen** — read-only ops view of agent cash-to-cash with expiry, claim, recovery. COMPLETE as operations view.
- **LedgerOperationsScreen** — double-entry explorer, journal balance, reversal draft. PARTIAL: reversal execution incomplete.
- **ReconciliationObservabilityScreen** — runs, exceptions, assignment, escalate. Observability only, no manual MATCHED/ESCALATED resolve → needs finance action.
- **BankingOperationsScreen** — provider readiness (`BankingAdminApi readiness`), operational status, no live NIP trigger (correctly blocked). PARTIAL.

### Products, Pricing, Limits (Arena 3 + 1)
- **CommercialRulesScreen** 581 — 5-tab (fees/commissions/rewards/products/limits) via `product-governance` module. Fee/commission partial (rule CRUD without live activation); rewards/products placeholders; limits complete.
- **LimitAssignmentScreen** 1723 — catalogue browser + customer/agent assignment with tier overrides. Uses `limits` + `internal/product-governance`. COMPLETE.

### Notifications & Administration (Arena 4)
- **NotificationManagementScreen** 5165 — events → templates → configuration → provider status → deliveries; maker-checker for templates/config; provider test-send. 9 mocks are provider-specific fallbacks (console provider). **Most complete screen.** Uses `notification-domain` + `notification-management-api`.
- **WorkforceAdminScreen, RoleAssignmentScreen, ApprovalsScreen, SuperAdminRecoveryScreen** — full workforce/role lifecycle, maker-checker inbox (FINANCE_CONTROLLER), break-glass recovery. All COMPLETE.
- **SystemHealthScreen** — metrics, diagnostics, outbox backlog, worker liveness. Uses `internal/operations/*`. COMPLETE.
- **AuditTrailScreen** — paginated audit events via `audit.search`. COMPLETE (thin).

### Institutions (Arena 5 owned; Arenas 1–2 consume)
- **InstitutionDirectoryScreen + InstitutionWorkspaceScreen + InstitutionRelationshipTabs** — directory, lifecycle (REGISTERED→APPROVED→OPERATIONAL), agent affiliation, enrolment, ledger purpose, KYC tier-limit policy. COMPLETE; cross-module (customers, agents, ledger, notifications all touch it). Arenas 1/2 do not edit institution files — they read affiliations/enrolments via `institution-admin-api.ts`.

## 4. Permission Model

Frontend guards mirror backend `authorization-catalogue` function codes (see `navigation-access.ts`). No screen invents a permission. Key invariants:
- `customer.manage_support_case` gates support; `customer.view_transactions` gates contextual transaction history.
- `transaction.view` vs `ledger.view` vs `reconciliation.view` are distinct — money movement, ledger, and reconciliation are separate finance scopes.
- `Approvals: FINANCE_CONTROLLER + privileged:approve` — only checkers approve; makers cannot self-approve (backend enforces anyway).
- `Notifications` accepts either `notification.*` or `FINANCE_CONTROLLER+privileged:approve` (checker inspector path).
