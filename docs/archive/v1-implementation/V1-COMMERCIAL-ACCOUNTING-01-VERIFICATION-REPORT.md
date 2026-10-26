# V1-COMMERCIAL-ACCOUNTING-01 — Commercial Accounting Activation: Verification Report

**Branch:** `arena/01a0d883-monienaija`
**Base commit:** `84354945` (`docs(commercial): add accounting decision review`)
**Date:** 2026-09-29

> Note: this report was rewritten during V1-COMMERCIAL-ACCOUNTING-01-CONSOLIDATION-01 after an
> environment crash-recovery audit. An earlier draft described a different (strategy/helpers-based)
> architecture that does not exist in this tree; that draft has been replaced. Everything below
> describes the actual surviving implementation.

## 1. Executive summary

The approved accounting decisions are runtime-enforced by a dedicated, config-gated
`CommercialAccountingService` (`src/commercial-accounting/`). It posts real double-entry journals
**inside the existing SERIALIZABLE completion transactions** of the fee/commission-bearing V1 flows
(WALLET_TRANSFER, WALLET_TO_CASH, CASH_TO_WALLET, CASH_TO_CASH initiation) onto four
migration-provisioned `FINANCE-<ROLE>-NGN` ledger accounts, governed by a registry table
(`commercial_accounting_registry`) with fail-closed geometry checks. VAT treatment and commission
treatment/timing are explicit runtime configuration; the rate comes only from authoritative fee-rule
configuration; every missing or inconsistent configuration aborts the financial transaction
(fail closed, DP-15). The default posture (`COMMERCIAL_ACCOUNTING_ENABLED` unset/false) is inert:
zero journal writes, byte-identical legacy evidence shape. A 33-test proof suite on real PostgreSQL
passes 33/33; `tsc --noEmit` and `npm run build` are clean.

## 2. Implementation inventory (actual files)

- `src/commercial-accounting/commercial-accounting.module.ts` — boundary module; inert unless enabled.
- `src/commercial-accounting/commercial-accounting.service.ts` (~531 lines) — composition + posting:
  fee/VAT legs, commission legs, fail-closed blockers, one linked journal via
  `LedgerService.postJournalInTransaction`.
- `src/commercial-accounting/commercial-accounting-config.service.ts` — runtime-fresh read of the 4
  env keys; present-but-invalid values fail closed; absence is never coerced (null treatment/timing).
- `src/commercial-accounting/commercial-accounting-registry.service.ts` — DP-31 governance gate:
  registry row required; code-map match; account provisioned; geometry match; active.
- `src/commercial-accounting/commercial-accounting-registry.entity.ts` — registry table entity.
- `src/commercial-accounting/commercial-accounting.enums.ts` — `CommercialVatTreatment`
  (EXCLUSIVE_ADD_ON/INCLUSIVE_IN_FEE), `CommissionAccountingTreatment`
  (EXPENSE_PAYABLE/AGENT_WALLET_NETTING/CONTRA_REVENUE), `CommissionRecognitionTiming`
  (AT_COMPLETION/ACCRUE_NOW_SETTLE_LATER), `CommercialAccountingFamilyRole` (four roles).
- `src/commercial-accounting/commercial-decision-accounting.annotators.ts` — pure merges of posting
  outcome into the decision evidence objects (nothing recomputed).
- `src/migrations/1785753600076-ProvisionV1CommercialAccountingFamilies.ts` — deterministic
  provisioning + registry evidence (no rates anywhere).
- Wiring (additive, +136/-0 across 7 files): `src/app.module.ts`, `src/transfer/transfer.module.ts`,
  `src/transfer/transfer.service.ts` (site ~L574), `src/agent/agent.module.ts`,
  `src/agent/agent-financial-execution.service.ts` (site ~L507),
  `src/agent/agent-cash-to-cash.service.ts` (site ~L702), `src/config/environment.ts` (4 optional keys).
- `test/v1-commercial-accounting-01.integration.spec.ts` (1339 lines; 33 proofs, real PG).
- Chain-pin updates: `src/production/production-readiness.service.ts` +
  `test/production-readiness.spec.ts` + `test/migration-chain.integration.spec.ts` (77) + 16 suites
  whose hard-coded migration-head/county assertions now include …076 (strictly additive).
- Docs: this report refreshed; `docs/V1-COMMERCIAL-ACCOUNTING-IMPLEMENTATION-01.md` created.

## 3. Accounts and provisioning

| Role | Code | Type | Normal balance | Purpose |
|---|---|---|---|---|
| FEE_REVENUE | FINANCE-FEE_REVENUE-NGN | REVENUE | CREDIT | pooled fee revenue (DP-01=B), at completion (DP-02=A) |
| VAT_PAYABLE | FINANCE-VAT_PAYABLE-NGN | LIABILITY | CREDIT | VAT payable for VAT-bearing fees (DP-03=B) |
| COMMISSION_EXPENSE | FINANCE-COMMISSION_EXPENSE-NGN | EXPENSE | DEBIT | commission expense (both posting treatments) |
| COMMISSION_PAYABLE | FINANCE-COMMISSION_PAYABLE-NGN | LIABILITY | CREDIT | standing payable for EXPENSE_PAYABLE + ACCRUE_NOW_SETTLE_LATER |

Migration creates `commercial_accounting_registry` + one `ledger_accounts` row and one registry row
per family in one transaction; `allow_negative_balance=false`; no rate fields exist in the migration.
Codes follow the existing `FINANCE-<ROLE>-<CURRENCY>` convention (AR-control precedent); no existing
account is repurposed (test 30 verifies exclusivity across all accounting journals).

## 4. Runtime behavior (verified by tests 01–32)

- **Fee revenue:** payer wallet DR / FEE_REVENUE CR the authoritative fee decision amount; zero-fee
  decisions produce no legs with explicit evidence; principal journals untouched (byte-identical).
- **VAT:** EXCLUSIVE_ADD_ON — VAT leg equals the authoritative decision `vatMinor` with a
  deterministic recomputation cross-check (`COMMERCIAL_VAT_DECISION_MISMATCH` on drift); payer is
  debited fee+VAT. INCLUSIVE_IN_FEE — VAT carved from the fee (`fee*bps/(10000+bps)`, floor),
  revenue = remainder; payer debited fee only. Rate provenance: rule `vat_bps`; NULL with fee>0 →
  `COMMERCIAL_VAT_RATE_NOT_CONFIGURED` (never silently zero); explicit `vat_bps=0` → no VAT leg.
  Unset treatment with fee>0 → `COMMERCIAL_VAT_TREATMENT_NOT_CONFIGURED`.
- **Commission:** EXPENSE_PAYABLE (pairing ACCRUE_NOW_SETTLE_LATER) → DR expense / CR payable with
  V2-scope-settlement evidence; AGENT_WALLET_NETTING (pairing AT_COMPLETION) → DR expense / CR
  agent wallet per allocation; CONTRA_REVENUE → configuration model recorded, posting fails closed
  (`COMMERCIAL_CONTRA_REVENUE_ACCOUNTING_NOT_SUPPORTED`). Unset treatment/timing and any
  treatment×timing inconsistency abort. AGGREGATOR/PLATFORM allocations fail closed (V1 scope).
- **C2C:** single commission accounting event at initiation; claim records `commissionNone()` and
  has no commission engine or accounting service imported; expiry has none either (tests 10/24).
- **Atomicity (DP-15):** every blocker throws inside the flow's SERIALIZABLE transaction; test 08
  proves a downstream failure rolls back accounting + snapshot + journal together.
- **Idempotency:** dedicated journal key `<flow-ledger-key>:commercial-accounting` under the
  ledger's unique key + requestHash conflict detection; serial replay and concurrent replays both
  yield exactly one accounting journal (tests 06/07).
- **Disabled posture:** test 31 — zero accounting rows, byte-identical legacy evidence shape.

## 5. Verification evidence

| Gate | Result |
|---|---|
| `test/v1-commercial-accounting-01.integration.spec.ts` | **33/33 PASS** (~41 s, real PG 18.4) |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean |
| Reconciled suites `v1-capability-registry` + `v1-limit-02` | 37/37 PASS |
| Pre-crash full integration battery (67 suites, chunked) | 1413 passed / 2 failed — the 2 failures were exactly the two stale chain-count assertions reconciled in §2 (now passing) |
| Unit battery `npm test` (pre-crash) | 1778/1780; both failures in `external-reconciliation.service.spec.ts`, reproduced on the pristine base (pre-existing, unrelated) |

## 6. Boundaries and non-claims

- CONTRA_REVENUE is a recorded configuration model only; posting refuses with a precise blocker
  (no contra-capable family is creatable under the ledger's normal-balance contract).
- INCLUSIVE_IN_FEE computes the VAT leg from the authoritative rule rate (the calculator's
  `vatMinor` carries exclusive-style semantics); documented in the service.
- Settlement execution (paying out the standing payable) is V2 scope; nothing pays out.
- No rewards implementation, no aggregator payout execution, no V2 external settlement, no
  reconciliation subsystem — none added.
- C2C claim and expiry cannot create a second commission (structurally: no engine/accounting on
  those paths).
- Production enable requires `COMMERCIAL_ACCOUNTING_ENABLED=true` plus explicit treatment/timing
  values — reviewed and approved before enablement.
