# B2 Finance Platform Boundary

- **Task:** B2R01 — Authoritative Platform Roadmap and B2 Finance Reconciliation
- **Platform:** B2 — Finance Platform
- **Status:** Preliminary architecture boundary; implementation not started
- **Authority:** [`AUTHORITATIVE-PLATFORM-ROADMAP.md`](AUTHORITATIVE-PLATFORM-ROADMAP.md)
- **Implementation plan:** [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md)

This document defines the authoritative B2 Finance Platform boundary. It creates no controller, service, entity, migration, route, API, scheduler, posting, journal, accounting record, or runtime behavior.

## 1. Objective

B2 Finance provides governed finance accounting and control capabilities over approved business facts while preserving A5 Ledger as the monetary/value authority. It establishes the finance accounting model, finance books and calendars, controlled interfaces, receivables/payables, recognition/accounting treatment, close, controls, reconciliation, official accounting outputs, and audit evidence required by Finance.

B2 Finance consumes approved facts from B1 Commercial, A6 External Partners, A7 Product Layer, and other canonical sources. It must never derive a competing commercial price, product lifecycle, partner outcome, merchant lifecycle, authorization decision, or ledger balance.

## 2. Finance authority statement

B2 Finance is authoritative for the following, subject to approved Finance and accounting-policy decisions:

- finance accounting policy representation and effective versions;
- finance books, accounting dimensions, fiscal years, accounting periods, and close state;
- finance-owned chart-of-accounts governance and mappings to existing A5 ledger accounts without creating a competing ledger account/value source;
- finance journal requests, classifications, approval evidence, posting-interface status, and correlation to immutable A5 journals;
- accounts-receivable and accounts-payable accounting subledger/control records where approved;
- finance treatment of B1 commercial billing, invoice, revenue-recognition, tax, cost, and financial-effect inputs;
- finance reconciliations between approved source facts, finance records, and A5 ledger facts;
- trial balance and official accounting statement datasets derived from A5 and controlled finance records;
- month-end and year-end close orchestration, evidence, exceptions, and approvals;
- finance controls, segregation of duties, approval policy consumption, audit trails, and audit packs;
- official finance accounting outputs consumed by B6 Reporting, B7 Statement, Treasury, compliance, and regulatory processes through read-only contracts.

B2 Finance is not automatically authoritative for tax law interpretation, statutory filing submission, consolidated enterprise reporting presentation, customer statement delivery, treasury position, or external API exposure. Those responsibilities require the boundaries below.

## 3. Hard boundaries with existing and future platforms

### 3.1 A5 Ledger — monetary and value authority

A5 Ledger remains the sole monetary/value authority for:

- ledger accounts and balances;
- journal posting and posting invariants;
- debit/credit balance enforcement;
- currency and accounting-unit invariants;
- posted journal and line immutability;
- compensating entries and approved correction mechanics;
- monetary transaction correlation;
- authoritative trial-balance source facts at ledger-account level.

B2 Finance may:

- define finance accounting classifications and mappings;
- prepare and approve a finance posting request;
- submit a validated posting instruction through an approved A5 interface;
- record the A5 journal reference and posting outcome;
- reconcile finance expectations to A5 journals and balances read-only.

B2 Finance must not:

- update balances directly;
- create a second posting engine;
- edit posted journals or lines;
- treat a receivable, payable, invoice, close item, report, or finance approval as proof that value moved;
- clear an imbalance by mutating source or ledger history;
- maintain a shadow monetary balance that competes with A5.

Any correction uses a new approved A5 compensating entry. Finance records the reason, approval, and correlation; A5 owns the value change.

### 3.2 B1 Commercial Platform — commercial-decision authority

B1 remains authoritative for:

- commercial catalog, plans, tiers, entitlements, packaging, and bundles;
- price, fee, commission, and revenue-sharing decisions;
- promotion, campaign, coupon, referral, cashback, and loyalty decisions;
- commercial billing/invoice/statement inputs already implemented within their bounded contracts;
- commercial revenue-recognition, tax/VAT, cost-accounting, profitability, analytics, and reconciliation inputs already implemented within their bounded contracts.

B2 Finance consumes B1 decisions and evidence. It must not recalculate price, fee, commission, discount, promotion, reward, plan, entitlement, or commercial treatment as a second B1 authority.

Where accounting treatment is required, B2 Finance owns the finance policy application, accounting entry request, finance period, receivable/payable classification, accounting recognition status, and official accounting correlation. The original B1 decision remains immutable source evidence.

### 3.3 A6 External Partners

A6 remains authoritative for:

- partner identity and adapter behavior;
- external operation and callback lifecycle;
- partner references and authenticity/replay controls;
- settlement/suspense integration facts;
- external statements/reports and partner reconciliation inputs;
- ambiguous external outcomes and partner circuit breakers.

B2 Finance may account for verified A6 facts and reconcile them to finance and A5 records. It must not call partners through a second adapter, forge settlement evidence, clear A6 suspense, or repair A6 records.

### 3.4 A7 Product Layer

A7 remains authoritative for:

- product catalog and product boundary;
- product command and operation lifecycle;
- product-specific policy/binding consumption;
- product financial-effect requests;
- product reconciliation and product support trace.

B2 Finance accounts for approved product/commercial facts. It must not become a product catalog, product state machine, or product command authority.

### 3.5 B5 Merchant Platform

B5 owns merchant and agent lifecycle, onboarding, verification, servicing, and merchant-domain operations. Existing legacy B2T04 readiness artifacts are preserved inputs to B5 under [`PLATFORM-ARTIFACT-CLASSIFICATION.md`](PLATFORM-ARTIFACT-CLASSIFICATION.md).

B2 Finance may own merchant receivable/payable accounting records and settlement-accounting treatment, but it must consume canonical merchant identity/lifecycle from B5 and must not activate, suspend, or verify merchants.

### 3.6 B6 Reporting Platform

B6 owns consolidated reporting projections, report catalogs, report presentation, broad cross-domain aggregation, report scheduling/distribution, and reporting access surfaces.

B2 Finance owns official accounting datasets and signed finance outputs such as trial balance, balance sheet, and profit-and-loss accounting results. B6 consumes those outputs read-only and may combine them with other domains. B6 must not change accounting facts; B2 must not become the general enterprise-reporting platform.

### 3.7 B7 Statement Platform

B7 owns the broad Statement Platform: statement composition/orchestration, lifecycle, rendering integration, delivery integration, statement versioning, and statement access controls.

B2 Finance may produce finance statement datasets and accounting schedules. Existing B1 statement-generation artifacts remain bounded commercial capabilities. B7 later consumes approved B1/B2/A5 facts and prevents each platform from building a competing statement-delivery system.

### 3.8 B8 Configuration Platform

B8 owns broad governed runtime configuration, configuration distribution, lifecycle, validation, and audit.

B2 Finance owns finance policy and finance master-data semantics. Before B8 exists, B2 may define bounded finance configuration contracts necessary to preserve invariants, but it must not build a general feature-flag/configuration platform. B8 later hosts or distributes broadly reusable configuration without becoming the finance-policy decision owner.

### 3.9 B9 Identity & Access Administration

B9 owns administrative IAM, role and entitlement administration, access reviews, privileged access governance, and administrative identity lifecycle.

B2 Finance defines finance roles, segregation-of-duties constraints, and required approval capabilities as policy inputs. A2 enforces authorization; B9 administers access; B2 records finance approval evidence. B2 must not create a second IAM or credential store.

### 3.10 B10 Developer & Integration Platform

B10 owns:

- public APIs;
- developer applications and API consumers;
- developer credentials;
- webhooks;
- sandbox;
- SDKs;
- API analytics;
- quotas and rate limits;
- API versioning and documentation;
- Developer Portal backend capabilities.

The preserved legacy B2T01–B2T10 artifacts are predominantly B10 foundations. B2 Finance exposes no public/developer API directly. Any future external Finance API is published through B10 after B2 provides an approved internal contract and after A2/B9 controls are satisfied.

## 4. Existing B1 capabilities with finance implications

The current B1 implementation deliberately includes commercial capabilities with finance implications. Reconciliation must preserve them and define bounded integration rather than move them automatically.

| Existing B1 capability            | Existing B1 responsibility retained                                                                  | B2 Finance responsibility                                                                                                                                  | B6/B7 relationship                                                                                  | Boundary decision                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Billing engine                    | Commercial billing decision/document input derived from B1 plan, fee, campaign, and reward decisions | Receivable/payable classification, accounting treatment, finance period, posting request, control account, settlement status, and A5 correlation           | B6 may report billing aggregates; B7 may render/deliver a statement or bill artifact where approved | **Bounded B1→B2 integration**; do not create a second billing-decision engine              |
| Invoice engine                    | Commercial invoice identity/content and bounded B1 invoice document/evidence                         | Finance invoice accounting status, AR/AP recognition, aging, settlement/accounting correlation, write-off/credit approval evidence                         | B7 owns broad statement/document lifecycle; C4 later provides shared document infrastructure        | **Bounded integration**; an invoice is not itself an A5 posting                            |
| Revenue recognition               | B1 commercial recognition decision/input based on commercial contract facts                          | Authoritative accounting recognition schedule/status, period allocation, posting request, reversals/adjustments, and close treatment under approved policy | B6 consumes official recognized-revenue outputs                                                     | **B1 decision/input + B2 accounting authority**                                            |
| Tax/VAT engine                    | B1 commercial tax determination/input tied to commercial transaction context                         | Tax accounting liability/receivable classification, tax control-account posting request, period, reconciliation, settlement evidence, and audit schedule   | B6 reports approved tax outputs; regulatory filing integration requires separate review             | **B1 determination input + B2 tax-accounting authority**; no duplicate tax calculator      |
| Cost accounting                   | B1 commercial cost/allocation input and commercial context                                           | Finance cost classification, allocation policy application where Finance-owned, accounting period, cost-center/account mapping, and A5 posting correlation | B6 presents consolidated cost analytics                                                             | **Bounded integration**; ownership of each allocation method must be explicit              |
| Commercial financial effects      | B1 approved commercial financial-effect intent and correlation                                       | Validate accounting treatment and issue an approved finance posting request through A5                                                                     | B6 reports outcomes                                                                                 | **B1 intent → B2 finance interface → A5 posting**                                          |
| Commercial reconciliation         | Compare B1 decisions/documents to commercial effects and expected downstream evidence                | Reconcile finance books/subledgers/posting expectations to A5 and approved source evidence; classify finance breaks                                        | B6 consumes reconciliation status projections                                                       | **Separate scopes with linked evidence**, never two writers repairing the same source      |
| Profitability/financial analytics | B1 product/customer/plan commercial profitability inputs and commercial analytics                    | Official accounting P&L classifications and finance-approved profitability basis where required                                                            | B6 owns consolidated reporting and presentation                                                     | **B1 commercial analytics + B2 accounting facts + B6 projection**                          |
| Statement generation              | Existing bounded B1 commercial statement/document capability remains valid                           | Produce finance statement datasets, schedules, and signed accounting outputs, not broad delivery                                                           | B7 owns the broad Statement Platform and delivery orchestration                                     | **Preserve B1 bounded capability; B7 becomes platform owner; B2 supplies accounting data** |

### 4.1 Required per-capability review

Before implementing a corresponding B2 Finance task, Architecture and Finance must inspect the exact B1 types, entities, services, migrations, ADRs, and tests and record:

1. the immutable B1 source decision;
2. the finance accounting event or treatment triggered by it;
3. the A5 account/journal interface and correlation;
4. the owner of correction and reversal;
5. the reconciliation comparison and discrepancy owner;
6. the B6/B7 projection or delivery boundary;
7. retention, legal hold, data classification, and support trace;
8. idempotency and replay mapping that does not reuse a scope incorrectly;
9. whether no new persistence is necessary because an existing authority is sufficient.

## 5. Preliminary Finance domain model concepts

These are planning concepts, not approved entities or tables:

- Finance Book
- Chart of Accounts Mapping
- Accounting Policy Version
- Fiscal Year
- Accounting Period
- Finance Journal Request
- Finance Journal Approval
- A5 Posting Correlation
- Receivable
- Payable
- Recognition Schedule
- Tax Accounting Item
- Cost Accounting Allocation
- Finance Reconciliation Run/Break
- Close Checklist/Run/Exception
- Trial Balance Snapshot
- Finance Statement Dataset
- Regulatory Finance Schedule
- Finance Audit Pack
- Finance Control Evidence

Names, storage, aggregate boundaries, and whether each requires persistence remain future ADR decisions. This list grants no permission to create them now.

## 6. Core invariants

1. Every monetary amount is represented using existing money/currency conventions; no floating-point money.
2. Every posted value resolves to an immutable A5 journal and lines.
3. Finance records never claim posting success without an A5 journal reference and verified outcome.
4. A B1 commercial decision is consumed, never recalculated or overwritten.
5. A6 settlement and partner evidence are consumed read-only.
6. A7 product state is consumed read-only.
7. Every finance accounting treatment records policy version, effective period, source evidence, approvals, and correlation.
8. Closed periods fail closed; reopening requires privileged, segregated, audited approval.
9. Corrections use additive adjustment/compensating facts, never destructive history edits.
10. Trial balance and statements reconcile to A5 and declare timing/classification exceptions.
11. Receivable/payable state is not treated as cash or ledger balance.
12. Close cannot hide unresolved breaks; exceptions have owner, materiality, and disposition.
13. B6/B7 projections cannot mutate Finance or Ledger sources.
14. B10 exposure cannot bypass Finance, A2, B9, or data-minimization controls.
15. Existing B1 and legacy B2 technical identifiers remain unchanged.

## 7. Explicit non-goals

B2 Finance does not implement or own:

- ledger posting internals or balances;
- commercial pricing/fee/commission/promotion/reward decisions;
- product lifecycle;
- external partner adapters or callback authenticity;
- treasury position, liquidity, or cash management;
- merchant/agent lifecycle;
- general reporting platform;
- general statement delivery platform;
- general runtime configuration platform;
- administrative IAM;
- public APIs, developer credentials, webhooks, sandbox, SDKs, API analytics, or Developer Portal;
- observability platform;
- service extraction, multi-region, multi-tenancy, white label, or horizontal scaling;
- frontend Finance Portal;
- FX, card, lending, savings/investment, insurance, or international remittance platforms.

## 8. Entry conditions for B2 Finance implementation

Implementation may begin only after:

- this boundary and the preliminary plan are reviewed;
- B1 finance-implication capabilities are inventoried at type/entity/service/migration level;
- A5 posting and account ownership contracts are confirmed;
- Finance approves accounting policy, chart strategy, fiscal calendar, materiality, and close ownership;
- Architecture approves no-duplicate-authority mappings;
- Security and B9-facing reviewers approve finance role/segregation requirements without creating IAM;
- Tax/Legal/Compliance review the tax and regulatory boundaries;
- Reconciliation and Operations approve discrepancy and recovery ownership;
- any required ADR range is allocated without renumbering existing ADRs;
- a first bounded implementation task from the B2F plan is explicitly authorized.

## 9. Exit direction

A completed B2 Finance Platform will hand governed finance facts and controls to B3 Treasury without implementing Treasury. It will later provide read-only official accounting outputs to B6 Reporting and B7 Statement, administrative requirements to B9, and approved integration contracts to B10. C2 observability, Frontend, and D1 scaling remain later roadmap work.
