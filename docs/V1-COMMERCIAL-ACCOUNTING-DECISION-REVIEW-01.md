# V1-COMMERCIAL-ACCOUNTING-DECISION-REVIEW-01 — Human Decision-Review Matrix

> **REVIEW / ANALYSIS ONLY.** This document decides nothing, recommends nothing, implements
> nothing, changes no runtime, adds no migration, provisions no account, and modifies no existing
> document. It does not replace `docs/V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.md` (which is
> untouched by this task) — it is a review surface layered over it so the human
> business/accounting owner can work through the 32 decisions efficiently **before** any
> accounting implementation begins.
>
> **Authoritative base:** `0c035f1bcaee2697c14805fcb41de78c8bbde319`
> (`docs(commercial): add accounting decision pack`).
> **Already complete (not reimplemented here):** Fee Runtime Wiring · Commission Runtime Wiring ·
> V1-COMMERCIAL-ACCOUNTING-AUDIT-01 · V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.
>
> **Source of truth:** the decision pack itself (`DP-01…DP-32`, contradictions `C-1…C-5`), backed
> by the registers it rests on: `docs/V1-COMMERCIAL-POLICY-DECISION-PACK.md` (P-DEC-01: §8 D-GL
> register, §9-D1…D8 dependencies, §10 decision tables), `docs/V1-COMMERCIAL-ACCOUNTING-AUDIT-01.md`,
> `docs/V1-COMMERCIAL-IMPLEMENTATION-AUDIT.md` (§14/M-10), `docs/B2F-CHART-CLASSIFICATION-CONTRACT.md`
> (line 337 role-selection prohibition; §18 contra / `UNMAPPED` roles), `docs/A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md`
> (line 143 repurpose prohibition), and the cited code anchors
> (`src/capability-registry/capability.seed.ts:2187`, `src/commission/commission.types.ts:17-19`,
> `src/commercial-decision/commercial-decision-snapshot.entity.ts:5`, `src/agent/agent-cash-to-cash-expiry.service.ts:24-38`,
> `src/aggregator/aggregator.entity.ts:23-27`, `src/ledger/ledger-journal.entity.ts:44`).
>
> **Editorial note:** the pack's DP-10 is a deliberate cross-reference entry (its canonical
> content lives at DP-12 / D-V-003). This review does not modify the pack; DP-10 is reviewed as a
> cross-reference row with its own decision fields, exactly as numbered in the pack.

**How to read each entry:** CURRENT REPOSITORY POSITION → OPTIONS (only documented ones) →
OPTION CONSEQUENCES (technical per option) → DEPENDENCIES (which DPs depend on this) → BLOCKS
(which implementation steps wait) → AFFECTED PRODUCTS / FLOWS → IMPLEMENTATION IMPACT →
SOURCE REFERENCES → DECISION OWNER. No entry recommends an option.

---

# A. FEE REVENUE (DP-01 … DP-04)

### DP-01 — Fee-revenue account granularity (D-GL-001)

CURRENT REPOSITORY POSITION:
No fee-revenue family exists (audit §4); the ledger's REVENUE account type exists but is
uninstantiated; B2F03 §13 role `finance.revenue.fee` (OPERATING_REVENUE) is `UNMAPPED`. Every fee
decision records `posting:{journalLegsPosted:false, reason:FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED}`.

QUESTION:
Per-product fee-revenue accounts, or a single pooled fee-revenue account with the product carried
in journal metadata?

OPTIONS:
(a) product-level REVENUE accounts — granular statements, more accounts;
(b) single pooled REVENUE account with product in journal metadata — simple, coarser.
(Register notes both are compatible with snapshot `ruleRefs`.)

OPTION CONSEQUENCES:
- (a) Up-to-7 family of fee-revenue accounts (one per fee-bearing product at D-F-001), each
  CREDIT-normal REVENUE. Journal composition must map `product_code → account` at charge time;
  per-product revenue is account-native (balances answer statements directly); the chart grows by
  one account per fee-bearing product; reconciliation break dimension becomes per-account (
  D-GL-010's "per-product revenue accounts" reads naturally).
- (b) One account total. Product attribution lives in the journal's metadata field
  (`src/ledger/ledger-journal.entity.ts:44` — a metadata JSONB exists today); per-product numbers
  become query-derived over metadata; reporting accuracy depends on metadata discipline and
  attribution completeness rather than account identity; the chart stays minimal.

DEPENDENCIES:
DP-04 (composition routes to the account(s)); DP-16 (break-monitor dimension);
DP-29 (provisioning shape/granularity); DP-23 (per-transaction identity statements only if (a)).

BLOCKS:
Fee-charging enablement (register: "Required before fee charging"); §9-D3 provisioning of the
fee-revenue family; D-GL-010's dimensions design; per-product reporting/statement design.

AFFECTED PRODUCTS:
Every product answering fee-bearing at D-F-001 (7 independent answers — potentially all seven).

AFFECTED FLOWS:
Fee legs at all seven flow snapshot sites (once charging exists); reporting/statement queries.

IMPLEMENTATION IMPACT:
(a) provision one account per fee-bearing product via the DP-31-governed mechanism (codes chosen
by Finance chart decision — none invented anywhere); composer selects account by `product_code`;
(b) provision one account; composer writes `product_code` into journal metadata; reporting queries
group by metadata. Either way: no schema change required (rows in `ledger_accounts`; REVENUE type
already exists), account lookup must fail-closed, composed legs must keep the journal
balanced/idempotent (implementation audit §14 test profile).

SOURCE REFERENCES:
P-DEC-01 §8 D-GL-001 + its evidence cell ("Chart-of-accounts design statement; per-product
reporting requirement"); pack DP-01; audit §4/§6; B2F03 §13 (`finance.revenue.fee` UNMAPPED);
`src/ledger/ledger-journal.entity.ts:44`.

DECISION OWNER:
Finance.

---

### DP-02 — Fee recognition timing (D-GL-003)

CURRENT REPOSITORY POSITION:
Flow journals are atomic with each flow (existing spine); no accrual or deferral structures exist;
fee posting is entirely absent.

QUESTION:
Recognize fee revenue at transaction completion, or defer recognition?

OPTIONS:
(a) recognize at transaction completion — register: "(journals are atomic with the flow today —
natural fit)";
(b) deferred recognition — register: "(needs accrual structures that do not exist)".

OPTION CONSEQUENCES:
- (a) Fee legs land inside the same atomic journal as the principal legs; recognition instant =
  transaction event; reversal exposure = reversal of that same journal (machinery exists);
  CASH_TO_CASH keeps its documented ambiguity — "completion" (initiation vs claim) is unpinned for
  fees (DP-13/DP-06), and IMPLEMENTATION-02 deliberately bound *commission* to initiation only.
- (b) Requires new accrual/deferral account families and periodic recognition journals — none of
  which exist; introduces reversal-window coupling (register: "§9 dependency incl. reversal
  windows"); decouples recognition from flow atomicity, which activates the drift questions of
  DP-15/DP-17/DP-18/DP-19.

DEPENDENCIES:
DP-04 (composition timing); DP-23 (allocation timing inherits by analogy); DP-21/DP-24 statement
shapes; DP-13 (C2C stage question).

BLOCKS:
Fee-charging enablement ("Blocks enablement"); any §9-D1 leg design; under (b), additionally the
unbuilt accrual machinery.

AFFECTED PRODUCTS:
All fee-bearing products; CASH_TO_CASH is the only two-stage lifecycle.

AFFECTED FLOWS:
Fee journal legs per flow; (b) adds periodic recognition journals/events.

IMPLEMENTATION IMPACT:
(a) composer appends fee legs to the same flow journal — reuses the verified spine, no new
execution machinery. (b) New account families (deferral/accrued), a periodic recognition execution
design (no such row exists in the registers — it would be a new §9-class dependency), plus
window/runbook policy. Recognition at claim for C2C fees would contradict the engine-free claim
design (IMPLEMENTATION-02) and is not available without a design change.

SOURCE REFERENCES:
P-DEC-01 §8 D-GL-003 (evidence: "Finance recognition policy statement"); pack DP-02; audit §3;
DP-13/B2F03.

DECISION OWNER:
Finance.

---

### DP-03 — VAT/tax stance and treatment (D-F-005 + D-GL-002) [register's only external-evidence rows]

CURRENT REPOSITORY POSITION:
`vat_bps` column exists on `fee_rules`; `vatMinor` exists in the fee snapshot (always `'0'`);
**no VAT rate, no VAT computation code, no VAT-payable account** anywhere (P-DEC-01 §10 note);
B2F03 reserves `finance.liability.tax-payable` (`UNMAPPED`); the fee schema has no VAT
*classification* column, so `vat_bps=0` is absence of charge, not a zero-rated classification.

QUESTION:
D-F-005 (stance): no VAT for V1? VAT at a rate? exempt/zero-rated per product?
D-GL-002 (treatment): separate payable liability leg at charge time? embedded in revenue and
remitted periodically? no VAT for V1? — register: "rate question D-F-005 must answer first".

OPTIONS:
D-F-005: (a) no VAT for V1; (b) VAT at `vat_bps` (`VALUE REQUIRED — bps`); (c) exempt/zero-rated
classification per product.
D-GL-002: (a) VAT as separate payable liability leg at charge time; (b) VAT embedded in revenue,
remitted periodically; (c) no VAT for V1.

OPTION CONSEQUENCES:
- D-F-005(a): no VAT legs ever post; `vat_bps` stays unused at 0; §9-D1 VAT computation is not
  built; disclosure (D-I-002) unaffected. This posture is what today's zero-charge reality
  exhibits, but the register holds the *policy* open.
- D-F-005(b): needs a jurisdictional rate (external evidence) plus VAT computation inside the
  charge path (§9-D1 — the computation code does not exist) plus a VAT-payable family (§9-D3).
- D-F-005(c): needs a *classification* representation that the schema does not have (no column) —
  i.e., schema change + classification governance, on top of (b)-class mechanics where rate ≠ 0.
- D-GL-002(a): activates computation (§9-D1) + disclosure (D-I-002): a third leg (VAT payable)
  posts at charge time; `finance.liability.tax-payable` family provisioned; a remittance process
  is implied but has no machinery today.
- D-GL-002(b): revenue is recorded gross with a remittance later: requires a revenue-split
  computation at statement/remittance time plus periodic remittance journals (no machinery).
- D-GL-002(c): status-quo treatment; only valid as an explicit policy, not as silence.

DEPENDENCIES:
D-F-005 precedes D-GL-002 (register's explicit sequencing); DP-04 (composition gains/lacks legs);
D-I-002 disclosure surface; DP-29 (tax-payable family provisioning).

BLOCKS:
Fee enablement **if fees are VAT-bearing** (both rows' blocking text); VAT computation build;
disclosure surface; §9-D3 tax-payable provisioning.

AFFECTED PRODUCTS:
All products that become fee-bearing; classification (if any) is per product.

AFFECTED FLOWS:
Charge-time journal legs (VAT payable leg under (a)); future remittance journals;
invoice/receipt disclosure surfaces.

IMPLEMENTATION IMPACT:
Rate path: populate `vat_bps` (values required — none proposed anywhere), implement VAT
computation in the charge path (§9-D1, does not exist), provision payable family, remittance
journal design, D-I invoices/receipts. Classification path: adds a schema column (a migration
beyond the current 76) + classification governance. No-VAT path: no code; the policy row is
recorded as decided (currently open).

SOURCE REFERENCES:
P-DEC-01 §10.1 D-F-005, §8 D-GL-002 (evidence: "Jurisdictional tax opinion; invoicing practice"),
§10 note on VAT absence; pack DP-03; B2F03 (`finance.liability.tax-payable` UNMAPPED); §9-D1.

DECISION OWNER:
Finance(+Legal evidence) — for both rows. (This pair is the pack's only [TAX] external-evidence
item; nothing here is presented as an existing regulatory rule — no [REG] row exists in the pack.)

---

### DP-04 — Fee-revenue ledger leg composition (design row)

CURRENT REPOSITORY POSITION:
Flows post exactly two principal legs; every fee decision records
`posting:{journalLegsPosted:false, reason:FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED}`; no code
anywhere composes fee legs (IMPLEMENTATION-01 verification + runtime-wiring test 24).

QUESTION:
For each fee-bearing product: exact fee journal legs (accounts, direction, ordering, currency,
metadata/product attribution) and their composition inside the existing journal without breaking
the balanced/idempotent/SERIALIZABLE spine?

OPTIONS:
No option enumeration exists anywhere — this is a design row (§9-D1) whose outcome space is
governed by DP-01/DP-02/DP-03 plus the payer semantics of D-F-003 (payer model; payer ≠ sender is
**not representable** in the current fee schema — §9-D2) and D-F-006 (included-in-amount vs
added-on, which changes the ledger math).

OPTION CONSEQUENCES:
Reachable outcomes are a function of the governing combinations: added-on sender-pays composes a
separate payer-leg + revenue leg (plus VAT leg under DP-03-a); included-in-amount changes the
*split* of the principal-transferring legs; physical-cash payer semantics (W2C/C2W cash sides) may
place part of the consideration outside the ledger entirely. Each combination yields a different
journal shape; none is enumerated as a chosen set.

DEPENDENCIES:
DP-01 (which account(s)); DP-02 (when legs post); DP-03 (whether VAT legs exist); D-F-003/D-F-006
(CONFIG-blocking register rows); §9-D2 schema dependency if payer ≠ sender.

BLOCKS:
§9-D1 fee-charging legs build; composition tests; D-GL-009 (DP-15) must be decided **before**
charge-wiring writes non-zero decisions (register).

AFFECTED PRODUCTS:
Each fee-bearing product independently; funding-product fees are separately gated by D-F-007/D-F-008.

AFFECTED FLOWS:
All seven flow journals' line composition; snapshot ↔ journal linkage fields (existing).

IMPLEMENTATION IMPACT:
Charge-leg composer inside flow transactions; tests reproving balance/idempotency/supersedes on
principal+fee compound journals; fail-closed account lookup (implementation audit §14); payer
models outside the schema ⇒ §9-D2 schema dependency first.

SOURCE REFERENCES:
Pack DP-04; P-DEC-01 §9-D1/§9-D2, §10.1 D-F-003/D-F-006; IMPLEMENTATION-01 verification report;
audit §14 (prerequisite row: fee revenue precedes FEE-basis commission legs).

DECISION OWNER:
OWNER NOT SPECIFIED (governing rows: Finance for D-GL, Product/Product+Finance for D-F).

---

# B. COMMISSION (DP-05 … DP-10)

### DP-05 — Commission expense/payable family + PLATFORM-retained mapping (D-GL-004 — the fork)

CURRENT REPOSITORY POSITION:
No commission account family exists; every ALLOCATED decision is evidence-only
(`payable:false`, both `NOT_PROVISIONED` blockers, no journal leg). B2F03:
`finance.expense.commission` (COST_OF_REVENUE) and reserved `finance.liability.commission-payable`
are both `UNMAPPED`. Agent wallet accounts (`WALLET-*`, LIABILITY) exist per agent — the
destination for option (b) is already provisioned infrastructure. D-C-013 is the same decision
dual-listed (register: "mirrors D-GL-004 (single decision, dual-listed)").

QUESTION:
Which accounting treatment carries an agent commission: expense+payable pair, immediate wallet
netting, or platform-share contra-revenue presentation?

OPTIONS:
(a) commission as EXPENSE + PAYABLE liability pair (settle later);
(b) immediate wallet credit netting expense;
(c) PLATFORM recipient as contra-revenue vs expense.
Cross-cutting prohibition (B2F03 line 337): "**Automatic role selection from the kind alone is
prohibited**" — the decision cannot be delegated to a rule-kind mapping.

OPTION CONSEQUENCES:
See the SPECIAL FOCUS comparison below (11 dimensions × 3 options). Summary:
- (a) two new families (DR expense, CR payable), standing third-party liability, aging/settlement
  machinery, reversal exposure until settlement;
- (b) agent WALLET-* credited at completion (destination exists), still needs an EXPENSE family
  unless presented net (which interacts with (c)/fee gross-up), reversal exposure is immediate
  clawback policy, not accrual adjustment;
- (c) requires contra account capability that `LedgerService.createAccount` does not provide
  (normal-balance enforcement; B2F03 §18) — `NOT VERIFIED / REQUIRES REVIEW` and a ledger-capability
  change with a separately approved A5-compatible design.

DEPENDENCIES:
DP-06/DP-07 (recognition timing co-gate); DP-09 (presentation inherits); DP-12 (reversal binds);
DP-16 (payable dimensions follow); DP-21/DP-24 (presentations reachable via it); DP-29
(provisioning — §9-D3 names D-GL-001/002/004/005); D-C-010 (PLATFORM mapping, DP-20); §9-D4
(aggregator crediting, DP-26).

BLOCKS:
Commission posting enablement ("Blocks enablement"); §9-D3 commission families; D-GL-010 payable
differential design; settlement journals design; agent wallet credit flow under (b).

AFFECTED PRODUCTS:
The D-C-001 YES-set (register candidates per §5.2/5.3/5.4: W2C/C2W/C2C; wallet_transfer only if
D-C-010 extends to PLATFORM retention — D-C-001 alone decides).

AFFECTED FLOWS:
C2W/W2C/C2C-initiation journals (commission legs); settlement journals if (a); agent wallet
liability balances if (b); platform revenue statements (all).

IMPLEMENTATION IMPACT:
(a) two account families + settlement execution (per DP-08 rail) + aging + reconciliation +
payable differential monitors; (b) EXPENSE family + wallet credit inside the transaction journal +
operator clawback policy + wallet-balance exposure; (c) ledger capability change: contra accounts
with opposite normal balance are **not creatable** under the current `createAccount` contract —
requires a separately approved A5-compatible extension before any (c) posting exists.

SOURCE REFERENCES:
P-DEC-01 §8 D-GL-004 (evidence: "Treasury/settlement decision; chart mapping proposal"), §10.4
D-C-013; B2F03 line 337 + §18; §9-D3/§9-D4; D-C-014/D-C-015; D-V-003; pack DP-05;
`src/ledger/ledger.service.ts` (normal-balance enforcement).

DECISION OWNER:
Finance.

---

### DP-06 — Commission-payable recognition timing (crystallizing event)

CURRENT REPOSITORY POSITION:
No payable family exists; ALLOCATED evidence already carries `commissionEvent` stamps
(`TRANSACTION_COMPLETION` on W2C/C2W; `CASH_TO_CASH_INITIATION` on C2C) — *economic* event
annotations, not recognition policy.

QUESTION:
At what moment does the payable (DP-05(a)) or expense (either fork) crystallize: at the recorded
transaction event, or at a later crystallizing event?

OPTIONS:
No standalone option row exists. This question is folded into D-C-015's options (DP-07): "at
transaction completion vs crystallizing event (later accrual)". The C2C-specific instant
(initiation vs claim) is unpinned by any row; claim-side recognition would contradict the
engine-free claim design (IMPLEMENTATION-02) and is therefore not an available documented option
without a design change.

OPTION CONSEQUENCES:
- At the recorded transaction event: payable/expense legs post inside the transaction journal;
  exposure window = the transaction's reversal window; C2C exposure starts at initiation (a
  transfer that later EXPIRES engages DP-12/DP-13 — no reversal path for that case is decided).
- At a later crystallizing event: standing accrual until that event; requires machinery to
  recognize in batches (no such machinery exists for commercial objects); the D-GL-010
  payable-vs-posted differential dimension becomes definable.

DEPENDENCIES:
Co-gates DP-05 (its (a) implies accrual-at-completion per the register); DP-12 exposure window;
DP-16 differentials; DP-13 expiry interplay.

BLOCKS:
Commission posting enablement (inherited from D-GL-004/D-C-015 blocking).

AFFECTED PRODUCTS:
All commission-paying products; CASH_TO_CASH uniquely two-stage (initiation/claim/expiry).

AFFECTED FLOWS:
Timing of DR expense / CR payable legs relative to principal legs; C2C initiation vs claim stages.

IMPLEMENTATION IMPACT:
At-event: composer config in the transaction journal. Later-event: new periodic/crystallizing
recognition execution design (not in any register — new §9-class dependency) + windows policy.

SOURCE REFERENCES:
Pack DP-06; P-DEC-01 §10.4 D-C-015; `commissionEvent` stamps (IMPLEMENTATION-02 verification);
audit lifecycle map.

DECISION OWNER:
OWNER NOT SPECIFIED (governing rows: D-C-015 Finance, D-GL-004 Finance).

---

### DP-07 — Immediately payable vs accrued (D-C-015)

CURRENT REPOSITORY POSITION:
Register row verbatim: "**Immediately payable vs accrued (register #15)** | at transaction
completion vs crystallizing event (later accrual) | determines journal shape + reversal exposure
(D-V-003) and usage/audit windows".

QUESTION:
When does any commission obligation become payable: at the transaction event, or later (accrue
then settle)?

OPTIONS:
(at transaction completion) vs (crystallizing event — later accrual).

OPTION CONSEQUENCES:
- At transaction completion: per-transaction journal shape; no payable ledger standing if combined
  with DP-05(b); exposure window starts immediately; shorter usage/audit windows.
- Later accrual: standing payable, settlement batches, aging obligation, D-GL-010
  payable-vs-posted differential dimension meaningful, larger reversal exposure until settlement
  (D-V-003).

DEPENDENCIES:
Co-gate of DP-05 (option (b) presupposes immediate; option (a) presupposes accrue-then-settle);
governs DP-12 exposure; DP-16 dimensions; DP-08 settlement need.

BLOCKS:
Commission enablement (ENABLE row).

AFFECTED PRODUCTS:
D-C-001 YES-set.

AFFECTED FLOWS:
Whether payable legs exist per transaction vs per settlement batch; usage/audit windows.

IMPLEMENTATION IMPACT:
At-completion: composer config only. Accrual: payable standing + batch settlement execution (rail
per DP-08) + aging views + differential monitoring.

SOURCE REFERENCES:
P-DEC-01 §10.4 D-C-015 (evidence: "Treasury decision"); pack DP-07.

DECISION OWNER:
Finance.

---

### DP-08 — Commission payout / settlement rail (D-C-014)

CURRENT REPOSITORY POSITION:
Register row verbatim: "**Payable settlement mechanism (register #14)** | wallet credit / payout
rail (V2-parked) / netting against funding pool / cadence | payout rail is V2-parked (out of V1);
netting/credit = journal design". A18 documents payout execution as V2 scope; capability
EXTERNAL_SETTLEMENT is V2/PLANNED.

QUESTION:
Through which rail does an accrued commission (DP-05(a)) reach the agent: wallet credit, an
external payout mechanism, or netting against the agent funding pool — and at what cadence?

OPTIONS:
wallet credit / payout rail (V2) / netting against funding pool / cadence (open).

OPTION CONSEQUENCES:
- Wallet credit: intra-ledger movement (DR payable / CR agent WALLET-*); destination accounts
  exist today; converts the payable to a wallet liability ledger-to-ledger; no external
  integration; executable within V1 structures.
- Payout rail: V2-parked capability (EXTERNAL_SETTLEMENT PLANNED, no machinery) — choosing it
  defers settlement execution out of V1; accrued payables would stand in V1 waiting on V2 rails.
- Netting against funding pool: changes AGENT_FUNDING pool semantics (pool↔wallet journals exist;
  netting means reducing pool liability against a payable — no such journal design or code path
  exists); engages D-GL-008 pool reconciliation planes (non-blocking today).
- Cadence: batching policy for settlements if accrued; no defaults documented.

DEPENDENCIES:
Presupposes DP-05(a) and/or DP-07-accrual; its wallets/netting outcomes feed the aggregator
analogues DP-26/DP-28; pool reconciliation D-GL-008.

BLOCKS:
Settlement execution enablement for an accrued commission model (ENABLE row).

AFFECTED PRODUCTS:
All commission-paying products; AGENT_FUNDING/AGENT_DEFUNDING if pool netting is chosen.

AFFECTED FLOWS:
New settlement journals; existing pool↔wallet journals if netted; external rails (V2 only).

IMPLEMENTATION IMPACT:
Wallet credit: settlement composer path (DR payable/CR wallet) inside the ledger constraints.
Payout rail: V2 scope — outside this repository's V1 delivery. Pool netting: pool semantic change
touching agent-funding/pool flows (a future implementation task; not sanctioned by any current
register row).

SOURCE REFERENCES:
P-DEC-01 §10.4 D-C-014 (evidence: "Treasury decision"); A18 boundary; EXTERNAL_SETTLEMENT
capability entry; pack DP-08; D-GL-008.

DECISION OWNER:
Finance+Operations.

---

### DP-09 — Commission accounting relationship to fee revenue

CURRENT REPOSITORY POSITION:
Code records fee and commission decisions **independently** — `src/commission/commission.types.ts:17-19`:
"The engine never defines or assumes any relationship between those values; each is
decided/configured separately." FEE-basis commission requires the fee to exist and be collected —
today the fee is `CALCULATED_NOT_COLLECTED` (annotation on every ALLOCATED decision); the audit
documents: "FEE-revenue is a prerequisite of FEE-basis legs" (§14).

QUESTION:
In journal terms, is agent commission a deduction from recorded fee revenue (DP-05 presentations),
and may any FEE-basis commission leg authorize from a fee-revenue leg that has not yet posted?

OPTIONS:
No standalone option row; the presentation outcomes are exactly DP-05's three options; separately,
the register's D-C-003 (basis = PRINCIPAL/FEE/NET — with FEE documented as `BASE_UNAVAILABLE`
until charging) and D-C-016 (NET definition — gross-fee vs net-fee vs principal — or prohibit NET)
decide when "fee − commission" arithmetic exists at all.

OPTION CONSEQUENCES:
- Under DP-05(a): gross fee CR paired with DR commission expense / CR payable — fee and commission
  coexist gross; statements show both.
- Under DP-05(b): fee CR gross; commission expense DR against agent wallet CR — visible separately.
- Under DP-05(c): commission presented as reduction of revenue — statements show net lines;
  requires the contra capability (not creatable today).
- FEE-basis legs: ordering constraint — fee revenue recognized before/within the journal that
  carries FEE-basis commission legs (atomic journal can host both; cross-transaction cases would
  be a new design, not documented).
- NET basis without D-C-016: prohibited/undefined by construction (register).

DEPENDENCIES:
DP-05 (all presentations); D-C-003/D-C-016 (CONFIG register rows); DP-21/DP-24 statements.

BLOCKS:
Enablement of FEE- or NET-basis commission rules; ordering inside §9-D1/D-GL-004 composition.

AFFECTED PRODUCTS:
Commission-paying fee-bearing products (C2W/W2C/C2C candidates).

AFFECTED FLOWS:
C2W/W2C/C2C journals; revenue accounts (once provisioned); statement views.

IMPLEMENTATION IMPACT:
Composer ordering + basis-data availability in the charge path (FEE basis currently resolves as
`BASE_UNAVAILABLE` until fee charging exists); statements/reporting per presentation choice.

SOURCE REFERENCES:
Pack DP-09; P-DEC-01 §10.4 D-C-003/D-C-016; audit §14; `src/commission/commission.types.ts:17-19`.

DECISION OWNER:
Finance (via D-GL-004) with Product+Finance (via D-C-016).

---

### DP-10 — Commission reversal treatment (cross-reference row)

CURRENT REPOSITORY POSITION:
The decision pack defines DP-10 as a deliberate cross-reference: the canonical entry is DP-12
(D-V-003, category C). Nothing posts today, so nothing exists to claw back (P-DEC-01 §5.1-K).

QUESTION:
Where is the commission-reversal decision reviewed? — At DP-12, which holds the full 11-field
review. This row exists to guarantee the pack's numbering (B.10 in the original task list) is
represented without duplicating the decision.

OPTIONS:
As DP-12: clawback before settlement / mark-adjust at settlement / never.

OPTION CONSEQUENCES:
As DP-12 (binds whichever treatment DP-05 selects).

DEPENDENCIES:
DP-12's dependencies (DP-07 exposure window; DP-05 fork).

BLOCKS:
Reversal handling of commission legs (with DP-12).

AFFECTED PRODUCTS:
As DP-12.

AFFECTED FLOWS:
As DP-12.

IMPLEMENTATION IMPACT:
As DP-12.

SOURCE REFERENCES:
Pack DP-10/DP-12; P-DEC-01 §10.9 D-V-003; §5.1-K.

DECISION OWNER:
Finance (D-V-003 owner).

---

# C. REVERSALS / EXPIRY (DP-11 … DP-15)

### DP-11 — Ledger-reversal ops workflow (D-V-001)

CURRENT REPOSITORY POSITION:
Reversal machinery exists (reversal journals linked via `reversal_of_journal_id` +
`POST /ledger/journals/:id/reversal`); **no ops workflow** exists; P-DEC-01 §10.9 marks its effect
on "J-operations posture".

QUESTION:
(verbatim) "Ledger-reversal ops workflow become V1? — stay V2-graded / minimum workflow now".

OPTIONS:
stay V2-graded / minimum workflow now.

OPTION CONSEQUENCES:
- Stay V2-graded: machinery remains operator-unapproved — only APIs exist; when commercial legs
  later need reversal, no sanctioned operational path exists (reversal of any commercial object
  becomes an ad-hoc engineering action).
- Minimum workflow now: an ops runbook/approval routing/evidence design (documentation-class
  work, unless tooling is demanded); gates every DP-12/DP-13/DP-14 answer operationally.

DEPENDENCIES:
DP-12, DP-13 (ops-recovery option), DP-14 (both require the workflow for execution);
DP-19 (manual correction).

BLOCKS:
"NO (today) / ENABLE (once commercial objects post)" (register).

AFFECTED PRODUCTS:
All seven (once commercial objects post); CASH_TO_CASH expiry independently.

AFFECTED FLOWS:
All journal families via reversal journals; ops manual-correction paths.

IMPLEMENTATION IMPACT:
Stay: none now; reversal capability remains API-only. Minimum workflow: ops documentation +
approval/evidence capture (privileged-action pattern available as precedent — see DP-31's
A5-provisioner evidence model as the only in-repo template).

SOURCE REFERENCES:
P-DEC-01 §10.9 D-V-001 (evidence: "Ops readiness"); pack DP-11; ledger reversal machinery
(`reversal_of_journal_id`).

DECISION OWNER:
Product+Finance+Operations.

---

### DP-12 — Commission on reversal / underlying-transaction failure (D-V-003)

CURRENT REPOSITORY POSITION:
Register row verbatim: "**Commission on reversal (or underlying-tx failure)** | clawback before
settlement / mark-adjust at settlement / never | payable timing D-C-015 determines exposure".
Latent today — nothing posts.

QUESTION:
When the underlying transaction is reversed (or a C2C transfer expires), what happens to a posted
commission?

OPTIONS:
clawback before settlement / mark-adjust at settlement / never.

OPTION CONSEQUENCES:
- Clawback before settlement: under DP-05(a) the payable is extinguished (CR-side removal without
  touching the wallet); under DP-05(b) it requires a *new* debit of the agent's WALLET-* — operator
  policy plus a new code path (no such workflow exists — DP-11).
- Mark-adjust at settlement: exposure carried into the next settlement batch (presupposes standing
  payable — the DP-05(a)/DP-07-accrual combination); the erroneous amount nets against later
  obligations instead of an immediate correction.
- Never: commission expense stands even on reversed principal; statements show commissions on
  reversed/failed transactions (reporting consequence; mechanically cheapest).

DEPENDENCIES:
DP-07 (exposure window); DP-05 (which counterparty the clawback hits); DP-14 (mechanics);
DP-13 (C2C expiry is the only existing economic event in this class).

BLOCKS:
Reversal handling of commission legs (ENABLE row).

AFFECTED PRODUCTS:
Commission-paying products; CASH_TO_CASH expiry class first in practice.

AFFECTED FLOWS:
Reversal legs on payable (if accrued) or agent wallet (if netted); settlement batches.

IMPLEMENTATION IMPACT:
(a)-fork: payable extinguishment leg (reversal journal machinery exists). (b)-fork + clawback:
new operator-approved wallet-debit path (does not exist). Mark-adjust: settlement netting design.
Never: no code.

SOURCE REFERENCES:
P-DEC-01 §10.9 D-V-003; pack DP-12; D-C-015 exposure note; IMPLEMENTATION-02 (initiation-only
commission event).

DECISION OWNER:
Finance.

---

### DP-13 — CASH_TO_CASH expiry accounting treatment (live behavior; D-V-006)

CURRENT REPOSITORY POSITION (verified live code):
`src/agent/agent-cash-to-cash-expiry.service.ts:24-38`: "**EXPIRY DOES NOT MOVE FUNDS. The
principal remains in CASH_TO_CASH-UNCLAIMED-NGN liability. No journal is created on expiry. No
automatic refund to Agent.**" Transfer status flips to EXPIRED; the claim leg pays the customer
(DEBIT unclaimed → CREDIT customer wallet).

QUESTION:
(D-V-006 verbatim) "**C2C expiry refund/refill policy** — no auto-refund (current) / auto-credit
initiator pool+wallet / ops-manual recovery". For the future: if fee/commission legs ever post at
initiation, an EXPIRED transfer's commercial legs are the first practical application of DP-12/DP-14.

OPTIONS:
no auto-refund (current) / auto-credit initiator pool+wallet / ops-manual recovery.

OPTION CONSEQUENCES:
- No auto-refund (current): funds sit in the unclaimed liability indefinitely; the liability is
  never relieved; aging/escheat reporting consequences accumulate; zero code change.
- Auto-credit initiator pool+wallet: new journals at EXPIRED transition
  (DR `CASH_TO_CASH-UNCLAIMED-NGN` → CR agent wallet and/or pool — the register's option includes
  "pool+wallet"); new code inside the expiry service; pool semantics touched (see D-GL-008;
  contradiction C-2 guarantees the pool is not where funds sit today).
- Ops-manual recovery: DP-11 workflow + manual journals; operator load per expiry class.

DEPENDENCIES:
DP-11 (ops path); DP-12/DP-14 (commercial-leg treatment on expiry); contradiction C-2
(misnomer resolution before refund design targets an account family).

BLOCKS:
"NO" (register) today; becomes gating the moment any commercial leg posts at initiation.

AFFECTED PRODUCTS:
CASH_TO_CASH only.

AFFECTED FLOWS:
Potential future EXPIRED-release journals (unclaimed → agent wallet/pool); none exist today;
claim journals (existing, unchanged by this decision).

IMPLEMENTATION IMPACT:
Current: none. Auto-credit: expiry service gains posting code (new journals, idempotent in the
existing SKIP-LOCKED sweep). Ops-manual: runbook + privileged journal executors.

SOURCE REFERENCES:
P-DEC-01 §10.9 D-V-006 (evidence: "Ops policy"); pack DP-13;
`src/agent/agent-cash-to-cash-expiry.service.ts:24-38`; contradiction C-2.

DECISION OWNER:
Product+Operations.

---

### DP-14 — Reversible commercial legs and mechanics (D-GL-006 + D-V-005)

CURRENT REPOSITORY POSITION:
D-GL-006 verbatim: "(a) ledger reversal journals (machinery exists) with snapshot supersedes for
commercial corrections; (b) compensating journals without formal reversal API; both keep snapshot
immutability". D-V-005: "snapshot supersedes-only / ledger reversal / both (**default expectation:
both for money+evidence**)".

QUESTION:
Which commercial legs reverse (principal/fee/commission/reward — D-V-002/003/004 per object) and
through which mechanics and account families (mirror legs into the ORIGINAL accounts vs
compensating legs)?

OPTIONS:
D-GL-006 (a)/(b) as quoted; D-V-005: supersedes-only / ledger reversal / both.

OPTION CONSEQUENCES:
- Reversal journals + supersedes: mirror legs against the ORIGINAL accounts, linked via
  `reversal_of_journal_id` (machinery exists), plus evidence-plane supersedes — the only
  combination that corrects BOTH planes (matches D-V-005's documented default expectation).
- Compensating journals without formal reversal API: unlinked balance corrections; weaker
  audit linkage (no explicit reversal relation); no new API.
- Supersedes-only: corrects evidence but NOT money — incomplete wherever a leg has already posted.

DEPENDENCIES:
DP-11 (ops workflow gates execution); D-V-002 (fee refund per product)/D-V-004 (reward clawback);
DP-12 (commission specifics); the target account families must exist first (DP-29).

BLOCKS:
"Blocks enablement (once any commercial object lives)" (register).

AFFECTED PRODUCTS:
All seven once commercial objects post.

AFFECTED FLOWS:
All future fee/commission/reward journal families (none exist); reversal/correction journals of
existing principal legs (existing machinery).

IMPLEMENTATION IMPACT:
(a): composition of mirror legs per family + operator workflow; tests re-proving linkage/idempotency.
(b): compensating-leg composition conventions + reporting reconciliations for unlinked corrections.
Either: snapshot immutability is binding (trigger-enforced; no snapshot row ever updates).

SOURCE REFERENCES:
P-DEC-01 §8 D-GL-006 (evidence: "Reversal/correction runbook requirements"), §10.9 D-V-005;
pack DP-14; reversal machinery (`reversal_of_journal_id`).

DECISION OWNER:
Finance+Operations (D-GL-006); Finance (D-V-005).

---

### DP-15 — Posting-failure semantics (D-GL-009 — decision recorded but posting failed)

CURRENT REPOSITORY POSITION:
Current verified posture = option (a): the whole flow fails atomically and NO snapshot is recorded
(snapshot on success path only — IMPLEMENTATION-01 fee-runtime test 10, IMPLEMENTATION-02
runtime-wiring tests 15/21 prove zero residue). In the zero-charge reality the asymmetry (decision
recorded, posting failed) can only exist in theory.

QUESTION:
(verbatim) "(a) whole flow fails atomically and no snapshot is recorded (current verified posture
for the 0-charge reality); (b) snapshot recorded with explicit failure status (schema change +
policy on evidence-of-failure)".

OPTIONS:
(a) as quoted; (b) as quoted.

OPTION CONSEQUENCES:
- (a): ledger stays true; the decision trail is silent on failed charges; reconciliation sees no
  break because no record exists (DP-18's state remains impossible-by-construction); audit trail
  has a gap for failed charge attempts.
- (b): failure becomes representable/queryable (PENDING exists in the `CommercialDecisionStatus`
  vocabulary but is unused by flows); requires a schema change + an evidence-of-failure policy +
  reconciliation rules that treat failed/PENDING records specially (DP-16/DP-17 must design for
  the polarity); register: "**must be decided BEFORE charge wiring writes non-zero decisions**".

DEPENDENCIES:
DP-17/DP-18/DP-19 (their failure polarity depends on this answer); DP-16 (dimensions).

BLOCKS:
"Blocks charge-wiring enablement" (register).

AFFECTED PRODUCTS:
All seven.

AFFECTED FLOWS:
Failure paths of every flow journal + snapshot write; reconciliation break detection.

IMPLEMENTATION IMPACT:
(a): none — posture already implemented/verified. (b): snapshot schema extension (a migration
beyond the current 76), new status semantics, evidence policy, reconciliation rules.

SOURCE REFERENCES:
P-DEC-01 §8 D-GL-009 (evidence: "Failure-semantics requirement agreed by audit/reconciliation
owners"); pack DP-15; IMPLEMENTATION-01/-02 verification reports.

DECISION OWNER:
Finance+Product.

---

# D. COMMERCIAL RECONCILIATION (DP-16 … DP-19)

### DP-16 — Reconciliation expectations for commercial objects (D-GL-010)

CURRENT REPOSITORY POSITION:
"fee/commission/reward rows absent today; reconciliation monitors ledger/wallet/transfer/pool
planes (audit J-surface)". An external reconciliation service exists (repeatable-read, read-only
over ledger/ops planes).

QUESTION:
(verbatim) "what dimensions must break-monitor when commercial objects start posting
(per-product revenue accounts, payable ledgers, payable-vs-posted differentials)".

OPTIONS:
The documented dimension set (selection/combination undecided): per-product revenue accounts /
payable ledgers / payable-vs-posted differentials.

OPTION CONSEQUENCES:
- Per-product revenue accounts: monitor each provisioned revenue account against its composition
  obligations (only meaningful if DP-01(a) granularity exists).
- Payable ledgers: standing balance/tolerance monitoring for the commission-payable family (only
  meaningful under DP-05(a) or DP-07-accrual).
- Payable-vs-posted differentials: compare accrued-to-recognize vs actually-posted legs (weakens
  to near-zero by construction under DP-05(b)).
Every selected dimension = a query + tolerance + runbook entry (feeds ops runbooks, non-code).

DEPENDENCIES:
Register: "Follows D-GL-001/004/005" — i.e., DP-01, DP-05 (and the reward decision D-GL-005,
outside the 32); DP-17 builds on it; DP-18/DP-19 recovery surfaces tie to its break types.

BLOCKS:
"Blocks enablement (design), non-blocking for configuration" (register).

AFFECTED PRODUCTS:
All fee/commission-bearing products; pool planes unchanged meanwhile.

AFFECTED FLOWS:
Reconciliation queries over the new families; ops break-handling.

IMPLEMENTATION IMPACT:
Reconciliation queries/views + tolerance config + runbooks (the reconciliation service is
read-only today; new dimensions extend its query surface, not the ledger).

SOURCE REFERENCES:
P-DEC-01 §8 D-GL-010 (evidence: "Operations reporting/break-tolerance requirements"); pack DP-16;
audit J-surface.

DECISION OWNER:
Finance(+Operations).

---

### DP-17 — Decision-record ↔ journal reconciliation model

CURRENT REPOSITORY POSITION:
Each snapshot carries `journalId`, `idempotencyKey`, `requestHash`, ruleRefs (rule id+version) per
decision; the snapshot entity contract (line 5): "Historical evidence only: NEVER an authority for
usage counters, balances or ledger state." Ledger/journal truth reigns for money; snapshot truth
reigns for the decision evidence; today both planes are written in THE SAME transaction (drift
impossible by construction).

QUESTION:
Once commercial legs post: which record reconciles against which (snapshot-vs-journal at the same
`journalId`? a fee decision's `feeMinor` vs the sum of fee legs? allocation sums vs commission
legs?), and who owns break resolution?

OPTIONS:
None enumerated in the registers — registered only as D-GL-010's dimensions question plus the
standing evidence-only entity contract. The candidate comparisons above are *derived* from the
evidence fields that already exist (explicitly derived, not a register option row).

OPTION CONSEQUENCES:
Each candidate comparison defines a different break taxonomy and tells break-resolution ownership
where drift is even possible (today: nowhere; after decoupling or DP-15(b): the failure paths).

DEPENDENCIES:
DP-16 (dimensions); DP-15 (defines the failure polarity); DP-18/DP-19 (recovery semantics
presuppose a comparison model).

BLOCKS:
Reconciliation implementation over commercial objects (inherits DP-16's enablement-design gate).

AFFECTED PRODUCTS:
All products that post commercial legs.

AFFECTED FLOWS:
All future commercial journal families ↔ snapshot rows.

IMPLEMENTATION IMPACT:
Reconciliation comparison queries keyed on existing linkage fields (`journalId`, `requestHash`,
ruleRefs); no ledger change; break-resolution ownership is an ops/runbook artifact.

SOURCE REFERENCES:
Pack DP-17; P-DEC-01 §8 D-GL-010; snapshot entity contract; IMPLEMENTATION-01/02 linkage fields.

DECISION OWNER:
OWNER NOT SPECIFIED.

---

### DP-18 — Commercial evidence exists but financial posting fails

CURRENT REPOSITORY POSITION:
Cannot occur today: decision and journal are atomic in one SERIALIZABLE transaction; verified
rollback tests show "downstream failure rolls back snapshot + computed fee decision + journal
atomically" (IMPLEMENTATION-01).

QUESTION:
If architectures decouple (or DP-15 selects (b)): what is the break type, the detection dimension,
and the recovery action when a decision record exists with no legs?

OPTIONS:
The same (a)/(b) fork as DP-15: under (a) this state is impossible-by-construction (by design);
under (b) it becomes representable and then NEEDS detection + recovery policy. No further option
enumeration exists.

OPTION CONSEQUENCES:
- Under (a): nothing to detect or recover; the reconciliation surface stays clean of this break
  class permanently — but the audit trail keeps its failed-charge silence (DP-15(a) consequence).
- Under (b): a new break type ("evidence-without-legs") with a detection dimension (PENDING/failed
  rows aging) and a recovery action policy (manual correction via DP-11/DP-14, or voiding the
  evidence) — none of which is designed today.

DEPENDENCIES:
DP-15 (defines the polarity); DP-17 (comparison model); DP-11/DP-14 (correction paths).

BLOCKS:
Inherits DP-15's gate (pre-charge-wiring).

AFFECTED PRODUCTS:
All seven.

AFFECTED FLOWS:
Failure/correction paths only; reconciliation monitors.

IMPLEMENTATION IMPACT:
None under (a); under (b): failure-status schema + monitors + runbook recovery actions.

SOURCE REFERENCES:
Pack DP-18; P-DEC-01 §8 D-GL-009; IMPLEMENTATION-01 rollback verification.

DECISION OWNER:
Finance+Product (via D-GL-009).

---

### DP-19 — Financial posting succeeds but commercial evidence is incomplete

CURRENT REPOSITORY POSITION:
The converse polarity of DP-18: also impossible under the current atomic spine (both or neither);
the snapshot write precedes commit within the flow transaction; a PENDING status never passes the
service today. Reported in the pack as a **gap in the registers** (the D-GL register handles
decision-present-no-posting but not posting-present-no-evidence for commercial legs).

QUESTION:
If posting could succeed with missing/partial decision evidence (service downgrade, manual ops
journal, future decoupled paths): what evidence-recovery (snapshot supersedes?) and what interim
accounting classification holds the unattributed money?

OPTIONS:
**None exist anywhere.** This is a register gap; resolution requires a human to amend the
register (add the row) before this question has any documented option space at all.

OPTION CONSEQUENCES:
None documentable — the consequence of the gap itself is: manual/ops journal channels (if ever
used) create money movement without decision evidence, and no in-repo policy says how to recover
or classify such a state.

DEPENDENCIES:
DP-11 (operational correction surface); DP-16 (monitors that would notice); DP-15 (overall failure
posture). Any future manual/ops-journal channel implicitly depends on this gap being closed.

BLOCKS:
Enablement-design only; currently theoretical (inherits DP-16/DP-15).

AFFECTED PRODUCTS:
All seven (via ops/manual journals if ever used).

AFFECTED FLOWS:
Manual/other journal paths (none sanctioned today).

IMPLEMENTATION IMPACT:
None today; closing the gap is documentation-first (register amendment), then monitors/runbooks.

SOURCE REFERENCES:
Pack DP-19 (gap report); P-DEC-01 §8 D-GL register (absence of the converse row).

DECISION OWNER:
OWNER NOT SPECIFIED.

---

# E. PLATFORM REVENUE (DP-20 … DP-24)

### DP-20 — PLATFORM_REVENUE_ALLOCATION activation (D-C-010)

CURRENT REPOSITORY POSITION:
`src/capability-registry/capability.seed.ts:2187-2210`: description "**Platform revenue = fee −
commission − reward**"; lifecycle/backendStatus PLANNED; enabled **false**; NOT_CONFIGURED;
dependencies `['COMMISSION_ENGINE','FEE_ENGINE']`; **`implementationReferences: []`,
`migrationReferences: []`, `testReferences: []`** — no engine exists; blockerType PRODUCT_DECISION;
blockerDescription "Requires revenue allocation decision"; notes: "...the registry supports
PLATFORM-recipient rules (V1-COMMISSION-01) but no revenue engine exists and revenue stays null in
V1 snapshots."

QUESTION:
Does V1 compute/record a platform-revenue allocation at all; and if so is it a *recorded*
allocation (explicit PLATFORM recipient rows) or *retained-by-omission* (no row)?

OPTIONS:
D-C-010 (register): "PLATFORM row as explicit allocation vs revenue-retained-by-omission (no row)".

OPTION CONSEQUENCES:
- Explicit PLATFORM row: needs an account destination (DP-05 fork governs it), plus a revenue
  engine (capability refs are all empty — a build), plus allocation rows in decisions; revenue-side
  statements get explicit platform-share lines.
- Retained-by-omission: no rows; the platform share stays implicit inside fee revenue; reporting
  is derived; the PLATFORM recipient vocabulary remains dormant (nothing consumes it at runtime —
  deliberate).

DEPENDENCIES:
Fee + commission posting families precede any arithmetic with legs (DP-01…DP-09 cluster);
DP-22 (population of `revenue_decision` presupposes this); DP-23 (timing); DP-24 (presentation);
D-C-010 is CONFIG before any PLATFORM-recipient rule row; the explicit branch implies DP-05's
PLATFORM mapping (D-C-002's "PLATFORM ⇒ D-GL-004").

BLOCKS:
Any production rule row with PLATFORM recipient (CONFIG); capability activation; revenue-engine build.

AFFECTED PRODUCTS:
All commission/fee-bearing products.

AFFECTED FLOWS:
Revenue-side journals once provisioned; decision records (allocation rows vs none).

IMPLEMENTATION IMPACT:
Explicit: engine build (capability has zero implementation references) + destination account +
composer legs. Omission: none (status quo machinery).

SOURCE REFERENCES:
P-DEC-01 §10.4 D-C-010/D-C-002; `src/capability-registry/capability.seed.ts:2187-2210`; pack DP-20.

DECISION OWNER:
Product+Finance.

---

### DP-21 — Meaning/treatment of "revenue = fee − commission − reward"

CURRENT REPOSITORY POSITION:
The formula exists ONLY as a capability **description string** (DP-20 source). No code computes
it; B2F03 line 337 prohibits deriving debit/credit roles from decision kinds; DP-05(c) leaves
presentation open; contradiction C-5 records the trap.

QUESTION:
Is the formula a statement-line identity (reporting), a ledger posting identity (net legs), or an
aspiration decomposing into separate fee-revenue/expense/reward lines via DP-05 and D-GL-005?

OPTIONS:
None enumerated anywhere. The three outcomes above are *reachable* only through DP-05/D-GL-005
choices (derived, not register option rows).

OPTION CONSEQUENCES:
- Statement identity: no posting change; reporting subtraction; fee/commission/reward families
  stay gross.
- Ledger identity: net legs (effectively DP-05(c)-class presentation with the contra-capability
  dependency — not creatable today).
- Decomposed aspiration: whatever DP-05/D-GL-005 select; the formula is then a comment, not a rule.

DEPENDENCIES:
DP-05; D-GL-005 (reward, outside the 32); DP-24; C-5 resolution posture (do not read the string
as a decision).

BLOCKS:
ENABLE (statement shape follows the treatment decisions).

AFFECTED PRODUCTS:
All products that post commercial objects.

AFFECTED FLOWS:
Revenue + expense families; statement views.

IMPLEMENTATION IMPACT:
None independently; entirely inherited from the governing fork choices.

SOURCE REFERENCES:
Pack DP-21; `capability.seed.ts:2187` description; B2F03 line 337; DP-05/D-GL-004 options.

DECISION OWNER:
OWNER NOT SPECIFIED.

---

### DP-22 — Whether `revenue_decision` becomes authoritative

CURRENT REPOSITORY POSITION:
Snapshot column `revenue_decision` JSONB nullable with validated vocabulary NONE|RETAINED
(`assertDecisionObject… REVENUE_STATUSES`); **every flow writes `null`** today; the parent entity
contract (line 5): "Historical evidence only: NEVER an authority for usage counters, balances or
ledger state." Service validation admits the values; no engine produces them.

QUESTION:
Should `revenue_decision` (status/retainedMinor) ever be populated, and if so can it be treated as
authoritative (a recognition input) — or does the standing evidence-only contract continue to bind
it?

OPTIONS:
None enumerated in any register. The standing contract currently rules OUT authority; changing the
contract is itself unregistered (would need a new register row amending snapshot semantics).

OPTION CONSEQUENCES:
- Populate-as-evidence: data exists for analysis, contract unchanged; zero authority implications.
- Populate-as-authority: presupposes DP-20's engine + a retention account mapping + a formal
  contract amendment; without the amendment, ANY authority use contradicts the entity contract
  directly (a new C-class contradiction by construction).

DEPENDENCIES:
DP-20 (engine existence); DP-23 (timing semantics); the snapshot-semantics contract
(unregistered amendment path).

BLOCKS:
Enablement-design only, non-blocking today.

AFFECTED PRODUCTS:
All seven.

AFFECTED FLOWS:
None mechanical (a JSONB column); semantics/reconciliation if populated.

IMPLEMENTATION IMPACT:
Population is engine output (future build); authority is documentation/contract work first.

SOURCE REFERENCES:
Snapshot entity line 5 + service validation; pack DP-22; capability notes ("revenue stays null in
V1 snapshots").

DECISION OWNER:
OWNER NOT SPECIFIED.

---

### DP-23 — Timing of revenue allocation

CURRENT REPOSITORY POSITION:
No allocation exists; DP-02 is the only adjacent timing decision; snapshots carry
`decidedAt/finalizedAt` stamps; B2F03 §17: "B2F03 does not implement year-end close or equity
posting" (all equity roles `UNMAPPED`).

QUESTION:
At transaction completion per-transaction, or at period aggregation (statement/close)?

OPTIONS:
None enumerated; inherits DP-02's options by analogy (at completion vs deferred) — derived, not
registered. Close mechanics do not exist (B2F03 §17).

OPTION CONSEQUENCES:
- Per-transaction: allocation evidence appears inside per-event decision records (presupposes
  DP-20 engine at event time); statements aggregate post-hoc.
- Period aggregation: matches "at close" thinking but there is NO close machinery in scope; would
  require new periodic execution (same class of new dependency as DP-02(b)).

DEPENDENCIES:
DP-02 (recognition timing); DP-20 (engine).

BLOCKS:
Enablement-design.

AFFECTED PRODUCTS:
All posting products.

AFFECTED FLOWS:
Revenue-side decision records/statements (mechanically nothing today).

IMPLEMENTATION IMPACT:
None separate from DP-20/DP-02; period variation adds periodic execution design (new).

SOURCE REFERENCES:
Pack DP-23; B2F03 §17; P-DEC-01 §8 D-GL-003.

DECISION OWNER:
OWNER NOT SPECIFIED.

---

### DP-24 — Fee revenue ↔ agent commission presentation relationship

CURRENT REPOSITORY POSITION:
Code records fee and commission decisions **independently** (commission.types.ts:17-19); the
economic/statement relationship is future presentation policy only.

QUESTION:
Statement relationship: gross (fee revenue + commission expense separately) vs netted (fee −
commission as revenue) vs contra — distinguished from DP-05: DP-05 picks journal *mechanics*;
this picks the *reported relationship*.

OPTIONS:
Not enumerated independently; reachable only via DP-05's three options (derived).

OPTION CONSEQUENCES:
- Gross: both families visible; no posting constraint beyond DP-05(a/b).
- Netted/contra: statement collapse of fee and commission; mechanically requires the (c) fork's
  contra capability for ledger-native netting — not creatable today (DP-05 consequences).

DEPENDENCIES:
DP-05; DP-09 (journal-level relationship).

BLOCKS:
ENABLE (statements do not block configuration).

AFFECTED PRODUCTS:
All posting products.

AFFECTED FLOWS:
Statement/reporting views over revenue/expense ledgers.

IMPLEMENTATION IMPACT:
Reporting-layer only under gross; ledger-capability dependency under netted/contra.

SOURCE REFERENCES:
Pack DP-24; commission.types.ts:17-19; B2F03 §18/line 337.

DECISION OWNER:
OWNER NOT SPECIFIED.

---

# F. AGGREGATORS (DP-25 … DP-28)

### DP-25 — Aggregator participation (D-C-009)

CURRENT REPOSITORY POSITION:
Verbatim: "(register #9) | (a) no aggregator commission in V1; (b) yes ⇒ §9-D4 account design
mandatory | structural: aggregator has no ledger identity today". Aggregator entities exist
(corporate identity, relationships, funding-attribution routes); the runtime NEVER supplies
`aggregatorId` context (IMPLEMENTATION-02, deliberate), so aggregator-targeted rules can never
match today.

QUESTION:
Do aggregators participate in V1 commission at all?

OPTIONS:
(a) no aggregator commission in V1; (b) yes ⇒ §9-D4 account design mandatory.

OPTION CONSEQUENCES:
- (a): AGGREGATOR recipient vocabulary stays dormant; aggregator-related routes remain
  attribution-only; the entire DP-26/27/28 chain stays closed; zero build.
- (b): activates §9-D4 design (DP-26), ledger-identity decision (DP-27), settlement timing
  (DP-28), runtime context supply (aggregatorId into flow context — code change), and external
  evidence (commercial agreements — outside the repository).

DEPENDENCIES:
Gates DP-26/DP-27/DP-28; D-C-002 recipient types reference it (AGGREGATOR ⇒ §9-D4).

BLOCKS:
CONFIG before any aggregator rule row ("if aggregator participates").

AFFECTED PRODUCTS:
Any commission-paying product with aggregator-linked agents (D-C-001 YES-set).

AFFECTED FLOWS:
Would add aggregator legs to commission journals; today none possible.

IMPLEMENTATION IMPACT:
(a): none. (b): context propagation into snapshotted flows (code), rule vocabulary activation,
plus the whole F-cluster design chain.

SOURCE REFERENCES:
P-DEC-01 §10.4 D-C-009 (evidence: "Aggregator commercial agreements"); D-C-002; IMPLEMENTATION-02
(deliberate absence of aggregatorId); pack DP-25.

DECISION OWNER:
Product+Finance.

---

### DP-26 — Aggregator crediting design (§9-D4)

CURRENT REPOSITORY POSITION:
Verbatim §9-D4: "**Aggregator crediting design** (account destination or off-ledger accrual) |
D-C-009 | ONLY if aggregator participates; today aggregators have no ledger identity".

QUESTION:
If YES at DP-25: provision per-aggregator payable-like ledger accounts (legs at allocation time),
or keep aggregator shares as off-ledger accrual evidence inside snapshots until a V2 payout rail
credits them?

OPTIONS:
(a) ledger-account identity per aggregator; (b) off-ledger accrual evidence, crediting deferred to
V2 payout rail.

OPTION CONSEQUENCES:
- (a): legs post at allocation time (audit-grade duty-to-pay); requires §9-D3-family provisioning
  per aggregator + DP-16 reconciliation dimensions + the DP-31 governance evidence for each
  account; ongoing account-creation per aggregator onboarding.
- (b): snapshot evidence only; no ledger duty-to-pay; crediting waits on the V2 payout rail (not
  in this repository); "evidence, not duty-to-pay" traceability profile (pack).

DEPENDENCIES:
Gated by DP-25; feeds DP-28; (a) presupposes DP-29/DP-31 provisioning answers.

BLOCKS:
Any aggregator commission posting (conditional implementation dependency).

AFFECTED PRODUCTS:
Aggregator-involving commission products.

AFFECTED FLOWS:
Would-be aggregator credit legs at allocation time (a), or evidence-only allocations (b).

IMPLEMENTATION IMPACT:
(a): account family + per-aggregator provisioning + composer legs. (b): none now (evidence already
captures allocations); payout is V2 work outside this repo.

SOURCE REFERENCES:
P-DEC-01 §9-D4; pack DP-26; implementation audit architecture note.

DECISION OWNER:
OWNER NOT SPECIFIED (dependency descriptor; gate owner is D-C-009's Product+Finance).

---

### DP-27 — Aggregator ledger identity

CURRENT REPOSITORY POSITION (entity contract, verbatim `src/aggregator/aggregator.entity.ts:23-27`):
"Aggregator has NO wallet, NO ledger balance, NO funding. It is a corporate identity... ownership/
accounting explicitly; A18 does not invent a ledger account."

QUESTION:
What ledger identity (if any) represents an aggregator receivable/payable position — and does
anything at all change on the entity before such identity may be created?

OPTIONS:
Same fork as DP-26 ((a)/(b)); the entity contract currently forbids inventing identity — any
ledger identity would be a new, separately approved decision (no option row beyond that
constraint exists).

OPTION CONSEQUENCES:
- (a): entity assumption set changes (identity becomes balance-bearing per provisioned accounts —
  an entity/contract amendment plus provisioning).
- (b): entity untouched; identity stays corporate-only; duties live in evidence only.

DEPENDENCIES:
DP-25/DP-26; pool/funding attribution fields stay as they are in either case.

BLOCKS:
Aggregator accounting implementation (conditional).

AFFECTED PRODUCTS:
All agent-funding-via-aggregator operations today (attribution-only).

AFFECTED FLOWS:
Pool↔agent wallet journals (unchanged today, either way); would-be aggregator accounts (a).

IMPLEMENTATION IMPACT:
(a): entity-contract amendment + provisioning machinery (DP-31). (b): none.

SOURCE REFERENCES:
Pack DP-27; `src/aggregator/aggregator.entity.ts:23-27`; A18 verification.

DECISION OWNER:
OWNER NOT SPECIFIED.

---

### DP-28 — Aggregator commission/settlement: V1 or deferred

CURRENT REPOSITORY POSITION:
AGGREGATOR_FUNDING_ARCHITECTURE is V1-facing; EXTERNAL_SETTLEMENT capability is V2/PLANNED; the
audit (§11 rows 17/20) marks accrued-then-settled rails as V2 scope ("settlement rail = D-C-014;
payout execution is V2 per A18 boundary").

QUESTION:
If DP-25 = YES: is any aggregator settlement in V1 at all — or definitively deferred to V2 with
only accrual evidence (DP-26(b)) or standing liabilities (DP-26(a)) recorded?

OPTIONS:
V1 settlement / defer-to-V2 (the register offers D-C-014's rail options; the audit marks payout
execution V2 — derived pair, no dedicated option row).

OPTION CONSEQUENCES:
- V1 settlement: rails per DP-08 (wallet credit executable; payout rail absent); standing V1
  liabilities then get operationally settled within V1.
- Defer-to-V2: liabilities (a) or evidence (b) stand in V1 awaiting V2 machinery; operator/reporting
  load over the standing period; note the pack's warning: "V2-parked ≠ impossible to owe in V1".

DEPENDENCIES:
DP-25/26/27; DP-08 (rail options).

BLOCKS:
Aggregator settlement build (conditional; CONFIG-lane gate via D-C-009).

AFFECTED PRODUCTS:
As DP-26.

AFFECTED FLOWS:
Settlement journals (V1) or standing balances/evidence (V2-deferred).

IMPLEMENTATION IMPACT:
V1: settlement composer using DP-08 rails. Defer: none in V1 (statement/aging views only).

SOURCE REFERENCES:
Pack DP-28; audit §11 rows 17/20; EXTERNAL_SETTLEMENT capability; D-C-014.

DECISION OWNER:
OWNER NOT SPECIFIED (parent gate: Product+Finance via D-C-009).

---

# G. ACCOUNT PROVISIONING (DP-29 … DP-32)

### DP-29 — Commercial account-family provisioning model (§9-D3)

CURRENT REPOSITORY POSITION:
§9-D3 verbatim: "**Commercial account families in the ledger** (fee-revenue, VAT-payable,
commission expense/payable, reward liability/expense) | D-GL-001/002/004/005 | Provisioning task
following AR-control pattern; no codes invented here; structural prerequisite for ANY commercial
posting".

QUESTION:
Through which APPROVED mechanism are these families defined, approved, provisioned, and evidenced
(codes, type, normal balance, allow-negative, accounting-unit, granularity from DP-01, effective
dates)?

OPTIONS:
The single documented pattern: "Provisioning task following AR-control pattern" — an authorized
definition with privileged-action approval + finance-control verification + audit (the
`ar-control-account-provisioning.service.ts` shape), feeding from B2F03's mapping concept
(`FinanceA5AccountMappingV1`, immutable, effective-dated, evidence-carrying). Any *other*
mechanism has no documented option row — which is precisely contradiction C-3 (DP-30).

OPTION CONSEQUENCES:
- AR-pattern generalized: per-family governed provisioning with approval evidence; requires the
  DP-31 machinery (authorized-definition registry) because today's provisioner authorizes exactly
  one definition.
- Migration-seeded (precedent only — the migration-set): matches history but contradicts the
  M-10/§14 forward pattern (C-3); would add migrations and bypass the privileged-evidence path
  unless separately documented.

DEPENDENCIES:
Needs DP-01 (family shape), DP-03 (whether tax family), DP-05 (whether commission families),
D-GL-005 (reward — outside the 32); DP-30 (mechanism dispute) and DP-31 (evidence model) precede
acceptance; §9-D6 pilots consume it.

BLOCKS:
"Structural prerequisite for ANY commercial posting" (§9-D3) — every posting area waits on it.

AFFECTED PRODUCTS:
All products that will post commercial legs.

AFFECTED FLOWS:
`ledger_accounts` content only (no runtime code touching flow paths); tests (composed legs
balanced; account lookup fail-closed — implementation audit §14).

IMPLEMENTATION IMPACT:
Provisions rows in `ledger_accounts` (no schema change for REVENUE/EXPENSE types); codes from a
Finance chart decision (none invented); governance machinery per DP-31; NO reuse of
settlement/clearing/suspense/wallet accounts (A5 contract line 143 forbids repurposing).

SOURCE REFERENCES:
P-DEC-01 §9-D3; pack DP-29; A5 contract line 143; B2F mapping concept; implementation audit §14.

DECISION OWNER:
OWNER NOT SPECIFIED (families' owners: Finance via D-GL rows).

---

### DP-30 — Provisioning mechanism: accounts-admin surface vs migration-seeded precedent (contradiction C-3)

CURRENT REPOSITORY POSITION:
Implementation audit §14/M-10: "chart-of-accounts provisioning is a **data task executed through
the existing accounts-admin surface following the PAYMENT-SETTLEMENT precedent (no schema
migration; see M-10)**". But the five current control accounts were seeded by **migrations**
(`1785753600002`, `…00057`, `…00061`), the live privileged provisioner authorizes **exactly one**
fixed definition (`FINANCE-ACCOUNTS_RECEIVABLE-NGN`), and the generic
`POST /ledger/accounts → createAccount` path carries none of the AR path's governance evidence.
Migration count today: 76.

QUESTION:
Which is authoritative for the commercial families: the forward pattern (data-only provisioning
via an approved admin/provisioner surface) or the historical pattern (migrations seeding
accounts)?

OPTIONS:
None enumerated — the two statements disagree in *mechanism*. This is contradiction C-3: reported
for explicit resolution, not silent reconciliation.

OPTION CONSEQUENCES:
- Forward pattern: zero migrations; but requires NEW governed provisioner code beyond the
  single-definition AR control (DP-31) before it is executable at the AR path's evidence grade.
- Migration precedent: matches all history (76 migrations); violates M-10's own policy statement;
  seeds accounts without the privileged-action/verification/audit envelope unless one is defined
  for the migration content.

DEPENDENCIES:
DP-29 (acceptance criteria), DP-31 (evidence model), DP-32 (lifecycle) all queue behind this
mechanism answer.

BLOCKS:
Enablement-design contradiction — the §9-D3 acceptance criteria wording cannot be locked until
resolved.

AFFECTED PRODUCTS:
All posting products.

AFFECTED FLOWS:
`ledger_accounts` content; migration count (76); operations/audit trails.

IMPLEMENTATION IMPACT:
Forward: provisioner/service code. Precedent: migration(s) + a documented governance note.

SOURCE REFERENCES:
Implementation audit §14/M-10; migrations `1785753600002/…057/…061`;
`src/ledger/ar-control-account-provisioning.service.ts` (single authorized definition); C-3.

DECISION OWNER:
OWNER NOT SPECIFIED.

---

### DP-31 — Approval/governance evidence for accounting-family provisioning

CURRENT REPOSITORY POSITION:
`A5ArControlAccountProvisioningService` = privileged-action approval + B2F finance-control
verification + audit + idempotency, FOR EXACTLY ONE hardcoded definition; the generic
`POST /ledger/accounts → createAccount` carries none of that evidence; B2F03's
`FinanceA5AccountMappingV1` describes an approval-evidenced mapping *record* (not an implementation).

QUESTION:
What constitutes governance-grade provisioning evidence for a commercial family (approval
reference, actor, contract version, finance-control verification) — a new authorized-definition
registry (AR-pattern generalized), or documented manual provisioning under a new runbook?

OPTIONS:
None enumerated; the AR contract is the only living template in the repository. The two shapes
above are derived from that template vs the plain-admin path (derived, not register option rows).

OPTION CONSEQUENCES:
- Registry path: code (definition registry + generalized provisioner) + approval-evidence
  persistence per family; evidence grade matches the AR control.
- Runbook path: no code; evidence lives in operational records; audit trail depends on runbook
  discipline rather than enforced schema.

DEPENDENCIES:
Blocks DP-29 acceptance; DP-32 auditability depends on it; DP-30's forward-pattern branch
presupposes it.

BLOCKS:
Enablement-design (provisioning cannot be "approved-evidenced" without this answer).

AFFECTED PRODUCTS / FLOWS:
`ledger_accounts` content; operations/audit trails; all posting products transitively.

IMPLEMENTATION IMPACT:
Registry: new service code. Runbook: documentation + optional audit fields later.

SOURCE REFERENCES:
Pack DP-31; A5 contract; `ar-control-account-provisioning.service.ts`; B2F mapping concept.

DECISION OWNER:
OWNER NOT SPECIFIED.

---

### DP-32 — Account-family lifecycle (stewardship)

CURRENT REPOSITORY POSITION:
`LedgerAccount` has `isActive` + timestamps; no effective-dating/versioning/stewardship fields;
B2F03's mapping concept carries effective intervals (`FinanceA5AccountMappingV1`) but is not
implemented for commercial roles (all `UNMAPPED`); no chart-governance document for V1 chart
changes (M4-FINANCE-VERIFICATION.md contains no revenue/expense statements).

QUESTION:
What lifecycle governs a family: creation approval → effective interval → composition change →
deactivation → reporting continuity? Who owns the V1 chart (stewardship)?

OPTIONS:
None enumerated; B2F03's mapping-record vocabulary (immutable, effective-dated, evidence-carrying)
supplies the only documented shape (derived, not a register option row).

OPTION CONSEQUENCES:
Under any lifecycle answer: account rows are insert-only in practice (historic legs reference
account ids), so "change" = new effective-dated mapping/account rather than in-place edits —
matching append-only precedent of the migrations family.

DEPENDENCIES:
DP-29/DP-31 (provisioning + evidence predate lifecycle rules); DP-16 (reconciliation across
family changes).

BLOCKS:
Enablement-design (lifecycle part of the provisioning acceptance).

AFFECTED PRODUCTS:
All posting products.

AFFECTED FLOWS:
`ledger_accounts` lifecycle events; reporting continuity across changes.

IMPLEMENTATION IMPACT:
Documentation-first; optional fields/effective-dating machinery later (new schema if persisted).

SOURCE REFERENCES:
Pack DP-32; B2F mapping concept; `LedgerAccount` entity; M4-FINANCE-VERIFICATION.md (absence of
commercial statements).

DECISION OWNER:
OWNER NOT SPECIFIED.

---

# SPECIAL FOCUS — D-GL-004 (DP-05): Detailed Comparison of the Documented Fork

Three documented options only: **A. EXPENSE + PAYABLE** · **B. IMMEDIATE AGENT-WALLET NETTING** ·
**C. PLATFORM CONTRA-REVENUE**. No selection is made. All content traces to: D-GL-004 register row;
B2F03 §13/§18 + line 337; §9-D3/§9-D4; D-C-014/D-C-015; D-V-003; D-GL-010; agent WALLET-*
existence; `createAccount` normal-balance enforcement.

| Dimension | A. EXPENSE + PAYABLE | B. IMMEDIATE WALLET NETTING | C. PLATFORM CONTRA-REVENUE |
|---|---|---|---|
| **Economic representation** | Commission = cost of revenue; a duty-to-pay stands until settled (third-party liability on the books) | Commission = immediate reduction→agent-liability transfer at transaction event; no standing duty | Commission = reduction of platform revenue, not a cost line (net-revenue economics) |
| **Required ledger accounts** | TWO new families: commission-expense (EXPENSE, DR-normal) + commission-payable (LIABILITY, CR-normal) — both `UNMAPPED` today | ONE new family minimum if gross books are kept: commission-expense (EXPENSE); agent wallet accounts exist; PLUS fee-revenue family implied for sources · If presented net, interacts with C | Revenue-side contra presentation: needs commission-contra of fee revenue, i.e., an EXPENSE-typed opposite-balance account **or** a contra-capable revenue account — **not creatable** under current `createAccount` (normal-balance enforcement; B2F03 §18) |
| **Timing** | Recognition at the transaction event (accrual); settlement later per D-C-015/D-C-014 | Recognition AND disposition at the transaction event (one journal) | Recognition at the transaction event as a negative revenue leg |
| **Effect on Agent wallet** | None at recognition; wallet CR only at settlement execution (DP-08 rail) | Wallet CREDITED at the transaction event — the amount becomes the agent's money immediately | None at recognition (platform-side only); agent settlement must still be designed separately (this option alone does not pay the agent) |
| **Effect on fee revenue** | Gross CR; fee revenue unaffected by commission | Gross CR (fee family still required for FEE-basis legs; audit §14) | Fee revenue reduced by the commission share (net lines) |
| **Effect on platform revenue** | Platform revenue = reporting subtraction (fee − expense − reward) — statement identity | Same as A at statement level; journals show gross fee + expense | Platform revenue is the POSTED residual (ledger-level netting — the capability description's arithmetic becomes literal) |
| **Reversal implications (D-V-003)** | Payable extinguished without touching the wallet; clawback = intra-ledger payable removal | Clawback requires a NEW operator-approved debit of the agent's WALLET-* (policy + code path; DP-11) — the money is already the agent's | Reversal of the contra leg restores revenue; agent-side payment design still must answer D-V-003 separately |
| **Reconciliation implications (D-GL-010)** | Payable ledger monitoring + payable-vs-posted differentials + aging | Differential collapses toward zero by construction; monitors focus on wallet-credit accuracy vs decision sums | Revenue-family monitors; net-vs-gross statement bridge reporting |
| **Payout implications (D-C-014)** | Settlement machinery mandatory (wallet credit / pool netting / V2 payout rail) | No payout step: disposition already happened; remaining question is withdrawal behavior (outside these flows) | Agent payout still undefined — must pair with D-C-014 anyway |
| **Technical changes required** | 2 families provisioned (DP-29/31/32) + composer legs + settlement execution + aging + monitors | 1 family + composer legs + operator clawback workflow + wallet-credit accuracy monitors | Ledger-capability change (contra accounts) requiring a separately approved A5-compatible design BEFORE any account exists; then composer legs |
| **Dependencies** | §9-D3 provisioning; D-C-015 timing; D-C-014 rail; D-GL-010 monitors; D-V-003 reversal | Agent wallet accounts (exist); D-C-015 (immediate presupposed); D-V-003 as clawback policy; fee family for gross-up | A5-compatible contra design approval (new); B2F03 §18 review outcome; then the same §9-D3 lane |

Cross-cutting (all three): B2F03 line 337 — "**Automatic role selection from the kind alone is
prohibited**": no rule-kind mapping may decide between A/B/C; the FEE-REVENUE family is a
prerequisite whenever the commission basis is FEE (audit §14); reward treatment is out of scope
(D-GL-005 open).

---

# CONTRADICTIONS REQUIRING EXPLICIT RESOLUTION (C-1 … C-5)

Carried from the decision pack, unresolved. Nothing here reconciles them; each needs a named
human action.

### C-1 — Claimant-agent beneficiary vs implemented customer-only engine-free claim
- **Source A:** P-DEC-01 §5.4-E — "commission beneficiary is agent-side by construction
  (**initiator and/or claimant agent** — split policy question feeding D-C-002)".
- **Source B:** `src/agent/agent-cash-to-cash-claim.service.ts` + IMPLEMENTATION-02 — the claim
  path is CUSTOMER-side only and deliberately ENGINE-FREE (no acting agent exists on claim;
  initiation is the single commission event).
- **Exact contradiction:** the register's option space includes a beneficiary actor (claimant
  agent) that the implementation cannot produce at all.
- **Why it matters:** D-C-002 (recipient types per product) and D-C-001 (candidate set) are
  drafted against an actor class that does not exist; choosing it would demand a design that
  contradicts a deliberately-verified engine-free boundary.
- **Affected decisions:** D-C-001/D-C-002 (→ DP-05's affected-product set), DP-06 (C2C timing),
  DP-13 (expiry interplay).
- **Affected implementation:** any future C2C carry/claim-side commercial wiring; commission rule
  vocabulary activation.
- **Human resolution required:** YES — Product (D-C-002 owner) must amend the option space or
  explicitly re-open the engine-free claim design. Not resolved here.

### C-2 — D-V-006 "funds remain in pool" vs CASH_TO_CASH-UNCLAIMED-NGN
- **Source A:** P-DEC-01 §10.9 D-V-006 note — "today's code: EXPIRED posts no journal — **funds
  remain in pool** with transfer status EXPIRED".
- **Source B:** `src/agent/agent-cash-to-cash-expiry.service.ts:24-38` — "The principal remains in
  `CASH_TO_CASH-UNCLAIMED-NGN` liability." (`AGENT_FUNDING_POOL-NGN` is a different account.)
- **Exact contradiction:** the register names the wrong account family for where expired principal
  sits.
- **Why it matters:** refund/escheat/reconciliation designs targeting "the pool" would debit the
  wrong account and misstate both families; D-V-006's own option ("auto-credit initiator
  pool+wallet") credits pool+wallet but the source of funds is the unclaimed liability.
- **Affected decisions:** DP-13 (D-V-006), D-GL-008 pool reconciliation (outside the 32), DP-16
  monitors.
- **Affected implementation:** any EXPIRED-release journal design; reconciliation expectation docs.
- **Human resolution required:** YES — Product+Operations (D-V-006 owner) to correct the register
  narrative before refund design. Not resolved here.

### C-3 — Accounts-admin forward pattern vs migration-seeded provisioning precedent
- **Source A:** implementation audit §14/M-10 — provisioning is a "data task … through the
  existing accounts-admin surface … (no schema migration)".
- **Source B:** migrations `1785753600002/…057/…061` seeded the five current control accounts;
  the privileged provisioner authorizes exactly ONE definition
  (`FINANCE-ACCOUNTS_RECEIVABLE-NGN`); `POST /ledger/accounts` carries no governance envelope.
- **Exact contradiction:** the stated forward mechanism does not exist with the described
  governance; the only executed precedent is migrations.
- **Why it matters:** §9-D3's acceptance ("Provisioning task following AR-control pattern") cannot
  be executed as written until one mechanism is declared authoritative.
- **Affected decisions:** DP-29/DP-30/DP-31/DP-32 (entire provisioning chain); every posting area
  transitively.
- **Affected implementation:** provisioning code path vs migration authoring for all commercial
  families.
- **Human resolution required:** YES — OWNER NOT SPECIFIED; Finance must nominate the mechanism
  (or the register owners must amend M-10/§14). Not resolved here.

### C-4 — P-DEC-01 §2 S4 staleness after Fee/Commission runtime implementation
- **Source A:** P-DEC-01 §2 six-state table + capability rows — S4 wording: commission/fee
  "flow calls: absent by design (today zero rows)"; capability table: "engine … not wired (static
  guard)".
- **Source B:** V1-COMMERCIAL-IMPLEMENTATION-01/02 verification reports — both engines ARE
  runtime-invoked in-flow (evidence-only; charge/posting absent).
- **Exact contradiction:** none in policy — a **temporal staleness**: the S4 column's description
  predates the runtime wiring; the S5/S6 verdicts and every decision row remain current.
- **Why it matters:** readers using the S4 wording to justify "engines are not invoked" would
  mis-state today's architecture; decision sequencing that assumes no in-flow evaluation is
  already outdated (evidence plane is live).
- **Affected decisions:** none directly (documented as staleness, H-02A/H-03 pattern);
  communication-blocking in reviews that quote §2 verbatim.
- **Affected implementation:** none (implementation is the newer truth here).
- **Human resolution required:** YES — documentation owner to re-date/annotate §2 (the decision
  pack already carries the note; the register itself is untouched). Not resolved here.

### C-5 — PLATFORM_REVENUE_ALLOCATION arithmetic vs open presentation + role-selection prohibition
- **Source A:** `src/capability-registry/capability.seed.ts:2187` — description "Platform revenue =
  fee − commission − reward".
- **Source B:** B2F03 line 337 ("**Automatic role selection from the kind alone is prohibited**")
  + open D-GL-004 fork (gross vs contra vs netting unchosen).
- **Exact contradiction:** an aspiration string reads like a decided treatment while the treatment
  fork is provably open and kind-derived role selection is prohibited.
- **Why it matters:** silently collapsing S5 (policy) into S6 (treatment) from a description
  string would bury the single most consequential presentation decision (DP-05/DP-21/DP-24).
- **Affected decisions:** DP-05, DP-20, DP-21, DP-22, DP-23, DP-24.
- **Affected implementation:** revenue-engine build + destination accounts; statement design.
- **Human resolution required:** YES — OWNER NOT SPECIFIED for the formula itself (D-C-010 owner:
  Product+Finance covers the activation gate; the description/treatment mapping needs the same
  humans). Not resolved here.

---

# DEPENDENCY GRAPH

Derived strictly from documented dependencies (register rows, pack cross-references, cited
contracts). "→ implementation step" uses §9/§14 vocabulary only.

| Decision | ← Prerequisite decisions | Decisions unblocked after it | Implementation step unblocked |
|---|---|---|---|
| DP-01 (D-GL-001) | — (register: none) | DP-04, DP-16, DP-23, DP-29 | §9-D3 fee-revenue family provisioning; per-product reporting design |
| DP-02 (D-GL-003) | — | DP-04, DP-23 | §9-D1 fee-leg timing design; (b) adds accrual-machinery design |
| DP-03 (D-F-005+D-GL-002) | D-F-005 before D-GL-002 (register) | DP-04, D-I-002, DP-29 (tax family) | §9-D1 VAT computation build; §9-D3 tax-payable provisioning |
| DP-04 (composition) | DP-01, DP-02, DP-03 + D-F-003/D-F-006 (+§9-D2 if payer≠sender) | DP-15 must precede charge wiring (register) | §9-D1 fee-charging legs + composition tests |
| DP-05 (D-GL-004) | — (co-gated by DP-06/DP-07) | DP-09, DP-12, DP-16, DP-21, DP-24, DP-20(explicit), DP-29 | §9-D3 commission families; settlement journal design |
| DP-06 (timing) | DP-05/DP-07 context (folded into D-C-015) | DP-12 (exposure), DP-16 | recognition-instant implementation choice |
| DP-07 (D-C-015) | — | DP-05 branch feasibility, DP-12, DP-08 need, DP-16 | journal shape (per-tx vs batch) implementation |
| DP-08 (D-C-014) | DP-05(a) or DP-07-accrual presupposed | DP-26/DP-28 analogues | settlement execution (wallet credit); pool-netting design; V2 rail parked |
| DP-09 (fee↔commission) | DP-05 + D-C-003/D-C-016 (CONFIG rows) | DP-21, DP-24 | basis-data availability in charge path (BASE_UNAVAILABLE lift) |
| DP-10 (cross-ref → DP-12) | DP-12 | — | — (see DP-12) |
| DP-11 (D-V-001) | — | DP-12 exec, DP-13(ops), DP-14 exec, DP-19 recovery | ops runbook/approval surface for reversals |
| DP-12 (D-V-003) | DP-07 (exposure), DP-05 (counterparty) | DP-14 specifics | clawback/extinguish code paths (post-DP-11) |
| DP-13 (D-V-006) | C-2 resolution before refund design | DP-12/DP-14 application class | EXPIRED-release journals (auto-credit branch) |
| DP-14 (D-GL-006+D-V-005) | DP-11; families exist first (DP-29); D-V-002/D-V-004 | — | mirror/compensating leg composition per family |
| DP-15 (D-GL-009) | — (register: decide BEFORE charge wiring) | DP-17, DP-18, DP-19 polarity | charge-wiring enablement gate (precondition) |
| DP-16 (D-GL-010) | DP-01, DP-05 (+D-GL-005 outside) | DP-17 | reconciliation dimensions build (queries+tolerances) |
| DP-17 (record↔journal model) | DP-16, DP-15 | DP-18, DP-19 design | comparison queries + break-resolution ownership runbook |
| DP-18 (evidence w/o posting) | DP-15 | — | failure-polarity monitors (only if (b)) |
| DP-19 (posting w/o evidence) | DP-16/DP-15/DP-11 (register gap) | — | register amendment first; then monitors/runbooks |
| DP-20 (D-C-010/capability) | posting families precede arithmetic (DP-01…DP-09 cluster); explicit branch ⇒ DP-05 | DP-22, DP-23, DP-24 | revenue-engine build (capability refs empty); PLATFORM-recipient rule rows |
| DP-21 (formula meaning) | DP-05 (+D-GL-005 outside); C-5 posture | — | inherited entirely from DP-05 presentations |
| DP-22 (revenue_decision) | DP-20 | — | engine output population; snapshot-semantics contract amendment if authority |
| DP-23 (allocation timing) | DP-02, DP-20 | — | event-time vs periodic allocation records (periodic = new machinery) |
| DP-24 (presentation) | DP-05, DP-09 | — | statement-layer design (gross) / contra capability (net) |
| DP-25 (D-C-009) | — | DP-26, DP-27, DP-28 | aggregator context propagation (only if YES) |
| DP-26 (§9-D4) | DP-25 | DP-28; (a) ⇒ DP-29/DP-31 need | per-aggregator provisioning (a) / evidence-only accrual (b) |
| DP-27 (ledger identity) | DP-25/DP-26 | — | entity-contract amendment (only if (a)) |
| DP-28 (V1 vs defer) | DP-25/26/27 + DP-08 | — | settlement rails (V1) or standing-liability reporting (defer) |
| DP-29 (§9-D3) | DP-01/03/05 answers + DP-30 + DP-31 | every posting area | family provisioning execution |
| DP-30 (C-3 mechanism) | — | DP-29 acceptance, DP-31, DP-32 | provisioning mechanism build (code or migration) |
| DP-31 (governance evidence) | DP-30 (mechanism) | DP-29, DP-32 | definition-registry service or runbook envelope |
| DP-32 (lifecycle) | DP-29, DP-31 | DP-16 across changes | lifecycle documentation; optional effective-dating machinery |

**Contradiction framings:** C-1 blocks the D-C-002 option space (product-level); C-2 blocks DP-13
refund design accuracy; C-3 (=DP-30) blocks the provisioning chain; C-4 is documentation-staleness
(blocks faithful quoting, not decisions); C-5 blocks treating the capability string as decided
(guards DP-05/DP-20-24).

## Minimum dependency chains (before each area can proceed)

1. **Fee revenue posting:**
   [CONFIG gates D-F-001/D-F-002/D-F-003/D-F-006 per product — outside the 32 but register-listed]
   → DP-01 → DP-02 → DP-03 (D-F-005 first, then D-GL-002) → DP-04 (only then can legs be
   composed) → DP-15 (register: decide BEFORE charge wiring) → provisioning chain
   DP-30 → DP-31 → DP-29 → DP-32 → §9-D1 build → §9-D6 pilot → enablement.
   (D-F-005 requires external evidence — cluster 5.)
2. **Commission accounting/posting:**
   [CONFIG gates D-C-001→D-C-002→D-C-003→(D-C-016 if NET)→D-C-004/005/006/007 values]
   → DP-07 → DP-05 (with DP-06 instant pinned; C2C also implicates DP-13) → DP-12 + DP-14
   reversal pair → DP-15 (shared) → provisioning chain (as above) → composer legs → enablement.
   Order-of-recognition rule: fee revenue precedes FEE-basis commission legs (audit §14).
3. **Revenue allocation:**
   DP-20 (activation) → DP-21 (meaning, via DP-05) → DP-23 (timing, via DP-02) + DP-24
   (presentation) → DP-22 (population/contract) → engine build (capability currently has zero
   implementation references; requires DP-01…DP-09 to have produced fee/commission postings first).
4. **Reversal accounting:**
   DP-11 (ops surface) → DP-14 (mechanics) with the per-object trio (D-V-002 fee-refund,
   DP-12 commission, D-V-004 reward — the latter outside the 32) → DP-13 for the expiry class →
   mirror/compensating leg designs per family (only after DP-29 makes the families real).
5. **Commercial reconciliation:**
   DP-16 (dimensions; after DP-01/DP-05) → DP-17 (comparison model) → DP-18/DP-19 handling per
   DP-15 polarity → query/tolerance build + runbooks.
6. **Aggregator accounting:**
   DP-25 (participation) → DP-26 (crediting design) → DP-27 (identity) → DP-28 (V1/defer) →
   (a-lane: provisioning chain + DP-16; b-lane: evidence-only, payout parked at V2 per DP-08).
7. **Account-family provisioning:**
   DP-30 (resolve C-3: mechanism) → DP-31 (evidence model) → DP-29 (execution) → DP-32 (lifecycle).
   This chain is the structural prerequisite of areas 1, 2, 3, and (a-lane) 6 — §9-D3:
   "structural prerequisite for ANY commercial posting".

---

# DECISION CLUSTERS

Clusters 1–4 form a partition (every DP appears exactly once); the assignment rule is stated
inline so no ranking or recommendation is implied. Cluster 5 is cross-cutting by design (the
register's own "Evidence needed" column marks evidence that must exist *before* its decision can
be settled).

1. **MUST DECIDE BEFORE ANY ACCOUNTING IMPLEMENTATION** — rows whose documented blocking status or
   structural role gates the first posting/provisioning step:
   **DP-01, DP-02, DP-03, DP-05, DP-07, DP-14, DP-15, DP-29, DP-30, DP-31**
   (DP-15: register's explicit "BEFORE charge wiring"; DP-29: §9-D3's "structural prerequisite";
   DP-30/31: the provisioning chain's root; DP-14: "blocks enablement once any commercial object
   lives" — reversal mechanics must be settled with the legs themselves).

2. **CAN BE DECIDED IN PARALLEL** — questions with no documented dependency on another DP:
   **DP-11** (ops posture; independent documentation-class decision), **DP-25** (participation
   question independent; its YES branch activates the F-chain but the question itself waits on
   nothing).

3. **DEPENDS ON ANOTHER DECISION** — documented prerequisite(s) from the graph above:
   **DP-04** (01/02/03), **DP-06** (05/07), **DP-09** (05 + config rows), **DP-10** (→12),
   **DP-12** (05/07), **DP-16** (01/05), **DP-17** (16/15), **DP-18** (15), **DP-19** (15/16/11 +
   register gap), **DP-20** (explicit branch ⇒ 05; activation presupposes posting families),
   **DP-21** (05), **DP-22** (20), **DP-23** (02/20), **DP-24** (05), **DP-26** (25),
   **DP-27** (25/26), **DP-32** (29/31).

4. **V2 / CAN REMAIN PARKED** — rows whose own documented option space or blocking status parks
   them out of V1 scope or out of today's critical path:
   **DP-08** (payout rail "V2-parked"; no settlement execution needed unless the accrued fork is
   live), **DP-13** (register blocking "NO" today; becomes gating only once commercial legs could
   post at initiation), **DP-28** (defer-to-V2 is a documented lane; A18/EXTERNAL_SETTLEMENT
   mark payout execution V2).
   (Parking rationale is register vocabulary only; the human may re-prioritize any of the three.)

5. **INFORMATION / EVIDENCE REQUIRED BEFORE DECISION** — cross-cutting, from the register's own
   "Evidence needed" column (can coexist with any cluster membership):

   | Decision | Documented evidence required (register wording) | Source |
   |---|---|---|
   | DP-01 | Chart-of-accounts design statement; per-product reporting requirement | P-DEC-01 §8 D-GL-001 |
   | DP-02 | Finance recognition policy statement | §8 D-GL-003 |
   | DP-03 | **Jurisdictional tax opinion; invoicing practice** (external, [TAX]) | §8 D-GL-002 |
   | DP-05 | Treasury/settlement decision; chart mapping proposal | §8 D-GL-004 |
   | DP-08 | Treasury decision | §10.4 D-C-014 |
   | DP-11 | Ops readiness | §10.9 D-V-001 |
   | DP-13 | Ops policy | §10.9 D-V-006 |
   | DP-14 | Reversal/correction runbook requirements | §8 D-GL-006 |
   | DP-15 | Failure-semantics requirement agreed by audit/reconciliation owners | §8 D-GL-009 |
   | DP-16 | Operations reporting/break-tolerance requirements | §8 D-GL-010 |
   | DP-25 | Aggregator commercial agreements (external) | §10.4 D-C-009 |
   | All D-C/D-F/D-R value rows (outside the 32) | `VALUE REQUIRED` cells + per-row evidence | P-DEC-01 §10 |

---

# HUMAN DECISION WORKSHEET

Status starts at **AWAITING HUMAN DECISION** for every row — including rows whose *current
posture* an implementation exhibits (DP-13's no-refund behavior, DP-15's atomic posture): the
registers hold those policies **open**, so posture ≠ decided. Compact option abbreviations are the
register's own.

| ID | Decision | Owner | Decision required | Options (register) | Depends on | Blocks | Status |
|---|---|---|---|---|---|---|---|
| DP-01 | Fee-revenue account granularity (D-GL-001) | Finance | Which granularity carries fee revenue | (a) product-level / (b) pooled+metadata | — | Fee charging; §9-D3; D-GL-010 | AWAITING HUMAN DECISION |
| DP-02 | Fee recognition timing (D-GL-003) | Finance | When fee revenue is recognized | (a) at completion / (b) deferred | — | Fee charging; §9-D1 | AWAITING HUMAN DECISION |
| DP-03 | VAT stance + treatment (D-F-005/D-GL-002) | Finance(+Legal evidence) | Tax stance, then treatment | 005(a/b/c); 002(a/b/c) | D-F-005 first (register) | Fee charging if VAT-bearing | AWAITING HUMAN DECISION |
| DP-04 | Fee leg composition | OWNER NOT SPECIFIED | Exact legs per product (design) | none enumerated (§9-D1 design) | DP-01/02/03 + D-F-003/006 | §9-D1 build; charge wiring | AWAITING HUMAN DECISION |
| DP-05 | Commission family + PLATFORM mapping (D-GL-004) | Finance | Which treatment carries commission | (a) exp+payable / (b) wallet netting / (c) contra | co-gate DP-06/07 | Commission posting; §9-D3 | AWAITING HUMAN DECISION |
| DP-06 | Commission recognition instant | OWNER NOT SPECIFIED | Event that crystallizes payable/expense | folded into D-C-015 (a/b) | DP-05/07 context | Commission posting (inherited) | AWAITING HUMAN DECISION |
| DP-07 | Payable timing (D-C-015) | Finance | Immediate vs accrued | at completion / crystallizing event | — | Commission enablement | AWAITING HUMAN DECISION |
| DP-08 | Settlement rail (D-C-014) | Finance+Operations | Rail + cadence for accrued commission | wallet credit / payout rail V2 / pool netting / cadence | DP-05(a) or DP-07-accrual | Settlement execution | AWAITING HUMAN DECISION |
| DP-09 | Commission ↔ fee revenue relationship | Finance (+Product+Finance) | Journal relation/order | inherits DP-05; D-C-003/016 govern | DP-05 | FEE/NET-basis legs | AWAITING HUMAN DECISION |
| DP-10 | Commission reversal treatment (cross-ref) | Finance | see DP-12 (single decision, dual-listed row) | clawback / mark-adjust / never | DP-12 | with DP-12 | AWAITING HUMAN DECISION |
| DP-11 | Reversal ops workflow (D-V-001) | Product+Finance+Operations | V1 workflow or V2-graded | stay V2-graded / minimum workflow now | — | Reversal ops once objects post | AWAITING HUMAN DECISION |
| DP-12 | Commission on reversal (D-V-003) | Finance | Behavior on reversal/failure | clawback before settle / mark-adjust / never | DP-07, DP-05 | Commission-leg reversals | AWAITING HUMAN DECISION |
| DP-13 | C2C expiry accounting (D-V-006) | Product+Operations | Refund/refill policy for EXPIRED | no auto-refund (current) / auto-credit pool+wallet / ops-manual | C-2 fix first; DP-11 | Non-blocking today | AWAITING HUMAN DECISION |
| DP-14 | Reversal mechanics (D-GL-006/D-V-005) | Finance+Operations; Finance | Which legs reverse + how | rev.journals+supersedes / compensating / supersedes-only / both | DP-11; families exist (DP-29) | Enablement once objects live | AWAITING HUMAN DECISION |
| DP-15 | Posting-failure semantics (D-GL-009) | Finance+Product | Failure evidence posture | (a) atomic, no snapshot / (b) explicit failure status | — | Charge wiring (precondition) | AWAITING HUMAN DECISION |
| DP-16 | Reconciliation dimensions (D-GL-010) | Finance(+Operations) | Break-monitor dimension set | per-product accts / payable ledgers / differentials | DP-01/05 | Reconciliation build (design) | AWAITING HUMAN DECISION |
| DP-17 | Record↔journal reconciliation model | OWNER NOT SPECIFIED | Which comparison reconciles what | none enumerated (derived candidates) | DP-16/15 | Recon implementation | AWAITING HUMAN DECISION |
| DP-18 | Evidence without posting | Finance+Product (via D-GL-009) | Break type + recovery if decoupled | inherits DP-15 (a)/(b) | DP-15 | (only if 15-b) | AWAITING HUMAN DECISION |
| DP-19 | Posting without evidence | OWNER NOT SPECIFIED | Register gap: recovery + interim class | none anywhere (gap) | DP-15/16/11 | Theoretical today | AWAITING HUMAN DECISION |
| DP-20 | PLATFORM_REVENUE_ALLOCATION (D-C-010) | Product+Finance | Activation + explicit vs omission | explicit row / retained-by-omission | posting families; DP-05 (explicit) | PLATFORM rule rows; engine build | AWAITING HUMAN DECISION |
| DP-21 | Meaning of fee−commission−reward | OWNER NOT SPECIFIED | Statement vs ledger identity vs aspiration | none enumerated (via DP-05) | DP-05 | Statement/treatment consistency | AWAITING HUMAN DECISION |
| DP-22 | revenue_decision authority | OWNER NOT SPECIFIED | Populate? authority vs contract | none (contract rules authority out) | DP-20 | Non-blocking | AWAITING HUMAN DECISION |
| DP-23 | Allocation timing | OWNER NOT SPECIFIED | Per-transaction vs period | derived: at completion vs deferred | DP-02/20 | Allocation engine design | AWAITING HUMAN DECISION |
| DP-24 | Fee vs commission presentation | OWNER NOT SPECIFIED | Gross vs netted vs contra | via DP-05 (derived) | DP-05/09 | Statements | AWAITING HUMAN DECISION |
| DP-25 | Aggregator participation (D-C-009) | Product+Finance | Do aggregators participate in V1 | (a) no / (b) yes ⇒ §9-D4 | — (evidence: commercial agreements, external) | Aggregator rule rows (CONFIG) | AWAITING HUMAN DECISION |
| DP-26 | Aggregator crediting (§9-D4) | OWNER NOT SPECIFIED | Ledger account vs off-ledger accrual | (a) per-aggregator accounts / (b) off-ledger accrual | DP-25 | Aggregator posting (conditional) | AWAITING HUMAN DECISION |
| DP-27 | Aggregator ledger identity | OWNER NOT SPECIFIED | Identity for receivable/payable | same fork (a)/(b); contract forbids inventing | DP-25/26 | Aggregator accounting build | AWAITING HUMAN DECISION |
| DP-28 | Aggregator settlement V1/V2 | OWNER NOT SPECIFIED | V1 settlement or defer to V2 | V1 settlement / defer-to-V2 (derived pair) | DP-25/26/27 + DP-08 | Aggregator settlement build | AWAITING HUMAN DECISION |
| DP-29 | Provisioning model (§9-D3) | OWNER NOT SPECIFIED | Mechanism per family (AR pattern) | "following AR-control pattern" (+C-3 open) | DP-01/03/05 + DP-30/31 | ANY commercial posting | AWAITING HUMAN DECISION |
| DP-30 | Provisioning mechanism (C-3) | OWNER NOT SPECIFIED | Admin data-task vs migration precedent | none enumerated (contradiction) | — | Provisioning chain root | AWAITING HUMAN DECISION |
| DP-31 | Provisioning governance evidence | OWNER NOT SPECIFIED | Registry vs runbook evidence model | none enumerated (AR template only) | DP-30 | DP-29 acceptance | AWAITING HUMAN DECISION |
| DP-32 | Account-family lifecycle | OWNER NOT SPECIFIED | Lifecycle + stewardship model | none enumerated (B2F03 shape only) | DP-29/31 | Provisioning acceptance | AWAITING HUMAN DECISION |

---

## Compliance notes (this document)

- The original decision pack (`docs/V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01.md`) is untouched;
  `git diff` for this task contains ONLY this new document.
- No source code, migration (count remains 76), test, fee runtime, commission runtime, or ledger
  provisioning was touched; no account was provisioned; no accounting rule created; no policy,
  fee rate, or commission rate chosen; no contradiction silently resolved (C-1…C-5 all carried,
  unresolved); nothing deleted.
- All 32 decisions (DP-01…DP-32) and all 5 contradictions are represented; no option was
  recommended or selected anywhere in this review.
