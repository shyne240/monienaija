# V1-REWARD-01 — Reward / Cashback Engine Architecture (Foundation)

Status: **FOUNDATION IMPLEMENTED — ZERO POLICY CONFIGURED — NOT WIRED — NOT ENABLED**
Date: 2026-09-28
Head at implementation: `V1-REWARD-01` (additive over `3a094ef` / V1-COMMISSION-01)
Verification: `docs/V1-REWARD-01-VERIFICATION-REPORT.md`

This document describes the configurable reward/cashback **machinery** built in
V1-REWARD-01. It decides **mechanics only**. It does NOT decide MonieNaija's reward
policy: no rates, no eligibility policy, no eligibility defaults, no precedence
hierarchy, no campaign identities, no frequency/usage policy, no funding source, no
accounting treatment, no effective dates, no enablement. Every business question is
documented as unresolved in §13 and must be answered by explicit product/finance/
accounting decision before any configuration or wiring occurs.

---

## 1. Scope and non-goals

### 1.1 In scope (machinery)

- `reward_rules` durable registry (additive migration `1785753600074-CreateRewardRules`,
  **zero seeded rows**).
- Pure deterministic calculation mechanics for all seven calculation models, over three
  explicit calculation bases.
- Read-only, per-beneficiary-group rule resolver with deterministic, fail-closed
  precedence.
- `RewardEngine` decision facade producing the **exact existing** Commercial Decision
  Snapshot `reward_decision` shape (`grants` + `ruleRefs`) — representation only.
- Workforce-only administration surface (GET/POST/PATCH, no DELETE) and a workforce-only
  read-only `resolve` diagnostic.
- Capability Registry truth-telling: machinery exists, is disabled, NOT_CONFIGURED.

### 1.2 Explicitly NOT done

- No reward/cashback activation, no production rules, no automatic reward postings.
- No wallet credits, no ledger entries, no ledger accounts created.
- No wiring into any of the seven V1 financial flows (statically proven — see §10).
- No change to fee behavior (`NOT_CONFIGURED`), commission behavior (`NONE`), or the
  existing snapshot schema. Historical snapshots are never mutated; no retroactive
  reward calculation exists or is possible.
- No frequency/usage state tables (see §7 for why that is correct at this stage).
- No campaign registry (see §5.4), no customer-loyalty UI, no V2 products, no
  provider/bank integrations.

---

## 2. Inspection of existing primitives (what already exists)

| Concept inspected | Found | Decision |
|---|---|---|
| Commercial Decision Snapshot | `commercial_decision_snapshots.reward_decision` JSONB, statuses `NONE`/`GRANTED`, `grants` array (`beneficiaryType`, `beneficiaryId?`, **`rewardType` (required)**, `amountMinor`, `currency?`, `basis?`, `ruleId?`, `ruleVersion?`), DB-enforced immutability, atomic in-flow capture for all 7 products | **Reused as-is.** Engine emits exactly this shape; schema untouched |
| FeeEngine / fee_rules | fee registry + resolver conventions (bps/10 000, *Minor, effective windows, priority, optimistic version) | Conventions mirrored (see V1-COMMERCIAL-03/04) |
| CommissionEngine / commission_rules | per-recipient registry + read-only resolver + pure calculator + decision facade (V1-COMMISSION-01), **independent** | Mirrored structurally; **no dependency between engines** (§3) |
| Product Catalogue | `products.code` canonical product identity seeded with the 7 V1 products | FK target; asserted on rule creation; no second product system |
| Limit Engine | limit_profiles/rules/assignments/usages + runtime enforcement (transaction/velocity limits) | **Not duplicated.** Reward caps ≠ transaction limits (§7) |
| Customer identity/classification | `customers` (UUID); **existing authoritative enum** `CustomerKycLevel` = `NONE/LEVEL_1/LEVEL_2/LEVEL_3` on `customers.kyc_level`; `CustomerType` | KYC level is a supported targeting dimension **using the existing enum values only** — nothing invented |
| Agent / AgentClass / Aggregator | `agents`, `agent_classes`, `aggregators` | `agent_id`/`agent_class_id` targeting FKs (aggregators not reward beneficiaries — §4.2) |
| B1 campaign/promotion/coupon subsystem | `b1_campaign_decisions` + referral decision tables: **decision-record persistence** (JSONB payloads, versions, idempotency) — NOT a campaign registry of authoritative campaign identities | No reuse. `campaign_code` is a **configuration-only** validated code (§5.4); a real campaign registry is unresolved policy |
| PROMOTIONAL_PRICING capability | Registry entry (PLANNED, promoCode/effective range) | Untouched |
| REWARD_ENGINE / CASHBACK capabilities | Registry entries (both PLANNED) | Advanced truthfully (§11); CASHBACK notes-only, still PLANNED |
| Ledger / wallet credit machinery | Journals/lines with account-classification enums; wallet accounts | **Not touched.** Accounting analysis only (§9) |
| Revenue relationship | Capability registry note: *"Platform revenue = fee − commission − reward"* | Referenced in §9 as the only existing documented relationship; not implemented |

No duplicate concepts were created: the reward registry mirrors the fee/commission
conventions, the snapshot vocabulary is reused, targeting references only identities
that already exist, and no reward usage machinery duplicates the Limit Engine.

---

## 3. Conceptual separation (hard boundary)

A **reward** is a benefit the platform may decide to grant. It is:

- **not principal** — it never moves or changes the transacted amount;
- **not a customer fee** — it is not charged to anyone;
- **not platform revenue** — it may *reduce* future revenue, but that treatment is an
  accounting decision (§9), not an assumption here;
- **not agent/aggregator commission** — commission compensates a distribution
  participant from policy; reward is a separate beneficiary deci­sion;
- **not a negative fee and not a fee discount** — the engine never touches `fee_decision`;
  a rule calculates a positive grant amount from an explicit base, nothing else.

Consequences encoded in the machinery:

- The resolver's only inputs are the rule registry, the base *evidence*
  (`principalMinor`, optional `feeMinor`), and the eligibility context. It never reads
  commission outcomes; `FEE` basis consumes fee *evidence* supplied by the caller,
  not commission.
- Grants carry the snapshot-required `rewardType` (`CASHBACK`/`BONUS`/`PROMOTION`) —
  a **classification**, with no business meaning attached.
- `NOT_CONFIGURED` (snapshot `NONE`) ≠ explicit `ZERO`: a configured `FIXED 0` rule
  resolves to `GRANTED` with `amountMinor: '0'` — represented, explainable, and never
  conflated with "no rule exists".

---

## 4. Rule model

### 4.1 Registry row (`reward_rules`)

| Field | Type | Meaning |
|---|---|---|
| `id` | UUID | rule identity |
| `product_code` | VARCHAR(80) FK→`products.code` RESTRICT | canonical product |
| `currency` | VARCHAR(3) CHECK `^[A-Z]{3}$` | exact-match currency (V1: NGN) |
| `beneficiary_type` | VARCHAR(20) CHECK ∈ {CUSTOMER, AGENT} | who receives the grant (one group per rule) |
| `reward_type` | VARCHAR(20) CHECK ∈ {CASHBACK, BONUS, PROMOTION} | grant classification (snapshot `rewardType`) |
| `calculation_basis` | VARCHAR(20) CHECK ∈ {PRINCIPAL, FEE, NET} | explicit base per rule — **no production default chosen** |
| `calculation_model` | VARCHAR(24) CHECK ∈ 7 models | mechanics selector |
| `flat_reward_minor` | BIGINT ≥ 0 | FIXED / FLAT_PLUS_PERCENTAGE param |
| `percentage_bps` | INTEGER ∈ [0, 10000] | percentage param (10 000 = 100 %) |
| `minimum_reward_minor` | BIGINT ≥ 0 | floor (MIN models) |
| `maximum_reward_minor` | BIGINT ≥ 0 | **per-transaction cap** (MAX models) |
| `tiers` | JSONB array | marginal ladder for TIERED |
| `customer_id` | UUID FK→`customers` RESTRICT, NULL | targeting dim 1 |
| `customer_kyc_level` | VARCHAR(20) CHECK ∈ {NONE, LEVEL_1, LEVEL_2, LEVEL_3}, NULL | targeting dim 2 (existing enum; no FK by design) |
| `agent_class_id` | UUID FK→`agent_classes` RESTRICT, NULL | targeting dim 3 |
| `agent_id` | UUID FK→`agents` RESTRICT, NULL | targeting dim 4 |
| `campaign_code` | VARCHAR(80) CHECK `^[A-Z0-9][A-Z0-9_-]{0,79}$`, NULL | targeting dim 5 (config-only; no FK — §5.4) |
| `effective_from` / `effective_to` | TIMESTAMPTZ, `effective_to > effective_from` | window `[from, to)` |
| `priority` | INTEGER | precedence input (§8) |
| `is_active` | BOOLEAN | disable without delete |
| `created_by` / `updated_by` | VARCHAR(160) | workforce audit |
| `version` | INTEGER > 0 | optimistic lock (conditional UPDATE ... WHERE version = caller's) |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMPTZ | audit + soft delete |

DB-level invariants (all CHECK): model⇆parameter coherence (each model's params
present, all others NULL — TIERED carries a non-empty tiers array), min ≤ max,
at most **one** targeting dimension non-null, money ≥ 0, bps ∈ [0,10000],
currency format, vocabulary pins, version > 0. Deterministic identity uniqueness:
one live rule per `(product_code, currency, beneficiary_type, normalized targets,
effective_from)` — NULL targets folded to the zero UUID / `''` in a partial unique
index.

### 4.2 Beneficiary vocabulary: CUSTOMER | AGENT

One rule grants **one beneficiary group**; multi-beneficiary outcomes emerge from
independent per-group resolution, never from split columns (no 60/20/20-style
hardcoding anywhere). PLATFORM/AGGREGATOR reward beneficiaries are intentionally
absent: no policy supports "granting the platform a reward". If a future approved
policy needs another beneficiary type, expanding the CHECK + enum is additive.

Targeting (eligibility context) is deliberately independent of beneficiary: e.g. a
CUSTOMER-beneficiary rule targeted by `agent_class_id` reads "customers whose
transaction is serviced by a class-X agent". No combination is pre-judged.

### 4.3 Calculation models (mechanics, exact semantics in `RewardCalculator`)

1. `FIXED` → `flat_reward_minor`
2. `PERCENTAGE` → `(base × bps) / 10000` (bigint floor division)
3. `PERCENTAGE_MIN` → `max(raw, minimum)`
4. `PERCENTAGE_MAX` → `min(raw, maximum)` — **this is the per-transaction cap**
5. `PERCENTAGE_MIN_MAX` → `min(max(raw, minimum), maximum)` — minimum applied first
   (same clamp order + floor division as FeeEngine/CommissionCalculator)
6. `FLAT_PLUS_PERCENTAGE` → `flat + (base × bps) / 10000`
7. `TIERED` → contiguous marginal brackets from 0: each bracket accrues `bps%` of the
   base slice inside `[bracketFrom, upToMinor)` (floor per bracket) plus the bracket's
   `flatMinor` once if the base reaches the bracket; ascending, no gaps/overlaps, only
   the last bracket may be open-ended. Structure is enforced at write time
   (registry runs the calculator's validator) and re-verified at calculation time.

Examples of **mechanics, not policy**: `2% of PRINCIPAL` or `10% of FEE` are
representable; nothing selects them.

### 4.4 Calculation bases: PRINCIPAL | FEE | NET

- `PRINCIPAL` — the flow amount evidence. Always available.
- `FEE` — caller-supplied fee evidence only. If absent: fail closed
  (`REWARD_BASE_UNAVAILABLE` 400) — never fabricated, never skipped silently.
- `NET` — `principal − fee` from the same fee evidence (fail closed if
  fee > principal or fee evidence absent).

V1 fees are `NOT_CONFIGURED`, so FEE/NET rules cannot resolve in production today;
whether fee-based rewards are even desirable is unresolved policy (§13 #6).

---

## 5. Eligibility (targeting)

### 5.1 Model

Eligibility is **configuration + resolution logic**, not code scattered through
financial services: single-dimensional nullable targeting on the rule, matched
NULL-or-equal by the resolver against context supplied by the (future) caller:
`customerId`, `customerKycLevel`, `agentId`, `agentClassId`, `campaignCode`.
A rule with all targeting NULL is untargeted (product+currency wide).

Single-dimension discipline (DB CHECK) keeps overlapping scopes legible and precedence
explainable; expressiveness comes from multiple rules + priority, not from
multi-dimensional rows.

### 5.2 Supported dimensions (all bound to EXISTING authoritative identities)

| Dimension | Backing | Notes |
|---|---|---|
| product | `products.code` FK | 7 V1 products today; unknown product → 404 at write |
| customer | `customers.id` FK | existence asserted at write |
| customer KYC level | **existing** `CustomerKycLevel` enum (`NONE/LEVEL_1/LEVEL_2/LEVEL_3`) | classification, not a table — validated against the enum, pinned by CHECK; invented levels (`TIER_GOLD`...) are rejected |
| agent / agent class | `agents.id` / `agent_classes.id` FK | eligibility *context* (not necessarily the beneficiary) |
| campaign/promotion | `reward_rules.campaign_code` | configuration-only — §5.4 |
| effective time | window `[effective_from, effective_to)` + `at` | historical resolution is first-class |

### 5.3 Deliberately NOT represented

- **Fixed/new KYC levels or customer tiers** — none invented; the two authoritative
  classifications that exist (`CustomerKycLevel`, implicitly `CustomerType`) are the
  only vocabularies a rule may name, and only KYC level was modelled as a targeting
  column. `CustomerType` (INDIVIDUAL/BUSINESS) was *not* added: no stated need, keeps
  the surface minimal; additive later if policy asks.
- **Transaction/channel dimension** — no authoritative channel vocabulary exists in the
  codebase (inspected: no channel enums in flow definitions). Documented as future
  work pending an authoritative source; the context type can grow a field without
  schema change.
- **"Every customer/product is eligible" assumption** — nothing is eligible by default;
  zero rules are configured.

### 5.4 Campaign/promotion dimension (config surface only)

No authoritative campaign registry exists. The B1 subsystem persists *decision
records* (campaign/promotion/coupon/referral **decisions as JSONB payloads**), not a
campaign catalogue. Therefore `campaign_code` is a format-validated
(`^[A-Z0-9][A-Z0-9_-]{0,79}$`) free code with **no FK**: it lets configuration name a
promotion identity and the resolver match it, exactly like other targeting columns,
without inventing campaign names or a registry. Whatever a future approved campaign
registry becomes, rules can then migrate the code to an FK additively. No admin UI or
customer-facing campaign surface was built.

---

## 6. Frequency / usage / caps — analysis and boundary

### 6.1 What the foundation supports today (mechanics)

- **Per-transaction reward cap**: `maximum_reward_minor` (`PERCENTAGE_MAX`,
  `PERCENTAGE_MIN_MAX`). This is a pure function of the single transaction — belongs to
  calculation mechanics and is fully implemented + tested.
- **Effective-period restriction**: rule windows bound when a rule applies.
- **One decision per transaction evaluation**: each decide() evaluates the current
  context once; it has no concept of "this customer already earned today".

### 6.2 What is deliberately NOT built, and why

Frequency/usage restrictions (once per transaction across retries, daily/weekly/monthly
reward frequency, first-transaction, first-N-transactions, cumulative lifetime reward
caps) all require **durable per-beneficiary mutable state** (a usage/grant ledger)
whose correct write point is the future **grant-posting** integration (the moment a
reward becomes a balance/ledger effect — see §9 and §12). Designing that state before
the accounting/posting decision would:

1. guess at write semantics (immediate credit vs accrual — §13 #16/#17),
2. duplicate a Limit-Engine-shaped subsystem inside the Reward Engine, and
3. create tables that nothing writes or reads (no runtime wiring exists).

Therefore: **no usage table was created.** This is documented here as the explicit,
considered boundary — the registry intentionally expresses only what is knowable from
a single transaction + context.

### 6.3 Reward caps vs transaction limits (never conflated)

The Limit Engine enforces **customer/asset safety limits** (how much may move). Reward
caps constrain **how much benefit a grant may reach**. A reward cap must never be
implemented by reusing customer transaction limits: different owners, different failure
semantics (reject vs clamp), different ledgers. The foundation keeps them fully
separate; the future usage-state design must live on the reward side.

---

## 7. Effective dating, versioning, historical explainability

- Window `[effective_from, effective_to)`, open-ended allowed, integrity at the DB.
- Historical resolution is first-class: resolver takes `at`; past/future contexts resolve
  against the same registry with window semantics. Historical transactions stay
  explainable: grants captured in a snapshot carry `ruleId`, `ruleVersion`,
  calculation basis/model/parameters, base amount, priority, `effectiveFrom`,
  targeting, `campaignCode` — the same query that selects the rule captures the
  evidence (no "current state" second lookup).
- Rule updates are conditional-UPDATE version checks (deterministic 409 on stale
  versions — the concurrency-safe mechanism proven in V1-COMMISSION-01), audited
  (CREATED/UPDATED rows in `audit_events` with previous/new values). No DELETE:
  deactivation (`is_active=false`) or `effective_to` ends a rule; rows are never erased.
- Snapshots are immutable at the DB layer (trigger); corrections elsewhere in V1 use
  compensating rows (`supersedes_snapshot_id`) — no reward path mutates history.

---

## 8. Precedence (deterministic, fail closed — hierarchy NOT invented)

- Resolution groups candidate rules **per beneficiary_type** (CUSTOMER, AGENT),
  matching product+currency+active+window+targeting.
- Within a group: **highest `priority` wins** (mirrors fee/limit/commission resolvers).
- **Ties fail closed**: two or more applicable rules sharing the top priority in a group
  → `REWARD_RULE_AMBIGUOUS` 409 naming the conflicting rule ids. Never a silent choice.
- **Cross-scope specificity hierarchy (customer-specific vs KYC-level vs campaign vs
  agent-context vs untargeted) is deliberately NOT hardcoded.** Any such hierarchy is
  business policy (§13 #13). Until decided, overlapping scopes must be disambiguated
  by explicit priority, or the answer is honest ambiguity.

This is the configuration-safe default: an operator mistake yields an explicit error
during diagnostics/config — **before** any future flow could act on it — never a
wrong amount.

---

## 9. Commercial Decision Snapshot integration

### 9.1 Shape contract (existing — untouched)

`reward_decision` JSONB = `{ status: 'NONE' | 'GRANTED', grants?, ruleRefs? }`;
`GRANTED` requires a non-empty grants array (validator-enforced).
`ruleRefs` entries: `{ ruleId, ruleVersion, ruleType: 'REWARD' }`.

### 9.2 Engine output (representation only)

`RewardEngine.decide / decideWithManager` returns:

- `rewardNone()` (`{status:'NONE', grants:[], ruleRefs:[]}`) when nothing resolves —
  **byte-identical** to what all seven flows write today (proven by equality test);
- otherwise `rewardGranted(grants, ruleRefs)` via the new pure builder in
  `commercial-decision.defaults.ts` (mirrors `commissionAllocated`; throws on empty —
  `rewardNone()` untouched).

Grant keys (mirror the validator's open-schema convention; same discipline the
commission `allocations` use):

```
beneficiaryType, beneficiaryId?, rewardType, amountMinor, currency, basis, ruleId,
ruleVersion, calculationModel, calculationParameters, baseAmountMinor, campaignCode,
priority, effectiveFrom, targeting
```

`beneficiaryId` is set when the rule targets a specific customer/agent; it is NULL for
untargeted rules (the future wiring supplies the transacting principal — identical to
the commission resolver's recipient-id semantics).

### 9.3 Persistence proof (not wiring)

The suite persists an engine-produced GRANTED decision through
`CommercialDecisionSnapshotService.recordDecision` (standalone, own transaction —
the shape-boundary proof): validation passes, durability + trigger-enforced
immutability hold, idempotent replay holds. **No flow calls this.** Historical
snapshots are never read or modified by the engine.

---

## 10. Runtime integration state (verification-backed)

- Zero flows reference `RewardEngine` or `reward_rules` — **static guard test** over
  `src/agent/agent-financial-execution.service.ts`, `agent-cash-to-cash.service.ts`,
  `agent-funding.service.ts`, `src/customer-funding/customer-funding.service.ts`,
  `src/transfer/transfer.service.ts` (the files implementing the seven products).
- Production behavior unchanged: fee `NOT_CONFIGURED`, commission `NONE`,
  reward `NONE` (full integration 62/62 suites incl. all commercial-decision suites).
- `reward_rules` seeded count = **0** (migration is DDL only; suite asserts empty).
- Financial isolation proof: configuring rules + running resolution writes nothing to
  `ledger_journals`, `ledger_lines`, `limit_usages`, `wallet_accounts`,
  `commercial_decision_snapshots`; `commission_rules` stays empty (engine separation).

---

## 11. Capability Registry state (accurate, not production-enabled)

| Entry | backend | api | UIs | enabled | configurationStatus | lifecycle |
|---|---|---|---|---|---|---|
| `REWARD_ENGINE` (v2) | BACKEND_IMPLEMENTED | NOT_EXPOSED | none | **false** | **NOT_CONFIGURED** | BACKEND_IMPLEMENTED |
| `REWARD_RULES` (new, v1) | BACKEND_IMPLEMENTED | API_READY (internal) | none | false | NOT_CONFIGURED | BACKEND_IMPLEMENTED |
| `REWARD_RULE_RESOLVER` (new, v1) | BACKEND_IMPLEMENTED | API_READY (internal) | none | false | NOT_CONFIGURED | BACKEND_IMPLEMENTED |
| `CASHBACK` | PLANNED (unchanged) | NOT_EXPOSED | none | false | NOT_CONFIGURED | PLANNED |
| V2 capabilities | untouched | | | | | |

Dependencies wired: `REWARD_ENGINE → REWARD_RULES + REWARD_RULE_RESOLVER +
PRODUCT_CATALOGUE`. Blocker descriptions state precisely what is missing (approved
policy). Machinery ≠ production enablement.

---

## 12. Accounting considerations (analysis only — NOTHING implemented)

### 12.1 Requirement

If an approved future policy activates rewards, each grant becomes a value movement
obligation. The only existing documented relationship is the capability-registry note
`PLATFORM_REVENUE_ALLOCATION`: **"Platform revenue = fee − commission − reward"** —
a statement that reward *interacts with* revenue, not a treatment decision.

### 12.2 Candidate treatments (all documented; NONE chosen)

| Option | Sketch | Consequences / why it needs an explicit accounting decision |
|---|---|---|
| Customer reward payable | DR promotional expense (or contra-revenue) / CR customer reward payable; settle later | needs a payable account family + settlement mechanism decision |
| Promotional expense | DR promo expense / CR wallet (float source) at grant time | expense recognition timing + funding source decision |
| Platform revenue reduction | recognize as contra-revenue netted against fee revenue | meaningless while fees are NOT_CONFIGURED; needs policy |
| Direct wallet credit | credit customer wallet from a platform/float account at grant time | immediate cash-leaves-float impact; funding source + approval workflow decision |
| Deferred reward liability | accrue liability, release on redemption/expiry | expiry policy (§13 #18) and liability family decision |

**No ledger account families were invented and none were created.** If activation is
approved, the accounting decision will determine which families are required
(e.g. a reward-payable and/or promotional-expense family and their float/settlement
counterparts) — that is documented as a **requirement with rationale**, not
implemented, exactly like V1-COMMISSION-01. The engine foundation deliberately emits
a *decision/calculation representation* that any of these treatments can consume.

### 12.3 Commission separation in accounting

Reward posting must never ride on commission accounts or vice versa; they are separate
beneficiaries, separate policies, separate families (both currently unposted).

---

## 13. Unresolved policy register (all unanswered — DO NOT answer in code)

1. Which V1 products can generate rewards? *(unresolved)*
2. Who is eligible? *(unresolved)*
3. Customer-specific vs segment-based eligibility? *(unresolved)*
4. KYC/customer-class differentiation? *(machinery supports the existing KYC enum; policy unresolved)*
5. Fixed vs percentage vs hybrid? *(all supported; selection unresolved)*
6. Reward calculation basis (PRINCIPAL/FEE/NET)? *(no default chosen)*
7. Minimum/maximum? *(mechanics exist; values unresolved)*
8. Tiered rewards? *(mechanics exist; usage unresolved)*
9. Frequency restrictions? *(needs usage-state design + posting decision; §6)*
10. Per-transaction reward cap? *(mechanism exists: MAX; values unresolved)*
11. Cumulative reward cap? *(deferred — §6)*
12. Campaign/promotion model? *(config-only code today; registry decision unresolved)*
13. Rule precedence hierarchy (cross-scope specificity)? *(explicit priority only; ties fail closed)*
14. Effective dates? *(mechanics exist; schedules unresolved)*
15. Reward accounting treatment? *(options documented §12; undecided)*
16. When does a reward become payable? *(undecided)*
17. Is a reward credited immediately or accrued? *(undecided; determines usage-state design)*
18. Can rewards expire? *(undecided)*
19. Can rewards be reversed? *(undecided — see §14)*
20. What happens when the underlying transaction is reversed/failed? *(§14; policy undecided)*
21. Funding source for rewards? *(undecided)*
22. Tax/accounting treatment (e.g. VAT implications of grants)? *(undecided; none invented)*

---

## 14. Reversal / failure analysis (documented — no reversal behavior implemented)

**Principle: a reward must never be created for a transaction that ultimately rolls
back.** The intended atomic relationship:

1. **Decision-in-transaction**: `decideWithManager(manager, …)` exists precisely so a
   future approved wiring can resolve + capture the reward decision **inside the
   same SERIALIZABLE boundary** as the financial flow and its snapshot (the pattern
   already used for commercial snapshots in all seven flows). If the flow rolls back,
   the decision and its snapshot roll back with it — no orphan reward state can exist.
2. **No posting yet = no reversal surface**: the foundation never credits wallets or
   posts journals, so there is nothing to reverse today.
3. **Future reversal hooks**: when posting is decided (§12) and wired, reversed/failed
   transactions need a compensating policy (void grant at decision level vs
   compensating journal). That interacts with §13 #19/#20 and with the snapshot's
   `supersedes_snapshot_id` correction convention (history is never rewritten).
4. **Idempotency**: any future posting path must bind grant writes to the flow's
   idempotency key (as snapshots do) so replays never double-grant. Usage/frequency
   state (§6) must update in the same transaction as the posting that consumes it.

None of this is implemented in this task; the boundary above is the documented design
contract the future wiring/accounting work must honor.

---

## 15. Testing posture (summary — full evidence in the verification report)

Real PostgreSQL (`test/v1-reward-01-reward-engine.integration.spec.ts`, 16 tests):
migration/CHECK/FK/identity integrity incl. DB-layer rejections; zero-seed + static
no-wiring proof; all 7 models exact amounts; tiered marginal ladder; PRINCIPAL/FEE/NET
bases incl. fail-closed without fee evidence; eligibility for every targeting
dimension incl. negative cases; cross-beneficiary independence; effective windows +
historical resolution + versioning + disable + audit; precedence win + AMBIGUOUS 409 +
deterministic disambiguation; registry rejections; concurrent create/update races;
snapshot persistence + immutability; ZERO≠NONE; byte-identical determinism (floor
division); workforce-only HTTP + diagnostic + no-DELETE; financial isolation incl.
`commission_rules` untouched. Regression: full integration **62 suites / 1325 tests**
green; unit 1764 pass / 2 pre-existing unrelated failures; `tsc` + `nest build` clean;
eslint 0 errors on all new files and no deltas vs baseline on touched legacy files.
