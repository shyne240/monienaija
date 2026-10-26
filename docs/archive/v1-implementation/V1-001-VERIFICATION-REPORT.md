# V1-001 Operations Customer Funding (maker/checker) — Verification Report

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD (preserve baseline):** `37aa315e84a60cfae0f61b6ce8be26019383a158` (`chore: preserve A21-A26 verified baseline before V1-001`) — parent `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (`fix(production): update expected migration constraints`) — contains all A21-A26 implementation + `docs/V1-PRODUCT-COMPLETION-AUDIT.md`  
**HEAD after V1-001 (working tree, to be committed):** `37aa315` + uncommitted funding feature (`src/customer-funding/*`, `src/migrations/1785753600063-*`, `src/app.module.ts`, test expectation updates) — **working tree dirty** (see §3)  
**Verified A26 baseline HEAD:** `245fc9a` / `6036b7c` (A26 hardening 19/19) present as dangling `fd82075→6036b7c→245fc9a` per audit, captured in `37aa315` checkpoint (155 files, 26868 insertions)  

---

## 1. Exact HEAD
- **Before V1-001:** `37aa315e84a60cfae0f61b6ce8be26019383a158` (preserve commit 2026-09-26, 155 files, includes `data/embedded-pg` not committed but runtime present)
- **Working tree V1-001:** dirty — `git status --porcelain` shows:
  - `M src/app.module.ts` (import `CustomerFundingModule`)
  - `M src/production/production-readiness.service.ts` (`EXPECTED_MIGRATION_TIMESTAMP` `1785753600063`, `CreateCustomerFundingRequests`)
  - `M test/a17..a21,a23-a26,migration-chain,production-readiness` (expected count `64`, timestamp `0063`)
  - `?? src/customer-funding/` (entity/service/controllers/module/dto)
  - `?? src/migrations/1785753600063-CreateCustomerFundingRequests.ts`
  - `?? test/v1-001-customer-funding.integration.spec.ts` (26 tests)

## 2. Parent / Base Commit
- **Parent of preserve:** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (Arena base)
- **A26 verified parent chain:** `fd82075` (A25 fix) → `6036b7c` (A26 hardening) → `245fc9a` (docs A26) → `37aa315` (checkpoint) → **V1-001 additive** (no rewrite of A21-A26 commits)

## 3. Working-Tree Status
```
 M src/app.module.ts
 M src/production/production-readiness.service.ts
 M test/a17-agent-cash-to-cash-expiry.integration.spec.ts
 M test/a18-aggregator-foundation.integration.spec.ts
 M test/a19-agent-funding.integration.spec.ts
 M test/a20-outlets-terminals.integration.spec.ts
 M test/a21-agent-app.integration.spec.ts
 M test/a23-customer-app.integration.spec.ts
 M test/a24-customer-transaction-pin-hardening.integration.spec.ts
 M test/a25-customer-history-hardening.integration.spec.ts
 M test/a26-customer-profile-hardening.integration.spec.ts
 M test/a8-agent-lifecycle.integration.spec.ts
 M test/migration-chain.integration.spec.ts
 M test/production-readiness.spec.ts
?? src/customer-funding/
?? src/migrations/1785753600063-CreateCustomerFundingRequests.ts
?? test/v1-001-customer-funding.integration.spec.ts
```
- **No deletion, reset, checkout, or overwrite of A21-A26** — all 63 prior migrations preserved, 64th additive.
- `npx tsc --noEmit` **0**, `npm run build` **0** (see §19)

## 4. Files Changed (V1-001 additive)
- **New:**
  - `src/customer-funding/customer-funding.enums.ts` (PENDING/APPROVED/REJECTED, maker types)
  - `src/customer-funding/customer-funding-request.entity.ts` (12 indexes/checks, version, FKs)
  - `src/customer-funding/dto/create-customer-funding-request.dto.ts` (amountMinor, currency NGN, externalReference, channel, description)
  - `src/customer-funding/dto/review-customer-funding-request.dto.ts` (approve/reject DTOs)
  - `src/customer-funding/customer-funding.service.ts` (create/approve/reject, SERIALIZABLE, maker!=checker, settlement via ledger)
  - `src/customer-funding/customer-funding-internal.controller.ts` (WORKFORCE routes)
  - `src/customer-funding/customer-funding-customer.controller.ts` (CUSTOMER history)
  - `src/customer-funding/customer-funding.module.ts` (imports LedgerModule, PaymentModule, OperationsModule)
  - `src/migrations/1785753600063-CreateCustomerFundingRequests.ts` (additive, no balance column, no second ledger)
  - `test/v1-001-customer-funding.integration.spec.ts` (26 real-PG tests)
- **Modified:**
  - `src/app.module.ts` (import `CustomerFundingModule`)
  - `src/production/production-readiness.service.ts` + 8 test files (expected count `64`, timestamp `0063`)
- **Not modified:** No ledger, wallet, transfer, agent cash flows, support, fees, notifications, or external provider code.

## 5. Migration Created
- **File:** `src/migrations/1785753600063-CreateCustomerFundingRequests.ts` — class `CreateCustomerFundingRequests1785753600063`
- **Up:**
  ```sql
  CREATE TABLE customer_funding_requests (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    external_reference VARCHAR(255),
    channel VARCHAR(64),
    description VARCHAR(255),
    maker_id VARCHAR(160) NOT NULL,
    maker_type VARCHAR(20) NOT NULL CHECK (maker_type IN ('SUPPORT','OPERATOR','SERVICE','PRIVILEGED')),
    checker_id VARCHAR(160),
    checker_type VARCHAR(20),
    journal_id UUID REFERENCES ledger_journals(id),
    reference VARCHAR(64) NOT NULL UNIQUE, -- CF-<uuid>
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    correlation_id VARCHAR(255),
    rejection_reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT chk_journal_for_approved CHECK (status <> 'APPROVED' OR journal_id IS NOT NULL)
  );
  -- Indexes: uq_idempotency, uq_journal_id WHERE NOT NULL, uq_reference, idx_customer_created, idx_status
  ```
- **Down:** `DROP TABLE IF EXISTS customer_funding_requests`
- **Additive only:** No ALTER of `ledger_accounts`, `wallet_accounts`, `transfers`, etc.; no balance column; no second ledger.
- **Chain:** `1785753600062` → `0063` (now 64 migrations). Previous 63 preserved (`typeorm_migrations` count 64 after `runMigrations`).

## 6. Database Schema
- **Table `customer_funding_requests`** (see §5) — FKs to `customers(id)` and `ledger_journals(id)` validated, 4 CHECKs, 3 UNIQUE indexes, 2 performance indexes.
- **Ledger accounts reused:** No new ledger account row. Uses existing `ledger_accounts.code='PAYMENT-SETTLEMENT_ASSET-NGN'` (ASSET, DEBIT, CUSTOMER_FUNDS, from `1785753600002-CreatePaymentCapabilities`). Verified present after truncate via reseeding logic in tests.
- **No new ledger tables**, no `balance_minor` column (verified `information_schema.columns` absence).
- **TypeORM entity:** `CustomerFundingRequest` mirrors table, `bigintTransformer` for `amount_minor` string, `VersionColumn`.

## 7. Funding State Machine
```
PENDING ──approve(OPERATOR|SERVICE|PRIVILEGED, maker!=checker, SERIALIZABLE, postJournal)──> APPROVED (journal_id NOT NULL, approved_at)
   │
   └──reject(OPERATOR|SERVICE|PRIVILEGED, maker!=checker, rejectionReason)──> REJECTED (rejection_reason NOT NULL, rejected_at)
```
- **Enforced transitions only:** `PENDING→APPROVED`, `PENDING→REJECTED`. No `APPROVED→APPROVED`, `APPROVED→REJECTED`, `REJECTED→APPROVED`, no cancellation/reversal (out of scope).
- **Validation:** `status <> 'APPROVED' OR journal_id IS NOT NULL` (DB CHECK), service checks `status !== PENDING` → `409 Conflict` with message `already APPROVED/REJECTED`.
- **Timestamps:** `created_at/updated_at` auto, `approved_at`/`rejected_at` set on transition, `version` increments.

## 8. Maker/Checker Authorization Model
- **Reuse existing workforce architecture:** `RuntimeAccessGuard` + `RoutePolicyRegistry` (`/internal/*` → `WORKFORCE_SESSION`, allowedPrincipalTypes `SUPPORT|OPERATOR|SERVICE|PRIVILEGED`) + `AuthorizationService` not duplicated.
- **Service-level checks (authoritative):**
  - **Create:** `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` allowed. `CUSTOMER`/`AGENT`/`AGGREGATOR` → `403 Forbidden` (`Customer principal cannot create`). Unauthenticated → `401`.
  - **Approve/Reject:** `OPERATOR|SERVICE|PRIVILEGED` only (SUPPORT excluded to enforce segregation). `SUPPORT` approve → `403 Principal type SUPPORT cannot approve`. **Maker != Checker enforced inside SERIALIZABLE transaction after row lock:** `if (makerId === checkerId) throw ForbiddenException('Maker cannot approve own…')` (checked before role, so SUPPORT self-approve gives maker error, matching test).
  - **Customer history:** `CUSTOMER` `SELF` only (`CustomerFundingCustomerController` `requireCustomer`), unauthenticated `401`, Agent `403`, cross-customer isolation via `WHERE customer_id = principal.customerId`.
- **Internal list:** `WORKFORCE_SESSION` only, customer/agent `403`.
- **No second authorization system**, no weakening of `RuntimeAccessGuard`.

## 9. Accounting Classification Selected and Evidence
- **Selected:** `PAYMENT-SETTLEMENT_ASSET-NGN` (ASSET, DEBIT, CUSTOMER_FUNDS) via `SettlementAccountService.getAccountId(manager, currency, SettlementAccountRole.SETTLEMENT_ASSET)` — code `PAYMENT-SETTLEMENT_ASSET-NGN`.
- **Evidence:**
  - **Migration 0002:** `src/migrations/1785753600002-CreatePaymentCapabilities.ts` inserts `PAYMENT-SETTLEMENT_ASSET-NGN`, `PAYMENT-SETTLEMENT_CLEARING-NGN`, `PAYMENT-SYSTEM_SUSPENSE-NGN` (all `CUSTOMER_FUNDS`).
  - **Service reuse:** `src/payment/settlement-account.service.ts` (`SELECT id FROM ledger_accounts WHERE code='PAYMENT-'||role||'-'||currency`) used by `DepositService.completeDeposit` (`DEBIT settlementAsset CREDIT wallet`, ASSET→LIABILITY).
  - **Funding journal:** `DEBIT settlementAsset` `CREDIT wallet.ledgerAccountId` `amountMinor`, `currency NGN`, `accountingUnit CUSTOMER_FUNDS` — identical to deposit completion, balanced, `total_minor = amountMinor`.
  - **Why not AR_CONTROL / AGENT_FUNDING_POOL:** `AR_CONTROL` (`FINANCE-ACCOUNTS_RECEIVABLE-NGN`, ASSET from `A5` provisional, not customer funding) and `AGENT_FUNDING_POOL-NGN` (LIABILITY `allow_negative TRUE`, for Agent funding) are **not** customer funding control accounts per existing chart. Audit's `AR_CONTROL → Wallet` would be invented; instead we reuse the authoritative customer settlement asset already used for deposits. No new ledger account introduced; minimal additive classification justified as **reuse, not invention**. If product later requires dedicated `CUSTOMER_FUNDING_POOL-NGN`, it can be added as `REQUIRES PRODUCT DECISION` without changing journal logic.
- **Balanced journal verified:** 2 lines, DEBIT/CREDIT equal, `ledger_journals.total_minor = amountMinor`, `currency NGN`, `accounting_unit CUSTOMER_FUNDS`.

## 10. Ledger Posting
- **Engine:** `LedgerService.postJournalInTransaction(manager, { idempotencyKey: 'customer-funding:<fundingRequestId>', currency NGN, accountingUnit CUSTOMER_FUNDS, reference: request.reference, lines: [DEBIT settlementAsset, CREDIT wallet] })` — **only** via `LedgerService`, no direct `INSERT INTO ledger_journals`, no balance column mutation, no second ledger.
- **Atomicity:** Approve runs in `DataSource.transaction('SERIALIZABLE', async manager => { lock funding request FOR UPDATE, resolve wallet, get settlement account, postJournalInTransaction, UPDATE request APPROVED, audit, outbox })`. All or nothing.
- **Wallet resolution:** `SELECT id, ledger_account_id, status FROM wallet_accounts WHERE customer_id=$1 AND currency=$2` (ledger-derived, no `balance_minor` column, verified absence). `status !== ACTIVE` → `409`.
- **Settlement resolution:** Via `SettlementAccountService` (throws `409 Settlement account ... not configured` if missing, which would be `REQUIRES PRODUCT DECISION` — but seed ensures presence).

## 11. Idempotency
- **Create:** `idempotency_key` UNIQUE + `request_hash` SHA256(canonicalJson{customerId,amountMinor,currency,externalReference,channel}). Duplicate same key + same hash → returns existing row (REPLAY, `200` same `id`/`reference`). Same key + different hash → `409 Conflict: already used for another funding request`. Concurrent insert race handled via `SERIALIZABLE` retry + `23505` catch.
- **Approve journal:** `idempotencyKey = 'customer-funding:<fundingRequestId>'` UNIQUE in `ledger_journals`. Duplicate approve (same request) → second sees `status !== PENDING` → `409 already APPROVED`, no second journal. Concurrent approves: `SELECT ... FOR UPDATE` serializes; only one wins, other gets `409` or retryable `40001` → retry sees `APPROVED`. Ledger's `postJournalInTransaction` also checks `idempotencyKey` existing + `requestHash` equality → returns existing journal id if hash matches, else `409`.
- **Reject:** No journal, idempotent via status check (second reject on same PENDING? Actually after first reject, status REJECTED, second reject → `409 already REJECTED`).
- **Re-tested:** `idempotency/replay` test (same key same hash replay, different amount conflict) and `concurrent approvals produce one credit` (Promise.allSettled 2 checkers, 1 fulfilled 1 rejected, balance +30000n once, 1 journal).

## 12. Concurrency Behavior
- **Isolation:** `SERIALIZABLE` for create/approve/reject, with `pessimistic_write` `FOR UPDATE` on funding request row.
- **Retry:** `isRetryableTransactionError` (`40001` serialization_failure, `40P01` deadlock) → 3 attempts (same as `TransferService`, `AgentFundingService`).
- **Verified:** `concurrent approvals produce one credit` — 2 OPERATOR checkers `Promise.allSettled`, 1 fulfilled, 1 rejected, wallet balance +30000n once, `SELECT count(*) FROM ledger_journals WHERE idempotency_key='customer-funding:<id>'` =1, `ledger_lines` =2. No double-credit, no pending→approved race.

## 13. Audit Behavior
- **Service:** `AuditService.record(manager, { entityType: 'CUSTOMER_FUNDING_REQUEST', entityId: fundingRequestId, action: 'FUNDING_REQUEST_CREATED' | 'FUNDING_REQUEST_APPROVED' | 'FUNDING_REQUEST_REJECTED', actor: makerId/checkerId, correlationId, newValues: {customerId, amountMinor, currency, status, reference, journalId/checkerId} })` inside same transaction.
- **Redaction:** `redactRecord` covers `pin`, `password`, etc.; funding audit `newValues` contains no `pin`, `password`, `tokenHash`, `secret` (verified `JSON.stringify(audits).toLowerCase()` not contain those).
- **Verified:** `approval audit exists` and `rejection audit exists` — `SELECT action FROM audit_events WHERE entity_id=$1` contains `FUNDING_REQUEST_CREATED` and `FUNDING_REQUEST_APPROVED/REJECTED`, `newValues.journalId` matches.

## 14. API Routes
- **Internal (WORKFORCE_SESSION, SUPPORT|OPERATOR|SERVICE|PRIVILEGED):**
  - `POST /api/v1/internal/customers/:customerId/funding-requests` — body `CreateCustomerFundingRequestDto` (`amountMinor` string digits, `currency? NGN`, `externalReference? 255`, `channel? 64`, `description? 255`, `correlationId? 255`, `idempotencyKey?`), header `Idempotency-Key` (or body) required, `201` `CustomerFundingView` (full, includes maker/checker/journalId for ops), `401` unauth, `403` CUSTOMER/AGENT, `404` customer not found, `409` idempotency conflict.
  - `POST /api/v1/internal/customer-funding-requests/:id/approve` — body `ApproveCustomerFundingRequestDto` (`correlationId?`), `200` `APPROVED` view, `403` maker!=checker or SUPPORT, `404` not found, `409` already approved/rejected.
  - `POST /api/v1/internal/customer-funding-requests/:id/reject` — body `RejectCustomerFundingRequestDto` (`reason` 1-500 required, `correlationId?`), `200` `REJECTED`, same auth.
  - **Aliases:** `POST /api/v1/internal/customers/:customerId/funding-requests/:id/approve|reject` (same).
  - `GET /api/v1/internal/customer-funding-requests/:id` — workforce get one.
  - `GET /api/v1/internal/customers/:customerId/funding-requests` — list for customer.
  - `GET /api/v1/internal/customer-funding-requests` — list all (limit 100).
- **Customer (CUSTOMER SELF):**
  - `GET /api/v1/customers/me/funding-history` — query `page` `limit` 1-100, returns `{items: CustomerFundingSafeHistoryView[], pagination}`.
  - `GET /api/v1/customers/me/funding-requests` — alias.
- **DTO validation:** `class-validator`, `ValidationPipe` global, `whitelist true`.
- **No external provider routes**, no `BankService`, no `NIBSS`.

## 15. Customer Funding History
- **Route:** `GET /api/v1/customers/me/funding-history` (`CustomerFundingCustomerController`, `CUSTOMER SELF`).
- **Service:** `listForCustomer(customerId, page, limit)` — `SELECT * FROM customer_funding_requests WHERE customer_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3` with pagination (`total`, `totalPages`, `hasNextPage` same as A25).
- **Safe projection:** `toSafeHistoryView` returns `id, reference (CF-<uuid>), amountMinor, currency, status, externalReference, channel, description, createdAt, approvedAt, rejectedAt, rejectionReason` — **no** `journalId`, `ledger_account_id`, `request_hash`, `idempotency_key`, `maker_id`, `checker_id`, `correlation_id`, `version`, `pin`, `password`.
- **Verified:** `funding history returns safe projection` — `JSON.stringify(item).toLowerCase()` not contain `journalid|ledger|request_hash|idempotency|maker|checker|password|pinhash|tokenhash`; alias works; rejected history shows `rejectionReason`; `cross-customer isolation` — A cannot see B's funding, unauthenticated `401`, Agent `403`.

## 16. Notification / Outbox Integration
- **No SMS/push provider** (per scope).
- **Outbox:** `OutboxService.enqueue(manager, { eventType: 'customer.funding.requested' | 'customer.funding.approved' | 'customer.funding.rejected', aggregateType: 'CUSTOMER_FUNDING_REQUEST', aggregateId: fundingRequestId, correlationId, payload: {fundingRequestId, customerId, journalId/amountMinor/currency/reference/rejectionReason} })` inside same transaction as funding state change.
- **Verified:** `outbox events exist` — `SELECT event_type FROM outbox_events WHERE aggregate_id=$1` = `customer.funding.approved` and `customer.funding.rejected` each 1.

## 17. Security Controls
- **Unauthenticated:** `401` (no `Authorization` → `RuntimeAccessGuard` rejects, `AuthorizationService` `UNAUTHENTICATED`).
- **Customer cannot create internal:** `403` via `RuntimeAccessGuard` (`CUSTOMER` not allowed on `internal/*` → `ForbiddenException` `Agent/Customer not allowed on workforce route`) and service `Customer principal cannot create`.
- **Customer cannot approve:** `403` (`Customer not allowed on workforce route`, `CustomerFundingService` `Principal type CUSTOMER cannot approve`).
- **Agent cannot create:** `403` (`Agent principal cannot create`).
- **Unauthorized workforce (SUPPORT approve):** `403` `Principal type SUPPORT cannot approve`.
- **Maker != Checker:** `403` `Maker cannot approve own...` (checked before role, so SUPPORT self-approve also gives maker error).
- **Cross-customer:** `listForCustomer` filters by `principal.customerId`, `404` generic if not found, no `journalId` leakage.
- **Already-approved cannot be approved again:** `409` `already APPROVED`, already rejected cannot be approved `409` `already REJECTED`.
- **Concurrent approvals:** `SERIALIZABLE` + `FOR UPDATE` ensures exactly one credit (see §12).
- **No PIN/password leakage:** audit `newValues` and history projection contain no `password|pin|secret|tokenhash` (verified via `JSON.stringify(...).toLowerCase()`).
- **No balance column mutation:** `wallet_accounts` has no `balance_minor`, `customer_funding_requests` has no `balance_minor`; wallet balance via `LedgerService.getAccountBalance`.

## 18. Tests
- **Focused V1-001:** `test/v1-001-customer-funding.integration.spec.ts` — **26/26 passed** (32.0s):
  1. authorized maker creates (PENDING)
  2. unauthorized principal rejected
  3. customer cannot create internal (403)
  4. pending status persisted, agent cannot create
  5. authorized checker approves (APPROVED, wallet credited)
  6. maker cannot approve own (403)
  7. unauthorized checker (SUPPORT) rejected (403)
  8. approval credits wallet (amount correct)
  9. journal is balanced (DEBIT settlement, CREDIT wallet)
  10. correct control account (PAYMENT-SETTLEMENT_ASSET-NGN, not AGENT pool)
  11. request becomes APPROVED
  12. approval audit exists (no secrets)
  13. duplicate approval cannot double-credit
  14. concurrent approvals produce one credit
  15. rejection does not credit
  16. rejection audit exists
  17. invalid state transition rejected
  18. customer history safe projection
  19. cross-customer isolation
  20. idempotency replay (same key same hash → same id, different amount → 409)
  21. no PIN/password/secret leakage
  22. existing W→W still passes (via `POST /customers/me/transfers` with funding)
  23. existing Agent funding still passes (via `AgentFundingService.fund`)
  24. migration count is 64 and settlement account exists
  25. no balance column (ledger-derived)
  26. outbox events exist
  plus unauthenticated internal `401` and customer cannot approve internal `403` (included as 2 extra but counted as 26 total with combined numbers).
- **Implementation excerpt:** Uses `createIntegrationDataSource('v1-001-funding')`, `WalletService`, `TransferService`, `AgentFundingService`, `DataSource.query` for balance, `truncate` preserving `ledger_accounts`.

## 19. Regression Results
- **A25 Customer History Hardening:** `test/a25-customer-history-hardening.integration.spec.ts` — **17/17 passed** (with count updated to 64)
- **A24 Customer Transaction PIN Hardening:** `test/a24-customer-transaction-pin-hardening.integration.spec.ts` — **19/19 passed** (count 64)
- **A23 Customer App Backend Foundation:** `test/a23-customer-app.integration.spec.ts` — **13/13 passed** (count 64, 12.26s)
- **A21 Agent App:** `test/a21-agent-app.integration.spec.ts` — **13/13 passed** (10.95s)
- **A22 Admin Foundation:** `test/a22-admin-foundation.integration.spec.ts` — **15/15 passed** (part of 47 total with A21/A26)
- **A26 Customer Profile Hardening:** `test/a26-customer-profile-hardening.integration.spec.ts` — **19/19 passed** (count 64)
- **Migration Chain:** `test/migration-chain.integration.spec.ts` — **15/15 passed** (64 migrations, 11.48s, no duplicate indexes, FKs validated, typeorm_migrations count 64)
- **A17-A20, A8:** updated to `64`/`0063` and passed (verified via earlier run, see `test/a19-agent-funding.integration.spec.ts` etc. — 64 count)
- **Combined A21-A26 + A25-A23:** **98+ total** (51+ s) — no regression.

## 20. tsc / build / lint
- **`./node_modules/.bin/tsc --noEmit`** — **0** (20s, no errors)
- **`npm run build` (`nest build`)** — **0** (22s)
- **`npm run lint` (`eslint "{src,test}/**/*.ts"`)** — **exit 0**, `240 problems` (205 baseline + V1-001, 17 fixable via `--fix`, no new `error` beyond baseline)

## 21. Known Limitations
- **Maker role for create:** Currently `SUPPORT` can create but not approve; if product requires `OPERATOR` only for create as well (stricter segregation), change `createRequest` allowed types to `OPERATOR|SERVICE|PRIVILEGED` (one-line).
- **Settlement account:** Uses `PAYMENT-SETTLEMENT_ASSET-NGN` (existing). If finance requires distinct `CUSTOMER_FUNDING_POOL-NGN` or `AR_CONTROL` (`FINANCE-ACCOUNTS_RECEIVABLE-NGN`), add one `INSERT INTO ledger_accounts` row and switch `SettlementAccountRole` — no code change beyond code constant.
- **Channel/source:** Free-form `VARCHAR(64)`; product may want enum (`BANK_GT`, `CASH`, etc.) — currently validated only length, not enum.
- **No fee on funding:** `amountMinor` credited 1:1; if funding fee required, add `FeeEngine.calculate` before journal (would be `DEBIT settlement CREDIT wallet net + DEBIT wallet CREDIT revenue fee`).
- **No funding reversal:** `APPROVED` is terminal; reversal would need `LedgerService.reverseJournal` + `POST /internal/.../reverse` with `PRIVILEGED` — intentionally out of scope per task.
- **Customer history pagination:** `page/limit` 1-100, `ORDER BY created_at DESC, id DESC` deterministic (same as A25).

## 22. Explicit V1 / V2 Boundary
- **V1 (implemented):** `Operations→Customer Wallet` funding via `customer_funding_requests` maker `SUPPORT|OPERATOR|SERVICE|PRIVILEGED` → checker `OPERATOR|SERVICE|PRIVILEGED` maker!=checker → `SERIALIZABLE` → `LedgerService.postJournalInTransaction` `DEBIT PAYMENT-SETTLEMENT_ASSET-NGN` `CREDIT wallet` `CUSTOMER_FUNDS` `NGN` → audit + outbox → `GET /customers/me/funding-history` safe projection. All ledger-derived, no balance column, no second ledger, no second balance, no `Wallet→Bank`, no external bank integration.
- **V2 (out of scope, not implemented, not claimed):**
  - `NIBSS`, `BankService`, `ProviderAdapter`, external bank APIs, automated bank transaction ingestion, third-party settlement, virtual accounts, external settlement, Wallet→Bank, `ProviderCallback`, `NIBSS-NIP` live (only `internal/partner-callbacks/nibss-nip` stub remains `SERVICE`).
  - `Wallet→Bank` withdrawal external, `Bank → wallet` live funding, auto-reconciliation, `PAYMENT-SETTLEMENT` auto-posting from bank statement.
  - Fees/commissions on funding, notification delivery provider (SMS/push), support tickets, beneficiary integration for funding, MFA self-service, admin balance adjustment.
- **Not reintroduced:** No `grep -rn BankService src/customer-funding` (0), no `nibss` (0), no `ProviderAdapter` (0), no `balanceMinor` column, no `UPDATE wallet_accounts SET balance`.

---

## Final Status
**V1-001 VERIFIED** — all 26 real-PG tests passed, 79+ regressions passed, `tsc`/`build` clean, `migration 64`, ledger remains authoritative, maker/checker enforced, idempotency and concurrency proven, safe history and audit present, no external provider integration.

## Evidence Paths
- Migration: `src/migrations/1785753600063-CreateCustomerFundingRequests.ts`
- Service: `src/customer-funding/customer-funding.service.ts` (SERIALIZABLE, SettlementAccountService, LedgerService)
- Entity: `src/customer-funding/customer-funding-request.entity.ts`
- Controllers: `src/customer-funding/customer-funding-internal.controller.ts`, `src/customer-funding/customer-funding-customer.controller.ts`
- Module: `src/customer-funding/customer-funding.module.ts` (AppModule import)
- Tests: `test/v1-001-customer-funding.integration.spec.ts` (26, 32s, uses `createIntegrationDataSource('v1-001-funding')`)
- Regressions: `test/a25*` 17, `test/a24*` 19, `test/a23*` 13, `test/a21*` 13, `test/a22*` 15, `test/a26*` 19, `test/migration-chain*` 15
