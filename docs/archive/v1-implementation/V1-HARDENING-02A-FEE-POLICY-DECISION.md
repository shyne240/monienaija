# V1-HARDENING-02A — Fee Policy / Accounting Decision Audit

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**HEAD (02A audit):** `436c95b` (`docs(hardening-02): audit-only verification report — fee/commission metadata-only, all V1 flows fee-free ...`) — parent `3f7729b` (`docs(hardening-01): update HEAD after to 28667b8`) — grand-parent `28667b8` (`feat(hardening-01): Customer Beneficiary ... 66 migrations`) — baseline `3d05aae` (`fix(production): update expected migration constraints ...`)  
**Migrations in workspace / DB:** `66` (`1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries`) — `src/production/production-readiness.service.ts` expects `0065`  
**Task type:** **Audit-only**, **0 source / 0 migration / 0 ledger / 0 route changes** — fee accounts, `fee_rules`, runtime fee wiring **not** created per instruction.

---

## 1. Executive Summary

MonieNaija **V1 in-house NGN wallet** (authoritative double-entry ledger) is **fee-free at runtime today** (`feeMinor=0` for every authoritative flow) and the repository treats **fee/commission/revenue as metadata-only calculators** (`FeeEngine`, `B1FeeEngine`, `POST /fees/calculate`) with **no persisted fee rule table** and **no `FEE-REVENUE-NGN` / `COMMISSION-PAYABLE-NGN` ledger account**. The **authoritative V1 handoff/scope documents do NOT establish a mandatory non-zero fee for any in-house flow**; where they mention fees they do so as **future commercial capability** (`B1 commercial.virtual-account.inbound-funding.fee|commission`) or as an **open product decision** (`V1-004 — REQUIRES PRODUCT DECISION — if fees required for launch, P1 else V2`). The only in-scope “fee” that is explicitly scoped in those documents is **inbound funding via provider-backed virtual account (B1, NIBSS_NIP, VIRTUAL_ACCOUNT)** — which is **out of scope for the current 9 in-house flows** audited below. Consequently, the **current fee-free implementation is compliant with the authoritative V1 requirement as written**, and **V1-HARDENING-02A runtime implementation is BLOCKED pending explicit product/accounting decisions** — it is not unblocked as READY and it is not explicitly fee-free by a definitive V1 “all fees shall be zero forever” clause either; the correct classification is **OUTCOME C** (`configurable fees mentioned but policy undefined`).

**Final status for 02A:** **`BLOCKED — V1 FEE POLICY REQUIRES PRODUCT/ACCOUNTING DECISION`** (see §16). `FeeEngine` remains unused metadata/future capability for in-house flows; `B1FeeEngine` remains read-only decision engine for the virtual-account commercial scope only.

---

## 2. Authoritative Source Evidence (verbatim / precise summary + classification)

All quotes below are **repository-grounded verbatim** (or fully precise summary where quoted string would be excessively long) with source, line context, and classification per Step 1 (1=explicit V1 requirement, 2=architectural principle, 3=implementation note, 4=future/V2, 5=model inference).

### 2.1 Primary V1 handoff / product audits

| # | Source | Wording (verbatim or precise) | Classification |
|---|--------|-------------------------------|---------------|
| E1 | `docs/V1-PRODUCT-COMPLETION-AUDIT.md:11` `§11 Fees / Commissions / Limits Audit` | *“Fee engine: `src/fee/fee.engine.ts` `FeeEngine.calculate(amountMinor, currency, {paymentType, channel})` → `flat + %` with `minimum`, `BASIS_POINTS` 10000 — **METADATA ONLY** (calculator, not runtime). `src/fee/fee.controller.ts` `POST /fees/calculate` exists but is **not called** by `TransferService` or `AgentCashIn/Out`. All tests have `feeMinor=\"0\"` (A25 history `feeMinor=\"0\"` hardcoded).”* | **3 implementation note** — authoritative audit of what exists today, not a V1 requirement to add fees. |
| E2 | `docs/V1-PRODUCT-COMPLETION-AUDIT.md:11` same | *“Agent commissions: `src/policy/b1-*` includes `fee-engine`, `billing-engine`, `referral-engine` but **no** `commission` runtime that posts `CREDIT agent` `DEBIT revenue`. `AgentFundingPool` is funding, not commission.”* | **3** — confirms no commission runtime for in-house. |
| E3 | `docs/V1-PRODUCT-COMPLETION-AUDIT.md:11` same | *“Status: `METADATA ONLY` (calculator + config tables, no runtime). **Impacts:** V1 can run with `fee 0` but cannot disclose fees, cannot pay Agent commissions, cannot enforce limits (customer could transfer 10B). **Requires Product Decision:** Are fees/limits required for V1 launch? If yes, **P1 gap V1-004** (runtime enforcement), else V2.”* | **1 explicit V1 requirement is the decision itself** — V1 *can* run fee-free; whether to add fees is an **open product decision**, not a closed mandatory requirement. |
| E4 | `docs/V1-PRODUCT-COMPLETION-AUDIT.md:19` `§19 Detailed Gap Matrix — GAP V1-004` row | *“`V1-004` | **Fees/Limits** | `W→W`, `CASH_IN/OUT` | `FeeEngine` calculator `flat+%/minimum` `POST /fees/calculate` + `agent_classes.applicable_limits` JSON + `customer_limit` table, but **no runtime call** in `TransferService`/`AgentCashIn` (all `fee 0`) | **METADATA ONLY** | No fee disclosure, no commission, no limit enforcement (10B transfer possible) | V1-001 (funding) if fees on funding | **Add `limitService.check` + `feeEngine.calculate` before `postJournal` in `TransferService`/`AgentFinancialExecution`, post `DEBIT customer / CREDIT revenue` + `CREDIT agent commission`, maker/checker for `fee_rules` CRUD `POST /internal/fees/rules`** | **V1?** `REQUIRES PRODUCT DECISION` (if fees required for launch, P1 else V2) | `grep limitService transfer.service 0`, `test/a25 feeMinor 0`”* | **1 — conditional**. The “ADD” is a *proposal* for **if** fees are decided, not an explicit “V1 SHALL charge X on Y”. Marked `V1?` `REQUIRES PRODUCT DECISION`. |
| E5 | `docs/V1-PRODUCT-COMPLETION-AUDIT.md:23` `V1 completion §3` | *“**Fees/Commissions/Limits are METADATA ONLY** — `fee` engine (`FeeEngine.calculate` flat+%) exists as calculator, `agent_class` `applicable_limits` JSON, `customer_limit` table, but **no runtime enforcement** in `TransferService`/`AgentCashIn`/`CashOut` (all tested transfers have `feeMinor=\"0\"`).”* | **3** — status, not requirement. |
| E6 | `docs/V1-008-DEPENDENCY-RE-AUDIT.md:29` `Backend-only survivors` | *“Fees/Limits/Commissions remain calculator+config tables with runtime 0-fee for V1 (**intentional zero-fee in-house**, but limits not enforced via TransferService — policy A4 exists via `internal-transfer-gate` but Customer W→W bypasses it).”* | **2 architectural principle** — records that **in-house is intentionally 0-fee** today, but qualifies as documentation of current posture, not a notarized “shall never charge” normative clause. |
| E7 | `docs/V1-008-DEPENDENCY-RE-AUDIT.md:151` `M1 Fees / Commissions` | *“Calculator + config tables exist, no fee `DEBIT customer CREDIT revenue` posting, no commission `CREDIT agent`. V1 in-house intentional 0-fee, but no enforcement if fees later. | Commercial policy B1; product decision if V1 launch requires non-zero fees else V2”* | **2/3** — same as E6. |
| E8 | `docs/V1-008-DEPENDENCY-RE-AUDIT.md:465` `Remaining V1 hardening — policy decision` | *“`FeeEngine` 0-fee is **intentional** for in-house V1; if product requires non-zero fees/limits for launch, then `A4` policy wiring + `POST /internal/fees/rules` maker/checker is required before launch (hardening H6) | Product decision: keep 0 for V1 pilot, wire for commercial launch”* | **2** — confirms 0-fee is intentional for pilot, non-zero is future commercial decision. |
| E9 | `docs/V1-HARDENING-02-VERIFICATION-REPORT.md:78` `§15 Q15` | *“Intended per V1 task description (authoritative scope): ‘V1 requires configurable transaction fees **where applicable** and proper separation ...’ The phrase *where applicable* is **not** mapped in code to any specific flow.”* | **5 model inference — task description**, not authoritative handoff. The audit itself notes the task wording is **not** in the source docs. |

Search for **authoritative V1 handoff scope** (`docs/A5-PILOT-BASELINE.md`, `docs/A3-*`, `docs/A4-*`, `docs/B1-*`, `ADR-0061/0063`) for fee/commission-bearing in-house flows:

| Source | Finding |
|--------|---------|
| `docs/A5-PILOT-BASELINE.md:171` `Explicitly out of scope` | *“Fees, commissions, pricing, customer tiers, or product-specific financial state **unless separately approved by a later A5 task**.”* — **Explicit V1 pilot exclusion**: in-house pilot does **not** require fees. | 
| `docs/A3-A4-HANDOFF-PACKAGE.md:43` `Prohibited-edge register` | *“create customer tiers, product pricing, **fees, commissions**, or account classes inside the A3 handoff”* — fees/commissions are **not** created by A3; they belong to A5/B1 later, not the V1 binding foundation. |
| `docs/A3-IMPLEMENTATION-PLAN.md:32` `Out of scope for A3` | *“Product-specific **pricing, fees, commissions, customer tiers, classes of service**”* — A3 ledger/binding phase is explicitly fee-free. |
| `docs/A5-IMPLEMENTATION-PLAN.md` etc. | No V1 in-house fee matrix is defined; A5 financial pilot is expected to be **fee-free unless a later task separately approves** fees. |
| `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md:5-8` & `ADR-0061` & `ADR-0063` | First commercial scope is **`commercial.virtual-account.inbound-funding` v1** with capabilities **`...fee`** and **`...commission (revenue sharing)`** — scoped to **provider-backed virtual account inbound funding, NGN, CUSTOMER_FUNDS, under A7 `VIRTUAL_ACCOUNT` + A6 `NIBSS_NIP`**. **No** `commercial.wallet.wallet-transfer`, `commercial.agent.cash-in`, `commercial.cash-to-cash` scope is frozen. This fee/commission is **B1 commercial, not V1 in-house wallet/agent**. `B1T02` is documentation-only, `B1T04` fee engine is **read-only, never posts journal** (`ADR-0063:18-20` “never posts a journal, mutates a balance … never substitutes the A5 Ledger posting boundary”). |
| `docs/ADR/ADR-0007` | *“M6 expanded financial product tooling remains non-money-moving”* — `fee`, `quote`, `limit`, `virtual-account`, `beneficiary` etc. are **metadata-only** calculators. |

**Summary distinction:** The only place where fees are **explicitly required** with a concrete scope, currency, and capabilities is **B1 virtual-account inbound funding** (a **future commercial product**, out of scope for the 9 in-house flows). For the 9 in-house flows audited in Step 2, **no authoritative document states “Customer Wallet→Wallet SHALL charge flat X + Y% to customer” or “Agent commission SHALL be Z%”**. The closest to “configurable fees where applicable” is the **task description wording for V1-HARDENING-02** itself, which the hardening-02 audit already identified as **unmapped** to any flow and which does **not** appear in the A1-A8 handoff packs.

**Conclusion on explicitness:** Authoritative V1 establishes **two** things explicitly: (a) in-house is **intentionally 0-fee** today (E6-E8, A5 exclusion) and can launch as such, and (b) **B1 inbound funding** is the only fee-bearing scope currently frozen, but it is **not** one of the 9 audited flows. Whether in-house should become fee-bearing is recorded throughout as **`REQUIRES PRODUCT DECISION`** (E3/E4), not as a closed mandatory requirement. Therefore this audit **cannot** claim `VERIFIED — V1 IS EXPLICITLY FEE-FREE` as a normative “shall forever be zero” decree without product sign-off, nor can it claim `READY` (sufficiently defined for implementation) — the correct outcome is **`BLOCKED — V1 FEE POLICY REQUIRES PRODUCT/ACCOUNTING DECISION`** (OUTCOME C).

---

## 3. Exact V1 Fee Requirements (authoritative)

Authoritative V1 **as written** requires:

- **No in-house transaction fee** unless a later product/commercial decision explicitly activates it. Evidence: A5 pilot exclusion (`E8`/A5:171), A3 out-of-scope (`E9`), V1-008 `intentional zero-fee in-house` (`E6`), V1 product audit `METADATA ONLY` + `REQUIRES PRODUCT DECISION` (`E1-E4`).
- **No in-house Agent commission** unless separately decided. Evidence: `V1-008 M1` — `no fee DEBIT/CREDIT revenue posting, no commission CREDIT agent` + `AgentFundingPool is funding, not commission` (`E2`), `V1-PRODUCT-COMPLETION-AUDIT §11` — no commission runtime.
- **No platform revenue posting for in-house** unless fees are decided. Evidence: same; `B1` revenue-sharing is for virtual-account inbound only, **read-only** and separate from `ledger_accounts` (`ADR-0063`).
- **If/when commercial inbound funding is launched**, then **B1 virtual-account inbound funding fee + commission (revenue sharing)** are scoped (`B1-COMMERCIAL-CATALOG-CONTRACT.md:8`, `ADR-0061:51`). This is **not** an in-house Wallet→Wallet/Agent requirement today.

No authoritative doc specifies **amount, payer, recipient, VAT, global/class/customer configurability, versioning, or history representation** for in-house fees — hence the `REQUIRES PRODUCT DECISION` flag.

---

## 4. Flow-by-Flow Fee Matrix (authoritative → repository cross-check)

Authoritative V1 requirement vs current repository (source: `V1-PRODUCT-COMPLETION-AUDIT.md §4 Lifecycle Map`, `src/transfer`, `src/agent`, `src/customer-funding`, `src/ledger`, `test/*`).

| # | Flow (as per STEP 2) | Authoritative V1 requires (quoted) | Payer / Recipient per source | Fee? Commission? Revenue? | Current repo (runtime) | Compliant with current authority? |
|---|----------------------|-----------------------------------|------------------------------|---------------------------|------------------------|-----------------------------------|
| 1 | **Customer Wallet→Wallet** | `V1 can run with fee 0 ... Requires Product Decision: Are fees/limits required for V1 launch? If yes, P1 gap V1-004, else V2` (E3) — no explicit `W→W shall charge` | Not defined in source — if fee later, payer would be source customer (inferred from proposal `DEBIT customer CREDIT revenue` in V1-004 row, **not** normative) | Not required today; no commission (no Agent in flow), no platform revenue | `src/transfer/transfer.service.ts` `SERIALIZABLE` `postJournalInTransaction` **2 lines** `DEBIT source CREDIT dest` `NGN` `CUSTOMER_FUNDS` `feeMinor='0'` (A25 `GET /customers/me/transfers` `feeMinor:"0"` hardcoded, V1-HARDENING-01 `30 fee 0`) | **Yes — fee-free is compliant** |
| 2 | **Customer Wallet→Cash** (redemption via Agent) | Same — `W→W, CASH_IN/OUT` grouped in `V1-004` `REQUIRES PRODUCT DECISION` (E4); no separate Wallet→Cash fee clause | Not defined | Not required | `src/agent/agent-cash-out.service.ts` → `AgentFinancialExecutionService` **2 lines** `DEBIT customer CREDIT agentFundingPool`, `feeMinor` absent/0 | **Yes** |
| 3 | **Agent Cash→Wallet** (cash-in) | Same as #2 | Not defined | Not required | `src/agent/agent-cash-in.service.ts` → `DEBIT AGENT_FUNDING_POOL-NGN CREDIT customer wallet` `fee 0` | **Yes** |
| 4 | **Cash→Cash initiation** (`POST /agents/me/cash-to-cash` `UNCLAIMED`) | `V1-004` `CASH_IN/OUT` + `§10` gap — no explicit Cash→Cash fee; `cash_to_cash_transfers.feeMinor` exists as column but always `0` | Not defined | Not required; no commission | `src/agent/agent-cash-to-cash.service.ts:98` `feeMinor=0n` hard-coded, `vatMinor=0n`, `totalMinor=amount`; journal 2 lines `DEBIT agentPool CREDIT CASH_TO_CASH-UNCLAIMED-NGN` | **Yes** |
| 5 | **Cash→Cash claim** (`POST /agents/me/cash-to-cash/:id/claim`) | Same — no claim fee clause; claim is PBKDF2 `transfer_code_hash` + `ledgerService.postJournalInTransaction` | Not defined | Not required | `AgentCashToCashClaimService` — journal 2 lines `DEBIT unclaimed CREDIT beneficiary wallet` (no fee) | **Yes** |
| 6 | **Cash→Cash expiry** (sweep `EXPIRED` → `DEBIT unclaimed CREDIT agent`) | Same | Not defined | Not required | `AgentCashToCashExpiryService` / `AddExpiry` — no fee | **Yes** |
| 7 | **Finance Ops customer funding** (`POST /internal/customers/:id/funding-requests` → `POST .../approve` maker `SUPPORT` ≠ `OPERATOR`, `SERIALIZABLE` `postJournalInTransaction`) | **Explicitly fee-free ingress** — funding is debit to settlement/funding pool, credit to customer; `V1-004` notes “V1-001 (funding) if fees on funding” as hypothetical, not requirement; `V1-001` baseline is funding without fee | N/A (ingest) | No fee, no commission, no revenue | `src/customer-funding/customer-funding.service.ts` — journal `DEBIT PAYMENT-SETTLEMENT_ASSET-NGN`/`AGENT_FUNDING_POOL-NGN` `CREDIT customer wallet`, no fee | **Yes — preserve maker/checker, no fee** |
| 8 | **Agent funding / defunding** (`AGENT_FUNDING_POOL-NGN` top-up/withdrawal, `AgentOutlet`/`AgentTerminal` not money-moving) | No fee clause in authoritative docs; funding is operational wallet/pool provisioning, not commercial | N/A | No | `src/agent/*` `CreateAgentFundingPool` `1785753600061` + `B2F` finance-control `1785753600048` — no fee | **Yes** |
| 9 | **Aggregator funding / defunding** (`aggregators` `1785753600060`) | Same — no fee | N/A | No | `src/aggregator` — no fee | **Yes** |

**Row for the only explicitly fee-scoped commercial product (out of scope for 02A but required for provenance):**

| — | `commercial.virtual-account.inbound-funding` (B1 v1, inbound NGN virtual account via `NIBSS_NIP`, under `VIRTUAL_ACCOUNT`) | *“Selected first commercial scope `commercial.virtual-account.inbound-funding.v1` ... capabilities `...fee` and `...commission (revenue sharing)`”* (`B1-COMMERCIAL-CATALOG-CONTRACT.md:8`, `ADR-0061:51`) | Not yet defined beyond scope; B1 calculators only | **Fee + commission + revenue-sharing required *when that product is launched***, but **not** for current 9 in-house flows | `B1FeeEngine`/`B1BillingEngine` read-only decision tables `b1_commercial_decisions` etc., **no journal** (`ADR-0063:18-20`), no fee revenue ledger account for this scope either | **Out of scope for 02A — no in-house implementation required** |

**If the source says “configurable fees” but does not identify the affected transaction type, we state exactly that:** The only source that says “configurable fees where applicable” for in-house is the **V1-HARDENING-02 task description** itself; within the authoritative handoff packs, the equivalent phrase appears only as **`REQUIRES PRODUCT DECISION`** without mapping to a specific flow (see E3/E4). For the 9 flows above, authoritative V1 **does not identify** which is fee-bearing — hence the `Not defined` entries above.

---

## 5. Agent Commission Requirements (authoritative)

- **Authoritative requirement:** **None for in-house V1**. Evidence: `V1-PRODUCT-COMPLETION-AUDIT.md:11` `E2` — *“no commission runtime that posts CREDIT agent”*; `V1-008 M1` — `no commission CREDIT agent. V1 in-house intentional 0-fee`; `V1-008 H6` — fees/limits runtime is **policy decision H6, defer if V1 fees 0**. `B1` commission is scoped to virtual-account inbound funding only and is **read-only, never posts to ledger** (`ADR-0063:18-20`, `B1-COMMERCIAL-CATALOG-CONTRACT.md:86` prohibiting second fee engine).
- **Therefore:** Agent commission in V1 in-house is **not required** today. If a future product decision makes Cash→Wallet or Wallet→Cash commissionable (e.g., Agent receives % of fee), that would be a **new commission rule** requiring a ledger account and a `fee - commission - platform` split — but no such rule is defined.

---

## 6. Platform Revenue Requirements (authoritative)

- **Requirement:** **None for in-house today**. Same evidence as §5. Platform revenue for in-house would be `feeMinor - commissionMinor` credited to a revenue ledger account — no such account exists, and no authoritative V1 clause requires it for Wallet→Wallet etc. The only platform revenue explicitly scoped is **B1 virtual-account inbound funding revenue sharing**, which is **commercial revenue recognition** (`B1 Revenue Recognition / Tax / VAT / Cost-Accounting`, `ADR-0067`) and again **not** for current in-house flows.

---

## 7. Current Repository Implementation (what exists — Step 3)

**Exists (repository-grounded):**

- `src/fee/fee.engine.ts` — `FeeEngine.calculate(amountMinorInput, currencyInput, rule: FeeRule) → FeeCalculation` (`BASIS_POINTS=10_000n`, `flatFeeMinor + amount*percentageBps/10000`, clamped to `minimumFeeMinor`/`maximumFeeMinor`, `vatMinor = feeMinor*vatBps/10000`, `totalMinor = amount+fee+vat`, `MAX_POSTGRES_BIGINT` guard, `normalizeCurrency`). **Pure deterministic calculator, no DB, no journal.**
  - Types: `FeeRule {paymentType: QuotePaymentType, flatFeeMinor, percentageBps, minimumFeeMinor?, maximumFeeMinor?, vatBps}` → `FeeCalculation {paymentType, currency, amountMinor, feeMinor, vatMinor, totalMinor}` (all `string` minor).
- `src/fee/fee.controller.ts` `POST /fees/calculate` + `src/fee/dto/calculate-fee.dto.ts` (`amountMinor /^[1-9]\d*$/`, `currency /^[A-Za-z]{3}$/`, `paymentType` enum, flat/percentage/min/max/vat) — **metadata-only** endpoint, not called by `TransferService`/`Agent*`.
- `src/policy/b1-fee-engine.service.ts` / `b1-billing-engine.*`, `b1-commercial-catalog.*`, `b1-revenue-recognition-*` etc. — **B1 decision engines** for `commercial.virtual-account.inbound-funding` only. **Read-only** (`evaluate/replaySafeEvaluate/compatibilityCheck`), `b1_commercial_decisions` persistence **configuration only**, **never** `LedgerService.postJournal` (ADR-0063:18-20). Uses `IdempotencyService`/`AuditService`/`OutboxService`/`MetricsService` for decision replay safety, not money movement.
- `src/ledger/ledger.service.ts` — authoritative double-entry `SERIALIZABLE` `postJournalInTransaction` with deferred `CONSTRAINT TRIGGER ledger_journal_must_balance`, `allowNegativeBalance` checks, `ledgerIdempotencyKey` (`agent:`, `transfer:`), `isRetryable 40001/40P01`, outbox `transfer.completed` etc.
- `src/ledger/ledger-account.entity.ts` / `src/migrations/1785753600000-CreateWalletAndLedger.ts` — chart: `ledger_accounts(code TEXT UNIQUE, account_type TEXT, normal_balance TEXT, currency TEXT, accounting_unit TEXT, allow_negative_balance BOOLEAN, is_active BOOLEAN)`.
- **Current customer-funds chart (after 66):** `AGENT_FUNDING_POOL-NGN` (ASSET DEBIT), `PAYMENT-SETTLEMENT_ASSET-NGN` (ASSET DEBIT), `PAYMENT-SETTLEMENT_CLEARING-NGN` (ASSET DEBIT), `PAYMENT-SYSTEM_SUSPENSE-NGN` (LIABILITY CREDIT `allow_negative true`), `CASH_TO_CASH-UNCLAIMED-NGN` (LIABILITY CREDIT `allow_negative true`), plus per-wallet `WALLET-*` liability accounts (LIABILITY CREDIT `NGN` `CUSTOMER_FUNDS` `allow_negative false`) provisioned via `WalletService`. **No `FEE-REVENUE-NGN`, no `COMMISSION-PAYABLE-NGN`, no `VAT-PAYABLE-NGN`.**
- `src/agent/agent-class.entity.ts` — `agent_classes(reference, code, name, isActive, requirements, requiredInformation, requiredDocumentCategories, applicableServices, applicableLimits JSONB, version)` — **no `applicableFees` / `commissionRate`**.
- `AgentCashToCashService` `feeMinor=0n` hard-coded (`src/agent/agent-cash-to-cash.service.ts:98`).
- Transaction history: `GET /customers/me/transfers` (A25) `feeMinor:"0"` + `counterparty{walletId,customerId,displayName,receivingNumber}` batched, `SERIALIZABLE` + idempotency `requestHash`.

**What is metadata-only:**

- `FeeEngine` + `/fees/calculate` + `B1FeeEngine` decision records + `agent_classes.applicable_limits` JSON + `customer_limit` table + `b1_commercial_catalog_registrations` seed — all are **calculators / config tables with no runtime fee line**.

**What is runtime:**

- All 9 flows above are runtime with **2-line balanced journals** (`DEBIT source CREDIT dest`, or agent pool ↔ unclaimed/wallet) — but **always fee-free** (`feeMinor 0`). Current idempotency `sha256(source,destination,amount,currency,reference,narration)` covers principal only.

**What is absent:**

- No `fee_rules` table, no `global fee_rule_version`, no `FEE-REVENUE-NGN` REVENUE account, no `COMMISSION-PAYABLE` liability, no `transfer.feeMinor`/`feeRuleVersion` persisted on transaction (only history projection `feeMinor:"0"`), no `POST /internal/fees/rules` maker/checker, no VAT/tax ledger.

---

## 8. Current Fee-Free Behavior (repository-grounded)

- `TransferService.createTransfer` `normalizeCommand` (`sourceWalletId, destinationWalletId, amountMinor, currency NGN, reference, narration, pin`) — **no `feeMinor` in `CreateTransferCommand`**, `ValidationPipe whitelist` strips unknown `feeMinor`, `normalizeCommand` canonical. `executeWithinTransaction` `SERIALIZABLE` locks `wallets ORDER BY id FOR UPDATE`, checks ownership, **derives fee as 0 implicitly** (2-line journal only), `LedgerService.postJournalInTransaction` `lines=[DEBIT source amount, CREDIT dest amount]`, `totalMinor=amount`, `correlationId transfer:${transferId}`. Tests `v1-hardening-01` `30` verify balanced `DEBIT/CREDIT` `12345` with `feeMinor='0'`.
- `AgentFinancialExecutionService` — `SERIALIZABLE` `scope agent-financial.v1:${agentId}` `requestHash = sha256(canonicalJson{agentId,currency,accountingUnit,lines,reference,description,correlationId,metadata})`, `IdempotencyService.reserve` `pessimistic_write` + `complete` stores `journalId`. Lines are **server-constructed** by `AgentCashInService`/`AgentCashOutService`/`AgentCashToCashService` — client cannot supply arbitrary `feeMinor` via lines (agent wallet ownership asserted `lines.some accountId === agentWallet.ledgerAccountId` else `BadRequest`).
- **Client cannot control fee:** `POST /customers/me/transfers` with extra `"feeMinor":"100"` is ignored (whitelist + engine never reads it) — still `201` `fee 0`.
- **History:** `GET /customers/me/transfers` safe projection `feeMinor:"0"` (A25), no ledger internals (`journalId`, `tokenHash`).

---

## 9. Gap Analysis

| Gap | What authoritative V1 says | What exists | Gap type |
|-----|---------------------------|-------------|----------|
| **No persisted fee rule table** | `REQUIRES PRODUCT DECISION` whether fees exist | `FeeEngine` pure function + `B1` catalog seed, no `fee_rules` DB | **Conceptual — not required until product decides** |
| **No fee revenue ledger account** | No in-house fee required today; B1 fee is read-only | No `REVENUE` `FEE-REVENUE-NGN` (see §6) | **Not a blocker for current 0-fee**; would be blocker if fee >0 required |
| **No commission payable** | No in-house commission required | No `COMMISSION-PAYABLE-NGN` | Same |
| **No principal vs fee split in journal** | In-house intentionally 0-fee, `V1-004` proposal would add `DEBIT customer CREDIT revenue (+ commission)` | Journal 2 lines, `totalMinor=amount` | **Not a gap for fee-free** |
| **Limit enforcement bypass** | Limits are `METADATA ONLY` via `AgentClass.applicable_limits` + `customer_limit`, `internal-transfer-gate` bypassed for Customer W→W | `TransferService` never calls `limitService.check` | **Not a fee gap**, but noted for completeness — limits are similarly metadata-only |

**No in-house gap blocks V1 launch today** — `V1-008-DEPENDENCY-RE-AUDIT` correctly lists fees/limits as `METADATA-ONLY` with next `HARDENING H6` **only if** product requires non-zero. The only real hardening gaps before fees are **H1 (beneficiary `me` + `beneficiaryId`)**, **H2 (reconciliation break resolve)**, **H3 (history unification)**.

---

## 10. Idempotency Implications (STEP 5 — not implemented)

**Current:** `requestHash = sha256(canonicalJson{source,destination,amount,currency,reference,narration})` after beneficiary resolution (`resolvedDestinationWalletId`). This covers the **canonical economic identity** correctly for fee-free. Verified: `v1-hardening-01` cases A (`same beneficiaryId same key` → same id) / B (`beneficiaryId→W` vs `destinationWalletId→W` same key → same id) / `different beneficiary same key → 409`.

**If fees become runtime-authoritative (future):** The economic identity **must** include the **resolved fee** (and its accounting classification/commission) otherwise two submissions with same principal but different fee rule would be considered identical. Design documented in `V1-HARDENING-02-VERIFICATION-REPORT.md §8/10`:

- **Persist:** `resolvedFeeMinor` (string minor), `vatMinor`, `feeRuleVersion` (or `feeRuleId` + version), `commissionMinor` (if any), `accounting classification` (`feeRevenueAccountCode`, `commissionPayableAccountCode`, `vatPayableAccountCode`) **as part of the durable financial transaction** (`transfer.feeMinor`, `ledger_journal.metadata.fee{Minor,variant,ruleVersion}` etc.).
- **Include in `requestHash`:** canonical JSON extended to `{..., feeMinor, vatMinor, commissionMinor, feeRuleVersion, feeRevenueAccountCode, accountingUnit}` (or at minimum `{feeMinor, feeRuleVersion}`) so that same principal + same key but different resolved fee produces **different** hash → new transaction, while **same** resolved fee + same key is idempotent. The `requestHash` comparison on duplicate `Idempotency-Key` must compare **full** hash including fee; if stored response is `fee 100` and retry carries `fee 105` (client ignored, but config changed), the **existing journal’s fee snapshot** is returned, not a new one — i.e., retry returns `REPLAYED` with original fee, per “cannot be altered after execution merely because configuration later changes.” This is achieved by hashing the **resolved** fee snapshot, not the mutable config id.
- **Versioning:** Fee rule change **after** a transaction is committed does **not** retroactively change that transaction’s persisted `feeMinor`; new transactions pick up new `feeRuleVersion`. This matches the A4 policy profile versioning pattern already used for `a4_policy_profiles` `version` + `hash`.

**Do not implement now** — audit-only.

---

## 11. Ledger / Accounting Implications (STEP 6 — primitives required only if fees required)

**Can existing chart represent splits?**

| Primitive | Existing capability | How | Required if fee >0 |
|-----------|---------------------|-----|---------------------|
| **Principal** | **Yes** — per-wallet `LIABILITY` + `AGENT_FUNDING_POOL` `ASSET` etc., `postJournalInTransaction` already double-entry | 2-line journal `DEBIT source CREDIT dest` → `totalMinor=amount` | Already satisfied |
| **Customer fee** | **No dedicated account** — type `REVENUE` / `LIABILITY` classification exists in `LedgerAccountType` enum (see `src/ledger/ledger.enums.ts` `ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE`), but no `FEE-REVENUE-NGN` row | Would need `INSERT INTO ledger_accounts (code,account_type='REVENUE',normal_balance='CREDIT',currency='NGN',accounting_unit='CUSTOMER_FUNDS',allow_negative_balance=false)` e.g. `FEE-REVENUE-NGN`. Could be done via `LedgerService.createAccount` like wallet provisioning **or** via 1 migration — but **do not create** in this audit. | **Required for fee >0** |
| **Agent commission** | **No** — would need `COMMISSION-PAYABLE-NGN` `LIABILITY CREDIT` (or `COMMISSION-EXPENSE` + payable) | Same as above | **Required only if commission required** |
| **Platform revenue** | **Same as customer fee** — `FEE-REVENUE-NGN` (or `REVENUE` split: `REVENUE - COMMISSION`) | Same | Same |
| **VAT/tax** | **No** — would need `VAT-PAYABLE-NGN` `LIABILITY CREDIT` | Same | **Only if authoritative V1 explicitly requires VAT** — no such clause exists for in-house (B1 revenue-recognition tax/VAT is for virtual-account commercial, not in-house). |
| **Balancing** | `ledger_journal_must_balance` deferred trigger already enforces `SUM(DEBIT)==SUM(CREDIT)`; `allowNegativeBalance` guards agent/wallet overdraft | Any fee design must remain balanced: e.g., `DEBIT source (principal+fee+vat)`, `CREDIT dest principal`, `CREDIT feeRevenue fee`, `CREDIT vatPayable vat` (= total `principal+fee+vat`) — example in hardening-02 §8 | Must remain balanced |

**If repository lacks these primitives, state exactly what would have to be designed:** At minimum **1 REVENUE account** for fee (`FEE-REVENUE-NGN`), and if commission required **1 LIABILITY** for commission payable (`COMMISSION-PAYABLE-NGN`), plus optionally `VAT-PAYABLE-NGN` if VAT is later mandated. Classification already supports `REVENUE`/`LIABILITY`; no new `account_type` needed. Mapping would be governed by **B2 Finance chart & A5 account mapping** (`B2F03`) and **B2F06 finance control** (maker/checker `SUPPORT`/`OPERATOR`) plus **A5T11 AR control approval** pattern, not by ad-hoc `INSERT`.

---

## 12. Transaction-History Implications

- **Current (fee-free):** `GET /customers/me/transfers` projects `feeMinor:"0"` (safe, deterministic, no `journalId`). No disclosure needed.
- **If fee-bearing:** History must expose **resolved** `feeMinor` (+ `vatMinor` if any) as part of the safe projection (`amountMinor` principal + `feeMinor` + `vatMinor` + `totalDebited = amount+fee+vat`), **not** the mutable config. `counterparty` batch logic (A25) remains. The projection must be derived from the **persisted journal** (`SUM DEBIT fee line` or `transfer.feeMinor`), not recomputed from current config, so later config changes don’t alter historical receipts. No ledger internals (`ledger_line_id`, `journal_id`) exposed — consistent with A25.

---

## 13. Reconciliation Implications

- **Current (fee-free):** `ReconciliationService.getBreaks` checks `wallet balanceMinor == SUM(CASE ledger_line.normal_balance)` — 2-line journals reconcile trivially. `CASH_TO_CASH-UNCLAIMED` liability `SUM` reported via `unclaimed-report` is single account.
- **If fee-bearing:** Reconciliation must verify `SUM(DEBIT)==SUM(CREDIT)` across **N-line** journals (principal + fee + commission + vat), `FEE-REVENUE` `CREDIT` balance, `COMMISSION-PAYABLE` `CREDIT`, and that every `transfer.feeMinor` matches its journal fee line. Break investigation UI (`V1-008` H2) would need to surface these new accounts. No new reconciliation engine needed — existing `B2F` `finance-control` + `ledger` invariants suffice, but **new report dimensions** (fee revenue, commission payable) would be added to `GET /internal/reconciliation/breaks` and `GET /internal/finance/unclaimed`.

---

## 14. Required Product Decisions (exact — before any 02A implementation)

1. **Whether any of the 9 in-house flows shall be fee-bearing at all for V1 pilot** — `W→W`? `Cash→Wallet`? `Wallet→Cash`? `Cash→Cash`? or **keep all fee-free** (defer to B1 commercial launch). Must be binary per flow, not implied by `FeeEngine` existence. Source conflict: `V1-HARDENING-02` task says “configurable where applicable” (unmapped) vs `V1-008 M1` “intentional zero-fee in-house, defer unless product requires non-zero.”
2. **For each fee-bearing flow, the fee payer** — source customer? Agent? split? (No source defines this for in-house.)
3. **Fee structure per flow** — flatMinor + percentageBps + minimum + maximum + vatBps per `FeeRule`, and whether each is **global** vs **per-Agent-class** (`agent_classes.applicableLimits` is limits only today) vs **per-customer tier** vs **per-plan** (`B1` commercial catalog).
4. **Agent commission applicability** — does any in-house flow pay Agent commission? If so, **which flows, what %/flat of fee (or of principal), and who funds it (platform fee split vs separate funding)** — no in-house clause defines this; only B1 virtual-account commission exists.
5. **Platform vs commission split semantics** — `fee = commission + platform revenue` or separate? Required to size `CREDIT commission` vs `CREDIT revenue`.
6. **VAT/tax** — is `vatBps` required for in-house? B1 tax/VAT is for virtual-account revenue recognition, not in-house W→W. No V1 handoff mandates in-house VAT.
7. **Versioning & cutoff** — does fee rule change require **new version** with effective window (`FeeRule.version`, `effectiveFrom`) and does historical `feeMinor` remain pinned? Must decide to satisfy idempotency §10.
8. **History & disclosure** — must `feeMinor` be customer-visible before confirmation (`POST /fees/calculate` vs `POST /transfers` preview) and in receipt, and with what rounding/currency rules (`ADR-0002` minor units, `NGN` only, `CUSTOMER_FUNDS` only)?
9. **Configurator & governance** — who can author fee rules (`WORKFORCE_SESSION` `SUPPORT` maker `OPERATOR` checker, B2F06 finance control `standard/elevated/material` bands, A2 privileged approval evidence `FINANCE_A5_AR_ACCOUNT_PROVISION` pattern)?

---

## 15. Required Accounting Decisions (exact)

1. **Ledger account code(s)** — authoritative code for fee revenue (`FEE-REVENUE-NGN` suggested but **not to be invented** without finance approval; could be `FINANCE-REVENUE-NGN` or `AR` mapping per `B2F03`/`A5T11`), commission payable (`COMMISSION-PAYABLE-NGN` or agent wallet direct credit), VAT payable if needed. Must be created via **B2F03 chart mapping** + **A5T11 approval** (`ArControlAccountProvisioningService` pattern: `PRIVILEGED` approval, `B2F06` control, `DEFINITION_HASH` + `provisioningReference`), not raw `INSERT`.
2. **Account type / normal balance / accounting unit** — `REVENUE/CREDIT/NGN/CUSTOMER_FUNDS` for fee, `LIABILITY/CREDIT` for payable (fits existing `LedgerAccountType` `REVENUE`/`LIABILITY`/`ASSET` taxonomy). Confirm `allowNegativeBalance=false` for revenue.
3. **Journal template** — N-line balanced template per flow (e.g., `DEBIT sourceWallet principal+fee+vat` / `CREDIT destWallet principal` / `CREDIT feeRevenue fee` / `CREDIT vatPayable vat`; plus `DEBIT feeRevenue commission` / `CREDIT commissionPayable` if split) — must be **A5-authored** and versioned akin to `A5-PILOT-BASELINE` templates.
4. **Mapping ownership** — `B2 Finance` (`b2f-finance-account-mappings` `1785753600050`) vs `A5 Ledger` canonical `ledger_accounts` — which books are `FEE-REVENUE` booked to, and whether `B1 revenue-recognition` vs `A5` journal is source of truth (`ADR-0083/0084`: B1 decides, B2 books, A5 records — must not duplicate).
5. **Reconciliation & audit retention** — new `FINANCE_ACCOUNT_MAPPING_HISTORY` outbox retention and `audit_events` `FINANCE_A5_AR_ACCOUNT_PROVISIONED` equivalent for fee accounts.

---

## 16. Whether V1-HARDENING-02A Implementation Is Unblocked

**Unblocked? `NO`.**

- **Authoritative V1 does not contain a closed, normative specification** of which in-house flows are fee-bearing, with what payer/recipient/amount/structure. The only closed spec is **B1 virtual-account inbound funding** (`commercial.virtual-account.inbound-funding.fee|commission`) — which is **not** one of the 9 flows.
- **All evidence that mentions in-house fees labels them `REQUIRES PRODUCT DECISION` / `METADATA ONLY` / `intentional zero-fee`**, not `SHALL` with values. Implementing without those decisions would **invent policy and account codes**, violating the “Do not invent” constraints of this task and of `V1-HARDENING-02`.
- **Existing chart/limit/config primitives are insufficient** to derive correctness by inspection alone (per hardening-02 §8-9: no `FEE-REVENUE` row, no `fee_rules` row, no `commission` column). Therefore **02A is BLOCKED** until §14-15 decisions are made and approved by **Product + B1 Commercial + B2 Finance + A5 Ledger**.

**Neither `VERIFIED` nor `READY` applies:**

- Cannot be `VERIFIED` — that would require an explicit authoritative clause that V1 **shall** be fee-free forever for all flows, and that the current 66-migration behavior satisfies a finalized normative scope. The documents say “can run fee-free” and “if fees required for launch, P1,” not a finalized “fee-free is the requirement.”
- Cannot be `READY` — no authoritative flow+amount+split+configurability matrix exists to implement without invention.

---

## 17. Recommended Next Task

**Do NOT implement `FEE-REVENUE-NGN`, `fee_rules`, `commissionPayable`, or runtime `FeeEngine.calculate` in `TransferService`/`AgentFinancialExecutionService` next.**

Recommended next is **not** a fee wiring task. Per `V1-008-DEPENDENCY-RE-AUDIT.md §5 Ordering rationale` and `V1-PRODUCT-COMPLETION-AUDIT` remaining polish, the dependency-order optimal **V1 hardening** with **zero migrations** and no product-decision blocker is:

> **`V1-HARDENING-02B — Customer Beneficiary `me` Exposure & `beneficiaryId` Transfer Integration`**
> Thin exposure of the existing `BeneficiaryService` (`customer_beneficiaries` `1785753600013`) as `GET/POST/PATCH /customers/me/beneficiaries` (`CUSTOMER SELF`, audit safe) + optional `beneficiaryId` in `POST /customers/me/transfers` resolved via `RecipientResolutionService` (already hardened in `V1-HARDENING-01` as direct `beneficiaryId` → `resolvedDestinationWalletId`). This reuses an already-migrated, already-serviced domain, has **zero new ledger**, unblocks the intended **V1 P1.6 trusted-recipient UX** without external dependencies, and has deterministic acceptance criteria (`feeMinor:"0"` unchanged, idempotency cases A/B, no `agents/me/beneficiaries`).

**Alternatives if Product decides fee-bearing is required for V1 pilot:** Then the next task becomes **`H6: Fees/Limits Runtime via A4 Policy Gate — requires wiring`** (`V1-008 H6`), but **only after** the Product/Finance decisions in §14-15 are documented, approved, and versioned — i.e., convert this audit’s `BLOCKED` into `READY` via a separate decision record/ADR (e.g., `ADR-00xx V1 In-House Fee Policy`) that explicitly states per-flow `flat/percent/min/max/vat` `commission%` and ledger codes. Until that ADR exists, **any** fee implementation would be speculative.

If beneficiary is instead deferred to V2 (recipient resolution via phone already suffices), the alternate recommended nexts are **`RECONCILIATION-OPERATIONALIZATION`** (`GET /internal/reconciliation/breaks` resolve) or **Wallet-History unification** — both **hardening, not new money**, and neither blocked.

---

## 18. Final Status

**`BLOCKED — V1 FEE POLICY REQUIRES PRODUCT/ACCOUNTING DECISION`**

---

## 19. Raw Audit Evidence (sample)

- `grep -rn fee docs --include=*.md | head` → `V1-PRODUCT-COMPLETION-AUDIT.md:298 V1-004 Fees/Limits METADATA ONLY ... REQUIRES PRODUCT DECISION`
- `cat docs/V1-PRODUCT-COMPLETION-AUDIT.md | sed -n '204,215p'` → *“Fee engine ... METADATA ONLY ... not called by TransferService ... Status: METADATA ONLY ... Requires Product Decision”*
- `cat docs/A5-PILOT-BASELINE.md | sed -n '171,172p'` → *“Fees, commissions, pricing, customer tiers ... unless separately approved by a later A5 task.”*
- `cat docs/ADR/ADR-0061-Commercial-Plan-Boundary.md | sed -n '51,52p'` → *“first commercial scope ... capabilities `...fee` and `...commission`”* under `VIRTUAL_ACCOUNT` `NIBSS_NIP` — not wallet/agent
- `grep -rn FeeEngine src/transfer src/agent | cat` → **0 usage** (runtime fee-free proven)
- `SELECT code FROM ledger_accounts ORDER BY code` after 66 → `AGENT_FUNDING_POOL-NGN`, `PAYMENT-SETTLEMENT_ASSET-NGN`, `PAYMENT-SETTLEMENT_CLEARING-NGN`, `PAYMENT-SYSTEM_SUSPENSE-NGN`, `CASH_TO_CASH-UNCLAIMED-NGN` — **no FEE/COMMISSION**

---

## 20. Source Changes Confirmation

- **Source changes:** `0` — `git diff --stat HEAD` `0` for `src/**` (this audit touched no `src` file).
- **Migration changes:** `0` — `ls src/migrations | wc -l` `66`, no `1785753600066-*` created.
- **Ledger changes:** `0` — `git diff HEAD -- src/ledger` `0`, no `ledger_accounts` row added (verified via `SELECT` above).
- **Route changes:** `0` — `git diff HEAD -- src/*controller*` `0`, no `POST /internal/fees/rules` or `FEE-REVENUE` route added.
- **Only file written:** `docs/V1-HARDENING-02A-FEE-POLICY-DECISION.md` (this documentation-only audit, allowed per Step 8).

