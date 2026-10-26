# V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01 — Fee Revenue + Commission Accounting Decision Surface

> **DECISION-EXTRACTION / ORGANIZATION ONLY.** Nothing is decided, recommended, implemented, or
> resolved here. No accounting is implemented, no ledger accounts created, no migrations added, no
> transaction/fee/commission runtime modified, no accounting policy invented, no production rates
> introduced. This document is an **organized decision surface** layered over the existing decision
> registers — it does not replace them and it deletes nothing.
>
> **Authoritative base:** `6d5ce58a94d32aa727e717ae33ef7e4e48a5aa89` (docs-only commit:
> V1-COMMERCIAL-ACCOUNTING-AUDIT-01; parent `055b6a6f6f6cd2462882779c7929323b05f3b44b` —
> `feat(commercial): wire commission engine runtime`).
>
> **Primary sources (terminology preserved verbatim where quoted):**
> `docs/archive/v1-implementation/V1-COMMERCIAL-ACCOUNTING-AUDIT-01.md` (this pack's foundation), `docs/V1/V1-COMMERCIAL-POLICY-DECISION-PACK.md`
> (P-DEC-01: the D-F/D-C/D-R/D-V/D-GL/§9 registers), `docs/archive/v1-implementation/V1-COMMERCIAL-IMPLEMENTATION-AUDIT.md`
> (§8/§14/M-10), `docs/archive/phases-b1-b2/B2F-CHART-CLASSIFICATION-CONTRACT.md`, `docs/archive/phases-b1-b2/B2F-ACCOUNTING-TREATMENT-CONTRACT.md`,
> `docs/archive/phases-b1-b2/B2F-ACCOUNTING-MODEL-CONTRACT.md`, `docs/archive/phases-b1-b2/B2F-REVENUE-TAX-COST-AND-COMMERCIAL-EFFECT-ACCOUNTING-CONTRACT.md`,
> `docs/archive/phases-b1-b2/B1-REVENUE-RECOGNITION-CONTRACT.md`, `docs/archive/phases-a2-a7/A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md`,
> `docs/archive/v1-implementation/V1-COMMERCIAL-IMPLEMENTATION-01/02-VERIFICATION-REPORT.md`,
> `src/capability-registry/capability.seed.ts` (PLATFORM_REVENUE_ALLOCATION, AGENT/AGGREGATOR_COMMISSION),
> `src/commercial-decision/commercial-decision-snapshot.entity.ts`,
> `src/agent/agent-cash-to-cash-expiry.service.ts`, `src/ledger/ledger.service.ts`,
> `src/aggregator/aggregator.entity.ts`.

---

## 0. Current repository position (where evidence stops today)

P-DEC-01 §2's six-state model is the binding vocabulary; collapsing states is a defect.
State at the audited base (all seven V1 products):

| State | Fee | Commission | Reward |
|---|---|---|---|
| S1 capability exists technically | YES | YES | YES |
| S2 rule can be configured | YES | YES | YES |
| S3 rule IS configured (production) | **NO — zero rule rows** | **NO — zero rule rows** | **NO** |
| S4 runtime would act on it | Decision **evaluated in-flow** since V1-COMMERCIAL-IMPLEMENTATION-01 (evidence only); **charging absent** | Decision **evaluated in-flow** since V1-COMMERCIAL-IMPLEMENTATION-02 at the six snapshot sites (evidence only); **posting absent** | not wired |
| S5 product policy requires it | **NO — undecided** | **NO — undecided** | **NO** |
| S6 accounting treatment approved | **NO** (`D-GL-001/002/003` open; `FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED`) | **NO** (`D-GL-004` open; `COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED`) | **NO** (`D-GL-005` open) |

Audited constants (verified, §3 of the audit): REVENUE/EXPENSE account types exist but are
uninstantiated; every ALLOCATED/APPLIED decision records `payable:false`, both NOT_PROVISIONED
blockers, and `posting:{journalLegsPosted:false}`; all journals remain principal-only.
Distinction legend used below: **[ACCT]** accounting policy decision · **[BIZ]** commercial/business
decision · **[TAX]** tax/legal evidence requirement · **[TECH]** technical implementation
dependency · **[REG]** regulatory requirement · **[CONTRA]** unresolved repository contradiction.
No entry below is [REG]: **no document in the repository asserts a CBN or other regulator mandate
for the internal account architecture**; the only regulator-adjacent items are tax-evidence
requirements inside [TAX] rows (recorded as *required evidence inputs*, not as existing rules).

---

## A. FEE REVENUE (4 decisions / 1 with a compound row)

### DP-01 — D-GL-001 — Fee-revenue account granularity [ACCT]
- **CURRENT REPOSITORY POSITION:** No fee-revenue family exists (audit §4); B2F03 §13 role
  `finance.revenue.fee` (OPERATING_REVENUE) is `UNMAPPED`. Ledger REVENUE type + CREDIT normal
  balance can host the family (P-DEC-01 §8 constraint row).
- **QUESTION THAT MUST BE ANSWERED:** Per-product fee-revenue accounts, or a single pooled
  fee-revenue account with the product carried in journal metadata?
- **DOCUMENTED OPTIONS (P-DEC-01 §8):** (a) product-level REVENUE accounts — granular statements,
  more accounts; (b) single pooled REVENUE account with product in journal metadata — simple,
  coarser. Both documented as compatible with snapshot `ruleRefs`.
- **CONSEQUENCES / DEPENDENCIES:** Required before fee charging; drives chart-of-accounts design
  and per-product reporting; feeds D-GL-010 reconciliation dimensions; §9-D3 provisioning shape.
- **AFFECTED PRODUCTS:** Every product that becomes fee-bearing (D-F-001 per product, 7 answers).
- **AFFECTED LEDGER FLOWS:** Fee legs at all seven flow snapshot sites (once fee billing exists).
- **BLOCKING STATUS:** ENABLE — "Blocks enablement" (P-DEC-01 §8 row).
- **REQUIRED HUMAN OWNER:** Finance (P-DEC-01 §8 owner column).
- **WHAT MUST NOT BE ASSUMED:** That a pooled account satisfies per-product reporting; that
  metadata-only attribution is as auditable as distinct accounts; any account CODE (none invented
  anywhere; the A5 contract forbids auxiliary/control accounts from "repurpos[ing] settlement,
  clearing, suspense, or wallet accounts" — `docs/archive/phases-a2-a7/A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md`
  line 143); that provisioning requires a migration (M-10 says it does not — see contradiction C-3).

### DP-02 — D-GL-003 — Fee recognition timing [ACCT]
- **CURRENT REPOSITORY POSITION:** Journals are atomic with each flow (existing spine), no accrual
  structures exist; fee posting currently absent entirely.
- **QUESTION:** Recognize at transaction completion, or defer recognition?
- **DOCUMENTED OPTIONS:** (a) recognize at transaction completion — reuses the atomic flow journals
  (documented as the natural fit); (b) deferred recognition — requires accrual structures that do
  not exist (new §9 dependency incl. reversal windows).
- **CONSEQUENCES / DEPENDENCIES:** (b) has no host structures today and couples to D-GL-006/D-V-001
  reversal windows; the C2C claim/expiry lifecycle (DP-13) makes "completion" non-trivial for that
  product only (initiation vs claim timing).
- **AFFECTED PRODUCTS:** All fee-bearing products; CASH_TO_CASH has the only two-stage lifecycle.
- **AFFECTED LEDGER FLOWS:** Fee journal legs per flow; any future accrual/deferral accounts none
  of which exist.
- **BLOCKING STATUS:** ENABLE — "Blocks enablement".
- **OWNER:** Finance.
- **WHAT MUST NOT BE ASSUMED:** That "completion" for C2C means claim — the commission event was
  deliberately bound to initiation (IMPLEMENTATION-02) and fee timing is NOT yet bound to either
  stage by any decision; that deferred structures can be adopted without new accounts.

### DP-03 — D-GL-002 + D-F-005 — VAT/tax treatment and rate [TAX] + [ACCT] + [BIZ]
- **CURRENT REPOSITORY POSITION:** `vat_bps` column exists on `fee_rules`; `vatMinor` exists in the
  fee snapshot (always `'0'`); **no VAT rate, no VAT computing code, no VAT-payable account
  anywhere** (P-DEC-01 §10 note line 182); B2F03 reserves `finance.liability.tax-payable` (UNMAPPED).
- **QUESTIONS:** (D-GL-002) VAT as a separate payable liability leg at charge time, VAT embedded in
  revenue remitted periodically, or no VAT for V1? (D-F-005) the rate/stance itself: (a) no VAT for
  V1; (b) VAT at `vat_bps` (`VALUE REQUIRED — bps`); (c) exempt/zero-rated classification per product.
- **DOCUMENTED OPTIONS:** as above (P-DEC-01 §8 D-GL-002; §10.1 D-F-005). D-GL-002(a) activates
  computation (§9-D1) + disclosure (D-I-002).
- **CONSEQUENCES / DEPENDENCIES:** D-F-005 must answer FIRST (D-GL-002(c) depends on the rate
  stance); VAT computation code does not exist (§9-D1); jurisdiction-specific.
- **AFFECTED PRODUCTS:** All fee-bearing products ("Blocks enablement **if fees are VAT-bearing**").
- **AFFECTED LEDGER FLOWS:** Fee legs at charge time; a tax-payable family leg if (a).
- **BLOCKING STATUS:** D-F-005 = ENABLE (for fee-bearing), D-GL-002 = ENABLE ("if fees VAT-bearing").
- **OWNER:** Finance (+Legal evidence) for D-GL-002; Finance (+Legal evidence) for D-F-005.
  **This pair is the only row in the pack with an external evidence requirement: a jurisdictional
  tax opinion / jurisdiction rate. That is the sum of the repository's regulator-adjacent content —
  it is [TAX], not [REG].**
- **WHAT MUST NOT BE ASSUMED:** Any VAT rate; that `vat_bps=0` rows imply zero-rated classification
  (they are absence, not classification — the schema has no classification column); Nigerian tax
  law specifics (the repository contains none; the evidence must come from outside the repo).

### DP-04 — Fee-revenue ledger leg composition [TECH] + [ACCT]
- **CURRENT REPOSITORY POSITION:** Every fee decision currently records `posting:{journalLegsPosted:
  false, reason:FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED}`; flows post exactly two principal legs.
  No fee-leg composition exists anywhere (IMPLEMENTATION-01 report; runtime-wiring test 24).
- **QUESTION:** For each fee-bearing product: what are the exact fee journal legs (accounts,
  direction, ordering, currency, metadata/product attribution), and how do they compose into the
  existing two-leg principal journals without breaking the balanced/idempotent/SERIALIZABLE spine?
- **DOCUMENTED OPTIONS:** None as values — the register frames composition as the §9-D1
  implementation dependency governed by D-GL-001/002/003 answers and payer semantics D-F-003/D-F-006
  (included-in-amount vs added-on changes the ledger math; payer ≠ sender is NOT representable in
  the current fee schema — §9-D2 dependency).
- **CONSEQUENCES / DEPENDENCIES:** DP-01/02/03 + D-F-003/D-F-006 answers; composition tests must
  keep the reversal + supersedes semantics proven for principal legs.
- **AFFECTED PRODUCTS:** Each fee-bearing product independently (WT, W2C physical-cash payer
  semantics open, C2W, C2C initiation vs claim, CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING
  — the funding fees are separate D-F-007/D-F-008 decisions).
- **AFFECTED LEDGER FLOWS:** All seven flow journals' line composition.
- **BLOCKING STATUS:** ENABLE (after the enabling decisions).
- **OWNER:** OWNER NOT SPECIFIED for leg composition as such (the register assigns owners to the
  governing decisions: Finance for D-GL, Product/Finance for D-F).
- **WHAT MUST NOT BE ASSUMED:** That fee legs simply append to principal legs (payer/inclusive
  models change WHICH principal legs exist — W2C's customer could pay cash physically, C2W's cash
  side is unledgeable, D-F-003/D-F-006); that metadata attribution replaces account granularity
  without the DP-01 answer.

---

## B. COMMISSION ACCOUNTING (6 decisions)

### DP-05 — D-GL-004 — Commission expense/payable family + PLATFORM-retained mapping (the fork) [ACCT]
- **CURRENT REPOSITORY POSITION:** No commission account family exists; every ALLOCATED decision is
  evidence-only (`payable:false`, both blockers, no journal leg). B2F03: `finance.expense.commission`
  (COST_OF_REVENUE) and reserved `finance.liability.commission-payable` are both `UNMAPPED`. Agent
  wallet accounts (`WALLET-*`, LIABILITY) DO exist per agent — the settlement destination for option
  (b) is already provisioned infrastructure. D-C-013 is the same decision dual-listed in the
  commission register (register says: "mirrors D-GL-004 (single decision, dual-listed)").
- **QUESTION:** Which accounting treatment carries an agent commission: expense+payable pair,
  immediate wallet netting, or platform-share contra-revenue presentation?
- **DOCUMENTED OPTIONS (option phrases verbatim from P-DEC-01 §8 D-GL-004; the implications under
  each are assembled from the cited in-repo contracts — B2F03 §13/§18, §9-D3/D4, D-C-014/D-C-015,
  D-V-003, D-GL-010 — no external source, none invented):**
  - **(a) commission as EXPENSE + PAYABLE liability pair (settle later)** — implications:
    requires TWO new families (commission-expense DEBIT-normal, commission-payable CREDIT-normal);
    creates a standing third-party liability that must be aged, reconciled (D-GL-010), and settled
    via D-C-014's rail choice; reversal exposure until settlement (D-V-003).
  - **(b) immediate wallet credit netting expense** — implications: no standing payable family;
    the commission half of the gross/net presentation is resolved at transaction completion as a
    direct agent-liability credit; needs the agent WALLET-* destination (exists); still needs an
    EXPENSE family (DR) unless explicitly presented net (which then interacts with (c) below and
    with fee-revenue gross-up reporting); reversal exposure is immediate (the wallet balance is the
    agent's money the moment it credits — D-V-003 becomes clawback policy, not accrual adjustment).
  - **(c) PLATFORM recipient as contra-revenue vs expense** — implications: commission/share
    presented as reduction of revenue rather than expense; per B2F03 §18 **contra accounts with
    opposite normal balance are NOT creatable under the current `LedgerService.createAccount`
    contract** (normal-balance enforcement); contra runtime is `NOT VERIFIED / REQUIRES REVIEW` and
    would require a separately approved A5-compatible design; choosing (c) therefore adds a
    ledger-capability change to the decision's blast radius.
  - Cross-cutting prohibition (B2F03 §13): *"Automatic role selection from the kind alone is
    prohibited"* — the decision cannot be delegated to a rule-kind mapping.
- **CONSEQUENCES / DEPENDENCIES:** Account family absent (§9-D3); ties to settlement mechanism
  D-C-014 and payable timing D-C-015; aggregator crediting §9-D4; PLATFORM mapping D-C-010;
  reconciliation DP-16; the FEE-REVENUE family is a prerequisite whenever the commission base is
  `FEE` (audit §14 row 18).
- **AFFECTED PRODUCTS:** Every commission-paying product (D-C-001 YES-set; candidate subset per
  register §5.2/5.3/5.4 = W2C/C2W/C2C; D-C-001 alone can extend/deny).
- **AFFECTED LEDGER FLOWS:** C2W/W2C/C2C-initiation journals (commission legs); settlement journals
  (if (a)); agent wallet liability balances (if (b)).
- **BLOCKING STATUS:** ENABLE — "Blocks enablement" (D-GL-004); D-C-013 ENABLE identical.
- **OWNER:** Finance.
- **WHAT MUST NOT BE ASSUMED:** That (b) removes the expense question (netting is one of its three
  presentations, not a fourth hidden option); that (c) is implementable today; that the
  `PLATFORM_REVENUE_ALLOCATION` capability arithmetic ("fee − commission − reward") already made
  this decision (it did not — see DP-21 and contradiction C-5); any account code.

### DP-06 — Commission-payable recognition timing (crystallizing event) [ACCT]
- **CURRENT REPOSITORY POSITION:** No payable family exists; ALLOCATED evidence carries
  `commissionEvent` (`TRANSACTION_COMPLETION` on W2C/C2W, `CASH_TO_CASH_INITIATION` on C2C) — the
  *economic* event stamps are already recorded.
- **QUESTION:** At what moment does the payable (if DP-05(a)) or the expense (either fork)
  crystallize: at the recorded transaction event, or at a later crystallizing event (batch/settlement
  cut)?
- **DOCUMENTED OPTIONS:** Folded into D-C-015's options (DP-07): at transaction completion vs
  crystallizing event (later accrual); D-GL-004's (a) "settle later" implies accrual-at-completion,
  but nothing in the register pinpoints the recognition instant for C2C specifically (initiation vs
  claim).
- **CONSEQUENCES / DEPENDENCIES:** Determines exposure window for D-V-003 clawback; shapes D-GL-010
  payable differential monitoring; interacts with DP-13 expiry (a payable recognized at initiation
  on a transfer that later EXPIRES has no reversal path decided — D-V-003/D-V-006).
- **AFFECTED PRODUCTS:** All commission-paying; C2C uniquely two-stage.
- **AFFECTED LEDGER FLOWS:** Timing of DR expense / CR payable legs relative to principal legs.
- **BLOCKING STATUS:** ENABLE (inherits D-GL-004/D-C-015 blocking).
- **OWNER:** OWNER NOT SPECIFIED as a standalone row (governing rows: D-C-015 Finance, D-GL-004 Finance).
- **WHAT MUST NOT BE ASSUMED:** That the recorded `commissionEvent` stamps settled this — they are
  evidence annotations, not recognition policy; that claim-side timing is available (claim is
  engine-free by design — a later-claim recognition would require a design change, contradicting
  IMPLEMENTATION-02).

### DP-07 — D-C-015 — Immediately payable vs accrued [ACCT] + [BIZ]
- **CURRENT REPOSITORY POSITION:** Register row verbatim: "**Immediately payable vs accrued
  (register #15)** | at transaction completion vs crystallizing event (later accrual) | determines
  journal shape + reversal exposure (D-V-003) and usage/audit windows".
- **QUESTION:** When does any commission obligation become payable: at the transaction event, or
  later (accrue then settle)?
- **DOCUMENTED OPTIONS:** as above.
- **CONSEQUENCES / DEPENDENCIES:** Co-gate of DP-05 (option (b) presupposes immediate; option (a)
  presupposes accrual-then-settle cadence); reversal exposure D-V-003; audit/usage windows.
- **AFFECTED PRODUCTS:** Yes-set of D-C-001.
- **AFFECTED LEDGER FLOWS:** Whether payable legs exist per transaction vs per settlement batch.
- **BLOCKING STATUS:** ENABLE.
- **OWNER:** Finance.
- **WHAT MUST NOT BE ASSUMED:** That "immediate" equals "cash paid out" — wallet credit is a
  liability-to-agent, not cash disbursal (D-C-014 covers the cash rail).

### DP-08 — D-C-014 — Commission payout / settlement rail [BIZ] + [TECH]
- **CURRENT REPOSITORY POSITION:** Register row verbatim: "**Payable settlement mechanism
  (register #14)** | wallet credit / payout rail (V2-parked) / netting against funding pool /
  cadence | payout rail is V2-parked (out of V1); netting/credit = journal design". A18 agent boundary
  documents payout execution as V2 scope; capability EXTERNAL_SETTLEMENT is V2/PLANNED.
- **QUESTION:** Through which rail does an accrued commission (DP-05(a)) reach the agent: wallet
  credit, an external payout mechanism, or netting against the agent funding pool? At what cadence?
- **DOCUMENTED OPTIONS:** as above (wallet credit / payout rail V2 / netting against funding pool /
  cadence open).
- **CONSEQUENCES / DEPENDENCIES:** The payout rail proper is V2 scope — if chosen, settlement stays
  intra-ledger (wallet/pool) in V1; pool netting touches AGENT_FUNDING accounting (D-GL-007
  non-blocking lane) and pool reconciliation (D-GL-008 non-blocking); DP-05/DP-07 govern whether a
  rail is even needed in V1.
- **AFFECTED PRODUCTS:** All commission-paying; AGENT_FUNDING/DEFUNDING if pool-netting is chosen.
- **AFFECTED LEDGER FLOWS:** Settlement journals (new), pool journals (current pool↔wallet
  structure) if netted.
- **BLOCKING STATUS:** ENABLE.
- **OWNER:** Finance+Operations ("Treasury decision" evidence column).
- **WHAT MUST NOT BE ASSUMED:** That V1 will have an external payout rail (explicitly parked V2);
  that "netting against funding pool" is currently sanctioned (it changes pool semantics).

### DP-09 — Commission accounting relationship to fee revenue [ACCT] + [TECH]
- **CURRENT REPOSITORY POSITION:** FEE-basis commission legs require the fee to exist and to be
  *collected* — today the fee is `CALCULATED_NOT_COLLECTED` (`feeCollectionState` annotation on
  every ALLOCATED decision); the audit documents the prerequisite: "FEE-revenue is a prerequisite
  of FEE-basis legs" (audit §14). IMPLEMENTATION-02 never debits commission from the fee: decisions
  are recorded independently.
- **QUESTION:** In journal terms, is agent commission a deduction from the recorded fee revenue
  (gross fee CR netted by an expense/payable pair — options of DP-05) and does any FEE-basis
  commission leg AUTHORIZE from a fee revenue leg that itself is unposted-yet?
- **DOCUMENTED OPTIONS:** Inherits DP-05's three presentations; separately D-C-003 (basis =
  PRINCIPAL/FEE/NET) and D-C-016 (NET definition — gross-fee vs net-fee vs principal as the *policy*
  base) decide whether "fee − commission" amounts are ever computed at all on a per-product basis.
- **CONSEQUENCES / DEPENDENCIES:** Order-of-recognition coupling (fee revenue BEFORE FEE-basis
  commission); audit trail integrity (snapshot ruleRefs already bind each allocation to rule +
  fee decision evidence); reported revenue statements differ by presentation (gross fee + expense
  vs net revenue vs contra).
- **AFFECTED PRODUCTS:** Commission-paying fee-bearing products.
- **AFFECTED LEDGER FLOWS:** C2W/W2C/C2C journals; revenue accounts (once provisioned).
- **BLOCKING STATUS:** ENABLE.
- **OWNER:** Finance (via D-GL-004) with Product+Finance (D-C-016).
- **WHAT MUST NOT BE ASSUMED:** That "commission comes out of the fee" is an economic fact already
  encoded — the code deliberately records fee and commission INDEPENDENTLY, "never defines or
  assumes any relationship between those values" (`src/commission/commission.types.ts` header);
  that NET = principal − fee is an approved convention (D-C-016 open).

### DP-10 — Commission reversal treatment → canonical entry at DP-12 (D-V-003)
- Cross-reference only: reversal/clawback of posted commission is a distinct unresolved decision
  entered under C (DP-12); it binds whichever treatment DP-05 selects. Do not assume ANY clawback
  behavior today — nothing posts, so nothing exists to claw back (P-DEC-01 §5.1-K).

---

## C. REVERSALS / EXPIRY (5 decisions)

### DP-11 — D-V-001 — Ledger-reversal ops workflow [TECH] + [BIZ]
- **CURRENT REPOSITORY POSITION:** Reversal machinery exists (reversal journals ↔ original via
  `reversal_of_journal_id` + `POST /ledger/journals/:id/reversal`); **no ops workflow** exists;
  P-DEC-01 §10.9 marks its effect on "J-operations posture".
- **QUESTION (verbatim):** "Ledger-reversal ops workflow become V1? — stay V2-graded / minimum
  workflow now".
- **DOCUMENTED OPTIONS:** as above.
- **CONSEQUENCES / DEPENDENCIES:** Machinery exists; a workflow changes operations posture; gates
  every DP-12/DP-14 answer (reversal legs need operators, approvals, and evidence).
- **AFFECTED PRODUCTS:** All seven (once commercial objects post); C2C expiry independently (DP-13).
- **AFFECTED LEDGER FLOWS:** All journal families, via reversal journals.
- **BLOCKING STATUS:** "NO (today) / ENABLE (once commercial objects post)" (P-DEC-01 §10.9).
- **OWNER:** Product+Finance+Operations.
- **WHAT MUST NOT BE ASSUMED:** That reversal machinery implies a reversal *process*; that
  snapshots participate in reversals (snapshots are immutable — supersedes only, D-V-005).

### DP-12 — D-V-003 — Commission on reversal / underlying-tx failure [ACCT]
- **CURRENT REPOSITORY POSITION:** Register row verbatim: "**Commission on reversal (or
  underlying-tx failure)** | clawback before settlement / mark-adjust at settlement / never |
  payable timing D-C-015 determines exposure". Today nothing posts, so the question is latent.
- **QUESTION:** When the underlying transaction is reversed (or a C2C transfer expires), what
  happens to a posted commission: clawed back before settlement, adjusted at settlement, or never?
- **DOCUMENTED OPTIONS:** as above.
- **CONSEQUENCES / DEPENDENCIES:** DP-07 determines the exposure window; under DP-05(b) the credit
  is already in the agent's wallet (clawback requires a *new* debit of the agent's WALLET-* —
  operator policy, not mechanics); under DP-05(a) the payable can be extinguished without touching
  the wallet.
- **AFFECTED PRODUCTS:** Commission-paying products; C2C expiry is the only existing economic event
  that triggers this class today (DP-13).
- **AFFECTED LEDGER FLOWS:** Reversal legs on payable (if accrued) or on agent wallet (if netted).
- **BLOCKING STATUS:** ENABLE.
- **OWNER:** Finance.
- **WHAT MUST NOT BE ASSUMED:** That expiry currently reverses anything (it posts nothing); that
  agent-wallet clawback is mechanically pre-approved (no such workflow exists — DP-11).

### DP-13 — CASH_TO_CASH expiry accounting treatment [TECH-live] + [BIZ]
- **CURRENT REPOSITORY POSITION (live code, verified):** A17 expiry posts **NO journal**; principal
  REMAINS in the `CASH_TO_CASH-UNCLAIMED-NGN` liability; transfer status flips to EXPIRED; no
  automatic Agent refund (`agent-cash-to-cash-expiry.service.ts:26-33`). The claim leg pays the
  customer and posts DEBIT unclaimed → CREDIT customer wallet.
- **QUESTION:** (D-V-006, verbatim) "**C2C expiry refund/refill policy** — no auto-refund (current)
  / auto-credit initiator pool+wallet / ops-manual recovery". For the future: if fee/commission legs
  ever post at initiation, an EXPIRED transfer's commercial legs would be the first practical
  application of DP-12/D-V-005.
- **DOCUMENTED OPTIONS:** as above (D-V-006 three options).
- **CONSEQUENCES / DEPENDENCIES:** Today EXPIRED funds sit indefinitely in the unclaimed liability;
  any auto-credit design touches the agent wallet + pool (D-V-006 explicitly includes
  pool+wallet credit); ops recovery requires DP-11's workflow.
- **AFFECTED PRODUCTS:** CASH_TO_CASH only.
- **AFFECTED LEDGER FLOWS:** Potential future EXPIRED-release journals (unclaimed → agent wallet /
  pool); none exist today.
- **BLOCKING STATUS:** "NO" for D-V-006 (non-blocking today — exists pre-fees); expiry's interaction
  with commercial legs becomes ENABLE the moment any posting exists.
- **OWNER:** Product+Operations (D-V-006 row).
- **WHAT MUST NOT BE ASSUMED:** See contradiction C-2 — the pack's D-V-006 narrative says funds
  "remain in pool"; the code's authoritative statement is the UNCLAIMED liability account. Do not
  budget the pool for expired principal.

### DP-14 — D-GL-006 + D-V-005 — Whether future commercial legs can be reversed, and by which mechanics [ACCT] + [TECH]
- **CURRENT REPOSITORY POSITION:** D-GL-006 verbatim: "(a) ledger reversal journals (machinery
  exists) with snapshot supersedes for commercial corrections; (b) compensating journals without
  formal reversal API; both keep snapshot immutability". D-V-005: "snapshot supersedes-only /
  ledger reversal / both (default expectation: both for money+evidence)".
- **QUESTION:** Which commercial legs reverse (principal/fee/commission/reward — D-V-002/003/004
  per object) and through which mechanics and account families (mirror legs into the ORIGINAL
  accounts vs compensating legs)?
- **DOCUMENTED OPTIONS:** as above.
- **CONSEQUENCES / DEPENDENCIES:** Depends on DP-11 workflow + D-V-002 (fee refund per product);
  snapshot immutability is binding regardless (no snapshot row is ever updated — trigger-enforced).
- **AFFECTED PRODUCTS:** All seven once commercial objects post.
- **AFFECTED LEDGER FLOWS:** All future fee/commission/reward journal families (none exist).
- **BLOCKING STATUS:** "Blocks enablement (once any commercial object lives)".
- **OWNER:** Finance+Operations (D-GL-006); Finance (D-V-005).
- **WHAT MUST NOT BE ASSUMED:** That reversing the original accounts is safe by default (the
  payable vs wallet-credit destination changes the clawback counterparty — DP-12); that snapshot
  supersedes replaces journal reversal (they serve different planes: evidence vs money).

### DP-15 — D-GL-009 — Posting-failure semantics (decision recorded but posting failed) [ACCT] + [TECH]
- **CURRENT REPOSITORY POSITION:** Current verified posture (option (a)): the whole flow fails
  atomically and NO snapshot is recorded (snapshot is written on the success path only — IMPLEMENTATION-01
  fee runtime test 10 and IMPLEMENTATION-02 runtime-wiring test 15/21 prove zero residue). With a
  zero-charge reality this asymmetry can only exist in theory.
- **QUESTION (verbatim):** "(a) whole flow fails atomically and no snapshot is recorded (current
  verified posture for the 0-charge reality); (b) snapshot recorded with explicit failure status
  (schema change + policy on evidence-of-failure)".
- **CONSEQUENCES / DEPENDENCIES:** (b) changes snapshot semantics (PENDING exists in
  `CommercialDecisionStatus` vocabulary but is unused by flows; evidence-of-failure policy +
  reconciliation rules must exist BEFORE charge wiring writes non-zero decisions).
- **AFFECTED PRODUCTS:** All seven.
- **AFFECTED LEDGER FLOWS:** Failure paths of every flow journal + snapshot write.
- **BLOCKING STATUS:** "Blocks charge-wiring enablement".
- **OWNER:** Finance+Product ("Failure-semantics requirement agreed by audit/reconciliation owners").
- **WHAT MUST NOT BE ASSUMED:** That (a) remains acceptable once money moves (an unrecorded failed
  charge leaves the ledger true but the decision audit trail silent); that (b) is a small change
  (schema + evidence policy + reconciliation).

---

## D. COMMERCIAL RECONCILIATION (4 decisions)

### DP-16 — D-GL-010 — Reconciliation expectations for commercial objects [TECH] + [ACCT]
- **CURRENT REPOSITORY POSITION:** "fee/commission/reward rows absent today; reconciliation
  monitors ledger/wallet/transfer/pool planes (audit J-surface)". External reconciliation service
  exists (repeatable-read, read-only over ledger/ops planes).
- **QUESTION (verbatim):** "what dimensions must break-monitor when commercial objects start
  posting (per-product revenue accounts, payable ledgers, payable-vs-posted differentials)".
- **DOCUMENTED OPTIONS:** enumerated in the row (per-product revenue accounts / payable ledgers /
  payable-vs-posted differentials); no values decided.
- **CONSEQUENCES / DEPENDENCIES:** Follows D-GL-001/004/005 answers; feeds ops runbooks (non-code).
- **AFFECTED PRODUCTS:** All fee/commission-bearing; pool planes unchanged meanwhile.
- **AFFECTED LEDGER FLOWS:** Reconciliation queries over the new families.
- **BLOCKING STATUS:** "Blocks enablement (design), non-blocking for configuration".
- **OWNER:** Finance(+Operations).
- **WHAT MUST NOT BE ASSUMED:** That today's reconciliation planes detect commercial breaks (they
  cannot — nothing posts); that a payable-vs-posted differential is zero by construction under
  DP-05(b).

### DP-17 — How commercial-decision records reconcile against financial journals [TECH]
- **CURRENT REPOSITORY POSITION:** Each snapshot carries `journalId`, `idempotencyKey`,
  `requestHash`, ruleRefs (rule id+version) per decision; the snapshot entity contract:
  "**Historical evidence only: NEVER an authority for usage counters, balances or ledger state.**"
  Ledger/journal truth reigns for money; snapshot truth reigns for the decision evidence; today
  both planes are written in THE SAME transaction (atomicity removes drift).
- **QUESTION:** Once commercial legs post: which record reconciles against which (snapshot-vs-journal
  at the same journalId? fee decision `feeMinor` vs fee legs sum? allocations sum vs commission
  legs sum?) and who owns break resolution?
- **DOCUMENTED OPTIONS:** Not enumerated as options in the registers — registered only as D-GL-010's
  dimensions question + the standing entity contract that the snapshot never becomes authority.
  Composition facts (rules·snapshot links) are already captured per decision.
- **CONSEQUENCES / DEPENDENCIES:** DP-16 design; D-GL-009 posture defines the failure polarity.
- **AFFECTED PRODUCTS:** All posting products.
- **AFFECTED LEDGER FLOWS:** All future commercial journal families.
- **BLOCKING STATUS:** Inherits DP-16.
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** Snapshot-as-authority (the contract forbids it — see DP-22); that
  same-transaction atomicity survives any future decoupling (outbox/worker paths for settlement
  would introduce drift surfaces).

### DP-18 — Commercial evidence exists but financial posting fails [ACCT] + [TECH]
- **CURRENT REPOSITORY POSITION:** Cannot occur today: decision and journal are atomic in one
  SERIALIZABLE transaction (verified rollback tests); recorded failures leave NOTHING (IMPLEMENTATION-01
  report: "downstream failure rolls back snapshot + computed fee decision + journal atomically").
- **QUESTION:** If architectures decouple (or D-GL-009 selects (b)): what is the break type, the
  detection dimension, and the recovery action when a decision record exists with no legs?
- **DOCUMENTED OPTIONS:** The same D-GL-009 (a)/(b) — under (a) this state is precisely the
  impossible-by-construction one; under (b) it becomes representable and NEEDS the policy.
- **CONSEQUENCES / DEPENDENCIES:** DP-15; DP-17 reconciliation model; ops manual-correction path
  (D-V-005/D-V-001).
- **AFFECTED PRODUCTS:** All seven.
- **AFFECTED LEDGER FLOWS:** Failure/correction paths only.
- **BLOCKING STATUS:** Inherits D-GL-009.
- **OWNER:** Finance+Product (via D-GL-009).
- **WHAT MUST NOT BE ASSUMED:** That the current atomic spine will be relaxed knowingly — any
  decoupling is a new design decision NOT in any register today.

### DP-19 — Financial posting succeeds but commercial evidence is incomplete [ACCT] + [TECH]
- **CURRENT REPOSITORY POSITION:** The converse polarity of DP-18: under the current atomic spine,
  also impossible (both or neither). The snapshot write precedes commit within the flow tx; a
  PENDING status never passes the service today.
- **QUESTION:** If posting can succeed with missing/partial decision evidence (service downgrade,
  manual ops journal, future decoupled paths): what evidence-recovery (snapshot supersedes?) and
  what accounting classification holds the un-attributed money in the interim?
- **DOCUMENTED OPTIONS:** Not listed anywhere as an option row — reported as a **gap in the
  registers** (the D-GL register handles decision-present-no-posting but not
  posting-present-no-evidence for commercial legs).
- **CONSEQUENCES / DEPENDENCIES:** DP-11 workflow; DP-16 monitors; any manual/ops journal channel
  would need an out-of-band decision capture.
- **AFFECTED PRODUCTS:** All seven (via ops/manual journals if ever used).
- **AFFECTED LEDGER FLOWS:** Manual/other journal paths.
- **BLOCKING STATUS:** Enablement-design (inherits DP-16/DP-15); currently theoretical.
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** That the snapshot service fills gaps retrospectively (it records
  what flows hand it; manual journals bypass it entirely by construction today).

---

## E. PLATFORM REVENUE (5 decisions)

### DP-20 — PLATFORM_REVENUE_ALLOCATION capability activation [BIZ] + [ACCT]
- **CURRENT REPOSITORY POSITION (capability.seed.ts):** description "**Platform revenue = fee −
  commission − reward**"; lifecycle PLANNED / backendStatus PLANNED / enabled **false** /
  NOT_CONFIGURED; dependencies `['COMMISSION_ENGINE','FEE_ENGINE']`; **`implementationReferences: []`,
  `migrationReferences: []`, `testReferences: []`** — literally no engine exists; blockerType
  PRODUCT_DECISION; blocker "'Requires revenue allocation decision'"; notes: "...no revenue engine
  exists and revenue stays null in V1 snapshots."
- **QUESTION:** Does V1 compute/record a platform-revenue allocation at all, and if so is it a
  *recorded allocation* (explicit PLATFORM recipient rows) or *retained-by-omission* (no row)?
- **DOCUMENTED OPTIONS:** D-C-010 (DP below categories; register): "PLATFORM row as explicit
  allocation vs revenue-retained-by-omission (no row)".
- **CONSEQUENCES / DEPENDENCIES:** An explicit PLATFORM row needs an account destination (D-GL-004);
  omission keeps the platform share implicit inside fee revenue with no
  separate allocation evidence row; either way requires fee+commission posting families before any
  arithmetic has legs.
- **AFFECTED PRODUCTS:** All commission/fee-bearing.
- **AFFECTED LEDGER FLOWS:** Revenue-side journals once provisioned.
- **BLOCKING STATUS:** CONFIG (D-C-010 group) before any production rule row; ENABLE for posting.
- **OWNER:** Product+Finance (D-C-010).
- **WHAT MUST NOT BE ASSUMED:** That "PLATFORM recipient" in the commission rule vocabulary is a
  revenue engine (it is a rule *kind* only — nothing consumes it at runtime because PLATFORM
  allocation machinery does not exist); that omission is "free" (states reporting/collection
  differently).

### DP-21 — Meaning and accounting treatment of "revenue = fee − commission − reward" [ACCT] + [CONTRA-flag]
- **CURRENT REPOSITORY POSITION:** The formula exists ONLY as a capability **description** (see
  DP-20). No code computes it; B2F03 explicitly forbids deriving debit/credit roles from decision
  kinds; D-GL-004(c) leaves presentation (gross vs contra vs netting) open.
- **QUESTION:** Is the formula a *statement-line identity* (reporting), a *ledger posting identity*
  (net legs), or just an aspiration that decomposes into separate fee-revenue/expense/reward lines
  depending on DP-05 and D-GL-005?
- **DOCUMENTED OPTIONS:** Not enumerated anywhere; the three presentation outcomes are reachable
  only through DP-05/D-GL-005 choices.
- **CONSEQUENCES / DEPENDENCIES:** Every preceding A/B row; reported statement shape.
- **AFFECTED PRODUCTS:** All posting products.
- **AFFECTED LEDGER FLOWS:** Revenue + expense families.
- **BLOCKING STATUS:** ENABLE.
- **OWNER:** OWNER NOT SPECIFIED (no register row owns the formula itself).
- **WHAT MUST NOT BE ASSUMED:** That subtraction in a capability description is an accounting
  treatment (see contradiction C-5); that PLATFORM shares exist at all without D-C-010's YES.

### DP-22 — Whether `revenue_decision` becomes authoritative [ACCT-standing] + [TECH]
- **CURRENT REPOSITORY POSITION:** Snapshot column `revenue_decision` JSONB nullable with validated
  vocabulary NONE|RETAINED (`assertDecisionObject … REVENUE_STATUSES`); **every flow writes `null`**
  today; the parent entity contract: "Historical evidence only: NEVER an authority for usage
  counters, balances or ledger state." Service validation admits the values; no engine produces it.
- **QUESTION:** Should `revenue_decision` (status/retainedMinor) ever be populated, and if so can
  it be treated as authoritative (recognition input) — or does the standing evidence-only contract
  continue to bind it?
- **DOCUMENTED OPTIONS:** None enumerated in any register; the standing contract rules OUT
  authority; changing that contract is itself unregistered.
- **CONSEQUENCES / DEPENDENCIES:** Populating it presupposes DP-20's engine + a retention account
  mapping; contract change would need a new snapshot-semantics decision (no register row exists).
- **AFFECTED PRODUCTS:** All seven.
- **AFFECTED LEDGER FLOWS:** None mechanical (JSONB only).
- **BLOCKING STATUS:** Enablement-design, non-blocking; a contradiction would arise if anyone used
  it as authority without a contract change.
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** That populated fields imply authority; that the NONE/RETAINED
  vocabulary validated == retention posting machinery.

### DP-23 — Timing of revenue allocation [ACCT]
- **CURRENT REPOSITORY POSITION:** No allocation exists; the fee recognition timing (DP-02) is the
  only adjacent timing decision; snapshot `decidedAt/finalizedAt` stamps exist per snapshot.
- **QUESTION:** At transaction completion per-transaction, or at period aggregation (statement/close)?
- **DOCUMENTED OPTIONS:** Not enumerated; inherits DP-02 options by analogy (at completion vs
  deferred); close mechanics do not exist (B2F03 §17: "B2F03 does not implement year-end close or
  equity posting").
- **CONSEQUENCES / DEPENDENCIES:** DP-02; equity/retained-earnings close is out of scope of any V1
  machinery (all equity roles UNMAPPED).
- **AFFECTED PRODUCTS:** All posting products.
- **AFFECTED LEDGER FLOWS:** Would allot timing metadata to revenue legs (none exist).
- **BLOCKING STATUS:** Enablement-design.
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** That any period close will exist in V1 (machinery + B2F scope both
  say no); that per-transaction identity satisfies statement requirements without DP-01 granularity.

### DP-24 — Relationship between fee revenue and Agent commission (presentation) [ACCT]
- **CURRENT REPOSITORY POSITION:** Code records fee and commission decisions **independently** —
  "never defines or assumes any relationship between those values" (`commission.types.ts` header);
  the economic relationship is future presentation policy only.
- **QUESTION:** Gross presentation (full fee revenue + commission expense side by side) vs netted
  (fee minus commission as revenue) vs contra — distinguished from DP-05: DP-05 picks the *journal
  mechanics*; this picks the *statement relationship* and which totals the business reports.
- **DOCUMENTED OPTIONS:** Reachable via DP-05 options; not enumerated independently in any register.
- **CONSEQUENCES / DEPENDENCIES:** DP-05; regulator/statement reporting would be [TAX-adjacent]
  only if external reporting standards assert themselves (not in repo).
- **AFFECTED PRODUCTS:** All posting products.
- **AFFECTED LEDGER FLOWS:** Statement/reporting views over revenue/expense ledgers.
- **BLOCKING STATUS:** ENABLE (statement do not block configuration).
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** That the absence of a relationship in code endorses netting (or
  gross) presentations; any IFRS/local-standard answer (the repo holds none).

---

## F. AGGREGATORS (4 decisions)

### DP-25 — D-C-009 — Aggregator participation [BIZ]
- **CURRENT REPOSITORY POSITION:** Verbatim: "(register #9) | (a) no aggregator commission in V1;
  (b) yes ⇒ §9-D4 account design mandatory | structural: aggregator has no ledger identity today".
  Aggregator entities exist (corporate identity, relationships, funding-attribution routes); the
  runtime NEVER supplies `aggregatorId` context (IMPLEMENTATION-02, deliberate), so
  aggregator-targeted rules can never match today.
- **QUESTION:** Do aggregators participate in V1 commission at all?
- **DOCUMENTED OPTIONS:** as above.
- **CONSEQUENCES / DEPENDENCIES:** YES ⇒ DP-26/DP-27 mandatory; commercial-agreement inputs
  ("Aggregator commercial agreements" evidence column) — **outside the repository**.
- **AFFECTED PRODUCTS:** Any commission-paying product with aggregator-linked agents.
- **AFFECTED LEDGER FLOWS:** Would add aggregator legs to commission journals; today none possible.
- **BLOCKING STATUS:** CONFIG (before any aggregator rule).
- **OWNER:** Product+Finance.
- **WHAT MUST NOT BE ASSUMED:** That funding-via-aggregator routes imply an accounting identity
  (they move pool↔agent wallet and record attribution only); that dormant AGGREGATOR rule
  vocabulary is a decision to participate.

### DP-26 — §9-D4 — Aggregator crediting design [TECH]
- **CURRENT REPOSITORY POSITION:** Verbatim §9-D4: "**Aggregator crediting design** (account
  destination or off-ledger accrual) | D-C-009 | ONLY if aggregator participates; today aggregators
  have no ledger identity". The implementation audit's architecture note quotes the same fork.
- **QUESTION:** If YES at DP-25: provision per-aggregator payable-like ledger accounts (legs at
  allocation time), or keep aggregator shares as off-ledger accrual evidence inside snapshots until
  a V2 payout rail credits them?
- **DOCUMENTED OPTIONS:** (a) ledger-account identity per aggregator; (b) off-ledger accrual
  evidence, crediting deferred to V2 payout rail.
- **CONSEQUENCES / DEPENDENCIES:** (a) = §9-D3 family per aggregator + reconciliation (DP-16);
  (b) = payout/lifecycle evidence design (DP-08 rail). No decision exists; "nothing may be
  provisioned" (implementation audit).
- **AFFECTED PRODUCTS:** Aggregator-involving commission products.
- **AFFECTED LEDGER FLOWS:** Would-be aggregator credit legs.
- **BLOCKING STATUS:** Implementation dependency, gated by D-C-009.
- **OWNER:** OWNER NOT SPECIFIED (the §9 row is a dependency descriptor; D-C-009 owner covers the
  gate).
- **WHAT MUST NOT BE ASSUMED:** That option (b) is "free" — snapshot-only accruals are evidence,
  not a duty-to-pay with audit-grade traceability; V2 rails are not in this repository.

### DP-27 — Aggregator ledger identity [TECH]
- **CURRENT REPOSITORY POSITION (entity contract, verbatim `aggregator.entity.ts:25-27`):**
  "Aggregator has NO wallet, NO ledger balance, NO funding. It is a corporate identity...
  ownership/accounting explicitly; A18 does not invent a ledger account."
- **QUESTION:** What ledger identity (if any) represents an aggregator receivable/payable position —
  and does anything at all change on the entity before such identity may be created?
- **DOCUMENTED OPTIONS:** Same fork as DP-26 ((a)/(b)); entity contract currently FORBIDS
  inventing identity: any ledger identity would be a new, separately approved decision.
- **CONSEQUENCES / DEPENDENCIES:** DP-25/26; pool/funding flows' attribution fields.
- **AFFECTED PRODUCTS:** All agent-funding-via-aggregator operations today (attribution-only).
- **AFFECTED LEDGER FLOWS:** Pool↔agent wallet journals (unchanged today).
- **BLOCKING STATUS:** Implementation dependency gated by D-C-009.
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** An aggregator "account" can be created administratively without
  DP-25/26 + a chart decision; that attribution = liability.

### DP-28 — Aggregator commission/settlement: V1 or deferred [BIZ] + [TECH]
- **CURRENT REPOSITORY POSITION:** Aggregator funding capability V1-facing
  (AGGREGATOR_FUNDING_ARCHITECTURE); EXTERNAL_SETTLEMENT capability is V2/PLANNED; audit
  (rows 17/20 §11) states accrued-then-settled rails are V2 scope ("settlement rail = D-C-014;
  payout execution is V2 per A18 boundary").
- **QUESTION:** If DP-25 YES: is any aggregator settlement in V1 at all, or definitively deferred
  to V2 with only accrual evidence (if DP-26(b)) or standing liabilities (if DP-26(a)) recorded?
- **DOCUMENTED OPTIONS:** V1 settlement vs defer-to-V2 (register gives D-C-014 rail options; the
  audit marks payout execution V2).
- **CONSEQUENCES / DEPENDENCIES:** DP-25/26/27 + DP-08; operator load if liabilities stand in V1.
- **AFFECTED PRODUCTS / LEDGER FLOWS:** as DP-26.
- **BLOCKING STATUS:** CONFIG-lane gate (stems from D-C-009 choose).
- **OWNER:** OWNER NOT SPECIFIED (parent gate: Product+Finance via D-C-009).
- **WHAT MUST NOT BE ASSUMED:** That "V2-parked" equals "impossible to owe in V1" — a standing V1
  payable (DP-26(a)) would still be a V1 liability even with V2 settlement.

---

## G. ACCOUNT PROVISIONING (4 decisions + 1 contradiction entry)

### DP-29 — §9-D3 — Commercial account-family provisioning model [TECH] + [ACCT]
- **CURRENT REPOSITORY POSITION:** §9-D3 verbatim: "**Commercial account families in the ledger**
  (fee-revenue, VAT-payable, commission expense/payable, reward liability/expense) | D-GL-001/002/004/005 |
  Provisioning task following AR-control pattern; no codes invented here; structural prerequisite
  for ANY commercial posting".
- **QUESTION:** Through which APPROVED mechanism are these families defined, approved, provisioned,
  and evidenced (codes, type, normal balance, allow-negative, accounting-unit, granularity from
  DP-01, effective dates)?
- **DOCUMENTED OPTIONS:** "Provisioning task following AR-control pattern"; i.e., an authorized
  definition with privileged-action approval + finance-control verification + audit (the
  `ar-control-account-provisioning.service.ts` shape), feeding from the B2F03 mapping concept
  (`FinanceA5AccountMappingV1` immutable, effective-dated, evidence-carrying).
- **CONSEQUENCES / DEPENDENCIES:** All D-GL families; §9-D6 pilots; composition tests ("composed
  legs post balanced journals; account lookup failures fail-closed" — implementation audit §14 test
  notes).
- **AFFECTED PRODUCTS:** All posting products.
- **AFFECTED LEDGER FLOWS:** `ledger_accounts` content only (no runtime code touching flow paths).
- **BLOCKING STATUS:** Structural prerequisite (blocks every posting dependency).
- **OWNER:** OWNER NOT SPECIFIED (dependency row; D-GL families' owners: Finance).
- **WHAT MUST NOT BE ASSUMED:** That ANY provisioning may reuse settlement/clearing/suspense/wallet
  accounts (A5 contract *forbids* repurposing); that a code can be chosen without a Finance
  chart-of-accounts decision; that REVENUE/EXPENSE creation needs schema (it does not).

### DP-30 — M-10/§14 accounts-admin surface vs migration-seeded precedent [CONTRA]
- **CURRENT REPOSITORY POSITION:** Implementation audit §14/M-10: "chart-of-accounts provisioning
  is a **data task executed through the existing accounts-admin surface following the
  PAYMENT-SETTLEMENT precedent (no schema migration; see M-10)**". But the five current control
  accounts were seeded by **migrations** (`1785753600002`, `…00057`, `…00061`), and the live
  privileged provisioner authorizes **exactly one** fixed definition
  (`FINANCE-ACCOUNTS_RECEIVABLE-NGN`).
- **QUESTION:** Which is authoritative for the commercial families: the forward pattern
  (data-only provisioning via an approved admin/provisioner surface) or the historical pattern
  (migrations seeding accounts)?
- **DOCUMENTED OPTIONS:** Not enumerated — the two statements disagree in *mechanism*; reported
  here as a contradiction to resolve, not to reconcile silently (audit §12 note mirrors this
  tension).
- **CONSEQUENCES / DEPENDENCIES:** Migration-free provisioning implies NEW provisioner code beyond
  the single-authorized AR control (DP-31); migration-based would re-violate M-10's policy
  statement but matches precedent.
- **AFFECTED PRODUCTS:** all posting products.
- **AFFECTED LEDGER FLOWS:** `ledger_accounts` content; migrations count (76 today).
- **BLOCKING STATUS:** Enablement-design contradiction (blocks §9-D3 acceptance criteria wording).
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** That "existing accounts-admin surface" currently exists *with the
  AR path's governance evidence* (it does not — POST /ledger/accounts is a plain admin call; see
  next entry).

### DP-31 — Approval/governance evidence for arbitrary accounting-family provisioning [TECH] + [ACCT]
- **CURRENT REPOSITORY POSITION:** `A5ArControlAccountProvisioningService` = privileged-action approval +
  B2F finance-control verification + audit + idempotency, FOR EXACTLY ONE hardcoded definition; the
  generic `POST /ledger/accounts` → `createAccount` carries none of that evidence; B2F03's
  `FinanceA5AccountMappingV1` describes the approval-evidenced mapping *record* (not an
  implementation).
- **QUESTION:** What constitutes governance-grade provisioning evidence for a commercial family
  (approval reference, actor, contract version, finance-control verification) — a new
  authorized-definition registry (AR-pattern generalized), or documented manual provisioning under
  a new runbook?
- **DOCUMENTED OPTIONS:** Not enumerated; the AR contract is the only living template.
- **CONSEQUENCES / DEPENDENCIES:** Blocks DP-29 acceptance; auditability of family lifecycle
  (DP-32) depends on it.
- **AFFECTED PRODUCTS / LEDGER FLOWS:** `ledger_accounts` content; operations/audit trails.
- **BLOCKING STATUS:** Enablement-design.
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** That a DB insert by operations is an approved chart change; that
  today's AR provisioner can be reused unmodified (its definition set is a constant).

### DP-32 — Required account-family lifecycle [TECH] + [ACCT]
- **CURRENT REPOSITORY POSITION:** `LedgerAccount` has `isActive` + timestamps; no
  effective-dating/versioning/stewardship fields; B2F03 mapping concept carries effective
  intervals (`FinanceA5AccountMappingV1`) but is not implemented for commercial roles (all
  UNMAPPED); no chart governance doc for V1 chart changes (M4-FINANCE-VERIFICATION.md contains no
  revenue/expense statements).
- **QUESTION:** What lifecycle governs a family: creation approval → effective interval →
  composition change → deactivation → reporting continuity? Who owns the V1 chart (stewardship)?
- **DOCUMENTED OPTIONS:** Not enumerated; B2F03's mapping-record vocabulary supplies the shape.
- **CONSEQUENCES / DEPENDENCIES:** DP-29/31; DP-16 reconciliation expectations across family
  changes; migrations-family precedent (append-only history).
- **BLOCKING STATUS:** Enablement-design.
- **OWNER:** OWNER NOT SPECIFIED.
- **WHAT MUST NOT BE ASSUMED:** That `is_active=false` is a versioning mechanism; that chart edits
  post-hoc are safe (historical legs reference account ids immutably elsewhere).

---

## CONTRADICTIONS AND STALENESS (reported, never silently reconciled)

- **C-1 — C2C beneficiary candidate includes a non-existent actor.** P-DEC-01 §5.4-E:
  "commission beneficiary is agent-side by construction (**initiator and/or claimant agent** —
  split policy question feeding D-C-002)". The implemented claim path (`agent-cash-to-cash-claim.service.ts`)
  is CUSTOMER-side only, and IMPLEMENTATION-02 deliberately keeps the claim ENGINE-FREE
  (documented: no acting agent exists on the claim; initiation is the single commission event).
  A "claimant agent" beneficiary class does not exist in the implementation at all. Resolution
  belongs to Product (D-C-002) — reported here; implementation reality narrows the option space.
- **C-2 — "Pool" misnomer in D-V-006.** P-DEC-01 §10.9 D-V-006 note: "today's code: EXPIRED posts
  no journal — **funds remain in pool** with transfer status EXPIRED". The code's authoritative
  statement is "`CASH_TO_CASH-UNCLAIMED-NGN` liability" (`agent-cash-to-cash-expiry.service.ts:32-33`).
  The unclaimed liability and `AGENT_FUNDING_POOL-NGN` are DISTINCT accounts; reconciliation or
  refund designs based on the "pool" phrasing would target the wrong family.
- **C-3 — Provisioning surface (DP-30 above):** forward "accounts-admin data task" vs
  migration-seeded precedent + single-definition AR provisioner.
- **C-4 — P-DEC-01 §2 S4 row staleness (temporal, recorded):** drafted before
  V1-COMMERCIAL-IMPLEMENTATION-01/02, it says commission/fee "flow calls: absent by design" inside
  the S4 column and dates its capability table with "engine ... not wired (static guard)". The
  engines ARE runtime-invoked today (evidence-only; charge/posting absent). The pack's S5/S6
  verdicts and every decision row remain current and binding; the S4 wording was superseded by
  implementation exactly as H-02A/H-03 were, and is reported as staleness — not a ruling change.
- **C-5 — Capability arithmetic vs treatment honesty:** `PLATFORM_REVENUE_ALLOCATION`'s description
  "Platform revenue = fee − commission − reward" is a **description string**, while B2F03
  ("automatic role selection from the kind alone is prohibited") and the open D-GL-004 fork keep
  the posting presentation unresolved. Reading the capability text as an accounting decision would
  silently collapse S5 policy into S6 treatment. Do not.

---

## PRODUCT MATRIX — unresolved-decision exposure

Columns: fee / fee-revenue / commission / commission-payable / reward / reversal / reconciliation.
● = decision(s) affect this product once that object is enabled. ○ = structurally none for that object.

| Product | fee | fee revenue | commission | comm. payable | reward | reversal | reconciliation |
|---|---|---|---|---|---|---|---|
| WALLET_TRANSFER | ● D-F-001/003/004/005/006, D-M-001 | ● DP-01/02/03/04 | ○ structurally (D-C-001: "or conceptually empty"; PLATFORM-retention only if D-C-009/010 extend) | ● via D-C-010 only | ● D-R-001… | ● D-V-001/002, D-GL-006, DP-15 | ● D-GL-010 |
| WALLET_TO_CASH (agent cash-out) | ● same + D-A-001 | ● same | ● D-C-001…008, reward gate D-C-007/008 | ● DP-05/06/07/12 fork | ● | ● same | ● same |
| CASH_TO_WALLET (agent cash-in) | ● same + D-F-003 physical-cash semantics | ● same | ● same | ● same | ● | ● same | ● same |
| CASH_TO_CASH | ● same (initiation stage) | ● same | ● same + DP-06 initiation-only binding | ● same + DP-13 expiry exposure | ● | ● same + D-V-006 expiry + DP-12 | ● same |
| CUSTOMER_FUNDING | ● D-F-007 (currently "fee = 0 always" — D-D-004) | ● only if fee-bearing | ○ (subject not beneficiary; D-C-010 confirm-NONE) | ○ | ● D-R-003 confirm-NONE | ● approval-reversal machinery exists; D-V-001 | ● |
| AGENT_FUNDING | ● D-F-008 | ● only if fee policy exists for float (oddity per P-DEC-01 §5.6) | ○ (D-C-010 confirm-NONE) | ○ | ● confirm-NONE | ● D-V-001 | ● incl. pool planes D-GL-008 |
| AGENT_DEFUNDING | ● D-F-008 | ● same | ○ | ○ | ● confirm-NONE | ● D-V-001 | ● same |

Cross-note: the audit's per-product matrix (audit §6) confirmed identical live accounting behavior;
this matrix lists the decision exposure only.

---

## BLOCKING SUMMARY (register vocabulary preserved)

**Blocks V1 commercial CONFIGURATION (before any production rule row):** D-F-001/002/003/004/007/008;
D-C-001/002/003/004/005/007/009 (if aggregator participates)/010/011/016 (values `VALUE REQUIRED`);
D-R-001… subset; D-P-001/002/003; D-L-001/002/004/006 + D-D-004/005 (envelope rows, not detailed
here — out of this pack's scope).

**Blocks ENABLEMENT (posting/charging must wait):** D-GL-001/002/003/004/005/006/009/010;
D-C-006/008/012/013/014/015; D-F-005/006; D-V-001…005; D-M-001/002; D-I-001/002; provisioning
(§9-D1/D2/D3/D4/D6/D7).

**Non-blocking today:** D-V-006 (until commercial legs exist vs. expiry), D-GL-007/008 (funding
confirmation + physical reconciliation), D-D-* (D1 funding variants), conditional rows whose parent
is undecided.

## OWNER SUMMARY (exactly as the registers state; no owners invented)

- **Finance:** D-GL-001…006, D-GL-009/010, D-V-002/003/004/005 (with others on several), D-C-013/014/015.
- **Finance(+Legal evidence):** D-GL-002, D-F-005 (the pack's only [TAX] external-evidence rows).
- **Product (+Finance where ledger-shaped):** D-F-001/002/003/004(—)/006(—)/007(—), D-C-001…012 (+owner variants), D-R-*, D-P-*.
- **Product+Finance+Operations:** D-V-001; **Finance+Operations:** D-GL-006, D-C-014 (Treasury);
  **Product+Operations:** D-V-006; **Finance(+Operations):** D-GL-010.
- **OWNER NOT SPECIFIED (this pack's synthesized/derived rows):** DP-04, DP-06, DP-16-partial,
  DP-17, DP-18, DP-19, DP-21, DP-22, DP-23, DP-24 (via governing rows where noted).

## GLOBAL "WHAT MUST NOT BE ASSUMED"

1. Any Naira/percentage/rate anywhere — every value cell is `VALUE REQUIRED` in the source register.
2. Any account code — A5 contract forbids repurposing of existing control/wallet accounts.
3. That REVENUE/EXPENSE creation needs schema (it does not); that provisioning needs a migration
   (M-10 says no; precedent says yes — C-3 open).
4. That contra accounts are creatable today (normal-balance enforcement; B2F03 §18).
5. That `PLATFORM_REVENUE_ALLOCATION`'s arithmetic = treatment decision (C-5).
6. That C2C claim evaluates commission (engine-free by design), or that a claimant-agent
   beneficiary exists (C-1).
7. That expired C2C principal sits in the funding pool (it sits in the unclaimed liability — C-2).
8. That posting and decision can drift today (atomic SERIALIZABLE spine; D-GL-009 governs any
   future posture).
9. That the snapshot is ever authority (evidence-only entity contract — DP-22).
10. Any regulatory/CBN mandate for internal account architecture (none evidenced; VAT rows are
    [TAX-evidence], not existing law in-repo).

---

*End of decision pack. Verification at write time: `git status` shows only this new document;
no `src/`, `test/`, migration, or capability-seed change accompanies it; the base commits
(`055b6a6`, `6d5ce58`) are untouched. Decision entries: DP-01…DP-32 (32 entries), grouped
A(4) B(6) C(5) D(4) E(5) F(4) G(4), plus 5 contradictions/staleness notes (C-1…C-5).*
