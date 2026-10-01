# P-DEC-01 — V1 Commercial Policy Decision Pack

**Date (Africa/Lagos):** 2026-09-28
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `131e1b2e870ebbebdc0237090cbdd0ee8c6e3680` (S-FIX-01 verified head)
**Task type:** **AUDIT + PRODUCT/ACCOUNTING DECISION DOCUMENTATION ONLY** — 0 source changes, 0 migrations, 0 rule seeds, 0 financial-flow changes, 0 ledger postings.
**Authoritative inputs:** `docs/V1/V1-END-TO-END-PROCESS-AUDIT.md` (§6 C-commercial, §7 D-funding, §23 product decisions 4–7/11/14, §25 accounting decisions, §26-1 follow-up), `docs/archive/v1-implementation/S-FIX-01-VERIFICATION-REPORT.md`, prior decision documents listed in Appendix A.
**Purpose:** convert every unresolved commercial/accounting question into an explicit, owner-tagged decision — so that a later task can configure/implement policy **without inventing a single value or assumption**.

> **Non-negotiable posture:** This pack DECIDES NOTHING. It inventories machinery, proves what exists, and enumerates decisions with options and evidence requirements. Where a value is needed, the entry says `VALUE REQUIRED` — no Naira amounts, percentages, commission rates, reward rates, VAT percentages, or limit values appear anywhere in this document.

---

## 1. Method and evidence basis

1. Re-read the authoritative process audit and its §23/§25 decision lists; reconciled every referenced register: COMMISSION-01 architecture doc §12 (16-item register), REWARD-01 architecture doc §13 (22-item register), H-02A fee-policy audit (2026-09-26), H-03 limit-policy audit (2026-09-26).
2. Inspected current code at the starting HEAD: fee/commission/reward rule entities, resolvers, calculators, engines, registry APIs; the commercial decision snapshot (defaults + entity + service); the product catalogue seed; the limit-catalog runtime (profiles/rules/assignments/usages/reservations/enforcement); customer KYC / AgentClass / Aggregator models; the five flow-service families carrying snapshots for the 7 products; ledger account families and the accounts that actually exist.
3. **Staleness reconciliation (recorded, not hidden):**
   - H-02A (66-migration era) concluded "no persisted fee rule table" — **superseded by implementation**: `fee_rules` exists (V1-COMMERCIAL-03) and its resolver is wired as *evidence* into all 7 flows (DECISION-02/03A–03E). H-02A's **policy conclusion stands**: in-house fee-free pilot is intentional, and becoming fee-bearing remains a product/accounting decision (`BLOCKED`, OUTCOME C).
   - H-03 (66-migration era) concluded "no authoritative runtime limit enforcement" — **superseded by implementation**: `LimitEnforcementService` enforces reservations-before-posting in all 7 flows (V1-LIMIT-01→04; green in current integration batteries). H-03's **value-decision questions stand** (no authoritative launch values exist).
   - The process audit's §6 is current and authoritative on the machinery/policy separation; this pack does not re-derive it.
4. Capability evidence: consolidated full integration run at the audited tree — **62/62 suites, 1325/1325 tests green** (recorded in `docs/archive/v1-implementation/V1-REWARD-01-VERIFICATION-REPORT.md` line 66, at head `ec9d341`, the audited tree). Per the task's testing scope, this prior green run plus the status of the capability seed (§12) constitutes the capability verification; re-running the full battery was not required for a documentation-only task and nothing in this task touches code, so the run remains valid evidence.

---

## 2. The six-state commercial separation (binding vocabulary for this pack)

Every commercial object in V1 is described by six independent states. **Collapsing any two states is a defect** (e.g., "rules exist" ≠ "policy requires them"; "configured" ≠ "enabled").

| # | State | Question answered | V1 holder of truth |
|---|-------|-------------------|---------------------|
| S1 | **Capability exists technically** | Does code/schema/API demonstrably exist and pass tests? | Repository + test suites |
| S2 | **Rule CAN be configured** | Does the schema/registry admit a rule of this shape? | `fee_rules` / `commission_rules` / `reward_rules` schemas + registry APIs |
| S3 | **Rule IS configured** | Does a production row exist? | DB content (today: **zero rows** in all three rule tables, by design) |
| S4 | **Rule is ENABLED** | Would runtime actually act on it? | Runtime wiring state (fee charge wiring: absent by design; commission/reward flow calls: absent by design) |
| S5 | **Product policy REQUIRES it** | Has the business decided this product carries this commercial object? | This pack's decision register — today **nothing decided** |
| S6 | **Accounting treatment is APPROVED** | Is there an approved journal shape + account family + recognition rule? | Finance decision; today **undeveloped** (no revenue/expense production accounts exist) |

State of V1 today (all 7 products): **S1 = YES (machinery complete), S2 = YES (schema admits rules), S3 = NO (zero rules seeded — not a defect, by design), S4 = n/a (nothing to enable; snapshot machinery already records the decision states), S5 = NO (this pack exists to make S5 possible), S6 = NO (§8).**

---

## 3. Current implementation inventory (S1/S2 evidence — what exists)

### 3.1 Rule systems (definition + resolution machinery)

| System | Schema (configuration surface) | Resolver semantics | Calculator | Admin API (workforce) |
|---|---|---|---|---|
| **Fee (V1-COMMERCIAL-03)** | `fee_rules`: `product_code → products.code`, `currency`, `flat_fee_minor`, `percentage_bps`, `minimum_fee_minor`, `maximum_fee_minor`, `vat_bps`, `effective_from/to`, `priority`, `is_active`, optimistic `version`, soft-delete, audit trail. Uniqueness: `(product_code, currency, effective_from)`. **No KYC, customer, agent, agent-class, aggregator, segment or campaign dimensions.** Tiered/progressive fee schema: **absent** (capability entries `TIERED_FEE`/`PROGRESSIVE_FEE` are `PLANNED`). | Effective-window + highest `priority` wins; equal-priority ties → **`AMBIGUOUS` (fail-closed, never a silent winner)**; read-only; returns rule evidence (`ruleId`, `ruleVersion`, all parameters, window). | **None exists for V1 flows.** (The `src/fee/*` engine is the V2-era quote-typed calculator consumed only by V2-parked `src/policy/b1-*`; V1 flows never call it.) A V1 fee calculator (flat + pct, min/max clamp, VAT computation, rounding) is an **implementation dependency** (§9). | `GET/POST/PATCH/DELETE /api/v1/internal/fee-rules` (+ resolver diagnostics) — `OPERATOR/SERVICE/PRIVILEGED` |
| **Commission (V1-COMMISSION-01)** | `commission_rules`: `product_code`, `currency`, `recipient_type` ∈ {AGENT, AGGREGATOR, PLATFORM}, `calculation_basis` ∈ {PRINCIPAL, FEE, NET}, model ∈ {FLAT, PERCENTAGE, FLAT_PLUS_PERCENTAGE, TIERED + variants}, `flat_commission_minor`, `percentage_bps`, `minimum/maximum_commission_minor`, `tiers` (jsonb), targeting: `agent_class_id` / `agent_id` / `aggregator_id`, `effective_from/to`, `priority`, `is_active`, `version`. | Per-recipient-type resolution; all targeting dims conjunctive; highest `priority`; ties → `AMBIGUOUS` (fail-closed); returns full rule evidence per recipient. | **Exists** (`commission.calculator.ts`): `(base × bps) / 10000` integer-divided **floor**; min-max clamp **after** enrichment; TIERED = **marginal per bracket**, floor per bracket; `BASE_UNAVAILABLE` when e.g. FEE-basis without a fee amount — fail-closed status, never invented. | `/api/v1/internal/commission-rules` + read-only resolver diagnostics — `OPERATOR/SERVICE/PRIVILEGED` |
| **Reward (V1-REWARD-01)** | `reward_rules`: `product_code`, `currency`, `beneficiary_type` ∈ {CUSTOMER, AGENT}, `reward_type` ∈ {CASHBACK, BONUS, PROMOTION}, basis ∈ {PRINCIPAL, FEE, NET}, models as commission, `tiers`, targeting: `customer_kyc_level` (existing enum NONE/LEVEL_1/2/3), `agent_class_id`, `agent_id`, `campaign_code` (config-only string), `max_grants_per_transaction` = 1 (vocabulary only), `effective_from/to`, `priority`, `is_active`. | Per-beneficiary resolution; highest `priority`; ties → `REWARD_RULE_AMBIGUOUS` (fail-closed — surfaced in rule diagnostics + snapshot evidence). | **Exists** (`reward.calculator.ts`): same floor-division + clamp-order family as commission. | `/api/v1/internal/reward-rules` + read-only resolver diagnostics — `OPERATOR/SERVICE/PRIVILEGED` |

### 3.2 Runtime commercial evidence (what actually happens in a flow today)

| Piece | Current behavior (exact) |
|---|---|
| **Commercial Decision Snapshot** (`commercial_decision-snapshot.*`) | Recorded for **all 7 products**, inside the flow's transaction, after ledger/limits and before `COMPLETED`; immutable on INSERT; corrections only via `supersedes_snapshot_id` compensating rows; idempotency-keyed; workforce read API (`/api/v1/internal/commercial-decision*`). |
| **Fee decision in snapshots** | Always `feeNotConfigured(currency, amount)` = `status: NOT_CONFIGURED, feeMinor: '0', vatMinor: '0', totalMinor: amountMinor`; plus `ruleRefs` evidence when the resolver **RESOLVED** a rule (charge is still 0 — the charge path does not exist). Fee status vocabulary ready: `NOT_CONFIGURED | ZERO | APPLIED | WAIVED`. |
| **Commission decision in snapshots** | Always `commissionNone()` (`status: NONE`, empty allocations). `ALLOCATED` shape validated + builder ready (`commissionAllocated`) — **no flow calls the commission engine** (static guard test enforces this). |
| **Reward decision in snapshots** | Always `rewardNone()`. `GRANTED` shape ready (`rewardGranted`) — **no flow calls the reward engine** (static guard test). |
| **Revenue decision shape** | `RevenueDecisionStatus = NONE | RETAINED` exists in the snapshot schema — **unused** (no flow populates revenue). |
| **Limit decision in snapshots** | Real evidence: `APPROVED` (with/without profile) / `REJECTED` / `NOT_EVALUATED`. Limits are **enforced** at runtime (MIN/MAX/WALLET_BALANCE_MAX + windowed reservations, idempotency-keyed, Lagos windows). Limit *values/assignments*: undecided policy (§6.10). |
| **Failure posture** | Snapshot on success path only; flow failure records no snapshot; a commercial "decision" never reverses financial state. |

### 3.3 Products and identities (the only valid keys)

| Identity | Current state |
|---|---|
| Product catalogue (`products`) | Exactly the 7 V1 products seeded (WALLET_TRANSFER, WALLET_TO_CASH, CASH_TO_WALLET, CASH_TO_CASH, CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING), NGN, V1 scope, ACTIVE, enabled, `NOT_CONFIGURED`. FK target of all three rule systems. 13 V2 codes explicitly guarded against seeding. |
| Customer KYC levels | Enum `NONE | LEVEL_1 | LEVEL_2 | LEVEL_3` + `kyc_status` machine (NOT_STARTED/PENDING/APPROVED/REJECTED). **Consumed by no financial flow and no eligibility gate today** (verified: no KYC reference in transfer/agent/cash/funding services). Targeting dimension in `reward_rules` only. |
| Agent classes | `agent_classes` (code/name, `applicable_services`, `applicable_limits` JSON, soft-delete). Targeting dimension in `commission_rules` and `reward_rules`. |
| Agents | Lifecycle PENDING/ACTIVE/SUSPENDED/TERMINATED; agent-side eligibility guards exist per operation. Targeting dimension (individual override) in commission/reward rules. |
| Aggregators | Relationship-only (A18): **no aggregator ledger account / wallet** (verified). Recipient type in commission rules, but **crediting an aggregator has no account destination today** → implementation dependency for any aggregator allocation. |

### 3.4 Money movement that exists today (per product, exact journals)

| Product | Flow service | Journals (NGN) | Limit enforcement | Snapshot |
|---|---|---|---|---|
| WALLET_TRANSFER | `transfer.service` (customer `me` + service paths) | DEBIT sender wallet / CREDIT recipient wallet | YES | YES (DECISION-02) |
| WALLET_TO_CASH | `agent-financial-execution` (cash-out) | DEBIT customer wallet / CREDIT `AGENT_FUNDING_POOL-NGN` | YES | YES (03B) |
| CASH_TO_WALLET | `agent-financial-execution` (cash-in) | DEBIT `AGENT_FUNDING_POOL-NGN` / CREDIT customer wallet (lazy idempotent wallet creation) | YES | YES (03A) |
| CASH_TO_CASH | `agent-cash-to-cash` + `…-claim` | Initiate: DEBIT initiator agent wallet / CREDIT `AGENT_FUNDING_POOL-NGN`; Claim: DEBIT pool / CREDIT claimant; **Expiry: NO journal (no auto-refund; funds remain in pool; status EXPIRED)** | YES (create + claim) | YES (03C) |
| CUSTOMER_FUNDING | `customer-funding` (maker/checker) | Approve only: DEBIT `PAYMENT-SETTLEMENT_ASSET-NGN` (CUSTOMER_FUNDS unit) / CREDIT customer wallet; reject = **no journal** | YES (CUSTOMER INCOMING) | YES (03D) |
| AGENT_FUNDING | `agent-funding` (`FUND` direction) | DEBIT `AGENT_FUNDING_POOL-NGN` / CREDIT agent wallet | YES | YES (03E) |
| AGENT_DEFUNDING | `agent-funding` (`DEFUND` direction) | DEBIT agent wallet / CREDIT `AGENT_FUNDING_POOL-NGN` | YES | YES (03E) |

### 3.5 Ledger / accounting reality

- Ledger account **types** support the full chart backbone: `ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE`.
- Accounts that **exist in production flows**: wallet ledger accounts (customer/agent), `AGENT_FUNDING_POOL-NGN`, `PAYMENT-SETTLEMENT_ASSET-NGN` (CUSTOMER_FUNDS unit), AR control accounts (ASSET family, provisioning service).
- Accounts that **do NOT exist**: fee-revenue, VAT-payable, commission-expense, commission-payable, reward/cashback-liability, promotional-expense, revenue-retained sub-accounts. (H-02A established the same absence at 66 migrations; verified still true — REVENUE/EXPENSE types are exercised only by V2-parked `src/policy/b2f-*` modules.)
- Journal discipline: balanced double-entry, `POSTED` only, append-only; ledger **reversal machinery exists** (`a5-ledger-reversal` suite) but no ops workflow encircles it (audit J9 / §23-11); commercial snapshots never post and never reverse money.

---

## 4. V1 runtime wiring map (7 products → machinery consumed today)

For every product the **runtime** today is identical in kind: limits enforced where assigned → fee resolution read as **evidence** (charge hardcoded 0) → journal posted → immutable snapshot recorded (`fee NOT_CONFIGURED · commission NONE · reward NONE · limit APPROVED/Rejected-evidence`) → notifications dispatched via console/test providers.

The delta between products is therefore **purely business policy** — exactly what this pack must solicit. The per-product matrices below use one uniform row set (A–K per the task letter scheme; the task omits letter J and this pack follows that letter scheme verbatim).

---

## 5. Per-product policy decision matrices

Legend for "Machinery today" column: **YES** = representable/executable by current code · **NO** = not representable (implementation dependency, §9) · **n/a** = not applicable to this product by construction. All "Decision" cells reference register IDs in §10. Values are never supplied: every rate/amount cell says `VALUE REQUIRED`.

### 5.1 WALLET_TRANSFER (Customer Wallet→Wallet)

| Row | Machinery today | Decision required (register) |
|---|---|---|
| A. Free or fee-bearing | Charge path absent; charge = 0; resolution evidence already captured | Is it free for V1 launch? If fee-bearing from day one, what object (fee per §5-legend) — **D-F-001, D-F-002** |
| B. Fee detail | Payer/beneficiary: **NOT representable in fee schema** (fee has one implicit payer model: sender-side wallet principal discussion needed); flat/pct/min/max/vatBps: **YES**; fee-in-displayed-amount vs added-on: **NO calculator → presentation-only decision**; fee-counts-toward-limits: today limits see principal only → **D-L-005**; fee-affects-commission-base/reward-base: machinery supports basis choice PRINCIPAL/FEE/NET per rule → **D-C-003, D-R-006** | payer D-F-003; model+values D-F-004 (all `VALUE REQUIRED`); VAT D-F-005, D-GL-002; inclusion D-F-006; limit interaction D-L-005; base interactions D-C-003/D-R-006 |
| C. KYC differentiation | Fee schema has **NO KYC dimension** → KYC-priced fees **not representable** without schema extension; KYC affects nothing in flow today | is KYC pricing required on W→W? — **D-K-001 → if YES, schema dependency §9-D2** |
| D. Agent differentiation | n/a (no agent participant in W→W) | none |
| E. Commission | Rule schema supports recipient AGENT/AGGREGATOR/PLATFORM per product; **no agent participant exists in W→W** — any allocation here would go to PLATFORM/retention or be conceptually empty | does W→W generate commission at all? — **D-C-001**; if PLATFORM-retained: account family **D-GL-004** |
| F. Reward/cashback | Rule schema supports CUSTOMER/AGENT beneficiary, CASHBACK/BONUS/PROMOTION, KYC targeting; engine+ calculator ready; **not wired** | enabled for V1? beneficiary? type? — **D-R-001…D-R-004** |
| G. Precedence | Fee: priority within one (product,currency); commission/reward: priority + fail-closed ties; cross-scope hierarchy (global vs segment vs class vs individual vs promo) **NOT defined anywhere**; effective dating/versioning: **YES** in all three systems | hierarchy **D-P-001**; promo interaction **D-P-002**; change-freeze/lead-time **D-P-003** |
| H. Rounding | Currency minor units; commission/reward calculators floor-divide with documented clamp order; **fee calculator absent** → fee rounding/ordering unimplemented | adopt floor-family everywhere? — **D-M-001, D-M-002** (implementation dependency §9-D1) |
| I. Disclosure | Customer app shows principal only; `feeMinor` exists in unified history payload (always "0"); no confirmation-screen/receipt fee presentation surface found | confirmation shows fee? receipt splits principal+fee? — **D-I-001, D-I-002** |
| K. Reversal/refund | Ledger reversal machinery exists w/o ops workflow; snapshot immutable + supersedes; no fee/commission/reward postings exist to claw back today | fee/commission/reward reversal policy — **D-V-001…D-V-004**; correction vs reversal via supersedes — **D-V-005** |

### 5.2 WALLET_TO_CASH (Customer Wallet→Cash via Agent)

| Row | Machinery today | Decision required (register) |
|---|---|---|
| A | As 5.1-A (charge 0, evidence captured) | free vs fee-bearing — **D-F-001, D-F-002** (agent-assisted channel: also who is the natural fee counterparty — **D-F-003**) |
| B | As 5.1-B; additional dimension: payer could be customer (from principal) or agent (affects pool/net settlement) — **not representable** (schema has no payer model) → ^implementation dependency if agent-payer chosen | D-F-003…D-F-006, D-GL-001/002, D-L-005 |
| C | KYC pricing not representable (fee schema) | **D-K-001** (dependency §9-D2 if YES) |
| D | Agent class exists; commission rules target agentClass/agent; fee schema has **NO agent dimension** → class-differentiated customer fees not representable | class-affects-fee? **D-A-001** (→ §9-D2); class-affects-commission? **D-C-007**; individual-agent override? **D-C-008** |
| E | Fully supported rule/model surface (recipients incl. AGENT + AGGREGATOR; basis PRINCIPAL/FEE/NET) — engine not wired; agent wallet exists (credit destination exists); aggregator has **no account** | pays commission? **D-C-001**; beneficiary per product **D-C-002**; basis **D-C-003**; model **D-C-004**; class variation **D-C-007**; individual **D-C-008**; aggregator participation **D-C-009** (+§9-D4); immediate vs accrued **D-C-015** |
| F | Supported; beneficiary could be CUSTOMER (transacting) or AGENT (performing) | **D-R-001…D-R-004**; coexist with fees/commission **D-R-021** (reward register #21/#12/#5 family) |
| G/H/I/K | As 5.1 rows | D-P-001…D-P-003, D-M-001/002, D-I-001/002, D-V-001…D-V-005 |

### 5.3 CASH_TO_WALLET (Customer Cash→Wallet via Agent)

Same machinery posture as 5.2 (mirror direction). Product-specific framings only:

- B-payer: customer pays cash physically to agent; fee could be physical-cash-inclusive vs wallet-net-of-fee — **presentation and wallet-credit semantics decision (D-F-003, D-F-006, D-I-001)**, machinery cannot split physical cash → enforcement/presentation choice needed.
- D/E: same agent-differentiation and commission surface as 5.2.
- Limit side: CUSTOMER INCOMING + WALLET_BALANCE_MAX mechanics exist; whether funding receives same window policy as transfers — **D-L-003**.

### 5.4 CASH_TO_CASH (Agent cash-to-cash with claim lifecycle)

Same machinery posture as 5.2 for create/claim legs; product-specific framings:

- A/B: payer model candidates: initiator agent (from their wallet), claimant (at claim leg), or physical-cash fee — **not representable today (D-F-003 + §9-D2)**.
- E: commission beneficiary is agent-side by construction (initiator and/or claimant agent — **split policy question feeding D-C-002**).
- K: **expiry already produces NO journal and no auto-refund** (verified code); refund expectations after expiry are an open **product+ops decision (D-V-006)** — this predates fees and exists today.
- Limit: create + claim legs independently enforced today; leg-specific limit policy — **D-L-004**.

### 5.5 CUSTOMER_FUNDING (Finance-Ops funding of customer wallet — see §7 for D1)

| Row | Machinery today | Decision required (register) |
|---|---|---|
| A | Charge path absent; approval posts DEBIT settlement / CREDIT wallet | fee on funding? (fees-on-funding chain from V1-004 audit) — **D-F-007** |
| B–I | n/a as 5.5 is ops-initiated: no KYC/agent differentiation meaningful; commission n/a by construction; reward ∞ decision **D-R-002** | disclosure to customer exists (funding history + notification) — sufficiency **D-I-003** |
| Limits | Limit enforcement already live (CUSTOMER INCOMING action; V1-LIMIT-04) | values/assignment **D-L-001/002** (and whether funding should be limit-free by policy — **D-L-006**) |
| K | Rejection = no journal (verified); approval reversal would use ledger-reversal machinery | reversal ops policy — **D-V-001** |

### 5.6 AGENT_FUNDING (Platform → Agent wallet float funding)

| Row | Machinery today | Decision required |
|---|---|---|
| A/B/F/I/K | Fee/commission/reward on funding an agent's float: machinery could carry rules (product FK exists) — business sense says none, but **that must be decided explicitly, not assumed** — **D-F-008, D-C-010, D-R-003** | reversal policy **D-V-001** |
| Limits | Enforced today | values **D-L-001**, funding-specific **D-L-006** |
| Commission | `PLATFORM` recipient exists as vocabulary — agent funding commission is most naturally NONE | confirm NONE **D-C-010** |

### 5.7 AGENT_DEFUNDING (Agent wallet → platform excess-float return)

Symmetric to 5.6: same decisions (**D-F-008, D-C-010, D-R-003, D-L-001/006, D-V-001**). Defunding reduces agent exposure; any fee on float return is a pricing-policy oddity that still needs an explicit product answer.

---

## 6. Cross-cutting policy areas (machinery-verified constraints stated per area)

### 6.1 Fee policy (audit §23-4; H-02A carry-forward)

- H-02A's verified conclusion stands: **in-house fee-free pilot is intentional** (A5 pilot exclusion; A3 out-of-scope; V1-008 "intentional zero-fee"), but no document decrees fee-free forever — **becoming fee-bearing is an explicit product/accounting decision, per product**.
- Fee schema = product + currency only. Segment/KYC/agent/class/campaign-differentiated fees **cannot be represented** without a schema extension (§9-D2).
- Fee has **no V1 calculator and no charge wiring** (§9-D1); resolver evidence-only today guarantees "seed-by-mistake never charges".
- VAT: `vat_bps` column and `vatMinor` snapshot field exist; **no VAT rate, no VAT computing code, no VAT-payable account** → D-F-005 + D-GL-002 + §9-D1.
- "Fee included in displayed amount vs added on top" is a **presentation/UX-jurisprudence decision** (D-F-006) that must be answered before charge wiring, because it changes ledger math (fee carved from principal vs posted as an extra leg).

### 6.2 KYC differentiation (task matrix C)

- Today: KYC gates **nothing** (verified). Reward rules can target KYC level; fee rules cannot; limits see no KYC.
- Questions (register D-K-001…D-K-004): does KYC change pricing (fees lower for higher KYC)? which levels are eligible for fee-bearing products at all? KYC applied to all or selected products? Note dependency: answers feed the PRODUCT+schema decision §9-D2 and the separate audit §23-3 KYC-gating product decision (out of this pack).

### 6.3 Agent differentiation (task matrix D)

- Fee-side: not representable (same §9-D2 dependency). Commission/reward-side: representable (agentClassId, agentId targeting) but **cross-scope precedence is undefined** (ambiguous-rule ties fail CLOSED until policy defines hierarchy — D-P-001).

### 6.4 Commission (task matrix E — audit §23-6; COMMISSION-01 register carried)

- The full 16-question register from `docs/archive/v1-implementation/V1-COMMISSION-01-COMMISSION-ENGINE-ARCHITECTURE.md` §12 is incorporated into §10 as D-C-001…D-C-016 without loss (mapping noted per item).
- Structural facts policy must respect: aggregator allocations have **no account destination** (§9-D4); FEE-basis allocations report `BASE_UNAVAILABLE` until fees exist; `PLATFORM` recipient has **no revenue account**.

### 6.5 Reward/cashback (task matrix F — audit §23-7; REWARD-01 register carried)

- The full 22-question register from `docs/archive/v1-implementation/V1-REWARD-01-REWARD-ENGINE-ARCHITECTURE.md` §13 is incorporated as D-R-001…D-R-022.
- Structural facts: frequency restriction / cumulative caps have **no usage-state design** (§9-D5 — register items 9–11 presuppose it); `max_grants_per_transaction=1` is vocabulary; reward funding source has **no account**; coexistence with commission/fees is product policy, not mechanics.

### 6.6 Commercial precedence (task matrix G)

- In-rule-system precedence exists: effective window + `priority` (highest wins) + fail-closed ambiguity. **Cross-scope hierarchy among {global product default, customer/KYC segment, Agent Class, individual customer/agent, promotional/campaign rule} is undefined** — and fee rules cannot even address segments/classes (schema), so any priority hierarchy will be partially mechanical, partially policy-mapped (D-P-001).
- Promo/campaign: `campaign_code` exists in reward rules only (string, config surface) — promotion **model** is itself a decision (D-P-002, D-R-012).
- Effective-date/versioning policy (lead times, freeze windows, retroactive changes): mechanics support windows + versions + audit; the **governance schedule** is a decision (D-P-003) tied to privileged-action approval depth (audit §24-3 — S-domain, not decided here).

### 6.7 Rounding (task matrix H)

- Verified mechanics (commission/reward calculators): `(base × bps) / 10000`, integer-division **floor**; FLAT_PLUS_PERCENTAGE adds flat then computes; tiered is **marginal**, floor per bracket; min/max clamp **after** computation (documented in code as "same clamp order as FeeEngine" — the V2-era reference, not a V1 norm).
- No fee calculator exists; NGN minor units (kobo) are the only currency precision in V1.
- Decisions: D-M-001 (rounding mode family — floor everywhere vs banker's vs half-up per object), D-M-002 (clamp/VAT ordering for the future fee calculator; commission/reward order is already fixed in mechanics — changing it = re-verification, not config).

### 6.8 Disclosure (task matrix I)

- Verified surface: customer app shows amounts; unified history carries `feeMinor` (always "0"); commercial snapshots are **internal** evidence (workforce API), not customer-facing; notifications carry event payloads (console providers).
- Decisions: D-I-001 (confirmation must display fee pre-commit? — affects customer-app contract A23-territory), D-I-002 (receipt/history split principal+fee+VAT line items), D-I-003 (funding notifications sufficiency — customer is notified on approval today; is reference/issuer detail required?).

### 6.9 Reversal / refund (task matrix K)

- Verified: snapshots immutable; supersedes-based correction supported; ledger reversal machinery exists without ops workflow; c2c expiry posts **no journal / no refund**; engines are decision-only (nothing to reverse yet); limit reservations RELEASE on failure (no usage accrual on failed flows).
- Decisions: D-V-001 (transaction-reversal ops workflow — carried from audit §23-11, P+A joint), D-V-002 (fee refunded on reversal? full/partial/never per product), D-V-003 (commission clawback on reversal/expiry), D-V-004 (reward clawback on reversal/failure), D-V-005 (snapshot supersession vs reversal vs both), D-V-006 (c2c expiry refund/refill policy — exists TODAY independent of commercial config).

### 6.10 Limit value policy (audit §23-5; H-03 register carried)

- H-03 decided mechanically by implementation since: enforcement exists (LIMIT-01→04), Lagos windows, concurrency-safe reservations, Lagos-dated usage, OPERATOR+SERVICE+PRIVILEGED authoring, versioning, diagnostics APIs. **H-03 §14 items 1/3(mechanism)/6(effective mechanics)/7/8/9 are therefore superseded as mechanics; item 2 (dimension applicability per flow), item 4 (concrete values/defaults/zero-semantics), item 10 (customer-facing limits view), and per-flow product choices (funding limit-free? c2c leg policy? fee-in-limit interaction) remain as policy: D-L-001…D-L-006.**

---

## 7. D1 — CUSTOMER FUNDING decision section (audit §23-14 / D1)

### 7.1 Established machinery facts (no re-derivation needed)

Verified at starting HEAD (`customer-funding.*`, V1-001 26/26 green per audit §7):
- **Who initiates:** workforce maker (any of the 4 workforce principal types today). Customers **cannot** initiate; B1 (W→W) is the only customer-to-customer value movement. `customer_funding_requests` customer-facing surface is history-only (`GET /customers/me/funding-history`).
- **Channel/input representation of the customer's payment:** **none exists digitally.** The request row carries `amount_minor`, `currency`, `reference` (internal), `external_reference` (nullable free text, 255), `description`, `idempotency_key`, `request_hash`, maker identity. There is no payment-channel/envelope evidence object, no channel ledger-account mapping, no physical-cash-vs-bank-transfer distinction.
- **Money leg (on approval):** DEBIT `PAYMENT-SETTLEMENT_ASSET-NGN` (CUSTOMER_FUNDS accounting unit) → CREDIT customer wallet. Rejection posts **no journal**.
- **Maker responsibilities (executed today):** create request with reference + optional external reference; system records maker identity, hash, unique idempotency.
- **Checker responsibilities (executed today):** approve or reject; **maker ≠ checker enforced (403)**; SERIALIZABLE; optimistic version; journal + audit + outbox on approve; reject requires `rejection_reason`.
- **Limits:** funding is limit-enforced (CUSTOMER INCOMING action) where assignments exist — the funding amount counts into customer windows as incoming credit.
- **Notifications:** approval/rejection dispatch intent + outbox → console/test providers today (customer-visible history + unified transaction history type `FUNDING`).
- **Failure/rejection:** rejection = terminal REJECTED + reason + audit; approval retry-safe via idempotency (journal replay returns existing); mid-approval invariant proven by suite.

### 7.2 What D1 actually is (audit verdict, carried)

`D1 (customer-initiated funding request)`: the **requirement itself is unestablished** — audit row #67 BLOCKED — PRODUCT DECISION. This pack does not define a new flow; the questions below must first answer whether D1 exists at all.

### 7.3 D1/D-funding decisions (register references)

| # | Question per task | Machinery today | Decision preview (full register rows live in §10.11) |
|---|---|---|---|
| D-D-001 | Does a distinct **customer-initiated funding-request process** exist in V1 at all (beyond W→W and ops funding)? | No such process exists | PRODUCT — if YES, brand-new flow design out of this pack's scope (implementation task) |
| D-D-002 | What **channel/input represents the customer's payment** for ops-assisted funding (physical cash at agent? bank deposit reference? transfer slip reference)? Is `external_reference` sufficient evidence, or is a structured channel/evidence object required? | `external_reference` free text only | PRODUCT (with OPERATIONS input) |
| D-D-003 | Maker/checker **role requirements**: today's any-4-workforce-types vs finance-role assignment (ties to audit §24-2 security decision — NOT decided here) | type-level gate only | PRODUCT+SECURITY (dependency, not duplicated) |
| D-D-004 | Is funding **free or fee-bearing** (values n/a — fees-on-funding chain from V1-004)? | fee = 0 always | PRODUCT (= D-F-007) |
| D-D-005 | Is the funding amount subject to **customer limits by policy**, and with which window semantics (incoming credit only? counts to daily volume? funding-specific caps?) — vs "ops funding is policy-exempt" | enforced wherever assigned | PRODUCT (= D-L-006 + D-L-001) |
| D-D-006 | **Accounting treatment confirmation**: settlement-asset debit is the correct funding source at recognition; whether a distinct FUNDING-SOURCE/POOL account family per channel is required (ties to §8 A-family) | single settlement-asset account | FINANCE (= D-GL-007) |
| D-D-007 | **Notification/evidence sufficiency**: does approval notification carry reference/external reference/measure of provenance for the customer? | intent dispatch exists; payload sufficiency unverified-vs-policy | PRODUCT |
| D-D-008 | **Failure/rejection behavior beyond mechanics**: SLAs, maker re-request cadence, customer messaging on rejection | terminal states complete | OPERATIONS |
| D-D-009 | Any **physical-cash touchpoint** expectations at agents for D2 (cash→wallet) adjacent to D1/D3 (pool accounting incl. physical cash — audit §25-5) | pool accounting exists; no physical-cash recordkeeping | FINANCE+OPERATIONS (= D-GL-008) |

---

## 8. Accounting decisions (audit §25 carried; presentation only — none resolved)

**Constraint:** no account codes are invented in this section. Where the ledger lacks an account family, the entry is a **decision + implementation dependency (§9-D3)**, not a proposed code. Ledger types ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE exist and can host any family.

| ID | Subject | Options (all documented, none chosen) | Consequence/dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-GL-001 | **Fee revenue account treatment** | (a) product-level fee-revenue accounts (REVENUE) — granular statements/more accounts; (b) single pooled fee-revenue account with product in journal metadata — simple, coarser. Both compatible with snapshot ruleRefs | Required before fee charging; dimension of chart design | Finance | Blocks enablement | Chart-of-accounts design statement; per-product reporting requirement |
| D-GL-002 | **VAT treatment** | (a) VAT as separate payable liability leg at charge time; (b) VAT embedded in revenue, remitted periodically; (c) no VAT for V1 (rate question D-F-005 must answer first) | VAT computation code does not exist (§9-D1); jurisdiction evidence needed; invoicing/disclosure effects (D-I-002) | Finance(+Legal evidence) | Blocks enablement if fees are VAT-bearing | Jurisdictional tax opinion; invoicing practice |
| D-GL-003 | **Fee recognition timing** | (a) recognize at transaction completion (journals are atomic with the flow today — natural fit); (b) deferred recognition (needs accrual structures that do not exist) | (a) reuses atomic flow journals; (b) = §9 dependency incl. reversal windows | Finance | Blocks enablement | Finance recognition policy statement |
| D-GL-004 | **Commission expense/payable family + PLATFORM-retained mapping** | (a) commission as EXPENSE + PAYABLE liability pair (settle later); (b) immediate wallet credit netting expense; (c) PLATFORM recipient as contra-revenue vs expense | Account family absent (§9-D3); ties to settlement mechanism D-C-014 and payable timing D-C-015; aggregator crediting §9-D4 | Finance | Blocks enablement | Treasury/settlement decision; chart mapping proposal |
| D-GL-005 | **Reward/cashback accounting** | (a) promotional EXPENSE at grant; (b) PAYABLE/loyalty liability at grant, relieved at redemption/expiry; (c) contra-REVENUE; (d) wallet credit treated as customer-liability reclassification | Funding source (D-R-021) undefined; expiry (D-R-018) and clawback (D-V-004) semantics determine model; family absent (§9-D3) | Finance | Blocks enablement | Finance policy on promotional liability/expense; holding-period expectations |
| D-GL-006 | **Reversal/correction treatment** | (a) ledger reversal journals (machinery exists) with snapshot supersedes for commercial corrections; (b) compensating journals without formal reversal API; both keep snapshot immutability | Needs op workflow (D-V-001); must define which legs reverse (principal/fee/commission/reward — D-V-002…004) | Finance+Operations | Blocks enablement (once any commercial object lives) | Reversal/correction runbook requirements |
| D-GL-007 | **Funding source accounting confirmation (D3/D1)** | (a) continuation: DEBIT `PAYMENT-SETTLEMENT_ASSET-NGN`; (b) channel-specific settlement/pool accounts once channels are structured (D-D-002/D-D-006) | Chart design + reconciliation views; no codes proposed | Finance | Non-blocking for current ops | Channel plan; chart design |
| D-GL-008 | **Pool / physical-cash reconciliation expectations** (agent funding pool + physical cash at agents — audit §25-5) | (a) ledger-only pool with ops-side physical reconciliation reports (current); (b) tracked physical-cash sub-ledgers per touchpoint (design dependency) | Reporting exists today; sub-ledgers = implementation dependency; ties to agent suspension cash handling (audit §23-8 — product decision listed there, not duplicated) | Finance+Operations | Non-blocking | Field-operations reconciliation practice evidence |
| D-GL-009 | **Decision-recorded-but-posting-failed behavior** (commercial calculation succeeds but financial posting fails) | (a) whole flow fails atomically and **no snapshot is recorded** (current verified posture for the 0-charge reality — snapshot on success path only); (b) snapshot recorded with explicit failure status (schema change + policy on evidence-of-failure) | (a) is today's atomic-spine behavior; (b) changes evidence semantics for audits/reconciliation; must be decided BEFORE charge wiring writes non-zero decisions | Finance+Product | Blocks charge-wiring enablement | Failure-semantics requirement agreed by audit/reconciliation owners |
| D-GL-010 | **Reconciliation expectations for commercial objects** | fee/commission/reward rows absent today; reconciliation monitors ledger/wallet/transfer/pool planes (audit J-surface). Decision: what dimensions must break-monitor when commercial objects start posting (per-product revenue accounts, payable ledgers, payable-vs-posted differentials) | Follows D-GL-001/004/005; feeds ops runbooks (non-code documentation) | Finance(+Operations) | Blocks enablement (design), non-blocking for configuration | Operations reporting/break-tolerance requirements |

---

## 9. Dependencies for the later implementation/configuration task

Ordered. Each item names exactly what *implementation* work is required once the corresponding policy is decided — **no policy decided in this pack**.

| ID | Dependency | Trigger (which decisions) | Notes |
|---|---|---|---|
| §9-D1 | **V1 fee calculator + charge wiring** (compute flat + pct with min/max clamps + VAT; rounding per D-M; post fee legs per D-GL-001/002/003; disclosure payloads per D-I) | D-F-001…006 per product | Resolver already provides rule evidence; calculator entity must mirror commission/reward clamp discipline (floor) unless D-M-001 decides otherwise |
| §9-D2 | **Fee schema targeting extension(s)** (payer model; KYC segment; agent class; campaign) | D-F-003, D-K-001, D-A-001, D-P-002 | Only needed if policy requires differentiation beyond product+currency; additive migration; precedence policy D-P-001 must accompany |
| §9-D3 | **Commercial account families in the ledger** (fee-revenue, VAT-payable, commission expense/payable, reward liability/expense) | D-GL-001/002/004/005 | Provisioning task following AR-control pattern; no codes invented here; structural prerequisite for ANY commercial posting |
| §9-D4 | **Aggregator crediting design** (account destination or off-ledger accrual) | D-C-009 | ONLY if aggregator participates; today aggregators have no ledger identity |
| §9-D5 | **Reward usage-state design** (per-beneficiary/product/type counters for frequency/cumulative caps) | D-R-009…D-R-011 | Foundation primitive exists (recipient+product+type+count vocabulary only) |
| §9-D6 | **Commission/reward flow wiring pilots** (call engines in-flow, capture ALLOCATED/GRANTED snapshots, post per approved treatment) | after §26-8 gated pilots; §9-D1 clearly not required for commission if basis ≠ FEE | Audit §26-8: controlled per-recipient pilots behind approval; engines' fail-closed guards retained |
| §9-D7 | **Customer-facing disclosure surfaces** (confirmation fee display; receipt/history line items; customer limits view per D-L-M-010) | D-I-001/002, D-L view | Customer-app contract change (A23 territory) |
| §9-D8 | **D1 flow** (only if D-D-001 = YES): channel objects, evidence capture, possibly channel-account mapping | D-D-001/002/006 | New process design; out of any configuration-only task |

---


## 10. Decision register (master — de-duplicated across registers)

Blocking classes: **CONFIG** = V1 commercial **configuration cannot be completed** without it · **ENABLE** = rules/rows may be written but **runtime enablement/wiring must wait** · **NO** = safe to defer (will not invalidate decided items). Owners: Product / Finance / Operations / Security (+joints). "Evidence needed" = what the decider must bring. **No option is recommended; this pack chooses nothing.**

### 10.1 Fee (task matrix B; audit §23-4; H-02A outcome carried)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-F-001 | Fee-bearing vs free **per product** (7 independent answers) | (a) keep free (snapshot can record `ZERO` explicitly); (b) fee-bearing at launch; (c) free at launch, fee later with effective-dated rule | (b)/(c) trigger §9-D1 + D-GL-001/002; pilot continuation = H-02A's verified posture | Product | CONFIG | Commercial plan; pilot strategy; competitive benchmark |
| D-F-002 | Launch-timing/commitment for (b/c) — effective start per product | launch-day rule vs later effective window | Effective-dating mechanics ready; freeze policy D-P-003 | Product | CONFIG | Launch calendar; customer-comms plan |
| D-F-003 | **Payer model** per fee-bearing product | sender/customer-principal vs recipient-side vs agent-pool (agent-channel products) vs split | Payer ≠ sender is **not representable** in current fee schema (§9-D2); affects ledger legs and D-F-006 | Product+Finance | CONFIG (for fee-bearing products) | Product design per channel |
| D-F-004 | Model + values per fee-bearing product | flat / percentage / flat+pct (schema-supported); min/max bounds (schema-supported); **all values `VALUE REQUIRED — minor units / bps`** | Values land directly in `fee_rules`; tiered fee would need §9-D2 | Product | CONFIG | Pricing tables (business) |
| D-F-005 | **VAT policy** | (a) no VAT for V1; (b) VAT at `vat_bps` (`VALUE REQUIRED — bps`); (c) exempt/zero-rated classification per product | (b) activates D-GL-002 + computation §9-D1 + disclosure D-I-002; jurisdiction-specific | Finance (+Legal evidence) | ENABLE (for fee-bearing) | Tax opinion / jurisdiction rate |
| D-F-006 | Fee **included in displayed amount vs added on top** | include (fee carved from displayed amount) vs add-on (displayed = principal, fee + VAT extra) | Changes ledger math + disclosure (D-I-001/002) and customer-app contract; must precede charge wiring | Product+Finance | ENABLE | UX/jurisdictional disclosure norm |
| D-F-007 | Fee on **CUSTOMER_FUNDING** (ops-assisted) | free (recommended-not-decided by anyone) vs fee-bearing | same machinery/dependencies as D-F-004 + D-D-004 linkage | Product | CONFIG | Business policy |
| D-F-008 | Fee on **AGENT_FUNDING / AGENT_DEFUNDING** | free vs fee-bearing | Normally none; explicit answer still required to close the surface | Product | CONFIG | Business policy |

### 10.2 KYC pricing differentiation (task matrix C; feeds §9-D2)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-K-001 | Does customer KYC level change pricing **in V1** at all? | (a) no V1 KYC pricing (uniform fees); (b) yes, on selected products | (b) requires fee-schema extension (§9-D2) + which levels/eligibility (D-K-002/003) + precedence (D-P-001) | Product | CONFIG (only if YES for launch products) | Segment/pricing strategy; regulatory fairness guidance |
| D-K-002 | Which KYC levels are **eligible** for each fee-bearing product (eligibility ≠ price)? | all levels / selected levels | Intersects audit §23-3 KYC-gating product decision (out of this pack) — must be reconciled, not duplicated | Product | ENABLE | Risk policy |
| D-K-003 | Direction of KYC effect | higher KYC ⇒ lower fee / fixed schedule | Values `VALUE REQUIRED`; schema extension §9-D2 | Product | ENABLE | Segment pricing table |
| D-K-004 | Scope | all products vs named subset | Matrix consistency with D-F-001 answers | Product | NO | — |

### 10.3 Agent / Agent Class differentiation (task matrix D)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-A-001 | Does Agent Class affect **customer pricing (fees)** for agent-channel products (5.2/5.3/5.4)? | (a) no; (b) yes (class-tiered fees) | (b) = fee-schema extension (§9-D2) + precedence (D-P-001) | Product | CONFIG (only if YES) | Channel economics model |
| D-A-002 | Does Agent Class affect **commission** (= D-C-007 mapping)? | yes/no per product | machinery ready | Product (+Finance for accounting) | CONFIG (commission launch) | Agent-economics model |
| D-A-003 | Are **individual-agent overrides** permitted (= D-C-008 mapping)? | yes/no per product | machinery ready; individual-vs-class precedence still D-P-001 | Product | ENABLE | — |
| D-A-004 | Agent-class vs individual granularity in **reward** eligibility (reward register #3/#4 carried) | product-wide / class-targeted / KYC-targeted / individual | machinery ready | Product | ENABLE | Campaign design |

### 10.4 Commission (task matrix E; COMMISSION-01 register items 1–16 carried verbatim in substance)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-C-001 | Which V1 products generate commission? (register #1) — per product; expected subset: 5.2/5.3/5.4; explicit answers required for ALL 7 | pays / does not pay (per product) | First-order gate; every other C-item is scoped by the YES set | Product | CONFIG (commission launch) | Channel economics |
| D-C-002 | Recipient types per paying product? (register #2) | AGENT / AGGREGATOR / PLATFORM (multi-row possible; one rule row per recipient) | AGGREGATOR ⇒ §9-D4; PLATFORM ⇒ D-GL-004 | Product | CONFIG | — |
| D-C-003 | Calculation basis per product (register #3 + #16 gross-vs-policy-base) | PRINCIPAL / FEE / NET | FEE basis yields `BASE_UNAVAILABLE` until fee charging exists (D-F-001); NET requires a net-definition (principal−fee) convention = D-C-016 child question — **decide explicitly** | Product+Finance | CONFIG | — |
| D-C-004 | Calculation model per rule (register #4) | FLAT / PERCENTAGE / FLAT_PLUS_PERCENTAGE / TIERED | machinery ready; values `VALUE REQUIRED` | Product | CONFIG | — |
| D-C-005 | Min/max policy (register #5) | none / min / max / both (values `VALUE REQUIRED`) | clamp-after-compute is fixed mechanics (D-M-002) | Product | CONFIG | — |
| D-C-006 | Tiered usage + bracket semantics (register #6) | flat-vs-tiered per product; if tiered: confirm marginal (implemented) vs threshold (NOT implemented ⇒ §9-D2-class dependency) | marginal mechanics ready; brackets `VALUE REQUIRED` | Product | ENABLE | — |
| D-C-007 | Agent-class differentiation (register #7) | yes/no per product | machinery ready; precedent matrix D-P-001 | Product | CONFIG | — |
| D-C-008 | Individual-agent overrides (register #8) | yes/no per product | machinery ready; precedence D-P-001; governance depth (privileged approvals) audit §24-3 adjacent | Product (+Security for governance) | ENABLE | — |
| D-C-009 | Aggregator participation (register #9) | (a) no aggregator commission in V1; (b) yes ⇒ §9-D4 account design mandatory | structural: aggregator has no ledger identity today | Product+Finance | CONFIG (before any aggregator rule) | Aggregator commercial agreements |
| D-C-010 | PLATFORM allocation mapping (register #10 + 5.6/5.7 confirmation that AGENT_FUNDING/DEFUNDING pay nothing) | PLATFORM row as explicit allocation vs revenue-retained-by-omission (no row) | PLATFORM row needs account mapping (D-GL-004); funding products: confirm NONE | Product+Finance | CONFIG | — |
| D-C-011 | **Precedence hierarchy** across scopes (register #11) | explicit policy ordering {individual > class > product-wide} or other; tie policy beyond fail-closed | until decided, equal-priority overlap = AMBIGUOUS (honest empty) — acceptable or not? | Product | CONFIG | Rule-coverage matrix |
| D-C-012 | Effective-date governance (register #12) | lead time; change freeze; retro-active change prohibition | mechanics ready; cross-matches D-P-003 for all rule systems | Product+Operations | NO-unless-commission-launch ⇒ then ENABLE | Ops calendar |
| D-C-013 | Accounting treatment (register #13) | expense-vs-contra-revenue; expense+payable pair; immediate | mirrors D-GL-004 (single decision, dual-listed) | Finance | ENABLE | — |
| D-C-014 | Payable settlement mechanism (register #14) | wallet credit / payout rail (V2-parked) / netting against funding pool / cadence | payout rail is V2-parked (out of V1); netting/credit = journal design | Finance+Operations | ENABLE | Treasury decision |
| D-C-015 | Immediately payable vs accrued (register #15) | at transaction completion vs crystallizing event (later accrual) | determines journal shape + reversal exposure (D-V-003) and usage/audit windows | Finance | ENABLE | — |
| D-C-016 | Gross-fee vs net-fee vs principal as the *policy* base per product (register #16; the NET-definition convention feeding D-C-003) | define NET = principal − fee (or other) explicitly per product; or prohibit NET in V1 | affects every percentage rule if/when fees coexist with commission | Product+Finance | CONFIG (only when basis=FEE/NET in use) | — |


### 10.5 Reward / cashback (task matrix F; REWARD-01 register items 1–22 carried verbatim in substance)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-R-001 | Which products generate rewards? (#1) — per product | pays / none | gate for all R-items | Product | CONFIG (reward launch) | Growth strategy |
| D-R-002 | Eligibility (#2) — who can receive per product (incl. whether CUSTOMER_FUNDING counts — §5.5-F) | transacting customer / agent / both per product | machinery ready | Product | CONFIG | — |
| D-R-003 | Funding products explicit NONE confirmation (#1-scope) | confirm none (5.6/5.7) or exception | avoids default-assumption | Product | CONFIG | — |
| D-R-004 | Segment vs customer-specific eligibility (#3) + KYC/customer-class differentiation (#4) | product-wide / KYC-level-targeted (machinery) / class / individual | KYC machinery ready in reward schema; intersects D-K-001 fairness question | Product | CONFIG | — |
| D-R-005 | Model family (#5) | FLAT / PERCENTAGE / hybrid | machinery ready; values `VALUE REQUIRED` | Product | CONFIG | — |
| D-R-006 | Calculation basis (#6) | PRINCIPAL / FEE / NET | FEE basis = BASE_UNAVAILABLE until fees; NET definition = D-C-016 sibling | Product+Finance | CONFIG | — |
| D-R-007 | Min/max (#7) | none/min/max (`VALUE REQUIRED`) | clamp mechanics fixed | Product | CONFIG | — |
| D-R-008 | Tiered usage (#8) | none / marginal tiers (`VALUE REQUIRED`) | marginal ready | Product | ENABLE | — |
| D-R-009 | Frequency restrictions (#9) | none / per-day / per-week / per-customer-window | **requires §9-D5 usage-state design** | Product | ENABLE | — |
| D-R-010 | Per-transaction cap (#10) | none / MAX (`VALUE REQUIRED`) | machinery ready (clamp) | Product | CONFIG | — |
| D-R-011 | Cumulative cap (#11) | none / rolling window | **requires §9-D5** | Product | ENABLE | — |
| D-R-012 | Campaign/promotion model (#12) | always-on rules / campaign_code windows / both | `campaign_code` is a config-only string today — no campaign entity; model design needed before use (D-P-002 sibling) | Product | ENABLE | Marketing calendar |
| D-R-013 | Cross-scope precedence (#13) | explicit hierarchy vs fail-closed ambiguity as sufficient | same as D-P-001 economics | Product | CONFIG | — |
| D-R-014 | Schedule / effective dates (#14) | windows + lead-times | mechanics ready | Product+Operations | NO | Ops calendar |
| D-R-015 | Accounting treatment (#15) | — see D-GL-005 (single decision, dual-listed) | — | Finance | ENABLE | — |
| D-R-016 | When does a reward become payable? (#16) | at grant / at settlement / at accumulation threshold | determines journal shape + liability life-cycle (D-GL-005) | Finance+Product | ENABLE | — |
| D-R-017 | Credited immediately or accrued? (#17) | immediate wallet credit / accrued bucket | immediate = posting wiring; accrued = §9-D5-style state | Finance+Product | ENABLE | — |
| D-R-018 | Can rewards expire? (#18) | no expiry / validity window | expiry requires tracking state (§9-D5) + accounting release (D-GL-005-b) | Product+Finance | ENABLE | — |
| D-R-019 | Can rewards be reversed? (#19) | reversable only before X event / never | interacts D-V-004 | Product+Finance | ENABLE | — |
| D-R-020 | Underlying transaction reversed/failed → reward? (#20) | clawback / mark void / refund exclusion | mechanics: today decision-only, nothing granted; policy must predate wiring (D-V-004 sibling) | Finance+Product | ENABLE | — |
| D-R-021 | Reward **funding source** (#21) + coexistence with fees/commission (matrix F question) | platform-cost pool (needs account §9-D3) / netted from fee revenue (needs fees) / dedicated promo budget account | account family absent; coexistence (fee+commission+reward on one transaction) is allowed-by-machinery but accounting-complete-only-after D-GL-005 | Finance+Product | ENABLE | — |
| D-R-022 | Tax/accounting surface of grants (#22) (e.g., VAT/wihholding implications) | no V1 tax surface / tax-evidence required per grant type | no values anywhere in repo; legal/tax opinion needed — never invented | Finance (+Legal evidence) | NO-unless-launch ⇒ ENABLE | Tax opinion |

### 10.6 Precedence across commercial scopes (task matrix G)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-P-001 | Cross-scope precedence hierarchy | explicit ordering over {individual-agent, agent-class, KYC/segment, product-global, campaign/promotional} per rule system; within-scope = priority (mechanics) | Fee schema cannot address 4 of 5 scopes (§9-D2) — hierarchy will be partly policy-mapped; until decided: AMBIGUOUS fail-closed is the honest answer | Product | CONFIG | Rule-coverage matrix design |
| D-P-002 | Promotional-rule model & interaction | promo overrides / promo stacks / mutually exclusive | needs campaign model (D-R-012); fee promo = §9-D2 | Product | ENABLE | — |
| D-P-003 | Effective-date/version governance | minimum lead time; freeze windows; retro-change prohibition; change-approver depth | mechanics ready; governance depth intersects audit §24-3 (Security domain — do not duplicate) | Product+Operations | NO-unless-commercial-launch ⇒ ENABLE | Governance calendar |

### 10.7 Rounding (task matrix H)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-M-001 | Rounding mode family for percentage-derived amounts | (a) floor (current commission/reward mechanics; BigInt integer division); (b) half-up/banker's (would require calculator changes + re-verification) | Fee calculator to be built (§9-D1) inherits the decision; changing existing calculators = re-verification, not config | Finance (+Engineering evidence as dependency note) | ENABLE | — |
| D-M-002 | Ordering of min/max clamp and VAT within computation | (a) adopt existing (compute → clamp-after); (b) VAT before/after clamp variants for fee | current mechanics documented; fee calculator must encode the chosen order | Finance | ENABLE | — |

### 10.8 Disclosure (task matrix I)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-I-001 | Confirmation shows fee **before commit**? | pre-commit fee display / post-hoc only | customer-app contract surface (A23 territory); needed only for fee-bearing products; §9-D7 | Product | ENABLE | UX/regulatory guidance |
| D-I-002 | Receipt/history line items | principal-only / principal+fee / principal+fee+VAT rows | history payload already carries `feeMinor` ("0"); VAT rows depend D-F-005 | Product | ENABLE | — |
| D-I-003 | Funding-notification sufficiency (D-D-007 sibling) | current intent payload / enriched provenance (reference, issuer, timestamp) | notification pipeline is console/test today (deployment config, not this pack) | Product+Operations | NO | Ops policy |

### 10.9 Reversal / refund (task matrix K)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-V-001 | Ledger-reversal ops workflow become V1? (audit §23-11 carried) | stay V2-graded / minimum workflow now | machinery exists; changes J-operations posture | Product+Finance+Operations | NO (today) / ENABLE (once commercial objects post) | Ops readiness |
| D-V-002 | Fee on reversal | full refund / partial / never (per product) | legs design at §9-D1 time | Product+Finance | ENABLE | — |
| D-V-003 | Commission on reversal (or underlying-tx failure) | clawback before settlement / mark-adjust at settlement / never | payable timing D-C-015 determines exposure | Finance | ENABLE | — |
| D-V-004 | Reward on reversal/failure | clawback / void-at-grant precondition | precedence: decide BEFORE wiring pilots | Finance | ENABLE | — |
| D-V-005 | Correction mechanics | snapshot supersedes-only / ledger reversal / both (default expectation: both for money+evidence) | snapshot immutability is binding regardless | Finance | ENABLE | — |
| D-V-006 | **C2C expiry refund/refill policy** (product question independent of commercial config; exists today) | no auto-refund (current) / auto-credit initiator pool+wallet / ops-manual recovery | today's code: EXPIRED posts no journal — funds remain in pool with transfer status EXPIRED; changing = implementation task | Product+Operations | NO | Ops policy |

### 10.10 Limit value policy (carried from H-03 §14 items 2/4/10 + flow applicability; machinery superseded items NOT re-listed)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-L-001 | **Concrete limit values per product** (per-transaction min/max, wallet-balance max, window caps — where windows apply) | values `VALUE REQUIRED — minor units/count`; per-KYC/profile sets | assignments/rules rows land in limit-catalog; values decide the customer experience; CURRENT posture: only test assignments exist — production = no restriction evidence recorded | Product (+Risk evidence) | CONFIG (commercial launch posture) | Risk policy; regulator guidance (tiering norms) |
| D-L-002 | Limit **profile/assignment strategy** (who gets which profile; onboarding defaults) | global default / segment profiles / none-until-risked | machinery ready (profile catalogue + assignment) | Product+Operations | CONFIG | — |
| D-L-003 | Incoming-credit window policy (does CASH_TO_WALLET count into daily/monthly customer volume?) | yes/no per window | machinery treats directions per rule — policy decides rule rows | Product | ENABLE | — |
| D-L-004 | C2C leg policy | create-leg only / claim-leg only / both (current: both enforced where assigned) | explicit answer locks current mechanics | Product | CONFIG | — |
| D-L-005 | **Fee-in-limit interaction** (if fees exist: does fee count toward consumed limit?) | principal-only (current mechanics) / principal+fee | needs §9-D1 + rule mapping note in LimitEnforcementService evaluation input | Product+Finance | ENABLE (once fees) | — |
| D-L-006 | Funding limits (CUSTOMER_FUNDING / AGENT_FUNDING rows) | limit-bound (current mechanics) / policy-exempt (finance-ops directed) | funding maker/checker is ops-gated already; decide whether numbers apply (D-D-005 sibling) | Product | CONFIG | — |
| D-L-M-010 | Customer-facing limits view (H-03 #10) | internal diagnostics only (current) / `GET /customers/me/limits` remaining views | customer-app contract surface; §9-D7 sibling | Product | NO | — |

### 10.11 D1 — Customer funding (§7 full detail; task D1 section)

| ID | Subject | Options | Consequence / dependency | Owner | Blocks | Evidence needed |
|---|---|---|---|---|---|---|
| D-D-001 | Does customer-initiated funding REQUEST exist in V1 at all? (audit #67) | no (current: W→W + ops funding) / yes (new flow) | YES = new-process implementation task (§9-D8) — cannot be done by configuration | Product | NO (for commercial config) | Customer need analysis |
| D-D-002 | Channel/evidence model for ops funding | `external_reference` free-text sufficient / structured channel + evidence object | structured = implementation dependency (§9-D8-adjacent) | Product+Operations | NO-unless-D1-yes | Ops intake reality |
| D-D-003 | Maker/checker role depth | current any-workforce / finance-role assigned | ties audit §24-2 (Security domain decision — referenced, not decided) | Security+Product (joint, deferred) | NO | — |
| D-D-004 | Fee on funding | free / fee-bearing (`VALUE REQUIRED` if bearing) | = D-F-007 (dual-listed single decision) | Product | CONFIG | — |
| D-D-005 | Funding subject to customer limits? (and semantics) | bound (today's mechanics) / exempt / funding-specific rows | = D-L-006 (dual-listed) | Product | CONFIG | — |
| D-D-006 | Accounting confirmation for funding source | single settlement-asset (current) / channel pools | = D-GL-007 (dual-listed) | Finance | NO | — |
| D-D-007 | Notification sufficiency for funding events | current / enriched provenance | = D-I-003 (dual-listed) | Product+Operations | NO | — |
| D-D-008 | Failure/rejection ops cadence | current terminal / SLA + re-request | ops documentation only | Operations | NO | — |
| D-D-009 | Physical-cash touchpoint accounting at agents (pool + physical reconciliation) | ledger-only reports (current) / tracked sub-ledgers | = D-GL-008 + audit §23-8 sibling (suspension cash handling — separate product decision) | Finance+Operations | NO | — |

### 10.12 Accounting (§8 register repeated by reference)

D-GL-001…D-GL-010 are registered in §8 above (single source of truth for accounting decisions; summarizes: fee revenue family, VAT, recognition timing, commission expense/payable + PLATFORM mapping, reward accounting model, reversal/correction treatment, funding source confirmation, physical reconciliation, decision-vs-posting-failure behavior, commercial reconciliation expectations).

---

## 11. What blocks what (summary)

**Blocks V1 commercial CONFIGURATION (must be answered before any production rule row is written):**
- D-F-001 (free vs fee-bearing per product) · D-F-002 · D-F-003 · D-F-004 (values) · D-F-007 · D-F-008 ·
- D-K-001 (only if KYC pricing is intended for launch products) · D-A-001 (only if class-priced fees intended) ·
- D-C-001 · D-C-002 · D-C-003 · D-C-004 · D-C-005 · D-C-007 · D-C-009 (if aggregator participates) · D-C-010 · D-C-011 · D-C-016 (when FEE/NET bases used) ·
- D-R-001 · D-R-002 · D-R-003 · D-R-004 · D-R-005 · D-R-006 · D-R-007 · D-R-010 · D-R-013 ·
- D-P-001 (cross-scope precedence before overlapping scopes are configured) ·
- D-L-001 · D-L-002 · D-L-004 · D-L-006 · D-D-004 · D-D-005

**Blocks ENABLEMENT (configuration may proceed; runtime wiring/charging must wait):**
- D-F-005 · D-F-006 · D-K-002 · D-K-003 · D-A-002/003/004 · D-C-006/008/012/013/014/015 ·
- D-R-008/009/011/012/015/016/017/018/019/020/021/022 (D-R-013 is CONFIG; D-R-014 is non-blocking) · D-P-002/003 · D-M-001/002 ·
- D-I-001/002 · D-V-001…005 · D-L-003 · D-L-005 · D-GL-001…006 · D-GL-009 · D-GL-010

**Non-blocking (safe to defer):** D-K-004 · D-I-003 · D-V-006 · D-L-M-010 · D-R-014 · D-D-001/002/003/006/007/008/009 · D-GL-007/008 · D-P-003 (pre-launch) · D-C-012 (pre-launch; conditional rows D-K-001/002/003, D-A-001, D-R-022 activate only when their parent decision is YES).

---

## 12. Capability registry verification (task requirement)

Every relevant capability entry in `src/capability-registry/capability.seed.ts` (114 entries; suite-verified at 62/62 + 1325/1325) was cross-checked against live code at the starting HEAD:

| Entry | Seed state | Live verification | Verdict |
|---|---|---|---|
| `PRODUCT_CATALOGUE` | BACKEND_IMPLEMENTED · enabled **false** · CONFIGURED | 7 products seeded & served; no rule system references it at runtime (rule tables reference `product_code` as FK identity, but no runtime enablement gate consumes the catalogue) | **accurate — no change** |
| `FEE_RULES` / `FEE_RULE_RESOLVER` | BACKEND_IMPLEMENTED · enabled false · NOT_CONFIGURED | table + resolver exist; zero rules; resolver woven as evidence only | **accurate — no change** |
| `FEE_ENGINE` | (V2-era calculator space) | V2-parked consumers only (`src/policy/b1-*`); not part of V1 flows | **accurate — no change** |
| `FLAT_FEE` / `PERCENTAGE_FEE` / `PERCENTAGE_MIN/MAX/MIN_MAX_FEE` / `FLAT_PLUS_PERCENTAGE_FEE` | BACKEND_IMPLEMENTED (model shapes representable by `fee_rules` schema: flat ± pct ± min/max) | schema columns exactly support these shapes | **accurate — no change** |
| `TIERED_FEE` / `PROGRESSIVE_FEE` | PLANNED · PLANNED | no tier/progressive columns or calculator in fee schema | **accurate — no change** |
| `COMMISSION_ENGINE` / `COMMISSION_RULES` / `COMMISSION_RULE_RESOLVER` / `AGENT_COMMISSION` / `AGGREGATOR_COMMISSION` | BACKEND_IMPLEMENTED · enabled false · NOT_CONFIGURED | engine+resolver+calculator complete; zero rules; not wired (static guard) | **accurate — no change** |
| `REWARD_ENGINE` / `REWARD_RULES` / `REWARD_RULE_RESOLVER` | BACKEND_IMPLEMENTED · enabled false · NOT_CONFIGURED | engine+resolver+calculator complete; zero rules; not wired (static guard) | **accurate — no change** |
| `LIMIT_*` family (ENGINE/CATALOGUE/ASSIGNMENT/USAGE_RESERVATION/CUSTOMER_RUNTIME_LIMITS/AGENT_RUNTIME_LIMITS/DIAGNOSTICS/RECOVERY) | fully-enabled where enforced | LimitEnforcementService live in all 7 flows | **accurate — no change** |
| `COMMERCIAL_DECISION_SNAPSHOT` / `COMMERCIAL_RULE_VERSIONING` | fully-enabled | recorded for all 7 flows; rule versions + ref evidence | **accurate — no change** |
| `CUSTOMER_FUNDING` / `AGENT_FUNDING` / `AGENT_DEFUNDING` / `FUNDING_MAKER_CHECKER` | FULLY_ENABLED | wired flows confirmed | **accurate — no change** |

**Result: seed `capability.seed.ts` unchanged — no objectively incorrect status discovered. Per the standing rule, nothing was re-marked merely because policy is undecided: those entries correctly say `NOT_CONFIGURED`.**

---

## 13. Compliance confirmations (required)

1. **No pricing invented:** this document contains **zero** Naira amounts, percentages, commission rates, reward rates, VAT percentages, or limit values. Every value cell is `VALUE REQUIRED`. (Searched: the only numerals in §5–§10 are IDs, register item numbers, section references, and the scalar `bps ≤ 10000` schema bound + `max_grants_per_transaction = 1` quoting existing mechanics.)
2. **No production source changed:** `git` delta for this task contains ONLY this document. No `src/**`, no `test/**`, no `capability.seed.ts`, no flow/ledger/limit/authorization/commercial code touched.
3. **No migrations:** migration count remains **75**; no migration authored, no guard arrays touched, `migrationReferences` untouched.
4. **No commercial-rule seeds:** `fee_rules` / `commission_rules` / `reward_rules` remain at **zero production rows** (verified at inspection: seeds contain none — by design, as recorded in each engine's verification doc).
5. **No decisions taken:** every register item carries options with owners; this pack intentionally **recommends nothing** (H-02A's fee-free pilot continuation is cited as *current verified posture*, not as this pack's recommendation).
6. **Separation held:** capability (S1) vs configurable (S2) vs configured (S3) vs enabled (S4) vs policy-required (S5) vs accounting-approved (S6) is preserved throughout (§2), including in every per-product matrix row.

---

## Appendix A — Prior documents reconciled (all read at the starting HEAD)

| Document | Role in this pack |
|---|---|
| `docs/V1/V1-END-TO-END-PROCESS-AUDIT.md` | Authoritative audit (§6/§7/§21 rows 43/46/48/50/55/56/67, §23, §25, §26-1) — carried |
| `docs/archive/v1-implementation/S-FIX-01-VERIFICATION-REPORT.md` | Confirms S-FIX-01 boundary (security cluster closed; no commercial impact) |
| `docs/archive/v1-implementation/V1-HARDENING-02A-FEE-POLICY-DECISION.md` | Prior fee/accounting audit (OUTCOME C = BLOCKED) — policy posture carried; machinery conclusions marked superseded where implementation now exists |
| `docs/archive/v1-implementation/V1-HARDENING-03-LIMIT-POLICY-AUDIT.md` | Limit policy register — items carried/superseded per §6.10 |
| `docs/archive/v1-implementation/V1-COMMISSION-01-COMMISSION-ENGINE-ARCHITECTURE.md` | 16-item register → D-C-001…D-C-016 |
| `docs/archive/v1-implementation/V1-REWARD-01-REWARD-ENGINE-ARCHITECTURE.md` | 22-item register → D-R-001…D-R-022 |
| `docs/archive/v1-implementation/V1-COMMISSION-01-VERIFICATION-REPORT.md`, `docs/archive/v1-implementation/V1-REWARD-01-VERIFICATION-REPORT.md` | Machinery + evidence (full 62/62 · 1325/1325 run) — cited as capability evidence |
| `docs/archive/v1-implementation/V1-COMMERCIAL-02/03/04-VERIFICATION-REPORT.md`, `V1-COMMERCIAL-DECISION-01/02/03A–03E-VERIFICATION-REPORT.md` | Rule-registry/product-catalogue/snapshot wiring evidence per flow |
| `docs/archive/v1-implementation/V1-COMMERCIAL-ENGINE-CAPABILITY-REGISTRY-AUDIT.md` | Product-code authority reference (§12 canonical codes) |
| `docs/archive/phases-a2-a7/A5-PILOT-BASELINE.md`, `docs/archive/phases-a2-a7/A3-*`, `docs/archive/phases-b1-b2/B1-COMMERCIAL-*`, `docs/archive/phases-b1-b2/B2F-*` (via H-02A quote-surface) | Scope ancestry (fee-free pilot exclusion; B1 read-only commercial scope separate from V1 in-house) |

