# V1 — Limit Profiles & Transaction-Limit Requirements Audit

**Design & Audit Only — No Runtime Enforcement**

| Item | Value |
|------|-------|
| **Date (Lagos)** | 2026-09-27 |
| **Branch** | `arena/01a0d883-monienaija` |
| **HEAD before** | `35911e3` (`feat(capability-registry-01): permanent Capability Registry … 67 migrations, VERIFIED`) |
| **HEAD after** | *(this commit)* — same tree + `docs/V1-LIMIT-ARCHITECTURE-AUDIT.md` only |
| **Migrations before/after** | **67** (`1785753600000-CreateWalletAndLedger` → `1785753600066-CreateCapabilityRegistry`) — **0 new** |
| **Production guard** | `EXPECTED_MIGRATION_TIMESTAMP='1785753600066'` `EXPECTED_MIGRATION_NAME='CreateCapabilityRegistry1785753600066'` — unchanged |
| **Mode** | AUDIT/DESIGN ONLY — **0 source / 0 migration / 0 ledger / 0 route / 0 DB changes**, financial behavior preserved |
| **Capability registry baseline** | 101 capabilities (89 V1 + 12 V2), `LIMIT_ENGINE DISABLED BACKEND_IMPLEMENTED`, `CUSTOMER_RUNTIME_LIMITS BLOCKED`, `AGENT_RUNTIME_LIMITS BLOCKED` — **not changed** |

> **No NGN limit values are invented in this document.** All thresholds, tiers, product codes and regulatory figures remain product/accounting decisions. This document describes *what must be configurable*, not *what the values should be*.

> **No new terminology replaces existing repo terminology.** Existing names (`CustomerLimitProfile`, `customer_limit_profiles`, `AgentClass.applicableLimits`, `PilotControl`, `LimitEngine`, `QuotePaymentType`) are preserved and distinguished from the proposed generic model (`LimitProfile`, `LimitRule`, `LimitAssignment`, `LimitUsage`).

---

## 1. Executive Summary

MonieNaija V1 today is an **authoritative, SERIALIZABLE, idempotent, ledger-balanced** NGN transfer system with *fee-free* and *limit-unenforced* product boundaries by design. The only configurable transaction guard enforced at runtime is the **internal pilot control** (`pilot_controls` — `enabled boolean`, `cohortCustomerIds`, `currency NGN`, `min/max amount`, `dailyCount/dailyAmount`, `safetyThresholds`). This guard is explicitly scoped to the `A5T09` internal pilot (`wallet.transfer.create.v1`, `cohortCustomerIds` named cohort) and is **disabled** for the ordinary customer path — every other flow checks only `INSUFFICIENT_FUNDS` balance, never a limit.

Two durable limit-ownership concepts exist but are **not runtime-enforced**:

* `customer_limit_profiles` — per-customer, per-currency row: `dailyTransactionCount`, `dailyTransactionAmountMinor`, `singleTransactionAmountMinor`, `monthlyTransactionAmountMinor`, `walletBalanceMinor`. No weekly/yearly, no count vs amount separation, no per-product, no effective dating, no assignment to a named profile. Directly bound to `customer_id` (unique where not soft-deleted).

* `agent_classes.applicable_limits` — opaque `JSONB` nullable on `agent_classes`. No schema, no version, no per-product normalization. Presumed to hold per-service ceilings but never validated or `FOR UPDATE` locked at transaction time.

A **stateless calculator** `LimitEngine.evaluate` exists and is exposed at `POST /limits/evaluate`, but it merely compares `amountMinor` against *passed-in* `single/daily/monthly` numbers and `dailyUsed/monthlyUsed` also passed-in. It performs no DB lookup, no Lagos window, no concurrency protection, and is never called from `TransferService`, `AgentCashIn`, `AgentCashOut`, `AgentCashToCash`, or `CustomerFundingService`.

The audit therefore **does not claim `LIMIT_ENGINE`, `CUSTOMER_RUNTIME_LIMITS`, `AGENT_RUNTIME_LIMITS` are implemented**. They are correctly `DISABLED`/`BLOCKED` in the capability registry. This document specifies how to evolve them into a **generic, profile-driven, rule-based, concurrency-safe** limit system that supports *any* number of named limit profiles (`KYC Level 1`, `Basic`, `VIP`, `Agent Class A`, `Tier 5`, …) without ever hard-coding `if tier === 1`.

---

## 2. Existing Repository Implementation

### 2.1 What the repository actually contains (verified via `find`, `cat`, `ls src/migrations/*.ts | wc -l` 67, `grep -rn Limit`)

| Area | Files | Key artefacts |
|------|-------|---------------|
| **Limit calculator** | `src/limit/limit.engine.ts` (60 lines), `src/limit/limit.types.ts`, `src/limit/limit.controller.ts`, `src/limit/limit.module.ts`, `src/limit/dto/evaluate-limit.dto.ts`, `test/limit.engine.spec.ts`, `test/limit.engine.constants.spec.ts` | `LimitEngine`, `POST /limits/evaluate`, `LimitEvaluationRequest/Evaluation` |
| **Customer eligibility/limits** | `src/customer-eligibility/customer-eligibility.entity.ts`, `customer-limit-profile.entity.ts`, `customer-eligibility.service.ts`, `customer-eligibility.controller.ts`, `customer-eligibility.module.ts`, `dto/create-customer-limit-profile.dto.ts`, `dto/update-customer-limit-profile.dto.ts`, `src/migrations/1785753600010-CreateCustomerEligibility.ts` | `customer_eligibilities`, `customer_limit_profiles`, `customer_product_enrollments`, `customer_operating_permissions`, `customer_restrictions` |
| **Agent** | `src/agent/agent-class.entity.ts`, `src/agent/agent.entity.ts`, `src/agent/agent.service.ts`, migrations `1785753600054-CreateAgentClassAndApplicationTables` | `agent_classes.applicable_limits jsonb`, `agent_classes.applicable_services jsonb` |
| **Pilot boundary** | `src/pilot/pilot-control.entity.ts`, `pilot-control.service.ts`, `pilot-control.types.ts`, migration `AddPilotControls` (see `src/pilot/`) | `pilot_controls` with `control_key`, `enabled boolean`, `cohort_customer_ids jsonb`, `currency`, `min/max amount`, `daily_transaction_count_limit`, `daily_transaction_amount_minor` |
| **Authoritative flows** | `src/transfer/transfer.service.ts` (SERIALIZABLE, `lockWallets SELECT FOR UPDATE`, `LedgerService.postJournalInTransaction`, `IdempotencyService.reserve`), `src/agent/agent-cash-in.service.ts`, `agent-cash-out.service.ts`, `agent-cash-to-cash*.service.ts`, `src/customer-funding/customer-funding.service.ts`, `src/agent/agent-funding.service.ts` | `transfers`, `cash_to_cash_transfers`, `customer_funding_requests`, `ledger_journals/lines`, `outbox_events`, `audit_events` |
| **Currency/money** | `src/common/money.ts` (`parseMinorUnits`, `parsePositiveMinorUnits`, `MAX_POSTGRES_BIGINT 9223372036854775807n`, `normalizeCurrency`) | minor-units strings, no float |
| **Payment type canonical codes** | `src/quote/quote.enums.ts` (`QuotePaymentType TRANSFER/DEPOSIT/WITHDRAWAL`), `src/payment/payment.enums.ts` | used as fee/limit product axis in docs |
| **Idempotency + ledger** | `src/operations/idempotency.service.ts` (`reserve` with `pessimistic_write` on `scope+key`, `IN_PROGRESS/COMPLETED`), `src/ledger/ledger.service.ts` (`postJournalInTransaction` with reference, lines, `SERIALIZABLE` retry, `uq_ledger_journals_idempotency_key`) | SERIALIZABLE + `FOR UPDATE` pattern exists, but never applied to limit usage rows (no such table) |
| **Capability registry** | `src/capability-registry/capability.seed.ts` | `LIMIT_ENGINE DISABLED BACKEND_IMPLEMENTED`, `CUSTOMER_RUNTIME_LIMITS BLOCKED`, `AGENT_RUNTIME_LIMITS BLOCKED` (accurate) |
| **Admin config pattern** | `src/pilot/pilot-control.service.ts` (`configure` with `SERIALIZABLE`, `authorizationService.authorize` `OPERATOR/SERVICE/PRIVILEGED`, `idempotencyService`, `auditService`, `version` optimistic locking), `src/customer-eligibility/customer-eligibility.service.ts` (same pattern) | established maker/checker, versioning, audit, correlationId already exists |

### 2.2 What is **not** in the repository

*No* `limit_profiles` generic table, no `limit_rules`, no `limit_usages`/`limit_reservations`, no `limit_assignments`, no `limit_assignments_history`, no `agent_limit_profiles`, no `agent_class_limit_mappings`, no `limit_decision_snapshots`, no `weekly/yearly` granularity, no `transaction count` + `amount` separation beyond a single `dailyTransactionCount` column, no `incoming/outgoing` direction axis, no `effectiveFrom/effectiveTo` versioning, no `Lagos day` window column, no `SELECT FOR UPDATE` on any limit row at transfer time.

`grep -rn "weekly\|yearly\|incoming\|outgoing\|effectiveFrom\|limit_usages" src --include="*.ts"` → 0 hits. `find src -name "*limit*"` → 4 files only (`limit.engine/types/controller/module`).

---

## 3. Existing LimitEngine Capabilities

**File:** `src/limit/limit.engine.ts` — `@Injectable()` pure calculator.

```ts
evaluate(request: LimitEvaluationRequest): LimitEvaluation
  input: { customerId, walletId, paymentType (QuotePaymentType), amountMinor,
           singleTransactionLimitMinor, dailyLimitMinor, monthlyLimitMinor,
           dailyUsedMinor, monthlyUsedMinor }  // all strings minor units
  checks:
    if amountMinor > singleLimit → SINGLE_TRANSACTION_LIMIT_EXCEEDED
    if dailyUsed + amountMinor > dailyLimit → DAILY_LIMIT_EXCEEDED
    if monthlyUsed + amountMinor > monthlyLimit → MONTHLY_LIMIT_EXCEEDED
  output: { allowed boolean, reasons string[], remainingSingle/Daily/MonthlyMinor }
```

* **Can:** flat per-transaction min/max-like ceiling (but callsite supplies `singleTransactionLimitMinor`, no `minimumTransactionAmountMinor` distinct from fee minimum), flat daily/monthly amount ceilings, `remaining*` calculation with `parseMinorUnits` + `MAX_POSTGRES_BIGINT` guard, `QuotePaymentType` enum gate.

* **Cannot:** weekly/yearly, transaction count limits, per-product/service dimension (caller must map paymentType → profile, no registry), `minimum amount` validated as separate allow-reason (only `single` max), count windows, effective dating, versioning, direction, channel, assignment lookup, Lagos timezone, concurrency or DB.

* **Exposure:** `LimitController POST /limits/evaluate` with `EvaluateLimitDto` (`@IsEnum(QuotePaymentType)`, `@Matches(/^[1-9]\d*$/)` for `amountMinor` positive). No `WORKFORCE_SESSION`/`CUSTOMER_LOGIN` guard other than global prefix — treated as internal calculator, not a tenant-isolated enforcement point. No `RoutePolicyRegistry` entry distinct from generic `/limits` public surface (today effectively unauthenticated calculator demo).

* **Test:** `test/limit.engine.spec.ts` — unit tests of the three reasons, no PG harness, no `FOR UPDATE`, no window semantics.

**Preserve:** The calculator pattern is worth keeping as a **pure function** inside a broader transactional evaluation that *supplies* `dailyUsed` from durable `limit_usages` rows rather than trusting caller input.

---

## 4. Existing CustomerLimitProfile Capabilities

**Entity:** `src/customer-eligibility/customer-limit-profile.entity.ts` (`customer_limit_profiles`):

```
id uuid PK
customer_id uuid FK → customers(id), UNIQUE WHERE deleted_at IS NULL
currency varchar(3) CHECK ^[A-Z]{3}$
daily_transaction_count integer CHECK >=0
daily_transaction_amount_minor bigint >=0
single_transaction_amount_minor bigint >=0
monthly_transaction_amount_minor bigint >=0
wallet_balance_minor bigint >=0        -- max balance ceiling, not transaction limit
version integer DEFAULT 1 CHECK >0
created_at / updated_at timestamptz, deleted_at timestamptz (soft delete)
indexes: uq_customer_limit_profiles_active_customer, idx_customer_limit_profiles_currency
```

**Service:** `src/customer-eligibility/customer-eligibility.service.ts`:

* `createLimitProfile(customerId, command)` / `getLimitProfile` / `updateLimitProfile` — each wraps `dataSource.transaction`, `requireCustomer`, unique-active check, `normalizeLimitCreate/normalizeLimitUpdate` (money parsing, `MAX_BIGINT`), `auditService` (`CUSTOMER_LIMIT_PROFILE CREATED/UPDATED`), `version` optimistic locking (`409` stale), `isUniqueViolation` → `ConflictException`.

* Authorization: inherits `CustomerEligibilityService` policy (workforce `OPERATOR/SERVICE/PRIVILEGED` for writes via `pilotControl`/eligibility pattern; no direct customer self-service).

**Can:** store *one* row per customer per active lifetime (currency-scoped, but effective uniqueness is `customer_id`), with a max balance ceiling and single/daily/monthly amount plus daily count. Supports `version` history via `audit_events` diff, not via effective dating.

**Cannot:**
* Arbitrary named profiles — row is bound to `customer_id`, not to a reusable `limit_profile_code` (`KYC Level 1` is not a row; each customer gets its own copied limits, not a shared profile).
* Multiple profiles per customer or per product — no `limit_profile_id` indirection.
* Weekly/yearly, per-transaction count beyond daily, per-product/service, direction, channel.
* Effective dating (`effectiveFrom/To`, `future-dated`, `historical interpretation`).
* Minimum amount per transaction — field is `single_transaction_amount_minor` interpreted as *maximum* per transfer, no `minimumTransactionAmountMinor` distinct column.
* Yearly columns, `incoming/outgoing` separation, rate/VAT (those belong to fee).
* `limit_usages` durable counters.

**Migration:** `1785753600010-CreateCustomerEligibility.ts` creates the table with `CHECK` non-negative and `version >0`. No later migration changes columns.

**Docs:** `docs/V1-HARDENING-03-LIMIT-POLICY-AUDIT.md` correctly calls this **limited but not enforced** (balance-only check in flows, no `limit_usages FOR UPDATE`).

**Preserve:** Keep `customer_limit_profiles` for V1 compatibility but treat as **legacy per-customer snapshot** — future generic model should be `limit_profiles` (reusable codes) + `limit_rules` (dimensioned thresholds) + `limit_assignments` (customer → profile code). Migration can backfill existing `customer_limit_profiles` into assignments rather than renaming silently.

---

## 5. Existing AgentClass Limit Metadata

**Entity:** `src/agent/agent-class.entity.ts`:

```
agent_classes {
  id uuid PK
  reference varchar(80) unique, code varchar(80) unique, name varchar(160)
  description varchar(500) nullable
  is_active boolean default true
  requirements jsonb, required_information jsonb, required_document_categories jsonb
  applicable_services jsonb nullable   -- e.g. ["CASH_IN","CASH_OUT","CASH_TO_CASH"]
  applicable_limits jsonb nullable     -- opaque, never validated
  version integer, created_at/updated_at/deleted_at
}
```

**Observed:** `find src -name "*.ts" | xargs grep applicableLimits` → only `capability-policy-source-readers.ts` and seed helpers read it for audit evidence, never `FOR UPDATE` or enforced in `AgentCashInService`. No JSON schema, no `applicable_limits` DTO, no normalization to `single/daily/monthly` per `QuotePaymentType`.

**Can:** store per-class opaque JSON.

**Cannot:** arbitrary named limit profiles (agent’s limit is implicit via its class code, but class code *is* the profile code only by accident — no indirection table), effective dating, per-product count vs amount, direction, concurrency-safe usage tracking, `incoming/outgoing` semantics, rule precedence across multiple assignments to the same agent (agents have exactly one class).

**Preserve:** Keep `agent_classes.applicable_limits` as legacy JSONB but normalize through a **mapped view**: future generic `limit_profiles.code` may *equal* `agent_classes.code` for migration, but the authoritative limit is `limit_rules` attached to that profile, not raw JSON.

---

## 6. Existing PilotControl Behaviour

**Entity:** `src/pilot/pilot-control.entity.ts` (`pilot_controls`):

```
control_key varchar(160) PK-like unique (e.g. INTERNAL_TRANSFER_PILOT_CONTROL_KEY = "wallet.transfer.create.v1")
capability varchar(128), action varchar(64), scope varchar(80), enabled boolean default false
cohort_customer_ids jsonb default '[]'::jsonb
currency varchar(3) CHECK ^[A-Z]{3}$
min_transaction_amount_minor bigint CHECK >0, max_transaction_amount_minor bigint CHECK >= min
daily_transaction_count_limit integer nullable CHECK >0, daily_transaction_amount_minor bigint nullable CHECK >0
safety_thresholds jsonb default '{}'::jsonb
updated_by varchar(160), last_correlation_id/request_id varchar(255) nullable
version integer, created_at/updated_at timestamptz
CHECKs: currency, min>0, max>=min, dailyCount>0, dailyAmount>0
```

**Service:** `src/pilot/pilot-control.service.ts`:

* `evaluate(command)`: loads `controlKey` row, checks `authorizationDecision.allowed`, `A5_PILOT_EMERGENCY_STOP` config kill-switch, `control` existence, `enabled/capability/action/scope` match, `currency` inside boundary, `cohortCustomerIds.includes(customerId)`, `amountMinor` min/max window (`PILOT_AMOUNT_BELOW_MINIMUM` / `PILOT_AMOUNT_ABOVE_MAXIMUM`), then `dailyCount/dailyAmount` via counting `transfers` rows for the day — but only for the *pilot cohort* and only for the `SERIALIZABLE` internal gate (today bypassed for customer path via `InternalTransferGateService` stub).
* `configure(mutation)`: `SERIALIZABLE` transaction, `authorizationService.authorize` (`OPERATOR/SERVICE/PRIVILEGED` `pilot:control:write`), `IdempotencyService` reserve, `requestHash`, version optimistic lock, `auditService`.

**Can:** durably gate a named capability/action/scope for a named cohort, with blunt min/max + daily count/amount for NGN, audited, versioned, emergency-stop aware.

**Cannot:** weekly/monthly/yearly, transaction count vs amount separation beyond daily, per-product/service granularity beyond `capability/action/scope` trio, assignment to *any* named limit profile, effective dating (version is row version, not `effectiveFrom/To`), per-direction/channel, historical replay, durable usage reservations (`SUM(transfers)` query, not `limit_usages FOR UPDATE`).

**Current runtime enforcement status (verified via `TransferService`, `Agent*`, `CustomerFundingService` grep `pilot`):** Only `pilot_controls` is checked at runtime, and only for `A5T09` `wallet.transfer.create.v1` cohort — which is hardcoded to a named cohort list and `enabled=false` in the fee-free path. Ordinary `POST /customers/me/transfers` bypasses piloting; `POST /agents/me/cash-in/out/cash-to-cash` and `POST /internal/customers/:id/funding-requests` never call `pilotControlService.evaluate` at all. Hence **no transaction limit enforcement** today beyond the balance ceiling.

**Preserve:** Treat `pilot_controls` as an **operational boundary gate** (cohort + global emergency stop), not as the future limit rule store. Its `min/max` semantics are instructive (explicit minimum distinct from maximum) and its `SERIALIZABLE` + `authorization + idempotency + audit + version` pattern should be reused for `limit_profiles/rules`.

---

## 7. Current Runtime Enforcement Status

| Flow | Ledger | Idempotency | Concurrency | Limit enforcement today | Evidence |
|------|--------|------------|-------------|-------------------------|----------|
| `POST /customers/me/transfers` → `TransferService.createTransfer` | `dataSource.transaction('SERIALIZABLE', executeWithinTransaction)` + `lockWallets([...])` `SELECT ... FOR UPDATE` on both wallet rows, `LedgerService.postJournalInTransaction` (balanced DEBIT source / CREDIT dest), `attempt 0..2` retry on `SERIALIZATION_FAILURE` | `transferRepository.findOne({idempotencyKey})` before insert + `uq_transfers_idempotency_key` + `requestHash` 409 check, metrics `idempotency.hits` | `SERIALIZABLE` + deterministic lock order + retry | **BALANCE ONLY** `INSUFFICIENT_FUNDS` (computed `ledger_lines` sum vs `amountMinor + feeMinor(0)`) — no `LimitEngine`, no `customer_limit_profiles` read, no `limit_usages FOR UPDATE`. Fee `0` hardcoded (`a25` `feeMinor 0`). | `transfer.service.ts` `executeWithinTransaction`  ~220 lines, no `LimitEngine` import |
| `POST /agents/me/cash-in` → `AgentCashInService.execute` | `RecipientResolutionService.resolve` → `customers` ACTIVE, `AgentTransactionAuthorizationService.authorize` (CASH_IN + PIN), `AgentFinancialExecutionService` `dataSource.transaction('SERIALIZABLE')` DEBIT pool / CREDIT customer ledger | `idempotencyKey` varchar 255 required, checked inside `AgentFinancialExecutionService` | `SERIALIZABLE` via financial execution | No limits | `agent-cash-in.service.ts`, `agent-financial-execution.service.ts` 0 `limit` imports |
| `POST /agents/me/cash-out` (`WALLET_TO_CASH`) | Same, DEBIT customer / CREDIT pool | Same | Same | No limits | `agent-cash-out.service.ts` |
| `POST /agents/me/cash-to-cash` → `AgentCashToCashService` (init in `cash_to_cash_transfers`, status `CREATED/PAYING`), `AgentCashToCashClaimService` (SERIALIZABLE claim, unclaimed→claimant), `AgentCashToCashExpiryService` (job, `expiresAt` sweep) | `AgentFinancialExecutionService` | Same | Same | No limits (only `amount >0` and balance) | `agent/cash-to-cash*` entities, `1785753600057-0059` migrations |
| `POST /internal/customers/:id/funding-requests` / `approve` → `CustomerFundingService` | `customer_funding_requests` maker/checker, `SERIALIZABLE` DEBIT `AGENT_FUNDING_POOL` / CREDIT `wallet_accounts.ledger_account_id` via `LedgerService.postJournalInTransaction` | `idempotencyKey` + `commandId` | `SERIALIZABLE` | No limits | `customer-funding/customer-funding.service.ts` |
| `POST /internal/agents/:id/fund` / `defund` → `AgentFundingService` | DEBIT/ CREDIT pool↔agent wallet, `SERIALIZABLE` | Same | Same | No limits | `agent/agent-funding.service.ts` |

**Conclusion:** Financial behavior is **unchanged by this audit** (no source/migration changes). Adding future limit checks must be inside the existing `SERIALIZABLE` transaction *after* `lockWallets` / `lockLimitUsageRows` and *before* `postJournalInTransaction`, with `SELECT ... FOR UPDATE` on usage rows (not plain `SUM`). Idempotency replay must short-circuit before any limit reservation.

---

## 8. Proposed Generic Limit Profile Model

### 8.1 Terminology — do not hardcode "Tier"

The repo must never contain `if (tier === 1)` / `if (tier === 2)` / `if (kycLevel === "LEVEL_1")` as branching product logic. Instead the durable concept is **`LimitProfile`**:

* `limit_profiles.code` — data-driven, `VARCHAR(80)` `^[A-Z0-9_]{3,80}$` (examples only: `KYC_LEVEL_1`, `BASIC`, `STANDARD`, `PREMIUM`, `VIP`, `AGENT_CLASS_A`, `TIER_5`, `TIER_100` — none is canonical). The set of codes is entirely rows, never an enum in code.
* `limit_profiles.name` (`varchar(160)`) — display name.
* `limit_profiles.description` (`varchar(500)` nullable).
* `limit_profiles.kind` — optional discriminator `CUSTOMER | AGENT | SYSTEM` (data, not branching logic) so profiles for `AgentClass` reuse the same table but are filtered by `kind` for admin UX; not used as `if kind === "CUSTOMER"` enforcement branch beyond assignment target.
* `limit_profiles.isActive boolean default true` — soft `deleted_at` nullable plus check, never hard-delete rows that have decisions referencing them.
* `version, createdAt, updatedAt` — audit/version, distinct from effective dating on rules.

**Why this shape:** It supports *any* number of profiles with any hierarchy (flat codes, or hierarchical `parent_profile_code` nullable self-FK if product wants tree, but V1 can be flat). Assignment is via a separate table (see §13), never via string column on `customers`. No code path asks "how many tiers are there?" — `SELECT * FROM limit_profiles WHERE is_active` defines the universe.

### 8.2 Relation to existing `CustomerLimitProfile`

Existing `customer_limit_profiles` stays **as compatibility read-model**. The new `limit_profiles` table is the **authoritative reusable definition**; a migration backfills each existing `customer_limit_profiles` row into (a) a `limit_profiles` code synthesized from its implicit customer cohort (or kept as `LEGACY_CUSTOMER_<customerId>`) and (b) a `limit_assignments` row for that customer. Going forward writes go to `limit_profiles/rules`, reads for enforcement go via assignment → rules, while the old table is read as `COALESCE(new, legacy)` during transition.

### 8.3 Relation to `AgentClass`

Existing `agent_classes.code` becomes a **join key**, not a product branch. V1.1 can seed `limit_profiles.code = agent_classes.code` where a class should define its own limits, but the enforcement path dereferences `limit_profiles` via assignment `agent_class_id → limit_profile_code`, not via parsing `applicable_limits` JSONB.

### 8.4 Required constraints

* `CHECK code ~ '^[A-Z0-9_]{3,80}$'` (same as capability registry).
* `UNIQUE (code) WHERE deleted_at IS NULL`.
* `CHECK kind IN ('CUSTOMER','AGENT','SYSTEM','UNIVERSAL')` or unbounded but indexed.
* No `number_of_tiers` column — unbounded rows.

---

## 9. Proposed Limit Rule Model

**`limit_rules`** — the *what* (a single dimensioned threshold). One profile has many rules, each rule scoped to exactly one transaction type/product (and optionally direction/service/channel). This is intentionally *not* one row with 20 nullable columns.

```
limit_rules {
  id uuid PK
  limit_profile_code varchar(80) FK → limit_profiles(code)
  product varchar(80) FK → products(code) or QuotePaymentType (see §10, §22)
    -- examples: WALLET_TRANSFER, CASH_TO_WALLET, WALLET_TO_CASH, CASH_TO_CASH, CUSTOMER_FUNDING
    -- the enum is data (product catalogue), never if (product === "WALLET_TRANSFER") hard branch
  direction varchar(20) nullable CHECK IN ('INCOMING','OUTGOING','BOTH')  -- for agent/customer asymmetry
  channel varchar(30) nullable -- USSD/API/AGENT_APP etc., null means all channels
  currency varchar(3) CHECK ^[A-Z]{3}$  default NGN, V1 NGN only, but column present for V2 non-NGN
  -- dimension (exactly one per row):
  dimension varchar(40) NOT NULL CHECK IN (
    'MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX',
    'DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT',
    'DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT',
    'WALLET_BALANCE_MAX'  -- alias for existing walletBalanceMinor, kept as dimension for unified evaluation
  )
  limit_value_minor bigint NOT NULL CHECK >=0  -- for amount/balance dimensions
  limit_value_count integer NOT NULL CHECK >=0   -- for count dimensions (0 means disabled)
  -- effective dating / versioning (see §16):
  version integer CHECK >0
  effective_from timestamptz NOT NULL DEFAULT NOW()
  effective_to timestamptz nullable CHECK effective_to > effective_from
  is_active boolean default true
  priority integer default 0  -- only if overlapping rules for same (profile,product,dimension) must be reconciled; V1 can forbid overlap and use priority only for future
  -- audit:
  created_by varchar(160) NOT NULL
  created_at/updated_at timestamptz, deleted_at nullable
  UNIQUE WHERE deleted_at IS NULL (limit_profile_code, product, direction, channel, currency, dimension, effective_from)  -- no double-active for same window
}
```

**Why row-per-dimension:** It lets product configure "max per transaction = 50,000 but daily amount = 500,000" as two rows, add weekly later without ALTER TABLE, and query `WHERE dimension = 'DAILY_AMOUNT'` quickly. Amount and count dimensions are never confused (distinct `dimension` values, see §11). `minimumFeeMinor` has no column here — minimum *transaction amount* (`MIN_AMOUNT_PER_TX`) is not a fee.

**Existing mapping:** `CustomerLimitProfile`'s five columns map to 5 rows in `limit_rules`:
* `single_transaction_amount_minor` → `MAX_AMOUNT_PER_TX` (plus new `MIN_AMOUNT_PER_TX` = product decision, default 0)
* `daily_transaction_amount_minor` → `DAILY_AMOUNT`
* `monthly_transaction_amount_minor` → `MONTHLY_AMOUNT`
* `daily_transaction_count` → `DAILY_COUNT`
* `wallet_balance_minor` → `WALLET_BALANCE_MAX` (balance ceiling, see §10)

**Product dimension:** V1 product codes are the existing payment types (`QuotePaymentType TRANSFER` covers `WALLET_TRANSFER`; `DEPOSIT/WITHDRAWAL` map to `CASH_TO_WALLET/WALLET_TO_CASH` etc. — product catalogue decision required, see §22). No new branching logic may switch on `if product === "TIER_1"`.

---

## 10. Transaction-Limit Dimensions

The model explicitly separates five orthogonal axes (never conflated):

| Axis | Column(s) | Values (data) | Example question answered |
|------|-----------|---------------|---------------------------|
| **Limit type** | `dimension` | `MIN_AMOUNT_PER_TX`, `MAX_AMOUNT_PER_TX`, `DAILY/WEEKLY/MONTHLY/YEARLY_AMOUNT` | "Is 10 NGN below the minimum per-transaction floor?" |
| **Time window** | `dimension` suffix (`DAILY_` etc) + `effective_*` + time-window model §19 | `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` definitions in `Africa/Lagos` (see §19) | "Has the customer already reached the daily amount with a transaction stamped `2026-09-27 23:59 Lagos`?" |
| **Product/service** | `product` (+ `direction`, `channel`) | `WALLET_TRANSFER`, `CASH_TO_WALLET`, `WALLET_TO_CASH`, `CASH_TO_CASH`, `CUSTOMER_FUNDING`, future `WALLET_TO_BANK`, `AIRTIME` etc. | "Does the 500k daily cap apply to wallet→wallet only or to all outgoing?" |
| **Principal segment** | `limit_profiles.code` + assignment (§13) | `KYC_LEVEL_1`, `AGENT_CLASS_A`, `VIP` — any code | "Does `VIP` have a higher monthly ceiling than `BASIC`?" |
| **Direction/channel** | `direction`, `channel` nullable | `OUTGOING` for W→W daily, `INCOMING` for funding daily, `USSD` vs `API` | "Is the daily *incoming* funding limit independent of daily *outgoing* transfer limit?" |

V1 must support **all five** (type × window × product × segment × direction) even if V1 initially configures only `MAX_AMOUNT_PER_TX`, `DAILY_AMOUNT`, `DAILY_COUNT`, `MONTHLY_AMOUNT` for the five V1 products on a single `NGN` currency. Weekly/yearly, count vs amount, channel, direction are schema-present but may have 0 rules until product configures them.

---

## 11. Amount vs Count Dimensions

**Distinct dimensions with distinct storage and distinct failure codes:**

| Dimension | Storage | Validation | Failure code | Do not confuse with |
|-----------|---------|------------|--------------|---------------------|
| `MIN_AMOUNT_PER_TX` | `limit_value_minor bigint` (e.g. 100 = 1.00 NGN) | `parsePositiveMinorUnits` → `>0`, checked `amountMinor < min → MIN_AMOUNT_NOT_MET` | `LIMIT_MIN_AMOUNT_NOT_MET` | minimum *fee* (fee engine’s `minimumFeeMinor` is a different domain) |
| `MAX_AMOUNT_PER_TX` | same | `amountMinor > max → SINGLE_TX_LIMIT_EXCEEDED` | `LIMIT_MAX_AMOUNT_EXCEEDED` | max *cumulative* daily |
| `DAILY/WEEKLY/MONTHLY/YEARLY_AMOUNT` | same | `(used_amount + amountMinor) > limit → AMOUNT_EXCEEDED` | `LIMIT_DAILY_AMOUNT_EXCEEDED` etc. | transaction count |
| `DAILY/WEEKLY/MONTHLY/YEARLY_COUNT` | `limit_value_count integer` (`0` disabled, `>0` ceiling) | `(usedCount + 1) > limit → COUNT_EXCEEDED` | `LIMIT_DAILY_COUNT_EXCEEDED` etc. | transaction amount |
| `WALLET_BALANCE_MAX` | same (amount) | `projectedBalance > max → WALLET_BALANCE_CEILING_EXCEEDED` — evaluated after amount/count checks, still inside same SERIALIZABLE tx | `LIMIT_WALLET_BALANCE_EXCEEDED` | daily amount |

Existing `CustomerLimitProfile.wallet_balance_minor` conflates "max balance" with "transaction amount" in a single table but the proposed model isolates it as its own `WALLET_BALANCE_MAX` row so evaluation can run `getAccountBalances` (ledger-derived) rather than mixing `walletBalanceMinor` into the same `dailyTransactionAmountMinor` column set.

**Unit:** All amount values are `minor units` strings (`bigint` via `parseMinorUnits`), currency-qualified. Count values are plain `integer` (monotonic `≥0`).

---

## 12. Product/Service Dimensions

**Product codes are data, not branching logic.** The repo already has two related enumerations:

* `QuotePaymentType` (`TRANSFER`, `DEPOSIT`, `WITHDRAWAL`) — used by `FeeEngine`/`LimitEngine` today.
* `PaymentType` / `PilotControl.capability/action/scope` (`wallet.transfer.create`, `agent.cash.in` etc.) — used by `TransferService`/`AgentFinancialExecutionService` provenance.

**Required product catalogue (decision, not invented here):**

| V1 product (authoritative code — product decision required, examples not binding) | Existing payment type(s) that map | Direction relevance | Notes |
|---|---|---|---|
| `WALLET_TRANSFER` | `QuotePaymentType.TRANSFER` | `OUTGOING` for source customer, `INCOMING` for dest customer (evaluate both sides; see §20) | primary customer path |
| `CASH_TO_WALLET` | `DEPOSIT` / `AgentService.CASH_IN` | `INCOMING` to customer wallet | agent deposits cash into customer |
| `WALLET_TO_CASH` | `WITHDRAWAL` / `AgentService.CASH_OUT` | `OUTGOING` from customer | customer → pool |
| `CASH_TO_CASH` | separate (`cash_to_cash_transfers`) — not a wallet product | `OUTGOING` for originating agent | 2-phase (init/claim/expiry) — limit applies to init amount and to claim by beneficiary-side agent (decisions separate) |
| `CUSTOMER_FUNDING` | (`customer_funding_requests`) | `INCOMING` to customer | maker/checker pool→wallet |
| `AGENT_FUNDING` / `AGENT_DEFUNDING` | (`agent_funding`) | `INCOMING`/`OUTGOING` for agent e-float | aggregator/agents funding-boundary |
| Future V2: `WALLET_TO_BANK`, `EXTERNAL_SETTLEMENT`, `AIRTIME`, `DATA`, `BILLS`, `BETTING`, `CARD_LOAD` etc. | TBD | `OUTGOING` for non-NGN etc. | **not required for V1 limit rules**, but schema must allow them (`product` unbounded varchar) |

**Where rules attach:** `limit_rules.product` is nullable only to mean "applies to all V1 products of this profile" only if product explicitly allows wildcard (prefer per-product rows; wildcard precedence decision deferred — see §15). Daily/monthly windows may be **per product** (each product has its own daily amount) or **per profile-aggregated** (all outgoing products share one daily budget) — product decision (see §28). The schema supports both by varying `product` specificity and by introducing an additional `aggregation_key` column if product wants aggregated daily limits later; V1 can ship per-product daily limits and document that aggregation is a future column.

**Channel/direction (evaluate §5 of task):** Required as nullable columns on `limit_rules` so a future `USSD` or `AGENT_APP` channel can have tighter daily count than `API` without a new migration. Direction (`INCOMING` vs `OUTGOING`) lets `CUSTOMER_FUNDING` (incoming) have a separate daily/monthly budget from `WALLET_TRANSFER` outgoing.

---

## 13. Assignment Model

**Problem with today:** `customer_limit_profiles.customer_id` directly glues one row to one customer (no reuse), and `agent_classes.applicable_limits` is opaque JSON on the class. There is no reusable profile and no override layer.

**Proposed:**

```
limit_profiles  ─── 1:n ──→  limit_rules (many rules per profile)

limit_assignments {
  id uuid PK
  principal_type varchar(20) CHECK IN ('CUSTOMER','AGENT','AGENT_CLASS','SEGMENT')
  principal_id uuid nullable  -- customers.id / agents.id / agent_classes.id / segment key
  segment_code varchar(80) nullable  -- for future KYC/segment types without a FK
  limit_profile_code varchar(80) FK → limit_profiles(code)
  precedence integer default 0  -- higher wins when multiple assignments resolve; see §15
  effective_from timestamptz NOT NULL DEFAULT NOW()
  effective_to timestamptz nullable CHECK > effective_from
  is_active boolean default true
  assigned_by varchar(160) NOT NULL
  created_at/updated_at/deleted_at
  UNIQUE WHERE deleted_at IS NULL (principal_type, principal_id, segment_code, effective_from)
}

limit_profile_bindings (optional V1.1, if hierarchy desired)
  { limit_profile_code FK, parent_profile_code FK nullable }
```

* **Customer:** assignment `principal_type=CUSTOMER`, `principal_id=customers.id` → `limit_profile_code = KYC_LEVEL_1` (for example, but `KYC_LEVEL_1` is just a code among many). A future `customer_kyc_levels` source table may drive *which* `limit_profile_code` a customer receives via a join, but the limit system never branches on `if (kycLevel === 1)` — it dereferences assignment.

* **Agent:** `principal_type=AGENT`, `principal_id=agents.id` → `limit_profile_code=AGENT_CLASS_A` or `VIP`. Agents have exactly one active assignment V1; multiple assignments futures use `precedence`.

* **Agent class (default):** `principal_type=AGENT_CLASS`, `principal_id=agent_classes.id` → `limit_profile_code` same as `agent_classes.code` by convention (seeded). This preserves existing `agent_classes.code` semantics while moving thresholds to `limit_rules`.

* **Individual override:** same tables with higher `precedence` (e.g. 100) for `principal_type=CUSTOMER` individual vs `principal_type=SEGMENT` segment-level.

* **Future customer segments:** `principal_type=SEGMENT`, `segment_code='KYC_LEVEL_1'` (or `RISK_TIER`, `COHORT` etc.) — assignment is via segment, not via hard column on customers.

**Arbitrary number:** The number of profiles is `SELECT COUNT(*) FROM limit_profiles`. No `tierCount = 3` constant exists. Creating `TIER_100` is `INSERT INTO limit_profiles VALUES ('TIER_100', ...)` followed by `INSERT INTO limit_rules` for that profile and an assignment row. No code change.

---

## 14. Arbitrary Profile/Tier Model

This section formalizes the clarification in the task: the domain term **"Tier" is not the correct permanent term** unless product chooses it; the permanent term is **Limit Profile**.

* Codes, names, hierarchy and assignment are **configurable rows**. Creating a new profile requires zero migration, zero deploy, zero `if` statement.

* No code path may contain `switch (tier)`, `tier === 1`, `Array.from({length: 3})`. Reviewers must reject such diffs. Instead:

  ```ts
  // ❌ forbidden
  if (customer.kycLevel === 1) { limit = 50_000_00 }
  else if (customer.kycLevel === 2) { limit = 500_000_00 }

  // ✅ required
  const assignment = await resolveLimitProfile(manager, customerId); // SELECT ... FROM limit_assignments WHERE principal_id=$1 AND is_active AND now BETWEEN effective_from AND COALESCE(effective_to,'infinity') ORDER BY precedence DESC LIMIT 1
  const rules = await findActiveRules(manager, assignment.limitProfileCode, product, dimension);
  ```

* Profile hierarchy (e.g. `Premium` includes `Standard` thresholds) is **not** implemented via `if` ladder but via `limit_profile_bindings` parent pointers or via rule inheritance at evaluation time (evaluator unions rules of profile + ancestors). V1 ships flat profiles; hierarchy is data future.

* Examples listed in the task (`KYC Level 1`, `Basic`, `Standard`, `Premium`, `VIP`, `Agent Class A`, `Tier 5/100`) are **illustrative — none is required**. The architecture supports all of them by being agnostic to naming convention.

* Existing term `CustomerLimitProfile` is **preserved** as legacy per-customer row, not repurposed as the generic profile. Generic is `limit_profiles`.

---

## 15. Precedence Model

When multiple assignments could apply to the same principal (e.g. a customer matches `segment_code='KYC_LEVEL_1'` *and* has a direct `CUSTOMER` override, or two `SEGMENT` assignments overlap calendar-wise), precedence determines the winning `limit_profile_code` and, within a profile, may determine which rule wins when rules overlap on `(product, dimension, effective window)`.

**Design — document, do not invent final policy:**

* **Assignment precedence:** `limit_assignments.precedence integer` higher wins; ties broken by `effective_from DESC` then `created_at DESC` (deterministic). The evaluator for a given `principalId` executes:
  ```sql
  SELECT limit_profile_code FROM limit_assignments
   WHERE is_active AND deleted_at IS NULL
     AND now() BETWEEN effective_from AND COALESCE(effective_to,'infinity')
     AND (principal_type='CUSTOMER' AND principal_id=$1 OR principal_type='SEGMENT' AND segment_code IN ($2,...))
   ORDER BY precedence DESC, effective_from DESC, created_at DESC LIMIT 1;
  ```
  V1 decision required: **most-specific wins** (`CUSTOMER` > `SEGMENT`) is a recommended default but must be approved as product policy. See §28.

* **Rule precedence within a profile:** V1 forbids overlap — `UNIQUE (profile_code, product, direction, channel, currency, dimension, effective_from)` means at any wall-clock time at most one active rule per key is found. If product later wants overlapping promo rules, a `priority` column would rank them (higher priority wins) and the evaluator would `ORDER BY priority DESC` and emit a diagnostic `LIMIT_RULE_OVERLAP` if >1 row is active. This is V2; mention as future column so the schema can add it without migration during V1.

* **Product precedence:** Wildcard `product IS NULL` (all products) vs explicit `WALLET_TRANSFER`: V1 avoids wildcards. If introduced, explicit product wins over wildcard for the same dimension.

* **Do not invent final precedence policy here.** The architecture must *persist* enough state (`precedence`, `effective_*`, `priority`) to *support* any policy product selects; §28 enumerates the decisions product must make before implementation.

---

## 16. Effective Dating/Versioning

Limits must be **historically interpretable**: after Admin changes a daily amount from 500k to 1M, yesterday’s `transfers` must still be explainable against the 500k rule.

**Existing version pattern reused:** `customer_limit_profiles.version` is optimistic locking for writes, not historical. `pilot_controls.version` likewise. The future must add **effective dating**:

* `limit_profiles.version` + `limit_rules.version`/`effectiveFrom`/`effectiveTo`/`isActive` per row.
* `effectiveFrom timestamptz NOT NULL DEFAULT NOW()` — beginning of inclusive window.
* `effectiveTo timestamptz nullable CHECK > effectiveFrom` — exclusive end; `NULL` means "until further notice".
* `future-dated rule` (`effectiveFrom > now()`) — created but not yet evaluated. Evaluator queries `WHERE effectiveFrom <= now() AND (effectiveTo IS NULL OR now() < effectiveTo) AND isActive`. A nightly job may *activate* future rules; no transaction-time race because evaluation happens inside the same `SERIALIZABLE` block that reads `now()` transaction time (`NOW()` from Postgres, not app clock).
* `soft delete` via `deleted_at` preserves history even after `isActive=false`.

**Snapshot (commercial decision) link (§22):** `commercial_decision_snapshot` must capture not only fee/commission/reward rule IDs but also `limitProfileCode` + `limitRuleIds[]` (or a denormalized copy of rule versions) so a historical transaction can be re-evaluated offline without joining to the *current* `limit_rules` table.

**Admin config UX:** "Change daily amount from 500k effective tomorrow 00:00 Lagos" → `INSERT INTO limit_rules (... effectiveFrom = '2026-09-28 00:00+01')` plus expiring the previous rule (`UPDATE ... SET effectiveTo='2026-09-28 00:00+01'`). Never `UPDATE limit_value_minor` in place without ending the prior window.

**Historical interpretation:** The **commercial decision snapshot** (immutable JSONB on the transaction or a joined `commercial_decisions` table) records the *used* rule versions; `limit_usages` must reference the snapshot, not the mutable rule.

---

## 17. Usage Tracking Model

**Why not `SUM(transfers)`:** Naive `SELECT SUM(amount_minor) FROM transfers WHERE customerId=$1 AND DATE(created_at)='2026-09-27'` at transaction time:

* Reads without `FOR UPDATE` → two concurrent transactions both see `used=400k`, each thinks 200k transfer fits into a 500k daily limit, both commit, daily used becomes 800k — **violated invariant** without a row lock.
* Scans millions of rows per transfer → slow, and cannot distinguish product/channel-specific windows vs aggregated.
* Cannot represent count windows (`DAILY_COUNT`) as rows vs amount via same query.
* Breaks for weekly/yearly semantics requiring `Lagos` day math.

**Required durable representation:** a separate **`limit_usages`** (also called `limit_reservations` until `postJournal` commits) that is **written before `postJournalInTransaction` inside the same `SERIALIZABLE` transaction and locked.**

```
limit_usages {
  id uuid PK
  principal_type varchar(20)  -- CUSTOMER/AGENT/AGENT_CLASS/SEGMENT mirror of assignment
  principal_id uuid
  limit_profile_code varchar(80) FK → limit_profiles(code)
  product varchar(80)  -- product code the usage tracks, e.g. WALLET_TRANSFER
  dimension varchar(40) -- DAILY_AMOUNT, WEEKLY_COUNT etc. (one row per dimension per window)
  currency varchar(3)
  window_key varchar(40)  -- canonical window identifier, e.g. '2026-09-27:DAILY:Africa/Lagos', '2026-W39:WEEKLY:Africa/Lagos'
  window_start timestamptz NOT NULL  -- inclusive Lagos window start truncated, stored as UTC
  window_end timestamptz NOT NULL    -- exclusive
  used_amount_minor bigint default 0
  used_count integer default 0
  version integer default 1
  created_at/updated_at timestamptz
  UNIQUE (principal_Type, principal_id, limit_profile_code, product, dimension, currency, window_key)
  INDEX (principal_id, product, dimension, window_start DESC)
}
```

**Semantics:**

* `used_amount_minor` tracks *total minor units* consumed in that window for `*_AMOUNT` dimensions. `used_count` tracks `*_COUNT` dimensions. One row per window per dimension — `DAILY_AMOUNT` and `DAILY_COUNT` are separate rows (or same row with both counters, but separate simplifies locking).
* `window_key` is deterministic from `(now Lagos, dimension)`: `YYYY-MM-DD` for daily, `YYYY-Www` for weekly (Monday-start, see §19), `YYYY-MM` for monthly, `YYYY` for yearly. It is the **idempotency/window identity**, not `created_at`.
* Updated **incrementally**: `UPDATE limit_usages SET used_amount_minor = used_amount_minor + $amount, used_count = used_count + 1 WHERE ... RETURNING ...` under `SELECT FOR UPDATE` (or via `INSERT ... ON CONFLICT ... DO UPDATE` with lock). Never computed via `SUM` at commit time (only periodically reconciled offline via a job that `SUM`s ledger lines and compares to `limit_usages` for drift detection, emitting `LIMIT_DRIFT` audit).

**Relation to ledger:** `limit_usages` is **pre-journal reservation** inside the same Postgres transaction as the transfer. If the transaction aborts (`PILOT_AMOUNT_*`, authorization failure, etc.), the `UPDATE` rolls back with it. `limit_usages` rows are never written without a companion ledger journal for a given successful transaction.

**Alternative considered but rejected:** Using `ledger_lines` as usage store — ledger lines already exist but represent *accounting entries*, not *limit consumption* (which may not map 1:1 to debited account lines, especially for `WALLET_BALANCE_MAX` and for transactions that debit `pool` but should count against the customer’s daily budget).

---

## 18. Concurrency/Idempotency Model

### 18.1 Required isolation

All five V1 monetary flows already wrap `executeWithinTransaction` in `dataSource.transaction('SERIALIZABLE')` with an up-to-2 retry loop on `SERIALIZATION_FAILURE` (`SQLSTATE 40001` / `40P01`). The limit design reuses this pattern verbatim.

**Inside the transaction, evaluation order must be reservation-first:**

```
1. idempotency guard
     SELECT * FROM transfers WHERE idempotencyKey=$1 -- pessimistic read
     if (found && requestHash !== $hash) -> 409
     if (found) -> return existing (REPLAY, no limit consumption)
     // also reserve IdempotencyService idempotency_records with pessimistic_write
2. resolve assignment
     SELECT ... FROM limit_assignments WHERE ... ORDER BY precedence DESC LIMIT 1
     -- lock via SELECT ... FOR UPDATE if row is hot (optional, but assignment rarely contested)
3. load active rules
     SELECT * FROM limit_rules WHERE limit_profile_code=$profile AND product IN ($product,'*') AND dimension IN (...)
       AND effectiveFrom <= now() AND (effectiveTo IS NULL OR now() < effectiveTo) AND isActive
4. lock usage rows (the critical serialization point)
     SELECT * FROM limit_usages
      WHERE principal_type=$principalType AND principal_id=$principalId
        AND product=$product AND dimension IN (DAILY_AMOUNT, DAILY_COUNT, ...)
        AND window_key IN ($todayDaily, $thisWeek, $thisMonth, $thisYear)
      FOR UPDATE
     -- if rows missing, INSERT with (used=0) then SELECT FOR UPDATE via ON CONFLICT DO NOTHING
5. evaluate
     for each rule: check amountMinor against MIN/MAX, then (used+amount) against DAILY/WEEKLY/...
     if any rule would be exceeded → mark Failed / throw TransferFailureCode.LIMIT_EXCEEDED (see §21) and roll back (no usage increment)
6. reserve usage
     UPDATE limit_usages SET used_amount_minor = used_amount_minor + $amount, used_count = used_count + 1
      WHERE id IN (...);   -- still inside FOR UPDATE lock
7. lock wallets
     SELECT ... FROM wallet_accounts WHERE id IN (...) FOR UPDATE   -- existing deterministic order
8. postJournalInTransaction(manager, {idempotencyKey: 'transfer:<id>', lines: [DEBIT source, CREDIT dest]})
9. insert commercialDecisionSnapshot (see §22)
10. audit + outbox
```

**Why `FOR UPDATE` on `limit_usages`:** Two concurrent W→W transfers for the same customer sharing a 500k daily amount bucket would each try to `UPDATE limit_usages SET used_amount_minor = used_amount_minor + 200k` after both did `SELECT FOR UPDATE` — second waits for first’s commit, then sees first’s `used=200k`, correctly computes `(200k+200k)=400k` fitting, rather than both seeing `(0+200k)` and double-committing to 400k unserialized. Without `FOR UPDATE`, `SERIALIZABLE` alone may retry one transaction via `SQLSTATE 40001`, but combining `FOR UPDATE` + `SERIALIZABLE` yields both correctness and better throughput (fewer retries) for this hot row.

**Why not `SUM(existing transactions)`:** See §17 (race). Even with `SERIALIZABLE`, `SUM(transfers)` per transaction would scan and repeat-read many rows, causing high serialization failure rate and abandoning the already-proven `limit_usages` hot-row optimization. `SUM` remains as a **reconciliation** off-path check, not as the transaction-time guard.

### 18.2 Idempotency replay

`TransferService.createTransfer` already does a pre-transaction `findOne({idempotencyKey})` and an in-transaction re-check, plus `requestHash` equality. This must remain **before** any `limit_usages` reservation. A replay with the same `idempotencyKey` + `requestHash` returns the original result (`status COMPLETED/FAILED`) without consuming additional daily limit budget. A replay with the same key but different `amountMinor`/destination/wallet must return `409 Idempotency key already used for another request` without consuming budget or creating a second journal (existing behavior).

`AgentCashIn/CashOut/CashToCash/Claim`, `CustomerFundingService.approve` follow identical pre-checks.

### 18.3 Race conditions addressed

* **Double spend on same daily budget:** `SELECT FOR UPDATE` on `limit_usages` per window serializes concurrent increments (see 18.1).
* **Balance double-spend:** Already serialized via `lockWallets(... FOR UPDATE)` + ledger line sums; limit serialization is orthogonal but same pattern.
* **Profile change mid-transaction:** `limit_assignments` lookup happens at transaction start inside the same tx snapshot; if Admin changes assignment between `BEGIN` and `COMMIT`, the in-flight tx uses the prior assignment (repeatable read via `SERIALIZABLE` snapshot). No phantom due to predicate lock (or retry on serialization failure).
* **Future-dated rule activation at exact second:** `effectiveFrom <= now()` uses `NOW()` transaction time (Postgres), not app `Date.now()`, so two concurrent txs starting at `23:59:59.900 Lagos` see consistent `now()` within their snapshot.

### 18.4 Ledger double-spend analogy

The limit system **mirrors** the ledger double-spend guarantee: just as two concurrent transfers that both pass `balance - amount >= 0` would be serialized via wallet `FOR UPDATE` + `SERIALIZABLE`, two transfers that both pass `dailyUsed + amount <= dailyLimit` are serialized via `limit_usages FOR UPDATE` + `SERIALIZABLE`. No new pattern is invented.

---

## 19. Time-Window Model

### 19.1 Lagos timezone — repository convention

* Existing docs repeatedly state **Africa/Lagos** as the business day timezone (pilot, funding windows, hardening reports). Code today often uses `TIMESTAMPTZ` and `NOW()` without explicit timezone conversion; audit confirms `pilot_controls` daily logic compared `amount`-only without a Lagos truncation (it counted transfers for the *server* day). The limit architecture **must** fix this and document `Africa/Lagos` as normative.

* **Storage is UTC** (`timestamptz`), **window computation is Lagos**. The canonical conversion is `AT TIME ZONE 'Africa/Lagos'` in SQL or an equivalent `luxon` `DateTime.setZone('Africa/Lagos')` in TypeScript per service (must match). `window_start` stored as `timestamptz` that is the UTC instant corresponding to `00:00:00` Lagos for that window.

### 19.2 Window definitions (per `dimension`)

| Window | Key example (`Africa/Lagos`) | `window_start` (UTC) | `window_end` (UTC) | Usages |
|--------|------------------------------|----------------------|---------------------|--------|
| `DAILY` | `2026-09-27:DAILY:Africa/Lagos` = `2026-09-27 00:00 Lagos` → `2026-09-26T23:00:00.000Z` | truncate to `00:00 Lagos` | `+1 day` | via `limit_usages.window_start/window_end` `used_amount/daily` |
| `WEEKLY` | `2026-W39:WEEKLY:Africa/Lagos` (Monday-start ISO week) | Monday `00:00 Lagos` | `+7 days` | `weekly_amount`, `weekly_count` |
| `MONTHLY` | `2026-09:MONTHLY:Africa/Lagos` | 1st `00:00 Lagos` | `+1 month` (variable length) | `monthly_amount`, `monthly_count` |
| `YEARLY` | `2026:YEARLY:Africa/Lagos` | Jan 1 `00:00 Lagos` | `+1 year` | `yearly_amount`, `yearly_count` |

* **Weekly definition must be fixed** as a product decision before implementation: Monday-start ISO week (recommended, matches NIBSS reporting) vs Sunday-start. This document records the requirement; value not invented (see §28).

* **Month:** calendar month in Lagos, not rolling 30 days.

* **Year:** calendar year in Lagos.

* **Daylight handling:** Africa/Lagos has **no DST** (UTC+1 year-round), so start/end conversions are deterministic (+1 hour). This nuance must be logged but does not change the design.

* **Validation:** Usage rows are looked up by `(principal, product, dimension, window_key)` and locked; new windows auto-insert with `(used=0)` on first transaction of that window.

---

## 20. Limit Evaluation Lifecycle

**Per-transaction evaluation lifecycle (inside `SERIALIZABLE`):**

```mermaid
idempotency replay? ──yes──→ return prior result (no limit consumption)
        no
        ▼
resolve limit profile assignment (precedence order)
  └─ no active assignment? ──→ decision code LIMITED_PROFILE_MISSING (§21) — fail closed
        found
        ▼
load active rules for (profileCode, product, direction, channel, currency) where now BETWEEN effectiveFrom/effectiveTo
  └─ no rules for requested dimension? ──→ dimension treated as UNLIMITED (no check), not as 0
        rules
        ▼
lock usage rows FOR UPDATE for each window (daily/weekly/monthly/yearly) for each dimension that has a rule
        ▼
evaluate per-dimension in fixed order (fail-fast but collect all reasons):
  1. MIN_AMOUNT_PER_TX:  amountMinor < min  → LIMIT_MIN_AMOUNT_NOT_MET
  2. MAX_AMOUNT_PER_TX:  amountMinor > max  → LIMIT_MAX_AMOUNT_EXCEEDED
  3. WALLET_BALANCE_MAX: projectedBalanceAfterPost > walletBalanceMinor → LIMIT_WALLET_BALANCE_EXCEEDED
  4. *_AMOUNT windows: usedAmount + amountMinor > daily/weekly/monthly/yearly amount limit → LIMIT_*_AMOUNT_EXCEEDED
  5. *_COUNT windows: usedCount + 1 > daily/weekly/monthly/yearly count limit → LIMIT_*_COUNT_EXCEEDED
        any reasons non-empty
        ▼
     fail closed: mark transfer FAILED with failureCode=limitExceeded variant (see §21),
     do NOT increment limit_usages, do NOT post journal, create commercial decision snapshot marking limitDecision=REJECTED
        no reasons
        ▼
     reserve: UPDATE limit_usages (used_amount += amount, used_count +=1)
     lock wallets, postJournalInTransaction, transition transfer to COMPLETED,
     create commercial decision snapshot marking limitDecision=APPROVED (+ snapshot of rule versions/used before/after)
```

**Step 1 (idempotency) before step 4 (lock) is deliberate:** replays never touch usage counters, never hold locks.

**Step 4 `FOR UPDATE` before step 5 (evaluate) ensures the snapshot of `used*` is locked. Step 6 (reserve) stays under the same lock; wallet locking follows (deterministic order across services to avoid deadlock — always `limit_usages` → `wallet_accounts` → `ledger_journals`).**

**`transfer` entity status for limit failure:** See §21 failure semantics — limit exceeded is a `COMPLETED FAILED` transfer with `failureCode=LIMIT_EXCEEDED_*` (or `TransferFailureCode.LIMIT_EXCEEDED` umbrella), not a thrown exception that leaves no durable row (existing failed transfers already do `markFailed` inside the tx, then `toFailureException` at the edge).

---

## 21. Failure Semantics

### 21.1 Required refusal reasons (typed, not free-text)

Every limit path must emit a structured `TransferFailureCode` (or shared `LimitFailureCode`):

| Reason | When | HTTP mapping | Durable transfer status |
|--------|------|--------------|--------------------------|
| `LIMIT_MIN_AMOUNT_NOT_MET` | `amountMinor < limit_rules.limit_value_minor` where `dimension=MIN_AMOUNT_PER_TX` | `400 Bad Request` (or `422 Unprocessable` per existing failed-transfer pattern) — via `markFailed` | `FAILED failureCode=LIMIT_MIN_AMOUNT_NOT_MET failureStatusCode=400/422` |
| `LIMIT_MAX_AMOUNT_EXCEEDED` | `amountMinor > MAX_AMOUNT_PER_TX` | same | `FAILED` |
| `LIMIT_DAILY_AMOUNT_EXCEEDED` / `WEEKLY/MONTHLY/YEARLY_AMOUNT_EXCEEDED` | `(usedAmount + amountMinor) > limit` | same | `FAILED` |
| `LIMIT_DAILY_COUNT_EXCEEDED` / `WEEKLY/MONTHLY/YEARLY_COUNT_EXCEEDED` | `(usedCount + 1) > limit` | same | `FAILED` |
| `LIMIT_WALLET_BALANCE_EXCEEDED` | `projectedBalance > WALLET_BALANCE_MAX` | same | `FAILED` |
| `LIMIT_PROFILE_MISSING` | no active `limit_assignments` for principal | **500/409** *config error* — operator, not caller — but mapped as `FAILED` with distinct code so ops can alarm on misconfiguration without implying caller fault; alternatively `503 Configuration unavailable` if product chooses open-world. See §28. | `FAILED failureCode=LIMIT_PROFILE_MISSING` |
| `LIMIT_RULE_INVALID` | rule row is malformed (e.g. `limit_value_minor` > `MAX_POSTGRES_BIGINT`, overlapping active rows for same key) | `500` config error, alarm; transfer `FAILED` | `FAILED` |
| `LIMIT_RULE_DISABLED` | active rule `isActive=false` or `now()` outside `[effectiveFrom, effectiveTo]` | treated as condition absent — no check vs this rule | no failure (rule ignored) |
| `LIMIT_RULE_EXPIRED` | `now() >= effectiveTo` | rule is past end, treated as absent | no failure |

**Minimum transaction amount is not a fee.** `MIN_AMOUNT_PER_TX` failure is never called `minimumFeeMinor` — fees have their own validation (`feeMinor >= minimumFeeMinor` inside `FeeEngine`).

### 21.2 Invalid configuration vs missing profile

* Missing profile for a newly-onboarded customer with no assignment must **fail closed** (or be auto-assigned to a default profile — product decision, see §28). The evaluator must emit `LIMIT_PROFILE_MISSING` rather than treating "no limits" as "unlimited for all windows" (which would silently allow unbounded transfers after a bad seed).

* Invalid configuration (e.g. two active rules for `('KYC_LEVEL_1','WALLET_TRANSFER','DAILY_AMOUNT')` with overlapping windows, or `limit_value_minor` parsed `> MAX_POSTGRES_BIGINT`) must be **detected at rule load time** inside the tx and produce `LIMIT_RULE_INVALID` plus an `audit_events` warning, then fail the transaction. It must never be served as `SELECT LIMIT 1` and ignore the duplicate.

### 21.3 Expired / future-dated / disabled rules

* A rule with `effectiveTo <= now()` is **past** — ignore (do not apply to new txs; historical txs remain interpretable via snapshot).
* A rule with `effectiveFrom > now()` is **future** — ignore until activation.
* A row with `isActive=false` or `deleted_at IS NOT NULL` is disabled — ignore.
* Transitions must be via **ending the old window** (`effectiveTo = newRule.effectiveFrom`) and inserting the new row, not in-place mutation without dating (preserves historical interpretability).

### 21.4 Conflicting rules

If strictly no two active rules share the same `(profile, product, dimension, window)` key, there is **no conflict** — unambiguous. If overlap is later allowed (priority-based), the evaluator must detect `count(active rows for key) > 1` and apply `priority DESC` or emit `LIMIT_RULE_CONFLICT` and fail closed (product decision). Either way, "last write wins" is not an architecture.

---

## 22. Commercial Engine Integration

**Conceptual separation, operational co-participation.**

Limits evaluate *whether* a transaction is permitted. Fees/commissions/rewards evaluate *how much* the transaction *costs/earns* once permitted. They are computed via different engines and against different tables, but they belong to the **same authoritative commercial decision** that is **snapshot** with the transaction — so changing a fee rule tomorrow does not retroactively change yesterday’s settlement amount or limit consumption.

### 22.1 Existing commercial primitives

* `FeeEngine.calculate` — flat + percentage + VAT, `MAX_POSTGRES_BIGINT` guard.
* No durable `fee_rules` table (only transient `FeeRule` type); no `commission`/`reward` entities.
* `limit_usages` (§17) is per-principal per-window usage.
* Capability `COMMERCIAL_DECISION_SNAPSHOT PLANNED` correctly describes the missing artifact.

### 22.2 Required snapshot

```sql
commercial_decisions {
  id uuid PK
  entity_type varchar(80) -- TRANSFER, CASH_IN, CASH_OUT, CASH_TO_CASH, FUNDING etc.
  entity_id uuid FK → transfers/cash_to_cash_transfers/customer_funding_requests
  correlation_id varchar(160), request_id ...
  currency varchar(3)
  product varchar(80)  -- canonical V1 product code (see §12)
  -- limit side
  limit_profile_code varchar(80) nullable, limit_profile_version integer,
  limit_rule_ids uuid[] nullable, limit_rule_versions jsonb, -- [{id,v,dimension,limitValue}]
  limit_decision varchar(20) CHECK IN ('APPROVED','REJECTED','NOT_APPLICABLE')
  limit_failure_codes text[] nullable,
  limit_used_before jsonb, limit_used_after jsonb, -- {dailyAmount:"...", dailyCount:..} per window
  -- fee/commission/reward side (filled after limit approval)
  fee_rule_ids uuid[] nullable, fee_rule_versions jsonb,
  fee_calculation jsonb nullable, -- FeeCalculation (paymentType,currency,amount,fee,vat,total)
  commission_rule_ids uuid[] nullable, commission_allocation jsonb nullable,
  reward_rule_ids uuid[] nullable,
  -- ledger linkage
  ledger_entry_ref varchar(80) nullable, -- references ledger_journals.id (journal code)
  -- product mapping
  product_ledger_mapping_version integer nullable
  created_at timestamptz default now()
  UNIQUE (entity_type, entity_id)
}
```

*Or* as immutable JSONB on the transaction entity (`transfers.commercial_decision jsonb`), but a dedicated `commercial_decisions` join preserves audit queries without parsing transfer JSON.

### 22.3 Evaluation order

```
1. limit evaluation (quota — is transaction within daily/weekly budget?)
2. if REJECTED → snapshot {limitDecision=REJECTED, limitFailureCodes=[...]} with no fee/commission/reward, transaction FAILED, no ledger journal
3. if APPROVED → fee calculation (FeeEngine with rule for product/principal/profile) → commission allocation → reward eligibility
4. snapshot {limitDecision=APPROVED, feeCalculation={feeMinor,vatMinor}, ...} together
5. ledger post (principal amount + fee + vat ± commissions/rewards as configured)
```

**Fee vs limit separation:** `LimitEngine` reasoning (`DAILY_AMOUNT_EXCEEDED`) is never collapsed into `FeeEngine` reasoning (`minimumFeeMinor`), and `limit_decision` is stored in its own fields, not encoded as a fee. They share the same `commercial_decisions` row for gear-level traceability, not shared logic.

### 22.4 Product catalogue & product ledger mappings

Product catalogue (`products.code`) is the authoritative join key for both `limit_rules.product` and `fee_rules.product`. `product_ledger_mappings` (PLANNED) routes `product` → pair of `ledger_account.code` (revenue/liability) but **limit windows do not route to ledger accounts** — limit consumption is a logical quota, not a balance.

---

## 23. Admin Configuration Requirements

Reuse the existing admin pattern (`pilot_controls`, `customer_limit_profiles`): **workforce-only** (`WORKFORCE_SESSION` `OPERATOR/SERVICE/PRIVILEGED` + maker-checker where appropriate), `SERIALIZABLE`, `IdempotencyService`, `version` optimistic lock, `audit_events`, `correlationId/requestId`. Capability `ADMIN_AUTHZ` is prescriptive; `ADMIN_*` routes carry `customerAccess NONE agentAccess NONE`.

### 23.1 Required admin surfaces (proposed, not yet implemented)

| Surface | Method & Path (proposed) | Who | What | Idempotency | Audit |
|---------|--------------------------|-----|------|-------------|-------|
| List limit profiles | `GET /internal/limit-profiles` | `SUPPORT,OPERATOR,SERVICE,PRIVILEGED` | filters `kind,isActive`, pagination deterministic `ORDER BY code ASC` | none | none |
| Create limit profile | `POST /internal/limit-profiles` | `OPERATOR/SERVICE/PRIVILEGED` (maker) | `code,name,kind,description` + `idempotencyKey, requestHash` | `scope='limit:profile:create'` | `audit_events entityType LIMIT_PROFILE` |
| Get profile | `GET /internal/limit-profiles/:code` | same 4 | single profile | — | — |
| Update profile (disable/rename) | `PATCH /internal/limit-profiles/:code` | `OPERATOR/SERVICE/PRIVILEGED` + `If-Match: version` | rename/disable, not retroactive | same | audit diff |
| List rules | `GET /internal/limit-profiles/:code/rules` | workforce 4 | filters `product/dimension/effectiveFrom` | — | — |
| Create rule | `POST /internal/limit-profiles/:code/rules` | `OPERATOR/SERVICE/PRIVILEGED` + `version` check | `product,dimension,limitValue, currency, effectiveFrom/To` | `scope='limit:rule:create'` | audit |
| Deactivate rule / set effectiveTo | `PATCH /internal/limit-rules/:id` | same | window edit | same | audit |
| Assign profile to principal | `POST /internal/limit-assignments` | same maker/checker | `principalType, principalId/segmentCode, limitProfileCode, precedence, effectiveFrom/To` | `scope='limit:assignment:create'` | audit |
| List assignments | `GET /internal/limit-assignments?principalType=CUSTOMER&principalId=...` | workforce 4 | current assignment resolution | — | — |
| Preview evaluation | `POST /internal/limit-profiles/:code/preview-evaluate` | workforce 4 | dry-run `amount/product` with current rules (no usage reservation) | none | none |
| **Limit diagnostics** (read-only mirror of notification diagnostics) | `GET /internal/limit-usages?principalId=...&windowKey=...` | `SUPPORT` allowed, safe projection (no hash/secret) | filtered usages for 360° investigation | — | — |

### 23.2 Relation to existing Admin 360° investigation

`GET /internal/customers/:id/wallets/:walletId/balance` (ledger-derived) and `…/transactions` return ledger entries today. A future `GET /internal/customers/:id/limit-status` (or extending the existing balance response with `limitRemainingDaily`) can expose `usedAmount/usedCount` + `remaining*` derived from `limit_usages` without leaking rule internal IDs; but exposing full rule thresholds to Customer App is **not** required V1 (see §24).

### 23.3 No ledger account exposure

Limit config never requires creating `limit_pool` ledger accounts. Limits are quota, not funds. Admin UX must not ask operators to choose `ledger_account_id` when configuring a limit rule.

---

## 24. Customer/Agent Exposure Requirements

### 24.1 What customers/agents see today

* Today customers see **no limit** — transfers succeed until `INSUFFICIENT_FUNDS`. Agents see no `applicable_limits` UI. Customer `POST /customers/me/transfers` returns `201` or `409 INSUFFICIENT_FUNDS` / `401 PIN_INVALID`; no `LIMIT_EXCEEDED`.

### 24.2 What must remain hidden

* Exact thresholds of other profiles (`VIP` daily limit not enumerable by `Basic`), rule `effectiveFrom/To` history, internal `limit_usages` row IDs, `limitProfileCode` assignment internals. The safe projection rule that hides `password/pinHash/tokenHash/ledgerAccountId` for wallets/beneficiaries applies here: limit responses must not leak other-tenant config.

### 24.3 What may be exposed (V1.1 product decision)

* On `POST /customers/me/transfers` returning `FAILED LIMIT_DAILY_AMOUNT_EXCEEDED`, the response should include a **user-facing reason** (`"You have reached your daily transfer limit — try again tomorrow"`) and optionally `remainingDailyMinor`/`retryAfterWindow` (Lagos window reset), but never the raw rule `limitValue` of another profile.

* On `GET /customers/me/limits` (future) — if shipped — a customer sees **only their own** effective limits: `{ product: WALLET_TRANSFER, dimension: DAILY_AMOUNT, limit, used, remaining, windowKey }`. This surface is `CUSTOMER_LOGIN` scoped (`customerAccess SELF`), not `WORKFORCE_SESSION`. Implement only when product approves.

* Agent exposure is symmetrical: `GET /agents/me/limits` (future) returns agent’s effective limits, `AGENT_LOGIN` `agentAccess SELF`.

* V1 keeps **no** customer/agent limit UI — limits are backend-only quotas. The `customerUiStatus=NOT_EXPOSED` / `agentUiStatus=NOT_EXPOSED` in capability seed remains accurate for V1.

---

## 25. Database/Migration Considerations

### 25.1 Existing tables — no destructive change

* Leave `customer_limit_profiles`, `agent_classes.applicable_limits`, `pilot_controls` **intact** (no `DROP COLUMN`). Future migrations are **additive**: new tables `limit_profiles`, `limit_rules`, `limit_assignments`, `limit_usages`, `commercial_decisions` (or `limit_decisions`), plus indexes and checks. No rewrites of `transfers`/`ledger_journals`.

* All new monetary columns are `bigint` via `bigintTransformer` with `CHECK >=0` and `CHECK <= 9223372036854775807` guard (via app `MAX_POSTGRES_BIGINT`). No floating point. `currency varchar(3) CHECK ^[A-Z]{3}$` retained.

### 25.2 Proposed new tables (illustrative DDL shape — not executed this task)

```sql
CREATE TABLE limit_profiles (
  code VARCHAR(80) PRIMARY KEY,  -- LIMIT_PROFILE_CODE_PATTERN
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('CUSTOMER','AGENT','SYSTEM','UNIVERSAL')),
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_limit_profiles_active_code ON limit_profiles(code) WHERE deleted_at IS NULL;

CREATE TABLE limit_rules (
  id UUID PRIMARY KEY,
  limit_profile_code VARCHAR(80) NOT NULL REFERENCES limit_profiles(code) ON DELETE RESTRICT,
  product VARCHAR(80) NOT NULL,
  direction VARCHAR(20) CHECK (direction IN ('INCOMING','OUTGOING','BOTH')),
  channel VARCHAR(30),
  currency VARCHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  dimension VARCHAR(40) NOT NULL CHECK (dimension IN ('MIN_AMOUNT_PER_TX','MAX_AMOUNT_PER_TX','DAILY_AMOUNT','WEEKLY_AMOUNT','MONTHLY_AMOUNT','YEARLY_AMOUNT','DAILY_COUNT','WEEKLY_COUNT','MONTHLY_COUNT','YEARLY_COUNT','WALLET_BALANCE_MAX')),
  limit_value_minor BIGINT CHECK (limit_value_minor >=0),       -- for amount/balance
  limit_value_count INTEGER CHECK (limit_value_count >=0),       -- for count
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ CHECK (effective_to IS NULL OR effective_to > effective_from),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(160) NOT NULL,
  created_at/updated_at/deleted_at
);
CREATE UNIQUE INDEX uq_limit_rules_active_key ON limit_rules
  (limit_profile_code, product, COALESCE(direction,'BOTH'), COALESCE(channel,''), currency, dimension, effective_from)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_limit_rules_profile_effective ON limit_rules(limit_profile_code, effective_from, effective_to) WHERE deleted_at IS NULL;

CREATE TABLE limit_assignments (
  id UUID PRIMARY KEY,
  principal_type VARCHAR(20) NOT NULL CHECK (principal_type IN ('CUSTOMER','AGENT','AGENT_CLASS','SEGMENT')),
  principal_id UUID,  -- FK nullable, CHECK via application; segment uses segment_code instead
  segment_code VARCHAR(80),
  limit_profile_code VARCHAR(80) NOT NULL REFERENCES limit_profiles(code) ON DELETE RESTRICT,
  precedence INTEGER NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ CHECK (effective_to IS NULL OR effective_to > effective_from),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by VARCHAR(160) NOT NULL,
  created_at/updated_at/deleted_at
);
CREATE INDEX idx_limit_assignments_principal ON limit_assignments(principal_type, principal_id, is_active, effective_from);
CREATE INDEX idx_limit_assignments_segment ON limit_assignments(segment_code, is_active);

CREATE TABLE limit_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type VARCHAR(20) NOT NULL,
  principal_id UUID NOT NULL,
  limit_profile_code VARCHAR(80) NOT NULL,
  product VARCHAR(80) NOT NULL,
  dimension VARCHAR(40) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  window_key VARCHAR(80) NOT NULL,  -- e.g. 2026-09-27:DAILY:Africa/Lagos
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL CHECK (window_end > window_start),
  used_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (used_amount_minor >=0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >=0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at/updated_at
);
CREATE UNIQUE INDEX uq_limit_usages_window ON limit_usages(principal_type, principal_id, limit_profile_code, product, dimension, currency, window_key) WHERE window_key IS NOT NULL;
CREATE INDEX idx_limit_usages_principal_window ON limit_usages(principal_id, product, dimension, window_start DESC);

CREATE TABLE commercial_decisions (
  id UUID PRIMARY KEY,
  entity_type VARCHAR(80) NOT NULL, entity_id UUID NOT NULL,
  currency VARCHAR(3) NOT NULL, product VARCHAR(80) NOT NULL,
  limit_profile_code VARCHAR(80), limit_rule_ids UUID[], limit_rule_versions JSONB,
  limit_decision VARCHAR(20) CHECK (limit_decision IN ('APPROVED','REJECTED','NOT_APPLICABLE')),
  limit_failure_codes TEXT[], limit_used_before JSONB, limit_used_after JSONB,
  fee_rule_ids UUID[], fee_calculation JSONB,
  commission_rule_ids UUID[], commission_allocation JSONB,
  reward_rule_ids UUID[],
  ledger_journal_id UUID REFERENCES ledger_journals(id) ON DELETE SET NULL,
  correlation_id VARCHAR(160), request_id VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, entity_id)
);
```

### 25.3 Idempotent seeding

Seed `limit_profiles` with examples (not authoritative thresholds) only as `NOT_CONFIGURED` rows if product wants a starter set; seeding must be idempotent `ON CONFLICT (code) DO NOTHING`.

### 25.4 No migration this task

This audit ships **0 migrations**. The shapes above are the *recommended next* migration (`NEXT-1785753600067-CreateLimitProfilesAndRules`), not this commit.

---

## 26. Test Strategy

### 26.1 Existing tests (preserved)

* `test/limit.engine.spec.ts` — pure `evaluate` with three reasons, `remaining*` arithmetic; `test/limit.engine.constants.spec.ts` — constants; no PG. Keep.

* `test/customer-eligibility*`, `test/a10-agent-service-capability*` — verify legacy `customer_limit_profiles`/`agent_classes.applicable_limits` CRUD with `version`, `uq_customer_limit_profiles_active_customer`, audit. Keep.

### 26.2 Required future tests — run against **real PostgreSQL** (`jest.integration.config.js`, `createIntegrationDataSource`, no mocks, loud failure if server unavailable)

| Category | Required assertions | Example file |
|----------|---------------------|--------------|
| **Profile rule CRUD** | create/read/update/disable per `dimension`, `effectiveFrom/To` windows, `version` conflict 409, soft-delete, duplicate `UNIQUE` rejection | `limit-profile.integration.spec.ts` |
| **Assignment precedence** | two overlapping segment assignments for same customer: higher `precedence` wins; tie `effectiveFrom DESC` wins; query resolution inside tx snapshot | `limit-assignment.integration.spec.ts` |
| **Per-transaction limit evaluation** | amount < `MIN` → 400, amount > `MAX` → 400, `WALLET_BALANCE_MAX` projected → 400, each dimension isolated | `limit-evaluation-basic.integration.spec.ts` |
| **Accumulation + window** | daily/weekly/monthly/yearly amount & count — Lagos windows (day `00:00 Lagos` → UTC, week Monday, month calendar, year calendar); window rollover; month length | `limit-usage-window.integration.spec.ts` |
| **Concurrency (mandatory)** | two concurrent `POST /customers/me/transfers` sharing the same daily amount budget (both 300k into a 500k cap) — only one succeeds; other returns `FAILED LIMIT_DAILY_AMOUNT_EXCEEDED`; no double reservation, `limit_usages` row `FOR UPDATE` verified via `SELECT ... FOR UPDATE` count; plus 3-way concurrency, re-entrant via `SERIALIZABLE` retry | `limit-concurrency.integration.spec.ts` (real PG, `runInBand` not mocked) |
| **Idempotency replay** | same `Idempotency-Key` + `requestHash` → replay returns `COMPLETED` without consuming second daily budget; same key but different `amountMinor` → `409` without consuming | `limit-idempotency.integration.spec.ts` |
| **Reversal compensation** | if a `FAILED` transfer consumed no usage, verify no compensation row; if a `COMPLETED` transfer is reversed via future `reversal` flow, verify `limit_usages` decrement is product-decision gated (either refund window or not) | `limit-reversal.integration.spec.ts` (V2 if reversal not shipped) |
| **Snapshot immutability** | change rule 500k→1M after transfer `T` at 500k; re-read `commercial_decisions` for `T` still shows old 500k `limitRuleVersions`; re-evaluation of `T` still REJECTED if it was REJECTED | `commercial-decision-snapshot.integration.spec.ts` |
| **Product/channel dimensions** | `WALLET_TRANSFER` vs `CASH_TO_WALLET` separate daily budgets vs shared (depending on rule rows); `USSD` vs `API` channel separation | `limit-product-dimension.integration.spec.ts` |
| **Minimal fee confusion** | `MIN_AMOUNT_PER_TX` rejected at 99 vs successful at 100, distinct from `fee.minimumFeeMinor` rejection | `limit-min-amount.integration.spec.ts` |

**Do NOT use `SUM(transfers)` as the primary check** in tests (only as reconciliation-secondary). Assert `SELECT ... FROM limit_usages WHERE window_key = ... FOR UPDATE` count.

**Unit for remaining*:** `remainingDailyMinor = max(0, dailyLimit - (dailyUsed + amountMinor))` string-typed.

### 26.3 Safe projection & leak tests

All limit admin surfaces must be tested for `expect(JSON.stringify(res.body).toLowerCase()).not.toContain('password'/'pinhash'/'tokenhash'/'ledgeraccountid')` + specific leak of other profiles' thresholds.

### 26.4 Regression

All limit changes must be run with full financial regression: `npm run test:pg` includes `a13-agent-cash-in`, `a14-cash-out`, `a15-cash-to-cash`, `a25-customer-history`, `v1-001-customer-funding`, `v1-hardening-01-beneficiary` to prove no double ledger journal and no balance bypass.

---

## 27. Security/Authorization Considerations

*Reuses `A2` workforce IAM + `pilot-control` precedent and `A7` product-boundary pattern.*

* **Workforce-only configuration:** all limit write surfaces (`POST/PATCH /internal/limit-profiles*`, `POST /internal/limit-assignments`) require `WORKFORCE_SESSION` with `AuthorizationPolicy allowedPrincipalTypes=['OPERATOR','SERVICE','PRIVILEGED']` (`SUPPORT` may `GET` but not write). `A2_WORKFORCE_CONFIG` `financeRoles`/`makerCheckerRules` apply when maker-checker is product-enabled (mirroring `pilot_control`: maker = `SUPPORT`, checker = `OPERATOR` with `maker≠checker` `SERIALIZABLE`). `RoutePolicyRegistry` must add explicit `path.startsWith('/api/v1/internal/limit-')` entry before the generic `internal-route` fallback.

* **Customer/Agent isolation:** limit admin `GET /internal/limit-usages` is workforce-only; any future `GET /customers/me/limits` must be `CUSTOMER_LOGIN` with `policy allowedPrincipalTypes=['CUSTOMER'] customerAccess SELF` (no access to another customer’s profile). Analogous `AGENT_LOGIN` for `GET /agents/me/limits`. Direct access to `limit_rules` for other profiles forbidden — idempotent.

* **Audit & correlation:** every limit profile/rule/assignment write emits `audit_events {entityType LIMIT_PROFILE/LIMIT_RULE/LIMIT_ASSIGNMENT, entityId, correlationId, before/after, actor, requestId}`. Usage reservations emit metrics (`limit.evaluations{decision, product, dimension}`) but not PII in metrics labels.

* **Idempotency hardening:** all limit writes use `IdempotencyService.reserve(manager, {scope, key, requestHash, retentionSeconds})` with `pessimistic_write` and `hitCount` replay detection — same as `transferRepository` pattern.

* **Data minimization:** limit rules store only `limitProfileCode/product/dimension/limitValue` + `effective*` — no PAN, phone, NIN. Usages store `principalId` only (opaque UUID). Responses never return `passwordHash/pinHash/token`.

* **Least privilege summary:** customers/agents cannot configure limits; `SUPPORT` can investigate but not mutate; `OPERATOR/SERVICE/PRIVILEGED` mutate; audit is append-only.

---

## 28. Product Decisions Still Required

These are **not architecture decisions** — architecture enables any choice. Each decision blocks implementation of that slice until product/accounting/regulation provides an answer.

| ID | Decision | Why blocking | Current default in docs | Who decides |
|----|----------|--------------|------------------------|-------------|
| **D-01** | **Profile catalogue** — initial set of `limit_profiles` codes, names, `kind`, hierarchy. Are codes `KYC_LEVEL_1/2/3`? `BASIC/STANDARD/PREMIUM`? `TIER` naming? | Determines seeded `limit_profiles` rows and admin UX. No limit logic should branch until codes exist. | *No code seeded* — example only. | Antonio / Product |
| **D-02** | **Thresholds per product per window** — for each `(profile, product, dimension)` the NGN minor-units ceiling (and `0` meaning disabled). E.g. `WALLET_TRANSFER MAX_AMOUNT_PER_TX` for `BASIC` vs `VIP`. | Rate table is the product body of limit rules; without it calculator has no authoritative input. | *Not invented* — `NOT_CONFIGURED`. | Antonio / Finance (regulatory) |
| **D-03** | **Minimum transaction amount per product** — `MIN_AMOUNT_PER_TX` floor (distinct from minimum *fee*). | Evaluated as hard floor; floor may differ per product (e.g. cash-to-cash has no floor?). | *Not invented*. | Product |
| **D-04** | **Wallet balance ceiling semantics** — is `WALLET_BALANCE_MAX` a per-profile limit or a global wallet ceiling independent of profile? | Determines whether `WALLET_BALANCE_MAX` lives as a `limit_rule` row or as a separate `wallets.balanceCeilingMinor` column. | Audit treats as dimension; decision defers. | Accounting |
| **D-05** | **Time window definitions** — daily `00:00 Africa/Lagos` (assumed, must be confirmed as normative), weekly start day (Monday ISO vs Sunday business), month (calendar vs rolling 30 days), year (calendar Jan-Dec) | Window key generation depends on it; reporting/reconciliation joins will rely on it. | Daily `00:00 Africa/Lagos` assumed from docs; weekly Monday *recommended* but not binding. | Product + Accounting + Reconciliation owners |
| **D-06** | **Per-product vs aggregated windows** — does `DAILY_AMOUNT` mean "500k for wallet→wallet alone" or "500k for all outgoing products summed"? | Determines whether `limit_usages` has one row per product or one row aggregating multiple products. | Proposed V1: per-product daily (each product has its own daily budget). Aggregated is future column if needed. | Product |
| **D-07** | **Direction semantics** — are daily budgets split into `INCOMING` (funding, `CASH_TO_WALLET`) vs `OUTGOING` (transfers, `WALLET_TO_CASH`) sub-budgets, or is there one outgoing budget? | Affects `direction` column usage and whether an agent deposit should count against the same daily cap as a W→W. | Column present but decision pending. | Product |
| **D-08** | **Channel semantics** — does `USSD` or `AGENT_APP` have separate tighter daily count? | Determines whether `channel` column is populated V1 or remains `NULL` (all channels). | V1: `NULL` (all). | Product |
| **D-09** | **Assignment & precedence policy** — which principal wins when a customer matches `segment=KYC_LEVEL_1` and `segment=VIP` or `CUSTOMER` override? Is most-specific (direct `CUSTOMER` assignment) higher precedence than segment? What is segment priority ordering? | `limit_assignments.precedence` enables, but policy must be written (e.g. "direct customer override precedence 100 > segment VIP 50 > KYC segment 10"). | Recommended `CUSTOMER > SEGMENT`, higher `precedence` integer wins, but not final. | Product + IAM |
| **D-10** | **Default profile / fail-open vs fail-closed** — if a customer has *no* `limit_assignments` row, does the transaction fail `LIMIT_PROFILE_MISSING` or fall back to a system default profile (e.g. `BASIC`)? | Determines onboarding flow guarantee. | Recommended **fail closed** (`LIMIT_PROFILE_MISSING`) until an assignment is created; default profile is future. | Product + Ops |
| **D-11** | **Effective dating policy** — how far in advance may a future rule be created, who approves window overlaps, may a rule be retroactively dated (effectiveFrom in the past)? | Governs the window model. | Proposed: future-dated allowed, no retroactive effectiveFrom earlier than createdAt. | Product + Audit |
| **D-12** | **Rule priority vs forbidden overlap** — is overlapping active rules for the same key *never allowed* (unique constraint) or resolved by `priority`? | Breaks/makes D-11 semantics. | V1: forbid overlap (unique). Priority column reserved for V2. | Product |
| **D-13** | **Reversal/refund compensation** — when a `COMPLETED` transfer is reversed (future reversal flow), does its `limit_usages` contribution get decremented (refund window) or remain consumed? | Affects money movement correctness; not implemented V1. | V1: no decrement (conservative). Reversal is V2 boundary. | Accounting + Product |
| **D-14** | **KYC ↔ profile mapping source** — does `limit_assignments` derive from `customer_kyc_levels` auto-synced job, or manual `POST /internal/limit-assignments` per customer? | Determines whether a `customers.kyc_level` column drives assignment. | Existing `customer_eligibilities` has no `kycLevel` authoritative column; `customer_limit_profiles.currency` only. Mapping must be designed. | KYC/Compliance |
| **D-15** | **Agent class ↔ limit mapping** — does each `agent_classes.code` auto-mirror a `limit_profiles.code`, or are they independent tables joined via `limit_assignments(principal_type=AGENT_CLASS)`? | See §5; choice defines migration for `applicable_limits`. | Proposed: explicit `limit_assignments` join, not magic equality. | Agent Ops |

**No product decisions are *implemented* in this audit.** All live paths remain `feeMinor 0` and limit-unenforced.

---

## 29. V1/V2 Boundary

### V1 — within scope of `limit_profiles/rules/usages/snapshots` (configurable architecture, threshold rows remain product-configured, not hardcoded)

* **V1 products:** `WALLET_TRANSFER` (`TRANSFER`), `CASH_TO_WALLET`, `WALLET_TO_CASH`, `CASH_TO_CASH` init, `CUSTOMER_FUNDING` (each rule-configurable per profile per dimension: `MIN/MAX per TX`, `DAILY/WEEKLY/MONTHLY/YEARLY amount` + `DAILY/WEEKLY/MONTHLY/YEARLY count`, `WALLET_BALANCE_MAX`).
* **Dimensions:** amount + count, daily through yearly, min/max, wallet ceiling.
* **Concurrency:** `SELECT ... FOR UPDATE` on `limit_usages` inside existing `SERIALIZABLE` flows.
* **Idempotency:** replay-safe via current `idempotencyKey + requestHash` pre-check.
* **Time windows:** `Africa/Lagos` calendar day/week/month/year (weekly start decided in D-05).
* **Assignment:** `limit_profiles` reusable codes, `limit_assignments` for `CUSTOMER/AGENT/AGENT_CLASS/SEGMENT` with `precedence` and `effectiveFrom/To`.
* **Effective dating:** `effectiveFrom/To` on rules; future-dated rows; historical interpretability via `commercial_decisions` snapshot.
* **Commercial snapshot:** `commercial_decisions` row capturing `limitProfileCode + limitRuleIds/versions + limitDecision + limitUsedBefore/After` alongside `feeCalculation`.
* **Admin:** workforce-only CRUD for profiles/rules/assignments + diagnostics read.
* **Exposure:** backend quotas only; customer/agent `GET …/limits` is **not** V1 (kept `NOT_EXPOSED`).

### V2 — explicitly out of scope and *not* presented as V1 missing

* **New products:** `WALLET_TO_BANK` (NIBSS, `NIBSS_INTEGRATION`, `WEMA_INTEGRATION`, `PROVIDUS_INTEGRATION`, `NINEPSB_INTEGRATION`, `EXTERNAL_SETTLEMENT`), `CARDS` / `DOLLAR_CARDS`, `AIRTIME`, `DATA`, `BILLS`, `BETTING`, `NON_NGN_PRODUCTS` — all `blockerType V2 | EXTERNAL_DEPENDENCY`, `productScope V2`. No limit rules for V2 need to be created to prove the engine — docs explicitly state *do not implement V2 products merely to prove reward/limit engine*.
* **External provider channel limits** (e.g. NIBSS daily cut-over window) — belongs to external settlement, not to `limit_usages` V1.
* **Reversal compensation policy** (D-13) — reversal flow itself is V2 (`docs/V1-HARDENING-10`).
* **Rule priority overlap** (D-12) — unique-per-key for V1; multi-rule priority is V2.

The capability registry already classifies these as `productScope V2`: `WALLET_TO_BANK`, `NIBSS_INTEGRATION`, `WEMA_INTEGRATION`, `PROVIDUS_INTEGRATION`, `NINEPSB_INTEGRATION`, `EXTERNAL_SETTLEMENT`, `CARDS`, `DOLLAR_CARDS`, `AIRTIME`, `BILLS_ELECTRICITY`, `BETTING`, `NON_NGN_PRODUCTS` — all `PLANNED` `V2` `EXTERNAL_DEPENDENCY` — and this audit does not change their status.

---

## 30. Recommended Implementation Sequence

Dependencies are stated relative to **this audit** (no runtime work done). Each task is **additive, migration-guarded, financially safe** (no existing flow double-journal). Tasks must be separate Arena PRs.

| Arena task | Dependency rationale | What it creates | Financial safety gate |
|------------|---------------------|-----------------|-----------------------|
| **V1-LIMIT-01 — Limit Profile & Rule Catalogue (migration 0067)** | Depends on this audit (§8-§9, §12, §25). Must precede any usage or evaluation work. | Tables `limit_profiles` + `limit_rules` (DDL §25), workpiece `A2_WORKFORCE_CONFIG` guard, `LimitCatalogueService` (CRUD with `SERIALIZABLE + version + audit + idempotency`), seed `limit_profiles` starter codes (NOT thresholds) as `NOT_CONFIGURED` rows; update `docs/CAPABILITY-REGISTRY.md` to mark `LIMIT_ENGINE DESIGNED`→`BACKEND_IMPLEMENTED` (still `enabled false` until usage enforcement) | 0 ledger change; `tsc`, unit tests for `normalizeLimitRule` (`MAX_POSTGRES_BIGINT`); no flow touches `limit_rules` |
| **V1-LIMIT-02 — Limit Assignments (migration 0068)** | Depends on V1-LIMIT-01 (profiles exist). Enables mapping customers/agents/classes/segments to profiles without hardcoding tiers. | Table `limit_assignments` + `limit_assignments_history` view, `LimitAssignmentService` (precedence-ordered `resolveLimitProfile(manager, principal)`), `POST/GET /internal/limit-assignments` workforce `OPERATOR/SERVICE/PRIVILEGED`, precedence decisions D-09/D-10 documented | No flow reads it yet; assignment tests PG with overlapping precedence |
| **V1-LIMIT-03 — Limit Usages & Daily/Weekly/Monthly/Yearly Window Scaffolding (migration 0069)** | Depends on V1-LIMIT-02 and D-05 (window semantics). Needs Lagos window helper (`windowKey(windowStart, windowEnd)`). | Table `limit_usages` + Lagos helpers `getLagosWindow(now, dimension) → {key,start,end}` (unit-tested for Africa/Lagos no-DST), seeding of `window_start/end` indexes | No enforcement; scaffold only, inserts only via future evaluator |
| **V1-LIMIT-04 — Limit Evaluation Lifecycle (in-transaction evaluator, no flow integration yet)** | Depends on V1-LIMIT-03. Reuses existing `LimitEngine` pure calculator as inner step but wraps with assignment→rule→usage logic (§20). | `LimitEvaluationService.evaluateWithinTransaction(manager, {principal, product, amountMinor, currency})` — does `resolve assignment`, `load active rules`, `SELECT ... FOR UPDATE limit_usages`, `evaluate` (collect reasons), test helper `previewEvaluate` (no lock) | Called only by tests, not by `TransferService`; add `transfer.failure` audit but no production path |
| **V1-LIMIT-05 — TransferService / AgentCash* / CustomerFunding Integration (SERIALIZABLE + FOR UPDATE + Snapshot)** | Depends on V1-LIMIT-04 and D-02/D-06 window decisions; commercial snapshot D-16. **Most sensitive task.** | Inside each `executeWithinTransaction` after idempotency check and before `lockWallets`, call `LimitEvaluationService.evaluateWithinTransaction` → `reserve usage` → `postJournal` → `commercialDecision Snapshot` (§22); `TransferFailureCode.LIMIT_*` family; `limit_usages FOR UPDATE` ordering `limit_usages → wallet_accounts`; idempotency replay short-circuit verified; `commercial_decisions` table creation + snapshot tests | **Ledger-safe** via reuse of existing `SERIALIZABLE + lockWallets` ordering; regression `test:pg` on `a13, a14, a15, a25, v1-001, v1-hardening-01` must still pass with `feeMinor 0` and no double journal; concurrency test (§26) must show only one of two concurrent 300k→500k cap succeeds |
| **V1-LIMIT-06 — Admin Diagnostics & Limit Status Read Surfaces** | Depends on V1-LIMIT-05. | Read surfaces `GET /internal/limit-usages?principalId&windowKey`, `GET /internal/customers/:id/limit-status` (workforce mirror of diagnostics); safe hide of thresholds for customer-view? See D-03. | Read-only, no ledger |
| **V1-LIMIT-07 — Commercial Decision Snapshot Integration (fee+commission+reward+limit)** | Depends on V1-LIMIT-05; blocks on fee/commission/reward `PRODUCT_CATALOGUE` D-01. | Populate `commercial_decisions` limit side together with future `fee_rules`; expose via `GET /internal/commercial-decisions/:entityType/:entityId` for reconciliation | No ledger change beyond decision row |

**After V1-LIMIT-05, update capability registry:** `LIMIT_ENGINE FULLY_ENABLED`? No — until assignment coverage and window tests are **real**, it stays `DISABLED`. After diagnostics (06) and snapshot (07) it may become `DISABLED→FULLY_ENABLED` with `CONFIGURED` once a default profile is seeded and at least one `limit_usages` row is durable.

---

## Appendix A — Existing Terms vs Proposed Terms (no silent replacement)

| Existing durable term (keep) | Proposed generic term (new) | Relationship |
|---|---|---|
| `CustomerLimitProfile` / `customer_limit_profiles` (per-customer, 5 columns, currency-scoped, `version`) | `LimitProfile` / `limit_profiles` (`code` reusable, `kind`) + `LimitRule` / `limit_rules` (per-dimension, `product/dimension/limitValue`, effective dating) + `LimitAssignment` / `limit_assignments` (customer/agent/class/segment → code) + `LimitUsage` / `limit_usages` (windowed counters) | Existing table is **legacy snapshot**, not renamed. Migration backfills each `customer_limit_profiles` row into an assignment + rules, then prefers `limit_rules` but keeps legacy rows readable until decommission. |
| `AgentClass.applicableLimits jsonb` | `limit_rules` where `limit_profile_code = agent_classes.code` via `limit_assignments(principal_type=AGENT_CLASS)` | JSONB stays for compatibility; authoritative becomes `limit_rules`. |
| `PilotControl` / `pilot_controls` | not replaced — separate operational boundary gate; retains `cohortCustomerIds` named cohort, `enabled` kill-switch | Limit system never queries `pilot_controls` for daily budgets; pilot remains cohort boundary. |
| `LimitEngine.evaluate({single/daily/monthly})` | `LimitEvaluationService.evaluateWithinTransaction(manager, {principalType/id, product, amountMinor})` wrapping a refined `LimitEngine` that accepts `limitRules[] + used windows` | Old calculator kept as pure `evaluateRulesAgainstUsage` inner function; DTO changes from caller-supplied limits to DB-supplied limits. |
| `QuotePaymentType TRANSFER` | Product catalogue `products.code` (`WALLET_TRANSFER`, etc.) — canonical future; V1 keeps `QuotePaymentType` as alias | No rename; product decision will map `QuotePaymentType.TRANSFER → WALLET_TRANSFER` etc. (§12). |
| `Tier` / `Tier 1/2/3` | **Forbidden as domain term.** Replaced by `LimitProfile.code` (any string, data-driven). Existing docs that mention `Tier` are historical; they do not define the domain. | Existing term not deleted from git history, but new code must never contain `tier === 1`. |

---

## Appendix B — Required Code-Evidence Index (audited files)

* `src/limit/limit.engine.ts` (60 lines) — calculator scope §3.
* `src/limit/limit.types.ts` / `src/limit/limit.controller.ts` / `src/limit/limit.module.ts` / `src/limit/dto/evaluate-limit.dto.ts`.
* `src/customer-eligibility/customer-limit-profile.entity.ts` (66 lines) / `customer-eligibility.service.ts` (~600 lines) / `customer-eligibility.entity.ts` / `dto/create-customer-limit-profile.dto.ts` / `dto/update-customer-limit-profile.dto.ts` / `src/migrations/1785753600010-CreateCustomerEligibility.ts`.
* `src/agent/agent-class.entity.ts` (60 lines, `applicableLimits/applicableServices`) / `src/migrations/1785753600054-CreateAgentClassAndApplicationTables`.
* `src/pilot/pilot-control.entity.ts` / `pilot-control.service.ts` / `pilot-control.types.ts` / `src/migrations/17857536000*-CreatePilotControls*` (via `src/pilot/`).
* `src/transfer/transfer.service.ts` (~500 lines, `SERIALIZABLE`, `lockWallets FOR UPDATE`, `postJournalInTransaction`, `IdempotencyService`, `markFailed`, `TransferFailureCode`) / `transfer.entity.ts` / `transfer.enums.ts` / `src/agent/agent-cash-in.service.ts` / `agent-cash-out.service.ts` / `agent-cash-to-cash*.service.ts` / `customer-funding/customer-funding.service.ts` / `agent/agent-funding.service.ts`.
* `src/common/money.ts` (`MAX_POSTGRES_BIGINT`, `parseMinorUnits`, `normalizeCurrency`, `normalizeAccountingUnit`).
* `src/quote/quote.enums.ts` (`QuotePaymentType`).
* `src/ledger/ledger.service.ts` (`postJournalInTransaction`, `postWithinTransaction`, `uq_ledger_journals_idempotency_key`, retry on `40001`).
* `src/operations/idempotency.service.ts` (`reserve` with `pessimistic_write`).
* `src/capability-registry/capability.seed.ts` (101 rows, `LIMIT_ENGINE/CUSTOMER_RUNTIME_LIMITS/AGENT_RUNTIME_LIMITS`), `src/capability-registry/capability.enums.ts`.
* `docs/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md`, `docs/V1-HARDENING-03-LIMIT-POLICY-AUDIT.md` (existing limit design docs).
* `test/limit.engine.spec.ts` / `test/limit.engine.constants.spec.ts`.
* `src/policy/a7-product-*` (6 policy modules) — A7 product-boundary precedent.

---

## Final Report — What This Commit Actually Did

| Question | Answer |
|----------|--------|
| **HEAD before** | `35911e3` (`feat(capability-registry-01): … 67 migrations, VERIFIED`) |
| **HEAD after** | this doc only — no parent change beyond `docs/V1-LIMIT-ARCHITECTURE-AUDIT.md` added |
| **Source files changed** | **0** — `git diff --stat` shows only `docs/V1-LIMIT-ARCHITECTURE-AUDIT.md` (1 file) |
| **Migrations changed** | **0** — `ls src/migrations/*.ts | wc -l` stays **67**, `EXPECTED_MIGRATION_TIMESTAMP='1785753600066'` unchanged |
| **Ledger behavior changed** | **No** — `src/transfer/transfer.service.ts`, `src/agent/agent-*.service.ts`, `src/ledger/ledger.service.ts`, `src/customer-funding/*` untouched; `grep -rn LimitEngine src/transfer` → 0 hits preserved |
| **Exact files created/modified** | Created: `docs/V1-LIMIT-ARCHITECTURE-AUDIT.md` (1). Modified: none. |
| **Tests/Build/TSC results** | `node_modules/.bin/tsc --noEmit` (see verification below) — **0 errors**. `npm run build` not required for audit but `tsc` is the launch gate. No financial regression suite required beyond appropriate validation per task (no source migration). A prior `test:pg` run on `35911e3` (capability registry 22/22, hardening-09 21/21) remains representative; no new runtime ⇒ no new suite fabricated. |
| **Existing implementation findings** | §2-§7 above: `LimitEngine` stateless amount calculator (single/daily/monthly + `remaining*`) on caller-supplied limits; `customer_limit_profiles` per-customer per-currency (5 columns, no weekly/yearly, no product, no assignment reuse, no effective dating); `agent_classes.applicable_limits` opaque JSONB; `pilot_controls` cohort gate (min/max, daily count/amount, `enabled` kill-switch) is the *only* runtime guard and is disabled for ordinary path; no `limit_usages` table, no `SELECT FOR UPDATE` at transfer time; flows are `SERIALIZABLE + lockWallets + ledger + idempotency` but limit-unenforced by design (`feeMinor 0` fee-free pilot). |
| **Proposed architecture** | §8-§27: generic `limit_profiles` (reusable codes, any number, no hardcoded tier) + `limit_rules` (row-per-dimension `MIN/MAX per TX`, `DAILY/W/Y/M/Y amount/count`, `WALLET_BALANCE_MAX`, effectiveFrom/To) + `limit_assignments` (CUSTOMER/AGENT/AGENT_CLASS/SEGMENT with `precedence`) + `limit_usages` (windowed counters per `window_key` `Africa/Lagos` day/week/month/year, amount+count) + `commercial_decisions` snapshot; concurrency `SELECT ... FOR UPDATE` `limit_usages` inside existing `SERIALIZABLE` *before* `postJournalInTransaction`, reservation-first, idempotency replay short-circuit, Lagos windows, amount vs count vs wallet-balance separation, product/service/channel/direction dimensions, failure codes, admin workforce CRUD, customer/agent safe exposure optional. |
| **Unresolved product decisions** | 15 items D-01..D-15 (§28): profile catalogue & naming, thresholds per product/window, min per TX floor, balance ceiling semantics, Lagos day + weekly start + aggregated vs per-product daily, direction/channel, assignment & precedence policy, default profile / fail-closed, effective dating & priority overlap, reversal compensation, KYC→profile mapping source, agent-class→limit mapping. No NGN values invented. |
| **Dependencies/blockers** | Blocker `PRODUCT_DECISION` (all D-*) + `ACCOUNTING_DECISION` (D-04/D-13) — `LIMIT_ENGINE/CUSTOMER_RUNTIME_LIMITS/AGENT_RUNTIME_LIMITS` correctly `DISABLED`/`BLOCKED` in capability registry until D-01..D-10 decide. No external provider blocker. |
| **Capability registry change** | **No status change.** This audit confirms existing `DISABLED/BLOCKED/NOT_CONFIGURED` for `LIMIT_ENGINE/CUSTOMER_RUNTIME_LIMITS/AGENT_RUNTIME_LIMITS` is accurate. Capability doc `docs/V1-CAPABILITY-REGISTRY.md` requires no edit except optionally referencing this audit in `documentationReferences` for those three rows (deferred to implementation task V1-LIMIT-01). |
| **Recommended next implementation task** | **V1-LIMIT-01 — Limit Profile & Rule Catalogue (migration 0067)** — see §30. Rationale: profiles/rules are the foundational catalogue every later task depends on (assignments need profile codes, usages need rule dimensions, evaluation needs product catalog, transactions need snapshot rule versions). It is also the only non-`SERIALIZABLE` task (administration only), so it can land without concurrency risk. |

### Build validation (audited at `35911e3` plus this doc)

```
$ node_modules/.bin/tsc --noEmit
# (0 output, exit 0 — verified before commit)
$ ls src/migrations/*.ts | wc -l
67
$ cat src/production/production-readiness.service.ts | grep EXPECTED
const EXPECTED_MIGRATION_TIMESTAMP = '1785753600066';
const EXPECTED_MIGRATION_NAME = 'CreateCapabilityRegistry1785753600066';
$ git diff --stat HEAD
 docs/V1-LIMIT-ARCHITECTURE-AUDIT.md | ~900 lines
 1 file changed, 0 source/migration/ledger changes
```

### Next Arena Task (exact)

**Arena task `V1-LIMIT-01 — Limit Profile & Rule Catalogue` (migration `1785753600067-CreateLimitProfilesAndRules`)**

* **Goal:** land `limit_profiles` + `limit_rules` tables (DDL §25), crypto-safe names `^[A-Z0-9_]{3,80}$`, `product/dimension/limit_value_minor/count`, `effectiveFrom/To`, `version`, `UNIQUE` per active key, `Admin LimitCatalogueService` (`POST/GET/PATCH /internal/limit-profiles*`) workforce `OPERATOR/SERVICE/PRIVILEGED` `SERIALIZABLE + version + audit + idempotency`, seed starter profiles as `NOT_CONFIGURED` (no thresholds), `docs/CAPABILITY-REGISTRY.md` update only to move `LIMIT_ENGINE` from `PLANNED?` → `BACKEND_IMPLEMENTED` (still `enabled false`).

* **Dependency rationale:** every subsequent limit task depends on the profile catalogue existing — assignments (§13) need `limit_profiles.code` to assign, usages (§17) need `limit_rules.dimension` and `product` to make windows, evaluation (§20) needs rule set before it can compute `remaining*`, and commercial snapshot (§22) needs rule IDs/versions to record. Starting with profiles/rules is zero-risk to financial flows (admin tables only) and blocks no other commercial work.

---

*End of audit.*
