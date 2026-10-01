# V1-COMMERCIAL-DECISION-03A — CASH_TO_WALLET Commercial Snapshot Wiring: Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `78abf7379fe346189f504e6a1a7be6f028bc9ecf` (V1-COMMERCIAL-DECISION-02) — verified.
**Parent (verified via `git rev-parse HEAD^`):** `1975dc8887337f9cef3c8071220e0787a2afd256` (V1-COMMERCIAL-04). No discrepancy.
**Final HEAD:** this task's commit (single commit on top of `78abf73`).
**Migration count:** **73 — UNCHANGED.** No schema deficiency found; zero migrations.
**Verdict:** CASH_TO_WALLET wired and verified with the proven pilot pattern. Integration-only: zero charging, zero policy invented, authorization/financial behavior byte-for-byte unchanged. WALLET_TO_CASH and all other flows untouched.

---

## 1. Exact CASH_TO_WALLET transaction boundary (inspected, preserved)

`AgentCashInService.execute` performs recipient resolution, customer eligibility, A11 authorization (Agent capability + PIN), and wallet assurance OUTSIDE any transaction, then delegates to the shared **`AgentFinancialExecutionService.execute`**, whose single `dataSource.transaction('SERIALIZABLE', …)` (with bounded 3-attempt serialization retry) is the flow's existing boundary:

```
idempotency reserve (pessimistic; REPLAY → early return) → Agent-wallet participation check
→ limit enforcement (enforceWithManager) → ledger journal (DEBIT Agent / CREDIT Customer)
→ limit reservation commit → [NEW snapshot] → idempotency complete → audit → COMMIT
```

No second transaction, no async snapshot. **`resolveWithManager(manager, { productCode: 'CASH_TO_WALLET', currency, at })`** and **`recordDecisionWithManager(manager, …)`** are both called inside this same manager, in the new `recordCommercialDecisionSnapshot` helper invoked immediately after the limit-commit step and before the existing `_simulateFailureAfterJournal` hook — mirroring the WALLET_TRANSFER placement rationale: snapshots are trigger-immutable, so recording at the success point guarantees atomic commit with the money movement, atomic rollback on downstream failure, and no snapshot for failed executions.

**Product gate:** the helper only acts when `input.limit.product === 'CASH_TO_WALLET'`. WALLET_TO_CASH shares this execution service but passes `WALLET_TO_CASH` → gate false → unchanged (source-asserted + a14 regression green). TransferService wiring (02) untouched.

## 2. Snapshot fields (success path)

| Field | Value |
|---|---|
| idempotencyKey | `cash-in:<agentId>:<callerIdempotencyKey>` — reuses the snapshot service's existing key/fingerprint replay contract; no second identity mechanism |
| product | `CASH_TO_WALLET` |
| direction / channel | `INCOMING` / null (per the flow's limit block) |
| principalType / principalId | `CUSTOMER` / recipient customerId — **the limit subject** (authoritative enforcement subject); the acting Agent is recorded as `fee_decision.agentId` evidence (jsonb contract allows extra keys) |
| currency / principalAmountMinor | NGN / exact principal |
| transactionReference / journalId / correlationId | journalId (the durable execution identity) / journalId / caller correlation id or null |
| decisionStatus / decidedAt / finalizedAt | `FINAL` / decision timestamp / decision timestamp |
| feeDecision | `feeNotConfigured(NGN, principal)` → **NOT_CONFIGURED**, feeMinor 0, totalMinor = principal, ruleRefs [] (+ `agentId` evidence; + ruleRefs / AMBIGUOUS evidence per §4) |
| commissionDecision / rewardDecision | `commissionNone()` / `rewardNone()` |
| revenueDecision / configurationVersion | `null` / `null` — nothing invented |
| limitDecision | authoritative live outcome (below) |
| createdBy | `agent-cash-in` |

## 3. Limit evidence source

The existing `enforceWithManager` result is now CAPTURED (`limitOutcome`) — previously discarded. The limit section is built ONLY from that `EnforceResult` (profileCode, assignmentId, ruleRefs with ruleId/dimension/limit values, reservationIds, usageIds). No second evaluation path exists.

## 4. Fee decision semantics

- Production: zero fee rules ⇒ `fee_decision.status = NOT_CONFIGURED`, `ruleRefs = []`. **Never ZERO; no synthetic zero-fee rule seeded.**
- Synthetic TEST-ONLY rule (disposable test DB): status REMAINS `NOT_CONFIGURED` while `ruleRefs[0]` captures exact `ruleId`, `ruleVersion`, flat/percentage parameters and effective window (DECISION-01 precedent) — and the money flow is provably unchanged (principal-only journal, exact balances).
- AMBIGUOUS resolution recorded honestly (`resolutionStatus` + `ambiguousRuleIds`); never silently picked, never charged.

## 5. Proofs (real PostgreSQL 18.4 — new suite 8/8)

- **Success atomicity (01):** exactly one FINAL snapshot; product CASH_TO_WALLET; transaction_reference = journalId; principal 30000 NGN; CUSTOMER/recipient principal; commission/reward NONE; revenue null; limit APPROVED with the seeded profile + exact rule ids + the real reservation/usage ids created by THIS execution; workforce diagnostic API lists it.
- **Zero-fee financial identity (02):** journal = exactly 2 lines — DEBIT Agent 22000, CREDIT Customer 22000; ledger_accounts count unchanged; balances move by exactly ±principal. No fee/revenue/commission/reward lines or accounts.
- **Replay (03):** identical replay → REPLAYED, same journalId, snapshot count stays 1, no duplicate ledger journal, customer credited once.
- **Key clash (04):** same key + different amount → 409; snapshot count unchanged.
- **Rollback (05):** `_simulateFailureAfterJournal` forces a REAL in-transaction failure after the snapshot: snapshot gone, reservations gone, usages gone, journal count unchanged, Agent/Customer balances unchanged, idempotency reservation rolled back.
- **Limit rejection (06):** DAILY_AMOUNT 20000 vs 30000 attempt → 422 LIMIT rejection; no snapshot, no stranded reservation/usage, zero balance movement — consistent with the WALLET_TRANSFER pilot semantics.
- **Synthetic rule (07):** ruleId/ruleVersion/parameters captured; nothing charged.
- **Immutability + wiring boundary (08):** UPDATE/DELETE blocked by trigger; explicit `CASH_TO_WALLET` product gate present; `.recordDecision(` never used; no FeeEngine; cash-out service contains no resolver/snapshot references.

## 6. Financial mutation comparison

Everything except the intended snapshot row is byte-identical: the full 1250-test integration run (including the complete pre-existing a13 CASH_TO_WALLET suite and a14 WALLET_TO_CASH suite) passes unchanged, plus explicit before/after balance, journal-line, ledger-account and idempotency assertions in the new suite. Authorization (A11 Agent capability + PIN), recipient resolution, customer eligibility, idempotency and limit behavior untouched — verified by those same suites.

## 7. Files changed (4 + report; git diff inspected — no unrelated changes)

| Path | Change |
|---|---|
| `src/agent/agent-financial-execution.service.ts` | capture EnforceResult; product-gated snapshot recording via resolveWithManager + recordDecisionWithManager inside the existing SERIALIZABLE tx; @Optional deps |
| `src/agent/agent.module.ts` | imports CommercialDecisionModule + FeeRulesModule |
| `src/capability-registry/capability.seed.ts` | COMMERCIAL_DECISION_SNAPSHOT scope text (v4): WALLET_TRANSFER + CASH_TO_WALLET; FEE_RULE_RESOLVER text (v3) — both still NOT_CONFIGURED/enabled=false pricing-wise |
| `test/v1-commercial-decision-03a-cash-to-wallet-snapshot.integration.spec.ts` | NEW — 8 tests |
| `docs/V1-COMMERCIAL-DECISION-03A-VERIFICATION-REPORT.md` | this report |

**NOT touched:** migrations (0), snapshot schema/service/trigger, TransferService, agent-cash-out/cash-to-cash/funding services, ledger/wallet code, FeeEngine, limit logic (EnforceResult additions came in DECISION-02).

## 8. Capability Registry changes

- **COMMERCIAL_DECISION_SNAPSHOT** (v3→4, statuses unchanged: API_READY / enabled=true / configurationStatus NOT_CONFIGURED): description/blocker/notes/test+doc references updated — pilot runtime now WALLET_TRANSFER **+ CASH_TO_WALLET**; remaining flows explicitly future work. The vocabulary supports this (free-text scope fields); no claim that all V1 flows are commercially wired.
- **FEE_RULE_RESOLVER** (v2→3, text only): read-only participation now covers both pilot flows; still calculates/charges nothing.
- **Untouched:** FEE_ENGINE (DISABLED/enabled=false), COMMISSION_ENGINE, REWARD_ENGINE, all others.

## 9. Test & regression results

| Check | Result |
|---|---|
| New CASH_TO_WALLET suite | **8/8 pass** (covers required areas 1–18; area 18 "existing tests green" = a13 below) |
| CASH_TO_WALLET existing suite (a13) | PASS |
| WALLET_TO_CASH existing suite (a14) | PASS (shared boundary unchanged) |
| Commercial: decision-01, decision-02, 02, 03, 04 | PASS |
| Limits: 01 / 02 / 03 / 04-runtime | PASS |
| Capability registry + migration chain (73) | PASS |
| Focused total | 264/264 across the 13 named suites |
| **Full integration suite** | **56/56 suites, 1250/1250 tests** (was 55/1242) |
| Unit suite | 1764/1766 — the 2 pre-existing `external-reconciliation` failures, unchanged |
| `tsc --noEmit` / `npm run build` | exit 0 / exit 0 |
| ESLint — files created/modified by this task | new spec/module/seed: **0 errors 0 warnings**; remaining reports in agent-financial-execution.service.ts map to pre-existing V1-LIMIT-04 code outside this task's diff hunks (repo-wide lint baseline already failing — honest) |

## 10. Unresolved commercial decisions (carried, unchanged — none resolved by assumption)

Fee rates, VAT, KYC eligibility, Agent-class eligibility, fee precedence, tiered pricing, commission, rewards, fee enablement — all remain product/accounting decisions. Also carried: UD-CD2a (REJECTED snapshots for failed flows — intentionally not done).

## 11. Exact next dependency

**V1-COMMERCIAL-DECISION-03B — WALLET_TO_CASH snapshot wiring:** same pattern, same shared `AgentFinancialExecutionService` boundary (extend the product gate to include `WALLET_TO_CASH`), its limit block's principal/subject semantics captured from the authoritative enforcement result, with an equivalent real-PG suite. After that: CASH_TO_CASH (+claim), CUSTOMER_FUNDING, AGENT_FUNDING/DEFUNDING — then approved commercial policy before any charging task.
