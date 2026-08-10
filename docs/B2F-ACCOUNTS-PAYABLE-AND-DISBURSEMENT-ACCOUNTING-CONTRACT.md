# B2F08 — Accounts Payable and Disbursement-Accounting Boundary Design

- **Task:** B2F08 — Accounts Payable and Disbursement-Accounting Boundary
- **Platform:** B2 Finance Platform
- **Status:** DESIGN COMPLETE — RUNTIME NOT AUTHORIZED; B2F07 AND PRODUCTION GATES REMAIN BLOCKED
- **Scope:** Design-only contract; no source, migration, controller, policy, account, mapping, payable, journal, disbursement, or posting is created
- **Authoritative plan:** [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)
- **Sequence reconciliation:** [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md)
- **Supporting foundation:** B2F09-PRE — Finance Accounting Treatment and Source Decision Adoption Foundation

## 1. Purpose and bounded scope

B2F08 designs the future Finance-owned accounts-payable accounting boundary around an approved, immutable obligation source. It distinguishes commercial or operational obligation evidence, Finance payable state, accounting/journal state, and external disbursement/settlement evidence.

B2F08 may eventually own:

- payable identity and immutable source correlation;
- approved obligation amount/currency/accounting-unit references;
- payable approval, hold, dispute, cancellation, and accounting status;
- due-date evidence copied from an approved source authority;
- Finance classifications and B2F03 mapping references;
- B2F04 accounting-period admission;
- B2F06 control decisions;
- B2F05 journal-governance references and resulting A5 correlation;
- read-only disbursement instruction/execution/settlement references;
- partial-settlement allocation evidence;
- additive adjustment, reversal-correlation, audit, and reconciliation evidence.

B2F08 does not create the underlying commercial obligation, vendor/merchant/partner identity, payment instruction, bank transfer, external settlement, A5 journal, balance, reversal, Treasury position, report, statement, IAM role, or public API.

## 2. Authority boundaries

| Authority                         | Owns                                                                                             | B2F08 relationship                                                  | Prohibited B2F08 behavior                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A2 Authorization                  | Authentication, authorization, privileged approval, principal/assurance evidence                 | Consume exact approval evidence                                     | Create identities, roles, sessions, or approvals                                    |
| A5 Ledger                         | Ledger accounts, journals/lines, posting, value, balances, reversals                             | Reference canonical UUIDs and consume posting results through B2F05 | Insert ledger records, derive an authoritative balance, or reverse value directly   |
| B1 Commercial                     | Pricing, plans, commission/revenue-share/cost decisions, billing/invoices, commercial terms      | Consume approved immutable commercial source evidence read-only     | Recalculate commission, cost, tax, pricing, or commercial due terms                 |
| A6 External Partners & Settlement | Partner adapter, external operations, payment execution, callbacks, settlement/suspense evidence | Consume instruction/execution/settlement evidence read-only         | Call partners, initiate payment, clear suspense, or claim settlement from a request |
| A7 Product Layer                  | Product commands/lifecycle/financial-effect evidence                                             | Consume only through a verified immutable by-reference boundary     | Recreate product decisions or accept caller snapshots as authority                  |
| B2F03                             | Finance classifications and Finance-to-A5 mapping metadata                                       | Resolve active/effective mappings and canonical A5 UUIDs            | Create A5 accounts or infer mappings from codes                                     |
| B2F04                             | Fiscal years, periods, period admission                                                          | Check exact accounting-date admission                               | Open/reopen periods or bypass locks                                                 |
| B2F05                             | Journal governance and controlled A5 posting interface                                           | Create only a Finance journal-governance request after controls     | Post directly or treat a draft as posted value                                      |
| B2F06                             | Finance controls, maker/checker, materiality, override evidence                                  | Consume deterministic ALLOW/DENY evidence                           | Define roles/IAM or bypass control denial                                           |
| B2F07                             | Receivable accounting                                                                            | Separate preceding task; no shared record or lifecycle authority    | Implement AR through payable records                                                |
| B2F09-PRE                         | Verified source adoption/treatment provenance                                                    | Reuse source verification/treatment foundation                      | Recreate source-adoption authority or claim B2F09 completion                        |
| B3 Treasury                       | Future liquidity/cash positioning and Treasury controls                                          | Future read-only handoff only                                       | Position cash, choose funding source, or schedule Treasury execution                |
| B5 Merchant                       | Future canonical merchant/agent lifecycle                                                        | Consume canonical identity when available                           | Verify/onboard/suspend merchants                                                    |

## 3. Accounts-payable source and evidence model

A future `FinancePayableSourceEvidenceV1` must contain, at minimum:

```text
sourceOwner
sourceCategory
sourceReference
sourceVersion
sourceHash
sourceState
sourceEffectiveAt
sourceOccurredAt
obligationPartyType
obligationPartyReference
obligationPartyVersion
commercialDecisionReference/version/hash (where B1-owned)
productReference/version/hash (where A7-owned)
partnerReference/version/hash (where A6-owned)
grossAmountMinor
currency
accountingUnit
dueAt/dueDateSourceReference/version/hash (only when an approved authority exists)
classification/retention/legal-hold metadata
correlation/causation
verifiedAt
```

Rules:

1. Source evidence is immutable and read through an owner-provided canonical interface.
2. Caller-supplied amount, party, state, due date, or hash cannot replace canonical source evidence.
3. A B1 commission/revenue-share/cost kind alone does not prove expense, payable, due date, or posting treatment.
4. A6 settlement proves only the execution/settlement fact represented by A6; it does not create the payable obligation.
5. An invoice or billing document is not automatically an AP source; B1 source meaning and direction must be explicitly approved.
6. A7 source adoption remains fail closed while no canonical immutable by-reference consumer is verified.
7. The first bounded AP source category is **NOT VERIFIED / REQUIRES ARCHITECTURE AND FINANCE APPROVAL**.

## 4. Payable identity and proposed lifecycle model

A payable reference must be deterministic from the source owner/category/reference/version and payable semantic version. Generated database UUIDs and execution timestamps do not define semantic identity.

To avoid conflating obligation, accounting, and cash movement, the design uses three orthogonal status dimensions.

### 4.1 Obligation status — proposed

```text
PENDING_APPROVAL
APPROVED
ON_HOLD
DISPUTED
CANCELLED
```

- `APPROVED` requires canonical source compatibility plus required A2/B2F06 evidence.
- Hold/dispute/cancellation is additive evidence and never deletes the original obligation.
- Cancellation cannot reverse an A5 posting; any accounting correction uses B2F05/A5-controlled additive evidence.

### 4.2 Accounting status — proposed

```text
UNACCOUNTED
JOURNAL_DRAFT_CREATED
POSTING_REQUESTED
POSTED
POSTING_UNKNOWN
REVERSED
```

- `JOURNAL_DRAFT_CREATED` is B2F05 governance evidence, not value.
- `POSTED` requires canonical A5 journal evidence returned through B2F05.
- `REVERSED` requires canonical A5 reversal/compensating evidence; B2F08 does not execute reversal.

### 4.3 Disbursement/settlement status — proposed

```text
NOT_INSTRUCTED
INSTRUCTION_REFERENCED
PARTIALLY_SETTLED
SETTLED
SETTLEMENT_UNKNOWN
REJECTED
```

- B2F08 records only canonical execution-owner references.
- `INSTRUCTION_REFERENCED` does not prove execution or cash movement.
- `SETTLED` requires authoritative A6/payment settlement evidence.
- Partial settlement preserves ordered allocation evidence and remaining payable amount as a Finance subledger calculation, never as an A5 balance.

The exact state vocabulary and transition matrix remain **PROPOSED / REQUIRES APPROVAL** before runtime.

## 5. Disbursement-accounting boundary

A future payable may become eligible for an external disbursement only after obligation approval, hold/dispute checks, Finance controls, and required accounting treatment. Eligibility does not execute payment.

The future handoff must contain only approved instruction inputs/references required by the execution owner. B2F08 stores:

- instruction request reference/hash, if an approved execution owner returns one;
- external operation/payment reference;
- execution state and occurred time from the owner;
- settlement reference/evidence hash;
- rejection/unknown reason;
- amount/currency/unit;
- allocation to the payable and remaining amount;
- correlation/causation/audit references.

B2F08 must not choose a bank rail, cash account, liquidity source, payment priority, batch schedule, Treasury funding, or settlement path. Those decisions belong to A6/payment owners and future B3 as applicable.

## 6. Journal creation and governance

B2F08 never creates an A5 journal directly. The bounded accounting path is:

```text
verified payable source
→ B2F09-PRE source adoption/treatment provenance
→ B2F04 period admission
→ B2F03 active/effective mappings
→ B2F06 control ALLOW
→ B2F05 createJournal() produces DRAFT governance
→ separate B2F05 approval/posting path
→ A5 authoritative journal
→ B2F08 records canonical correlation read-only
```

Any payable-recognition, adjustment, partial-settlement, write-off, or reversal-related accounting request must use a separately approved classification/treatment and balanced B2F05 request. B2F08 cannot infer debit/credit direction solely from source kind.

## 7. Period admission

Every accounting event requires:

- `finance.book.ng.primary` v1;
- provisional legal-entity reference `finance.legal-entity.ng.primary` under its existing activation restrictions;
- accrual basis;
- exact accounting date;
- B2F04 fiscal year and period reference/version;
- period state compatible with the journal classification;
- admission decision/reference/reasons/checked time.

Missing, closed, stale, wrong-date, or incompatible period evidence fails closed. Settlement occurred time does not silently replace the approved accounting date.

## 8. Account classifications and mappings

Potential classifications already documented but unmapped include:

```text
finance.liability.accounts-payable
finance.liability.commission-payable
finance.liability.revenue-share-payable
finance.liability.tax-payable
finance.expense.commission
finance.expense.revenue-share
```

No classification is approved for automatic use merely because it exists in the chart contract.

Runtime prerequisites for each posting line are:

1. separately approved canonical A5 account exists;
2. B2F03 mapping is `ACTIVE` and effective;
3. exact book/classification/A5 UUID match;
4. current A5 type/normal-balance/currency/unit/status remain compatible;
5. observed A5 snapshot has not drifted;
6. B2F05 re-verifies the mapping before governance creation.

No canonical A5 accounts-payable control-account UUID or active AP mapping was verified. Provisioning/mapping work requires separate existing-authority approval and cannot be implemented by B2F08 design.

## 9. Approval, maker/checker, and controls

The future runtime must reuse A2 and B2F06. At minimum, separate control actions are expected for payable approval, payable accounting admission/journal creation, hold/dispute release, adjustment/write-off, and any execution handoff. Exact B2F06 action vocabulary is **NOT VERIFIED / REQUIRES APPROVAL**; this document does not allocate action names.

Requirements:

- maker identity/roles from A2 evidence;
- checker/executor identity/roles from A2 evidence;
- maker/checker separation where configured;
- self-approval prohibited;
- minimum distinct approval count from active B2F06 policy;
- materiality band and override evidence where applicable;
- exact payable resource/version/hash and action fingerprint;
- approval expiry/status/resource/fingerprint verification;
- deterministic B2F06 decision and reasons;
- denial prevents journal or disbursement handoff.

B9 later administers assignments; B2F08 creates no role/IAM authority.

## 10. Idempotency, replay, and concurrency

Future runtime must use shared Operations idempotency only. Proposed semantic operation boundaries are:

- payable creation/adoption;
- payable lifecycle/hold/dispute/cancellation;
- accounting-event/journal-governance request;
- disbursement-evidence correlation;
- settlement allocation;
- additive adjustment/supersession.

Exact scope names are **NOT ASSIGNED** and require runtime authorization review to prevent collision.

Rules:

- semantic hashes exclude generated UUIDs, audit IDs, persistence timestamps, and replay flags;
- same scope/key/hash replays the original durable result;
- same key with changed semantics conflicts;
- serializable transaction, uniqueness, pessimistic lock, and expected record version protect concurrent transitions;
- unknown payment/settlement outcome is recovered through canonical owner lookup, never blind retry;
- unknown A5 posting remains B2F05 `POSTING_UNKNOWN` and cannot become `POSTED` locally;
- duplicate source/payable/settlement allocation fails closed.

## 11. Audit and provenance

Shared `AuditService` remains the only audit authority. Future evidence must cover:

- source verification/adoption;
- payable creation and every state transition;
- approval/control request and result;
- hold/dispute/cancellation reason and actor;
- mapping/period/treatment/journal references;
- disbursement instruction/execution/settlement correlation;
- partial allocation and remaining amount;
- adjustment/supersession/reversal correlation;
- replay/conflict/rejection/unknown outcomes;
- maker/checker/approver/executor identities;
- request/correlation/causation and support trace.

Retention duration, legal hold, classification, redaction, and access rules are **NOT VERIFIED / REQUIRES FINANCE/LEGAL/TAX/PRIVACY/COMPLIANCE/AUDIT REVIEW**. Ordinary retirement must never delete evidence needed to explain A5 history.

## 12. Currency and accounting unit

B2F08 v1 design is restricted to:

```text
currency: NGN
accountingUnit: CUSTOMER_FUNDS
book: finance.book.ng.primary / 1
basis: ACCRUAL
```

Mixed-currency, FX conversion, foreign-currency payable remeasurement, another accounting unit, intercompany payable, and consolidation are prohibited. E1 owns future FX. Currency/unit mismatch fails before payable admission or journal governance.

## 13. Error and rejection behavior

Fail closed for:

- missing/unverifiable/stale/changed source evidence;
- unapproved source category or party authority;
- amount/currency/unit mismatch;
- missing or arbitrary due date;
- duplicate source/payable/version;
- invalid lifecycle transition;
- hold/dispute/cancellation conflict;
- stale expected version or concurrent update;
- missing/denied/expired/mismatched A2 or B2F06 evidence;
- missing/inactive/ineffective/drifted B2F03 mapping;
- missing/closed/incompatible B2F04 period;
- unbalanced or incompatible B2F05 request;
- payment instruction without execution-owner evidence;
- settlement amount/reference/hash mismatch;
- over-allocation or duplicate allocation;
- unknown posting or settlement result;
- unavailable canonical read boundary.

A rejection must not call A5 or an execution owner. Unknown is an explicit state, not success. No automatic repair, suspense clearing, compensating journal, payment retry, or source mutation is permitted.

## 14. Transactional consistency

B2F08 persistence, idempotency, audit, and local outbox facts for one transition must commit atomically where they share the database boundary. External/A5 operations cannot be made atomic with local persistence and therefore require durable requested/unknown/result states and deterministic recovery.

Required safeguards:

- one semantic payable per exact source/version;
- append-only evidence and no destructive correction;
- expected record version plus lock for state transitions;
- settlement allocation cannot exceed approved obligation/remaining amount;
- local rollback never claims remote rollback;
- A5/payment timeouts remain unknown until canonical lookup/replay resolves them;
- no success outbox event before canonical success evidence;
- reconciliation independently detects orphan/missing/mismatched records.

## 15. Required evidence for future runtime

Before runtime authorization, provide:

1. approved first payable source owner/category and immutable consumer port;
2. canonical obligation-party identity authority and lookup;
3. approved AP due-date authority/calculation evidence;
4. exact payable lifecycle/state transition decision;
5. approved accounting treatments/classifications for creation, settlement, adjustment, cancellation, and reversal correlation;
6. canonical A5 AP/expense accounts and verified UUIDs;
7. active/effective B2F03 mappings;
8. B2F04 active period/admission evidence;
9. B2F06 actions, role/control policy, materiality, approvals, and fingerprints;
10. B2F05 line templates/constraints and posting-correlation behavior;
11. execution-owner disbursement instruction and read-only status/evidence contract;
12. settlement/partial-allocation source and ordering rules;
13. idempotency scope allocation and hash schemas;
14. audit, retention, legal-hold, privacy, reconciliation, and support requirements;
15. migration/rollback/data-classification review;
16. focused concurrency/failure/unknown/replay test plan;
17. explicit B2F08 runtime GO after B2F07 sequencing requirements are satisfied.

## 16. Relationship to B2F07 and B2F09

### B2F07

The authoritative plan allows B2F08 **design** in parallel after B2F06. B2F08 runtime must not bypass B2F07. Shared concepts may use consistent evidence patterns, but payable records, states, classifications, mappings, approvals, and reconciliation remain distinct from receivables.

B2F07 production blockers do not prevent this design document. They do prevent claiming B2F08 runtime eligibility under the current sequence.

### B2F09 and B2F09-PRE

B2F09-PRE is reused for verified source adoption and Finance treatment provenance. It does not create payable records, calculate payable obligations/due dates, execute payment, select AP accounts, or complete B2F09.

B2F09 design may proceed in parallel under its own existing task. B2F08 must not decide revenue-recognition schedules, tax calculations, cost-allocation methods, or broad commercial accounting semantics owned by B2F09/B1.

## 17. Design work allowed now versus blocked work

### Allowed now

- authority/source inventory;
- source/evidence and consumer-port design;
- payable/disbursement/accounting state separation;
- proposed lifecycle and failure taxonomy;
- mapping/period/control/journal boundary design;
- idempotency, audit, concurrency, reconciliation, and support requirements;
- unresolved decision register;
- future runtime test plan.

### Blocked

- entity, migration, repository, service, controller, API, event, idempotency record, payable record, account, mapping, policy, journal, payment instruction, settlement, report, statement, or frontend creation;
- automatic adoption of B1 commission/revenue-share/cost as AP;
- merchant/vendor identity invention before canonical authority;
- AP due-date invention;
- A5 AP account provisioning;
- B2F03 AP mapping activation;
- B2F06 action/policy activation;
- B2F08 runtime before the authoritative sequencing gate;
- B2F09 runtime or B3 Treasury behavior.

## 18. Runtime entry gate and unresolved decisions

B2F08 runtime remains **BLOCKED** until Architecture/Finance explicitly approve:

1. first bounded payable source category and owner;
2. canonical obligation-party identity authority for that source;
3. AP due-date authority and correction behavior;
4. exact lifecycle vocabularies and transition/terminal rules;
5. partial-payment allocation order and rounding behavior;
6. dispute/hold/cancellation/write-off semantics;
7. disbursement execution owner and evidence port;
8. payable accounting treatments and exact classifications;
9. canonical A5 AP/expense accounts and B2F03 mappings;
10. B2F06 action vocabulary/control requirements;
11. idempotency scopes/hash contracts;
12. retention/legal-hold/support requirements;
13. whether B5 merchant identity must exist before the selected source can activate;
14. runtime task/ADR/migration allocation and explicit GO;
15. completion of the preceding B2F07 runtime gate under the authoritative sequence.

These are genuine design decisions, not permission to invent defaults. Until approved, B2F08 remains design-complete and runtime-not-authorized.

## 19. Design acceptance record

- [x] Existing B2F08 task definition preserved.
- [x] A5/B1/A2/A6/A7/B2F03–B2F06/B2F09-PRE authority boundaries preserved.
- [x] Payable obligation, accounting, and settlement states kept distinct.
- [x] No payable is treated as cash movement or A5 balance.
- [x] No vendor/merchant, due date, AP account, mapping, action, or idempotency scope invented as production authority.
- [x] Runtime sequence remains blocked behind B2F07 and explicit approval.
- [x] No source, test, migration, controller, API, runtime state, or later-platform behavior introduced.

## References

- [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md)
- [`B2F-FINANCE-INVENTORY.md`](B2F-FINANCE-INVENTORY.md)
- [`B2F-ACCOUNTING-MODEL-CONTRACT.md`](B2F-ACCOUNTING-MODEL-CONTRACT.md)
- [`B2F-CHART-CLASSIFICATION-CONTRACT.md`](B2F-CHART-CLASSIFICATION-CONTRACT.md)
- [`B2F-FISCAL-PERIOD-CONTRACT.md`](B2F-FISCAL-PERIOD-CONTRACT.md)
- [`B2F-JOURNAL-GOVERNANCE-CONTRACT.md`](B2F-JOURNAL-GOVERNANCE-CONTRACT.md)
- [`B2F-FINANCE-CONTROL-CONTRACT.md`](B2F-FINANCE-CONTROL-CONTRACT.md)
- [`B2F-ACCOUNTING-TREATMENT-CONTRACT.md`](B2F-ACCOUNTING-TREATMENT-CONTRACT.md)
- [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md)
- [`B2F07-PREREQUISITE-WORK-PACKAGES.md`](B2F07-PREREQUISITE-WORK-PACKAGES.md)
- [`ADR/ADR-0083-B2-Finance-Accounting-Model-Books-Basis-and-Fiscal-Calendar.md`](ADR/ADR-0083-B2-Finance-Accounting-Model-Books-Basis-and-Fiscal-Calendar.md)
- [`ADR/ADR-0084-B2-Finance-Chart-Classification-and-A5-Account-Mapping.md`](ADR/ADR-0084-B2-Finance-Chart-Classification-and-A5-Account-Mapping.md)
- [`ADR/ADR-0085-B2-Finance-Fiscal-Year-and-Accounting-Period-Runtime.md`](ADR/ADR-0085-B2-Finance-Fiscal-Year-and-Accounting-Period-Runtime.md)
- [`ADR/ADR-0086-B2-Finance-Journal-Governance-and-Controlled-A5-Posting.md`](ADR/ADR-0086-B2-Finance-Journal-Governance-and-Controlled-A5-Posting.md)
- [`ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md`](ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md)
- [`ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md`](ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md)
