# A1 Cross-Document Reference Map

- **Task:** A1T13 — Consolidated Inventory and Cross-Document Consistency
- **Status:** Final A1 editorial reference map; A1T14 approval remains separate
- **Application code, API, entity, migration, and configuration changes:** None

## 1. Canonical document authorities

| Document                                                                                                                                     | Canonical responsibility                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md)                                                                                     | Only source of A1 task order, scope, dependencies, and acceptance criteria     |
| [`ROADMAP.md`](ROADMAP.md)                                                                                                                   | Original Product Roadmap P1.0-P1.15 and Product-to-Architecture mapping        |
| [`PHASES.md`](PHASES.md)                                                                                                                     | A1-A8 Architecture phase names and definitions                                 |
| [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md)                                                                                   | Phase objectives, ADR ranges, dependencies, gates, rollback                    |
| [`PLATFORM-CUSTOMER-INVENTORY.md`](PLATFORM-CUSTOMER-INVENTORY.md)                                                                           | M0-M9 and P1.0-P1.10 baseline                                                  |
| [`MODULE-SCHEMA-API-INVENTORY.md`](MODULE-SCHEMA-API-INVENTORY.md)                                                                           | Modules, tables, migrations, routes, authorities, exposure                     |
| [`CROSS-CUTTING-CONTRACTS.md`](CROSS-CUTTING-CONTRACTS.md)                                                                                   | Shared operational contracts and trust boundaries                              |
| [`CUSTOMER-ADJACENT-OVERLAP-REVIEW.md`](CUSTOMER-ADJACENT-OVERLAP-REVIEW.md)                                                                 | Customer and adjacent-domain overlap decisions                                 |
| [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](RISK-COMPLIANCE-AUTHORITY-REVIEW.md)                                                                 | Risk, eligibility, compliance, and policy inputs                               |
| [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)                                                       | Identifier, classification, retention, legal-hold, and sharing controls        |
| [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md)                                                                             | Synthesized authority, projection, target-phase, and prohibited-edge decisions |
| [`DEPENDENCY-GRAPH.md`](DEPENDENCY-GRAPH.md)                                                                                                 | Task, ADR, product, and Architecture phase dependencies                        |
| [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)                                                                                         | A1 internal and A1-A8 execution order                                          |
| [`ARCHITECTURE-INVENTORY.md`](ARCHITECTURE-INVENTORY.md)                                                                                     | Current repository state, authorities, gaps, and invariants                    |
| [`ADR-INVENTORY.md`](ADR-INVENTORY.md)                                                                                                       | ADR-0001 through ADR-0024 status and future register                           |
| [`ADR/ADR-0012-Customer-Foundation.md`](ADR/ADR-0012-Customer-Foundation.md)                                                                 | Reconstructed Customer Foundation decision                                     |
| [`ADR/ADR-0020-Foundation-Closure-and-Scope-Boundary.md`](ADR/ADR-0020-Foundation-Closure-and-Scope-Boundary.md)                             | A1 closure and scope boundary                                                  |
| [`ADR/ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md`](ADR/ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md) | Canonical ownership and prohibited shared writes                               |
| [`ADR/ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md`](ADR/ADR-0022-Risk-Compliance-and-Eligibility-Decision-Authority.md)   | Risk/policy authority                                                          |
| [`ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md)             | Identifier, normalization, uniqueness, correlation, idempotency                |
| [`ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md)   | Classification, retention, privacy, legal holds, external processing           |
| [`A4-POLICY-CONTRACT-INPUTS.md`](A4-POLICY-CONTRACT-INPUTS.md)                                                                               | Future A4 evidence/request/decision contract inputs                            |
| [`A5-COMMAND-CORRELATION-INPUTS.md`](A5-COMMAND-CORRELATION-INPUTS.md)                                                                       | Future A5 command, idempotency, correlation, and recovery inputs               |
| [`DATA-HANDLING-DECISION-MATRIX.md`](DATA-HANDLING-DECISION-MATRIX.md)                                                                       | Field/category handling and retention matrix                                   |
| [`A2-A6-PRIVACY-INPUTS.md`](A2-A6-PRIVACY-INPUTS.md)                                                                                         | A2 access and A6 external-processing privacy inputs                            |

## 2. Exact Architecture phase names

| Phase | Exact name                            |
| ----- | ------------------------------------- |
| A1    | Foundation Consolidation              |
| A2    | Runtime Identity & Access             |
| A3    | Customer-to-Financial Account Binding |
| A4    | Capability & Policy Engine            |
| A5    | Internal Financial Pilot              |
| A6    | External Partners & Settlement        |
| A7    | Product Expansion Infrastructure      |
| A8    | Scale & Selective Extraction          |

## 3. Exact Product Roadmap names

| Milestone | Exact business capability             |
| --------- | ------------------------------------- |
| P1.0      | Product, Regulatory & Launch Envelope |
| P1.1      | Identity & Customer Accounts          |
| P1.2      | KYC & Compliance                      |
| P1.3      | Customer Wallet Experience            |
| P1.4      | Risk & Fraud                          |
| P1.5      | Banking Rails & Settlement            |
| P1.6      | Provider-backed Virtual Accounts      |
| P1.7      | Notifications & Background Jobs       |
| P1.8      | Support, Reporting & Operations       |
| P1.9      | Customer Web Portal                   |
| P1.10     | Admin & Operations Portal             |
| P1.11     | Public APIs & Partner Platform        |
| P1.12     | Cloud, Security & Observability       |
| P1.13     | Android, iOS & PWA                    |
| P1.14     | Controlled Pilot Launch               |
| P1.15     | Product Expansion                     |

## 4. Concept authority map

| Concept                                | Current authority                      | Primary reference            |
| -------------------------------------- | -------------------------------------- | ---------------------------- |
| Customer identity/profile/KYC          | `customer`                             | ADR-0012, ADR-0021, ADR-0023 |
| Onboarding                             | `customer-onboarding`                  | ADR-0013, risk review        |
| Eligibility/restrictions/limits        | `customer-eligibility` until A4        | ADR-0014, ADR-0022           |
| Customer wallet metadata               | `customer-wallet`                      | ADR-0015, ADR-0021           |
| Financial wallet/ledger/balances       | `wallet`/`ledger`                      | ADR-0004, ADR-0021           |
| Funding instruments                    | `customer-funding-instrument`          | ADR-0016, ADR-0021           |
| Beneficiaries                          | `customer-beneficiary` preferred       | ADR-0017, ADR-0021           |
| Preferences                            | `customer-preference`                  | ADR-0018, ADR-0021           |
| Authentication metadata/runtime access | `customer-authentication` / future A2  | ADR-0019, ADR-0024           |
| Risk/compliance/policy                 | source domains / future A4             | ADR-0022, A4 inputs          |
| Identifiers/correlation/idempotency    | owning domains/Operations              | ADR-0023, A5 inputs          |
| Classification/retention/legal holds   | source owner/Security/Compliance/Legal | ADR-0024, data matrix        |
| Audit/outbox/reconciliation            | Operations/Reconciliation              | cross-cutting contracts      |

## 5. Consistency rules

- Product Roadmap names remain exactly P1.0-P1.15.
- Architecture phase names remain exactly A1-A8.
- A2-A8 are future phase boundaries; no A1 document claims they are implemented.
- Customer metadata, references, policy projections, metrics, audit, outbox, and reconciliation views do not become financial truth.
- Proposed/reconstructed ADR status is explicit; proposed is not production approval.
- A1T14 owns final approval, open-risk, decision-date, and A2-entry evidence.

## 6. Validation record

- Product milestone exact-match review: performed.
- Architecture phase naming review: performed.
- Relative-link review: required before A1T13 commit.
- Stale-term review: [`A1-STALE-TERM-CORRECTION-LIST.md`](A1-STALE-TERM-CORRECTION-LIST.md).
- Broken-link review: [`A1-BROKEN-LINK-CORRECTION-LIST.md`](A1-BROKEN-LINK-CORRECTION-LIST.md).
- Consolidated decision map: [`A1-CONSOLIDATED-ARCHITECTURE-DECISION-MAP.md`](A1-CONSOLIDATED-ARCHITECTURE-DECISION-MAP.md).
