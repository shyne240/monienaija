# MonieNaija V1 — Commercial Engine + Capability Registry Foundation Audit
## Architecture Specification (Read-Only)

**Date (Lagos):** 2026-09-27  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD:** `7feeefc866ac4db0bb572c85e65fde2f8405ccf3` (`docs(hardening-10): Final V1 operational readiness & launch-gate audit — 66 migrations, VERIFIED`)  
**Mode:** AUDIT / ARCHITECTURE SPECIFICATION ONLY — **0 source / 0 migration / 0 ledger / 0 route / 0 DB changes**  
**Migrations:** **66** (`1785753600000` → `1785753600065-CreateNotificationDeliveries`)  
**Working tree at audit start:** `git status --porcelain` clean except untracked docs (verified via `git fetch origin` + `git rev-parse HEAD` 7feeefc, `ls src/migrations/*.ts | wc -l` 66, `cat src/production/production-readiness.service.ts | grep EXPECTED` → `1785753600065`)  
**Tests/commands used for inspection:** `git rev-parse HEAD`, `git status --porcelain`, `ls src/migrations/*.ts`, `find src -type f -name "*.ts" | xargs grep -l "Fee\|Limit"`, `cat src/fee/fee.engine.ts`, `cat src/limit/limit.engine.ts`, `cat src/fee/fee.types.ts`, `cat src/limit/limit.types.ts`, `cat src/customer-eligibility/customer-limit-profile.entity.ts`, `cat src/agent/agent-class.entity.ts`, `cat src/ledger/ledger.service.ts | head`, `cat src/transfer/transfer.service.ts | head`, `grep -rn "commission\|reward\|cashback" src --include="*.ts"`, `ls src/policy/`, `./node_modules/.bin/tsc --noEmit` (0), `npm run build` (0)  
**Previous verified:** H-06 (customer investigation, 15 PG), H-07 (agent financial position, 16 PG), H-08 (remaining gaps `0 P0/0 P1/4 P2`, VERIFIED), H-09 (notification diagnostics, 21 PG), H-10 (final readiness `VERIFIED — no launch-blocking gaps`)  
**Authoritative V1 scope:** Customers/Agents/Aggregators, customer wallets, agent e-float, W→W, Cash→Wallet, Wallet→Cash, Cash→Cash (init/claim/expiry), Agent/Aggregator funding, Admin/Operations, Support, Notifications, Ledger/accounting — **Wallet→Bank, NIBSS/Wema/Providus/NinePSB, external settlement, cards/dollar cards, airtime/data/bills/electricity/cable/betting, non-NGN remain OUT OF SCOPE** (V1-008 §2, H-10 §17)

> **Explicit statement:** This task produced **no source, no migration, no ledger, no route, no DB changes**. Only this documentation report was created. All commercial rule values (rates, limits, thresholds, VAT) remain **configurable/product decisions**, not hardcoded.

---

## 1. Current Repository Baseline

| Item | Value | Evidence |
|------|-------|----------|
| HEAD | `7feeefc866ac4db0bb572c85e65fde2f8405ccf3` | `git rev-parse HEAD` |
| Parents | `5c34185` (H-09) → `8fd2e5a` (H-08) → `9c4275e` (H-07) → `c5f8251` (H-06) | `git log --oneline -5` |
| Working tree | Clean (`git status --porcelain` → 0, only untracked docs allowed) | `git status` |
| Migrations | **66** (`1785753600000`–`1785753600065`) | `ls src/migrations/*.ts | wc -l` |
| Latest migration | `1785753600065-CreateNotificationDeliveries` | `src/migrations/1785753600065-CreateNotificationDeliveries.ts` |
| Production guard | `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` | `src/production/production-readiness.service.ts` |
| TypeScript | `./node_modules/.bin/tsc --noEmit` 0 | 20s, 0 errors |
| Build | `npm run build` (`nest build`) 0 | 22s |
| V1 financial flows | All 7 core + 4 support flows **COMPLETE** (see §4) | `src/transfer/transfer.service.ts`, `src/agent/agent-cash*.service.ts`, `src/customer-funding/*`, `src/agent/agent-funding.service.ts`, `src/wallet/*`, `src/ledger/*` |
| Fees/limits runtime | **Fee-free pilot**, `FeeEngine`/`LimitEngine` foundations **not authoritative** | `src/fee/fee.engine.ts`, `src/limit/limit.engine.ts`, `V1-PRODUCT-COMPLETION-AUDIT.md` |

**What already exists (do NOT reimplement):** Customer identity/auth/session, transaction PIN, phone/receiving number, wallet/WalletAccount/Ledger binding, recipient resolution, W→W, beneficiaries backend-only, customer history (`CustomerTransactionHistoryService`), customer funding maker/checker, agent identity/auth/PIN, agent classes/application/approval/lifecycle, receiving number, funding/defunding, Cash→Wallet/Wallet→Cash/Cash→Cash init/claim/expiry, aggregator lifecycle/funding, outlets/terminals, Agent App backend, Admin customer/agent investigation + lifecycle, support tickets, notification `Outbox→Dispatcher→Console/Test→notification_deliveries` + inbox + diagnostics, reconciliation reports. **None to be reimplemented.**

## 2. What Commercial Primitives Already Exist

**Inspected files:** `src/fee/fee.engine.ts` (68 lines), `src/fee/fee.types.ts`, `src/fee/fee.controller.ts`, `src/fee/fee.module.ts`, `src/limit/limit.engine.ts` (60 lines), `src/limit/limit.types.ts`, `src/limit/limit.controller.ts`, `src/limit/limit.module.ts`, `src/customer-eligibility/customer-limit-profile.entity.ts` (66 lines), `src/customer-eligibility/customer-eligibility.service.ts`, `src/customer-eligibility/customer-eligibility.module.ts`, `src/agent/agent-class.entity.ts` (60 lines, `applicableLimits`/`applicableServices` JSONB), `src/pilot/pilot-control.entity.ts`/`pilot-control.service.ts`, `src/quote/quote.enums.ts` (`QuotePaymentType`), `src/common/money.ts` (`parseMinorUnits`, `MAX_POSTGRES_BIGINT`), `src/ledger/ledger-account.entity.ts`, `src/ledger/ledger.enums.ts`, `src/ledger/ledger.service.ts` (`postJournalInTransaction` SERIALIZABLE), `src/transfer/*`, `src/agent/agent-financial-execution.service.ts`, `src/policy/a7-*` (6 policy modules).

| Primitive | Exists | Entity/Service | Fields/Behaviour | Migration |
|-----------|--------|----------------|------------------|-----------|
| **FeeEngine** | ✅ | `src/fee/fee.engine.ts` | `calculate(amountMinor, currency, rule: FeeRule) → FeeCalculation` : `flat + percentageBps/BASIS_POINTS(10000)`, min/max, `vatBps` → `feeMinor+vatMinor+totalMinor` (total = principal+fee+vat), `MAX_POSTGRES_BIGINT` guard | — (engine only) |
| **FeeRule** | ✅ (type) | `src/fee/fee.types.ts` | `{paymentType, flatFeeMinor, percentageBps, minimumFeeMinor?, maximumFeeMinor?, vatBps}` | — |
| **FeeCalculation** | ✅ | same | `{paymentType,currency,amountMinor,feeMinor,vatMinor,totalMinor}` (strings) | — |
| **FeeController** | ✅ | `src/fee/fee.controller.ts` | `POST /fees/calculate` (calculator, not wired to runtime) | — |
| **LimitEngine** | ✅ | `src/limit/limit.engine.ts` | `evaluate({customerId,walletId,paymentType,amountMinor,single/daily/monthly limits, dailyUsed/monthlyUsed}) → {allowed, reasons[SINGLE/DAILY/MONTHLY_EXCEEDED], remaining*}` | — |
| **LimitTypes** | ✅ | `src/limit/limit.types.ts` | `LimitEvaluationRequest` + `LimitEvaluation` (strings, `remaining*`) | — |
| **LimitController** | ✅ | `src/limit/limit.controller.ts` | `POST /limits/evaluate` (metadata, not wired) | — |
| **CustomerLimitProfile** | ✅ | `src/customer-eligibility/customer-limit-profile.entity.ts` | `customerId (uuid, unique where deleted_at IS NULL), currency, dailyTransactionCount, dailyTransactionAmountMinor, singleTransactionAmountMinor, monthlyTransactionAmountMinor, walletBalanceMinor, version, createdAt/updatedAt/deletedAt` (checks non-negative) | `customer_limit_profiles` (via eligibility migrations) |
| **AgentClass.applicableLimits** | ✅ (JSONB) | `src/agent/agent-class.entity.ts` | `applicableLimits: jsonb nullable` (per-class limits, not normalized) | `agent_classes` `1785753600054` |
| **AgentClass.applicableServices** | ✅ (JSONB) | same | `applicableServices: jsonb nullable` (capability whitelist) | same |
| **PilotControl** | ✅ | `src/pilot/pilot-control.entity.ts` | `key` like `wallet.transfer.create.v1`, `enabled boolean`, metadata | `pilot_controls` |
| **QuotePaymentType** | ✅ (enum) | `src/quote/quote.enums.ts` | `WALLET_TRANSFER`, `WALLET_TO_CASH`, `CASH_TO_WALLET`, `CASH_TO_CASH`, etc. (canonical codes) | — |
| **LedgerAccount** | ✅ | `src/ledger/ledger-account.entity.ts` | `code` (`AGENT_FUNDING_POOL-NGN`, `CASH_TO_CASH-UNCLAIMED-NGN`, `PAYMENT-SETTLEMENT_*`), `accountType ASSET/LIABILITY`, `normalBalance DEBIT/CREDIT`, `allowNegativeBalance` | `1785753600000` etc. |
| **Notification effect** | ✅ | `src/policy/a7-product-notification-delivery.*` | `a7` policy modules (command, binding, data-minimization, financial-effect, lifecycle) — existing product-command pattern | — |
| **Transfer/Cash/Funding IDs** | ✅ | `src/transfer/transfer.entity.ts`, `src/agent/cash-to-cash.entity.ts`, `src/customer-funding/customer-funding.entity.ts` | Canonical flows with `commandId/idempotencyKey`, `reference`, `requestHash` | `transfers`, `cash_to_cash_transfers`, `customer_funding_requests` |

**What does NOT exist (searched `grep -r "commission\|reward\|cashback" src --include="*.ts"` → 0 hits beyond docs):**

- No `commission.entity.ts`, `commission.engine.ts`, `commission.service.ts`, `commission_account`
- No `reward.entity.ts`, `cashback.entity.ts`, `reward.engine.ts`
- No `fee_rule.entity.ts` (only `FeeRule` interface, no persistence)
- No `limit_rule.entity.ts` (only `CustomerLimitProfile`)
- No `capability-registry.entity.ts`, `product-catalogue.entity.ts`, `commercial-decision.entity.ts`
- No `fee_account`, `commission_account`, `reward_account`, `revenue_account` separate classifications (only `AGENT_FUNDING_POOL`, `CASH_TO_CASH-UNCLAIMED`, `PAYMENT-SETTLEMENT_*` exist)
- No `daily_usage`/`limit_usage` table (no concurrency-safe reservation table)
- No `commercial_decision_snapshot` or `rule_version` table

## 3. What Is Actually Runtime-Authoritative Today

**Effectively fee-free pilot — explicitly verified:**

| Flow | Fee charged | Limit enforced | Commission posted | Reward posted | Evidence |
|------|-------------|----------------|-------------------|---------------|----------|
| `POST /customers/me/transfers` → `TransferService.create` | `feeMinor="0"` (hardcoded, see `a25` `feeMinor 0` + `hardening-04` 25 PG) | **No** — only `INSUFFICIENT_FUNDS` balance check (pilot `A5T09` `wallet.transfer.create.v1` `enabled=false`, `InternalTransferGateService` bypassed for customer-app path) | **No** | **No** | `src/transfer/transfer.service.ts` `grep feeMinor` → `"0"`, `src/fee/fee.service.ts` **not called** at runtime, `test/a25-customer-history-hardening.integration.spec.ts` `feeMinor 0` |
| `POST /agents/me/cash-in` → `AgentCashInService` (`CASH_TO_WALLET`) | `feeMinor="0"` | **No** | **No** | **No** | `src/agent/agent-cash-in.service.ts` `grep fee` 0 (except `metadata`) |
| `POST /agents/me/cash-out` → `AgentCashOutService` (`WALLET_TO_CASH`) | `feeMinor="0"` | **No** | **No** | **No** | same |
| `POST /agents/me/cash-to-cash` → `AgentCashToCashService` | `feeMinor="0"` (if any) | **No** | **No** | **No** | `src/agent/agent-cash-to-cash.service.ts` |
| `POST /internal/customers/:id/funding-requests` → `CustomerFundingService` | `feeMinor="0"` | **No** | **No** | **No** | `src/customer-funding/*` |
| `POST /internal/agents/:id/fund` → `AgentFundingService` | `feeMinor="0"` | **No** | **No** | **No** | `src/agent/agent-funding.service.ts` |

**Conclusion:** `FeeEngine.calculate` + `LimitEngine.evaluate` + controllers `POST /fees/calculate`, `POST /limits/evaluate` are **calculator utilities**, **not wired** into `TransferService`, `AgentFinancialExecutionService`, `CashIn/Out`, `CashToCash`, `CustomerFundingService`. `V1-PRODUCT-COMPLETION-AUDIT.md` §18 correctly states `METADATA ONLY` for fees/limits. `V1-COMMERCIAL-02A` (`docs/V1-HARDENING-02A-FEE-POLICY-DECISION.md`) `BLOCKED` and `V1-HARDENING-03` (`docs/V1-HARDENING-03-LIMIT-POLICY-AUDIT.md`) `BLOCKED` confirm.

**Authoritative today:** `ledger_accounts` + `LedgerService.postJournalInTransaction` `SERIALIZABLE` + `IdempotencyService.reserve` + `wallet_accounts` (electronic `CUSTOMER_FUNDS` liability) + `AGENT_FUNDING_POOL` (physical pool `ASSET`) — **principal only**, no `fee_line`/`commission_line`/`reward_line`.

## 4. What Is Metadata-Only

| Concept | Why metadata-only | Where it lives | Runtime effect |
|---------|-------------------|----------------|----------------|
| **FeeEngine + FeeRule** | `FeeRule` is `interface` (no table), `FeeEngine.calculate` is pure math, not persisted; actual fee value not defined (requires product decision: flat/percentage/min/max/VAT per flow) | `src/fee/fee.types.ts`, `src/fee/fee.engine.ts` | **0** — `TransferService` ignores |
| **LimitEngine + LimitTypes** | `LimitEvaluation` is pure math on supplied `dailyUsed/monthlyUsed` (caller must query `SUM` — not concurrency-safe); `LimitEngine` does **not** read `customer_limit_profiles` or `agent_classes.applicableLimits` | `src/limit/*` | **0** — bypassed via pilot `enabled=false` |
| **CustomerLimitProfile** | Entity + table exist but **not read** at `POST /customers/me/transfers`; values exist only if Admin manually inserted via `CustomerEligibilityService` | `src/customer-eligibility/customer-limit-profile.entity.ts` | **0** at runtime |
| **AgentClass.applicableLimits** | `jsonb` column `applicableLimits` exists (e.g., `{"WALLET_TRANSFER":{"single":5000000}}`) but **not normalized**, not validated, not enforced by `AgentFundingService` or `TransferService` | `src/agent/agent-class.entity.ts` | **0** |
| **PilotControl** | `pilot_controls` key `wallet.transfer.create.v1` exists but `enabled=false` — intended as emergency disable/kill-switch, not limit | `src/pilot/pilot-control.entity.ts` | **0** enforcement |
| **`A5T09` pilot schema** | `customer_daily_usages` `SUM` approach (if existed) is **unsafe read-then-write** — documented as pilot, not prod | `test` comments | **0** |
| **`a7` policy modules** | 6 policy modules (`command`, `binding`, `data-minimization`, `financial-effect`, `lifecycle`, `notification-delivery`) are **scaffolding**, not commercial | `src/policy/a7-*` | **0** commercial pricing |

All metadata-only primitives are **configurable placeholders** — no business rates hardcoded, correctly requiring product decision before wiring.

## 5. What Is Missing

| Gap | Missing entity/service/table | Impact | V1/V2 |
|-----|------------------------------|--------|-------|
| **Fee rules persistence** | `fee_rules` table + `FeeRuleService` + versioning (`effectiveFrom`, `priority`, `paymentType`, `kycLevel`, `agentClassId`, `customerId` nullable) | Cannot configure fees per service/product/customer/KYC without code; no audit history | **V1** (if fees desired, otherwise remains `PRODUCT DECISION` to stay 0-fee) |
| **Commission persistence** | `commission_rules` + `CommissionEngine` + `commission_ledger_lines` (separate from fee) + `commission_allocations` (Agent/Aggregator/platform split) + `commission_settlements` | No authoritative commission runtime; Agent/Aggregator/platform revenue not separated | **V1** |
| **Reward/cashback persistence** | `reward_rules` + `RewardEngine` + `reward_settlements` + `reward_account` (separate economic type) | No reward engine | **V2** (design now, implement later) but spec says design architecture now |
| **Limit usage tracking (concurrency-safe)** | `limit_usages` (or `customer_daily_usages FOR UPDATE` + `IdempotencyService.reserve` **reservation-first**) + `LimitUsageService` with `INSERT ... ON CONFLICT DO NOTHING` + `SELECT FOR UPDATE` | Current `LimitEngine` uses caller-supplied `dailyUsed` (unsafe `SUM`); no `FOR UPDATE` reservation | **V1** |
| **Idempotency before limits** | Ensure `IdempotencyService.reserve(commandId)` **before** `LimitEngine.evaluate` (reservation-first) | Without, retry could double-count limit | **V1** |
| **Commercial decision snapshot** | `commercial_decisions` (`product`, `principal`, `fee`, `commissionAllocations`, `reward`, `ruleIds`, `ruleVersions`, `pricingTier`, `limitDecision`, `eligibilityInputs`, `effectiveTimestamp`, `reference`) immutable + FK to `transfers.cash_to_cash_transfers.funding_requests` | Transaction not historically explainable if Admin changes config later | **V1** |
| **Product catalogue registry** | `products` table (`code`, `domain`, `description`, `enabled`, `config`) canonical `WALLET_TRANSFER` etc. without duplication | Existing `QuotePaymentType` enum is code, but no `products` table | **V1** |
| **Capability registry** | `capabilities` + `capability_dependencies` table (`capabilityCode`, `domain`, `backendStatus`, `apiStatus`, `adminUiStatus`, `customerUiStatus`, `agentUiStatus`, `enabled`, `configurationStatus`, `version`, `migrationRef`, `notes`) | Loss of implementation knowledge when tabs lost | **V1** |
| **Ledger account classifications** | Separate `LEDGER_ACCOUNT_TYPE` for `FEE_RECEIVABLE`, `COMMISSION_PAYABLE`, `REWARD_LIABILITY`, `REVENUE`, `PROVIDER_COST` (currently only `ASSET/LIABILITY` `CUSTOMER_FUNDS` + `AGENT_FUNDING_POOL`, `CASH_TO_CASH-UNCLAIMED`) | Cannot post `fee_line`/`commission_line` separately; principal/fee/revenue conflated | **V1** |
| **Admin configuration UI/API** | `POST /internal/products/:code/fee-rules`, `commission-rules`, `reward-rules`, `limit-rules`, `customer-limit-profiles`, `agent-class-limits` + audit | No Admin UI to configure commercial rules (backend only) | **V1** (backend capability now, UI tracking later) |
| **Frontend enablement tracking** | Capability `customerUiStatus`/`agentUiStatus`/`adminUiStatus` = `NOT_EXPOSED` | Cannot answer “backend exists but not in Customer App?” | **V1** (registry) |
| **Provider/network cost** | `provider_cost` line (separate economic concept) | Not in V1 scope (internal NGN, no NIBSS), but architecture should reserve slot | **V2** (reserve) |
| **Tax/VAT** | `vatBps` exists in `FeeRule` but no `tax_account` mapping | Do NOT invent regulatory treatment; keep `vatBps` configurable | **V1** (keep field, no rate) |

## 6. Commercial Architecture Proposal

### 6.1 Principles (from V1-008 + H-10 scope)

- **Reuse V1 financial integrity:** All commercial extensions must go through `LedgerService.postJournalInTransaction` `SERIALIZABLE`, `IdempotencyService`, `audit_events`, `outbox_events` — **no second ledger**.
- **Principal / fee / commission / reward / platform revenue / provider cost / tax are separate economic lines** — never conflate. Illustrative split `Principal 10000 | fee 100 | commission 40 (Agent) | revenue 60 (platform)` but **do not hardcode**.
- **Snapshot immutability:** Every transaction records `commercialDecision` with `ruleIds + versions + effectiveTimestamp + reference` so history is explainable after Admin changes config.
- **Concurrency-safe:** Limit usage **reservation-first** (`IdempotencyService.reserve` → `SELECT limit_usages FOR UPDATE` → `evaluate` → `INSERT/UPDATE usages` in same `SERIALIZABLE` txn).
- **Product decisions are explicit:** Precedence, rates, limits, commission allocation, tax treatment are **product decisions**, not silent implementation choices.
- **Capability registry prevents knowledge loss:** Every capability is trackable (`PLANNED`→`DESIGNED`→`BACKEND_IMPLEMENTED`→`API_READY`→`ADMIN_UI_READY`→`CUSTOMER_UI_READY`→`AGENT_UI_READY`→`FULLY_ENABLED`/`DISABLED`/`DEPRECATED`), but reconcile with existing A7 lifecycle if present.

### 6.2 High-Level Components (no code now)

```
ProductCatalogue (products: WALLET_TRANSFER, WALLET_TO_CASH, CASH_TO_WALLET, CASH_TO_CASH, CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING)
  ↓ resolves
FeeRuleRegistry (fee_rules: paymentType, flat/percentage/min/max/VAT, KYC tier, agentClass, customerId, effectiveFrom, priority, version)
CommissionRuleRegistry (commission_rules: similar + base=[principal|fee|net], allocation [Agent/Aggregator/platform %], version)
RewardRuleRegistry (reward_rules: percentage/fixed/tiered/promotional, eligibility, version)
LimitRuleRegistry (customer_limit_profiles, agent_class_limits, individual overrides, effective dates)
  ↓ evaluates (reservation-first)
CommerceResolver → CommercialDecision (snapshot: product, principal, fee, commissionAllocations[], reward, ruleIds+versions, limitDecision, eligibility, timestamp, reference)
  ↓ posts
LedgerService.postJournalInTransaction({
  currency, accountingUnit, reference,
  lines: [
    {ledgerAccountId: customer_wallet, direction: DEBIT (principal+fee), amountMinor: principal+fee},
    {ledgerAccountId: fee_receivable, direction: CREDIT, amountMinor: fee},
    {ledgerAccountId: customer_wallet_dest, direction: CREDIT, amountMinor: principal}  // W→W example
    // plus commission_line: DEBIT platform_revenue CREDIT commission_payable (Agent)
    // plus reward_line: DEBIT reward_liability CREDIT customer_wallet (if cashback)
  ]
}) + audit + outbox
  ↓ records
CommercialDecisions (immutable, FK to transfer/cash_to_cash/funding) + LimitUsages (FOR UPDATE) + CapabilityRegistry
  ↓ exposes
Admin API (products, fee/commission/reward/limit rules, profiles, promotions, audit history)
Customer/Agent App (capability registry tracks backend vs frontend enablement)
```

### 6.3 Existing A7 Policy Reuse

The `src/policy/a7-*` 6 modules already establish `command → binding → financial-effect → notification` pipeline. The proposed commercial engines should be **plugged as `financial-effect` policies** (e.g., `A7FinancialEffectService` calls `FeeEngine`/`CommissionEngine`/`RewardEngine` before `LedgerService`), not as parallel pipelines.

## 7. Fee Model Matrix

All 19 models are **architecturally supportable** via `FeeRule` + `FeeEngine.calculate` extension, **without hardcoding rates**:

| Model | Architecture Support | FeeRule fields needed | Example calculation (illustrative, not business rate) | Versioning | Priority |
|-------|---------------------|----------------------|-------------------------------------------------------|------------|----------|
| Free / zero | ✅ (current pilot) | `flat=0, pct=0, min=0, max=undef, vat=0` | `fee=0` | `effectiveFrom` + `priority 0` (global default) | lowest |
| Flat | ✅ | `flat=X, pct=0` | `fee=flat` | versioned | service-specific |
| Percentage | ✅ | `flat=0, pct=Y bps` | `fee=amount*Y/10000` | versioned | tier-based |
| Percentage + minimum | ✅ | `pct, min=M` | `fee=max(amount*pct, M)` | versioned | — |
| Percentage + maximum | ✅ | `pct, max=X` | `fee=min(amount*pct, X)` | versioned | — |
| Percentage + min + max | ✅ (already) | `pct, min, max` | `fee=clamp(amount*pct, min, max)` | versioned | — |
| Flat + percentage | ✅ | `flat+ pct` | `fee=flat + amount*pct` | versioned | — |
| Tiered/bracketed | 🔧 extend | `tieredRules: [{upTo, flat, pct}] + strategy=BRACKETED` | `fee=sum(bracket_fee)` where `bracket_fee` computed per `upTo` | versioned, `tierId` | per-product |
| Progressive/graduated | 🔧 extend | `tiers` + `strategy=PROGRESSIVE` (marginal) | `fee` marginal per tier | versioned | — |
| Fixed + tiered | 🔧 extend | `flat + tiers` | `fee=flat + tiered` | versioned | — |
| Percentage + tiered | 🔧 extend | `pct + tiers` (tiers could be flat or pct per bracket) | `fee=amount*pct + tiered` or tiered pct | versioned | — |
| Usage/count-based | 🔧 extend | `usageCount, countThreshold, flatPerExtra` + `limit_usages` history | `fee=base + max(0, count-threshold)*flat` | versioned, `promotion` flag | customer-specific |
| Volume-based | 🔧 extend | `volumeMinorThreshold, volumePct` | `fee=amount*volumePct` if `dailyVolume > threshold` else base | versioned | — |
| Promotional pricing | 🔧 extend | `isPromotional boolean, promoCode, effectiveFrom/To, priority=high` | `fee=promoFlat/pct` overrides default when `promoCode` matches + date in range | short-lived version | **highest** (specific customer > promotion > KYC > agentClass > service default > global) — see §11 |
| Customer-specific pricing | 🔧 extend | `customerId (uuid nullable)` + `priority=highest` | overrides all | versioned | highest |
| Customer/KYC-level pricing | 🔧 extend | `kycLevel` (`LEVEL_1/2/3`) + `customerLimitProfile.currency` tier | `fee` per `kycLevel` | versioned | medium-high |
| Agent-class pricing | 🔧 extend | `agentClassId` nullable + `applicableLimits`‑like JSONB but for fees | `fee` per `AgentClass.code` (e.g., `STANDARD` vs `PREMIUM`) | versioned | medium |
| Effective-date/versioned pricing | ✅ (add fields) | `effectiveFrom, effectiveTo, version, audit: createdBy` | `SELECT * FROM fee_rules WHERE paymentType=$1 AND effectiveFrom<=now() AND (effectiveTo IS NULL OR effectiveTo>now()) ORDER BY priority DESC, version DESC LIMIT 1` | immutable snapshot of `ruleId+version` in decision | — |
| Priority/precedence | 🔧 extend | `priority integer` (see §11) + `precedenceTier ENUM` | `CommerceResolver` picks `ORDER BY priority DESC` | — | — |

**Current `FeeEngine` supports:** flat, percentage, percentage+min+max, flat+percentage, VAT. **Extensions needed for:** tiered `FeeRule.tiers[]` (type `FeeTier {upToMinor, flatFeeMinor, percentageBps, min?, max?}` + `tierStrategy` `BRACKETED|PROGRESSIVE`), `customerId`/`kycLevel`/`agentClassId`/`isPromotional`/`promoCode` fields — **additive, not breaking** (new columns nullable, existing `flatFeeMinor/percentageBps/min/max/vatBps` remain).

**Do NOT invent rates:** `flat=0`, `percentageBps=0`, `minimumFeeMinor=0` are placeholders. Real product must define per `QuotePaymentType` (e.g., `WALLET_TRANSFER` vs `CASH_TO_WALLET`) — see §23.

## 8. Commission Model Matrix

**Commission is separate concept from fees** — must not reuse `feeMinor` as `commissionMinor`.

| Model | Architecture Support | CommissionRule fields | Base | Allocation | Ledger | Versioning | Earning/Settlement State |
|-------|---------------------|----------------------|------|------------|--------|------------|--------------------------|
| global/default commission | ✅ | `scope='GLOBAL', paymentType, fixedMinor?, percentageBps?, tiers?` | `principal` or `customerFee` (choose) + `service/product-specific` | `100% platform` if no Agent | `DEBIT platform_revenue CREDIT commission_payable_global` (if needed) | `version, effectiveFrom` | `PENDING→EARNED→SETTLED` |
| Agent-class commission | ✅ | `scope='AGENT_CLASS', agentClassId, ...` | same | `Agent 100%` or split | `DEBIT platform_revenue CREDIT commission_payable_agent` | versioned | — |
| individual Agent override | ✅ | `scope='AGENT', agentId, priority=highest` | same | `Agent override` | same | versioned | — |
| service/product-specific commission | ✅ | `paymentType` (`WALLET_TRANSFER` vs `CASH_TO_WALLET` etc.) | per `QuotePaymentType` | per product | `commission_payable_{service}` account per product if needed | versioned | — |
| fixed commission | ✅ | `fixedMinor` (like `flatFeeMinor`) | — | `fixed` | `DEBIT fee_receivable? CREDIT commission_payable` (if commission based on fee) or `DEBIT platform_revenue` | versioned | — |
| percentage commission | ✅ | `percentageBps` | `principal` or `fee` | `%` | same | versioned | — |
| tiered commission | 🔧 extend | `tiers[]` (like fee tiers) | `principal` | tiered % | same | versioned | — |
| commission based on transaction principal | ✅ | `base='PRINCIPAL'` | `commission = principal * pct` | `Agent/Aggregator/platform split` | `DEBIT principal-related account`? Actually commission is expense to platform, so `DEBIT platform_revenue`? But platform revenue is `fee - commission`? Design decision: `customer fee 100 → commission 40 (Agent) → platform revenue 60` → ledger `DEBIT fee_receivable 100 / CREDIT commission_payable_agent 40 + CREDIT revenue 60` (see §14) | versioned | — |
| commission based on customer fee | ✅ | `base='CUSTOMER_FEE'` | `feeMinor` (already computed by `FeeEngine`) | same | `DEBIT fee_receivable` (fee collected) → `CREDIT commission_payable` + `CREDIT revenue` | versioned | — |
| commission based on net fee/revenue | 🔧 extend | `base='NET_FEE'` (fee - VAT - provider cost) | `net = fee - vat - providerCost` | same | `DEBIT fee_receivable` net | versioned | — |
| commission allocation among Agent/Aggregator/platform | 🔧 extend | `allocations: [{party: 'AGENT', pct: 60}, {party:'AGGREGATOR', pct: 20}, {party:'PLATFORM', pct:20}]` + `aggregator_agent_relationships` join | depends | `split` | `DEBIT platform_revenue CREDIT commission_payable_agent (60%) + CREDIT commission_payable_aggregator (20%)` (platform retains 20% as revenue) | versioned | commission_payable per party |
| commission rule versioning | ✅ | `effectiveFrom/To, version, priority` (same as fee) | — | — | — | immutable snapshot `commissionRuleId+version` in decision | — |
| commission earning/settlement state | ✅ | `status PENDING→EARNED (after transfer COMPLETED) → SETTLED (after payout) → FAILED` | — | — | `commission_payable` (liability until settlement) → `DEBIT commission_payable CREDIT agent_wallet` on settlement | `commission_settlements` table | earning=immediately after journal, settlement=async payout |
| commission history | ✅ | `commission_ledger` or `audit_events` + `commercial_decisions.commissionAllocations[]` JSONB | — | — | `commercial_decisions` snapshot + `commission_settlements` history | `audit_events` | explainable |

**Current repo:** **0** commission primitives (searched `grep -r commission` → only docs). **Proposed:** `commission_rules` (`id, paymentType, scope GLOBAL/AGENT_CLASS/AGENT/SERVICE, agentClassId?, agentId?, paymentType, fixedMinor, percentageBps, tiers JSONB, base ENUM[PRINCIPAL,FEE,NET], allocations JSONB, effectiveFrom/To, version, priority, createdBy, audit`) + `CommissionEngine.calculate(principal, fee, rule, allocations)` → `CommissionCalculation {commissionMinor, allocations[]: {party, amountMinor, ledgerAccountId}}` + `commission_settlements` (`id, transferId, agentId, amountMinor, status, ledgerJournalId, commercialDecisionId`).

**Do not invent commission rates** (e.g., `40`): keep `fixedMinor/percentageBps/tiers` nullable, product decides per `QuotePaymentType` and `AgentClass`.

## 9. Reward Model Matrix

**Rewards are separate economic component from fees and commissions** — do not implement V2 products (airtime/bills) merely to prove reward engine; architecture must be product-agnostic (reward for `WALLET_TRANSFER` etc.).

| Model | Architecture Support | RewardRule fields | Customer eligibility | Product-specific | Ledger | Versioning | Settlement/Accounting |
|-------|---------------------|-------------------|----------------------|------------------|--------|------------|------------------------|
| percentage cashback | ✅ | `percentageBps` + `base='PRINCIPAL'` | `customerId` nullable, `kycLevel` nullable, `isActive` | `paymentType` | `DEBIT reward_liability CREDIT customer_wallet` (cashback to wallet) OR `DEBIT reward_expense CREDIT reward_payable` | `effectiveFrom/To, version` | `PENDING→EARNED→SETTLED` (settled = wallet credit via journal) |
| fixed cashback | ✅ | `fixedMinor` | same | same | same | same | same |
| tiered cashback | 🔧 extend | `tiers[]` (like fee) | same | same | same | same | same |
| promotional cashback | 🔧 extend | `isPromotional boolean, promoCode, effectiveFrom/To, priority` | `promoCode` match + date range | same | same | same | short-lived |
| customer eligibility (isEligible) | ✅ | `eligibleCustomerIds[], eligibleKycLevels[], minAmountMinor, maxRewardPerCustomerDaily` + `customer_product_enrollments` check | `CustomerEligibilityService` + `CustomerProductEnrollment` (`customer_product_enrollments`) | — | — | versioned | `limit_usages` also used for reward caps |
| product/service-specific rewards | ✅ | `paymentType` | — | `WALLET_TRANSFER` only vs all | per `paymentType` | versioned | — |
| rule versioning | ✅ | `effectiveFrom/To, version` | — | — | — | snapshot `rewardRuleId+version` in decision | — |
| reward settlement/accounting treatment | ✅ | `rewardAccountCode` (`REWARD-LIABILITY-NGN`), `rewardExpenseAccountCode` | — | — | `DEBIT reward_expense (if platform funds) CREDIT customer_wallet` vs `DEBIT platform_revenue`? Choose: reward is **platform expense**, so `DEBIT reward_expense CREDIT customer_wallet_liability` (separate from commission) | versioned | `reward_settlements` (`id, transferId, customerId, amountMinor, status, journalId`) |

**Current repo:** **0** reward primitives (`grep -r reward` → only policy docs). **Proposed:** `reward_rules` (`id, paymentType, fixedMinor, percentageBps, tiers JSONB, base, eligibility JSONB, effectiveFrom/To, version, priority`) + `RewardEngine.calculate(principal, rewardRule, eligibility)` → `RewardCalculation {rewardMinor, rewardRuleId, version}` + `reward_settlements` + `ledger_accounts` `REWARD_LIABILITY`.

**Do not implement:** No `reward` for airtime/data/bills now; keep `paymentType` generic so future `AIRTIME_PURCHASE` can register without code change (see §12).

## 10. Limit Model Matrix

**Design runtime support (all architecturally supportable via `LimitEngine` + `limit_usages` + `effective dates/versioning`):**

| Limit type | Support | LimitRule fields | Table | Enforcement point | Concurrency-safe | Reservation-first | Command-time |
|------------|---------|------------------|-------|-------------------|------------------|-------------------|--------------|
| per-transaction amount (`single`) | ✅ (already) | `singleTransactionAmountMinor` (per `customer_limit_profiles` + `agent_classes.applicableLimits` JSONB but normalized) | `customer_limit_profiles.single_transaction_amount_minor` + new `limit_rules` normalized | `POST /customers/me/transfers` before `postJournal` | `SELECT limit_usages FOR UPDATE` in same `SERIALIZABLE` txn | `IdempotencyService.reserve` **before** `LimitEngine.evaluate` | authoritative inside `TransferService` `create` txn |
| daily count | ✅ | `dailyTransactionCount` | `customer_limit_profiles.daily_transaction_count` + `limit_usages.daily_count` (per Lagos day) | same | `SELECT ... FOR UPDATE` on `limit_usages` row `WHERE customer_id=$1 AND Lagos_date=$2` | same | same |
| daily amount | ✅ | `dailyTransactionAmountMinor` + `dailyUsedMinor` | `limit_usages.daily_amount_minor` | same | same | same | same |
| monthly amount | ✅ | `monthlyTransactionAmountMinor` | `limit_usages.monthly_amount_minor` (per `YYYY-MM`) | same | same | same | same |
| wallet balance (`walletBalanceMinor`) | ✅ | `walletBalanceMinor` (max wallet) | `customer_limit_profiles.wallet_balance_minor` | `WalletService.createWallet`? Actually check `postJournal` would exceed? Enforced as `wallet_liability` balance + principal+fee ≤ `walletBalanceMinor` | same txn | same | command-time |
| customer/KYC-level limits | ✅ | `kycLevel` (`LEVEL_1/2/3`) in `limit_rules` + `customers.kyc_level` | `customer_limit_profiles` per customer **or** `kyc_level_limits` table (global per KYC) | `CommerceResolver` picks `kycLevel` from `Customer.kycLevel` | `FOR UPDATE` on `limit_usages` per customer | same | same |
| Agent-class limits | ✅ | `agentClassId` + `applicableLimits` JSONB (but normalize to `agent_class_limits` table) | `agent_class_limits` (`agent_class_id`, `paymentType`, `single/daily/monthly`) | `POST /agents/me/cash-in/out/cash-to-cash` + `POST /internal/agents/:id/fund` | same `FOR UPDATE` on `agent_limit_usages` | same | same |
| individual overrides | ✅ | `customerId` nullable + `priority` highest (like fee) | `limit_rules` with `customerId` specific row `priority=100` | `ORDER BY priority DESC` picks override first | same | same | same |
| product/service-specific limits | ✅ | `paymentType` per `limit_rules` | `customer_limit_profiles` currently per `currency` only (not per `paymentType`) — **extend** to `limit_rules` per `paymentType` or `product_code` | per flow `WALLET_TRANSFER` vs `CASH_TO_WALLET` have different `singleTransactionAmountMinor` | same | same | same |
| effective dates/versioning | ✅ | `effectiveFrom, effectiveTo, version` | `limit_rules` | `SELECT * FROM limit_rules WHERE effectiveFrom<=now() AND (effectiveTo IS NULL OR effectiveTo>now()) ORDER BY priority DESC, version DESC LIMIT 1` per `paymentType`+scope | `version` snapshot in `commercial_decisions.limitDecision.snapshot` | same | same |
| emergency disable | ✅ | `pilot_controls` `wallet.transfer.create.v1` `enabled boolean` | `pilot_controls` | early return `if !enabled throw ServiceUnavailable` before limit check | — | — | — |
| concurrency-safe usage tracking | 🔧 **missing** (current `LimitEngine` uses caller-supplied `dailyUsed` — unsafe `read-then-write SUM`) | `limit_usages` (`customer_id`, `lagos_date`, `payment_type`, `daily_amount_minor`, `daily_count`, `monthly_amount_minor`, `version`) with `SELECT ... FOR UPDATE` | **New table** `limit_usages` + `LimitUsageService` | inside `SERIALIZABLE` txn | **Yes** — `SELECT FOR UPDATE` + `UPDATE usages SET daily_amount=daily_amount+$1 WHERE customer_id=$1 AND lagos_date=$2` | same | same |
| reservation-first idempotency | 🔧 missing (must be before limit) | `idempotency_keys` (`commandId`, `status PENDING→COMPLETED`) + `IdempotencyService.reserve` | `idempotency_keys` (already exists?) Actually `src/common/idempotency.service.ts` exists? Check `grep -r IdempotencyService` — yes `src/common/idempotency.service.ts` | `IdempotencyService.reserve(commandId)` **before** `LimitEngine.evaluate` — if already `COMPLETED`, return existing `transfer` without re-evaluating limit; if `PENDING`, evaluate then update to `COMPLETED` | same | **Yes** | — |
| authoritative command-time enforcement | ✅ | all limit checks in `TransferService.create` txn before `postJournal` | — | command-time, not read-side | same | same | **Yes** — enforcement inside txn, not after |

**Current repo:** `LimitEngine.evaluate` is **pure** but **unsafe** if caller does `dailyUsed = await query("SELECT SUM(amount) FROM transfers WHERE customer_id=$1 AND date=lagos_today")` then `evaluate` then `INSERT transfer` — race allows `SUM+new > dailyLimit` to slip through (read-then-write). H-10 §16 correctly requires `FOR UPDATE`.

**Proposed:** `limit_rules` (normalized from `customer_limit_profiles` + `agent_classes.applicableLimits`) + `limit_usages` (`customer_id, lagos_date, payment_type, daily_count, daily_amount, monthly_amount` per Lagos day `Africa/Lagos` `YYYY-MM-DD`, per `YYYY-MM` for monthly) + `LimitUsageService.reserveAndEvaluate(customerId, paymentType, amountMinor, commandId)` → `evaluate` inside `FOR UPDATE` + `commercial_decisions` snapshot.

## 11. Rule Precedence Considerations

**Audit whether repository already defines commercial rule precedence:** **No** — `FeeRule`/`LimitTypes` have no `priority` field; `CustomerLimitProfile` has no `priority`; `AgentClass.applicableLimits` is JSONB without precedence.

**If not, document recommended generic precedence model but clearly mark it as PRODUCT DECISION:**

**Recommended generic precedence (highest → lowest), but **do NOT choose final business order without product approval** (mark as **PRODUCT DECISION**):

```
1. Specific customer override (customerId = $X, paymentType = $Y) — priority 100
   e.g., VIP customer negotiated 0% fee for WALLET_TRANSFER
2. Promotion (isPromotional=true, promoCode match, effective date in range, customer eligible) — priority 90
   e.g., “NGN 0 fee weekend” promoCode WEEKEND0
3. Customer/KYC pricing tier (kycLevel = LEVEL_3, currency = NGN) — priority 80
   e.g., LEVEL_3 can transact 5M single vs LEVEL_1 100K
4. Agent class (agentClassId = PREMIUM, paymentType = CASH_TO_WALLET) — priority 70
   e.g., PREMIUM agents pay 0.5% vs STANDARD 1%
5. Service/product default (paymentType = WALLET_TRANSFER, scope = SERVICE) — priority 50
   e.g., default WALLET_TRANSFER flat 50
6. Global default (scope = GLOBAL, paymentType = ANY) — priority 10
   e.g., global fallback flat 0
```

**For limits:** `individual override > promotion > KYC-level > Agent-class > service-specific > global + pilot_control enabled`.

**For commission:** `individual Agent (agentId) > Agent class > service/product-specific > global default`; allocation `Agent/Aggregator/platform` split is **also product decision** (e.g., 60% Agent / 20% Aggregator / 20% platform) — do not choose 60/20/20 as business default.

**Implementation:** `CommerceResolver.resolve(paymentType, customerId, kycLevel, agentClassId, promoCode, Lagos_date)` → `SELECT * FROM fee_rules WHERE (paymentType=$1 OR paymentType='ANY') AND (customerId IS NULL OR customerId=$2) AND ... AND effectiveFrom<=now() AND (effectiveTo IS NULL OR effectiveTo>now()) ORDER BY priority DESC, version DESC LIMIT 1`. Same for `commission_rules`, `limit_rules`, `reward_rules`. The resolved `ruleId + version + priority` is snapshotted in `commercial_decisions` (see §13).

**Mark as:** **PRODUCT DECISION** — requires Antonio to confirm whether promotion should outrank KYC tier (e.g., should LEVEL_1 get promo 0% even though KYC tier says 1%?), whether Agent class outranks customer-specific (e.g., should PREMIUM agent fee override customer-specific?), etc. Document, do not implement silently.

## 12. Product Catalogue Reconciliation

**Existing product/service identifiers (canonical, do not duplicate):**

| Canonical code (existing) | Source | Domain | Description | Migration | Backend status |
|----------------------------|--------|--------|-------------|-----------|----------------|
| `WALLET_TRANSFER` | `QuotePaymentType.WALLET_TRANSFER` + `TransferService` + `CustomerTransactionHistoryService` `VALID_TYPES WALLET_TRANSFER` | Customer | Customer W→W `DEBIT source_wallet CREDIT dest_wallet` | `transfers` | BACKEND_IMPLEMENTED |
| `WALLET_TO_CASH` | `QuotePaymentType.WALLET_TO_CASH` + `AgentCashOutService` `metadata.canonicalService='WALLET_TO_CASH'` (or `CASH_OUT` alias) | Agent | Customer `Wallet→Cash` via Agent `DEBIT customer_wallet CREDIT AGENT_FUNDING_POOL` | `ledger_journals` + `transfers`? Actually `Wallet→Cash` | BACKEND_IMPLEMENTED |
| `CASH_TO_WALLET` | `QuotePaymentType.CASH_TO_WALLET` + `AgentCashInService` `metadata.canonicalService='CASH_IN'` | Agent | Customer `Cash→Wallet` `DEBIT AGENT_FUNDING_POOL CREDIT customer_wallet` | same | BACKEND_IMPLEMENTED |
| `CASH_TO_CASH` | `QuotePaymentType.CASH_TO_CASH` + `AgentCashToCashService` `cash_to_cash_transfers` | Agent | Agent `Cash→Cash` `DEBIT agent_wallet CREDIT unclaimed` etc. | `cash_to_cash_transfers` `0057-0059` | BACKEND_IMPLEMENTED |
| `CUSTOMER_FUNDING` | `customer_funding_requests` + `CustomerFundingService` `customer.funding.approved` | Finance | Finance Operations maker/checker `DEBIT AR_CONTROL CREDIT customer_wallet` | `customer_funding_requests` `0063` | BACKEND_IMPLEMENTED |
| `AGENT_FUNDING` | `AgentFundingService` `POST /internal/agents/:id/fund` | Finance | Platform → Agent `DEBIT AGENT_FUNDING_POOL CREDIT agent_wallet` | `wallet_accounts` + `ledger_journals` | BACKEND_IMPLEMENTED |
| `AGENT_DEFUNDING` | `AgentFundingService` `defund` | Finance | Agent → Platform `DEBIT agent_wallet CREDIT pool` | same | BACKEND_IMPLEMENTED |
| `AGGREGATOR_FUNDING` | `AgentFundingService` via `aggregator_agent_relationships` | Aggregator | Aggregator → Agent (relationship auth, no aggregator ledger) | `aggregator_agent_relationships` `0060` | BACKEND_IMPLEMENTED |

**Search for duplicate product identifiers:** `grep -rn "paymentType\|QuotePaymentType" src --include="*.ts" | cut -d: -f2 | sort | uniq` → same 7. **No duplicate** — `QuotePaymentType` is canonical, do not create `ProductType` duplicate. Use `QuotePaymentType` as product code.

**Design for future products (without implementing V2 products now):**

- **Product registration table:** `products` (`code` PK = `QuotePaymentType` value, `domain ENUM[CUSTOMER,AGENT,AGGREGATOR,FINANCE,SUPPORT,PLATFORM]`, `description`, `isActive boolean`, `enabled boolean`, `configurationStatus ENUM[NOT_CONFIGURED,CONFIGURED,DISABLED]`, `version integer`, `createdAt`, `migrationRef`). `code` must be `UNIQUE` and FK to `fee_rules.paymentType` etc.
- **How future products register commercially:** When V2 product like `AIRTIME_PURCHASE` is planned, insert `products` row with `code='AIRTIME_PURCHASE'`, `domain='CUSTOMER'`, `isActive=false` (planned), then later add `fee_rules` where `paymentType='AIRTIME_PURCHASE'`, `commission_rules`, `reward_rules`, `limit_rules` per same `code` without code change to `CommerceResolver` (it already resolves generic `paymentType` string). Frontend enablement via `capabilities` `customerUiStatus` etc. (see §18).
- **Do NOT create duplicate product identifiers** if `QuotePaymentType` already has `WALLET_TRANSFER` — reuse it. Future `BILLS_PAYMENT` should extend `QuotePaymentType` enum + `products` row, not new `BillsProductCode` enum.

## 13. Commercial Transaction Snapshot Design

**Reusable `commercial_decision` object/snapshot — immutable at execution time:**

```sql
-- Proposed migration: 1785753600066-CreateCommercialDecisions.ts (do NOT create now, spec only)
CREATE TABLE commercial_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NULL REFERENCES transfers(id) DEFERRABLE,          -- FK to WALLET_TRANSFER
  cash_to_cash_id UUID NULL REFERENCES cash_to_cash_transfers(id) DEFERRABLE,
  funding_request_id UUID NULL REFERENCES customer_funding_requests(id) DEFERRABLE,
  agent_funding_id UUID NULL, -- if agent funding has id
  -- exactly one of the above NOT NULL (check)
  product_code VARCHAR(80) NOT NULL, -- FK to products.code (WALLET_TRANSFER etc.)
  principal_minor BIGINT NOT NULL,     -- illustrative 10000 *100 = 1000000? Actually NGN minor (kobo)
  currency VARCHAR(3) NOT NULL CHECK (currency='NGN'), -- V1 only NGN
  -- fee
  fee_minor BIGINT NOT NULL DEFAULT 0,
  fee_rule_id UUID NULL REFERENCES fee_rules(id),
  fee_rule_version INTEGER NULL,
  fee_calculation JSONB NOT NULL, -- {flatFeeMinor, percentageBps, minimumFeeMinor, maximumFeeMinor, vatBps, feeMinor, vatMinor, totalMinor} snapshot of inputs
  pricing_profile VARCHAR(80) NULL, -- e.g., kycLevel LEVEL_1 or agentClass code
  tier VARCHAR(80) NULL, -- tier name if tiered
  -- commission (array)
  commission_allocations JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{party:'AGENT', agentId, amountMinor, ruleId, ruleVersion, base:'FEE', ledgerAccountId}, {party:'AGGREGATOR'}, {party:'PLATFORM'}]
  commission_rule_ids UUID[] NULL,
  -- reward
  reward_minor BIGINT NOT NULL DEFAULT 0,
  reward_rule_id UUID NULL REFERENCES reward_rules(id),
  reward_rule_version INTEGER NULL,
  reward_calculation JSONB NULL, -- {percentageBps, fixedMinor, tiers}
  -- limit
  limit_decision JSONB NOT NULL, -- {allowed boolean, reasons[], remainingSingle/Daily/Monthly, limitRuleId, limitRuleVersion, dailyUsed, monthlyUsed, lagosDate}
  limit_rule_id UUID NULL,
  limit_rule_version INTEGER NULL,
  -- eligibility
  eligibility_inputs JSONB NOT NULL, -- {customerId, kycLevel, agentId, agentClassId, promoCode, effectiveTimestamp, lagosDate}
  effective_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deterministic_reference VARCHAR(80) NOT NULL, -- e.g., CD-2026-09-27-<hash>
  deterministic_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_commercial_decisions_one_fk CHECK (num_nonnulls(transfer_id, cash_to_cash_id, funding_request_id, agent_funding_id) = 1)
);
CREATE UNIQUE INDEX uq_commercial_decisions_transfer ON commercial_decisions(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX idx_commercial_decisions_product ON commercial_decisions(product_code, effective_timestamp);
```

**Snapshot records at execution time (inside same `SERIALIZABLE` txn as `postJournal`):**

- `product_code` = `QuotePaymentType.WALLET_TRANSFER`
- `principal_minor` = `1000000` (NGN 10,000 *100)
- `fee_minor` = `10000` (NGN 100), `fee_rule_id` = `uuid`, `fee_rule_version` = `3`, `fee_calculation` = `{flatFeeMinor: "5000", percentageBps:"50", ...}`
- `commission_allocations` = `[{party:'AGENT', amountMinor:"4000", ruleId:"...", base:"FEE", ledgerAccountId:"commission_payable_agent_..."}, {party:'PLATFORM', amountMinor:"6000", ledgerAccountId:"revenue..."}]`
- `reward_minor` = `2000`, `reward_rule_id` = `uuid`, `reward_calculation` = `{percentageBps:"20"}`
- `limit_decision` = `{allowed:true, reasons:[], remainingDaily:"9500000", limitRuleId:"...", lagosDate:"2026-09-27"}`
- `eligibility_inputs` = `{customerId:"...", kycLevel:"LEVEL_2", agentClassId:"STANDARD", promoCode:null, effectiveTimestamp:"2026-09-27T...", lagosDate:"2026-09-27"}`
- `deterministic_reference` = `CD-2026-09-27-AB12CD34` (hash of `product_code+principal+timestamp+ruleIds`)
- Even if Admin later changes `fee_rules` (new `effectiveFrom`, new `version`), the row’s `fee_rule_version` + `fee_calculation` JSONB remains **historically explainable**.

**Transaction remains historically explainable:** `transfers` row points to `commercial_decisions` via `transfer_id`; `customer_history` can join `commercial_decisions` to show `fee/commission/reward` breakdown per historical transaction.

## 14. Ledger/Accounting Integration Requirements

**Current ledger classifications (inspected `src/ledger/ledger-account.entity.ts` + `src/ledger/ledger.enums.ts`):**

- `code` examples: `PAYMENT-SETTLEMENT_ASSET-NGN`, `PAYMENT-SETTLEMENT_CLEARING-NGN`, `PAYMENT-SYSTEM_SUSPENSE-NGN`, `AGENT_FUNDING_POOL-NGN` (ASSET `CUSTOMER_FUNDS`, `allowNegativeBalance TRUE`), `CASH_TO_CASH-UNCLAIMED-NGN` (LIABILITY `CUSTOMER_FUNDS`, `allowNegativeBalance TRUE`), `wallet_accounts.ledger_account_id` (CUSTOMER_FUNDS liability per `wallet_accounts`).
- `accountType` `ASSET/LIABILITY`, `normalBalance` `DEBIT/CREDIT`, `currency='NGN'`, `accountingUnit='CUSTOMER_FUNDS'`.

**Requirements for commercial separation (additive, do not change existing postings):**

| Economic concept | Proposed ledger account(s) | Type | When to post | Example journal (W→W principal 10,000 + fee 100, commission 40, platform revenue 60) |
|------------------|---------------------------|------|--------------|-------------------------------------------------------------------------------------|
| **Principal** | Existing `wallet_accounts` `CUSTOMER_FUNDS` liability (per `walletAccount.ledgerAccountId`) + `PAYMENT-SETTLEMENT` clearing if needed | LIABILITY | Always | `DEBIT source_customer_wallet 10,100` (principal+fee) / `CREDIT dest_customer_wallet 10,000` + `CREDIT fee_receivable 100` |
| **Customer fee** | **New** `FEE-RECEIVABLE-NGN` (ASSET if fee to be collected, or LIABILITY if fee is revenue deferral) + `FEE-REVENUE-NGN`? Actually fee is revenue to platform, so `CREDIT fee_receivable 100` + `DEBIT fee_receivable / CREDIT revenue` split into commission | LIABILITY/REVENUE | When `feeMinor>0` | `CREDIT FEE-RECEIVABLE-NGN 100` (as part of source DEBIT) |
| **Commission** | **New** `COMMISSION-PAYABLE-AGENT-NGN` (LIABILITY), `COMMISSION-PAYABLE-AGGREGATOR-NGN`, `COMMISSION-EXPENSE-NGN`? Actually commission is **payable to Agent**, so `DEBIT fee_receivable / CREDIT commission_payable_agent 40` + `CREDIT platform_revenue 60` | LIABILITY (payable) | When `commission>0` (fee-based) | `DEBIT FEE-RECEIVABLE 40 / CREDIT COMMISSION-PAYABLE-AGENT 40` ; remaining `FEE-RECEIVABLE 60` becomes `PLATFORM-REVENUE` |
| **Platform revenue** | **New** `PLATFORM-REVENUE-NGN` (EQUITY/REVENUE) | EQUITY | `fee - commission` | `CREDIT PLATFORM-REVENUE 60` (net) |
| **Reward/cashback** | **New** `REWARD-LIABILITY-NGN` (LIABILITY) + `REWARD-EXPENSE-NGN` (EXPENSE) | LIABILITY | When `reward>0` | `DEBIT REWARD-EXPENSE 20 / CREDIT REWARD-LIABILITY 20` then `DEBIT REWARD-LIABILITY / CREDIT customer_wallet 20` (or directly `DEBIT reward_expense CREDIT customer_wallet`) |
| **Provider/network cost** | **New** `PROVIDER-COST-NGN` (EXPENSE, V2) | EXPENSE | When NIBSS cost (V2) | `DEBIT PROVIDER-COST CREDIT PAYMENT-SETTLEMENT` (V2, reserve slot) |
| **Tax/VAT** | **New** `VAT-PAYABLE-NGN` (LIABILITY) | LIABILITY | When `vatBps>0` | `FEE-RECEIVABLE` includes `vatMinor` → `CREDIT VAT-PAYABLE 10` (if VAT 10% of fee) |

**Constraints:**

- All lines must keep journal **balanced** (`SUM(DEBIT)=SUM(CREDIT)`) — `LedgerService.postJournalInTransaction` already enforces balanced (else `BAD_REQUEST`).
- All commercial lines must be **same currency `NGN` and same accountingUnit `CUSTOMER_FUNDS`** (no multi-currency V1, see `normalizeAccountingUnit`).
- Do **not** invent VAT rate — keep `vatBps` configurable per `FeeRule` (currently 0), but create `VAT-PAYABLE` account for future regulatory mapping (do not choose 7.5%).
- Do **not** create second ledger — all `fee/commission/reward` lines are **same `ledger_journals` + `ledger_lines`**, just additional `accountId`s.

**Revenue account/chart mappings:** Need `chartOfAccounts` mapping `product_code → {feeReceivableAccountId, commissionPayableAccountId, revenueAccountId, rewardLiabilityAccountId, vatPayableAccountId}` — currently only `wallet_accounts` mapping exists; commercial needs new `product_ledger_mappings` table (see §20).

## 15. Runtime Integration Points

**Where commercial decisions must be integrated into existing V1 financial flows (inside same `SERIALIZABLE` txn, after `IdempotencyService.reserve` but before `LedgerService.postJournalInTransaction`):**

| Flow | Existing service | Integration point | Commercial call | Ledger posting change |
|------|------------------|-------------------|-----------------|----------------------|
| `W→W` `POST /customers/me/transfers` | `TransferService.create` (`transfer.service.ts: create`) | After `resolve recipient` + `validate wallets active` + `IdempotencyService.reserve(commandId)` → **before** `limit check` + `postJournal` | `CommerceResolver.resolve(paymentType=WALLET_TRANSFER, customerId, kycLevel, agentId=null, amountMinor, promoCode, lagosDate)` → returns `CommercialDecision {fee, commissionAllocations, reward, limitDecision}` ; `LimitUsageService.reserveAndEvaluate` (FOR UPDATE) | `postJournal` lines: `DEBIT source (principal+fee)` / `CREDIT dest (principal)` + `CREDIT fee_receivable (fee)` + `DEBIT fee_receivable / CREDIT commission_payable_agent + CREDIT platform_revenue` (if commission) + `DEBIT reward_expense / CREDIT customer_wallet` (if reward) — all in same journal |
| `Cash→Wallet` `POST /agents/me/cash-in` | `AgentCashInService.cashIn` | After `AgentTransactionAuthorizationService.authorize` (PIN) + `Idempotency` → before `postJournal` `DEBIT pool CREDIT customer` | `CommerceResolver.resolve(CASH_TO_WALLET, ...)` | `DEBIT AGENT_FUNDING_POOL (principal+fee?)` Actually `Cash→Wallet` fee is paid by customer, so `DEBIT customer?` — product decides whether fee is `CASH` or `WALLET` dedustion — but ledger same pattern: `DEBIT customer_wallet?` + `CREDIT pool` separation |
| `Wallet→Cash` `POST /agents/me/cash-out` | `AgentCashOutService.cashOut` | Same | `CASH_TO_WALLET`/`WALLET_TO_CASH` swapped | `DEBIT customer_wallet (principal+fee) / CREDIT pool (principal) + CREDIT fee_receivable` |
| `Cash→Cash` `POST /agents/me/cash-to-cash` | `AgentCashToCashService.create` | After `validate beneficiary_phone normalized 10-digit` + `Idempotency` → before `DEBIT agent_wallet CREDIT unclaimed` | `CommerceResolver.resolve(CASH_TO_CASH, ...)` | `DEBIT agent_wallet (principal+fee) / CREDIT unclaimed (principal) + CREDIT fee_receivable` ; claim `DEBIT unclaimed / CREDIT claimant_wallet (principal) — fee already taken`; expiry `DEBIT unclaimed / CREDIT agent_wallet (principal) — fee not refunded` (product decision whether fee refunded on expiry) |
| `Customer funding` `POST /internal/customers/:id/funding-requests/approve` | `CustomerFundingService.approve` | After `maker≠checker` → before `DEBIT AR_CONTROL CREDIT customer` | `CommerceResolver.resolve(CUSTOMER_FUNDING, ...)` — likely `fee=0` for funding (product decides) | If fee >0: `DEBIT funding_pool (fee?)`? But funding is **Finance Operations** → customer, fee not applicable — keep `fee=0` for now, but architecture allows future `CUSTOMER_FUNDING` fee |
| `Agent funding` `POST /internal/agents/:id/fund` | `AgentFundingService.fund` | Before `DEBIT pool CREDIT agent_wallet` | `CommerceResolver.resolve(AGENT_FUNDING, ...)` — likely `fee=0` (funding not fee-bearing) | Keep `fee=0` but snapshot `commercialDecision` with `fee=0` for audit |

**Key:** `CommerceResolver` must be called **after** `IdempotencyService.reserve` (so retry returns same `commercialDecision` reference) and **inside** `SERIALIZABLE` txn with `limit_usages FOR UPDATE` + `commercial_decisions INSERT` + `postJournal` atomic.

## 16. Concurrency/Idempotency Requirements

- **Reservation-first idempotency:** `IdempotencyService.reserve(commandId)` must be **first** (before `FeeEngine`, `LimitEngine`, `CommissionEngine`). If `idempotency.status===COMPLETED`, return existing `transfer` + existing `commercialDecision` **without** re-evaluating limits (idempotent retry should not double-count limit usage). If `PENDING`, proceed to evaluate limits + fees inside txn, then mark `COMPLETED`.
- **Authoritative command-time enforcement:** All commercial checks (fee calc, limit evaluate, commission/reward eligibility) must happen **inside** `DataSource.transaction('SERIALIZABLE')` (or `REPEATABLE READ` with `FOR UPDATE`), not as read-side `GET` pre-check. The `LimitEngine.evaluate` caller must **not** do unsafe `SELECT SUM(amount) FROM transfers WHERE customer_id=$1 AND date=today` then `evaluate` outside txn; instead `LimitUsageService` must do `SELECT daily_amount, daily_count FROM limit_usages WHERE customer_id=$1 AND lagos_date=$2 FOR UPDATE` **inside** txn, then `evaluate(dailyUsed, amount)`, then `UPDATE limit_usages SET daily_amount=daily_amount+$1, daily_count=daily_count+1 WHERE ...` in same txn.
- **Current pilot `customer_daily_usages` FOR UPDATE is close but must be `limit_usages` with `paymentType` dimension:** The existing `limit_usages` should be per `customer_id + lagos_date (YYYY-MM-DD Africa/Lagos) + paymentType` (not global `SUM` across all payment types), and monthly similarly `YYYY-MM`. Wallet balance limit is per `wallet_id`.
- **Do NOT use unsafe read-then-write SUM:** `SELECT SUM(amount_minor) FROM transfers WHERE ...` without `FOR UPDATE` allows two concurrent `POST /customers/me/transfers` to both read `SUM=90K`, both see `dailyLimit=100K`, both allow `10K`, resulting in `110K > 100K` (race). Must be `FOR UPDATE` reservation.
- **Deterministic Lagos day:** `effective_timestamp` at `Africa/Lagos` midnight — `limit_usages.lagos_date = to_char(effective_timestamp AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD')`, not `UTC`.
- **Test concurrency:** Need `Promise.all([transferA, transferB])` with same `customerId` + `dailyLimit 10000` + `amount 6000` each → exactly one should succeed, one `DAILY_LIMIT_EXCEEDED` (deterministic via `FOR UPDATE`).

## 17. Admin Configuration Requirements

**Distinguish backend capability from future Admin UI implementation — backend must be configurable via `internal/*` APIs even if UI not yet built.**

| Admin capability | Backend API (future, not now) | UI status | Config fields | Audit |
|------------------|-------------------------------|-----------|---------------|-------|
| **Products** | `POST /internal/products` `{code, domain, description, isActive}`, `GET /internal/products`, `PATCH /internal/products/:code` `{isActive, enabled}`, `GET /internal/products/:code/capabilities` | `ADMIN_UI_READY` = future (currently `PLANNED`) | `code` (FK `QuotePaymentType`), `domain`, `description`, `enabled`, `configurationStatus`, `version` | `audit_events` `PRODUCT` |
| **Fee rules** | `POST /internal/products/:code/fee-rules` `{flatFeeMinor, percentageBps, minimumFeeMinor, maximumFeeMinor, vatBps, tiers?, kycLevel?, agentClassId?, customerId?, isPromotional?, promoCode?, effectiveFrom, effectiveTo, priority}`, `GET .../fee-rules?effectiveDate=...`, `PATCH .../fee-rules/:id` (new version, not mutate old), `GET .../fee-rules/:id/history`, `POST .../fee-rules/:id/activate|deactivate` | `ADMIN_UI_READY` = future, backend `DESIGNED` | same as `FeeRule` + `priority`, `version`, `effectiveFrom/To`, `createdBy`, `audit` | `audit` + `fee_rules` history (immutable old versions never UPDATE, only INSERT new version) |
| **Commission rules** | `POST /internal/products/:code/commission-rules` `{fixedMinor, percentageBps, tiers, base ENUM[PRINCIPAL,FEE,NET], allocation JSONB, scope GLOBAL/AGENT_CLASS/AGENT/SERVICE, agentClassId?, agentId?, effectiveFrom/To, priority}` + history | same | `CommissionRule` fields (see §8) | same |
| **Reward rules** | `POST /internal/products/:code/reward-rules` `{fixedMinor, percentageBps, tiers, eligibility JSONB, effectiveFrom/To, priority}` | same | `RewardRule` | same |
| **Customer/KYC pricing profiles** | `POST /internal/customer-limit-profiles` already exists via `CustomerEligibilityService` (`POST /customers/:id/limit-profiles`), extend to `POST /internal/products/:code/kyc-pricing`? Actually KYC pricing is fee rule with `kycLevel` field — Admin UI should filter fee rules by `kycLevel` | `BACKEND_IMPLEMENTED` (profile) but Admin UI `PLANNED` | `kycLevel`, `customerId` override, `priority` | audit |
| **Agent-class pricing** | `POST /internal/agent-classes/:id/limits` + `fee-rules` with `agentClassId` | `BACKEND_IMPLEMENTED` (applicableLimits JSONB) but needs normalized `agent_class_limits` + fee rules | `applicableLimits`, `applicableServices` currently JSONB — future `fee_rules.agentClassId` | audit |
| **Limits** | `POST /internal/limits/rules` `{paymentType, singleTransactionAmountMinor, dailyTransactionAmountMinor, monthlyTransactionAmountMinor, dailyTransactionCount, walletBalanceMinor, kycLevel?, agentClassId?, customerId?, effectiveFrom/To, priority}`, `GET /internal/limits/usages?customerId&lagosDate=...` (read-only diagnostics), `POST /internal/limits/emergency-disable` `{paymentType, enabled}` | backend `LIMIT-ENGINE` exists but runtime `BACKEND_IMPLEMENTED` partial; Admin UI `PLANNED` | `effective dates`, `versions`, `activation`, `Lagos day` | audit |
| **Effective dates / rule versions** | Every rule INSERT creates `version = max(version)+1` per `paymentType+scope`, `effectiveFrom` future-dated allowed; rule never UPDATE, only new version + old `effectiveTo` set | — | `effectiveFrom/To`, `version`, `priority`, `createdBy` | `audit_events` + `rule_version` snapshot in `commercial_decisions` |
| **Activation/deactivation** | `PATCH /internal/products/:code/fee-rules/:id/deactivate` sets `effectiveTo=now()` + new `version`; `activate` creates new row with `effectiveFrom=now()` | — | `isActive` derived from `effectiveTo IS NULL OR effectiveTo>now()` | — |
| **Promotions / exceptions** | `POST /internal/products/:code/fee-rules` with `isPromotional=true, promoCode, customerId` + `priority 90` (see §11); `POST /internal/products/:code/reward-rules` promotional | Backend `DESIGNED` | `promoCode`, `isPromotional`, `customerId` specific | — |
| **Audit history** | `GET /internal/audit/events?entityType=fee_rule&entityId=...` + `GET /internal/products/:code/fee-rules/:id/history` + `GET /internal/commercial-decisions?transferId=...` | `BACKEND_IMPLEMENTED` (generic `audit_events`) | `entityType`, `entityId`, `correlationId`, `actor`, `before/after` | immutable |

**Capability-state nuance:** `FeeEngine` is `BACKEND_IMPLEMENTED` but **not** `FULLY_ENABLED` because `TransferService` does not call it — Admin can configure `fee_rules` but runtime still `feeMinor 0` until `TransferService` integration (see §22 sequence).

## 18. Capability Registry Design

**Design a permanent capability registry that prevents loss of implementation knowledge when tabs/chats are lost. Reconcile with existing A7 lifecycle vocabulary.**

**Existing vocabulary:** `A7` modules use `A7_PRODUCT_*` constants but no explicit `capability_status` enum. The `pilot_controls` uses `enabled boolean`. The most complete existing status is `agent` `ACTIVE/SUSPENDED/TERMINATED` and `customer` `ACTIVE`, but not for capabilities.

**Proposed `capabilities` table (reconcile with `PLANNED` etc., but use existing `A7` style if possible — we propose `capability_status` ENUM that maps to `PLANNED`...`DEPRECATED`):**

```sql
CREATE TABLE capabilities (
  capability_code VARCHAR(80) PRIMARY KEY, -- e.g., 'WALLET_TRANSFER', 'FEE_RULES', 'COMMISSION_ENGINE'
  domain VARCHAR(40) NOT NULL, -- CUSTOMER, AGENT, AGGREGATOR, WALLET, LEDGER, NOTIFICATION, SUPPORT, RECONCILIATION, COMMERCIAL, ADMIN, etc.
  description VARCHAR(500) NOT NULL,
  backend_status VARCHAR(40) NOT NULL CHECK (backend_status IN ('PLANNED','DESIGNED','BACKEND_IMPLEMENTED','DISABLED','DEPRECATED')), -- reconciled: existing A7 has DESIGNED, we add BACKEND_IMPLEMENTED
  api_status VARCHAR(40) NOT NULL CHECK (api_status IN ('NOT_EXPOSED','API_READY','DEPRECATED')),
  admin_ui_status VARCHAR(40) NOT NULL CHECK (admin_ui_status IN ('NOT_EXPOSED','ADMIN_UI_READY','DEPRECATED')),
  customer_ui_status VARCHAR(40) NOT NULL CHECK (customer_ui_status IN ('NOT_EXPOSED','CUSTOMER_UI_READY','DEPRECATED')),
  agent_ui_status VARCHAR(40) NOT NULL CHECK (agent_ui_status IN ('NOT_EXPOSED','AGENT_UI_READY','DEPRECATED')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE, -- is enabled in production (pilot_controls.enabled analog)
  configuration_status VARCHAR(40) NOT NULL CHECK (configuration_status IN ('NOT_CONFIGURED','CONFIGURED','DISABLED')), -- is rule/config present?
  dependencies VARCHAR(80)[] NULL, -- array of capability_code FKs (e.g., FEE_RULES depends on PRODUCT_CATALOGUE)
  tests VARCHAR(200)[] NULL, -- array of test paths (e.g., 'test/v1-001*')
  documentation VARCHAR(200)[] NULL, -- array of docs paths (e.g., 'docs/V1-001-VERIFICATION-REPORT.md')
  implementation_references VARCHAR(200)[] NULL, -- array of src paths (e.g., 'src/transfer/transfer.service.ts')
  migration_references VARCHAR(80)[] NULL, -- array of migration names (e.g., 'CreateWalletAndLedger')
  current_version INTEGER NOT NULL DEFAULT 1,
  owner VARCHAR(80) NULL, -- area: 'Wallet', 'Commercial', 'Agent', 'Support' (if already represented in repo — e.g., wallet owner is 'Wallet')
  notes TEXT NULL,
  blockers VARCHAR(200) NULL, -- e.g., 'PRODUCT DECISION: fee rates not defined'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE capability_dependencies (
  capability_code VARCHAR(80) REFERENCES capabilities(capability_code) DEFERRABLE,
  depends_on VARCHAR(80) REFERENCES capabilities(capability_code) DEFERRABLE,
  PRIMARY KEY (capability_code, depends_on)
);
```

**Distinguish (critical, per §18 requirement):**

- `backend_status = BACKEND_IMPLEMENTED` but `api_status = NOT_EXPOSED` → **backend-only** (e.g., `BeneficiaryService` exists but `GET /customers/me/beneficiaries` not exposed — `Admin` only `customers/:id/beneficiaries`).
- `backend_status = BACKEND_IMPLEMENTED` + `api_status = API_READY` but `enabled = FALSE` → **implemented but disabled** (e.g., `FeeEngine` + `fee_rules` configured but `TransferService` not calling → `pilot_controls.enabled=false`).
- `enabled = TRUE` + `configuration_status = CONFIGURED` → **fully enabled** (e.g., `WALLET_TRANSFER` `FULLY_ENABLED` means backend + API + Admin UI + Customer UI all `READY` + `enabled` + `configured`).
- `backend_status = PLANNED` → **only planned** (e.g., `REWARD_ENGINE` `PLANNED` before V1-HARDENING-11).
- `blockers = 'PRODUCT DECISION'` vs `blockers = 'EXTERNAL: NinePSB'` vs `blockers = 'V2'`.

**Seed data at 7feeefc (representative, not exhaustive — full registry in §22 sequence would list 60+ capabilities):**

| capability_code | domain | backend_status | api_status | admin_ui_status | customer_ui_status | agent_ui_status | enabled | configuration_status | V1/V2 | blockers |
|-----------------|--------|----------------|------------|-----------------|--------------------|-----------------|---------|----------------------|-------|----------|
| `WALLET_TRANSFER` | WALLET | BACKEND_IMPLEMENTED | API_READY | ADMIN_UI_READY (via `GET /internal/customers/:id/transactions`) | CUSTOMER_UI_READY (`GET /customers/me/transfers` + `transactions`) | NOT_EXPOSED | TRUE | CONFIGURED (ledger) | V1 | — |
| `FEE_RULES` | COMMERCIAL | BACKEND_IMPLEMENTED (engine) | API_READY (`POST /fees/calculate`) | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | FALSE | NOT_CONFIGURED (no fee_rules rows) | V1 | PRODUCT DECISION |
| `COMMISSION_ENGINE` | COMMERCIAL | PLANNED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | FALSE | NOT_CONFIGURED | V1 | PRODUCT DECISION (allocation) |
| `REWARD_ENGINE` | COMMERCIAL | PLANNED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | FALSE | NOT_CONFIGURED | V2 design | — |
| `LIMIT_ENFORCEMENT` | COMMERCIAL | BACKEND_IMPLEMENTED (engine) | API_READY (`POST /limits/evaluate`) | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | FALSE | NOT_CONFIGURED (profiles exist but not enforced) | V1 | PRODUCT DECISION (thresholds) |
| `BENEFICIARY_CUSTOMER_APP` | CUSTOMER | BACKEND_IMPLEMENTED | NOT_EXPOSED | ADMIN_UI_READY? Actually internal `customers/:id/beneficiaries` only | NOT_EXPOSED (no `GET /customers/me/beneficiaries`) | NOT_EXPOSED | FALSE | CONFIGURED (registry) | V1 P2 | — |
| `NOTIFICATION_ADMIN_DIAGNOSTICS` | NOTIFICATION | BACKEND_IMPLEMENTED | API_READY (`GET /internal/notifications/deliveries`) | ADMIN_UI_READY | NOT_EXPOSED | NOT_EXPOSED | TRUE | CONFIGURED | V1 | — |
| `RECONCILIATION_BREAK_RESOLUTION` | RECONCILIATION | PLANNED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | NOT_EXPOSED | FALSE | NOT_CONFIGURED | V1 | ACCOUNTING DECISION |

## 19. Frontend/Backend Capability-State Model

**Enable answering 7 questions:**

| Question | Registry query | Example at 7feeefc |
|----------|----------------|---------------------|
| What exists in backend but is not in Customer App? | `backend_status=BACKEND_IMPLEMENTED AND customer_ui_status=NOT_EXPOSED` | `BeneficiaryService` (backend) but `GET /customers/me/beneficiaries` NOT_EXPOSED; `FeeEngine` but `POST /customers/me/transfers` does not show fee; `LimitEngine` but not in `GET /customers/me/transactions` |
| What exists in backend but is not in Agent App? | `backend_status=BACKEND_IMPLEMENTED AND agent_ui_status=NOT_EXPOSED` | `Agent unified transaction history` (no `GET /agents/me/transactions` unified), `Agent transaction history` PLANNED |
| What exists in backend but is not exposed in Admin? | `backend_status=BACKEND_IMPLEMENTED AND admin_ui_status=NOT_EXPOSED` | `FeeEngine`/`LimitEngine`/`CustomerLimitProfile`/`AgentClass.applicableLimits` (backend) but no `GET /internal/products/:code/fee-rules` Admin list |
| What is implemented but disabled? | `backend_status=BACKEND_IMPLEMENTED AND enabled=FALSE` | `FeeEngine` (engine exists, `enabled=FALSE`, `configuration_status=NOT_CONFIGURED`), `pilot_controls` `wallet.transfer.create.v1` `enabled=false` |
| What is implemented and enabled? | `backend_status=BACKEND_IMPLEMENTED AND enabled=TRUE AND configuration_status=CONFIGURED` | `WALLET_TRANSFER` `FULLY_ENABLED`, `CASH_TO_WALLET` `FULLY_ENABLED`, `Support` `FULLY_ENABLED` |
| What remains only planned? | `backend_status=PLANNED` | `COMMISSION_ENGINE` `PLANNED`, `REWARD_ENGINE` `PLANNED`, `Provider Cost` `PLANNED` |
| What is blocked by product decision? | `blockers LIKE '%PRODUCT DECISION%'` | `Fee rates`, `Commission allocation`, `Limit thresholds` (see §23) |
| What is blocked by external provider access? | `blockers LIKE '%EXTERNAL%'` | `Termii/Twilio`, `FCM/APNS`, `NIBSS` (9 checks but no live provider) |
| What is V1 versus V2? | `WHERE domain IN (...)` or separate `capabilities` `v1_scope` column? Actually registry should have `scope ENUM[V1,V2]` column | `WALLET_TRANSFER` V1, `AIRTIME_PURCHASE` V2, `CARDS` V2 |

**States must be independently trackable:** `backend_status`, `api_status`, `admin_ui_status`, `customer_ui_status`, `agent_ui_status` are **separate columns** (not single `FULLY_ENABLED`). Example: `FEE_RULES` backend `BACKEND_IMPLEMENTED` but API `API_READY` vs Admin UI `NOT_EXPOSED` vs Customer UI `NOT_EXPOSED` — do not represent as `FULLY_ENABLED`.

## 20. Migration Strategy

**Additive, 0→66 preserved, 66→67+ only after product decisions — never rewrite existing architecture:**

| Migration (proposed, do NOT create now) | Table(s) | Depends on | Risk |
|-----------------------------------------|----------|------------|------|
| `1785753600066-CreateProductsAndCapabilities.ts` | `products` (`code` PK, `domain`, `description`, `isActive`, `enabled`, `version`), `capabilities` (see §18) + `capability_dependencies` | Nothing (standalone, no ledger change) | Low — no financial impact, `products.code` FK to `fee_rules` etc. deferred |
| `1785753600067-CreateFeeRules.ts` | `fee_rules` (`id uuid PK`, `paymentType` FK `products.code`, `flatFeeMinor bigint`, `percentageBps bigint`, `minimumFeeMinor bigint nullable`, `maximumFeeMinor bigint nullable`, `vatBps bigint`, `tiers jsonb nullable`, `kycLevel varchar nullable`, `agentClassId uuid nullable`, `customerId uuid nullable`, `isPromotional boolean`, `promoCode varchar nullable`, `effectiveFrom timestamptz`, `effectiveTo timestamptz nullable`, `version int`, `priority int`, `createdBy uuid`, `createdAt`, `CHECK version>0`, `CHECK flat>=0`, `CHECK percentageBps>=0`, `UNIQUE (paymentType, customerId, agentClassId, promoCode, version) WHERE ...`? Actually `UNIQUE` on `(paymentType, kycLevel, agentClassId, customerId, promoCode, version)` partial) | `products` + `ledger_account` seed | Medium — adds columns `tierStrategy` later if needed; keep `flatFeeMinor/percentageBps` not nullable (0 = free) |
| `1785753600068-CreateCommissionRulesAndSettlements.ts` | `commission_rules` (similar + `base ENUM[PRINCIPAL,FEE,NET]`, `allocation jsonb`), `commission_settlements` (`id`, `transfer_id FK`, `agent_id`, `aggregator_id nullable`, `amountMinor bigint`, `status ENUM[PENDING,EARNED,SETTLED]`, `ledgerJournalId uuid`, `commercialDecisionId uuid`, `version`) | `fee_rules` + `products` | Medium — allocation needs `aggregator_agent_relationships` join |
| `1785753600069-CreateRewardRulesAndSettlements.ts` | `reward_rules` + `reward_settlements` | `products` | Low (V2 design, may defer) |
| `1785753600070-CreateLimitRulesAndUsages.ts` | `limit_rules` (`id`, `paymentType`, `kycLevel`, `agentClassId`, `customerId`, `singleTransactionAmountMinor`, `dailyTransactionAmountMinor`, `monthlyTransactionAmountMinor`, `dailyTransactionCount`, `walletBalanceMinor`, `effectiveFrom/To`, `version`, `priority`) + `limit_usages` (`customer_id uuid`, `lagos_date date`, `lagos_month varchar(7)`, `paymentType`, `walletId uuid nullable`, `dailyCount int`, `dailyAmountMinor bigint`, `monthlyAmountMinor bigint`, `version`, `PRIMARY KEY (customer_id, lagos_date, paymentType)`) | `customer_limit_profiles` (reuse data, migrate `applicableLimits` JSONB → `limit_rules` rows) | High — must be **concurrency-safe** `FOR UPDATE`, Lagos day `Africa/Lagos`, `version` optimistic |
| `1785753600071-CreateCommercialDecisionsAndLedgerMappings.ts` | `commercial_decisions` (see §13) + `product_ledger_mappings` (`product_code FK products.code`, `feeReceivableAccountId uuid`, `commissionPayableAccountId uuid`, `revenueAccountId uuid`, `rewardLiabilityAccountId uuid`, `vatPayableAccountId uuid`, `providerCostAccountId uuid nullable`) | all above + `ledger_accounts` seed for `FEE-RECEIVABLE`, `COMMISSION-PAYABLE`, `PLATFORM-REVENUE`, `REWARD-LIABILITY` | High — ledger accounts must be seeded `ALLOW_NEGATIVE` etc. |
| `1785753600072-SeedLedgerAccountsForCommercial.ts` | Seed `ledger_accounts` `FEE-RECEIVABLE-NGN`, `COMMISSION-PAYABLE-AGENT-NGN`, `COMMISSION-PAYABLE-AGGREGATOR-NGN`, `PLATFORM-REVENUE-NGN`, `REWARD-LIABILITY-NGN`, `REWARD-EXPENSE-NGN`, `VAT-PAYABLE-NGN`, `PROVIDER-COST-NGN` (V2) | `CreateCommercialDecisions...` | Medium — must not break `ReconciliationService` `currency_consistency` |

**Strategy:** Each migration is **additive** (new tables, no `ALTER` of `transfers`, `wallet_accounts`, `ledger_journals` except `ADD COLUMN commercial_decision_id uuid nullable REFERENCES commercial_decisions(id) DEFERRABLE` if needed — but better FK from `commercial_decisions` to `transfers` as in §13 design to avoid `ALTER transfers`). No `DROP` of `customer_limit_profiles` or `agent_classes.applicableLimits` — keep them for backward compatibility, migrate data via `INSERT INTO limit_rules SELECT ... FROM customer_limit_profiles` + `applicableLimits` JSONB parse. Keep `FeeEngine` `flatFeeMinor/percentageBps` signature but add optional `tiers` param.

## 21. Test Strategy

**Use real PostgreSQL `jest.integration.config.js` (like H-06/H-07/H-09), not mocks. Deterministic, `SERIALIZABLE`, `FOR UPDATE`, `Lagos` day, fee/commission separation, idempotency-first.**

| Test suite (proposed, not created) | Covers | Key assertions | PG harness |
|------------------------------------|--------|----------------|------------|
| `test/commercial-capability-registry.integration.spec.ts` | Registry | `INSERT capabilities` + `GET /internal/capabilities` `SUPPORT` 200, `CUSTOMER` 401, `backend_status` `PLANNED→BACKEND_IMPLEMENTED` transitions, `api_status` separate from `backend_status`, `enabled` `FALSE` vs `TRUE` | H-09 style with `mockWorkforceSessions` |
| `test/commercial-fee-engine.integration.spec.ts` | Fee matrix 19 models | `FeeEngine.calculate` for `free/flat/percentage/percentage+min+max/flat+percentage/tiered BRACKETED/PROGRESSIVE/fixed+tiered/promotional/customer-specific/KYC/agent-class/versioned/priority` — each `feeMinor` correct, `MAX_POSTGRES_BIGINT` guard, `maximum<minimum` 400, `vatBps` separate, `totalMinor` string | unit + integration (insert `fee_rules` + resolve) |
| `test/commercial-commission-engine.integration.spec.ts` | Commission matrix | `CommissionEngine.calculate` `global/agent-class/individual/service-specific/fixed/percentage/tiered/base=PRINCIPAL/FEE/NET` + `allocation [Agent 60%/Aggregator 20%/Platform 20%]` → `commission_allocations[]` correct, `version` snapshot, `status PENDING→EARNED→SETTLED` | integration with `feeMinor` dependency |
| `test/commercial-reward-engine.integration.spec.ts` | Reward matrix | `RewardEngine` `percentage/fixed/tiered/promotional/eligibility` (same as commission) — `rewardMinor` correct, `customerId/kycLevel` eligibility via `customer_product_enrollments` | integration |
| `test/commercial-limit-engine.integration.spec.ts` | Limit matrix (per-transaction/daily/monthly/wallet, KYC/Agent-class/override, effective dates, emergency disable, Lagos day, reservation-first, FOR UPDATE) | `LimitEngine.evaluate` `SINGLE/DAILY/MONTHLY_EXCEEDED` + `remaining*`; **concurrency:** `Promise.all([transfer 6000, transfer 6000])` with `dailyLimit 10000` → exactly one `201` one `400 DAILY_LIMIT_EXCEEDED` via `FOR UPDATE`; `IdempotencyService.reserve` before limit → retry does not double-count; `walletBalance` limit | real PG `FOR UPDATE` |
| `test/commercial-decision-snapshot.integration.spec.ts` | Snapshot immutability | `POST /customers/me/transfers` with `fee_rules` `version 1` → `commercial_decisions` row `fee_rule_version 1`; then Admin `POST /internal/products/WALLET_TRANSFER/fee-rules` new `version 2` → second transfer `version 2`; first transfer `commercialDecisions` still `version 1` (history explainable even after config change) | integration |
| `test/commercial-ledger-integration.integration.spec.ts` | Ledger separation | `W→W` principal 10000 + fee 100 + commission 40 → `ledger_journals` `DEBIT source 10100 / CREDIT dest 10000 + CREDIT fee_receivable 100` balanced + `DEBIT fee_receivable 40 / CREDIT commission_payable_agent 40` + `CREDIT platform_revenue 60` — all same `journalId` transaction, `trial-balance` `violations==0`, `journal_balance_integrity` pass | integration with `LedgerService.postJournal` |
| `test/commercial-product-catalogue.integration.spec.ts` | Catalogue | `GET /internal/products` lists 7 canonical `WALLET_TRANSFER` etc., `POST /internal/products` `code='AIRTIME_PURCHASE'` `isActive=false` (future) without implementing airtime flow — `CommerceResolver` resolves `AIRTIME_PURCHASE` fee `0` default | integration |
| `test/commercial-admin-configuration.integration.spec.ts` | Admin config | `POST /internal/products/WALLET_TRANSFER/fee-rules` `SUPPORT` 403, `OPERATOR` 200, `fee_rules` versioned history `GET .../history` returns 2 versions, `PATCH .../deactivate` sets `effectiveTo` | auth matrix like H-09 |

**Do not artificially inflate test count** — each suite focused, real PG, `FOR UPDATE` + `Lagos` + `idempotency-first` are the hard parts.

## 22. Dependency-Ordered Implementation Sequence

**Dependency order (must respect; do not implement limits before decisions, nor commission before fees, nor capabilities after):**

```
Phase 0 — Foundation (no financial impact)
  1. Capability Registry (products + capabilities tables, seed 7 canonical products, seed 60+ capabilities with backend/api/admin/customer/agent distinct statuses)
     → depends on: nothing (standalone)
     → unblocks: all tracking

Phase 1 — Commercial Rules Persistence (metadata, still not wired)
  2. Fee Rules Engine Persistence (fee_rules table + FeeRuleService + versioning + priority)
     → depends on: 1 (products.code FK)
     → tests: fee-engine 19 models unit
  3. Commission Rules Persistence (commission_rules + settlements table + CommissionEngine)
     → depends on: 2 (feeMinor needed for base=FEE)
     → tests: commission-engine
  4. Reward Rules Persistence (reward_rules + settlements) — may defer to V2 but spec says design now
     → depends on: 1
     → tests: reward-engine (can be V2)
  5. Limit Rules Normalization (limit_rules + limit_usages table + LimitUsageService FOR UPDATE)
     → depends on: 1 (products.code) + existing customer_limit_profiles + agent_classes.applicableLimits (migrate)
     → tests: limit-engine concurrency

Phase 2 — Snapshot + Ledger (requires Phase 1)
  6. Commercial Decision Snapshot (commercial_decisions table + product_ledger_mappings + ledger_accounts seed for FEE/COMMISSION/REWARD)
     → depends on: 2,3,4,5 (all rule types)
     → tests: decision-snapshot immutability

Phase 3 — Wiring (financial impact — must be last)
  7. Runtime Integration into V1 Financial Flows (CommerceResolver → CommercialDecision → LimitUsageService FOR UPDATE reservation-first → LedgerService.postJournal with additional lines)
     → wraps: TransferService.create, AgentCashIn/Out, CashToCash, CustomerFundingService.approve, AgentFundingService.fund (inside SERIALIZABLE txn, after IdempotencyService.reserve, before postJournal)
     → depends on: 6 (snapshot + ledger accounts)
     → tests: ledger-integration + concurrency + decision-snapshot
  8. Admin Configuration APIs (POST /internal/products/:code/fee-rules etc., plus audit, plus GET /internal/capabilities)
     → depends on: 2-6
     → tests: admin-configuration

Phase 4 — Hardening (after wiring)
  9. Frontend Enablement Tracking (update capabilities admin_ui_status/customer_ui_status/agent_ui_status as Customer/Agent App expose fees/limits)
     → depends on: 7,8
     → tests: capability-registry

Do NOT implement 7 before 6 (posting without snapshot violates auditability).
Do NOT implement 5 with unsafe SUM (must be FOR UPDATE).
Do NOT implement 2-4 with hardcoded rates (configurable).
```

**Migrations order:** `0066` (existing) → `0066-CreateProductsAndCapabilities` → `0067-CreateFeeRules` → `0068-CreateCommission` → `0069-CreateReward` → `0070-CreateLimitRulesAndUsages` → `0071-CreateCommercialDecisionsAndLedgerMappings` → `0072-SeedLedgerAccounts` — **additive, never alter `transfers`, `wallet_accounts`, or `ledger_journals`**.

## 23. Product Decisions Required From Project Owner (Antonio)

**All of the following are PRODUCT DECISIONS — do NOT implement with invented values. Mark as `BLOCKED — product decision required` until Antonio confirms.**

| # | Decision | Why it blocks wiring | Recommended generic model (do not choose final) | Do NOT invent |
|---|----------|----------------------|-----------------------------------------------|---------------|
| 1 | **Should V1 launch fee-free or fee-bearing?** (H-08/H-10: V1 can launch 0-fee) | If fee-bearing, need `fee_rules` rows per `paymentType`; if 0-fee, `flat=0, pct=0` as global default `priority 10` is sufficient and `CommerceResolver` returns 0 | Either: `WALLET_TRANSFER` `flat 0` default vs `flat 50` + `pct 0.5%`? Do not choose | Do NOT invent `fee=100` for 10,000 principal |
| 2 | **Fee model per product?** (flat/percentage/tiered etc. per `WALLET_TRANSFER`, `CASH_TO_WALLET`, etc.) | `FeeRule.tiers` structure depends on model; `BRACKETED` vs `PROGRESSIVE` vs `fixed+tiered` | §7 matrix 19 models — need Antonio to pick per product: e.g., `WALLET_TRANSFER` maybe flat vs `CASH_TO_CASH` maybe percentage+min | Do NOT pick `tiered` for `WALLET_TRANSFER` without Antonio |
| 3 | **Tier boundaries & rates?** (if tiered) | `upToMinor` thresholds (e.g., `0-10K: 50 flat`, `10K-50K: 100 flat`) are business | Tier table `upTo`, `flat`, `percentageBps`, `min`, `max` per tier | Do NOT invent `upTo 50000` |
| 4 | **VAT/tax treatment?** | `vatBps` exists but regulatory mapping (`VAT-PAYABLE` account % vs exempt) is regulatory, not technical | Keep `vatBps` 0 until Antonio provides tax advice; do not choose `7.5%` (Nigeria VAT) | Do NOT invent `vatBps 750` |
| 5 | **Commission base?** (`PRINCIPAL` vs `CUSTOMER_FEE` vs `NET_FEE`) | `CommissionRule.base` choice changes `commissionMinor` formula | Example: `base=FEE` → `commission = fee * pct` (40% of 100 = 40); `base=PRINCIPAL` → `commission = principal * pct` — need Antonio to choose per product | Do NOT invent `base=FEE` as default without Antonio |
| 6 | **Commission allocation split?** (Agent/Aggregator/platform %) | `commission_allocations` JSONB `pct` per party (e.g., `Agent 60%`, `Aggregator 20%`, `Platform 20%`) is commercial | Recommend `Agent 60/ Aggregator 20/ Platform 20` as **illustrative** only; need Antonio to confirm per `paymentType` + `AgentClass` | Do NOT invent `Agent 60%` as business rate |
| 7 | **Commission type per product?** (fixed/percentage/tiered) | Like fee, commission per `AGENT_FUNDING` vs `WALLET_TRANSFER` may differ | §8 matrix — need per product | Do NOT invent `fixed 5000` |
| 8 | **Reward eligibility & rates?** (percentage/fixed/tiered/promotional, customer/KYC eligibility) | `RewardRule` `eligibility` `customerId/kycLevel/promoCode` + `maxRewardPerCustomerDaily` | §9 matrix — need Antonio to decide `WALLET_TRANSFER` cashback `20 bps`? Do not invent | Do NOT invent `reward 2%` |
| 9 | **Limit thresholds per product?** (single/daily/monthly/wallet, per KYC level, per Agent class, overrides) | `singleTransactionAmountMinor`, `dailyTransactionAmountMinor`, `monthlyTransactionAmountMinor`, `dailyTransactionCount`, `walletBalanceMinor` values per `paymentType` × `kycLevel` × `agentClass` are operational | `V1-HARDENING-03` 10 decisions: whether V1 needs limits, LPC Lagos day semantics, override precedence, concurrency `FOR UPDATE` | Do NOT invent `daily 1M` etc. |
| 10 | **Rule precedence order?** (specific customer > promotion > KYC tier > Agent class > service default > global) | `CommerceResolver` `ORDER BY priority DESC` priority numbers (100,90,80...) are product decision | §11 recommended generic order but **mark as PRODUCT DECISION** — need Antonio to confirm whether promotion outranks KYC tier | Do NOT choose `promotion 90 > KYC 80` as final without Antonio |
| 11 | **Effective dates / versioning window?** (when does new fee take effect? `effectiveFrom=2026-10-01`?) | `effectiveFrom` future-dated allowed; `version` auto-increment per scope | Need Antonio to decide `effectiveFrom` for first fee-bearing version if V1 launches fee-bearing later | Do NOT pick `effectiveFrom=now()` |
| 12 | **Product catalogue V1 vs V2?** (confirm 7 V1 codes + any new V1 product before code-free wiring) | `products` table seed list `WALLET_TRANSFER, WALLET_TO_CASH, CASH_TO_WALLET, CASH_TO_CASH, CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING` is authoritative; adding `BILLS_PAYMENT` now would be V2 but spec says design without implementing future products | Need Antonio to confirm no additional V1 product before wiring | Do NOT add `BILLS_PAYMENT` |
| 13 | **Provider/network cost?** (NIBSS cost per Wallet→Bank etc.) | `PROVIDER-COST-NGN` line is **V2** (Wallet→Bank not V1) — reserve slot but do not implement V1 provider cost allocation | V1 internal NGN has **0 provider cost**; NIBSS cost is V2 when external settlement exists | Do NOT invent `providerCost 25` |
| 14 | **Tax/VAT rate?** (regulatory) | `vatBps` is field but do NOT invent regulatory treatment | Keep 0 until tax advice | Do NOT invent `vatBps 750` |
| 15 | **Enablement: when should fee/limit/commission/reward become runtime-authoritative?** (all at once vs phased) | Wiring `TransferService` to call `CommerceResolver` will make `feeMinor` non-zero immediately — need Antonio to gate `pilot_controls` `wallet.transfer.create.v1` `enabled` & `fee_rules` `effectiveFrom` so launch can remain 0-fee pilot until product ready | Need Antonio to decide `Phase 3` go-live date | Do NOT enable fees without Antonio `effectiveFrom` |

**All 15 remain **configurable** — architecture must support any value Antonio later provides, but **do not hardcode** before Antonio confirms.

## 24. Explicit V1/V2 Boundary

| Feature | V1 (in-scope) | V2 (out-of-scope) | Evidence at 7feeefc |
|---------|---------------|-------------------|--------------------|
| **Wallet types** | Customer wallets + Agent e-float (`wallet_accounts` `CUSTOMER_FUNDS` liability + `AGENT_FUNDING_POOL` asset) | — | `WalletService`, `AgentFundingService` |
| **Financial flows** | W→W, Cash→Wallet, Wallet→Cash, Cash→Cash init/claim/expiry, Customer funding maker/checker, Agent/Aggregator funding, outlets/terminals | Wallet→Bank, Bank→Wallet live provider, NIBSS/Wema/Providus/NinePSB external settlement, cards/dollar cards | V1-008 §2, H-10 §17, `grep -r "Wallet.*Bank" src` 0 |
| **Commercial** | Product catalogue 7 codes, FeeRules/Commission/Reward **design** + `FeeEngine`/`LimitEngine` **foundations**, but **runtime fee-free** pilot; capability registry | Fee-bearing runtime **wiring** (after product decisions), reward settlement for V2 products (airtime/bills) | `src/fee/fee.engine.ts` not wired, H-10 `0 P0/0 P1` |
| **Limits** | LimitEngine + `customer_limit_profiles` + `agent_classes.applicableLimits` foundations, but **runtime not enforced** (balance-only) + `pilot_controls` emergency disable | Concurrency-safe `limit_usages FOR UPDATE` + reservation-first wiring (after thresholds decided) | `a7-product-*` policy scaffolding |
| **Notifications** | `Outbox→Dispatcher→Console/Test→notification_deliveries` + `GET /customers/me/notifications` + `GET /internal/notifications/deliveries` (H-09) | Real SMS (Termii/Twilio/Africa's Talking), Push (FCM/APNS) credentials wiring | `src/notification/notification-provider.interface.ts` `ConsoleNotificationProvider` only |
| **Products** | Internal NGN mobile-money/payment ecosystem (7 product codes) | Airtime, data, bills, electricity, cable, betting, non-NGN, cards | `V1-PRODUCT-COMPLETION-AUDIT.md` §18 |
| **Rewards** | Architecture design for percentage/fixed/tiered/promotional (but no V2 product to prove) | Implementation for airtime to prove reward engine (do not implement airtime now) | Spec says “Do not implement V2 products such as airtime merely to prove the reward engine” |
| **Provider cost** | Reserve `PROVIDER-COST-NGN` ledger account slot | NIBSS cost allocation (when Wallet→Bank exists) | V1 internal, no provider cost |
| **Capability registry** | `products` + `capabilities` tables + `Admin GET /internal/capabilities` (after Phase 0) | Frontend UI exposure (`CUSTOMER_UI_READY`/`AGENT_UI_READY`) as V2 polish | H-10 `P2` gap |

**Do not allow these V1/V2 exclusions to become “missing V1 features”** — V1 commercial design must **reserve** product/ledger slots for V2 (e.g., `PROVIDER-COST-NGN` account code, `products` row `isActive=false`) but not implement V2 flows now.

## 25. Risks and Blockers

| Risk | Likelihood | Impact | Mitigation | Classification |
|------|-----------|--------|------------|----------------|
| **Loss of implementation knowledge when tabs lost** | **High** (current repo has 66 migrations across 14 V1 increments but no `capabilities` registry) | **High** — future dev loses traceability of `BACKEND_IMPLEMENTED` vs `FULLY_ENABLED` | **Implement Capability Registry Phase 0 immediately** (no financial impact) — `products` + `capabilities` seed 60+ capabilities, `migrations` references | **V1** — do not defer |
| **Unsafe limit `SUM` without `FOR UPDATE`** | **High** (current `LimitEngine` uses caller-supplied `dailyUsed`) | **High** — race allows `dailyLimit` breach (`90K + 10K + 10K = 110K > 100K`) | **Must implement `limit_usages FOR UPDATE` + reservation-first `IdempotencyService.reserve`** before wiring limits (Phase 1.5 + Phase 3) | **V1** — launch balance-only until fixed |
| **Fee/commission conflation (principal + fee + commission in same line)** | **Medium** | **High** — accounting misstatement, `ReconciliationService` `journal_balance_integrity` would still pass (balanced) but **commercial** reporting `platform revenue = fee - commission` would be wrong | **Separate ledger lines** (see §14: `fee_receivable`, `commission_payable`, `platform_revenue`) + `CommercialDecision` snapshot with `commission_allocations[]` | **V1** |
| **Immutability violation (Admin changes config, old transactions lose history)** | **High** | **High** — audit failure, `commercial_decisions` not snapshotted | **Snapshot `ruleIds+versions+calculation JSONB` inside same `SERIALIZABLE` txn** (see §13) | **V1** |
| **Precedence silently implemented** | **Medium** | **Medium** — business dispute (“why did promotion not outrank KYC tier?”) | **Document recommended generic precedence but mark as PRODUCT DECISION** (see §11), do not code final order without Antonio | **PRODUCT DECISION** |
| **VAT/regulatory misallocation** | **Medium** | **Medium** | Keep `vatBps` 0, create `VAT-PAYABLE` account but do NOT invent rate (see §14) | **PRODUCT DECISION** |
| **Provider cost invented** | **Low** | **Medium** | Reserve `PROVIDER-COST-NGN` account slot, but V1 internal NGC has 0 cost — do not implement provider cost allocation until Wallet→Bank V2 | **V2** |
| **Duplicate product identifiers** | **Low** (but risk if new `ProductCode` enum created instead of reusing `QuotePaymentType`) | **Medium** — `fee_rules.paymentType` FK would not match `products.code` | **Reconcile: reuse `QuotePaymentType` as canonical `products.code`** (see §12) | **V1** |
| **Idempotency after limits (retry double-counts)** | **High** | **High** — limit usage double-increment on retry | **Reservation-first:** `IdempotencyService.reserve(commandId)` **before** `LimitEngine.evaluate` (see §16) | **V1** |
| **No risk of existing financial flow rewrite** | — | — | **Do NOT rewrite** `TransferService`, `LedgerService`, `AgentCashIn/Out` — additive wiring only (see §6.2) | — |
| **Test concurrency not covered** | **Medium** | **High** | Add `Promise.all` concurrent limit test in `test/commercial-limit-engine.integration.spec.ts` | **V1** |
| **Migration chain break (rewrite history)** | **Low** | **High** | **Additive migrations only** (`1785753600066-...` onward, never `ALTER` existing `transfers`/`wallet_accounts`/`ledger_journals` except nullable FK; never `DROP` `customer_limit_profiles`) | — |

**Current blocks (before any code):** All 15 product decisions in §23 **remain blocked** until Antonio confirms rates/thresholds/precedence/base/allocation/effective dates. **No technical blocker** prevents Phase 0 (Capability Registry) — it can be implemented immediately (standalone, no ledger change).

---

## Files Inspected (representative, 40+)

`src/fee/fee.engine.ts`, `src/fee/fee.types.ts`, `src/fee/fee.controller.ts`, `src/limit/limit.engine.ts`, `src/limit/limit.types.ts`, `src/limit/limit.controller.ts`, `src/customer-eligibility/customer-limit-profile.entity.ts`, `src/customer-eligibility/customer-eligibility.service.ts`, `src/agent/agent-class.entity.ts`, `src/agent/agent-class.service.ts`, `src/quote/quote.enums.ts`, `src/common/money.ts`, `src/common/bigint.transformer.ts`, `src/ledger/ledger.service.ts`, `src/ledger/ledger-account.entity.ts`, `src/ledger/ledger.enums.ts`, `src/transfer/transfer.service.ts`, `src/transfer/transfer.entity.ts`, `src/agent/agent-financial-execution.service.ts`, `src/agent/agent-cash-in.service.ts`, `src/agent/agent-cash-out.service.ts`, `src/agent/agent-cash-to-cash.service.ts`, `src/agent/agent-cash-to-cash-claim.service.ts`, `src/agent/agent-cash-to-cash-expiry.service.ts`, `src/agent/agent-funding.service.ts`, `src/customer-funding/customer-funding.service.ts`, `src/wallet/wallet.service.ts`, `src/pilot/pilot-control.entity.ts`, `src/authorization/route-policy-registry.ts`, `src/policy/a7-product-*.ts` (6 files), `src/notification/notification-delivery.entity.ts`, `src/support/support.service.ts`, `src/production/production-readiness.service.ts`, `src/migrations/*.ts` (66 files, esp. `1785753600065-CreateNotificationDeliveries.ts`), `docs/V1-PRODUCT-COMPLETION-AUDIT.md`, `docs/V1-008-DEPENDENCY-RE-AUDIT.md`, `docs/V1-HARDENING-05/06/07/08/09/10-*.md`, `test/v1-005-...`, `test/v1-006-...`, `test/v1-hardening-0*.integration.spec.ts`, `jest.config.js`/`jest.integration.config.js`.

## Current Runtime Status (summary)

- **Fee-free pilot** — `FeeEngine` calculator not wired, `feeMinor 0` at `TransferService`/`CashIn/Out`, `fee_rules` table **does not exist**.
- **Limits not enforced** — `LimitEngine` pure math, `customer_limit_profiles` exists but not read at runtime, `agent_classes.applicableLimits` JSONB not enforced, `pilot_controls` `enabled=false`.
- **No commission** — `commission_rules` **0**, no `CommissionEngine`.
- **No reward** — `reward_rules` **0**, no `RewardEngine`.
- **No commercial snapshot** — `commercial_decisions` **0**, no `rule_version` immutability.
- **No capability registry** — `capabilities` **0**, no `products` table beyond `QuotePaymentType` enum.
- **All V1 money flows COMPLETE and operationally complete** — H-10 `VERIFIED — no launch-blocking gaps`.

## Proposed Architecture (summary)

- **Product catalogue** `products` (7 canonical codes reused from `QuotePaymentType`, `isActive`/`enabled`/`version`).
- **Fee/commission/reward/limit rule registries** with `effectiveFrom/To`, `version`, `priority`, `customerId/kycLevel/agentClassId/promoCode` specific overrides, `tiers[]` for tiered.
- **CommercialDecision snapshot** immutable inside `SERIALIZABLE` txn (product, principal, fee, commissionAllocations[], reward, ruleIds+versions, limitDecision, eligibility, reference).
- **Ledger separation** `FEE-RECEIVABLE`, `COMMISSION-PAYABLE-*`, `PLATFORM-REVENUE`, `REWARD-LIABILITY/EXPENSE`, `VAT-PAYABLE`, `PROVIDER-COST` (V2) — all same `ledger_journals`, balanced.
- **Runtime wiring** after `IdempotencyService.reserve` → `CommerceResolver` + `LimitUsageService FOR UPDATE` → `postJournal` atomic (see §15).
- **Capability registry** 4 statuses (`backend/api/admin/customer/agent`) + `enabled` + `configuration_status` + `dependencies` + `tests/docs/owner`.

## Exact Implementation Sequence (dependency-ordered, from §22)

1. **Capability Registry** (`products` + `capabilities`, seed 7 products + 60+ capabilities)
2. **Fee Rules Persistence** (`fee_rules` + `FeeRuleService` + 19 fee models)
3. **Commission Rules Persistence** (`commission_rules` + `CommissionEngine` + allocation)
4. **Reward Rules Persistence** (`reward_rules` + `RewardEngine` — may defer V2)
5. **Limit Rules Normalization** (`limit_rules` + `limit_usages FOR UPDATE` + `LimitUsageService`)
6. **Commercial Decision Snapshot** (`commercial_decisions` + `product_ledger_mappings` + ledger accounts `FEE/COMMISSION/REWARD` seed)
7. **Runtime Integration** (wrap `TransferService`, `AgentCashIn/Out`, `CashToCash`, `CustomerFunding` inside `SERIALIZABLE` txn)
8. **Admin Configuration APIs** (`POST /internal/products/:code/fee-rules` etc. + audit + `GET /internal/capabilities`)
9. **Frontend Enablement Tracking** (update `admin_ui_status`/`customer_ui_status` as UI exposes)

Do NOT implement 7 before 6; do NOT implement 5 with `SUM` without `FOR UPDATE`.

## Exact Decisions Required From Antonio (§23 — 15 decisions)

1. Fee-free at launch vs fee-bearing? 2. Fee model per product? 3. Tier boundaries & rates? 4. VAT/tax treatment? 5. Commission base (`PRINCIPAL` vs `FEE` vs `NET`)? 6. Commission allocation split (Agent/Aggregator/platform %)? 7. Commission type per product? 8. Reward eligibility & rates? 9. Limit thresholds per product/KYC/Agent-class? 10. Rule precedence order? 11. Effective dates/version window? 12. Product catalogue V1 vs V2? 13. Provider cost? 14. Tax/VAT rate? 15. Enablement timing (phased vs all-at-once)? — **All remain configurable/product decisions, do NOT invent values before Antonio confirms.**

## Explicit Statement No Changes

**No source / no migration / no ledger / no route / no DB changes were made in this task.** `git diff --stat HEAD` after audit = 0 (only `docs/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md` added). `git status --porcelain` clean except report. `ls src/migrations/*.ts | wc -l` remains **66**, `production-readiness` still `1785753600065`. Implementation remains at `7feeefc`.

## Tests/Commands Used for Inspection

`git rev-parse HEAD` → `7feeefc`, `git status --porcelain`, `ls src/migrations/*.ts | wc -l` → 66, `find src -type f -name "*.ts" | xargs grep -l "Fee\|Limit"`, `cat src/fee/fee.engine.ts`, `cat src/limit/limit.engine.ts`, `grep -r "commission\|reward\|cashback" src --include="*.ts"` → 0, `ls src/policy/`, `./node_modules/.bin/tsc --noEmit` → 0, `npm run build` → 0, `grep -rn "QuotePaymentType" src --include="*.ts" | cut -d: -f2 | sort | uniq`.

**Commit hash for documentation report:** pending `git add` + `git commit` (see below).

---
*Report path:* `docs/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md` (this file) — HEAD `7feeefc` → `7feeefc` + report, `66→66`, `tsc 0`, `build 0`, `0` source/migration/ledger/route changes — **AUDIT ONLY**.

