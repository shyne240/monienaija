# V1-COMMISSION-01 — Commission Engine Architecture (Foundation)

**Status:** foundation implemented; **NOT runtime-enabled, NOT configured.** Zero production
commission rules exist. No commission is charged, no commission ledger entry is posted, and all
seven V1 financial flows keep recording `commission = NONE` exactly as before. This document is
the architecture contract for the configurable machinery plus the explicit ledger of UNRESOLVED
product/accounting policy decisions that must be decided before any enablement.

---

## 1. Boundary and purpose

The Commission Engine foundation makes future MonieNaija commission policy *recordable,
resolvable, and explainable* without inventing any of it:

- **Not implemented here:** actual rates, recipients' allocation policy, eligibility policy,
  precedence hierarchy, effective-date policy, charging, ledger postings, settlement mechanics,
  reward/cashback, fee charging, VAT/tax policy, V2 products, bank/provider integrations.
- **Explicitly not done:** no retroactive calculation for existing transactions; historical
  transactions remain exactly as recorded (commission NONE).

Commission is a **distinct commercial concept** from customer fee, platform revenue,
reward/cashback and principal. The architecture never models or assumes a relationship between
them: a rule only describes *one recipient's* mechanics against an explicitly-named base.

## 2. Existing primitives reused (no duplicates)

| Need | Existing primitive extended/reused | Not created |
| --- | --- | --- |
| Product identity | `products.code` (V1-COMMERCIAL-02) via FK RESTRICT | no second product-code system |
| Rule registry discipline | `fee_rules` conventions (V1-COMMERCIAL-03): bps over 10_000, effective window, priority, optimistic version, soft delete, audited workforce admin | no new registry mechanism |
| Decision explainability | `commercial_decision_snapshots.commission_decision` JSONB (`NONE`/`ALLOCATED`, allocations with `beneficiaryType/beneficiaryId/amountMinor/currency/basis/ruleId/ruleVersion`) | no snapshot schema change |
| Commercial classes | `agent_classes`, `agents`, `aggregators` (A18/A19) via FK RESTRICT | no new participant taxonomy |
| AuthZ surface | workforce `RoutePolicyRegistry` (`/api/v1/internal/commission-rules`) | no new auth mechanism |
| Money math | `parseMinorUnits`/bigint minor units/`MAX_POSTGRES_BIGINT` (src/common/money), FeeEngine floor-division and clamp order | no new money convention |
| Capability tracking | existing `COMMISSION_ENGINE` capability entry (advanced honestly) | no new capability mechanism |

Ledger architecture (`ledger_accounts` + double-entry `ledger_journals`/`ledger_lines`) is used
today for principalflows only. **No commission ledger accounts exist yet** — see §9/§10.

## 3. Rule model (`commission_rules`, migration `CreateCommissionRules1785753600073`)

| Field | Meaning |
| --- | --- |
| `product_code` | FK → `products.code` (authoritative product; exact-match target) |
| `currency` | ISO-3 uppercase; exact-match (NGN today, conversions never implied) |
| `recipient_type` | `AGENT` / `AGGREGATOR` / `PLATFORM` — one rule pays one recipient |
| `calculation_model` | `FIXED`, `PERCENTAGE`, `PERCENTAGE_MIN`, `PERCENTAGE_MAX`, `PERCENTAGE_MIN_MAX`, `FLAT_PLUS_PERCENTAGE`, `TIERED` |
| `calculation_basis` | `PRINCIPAL`, `FEE`, `NET` — explicit, never defaulted |
| `flat_commission_minor`, `percentage_bps`, `minimum_commission_minor`, `maximum_commission_minor`, `tiers` | parameters; DB CHECK `chk_commission_rules_model_params` pins which columns each model may set; unused params must be NULL |
| `agent_class_id` / `agent_id` / `aggregator_id` | nullable targeting FKs; **at most one** set per rule (`chk_commission_rules_target_single`) — single-dimensional targeting keeps overlaps legible while precedence policy is undecided |
| `effective_from`, `effective_to` | window `[from, to)`; `to` NULL = open-ended (same convention as fee/limit resolvers) |
| `priority` | deterministic precedence input (see §8); default 0 |
| `is_active`, `created_by`, `updated_by`, `version`, `created_at`, `updated_at`, `deleted_at` | activation flag, audit metadata, optimistic locking, soft delete (no DELETE anywhere) |

Identity uniqueness (live rows only):
`(product_code, currency, recipient_type, agent_class_id?, agent_id?, aggregator_id?, effective_from)`
with NULL targeting folded to the zero UUID — one rule per exact identity+window start.

**TIERED representation:** `tiers` JSONB marginal brackets `[{upToMinor, bps?, flatMinor?}]`,
ascending from 0 (`[0, upToMinorᵢ)` slices), only the last bracket may be open-ended. Marginal
application means the base spills *through* brackets; a bracket's `flatMinor` accrues once if the
base reaches the bracket at all. Chosen default semantics: **marginal/progressive slicing** —
brackets are not whole-base thresholds. (Documented as mechanics; alternative whole-bracket
semantics remain a policy choice if ever needed.)

**Extension path:** new models/bases are additive columns/enum values; the financial transaction
model never changes.

## 4. Calculation mechanics (deterministic, no policy)

`CommissionCalculator` (pure) applies, per model:

| Model | Amount (bigint minor units, floor division by 10 000 bps) |
| --- | --- |
| FIXED | `flat` |
| PERCENTAGE | `⌊base × bps / 10 000⌋` |
| PERCENTAGE_MIN | `max(raw, min)` |
| PERCENTAGE_MAX | `min(raw, max)` |
| PERCENTAGE_MIN_MAX | `min(max(raw, min), max)` — min applied first (FeeEngine clamp order) |
| FLAT_PLUS_PERCENTAGE | `flat + ⌊base × bps / 10 000⌋` |
| TIERED | per bracket: `flatᵢ (if base reaches bracket) + ⌊sliceᵢ × bpsᵢ / 10 000⌋`, then summed |

Bases: `PRINCIPAL` = transaction principal; `FEE` = caller-supplied fee evidence; `NET` =
`principal − fee` (requires fee evidence). **If a resolved rule's basis needs fee evidence and
none exists → fail closed** (`COMMISSION_BASE_UNAVAILABLE`); a configured rule is never silently
skipped, and fee values are never fabricated. Structural incoherence in a TIERED ladder fails
closed at write time (registry validation reuses the calculator's checker) and at calculation time.

## 5. Recipient / allocation model

- One rule = one `recipient_type`. Multi-recipient allocations arise from *multiple co-applicable
  rules*, one winner per recipient group (AGENT, AGGREGATOR, PLATFORM).
- `recipientId` is captured when the rule targets a specific agent/aggregator; otherwise it stays
  **NULL at rule level** — the future wiring task binds the rule to the transaction's actual
  agent/aggregator/platform identities (flows already know their principals).
- **No split percentages exist anywhere** in code or schema (no 60/20/20, ever). Independent
  amounts per recipient are first-class (verified: Agent = percentage amount, Aggregator = fixed
  amount, Platform = a different unrelated fixed amount side by side).

## 6. Eligibility / targeting

- Rule-level targeting: product (exact), currency (exact), and at most one of:
  agent-class, agent, aggregator. Untargeted rules apply product-wide.
- Resolution context supplies agent id/class and aggregator id from the transaction's own
  identities (mirroring how the flows already carry their principals).
- Customer/KYC/segment targeting is deliberately **not modelled**: no authoritative customer-tier
  primitive exists in V1 commercial scope; inventing one would violate the "no invented vocabulary"
  constraint. If policy later requires it, it lands as additive nullable targeting columns.
- All eligibility logic lives in rule rows + the resolver — never scattered through flows.

## 7. Effective dates / versioning / history

- Window matching `effective_from <= at < effective_to`; open-ended when `effective_to` NULL.
- Historical resolution: `resolve(context, at)` is first-class — the same deterministic answer the
  flow would have seen at `at` (given the current registry content, which is itself versioned +
  audited; rule *parameters* are mutable-with-version, so historical explainability of a captured
  decision comes from the **snapshot's recorded ruleId + ruleVersion + effective values**, never
  from replaying mutable registry state).
- Updates are optimistic-lock version-checked (`version` predicate in the UPDATE), audited
  (previous/new values in `audit_events`), and never delete rows (deactivate/end instead).
- Registry administration is workforce-only (`GET/POST/PATCH /api/v1/internal/commission-rules`,
  no DELETE), plus a read-only resolution diagnostic `GET /api/v1/internal/commission-rules/resolve`.

## 8. Precedence (explicit, minimal, NON-policy)

- Per recipient type, among applicable rules: **highest `priority` wins**.
- **Equal highest priority ⇒ explicit failure** `COMMISSION_RULE_AMBIGUOUS` (409) listing the
  conflicting rule ids — no silent choice (mirrors FEE_RULE_RESOLVER AMBIGUOUS behaviour).
- Scope hierarchy (agent-specific vs agent-class vs product-wide; agent-class vs aggregator) is
  deliberately **NOT hardcoded** — until business decides, overlapping scopes must be
  disambiguated through explicit priorities. This is unresolved policy (register item 11).
- Tie-break across recipient types is unnecessary by construction (groups resolve independently).

## 9. Commercial Decision Snapshot integration

- The engine produces the **exact shape** `commission_decision` already supports:
  `status NONE` ⇔ `commissionNone()` (byte-identical to every current V1 flow), or
  `status ALLOCATED` with allocations carrying `beneficiaryType, beneficiaryId, amountMinor,
  currency, basis, ruleId, ruleVersion` plus extended explainability keys
  (`calculationModel, calculationParameters, baseAmountMinor, priority, effectiveFrom, targeting`)
  — all inside the open JSONB document. `ruleRefs` carry `{ruleId, ruleVersion, ruleType}`.
- Snapshot immutability is untouched: decisions are recorded before commit by the (future) flow
  integration inside the existing SERIALIZABLE boundary; historical snapshots are never modified.
- The future wiring pattern is `decideWithManager(manager, context, baseEvidence)` inside the
  flow's existing transaction — same discipline as `recordDecisionWithManager` in the flows today.

## 10. Ledger / accounting considerations (analysis only — nothing created)

Current chart of accounts (migration seeds) includes operating accounts such as
`AGENT_FUNDING_POOL-NGN`, `CASH_TO_CASH-UNCLAIMED-NGN`, settlement clearing/suspense accounts —
all of type ASSET/LIABILITY with purpose codes. **No commission-related accounts exist.**

Accounting model requirements for future commission postings (documented, not implemented):
1. **Commission payable** — a LIABILITY account family (amounts owed to agents/aggregators until
   settlement). Distinct from customer-funds liability: payable to partners, not customers.
   Whether one account per currency or per-recipient accounts is required is an accounting decision.
2. **Commission expense** — an EXPENSE account (platform's cost of distribution) OR the
   contra-revenue treatment (deduction from FEE/revenue) — policy choice (register items 13–15).
3. **Platform retained revenue** — REVENUE account for the platform's retained portion once fees
   exist; today `revenue_decision` stays NULL and no revenue accounts exist.
4. **Settlement/payout** — the eventual debit of commission payable (cash/bank/settlement rails).
   Settlement mechanism (batch payout, wallet credit, netting against agent obligations) is an
   unresolved product/treasury decision (register item 14).
5. No accounts are created by this task: the A18 financial boundary explicitly forbids inventing
   aggregator balances/ledger accounts, and committing chart-of-account entries without an
   accounting decision would itself be a policy act.

## 11. Runtime status

- `CommissionModule` is registered (registry + resolver + calculator + engine providers).
- **No financial flow imports or calls the engine.** Verified in tests: the seven flow services
  contain no `CommissionEngine`/`commission_rules` reference, all tables stay free of commission
  side effects, and an empty registry produces the identical NONE shape flows write today.
- Capability `COMMISSION_ENGINE` advanced honestly (backend implemented, no direct API surface,
  disabled, NOT_CONFIGURED, PRODUCT_DECISION blocker). Two new evidence-level entries record the
  machinery: `COMMISSION_RULES` (registry, workforce API ready) and `COMMISSION_RULE_RESOLVER`
  (read-only resolution + diagnostic) — both disabled and NOT_CONFIGURED. The AGENT/AGGREGATOR/
  PLATFORM allocation capabilities remain PLANNED/PRODUCT_DECISION.

## 12. UNRESOLVED POLICY REGISTER (decisions required before enablement)

| # | Question | Status |
| --- | --- | --- |
| 1 | Which V1 products can generate commission? | Unresolved — any product *can* carry a rule; none does |
| 2 | Which participant types receive commission? | Unresolved — AGENT/AGGREGATOR/PLATFORM supported; none configured |
| 3 | Commission calculation basis per product? | Unresolved — PRINCIPAL/FEE/NET supported; no per-product default |
| 4 | Fixed vs percentage vs hybrid per rule/product? | Unresolved — all six + tiered supported; none chosen |
| 5 | Minimum/maximum policy? | Unresolved — mechanics supported; values undecided |
| 6 | Tiered commission policy (brackets, marginal vs threshold)? | Unresolved — marginal representation ready |
| 7 | Agent-class differentiation? | Unresolved — targeting ready; classes themselves exist |
| 8 | Agent-specific overrides? | Unresolved — targeting ready |
| 9 | Aggregator allocation? | Unresolved — recipient + targeting ready (aggregator has NO ledger/wallet today — A18 boundary; crediting aggregators needs its own design) |
| 10 | Platform allocation / retained-revenue mapping? | Unresolved — recipient type ready; no revenue accounts exist |
| 11 | Precedence hierarchy across scopes (specific vs class vs wide, cross-dimension)? | Unresolved — explicit `priority` + fail-closed ambiguity is the only mechanism until decided |
| 12 | Effective-date policy (lead times, change freeze, retro-changes)? | Unresolved — windows/versioning supported |
| 13 | Commission accounting treatment (expense vs contra-revenue; payable timing)? | Unresolved — required account families identified (§10), not created |
| 14 | Commission payable settlement mechanism (payout rail, wallet credit, netting, cadence)? | Unresolved — treasury/ops decision |
| 15 | Immediately payable vs accrued (event that crystallizes the payable)? | Unresolved — affects journal shape; no postings today |
| 16 | Gross fee vs net fee vs principal (vs other) as the *policy* base per product? | Unresolved — all bases mechanically supported |

None of these are answered by assumption anywhere in code, schema, seeds, or tests. Test suites
use synthetic TEST-ONLY rules solely to verify mechanics; zero production rules are seeded.

## 13. Non-goals confirmed

Reward/cashback engine, fee charging/resolution wiring, VAT/tax, V2 products, bank/provider
integrations, end-to-end process audit — all untouched and remain future tasks.
