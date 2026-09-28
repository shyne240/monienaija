# V1-COMMERCIAL-IMPLEMENTATION-01 — FEE ENGINE RUNTIME WIRING — VERIFICATION REPORT

**Date:** 2026-09-28 · **Branch:** `arena/01a0d883-monienaija`
**Base HEAD:** `9870155` (SMS-V1-01) · **Deliverable HEAD:** recorded in §11 after push
**Scope:** runtime wiring of V1 fee calculation through the EXISTING
`FeeRuleResolverService` → new pure `FeeRuleCalculatorService` → immutable
`CommercialDecisionSnapshot` chain for all seven wired V1 flows, with an additive persistence
slot for the applied fee and customer-safe fee disclosure plumbing.

---

## 1. PROVISIONAL RATES — HARD CONFIRMATION

> **ALL fee rates used anywhere in this task are PROVISIONAL V1 TEST CONFIGURATION — NOT FINAL
> PRODUCTION PRICING.** They exist **only** inside disposable per-process test databases
> (`test/v1-fee-runtime-wiring.integration.spec.ts` and the pre-existing synthetic-rule tests in
> the decision suites). **No production seed, migration, or policy document** carries any rate.
> `fee_rules` in production remains EMPTY; `v1-capability-registry` assertions confirm zero
> production rules. No ledger account codes were invented anywhere (see §6).

The provisional test vectors actually exercised (never a pricing statement):

| Product (test-only) | Flat | Bps | Min | Max | Purpose |
|---|---|---|---|---|---|
| WALLET_TRANSFER | 50 | 10 | 500 | 2500 | flat / clamp ladder / rounding / priority / ambiguity / window / ZERO / VAT(750bps) / replay |
| WALLET_TRANSFER (pilot-06 legacy) | 250 | 10 | 100 | 50000 | APPLIED upgrade of pre-wired pilot |
| CASH_TO_WALLET (03a legacy) | 150 | 5 | — | — | flow-2 wiring proof |
| WALLET_TO_CASH (03b legacy) | 200 | 10 | — | — | flow-3 wiring proof |
| CASH_TO_CASH (03c legacy + new) | 125/250 | 15/100 | — | — | initiation + claim replication |
| CUSTOMER_FUNDING (03d legacy + new) | 300/0 | 20/0 | — | — | engine-honors-config + FREE-by-absence |
| AGENT_FUNDING / AGENT_DEFUNDING (03e legacy) | 100/150 | 5/8 | — | — | twin-product wiring proof |

## 2. WHAT WAS DELIVERED

### 2.1 New runtime authority (single calculator)

- **`src/fee-rules/fee-rule-calculator.service.ts` (new)** — the single computation authority.
  Pure + deterministic: BigInt minor-unit arithmetic only; no I/O, clock, or randomness.
  Consumes `FeeRuleResolution` — **no parallel engine, no rule re-derivation, no direct
  calculation inside transaction services** (mandate preserved).
  - Models: `FLAT` | `PERCENTAGE` | `FLAT_PLUS_PERCENTAGE` | `ZERO` (model = rule *construction*).
  - raw = floor(p·bps/10⁴) [only when bps configured] + flat; then **minimum lifts**, **maximum
    caps**; `minimumApplied` / `maximumApplied` emitted as evidence booleans.
  - Rounding: integer FLOOR on the percentage path with explicit `roundingApplied: 'FLOOR'`
    evidence (rounding-family final policy remains a pending human decision — flagged, not hidden).
  - VAT: when a rule carries `vatBps`, VAT is computed **on the clamped fee** (floor), with
    `vatApplied`, `vatRateBps`, `vatBasisMinor` evidence.
  - Status vocabulary: `NOT_CONFIGURED` (no rule — legacy shape byte-identical), `AMBIGUOUS`
    (legacy shape byte-identical), `ZERO` (rule resolves but computes 0), `APPLIED` (> 0).
- **`src/fee-rules/fee-rules.module.ts`** — calculator now provided + exported.

### 2.2 Runtime wiring — all six snapshot sites / seven products

Each of the six services that already held the resolution→`feeNotConfigured` snapshot assembly
now routes through the calculator; the legacy inline block is retained only as an
else-branch for `@Optional()`-absent manual constructions (unit specs that `new` services with
positional args keep compiling — verified by `test/transfer.service.spec.ts`,
`test/a5-payment-lifecycle.integration.spec.ts`).

| Flow service | Products | Notes |
|---|---|---|
| `src/transfer/transfer.service.ts` | WALLET_TRANSFER | extras: none (base shape) |
| `src/agent/agent-financial-execution.service.ts` | CASH_TO_WALLET, WALLET_TO_CASH | extras: `agentId` |
| `src/agent/agent-cash-to-cash.service.ts` | CASH_TO_CASH (initiation) | extras: `agentId`, `transferId` |
| `src/agent/agent-cash-to-cash-claim.service.ts` | CASH_TO_CASH (claim replication) | extras: `transferId` |
| `src/customer-funding/customer-funding.service.ts` | CUSTOMER_FUNDING (approval) | — |
| `src/agent/agent-funding.service.ts` | AGENT_FUNDING, AGENT_DEFUNDING | — |

Byte-compatibility for `NOT_CONFIGURED` / `AMBIGUOUS` paths is asserted by the unchanged
legacy suites (decision-01/03a-e run green with zero edits to those assertions).

### 2.3 Persistence + disclosure

- **Migration `1785753600075-AddTransferFeeColumns`** (additive only): `transfers.fee_minor`,
  `transfers.vat_minor` — BIGINT NOT NULL DEFAULT 0, non-negative CHECKs. Mirrors the
  `cash_to_cash_transfers` slot discipline. Semantic: **fee actually applied (posted)** on the
  transfer — stays `0` while the accounting boundary holds (§6); the *computed* fee lives in the
  immutable snapshot.
- **`src/transfer/transfer.entity.ts`** — two new columns (bigint, default '0', matching the
  cash-to-cash entity pattern).
- **`src/customer-app/customer-transaction-history.service.ts`** — unified history now reads the
  real `transfers.fee_minor`/`vat_minor` instead of the hardcoded `'0'` literal for wallet
  transfers (FUNDING branch keeps its literal `'0'`; cash-to-cash already read the real column).
  The safe projection shape is unchanged: `{id, type, status, amountMinor, currency, feeMinor,
  ...}` — no journalId/ledgerAccountId/outboxId/snapshot/limit internals (asserted by
  `not.toHaveProperty` checks in the new suite).
- **`src/production/production-readiness.service.ts`** — expected migration head bumped to
  `AddTransferFeeColumns1785753600075` (the live startup-compatibility contract).

### 2.4 Capability registry (truth-only updates; NO FULLY_ENABLED claim)

- `FEE_ENGINE` v2→v3: notes record the resolver→calculator runtime chain; lifecycle stays
  **DISABLED**, `enabled: false`, `NOT_CONFIGURED` (as pinned by the registry suite).
- `FEE_RULE_RESOLVER` v7→v8: implementation refs + calculator file, `AddTransferFeeColumns`
  migration ref, notes record runtime consumption; lifecycle stays **BACKEND_IMPLEMENTED**.
- `COMMERCIAL_DECISION_SNAPSHOT` v8→v9: blocker text corrected from unconditional
  "fee decision NOT_CONFIGURED" to "authoritative fee decision (APPLIED/ZERO when a rule is
  configured; NOT_CONFIGURED otherwise)".
- The fee-model rows (`FLAT_FEE`, `PERCENTAGE_FEE`, `PERCENTAGE_MINIMUM_FEE`, …) stay
  **DESIGNED / "Requires rate decision"** — provisional test config is deliberately **not** a
  production policy claim.

### 2.5 New proof suite

- **`test/v1-fee-runtime-wiring.integration.spec.ts` (new, 14/14 green on real PG)**:
  `01` flat-only APPLIED + journal unchanged; `02` percentage clamp ladder
  (below-min 10000→500⋮minApplied / at-min 500000→500 / between 1000000→1000 /
  at-max 2500000→2500 / above-max 10000000→2500⋮maxApplied); `03` FLOOR rounding
  (1550·10bps → 1 + `roundingApplied` evidence); `04` VAT on clamped fee (flat 1000, 750bps →
  vat 75, no vat ledger leg); `05` priority precedence (highest wins, exact rule identity);
  `06` ambiguity → preserved AMBIGUOUS shape, nothing charged; `07` effective-window exclusion
  (future + expired rules → NOT_CONFIGURED zero-fee fallback); `08` zero-parameter rule →
  explicit `ZERO`; `09` idempotent replay serial + concurrent → ONE transfer / ONE snapshot /
  ONE fee decision, wallet debited once; `10` forced downstream failure → snapshot + computed
  fee + journal roll back together, retry computes identically; `11` customer-safe projection
  (feeMinor real '0', amount/currency, no internals; computed '75' recoverable from decision);
  `12` CASH_TO_CASH initiation APPLIED + principal-only journal (the previously dangerous
  `totalString` debit path stays principal-only because fee/vat vars stay 0);
  `13` CASH_TO_CASH claim replication **bit-for-bit identical** across every fee key;
  `14` CUSTOMER_FUNDING FREE — by absence (NOT_CONFIGURED, full principal credited) and by
  explicit zero config (status ZERO).

### 2.6 Pre-existing suites updated (only where semantics intentionally changed)

- `v1-commercial-decision-02-pilot-snapshot` pilot-06: `NOT_CONFIGURED/'0'` →
  `APPLIED`, fee `340` (floor(90000·10/10⁴)=90 + 250), total `90340`, model
  `FLAT_PLUS_PERCENTAGE`, posting-blocked evidence; journal/ledger assertions kept (2× 90000).
- `03a`-07 (150+5bps on 18000 → `159`), `03b`-07 (200+10bps on 18000 → `218`),
  `03c`-06 init (250+15bps on 18000 → `277`) and `-12` claim (on 11000 → `266`, plus suite-local
  rule cleanup to keep later tests in their authored zero-rule world),
  `03d`-09 (300+20bps on 18000 → `336`), `03e`-12 (fund `109`, defund `155`).
- Migration-head expectation updates (additive head 075): `a19` (20, 21), `migration-chain`
  (count 76), `v1-capability-registry`-01 (76 + head), `v1-001`, `v1-003`, `v1-005`, `v1-006`,
  `v1-007`, `v1-hardening-06/07/09`, `v1-limit-01/02/03`, `a8`, `a17`, `a18`, `a20`,
  `production-readiness.spec.ts` (compatible-head stub).
- Diffs were kept semantic-only (prettier reflow noise was checked out and edits re-applied;
  final numstat per touched legacy file is small, see §9).

## 3. SEVEN-PRODUCT FEE MATRIX (current production truth)

| Product | Wiring | Rule exists (prod) | Snapshot content today | Fee collected? | Journal |
|---|---|---|---|---|---|
| WALLET_TRANSFER | wired | none | NOT_CONFIGURED, fee 0 | no | principal-only |
| CASH_TO_WALLET | wired | none | NOT_CONFIGURED | no | principal-only |
| WALLET_TO_CASH | wired | none | NOT_CONFIGURED | no | principal-only |
| CASH_TO_CASH (init + claim) | wired | none | NOT_CONFIGURED | no | principal-only (init reserves total=principal; claim moves principal) |
| CUSTOMER_FUNDING | wired | none | NOT_CONFIGURED (FREE) | no | principal-only |
| AGENT_FUNDING | wired | none | NOT_CONFIGURED (FREE) | no | principal-only |
| AGENT_DEFUNDING | wired | none | NOT_CONFIGURED (FREE) | no | principal-only |

With a test-seeded rule: every product computes exactly as its rule dictates (matrix evidence in
the new suite + upgraded decision suites) — status `APPLIED`, full calculation evidence, and
`posting: { journalLegsPosted: false, reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED' }`.

## 4. CALCULATION / MIN-MAX / FREE / SNAPSHOT EVIDENCE (condensed)

- **flat-only**: principal 21000, flat 50 → fee `50`, total `21050`, model `FLAT` (fee-01).
- **percentage clamps**: 10bps min 500 max 2500 — 10000→`500` (min lift, pct component `10`),
  500000→`500`, 1000000→`1000`, 2500000→`2500`, 10000000→`2500` (capped, pct component `10000`)
  (fee-02); 1550→`1` with `roundingApplied: 'FLOOR'` (fee-03).
- **flat+pct**: pilot-06 90000 → `340`; priority test: priority-10 flat 90 beats priority-1
  flat 70 with exact rule identity (fee-05).
- **VAT**: flat 1000 + 750bps → vat `75` on basis 1000, `totalMinor` 6075, journal principal-only
  (fee-04).
- **ZERO**: flat '0' rule → `status ZERO`, model ZERO, no charge (fee-08); explicit zero on
  CUSTOMER_FUNDING → ZERO, full principal credited (fee-14).
- **AMBIGUOUS**: two same-priority rules → legacy ambiguous shape, `ambiguousRuleIds`, nothing
  charged (fee-06).
- **Window**: future/expired rules never apply (fee-07).
- **Snapshot**: immutable record carries status, ruleRefs (ruleId+version+effective parameters),
  full calculation inputs/evidence, currency, actor/principal context, correlation/journal
  identity — recorded in the SAME SERIALIZABLE transaction (`recordDecisionWithManager`).

## 5. IDEMPOTENCY / CONCURRENCY / FAILURE

- Replay (serial + `Promise.all` concurrency with one idempotency key): exactly ONE transfer,
  ONE journal, ONE snapshot, ONE fee decision; wallet debited once; replay returns identical
  computed fee (fee-09).
- Forced downstream failure after snapshot-record (armed outbox hook): snapshot, transfer,
  journal, wallet deltas, and the computed fee roll back atomically; subsequent retry computes
  the identical fee — **a failed transaction leaves no fee liability, no revenue posting**
  (fee-10; pilot-05 analog on the legacy suite).
- Claim replay (c2c): replicated fee decision bit-identical (fee-13).

## 6. ACCOUNTING STATUS (dependency — CONFIRMED STOP)

Search executed at task start over migrations/seeds: **no REVENUE-family ledger account is
seeded anywhere**; the ledger schema supports the `REVENUE` account type but no authoritative
fee-revenue account family exists, and B1 revenue-recognition tables are *decision records*, not
posting targets (posting into them would be a V2 policy decision).

Per the mandate **"DO NOT INVENT LEDGER ACCOUNT CODES"**, the implementation deliberately goes
to the accounting boundary and stops:
- Every journal in every flow remains **DEBIT/CREDIT principal-only** (asserted everywhere).
- `transfers.fee_minor`/`vat_minor` mean "fee actually collected" ⇒ stay `'0'`; the same for the
  pre-existing `cash_to_cash_transfers` slots (initiation debit path retains its 0n fee/vat —
  hardcoding fee>0 there WOULD unbalance the journal, which is precisely the c2c code's own
  documented STOP).
- Every APPLIED/ZERO decision carries explicit
  `posting: { journalLegsPosted: false, reason: 'FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED' }`.
- **Exact dependency: provision the authoritative FEE-REVENUE (and FEE-VAT-LIABILITY, if VAT is
  adopted) account family + policy on posting order (charge-at-execution vs the c2c
  initiation-vs-claim split), then extend journals additively.**

## 7. KYC STATUS

No KYC-targeted fee targeting was added: `fee_rules` has no KYC/segment/agent-class targeting
columns (by registry design — V1-COMMERCIAL-03 deliberately left targeting to the resolver
concern, and the resolver currently targets only (product, currency, at)). Per instruction, no
rate was invented and nothing was faked. **Dependency: schema extension for KYC targeting +
approved policy.**

## 8. DISCLOSURE STATUS

Existing confirmation/history surfaces represent **principal / applied fee / currency** without
any internal ledger data (`customer-transaction-history.listUnified`, asserted in fee-11 with
`not.toHaveProperty` on journalId/ledgerAccountId/outboxId/snapshot/limit fields). Total is
derivable as principal+fee (+vat). The *computed* (unposted) fee is available to a disclosure
view from the immutable decision snapshot — wiring that into a customer confirmation payload is
a follow-on step; **no UI was built** (out of scope, per mandate).

## 9. BUILD / LINT / REGRESSIONS

- `npx tsc --noEmit`: clean. `npm run build` (nest): clean.
- ESLint on every changed/added file: **zero regressions** — all touched files either lint-clean
  (0 problems) or carry exactly their pre-existing HEAD baseline debt, measured via in-repo
  baseline copies (`customer-funding.service.ts` 112, `v1-capability-registry` spec 16,
  service files 2–9, `customer-transaction-history.service.ts` 7 — all IDENTICAL at HEAD).
  Both new source files and the new suite are lint-clean.
- **Full integration battery: 65/65 suites, 1358/1358 tests** (real PostgreSQL 18.4, embedded).
- **Full unit battery: 1778/1780 passed** — the 2 failures are
  `test/external-reconciliation.service.spec.ts`, **proven pre-existing at base `e467954`**
  (documented in `docs/SMS-V1-VERIFICATION-REPORT.md`; identical count/state at that base —
  untouched by this work).
- Test-patch hygiene: semantic-only diffs (prettier reflow noise reverted; per-file numstat
  reviewed).

## 10. MIGRATIONS

| Before | +1 | After | Chain head | Notes |
|---|---|---|---|---|
| 75 | `1785753600075-AddTransferFeeColumns` | **76** | `AddTransferFeeColumns1785753600075` | additive (`ADD COLUMN` + CHECKs + defaults); `down()` provided; production-readiness expected head updated |

## 11. GIT STATE

Recorded after push: HEAD hash, local==remote, tree clean, migration count 76 (see commit
report block below this line).

- Commit: `5897724` (`feat(commerce): V1-COMMERCIAL-IMPLEMENTATION-01 fee engine runtime wiring`)
  on `arena/01a0d883-monienaija`, branched from base `9870155`.
- Migrations: **76** (75 + `1785753600075-AddTransferFeeColumns`), chain head
  `AddTransferFeeColumns1785753600075`.
- Working tree clean at commit time; all 40 changed files staged & committed.
- Push to `origin/arena/01a0d883-monienaija` was attempted and **blocked by an expired
  GitHub token in the sandbox** (`GH_TOKEN` no longer valid — environment-level, not a repo
  condition). Local==remote verification will be run the moment the GitHub connection is
  re-established; nothing further is required from the codebase.

## 12. REMAINING DEPENDENCIES (explicit, none hidden)

1. **Fee-revenue ledger account family** (§6) → enables fee/vat journal legs + flipping
   `transfers.fee_minor`/c2c slots from `'0'` to the collected amount + removing the
   `posting.reason` blocker.
2. **Approved production pricing policy** (provisional rates stay test-only) → enables seeding
   first real `fee_rules` rows; funding products remain FREE unless policy says otherwise.
3. **Rounding-family final decision** (provisional: FLOOR on percentage path — explicitly
   evidenced per decision).
4. **KYC targeting schema/policy** (§7).
5. **Customer disclosure payload wiring** for the computed (unposted) fee (§8) — no UI exists.
6. `FeeEngine` (src/fee façade, `POST /fees/calculate`) remains untouched/unwired by design —
   runtime computation goes through resolver → calculator only.
