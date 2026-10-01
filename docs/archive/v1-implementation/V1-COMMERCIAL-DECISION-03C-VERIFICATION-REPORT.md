# V1-COMMERCIAL-DECISION-03C — CASH_TO_CASH Commercial Snapshot Wiring (Initiation + Claim): Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `a5da8b756ca00c8a6d17247b32905d63a57746ae` (V1-COMMERCIAL-DECISION-03B) — verified, matches prompt.
**Parent (verified via `git rev-parse HEAD^`):** `7f5e7c146be41183d36951ffd125a11a70969e9f` (V1-COMMERCIAL-DECISION-03A). No discrepancy.
**Final HEAD:** this task's commit (single commit on top of `a5da8b7`).
**Migration count:** **73 — UNCHANGED.** No schema deficiency found; zero migrations.
**Verdict:** BOTH CASH_TO_CASH operations wired and verified — kept explicitly separate under the ONE canonical product code `CASH_TO_CASH`. Integration-only: zero charging, zero policy invented, transfer-code security, phone binding, OTP, reserved/unclaimed liability, expiry semantics and all financial behavior unchanged.

---

## 1. Product identity

`CASH_TO_CASH` is preserved as the single canonical product code for BOTH operations. No `CASH_TO_CASH_CLAIM` / `CASH_TO_CASH_INITIATION` catalogue identity was invented — the product catalogue still holds exactly `CASH_TO_CASH` (test 13 asserts `SELECT code FROM products WHERE code LIKE 'CASH_TO_CASH%'` returns only it). The two operations are distinguished by:

| | INITIATION | CLAIM |
|---|---|---|
| principalType / principalId | `AGENT` / acting agentId | `CUSTOMER` / claiming customerId |
| direction | `OUTGOING` (authoritative limit direction) | `INCOMING` (authoritative limit direction) |
| snapshot idempotencyKey | `cash-to-cash:<agentId>:<key>` | `cash-to-cash-claim:<transferId>:<key>` |
| createdBy | `agent-cash-to-cash` | `agent-cash-to-cash-claim` |
| transactionReference / journalId | initiation journal | claim journal |
| fee_decision evidence | `agentId` + `transferId` | `transferId` |

## 2. Transaction boundaries (inspected, preserved — each operation keeps its OWN)

### Initiation — `AgentCashToCashService.execute`
A11 authorization (CASH_TO_CASH + PIN) outside; then its own `dataSource.transaction('SERIALIZABLE', …)` (3-attempt retry):
```
idempotency reserve (REPLAY → early return) → Agent-wallet check → limit enforce
(AGENT OUTGOING; result NOW CAPTURED) → transfer-code generation → ledger journal
(DEBIT Agent / CREDIT Unclaimed) → limit commit → cash_to_cash_transfers INSERT (UNCLAIMED)
→ [NEW snapshot] → [test hook] → idempotency complete → audit → COMMIT
```

### Claim — `AgentCashToCashClaimService.execute`
Phone binding → KYC/identity check → transfer-code verification (PBKDF2, timing-safe, lockout) → OTP via MfaExecutionService (with the documented one-time-OTP replay accommodation) outside; then its own SERIALIZABLE transaction:
```
FOR UPDATE transfer row → CLAIMED-replay / status checks → identity + code re-verify
→ beneficiary wallet resolve → limit enforce (CUSTOMER INCOMING; result NOW CAPTURED)
→ idempotency reserve (REPLAY → early return) → ledger journal (DEBIT Unclaimed /
CREDIT beneficiary) → limit commit → transfer UPDATE → CLAIMED → [NEW snapshot]
→ [test hook] → idempotency complete → audit → COMMIT
```

CASH_TO_CASH does NOT flow through the shared `AgentFinancialExecutionService`; nothing there was modified (its gate remains exactly `['CASH_TO_WALLET', 'WALLET_TO_CASH']` — asserted in test 13).

## 3. Exact call-site placements

- **`resolveWithManager(manager, { productCode: 'CASH_TO_CASH', currency, at })`** and **`recordDecisionWithManager(manager, …)`** — both inside each operation's new private `recordCommercialDecisionSnapshot`, invoked with the SAME manager: initiation AFTER journal + limit commit + transfer INSERT; claim AFTER journal + limit commit + transfer flip to CLAIMED. Never `recordDecision`, no nested transaction, never async. Both commits/rollbacks are atomic with their own financial transaction.

## 4. Snapshot contents (per operation)

product `CASH_TO_CASH`; transaction_reference = journal identity; principal amount + NGN; FINAL status + decidedAt/finalizedAt; fee **NOT_CONFIGURED** (feeMinor 0, totalMinor = principal, ruleRefs [] — plus ruleRefs / AMBIGUOUS evidence per §6); commission `NONE`; reward `NONE`; revenueDecision `null`; configurationVersion `null`; authoritative limit decision (profileCode, assignmentId, ruleRefs, reservationIds, usageIds); correlationId from caller; acting-Agent evidence on initiation. Nothing invented (no KYC tier, no Agent-class pricing, no VAT/tax, no commission rate).

## 5. Proofs (real PostgreSQL 18.4 — new suite 13/13)

**Initiation:** (01) success → exactly one snapshot, AGENT/OUTGOING identity, authoritative limit evidence (profile + rule ids + real reservation/usage ids), reserved/unclaimed behavior byte-identical (DEBIT Agent / CREDIT Unclaimed, transfer UNCLAIMED, PBKDF2-hashed code, exact balances); (02) replay → REPLAYED, one snapshot, transferCode never replayed, no duplicate journal/reserved value; (03) key clash → 409; (04) forced post-snapshot failure → snapshot + limits + journal + transfer row + idempotency reservation ALL rolled back, Agent position unchanged; (05) limit rejection → 422, no snapshot, no stranded reservation, no mutation; (06) synthetic TEST-ONLY rule → ruleId/ruleVersion/parameters captured, still NOT_CONFIGURED, principal-only money flow, `fee_rules` count proven 0 beforehand (zero production rules).

**Claim:** (07) success → exactly one ADDITIONAL snapshot, CUSTOMER/INCOMING identity, one-time OTP + phone binding + code verification all exercised, recipient behavior unchanged (DEBIT Unclaimed / CREDIT beneficiary, transfer CLAIMED), initiation snapshot untouched; (08) replay via natural OTP accommodation → REPLAYED, one claim snapshot, credited once; (09) key clash (same key, different reference) → 409; (10) forced post-snapshot failure → snapshot + limits + claim journal rolled back, wallet unchanged, transfer stays UNCLAIMED with no claim linkage; (11) limit rejection → 422, no snapshot, no stranded reservation, transfer UNCLAIMED; (12) the SAME single synthetic rule (resolver resolves one product code for both operations — documented test setup, no second product code invented) captured on the claim without charging.

**Cross-cutting:** (13) both snapshots immutable (UPDATE/DELETE trigger-blocked); wiring boundary source assertions (both services use resolveWithManager + recordDecisionWithManager, never `.recordDecision(`, no FeeEngine); shared execution gate unchanged; workforce diagnostic API lists both operations under one product code; catalogue holds only `CASH_TO_CASH`.

## 6. Fee semantics + expiry inspection

Zero production fee rules ⇒ `NOT_CONFIGURED` on BOTH operations (never ZERO; no synthetic zero-fee rule). AMBIGUOUS recorded honestly. **Expiry inspected:** `AgentCashToCashExpiryService` is a status-only operation — "No journal is created on expiry. No automatic refund to Agent." It is NOT a financial transaction and requires no commercial decision snapshot; no expiry product invented. Documented, not expanded.

## 7. Financial mutation comparison

Everything except the intended snapshot rows is byte-identical: full 1271-test integration run (including complete a15/a16/a17 CASH_TO_CASH suites covering transfer-code hashing/lockout, phone binding, OTP, expiry races, concurrency) passes unchanged, plus explicit before/after balance, journal-line, transfer-state, limit-reservation/usage and idempotency assertions in the new suite. Reserved/unclaimed liability, Agent balance behavior, Customer wallet behavior, journal structure, expiry behavior (no auto-refund) all unchanged. No automatic cancellation/reversal introduced.

## 8. Files changed (6 modified + 1 new spec + report; `git diff` inspected — no unrelated changes)

| Path | Change |
|---|---|
| `src/agent/agent-cash-to-cash.service.ts` | capture authoritative EnforceResult; snapshot recording after journal + limit commit + transfer INSERT; optional resolver/snapshot deps; TEST-ONLY failure hook |
| `src/agent/agent-cash-to-cash-claim.service.ts` | same for the claim (after journal + limit commit + CLAIMED flip); CUSTOMER INCOMING identity |
| `src/agent/agent-cash-to-cash.types.ts` / `…-claim.types.ts` | `_simulateFailureAfterJournal` TEST-ONLY optional field (documented) |
| `src/capability-registry/capability.seed.ts` | snapshot scope v6 (four flows incl. init + claim), resolver text v5 — statuses unchanged, pricing NOT_CONFIGURED |
| `test/v1-commercial-04-fee-rule-resolver.integration.spec.ts` | guard test 19 updated to the justified new reality: resolver consumers now W2W + shared agent execution + C2C init/claim, all evidence-only (no calculation/charging); CUSTOMER_FUNDING + AGENT_FUNDING still asserted unwired |
| `test/v1-commercial-decision-03c-cash-to-cash-snapshot.integration.spec.ts` | NEW — 13 tests |
| `docs/V1-COMMERCIAL-DECISION-03C-VERIFICATION-REPORT.md` | this report |

**NOT touched:** migrations (0), snapshot schema/service/trigger, TransferService, shared agent execution service, cash-in/cash-out orchestrators, ledger/wallet code, FeeEngine, limit logic, expiry service, authorization code.

## 9. Capability Registry state

- **COMMERCIAL_DECISION_SNAPSHOT** (v5→v6, statuses unchanged: API_READY / enabled=true / configurationStatus NOT_CONFIGURED): scope text now WALLET_TRANSFER + CASH_TO_WALLET + WALLET_TO_CASH + CASH_TO_CASH (initiation + claim); CUSTOMER_FUNDING and AGENT_FUNDING/DEFUNDING explicitly future work. No "all V1 flows commercially wired" claim.
- **FEE_RULE_RESOLVER** (v4→v5, text only): read-only participation in all wired pilots; calculates/charges nothing.
- **Untouched:** FEE_ENGINE (DISABLED/enabled=false), COMMISSION_ENGINE, REWARD_ENGINE, all others. Commercial pricing remains NOT configured.

## 10. Test & regression results

| Check | Result |
|---|---|
| New CASH_TO_CASH suite (init 01–06, claim 07–12, cross-cutting 13) | **13/13 pass** |
| Existing CASH_TO_CASH suites (a15 initiation, a16 claim, a17 expiry) | PASS |
| WALLET_TRANSFER pilot (02), CASH_TO_WALLET (03A), WALLET_TO_CASH (03B), snapshot suite (01) | PASS |
| Product catalogue / fee schema / fee resolver (incl. updated guard) | PASS |
| Limits 01 / 02 / 03 / 04-runtime | PASS |
| Capability registry + migration chain (73, zero new) | PASS |
| Focused total | 298/298 across the 16 named suites (after justified guard update) |
| **Full integration suite** | **58/58 suites, 1271/1271 tests** (was 57/1258) |
| Unit suite | 1764/1766 — the 2 pre-existing `external-reconciliation` failures, unchanged |
| `tsc --noEmit` / `npm run build` | exit 0 / exit 0 |
| ESLint — files created/modified by this task | new spec / types / seed / guard: **0 errors**; remaining reports in the two C2C services are pre-existing V1-LIMIT-04 code outside this task's diff hunks (repo-wide lint baseline already failing — honest) |

## 11. Unresolved commercial decisions (carried, unchanged — none resolved by assumption)

Fee rates, VAT/tax, KYC eligibility/pricing, Agent-class pricing, fee precedence, tiered pricing, commission, rewards, promotions, fee enablement — all remain product/accounting decisions. Carried: UD-CD2a (REJECTED snapshots for failed flows — intentionally not done).

## 12. Exact next dependency

**V1-COMMERCIAL-DECISION-03D — CUSTOMER_FUNDING snapshot wiring:** the next unwired flow; inspect its own transaction boundary first (it does not use the shared agent execution service), then apply the identical pattern (NOT_CONFIGURED fee, NONE commission/reward, authoritative limit evidence, atomic commit/rollback, replay never duplicates). After that: AGENT_FUNDING / AGENT_DEFUNDING — then approved commercial policy before any charging task.
