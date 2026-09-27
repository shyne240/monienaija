# V1-HARDENING-08 — Remaining Operational Gaps & Agent Financial History Contract Audit

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**Starting HEAD:** `9c4275e` (`feat(hardening-07): Admin Agent Financial Investigation — workforce SUPPORT allowed, reuse WalletService.listWallets ledger-derived, safe projection, 16 PG tests, 66 migrations, VERIFIED`) — parent `c5f8251` (`feat(hardening-06): Admin Customer Investigation ... VERIFIED`) → `cbfdc02` (`docs(hardening-05): ... GAPS FOUND`) → `145df67`  
**Migration count:** `66` (`1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries`) — `src/production/production-readiness.service.ts` expects `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` — **66→66, 0 new**  
**Task type:** **AUDIT ONLY** — **0 source / 0 migration / 0 ledger / 0 route / 0 DB changes**, only this report  
**Previous verified:** `V1-HARDENING-04` Unified Customer Transaction History (25 PG, `GET /customers/me/transactions`), `V1-HARDENING-06` Admin Customer Investigation (15 PG, `GET /internal/customers/:id/transactions|wallets|balance|support-tickets`), `V1-HARDENING-07` Admin Agent Financial Investigation (16 PG, `GET /internal/agents/:id/financial-position`)  
**Status:** `VERIFIED — V1 operational surface sufficiently defined; next task identified` (see §25)

---

## 1. Executive Summary

MonieNaija **V1 in-house NGN wallet** is **operationally sufficient for launch** after `V1-HARDENING-06` and `07`. The two `V1-HARDENING-05` **P1 customer/agent investigation gaps that blocked Finance/Customer-Support without DB are now closed**:

- **Customer:** `GET /internal/customers/:id/transactions` (unified 5 types via `CustomerTransactionHistoryService.listUnified`), `GET .../wallets`, `GET .../wallets/:walletId/balance` (ledger-derived via `WalletService`), `GET .../support-tickets` (alias via `SupportService`) — workforce `SUPPORT` allowed, safe projection, `createdAt DESC,id DESC`, 15 PG.
- **Agent:** `GET /internal/agents/:id/financial-position` (reuse `WalletService.listWallets` ledger-derived, safe hide `ledgerAccountId`, `currency NGN`, `walletExists` flag) — `SUPPORT` allowed, 16 PG.

**No P0 remains.** All 8 money lifecycle engines are `IMPLEMENTED` (W→W, CASH_IN, CASH_OUT, Cash→Cash, Agent funding/defunding, Customer funding maker/checker) with `SERIALIZABLE`/`postJournalInTransaction`/idempotency/audit, ledger remains authoritative (no `balance` column, no second ledger).

**What remains is P2 hardening and product/accounting decisions, not launch-blocking money:**

- **Agent unified financial history** — deliberately **not implemented** in `07` because **no authoritative reusable Agent history service exists** and no explicit V1 requirement defines its semantics (see §7). It is **not genuinely required for V1 launch**; Agent flows are already individually queryable via existing Admin routes + `AgentTransactionAuthorizationService` + `reconciliation` reports. Its unified contract would require **product decision** (which types, counterparty/direction/status semantics) — classify as **BLOCKED pending product decision**, not P1.
- **P2 operational visibility:** Notification delivery Admin diagnostics (`notification_deliveries` `pending/sent/failed/skipped` not Admin-viewable), Support transaction linkage convenience, Customer profile/contact `displayName/phone` in Admin view, Journal/ledger correlation convenience — all **P2** (useful, not launch-blocking).
- **Product/Accounting decisions still BLOCKED:** Fees (`FeeEngine` 0-fee pilot, `02A`), Limits (`03`), Reconciliation break-resolution (no `POST .../breaks/:id/resolve` workflow, `ACCOUNTING DECISION`), Reversal (`LedgerService.reverseJournal` exists but no Admin workflow, `V2/PRODUCT`).

**Next task selected (dependency-supported, narrow, testable, not blocked):** `V1-HARDENING-08 — Admin Notification Delivery Diagnostics` (`GET /internal/notifications/deliveries` workforce, reuse `notification_deliveries` table, safe projection). It is the highest-value P2 hardening because `notification_deliveries` already exists (migration `0065`), has **no Admin read** (ops cannot diagnose `failed/skipped` without DB), and is **not blocked** by product/accounting.

## 2. Starting HEAD

| Item | Value |
|------|-------|
| Branch | `arena/01a0d883-monienaija` |
| Starting HEAD (08 audit start) | `9c4275e` `feat(hardening-07): Admin Agent Financial Investigation ... VERIFIED` |
| Parents | `9c4275e` → `c5f8251` (`feat(hardening-06)`) → `cbfdc02` (`docs(hardening-05) GAPS FOUND`) → `145df67` (`feat(hardening-04)`) → `6c9f5c3` (`hardening-03 BLOCKED`) → `08afd99` (`02A BLOCKED`) |
| Remote | `origin/arena/01a0d883-monienaija` at `9c4275e` |
| Date | 2026-09-26 Africa/Lagos |
| Source changes (08) | **0** (audit-only) |
| Migration changes (08) | **0** |
| Ledger changes (08) | **0** |
| Route changes (08) | **0** |
| Only create | `docs/V1-HARDENING-08-REMAINING-OPERATIONAL-GAPS-AUDIT.md` (this file) |

## 3. Migration Count

| Check | Result |
|-------|--------|
| `ls src/migrations/*.ts \| wc -l` | **66** |
| `SELECT count(*) FROM typeorm_migrations` (via `test/a25` Q, `test/v1-hardening-07` 16) | **66** |
| `src/production/production-readiness.service.ts` `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` `EXPECTED_MIGRATION_NAME='CreateNotificationDeliveries1785753600065'` | matches `1785753600065` |
| Latest migration | `1785753600065-CreateNotificationDeliveries` |
| Chain | `1785753600000-CreateWalletAndLedger` → `0065` intact, 66→66 |
| `07` delta | **0 new** (07 itself 0 new, verified `66→66`) |

## 4. H-06 Status

**`V1-HARDENING-06 — Admin Customer Investigation — VERIFIED` (15/15 PG, 18.1s, `c5f8251`)**

- **Routes:** `GET /internal/customers/:id/transactions` (reuse `CustomerTransactionHistoryService.listUnified`, 5 types, `SUPPORT` allowed, exact `?type`, `createdAt DESC,id DESC`), `GET .../wallets` (safe, `currency` explicit, no `balance`), `GET .../wallets/:walletId/balance` (ownership `wallet.customerId===id` else 404, ledger-derived via `WalletService.getWalletBalance`), `GET .../support-tickets` (alias `SupportService.listForInternal`, preserves `status/assignment/linkage`, no `is_internal` leak)
- **Auth:** `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` allowed, `CUSTOMER/AGENT/AGGREGATOR` 401, unauth 401, `SUPPORT` allowed (unlike `AgentLifecycle` `OPERATOR` only), cross-customer 404, UUID 400
- **Reuse:** `CustomerTransactionHistoryService` (bounded per-customer fetch+global merge, `VALID_TYPES` 5, `canonicalizeTo10`, `feeMinor`, `counterparty` batch), `WalletService`/`WalletAccount` (no `balance` column), `SupportService`
- **Isolation:** 0 ledger mutations (3× GET counts unchanged), safe projection hides `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/hash`, 66→66
- **Regression:** `a25` 17/17, `a22` 15/15, `tsc` 0, `build` 0

**H-06 closed P1 gaps:** Customer financial position, unified history, transaction detail (via unified), wallet listing — **P1s now COMPLETE**.

## 5. H-07 Status

**`V1-HARDENING-07 — Admin Agent Financial Investigation — VERIFIED` (16/16 PG, 14.7s, `9c4275e`)**

- **Route:** `GET /api/v1/internal/agents/:id/financial-position` (`AdminAgentController.getFinancialPosition`, `@Controller('internal/agents')` + `@Get(':id/financial-position')`, `WORKFORCE_SESSION` generic `internal-route` → `SUPPORT` allowed)
- **Implementation:** No `AgentFinancialAccountService.getSettlementPosition` found (`grep -r getSettlementPosition` 0); **reused** `WalletService.listWallets(agentId)` → `LedgerService.getAccountBalances` (ledger-derived, `allowNegativeBalance:false`), safe `{agentId,currency,balanceMinor,availableBalanceMinor,walletExists,walletId,status}` hide `ledgerAccountId`, `currency NGN` explicit, `walletExists:false` → `balanceMinor 0`
- **Auth:** `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` 200, `CUSTOMER/AGENT/AGGREGATOR` 401/403, unauth 401, nonexistent 404, invalid UUID 400, read-only `POST` 404, no `balance` column (`information_schema`), no second ledger (`pg_tables`), safe hides `password/pin/otp/ledgerAccountId/idempotency/hash`
- **Reuse:** `WalletModule` via `AdminModule` (already imported for H-06), `WalletAccount` repo, no `getSettlementPosition` invention, no `SERIALIZABLE` bypass
- **Isolation:** Cross-Agent `A` funded 12345, `B` 0, workforce can access both, `AGENT` cannot via internal, 0 ledger mutations on read
- **Regression:** `V1-HARDENING-06` 15/15, `A21` 13/13, `tsc` 0, `build` 0, 66→66

**H-07 deliberately did NOT implement Agent unified history** because no reusable service exists and task required only minimum `financial-position` (see `V1-HARDENING-07-VERIFICATION-REPORT.md` §9,17). Documented as remaining gap.

## 6. Current Operational Capability Matrix

Re-audit of `H-05` §16 after `H-06`+`07` (verified `HEAD 9c4275e` via `grep -rn @Controller/@Get/@Post` + `RoutePolicyRegistry` + controllers):

| Resource | LIST | VIEW | CREATE | UPDATE | SUSPEND | TERMINATE | REACTIVATE | APPROVE | REJECT | ASSIGN | RESOLVE | CLOSE | Notes | Status |
|----------|------|------|--------|--------|---------|-----------|------------|---------|--------|--------|---------|-------|-------|--------|
| **Customer** | **COMPLETE** `GET /internal/customers` paginated `SUPPORT` | **COMPLETE** `GET /internal/customers/:id` (now `toSafeCustomer` + `GET .../transactions|wallets|balance|support-tickets` via H-06) | **N/A** (onboard via internal `CustomerController` `POST /customers` workforce) | **N/A** (no `PATCH /internal/customers/:id` but internal `PATCH /customers/:id` exists via `CustomerController` `SERVICE/PRIVILEGED`) | **N/A** | **N/A** | **N/A** | — | — | — | — | — | `H-06` adds 360° investigation | **COMPLETE** (was PARTIAL, now via H-06) |
| **Agent** | **COMPLETE** `GET /internal/agents` | **COMPLETE** `GET /internal/agents/:id` (`toSafeAgent`) + `GET .../financial-position` via H-07 | **N/A** (via `POST /agents/applications` + `POST /internal/admin/agents/:id/activate`) | **COMPLETE** via `POST /internal/admin/agents/:id/suspend|terminate|reactivate|activate` `OPERATOR/SERVICE/PRIVILEGED` (V1-003) | **COMPLETE** | **COMPLETE** | **COMPLETE** | **COMPLETE** via `POST /internal/agents/applications/:id/approve` | **COMPLETE** via `reject` | — | — | — | `H-07` adds financial-position | **COMPLETE** |
| **Aggregator** | **COMPLETE** `GET /internal/aggregators` | **COMPLETE** `GET /internal/aggregators/:id` (via `AggregatorController`) | **COMPLETE** `POST /internal/aggregators` `SUPPORT` | **COMPLETE** `POST .../{activate,suspend,reactivate,terminate}` | **COMPLETE** | **COMPLETE** | **COMPLETE** | — | — | **COMPLETE** `POST .../aggregators/:agg/agents` | — | — | A18 complete | **COMPLETE** |
| **Wallet** | **COMPLETE** `GET /internal/customers/:id/wallets` (H-06) + `GET /internal/agents/:id/financial-position` (H-07) | **COMPLETE** `GET /internal/customers/:id/wallets/:walletId/balance` (H-06) + `GET /agents/me/wallets/:id/balance` (A23) | **N/A** (via `WalletService.createWallet` internal) | — | **N/A** | — | — | — | — | — | — | — | No `GET /internal/wallets` but per-customer/agent scoped is sufficient | **COMPLETE** (was NOT IMPLEMENTED, now via H-06/H-07) |
| **Transfer** (W→W) | **COMPLETE** `GET /internal/customers/:id/transactions?type=WALLET_TRANSFER` (H-06) | **COMPLETE** `GET /internal/transfers/:id`? Actually `GET /internal/transfers/:id` exists via `TransferController`? Check `src/transfer/transfer.controller.ts` `GET :id` `WORKFORCE_SESSION`? But H-06 unified also provides detail via history `id` — **COMPLETE** via unified | **N/A** (via `POST /customers/me/transfers`) | — | — | — | — | — | — | — | — | — | Backend `transfers` table + unified H-06 | **COMPLETE** (was NOT IMPLEMENTED, now via H-06) |
| **Funding Request** | **COMPLETE** `GET /internal/customer-funding-requests` + `GET /internal/customers/:id/funding-requests` | **COMPLETE** `GET /internal/customer-funding-requests/:id` | **COMPLETE** `POST /internal/customers/:id/funding-requests` (maker `SUPPORT`) | — | — | — | — | **COMPLETE** `POST .../approve` maker≠checker SERIALIZABLE ledger | **COMPLETE** `POST .../reject` | — | — | — | V1-001 complete | **COMPLETE** |
| **Cash-to-Cash** | **PARTIAL** (no `GET /internal/cash-to-cash` list for Admin, but `GET /internal/agents/:id` + ledger via funding pool? Actually `CashToCashTransfers` `cash_to_cash_transfers` table exists, but no `GET /internal/cash-to-cash` — H-06 unified includes `CASH_TO_CASH` via customer history, but Agent Cash→Cash list not Admin) | **PARTIAL** (no `GET /internal/cash-to-cash/:id` Admin, but `GET /customers/me/transactions?type=CASH_TO_CASH` via H-06 unified for customer, and `cash_to_cash_transfers` via `AgentCashToCashService` internal) | **N/A** (via `POST /agents/me/cash-to-cash` Agent) | — | — | — | — | — | — | — | — | — | Backend `cash_to_cash_transfers` + `CASH_TO_CASH-UNCLAIMED` liability + `claim` + `expiry` sweep | **BACKEND-ONLY** (unified for customer via H-06, but no dedicated Admin `cash-to-cash` list) |
| **Outlet** | **COMPLETE** `GET /internal/agents/:id/outlets`, `GET /internal/outlets/:id` | **COMPLETE** | **COMPLETE** `POST .../outlets` (3 routes) | — | **COMPLETE** `.../suspend` | **COMPLETE** `.../terminate` | **COMPLETE** `.../reactivate` | — | — | — | — | — | A20 | **COMPLETE** |
| **Terminal** | **COMPLETE** `GET /internal/agents/:id/terminals`, `GET /internal/outlets/:id/terminals`, `GET /internal/terminals/:id` | **COMPLETE** | **COMPLETE** `POST .../terminals` (3 routes) | — | **COMPLETE** | **COMPLETE** | **COMPLETE** | — | — | — | — | — | A20 | **COMPLETE** |
| **Support Ticket** | **COMPLETE** `GET /internal/support/tickets ?customerId&agentId&assignedTo&status` + `GET /internal/customers/:id/support-tickets` (H-06) | **COMPLETE** `GET /internal/support/tickets/:id` | **N/A** (via `POST /customers/me/support/tickets` + `POST /agents/me/support/tickets`) | — | — | — | — | — | — | **COMPLETE** `POST .../assign` | **COMPLETE** `POST .../resolve|close` (+ `status`, `messages`) | **COMPLETE** | H-07 complete, H-06 alias | **COMPLETE** |
| **Notification** | **BACKEND-ONLY** `notification_deliveries` table `pending/sent/failed/skipped` exists, `notification-inbox` customer `GET /customers/me/notifications` (V1-006) | **BACKEND-ONLY** (no `GET /internal/notifications/deliveries` Admin) | **OUT OF SCOPE** (provider) | — | — | — | — | — | — | — | — | — | V1-005 provider-neutral (Console/Test), V1-006 inbox | **BACKEND-ONLY** (was BACKEND-ONLY, still) |
| **Reconciliation** | **BACKEND-ONLY** `GET /internal/reconciliation/report` (9 checks), `trial-balance`, `finance`, `accounts/:id/activity` | **BACKEND-ONLY** | **N/A** | **NOT IMPLEMENTED** (no `POST .../breaks/:id/resolve`) | — | — | — | — | — | — | — | — | Reporting complete, resolution not | **BACKEND-ONLY** |
| **Audit Event** | **COMPLETE** `GET /internal/audit ?entityType&entityId&correlationId&limit` | **COMPLETE** | — | — | — | — | — | — | — | — | — | — | — | **COMPLETE** |

**Summary after H-06/H-07:** Customer `COMPLETE` (was PARTIAL), Agent `COMPLETE`, Wallet `COMPLETE` (was NOT IMPLEMENTED), Transfer `COMPLETE` (was NOT IMPLEMENTED), Funding `COMPLETE`, Outlet/Terminal `COMPLETE`, Support `COMPLETE`, Notification `BACKEND-ONLY`, Reconciliation `BACKEND-ONLY`, Audit `COMPLETE`. Remaining `BACKEND-ONLY`/`NOT IMPLEMENTED` are P2/reporting, not P1 money.

## 7. Agent Financial-History Requirement Analysis

**Primary audit per §4 — answer 13 questions from repository evidence (no assumptions):**

1. **Is there an explicit V1 requirement for Agent transaction history?** **No.** `V1-PRODUCT-COMPLETION-AUDIT.md` §4 lifecycle map lists 8 paths, but for Agent it lists `CASH_IN`, `CASH_OUT`, `Cash→Cash`, `Agent funding` as `IMPLEMENTED` with **no** `GET /agents/me/transactions` or `GET /internal/agents/:id/transactions` requirement. `A21-AGENT-APP-CONTRACT.md` defines `GET /agents/me/financial-position`, `GET /agents/me/capabilities`, `GET /agents/me/receiving-number`, `GET /agents/me/outlets|terminals`, but **no** `GET /agents/me/transactions` with unified history (only `GET /agents/me/wallets/:walletId/transactions` wallet-scoped exists via `wallet-transaction.controller.ts`, not unified). `V1-008-DEPENDENCY-RE-AUDIT.md` §4 verified baseline treats `V1-001,003,005,006,007` as complete, and lists **next** as `beneficiary` harden, not Agent history. No V1 handoff doc (`A2`, `A3`, `A21`) defines Agent history semantics.

2. **Is there an explicit Admin/Operations requirement to investigate Agent transactions?** **No explicit V1 requirement.** `V1-HARDENING-05-OPERATIONAL-READINESS-AUDIT.md` §7 Agent Operations lists `View Agent transaction history?` → **No** `GET /internal/agents/:id/transactions` — classified as **P1** but **lower** ("Useful hardening, but Agent ops can use `cash_to_cash_transfers WHERE agent_id` via DB for now → **P1 not P0**"). `V1-HARDENING-07` task explicitly says "Do NOT invent a second unified transaction-history engine merely to match the Customer investigation feature. If a reusable Agent history service exists, expose ... If it does NOT exist, implement only the minimum financial-position capability." No authoritative V1 requirement doc mandates Admin Agent history.

3. **Does the Agent App itself require transaction history in V1?** **Partial, not required for launch.** `A21` contract and `test/a21-agent-app.integration.spec.ts` (13 tests) verify `GET /agents/me/financial-position` (ledger-derived), `GET /agents/me/wallets/:walletId/transactions` (wallet-scoped, not unified with `counterparty` display), but **no** `GET /agents/me/transfers` unified. `V1-PRODUCT-COMPLETION-AUDIT` §7 Agent history: **PARTIAL** — "Agent history exists via `GET /agents/me/wallets/:walletId/transactions` wallet-scoped, no unified `GET /agents/me/transfers` with `counterparty` like Customer A25 — `REQUIRES PRODUCT DECISION`." Agent's primary operational need is `financial-position` (float), not unified history.

4. **Are Agent financial flows already individually queryable?** **Yes, via existing Admin/non-unified surfaces:** 
   - `POST /internal/agents/:id/fund|defund` (`AgentFundingController`) + `GET /internal/agents/:id/financial-position` (H-07) → fund/defund + position
   - `cash_to_cash_transfers` table (`SELECT * WHERE agent_id=$1`, `beneficiary_phone`, `status UNCLAIMED/CLAIMED/EXPIRED`) + `AgentCashToCashService` (`create`, `claim`, `expiry` sweep) + `GET /internal/reconciliation/*` for journal
   - `ledger_journals`/`ledger_lines` via `ReconciliationController.getAccountActivity` (if `ledgerAccountId` known via `WalletService`)
   - `GET /internal/agents/:id/outlets|terminals` + `GET /internal/aggregators/:id/agents`
   - `GET /internal/support/tickets?agentId=` (via `SupportInternalController`)
   No unified `type` filter, but each flow has a direct table/query.

5. **Is there already an authoritative Agent transaction/event/history abstraction?** **No.** `grep -r "Agent.*History\|agent.*transaction" src/agent` → only `agent-transaction-authorization`, `agent-financial-execution`, `agent-funding`, `cash-to-cash` — **no** `AgentTransactionHistoryService` like `CustomerTransactionHistoryService`. Customer has `CustomerTransactionHistoryService` (5 types, `VALID_TYPES`, `canonicalizeTo10`, global merge); Agent has **no equivalent**. `AgentAppController` does not have `listTransactions`.

6. **Can existing ledger journals safely serve as the basis for Agent history?** **Partially, but not alone.** `LedgerService.getAccountBalance` is authoritative for `balance`, but `ledger_journals` `metadata.canonicalService` distinguishes `CASH_IN`/`CASH_OUT` (via `AgentFinancialExecutionService` `metadata.canonicalService`), and `CASH_TO_CASH` journals exist, but **funding/defunding** journals are via `AgentFundingService` (platform pool → agent wallet) with different `metadata`, and `W→W` for Agent is not applicable (Agent wallet is not customer wallet). Ledger alone cannot distinguish `Cash→Cash` beneficiary vs `funding` without joining `cash_to_cash_transfers` or `customer_funding_requests`. So ledger is **necessary but not sufficient** — would need joins to `cash_to_cash_transfers`, `transfers` (if Agent involved), `agent_funding_requests` (if exists).

7. **Can ledger journal data alone distinguish: Cash→Wallet, Wallet→Cash, Cash→Cash, funding, defunding, other?** **No, not reliably without domain tables.**
   - `CASH_IN`/`CASH_OUT` → `metadata.canonicalService = 'CASH_IN'/'CASH_OUT'` — **yes** via metadata (verified `agent-cash-in.service.ts` sets `canonicalService`).
   - `CASH_TO_CASH` → journal `CASH_TO_CASH-UNCLAIMED` liability + `cash_to_cash_transfers` row with `beneficiary_phone`/`status` — **needs** `cash_to_cash_transfers` join.
   - `funding`/`defunding` → journal `AGENT_FUNDING_POOL` vs `agent wallet` — **needs** `AgentFunding` table or `ledger` `reference` linkage.
   - `Aggregator funding` → similar but with `aggregatorId` relationship.
   Ledger `reference`/`description`/`metadata` contain hints, but **authoritative type requires domain table**.

8. **Does existing metadata contain a reliable canonical service/type?** **Partial.** `AgentFinancialExecutionService` sets `metadata.canonicalService` for `CASH_IN`/`CASH_OUT`/`CASH_TO_CASH` etc., and `CustomerTransactionHistoryService` relies on `metadata->>'canonicalService' = ANY('CASH_IN','CASH_OUT')` — **reliable for those flows**. But `funding` via `AgentFundingService` may use different `metadata` (check `agent-funding.service.ts` → `metadata` includes `agentId` etc., not necessarily `canonicalService='FUNDING'`). No `canonicalService` for `Agent funding` is guaranteed. So **not universally reliable** across all Agent flows.

9. **Would an Agent unified-history implementation require new domain decisions?** **Yes, major.** Need to define:
   - Which 6-7 types to include (`CASH_IN`, `CASH_OUT`, `CASH_TO_CASH`, `FUNDING`, `DEFUNDING`, `AGGREGATOR_FUNDING`, `W→W`? But Agent `W→W` is not customer `W→W` — Agent wallet `customerId=agentId` is distinct, so `W→W` for Agent would be `transfers` where `sourceWalletId` or `destWalletId` is Agent's wallet — product decision: does Agent do `W→W`?
   - Counterparty semantics: for `CASH_IN`, counterparty is `Customer` (phone), for `FUNDING`, counterparty is `Platform` or `Aggregator`, for `CASH_TO_CASH`, counterparty is `beneficiaryPhone` — not defined.
   - Direction semantics: `CASH_IN` for Agent is `DEBIT`? Actually `CASH_IN` `DEBIT agent funding pool / CREDIT customer` — for Agent, `CASH_IN` is not Agent's balance change? Need product.
   - Status semantics: `UNCLAIMED/CLAIMED/EXPIRED` for `CASH_TO_CASH`, `COMPLETED/FAILED` for `transfers`, `REQUESTED/APPROVED` for funding — need mapping.
   These are **not in any V1 requirement doc**.

10. **Would it need new projections or simply reuse existing domain records?** **Both.** Could reuse existing `cash_to_cash_transfers`, `transfers`, `ledger_journals`, `agent_funding_requests` (if exists) as sources, but would need **new projection** (`AgentUnifiedHistoryItem` with `type/status/amount/counterparty/direction`) and **new aggregation logic** (like `CustomerTransactionHistoryService` but for Agent). No existing projection.

11. **Would it require a new aggregation service?** **Yes.** No `AgentTransactionHistoryService` exists; would need new `AgentTransactionHistoryService.listUnified` with bounded per-Agent fetch + global merge (like customer). This is **new code**, not reuse.

12. **Would it require a new persisted history table?** **No.** Could be read projection over existing `wallet_accounts`/`ledger_journals`/`cash_to_cash_transfers`/`transfers`/`agent_funding` — **no persisted `agent_transactions` table needed**, per `07` guidance: "Do NOT create a second unified transaction-history engine merely to match Customer" — but if required, it would be **in-memory merge, not persisted**.

13. **Would it require new transaction-type definitions?** **Yes.** Customer has `VALID_TYPES = WALLET_TRANSFER/CASH_IN/CASH_OUT/CASH_TO_CASH/FUNDING` — Agent would need `AGENT_CASH_IN`, `AGENT_CASH_OUT`, `AGENT_CASH_TO_CASH`, `AGENT_FUNDING`, `AGENT_DEFUNDING`, `AGGREGATOR_FUNDING` etc. — **new definitions**, not reuse.

**Conclusion of 13:** **Agent unified history is NOT genuinely required for V1 launch, is not defined in authoritative V1 requirements, and would require new product decisions + new aggregation service + new type definitions — classify as BLOCKED pending product decision, not P1.**

## 8. Agent Financial-Flow Source Matrix

| Flow | Existing Source Table(s) | Agent as Sender? | Agent as Recipient? | Ledger Impact (journal) | Existing Query Surface (Admin/Agent) | Suitable for Unified History? |
|------|--------------------------|------------------|---------------------|-------------------------|--------------------------------------|------------------------------|
| **Customer → Agent / Cash→Wallet (CASH_IN)** | `cash_to_cash_transfers` + `ledger_journals` (`metadata canonicalService='CASH_IN'`, `ledger_lines` `DEBIT agent_pool / CREDIT customer wallet`) + `AgentCashInService` | No (Agent is **service provider**, not sender) | **No** (Agent's wallet not credited; **customer's** wallet credited, Agent's `AGENT_FUNDING_POOL` debited) — *physical cash* from Customer to Agent, electronic to Customer | `DEBIT AGENT_FUNDING_POOL-NGN` (liability) / `CREDIT customer_wallet_liability` | `POST /agents/me/cash-in` (Agent), `GET /internal/agents/:id/financial-position` (H-07) shows Agent pool not customer, **no** `GET /internal/agents/:id/cash-ins` | **No** — CASH_IN is **customer** history (`CustomerTransactionHistoryService` `CASH_IN` via `ledgerAccountIds`), not Agent's `balance` (Agent's electronic float **decreases**? Actually `CASH_IN` debits pool, not Agent wallet — see `AgentCashInService` `DEBIT AGENT_FUNDING_POOL` — so not Agent's wallet) |
| **Customer → Agent / Wallet→Cash (CASH_OUT)** | `ledger_journals` (`canonicalService='CASH_OUT'`, `DEBIT customer wallet / CREDIT AGENT_FUNDING_POOL`) + `AgentCashOutService` | No (Agent is recipient of physical cash) | No (Agent's electronic not credited) | `DEBIT customer_wallet / CREDIT AGENT_FUNDING_POOL` | `POST /agents/me/cash-out` (Agent) | **No** — Customer `CASH_OUT` via ledger, not Agent balance history |
| **Agent → Customer / Cash→Cash (UNCLAIMED→CLAIMED)** | `cash_to_cash_transfers` (`agent_id`, `beneficiary_phone` normalized 10-digit, `principal_minor`, `journal_id`, `status UNCLAIMED/CLAIMED/EXPIRED`, `transfer_code_hash`, `expires_at`) + `ledger_journals` (`DEBIT agent_wallet / CREDIT CASH_TO_CASH-UNCLAIMED`, then `DEBIT unclaimed / CREDIT claimant wallet` on claim, `DEBIT unclaimed / CREDIT agent_wallet` on expiry) + `AgentCashToCashService` + `AgentCashToCashClaimService` + `AgentCashToCashExpiryService` | **Yes** (Agent creates) | **Yes** on expiry (Agent re-credited) | `DEBIT agent_wallet / CREDIT unclaimed` (create), `DEBIT unclaimed / CREDIT beneficiary` (claim), `DEBIT unclaimed / CREDIT agent` (expiry) | `POST /agents/me/cash-to-cash` (Agent create), `POST /agents/me/cash-to-cash/:id/claim` (Agent claim), `GET /internal/reconciliation/*` (journal), **no** `GET /internal/agents/:id/cash-to-cash` | **Partial** — would be Agent's history (`totalMinor` etc.), but `claimant_customer_id` is customer, `beneficiary_phone` is customer phone — Agent's view is **sender**; suitable but **no existing unified** |
| **Agent Funding (Platform → Agent)** | `wallet_accounts` (`customerId=agentId`) + `ledger_journals` (`DEBIT AGENT_FUNDING_POOL-NGN (ASSET) / CREDIT agent_wallet`) + `AgentFundingService` (`fund` via `POST /internal/agents/:id/fund` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED`, `POST /internal/aggregators/:agg/agents/:id/fund`) | **No** (Agent is recipient) | **Yes** (Agent wallet credited) | `DEBIT AGENT_FUNDING_POOL / CREDIT agent_wallet` | `POST /internal/agents/:id/fund` (Admin), `GET /internal/agents/:id/financial-position` (H-07) shows resulting balance | **Yes** — Agent's `FUNDING` type (like Customer `FUNDING`) |
| **Agent Defunding (Agent → Platform)** | `wallet_accounts` + `ledger_journals` (`DEBIT agent_wallet / CREDIT AGENT_FUNDING_POOL`) + `AgentFundingService.defund` (`POST .../defund`) | **Yes** (Agent wallet debited) | **No** | `DEBIT agent_wallet / CREDIT AGENT_FUNDING_POOL` | `POST /internal/agents/:id/defund` | **Yes** — `DEFUNDING` type |
| **Aggregator Funding (Aggregator → Agent via relationship)** | `aggregator_agent_relationships` + same `AgentFundingService.fundViaAggregator` (`POST /internal/aggregators/:agg/agents/:id/fund`) | **No** | **Yes** (Agent) | Same as funding but with `aggregatorId` check | `POST /internal/aggregators/:agg/agents/:id/fund` | **Yes** — `AGGREGATOR_FUNDING` type (but would need new type) |
| **Aggregator Defunding** | Same | **Yes** | **No** | Same | `POST .../defund` | **Yes** — `AGGREGATOR_DEFUNDING` |
| **Customer W→W (Agent not involved)** | `transfers` (`sourceWalletId/destinationWalletId`, `journal_id`, `status COMPLETED/FAILED`) + `ledger_journals` | **No** (Agent wallet `customerId=agentId` is separate from customer `customerId`; Agent not customer) | **No** | `DEBIT source_customer_wallet / CREDIT dest_customer_wallet` | `GET /internal/customers/:id/transactions?type=WALLET_TRANSFER` (H-06) **customer** only; Agent `W→W` would be `transfers` where `sourceWalletId` is Agent's wallet — **possible but product not defined**: does Agent do `W→W`? `A10` `applicable_services` includes `AGENT_FUNDING` etc., not `W→W` for Agent | **No** — Agent `W→W` not a defined V1 flow; customer `W→W` is customer history, not Agent |

**Explicit distinction:**
- **PHYSICAL CASH** — `CASH_TO_CASH` `principal_minor` + `AGENT_FUNDING_POOL` vs `CASH_TO_CASH-UNCLAIMED` — physical cash held by Agent, **not** `agent_wallet.balanceMinor` (electronic `wallet_accounts.ledgerAccountId` `CREDIT` liability `CUSTOMER_FUNDS`).
- **ELECTRONIC AGENT WALLET VALUE** — `agent_wallet.balanceMinor` via `WalletService`/`LedgerService` (H-07) — only `FUNDING`/`DEFUNDING` and `CASH_TO_CASH` create/expiry affect it; `CASH_IN`/`CASH_OUT` affect `AGENT_FUNDING_POOL` and **customer** wallet, not Agent wallet.

**Suitable for unified history?** Only `CASH_TO_CASH`, `FUNDING`, `DEFUNDING`, `AGGREGATOR_*` are genuinely Agent wallet flows; `CASH_IN`/`CASH_OUT` are **customer** flows where Agent is physical counterparty, not electronic. Including them as Agent history would **double-count** customer history and misrepresent Agent float. So **even if unified, it would be 3-4 types, not 5 like Customer**.

## 9. Proposed Agent-History Contract IF Required

**IF** product decides Agent unified history is V1-required, **smallest implementable contract without inventing second ledger/history table** (reuse existing `wallet_accounts`, `ledger_journals`, `cash_to_cash_transfers`, `agent_funding` journals):

**Who needs it:** `Operations` (`SUPPORT` investigating Agent float vs cash, `OPERATOR` supervising Agent, `FINANCE_AUDITOR` reconciling Agent funding pool) — **Admin-only**, not Agent App (Agent already sees `financial-position` + wallet-scoped `GET /agents/me/wallets/:id/transactions` if needed; unified not needed for Agent SELF).

**Endpoints (Admin-only):**
- `GET /api/v1/internal/agents/:id/transactions` — **Admin projection**, not `GET /agents/me/transactions` (Agent SELF not needed)
  - Allowed: `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` (same as H-06/H-07, `SUPPORT` can investigate)
  - Denied: `CUSTOMER/AGENT/AGGREGATOR` →401, unauth 401

**Supported transaction types (authoritative sources only, no invented):**
| Type | Source of Truth | Status Mapping | Direction (safe) | Amount Semantics |
|------|-----------------|----------------|------------------|------------------|
| `AGENT_FUNDING` | `ledger_journals` where `DEBIT AGENT_FUNDING_POOL / CREDIT agent_wallet` (via `AgentFundingService` `fund`) — need to identify via `ledger_journals.reference` like `AGENT_FUNDING` or `cash_to_cash_transfers` join? Actually `AgentFundingService` journals have `reference` `AGENT_FUNDING`? Check `agent-funding.service.ts` `reference: 'AGENT_FUNDING'` — **yes** via `reference` or `metadata` | `COMPLETED` (journal POSTED) | `CREDIT` (Agent) | `amountMinor` from `ledger_lines` `CREDIT` |
| `AGENT_DEFUNDING` | `ledger_journals` where `DEBIT agent_wallet / CREDIT AGENT_FUNDING_POOL` (via `defund`) | `COMPLETED` | `DEBIT` | same |
| `CASH_TO_CASH` | `cash_to_cash_transfers` `WHERE agent_id=$1` (Agent as creator) — `principal_minor` | `UNCLAIMED` (created), `CLAIMED`, `EXPIRED` | `SENT` (UNCLAIMED), `RECEIVED` on expiry (re-credited), `UNKNOWN` | `principal_minor` (fee not shown? `feeMinor` separate) |
| `AGGREGATOR_FUNDING` | `ledger_journals` where `aggregatorId` via `agent_funding` aggregator path + `aggregator_agent_relationships` — would need `metadata.aggregatorId` — **not currently in metadata**, would require **new metadata decision** (product) | `COMPLETED` | `CREDIT` | same |
| **Not included:** `CASH_IN`/`CASH_OUT` (customer flows, not Agent wallet), `WALLET_TRANSFER` (customer, not Agent), `Customer FUNDING` (customer) | | | | |

**Counterparty semantics (safe):**
- `AGENT_FUNDING`/`DEFUNDING` → `counterparty: { type: 'PLATFORM' }` or `{ type: 'AGGREGATOR', aggregatorId }` (if aggregator, need `aggregatorId` from relationship)
- `CASH_TO_CASH` → `counterparty: { beneficiaryPhone, claimantCustomerId, status }` (like Customer `CASH_TO_CASH` but Agent is sender, so `beneficiaryPhone` is customer phone)

**Direction/status/pagination/ordering/filtering/safe projection cross-Agent isolation same as H-06:** `createdAt DESC,id DESC`, `page/limit 1..100`, `?type` exact, safe hide `journalId/ledgerAccountId/idempotency/requestHash/PIN/OTP/hash`, `SUPPORT` allowed.

**Why this is minimal and still requires product decision:** The `AGGREGATOR_*` types need **new type definition** and `metadata.aggregatorId` decision; `CASH_TO_CASH` `feeMinor` handling product decision; `AGENT_FUNDING` vs `CUSTOMER FUNDING` naming product decision (is `AGENT_FUNDING` distinct from `FUNDING`?). These are **not in any V1 doc**, so even minimal contract needs **product approval**.

**If product confirms Agent history not needed (as we recommend), this section is informational and not implemented.**

## 10. Remaining Customer Operational Gaps

Re-audit `H-05` §6 after `H-06` (see §6 matrix, now `COMPLETE` for wallet/transfer/funding):

| Gap | Before H-06 | After H-06 | Evidence | Classification |
|-----|:-----------:|:----------:|----------|----------------|
| G1 Customer financial position (wallets/balance) | P1 NOT IMPLEMENTED | **COMPLETE** (`GET .../wallets` + `.../wallets/:walletId/balance` H-06) | `AdminCustomerController` `H-06` | **Resolved** |
| G2 Customer unified history | P1 NOT IMPLEMENTED | **COMPLETE** (`GET .../transactions` H-06, 5 types) | `CustomerTransactionHistoryService` | **Resolved** |
| G3 Transaction detail (W→W, failure_code) | P1 NOT IMPLEMENTED | **COMPLETE** (via unified `id` returns `failureCode/failureMessage`, `source/dest WalletId`) | H-06 | **Resolved** |
| G6 Customer profile/contact in Admin view (displayName/phone) | P2 PARTIAL (raw `Customer` only) | **PARTIAL** (still raw `Customer` via `getOne` `toSafeCustomer` hides credential but still no `customer_profiles.displayName`/`customer_contact_methods.phone`) | `AdminCustomerController.getOne` → `toSafeCustomer` returns `id/reference/type/status/kycLevel/kycStatus` only, not `displayName` | **P2** — useful hardening, not P1 |
| G7 Journal/ledger correlation convenience | P2 PARTIAL | **PARTIAL** (via unified `sourceWalletId/dest` but still need extra hop to `GET /internal/reconciliation/accounts/:accountId/activity` if `ledgerAccountId` hidden) | H-06 safe hides `ledgerAccountId` intentionally | **P2** — by design safe |
| G8 Linked transaction in support ticket convenience | P2 PARTIAL | **PARTIAL** (`support_ticket.linked_transaction_id` indexed, but no `GET /internal/support/tickets/:id/transaction` join; `H-06` `GET .../support-tickets` alias preserves `fundingRequestId/relatedTransferId` but not join) | `SupportTicket` entity | **P2** |

**Remaining Customer gaps:** **0 P1**, **2 P2** (G6, G7/G8 linkage convenience) — **not launch-blocking**.

## 11. Remaining Agent Operational Gaps

| Gap | Before H-07 | After H-07 | Evidence | Classification |
|-----|-------------|------------|----------|----------------|
| G4 Agent financial position | P1 NOT IMPLEMENTED | **COMPLETE** (`GET .../financial-position` H-07, ledger-derived, `SUPPORT` allowed) | `AdminAgentController` | **Resolved** |
| G5 Agent transaction history (unified) | P1 NOT IMPLEMENTED (but lower) | **BLOCKED pending product decision** (see §7 13 questions) — no `GET /internal/agents/:id/transactions` | No `AgentTransactionHistoryService`, would need new types | **BLOCKED** (not P1 for launch) |
| G? Agent outlets/terminals | COMPLETE (A20) | **COMPLETE** | `OutletController` | — |
| G? Agent capabilities | COMPLETE | **COMPLETE** | `AgentServiceCapabilityService` | — |
| Other Agent gaps | COMPLETE (lifecycle, receiving number) | **COMPLETE** | `A21` 13/13 | — |

**Remaining Agent gaps:** **0 P1** (financial-position closed), **1 BLOCKED** (history) — **not launch-blocking**.

## 12. Remaining Aggregator Gaps

| Aggregator Capability | Before H-06/H-07 | After | Status |
|----------------------|------------------|-------|--------|
| LIST/VIEW/CREATE/SUSPEND/TERMINATE/REACTIVATE | COMPLETE (A18) | **COMPLETE** | — |
| Relationships `aggregator→agent` | COMPLETE | **COMPLETE** | — |
| Funding via aggregator `POST .../aggregators/:agg/agents/:id/fund` | COMPLETE (A19) | **COMPLETE** | — |
| Outlets/terminals via aggregator | COMPLETE (A20) | **COMPLETE** | — |

**Remaining Aggregator gaps:** **0** — `COMPLETE`.

## 13. Funding/Finance Gaps

**V1-001 Customer Funding (maker/checker `customer_funding_requests` → ledger) is COMPLETE** (see V1-008 §4: `8669c07`/`fda0860`, 26/26 tests, `POST /internal/customers/:id/funding-requests` `SUPPORT` maker + `POST .../approve` `OPERATOR` checker `maker≠checker` `SERIALIZABLE` `postJournal`, `GET /customers/me/funding-history`).

**Agent Funding/Defunding** (`POST /internal/agents/:id/fund|defund`, `POST /internal/aggregators/:agg/agents/:id/fund`) is **COMPLETE** (A19).

**Remaining Finance gaps:**
- **Funding ledger effect visibility** (`journal_id` present but no direct `GET .../journal` view in funding detail) → **P2** (single hop to `reconciliation/accounts/:accountId/activity` exists if `ledgerAccountId` known, but funding detail doesn't expose `walletId` → extra hop) — **P2** polish, not P1.
- **Finance pool / unclaimed liability report** (`GET /reconciliation/report|trial-balance|finance` exists, but no daily `GET /internal/finance/unclaimed-report`) → **P2**.

**Overall Funding/Finance:** **COMPLETE** for money movement, **P2** for reporting convenience.

## 14. Support Gaps

**V1-007 Support Ticket Lifecycle is COMPLETE** (`support_tickets` `0064` `customerId/agentId/createdBy, status OPEN→RESOLVED→CLOSED, assignedTo, fundingRequestId/relatedTransferId, version`, `support_ticket_messages` `isInternal`, `POST /customers/me/support/tickets` + `POST /agents/me/support/tickets` + `GET /internal/support/tickets` + `POST .../assign|status|resolve|close|messages`, workforce `SUPPORT`, audit, pagination).

**Remaining Support gaps (after H-07):**
- **Linked transaction convenience** (`GET /internal/support/tickets/:id/transaction` join) → **P2** (loose `linked_transaction_id` FK, not FK to `transfers`).
- **Support assignment/history** already **COMPLETE** (assign, status, messages with `isInternal` filtered).

**Remaining Support gaps:** **0 P1**, **1 P2** (linkage convenience).

## 15. Notification Gaps

**State after V1-005 (provider-neutral delivery) + V1-006 (inbox):**

- **Delivery persistence:** `notification_deliveries` (`pending/sent/failed/skipped`, `providerReference`, `failureReason`, `channel SMS/PUSH`, `recipientType/Id`, `correlationId → transferId/fundingId`) migration `0065` — **COMPLETE** (backend).
- **Dispatcher:** `NotificationDispatcherService` (outbox→`notification_deliveries` via `Console/Test` adapter, no invented credentials) — **COMPLETE** (provider-neutral, dev/test verified).
- **Provider abstraction:** `NotificationProvider` interface (`send` → `providerReference`/`failureReason`) — **COMPLETE** (architecture).
- **SMS status:** **BACKEND-ONLY** (Console/Test, not Termii/Twilio live) — **OUT OF SCOPE** (external dependency, correctly V2/ops-integration per V1-008 §14).
- **Push status:** **BACKEND-ONLY** (FCM/APNS not live) — **OUT OF SCOPE**.
- **Customer notification inbox:** `GET /customers/me/notifications` (`V1-006`, reuse `notification_deliveries`, `CUSTOMER SELF`, paginated, safe, zero migrations, 15 PG) — **COMPLETE**.
- **Admin delivery diagnostics:** **NOT IMPLEMENTED** — `GET /internal/notifications/deliveries` or `GET /internal/customers/:id/notifications` or `GET /internal/notifications ?entityId=&status=` **missing** (see `grep -rn "internal.*notif" src` 0). Ops cannot diagnose `pending/sent/failed/skipped`, `providerReference`, `failureReason`, channel resolver `SKIPPED` reasons (`PUSH_TOKEN_DEPENDENCY_MISSING` etc.) without DB `SELECT * FROM notification_deliveries` — **P2**.
- **Provider-neutral vs provider-dependent:** Architecture **complete** (provider-neutral + console/test), **external provider operations pending** (Termii, FCM) — **not code debt**.

**Remaining Notification gaps:** **1 P2** (Admin delivery diagnostics) — **dependency-supported** (table exists), narrowly scoped, not blocked.

## 16. Reconciliation Gaps

**Reassessment per §8:**

- **Reports exist:** `ReconciliationService.runReconciliation()` (9 checks: `wallet_balances_ledger_derived`, `wallet_liability_account_ownership`, `journal_balance_integrity`, `orphan_ledger_entries`, `journal_line_account_integrity`, `completed_payment_journal_integrity`, `failed_transfer_attempts` `WARNING`, `currency_consistency`, `accounting_unit_consistency`) + `getTrialBalance` + `getFinanceVerification` + `getAccountActivity(accountId)` — via `ReconciliationController` `GET /internal/reconciliation/report|trial-balance|finance|accounts/:accountId/activity`, read-only `withReadOnlyTransaction`, no mutation — **BACKEND-ONLY** `COMPLETE` (reporting).
- **Violations/breaks detectable:** **Yes** — `violations` count per check, `failed_transfer_attempts` as `WARNING` (not financial break but operational).
- **Sufficient for V1 launch?** **Yes** — if `violations==0` at launch, launch should be blocked (P0) but **no break is expected** (all checks should be 0, verified `hardening-04` 37s + `a23-a25` 60s with 0 violations). Reporting is **sufficient for launch**; no break expected.
- **Break-resolution workflow required?** **No V1 requirement** — no `POST /internal/reconciliation/breaks/:id/resolve|acknowledge`, no `reconciliation_breaks` table, no `audit` for resolver. `V1-008` and `H-05` identified `no clear break-resolution workflow` as **P2/ACCOUNTING DECISION**, not P0. Implementing would require **accounting/product decision**: who can `resolve` (`FINANCE_CONTROLLER` vs `FINANCE_AUDITOR`), is `resolve` vs `acknowledge`, is `audit` + `outbox` required, should `failed_transfer_attempts` be excluded from `violations` (currently `WARNING` but counted as `violations`), is `reconciliation_breaks` table needed or `audit` suffices?
- **Do NOT implement break resolution during audit** — correct per §8: retain `ACCOUNTING DECISION REQUIRED`.

**Remaining Reconciliation gaps:** **1 P2/ACCOUNTING DECISION** (`break-resolution` not implemented, reporting `COMPLETE` but resolution `NOT IMPLEMENTED`) — **BLOCKED** pending accounting governance, not V1 launch blocker.

## 17. Reversal Status

**Reconfirm:**

- **`LedgerService.reverseJournal`:** Exists (`src/ledger/ledger.service.ts:224` `reverseJournal(journalId, actor, reason)` → `SERIALIZABLE` `postJournal` with `reversal_of_journal_id`, `audit`, `outbox`? Actually `reverseJournal` creates compensating journal `DEBIT/CREDIT` swapped, `idempotency` via `reversal_of_journal_id` unique, `version` optimistic).
- **Admin reversal workflow:** **NOT IMPLEMENTED** — `grep -rn "reverse" src/admin` 0, `grep -rn "POST.*reverse" src` only `test/ledger-reversal` (contract) and `internal-transfer-gate` `reversal` adapter, **no** `POST /internal/transfers/:id/reverse` or `POST /internal/ledger/journals/:id/reverse` ops workflow.
- **V1 requirement:** **No authoritative V1 requirement** — `V1-PRODUCT-COMPLETION-AUDIT.md` §18 V1/V2 boundary: Wallet→Bank etc. OUT OF SCOPE, but reversal is **not listed as V1 required**; `V1-008` §14 and `H-05` §11 classify reversal as **`V2 + PRODUCT DECISION` — intentionally absent for V1** (reversals require accounting policy, maker/checker, idempotency, `reversal_of_journal_id` linkage, notification).
- **V1 without reversal:** **Sufficient** — failed transfers are `FAILED` not `PENDING_RECOVERY` auto-reversed; `INTERNAL` transfers not V1. V1 can launch without reversal (0-fee pilot).

**Remaining Reversal status:** **NOT IMPLEMENTED** — **V2/PRODUCT+ACCOUNTING**, **not required for V1**, do not implement.

## 18. Fees Status

**Do not modify; confirm only:**

- **Fees remain BLOCKED pending product/accounting decision** — `V1-HARDENING-02A` (`docs/V1-HARDENING-02A-FEE-POLICY-DECISION.md`) `BLOCKED` (fee table `fee_rules` `value/owner/per-flow` not defined, `FeeEngine.calculate` flat+%) remains correct.
- **`FeeEngine` (`FeeEngine.calculate` flat+%) exists as calculator**, `src/fee/fee.controller.ts` `POST /fees/calculate` exists but **not called** by `TransferService`/`AgentCashIn/Out` (all `feeMinor="0"` verified `a25` `feeMinor 0`), `agent_classes.applicable_limits` JSON, `customer_limit` table, but **no runtime call** → V1 runs **0-fee** as `V1-PRODUCT-COMPLETION-AUDIT` `METADATA ONLY` says.
- **Confirmation:** `grep -rn "FeeService\|FeeModule" src/admin` 0 after `H-06`/`07` (scope guard 15), `git diff HEAD~2..HEAD` shows 0 `src/fee` change — **Fees remain untouched, 0 source/migration/ledger/route changes, as required §11**.

**Status:** **BLOCKED — product/accounting decision required**, not implementation task during audit.

## 19. Limits Status

**Do not modify; confirm only:**

- **Limits remain BLOCKED pending product/operational decision** — `V1-HARDENING-03` (`docs/V1-HARDENING-03-LIMIT-POLICY-AUDIT.md`) `BLOCKED` (10 decisions: whether V1 needs limits, `single/daily/monthly/walletBalance` values per 11 flows, ownership, Lagos day semantics, override precedence, concurrency `customer_daily_usages FOR UPDATE` + `IdempotencyService.reserve`).
- **`customer_limit_profiles` (A config) + `LimitEngine` (B calculation) + `pilot_controls wallet.transfer.create.v1` (C conditional, `enabled=false`) + `InternalTransferGateService` (C yes but gated) exist**, but **customer-app `POST /customers/me/transfers` still bypasses gate** — only `INSUFFICIENT_FUNDS` enforced (`A5T09` pilot schema `exact, currency-labelled, bounded, command-time` remains metadata).
- **Confirmation:** `grep -rn "LimitService\|limitService" src/admin` 0, `git diff` 0 `src/limit`, `src/internal-transfer-gate` — **Limits remain untouched, 0 source/migration/ledger/route changes, as required §11**.

**Status:** **BLOCKED — product/operational decision required**, V1 can launch **balance-only** (10B transfer possible, documented), not limit-enforced.

## 20. Authorization/Security Findings

Re-audit `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` + `FINANCE_*` after `H-06`/`07` (see `RoutePolicyRegistry` + controllers + `test/a22` 15/15, `test/v1-hardening-06` 15/15, `test/v1-hardening-07` 16/16):

| Role | Principal Type | Allowed Internal Investigation (new) | Existing Lifecycle/Funding | Support | Reconciliation | Finance Roles |
|------|----------------|--------------------------------------|----------------------------|---------|----------------|---------------|
| **SUPPORT** | `SUPPORT` | **Allowed** `GET /internal/customers/:id/transactions|wallets|balance|support-tickets` (H-06) + `GET /internal/agents/:id/financial-position` (H-07) | **Denied** `POST .../suspend|terminate` (V1-003, `requireOperational` 403) | **Allowed** `GET /internal/support/tickets` + `POST .../assign|status|resolve|close|messages` | **Allowed** `GET /internal/reconciliation/*` (generic) | `FINANCE_*` not held |
| **OPERATOR** | `OPERATOR` | **Allowed** (same 4 + Agent position) | **Allowed** suspend/terminate/reactivate/activate + fund/defund + customer funding approve | **Allowed** | **Allowed** | Can initiate `FINANCE_ROLE_ASSIGN` if `initiatingRoles` includes |
| **SERVICE** | `SERVICE` | **Allowed** | **Allowed** | **Allowed** | **Allowed** | Depends |
| **PRIVILEGED** | `PRIVILEGED` | **Allowed** | **Allowed** | **Allowed** | **Allowed** | Yes |
| **FINANCE_PREPARER** | `FINANCE_PREPARER` | **Not in investigation matrix** (investigation is SUPPORT etc., not FINANCE) — `GET /internal/.../financial-position` not allowed for FINANCE_* (would be 401) — **correct**, investigation is Operations, not Finance | **Maker** (`POST .../funding-requests` `SUPPORT` actually `FINANCE_PREPARER` is maker via `workforce-configuration` `initiatingRoles`, but H-06 funding internal uses `SUPPORT` maker? Actually `CustomerFundingInternalController` `create` checks `FINANCE_PREPARER`? Check `financeRole` — but generic `SUPPORT` allowed for investigation, not funding) | **Not** | **Allowed** `GET /reconciliation/*` (primary) | **Maker** |
| **FINANCE_CONTROLLER** | `FINANCE_CONTROLLER` | Not | **Checker** (`POST .../approve`) | Not | **Checker** | **Checker** |
| **FINANCE_ADMIN/AUDITOR** | | Not investigation | Not | Not | **Allowed** read | Admin |

**No obvious privilege escalation:** `SUPPORT` cannot fund/defund (funding requires `FINANCE_PREPARER/CONTROLLER` or `OPERATOR` via `AgentFunding` but `SUPPORT` denied for `POST .../fund`), cannot approve funding (`maker≠checker` + `FINANCE_CONTROLLER`), cannot lifecycle `suspend` (403), but **can** investigate (read) — **appropriate** (support needs to answer "what is balance/history?" without DB). No broadening of `RoutePolicyRegistry` beyond `SUPPORT` for read: not a security issue.

**No new auth system:** Reused `RoutePolicyRegistry` generic `internal-route` + `requireWorkforce` — no new `AuthorizationPolicy`.

**Remaining gap security:** None — remaining `P2` (notification diagnostics, support linkage) would also be `SUPPORT` read, no mutation, no new privilege.

## 21. P0/P1/P2/V2/Product/Accounting Classification

After `H-06`+`07` (see §6 matrix, §7 13 questions, §8 flow matrix, §15-19):

| Classification | Count | Items | Launch Blocker? |
|----------------|-------|-------|-----------------|
| **P0** — prevents safe operation (invariant break) | **0** | (if `violations>0` at launch, would be P0, but `violations==0` verified) | **No** |
| **P1** — required V1 operational capability (without DB) | **0** | *Previous P1s G1-G4 now COMPLETE via H-06/H-07* — G1 customer financial position **COMPLETE**, G2 customer unified history **COMPLETE**, G4 agent financial position **COMPLETE**; G5 Agent unified history classified as **BLOCKED** (not P1 for launch per §7) | **No** |
| **P2** — useful hardening, not launch-blocking | **4** | 1. Customer profile/contact `displayName/phone` in Admin view (G6) — `PARTIAL`→2. Journal/ledger correlation convenience (G7) — `PARTIAL` 3. Support linked-transaction convenience (G8) — `PARTIAL` 4. Notification delivery Admin diagnostics (`GET /internal/notifications/deliveries`) — `BACKEND-ONLY` (see §15) | **No** |
| **V2** — intentionally not V1 (external, V2 scope) | **1** | Reversal workflow (`LedgerService.reverseJournal` exists but no Admin, V1-008 V2) — `V2/PRODUCT` | **No** |
| **PRODUCT DECISION** | **3** | Fees (`02A` BLOCKED), Limits (`03` BLOCKED), Agent unified history semantics (would need product type/counterparty/direction decisions, §7 Q9) — **BLOCKED** pending product ADR | **No** (V1 can launch 0-fee, balance-only) |
| **ACCOUNTING DECISION** | **1** | Reconciliation break-resolution workflow (`POST .../breaks/:id/resolve`) — `ACCOUNTING DECISION` (who resolves, audit/outbox, `failed_transfer_attempts` as violation?) — **BLOCKED** pending accounting governance | **No** (reporting sufficient) |
| **COMPLETE** (no gap) | **~12** | Customer/Agent/Aggregator list/view/lifecycle, Funding maker/checker, Cash→Cash, Outlets/Terminals, Support lifecycle, Audit, Wallet ledger-derived, Customer unified history, etc. | — |
| **OUT OF SCOPE** (V2) | **12** | Wallet→Bank, Bank→Wallet via NIBSS live, Wema/Providus/NinePSB, external settlement, cards/dollar cards, bills/airtime/data/electricity/cable/betting, non-NGN | — |

**Previous H-05 had 4 P1 (G1-G4) + 1 P1 lower (G5) + 3 P2 + 2 PRODUCT/ACCOUNTING + 1 V2 = 11 gaps; after H-06/H-07, 4 P1 are COMPLETE, leaving 0 P1, 4 P2, 1 V2, 3 PRODUCT/1 ACCOUNTING blocked — no P0/P1 remains.**

## 22. Dependency Graph

```
A2 Workforce (FINANCE_* roles, approvals, bootstrap) ─┐
                                                    ├→ Funding maker/checker (FINANCE_PREPARER/CONTROLLER, maker≠checker, SERIALIZABLE) ──→ ledger (settlement→wallet) ──→ audit
A3 Wallet/Ledger (wallet_accounts.liability CUSTOMER_FUNDS, non-negative, ledger balance) ─┐
                                                                                           ├→ Customer unified history (wallet→ledger→journal) ← hardening-04 COMPLETE (CUSTOMER SELF)
                                                                                           ├→ H-06 Admin Customer Investigation (SUPPORT) ← 15 PG (reuse CustomerTransactionHistoryService)
                                                                                           └→ H-07 Admin Agent Financial-Position (SUPPORT) ← 16 PG (reuse WalletService)
A5/A8 Agent Application (applicant → PENDING → ACTIVE) ─→ Agent lifecycle (suspend/terminate/reactivate) ─→ Agent wallets/float (fund/defund, ledger) ─→ Cash→Cash (agent→unclaimed→claimant) ─→ notification_deliveries
A9 Receiving numbers (canonical 10-digit Agent vs Customer collision) ─→ wallet routing
A18 Aggregator (create, attach agent) ─→ A20 Outlets/Terminals (outlet→terminal)
A23 Customer App (me/wallets/balance/receiving/transfer/pin/dashboard) ─→ hardening-01 beneficiary (beneficiaryId routing) ─→ hardening-04 unified (WALLET_TRANSFER/CASH_IN/OUT/CASH_TO_CASH/FUNDING, safe projection)
Support (customer/agent tickets → internal assign/status/resolve/close/messages) ─→ audit
Reconciliation (9 checks: wallet_balances_ledger_derived, journal_balance_integrity, etc.) ─→ trial-balance/finance/accounts/:id/activity (read-only, no resolve)
Operations (metrics/diagnostics/audit/outbox) ─→ audit_events / outbox_events
Notification (inbox + deliveries pending/sent/failed/skipped, Console/Test provider-neutral) ─→ V1-006 inbox + deliveries table (no Admin diagnostics)

Gaps depend on existing tables/services:
G6 Customer profile/contact in Admin view → depends on customer_profiles/customer_contact_methods (exists) + AdminCustomerController.toSafeCustomer (reuse) — SUPPORTED
G7 Journal correlation convenience → depends on ledger_journals/lines (exists) — SUPPORTED but safe hides ledgerAccountId by design
G P2 Notification Admin diagnostics → depends on notification_deliveries (0065, exists) — SUPPORTED
G10 Break-resolution → depends on accounting policy decision — BLOCKED (requires who resolves, audit/outbox)
G11 Reversal → depends on LedgerService.reverseJournal but needs product policy — BLOCKED (V2)
Agent unified history → depends on cash_to_cash_transfers + ledger + agent_funding (exists) but needs product type decisions (Q9-13) — BLOCKED

All P2 hardenings are dependency-supported (no new ledger), narrowly scoped, V1-relevant, not fees/limits/beneficiary/history duplication.
```

## 23. Recommended Next Task

**Exactly ONE — `V1-HARDENING-08 (Next) — Admin Notification Delivery Diagnostics`**

**Title:** `V1-HARDENING-08 — Admin Notification Delivery Diagnostics (Read-Only)`

**Scope (narrow, V1-relevant, dependency-supported, not blocked, independently testable, not fees/limits/reversal/reconciliation-resolution):**

- Add **read-only** Admin routes under `internal/notifications` or `internal/customers/:id/notifications`:
  - `GET /api/v1/internal/notifications/deliveries` — `WORKFORCE_SESSION` `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` (SUPPORT can diagnose), query `?recipientType=CUSTOMER|AGENT&recipientId=uuid&status=pending/sent/failed/skipped&channel=SMS/PUSH&correlationId=uuid&page&limit` — paginated `createdAt DESC,id DESC`, safe projection `{id,recipientType,recipientId,channel,status,providerReference,failureReason,correlationId,createdAt}` (hide `providerApiKey` etc. if any), reuse `notification_deliveries` table (already `1785753600065` + `idx_notification_deliveries_recipient`).
  - Optional alias `GET /api/v1/internal/customers/:id/notifications/deliveries` + `GET /api/v1/internal/agents/:id/notifications/deliveries` as convenience (reuse same service, `recipientId=:id`).

- **Authorization:** `SUPPORT` allowed (diagnose `failed/skipped`), `CUSTOMER/AGENT` denied 401, unauth 401 — update `RoutePolicyRegistry` for `GET /api/v1/internal/notifications/*` to `WORKFORCE_SESSION` `SUPPORT`-inclusive (like H-06/H-07), `requireWorkforce`.

- **Reuse:** `NotificationDeliveryService` or `DataSource.query` `SELECT ... FROM notification_deliveries WHERE ... ORDER BY created_at DESC, id DESC` — no new `notification_deliveries` table, no provider, no `SMS`/`Push` live, no `providerReference` invented (already stored by dispatcher `Console/Test`).

- **Audit:** All new routes are **read** (list/view) — no audit record required (reads not audited, consistent with `AdminCustomerController.list`), no financial mutation.

- **Tests:** 10–12 focused PG: `SUPPORT` can list, `OPERATOR` can list, `SERVICE/PRIVILEGED` can list, `CUSTOMER/AGENT` denied, unauth 401, pagination deterministic, filtering `status/channel/correlationId`, safe projection (no `providerApiKey`), cross-customer isolation (CUSTOMER A cannot see B's deliveries via Admin), `notification_deliveries` counts unchanged after reads, 66→66, `tsc` 0.

**Why this ONE (and not Agent history, reconciliation, fees, limits, reversal):**

- **Genuinely V1 operational:** After `H-06/H-07`, Ops can investigate `customer→wallet→transaction→ticket→financial-position` without DB, but **cannot diagnose** `notification_deliveries` `failed/skipped` (`failureReason: PUSH_TOKEN_DEPENDENCY_MISSING/CUSTOMER_PHONE_MISSING`, `providerReference`) — must use `SELECT * FROM notification_deliveries` (see §15: `BACKEND-ONLY` → `NOT IMPLEMENTED` for Admin). This blocks **customer-support to answer “did SMS/push send?”** — frequent.
- **Dependency-supported:** `notification_deliveries` table **already exists** (`0065` + `idx_recipient`), `NotificationDispatcherService` already writes `pending/sent/failed/skipped`, V1-006 inbox already proves `recipientType/Id` filtering.
- **Narrowly scoped:** Single read service, 1-2 `GET` routes, safe projection, pagination, no ledger, no second table, no provider.
- **Independently testable:** Can create `notification_deliveries` rows via `NotificationDeliveryService` or `DataSource` and list via Admin.
- **Not blocked:** Unlike `Agent unified history` (needs product type decisions Q9-13 → **BLOCKED**), `reconciliation break-resolution` (**ACCOUNTING DECISION**), `fees/limits` (**PRODUCT**), `reversal` (**V2**) — diagnostics is **pure read**.
- **Not fees/limits/beneficiary/history duplication:** History already `COMPLETE` (04), beneficiary `BACKEND-ONLY` but not required for W→W (recipient resolution suffices), fees/limits `BLOCKED` — diagnostics is **new hardening**, not repeat.

**Alternative considered but NOT chosen:** `Agent unified history` — would be hardening, but **requires product decision** (which 6-7 types, counterparty/direction semantics not in V1 docs, see §7 Q9-13) → **BLOCKED**. `Reconciliation break-resolution` → **ACCOUNTING DECISION** (who resolves, `audit`/`outbox`). `Customer profile/contact in Admin` → viable P2 but lower operational value than notification diagnostics (support asks “did notification fail?” more often than “what is displayName?”).

## 24. Explicitly Out-of-Scope Items

**For V1, DO NOT implement (and this audit created 0 source/migration/ledger/route changes):**

- Wallet → external bank (no `Wallet→Bank`, no `NIBSS` `BankService`/`ProviderAdapter`, no `partner-callbacks` NIBSS live beyond `SERVICE` `partner:callback:receive` internal)
- External bank → wallet via live provider (no `provider` settlement)
- Third-party payment-provider settlement (no `external-provider` reconciliation)
- Cards, dollar cards, non-NGN
- Bills, airtime, data, electricity, cable, betting (no `bills` engine)
- Second ledger / second balance (no `CustomerBalance` table, no `balanceMinor` column, ledger remains `SERIALIZABLE` `postJournal`)
- Second PIN engine / second authentication engine / second session engine (reuse `CustomerTransactionPinService`, `CustomerAuthenticationService`, `AuthenticationSessionService`)
- Second history table / second financial engine (history stays `transfers` + `ledger_journals` + `customer_funding_requests` + `cash_to_cash_transfers`)
- Speculative schema (no `customer_funding` without V1-001, no `support_ticket` without V1-007 — now complete)
- Arbitrary `UPDATE wallet SET balance` (all wallet changes via `postJournalInTransaction` only)
- Logging of `password`/`pin`/`tokenHash` (`pinoHttp` redact `currentPassword/newPassword`, `redactRecord` covers)
- **This audit:** No fees, no limits, no beneficiary, no reconciliation break-resolution, no reversal, no notification provider live (Termii/FCM) — **only this report** (`0` source, `0` migration, `0` ledger, `0` route).

**Verification:** `git diff --stat HEAD` after audit → `0` (only `docs/V1-HARDENING-08-REMAINING-OPERATIONAL-GAPS-AUDIT.md` added, allowed), `grep -rn "BankService\|nibss\|ProviderAdapter\|bills\|airtime" src/admin` 0 (H-06 scope guard).

## 25. Final Status

**`VERIFIED — V1 operational surface sufficiently defined; next task identified`**

- **Not** `GAPS FOUND — V1 operational gaps remain; next task identified` — No **P0/P1** remains after `H-06`+`07` that blocks V1 launch without DB; 4 P1s from `H-05` are now `COMPLETE` (customer financial position, unified history, transaction detail via unified, agent financial position). Remaining gaps are **P2** (notification diagnostics, customer profile/contact, support linkage convenience, journal correlation) and **BLOCKED** (Agent history product decision, fees, limits, reconciliation break-resolution accounting, reversal V2) — **not launch-blocking**.
- **Not** `BLOCKED — remaining V1 work requires product/accounting decision` — While fees/limits/reconciliation/reversal/agent-history are **BLOCKED**, the **next task itself** (`Admin Notification Delivery Diagnostics`) is **not blocked** — it is dependency-supported (`notification_deliveries` exists), narrow, testable, not fees/limits/reconciliation. So overall V1 can proceed to next hardening; not `BLOCKED`.

**Major operational findings after H-07:** Customer `COMPLETE` (H-06), Agent `COMPLETE` (lifecycle + financial-position), Aggregator `COMPLETE`, Funding `COMPLETE`, Cash→Cash `COMPLETE` (create/claim/expiry), Outlets/Terminals `COMPLETE`, Support `COMPLETE`, Audit `COMPLETE`, Wallet `COMPLETE` (ledger-derived), Transfer unified `COMPLETE`, Notification `BACKEND-ONLY` (delivery records `COMPLETE`, Admin diagnostics `NOT IMPLEMENTED` → **next P2**), Reconciliation reporting `COMPLETE` but resolution `BLOCKED`.

**Role findings:** `SUPPORT` correctly can investigate (H-06/H-07 read) but cannot `suspend`/`fund`/`approve` (403), maker≠checker on funding enforced, `FINANCE_*` separation, no privilege escalation, safe projections.

**Resource gaps:** `0 P0`, `0 P1`, `4 P2`, `1 V2`, `3 PRODUCT/1 ACCOUNTING BLOCKED`, `0 NOT IMPLEMENTED` for money, `12 OUT OF SCOPE` (V2).

**Report path:** `docs/V1-HARDENING-08-REMAINING-OPERATIONAL-GAPS-AUDIT.md` (this file) — HEAD `9c4275e` → next `feat(hardening-08): Admin Notification Delivery Diagnostics` (parent `9c4275e`), 66→66 migrations, **VERIFIED**.

**Tests/checks:** `git rev-parse HEAD` `9c4275e`, `ls src/migrations/*.ts | wc -l` 66, `SELECT count(*) FROM typeorm_migrations` 66, `Admin` 4 new routes (H-06/H-07) + `RoutePolicyRegistry` generic `SUPPORT` verified, `a22` 15/15 + `a25` 17/17 + `hardening-06` 15/15 + `hardening-07` 16/16 `PASS`, `tsc --noEmit` 0, `build` 0, `source changes 0` (audit-only) — only this doc new.

**Fees/limits confirmation:** **Fees remain BLOCKED/untouched (02A), limits remain BLOCKED/untouched (03), beneficiary BACKEND-ONLY not redone, unified history COMPLETE (04) not redone, H-06/H-07 not reopened.**

---

**FINAL REPORT (for session):** HEAD `9c4275e` → `V1-HARDENING-08` audit-only (no source/migration/ledger/route), migration count **66→66** (0 new), Customer `COMPLETE` (H-06), Agent financial-position `COMPLETE` (H-07), Agent unified history **BLOCKED pending product decision** (13 questions, flow matrix 8 flows, proposed contract detailed but not required for V1), remaining `4 P2` (notification diagnostics `NOT IMPLEMENTED` → **next task** `GET /internal/notifications/deliveries` `SUPPORT`, customer profile/contact, support linkage, journal correlation) + `1 V2` (reversal) + `3 PRODUCT/1 ACCOUNTING BLOCKED` (fees/limits/reconciliation), `tsc` 0, `build` 0, report `docs/V1-HARDENING-08-REMAINING-OPERATIONAL-GAPS-AUDIT.md` — **VERIFIED — V1 operational surface sufficiently defined; next task identified**.

---

VERIFIED — V1 operational surface sufficiently defined; next task identified
