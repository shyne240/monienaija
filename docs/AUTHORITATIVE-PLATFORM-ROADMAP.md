# Authoritative Platform Roadmap

- **Task:** B2R01 — Authoritative Platform Roadmap and B2 Finance Reconciliation
- **Status:** Authoritative for all work sequenced after the completed legacy B2T01–B2T10 implementation
- **Effective date:** 2026-08-09
- **Scope:** Platform ordering, platform ownership, legacy-artifact preservation, and future implementation sequencing
- **Supersedes:** The older interpretation in which A8 or B3 meant Scale & Selective Extraction and the older interpretation in which B2 meant Customer Activation and Public Commercial Platform

## 1. Authority and interpretation

This document is the authoritative long-term platform roadmap. If an older roadmap, phase plan, implementation plan, handoff, contract, ADR, identifier, task label, or historical artifact assigns a different future meaning to A8, B2, B3, observability, frontend sequencing, or scale/extraction, this document controls **future sequencing and platform ownership**.

Supersession does not erase implementation history. Existing A1–A7, B1, and legacy B2T01–B2T10 artifacts remain valid evidence within their implemented boundaries. Historical task labels and technical identifiers are preserved under [`PLATFORM-ARTIFACT-CLASSIFICATION.md`](PLATFORM-ARTIFACT-CLASSIFICATION.md). No source file, migration, database object, ADR, contract, test, event, idempotency scope, or reference is renamed by this reconciliation.

The roadmap has exactly the phases and platforms below. This reconciliation does not invent an A8, additional B platform, additional C platform, additional D platform, or additional E platform.

## 2. Authoritative sequence

```text
PHASE A — CORE BANKING FOUNDATION
A1 Identity
  -> A2 Authorization
  -> A3 Customer Binding
  -> A4 Policy
  -> A5 Ledger
  -> A6 External Partners
  -> A7 Product Layer

PHASE B — BUSINESS PLATFORMS
  -> B1 Commercial Platform
  -> B2 Finance Platform
  -> B3 Treasury Platform
  -> B4 Fraud & AML
  -> B5 Merchant Platform
  -> B6 Reporting Platform
  -> B7 Statement Platform
  -> B8 Configuration Platform
  -> B9 Identity & Access Administration
  -> B10 Developer & Integration Platform

PHASE C — INFRASTRUCTURE PLATFORMS
  -> C1 Infrastructure & Provider Integrations
  -> C2 Observability Platform
  -> C3 Data Platform
  -> C4 Document Platform
  -> C5 Secrets & Key Management Platform
  -> C6 Background Processing Platform
  -> C7 Search Platform

FRONTEND
  -> frontend applications only after backend platforms are mature

PHASE D
  -> D1 Scale & Selective Extraction

LATER BUSINESS PLATFORMS
  -> E1 Foreign Exchange
  -> E2 Card
  -> E3 Lending
  -> E4 Savings & Investment
  -> E5 Insurance
  -> E6 International Remittance
```

The arrow establishes the authoritative platform sequence. It does not waive a platform's architecture, security, finance, legal, risk, compliance, operations, reconciliation, support, testing, or release gates. Research and architecture analysis may occur ahead of a gate, but implementation must not silently bypass the preceding platform boundary.

## 3. Phase A — Core Banking Foundation

| Order | Platform              | Authoritative responsibility                                                                                                                          |
| ----: | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
|    A1 | **Identity**          | Canonical identity and identity ownership foundations.                                                                                                |
|    A2 | **Authorization**     | Runtime authentication, authorization, protected trust boundaries, and authorization decisions.                                                       |
|    A3 | **Customer Binding**  | Canonical customer-to-financial-account ownership and binding.                                                                                        |
|    A4 | **Policy**            | Explainable, versioned eligibility, restriction, limit, and policy decisions.                                                                         |
|    A5 | **Ledger**            | Monetary value, journals, ledger accounts, posting invariants, and immutable accounting facts at the core ledger boundary.                            |
|    A6 | **External Partners** | External partner adapters, callbacks, external operations, settlement/suspense integration, and partner reconciliation boundaries.                    |
|    A7 | **Product Layer**     | Product catalog, product commands/lifecycle, product financial-effect requests, product reconciliation, and product-specific integration under A1–A6. |

The completed implementation documents may use longer historical names such as “Runtime Identity & Access,” “Customer-to-Financial Account Binding,” “Capability & Policy Engine,” “Internal Financial Pilot,” “External Partners & Settlement,” or “Product Expansion Infrastructure.” Those documents remain implementation evidence. For future platform classification, they map to A1–A7 above.

There is no authoritative A8. Historical A8 references are superseded for future sequencing; D1 owns Scale & Selective Extraction.

## 4. Phase B — Business Platforms

| Order | Platform                             | Authoritative responsibility                                                                                                                                                                              |
| ----: | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    B1 | **Commercial Platform**              | Commercial catalog, pricing, plans, fees, commissions, promotions, rewards, and commercial decisions/inputs.                                                                                              |
|    B2 | **Finance Platform**                 | Finance accounting model, finance governance, books and periods, finance interfaces, receivables/payables, close, controls, finance reconciliation, and official accounting outputs without replacing A5. |
|    B3 | **Treasury Platform**                | Treasury position, liquidity, cash management, funding, treasury operations, and treasury controls. B3 is not scale/extraction.                                                                           |
|    B4 | **Fraud & AML**                      | Fraud detection/response and anti-money-laundering platform capabilities.                                                                                                                                 |
|    B5 | **Merchant Platform**                | Merchant and agent lifecycle, merchant capabilities, onboarding, servicing, and merchant-domain operations.                                                                                               |
|    B6 | **Reporting Platform**               | Consolidated, governed reporting projections and report delivery surfaces.                                                                                                                                |
|    B7 | **Statement Platform**               | Statement composition, generation orchestration, lifecycle, delivery integration, and statement-domain controls.                                                                                          |
|    B8 | **Configuration Platform**           | Broad governed runtime configuration, configuration lifecycle, validation, distribution, and audit.                                                                                                       |
|    B9 | **Identity & Access Administration** | Administrative IAM, access administration, role/entitlement administration, reviews, and privileged governance.                                                                                           |
|   B10 | **Developer & Integration Platform** | Public APIs, developer applications, credentials, webhooks, sandbox, SDKs, API analytics, quotas/rate limits, versioning, and developer portal backend capabilities.                                      |

The work historically labeled B2T01–B2T10 does not complete B2 Finance. It is preserved and classified primarily as later B10 work, with B5 and shared activation elements, in [`PLATFORM-ARTIFACT-CLASSIFICATION.md`](PLATFORM-ARTIFACT-CLASSIFICATION.md).

## 5. Phase C — Infrastructure Platforms

| Order | Platform                                   | Authoritative responsibility                                                                                       |
| ----: | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
|    C1 | **Infrastructure & Provider Integrations** | Infrastructure platform and reusable provider-integration foundations distinct from A6 business partner authority. |
|    C2 | **Observability Platform**                 | Logs, metrics, traces, diagnostics, alerting, operational telemetry, and observability governance.                 |
|    C3 | **Data Platform**                          | Governed analytical and operational data-platform capabilities.                                                    |
|    C4 | **Document Platform**                      | Shared document storage, lifecycle, rendering foundations, and document controls.                                  |
|    C5 | **Secrets & Key Management Platform**      | Secret and key lifecycle, protected storage, rotation, and access controls.                                        |
|    C6 | **Background Processing Platform**         | Shared scheduling, queueing, worker execution, retry, and background-work controls.                                |
|    C7 | **Search Platform**                        | Shared indexing, search, access filtering, and search operations.                                                  |

C2, not B3, owns Observability Platform work. Infrastructure implementation must preserve the business authority boundaries established in A and B.

## 6. Frontend

Frontend development follows backend platform maturity. The frontend portfolio is:

1. Customer Mobile App
2. Agent App
3. Merchant App
4. Admin Portal
5. Finance Portal
6. Operations Portal
7. Compliance Portal
8. Treasury Portal
9. Developer Portal

This ordering statement is a maturity gate: no historical product-roadmap mention of a portal, mobile channel, PWA, or developer portal authorizes frontend implementation before the required backend platforms are mature.

## 7. Phase D

### D1 — Scale & Selective Extraction

D1 owns:

- Service Extraction
- Modularization
- Plugin Architecture
- White Label
- Multi-Tenant Support
- Multi-Region Deployment
- Horizontal Scaling
- Performance Optimization
- Event-Driven Evolution
- Platform Hardening

D1 replaces the older future-sequencing interpretations “A8 Scale & Selective Extraction” and “B3 Scale & Selective Extraction.” Historical A8/B3 statements remain historical context only and grant no future implementation authority.

## 8. Later business platforms

| Order | Platform                     |
| ----: | ---------------------------- |
|    E1 | **Foreign Exchange**         |
|    E2 | **Card**                     |
|    E3 | **Lending**                  |
|    E4 | **Savings & Investment**     |
|    E5 | **Insurance**                |
|    E6 | **International Remittance** |

These platforms are later work. Existing A7 or historical roadmap references to cards, lending, savings, FX, or remittance do not override this ordering.

## 9. Immediate sequencing decision

The completed sequence recognized by this reconciliation is:

```text
A1–A7 implementation evidence
  -> B1 Commercial Platform implementation evidence
  -> legacy-labeled B2T01–B2T10 implementation evidence preserved and reclassified
  -> B2R01 documentation-only reconciliation
  -> B2 Finance Platform planning and later implementation
```

The next authoritative implementation platform is B2 Finance. The old B2T11 and B2T12 activation tasks must not be executed. The preliminary Finance plan is [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md). This reconciliation itself introduces no runtime behavior.

## 10. Roadmap guardrails

1. A5 remains the monetary and ledger-posting authority.
2. B1 remains the commercial-decision authority.
3. B2 Finance consumes approved commercial and product inputs; it does not recreate B1 or A7.
4. B3 means Treasury, never scale/extraction.
5. B5 owns merchant lifecycle.
6. B6 owns consolidated reporting projections.
7. B7 owns the Statement Platform.
8. B8 owns broad runtime configuration.
9. B9 owns administrative IAM.
10. B10 owns developer and public integration capabilities.
11. C2 owns observability.
12. Frontend waits for backend platform maturity.
13. D1 alone owns Scale & Selective Extraction.
14. Existing technical identifiers are historical facts and are not renamed merely to match roadmap ownership.
15. Reclassification never authorizes duplicate authorities or destructive migration changes.

## 11. Reconciliation package

- [`PLATFORM-ARTIFACT-CLASSIFICATION.md`](PLATFORM-ARTIFACT-CLASSIFICATION.md) — legacy/current-artifact ownership and preservation.
- [`B2-FINANCE-PLATFORM-BOUNDARY.md`](B2-FINANCE-PLATFORM-BOUNDARY.md) — B2 Finance authority and integration boundaries.
- [`B2-FINANCE-IMPLEMENTATION-PLAN.md`](B2-FINANCE-IMPLEMENTATION-PLAN.md) — preliminary future task plan; no implementation.
- [`B2-ROADMAP-RECONCILIATION-HANDOFF.md`](B2-ROADMAP-RECONCILIATION-HANDOFF.md) — transition decision, contradiction register, and next-step gate.
