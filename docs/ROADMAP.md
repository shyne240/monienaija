# MonieNaija Architecture and Product Roadmap

- Status: Canonical post-Customer-Foundation roadmap
- Last reviewed: 2026-08-04
- Scope: Remaining platform evolution after P1.0-P1.10
- Authority: Engineering, Security, Risk, Finance, Operations, Product, Compliance, and accountable release owners

## 1. Purpose

This document is the single source of truth for the architectural phase after the completed Customer Foundation. It governs sequencing, dependencies, ADR work, release gates, and long-term product expansion.

The roadmap is a set of decision gates, not a delivery promise. Code completion is not sufficient for a phase to exit. Each phase requires evidence, operational ownership, risk acceptance, and applicable legal or regulatory review.

## 2. Current state

MonieNaija is a domain-oriented NestJS modular monolith backed by PostgreSQL and TypeORM. The platform includes:

- M0-M9 engineering, financial, resilience, production, maturity, and governance foundations.
- P1.0 product governance.
- P1.1-P1.10 customer foundation.
- A ledger-centred financial core.
- PostgreSQL-backed audit, idempotency, outbox, metrics, diagnostics, and readiness primitives.

The Customer Foundation is complete as a metadata and lifecycle domain. It is not yet a production customer-access trust boundary and is not yet canonically bound to the ledger-backed financial wallet.

## 3. Completed Customer Foundation

| Milestone | Completed capability                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.0      | Product governance, product scope, launch envelope, configuration, ownership, and readiness evidence.                                                                                                               |
| P1.1      | Customer identity, profile, address, contacts, identity-document metadata, KYC assessment metadata, UUID customers, soft deletion, optimistic versioning, and audit.                                                |
| P1.2      | Onboarding lifecycle, agreements, risk-profile metadata, tasks, approval decisions, readiness, and completion gates.                                                                                                |
| P1.3      | Eligibility, limits, product enrollment, operating permissions, restrictions, and operating-status decisions.                                                                                                       |
| P1.4      | Customer-wallet provisioning metadata, ownership, aliases, wallet lifecycle, and provisioning history without ledger interaction.                                                                                   |
| P1.5      | Funding-instrument metadata, hash-independent verification metadata, ownership, lifecycle, and history without external providers.                                                                                  |
| P1.6      | Beneficiary and trusted-recipient metadata, destination deduplication, ownership, verification, lifecycle, and history without transfer execution.                                                                  |
| P1.7      | Language, theme, notification, and security preference metadata with versioned history.                                                                                                                             |
| P1.8      | Password hash metadata, password history and rotation, expiry, failed-authentication counters, locks, reset metadata, MFA metadata, trusted devices, recovery codes, and security events without login or delivery. |
| P1.9      | Compliance case lifecycle, assignments, comments, evidence metadata, resolution, closure, and append-only history.                                                                                                  |
| P1.10     | Manual risk assessments, risk factors, reassessment snapshots, factor history, review dates, and closed-profile protection.                                                                                         |

## 4. Architectural decision

The next phase is **P2 — Controlled Customer Activation**.

P2 must not begin with another isolated metadata module. It must establish the trust and ownership boundaries that connect the Customer Foundation to the existing financial core safely:

1. Close and consolidate the Customer Foundation architecture.
2. Establish runtime identity, authentication, and authorization.
3. Bind customer-wallet metadata to ledger-backed financial accounts.
4. Establish one canonical capability and policy decision layer.
5. Activate one narrowly bounded internal financial flow.
6. Add external rails and product capabilities only after internal proof.
7. Scale or extract services only from measured evidence.

## 5. Roadmap phases

| Order | Phase                                                     | Primary result                                                                                              | Required before                                       |
| ----: | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
|     0 | P2.0 Foundation Closure and Model Consolidation           | Canonical ownership, identity, risk, wallet, beneficiary, and compliance boundaries.                        | Any P2 implementation that changes runtime authority. |
|     1 | P2.1 Identity and Access Trust Boundary                   | Protected customer, operator, and internal APIs.                                                            | Customer-facing or financial activation.              |
|     2 | P2.2 Customer-to-Financial Account Binding                | One canonical mapping from customer-wallet metadata to ledger-backed accounts.                              | Customer-aware money movement.                        |
|     3 | P2.3 Capability and Risk Policy Authority                 | Explainable, versioned product-access decisions.                                                            | Product or payment command execution.                 |
|     4 | P2.4 Controlled Internal Financial Pilot                  | One internal money-moving flow with authorization, ledger posting, idempotency, outbox, and reconciliation. | External rails or broad customer rollout.             |
|     5 | P2.5 External Partner and Settlement Boundary             | Isolated bank, NIBSS, funding, callback, and settlement integration.                                        | External customer money movement.                     |
|     6 | P2.6 Product-Specific Expansion                           | Virtual accounts, bills, QR, agents, cards, payroll, savings, and other products one at a time.             | Product-specific governance and partner gates.        |
|     7 | P2.7 Scale, Regional Resilience, and Selective Extraction | Evidence-led scaling, recovery, regional strategy, and service extraction where justified.                  | High-volume production expansion.                     |

Detailed phase definitions are in [`PHASES.md`](PHASES.md). The mandatory sequence is in [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md).

## 6. Critical architectural gaps

1. **No runtime authentication or authorization:** P1.8 stores metadata only. Existing internal APIs must remain protected by deployment/network controls until P2.1.
2. **No canonical customer-to-ledger mapping:** P1.4 `CustomerWallet` is intentionally separate from the ledger-backed `WalletAccount`.
3. **Overlapping risk models:** P1.3 contains an eligibility-era risk representation while P1.10 contains manual risk-assessment records. P2.0 must define authority and projection rules.
4. **Overlapping beneficiary models:** the pre-Customer-Foundation M6 beneficiary module and P1.6 customer-beneficiary module have different ownership and lifecycle semantics. P2.0 must designate the canonical model for future transfers.
5. **No central capability-policy authority:** P1.3 produces eligibility and operating decisions, but financial domains do not yet consume one versioned, explainable policy decision.
6. **No customer-aware financial command boundary:** the existing financial core predates the Customer Foundation and must not infer customer authorization from opaque references.
7. **External settlement boundary is not implemented:** P1.5 registers instruments only; banks and NIBSS remain out of scope.
8. **Governance status is incomplete:** ADR-0004 through ADR-0011 remain proposed for domain review, and ADR-0012 was missing and is reconstructed by this roadmap package.

## 7. Phase gates

No phase may pass its gate without:

- Approved scope and ADRs.
- A threat, privacy, and operational risk review where applicable.
- DTO and domain validation.
- PostgreSQL migration evidence.
- Immutable audit evidence.
- Idempotency and optimistic-lock evidence where mutations can be retried.
- Rollback and recovery procedures.
- Metrics, diagnostics, and support ownership.
- Reconciliation evidence for any financial state.
- Product governance and legal/compliance sign-off where customer money or regulated activity is affected.

## 8. Long-term product roadmap

Long-term product delivery follows this order:

1. Protected customer and operator access.
2. Canonical financial-account binding.
3. Internal customer-to-customer transfer pilot.
4. Controlled internal funding and withdrawal pilot.
5. Bank/NIBSS and settlement integrations.
6. Virtual accounts and external funding instruments.
7. Bills, airtime, QR, merchant, and agent channels.
8. Cards, payroll, bulk payments, and business products.
9. Savings, credit, and other products subject to separate risk and regulatory approval.
10. Regional scale and selective service extraction.

Product expansion is not automatic. Each capability requires a product-specific ADR, governance record, partner plan, reconciliation design, support runbook, and rollback strategy.

## 9. Source documents

- Current architecture: [`SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md)
- Phase detail: [`PHASES.md`](PHASES.md)
- Implementation order: [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)
- Dependency graph: [`DEPENDENCY-GRAPH.md`](DEPENDENCY-GRAPH.md)
- Architecture inventory: [`ARCHITECTURE-INVENTORY.md`](ARCHITECTURE-INVENTORY.md)
- Ownership matrix: [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md)
- P2 plan: [`P2-PLAN.md`](P2-PLAN.md)
- ADR reconstruction and map: [`ADR/ADR-0012-Customer-Foundation.md`](ADR/ADR-0012-Customer-Foundation.md)
- ADR-0001 through ADR-0019: [`ADR/`](ADR/)
