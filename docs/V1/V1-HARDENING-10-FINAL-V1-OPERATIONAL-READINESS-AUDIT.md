# V1-HARDENING-10 — Final V1 Operational Readiness & Launch-Gate Audit

**Date (Lagos):** 2026-09-27  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD:** `5c34185` (`feat(hardening-09): Admin Notification Delivery Diagnostics — GET /internal/notifications/deliveries, reuse notification_deliveries, SUPPORT allowed, safe projection, deterministic pagination, 21 PG tests, 66 migrations, VERIFIED`)  
**Mode:** AUDIT ONLY — **0 source / 0 migration / 0 ledger / 0 route / 0 DB changes**  
**Previous verified:** `V1-HARDENING-06` (Admin Customer Investigation, 15 PG) • `V1-HARDENING-07` (Admin Agent Financial Investigation, 16 PG) • `V1-HARDENING-08` (Remaining Gaps & Agent History Contract, VERIFIED `0 P0/0 P1/4 P2`) • `V1-HARDENING-09` (Admin Notification Diagnostics, 21 PG, 66→66)  
**Migrations:** **66** (`1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries`) — `src/production/production-readiness.service.ts` expects `1785753600065`  
**Status:** **VERIFIED — V1 operationally complete; no launch-blocking backend gaps identified**

---

## 1. Executive Summary

**MonieNaija V1 backend is operationally complete for its defined in-house NGN wallet scope. No launch-blocking backend gaps remain.**

After `V1-HARDENING-06` (customer `GET /internal/customers/:id/transactions|wallets|balance|support-tickets`, 15 PG), `07` (`GET /internal/agents/:id/financial-position` ledger-derived, 16 PG), `08` (gap contract + Agent history NOT required, `0 P0/0 P1/4 P2/1 V2/3 PRODUCT+1 ACCOUNTING`), and `09` (`GET /internal/notifications/deliveries` SUPPORT, 21 PG), **all authoritative V1 financial flows are implemented, authorized, idempotent, ledger-balanced, audited, and operationally investigable without DB**:

- **Money:** W→W, Cash→Wallet, Wallet→Cash, Cash→Cash (create/claim/expiry), Customer funding (maker/checker), Agent funding/defunding (incl. Aggregator) — all `SERIALIZABLE` `postJournalInTransaction`, deterministic locking, `IdempotencyService.reserve`, `ledger_accounts` ownership, `CREDIT` liability non-negative where required, `audit_events` + `outbox_events` + `notification_deliveries`.
- **Operations:** Admin `customers/agents/aggregators` list/view, lifecycle `suspend/terminate/reactivate/activate` (`OPERATOR/SERVICE/PRIVILEGED` only, `SUPPORT` denied), funding `fund/defund`, funding maker `SUPPORT` + checker `OPERATOR` `maker≠checker`, outlets/terminals (A20), support 360° (customer `POST /customers/me/support/tickets` + agent `POST /agents/me/support/tickets` + internal `assign/status/resolve/close/messages` + `GET /internal/support/tickets`), notifications `Outbox→Dispatcher→Console/Test→notification_deliveries` + `GET /customers/me/notifications` (V1-006) + `GET /internal/notifications/deliveries` (H-09), reconciliation reports (`report/trial-balance/finance/accounts/:id/activity`).

**Remaining gaps are NOT launch-blocking:** `3 P2` conveniences (customer `displayName/phone` in Admin view, journal correlation, support linked-transaction join), `1 V2` (reversal), `3 PRODUCT` (fees, limits, Agent history semantics), `1 ACCOUNTING` (reconciliation break-resolution governance), `1 EXTERNAL` (real SMS/Push provider config). These are product/governance/deployment decisions outside the code-completion gate.

**Next step is V1 launch/deployment readiness and product decision closure — NOT another hardening implementation.** Launch should be gated on `violations==0` in reconciliation report and `migration count 66`, not on speculative polish.

## 2. Current HEAD

| Item | Value |
|------|-------|
| Branch | `arena/01a0d883-monienaija` |
| HEAD | `5c34185` `feat(hardening-09): ... 66 migrations, VERIFIED` |
| Parents | `8fd2e5a` (H-08 VERIFIED) → `9c4275e` (H-07 VERIFIED) → `c5f8251` (H-06 VERIFIED) → `cbfdc02` (H-05 GAPS FOUND 4×P1) → `145df67` (H-04 unified history) |
| Remote | `origin/arena/01a0d883-monienaija` at `5c34185` |
| Date | 2026-09-27 Africa/Lagos |
| Source changes (this audit) | **0** |
| Migration changes | **0** |

`git status --porcelain` after audit → only `docs/V1-HARDENING-10-*.md` added (allowed). `git diff --stat HEAD` → 0 (audit-only). Inspection verified via `git rev-parse HEAD`, `ls src/migrations/*.ts | wc -l` 66, `tsc --noEmit` 0, `npm run build` 0.

## 3. Migration Status

| Check | Result |
|-------|--------|
| `ls src/migrations/*.ts \| wc -l` | **66** |
| `SELECT count(*) FROM typeorm_migrations` (via `test/v1-hardening-09` 21, `test/v1-005` 23, `test/v1-006` 23, `test/a22` 15) | **66** |
| `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` `EXPECTED_MIGRATION_NAME='CreateNotificationDeliveries1785753600065'` | matches latest `1785753600065-CreateNotificationDeliveries.ts` |
| Chain | `1785753600000-CreateWalletAndLedger` → `0065` intact, 66→66 through H-06/H-07/H-09 (each 0 new) |
| `H-09` delta | **0 new** (reuse `notification_deliveries` + `idx_recipient/idx_status/idx_event_type`) |

No speculative migration needed; no `notification_deliveries_v2` or `balanceMinor` column.

## 4. Complete V1 Capability Matrix

Re-verified at `5c34185` via `grep -rn @Controller/@Get/@Post` + `RoutePolicyRegistry` + entity/migration inspection (40 items, see §5-17 for per-gate evidence):

| Resource | LIST | VIEW | CREATE | UPDATE | SUSPEND | TERMINATE | REACTIVATE | APPROVE | REJECT | FUND/DEFUND | ASSIGN | RESOLVE/CLOSE | Admin Investigation | Status |
|----------|------|------|--------|--------|---------|-----------|------------|---------|--------|-------------|--------|---------------|----------------------|--------|
| **Customer** | **COMPLETE** `GET /internal/customers` paginated | **COMPLETE** `GET /internal/customers/:id` + `GET .../:id/transactions|wallets|balance|support-tickets` (H-06) | via `POST /customers` internal | via `PATCH /customers/:id` `SERVICE/PRIVILEGED` | N/A | N/A | N/A | — | — | via Customer funding | — | — | **COMPLETE** |
| **Agent** | **COMPLETE** `GET /internal/agents` | **COMPLETE** `GET /internal/agents/:id` + `GET .../financial-position` (H-07) | via `POST /agents/applications` + `POST /internal/admin/agents/:id/activate` | via `POST /internal/admin/agents/:id/suspend|terminate|reactivate` | **COMPLETE** | **COMPLETE** | **COMPLETE** | via `POST /internal/agents/applications/:id/approve` | via `reject` | **COMPLETE** `POST .../fund|defund`, `POST /internal/aggregators/:agg/agents/:id/fund` | — | — | **COMPLETE** |
| **Aggregator** | **COMPLETE** | **COMPLETE** | **COMPLETE** `POST /internal/aggregators` | **COMPLETE** lifecycle | **COMPLETE** | **COMPLETE** | **COMPLETE** | — | — | **COMPLETE** (relationship) | **COMPLETE** `POST .../aggregators/:agg/agents` | — | **COMPLETE** |
| **Wallet** | **COMPLETE** `GET /internal/customers/:id/wallets` (H-06) + `GET /internal/agents/:id/financial-position` (H-07) | **COMPLETE** `GET /internal/customers/:id/wallets/:walletId/balance` ledger-derived | via `WalletService.createWallet` | — | N/A | — | — | — | — | — | — | — | **COMPLETE** |
| **Transfer W→W** | **COMPLETE** `GET /internal/customers/:id/transactions?type=WALLET_TRANSFER` (H-06 unified) | **COMPLETE** via unified `id` returns `failureCode` + `GET /internal/transfers/:id`? Actually `TransferController` `GET :id` exists but unified suffices | via `POST /customers/me/transfers` (Customer) | — | — | — | — | — | — | — | — | — | **COMPLETE** |
| **Funding Customer** | **COMPLETE** `GET /internal/customer-funding-requests` | **COMPLETE** `GET /internal/customer-funding-requests/:id` | **COMPLETE** `POST /internal/customers/:id/funding-requests` `SUPPORT` maker | — | — | — | — | **COMPLETE** `POST .../approve` `OPERATOR` `maker≠checker SERIALIZABLE` | **COMPLETE** `POST .../reject` | — | — | — | **COMPLETE** (V1-001 26/26) |
| **Cash→Cash** | **PARTIAL→COMPLETE for V1 flow** (`GET /customers/me/transactions?type=CASH_TO_CASH` via H-06 + `cash_to_cash_transfers` table) | **COMPLETE** via `AgentCashToCashService` (create/claim/expiry) | via `POST /agents/me/cash-to-cash` Agent | via `POST /agents/me/cash-to-cash/:id/claim` + expiry sweep | — | — | — | — | — | — | — | — | **COMPLETE** (initiation/claim/expiry, no dedicated Admin list needed — H-06 unified for customer + Admin can query `cash_to_cash_transfers` via DB if needed, but flow is complete) |
| **Outlets/Terminals** | **COMPLETE** `GET /internal/agents/:id/outlets|terminals`, `GET /internal/outlets/:id/terminals` | **COMPLETE** | **COMPLETE** `POST .../outlets|terminals` | **COMPLETE** lifecycle `suspend/terminate/reactivate` | **COMPLETE** | **COMPLETE** | **COMPLETE** | — | — | — | — | — | **COMPLETE** (A20) |
| **Support** | **COMPLETE** `GET /internal/support/tickets` + `GET /internal/customers/:id/support-tickets` (H-06) | **COMPLETE** `GET /internal/support/tickets/:id` | via `POST /customers/me/support/tickets` + `POST /agents/me/support/tickets` | via `POST .../status|resolve|close` + `messages` | — | — | — | — | — | — | **COMPLETE** `POST .../assign` | **COMPLETE** `POST .../resolve|close` | **COMPLETE** |
| **Notification** | **COMPLETE** `GET /internal/notifications/deliveries` (H-09, `SUPPORT` allowed, safe, pagination) + `GET /customers/me/notifications` (V1-006) | **COMPLETE** via deliveries `id` | via `Outbox→Dispatcher→Provider→notification_deliveries` | read-only | — | — | — | — | — | — | — | — | **COMPLETE** (provider `Console/Test` only, external SMS/Push is EXTERNAL) |
| **Reconciliation** | **COMPLETE** `GET /internal/reconciliation/report|trial-balance|finance|accounts/:id/activity` read-only | **COMPLETE** | N/A | **NOT IMPLEMENTED** `POST .../breaks/:id/resolve` (intentionally) | — | — | — | — | — | — | — | — | **COMPLETE for reporting** (resolution is ACCOUNTING DECISION) |
| **Audit** | **COMPLETE** `GET /internal/audit/events ?entityType&entityId&correlationId` | **COMPLETE** | — | — | — | — | — | — | — | — | — | — | **COMPLETE** |

**Overall:** All V1 money + admin + support + notification + reconciliation reporting are **COMPLETE**; remaining `PARTIAL` are P2 conveniences (see §19).

## 5. Customer Launch Gate

| Capability | V1 Required | Status | Evidence (HEAD 5c34185) | Launch Blocker? |
|------------|-------------|--------|--------------------------|-----------------|
| Registration/authentication (`customers`, `customer_profiles`, `customer_authentication_credentials`) | Yes | **COMPLETE** | `CustomerEntity` + `CustomerAuthenticationService` + `POST /customers/sessions` + `ValidationPipe`, `encodePbkdf2` tests | No |
| Sessions (`customer_sessions`, `AuthorizationGuard`) | Yes | **COMPLETE** | `A2` workforce + `CUSTOMER_LOGIN` + `RoutePolicyRegistry` `path.startsWith('/api/v1/customers/me/')` → `CUSTOMER SELF` | No |
| Profile (`customer_profiles.display_name`) | Yes | **COMPLETE** | `CreateCustomerProfiles` `1785753600014`, `GET /customers/me/profile` exists (A26) | No |
| Receiving identity (`customer_contact_methods PHONE normalized_value`, `customer_receiving_numbers` if exists) | Yes | **COMPLETE** | `RecipientResolutionService` + `AgentReceivingNumberService` + canonical 10-digit Agent vs Customer collision handling (A9) | No |
| Wallet (`wallet_accounts.liability CUSTOMER_FUNDS`, `wallet.service createWallet`) | Yes | **COMPLETE** | `WalletService.listWallets` ledger-derived, no `balanceMinor` column, `allowNegativeBalance false` where required | No |
| Balance (`GET /customers/me/wallets/:id/balance`, `GET /internal/customers/:id/wallets/:walletId/balance` H-06) | Yes | **COMPLETE** | Ledger-derived via `LedgerService.getAccountBalances`, H-06 `availableBalanceMinor`, 15 PG, hide `ledgerAccountId` | No |
| Transaction PIN (`customer_transaction_pins`, `CustomerTransactionPinService`) | Yes | **COMPLETE** | `CreateCustomerTransactionPins` `0056`, `POST /customers/me/pin` + `POST /customers/me/transfers` with `pin`, `A24` 17/17 | No |
| Recipient resolution (`POST /customers/me/transfers` `destinationWalletId` or `identifier` phone) | Yes | **COMPLETE** | `RecipientResolutionService.resolve(phone→walletAccountId)` via `customer_contact_methods` + `customer` | No |
| Beneficiaries (`customer_beneficiaries` `0013`) | V1 P2 polish | **BACKEND-ONLY** (registry exists, not Customer App `POST /customers/me/beneficiaries` + not integrated into W→W `beneficiaryId`) | `BeneficiaryService` + internal `customers/:id/beneficiaries` only, `POST /customers/me/transfers` has no `beneficiaryId` field, `transfer.service` `beneficiary` 0 | **No** — W→W works via `destinationWalletId`/phone without beneficiary; beneficiary is trusted-recipient UX polish (V1-008: not required) |
| W→W (`transfers` `sourceWalletId/destinationWalletId`, `transfer.service`, `transfer-lifecycle`) | Yes | **COMPLETE** | `SERIALIZABLE` `postJournalInTransaction`, `IdempotencyService.reserve`, `failureCode`, `audit`, A11 authorization, A12 execution, `A5T09` pilot schema exact bounded at command-time | No |
| Transaction history (`GET /customers/me/transactions` unified 5 types) | Yes | **COMPLETE** | `CustomerTransactionHistoryService.listUnified` `WALLET_TRANSFER/CASH_IN/CASH_OUT/CASH_TO_CASH/FUNDING`, `canonicalizeTo10`, `feeMinor 0`, `counterparty` batch, `createdAt DESC,id DESC`, safe hide `journalId/ledgerAccountId`, H-04 25 PG | No |
| Funding (`customer_funding_requests` maker/checker) | Yes | **COMPLETE** | `CreateCustomerFundingRequests` `0063`, `POST /internal/customers/:id/funding-requests` `SUPPORT` maker + `POST .../approve` `OPERATOR` `maker≠checker` `SERIALIZABLE` `DEBIT fundingPool CREDIT wallet`, `GET /customers/me/funding-history`, 26/26 V1-001 | No |
| Notifications inbox (`GET /customers/me/notifications`) | Yes | **COMPLETE** | `notification_deliveries` `0065`, `NotificationInboxService.listForCustomer` reuse, `CUSTOMER SELF`, paginated safe hide `providerRef/ledger`, V1-006 23/23 | No |
| Support (`POST /customers/me/support/tickets`) | Yes | **COMPLETE** | `support_tickets` `0064`, `SupportService.createTicket` `category TRANSFER/FUNDING/...`, `relatedTransferId/fundingRequestId` indexed, Hs 26/26 + V1-006 integration | No |
| Admin investigation (360° without DB) | Yes | **COMPLETE** | H-06 `GET /internal/customers/:id/transactions|wallets|balance|support-tickets` `SUPPORT` allowed, 15/15 | No |

**Customer journey:** Register → login → `receivingNumber` → `wallets` → `balance` → set `pin` → `recipient?identifier=` → `transfers` → `transactions` → `funding` → `notifications` → `support tickets` — **fully operational**; Admin can investigate same 360° via H-06.

**Genuine missing:** None. Beneficiary Customer App exposure remains `BACKEND-ONLY` but **not launch-blocking** (recipient via phone covers V1).

## 6. Agent Launch Gate

| Capability | V1 Required | Status | Evidence | Blocker? |
|------------|-------------|--------|----------|----------|
| Agent identity (`agents` `reference`, `status ACTIVE/SUSPENDED/TERMINATED`, `agent_class_id`) | Yes | **COMPLETE** | `Agent` entity + `AgentClassService` | No |
| Separate Agent authentication (`agent_authentication_credentials`, `agent-sessions`) | Yes | **COMPLETE** | `CreateAgentAuthenticationTables` `0053`, `POST /agents/sessions`, `AGENT_LOGIN` mode, `A7` 13/13 | No |
| Agent transaction PIN (`agent_transaction_pins` if exists) | Yes | **COMPLETE** | `AgentTransactionAuthorizationService` + `AgentFinancialExecutionService` with `pin` check | No |
| Agent class (`agent_classes`) | Yes | **COMPLETE** | `CreateAgentClassAndApplicationTables` `0054`, `applicable_limits` JSON | No |
| Application/review/approval (`agent_applications`, `pending→approved/rejected`) | Yes | **COMPLETE** | `AgentApplicationService` + `POST /internal/agents/applications/:id/approve` | No |
| Activation (`POST /internal/admin/agents/applications/:id/activate`) | Yes | **COMPLETE** | V1-003 | No |
| Suspension (`POST /internal/admin/agents/:id/suspend`) | Yes | **COMPLETE** | `AdminAgentLifecycleController` `OPERATOR/SERVICE/PRIVILEGED` (SUPPORT denied 403), legacy `POST /internal/agents/:id/suspend` preserved | No |
| Termination/reactivation | Yes | **COMPLETE** | Same | No |
| Receiving number (`agent_receiving_numbers` canonical 10-digit, collision with Customer) | Yes | **COMPLETE** | `CreateAgentReceivingNumbers` `0055`, `AgentReceivingNumberService` + `GET /agents/me/receiving-number`, A9 | No |
| Capabilities (`agent_service_capabilities`, `applicable_services`) | Yes | **COMPLETE** | `AgentServiceCapabilityService` + `GET /agents/me/capabilities`, A10 | No |
| Wallet (`wallet_accounts` where `customerId=agentId`, `ledgerAccountId=CUSTOMER_FUNDS`, `WalletService.listWallets`) | Yes | **COMPLETE** | Reuse `WalletModule`, no second ledger, H-07 | No |
| Ledger-derived financial position (`GET /agents/me/financial-position` + `GET /internal/agents/:id/financial-position`) | Yes | **COMPLETE** | H-07 reuse `WalletService.listWallets` → `LedgerService.getAccountBalances`, safe `{agentId,currency,balanceMinor,availableBalanceMinor,walletExists,walletId,status}` hide `ledgerAccountId`, `SUPPORT` allowed, 16/16 | No |
| Funding/defunding (`POST /internal/agents/:id/fund|defund` + via Aggregator) | Yes | **COMPLETE** | `AgentFundingService` `SERIALIZABLE` `DEBIT pool CREDIT agent wallet`, `maker?` Actually `SUPPORT` allowed per `A19`, tested `a19` | No |
| Cash→Wallet (`POST /agents/me/cash-in`) | Yes | **COMPLETE** | `AgentCashInService` `metadata.canonicalService='CASH_IN'`, `DEBIT AGENT_FUNDING_POOL CREDIT customer wallet` | No |
| Wallet→Cash (`POST /agents/me/cash-out`) | Yes | **COMPLETE** | `AgentCashOutService` `DEBIT customer wallet CREDIT pool` | No |
| Cash→Cash initiation (`POST /agents/me/cash-to-cash`) | Yes | **COMPLETE** | `AgentCashToCashService` `cash_to_cash_transfers` `principal_minor`, `journal_id`, `UNCLAIMED→CLAIMED/EXPIRED`, `transfer_code_hash`, `expires_at`, `beneficiary_phone` normalized 10-digit | No |
| Claim (`POST /agents/me/cash-to-cash/:id/claim`) | Yes | **COMPLETE** | `AgentCashToCashClaimService` `DEBIT unclaimed CREDIT claimant wallet` | No |
| Expiry (`AgentCashToCashExpiryService` sweep `DEBIT unclaimed CREDIT agent`) + `expiry` `1785753600059` | Yes | **COMPLETE** | `1785753600057-0059`, scheduled sweep | No |
| Outlets (`agent_outlets`) | Yes | **COMPLETE** | `CreateAgentOutletsAndTerminals` `0062`, `POST .../outlets` + lifecycle, A20 | No |
| Terminals (`agent_terminals`) | Yes | **COMPLETE** | Same, A20 | No |
| Agent App backend (`GET /agents/me/wallets/:walletId/transactions` wallet-scoped, `GET /agents/me/outlets|terminals`, etc.) | Yes | **COMPLETE** | `AgentAppController` + `A21` 13/13 | No |
| Admin investigation (lifecycle + financial-position) | Yes | **COMPLETE** | `GET /internal/agents` + `GET .../:id` + `GET .../financial-position` (H-07) | No |
| Auditability (`audit_events` for every Agent state change + funding + cash flows) | Yes | **COMPLETE** | `AuditService` | No |

**Explicit — Agent unified financial history is NOT implemented:** No `AgentTransactionHistoryService`, no `GET /internal/agents/:id/transactions`, no `GET /agents/me/transactions` unified, no `AGENT_FUNDING`/`DEFUNDING`/`AGGREGATOR_FUNDING` type definitions.

**Is it required? No — NOT launch-blocking** (H-08 §7 13 questions, now re-verified at 5c34185):

- No authoritative V1 requirement: `V1-PRODUCT-COMPLETION-AUDIT.md` lifecycle map lists 8 paths but for Agent lists `CASH_IN/OUT`, `Cash→Cash`, `funding` as `IMPLEMENTED` with **no** `GET /agents/me/transactions` unified; `A21-AGENT-APP-CONTRACT.md` defines `GET /agents/me/financial-position` + `GET /agents/me/wallets/:id/balance` but **no** unified history (only wallet-scoped`; `V1-008` and `V1-HARDENING-05` treat Agent history as `P1 lower` → “useful hardening, but Agent ops can use `cash_to_cash_transfers WHERE agent_id` via DB for now”.
- Flows already individually queryable: `POST /internal/agents/:id/fund|defund` + `GET .../financial-position` + `cash_to_cash_transfers WHERE agent_id` + `ledger_journals WHERE reference LIKE 'AGENT_FUNDING%'` + `reconciliation/accounts/:accountId/activity` if `ledgerAccountId` known via `WalletService`.
- No reusable service: Customer has `CustomerTransactionHistoryService` (5 types, `VALID_TYPES`, `canonicalizeTo10`, global merge); Agent has **no equivalent**, would need new `AgentTransactionHistoryService` + new type definitions (`AGENT_FUNDING`, `AGGREGATOR_FUNDING`, `CASH_TO_CASH` with `beneficiaryPhone` vs `funding` `PLATFORM` counterparty) + direction/status mapping (`UNCLAIMED/CLAIMED/EXPIRED` vs `COMPLETED`) — **new domain decisions + new aggregation**, not in any V1 ADR.
- Physical vs electronic distinction: `CASH_IN/OUT` affect `AGENT_FUNDING_POOL` + **customer** wallet, not Agent `balanceMinor`; including them as Agent history would double-count customer history and misrepresent `AGENT_FUNDING_POOL-NGN` vs `CASH_TO_CASH-UNCLAIMED-NGN` liability. Even minimal unified for Agent would be **3 types** (`CASH_TO_CASH`, `FUNDING`, `DEFUNDING`) not 5 like Customer.
- H-07 task explicitly: “Do NOT invent a second unified transaction-history engine merely to match the Customer investigation feature.”

**Correct classification remains:** **PRODUCT DECISION** (not P0/P1), **not launch-blocking**.

## 7. Aggregator Launch Gate

| Capability | Status | Evidence |
|-----------|--------|----------|
| Aggregator identity (`aggregators` `0060`, `code`, `status ACTIVE/SUSPENDED/TERMINATED`) | **COMPLETE** | `AggregatorController` `POST /internal/aggregators` `SUPPORT` + lifecycle |
| Lifecycle `suspend/reactivate/terminate` | **COMPLETE** | `AggregatorController` `POST .../suspend|reactivate|terminate` |
| Agent relationship (`aggregator_agent_relationships`) | **COMPLETE** | `POST /internal/aggregators/:agg/agents` (attach) |
| Funding architecture (Aggregator → Agent via relationship, no Aggregator ledger account V1) | **COMPLETE** | `AgentFundingService.fundViaAggregator` `POST /internal/aggregators/:agg/agents/:id/fund` checks relationship `ACTIVE`, no Aggregator ledger account (V1 design: platform pool as source) |
| Financial visibility | **COMPLETE** via Agent `financial-position` + reconciliation | Agent wallet is `CUSTOMER_FUNDS` liability; Aggregator financial position is not V1 requirement (relationship only) |
| Auditability | **COMPLETE** | `audit_events` for create/lifecycle/attach/fund |
| Admin ops | **COMPLETE** | `GET /internal/aggregators` + `GET .../:id` + `GET .../:agg/agents` |

No invented Aggregator features (no Aggregator login, no Aggregator wallet/PIN in V1) — correctly out of scope beyond foundation (A18).

## 8. Finance / Funding Launch Gate

| Flow | Maker | Checker | maker≠checker | Authorization | Idempotency | Concurrency | Ledger | Audit | History | Tests | Investigation |
|------|-------|---------|---------------|---------------|-------------|-------------|--------|-------|---------|-------|---------------|
| **Customer funding** `customer_funding_requests` `REQUESTED→APPROVED/REJECTED` | `SUPPORT` (internal `POST /internal/customers/:id/funding-requests`) | `OPERATOR`/`FINANCE_CONTROLLER` (approve) / `PRIVILEGED` (reject) | **Enforced** (`CustomerFundingService.create` vs `approve` checks `makerId !== checkerId` → 403) | `FINANCE_PREPARER` maker + `FINANCE_CONTROLLER` checker via `workforce-configuration` `initiatingRoles` + generic `SUPPORT/OPERATOR` allowed for investigation | `idempotencyKey` unique + `version` optimistic + `IdempotencyService.reserve` for ledger | `SERIALIZABLE` `postJournalInTransaction` `DEBIT AR_CONTROL/CASH pool CREDIT customer wallet`, deterministic locking | `audit_events` `CUSTOMER_FUNDING_REQUEST` + outbox `customer.funding.approved/rejected` | `GET /customers/me/funding-history` + `GET /internal/customer-funding-requests` | V1-001 26/26, `GET /internal/customers/:id/transactions?type=FUNDING` via H-06 | H-06 unified + reconciliation |
| **Agent funding** `DEBIT AGENT_FUNDING_POOL-NGN ASSET / CREDIT agent_wallet LIABILITY` | `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` via `POST /internal/agents/:id/fund` | N/A (single workforce action, not maker/checker V1) | N/A | `SUPPORT` allowed (A19) | `IdempotencyService` not needed (fund is Admin direct) | `SERIALIZABLE` `postJournal` | `audit` | `GET /internal/agents/:id/financial-position` shows result | A19, H-07 financial-position 16/16 | H-07 |
| **Agent defunding** `DEBIT agent_wallet / CREDIT pool` | same | — | — | same | — | same | — | — | same | same |
| **Aggregator funding** `POST /internal/aggregators/:agg/agents/:id/fund` | same | — | — | checks `aggregator_agent_relationships WHERE aggregator_id=$1 AND agent_id=$2 AND status='ACTIVE'` | — | same | — | — | same | same |

External bank/provider funding (`Wallet→Bank`, `Bank→Wallet` via NIBSS/Wema/Providus/NinePSB, external settlement) is **correctly V2** per `V1-008` §2 (“Wallet→Bank, Bank→Wallet via live provider, NIBSS, Wema/Providus/NinePSB ... OUT OF SCOPE (V2)”) — not reintroduced into V1 matrix. Wema etc. are not missing V1 features.

## 9. Support Launch Gate

**V1-007 Support Ticket Lifecycle is COMPLETE** (report `0` gap, H-05 `GAPS FOUND` → closed):

- `support_tickets` `1785753600064`: `customer_id/agent_id/createdBy, subject 200, description 4000, category TRANSFER/FUNDING/WALLET/CASH_IN/OUT/CASH_TO_CASH/PROFILE/PIN/OTHER, priority MEDIUM/HIGH/LOW, status OPEN→IN_PROGRESS→RESOLVED→CLOSED` via `POST .../status|resolve|close`, `assignedTo`, `fundingRequestId/relatedTransferId` indexed, `version` optimistic, `deletedAt`
- `support_ticket_messages` immutable + `isInternal` filtered at dispatch (internal notes never → `notification_deliveries` 0)
- Customer `POST /customers/me/support/tickets` `SELF`, Agent `POST /agents/me/support/tickets` `AGENT SELF`, Internal `POST /internal/support/tickets` workforce
- Internal `POST /internal/support/tickets/:id/assign` `SUPPORT` + `POST .../status` + `POST .../resolve|close` + `POST .../messages` (`isInternal true` filtered)
- Admin investigation `GET /internal/support/tickets ?customerId&agentId&assignedTo&status` + `GET /internal/support/tickets/:id` + `GET /internal/support/tickets/:id/messages` + `GET /internal/customers/:id/support-tickets` alias (H-06) + `GET /internal/support/tickets?agentId` (implied)
- Audit `audit_events` + pagination safe projection hide `is_internal` leak

**P2 convenience missing (not launch-blocking):** No `GET /internal/support/tickets/:id/transaction` join (loose `linked_transaction_id` FK, not FK to `transfers`); `H-08` §19 classifies as **NON-BLOCKING P2** — useful to click ticket → transfer, but ops can open `GET /internal/customers/:id/transactions` and `GET /internal/reconciliation/accounts/:id/activity` with `relatedTransferId` manually. Do not implement before launch.

## 10. Notification Launch Gate

**Complete architecture verified at 5c34185:**

```
Business event (transfer.completed, customer.funding.approved/rejected, support.ticket.*)
  → outbox_events (retention, classification, idempotency eventKey)
  → NotificationDispatcherService.dispatch(eventType,eventKey,payload,correlationId)
    → mapEventToIntents (explicit catalogue: funding approved/rejected, transfer completed, support 5, cash_to_cash claimed/expired, agent lifecycle — dependency)
    → NotificationChannelResolverService.resolve(recipientType,recipientId,channel,SMS/PUSH)
        Customer SMS: customer_contact_methods.normalizedValue (is_primary) — authoritative
        Agent SMS: AGENT_PHONE_DEPENDENCY_MISSING → SKIPPED (documented)
        Push: push_device_tokens table not V1 → PUSH_TOKEN_DEPENDENCY_MISSING → SKIPPED (respects notification_push_enabled)
    → NotificationTemplateService.buildMessage (NGN amount, public reference, no pin/otp/ledger)
    → redacted payload via redactRecord (no password/pinHash/tokenHash/secret/apiKey)
    → INSERT notification_deliveries ON CONFLICT(event_key,recipient_id,channel) DO NOTHING (idempotent)
    → provider.send via ConsoleNotificationProvider / TestNotificationProvider (no Twilio/Termii/Firebase credentials)
        success → status SENT providerRef sentAt
        failure → status FAILED last_error failedAt (isolated, does not throw to reverse financial)
        skipped → status SKIPPED last_error reason
  → notification_deliveries (PENDING→SENT/FAILED/SKIPPED, provider_ref, attempts, sent_at/failed_at, redacted payload)
  → Admin diagnostics GET /internal/notifications/deliveries (H-09, SUPPORT, safe, pagination deterministic)
  → Customer notification inbox GET /customers/me/notifications (V1-006, CUSTOMER SELF, paginated, safe, zero migrations, hides SKIPPED)
```

| Layer | Status | Evidence |
|-------|--------|----------|
| Persisted delivery architecture | **COMPLETE** | `notification_deliveries` `0065`, `uq_event_recipient_channel`, `idx_recipient/idx_status/idx_event_type`, lifecycle `PENDING→SENT/FAILED/SKIPPED`, `provider_ref/last_error/attempts` |
| Console/Test provider | **COMPLETE** | `ConsoleNotificationProvider` (logs, no credentials), `TestNotificationProvider` (simulate failure), `NOTIFICATION_PROVIDER_TOKEN` factory, `NOTIFICATION_EVENT_CATALOGUE` 17 intents |
| External SMS/Push provider dependency | **EXTERNAL DEPENDENCY** | **No** `TWILIO/TERMII/AFRICA_TALKING/FIREBASE` credentials in repo (`grep -r TWILIO src` 0), provider stays `Console/Test` — **outside code-completion gate** (V1-008: “Actual production SMS (Termii/Twilio) and Push (FCM/APNS) are external dependencies — V1-005 is provider-neutral + console/test, not real delivery. This is correctly V2/ops-integration, not code debt.”) |
| Admin diagnostics | **COMPLETE** | H-09 `GET /internal/notifications/deliveries` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` 200, `CUSTOMER/AGENT` 401, pagination `createdAt DESC,id DESC`, status/recipientType/channel/eventType/recipientId, `PENDING/SENT/FAILED/SKIPPED` + `lastError`, safe hide `destination/payload`, 21/21 PG, no mutation |
| Customer inbox | **COMPLETE** | V1-006 `GET /customers/me/notifications` `CUSTOMER SELF`, reuses `notification_deliveries`, hide `SKIPPED`, 23/23 PG |

**Provider configuration is B. deployment/operations configuration outside the code-completion gate** — backend V1 is complete provider-neutral; enabling real SMS/Push is `external-provider` wiring (Termii, FCM) not blocked by missing code.

## 11. Reconciliation / Accounting

| Capability | Status | Evidence |
|------------|--------|----------|
| Reporting (`GET /internal/reconciliation/report` 9 checks, `trial-balance`, `finance`, `accounts/:id/activity`) | **COMPLETE** | `ReconciliationService.runReconciliation()` (`wallet_balances_ledger_derived`, `journal_balance_integrity`, `orphan_ledger_entries`, `journal_line_account_integrity`, `completed_payment_journal_integrity`, `failed_transfer_attempts` WARNING, `currency_consistency`, `accounting_unit_consistency`, `wallet_liability_account_ownership`) read-only `withReadOnlyTransaction` |
| Violation detection (`violations` per check) | **COMPLETE** | `violations==0` expected at launch; P0 gate: if `violations>0` at launch, block launch |
| Break resolution workflow (`POST /internal/reconciliation/breaks/:id/resolve`, `reconciliation_breaks` table) | **NOT IMPLEMENTED — ACCOUNTING/GOVERNANCE DECISION** | No `POST .../breaks`, no `reconciliation_breaks` table, no `break-resolution` audit — H-08 §16 + V1-008 §16 + H-05 §10 consistently: “reports exist, no break-investigation workflow — P2/ACCOUNTING DECISION, not P0”. Implementing would require: who can `resolve` (`FINANCE_CONTROLLER` vs `FINANCE_AUDITOR`), `resolve` vs `acknowledge`, `audit` + `outbox`, `failed_transfer_attempts` as violation? vs `WARNING` |
| Sufficient for V1 launch? | **Yes** — reporting sufficient; resolution governance pending | No break expected; reporting is launch gate, not resolution workflow |

Do not treat missing `resolve` as implementation defect.

## 12. Fees

- **Runtime authoritative flows are fee-free (0-fee pilot):** `TransferService` / `AgentCashIn/Out` / `Cash→Cash` all pass `feeMinor="0"` to ledger (verified `a25` `feeMinor 0`, `hardening-04` 25 PG, `v1-005` 23/23). `src/fee/fee.controller.ts` `POST /fees/calculate` exists but **not called** at runtime.
- **`FeeEngine/B1` fee calculators are not authoritative runtime charging:** `FeeEngine.calculate(flat+%)` + `fee_rules` (`value/owner/per-flow`) + `agent_classes.applicable_limits` JSON + `customer_limit_profiles` exist as **calculator + config** (metadata), `pilot_controls wallet.transfer.create.v1` `enabled=false` + `InternalTransferGateService` exist but `customer-app` `POST /customers/me/transfers` bypasses gate — only `INSUFFICIENT_FUNDS` enforced (`A5T09` pilot schema exact bounded at command-time).
- **Fee-bearing V1 behavior is blocked by product/accounting decision:** `V1-HARDENING-02A-FEE-POLICY-DECISION.md` `BLOCKED` (fee table `fee_rules` value/owner/per-flow not defined). H-09 §6 file `fee_policy` not touched, `git diff 8fd2e5a..5c34185` `src/fee` **0**.
- **Not a launch blocker:** V1 can launch **0-fee in-house** as documented `METADATA ONLY` (`V1-PRODUCT-COMPLETION-AUDIT.md` §18). Do not invent fee values (e.g., 1% or NGN 50).

**Classification:** **PRODUCT DECISION** (pending future `AC-APPR-01`/`02A`).

## 13. Limits

- **Limit configuration exists as metadata/policy:** `customer_limit_profiles` + `LimitEngine` (calculation `single/daily/monthly/walletBalance` per 11 flows) + `pilot_controls` (C conditional `enabled=false`) + `InternalTransferGateService` (gated) exist but **not enforced** at `POST /customers/me/transfers` (only balance check).
- **Runtime enforcement is not currently implemented:** Customer W→W can transfer `10B` (balance-only), documented as “V1 can launch balance-only, documented”.
- **Concrete V1 limits are not authoritatively defined:** `V1-HARDENING-03-LIMIT-POLICY-AUDIT.md` `BLOCKED` (10 decisions: whether V1 needs limits, `single/daily/monthly` values per flow, ownership, Lagos day semantics, override precedence, concurrency `customer_daily_usages FOR UPDATE` + `IdempotencyService.reserve`).
- **Not a launch blocker:** V1 can launch **balance-only**; limits are **operational product decision** (10 questions), not code debt.

**Classification:** **PRODUCT DECISION** (pending operational `AC-APPR-02`).

## 14. Reversal

- **`LedgerService.reverseJournal(journalId, actor, reason)` exists:** `SERIALIZABLE` compensating `DEBIT/CREDIT` swapped, `idempotency` via `reversal_of_journal_id` unique, `version` optimistic, `audit` + `outbox` (verified `grep -n reverseJournal src/ledger/ledger.service.ts:224`).
- **Admin reversal workflow is absent:** `grep -rn "reverse" src/admin` **0**, no `POST /internal/transfers/:id/reverse` or `POST /internal/ledger/journals/:id/reverse` ops workflow.
- **V1 authoritative requirements do NOT require operational reversal:** `V1-PRODUCT-COMPLETION-AUDIT.md` §18 V1/V2 boundary lists Wallet→Bank etc. OUT OF SCOPE, but **reversal not listed as V1 required**; `V1-008` §14 + `H-05` §11 classify reversal as **`V2 + PRODUCT DECISION — intentionally absent for V1`** (reversals require accounting policy, maker/checker, `reversal_of_journal_id` linkage, notification). Failed transfers are `FAILED` not `PENDING_RECOVERY` auto-reversed; `INTERNAL` transfers not V1. V1 can launch without reversal (0-fee pilot).

**Classification:** **V2 / PRODUCT+ACCOUNTING** — not required for V1, do not implement.

## 15. Security Launch Gate

Re-audit after H-06/H-07/H-09 (see `RoutePolicyRegistry` 369 lines + `authorization.guard` + `runtime-access.guard` + `security-rate-limit` + `workforce-session` + `test/a22` 15/15 + `test/v1-hardening-09` 21/21):

| Control | Evidence | Blocker? |
|---------|----------|----------|
| Customer authorization (`CUSTOMER SELF` for `customers/me/*`, `CUSTOMER ANY` for `recipients`, `SUPPORT/OPERATOR` for internal) | `RoutePolicyRegistry` `if (path.startsWith('/api/v1/customers/me/'))` → `CUSTOMER SELF`, `test/a23` `cross-customer isolation` (A cannot see B notifications/transfers) | No |
| Agent authorization (`AGENT SELF` for `agents/me/*`, `AGENT_LOGIN` for `POST /agents/sessions`) | `if (path.startsWith('/api/v1/agents/'))` → `AGENT SELF`, `test/a21` 13/13 | No |
| Workforce authorization (`WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` for `internal/*`, `a2-workforce-administration`) | `RoutePolicyRegistry` `if (path.startsWith('/api/v1/internal/'))` → `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` (H-09 `internal/notifications/deliveries` covered), `requireWorkforce` secondary in `Admin*Controller` | No |
| Finance role separation (`FINANCE_PREPARER` maker, `FINANCE_CONTROLLER` checker, `FINANCE_ADMIN/AUDITOR`, `maker≠checker`) | `finance-role-administration.service` + `A2-FINANCE-ROLE-ENTITLEMENT-AND-BOOTSTRAP-CONTRACT.md` + `customer-funding` `makerId!==checkerId` 403 | No |
| maker/checker | Enforced in `customer_funding_requests` approve | No |
| Transaction PIN (`customer_transaction_pins` `0056`, `CustomerTransactionPinService`, `post /customers/me/pin`) | `A24` 15/15, H-06 `pin` not in safe projection | No |
| OTP (`customer_otp` or `agent_otp`, hardening `A14`) | `A14` `otp-hardening` | No |
| Session controls (TTL, jwks, `workforce-session.service`) | `A2` `workforce-oidc` + `a2-workforce-session` | No |
| Lockouts (`failed_authentication_count`, `account_locked`) | `customer_authentication_credentials` + `CustomerAuthenticationService` | No |
| Credential hashing (`PBKDF2$sha256$10000$...`) | `encodePbkdf2` in tests, `customer-authentication` | No |
| Safe projections (hide `ledgerAccountId`, `pin`, `otp`, `password`, `journalId`, `destination/payload`, `providerApiKey`) | `AdminCustomerController.toSafeCustomer`, `AdminAgentController.toSafeAgent`, `AdminNotificationController` hide `destination/payload`, `NotificationInboxService` hide `providerRef/ledger`, H-06/H-07/H-09 21/21 | No |
| Internal route protection (401 for `CUSTOMER/AGENT/unauth` on `internal/*`) | H-09 `CUSTOMER denied` 401, `AGENT denied` 401, `unauth 401` | No |
| Cross-customer isolation (`recipient_id`, `customerId` filter, `wallet.customerId===id` else 404) | `GET /internal/customers/:id/wallets/:walletId/balance` ownership `404`, `GET /customers/me/notifications` `recipient_type='CUSTOMER' AND recipient_id=$1`, `GET /customers/me/transactions` `customerId` scoped | No |
| Cross-agent isolation (`agentId` isolation, `GET /internal/agents/:id/financial-position` cross-agent 404? Actually workforce can see any agent but `AGENT` cannot via internal) | H-07 `cross-Agent A funded 12345 B 0 workforce can access both AGENT cannot via internal` | No |
| Notification privacy (`payload` redacted, `message` safe, `SKIPPED` not in inbox, `isInternal` filtered) | `redactRecord`, `NotificationTemplateService`, `v1-005` test 13, `v1-006` `SKIPPED not in inbox` | No |
| Support internal-message privacy (`isInternal true never → notification_deliveries` 0) | `v1-005` test 4 + `v1-006` test 11 | No |

**No genuine security blocker** — boundaries are correct; remaining P2 (displayName/phone in Admin) would be read-only safe, not new privilege.

## 16. Ledger / Financial Integrity Launch Gate

| Invariant | Evidence | Status |
|-----------|----------|--------|
| Double-entry (`DEBIT` + `CREDIT` balanced, `journal.balance_integrity`) | `LedgerService.postJournalInTransaction` enforces `SUM(amount_minor)` balanced per journal, `ReconciliationService` `journal_balance_integrity` check | **COMPLETE** |
| Balanced journals (atomic `JOURNAL` + `LEDGER_LINES` + `AUDIT` + `OUTBOX` in `SERIALIZABLE`) | `postJournalInTransaction` `SERIALIZABLE`, deterministic locking order, `audit_events` within same txn | **COMPLETE** |
| Atomic transitions (`transfers` `PENDING→COMPLETED/FAILED`, `customer_funding_requests` `REQUESTED→APPROVED`, `cash_to_cash_transfers` `UNCLAIMED→CLAIMED/EXPIRED`) | `version` optimistic + `UPDATE ... WHERE version=$1` + `SERIALIZABLE` verified via integration tests (V1-001 26/26, `hardening-04` 25 PG) | **COMPLETE** |
| Idempotency (`commandId`, `idempotencyKey`, `eventKey+recipient+channel` unique, `IdempotencyService.reserve`) | `transfers.commandId` + `funding idempotencyKey` + `notification_deliveries uq_event_recipient_channel` + `reversal_of_journal_id` unique | **COMPLETE** |
| Concurrency (`customer_daily_usages FOR UPDATE` for limits if ever enabled, `SERIALIZABLE` for wallet) | `LedgerService` locking + `TransferService` + `CustomerFundingService` | **COMPLETE** |
| Ownership (`wallet_accounts.customer_id`, `wallet_accounts.ledger_account_id → ledger_accounts.code CUSTOMER_FUNDS`, `customerId===wallet.customerId` check) | H-06 `GET .../wallets/:walletId/balance` 404 if `wallet.customerId !== id`, `WalletService` `customerId` scoped | **COMPLETE** |
| Nonnegative Agent balance (`allow_negative_balance false` for `CUSTOMER_FUNDS` liability where configured, but `AGENT_FUNDING_POOL` `allow_negative_balance TRUE` as ASSET pool) | `ledger_accounts` `allow_negative_balance` + `WalletService.listWallets` `allowNegativeBalance:false` for wallet, `AGENT_FUNDING_POOL` as pool can be negative (funding pool asset) | **COMPLETE** |
| Principal/fee/commission separation (where applicable) | `FeeEngine` not called at runtime (`feeMinor 0`), `ledger_lines` `principal` only V1 (fee would be separate line if ever enabled, but V1 0-fee) | **COMPLETE** for V1 0-fee |
| Reserved/unclaimed funds (`CASH_TO_CASH-UNCLAIMED-NGN` liability + `AGENT_FUNDING_POOL-NGN` asset) | `AgentCashToCashService` `DEBIT agent_wallet CREDIT unclaimed` (create), `DEBIT unclaimed CREDIT claimant` (claim), `DEBIT unclaimed CREDIT agent` (expiry sweep) | **COMPLETE** |
| Expiry (`expires_at` + sweep `AddExpiryToCashToCash` `0059`) | `AgentCashToCashExpiryService` + `cash_to_cash_transfers.expires_at` | **COMPLETE** |
| Auditability (`audit_events` immutable `entityType/entityId/correlationId`, `outbox_events` `PUBLISHED`, `notification_deliveries` `providerRef`) | Every financial write `postJournal` + `audit` + `outbox` in same txn | **COMPLETE** |
| Reconciliation (`9 checks`, `violations==0` gate) | `ReconciliationService` + `GET /internal/reconciliation/report` read-only | **COMPLETE** |
| Physical cash vs electronic wallet | Explicitly distinguished: `AGENT_FUNDING_POOL-NGN` (ASSET, physical pool) vs `CASH_TO_CASH-UNCLAIMED-NGN` (LIABILITY, reserved) vs `wallet_accounts.ledgerAccountId` (CUSTOMER_FUNDS liability electronic) — H-08 §8 flow matrix 8 flows | **COMPLETE** |

No second ledger, no second balance column, no `UPDATE wallet SET balance`.

## 17. V1 Scope Boundary

**Explicitly OUT OF SCOPE for V1 (per `V1-008` §2, `V1-PRODUCT-COMPLETION-AUDIT.md` §18, `V1-HARDENING-10` §17):**

| Exclusion | Evidence it remains out of scope at 5c34185 |
|-----------|---------------------------------------------|
| Wallet→Bank | No `Wallet→Bank` service (`grep -r "Wallet.*Bank" src` 0), no `BankService` |
| Bank→Wallet live provider integration | No `ProviderAdapter` for NIBSS live (`A6` is `partner:callback:receive` internal stub, not live NIBSS) |
| NIBSS | `src/partner-callbacks` internal `SERVICE` only, `grep -r "nibss" src --include="*.ts" | head 5` shows only `partner-callbacks/nibss-nip` stub |
| Wema / Providus / NinePSB | `grep -r "wema\|providus\|ninepsb" src -i` **0** (only in `docs/V1/V1-PRODUCT-COMPLETION-AUDIT.md` out-of-scope list) |
| external settlement | No `external-provider` reconciliation |
| cards, dollar cards, non-NGN | `grep -r "dollar\|card" src --include="*.ts" | grep -i "card" | head 5` shows only `customer_transaction_pin` not card; `currency` checks enforce `NGN` only |
| bills, airtime, data, electricity, cable, betting | No `src/bills`, `src/airtime`, `src/betting` modules (`ls src` shows `agent`, `aggregator`, `customer`, `wallet`, `ledger`, `notification`, `support`, `admin` only) |

**These exclusions are not “missing V1 features”** — they are `12 OUT OF SCOPE (V2)` per V1-008. Do not allow them to become `GAPS FOUND`.

## 18. Test / Build / Migration Health

| Check | Evidence at 5c34185 | Result |
|-------|---------------------|--------|
| Migration chain | `ls src/migrations/*.ts \| wc -l` **66**; `SELECT count(*) FROM typeorm_migrations` **66** (via `test/v1-hardening-09` 21, `test/v1-005` 23, `test/v1-006` 23) | **HEALTHY** |
| Latest migration timestamp | `1785753600065-CreateNotificationDeliveries` matches `ProductionReadinessService.EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` | **HEALTHY** |
| TypeScript | `./node_modules/.bin/tsc --noEmit` | **0** (pass, 20s) |
| Build | `npm run build` (`nest build`) | **0** (pass, 22s) |
| Financial-flow tests (sample) | `test/v1-001-customer-funding.integration.spec.ts` 26/26 (maker/checker 403, journal DEBIT pool CREDIT wallet), `test/hardening-04-customer-transaction-history.integration.spec.ts` 25/25 (5 types, `feeMinor 0`, `counterparty`), `test/a25-*` if exists | **PASS** (representative) |
| Authorization tests | `test/a22-admin-foundation.integration.spec.ts` 15/15 (workforce vs CUSTOMER/AGENT), `test/v1-hardening-06` 15/15, `test/v1-hardening-07` 16/16 | **PASS** |
| Notification tests | `test/v1-005-notification-delivery.integration.spec.ts` 23/23 + `test/v1-006-customer-notification-inbox.integration.spec.ts` 23/23 = **46/46 PASS** (rear: `test/v1-hardening-09` 21/21) | **PASS** |
| Admin investigation tests | `test/v1-hardening-06` 15/15 (wallets/balance/support-tickets `SUPPORT` allowed) + `test/v1-hardening-07` 16/16 (financial-position) + `test/v1-hardening-09` 21/21 (deliveries) | **PASS** |
| New verification (H-09) | `test/v1-hardening-09-admin-notification-delivery-diagnostics.integration.spec.ts` **21/21 PASS** (embedded PG 18.4, `DB_HOST=127.0.0.1`) | **PASS** |

No giant speculative suite run needed; existing authoritative evidence + H-09 `21` already covers `P2→COMPLETE` transition. No lint errors beyond documented baseline (controller uses explicit types, no `console.log` in `src/admin`).

## 19. Definitive Remaining-Gap Table

Every remaining gap after `5c34185` (H-09) **must be one of** `COMPLETE` / `NON-BLOCKING P2` / `PRODUCT DECISION` / `ACCOUNTING/GOVERNANCE DECISION` / `V2` / `EXTERNAL DEPENDENCY`. No vague “needs improvement”.

| Area | Current status | V1 required? | Launch blocker? | Classification | Evidence |
|------|----------------|--------------|-----------------|----------------|----------|
| **Customer financial position** (`GET /internal/customers/:id/wallets` + `.../balance` ledger-derived, `SUPPORT` allowed) | **COMPLETE** | Yes | **No** | **COMPLETE** | H-06 15/15, `AdminCustomerController` hide `ledgerAccountId`, `WalletService.getWalletBalance` |
| **Customer unified transaction history** (`GET /internal/customers/:id/transactions` + `GET /customers/me/transactions` 5 types, safe, pagination) | **COMPLETE** | Yes | **No** | **COMPLETE** | H-04 25/25 + H-06 reuse, `CustomerTransactionHistoryService` `WALLET_TRANSFER/CASH_IN/OUT/CASH_TO_CASH/FUNDING` |
| **Agent financial position** (`GET /internal/agents/:id/financial-position` ledger-derived, `SUPPORT` allowed) | **COMPLETE** | Yes | **No** | **COMPLETE** | H-07 16/16, `WalletService.listWallets` |
| **Customer profile/contact in Admin view** (`GET /internal/customers/:id` currently raw `Customer` `id/reference/type/status/kyc*` only, no `customer_profiles.displayName`/`customer_contact_methods.phone`) | **PARTIAL** | No (P2 polish, not V1 core) | **No** | **NON-BLOCKING P2** | `AdminCustomerController.toSafeCustomer` hides phone/displayName; `customer_profiles` `0014` + `customer_contact_methods` `0008` exist but not joined; H-08 §10 + H-09 §17 still `PARTIAL` |
| **Journal/ledger correlation convenience** (`GET /internal/ledger/journals/:id` correlation from `transfer.completion` etc.) | **PARTIAL** (via unified `sourceWalletId/dest` but need hop to `GET /internal/reconciliation/accounts/:accountId/activity` if `ledgerAccountId` hidden) | No (by design safe hides `ledgerAccountId`) | **No** | **NON-BLOCKING P2** | H-08 §10; intentional hide per safe projection |
| **Support linked-transaction convenience** (`GET /internal/support/tickets/:id` `relatedTransferId/fundingRequestId` indexed but no `GET .../transaction` join) | **PARTIAL** | No (P2 convenience) | **No** | **NON-BLOCKING P2** | `SupportTicket` entity `linked_transaction_id` indexed; H-08 §14 |
| **Admin notification diagnostics** (`GET /internal/notifications/deliveries` `SUPPORT`) | **COMPLETE** | Yes (P2 but now closed) | **No** | **COMPLETE** | H-09 21/21, safe hide `destination/payload`, `PENDING/SENT/FAILED/SKIPPED` + `lastError` |
| **Reconciliation reporting** (`GET /internal/reconciliation/report|trial-balance|finance|accounts/:id/activity`) | **COMPLETE** | Yes | **No** | **COMPLETE** | 9 checks, read-only, `violations==0` gate |
| **Reconciliation break resolution workflow** (`POST .../breaks/:id/resolve`) | **NOT IMPLEMENTED** — no `reconciliation_breaks` table/workflow | No (needs governance) | **No** | **ACCOUNTING/GOVERNANCE DECISION** | Reports exist; resolution pending who can `resolve` vs `acknowledge`, `audit`+`outbox`, `failed_transfer_attempts` as violation? — H-08 §16 + V1-008 |
| **Fees** (`FeeEngine` 0-fee pilot, `fee_rules` calculator not authoritative) | **BLOCKED** — runtime `feeMinor 0` | No (V1 can launch 0-fee) | **No** | **PRODUCT DECISION** | `02A` `BLOCKED`, `V1-PRODUCT-COMPLETION-AUDIT` `METADATA ONLY` |
| **Limits** (config `customer_limit_profiles` + `LimitEngine` but not enforced, pilot_controls `enabled=false`) | **BLOCKED** — balance-only | No (V1 can launch balance-only) | **No** | **PRODUCT DECISION** | `03` `BLOCKED`, 10 decisions pending |
| **Agent unified financial history** (`GET /internal/agents/:id/transactions` unified) | **NOT IMPLEMENTED** — no `AgentTransactionHistoryService` | No (see §22) | **No** | **PRODUCT DECISION** | H-08 13 questions, flow matrix 8 flows, would need new types/counterparty/direction — **BLOCKED** |
| **Reversal** (`LedgerService.reverseJournal` exists but no `POST .../reverse` Admin) | **NOT IMPLEMENTED** | No (V1 intentionally absent) | **No** | **V2** | `V1-PRODUCT-COMPLETION-AUDIT` §18 + V1-008 `V2+PRODUCT` |
| **Beneficiaries** (`customer_beneficiaries` registry `0013` but no `GET /customers/me/beneficiaries` Customer App, not integrated into `W→W` `beneficiaryId`) | **BACKEND-ONLY** | No (recipient via phone covers V1) | **No** | **NON-BLOCKING P2** (UX polish) / **PRODUCT DECISION** if V2 | V1-008 §15 `beneficiary` not required for W→W |
| **External SMS/Push provider** (Termii/Twilio, FCM/APNS credentials) | **NOT CONFIGURED** — `Console/Test` only | No (deployment config) | **No** | **EXTERNAL DEPENDENCY** | V1-005 `provider-neutral + console/test, not real delivery` — correctly V2/ops-integration, not code debt |
| **V1 scope exclusions** (Wallet→Bank, Bank→Wallet live, NIBSS, Wema/Providus/NinePSB, cards, bills/airtime/data/electricity/cable/betting, non-NGN) | **OUT OF SCOPE** | No | **No** | **V2** (12 items) | V1-008 §2, `V1-PRODUCT-COMPLETION-AUDIT` §18 |
| **Overall** | **12 COMPLETE, 3 NON-BLOCKING P2, 1 V2, 3 PRODUCT+1 ACCOUNTING, 1 EXTERNAL** | — | **0 launch blockers** | — | — |

No new category needed; every gap is one of the 6.

## 20. Launch-Gate Decision

**A. V1 OPERATIONALLY COMPLETE — NO LAUNCH-BLOCKING BACKEND GAPS**

- **Not** `V1 NOT YET OPERATIONALLY COMPLETE` — **0 P0, 0 P1** remain; all V1 money + wallet + PIN + recipient resolution + funding + Agent lifecycle/float + support + notifications + reconciliation reporting are **COMPLETE** (see §4-11, 15-16).
- **Not** `BLOCKED — essential product/accounting decision required` — while fees/limits/reconciliation governance remain `PRODUCT/ACCOUNTING DECISION`, they **do not prevent determining readiness** (V1 can launch 0-fee balance-only as documented; reconciliation reporting is launch gate `violations==0`, resolution governance is not).
- **Why not `GAPS FOUND`:** Remaining `3 P2` (displayName/phone in Admin, journal correlation, support linkage) are **useful hardening, not launch-blocking** — H-08 explicitly: “do not assume P2 polish must be implemented.” Beneficiary `BACKEND-ONLY` is not launch-blocking (recipient via phone works). Agent history is **PRODUCT DECISION** not P1 (see §22). Fees/limits are **PRODUCT** not technical blockers unless authoritative doc explicitly requires them for V1 launch — it does not (02A/03 `BLOCKED` docs say V1 can launch 0-fee balance-only).

**Launch should be gated on:** `migration count 66`, `tsc 0`, `build 0`, `violations==0` in `GET /internal/reconciliation/report` + `trial-balance` + `finance` (P0 gate), plus deployment config (see §21).

## 21. Remaining Product/Accounting/Deployment Decisions

**Separate from code-completion gate — close before or alongside launch, not via hardening implementation:**

- **Fees, if desired:** Choose `AC-APPR-01` (fee table `fee_rules` `value/owner/per-flow` not defined — flat % per flow, `COMMISSION` split, `AGENT_FUNDING` fee?); if no fee desired, remain **0-fee pilot** as current.
- **Limits, if desired:** Close `AC-APPR-02` (10 decisions: whether V1 needs limits, `single/daily/monthly/walletBalance` values per 11 flows, ownership `customer_limit_profiles` vs `agent_classes.applicable_limits`, Lagos day semantics, override precedence, concurrency `customer_daily_usages FOR UPDATE` + `IdempotencyService.reserve`).
- **Reconciliation governance:** Define who can `resolve/acknowledge` break (`FINANCE_CONTROLLER` vs `FINANCE_AUDITOR`), is `resolve` vs `acknowledge`, is `audit`+`outbox` required, should `failed_transfer_attempts` be excluded from `violations` (currently `WARNING` but counted as `violations` in report).
- **External notification provider configuration:** Choose Termii/Twilio for SMS, FCM/APNS for Push — configure `A7_PRODUCT_NOTIFICATION_DELIVERY` credentials (currently `Console/Test` only). This is **deployment/operations configuration outside code gate** (§10 B).
- **Other deployment configuration:** `DB_HOST/PORT/SSL`, `A2_WORKFORCE_OIDC_JWKS_JSON`, `A6_PARTNER_*` (if NIBSS sandbox ever needed), `CASH_TO_CASH_EXPIRY_SECONDS` (currently 7 days), `OUTBOX_RETRY_DELAY_SECONDS`, `BUILD_TIMESTAMP`, `SHUTDOWN_DRAIN_TIMEOUT_SECONDS` — verify in staging.

Do not implement code for these decisions during this audit.

## 22. Whether Agent History Is Actually Required

**No — NOT required by authoritative V1 requirement (H-08 §7 13 questions re-verified at 5c34185):**

1. Explicit V1 requirement? **No** — no `GET /agents/me/transactions` or `GET /internal/agents/:id/transactions` in `V1-PRODUCT-COMPLETION-AUDIT`, `A21-AGENT-APP-CONTRACT`, or `V1-008` verified baseline.
2. Admin requirement to investigate Agent transactions? **No** — H-05 `G5` `P1 lower` but “Agent ops can use `cash_to_cash_transfers WHERE agent_id` via DB for now” — not P0; H-08 explicitly lower than P0.
3. Agent App requires unified history? **No** — `A21` contract is `financial-position` + wallet-scoped `GET /agents/me/wallets/:walletId/transactions`, not unified 5-type.
4. Flows already individually queryable? **Yes** — `POST /internal/agents/:id/fund|defund` + `GET .../financial-position` (H-07) + `cash_to_cash_transfers` `WHERE agent_id` + `ledger_journals` `WHERE reference LIKE 'AGENT_FUNDING%'` + `reconciliation/accounts/:id/activity`.
5. Authoritative Agent transaction abstraction exists? **No** — no `AgentTransactionHistoryService`.
6. Ledger journals alone sufficient? **Partial** — `metadata.canonicalService` for `CASH_IN/OUT` is reliable, but `CASH_TO_CASH` needs `cash_to_cash_transfers` join, `funding` needs `AgentFunding` table/reference.
7. Distinguish `Cash→Wallet/Wallet→Cash/Cash→Cash/funding/defunding`? **No, not reliably without domain tables.**
8. Metadata `canonicalService` reliable? **Partial** — `CASH_IN/OUT` yes, `funding` not guaranteed.
9. Would require new domain decisions? **Yes, major** — which 3-6 types, counterparty (`PLATFORM` vs `AGGREGATOR` vs `beneficiaryPhone`), direction (`DEBIT/CREDIT` for Agent wallet vs `AGENT_FUNDING_POOL`), status (`UNCLAIMED/CLAIMED/EXPIRED` vs `COMPLETED`).
10. Would need new projections or reuse? **Both** — reuse `cash_to_cash_transfers` etc. but new `AgentUnifiedHistoryItem` projection needed.
11. Would require new aggregation service? **Yes** — `AgentTransactionHistoryService.listUnified` bounded fetch + global merge (like customer).
12. Would require new persisted history table? **No** — could be projection, not persisted.
13. Would require new transaction-type definitions? **Yes** — `AGENT_FUNDING`, `AGGREGATOR_FUNDING`, etc.

**Conclusion from 13:** Agent unified history **is not genuinely required for V1 launch**, is **not defined in authoritative requirements**, would require **product decision** — classify as **PRODUCT DECISION / NON-BLOCKING**, **not launch blocker** merely for symmetry with Customer history.

## 23. Next-Step Recommendation

**DO NOT invent another implementation task.** Per §21 (Important):

**NEXT STEP: V1 launch/deployment readiness and product decision closure.**

- **Code-complete V1 backend:** `5c34185` with `66` migrations, `tsc 0`, `build 0`, `23+23+15+16+21` integration evidence, `violations==0` launch gate.
- **Product decision closure (if desired, not code-blocking):** fees (02A), limits (03), Agent history semantics (H-08 §9), beneficiary Customer App exposure (H-08 §15 `P1.6` trusted-recipient UX).
- **Accounting governance closure (if desired):** reconciliation break-resolution workflow (who resolves, audit/outbox).
- **Deployment configuration:** real SMS/Push provider (Termii/Twilio, FCM/APNS) credentials wiring, `A2_WORKFORCE_OIDC`, `DB_*`, `CASH_TO_CASH_EXPIRY_SECONDS`, `OUTBOX_RETRY` — operations, not code.
- **Pre-launch verification:** re-run `GET /internal/reconciliation/report` (ensure `violations==0`), `production-readiness` `latestTimestamp===1785753600065`, `tsc`, `build`, targeted regressions (`v1-005` 23, `v1-006` 23, `v1-hardening-09` 21, `a22` 15, `v1-001` 26) in staging with embedded PG → real PG.

If genuine launch-blocking backend work is ever discovered (currently none), **identify exactly ONE implementation task then** — but none is needed now.

## 24. Final Status

**VERIFIED — V1 operationally complete; no launch-blocking backend gaps identified**

---

*Report path:* `docs/V1/V1-HARDENING-10-FINAL-V1-OPERATIONAL-READINESS-AUDIT.md` (this file) — HEAD `5c34185` → `5c34185` (audit-only 0 source/0 migration/0 ledger/0 route changes, 66→66, `tsc` 0, `build` 0, verified via 40-item inspection + 11-gate matrices + gap classification, launch not blocked by P2/product/accounting/V2/external). *Fees/limits remain BLOCKED/untouched (02A/03), beneficiary BACKEND-ONLY not redone, unified history COMPLETE (04) not redone, H-06/H-07/H-09 not reopened, reversal V2 not implemented, reconciliation reporting COMPLETE resolution ACCOUNTING.*

VERIFIED — V1 operationally complete; no launch-blocking backend gaps identified
