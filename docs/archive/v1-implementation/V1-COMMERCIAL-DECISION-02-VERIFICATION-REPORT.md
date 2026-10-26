# V1-COMMERCIAL-DECISION-02 — Pilot Commercial Snapshot Wiring (WALLET_TRANSFER): Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `1975dc8887337f9cef3c8071220e0787a2afd256` (V1-COMMERCIAL-04) — verified against git.
**Parent note (transparency):** git reports the parent of `1975dc8` as `2b1e58a3fce1673a4d6b471042a75d87d4536685` (V1-COMMERCIAL-03). The brief listed the parent as `2b1e58a3fce1673a4d6b471042a75d87a4afd256` — same `2b1e58a` prefix but different trailing bytes. This is a transcription discrepancy in the brief only; git confirms the parent is exactly the intended V1-COMMERCIAL-03 commit, so work proceeded.
**Final HEAD:** this task's commit (single commit on top of `1975dc8`).
**Migration count:** **73 — UNCHANGED.** No migration was needed; the existing snapshot schema expresses everything the pilot records. No schema defects discovered.
**Verdict:** PILOT WIRED AND VERIFIED — WALLET_TRANSFER only. Zero charging, zero commercial policy invented, V1 remains fee-free.

---

## 1. Exact flow wired

**WALLET_TRANSFER (Customer Wallet → Customer Wallet) via `TransferService.createTransfer` — and no other flow.** git diff verified: no other flow service (cash-in/out, cash-to-cash, customer/agent funding) was touched.

## 2. Exact transaction boundary used

The EXISTING boundary — `TransferService.createTransfer` wraps everything in one
`dataSource.transaction('SERIALIZABLE', manager => executeWithinTransaction(manager, ...))`
with up to 3 attempts on serialization failures (40001/40P01). **No second transaction was created.** Existing order preserved:

```
idempotency check → wallet locks (pessimistic, ordered) → transfer row (FAILED until proven)
→ wallet/currency validation → limit enforcement (enforceWithManager) → ledger journal
(DEBIT source / CREDIT destination) → limit reservation commit
→ [NEW] fee resolution + commercial snapshot  → mark COMPLETED + audit + outbox + metrics → COMMIT
```

**Snapshot placement decision (documented, not blindly imposed):** the snapshot is recorded AFTER the ledger posts and limits commit, immediately before the COMPLETED save. Rationale: snapshots are trigger-protected against UPDATE/DELETE, so one recorded earlier could never be removed on the `markFailed` business-failure path (e.g. insufficient funds commits a FAILED transfer row); recording at the success point guarantees (a) success → ledger + limits + snapshot commit atomically, (b) any downstream exception → everything rolls back together, (c) failed transfers never leave a misleading snapshot. This preserves all current financial safety invariants while satisfying the brief's atomicity requirements.

- `recordDecisionWithManager(manager, …)` is called in `TransferService.recordCommercialDecisionSnapshot` — the manager-bound variant, inside the existing SERIALIZABLE transaction. The second-transaction `recordDecision(…)` is NOT used (proven by source assertion).
- `resolveWithManager(manager, { productCode: 'WALLET_TRANSFER', currency, at: decisionAt })` is called immediately before snapshot recording, inside the same transaction. Its result is EVIDENCE ONLY — no calculation, no charging.

## 3. Snapshot fields populated (success path)

| Field | Value |
|---|---|
| idempotencyKey | `transfer:<transferId>` (scoped to the transfer row; snapshot-service replay semantics reused, no second identity mechanism) |
| product | `WALLET_TRANSFER` |
| direction | `OUTGOING` (principal = source customer) |
| principalType / principalId | `CUSTOMER` / source wallet's customer UUID |
| currency / principalAmountMinor | transfer currency / exact principal |
| transactionReference / correlationId | transfer id / `transfer:<transferId>` |
| journalId | the posted journal |
| decisionStatus / decidedAt / finalizedAt | `FINAL` / decision timestamp / decision timestamp |
| feeDecision | `feeNotConfigured(currency, principal)` — status **NOT_CONFIGURED**, feeMinor 0, totalMinor = principal; plus `ruleRefs` evidence when a rule resolves (see §6) |
| commissionDecision | `commissionNone()` — `{ status: 'NONE', allocations: [], ruleRefs: [] }` |
| rewardDecision | `rewardNone()` — `{ status: 'NONE', grants: [], ruleRefs: [] }` |
| revenueDecision | `null` (existing reserved representation; nothing invented) |
| limitDecision | authoritative live outcome (below) |
| configurationVersion | `null` — no invented configuration version |
| createdBy | `transfer-service` |

## 4. Limit evidence captured (authoritative, never re-evaluated)

`TransferService` now CAPTURES the existing `EnforceResult` from the live `enforceWithManager` call (previously discarded). The limit section is built only from that result:

- `status: 'APPROVED'` with `profileCode`, `assignmentId`, `ruleRefs` (every rule the enforcement evaluated, with ruleId + dimension + limit values), `reservationIds`, `usageIds` — all pointing at the rows THIS enforcement created/selected.
- Additive change to `EnforceResult` (the smallest change that exposes already-authoritative evidence): new optional fields `assignmentId`, `ruleRefs`, `reservationIds`, `usageIds`; the reservation INSERT now `RETURNING id`; replay paths report existing reservation/usage ids. **No limit logic changed** — full limit regression suite passes.
- No profile/applicable rules → `APPROVED` with null profile + empty evidence (enforcement ran and allowed). Limit service absent/non-customer principal → `limitNotEvaluated()`.
- Failed transfers (limit breach, insufficient funds, etc.) record **no snapshot** — existing failure semantics unchanged; the durable FAILED transfer row + audit remain the failure record.

## 5. Idempotency behavior

- Transfer-level idempotency is untouched and authoritative: replay with identical payload returns the existing transfer BEFORE reaching limit/ledger/snapshot code → exactly one snapshot ever per transfer (proven; usage counters not double-counted).
- Key reuse with a different payload → 409 (proven unchanged).
- Snapshot identity reuses the snapshot service's existing `uq_commercial_decision_idempotency` contract with fingerprint replay — no second mechanism; the key is transfer-scoped so a replayed transfer can never create a second ORIGINAL snapshot.

## 6. Fee decision semantics — NOT_CONFIGURED stays distinct

- Production has ZERO fee rules ⇒ `fee_decision.status = NOT_CONFIGURED`, `feeMinor = 0`, `ruleRefs = []`. **No synthetic zero-fee rule was created; NOT_CONFIGURED is never converted into ZERO.**
- Synthetic TEST-ONLY rule (created inside the disposable test DB only): status REMAINS `NOT_CONFIGURED` (V1 is fee-free; DECISION-01 precedent: "ruleRefs can already reference the registry row for future APPLIED decisions") while `ruleRefs[0]` captures the exact `ruleId`, `ruleVersion`, flat/percentage/min/max/vat and effective window/priority. The money flow is provably unchanged (exactly two journal lines, both the principal).
- `AMBIGUOUS` resolution (same-priority overlap) is recorded honestly as `resolutionStatus: 'AMBIGUOUS'` + `ambiguousRuleIds` — the resolver never silently picks, and the pilot never charges.

## 7. Rollback proof (test 05)

Outbox write for `transfer.completed` forced to throw AFTER the snapshot was recorded in-transaction:
- snapshot count = 0, transfer row = 0, limit_reservations = 0, limit_usages = 0, journal count unchanged, both wallet balances unchanged.
The snapshot is genuinely inside the same SERIALIZABLE boundary.

## 8. Success atomicity proof (tests 01/02/03)

Successful W→W ⇒ ledger journal committed, limit usage at terminal state (used = amount, reserved = 0, reservations COMMITTED), and exactly ONE FINAL snapshot referencing the exact transfer id + journal id.

## 9. Zero-fee financial proof (test 02)

Transfer journal contains exactly 2 lines — DEBIT source = principal, CREDIT destination = principal. No fee line, no fee/revenue account created (ledger_accounts count unchanged), wallet balances move by exactly ±principal.

## 10. API impact

**None created.** No customer API, no quote endpoint, no duplicate read API. The existing workforce-only diagnostic `GET /api/v1/internal/commercial-decision-snapshots` verifies the pilot snapshot (test 10). No route-policy changes.

## 11. Capability Registry changes

- **COMMERCIAL_DECISION_SNAPSHOT** (v2→3): lifecycle BACKEND_IMPLEMENTED → **API_READY**, **enabled: true** — pilot runtime capture live for WALLET_TRANSFER only; configurationStatus stays **NOT_CONFIGURED** (no commercial policy); blocker text documents the pilot scope and that the other 7 flows remain future work.
- **FEE_RULE_RESOLVER** (v1→2, text only): blocker/notes updated — the resolver participates READ-ONLY in the pilot as snapshot evidence; still calculates/charges nothing.
- **Untouched:** FEE_ENGINE (DISABLED/enabled=false), COMMISSION_ENGINE, REWARD_ENGINE, and every other entry. No claim that commercial pricing is enabled anywhere.
- Guard spec `v1-capability-registry` test 07 updated to assert the new justified pilot state.

## 12. Files changed (7; git diff inspected — no unrelated changes)

| Path | Change |
|---|---|
| `src/transfer/transfer.service.ts` | pilot wiring: capture EnforceResult; resolve + recordDecisionWithManager after ledger/limit commit; @Optional deps |
| `src/transfer/transfer.module.ts` | imports CommercialDecisionModule + FeeRulesModule |
| `src/limit-catalog/limit-enforcement.service.ts` | additive EnforceResult evidence (ruleRefs/reservationIds/usageIds/assignmentId) |
| `src/capability-registry/capability.seed.ts` | COMMERCIAL_DECISION_SNAPSHOT pilot status; FEE_RULE_RESOLVER text |
| `test/v1-commercial-decision-02-pilot-snapshot.integration.spec.ts` | NEW — 10 pilot tests |
| `test/v1-capability-registry.integration.spec.ts` | guard updated to justified pilot state |
| `test/v1-commercial-04-fee-rule-resolver.integration.spec.ts` | wiring-boundary guard updated (pilot is the ONLY consumer; still evidence-only) |

**NOT touched:** migrations (0 changed), snapshot schema/service/trigger, FeeEngine, all other flow services, limit engine logic, ledger/wallet code.

## 13. Test counts (real PostgreSQL 18.4)

**New pilot suite — 10/10 passed**, covering: exactly-one snapshot + all fields (01), zero-fee ledger proof (02), replay non-duplication (03), key/payload clash 409 (04), rollback atomicity (05), synthetic rule capture without financial change (06), immutability (07), no-limit-config path (08), limit-rejected leaves no snapshot + existing failure semantics (09), workforce diagnostic read (10). These map to all 20 required coverage areas (19/20 "existing behavior intact" additionally proven by the a5/limit-04/limit-05 regressions below).

| Regression | Result |
|---|---|
| W→W: a5-transfer-lifecycle, v1-limit-04-limit-runtime, v1-limit-05-flow-matrix | PASS |
| Commercial: decision-01, commercial-02, commercial-03, commercial-04 | PASS |
| Limits: 01 / 02 / 03 | PASS |
| Capability registry + migration chain (73, unchanged) | PASS |
| Focused total | 410/410 across the 12 named suites (after the two justified guard updates) |
| **Full integration suite** | **55/55 suites, 1242/1242 tests** (was 54/1232) |
| Unit suite | 1764/1766 — the 2 pre-existing `external-reconciliation` failures, unchanged |
| `tsc --noEmit` / `npm run build` | exit 0 / exit 0 |
| ESLint — files created/modified by this task | new spec + module + seed: 0 errors 0 warnings; errors reported in transfer.service.ts / limit-enforcement.service.ts / capability-registry spec all map line-by-line to PRE-EXISTING code outside this task's diff hunks (repo-wide lint baseline already failing — honest report) |

## 14. Financial safety

The ONLY new persistent financial-adjacent artifact is the intended commercial_decision_snapshots row for completed W→W transfers. Wallet balances, ledger accounts/journals/lines, limit behavior and customer transaction semantics verified unchanged by the full 1242-test integration run + explicit ledger/balance assertions in the pilot suite.

## 15. Remaining commercial decisions (carried, unchanged)

- UD-CD2: actual fee rates/VAT/pricing per product.
- UD-FR1: KYC/agent-class/segment fee eligibility.
- UD-FR2: same-priority tie-break policy (resolver returns AMBIGUOUS until approved; pilot records the ambiguity honestly).
- UD-FR3: VAT treatment. UD-FR4: tiered pricing.
- UD-CD2a (new, minor): whether limit-REJECTED (and other failed) transfers should ever record durable REJECTED snapshots — intentionally NOT done in this pilot (failed transfers keep existing semantics).

## 16. Exact next dependency

**Extend snapshot capture to the remaining V1 flows** (the six other catalogue products — CASH_TO_WALLET, WALLET_TO_CASH, CASH_TO_CASH, CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING — plus the agent cash-to-cash claim path) one at a time using the exact pattern proven here (`resolveWithManager` + `recordDecisionWithManager` inside each flow's existing SERIALIZABLE boundary, authoritative limit evidence, NOT_CONFIGURED fee decisions), OR — if product prefers policy before breadth — approve the first production fee policy so the resolver/snapshot infrastructure records APPLIED decisions. Either way, charging remains a separately-approved future task; nothing here enables fees.
