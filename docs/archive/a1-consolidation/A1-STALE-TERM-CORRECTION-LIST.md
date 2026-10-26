# A1 Stale-Term Correction List

- **Task:** A1T13 — Consolidated Inventory and Cross-Document Consistency
- **Status:** Terminology review record; no application changes
- **Scope:** Product Roadmap names, Architecture phase names, A1 task references, and legacy phase terminology

## 1. Search result

Architecture and Product Roadmap artifacts contain no stale second-phase or legacy product-phase roadmap terminology. The canonical implementation plan's references to stale-term searches are test wording, not roadmap labels, and remain governed by the plan.

## 2. Correction register

| Pattern checked                                                             | Result                                         | Correct form / action                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Legacy second-phase or product-phase notation used as a roadmap phase       | No stale usage found outside plan test wording | Use Product Roadmap P1.0-P1.15 or Architecture A1-A8                             |
| Product Roadmap milestone used as an Architecture phase                     | No stale usage found                           | Keep Product Roadmap names separate from Architecture names                      |
| Architecture phase described as a Product Roadmap milestone                 | No stale usage found                           | Use A1-A8 for architecture gates and P1.0-P1.15 for product capabilities         |
| P1.0-P1.10 described as replacing P1.0-P1.15                                | No stale usage found                           | Use P1.0-P1.10 for the completed Customer Foundation baseline only               |
| A1 described as runtime activation                                          | No stale usage found                           | Use A1 Foundation Consolidation; runtime identity begins at A2                   |
| A2-A8 described as implemented by the current foundation                    | No stale usage found                           | Use future, planned, or not implemented until the relevant phase gate            |
| `CustomerWallet` described as financial balance authority                   | No stale usage found                           | Use customer-wallet provisioning metadata; wallet/ledger own financial value     |
| Legacy and Customer Beneficiary described as simultaneous canonical writers | No stale usage found                           | Use P1.6 `customer-beneficiary` as preferred authority with legacy compatibility |
| Compliance cases described as an automated screening engine                 | No stale usage found                           | Use case-management evidence; future A4 policy remains separate                  |
| Authentication metadata described as runtime authentication                 | No stale usage found                           | Use P1.8 metadata and future A2 runtime identity/access                          |

## 3. Naming authorities

- Product Roadmap: [`ROADMAP.md`](ROADMAP.md).
- Architecture phase names: [`PHASES.md`](PHASES.md) and [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md).
- A1 task names/order: [`A1-IMPLEMENTATION-PLAN.md`](A1-IMPLEMENTATION-PLAN.md).
- Current state and future gaps: [`ARCHITECTURE-INVENTORY.md`](ARCHITECTURE-INVENTORY.md).

## 4. Validation record

The review covers legacy phase/product wording, A1-A8 names, P1.0-P1.15 names, and future implementation-status wording. Any intentional mention of stale terminology in a test description is not a roadmap label.
