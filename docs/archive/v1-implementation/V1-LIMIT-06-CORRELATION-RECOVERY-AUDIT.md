# V1-LIMIT-06 — Authoritative Correlation State & Reservation Recovery Audit

**Type: AUDIT / DESIGN ONLY — zero source changes, zero migrations, zero flow modifications**
**Date: 2026-09-27**
**Branch: `arena/01a0d883-monienaija`**
**Audited HEAD: `ba7ae6a` (V1-LIMIT-05 VERIFIED, 70 migrations, 1,156/1,156 integration tests)**

---

## 1. Executive summary

**Verdict: a durable correlation→terminal-state mechanism is NOT required for V1 limit reservation recovery, and automatic reaping remains correctly BLOCKED — not because it is unsafe to build, but because there is nothing for it to do.**

The V1-LIMIT-05 report blocked automatic reaping on the grounds that "no authoritative cross-product terminal state exists to prove orphaning." This audit re-examined that conclusion from the opposite direction: *can an orphaned RESERVED reservation actually exist under the current architecture?* The answer, verified line-by-line across all 8 wired flows, is **no**:

1. Every flow executes `reserve → ledger posting → commit/release` inside **one SERIALIZABLE PostgreSQL transaction** on the flow's own `EntityManager`. PostgreSQL atomicity guarantees that a crash, disconnect, timeout, or serialization abort either commits the whole unit (reservations COMMITTED alongside the journal) or rolls it back entirely (no reservation rows persist at all).
2. The repository contains **no background jobs, schedulers, queues, workers, or outbox dispatchers** (verified: zero `@nestjs/schedule`/`@nestjs/bull`/`setInterval`/Worker usage in `src`; outbox events are only read for maturity reporting). There is no component that could hold a reservation open across transaction boundaries.
3. The only non-synchronous processor in the agent domain — C2C expiry — is **operator-invoked, status-only, posts no journal, and touches no reservations**.
4. Therefore any RESERVED row observable by diagnostics is either (a) part of a transaction still in flight — which must not be touched — or (b) evidence of a bug or unsanctioned manual database intervention — which requires human investigation, not automation.

Additionally, the audit found that **authoritative terminal state already exists per-flow** in existing entities (transfers, cash_to_cash_transfers, customer_funding_requests, ledger journals keyed by deterministic idempotency keys, and idempotency_records with IN_PROGRESS→COMPLETED/FAILED lifecycle). A *unified cross-product* table would duplicate that state, create a second transaction state machine, and add write-path risk to flows for zero correctness gain in V1. A minimal design is nonetheless documented (§11–13) for the one future condition that would change the answer: **asynchronous provider/external settlement (V2)**.

**Recommendations:** keep automatic reaping BLOCKED; keep the existing manual PRIVILEGED-only release boundary as the recovery mechanism; keep the stale flag diagnostic-only; document the per-flow correlation map (§5) for operators; revisit only if/when V2 introduces async financial legs. Maker-checker for manual release remains a product decision (UD-11) — infrastructure exists but no V1 requirement mandates it.

---

## 2. Existing transaction lifecycle (verified)

All 8 wired flows share one structural pattern, verified in source:

| Flow | Entry | Transaction wrapper | Retry |
|---|---|---|---|
| Wallet→Wallet | `TransferService.createTransfer` → `executeWithinTransaction` | `dataSource.transaction('SERIALIZABLE', …)` (transfer.service.ts:82) | 3 attempts + idempotency-conflict recovery |
| Cash→Wallet / Wallet→Cash | `AgentCashInService`/`AgentCashOutService` → `AgentFinancialExecutionService.execute` | `dataSource.transaction('SERIALIZABLE', …)` inside `MAX_SERIALIZABLE_ATTEMPTS` loop (agent-financial-execution.service.ts:110) | 3 |
| Cash→Cash init | `AgentCashToCashService.execute` | SERIALIZABLE inside retry loop (:206-208) | 3 |
| Cash→Cash claim | `AgentCashToCashClaimService.execute` | SERIALIZABLE inside retry loop (:230+) | 3 |
| Customer Funding approve | `CustomerFundingService.approve` | SERIALIZABLE (:253), request row locked `FOR UPDATE` | 3 |
| Agent Funding / Defunding | `AgentFundingService.executeFunding` | SERIALIZABLE inside retry loop (:208-210) | 3 |

Per-flow state machines:

- `transfers.status`: PENDING / PROCESSING / PENDING_RECOVERY / UNKNOWN / COMPLETED / FAILED / CANCELLED. **Verified: the V1 synchronous path only writes COMPLETED and FAILED** (`TransferService`). PENDING_RECOVERY/UNKNOWN exist in the schema state machine (migration 0023) and the dormant `TransferLifecycleService`, but **no V1 runtime code writes them** — they belong to the external-operation lifecycle design.
- `cash_to_cash_transfers.status`: UNCLAIMED → CLAIMED / EXPIRED (plus lock columns for claim attempts).
- `customer_funding_requests.status`: PENDING → APPROVED / REJECTED.
- Cash-in/out and agent funding/defunding **persist no dedicated domain row**: their durable outcomes are the ledger journal + the idempotency record + an audit event (audit written in a separate best-effort transaction, explicitly non-financial).

## 3. Existing reservation lifecycle (verified)

Writers of `limit_reservations` (complete list — grep-verified):

| Writer | Transition | Location |
|---|---|---|
| `LimitUsageService.reserveBatchWithManager` | → RESERVED | only inside a caller's SERIALIZABLE manager |
| `LimitUsageService.commitWithManager` | RESERVED → COMMITTED | same manager as the financial posting |
| `LimitUsageService.releaseWithManager` | RESERVED → RELEASED | same manager as the financial posting (failure paths) |
| `LimitReservationRecoveryService.releaseManually` (V1-LIMIT-05) | RESERVED → RELEASED | own SERIALIZABLE TX, PRIVILEGED-only, audited |

No DELETE exists anywhere against `limit_reservations`. COMMITTED and RELEASED are terminal and immutable in all code paths. Usage counters (`reserved_amount_minor`/`reserved_count`) move only in the same transactions as the reservation rows, under `FOR UPDATE` row locks with underflow guards.

## 4. Existing identifiers / correlation fields (verified)

| Identifier | Where stored | Notes |
|---|---|---|
| Reservation id | `limit_reservations.id` (uuid) | PK |
| Reservation idempotency_key | `limit_reservations.idempotency_key` | equals the flow's limit-enforcement key; indexed |
| Reservation correlation_id | `limit_reservations.correlation_id` (nullable varchar 160) | free-form; only W2W sets it deterministically (§5) |
| limit_usage_id FK | `limit_reservations.limit_usage_id` | links to the windowed usage row |
| Transfer id | `transfers.id` | W2W |
| Transfer idempotency key | `transfers.idempotency_key` (unique) | caller Idempotency-Key |
| Ledger journal id / idempotency key | `ledger_journals.id` / `idempotency_key` (unique) | **deterministic per-flow keys — see §5** |
| cash_to_cash_transfers.id / idempotency_key (unique per agent) / correlation_id / claim_idempotency_key / claim_journal_id | migration 0057/0058 | durable C2C state |
| customer_funding_requests.id / status / journal_id | migration-seeded table | durable funding state |
| idempotency_records.scope / idempotency_key / status | IN_PROGRESS → COMPLETED/FAILED, transitions on the **same manager** as the financial TX | scopes: `limit:usage:reserve`, `agent-financial.v1:{agentId}`, c2c init scope per agent, `claim:{transferId}`, transfer creation scope |
| Audit events | `audit_events` (entity_type/action/correlation_id) | best-effort, separate TX, never financial |

## 5. All 8 flow correlation mappings (verified)

REQUEST → RESERVATION → FINANCIAL EXECUTION → SUCCESS/FAILURE → COMMITTED/RELEASED, with every identifier observed in source:

| Flow | Limit idempotency key | Reservation correlation_id | Authoritative terminal state already in repo | Ledger journal key |
|---|---|---|---|---|
| W→W | caller Idempotency-Key | **`transfer:{transferId}`** (always set) | `transfers.status` = COMPLETED/FAILED (+failure_code) | `transfer:{transferId}` |
| Cash→Wallet | agent-scoped caller key | caller-provided or **null** | journal exists + `idempotency_records` COMPLETED (scope `agent-financial.v1:{agentId}`) + audit | `agent:{agentId}:{key}` |
| Wallet→Cash | agent-scoped caller key | caller-provided or **null** | same as above | `agent:{agentId}:{key}` |
| C2C init | agent-scoped caller key | caller-provided or **null** | `cash_to_cash_transfers` row (UNCLAIMED/CLAIMED/EXPIRED) with same `idempotency_key` | `agent:{agentId}:{key}` |
| C2C claim | caller claim key (scope `claim:{transferId}`) | caller-provided or **null** | `cash_to_cash_transfers.status` = CLAIMED + `claim_journal_id` + `claim_idempotency_key` | `claim:{transferId}:{key}` |
| Customer Funding | **`customer-funding-approve:{fundingRequestId}`** (derived — parseable) | caller-provided or **null** | `customer_funding_requests.status` = APPROVED/REJECTED + `journal_id` | `customer-funding:{fundingRequestId}` |
| Agent Funding | caller key | caller-provided or **null** | journal exists + `idempotency_records` COMPLETED + audit | `fund:{agentId}:{key}` |
| Agent Defunding | caller key | caller-provided or **null** | same as above | `defund:{agentId}:{key}` |

**Findings:**
- Two flows (W→W, Customer Funding) already carry parseable, always-present bridges from the reservation to an authoritative domain row.
- C2C init/claim have authoritative domain rows; the bridge is the shared idempotency key rather than a stored FK on the reservation.
- Cash-in/out and agent funding/defunding have **no domain row by design**; the authoritative evidence is the journal (unique deterministic idempotency key) plus the COMPLETED idempotency record. This is sufficient for human investigation and for any future mechanized check that parses the documented key conventions.
- `correlation_id` on reservations is **not reliable as a universal bridge** (nullable in 6 of 8 flows), and must not be treated as authoritative.

## 6. Crash / failure analysis (the 10 mandated cases)

| # | Scenario | PostgreSQL / application guarantee (verified) | Reservation outcome |
|---|---|---|---|
| 1 | Process crash **before** DB commit | Open transaction aborts on connection termination; everything rolls back | **No reservation rows exist** — reserve is rolled back with the journal |
| 2 | Process crash **after** DB commit | Commit is durable; the unit committed as one | All reservations COMMITTED (or RELEASED on a committed failure path, e.g. W2W `markFailed`) |
| 3 | Database connection loss mid-TX | Backend detects disconnect and rolls back the open transaction | No reservation rows |
| 4 | Serialization failure (40001/40P01) | Whole transaction aborts; flows retry (bounded 3) with fresh idempotency state — the limit-scope idempotency record rolled back with the TX, so the retry reserves cleanly | No rows from the aborted attempt; retry is safe |
| 5 | Application timeout | No partial commit exists — the TX either commits or rolls back as a unit; the app never commits reservation without journal (same TX) | No orphans |
| 6 | Client timeout | Same as 5; client retry converges via Idempotency-Key (`uq_transfers_idempotency_key`, agent-scoped unique indexes, funding idempotency, REPLAY short-circuit in `reserveBatchWithManager` before any increment) | Consumed at most once |
| 7 | Duplicate request | Idempotency at three layers: flow-level unique keys, `limit:usage:reserve` scope REPLAY short-circuit, partial-unique `(idempotency_key, limit_usage_id)` DB backstop | No double reservation/commit (regression-proven: 205-case matrix + V1-LIMIT-04 suite) |
| 8 | Partial external work | **None exists in V1** — all posting is in-house double-entry inside the same TX; no bank/provider/NIBSS legs | N/A |
| 9 | Future asynchronous processing | Does not exist today; would change the analysis (§17) | Future gate |
| 10 | Manual operational intervention | Sanctioned path: V1-LIMIT-05 manual release (PRIVILEGED-only, audited, RELEASED-only, exactly-once). Unsanctioned direct DB edits are outside application control | Diagnostics + audit trail detect; manual boundary remediates |

**Latent robustness observation (not an orphan path today):** the flows wrap `commitReservationsWithManager`/`releaseReservationsWithManager` in best-effort `catch {}` because the legitimate "no reservations exist" case throws `NotFoundException`. That catch would also swallow a genuine commit error (e.g., usage underflow). Such errors are unreachable under current invariants because the usage rows and counters were created/incremented earlier in the *same* transaction — but the pattern is a latent anti-pattern. Design note only: a future change could distinguish "nothing to commit" from real errors and let real errors abort the TX. No action taken (audit-only task).

## 7. PostgreSQL atomicity analysis

The invariant that makes the entire recovery question moot:

```
BEGIN SERIALIZABLE
  reserve limit usage(s)          -- INSERT/UPDATE limit_usages + INSERT limit_reservations (RESERVED)
  post journal                    -- INSERT ledger_journals + ledger_lines
  commit reservations             -- UPDATE limit_reservations → COMMITTED, move reserved→used
COMMIT                            -- single atomic commit point
```

All three phases share one `EntityManager` and one database transaction in every wired flow (verified per-flow in §2). PostgreSQL guarantees this unit is indivisible:

- There is **no window observable by any other session** in which a RESERVED row exists without its eventual COMMITTED/RELEASED outcome also being decided by the same commit.
- SERIALIZABLE plus `FOR UPDATE` row locks serialize concurrent reservations on the same usage window; serialization aborts roll back completely.
- The idempotency record for scope `limit:usage:reserve` is written inside the same transaction, so replay bookkeeping cannot outlive a rolled-back reservation either.

Consequently the V1-LIMIT-05 requirement "a stale timestamp alone is NOT sufficient" is satisfied in the strongest possible way: **there is no timestamp at which a RESERVED row is stale — it is either in flight or impossible.**

## 8. Whether orphaned RESERVED rows can currently occur

**No. Under the current architecture, an orphaned RESERVED reservation cannot occur through any application path.**

Formally, a row would be orphaned iff it persists as RESERVED after its business operation reached a terminal outcome that did not commit/release it. Both persistence and outcome are decided by the same atomic commit (§7), so the condition is unsatisfiable. The only producers of RESERVED rows that survive past their transaction are:
1. **In-flight transactions** (observable only under MVCC snapshots; never actionable), and
2. **Out-of-band manipulation** (bug or direct DB intervention) — which is precisely the class the manual boundary exists for, and which automation must never guess about.

The V1-LIMIT-05 regression suite proves the observable consequences: failed financial execution never consumes allowance (8 flows), successful execution always commits (8 flows), replay never double-consumes (8 flows), and a 7-day-aged RESERVED row survives every diagnostics query untouched.

## 9. Existing manual recovery boundary (audited)

`POST /api/v1/internal/limit-reservation-recovery/release` (V1-LIMIT-05):

- PRIVILEGED workforce role only (route policy + controller check); OPERATOR/SERVICE/SUPPORT denied (tested).
- Mandatory reason (≥10 chars), actor captured, audit event `limit_reservation / MANUAL_RELEASE` inside the release transaction.
- RELEASED-only transition; COMMITTED → 409 immutable; RELEASED → idempotent `ALREADY_RELEASED`; SERIALIZABLE + `FOR UPDATE` → exactly-once under concurrent calls (tested with 3 concurrent callers).
- No ledger mutation, no DELETE, no historical rewrite (tested via checksums).
- Stale flag on diagnostics (`LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES`, default 30) surfaces candidates for human investigation; it triggers nothing.

**Assessment: sufficient for V1.** It converts the only real orphan source (out-of-band state) into an investigated, audited, exactly-once human decision. Diagnostics give the operator everything needed to investigate (principal, product, window, correlation id, idempotency key, age) and §5 gives the mapping from those fields to the authoritative domain evidence.

## 10. Automatic reaper safety analysis

**Is it technically safe?** Not provable in V1 — and, more fundamentally, unnecessary.

- Any predicate based on age/createdAt/updatedAt alone is unsafe by policy and by construction (it cannot distinguish in-flight from orphaned).
- A predicate based on authoritative terminal state (§14) is **unsatisfiable for legitimately produced rows**: no flow can leave a RESERVED row whose operation terminally failed outside the same atomic commit. The only rows such a predicate could ever match are bug/tamper artifacts, for which the correct response is human investigation, not automation.
- Implementing a reaper anyway would create a component whose only possible actions are no-ops (safe cases) or unauthorized releases (unsafe cases). That is negative expected value.

**What authoritative state would it require?** Per §14: a proven terminal FAILED/CANCELLED state of the correlated operation, verified absence of the corresponding journal, and an established correlation. For 6 of 8 flows the correlation is currently only recoverable by parsing documented key conventions (possible for a human, brittle for automation); for 2 flows it is parseable on `correlation_id`. Building the machinery to mechanize this for a class of events that cannot occur is not justified.

**Does V1 actually require it?** No (§8). **Operational risk without it:** negligible — the failure direction is fail-safe (a stranded RESERVED row withholds allowance; it cannot lose money or double-spend), it is visible via the stale flag, and the manual boundary remediates it. **Decision required:** none for V1; the BLOCKED status of `LIMIT_RESERVATION_RECOVERY` (PRODUCT_DECISION) remains accurate.

## 11. Proposed correlation architecture — only if genuinely required

**Conclusion: not required for V1.** The following design is recorded solely for the condition that would change the answer — **V2 asynchronous provider/external settlement** (Wallet→Bank, NIBSS, provider callbacks) where reserve and posting would legitimately span multiple transactions and time:

Design goals (if ever triggered): answer, for any reservation, (a) which business operation owns it, (b) the operation's authoritative terminal state, (c) which flow/product created it, (d) whether it is still pending — **without** duplicating the transaction domain, creating an alternative ledger, or a second financial state machine.

Principles:
1. The correlation row is a **pointer + lifecycle flag**, never a source of financial truth. Ledgers and domain tables remain authoritative.
2. Written in the **same transaction** as the reservation (reserve phase) and as the terminal transition (commit/release phase) — it must never introduce a new commit boundary.
3. One row per business operation, not per reservation (reservations reference it).
4. Terminal states are closed-set and mapped 1:1 from the owning domain entity; the correlation row never infers state from time.

## 12. Minimal proposed schema (design only — NOT created by this task)

```
limit_operation_correlations
  id                     UUID PK
  product                VARCHAR(80)  NOT NULL          -- WALLET_TRANSFER | CASH_TO_WALLET | …
  principal_type         VARCHAR(20)  NOT NULL
  principal_id           UUID         NOT NULL
  operation_reference    VARCHAR(255) NOT NULL          -- transfer id / c2c transfer id / funding request id / journal idempotency key
  status                 VARCHAR(20)  NOT NULL          -- PENDING | SUCCEEDED | FAILED | RELEASED
  requested_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  terminal_at            TIMESTAMPTZ  NULL
  CHECK status IN ('PENDING','SUCCEEDED','FAILED','RELEASED')
  UNIQUE (product, operation_reference)

limit_reservations.operation_correlation_id UUID NULL REFERENCES limit_operation_correlations(id)
```

Notes: no amounts, no balances, no rules, no ledger fields; `operation_reference` reuses existing authoritative identifiers (§4) rather than inventing a new identity; backfill for existing rows is unnecessary because they cannot be orphaned. Estimated cost if ever built: one additive migration, two writes per flow inside existing transactions. **Not justified today.**

## 13. Terminal-state model (design only, contingent on §11)

| Correlation status | Meaning | Set by |
|---|---|---|
| PENDING | operation in flight (same TX as reservation) | reserve phase |
| SUCCEEDED | operation committed with its journal | commit phase (same TX as `commitWithManager`) |
| FAILED | operation terminally failed; reservations released | release phase / flow failure path (same TX) |
| RELEASED | manual recovery released the last pending reservation | recovery boundary (same TX) |

Mapping from existing domain states would be: transfers COMPLETED→SUCCEEDED, FAILED/CANCELLED→FAILED; cash_to_cash CLAIMED→SUCCEEDED (claim side), EXPIRED→FAILED (init side only if allowance-refund-on-expiry is ever adopted); customer_funding APPROVED→SUCCEEDED, REJECTED→FAILED; cash-in/out/funding/defunding: journal committed→SUCCEEDED. **This model is a design artifact of this document; nothing was implemented.**

## 14. Recovery safety predicate

Definitions (for any future mechanized recovery, V2+):

```
SAFE_TO_RELEASE(r) ⇔
     status(r) = RESERVED
 ∧ ∃ operation O correlated to r via an authoritative link (§5/§12)
 ∧ terminal_state(O) ∈ {FAILED, CANCELLED}          -- proven, not inferred from time
 ∧ journal(O) does not exist                          -- no financial posting can still complete
 ∧ no other reservation of O is COMMITTED
 ∧ O is not reachable by any in-flight or retryable path (idempotency records terminal)

MUST_NOT_RELEASE(r) ⇔
     O still PENDING/PROCESSING (or any retry attempt remains possible)
 ∨ O SUCCEEDED (journal exists) — usage was legitimately consumed
 ∨ terminal_state(O) UNKNOWN — including correlation not establishable
 ∨ state ambiguous (conflicting evidence between domain row, journal, idempotency record)
 ∨ status(r) ∈ {COMMITTED, RELEASED}
```

Under V1's synchronous architecture the left-hand side of `SAFE_TO_RELEASE` has no satisfiable instances produced by application code (§8) — which is precisely why automatic reaping is blocked rather than implemented.

## 15. Maker-checker analysis (UD-11)

Verified facts:
- Maker-checker **infrastructure exists**: `A2MakerCheckerRuleV1` configuration, `PrivilegedActionApprovalService` (request/consume/decide with TTLs and emergency access), finance-role administration matching rules by action.
- The default workforce configuration ships with `makerCheckerRules: []` — no action is currently maker-checker-gated by configuration.
- Customer Funding already enforces maker≠checker at the service level (a different business need: dual control over money movement, not over diagnostics/recovery).
- **No authoritative repository or product requirement establishes maker-checker as mandatory for the manual reservation release boundary in V1.**

Assessment: the existing boundary already provides the essential controls — strictest role (PRIVILEGED), mandatory justification, full audit, exactly-once semantics, RELEASED-only. Maker-checker would add a second-approval step valuable for high-frequency or high-risk operational actions; here the action is exceptional (should occur ~never, per §8), low-frequency, and fully audited. **UD-11 remains a product/operational decision; this audit recommends no implementation.** If the product later requires it, wiring a `makerCheckerRule` for the release action is incremental work against existing infrastructure.

## 16. Operational diagnostics requirements

Already satisfied by V1-LIMIT-05 (verified in this audit, no changes proposed):
- `GET /internal/limit-usages`, `GET /internal/limit-reservations` (OPERATOR/SERVICE/PRIVILEGED, safe projection, deterministic pagination).
- Stale flag with configurable threshold for candidate discovery.
- Manual release boundary with audit.

Operator runbook implied by this audit (documentation-level, no code): when a stale RESERVED row is flagged —
1. Read principal/product/window/correlation/idempotency fields from diagnostics.
2. Apply the §5 mapping for that product to locate authoritative evidence (transfers row / cash_to_cash_transfers row / customer_funding_requests row / journal by deterministic key / idempotency record status).
3. If evidence shows the operation succeeded → the row is anomalous; escalate as a defect (do NOT release — allowance was consumed).
4. If evidence shows the operation terminally failed with no journal → release via the PRIVILEGED boundary with the evidence recorded in the reason.
5. If evidence is ambiguous → escalate; never release on age alone.

Optional future (not justified now): embed the §5 evidence lookup into diagnostics responses. Skipped because it serves a scenario that cannot currently occur.

## 17. V1 / V2 boundary

- **V1 is in-house and synchronous.** No Wallet→Bank, no NIBSS, no provider settlement, no callbacks. Every financial effect is an internal double-entry journal inside the requesting transaction. Within this boundary, orphaned reservations are impossible (§8) and the audit's verdict holds.
- **The answer changes the moment a flow gains an asynchronous external leg** (e.g., V2 provider settlement where funds move after the request returns). Then reserve and final posting would span transactions; a durable correlation/terminal-state (§11–13) becomes a genuine correctness requirement, and a bounded, evidence-gated reaper (§14) becomes justifiable.
- The dormant `TransferLifecycleService` states (PENDING_RECOVERY/UNKNOWN) are the repository's existing vocabulary for that future — they are unwritten by any V1 path (verified), confirming V1 has not crossed this boundary.
- Recommendation: when the first V2 async flow is designed, implement §12–13 inside that flow's transactions from day one — not retrofitted onto V1 flows.

## 18. Product / operational decisions (open)

| ID | Decision | Status |
|---|---|---|
| UD-10 | Automatic reservation reaping | **Remains BLOCKED** — this audit strengthens the basis: unnecessary in V1 (atomicity), not merely unprovable. Requires a V2 async flow + §12–14 machinery + explicit product sign-off. |
| UD-11 | Maker-checker on manual release | Open product/operational decision; infrastructure exists; audit recommends no action for V1. |
| UD-12 | SUPPORT visibility of limit diagnostics | Unchanged; excluded consistently with all limit surfaces. |
| UD-13 | Stale threshold semantics | Confirmed diagnostics-only; no business rule attaches to 30 minutes. |
| UD-14 (new) | C2C expiry and limit allowance: expired unclaimed transfers keep the agent's COMMITTED CASH_TO_CASH usage consumed (funds remain in the unclaimed liability account; no refund journal). Whether expiry should also refund limit allowance is a product decision. Not a reservation-safety issue (rows are COMMITTED, not RESERVED). | Open. |
| UD-15 (new) | Latent best-effort `catch {}` around commit/release reservation calls (§6 note). Whether to harden to distinguish "nothing to commit" from real errors. Robustness preference only; no current defect. | Open. |

## 19. Recommendation

1. **Do NOT build the correlation table for V1.** No orphan class exists to justify it; it would duplicate domain state and add write-path risk.
2. **Do NOT implement automatic reaping.** Keep `LIMIT_RESERVATION_RECOVERY` BLOCKED (automatic part) with the manual boundary as the operational mechanism. Registry already reflects this truthfully; no capability status changes are warranted by this audit.
3. **Keep** the V1-LIMIT-05 diagnostics + manual release boundary unchanged.
4. **Adopt §5 (correlation map) and §16 (runbook)** as operator documentation — this report is the reference.
5. **Gate V2 async flows** on implementing §12–14 from the start.
6. Optionally track UD-14/UD-15 as product/robustness backlog; neither affects reservation safety.

## 20. Proposed implementation sequence — ONLY if implementation is justified

Implementation is **not justified for V1**. Should the V2 async gate (§17) ever open, the sequence would be:

1. Migration (additive): `limit_operation_correlations` + nullable `limit_reservations.operation_correlation_id` (§12).
2. Wire correlation-row writes into the new async flow's reserve/commit/release phases inside the existing transactions (no new commit boundaries).
3. Mechanized recovery job: bounded batch, `FOR UPDATE SKIP LOCKED`, §14 predicate evaluated strictly, RELEASED-only, audited, dry-run mode first.
4. Diagnostics join: reservation ↔ correlation terminal state.
5. Only then re-evaluate `LIMIT_RESERVATION_RECOVERY` lifecycle with evidence.

---

## Audit method & integrity notes

- All claims verified against source at HEAD `ba7ae6a` (transaction wrappers, enforce/commit/release call sites, identifier fields, writer sets, scheduler/queue absence, outbox consumers, maker-checker wiring, expiry service behavior).
- **No source files, migrations, or tests were modified by this task.** Verification: `git diff` shows only this document added; `tsc --noEmit` and `nest build` pass unmodified; no ledger or financial behavior changed.
- No regression results are claimed or fabricated in this document; the baseline remains V1-LIMIT-05's 1,156/1,156 integration tests at `ba7ae6a`.
