# V1-COMMERCIAL-IMPLEMENTATION-AUDIT-01 (CIA-01)

- **Task ID:** V1-COMMERCIAL-IMPLEMENTATION-AUDIT-01
- **Repository:** `shyne240/monienaija`, branch `arena/01a0d883-monienaija`
- **Base HEAD at read:** `e346210` (P-DEC-01 close)
- **Date:** 2026-09-28
- **Mode:** AUDIT ONLY. No code, migration, seed, ledger, limit, authorization, or provider change is proposed or implemented by this document. This document converts `docs/V1-COMMERCIAL-POLICY-DECISION-PACK.md` (P-DEC-01) into a deterministic implementation-dependency map.
- **Gap vocabulary (only):** `EXISTS`, `PARTIAL`, `MISSING`, `NOT REQUIRED`, `BLOCKED BY POLICY`.
- **Fee representability scale (§4 only):** `SUPPORTED NOW`, `PARTIALLY SUPPORTED`, `NOT SUPPORTED`, `NOT YET WIRED TO FINANCIAL EXECUTION`.
- **SMS event scale (§11 only):** `REQUIRED FOR V1`, `OPTIONAL FOR V1`, `PUSH ONLY`, `SMS ONLY`, `SMS+PUSH`, `NOT REQUIRED`.
- Every `MISSING` states why it is required and which decision (D-…, §9-D…, or a named new-human-decision) triggers the work.
- **Policy-decision references** (`D-…`) resolve to the P-DEC-01 register. **Dependency references** (`§9-D1…§9-D8`) resolve to P-DEC-01 section 9. New audit findings use `SMS-x`, `SNP-x`, `D1F-x` prefixes locally.

---

## 1. Executive Summary

The V1 codebase is **commercially complete at the evidence layer and commercially inert at the execution layer**. Every one of the seven product flows enforces limits, journals money, records an immutable commercial-decision snapshot, and enqueues notification outbox events inside the same database transaction. What does not exist is the arithmetic-and-posting spine for fees, the flow invocation of the commission and reward engines, the ledger account families any commercial posting would need, the customer-facing fee/quote receipt surfaces, and the production SMS delivery path.

Verdicts by area:

| Area | Verdict | Headline gap |
|---|---|---|
| Commercial architecture (rule registries, resolvers, snapshot, limits, ledger) | EXISTS | None structural; this layer is the V1 asset |
| Fee charging | MISSING → BLOCKED BY POLICY | No fee calculator, no charge wiring, no commercial account families; trigger chain D-F-001…D-M-002 |
| Commission allocation | MISSING → BLOCKED BY POLICY | Engine+schema exist; never invoked in-flow; trigger chain D-C-001…D-C-016 |
| Reward grants | MISSING → BLOCKED BY POLICY | Engine+schema exist; never invoked; usage-state store absent; trigger chain D-R-001…D-R-022 |
| Commercial snapshot evidence | PARTIAL | Core evidence record EXISTS; three production-grade enrichments identified (§7); none blocks configuration-only policy work |
| Limit↔commercial interaction | PARTIAL | Enforcement input is principal-only by current mechanics; fee-inclusive exposure is BLOCKED BY POLICY (D-L-005) |
| Customer disclosure | PARTIAL | Unified history projects principal/currency/`feeMinor:'0'` safely; quote, VAT, total, line-item receipt are MISSING (§9-D7) |
| D1 Customer Funding | Verdict: **operations-funding implementation is complete for the D3 interpretation; the D1 customer-initiated process is MISSING and BLOCKED BY POLICY (D-D-001)** | §10 |
| SMS (V1 launch requirement) | PARTIAL | Pipeline insert path exists end-to-end into delivery rows; no production adapter, no background worker, no retry, no PUSH/AGENT contact data (§11) |

No implementation is a blocker in reverse: **every outstanding item is gated by a named human decision, not by missing engineering primitives.** The single structural exception is the SMS background worker (code, no policy gate) and the production SMS provider adapter (code gated by a provider-selection decision).

**Provider decision status:** Provider decision not recoverable from current repository evidence. Candidate names recorded in docs verbatim (§11.6).

---

## 2. Current Commercial Architecture

### 2.1 Rule registries and resolvers (EXISTS)

| Component | File(s) | What exists today |
|---|---|---|
| Fee rules (V1) | `src/fee-rules/fee-rule.entity.ts` | Columns: `product_code`, `currency(3)`, `flat_fee_minor`, `percentage_bps`, `minimum_fee_minor`, `maximum_fee_minor`, `vat_bps`, `effective_from`, `effective_to`, `priority`, `is_active`, `created_by`/`updated_by`, optimistic `version`. **No** model discriminator column (combination is inferred from which value columns are non-null); **no** payer column; **no** KYC/agent targeting; **no** campaign code |
| Fee resolver | `src/fee-rules/` | Deterministic rule resolution; already dependency-injected into financial flows for evidence (below) |
| Commission rules | `src/commission/commission-rule.entity.ts` | `recipient_type IN (AGENT, AGGREGATOR, PLATFORM)`; `calculation_model IN (FLAT, PERCENTAGE, PERCENTAGE_MIN, PERCENTAGE_MAX, PERCENTAGE_MIN_MAX, FLAT_PLUS_PERCENTAGE)`; `calculation_basis IN (PRINCIPAL, FEE, NET)`; `flat_commission_minor`, `percentage_bps`, `minimum_commission_minor`, `maximum_commission_minor`, `tiers` jsonb; targeting `agent_class_id`, `agent_id`, `aggregator_id`; effective window, priority, optimistic version |
| Commission engine | `src/commission/commission.engine.ts` + `commission.calculator.ts` | Allocation computation with clamp discipline; output = allocations carrying beneficiary, amount, basis, rule identity/version |
| Reward rules | `src/reward/reward-rule.entity.ts` | `beneficiary_type IN (CUSTOMER, AGENT)`; `reward_type IN (CASHBACK, BONUS, PROMOTION)`; `calculation_model IN (FIXED, PERCENTAGE, …)`; `flat_reward_minor`, `percentage_bps`, `minimum_reward_minor`, `maximum_reward_minor`, `tiers` jsonb; targeting `customer_id`, `customer_kyc_level (NONE/LEVEL_1/LEVEL_2/LEVEL_3)`, `agent_class_id`, `agent_id`, `campaign_code`; effective window, priority |
| Reward engine | `src/reward/reward.engine.ts` + `reward.calculator.ts` | Grant computation; **no usage/frequency/cumulative store is queried by the engine** (verified: no `usage`/`frequency`/`cumulative`/`cap` references in engine or types) |
| Limit catalog (V1 runtime) | `src/limit-catalog/` | Profile/rule/assignment model consumed by `LimitEnforcementService` in-flow |
| Limit (V2-era) | `src/limit/` | Dormant; not part of V1 runtime |

### 2.2 Financial-flow wiring (what is connected today)

| Capability | Status | Evidence |
|---|---|---|
| Fee rule resolution for **evidence only** | EXISTS | `FeeRuleResolverService` injected into flows (e.g., `transfer.service.ts:86`); captured into snapshot `feeDecision.ruleRefs` |
| Fee **calculation and charging** | MISSING | No fee calculator entity/service exists in `src/`; no fee leg is posted anywhere |
| Commission engine invocation in any flow | MISSING | `commission.engine.ts` is never imported by a financial-flow service |
| Reward engine invocation in any flow | MISSING | `reward.engine.ts` is never imported by a financial-flow service |
| Limit enforcement in all 7 flows | EXISTS | Principal-amount input only (e.g., `transfer.service.ts:306–313` passes `command.amountMinor`) |
| Double-entry journal posting in flows | EXISTS | Ledger journal families per flow (P-DEC-01 §3 matrices) |
| Commercial-decision snapshot per financial transaction | EXISTS | `src/commercial-decision/` entity+service; immutable via BEFORE UPDATE/DELETE trigger; supersede lineage with mandatory reason |
| Outbox enqueue for notification events | EXISTS | In-transaction enqueues at `transfer.service.ts:422,567`; `customer-funding.service.ts:221,496,579`; `support.service.ts` (5 event types) |
| Fee persistence on `transfers` table | MISSING | No fee/vat columns on `transfer.entity.ts` |
| Fee persistence on `cash_to_cash_transfers` | EXISTS (slot) | `fee_minor`, `vat_minor` bigint columns, default `'0'` (`src/agent/cash-to-cash.entity.ts:30–34`) |
| Fee persistence on `customer_funding_requests` | MISSING | No fee/vat columns; history projection hardcodes `'0'` |

### 2.3 Snapshot evidence schema (EXISTS — details in §7)

`commercial_decision_snapshots` carries: product, direction, channel, principalType/principalId, currency, `principal_amount_minor` (bigint, string-transformed), `transaction_reference`, `correlation_id`, `journal_id`, `decision_status (PENDING/FINAL)`, `finalized_at`, `decided_at`, jsonb sections `feeDecision`/`commissionDecision`/`rewardDecision`/`limitDecision` and nullable `revenueDecision`, `configuration_version` (varchar(80), **unpopulated today**), `snapshot_schema_version` (default 1), `supersedes_snapshot_id` + `superseded_reason`, `created_by`. The service validates per-section status vocabularies, rule-ref array shape, journal linkage when FINAL, and requires a reason on supersession. `FeeDecisionSnapshot` shape: `{status, paymentType, currency, amountMinor, feeMinor, vatMinor, totalMinor, ruleRefs[]}`. `CommercialRuleRef` shape: `{ruleId, ruleVersion?, ruleCode?, dimension?, limitValueMinor?, limitValueCount?}`.

### 2.4 Notification pipeline (EXISTS — launch-blocking gaps in §11)

Event → in-transaction outbox row → `NotificationDispatcherService.processPendingOutboxEvents` → `mapEventToIntents` (template key + channel 'SMS' per intent) → `NotificationChannelResolverService` (CUSTOMER: primary/normalized phone from `customer_contact_methods`; AGENT: destination `null` reason `AGENT_PHONE_DEPENDENCY_MISSING`; PUSH: `PUSH_TOKEN_DEPENDENCY_MISSING`) → idempotent delivery insert `ON CONFLICT (event_key, recipient_id, channel) DO NOTHING` (status PENDING or SKIPPED with reason in `destination`) → `provider.send` isolated from finance (failure → FAILED, never throws) → SENT rows carry `provider_ref` + `sent_at`. Default provider = `ConsoleNotificationProvider` (`notification.module.ts` factory). A `TestNotificationProvider` with `shouldFail` exists for tests. **No process anywhere calls `processPendingOutboxEvents` in production** (no cron, no scheduler, no worker). The customer inbox (`notification-inbox.service.ts`) is a **read projection of `notification_deliveries`**: PENDING/SENT/FAILED all render `IN_APP/AVAILABLE`; SKIPPED rows are hidden.

---

## 3. Product-by-Product Implementation Matrix

Products per P-DEC-01 §3 (flow codes as used in snapshots/rules): `WALLET_TRANSFER`, `AGENT_CASH_IN`, `AGENT_CASH_OUT`, `CASH_TO_CASH`, `CUSTOMER_FUNDING`, `AGENT_FUNDING`, `AGENT_DEFUNDING`.

| Product | Flow + ledger | Limits | Snapshot | Fee evidence | Fee charge | Commission | Reward | Fee persistence | Disclosure | Notification events |
|---|---|---|---|---|---|---|---|---|---|---|
| WALLET_TRANSFER | EXISTS | EXISTS | EXISTS | EXISTS (resolver→ruleRefs) | MISSING — BLOCKED BY POLICY (D-F-001/004) | MISSING — BLOCKED BY POLICY (D-C-001) | MISSING — BLOCKED BY POLICY (D-R-001) | MISSING (no columns) | PARTIAL (`feeMinor:'0'`) | PARTIAL (outbox enqueues `transfer.completed/failed`; delivery path §11) |
| AGENT_CASH_IN | EXISTS | EXISTS | EXISTS | EXISTS | MISSING — BLOCKED BY POLICY (D-F-001) | MISSING — BLOCKED BY POLICY (D-C-001) | MISSING — BLOCKED BY POLICY (D-R-001) | MISSING | PARTIAL (agent-side views carry zero fee) | PARTIAL |
| AGENT_CASH_OUT | EXISTS | EXISTS | EXISTS | EXISTS | MISSING — BLOCKED BY POLICY (D-F-001) | MISSING — BLOCKED BY POLICY (D-C-001) | MISSING — BLOCKED BY POLICY (D-R-001) | MISSING | PARTIAL | PARTIAL |
| CASH_TO_CASH | EXISTS | EXISTS | EXISTS | EXISTS | MISSING — BLOCKED BY POLICY (D-F-001) | MISSING — BLOCKED BY POLICY (D-C-001) | MISSING — BLOCKED BY POLICY (D-R-001) | EXISTS (slot; always zero) | PARTIAL (`fee_minor` surfaced, always zero) | MISSING emission — claim/expiry events are mapped but **no outbox enqueue exists** in `agent-cash-to-cash*.service.ts` |
| CUSTOMER_FUNDING | EXISTS | EXISTS | EXISTS | EXISTS | MISSING — BLOCKED BY POLICY (D-F-007, D-D-004) | MISSING — BLOCKED BY POLICY (D-C-002 scope; expected none per D-C-010) | MISSING — BLOCKED BY POLICY (D-R-002/D-R-003) | MISSING | PARTIAL (`'0'` hardcoded) | PARTIAL (outbox enqueues requested/approved/rejected at lines 221/496/579) |
| AGENT_FUNDING | EXISTS | EXISTS | EXISTS | EXISTS | MISSING — BLOCKED BY POLICY (D-F-008) | NOT REQUIRED (per D-C-010 expectation; confirm) | MISSING — BLOCKED BY POLICY (D-R-003) | MISSING | NOT REQUIRED (internal ops flow) | PARTIAL |
| AGENT_DEFUNDING | EXISTS | EXISTS | EXISTS | EXISTS | MISSING — BLOCKED BY POLICY (D-F-008) | NOT REQUIRED (per D-C-010 expectation; confirm) | MISSING — BLOCKED BY POLICY (D-R-003) | MISSING | NOT REQUIRED (internal ops flow) | PARTIAL |

Reading rule for the matrix: every `MISSING` above is required **only when its named decision resolves to the charging/granting answer**. Until then the current behavior (explicit zero evidence) is correct-by-policy.

---

## 4. Fee Implementation Gap (representability matrix)

Scale: `SUPPORTED NOW` / `PARTIALLY SUPPORTED` / `NOT SUPPORTED` / `NOT YET WIRED TO FINANCIAL EXECUTION`. "Wired to financial execution" means: the quantity is computed, persisted on the transaction, journal-posted, and disclosed. Nothing below the evidence layer is wired today.

| # | Fee capability | Rating | Basis + trigger if gap |
|---|---|---|---|
| 1 | FREE / explicitly-zero fee per product | SUPPORTED NOW | Snapshot status vocabulary records zero/not-chargeable with resolver rule evidence |
| 2 | FLAT fee per transaction | NOT YET WIRED TO FINANCIAL EXECUTION | `flat_fee_minor` column + resolver exist; calculator MISSING → §9-D1 (D-F-004, D-M-001) |
| 3 | PERCENTAGE of principal | NOT YET WIRED TO FINANCIAL EXECUTION | `percentage_bps` exists; calculator MISSING → §9-D1 (D-F-004, D-M-001) |
| 4 | FLAT + PERCENTAGE hybrid | PARTIALLY SUPPORTED | No model discriminator column; hybrid is only inferable from both columns non-null. Adding an explicit discriminator is part of §9-D2 if D-F-004 selects hybrid families |
| 5 | Minimum fee clamp | NOT YET WIRED TO FINANCIAL EXECUTION | `minimum_fee_minor` exists; clamp semantics in calculator MISSING → §9-D1 (D-M-002 ordering) |
| 6 | Maximum fee cap | NOT YET WIRED TO FINANCIAL EXECUTION | `maximum_fee_minor` exists; same trigger as #5 |
| 7 | VAT computed on fee | NOT YET WIRED TO FINANCIAL EXECUTION | `vat_bps` exists on rule; no VAT arithmetic or VAT legs anywhere → §9-D1 + D-GL-002 (trigger D-F-005) |
| 8 | VAT modeling on rule (rate slot) | SUPPORTED NOW (schema) | `vat_bps` nullable column; exempt/zero-rated classification NOT SUPPORTED (no classification column) → §9-D2 if D-F-005(c) selected |
| 9 | Payer model (customer/debit-extra/inclusive/absorbed) | NOT SUPPORTED | No payer column on `fee_rules`; verified absent → §9-D2 (D-F-003) |
| 10 | Per-product targeting (7 products) | SUPPORTED NOW | `product_code` + resolver |
| 11 | Per-currency targeting | SUPPORTED NOW | `currency` + resolver |
| 12 | KYC-tier fee differentiation | NOT SUPPORTED | No KYC column on `fee_rules` → §9-D2 (D-K-001) |
| 13 | Agent-class fee differentiation | NOT SUPPORTED | No agent-class column → §9-D2 (D-A-001) |
| 14 | Individual-agent fee override | NOT SUPPORTED | No agent-id column → §9-D2 (D-A-003) |
| 15 | Effective-from/to dating | SUPPORTED NOW | Window columns + resolver honored |
| 16 | Versioning + priority precedence (within product+currency scope) | SUPPORTED NOW | Optimistic version + priority + audited administration |
| 17 | Fee-inclusive vs fee-on-top display convention | NOT SUPPORTED | Display/decision semantics undecided → D-F-006; calculator MISSING → §9-D1 |
| 18 | Fee counted toward limit consumption | NOT SUPPORTED | Enforcement input is principal-only (`transfer.service.ts:306–313`) → D-L-005; §9-D1 prerequisite |
| 19 | Fee persisted on `transfers` | NOT SUPPORTED | No fee/vat columns on transfers table → migration in §13 (trigger D-F-001 selecting b/c) |
| 20 | Fee persisted on funding tables | NOT SUPPORTED | No columns on `customer_funding_requests` / agent funding; C2C slot EXISTS → §13 (trigger D-F-007/008) |
| 21 | Pre-commit quote + receipt line items | PARTIALLY SUPPORTED | Customer projection carries `feeMinor` field (always `'0'`); no quote surface, no VAT/total/rule-aware receipt → §9-D7 (D-I-001/002) |
| 22 | Fees on funding products (CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING) | NOT SUPPORTED | No columns/computation; chain D-D-004/D-F-007/D-F-008 → §9-D1 + §13 |

**Fee section summary:** the rule-registry substrate supports items 1, 8, 10, 11, 15, 16 today; the calculator+posting spine (items 2, 3, 5, 6, 7, 17) is a single dependency §9-D1; structural schema gaps (4, 9, 12, 13, 14, 19, 20, 22) are the additive migration set in §13; display/limit interactions (17, 18, 21) are policy-decisioned surfaces.

---

## 5. Commission Implementation Gap

Engine, calculator, registry, and resolver API all EXIST. Ratings below describe the **end-to-end V1 capability**, not the component in isolation.

| # | Commission capability | Rating | Why required / trigger |
|---|---|---|---|
| 1 | Rule targeting an individual AGENT | EXISTS (schema+engine); wiring MISSING | Engine never invoked in flows → §9-D6 pilot (D-C-001) |
| 2 | Rule targeting an AGENT CLASS | EXISTS (schema; `agent_class_id` column) | Resolver honors today; wiring per #1; permission to use = D-A-002/D-C-007 |
| 3 | Individual-agent overrides on class rules | EXISTS (schema; `agent_id` + priority) | Precedence across scopes = D-C-011; same wiring as #1 |
| 4 | AGGREGATOR recipients | PARTIAL | Rule vocabulary + `aggregator_id` targeting exists; **no aggregator ledger identity exists to credit** → D-C-009 with §9-D4 design. Genuinely required for V1 only if D-C-002 admits aggregators; otherwise NOT REQUIRED and the vocabulary remains dormant |
| 5 | PLATFORM allocation (remainder/own share) | EXISTS (schema vocabulary `PLATFORM`) | Mapping of PLATFORM into ledger accounts = D-C-010 + §9-D3; posting MISSING |
| 6 | Calculation basis PRINCIPAL | EXISTS (engine supports) | Wiring per #1 |
| 7 | Calculation basis FEE / NET | PARTIAL | Engine supports the vocabulary; FEE/NET base is zero by construction until fees exist → requires §9-D1 first if D-C-003/D-C-016 select a fee-derived base |
| 8 | Flat model | EXISTS (engine) | Wiring per #1 |
| 9 | Percentage model (with rounding discipline) | EXISTS (engine; floor discipline per calculator) | Final rounding family D-M-001 confirmation applies at pilot |
| 10 | Flat + percentage hybrid | EXISTS (schema `FLAT_PLUS_PERCENTAGE`) | Wiring per #1 |
| 11 | Min-only / max-only variants | EXISTS (`PERCENTAGE_MIN`, `PERCENTAGE_MAX`) | Wiring per #1 |
| 12 | Min-max band | EXISTS (`PERCENTAGE_MIN_MAX`) | Wiring per #1 |
| 13 | Tiered/bracket rates | EXISTS (schema `tiers` jsonb) | Bracket semantics vote = D-C-006; engine honoring of tiers verified at calculator level only — pilot must prove |
| 14 | Effective dating + versioning | EXISTS | Window + optimistic version; governance cadence = D-C-012 |
| 15 | Cross-scope precedence (agent > class > product) | PARTIAL | Priority column exists; the precedence hierarchy *policy* = D-C-011/D-P-001; resolver contract decision-only |
| 16 | Immediately-payable posting on transaction | MISSING | No ledger legs exist → D-C-013/D-C-015 + §9-D3 account families; posting code = flow wiring §9-D6 |
| 17 | Accrued-then-settled payables | MISSING | No accrual liabilities/payout mechanism; settlement rail = D-C-014 (payout execution is V2 per A18 boundary) |
| 18 | Commission accounting families in ledger | MISSING — BLOCKED BY POLICY | Required for ANY commission posting: fee-revenue is a prerequisite of FEE-basis legs; COMMISSION-EXPENSE + COMMISSION-PAYABLE families per D-GL-004/005; §9-D3 provisioning (pattern: AR-control) |
| 19 | Reversal of commission on reversed/failed underlying | MISSING — BLOCKED BY POLICY | Behavior undecided: D-V-003; mechanics depend on D-V-001 (reversal ops workflow) |
| 20 | Settlement/batching cadence | NOT REQUIRED (V1) | A PAYOUT ledger pending decision D-C-014; batch payout files/rails are V2 scope |

**Aggregator ledger identity — the architectural decision:** an aggregator, if admitted by D-C-002, either (a) receives a **ledger-account identity** provisioned per §9-D3 (a payable-like account per aggregator, journal legs at allocation time), or (b) is recorded **off-ledger as accrual evidence** in the snapshot only, with crediting deferred to the V2 payout rail. Option (a) is required for a V1 where aggregator commission is *payable-instant*; option (b) is consistent with accrued cadence D-C-015. Both options are config/provisioning work once decided; neither requires schema change. **No decision exists; nothing may be provisioned.**

---

## 6. Reward Implementation Gap

| # | Reward capability | Rating | Why required / trigger |
|---|---|---|---|
| 1 | CASHBACK grants | EXISTS (engine vocabulary) | Wiring MISSING → §9-D6 (D-R-001/002) |
| 2 | BONUS grants | EXISTS (engine vocabulary) | Same |
| 3 | PROMOTION grants | PARTIAL | Vocabulary + `campaign_code` field exist; **no campaign system exists and none is created by this program** (standing prohibition); D-R-012 defines the promotion *model* without any build commitment |
| 4 | KYC-tier differentiation | EXISTS (schema `customer_kyc_level` targeting) | Policy D-R-004 |
| 5 | Per-product targeting | EXISTS | Policy D-R-001 answer set |
| 6 | Campaign-code linkage on rules | PARTIAL | Field exists; no campaign registry = vocabulary only; NOT REQUIRED for V1 unless D-R-012 says otherwise |
| 7 | Percentage-of-base grants | EXISTS (engine) | Basis decision D-R-006; FEE/NET bases inherit §9-D1 |
| 8 | Fixed-amount grants | EXISTS (engine `FIXED`) | Wiring per §9-D6 |
| 9 | Min/max bounds on grants | EXISTS (schema columns) | Clamp order decision D-R-007 + D-M-002 |
| 10 | Tiered grant schedules | EXISTS (schema `tiers`) | Bracket semantics D-R-008 |
| 11 | Per-transaction cap | EXISTS (max column semantics per rule) | D-R-010 policy values only |
| 12 | Frequency caps (N per period) | MISSING — BLOCKED BY POLICY | **No usage-state store exists**; engine never reads counters → §9-D5 (D-R-009). Required when any frequency-cap policy is enabled |
| 13 | Cumulative caps (running total) | MISSING — BLOCKED BY POLICY | Same store family as #12 → §9-D5 (D-R-011) |
| 14 | Grant expiry | MISSING — BLOCKED BY POLICY | No expiry on grants today (rule windows only); behavior undecided D-R-018; required only if expiry policy = yes |
| 15 | Reward reversal on failed/reversed underlying | MISSING — BLOCKED BY POLICY | D-R-019/D-R-020 + D-V-004; reversal ops workflow D-V-001 prerequisite |
| 16 | Funding source (liability/expense families) + usage-state coexistence with fees/commission | MISSING — BLOCKED BY POLICY | D-R-021/D-R-022; ledger families per D-GL-004/005 → §9-D3; grant crediting timing D-R-016/D-R-017 |

**Summary:** the grant-computation engine is policy-ready. The **accounting sink (§9-D3), the usage-state store (§9-D5), and the expiry/reversal behaviors (D-R-018/019/020)** are the three non-engine dependencies, all decision-gated.

---

## 7. Commercial Snapshot Gap (evidence completeness)

The snapshot is the V1 audit record. The 11 required evidence classes vs current schema:

| # | Evidence class | Rating | Detail |
|---|---|---|---|
| 1 | Product, direction, channel | EXISTS | Columns present; validated |
| 2 | Principal identity and type | EXISTS | `principal_type`, `principal_id` |
| 3 | Principal amount + currency | EXISTS | bigint-transformed minor units |
| 4 | Transaction/correlation/journal references | EXISTS | All three; journal linkage enforced for FINAL |
| 5 | Fee decision | EXISTS | Status, amounts incl. `totalMinor`, ruleRefs |
| 6 | Commission decision | EXISTS | Status + allocations (see gap SNP-1 below) |
| 7 | Reward decision | EXISTS | Status + grants (see SNP-1) |
| 8 | Limit decision | EXISTS | Profile/assignment/failure code + ruleRefs carrying dimension and limit values + reservation/usage id arrays |
| 9 | Revenue decision | PARTIAL | Nullable, optional-by-design slot; population standard not defined (no policy yet; no harm at zero) |
| 10 | Rule ids, versions, effective-time parameter capture | PARTIAL | ruleId/ruleVersion/ruleCode carried; `limitValueMinor/Count` carried for limits; open `[key: string]: unknown` on ruleRefs lets flows record effective parameters (flat values etc.) — flows do this today for limit refs, **fee/commission/reward effective-parameter capture is only structurally available, not yet standardized** |
| 11 | Actor context, timestamps, correction lineage | PARTIAL | `created_by`, `decided_at`, `finalized_at`, supersedes-with-reason all present; **actor-of-record for workforce-initiated flows** (maker vs checker) is not a snapshot field — it lives in flow-side tables (funding maker/checker ids). Production-grade completeness wants a compact actor-context slot |

Production-grade V1 record gaps (all PARTIAL/MISSING, none currently harmful at zero-commercial state):

| ID | Gap | Rating | Why required / trigger |
|---|---|---|---|
| SNP-1 | **Calculation-input amounts inside allocations/grants** (the base amount each allocation/grant was computed from) are not in the snapshot allocation/grant shape, while the engine decision objects do carry base amounts | PARTIAL | Deterministic replay/audit of every allocation without re-resolving rules; required before §9-D6 pilots record their first live snapshots (trigger: §9-D6 evidence standard) |
| SNP-2 | **`configuration_version` is never populated** | PARTIAL | The designated pin for the policy/configuration epoch is dead code today; required the first time policies change so snapshots are attributable to configuration time (trigger: §9-D6/D-M-002 effective governance) |
| SNP-3 | **Failure-during-posting snapshot semantics** (commercial decision computed, journal posting failed) | MISSING — BLOCKED BY POLICY | Behavior undecided: D-GL-009; required because the snapshot writer currently runs inside the same transaction as posting, so a posting failure yields NO snapshot at all — after §9-D6/D1 the decision may precede posting and a vocabulary decision is needed (record-failed vs rollback) |

Verdict: the snapshot **schema is sufficient for V1 launch with zero commercial activity**; SNP-1/2/3 harden it for the pilot phase and are additive (schema-version bump discipline already exists via `snapshot_schema_version`).

---

## 8. Limit / Commercial Interaction

| Aspect | Rating | Detail |
|---|---|---|
| Limit enforcement inside commercial-bearing flows | EXISTS | Catalog runtime evaluates transactional + window limits before posting; outcomes captured into `limitDecision` |
| Limit values captured in commercial evidence | EXISTS | `limitValueMinor`/`limitValueCount` on ruleRefs |
| Fee-inclusive exposure (does `principal + fee + VAT` consume limit) | MISSING — BLOCKED BY POLICY | Enforcement input is principal-only today (`transfer.service.ts` limit call passes `command.amountMinor`); decision D-L-005. Required the day any fee exists on a limit-gated flow; wiring = pass computed total into enforcement evaluate — depends on §9-D1 calculator ordering |
| Commercial rules altering limit behavior | NOT REQUIRED | No such coupling specified for V1 |

Interplay to preserve: limit enforcement precedes journal posting; any §9-D1 implementation must keep the ordering **limit-check-total → post principal+fee legs atomically** inside one transaction (atomicity exists today).

---

## 9. Customer Disclosure Gap

Current customer-facing projection (`customer-app/customer-transaction-history.service.ts`): unified history selects id, type, status, `amountMajor/Minor`, `currency`, timestamps, reference, narration, wallet ids, failure fields, and `feeMinor` — with an explicit safe-projection step (line 366) that hides PIN/OTP hashes, journal ids, ledger-account ids, and workforce internals. `feeMinor` is hardcoded `'0'` for FUNDING rows and carried from the (always-zero) C2C column.

**Can a fee-bearing transaction safely expose principal / fee / VAT / total / currency / commission / reward / rule-ref to the customer?**

| Field | Safe to expose | Current projection | Required mechanics |
|---|---|---|---|
| principal amount + currency | YES — public | EXISTS | none |
| fee amount | YES — public commercial term | PARTIAL (field exists, always `'0'`) | §9-D1 + persistence (§13) + projection stop hardcoding `'0'` |
| VAT amount | YES — tax disclosure | MISSING | same chain, trigger D-F-005 |
| total debited (principal+fee+VAT) | YES — mandatory for correct wallets UX | MISSING | arithmetic surface in API contract; trigger D-I-002 |
| commission (agent economics) | **NO — internal pricing; NOT REQUIRED for customer surfaces** | correctly absent | keep redacted (projection already does) |
| reward/cashback granted to customer | YES — when grants exist | MISSING | grant-to-customer surface; trigger D-R-001/§9-D6; V1-safe when grants-none |
| rule-ref / rule ids | **NO for internal identifiers; expose only product-facing voucher/reference text** — NOT REQUIRED | correctly absent | disclosure design under D-I-002 |

Agent-side views: agent C2C detail already surfaces `feeMinor`/`vatMinor` (always zero) — the field slots exist; values become real only after §9-D1 + D-F policy. Pre-commit **quote** (fee shown before PIN) does not exist anywhere → MISSING, BLOCKED BY POLICY (D-I-001) and dependent on §9-D1; it is the A23-sibling contract change §9-D7.

---

## 10. D1 Funding Gap (customer funding process verdict)

Trace of what exists (`customer-funding.service.ts` + history + notifications + snapshot):

1. **Creation:** workforce-typed actor only (4 workforce roles) creates a funding request for a customer; `external_reference` is a 255-char free-text string; no channel/evidence object.
2. **Evidence:** free-text description + external reference; no structured channel (bank-transfer reference object, deposit slip id, card auth code).
3. **Maker/checker:** maker ≠ checker enforced (403), approve/reject endpoints; approval writers distinct from makers.
4. **Approval → ledger:** approve journals DEBIT `PAYMENT-SETTLEMENT_ASSET` / CREDIT customer wallet in the same transaction as CUSTOMER INCOMING limit usage.
5. **Commercial:** snapshot recorded (fee zero evidence); no fee columns on the request table.
6. **Notification:** outbox enqueues `customer.funding.requested` / `.approved` / `.rejected` at lines 221/496/579; resolver sends to customer phone (SMS intents; inbox projection exists).
7. **History:** customer sees FUNDING rows with `feeMinor:'0'`, channel string, external reference, rejection reason.

**D1 finding (D1F-1):** the implementation is a complete, maker-checker-governed, ledger-posting **operations funding process**. It fully satisfies the D3 (operations-assisted funding) interpretation. The **D1 interpretation — a customer-initiated funding request process (customer declares intent, attaches channel-native evidence, ops verifies) — is MISSING and BLOCKED BY POLICY:** existence is D-D-001 (unestablished requirement), channel/evidence objects are D-D-002/D-D-006, fee-on-funding is D-D-004/D-F-007, notification sufficiency is D-I-003. If D-D-001 = YES the work is a **new process (§9-D8)**: channel object schema, evidence capture, verification states, possibly channel-account mapping — it must not be bolted onto the ops table in a configuration-only task.

Gap items if D1 = YES: (a) customer-auth create endpoint (MISSING), (b) structured channel + evidence model replacing 255-char free text (MISSING), (c) fee spine per §9-D1 + columns (§13), (d) customer-visible requested-state semantics already EXISTS via outbox/inbox, (e) limit reuse EXISTS (CUSTOMER INCOMING family).

---

## 11. SMS V1 Implementation Gap

SMS is a V1 launch requirement. This section audits the whole notification stack against that requirement.

### 11.1 What exists (verified)

- Outbox rows enqueued **in the same database transaction** as the financial/support event for: transfer completed/failed; funding requested/approved/rejected; 5 support event types (created/assigned/status-changed/message-added/closed; internal notes filtered; status-changed mapped to resolved/closed templates).
- Intent map produces template keys + channel `SMS` per recipient; dedupes self-transfers; catalogue marks funding/transfer/support events `required:true`; agent-lifecycle + cash-to-cash claim events `required:false, possible:false` (agent phone dependency).
- Channel resolution: CUSTOMER → primary-preferred normalized phone from `customer_contact_methods`; no phone → SKIPPED `CUSTOMER_PHONE_MISSING`. AGENT → always null destination, SKIPPED `AGENT_PHONE_DEPENDENCY_MISSING` (agent entity has no phone). PUSH → SKIPPED `PUSH_TOKEN_DEPENDENCY_MISSING` (no device-token table; `PUSH_OPT_OUT` honored from preferences).
- Delivery insert idempotent on `(event_key, recipient_id, channel)`; provider send isolated (failure → FAILED, never thrown); SENT carries `provider_ref`+`sent_at`; message persisted (1000-char), payload redacted before persistence; `_templateKey` injected into jsonb payload.
- Customer inbox projection (`GET` via customer-app; IN_APP/AVAILABLE for PENDING/SENT/FAILED; SKIPPED hidden).
- Admin/workforce diagnostics surface for notifications EXISTS (hardening suite).
- Test adapter with failure injection EXISTS.
- Customer preferences carry per-channel enable flags (default all true); the resolver comment defers sms-preference enforcement to V1-016 — push opt-out IS honored, sms preference is **not yet enforced** (PARTIAL).

### 11.2 Blocking semantics (verified)

**Financial execution never blocks on SMS.** Outbox enqueue is in-transaction, but provider send runs from the dispatcher afterwards; a provider failure sets FAILED and the outbox row is marked PUBLISHED regardless. There is no reverse dependency. **OTP-blocking is moot today:** no OTP generation/verification machinery exists anywhere (registration has none; W→W authorization uses transaction PIN; C2C uses a hashed transfer code shared out-of-band; MFA `issueChallenge` requires a caller-supplied `challengeHash` and has no delivery channel). Whether an OTP must block execution is therefore a **policy field for each future OTP decision** (§11.5), not a discovered behavior.

### 11.3 Event classification

Scale: REQUIRED FOR V1 / OPTIONAL FOR V1 / PUSH ONLY / SMS ONLY / SMS+PUSH / NOT REQUIRED.

| # | Candidate event | Classification | Channel | Required data | Gap to launch |
|---|---|---|---|---|---|
| 1 | Customer registration / phone verification | OPTIONAL FOR V1 | SMS ONLY when adopted | phone + verification code | Flow does not exist (auth audit A2: no registration OTP); trigger = product decision adopting phone verification + new generation/verification machinery (not provider work) |
| 2 | Login OTP / MFA via SMS | OPTIONAL FOR V1 | SMS ONLY when adopted | phone + code + challenge reference | MFA method vocabulary enumerates SMS but challenge delivery channel is MISSING; PIN+TOTP posture exists; trigger = product decision that SMS is an allowed MFA channel |
| 3 | Transaction OTP (step-up/high-value) | OPTIONAL FOR V1 | SMS ONLY when adopted | phone + code + challenge + amount context | No OTP machinery; transaction PIN is the V1 authorization primitive; trigger = product decision on step-up authorization |
| 4 | Wallet→Cash authorization notice | OPTIONAL FOR V1 | SMS+PUSH | amount, wallet ref, timestamp | C2C initiation emits no outbox event today (verified); map exists; trigger = wiring emission (implementation, not policy) — OPTIONAL because claimant flow is code-based |
| 5 | Customer Funding requested/approved/rejected | REQUIRED FOR V1 | SMS+PUSH (SMS primary; inbox EXISTS) | amount, currency, reference, status, rejection reason | Outbox emission EXISTS; worker + provider adapter REQUIRED (SMS-1/SMS-2) |
| 6 | Transaction completion (transfer completed both parties / failed source) | REQUIRED FOR V1 | SMS+PUSH (SMS primary; inbox EXISTS) | amount, counterparty ref, status, failure code | Same chain as #5 |
| 7 | Cash→Cash claimed / expired | OPTIONAL FOR V1 | SMS ONLY when adopted | reference, status | No outbox emission (verified in claim/expiry services); catalogue marks `required:false`; trigger = product decision on beneficiary awareness messaging |
| 8 | Support events (created/assigned/status/message/closed) | REQUIRED FOR V1 (customer) | SMS+PUSH; agent-half NOT REQUIRED | ticket ref, status, category | Customer half: emission EXISTS; worker+adapter REQUIRED. Agent half: BLOCKED on agent phone data (SMS-4) and NOT REQUIRED because agents operate in-app |
| 9 | Agent lifecycle events (6 mapped) | NOT REQUIRED | n/a (PUSH ONLY is unavailable: no device tokens) | — | Catalogue `possible:false` without agent phone; agents are workforce-adjacent identities managed in-app; reclassification requires SMS-4 + product decision |
| 10 | Reward/cashback granted notice | OPTIONAL FOR V1 | SMS+PUSH | grant amount, product ref | No such event exists; trigger = §9-D6/D-R policy; inbox surface EXISTS |

Every `REQUIRED FOR V1` row is launch-blocking only through dependencies SMS-1 and SMS-2 below. No `PUSH ONLY` rows exist: push has no device-token substrate, so push is always an additional channel, never the sole one, at V1.

### 11.4 Gap register (the SMS spine)

| ID | Gap | Rating | Why required / trigger |
|---|---|---|---|
| SMS-1 | **No background worker/poller** drives `processPendingOutboxEvents` (no cron/scheduler anywhere in production bootstrap) | MISSING | Without it zero deliveries occur; required by every REQUIRED FOR V1 event. Pure code+config; no policy gate. V1-005 next-steps names it verbatim |
| SMS-2 | **No production SMS provider adapter** (Console is the module default) | MISSING — BLOCKED BY POLICY | Real delivery requires the provider adapter + env credentials; trigger = provider-selection decision (§11.6) |
| SMS-3 | **No retry semantics** | MISSING | FAILED/SKIPPED are terminal: the unique key makes replays conflict-and-skip, so FAILED deliveries are never re-attempted; attempt-count/backoff design required by launch reliability. TRIGGER: this audit classifies it REQUIRED FOR V1 because REQUIRED events have no second chance otherwise |
| SMS-4 | **No agent phone data model** (agents cannot receive SMS/PUSH) | MISSING | Required only if any AGENT-directed event is ratified required; per §11.3 none is → downgrade OK for launch; stored as non-blocking (§20) |
| SMS-5 | **No device-token model** for PUSH | MISSING | Required only to realize the `+PUSH` half of SMS+PUSH rows; all such rows degrade to SMS ONLY gracefully; non-blocking (§20) unless product ratifies PUSH as sole channel somewhere |
| SMS-6 | **SMS preference flag unenforced** (opt-out honored for PUSH only) | PARTIAL | Regulatory/customer-experience correctness; required for launch posture → enforce in resolver (code); no policy gate |
| SMS-7 | **No delivery-status beyond adapter accept** (SENT = accepted, not delivered; no provider callbacks/webhooks) | PARTIAL | Launch can run on accept-status with documented semantics; true delivery receipts = provider-callback endpoint, V1-optional; semantics must be stated to support (ops doc update) |
| SMS-8 | **No SMS credentials/config environment** | MISSING | No env keys exist; required with SMS-2; secret-handling pattern already used elsewhere in ops config |
| SMS-9 | **Sender ID + provider template registration** | MISSING | Nigerian DND/A2P registration requirements are external ops work, not repo work; REQUIRED FOR V1 as launch checklist with the provider decision |
| SMS-10 | **No OTP generation/verification machinery** | MISSING | Required only for events 1–3 if ratified; standing gap from auth audits; product decisions first (§11.3) |
| SMS-11 | **C2C + agent-lifecycle outbox emission** absent (events mapped, never fired) | MISSING | Required only if classifications #4/#7/#9 change; implementation-only gap |

### 11.5 Idempotency / atomicity / audit posture

| Aspect | Status |
|---|---|
| Idempotent delivery insert (event, recipient, channel) | EXISTS |
| Idempotent outbox enqueue (event key) | EXISTS (in-transaction enqueue uses the event key discipline) |
| Replay safety | PARTIAL — replay re-dispatches PENDING outbox rows but FAILED deliveries are terminal (SMS-3) |
| Financial atomicity | EXISTS — finance and outbox enqueue commit/rollback together; delivery is post-commit |
| Audit trail | EXISTS — delivery rows with status, reason, provider ref, timestamps; redaction before persistence |
| Rate limiting / batching / bulk-send semantics | MISSING — no provider call exists to rate-limit; design belongs to SMS-2 adapter contract |

### 11.6 Provider decision

**Provider decision not recoverable from current repository evidence.** What the repository records, verbatim:

- V1-005 verification report: *"No Twilio/Termii/Africa's Talking import… provider-neutral"*; next-steps list names *"production provider adapter (Termii/Twilio env + HMAC, FCM)"*.
- Hardening-08: *"external provider operations pending (Termii, FCM) — correctly V2/ops-integration."*
- Hardening-10: *"Choose Termii/Twilio for SMS, FCM/APNS for Push — configure A7_PRODUCT_NOTIFICATION_DELIVERY credentials."*

Candidates are named (Termii, Twilio; push: FCM/APNS). No final selection, no signed contract, no sender-ID artifact, and no env-credential document exists in the repository. The interface contract (`NotificationProvider`) is provider-neutral by design and the Console/Test adapters bound today.

---

## 12. Dependency Graph

Policy-gated spine (from P-DEC-01 §9, now with audit verdicts):

```
D-F-001…006 ──► §9-D1 fee calculator + charge wiring ──► §9-D3 fee-revenue + VAT-payable legs
D-F-003/D-K-001/D-A-001/D-P-002 ──► §9-D2 fee schema targeting migration ──► §9-D1 resolver extension
D-GL-001/002/004/005 ──► §9-D3 account-family provisioning ──► any posting (fee/commission/reward)
D-C-001…016 ──► §9-D6 commission pilot wiring ──► §9-D3 commission expense/payable legs
D-C-009 ──► §9-D4 aggregator crediting design (only if aggregator admitted)
D-R-001…022 ──► §9-D6 reward pilot wiring ──► §9-D3 reward liability/expense legs
D-R-009…011 ──► §9-D5 usage-state store ──► grant evaluation reads counters
D-I-001/002 (+D-L-M-010) ──► §9-D7 disclosure surfaces ──► §9-D1 outputs
D-L-005 ──► limit input = principal+fee total ──► after §9-D1 (ordering discipline §8)
D-D-001 ──► §9-D8 D1 flow build (only if YES; else ops funding stands)
D-V-001/002/003/004 ──► reversal semantics for all commercial legs ──► after posting exists
```

SMS spine (this audit):

```
SMS-2 provider adapter + SMS-8 credentials ──► SMS-9 sender-id/template registration (external ops)
SMS-1 worker ──► every §11.3 REQUIRED FOR V1 event goes live
SMS-3 retry design ──► REQUIRED-event reliability
SMS-6 preference enforcement ──► compliance posture
SMS-1 + SMS-2 are independent of every commercial policy decision.
```

Ordering theses verified: (a) §9-D6 (commission, basis PRINCIPAL) does **not** require §9-D1; FEE/NET bases do. (b) §9-D7 requires §9-D1 outputs but not §9-D6. (c) SMS spine is parallel-safe with the whole commercial spine. (d) §9-D8 is independent and decision-first.

---

## 13. Migration Requirements

| # | Migration (additive; none destructive) | Rating | Trigger | Contents (design-level, no SQL here) |
|---|---|---|---|---|
| M-1 | Fee schema targeting extension | MISSING — BLOCKED BY POLICY | §9-D2 (D-F-003, D-K-001, D-A-001, D-P-002) | add payer column, optional KYC-tier column, optional agent-class / agent-id columns, optional campaign code; precedence policy D-P-001 must land first |
| M-2 | Fee persistence on `transfers` | MISSING — BLOCKED BY POLICY | D-F-001 selecting fee-bearing for W→W | add `fee_minor`, `vat_minor` (bigint default 0) mirroring the C2C slot; backfill null→0 unnecessary (default) |
| M-3 | Fee persistence on funding tables | MISSING — BLOCKED BY POLICY | D-F-007/008, D-D-004 | same slot pattern on `customer_funding_requests` and agent funding/defunding tables |
| M-4 | Reward usage-state store | MISSING — BLOCKED BY POLICY | §9-D5 (D-R-009…011) | per-beneficiary + product + grant-type counters with period windows; recipient+product+type+count vocabulary already standardized in P-DEC-01 |
| M-5 | Agent contact methods (agent phone) | MISSING | SMS-4 — only if an AGENT event is ratified required (none today → deferrable §20) | `agent_contact_methods` mirroring customer contact methods (V1-005 next-steps names it) |
| M-6 | Push device tokens | MISSING | SMS-5 — only to enable PUSH channels | `push_device_tokens` + registration endpoint (V1-005 next-steps names it) |
| M-7 | D1 channel/evidence objects | MISSING — BLOCKED BY POLICY | D-D-001/002/006 → §9-D8 | structured channel type, evidence payload, verification states on funding requests (or new table per §10 verdict) |
| M-8 | Notification tables | EXISTS | — | outbox, deliveries, (inbox is a projection) already live; worker needs no table change |
| M-9 | Snapshot schema bump for SNP-1/2/3 | MISSING | §9-D6 pilot evidence standard | bump `snapshot_schema_version`, extend allocation/grant shapes with base-amount + actor-context slots; old rows remain version 1 readable |
| M-10 | No migration required for: commercial account families (data provisioning §14), worker (SMS-1, code), provider adapter (SMS-2, code), preference enforcement (SMS-6, code) | NOT REQUIRED | — | — |

All additive; rollback = column/table drop only where nothing was written (post-pilot rollback is a policy matter, D-V-005 correction mechanics).

---

## 14. Ledger / Accounting Dependencies

| Family | Status | Required by |
|---|---|---|
| Product flow journal families (7 flows) | EXISTS + tested | live |
| FEE-REVENUE (per P-DEC-01 §8, row family D-GL-001) | MISSING — BLOCKED BY POLICY | any fee leg; §9-D3; provisioning follows the AR-control data pattern — **codes come from Finance, none invented here** |
| VAT-PAYABLE (D-GL-002) | MISSING — BLOCKED BY POLICY | D-F-005(b)/(c) + §9-D1 |
| COMMISSION-EXPENSE + COMMISSION-PAYABLE (D-GL-004) | MISSING — BLOCKED BY POLICY | §9-D6 pilot; accrued vs immediate per D-C-015 |
| REWARD-LIABILITY + REWARD-EXPENSE (D-GL-005) | MISSING — BLOCKED BY POLICY | §9-D6 pilot; grant timing D-R-016/017 |
| PLATFORM allocation destination (D-C-010) | MISSING — BLOCKED BY POLICY | PLATFORM legs once commission posts |
| AGGREGATOR identity (credit target) | MISSING — BLOCKED BY POLICY | D-C-009 → §9-D4 (ledger-identity vs off-ledger accrual, §5 item 4 verdicts) |
| Reversal/correction families | MISSING — BLOCKED BY POLICY | D-V-001/005; existing ledger supports reversal legs structurally; ops workflow decision first |
| Double-entry atomicity + replay protections | EXISTS | keeps §9-D1/D6 to leg-composition work only |

Provisioning mechanics: chart-of-accounts provisioning is a **data task executed through the existing accounts-admin surface following the PAYMENT-SETTLEMENT precedent** (no schema migration; see M-10).

---

## 15. API / UI Dependencies

| Surface | Rating | Scope |
|---|---|---|
| Customer: unified transaction history | EXISTS | gains fee/VAT/total fields via §9-D7 once M-2/§9-D1 land |
| Customer: pre-commit fee quote | MISSING — BLOCKED BY POLICY (D-I-001) | confirmation/quote contract; depends on §9-D1 output; A23-sibling territory |
| Customer: receipt line items (principal/fee/VAT/total/rule-free text) | MISSING — BLOCKED BY POLICY (D-I-002) | projection change + optionally dedicated receipt endpoint |
| Customer: limits consumption view | MISSING | D-L-M-010 carried item; config/API surface only (runtime data EXISTS); §20 enhancement |
| Customer: funding request creation (D1) | MISSING — BLOCKED BY POLICY (D-D-001) | §9-D8 process build |
| Customer: notification inbox | EXISTS | IN_APP projection live; gains real SMS-delivery correlation behind SMS-1/2 |
| Agent: C2C detail with fee slots | EXISTS (zero values) | values activate with §9-D1 |
| Agent: commission statement / payout view | NOT REQUIRED (V1) | D-C-014/015; V2 payout-cadence territory; pilot reports read registries + snapshots |
| Admin: fee/commission/reward/limit registries + resolver diagnostics | EXISTS | governance CRUD with workforce auth + optimistic versioning + effective windows; pilot gating is configuration (effective dates + targeted rules), no admin build needed |
| Admin: notification diagnostics | EXISTS | failure/delivery visibility; gains provider-level statuses with SMS-7 if adopted |
| Admin: commercial snapshot read | EXISTS | workforce snapshot read API today |

No new surface is required to **configure** policy once decided; required builds are exactly the customer quote/receipt pair (D-I), D1 (if YES), and SMS-1/2.

---

## 16. Security / Authorization Dependencies

| Aspect | Rating | Detail |
|---|---|---|
| Rule-governance authorization (registries) | EXISTS | workforce-authenticated CRUD surfaces; privileged-action posture per hardening suite; optimistic versioning + audit columns (`created_by`/`updated_by`) present on all three rule tables |
| Maker-checker depth for rule changes | PARTIAL | governance depth exists via existing approvals machinery where registries route through it; whether rule CRUD *requires* four-eyes is the effective-date-governance decisions (D-C-012/D-P-003/D-R-014) — posture today: single-actor with audit |
| Flow authorization surfaces | EXISTS | no new actor classes are introduced by fees/commission/reward/SMS; commission/reward beneficiaries are existing agent/customer identities |
| Payload redaction discipline | EXISTS | notification payloads redacted pre-persistence; extends unchanged to new template variables (quote/receipt numbers are not secrets) |
| Agent phone as new PII field | MISSING (with M-5) | inherits customer-contact-method normalization/encryption posture when built |
| Provider credentials | MISSING (with SMS-8) | env-secret pattern identical to existing payment/assertion configs; HMAC verification on inbound delivery callbacks when SMS-7 is adopted |
| Snapshot read authorization | EXISTS | workforce-only |
| Rate-control on outbound SMS | MISSING (SMS-2 contract) | adapter-level cap to bound runaway loops; test adapter already supports failure injection for this |

No authorization-scheme build is a V1 dependency; every new artifact plugs into the workforce + principal model that exists.

---

## 17. Testing Requirements

| Dependency | Required tests (type) | Anchors (today) |
|---|---|---|
| §9-D1 calculator | unit: flat/pct/hybrid arithmetic, min/max clamp order (D-M-002), rounding family (D-M-001), VAT-on-fee; property-style edge cases at clamp boundaries | `commission.calculator` floor discipline is the pattern |
| §9-D1 wiring | integration per fee-bearing product: resolver→calculator→persistence→journal legs→snapshot `feeDecision` (status CHARGED vocabulary) in one transaction; atomic rollback on posting failure | existing per-flow integration suites (`v1-commercial-*`, decision snapshot suites) |
| M-2/M-3 migrations | migration up/down validity + default-zero backfill behavior | migration battery conventions |
| §9-D3 provisioning | data-level test: composed legs post balanced journals; account lookup failures fail-closed | AR-control provisioning tests |
| §9-D6 pilots | integration: engine invocation in-flow on PRINCIPAL basis, snapshot SNP-1 fields present, fail-closed guard retained on rule resolution failure, idempotent re-run (same idempotency key) | engine unit suites exist → extend with flow wiring |
| §9-D5 usage store | unit+integration: counter windows, boundary N-th grant allowed / (N+1)-th denied | new store, new suite |
| Limit interaction (D-L-005) | integration: fee-inclusive total rejected at boundary, principal-only accepted below boundary | limit enforcement suites today |
| §9-D7 disclosure | projection tests: no internal leakage (journal/ledger/workforce ids), fee/VAT/total fields, quote endpoint determinism | existing safe-projection tests (line 366 discipline) |
| SMS-1 worker | integration: poll→dispatch→provider stub→status transitions; crash-between-dispatch safety (re-run skips inserted rows); FAILED outbox re-poll (+60s re-availability) blocked by delivery uniqueness — documents SMS-3 | test adapter `shouldFail` exists |
| SMS-2 adapter | provider contract tests (auth header/HMAC, error mapping, timeouts), sandbox smoke (ops) | interface already isolates provider |
| SMS-3 retry | unit: attempt/backoff policy; integration: eventual success within cap, terminal after cap with alert surface | new logic |
| SMS-6 preferences | unit: sms opt-out → SKIPPED reason vocabulary (new `SMS_OPT_OUT` reason) | resolver suites today cover PUSH_OPT_OUT |
| §9-D8 D1 (if YES) | E2E: customer-create→ops-verify→approve→journal→limit→notification→history row; evidence model validation; maker-checker on verification | ops funding integration suite is the base |

Test-severity rule: wiring suites fail-closed; provider suites assert **never-throws-into-finance** boundary (the existing isolation discipline).

---

## 18. Implementation Sequence

Assuming the policy register is answered in the recorded dependency order:

1. **SMS spine (independent, start now):** SMS-1 worker → SMS-6 preference enforcement → SMS-2/8 adapter+credentials → SMS-9 external registration → SMS-3 retry. *(Code+foundation only; the REQUIRED events then go live.)*
2. **§9-D3 account provisioning** once D-GL answers land (data-only; unlocks every posting dependency).
3. **§9-D1 fee spine** after the D-F/D-M chain: M-2 (+M-3 if funding fees) → calculator unit battery → per-flow wiring with snapshot CHARGED status → D-L-005 limit input switch (decisioned) → §9-D7 quote/receipt.
4. **§9-D2 fee targeting migration** only if differentiation decisions demand it; lands before launching differentiated rules, never before the precedence decision D-P-001.
5. **§9-D6 commission pilot** on basis PRINCIPAL (no D1 dependency), gated per-recipient via targeted rules; snapshot upgrades per M-9 land first.
6. **§9-D6 reward pilot** after §9-D5 if frequency/cumulative caps are in the decided policy set; otherwise grants pilot only needs M-9.
7. **§9-D8 D1** — only on D-D-001 = YES; full process build (§10 gap list), never a bolt-on.
8. **Reversal/commercial corrections** track (D-V answers) activates after first commercial posting exists; before that it is a paper-only dependency.

Total sequencing property: **no step waits on a step it does not consume**; steps 1–2 are policy-independent.

---

## 19. Blockers Requiring Human Decisions

| # | Decision cluster (register refs) | Blocks |
|---|---|---|
| 1 | Fee chain: D-F-001…008, D-M-001, D-M-002, D-GL-001/002/003, D-F-006+D-I-001/002 display | §9-D1, M-1…M-3 |
| 2 | Fee targeting: D-K-001…004, D-A-001/003, D-P-001/002/003 | §9-D2 |
| 3 | Commission chain: D-C-001…016 (incl. 009 aggregator, 010 PLATFORM, 013 accounting, 014 settlement, 015 payable-vs-accrued, 016 policy base) | §9-D6 commission pilot, §9-D3 expense/payable legs, §9-D4 |
| 4 | Reward chain: D-R-001…022 (incl. 009/010/011 caps→§9-D5, 012 promotion model, 015/021 funding source, 016/017 crediting, 018 expiry, 019/020 reversal) | §9-D6 reward pilot, §9-D5, §9-D3 reward legs |
| 5 | D1 chain: D-D-001/002/004/006 (+D-I-003, D-F-007) | §9-D8 |
| 6 | Reversal/correction chain: D-V-001…006 (+D-GL-009 snapshot semantics) | all commercial-correction mechanics |
| 7 | Fee-in-limit exposure: D-L-005 (needs §9-D1 live to exercise either answer) | limit input change |
| 8 | **SMS provider selection + sender-ID registration + credential custody** (docs name Termii/Twilio/FCM candidates; no decision recoverable) | SMS-2/8/9; REQUIRED-for-V1 delivery |
| 9 | **Ratification of the §11.3 event classification** (REQUIRED set: funding, transfer completion, support-customer; all else OPTIONAL/NOT REQUIRED as mapped) | final SMS scope; events 1–3 need OTP-machinery product decisions before any build |
| 10 | Snapshot evidence standard: SNP-1/2/3 adoption (audit recommendation; SNP-3 hinges on D-GL-009) | M-9 timing |

Decisions 1–7 live in the P-DEC-01 register with owners stated there; 8–10 are named here first (8 named in hardening docs, never ratified in-repo).

---

## 20. Non-Blocking Enhancements

| Item | Class | Note |
|---|---|---|
| Agent phone/contact model (M-5, SMS-4) | enhancement until an AGENT event is ratified | agents operate in-app; NOT REQUIRED at launch per §11.3 |
| Device-token model + PUSH realization (M-6, SMS-5) | enhancement | every SMS+PUSH row degrades to SMS ONLY |
| C2C claim/expiry + lifecycle outbox emission (SMS-11) | enhancement | map exists; events OPTIONAL |
| Provider delivery-receipt callbacks (SMS-7) | enhancement | accept-status semantics documented to support at launch |
| Customer limits consumption view (D-L-M-010) | enhancement | runtime data EXISTS; disclosure surface carried from P-DEC-01 |
| Structured `external_reference` on ops funding (255-char free text today) | enhancement | becomes REQUIRED only under §9-D8 with structured evidence |
| SNP-1/2 snapshot enrichments | enhancement before pilots; REQUIRED standard at first pilot | M-9 |
| Commission statement/payout views for agents | V2 | D-C-014 cadence |
| Receipt endpoint beyond history line items | enhancement | D-I-002 minimum is line items in existing surfaces |
| Rate-limit/bulk-send SMS semantics | lands inside SMS-2 contract | no separate build |

---

## 21. V1 / V2 Boundary

**In V1 (after the §18 sequence):** all 7 flows with fee capability per decided products; commission on PRINCIPAL basis (FEE/NET once fees live); rewards per decided eligibility without campaign-system complexity; customer quote/receipt; SMS REQUIRED events + inbox; ops D3 funding; config-gated pilots.

**Explicitly V2 or never:** bank/deposit rail integrations (B1 scope from the process audit); external payout execution for commission settlement (D-C-014 mechanism execution, A18 boundary); campaign/promotion **systems** (prohibited by task; model-level `campaign_code` linkage is retained vocabulary only); FCM/APNS device stack (unless §11 ratification promotes PUSH to sole-channel for some event); aggregator payout automation beyond §9-D4 identity decision; tiered-fee brackets on **fees** (commission/reward tiers exist; fee tiers are NOT SUPPORTED and would be a §9-D2 extension if ever adopted — no register item demands them at V1); OTP authentication machinery (auth-audit items; requires standalone product decisions); delivery-receipt webhooks; cross-scope fee precedence runtime (decision D-P-001 defines, §9-D2 implements) — wait-listed until targeting exists.

**Not a system at any point (guardrails restated):** no invented rates/splits/bases/codes; no seeded production rules; no engine wiring outside an explicit, decision-cited migration order; no campaign platform.

---

## 22. Final Recommendation

1. **Launch-blocking work is exactly three items:** the SMS worker (SMS-1), preference enforcement (SMS-6), and the provider adapter+credentials+registration chain (SMS-2/8/9) with its selection decision. Commercial zeros are launch-correct by policy today.
2. **Return the policy register to humans now.** Nothing in the commercial spine can proceed past design without decisions 1–7 (§19); the sequence in §18 makes their consumption order explicit.
3. **Adopt SNP-1/2/3 as the pilot evidence standard before §9-D6 starts**; the snapshot schema otherwise stays untouched (M-9 is additive).
4. **Keep the D1 process absent until D-D-001 is answered YES**; the ops funding process stands as the whole of V1 funding otherwise — extending it before that decision would risk building the wrong process twice.
5. **Hold the boundary:** no OTP build, no campaign system, no external rails, no invented pricing or ledger codes under any implementation order.
6. This audit changed **zero lines of code and zero configuration**; its only artifact is this document.

— End of V1-COMMERCIAL-IMPLEMENTATION-AUDIT-01 —
