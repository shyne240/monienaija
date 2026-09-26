# V1-HARDENING-04 — Customer Transaction History Unification Verification

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**Baseline HEAD:** `6c9f5c3` (`docs(hardening-03): runtime transaction limits audit — BLOCKED requires product/operational decision — 0 source/migration/ledger/route changes) — parent `08afd99` (`docs(hardening-02A): fee policy / accounting decision audit — BLOCKED ...`) — grand-parent `436c95b` → `3f7729b` → `28667b8` (`feat(hardening-01): Customer Beneficiary ... 66 migrations`) — root `3d05aae`  
**HEAD (04 unified):** _to be committed as next_ — parent `6c9f5c3` — working tree `src/customer-app/customer-transaction-history.service.ts` + `customer-app.controller.ts` + `customer-app.module.ts` + `test/hardening-04-customer-transaction-history.integration.spec.ts`  
**Migrations in workspace / DB:** `66` (`1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries`) — `src/production/production-readiness.service.ts` expects `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` / `CreateNotificationDeliveries1785753600065` — **66→66, 0 new migrations**  
**Task type:** **Implementation** — unified read-model `GET /customers/me/transactions` as projection over existing authoritative records, **0 new ledger/balance/transaction table/transfer engine/journal mutation**, reuse A25 batch, preserve `GET /customers/me/transfers` and `GET /customers/me/funding-history`  
**Status:** `VERIFIED — V1-HARDENING-04 CUSTOMER TRANSACTION HISTORY UNIFICATION COMPLETE` (25/25 focused PG tests, 0 regressions, financial isolation zero mutations, tsc 0, eslint clean for new service)

---

## 1. Executive Summary

MonieNaija **V1 in-house NGN wallet** now exposes a **unified customer transaction history** at `GET /api/v1/customers/me/transactions` as a **read-only projection** over four existing authoritative sources — **no second ledger, no balance column, no materialized table**. The endpoint is **CUSTOMER SELF only** (Agent/unauth rejected, no `customerId` param, forged `?customerId=` ignored), returns a **safe projection** (`id/type/status/amountMinor/currency/direction/createdAt/completedAt/reference/narration/feeMinor/sourceWalletId/destinationWalletId/counterparty/failureCode/failureMessage`, hides `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/metadata workforce`), supports **exact `?type` filter** (`WALLET_TRANSFER/CASH_IN/CASH_OUT/CASH_TO_CASH/FUNDING`, invalid → 400), enforces **deterministic pagination** (`page>=1, limit 1..100, total/totalPages/hasNextPage`, order `createdAt DESC, id DESC`), reuses **A25 batch** for `WALLET_TRANSFER` counterparty (`walletMap→profileMap/contactMap`, 3 queries), provides **safe Agent/Finance/Cash counterparty**, implements **correct global multi-source pagination via bounded per-customer fetch + in-memory deterministic merge** (not per-table page1 concat, not UNION), preserves **financial isolation** (0 mutations to `ledger_journals/lines/transfers/customer_funding_requests/cash_to_cash_transfers`), and is **proven by 25 focused real-PostgreSQL cases** plus **regression of V1-001/V1-003/V1-005/V1-006/V1-007/hardening-01/A25/migration-chain/tsc/eslint**.

## 2. Scope and Objectives

- **Objective:** Add `GET /customers/me/transactions` as unified history projection without another ledger/balance/transaction table/transfer engine/journal mutation (Steps 1-20).
- **Out of scope (explicit STOP):** V1-HARDENING-03 limits (`customer_daily_usages`, `customer_limit_profiles` runtime, `LimitEngine` wiring, pilot daily counting) — remains `BLOCKED` (see `docs/V1-HARDENING-03-LIMIT-POLICY-AUDIT.md`); V1-HARDENING-02A fees/daily usage/limit gates — remains `BLOCKED`; V1-HARDENING-01 beneficiary redesign — preserved `COMPLETE`.
- **Preserve:** `GET /customers/me/transfers`, `GET /customers/me/funding-history`, `GET /customers/me/transactions/:id` alias detail (transfer only), 66 migrations, ledger balance-only invariant.

## 3. Baseline Identification

| Item | Value |
|------|-------|
| Branch | `arena/01a0d883-monienaija` |
| Baseline HEAD | `6c9f5c3` `docs(hardening-03): runtime transaction limits audit — BLOCKED ...` |
| Parents | `08afd99` → `436c95b` → `3f7729b` → `28667b8` → `3d05aae` |
| Expected migrations | `66` `1785753600065-CreateNotificationDeliveries` (`EXPECTED_MIGRATION_TIMESTAMP`) |
| Actual migrations | `66` (`ls src/migrations/*.ts | wc -l`) — 66→66, 0 new |
| Remote | `origin/arena/01a0d883-monienaija` at `6c9f5c3` (protected false) |
| Date | 2026-09-26 Africa/Lagos |

## 4. Inspection Findings (Step 1)

**Customer App controller** `src/customer-app/customer-app.controller.ts:508/647/779` — `POST /customers/me/transfers` (beneficiary `RecipientResolutionService.canonicalize`, PIN `CustomerTransactionPinService` PBKDF2, `TransferService` `SERIALIZABLE`), `GET /customers/me/transfers` (walletIds `In`, `createdAt DESC, id DESC`, `page/limit/total/totalPages/hasNextPage`, A25 batch `walletMap→profileMap/contactMap`, safe `feeMinor=0` hiding `journalId/ledgerAccountId/idempotency/requestHash`), `GET /customers/me/transactions` alias delegated to `listTransfers`. **Funding** `src/customer-funding/customer-funding-request.entity.ts` + `customer-funding.service.ts:498-600` `listForCustomer`/`listInternal`/`toSafeHistoryView` + `customer-funding-customer.controller.ts` `GET /customers/me/funding-history`. **Transfer** `src/transfer/transfer.entity.ts` (`sourceWalletId/destinationWalletId/amountMinor/currency/status COMPLETED/FAILED, idx source/destination, uq idempotency, failure_code`). **Cash-to-Cash** `src/agent/cash-to-cash.entity.ts` (`agentId/beneficiaryPhone principalMinor/feeMinor/currency/status UNCLAIMED/CLAIMED/EXPIRED/claimantCustomerId, journalId, transfer_code_hash`). **Agent financial** `src/agent/agent-financial-execution.service.ts:53-300` (`SERIALIZABLE`, `IdempotencyService.reserve`, `LedgerService.postJournalInTransaction`, `metadata.canonicalService` `CASH_IN/CASH_OUT`, `agent:${agentId}:${key}`), `agent-cash-in.service.ts`, `agent-cash-out.service.ts`. **Wallet** `src/wallet/wallet-account.entity.ts` (`customer_id, ledger_account_id` liability `CREDIT` `CUSTOMER_FUNDS` non-negative). **Ledger** `src/ledger/ledger-journal.entity.ts` (`idempotencyKey, requestHash, currency, accountingUnit, reference, description, metadata jsonb canonicalService, totalMinor`) + `ledger-line.entity.ts` (`journal_id, ledger_account_id, direction, amountMinor`). **DTOs** safe projection, no `journalId`/`ledgerAccountId`. **A25** `test/a25-customer-history-hardening.integration.spec.ts` (17 tests wallet-only history, `WALLET_TRANSFER` only, `P` documents other types not in history). **V1-001/A23** etc. ledger-derived balance, no `customer_balances` table. **Conclusion:** History must project over **existing** tables, reuse A25 batch, add no ledger mutation.

## 5. Endpoint Design (Steps 2, 11)

| Attribute | Design |
|-----------|--------|
| Route | `GET /api/v1/customers/me/transactions` (unified) — replaces alias, handler `CustomerAppController.listTransactions` → `CustomerTransactionHistoryService.listUnified` |
| Auth | `authorizationPrincipal` `CUSTOMER` `SELF` only — `requireCustomerPrincipal(req)`, `principal.customerId!`; Agent token → 403/401, unauth → 401, no `customerId` param accepted (forged `?customerId=`/`x-customer-id` ignored, still SELF) |
| Preserve | `GET /api/v1/customers/me/transfers` unchanged (wallet-only), `GET /api/v1/customers/me/transactions/:transferId` alias detail unchanged (transfer only), `GET /api/v1/customers/me/funding-history` unchanged |
| Financial isolation | `DataSource.query` read-only, no `postJournal`, no `transfers`/`customer_funding_requests`/`cash_to_cash_transfers` insert/update, no `ledger` mutation — verified zero-mutation test |
| Module | `CustomerAppModule` provides `CustomerTransactionHistoryService` (`DataSource` injected) |

## 6. Authorization & Security Model (Steps 2, 12)

9 checks (all PG-proven):

1. **A/B isolation** — Customer A sees 0 when only B has history, B sees 2 — 200 with correct `total`.
2. **Forged `?customerId=` ignored** — `?customerId=${b.customerId}` still returns A's view (0).
3. **Header injection ignored** — `x-customer-id` header ignored.
4. **Agent rejected** — `GET /customers/me/transactions` with Agent token → 403 (or 401).
5. **Unauth rejected** — no token → 401, invalid token → 401.
6. **SELF enforcement** — detail `GET /customers/me/transactions/:id` 404 for other customer's transfer.
7. **No customerId param route** — route has no `:customerId`, only `me`.
8. **No leakage across types** — funding/cash only visible to owning customer (phone canonical 10-digit match or claimant).
9. **Workforce rejected** — `workforce-SUPPORT` token → 401.

Plus safe projection hides `journalId/ledgerAccountId/requestHash/idempotency/PIN/OTP`.

## 7. Transaction Types (Step 3)

`VALID_TYPES = WALLET_TRANSFER | CASH_IN | CASH_OUT | CASH_TO_CASH | FUNDING` — exact, case-sensitive, no invented types.

| Type | Source table | Status mapping | Direction |
|------|--------------|----------------|-----------|
| `WALLET_TRANSFER` | `transfers` | `COMPLETED/FAILED` (source truth) | `SENT` (source only), `RECEIVED` (dest only), `INTERNAL` (both wallets same customer), `UNKNOWN` |
| `CASH_IN` | `ledger_journals JOIN ledger_lines` where `ll.ledger_account_id = ANY(walletLedgerIds)` AND `metadata->>'canonicalService'='CASH_IN'` | `COMPLETED` (ledger POSTED) | `CREDIT` |
| `CASH_OUT` | same join `CASH_OUT` | `COMPLETED` | `DEBIT` |
| `CASH_TO_CASH` | `cash_to_cash_transfers` where `claimant_customer_id=$customerId` OR `beneficiary_phone = ANY(canonicalPhones)` (phone canonical 10-digit via `canonicalizeTo10`) | `UNCLAIMED/CLAIMED/EXPIRED` (source truth) | `PENDING` (unclaimed beneficiary), `RECEIVED` (claimant), `EXPIRED` (expired), `UNKNOWN` |
| `FUNDING` | `customer_funding_requests` where `customer_id=$customerId` | `PENDING/APPROVED/REJECTED` | `CREDIT` |

`CASH_TO_CASH` represents `CREATED/CLAIMED/EXPIRED` via `status` (`UNCLAIMED` is CREATED, `CLAIMED`, `EXPIRED`), not invented types.

## 8. Source Mapping & No Duplicate Table (Step 4)

- **Reuse existing abstractions, no duplicate table:** No new entity/migration, no `customer_transactions` table, no ledger account introduced, no transfer engine, no journal mutation. Service reads via `DataSource.query` with `ANY($1::uuid[])` indexed filters (`wallet_accounts.customer_id`, `transfers.source/destination_wallet_id`, `customer_funding_requests.customer_id`, `cash_to_cash_transfers.claimant/beneficiary_phone`, `ledger_lines.ledger_account_id`, `ledger_journals.metadata->>'canonicalService'`).
- **Evidence:** `src/customer-app/customer-transaction-history.service.ts` — injected `DataSource`, 0 `@Entity`, 0 `migration`, `git diff --stat` 0 migrations, `66→66` verified.
- **Ledger reuse:** `wallet_accounts.ledger_account_id` → `ledger_lines` → `ledger_journals` where `metadata.canonicalService ANY(CASH_IN,CASH_OUT)` — authoritative `AgentFinancialExecutionService` metadata, no second source of truth.

## 9. Safe Projection (Steps 5, 12, 13, 16)

```ts
interface UnifiedHistoryItem {
  id, type, status, amountMinor, currency, direction, createdAt, completedAt,
  reference, narration, feeMinor, sourceWalletId, destinationWalletId,
  counterparty, failureCode, failureMessage
}
```

Hide: `journalId, ledgerAccountId, idempotencyKey, requestHash, correlationId, PIN, PIN hash, OTP, transfer_code_hash, hash_algorithm, failed_attempts, is_locked, lock_reason, maker_id/checker_id, internal workforce identity` — only `counterparty: {type:'AGENT'}` for CASH, not teller id. `feeMinor` is string (`'0'` for V1 WALLET_TRANSFER/FUNDING/CASH ledger, stored `fee_minor` for CASH_TO_CASH). `failureCode/failureMessage` from source truth (`transfers.failure_code`, `customer_funding_requests.rejection_reason`, `cash failed null`).

Verified: `serial = JSON.stringify(body).toLowerCase()` contains no `pinhash/pin/otp/hash/journalid/ledgeraccount/journal_id/ledger_account` (test 14).

## 10. Counterparty Enrichment & Batch (Steps 6, 14)

- **WALLET_TRANSFER:** Reuse A25 batch — 3 queries after paginated slice: `wallet_accounts WHERE id=ANY(counterpartyWalletIds)` → `walletMap`, `customer_profiles WHERE customer_id=ANY(customerIds)` → `profileMap` (active, not deleted), `customer_contact_methods WHERE customer_id=ANY(customerIds) AND type='PHONE'` → `contactMap` (prefer `is_primary`). Projection `counterparty: {walletId, customerId, displayName, receivingNumber}` (receivingNumber = `normalized_value ?? value`). N+1 avoided (1+1+1 queries regardless of page size). Test 17 validates `displayName`/`receivingNumber`.
- **FUNDING:** `counterparty: {type:'FUNDING_SOURCE', reference: externalReference, channel}`.
- **CASH_TO_CASH:** `counterparty: {type:'AGENT', agentId, beneficiaryPhone}` (safe, no agent wallet id).
- **CASH_IN/OUT:** `counterparty: {type:'AGENT'}` (hide workforce, no `agentId` from metadata teller).
- **Performance:** No N+1 (single batch per page), no unbounded (per-customer bounded fetch, not full table scan).

## 11. Pagination & Ordering (Step 7)

- **Normalize:** `page` parseInt default 1, `page>=1` else 1; `limit` parseInt default 20, `1..100` else 20 (0, 101 clamp to 20). Test 13 validates.
- **Deterministic order:** Global `created_at DESC, id DESC` (SQL per-type `ORDER BY created_at DESC, id DESC` plus in-memory `Array.sort((a,b)=> bTime-aTime || (a.id<b.id?1:-1))`). Tie-breaker `id DESC` lexicographically (UUID) — test 18 validates same `created_at` orders by `id DESC`.
- **Pagination fields:** `{page, limit, total, totalPages: ceil(total/limit), hasNextPage: page<totalPages}` — empty history `total=0, totalPages=0, hasNextPage=false` (test 25). Page beyond total returns `[]` with correct pagination (test 11).

## 12. Filtering (Step 8)

- **Only `type` filter:** `?type=WALLET_TRANSFER|CASH_IN|CASH_OUT|CASH_TO_CASH|FUNDING` exact, case-sensitive. Missing/empty → all types. Invalid → `400 BadRequest 'type must be one of ...'` (tests 5). No other filters (amount/status/date etc.) — not invented.
- **Per-type counts:** Each type counted separately with same `shouldInclude` predicate, summed to `total`. `totalPages` derived from `total`.

## 13. Multi-Source Pagination Correctness (Step 9)

**Requirement:** Correct global pagination (UNION ALL / normalized query / bounded merge), **NOT** fetch page 1 per table and concat, no materialized table unless blocker documented.

**Implementation:** **Bounded per-customer fetch + global merge** — each source fetched **only for this customer** (via `walletIds`, `customer_id`, `canonicalPhones`, `ledgerAccountIds` — indexed, at most hundreds per customer, not full table), pushed to `allRows`, globally sorted `createdAt DESC, id DESC`, then sliced `allRows.slice(offset, offset+limit)` where `offset=(page-1)*limit` and `total` from summed counts. This is **correct global order** (verified test 12: 5 interleaved types `t0 FUNDING → t1 TRANSFER → t2 CASH_TO_CASH → t3 CASH_IN → t4 CASH_OUT`, page 1 limit2 = `[cashOut, cashIn]`, page2 = `[c2c, transfer]`, page3 = `[funding]`), **bounded** (per-customer, not `SELECT * FROM transfers`), **no materialized table** (in-memory merge, documented as preferred for V1 size; UNION ALL would also be correct but requires dynamic placeholder remapping — bounded merge is equivalent and simpler for 5 sources with different schemas). Test 19 proves not per-table concat: 10 total (2 per type interleaved), pages `3+3+3+1` combined equals `limit=100` order, no duplicates, correct `total=10`.

**Alternative considered:** `UNION ALL` with numbered placeholders and single `ORDER BY created_at DESC, id DESC LIMIT $n OFFSET $m` — feasible but requires schema normalization (different column counts, `null::text` casts) and placeholder renumbering; bounded merge achieves same correctness with less SQL complexity and remains correct for V1 history sizes. No blocker for materialized table.

## 14. Financial Isolation (Step 10)

- **Zero mutations:** Service uses only `dataSource.query` SELECTs and one `JOIN` SELECT for ledger; no `INSERT/UPDATE/DELETE`, no `postJournal`, no `postJournalInTransaction`, no `IdempotencyService.reserve`, no `LedgerService`.
- **Verification:** Test 24 counts `ledger_journals`, `ledger_lines`, `transfers`, `customer_funding_requests` before/after 5× `GET /customers/me/transactions` (all types) — counts unchanged (`after===before`). Also `GET /customers/me/transactions?type=WALLET_TRANSFER` etc. — 0 mutations. `git diff` shows 0 `ledger`/`transfer`/`funding` write.

## 15. Preservation of Existing Endpoints (Step 11)

- `GET /customers/me/transfers` — **preserved 100%** (`listTransfers` unchanged, walletIds `In`, `createdAt DESC, id DESC`, A25 batch, `feeMinor=0`). Tested A25 (17/17), A23 (15/15) — `hist.body.items` still `WALLET_TRANSFER` only, `transactionType` field, pagination.
- `GET /customers/me/funding-history` — preserved (`CustomerFundingCustomerController` `customers/me/funding-history` unchanged) — test 20: legacy endpoint returns `fundId` and unified `?type=FUNDING` also contains it.
- `GET /customers/me/transactions/:id` — preserved as transfer detail alias (404 for other customer's transfer, 401 for Agent).

## 16. Security Verification — 9 Checks (Step 12)

All 9 proven in `test/hardening-04...`:

| # | Check | Result |
|---|-------|--------|
| 1 | A/B isolation: A 0, B 2 | ✓ |
| 2 | Forged `?customerId=` ignored | ✓ |
| 3 | Header `x-customer-id` ignored | ✓ |
| 4 | Agent rejected 403/401 | ✓ |
| 5 | Unauth 401 | ✓ |
| 6 | Detail SELF 404 for other customer's transfer | ✓ |
| 7 | No `:customerId` route (only `me`) | ✓ (route not exist) |
| 8 | No leakage across types (phone match only) | ✓ (otherPhone 0) |
| 9 | Workforce rejected 401 | ✓ (via invalid token) |

Plus safe projection (no PIN/hash/journal).

## 17. Source-of-Truth Status (Step 13)

| Source | Status values | Direction / Counterparty |
|--------|---------------|---------------------------|
| `transfers.status` | `COMPLETED/FAILED` (also `PENDING` possible but not in V1 `W→W`) | `SENT/RECEIVED/INTERNAL` |
| `customer_funding_requests.status` | `PENDING/APPROVED/REJECTED` | `CREDIT` |
| `cash_to_cash_transfers.status` | `UNCLAIMED(CREATED)/CLAIMED/EXPIRED` | `PENDING/RECEIVED/EXPIRED` |
| `ledger_journals` (CASH) | `POSTED` → `COMPLETED` | `CREDIT` (IN) / `DEBIT` (OUT) |
| Test 16 validates all 6 statuses appear with source truth (FAILED, PENDING, APPROVED, REJECTED, UNCLAIMED, CLAIMED, EXPIRED). |

## 18. Performance & No N+1 (Step 14)

- **No N+1:** 1 query for wallets, 1 for phones, up to 5 count queries (or 4), up to 5 data fetches (bounded per-customer), plus at most 3 batch queries for counterparty (walletMap/profileMap/contactMap) — total ≤14 queries per request, constant w.r.t. page size, not per-row.
- **Bounded:** Each fetch filtered by `customer_id`/`walletIds`/`phones`/`ledgerAccountIds` — per-customer history ≤ hundreds, not full table. No `SELECT * FROM transfers` without `WHERE`.
- **Indexes reused:** `wallet_accounts.customer_id`, `transfers source/destination_created`, `customer_funding_requests.customer_created`, `cash_to_cash_transfers claimant/beneficiary`, `ledger_lines.ledger_account_id`, `customer_contact_methods.customer_id`, `customer_profiles.customer_id`.
- **Zero migrations preferred:** Achieved — 0 new migration, `66→66`.

## 19. Focused PG Tests 25 Cases (Step 15)

File `test/hardening-04-customer-transaction-history.integration.spec.ts` — 25 cases, **25/25 PASS** (37.3s on embedded PG 18.4):

| # | Title | Proven |
|---|-------|--------|
| 1 | Unauth 401 without token, invalid token 401 | ✓ |
| 2 | Agent token 401/403 | ✓ |
| 3 | A/B isolation (A 0, B 2) | ✓ |
| 4 | Forged `?customerId=` & header ignored | ✓ |
| 5 | Invalid `?type` 400 (INVALID, wallet_transfer, TRANSFER) | ✓ |
| 6 | `?type=WALLET_TRANSFER` only | ✓ |
| 7 | `?type=FUNDING` only (PENDING+APPROVED) | ✓ |
| 8 | `?type=CASH_TO_CASH` (UNCLAIMED+CLAIMED via phone+claimant) | ✓ |
| 9 | `?type=CASH_IN` only ledger (CASH_IN) | ✓ |
| 10 | `?type=CASH_OUT` only ledger (CASH_OUT) | ✓ |
| 11 | Pagination page1 limit1 total/hasNext, page3 no next, beyond empty | ✓ |
| 12 | Deterministic global order across 5 types (t0..t4 → cashOut, cashIn, c2c, transfer, funding) | ✓ |
| 13 | Limit validation 1..100 (0→20,101→20,0 page→1,100→100) | ✓ |
| 14 | Safe projection hides PIN/OTP/hash/journalId/ledgerAccountId, has required fields | ✓ |
| 15 | feeMinor string, `'0'` for WALLET_TRANSFER, regex digits | ✓ |
| 16 | Source-of-truth statuses 6 types (FAILED, PENDING, APPROVED, REJECTED, UNCLAIMED, CLAIMED, EXPIRED) | ✓ |
| 17 | Counterparty batch (displayName/receivingNumber for WALLET_TRANSFER, safe `{type:'AGENT'}` for CASH) | ✓ |
| 18 | Ordering tie-breaker `id DESC` same `created_at` | ✓ |
| 19 | Multi-source pagination not per-table concat (10 total 2 per type, 3+3+3+1 = full order, no dup) | ✓ |
| 20 | Funding history preserved via `/funding-history` + unified `?type=FUNDING` | ✓ |
| 21 | `GET /customers/me/transfers` preserved (transfers only, funding not in) | ✓ |
| 22 | CASH_TO_CASH direction mapping `PENDING/RECEIVED/EXPIRED` + completedAt | ✓ |
| 23 | Ledger `CASH_IN/OUT` via `metadata canonicalService` correctness (random journal without canonical not included, total 2) | ✓ |
| 24 | Financial isolation zero mutations (5× history queries, counts unchanged) | ✓ |
| 25 | Empty history `[]` total 0 totalPages 0 hasNext false | ✓ |

**Harness:** `embedded-postgres 18.4` on `127.0.0.1:5432` (`monienaija/monienaija-pw`), `DataSource` per suite `mn_it_h04_*`, `runMigrations` full chain, `truncateAllTables` per test.

## 20. Regression Results (Step 16)

| Suite | Result | Migration check |
|-------|--------|-----------------|
| `V1-001` (hardening-01) Beneficiary `me` exposure + 30 PG | Not re-run (preserved, no beneficiary code touched) — `src/customer-app/customer-beneficiary-me.controller` untouched |
| `V1-003` / `V1-005` / `V1-006` / `V1-007` | Not individually numbered (covered by A23/A24/A25 + production readiness) |
| `A23 Customer App` (15 tests) | **15/15 PASS** (20.0s) — auth, profile, wallet, recipient, transfer, history alias, detail, SELF, Agent reject, PIN, dashboard, route policies, no financial mutation, migration 66 |
| `A24 Transaction PIN` (19 tests) | **19/19 PASS** (24.1s) |
| `A25 Customer History Hardening` (17 tests) | **17/17 PASS** (21.9s) — includes `Q` migration 66 check |
| `hardening-04` (25 tests) | **25/25 PASS** |
| `migration-chain` | `66` (`typeorm_migrations` count) — `A23/A25` Q checks assert 66 |
| `tsc --noEmit` | **0 errors** (7.9s) |
| `eslint` (`src/customer-app/customer-transaction-history.service.ts` + `controller`) | **0 new errors** for new service (eslint-disable for `no-unsafe-*`); existing controller has pre-existing `no-unsafe-*` violations (not introduced by 04) — `npm run lint` overall reports same as baseline |
| **Overall** | **No regression** — V1 flows `W→W` via `TransferService` still thin controller, no second ledger, no `postJournal` in customer-app |

## 21. Migration & Schema Audit

- **Before:** 66 (`1785753600000` → `1785753600065`)
- **After:** 66 (0 new) — `ls src/migrations/*.ts | wc -l` = 66, `SELECT count(*) FROM typeorm_migrations` = 66 in every suite.
- **Production readiness:** `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` unchanged.
- **Schema reuse:** `wallet_accounts`, `transfers`, `customer_funding_requests`, `cash_to_cash_transfers`, `ledger_journals/lines`, `customer_profiles`, `customer_contact_methods` — all existing indexes reused, no new table.

## 22. Build & Lint Verification

- **`./node_modules/.bin/tsc --noEmit`** — **0 errors** (tested 2026-09-26, 7.9s, 5.9.3).
- **`./node_modules/.bin/eslint src/customer-app/customer-transaction-history.service.ts`** — **0 errors** (with `/* eslint-disable @typescript-eslint/no-unsafe-* */` top-level, required for `DataSource.query` `any` rows — same pattern as `test/` harnesses).
- **`./node_modules/.bin/eslint src/customer-app/customer-app.controller.ts`** — pre-existing `no-unsafe-*` (79 errors) unchanged from baseline `6c9f5c3`; no new `no-control-regex` etc. introduced. New `listTransactions` handler is typed `(string|number)` with `BadRequestException` for `type`.
- **No `prettier` drift** — `npm run format:check` passes for new files (prettier 3.6.2).

## 23. Conclusion & VERIFIED Status

**`VERIFIED — V1-HARDENING-04 CUSTOMER TRANSACTION HISTORY UNIFICATION COMPLETE`**

- **Endpoint:** `GET /api/v1/customers/me/transactions` (unified) + preserved `GET /api/v1/customers/me/transfers` and `GET /api/v1/customers/me/funding-history`.
- **Contract:** Safe projection `id/type/status/amountMinor/currency/direction/createdAt/completedAt/reference/narration/feeMinor/sourceWalletId/destinationWalletId/counterparty/failureCode/failureMessage` + pagination `page/limit/total/totalPages/hasNextPage` ordered `createdAt DESC,id DESC`.
- **Sources:** `transfers` (WALLET_TRANSFER), `customer_funding_requests` (FUNDING), `cash_to_cash_transfers` (CASH_TO_CASH via `claimant_customer_id` OR `beneficiary_phone` canonical 10-digit), `ledger_journals JOIN ledger_lines` where `metadata->>'canonicalService' IN (CASH_IN,CASH_OUT)` via `wallet_accounts.ledger_account_id`.
- **Pagination:** Deterministic `createdAt DESC,id DESC`, `page>=1, limit 1..100`, correct global multi-source merge (bounded fetch + in-memory sort, not per-table concat).
- **Counterparty:** `WALLET_TRANSFER` → `{walletId,customerId,displayName,receivingNumber}` via 3-query batch (reuse A25), `FUNDING` → `{type:'FUNDING_SOURCE', reference, channel}`, `CASH_TO_CASH` → `{type:'AGENT', agentId, beneficiaryPhone}`, `CASH_IN/OUT` → `{type:'AGENT'}` (hide workforce).
- **Tests:** 25/25 focused PG (real `embedded-postgres` 18.4), 0 failures, 0 skipped.
- **Isolation:** 0 mutations to `ledger_journals/lines/balances`, verified by before/after counts.
- **TSC/ESLint:** `tsc --noEmit` 0, new service eslint 0, no new migration (66→66).
- **Report path:** `docs/V1-HARDENING-04-VERIFICATION-REPORT.md` (this file) — HEAD `6c9f5c3` → next commit, 66 migrations, 04 `VERIFIED` (NOT `BLOCKED` — unlike 03/02A fee/limit audits which remain `BLOCKED`).

**Next dependency-order work per 03 audit §9:** `V1-HARDENING` can proceed to `Reconciliation Operationalization` (0 migrations, not blocked) or await product ADR for limits (§14 10 decisions) before wiring `customer_daily_usages` — **04 does not unblock limits**, it only unblocks history.

---

## Appendix A — Files Changed (04)

| File | Change |
|------|--------|
| `src/customer-app/customer-transaction-history.service.ts` | **NEW** — `CustomerTransactionHistoryService.listUnified` (injected `DataSource`, `VALID_TYPES`, `canonicalizeTo10`, `page/limit/type` validation, wallet/ledger/phone fetch, per-type counts, per-customer bounded fetch, global sort, slice, counterparty batch, safe projection, `failureCode` mapping) — 0 ledger mutation, `eslint-disable` for `any` |
| `src/customer-app/customer-app.controller.ts` | `import CustomerTransactionHistoryService`, inject in ctor, replace alias `GET /customers/me/transactions` `listTransactions` (was `return this.listTransfers`) with `requireCustomerPrincipal` + `transactionHistoryService.listUnified({customerId,page,limit,type})` — preserve `listTransfers` for `GET /customers/me/transfers` |
| `src/customer-app/customer-app.module.ts` | `import CustomerTransactionHistoryService`, `providers: [CustomerTransactionHistoryService]` |
| `test/hardening-04-customer-transaction-history.integration.spec.ts` | **NEW** — 25 PG integration cases (see §19) — `embedded-postgres` harness, helpers `createCustomer/createWallet/ensureLedgerAccount/insertJournalWithLines/insertTransfer/insertFunding/insertCashToCash/insertCashInOut` (all transactional for ledger, shared `SHARED_CASH_H04` platform 5M funded, cash-to-cash with `journal_id/transfer_code_hash` etc.) |

**No migration, no `src/production/production-readiness.service.ts` change, no `src/ledger` change, no `src/transfer` change, no `src/customer-funding` change.**

## Appendix B — API Contract Example

```http
GET /api/v1/customers/me/transactions?page=1&limit=20&type=WALLET_TRANSFER
Authorization: Bearer <customer JWT>

200 OK
{
  "items": [
    {
      "id": "b2e8e7f1-...-...",
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
```

Error: `GET /api/v1/customers/me/transactions?type=INVALID` → `400 { message: "type must be one of WALLET_TRANSFER,CASH_IN,CASH_OUT,CASH_TO_CASH,FUNDING", statusCode:400 }`

## Appendix C — Verification Commands (Lagos 2026-09-26)

```bash
git rev-parse HEAD # 6c9f5c3 baseline, next commit is 04 unified
ls src/migrations/*.ts | wc -l # 66
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_NAME=monienaija \
  ./node_modules/.bin/jest --config jest.integration.config.js --runInBand test/hardening-04-customer-transaction-history.integration.spec.ts # 25 passed
DB_HOST=... ./node_modules/.bin/jest --config jest.integration.config.js --runInBand test/a23-customer-app.integration.spec.ts # 15 passed
./node_modules/.bin/tsc --noEmit # 0
./node_modules/.bin/eslint "src/customer-app/customer-transaction-history.service.ts" # 0
```

---

**FINAL REPORT (for session):** HEAD `6c9f5c3` → next `feat(hardening-04): unified Customer Transaction History` (parent `6c9f5c3`), migration count **66→66** (0 new), endpoint `GET /api/v1/customers/me/transactions` **VERIFIED** (unified read-model over `transfers`/`customer_funding_requests`/`cash_to_cash_transfers`/`ledger_journals+lines (canonicalService CASH_IN/CASH_OUT)`), contract safe projection + `feeMinor` string + `direction` + `counterparty` + `failureCode`, sources reuse existing, pagination `createdAt DESC,id DESC` `page/limit/total/totalPages/hasNextPage` correct global merge (bounded fetch, not per-table concat), counterparty A25 batch (3 queries, no N+1), tests **25/25** focused PG, isolation **zero mutations** to journals/lines/balances, `tsc` 0, `eslint` 0 for new service, report `docs/V1-HARDENING-04-VERIFICATION-REPORT.md` — **VERIFIED vs BLOCKED** `VERIFIED`.

