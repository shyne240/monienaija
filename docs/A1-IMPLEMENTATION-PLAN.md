# A1 Foundation Consolidation — Implementation Plan

- Phase: A1 Foundation Consolidation
- Status: Planned
- Scope: Documentation and architecture consolidation only
- Implementation order: First Architecture phase after the completed Customer Foundation

## 1. Purpose of A1

A1 establishes the permanent architectural baseline before runtime identity, financial-account binding, policy enforcement, or financial activation begins.

A1 will:

- Confirm the M0-M9 and P1.0-P1.10 baseline.
- Preserve the original Product Roadmap P1.0-P1.15.
- Reconcile ADR-0001 through ADR-0019.
- Reconstruct missing ADR-0012.
- Identify authoritative owners for every major domain concept.
- Resolve overlapping customer, wallet, risk, beneficiary, authentication, and compliance models.
- Define identifier, reference, correlation, privacy, and retention boundaries.
- Establish the dependencies and exit gates for A2-A8.

A1 does not implement runtime features. It does not add APIs, entities, controllers, services, DTOs, migrations, tests, modules, or configuration.

## 2. Execution rules

- All A1 tasks are documentation-only.
- No application code is modified.
- No database migration is generated.
- No API contract is changed.
- No existing module is refactored.
- No new module is created.
- ADR-0001 through ADR-0019 remain cross-referenced and are not silently replaced.
- The original Product Roadmap P1.0-P1.15 remains unchanged.
- Architecture phases use A1-A8 terminology only.
- Every task must leave a reviewable artifact.
- Every decision must identify an authoritative owner, affected dependencies, and future phase.
- A1 approval is required before A2 work begins.

## 3. Task classification

All tasks A1T01-A1T14 are documentation-only.

- **Existing modules modified:** None.
- **New application modules created:** None.
- **Application code required:** None.
- **New ADR documents:** ADR-0012 reconstruction and proposed ADR-0020 through ADR-0024.
- **Existing documentation updated:** Roadmap, phase, implementation-order, dependency graph, architecture inventory, ownership matrix, and Architecture phase plan.

## 4. Complete optimized task breakdown

### A1T01 — Baseline and ADR Inventory

- **Merged original tasks:** A1T01, A1T02
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** No
- **Estimate:** 30 minutes

#### Objective

Establish the authoritative A1 starting point and complete the ADR chronology.

#### Scope

- Current branch and migration head.
- M0-M9 and P1.0-P1.10 completion state.
- ADR-0001 through ADR-0019.
- ADR status and owners.
- Missing ADR numbers.
- Existing canonical documentation.

#### Deliverables

- A1 baseline checklist.
- ADR status matrix.
- ADR-to-phase dependency inventory.
- Explicit determination of ADR-0012 status.

#### Dependencies

None.

#### Acceptance criteria

- M0-M9 and P1.0-P1.10 are recorded as completed baselines.
- Current migration head is recorded.
- ADR-0012 is confirmed missing or located.
- ADR-0004 through ADR-0011 proposed statuses are documented.
- ADR-0013 through ADR-0019 are mapped to future Architecture phases.
- No source file is changed.

#### Expected tests

- ADR file existence check.
- Migration-head documentation check.
- Stale terminology search.
- Markdown link check.

### A1T02 — Platform and Customer Foundation Inventory

- **Merged original tasks:** A1T03, A1T04
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** No
- **Estimate:** 25 minutes

#### Objective

Record what M0-M9 and P1.0-P1.10 already provide and prevent Product and Architecture roadmaps from being conflated.

#### Scope

- M0-M9 engineering and financial foundations.
- P1.0 product governance.
- P1.1-P1.10 Customer Foundation.
- Original Product Roadmap P1.0-P1.15.
- Customer Foundation versus Product Roadmap naming.

#### Deliverables

- M0-M9 capability matrix.
- P1.0-P1.10 completion matrix.
- Original Product Roadmap preservation section.
- Product-track versus Architecture-track explanation.

#### Dependencies

- A1T01.

#### Acceptance criteria

- Original Product Roadmap names remain exact.
- P1.0-P1.10 Customer Foundation is documented separately.
- M0-M9 remains the Engineering and Financial Core.
- No Product Roadmap milestone is renumbered.
- Future Architecture phases are not described as Product Roadmap milestones.

#### Expected tests

- Exact Product Roadmap name comparison.
- Documentation diff review.
- Stale A1-A8 terminology check.

### A1T03 — Module, Schema, and API Inventory

- **Merged original tasks:** A1T05, A1T06, A1T07
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** No
- **Estimate:** 30 minutes

#### Objective

Create one current-state inventory of bounded contexts, database authorities, migrations, and API route ownership.

#### Scope

- NestJS modules.
- Controllers and route prefixes.
- PostgreSQL tables and migrations.
- Foreign keys and unique constraints.
- Soft-deletion and version columns.
- Duplicate route combinations.
- Internal versus future-public APIs.

#### Deliverables

- Module-to-domain matrix.
- Table-to-authority matrix.
- Migration-to-domain map.
- Route ownership matrix.
- Duplicate route report.
- Internal-route exposure report.

#### Dependencies

- A1T01.
- A1T02.

#### Acceptance criteria

- Every major module has an identified owner.
- Every major table has an identified authority.
- Financial and customer metadata domains are distinguished.
- Existing beneficiary and risk overlaps are recorded.
- Every HTTP method/path combination has one owner.
- Unauthenticated internal routes are marked as not production-public.
- No source code is modified.

#### Expected tests

- Source-directory inventory.
- Migration filename/table scan.
- Static controller route scan.
- Link and terminology check.

### A1T04 — Cross-Cutting Contract and Trust-Boundary Inventory

- **Original task retained:** A1T08
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** No
- **Estimate:** 25 minutes

#### Objective

Document the shared operational contracts that all future Architecture phases must reuse.

#### Scope

- Audit.
- Idempotency.
- Outbox.
- Metrics.
- Diagnostics.
- Reconciliation.
- Request, correlation, and trace context.
- Error envelopes.
- Migration readiness.
- Shutdown and request draining.
- Existing trust boundaries.

#### Deliverables

- Cross-cutting contract matrix.
- Trust-boundary map.
- Future-phase usage rules.
- List of prohibited duplicate implementations.

#### Dependencies

- A1T02.
- A1T03.

#### Acceptance criteria

- Operations owns audit, idempotency, outbox, metrics, and diagnostics.
- Reconciliation remains independent from application services.
- Ledger remains the sole financial source of truth.
- Future Architecture phases reference existing primitives.
- Missing authentication and authorization boundaries are explicit.

#### Expected tests

- Cross-reference review against ADR-0003, ADR-0005, ADR-0008, ADR-0009, and ADR-0010.
- Contract completeness checklist.

### A1T05 — Customer and Adjacent Model Overlap Review

- **Merged original tasks:** A1T09, A1T10, A1T12, A1T13
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes — ADR-0021 and ADR-0024 inputs
- **Estimate:** 30 minutes

#### Objective

Review overlapping Customer Foundation and adjacent financial/security models in one authority workshop.

#### Scope

- Customer identity and profile.
- Customer-wallet metadata versus financial wallet.
- Ledger wallet and ledger accounts.
- Legacy beneficiary versus Customer Beneficiary.
- Funding instruments.
- Preferences.
- Authentication metadata.
- Runtime authentication.
- Authorization.
- Device and recovery metadata.

#### Deliverables

- Customer and adjacent-domain overlap report.
- Authority/projection classification.
- Wallet/account binding decision inputs.
- Beneficiary consolidation decision inputs.
- Authentication metadata/runtime boundary decision inputs.
- Data-sensitivity observations.

#### Dependencies

- A1T02.
- A1T03.
- A1T04.

#### Acceptance criteria

- `Customer` is identified as the canonical customer identity owner.
- Ledger remains authoritative for financial accounts and balances.
- Customer wallet metadata is separated from financial wallet state.
- One future transfer-facing beneficiary authority is recommended.
- Authentication metadata is separated from runtime authentication.
- Preferences are separated from notification delivery.
- Ownership, migration, deprecation, and projection recommendations are recorded for each overlap.

#### Expected tests

- Cross-domain model comparison.
- Source-of-truth decision checklist.
- Ownership-matrix coverage review.

### A1T06 — Risk, Eligibility, and Compliance Authority Review

- **Original task retained:** A1T11
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes — ADR-0022 input
- **Estimate:** 25 minutes

#### Objective

Define how eligibility, restrictions, risk assessments, compliance cases, and future policy decisions relate.

#### Scope

- P1.3 eligibility and restrictions.
- P1.3 eligibility-era risk metadata.
- P1.9 compliance cases.
- P1.10 risk assessments and factors.
- Future capability decisions.
- Decision precedence.

#### Deliverables

- Risk and compliance authority matrix.
- State precedence scenarios.
- Source-evidence versus decision-output definition.
- A4 policy-engine input package.

#### Dependencies

- A1T02.
- A1T03.
- A1T04.

#### Acceptance criteria

- P1.10 is identified as the preferred manual assessment evidence authority.
- P1.3 remains the source of current eligibility and restrictions until A4.
- Compliance cases are not treated as AML, sanctions, or fraud engines.
- Policy decisions are distinguished from evidence records.
- Contradictory-state scenarios are documented.
- No automated screening or policy engine is implemented.

#### Expected tests

- Risk-state precedence checklist.
- Cross-reference review against ADR-0013, ADR-0014, and P1.10 documentation.

### A1T07 — Identifier, Privacy, and Retention Controls

- **Merged original tasks:** A1T14, A1T15
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes — ADR-0023 and ADR-0024 inputs
- **Estimate:** 25 minutes

#### Objective

Define identifier ownership and data-handling rules together because both govern cross-domain information boundaries.

#### Scope

- Customer UUID and customer reference.
- Wallet and ledger IDs.
- Case numbers.
- Beneficiary and funding-instrument references.
- Event, correlation, and causation IDs.
- Idempotency keys.
- Identity, risk, compliance, credential, device, and financial data classification.
- Retention and legal holds.

#### Deliverables

- Identifier taxonomy.
- Normalization and uniqueness rules.
- Correlation map.
- Data classification matrix.
- Retention ownership matrix.
- External-sharing restrictions.

#### Dependencies

- A1T02.
- A1T03.
- A1T04.

#### Acceptance criteria

- Every identifier has an owner and scope.
- Customer UUID is canonical for customer-owned records.
- Financial identifiers remain owned by financial domains.
- References are not treated as financial truth.
- Sensitive hashes and device identifiers have explicit handling rules.
- Retention, minimization, legal-hold, and external-sharing questions are documented.

#### Expected tests

- Identifier consistency scan.
- Required-concept coverage check.
- Data-classification checklist.

### A1T08 — Canonical Ownership, Roadmap, and Dependency Package

- **Merged original tasks:** A1T16, A1T17, A1T18
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes — ADR-0021 input
- **Estimate:** 30 minutes

#### Objective

Synthesize analysis into the canonical ownership matrix, roadmap mapping, and Architecture dependency graph.

#### Scope

- Canonical ownership of all major concepts.
- Product Roadmap P1.0-P1.15.
- Architecture phases A1-A8.
- M0-M9 to Customer Foundation to Architecture phase evolution.
- ADR-to-phase dependencies.
- Product-to-Architecture dependencies.
- Critical path and prohibited edges.

#### Deliverables

- Updated `CANONICAL-OWNERSHIP-MATRIX.md`.
- Updated `ROADMAP.md`.
- Updated `DEPENDENCY-GRAPH.md`.
- Updated `IMPLEMENTATION-ORDER.md`.
- Architecture phase naming alignment.

#### Dependencies

- A1T05.
- A1T06.
- A1T07.

#### Acceptance criteria

- Product Roadmap names remain unchanged.
- Architecture phases use A1-A8 consistently.
- Every requested major concept has an owner.
- Overlaps include authority, metadata/projection status, and consolidation phase.
- The graph shows A1 before A2-A8.
- A3 and A4 may run in parallel after A1.
- A5 depends on A2, A3, and A4.

#### Expected tests

- Product milestone exact-match check.
- Stale P2 terminology search.
- Graph node/edge review.
- Documentation link check.

### A1T09 — Reconstruct ADR-0012

- **Original task retained:** A1T19
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes
- **Estimate:** 25 minutes

#### Objective

Repair the missing Customer Foundation decision record.

#### Scope

- Customer identity.
- Profile.
- Address.
- Contacts.
- Identity documents.
- KYC metadata.
- UUIDs.
- Soft deletion.
- Optimistic locking.
- Audit.
- Financial boundary.

#### Deliverables

- `docs/ADR/ADR-0012-Customer-Foundation.md`.
- Missing-record determination.
- Decision, alternatives, consequences, dependencies, and verification record.

#### Dependencies

- A1T01.
- A1T02.
- A1T05.
- A1T08.

#### Acceptance criteria

- ADR-0012 is created only because no equivalent record exists.
- It accurately reflects P1.1 behavior.
- It excludes authentication, external KYC, payments, wallets, and ledger writes.
- It cross-references ADR-0001, ADR-0002, ADR-0003, ADR-0008, ADR-0009, ADR-0011, ADR-0013, and ADR-0019.

#### Expected tests

- ADR file existence check.
- Cross-reference check.
- No application tests required.

### A1T10 — Draft ADR-0020 and ADR-0021

- **Merged original tasks:** A1T20, A1T21
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes
- **Estimate:** 30 minutes

#### Objective

Formalize A1 scope and canonical domain ownership.

#### Scope

- A1 Foundation Consolidation boundary.
- Customer and adjacent-domain authorities.
- Metadata and projection rules.
- Shared-read and prohibited-shared-write rules.
- Duplicate model disposition.
- A2-A5 dependency rules.

#### Deliverables

- ADR-0020 — Foundation Closure and Scope Boundary.
- ADR-0021 — Customer Domain Canonical Model and Ownership Rules.
- Decision approval checklist.

#### Dependencies

- A1T05.
- A1T08.
- A1T09.

#### Acceptance criteria

- ADR-0020 defines A1 as consolidation, not feature implementation.
- ADR-0021 gives every major concept one authoritative owner.
- Financial balances remain ledger-owned.
- Projections cannot write to their sources.
- Wallet, beneficiary, risk, and authentication overlaps have dispositions.
- No code, migration, API, or module work is introduced.

#### Expected tests

- ADR structure check.
- Ownership matrix-to-ADR consistency review.

### A1T11 — Draft ADR-0022 and ADR-0023

- **Merged original tasks:** A1T22, A1T23
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes
- **Estimate:** 30 minutes

#### Objective

Formalize future risk/policy authority and identifier conventions as the two major cross-domain contracts.

#### Scope

- Risk, compliance, eligibility, and policy decision authority.
- Source evidence and policy outputs.
- Policy versioning inputs.
- UUIDs, references, case numbers, event IDs, correlation IDs, and idempotency keys.
- Global versus scoped uniqueness.

#### Deliverables

- ADR-0022 — Risk, Compliance, and Eligibility Decision Authority.
- ADR-0023 — Customer Identifier and Reference Conventions.
- A4 policy contract inputs.
- A5 command-correlation inputs.

#### Dependencies

- A1T06.
- A1T07.
- A1T08.

#### Acceptance criteria

- No AML, sanctions, fraud, or transaction-monitoring implementation is included.
- Policy decisions are distinguished from source records.
- Identifier ownership and normalization rules are explicit.
- External identifiers cannot replace internal IDs.
- Idempotency keys have scoped command ownership.
- A4 and A5 dependencies are explicit.

#### Expected tests

- State-precedence scenario review.
- Identifier taxonomy review.
- ADR cross-reference check.

### A1T12 — Draft ADR-0024 Data Classification and Privacy

- **Original task retained:** A1T24
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes
- **Estimate:** 20 minutes

#### Objective

Formalize data classification, minimization, retention, access, and external-sharing rules.

#### Scope

- Customer identity and KYC.
- Risk and compliance.
- Credential and recovery hashes.
- Device metadata.
- Beneficiaries and funding instruments.
- Preferences.
- Audit and event records.
- Financial data.
- Legal holds and external processing.

#### Deliverables

- ADR-0024 — Customer Data Classification, Retention, and Privacy.
- Data-handling decision matrix.
- A2 and A6 privacy inputs.

#### Dependencies

- A1T07.
- A1T08.
- A1T10.
- A1T11.

#### Acceptance criteria

- Plaintext secrets are prohibited.
- Sensitive data categories have owners and retention policies.
- External sharing requires a later approved Architecture phase.
- Audit retention is distinguished from active-record retention.
- Legal and compliance review questions are explicit.

#### Expected tests

- Field-classification checklist.
- ADR and matrix consistency check.

### A1T13 — Consolidated Inventory and Cross-Document Consistency

- **Merged original tasks:** A1T25, A1T26
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** No
- **Estimate:** 30 minutes

#### Objective

Finalize all A1 documentation as one internally consistent architecture package.

#### Scope

- Architecture inventory.
- Ownership matrix.
- Roadmap.
- Architecture phases.
- Implementation order.
- Dependency graph.
- Architecture phase plan.
- ADR-0012 and ADR-0020-0024.
- Links, names, phase references, and Product Roadmap names.

#### Deliverables

- Updated `ARCHITECTURE-INVENTORY.md`.
- Final cross-document reference map.
- Stale-term correction list.
- Broken-link correction list.
- Consolidated architecture decision map.

#### Dependencies

- A1T09.
- A1T10.
- A1T11.
- A1T12.

#### Acceptance criteria

- No P2.x terminology remains.
- A1-A8 names match exactly everywhere.
- Product Roadmap P1.0-P1.15 names match exactly.
- All links resolve.
- No document claims A2-A8 are implemented.
- Current architecture and remaining gaps are consistent across all documents.
- No application code is changed.

#### Expected tests

- Search for stale P2 terminology.
- Markdown link check.
- Prettier check.
- Document-to-matrix completeness check.

### A1T14 — A1 Review Package and Exit Evidence

- **Original task retained:** A1T27
- **Type:** Documentation-only
- **Code impact:** None
- **ADR required:** Yes — ADR-0020 through ADR-0024 review
- **Estimate:** 20 minutes

#### Objective

Prepare A1 for formal architecture approval and A2 entry.

#### Scope

- A1 deliverables.
- Decision log.
- Open risks.
- Accountable owners.
- A2 entry conditions.
- ADR approval state.

#### Deliverables

- A1 exit checklist.
- Decision log.
- Open-risk register.
- A2 entry checklist.
- ADR review status.
- Architecture approval package.

#### Dependencies

- A1T13.

#### Acceptance criteria

- All A1 documents are complete and cross-referenced.
- Every overlap has an owner and disposition.
- A2-A5 dependencies are documented.
- Unresolved items have named owners and decision dates.
- A1 requires no code or migration changes.
- A1 approval is explicitly recorded by accountable owners.

#### Expected tests

- Final documentation review.
- Prettier check.
- Link check.
- Stale terminology check.
- No application tests required.

## 5. Merge decisions

| Optimized task | Merged tasks               | Merge rationale                                                                                                                                                  |
| -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1T01          | A1T01, A1T02               | Baseline capture and ADR inventory are both initial repository-orientation activities and produce one starting-point package.                                    |
| A1T02          | A1T03, A1T04               | M0-M9 and P1.0-P1.10 are sequential milestone inventories and should be analyzed together to prevent Product/Architecture naming confusion.                      |
| A1T03          | A1T05, A1T06, A1T07        | Modules, tables/migrations, and routes are all current-state ownership inventories. One coordinated inventory pass reduces repeated repository traversal.        |
| A1T04          | A1T08 retained             | Cross-cutting contracts are kept separate because audit, idempotency, outbox, reconciliation, and trust-boundary analysis require a distinct operational review. |
| A1T05          | A1T09, A1T10, A1T12, A1T13 | These are all adjacent-domain ownership reviews using the same module/schema/API inventory and culminating in authority/projection decisions.                    |
| A1T06          | A1T11 retained             | Risk, eligibility, and compliance precedence is sufficiently sensitive and complex to require a focused review.                                                  |
| A1T07          | A1T14, A1T15               | Identifier conventions and privacy/retention controls both govern cross-domain information boundaries and form one data-governance package.                      |
| A1T08          | A1T16, A1T17, A1T18        | Ownership, roadmap alignment, and dependency graph are synthesis outputs of the preceding analysis.                                                              |
| A1T09          | A1T19 retained             | Reconstructing a missing ADR requires focused historical and architectural reasoning.                                                                            |
| A1T10          | A1T20, A1T21               | Scope closure and ownership are one foundational ADR package.                                                                                                    |
| A1T11          | A1T22, A1T23               | Risk/policy authority and identifier conventions are the contracts required for future policy and financial commands.                                            |
| A1T12          | A1T24 retained             | Privacy and retention decisions require a dedicated sensitive-data review.                                                                                       |
| A1T13          | A1T25, A1T26               | Consolidating the inventory and checking all documents are one final editorial quality pass.                                                                     |
| A1T14          | A1T27 retained             | Exit evidence and approval must remain independent from documentation production.                                                                                |

## 6. Revised critical path

```text
A1T01
  -> A1T02 / A1T03 / A1T04
  -> A1T05 / A1T06 / A1T07
  -> A1T08
  -> A1T09
  -> A1T10 / A1T11 / A1T12
  -> A1T13
  -> A1T14
```

A1T10, A1T11, and A1T12 can run in parallel after A1T08. A1T13 waits for all three.

## 7. Classification summary

- **Total optimized tasks:** 14.
- **Documentation-only tasks:** A1T01-A1T14.
- **Tasks requiring code:** None.
- **Existing modules modified:** None.
- **New application modules:** None.
- **New ADR work:** ADR-0012 reconstruction and ADR-0020 through ADR-0024 drafts.
- **Existing documentation updated:** Roadmap, phase, implementation-order, dependency graph, architecture inventory, ownership matrix, and Architecture phase plan.

## 8. Exit criteria

A1 is complete only when:

- The original Product Roadmap P1.0-P1.15 is preserved exactly.
- A1-A8 Architecture names are used consistently.
- ADR-0012 is reconstructed and accepted for planning.
- ADR-0020 through ADR-0024 have been drafted and reviewed.
- Canonical ownership is documented for all major models.
- Every overlapping model has an authority, metadata/projection classification, consolidation recommendation, and target phase.
- The architecture inventory reflects the actual repository.
- Dependencies, critical path, parallel work, risks, and rollback strategy are documented.
- No stale P2.x terminology remains.
- A2 entry conditions are explicit.
- Accountable owners approve the A1 exit package.
