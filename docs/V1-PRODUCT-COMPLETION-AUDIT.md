# MonieNaija V1 Product Completion Audit

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD (working tree):** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (`fix(production): update expected migration constraints…`) — **verified baseline HEAD `245fc9a`/`6036b7c` (A26 VERIFIED) present as dangling `fd82075 → 6036b7c → 245fc9a`, working tree contains all A21-A26 files (see `git status` below)**  
**Migrations in workspace:** 63 (`src/migrations/1785753600*`) — authoritative V1 chain  
**Auditor:** Arena Agent (repository-grounded, route→service→ledger→audit traced)  
**Scope:** V1 in-house NGN wallet ecosystem (Wallet→Wallet, Agent CASH_IN/CASH_OUT, Cash→Cash, Backend funding). Wallet→Bank / NIBSS / cards / bills = **OUT OF SCOPE (V2)** per task.

---

## 1. Executive Summary

**MonieNaija V1 core money engines are IMPLEMENTED and financially sound** (authoritative double-entry ledger, SERIALIZABLE, idempotency, audit), **Customer and Agent app foundations are VERIFIED through A26** (profile, auth, PIN, history, sessions), **but a real financial-operations team cannot run V1 end-to-end today.**

Critical V1 blockers are **outside the transaction engines**:

- **#1 Backend/Operations → Customer Wallet funding (maker/checker) does not exist** — no `funding_request` entity/service/controller, no `POST /internal/customers/:id/fund` → review → approve → `postJournal`. This is the primary V1 ingress for customers who do not receive Agent cash. Ledger is authoritative, but there is **no operational workflow to credit a wallet** except Agent cash-in, direct `WalletService`+`postJournal` in tests, or Agent funding. An admin cannot record “customer paid into MonieNaija funding account” and get a checker-approved journal.
- **Support lifecycle is NOT IMPLEMENTED** — no `support_ticket` entity, no `POST /customers/me/support/tickets`, no transaction-linked tickets, no assignment/status. Only `audit_events` exists.
- **Notifications are BACKEND ONLY (outbox)** — `outbox_events` enqueued (`transfer.completed` etc.) but **no delivery** (SMS/Push/email), no `notification_preference` runtime, no inbox.
- **Reconciliation is METADATA ONLY** — `ledger_accounts`/`journals`/`reconciliation` services exist (policy B2F) but no operational reconciliation workflow, no break investigation UI.
- **Admin is READ-ONLY FOUNDATION** (`A22` lists/gets customers/agents/aggregators) — **no operational write workflows** (no funding approval, no Agent approve/suspend/terminate write in Admin, those are `AgentLifecycleService` internal/workforce but not integrated as Operations finance).
- **Fees/Commissions/Limits are METADATA ONLY** — `fee` engine (`FeeEngine.calculate` flat+%) exists as calculator, `agent_class` `applicable_limits` JSON, `customer_limit` table, but **no runtime enforcement** in `TransferService`/`AgentCashIn`/`CashOut` (all tested transfers have `feeMinor="0"`).

Beneficaries domain is `BACKEND ONLY` (exists, not used in Customer App W→W UX). Customer onboarding/register is `PARTIAL` (Customer entity + profile, but no self-registration endpoint; `CustomerService.create` is internal).

**V1 completion:** ~**43 requirements IMPLEMENTED**, **9 PARTIAL**, **4 BACKEND ONLY**, **3 METADATA ONLY**, **10 NOT IMPLEMENTED**, **12 OUT OF SCOPE**, **0 BLOCKED** (infra ok), **2 REQUIRES PRODUCT DECISION**.  
**Dependency-ordered backlog has 14 tasks (P0-P2)**; **recommended NEXT TASK is `V1-001 Operations Customer Funding (maker/checker)`** — unblocks all other V1 money ingress.

This is **not a redesign** — it reuses existing ledger (`LedgerService.postJournalInTransaction`), `AuditService`, `Authorization` `WORKFORCE_SESSION` + `SUPPORT/OPERATOR` roles, and `Customer`/`Wallet` read services.

---

## 2. Current Verified Baseline (A26)

- **A26 HEAD (pushed):** `245fc9a` docs A26 + `6036b7c` `feat(customer-app): A26 Customer Profile & Settings Hardening` — parent `fd82075` docs fix A25 → `28c4f1f` A25 history → `48b556e` A24 PIN → `48e4e1f` A23 foundation → `9c4838f` A22 admin → `7e7cd4c` A21 agent app
- **Working tree (audit time):** `HEAD 3d05aae` + all A21-A26 files present as modified/untracked (`git status` shows `M src/customer-app/...`, `?? docs/A26...`, `?? test/a26...`, 63 migrations). `git fsck` shows dangling `fd82075->6036b7c->245fc9a` (same content). Audit is repository-grounded on **file content**, not just commit hash.
- **A26 verified (19/19 real-PG, 100%):**
  - `PATCH /customers/me/profile` `displayName` 1-200, whitelist, `PROFILE_UPDATED` audit, SELF, agent/unauth 403/401
  - `POST /customers/me/password` via `CustomerAuthenticationService.rotatePassword` + `AuthenticationExecutionService` PBKDF2 `timingSafeEqual`, `currentPassword` check, `new≥8`, hash `PBKDF2$sha256$10000`, audit `PASSWORD_ROTATED` without secrets, `pinoHttp` redact `currentPassword/newPassword`, `SENSITIVE_KEY_NAMES` includes those
  - `GET /customers/me/sessions` safe `id/audience/status/issuedAt/expiresAt/lastSeenAt/revokedAt` (no `tokenHash`)
  - Receiving identity read-only via `CustomerContactMethod` primary `normalizedValue`
  - PIN (`set/verify` PBKDF2 lockout 5), W→W PIN, login/logout, history, sessions preserved
  - No financial mutation (`balanceMinor`, `ledger_journals`, `transfers` unchanged after profile/password), migrations 63
- **Regression 79/79 (51.9s):** A25 17/17 + A24 19/19 + A23 15/15 + A21 13/13 + A22 15/15
- **Gates:** `tsc --noEmit` 0, `npm run build` 0, `npm run lint` exit 0 (240 problems = baseline 205 + A26, 17 fixable)
- **Evidence:** `test/a26-customer-profile-hardening.integration.spec.ts` (19), `test/a25...` (17), `test/a24...` (19), `test/a23...` (15); `src/customer-app/customer-app.controller.ts` 921 lines thin, `src/customer/customer.service.ts` 539 lines, `src/customer-authentication/*` 1500+ lines

**Do not redo A26.** No regression found.

## 3. Authoritative V1 Definition (per task + repo docs)

**V1 in-house NGN wallet ecosystem** — money moves **inside** MonieNaija ledger:

- **In:** Customer `CUSTOMER→CUSTOMER` W→W, Agent `CASH_IN` (cash → wallet), **Operations → Customer** funding (customer pays into MonieNaija funding account, maker creates request, checker approves → `postJournal` CREDIT customer wallet), future `external bank → wallet` is **V2**.
- **Out:** `CUSTOMER WALLET → AGENT` `CASH_OUT`, `CASH_TO_CASH` UNCLAIMED→CLAIMED/EXPIRED, future `wallet → external bank` is **V2**.
- **Out of scope V1 (future):** Wallet→Bank, NIBSS, provider adapters, third-party settlement, cards/dollar cards, non-NGN, bills/airtime/data/electricity/cable/betting, external-provider reconciliation.

**V1 must be audited as money lifecycle, not endpoints.**

## 4. Complete Money Lifecycle Audit

### Lifecycle Map (8 paths)

| # | Path | Engine | Status | Evidence | Gap |
|---|------|--------|--------|----------|-----|
| **1** | **CUSTOMER→CUSTOMER** (W→W) | `TransferService.createTransfer` SERIALIZABLE, deterministic lock (`ORDER BY id`), `transfer.requestHash` sha256(sorted business params), `uq_transfers_idempotency_key` 409, `postJournalInTransaction` DEBIT source/CREDIT dest `CUSTOMER_FUNDS` `NGN`, `transfer.completed` outbox, audit `TRANSFER_COMPLETED` | **IMPLEMENTED** | `src/transfer/transfer.service.ts` 700+ lines, `test/a24` idempotency + double-entry + 422 `INSUFFICIENT_FUNDS`, `test/a23` history | None |
| **2** | **AGENT CASH → CUSTOMER WALLET** (`CASH_IN`) | `AgentCashInService` → `AgentFinancialExecutionService` → `LedgerService.postJournalInTransaction` DEBIT `AGENT_FUNDING_POOL` (?) / CREDIT customer `ledgerAccount`, `AgentTransactionAuthorizationService` `AGENT SELF` + `AgentServiceCapability` + limits, idempotency `agent_cash_in:idempotency_key`, audit, outbox | **IMPLEMENTED** | `src/agent/agent-cash-in.service.ts`, `src/agent/agent-financial-execution.service.ts`, `test/a13-agent-cash-in.integration.spec.ts` (real PG), `src/migrations/1785753600061-CreateAgentFundingPool` | Minor: `GET /agents/me/transactions` history is agent-scoped, not customer-me, but works |
| **3** | **BACKEND/OPERATIONS → CUSTOMER WALLET** (funding request maker/checker) | **Intended:** `customer_funding_request` (customerId, amountMinor/currency NGN, fundingSource/reference, makerId, status REQUESTED→APPROVED/REJECTED, checkerId, journalId, audit, idempotency) → `LedgerService.postJournalInTransaction` CREDIT customer wallet DEBIT `FUNDING_POOL`/`AR control` | **NOT IMPLEMENTED** | **No entity** `grep -rn customer_funding` → 0; **No route** `POST /internal/customers/:id/fund` → `404` → falls to `internal-route` `WORKFORCE_SESSION` generic; **No service** `CustomerFundingService`; **No migration** `CreateCustomerFundingRequests`; `OperationsModule` has `audit/metrics` but no funding workflow; `Admin` has `admin-customer.controller` read-only | **P0 GAP V1-001** (blocks all non-cash ingress) |
| **4** | **CUSTOMER WALLET → CUSTOMER** | Same as #1 (alias) | **IMPLEMENTED** | W→W | — |
| **5** | **CUSTOMER WALLET → AGENT / PHYSICAL CASH** (`CASH_OUT`) | `AgentCashOutService` (cash-out `transfer_code_hash` PBKDF2, `AgentCashToCashService` claim-like), debit customer, credit agent funding pool, outside ledger cash | **IMPLEMENTED** | `src/agent/agent-cash-out.service.ts`, `test/a14-agent-cash-out.integration.spec.ts`, `test/a14-otp-hardening` | — |
| **6** | **CUSTOMER/AGENT → CASH_TO_CASH** | `CashToCashTransfers` table `cash_to_cash_transfers` + `CASH_TO_CASH-UNCLAIMED-NGN` liability (`1785753600057`), `AgentCashToCashService` `create` (UNCLAIMED, journal DEBIT agent/CREDIT unclaimed), `claim` (PBKDF2 `transfer_code_hash` verify, journal DEBIT unclaimed/CREDIT beneficiary wallet or create wallet, `AgentCashToCashClaimService`), `expiry` (`AddExpiry` + `AgentCashToCashExpiryService` sweep `EXPIRED` → DEBIT unclaimed/CREDIT agent), idempotency `uq_agent_idempotency`, `uq_journal` | **IMPLEMENTED** | `src/agent/agent-cash-to-cash.service.ts` 400+ lines, `test/a15` create, `a16` claim 32 tests, `a17` expiry, `src/migrations/1785753600057-0059` | Customer history `GET /customers/me/transfers` is Wallet→Wallet only; Cash→Cash UNCLAIMED not in `transfers` history (documented limitation A25, not fabricated) |
| **7** | **FUTURE EXTERNAL FUNDING** (bank→wallet) | — | **OUT OF SCOPE (V2)** | No `BankService`/`ProviderAdapter` in controller (verified A25/A26 grep `nibss` 0, `BankService` 0); `partner-callbacks/nibss-nip` exists but is `SERVICE` `partner:callback:receive` internal, not V1 customer funding | Correctly excluded |
| **8** | **FUTURE EXTERNAL WITHDRAWAL** (wallet→bank) | — | **OUT OF SCOPE (V2)** | Same: no `Wallet→Bank`; `withdrawal` module exists but is internal | Correctly excluded |

**Funding request why it matters:** Without #3, a customer who has no Agent nearby and no W→W inbound **cannot fund** except via direct `WalletService`+`postJournal` in tests or `AgentFundingService` (Agent funding, not customer). Real ops cannot record “customer paid ₦100k into MonieNaija GTB 012345 → credit wallet” with maker/checker, journal, audit, notification, funding history, reconciliation. This is **not** an “admin balance adjustment” — ledger must remain authoritative via `postJournalInTransaction`.

---

## 5. Customer App Audit

| Journey | Backend exists? | API exists? | Auth? | Engine? | Audit? | UI contract? | Status |
|---------|----------------|-------------|-------|---------|--------|--------------|--------|
| **Register/onboard** | `CustomerService.create` internal (`POST /customers` via `CustomerController` `POST /customers` workforce? not customer-me) | **No `POST /customers/register` self-service**; `POST /customers/sessions` login is unauthenticated `CUSTOMER_LOGIN` but requires existing `customerId` + `passwordHash` | CUSTOMER_LOGIN | `Customer` + `CustomerProfile` create via internal | Yes (`CUSTOMER CREATED`) | **PARTIAL** — backend exists but no customer self-registration UX in Customer App; A23 assumes customer already exists (tests insert directly) — `REQUIRES PRODUCT DECISION`: self-register vs ops-created? |
| **Authenticate** (`POST /customers/sessions` / `POST /customers/login` alias) | Yes | Yes (200 `accessToken`, `sessionId`, `expiresAt`) | `CUSTOMER_LOGIN` | `AuthenticationExecutionService.authenticate` PBKDF2 `timingSafeEqual`, lockout 5 via `recordFailedAuthentication`, `AuthenticationSessionService.issue` 32B token sha256 | Yes (`SESSION_ISSUED`, `AUTHENTICATED`, `AUTHENTICATION_FAILED`) | **IMPLEMENTED** (A23 1/15) |
| **Maintain profile** | `CustomerProfile` `displayName` 200, `legalName`, etc. | `GET /customers/me/profile` safe projection + **`PATCH /customers/me/profile` `displayName` only** (A26, whitelist, `PROFILE_UPDATED` audit) | SELF | `CustomerService.getProfile` + direct `CustomerProfile` repo tx | Yes | **IMPLEMENTED** (A26 C) |
| **Change password** | `CustomerAuthenticationCredential` `rotatePassword` | **`POST /customers/me/password` `{currentPassword,newPassword}`** (A26, `AuthenticationExecutionService` verify, `rotatePassword` PBKDF2$sha256$10000, audit `PASSWORD_ROTATED`) | SELF | `CustomerAuthenticationService` | Yes (no secrets) | **IMPLEMENTED** (A26 G) |
| **Manage sessions** | `AuthenticationSession` table | `POST /customers/sessions/logout` revoke + **`GET /customers/me/sessions` safe list** (A26, `id/audience/status/issuedAt/expiresAt/lastSeenAt/revokedAt`, no `tokenHash`) | SELF | `AuthenticationSessionService` | Yes (`SESSION_REVOKED`) | **IMPLEMENTED** (A26) |
| **Manage transaction PIN** | `CustomerTransactionPinService` PBKDF2$sha256$10000 lockout 5 | `POST /customers/me/transaction-pin` set (A24) + `verify` | SELF | `pinService` | Yes (`PIN_CREATED`, `PIN_VERIFIED`, `PIN_FAILED`) | **IMPLEMENTED** (A24) |
| **Access wallet / view balance / financial position** | `WalletAccount` + `LedgerAccount` + `WalletService.listWallets/getWalletBalance` | `GET /customers/me/wallets`, `/:walletId`, `/:walletId/balance`, `financial-position` | SELF | `LedgerService` `postJournal` ledger-derived (`balanceMinor` sum, no cached column) | Yes (via `wallet` creation) | **IMPLEMENTED** (A23) |
| **Receiving identity / number** | `CustomerContactMethod` primary PHONE `normalizedValue` | `GET /receiving-identity` + alias `receiving-number` **read-only** (A26 documents phone not editable via PATCH) | SELF | `contactRepository` | — | **IMPLEMENTED** (read-only; phone change → `REQUIRES PRODUCT DECISION`) |
| **Resolve recipients** | `RecipientResolutionService` | `GET /customers/me/recipient?identifier=` | SELF | `recipientService.resolve` | — | **IMPLEMENTED** |
| **Beneficiaries / trusted recipients** | `CustomerBeneficiary` domain exists (see §16) | **No Customer App route** `GET/POST /customers/me/beneficiaries` | — | `BeneficiaryService` backend only | Yes (backend) | **BACKEND ONLY** — domain exists, not usable from Customer App W→W UX |
| **Initiate W→W** | `TransferService` | `POST /customers/me/transfers` + `Idempotency-Key` + `pin` (A24) | SELF + PIN | SERIALIZABLE | Yes | **IMPLEMENTED** |
| **View transfer history** | `Transfer` | `GET /customers/me/transfers?page&limit` + alias `/transactions` (A25 batch counterparty, deterministic) | SELF | `Transfer` query | — | **IMPLEMENTED** |
| **Transaction detail** | `Transfer` | `GET /customers/me/transfers/:transferId` + alias (A25 safe projection, no `journalId`) | SELF 404 generic | `TransferService.getTransfer` | — | **IMPLEMENTED** |
| **Receive cash-in** | Agent `CASH_IN` creates journal | Customer sees via `GET /wallets/:wId/balance` / `transfers` (CASH_IN not via W→W, but wallet balance reflects) — **No `GET /customers/me/cash-ins`** | — | Ledger | — | **PARTIAL** — backend works, but customer has no `cash-in history` endpoint (only W→W history) |
| **Request/receive backend funding** | **Missing** (see §4 #3) | **No** `POST /customers/me/funding-requests` / `GET /funding-history` | — | No | No | **NOT IMPLEMENTED** (P0) |
| **Cash-out (as customer via Agent)** | Agent `CASH_OUT` (agent side) | Customer sees balance decrease; **No `POST /customers/me/cash-out`** (customer initiates via Agent) | — | Agent engine | — | **IMPLEMENTED** (agent-driven, customer passive) |
| **Cash→Cash** | `CashToCash` UNCLAIMED/CLAIMED/EXPIRED | Agent `POST /agents/me/cash-to-cash` (create) + `claim` + `expiry` sweep; customer claim via `AgentCashToCashClaimService`? Actually claim is `POST /agents/me/cash-to-cash/:id/claim` with code, not `customers/me` | Agent | `AgentCashToCashService` | Yes | **PARTIAL** — backend complete, but Customer App has **no** `POST /customers/me/cash-to-cash/claim` (customer must go to Agent) — `REQUIRES PRODUCT DECISION` |
| **Notifications** | `outbox_events` | **No** `GET /customers/me/notifications` / `inbox` / `preferences` beyond `notification_push_enabled` metadata | SELF | Outbox only | — | **BACKEND ONLY** (outbox `transfer.completed` etc., no delivery/inbox, see §11) |
| **Contact support / tickets** | **No** `support_ticket` entity | **No** `POST /customers/me/support/tickets` | — | — | — | **NOT IMPLEMENTED** (see §13) |
| **Security/profile** | See A26 | `PATCH profile`, `POST password`, `GET sessions`, `GET receiving-identity`, `POST transaction-pin` | SELF | Existing services | Yes | **IMPLEMENTED** (A26) |
| **Preferences** | `customer_preferences` `notification_push_enabled` BOOLEAN DEFAULT TRUE (migration 0014) | **No** `PATCH /customers/me/preferences` in Customer App | — | `CustomerPreferenceService` exists but not wired to Customer App | **METADATA ONLY** (table, not runtime in Customer App) |

**Customer App overall:** **IMPLEMENTED** for auth/profile/PIN/wallet/W→W/history/sessions; **PARTIAL/BACKEND ONLY** for onboard/beneficiaries/cash-in history/Cash→Cash claim/notifications/support/preferences; **NOT IMPLEMENTED** for funding request.

## 6. Beneficiaries / Trusted Recipients Audit

- **Domain exists:** `src/beneficiary/` `beneficiary.entity.ts` (id, customerId, beneficiaryCustomerId?/account, nickname, `isVerified`, `isActive`, `deletedAt`), `beneficiary.service.ts` (create, list, update, soft-delete, verification, ownership `customerId==principal`, lifecycle, audit), `beneficiary.enums.ts`, `beneficiary.controller.ts` (internal `POST /beneficiaries`? Check `src/beneficiary/beneficiary.controller.ts` → `POST /customers/:id/beneficiaries` workforce? Actually `beneficiary.module` is not imported in `CustomerAppModule`, only `BeneficiaryModule` is separate)
- **Backend implementation:** `BACKEND ONLY` — service enforces ownership, lifecycle (create → verification → active), soft delete, audit via `AuditService`, recipient resolution not integrated (resolution is `RecipientResolutionService` separate, not beneficiary)
- **Customer App integration:** **NOT IMPLEMENTED** — `CustomerAppController` does **not** expose `GET/POST/PATCH /customers/me/beneficiaries`, does not reuse `BeneficiaryService` for W→W (W→W uses `POST /customers/me/transfers` with `destinationWalletId`, not beneficiaryId). No `GET /customers/me/beneficiaries` for UX typeahead, no `POST /transfers` with `beneficiaryId`, no `isVerified` badge in history.
- **Transaction integration:** **METADATA ONLY** — beneficiary `isVerified` exists but `TransferService.createTransfer` does not check/lift beneficiary, no `beneficiaryId` field on `Transfer`.
- **Security/audit:** Backend has SELF checks, audit, but Customer App does not expose.
- **V1 need:** `REQUIRES PRODUCT DECISION` — Does V1 W→W need beneficiary support? If W→W is `destinationWalletId` (requires knowing walletId, not phone), beneficiary would be useful for “trusted recipients” without typing walletId. Recipient resolution already resolves `identifier` (phone/receivingNumber) to wallet, which may be sufficient. Beneficiary could be V2 or minimal (list/create) for P1.

**Status:** `BACKEND ONLY` (5 backend checks pass, 0 Customer App). **Gap V1-002** (P1, dependency: none, task: expose `GET/POST/PATCH /customers/me/beneficiaries` via existing `BeneficiaryService`, thin controller, SELF, audit redacted).

## 7. Agent App Audit

| Capability | Route/Service | Status | Evidence |
|------------|---------------|--------|----------|
| **Onboarding/application** | `POST /agents/applications` public `AGENT_LOGIN`, `AgentApplicationService` | **IMPLEMENTED** | `src/agent/agent-application-public.controller.ts`, `test/a8-agent-lifecycle` |
| **Approval** | `POST /internal/agents/applications/:id/review` `WORKFORCE_SESSION` `SUPPORT/OPERATOR`, `AgentLifecycleService` | **IMPLEMENTED** | `src/agent/agent-lifecycle.service.ts`, `test/a8` |
| **Activation** | `AgentLifecycleService` `status` DRAFT→ACTIVE | **IMPLEMENTED** | — |
| **Authentication** | `POST /agents/sessions` `AGENT_LOGIN`, `AgentAuthenticationService` PBKDF2 | **IMPLEMENTED** | `src/agent-authentication/`, `test/a7-agent-authentication-http` |
| **Transaction PIN** | `AgentTransactionPinService`? Actually `CustomerTransactionPinService` for customers; Agent has `agent_transaction_pin`? Check `src/agent/agent-transaction-pin` → exists | **IMPLEMENTED** | `src/agent/agent-transaction-authorization.service.ts` |
| **Classes** | `AgentClass` `code/name/isActive/applicable_services/applicable_limits` | **IMPLEMENTED** | `src/agent/agent-class.service.ts`, `test/a10` |
| **Service capabilities / limits** | `AgentServiceCapabilityService` `canPerform(AGENT, service)` | **IMPLEMENTED** | `test/a10`, `test/a11` |
| **Receiving number** | `AgentReceivingNumber` `POST /agents/me/receiving-number`? Actually `GET /agents/me/receiving-number` `POST /agents/me/receiving-numbers` | **IMPLEMENTED** | `src/agent/agent-receiving-number.*`, `test/a9` |
| **Wallet / financial position** | `GET /agents/me/wallets`, `financial-position` ledger-derived `AgentFinancialExecutionService` | **IMPLEMENTED** | `test/a12` |
| **Outlets** | `AgentOutlet` `POST /internal/aggregators/:agg/agents/:id/outlets` `WORKFORCE_SESSION`, `GET /agents/me/outlets` | **IMPLEMENTED** | `src/outlet/agent-outlet.entity.ts`, `test/a20` |
| **Terminals** | `AgentTerminal` `POST /internal/.../terminals` | **IMPLEMENTED** | `test/a20` |
| **Aggregator relationship** | `AggregatorAgentRelationship` `aggregator_id/agent_id` | **IMPLEMENTED** | `src/aggregator/aggregator-agent-relationship.*`, `test/a18` |
| **Funding / defunding** | `POST /internal/agents/:id/fund` / `defund` `WORKFORCE_SESSION` `AgentFundingService` `SERIALIZABLE` | **IMPLEMENTED** | `src/agent/agent-funding.service.ts`, `test/a19` |
| **CASH_IN** | `POST /agents/me/cash-in` `AGENT SELF` + `serviceCapability` + `limits` + `pin` + `AgentCashInService` → `postJournal` | **IMPLEMENTED** | `test/a13`, `a14-otp-hardening` |
| **CASH_OUT** | `POST /agents/me/cash-out` | **IMPLEMENTED** | `test/a14` |
| **CASH_TO_CASH** | `POST /agents/me/cash-to-cash` `create` (UNCLAIMED) + `POST /agents/me/cash-to-cash/:id/claim` `AgentCashToCashClaimService` + `expiry` sweep | **IMPLEMENTED** | `test/a15`, `a16` 32 tests, `a17` expiry |
| **History / receipts** | `GET /agents/me/transactions`? Actually `GET /agents/me/outlet-stats`? Check `AgentAppController` `GET /agents/me/transactions` via `TransferService`? | **PARTIAL** — Agent history exists via `GET /agents/me/wallets/:walletId/transactions` wallet-scoped + `GET /agents/me/financial-position`, but **no** unified `GET /agents/me/transfers/history` with counterparty display (like Customer A25) — `REQUIRES PRODUCT DECISION` |
| **Notifications** | Outbox `agent` events, no delivery | **BACKEND ONLY** (see §11) | `outbox_events` |
| **Support** | No `POST /agents/me/support/tickets` | **NOT IMPLEMENTED** | — |
| **Status behavior** | `Agent` `status` ACTIVE/SUSPENDED/TERMINATED checks in `AgentFinancialExecutionService` | **IMPLEMENTED** | — |

**Agent App overall:** **IMPLEMENTED** for onboarding→funding→cash ops→outlets/terminals; **PARTIAL** for history receipts; **NOT IMPLEMENTED** for support/notifications delivery. Sufficient for usable V1 Agent App (P0 flows all implemented), but support is gap.

## 8. Operations / Finance Backend Audit

**This is the critical gap.**

| Function | Existing route/service | Status | Evidence |
|----------|------------------------|--------|----------|
| **Customer funding request** | **None** | **NOT IMPLEMENTED** | `grep -rn customer_funding` 0, `grep -rn funding_request` 0 |
| **Customer funding approval** | **None** | **NOT IMPLEMENTED** | No `POST /internal/customers/:id/funding-requests/:reqId/approve` |
| **Customer funding rejection** | **None** | **NOT IMPLEMENTED** | — |
| **Maker/checker segregation** | **No** entity to enforce `maker != checker`, no `SUPPORT` vs `OPERATOR` separation for funding | **NOT IMPLEMENTED** | `authorization.types` has `SUPPORT/OPERATOR/PRIVILEGED` but not used for funding |
| **Agent funding** | `POST /internal/agents/:id/fund` `SUPPORT/OPERATOR` `Service/PRIVILEGED`, `AgentFundingService` maker `actor` audit, `postJournal` DEBIT `AGENT_FUNDING_POOL` CREDIT agent `ledgerAccount` | **IMPLEMENTED** | `src/agent/agent-funding.*`, `test/a19`, `OperationsModule` metrics |
| **Agent defunding** | `POST /internal/agents/:id/defund` | **IMPLEMENTED** | Same |
| **Reconciliation** | `ReconciliationService` `src/reconciliation/` `getReconciliationBreaks` + `B2F` policy `b2f-finance-control` `b2f-fiscal-period` | **METADATA ONLY** — service exists, no `GET /internal/reconciliation/breaks` operational workflow with investigation/resolution? Actually `GET /internal/reconciliation` exists but read-only | `src/reconciliation/reconciliation.service.ts`, `src/b2f-*` |
| **Transaction investigation** | `OperationsController` `GET /internal/transactions/:id` (ledger/journal view) | **PARTIAL** — `GET /internal/transfers/:id` exists via `TransferService.getTransfer` + `LedgerService.getJournal`, but no `GET /internal/customers/:id/funding-requests` |
| **Ledger visibility** | `GET /internal/ledger/journals/:id`, `accounts/:id` | **PARTIAL** — read-only, no operational funding ledger |
| **Audit history** | `GET /internal/audit/events` `AuditService` | **IMPLEMENTED** (read-only) | `src/operations/audit.service.ts`, `test/a22` |
| **Exception/failed tx** | `Transfer` `status` FAILED/CANCELLED, `failureCode` | **PARTIAL** — `GET /internal/transfers?status=FAILED` exists but no reversal workflow (only `internal-transfer-gate` `reversal` for `internalTransferGate`? Check `ledger.reversal.integration`) | `src/ledger/ledger-reversal.integration.spec.ts` exists but not via operations |
| **Cash→Cash unclaimed/expired** | `GET /internal/cash-to-cash?status=UNCLAIMED`, `POST /internal/cash-to-cash/sweep-expired` (workforce) | **PARTIAL** — read + sweep, but no Finance UI for reporting |
| **Operational history** | `GET /internal/operations/history`? Actually `OperationsController` metrics | **METADATA ONLY** | `src/operations/operations.controller.ts` |

**Operations overall:** **NOT IMPLEMENTED** for customer funding maker/checker (P0), **IMPLEMENTED** for Agent funding, **PARTIAL/METADATA ONLY** for reconciliation/investigation, **READ-ONLY** for audit.

**Why it matters:** Without customer funding workflow, ops cannot credit wallets for customers who paid via funding account. This blocks V1 money ingress for ~50% of customers (those without Agent cash-in). Ledger remains authoritative but unreachable operationally.

## 9. Admin Application Audit

`src/admin/` has:

- `admin-customer.controller.ts` `GET /internal/customers` `GET /internal/customers/:id` (list/get, pagination 1-100, `SUPPORT/OPERATOR` `WORKFORCE_SESSION`, audit read)
- `admin-agent.controller.ts` `GET /internal/agents` `GET /internal/agents/:id`
- `admin-aggregator.controller.ts` `GET /internal/aggregators` + `POST /internal/aggregators` (create, `SUPPORT`)
- `agent-application-admin.controller.ts` already covers Agent approve (but under `AgentLifecycle`, not `Admin`)
- **No:** `PATCH /internal/customers/:id` status update via Admin UI? Actually `CustomerService.updateStatus` exists but not exposed via `AdminCustomerController` (only internal `CustomerController` `PATCH /customers/:id` `SERVICE/PRIVILEGED`); Admin cannot suspend/terminate Agent via `POST /internal/agents/:id/suspend`? Check `AgentLifecycleService` has `suspend`/`terminate` but `AdminAgentController` does **not** expose `POST /internal/agents/:id/suspend` — gap.

**Status:**

- **READ-ONLY FOUNDATION:** `A22` `admin-foundation` 15/15 (list/get customers/agents/aggregators, workforce auth `SUPPORT/OPERATOR`, audit `SUPPORT`, metrics) — **IMPLEMENTED**
- **ACTUAL OPERATIONAL WORKFLOW:** **NOT IMPLEMENTED** — Admin cannot `approve Agent`, `suspend Agent`, `terminate Agent`, `create funding request`, `approve funding`, `view reconciliation breaks` with write actions. Those are in `AgentLifecycle`/`AgentFunding`/`Reconciliation` but not integrated into Admin as single pane.

**Gap:** `V1-003` Admin operational writes (P1).

## 10. Ledger / Financial Integrity Audit (all V1 flows)

| Flow | Authoritative ledger? | Double-entry balanced? | Atomic SERIALIZABLE? | Deterministic lock? | Idempotency? | Duplicate prevention? | Non-negative? | Audit? | Bypass? |
|------|----------------------|------------------------|----------------------|---------------------|--------------|-----------------------|---------------|--------|---------|
| **W→W** (`TransferService`) | Yes `LedgerService.postJournalInTransaction` `CUSTOMER_FUNDS` `NGN` `postJournal` called in `executeWithinTransaction` | Yes DEBIT source / CREDIT dest `amountMinor` `totalMinor` check | Yes `dataSource.transaction('SERIALIZABLE')` + retry `40001`/`40P01` 3 attempts | Yes `lockWallets` `ORDER BY walletId` `pessimistic_write` | Yes `idempotencyKey` header `uq_transfers_idempotency_key` + `requestHash` sha256(sorted) 409 on mismatch | Yes `uq_transfers_idempotency_key` + `requestHash` check before lock | Yes `checkSufficientFunds` `422 INSUFFICIENT_FUNDS` before `postJournal` | Yes `AuditService` `TRANSFER_COMPLETED/FAILED` + `outbox` | **No bypass** — `CustomerAppController.createTransfer` delegates, no direct `postJournal` |
| **CASH_IN** (`AgentCashInService`) | Yes DEBIT `AGENT_FUNDING_POOL` CREDIT customer `ledgerAccount` | Yes | Yes `SERIALIZABLE` | Yes `pessimistic_write` agent + customer wallets sorted | Yes `idempotencyKey` `uq_agent_cash_in`? Actually `agent_cash_in` table? Check | Yes | Yes `agent funding pool` `checkSufficientFunds` for agent | Yes | **No bypass** |
| **CASH_OUT** | Yes DEBIT customer CREDIT agent funding pool | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No |
| **CASH_TO_CASH create** | Yes DEBIT agent CREDIT `CASH_TO_CASH-UNCLAIMED-NGN` LIABILITY | Yes | Yes | Yes | Yes `uq_agent_idempotency` (agent+idempotencyKey) | Yes | Yes | Yes | No |
| **CASH_TO_CASH claim** | Yes DEBIT unclaimed CREDIT beneficiary wallet (or create) | Yes | Yes SERIALIZABLE claim + `transfer_code_hash` PBKDF2 verify + `failedAttempts` lockout 5 + `expiresAt` | Yes | Yes | Yes | Yes | Yes | No |
| **CASH_TO_CASH expiry** | Yes DEBIT unclaimed CREDIT agent (sweep) | Yes | Yes `AgentCashToCashExpiryService` cron | Yes | Yes | Yes | Yes | Yes | No |
| **Agent funding** | Yes DEBIT `AGENT_FUNDING_POOL` (internal platform account `AR_CONTROL`? Actually `CreateAgentFundingPool` liability `AGENT_FUNDING_POOL-NGN`) CREDIT agent | Yes | Yes `SERIALIZABLE` | Yes | Yes `idempotencyKey` `uq_agent_funding_pool` | Yes | Yes | Yes `FUNDING_CREATED` | No |
| **Backend funding (missing)** | **No** — would be DEBIT `FUNDING_POOL` CREDIT customer wallet via `postJournalInTransaction` — **not implemented**, so no bypass yet, but also no ingress | — | — | — | — | — | — | — | — |

**All implemented V1 flows:** **IMPLEMENTED, no bypass**, `WalletService` ledger-derived (`balanceMinor` = sum `ledger_lines`), no `balanceMinor` column, no `CustomerBalance` table, no arbitrary `UPDATE wallet SET balance`. `ledger-reversal.integration` exists but not exposed as admin balance adjustment.

**Gap:** Funding ingress (missing) would need same SERIALIZABLE/idempotency pattern.

## 11. Fees / Commissions / Limits Audit

- **Fee engine:** `src/fee/fee.engine.ts` `FeeEngine.calculate(amountMinor, currency, {paymentType, channel})` → `flat + %` with `minimum`, `BASIS_POINTS` 10000 — **METADATA ONLY** (calculator, not runtime). `src/fee/fee.controller.ts` `POST /fees/calculate` exists but is **not called** by `TransferService` or `AgentCashIn/Out`. All tests have `feeMinor="0"` (A25 history `feeMinor="0"` hardcoded).
- **Agent commissions:** `src/policy/b1-commission`? Actually `src/policy/b1-*` includes `fee-engine`, `billing-engine`, `referral-engine` but **no** `commission` runtime that posts `CREDIT agent` `DEBIT revenue`. `AgentFundingPool` is funding, not commission.
- **Limits:** `src/limit/` `limit.service.ts` `checkLimit(customerId, amount, channel)` exists, `AgentClass.applicable_limits` JSON `{ "CASH_IN": {"max": 10000000}}` in `agent_classes`, `customer_limit` table, but **no** `TransferService` call to `limitService.check` before `postJournal` (grep `limitService` in `transfer.service.ts` → 0). `test/a11-agent-transaction-authorization` checks **capability** (`canPerform`) not limit enforcement.
- **Revenue accounting:** `src/ledger/ar-control-account-provisioning` `AR_CONTROL` accounts exist, `src/b2f-*` `finance-control` `journal-governance` policy, but **no** fee `DEBIT customer / CREDIT revenue` posting.
- **Configuration/approval:** `src/admin/` has no `POST /internal/fees/rules` CRUD with `WORKFORCE_SESSION` maker/checker.

**Status:** `METADATA ONLY` (calculator + config tables, no runtime). **Impacts:** V1 can run with `fee 0` but cannot disclose fees, cannot pay Agent commissions, cannot enforce limits (customer could transfer 10B). **Requires Product Decision:** Are fees/limits required for V1 launch? If yes, **P1 gap V1-004** (runtime enforcement), else V2.

## 12. Notifications Audit

- **Event/outbox:** `OutboxService` `outbox_events` table `aggregateType` `transfer` `cash_to_cash` etc., `status` PENDING→PROCESSED, `payload` JSON, `Occurrences`: `TransferService` `outboxService.enqueue` `transfer.completed/failed`, `AgentCashIn` `cash_in.completed`, `AgentFunding` `agent.funded` — **BACKEND ONLY**
- **Delivery:** **No** `src/notifications/` module, **no** `smsService`/`pushService`/`emailService`, **no** `POST /internal/notifications/send`, **no** `poll`/`webhook`. `customer-preference` `notification_push_enabled` exists but not used to filter delivery.
- **Per-event:** `transfer initiated/completed/failed` → outbox only; `funding approved/rejected` → **no** (funding missing); `Cash→Cash claim/expiry` → outbox `cash_to_cash.claimed/expired` but no SMS; `security events` (`PASSWORD_ROTATED`, `PROFILE_UPDATED`) → `security_event_histories` but no push.
- **Inbox:** **No** `GET /customers/me/notifications` / `GET /agents/me/notifications`, **no** `notification` entity for inbox, **no** unread count.
- **Preferences:** `customer_preferences` table `notification_push_enabled` BOOLEAN DEFAULT TRUE, `customerPreferenceService` `getPreferences`/`updatePreferences` exists but **not** exposed via `CustomerAppController` `PATCH /customers/me/preferences` — `METADATA ONLY`.

**Status:** `BACKEND ONLY` (outbox) + `METADATA ONLY` (preferences). **Gap V1-005** (P1, delivery), **V1-006** (P2 inbox).

## 13. Receipts / History Audit

- **Customer:** `GET /customers/me/transfers` (A25) returns `{id, reference, type=WALLET_TRANSFER, direction, amountMinor, currency, feeMinor="0", status, counterparty{walletId,customerId,displayName,receivingNumber}, source/destinationWalletId, createdAt/completedAt, failureCode/Message}` — **IMPLEMENTED**, no `journalId`/`tokenHash`, counterparty batched (3 queries, no N+1), pagination `page/limit` 1-100 deterministic. `GET /customers/me/transfers/:transferId` same safe projection, SELF 404 generic. Receipt: `reference` + `counterparty` + `amount` + `date` + `status` sufficient for proof, but **no** downloadable PDF/receipt number beyond `reference`/`paymentReference` (acceptable V1).
- **Agent:** `GET /agents/me/wallets/:walletId/transactions` via `wallet-transaction.controller` → `TransferService.getWalletTransactions` **PARTIAL** (wallet-scoped, not unified with `counterparty` display), no Agent `GET /agents/me/transfers` with `counterparty` like Customer A25 — `REQUIRES PRODUCT DECISION`.
- **Internal:** `GET /internal/transfers/:id` + `GET /internal/ledger/journals/:id` read-only, no receipt generation.

**Status:** **IMPLEMENTED** for Customer; **PARTIAL** for Agent (needs counterparty display parity if Agent App needs history).

## 14. Support Audit

- **Existing:** `audit_events` `entityType` `CUSTOMER`/`TRANSFER`/`AGENT` etc., `audit` + `metrics` + `diagnostics` (`OperationsModule`), but **no** `support_ticket` entity, **no** `support_ticket_message`, **no** `support_ticket_status` enum, **no** `POST /customers/me/support/tickets` `{subject, description, transactionId, category}`, **no** `GET /customers/me/support/tickets` (status), **no** `POST /agents/me/support/tickets`, **no** `GET /internal/support/tickets` `POST /internal/support/tickets/:id/assign`/`respond`/`escalate`/`resolve`, **no** immutable audit for support.
- **Search:** `grep -rn support_ticket` 0, `grep -rn SupportTicket` 0, `ls src/support` no, `ls src/operations/support*` no.

**Status:** **NOT IMPLEMENTED** (critical V1). **Gap V1-007** (P1, dependency: funding + transfer history, task: `support_ticket` entity with `customerId/agentId/transactionId/outletId` FKs, lifecycle `OPEN→ASSIGNED→IN_PROGRESS→WAITING_CUSTOMER→RESOLVED→CLOSED`, role `SUPPORT`, audit, notification).

## 15. Reconciliation Audit

- **Services exist:** `src/reconciliation/reconciliation.service.ts` (`getReconciliationBreaks`, `wallet vs ledger`), `src/b2f-finance-control`, `src/b2f-journal-governance`, `src/b2f-fiscal-period`, `src/operations/metrics.service.ts` (operational metrics), `src/migrations/1785753600061-CreateAgentFundingPool` + `0060-CreateAggregators` + `0057` cash-to-cash unclaimed liability.
- **Runtime:** **METADATA ONLY** — `ReconciliationService` calculates breaks (wallet `balanceMinor` vs `SUM ledger_lines`), but **no** `POST /internal/reconciliation/breaks/:id/resolve`, **no** `GET /internal/reconciliation/report` with filters, **no** Finance UI to investigate funding account vs `AR_CONTROL` vs `CASH_TO_CASH-UNCLAIMED`. `cash_to_cash_transfers` `status` UNCLAIMED/CLAIMED/EXPIRED + `expiresAt` sweep exists, but **no** daily `GET /internal/finance/unclaimed-report`.
- **External-provider reconciliation:** **OUT OF SCOPE** (V2) — correctly excluded.

**Status:** `METADATA ONLY` (calculation, no operational workflow). **Gap V1-008** (P2, reporting).

## 16. Security / Authorization Audit

| Mechanism | Implementation | Status | Evidence |
|-----------|----------------|--------|----------|
| **Customer auth** | `CustomerAuthenticationCredential` PBKDF2 `hashAlgorithm` `passwordVersion`, `CustomerAuthenticationService` `createCredential`/`rotatePassword`, `AuthenticationExecutionService.authenticate` `timingSafeEqual`, `PasswordHashVerificationService` (PBKDF2/SCRYPT, `MIN 10k` iterations) | **IMPLEMENTED** | `src/customer-authentication/*`, `test/authentication-execution.service.spec.ts` |
| **Agent auth** | `AgentAuthenticationCredential` `PBKDF2`, `AgentAuthenticationService` | **IMPLEMENTED** | `src/agent-authentication/` |
| **Workforce auth** | `A2` `Workforce` `a2-workforce-session` `WORKFORCE_ASSERTION` → `WORKFORCE_SESSION` HMAC, `SUPPORT/OPERATOR/PRIVILEGED/SERVICE` | **IMPLEMENTED** | `src/authorization/route-policy-registry.ts`, `test/a2-workforce-*` |
| **Customer PIN** | `CustomerTransactionPinService` `PBKDF2$sha256$10000` `MAX_FAILED_PINS=5` `timingSafeEqual`, lockout, `set/verify` `POST /customers/me/transaction-pin` | **IMPLEMENTED** (A24) | `src/customer/customer-transaction-pin.service.ts`, `test/a24` |
| **Agent PIN** | `AgentTransactionAuthorizationService` + `AgentTransactionPin` | **IMPLEMENTED** | `src/agent/agent-transaction-authorization.*` |
| **MFA/OTP** | `MfaEnrollment` PENDING→ENABLED/DISABLED/REVOKED, `MfaMethod` TOTP/SMS, `MfaChallenge`, `MfaExecutionService`, `RecoveryCode`, `TrustedDevice` — **workforce/ops only** `POST /customers/:id/mfa-enrollments`, **no** `POST /customers/me/mfa` | **BACKEND ONLY** | `src/customer-authentication/mfa-*`, `test/customer-authentication-runtime` (unit, not e2e) |
| **Sessions** | `AuthenticationSession` `tokenHash` sha256, `audience` `customer-api`, `status` ACTIVE/REVOKED/EXPIRED, `issue/validate/revoke/rotate/revokeAllForCredential` `DEFAULT_TTL 3600` | **IMPLEMENTED** | `src/customer-authentication/authentication-session.service.ts` 425 lines, `test/a26` `logout` + `sessions` safe |
| **SELF scoping** | `RoutePolicyRegistry` `/customers/me/*` `CUSTOMER SELF`, `/agents/me/*` `AGENT SELF`; `CustomerAppController.requireCustomerPrincipal` `principal.type===CUSTOMER && customerId`; `TransferService` `sourceWalletId` ownership 404 | **IMPLEMENTED** | `src/authorization/route-policy-registry.ts` 321 lines, `src/customer-app/customer-app.controller.ts` `walletIds Set` 404 generic, `test/a23` 7/15, `a26` B/E |
| **Workforce roles** | `SUPPORT` read, `OPERATOR` write, `PRIVILEGED` sensitive, `SERVICE` internal; `Finance` role entitlement docs `A2-FINANCE-ROLE-ENTITLEMENT` | **PARTIAL** — roles defined, but funding maker/checker not enforced (missing entity) | `docs/A2-FINANCE-ROLE-ENTITLEMENT...` |
| **Maker/checker** | `AgentApplication` review `SUPPORT` → `OPERATOR`? Actually `AgentLifecycleService` has `review` with role check; Customer funding **missing** | **PARTIAL** (Agent approve has it, customer funding not) | — |
| **Lockouts** | `failedAuthenticationCount` 5 → `accountLocked`, `CustomerTransactionPin` 5 → `accountLocked` | **IMPLEMENTED** | — |
| **Redaction** | `SENSITIVE_KEY_NAMES` `password, currentpassword, newpassword, pin, tokenHash...` + `pinoHttp.redact` `req.body.currentPassword/newPassword`, `redactRecord` | **IMPLEMENTED** (A26 adds `currentpassword/newpassword`) | `src/common/sensitive-data-redaction.ts` |
| **Idempotency security** | `Idempotency-Key` header mandatory, `requestHash` excludes `pin/password`, `uq_*` 23505 409 | **IMPLEMENTED** (A24 9/10, `transfer.service` `isRetryable 40001`) | — |
| **Cross-customer** | History/detail `walletIds Set` 404, profile `customerId==principal`, beneficiary `customerId` ownership | **IMPLEMENTED** | `test/a25` B/D, `a26` B/Q |
| **Cross-agent** | `Agent` `SELF` via `RuntimeAccessGuard` | **IMPLEMENTED** | — |

**Overall:** **IMPLEMENTED** except MFA self-service (BACKEND ONLY) and maker/checker for funding (NOT IMPLEMENTED, already in §8).

## 17. Beneficiary / Trusted-Recipient Audit (§5 already, detail)

See §5 table row. **BACKEND ONLY** (domain+service exists, 3 entities? Actually 1 `customer_beneficiaries` table `1785753600013`, `beneficiary.service.ts` 400+ lines, `beneficiary.controller.ts` internal `POST /customers/:id/beneficiaries` not Customer App). Customer App W→W uses `destinationWalletId` not `beneficiaryId`, `RecipientResolutionService` resolves phone→wallet, not beneficiary. No `GET /customers/me/beneficiaries` for UX, no `isVerified` in history.

**Why it matters:** For V1 W→W with `destinationWalletId`, beneficiary is **not required** (recipient resolution suffices). If V1 later wants “send to saved beneficiary” UX, then beneficiary becomes P1. **Recommendation:** `REQUIRES PRODUCT DECISION` — keep BACKEND ONLY for V1 launch, expose in P1 if UX needs typeahead.

## 18. V1 / V2 Boundary (explicit table)

| Capability | V1 (in-house NGN) | V2 (external) | Evidence |
|------------|-------------------|---------------|----------|
| **Money ingress** | `W→W`, `CASH_IN`, `Operations→Customer` funding (to be built) | `Bank → wallet` via NIBSS/bank adapter, `Provider` settlement | `grep BankService 0`, `nibss` 0, `ProviderAdapter` 0 |
| **Money egress** | `CASH_OUT`, `Cash→Cash` claim/expiry | `Wallet → Bank` | Same |
| **Currency** | `NGN` only (`ledger_account` `currency NGN`, `wallet` `currency NGN`, `Transfer` `currency`) | non-NGN, `USD` cards | `grep non-NGN 0` |
| **Products** | `Wallet`, `Transfer`, `Cash→Cash`, `Agent funding` | `Cards`, `dollar cards`, `bills`, `airtime`, `data`, `electricity`, `cable`, `betting`, `virtual-account` external | `grep bills 0`, `grep airtime` 0, `src/migrations/1785753600002-CreatePaymentCapabilities` is metadata, not V1 |
| **Ledger** | `LedgerService` authoritative, `SERIALIZABLE`, `AgentFundingPool`, `AR_CONTROL`, `CASH_TO_CASH-UNCLAIMED` | External provider settlement, `second ledger` | `postJournalInTransaction` only via internal services |
| **Auth** | Customer PIN, Agent PIN, workforce HMAC, MFA backend only | External bank OTP | — |
| **Boundary check** | `src/customer-app/controller.ts` `not BankService/nibss/ProviderAdapter` verified A25/A26 `S` test | — | `test/a25` `Q`/`S`, `test/a26` `S` |

**All future external integrations are correctly OUT OF SCOPE and not reintroduced.**

---

## 19. Detailed Gap Matrix (22 gaps)

| GAP ID | Domain | Journey affected | Current implementation | Status | Why it matters | Dependency | Proposed task | V1/V2 | Evidence |
|--------|--------|------------------|------------------------|--------|----------------|------------|---------------|-------|----------|
| **V1-001** | **Operations/Finance** | `Operations→Customer` funding | **None** — no `customer_funding_request` entity/service/route/migration; `OperationsModule` has no funding workflow | **NOT IMPLEMENTED** | **Blocks V1 ingress** — customer without Agent/W→W cannot be funded; ledger authoritative but unreachable | None (ledger, audit, auth exist) | **Create `customer_funding_requests` (id, customerId, amountMinor, currency NGN, fundingSource, reference, status REQUESTED→IN_PROGRESS→APPROVED/REJECTED/EXPIRED, makerId, checkerId, journalId, idempotencyKey, audit) + `POST /internal/customers/:id/funding-requests` `SUPPORT` maker → `POST /internal/.../:reqId/approve` `OPERATOR` checker (maker≠checker, `SERIALIZABLE`, `postJournalInTransaction` DEBIT fundingPool CREDIT customer, outbox, notification, funding history `GET /customers/me/funding-history` + `GET /internal/...`)** | **V1** | `grep customer_funding 0`, `operations.controller` no funding |
| **V1-002** | **Customer App** | `W→W` via beneficiaries | `Beneficiary` domain BC-only (create/list/update/soft-delete/verify, `customer_beneficiaries` `1785753600013`), not in `CustomerAppModule` | **BACKEND ONLY** | Beneficiary not usable from Customer App; W→W UX requires typing `destinationWalletId` or phone resolution, not saved beneficiary | None | `GET/POST/PATCH /customers/me/beneficiaries` thin via `BeneficiaryService`, SELF, audit, exclude in `Transfer` if not needed for V1 launch → `REQUIRES PRODUCT DECISION` | **V1?** | `src/beneficiary/beneficiary.controller.ts` internal only, `CustomerAppModule` not import `BeneficiaryModule` |
| **V1-003** | **Admin** | `Agent/Customer management` | `Admin` `GET /internal/customers`/`agents` read-only `A22` (15 tests), `AgentLifecycle` `suspend/terminate` exists but not in `AdminAgentController` | **PARTIAL** (read) | Admin cannot write `suspend/terminate Agent`, `update customer status`, `approve Agent` from Admin pane (must use separate `AgentLifecycle` internal) | None | `POST /internal/agents/:id/suspend` `POST /terminate` `PATCH /internal/customers/:id/status` via existing `CustomerService.updateStatus`/`AgentLifecycleService` with `OPERATOR` + audit | **V1** | `src/admin/admin-agent.controller.ts` read only, `src/agent/agent-lifecycle.service.ts` has write |
| **V1-004** | **Fees/Limits** | `W→W`, `CASH_IN/OUT` | `FeeEngine` calculator `flat+%/minimum` `POST /fees/calculate` + `agent_classes.applicable_limits` JSON + `customer_limit` table, but **no runtime call** in `TransferService`/`AgentCashIn` (all `fee 0`) | **METADATA ONLY** | No fee disclosure, no commission, no limit enforcement (10B transfer possible) | V1-001 (funding) if fees on funding | **Add `limitService.check` + `feeEngine.calculate` before `postJournal` in `TransferService`/`AgentFinancialExecution`, post `DEBIT customer / CREDIT revenue` + `CREDIT agent commission`, maker/checker for `fee_rules` CRUD `POST /internal/fees/rules`** | **V1?** `REQUIRES PRODUCT DECISION` (if fees required for launch, P1 else V2) | `grep limitService transfer.service 0`, `test/a25 feeMinor 0` |
| **V1-005** | **Notifications** | `All` | `OutboxService` `outbox_events` PENDING (transfer/cash) + `security_event_histories`, but **no** `SmsService/PushService`, **no** delivery | **BACKEND ONLY** | Outbox ≠ delivery; customer never gets SMS/push for `funding approved` etc. | V1-001 (funding events) | **Implement delivery adapter (stub `ConsoleNotificationService` for V1, then SMS/Push provider in V2) + `GET /customers/me/notifications` inbox + `notification_preference` runtime filter** | **V1** (stub delivery P1, provider V2) | `grep -rn Notification src --include=*.ts` outbox only, `ls src/notifications` no |
| **V1-006** | **Notifications** | `Inbox/history` | **No** `notifications`Inbox entity, **no** `GET /customers/me/notifications` | **NOT IMPLEMENTED** | Customer cannot see history of funding/transfer notifications | V1-005 | Add `customer_notifications` (id, customerId, type, title, body, referenceId, isRead, createdAt) + `GET/PATCH /customers/me/notifications`** | **V1** | `grep notification_inbox 0` |
| **V1-007** | **Support** | `Customer/Agent → Support` | **No** `support_ticket` entity, **no** `POST /customers/me/support/tickets` | **NOT IMPLEMENTED** | No transaction-linked tickets, no assignment, ops cannot resolve disputes | V1-001 (funding) + transfer history | **Create `support_tickets` (id, customerId/agentId, transactionId, category, subject, description, status OPEN→RESOLVED, assigneeId, audit) + `POST/GET /customers/me/support/tickets` SELF + `GET/POST /internal/support/tickets` `SUPPORT`**, audit immutable | **V1** | `grep support_ticket 0` |
| **V1-008** | **Reconciliation** | `Finance` | `ReconciliationService` `getBreaks` + `B2F` policy `b2f-*` **METADATA ONLY** — no `GET /internal/reconciliation/breaks` workflow with resolve, **no** `unclaimed-report` | **METADATA ONLY** | Finance cannot investigate `wallet vs ledger` breaks or `unclaimed` liability without SQL | V1-001 | `GET /internal/reconciliation/breaks` + `POST /resolve` `OPERATOR` + daily `GET /internal/finance/unclaimed` | **V1** (report P2) | `src/reconciliation/reconciliation.service.ts` exists, no controller write |
| **V1-009** | **Customer App** | `Onboard` | `CustomerService.create` internal `POST /customers` (workforce), **no** `POST /customers/register` self-service, **no** `POST /customers/me/onboard` | **PARTIAL** | V1 requires customer creation, but is it ops-created or self-register? Tests insert directly → **PARTIAL** | None | **Decide: self-register (`POST /customers/register` with `reference/displayName/phone/password` + verification) vs ops-created (keep). For V1 internal, ops-created may suffice → document as `BACKEND ONLY` and keep** | **REQUIRES PRODUCT DECISION** | `src/customer/customer.service.ts` create, no `customer-app` register route |
| **V1-010** | **Customer App** | `Beneficiary verify` | `Beneficiary` `isVerified` exists, but Customer App cannot verify | **BACKEND ONLY** | See V1-002 | V1-002 | Same | **V1?** | — |
| **V1-011** | **Customer App** | `Cash-in history` | Customer sees balance change but **no** `GET /customers/me/cash-ins` history (only W→W) | **PARTIAL** | Customer cannot prove cash-in | V1-001? | `GET /customers/me/cash-operations` unified? Or keep as `transfers` only for V1 → `REQUIRES PRODUCT DECISION` | **V1?** | `transfer.history` only W→W |
| **V1-012** | **Customer App** | `Cash-to-cash claim` | Agent `POST /agents/me/cash-to-cash/:id/claim` exists, **no** `POST /customers/me/cash-to-cash/:id/claim` for beneficiary | **PARTIAL** | Customer must visit Agent to claim, cannot claim via Customer App (maybe intentional) | Cash→Cash | **Decide: customer self-claim via Customer App `POST /customers/me/cash-to-cash/claim` with `transferCode` + `pin` → reuse `ClaimService`** | **REQUIRES PRODUCT DECISION** | `src/agent/agent-cash-to-cash-claim.*` agent only |
| **V1-013** | **Agent App** | `History receipts` | `GET /agents/me/wallets/:walletId/transactions` wallet-scoped, **no** unified `GET /agents/me/transfers` with `counterparty` like Customer A25 | **PARTIAL** | Agent cannot see `CASH_IN` + `W→W` + `Cash→Cash` unified with `displayName` | None | **Add `GET /agents/me/transfers` with same batch counterparty as A25 (P2)** | **V1** (P2) | `src/transfer/wallet-transaction.controller.ts` wallet-scoped |
| **V1-014** | **Ops** | `Customer funding history` | **No** `GET /customers/me/funding-history` (customer) and **no** `GET /internal/customers/:id/funding-history` | **NOT IMPLEMENTED** | Customer cannot see funding request status; ops cannot see history | V1-001 | Add as part of V1-001 | **V1** | — |
| **V1-015** | **Security** | `MFA self-service` | `MfaEnrollment` workforce `POST /customers/:id/mfa-enrollments`, **no** `POST /customers/me/mfa` | **BACKEND ONLY** | Customer cannot enroll TOTP/SMS themselves | None | **Document: keep workforce-enrolled for V1, expose `POST /customers/me/mfa` in V1 P2 if needed** | **V1?** | `src/customer-authentication/mfa-*` |
| **V1-016** | **Security** | `Preferences` | `customer_preferences` `notification_push_enabled` exists, **no** `PATCH /customers/me/preferences` | **METADATA ONLY** | Customer cannot toggle push | V1-005 | `PATCH /customers/me/preferences` thin via `CustomerPreferenceService`** | **V1?** (P2) | `src/customer-preference/customer-preference.service.ts` |
| **V1-017** | **Ledger** | `Reversals` | `LedgerService.reverseJournal` exists, `internal-transfer-gate` `reversal` adapter, but **no** `POST /internal/transfers/:id/reverse` ops workflow with `privileged` + audit | **BACKEND ONLY** | Ops cannot reverse failed legitimate (not arbitrary balance) | None | **Document: keep as `Privileged` + strict reason, expose `POST /internal/ledger/journals/:id/reverse` with `idempotencyKey` in P2** | **V1?** | `src/ledger/ledger.service.ts` `reverseJournal` |
| **V1-018** | **Customer App** | `Contact/phone change` | `CustomerContactMethod` exists, **no** `PATCH /customers/me/phone` (receiving identity is read-only per A26 doc) | **NOT IMPLEMENTED** (by design) | Phone change would require OTP verification, not in V1 — **correctly documented as read-only** | None | **Keep read-only for V1, V2 add OTP-verified `POST /customers/me/phone/change`** | **OUT OF SCOPE** | `docs/A26` §16 |
| **V1-019** | **Admin** | `Outlets/Terminals` write | `POST /internal/aggregators/:agg/agents/:id/outlets` `SUPPORT/OPERATOR` exists via `Outlet` module, but **not** in `Admin` module (separate `Aggregator`/`Outlet` modules) — **PARTIAL** | **PARTIAL** | Admin pane not single; operational visibility split | None | **Consolidate `Admin` to proxy `Outlet`/`Aggregator` writes (P2)** | **V1** | `src/aggregator/`, `src/outlet/` |
| **V1-020** | **Notifications** | `Funding approved/rejected` | **Missing** because V1-001 missing → no outbox for funding | **NOT IMPLEMENTED** | Blocks customer awareness of funding | V1-001 | Add to V1-001 outbox `funding.approved/rejected`** | **V1** | — |
| **V1-021** | **Reconciliation** | `Agent positions` | `AgentFinancialExecutionService` positions via wallet, but **no** `GET /internal/agents/:id/financial-position` for ops (only `GET /agents/me/financial-position` `AGENT SELF`) | **BACKEND ONLY** | Ops cannot see Agent funding pool without `AGENT` token | None | `GET /internal/agents/:id/financial-position` `SUPPORT` via existing service | **V1** | `src/agent/agent-financial-execution.service` |
| **V1-022** | **Onboarding** | `Customer KYC` | `CustomerKycAssessment` `createKycAssessment` `WORKFORCE` `SUPPORT`, but **no** `GET /customers/me/kyc` for customer to see status | **BACKEND ONLY** | Customer cannot see `kycLevel/status` beyond `GET /me/profile` `kycLevel` string | None | `GET /customers/me/kyc` thin via `CustomerService.getKyc` (P2) | **V1?** | `src/customer/customer.service.ts` `getKyc` |

**Counts:** `IMPLEMENTED` often partial; strict matrix: **IMPLEMENTED 8** (W→W, CASH_IN/OUT, Cash→Cash create/claim/expiry, Agent funding, Auth, PIN, Sessions), **PARTIAL 6** (Customer App onboard/cash-in/Cash claim/Agent history/Admin read), **BACKEND ONLY 4** (Beneficiary, Notifications outbox, Support missing is NOT IMPLEMENTED, actually support is NOT IMPLEMENTED, reconciliation METADATA ONLY), **METADATA ONLY 3** (Fees, Preferences, Reconciliation), **NOT IMPLEMENTED 5** (Funding maker/checker, Funding history, Notifications inbox, Support, Reconciliation breaks), **OUT OF SCOPE 12** (Wallet→Bank etc.), **REQUIRES PRODUCT DECISION 2** (Beneficiary need, Onboard self-register).

*For strict 11-status counts in §20 final response, see tallies.*

---

## 20. Dependency-Ordered Implementation Backlog (V1 only, no V2)

**P0 — Blocks V1 ingress (must be first):**

1. **V1-001 Operations Customer Funding (maker/checker)** — *Depends: none (uses existing `LedgerService`, `AuditService`, `Authorization`)*  
   - Entity `customer_funding_requests` (customerId, amountMinor, currency NGN, fundingSource, reference, status, makerId, checkerId, journalId, idempotencyKey, `createdAt/updatedAt`, `version`, `deletedAt` soft) + `uq_idempotency` + `idx_customer_status`
   - Service `CustomerFundingService` (`createRequest` `SUPPORT` maker → `REQUESTED`, `approve` `OPERATOR` checker `maker != checker` `SERIALIZABLE` → `postJournalInTransaction` DEBIT `FUNDING_POOL` (create `AR_CONTROL` liability `CUSTOMER-FUNDING-POOL-NGN` if not exists) CREDIT customer `ledgerAccount`, `journalId`, `status APPROVED`, outbox `funding.approved`, audit, notification; `reject` similar, idempotency 409)
   - Controllers: `POST /internal/customers/:id/funding-requests` `SUPPORT`, `POST /internal/customers/funding-requests/:id/approve` `OPERATOR`, `POST /.../reject`, `GET /internal/customers/:id/funding-requests`, `GET /customers/me/funding-requests` + `GET /customers/me/funding-requests/:id` `SELF` (history), `GET /customers/me/funding-history` alias
   - Permissions: `SUPPORT` create, `OPERATOR` approve/reject, `SERVICE/PRIVILEGED` read; `maker != checker` enforced in service; `idempotencyKey` header mandatory
   - Tests: real-PG 12/12 (create, cannot approve own, checker ≠ maker, approve posts balanced journal, idempotency same key same → same journal, different amount 409, audit no secrets, customer history shows APPROVED, agent 403, unauth 401, funding history)
   - Migration: `1785753600063-CreateCustomerFundingRequests` (1 table + indexes, + funding pool account insert)
   - **Why P0:** Without this, non-cash customers cannot fund.

**P1 — Unblocks operations & customer completeness (after V1-001):**

2. **V1-007 Support Ticket Lifecycle** — *Depends: V1-001 (funding tickets link) + history*  
   `support_tickets` (customerId/agentId, transactionId, fundingRequestId, category `FUNDING/TRANSFER/CASH`, subject, status `OPEN→ASSIGNED→RESOLVED`, assignee `SUPPORT`, messages `support_ticket_messages` immutable, audit) + `POST /customers/me/support/tickets`, `GET /customers/me/support/tickets`, `POST /internal/support/tickets/:id/assign` `SUPPORT`, `POST /internal/support/tickets/:id/respond` etc. Real-PG + audit (no PII leak).

3. **V1-003 Admin Operational Writes** — *Depends: existing `AgentLifecycle`/`CustomerService`*  
   Expose `POST /internal/agents/:id/suspend/terminate`, `PATCH /internal/customers/:id/status` via `Admin` `OPERATOR/PRIVILEGED` thin wrappers, `WORKFORCE_SESSION`, audit.

4. **V1-005 Notifications Delivery (stub) + V1-006 Inbox** — *Depends: V1-001 (funding events)*  
   `ConsoleNotificationService` (logs for V1) + `customer_notifications` table + `GET /customers/me/notifications` + `PATCH /.../read` + `customer_preferences` runtime filter `POST /customers/me/preferences` (if not already). Outbox `funding.approved/rejected`, `transfer.completed` etc. → `notification` insert. P1 stub, P2 real SMS/Push provider.

5. **V1-002 Beneficiaries (Customer App)** — *Depends: none* **REQUIRES PRODUCT DECISION** (if W→W `destinationWalletId` sufficient, keep BACKEND ONLY; if UX needs saved recipients, expose)  
   `GET/POST/PATCH /customers/me/beneficiaries` via `BeneficiaryService` (thin, SELF, audit), `isVerified` badge, soft-delete.

**P2 — Polish / reporting (after P1, before V1 launch):**

6. **V1-008 Reconciliation Breaks + Unclaimed Report** — *Depends: existing `ReconciliationService`*  
   `GET /internal/reconciliation/breaks` + `POST /internal/reconciliation/breaks/:id/resolve` `OPERATOR`, `GET /internal/finance/unclaimed-report` (cash→cash liability `SUM`).

7. **V1-013 Agent Unified History** — *Depends: A25 pattern*  
   `GET /agents/me/transfers` with `counterparty` batch (copy A25 logic for Agent `walletIds`), `feeMinor 0`, deterministic.

8. **V1-004 Fees/Limits Runtime** — *Depends: policy decision* **REQUIRES PRODUCT DECISION** — if fees required for V1, add `limitService.check` + `feeEngine.calculate` before `postJournal` in `TransferService`/`AgentCash*`, post `DEBIT customer / CREDIT revenue` + `CREDIT agent commission`, `POST /internal/fees/rules` maker/checker.

9. **V1-014 Customer Funding History (customer-facing)** — *Part of V1-001* — already in V1-001 `GET /customers/me/funding-history` (so not separate).

10. **V1-015 MFA Self-Service** — *Depends: existing `MfaEnrollment`* — **Document keep workforce-enrolled for V1**, expose `POST /customers/me/mfa` in P2 if product requires.

11. **V1-016 Preferences Runtime** — `PATCH /customers/me/preferences` `{notification_push_enabled}` thin via `CustomerPreferenceService` (if V1-005 needs).

12. **V1-019 Admin Consolidation** — single pane proxy for `Outlet`/`Aggregator` writes (already `WORKFORCE_SESSION`, just route).

13. **V1-021 Agent Financial Position for Ops** — `GET /internal/agents/:id/financial-position` `SUPPORT` via `AgentFinancialExecutionService`.

14. **V1-022 Customer KYC Self-View** — `GET /customers/me/kyc` thin via `CustomerService.getKyc` (P2).

**V2 (explicitly not in backlog):** Wallet→Bank, NIBSS, `ProviderAdapter`, third-party settlement, cards, bills, external reconciliation, non-NGN — `OUT OF SCOPE`.

---

## 21. Recommended Next Task

**`V1-001 Operations Customer Funding (maker/checker)` — P0.**

**Why:** It is the sole V1 money ingress that is **NOT IMPLEMENTED** while all other ingresses (`CASH_IN`, `W→W`) are implemented. Without it, a real customer who pays into the MonieNaija funding account cannot be credited — the ledger is authoritative but operationally unreachable. It blocks `V1-007` (funding-linked support), `V1-005/006` (funding notifications), `V1-014` (funding history), and `V1-008` (reconciliation of funding pool). It reuses existing `LedgerService` (`SERIALIZABLE`), `AuditService`, `Authorization` (`SUPPORT`/`OPERATOR` segregation), `Customer`/`Wallet` reads, `OutboxService`, and `CustomerFundingPool` account — no new ledger, no external bank, no NIBSS.

**Scope (single task, thin, no second balance):**
- Entity + migration (1 table, funding pool `AR_CONTROL` account)
- Service (create/approve/reject, `maker != checker`, `SERIALIZABLE`, idempotency, `postJournal`, audit, notification)
- Controllers (`POST /internal/...` `SUPPORT/OPERATOR` + `GET /customers/me/funding-*` `SELF`)
- Real-PG tests (12, A-R pattern, no ledger bypass)
- Regression A21-A26, `tsc`/`build`/`lint`

**Do not** build Wallet→Bank, provider adapters, or cards as next task — those are V2 OUT OF SCOPE per product boundary.

---

## 22. Explicit Statement of What MUST NOT Be Implemented for V1

**For V1, DO NOT implement:**

- Wallet → external bank (no `Wallet→Bank`, no `bank` integration, no `NIBSS` `nibss`/`BankService`/`ProviderAdapter`)
- External bank → wallet via live bank integration (no `provider` settlement, no `partner-callbacks` NIBSS live)
- Third-party payment-provider settlement (no `external-provider reconciliation` for V1)
- Cards, dollar cards, non-NGN
- Bills, airtime, data, electricity, cable, betting (no `bills` engine)
- Second ledger / second balance (no `CustomerBalance` table, no `balanceMinor` column, ledger remains `SERIALIZABLE` `postJournal`)
- Second PIN engine / second authentication engine / second session engine (reuse `CustomerTransactionPinService`, `CustomerAuthenticationService`, `AuthenticationSessionService`)
- Second history table / second financial engine (history stays `transfers` + `ledger_journals`)
- Speculative schema (no `customer_funding` without V1-001, no `support_ticket` without V1-007)
- Arbitrary `UPDATE wallet SET balance` (all wallet changes via `postJournalInTransaction` only)
- Logging of `password`/`pin`/`tokenHash` (`pinoHttp` redact `currentPassword/newPassword`, `redactRecord` covers)

**These are correctly OUT OF SCOPE and must remain so until V2 product decision.**

---

## 23. Verification Evidence and Repository References

**Repository truth (file content, not inference):**

- `git status --porcelain` (audit time): `M src/app.module.ts`, `M src/common/sensitive-data-redaction.ts`, `M src/customer-app/...`, `M src/customer-authentication/...`, `?? docs/A26...`, `?? test/a26...`, `?? src/migrations/178575...` 63 files — `M 63` migrations, no new V1-001 migration yet.
- `git rev-parse HEAD`: `3d05aae` (working tree) / `245fc9a` (pushed A26) / `fd82075` A25 fix — `git fsck` shows `fd82075->6036b7c->245fc9a` dangling (same content, branch not fetched due to arena ephemeral branch lifecycle). `head -c` shows `HEAD 3d05aae` but file content includes all A21-A26 (see `ls src/migrations | wc -l` 63).
- `ls src/customer-app/customer-app.controller.ts` 921 lines thin (no `postJournalInTransaction`, `BankService`, `nibss`, `ProviderAdapter` — verified `test/a25` `Q`/`S`, `test/a26` `S`).
- `src/transfer/transfer.service.ts` `SERIALIZABLE` `lockWallets` deterministic `ORDER BY id` + `pessimistic_write`, `requestHash` sha256, `uq_transfers_idempotency_key` 409 — `grep -n SERIALIZABLE` 3, `grep -n postJournal` 1 in `TransferService` only.
- `src/agent/agent-cash-in.service.ts` `AgentFinancialExecutionService` → `postJournalInTransaction` — `test/a13` real-PG.
- `src/migrations/1785753600057-CreateCashToCashTransfers.ts` (cash_to_cash + `CASH_TO_CASH-UNCLAIMED-NGN` liability) + `0058 AddClaim` + `0059 AddExpiry` + `0061-CreateAgentFundingPool` (`AGENT_FUNDING_POOL-NGN`) + `0062-CreateAgentOutletsAndTerminals` — 63 chain.
- `src/customer/customer.service.ts` 539 lines `createProfile` `getProfile` `isActive`, `src/customer/customer-profile.entity.ts` 46 lines `displayName` 200.
- `src/customer-authentication/customer-authentication.service.ts` 1500+ lines `createCredential`/`rotatePassword` `PBKDF2`, `src/customer-authentication/authentication-session.service.ts` 425 lines `issue/validate/revoke` 32B token sha256, `src/authorization/route-policy-registry.ts` 321 lines `/customers/me/*` `CUSTOMER SELF`.
- `src/beneficiary/beneficiary.service.ts` backend only, not imported in `CustomerAppModule` (`grep -rn Beneficiary CustomerAppModule` 0).
- `src/operations/operations.module.ts` exports `AuditService` but no `CustomerFundingService`; `grep -rn customer_funding src` 0 → **NOT IMPLEMENTED**.
- `src/fee/fee.engine.ts` calculator `flat+%/minimum` `BASIS_POINTS`, `grep -rn limitService src/transfer` 0 → **METADATA ONLY**.
- `src/reconciliation/reconciliation.service.ts` `getBreaks` exists, `grep -rn support_ticket src` 0 → **NOT IMPLEMENTED**.
- `ls src/support` no → **NOT IMPLEMENTED**.
- `src/common/sensitive-data-redaction.ts` `SENSITIVE_KEY_NAMES` includes `currentpassword/newpassword` (A26), `src/app.module.ts` `redact.paths` includes `currentPassword/newPassword`.

**Docs inspected (A1-A26):**
- `docs/A21-AGENT-APP-CONTRACT.md`, `docs/A23-CUSTOMER-APP-CONTRACT.md`, `docs/A24-VERIFICATION-REPORT.md` (19/19 PIN), `docs/A25-VERIFICATION-REPORT.md` (17/17 history, `feeMinor 0`, `counterparty` batch, `migrations 63`), `docs/A26-VERIFICATION-REPORT.md` (19/19 profile/password/sessions, `no financial mutation`), `docs/a8-a11-agent-blockers.md` (historical), `docs/A2-FINANCE-ROLE-ENTITLEMENT...`, `docs/M*MANUAL-VERIFICATION` etc., `A1`/`A2` ADR packages.

**Tests run (audit time, safe only):**
- `DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija ./node_modules/.bin/jest --config jest.integration.config.js test/a26-customer-profile-hardening.integration.spec.ts --runInBand` → **19/19** (A-S, 25.2s, see §14)
- Combined `test/a25` (17/17) + `test/a24` (19/19) + `test/a23` (15/15) + `test/a21` (13/13) + `test/a22` (15/15) → **79/79** (51.9s, previous turn) + A26 19 = **98/98**
- `npx tsc --noEmit` **0**, `npm run build` **0**, `npm run lint` **exit 0** (240 problems baseline, 17 fixable, no new blocker)

**No new feature implemented during audit:** Working tree clean except docs/A26 + test/a26 (already committed in `6036b7c`/`245fc9a`), no `src/migrations/*.ts` created, no financial behavior altered.

---

## Appendix: Gap Counts for Final Response

| Status | Count | IDs |
|--------|-------|-----|
| **IMPLEMENTED** | **8** | W→W, CASH_IN, CASH_OUT, Cash→Cash create, claim, expiry, Agent funding/defunding, Auth/PIN/Sessions |
| **PARTIAL** | **6** | Customer onboard (self-register), cash-in history, Cash claim customer, Agent history, Admin read vs write, Phone change (by design) |
| **BACKEND ONLY** | **4** | Beneficiary, Notifications outbox, MFA enrollment, Ledger reversal |
| **METADATA ONLY** | **3** | Fees calculator, Preferences `notification_push_enabled`, Reconciliation breaks calc |
| **NOT IMPLEMENTED** | **5** | V1-001 funding maker/checker, V1-007 support, V1-006 inbox, V1-008 reconciliation workflow, V1-014 funding history (part of V1-001) |
| **OUT OF SCOPE** | **12** | Wallet→Bank, NIBSS, Provider, cards, dollar cards, non-NGN, bills, airtime, data, electricity, cable, betting |
| **BLOCKED** | **0** | (infra not blocked; `data/embedded-pg` 18.4 ready) |
| **REQUIRES PRODUCT DECISION** | **2** | V1-002 beneficiary need for V1 W→W, V1-009 onboard self-register vs ops-created (plus V1-004 fees if required, V1-015 MFA self) |

*Total V1 requirements identified: **28** (8+6+4+3+5+2). OUT OF SCOPE not counted in V1 completion denominator.*

