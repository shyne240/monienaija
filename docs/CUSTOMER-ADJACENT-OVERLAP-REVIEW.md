# Customer and Adjacent Model Overlap Review

- Task: A1T05 — Customer and Adjacent Model Overlap Review
- Scope: Customer identity/profile, wallet/account, beneficiary, funding-instrument, preference, authentication, authorization, device, and recovery boundaries
- Classification: Documentation-only architecture decision input
- Application code changed: None

## 1. Purpose

This review converts the A1T02-A1T04 inventories into explicit ownership and consolidation decisions for the Customer Foundation and its adjacent financial/security models.

It does not implement a policy engine, authentication runtime, account binding, transfer flow, external integration, migration, or application refactor.

## 2. Decision summary

| Area                          | Authoritative owner                                         | Current classification            | Decision                                                                  |
| ----------------------------- | ----------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Customer identity and profile | `customer`                                                  | Canonical source of truth         | Continue as the sole customer identity owner.                             |
| Customer-wallet metadata      | `customer-wallet`                                           | Metadata-only provisioning record | Keep separate from financial wallets; bind explicitly in A3.              |
| Financial wallet and balances | `wallet` plus `ledger`                                      | Canonical financial authority     | Ledger remains the source of value and balance truth.                     |
| Ledger wallet/accounts        | `ledger`                                                    | Canonical financial source        | No customer metadata may write or duplicate balances.                     |
| Beneficiaries                 | A1 decision required; P1.6 preferred for customer ownership | Overlapping metadata models       | Consolidate transfer-facing authority before A5.                          |
| Funding instruments           | `customer-funding-instrument`                               | Registration metadata             | Keep metadata-only until A6 external funding policy.                      |
| Preferences                   | `customer-preference`                                       | Customer configuration metadata   | Keep separate from notification delivery and enforcement.                 |
| Authentication metadata       | `customer-authentication`                                   | Credential/recovery metadata      | Keep as source metadata; runtime access belongs to A2.                    |
| Runtime authentication        | Future A2 identity/access boundary                          | Missing capability                | Do not add runtime behavior in A1.                                        |
| Authorization                 | Future A2 authorization boundary                            | Missing capability                | Keep separate from authentication and policy decisions.                   |
| Devices and recovery          | `customer-authentication`                                   | Security metadata                 | Keep hash-only metadata separate from runtime device/session enforcement. |

## 3. Customer identity and profile

### Current models

- `Customer`, `CustomerProfile`, `CustomerAddress`, `CustomerContactMethod`, `CustomerIdentityDocument`, and `CustomerKycAssessment` in `customer`.
- Customer-owned metadata modules reference `customerId` but do not own customer identity fields.
- Financial modules may retain legacy/opaque customer references for compatibility.

### Decision

- **Authoritative owner:** `customer`.
- **Metadata/projection status:** Customer profile and identity records are canonical customer-domain records, not projections.
- **Ownership recommendation:** All customer-owned modules reference the canonical customer UUID. They must not create duplicate profile, contact, address, or identity-document records.
- **Migration recommendation:** A3 and later account-binding work must map legacy opaque customer references to canonical customer UUIDs through an explicit mapping, not by rewriting financial truth in place.
- **Deprecation recommendation:** Deprecate new writes to any non-customer identity fields outside the `customer` module. Preserve existing legacy values for compatibility until mapped.
- **Projection recommendation:** Customer summaries in reports or portals are read-only projections of `customer` data.
- **Future phase:** A1 ownership decision; A3 identity/account binding; A2 runtime access.

## 4. Customer-wallet metadata versus financial wallet

### Current models

- `CustomerWallet`, `WalletProvisioningHistory`, `WalletAlias`, and `WalletOwnership` in `customer-wallet`.
- `WalletAccount` in `wallet`, backed by ledger account IDs.
- `LedgerAccount`, `LedgerJournal`, and `LedgerLine` in `ledger`.

### Decision

- **Authoritative owner:** `wallet` and `ledger` own financial wallet/account state and balances.
- **Metadata/projection status:** `CustomerWallet` is provisioning metadata, not a financial account and not a balance projection.
- **Ownership recommendation:** Customer-wallet records may reference a future binding record, but must not own `ledgerAccountId` as an ungoverned duplicate or store a balance.
- **Migration recommendation:** A3 must introduce an explicit customer-wallet-to-financial-account binding and reconcile customer UUID, currency, accounting unit, wallet status, and ledger account ownership.
- **Deprecation recommendation:** Do not introduce new financial behavior into `customer-wallet`. Retain it as the provisioning/identity-facing record until the A3 binding is authoritative.
- **Projection recommendation:** Customer-wallet status may project provisioning state; financial wallet status and balances must be read from `wallet`/`ledger`.
- **Future phase:** A3 Customer-to-Financial Account Binding.

## 5. Ledger wallet and ledger accounts

### Current models

- `WalletAccount` is the financial wallet facade.
- `LedgerAccount` is the account authority.
- `LedgerJournal` and `LedgerLine` are the immutable movement authority.
- `ReconciliationService` independently verifies financial consistency.

### Decision

- **Authoritative owner:** `ledger` for accounts, journals, lines, and balances; `wallet` for the wallet-to-ledger facade relationship.
- **Metadata/projection status:** Reconciliation, reports, and customer wallet summaries are projections or controls.
- **Ownership recommendation:** Only ledger services post or reverse financial journals. Customer modules may request or describe a capability but may not mutate ledger state.
- **Migration recommendation:** No migration may copy balances into customer tables. A3 must use a binding/reference model and independent reconciliation.
- **Deprecation recommendation:** Deprecate any future direct balance or wallet-account mutation outside the ledger boundary.
- **Projection recommendation:** All customer-facing balances are ledger-derived read models with explicit currency and accounting context.
- **Future phase:** A3 binding; A5 internal financial pilot.

## 6. Legacy beneficiary versus Customer Beneficiary

### Current models

- `Beneficiary` in the legacy `beneficiary` module.
- `CustomerBeneficiary`, `BeneficiaryOwnership`, `BeneficiaryVerification`, and `BeneficiaryHistory` in `customer-beneficiary`.
- M6 bank and virtual-account tooling may consume legacy beneficiary data.

### Decision

- **Authoritative owner:** A1 recommends P1.6 `customer-beneficiary` as the future customer-owned transfer-recipient authority, subject to formal ADR-0021 approval.
- **Metadata/projection status:** The legacy `beneficiary` model is a compatibility/legacy metadata model until migration is approved.
- **Ownership recommendation:** Customer beneficiaries own customer relationship, destination metadata, ownership, verification, and recipient history. Legacy records must not become a second writable customer-recipient authority.
- **Migration recommendation:** A5 must define field mapping, reference collision handling, duplicate destination handling, history retention, and a reversible migration or compatibility projection.
- **Deprecation recommendation:** Stop adding new transfer-facing writes to the legacy model after the canonical model is approved. Do not delete historical legacy records without retention approval.
- **Projection recommendation:** A legacy compatibility view may project from the canonical customer beneficiary; the canonical model must not write back through the legacy service.
- **Future phase:** A1 decision; A5 Internal Financial Pilot; A6 external rails.

## 7. Funding instruments

### Current models

- `CustomerFundingInstrument` and its ownership, verification, and history records in `customer-funding-instrument`.
- Local `Bank` metadata in `bank`.
- Existing payment and settlement support in `payment`.

### Decision

- **Authoritative owner:** `customer-funding-instrument` for customer registration and lifecycle metadata.
- **Metadata/projection status:** Funding instruments are registration and verification metadata, not bank-owned accounts and not settlement proof.
- **Ownership recommendation:** The customer funding-instrument module owns declared references and internal verification records. Bank directory data remains owned by `bank`.
- **Migration recommendation:** A6 must define mapping from funding-instrument references to external-provider references and settlement accounts without changing historical customer registration records.
- **Deprecation recommendation:** Do not add provider callbacks, account ownership checks, or bank synchronization to the P1.5 module.
- **Projection recommendation:** External-provider status, when introduced in A6, must be a separate adapter/settlement projection with correlation to the customer instrument.
- **Future phase:** A1 boundary decision; A6 External Partners & Settlement.

## 8. Preferences

### Current models

- `CustomerPreference` and embedded language, theme, notification, and security values in `customer-preference`.
- No notification delivery provider or background delivery worker is present in the Customer Foundation.

### Decision

- **Authoritative owner:** `customer-preference` for customer-selected preferences.
- **Metadata/projection status:** Preferences are customer configuration metadata; delivery receipts, job status, and provider outcomes would be operational projections owned by a future notification subsystem.
- **Ownership recommendation:** Notification delivery must read preferences through an explicit contract and must not rewrite the preference profile as delivery state.
- **Migration recommendation:** Future notification jobs must reference preference version and channel at decision time; historical preferences remain available for audit and consent interpretation.
- **Deprecation recommendation:** Do not add provider state, delivery attempts, or notification queues to `customer-preference`.
- **Projection recommendation:** Customer portal and notification policy views may project preferences but cannot write the source profile except through the preference API.
- **Future phase:** A2 for security/access implications; A7 Product Expansion Infrastructure for notification delivery.

## 9. Authentication metadata

### Current models

- `CustomerAuthenticationCredential`.
- `PasswordHistory`.
- `PasswordResetRequest` and `PasswordResetToken`.
- `MfaEnrollment` and `MfaMethod`.
- `TrustedDevice`.
- `RecoveryCode`.
- `SecurityEventHistory`.

### Decision

- **Authoritative owner:** `customer-authentication` for credential and recovery metadata.
- **Metadata/projection status:** All current records are metadata, evidence, or lifecycle history. They do not authenticate a request.
- **Ownership recommendation:** Credential hash metadata, lock state, reset metadata, MFA enrollment metadata, device metadata, and recovery-code metadata remain in this domain.
- **Migration recommendation:** A2 runtime authentication must consume metadata through a controlled service contract and must not duplicate password hashes, sessions, or lock state in unrelated modules.
- **Deprecation recommendation:** Do not introduce login, JWT, sessions, cookies, OTP delivery, or authorization into P1.8 metadata modules.
- **Projection recommendation:** Runtime session, token, and access-decision views are ephemeral/runtime projections and must not become credential storage.
- **Future phase:** A1 boundary decision; A2 Runtime Identity & Access.

## 10. Runtime authentication

### Current state

- No login endpoint.
- No JWT/session implementation.
- No cookies.
- No authentication middleware.
- No authorization guards.
- P1.8 stores only credential and recovery metadata.

### Decision

- **Authoritative owner:** Future A2 identity/access boundary.
- **Metadata/projection status:** P1.8 is the source of credential metadata; future sessions, tokens, and authentication decisions are runtime state/projections.
- **Ownership recommendation:** A2 must own credential verification orchestration, session/token lifecycle, revocation, MFA challenges, and authentication middleware.
- **Migration recommendation:** A2 must define a controlled adoption path from P1.8 metadata without duplicating hashes or breaking recovery history.
- **Deprecation recommendation:** Internal deployment/network restrictions must remain the exposure control until A2 is approved.
- **Projection recommendation:** Authentication decisions may reference P1.8 evidence but must not rewrite customer identity or financial state.
- **Future phase:** A2 Runtime Identity & Access.

## 11. Authorization

### Current state

- No runtime authorization authority or enforcement layer is implemented.
- Customer eligibility and operating-status APIs are decision metadata, not authorization middleware.
- Product governance readiness is governance evidence, not access control.

### Decision

- **Authoritative owner:** Future A2 authorization boundary, with A4 policy decisions as an input.
- **Metadata/projection status:** P1.3 eligibility, restrictions, product enrollment, risk, and compliance data are policy inputs; they are not complete authorization decisions.
- **Ownership recommendation:** A2 owns subject/action/resource authorization. A4 owns capability-policy decisions. Financial services consume both contracts but do not implement separate authorization rules.
- **Migration recommendation:** Future authorization must map existing actor/customer UUIDs and preserve audit correlation without adding authorization columns to every domain table.
- **Deprecation recommendation:** Remove deployment-only assumptions when A2 is active, but retain defense-in-depth network controls.
- **Projection recommendation:** Customer operating-status and product-entitlement views may explain policy outcomes but cannot grant access independently.
- **Future phase:** A1 decision; A2 implementation; A4 policy integration.

## 12. Devices and recovery metadata

### Current models

- `TrustedDevice` stores device reference, platform, display name, and fingerprint hash.
- `RecoveryCode` stores code hash, version, status, and usage metadata.
- `PasswordResetRequest` and `PasswordResetToken` store recovery lifecycle metadata.

### Decision

- **Authoritative owner:** `customer-authentication` for stored device and recovery metadata.
- **Metadata/projection status:** Device trust decisions, sessions, recovery challenges, and delivery outcomes are future runtime projections or operational records.
- **Ownership recommendation:** Hash-only device and recovery data remains within the authentication metadata boundary.
- **Migration recommendation:** A2 must define token/device revocation and recovery completion contracts without copying secrets or changing historical records.
- **Deprecation recommendation:** No raw recovery code, reset token, device fingerprint, OTP, or secret may be introduced.
- **Projection recommendation:** Runtime trusted-device and recovery status views must reference metadata and audit events; they must not create independent identity records.
- **Future phase:** A2 Runtime Identity & Access.

## 13. Data-sensitivity observations

| Data area                       | Sensitivity                             | Current handling                                                | A1 decision input                            |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| Customer identity/profile       | High personal data                      | Customer-owned PostgreSQL records, audited mutations.           | No duplicate identity writers.               |
| Identity documents/KYC          | High sensitive identity/compliance data | Metadata only; no external verification in Customer Foundation. | A2/A6 access and external-sharing controls.  |
| Wallet/account references       | High financial context                  | Wallet metadata separated from ledger authority.                | A3 mapping and least-privilege reads.        |
| Funding instruments             | High financial/identifier data          | Registration metadata and internal verification.                | A6 provider/settlement boundary.             |
| Beneficiary destinations        | High personal/financial data            | Normalized customer-owned metadata.                             | A5 canonical transfer authority.             |
| Risk/compliance cases           | Sensitive risk/compliance data          | Manual metadata and append-only history.                        | A4 policy evidence, retention, and access.   |
| Password/recovery/device hashes | Security-sensitive                      | Hash-only fields, no plaintext values.                          | A2 secret handling and access controls.      |
| Preferences                     | Personal configuration                  | Versioned customer-owned profile.                               | A7 delivery consumers must not write source. |
| Audit/security events           | Sensitive operational history           | Immutable/append-only operational records.                      | Retention and privileged access.             |
| Financial ledger data           | Financial authority                     | Immutable journal/line records and independent reconciliation.  | Never duplicate into customer domains.       |

## 14. Consolidation decisions required by A1

1. Adopt `customer` as the sole customer identity and profile authority.
2. Preserve `ledger` as the sole financial value authority.
3. Keep `CustomerWallet` as provisioning metadata and defer binding to A3.
4. Select P1.6 `customer-beneficiary` as the preferred future transfer-facing recipient authority, subject to ADR-0021.
5. Keep P1.5 funding instruments metadata-only until A6.
6. Keep preferences independent from notification delivery.
7. Keep P1.8 authentication metadata independent from A2 runtime authentication.
8. Keep authorization separate from both authentication and A4 capability policy.
9. Keep devices and recovery hashes inside the authentication metadata boundary.
10. Carry these decisions into ADR-0021 and ADR-0024 without implementing them in A1T05.

## 15. A1T05 acceptance evidence

A1T05 is complete when:

- The ten scoped Customer and adjacent areas are reviewed.
- The overlap report identifies authority, metadata/projection status, ownership, migration, deprecation, projection, data sensitivity, and future phase for each area.
- Wallet/account binding inputs are explicit.
- Beneficiary consolidation inputs are explicit.
- Authentication metadata/runtime inputs are explicit.
- Preferences are explicitly separated from delivery.
- No application code, module, entity, API, migration, or test is changed.
