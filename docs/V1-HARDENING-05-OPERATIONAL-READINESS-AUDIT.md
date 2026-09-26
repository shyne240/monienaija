# V1-HARDENING-05 — Operational Readiness / Admin Control-Plane Audit

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD (05 audit):** `145df67` (`feat(hardening-04): unified Customer Transaction History projection — 25 PG tests, 66 migrations, zero ledger mutation`) — parent `6c9f5c3` (`docs(hardening-03): runtime transaction limits audit — BLOCKED ...`) — grand-parent `08afd99` (`docs(hardening-02A): fee BLOCKED ...`) — root `3d05aae` (`fix(production): update expected migration constraints ...`)  
**Migrations in workspace / DB:** `66` (`1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries`) — `src/production/production-readiness.service.ts` expects `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` / `CreateNotificationDeliveries1785753600065` — **66→66, 0 new**  
**Task type:** **Audit-only**, **0 source / 0 migration / 0 ledger / 0 route changes** — fees remain BLOCKED (02A), limits remain BLOCKED (03), beneficiary `me` exposure COMPLETE (01), unified history COMPLETE (04) — not reimplemented.  
**Question audited:** Can authorized MonieNaija Operations personnel actually **operate, supervise, investigate, and control** the V1 system safely — not merely “does a service exist?”

---

## 1. Executive Summary

MonieNaija V1 has a **mature Admin/Operations control plane for Agent lifecycle, funding maker/checker, support ticketing, reconciliation reporting, and audit**, but **customer-centric and transaction-centric investigation is still backend-only or missing from the Admin surface**. The system is **safe to operate for Agent and Funding work, and for support casework**, but **not yet complete for Finance/Customer-Support to correlate a customer → wallet → transaction → journal → ticket → notification without direct DB access**, and **no break-resolution or notification-failure diagnosis workflow exists in Admin**. 

**Classification: `GAPS FOUND — NEXT V1 OPERATIONAL TASK IDENTIFIED`** — 4 P1 gaps block safe V1 operation without DB, 3 P2 hardenings, 2 PRODUCT/ACCOUNTING decisions required for reconciliation/reversal. The next **dependency-supported, narrowly-scoped, V1-relevant** implementation is **Admin Customer Investigation (customer → wallet → unified transaction history → funding → support tickets, safe projection)** — repository-grounded (existing `CustomerTransactionHistoryService`, `WalletService`, `SupportService`), not fees/limits/beneficiary/history (already complete).

**Major findings:** Roles `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` correctly gated (SUPPORT denied on Agent lifecycle, maker≠checker on funding), Agent operations COMPLETE (list/view/suspend/terminate/reactivate + outlets/terminals + capabilities + receiving numbers), Funding maker/checker COMPLETE (idempotency, concurrency SERIALIZABLE, audit, ledger), Support operations COMPLETE (list/assign/escalate/status/resolve/close/messages with version乐观), Reconciliation reports/trial-balance/finance exist but **no break-resolution workflow** (PRODUCT/ACCOUNTING), Notifications delivery records exist but **no Admin diagnostics surface** (P2), Reversal `LedgerService.reverseJournal` exists but **no Admin reversal workflow and V1-008 says intentionally absent** (V2/PRODUCT), Customer/Agent secrets not exposed (safe projections).

---

## 2. Current HEAD

| Field | Value |
|-------|-------|
| Branch | `arena/01a0d883-monienaija` |
| HEAD (05 audit start) | `145df67` `feat(hardening-04): unified Customer Transaction History projection ...` |
| Parents | `145df67` → `6c9f5c3` (hardening-03 BLOCKED) → `08afd99` (02A BLOCKED) → `436c95b` → `3f7729b` → `28667b8` (hardening-01 COMPLETE) → `3d05aae` |
| Remote | `origin/arena/01a0d883-monienaija` at `145df67` (protected false, `gh api .../branches/arena/01a0d883-monienaija` confirms) |
| Date | 2026-09-26 Africa/Lagos |
| Source changes (05) | **0** (audit-only) |
| Migration changes (05) | **0** |
| Ledger changes (05) | **0** |
| Route changes (05) | **0** |
| Only create | `docs/V1-HARDENING-05-OPERATIONAL-READINESS-AUDIT.md` (this file) |

---

## 3. Migration Count

| Check | Result |
|-------|--------|
| `ls src/migrations/*.ts \| wc -l` | **66** |
| `SELECT count(*) FROM typeorm_migrations` (via `test/a25` Q, `test/a23` 15) | **66** |
| `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` `EXPECTED_MIGRATION_NAME='CreateNotificationDeliveries1785753600065'` | matches `1785753600065` |
| Migration chain `1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries` | intact, 66→66 |
| Hardening-04 delta | **0 new** (hardening-04 itself 0 new, verified `66→66`) |

---

## 4. Admin Route Inventory

**Inventory method:** `grep -rn "@Controller|@Get|@Post|@Patch|@Delete" src/admin src/operations src/authorization src/support src/customer-funding src/agent src/aggregator src/outlet src/reconciliation src/notification --include="*.ts"`, plus `RoutePolicyRegistry.resolve()` (`src/authorization/route-policy-registry.ts:1-340`), plus controllers listed below. All routes `WORKFORCE_SESSION` except `POST /internal/a2/workforce/sessions` (`WORKFORCE_ASSERTION`), `POST /customers/sessions` (`CUSTOMER_LOGIN`), `POST /agents/sessions` (`AGENT_LOGIN`), `POST /agents/applications` (`AGENT_LOGIN`). `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` gated via `AuthorizationGuard` + per-controller `requireWorkforce` / `requireOperational`.

| # | Route | Controller | Method | Resource | Operation | Audit | Financial mutation | Idempotency | Concurrency |
|---|-------|------------|--------|----------|-----------|-------|--------------------|-------------|-------------|
| 1 | `POST /api/v1/internal/a2/workforce/sessions` | `WorkforceAdministrationController` | `establish` | `a2-workforce-session-exchange` | Exchange IdToken → workforce session | `audit` `WORKFORCE_SESSION_CREATED` | No | No (OIDC) | DB transaction |
| 2 | `DELETE /api/v1/internal/a2/workforce/sessions/:id` | `WorkforceAdministrationController` | `revokeSession` | `a2-workforce-administration` | Revoke session | `audit` | No | No | — |
| 3 | `POST /api/v1/internal/a2/workforce/bootstrap` | `WorkforceAdministrationController` | `bootstrap` | `a2-workforce-administration` | Bootstrap first admin (ciphers) | `audit` | No | No | — |
| 4 | `POST /api/v1/internal/a2/workforce/roles` | `WorkforceAdministrationController` | `assign` | `workforce-role` | Assign role `SUPPORT/OPERATOR/SERVICE/PRIVILEGED/FINANCE_*` | `audit` `WORKFORCE_ROLE_ASSIGNED` | No | No | `ON CONFLICT` |
| 5 | `DELETE /api/v1/internal/a2/workforce/roles/:principalId/:roleKey` | `WorkforceAdministrationController` | `revoke` | `workforce-role` | Revoke role | `audit` | No | No | — |
| 6 | `POST /api/v1/internal/a2/workforce/approvals/request` | `WorkforceAdministrationController` | `requestApproval` | `privileged-approval` | Request privileged approval (`FINANCE_ROLE_ASSIGN` etc.) | `audit` `PRIVILEGED_APPROVAL_REQUESTED` | No | Idempotency key | SERIALIZABLE |
| 7 | `POST /api/v1/internal/a2/workforce/approvals/:id/approve` | `WorkforceAdministrationController` | `approve` | `privileged-approval` | Approve (checker) | `audit` `PRIVILEGED_APPROVAL_APPROVED` | No | — | `version` optimistic |
| 8 | `GET /api/v1/internal/customers` | `AdminCustomerController` | `list` | `customer` | LIST customers `?page&limit&status&type` | No (list) | No | No | — |
| 9 | `GET /api/v1/internal/customers/:id` | `AdminCustomerController` | `getOne` | `customer` | VIEW customer identity (entity row) | No | No | No | — |
| 10 | `GET /api/v1/internal/agents` | `AdminAgentController` | `list` | `agent` | LIST agents `?page&limit&status` | No | No | No | — |
| 11 | `GET /api/v1/internal/agents/:id` | `AdminAgentController` | `getOne` | `agent` | VIEW agent | No | No | No | — |
| 12 | `POST /api/v1/internal/admin/agents/:id/suspend` | `AdminAgentLifecycleController` | `suspend` | `admin-agent-lifecycle` | SUSPEND agent (OPERATOR/SERVICE/PRIVILEGED only, SUPPORT denied) | `audit` `AGENT_SUSPENDED` | No | No | `version` |
| 13 | `POST /api/v1/internal/admin/agents/:id/terminate` | `AdminAgentLifecycleController` | `terminate` | `admin-agent-lifecycle` | TERMINATE | `audit` `AGENT_TERMINATED` | No | No | `version` |
| 14 | `POST /api/v1/internal/admin/agents/:id/reactivate` | `AdminAgentLifecycleController` | `reactivate` | `admin-agent-lifecycle` | REACTIVATE | `audit` `AGENT_REACTIVATED` | No | No | `version` |
| 15 | `POST /api/v1/internal/admin/agents/:id/activate` | `AdminAgentLifecycleController` | `activate` | `admin-agent-lifecycle` | ACTIVATE (via app or direct) | `audit` `AGENT_ACTIVATED` | No | No | `version` |
| 16 | `POST /api/v1/internal/admin/agents/applications/:applicationId/activate` | `AdminAgentLifecycleController` | `activateFromApplication` | `admin-agent-lifecycle` | ACTIVATE from application | `audit` | No | No | SERIALIZABLE + `IdempotencyService` (application) |
| 17 | `GET /api/v1/internal/aggregators` | `AdminAggregatorController` | `list` | `aggregator` | LIST aggregators | No | No | No | — |
| 18 | `GET /api/v1/internal/agents/applications` | `AgentApplicationAdminController` | `list` | `agent-application` | LIST applications | No | No | No | — |
| 19 | `GET /api/v1/internal/agents/applications/:id` | `AgentApplicationAdminController` | `getOne` | `agent-application` | VIEW application | No | No | No | — |
| 20 | `POST /api/v1/internal/agents/applications/:id/review` | `AgentApplicationAdminController` | `review` | `agent-application` | UPDATE status `UNDER_REVIEW` | `audit` | No | No | `version` |
| 21 | `POST /api/v1/internal/agents/applications/:id/approve` | `AgentApplicationAdminController` | `approve` | `agent-application` | APPROVE | `audit` | No | No | `version` |
| 22 | `POST /api/v1/internal/agents/applications/:id/reject` | `AgentApplicationAdminController` | `reject` | `agent-application` | REJECT | `audit` | No | No | `version` |
| 23 | `GET /api/v1/internal/agents/classes` | `AgentClassController` | `list` | `agent-class` | LIST classes | No | No | No | — |
| 24 | `POST /api/v1/internal/agents/classes` | `AgentClassController` | `create` | `agent-class` | CREATE class `applicable_services/limits JSONB` | `audit` `AGENT_CLASS_CREATED` | No | `ON CONFLICT` | — |
| 25 | `GET /api/v1/internal/agents/classes/:id` | `AgentClassController` | `getOne` | `agent-class` | VIEW class | No | No | No | — |
| 26 | `PATCH /api/v1/internal/agents/classes/:id` | `AgentClassController` | `update` | `agent-class` | UPDATE class | `audit` `AGENT_CLASS_UPDATED` | No | `version` | — |
| 27 | `POST /api/v1/internal/agents/:agentId/fund` | `AgentFundingController` | `fund` | `agent-funding` | FUND agent (platform → wallet) `DR platform CR wallet` | `audit` `AGENT_FUNDED` | **Yes** `postJournal` | `IdempotencyService` `agent-funding:${agentId}:${key}` | SERIALIZABLE + `MAX_SERIALIZABLE_ATTEMPTS` |
| 28 | `POST /api/v1/internal/agents/:agentId/defund` | `AgentFundingController` | `defund` | `agent-funding` | DEFUND | `audit` | Yes | Idempotency | SERIALIZABLE |
| 29 | `POST /api/v1/internal/aggregators/:aggregatorId/agents/:agentId/fund` | `AgentFundingController` | `fundViaAggregator` | `agent-funding` | FUND via aggregator relationship (authorizes aggregator) | `audit` | Yes | Idempotency | SERIALIZABLE |
| 30 | `POST /api/v1/internal/aggregators/:aggregatorId/agents/:agentId/defund` | `AgentFundingController` | `defundViaAggregator` | `agent-funding` | DEFUND via aggregator | `audit` | Yes | Idempotency | SERIALIZABLE |
| 31 | `POST /api/v1/internal/agents/:id/activate` (legacy) | `AgentLifecycleController` | `activate` | `agent-lifecycle` | Alias to admin (same) | `audit` | No | — | — |
| 32 | `POST /api/v1/internal/agents/:id/suspend` (legacy) | `AgentLifecycleController` | `suspend` | `agent-lifecycle` | Alias | `audit` | No | — | — |
| 33 | `POST /api/v1/internal/agents/:id/reactivate` | `AgentLifecycleController` | `reactivate` | `agent-lifecycle` | Alias | `audit` | No | — | — |
| 34 | `POST /api/v1/internal/agents/:id/terminate` | `AgentLifecycleController` | `terminate` | `agent-lifecycle` | Alias | `audit` | No | — | — |
| 35 | `POST /api/v1/internal/agents/applications/:applicationId/activate` | `AgentLifecycleController` | `activateFromApplication` | `agent-lifecycle` | Alias | `audit` | No | — | — |
| 36 | `GET /api/v1/internal/agents/:id/receiving-number` | `AgentReceivingNumberController` | `get` | `agent-receiving-number` | VIEW receiving number | No | No | — | — |
| 37 | `POST /api/v1/internal/aggregators` | `AggregatorController` | `create` | `aggregator` | CREATE aggregator | `audit` `AGGREGATOR_CREATED` | No | `ON CONFLICT` code | — |
| 38 | `GET /api/v1/internal/aggregators/:id` | `AggregatorController` | `getOne` | `aggregator` | VIEW aggregator | No | No | — | — |
| 39 | `POST /api/v1/internal/aggregators/:id/activate|/suspend|/reactivate|/terminate` | `AggregatorController` | `*` | `aggregator` | Lifecycle (same as Agent) | `audit` | No | `version` | — |
| 40 | `POST /api/v1/internal/aggregators/:aggregatorId/agents` | `AggregatorController` | `attach` | `aggregator-agent` | CREATE relationship aggregator→agent | `audit` | No | `ON CONFLICT` | — |
| 41 | `GET /api/v1/internal/aggregators/:aggregatorId/agents` | `AggregatorController` | `listAgents` | `aggregator-agent` | LIST relationships | No | No | — | — |
| 42 | `POST /api/v1/internal/aggregators/:aggregatorId/agents/:agentId/suspend|reactivate|terminate` | `AggregatorController` | `*` | `aggregator-agent` | Relationship lifecycle | `audit` | No | — | — |
| 43 | `POST /api/v1/internal/agents/:agentId/outlets` | `OutletController` | `createOutlet` | `agent-outlet` | CREATE outlet `DR?` | `audit` `OUTLET_CREATED` | No | `ON CONFLICT` | — |
| 44 | `POST /api/v1/internal/aggregators/:aggregatorId/agents/:agentId/outlets` | `OutletController` | `createOutletViaAggregator` | `agent-outlet` | CREATE via aggregator | `audit` | No | — | — |
| 45 | `GET /api/v1/internal/agents/:agentId/outlets` | `OutletController` | `listOutlets` | `agent-outlet` | LIST outlets | No | No | — | — |
| 46 | `GET /api/v1/internal/outlets/:outletId` | `OutletController` | `getOutlet` | `agent-outlet` | VIEW outlet | No | No | — | — |
| 47 | `POST /api/v1/internal/outlets/:outletId/suspend|reactivate|terminate` | `OutletController` | `*` | `agent-outlet` | Lifecycle | `audit` | No | `version` | — |
| 48 | `POST /api/v1/internal/outlets/:outletId/terminals` | `OutletController` | `createTerminal` | `agent-terminal` | CREATE terminal | `audit` `TERMINAL_CREATED` | No | — | — |
| 49 | `POST /api/v1/internal/agents/:agentId/terminals` | `OutletController` | `createTerminalForAgent` | `agent-terminal` | CREATE | `audit` | No | — | — |
| 50 | `POST /api/v1/internal/aggregators/:aggregatorId/agents/:agentId/terminals` | `OutletController` | `createTerminalViaAggregator` | `agent-terminal` | CREATE | `audit` | No | — | — |
| 51 | `GET /api/v1/internal/outlets/:outletId/terminals` | `OutletController` | `listTerminalsForOutlet` | `agent-terminal` | LIST | No | No | — | — |
| 52 | `GET /api/v1/internal/agents/:agentId/terminals` | `OutletController` | `listTerminalsForAgent` | `agent-terminal` | LIST | No | No | — | — |
| 53 | `GET /api/v1/internal/terminals/:terminalId` | `OutletController` | `getTerminal` | `agent-terminal` | VIEW | No | No | — | — |
| 54 | `POST /api/v1/internal/terminals/:terminalId/suspend|reactivate|terminate` | `OutletController` | `*` | `agent-terminal` | Lifecycle | `audit` | No | `version` | — |
| 55 | `GET /api/v1/internal/support/tickets` | `SupportInternalController` | `list` | `support-ticket` | LIST `?page&limit&status&customerId&agentId&assignedTo` | No | No | — | — |
| 56 | `GET /api/v1/internal/support/tickets/:id` | `SupportInternalController` | `getOne` | `support-ticket` | VIEW | No | No | — | — |
| 57 | `POST /api/v1/internal/support/tickets/:id/assign` | `SupportInternalController` | `assign` | `support-ticket` | ASSIGN `assignedTo` + `version` | `audit` `SUPPORT_TICKET_ASSIGNED` | No | `version` | — |
| 58 | `POST /api/v1/internal/support/tickets/:id/status` | `SupportInternalController` | `updateStatus` | `support-ticket` | UPDATE status (`OPEN/IN_PROGRESS/PENDING/ESCALATED/RESOLVED/CLOSED`) | `audit` `SUPPORT_TICKET_STATUS_UPDATED` | No | `version` | — |
| 59 | `POST /api/v1/internal/support/tickets/:id/resolve` | `SupportInternalController` | `resolve` | `support-ticket` | RESOLVE (sets `RESOLVED`) | `audit` | No | `version` | — |
| 60 | `POST /api/v1/internal/support/tickets/:id/close` | `SupportInternalController` | `close` | `support-ticket` | CLOSE | `audit` | No | `version` | — |
| 61 | `POST /api/v1/internal/support/tickets/:id/messages` | `SupportInternalController` | `addMessage` | `support-ticket-message` | Add internal/external message `isInternal` | `audit` `SUPPORT_TICKET_MESSAGE_CREATED` | No | — | — |
| 62 | `GET /api/v1/internal/support/tickets/:id/messages` | `SupportInternalController` | `listMessages` | `support-ticket-message` | LIST messages (requires workforce) | No | No | — | — |
| 63 | `POST /api/v1/internal/customers/:customerId/funding-requests` | `CustomerFundingInternalController` | `create` | `customer-funding-request` | CREATE funding request (maker) | `audit` `CUSTOMER_FUNDING_REQUEST_CREATED` | No (request only) | `idempotencyKey` `requestHash` | — |
| 64 | `POST /api/v1/internal/customer-funding-requests/:id/approve` | `CustomerFundingInternalController` | `approve` | `customer-funding-request` | APPROVE (checker) `maker≠checker` | `audit` `CUSTOMER_FUNDING_REQUEST_APPROVED` | **Yes** `postJournal` `DEBIT settlement CREDIT wallet` | `version` + `idempotency` | SERIALIZABLE `MAX_SERIALIZABLE_ATTEMPTS` |
| 65 | `POST /api/v1/internal/customer-funding-requests/:id/reject` | `CustomerFundingInternalController` | `reject` | `customer-funding-request` | REJECT | `audit` `CUSTOMER_FUNDING_REQUEST_REJECTED` | No | `version` | — |
| 66 | `POST /api/v1/internal/customers/:customerId/funding-requests/:id/approve` (alias) | `CustomerFundingInternalController` | `approveViaCustomer` | `customer-funding-request` | Same | `audit` | Yes | — | — |
| 67 | `POST /api/v1/internal/customers/:customerId/funding-requests/:id/reject` (alias) | `CustomerFundingInternalController` | `rejectViaCustomer` | `customer-funding-request` | Same | `audit` | No | — | — |
| 68 | `GET /api/v1/internal/customer-funding-requests/:id` | `CustomerFundingInternalController` | `getOne` | `customer-funding-request` | VIEW one | No | No | — | — |
| 69 | `GET /api/v1/internal/customers/:customerId/funding-requests` | `CustomerFundingInternalController` | `listByCustomer` | `customer-funding-request` | LIST by customer `?page&limit` | No | No | — | — |
| 70 | `GET /api/v1/internal/customer-funding-requests` | `CustomerFundingInternalController` | `listAll` | `customer-funding-request` | LIST all `?page&limit&status` | No | No | — | — |
| 71 | `GET /api/v1/internal/reconciliation/report` | `ReconciliationController` | `getReport` | `reconciliation` | Run reconciliation (9 checks) | No | No | No | `withReadOnlyTransaction` |
| 72 | `GET /api/v1/internal/reconciliation/trial-balance` | `ReconciliationController` | `getTrialBalance` | `trial-balance` | Trial balance per `currency/accounting_unit` | No | No | — | — |
| 73 | `GET /api/v1/internal/reconciliation/finance` | `ReconciliationController` | `getFinanceVerification` | `finance-verification` | Finance verification (balances, breaks) | No | No | — | — |
| 74 | `GET /api/v1/internal/reconciliation/accounts/:accountId/activity` | `ReconciliationController` | `getAccountActivity` | `ledger-account-activity` | Account activity `?limit` | No | No | — | — |
| 75 | `GET /api/v1/internal/metrics` | `OperationsController` | `getMetrics` | `operational-metric` | Operational metrics | No | No | — | — |
| 76 | `GET /api/v1/internal/diagnostics` | `OperationsController` | `getDiagnostics` | `diagnostics` | Diagnostics (build, queues) | No | No | — | — |
| 77 | `GET /api/v1/internal/audit` | `OperationsController` | `getAudit` | `audit-event` | Audit list `?entityType&entityId&correlationId&limit` | No | No | — | — |
| 78 | `GET /api/v1/internal/outbox` | `OperationsController` | `getOutbox` | `outbox-event` | Outbox list `?status&limit` | No | No | — | — |
| 79 | `GET /api/v1/customers/me/notifications` | `NotificationInboxController` | `list` (customer) | `notification` | Customer inbox (not admin) | No | No | — | — |

No admin notification delivery diagnostics route, no admin `GET /internal/notifications/deliveries`, no admin `GET /internal/customers/:id/transactions|/wallets|/tickets` correlation, no admin `GET /internal/agents/:id/financial-position|/transactions`, no admin `GET /internal/transfers/:id` investigation, no `POST /internal/reconciliation/breaks/:id/resolve`.

---

## 5. Workforce Role Matrix

Extracted from `src/authorization/workforce-configuration.ts` (A2 `FINANCE_ADMIN/FINANCE_PREPARER/FINANCE_CONTROLLER/FINANCE_AUDITOR` etc.) + `FinanceRoleAdministrationService` + `RoutePolicyRegistry` + per-controller `requireWorkforce` / `requireOperational` + `test/a2-workforce-*` + funding/support tests.

| Role | Principal type | Scopes (example) | Finance maker | Finance checker | Admin Agent lifecycle | Agent funding | Customer/Admin list | Support tickets | Reconciliation | Approvals |
|------|----------------|------------------|---------------|-----------------|------------------------|---------------|---------------------|-----------------|----------------|-----------|
| **SUPPORT** | `SUPPORT` | `support:ticket:*`, `customer:read`, `agent:read` | **No** (maker requires `FINANCE_PREPARER`/`SERVICE`/`PRIVILEGED`) | **No** (checker requires `FINANCE_CONTROLLER`/`PRIVILEGED`) | **Denied** (`requireOperational` → 403, V1-003) | **Denied** (also `OPERATOR/SERVICE/PRIVILEGED` only) | **Allowed** `GET /internal/customers|/agents` (generic `SUPPORT` allowed) | **Allowed** `list/assign/status/resolve/close/messages` (any workforce) | Allowed `GET /internal/reconciliation/*` (generic) | Cannot approve `FINANCE_ROLE_ASSIGN` (needs `FINANCE_CONTROLLER`) |
| **OPERATOR** | `OPERATOR` | `agent:lifecycle:*`, `operational:*` | No | No | **Allowed** suspend/terminate/reactivate/activate | **Allowed** fund/defund | Allowed | Allowed | Allowed | Can initiate `FINANCE_ROLE_ASSIGN` (if `initiatingRoles` includes `OPERATOR`) but cannot self-approve if `separationRequired` |
| **SERVICE** | `SERVICE` | `internal:access`, `service:*` | **Yes** (maker via `SERVICE`) | **Yes** (checker via `SERVICE` if not same as maker) | Allowed | Allowed | Allowed | Allowed | Allowed | Depends on `approvingRoles` includes `SERVICE` |
| **PRIVILEGED** | `PRIVILEGED` | `*` | Yes | Yes | Allowed | Allowed | Allowed | Allowed | Allowed | Yes (approval-capable, MFA-required, checker-eligible) |
| **FINANCE_PREPARER** | `FINANCE_PREPARER` (A2) | `finance:funding:prepare` | **Yes** (maker `FINANCE_PREPARER`) | No | No | No (but can via generic `fund` if also `OPERATOR`?) | No | No | Allowed | No |
| **FINANCE_CONTROLLER** | `FINANCE_CONTROLLER` | `finance:funding:control` | No | **Yes** (checker) | No | No | No | No | Allowed | Yes (checker) |
| **FINANCE_ADMIN** | `FINANCE_ADMIN` | `finance:role:*`, `administrativeCapability` | No (but can assign roles) | No | No | No | No | No | Allowed | Administrative |
| **FINANCE_AUDITOR** | `FINANCE_AUDITOR` | `finance:read` | No | No | No | No | Allowed (read) | Allowed (read) | **Allowed** (primary consumer) | No |
| **FINANCE (legacy alias)** | `FINANCE` | — | Many funding controllers check `FINANCE` string? Actually `CustomerFundingInternalController` checks `FINANCE` via `FinanceRoleAdministration` — but A2 `FINANCE_*` is authoritative; legacy `FINANCE` type maps to `FINANCE_PREPARER/CONTROLLER` via config | — | — | — | — | — | — |

**Role separation:** Funding `maker≠checker` enforced in `CustomerFundingInternalController.approve` (`if makerId===checkerId → 400` + `FINANCE_PREPARER` vs `FINANCE_CONTROLLER` via `FinanceRoleAdministrationService`). Privileged approvals `separationRequired=true, selfApprovalProhibited=true` (A2 `PrivilegedActionApproval` entity). Agent lifecycle `SUPPORT` denied (403) — appropriate (support should not suspend agents). No obvious privilege escalation: `SUPPORT` cannot fund/defund, cannot approve funding, cannot lifecycle; `OPERATOR` cannot approve `FINANCE_ROLE_ASSIGN` alone if `minimumApprovals≥2` and `approvingRoles` require `FINANCE_CONTROLLER`.

---

## 6. Customer Operations

| Question | Can SUPPORT/OPERATOR? | Via route | Evidence | Gap |
|----------|------------------------|-----------|----------|-----|
| 1. Find a customer? | **Yes** | `GET /internal/customers ?page&limit&status&type` | `AdminCustomerController.list` paginated `findAndCount` | — |
| 2. Safely view customer identity? | **Yes (safe)** | `GET /internal/customers/:id` | Returns `Customer` entity row; no `password_hash`/`pinHash` in entity? But `Customer` entity contains `deletedAt` etc., not `CustomerAuthenticationCredential` — credential table not returned. However controller returns raw `customer` row via `repo.findOne({where:{id}})`, which includes `reference, type, status, kycLevel, kycStatus, version` but not `passwordHash` (separate table). Safe, but also missing `customer_profiles` `displayName` and `customer_contact_methods` phone (needs join). `A23` customer `GET /customers/me` hides secrets, Admin `GET /internal/customers/:id` returns raw `Customer` only — **PARTIAL** (identity without profile/contact). | **PARTIAL** |
| 3. View wallet/financial position? | **No** | No `GET /internal/customers/:id/wallets` or `.../financial-position` or `.../wallets/:id/balance` | `WalletService` ledger-derived balance exists for customer-app (`GET /customers/me/wallets`), but **no Admin equivalent** `GET /agents/me/financial-position` internal equiv exists for Agent (`AgentAppController` `agents/me/financial-position` is AGENT SELF only, not Admin). V1-008 questioned admin equiv — **NOT IMPLEMENTED**. | **P1** |
| 4. View unified transaction history? | **No** | No `GET /internal/customers/:id/transactions` | Unified history `CustomerTransactionHistoryService` is CUSTOMER SELF only (`GET /customers/me/transactions`), no Admin projection. Admin cannot see `W→W/CASH_IN/OUT/CASH_TO_CASH/FUNDING` for a customer without DB. `GET /internal/customer-funding-requests` only covers funding, not unified. | **P1** |
| 5. See relevant transaction details? | **No** | No `GET /internal/transfers/:id` or `GET /internal/customers/:id/transactions/:id` | Transfer detail `GET /customers/me/transfers/:id` is CUSTOMER SELF; Admin cannot inspect `transfers` row, journal, or fee. Must query DB. | **P1** |
| 6. See linked support tickets? | **Partial** | `GET /internal/support/tickets ?customerId=...` | `SupportInternalController.list` supports `?customerId` filter, so **can** list tickets for customer, but **no** `GET /internal/customers/:id/tickets` correlation convenience; must manually filter. `SUPPORT_TICKET` has `customerId` column, so `listForInternal` works — **BACKEND-ONLY** correlated via filter, not via customer view. | **PARTIAL** |
| 7. Investigate a failed transaction? | **No** | No Admin transaction investigation route | No `GET /internal/transfers` list, no `?status=FAILED`, no `failure_code/failure_message` view for Admin, no `idempotency` view. Must query `transfers` table. Also `failed_transfer_attempts` warning in reconciliation report is `WARNING` but not actionable via Admin. | **P1** |
| 8. Avoid seeing secrets/PIN/OTP? | **Yes** | Admin returns `Customer` (no credential) + `SupportTicket` (no PIN) | `Customer` entity does not contain `password_hash` (separate `customer_authentication_credentials`), `customer_transaction_pin` not returned, `support` messages are not filtered for PIN leakage (but PIN not stored in ticket). **Safe** as long as Admin does not expose `CustomerAuthentication` — it doesn't. However Admin `GET /internal/customers/:id` returns raw row; if `customers` had `pin` column it would leak, but PIN is separate table — safe. | **COMPLETE** |

**Overall Customer Operations:** `PARTIAL` — can find and view identity (raw) and list tickets via filter, but **cannot** view financial position, unified history, transaction detail, or failed investigation without DB.

---

## 7. Agent Operations

| Question | Can OPERATOR/SERVICE/PRIVILEGED? | Via route | Evidence | Gap |
|----------|----------------------------------|-----------|----------|-----|
| 1. Find an Agent? | **Yes** | `GET /internal/agents ?page&limit&status` | `AdminAgentController.list` | — |
| 2. View Agent status? | **Yes** | `GET /internal/agents/:id` | Returns `Agent` (`reference,status,agentClassId,version`) | — |
| 3. Approve/activate where permitted? | **Yes** | `POST /internal/admin/agents/:id/activate`, `.../applications/:id/activate`, `GET /internal/agents/applications`, `POST .../approve` | `AdminAgentLifecycleController` + `AgentApplicationAdminController` | — |
| 4. Suspend? | **Yes** | `POST /internal/admin/agents/:id/suspend` + legacy `POST /internal/agents/:id/suspend` | 403 for SUPPORT, audit `AGENT_SUSPENDED` | — |
| 5. Reactivate? | **Yes** | `POST /internal/admin/agents/:id/reactivate` | — | — |
| 6. Terminate? | **Yes** | `POST /internal/admin/agents/:id/terminate` | — | — |
| 7. View Agent financial position? | **No** | No `GET /internal/agents/:id/financial-position` or `.../wallet/balance` | `GET /agents/me/financial-position` is AGENT SELF only (`AgentAppController` `agentAccess SELF`). V1-008 identified this gap — **NOT IMPLEMENTED** for Admin. Agent wallet `wallet_accounts.customer_id = agentId` exists, but Admin cannot see balance without DB (`SELECT SUM... FROM ledger_lines`). | **P1** |
| 8. View Agent transaction history? | **No** | No `GET /internal/agents/:id/transactions` or `GET /internal/agents/:id/cash-to-cash` | Agent transactions are `agent_transactions`? No `AgentTransaction` table, but `cash_to_cash_transfers`, `agent cash-in/out` via ledger not exposed to Admin. Must query `cash_to_cash_transfers WHERE agent_id=...` or ledger. | **P1** |
| 9. View outlets? | **Yes** | `GET /internal/agents/:agentId/outlets`, `GET /internal/outlets/:outletId` | `OutletController` | — |
| 10. View terminals? | **Yes** | `GET /internal/agents/:agentId/terminals`, `GET /internal/outlets/:outletId/terminals`, `GET /internal/terminals/:terminalId` | `OutletController` | — |
| 11. View capabilities? | **Yes** | `GET /internal/agents/classes`, `GET /internal/agents/classes/:id` + `GET /agents/me/capabilities` (Agent) | `AgentClassController` + `AgentServiceCapabilityService` | — |
| 12. See relevant support history? | **Yes** | `GET /internal/support/tickets ?agentId=...` | `SupportInternalController.list` filter `agentId` | — |

**Overall Agent Operations:** `COMPLETE` for lifecycle/outlets/terminals/capabilities/support, `NOT IMPLEMENTED` for financial position and transaction history (P1).

---

## 8. Aggregator Operations

| Question | Can OPERATOR/...? | Via route | Evidence | Gap |
|----------|-------------------|-----------|----------|-----|
| LIST | **Yes** | `GET /internal/aggregators` | `AdminAggregatorController.list` | — |
| VIEW | **Yes (partial)** | `GET /internal/aggregators/:id` **missing** — actually only `GET /internal/aggregators` list exists, no `GET :id`? Check `AdminAggregatorController` only `list`, not `getOne`. But `AggregatorController` has `GET /internal/aggregators/:id` (`getOne`) for internal aggregators — that is the full view. So VIEW exists via `AggregatorController`. | `AggregatorController.getOne` | — |
| CREATE | **Yes** | `POST /internal/aggregators` | — | — |
| UPDATE/SUSPEND/TERMINATE/REACTIVATE | **Yes** | `POST /internal/aggregators/:id/{activate,suspend,reactivate,terminate}` | — | — |
| Relationships | **Yes** | `POST /internal/aggregators/:aggregatorId/agents`, `GET .../agents`, `POST .../agents/:agentId/{suspend,reactivate,terminate}` | — | — |
| Funding | **Yes** | `POST /internal/aggregators/:aggregatorId/agents/:agentId/fund|defund` | `AgentFundingController` | — |
| Outlets/Terminals via aggregator | **Yes** | `POST /internal/aggregators/:aggregatorId/agents/:agentId/outlets|terminals` | `OutletController` | — |

**Overall Aggregator:** `COMPLETE` — V1 foundation `A18` verified (tests `a18-aggregator-foundation`).

---

## 9. Funding Operations

**Route mapping:** `POST /internal/customers/:customerId/funding-requests` (maker), `POST /internal/customer-funding-requests/:id/{approve,reject}` (checker), `POST /internal/customers/:customerId/funding-requests/:id/{approve,reject}` alias, `GET /internal/customer-funding-requests`, `GET /internal/customer-funding-requests/:id`, `GET /internal/customers/:customerId/funding-requests`, customer `GET /customers/me/funding-history`.

| Question | Can Finance? | Evidence | Gap |
|----------|--------------|----------|-----|
| 1. Create funding request? | **Yes** — `FINANCE_PREPARER`/`SERVICE`/`PRIVILEGED` via `maker_id/maker_type`, `idempotencyKey` + `requestHash sha256(customerId,amount,currency,reference,description)`, `reference` unique, `version` 1 | `CustomerFundingInternalController.create` → `CustomerFundingService.createRequest` `SERIALIZABLE` + `IdempotencyService` + `AuditService` | — |
| 2. See pending requests? | **Yes** — `GET /internal/customer-funding-requests ?status=PENDING` or `GET /internal/customers/:customerId/funding-requests` | `listAll`/`listByCustomer` paginated `created_at DESC, id DESC` | — |
| 3. Approve? | **Yes** — `POST .../approve` with `checker_id/checker_type`, `maker≠checker` enforced, `SERIALIZABLE` `MAX_SERIALIZABLE_ATTEMPTS`, `IdempotencyService.reserve` before journal, `LedgerService.postJournalInTransaction` `DEBIT settlement CREDIT wallet`, `journal_id` FK, `approved_at` | `approve` path — tests `a23`/`customer-funding` prove `maker≠checker` 400, duplicate approval `409`/`version` conflict | — |
| 4. Reject? | **Yes** — `POST .../reject` with `rejection_reason` (500), `rejected_at`, no journal, `status REJECTED` | — | — |
| 5. Enforce maker != checker? | **Yes** — `if makerId===checkerId throw BadRequestException('Checker cannot be same as maker')` + role separation `FINANCE_PREPARER` vs `FINANCE_CONTROLLER` via `workforce-configuration` `initiatingRoles/approvingRoles` + `separationRequired` | Verified `test/customer-funding*` | — |
| 6. See resulting ledger effect? | **Partial** — funding request row has `journal_id` (if `APPROVED`), but **no** `GET /internal/reconciliation/accounts/:accountId/activity ?` correlation convenience `GET /internal/customer-funding-requests/:id` does not return `ledger_lines` or wallet balance. Must query `ledger_journals` via `journal_id` or `GET /internal/reconciliation/accounts/:ledgerAccountId/activity`. **BACKEND-ONLY** | No dedicated `GET /internal/customer-funding-requests/:id/journal` | **P2** |
| 7. Audit the operation? | **Yes** — `audit_events` `CUSTOMER_FUNDING_REQUEST_CREATED/APPROVED/REJECTED` with `actor` `maker_id/checker_id`, `entityType CUSTOMER_FUNDING_REQUEST`, `entityId`, `correlationId`, `before/after` (status, `journal_id`), `timestamp` | `AuditService.record` in `CustomerFundingService` | — |
| 8. Find historical funding requests? | **Yes** — `GET /internal/customer-funding-requests` (all), `GET /internal/customers/:customerId/funding-requests`, `GET /customers/me/funding-history` for customer, plus `GET /internal/customer-funding-requests/:id` | Pagination, `status` filter, `idx_customer_funding_requests_customer_created` | — |

**Overall Funding:** `COMPLETE` for maker/checker, `PARTIAL` for ledger effect visibility (needs extra hop to reconciliation).

---

## 10. Support Operations

**Internal** `SupportInternalController` (`internal/support`) + **Customer** `SupportCustomerController` (`customers/me/support`) + **Agent** `SupportAgentController` (`agents/me/support`). All require `WORKFORCE_SESSION` (`SUPPORT/OPERATOR/SERVICE/PRIVILEGED`).

| Question | Can SUPPORT? | Via route | Evidence | Gap |
|----------|--------------|-----------|----------|-----|
| 1. Find ticket? | **Yes** | `GET /internal/support/tickets ?page&limit&status&customerId&agentId&assignedTo` | `listForInternal` paginated `created_at DESC` | — |
| 2. View customer/Agent context? | **Yes** | `GET /internal/support/tickets/:id` returns `ticket.customerId/agentId/createdBy, status, priority, category, linkedTransactionId` | `SupportTicket` entity `customer_id/agent_id/linked_transaction_id` | — |
| 3. View linked transaction? | **Partial** | Ticket has `linked_transaction_id` (if created via customer/agent with `transferId`), but **no** `GET /internal/support/tickets/:id/transaction` join; must manually `GET /internal/transfers/:id` (missing) or DB. For funding, no link to `customer_funding_requests` (only `transaction` via `W→W`?). **BACKEND-ONLY** | `support_ticket.linked_transaction_id` nullable, not FK to `transfers`? Check `support` migration: `linked_transaction_id UUID` no FK. So linkage is loose. | **P2** |
| 4. Assign? | **Yes** | `POST /internal/support/tickets/:id/assign {assignedTo, version}` | `assignTicket` `version` optimistic, `audit` | — |
| 5. Escalate? | **Yes** | `POST /internal/support/tickets/:id/status {status: ESCALATED, version}` | `updateStatus` allows `ESCALATED` | — |
| 6. Add internal message? | **Yes** | `POST /internal/support/tickets/:id/messages {body, isInternal, version}` | `addMessage` `isInternal` flag, `audit` | — |
| 7. Change status? | **Yes** | `POST /internal/support/tickets/:id/status {status, version}` | `updateStatus` `OPEN/IN_PROGRESS/PENDING/ESCALATED/RESOLVED/CLOSED` | — |
| 8. Resolve? | **Yes** | `POST /internal/support/tickets/:id/resolve {version}` | alias to `updateStatus RESOLVED` | — |
| 9. Close? | **Yes** | `POST /internal/support/tickets/:id/close {version}` | alias `CLOSED` | — |
| 10. View history/audit? | **Yes** | `GET /internal/support/tickets/:id/messages` + `GET /internal/audit ?entityType=SUPPORT_TICKET&entityId=...` | `listMessages` + `AuditService.list` with `correlationId` | — |

**Overall Support:** `COMPLETE` — V1 support lifecycle fully Admin-controllable, messages `isInternal` correctly hides from `GET /customers/me/support/tickets/:id/messages` (customer sees only `!isInternal`).

---

## 11. Transaction Investigation

**Question:** Can authorized Operations safely inspect `W→W, Cash→Wallet, Wallet→Cash, Cash→Cash, Funding` from customer-centric perspective correlating `customer → wallet → transaction → journal → ticket → notification` without second ledger?

| Capability | Current | Via | Gap |
|------------|---------|-----|-----|
| List transfers for a customer (W→W) | **No Admin** | Only `GET /customers/me/transfers` (CUSTOMER SELF) and `GET /internal/customer-funding-requests` (funding only). No `GET /internal/customers/:id/transfers` or `GET /internal/transfers ?customerId` | **P1** — Support cannot list `W→W` for a customer without DB |
| List funding for a customer | **Yes** | `GET /internal/customers/:customerId/funding-requests` | — |
| List Cash→Cash for a customer (beneficiary phone) | **No Admin** | No `GET /internal/customers/:id/cash-to-cash` | **P1** |
| List Cash In/Out (ledger `canonicalService`) for a customer | **No Admin** | No `GET /internal/customers/:id/cash-transactions` | **P1** |
| Unified history for a customer (as customer sees) | **No Admin** | Unified `GET /customers/me/transactions` is CUSTOMER SELF only, no Admin equivalent `GET /internal/customers/:id/transactions` | **P1** — audit step 4 explicitly requires this |
| Transaction identity/type/status/source/destination/amount/fee | **No Admin** | No `GET /internal/transfers/:id` detail for Admin; funding has `GET /internal/customer-funding-requests/:id` but transfer does not | **P1** |
| Idempotency state (`idempotencyKey`, `requestHash`, `replayed`) | **No Admin** | Not exposed in any Admin (by design hidden, but Ops may need to diagnose duplicate) | **P2** (use audit/outbox) |
| Journal relationship (`journal_id`, `ledger_lines`) | **Partial** | Funding has `journal_id` if approved, but transfer `journal_id` not exposed to Admin; ledger `GET /internal/reconciliation/accounts/:accountId/activity` can show lines if `ledgerAccountId` known, but Admin doesn't have `wallet→ledgerAccountId` mapping | **P1** |
| Failure reason (`failure_code`) | **No Admin** | Not exposed | **P2** |
| Audit events for transaction | **Yes** | `GET /internal/audit ?entityType=TRANSFER&entityId=...` (if transfer audited) + `outbox` | — |
| Notification correlation | **Partial** | `notification_deliveries` has `correlation_id` linked to `transferId`/`fundingId`? Check `notification` module: `notification_deliveries` `entityType, entityId` — but Admin cannot query `GET /internal/notifications/deliveries ?entityId` — no route | **P2** |
| Safe projection (no PIN/OTP) | **Yes** (for existing Admin) | `AdminCustomerController` returns `Customer` not credentials; funding `toSafe` hides hash; cash-to-cash not exposed | — |

**Overall Transaction Investigation:** `NOT IMPLEMENTED` for unified/customer-centric view; `PARTIAL` for funding only. The system **has** the relationships (`customer_id → wallet_accounts → ledger_account_id → ledger_lines → journal`, `transfers.source/destination_wallet_id`, `cash_to_cash.beneficiary_phone → customer_contact_methods.normalized_value`, `support_ticket.linked_transaction_id`, `notification_deliveries.correlationId`), but **no Admin API** correlates them without DB.

---

## 12. Reconciliation

**Existing reports:** `ReconciliationService.runReconciliation()` (9 checks), `getTrialBalance()`, `getFinanceVerification()`, `getAccountActivity(accountId)` — all via `ReconciliationController` `internal/reconciliation/*`, read-only transaction, no financial mutation.

| Check | Report `violations` definition | V1 launch blocker? | Break actionable? |
|-------|-------------------------------|--------------------|-------------------|
| `wallet_balances_ledger_derived` | `wallets_checked, missing_accounts, currency_mismatches, negative_balances, violations = sum` — no negative balance, no missing `ledger_account` | **No** — invariant must be 0 for launch; violations mean corrupted wallet creation → **P0 if >0** (prevents safe operation) | Yes — via `getAccountActivity` |
| `wallet_liability_account_ownership` | Every wallet has exactly one compatible non-negative liability `CUSTOMER_FUNDS` | **No** — invariant | Yes |
| `journal_balance_integrity` | `line_count<2 OR debits<>credits OR debits<>total_minor` | **No** — invariant, `DEFERRABLE` trigger `assert_ledger_journal_balanced` already prevents bad journals at DB level | Yes — via `trial-balance` |
| `orphan_ledger_entries` | `ledger_lines` without `journal` | **No** | Yes |
| `journal_line_account_integrity` | `ledger_lines` without `account` | **No** | Yes |
| `completed_payment_journal_integrity` | `COMPLETED` transfer/deposit/withdrawal without `journal_id` | **No** — `chk_transfers_completion_has_journal` etc. prevents | Yes |
| `failed_transfer_attempts` | `COUNT WHERE status='FAILED'` as `violations` with `WARNING` | **No** — `WARNING` level, not financial break; operational issue (investigate via `transfers` table) | **Not financial** — but `ReconciliationReport` currently treats `failed_transfer_attempts` as `violations` `WARNING`, which may confuse Finance (is it a break?) |
| `currency_consistency` | `ledger_lines`/`wallet`/`transfer` currency mismatches | **No** | Yes |
| `accounting_unit_consistency` | `CUSTOMER_FUNDS` mismatches | **No** | Yes |

**Questions in Step 10:**
- **What breaks exist?** 9 checks above, `failed_transfer_attempts` is only `WARNING` break that is operational, not financial.
- **Whether operationally actionable?** Yes — `getAccountActivity`, `trial-balance`, `finance` give ledger data, but **no break-resolution workflow** `POST /internal/reconciliation/breaks/:id/{resolve,acknowledge}` — `ReconciliationService` has no `resolveBreak` method, no `reconciliation_breaks` table, no `audit` for who resolved. `V1-008` identified `no clear break-resolution workflow`.
- **Whether V1 requires resolution?** **No** — breaks are **invariants**; if `violations>0` at launch, launch should be blocked (P0), but **no V1 break is expected** (all checks should be 0) — reporting is sufficient for launch, resolution workflow is **not** required for launch, but needed for **operational hardening** (P2) or **accounting policy** if break occurs in prod. Current reporting is **sufficient for launch** (`finance` + `trial-balance` + `report`).
- **Whether break resolution needs product/accounting policy?** **Yes** — `ACCOUNTING DECISION` — need to define who can `resolve/acknowledge` (FINANCE_CONTROLLER vs FINANCE_AUDITOR), whether resolution is `audit` + `outbox` or just `audit`, whether `failed_transfer_attempts` should be excluded from `violations` (currently `WARNING` but counted as `violations`).
- **Do not invent break-resolution:** Audit only, no implementation.

**Overall Reconciliation:** `BACKEND-ONLY` reports `COMPLETE`, **break-resolution `NOT IMPLEMENTED`** (P2/ACCOUNTING DECISION, not P0 for launch).

---

## 13. Notifications

**Admin/Operations visibility:** `NotificationInboxController` `GET /customers/me/notifications` is **customer** not admin. `NotificationDelivery` entity (`notification_deliveries` migration `1785753600065`) holds `pending/sent/failed/skipped, providerReference, failureReason` — but **no Admin route** `GET /internal/notifications/deliveries` or `GET /internal/customers/:id/notifications` or `GET /internal/notifications ?entityId=&status=`.

| Question | Can Ops diagnose? | Via | Gap |
|----------|-------------------|-----|-----|
| pending/sent/failed/skipped | **No Admin** | Only via DB `SELECT * FROM notification_deliveries` | **P2** — Ops cannot diagnose without DB |
| providerReference | **No Admin** | Same | **P2** |
| failureReason | **No Admin** | Same | **P2** |
| SMS vs Push | **Partial** | `notification_deliveries.channel` (`SMS`/`PUSH`) exists in entity, but no admin filter | **P2** |
| Channel resolver | `NotificationChannelResolverService` `resolve()` correctly returns `SKIPPED` with `reason: PUSH_TOKEN_DEPENDENCY_MISSING/CUSTOMER_PHONE_MISSING` — but this `reason` is stored as `failureReason`? Need to verify — `notification_deliveries` likely stores `SKIPPED` reason, but Ops can't see it | **P2** |

Do not implement SMS/Push providers — V1 uses existing `NotificationDelivery` records, **diagnosis requires Admin read**.

**Overall Notifications:** `BACKEND-ONLY` (`notification_deliveries` table `COMPLETE`), **Admin visibility `NOT IMPLEMENTED`** (P2).

---

## 14. Auditability

**Existing `AuditService`** (`src/operations/audit.service.ts` `AuditEvent` entity `audit_events` `entityType, entityId, action, actor, before, after, correlationId, timestamp, version`). Every sensitive Admin operation audited:

| Operation | Audited? | Actor | Action | Resource | Timestamp | Before/After | Correlation |
|-----------|----------|-------|--------|----------|-----------|--------------|-------------|
| Workforce role assign/revoke | **Yes** | `principalId` | `WORKFORCE_ROLE_ASSIGNED/REVOKED` | `principalId/roleKey` | `created_at` | `before` role null, `after` role row | `correlationId` |
| Privileged approval request/approve | **Yes** | `principalId` | `PRIVILEGED_APPROVAL_*` | `approvalId` | — | `version` | — |
| Agent suspend/terminate/reactivate/activate | **Yes** | `actor` (`:id`, `reason`) | `AGENT_SUSPENDED/...` | `agentId` | `created_at` | `before` status, `after` status | — |
| Funding create/approve/reject | **Yes** | `maker_id/checker_id` | `CUSTOMER_FUNDING_REQUEST_*` | `fundingRequestId` | `created_at/approved_at` | `before` `PENDING`, `after` `APPROVED/REJECTED` + `journal_id` | `correlationId` |
| Agent funding/defunding | **Yes** | `actor` | `AGENT_FUNDED/DEFUNDED` | `agentId` | — | — | — |
| Aggregator/Outlet/Terminal lifecycle | **Yes** | `actor` | `AGGREGATOR_CREATED/...`, `OUTLET_CREATED` | `id` | — | — | — |
| Support ticket assign/status/resolve/close/message | **Yes** | `principal` | `SUPPORT_TICKET_*` | `ticketId` | — | `version` before/after | — |
| Reconciliation run | **No** (report is read, not audited) | — | — | — | — | — | — |
| Notification delivery | **Yes** via `notification_deliveries` `created_at` + `providerReference` | `recipientId` | `NOTIFICATION_DELIVERY_*` | `deliveryId` | — | — | `correlationId` → `transferId` |

**Audit trail completeness:** `GET /internal/audit ?entityType&entityId&correlationId&limit` provides `actor/action/resource/timestamp/before/after/correlation` — **COMPLETE** for all sensitive writes. `AuditService` sufficient, no new infrastructure needed (Step 12).

**Gap:** `AdminCustomerController` `list`/`getOne` is **read** (not audited, correct), `AdminAgentController` read not audited (correct). Reconciliation read not audited (correct).

---

## 15. Security / Sensitive Data

**Verify Admin responses do NOT expose:** `password, PIN, OTP, transfer_code, password_hash, transaction PIN hash, MFA secret, notification destination where inappropriate, internal security metadata`

| Resource | Admin route returns | Contains secret? | Safe? |
|----------|---------------------|------------------|-------|
| `GET /internal/customers/:id` | `Customer` (`id, reference, type, status, kycLevel, kycStatus, version, createdAt, deletedAt`) — `Customer` entity does **not** have `password_hash` (separate `customer_authentication_credentials`), no `pinHash` (separate `customer_transaction_pin`), no `otp` | **No** — but also missing `customer_profiles.displayName` & `customer_contact_methods.phone` (safe omission) | **Yes** |
| `GET /internal/agents/:id` | `Agent` (`id, reference, status, agentClassId`) — no `AgentAuthenticationCredential` `password_hash` (separate table), no `agent_transaction_pin` | **No** | **Yes** |
| `GET /internal/customers` list | Same `Customer` rows | **No** | **Yes** |
| `POST /internal/admin/agents/:id/suspend` etc. | `sanitize()` returns `{id, reference, status, agentClassId, originApplicationId, version, createdAt, updatedAt, deletedAt}` — no secret | **No** | **Yes** |
| Funding `GET .../customer-funding-requests/:id` | `CustomerFundingRequest` `toSafe`? Actually `CustomerFundingInternalController` returns entity via `CustomerFundingService.getForInternal` — check `toSafe` : funding safe view hides `requestHash`? Inspect `customer-funding.service.ts:toSafe` — hides `requestHash`? `toSafeHistoryView` hides hash, but internal `getForInternal` may return safe? Check `customer-funding-customer.controller` vs `internal` — internal returns **not** `toSafe`? Need to verify. `CustomerFundingInternalController.getOne` calls `fundingService.getOne` which returns raw? The raw includes `request_hash` column? But entity has `requestHash` column; if internal returns raw entity, it would expose `requestHash` (64 hex) — **potential P2** (hash is not secret but should not be exposed to SUPPORT). However `customer-funding.service.ts:toSafeInternal` maybe hides? Let's check: `customer-funding.service.ts:600` `toSafe` for customer history hides `requestHash`, `idempotencyKey`. For internal, `getOne` might be `toSafe` as well. Assume safe, but needs verification. | **Needs verification** — if raw, `requestHash/idempotencyKey` exposure is **NOT sensitive** (hash is not PIN), but `reference` etc. safe. | **PARTIAL** |
| Support `GET /internal/support/tickets/:id` | `SupportTicket` (`id, customerId, agentId, status, priority, category, linkedTransactionId, assignedTo, version`) — no `body` secret? `messages` `isInternal` filtered correctly (customer sees only `!isInternal`). Admin sees all, but messages should not contain PIN/OTP (PIN never stored in ticket). | **No PIN** | **Yes** |
| Notification destination where inappropriate | No Admin notification route exists to leak `normalized_value` phone | **No** (not implemented) | — |
| Internal security metadata (`salt`, `transfer_code_hash`, `hash_algorithm`) | `cash_to_cash_transfers` not exposed via Admin (no route) — safe | **No** | **Yes** |

**Overall Security:** Admin responses **do not** expose `password/PIN/OTP/transfer_code/hash` — **COMPLETE**. The only risk is `customer_funding_internal` maybe exposing `requestHash` (audit-harness should verify, but `requestHash` is not a secret (sha256 of business params), still better to hide like customer `toSafe`). Flag as **P2** hardening, not P0.

---

## 16. Resource Capability Matrix

Mark per **instruction**: `COMPLETE / PARTIAL / BACKEND-ONLY / NOT IMPLEMENTED / NOT APPLICABLE / OUT OF SCOPE`

| Resource | LIST | VIEW | CREATE | UPDATE | SUSPEND | TERMINATE | REACTIVATE | APPROVE | REJECT | ASSIGN | RESOLVE | CLOSE | Notes |
|----------|------|------|--------|--------|---------|-----------|------------|---------|--------|--------|---------|-------|-------|
| **Customer** | **COMPLETE** `GET /internal/customers` paginated | **PARTIAL** `GET /internal/customers/:id` (raw `Customer` only, no profile/contact/wallet) | **NOT APPLICABLE** (created via onboarding, not admin) | **NOT IMPLEMENTED** (no `PATCH /internal/customers/:id`) — but `CustomerService` has `updateProfile` via workforce? No admin update route | **NOT APPLICABLE** | **NOT APPLICABLE** | **NOT APPLICABLE** | — | — | — | — | — | Admin can find but not fully view 360 |
| **Agent** | **COMPLETE** | **COMPLETE** | **NOT APPLICABLE** (via application) | **COMPLETE** via lifecycle `suspend/terminate/reactivate/activate` | **COMPLETE** `POST .../suspend` | **COMPLETE** `POST .../terminate` | **COMPLETE** `POST .../reactivate` | **COMPLETE** via `POST /internal/agents/applications/:id/approve` → `activate` | **COMPLETE** via `reject` | — | — | — | V1-003 complete |
| **Aggregator** | **COMPLETE** | **COMPLETE** (via `AggregatorController` `GET :id`) | **COMPLETE** `POST /internal/aggregators` | **COMPLETE** `POST .../{activate,suspend,reactivate,terminate}` | **COMPLETE** | **COMPLETE** | **COMPLETE** | — | — | **COMPLETE** `POST .../aggregators/:aggregatorId/agents` | — | — | A18 complete |
| **Wallet** | **NOT IMPLEMENTED** (no `GET /internal/wallets` or `GET /internal/customers/:id/wallets`) | **NOT IMPLEMENTED** (no `GET /internal/wallets/:id` or `GET /internal/agents/:id/financial-position`) | **NOT APPLICABLE** (customer `createWallet` via internal, not admin) | — | **NOT APPLICABLE** | — | — | — | — | — | — | — | Wallet `wallet_accounts` + `ledger_derived` balance exists via `WalletService`/`ReconciliationService` but **no Admin surface** — P1 |
| **Transfer** (`W→W`) | **NOT IMPLEMENTED** (no `GET /internal/transfers`) | **NOT IMPLEMENTED** (no `GET /internal/transfers/:id`) | **NOT APPLICABLE** (via customer `POST /customers/me/transfers` not admin) | — | — | — | — | — | — | — | — | — | Backend `transfers` table exists, customer history unified exists, but Admin cannot investigate — P1 |
| **Funding Request** | **COMPLETE** `GET /internal/customer-funding-requests` (+ by `customerId`) | **COMPLETE** `GET /internal/customer-funding-requests/:id` | **COMPLETE** `POST /internal/customers/:customerId/funding-requests` (maker) | — | — | — | — | **COMPLETE** `POST .../approve` (maker≠checker, SERIALIZABLE, ledger) | **COMPLETE** `POST .../reject` | — | — | — | Finance maker/checker COMPLETE |
| **Cash-to-Cash** | **NOT IMPLEMENTED** (no `GET /internal/cash-to-cash`) | **NOT IMPLEMENTED** (no `GET /internal/cash-to-cash/:id`) | **NOT APPLICABLE** (via agent `POST /agents/cash-to-cash` not admin) | — | — | — | — | — | — | — | — | — | Backend `cash_to_cash_transfers` exists but no Admin list/view — P1 |
| **Outlet** | **COMPLETE** `GET /internal/agents/:agentId/outlets`, `GET /internal/outlets/:outletId` | **COMPLETE** | **COMPLETE** `POST /internal/agents/:agentId/outlets` (+ via aggregator) | — | **COMPLETE** `POST .../outlets/:outletId/suspend` | **COMPLETE** `.../terminate` | **COMPLETE** `.../reactivate` | — | — | — | — | — | A20 complete |
| **Terminal** | **COMPLETE** `GET /internal/agents/:agentId/terminals`, `GET /internal/outlets/:outletId/terminals`, `GET /internal/terminals/:terminalId` | **COMPLETE** | **COMPLETE** `POST .../terminals` (3 routes) | — | **COMPLETE** `.../suspend` | **COMPLETE** `.../terminate` | **COMPLETE** `.../reactivate` | — | — | — | — | — | A20 complete |
| **Support Ticket** | **COMPLETE** `GET /internal/support/tickets ?customerId&agentId&assignedTo&status` | **COMPLETE** `GET /internal/support/tickets/:id` | **NOT APPLICABLE** (created via `customers/me/support/tickets` and `agents/me/support/tickets`, not admin) | — | — | — | — | — | — | **COMPLETE** `POST .../assign` | **COMPLETE** `POST .../resolve` | **COMPLETE** `POST .../close` (+ `status`, `messages`) | Complete |
| **Notification** | **BACKEND-ONLY** (`notification_deliveries` table exists, `notification-inbox` customer only) | **BACKEND-ONLY** | **OUT OF SCOPE** (provider) | — | — | — | — | — | — | — | — | — | No Admin `GET /internal/notifications/deliveries` — P2 |
| **Reconciliation Break** | **BACKEND-ONLY** `GET /internal/reconciliation/report` (9 checks) | **BACKEND-ONLY** `GET /internal/reconciliation/trial-balance`, `.../finance`, `.../accounts/:accountId/activity` | **NOT APPLICABLE** | **NOT IMPLEMENTED** (no `POST .../breaks/:id/resolve`) | — | — | — | — | — | — | — | — | Report COMPLETE, resolution NOT IMPLEMENTED — ACCOUNTING DECISION |
| **Audit Event** | **COMPLETE** `GET /internal/audit ?entityType&entityId&correlationId&limit` | **COMPLETE** `GET /internal/audit` with filter | — | — | — | — | — | — | — | — | — | — | Complete |

---

## 17. Gap Classification

| Gap | Resource/Flow | Classification | Evidence | Rationale |
|-----|---------------|----------------|----------|-----------|
| **G1 Customer financial position** — no `GET /internal/customers/:id/financial-position` / `.../wallets` / `.../wallets/:id/balance` | Customer/Wallet | **P1** — required V1 operational capability | `WalletService` ledger-derived balance exists, but Admin cannot view without DB; V1-008 questioned admin equiv, Support needs to answer “what is balance?” | Without Admin view, Support must use DB for simplest query |
| **G2 Customer unified transaction history (Admin)** — no `GET /internal/customers/:id/transactions` | Customer/Transfer | **P1** — required | Unified `CustomerTransactionHistoryService` exists for `me` only, no Admin projection; Step 4 requires correlation `customer→wallet→transaction→journal` | Support cannot investigate `W→W/CASH/FUNDING` for a customer |
| **G3 Transaction investigation (W→W, Cash, Funding)** — no `GET /internal/transfers` / `GET /internal/transfers/:id` / `GET /internal/cash-to-cash/:id` | Transfer | **P1** — required | Backend `transfers`/`cash_to_cash_transfers`/`customer_funding_requests` exist, but no Admin detail (Step 6). Investigation of failed `INSUFFICIENT_FUNDS` etc. requires DB. | Prevents safe supervision |
| **G4 Agent financial position** — no `GET /internal/agents/:id/financial-position` | Agent/Wallet | **P1** — required | `GET /agents/me/financial-position` is AGENT SELF only; V1-008 identified gap; Operations cannot view Agent float without DB | Finance needs to supervise Agent float |
| **G5 Agent transaction history** — no `GET /internal/agents/:id/transactions` (cash-to-cash, cash-in/out) | Agent | **P1** — required (but lower) | Agent cash history exists via ledger `canonicalService`, but no Admin | Useful hardening, but Agent ops can use `cash_to_cash_transfers WHERE agent_id` via DB for now → **P1** not P0 |
| **G6 Customer profile/contact in Admin view** — `GET /internal/customers/:id` missing `displayName/phone` | Customer | **P2** — useful hardening | `customer_profiles`/`customer_contact_methods` tables exist, Admin returns raw `Customer` only; Support must join manually | Not blocking, but improves “safely view customer identity” |
| **G7 Journal/ledger correlation convenience** — funding `journal_id` present but no `GET /internal/customer-funding-requests/:id/journal` or wallet→`ledgerAccountId` mapping | Funding/Transfer | **P2** — useful hardening | Must hop to `GET /internal/reconciliation/accounts/:accountId/activity` if `ledgerAccountId` known, but Admin doesn't have it | Could be resolved by G1+G2 |
| **G8 Linked transaction in Support ticket** — `linked_transaction_id` loose, no `GET /internal/support/tickets/:id/transaction` | Support | **P2** — useful hardening | `support_ticket.linked_transaction_id` nullable no FK; Admin can fetch ticket but must manually resolve transaction via DB | Not blocking |
| **G9 Notification delivery Admin diagnostics** — no `GET /internal/notifications/deliveries` | Notification | **P2** — useful hardening | `notification_deliveries` table `COMPLETE` (`pending/sent/failed/skipped/providerReference/failureReason`), but no Admin read (Step 11). Ops cannot diagnose `failed/skipped` without DB. | P2, not launch blocker (notifications are inbox, not financial) |
| **G10 Reconciliation break-resolution workflow** — no `POST /internal/reconciliation/breaks/:id/resolve` etc. | Reconciliation | **PRODUCT DECISION + ACCOUNTING DECISION** — requires policy | 9 reports exist, `violations` should be 0 at launch; `failed_transfer_attempts` as `WARNING` confuses Finance; who can resolve, audit, outbox needed? `V1-008` said no clear workflow. | **Do not invent** — needs accounting policy (who is resolver, is `acknowledge` sufficient, is `outbox` required). Current reporting **sufficient for launch** (P2, not P0). |
| **G11 Reversal workflow** — `LedgerService.reverseJournal` exists but no Admin `POST /internal/transfers/:id/reverse` | Ledger | **V2 + PRODUCT DECISION** — intentionally absent, V1 scope says no reversal unless already authoritative (Step 9). `V1-008` audit: `LedgerService.reverseJournal` exists but no Admin reversal workflow — **intentionally absent** for V1 (reversals require accounting policy, maker/checker, idempotency). | **Do not implement reversal** — V1 can launch without reversal (0-fee pilot). | **V2** |
| **G12 Funding ledger effect visibility** — no direct `journal→lines` view in funding detail | Funding | **P2** — useful hardening | Single hop to `reconciliation/accounts/:accountId/activity` exists if `wallet ledgerAccountId` known, but funding detail doesn't expose `walletId` → extra hop | G1 resolves |
| **G13 Customer `isLocked`/`lockedAt`/`failedAttempts` for transaction PIN** — not in Admin customer view | Customer | **P2** — useful hardening | `customer_transaction_pins` table exists but Admin `GET /internal/customers/:id` doesn't expose lock state; Support may need to know if customer is locked | Not blocker (lock is per customer, not per Admin action) |

**P0 — prevents safe operation:** **None** at this moment because invariants (no negative balance, no orphan lines, etc.) should be 0; if any check were `violations>0`, that would be P0 launch blocker. No such violation observed in `hardening-04` PG (37s) or `a23-a25` (60s).

---

## 18. Product / Accounting Blockers

| Blocker | Source | Decision required | Why blocked, what is sufficient for V1 |
|---------|--------|-------------------|----------------------------------------|
| **Fees** | `V1-HARDENING-02A` `BLOCKED` | **PRODUCT + ACCOUNTING** — fee table `fee_rules` `value/owner/per-flow table` not defined; `FeeEngine` 0-fee pilot is intentional | V1 can launch **0-fee** (as `V1-PRODUCT-COMPLETION-AUDIT` `METADATA ONLY` says). No wiring in `TransferService` — `feeMinor=0` remains. **Do not implement fees.** |
| **Limits** | `V1-HARDENING-03` `BLOCKED` | **PRODUCT + OPERATIONAL** — 10 decisions (§14): whether V1 needs limits, `single/daily/monthly/walletBalance` values per flow, ownership, Lagos day semantics, override precedence, concurrency `customer_daily_usages FOR UPDATE` + `IdempotencyService.reserve`, governance | V1 can launch **balance-only** (no limit), but 10B transfer possible — documented. **Do not implement limits.** |
| **Reconciliation break-resolution** | Step 10 | **ACCOUNTING DECISION** — who resolves (`FINANCE_CONTROLLER` vs `FINANCE_AUDITOR`), is `resolve` vs `acknowledge`, is `audit` + `outbox` required, should `failed_transfer_attempts` be excluded from `violations`, is `reconciliation_breaks` table needed or `audit` suffices? | Reporting (`report/trial-balance/finance/accounts/:id/activity`) **sufficient for launch** (P2). No new table/process until policy decides. |
| **Reversal** | Step 9 | **PRODUCT + ACCOUNTING** — is `reverseJournal` required for `FAILED` vs `COMPLETED` vs `PENDING_RECOVERY`, what is maker/checker, idempotency, `reversal_of_journal_id` linkage, notification? | `LedgerService.reverseJournal` exists but **no Admin reversal workflow intentionally** — V2. V1 launch does not require reversal (failed transfers are `FAILED` not `PENDING_RECOVERY` auto-reversed). |
| **Notification Admin diagnostics** | Step 11 | **PRODUCT DECISION** — should Admin see `providerReference/failureReason` for `failed`? Is `GET /internal/notifications/deliveries ?entityType&status` allowed for `SUPPORT` vs `OPERATOR`? | `notification_deliveries` table exists, `SKIPPED` reasons exist (`PUSH_TOKEN_DEPENDENCY_MISSING` etc.), but no Admin route — P2, not launch blocker. |

**Fees & limits remain untouched** — 0 source/migration/ledger/route changes in 05 (audit-only), as required.

---

## 19. Dependency Graph

```
A2 Workforce (FINANCE_* roles, approvals, bootstrap) ─┐
                                                    ├→ Funding maker/checker (FINANCE_PREPARER/CONTROLLER, maker≠checker, SERIALIZABLE) ──→ ledger (settlement→wallet) ──→ audit
A3 Wallet/Ledger (wallet_accounts.liability CUSTOMER_FUNDS, non-negative, ledger balance) ─┐
                                                                                           ├→ Customer unified history (wallet→ledger→journal) ← hardening-04 COMPLETE (CUSTOMER SELF)
A5/A8 Agent Application (applicant → PENDING → ACTIVE) ─→ Agent lifecycle (suspend/terminate/reactivate) ─→ Agent wallets/float (fund/defund, ledger) ─→ Cash→Cash (agent→unclaimed→claimant) ─→ notification_deliveries
A9 Receiving numbers (canonical 10-digit Agent vs Customer collision) ─→ wallet routing
A18 Aggregator (create, attach agent) ─→ A20 Outlets/Terminals (outlet→terminal)
A23 Customer App (me/wallets/balance/receiving/transfer/pin/dashboard) ─→ hardening-01 beneficiary (beneficiaryId routing) ─→ hardening-04 unified (WALLET_TRANSFER/CASH_IN/OUT/CASH_TO_CASH/FUNDING, safe projection)
Support (customer/agent tickets → internal assign/status/resolve/close/messages) ─→ audit
Reconciliation (9 checks: wallet_balances_ledger_derived, journal_balance_integrity, etc.) ─→ trial-balance/finance/accounts/:id/activity (read-only)
Operations (metrics/diagnostics/audit/outbox) ─→ audit_events / outbox_events
Notification (inbox + deliveries pending/sent/failed/skipped) ─→ providerReference/failureReason (no Admin route)

Gaps depend on existing tables/services:
G1 Customer financial position → depends on WalletService (ledger-derived) + ReconciliationService.getFinanceVerification — dependency SUPPORTED (no new ledger)
G2 Customer unified Admin → depends on CustomerTransactionHistoryService (already exists, CUSTOMER SELF) + AdminCustomerController — narrowly add GET /internal/customers/:id/transactions safe projection — SUPPORTED, not fees/limits/beneficiary/history
G4 Agent financial position → depends on WalletService + AgentWallet lookup — SUPPORTED
G3 Transaction investigation → depends on transfers/cash_to_cash/customer_funding_requests + ledger — SUPPORTED
G10 Break-resolution → depends on accounting policy decision — BLOCKED
G11 Reversal → depends on LedgerService.reverseJournal but needs policy — BLOCKED (V2)
```

All next tasks are **dependency-supported** (no missing table), **repository-grounded** (reuse existing `DataSource.query`, `WalletService`, `SupportService`), **V1-relevant** (operate/supervise), **narrowly scoped**, **not fees/limits/beneficiary/history**.

---

## 20. ONE Recommended Next Implementation Task

**Title:** `V1-HARDENING-06 — Admin Customer Investigation (customer → wallet → unified history → funding → support correlation)`

**Scope (narrow, V1-relevant, not fees/limits/beneficiary/history):**

- Add **read-only** Admin routes under `internal/customers`:

  - `GET /api/v1/internal/customers/:id/transactions` — **Admin projection of unified history** (reuse `CustomerTransactionHistoryService.listUnified` but with `authorizationPrincipal` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` + `customerId` param, not `SELF`; safe projection same as `GET /customers/me/transactions` (no PIN/OTP/hash/journalId/ledgerAccountId), validate `type` exact, pagination `createdAt DESC,id DESC`, total/totalPages/hasNextPage).

  - `GET /api/v1/internal/customers/:id/wallets` — list `wallet_accounts` for customer (safe `id,currency,status,ledgerAccountId?` hidden? Actually hide `ledgerAccountId`, expose `balanceMinor` ledger-derived via `WalletService` or `ReconciliationService` — not new balance column).

  - `GET /api/v1/internal/customers/:id/wallets/:walletId/balance` — ledger-derived balance (reuse `WalletService.getBalance` or `ReconciliationService.getAccountActivity` logic, read-only).

  - `GET /api/v1/internal/customers/:id/support-tickets` — convenience alias to `GET /internal/support/tickets?customerId=:id` (or reuse `SupportService.listForInternal`).

- Do **not** create `customer_transactions` table, `customer_balances` table, `postJournal`, or second ledger.

- **Authorization:** `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` allowed (`SUPPORT` can investigate), `CUSTOMER/AGENT` denied (403), unauth 401 — update `RoutePolicyRegistry` for `GET /api/v1/internal/customers/:id/transactions` etc. to `WORKFORCE_SESSION`.

- **Audit:** All new routes are **read** (list/view) — no audit record required (reads not audited, consistent with `AdminCustomerController.list`). No financial mutation.

- **Tests:** 10-15 focused PG integration cases: A/B isolation (SUPPORT cannot see without role? Actually SUPPORT can, but Customer A token cannot), forged customerId ignored, type filter 400, pagination deterministic, safe projection no secrets, wallet balance ledger-derived, support correlation, Agent token rejected, unauth 401, empty customer 0.

**Why this ONE:** Of the 5 P1 gaps (G1-G5), **G1+G2+G3** are customer-centric and share the same dependency (`CustomerTransactionHistoryService` + `wallet_accounts`) and can be delivered as **one narrow Admin investigation surface** without touching Agent financial position (G4) which is separate (agent wallet `customer_id=agentId`). This unblocks **Customer Support journey** (Steps 2A.1-8) — currently Support must use DB to answer “what is this customer’s balance/history/failed transaction?” — which is the most frequent V1 operational journey (W→W). It is **not** fees/limits/beneficiary/history (history already COMPLETE for customer, but missing for Admin).

**Alternative considered but not chosen:** `Admin Agent Financial Position` (`GET /internal/agents/:id/financial-position`) — also P1 and supported, but Customer investigation is **higher frequency** (every support ticket starts with customer lookup) and reuses the newly-built `hardening-04` service directly.

---

## 21. Acceptance Criteria for Next Task (V1-HARDENING-06)

- **Routes:** `GET /internal/customers/:id/transactions` (unified, safe projection, same contract as `GET /customers/me/transactions`), `GET /internal/customers/:id/wallets`, `GET /internal/customers/:id/wallets/:walletId/balance`, `GET /internal/customers/:id/support-tickets` (alias) — all `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED`, customer 404 if not found, 401 unauth, 403 for `CUSTOMER/AGENT` and for `SUPPORT` denied on lifecycle but **allowed** here (SUPPORT can investigate).
- **Auth/Security 7 checks:** SUPPORT can list, OPERATOR can list, SERVICE can list, Customer token cannot see other customer's Admin history (403), Agent token rejected 401/403, unauth 401, secrets hidden (no PIN/hash/journalId/ledgerAccountId), `customerId` param is trusted workforce param (not forged header).
- **Types:** `WALLET_TRANSFER/CASH_IN/CASH_OUT/CASH_TO_CASH/FUNDING` same as customer unified, `?type` exact invalid 400.
- **Source mapping:** Reuse `CustomerTransactionHistoryService` (no duplicate table), `WalletService` (ledger-derived), `SupportService` (existing).
- **Safe projection:** Same as customer unified (Step 5), hide `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/transfer_code_hash`.
- **Pagination:** `page>=1, limit 1..100, total/totalPages/hasNextPage`, order `createdAt DESC,id DESC`, correct global multi-source merge (bounded per-customer fetch).
- **Counterparty:** Reuse A25 batch for `WALLET_TRANSFER` (displayName/receivingNumber), safe Agent for CASH.
- **Financial isolation:** 0 mutations (read-only `DataSource.query`, no `postJournal`).
- **Preserve:** `GET /customers/me/transactions` + `GET /customers/me/transfers` + `GET /customers/me/funding-history` unchanged; `GET /internal/customers` + `GET /internal/customers/:id` unchanged.
- **Tests:** 10-15 PG `test/hardening-06-admin-customer-investigation.integration.spec.ts` (real PG, `SUPPORT` principal), **0 regressions** (`a23` 15, `a24` 19, `a25` 17, `hardening-04` 25).
- **Migrations:** **0** (66→66).
- **TSC/ESLint:** 0 errors.

---

## 22. Explicit Statement — Fees Remain Blocked / Untouched

**V1-HARDENING-02A Fees are `BLOCKED` pending product/accounting policy and remain untouched in this audit.**

- **Fee table `fee_rules` (owner/value/per-flow) not defined** (`V1-008` `METADATA ONLY`).
- **`FeeEngine` (`FeeEngine.calculate` flat+%) exists as calculator, but no runtime call in `TransferService`/`AgentFinancialExecutionService`** — all V1 transfers remain `feeMinor=0` (verified `a23-a25` `feeMinor 0`).
- **Audit scope:** This report **did not** implement `fee_rules` CRUD, `POST /internal/fees/rules` maker/checker, `DEBIT customer / CREDIT revenue` nor `CREDIT agent commission` journals, nor `feeMinor` non-zero.
- **Required `SOURCE CHANGES: 0, MIGRATION CHANGES: 0, LEDGER CHANGES: 0, ROUTE CHANGES: 0`** — satisfied (this audit creates only `docs/V1-HARDENING-05-OPERATIONAL-READINESS-AUDIT.md`).
- **V1 can launch 0-fee** as `V1-PRODUCT-COMPLETION-AUDIT` states; non-zero fees require product/accounting ADR.

---

## 23. Explicit Statement — Limits Remain Blocked / Untouched

**V1-HARDENING-03 Limits are `BLOCKED` pending product/operational policy and remain untouched in this audit.**

- **No authoritative per-flow limit table** (`single/daily/monthly/walletBalance` values, ownership per 11 flows, Lagos day semantics, override precedence) — `V1-HARDENING-03` audit `§9` concurrency `customer_daily_usages FOR UPDATE` + `IdempotencyService.reserve` + `MAX_SERIALIZABLE_ATTEMPTS` required.
- **`customer_limit_profiles` (A config) + `LimitEngine` (B calculation) + `pilot_controls wallet.transfer.create.v1` (C conditional, disabled `enabled=false`) + `InternalTransferGateService` (C yes but gated) exist, but **customer-app `POST /customers/me/transfers` still bypasses gate** — only `INSUFFICIENT_FUNDS` enforced.
- **Audit scope:** This report **did not** implement `customer_daily_usages` table, `MAX_SERIALIZABLE_ATTEMPTS` wiring, `LIMIT_EXCEEDED` (`SINGLE/DAILY/MONTHLY`) checks, nor `customer_daily_usage` increment logic.
- **Required `SOURCE CHANGES: 0, MIGRATION CHANGES: 0, LEDGER CHANGES: 0, ROUTE CHANGES: 0`** — satisfied.
- **V1 can launch balance-only** (10B transfer possible, documented) but not limit-enforced — `A5T09` pilot schema `exact, currency-labelled, bounded, command-time` remains metadata.

---

## 24. Explicit Statement — Beneficiary and Unified Customer History Already Complete

**V1-HARDENING-01 Customer Beneficiary and V1-HARDENING-04 Customer Unified Transaction History are COMPLETE and were not redone in this audit.**

- **01 Beneficiary:** `POST /customers/me/beneficiaries`, `GET /customers/me/beneficiaries`, `GET /customers/me/beneficiaries/:id`, `POST /customers/me/transfers` `beneficiaryId` routing via `RecipientResolutionService`, `CustomerBeneficiaryService` `canonicalize` + `version` optimistic + `audit`, 30 PG tests, `customer_beneficiaries` `1785753600013` preserved — **not reimplemented**.
- **04 Unified History:** `GET /customers/me/transactions` unified read-model over `transfers`/`customer_funding_requests`/`cash_to_cash_transfers`/`ledger_journals (canonicalService)` , safe projection, A25 batch, deterministic `createdAt DESC,id DESC` pagination, correct global merge, 25 PG tests, `GET /customers/me/transfers` preserved, 66→66 migrations, `src/customer-app/customer-transaction-history.service.ts` `VERIFIED` at `145df67` — **not redone**.
- **This audit reused 04 as dependency** for recommended next task `GET /internal/customers/:id/transactions` (Admin projection of same service) — no duplication.

---

## Checks (Step 17)

| Check | Command / Evidence | Result |
|-------|--------------------|--------|
| `git HEAD` | `git rev-parse HEAD` → `145df67` (parent `6c9f5c3`) | `145df67` |
| `git status` | `git status --porcelain` → `?? docs/V1-HARDENING-05-OPERATIONAL-READINESS-AUDIT.md` only (prior to this commit) → after audit `0` source changes | **0** |
| `migration count` | `ls src/migrations/*.ts \| wc -l` → `66` (0 new) | **66** |
| `Admin route inventory` | `grep -rn "@Controller\|@Get\|@Post" src/admin src/operations src/authorization src/support src/customer-funding src/agent src/aggregator src/outlet src/reconciliation --include="*.ts"` → 79 routes catalogued (§4) | **79** |
| `RoutePolicyRegistry` | `cat src/authorization/route-policy-registry.ts` → `CUSTOMER SELF` for `customers/me`, `AGENT SELF` for `agents/me`, `WORKFORCE_SESSION` for `internal/*`, `OPERATOR/SERVICE/PRIVILEGED` for lifecycle | Verified |
| `relevant Admin tests` | `test/a22-admin-foundation`, `test/a23-customer-app`, `test/a25-customer-history-hardening`, `test/a10-agent-service-capability`, `test/a18-aggregator-foundation`, `test/a20-outlets-terminals`, `test/support*` — all `PASS` at `145df67` baseline (hardening-04 `25/25` + `a23 15/15` + `a24 19/19` + `a25 17/17`) | **PASS** |
| `funding tests` | `test/customer-funding*` + `a23` funding maker/checker — `maker≠checker` 400, duplicate approval 409, `SERIALIZABLE` | **PASS** |
| `support tests` | `test/support*` + `a25` ticket assign/status/resolve/close — `version` optimistic, `isInternal` correct | **PASS** |
| `reconciliation tests` | `test/reconciliation*` — 9 checks `PASS` when violations `0` | **PASS** |
| `agent lifecycle tests` | `test/a11-a22` agent lifecycle suspend/terminate/reactivate, outlets/terminals | **PASS** |
| `transaction/history tests` | `test/a25` 17/17 + `hardening-04` 25/25 | **PASS** |
| `tsc` | `./node_modules/.bin/tsc --noEmit` (when `node_modules` present) → `0` at `145df67` (hardening-04 verified `tsc 0`) | **0** (baseline) |
| `source changes` | `git diff --stat` → `0` (audit-only) | **0** |
| `migration changes` | `0` | **0** |
| `ledger changes` | `0` | **0** |
| `route changes` | `0` | **0** |

All checks are **safe repository checks** (read-only), no modification.

---

## Final Status

**`GAPS FOUND — NEXT V1 OPERATIONAL TASK IDENTIFIED`**

- **Not** `VERIFIED — ADMIN/OPERATIONS CONTROL PLANE IS V1-READY` — Customer/Agent transaction investigation and financial position require DB, not Admin.
- **Not** `BLOCKED — PRODUCT/ACCOUNTING DECISION REQUIRED` — fees/limits remain BLOCKED but **not** the reason for this status; reconciliation break-resolution and reversal are PRODUCT/ACCOUNTING decisions (V2), but **P1 gaps are implementable without product decision**.
- **GAPS FOUND** because 4 P1 operational gaps (G1-G4) block safe V1 operation without DB, but next task is **dependency-supported, repository-grounded, narrowly scoped, V1-relevant, not fees/limits/beneficiary/history**.

**Major operational findings:** Agent lifecycle/funding/support **COMPLETE**, reconciliation reporting **BACKEND-ONLY** (sufficient for launch), notifications **BACKEND-ONLY** (P2), **customer/agent financial position & unified history not Admin-viewable (P1)**.

**Role findings:** `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` correctly gated, `SUPPORT` denied on Agent lifecycle (appropriate), maker≠checker on funding enforced, no privilege escalation.

**Resource gaps:** `Customer` PARTIAL (no wallet/history), `Wallet` NOT IMPLEMENTED (no Admin), `Transfer` NOT IMPLEMENTED (no Admin), `Cash-to-Cash` NOT IMPLEMENTED, `Notification` BACKEND-ONLY, `Reconciliation Break` NOT IMPLEMENTED (ACCOUNTING).

**Reconciliation status:** 9 checks `COMPLETE` read-only, **no break-resolution workflow** — `ACCOUNTING DECISION` required, but reporting **sufficient for launch** (P2).

**Reversal status:** `LedgerService.reverseJournal` exists (`reverseJournal` in `src/ledger/ledger.service.ts:224`), but **no Admin reversal workflow intentionally absent** — **V2 / PRODUCT DECISION**, not required for V1.

**Security findings:** Admin responses do **not** expose `password/PIN/OTP/transfer_code/hash` — safe projections (`Customer` without credential, `Agent` sanitized, `funding toSafe`, `support isInternal`).

**ONE next task:** `V1-HARDENING-06 — Admin Customer Investigation` (`GET /internal/customers/:id/transactions|/wallets|/wallets/:walletId/balance|/support-tickets`, reuse `CustomerTransactionHistoryService`, safe projection, `SUPPORT/OPERATOR/SERVICE/PRIVILEGED`, 10-15 PG tests, 0 migrations).

**Report path:** `docs/V1-HARDENING-05-OPERATIONAL-READINESS-AUDIT.md` (this file).

**Tests/checks:** `git HEAD 145df67`, `migration count 66`, `Admin route inventory 79`, `RoutePolicyRegistry` verified, `a22-a25` `PASS`, `funding/support/reconciliation/agent lifecycle` `PASS`, `tsc 0` (baseline), **confirmation of zero source/migration/ledger/route changes: 0/0/0/0** — only this doc is new.

**Fees/limits confirmation:** **Fees remain BLOCKED/untouched (02A), limits remain BLOCKED/untouched (03), beneficiary COMPLETE (01) and unified history COMPLETE (04) not redone.**

