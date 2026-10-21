# B2F07 — Accounts Receivable and Invoice-Accounting Boundary Design

- **Task:** B2F07 — Accounts Receivable and Invoice-Accounting Boundary
- **Platform:** B2 Finance Platform
- **Status:** DESIGN COMPLETE — RUNTIME BLOCKED; EXPLICIT ARCHITECTURE GO REQUIRED
- **Scope:** Design only; no source, migration, controller, policy, account, mapping, term, invoice, receivable, journal, posting, settlement, or production state is created
- **Authoritative plan:** [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)
- **Sequence reconciliation:** [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md)
- **Prerequisite package:** [`B2F07-PREREQUISITE-WORK-PACKAGES.md`](B2F07-PREREQUISITE-WORK-PACKAGES.md)
- **Supporting foundation:** B2F09-PRE — Finance Accounting Treatment and Source Decision Adoption Foundation

## 1. Scope and responsibilities

B2F07 designs the Finance-owned accounts-receivable boundary around an authoritative B1 invoice and its immutable payment-term/due-date evidence. It separates customer commercial obligation, Finance receivable status, accounting/journal status, and settlement evidence.

B2F07 may eventually own:

- deterministic receivable identity correlated to one canonical invoice version;
- immutable invoice, customer/obligor, amount, term, issued-at, and due-date provenance;
- Finance receivable lifecycle, outstanding amount, allocation, aging, dispute, hold, impairment-input, credit, adjustment, write-off, and close status;
- B2F03 classifications/mappings and canonical A5 UUID references;
- B2F04 period admission;
- B2F06 controls and A2 approval references;
- B2F05 journal-governance and A5 posting/reversal correlations;
- read-only settlement/payment evidence correlation;
- additive correction/supersession, audit, reconciliation, support, and output evidence.

## 2. Explicit non-goals

B2F07 does not:

- create, edit, issue, cancel, void, price, tax, or calculate a B1 invoice;
- define or calculate payment terms or due dates;
- create the A5 AR account or another ledger/account authority;
- create or activate B2F03 mappings;
- open/reopen B2F04 periods;
- post or reverse A5 journals directly;
- execute payment, collections, bank transfer, settlement, refund, payout, or Treasury operation;
- calculate B1 revenue recognition, tax, cost, commercial effects, or profitability;
- implement AP, B6 reporting, B7 statements, IAM, public APIs, frontend, or B3 Treasury;
- treat invoice, receivable, payment instruction, or settlement request as proof that value moved.

## 3. Authority ownership

| Authority        | Owns                                                                                                                                    | B2F07 relationship                                        | Prohibited B2F07 behavior                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| B1               | Invoice identity/content/amount/state, commercial payment terms, stable issuance, due-date calculation/amendment, commercial provenance | Consume immutable canonical evidence read-only            | Recalculate or mutate invoice/term/due date     |
| A5               | Ledger accounts, journals/lines, posting, value, balances, reversals                                                                    | Correlate through B2F05 and canonical A5 evidence         | Create accounts, post directly, or own balances |
| A2               | Authentication, authorization, privileged approval, principal/assurance evidence                                                        | Consume exact approval evidence                           | Create IAM or duplicate approval                |
| B2F03            | Finance classification and Finance-to-A5 mapping metadata                                                                               | Resolve active/effective AR and related mappings          | Infer mapping or create A5 account              |
| B2F04            | Fiscal periods and accounting-date admission                                                                                            | Check exact accounting date/period                        | Open/reopen or bypass periods                   |
| B2F05            | Journal governance and controlled A5 posting                                                                                            | Receive balanced DRAFT accounting requests after controls | Be replaced by an AR posting engine             |
| B2F06            | Finance controls, materiality, maker/checker, exceptions/overrides                                                                      | Return deterministic ALLOW/DENY                           | Be bypassed or replaced with AR roles           |
| B2F09-PRE        | Canonical source verification/adoption/treatment provenance                                                                             | Mandatory source-adoption foundation                      | Be duplicated or counted as B2F07 completion    |
| A6/payment owner | External operations, payment execution, callback, settlement/suspense truth                                                             | Supply settlement evidence read-only                      | Be called to execute payment by B2F07           |
| B2F08            | Payables/disbursement accounting                                                                                                        | Separate later subledger                                  | Be implemented through receivable records       |
| B2F09            | Revenue/tax/cost/commercial-effect accounting                                                                                           | Consume compatible AR correlation where approved          | Be implemented inside AR                        |
| B2F10            | Independent Finance reconciliation/break management                                                                                     | Future consumer of AR evidence                            | Have discrepancies auto-repaired by B2F07       |

## 4. Canonical AR obligation/source evidence

A future `FinanceReceivableSourceEvidenceV1` must include:

```text
sourceOwner = B1
sourceCategory = INVOICE
invoiceReference
invoiceVersion
invoiceHash
invoiceState
invoiceAmountMinor
currency
accountingUnit
customerId/obligorReference
merchant/partner/product/commercial provenance where present
issuedAt
paymentTermReference/version/hash
termBasis/value
dueAt
dueDateCalculationHash
term effective window/currentness
bindingReference/hash
amendment chain/effective evidence reference/hash
B1 idempotency/audit/correlation/causation references
verifiedAt
```

The source is accepted only through the canonical B1 by-reference consumer. Caller snapshots cannot establish invoice, amount, customer, term, date, or hash authority.

## 5. Invoice identity and immutability

One receivable semantic version references exactly one canonical B1 invoice reference/version/hash. B2F07 does not alter frozen `B1InvoiceV1`, historical invoice hash semantics, or additive B1T12 binding/amendment records.

Rules:

- invoice version/hash drift fails closed;
- replay reads original durable B1 evidence;
- existing invoices without B1T12 evidence cannot receive an inferred due date;
- a corrected/voided/reissued invoice requires explicit B1 evidence and a separately approved receivable supersession rule;
- duplicate receivables for the same invoice semantic version are prohibited.

## 6. Customer and obligor identity correlation

The canonical invoice customer identity is the initial bounded obligor reference. B2F07 may reference A1/A3 customer/account-binding evidence where accounting correlation requires it, but does not redefine customer ownership.

Merchant, partner, guarantor, sponsor, corporate debtor, joint obligor, assignment/factoring, and third-party payer semantics are outside the first bounded scope unless separately approved. Payment by another party does not silently change the invoice obligor.

## 7. Invoice amount, currency, and economic evidence

The receivable gross amount is copied from canonical B1 invoice evidence. Finance may derive allocated, settled, outstanding, credited, written-off, and adjusted amounts as subledger calculations over immutable events.

Invariants:

```text
outstanding = approved gross
              + additive debit adjustments
              - effective credits
              - valid settlement allocations
              - approved write-offs
```

No component may be negative unless its event type explicitly defines direction. Allocations/credits/write-offs cannot exceed the then-valid outstanding amount without an approved overpayment rule. B2F07 amounts are not A5 balances.

## 8. Payment-term and due-date evidence

B1T12 is the sole authority. B2F07 copies and verifies:

- term reference/version/hash/basis/value;
- stable invoice `issuedAt`;
- original `dueAt` and calculation hash;
- effective B1 amendment chain/reference/hash;
- effective dating and compatibility;
- currency/unit/commercial provenance.

B2F07 never accepts a caller due date or recalculates elapsed days. A B1 due-date amendment changes the commercial obligation prospectively according to B1 evidence; B2F07 preserves original and effective due-date provenance and reruns aging deterministically.

## 9. Proposed AR lifecycle dimensions

To avoid conflation, B2F07 uses proposed orthogonal dimensions.

### 9.1 Obligation status

```text
PENDING_ADMISSION
OPEN
ON_HOLD
DISPUTED
CANCELLED
CLOSED
```

### 9.2 Accounting status

```text
UNACCOUNTED
JOURNAL_DRAFT_CREATED
POSTING_REQUESTED
POSTED
POSTING_UNKNOWN
ADJUSTMENT_REQUIRED
REVERSED
```

### 9.3 Settlement status

```text
UNPAID
PARTIALLY_PAID
PAID
OVERPAID
SETTLEMENT_UNKNOWN
```

### 9.4 Aging status

```text
NOT_DUE
DUE_TODAY
OVERDUE
```

Exact transitions, terminal behavior, reopening, and derived-state rules remain **PROPOSED / REQUIRES ARCHITECTURE AND FINANCE APPROVAL** before runtime.

## 10. Issuance and receivable admission

Invoice issuance remains B1-owned. B2F07 admission requires canonical invoice/binding evidence, approved source eligibility, exact currency/unit, B2F04 accounting-date admission, mappings, controls, and no duplicate receivable.

Invoice issuance does not automatically mean A5 posting. Admission may create a Finance receivable record and treatment/journal-governance request only after all gates pass.

## 11. Amendment and supersession

B1 due-date amendments remain B1-owned. B2F07 records the original binding and ordered amendment evidence, recomputes only derived aging/status from the effective B1 due date, and never overwrites source history.

Invoice amount/content correction requires canonical B1 correction, credit, cancellation, void/reissue, or supersession evidence. The exact B1 correction mechanism beyond B1T12 due-date amendment is **NOT VERIFIED / REQUIRES PRODUCT/B1 APPROVAL**.

## 12. Cancellation, void, and closure

A B1 invoice cancellation/void does not erase a receivable or posted A5 history. B2F07 must distinguish:

- commercial cancellation before accounting;
- cancellation after journal draft;
- cancellation after posting;
- cancellation after partial/full settlement.

Each case requires approved additive Finance treatment, B2F05 governance, A5 reversal/compensating correlation where value posted, allocation disposition, and audit. Exact state transitions are unresolved.

## 13. Dispute and hold

A dispute/hold is Finance/customer-service evidence, not a source rewrite or payment reversal. It must carry reason, owner, effective time, expected version, approval/control references, and resolution/supersession.

The design does not assume dispute automatically suspends aging, impairment, collection, recognition, tax, or posting. Each consequence requires explicit policy ownership and approval.

## 14. Settlement evidence

A settlement allocation requires canonical payment/settlement evidence from the execution owner, including reference/version/hash, status, amount, currency/unit, occurred time, payer reference where approved, and correlation.

Payment initiation, authorization, callback, pending instruction, or unverified bank reference does not prove settlement. B2F07 never calls the partner or posts cash directly.

## 15. Partial-payment allocation

Partial settlement creates an immutable allocation event linked to one settlement evidence item and receivable. It records allocated amount, sequence, effective time, remaining amount, semantic hash, audit, and correlation.

Allocation must not exceed authoritative available settlement amount or receivable outstanding amount. Multi-invoice allocation, allocation ordering, fees/short-pay, rounding, reversal, and reallocation semantics are **NOT VERIFIED / REQUIRE FINANCE/PRODUCT APPROVAL**.

## 16. Overpayment and underpayment

Underpayment leaves a positive outstanding amount unless an approved credit/write-off closes it.

Overpayment cannot silently create negative AR, customer wallet value, revenue, refund, or payable. It must enter an explicit exception state and correlate to an approved owner/treatment, potentially B2F08 or another source authority. Refund/payment execution is outside B2F07.

Threshold/tolerance, auto-close, residual rounding, unapplied cash, refund, and reclassification rules are unresolved.

## 17. Aging and overdue semantics

Aging is a derived Finance view based on authoritative effective B1 `dueAt`, an explicit evaluation instant, and approved UTC bucket policy. B2F07 does not change the due date.

Minimum derived semantics:

- before `dueAt`: `NOT_DUE`;
- at the approved due-time boundary: `DUE_TODAY` or `OVERDUE` according to a frozen cutoff rule;
- after boundary with outstanding amount: `OVERDUE`;
- zero outstanding: aging no longer drives collection status.

Exact day-count convention, bucket boundaries, cutoff, timezone presentation, dispute/hold treatment, and amendment restatement are **NOT VERIFIED / REQUIRE FINANCE APPROVAL**. B6/B7 may present aging but do not calculate the commercial due date.

## 18. Credit and adjustment boundary

Credits and debit adjustments require canonical source/approval evidence and additive events. B2F07 may own Finance application of an approved credit to AR but cannot invent commercial credit value or tax/revenue consequences.

A credit must preserve source, amount, currency/unit, reason, effective date, approvals, expected version, allocation order, treatment, mappings, journal/A5 correlation, and supersession.

## 19. Write-off and impairment boundary

Write-off and impairment are Finance decisions, distinct from B1 invoice cancellation and from settlement. They require approved policy, materiality, maker/checker evidence, period, mappings, journal governance, reason, recovery behavior, tax/revenue correlation, and audit.

B2F07 may hold impairment inputs/status; B2F09 owns related revenue/tax/cost accounting treatment where approved. Exact impairment method, allowance model, write-off threshold, recovery, reinstatement, and tax treatment are unresolved.

## 20. AR-to-A5 accounting treatment

The required path is:

```text
verified B1 invoice/binding
→ B2F09-PRE source adoption/treatment provenance
→ B2F07 receivable admission/accounting event
→ B2F04 period admission
→ B2F03 active/effective mappings
→ B2F06 control ALLOW
→ B2F05 DRAFT journal governance
→ separate approval/posting
→ A5 authoritative journal
→ B2F07 records correlation read-only
```

B2F07 cannot infer debit/credit accounts solely from invoice state or amount and cannot call `LedgerService` directly.

## 21. B2F03 mapping requirements

At minimum, receivable accounting requires an approved mapping for:

```text
finance.asset.receivable
```

Additional revenue, tax, settlement, credit, impairment, write-off, refund/unapplied-cash, and adjustment lines require separately approved classifications/accounts/mappings.

Every mapping must be active/effective, exact-book/classification/A5-UUID compatible, current against A5, and reverified by B2F05. No production UUID or mapping is invented in this design.

## 22. B2F04 period admission

Every accounting event requires deterministic accounting date, fiscal period reference/version, journal classification, and B2F04 admission evidence.

Missing/closed/stale/wrong-date period fails closed. B1 issued/due/settlement times do not silently select accounting date. Late arrival, back-posting, cancellation, credit, write-off, settlement, amendment, and prior-period correction dates require approved policies.

## 23. B2F05 journal-governance handoff

B2F07 produces balanced Finance accounting intent only. B2F05 owns DRAFT creation, lifecycle, controls, A5 request, unknown handling, and posting correlation.

Every request carries source/receivable/event identities, period/date, ordered lines, mapping/classification/A5 UUID, amount/currency/unit, approvals, controls, idempotency, and correlation. DRAFT or APPROVED does not mean posted.

## 24. B2F06 controls

Future runtime must consume B2F06 for receivable admission/accounting, credit, adjustment, hold/dispute release where controlled, write-off, impairment, settlement allocation correction, cancellation, and other material actions.

Exact action vocabulary, maker/checker roles, approval counts, materiality, override evidence, and policy versions are **NOT VERIFIED / REQUIRE FINANCE CONTROL APPROVAL**. Existing `FINANCE_ACCOUNTING_TREATMENT_ADOPT` may support treatment adoption but does not automatically authorize every AR lifecycle action.

## 25. A2 privileged approval boundary

A2 remains sole authentication/authorization/approval authority. B2F07 consumes current principal, roles/scopes, MFA/assurance, approval status/expiry, action/resource/fingerprint, requester/approver identities, and session evidence.

B2F07 creates no identities, assignments, sessions, roles, or approval vault. Maker/checker separation and self-approval prohibition follow configured A2/B2F06 policy.

## 26. Idempotency and deterministic fingerprints

Future semantic operation boundaries include:

- receivable creation/admission;
- lifecycle/hold/dispute/cancellation;
- accounting event/journal request;
- settlement allocation/reversal/reallocation;
- credit/adjustment/write-off/impairment;
- source/amendment supersession;
- aging/reconciliation snapshot where persisted.

Exact scopes are **NOT ASSIGNED**. Hashes/fingerprints must include exact source/invoice/binding/effective evidence, receivable/event version, amount/currency/unit, period/date, mappings, policy, expected version, action, resource, approvals, and correlation where semantic. Generated UUIDs/timestamps/audit IDs/replay flags are excluded.

## 27. Replay protection

Same scope/key/hash replays the original durable result. Same key with changed semantics conflicts. Completed source/admission/allocation/journal evidence is loaded, not regenerated from current time.

Unknown remote/A5/payment outcomes recover through canonical reads or same-key owner replay. B2F07 never blindly creates another receivable, allocation, credit, or journal request.

## 28. Concurrency and duplicate-invoice handling

Use serializable transactions, uniqueness, pessimistic locks, expected record versions, and optimistic version columns as appropriate.

Required constraints:

- one receivable semantic version per canonical invoice version/hash;
- no duplicate active source admission;
- allocation cannot overconsume settlement or outstanding amount;
- concurrent credit/write-off/allocation transitions serialize;
- stale expected version fails;
- source hash/version drift fails;
- uncertain commit is recovered by canonical lookup before retry.

## 29. Correction, supersession, and reversal

Corrections are additive. Original B1, B2F07, B2F05, and A5 evidence remains immutable.

A correction chain preserves prior/new source, reason, actor, approval, effective date, expected version, hashes, period, mappings, journal/A5 correlation, settlement allocation impact, reconciliation, and close evidence.

B2F07 cannot directly reverse A5. Posted correction uses B2F05/A5 reversal or compensating-entry authority. Unknown reversal remains unknown until canonical evidence resolves it.

## 30. Audit and provenance

Shared `AuditService` remains the audit authority. Evidence must cover:

- source verification/admission;
- lifecycle transitions;
- original/effective due-date evidence;
- period/mapping/treatment/control/journal/A5 references;
- settlement allocations and remaining amount;
- dispute/hold/cancellation;
- credits/adjustments/write-offs/impairment;
- correction/supersession/reversal;
- replay/conflict/rejection/unknown;
- maker/checker/approver/executor;
- request/correlation/causation/support references.

No raw credentials, tokens, unnecessary customer data, or unredacted sensitive notes are stored.

## 31. B2F10 reconciliation evidence

Future B2F10 must reconcile:

- B1 invoice/binding/amendment to receivable;
- invoice amount to AR gross/adjustments;
- effective due date to aging;
- AR accounting events to B2F05/A5;
- settlement evidence to allocations/outstanding;
- duplicate/missing/orphan/stale/mismatched source, mapping, period, account, amount, policy, state, and journal;
- credits/write-offs/reversals;
- close/output inclusion.

B2F07 exposes read-only evidence and never repairs B1/A5/A6 to make reconciliation pass.

## 32. B2F11 close evidence

B2F07 must expose period-end AR control totals, posted/unposted/unknown events, mapping/period/control exceptions, aging, disputes/holds, write-offs/impairment inputs, unsettled allocations, and material breaks.

Close cannot proceed with unapproved material AR breaks. B2F11 owns checklist, exception, sign-off, hard-close, and reopen behavior.

## 33. B2F12 output evidence

B2F07 supplies read-only period-aware AR datasets/control schedules with source/A5/mapping/policy/period lineage and disclosed exceptions. B2F12 owns official accounting output datasets. B6/B7 later present/deliver; B2F07 does not render statements or reports.

## 34. Relationship to B2F08

AR and AP remain separate subledgers, source models, states, mappings, approvals, allocations, accounting events, and reconciliation controls. Overpayment/refund/reclassification may reference future AP evidence only through an approved handoff; B2F07 never creates AP.

B2F08 design may reuse evidence patterns but runtime cannot bypass B2F07 sequencing.

## 35. Relationship to B2F09

B2F09 owns Finance revenue-recognition, tax, cost, and commercial-effect accounting. B2F07 may link its receivable/accounting events to B2F09 treatments but cannot recalculate those semantics.

Invoice issuance does not imply revenue recognition; payment does not automatically determine revenue/tax/cost treatment. B2F09-PRE remains shared source-adoption foundation.

## 36. Currency, accounting unit, and book

Initial scope is restricted to:

```text
book: finance.book.ng.primary / 1
basis: ACCRUAL
currency: NGN
accountingUnit: CUSTOMER_FUNDS
```

FX, foreign currency, remeasurement, multi-book, multi-entity, consolidation, factoring, securitization, interest, and intercompany AR are prohibited. E1 owns future FX.

## 37. Failure and fail-closed behavior

Reject for missing/unverifiable/stale/hash-mismatched B1 evidence; missing term/binding/due date; wrong invoice/customer/amount/currency/unit; duplicate invoice/receivable; invalid transition; stale version; over-allocation; unsupported payment/credit/write-off; missing mapping/account/period/control/approval; unbalanced journal; unknown settlement/posting; conflicting amendment/correction; unavailable canonical read.

Rejection must not call A5 or payment execution. Unknown is not success. No automatic account/mapping creation, due-date inference, posting, reversal, collection, refund, source mutation, suspense clearing, or discrepancy suppression.

## 38. Operational support and incident boundary

Future runtime requires support-safe lookup by invoice/receivable/customer/correlation/journal/settlement reference; explicit incident taxonomy for duplicate, mismatch, timeout, unknown, over-allocation, mapping drift, period lock, control denial, reconciliation break, and close blocker; owner/escalation/disable/recovery rules; and no source repair from support tooling.

B2F14 later owns broad Finance recovery/data/support controls. B2F07 must provide evidence, diagnostics, and bounded disable behavior without implementing C2 or frontend.

## 39. Retention, legal hold, and privacy

AR/invoice/settlement/approval/accounting evidence is Finance-confidential and customer-linked. Exact retention, legal hold, minimization, redaction, access, encryption/tokenization, disclosure, support projection, and disposal requirements are **NOT VERIFIED / REQUIRE FINANCE/LEGAL/TAX/PRIVACY/COMPLIANCE/AUDIT APPROVAL**.

Retirement/closure never deletes evidence required to explain A5 or official outputs. Legal hold overrides disposal. B2F07 does not copy unnecessary B1/customer payloads.

## 40. Runtime entry criteria

Before runtime authorization:

1. canonical A5 AR account exists and is verified;
2. B2F03 `finance.asset.receivable` mapping is active/effective;
3. approved production B1 term/binding/due-date evidence is readable;
4. first bounded invoice/source eligibility and lifecycle semantics are approved;
5. settlement/allocation/credit/write-off/aging/correction policies are approved;
6. required additional A5 accounts/mappings are available;
7. B2F04 period/accounting-date policies are approved;
8. B2F06 actions/policies and A2 approvals are production-capable;
9. B2F05 journal templates/governance are approved;
10. idempotency scopes/hash/fingerprint contracts are allocated;
11. audit/retention/privacy/reconciliation/close/output/support requirements are approved;
12. runtime ADR/migration/rollback/test plan is allocated;
13. renewed entry review passes;
14. Architecture records explicit `B2F07 = GO`.

## 41. Explicit production prerequisite gate

Production values are not design blockers, but runtime remains blocked until:

```text
A2T11 production workforce trust active
→ bounded B2F06 production policy active/effective
→ A5T11 provisions/verifies canonical AR account UUID
→ B2F03 finance.asset.receivable mapping active/effective
→ B1 production payment term active
→ canonical invoice-term/due-date evidence verified
→ B2F07 entry review
→ explicit GO
```

No production UUID, identity, approval, policy, mapping, term, invoice, or account is created by this design.

## 42. Architecture GO requirement

Design completion is not runtime authorization. The only valid runtime entry is an explicit Architecture record:

```text
B2F07 = GO
```

The GO record must cite exact production/source/account/mapping/term/period/control/journal/idempotency/audit evidence and unresolved risks. Missing evidence means NO-GO.

## 43. Runtime ADR, migration, and allocation requirements

B2F07 retains its existing task number. Runtime work requires:

- an allocated ADR after the current ADR tail;
- additive receivable/event/allocation persistence design;
- migration ordering and rollback/forward recovery;
- no historical invoice/account/mapping backfill without separate approval;
- exact entities/services/internal consumer ports and no public controller unless later authorized;
- idempotency/audit/outbox/metrics reuse;
- focused lifecycle/concurrency/replay/unknown/correction/reconciliation tests;
- full repository validation and prohibited-dependency scans.

This design allocates no ADR, migration, scope, table, action, account, or mapping.

## 44. Unresolved decision register

| Decision                                   | Classification                    | Existing evidence                              | Why it matters                              |
| ------------------------------------------ | --------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| First bounded invoice/source eligibility   | Product/business                  | B1 invoice/B1T12 evidence exists               | Bounds receivable creation                  |
| Exact lifecycle/transition matrix          | Architecture + Finance            | Proposed orthogonal states                     | Persistence, concurrency, terminal behavior |
| Accounting date by event                   | Finance                           | Source times and B2F04 exist                   | Period/cutoff/close                         |
| Aging cutoff/buckets/timezone presentation | Finance                           | B1 dueAt is UTC instant                        | Overdue state and outputs                   |
| Settlement evidence owner/port             | Architecture + production         | A6/payment evidence exists in bounded flows    | Valid payment allocation                    |
| Partial/multi-invoice allocation ordering  | Finance/Product                   | No approved AR allocation rule                 | Outstanding and duplicate control           |
| Overpayment/unapplied-cash/refund owner    | Architecture + Finance            | No approved owner                              | Prevents negative AR/value invention        |
| Hold/dispute effects                       | Product/Finance/Compliance        | No unified policy                              | Aging, collection, impairment, recognition  |
| Credit/debit adjustment source             | Product/business + Finance        | B1 correction boundary incomplete              | Amount and accounting authority             |
| Write-off/impairment/recovery              | Finance/Tax/Compliance            | No approved method                             | Accounting/tax/close treatment              |
| Invoice cancellation/void/reissue linkage  | B1/Product + Finance              | B1T12 only defines due-date amendment          | AR supersession/reversal                    |
| Required A5 accounts/mappings              | A5/B2F03/Finance                  | AR account target defined; UUID/mapping absent | Posting compatibility                       |
| B2F06 action vocabulary/control rules      | Finance/A2                        | General control runtime exists                 | Approval/materiality/fingerprints           |
| Idempotency scopes/hash schemas            | Runtime implementation allocation | Shared service exists                          | Replay/conflict/unknown recovery            |
| Retention/legal hold/privacy               | Compliance/legal                  | General controls exist; durations unresolved   | Durable lawful evidence                     |
| Runtime ADR/migration/GO                   | Runtime implementation allocation | Existing task/gate                             | Authorizes code only after evidence         |
| Production account/mapping/term/identities | Production/deployment             | Runtimes exist                                 | Operational runtime gate, not design        |

## 45. Future handoffs

- **B2F08:** consumes no AR authority; any overpayment/refund/AP correlation needs explicit immutable handoff.
- **B2F09:** consumes compatible AR source/accounting correlations for revenue/tax/cost treatment without recalculation.
- **B2F10:** independently reconciles invoice→AR→journal/A5→settlement/allocation.
- **B2F11:** consumes AR close controls/exceptions.
- **B2F12:** consumes period-aware AR datasets/control schedules.
- **B6/B7:** later present/deliver approved outputs only.
- **B3:** later Treasury; no cash-positioning behavior is handed off by B2F07 design.

## 46. Design acceptance record

- [x] Existing B2F07 task and prerequisite package preserved.
- [x] B1 invoice/payment-term/due-date authority preserved.
- [x] A5 account/journal/value/balance/reversal authority preserved.
- [x] B2F03–B2F06 and A2 boundaries preserved.
- [x] B2F09-PRE reused and not reinterpreted as B2F07 completion.
- [x] Obligation, accounting, settlement, and aging states separated.
- [x] Settlement, partial payment, overpayment, correction, credit, write-off, and impairment boundaries documented without production defaults.
- [x] Audit/reconciliation/close/output/support handoffs defined.
- [x] Runtime and production gates remain explicit.
- [x] No source, test, migration, controller, API, runtime state, account, mapping, term, invoice, journal, or posting introduced.

## References

- [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)
- [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md)
- [`B2F-FINANCE-INVENTORY.md`](B2F-FINANCE-INVENTORY.md)
- [`B2F-ACCOUNTING-MODEL-CONTRACT.md`](B2F-ACCOUNTING-MODEL-CONTRACT.md)
- [`B2F-CHART-CLASSIFICATION-CONTRACT.md`](B2F-CHART-CLASSIFICATION-CONTRACT.md)
- [`B2F-FISCAL-PERIOD-CONTRACT.md`](B2F-FISCAL-PERIOD-CONTRACT.md)
- [`B2F-JOURNAL-GOVERNANCE-CONTRACT.md`](B2F-JOURNAL-GOVERNANCE-CONTRACT.md)
- [`B2F-FINANCE-CONTROL-CONTRACT.md`](B2F-FINANCE-CONTROL-CONTRACT.md)
- [`B2F-ACCOUNTING-TREATMENT-CONTRACT.md`](B2F-ACCOUNTING-TREATMENT-CONTRACT.md)
- [`B2F-ACCOUNTS-PAYABLE-AND-DISBURSEMENT-ACCOUNTING-CONTRACT.md`](B2F-ACCOUNTS-PAYABLE-AND-DISBURSEMENT-ACCOUNTING-CONTRACT.md)
- [`B2F-REVENUE-TAX-COST-AND-COMMERCIAL-EFFECT-ACCOUNTING-CONTRACT.md`](B2F-REVENUE-TAX-COST-AND-COMMERCIAL-EFFECT-ACCOUNTING-CONTRACT.md)
- [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md)
- [`B2F07-PREREQUISITE-WORK-PACKAGES.md`](B2F07-PREREQUISITE-WORK-PACKAGES.md)
- [`A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md`](A5-AR-CONTROL-ACCOUNT-PROVISIONING-CONTRACT.md)
- [`B1T12-ARCHITECTURE-DECISION-PACKAGE.md`](B1T12-ARCHITECTURE-DECISION-PACKAGE.md)
- [`ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md`](ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md)
- [`ADR/ADR-0089-B2-Finance-to-A5-Account-Mapping-Runtime.md`](ADR/ADR-0089-B2-Finance-to-A5-Account-Mapping-Runtime.md)
- [`ADR/ADR-0090-A5-AR-Control-Account-Provisioning.md`](ADR/ADR-0090-A5-AR-Control-Account-Provisioning.md)
- [`ADR/ADR-0091-B1-Commercial-Payment-Term-and-Invoice-Due-Date-Extension.md`](ADR/ADR-0091-B1-Commercial-Payment-Term-and-Invoice-Due-Date-Extension.md)
