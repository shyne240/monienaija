# ADR-0021: Customer Domain Canonical Model and Ownership Rules

- **Status:** Proposed for A1 architecture review
- **Date:** 2026-08-05
- **Decision owners:** Architecture, Customer Engineering, Wallet, Ledger, Risk, Compliance, Security, Operations, Finance, and Product owners
- **Scope:** Canonical customer and adjacent-domain ownership after P1.0-P1.10
- **Task:** A1T10 — Draft ADR-0020 and ADR-0021

## Context

The Customer Foundation deliberately introduced identity, onboarding, eligibility, wallet provisioning metadata, funding-instrument metadata, beneficiaries, preferences, authentication metadata, compliance cases, and manual risk profiles without activating financial behavior. The existing platform also contains ledger-backed wallets, legacy beneficiaries, payment tooling, operations primitives, and future-facing access boundaries.

The models are not interchangeable:

- Customer metadata identifies a person or organization but does not own money.
- `CustomerWallet` records provisioning metadata but is not a ledger account or balance.
- `WalletAccount` is a financial facade backed by ledger accounts and immutable journal history.
- P1.3 eligibility/restrictions, P1.9 compliance cases, and P1.10 manual risk assessments represent different kinds of evidence and decisions.
- P1.6 customer beneficiaries overlap with legacy M6 beneficiary tooling.
- P1.8 credential/recovery/device metadata is not runtime authentication or authorization.
- Preferences are customer intent, not notification delivery state.

Without an explicit canonical model, later phases could add competing writers, use a projection as a source, expose sensitive data through a generic financial API, or connect an unprotected metadata route to a money-moving command.

## Decision

### 1. Customer is the canonical customer identity owner

The `customer` domain owns:

- Customer UUID and customer reference.
- Customer type and lifecycle status.
- Customer profile, contacts, addresses, identity-document metadata, and KYC metadata.

Customer-owned modules reference the canonical `Customer.id` and do not create duplicate profile, contact, address, identity-document, or KYC authorities. Customer references are lookup/display values governed by the identifier controls; they are not credentials, financial IDs, or authorization evidence.

### 2. Financial value remains ledger-owned

`ledger` is the sole authority for:

- Ledger accounts and account codes.
- Posted journal headers and journal lines.
- Ledger-derived balances and financial posting history.

`wallet` owns the `WalletAccount` financial facade and its relationship to a ledger account. `CustomerWallet` remains provisioning and customer metadata until A3 defines an explicit binding. No customer, onboarding, eligibility, beneficiary, funding-instrument, preference, authentication, compliance, risk, report, or policy projection may store or mutate an authoritative balance or journal line.

A financial reference, payment reference, wallet alias, customer reference, case number, provider identifier, or correlation ID identifies or locates a record. It does not create ownership of financial value or authorize a posting.

### 3. Canonical authority map

| Concept                                                        | Canonical authority                                         | Current classification             | Projection/read boundary                                               | Consolidation decision                                        | Target phase |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- | ------------ |
| Customer identity and profile                                  | `customer`                                                  | Source authority                   | Customer summaries are read-only projections                           | No duplicate identity writers                                 | A1 / A2      |
| Onboarding workflow and evidence                               | `customer-onboarding`                                       | Workflow source                    | Eligibility and policy read approved evidence                          | Keep separate from identity and financial activation          | A1 / A4      |
| Eligibility, restrictions, limits, enrollment, and permissions | `customer-eligibility` until A4                             | Current source metadata            | A4 produces action-specific decisions; A2 owns principal authorization | Preserve source facts; remove divergent downstream checks     | A4 / A5      |
| Customer wallet provisioning                                   | `customer-wallet`                                           | Metadata source                    | Financial wallet views read binding/financial state                    | Bind explicitly; do not merge or add balances                 | A3           |
| Financial wallet and account relationship                      | `wallet` with `ledger`                                      | Financial authority/facade         | Customer views are ledger-derived or approved read models              | Ledger remains value authority                                | A3 / A5      |
| Ledger accounts, journals, lines, and balances                 | `ledger`                                                    | Financial source of truth          | Reconciliation and reports are read-only controls                      | No duplicated mutable financial state                         | A3 / A5      |
| Funding instruments                                            | `customer-funding-instrument`                               | Registration/verification metadata | A6 adapter/settlement views are separate                               | No provider ownership or settlement proof in P1.5             | A6           |
| Customer beneficiaries                                         | `customer-beneficiary` preferred                            | Trusted-recipient metadata         | Transfer commands consume an approved recipient contract               | Migrate/project legacy records; stop two writable authorities | A5 / A6      |
| Legacy beneficiaries                                           | Legacy `beneficiary`                                        | Compatibility metadata             | Read-only compatibility projection after mapping                       | Preserve history; no new canonical transfer writer            | A5           |
| Preferences                                                    | `customer-preference`                                       | Customer intent source             | Notification delivery is a separate projection                         | Do not store provider delivery state in preferences           | A7           |
| Credential, recovery, MFA, device, and security metadata       | `customer-authentication`                                   | Security metadata source           | A2 runtime decisions and sessions use controlled reads                 | Do not duplicate hashes or runtime sessions                   | A2           |
| Runtime authentication and authorization                       | Future A2 boundary                                          | Missing runtime authority          | Decisions/sessions are runtime state                                   | One protected identity/access boundary                        | A2           |
| Compliance cases and evidence                                  | `customer-compliance`                                       | Investigation/workflow evidence    | A4 consumes approved source references                                 | Case creation is not an automated screening result            | A4           |
| Manual risk assessments and factors                            | `customer-risk-profile` preferred                           | Manual evidence source             | A4 consumes versioned assessment evidence                              | P1.3 risk metadata remains compatibility evidence             | A4           |
| Policy decisions                                               | Future A4 boundary                                          | Derived action-specific output     | Financial/product commands consume decisions                           | Policy does not own or rewrite source evidence                | A4 / A5      |
| Audit, idempotency, outbox, metrics, and diagnostics           | `operations`                                                | Shared operational authority       | Domains use contracts; reports are projections                         | No module-local duplicates                                    | All phases   |
| Reconciliation                                                 | `reconciliation` with Finance                               | Independent control authority      | Read-only reports/checks                                               | Never repair by mutating source records                       | A3-A7        |
| Identifiers, classification, retention, and legal holds        | Source-domain owners with Security/Compliance/Legal control | Cross-cutting governance rules     | Projections and external adapters inherit source controls              | Follow A1T07; later ADR-0023/0024 ratify detailed contracts   | A1 / A2 / A6 |

The full field-level matrix is [`CANONICAL-OWNERSHIP-MATRIX.md`](../CANONICAL-OWNERSHIP-MATRIX.md). This ADR assigns authority; it does not create a new schema or move existing data.

### 4. Metadata, projection, and shared-read rules

- A source authority owns creation, validation, lifecycle, history, retention schedule proposal, and approved deletion/anonymization behavior for its data.
- A metadata domain may expose a contract for another domain to read. It may not grant the reader direct write authority to the source table.
- A projection contains derived or summarized state. It must identify source versions or timestamps where a later decision needs reproducibility.
- A policy decision references source evidence and policy version. It does not copy unnecessary identity, risk, compliance, credential, or financial payloads.
- Audit, outbox, metrics, diagnostics, readiness, and reconciliation records are operational facts or controls. They cannot be used to overwrite source data or establish a second business authority.
- Shared identifiers are classified and retained according to their source and purpose. A correlation or provider ID cannot change the owner of the linked record.

### 5. Required overlap dispositions

#### Customer wallet metadata and financial wallet

- `customer-wallet` remains the provisioning/ownership metadata authority.
- `wallet`/`ledger` remain financial account and value authorities.
- A3 must define customer UUID to account binding, duplicate prevention, repair, lifecycle, and independent reconciliation.
- No balance or journal state is added to `CustomerWallet`.

#### Customer beneficiaries and legacy beneficiaries

- P1.6 `customer-beneficiary` is the preferred customer-owned transfer-facing authority, pending formal review.
- Legacy `beneficiary` records remain compatibility or historical data for existing tooling.
- A5 must define field mapping, reference collision handling, destination duplicate behavior, history preservation, and a reversible migration/projection.
- No transfer command may write both models as independent authorities.

#### Eligibility, risk, and compliance

- `customer-eligibility` remains the source of current eligibility and restrictions until A4.
- `customer-risk-profile` is the preferred authority for new manual risk assessment evidence and factor history.
- P1.3/onboarding-era risk values remain historical or compatibility evidence until an explicit mapping is approved.
- `customer-compliance` owns investigation cases, comments, assignments, evidence metadata, and resolution history.
- A4 owns the action-specific policy decision and precedence. No A1 component implements AML, sanctions, fraud, or transaction monitoring.

#### Authentication metadata and runtime access

- `customer-authentication` owns credential hash metadata, recovery records, MFA metadata, trusted-device metadata, and security-event history.
- A2 owns login/authentication execution, sessions/tokens, revocation, authorization, and privileged actions.
- Runtime services consume metadata through controlled contracts and do not copy password hashes, recovery secrets, device fingerprints, or lock state into unrelated modules.

#### Preferences and notification delivery

- `customer-preference` owns customer-selected intent and its history.
- A7 notification infrastructure owns delivery attempts, provider results, job state, and delivery correlation.
- Notification consumers do not write delivery state into the preference source.

### 6. Prohibited shared writes

The following are prohibited unless a later, explicitly approved ADR supersedes this decision:

- Customer modules writing wallet balances, ledger accounts, journals, or lines.
- Financial modules writing customer profile, KYC, risk, compliance, authentication, or preference source records.
- A policy projection writing eligibility, restriction, risk, or compliance evidence to make its own result appear consistent.
- A report, dashboard, readiness check, or reconciliation query mutating source records.
- Legacy and canonical beneficiary modules independently creating transfer-facing recipient truth.
- Notification, analytics, partner, or support modules writing preferences, credentials, identity evidence, or financial source tables.
- Direct writes to `audit_events`, `idempotency_records`, or `outbox_events` outside their Operations contracts.

## Alternatives considered

### Put all customer and financial concepts in one Customer module

Rejected. It would merge identity, workflow, security metadata, financial value, and operational controls with incompatible owners, retention rules, and failure semantics.

### Make `CustomerWallet` the financial wallet authority

Rejected. The existing wallet and ledger model owns financial accounts and balances. A customer metadata record must not become a second monetary source of truth.

### Keep both beneficiary models as writable authorities

Rejected. Two transfer-facing writers would allow divergent recipient status, verification, destination normalization, and history. One preferred authority and one compatibility path are required.

### Make compliance cases or risk assessments the policy engine

Rejected. Evidence records and action-specific policy outputs have different lifecycles, explainability, and ownership. A4 must consume evidence without rewriting it.

### Use authentication metadata as runtime authorization

Rejected. Stored hashes and recovery metadata do not provide a protected principal, session, role, approval, or revocation boundary. Those decisions belong to A2.

### Allow projections to update their source for convenience

Rejected. It obscures authority, breaks auditability, and makes reconciliation or replay unsafe. Commands must cross the owning contract.

## Consequences

### Positive

- Every major concept has one authoritative owner before runtime activation.
- Customer identity and financial value remain safely separated.
- Later policy, account-binding, access, and financial work can consume stable contracts.
- Legacy overlap is preserved for migration without allowing competing writers.
- Projections, operational controls, and external adapters have explicit read-only boundaries.
- Identifier, privacy, retention, and legal-hold decisions have an owning source domain.

### Trade-offs

- Some existing schemas retain compatibility values until A3/A5/A6 mappings are approved.
- A4 must define policy precedence and A2 must define runtime access before the foundation can authorize financial commands.
- Beneficiary consolidation requires migration and history planning rather than an immediate table deletion.
- Domain teams must use cross-domain contracts instead of direct shared-table writes.

## Dependencies

- **ADR-0001:** domain-oriented architecture and owned data.
- **ADR-0002:** exact money and currency representation.
- **ADR-0003:** durable event facts, correlation, causation, and replay safety.
- **ADR-0004:** ledger-backed wallet and immutable financial value.
- **ADR-0005:** independent reconciliation.
- **ADR-0008/0009:** shared operational and production-readiness contracts.
- **ADR-0012:** canonical Customer Foundation identity and financial separation.
- **ADR-0013/0014:** onboarding, eligibility, restrictions, limits, enrollment, and permissions.
- **ADR-0015/0016/0017/0018/0019:** wallet metadata, funding instruments, beneficiaries, preferences, and authentication metadata.
- [`CUSTOMER-ADJACENT-OVERLAP-REVIEW.md`](../CUSTOMER-ADJACENT-OVERLAP-REVIEW.md)
- [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](../RISK-COMPLIANCE-AUTHORITY-REVIEW.md)
- [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](../IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)
- [`CANONICAL-OWNERSHIP-MATRIX.md`](../CANONICAL-OWNERSHIP-MATRIX.md)

Planned ADR-0022, ADR-0023, and ADR-0024 provide later focused decisions for risk/policy authority, identifier conventions, and privacy/retention. They must remain consistent with this ownership decision.

## Verification

A1T10 verification for this ADR requires:

- Ownership matrix-to-ADR consistency review.
- One-owner check for customer, wallet, ledger, beneficiary, funding-instrument, risk, compliance, authentication, preference, operations, and policy concepts.
- Prohibited-shared-write review.
- Financial-boundary review confirming ledger ownership of balances, journals, and lines.
- Scope check confirming no code, migration, API, module, or runtime behavior is introduced.
