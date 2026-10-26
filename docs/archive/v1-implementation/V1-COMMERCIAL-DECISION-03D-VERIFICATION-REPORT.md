# V1-COMMERCIAL-DECISION-03D — CUSTOMER_FUNDING Commercial Snapshot Wiring: Verification Report

**Date:** 2026-09-27
**Branch:** `arena/01a0d883-monienaija`
**Starting HEAD:** `044a2062263fb0d4ebc1d17975b3674571653ab9` (V1-COMMERCIAL-DECISION-03C) — verified, matches prompt.
**Parent (verified via `git rev-parse HEAD^`):** `a5da8b756ca00c8a6d17247b32905d63a57746ae` (V1-COMMERCIAL-DECISION-03B). No discrepancy.
**Final HEAD:** this task's commit (single commit on top of `044a206`).
**Migration count:** **73 — UNCHANGED.** No schema deficiency found; zero migrations.
**Verdict:** CUSTOMER_FUNDING wired and verified. The snapshot belongs to the checker **approval execution** — the actual financial/commercial decision. Request creation and rejection never snapshot; maker/checker separation untouched. Integration-only: zero charging, zero policy invented.

---

## 1. Inspection findings (13 questions answered before coding)

1. **Entry points:** `CustomerFundingService.createRequest` (maker), `.approve` / `.reject` (checker); exposed via internal + customer controllers (unchanged).
2. **Transaction boundary:** three independent SERIALIZABLE transactions — one per operation. No shared service.
3. **SERIALIZABLE:** yes, all three, with bounded 3-attempt retry on serialization failures.
4. **Maker/checker:** maker ∈ {SUPPORT, OPERATOR, SERVICE, PRIVILEGED} creates PENDING; checker ∈ {OPERATOR, SERVICE, PRIVILEGED} approves/rejects; `makerId === checkerId` → 403 on both approve and reject.
5. **Journal posted:** ONLY in `approve` — DEBIT `PAYMENT-SETTLEMENT_ASSET-NGN` (authoritative settlement control account via `SettlementAccountService.getAccountId(manager, …)`), CREDIT customer wallet ledger account.
6. **Customer balance change:** ledger-derived from that journal; no balance column.
7. **Limit reservation:** in `approve` via `enforceWithManager` — CUSTOMER / customerId, product `CUSTOMER_FUNDING`, direction `INCOMING`, idempotency key `customer-funding-approve:<requestId>`. Result was previously DISCARDED — now captured.
8. **Limit commit/release:** commit after journal success (incl. the defensive journal-idempotency recovery path); release on journal failure.
9. **Idempotency terminal:** creation idempotency lives on `customer_funding_requests.idempotency_key` (request-hash comparison, unique constraint with concurrent-race recovery); ledger idempotency `customer-funding:<requestId>`; limit idempotency per above.
10. **Terminal transitions:** PENDING → APPROVED (with journal_id + checker) in `approve`; PENDING → REJECTED in `reject`. Approve of a non-PENDING request → 409.
11. **Audit:** inside each operation's transaction (`FUNDING_REQUEST_CREATED/APPROVED/REJECTED`) + outbox events.
12. **Multiple financial paths:** NO — exactly ONE money-moving path (approve). Create/reject are non-financial.
13. **Bypasses:** none found — every approve goes through the same boundary (wallet check → limit → journal → state flip).

## 2. Exact snapshot placement

`resolveWithManager(manager, { productCode: 'CUSTOMER_FUNDING', currency, at })` and `recordDecisionWithManager(manager, …)` — both inside the EXISTING SERIALIZABLE approve transaction, in a new private `recordCommercialDecisionSnapshot` invoked **after** journal posting, limit commit and the `status='APPROVED'` flip, and **before** audit/outbox. Never `recordDecision`; no nested transaction; never async. A TEST-ONLY `_simulateFailureAfterJournal` hook throws immediately after the snapshot (same pattern as the preceding pilots) for the real-PG rollback proof. Creation and rejection paths contain NO snapshot call.

## 3. Actor / direction semantics (confirmed from implementation, not invented)

- **principalType / principalId:** `CUSTOMER` / funded customerId — the economic principal and the authoritative limit subject (enforcement runs CUSTOMER INCOMING).
- **direction:** `INCOMING` (matches the authoritative limit block).
- **Actor evidence:** `fee_decision` jsonb carries `fundingRequestId`, `makerId`, `checkerId` — the maker/checker separation that authorized the decision (schema-tolerant evidence keys; no invented identity model).
- **createdBy:** `customer-funding`.

## 4. Snapshot fields

product `CUSTOMER_FUNDING` (canonical — no `_APPROVAL`/`_CREDIT` variants; test 10 asserts the catalogue holds only `CUSTOMER_FUNDING`); transaction_reference = journalId; journal identity; principal amount + NGN; FINAL + decidedAt/finalizedAt; fee **NOT_CONFIGURED** (feeMinor 0, totalMinor = principal, ruleRefs [] or resolved-rule evidence); commission `NONE`; reward `NONE`; revenueDecision `null`; configurationVersion `null`; authoritative limit decision (profileCode, assignmentId, ruleRefs, reservationIds, usageIds); correlationId (approve input, falling back to the request's); snapshot idempotencyKey `customer-funding:<requestId>`.

## 5. Limit evidence

Captured from the authoritative `EnforceResult` of THIS approval (previously discarded). No second evaluation, no recalculated usage, no second reservation, no limit-architecture change.

## 6. Proofs (real PostgreSQL 18.4 — new suite 10/10)

- **(01) Success atomicity:** PENDING → approved by a DIFFERENT checker → exactly one FINAL snapshot with full content + maker/checker evidence + authoritative limit evidence (profile, rule ids, real reservation/usage ids from THIS approval); funding credit byte-identical (DEBIT settlement / CREDIT wallet, request APPROVED with journal linkage); workforce diagnostic API lists it. Creation alone snapshots nothing.
- **(02) Zero-fee financial proof:** exactly 2 principal-only journal lines; no new ledger accounts.
- **(03) Approve convergence (replay):** second approve → 409 `already APPROVED`; snapshot stays ONE; credited once; no duplicate journal. The state machine guarantees one snapshot per request.
- **(04) Maker/checker separation:** maker self-approve → 403; SUPPORT checker → 403; no snapshot; request stays PENDING; nothing posted.
- **(05) Creation idempotency:** identical payload converges on the same request; different payload → 409; creation never snapshots.
- **(06) Rejection:** REJECTED with reason; no snapshot, no journal, balance zero; rejected request cannot be approved afterwards.
- **(07) Rollback atomicity:** forced failure after the snapshot rolls back snapshot + reservations + usages + journal + APPROVED state (request stays PENDING, journal_id null, balance unchanged); a clean retry then succeeds producing EXACTLY one snapshot — no stranded side effects.
- **(08) Limit rejection:** tight DAILY_AMOUNT → 422; no snapshot, no stranded reservation, no mutation, request stays PENDING (legitimate non-terminal state preserved).
- **(09) Synthetic TEST-ONLY fee rule:** `fee_rules` proven 0 beforehand; rule captured (ruleId/version/parameters) on approval; status remains NOT_CONFIGURED; money flow principal-only.
- **(10) Immutability + boundary:** UPDATE/DELETE trigger-blocked; funding service uses resolveWithManager + recordDecisionWithManager only (never `.recordDecision(`, no feeEngine); `agent-funding.service.ts` still unwired; canonical product identity only.

## 7. Financial mutation comparison

Everything except the intended snapshot row is byte-identical: full 1281-test integration run (including the complete pre-existing v1-001 maker/checker funding suite) passes unchanged, plus explicit before/after balance, journal-line, ledger-account, request-state, limit-reservation/usage and idempotency assertions in the new suite. Settlement account, wallet behavior, journal structure, maker/checker rules and audit/outbox behavior unchanged.

## 8. Capability Registry changes

- **COMMERCIAL_DECISION_SNAPSHOT** (v6→v7, statuses unchanged: API_READY / enabled=true / configurationStatus NOT_CONFIGURED): scope text now WALLET_TRANSFER + CASH_TO_WALLET + WALLET_TO_CASH + CASH_TO_CASH (init + claim) + **CUSTOMER_FUNDING (checker approval)**; AGENT_FUNDING/DEFUNDING explicitly future work. No "all V1 flows commercially wired" claim.
- **FEE_RULE_RESOLVER** (v5→v6, text only): read-only participation incl. CUSTOMER_FUNDING; calculates/charges nothing.
- **Untouched:** FEE_ENGINE (DISABLED/enabled=false), COMMISSION_ENGINE, REWARD_ENGINE, all others, all V2 capabilities. Pricing remains NOT configured.

## 9. Files changed (4 modified + 1 new spec + report; `git diff` inspected — no unrelated changes)

| Path | Change |
|---|---|
| `src/customer-funding/customer-funding.service.ts` | capture authoritative EnforceResult; snapshot recording after journal + limit commit + APPROVED flip; optional resolver/snapshot deps; TEST-ONLY failure hook on ReviewFundingRequestInput |
| `src/customer-funding/customer-funding.module.ts` | imports CommercialDecisionModule + FeeRulesModule |
| `src/capability-registry/capability.seed.ts` | snapshot scope v7 (five flows), resolver text v6 — statuses unchanged |
| `test/v1-commercial-04-fee-rule-resolver.integration.spec.ts` | guard test 19 updated to the justified new reality: customer-funding moved unwired→wired (evidence-only assertions added); AGENT_FUNDING still asserted unwired |
| `test/v1-commercial-decision-03d-customer-funding-snapshot.integration.spec.ts` | NEW — 10 tests |
| `docs/V1-COMMERCIAL-DECISION-03D-VERIFICATION-REPORT.md` | this report |

**NOT touched:** migrations (0), snapshot schema/service/trigger, TransferService, shared agent execution service, agent flows, ledger/wallet code, FeeEngine, limit logic, controllers/DTOs.

## 10. Test & regression results

| Check | Result |
|---|---|
| New CUSTOMER_FUNDING suite | **10/10 pass** |
| Existing Customer Funding suite (v1-001 maker/checker) | PASS |
| Commercial: decision-01, 02 pilot, 03A, 03B, 03C, commercial-02, 03, 04 (incl. updated guard) | PASS |
| Limits 01 / 02 / 03 / 04-runtime | PASS |
| Capability registry + migration chain (73, zero new) | PASS |
| Focused total | 255/255 across the 15 named suites |
| **Full integration suite** | **59/59 suites, 1281/1281 tests** (was 58/1271) |
| Unit suite | 1764/1766 — the 2 pre-existing `external-reconciliation` failures, unchanged |
| `tsc --noEmit` / `npm run build` | exit 0 / exit 0 |
| ESLint — files created/modified by this task | new spec/module: **0 errors**; funding-service hunks: **0 errors** (verified against diff hunks; remaining reports are pre-existing repo-baseline issues outside my changes — honest) |

## 11. Remaining unresolved commercial decisions (carried, unchanged — none resolved by assumption)

Fee rates, VAT/tax, KYC eligibility/pricing, Agent-class pricing, fee precedence, tiered pricing, commission, rewards, promotions, fee enablement — all remain product/accounting decisions. Carried: UD-CD2a (REJECTED snapshots for failed flows — intentionally not done; rejection is not a financial execution).

## 12. Exact next dependency

**V1-COMMERCIAL-DECISION-03E — AGENT_FUNDING / AGENT_DEFUNDING snapshot wiring:** the last two unwired V1 flows; inspect each boundary first (agent funding uses its own pool-account mechanics), then apply the identical pattern (NOT_CONFIGURED fee, NONE commission/reward, authoritative limit evidence, atomic commit/rollback, replay never duplicates). After that, every V1 flow is commercially captured and approved pricing policy becomes the gate for any charging task.
