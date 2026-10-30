# 02 — Admin Web Inventory

## Current structure

The app's authenticated layout has seven sections and **28 navigation entries** in `apps/admin-web/src/screens/authenticated/Layout.tsx`. The full extracted menu, navigation-access expression and source line references are in `admin-navigation-inventory.csv`. `admin-api-call-inventory.csv` records 149 static `ApiClient` call expressions; dynamic interpolation, shared service wrappers, and runtime calls make this a discovery aid, not a complete endpoint/workflow census. The menu guard lives in `navigation-access.ts`; it is a client-side navigation/UX gate, not API authorization. The render switch maps the entries to 21 screen modules plus shared screens/panels (e.g. TransactionObservabilityScreen handles transfers, cash-in, cash-out; CommercialRulesScreen handles five catalogue views; ComplianceScreen handles KYC and cases).

The surfaced actions include fetch/list/search/refresh, selection/context navigation, structured forms, customer/agent servicing operations, approvals, funding/defunding, role assignment, support, and notification template/configuration proposal flows. Some write surfaces call backend workflows; many pages are intentionally read-only observability. A displayed success state is not proof of a database read-after-write or downstream money/business effect.

## Navigation entries and assessment

| Key | Screen | What the menu actually leads to | Status |
|---|---|---|---|
| `dashboard` | DashboardScreen | Dashboard metrics + customer navigation | PARTIAL; read-only summary, runtime/business effects not demonstrated |
| `dashboardSettings` | DashboardSettingsScreen | Role-to-dashboard/template assignment | PARTIAL; assignment is not dashboard-template authoring |
| `customers` | CustomerDirectoryScreen / Customer360Workspace | Search, customer detail, KYC/PoA/customer servicing panels | PARTIAL; panel/API coverage differs by operation; not full identity lifecycle proof |
| `agents` | AgentNetworkScreen | Agent applications, lifecycle, credentials, history, funding/outlets panels | PARTIAL; broad workflow surface, but current browser+DB evidence absent; history pairing historically integrated and separately tested |
| `agentClasses` | AgentClassesScreen | Class/capability registry editing/config fields | PARTIAL; JSON/config inputs and backend rules require persisted/effect verification |
| `support` | SupportTicketsScreen | Support ticket lookup and selected support operations | PARTIAL; scope to endpoints and transitions, not entire CRM lifecycle |
| `transfers` | TransactionObservabilityScreen | Transfer search/detail, customer context when selected | PARTIAL; observability, not reversal/settlement authority |
| `cashIn` | TransactionObservabilityScreen | Deposit/cash-in observation | PARTIAL; not a cashier workflow |
| `cashOut` | TransactionObservabilityScreen | Withdrawal/cash-out observation | PARTIAL; not a payout workflow |
| `cashToCashOps` | CashToCashOperationsScreen | C2C operations lookup and status view | PARTIAL; expiry relies on configured background worker; no disposition control is implied |
| `ledgerExplorer` | LedgerOperationsScreen | Ledger/ledger-operation lookup and diagnostics | PARTIAL; no generalized reversal permission inferred |
| `reconciliation` | ReconciliationObservabilityScreen | Reconciliation/break observation | PARTIAL; reporting is not full break resolution |
| `feeRules` | CommercialRulesScreen | Fee registry view | PARTIAL; no governed Admin mutation workflow evidenced |
| `commissionRules` | CommercialRulesScreen | Commission registry view | PARTIAL; no governed Admin mutation workflow evidenced |
| `rewardRules` | CommercialRulesScreen | Reward registry view | PARTIAL; registry does not prove accrual or credit effect |
| `productCatalogue` | CommercialRulesScreen | Product registry view | PARTIAL; no end-to-end managed catalogue effect evidenced |
| `limitCatalogue` | CommercialRulesScreen | Limit catalogue view | PARTIAL; backend write APIs do not make the Admin screen a full workflow |
| `limitAssignments` | LimitAssignmentScreen | Assignment plus usage/reservation diagnostics | PARTIAL; reservation recovery mutation is explicitly not offered; API scope mismatch is a finding |
| `kycQueue` | ComplianceScreen | KYC lookup/review mode | PARTIAL; do not equate review display with full lifecycle/evidence proof |
| `complianceCases` | ComplianceScreen | Customer case lookup/category view | PARTIAL; backend has more actions; missing dedicated gate finding applies |
| `fraudCases` | RiskFraudScreen | Risk/fraud category client-side filtering | FRONTEND_ONLY for category isolation; server does not enforce category restriction |
| `workforceAccess` | WorkforceAdminScreen | Workforce overview/support credential provision/disable | PARTIAL; enable/reactivation intentionally omitted at permission boundary |
| `roleGovernance` | RoleAssignmentScreen | Role/function governance | PARTIAL; prove checker/audit/persistence and privilege constraints per action |
| `approvalsInbox` | ApprovalsScreen | Approval detail by known ID and decisions | PARTIAL; not a generic pending approval discovery queue |
| `superAdminRecovery` | SuperAdminRecoveryScreen | Super-admin recovery workflow | PARTIAL; recovery ceremony and production readiness are not implied by screen |
| `notifications` | NotificationManagementScreen + NotificationTemplateWorkspace | Event/template governance, proposals/approvals, provider status/test-send, delivery diagnostics | PARTIAL; substantial real API integration and strong inherited PG evidence; browser/live provider not tested; manual retry remains deferred by V1 requirement |
| `systemHealth` | SystemHealthScreen | Runtime/system health and links to notifications | PARTIAL; diagnostics, not system remediation |
| `auditEvents` | AuditTrailScreen | Audit/security event lookup | PARTIAL; read-only event browsing; audit completeness/retention not inferred |

## Additional backend capabilities with no matching complete Admin journey

These rows are separate from the 28 menu entries and are represented in `admin-capability-inventory.csv`:

- Governed create/modify/approval paths exist for fee, commission, reward, product and limit configuration, while commercial Admin views are read-oriented: `BACKEND_ONLY` for admin editing. Runtime effect remains separately `UNVERIFIED`.
- Compliance case backend supports update/comment/evidence/assignment/history; current UI is lookup-focused: `BACKEND_ONLY` for the missing management actions and `POLICY_BLOCKED`/P0 for required route-scope resolution until confirmed.
- Manual limit-reservation recovery/release is server-side but has no Admin recovery form and should remain a separately governed operation: `BACKEND_ONLY`.
- General privileged approval queue/list is not evidenced; screen is ID-driven: `MISSING` for queue discovery if product requires it.
- Agent class reassignment and Admin PIN recovery/unlock are policy-constrained and not to be implemented without existing owner/security decisions: `POLICY_BLOCKED`.
- Reward accrual/credit operational behavior is not proved by reward configuration CRUD: `UNVERIFIED`.

## Verification and false-completion rules

No Admin capability is `COMPLETE` based on a navigation key, API call, JSON field, mock, green component test, successful toast, or backend route alone. For each state-changing workflow, acceptance should include correct function/resource authorization, input validation, audit record, durable persistence, reload/read-after-write, downstream effect or explicit proof that the feature is read-only, error/replay semantics, and browser interaction. For high-risk writes, test maker/checker identities separately and verify no self-approval. Browser UAT was not executed in this audit.
