# A1 ADR Review Status

- **Task:** A1T14 — A1 Review Package and Exit Evidence
- **Review date:** 2026-08-05
- **Status:** Review register prepared; accountable-owner decisions pending
- **Application code, API, entity, migration, and configuration changes:** None
- **Full inventory:** [`ADR-INVENTORY.md`](ADR-INVENTORY.md)

## 1. ADR status register

| ADR      | Title / decision                                     | Current status | A1 review action                                            | Accountable owner(s)                            | Target review date |
| -------- | ---------------------------------------------------- | -------------- | ----------------------------------------------------------- | ----------------------------------------------- | ------------------ |
| ADR-0001 | Domain-oriented, ledger-centred architecture         | Accepted       | Preserve foundational constraint                            | Architecture                                    | Recorded           |
| ADR-0002 | Integer minor-unit money and explicit currency       | Accepted       | Preserve financial invariant                                | Finance / Ledger                                | Recorded           |
| ADR-0003 | Durable events and transactional publication         | Accepted       | Preserve ownership/correlation rules                        | Architecture / Operations                       | Recorded           |
| ADR-0004 | Ledger-backed liability wallets                      | Proposed       | Review before financial activation                          | Wallet / Ledger / Finance                       | Before A3/A5       |
| ADR-0005 | Independent reconciliation                           | Proposed       | Review warning semantics and financial gate                 | Finance / Reconciliation                        | Before A5          |
| ADR-0006 | Controlled internal deposits/withdrawals             | Proposed       | Review before payment activation                            | Finance / Payments / Operations                 | Before A5/A6       |
| ADR-0007 | M6 tooling remains non-money-moving                  | Proposed       | Align legacy tooling with A1 ownership                      | Product / Payments / Finance                    | Before A5/A6       |
| ADR-0008 | Database-backed operational resilience               | Proposed       | Review shared operational controls                          | Operations / Platform / Security                | Before A2/A5       |
| ADR-0009 | Production launch and request-safe runtime           | Proposed       | Review route/readiness boundary                             | Production / Security / Operations              | Before A2          |
| ADR-0010 | Governed operational maturity                        | Proposed       | Review retention, warnings, acceptance, maintenance         | Maturity / Operations                           | Before A1 exit     |
| ADR-0011 | Product governance                                   | Proposed       | Review roadmap and release evidence ownership               | Product / Governance / Compliance               | Before A1 exit     |
| ADR-0012 | Customer identity/profile/KYC foundation             | Reconstructed  | Confirm reconstruction and exclusions                       | Architecture / Customer / Risk / Compliance     | 2026-08-05         |
| ADR-0013 | Customer onboarding/lifecycle                        | Accepted       | Preserve workflow evidence ownership                        | Customer Operations / Risk                      | Recorded           |
| ADR-0014 | Eligibility/limits/enrollment                        | Accepted       | Confirm P1.3 source until A4                                | Risk / Product / Operations                     | 2026-08-05         |
| ADR-0015 | Customer wallet provisioning                         | Accepted       | Confirm non-financial boundary                              | Customer Wallet / Wallet / Ledger               | 2026-08-05         |
| ADR-0016 | Customer funding instruments                         | Accepted       | Confirm registration-only boundary                          | Payments Risk / Compliance                      | 2026-08-05         |
| ADR-0017 | Customer beneficiaries                               | Accepted       | Confirm preferred transfer-facing authority                 | Payments Risk / Operations                      | 2026-08-05         |
| ADR-0018 | Customer preferences                                 | Accepted       | Confirm preference/delivery separation                      | Product / Operations                            | 2026-08-05         |
| ADR-0019 | Customer authentication metadata                     | Accepted       | Confirm metadata-only boundary                              | Security / Operations                           | 2026-08-05         |
| ADR-0020 | Foundation Closure and Scope Boundary                | Proposed draft | Approve A1 scope and closure conditions                     | Architecture / Product / owners                 | 2026-08-05         |
| ADR-0021 | Customer Domain Canonical Model and Ownership Rules  | Proposed draft | Approve one owner and prohibited shared writes              | Architecture / domain owners                    | 2026-08-05         |
| ADR-0022 | Risk, Compliance, and Eligibility Decision Authority | Proposed draft | Approve source-evidence/policy boundary                     | Risk / Compliance / Product / Finance           | 2026-08-05         |
| ADR-0023 | Customer Identifier and Reference Conventions        | Proposed draft | Approve normalization, uniqueness, correlation, idempotency | Architecture / Security / Operations            | 2026-08-05         |
| ADR-0024 | Customer Data Classification, Retention, and Privacy | Proposed draft | Approve handling, holds, retention, A2/A6 inputs            | Security / Privacy/Legal / Compliance / Finance | 2026-08-05         |

## 2. Review rules

- Accepted ADRs remain part of the baseline; A1 does not silently replace them.
- ADR-0012 remains marked reconstructed.
- Proposed ADR-0004 through ADR-0011 require review before relevant gates.
- Proposed ADR-0020 through ADR-0024 require accountable-owner decisions before A1 approval and A2 entry.
- Returned or rejected decisions retain comments, owner, and target date.
- Superseding ADRs preserve original decision history.

## 3. Review decision record

| ADR range         | Approval decision                        | Accountable owner                           | Date    | Comments / follow-up              |
| ----------------- | ---------------------------------------- | ------------------------------------------- | ------- | --------------------------------- |
| ADR-0004-ADR-0011 | Pending domain/product/governance review | Pending by ADR                              | Pending | See register                      |
| ADR-0012          | Pending reconstruction review            | Architecture / Customer / Risk / Compliance | Pending | Reconstruction evidence present   |
| ADR-0020-ADR-0024 | Pending A1 accountable-owner review      | Architecture and domain owners              | Pending | Required for A1 approval/A2 entry |
