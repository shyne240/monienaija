# ADR Inventory and Baseline Decision State

- Phase: A1T01 — Baseline and ADR Inventory
- Review date: 2026-08-04
- Scope: Every ADR currently present in `docs/ADR`
- Application code changed: None

## 1. Inventory determination

The repository contains ADR files numbered `ADR-0001` through `ADR-0011` and `ADR-0013` through `ADR-0019`.

`ADR-0012` was not present under another filename or under an alternate ADR directory. It has since been reconstructed as:

- `docs/ADR/ADR-0012-Customer-Foundation.md`

The sequence is now continuous from `ADR-0001` through `ADR-0019`. There are no missing ADR numbers in the current inventory.

ADR-0012 is explicitly marked as reconstructed and is not presented as an original historical file.

## 2. Complete ADR inventory

| ADR      | Title                                                                                | Status                                          | Purpose                                                                                                                                                                        | Related modules/domains                                                                       | Superseded ADRs                                                         |
| -------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ADR-0001 | Domain-oriented, ledger-centred architecture                                         | Accepted                                        | Establish bounded domains, owned data, versioned contracts, and the ledger-centred modular topology.                                                                           | All domains; ledger; wallet; payment orchestration; operations; channels.                     | None. Foundational.                                                     |
| ADR-0002 | Represent money as integer minor units with currency                                 | Accepted                                        | Define exact minor-unit money, explicit currency, scale, and rounding requirements.                                                                                            | `common`; ledger; wallet; fees; quotes; payments; reconciliation.                             | None. Foundational.                                                     |
| ADR-0003 | Use durable domain events with transactional publication                             | Accepted                                        | Define durable facts, transactional outbox publication, inbox deduplication, versioned event schemas, and replay safety.                                                       | Operations; outbox; idempotency; all event-producing domains.                                 | None. Foundational.                                                     |
| ADR-0004 | Wallet accounts are liability accounts backed by an immutable ledger                 | Proposed for domain review                      | Define ledger-backed customer-funds wallet accounts, journal immutability, idempotency, and account invariants.                                                                | `wallet`; `ledger`; `common`; finance; reconciliation.                                        | None. Requires formal ratification before financial activation.         |
| ADR-0005 | Independent reconciliation and finance verification                                  | Proposed for domain review                      | Define independent read-only financial reconciliation, trial balance, traceability, and release-blocking evidence.                                                             | `reconciliation`; `ledger`; `wallet`; `transfer`; `deposit`; `withdrawal`; operations.        | None. Requires formal ratification before financial activation.         |
| ADR-0006 | Controlled internal deposits and withdrawals are explicit, journal-backed lifecycles | Proposed for domain review                      | Define idempotent deposit/withdrawal states, journal templates, settlement accounts, and pending/recovery behavior.                                                            | `deposit`; `withdrawal`; `ledger`; `wallet`; payment references; reconciliation.              | None. Requires formal ratification before external activation.          |
| ADR-0007 | M6 expanded financial product tooling remains non-money-moving                       | Proposed for domain review                      | Define metadata-only virtual accounts, beneficiaries, banks, quotes, fees, and limit evaluation.                                                                               | `virtual-account`; legacy `beneficiary`; `bank`; `quote`; `fee`; `limit`; payment references. | None. Requires boundary review with P1.6 customer beneficiaries.        |
| ADR-0008 | Database-backed operational resilience primitives                                    | Proposed for domain review                      | Define PostgreSQL idempotency, immutable audit, outbox, metrics, diagnostics, bounded retry, and operational readiness.                                                        | `operations`; `reconciliation`; `production`; all transactional domains.                      | None. Requires formal platform review.                                  |
| ADR-0009 | Production launch gates and request-safe runtime behavior                            | Proposed for domain review                      | Define configuration validation, migration-head readiness, API metadata, tracing, stable errors, request draining, and graceful shutdown.                                      | `production`; `config`; `main`; HTTP filter; operations.                                      | None. Requires security and operations review.                          |
| ADR-0010 | Operational maturity is read-only, governed, and manually maintained                 | Proposed for domain review                      | Define health/reporting, governance startup metadata, retention, acceptance status, and manual maintenance.                                                                    | `maturity`; `operations`; `production`; retention; governance.                                | None. Requires formal maturity review.                                  |
| ADR-0011 | Product governance is persisted, versioned, auditable, and non-financial             | Proposed for product and governance review      | Define durable product/launch governance records, immutable versions, audit, reports, and readiness evaluation.                                                                | `product-governance`; `maturity`; `operations`; product and launch governance.                | None. Requires product/governance ratification.                         |
| ADR-0012 | Customer Identity, Profile, and KYC Foundation                                       | Reconstructed for canonical architecture review | Define customer UUID identity, profile, contacts, identity-document metadata, KYC metadata, soft deletion, optimistic versioning, audit, and financial separation.             | `customer`; customer foundation; profile; identity documents; KYC metadata.                   | None. Reconstructed because the original ADR was absent.                |
| ADR-0013 | Customer Onboarding, Risk Profiling & Customer Lifecycle                             | Accepted                                        | Define onboarding workflow, agreements, tasks, approvals, readiness, completion gates, and customer lifecycle.                                                                 | `customer-onboarding`; `customer`; onboarding evidence; approvals.                            | None. The risk-profile portion requires A1/A4 consolidation with P1.10. |
| ADR-0014 | Customer Eligibility, Limits & Product Enrollment                                    | Accepted                                        | Define eligibility, restrictions, limits, enrollment, permissions, operating status, and non-financial product decisions.                                                      | `customer-eligibility`; customer onboarding; customer risk; product enrollment.               | None. Policy enforcement remains future A4 work.                        |
| ADR-0015 | Customer Wallet Provisioning                                                         | Accepted                                        | Define non-financial customer-wallet provisioning, ownership, aliases, lifecycle, and history without ledger interaction.                                                      | `customer-wallet`; customer; onboarding; eligibility.                                         | None. Requires A3 binding to financial wallet authority.                |
| ADR-0016 | Customer Funding Instruments                                                         | Accepted                                        | Define funding-instrument registration, ownership, verification metadata, lifecycle, and history without external providers.                                                   | `customer-funding-instrument`; customer; future partner/settlement boundary.                  | None. External use remains future A6 work.                              |
| ADR-0017 | Customer Beneficiaries & Trusted Recipients                                          | Accepted                                        | Define customer-owned trusted-recipient metadata, destination deduplication, ownership, verification, lifecycle, and history without transfer execution.                       | `customer-beneficiary`; legacy `beneficiary`; customer; future transfers.                     | None. Transfer-facing authority requires A1/A5 consolidation.           |
| ADR-0018 | Customer Preferences & Notification Settings                                         | Accepted                                        | Define language, theme, notification-channel, and security preference metadata with versioned history and no delivery.                                                         | `customer-preference`; future notification and access consumers.                              | None. Delivery and enforcement remain future capabilities.              |
| ADR-0019 | Customer Authentication Credentials & Identity Recovery                              | Accepted                                        | Define password-hash metadata, password history/rotation/expiry, lock state, reset metadata, MFA, devices, recovery codes, and security events without runtime authentication. | `customer-authentication`; customer; future identity/access boundary.                         | None. Runtime authentication and authorization remain future A2 work.   |

## 3. Numbering continuity

| Range             | Result                                                          |
| ----------------- | --------------------------------------------------------------- |
| ADR-0001-ADR-0011 | Present.                                                        |
| ADR-0012          | Missing historically; reconstructed and now present.            |
| ADR-0013-ADR-0019 | Present.                                                        |
| Overall sequence  | Continuous from ADR-0001 through ADR-0019 after reconstruction. |

No duplicate ADR number exists. No ADR was found under an alternate filename that would make ADR-0012 a duplicate.

## 4. Status summary

- Accepted: ADR-0001, ADR-0002, ADR-0003, ADR-0012, ADR-0013, ADR-0014, ADR-0015, ADR-0016, ADR-0017, ADR-0018, ADR-0019.
- Proposed for domain/product/governance review: ADR-0004, ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009, ADR-0010, ADR-0011.
- Reconstructed: ADR-0012.
- Explicitly superseded: None.
- Explicitly obsolete: None.

“Proposed” does not mean obsolete. It means the decision requires formal review before the relevant financial, production, external-partner, or governance gate.

## 5. Duplicated or overlapping architectural decisions

### 5.1 Wallet/account ownership

- **Records involved:** ADR-0004 and ADR-0015.
- **Why both exist:** ADR-0004 defines the financial ledger-backed wallet; ADR-0015 defines customer-wallet provisioning metadata without financial side effects.
- **Current authority:** ADR-0004 and the ledger-backed `WalletAccount`/ledger domain own financial account and balance truth.
- **Metadata/projection:** P1.4 customer-wallet records are provisioning metadata.
- **Should both continue:** Yes, temporarily and deliberately.
- **Required action:** Define an explicit customer-wallet-to-ledger-account binding; do not merge tables or add balance fields to customer metadata.
- **Target phase:** A1 decision; A3 implementation.

### 5.2 Risk and eligibility

- **Records involved:** ADR-0013, ADR-0014, P1.3 risk metadata, and P1.10 risk assessment records.
- **Why both exist:** P1.2/P1.3 introduced risk information for onboarding and eligibility gates; P1.10 introduced dated manual assessments and factor history.
- **Current authority:** P1.10 should become canonical assessment evidence; P1.3 remains the eligibility and restriction source until a policy authority exists.
- **Metadata/projection:** A future policy result is a derived decision referencing both sources.
- **Should both continue:** Temporarily, for compatibility and historical preservation.
- **Required action:** Do not let financial modules implement separate risk rules. Define one policy decision authority.
- **Target phase:** A1 decision; A4 implementation.

### 5.3 Beneficiary models

- **Records involved:** ADR-0007, ADR-0017, legacy `beneficiary`, and P1.6 `customer-beneficiary`.
- **Why both exist:** M6 beneficiary tooling predates the Customer Foundation; P1.6 adds customer-owned trusted-recipient semantics.
- **Current authority:** A1 must select the transfer-facing authority; P1.6 is the preferred customer-owned candidate.
- **Metadata/projection:** The non-authoritative model should become a migrated or compatibility projection.
- **Should both continue:** Only during transition.
- **Required action:** Prevent two writable transfer-recipient authorities.
- **Target phase:** A1 decision; A5 consolidation.

### 5.4 Operational readiness and maturity

- **Records involved:** ADR-0008, ADR-0009, ADR-0010, and ADR-0011.
- **Why both exist:** Resilience primitives, production launch gates, maturity reporting, and product governance were introduced in successive milestones.
- **Current authority:** Operations owns operational facts; Production owns readiness; Maturity owns acceptance/reporting; Product Governance owns product evidence.
- **Metadata/projection:** Readiness and acceptance reports are derived views over these records.
- **Should both continue:** Yes, with a clear review and escalation hierarchy.
- **Required action:** Ratify how warnings, blocked governance evidence, reconciliation warnings, and failures interact.
- **Target phase:** A1 governance review.

### 5.5 Authentication metadata and runtime access

- **Records involved:** ADR-0009, ADR-0010, ADR-0018, and ADR-0019.
- **Why both exist:** Preferences and credential/recovery metadata were intentionally delivered before runtime authentication and authorization.
- **Current authority:** Customer Authentication owns credential metadata; future identity/access runtime owns authentication decisions, sessions, and authorization.
- **Metadata/projection:** Sessions, tokens, and access decisions are runtime projections/decisions, not credential storage.
- **Should both continue:** Yes, with an explicit trust boundary.
- **Required action:** Internal unauthenticated routes must not become public production routes.
- **Target phase:** A1 decision; A2 implementation.

## 6. Conflicting or inconsistent decisions

### 6.1 Reconciliation warning semantics

ADR-0005 describes reconciliation errors as release-blocking, while current readiness behavior permits a reconciliation `WARNING` and blocks `ERROR`. This is a policy ambiguity, not an obsolete ADR.

**Required resolution:** Define warning ownership, evidence requirements, and risk acceptance before A5. The ledger and reconciliation invariants remain non-negotiable.

### 6.2 Risk-level vocabulary

P1.2-era risk metadata used `PROHIBITED`, while P1.10 risk assessments use `CRITICAL`. This creates a vocabulary conflict for future policy decisions.

**Required resolution:** Select canonical levels and define a migration/projection mapping in A1/A4. Do not silently treat `CRITICAL` and `PROHIBITED` as interchangeable.

### 6.3 Customer wallet versus financial wallet

ADR-0004 requires ledger-backed financial wallets, while ADR-0015 explicitly prevents customer-wallet provisioning from creating ledger state. This is an intentional boundary, but without A3 binding it can be interpreted as two wallet authorities.

**Required resolution:** Adopt the A3 account-binding model before customer-aware money movement.

### 6.4 Internal route exposure

ADR-0009 and ADR-0010 permit internal tooling to exist before authentication, while ADR-0019 provides metadata but not runtime access. The decisions are compatible only if deployment/network restrictions remain in force.

**Required resolution:** A2 must define the runtime trust boundary and public/internal route classification.

## 7. Obsolete ADR assessment

No ADR is explicitly obsolete or superseded.

The following records require amendment or consolidation rather than deletion:

- ADR-0013 risk-profile language requires alignment with P1.10.
- ADR-0007 beneficiary language requires alignment with P1.6.
- ADR-0004 and ADR-0015 require A3 account-binding clarification.
- ADR-0005, ADR-0009, and ADR-0010 require readiness-warning semantics.
- ADR-0004 through ADR-0011 require formal review because they remain proposed.

No historical ADR should be deleted to hide an overlap. Revisions must preserve decision history and identify the superseding decision when one is formally approved.

## 8. Undocumented decisions that should become future ADRs

| Future ADR | Decision required                                                      | Target phase |
| ---------- | ---------------------------------------------------------------------- | ------------ |
| ADR-0020   | Customer Foundation closure and A1 scope boundary                      | A1           |
| ADR-0021   | Canonical Customer Domain ownership and model consolidation            | A1           |
| ADR-0022   | Risk, Compliance, Eligibility, and Policy Decision authority           | A1/A4        |
| ADR-0023   | Customer, account, reference, correlation, and idempotency identifiers | A1/A3/A5     |
| ADR-0024   | Data classification, retention, privacy, and legal holds               | A1/A2/A6     |
| ADR-0025   | Runtime authentication execution boundary                              | A2           |
| ADR-0026   | Sessions, tokens, revocation, and device trust                         | A2           |
| ADR-0027   | Operator/admin authorization and privileged actions                    | A2           |
| ADR-0028   | Customer-to-ledger account binding                                     | A3           |
| ADR-0029   | Policy decision contract and explainability                            | A4           |
| ADR-0030   | Customer-aware financial command boundary                              | A5           |
| ADR-0031   | External partner adapter, callback, and settlement boundary            | A6           |
| ADR-0032   | Notification delivery and background-job reliability                   | A7           |
| ADR-0033   | Public API and partner-platform trust boundary                         | A7/A8        |
| ADR-0034   | Cloud, regional resilience, and selective service extraction           | A8           |

These are proposed future decisions only. A1T01 does not create or implement them.

## 9. A1T01 acceptance evidence

A1T01 is complete when:

- Every file currently in `docs/ADR` is represented in this inventory.
- ADR numbering is continuous from ADR-0001 through ADR-0019.
- ADR-0012 reconstruction is explicitly recorded.
- Duplicate, overlapping, conflicting, and potentially obsolete decisions are identified.
- Undocumented future ADR decisions are listed with target phases.
- No application files are changed.
- Documentation formatting and link checks pass.
