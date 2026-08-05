# MonieNaija Roadmap

- **Status:** Canonical product and architecture roadmap
- **Last reviewed:** 2026-08-05
- **Authority:** Engineering, Security, Risk, Finance, Operations, Product, Compliance, and accountable release owners
- **A1T08 synthesis input:** [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md), [`DEPENDENCY-GRAPH.md`](DEPENDENCY-GRAPH.md), and [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)

## 1. Two complementary tracks

MonieNaija has two roadmap tracks with different purposes:

1. **Product Roadmap:** business capabilities and customer-facing outcomes. It retains the original P1.0-P1.15 numbering and names exactly.
2. **Architecture Phases:** engineering execution phases required to make those capabilities safe, scalable, governed, and operationally supportable. Architecture phases are named A1-A8 and must not be confused with Product Roadmap milestones.

Product numbering is not renumbered or replaced by Architecture phase names. A1 is a consolidation gate, not a new Product Roadmap milestone.

## 2. Complete project evolution

```text
M0-M9
  |
  v
Engineering & Financial Core
  |
  v
P1.0-P1.10
  |
  v
Customer Foundation
  |
  v
A1 Foundation Consolidation
  |\
  | +--> A2 Runtime Identity & Access
  | +--> A3 Customer-to-Financial Account Binding
  | +--> A4 Capability & Policy Engine
  |          (A3/A4 design may run in parallel after A1)
  |\
  | +--> A5 Internal Financial Pilot (after A2, A3, and A4)
  | +--> A6 External Partners & Settlement
  | +--> A7 Product Expansion Infrastructure
  | +--> A8 Scale & Selective Extraction
  |
  v
Runtime activation and controlled Product Roadmap delivery
  |
  v
Product Roadmap continues from P1.11-P1.15 when phase gates are satisfied
```

The labels in the evolution diagram describe the implementation sequence. The Product Roadmap below remains the permanent business roadmap.

## 3. Original Product Roadmap — unchanged

The Product Roadmap remains:

| Product milestone | Business capability                   |
| ----------------- | ------------------------------------- |
| P1.0              | Product, Regulatory & Launch Envelope |
| P1.1              | Identity & Customer Accounts          |
| P1.2              | KYC & Compliance                      |
| P1.3              | Customer Wallet Experience            |
| P1.4              | Risk & Fraud                          |
| P1.5              | Banking Rails & Settlement            |
| P1.6              | Provider-backed Virtual Accounts      |
| P1.7              | Notifications & Background Jobs       |
| P1.8              | Support, Reporting & Operations       |
| P1.9              | Customer Web Portal                   |
| P1.10             | Admin & Operations Portal             |
| P1.11             | Public APIs & Partner Platform        |
| P1.12             | Cloud, Security & Observability       |
| P1.13             | Android, iOS & PWA                    |
| P1.14             | Controlled Pilot Launch               |
| P1.15             | Product Expansion                     |

This table is the original Product Roadmap. It is not replaced by Customer Foundation implementation milestones or by A1-A8.

## 4. Baseline and current architecture state

MonieNaija is a domain-oriented NestJS modular monolith backed by PostgreSQL and TypeORM. It includes:

- M0-M9 engineering, financial, resilience, production, maturity, and governance foundations.
- P1.0-P1.10 Customer Foundation metadata and lifecycle domains.
- A ledger-centred financial core.
- PostgreSQL-backed audit, idempotency, outbox, metrics, diagnostics, and readiness primitives.
- A1 consolidation inputs for ownership, risk/compliance authority, identifiers, privacy, retention, and cross-domain boundaries.

The Customer Foundation is complete as a metadata and lifecycle domain. It is not yet a production customer-access trust boundary and is not yet canonically bound to the ledger-backed financial wallet. A1 documentation does not claim that A2-A8 runtime capabilities are implemented.

## 5. Architecture phases

| Order | Architecture phase                           | Primary result                                                                                                       | Product impact                                                        |
| ----: | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
|     1 | **A1 Foundation Consolidation**              | Canonical ownership, identity, risk, wallet, beneficiary, compliance, identifier, privacy, and retention boundaries. | Stabilizes all remaining product work; no runtime feature activation. |
|     2 | **A2 Runtime Identity & Access**             | Protected customer, operator, support, and internal APIs.                                                            | Required before customer-facing or financial activation.              |
|     3 | **A3 Customer-to-Financial Account Binding** | Canonical mapping from customer-wallet metadata to ledger-backed accounts.                                           | Enables a truthful Customer Wallet Experience.                        |
|     4 | **A4 Capability & Policy Engine**            | Explainable, versioned product-access decisions.                                                                     | Enables consistent risk, eligibility, limits, and product gates.      |
|     5 | **A5 Internal Financial Pilot**              | One internal money-moving flow with authorization, ledger, idempotency, outbox, and reconciliation.                  | Proves safe runtime activation.                                       |
|     6 | **A6 External Partners & Settlement**        | Isolated bank, NIBSS, funding, callback, and settlement boundaries.                                                  | Enables Banking Rails and provider-backed capabilities.               |
|     7 | **A7 Product Expansion Infrastructure**      | Shared contracts for product, notification, support, reporting, API, and channel expansion.                          | Enables P1.6-P1.15 without duplicated foundations.                    |
|     8 | **A8 Scale & Selective Extraction**          | Evidence-led scaling, recovery, regional strategy, and service extraction.                                           | Supports pilot and long-term product expansion.                       |

Detailed definitions are in [`PHASES.md`](PHASES.md). The execution sequence is in [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md). The full engineering plan is in [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md). A1 task sequencing is in [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md).

## 6. Product-to-Architecture mapping

| Product milestone                          | Depends on Architecture phases |
| ------------------------------------------ | ------------------------------ |
| P1.0 Product, Regulatory & Launch Envelope | M0-M9, A1                      |
| P1.1 Identity & Customer Accounts          | A1, A2, A3                     |
| P1.2 KYC & Compliance                      | A1, A2, A4                     |
| P1.3 Customer Wallet Experience            | A1, A2, A3, A4, A5             |
| P1.4 Risk & Fraud                          | A1, A2, A4                     |
| P1.5 Banking Rails & Settlement            | A1-A6                          |
| P1.6 Provider-backed Virtual Accounts      | A1-A6, A7                      |
| P1.7 Notifications & Background Jobs       | A1, A2, A5, A6, A7             |
| P1.8 Support, Reporting & Operations       | A1, A2, A4, A5, A6, A7, A8     |
| P1.9 Customer Web Portal                   | A1, A2, A3, A4, A5, A7         |
| P1.10 Admin & Operations Portal            | A1, A2, A4, A5, A6, A7         |
| P1.11 Public APIs & Partner Platform       | A1-A7, A8                      |
| P1.12 Cloud, Security & Observability      | A1, A2, A6, A7, A8             |
| P1.13 Android, iOS & PWA                   | A1, A2, A3, A4, A5, A7         |
| P1.14 Controlled Pilot Launch              | A1-A8                          |
| P1.15 Product Expansion                    | A1-A8                          |

Dependencies mean that the Architecture phase supplies a required platform contract. They do not imply that the phase itself implements the Product milestone.

## 7. A1-to-A8 dependency rules

- A1 must close canonical ownership, identifier/privacy boundaries, ADR inputs, and cross-document dependencies before A2 entry.
- A2 owns the runtime trust boundary; current internal APIs are not production-public before A2.
- A3 binds Customer Foundation identity to financial accounts without copying balances or changing ledger truth.
- A4 centralizes capability and policy decisions from eligibility, restrictions, risk, compliance, limits, enrollment, and account state.
- A3 and A4 may be designed in parallel after A1, but A5 requires A2, A3, and A4 gates together.
- A5 proves one controlled internal financial flow with audit, idempotency, outbox, recovery, and independent reconciliation.
- A6 isolates external partners, callbacks, settlement, and provider data after internal pilot evidence.
- A7 provides product expansion infrastructure only through the already-approved access, policy, financial, event, and reconciliation contracts.
- A8 uses measured volume, recovery, SLO, regional, and extraction evidence rather than module count alone.

## 8. Architecture gaps before runtime activation

1. **No runtime authentication or authorization:** P1.8 stores metadata only; existing internal APIs remain protected by deployment and network controls until A2.
2. **No canonical customer-to-ledger mapping:** P1.4 `CustomerWallet` remains distinct from ledger-backed `WalletAccount` until A3.
3. **Overlapping risk models:** P1.3 eligibility-era risk metadata and P1.10 assessment records require A1 consolidation and A4 policy authority.
4. **Overlapping beneficiary models:** M6 beneficiary tooling and P1.6 customer beneficiaries require A1 ownership decisions before A5 transfers.
5. **No central capability-policy authority:** A4 must prevent financial services from implementing divergent policy checks.
6. **No customer-aware financial command boundary:** A5 must connect authenticated customer commands to account binding and ledger operations.
7. **No external settlement boundary:** P1.5 metadata remains non-financial until A6.
8. **Identifier and privacy decisions require ratification:** A1T07 defines the control inputs; ADR-0023 and ADR-0024 remain later A1 review work.
9. **Governance status:** ADR-0004-0011 remain proposed for domain review; ADR-0012 has been reconstructed; ADR-0020-0024 are planned A1 decisions.

## 9. Phase gates

No Architecture phase may pass its gate without:

- Approved scope and ADRs.
- Threat, privacy, security, risk, and operational reviews where applicable.
- DTO and domain validation.
- Migration and rollback evidence.
- Immutable audit evidence.
- Idempotency and optimistic-lock evidence.
- Metrics, diagnostics, and support ownership.
- Reconciliation evidence for any financial state.
- Product governance and legal/compliance approval where customer money or regulated activity is affected.

## 10. Long-term product direction

The Product Roadmap continues from P1.11 through P1.15 only after the required Architecture phases are complete:

1. Public APIs and partner platform.
2. Cloud, security, and observability maturity.
3. Android, iOS, and PWA channels.
4. Controlled pilot launch.
5. Product expansion.

Product expansion is not automatic. Each capability requires product-specific governance, an ADR, a partner plan where applicable, reconciliation design, support ownership, and rollback strategy.

## 11. References

- [`PHASES.md`](PHASES.md)
- [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)
- [`DEPENDENCY-GRAPH.md`](DEPENDENCY-GRAPH.md)
- [`ARCHITECTURE-INVENTORY.md`](ARCHITECTURE-INVENTORY.md)
- [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md)
- [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md)
- [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md)
- [`ADR/ADR-0012-Customer-Foundation.md`](ADR/ADR-0012-Customer-Foundation.md)
- [`ADR/`](ADR/)
