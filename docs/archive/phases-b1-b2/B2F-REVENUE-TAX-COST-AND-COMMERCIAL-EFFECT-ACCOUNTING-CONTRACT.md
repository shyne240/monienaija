# B2F09 — Revenue Recognition, Tax Accounting, Cost Accounting, and Commercial Financial Effects Design

- **Task:** B2F09 — Revenue Recognition, Tax Accounting, Cost Accounting, and Commercial Financial Effects
- **Platform:** B2 Finance Platform
- **Status:** DESIGN COMPLETE — RUNTIME NOT IMPLEMENTED OR AUTHORIZED
- **Scope:** Design only; no source, migration, controller, service, schedule, tax record, cost allocation, mapping, account, journal, posting, report, or production configuration is created
- **Authoritative plan:** [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)
- **Sequence reconciliation:** [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md)
- **Required foundation:** B2F09-PRE — Finance Accounting Treatment and Source Decision Adoption Foundation

## 1. Purpose and bounded scope

B2F09 designs how B2 Finance accounts for canonical B1 revenue-recognition, tax/VAT, cost-accounting, billing/invoice, fee/commission/revenue-share, commercial financial-effect, profitability, and commercial-reconciliation evidence without recalculating commercial meaning or becoming A5.

B2F09 may eventually own:

- adoption of verified B1 commercial-financial source evidence through B2F09-PRE;
- Finance accounting treatment and policy-application references;
- Finance recognition schedule/status correlated to B1 recognition evidence;
- tax accounting classification, period, liability/receivable/expense/pass-through status, and settlement/audit correlation;
- Finance cost classification/allocation application evidence where the allocation method and input are approved and source-owned;
- Finance accounting dates and B2F04 admission;
- B2F03 classifications/mapping references and canonical A5 UUIDs;
- B2F06 controls and A2 approval provenance;
- B2F05 journal-governance references and A5 posting correlation;
- additive adjustment, supersession, reversal-correlation, reconciliation, close, output, audit, and support evidence.

B2F09 does not calculate commercial prices, fees, commission, revenue share, tax amount/rate/exemption, recognition method, commercial recognition period, cost amount/category/allocation method, invoice amount, profitability, settlement, or payment execution. B1 remains authoritative for those commercial decisions. B2F09 does not create A5 accounts, journals, lines, balances, postings, or reversals.

## 2. Authority boundaries

| Authority | Owns                                                                                                                                                   | B2F09 relationship                                                            | B2F09 must not                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A2        | Authentication, authorization, privileged approval, principal/assurance evidence                                                                       | Consume exact maker/checker/approval evidence                                 | Create IAM, roles, sessions, or approvals                              |
| A5        | Ledger account identity, journals/lines, posting, value, balances, reversals                                                                           | Correlate through B2F05 and canonical A5 evidence                             | Post directly, copy ledger authority, or derive authoritative balances |
| B1        | Commercial plans/pricing, fee/commission/revenue-share, billing/invoices, recognition/tax/cost decisions, commercial effects, analytics/reconciliation | Consume immutable decisions/documents read-only                               | Recalculate, reinterpret, repair, or overwrite B1 commercial semantics |
| A6        | Partner operations, settlement/suspense, external reconciliation                                                                                       | Consume settlement evidence when an accounting correlation requires it        | Execute payment/settlement or clear suspense                           |
| A7        | Product commands/lifecycle/financial effects/reconciliation                                                                                            | Consume only a verified immutable canonical source                            | Accept caller-provided product snapshots or mutate product state       |
| B2F03     | Finance classification and Finance-to-A5 mapping metadata                                                                                              | Resolve active/effective mappings                                             | Create accounts or infer mappings from names/codes                     |
| B2F04     | Fiscal periods and accounting-date admission                                                                                                           | Check exact period/date/classification admission                              | Open/reopen periods or bypass locks                                    |
| B2F05     | Finance journal governance and controlled A5 posting                                                                                                   | Create only DRAFT governance after admission/control                          | Replace journal governance or claim a draft is posted                  |
| B2F06     | Finance controls, materiality, maker/checker, exceptions/overrides                                                                                     | Consume deterministic ALLOW/DENY                                              | Define IAM or bypass controls                                          |
| B2F07     | Receivable lifecycle/status/settlement allocation/impairment                                                                                           | Correlate revenue/tax treatment to approved AR evidence where applicable      | Recreate AR or treat recognition as receivable collection              |
| B2F08     | Payable lifecycle/disbursement accounting                                                                                                              | Correlate cost/tax/payable treatment to approved AP evidence where applicable | Recreate AP or execute disbursement                                    |
| B2F09-PRE | Canonical source verification/adoption and Finance treatment provenance                                                                                | Mandatory foundation reused unchanged                                         | Duplicate source-adoption authority or count it as B2F09 completion    |
| B6        | Future reporting presentation/delivery                                                                                                                 | Consume approved read-only Finance datasets later                             | Implement broad reporting                                              |
| B7        | Future statement composition/delivery                                                                                                                  | Consume approved datasets later                                               | Implement statement delivery                                           |
| B3        | Future Treasury/liquidity/cash positioning                                                                                                             | Future correlation/handoff                                                    | Select funding, position cash, or execute Treasury                     |

## 3. Relationship to B1 commercial semantics

B1T08 is the sole B1 commercial-financial-recognition authority. Canonical B1 evidence includes:

- `B1RevenueRecognitionDecisionV1`;
- `B1TaxVatDecisionV1`;
- `B1CostAccountingDecisionV1`;
- B1 fee/commission/revenue-share decisions;
- B1 billing/invoice documents;
- B1 commercial analytics/profitability/reconciliation decisions.

B1 decisions may contain commercial recognition method, effective window, tax jurisdiction/category/exemption/base/rate/amount, cost category/allocation method/amount, plan/product/partner/customer/merchant provenance, NGN/`CUSTOMER_FUNDS`, hashes, traces, audit, and idempotency evidence.

B2F09 rules:

1. B1 values and methods are source facts, not optional suggestions to Finance.
2. B2F09 verifies exact reference/version/hash/currentness through canonical by-reference reads.
3. B2F09 does not regenerate a B1 decision on replay.
4. B1 `RECOGNIZED`, `APPLIED`, tax, or cost state does not prove A5 posting, cash movement, receivable settlement, payable settlement, or Finance close.
5. One B1 kind may have different approved Finance treatments; kind alone cannot select accounts.
6. Missing/incompatible/ambiguous B1 evidence fails closed.
7. Finance may reject accounting admission without changing B1 history.

## 4. Relationship to B2F09-PRE

B2F09-PRE already implements:

- read-only canonical B1/A6 source lookup and verification;
- source identity/version/hash/currentness/dimension checks;
- Finance book/accounting date/period provenance;
- B2F03 classification/mapping/A5 UUID references;
- B2F04 admission;
- B2F06 control decision;
- B2F05 DRAFT journal-governance creation;
- deterministic/idempotent/audited treatment persistence;
- read-only treatment/source consumer ports.

B2F09 runtime must consume/extend this foundation rather than creating another source-adoption table, service, contract, event, or idempotency authority. B2F09-PRE does not provide recognition schedules, tax accounting schedules, cost allocation application, complete mapping/account coverage, AR/AP linkage, close/output integration, or B2F09 reconciliation.

The historical technical label `B2F07`, migration `1785753600049`, table `b2f_finance_accounting_treatments`, contract `B2F-ACCOUNTING-TREATMENT` v1, and scope `b2.finance.accounting-treatment.idempotency.v1` remain unchanged.

## 5. Canonical source/evidence model

A future `B2F09CommercialAccountingSourceV1` must contain:

```text
sourceOwner
sourceCategory
sourceReference
sourceVersion
sourceHash
sourceState
sourceEffectiveAt
sourceOccurredAt
commercialScope/reference/version
plan/subscription/package/bundle/entitlement provenance
customer/merchant/partner/product references where present
billing/invoice reference/version/hash where present
recognition reference/version/hash/method/window where present
tax reference/version/hash/jurisdiction/category/exemption/base/rate/amount where present
cost reference/version/hash/category/allocation-method/amount where present
commercial-effect/analytics/reconciliation references where present
currency
accountingUnit
classification/retention/legal-hold metadata
idempotency/audit/correlation/causation
verifiedAt
```

Only fields present in the canonical source contract are accepted. A request cannot supply or override a missing amount, method, date, jurisdiction, party, or hash.

Source categories remain those verified by B2F09-PRE. A7 product financial-effect adoption remains fail closed until a canonical by-reference interface is approved.

## 6. Revenue-recognition accounting boundary

B1 owns the commercial recognition decision, including method and commercial recognition/effective window. B2F09 may own a Finance recognition-accounting schedule that records how the verified B1 source is admitted to Finance periods and correlated to A5.

A proposed Finance recognition schedule contains:

```text
scheduleReference/version/hash
B1 recognition reference/version/hash
source amount/currency/unit
recognition method reference
commercial start/end/effective times
Finance accounting dates/period references
allocation per accounting date/period where directly determined by approved B1 evidence
rounding/residual evidence
Finance treatment reference
B2F03 mapping references/A5 UUIDs
B2F05 journal-governance references
A5 journal references/status
adjustment/supersession/reversal correlation
close/reconciliation status
```

B2F09 must not derive a schedule if B1 evidence does not unambiguously provide the amount, recognition method, interval, allocation inputs, and rounding rule. It cannot convert a B1 commercial recognition state into an A5 posting claim.

Proposed Finance schedule states:

```text
PENDING_ADMISSION
ADMITTED
JOURNAL_DRAFT_CREATED
PARTIALLY_POSTED
POSTED
ADJUSTMENT_REQUIRED
REVERSED
CANCELLED
```

The exact vocabulary, allocation/rounding, partial-posting, cancellation, and adjustment transitions are **PROPOSED / REQUIRES FINANCE AND ARCHITECTURE APPROVAL**.

## 7. Tax-accounting boundary

B1 owns commercial tax/VAT calculation evidence: jurisdiction, category, exemption, tax base, rate, tax amount, effective period, and policy references. B2F09 does not become a generic tax engine or legal-advice authority.

B2F09 may eventually classify verified tax evidence as one approved Finance treatment, such as:

```text
tax payable
tax receivable
tax expense
pass-through/no Finance posting
```

No classification is selected automatically from `TAX_VAT`. Treatment must be explicitly approved by Finance/Tax/Legal and mapped through B2F03.

A future tax-accounting schedule/evidence record must contain:

- exact B1 tax source reference/version/hash;
- jurisdiction/category/exemption/base/rate/amount copied from B1;
- Finance treatment/classification/policy version;
- accounting date and B2F04 period;
- control-account/expense/receivable mapping references and A5 UUIDs;
- B2F05/A5 journal correlations;
- settlement/payment evidence from the authoritative execution owner, where applicable;
- return/schedule/audit reference, without claiming regulatory submission;
- adjustment/reassessment/reversal/supersession evidence;
- reconciliation and close status.

Tax filing, remittance, regulator submission, tax registration, statutory advice, and broad tax-report rendering are outside B2F09 and require separately approved owners/channels.

## 8. Cost-accounting boundary

B1 owns commercial cost amount, category, allocation method, and source provenance. B2F09 determines only the approved Finance treatment and application to Finance dimensions/accounts/periods.

Potential existing source categories include:

```text
DIRECT_COST
INDIRECT_COST
ACQUISITION_COST
OPERATIONAL_COST
ALLOCATED_COST
```

Potential Finance classifications already documented but unmapped include:

```text
finance.expense.direct-cost
finance.expense.indirect-cost
finance.expense.acquisition-cost
finance.expense.operational-cost
finance.expense.allocated-cost
finance.expense.commission
finance.expense.revenue-share
```

B2F09 must not invent cost drivers, percentages, allocation bases, departments, cost centers, projects, or capitalization rules. Where the B1 allocation method is not sufficient to deterministically produce Finance allocation lines, runtime fails closed pending an approved Finance allocation policy.

A future Finance cost-allocation application records:

- exact B1 cost decision/version/hash;
- source cost amount/category/method;
- approved Finance allocation policy/version/hash;
- allocation driver/source/version where approved;
- ordered target dimensions/classifications/mappings/A5 UUIDs;
- allocated amounts, rounding, and residual;
- period/accounting dates;
- approvals/controls;
- B2F05/A5 correlations;
- supersession/reversal/reconciliation evidence.

Capitalization to an asset, prepaid treatment, amortization/depreciation, and impairment require separate approved semantics and cannot be inferred from a generic cost kind.

## 9. Commercial financial-effect accounting

A commercial decision or financial-effect statement is not an accounting posting. B2F09 may correlate approved B1 commercial effects to Finance treatments and A5 results while preserving each identity.

The correlation must distinguish:

```text
B1 commercial decision/document
B2F09-PRE adopted source/treatment
B2F07 receivable reference (where applicable)
B2F08 payable reference (where applicable)
B2F09 recognition/tax/cost schedule/application
B2F05 journal-governance reference
A5 journal/reversal reference
A6 settlement evidence (where applicable)
B2 reconciliation/close/output references
```

B2F09 cannot create AR/AP records as a side effect. Where a treatment requires a receivable or payable, the relevant B2F07/B2F08 evidence must already exist and be compatible.

## 10. Accounting date and period authority

B1 source effective/occurred/recognition/tax/cost times are immutable source evidence. B2F09 applies the approved Finance accounting-date policy and submits the exact date to B2F04.

Rules:

- accounting date must be deterministic from an approved policy and source facts;
- it must not default silently to current time, persistence time, settlement time, or invoice time;
- B2F04 must return an admitted period/reference/version;
- locked/closed/missing/wrong-date periods fail closed;
- late-arriving source treatment, back-posting, and close adjustment require approved policies and controls;
- B2F09 cannot open/reopen a period;
- B1 period keys do not replace B2F04 Finance periods.

Exact accounting-date selection per B1 source category is **NOT VERIFIED / REQUIRES FINANCE APPROVAL**.

## 11. Account mappings and A5 correlation

B2F09 requires approved classifications and active/effective B2F03 mappings for every journal line. Existing revenue/expense/tax/payable roles are currently unmapped.

Runtime requires:

1. canonical A5 account exists and is active;
2. account type/normal balance/currency/unit is compatible;
3. B2F03 mapping is active/effective and snapshot-compatible;
4. exact treatment line resolves to mapping reference/version and A5 UUID;
5. B2F05 re-verifies mappings before governance creation;
6. A5 alone creates journal/lines/posting/value;
7. reversal/correction uses A5 authority through controlled governance.

No revenue, expense, tax, deferred-revenue, payable, receivable, cost-allocation, or other control account may be provisioned by B2F09.

## 12. Journal-governance boundary

After source verification, treatment, mapping, period, and control checks, B2F09 may ask B2F05 to create a DRAFT Finance journal-governance record. It cannot approve/post that record inside B2F09 or call `LedgerService` directly.

Balanced lines must include exact source/schedule/tax/cost references, ordered line numbers, debit/credit, amount, mapping/classification, canonical A5 UUID, dimensions, accounting date, period, description, policy, correlation, and semantic hashes.

`JOURNAL_DRAFT_CREATED` means accounting intent was preserved. `POSTED` requires a later B2F05/A5 result. Unknown/rejected posting remains distinct and is reconciled independently.

## 13. Finance controls and approval

B2F09 must consume A2/B2F06. Existing B2F09-PRE uses `FINANCE_ACCOUNTING_TREATMENT_ADOPT`; additional schedule, tax adjustment, cost allocation, write-off, close adjustment, and correction actions are **NOT VERIFIED / REQUIRES APPROVAL**.

Controls must bind:

- exact source/treatment/schedule/application reference/version/hash;
- amount/currency/unit and materiality;
- accounting date/period;
- mappings/A5 UUIDs;
- maker identity/roles;
- checker/executor identity/roles;
- distinct approval references;
- override/exception evidence;
- expected record version;
- action fingerprint;
- correlation/context.

Denial prevents journal governance and never changes B1/A5/source state.

## 14. Determinism, idempotency, replay, and concurrency

B2F09-PRE scope remains unchanged for source adoption/treatment. Future B2F09 operations require separately reviewed semantic boundaries for:

- recognition-schedule creation/versioning;
- period recognition event;
- tax-accounting schedule/event;
- cost-allocation application;
- adjustment/supersession;
- reconciliation snapshot.

Exact new scopes are **NOT ASSIGNED**.

Requirements:

- hashes use canonical serialization and exact source/policy/mapping/period inputs;
- generated IDs/timestamps/audit IDs/replay flags are excluded;
- same key/hash replays original durable result;
- changed semantics conflict;
- one source/version cannot produce duplicate active schedule/application versions;
- serializable transactions, unique constraints, expected versions, and locks protect local transitions;
- unknown B2F05/A5/A6 outcomes recover by canonical lookup or same-key replay;
- no blind duplicate journal, adjustment, tax event, allocation, or settlement record;
- additive history preserves every superseded version.

## 15. Correction, amendment, and reversal

Commercial correction remains B1-owned and produces new/superseding B1 evidence. Finance never edits the source decision.

Finance correction is additive:

```text
original B1 source
→ original Finance treatment/schedule/application
→ corrected/superseding B1 source or approved Finance correction reason
→ additive Finance adjustment/supersession
→ controlled B2F05 journal governance
→ A5 reversal/compensating journal where value changed
→ reconciliation/close evidence
```

B2F09 does not directly reverse A5, silently rewrite prior periods, mutate posted lines, alter AR/AP source states, or auto-clear discrepancies. The correction owner, approval, accounting date, period/reopen treatment, mappings, amount, reason, and source relationship must be explicit.

Tax reassessment, revenue schedule change, cost reallocation, rounding residual, cancellation, write-off, and prior-period adjustment semantics are **NOT VERIFIED / REQUIRE OWNER APPROVAL**.

## 16. Lifecycle and state separation

B2F09 must keep these states distinct:

1. B1 source decision state;
2. B2F09-PRE adoption/treatment state;
3. Finance schedule/application state;
4. B2F07 receivable state, if linked;
5. B2F08 payable state, if linked;
6. B2F05 journal-governance state;
7. A5 posting/reversal state;
8. A6 settlement state;
9. Finance reconciliation/close/output state.

Proposed schedule/application states are:

```text
PENDING_ADMISSION
ADMITTED
JOURNAL_DRAFT_CREATED
PARTIALLY_POSTED
POSTED
ADJUSTMENT_REQUIRED
SUPERSEDED
REVERSED
CANCELLED
REJECTED
```

Exact per-capability transition matrices and terminal behavior remain **PROPOSED / REQUIRES APPROVAL** before runtime.

## 17. Audit, reconciliation, close, and outputs

Shared `AuditService` remains the audit authority. B2F09 audit must cover source verification, treatment, schedule/application creation, accounting date/period, mappings, control/approval, journal/A5 result, correction/supersession, rejection/replay/unknown, reconciliation, and support provenance.

B2F10 later independently reconciles:

- B1 source to B2F09-PRE treatment;
- treatment to schedule/tax/cost application;
- schedule/application to B2F05/A5;
- AR/AP links;
- A6 settlement where applicable;
- period/close/output inclusion;
- duplicate/missing/orphan/stale/amount/account/period/policy/status mismatches.

B2F09 does not repair records to make reconciliation pass. B2F11 controls close. B2F12 produces official accounting datasets. B6/B7 later present/deliver outputs read-only. B2F13 owns regulatory schedules/audit packs; no filing/submission is claimed here.

Retention, legal hold, classification, redaction, access, tax-record retention, and audit schedule requirements are **NOT VERIFIED / REQUIRE FINANCE/TAX/LEGAL/PRIVACY/COMPLIANCE/AUDIT APPROVAL**.

## 18. Currency, accounting unit, book, and legal scope

B2F09 v1 design is restricted to:

```text
book: finance.book.ng.primary / 1
legalEntityReference: finance.legal-entity.ng.primary (pending legal ratification)
basis: ACCRUAL
currency: NGN
accountingUnit: CUSTOMER_FUNDS
```

FX, foreign-currency recognition/tax/cost, remeasurement, translation, multi-book, multi-entity, consolidation, intercompany, branch accounting, and Treasury are prohibited. E1 owns future FX. Production activation remains blocked by existing legal-entity/accounting-policy ratification requirements.

## 19. Decision classification

### A. Already frozen by existing architecture

- A5 owns accounts/journals/lines/posting/value/balances/reversals.
- B1 owns commercial recognition/tax/cost calculation and source meaning.
- B2F03 owns mapping metadata.
- B2F04 owns period admission.
- B2F05 owns journal governance and controlled A5 posting.
- B2F06 owns Finance controls; A2 owns authorization/approval.
- B2F09-PRE owns source adoption/treatment provenance and remains unchanged.
- B2F07/B2F08 own AR/AP respectively.
- B2F09 v1 is NGN/`CUSTOMER_FUNDS`, accrual, primary book only.
- corrections are additive; no source/A5 history rewrite.
- B2F09 design may proceed; runtime may not bypass B2F07/B2F08.

### B. Configuration after semantic approval

- enabled source categories/capabilities;
- accounting-date policy version per approved source;
- treatment/classification mapping references;
- schedule templates once method semantics are approved;
- materiality/control policy values;
- effective dates;
- rounding configuration within approved rule;
- retention/access configuration after owner approval.

Configuration cannot create new tax, recognition, allocation, account, or authority semantics.

### C. Architecture approval required

- exact schedule/application persistence identities and lifecycle contracts;
- idempotency scopes/hash schemas;
- B2F06 action vocabulary beyond existing treatment adoption;
- AR/AP linkage/cardinality;
- correction/supersession/prior-period orchestration;
- B6/B7/B10/C4 handoff contracts where needed;
- runtime ADR/migration allocation and explicit runtime GO.

### D. Finance/Tax/Legal/Compliance approval required

- accounting policy and date per source;
- revenue schedule allocation/rounding/residual rules;
- tax treatment by jurisdiction/category/exemption and settlement obligations;
- cost allocation drivers/bases/targets/rounding/capitalization;
- account purpose/control-account definitions;
- legal entity, accounting standard, tax jurisdiction, statutory/audit requirements;
- materiality, approvals, overrides, close/prior-period behavior;
- retention/legal hold/access/audit schedule.

### E. Dependencies on B2F07/B2F08

- B2F09 runtime cannot create or replace AR/AP.
- Treatments requiring receivable/payable correlation need compatible approved B2F07/B2F08 records and mappings.
- Runtime sequencing must not bypass the preceding B2F07/B2F08 tasks.

### F. Production-only prerequisites

- active A2 workforce trust and Finance roles;
- active B2F06 policies;
- ratified legal-entity/accounting-policy evidence;
- active periods;
- provisioned A5 revenue/expense/tax/deferred/AP/AR accounts;
- active B2F03 mappings;
- approved production B1 source decisions;
- certified A6 settlement evidence where applicable;
- production retention/audit/support/reconciliation/close controls.

## 20. Error and fail-closed behavior

Reject before journal governance for:

- missing/unverifiable/stale/hash-mismatched source;
- unsupported source capability/category/state/method/jurisdiction/allocation;
- caller-supplied replacement amount/rate/method/date;
- currency/unit/book/legal-scope mismatch;
- ambiguous accounting treatment or date;
- missing AR/AP link where required;
- missing/inactive/ineffective/drifted mapping;
- missing/closed/incompatible period;
- denied/mismatched/stale approval/control;
- unbalanced/incompatible journal request;
- duplicate source/schedule/application/event;
- over/under allocation or unresolved rounding residual;
- stale version/concurrent update;
- unknown posting/settlement result;
- missing correction/supersession relationship;
- unavailable canonical read boundary.

Unknown is never success. No automatic account creation, mapping, posting, reversal, tax filing, allocation repair, settlement retry, suspense clearing, source mutation, or discrepancy suppression is allowed.

## 21. Runtime implementation prerequisites

Before B2F09 runtime authorization:

1. complete/approve B2F07 and B2F08 runtime prerequisites and sequencing gates;
2. approve exact first bounded B1 source capabilities for B2F09 runtime;
3. verify canonical B1 by-reference reads and source state/hash/currentness rules;
4. approve recognition schedule methods, allocation, rounding, residual, lifecycle, and accounting-date policy;
5. approve tax jurisdiction/category/treatment/settlement/adjustment boundaries;
6. approve cost category/allocation driver/target/rounding/capitalization boundaries;
7. approve AR/AP linkage rules;
8. provision canonical A5 accounts through A5-owned processes;
9. activate B2F03 mappings for every treatment line;
10. ensure B2F04 periods/admission are production-capable;
11. approve B2F06 action/control/materiality/approval policies;
12. approve B2F05 journal templates/governance and A5 correlation;
13. allocate idempotency scopes/hash contracts;
14. approve correction/supersession/reversal and prior-period behavior;
15. approve reconciliation/close/output handoffs;
16. approve audit/retention/legal-hold/privacy/support evidence;
17. allocate runtime ADR/migration and rollback plan;
18. record explicit B2F09 runtime GO after preceding task gates.

## 22. Design work allowed now versus blocked work

### Allowed now

- source/capability/authority inventory;
- source-evidence and schedule/application contract design;
- recognition/tax/cost treatment-decision workshops;
- classification/account/mapping gap inventory;
- accounting-date, correction, lifecycle, idempotency, audit, reconciliation, and test-plan design;
- B2F07/B2F08/B2F10/B2F11/B2F12/B2F13 handoff analysis;
- unresolved decision ownership and runtime-entry evidence planning.

### Blocked

- entity, migration, service, repository, controller, API, event, schedule, tax record, cost allocation, mapping, account, journal, posting, reconciliation output, report, statement, or production configuration;
- recalculation of B1 source decisions;
- activation of classifications/mappings/accounts/policies;
- B2F09 runtime before B2F07/B2F08 sequencing and explicit GO;
- B2F10 runtime or later-platform implementation.

## 23. Unresolved decision register

| Question                                                    | Existing evidence                                                        | Owner                                  | Why it matters / controlled runtime behavior                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------ |
| Which first B1 source capabilities enter B2F09 runtime?     | B1T04/T05/T08/T09 sources exist; B2F09-PRE verifies categories           | Architecture, Finance, B1              | Bounds runtime scope and source uniqueness                   |
| What accounting date applies per source?                    | Source times exist; B2F04 requires exact date                            | Finance, Tax, Audit                    | Period admission, cutoff, close, adjustment                  |
| How are recognition schedule amounts allocated and rounded? | B1 method/window evidence exists; no approved Finance schedule algorithm | B1, Finance                            | Schedule lines, residuals, journal timing                    |
| What tax treatments apply?                                  | B1 tax evidence exists; chart roles reserved/unmapped                    | Tax, Legal, Finance                    | Liability/receivable/expense/pass-through, periods, mappings |
| What tax settlement/filing evidence is authoritative?       | No B2F09 filing/remittance channel                                       | Tax, Legal, A6/B3 as applicable        | Settlement status, audit schedule, no false filing claim     |
| Which cost allocations are approved?                        | B1 categories/methods exist; no Finance driver/target policy             | B1, Finance                            | Allocation lines, dimensions, rounding, capitalization       |
| Which A5 accounts/mappings are required?                    | Revenue/expense/tax/AP roles exist but are unmapped                      | A5, B2F03, Finance                     | Journal compatibility and posting                            |
| How do schedules link to AR/AP?                             | B2F07/B2F08 designs separate subledgers                                  | B2F07, B2F08, B2F09                    | Cardinality, amount/state correlation, no duplication        |
| What are exact lifecycle states/transitions?                | Proposed model in this design; B1/A5/B2F05 states distinct               | Architecture, Finance                  | Concurrency, correction, close, outputs                      |
| What actions/approvals/materiality apply?                   | Existing treatment action only                                           | B2F06, A2, Finance                     | Admission, adjustment, tax/cost controls                     |
| What idempotency scopes/hash schemas apply?                 | B2F09-PRE scope fixed; new operations absent                             | Architecture, Operations               | Replay/conflict/unknown recovery                             |
| How are corrections/prior periods handled?                  | Additive/A5 reversal principles fixed                                    | Finance, Tax, Audit, B2F04/B2F05       | Supersession, reopen, reversal, close                        |
| What retention/legal-hold rules apply?                      | General Finance/B1 classifications; exact durations unverified           | Legal, Tax, Privacy, Compliance, Audit | Durable history, disposal, support access                    |
| When can B2F09 runtime begin?                               | Plan permits design only; sequence B2F07→B2F08→B2F09                     | Architecture                           | Prevents premature runtime implementation                    |

## 24. Design acceptance record

- [x] Existing B2F09 task definition and B2F09-PRE classification preserved.
- [x] B1 remains sole commercial recognition/tax/cost calculation authority.
- [x] A5 remains sole journal/posting/value/balance/reversal authority.
- [x] B2F03–B2F06 boundaries preserved.
- [x] B2F07/B2F08 subledger responsibilities remain separate.
- [x] Revenue schedule, tax accounting, cost application, and commercial-effect correlations are designed without runtime creation.
- [x] Accounting dates, mappings, controls, corrections, audit, reconciliation, and outputs fail closed pending approval.
- [x] B2F09-PRE is reused and not claimed as B2F09 completion.
- [x] No B2F10 or later runtime behavior introduced.

## References

- [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md)
- [`B2F-FINANCE-INVENTORY.md`](B2F-FINANCE-INVENTORY.md)
- [`B2F-ACCOUNTING-MODEL-CONTRACT.md`](B2F-ACCOUNTING-MODEL-CONTRACT.md)
- [`B2F-CHART-CLASSIFICATION-CONTRACT.md`](B2F-CHART-CLASSIFICATION-CONTRACT.md)
- [`B2F-FISCAL-PERIOD-CONTRACT.md`](B2F-FISCAL-PERIOD-CONTRACT.md)
- [`B2F-JOURNAL-GOVERNANCE-CONTRACT.md`](B2F-JOURNAL-GOVERNANCE-CONTRACT.md)
- [`B2F-FINANCE-CONTROL-CONTRACT.md`](B2F-FINANCE-CONTROL-CONTRACT.md)
- [`B2F-ACCOUNTING-TREATMENT-CONTRACT.md`](B2F-ACCOUNTING-TREATMENT-CONTRACT.md)
- [`B2F-ACCOUNTS-PAYABLE-AND-DISBURSEMENT-ACCOUNTING-CONTRACT.md`](B2F-ACCOUNTS-PAYABLE-AND-DISBURSEMENT-ACCOUNTING-CONTRACT.md)
- [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md)
- [`B2F07-PREREQUISITE-WORK-PACKAGES.md`](B2F07-PREREQUISITE-WORK-PACKAGES.md)
- [`B1-REVENUE-RECOGNITION-CONTRACT.md`](B1-REVENUE-RECOGNITION-CONTRACT.md)
- [`B1-BILLING-ENGINE-CONTRACT.md`](B1-BILLING-ENGINE-CONTRACT.md)
- [`B1-FEE-ENGINE-CONTRACT.md`](B1-FEE-ENGINE-CONTRACT.md)
- [`B1-COMMERCIAL-ANALYTICS-CONTRACT.md`](B1-COMMERCIAL-ANALYTICS-CONTRACT.md)
- [`ADR/ADR-0083-B2-Finance-Accounting-Model-Books-Basis-and-Fiscal-Calendar.md`](ADR/ADR-0083-B2-Finance-Accounting-Model-Books-Basis-and-Fiscal-Calendar.md)
- [`ADR/ADR-0084-B2-Finance-Chart-Classification-and-A5-Account-Mapping.md`](ADR/ADR-0084-B2-Finance-Chart-Classification-and-A5-Account-Mapping.md)
- [`ADR/ADR-0085-B2-Finance-Fiscal-Year-and-Accounting-Period-Runtime.md`](ADR/ADR-0085-B2-Finance-Fiscal-Year-and-Accounting-Period-Runtime.md)
- [`ADR/ADR-0086-B2-Finance-Journal-Governance-and-Controlled-A5-Posting.md`](ADR/ADR-0086-B2-Finance-Journal-Governance-and-Controlled-A5-Posting.md)
- [`ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md`](ADR/ADR-0087-B2-Finance-Control-Policy-and-Segregation-of-Duties.md)
- [`ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md`](ADR/ADR-0088-B2-Finance-Accounting-Treatment-and-Source-Decision-Adoption.md)
