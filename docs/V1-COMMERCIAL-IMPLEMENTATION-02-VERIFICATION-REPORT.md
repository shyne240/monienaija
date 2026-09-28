# V1-COMMERCIAL-IMPLEMENTATION-02 — Commission Engine Runtime Wiring: Verification Report

## 1. Executive summary

The V1-COMMISSION-01 commission machinery (`CommissionRuleResolverService` → `CommissionCalculator`
→ `CommissionEngine.decideWithManager`) is now **runtime-wired** into the existing SERIALIZABLE
transaction boundaries at the financial snapshot sites of all seven V1 financial products, exactly
as previously wired for the fee engine (V1-COMMERCIAL-IMPLEMENTATION-01). Everything remains
**commercially inert in production** (zero production commission rules; every snapshot continues to
record the byte-identical NONE shape) and **accounting-clean**: ALLOCATED decisions are evidence-only
(`payable: false`, no journal legs, explicit NOT_PROVISIONED blockers — no ledger account family was
invented). This document is the verification record of the rebuild. No production-readiness claim is
made anywhere.

## 2. Task, scope and standing constraints honored

- Wire the EXISTING engine into EXISTING SERIALIZABLE boundaries at snapshot sites (no new
  transactions, no ledger changes, no migrations — migration count stays **76**).
- Fee basis = the authoritative **fee DECISION** amount of the same transaction (`fee_decision.feeMinor`),
  never principal-derived, never fabricated: AMBIGUOUS fee ⇒ fail-closed; NOT_CONFIGURED/ZERO fee ⇒
  explicit calculated base `'0'` (zero fee ⇒ zero commission, never "unavailable").
- Acting **Agent = beneficiary** for WALLET_TO_CASH / CASH_TO_WALLET / CASH_TO_CASH; the class is read
  fresh inside the caller's transaction (`agentClassIdFor`); AGENT allocations with no targeted id are
  filled with the acting agent id. No agent context for WALLET_TRANSFER / CUSTOMER_FUNDING /
  AGENT_FUNDING / AGENT_DEFUNDING (the funded agent is the SUBJECT of its own float movement, never its
  commission beneficiary); `aggregatorId` is never supplied anywhere; individual-agent overrides stay
  disabled (never seeded).
- **Fail closed**: AMBIGUOUS rules (409 `COMMISSION_RULE_AMBIGUOUS`) or unavailable FEE base
  (400 `COMMISSION_BASE_UNAVAILABLE`) abort BEFORE money commits — the whole SERIALIZABLE transaction
  rolls back (verified with zero residue).
- **CASH_TO_CASH: initiation is the ONLY commission event.** The claim is customer-side (no acting
  agent), imports/injects/invokes NO commission code, and records plain `commissionNone()` —
  structural double-pay prevention (documented in `agent-cash-to-cash-claim.service.ts`, asserted by
  commission-01 test 02 and runtime-wiring test 22).
- Provisional TEST policy (DISPOSABLE test database only — never production data): STANDARD class
  2000 bps (20%) / PREMIUM class 3000 bps (30%) of the ACTUAL fee, PERCENTAGE-FLOOR, FEE basis, on
  W2C / C2W / C2C only; ZERO elsewhere. Production registries (`commission_rules`) stay EMPTY.
- P-DEC-01 prohibitions unchanged: principal-only journals; no fee/commission money movement;
  customer-facing surfaces unchanged. Fee-runtime code untouched except the established `@Optional()`
  DI integration pattern mirrored from IMPLEMENTATION-01.

## 3. Starting and final SHAs (rollback history)

- Starting SHA (remote tip, verified by `git ls-remote` before work): `213039e52af761b98281f2df2a61c27600795948`
- The working branch was `git reset --hard` to that SHA; environment was rebuilt (`.env`, `npm ci`,
  embedded PostgreSQL) after the third sandbox rollback destroyed the previous unpushed commit
  (`cc66110a…`). That commit is absent locally AND remotely, is NOT a source of this work, and was
  not recovered, recreated or referenced as input — this implementation was rebuilt from the task
  specification only.
- Final SHA: this commit itself (self-referential by construction); `git rev-parse HEAD` and the
  post-push `git ls-remote origin arena/01a0d883-monienaija` verification were performed in the same
  turn as the commit, eliminating the rollback window (commit+push atomic).

## 4. Implementation inventory (exact file changes)

| File | Change |
|---|---|
| `src/commercial-decision/commercial-decision.defaults.ts` | ADDED 3 pure helpers: `commissionFeeBasisMinor` (authoritative fee-decision base; `null` only on AMBIGUOUS), `commissionFeeCollectionStateOf` (`FEE_NOT_CONFIGURED` / `FEE_ZERO` / `FEE_CALCULATED_NOT_COLLECTED`), `commissionAllocatedAtAccountingBoundary` (wraps ALLOCATED with `payable:false`, the two NOT_PROVISIONED blockers, `posting:{journalLegsPosted:false, reason:'COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED'}`, `feeCollectionState`, `commissionEvent`). `commissionNone` and `rewardNone` untouched. |
| `src/transfer/transfer.service.ts` | Engine block in the snapshot recorder: `decideWithManager` inside the existing SERIALIZABLE tx with `agentId/agentClassId/aggregatorId = null` (no acting agent on WT); ALLOCATED results wrapped; NONE preserved by default. `@Optional()` `CommissionEngine` DI. |
| `src/agent/agent-financial-execution.service.ts` | Same engine block for CASH_TO_WALLET / WALLET_TO_CASH + acting-agent context + new private `agentClassIdFor(manager, agentId)` in-transaction lookup + AGENT beneficiaryId fill from the acting agent. |
| `src/agent/agent-cash-to-cash.service.ts` | Same + `agentClassIdFor` + beneficiary fill + `commissionEvent: 'CASH_TO_CASH_INITIATION'` (single lifecycle event). |
| `src/agent/agent-cash-to-cash-claim.service.ts` | One documentation comment only: the claim is deliberately NOT a commission event — no engine import/DI/invocation (asserted). Records plain `commissionNone()`. |
| `src/customer-funding/customer-funding.service.ts` | Engine block with null agent context (funded customer/agent is not a commission beneficiary). |
| `src/agent/agent-funding.service.ts` | Engine block with null agent context for AGENT_FUNDING and AGENT_DEFUNDING (funded agent is the SUBJECT of the float movement, never its commission beneficiary). |
| `src/transfer/transfer.module.ts`, `src/agent/agent.module.ts`, `src/customer-funding/customer-funding.module.ts` | `CommissionModule` imported so the DI graph resolves the optional engine. |
| `src/capability-registry/capability.seed.ts` | Truth-only capability updates (see §8); all strings re-validated ≤ 800 chars. |
| `test/v1-commission-01-commission-engine.integration.spec.ts` | Test 02 flipped from "no flow references the engine" to "engine wired at the five snapshot sites (claim excluded)" + static claim-exclusion asserts; header note updated. |
| `test/v1-commission-runtime-wiring.integration.spec.ts` | NEW — 24 proofs on real PG through the REAL transaction services (see §10). |
| `docs/V1-COMMERCIAL-IMPLEMENTATION-02-VERIFICATION-REPORT.md` | This report. |

Docstring bullets in the four record-snapshot services were aligned to the wired reality; no behavior
changed anywhere outside the six snapshot decision sites' commission section.

## 5. Runtime wiring semantics (how the decision is produced)

Each snapshot site now does, inside its already-existing `SERIALIZABLE` transaction:

1. Fee decision (unchanged, IMPLEMENTATION-01): resolver → calculator → APPLIED/ZERO/NOT_CONFIGURED.
2. `CommissionEngine.decideWithManager(manager, context, baseEvidence)`:
   - context: `productCode`, `currency`, evaluation timestamp, and (only for W2C/C2W/C2C) `agentId` of
     the acting agent + `agentClassIdFor` (fresh in-tx class read). `aggregatorId` is ALWAYS null.
   - baseEvidence: `principalMinor` (always) + `feeMinor = commissionFeeBasisMinor(feeDecision)`.
3. Empty/applicable rule set resolution per recipient group (read-only SQL inside the same tx);
   `NOT_CONFIGURED` ⇒ the identical `commissionNone()` byte-shape (wiring-inert when unconfigured).
4. ALLOCATED ⇒ acting-AGENT `beneficiaryId` fill (only at the three acting-agent sites) ⇒
   `commissionAllocatedAtAccountingBoundary(...)` annotation ⇒ recorded in `commission_decision`.
5. Fail-closed throws (409/400) propagate and roll back the WHOLE transaction — no money, no journal,
   no idempotency residue, no partial snapshot (verified by tests 15/16/21 with zero residue and clean
   immediate recovery after configuration repair).

## 6. Accounting boundary (truthful, enforced, tested)

- No COMMISSION-EXPENSE / COMMISSION-PAYABLE and no FEE-REVENUE ledger account family exists in the
  ledger; NONE was invented. Every ALLOCATED decision therefore records: `payable: false`;
  `payableBlockers: [FEE_REVENUE_ACCOUNT_FAMILY_NOT_PROVISIONED, COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED]`;
  `posting: { journalLegsPosted: false, reason: 'COMMISSION_ACCOUNTING_FAMILY_NOT_PROVISIONED' }`;
  `feeCollectionState` (FEE_NOT_CONFIGURED / FEE_ZERO / FEE_CALCULATED_NOT_COLLECTED — the fee basis
  is calculated but never collected); `commissionEvent` (`TRANSACTION_COMPLETION` or
  `CASH_TO_CASH_INITIATION`).
- Test 24 proves financial isolation end-to-end: no new ledger account codes (non-wallet families
  identical before/after), every flow journal is exactly two legs at the principal amount, and the
  recorded allocation amounts appear on NO ledger line. Wallet/balance effects are principal-only.

## 7. Fail-closed matrix (all proven on real PG)

| Trigger | Decision point | Outcome |
|---|---|---|
| Two equal-top-priority applicable rules (ambiguity by design) | resolver in-tx | `409 COMMISSION_RULE_AMBIGUOUS`, full rollback, no residue (tests 15, 21) |
| AMBIGUOUS fee decision under a FEE-basis rule (base never guessed) | `commissionFeeBasisMinor` ⇒ `null` ⇒ calculator `resolveBase` | `400 COMMISSION_BASE_UNAVAILABLE`, full rollback (test 16) |
| NOT_CONFIGURED fee under a FEE-basis rule | base = explicit `'0'` | ALLOCATED amount `'0'`, `feeCollectionState: FEE_NOT_CONFIGURED` (test 14) — zero ≠ NONE |
| Fee ZERO / APPLIED | base = actual fee amount | floor-decimal FEE-basis percentage (tests 08–12, 17) |
| Aggregator-targeted or non-matching class rule exists | targeting context never supplied/not matching | not matched; only eligible allocations recorded (tests 11, 18) |

## 8. Capability registry (truth-only updates — `capability.seed.ts`)

| Capability | Version | What changed |
|---|---|---|
| COMMISSION_ENGINE | v2 → **v3** | blocker/notes now say: machinery RUNTIME-WIRED at the six snapshot sites (claim excluded) but commercially inert (zero production rules; ALLOCATED is evidence-only; no account families provisioned). NOT FULLY_ENABLED. |
| COMMISSION_RULES | v1 → **v2** | blocker now acknowledges the registry is runtime-consumed (evidence-only); still zero approved production policy. |
| COMMISSION_RULE_RESOLVER | v1 → **v2** | blocker updated from "NOT wired into any flow" to wired into the seven flows (six engine sites; claim excluded); ambiguity precedence unchanged (explicit priority or fail-closed). |
| COMMERCIAL_DECISION_SNAPSHOT | v9 → **v10** | description/blocker/notes now state fee AND commission decisions are live-engine-evaluated at every site; nothing charged; C2C claim deliberately not a commission event. |

All seed strings re-validated ≤ 800 characters; `tsc --noEmit` clean.

## 9. Verification evidence (all gates)

| Gate | Result |
|---|---|
| New suite `test/v1-commission-runtime-wiring.integration.spec.ts` | **24/24 PASS** |
| `test/v1-commission-01-commission-engine.integration.spec.ts` (test 02 flipped) | **15/15 PASS** |
| decision-02 + 03a–03e + fee-runtime-wiring (adjacent snapshot suites) | **76/76 PASS** |
| FULL `npm run test:pg` (all integration suites, real PG) | **66/66 suites, 1382/1382 tests PASS** |
| `npm test` (unit) | **1778 PASS / 2 FAILED** — the 2 failures are the known pre-existing ones in `test/external-reconciliation.service.spec.ts` ("uses a repeatable-read read-only transaction…", "reconciles all operations and aggregates their statuses"), independently reproduced on the pristine base `213039e` in the prior verification cycle; unrelated to this change (no shared code path). |
| `npx tsc --noEmit` | **clean (0 errors)** |
| `npm run build` (nest build) | **clean** |
| ESLint per-file vs pristine base worktree | **EXACT PARITY** (problem counts identical pre/post): transfer.service 4/4, fin-exec 5/5, c2c 3/3, claim 2/2, customer-funding.service 112/112, agent-funding.service 9/9, defaults/modules/seed 0/0; both test files 0 problems. |
| Migration count | **76** (unchanged — no new migrations) |
| `.env` / data dir | never committed; `data/` gitignored |

## 10. New proof suite map (24 tests ↔ what each proves)

- 01–07: EMPTY registry → byte-identical NONE across WALLET_TRANSFER, CASH_TO_WALLET, WALLET_TO_CASH,
  CASH_TO_CASH initiation, CASH_TO_CASH claim (engine-free), CUSTOMER_FUNDING, AGENT_FUNDING +
  AGENT_DEFUNDING — wiring cannot change behavior when unconfigured.
- 08–10: STANDARD 20%-of-fee-250 → ALLOCATED `'50'` on W2C/C2W/C2C-initiation: acting-agent
  beneficiary, payable=false, exact blockers, posting blocked, feeCollectionState
  FEE_CALCULATED_NOT_COLLECTED, commissionEvent (TRANSACTION_COMPLETION / CASH_TO_CASH_INITIATION);
  journals principal-only; persisted fee slot untouched.
- 11: PREMIUM 30% (fee 250 → `'75'`) class differentiation; STANDARD rule never matches PREMIUM agent.
- 12: FLOOR on odd fee: fee 133 → `'26'` with explicit base evidence.
- 13: ZERO products stay NONE while the three agent-mediated products carry rules (policy scoping).
- 14: NOT_CONFIGURED fee + FEE-basis rule → explicit ALLOCATED `'0'` (zero ≠ unavailable, zero ≠ NONE).
- 15: commission ambiguity → 409, full rollback (no snapshot/journal/balance change).
- 16: ambiguous fee → 400 BASE_UNAVAILABLE, full rollback.
- 17: FEE basis == `fee_decision.feeMinor` byte-for-byte (0.5% of 30000 → base 150 → commission 30;
  never 20% of principal).
- 18: aggregator-targeted rule never matches at runtime (aggregatorId never supplied).
- 19: rule versioning through flows (`updateRule` optimistic lock; next snapshot carries version 2;
  stale 409).
- 20: C2C initiation replay → ONE snapshot / ONE allocation / ONE debit.
- 21: ambiguous abort leaves nothing; priority repair → immediate clean success once.
- 22: exactly ONE allocation across initiation + claim (claim structural exclusion).
- 23: customer history invariant — principal/fee/currency only; no commission leakage to customer surface.
- 24: financial isolation — no invented account families; every journal exactly 2 principal legs;
  allocation amounts on NO ledger line; decided evidence total `'150'` ≠ any posting.

## 11. Residual risks and explicit non-claims

- **No production-readiness claim.** Production `commission_rules` registry is EMPTY; the engine in
  production only proves the inert NONE path. Rates/bases/splits/precedence/effective dates remain
  unapproved product/accounting policy.
- The provisional 20%/30% test policy exists ONLY inside the disposable per-process test database.
- Cross-recipient sum/split policy remains deliberately undecided (documented in the V1-COMMISSION-01
  architecture doc); per-recipient independent resolution is mechanics, not policy.
- Class-targeted matching depends on the acting agent's CURRENT class at decision time (fresh in-tx
  read); class assignment governance is out of scope.
- ALLOCATED decisions are not payable/settlement instructions; a future approved accounting-policy
  task must provision the FEE-REVENUE and COMMISSION account families before ANY posting exists.

## 12. Push and tree verification

- Pre-commit tree contained ONLY the files in §4 (plus this report); `.env` and `data/` excluded.
- ONE commit, message `feat(commercial): wire commission engine runtime`; committed and pushed to
  `arena/01a0d883-monienaija` in the SAME turn (atomic — no rollback window); post-push
  `git ls-remote` compared to `git rev-parse HEAD`; working tree clean. No second commit was ever
  created under any failure protocol.
