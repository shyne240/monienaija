# V1-COMMERCIAL-DECISION-03B — WALLET_TO_CASH Commercial Snapshot Wiring: Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `7f5e7c146be41183d36951ffd125a11a70969e9f` (V1-COMMERCIAL-DECISION-03A) — verified, matches prompt.
**Parent (verified via `git rev-parse HEAD^`):** `78abf7379fe346189f504e6a1a7be6f028bc9ecf` (V1-COMMERCIAL-DECISION-02). No discrepancy.
**Final HEAD:** this task's commit (single commit on top of `7f5e7c1`).
**Migration count:** **73 — UNCHANGED.** No schema deficiency found; zero migrations.
**Verdict:** WALLET_TO_CASH wired and verified with the proven pilot pattern. Integration-only: zero charging, zero policy invented, authorization (Customer PIN + OTP + Agent capability) and financial behavior unchanged. CASH_TO_WALLET, WALLET_TRANSFER and all other flows untouched.

---

## 1. WALLET_TO_CASH inspection (before any change)

`AgentCashOutService.execute` runs OUTSIDE any transaction: input validation → Agent principal ownership checks → Customer existence/eligibility → **Customer transaction PIN** (CustomerTransactionPinService) → **OTP via MfaExecutionService.verifyChallenge** (canonical path only; one-time OTP with the documented idempotent-replay accommodation: REPLAYED is tolerated only when the financial idempotency record for this Agent+key is already COMPLETED/IN_PROGRESS) → **Agent A11 authorization** (CASH_OUT capability + agentPin) → `ensureWalletAccount` ×2 (customer = payer, agent = receiver).

It then delegates to the shared **`AgentFinancialExecutionService.execute`**, whose single `dataSource.transaction('SERIALIZABLE', …)` (bounded 3-attempt serialization retry) is the flow's real transaction boundary — the SAME boundary CASH_TO_WALLET uses, but with reversed journal direction:

```
idempotency reserve (REPLAY → early return) → Agent-wallet participation check
→ limit enforcement (enforceWithManager) → ledger journal (DEBIT Customer / CREDIT Agent)
→ limit reservation commit → [snapshot] → idempotency complete → audit → COMMIT
```

Physical cash stays outside the electronic ledger (no cash account exists or is created). A separate best-effort audit transaction follows. Ordering was inspected, not assumed — it matches the shared boundary, so the 03A snapshot call-site already sits at the correct position for WALLET_TO_CASH as well.

## 2. Exact call-site placements

- **`resolveWithManager(manager, { productCode: 'WALLET_TO_CASH', currency, at })`** — inside `recordCommercialDecisionSnapshot`, invoked from the SERIALIZABLE callback AFTER the limit-commit step and BEFORE the `_simulateFailureAfterJournal` hook; same manager, no nested transaction, never `recordDecision`.
- **`recordDecisionWithManager(manager, …)`** — same method, same transaction. The ONLY code change to the boundary is the product gate widening from `CASH_TO_WALLET` to `['CASH_TO_WALLET', 'WALLET_TO_CASH']` plus per-flow derivation of `product`, `direction` fallback (`OUTGOING`), snapshot idempotency prefix (`cash-out:`) and `createdBy` (`agent-cash-out`).

## 3. Snapshot fields (success path)

| Field | Value |
|---|---|
| idempotencyKey | `cash-out:<agentId>:<callerIdempotencyKey>` |
| product | `WALLET_TO_CASH` |
| direction / channel | `OUTGOING` / null |
| principalType / principalId | `CUSTOMER` / paying customerId — the authoritative limit subject; acting Agent recorded as `fee_decision.agentId` evidence |
| currency / principalAmountMinor | NGN / exact principal |
| transactionReference / journalId / correlationId | journalId / journalId / caller value or null |
| decisionStatus / decidedAt / finalizedAt | `FINAL` / decision timestamp / decision timestamp |
| feeDecision | `feeNotConfigured(NGN, principal)` → **NOT_CONFIGURED**, feeMinor 0, totalMinor = principal, ruleRefs [] (+agentId; + ruleRefs / AMBIGUOUS evidence per §4) |
| commissionDecision / rewardDecision | `commissionNone()` / `rewardNone()` |
| revenueDecision / configurationVersion | `null` / `null` — nothing invented |
| limitDecision | authoritative live EnforceResult (below) |
| createdBy | `agent-cash-out` |

## 4. Limit evidence source + fee semantics

Limit section built ONLY from the captured authoritative `EnforceResult` of THIS execution (profileCode, assignmentId, ruleRefs with ruleId/dimension/limits, reservationIds, usageIds). No second evaluation path.
Fee: zero production rules ⇒ `NOT_CONFIGURED` (never ZERO; no synthetic zero-fee rule created). Synthetic TEST-ONLY rule ⇒ still NOT_CONFIGURED while `ruleRefs[0]` captures ruleId/ruleVersion/parameters (DECISION-01 precedent); AMBIGUOUS recorded honestly.

## 5. Proofs (real PostgreSQL 18.4 — new suite 8/8, every test runs the FULL authorization chain: Customer PIN → real MFA OTP → Agent PIN + CASH_OUT capability)

- **Success atomicity (01):** exactly one FINAL snapshot; product WALLET_TO_CASH; transaction_reference = journalId; principal 30000 NGN; CUSTOMER/payer principal; direction OUTGOING; commission/reward NONE; revenue null; limit APPROVED with the seeded profile + exact rule ids + the real reservation/usage ids from THIS execution; workforce diagnostic API lists it.
- **Zero-fee financial identity (02):** journal = exactly 2 lines — DEBIT Customer 22000, CREDIT Agent 22000 (Customer debit and Agent credit unchanged); ledger_accounts count unchanged; balances move by exactly ±principal; no fee/revenue/commission/reward lines or accounts.
- **Replay (03):** identical replay through the NATURAL path (same challengeId+otp → OTP layer reports REPLAYED; service permits it only because the financial idempotency record is COMPLETED) → REPLAYED, same journalId, snapshot count stays 1, no duplicate journal, customer debited once.
- **Key clash (04):** same key + different amount (fresh OTP challenge) → 409; snapshot count unchanged.
- **Rollback (05):** `_simulateFailureAfterJournal` forces a REAL in-transaction failure after the snapshot: snapshot gone, reservations gone, usages gone, journal count unchanged, Customer and Agent balances unchanged, idempotency reservation rolled back.
- **Limit rejection (06):** DAILY_AMOUNT 20000 vs 30000 attempt → 422; no snapshot, no stranded reservation/usage, zero balance movement.
- **Synthetic rule (07):** ruleId/ruleVersion/parameters captured; nothing charged (principal-only journal, exact balances).
- **Immutability + wiring boundary (08):** UPDATE/DELETE blocked by trigger; gate literal is exactly `['CASH_TO_WALLET', 'WALLET_TO_CASH']`; `.recordDecision(` never used; no FeeEngine; agent-cash-in/agent-cash-out orchestrators contain no resolver/snapshot references.

## 6. Authorization regression

The full chain is exercised by the new suite on every successful/rejected path (Customer PIN, real OTP issuance+verification, Agent PIN, CASH_OUT capability, Agent identity ownership), and the complete existing a14 suite — covering invalid/locked Customer PIN, missing/invalid/expired/reused OTP, cross-customer withdrawal, missing capability, Agent impersonation, suspended/terminated/pending Agent, inactive class — passes unchanged. No authorization code was touched.

## 7. Financial safety / mutation comparison

Everything except the intended snapshot row is byte-identical: full 1258-test integration run (including complete a13/a14 agent suites) passes unchanged, plus explicit before/after balance, journal-line, ledger-account, limit-reservation/usage and idempotency assertions in the new suite. Wallet balances, ledger accounts/journals/lines, limit usage/reservations, amounts, authorization and idempotency semantics all unchanged.

## 8. Files changed (3 modified + 1 new spec + report; `git diff` inspected — no unrelated changes)

| Path | Change |
|---|---|
| `src/agent/agent-financial-execution.service.ts` | gate widened to `['CASH_TO_WALLET', 'WALLET_TO_CASH']`; per-flow product/direction/idempotency-prefix/createdBy derivation |
| `src/capability-registry/capability.seed.ts` | snapshot scope v5 (three flows), resolver text v4 — statuses unchanged, pricing still NOT_CONFIGURED |
| `test/v1-commercial-decision-03a-cash-to-wallet-snapshot.integration.spec.ts` | guard test 08 updated to the justified new reality (gate literal now covers both flows; comment updated). No assertion weakened — still forbids `.recordDecision(`, FeeEngine, and orchestrator-level wiring |
| `test/v1-commercial-decision-03b-wallet-to-cash-snapshot.integration.spec.ts` | NEW — 8 tests |
| `docs/V1-COMMERCIAL-DECISION-03B-VERIFICATION-REPORT.md` | this report |

**NOT touched:** migrations (0), snapshot schema/service/trigger, TransferService, agent-cash-in/cash-out services, ledger/wallet code, FeeEngine, limit logic, any authorization code.

## 9. Capability Registry state

- **COMMERCIAL_DECISION_SNAPSHOT** (v4→v5, statuses unchanged: API_READY / enabled=true / configurationStatus NOT_CONFIGURED): scope text now WALLET_TRANSFER + CASH_TO_WALLET + WALLET_TO_CASH; remaining flows explicitly future work. No "all V1 flows commercially wired" claim.
- **FEE_RULE_RESOLVER** (v3→v4, text only): read-only participation in three pilots; calculates/charges nothing.
- **Untouched:** FEE_ENGINE (DISABLED/enabled=false), COMMISSION_ENGINE, REWARD_ENGINE, all others. Commercial pricing remains NOT configured.

## 10. Test & regression results

| Check | Result |
|---|---|
| New WALLET_TO_CASH suite | **8/8 pass** (required areas 1–19; area 20–22 = regressions below) |
| Existing WALLET_TO_CASH suite (a14) | PASS |
| Existing CASH_TO_WALLET suite (a13) + commercial 03A suite (incl. updated guard) | PASS |
| Existing WALLET_TRANSFER commercial suite (DECISION-02 pilot) | PASS |
| Commercial decision-01, 02, 03, 04 suites | PASS |
| Limits 01 / 02 / 03 / 04-runtime | PASS |
| Capability registry + migration chain (73, zero new) | PASS |
| Focused total | 272/272 across the 14 named suites |
| **Full integration suite** | **57/57 suites, 1258/1258 tests** (was 56/1250) |
| Unit suite | 1764/1766 — the 2 pre-existing `external-reconciliation` failures, unchanged |
| `tsc --noEmit` / `npm run build` | exit 0 / exit 0 |
| ESLint — files created/modified by this task | new spec/seed/03a-guard: **0 errors**; remaining reports in agent-financial-execution.service.ts are pre-existing V1-LIMIT-04 code outside this task's diff hunks (repo-wide lint baseline already failing — honest) |

## 11. Unresolved commercial decisions (carried, unchanged — none resolved by assumption)

Fee rates, VAT, KYC eligibility, Agent-class eligibility, fee precedence, tiered pricing, commission, rewards, promotional rules, fee enablement — all remain product/accounting decisions. Carried: UD-CD2a (REJECTED snapshots for failed flows — intentionally not done).

## 12. Exact recommended next task

**V1-COMMERCIAL-DECISION-03C — CASH_TO_CASH (+ claim path) snapshot wiring:** the remaining customer-facing flow; it uses its own transaction boundary (not the shared agent financial execution service), so the pattern must be placed at THAT boundary's commit-success point with the same semantics (NOT_CONFIGURED fee, NONE commission/reward, authoritative limit evidence, atomic commit/rollback, replay never duplicates). After that: CUSTOMER_FUNDING, AGENT_FUNDING/AGENT_DEFUNDING — then approved commercial policy before any charging task.
