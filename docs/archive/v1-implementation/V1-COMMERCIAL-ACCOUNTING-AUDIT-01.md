# V1-COMMERCIAL-ACCOUNTING-AUDIT-01 — Fee Revenue + Commission Accounting Foundation Audit

> **AUDIT ONLY.** No source code modified, no migrations added, no account families created,
> no account codes invented, no runtime behavior changed, no production commercial rates seeded.
> This document reports what the repository actually contains at the audited commit and classifies
> each finding as: **existing technical capability**, **missing technical capability**,
> **accounting/business decision**, **production policy decision**, or **regulatory requirement**
> (only where the repository itself contains authoritative evidence for the regulatory claim —
> it does not for internal account architecture).

---

## 1. Starting commit

`055b6a6f6f6cd2462882779c7929323b05f3b44b` — `feat(commercial): wire commission engine runtime`
(branch `arena/01a0d883-monienaija`, remote-verified via `git ls-remote` at audit time; the local
checkout was refreshed to this exact remote tip before any inspection). Tree clean afterwards; only
this audit document was added.

## 2. Scope

Objective: determine exactly what accounting infrastructure exists for **fee revenue**,
**commission payable**, **commission expense/cost**, **Agent commission settlement**, **platform
revenue recognition**, and **contra/clearing accounts**, and whether the runtime blockers
`FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED` and `COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED`
(recorded on every ALLOCATED/APPLIED commercial decision) are genuine accounting gaps and exactly
what would be required to remove them.

Surfaces inspected: `src/ledger/*` (entities, enums, service invariants, controller, AR-control
provisioner), `src/wallet`, `src/payment` (settlement account service), `src/transfer`,
`src/agent` (cash-in/out, cash-to-cash init/claim/expiry, funding), `src/customer-funding`,
`src/aggregator`, `src/partner/external-settlement.service.ts`, `src/commission`, `src/fee-rules`,
`src/commercial-decision`, `src/capability-registry/capability.seed.ts`, all 76 migration files,
`test/*` journal assertions, and the accounting documentation set (`docs/B2F-*`, `docs/B1-*`,
`docs/A5-*`, `docs/A6-*`, `docs/V1-COMMERCIAL-*`, `docs/V1-COMMISSION-01-*`).

Keyword sweeps executed over `src/`, `src/migrations/`, `test/`, `docs/`:
`FEE_REVENUE`, `REVENUE-`, `EXPENSE-`, `PAYABLE`, `COMMISSION_ACCOUNTING`, `COMMISSION-`,
`AGENT_COMMISSION`, `CLEARING`, `SETTLEMENT`, plus entity-level sweeps for Agent float position,
Aggregator ledger identity, and reconciliation surfaces. Naming was not assumed — findings are from
actual code/migrations/docs.

## 3. Existing ledger/account architecture

### 3.1 Core schema (existing technical capability)

- **`ledger_accounts`** (`src/ledger/ledger-account.entity.ts`): unique `code` (100 chars), `name`,
  `accountType` ∈ `{ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE}` (`ledger.enums.ts`), `normalBalance`
  ∈ `{DEBIT, CREDIT}`, `currency`, `accountingUnit` (varchar, default `'CUSTOMER_FUNDS'`),
  `allowNegativeBalance`, `isActive`. **`REVENUE` and `EXPENSE` types exist in the schema** — the
  family-hosting capacity is real and requires no migration.
- **Normal-balance enforcement** (`ledger.service.ts:659`): `ASSET`/`EXPENSE` → DEBIT-normal,
  `LIABILITY`/`EQUITY`/`REVENUE` → CREDIT-normal; `createAccount` rejects any other pairing. A
  contra account (opposite normal balance of its class) is therefore **not creatable** — the B2F
  chart contract confirms: *"ordinary contra accounts with opposite normal balance are not supported
  by the current A5 creation contract"* (`docs/B2F-CHART-CLASSIFICATION-CONTRACT.md` §18; contra
  `ACTIVE` mappings prohibited pending an approved design).
- **`ledger_journals`**: POSTED-only status, unique idempotency key, balanced-line enforcement in
  `LedgerService`, reversal support (`reversalOfJournalId`), JSONB metadata.
- **`ledger_lines`**: `amount_minor > 0` CHECK, BIGINT, unique `(journal, lineNumber)`.
- Journals are created only inside the flows' existing SERIALIZABLE transactions via
  `LedgerService.postJournal(In Transaction)` — the atomic spine every commercial leg would inherit.

### 3.2 Accounts that actually exist in production data (migration-seeded)

| Code | Type | Normal | Seed | Economic role |
|---|---|---|---|---|
| `PAYMENT-SETTLEMENT_ASSET-NGN` | ASSET | DEBIT | `1785753600002-CreatePaymentCapabilities` | External-funding liquidity control (debited by CUSTOMER_FUNDING) |
| `PAYMENT-SETTLEMENT_CLEARING-NGN` | ASSET | DEBIT | same | Settlement **clearing** account — the only CLEARING-family account in the chart |
| `PAYMENT-SYSTEM_SUSPENSE-NGN` | LIABILITY | CREDIT (neg. allowed) | same | System suspense (A6 settlement/suspense/exception boundary) |
| `CASH_TO_CASH-UNCLAIMED-NGN` | LIABILITY | CREDIT | `1785753600057-CreateCashToCashTransfers` | Unclaimed Cash→Cash principal liability |
| `AGENT_FUNDING_POOL-NGN` | LIABILITY | CREDIT (neg. allowed) | `1785753600061-CreateAgentFundingPool` | Platform float pool for Agent funding/defunding |

### 3.3 Accounts created at runtime

- **Per-wallet accounts**: `WALLET-{walletId}` (LIABILITY, CUSTOMER_FUNDS) — one per customer/agent
  wallet (`src/wallet/wallet.service.ts:112`). Agent wallets are the same family: **agents have a
  ledger account today (their wallet) — the credit destination for any future wallet-credited
  commission settlement already exists.**
- **AR control provisioning** (`src/ledger/ar-control-account-provisioning.service.ts`): a
  privileged-action-gated provisioner whose `AUTHORIZED` definition is hardcoded to exactly one
  account — `FINANCE-ACCOUNTS_RECEIVABLE-NGN` (ASSET/DEBIT), with B2F finance-control verification,
  idempotency, audit. It cannot provision anything else without new authorized code.
- **Admin surface**: `POST /ledger/accounts` (`ledger.controller.ts:22`) → raw
  `LedgerService.createAccount` — consensus-able but carries none of the AR path's
  privileged-approval + finance-control evidence.
- **Settlement role lookup**: `SettlementAccountService` resolves only the three `PAYMENT-*` roles
  (`src/payment/settlement-account.service.ts`) — a role-resolution pattern, not an open family.

### 3.4 Documented chart/classification model (B2F, all `UNMAPPED`)

`docs/B2F-CHART-CLASSIFICATION-CONTRACT.md` defines Finance **roles** with A5-mapping status
`UNMAPPED`: revenue incl. `finance.revenue.fee` (OPERATING_REVENUE, source = B1 FEE decision) and
`finance.revenue.commission`; expense incl. `finance.expense.commission` (COST_OF_REVENUE);
liabilities `finance.liability.customer-funds`, `finance.liability.settlement-suspense` and
**reserved-unmapped** `finance.liability.commission-payable`, `finance.liability.revenue-share-payable`,
`finance.liability.tax-payable`, `finance.liability.accounts-payable`. It states verbatim:
*"No concrete A5 revenue account was verified"* and *"No concrete A5 expense account was verified"*;
*"A B1 decision kind does not determine the debit/credit accounts by itself. Commission or
revenue-sharing may represent revenue, expense, or payable depending on approved commercial
context. Automatic role selection from the kind alone is prohibited."*

## 4. Fee accounting findings (Question A)

**A: The ledger does NOT contain a suitable account family for fee revenue. The
`FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED` blocker is a genuine architectural/accounting gap.**

Evidence chain:

1. **Zero coded accounts**: exhaustive sweeps find no `FEE_REVENUE-*`, `REVENUE-*` (account-code
   pattern), or any REVENUE/EXPENSE-typed account rows in migrations or runtime code. The only
   `FEE_REVENUE` identifier in the codebase IS the blocker string itself
   (`src/fee-rules/fee-rule-calculator.service.ts:40,129`,
   `src/commercial-decision/commercial-decision.defaults.ts`).
2. **PRIOR audits agree**: `docs/V1-COMMERCIAL-IMPLEMENTATION-AUDIT.md` §14 lists
   `FEE-REVENUE … MISSING — BLOCKED BY POLICY … §9-D3; provisioning follows the AR-control data
   pattern — codes come from Finance, none invented here`; B2F03 marks `finance.revenue.fee`
   `UNMAPPED`.
3. **No existing account is suitable**:
   - `PAYMENT-SETTLEMENT_ASSET-NGN` is an ASSET liquidity control for external funding — wrong
     class to hold earned revenue.
   - `WALLET-*` are per-customer/agent LIABILITY accounts — platform revenue cannot live there.
   - Clearing/suspense/unclaimed accounts are transitional, not recognition destinations.
   - `ACCOUNT_TYPE = REVENUE` exists but is uninstantiated; a fee-revenue family needs REVENUE-type,
     CREDIT-normal accounts whose **granularity is itself an open decision** (see D-GL-001, §11).
4. **What removal requires**: an approved Finance chart decision (product-level vs single pooled
   REVENUE account — D-GL-001), recognition timing (D-GL-003; transaction-completion is the natural
   fit with the atomic journals), VAT treatment if fees are VAT-bearing (D-GL-002 + a VAT-payable
   family — also absent), then **data provisioning §9-D3** (no migration needed — M-10) and journal
   leg composition inside the existing SERIALIZABLE flow transactions.

## 5. Commission accounting findings (Questions B, C)

**B: The ledger does NOT contain a commission-payable family. The
`COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED` blocker is genuine.**

- No `COMMISSION-*`/`*PAYABLE` account code exists anywhere (migrations/runtime/tests only carry
  the blocker strings and the B2F role names).
- `finance.liability.commission-payable` is **reserved but unmapped** in the B2F chart contract §16 —
  the *missing accounting concept* is a **third-party-payable liability** (platform owes the agent
  an earned commission until settled). Today agents hold only a `WALLET-*` liability balance; a
  distinct payable is not representable without a new family (or a deliberate netting decision —
  see C).
- Every ALLOCATED decision already records this truthfully: `payable:false`, `payableBlockers:
  [FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED, COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED]`,
  `posting:{journalLegsPosted:false, reason:COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED}`.

**C: Whether a separate commission EXPENSE account is required is an ACCOUNTING/BUSINESS
DECISION — the repository deliberately leaves it open; this audit does not resolve it.**

The repo's own decision register already poses the exact question with all options documented and
none chosen — **D-GL-004** (`docs/V1-COMMERCIAL-POLICY-DECISION-PACK.md` §8):
(a) commission as **EXPENSE + PAYABLE liability pair** (recognize expense at completion, settle
later), (b) **immediate wallet credit netting the expense** against the fee-revenue credit (no
standing payable), (c) **PLATFORM recipient as contra-REVENUE vs EXPENSE**. Owner: Finance;
"Blocks enablement". Co-gated by **D-C-015** (immediate-payable vs accrue-then-settle cadence) and
**D-C-014** (settlement rail — payout execution is V2 scope per the A18 boundary). The B2F chart
gives the classification homes for either answer (`finance.expense.commission` under
COST_OF_REVENUE; `finance.liability.commission-payable`) while explicitly prohibiting choosing a
debit/credit role from the rule kind alone. Note the technical constraint from §3.1: a
contra-REVENUE presentation (option c) is **not creatable** under current normal-balance
enforcement against a REVENUE class (B2F03 §18 marks contra runtime `NOT VERIFIED / REQUIRES
REVIEW`), so option (c) additionally requires an approved A5 contra design.

## 6. Product-by-product accounting matrix (Question E)

All journals below are actual, live behavior verified at the audited commit. "Fee decision?"
= the IMPLEMENTATION-01 fee engine evaluates and records a decision at that site. "Agent commission
event?" = the IMPLEMENTATION-02 engine is invoked with acting-agent context at that site.
"Capable of" rows describe machinery + existing account destinations, not current posting (none —
the families are missing).

| Product | Current journal (live) | Fee decision? | Agent commission event? | Can generate customer fee | Can generate fee revenue | Can generate Agent commission | Can generate commission payable |
|---|---|---|---|---|---|---|---|
| WALLET_TRANSFER | D `WALLET-src` (LIAB) → C `WALLET-dst` (LIAB) | YES (APPLIED/ZERO/NOT_CONFIGURED evidence) | Engine invoked with **null agent** context | YES (machine) | ONLY after FEE-REVENUE family provisioned | **Structurally none** — no agent participant (D-C-001: "does W→W generate commission at all?" open; range 5.1: allocation would be PLATFORM-retained "or conceptually empty") | No — needs payable family + D-C-001/D-C-010 |
| CASH_TO_WALLET (agent cash-in) | D agent `WALLET-*` → C customer `WALLET-*` | YES (customer-side fee semantics open: physical-cash payer semantics D-F-003/D-F-006) | YES — acting Agent **is** the beneficiary (beneficiaryId filled) | YES (machine; presentation policy open) | ONLY after family | YES — evidence-only ALLOCATED today | ONLY after D-GL-004 + D-C-015 choose payable vs netting |
| WALLET_TO_CASH (agent cash-out) | D customer `WALLET-*` → C agent `WALLET-*` | YES | YES — acting Agent beneficiary | YES (machine) | ONLY after family | YES — evidence-only today | Same dependency |
| CASH_TO_CASH initiation | D agent `WALLET-*` → C `CASH_TO_CASH-UNCLAIMED-NGN` | YES | YES — the **single** commission event (`CASH_TO_CASH_INITIATION`) | YES (machine) | ONLY after family | YES — evidence-only today | Same dependency |
| CASH_TO_CASH claim | D `CASH_TO_CASH-UNCLAIMED-NGN` → C customer `WALLET-*` | Becomes part of the same transfer's evidence (claim snapshot carries NONE) | **NO — deliberately engine-free** (structural double-pay prevention; commission-01 test 02, runtime-wiring test 22) | NO (decision made at initiation) | NO (NL— belongs to initiation) | NO by design | NO by design |
| CUSTOMER_FUNDING (approve) | D `PAYMENT-SETTLEMENT_ASSET-NGN` → C customer `WALLET-*` | YES (currently NOT_CONFIGURED = FREE by policy; any fee = D-D-004/D-F-007 decision) | NO agent context (funded customer is SUBJECT, not beneficiary) | Only if funding-fee policy admitted (D-F-007) | ONLY after family + those decisions | NO by current design (subject ≠ beneficiary; D-C-010 confirm-NONE) | NO |
| AGENT_FUNDING | D `AGENT_FUNDING_POOL-NGN` → C agent `WALLET-*` | YES (currently NOT_CONFIGURED = FREE) | NO agent context (funded agent is SUBJECT) | Only if float-fee policy admitted (D-F-008; called a "pricing-policy oddity" in P-DEC-01) | ONLY after family + that decision | NO by current design (D-C-010 confirm-NONE) | NO |
| AGENT_DEFUNDING | D agent `WALLET-*` → C `AGENT_FUNDING_POOL-NGN` | YES (FREE) | NO | Same D-F-008 framing | ONLY after family | NO | NO |

Aggregate: **fee revenue** requires the family for any product; **Agent commission** is economically
possible only on the three agent-mediated flows (C2W/W2C/C2C-initiation); **commission payable**
requires both the family and the D-GL-004/D-C-015/D-C-014 treatment chain.

## 7. Agent commission lifecycle (Question D — conceptual map only; NOT implemented)

Mapped strictly from the repo's documented decision options; every hop names its gate:

```
 [1] customer fee             fee decision exists TODAY (evidence; charged amount '0')
       │  gates: D-F-001…006 (rates/payer/VAT), §9-D1 (charge wiring when approved)
       ▼
 [2] platform fee revenue      recognition at transaction completion is the natural fit (D-GL-003-a)
       │  gates: D-GL-001 (product-level vs pooled REVENUE family), D-GL-002 (VAT legs/family),
       │        §9-D3 (provision), then fee journal legs added inside the flow's SERIALIZABLE tx
       ▼
 [3] Agent commission          entitlement EXISTS TODAY as evidence: ALLOCATED allocations on
     entitlement                W2C/C2W/C2C-initiation (beneficiaryId = acting agent, rule identity/
       │                        version captured; payable=false; blockers recorded)
       │  gates: production rate policy (D-C-001…008 — rates/bases/class/individual stances),
       │        runtime already supplies agent+class context; aggregator context never supplied
       ▼
 [4] payable / settlement      THE open accounting fork (D-GL-004 + D-C-015):
     recognition               (a) DR commission-expense ↔ CR commission-payable (accrue; settle later)
                               (b) immediate: DR commission-expense ↔ CR agent WALLET-* at completion
                                   (wallet credit = netting against the same tx's fee-revenue credit)
                               (c) contra-REVENUE for PLATFORM-share presentation (needs contra design;
                                   current normal-balance enforcement blocks plain contra accounts)
       │  agent wallet destination EXISTS today (per-agent WALLET-* LIABILITY) — the settlement
       │  destination for option (b) is already provisioned infrastructure
       ▼
 [5] eventual Agent settlement (a)-path: settle the payable to the agent wallet (or V2 payout rail
                               per D-C-014 — cash disbursal is V2 scope); (b)-path: nothing further —
                               the wallet liability IS the settlement; pool/float reconciliation
                               unchanged (pool movement is funding, not commission)
```

Support machinery already present for whatever is chosen: balanced SERIALIZABLE journals,
idempotency, reversal journals (with snapshot supersedes for corrections — D-GL-006/D-V-001 open
process), immutable commercial-decision snapshots carrying rule identity/version for every leg
audit, and the `revenue_decision` snapshot section (currently `null` in all flows; vocabulary
NONE|RETAINED exists — the platform-retention value is recorded nowhere yet).

## 8. Cash→Cash accounting boundary (Question F)

**Confirmed: commission remains economically associated with the INITIATION event, and the claim
affects only the unclaimed-principal clearing — never the commission. No runtime change needed or
made.** Live posting behavior:

| Stage | Journal | Commission accounting |
|---|---|---|
| Initiation | D agent wallet → C `CASH_TO_CASH-UNCLAIMED-NGN` (principal only) | The single economic commission event (`commissionEvent: 'CASH_TO_CASH_INITIATION'` on the evidence). Any future fee/commission legs attach HERE, inside the initiation SERIALIZABLE tx |
| Claim | D `CASH_TO_CASH-UNCLAIMED-NGN` → C customer wallet (principal only) | **Engine-free by design**; claim snapshot records `commissionNone()` — no re-evaluation, no second allocation ever (verified: exactly ONE allocation across both snapshots) |
| Expiry (A17) | **NO journal** — status flip `UNCLAIMED→EXPIRED` only; principal REMAINS in the unclaimed liability; no automatic Agent refund (`agent-cash-to-cash-expiry.service.ts:32`) | Any fee/commission leg effects of an expired transfer are UNRESOLVED — reversal treatment is decision **D-V-003** (commission reversal on reversed/failed underlying) + **D-V-001** (reversal ops workflow); no automatic refund exists, and the unclaimed liability carries expired funds until an ops process exists |

## 9. Aggregator accounting dependency (Question G)

**Aggregators have NO accounting identity — this is a separate, already-documented dependency, and
no Aggregator ledger identity was invented by this audit.**

- Entity truth (`src/aggregator/aggregator.entity.ts:25-27`): *"Aggregator has NO wallet, NO ledger
  balance, NO funding. It is a corporate identity… ownership/accounting explicitly; A18 does not
  invent a ledger account."*
- Funding-via-aggregator routes (`POST /internal/aggregators/:agg/agents/:id/fund|defund`) move
  only pool ↔ agent wallet; `aggregatorId` is recorded as relationship attribution on the funding
  operation, never as an account.
- Commission-wise: the rule schema supports AGGREGATOR-recipient/aggregator-targeted rules, but the
  runtime NEVER supplies `aggregatorId` context (IMPLEMENTATION-02, deliberate) — such rules cannot
  match today; capability `AGGREGATOR_COMMISSION` is PLANNED/PRODUCT_DECISION-blocked; no
  allocation could be settled even if matched (no account destination).
- The register carries the unresolved design decision: **D-C-009** (aggregator participation) +
  **§9-D4** (crediting design): (a) per-aggregator ledger-account identity provisioned per §9-D3
  with legs at allocation time, or (b) off-ledger accrual evidence in snapshots, crediting deferred
  to the V2 payout rail. "No decision exists; nothing may be provisioned."

## 10. Exact blockers

| Blocker (as recorded at runtime) | Genuine? | What exactly is missing | Removal requires |
|---|---|---|---|
| `FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED` | **YES — genuine accounting/architecture gap** | A REVENUE-type, CREDIT-normal fee-revenue account family (granularity undecided — D-GL-001); no suitable existing account (all current ASSET accounts are settlement/liquidity/AR controls; all LIABILITY accounts are customer/agent funds + transitional liabilities); no approved chart mapping (`finance.revenue.fee` UNMAPPED); no VAT-payable family either (D-GL-002) | D-GL-001 + D-GL-003 (+ D-GL-002/D-F-005 if VAT), then §9-D3 provisioning (data task, no migration), then journal-leg composition inside the flows' existing SERIALIZABLE transactions |
| `COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED` | **YES — genuine accounting/architecture gap** | The treatment is unresolved BEFORE a family can even be named: commission-EXPENSE vs netting vs contra-revenue (D-GL-004); payable liability family (reserved-unmapped `finance.liability.commission-payable`); PLATFORM-retained destination (D-C-010); the payable cadence (D-C-015) and settlement rail (D-C-014, V2) | D-GL-004 (+D-C-015/D-C-014/D-C-010) decision, then §9-D3 provisioning of the chosen families (expense + payable, per approved codes), then leg composition; FEE-REVENUE prerequisite stands when basis = FEE |

Second-order blockers surfaced by the audit (not runtime strings, but equal gates):
**aggregator credit destination absent** (D-C-009/§9-D4); **reward families absent** (D-GL-005 —
out of this audit's scope but in the same §9-D3 dependency); **reversal families/ops workflow**
(D-V-001/D-V-003, D-GL-006); **decision-recorded-but-posting-failed semantics** (D-GL-009 —
currently whole-tx rollback with no snapshot); **reconciliation break rules for commercial objects**
(D-GL-010 — current reconciliation covers ledger/wallet/transfer/pool planes only).

## 11. Accounting decisions still required (all already registered; none decided; none invented here)

Accounting/chart treatment (Finance-owned):
- **D-GL-001** fee-revenue granularity (per-product REVENUE accounts vs single pooled + metadata)
- **D-GL-002** VAT treatment (separate tax-payable leg vs embedded-in-revenue vs no-VAT; needs the
  D-F-005 rate answer first; jurisdictional tax evidence — the repository's only regulator-adjacent
  input, recorded as *required evidence*, not as an asserted CBN/tax rule)
- **D-GL-003** fee recognition timing (completion vs deferred — completion is documented as the
  natural fit)
- **D-GL-004** commission expense/payable family + PLATFORM-retained mapping (the C-question fork)
- **D-GL-006** reversal/correction treatment; **D-GL-009** decision-recorded-but-posting-failed;
  **D-GL-010** commercial-object reconciliation expectations; **D-GL-007** funding-source account
  continuation (currently single settlement-asset — non-blocking)

Commercial policy co-gates (production-policy decisions):
- **D-C-001** does W→W generate commission at all; **D-C-002** beneficiary per product;
  **D-C-003** commission basis (PRINCIPAL/FEE/NET); **D-C-007/D-C-008** class variation /
  individual overrides; **D-C-009** aggregator participation (+§9-D4); **D-C-010** PLATFORM-retained
  / funding-flows NONE confirmation; **D-C-014** settlement rail (V2); **D-C-015** immediate vs
  accrued cadence; **D-F-007/D-F-008** fees on funding products; **D-F-003/D-F-006** payer/display
  semantics; **D-V-001/D-V-003** reversal workflow + commission reversal on failed underlying.

Classification in the task's own vocabulary: items under D-GL are **accounting/business
decisions**; items under D-C/D-F/D-V are **production policy decisions**; **no regulatory
requirement** is claimed for any internal account architecture in this document because the
repository contains no authoritative citation for one (the VAT row requires *external* tax/jurisdiction
evidence before a leg design can be approved — reported, not assumed).

## 12. Technical implementation dependencies (existing vs missing capability)

**Existing technical capability (usable as-is):** REVENUE/EXPENSE account types; unique-code chart;
balanced SERIALIZABLE journal posting with idempotency; reversal journals; per-wallet agent
accounts (settlement destination for netted commission exists); settlement account role resolution
pattern; immutable decision snapshots with rule identity/version (evidence for every future leg);
privileged-action + finance-control provisioning PRECISELY ONE fixed account (AR-control pattern —
`FINANCE-ACCOUNTS_RECEIVABLE-NGN`); `POST /ledger/accounts` admin surface.

**Missing technical capability (must be built, after decisions):**
1. **§9-D3 commercial account-family provisioning** — a data task on the AR-control precedent
   (authorized definition per approved family + finance-control verification + audit), NOT a
   migration (M-10). Note (documentation tension, reported not resolved): M-10's "no migration
   required / uses existing accounts-admin surface" describes the forward pattern, while the five
   control accounts that exist today were in fact seeded by migrations 0002/0057/0061 and no
   arbitrary-family provisioner carrying the AR path's approval evidence exists yet.
2. **Journal-leg composition** for fee/commission legs inside the existing flow transactions
   (§9-D1 for fee charge legs; §9-D6 for commission/reward legs) — invariant-tested composition
   only; resolution already in-tx.
3. **Contra-account design** (only if D-GL-004 selects option (c)) — A5-compatible design decision;
   normal-balance enforcement currently prohibits contra instances.
4. **§9-D4 aggregator crediting design** (conditional on D-C-009).
5. **Reversal ops/workflow + families** (D-V-001…003 / D-GL-006) — the ledger supports reversal
   legs structurally; the process does not exist.
6. **Reconciliation break monitors for commercial objects** (D-GL-010) — reporting/runbook work on
   the existing reconciliation planes (repeatable-read reconciliation service exists, A6 boundary).
7. **Optional platform-retention recording** — `revenue_decision` snapshot section exists but is
   `null` everywhere; no retention engine exists (capability `PLATFORM_REVENUE_ALLOCATION` PLANNED:
   "Platform revenue = fee − commission − reward", pending its own decision).

## 13. Explicit non-goals

This audit does NOT: prescribe rates or any commercial amounts; invent/propose account codes or a
chart of accounts; implement/prototype provisioning or posting; change fee or commission runtime
behavior; create migrations; seed or modify production commercial configuration; resolve any open
D-*/D-GL-* decision; claim CBN or any regulator mandates for internal ledger architecture (none
are evidenced in the repository; only the VAT row records *future* jurisdictional evidence as an
input to D-GL-002/D-F-005); or alter the already-pushed base commit. Nothing beyond this document
has been added.

## 14. Recommended dependency order for implementation (sequence only — every step still needs its decision)

1. **D-GL-003 + D-GL-001 (+ D-F-005/D-GL-002 if VAT-bearing)** — recognition timing, fee-revenue
   granularity, VAT stance. Everything else keys off these.
2. **D-GL-004 + D-C-015 (+ D-C-010)** — commission treatment fork (expense+payable vs wallet
   netting vs contra) and cadence; decides WHICH families §9-D3 must provision.
3. **§9-D3 provisioning** — with step 1–2 answers, provision the approved families via the
   AR-control precedent as a DATA task (governance-verified definitions; no migration).
4. **Fee enablement residue** — D-F-001…004 rate policy, then fee charge legs (§9-D1) + disclosure
   (D-I); only now do nonzero FEE-basis commission decisions have collected bases.
5. **Commission posting** — production rule policy (D-C-001…008), then leg composition (§9-D6)
   behind the existing gated-pilot precedent; wallets as settlement destinations if netting chosen.
6. **PLATFORM retention** (D-C-010) — destination legs + optional `revenue_decision` recording.
7. **Aggregator** (D-C-009 → §9-D4) — only if aggregator participation is approved: account
   identity vs off-ledger accrual; payout remains V2 (D-C-014).
8. **Reversal + failure semantics** (D-V-001/003, D-GL-006/009) — required before commercial objects
   can be corrected/expired safely (C2C expiry depends on it, §8).
9. **Reconciliation + runbooks** (D-GL-010) — break monitoring dimensions on the provisioned
   families before any production enablement.

---

*End of audit. Repository left byte-identical except for this file. Verified: `git status` shows
only `docs/V1-COMMERCIAL-ACCOUNTING-AUDIT-01.md` added; no source or migration changes; the base
commit `055b6a6` untouched.*
