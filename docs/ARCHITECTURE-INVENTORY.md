# MonieNaija Architecture Inventory

- **Task:** A1T13 — Consolidated Inventory and Cross-Document Consistency
- **Review point:** M0-M9 and Customer Foundation P1.0-P1.10 present; A1 Foundation Consolidation package drafted for review
- **Purpose:** Single current-state inventory used before A2-A8 Architecture phase design and implementation
- **Application code, API, entity, migration, and configuration changes:** None
- **Consistency package:** [`A1-CROSS-DOCUMENT-REFERENCE-MAP.md`](A1-CROSS-DOCUMENT-REFERENCE-MAP.md), [`A1-STALE-TERM-CORRECTION-LIST.md`](A1-STALE-TERM-CORRECTION-LIST.md), [`A1-BROKEN-LINK-CORRECTION-LIST.md`](A1-BROKEN-LINK-CORRECTION-LIST.md), [`A1-CONSOLIDATED-ARCHITECTURE-DECISION-MAP.md`](A1-CONSOLIDATED-ARCHITECTURE-DECISION-MAP.md)

## 1. Canonical A1 documentation inputs

| Artifact                                                                               | Authority / purpose                                                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md)                               | Only source of A1 task order and scope                                                  |
| [`PLATFORM-CUSTOMER-INVENTORY.md`](PLATFORM-CUSTOMER-INVENTORY.md)                     | M0-M9 and P1.0-P1.10 capability baseline                                                |
| [`MODULE-SCHEMA-API-INVENTORY.md`](MODULE-SCHEMA-API-INVENTORY.md)                     | Current modules, tables, migrations, routes, and exposure                               |
| [`CROSS-CUTTING-CONTRACTS.md`](CROSS-CUTTING-CONTRACTS.md)                             | Shared audit, idempotency, outbox, readiness, reconciliation, and trust contracts       |
| [`CUSTOMER-ADJACENT-OVERLAP-REVIEW.md`](CUSTOMER-ADJACENT-OVERLAP-REVIEW.md)           | Customer, wallet, beneficiary, funding, preference, authentication, and device overlaps |
| [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](RISK-COMPLIANCE-AUTHORITY-REVIEW.md)           | Risk, eligibility, compliance, and policy authority inputs                              |
| [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md) | Identifier, classification, retention, legal-hold, minimization, and sharing controls   |
| [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md)                       | A1T08 owner, projection, target-phase, and prohibited-edge decisions                    |
| [`ROADMAP.md`](ROADMAP.md)                                                             | Product Roadmap P1.0-P1.15 and A1-A8 mapping                                            |
| [`DEPENDENCY-GRAPH.md`](DEPENDENCY-GRAPH.md)                                           | A1 task, ADR, product, and Architecture phase dependencies                              |
| [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)                                   | A1 internal and A1-A8 execution order                                                   |
| [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md)                             | A1-A8 objectives, gates, future ADRs, and rollback strategy                             |
| [`ADR-INVENTORY.md`](ADR-INVENTORY.md)                                                 | ADR status, overlaps, and future decision register                                      |

## 2. Runtime and persistence

| Concern        | Current implementation                                | Constraint / future boundary                                                  |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| HTTP           | NestJS 11 with Fastify                                | Global `/api/v1`; current internal routes are not production-public before A2 |
| Validation     | Global `ValidationPipe`                               | Transform, whitelist, and forbidden unknown properties                        |
| Errors/logging | Global exception filter and Pino                      | Stable context; sensitive fields/headers require redaction                    |
| Shutdown       | Request tracker and shutdown hooks                    | Drain before close with bounded wait                                          |
| Database/ORM   | PostgreSQL and TypeORM                                | `synchronize=false`; migration-only schema; head `1785753600017`              |
| IDs/lifecycle  | UUIDs, soft deletion, versions, append-only histories | Customer UUID is canonical; financial and operational owners remain separate  |

## 3. Operational and financial authorities

- Operations owns immutable audit, scoped idempotency, transactional outbox, metrics, diagnostics, and operational evidence.
- Reconciliation independently checks financial state and does not repair source records.
- Production readiness checks database, migration head, reconciliation, and outbox signals.
- Maturity owns governance reports, retention maintenance, and acceptance evidence.
- Product Governance owns product scope, launch evidence, and readiness records.
- `ledger` owns ledger accounts, journals, lines, balances, and posted financial truth.
- `wallet` owns the ledger-backed financial wallet facade; `customer-wallet` remains provisioning metadata.

## 4. Customer and adjacent authorities

| Domain                                     | Current authority                                      | State                          | Future boundary                      |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------ | ------------------------------------ |
| Customer identity/profile/KYC              | `customer`                                             | P1.1 source/evidence authority | A2 access; A3 binding                |
| Onboarding                                 | `customer-onboarding`                                  | P1.2 workflow evidence         | A4 input                             |
| Eligibility/restrictions/limits/enrollment | `customer-eligibility`                                 | P1.3 current source metadata   | A4 policy; A5 consumer               |
| Customer wallet                            | `customer-wallet`                                      | P1.4 provisioning metadata     | A3 binding                           |
| Funding instruments                        | `customer-funding-instrument`                          | P1.5 registration metadata     | A6 provider boundary                 |
| Beneficiaries                              | `customer-beneficiary` preferred; legacy compatibility | P1.6 metadata overlap          | A5/A6 consolidation                  |
| Preferences                                | `customer-preference`                                  | P1.7 stored intent             | A7 delivery boundary                 |
| Authentication                             | `customer-authentication`                              | P1.8 security metadata         | A2 runtime identity/access           |
| Compliance                                 | `customer-compliance`                                  | P1.9 case management           | A4 policy input; no screening engine |
| Risk                                       | `customer-risk-profile` preferred for manual evidence  | P1.10 assessment evidence      | A4 policy input                      |

## 5. ADR and A1 decision state

| ADR range     | State                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| ADR-0001-0003 | Accepted architectural, money, and durable-event foundations                      |
| ADR-0004-0011 | Proposed financial, resilience, production, maturity, and governance decisions    |
| ADR-0012      | Reconstructed Customer Foundation decision                                        |
| ADR-0013-0019 | Accepted Customer Foundation decisions with future-phase boundaries               |
| ADR-0020-0021 | Drafted A1 scope and canonical ownership decisions; proposed for review           |
| ADR-0022-0023 | Drafted risk/policy and identifier decisions; proposed for review                 |
| ADR-0024      | Drafted data classification, retention, and privacy decision; proposed for review |

Proposed/reconstructed ADRs are not production approval. A1T14 remains responsible for the final review package and accountable approval record.

## 6. Architecture gaps and target phases

1. Runtime authentication, authorization, sessions, privileged access, and protected routes remain A2 work.
2. Customer-wallet metadata is not canonically bound to financial accounts; A3 owns binding, repair, and reconciliation.
3. No centralized versioned capability policy exists; A4 owns policy implementation and precedence.
4. P1.3/P1.10 risk vocabulary and precedence require explicit A4 mapping.
5. P1.6/legacy beneficiary consolidation remains before transfer-facing A5 work.
6. No external bank/NIBSS/provider adapter, callback, settlement, or partner reconciliation boundary exists; A6 owns it.
7. Outbox facts exist without broker/publisher/inbox delivery; later phases own delivery/replay.
8. Privacy classification, retention schedules, legal holds, and A2/A6 enforcement remain subject to proposed ADR-0024 and owner approval.
9. A1T14 must record approval status, open-risk owners, decision dates, and A2 entry conditions.

## 7. Non-negotiable invariants

- Ledger is the only authoritative financial record.
- Posted journals and lines are immutable; corrections use compensating entries.
- Customer metadata cannot mutate balances.
- References, provider IDs, projections, dashboards, and policy outputs do not replace source truth.
- Financial commands require authorization, idempotency, audit, and reconciliation contracts before activation.
- External ambiguity enters pending/recovery/reconciliation, never silent success.
- A2-A8 runtime capabilities are not claimed as implemented by this inventory.
