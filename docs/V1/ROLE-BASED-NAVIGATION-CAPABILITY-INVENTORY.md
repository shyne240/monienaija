# Role-Based Admin Navigation & Capability Inventory

**Date:** 2026-10-23 (Africa/Lagos)  
**Branch:** `arena/edba26d6-monienaija`  
**Reference HEAD before this task's edits:** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510`  
**Scope:** the eleven catalogue roles, current Admin Web routes/screens, corresponding backend capabilities, and gaps. This documents and tightens the existing dirty workspace; it does not grant roles, change backend authorization, or introduce new business workflows.

## 1. Permission-source and evidence boundary

The effective principal is resolved from two sources in `A2WorkforceSessionService.resolve()`:

1. Active role/function rows in the database-backed authorization catalogue (`AuthorizationCatalogueRuntimeService`).
2. Legacy role scopes from `A2_FINANCE_ROLES_JSON` for the five compatibility roles (`SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `ADMINISTRATOR`).

Those sources are **unioned** into `principal.scopes`. Catalogue grant modes (`VIEW`, `INITIATE`, `APPROVE`, `EXECUTE`) are not retained in that flat scope list; mode-specific maker/checker policy is enforced separately by the relevant backend workflow. The Admin Web uses the resolved scope codes for navigation and individual screen affordances, plus a role check only where the backend workflow itself requires that role.

**Important limitation:** no live database or authenticated production principal was inspected for this task. The function-code lists below are the current source-controlled catalogue seed, not a claim about a particular deployed database snapshot. `apps/admin-web/__tests__/menu-visibility-11-roles.test.tsx` supplies those seed codes and the checked-in legacy sample to exercise the UI. The checked-in `.env.example` has an empty placeholder and an older commented legacy sample; it does not contain a reliable active instance configuration. Its sample includes `privileged:execute` for `SUPER_ADMIN`, `finance:prepare` for `FINANCE_PREPARER`, `privileged:approve` + `privileged:execute` for `FINANCE_CONTROLLER`, and `finance:audit` for `FINANCE_AUDITOR`. It omits `ADMINISTRATOR`, although the configuration parser now requires that role. The legacy scopes actually returned to a running principal must therefore be confirmed from that principal's `scopes` field; do not infer them from a role name or this example file.

The six catalogue-only roles (`OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`) have no legacy scope entries by design. Their seeded catalogue codes are their function scopes.

### 1.1 Current seeded function codes by role

Each list is the flat function-code membership implied by `authorization-catalogue.seed.ts`. Counts exclude any legacy strings above.

- **SUPER_ADMIN (56):** `workforce.role.assign`, `workforce.role.revoke`, `workforce.role.view`, `workforce.role.create`, `workforce.role.modify`, `workforce.role.assign_operational`, `workforce.role.revoke_operational`, `customer.view`, `customer.create`, `customer.suspend`, `customer.activate`, `customer.close`, `customer.view_transactions`, `customer.view_wallets`, `customer.create_wallet`, `customer.manage_support_case`, `customer.view_address`, `customer.view_contact_methods`, `customer.view_identity_documents`, `agent.view`, `agent.review_application`, `agent.activate`, `agent.suspend`, `agent.terminate`, `agent.reactivate`, `agent.manage_credentials`, `agent.manage_outlets_terminals`, `agent.assign_limit`, `aggregator.view`, `aggregator.manage`, `workforce.user.view`, `workforce.user.create`, `workforce.user.suspend`, `kyc.view`, `kyc.review`, `kyc.approve`, `kyc.reject`, `compliance.manage_case`, `compliance.manage_risk_profile`, `audit.view`, `audit.search`, `outbox.view`, `metrics.view`, `diagnostics.view`, `notification.view_deliveries`, `ledger.view`, `reconciliation.view`, `transaction.view`, `fee_rule.view`, `commission_rule.view`, `reward_rule.view`, `product.view`, `limit.view`, `reporting.transaction_summary.view`, `workforce.dashboard.view`, `workforce.dashboard.assign`.
- **FINANCE_PREPARER (19):** `ledger.post`, `ledger.reverse`, `ledger.view`, `fee_rule.create`, `fee_rule.modify`, `fee_rule.view`, `commission_rule.create`, `commission_rule.modify`, `commission_rule.view`, `reward_rule.create`, `reward_rule.modify`, `reward_rule.view`, `product.modify`, `product.governance`, `product.view`, `limit.modify`, `limit.view`, `finance.control_policy.activate`, `reporting.transaction_summary.view`.
- **FINANCE_CONTROLLER (24):** `ledger.view`, `fee_rule.view`, `commission_rule.view`, `reward_rule.view`, `product.view`, `limit.view`, `fee_rule.create`, `fee_rule.modify`, `commission_rule.create`, `commission_rule.modify`, `reward_rule.create`, `reward_rule.modify`, `product.modify`, `product.governance`, `limit.modify`, `finance.control_policy.activate`, `workforce.role.assign`, `workforce.role.revoke`, `workforce.role.create`, `workforce.role.modify`, `workforce.role.view`, `agent.fund`, `agent.defund`, `reporting.transaction_summary.view`.
- **FINANCE_AUDITOR (23):** `customer.view`, `customer.view_transactions`, `customer.view_address`, `customer.view_contact_methods`, `agent.view`, `aggregator.view`, `transaction.view`, `ledger.view`, `fee_rule.view`, `commission_rule.view`, `reward_rule.view`, `product.view`, `limit.view`, `workforce.role.view`, `kyc.view`, `audit.view`, `audit.search`, `outbox.view`, `metrics.view`, `diagnostics.view`, `notification.view_deliveries`, `reconciliation.view`, `reporting.transaction_summary.view`.
- **ADMINISTRATOR (12):** `workforce.user.view`, `workforce.user.create`, `workforce.user.suspend`, `workforce.role.view`, `workforce.super_admin.recover`, `workforce.role.assign_operational`, `workforce.role.revoke_operational`, `customer.view`, `agent.view`, `aggregator.view`, `workforce.dashboard.view`, `workforce.dashboard.assign`.
- **OPERATIONS (22):** `customer.view`, `customer.create`, `customer.suspend`, `customer.activate`, `customer.close`, `customer.view_transactions`, `customer.view_wallets`, `customer.create_wallet`, `customer.manage_support_case`, `customer.view_address`, `customer.view_contact_methods`, `aggregator.view`, `aggregator.manage`, `workforce.user.view`, `workforce.user.create`, `workforce.user.suspend`, `outbox.view`, `metrics.view`, `diagnostics.view`, `notification.view_deliveries`, `transaction.view`, `reporting.transaction_summary.view`.
- **AGENT_NETWORK_MANAGER (12):** `agent.view`, `agent.review_application`, `agent.activate`, `agent.suspend`, `agent.terminate`, `agent.reactivate`, `agent.manage_credentials`, `agent.manage_outlets_terminals`, `agent.assign_limit`, `agent.fund`, `agent.defund`, `limit.view`.
- **COMPLIANCE (10):** `kyc.view`, `kyc.review`, `kyc.approve`, `kyc.reject`, `compliance.manage_case`, `compliance.manage_risk_profile`, `customer.view`, `customer.view_address`, `customer.view_contact_methods`, `customer.view_identity_documents`.
- **RISK_FRAUD (1):** `risk_fraud.manage_fraud_case`.
- **CUSTOMER_SERVICE (6):** `customer.view`, `customer.view_wallets`, `customer.view_transactions`, `customer.manage_support_case`, `customer.view_address`, `customer.view_contact_methods`.
- **TREASURY (1):** `reconciliation.view`.

## 2. Current Admin Web routes and gates

These are sidebar destinations actually rendered by `Layout.tsx` (25 items in seven sections), not every function in the backend. Screen access is also guarded when the screen is rendered directly. Backend authorization remains authoritative.

| Route key / sidebar label | Frontend screen | Navigation gate | Implemented screen/API surface (summary) |
|---|---|---|---|
| `dashboard` — Operational Dashboard | `DashboardScreen` | Authenticated principal; always the home route | Caller-specific dashboard and individually authorized widgets. |
| `dashboardSettings` — Dashboard Settings | `DashboardSettingsScreen` | `workforce.dashboard.view` | Lists templates/assignments; assignment mutation additionally requires `workforce.dashboard.assign`. |
| `customers` — Customer & KYC Servicing | `CustomerDirectoryScreen` | `customer.view` | Customer listing/detail, permitted lifecycle/wallet/KYC actions, contextual links. |
| `agents` — Agent Network Management | `AgentNetworkScreen` | `agent.view` | Agent list, ledger-derived financial position, and individually gated lifecycle buttons. |
| `support` — Support Inbox | `SupportTicketsScreen` | `customer.manage_support_case` | Ticket list/detail, status changes, and messages. |
| `transfers`, `cashIn`, `cashOut` — Transaction & Fee Ops | `TransactionObservabilityScreen` | Global route: `transaction.view`; `cashIn`/`cashOut` are filters on the same screen. | Read-only global transaction lookup and fee simulation. Customer 360 history is contextual and instead requires `customer.view_transactions`; it is not a global sidebar grant. |
| `ledgerExplorer` — Ledger & Reversals | `LedgerOperationsScreen` | `ledger.view` | Account list and journal lookup by UUID; reversal request additionally requires `ledger.reverse`; approved execution follows backend executor policy. |
| `reconciliation` — Reconciliation & Breaks | `ReconciliationObservabilityScreen` | `reconciliation.view` | Reconciliation report and trial-balance views/actions. |
| `feeRules` — Fee Rules | `CommercialRulesScreen` | `fee_rule.view` | Read-only fee registry tab. |
| `commissionRules` — Commission Rules | `CommercialRulesScreen` | `commission_rule.view` | Read-only commission registry tab. |
| `rewardRules` — Reward Rules | `CommercialRulesScreen` | `reward_rule.view` | Read-only reward registry tab. |
| `productCatalogue` — Product Catalogue | `CommercialRulesScreen` | `product.view` | Read-only product registry tab. |
| `limitCatalogue` — Limit Catalogue | `CommercialRulesScreen` | `limit.view` | Read-only limit catalogue tab. |
| `limitAssignments` — Limit Assignments | `LimitAssignmentScreen` | `limit.view` **or** `agent.assign_limit` | Reads assignments; the agent-assignment form additionally requires `agent.assign_limit`. |
| `kycQueue` — KYC Assessment Lookup & Review | `ComplianceScreen` (`mode="kyc"`) | `kyc.view` | Customer-ID lookup; review/approve/reject affordances mirror their respective KYC scopes. This is **not** a queue. |
| `complianceCases` — Compliance Case Lookup | `ComplianceScreen` (`mode="cases"`) | `compliance.manage_case` | Customer-scoped list and client-side category filter. This is **not** full case management. |
| `fraudCases` — Fraud Case Lookup | `RiskFraudScreen` | `risk_fraud.manage_fraud_case` | Customer-scoped compliance-case fetch filtered to FRAUD in the browser. This is **not** a backend-isolated fraud queue. |
| `workforceAccess` — Workforce Overview & Support Provisioning | `WorkforceAdminScreen` | `workforce.dashboard.view` **or** `workforce.user.create` | Overview widget and SUPPORT identity creation. The screen does not implement user suspension. |
| `roleGovernance` — Finance Role Assignments | `RoleAssignmentScreen` | `SUPER_ADMIN` role **and** `workforce.role.assign` or `workforce.role.revoke` | Existing governed assignment UI for the three `FINANCE_*` roles only. |
| `approvalsInbox` — Privileged Approvals | `ApprovalsScreen` | `FINANCE_CONTROLLER` role **and** legacy `privileged:approve` scope | Manual approval-ID submission. No list/details inbox. |
| `superAdminRecovery` — Super-Admin Recovery | `SuperAdminRecoveryScreen` | `workforce.super_admin.recover` | Signed recovery statement flow; catalogue grant is to `ADMINISTRATOR`, not `SUPER_ADMIN`. |
| `systemHealth` — System Health | `SystemHealthScreen` | At least one of `metrics.view`, `diagnostics.view`, `outbox.view` | Only panels corresponding to individually held functions are fetched/rendered. `notification.view_deliveries` has no panel here. |
| `auditEvents` — Audit & Security Events | `AuditTrailScreen` | `audit.search` | Search screen for `/internal/audit`. |

The six commercial/limit tabs are separately gated inside `CommercialRulesScreen`; holding one tab's view function does not reveal or fetch other tabs. The old `cashToCash` sidebar route is not in the current `AdminView`/Layout tree. Customer-scoped history can still filter `CASH_TO_CASH` through the existing customer history screen when `customer.view_transactions` is present.

Legacy aliases (`ledger`, `transactions`, `commercial`, `compliance`, `riskfraud`, `roles`, `approvals`, `workforce`, `system`) canonicalize to these same guarded views; an alias does not bypass the route gate.

## 3. Per-role navigation, backend capabilities, and gaps

The menu lists below are the current seed-plus-legacy-sample fixture. A deployed principal's resolved `scopes` may differ as described in §1.

### SUPER_ADMIN

- **Sidebar:** Operational Dashboard; Dashboard Settings; Customer & KYC Servicing; Agent Network Management; Support Inbox; Transfers/Cash-In/Cash-Out; Ledger & Reversals; Reconciliation & Breaks; Fee/Commission/Reward Rules; Product Catalogue; Limit Catalogue; Limit Assignments; KYC Assessment Lookup & Review; Compliance Case Lookup; Workforce Overview & Support Provisioning; Finance Role Assignments; System Health; Audit & Security Events.
- **Backend scope domains:** customer lifecycle/wallet/KYC; agent list/lifecycle/application-review/credentials/outlets-terminals/limit assignment; aggregator read/manage; workforce-user and role functions; compliance case/risk-profile; audit/operations; ledger/reconciliation/transaction and commercial read; dashboard view/assignment.
- **Gaps / not in this role's menu:** no `risk_fraud.manage_fraud_case`; no `workforce.super_admin.recover` (the protected recovery function is intentionally not held by the protected role); no `privileged:approve` in the checked-in legacy sample. There is no aggregator UI, agent application queue, credential/outlet/terminal UI, role-definition/operational-role UI, workforce-user suspension UI, customer address/contact/identity-document display, or notification-delivery panel. Agent funding/defunding is not granted to this role in the seed.

### FINANCE_PREPARER

- **Sidebar:** Operational Dashboard; Ledger & Reversals; Fee Rules; Commission Rules; Reward Rules; Product Catalogue; Limit Catalogue; Limit Assignments.
- **Backend scope domains:** initiate ledger posting/reversal and commercial rule/product/limit/control-policy changes; ledger and registry reads; transaction-summary reporting. Legacy sample adds `finance:prepare`.
- **Gaps:** commercial screens are read-only, so the granted create/modify/governance functions have no proposal forms; the ledger screen only initiates reversal requests and has no journal list. Generic journal posting is disabled by the backend despite the seeded `ledger.post` grant. No global transaction route (`transaction.view` is absent), no approval UI under the sample scopes, and no reconciliation/customer/agent surface.

### FINANCE_CONTROLLER

- **Sidebar:** Operational Dashboard; Ledger & Reversals; Fee Rules; Commission Rules; Reward Rules; Product Catalogue; Limit Catalogue; Limit Assignments; Privileged Approvals (with the checked-in legacy sample).
- **Backend scope domains:** commercial/limit approval functions; finance control-policy approval; workforce role-definition/assignment approval codes; `agent.fund` and `agent.defund` approval-mode codes; ledger and reporting reads. The backend reversal executor separately recognizes the FINANCE_CONTROLLER role.
- **Gaps:** the Finance Role Assignments screen is intentionally hidden because the backend's initiation policy requires `SUPER_ADMIN`; role-definition proposals/approval have no screen. There is no dedicated agent-funding approval/rejection/execution workspace (the existing approval UI accepts a manually supplied ID); commercial changes remain read-only in the web screen. No customer/agent viewing, transaction, reconciliation, or workforce-overview screen is granted by these seed codes.

### FINANCE_AUDITOR

- **Sidebar:** Operational Dashboard; Customer & KYC Servicing; Agent Network Management; Transfers/Cash-In/Cash-Out; Ledger & Reversals; Reconciliation & Breaks; Fee/Commission/Reward Rules; Product Catalogue; Limit Catalogue; Limit Assignments; KYC Assessment Lookup & Review; System Health; Audit & Security Events.
- **Backend scope domains:** read-only customer/transaction/agent/aggregator/ledger/commercial/limit/role/KYC/audit/outbox/metrics/diagnostics/notification-delivery/reconciliation/reporting functions. Legacy sample adds `finance:audit`.
- **Gaps:** there is no aggregator screen, role-assignment listing, notification-delivery screen, or customer address/contact-method display. KYC is lookup only; no compliance-case or fraud-case menu. Agent lifecycle controls are hidden because the auditor holds `agent.view` but no `agent.*` lifecycle functions.

### ADMINISTRATOR

- **Sidebar:** Operational Dashboard; Dashboard Settings; Customer & KYC Servicing; Agent Network Management; Workforce Overview & Support Provisioning; Super-Admin Recovery.
- **Backend scope domains:** workforce user view/create/suspend; operational-role assign/revoke; role view; signed SUPER_ADMIN recovery; customer/agent/aggregator read; dashboard view/assignment.
- **Gaps:** no UI for operational role assignment/revocation or role definitions; no aggregator screen; Workforce Admin can create SUPPORT users but cannot list/suspend them; no customer address/contact/identity-document view. Finance Role Assignments is not shown because it is a separate SUPER_ADMIN-initiated workflow.

### OPERATIONS

- **Sidebar:** Operational Dashboard; Customer & KYC Servicing; Support Inbox; Transfers/Cash-In/Cash-Out; Workforce Overview & Support Provisioning; System Health.
- **Backend scope domains:** customer lifecycle/wallet/support; aggregator read/manage; workforce user view/create/suspend; transaction/reporting and operations/outbox/metrics/diagnostics/notification-delivery reads.
- **Gaps:** no aggregator UI; no workforce-user list or disable/suspend control despite `workforce.user.suspend`; no notification-delivery panel. Customer transaction history is customer-contextual in addition to the global transaction route. Customer address/contact fields are not rendered.

### AGENT_NETWORK_MANAGER

- **Sidebar:** Operational Dashboard; Agent Network Management; Limit Catalogue; Limit Assignments.
- **Backend scope domains:** agent view/application review/activation/suspension/termination/reactivation/credential issuance/outlet-terminal management/limit assignment; funding and defunding initiation; limit read.
- **Available frontend actions:** agent list and ledger-derived financial-position detail; lifecycle buttons appear individually only for `agent.activate`, `agent.suspend`, `agent.terminate`, and `agent.reactivate`; existing Limit Assignment UI handles profile assignment.
- **Gaps:** no application queue/review action, credential-issuance screen, outlet/terminal management screen, or funding/defunding request maker/approval workflow screen. These backend functions are not represented by invented buttons or extra menus. The application's internal admin endpoints also need backend function-level review (see §5).

### COMPLIANCE

- **Sidebar:** Operational Dashboard; Customer & KYC Servicing; KYC Assessment Lookup & Review; Compliance Case Lookup.
- **Backend scope domains:** KYC read/review/approve/reject; non-fraud compliance case management; customer risk-profile management; customer address/contact/identity-document reads.
- **Gaps:** current compliance case UI only lists a customer's cases and filters rows; it does not create/update/comment/close/assign cases or manage evidence/history. There is no customer risk-profile screen and no address/contact/identity-document UI. KYC screen is a customer-ID lookup, not an inbox.

### RISK_FRAUD

- **Sidebar:** Operational Dashboard; Fraud Case Lookup.
- **Backend scope domain:** only `risk_fraud.manage_fraud_case`.
- **Gaps:** the current screen is read-only and filters FRAUD rows client-side from the general customer compliance-case endpoint; it does not create/update/comment/close cases or provide a queue. The shared backend list route does not enforce a FRAUD-only category/function check, so the frontend filter is not a security boundary (see §5).

### CUSTOMER_SERVICE

- **Sidebar:** Operational Dashboard; Customer & KYC Servicing; Support Inbox.
- **Backend scope domains:** customer view/wallet/transaction/address/contact reads and support-case management.
- **Available frontend actions:** customer list/detail with wallet view; customer-specific transaction history is reached contextually from Customer 360 and filtered by `customer.view_transactions`; support ticket queue/actions.
- **Gaps:** no global transaction menu (the role lacks `transaction.view`); customer address/contact fields are not rendered. It has no lifecycle, wallet-creation, KYC-decision, compliance, or fraud menu.

### TREASURY

- **Sidebar:** Operational Dashboard; Reconciliation & Breaks.
- **Backend scope domain:** only `reconciliation.view`.
- **Gaps:** no additional catalogue-backed admin screen is granted by the seed; reconciliation itself currently has run and trial-balance tabs.

## 4. Verified screen gaps (not menu permission grants)

These are existing backend capabilities without a matching complete frontend workflow. They are documented rather than papered over with fake menu entries or role-based fallbacks:

- **Agent Network:** present route/screen now covers list, ledger-derived position and individually scoped lifecycle actions, but not applications, credentials, outlets/terminals, or funding. `agent.review_application`, `agent.manage_credentials`, `agent.manage_outlets_terminals`, `agent.fund`, and `agent.defund` remain unrepresented in the UI.
- **Aggregators:** `aggregator.view` / `aggregator.manage` have no dedicated Admin Web screen/menu.
- **Customer PII:** `customer.view_address`, `customer.view_contact_methods`, and `customer.view_identity_documents` do not currently render address/contact/document panels in Customer Directory.
- **Workforce identity:** Workforce Admin provides an overview widget and SUPPORT creation only. It has no user list or suspension/disable flow for `workforce.user.suspend`.
- **Role governance:** Finance Role Assignments is not operational-role assignment or dynamic role-definition governance. The operational assignment and role-definition proposal APIs have no matching UI.
- **Commercial changes:** Commercial Rules is a read-only registry viewer; it does not expose the granted proposal/approval mutations for preparer/controller roles.
- **Approvals:** the screen is a manual-ID approval form, not a queue/details inbox; it has no rejection workflow surface. Agent funding also lacks an integrated request list/execute/reject workspace.
- **Ledger:** account listing and UUID journal lookup exist, but there is no journal search/list endpoint surfaced; `ledger.post` is seeded for FINANCE_PREPARER while generic ledger journal POST is explicitly disabled pending governance.
- **Compliance/KYC/Fraud:** KYC and compliance labels now say “Lookup” to match actual behavior. Compliance cases and fraud screens do not provide the complete case-management operations implied by their backend function descriptions.
- **Operations signals:** `notification.view_deliveries` is granted to several roles but has no dedicated delivery screen/panel.

## 5. Backend authorization caveats intentionally not changed

This is a frontend navigation task; hiding a route does not secure the API. The following source-level issues remain for the backend owners and were not modified here:

- `OperationsController.getAudit()` is explicitly authentication-only; `AuditTrailScreen` requires `audit.search`, but that frontend check is not a replacement for backend enforcement.
- `CustomerComplianceController` and `CustomerRiskProfileController` do not directly call `AuthorizationService.requireFunction()`. The compliance/fraud screens' scope gates do not establish endpoint-level authorization.
- The Admin Web fraud view calls the shared compliance-case list and filters FRAUD in the browser; the backend does not provide a category-isolated endpoint for this screen.
- `AgentApplicationAdminController` list/review/approve/reject methods enforce principal type but do not check `agent.review_application` themselves. The Admin Web does not add a new application workflow in this change.

No backend permission was broadened, and no migration, database, financial-business-rule, deployment, or commit/push action was performed.

## 6. Navigation corrections in this task

- Agent Network now requires `agent.view` (no `privileged:execute` or role-name fallback); each lifecycle button/action checks its own function. The status filter now uses the backend's actual `PENDING` agent status, and the screen no longer claims to contain an application queue.
- Commercial registry tabs are individually function-gated and unauthorized tabs are omitted; role names and legacy `finance:prepare` no longer substitute for each tab's backend read function.
- Ledger list/detail UI requires `ledger.view`; reversal initiation requires `ledger.reverse`; execution affordance mirrors the backend executor policy (`FINANCE_CONTROLLER` role or `privileged:execute`).
- Reconciliation screen requires `reconciliation.view` directly, including if mounted outside the guarded Layout.
- Privileged approval navigation/screen require the checker role (`FINANCE_CONTROLLER`) plus the legacy `privileged:approve` scope, matching the current governed action policy.
- Sidebar labels now describe the actual lookup screens; the current tree is seven sections / 25 implemented routes (three money-movement entries, no C2C sidebar route), not the stale 26-item document count.
- `apps/admin-web/jest.config.js` now resolves the declared local `jest-environment-jsdom` dependency by package name rather than hard-coding a monorepo-root `node_modules` path.

## 7. Validation evidence (2026-10-23)

All commands below ran locally from `apps/admin-web`, except the seed-list cross-check and whitespace check from the repository root. These are frontend-only checks; no backend server, database, or migrations were run.

- `npm ci` — completed; installed 455 packages. npm reported 6 dependency audit findings (1 moderate, 4 high, 1 critical); dependency versions were not changed by this task.
- `npm run ts:check` — **PASS** (`tsc`, exit 0).
- `npm run build` — **PASS** (75 modules transformed; Vite build completed). Vite emitted its existing CJS Node API deprecation warning.
- `npm test -- --runInBand --silent __tests__/menu-visibility-11-roles.test.tsx __tests__/ledger-operations.test.tsx` — **PASS**, 2/2 focused suites and 33/33 tests.
- `npm test -- --runInBand --silent` — **PASS**, 9/9 suites and 70/70 tests.
- Seed-vs-document script — **PASS**; every function-code list and count in §1.1 matches the current `nowAssign()` seed for all eleven roles.
- `git diff --check` — **PASS** (see task completion record for the final check).
- Vite dev server — started successfully on `0.0.0.0:5173` for the live preview. The `/api` proxy defaults to `http://localhost:3000`; no backend was started, so API-backed behavior is not part of the preview verification. The frontend page was served; this does not establish database-backed authorization, persistence, or production readiness.
