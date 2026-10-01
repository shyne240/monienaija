# V1-COMMERCIAL-DECISION-03E — AGENT_FUNDING / AGENT_DEFUNDING Commercial Snapshot Wiring

**Date:** 2026-09-27 · **Branch:** `arena/01a0d883-monienaija` · **Parent commit:** `6005e91` (V1-COMMERCIAL-DECISION-03D)
**Status:** ✅ VERIFIED — evidence below. With this task, **all seven canonical V1 financial products** carry an immutable commercial decision snapshot: WALLET_TRANSFER, CASH_TO_WALLET, WALLET_TO_CASH, CASH_TO_CASH (initiation + claim), CUSTOMER_FUNDING, AGENT_FUNDING, AGENT_DEFUNDING.

## Scope

Wire the existing immutable Commercial Decision Snapshot into the **last two unwired V1 flows** — `AGENT_FUNDING` (Agent principal, INCOMING: pool → Agent wallet) and `AGENT_DEFUNDING` (Agent principal, OUTGOING: Agent wallet → pool). No fee charging, no commission, no reward, no revenue, no limit-policy change, no V2 work, no migration.

Both flows share **one code path** (`AgentFundingService.executeFunding(input, 'FUND' | 'DEFUND')`) with direction-driven identities — they were inspected, not assumed symmetrical: funding DEBITs the pool / CREDITs the Agent wallet; defunding does the reverse and is additionally guarded by the ledger's no-overdraft enforcement.

## Exact transaction boundaries (both flows)

Both operations execute inside the **same single SERIALIZABLE transaction** in `executeFunding` (retry loop, `MAX_SERIALIZABLE_ATTEMPTS`, `isRetryableTransactionError`):

1. Idempotency `reserve` (scope `agent-funding.v1:${agentId}` / `agent-defunding.v1:${agentId}`, retention 86400s) → REPLAY early-return.
2. Agent + wallet re-verification inside the tx.
3. `limitEnforcementService.enforceWithManager` — principalType `AGENT`, product `AGENT_FUNDING`/`AGENT_DEFUNDING`, direction `INCOMING`/`OUTGOING`; **the EnforceResult is now captured** (`limitOutcome`) instead of discarded.
4. Journal posted via `ledgerService.postJournalInTransaction` (single journal; on error → `releaseReservationsWithManager`), then `commitReservationsWithManager`.
5. **V1-COMMERCIAL-DECISION-03E insertion point:** `recordCommercialDecisionSnapshot(manager, …)` — `resolveWithManager` + `recordDecisionWithManager` inside **this same transaction**, after journal + limit commit, before `_simulateFailureAfterJournal` (test hook) / result build / idempotency `complete` / audit. No nested transaction, never `recordDecision`.
6. Idempotency `complete` (`LEDGER_JOURNAL`), audit event, commit.

The snapshot therefore commits or rolls back **atomically with the financial movement**.

## Verification evidence — 24 items

All integration evidence comes from `test/v1-commercial-decision-03e-agent-funding-snapshot.integration.spec.ts` (13 tests, real PostgreSQL) plus the focused/regression suites listed in item 24.

1. **Canonical product identity.** Funding snapshots carry `product='AGENT_FUNDING'`; defunding snapshots carry `product='AGENT_DEFUNDING'` (tests 01, 06). A catalogue query proves only these two codes exist — no `AGENT_FLOAT_*`/`_APPROVAL` variants invented (test 13).
2. **AGENT_FUNDING snapshot content.** direction `INCOMING`, principalType/principalId `AGENT/<agentId>`, currency `NGN`, principal_amount_minor = funded amount, `decision_status='FINAL'`, `created_by='agent-funding'`, `transaction_reference` = `journal_id`, idempotency key `agent-funding:${agentId}:${key}` (test 01).
3. **AGENT_DEFUNDING snapshot content.** direction `OUTGOING`, principal `AGENT/<agentId>`, `created_by='agent-defunding'`, idempotency key `agent-defunding:${agentId}:${key}`; the earlier funding snapshot stays separate and untouched (test 06).
4. **Authoritative limit evidence, never re-evaluated.** `limit_decision` is built from the captured `EnforceResult` of THIS execution: profile code, rule refs (ruleId/dimension/limits), reservation ids, usage ids — asserted equal to the committed `limit_reservations` rows (tests 01, 06). The service never calls the limit engine a second time.
5. **Fee NOT_CONFIGURED ≠ ZERO.** Both flows record `fee_decision.status='NOT_CONFIGURED'`, `feeMinor='0'`, `totalMinor` = principal amount; with rules present, `ruleRefs` capture evidence while status stays NOT_CONFIGURED (tests 01, 06, 12).
6. **Commission NONE / Reward NONE / revenue null / configurationVersion null** on every snapshot (tests 01, 06).
7. **Fee evidence fields.** `fee_decision` carries `agentId` (and `aggregatorId` when present) as flow evidence within the snapshot's jsonb contract — no balance or secret data (tests 01, 06).
8. **Pool/wallet accounting untouched.** Funding = exactly 2 lines, DEBIT pool / CREDIT Agent wallet, exact balances (`agent +amount`, `pool −amount`); defunding = DEBIT wallet / CREDIT pool. No new ledger account, no second journal, no second balance was created (tests 01, 06, 12).
9. **Idempotent replay — funding.** Same payload → `REPLAYED`, same journal id, snapshot count stays 1, credited exactly once, global journal count unchanged (test 02).
10. **Idempotent replay — defunding.** Same payload → `REPLAYED`, same journal, one snapshot, debited once (test 07).
11. **Conflicting idempotency key — funding.** Same key, different amount → HTTP 409; snapshot count unchanged (test 03).
12. **Conflicting idempotency key — defunding.** Same key, different amount → 409; snapshot count unchanged (test 07).
13. **Limit rejection — funding.** Tight `AGENT_FUNDING` DAILY_AMOUNT → 422; zero snapshots, zero reservations, wallet and pool balances unchanged (test 05).
14. **Limit rejection — defunding.** Tight `AGENT_DEFUNDING` DAILY_AMOUNT → 422; zero snapshots, zero reservations, no mutation (test 09a).
15. **No overdraft on defunding.** Defunding beyond balance → 422 from existing ledger protection; no snapshot, balance never negative (test 09b).
16. **Forced post-snapshot rollback — funding.** `_simulateFailureAfterJournal` throws after the snapshot: snapshot rows 0, reservations 0, usages 0, journal count restored, balances unchanged, idempotency record gone — everything rolls back together (test 04).
17. **Forced post-snapshot rollback — defunding.** Same proof for the defunding path (test 08).
18. **Clean retry after rollback — both flows.** Retry after the forced failure succeeds with exactly ONE snapshot, ONE journal, exact balance (tests 04, 08).
19. **Concurrency — identical parallel funding.** 4 parallel same-key funds converge: exactly one `COMPLETED`, rest `REPLAYED` or benign conflict; ONE journal, ONE original snapshot, credited exactly once (test 10). No second idempotency system was introduced — the existing SERIALIZABLE + reserve/REPLAY machinery is the sole authority.
20. **Concurrency — parallel defunding.** 4 parallel distinct-key defunds against 50000 minor: successes ≤ floor(balance/amount), snapshot count == successes, final balance == 50000 − 20000×successes ≥ 0 — no overdraft, no duplicate operations or snapshots (test 11).
21. **TEST-ONLY synthetic fee rules — both products.** Zero production rules proven first (`fee_rules` count = 0); synthetic rules for `AGENT_FUNDING` (flat 100, 5bps) and `AGENT_DEFUNDING` (flat 150, 8bps) created in the test DB only; both snapshots capture ruleId/ruleVersion/parameters in `fee_decision.ruleRefs` while remaining NOT_CONFIGURED and charging nothing — journals stay principal-only, balances exact (test 12).
22. **Immutability.** UPDATE and DELETE on both snapshots rejected by the existing trigger (test 13).
23. **Capability registry (text + version only).** `COMMERCIAL_DECISION_SNAPSHOT` v7→v8: scope now ALL SEVEN V1 products; blocker text updated accordingly; notes append the 03E clause. `FEE_RULE_RESOLVER` v6→v7: participates read-only in all seven wired flows. The FEE/COMMISSION/REWARD engines remain explicitly NOT implemented; pricing remains NOT_CONFIGURED; all fields within varchar(800). No V2 capabilities enabled.
24. **Regression status.**
    - New suite: 13/13 (real PG).
    - Resolver guard (`v1-commercial-04`): updated — `agent-funding.service.ts` moved from the unwired list to the evidence-only wired list; unwired list now only the cash-in/cash-out orchestrators (which have no money path of their own). Suite passes.
    - 03D suite guard updated to the justified new reality (agent-funding now wired with the same pattern; asserted, not deleted) — 10/10.
    - Focused regressions: 02/03A/03B/03C/03D pilots, a19 agent funding, capability registry — all pass.
    - **Full integration: 60 suites / 1294 tests — all pass.**
    - Unit: 1764 pass / 2 pre-existing failures (`external-reconciliation.service.spec.ts`, unrelated and unchanged).
    - `tsc --noEmit` clean; `nest build` clean; eslint: 0 new errors on changed files (the 9 errors in `agent-funding.service.ts` are byte-identical pre-existing baseline errors, verified via stash).
    - **Zero migrations** — still 73.

## Constraints honored

- Exact product codes only; no invented variants. Funding = AGENT/INCOMING, defunding = AGENT/OUTGOING (verified against live limit wiring).
- Snapshot recorded with `resolveWithManager` + `recordDecisionWithManager` inside the existing transaction boundary; never `recordDecision`; no nested transaction; atomic success/fail with the financial operation.
- No pool-account/ledger architecture changes: no new accounts, no second balance, no second journal, no principal/asset accounting change.
- No fee charging/commission/reward/VAT/pricing/limit-policy/V2 work; NOT_CONFIGURED preserved (never converted to ZERO).
- V1-LIMIT-03 concurrency model preserved (SERIALIZABLE + SELECT FOR UPDATE + retry + idempotency); concurrency proof shows no duplicate operations or snapshots.
- No new idempotency system; replay/convergence rides the existing mechanism.
- Both flows inspected before wiring — they share one boundary but differ by direction, ledger sides, and overdraft exposure.

## Next dependency

All seven V1 products now capture immutable commercial decision evidence. Charging remains deliberately gated: the exact next dependency is the **approved commercial pricing policy** (per-product fee/commission/reward rules, precedence, currency and effective-date semantics) required to enable the Fee/Commission/Reward engines — a product/accounting decision that must not be invented in code.
