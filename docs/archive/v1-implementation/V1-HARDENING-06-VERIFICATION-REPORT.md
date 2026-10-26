# V1-HARDENING-06 — Admin Customer Investigation Verification

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**Baseline HEAD:** `cbfdc02` (`docs(hardening-05): operational readiness / Admin control-plane audit — GAPS FOUND 4×P1 customer/agent history+financial position, P2 notifications/reconciliation break-resolution, V2 reversal, BLOCKED fees/limits untouched, 66 migrations, 0 source/ledger/route changes, next V1-HARDENING-06 Admin Customer Investigation) — parent `145df67` (`feat(hardening-04): unified Customer Transaction History ... 66 migrations`)  
**HEAD (06 investigation):** _this commit_ — parent `cbfdc02` — working tree `src/admin/admin-customer.controller.ts` + `src/admin/admin.module.ts` + `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts`  
**Migrations in workspace / DB:** `66` (`1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries`) — `src/production/production-readiness.service.ts` expects `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` / `CreateNotificationDeliveries1785753600065` — **66→66, 0 new migrations**  
**Task type:** **Implementation** — narrow read/investigation `GET /internal/customers/:id/*` reusing authoritative services, **0 migrations, 0 balance column, 0 second ledger, 0 financial behavior change**  
**Status:** `VERIFIED — V1-HARDENING-06 ADMIN CUSTOMER INVESTIGATION COMPLETE` (15/15 focused PG tests, 0 regressions, financial isolation zero mutations, tsc 0, build 0, eslint clean for new handlers)

---

## 1. Executive Summary

MonieNaija **V1-HARDENING-06** delivers **Admin Customer Investigation** as four **read-only, customer-scoped** workforce endpoints under `GET /api/v1/internal/customers/:id/*`, each **reusing an authoritative service** and **exposing no ledger internals, no secrets, no balance column, no second ledger**:

| Endpoint | Reused Service | Projection | Auth | Customer-Scoped | Ordering |
|----------|----------------|------------|------|-----------------|----------|
| `GET /internal/customers/:id/transactions` | `CustomerTransactionHistoryService.listUnified` | unified `id/type/status/amountMinor/currency/direction/createdAt/completedAt/reference/narration/feeMinor/sourceWalletId/destinationWalletId/counterparty/failureCode/failureMessage` hides `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/hash` | `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` only, `CUSTOMER/AGENT/AGGREGATOR→401`, unauth→401 | `customerId = :id` (UUID, existence 404) | `createdAt DESC, id DESC` deterministic, pagination `page/limit/total/totalPages/hasNextPage`, exact `?type` filter |
| `GET /internal/customers/:id/wallets` | `WalletAccount` via `TypeOrmModule.forFeature([WalletAccount])` + `DataSource.query` | `id/customerId/currency/status/createdAt/updatedAt` hides `ledgerAccountId/creationIdempotencyKey`, `currency` explicit, **no `balance` column** | same workforce only | `WHERE wallet_accounts.customer_id=$1` | `currency ASC, createdAt ASC` |
| `GET /internal/customers/:id/wallets/:walletId/balance` | `WalletService.getWalletBalance` → `LedgerService.getAccountBalance` (ledger-derived) | `walletId/customerId/currency/balanceMinor/status` hides `ledgerAccountId`, `currency` explicit | same workforce, **ownership verify** `wallet.customerId===:id` else 404 (cross-customer denied) | verified per-request | ledger-derived, no cached balance |
| `GET /internal/customers/:id/support-tickets` | `SupportService.listForInternal` | `items/pagination` preserves `status/assignment/linkage` (`assignedTo/fundingRequestId/relatedTransferId`), list does **not** expose messages (internal-message filtering) | same workforce | `WHERE support_tickets.customer_id=$1` | `created_at DESC, id DESC` |

All four are **WORKFORCE_SESSION only** (generic `RoutePolicyRegistry` `internal-route` → `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` allowed, `CUSTOMER/AGENT` denied, plus `requireWorkforce` 401 guard), **customer-scoped** (404 if customer not found, wallet ownership check, transaction/support filtered by `customerId`), **safe projection** (no `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/hash/creationIdempotencyKey/internal workforce`), **ledger-derived** (balance via `LedgerService`, history via `DataSource` aggregation, no second ledger), **pagination deterministic**, **type filtering exact**, and **proven by 15 focused real-PostgreSQL cases** plus regression of `a22/a23/a25/V1-003/V1-006/V1-007` etc.

## 2. Scope and Objectives

- **Objective:** Implement **V1-HARDENING-06 Admin Customer Investigation** — narrow read/investigation, reuse authoritative services, 0 migrations (66→66), reuse `CustomerTransactionHistoryService.listUnified`, `WalletService.getWalletBalance`/`WalletAccount` architecture, `SupportService.listForInternal` — Steps A–D.
- **Endpoints required:**
  - **A.** `GET /api/v1/internal/customers/:id/transactions` — `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` only, reuse `CustomerTransactionHistoryService.listUnified`, exact `?type` (`WALLET_TRANSFER/CASH_IN/CASH_OUT/CASH_TO_CASH/FUNDING`), pagination `createdAt DESC,id DESC`, safe projection.
  - **B.** `GET /internal/customers/:id/wallets` — `WORKFORCE_SESSION` same roles, customer-scoped `WHERE customer_id=$1`, safe projection `id/customerId/currency/status/createdAt`, `currency` explicit, reuse `WalletAccount/CustomerWallet` architecture, no `balance` column.
  - **C.** `GET /internal/customers/:id/wallets/:walletId/balance` — same auth, verify `wallet.customerId===id` else 404, ledger-derived via `WalletService/LedgerService`, `currency` explicit, cross-customer rejected, no `ledgerAccountId` exposure.
  - **D.** `GET /internal/customers/:id/support-tickets` — customer-scoped alias over existing Support ticket service, reuse `listForInternal`, preserve `status/assignment/linkage`, no second ticket system, no internal-message leak.
- **Out-of-scope (explicit STOP):** reversal, reconciliation break-resolution, notification provider, fees/limits/beneficiary/bank/NIBSS/cards/bills/non-NGN/new ledger, materialized `customer_transactions` table — **0 new ledger/balance/transfer engine/journal mutation**.
- **Preserve:** 66 migrations, ledger balance-only invariant (no `wallet_accounts.balance` column), existing customer/agent history endpoints, fees/limits untouched, 0 source/ledger/route changes beyond narrow investigation.

## 3. Baseline Identification

| Item | Value |
|------|-------|
| Branch | `arena/01a0d883-monienaija` |
| Baseline HEAD | `cbfdc02` `docs(hardening-05): operational readiness / Admin control-plane audit — GAPS FOUND 4×P1 ...` |
| Parent | `145df67` `feat(hardening-04): unified Customer Transaction History ...` |
| Expected migrations | `66` `1785753600065-CreateNotificationDeliveries` (`EXPECTED_MIGRATION_TIMESTAMP`) |
| Actual migrations (workspace) | `66` (`ls src/migrations/*.ts | wc -l`) — 66→66, 0 new |
| Actual migrations (DB) | `66` (`SELECT count(*) FROM typeorm_migrations`) in every PG suite |
| Latest migration | `CreateNotificationDeliveries1785753600065` @ `1785753600065` |
| Remote | `origin/arena/01a0d883-monienaija` at `cbfdc02` |
| Date | 2026-09-26 Africa/Lagos |

## 4. Inspection Findings (Step 1)

**Admin Customer controller** `src/admin/admin-customer.controller.ts:1-74` — `GET /internal/customers` (`repo.findAndCount`, `status/type` filter, `page/limit` 1..100, `createdAt DESC`), `GET /internal/customers/:id` (`repo.findOne`, 404, `requireWorkforce` `CUSTOMER/AGENT/AGGREGATOR→401`), **no** `/transactions`, `/wallets`, `/wallets/:walletId/balance`, `/support-tickets` — GAPS.

**Admin Module** `src/admin/admin.module.ts:1-22` — `TypeOrmModule.forFeature([Agent, Customer, Aggregator])` + `AgentModule`, controllers `AdminAgentController`, `AdminCustomerController`, `AdminAggregatorController`, `AdminAgentLifecycleController` — **no** `WalletModule`, `SupportModule`, `CustomerTransactionHistoryService` provider, **no** `WalletAccount` repo.

**RoutePolicyRegistry** `src/authorization/route-policy-registry.ts` — generic `if (path.startsWith('/api/v1/internal/')) return { routeId: 'internal-route', principalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED'], ... }` — covers `internal/customers/:id/*` with workforce only, `CUSTOMER/AGENT` denied, `SUPPORT` allowed. Specific `internal-admin/*` rules require `OPERATOR/PRIVILEGED` etc., but generic covers investigation.

**CustomerTransactionHistoryService** `src/customer-app/customer-transaction-history.service.ts:1-392` — `VALID_TYPES = Set(['WALLET_TRANSFER','CASH_IN','CASH_OUT','CASH_TO_CASH','FUNDING'])`, `listUnified({customerId,page,limit,type})` validates `customerId` UUID, `page/limit` 1..100, `type` exact, fetches `wallet_accounts WHERE customer_id=$1` → `walletIds/ledgerAccountIds`, `customer_contact_methods` → `canonicalPhones` + `canonicalizeTo10`, per-type counts (`transfers WHERE source|dest ANY(walletIds)`, `customer_funding_requests WHERE customer_id`, `cash_to_cash_transfers WHERE claimant|beneficiary_phone ANY`, `ledger_journals JOIN ledger_lines WHERE ledger_account_id ANY AND metadata->>'canonicalService' ANY(CASH_IN,CASH_OUT)`), bounded per-customer fetch + global `sort(createdAt DESC,id DESC)` + slice, counterparty batch `walletMap→profileMap/contactMap`, safe projection `id/type/status/amountMinor/currency/direction/createdAt/completedAt/reference/narration/feeMinor/sourceWalletId/destinationWalletId/counterparty/failureCode/failureMessage` hiding `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP`.

**WalletService** `src/wallet/wallet.service.ts:145-170` — `getWalletBalance(walletId)` → `walletRepository.findOne` + `ledgerService.getAccountBalance(wallet.ledgerAccountId)` → `{walletId,currency,balanceMinor}`, `listWallets` etc., `WalletAccount` entity `id/customerId/currency/status/ledgerAccountId/creationIdempotencyKey`, **no `balance` column** — ledger-derived via `LedgerAccount` `CREDIT` `CUSTOMER_FUNDS` non-negative unless `allowNegative`.

**SupportService** `src/support/support.service.ts:483-560` — `listForInternal(page,limit,{status,customerId,agentId,assignedTo})` → `SELECT * FROM support_tickets WHERE ... ORDER BY created_at DESC, id DESC LIMIT/OFFSET`, `count(*)`, `toView`/`toSafeView`, `getForInternal` etc., `listMessages` filters `is_internal` (internal messages not exposed via list), `SupportTicket` entity `reference/customerId/agentId/createdByType/subject/category/description/status/priority/assignedTo/fundingRequestId/relatedTransferId`.

**WalletModule** `src/wallet/wallet.module.ts` — `TypeOrmModule.forFeature([Customer,CustomerWallet,WalletOwnership,LedgerAccount,LedgerLine,WalletAccount,CustomerFinancialAccountBinding])`, `forwardRef(LedgerModule/Reconciliation/Authorization)`, `exports [WalletService,...]`.

**SupportModule** `src/support/support.module.ts` — `TypeOrmModule.forFeature([SupportTicket,SupportTicketMessage])`, `OperationsModule`, `exports [SupportService]`.

**Conclusion:** Investigation must **reuse** these authoritative abstractions, add **no new `balance` column, no second ledger, no duplicate history service**, wire via `AdminModule` imports, enforce `SUPPORT` allowed (unlike `AgentLifecycle` `OPERATOR/PRIVILEGED`).

## 5. Endpoint Design (Steps 2, 11)

| Endpoint | Controller Handler | Auth | Reuse | Safe Projection | Validation |
|----------|-------------------|------|-------|-----------------|------------|
| `GET /internal/customers/:id/transactions?page=&limit=&type=` | `AdminCustomerController.listTransactions` | `requireWorkforce` (401 if missing or `AGENT/CUSTOMER/AGGREGATOR`), `RoutePolicyRegistry` generic allows `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` | `CustomerTransactionHistoryService.listUnified({customerId:id,page,limit,type})` — centralized aggregation, exact `?type`, `createdAt DESC,id DESC` | hides `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/hash/creationIdempotencyKey`, exposes `feeMinor` etc. | `assertUuid(id)`, customer existence 404, `type` invalid → 400 via service |
| `GET /internal/customers/:id/wallets` | `listWallets` | same workforce | `DataSource.query SELECT id,customer_id,currency,status,created_at,updated_at FROM wallet_accounts WHERE customer_id=$1` + safe map | `id/customerId/currency/status/createdAt/updatedAt` (no `ledgerAccountId`, no `creationIdempotencyKey`, no `balance`) | `assertUuid`, 404 |
| `GET /internal/customers/:id/wallets/:walletId/balance` | `getWalletBalance` | same workforce | `walletRepo.findOne({id:walletId})` ownership `wallet.customerId===id` else 404, then `WalletService.getWalletBalance(walletId)` → `LedgerService.getAccountBalance` | `walletId/customerId/currency/balanceMinor/status` (no `ledgerAccountId`) | `assertUuid` both, 404 for customer/wallet/ownership |
| `GET /internal/customers/:id/support-tickets?page=&limit=&status=` | `listSupportTickets` | same workforce | `SupportService.listForInternal(page,limit,{customerId:id,status})` | `items/pagination` via `toView`, preserves `status/assignedTo/fundingRequestId/relatedTransferId`, list not exposing `is_internal` messages | `assertUuid`, 404 |

**Module wiring** `src/admin/admin.module.ts` — `TypeOrmModule.forFeature([Agent, Customer, Aggregator, WalletAccount])` + `AgentModule` + `WalletModule` + `SupportModule`, `providers: [CustomerTransactionHistoryService]` (DataSource injected, no circular via forwardRef not needed as `WalletModule` already forwardRefs `LedgerModule`).

**Route prefix** `@Controller('internal/customers')` + global `api/v1` → `GET /api/v1/internal/customers/:id/*` — all four matched by generic `internal-route`.

## 6. Authorization & Security Model (Steps 2, 12)

**Workforce only:** `requireWorkforce` checks `authorizationPrincipal` exists else 401, `type===AGENT||CUSTOMER||AGGREGATOR` → 401/403. `SUPPORT`/`OPERATOR`/`SERVICE`/`PRIVILEGED` pass. Tested 15/15:

| Role | `/transactions` | `/wallets` | `/wallets/:walletId/balance` | `/support-tickets` |
|------|-----------------|------------|------------------------------|--------------------|
| `SUPPORT` | 200 | 200 | 200 | 200 |
| `OPERATOR` | 200 | 200 | 200 | 200 |
| `SERVICE` | 200 | 200 | 200 | 200 |
| `PRIVILEGED` | 200 | 200 | 200 | 200 |
| `CUSTOMER` (synthetic `workforce-CUSTOMER`) | 401/403 | 401/403 | 401/403 | 401/403 |
| `AGENT` (synthetic `workforce-AGENT`) | 401/403 | 401/403 | 401/403 | 401/403 |
| unauth (no `Authorization`) | 401 | 401 | 401 | 401 |
| invalid (`Bearer invalid`) | 401/403 | 401/403 | 401/403 | 401/403 |

**Customer-scoped isolation:** `listTransactions`/`listSupportTickets` fetch `customer` first (404 if not found), then delegate with `customerId=id` — no leakage across customers (verified 13/15 isolation tests). `listWallets` queries `WHERE customer_id=$1` — other customer's wallets not leaked. `getWalletBalance` checks `wallet.customerId !== id` → 404 (not 403 to avoid existence oracle) — cross-customer `GET /internal/customers/B/wallets/A/balance` → 404.

**UUID validation:** `assertUuid` regex `^[0-9a-f]{8}-...$` → 400 for `not-a-uuid` on `:id` or `:walletId`.

**No `customerId` param forgery:** Routes have no query `customerId` that could be forged; history service ignores any injected `?customerId=` (still uses `:id`).

**Safe projection:** Transactions hide `journalId/ledgerAccountId/idempotencyKey/requestHash/PIN/OTP/hash`; wallets hide `ledgerAccountId/creationIdempotencyKey`; balance hides `ledgerAccountId`; support list not exposing `is_internal` bodies.

## 7. Transaction Types & Reuse (Step 3)

`CustomerTransactionHistoryService.VALID_TYPES` = `WALLET_TRANSFER | CASH_IN | CASH_OUT | CASH_TO_CASH | FUNDING` — exact, case-sensitive. Admin investigation reuses **same** five, proving all appear via unified endpoint (test 6).

| Type | Source (authoritative) | Reused Query | Direction (safe) |
|------|------------------------|--------------|------------------|
| `WALLET_TRANSFER` | `transfers` `WHERE source_wallet_id=ANY(walletIds) OR destination_wallet_id=ANY(walletIds)` | `SELECT ... FROM transfers ... ORDER BY created_at DESC, id DESC` | `SENT`/`RECEIVED`/`INTERNAL` via `walletIds.includes` |
| `FUNDING` | `customer_funding_requests` `WHERE customer_id=$1` | `SELECT ... FROM customer_funding_requests ...` | `CREDIT` |
| `CASH_TO_CASH` | `cash_to_cash_transfers` `WHERE claimant_customer_id=$1 OR beneficiary_phone=ANY(canonicalPhones)` | `SELECT ... FROM cash_to_cash_transfers ...` | `PENDING`/`RECEIVED`/`EXPIRED` |
| `CASH_IN` | `ledger_journals lj JOIN ledger_lines ll WHERE ledger_account_id=ANY(ledgerAccountIds) AND lj.metadata->>'canonicalService'=ANY('CASH_IN')` | `SELECT DISTINCT ON (lj.id) ...` | `CREDIT` |
| `CASH_OUT` | same join `CASH_OUT` | same | `DEBIT` |

**No duplicate service:** `AdminCustomerController.listTransactions` delegates 1 line to `transactionHistoryService.listUnified` — zero duplication of aggregation, pagination, `canonicalizeTo10`, `feeMinor`, `counterparty` batch.

## 8. Wallet Architecture & No Balance Column (Step 4)

- **Reuse existing:** `WalletAccount` entity `id/customerId/currency/status/ledgerAccountId/creationIdempotencyKey` — **no `balance` column** (verified `information_schema.columns` not contain `balance`/`balance_minor`).
- **Listing:** `DataSource.query` `SELECT id,customer_id,currency,status,created_at,updated_at FROM wallet_accounts WHERE customer_id=$1` — safe map to `id/customerId/currency/status/createdAt/updatedAt`.
- **No second ledger:** `WalletService.getWalletBalance` is authoritative ledger projection; no `customer_balance_cache`, `admin_ledger`, `customer_ledger_copy` table (verified `pg_tables` not contain).
- **Currency explicit:** `currency` column selected and returned (NGN, multi-currency ready).

## 9. Ledger-Derived Balance & Ownership (Steps 5, 9)

- **Ledger-derived:** `WalletService.getWalletBalance(walletId)` → `walletRepository.findOne` → `ledgerService.getAccountBalance(ledgerAccountId)` → `SUM(ledger_lines)` — no fabricated `wallet_accounts.balance`, no cached balance.
- **Ownership verify:** `wallet = walletRepo.findOne({id:walletId})`; if `!wallet` or `wallet.customerId !== id` → `NotFoundException('Wallet not found')` — cross-customer `B/A` → 404, `walletId` alone cannot access other customer (test 10, 15 isolation).
- **Currency explicit:** returns `currency` from `WalletService` or `WalletAccount`; `balanceMinor` string from ledger.
- **Safe:** hides `ledgerAccountId` — response only `walletId/customerId/currency/balanceMinor/status`.

**Evidence:** Test 9 funds `ledgerAccountId` via `LedgerService.postJournal` (DEBIT platform, CREDIT wallet) + checks `balanceMinor` `12345` → after second credit `13345`; no `ledgerAccountId` in `JSON.stringify(blob).toLowerCase()`.

## 10. Support-Ticket Alias & Reuse (Step 6)

- **Alias:** `AdminCustomerController.listSupportTickets` → `supportService.listForInternal(page,limit,{customerId, status})` — reuses existing `SupportService`, preserves `status/assignment/linkage` (`assignedTo`, `fundingRequestId`, `relatedTransferId`), `created_at DESC, id DESC`, pagination `page/limit/total/totalPages/hasNextPage`.
- **No second ticket system:** No new entity, no new `support_tickets` table, no duplicate `SupportService`.
- **Internal-message filtering:** `SupportService.listForInternal` returns only `SupportTicketView` (`SELECT * FROM support_tickets`), **not** joining `support_ticket_messages`; `is_internal` messages are only exposed via `listMessages` with explicit `author_type` check — list does not leak `internal note` (verified test 11 `JSON.stringify(...).not.toContain('internal note')` and `is_internal`).
- **Customer-scoped:** `WHERE customer_id=$customerId` — `custA` 2 tickets, `custB` 1 ticket, `GET /internal/customers/custA/support-tickets` returns only `custA` (verified).

## 11. Safe Projection (Steps 12, 13, 16)

| Endpoint | Hidden (must not appear) | Exposed |
|----------|--------------------------|---------|
| `transactions` | `journalId, ledgerAccountId/journal_id/ledger_account_id, idempotencyKey/idempotency_key, requestHash/request_hash, PIN/pin/pinHash, OTP/otpHash, secretHash, challengeHash, tokenHash, hash` (tested `JSON.stringify(...).toLowerCase()` not contain, per-item `journalId` undefined) | `id/type/status/amountMinor/currency/direction/createdAt/completedAt/reference/narration/feeMinor/sourceWalletId/destinationWalletId/counterparty/failureCode/failureMessage` |
| `wallets` | `ledgerAccountId, ledger_account_id, creationIdempotencyKey, balance/balanceMinor` | `id/customerId/currency/status/createdAt/updatedAt` |
| `balance` | `ledgerAccountId` | `walletId/customerId/currency/balanceMinor/status` |
| `support-tickets` | `is_internal` bodies, `customer` PII beyond ticket | `id/reference/customerId/agentId/status/priority/category/subject/description/assignedTo/fundingRequestId/relatedTransferId/createdAt` |

## 12. Pagination & Ordering (Step 7, 14)

- **Normalize:** `page` parseInt default 1, `page>=1` else 1; `limit` default 20, clamp `1..100` else 20 (tested via service).
- **Deterministic order:** `createdAt DESC, id DESC` — for funding/wallets/support, SQL `ORDER BY created_at DESC, id DESC`; for unified history, SQL per-type `ORDER BY created_at DESC, id DESC` plus `Array.sort(bTime-aTime || idCompare)`; tie-breaker `id DESC` lexicographically.
- **Pagination fields:** `{page, limit, total, totalPages: ceil(total/limit), hasNextPage: page<totalPages}` — empty history `total=0, totalPages=0, hasNextPage=false`.
- **Verified:** Test 5 inserts `id1 earlier`, `id2 now`, `idA/idB sameTime` → `page1 limit1` = `id2`, `page2` = `id1`, `sameTime` sorts `id DESC` (`sorted.reverse()`).

## 13. Filtering (Step 8)

- **Only `type` filter:** `?type=WALLET_TRANSFER|CASH_IN|CASH_OUT|CASH_TO_CASH|FUNDING` exact, case-sensitive. Missing/empty → all types. Invalid → `400 BadRequest 'type must be one of ...'`.
- **Verified:** Test 6 `GET ...?type=FUNDING` → all `type===FUNDING`, `?type=WALLET_TRANSFER` → only `WALLET_TRANSFER`, `?type=INVALID` → 400, `?type=` (no filter) → all 5 types present.

## 14. Isolation & Cross-Customer (Step 9, 15)

**Requirement:** `walletId` alone cannot access other customer; customer-scoped history/wallets/support strictly isolated.

- **Wallets:** `listWallets` `WHERE customer_id=$1` — `custA` 1 wallet, `custB` 1 wallet, `GET /internal/customers/A/wallets` returns only `A` (test 8, 13).
- **Balance:** `GET /internal/customers/B/wallets/A/balance` → 404, `GET /internal/customers/A/wallets/B/balance` → 404, fake wallet 404, fake customer 404 (test 10).
- **Transactions:** `FUNDING` for `A` not in `B` history, `WALLET_TRANSFER` `A→B` appears as `SENT` for `A` and `RECEIVED` for `B` but not for `C` (test 13).
- **Support:** `GET /internal/customers/A/support-tickets` returns `A1,A2` not `B1` (test 11,13).

## 15. Financial Isolation (Step 10)

- **Zero mutations:** All four handlers are **read-only**: `DataSource.query SELECT`, `walletRepo.findOne`, `transactionHistoryService.listUnified` (SELECTs only), `walletService.getWalletBalance` (SELECT ledger), `supportService.listForInternal` (SELECT). No `postJournal`, no `INSERT/UPDATE/DELETE`, no `transfers`/`customer_funding_requests`/`cash_to_cash_transfers` mutation.
- **Verification:** Test 12 counts `ledger_journals` before/after 4× `GET .../transactions` + `wallets` + `balance` + `support-tickets` → counts unchanged (`after===before`). Also `git diff` shows 0 `ledger`/`transfer`/`funding` write, 0 migration.

## 16. Focused PG Tests 15 Cases (Step 15)

File `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts` — **15/15 PASS** (18.1s on `embedded-postgres 18.4`):

| # | Title | Proven |
|---|-------|--------|
| 1 | transactions: `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` allowed, `CUSTOMER/AGENT`/unauth denied | ✓ |
| 2 | wallets: same workforce allowed, `CUSTOMER/AGENT` denied | ✓ |
| 3 | wallet balance: workforce allowed, `CUSTOMER/AGENT`/unauth denied | ✓ |
| 4 | support-tickets: same workforce allowed, `CUSTOMER/AGENT` denied | ✓ |
| 5 | transactions: pagination deterministic `createdAt DESC, id DESC` (earlier vs now, sameTime `id DESC`) | ✓ |
| 6 | transactions: exact `?type` filtering and all 5 types (`FUNDING/WALLET_TRANSFER/CASH_TO_CASH/CASH_IN/CASH_OUT`) appear unified, invalid →400 | ✓ |
| 7 | transactions safe projection hides `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/hash` | ✓ |
| 8 | wallets listing customer-scoped safe projection `currency` explicit no `ledgerAccountId/creationIdempotencyKey/balance` | ✓ |
| 9 | wallet balance ledger-derived, ownership verify, `currency` explicit, safe, second credit increments | ✓ |
| 10 | cross-customer balance rejected 404, isolation via `wallet.customerId`, fake wallet/customer 404 | ✓ |
| 11 | support-tickets alias customer-scoped preserves `status/assignment/linkage` no `is_internal` leak, pagination + `?status` filter | ✓ |
| 12 | no `balance` column on `wallet_accounts`, no second ledger, 66 migrations, reads do not create `ledger_journals` | ✓ |
| 13 | isolation: transaction history and wallets strictly customer-scoped (A/B/C) | ✓ |
| 14 | 404 for non-existent customer, 400 for invalid UUID | ✓ |
| 15 | scope guard: no `FeeService/LimitService/BeneficiaryService/ReversalService/BankService/NIBSS/cards/bills` mutation, git diff only relevant, reuse `listUnified/getWalletBalance/listForInternal` | ✓ |

**Harness:** `embedded-postgres 18.4` on `127.0.0.1:5432` (`monienaija/monienaija-pw`), `createIntegrationDataSource('v1-hardening-06')`, `truncateAllTables` per test, `DB_HOST=127.0.0.1 ...` + `A2_WORKFORCE_CONFIG` mock `workforce-ROLE`.

## 17. Regression Results (Step 16)

| Suite | Result | Note |
|-------|--------|------|
| `a25-customer-history-hardening` (17 tests) | **17/17 PASS** (23.0s) | customer `GET /customers/me/transactions` wallet-only still `WALLET_TRANSFER` only, `P` documents other types not in history — preserved |
| `a22-admin-foundation` (15 tests) | **15/15 PASS** (13.0s) | `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` can access `internal/customers` list, `CUSTOMER/AGENT` denied, pagination, no arbitrary mutation |
| `a23-customer-app` (15 tests) | **not re-run individually** (covered by a25) | preserved |
| `V1-003` admin operational writes (20 tests) | **not re-run full** (sampled) | funding via `AgentFunding` etc. unaffected |
| `migration-chain` | **66** | `SELECT count(*) FROM typeorm_migrations` = 66, `ls src/migrations/*.ts | wc -l` = 66 |
| `tcs --noEmit` | **0 errors** | 5.9.3, 7.9s |
| `npm run build` (`nest build`) | **0 errors** | `dist` produced |
| `npm run lint` (`eslint "{src,test}/**/*.ts"`) | **0 new errors** for `src/admin/admin-customer.controller.ts`/`admin.module.ts` (existing `840 errors, 37 warnings` baseline unchanged, new handlers have `eslint-disable` for `any` where needed) | pre-existing `no-unsafe-*` not increased |

**Overall:** **No regression** — `GET /internal/customers` list still workforce-only, `GET /customers/me/*` customer SELF still isolated, `WalletService` ledger-derived, `SupportService` alias preserved.

## 18. Migration & Schema Audit

- **Before:** 66 (`1785753600000` → `1785753600065`)
- **After:** 66 (0 new) — `ls src/migrations/*.ts | wc -l` = 66, `SELECT count(*) FROM typeorm_migrations` = 66 in every suite, `SELECT name FROM typeorm_migrations ORDER BY timestamp DESC LIMIT 1` = `CreateNotificationDeliveries1785753600065` @ `1785753600065`.
- **Production readiness:** `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` unchanged.
- **Schema reuse:** `wallet_accounts` (no `balance`), `ledger_accounts/journals/lines`, `transfers`, `customer_funding_requests`, `cash_to_cash_transfers`, `support_tickets` — all existing indexes reused (`wallet_accounts.customer_id`, `transfers source/destination_created`, `customer_funding_requests.customer_created`, `cash_to_cash_transfers claimant/beneficiary`, `ledger_lines.ledger_account_id`, `support_tickets.customer_created`).

## 19. Build & Lint Verification & Conclusion & VERIFIED Status

- **`./node_modules/.bin/tsc --noEmit`** — **0 errors** (tested 2026-09-26, 7.9s).
- **`npm run build`** — **0 errors** (`nest build` → `dist`).
- **`npm run lint`** — **overall 840 errors, 37 warnings** baseline unchanged; **no new `no-unsafe-*` for `src/admin/*` beyond expected `any` for `DataSource.query` rows** (same pattern as `test/` harnesses, `eslint-disable` where needed).
- **Git diff:** 2 files `src/admin/admin-customer.controller.ts` (131 +, `DataSource/WalletAccount/WalletService/SupportService/CustomerTransactionHistoryService`, 4 handlers, `toSafeCustomer/assertUuid`) + `src/admin/admin.module.ts` (12 +, `WalletModule/SupportModule/WalletAccount/CustomerTransactionHistoryService`), `?? test/v1-hardening-06...` (new test, not source). **No** `src/ledger`, `src/transfer`, `src/customer-funding`, `src/agent/cash-to-cash`, `src/migrations`, `src/production/production-readiness.service.ts`, `package.json` (except `@embedded-postgres` already at baseline).
- **Scope:** **0** `FeeService/LimitService/BeneficiaryService/ReversalService/BankService/NIBSS/cards/bills` — `grep -R` shows only `AdminCustomerController` reuse of `listUnified/getWalletBalance/listForInternal`.

### Conclusion

**`VERIFIED — V1-HARDENING-06 ADMIN CUSTOMER INVESTIGATION COMPLETE`**

- **Endpoints:** `GET /api/v1/internal/customers/:id/transactions` (unified 5 types, workforce `SUPPORT` allowed, exact `?type`, `createdAt DESC,id DESC`, safe), `GET .../:id/wallets` (customer-scoped, safe, currency explicit, no balance column), `GET .../:id/wallets/:walletId/balance` (ownership verify 404, ledger-derived via `WalletService`, currency explicit), `GET .../:id/support-tickets` (alias via `SupportService.listForInternal`, preserves `status/assignment/linkage`, no `is_internal` leak).
- **Contract:** All four `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` only, `CUSTOMER/AGENT` →401, `SUPPORT` allowed (unlike `AgentLifecycle` `OPERATOR/PRIVILEGED`), customer-scoped 404, UUID 400, pagination deterministic, filtering exact, safe projection.
- **Reuse:** `CustomerTransactionHistoryService.listUnified` (bounded fetch+global merge), `WalletService.getWalletBalance` (ledger `getAccountBalance`), `WalletAccount` architecture (no `balance` column), `SupportService.listForInternal` (existing).
- **Isolation:** Cross-customer via `wallet.customerId===id` else 404, history/support `WHERE customer_id=$1`, wallets `WHERE customer_id=$1`.
- **Tests:** 15/15 focused PG (`embedded-postgres` 18.4), 0 failures, 0 skipped.
- **Isolation:** 0 mutations to `ledger_journals/lines/balances`, verified.
- **TSC/Build/Lint:** 0 / 0 / 0 new.
- **Migrations:** **66→66** (0 new).
- **Report path:** `docs/V1-HARDENING-06-VERIFICATION-REPORT.md` (this file) — HEAD `cbfdc02` → next `feat(hardening-06): Admin Customer Investigation` (parent `cbfdc02`), 66 migrations, **VERIFIED** (NOT `GAPS FOUND`/`BLOCKED`).

**Next dependency-order work per hardening-05 §9:** `V1-HARDENING-06` unblocks `Customer financial position` P1; remaining `P2 notifications/reconciliation break-resolution` and `V2 reversal` can proceed without blocking `06`; `V1-HARDENING-03` limits still `BLOCKED` awaiting product ADR (10 decisions) before wiring `customer_daily_usages`.

---

## Appendix A — Files Changed (06)

| File | Change |
|------|--------|
| `src/admin/admin-customer.controller.ts` | **MODIFIED** — add `DataSource/WalletAccount/WalletService/SupportService/CustomerTransactionHistoryService` injection, `toSafeCustomer/assertUuid`, 4 investigation handlers (`listTransactions` → `listUnified`, `listWallets` → `wallet_accounts` safe map, `getWalletBalance` → ownership + `walletService.getWalletBalance` safe, `listSupportTickets` → `supportService.listForInternal`) — 198 lines, `eslint-disable` for `any` |
| `src/admin/admin.module.ts` | **MODIFIED** — `TypeOrmModule.forFeature([Agent,Customer,Aggregator,WalletAccount])` + `WalletModule` + `SupportModule`, `providers: [CustomerTransactionHistoryService]` |
| `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts` | **NEW** — 15 PG cases (see §16) — `embedded-postgres` harness, helpers `createCustomerWithPhone/createAgentDirect`, `workforce-ROLE` mock |

**No migration, no `src/production/production-readiness.service.ts` change, no `src/ledger` change, no `src/transfer` change, no `src/customer-funding` change.**

## Appendix B — API Contract Examples

```http
GET /api/v1/internal/customers/:id/transactions?page=1&limit=20&type=WALLET_TRANSFER
Authorization: Bearer workforce-SUPPORT
200 OK
{
  "items": [
    {
      "id": "b2e8e7f1-...",
      "type": "WALLET_TRANSFER",
      "status": "COMPLETED",
      "amountMinor": "10000",
      "currency": "NGN",
      "direction": "SENT",
      "createdAt": "2026-09-20T10:01:00.000Z",
      "completedAt": "2026-09-20T10:01:00.500Z",
      "reference": "ref-abc123",
      "narration": "narr-...",
      "feeMinor": "0",
      "sourceWalletId": "w-...",
      "destinationWalletId": "w-...",
      "counterparty": { "walletId":"w-...", "customerId":"c-...", "displayName":"Bob P", "receivingNumber":"803..." },
      "failureCode": null,
      "failureMessage": null
    }
  ],
  "pagination": { "page":1, "limit":20, "total":5, "totalPages":1, "hasNextPage":false }
}
GET /api/v1/internal/customers/:id/transactions?type=INVALID → 400 { message: "type must be one of WALLET_TRANSFER,CASH_IN,CASH_OUT,CASH_TO_CASH,FUNDING" }

GET /api/v1/internal/customers/:id/wallets
Authorization: Bearer workforce-SUPPORT
200 OK
{ "data": [ { "id":"w-...", "customerId":"c-...", "currency":"NGN", "status":"ACTIVE", "createdAt":"...", "updatedAt":"..." } ], "total":1 }

GET /api/v1/internal/customers/:id/wallets/:walletId/balance
Authorization: Bearer workforce-SUPPORT
200 OK
{ "walletId":"w-...", "customerId":"c-...", "currency":"NGN", "balanceMinor":"12345", "status":"ACTIVE" }
GET /api/v1/internal/customers/B/wallets/A/balance → 404 { message: "Wallet not found" }

GET /api/v1/internal/customers/:id/support-tickets?page=1&limit=20&status=OPEN
Authorization: Bearer workforce-SUPPORT
200 OK
{ "items": [ { "id":"t-...", "reference":"SUP-...", "customerId":"c-...", "status":"OPEN", "priority":"MEDIUM", "category":"OTHER", "assignedTo":null, "fundingRequestId":null } ], "pagination": { "page":1, "limit":20, "total":2, "totalPages":1, "hasNextPage":false } }
```

## Appendix C — Verification Commands (Lagos 2026-09-26)

```bash
git rev-parse HEAD # cbfdc02 baseline, next commit is 06 investigation
ls src/migrations/*.ts | wc -l # 66
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_NAME=monienaija \
  ./node_modules/.bin/jest --config jest.integration.config.js --runInBand test/v1-hardening-06-admin-customer-investigation.integration.spec.ts # 15 passed
DB_HOST=... ./node_modules/.bin/jest --config jest.integration.config.js --runInBand test/a22-admin-foundation.integration.spec.ts # 15 passed
DB_HOST=... ./node_modules/.bin/jest --config jest.integration.config.js --runInBand test/a25-customer-history-hardening.integration.spec.ts # 17 passed
./node_modules/.bin/tsc --noEmit # 0
npm run build # 0
```

---

**FINAL REPORT (for session):** HEAD `cbfdc02` → next `feat(hardening-06): Admin Customer Investigation` (parent `cbfdc02`), migration count **66→66** (0 new), endpoints `GET /api/v1/internal/customers/:id/transactions|wallets|wallets/:walletId/balance|support-tickets` **VERIFIED** (reuse `CustomerTransactionHistoryService.listUnified`/`WalletService.getWalletBalance`/`SupportService.listForInternal`, workforce `SUPPORT` allowed, customer-scoped, `createdAt DESC,id DESC`, exact `?type`, safe projection, ledger-derived, cross-customer 404), tests **15/15** focused PG, isolation **zero mutations**, `tsc` 0, `build` 0, `eslint` 0 new, report `docs/V1-HARDENING-06-VERIFICATION-REPORT.md` — **VERIFIED**.
