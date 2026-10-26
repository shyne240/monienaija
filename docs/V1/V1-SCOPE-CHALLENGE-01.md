# V1-SCOPE-CHALLENGE-01 — Reassessment of Deferred Features Against the Original V1

- **Baseline:** `dac889183da78219f57f63c243cc50abab92e454` (`origin/arena/01a0d883-monienaija`)
- **Type:** AUDIT-ONLY. No source, migration, API, test, or configuration changes accompany this document.
- **Method:** independently test the seven deferred classifications from the 74-process re-audit against
  the original V1 intent and the current repository. Classification vocabulary:
  `KEEP IN V1` / `OPTIONAL V1` / `DEFER TO V2` / `DECISION REQUIRED`.

---

## 1. Executive conclusion

Six of the seven deferrals survive independent re-examination. Zero of the seven items is a completed
V1 capability that was misclassified; zero requires immediate engineering to operate the defined V1
product. The scenario is different per item:

- **Push notifications, aggregator/platform commission accounting, reward crediting, and external
  commission settlement** are genuinely outside the intended V1 boundary — supported by original
  decision-pack and contract language, not merely by the latest audit.
- **Aggregator self-service (login API + scoped position), reconciliation-break workflow, and the
  operations reversal workflow** do **not** have a decisive original-V1 requirement either way. They
  currently rest on *unresolved decisions*, not on an established V1 exclusion. They must not be
  silently labelled "V2"; each needs its decision formally made (then either small V1 builds or a
  recorded V2 deferral).
- **Agent unified transaction history (#59)** remains the single concrete missing V1 engineering
  feature — nothing in this challenge displaces it.

## 2. Evidence methodology

Read-only inspection only: `docs/` (A1/A7/B1/B2/B2F contracts, V1-COMMERCIAL-ACCOUNTING-DECISION-PACK-01,
V1-END-TO-END-PROCESS-AUDIT, V1-005/V1-008/PRODUCT-COMPLETION/HARDENING/IMPLEMENTATION audits,
V1-REWARD-01 architecture, SMS-V1 report) and `src/` (notification resolver/event-map, reconciliation
controller+services, ledger reversal primitive, commercial-accounting service/enums, agent-app routes,
aggregator module). No status was taken from the latest audit alone; each classification below carries
the strongest original-V1 quote or precise reference plus the current implementation state.

## 3. Seven-item assessment table

| # | Item | Original-V1 evidence (strongest) | Current state | Dependencies | Classification |
|---|---|---|---|---|---|
| 1 | Push notifications / device tokens | `V1-005-VERIFICATION-REPORT` §Push; `SMS-V1-VERIFICATION-REPORT` §6; `V1-COMMERCIAL-IMPLEMENTATION-AUDIT` line ~305: *"No `PUSH ONLY` rows exist: push … is always an additional channel, never the sole one, at V1"* | (c) machinery exists; delivery substrate absent (resolver SKIPs `PUSH_TOKEN_DEPENDENCY_MISSING`; `notification_push_enabled` honored) | `push_device_tokens` schema/registration (explicitly not invented); FCM/APNS | **DEFER TO V2** |
| 2 | Aggregator login API / scoped financial position | `V1-END-TO-END-PROCESS-AUDIT` H6: *"`AGGREGATOR` principal exists in the enum for future/partner scope, but no aggregator session/issue path in V1"*; §23-9 product decision open; `V1-HARDENING-10`: *"Aggregator financial position is not V1 requirement (relationship only)"* | (c/d) corporate identity, relationships, funding-attribution COMPLETE (H1–H5, K9); no credential issuance, no scoped position endpoint (admin-aggregator exposes list only) | Decision §23-9; then auth issuance + scoped-read design | **DECISION REQUIRED** (provisional DEFER to V2) |
| 3 | Reconciliation-break workflow | `V1-END-TO-END-PROCESS-AUDIT` §25-1: *"Reconciliation break-resolution governance (A) — resolver roles, resolve-vs-acknowledge, audit/outbox duties; reporting exists today"* | (b/c) 9-check report, trial balance, finance verification, account activity, MISMATCH/discrepancy types + evaluator all exist and are COMPLETE; no break table/resolve endpoint | Accounting governance decision (§25-1) + small workflow build | **DECISION REQUIRED** |
| 4 | Operations reversal workflow | `V1-008-DEPENDENCY-RE-AUDIT` B3: *"Lower: V1 reversals are exception-only, not normal flow"*; `V1-HARDENING-10` line 342: *"No (V1 intentionally absent)"*; `V1-PRODUCT-COMPLETION-AUDIT` V1-017: *"Document: keep as Privileged + strict reason … in P2 — V1?"*; B2F journal governance: *"Corrections/reversals remain future controlled governance using A5's existing reversal authority"* | (c) primitive complete and hardened: `LedgerService.reverseJournal` (SERIALIZABLE, compensating DR/CR swap, unique `reversal_of_journal_id`, version, audit+outbox); generic `POST /ledger/journals/:id/reversal` exists; **no ops transfer-reversal with reason capture/maker-checker/notifications** | Product/workflow decision (V1-017) + build (gate, reason, state, idempotency, notifications, recon) | **DECISION REQUIRED** (provisional DEFER to V2 — documented as intentionally absent, but never formally ratified) |
| 5 | Commission settlement / payout | DP-08/D-C-014 register row verbatim: *"payout rail is V2-parked (out of V1); netting/credit = journal design"*; enum doc: *"ACCRUE_NOW_SETTLE_LATER — accrue the payable at completion; settlement execution is V2 scope"*; A18 boundary: payout execution V2; `EXTERNAL_SETTLEMENT` V2/PLANNED | (a) accrual fully implemented (EXPENSE_PAYABLE payable recognition, proven 170/170 + settlement-01 8/8); (a) immediate internal settlement implemented as AGENT_WALLET_NETTING; (d) settle-later release rail absent by decision | Internal settle-later mechanism choice (D-C-014: wallet credit vs pool netting/cadence) — open; external rails V2 | **DECISION REQUIRED** for the internal settle-later mechanism; **DEFER TO V2** for any external/bank/payout execution |
| 6 | Aggregator / platform commission accounting | DP-25 (D-C-009) register verbatim: *"(a) no aggregator commission in V1"*; *"aggregator has no ledger identity today"*; runtime **deliberately** supplies no `aggregatorId` (IMPLEMENTATION-02); PLATFORM mapping D-C-010 open | (b) calculation/allocation machinery supports AGGREGATOR/PLATFORM recipient types; accounting boundary fails closed (`COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED`, `COMMERCIAL_PLATFORM_ALLOCATION_POSTING_NOT_PROVISIONED`) — proven on real flow (S04) | D-C-009 (participation YES/NO) + D-C-010 (platform mapping) + aggregator ledger identity; commercial agreements live outside repo | **DEFER TO V2** (formalize D-C-009/010 decisions; fail-closed posture already correct) |
| 7 | Reward crediting / accounting | `V1-REWARD-01` scope: *"It decides mechanics only"*; §1.1 *"In scope (machinery)"* with *"No wiring into any of the seven V1 financial flows"*; §25-2 accounting register open (payable vs promo-expense vs contra-revenue vs wallet credit…) | (a/b) engine + registry + rules schema COMPLETE as machinery (REWARD-01 verified); no flow wiring, no crediting, no accounting treatment — all deliberate | Accounting treatment decision (§25-2) + policy values; then wiring/crediting build | **DEFER TO V2** (architecture already delivered as V1 machinery — see §9/§11) |

## 4. Detailed assessment

### A — Push notifications / device tokens
1. **Original V1 evidence.** A7 notification contract + V1-005 established channel resolution with SMS as
   the security channel; the commercial-implementation audit states there are **no PUSH-sole events at V1**
   ("push is always an additional channel, never the sole one"). V1-008 event coverage: provider-neutral
   coverage COMPLETE; only "actual provider delivery" pending.
2. **Current state.** Event map, outbox, dispatcher, worker, retry, idempotency, opt-out (incl.
   `notification_push_enabled` honored), inbox, admin diagnostics — all implemented and re-verified on
   HEAD (sms-v1-01 10/10 family). Push destination resolves to `PUSH_TOKEN_DEPENDENCY_MISSING` (documented,
   never faked).
3. **Dependencies.** True technical: device-token entity + registration endpoints + FCM/APNS provider.
   These were *deliberately not invented* (V1-005 §111) — a documented dependency, not a decision-avoidance.
4. **Impact of omission in real V1 ops.** Customers receive every V1-required security/transactional
   notification by SMS (and inbox): funding approved/rejected, transfers, tickets, C2C claimed/expired.
   Nothing becomes silent; push would be additive convenience.
5. **Classification: DEFER TO V2.**

### B — Aggregator login API / scoped financial position
1. **Original V1 evidence.** The 74-row catalogue records the AGGREGATOR principal as *future/partner
   scope* with no V1 session path, and leaves §23-9 ("whether aggregators get their own login/position
   surface") **open**; hardening-10 asserts relationship-only is not a V1 requirement. No foundational
   contract (A1/B1/B2) establishes an aggregator self-service portal for V1.
2. **Current state.** H1–H5 COMPLETE: creation, lifecycle, agent relationships, funding-via-attribution,
   visibility + K9 admin. Absent: credential issuance (no aggregator-auth service/module path) and any
   scoped position endpoint (verified: `admin-aggregator.controller` exposes list only).
3. **Dependencies.** One unresolved product decision (§23-9). Technical work thereafter is contained
   (auth issuance mirroring agent-auth + a scoped read reusing reconciliation).
4. **Impact of omission in real V1 ops.** Aggregators are administered by workforce: sponsorships,
   relationships and funding-attribution all function. What is impossible is *self-service* — an
   aggregator cannot query its own position; Finance answers via existing agent positions + reconciliation.
5. **Classification: DECISION REQUIRED** (the audit's V2 label is a *reasonable interpretation*, not an
   established exclusion; §23-9 must be decided).

### C — Reconciliation-break workflow
1. **Original V1 evidence.** §25-1 of the process audit records this as an **accounting decision**,
   acknowledging "reporting exists today" — i.e., the requirement for V1 reconciliation *reporting* was
   met; the workflow was parked on governance, never on implementation capacity.
2. **Current state.** Reporting tier COMPLETE: 9-check report, trial balance, finance verification,
   per-account activity, discrepancy evaluator with MISMATCH/ownership/currency types. Absent: any
   break entity, resolve/acknowledge endpoint, or audit trail for break closure.
3. **Dependencies.** Governance (resolver roles, resolve-vs-acknowledge semantics, audit/outbox duties).
   Note V1's structural mitigation: everything is internal double-entry, so true financial breaks are
   rare by construction; the report's `failed_transfer_attempts` is WARNING-grade, not a break.
4. **Impact of omission in real V1 ops.** Breaks (when observed) are *visible* but have no system of
   record for investigation/resolution — Finance would close them outside the system (spreadsheet/ticket),
   losing editor-level auditability of the closure itself.
5. **Classification: DECISION REQUIRED** (governance first; the build afterwards is small — entity +
   resolve endpoint + audit/outbox reusing existing primitives).

### D — Operations reversal workflow
1. **Original V1 evidence.** Three documents speak: V1-008 places ops reversal as exception-only and
   low-priority; hardening-10 records "V1 intentionally absent"; PRODUCT-COMPLETION V1-017 leaves the
   literal question "**V1?**" open and prescribes the safe shape (Privileged + strict reason +
   idempotency, P2). B2F governance designates reversals as "future controlled governance using A5's
   existing reversal authority". Net: the corpus *leans* exclusion but never ratifies it — and the V1
   intent statement includes "transaction lifecycle controls", which plausibly covers exception reversal.
2. **Current state.** The primitive is production-grade: `LedgerService.reverseJournal` (lines ~224),
   SERIALIZABLE, mirrored compensating journal, unique `reversal_of_journal_id` (double-reversal
   impossible), optimistic version, audit + outbox events. A generic ledger-controller reversal route
   exists. Missing: an operations-level workflow — authorization narrowing (PRIVILEGED + maker/checker),
   mandatory reason capture bound to the subject transaction, transfer-state transition, customer/agent
   impact handling, notifications, reconciliation linkage.
3. **Dependencies.** Workflow/product decision (V1-017) — not a technical dependency; all primitives exist.
4. **Impact of omission in real V1 ops.** A genuinely legitimate-but-failed customer/agent transaction
   cannot be operationally corrected without direct database work or manual compensating guidance. For a
   payment platform this is the sharpest of the seven omissions in day-2 operations — which is exactly
   why several docs describe the safe shape. (Classification must still respect scope discipline.)
5. **Classification: DECISION REQUIRED** (provisional DEFER to V2 per existing documentation; the formal
   decision should explicitly answer V1-017).

### E — Commission settlement / payout
1. **Original V1 evidence.** DP-08/D-C-014 register row: "**payout rail is V2-parked (out of V1);
   netting/credit = journal design**"; the recognition-timing enum documents settle-later *execution* as
   V2 scope; A18 boundary excludes payout execution; `EXTERNAL_SETTLEMENT` capability is V2/PLANNED.
   Simultaneously, the accrued-payable recognition *was* ratified V1 (DP-05=EXPENSE_PAYABLE pairing
   DP-07=ACCRUE_NOW_SETTLE_LATER) and internal *immediate* settlement was ratified as netting.
2. **Current state.** Accrual: fully implemented, machine-proven (pooled payable, attribution in
   snapshots, idempotent, atomic). Immediate internal settlement: implemented via AGENT_WALLET_NETTING
   (expense DR → acting-agent wallet CR at completion). Settle-later *release* of the standing payable:
   absent — evidence string `ACCRUED_SETTLEMENT_RAIL_V2_SCOPE_NOT_IMPLEMENTED`.
3. **Dependencies.** Internal: decision D-C-014 (release rail = wallet credit vs funding-pool netting,
   and cadence). External: V2 by approved boundary (banks/NIBSS excluded).
4. **Impact of omission in real V1 ops.** Under EXPENSE_PAYABLE, agents hold an accrued receivable with
   no V1 mechanism converting it to spendable wallet credit — Finance sees a correct standing liability
   in the ledger, but there is no release path. Under AGENT_WALLET_NETTING there is nothing missing at
   all: commission is settled at completion. So the omission matters only if operations choose the
   accrual treatment *and* require intra-V1 release.
5. **Classification: DECISION REQUIRED** — the internal settle-later release mechanism (intra-ledger:
   wallet credit or pool netting) is the open D-C-014/DP-08 question and is *analyzable within V1*
   (no external integration needed); **external payout remains DEFER TO V2**, fully agreed by the record.

### F — Aggregator / platform commission accounting
1. **Original V1 evidence.** D-C-009 register row offers "(a) **no aggregator commission in V1**" and
   records "aggregator has no ledger identity today"; IMPLEMENTATION-02 *deliberately* never supplies
   `aggregatorId` to the engine; PLATFORM mapping (D-C-010) is open and the agreement evidence lives
   outside the repository.
2. **Current state.** Calculation/allocation machinery already models AGGREGATOR and PLATFORM recipient
   types (one winner per type). The accounting boundary refuses them precisely
   (`COMMERCIAL_AGGREGATOR_ACCOUNTING_NOT_SUPPORTED` / `COMMERCIAL_PLATFORM_ALLOCATION_POSTING_NOT_PROVISIONED`)
   — verified end-to-end on a real flow (settlement-01 S04), wallet untouched, zero orphans.
3. **Dependencies.** Two decisions (D-C-009 participation, D-C-010 platform mapping) + an aggregator
   ledger identity if YES. No engineering dependency.
4. **Impact of omission in real V1 ops.** Commission runs only for agents — which matches the current
   participation model. If an aggregator commission rule were ever seeded today, affected flows fail
   closed rather than posting invented accounting (safe, but operationally loud — hence D-C-009 should
   be formally resolved before any such rule exists).
5. **Classification: DEFER TO V2** — with the formalization of D-C-009/010 recorded as a decision task;
   the fail-closed guard is the correct V1 posture and requires no work.

### G — Reward crediting / accounting
1. **Original V1 evidence.** The reward architecture doc is unambiguous: it *"decides mechanics only"*;
   its in-scope list is machinery with "**No wiring into any of the seven V1 financial flows**"; the
   grant accounting treatment is an explicitly open register (§25-2: payable vs promo-expense vs
   contra-revenue vs wallet credit vs deferred liability, timing, reversal linkage).
2. **Current state.** Engine + registry + rule schema (FIXED/PERCENTAGE × bases, single-dimension
   discipline, FK to product catalogue) COMPLETE and verified as machinery; zero rules in production by
   design; no crediting path exists or was ever promised for V1.
3. **Dependencies.** Accounting treatment decision + reward policy values; then a wiring/crediting build.
4. **Impact of omission in real V1 ops.** None at launch: no reward grant is ever created because no
   rule exists; snapshots correctly record `NONE`/`NOT_CONFIGURED`. Commercial campaigns simply are not
   part of the V1 product surface.
5. **Classification: DEFER TO V2** — the V1 deliverable was the architecture, and it is done (§11-D).

## 5–9. Consolidation
(Sections 5–9 are embedded in §4 above: original-V1 evidence → current implementation → dependencies →
operational impact → recommended classification, per item.)

## 10. Reconciliation against the latest 74-process audit

| Audit row(s) | This challenge's finding |
|---|---|
| #37 push `NOT_IMPLEMENTED (external)` | **Supported by original intent** — refined: not "external-only"; SMS is the sole V1 channel, push substrate is a documented V2 dependency |
| #31/#32 aggregator login/position (`BACKEND_ONLY*`/`PARTIAL`) | **Dependent on unresolved decision** (§23-9) — audit overstated certainty of exclusion |
| #55 reconciliation breaks (`BLOCKED — ACCOUNTING`) | **Consistent** — classification corrected from "blocked" to "decision required"; reporting tier genuinely complete |
| #56 reversal ops (`BLOCKED — PRODUCT+V2`) | **Dependent on unresolved decision** (V1-017) — documentation leans exclusion but the "V1?" flag was never closed |
| #48 commission posting families (settlement lane) | **Supported** for external rails; **refined**: internal settle-later release is a V1-analyzable decision (D-C-014), silently folded into "V2" by the audit |
| D-C-009/010 lanes (aggregator/platform commission) | **Supported** — original register contemplates "no aggregator commission in V1"; fail-closed posture correct |
| #50 reward crediting (`BLOCKED — PRODUCT(+A)`) | **Supported** — V1 deliverable was machinery; reclassified as delivered-architecture + V2 activation |
| All other 67 rows | No scope-challenge findings; prior classifications stand |

## 11. Revised V1 closure scope

**A. Features that should remain outside V1 (boundary intact):**
1. Push notifications / device-token infrastructure (incl. FCM/APNS).
2. External commission settlement/payout execution, and anything touching banks/NIBSS/providers.
3. Aggregator and PLATFORM commission accounting participation (pending formal D-C-009/010 closure).
4. Reward crediting/accounting activation (architecture stays as delivered machinery).
5. All 12 standing boundary exclusions (bank settlement, provider integrations, cards, non-NGN,
   airtime/bills/data/electricity/cable/betting).

**B. Features that should be restored to V1:** **none** — no item was found fully-built-but-misclassified
or required by original V1 language as an active capability.

**C. Features requiring a product/accounting decision before classification:**
1. §23-9 — Aggregator self-service (login API + scoped financial position).
2. §25-1 — Reconciliation break-resolution governance (roles, resolve-vs-acknowledge, audit duties).
3. V1-017 — Operations reversal workflow (explicitly answer the open "V1?" with the documented safe shape).
4. D-C-014/DP-08 — Internal settle-later commission release mechanism (wallet credit vs funding-pool
   netting, cadence) — only if the accrual treatment is operated and release is needed *within* V1.
   (If ratified for V1, these each become small, contained builds on existing primitives — they would
   join, not displace, the implementation queue.)

**D. Features already implemented — no further engineering required:**
commission accrual + agent-wallet netting + fail-closed guards (170/170 + settlement-01 8/8), fee/VAT
accounting, reward engine machinery, reconciliation reporting tier, notification pipeline incl. Robase
SMS adapter, reversal *primitive* (workflow-less by record).

**E. Agent unified transaction history (#59):** **YES — it remains the only concrete missing V1
engineering feature.** No challenge finding displaces it. It should remain the next implementation task,
subject only to its recorded output-type micro-decision. The four decisions in §11-C may add their own
contained follow-ups but are not prerequisites for #59.

---

*Prepared as an audit artifact only. Repeat: nothing herein implemented, modified, or deleted.*
