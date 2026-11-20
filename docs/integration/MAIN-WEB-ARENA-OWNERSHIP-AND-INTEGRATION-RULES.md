# Arena Ownership, Integration Rules & Backend Mapping — Arena 5 Phase 2–4

**Baseline:** `e9e5651d` · 166 migrations · `HEAD 98b067bc` · `dist/main.js` + `dist/config/data-source.js` verified
**Frozen predecessors:** `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`, main — never mutate/merge.
**Financial engine:** Preserved. Changes allowed only on demonstrated defect with regression evidence.

## 1. Backend Functionality → Page Mapping

| Backend domain | Key endpoints / modules | Frontend destination | Arena |
|---|---|---|---|
| Customers & KYC | `internal/admin/customers`, `internal/customers`, `internal/kyc/providers|tier-policies|tier-reviews`, `kyc-verification`, `customer-proof-of-address`, `customer-registration` | customers, KYC reviews/providers/policies, proof-of-address, registration, institutional KYC | **1** |
| Customer service, complaints & disputes | `internal/admin/support/*`, `internal/support/*`, `support`, `disputes`, `customer-compliance` | support inbox, compliance cases, fraud cases | **1** |
| Agents & POS | `internal/admin/agents/*`, `internal/agents/*`, `internal/agents/classes`, `internal/agent-affiliations`, `ordinary-agent-admin-api`, `agent-network`, `outlet`, `agent-funding` | agents & network, agent classes, funding, credentials, history, outlets | **2** |
| Institutions | `internal/institutions/*`, `internal/institution-enrolments`, `internal/institution-ledger`, `internal/institution-agent-directory`, `internal/financial-context` | institution directory, workspace, affiliation, enrolment, ledger | **5+1/2** |
| Wallets & banking | `internal/banking/*`, `wallets`, `virtual-accounts`, `banking` provider readiness | banking operations (readiness), deposits/withdrawals (filter views) | **3** |
| Transactions & ledger | `internal/financial-context`, `internal/admin/customers/:id/transactions`, `ledger`, `transfer`, `transfers` | transfers, deposits, withdrawals, ledger & reversals, cash-to-cash ops | **3** |
| Reconciliation & commercial | `internal/reconciliation`, `internal/banking/reconciliation`, `product-governance`, `product-catalog`, `fee-rules`, `commission`, `reward`, `commercial-accounting` | reconciliation, fee/commission/reward rules, products, limit catalogue | **3** |
| Limits | `limits`, `limit-catalog`, `internal/product-governance` | limit assignments, limit catalogue | **1+3** shared |
| Notifications (events/templates/config/provider/deliveries) | `internal/notifications/*`, `internal/notifications/provider-config`, `notification`, `notification-management-api` | notifications (events→templates→config→provider→deliveries) | **4** |
| Reports, metrics, audit, system | `internal/a2/workforce/dashboard`, `operations`, `metrics`, `diagnostics`, `outbox`, `health`, `readiness`, `audit` | dashboard, dashboard settings, system health, audit events | **4+5** |
| Authorization & maker-checker | `internal/a2/workforce/*`, `a2/workforce/*`, `authorization-catalogue`, `protected-authority` | workforce access, role governance, approvals inbox, admin recovery | **4** |

## 2. Arena Ownership

### ARENA 1 — Customers, KYC & Customer Service
**Menu:** `customers`, `kycQueue`, `kycProviders`, `kycTierPolicies`, `complianceCases`, `fraudCases`, `support` (plus limit assignments collaborator)
**Owned screens:** `CustomerDirectoryScreen`, `Customer360Workspace`, `CustomerPersonalInformationPanel`, `CustomerProofOfAddressPanel`, `CustomerRegistrationWizard`, `CustomerTier3ReadinessPanel`, `CustomerFormFields`, `SupportTicketsScreen`, `ComplianceScreen`, `KycProviderManagementScreen`, `KycTierPolicyManagementScreen`, `RiskFraudScreen` (partial), `LimitAssignmentScreen` (shared with 3 — customer side)
**Owned services:** `kyc-governance-api.ts` (consumer; 4 owns provider contract), `institution-admin-api.ts` (customer-enrolment slice)
**Backend deps:** `customer*`, `kyc-verification`, `identity-verification`, `compliance`, `fraud`, `support`, `disputes`, `limit` (assignments)
**Shared deps:** `LimitAssignmentScreen` touches agent limits (Arena 2) and limit catalogue (Arena 3) — changes via PR to Arena 5.
**Deliverables:** Complete KYC queue lifecycle, support SLA, compliance/fraud workflows, customer assignments.
**Prohibited:** `Layout.tsx` sections/menus, `api-client.ts`, `auth-store.ts`, `AgentNetworkScreen`, `NotificationManagementScreen`, `BankingOperationsScreen`.

### ARENA 2 — Agents, POS & Agent Management
**Menu:** `agents`, `agentClasses`
**Owned screens:** `AgentNetworkScreen`, `AgentClassesScreen`, `AgentClassAssignmentPanel`, `AgentFundingPanel`, `AgentCredentialPanel`, `AgentUnifiedHistoryPanel`, `AgentTransactionPinSupportPanel`
**Owned services:** `ordinary-agent-admin-api.ts`
**Backend deps:** `agent*`, `outlet`, `agent-funding`, `agent-application*`, `affiliations`, `aggregator`, `institution-agent-directory` (read)
**Shared deps:** Institution affiliations (Arena 5), notifications (Arena 4 for agent SMS), funding approvals (Arena 4 approvals inbox)
**Deliverables:** Agent directory with real pagination, onboarding→application→approval flow, class management, funding/defunding with approval, credential/PIN support, outlet/POS linkage.
**Prohibited:** Same shared files as Arena 1 + `Customer*`, `Ledger*`, `CommercialRulesScreen`.

### ARENA 3 — Transactions, Banking, Finance & Reconciliation
**Menu:** `transfers`, `cashIn`, `cashOut`, `cashToCashOps`, `ledgerExplorer`, `reconciliation`, `bankingOperations`, `feeRules`, `commissionRules`, `rewardRules`, `productCatalogue`, `limitCatalogue`
**Owned screens:** `TransactionObservabilityScreen`, `CashToCashOperationsScreen`, `LedgerOperationsScreen`, `ReconciliationObservabilityScreen`, `BankingOperationsScreen`, `CommercialRulesScreen` (all tabs)
**Owned services:** `banking-admin-api.ts`
**Backend deps:** `ledger`, `transfer`, `transfers`, `banking`, `reconciliation`, `fee-rules`, `commission`, `reward`, `product-catalog`, `product-governance`, `commercial-accounting`, `virtual-accounts`
**Shared deps:** Limit catalogue consumed by Arena 1's assignment screen — API contract via Arena 5.
**Deliverables:** Transaction observability with real filters, ledger explorer + reversal draft (executable), reconciliation with resolve actions, banking readiness with exception triage, commercial rule CRUD.
**Prohibited:** Shared files + `Customer*`, `Agent*`, `Notification*`.

### ARENA 4 — Notifications, SMS, Email, Administration & System Settings
**Menu:** `workforceAccess`, `roleGovernance`, `approvalsInbox`, `superAdminRecovery`, `notifications`, `systemHealth`, `auditEvents`, `dashboardSettings` (+ `dashboard` collaborator)
**Owned screens:** `WorkforceAdminScreen`, `RoleAssignmentScreen`, `ApprovalsScreen`, `SuperAdminRecoveryScreen`, `NotificationManagementScreen`, `SystemHealthScreen`, `AuditTrailScreen`, `DashboardSettingsScreen`, `DashboardScreen` (with Arena 5)
**Owned services:** `notification-domain.ts`, `notification-management-api.ts`, `kyc-governance-api.ts` (provider contract owner), `banking-admin-api.ts` (consumer for provider credential flow only)
**Backend deps:** `notification*`, `a2/workforce/*`, `authorization*`, `audit`, `operations`, `health`, `metrics`, `outbox`, `dashboard` config
**Shared deps:** Approval inbox is cross-cutting — all Arenas create proposals, Arena 4 owns the approval execution contract (maker-checker).
**Deliverables:** Full workforce/role/approval lifecycle, notification templates→config→provider→deliveries with test-send, system health with real diagnostics, audit search, dashboard customization.
**Prohibited:** Shared files + `Customer*`, `Agent*`, `Ledger*` inner logic.

### ARENA 5 — Shared Architecture & QA (this branch, Arena 5)
**Owns:** `Layout.tsx` navigation, `navigation-access.ts` guards, `api-client.ts`, `auth-store.ts`, `config/*`, `store/*`, `design-system/*`, `GlobalSearch.tsx`, `Institution*` screens, `CountrySelect.tsx`, `dashboard/*`, integration order, consolidated tests, regression.
**No Arena may independently modify:** `Layout.tsx` sections array, `navigation-access.ts` guard map, `api-client.ts` header/auth contract, `auth-store.ts` token/principal, `institution-admin-api.ts` shared types, `design-system/tokens.css`.
**Change protocol:** Arenas 1–4 open drafts against `arena/5-main-web-audit` (or Arena-5-created integration branch); Arena 5 merges via controlled PR after contract test pass.

## 3. Shared Files — Centralized Ownership

| File | Owner | Change rule |
|---|---|---|
| `Layout.tsx` (7 sections, toggle, performNav, render switch) | Arena 5 | Add view key only via Arena 5 PR; Arenas request via issue |
| `navigation-access.ts` (AdminView union, LEGACY_ALIASES, canAccessAdminView) | Arena 5 | New view → add type + alias + guard in same PR as screen |
| `services/api-client.ts` (ApiError, token, 401 clear, base URL assert) | Arena 5 | No Arena adds header/auth logic |
| `store/auth-store.ts` (restoreSession, principal scopes/roles) | Arena 5 | No Arena changes token storage |
| `services/institution-admin-api.ts` (InstitutionSummary, Affiliation, Enrolment) | Arena 5 | Shared institution read contract |
| `design-system/tokens.css`, `primitives.*`, `workspace-patterns.css` | Arena 5 | Design tokens frozen; Arenas use, don't edit |
| `config/build-config.ts`, `config/index.ts` | Arena 5 | API base URL contract |

All other `screens/authenticated/*.tsx` and `services/*.ts` are arena-owned per above.

## 4. Integration Rules

- **Baseline:** `arena/1f37a4f3-monienaija` @ `98b067bc` (portable acceptance package, 6 harness defects fixed). All Arenas 1–4 branch from `arena/5-main-web-audit` (or Arena-5-created `arena/5-main-web-integration`).
- **Shared UI:** Use `design-system/WorkspaceDrawer`, `primitives` (Card, Button, Input), `tokens.css` spacing/color. No new color tokens without Arena 5.
- **Design conventions:** Function-code guards on every screen's `onXGuardChange`; loading guard → `Guarded` banner, not silent 403; contextual `onBackToCustomer/onBackToAgent` only when `navContext.id` present.
- **API client:** All calls via `ApiClient.get|post|patch|put|del` with `idempotencyKey` on POST mutating. Never `fetch` directly. Handle `ApiError.status 401→onWorkforceSessionExpired` via store listener.
- **Permission handling:** Frontend `canAccessAdminView` hides nav; backend function-code is authoritative. Every maker writes proposal → checker approves in `approvalsInbox` (Arena 4).
- **Navigation ownership:** Only Arena 5 edits section order/labels. New view = Arena opens issue → Arena 5 adds type + guard → Arena implements screen.
- **Conflict prevention:** One file owner per PR (see prohibited lists). Cross-file needs (`LimitAssignmentScreen` needs both customer + limit catalogue) → owner drafts, other reviews, Arena 5 merges.
- **Integration order:** 5 (shell frozen) → 1+2 in parallel (customers/agents) → 3 (finance needs 1's customer context) → 4 (approvals need 1/2/3 proposals) → 5 (consolidated testing).
- **Handoff format:** Arena PR must include: owned files, new routes/views, backend endpoints used, guard assertions, test file, evidence screenshot/log path, regression `npm test` pass.
- **Regression:** Every Arena PR must pass `npm run --prefix apps/admin-web test --watchAll=false` (existing ~80 tests) + new arena test; no financial-engine file touched without demonstrated defect.

## 5. Deliverables per Arena (summary)

Each Arena delivers: owned screens COMPLETE (no mock money), real pagination/search/filters, maker→checker flows, error/empty/loading/permission states, `menu-visibility-11-roles` coverage, and an arena `__tests__/<arena>-*.test.tsx` file that asserts guards + key actions. Arena 5 delivers consolidated `MAIN-WEB-AUDIT` evidence + integration branch.

## 6. Execution & Integration Sequence

1. **Now:** Arena 5 freezes `Layout.tsx`/`navigation-access.ts`, creates `arena/5-main-web-audit` → `arena/5-main-web-integration`.
2. **Week 1:** Arenas 1+2 branch from integration, implement customers/support and agents/classes in parallel.
3. **Week 2:** Arena 3 branches (or continues) for transactions/ledger/reconciliation/commercial; needs 1's `CustomerDirectoryScreen` context.
4. **Week 3:** Arena 4 for notifications/admin — needs 1/2/3's proposals for approval inbox.
5. **Continuous:** Arena 5 reviews/merges daily, runs consolidated `apps/admin-web` tests, keeps `PORTABLE-INFRASTRUCTURE-ACCEPTANCE-RUNBOOK` updated with new screens' backend readiness.
6. **Gate:** Each merge must keep `npx ts-node -T scripts/release-gate.ts` 16+4 (no new blocker from frontend).
