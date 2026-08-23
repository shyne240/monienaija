# B2 Finance Platform — Preliminary Implementation Plan

> **Task-sequence reconciliation notice (2026-08-10):** The implementation historically labeled **B2F07 — Finance Accounting Treatment and Source Decision Adoption** at commit `4e0e72c90fb336efdd9cf596cc1c8b60612b4589` is preserved unchanged and classified for planning as **B2F09-PRE — Finance Accounting Treatment and Source Decision Adoption Foundation**. It is shared support for B2F07–B2F10 and does not complete authoritative B2F07 or B2F09. Authoritative definitions remain B2F07 Accounts Receivable, B2F08 Accounts Payable, and B2F09 Revenue Recognition/Tax/Cost/Commercial Financial Effects. See [`B2F-TASK-SEQUENCE-RECONCILIATION.md`](B2F-TASK-SEQUENCE-RECONCILIATION.md).

- **Platform:** B2 — Finance Platform
- **Planning task:** B2R01 — Authoritative Platform Roadmap and B2 Finance Reconciliation
- **Status:** Preliminary planning artifact; no B2 Finance runtime implementation has started
- **Task namespace:** `B2F01`–`B2F15` (fresh Finance namespace; not a continuation or renaming of historical B2T01–B2T12)
- **Boundary:** [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md)
- **Roadmap:** [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)

This plan creates no controller, service, entity, migration, route, API, scheduler, journal, posting, finance record, or runtime behavior. Every task below requires separate authorization and implementation. Historical B2T11 and B2T12 are not Finance tasks and must not be executed.

## 1. Objective

Implement a governed Finance Platform that consumes canonical commercial, product, partner, and ledger facts; provides finance accounting models, controls, subledger/accounting treatment, close, reconciliation, and official accounting outputs; and never duplicates A5 Ledger or B1 Commercial authority.

## 2. Planning principles

1. **Ledger first:** A5 owns all monetary posting, balances, journals, and posting invariants.
2. **Commercial decisions remain B1:** B2 Finance accounts for B1 decisions and does not recalculate them.
3. **Source facts remain source-owned:** A6 partner and A7 product facts are consumed read-only.
4. **No broad adjacent platforms:** B3 Treasury, B5 Merchant, B6 Reporting, B7 Statement, B8 Configuration, B9 IAM administration, and B10 Developer Integration retain their boundaries.
5. **Additive history:** Corrections are additive and correlated to A5 compensating entries.
6. **Close is controlled:** Period state, approval, exception, materiality, and reopen behavior are explicit.
7. **Reconciliation is independent:** Reconciliation detects and classifies; it does not mutate sources to pass.
8. **Evidence before activation:** Architecture, Finance, Tax, Security, Legal, Compliance, Audit, Operations, Reconciliation, and Support evidence gate implementation and release.
9. **Existing artifacts are preserved:** No existing B1 or legacy B2 migration, ADR, contract, event, scope, or identifier is renamed.
10. **Task isolation:** Each Arena task must state exact files, migrations, APIs, and prohibited edges before code is changed.

## 3. Preliminary critical path

```text
B2F01 Baseline and authority map
  -> B2F02 Accounting model and books
  -> B2F03 Chart of accounts and dimensions
  -> B2F04 Fiscal years and accounting periods
  -> B2F05 Journal governance and A5 posting interface
  -> B2F06 Finance controls, approvals, and segregation
  -> B2F09-PRE Source decision adoption and accounting-treatment foundation
     (already implemented under historical label B2F07; shared prerequisite, not task completion)
  -> A5T11 AR control-account provisioning + B1T12 payment-term/invoice due-date extension
     (authorized parallel prerequisites; implementation not started)
  -> B2F03 finance.asset.receivable mapping approval/activation
  -> B2F07 renewed entry review and explicit GO
  -> B2F07 Receivables and invoice-accounting boundary
  -> B2F08 Payables and disbursement-accounting boundary
  -> B2F09 Revenue, tax, cost, and commercial-effect accounting
  -> B2F10 Financial reconciliation and break management
  -> B2F11 Month-end and year-end close
  -> B2F12 Trial balance and official accounting outputs
  -> B2F13 Regulatory schedules and audit packs
  -> B2F14 Operational recovery, retention, and support evidence
  -> B2F15 Integration certification and B3 Treasury handoff
```

B2F07 and B2F08 may be designed in parallel after B2F06. B2F09 design may begin once B2F03–B2F06 contracts are frozen, but its implementation must include the full B1 overlap review. B2F10 must exist before close/output certification. B2F15 cannot pass until all preceding task evidence is complete.

## 4. Task breakdown

### B2F01 — Finance Baseline, Ownership Matrix, and Gap Register

**Type:** documentation and architecture inventory before runtime implementation.

**Objective**

Inventory all current ledger, commercial, product, partner, finance-adjacent, reconciliation, reporting, statement, configuration, IAM, operations, and audit artifacts. Freeze the Finance Platform authority map and identify gaps without creating a duplicate authority.

**Required deliverables**

- Finance-adjacent module/schema/API/event inventory.
- Exact B1 capability inventory for billing, invoice, statement, revenue recognition, tax/VAT, cost accounting, financial effects, commercial reconciliation, profitability, and analytics.
- A5 account/journal/posting/correction interface inventory.
- Source-to-finance-to-A5 ownership matrix.
- Duplicate-authority risk register.
- Data classification, retention, legal-hold, support, and audit input register.
- Proposed Finance ADR allocation that does not renumber existing ADRs.

**Acceptance gate**

Every proposed Finance record has one owner, one upstream source map, one A5 relationship where monetary, one correction owner, and one reconciliation owner. Unknown ownership blocks B2F02.

**Explicit non-goals:** entities, migrations, services, routes, posting, production activation.

### B2F02 — Canonical Finance Accounting Model and Books

**Objective**

Define finance books, accounting bases, accounting policy versions, currencies/accounting units, dimensions, source-event classifications, effective dating, and evidence requirements.

**Required deliverables**

- Finance accounting model ADR and contract.
- Book identity/versioning and accounting-policy model.
- Source-event-to-accounting-treatment vocabulary.
- Multi-book boundary, if approved, without implementing FX or international accounting.
- Idempotency, audit, outbox, correction, and effective-date rules.
- Compatibility rules with A5, B1, A6, and A7.

**Acceptance gate**

The model cannot store or derive a balance that competes with A5 and cannot determine commercial terms that compete with B1.

### B2F03 — Chart of Accounts Governance and Accounting Dimensions

**Objective**

Define Finance-owned chart governance and mappings to A5 ledger accounts while preserving A5 account and value authority.

**Required deliverables**

- Chart/account classification contract.
- Account-purpose, control-account, contra-account, cost-center, product, merchant, partner, tax, and reporting-dimension rules as approved.
- Effective dating, deprecation, compatibility, and no-destructive-remap rules.
- Mapping validation against A5 currency/accounting-unit/account type.
- Approval and audit requirements for chart changes.

**Acceptance gate**

No Finance chart entry is treated as an A5 account or balance unless mapped to an existing approved A5 identity. Mapping changes cannot rewrite posted history.

### B2F04 — Fiscal Years, Accounting Periods, and Period Controls

**Objective**

Define fiscal calendars, accounting periods, period states, posting dates, cutoffs, locks, reopen controls, and period evidence.

**Required deliverables**

- Fiscal-year and period contract.
- State vocabulary such as planned/open/soft-close/hard-close/reopened, subject to Finance approval.
- Posting-date and late-arrival treatment.
- Privileged reopen and back-posting controls.
- Period audit and close dependency rules.

**Acceptance gate**

Closed-period behavior fails closed. Reopen requires segregated approval, reason, time bound, and immutable audit evidence.

### B2F05 — Finance Journal Governance and A5 Posting Interface

**Objective**

Define how approved finance accounting treatments become posting requests to A5 and how posting outcomes are correlated without implementing another journal engine.

**Required deliverables**

- Finance journal-request contract distinct from A5 posted journal.
- Source evidence, account mapping, amount/currency, period, policy version, approval, idempotency, and correlation requirements.
- A5 posting port and response contract.
- Rejection, timeout, unknown, duplicate, changed-payload, reversal, adjustment, and compensating-entry behavior.
- Posting reconciliation and support trace.

**Acceptance gate**

Only A5 can return an authoritative posted journal. No Finance method mutates A5 balances, journals, or lines.

### B2F06 — Finance Controls, Approvals, and Segregation of Duties

**Objective**

Define finance controls and approval evidence while consuming A2 authorization and future B9 administration rather than building IAM.

**Required deliverables**

- Finance role/capability requirements.
- Maker-checker and segregation-of-duties matrix.
- Approval thresholds, materiality, exception, override, and expiry rules.
- A2 privileged-action/approval integration contract.
- Future B9 administrative-IAM handoff requirements.
- Control testing and audit-evidence contract.

**Acceptance gate**

No actor can prepare and finally approve a prohibited same-scope action. B2 stores approval evidence/correlation, not credentials or IAM truth.

### Completed supporting foundation — B2F09-PRE

**Historical implementation label:** B2F07 — Finance Accounting Treatment and Source Decision Adoption
**Commit:** `4e0e72c90fb336efdd9cf596cc1c8b60612b4589`

B2F09-PRE supplies source-decision verification/adoption and Finance treatment provenance for B2F07, B2F08, B2F09, and B2F10. It remains unchanged and must be consumed rather than duplicated. It does not implement receivable/payable lifecycles and does not satisfy the remaining recognition, tax, cost, output, or A5-correlation acceptance criteria of B2F09. This is a planning classification only; existing ADR, migration, contract, code, table, scope, and test identities remain unchanged.

### B2F07 — Accounts Receivable and Invoice-Accounting Boundary

**Status:** BLOCKED pending completion of authorized A5T11 and B1T12, activation of the approved B2F03 `finance.asset.receivable` mapping, and an explicit B2F07 GO decision. Authorization of prerequisites does not authorize B2F07 implementation.

**Objective**

Implement receivable accounting around approved B1 billing/invoice facts without duplicating B1 invoice decisions or treating invoice issuance as posting.

**Required deliverables**

- B1 billing/invoice input adapter contract.
- Receivable lifecycle, aging, settlement allocation, credit, write-off, dispute, and impairment boundaries as approved.
- Control-account and A5 posting mappings.
- Idempotency, replay, adjustment, and reconciliation behavior.
- B7 document/statement and B6 reporting output contracts.

**Acceptance gate**

Every receivable points to immutable source evidence and reconciles to A5 where posted. Invoice status and ledger status remain distinct.

### B2F08 — Accounts Payable and Disbursement-Accounting Boundary

**Objective**

Define payable accounting, approval, due/settlement status, and A5 correlation without becoming Treasury, partner adapter, or payment execution authority.

**Required deliverables**

- Payable source and evidence contract.
- Vendor/partner/merchant identity reference rules consuming canonical owners.
- Approval, due-date, hold, dispute, settlement-accounting, and adjustment states.
- A5 posting and A6/payment execution correlation boundaries.
- Duplicate, partial, rejected, delayed, and unknown handling.

**Acceptance gate**

A payable never proves cash movement. B3 later owns treasury/cash positioning; A6/payment owners execute approved external movement.

### B2F09 — Revenue Recognition, Tax Accounting, Cost Accounting, and Commercial Financial Effects

**Objective**

Implement the bounded B1→B2→A5 accounting integration for existing B1 finance-implication capabilities. Consume the completed B2F09-PRE source-adoption/treatment foundation; do not recreate it or count it as completion of the remaining B2F09 scope.

**Required deliverables**

- Per-capability decision record for B1 billing, invoice, revenue recognition, tax/VAT, cost accounting, commercial financial effects, commercial reconciliation, profitability/analytics, and statement generation.
- Revenue recognition accounting schedule/status and adjustment rules.
- Tax control-account, period, liability/receivable, reconciliation, settlement-evidence, and audit schedule rules.
- Cost classification/allocation accounting rules with explicit method ownership.
- Commercial-effect-to-finance-treatment-to-A5 correlation.
- B6 and B7 read-only outputs.

**Acceptance gate**

No B1 commercial decision is recalculated. No tax, recognition, cost, billing, invoice, reconciliation, analytics, or statement authority is duplicated. Every monetary accounting outcome resolves to A5.

### B2F10 — Independent Financial Reconciliation and Break Management

**Objective**

Independently compare Finance records and expected postings with B1, A6, A7, A5, receivable, payable, close, and approved external evidence without repairing source records.

**Required deliverables**

- Reconciliation source and comparison contracts.
- Break taxonomy: missing, duplicate, mismatched account/amount/currency/period/policy/status, stale, orphan, timing, unapproved, and unresolved unknown.
- Materiality, owner, aging, escalation, disposition, and evidence rules.
- Read-only reconciliation queries and support trace.
- Rerun/idempotency and snapshot rules.

**Acceptance gate**

Reconciliation cannot write source records to make a run pass. Resolution is an approved source correction or additive A5 adjustment with full correlation.

### B2F11 — Month-End and Year-End Close

**Objective**

Implement controlled close orchestration, checklists, dependencies, exceptions, approvals, and reopen behavior.

**Required deliverables**

- Month-end and year-end close contracts.
- Required reconciliations, accrual/deferral/recognition/tax/cost checks, suspense review, receivable/payable controls, and materiality gates.
- Close run, task, exception, sign-off, and evidence model.
- Hard-close and privileged reopen behavior.
- Operational recovery and partial-failure rules.

**Acceptance gate**

A period cannot close with an unapproved material break. Close never edits source or A5 history.

### B2F12 — Trial Balance and Official Accounting Outputs

**Objective**

Produce controlled trial-balance, balance-sheet, profit-and-loss, and supporting finance datasets from A5 and approved Finance classifications.

**Required deliverables**

- Trial-balance contract and balancing checks.
- Balance-sheet and P&L accounting dataset contracts.
- Comparative period, adjustment, close-state, policy-version, and lineage rules.
- Signed snapshot/hash/evidence behavior.
- Read-only handoffs to B6 Reporting and B7 Statement.

**Acceptance gate**

Outputs reconcile to A5, disclose approved exceptions, carry lineage/policy/period versions, and cannot post or alter accounting facts.

### B2F13 — Regulatory Financial Schedules and Audit Packs

**Objective**

Define finance-owned regulatory schedules and immutable audit packages without building the broad B6 Reporting or C4 Document platforms.

**Required deliverables**

- Regulatory finance schedule contract and jurisdiction/effective-version rules.
- Audit pack manifest containing source, policy, approval, posting, reconciliation, close, and output evidence.
- Sign-off, retention, legal-hold, redaction, and access requirements.
- B6 presentation/submission integration boundary.
- C4 future document-storage/rendering requirements.

**Acceptance gate**

No filing or regulator submission is claimed without a separately approved channel and owner. Audit packs are reproducible and tamper-evident.

### B2F14 — Finance Operational Recovery, Data Controls, and Support Trace

**Objective**

Define failure recovery, disable/rollback, retention, privacy, security, diagnostics, and support behavior for Finance.

**Required deliverables**

- Finance operational recovery runbook.
- Incident taxonomy and owner/stop-condition matrix.
- Disable controls that stop new Finance admission without rewriting A5/B1/A6/A7 history.
- Retention, legal hold, minimization, access, encryption/tokenization, and support projection.
- C2 observability requirements without implementing C2.
- Recovery tests for duplicate, timeout, unknown, period lock, posting mismatch, close failure, and reconciliation backlog.

**Acceptance gate**

Recovery preserves immutable history and never clears a discrepancy through unapproved mutation.

### B2F15 — Finance Integration Certification, Release Gate, and B3 Treasury Handoff

**Objective**

Certify the B2 Finance Platform and prepare a bounded handoff to B3 Treasury without beginning Treasury, later platforms, Frontend, C2, or D1.

**Required deliverables**

- B2 Finance integration matrix.
- ADR review status.
- Finance exit checklist and approval package.
- End-to-end B1/A6/A7 source→B2 treatment/control→A5 posting→B2 reconciliation/close/output trace.
- Finance operational-recovery evidence.
- B2 Finance→B3 Treasury handoff package.
- Explicit unresolved blockers and no-go/go decision.

**Acceptance gate**

Architecture, Engineering, Finance, Ledger, Tax, Security, Privacy, Legal, Risk, Compliance, Audit, Operations, Reconciliation, Support, and applicable product/commercial owners approve their evidence. Fixture completion is not live certification.

**Explicit non-goals:** Treasury implementation, merchant platform, reporting platform, statement platform, configuration platform, IAM administration, developer/public APIs, observability platform, frontend, scale/extraction, or later E platforms.

## 5. Cross-task evidence requirements

Every implementation task must include, as applicable:

- approved ADR and owner;
- source-of-truth and prohibited-edge matrix;
- additive migration and rollback/forward-recovery plan;
- unit, integration, property, concurrency, replay, and failure tests;
- no-floating-point-money validation;
- A5 posting/reconciliation evidence for monetary effects;
- audit, idempotency, outbox, and support trace;
- authorization and segregation evidence;
- data classification, retention, legal hold, and secret handling;
- observability requirements without taking C2 ownership;
- disable/rollback behavior preserving history;
- documentation cross-reference validation;
- clean release-gate status with unresolved approvals explicitly blocked.

## 6. Prohibited implementation edges

B2 Finance must not:

- write A5 balances or posted journals directly;
- implement another commercial pricing/billing/fee/commission/promotion/reward decision engine;
- create another external partner adapter;
- create another product lifecycle;
- own merchant lifecycle;
- become B6 reporting, B7 statement delivery, B8 configuration, B9 IAM, or B10 developer integration;
- create a public Finance API or Finance Portal during Phase B2;
- create generic observability, background-processing, document, data, search, secret, or infrastructure platforms;
- begin Treasury, Frontend, D1, or E1–E6;
- rename or rewrite historical B1 or legacy B2 artifacts;
- execute historical B2T11 or B2T12.

## 7. Open planning decisions before B2F01 authorization

- Finance book and accounting-basis scope for the first implementation.
- Exact A5 chart/account identities available for Finance mapping.
- Finance versus B1 ownership of recognition schedules and tax determination methods.
- AR/AP first bounded use case and source event.
- Statutory and regulatory jurisdiction requirements.
- Materiality thresholds and approval owners.
- Whether any existing B1 persistence can be consumed directly without new Finance persistence.
- ADR allocation after ADR-0082 without filling or renumbering historical gaps merely for sequence aesthetics.
- B6/B7 contract shapes for accounting datasets and statement/document delivery.
- B3 Treasury entry requirements.

## 8. Plan status

This plan is **Prepared for architecture review only**. It is not approved for runtime implementation by this reconciliation task. The safest next execution unit is B2F01, and even B2F01 should remain documentation/inventory work until its scope is separately authorized.
