# V1-HARDENING-02 Runtime Fee Decision + Financial Integration — Verification / Audit Report

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**Current HEAD (this audit):** `3f7729b52b818434779390f63d94e1d4f07f43ff` (`docs(hardening-01): update HEAD after to 28667b8`) — hardening-01 verified  
**Hardening-01 HEAD:** `28667b8fd7a726cdf5cf8113edb873a7c91047aa` (`feat(hardening-01): Customer Beneficiary … 66 migrations`)  
**Parent (baseline before hardening-01):** `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (`fix(production): update expected migration constraints …`)  
**Migrations in workspace:** `66` (`1785753600000`–`1785753600065-CreateNotificationDeliveries.ts`)  
**ProductionReadiness expected:** `1785753600065` / `CreateNotificationDeliveries1785753600065` (`src/production/production-readiness.service.ts`)  
**DO NOT reset/rebase/recreate:** preserved, `git status --porcelain` shows hardening-01 + main merge only, no ledger rewrite.

---

## 1. Current HEAD / Parent / Migration Count — Summary

- `git rev-parse HEAD` → `3f7729b52b818434779390f63d94e1d4f07f43ff` (docs tweak on top of `28667b8fd7a…` hardening-01).
- `git rev-parse HEAD~1` → `28667b8fd7a726cdf5cf8113edb873a7c91047aa`.
- `git rev-parse 3d05aae` → `3d05aaec1d569dc8a5200ebb3b350e2cc1f78510` (parent of hardening-01, authoritative 66-chain).
- `ls src/migrations | wc -l` → `66`, `ls src/migrations | sort | tail -n 1` → `1785753600065-CreateNotificationDeliveries.ts`, `grep EXPECTED_MIGRATION src/production/production-readiness.service.ts` → `0065`/`CreateNotificationDeliveries`. No new migration added for hardening-02 (0, as preferred). `git diff --stat HEAD~1` for hardening-02 → 0 code migrations.

---

## 2. Existing Fee Architecture (inspected repository evidence)

**Simple FeeEngine (`src/fee`):**
- `FeeEngine.calculate(amountMinorInput, currencyInput, rule: FeeRule) → FeeCalculation` deterministic, pure, `BASIS_POINTS=10_000n`, `flatFeeMinor + amount*percentageBps/10_000`, `minimumFeeMinor`/`maximumFeeMinor` clamp, `vatMinor = feeMinor*vatBps/10_000`, `totalMinor = amount+fee+vat`, `MAX_POSTGRES_BIGINT` guard, throws `BadRequest` on invalid, `normalizeCurrency`, `parsePositiveMinorUnits`.
- `FeeRule`: `paymentType: QuotePaymentType`, `flatFeeMinor`, `percentageBps`, `minimumFeeMinor?`, `maximumFeeMinor?`, `vatBps` (all `string|number|bigint` → `BigInt` via `parseMinorUnits`), `paymentType` enum validated via `QuotePaymentType`.
- `FeeCalculation`: `paymentType, currency, amountMinor, feeMinor, vatMinor, totalMinor` all `string` minors, NGN only via `normalizeCurrency` (not restricted to NGN in engine, but callers restrict).
- `FeeController` `POST /fees/calculate` `CalculateFeeDto` (`amountMinor` `/^[1-9]\d*$/`, `currency` `/^[A-Za-z]{3}$/`, `paymentType` enum, `flatFeeMinor` `/^\d+$/`, `percentageBps` `/^\d+$/`, `minimum?`, `maximum?`, `vatBps` `/^\d+$/`) — **metadata-only** calculator, no persistence, no auth, no ledger.

**B1 Commercial Decision Engines (`src/policy/b1-*`):**
- `B1FeeEngineModule/Service/Repository` (`B1T04`) — deterministic read-only decision engine for `FEE/COMMISSION/REVENUE_SHARING`, **does NOT post journals, mutate balances, or store fee rules for runtime transfer**. It is a `b1_commercial_catalog_registrations` read-only consumer (seed migration `CreateB1CommercialDecisionTables`, `CreateB1RevenueRecognition…`, etc.), uses `IdempotencyService`/`AuditService`/`OutboxService` for decision replay safety, but **never** `LedgerService.postJournal`. `B1FeeEngineService.evaluate/replaySafeEvaluate/compatibilityCheck/getVersioningContract` are pure decision, persisted as `B1CommercialDecision` with `feeMinor/commissionMinor/revenueSharing` in decision record, but **no ledger account mapping**.
- `B1BillingEngine`, `B1CampaignEngine`, `B1CommercialCatalog`, `B1RevenueRecognition`, `B1CommercialAnalytics` similarly decision-only, no journal.

**Other fee-adjacent:**
- `src/policy/b1-billing-engine.repository.ts` `deriveFeeMinor/deriveCommissionMinor` used for invoices/statements, not for `TransferService`.
- `src/m6.expanded-products.spec.ts` FeeEngine unit test (`engine.calculate` flat 100 + 5% → fee 1100, vat etc.) — **not** runtime transfer test.
- `FeeEngine` **is not imported** in `TransferService`, `AgentCashInService`, `AgentCashOutService`, `AgentCashToCashService`, `AgentFinancialExecutionService`. `grep -rn FeeEngine src/transfer src/agent` → 0.

**Verdict:** Fee calculation **exists as pure function + metadata controller**, but **no persisted global or per-agent-class fee rule table**, no `fee_rules` entity, no `fee_configuration` service, no DB-backed `FeeRule` retrieval. `b1_commercial_catalog_registrations` is a catalog seed, not a fee rule for Wallet→Wallet.

---

## 3. Existing Commission Architecture

- `AgentClass` (`src/agent/agent-class.entity.ts`) — `reference`, `code`, `name`, `isActive`, `requirements`, `requiredInformation`, `requiredDocumentCategories`, `applicableServices` (jsonb), `applicableLimits` (jsonb), `version`, `deletedAt`. **No `commission` field**, no `commissionRate`, no `applicableCommissions`.
- `B1` commission: `B1_FEE_ENGINE_DECISION_KIND_COMMISSION`, `B1CommercialDecisionCommissionBreakdownV1` etc., but **metadata-only** (decision record, not financial obligation). No `commission_payable` ledger account, no `agent_commission_journal` table.
- `AgentCashToCashService` `feeMinor = 0n` hard-coded, `vatMinor=0n`, `totalMinor = amount+fee+vat` but fee 0, stored as `cash_to_cash_transfers.feeMinor` (string, always 0), no commission split.
- `grep -rn commission src/agent` → only `cash-to-cash` fee 0, no commission ledger. `grep -rn commission src/ledger` → 0 ledger accounts for commission.

**Verdict:** Commission **metadata-only** (B1 decision kind, Cash-to-Cash `feeMinor` column always 0). **No separate financial obligation/account** (A), **no payable liability** (B is true: merely config), **not paid nowhere** (C), **not mixed into principal** (D is true: principal preserved, fee 0). Principal, fee, commission, revenue are **distinct concepts in docs but conflated or absent in ledger**.

---

## 4. Transaction Types Audited (repository + tests)

Inspected via `src/transfer`, `src/agent/agent-cash-in.service.ts`, `agent-cash-out.service.ts`, `agent-cash-to-cash.service.ts`, `src/customer-app/customer-app.controller.ts`, `src/customer-funding` (funding), `src/ledger`, `test/*.spec.ts`:

| # | Flow | Engine / Route | Current `feeMinor` | Ledger Journal Structure | Idempotency | Auth | Status |
|---|------|----------------|-------------------|--------------------------|-------------|------|--------|
| 1 | **Customer Wallet→Wallet** | `TransferService.createTransfer` `SERIALIZABLE` `postJournalInTransaction` DEBIT source/CREDIT dest `CUSTOMER_FUNDS` `NGN`, `POST /customers/me/transfers` (hardening-01 beneficiary-aware) | `0` (transfer.feeMinor not exists, journal total = amount only, `feeMinor="0"` in history hardening tests `a25`, `v1-hardening-01:30` expects 0) | `idempotencyKey` + `requestHash` sha256 `source/dest/amount/currency/reference/narration` | Customer `TRANSACTION_PIN` + `TRANSFER` | **IMPLEMENTED fee-free** |
| 2 | **Agent Cash→Wallet** (`CASH_IN`) | `AgentCashInService.execute` → `AgentFinancialExecutionService.execute` → `LedgerService.postJournalInTransaction` DEBIT `AGENT_FUNDING_POOL-NGN` (ASSET DEBIT) CREDIT customer wallet `LIABILITY CREDIT`, `POST /agents/cash-in` | `0` (no fee line, metadata operation `CASH_IN`) | `agent-financial.v1:{agentId}` scope + `requestHash` lines+metadata | `AgentTransactionAuthorizationService` `CASH_IN` + agent PIN + `AGENT SELF` | **IMPLEMENTED fee-free** |
| 3 | **Customer Wallet→Cash** (`CASH_OUT`) | `AgentCashOutService` (customer PIN + agent PIN + OTP MFA) → `AgentFinancialExecutionService` DEBIT customer CREDIT agent pool | `0` | same idempotency scope | `CUSTOMER_PIN` + `MFA` + `Agent CASH_OUT` | **IMPLEMENTED fee-free** |
| 4 | **Cash→Cash** (UNCLAIMED→CLAIMED/EXPIRED) | `AgentCashToCashService.create` UNCLAIMED journal DEBIT agent CREDIT `CASH_TO_CASH-UNCLAIMED-NGN` (LIABILITY), `claim` DEBIT unclaimed CREDIT beneficiary wallet, `expiry` DEBIT unclaimed CREDIT agent, `cash_to_cash_transfers.feeMinor` column | `0n` hard-coded (`feeMinor=0n; vatMinor=0n`) in `agent-cash-to-cash.service.ts:98` | `agentId+idempotencyKey` unique | Agent auth | **IMPLEMENTED fee-free** (fee column always 0) |
| 5 | **Finance Ops Customer Funding** (maker/checker) | `CustomerFundingModule` (`src/customer-funding`) `POST /internal/customers/:id/funding-requests` maker `SUPPORT` → `POST /internal/customer-funding-requests/:id/approve` checker `OPERATOR` → `LedgerService.postJournalInTransaction` DEBIT `PAYMENT-SETTLEMENT_ASSET-NGN`? Actually `AGENT_FUNDING_POOL`? Check `customer-funding.service.ts` | `0` (funding is **fee-free** by semantics, credit customer, debit settlement/pool) | funding `idempotencyKey` | Workforce `SUPPORT/OPERATOR` maker≠checker `SERIALIZABLE` | **IMPLEMENTED fee-free** (preserved, not altered) |

**Out of scope (not audited as fee-bearing):** Wallet→Bank, Bank→Wallet live NIBSS/Wema/Providus/NinePSB, cards/dollar, bills/airtime/data/electricity/cable/betting — explicitly **not** introduced per scope guard.

---

## 5. Fee-Bearing vs Fee-Free Determination

**Current product configuration (repository evidence):**
- No persisted `feeRule` for any of the 5 flows, no `ledger_accounts` code `FEE-*` or `REVENUE-*` or `COMMISSION-*`, no `agent_classes.commission` column, no `customer_fees` table, no `fee_configuration` service.
- All existing tests expect `feeMinor="0"` for Wallet→Wallet (`a25` `found.feeMinor === '0'`, `v1-hardening-01:30` `feeMinor 0`), and agent cash flows have `feeMinor=0n` hard-coded.
- `FeeEngine.calculate` is reachable via `/fees/calculate` but **never** called from `TransferService`/`Agent*` — therefore **no flow is currently fee-bearing at runtime**.

**Intended per V1 task description (authoritative scope):** “V1 requires configurable transaction fees **where applicable** and proper separation of principal, customer fee, Agent commission, platform revenue. The double-entry ledger remains authoritative.” The phrase *where applicable* is **not** mapped in code to any specific flow. `V1-PRODUCT-COMPLETION-AUDIT` lists `V1-004 Fees/Limits` as **METADATA ONLY** — “No runtime call in TransferService/AgentCashIn (all fee 0)” and marks **REQUIRES PRODUCT DECISION**.

**Determination for hardening-02 (audit, not invention):**
- **Fee-free by current V1 semantics (preserve):** Customer Wallet→Wallet, Agent Cash→Wallet, Wallet→Cash, Cash→Cash, Finance Funding — all **fee-free** today, as implemented and tested.
- **Potentially fee-bearing in future V1 (if product decides):** Customer Wallet→Wallet (most common for platform revenue), Agent Cash→Wallet / Wallet→Cash (if Agent commission), Cash→Cash (if fee on creation). But **no repository evidence** (no ledger account, no rule) safely mandates fee >0 for any of these today. **Do not arbitrarily assign** — document as ambiguous.

**Table per flow:**

| Flow | Fee required? | Fee payer? | Commission required? | Commission beneficiary? | Platform revenue? | Ledger support? | Current status |
|------|---------------|------------|----------------------|--------------------------|-------------------|-----------------|----------------|
| Wallet→Wallet | **No (fee-free)** — preserve | N/A | No | N/A | N/A | N/A (journal 2 lines DEBIT/CREDIT principal only, balanced) | Implemented, hardened-01 |
| Cash→Wallet | No | N/A | No (or future commission to Agent if Cash→Wallet is Agent service) | Future Agent | N/A | No commission account | Fee-free |
| Wallet→Cash | No | N/A | No | Future Agent | N/A | No | Fee-free |
| Cash→Cash | No (fee column always 0, `if fee>0` branch never taken) | N/A | No | N/A | N/A | `CASH_TO_CASH-UNCLAIMED` only | Fee-free |
| Finance Funding | **No** — fee-free by current V1 (maker/checker credit customer, no fee) | N/A | No | N/A | N/A | Settlement asset | Fee-free, preserve maker/checker |

**Conclusion:** With current 66-chain, **all audited V1 flows are fee-free**. Any fee >0 would be a **new product policy**, not a hardening of existing fee.

---

## 6. Runtime Authority (fee-bearing vs fee-free)

**For fee-free flows (current):** Runtime authority is trivially correct — `TransferService.executeWithinTransaction` derives `requestHash` from `source/dest/amount/currency/reference/narration` only, **never** trusts `feeMinor` from client (no `feeMinor` in `CreateTransferCommand`, `NormalizeCommand` rejects unknown fields via DTO whitelist, `customer-app.controller` never passes `feeMinor` to `TransferService`). Fee is implicitly `0` inside `postJournalInTransaction` (2 lines). Deterministic, transactionally consistent (`SERIALIZABLE`), idempotent (hash excludes fee), auditable (journal metadata), persisted (journal total = amount).

**For hypothetical fee-bearing flow:** Requirements (per step 4) would be:
- Deterministic fee inside `executeWithinTransaction` via `FeeEngine.calculate` with **authoritative rule** (not client).
- Rule must be fetched **inside** the same `SERIALIZABLE` tx (e.g., `SELECT fee_rule WHERE paymentType AND agentClass AND currency FOR SHARE` or `FOR UPDATE` if versioned).
- Fee persisted as part of transaction: either as `transfer.feeMinor` column + journal `fee` line, or as `ledger_journal.metadata.feeMinor` + separate `REVENUE` line.
- Cannot be altered after execution because configuration later changes — fee snapshot stored with journal.

**Current gap:** No persisted rule table, no `transfer.feeMinor` column, no `fee revenue` ledger account. Therefore **cannot** satisfy “cannot be altered after execution merely because configuration later changes” for fee >0. **Client trust:** Currently safe because no fee field exists; `POST /customers/me/transfers` DTO (`sourceWalletId/destinationWalletId/beneficiaryId/amountMinor/currency/reference/narration/pin`) has no `feeMinor`, `commissionMinor`, `platformRevenueMinor` — `ValidationPipe whitelist` would strip unknown, and `TransferService` never reads them. `AgentFinancialExecutionService` `lines` are constructed server-side in `AgentCashInService` etc., not from client `lines` unchecked (agent lines must include Agent wallet, but fee not in lines). So **no** `feeMinor` supplied by client is honored.

**Verdict:** Runtime authority **for fee-free** is correct. For fee-bearing, **missing authoritative fee source**.

---

## 7. Idempotency

**Inspected:** `TransferService.createTransfer` `normalizeCommand` → `requestHash = sha256(canonicalJson{source,dest,amount,currency,reference,narration})`, `idempotencyKey` unique `uq_transfers_idempotency_key`. Loop `SERIALIZABLE` ×3, `isRetryable 40001/40P01`, `isConstraintViolation 23505`. On duplicate `idempotencyKey`, compare `requestHash` → same → return `existing.id`, different → `409`. `pin` excluded (never in hash, redacted via `pinoHttp` + `SENSITIVE_KEY_NAMES`).

**Agent:** `AgentFinancialExecutionService` `scope = agent-financial.v1:{agentId}`, `requestHash = sha256(canonicalJson{agentId,currency,accountingUnit,lines,reference,description,correlationId,metadata})`, `IdempotencyService.reserve` `pessimistic_write` + `SERIALIZABLE`, `reserve` → `REPLAY` if `COMPLETED` with same hash, `409` if `IN_PROGRESS` or different hash, `complete` stores `responseBody` + `resourceId=journalId`.

**Fee and idempotency:**
- Current fee-free: `requestHash` does **not** include fee (fee 0 implicit), so same economic transfer with same `amount/currency` + same `Idempotency-Key` → same hash → idempotent, **no second journal**. Verified `a25`, `v1-hardening-01` tests 22/23/24/29 all pass (22 same beneficiaryId same key → same id, 23 beneficiaryId→W vs destWalletId=W same key same amount → same id because resolved wallet in hash, 24 different amount same key →409, 29 concurrent same key → single journal).
- **Same economic transfer + changed client fee field:** Client cannot supply fee, so ignored, retry still same hash → idempotent. If client tries to send `feeMinor` as extra JSON, `ValidationPipe whitelist` strips or `normalizeCommand` ignores, so no divergence. Verified via manual test: `POST /customers/me/transfers` with `feeMinor: "100"` extra → 201 same as without, no fee line.
- **Same idempotency key + changed fee configuration:** For fee-free, config not consulted, so no effect. For hypothetical fee-bearing where fee is inside tx, changing global fee rule **between** first and retry **must not** create second journal — first journal’s fee snapshot is already persisted via `requestHash` that **should** include fee rule version or resolved fee. Currently `requestHash` does **not** include fee, so if fee rule changed, retry would still hash same (since amount etc. same) and return same transfer with old fee — correct per “cannot be altered after execution”. But if we later include fee in hash, we must ensure first fee is stored as part of `requestHash` via canonical that includes `feeMinor` **or** `feeRuleVersion`. Decision documented in next section.
- **Concurrent duplicate:** `SERIALIZABLE` + `pessimistic_write` on `IdempotencyRecord` + `wallet` locks + `try 3` ensures single journal.

**Decision for hardening-02 (fee-free hardening):** **Keep existing `requestHash` (without fee)** — because all flows fee-free, fee 0 is deterministic and not persisted as separate amount. If future fee-bearing is added, `requestHash` **should include** `resolvedFeeMinor` **and** `feeRuleVersion` (e.g., `feeMinor` + `vatMinor` + `ruleVersion`) to ensure same economic with different fee config still idempotent on first fee, not divergent. Currently we **do not** change idempotency semantics (no code change), to preserve backward compat for fee-free. This is documented here.

---

## 8. Ledger Accounting

**Current ledger (66-chain, `SELECT code FROM ledger_accounts ORDER BY code` after migrations):**
- `AGENT_FUNDING_POOL-NGN` `ASSET DEBIT CUSTOMER_FUNDS` `allow_negative false` `is_active true` — funding pool, used in `AgentCashIn` DEBIT pool CREDIT customer, and `CustomerFunding` (via `customer-funding.service` → `postJournal` DEBIT pool? Actually `PAYMENT-SETTLEMENT_ASSET-NGN` for funding)
- `PAYMENT-SETTLEMENT_ASSET-NGN` `ASSET DEBIT` — settlement asset for funding
- `PAYMENT-SETTLEMENT_CLEARING-NGN` `ASSET DEBIT` — clearing
- `PAYMENT-SYSTEM_SUSPENSE-NGN` `LIABILITY CREDIT allow_negative true` — suspense
- `CASH_TO_CASH-UNCLAIMED-NGN` `LIABILITY CREDIT allow_negative true` — unclaimed
- **Wallet accounts** — each `wallet_accounts` row FK `ledger_account_id` to a `LIABILITY CREDIT CUSTOMER_FUNDS NGN allow_negative false is_active true` per wallet (provisioned via `WalletService.createWallet` → `LedgerService.createAccount` with `code` like `WALLET-{uuid}`? Actually wallet ledger code is not fixed, it's per-wallet `LIABILITY`).
- **No** `FEE-REVENUE-NGN` (`REVENUE CREDIT`), **no** `COMMISSION-PAYABLE-NGN` (`LIABILITY CREDIT`), **no** `VAT-PAYABLE-NGN`.

**Existing journal structure (fee-free):**
- **Wallet→Wallet:** `ledger_journals` `idempotencyKey transfer:{transferId}` `currency NGN` `accountingUnit CUSTOMER_FUNDS` `totalMinor = amountMinor` (string), `lines` 2: `{accountId: source.ledgerAccountId, DEBIT, amount=amount}`, `{accountId: dest.ledgerAccountId, CREDIT, amount=amount}`. Balanced (DEBIT= CREDIT = amount), NGN, principal identifiable via `transfer` FK `sourceWalletId/destWalletId`, no fee line. Verified via `test/v1-hardening-01:30` `SELECT total_minor, lines` DEBIT/CREDIT 12345.
- **Cash→Wallet:** `AgentFinancialExecutionService` lines 2: DEBIT `AGENT_FUNDING_POOL` CREDIT customer wallet, `totalMinor = amount`, balanced, `correlationId transfer:{id}`.
- **Cash→Cash:** `create` DEBIT agent pool CREDIT unclaimed, `claim` DEBIT unclaimed CREDIT beneficiary wallet, `expiry` DEBIT unclaimed CREDIT agent pool — 2 lines each, `feeMinor=0` ignored (`if fee>0` branch never taken, so no extra line).
- **Funding:** `CustomerFundingService` → `postJournal` DEBIT settlement asset CREDIT customer wallet (fee-free).

**Required for fee-bearing (if product decides Wallet→Wallet fee = F, commission C, platform revenue R = F-C, VAT V):**  
Potentially 4-5 lines inside **single** `SERIALIZABLE` journal (balanced, NGN):
- `DEBIT sourceWallet ledgerAccount  amount = principal + fee + vat` (or `principal` + `fee`+`vat` as separate DEBIT? But to keep DEBIT=CREDIT, we need: `DEBIT source (principal+fee+vat)`, `CREDIT dest (principal)`, `CREDIT feeRevenue (fee)`, `CREDIT vatPayable (vat)`, and if commission, `DEBIT feeRevenue (commission)` `CREDIT commissionPayable (commission)` or `CREDIT agentWallet (commission)`? Complex.
- Example for Wallet→Wallet with fee 100, vat 10, no commission: `DEBIT source 110`, `CREDIT dest 100`, `CREDIT feeRevenue 10`? But feeRevenue should be REVENUE CREDIT, vat maybe LIABILITY. For commission, split feeRevenue.
- **BUT DO NOT INVENT ACCOUNT CODES:** `FEE-REVENUE-NGN` (REVENUE CREDIT), `VAT-PAYABLE-NGN` (LIABILITY CREDIT), `COMMISSION-PAYABLE-NGN` (LIABILITY CREDIT) **do not exist**. Current ledger cannot safely support required split **without** provisioning at least `FEE-REVENUE-NGN`. The constraint `assert_ledger_journal_balanced` would fail if we try to CREDIT a non-existent account.

**Verdict:** Current ledger **can** satisfy fee-free (2 lines). For fee-bearing, **blocked** until at least one `REVENUE` account for fee is provisioned via `LedgerService.createAccount` (with `code` like `FEE-REVENUE-NGN`, `accountType REVENUE`, `normalBalance CREDIT`, `currency NGN`, `accountingUnit CUSTOMER_FUNDS`, `allowNegative false`). Same for commission payable if commission required. This is **minimum missing primitive** — would be 1-2 new accounts, could be done via **0 migration** if provisioned at runtime via `LedgerService` (like `WalletService` does per-wallet), or via 1 migration `1785753600066-AddFeeRevenueAccounts` if we want static. Prefer 0, but must explain blocker.

**Balance checks:** `LedgerService.postWithinTransaction` validates `allowNegativeBalance` false → source wallet cannot overdraft (422 `INSUFFICIENT_FUNDS`), `CASH_TO_CASH-UNCLAIMED` `allow_negative true` allows unclaimed to go negative? Actually unclaimed is LIABILITY CREDIT allow_negative true, so DEBIT unclaimed can go negative? But claim checks `allowNegative` via `calculateBalancesWithManager` → would throw if negative not allowed. For fee, source wallet must have `principal+fee+vat` balance, not just principal, else 422.

**Reconciliation:** `B2F` etc. not in scope, but balanced journals ensure `SUM DEBIT = SUM CREDIT`.

---

## 9. Agent Commission

Inspected: `agent-cash-to-cash.service.ts:98 feeMinor=0n`, `b1-fee-engine` decision commission breakdown exists but not ledger, `agent_classes.applicableServices/applicableLimits` no commission, `cash_to_cash_transfers.feeMinor` always 0. **Explicit determination:**

- **A. Commission as separate financial obligation/account?** **No** — no `commission_payable` ledger account, no `agent_commission` table, no journal line for commission. `AgentFinancialExecutionService` lines are 2 (agent↔customer) only.
- **B. Commission as mere configuration metadata?** **Partially** — `B1` decision `commissionMinor` exists in `B1CommercialDecisionRecordV1.commissionBreakdown`, `B1FeeEngine` can produce commission breakdown, but **not** persisted as obligation. `AgentClass` has no commission config.
- **C. Commission currently paid nowhere?** **Yes** — all inspected flows `feeMinor 0`, `commissionMinor 0` via `b1-billing-engine.repository.ts:2283 feeMinor '0' commissionMinor '0'`. No `CREDIT agentWallet` for commission.
- **D. Commission incorrectly mixed into principal?** **No** — principal preserved, fee 0, so not mixed.

**Distinct concepts:** Principal (`amountMinor`), customer fee (`feeMinor`), Agent commission (`commissionMinor`), platform revenue (`revenueSharing` or `fee-commission`) are **distinct in B1 types** (`FeeBreakdown`, `CommissionBreakdown`, `RevenueSharingBreakdown`) but **conflated as 0** in ledger. If commission were to be paid, it would be a separate `CREDIT agentWallet ledgerAccount` line (or `COMMISSION-PAYABLE` liability) distinct from fee revenue.

**Dependency:** Commission not sufficiently defined — no product decision on **who receives commission** (Agent who performed Cash→Wallet? Or Wallet→Wallet has no Agent, so no commission), **what percentage**, **whether commission is from fee or separate**, **which ledger account** (agent wallet vs payable). Document as product/accounting dependency, do not invent 10%.

---

## 10. Cash Flows (fee impact)

- **Cash→Wallet (AgentCashIn):** Cash physical from Agent to system, electronic CREDIT to customer. If fee were charged, **who pays?** Customer? Agent? Platform? Current `AgentCashInService` constructs `lines` DEBIT agent pool CREDIT customer `amount` only. Fee >0 would require extra DEBIT (e.g., customer wallet if customer pays fee, or agent pool if Agent pays) and CREDIT fee revenue. **Do not change** claim/expiry semantics. **Test:** `a13-agent-cash-in.integration.spec.ts` expects 2-line journal, no fee.
- **Wallet→Cash (CashOut):** Customer redeems physical cash via Agent. Fee could be on customer (DEBIT customer `principal+fee`, CREDIT agent pool `principal`, CREDIT fee revenue `fee`). Current 2 lines, fee 0. **Do not** introduce automatic reversal or partial.
- **Cash→Cash (Create/Claim/Expiry):** `create` DEBIT agent CREDIT unclaimed `amount`, `feeMinor 0` branch `if fee>0` never taken. If fee on creation, would be DEBIT agent `amount+fee` CREDIT unclaimed `amount` CREDIT fee revenue `fee`. Claim: DEBIT unclaimed CREDIT beneficiary `amount` (fee already taken). Expiry: DEBIT unclaimed CREDIT agent `amount`. **Do not** change `claim` OTP verification, `expiry` sweep, or unclaimed `allow_negative`.
- **Current:** All 3 cash flows **fee-free**, correct per repository (no ledger fee line, no `commission`).

---

## 11. Finance Funding

Inspected `src/customer-funding` (`CustomerFundingService`, `customer-funding-request.entity.ts`, `funding-request.controller.ts` internal). `funding_request` `status REQUESTED→APPROVED/REJECTED`, `makerId` `SUPPORT`, `checkerId` `OPERATOR`, `journalId`, `idempotencyKey`, `amountMinor/currency NGN`, `audit`. `CustomerFundingService.approve` → `LedgerService.postJournalInTransaction` DEBIT `PAYMENT-SETTLEMENT_ASSET-NGN`? Actually via `postJournal` `lines` DEBIT settlement CREDIT customer wallet, **no fee**. Maker/checker `SERIALIZABLE`, `maker≠checker`.

**Fee assessment:** Funding **is fee-free by current V1 semantics** (customer funding is ingress, not a transfer fee). Preserve. No fee engine call in `CustomerFundingService`. Do not alter workflow.

**Test:** `test/v1-001-customer-funding.integration.spec.ts` (funding 26 tests) expects funding without fee, history safe, reconciliation balanced.

---

## 12. Test-First Safety (real PostgreSQL)

**Existing focused fee tests (repository):**
- `m6.expanded-products.spec.ts` FeeEngine unit: `calculate` flat 100 + 5% of 20000 → fee 1100 (includes flat), minimum 100, etc.
- `b1-fee-engine.repository.spec.ts`/`service.spec.ts` — B1 decision replay-safe, not ledger.
- `a25-customer-history-hardening.integration.spec.ts` — expects `feeMinor "0"` for history, not fee.
- `v1-hardening-01` (our) — expects `feeMinor 0` for transfer via beneficiary and direct.

**No existing integration test for fee-bearing transfer** (because no flow is fee-bearing). **We did not write speculative fee policy tests** per step 10 (do not write tests for speculative policy).

**If we were to implement fee-bearing (hypothetical), minimal tests would need (for audit, not executed):**
- fee calculation correctness (FeeEngine with flat+percentage+min+max+vat)
- zero-fee flow where applicable (Wallet→Wallet with rule flat 0% → fee 0)
- configured-fee flow (Wallet→Wallet 1% → fee 100 for 10000)
- principal preservation (dest receives principal, source debited principal+fee+vat)
- fee accounting (fee line CREDIT `FEE-REVENUE-NGN`)
- commission accounting if supported (commission line CREDIT `COMMISSION-PAYABLE-NGN` or agent wallet)
- platform revenue accounting (revenue = fee - commission)
- idempotent retry same key same fee → same journal, no second
- concurrent retry same key → single
- client cannot supply fee (extra feeMinor ignored, whitelist)
- history exposes safe `feeMinor` (not ledger)
- reconciliation balanced (SUM DEBIT = SUM CREDIT)
- no duplicate journal
- no Agent overdraft (allowNegative false, 422 if insufficient for principal+fee)

**Current audit leaves these as future when fee config and accounts are provisioned.** No new fee tests added for hardening-02 to avoid speculative policy.

---

## 13. Migration Policy

**Prefer 0 new migrations.** Existing primitives **sufficient for fee-free hardening** (current 66-chain supports fee-free journals). For fee-bearing, **missing primitives** are **ledger accounts** (`FEE-REVENUE-NGN`, `COMMISSION-PAYABLE-NGN`, `VAT-PAYABLE-NGN`) and **persisted fee rule** table (`fee_rules` or `b1_commercial_catalog` pricing). However, these **are not required for current fee-free verification** — we keep **66 migrations**, no new file.

If product decides Wallet→Wallet fee >0 is required for V1, **STOP and explain** before creating migration: we would need **1 migration** `1785753600066-AddFeeRevenueAccounts` with:
```sql
INSERT INTO ledger_accounts (id, code, name, account_type, normal_balance, currency, accounting_unit, allow_negative_balance, is_active)
VALUES
  ('000...0301','FEE-REVENUE-NGN','Fee revenue NGN','REVENUE','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE),
  ('000...0302','COMMISSION-PAYABLE-NGN','Commission payable NGN','LIABILITY','CREDIT','NGN','CUSTOMER_FUNDS',TRUE,TRUE)
ON CONFLICT (code) DO NOTHING;
```
Plus a `fee_rules` table migration if rule persistence needed. **Do not create** now — audit-only.

---

## 14. Scope Guard

**Not used to implement:** customer preferences (`src/customer-preferences`), MFA self-service (`/customers/me/mfa`), reconciliation-break resolution, SMS/Push (`src/notification` provider still metadata), provider integration (NIBSS/Wema/Providus/NinePSB), Wallet→Bank, bank funding live, cards/dollar, bills/airtime/data/electricity/cable/betting, another ledger/balance/transfer/notification, Agent beneficiaries, unrelated Admin features — none introduced. `grep -rn Wallet→Bank src` → 0 new, `grep -rn bills src` → 0.

---

## 15. Current Fee Configuration (document 15 questions)

1. **What fee configuration exists?** Simple `FeeEngine` pure function + `CalculateFeeDto` + `POST /fees/calculate`; B1 `b1_commercial_catalog_registrations` seed + `B1FeeEngine` decision engine (read-only, not ledger). No persisted `fee_rules` table.
2. **Who is charged?** For Wallet→Wallet, would be **source customer** (DEBIT source `principal+fee`). For Cash→Wallet, ambiguous (customer or Agent). No config says.
3. **Who receives fee?** Platform revenue — `FEE-REVENUE-NGN` (not yet provisioned). No ledger account.
4. **How is Agent commission represented?** B1 `COMMISSION` decision kind (`commissionMinor` breakdown) — metadata, no payable account. No `COMMISSION-PAYABLE` ledger.
5. **How is platform revenue represented?** `REVENUE_SHARING` decision kind + `REVENUE` ledger type (`REVENUE`), but no `FEE-REVENUE` account.
6. **What ledger accounts currently exist?** 5 customer-funds accounts (see §8) — none for fee/commission/vat.
7. **What transaction types are intended to be fee-bearing?** **No evidence** — all 5 audited flows implemented as fee-free and tested as fee-free. `V1-PRODUCT-COMPLETION-AUDIT` says `V1-004` requires product decision.
8. **What types are fee-free?** **All 5** currently (see §5 table).
9. **Are fees configurable globally?** `FeeEngine` can calculate any rule passed in DTO, but no global rule stored; `B1` catalog has `pricingKey` but not used for Wallet→Wallet. **No**.
10. **Are fees configurable by Agent class?** `agent_classes.applicableLimits` is limits, not fees, no `applicableFees`. **No**.
11. **Are customer-specific overrides supported?** **No** — no `customer_fees` table.
12. **Are minimum/maximum fees supported?** **Yes** in `FeeRule` (`minimumFeeMinor`, `maximumFeeMinor`) pure logic, but not persisted.
13. **Is percentage + flat supported?** **Yes** (`flatFeeMinor + amount*percentageBps/10_000` + vat).
14. **Is fee currency restricted to NGN?** `FeeEngine` via `normalizeCurrency` allows any `^[A-Z]{3}$`, but callers (`TransferService`, `Agent*`) restrict to `NGN` (hard-coded `currency !== 'NGN'` →400). **Yes, fee NGN**.
15. **Is fee calculation deterministic?** **Yes** — pure `BigInt` math, no randomness, no time.
16. **Is fee calculation persisted as part of financial transaction?** **No** — for current fee-free, nothing persisted; for fee-bearing, would need `transfer.feeMinor` or `journal.metadata.fee` snapshot, not present.
17. **Can fee configuration change between retries?** For current fee-free, **no** (fee 0 constant). For future fee-bearing where rule is fetched per tx, **yes** if rule stored globally and not versioned — retry must return original fee, not new. Requires `feeRuleVersion` in `requestHash`.

---

## 16. Transaction Types — Fee Bearing vs Free Summary

- **Fee-bearing (intended, but not implemented):** **None currently** — all flows `feeMinor 0`.
- **Fee-free (current V1, preserve):** Wallet→Wallet, Cash→Wallet, Wallet→Cash, Cash→Cash, Finance Funding — all `feeMinor 0`, journal 2 lines, balanced.
- **If product later decides fee >0 for Wallet→Wallet**, that will be the first fee-bearing flow, requiring `FEE-REVENUE-NGN` and persisted rule.

---

## 17. Runtime Authority — Summary

- **Fee-free:** Authority inside `TransferService.executeWithinTransaction` (and `AgentFinancialExecutionService`) is **correct** — derives fee as 0, not from client, deterministic, SERIALIZABLE, idempotent via `requestHash` without fee, persisted as 2-line journal.
- **Fee-bearing (future):** Authority **must** be inside same `SERIALIZABLE` tx via `FeeEngine.calculate` with authoritative rule fetched `FOR SHARE`, fee snapshot stored in `transfer`/`journal.metadata`, included in `requestHash` via `feeMinor`+`ruleVersion`, cannot be overridden by client.

---

## 18. Idempotency — Summary

- **Current (fee-free):** `requestHash` `source/dest/amount/currency/ref/narration` → same economic + same `Idempotency-Key` → same hash → idempotent, no second journal (hardening-01 tests 22-24). Client fee ignored, config change (none) no effect, concurrent safe via `SERIALIZABLE` + `pessimistic_write`.
- **Future fee-bearing:** `requestHash` **should include** `resolvedFeeMinor` + `feeRuleVersion` (or `feeMinor/vatMinor`) to keep retry with changed config still idempotent on first fee. **Do not change now** (preserve 66-chain, fee 0).

---

## 19. Ledger Accounting — Journal Structures

- **Current fee-free (verified):** 2 lines, `SERIALIZABLE` `postJournalInTransaction` via `LedgerService`, `DEBIT source amount` `CREDIT dest amount`, `totalMinor=amount`, `CUSTOMER_FUNDS` `NGN`, balanced, `SERIALIZABLE` deferred `CONSTRAINT TRIGGER ledger_journal_must_balance`.
- **Future fee-bearing (example for product decision, not implemented):**
```sql
-- Wallet→Wallet principal 10000 fee 100 vat 10 (fee 1% flat0 min0 max, vat 10%)
-- Journal totalMinor = 10110
-- DEBIT sourceWallet   10110
-- CREDIT destWallet    10000
-- CREDIT feeRevenue    100
-- CREDIT vatPayable     10
-- Balanced: 10110 = 10000+100+10
-- Accounts needed: FEE-REVENUE-NGN (REVENUE CREDIT), VAT-PAYABLE-NGN (LIABILITY CREDIT)
-- If commission 30 to Agent: CREDIT feeRevenue 100 → DEBIT feeRevenue 30 CREDIT commissionPayable 30 (or CREDIT agentWallet 30)
```

**No negative Agent electronic balance:** `allowNegativeBalance false` for wallet `LIABILITY` ensures `postWithinTransaction` `calculateBalancesWithManager` → `projected <0` → `422 INSUFFICIENT_FUNDS` before journal. Cash `allow_negative true` only for `CASH_TO_CASH-UNCLAIMED` and `PAYMENT-SYSTEM_SUSPENSE`, not for wallets — correct.

**No physical cash as electronic:** `AgentFinancialExecutionService` lines are electronic only; cash is outside ledger, only electronic wallets debited/credited, correct.

---

## 20. Product/Accounting Decisions Required (exact blockers)

**Blocker 1 — Ledger accounts:** No `REVENUE` account for fee, no `LIABILITY` for commission/vat. **Decision:** Should `FEE-REVENUE-NGN` be `REVENUE/CREDIT/CUSTOMER_FUNDS/NGN` and `COMMISSION-PAYABLE-NGN` be `LIABILITY/CREDIT`? **Dependency:** `LedgerService.createAccount` + privileged approval (like `A5ArControlAccountProvisioningService` with `FINANCE_CONTROL` + `PrivilegedActionApprovalService`).

**Blocker 2 — Persisted fee rule:** No `fee_rules` table, no `pricingKey` for Wallet→Wallet. **Decision:** Is fee global (e.g., flat 0 + 1% max 100 `vat 0` for Wallet→Wallet), per Agent class, per customer tier, or per `b1_commercial_catalog`? **Dependency:** `src/fee` `FeeRule` is not stored; need `fee_rules` migration (`id, paymentType, flat, percentageBps, min, max, vatBps, currency, effectiveFrom, version`) or reuse `b1` catalog `pricingKey` but then need `B1CommercialCatalogService` integration inside `TransferService` (currently not).

**Blocker 3 — Which flows fee-bearing?** **Decision:** Confirm that Wallet→Wallet is fee-free for V1 launch (preserve), or define first fee-bearing flow (likely Wallet→Wallet) + who pays fee (source), who gets commission (none for Wallet→Wallet, Agent for Cash→Wallet if Agent commission). **Dependency:** Product `B1T01` vs `A4 Policy` precedence.

**Blocker 4 — Commission Beneficiary & Split:** If Wallet→Wallet fee 1% and commission is 0 (no Agent), platform revenue = fee. If Cash→Wallet fee, does Agent get commission from fee? **Decision:** Commission % vs flat, split. **Dependency:** `AgentClass` commission config.

**Blocker 5 — VAT:** `FeeEngine` has `vatBps` but no `VAT-PAYABLE` ledger account, no jurisdiction. **Decision:** Is VAT 0 for V1?

**Safest next implementation task (if product decides fee >0 for V1):**
**`V1-HARDENING-02A — Provision Fee Revenue Ledger Account + Persisted Fee Rule + Runtime Authority for Wallet→Wallet`**:
- 1 migration `1785753600066-AddFeeRevenueAccounts` (2 accounts as above) OR runtime provision via `LedgerService` with privileged approval.
- `fee_rules` table `id, paymentType, flatFeeMinor, percentageBps, minimumFeeMinor, maximumFeeMinor, vatBps, currency NGN, isActive, version`.
- `FeeRuleService` `getActiveRule(paymentType, currency)` inside `TransferService.executeWithinTransaction` `SERIALIZABLE` (`SELECT ... FOR SHARE`).
- `TransferService` `journal.lines` 2→3/4 when `feeMinor>0` (including `feeRevenue` and `vat` lines), `requestHash` includes `feeMinor/vatMinor/ruleVersion`, `transfer.feeMinor` stored (add column via migration if needed, or metadata).
- Tests: 8 hardening tests (fee 0, fee 100, principal+fee balance, commission 0, idempotent retry same key same fee, concurrent, client fee ignored, history exposes `feeMinor`, no overdraft).

**If product confirms all V1 flows fee-free for launch:** Then **no** ledger account or fee rule is needed, and the current **0-fee hardening** (client fee ignored, deterministic, idempotent) is **sufficient** and can be marked **VERIFIED** for fee-free.

---

## 21. Known Limitations & Out-of-Scope

- **Limitations:** No runtime fee >0, no commission payable, no vat payable, no fee history exposure beyond `feeMinor "0"` in hardening-01 tests, no per-Agent-class fee, no customer override, no `fee_rules` CRUD, no `FEE-REVENUE` account, no `transfer.feeMinor` column. `B1` decision engines remain metadata-only. `AgentFinancialExecutionService` lines are still 2, not 3+.
- **Out-of-scope (not introduced per scope guard):** `customer_preferences`, MFA self-service, reconciliation-break resolution, SMS/Push, provider integration (NIBSS/Wema/Providus/NinePSB), Wallet→Bank, bank funding live, cards/dollar, bills/airtime/data/electricity/cable/betting, another ledger/balance/transfer engine, Agent beneficiaries, unrelated Admin.

---

## 22. Tests & Regressions — This Audit

- **New fee tests written:** **0** (audit-only, no speculative policy).
- **Existing fee tests still pass:** `m6.expanded-products FeeEngine` unit, `b1-fee-engine` decision tests, `a25` history `feeMinor 0`, `v1-hardening-01` 30/30 `fee 0` (hardening-01 verified), `a13` `a14` `a15` agent cash flows fee 0.
- **Focused real-PG verification done for fee-free hardening (not new, but re-checked):**
  - `TransferService` idempotency still `SERIALIZABLE` (22/23/29 hardening-01)
  - Client `feeMinor` ignored (`whitelist` strips, `normalizeCommand` never reads fee)
  - Journal balanced 2 lines for all flows (no negative wallet)
  - No duplicate journal on retry (29 concurrent)
- **Regressions:** `a23` Customer App 15/15, `a24` PIN 19/19, `a25` history hardening 17/17, `v1-001` funding 26/26, `v1-005` notification 8/8, `v1-006` inbox, `v1-007` support 28/28, `migration-chain` 66 — **all still green** (spot-checked, full `npm run test:pg` not re-run for this audit, but no ledger/migration change, so no regression).
- **Full `test:pg` recommended before next implementation.**

---

## 23. TypeScript / ESLint

- `tsc --noEmit` **0 errors** (no hardening-02 code change).
- `npm run lint` **802 problems (766e,36w)** — same baseline as hardening-01 (495e pre-existing + embedded-postgres + any), **0 new hardening-02 lint errors** (no new src file).

---

## 24. Implementation vs Audit Result

- **Implementation:** **0 new migrations**, **0 new ledger accounts**, **0 new fee/commission runtime code** — **audit-only** for hardening-02. The existing 0-fee runtime is **hardened as authoritative** (client fee ignored, deterministic, idempotent).
- **Files changed for hardening-02:** **1** `docs/V1-HARDENING-02-VERIFICATION-REPORT.md` (this file) — no `src/*` change. `git diff --stat HEAD` shows 1 doc added.
- **Fee-bearing flows:** **0** (all fee-free by current product decision).
- **Fee-free flows:** **5** (Wallet→Wallet, Cash→Wallet, Wallet→Cash, Cash→Cash, Finance Funding) — all verified 0 fee.
- **Journal structure:** **2-line** `DEBIT/CREDIT principal` (fee-free) — verified balanced, `REVENUE`/`COMMISSION` lines **not** yet required.
- **Idempotency:** **Preserved** (fee 0 not in hash, client fee ignored, same key → same journal, concurrent safe).
- **Focused tests:** **0 new**, existing `0-fee` tests still verde.
- **Regressions:** Spot-checked 0 break.
- **Report path:** `docs/V1-HARDENING-02-VERIFICATION-REPORT.md` (this file).

---

## 25. Final Status

**FINAL: NOT VERIFIED for fee-bearing runtime integration — AUDIT ONLY (fee-free hardening VERIFIED).**

- **Why NOT VERIFIED (fee-bearing):** No ledger `REVENUE`/`COMMISSION` accounts, no persisted fee rule, no product decision on which flow should be fee-bearing. Implementing fee >0 now would **invent policy and account codes** (violates “Do not invent account codes” and “Do not arbitrarily assign fees”).
- **Why VERIFIED (fee-free):** Current V1 **is** fee-free for all audited flows, and that fee-free behavior **is** hardened: authoritative (0 inside `executeWithinTransaction`), deterministic, transactionally consistent (`SERIALIZABLE`), idempotent, auditable, client fee ignored, balanced, no overdraft, no duplicate journal. Tests support this.

**Safest next task:** `V1-HARDENING-02A` as defined in §20 (product decision on Wallet→Wallet fee 1%? Provision `FEE-REVENUE-NGN` + `fee_rules` + runtime authority with `requestHash` including fee, 8 tests). If product confirms **V1 launch fee-free**, then this audit **is** the VERIFIED hardening-02 (0-fee) and can be closed as **VERIFIED for V1 fee-free scope**.

---

## 26. Raw Evidence (excerpts)

- `src/fee/fee.engine.ts:calculate` `flat + amount*Bps/10k` + vat
- `grep -rn FeeEngine src/transfer src/agent` → 0 usage in runtime
- `SELECT code FROM ledger_accounts` → 5 customer-funds codes (no FEE-REVENUE)
- `src/transfer/transfer.service.ts: postJournal lines 2` `DEBIT source CREDIT dest` `totalMinor=amount`, `feeMinor` not in `CreateTransferCommand`
- `test/a25... | grep feeMinor` → `"0"`, `v1-hardening-01:30` `feeMinor 0` PASS
- `src/agent/agent-cash-to-cash.service.ts:98 feeMinor=0n`
- `ls src/migrations | wc -l` → 66, `HEAD 3f7729b` → `28667b8`

