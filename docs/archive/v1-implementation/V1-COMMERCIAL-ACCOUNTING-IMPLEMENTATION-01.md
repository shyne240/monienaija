# V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01 — Fee Revenue + Commission Accounting

Implementation report for the approved decisions (DP-01=B, DP-02=A, DP-03=B, DP-05 configurable,
DP-07 configurable, DP-15=A, DP-30=B, DP-31=A). This document describes only what exists in the
tree; where a boundary is deliberate it is stated as such.

## 1. Architecture

Flow completion (WALLET_TRANSFER / WALLET_TO_CASH / CASH_TO_WALLET / CASH_TO_CASH initiation)
→ commercial fee decision (FeeRuleCalculatorService, single authority)
→ commission decision (CommissionEngine, single authority)
→ **CommercialAccountingService.postForCompletion(manager, input)**
→ one dedicated ledger journal via `LedgerService.postJournalInTransaction`
→ posting outcome merged into the decision evidence objects (annotators)
→ commercial decision snapshot persisted with truthful posting evidence.

Everything after the decisions runs inside the flow's existing `dataSource.transaction('SERIALIZABLE')`
manager. There is no worker, no second commit, no async posting.

### Module layout (`src/commercial-accounting/`)

- `commercial-accounting.module.ts` — imports `LedgerModule`; registers/exports the three providers
  and the registry entity.
- `commercial-accounting.service.ts` — the only accounting writer. Composes legs, enforces every
  fail-closed gate, posts exactly one journal per completion event, returns structured posting
  evidence (`AccountingOutcome`).
- `commercial-accounting-config.service.ts` — reads the four env keys **fresh on every call**;
  invalid present values throw; absent values stay `null` (callers fail closed when a decision
  needs them).
- `commercial-accounting-registry.service.ts` / `…-registry.entity.ts` — DP-31 governance gate:
  `resolveRequiredAccountInTransaction` requires (1) registry row present, (2) registry account
  code equals the approved code map, (3) ledger account provisioned, (4) geometry match
  (type/normal balance/currency/accounting unit), (5) account active — each gap is a distinct
  blocker.
- `commercial-accounting.enums.ts` — VAT treatment, commission treatment, commission timing,
  family-role vocabulary (closed sets).
- `commercial-decision-accounting.annotators.ts` — pure functions
  (`annotateFeeDecisionWithPosting`, `annotateCommissionDecisionWithPosting`) that attach posting
  evidence to the authoritative decisions; they never recompute amounts.

### Wiring sites (all `@Optional()`, all gated by `isEnabled()`)

- `src/transfer/transfer.service.ts` (~L574) — WALLET_TRANSFER; payer = source wallet
  (`feePayerLedgerAccountId` supplied directly).
- `src/agent/agent-financial-execution.service.ts` (~L507) — CASH_TO_WALLET (cash-in) and
  WALLET_TO_CASH (cash-out); payer = principal; agent allocations backfilled with ctx.agentId.
- `src/agent/agent-cash-to-cash.service.ts` (~L702) — CASH_TO_CASH initiation; payer = initiating
  agent wallet; `commissionEvent: 'CASH_TO_CASH_INITIATION'`.
- `src/app.module.ts`, `src/transfer/transfer.module.ts`, `src/agent/agent.module.ts` import
  `CommercialAccountingModule`.
- `src/config/environment.ts` declares the four optional keys (zod-validated).

Flow services contain **zero treatment literals** (source-scan asserted by test 32) — the strategy
boundary is dedicated.

## 2. Configuration (all optional; master default OFF)

| Env key | Values | Semantics |
|---|---|---|
| `COMMERCIAL_ACCOUNTING_ENABLED` | `true`/`false` (default false) | master switch; false = inert, byte-identical legacy posture |
| `COMMERCIAL_ACCOUNTING_VAT_TREATMENT` | `EXCLUSIVE_ADD_ON` / `INCLUSIVE_IN_FEE` | must be set whenever a fee>0 decision exists, else abort |
| `COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT` | `EXPENSE_PAYABLE` / `AGENT_WALLET_NETTING` / `CONTRA_REVENUE` | must be set whenever a nonzero ALLOCATED decision exists |
| `COMMERCIAL_COMMISSION_RECOGNITION_TIMING` | `AT_COMPLETION` / `ACCRUE_NOW_SETTLE_LATER` | must pair with the treatment (see §5) |

The **VAT rate never lives here**: it comes only from fee-rule configuration (`fee_rules.vat_bps`,
nullable, CHECK 0–10000). No rate is hard-coded anywhere in the accounting layer or its migration.

## 3. Provisioned accounts (migration 1785753600076 — DP-30=B / DP-31=A)

`FINANCE-FEE_REVENUE-NGN` (REVENUE/CREDIT), `FINANCE-VAT_PAYABLE-NGN` (LIABILITY/CREDIT),
`FINANCE-COMMISSION_EXPENSE-NGN` (EXPENSE/DEBIT), `FINANCE-COMMISSION_PAYABLE-NGN`
(LIABILITY/CREDIT) — `CUSTOMER_FUNDS` unit, `allow_negative_balance=false`, `is_active=true`,
each with a `commercial_accounting_registry` evidence row (`evidence_source =
HUMAN-DECISIONS@V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01`, decision references, provisioner).
Codes follow the pre-existing FINANCE-* convention; nothing existing is repurposed; the migration
contains no rates. `down()` removes registry rows, accounts, and the registry table.

## 4. Fee + VAT accounting (DP-01=B / DP-02=A / DP-03=B / DP-15=A)

Trigger: fee decision `status === 'APPLIED'` and `feeMinor > 0`. Product guard: only the four
fee-bearing V1 products may post (`COMMERCIAL_FEE_ACCOUNTING_PRODUCT_UNSUPPORTED` otherwise, e.g.
funding products can never receive a fee leg).

- Payer: explicit `feePayerLedgerAccountId` when the flow knows it, else resolved from
  `wallet_accounts(customerId, 'NGN')`; missing/inactive → `COMMERCIAL_FEE_PAYER_*` blockers.
- Rate provenance: `ruleRefs[0].vatBps` (null preserved — the calculator's coerced-0 convention is
  NOT authoritative for the unset-rate gate). Missing rate with fee>0 →
  `COMMERCIAL_VAT_RATE_NOT_CONFIGURED`; unset treatment with fee>0 →
  `COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED` — never silently zero.
- `EXCLUSIVE_ADD_ON`: VAT leg = authoritative decision `vatMinor`, cross-checked against
  `fee*bps/10000` floor (`COMMERCIAL_VAT_DECISION_MISMATCH` aborts on drift); payer debited
  fee+VAT; revenue CR = fee; VAT payable CR = VAT (only when >0).
- `INCLUSIVE_IN_FEE`: VAT = `fee*bps/(10000+bps)` floor carved out of the fee; revenue = remainder
  (degenerate remainder aborts: `COMMERCIAL_VAT_MISCALIBRATED`); payer debited fee only.
- `vat_bps = 0` is an explicit exemption: revenue-only legs, no VAT leg.
- Nothing posts when there is no fee: explicit `ZERO_FEE_NO_LEGS_POSTED` evidence instead.

## 5. Commission accounting (DP-05 / DP-07)

Trigger: commission decision `status === 'ALLOCATED'` with at least one non-zero allocation
(zero-amount all-zero decisions produce `ZERO_AMOUNT_NO_LEGS_POSTED` evidence only).

- Beneficiary scope: AGENT only. AGGREGATOR / PLATFORM / other types abort with precise blockers
  (V1 scope invariants; V2 rails).
- Unset treatment → `COMMERCIAL_COMMISSION_ACCOUNTING_TREATMENT_NOT_CONFIGURED`; unset timing →
  `COMMERCIAL_COMMISSION_TIMING_NOT_CONFIGURED`; inconsistent pairing →
  `COMMERCIAL_COMMISSION_ACCOUNTING_CONFIG_INCONSISTENT` (both directions checkable).
- `EXPENSE_PAYABLE` × `ACCRUE_NOW_SETTLE_LATER`: DR COMMISSION_EXPENSE total / CR
  COMMISSION_PAYABLE total; evidence marks settlement as V2 scope (no payout rail exists).
- `AGENT_WALLET_NETTING` × `AT_COMPLETION`: DR expense total / CR each AGENT beneficiary's wallet
  at its allocated amount (null beneficiary id or unavailable wallet aborts — nothing is faked).
- `CONTRA_REVENUE`: the configuration model is recorded, posting fails closed
  (`COMMERCIAL_CONTRA_REVENUE_ACCOUNTING_NOT_SUPPORTED`) — a contra-capable family is not
  creatable under the ledger's normal-balance enforcement and none is invented or repurposed.

## 6. CASH_TO_CASH single-commission guarantee

One economic commission per C2C transfer, at INITIATION (`commissionEvent:
'CASH_TO_CASH_INITIATION'`), inside initiation's SERIALIZABLE transaction. The claim service
does not import the commission engine or the accounting service at all and records
`commissionDecision: commissionNone()`; the expiry service has no commercial references. The
dedicated accounting journal key (`agent:{agent}:{idem}:commercial-accounting`) plus the ledger's
unique idempotency key make a second journal for the same initiation impossible.

## 7. Atomicity, idempotency, concurrency (DP-15=A)

All accounting writes use the same `EntityManager` as the principal journal and the decision
snapshot; any blocker throws and rolls back the entire operation (verified by forcing a downstream
failure — test 08). Journals are balanced by ledger invariant (Σ DR == Σ CR) and normal-balance
geometry is enforced at account level. Idempotency: `<flow-ledger-key>:commercial-accounting`
unique key + requestHash conflict detection; concurrent replays deterministically converge on one
journal (tests 06/07). Flows retry SERIALIZABLE failures with the bounded retry loop already in
place.

## 8. Tests

`test/v1-commercial-accounting-01.integration.spec.ts` (real PostgreSQL, real services): 33 proofs
— fee legs/pooled revenue/zero-fee/principal untouched/balanced/idempotency/concurrency/atomic
rollback/per-product pooling/C2C/VAT treatments/VAT fail-closed/commission treatments and
timing/mismatch/timing unset/zero-amount/C2C single event/aggregator+platform
scope/migration+registry governance/account exclusivity/disabled posture/strategy boundary.
Result at consolidation: **33/33 PASS**. `tsc --noEmit` and `npm run build` clean.

## 9. Known boundaries (not bugs)

- INCLUSIVE VAT derived from the authoritative rule rate (calculator `vatMinor` is exclusive-style).
- EXPENSE_PAYABLE accrual has no V1 settlement execution (V2 scope — explicit in evidence).
- CONTRA_REVENUE intentionally cannot post today (configuration model only).
- Customer/agent funding flows deliberately outside fee accounting product scope.
- Default-off: enabling production requires explicit review + approval and the full config set.
