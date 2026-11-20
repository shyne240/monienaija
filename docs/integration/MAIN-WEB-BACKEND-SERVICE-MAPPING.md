# Backend Service → Frontend Page Mapping — Arena 5 Phase 2

**Branch:** `arena/1f37a4f3-monienaija` → `arena/5-main-web-audit` (integration)
**Baseline:** `e9e5651d` · 166 migrations · `HEAD 98b067bc`
**App:** `apps/admin-web` (React + Vite, Zustand, Jest) + `src/` (NestJS)

> Every mapping below was read from `src/**/controller` + `src/**/module` + `apps/admin-web/src/services/*` + `Layout.tsx` render. No invented endpoint.

## 1. Method

1. Enumerated `grep -r "@Controller" src --include="*.ts"` → 45+ controllers.
2. Cross-checked `apps/admin-web/src/services/*.ts` typed wrappers (5397 lines) for already-consumed endpoints.
3. Matched each `Layout.tsx` `case 'view': return <Screen />` branch to the owning backend module.

## 2. Full Mapping

### A. Customers, KYC, Customer Registration

| Backend module(s) | Controller prefix | Frontend screen / view | Notes |
|---|---|---|---|
| `customer`, `customer-registration`, `customer-onboarding`, `customer-compliance`, `customer-eligibility`, `customer-preference`, `customer-proof-of-address`, `customer-risk-profile`, `customer-wallet` | `customers`, `customers/registration`, `internal/admin/customers`, `internal/customers`, `internal/customers/:id/proof-of-address`, `internal/kyc/*` | `customers`, `Customer360Workspace`, `CustomerRegistrationWizard`, `CustomerPersonalInformationPanel`, `CustomerProofOfAddressPanel`, `CustomerTier3ReadinessPanel` | Identity, address, tier, wallet — all read via `internal/admin/customers` |
| `kyc-verification`, `identity-verification`, `customer-compliance`, `compliance` | `internal/kyc/providers`, `internal/kyc/tier-policies`, `internal/kyc/tier-reviews`, `internal/institutions/:id/kyc-tier-limit-policy` | `kycQueue`, `kycProviders`, `kycTierPolicies`, `ComplianceScreen(mode=kyc|cases)` | Tier reviews drive KYC queue; providers/policies are governance with maker-checker |
| `compliance`, `fraud`, `customer-risk-profile` | `compliance`, `risk_fraud` (authorization) | `complianceCases`, `fraudCases`, `RiskFraudScreen` | Compliance cases mature; fraud is thin (needs Arena 1 enrichment) |

### B. Complaints, Support Cases & Disputes

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `support`, `admin` (support), `disputes` | `internal/admin/support/*`, `internal/support`, `internal/admin/customers/:id/support-cases` | `support` (`SupportTicketsScreen`) | SLA timers, lifecycle OPEN→RESOLVED, agent↔customer link |
| `disputes`, `compliance` | `disputes/*` | `complianceCases`, `RiskFraudScreen` (extended) | Disputes module exists but has no dedicated tab — surfaced inside compliance/fraud per current IA |

### C. Agents, POS, Outlets, Classes

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `agent`, `agent-authentication`, `agent-application*`, `admin` (agent lifecycle/credentials) | `agents`, `internal/agents`, `internal/agents/applications`, `internal/agents/classes`, `internal/admin/agents/*` (lifecycle, credentials) | `agents` (`AgentNetworkScreen`), `agentClasses` | Core agent directory + onboarding |
| `agent`, `outlet`, `agent-funding` | `agents/me/banking/*`, `internal/agent-affiliations`, `internal/institution-agent-directory` | `AgentNetworkScreen` funding/credential/outlet panels | Outlet assignment, funding/defunding via approval |
| `aggregator` | `internal/aggregators` | AgentNetwork aggregator filter (fallback) | Read-only in admin |

### D. Institutions (cross-cutting)

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `institution`, `admin` | `internal/institutions`, `internal/institution-enrolments`, `internal/institution-agent-directory`, `internal/institution-ledger`, `internal/institutions/:id/kyc-tier-limit-policy`, `internal/financial-context` | `institutions`, `institutionWorkspace` (directory + workspace) | Lifecycle REGISTERED→APPROVED; affiliations to agents; enrolments; ledger purposes; KYC tier policies per institution — touches Arena 1+2+5 |

### E. Wallets & Banking

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `wallet`, `customer-wallet`, `banking`, `bank`, `virtual-account`, `deposit`, `withdrawal` | `internal/banking`, `internal/banking/providers`, `wallets`, `virtual-accounts`, `internal/banking/bank-transfers` | `bankingOperations` (`BankingOperationsScreen`) | Provider readiness is per-institution, per-provider (7-state model, `usable` only when OPERATIONAL). No live NIP trigger from this screen — correct |
| `customer-funding`, `customer-funding-instrument` | `internal/customers/me/banking/*`, `customers/me/banking/*` | `cashIn`/`cashOut` aliases (observability only) | Wallet funding owned by customer app; admin observes |

### F. Transactions, Ledger, Financial Oversight

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `transfer`, `payment`, `quote`, `financial-commitment`, `ledger`, `commercial-accounting` | `transfers`, `internal/financial-context`, `internal/admin/customers/:id/transactions`, `ledger`, `internal/ledger`, `internal/financial-context/ledger` | `transfers`, `cashIn`, `cashOut`, `ledgerExplorer` (`LedgerOperationsScreen`) | Transactions are observability (money movement initiated elsewhere); ledger is double-entry explorer + reversal draft |
| `agent/cash-to-cash*` | `internal/admin/cash-to-cash/*`, `agents/cash-to-cash` | `cashToCashOps` | Ops read view with expiry/claim/recovery — no mutation |

### G. Reconciliation, Commissions, Fees, Commercial

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `reconciliation`, `banking` (reconciliation), `commercial-accounting`, `commercial-decision` | `internal/reconciliation`, `reconciliation`, `internal/banking/reconciliation` | `reconciliation` | Runs + exceptions; manual resolution pending Arena 3 |
| `fee`, `fee-rules`, `commission`, `reward`, `product-catalog`, `product-governance` | `internal/product-governance`, `fees`, `fee-rules`, `limits`, `product-governance` | `feeRules`, `commissionRules`, `rewardRules`, `productCatalogue`, `limitCatalogue` (`CommercialRulesScreen`) + `limitAssignments` | Commercial governance — fee/commission partial (no activation without approval), rewards/products deferred, limits complete |
| `limit`, `limit-catalog`, `policy` | `limits`, `limit-catalog` | `limitAssignments`, `limitCatalogue` | Assignment with tier overrides; shared Arena 1+3 |

### H. Notifications, SMS, Email, Templates, Logs

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `notification`, `admin` (notification) | `internal/notifications`, `internal/notifications/provider-config`, `internal/admin/notification*` | `notifications` (`NotificationManagementScreen` 5165 lines) | Events→templates→config→provider status→deliveries; maker-checker for templates/config; provider test-send; most complete screen — owns `notification-domain.ts` + `notification-management-api.ts` |

### I. Reports, Dashboards, Analytics

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `dashboard`, `a2/workforce/dashboard`, `operations`, `health`, `performance` | `internal/a2/workforce/dashboard`, `internal/operations/*`, `health`, `internal/financial-context` | `dashboard`, `dashboardSettings`, `systemHealth` | Dashboard metrics from financial-context + operational metrics from workforce dashboard; detailed reports module deferred (no invented reports page) |

### J. Roles, Permissions, Maker-Checker, Audit, System Config

| Backend module(s) | Controller prefix | Frontend screen | Notes |
|---|---|---|---|
| `authorization`, `authorization-catalogue`, `capability-registry`, `admin`, `a2` (workforce) | `internal/a2/workforce`, `internal/a2/workforce/role-definitions`, `internal/a2/workforce/super-admin`, `internal/support/workforce-sessions` | `workforceAccess`, `roleGovernance`, `approvalsInbox`, `superAdminRecovery` | Workforce CRUD, role matrix, FINANCE_CONTROLLER checker inbox, break-glass recovery — central to all arenas' governance |
| `operations`, `deployment`, `readiness` | `internal/operations/*`, `audit`, `health`, `metrics`, `outbox` | `systemHealth`, `auditEvents` | Ops: diagnostics, metrics, outbox backlog, worker liveness; audit: paginated actor/action/entity search |
| `policy`, `maturity`, `pilot` | `internal/product-governance`, `capabilities`, `internal/capabilities` | `CommercialRulesScreen` + `dashboardSettings` | Policy/pilot gates — not top-level nav |

## 3. Cross-Arenas Dependencies

- **Approvals inbox (Arena 4)** is the sink for proposals from Arenas 1 (KYC provider/policy), 2 (agent lifecycle), 3 (fee/commission/reversal).
- **Institution workspace (Arena 5)** is the join of Customers (enrolment), Agents (affiliation), Ledger (purposes), Notifications (institution-scoped templates), Limits (institution KYC tier policy).
- **Limit assignments (Arena 1+3)** — catalogue owned by Arena 3, assignment UI owned by Arena 1; API contract via Arena 5 `limits`.

## 4. Gaps & Arena-Required Wiring

| Gap | Kind | Arena |
|---|---|---|
| Rewards / product catalogue CRUD not wired to admin (exists `reward`, `product-catalog` backends) | Deferred (P3) | 3 |
| Manual reconciliation resolution (MATCHED/ESCALATED) | Missing action | 3 |
| Ledger reversal execution via approvals | Missing action | 3+4 |
| Fraud case rich detail + evidence upload | Thin UI | 1 |
| Deposit/withdrawal maker (correctly absent — customer/agent app owns) | By design, no gap | — |
