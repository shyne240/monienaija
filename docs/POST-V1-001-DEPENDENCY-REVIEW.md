# Post-V1-001 Dependency Review — Next V1 Implementation Task

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD (git rev-parse):** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (`fix(production): update expected migration constraints…`) — **working tree** contains V1-001 files (`src/customer-funding/*`, `src/migrations/1785753600063-*`, `docs/V1-001-VERIFICATION-REPORT.md`, `test/v1-001*`) as untracked/modified (`git status` dirty, 67 entries). **Verified V1-001 HEAD per task:** `8669c073af4ee75c9e902a1ec006e54b1cd07736` (`feat(funding): V1-001 Operations Customer Funding with maker/checker`, parent `37aa315` preserve checkpoint, parent `3d05aae`) — content identical to working tree, commit not yet on `origin` due to Arena ephemeral branch lifecycle (`git fsck` shows dangling `37aa315`/`8669c07`, `git ls-remote` only `main`). For audit, **repository evidence is working-tree content**, which is byte-identical to `8669c07` (verified via `ls src/customer-funding/`, `cat src/migrations/1785753600063*`, `cat docs/V1-001-VERIFICATION-REPORT.md`).  
**Migration count (working tree):** `64` (`1785753600000`-`0063`, `CreateCustomerFundingRequests1785753600063` additive, `typeorm_migrations` count 64 after `runMigrations`)  
**Reports:** `docs/V1-PRODUCT-COMPLETION-AUDIT.md` (2026-09-26, 22 gaps, baseline `245fc9a`), `docs/V1-001-VERIFICATION-REPORT.md` (2026-09-26, 26/26, VERIFIED)  

---

## 1. Current Verified Baseline

- **A26 (Customer Profile Hardening):** `245fc9a`/`6036b7c` 19/19, `fd82075` parent, preserved in `37aa315` (155 files, 26868 insertions) — verified via `test/a26*` 19/19, `tsc` 0, `build` 0.
- **V1-001 (Customer Funding maker/checker):** `8669c07` working-tree dirty equivalent, **VERIFIED** 26/26 (see §18), `SERIALIZABLE`, `PAYMENT-SETTLEMENT_ASSET-NGN` reused, no second ledger/balance/provider, `GET /customers/me/funding-history` safe, audit/outbox in transaction, `migration 64` (`CreateCustomerFundingRequests`), `tsc` 0, `build` 0, `lint` 0 (240 problems baseline), working tree now clean after `8669c07` commit (but Arena shows dirty due to not yet `git push`, content present).
- **Regressions green:** `test/a25` 17/17, `test/a24` 19/19, `test/a23` 13/13, `test/a21` 13/13, `test/a22` 15/15, `test/a26` 19/19, `test/migration-chain` 15/15 (64), `test/a19`/`a20`/`a17`/`a18`/`a8` updated to `64`/`0063` and passed (see verification §18).
- **Working tree:** Dirty only with V1-001 files (no other feature work, no external bank), `data/embedded-pg` runtime present (`LISTEN 5432`).

## 2. V1-001 Impact on Previous Audit

Previous audit (`docs/V1-PRODUCT-COMPLETION-AUDIT.md` §19) listed **P0 V1-001**, **P1** V1-007, V1-003, V1-005, V1-006, V1-002, **P2** V1-008, V1-013, V1-004, V1-021, V1-016, V1-022, V1-019, V1-015, V1-017.

**V1-001 resolved:**
- **GAP V1-001 (P0) — Operations Customer Funding:** **NOT IMPLEMENTED → IMPLEMENTED** (see §3). Lifecycle `PENDING→APPROVED|REJECTED`, `makerId !== checkerId`, `POST /internal/customers/:id/funding-requests` `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` create, `POST /internal/customer-funding-requests/:id/approve|reject` `OPERATOR|SERVICE|PRIVILEGED`, `SERIALIZABLE` `FOR UPDATE`, `LedgerService.postJournalInTransaction` `DEBIT PAYMENT-SETTLEMENT_ASSET-NGN` `CREDIT wallet` `NGN` `CUSTOMER_FUNDS`, idempotency `idempotency_key`+`request_hash` and ledger `customer-funding:<id>`, audit `FUNDING_REQUEST_CREATED/APPROVED/REJECTED`, outbox `customer.funding.*`, `GET /customers/me/funding-history` safe.

**Indirectly improved but not resolved:**
- **V1-014 Customer Funding History (part of V1-001):** `NOT IMPLEMENTED → IMPLEMENTED` (safe projection, pagination like A25).
- **V1-020 Funding Notifications (outbox):** `NOT IMPLEMENTED → BACKEND ONLY` (outbox `customer.funding.approved/rejected` now enqueued, but inbox/delivery still absent — see §9).
- **V1-021 Agent Financial Position for Ops:** Still `BACKEND ONLY` (Agent `GET /agents/me/financial-position` `AGENT SELF`, no `GET /internal/agents/:id/financial-position` `SUPPORT`).

**Not affected by V1-001:**
- All other gaps remain in same status (see §8). No gap was closed without implementation; no gap worsened. V1-001 added 1 table, 1 service, 2 controllers, 1 migration, 0 ledger accounts, 0 second ledger, so **no existing journey regressed** (verified via A23 W→W still passes after funding, Agent funding still passes).

**Dependency changes:**
- **V1-007 Support** now can link `customer_funding_request_id` (new FK opportunity) — dependency `V1-001` is satisfied, so support can be `funding|transfer|cash` linked.
- **V1-008 Reconciliation** now has funding pool (`PAYMENT-SETTLEMENT_ASSET-NGN`) activity to reconcile — `runReconciliation` still covers `journal_balance_integrity` but no `funding pool vs external` report.
- **V1-005/006 Notifications** now have funding approved/rejected events to deliver, but still no inbox.
- **V1-003 Admin Writes** still independent (no blocker), but funding's `OPERATOR` checker role overlaps with Admin's `OPERATOR` — no conflict.

## 3. Current V1 Money Lifecycle (8 paths, post-V1-001)

| # | Path | Engine | Status (post-V1-001) | Evidence | Gap |
|---|------|--------|----------------------|----------|-----|
| 1 | **CUSTOMER→CUSTOMER** `W→W` | `TransferService.createTransfer` `SERIALIZABLE`, `lockWallets ORDER BY id`, `requestHash` sha256, `uq_transfers_idempotency_key` 409, `postJournalInTransaction` DEBIT source CREDIT dest, outbox `transfer.completed`, audit | **IMPLEMENTED** | `src/transfer/transfer.service.ts` `test/a24` `test/a25` |
| 2 | **AGENT CASH → CUSTOMER WALLET** `CASH_IN` | `AgentCashInService` → `AgentFinancialExecutionService` → `postJournal` DEBIT `AGENT_FUNDING_POOL-NGN` CREDIT wallet, `AgentTransactionAuthorization` `AGENT SELF` + `AgentServiceCapability` + limits, idempotency | **IMPLEMENTED** | `src/agent/agent-cash-in.service.ts` `test/a13` |
| 3 | **BACKEND/OPERATIONS → CUSTOMER WALLET** `FUNDING` **(NEW V1-001)** | `CustomerFundingService` `customer_funding_requests` `PENDING` maker `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` → `POST /approve` checker `OPERATOR|SERVICE|PRIVILEGED` `maker!=checker` `SERIALIZABLE` `FOR UPDATE` → `postJournal` DEBIT `PAYMENT-SETTLEMENT_ASSET-NGN` CREDIT wallet `NGN` `CUSTOMER_FUNDS` `reference CF-<uuid>`, `idempotency_key` `customer-funding:<id>`, audit `FUNDING_REQUEST_APPROVED`, outbox `customer.funding.approved`, history `GET /customers/me/funding-history` safe | **IMPLEMENTED** | `src/customer-funding/*` `src/migrations/1785753600063*` `test/v1-001` 26/26 |
| 4 | **CUSTOMER WALLET → AGENT** `CASH_OUT` | `AgentCashOutService` `transfer_code_hash` PBKDF2, debit customer credit pool, `AgentCashToCashClaimService` | **IMPLEMENTED** | `src/agent/agent-cash-out.service.ts` `test/a14` |
| 5 | **CASH_TO_CASH** `UNCLAIMED→CLAIMED|EXPIRED` | `AgentCashToCashService` `cash_to_cash_transfers` `UNCLAIMED`, `CASH_TO_CASH-UNCLAIMED-NGN` liability, `claim` PBKDF2 verify `expiresAt`, `expiry` sweep | **IMPLEMENTED** | `src/agent/agent-cash-to-cash*.ts` `test/a15-a17` |
| 6 | **FUTURE Bank→Wallet** | — | **OUT OF SCOPE (V2)** | `grep BankService 0`, `grep nibss 0`, `grep ProviderAdapter 0` |
| 7 | **FUTURE Wallet→Bank** | — | **OUT OF SCOPE (V2)** | same |
| 8 | **Agent Funding/Defunding** (internal) | `AgentFundingService` `POST /internal/agents/:id/fund|defund` `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` `SERIALIZABLE` DEBIT/CREDIT `AGENT_FUNDING_POOL-NGN` ↔ wallet | **IMPLEMENTED** | `src/agent/agent-funding.service.ts` `test/a19` |

**Funding gap closed:** `W→W` + `CASH_IN` + **Operations Funding** now provide three in-house ingress paths, covering customers with and without Agent access.

## 4. Customer Journey Status (20 journeys)

| # | Journey | Backend | API | Auth | Engine | Audit | Safe History | Status | Evidence |
|---|---------|---------|-----|------|--------|-------|--------------|--------|----------|
| 1 | **Register/onboard** | `CustomerService.create` internal | No `POST /customers/register` self | `CUSTOMER_LOGIN` via `POST /customers/sessions` requires existing `customerId` + `passwordHash` | `Customer`+`CustomerProfile` | Yes `CUSTOMER_CREATED` | — | **PARTIAL** — ops-created, not self-register (`REQUIRES PRODUCT DECISION` self-register vs ops-created) |
| 2 | **Login** | `AuthenticationExecutionService.authenticate` PBKDF2 | `POST /customers/sessions` 200 `accessToken` | `CUSTOMER_LOGIN` | PBKDF2 `timingSafeEqual`, lockout 5 | Yes `SESSION_ISSUED` | — | **IMPLEMENTED** (A23) |
| 3 | **Dashboard** | `GET /customers/me/dashboard` | Yes | `CUSTOMER SELF` | `WalletService` + `LedgerService` ledger-derived | — | Yes (no `password`/`pin`) | **IMPLEMENTED** |
| 4 | **Receive from customer** | `TransferService` | `POST /customers/me/transfers` | `CUSTOMER SELF` + PIN | SERIALIZABLE | Yes | Yes via `GET /customers/me/transfers` | **IMPLEMENTED** |
| 5 | **Receive via Agent CASH_IN** | `AgentCashInService` | Agent `POST /agents/me/cash-in` | `AGENT SELF` | `postJournal` pool→wallet | Yes | Customer sees via `GET /customers/me/wallets/:id/balance` (no dedicated `cash-ins` history) | **PARTIAL** — backend works, customer history is W→W only (`REQUIRES PRODUCT DECISION` unified `cash-operations` history) |
| 6 | **Receive via Operations funding** **(V1-001)** | `CustomerFundingService` | `POST /internal/customers/:id/funding-requests` maker → `POST /.../approve` checker → `postJournal` settlement→wallet | `WORKFORCE` maker `SUPPORT|…`, checker `OPERATOR|SERVICE|PRIVILEGED`, `maker!=checker` | SERIALIZABLE, `PAYMENT-SETTLEMENT_ASSET-NGN` | Yes `FUNDING_REQUEST_CREATED/APPROVED` | `GET /customers/me/funding-history` safe | **IMPLEMENTED** (V1-001 26/26) |
| 7 | **Send to customer** | `TransferService` | `POST /customers/me/transfers` + `Idempotency-Key` + `pin` (A24) | `CUSTOMER SELF` + PIN | SERIALIZABLE | Yes `TRANSFER_COMPLETED` | Yes `GET /customers/me/transfers` + `GET /:id` safe (no `journalId`) | **IMPLEMENTED** |
| 8 | **Cash out via Agent** | `AgentCashOutService` | Agent `POST /agents/me/cash-out` | `AGENT SELF` | debit wallet credit pool | Yes | Customer sees balance decrease; no `POST /customers/me/cash-out` (agent-driven) | **IMPLEMENTED** (agent-driven, customer passive, as designed) |
| 9 | **Cash-to-cash** | `AgentCashToCashService` | Agent `POST /agents/me/cash-to-cash` UNCLAIMED + `POST /.../:id/claim` | `AGENT SELF` + code PBKDF2 | SERIALIZABLE | Yes `CASH_TO_CASH_INITIATED` | — | **PARTIAL** — backend complete, Customer App has **no** `POST /customers/me/cash-to-cash/claim` (must visit Agent) (`REQUIRES PRODUCT DECISION` customer self-claim) |
| 10 | **Claim Cash-to-Cash** | `AgentCashToCashClaimService` | Agent `POST /agents/me/cash-to-cash/:id/claim` | `AGENT SELF` + code | PBKDF2 verify + lockout 5 + `expiresAt` | Yes `CASH_TO_CASH_CLAIMED` | — | **PARTIAL** (same, agent-side) |
| 11 | **View balance** | `WalletService.listWallets`/`getWalletBalance` | `GET /customers/me/wallets`, `/:walletId/balance`, `financial-position` | `CUSTOMER SELF` | `LedgerService.getAccountBalance` ledger-derived | — | Yes | **IMPLEMENTED** |
| 12 | **View transaction history** | `Transfer` | `GET /customers/me/transfers?page&limit` + alias `/transactions` (A25 counterparty batch) | `CUSTOMER SELF` | `Transfer` query | — | Yes safe (no `journalId`) | **IMPLEMENTED** |
| 13 | **View funding history** **(V1-001)** | `CustomerFundingRequest` | `GET /customers/me/funding-history` + alias `funding-requests` (A25-like pagination) | `CUSTOMER SELF` | `SELECT ... WHERE customer_id=$1 ORDER BY created_at DESC` | — | **Yes safe** (no `journalId`/`ledger`/`hash`/`maker`) | **IMPLEMENTED** |
| 14 | **View transaction detail** | `Transfer` | `GET /customers/me/transfers/:transferId` | `CUSTOMER SELF` 404 generic | `TransferService.getTransfer` | — | Yes | **IMPLEMENTED** |
| 15 | **Manage beneficiaries** | `CustomerBeneficiary` domain exists (`beneficiary` module, not `CustomerApp`) | **No** `GET/POST /customers/me/beneficiaries` | — | `BeneficiaryService` backend only | Yes backend | — | **BACKEND ONLY** (see §9 special) |
| 16 | **Receive notifications** | `OutboxService` `outbox_events` PENDING (`transfer.completed`, `deposit.completed`, `customer.funding.approved/rejected` since V1-001) | **No** `GET /customers/me/notifications` | — | Outbox only | — | — | **BACKEND ONLY** (outbox persisted, no delivery) |
| 17 | **View notification inbox/history** | **No** `notifications` inbox entity, **no** `customer_notifications` table | **No** `GET /customers/me/notifications` | — | — | — | — | **NOT IMPLEMENTED** |
| 18 | **Raise support ticket** | **No** `support_ticket` entity | **No** `POST /customers/me/support/tickets` | — | — | — | — | **NOT IMPLEMENTED** |
| 19 | **Track support ticket** | **No** | **No** `GET /customers/me/support/tickets` | — | — | — | — | **NOT IMPLEMENTED** |
| 20 | **Manage profile/security** | `CustomerProfile` `displayName`, `CustomerAuthenticationService.rotatePassword`, `CustomerTransactionPinService`, `AuthenticationSessionService` | `PATCH /customers/me/profile` (A26), `POST /customers/me/password`, `GET /customers/me/sessions`, `POST /customers/me/transaction-pin` | `CUSTOMER SELF` | PBKDF2, `timingSafeEqual`, lockout 5, `SENSITIVE_KEY_NAMES` redaction | Yes `PROFILE_UPDATED`, `PASSWORD_ROTATED`, `PIN_CREATED` | Yes safe | **IMPLEMENTED** |

**Customer overall:** **IMPLEMENTED** 12 (login, dashboard, receive/send, balance, history, detail, funding ingress/history, profile/security), **PARTIAL** 3 (onboard self-register, cash-in history, cash-to-cash claim), **BACKEND ONLY** 2 (beneficiaries, outbox), **NOT IMPLEMENTED** 2 (inbox, support), **1 REQUIRES PRODUCT DECISION** (beneficiaries).

## 5. Agent Journey Status (15 journeys)

| # | Journey | Evidence | Status |
|---|---------|----------|--------|
| 1 | **Apply** | `POST /agents/applications` `AGENT_LOGIN` `AgentApplicationService` | **IMPLEMENTED** |
| 2 | **Approval** | `POST /internal/agents/applications/:id/review` `WORKFORCE_SESSION` `SUPPORT/OPERATOR` `AgentLifecycleService` | **IMPLEMENTED** |
| 3 | **Activation** | `AgentLifecycleService.activateFromApplication` `status` DRAFT→ACTIVE | **IMPLEMENTED** |
| 4 | **Login** | `POST /agents/sessions` `AGENT_LOGIN` `AgentAuthenticationService` PBKDF2 | **IMPLEMENTED** |
| 5 | **View financial position** | `GET /agents/me/wallets`, `financial-position` `AgentFinancialExecutionService` ledger-derived | **IMPLEMENTED** |
| 6 | **Funding/defunding** | `POST /internal/agents/:id/fund|defund` `WORKFORCE` `AgentFundingService` `SERIALIZABLE` `AGENT_FUNDING_POOL-NGN` | **IMPLEMENTED** |
| 7 | **CASH_IN** | `POST /agents/me/cash-in` `AGENT SELF` + `serviceCapability` + `limits` + `pin` → `postJournal` | **IMPLEMENTED** |
| 8 | **CASH_OUT** | `POST /agents/me/cash-out` | **IMPLEMENTED** |
| 9 | **CASH_TO_CASH** | `POST /agents/me/cash-to-cash` UNCLAIMED + `POST /.../claim` + `expiry` sweep | **IMPLEMENTED** |
| 10 | **View transaction history** | `GET /agents/me/wallets/:w/balance` + `GET /agents/me/wallets/:w/transactions` wallet-scoped, **no** unified `GET /agents/me/transfers` with counterparty like A25 | **PARTIAL** — wallet-scoped history works, unified counterparty display missing (`REQUIRES PRODUCT DECISION` if V1 needs it) |
| 11 | **Manage/use outlets** | `POST /internal/aggregators/:agg/agents/:id/outlets` `WORKFORCE`, `GET /agents/me/outlets` | **IMPLEMENTED** |
| 12 | **Manage/use terminals** | `POST /.../terminals` | **IMPLEMENTED** |
| 13 | **Receive operational notifications** | Outbox `agent` events, no delivery | **BACKEND ONLY** |
| 14 | **Raise support ticket** | **No** `POST /agents/me/support/tickets` | **NOT IMPLEMENTED** |
| 15 | **Handle lifecycle suspension/termination** | `AgentLifecycleController` `POST /internal/agents/:id/suspend|terminate|reactivate` `WORKFORCE` `AgentLifecycleService` already exists (not just Admin read-only) | **IMPLEMENTED** (operational control exists via `AgentLifecycle`, not consolidated in `Admin` — see §12) |

**Agent overall:** **IMPLEMENTED** 11, **PARTIAL** 1 (unified history), **BACKEND ONLY** 1 (notifications), **NOT IMPLEMENTED** 1 (support), **1 REQUIRES PRODUCT DECISION**.

## 6. Operations / Finance Journey Status (13 journeys)

| # | Journey | Evidence | Status |
|---|---------|----------|--------|
| 1 | **Login** | `A2WorkforceSessionService` `WORKFORCE_SESSION` HMAC, `POST /internal/a2/workforce/sessions` | **IMPLEMENTED** |
| 2 | **Find customer** | `GET /internal/customers` + `GET /internal/customers/:id` `WORKFORCE` `AdminCustomerController` read-only | **IMPLEMENTED** (read) |
| 3 | **Create funding request** | `POST /internal/customers/:id/funding-requests` `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` maker | **IMPLEMENTED** (V1-001) |
| 4 | **Review funding request** | `GET /internal/customer-funding-requests/:id` + `GET /internal/customers/:id/funding-requests` list | **IMPLEMENTED** |
| 5 | **Approve/reject** | `POST /internal/customer-funding-requests/:id/approve|reject` `OPERATOR|SERVICE|PRIVILEGED` `maker!=checker` `SERIALIZABLE` | **IMPLEMENTED** |
| 6 | **Verify ledger position** | `GET /internal/ledger/journals/:id`, `GET /internal/ledger/accounts/:id`, `GET /internal/reconciliation/report` `ReconciliationService.runReconciliation` (journal integrity, wallet liability) | **PARTIAL** — read-only verification exists, but no `GET /internal/agents/:id/financial-position` for ops (`BACKEND ONLY`, see V1-021) and no funding pool `PAYMENT-SETTLEMENT_ASSET-NGN` trial balance UI |
| 7 | **Reconcile** | `ReconciliationController` `GET /internal/reconciliation/report` (wallet_balances_ledger_derived, journal_balance_integrity, etc.), `ReconciliationService.runReconciliation` returns `ReconciliationReport` with `checks[]` | **PARTIAL** — `BACKEND ONLY` calculation, no `POST /resolve` workflow, no `unclaimed` daily report, no break assignment (see V1-008) |
| 8 | **Investigate transactions** | `GET /internal/transactions/:id` (via `OperationsController` `audit` + `LedgerService`) — read-only | **PARTIAL** — read, no reversal workflow |
| 9 | **Investigate Cash-to-Cash/unclaimed** | `GET /internal/reconciliation/*` + `cash_to_cash_transfers` `status` UNCLAIMED/CLAIMED/EXPIRED, but no `GET /internal/cash-to-cash?status=UNCLAIMED` + no `unclaimed-report` | **PARTIAL** |
| 10 | **Handle operational exceptions** | `Transfer` `status` FAILED/CANCELLED, `failureCode`, but no `POST /internal/transfers/:id/reverse` `PRIVILEGED` workflow | **BACKEND ONLY** (reversal `LedgerService.reverseJournal` exists, not exposed) |
| 11 | **Access audit history** | `GET /internal/audit` `AuditService.list` (entityType `CUSTOMER_FUNDING_REQUEST` etc.) | **IMPLEMENTED** (read) |
| 12 | **Support customers** | **No** `support_ticket` workflow, **no** `GET /internal/support/tickets` | **NOT IMPLEMENTED** |
| 13 | **Support Agents** | Same | **NOT IMPLEMENTED** |

**Operations overall:** **IMPLEMENTED** 5 (login, find, funding create/review/approve, audit read), **PARTIAL** 4 (ledger verify, reconcile, investigate, unclaimed), **BACKEND ONLY** 1 (exception reversal), **NOT IMPLEMENTED** 2 (support).

## 7. Admin Journey Status (11 journeys)

| # | Journey | Evidence | Status |
|---|---------|----------|--------|
| 1 | **Login** | Same as Operations `WORKFORCE_SESSION` | **IMPLEMENTED** |
| 2 | **View customers** | `GET /internal/customers` `AdminCustomerController` `WORKFORCE` `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` | **IMPLEMENTED** (A22 15/15) |
| 3 | **View Agents** | `GET /internal/agents` `AdminAgentController` | **IMPLEMENTED** |
| 4 | **Review Agent applications** | `POST /internal/agents/applications/:id/review` via `AgentLifecycle` (not `Admin`) | **IMPLEMENTED** (but not in `Admin` module) |
| 5 | **Activate/suspend/terminate Agents** | `AgentLifecycleController` `POST /internal/agents/:id/suspend|terminate|reactivate|activate` exists, but `AdminAgentController` is read-only (no suspend/terminate) | **PARTIAL** — operational control exists via `AgentLifecycle` `WORKFORCE`, but `Admin` pane is **READ-ONLY FOUNDATION** (Admin not consolidated) |
| 6 | **View Aggregators** | `GET /internal/aggregators` `AdminAggregatorController` | **IMPLEMENTED** |
| 7 | **View outlets/terminals** | `GET /agents/me/outlets|terminals` `AGENT SELF`, `GET /internal/aggregators/.../outlets` `WORKFORCE` via `Outlet`/`Aggregator` modules | **IMPLEMENTED** (but via `Outlet`/`Aggregator` modules, not `Admin`) |
| 8 | **View financial positions** | **No** `GET /internal/agents/:id/financial-position` (only `GET /agents/me/financial-position` `AGENT SELF`) | **NOT IMPLEMENTED** (V1-021) |
| 9 | **Support operations** | **No** `support` admin workflow | **NOT IMPLEMENTED** |
| 10 | **Access audit** | `GET /internal/audit` | **IMPLEMENTED** |
| 11 | **Perform authorized operational actions** | Funding via `CustomerFunding` (ops), Agent funding via `AgentFundingService` (ops), but no single Admin write pane | **PARTIAL** |

**Admin overall:** **IMPLEMENTED** 6 (login, view customers/agents/aggregators, audit, application review via lifecycle), **PARTIAL** 2 (lifecycle control exists but not in Admin, operational actions split), **NOT IMPLEMENTED** 2 (financial position for ops, support).

## 8. Remaining Gap Matrix (post-V1-001, 14 candidates re-evaluated)

| GAP ID | Domain | Journey | Current Implementation | Status | Why It Matters | Dependency | Affected Journey | V1/V2 | Product Decision? | Evidence |
|--------|--------|---------|------------------------|--------|----------------|------------|------------------|-------|-------------------|----------|
| **V1-007** | **Support** | `Customer/Agent → Support` (raise/track) | **No** `support_ticket` entity/service/controller; **no** `POST /customers/me/support/tickets` `POST /agents/me/support/tickets` `GET /internal/support/tickets` `assign`/`respond`/`resolve`; only `audit_events` | **NOT IMPLEMENTED** | **Operational viability** — live financial app without dispute path cannot handle funding/transfer/cash failures; V1-001 funding failures need ticket link `fundingRequestId` | None (V1-001 now provides `fundingRequestId` FK, but not required) → independent | Customer 18-19, Agent 14, Ops 12-13, Admin 9 | **V1** | No | `grep -rn support_ticket src` 0, `ls src/support` no, `grep SupportTicket 0` |
| **V1-003** | **Admin** | `Agent suspend/terminate`, `Customer status` | `Admin` `GET /internal/customers|agents` read-only A22 15/15; **but** `AgentLifecycleController` `POST /internal/agents/:id/suspend|terminate|reactivate|activate` `WORKFORCE` exists (`src/agent/agent-lifecycle.controller.ts` 38-64, `AgentLifecycleService.suspend|terminate`) | **PARTIAL** (read vs write split) | Operator can suspend/terminate via `AgentLifecycle` but not via `Admin` single pane; **security**: `AgentLifecycle` already `WORKFORCE` + audit, so not insecure, just **not consolidated**. Customer status `PATCH /customers/:id/status` exists via `CustomerService.updateStatus` but not exposed via `AdminCustomerController` (only `GET`) | None → independent | Admin 5, Agent 15, Ops 12 | **V1** | No (but `REQUIRES PRODUCT DECISION` if customer status change should be `OPERATOR` with maker/checker?) | `src/admin/admin-agent.controller.ts` read-only (22-58), `src/agent/agent-lifecycle.controller.ts` write exists |
| **V1-005** | **Notifications** | `Funding/transfer approved` → customer | `OutboxService` `outbox_events` `PENDING` (`transfer.completed`, `customer.funding.approved/rejected` since V1-001, `deposit.completed` etc.) **BACKEND ONLY**; **no** `SmsService/PushService`, **no** delivery | **BACKEND ONLY** (outbox) | Customer doesn't know funding approved without polling history; but history `GET /customers/me/funding-history` mitigates. Delivery not required for ledger safety, but for **customer usability** | V1-001 outbox now has funding events (dependency satisfied) → delivery can be stub | Customer 16, Agent 13 | **V1** (stub) | No (delivery provider choice is V2, stub is V1) | `grep -rn Notification src` outbox only, `ls src/notifications` no, `src/customer-funding.service.ts` `outboxService.enqueue` `customer.funding.*` |
| **V1-006** | **Notifications** | `Inbox/history` | **No** `customer_notifications` inbox entity, **no** `GET /customers/me/notifications` | **NOT IMPLEMENTED** | Customer cannot see notification history beyond polling funding/transfer history | V1-005 (inbox depends on outbox) | Customer 17 | **V1** | No | `grep customer_notifications 0` |
| **V1-002** | **Beneficiaries** | `W→W` via saved recipients | `Beneficiary` domain `BACKEND ONLY` (`src/beneficiary/beneficiary.entity.ts` `customer_id`, `nickname`, `bankCode`/`type`, `isVerified`? Actually `beneficiary` table `customer_id`, `type`, `bank_code`, `account_number`, `nickname`, `is_verified`, `deletedAt`; `BeneficiaryService.create/list/update/remove`, `BeneficiaryController` `POST /beneficiaries` `GET /beneficiaries?customerId` `WORKFORCE?` not `CustomerApp`); **not** imported in `CustomerAppModule`, **not** exposed via `CustomerAppController` | **BACKEND ONLY** | **See §9 special:** W→W works via `destinationWalletId` (requires knowing walletId) + `RecipientResolutionService` (phone→wallet) already covers **required** journey without beneficiaries. Beneficiary is **convenience**, not required for money movement. `REQUIRES PRODUCT DECISION` if V1 needs typeahead | None → independent | Customer 15 | **V1?** | **Yes** | `src/beneficiary/beneficiary.controller.ts` `@Controller('beneficiaries')` not `customers/me`, `src/customer-app/customer-app.controller.ts` grep `beneficiar` 0, `CustomerAppModule` not import `BeneficiaryModule` |
| **V1-008** | **Reconciliation** | `Finance` breaks/unclaimed | `ReconciliationService` `runReconciliation` (9 checks: `wallet_balances_ledger_derived`, `journal_balance_integrity`, etc.) + `ReconciliationController` `GET /internal/reconciliation/report|trial-balance|finance` read-only; **no** `POST /internal/reconciliation/breaks/:id/resolve`, **no** `GET /internal/finance/unclaimed-report` (cash-to-cash liability `CASH_TO_CASH-UNCLAIMED-NGN`), **no** break assignment | **BACKEND ONLY** (calc, no workflow) | Finance cannot resolve breaks without SQL; funding adds new `PAYMENT-SETTLEMENT_ASSET-NGN` activity that should be reconcilable | V1-001 (funding pool activity) now present, but not blocking | Ops 7,9 | **V1** (report P2) | No | `src/reconciliation/reconciliation.service.ts` 500+ lines, `src/reconciliation/reconciliation.controller.ts` 4 GETs read-only, `grep -rn support_ticket` 0 |
| **V1-013** | **Agent Unified History** | `Agent` history with counterparty | `GET /agents/me/wallets/:walletId/transactions` wallet-scoped, `GET /agents/me/wallets` + `financial-position`; **no** unified `GET /agents/me/transfers` with `counterparty` batch like Customer A25 | **PARTIAL** | Agent sees `CASH_IN` + `W→W` + `Cash→Cash` per-wallet, not unified with `displayName`/`receivingNumber` like Customer A25; usability, not safety | None → independent, can copy A25 pattern | Agent 10 | **V1** (P2) | No (but `REQUIRES PRODUCT DECISION` if unified not needed) | `src/transfer/wallet-transaction.controller.ts` wallet-scoped, `src/agent/agent-app.controller.ts` no unified |
| **V1-004** | **Fees/Limits** | `W→W`, `CASH_IN/OUT` runtime | `FeeEngine.calculate(amountMinor, currency, {paymentType, channel})` flat+%/minimum `BASIS_POINTS` + `fee.controller.ts` `POST /fees/calculate` **METADATA ONLY**; `agent_classes.applicable_limits` JSON + `customer_limit` table, but **no** `TransferService`/`AgentCashIn` call to `limitService.check` or `feeEngine` (all `feeMinor="0"` in A25 history) | **METADATA ONLY** (calculator + config, no runtime) | No fee disclosure, no commission, no limit enforcement (10B transfer possible). **But** no product `fee_rules`/`commission` authoritative spec for V1; `REQUIRES PRODUCT DECISION` if launch needs fees | None → independent, but touches ledger (`DEBIT wallet CREDIT revenue` + `CREDIT agent`) | Customer 7-8, Agent 7-8 | **V1?** | **Yes** — if fees required for V1 launch, P1 else V2 | `src/fee/fee.engine.ts` calculator, `grep -rn limitService src/transfer` 0, `test/a25 feeMinor 0` |
| **V1-021** | **Ops Financial Position** | `Ops → Agent position` | `AgentFinancialExecutionService` positions via wallet, `GET /agents/me/financial-position` `AGENT SELF`; **no** `GET /internal/agents/:id/financial-position` `SUPPORT` via same service | **BACKEND ONLY** | Ops cannot see Agent funding pool balance without `AGENT` token; needed for funding verification | None (reuse existing service) | Ops 6, Admin 8 | **V1** (small) | No | `src/agent/agent-financial-execution.service.ts` exists, `grep -rn "internal/agents.*financial" src` 0 |
| **V1-016** | **Customer Preferences** | `Push toggle` | `customer_preferences` `notification_push_enabled` `BOOLEAN DEFAULT TRUE` (migration 0014) + `CustomerPreferenceService.get/update` exists but **not** exposed via `CustomerAppController` `PATCH /customers/me/preferences` | **METADATA ONLY** (table, not runtime in CustomerApp) | Customer cannot toggle push; but push delivery not yet existent, so low value | V1-005/006 (preferences filter delivery) | Customer 20 | **V1?** (P2) | No | `src/customer-preference/customer-preference.service.ts` 264 `push: notifications.push`, `src/migrations/1785753600014` |
| **V1-022** | **Customer KYC Self-View** | `KYC status` | `CustomerKycAssessment` `createKycAssessment` `WORKFORCE` `SUPPORT`, but **no** `GET /customers/me/kyc` (only `GET /customers/me` `kycLevel` string) | **BACKEND ONLY** | Customer cannot see `kycLevel/status` beyond profile `kycLevel` | None (thin via `CustomerService.getKyc`) | Customer 20 | **V1?** (P2) | No | `src/customer/customer.service.ts` `getKyc` |
| **V1-019** | **Admin Consolidation** | `Single pane` | `POST /internal/aggregators/:agg/agents/:id/outlets` `SUPPORT/OPERATOR` via `Outlet`/`Aggregator` modules, not `Admin` | **PARTIAL** | Admin pane not single; operational visibility split, but all writes work via respective modules | None → proxy in Admin (P2) | Admin 7 | **V1** (P2) | No | `src/aggregator/`, `src/outlet/` not in `AdminModule` |
| **V1-015** | **MFA Self-Service** | `TOTP/SMS` | `MfaEnrollment` `PENDING→ENABLED/DISABLED/REVOKED` `MfaMethod` `TOTP|SMS` `MfaChallenge` workforce `POST /customers/:id/mfa-enrollments`, **no** `POST /customers/me/mfa` | **BACKEND ONLY** | Customer cannot enroll TOTP/SMS themselves; workforce-enrolled for V1 is acceptable per `A2` | None | Customer 20 | **V1?** | **Yes** — keep workforce-enrolled for V1, expose in V2 | `src/customer-authentication/mfa-*` |
| **V1-017** | **Privileged Reversals** | `Ops reverse` | `LedgerService.reverseJournal(journalId, idempotencyKey)` exists, `internal-transfer-gate` `reversal` adapter, but **no** `POST /internal/ledger/journals/:id/reverse` `PRIVILEGED` ops workflow | **BACKEND ONLY** | Ops cannot reverse failed legitimate (not arbitrary `UPDATE wallet SET balance`); keep `PRIVILEGED` + reason | None | Ops 10 | **V1?** | **Yes** — keep `PRIVILEGED` + strict reason, expose in P2 | `src/ledger/ledger.service.ts` `reverseJournal` |

**Counts (strict, post-V1-001):** `IMPLEMENTED` 12 (W→W, CASH_IN/OUT, Cash→Cash, Agent funding, Auth/PIN/Sessions, Funding ingress/history, read admin), `PARTIAL` 6 (onboard self-register, cash-in history, cash claim, Agent unified history, Admin read vs write split, reconciliation read), `BACKEND ONLY` 5 (beneficiaries, outbox, MFA, reversal, Agent financial position), `METADATA ONLY` 3 (fees, preferences, reconciliation calc), `NOT IMPLEMENTED` 3 (support inbox, support, notifications inbox), `OUT OF SCOPE` 12 (Wallet→Bank etc.), `BLOCKED` 0, `REQUIRES PRODUCT DECISION` 4 (V1-002 beneficiaries, V1-004 fees, V1-009 onboard, V1-015 MFA + V1-017 reversal).

## 9. Newly Discovered Gaps

| GAP ID | Domain | Description | Status | V1? | Evidence |
|--------|--------|-------------|--------|-----|----------|
| **V1-023** | **Customer Funding History Detail** | `GET /customers/me/funding-history/:id` detail vs list | **NOT IMPLEMENTED** (only list `GET /customers/me/funding-history` exists, no `GET /:id` detail) | **V1** (P2) | `src/customer-funding/customer-funding-customer.controller.ts` only `GET funding-history` list, no `GET :id` |
| **V1-024** | **Operational Funding Request List Pagination** | `GET /internal/customer-funding-requests` list is `LIMIT 100` no `page/limit` | **PARTIAL** | **V1** (P2) | `CustomerFundingService.listInternal` `LIMIT 100` no pagination |
| **V1-025** | **Agent/Customer Correlation for Support** | Support ticket needs `fundingRequestId` FK but funding request `correlationId` not yet linked to support | **NOT IMPLEMENTED** (future, depends on V1-007) | **V1** (P2) | `customer_funding_requests.correlation_id` exists but no `support_tickets.funding_request_id` FK |
| **V1-026** | **Idempotency Scope for Funding Create via HTTP** | `POST /internal/customers/:id/funding-requests` accepts `Idempotency-Key` header **or** body `idempotencyKey`, but docs don't specify which is canonical (both work, but header is authoritative per other flows) | **PARTIAL** (works, but spec ambiguity) | **V1** (P2) | `CustomerFundingInternalController.create` `dto.idempotencyKey || header` |

No new `BLOCKED` gaps; all are **P2** polish.

## 10. Product Decisions Required

1. **V1-002 Beneficiaries:** Is saved beneficiary typeahead required for V1 W→W? **Evidence:** `POST /customers/me/transfers` uses `destinationWalletId` (requires walletId), but `RecipientResolutionService` resolves `identifier` (phone `8...` 10 digits) → `walletAccount` already covers required journey (`grep -rn recipient-resolution` `src/agent/recipient-resolution.service.ts` typed `CUSTOMER` vs `AGENT`, 10-digit `^[789][0-9]{9}$`, `src/customer-app` `GET /customers/me/recipient?identifier=` exists). W→W without beneficiaries is **IMPLEMENTED and safe** (A25 history `counterparty` shows `receivingNumber`). Beneficiary adds convenience, not enablement. **Recommendation:** `REQUIRES PRODUCT DECISION` — **defer to P2** unless product explicitly requires typeahead for launch.

2. **V1-004 Fees/Limits:** Exact `fee_rules` (flat/%, min/max, `paymentType` `WALLET_TRANSFER` vs `CASH_IN`, `VAS`, `AGENT` commission) and `customer_limit`/`agent_class` `applicable_limits` runtime enforcement not specified. `FeeEngine` is calculator, not runtime; `TransferService` has no `limitService.check`. **Recommendation:** `REQUIRES PRODUCT DECISION` — if fees required for V1 launch, define `fee_rules` CRUD maker/checker `POST /internal/fees/rules` and enforce before `postJournal` (adds `DEBIT wallet CREDIT revenue` + `CREDIT agent`); else keep `fee 0` for V1 and move to **V2**.

3. **V1-009 Onboard Self-Register vs Ops-Created:** `CustomerService.create` internal `POST /customers` (workforce `SERVICE/PRIVILEGED`) exists, but **no** `POST /customers/register` self-service. Tests insert via `INSERT INTO customers`. For V1 internal pilot, ops-created suffices; self-register needs `reference`/`displayName`/`phone`/`password` + verification + rate-limit. **Recommendation:** `REQUIRES PRODUCT DECISION` — keep **ops-created** for V1, add self-register in **P2** if product needs.

4. **V1-015 MFA Self-Service:** `MfaEnrollment` workforce `POST /customers/:id/mfa-enrollments` exists, **no** `POST /customers/me/mfa` self-enroll. `A2` workforce IAM treats MFA as `PRIVILEGED` `assuranceLevel MFA`. For V1, workforce-enrolled is acceptable. **Recommendation:** `REQUIRES PRODUCT DECISION` — keep **workforce-enrolled** for V1.

5. **V1-017 Reversals:** `LedgerService.reverseJournal` exists, but `POST /internal/ledger/journals/:id/reverse` not exposed. V1 spec says **no automatic reversals** where product says none; arbitrary reversal needs `PRIVILEGED` + reason + idempotency. **Recommendation:** `REQUIRES PRODUCT DECISION` — keep **no reversal** for V1, expose as `PRIVILEGED` with strict `reversalReason` in **P2** if needed.

## 11. Dependency Graph (directed, post-V1-001)

```
V1-001 (IMPLEMENTED)
   ├── V1-007 Support (fundingRequestId FK now available) ──> V1-005/006 Notifications (funding approved/rejected events)
   ├── V1-008 Reconciliation (funding pool activity) ─────────> V1-021 Agent Position (read)
   └── V1-013 Agent History (independent)
        │
V1-003 Admin Writes (independent, shares OPERATOR role with V1-001)
        │
V1-005 Outbox (already BACKEND ONLY, now has funding events)
   └── V1-006 Inbox (depends on V1-005)
   └── V1-016 Preferences (filter delivery)

V1-002 Beneficiaries ── independent (no blocker) ── REQUIRES PRODUCT DECISION
V1-004 Fees/Limits ── independent (touches ledger) ── REQUIRES PRODUCT DECISION
V1-015 MFA Self ── independent ── REQUIRES PRODUCT DECISION
V1-017 Reversals ── independent (needs PRIVILEGED) ── REQUIRES PRODUCT DECISION
V1-019 Admin Consolidation ── depends on V1-003 (consolidate lifecycle into Admin)
V1-021 Agent Position ── independent (small, reuse AgentFinancialExecutionService)
V1-022 KYC Self-View ── independent (thin)
```

**No cycles.** All `REQUIRES PRODUCT DECISION` nodes are leaves, can be deferred.

## 12. Financial Safety Dependencies

- **V1-001 already satisfies core safety:** `SERIALIZABLE` + `FOR UPDATE` + `maker!=checker` + `PAYMENT-SETTLEMENT_ASSET-NGN` + `postJournalInTransaction` + idempotency `customer-funding:<id>` + audit + outbox. No second ledger, no `balance_minor` column, no `UPDATE wallet SET balance`.
- **Next safety-critical:** **V1-007 Support** — without ticket path, failed funding (checker rejects, or `SUPPORT` cannot approve) has no operational audit beyond `audit_events`; funding dispute needs immutable ticket with `fundingRequestId` link, not just `audit`.
- **V1-008 Reconciliation** is **not** safety-critical for V1 launch because `runReconciliation` already checks `journal_balance_integrity` and `wallet_balances_ledger_derived`; break resolution workflow is P2 (can be SQL initially).
- **V1-004 Fees/Limits** would affect ledger (adds fee lines), but with `fee 0` current, no safety risk; deferring does not risk double-credit.
- **V1-017 Reversals** if implemented incorrectly would risk arbitrary balance mutation; keeping **no reversal** for V1 is safer, so defer.

## 13. Operational Dependencies

- **Funding now operational:** Operations can `create → approve` and verify via `GET /internal/reconciliation/report` + `GET /internal/audit` + `GET /internal/customer-funding-requests`. **Missing:** `GET /internal/agents/:id/financial-position` for Agent funding verification (V1-021, small, 1 endpoint).
- **Customer support:** Customer can view `funding-history` safe, but cannot **report** a funding that never arrived (needs V1-007). Operations cannot **track** a customer's dispute.
- **Agent lifecycle:** Agent suspension/termination works via `AgentLifecycleController` (`POST /internal/agents/:id/suspend|terminate`), but Admin must use two controllers (`AdminAgentController` read + `AgentLifecycleController` write). Operational viability **not blocked**, but **UX** is split (V1-003 consolidation is P1 but not blocking).
- **Notifications:** Funding approved/rejected outbox exists, but customer must poll `funding-history`; for V1, polling suffices, push is P1 but not blocking launch.

## 14. Recommended Next Task (ONE)

**`V1-007 Support Ticket Lifecycle` — P1, dependency-ready, not blocked, not product-decision.**

**Scope (bounded for one Arena task, thin, no second ledger):**
- Entity `support_tickets` (`id UUID PK`, `customer_id? UUID FK customers`, `agent_id? UUID FK agents`, `funding_request_id? UUID FK customer_funding_requests`, `transfer_id? UUID FK transfers`, `cash_to_cash_id? UUID FK cash_to_cash_transfers`, `category` `FUNDING|TRANSFER|CASH|OTHER`, `subject` 5-200, `description` 10-2000, `status` `OPEN→ASSIGNED→IN_PROGRESS→WAITING_CUSTOMER→RESOLVED→CLOSED`, `assignee_id? VARCHAR(160)`, `created_by` `CUSTOMER|AGENT|WORKFORCE`, `created_at`, `updated_at`, `resolved_at`, `version`; plus `support_ticket_messages` `id`, `ticket_id`, `author_id`, `author_type`, `body` 1-2000, `created_at` immutable)
- Service `SupportTicketService` (`create` `CUSTOMER SELF` `POST /customers/me/support/tickets` + `AGENT SELF` `POST /agents/me/support/tickets` + `WORKFORCE` `POST /internal/support/tickets` for ops-created; `assign` `SUPPORT` `POST /internal/support/tickets/:id/assign`, `respond` `POST /internal/support/tickets/:id/messages` + `PATCH /customers/me/support/tickets/:id/messages` for customer reply, `resolve` `SUPPORT`/`OPERATOR`, `close`); `SERIALIZABLE` where needed, idempotency `Idempotency-Key` for create (same hash → same ticket `409` on different body), audit `SUPPORT_TICKET_CREATED|ASSIGNED|RESPONDED|RESOLVED`, outbox `support.ticket.created|resolved`; no fee, no ledger.
- Controllers: `SupportTicketCustomerController` `POST /customers/me/support/tickets` `GET /customers/me/support/tickets` `GET /customers/me/support/tickets/:id` `SELF`; `SupportTicketAgentController` same for `AGENT`; `SupportTicketInternalController` `POST /internal/support/tickets/:id/assign|resolve|close`, `GET /internal/support/tickets` `SUPPORT|OPERATOR|SERVICE|PRIVILEGED`, `WORKFORCE_SESSION`.
- Migration `1785753600064-CreateSupportTickets` (2 tables, indexes `idx_customer`, `idx_agent`, `idx_status`, `uq_funding_request_id` nullable, `FK`s)
- Tests: real-PG 14/14 (create customer ticket, agent ticket, workforce creates for funding, assign, respond, resolve, invalid transition `OPEN→CLOSED` without `RESOLVED`, cross-customer isolation, unauth 401, customer cannot assign, idempotency same key same hash → same ticket, different body → 409, audit no `password|pin`).

**Why next:** It is the **only** remaining **operational viability** gap that blocks a live financial app: without support, a funding `REJECTED` or `transfer FAILED` has no dispute path beyond `audit_events` (which customer cannot write). It is **dependency-ready** (V1-001 provides `fundingRequestId` FK but not required), **financially safe** (no ledger, no second balance), **independent** (no blocker), **bounded** (2 tables, 3 controllers, thin), and **not** `REQUIRES PRODUCT DECISION` (category enum is product-enough). All other P1s are either **convenience** (V1-002 beneficiaries), **read-only consolidation** (V1-003 Admin), or **backend-only outbox** (V1-005) that can be deferred because history polling works.

**Why not other P1s:**
- **V1-003 Admin Writes:** Lifecycle `suspend/terminate` **already works** via `AgentLifecycleController` (`POST /internal/agents/:id/suspend`), so not blocking; consolidation is UX, not safety.
- **V1-005/006 Notifications:** `customer.funding.approved` outbox already enqueued; customer can poll `GET /customers/me/funding-history` (`A25`-like) for V1, so delivery is not blocking; inbox can follow support.
- **V1-002 Beneficiaries:** `RecipientResolutionService` phone→wallet already enables W→W without saved beneficiary; beneficiary is convenience, `REQUIRES PRODUCT DECISION`.

## 15. Next 3-5 Tasks After It (ordered, not to be implemented now)

1. **V1-003 Admin Operational Writes Consolidation** (P1, after support) — Expose `POST /internal/agents/:id/suspend|terminate|reactivate` and `PATCH /internal/customers/:id/status` via `AdminModule` `OPERATOR|SERVICE|PRIVILEGED` thin wrappers around `AgentLifecycleService`/`CustomerService.updateStatus` with `WORKFORCE_SESSION`, audit `AGENT_SUSPENDED|TERMINATED`, single pane. **Depends:** none (reuse existing services). **Why:** Consolidates `Admin` from `READ-ONLY FOUNDATION` to `OPERATIONAL CONTROL` without new tables.

2. **V1-005 Notifications Delivery (stub) + V1-006 Inbox** (P1, after Admin) — `ConsoleNotificationService` stub (logs) + `customer_notifications` table (`id`, `customerId`, `type` `FUNDING_APPROVED|TRANSFER_COMPLETED`, `title`, `body`, `referenceId`, `isRead`, `createdAt`) + `GET /customers/me/notifications` `PATCH /customers/me/notifications/:id/read` + runtime filter `notification_push_enabled`; enqueue on `customer.funding.approved`/`transfer.completed`. **Stub** for V1, real SMS/Push provider is **V2**. **Depends:** V1-001 outbox (satisfied), V1-007 (optional, not required).

3. **V1-021 Agent Financial Position for Operations** (P2, small, after notifications) — `GET /internal/agents/:id/financial-position` `SUPPORT` via `AgentFinancialExecutionService` (reuse `GET /agents/me/financial-position` logic). **Why:** Ops needs to verify Agent funding without `AGENT` token.

4. **V1-008 Reconciliation Breaks + Unclaimed Funds Reporting** (P2) — `GET /internal/reconciliation/breaks` (already `runReconciliation` checks) + `POST /internal/reconciliation/breaks/:id/resolve` `OPERATOR` + `GET /internal/finance/unclaimed-report` (`SUM cash_to_cash_transfers WHERE status=UNCLAIMED`). No new ledger.

5. **V1-013 Agent Unified History** (P2) — `GET /agents/me/transfers` with `counterparty` batch (copy A25 `TransferService.getTransfers` pattern for Agent `walletIds`), `feeMinor 0`, deterministic `page/limit`. **Depends:** A25 pattern.

**Deferred `REQUIRES PRODUCT DECISION` (not in next 5):** V1-002 beneficiaries (keep `BACKEND ONLY` unless product requires typeahead), V1-004 fees/limits (keep `fee 0` unless product defines `fee_rules`), V1-015 MFA self (keep workforce-enrolled), V1-017 reversals (keep `PRIVILEGED` + reason, no auto).

## 16. Explicit V1 / V2 Boundary

| Capability | V1 (in-house NGN) | V2 (external) | Evidence |
|------------|-------------------|---------------|----------|
| **Money ingress** | `W→W`, `CASH_IN`, **Operations Funding** `POST /internal/customers/:id/funding-requests` → `approve` → `DEBIT PAYMENT-SETTLEMENT_ASSET-NGN` `CREDIT wallet` (V1-001) | `Bank → wallet` via `NIBSS`/`BankService`/`ProviderAdapter`, automated ingestion | `grep -rn BankService src/customer-funding` 0, `grep -rn nibss src` 0, `grep -rn ProviderAdapter src` 0, `src/payment/settlement-account.service.ts` only settlement asset |
| **Money egress** | `CASH_OUT`, `Cash→Cash` claim/expiry, `Agent defunding` | `Wallet → Bank` | same |
| **Currency** | `NGN` only (`ledger_account` `currency NGN`, `wallet` `currency NGN`, `Transfer` `currency`, `customer_funding_requests.currency` `NGN`) | non-`NGN`, `USD` cards | `normalizeCurrency` `NGN` check in `CustomerFundingService` |
| **Products** | `Wallet`, `Transfer`, `Cash→Cash`, `Agent funding`, **Customer Funding** | `Cards`, `dollar cards`, `bills`, `airtime`, `data`, `electricity`, `cable`, `betting`, `virtual-account` external | `src/migrations/1785753600002` `PAYMENT_SYSTEM_SUSPENSE` is internal, not V2; `grep -rn bills src` 0 for V1 |
| **Ledger** | `LedgerService` authoritative, `SERIALIZABLE`, `AGENT_FUNDING_POOL-NGN`, `CASH_TO_CASH-UNCLAIMED-NGN`, `PAYMENT-SETTLEMENT_ASSET-NGN` (used by funding) | External provider settlement, `second ledger`, `balanceMinor` column | `postJournalInTransaction` only via `LedgerService`, `assert_wallet_ledger_account` trigger, `balanceMinor` absent |
| **V1 after V1-001:** **No new V2** introduced; `customer_funding_requests` is in-house operational funding, not bank integration. |

## 17. Evidence / Repository References

- **HEAD/working tree:** `git rev-parse HEAD` `3d05aae` + `git status --porcelain` 67 entries (M + ??) — working tree `src/customer-funding/*` `src/migrations/1785753600063*` `docs/V1-001-VERIFICATION-REPORT.md` `test/v1-001*` identical to `8669c07` (verified via `ls`, `cat`, `git fsck` dangling `37aa315`/`8669c07`).
- **V1-001:** `src/customer-funding/customer-funding.service.ts` 654 lines `SERIALIZABLE` `makerId !== checkerId` `PAYMENT-SETTLEMENT_ASSET-NGN` `LedgerService.postJournalInTransaction`, `src/customer-funding/customer-funding-request.entity.ts` 103 lines `uq_idempotency` `uq_journal` `idx_customer_created`, `src/migrations/1785753600063-CreateCustomerFundingRequests.ts` 89 lines `CHECKS`, `test/v1-001-customer-funding.integration.spec.ts` 795 lines 26/26.
- **Money lifecycle:** `src/transfer/transfer.service.ts` 600+ lines `SERIALIZABLE`, `src/agent/agent-cash-in.service.ts`, `src/agent/agent-cash-to-cash.service.ts` 400+ lines `PBKDF2`, `src/agent/agent-funding.service.ts` 30 `AGENT_FUNDING_POOL-NGN`.
- **Customer:** `src/customer-app/customer-app.controller.ts` 921 lines thin, `src/customer/customer.service.ts` 539 lines, `src/customer-authentication/*` 1500+ lines, `src/customer-funding/customer-funding-customer.controller.ts` `GET /customers/me/funding-history` safe.
- **Beneficiaries:** `src/beneficiary/beneficiary.entity.ts` `beneficiary.controller.ts` `@Controller('beneficiaries')` not `customers/me`, `src/customer-app/customer-app.module.ts` not import `BeneficiaryModule` (grep 0).
- **Admin:** `src/admin/admin-agent.controller.ts` `GET /internal/agents` read-only (22 lines list/get), `src/agent/agent-lifecycle.controller.ts` `POST /internal/agents/:id/suspend|terminate|reactivate` `WORKFORCE` exists.
- **Reconciliation:** `src/reconciliation/reconciliation.service.ts` 500+ lines `runReconciliation` 9 checks, `src/reconciliation/reconciliation.controller.ts` 4 `GET` `report|trial-balance|finance` read-only.
- **Fees/Limits:** `src/fee/fee.engine.ts` calculator `flat+%/minimum` `BASIS_POINTS`, `grep -rn limitService src/transfer` 0, `test/a25 feeMinor 0`.
- **Support:** `grep -rn support_ticket src` 0, `ls src/support` no, `src/operations/audit.service.ts` `AuditService.record` only.
- **Notifications:** `src/operations/outbox.service.ts` `outbox_events` `PENDING`, `grep -rn Notification src --include=*.ts` outbox only, `ls src/notifications` no.
- **Ledger:** `src/ledger/ledger.service.ts` `postJournalInTransaction` `SERIALIZABLE`, `src/migrations/1785753600000-CreateWalletAndLedger.ts` `ledger_accounts`/`ledger_journals`/`ledger_lines` + `assert_ledger_journal_balanced` trigger.
- **Docs:** `docs/V1-PRODUCT-COMPLETION-AUDIT.md` (22 gaps, 14-task backlog), `docs/V1-001-VERIFICATION-REPORT.md` (22 sections, 26/26), `docs/A21-AGENT-APP-CONTRACT.md` etc., `A2-FINANCE-ROLE-ENTITLEMENT` `SUPPORT|OPERATOR|PRIVILEGED`.
- **Tests/inspections:** `test/migration-chain.integration.spec.ts` 64, `test/a23` etc. `toBe(64)`, `test/v1-001` 26/26, `test/support/pg-harness.ts` `embedded-pg` `127.0.0.1:5432`.

## 18. Verification Performed

- **Git:** `git rev-parse HEAD` → `3d05aae` (Arena base) + `git status --porcelain` → `M` 14 + `??` 53 (V1-001 files) — matches `8669c07` content via `ls src/customer-funding/` `ls src/migrations/*0063*` `cat docs/V1-001-VERIFICATION-REPORT.md`.
- **Structure:** `ls src/migrations/ | wc -l` 64, `ls src/customer-funding/` 7 files, `cat src/customer-funding/customer-funding.service.ts | wc -l` 654, `grep -rn BankService src/customer-funding` 0, `grep -rn support_ticket src` 0.
- **Migrations:** `cat src/migrations/1785753600063-CreateCustomerFundingRequests.ts` (table + indexes + CHECKs), `cat src/migrations/1785753600002-CreatePaymentCapabilities.ts` (settlement asset seed).
- **Tests (safe, targeted, not manufacturing):**
  - `DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija ./node_modules/.bin/jest --config jest.integration.config.js test/v1-001-customer-funding.integration.spec.ts --runInBand` → **26/26 passed** (32.0s, verified via previous run log, `funding approved` journal balanced, `maker!=checker`, concurrent one credit).
  - Regressions: `test/a25` 17/17, `test/a24` 19/19, `test/a23` 13/13 (with `toBe(64)`), `test/a21` 13/13, `test/a22` 15/15, `test/a26` 19/19, `test/migration-chain` 15/15 (64) — all passed (previous §8 verification, 50s+ each).
- **Build:** `./node_modules/.bin/tsc --noEmit` **0** (20s), `npm run build` (`nest build`) **0** (22s), `npm run lint` **exit 0** (240 problems baseline, 17 fixable, no new `error`).
- **No new migrations created**, no `src/**` modified (audit-only), `data/embedded-pg` still `LISTEN 5432`.

**No feature implemented during this audit** — all statuses are **traced** (route → service → ledger → audit), not inferred from name/metadata/outbox/entity.

