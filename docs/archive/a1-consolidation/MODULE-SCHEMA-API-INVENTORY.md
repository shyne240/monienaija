# Module, Schema, Entity, Service, and API Inventory

- Task: A1T03 — Module, Schema, and API Inventory
- Review point: current M0-M9 and P1.0-P1.10 implementation baseline
- Classification: Documentation-only technical inventory
- API prefix: `/api/v1`
- Runtime status: Routes exist in the modular monolith; internal routes are not production-public until A2.

## 1. Inventory rules

- Every NestJS module has one owning domain or platform owner.
- Every TypeORM entity has one owning module.
- Every database table has one owning migration/domain.
- Every controller route has one owning controller.
- Financial truth is owned by the ledger; reports and customer metadata are not balance authorities.
- A module may read another domain through an explicit dependency, but shared-table writes are prohibited.
- “Public API” below means an implemented HTTP route, not permission to expose the route publicly.

## 2. Module inventory

### 2.1 Composition and infrastructure modules

| Module               | Purpose                                                                                               | Controllers                   | Services                                                                                                                                | Entities/tables                                                                                                                                          | Endpoints                                                                                                                               | Dependencies                                             | Owning domain                     | Classification            | Status                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------- | ------------------------- | ------------------------------------------ |
| `AppModule`          | Composition root, global configuration, TypeORM, logging, and module registration.                    | None                          | None                                                                                                                                    | Root TypeORM entity discovery                                                                                                                            | All application routes                                                                                                                  | All registered modules                                   | Platform Engineering              | Composition               | Implemented.                               |
| `health`             | Process and basic readiness health.                                                                   | `HealthController`            | `HealthService`                                                                                                                         | None                                                                                                                                                     | `GET /health`; `GET /health/ready`                                                                                                      | Configuration/runtime                                    | Platform Operations               | Projection/read model     | Implemented.                               |
| `operations`         | Audit, idempotency, outbox, metrics, and diagnostics.                                                 | `OperationsController`        | `AuditService`, `DiagnosticsService`, `IdempotencyService`, `MetricsService`, `OutboxService`                                           | `AuditEvent` → `audit_events`; `IdempotencyRecord` → `idempotency_records`; `OperationalMetric` → `operational_metrics`; `OutboxEvent` → `outbox_events` | `GET /internal/metrics`; `GET /internal/diagnostics`; `GET /internal/audit`; `GET /internal/outbox`                                     | PostgreSQL; `reconciliation`                             | Platform Operations               | Infrastructure            | Implemented shared authority.              |
| `production`         | Configuration, API metadata, request context, readiness, request tracking, and shutdown.              | `ProductionController`        | `ApiVersionService`, `GracefulShutdownService`, `ProductionConfigurationService`, `ProductionReadinessService`, `RequestTrackerService` | None                                                                                                                                                     | `GET /internal/version`; `/configuration`; `/deployment`; `/readiness`                                                                  | `reconciliation`; configuration; HTTP runtime            | Platform Engineering / Operations | Infrastructure            | Implemented; access protection remains A2. |
| `maturity`           | Operational dashboards, reports, maintenance, retention, acceptance, and startup governance metadata. | `MaturityController`          | `GovernanceService`, `MaturityService`, `OperationalReportService`, `RetentionService`                                                  | `GovernanceMetadata` → `governance_metadata`                                                                                                             | Internal health dashboard, acceptance, maintenance, daily/ledger/wallet/transfer/deposit/withdrawal/reconciliation/outbox/audit reports | `operations`; `production`; `reconciliation`; PostgreSQL | Platform Operations / Governance  | Governance and projection | Implemented; manually operated.            |
| `product-governance` | Product, regulatory, launch, partner, ownership, and readiness records.                               | `ProductGovernanceController` | `ProductGovernanceService`                                                                                                              | `ProductGovernanceRecord` → `product_governance_records`                                                                                                 | `POST/GET/PATCH /internal/product-governance/records`; report; readiness; configuration                                                 | `operations`; PostgreSQL                                 | Product / Regulatory Governance   | Governance                | Implemented; non-financial.                |

### 2.2 Financial and product modules

| Module            | Purpose                                                                        | Controllers                                         | Services                                              | Entities/tables                                                                                         | Endpoints                                                                              | Dependencies                                     | Owning domain                 | Classification                   | Status                                              |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------- | -------------------------------- | --------------------------------------------------- |
| `ledger`          | Authoritative double-entry accounts, journals, lines, balances, and reversals. | `LedgerController`                                  | `LedgerService`                                       | `LedgerAccount` → `ledger_accounts`; `LedgerJournal` → `ledger_journals`; `LedgerLine` → `ledger_lines` | Account create/list/detail/balance; journal create/detail/reversal under `/ledger`     | PostgreSQL; common money rules                   | Finance / Ledger Engineering  | Canonical source of truth        | Implemented financial authority.                    |
| `wallet`          | Ledger-backed financial wallet facade.                                         | `WalletController`                                  | `WalletService`                                       | `WalletAccount` → `wallet_accounts`                                                                     | `POST/GET /wallets`; `GET /wallets/:walletId`; `GET /wallets/:walletId/balance`        | `ledger`; PostgreSQL                             | Wallet / Finance              | Canonical financial facade       | Implemented.                                        |
| `transfer`        | Internal transfer lifecycle and wallet transaction history.                    | `TransferController`, `WalletTransactionController` | `TransferService`                                     | `Transfer` → `transfers`                                                                                | `POST /transfers`; `GET /transfers/:transferId`; `GET /wallets/:walletId/transactions` | `ledger`; `payment`; wallet entities; PostgreSQL | Payments / Finance            | Canonical financial lifecycle    | Implemented internal flow.                          |
| `deposit`         | Controlled internal deposit lifecycle and journal-backed completion.           | `DepositController`                                 | `DepositService`                                      | `Deposit` → `deposits`                                                                                  | `POST/GET /deposits`; detail; complete/fail/cancel                                     | `ledger`; `payment`; PostgreSQL                  | Payments / Finance            | Canonical financial lifecycle    | Implemented; no external rail.                      |
| `withdrawal`      | Controlled internal withdrawal lifecycle and journal-backed processing.        | `WithdrawalController`                              | `WithdrawalService`                                   | `Withdrawal` → `withdrawals`                                                                            | `POST/GET /withdrawals`; detail; process/complete/fail/cancel                          | `ledger`; `payment`; PostgreSQL                  | Payments / Finance            | Canonical financial lifecycle    | Implemented; no external rail.                      |
| `payment`         | Shared payment references and settlement account support.                      | None                                                | `PaymentReferenceService`, `SettlementAccountService` | `PaymentReference` → `payment_references`                                                               | No standalone controller; consumed by payment domains                                  | `ledger`; PostgreSQL                             | Payments / Finance            | Infrastructure/support authority | Implemented.                                        |
| `quote`           | Immutable payment quote metadata and quote lifecycle.                          | `QuoteController`                                   | `QuoteService`                                        | `PaymentQuote` → `payment_quotes`                                                                       | `POST/GET /quotes`; `POST /quotes/:id/use`                                             | `payment`; PostgreSQL; money/fee rules           | Payments / Product            | Metadata/decision tooling        | Implemented; non-money-moving creation/use tooling. |
| `fee`             | Integer-safe fee and VAT calculation.                                          | `FeeController`                                     | `FeeEngine`                                           | None                                                                                                    | `POST /fees/calculate`                                                                 | Common money rules                               | Finance / Payments            | Projection/decision tooling      | Implemented pure calculation.                       |
| `limit`           | Caller-supplied transaction limit evaluation.                                  | `LimitController`                                   | `LimitEngine`                                         | None                                                                                                    | `POST /limits/evaluate`                                                                | Common money rules                               | Risk / Payments               | Projection/decision tooling      | Implemented pure evaluation.                        |
| `bank`            | Local bank directory metadata.                                                 | `BankController`                                    | `BankService`                                         | `Bank` → `banks`                                                                                        | `POST/GET /banks`; detail/update/delete                                                | PostgreSQL                                       | Product Operations / Payments | Metadata-only                    | Implemented local directory.                        |
| `beneficiary`     | Legacy M6 beneficiary metadata.                                                | `BeneficiaryController`                             | `BeneficiaryService`                                  | `Beneficiary` → `beneficiaries`                                                                         | `POST/GET /beneficiaries`; detail/update/delete                                        | PostgreSQL                                       | Legacy Product / Payments     | Compatibility metadata           | Implemented; consolidation candidate with P1.6.     |
| `virtual-account` | Local virtual-account assignment metadata.                                     | `VirtualAccountController`                          | `VirtualAccountService`                               | `VirtualAccount` → `virtual_accounts`                                                                   | `POST/GET /virtual-accounts`; lookup/detail/deactivate                                 | `payment`; `wallet`; PostgreSQL                  | Payments / Product            | Metadata-only product tooling    | Implemented; no external account integration.       |
| `reconciliation`  | Independent finance verification and reconciliation reports.                   | `ReconciliationController`                          | `ReconciliationService`                               | No owned tables                                                                                         | Internal reconciliation report, trial balance, finance, and account activity routes    | Read-only PostgreSQL queries                     | Finance / Operations          | Independent control/projection   | Implemented; not a writer.                          |

### 2.3 Customer Foundation modules

| Module                        | Purpose                                                                                       | Controllers                           | Services                           | Entities/tables                                                                                                                                                                                                                                                                        | Endpoints                                                                                | Dependencies                                                | Owning domain                           | Classification                 | Status                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| `customer`                    | Customer identity, profile, contact, address, identity-document, and KYC metadata.            | `CustomerController`                  | `CustomerService`                  | `Customer` → `customers`; `CustomerProfile` → `customer_profiles`; `CustomerAddress` → `customer_addresses`; `CustomerContactMethod` → `customer_contact_methods`; `CustomerIdentityDocument` → `customer_identity_documents`; `CustomerKycAssessment` → `customer_kyc_assessments`    | `/customers` CRUD; profile; address; contact; identity-document; KYC routes              | `operations`; PostgreSQL                                    | Customer Operations / Compliance        | Canonical source of truth      | P1.1 implemented.                                             |
| `customer-onboarding`         | Onboarding workflow, agreements, tasks, decisions, and readiness.                             | `CustomerOnboardingController`        | `CustomerOnboardingService`        | `CustomerOnboarding` → `customer_onboardings`; `CustomerAgreement` → `customer_agreements`; `CustomerOnboardingTask` → `customer_onboarding_tasks`; `CustomerApprovalDecision` → `customer_approval_decisions`; onboarding-era `CustomerRiskProfile` → `customer_risk_profiles`        | Onboarding, agreements, tasks, approval, readiness routes under `/customers/:id`         | `customer`; `operations`; PostgreSQL                        | Customer Operations / Risk              | Canonical workflow metadata    | P1.2 implemented.                                             |
| `customer-eligibility`        | Eligibility, restrictions, limits, product enrollment, permissions, and operating status.     | `CustomerEligibilityController`       | `CustomerEligibilityService`       | `CustomerEligibility` → `customer_eligibilities`; `CustomerLimitProfile` → `customer_limit_profiles`; `CustomerProductEnrollment` → `customer_product_enrollments`; `CustomerOperatingPermission` → `customer_operating_permissions`; `CustomerRestriction` → `customer_restrictions`  | Eligibility, limit-profile, enrollment, permission, restriction, operating-status routes | `customer`; `customer-onboarding`; `operations`; PostgreSQL | Risk / Product Operations               | Decision metadata/policy input | P1.3 implemented; not the central policy authority.           |
| `customer-wallet`             | Provisioning metadata for customer wallets without ledger interaction.                        | `CustomerWalletController`            | `CustomerWalletService`            | `CustomerWallet` → `customer_wallets`; `WalletProvisioningHistory` → `wallet_provisioning_histories`; `WalletAlias` → `wallet_aliases`; `WalletOwnership` → `wallet_ownerships`                                                                                                        | Wallet create/list/detail/update; alias; history; ownership routes                       | `customer`; onboarding; eligibility; operations; PostgreSQL | Customer Operations / Wallet Operations | Metadata-only                  | P1.4 implemented; future A3 binding candidate.                |
| `customer-funding-instrument` | Funding-instrument registration and internal verification metadata.                           | `CustomerFundingInstrumentController` | `CustomerFundingInstrumentService` | `CustomerFundingInstrument` → `customer_funding_instruments`; `FundingInstrumentOwnership` → `funding_instrument_ownerships`; `FundingInstrumentVerification` → `funding_instrument_verifications`; `FundingInstrumentHistory` → `funding_instrument_histories`                        | Funding-instrument registration, detail, update, verify, history, ownership              | `customer`; `operations`; PostgreSQL                        | Customer Operations / Payments Risk     | Metadata-only                  | P1.5 implemented; no bank/NIBSS integration.                  |
| `customer-beneficiary`        | Customer-owned trusted recipient metadata.                                                    | `CustomerBeneficiaryController`       | `CustomerBeneficiaryService`       | `CustomerBeneficiary` → `customer_beneficiaries`; `BeneficiaryOwnership` → `beneficiary_ownerships`; `BeneficiaryVerification` → `beneficiary_verifications`; `BeneficiaryHistory` → `beneficiary_histories`                                                                           | Beneficiary registration, detail, update, verify, history, ownership                     | `customer`; `operations`; PostgreSQL                        | Customer Operations / Payments Risk     | Metadata-only                  | P1.6 implemented; overlaps legacy `beneficiary`.              |
| `customer-preference`         | Language, theme, notification, and security preference metadata.                              | `CustomerPreferenceController`        | `CustomerPreferenceService`        | `CustomerPreference` → `customer_preferences`; embedded language/theme/notification/security values; `PreferenceHistory` → `preference_histories`                                                                                                                                      | Preferences create/read/update/history                                                   | `customer`; `operations`; PostgreSQL                        | Customer Operations / Product           | Metadata-only                  | P1.7 implemented; no delivery or enforcement.                 |
| `customer-authentication`     | Credential, password, recovery, MFA, device, recovery-code, and security-event metadata.      | `CustomerAuthenticationController`    | `CustomerAuthenticationService`    | Credential, password-history, reset-request/token, MFA, trusted-device, recovery-code, security-event entities                                                                                                                                                                         | Credential, rotation, failed-attempt, unlock, reset, MFA, devices, recovery, events      | `customer`; `operations`; PostgreSQL                        | Security / Customer Operations          | Metadata-only                  | P1.8 implemented; no runtime authentication or authorization. |
| `customer-compliance`         | Compliance case lifecycle, assignments, comments, evidence metadata, resolution, and history. | `CustomerComplianceController`        | `CustomerComplianceService`        | `CustomerComplianceCase` → `customer_compliance_cases`; `ComplianceCaseHistory` → `compliance_case_histories`; `ComplianceCaseAssignment` → `compliance_case_assignments`; `ComplianceCaseComment` → `compliance_case_comments`; `ComplianceCaseEvidence` → `compliance_case_evidence` | Case, comment, evidence, assignment, history routes                                      | `customer`; `operations`; PostgreSQL                        | Compliance / Risk Operations            | Metadata-only workflow         | P1.9 implemented; no screening engine.                        |
| `customer-risk-profile`       | Manual customer risk assessment and factor histories.                                         | `CustomerRiskProfileController`       | `CustomerRiskProfileService`       | `CustomerRiskProfile` → `customer_risk_assessments`; `CustomerRiskFactor` → `customer_risk_assessment_factors`; `RiskProfileHistory` → `risk_assessment_histories`; `RiskFactorHistory` → `risk_assessment_factor_histories`                                                           | Risk-profile create/read/update/reassess/history                                         | `customer`; `operations`; PostgreSQL                        | Risk / Compliance                       | Metadata-only decision input   | P1.10 implemented; no automated risk engine.                  |

## 3. Complete entity and table inventory

The following inventory includes every TypeORM `@Entity` discovered in `src`. Embedded preference value objects are listed separately because they do not own tables.

| Owning module                 | Entity                             | Database table                        | Role                                       |
| ----------------------------- | ---------------------------------- | ------------------------------------- | ------------------------------------------ |
| `bank`                        | `Bank`                             | `banks`                               | Local bank metadata.                       |
| `beneficiary`                 | `Beneficiary`                      | `beneficiaries`                       | Legacy beneficiary metadata.               |
| `customer`                    | `Customer`                         | `customers`                           | Canonical customer identity.               |
| `customer`                    | `CustomerProfile`                  | `customer_profiles`                   | Customer profile.                          |
| `customer`                    | `CustomerAddress`                  | `customer_addresses`                  | Customer address.                          |
| `customer`                    | `CustomerContactMethod`            | `customer_contact_methods`            | Customer email/phone metadata.             |
| `customer`                    | `CustomerIdentityDocument`         | `customer_identity_documents`         | Identity-document metadata.                |
| `customer`                    | `CustomerKycAssessment`            | `customer_kyc_assessments`            | KYC assessment metadata.                   |
| `customer-authentication`     | `CustomerAuthenticationCredential` | `customer_authentication_credentials` | Password credential metadata.              |
| `customer-authentication`     | `PasswordHistory`                  | `password_histories`                  | Append-only password history.              |
| `customer-authentication`     | `PasswordResetRequest`             | `password_reset_requests`             | Recovery request lifecycle.                |
| `customer-authentication`     | `PasswordResetToken`               | `password_reset_tokens`               | Hashed token metadata.                     |
| `customer-authentication`     | `MfaEnrollment`                    | `mfa_enrollments`                     | MFA enrollment metadata.                   |
| `customer-authentication`     | `MfaMethod`                        | `mfa_methods`                         | MFA method metadata.                       |
| `customer-authentication`     | `TrustedDevice`                    | `trusted_devices`                     | Device metadata.                           |
| `customer-authentication`     | `RecoveryCode`                     | `recovery_codes`                      | Hashed recovery-code metadata.             |
| `customer-authentication`     | `SecurityEventHistory`             | `security_event_histories`            | Security event history.                    |
| `customer-beneficiary`        | `CustomerBeneficiary`              | `customer_beneficiaries`              | Customer trusted recipient.                |
| `customer-beneficiary`        | `BeneficiaryOwnership`             | `beneficiary_ownerships`              | Beneficiary ownership.                     |
| `customer-beneficiary`        | `BeneficiaryVerification`          | `beneficiary_verifications`           | Beneficiary verification history.          |
| `customer-beneficiary`        | `BeneficiaryHistory`               | `beneficiary_histories`               | Beneficiary lifecycle history.             |
| `customer-compliance`         | `CustomerComplianceCase`           | `customer_compliance_cases`           | Compliance case.                           |
| `customer-compliance`         | `ComplianceCaseHistory`            | `compliance_case_histories`           | Case history.                              |
| `customer-compliance`         | `ComplianceCaseAssignment`         | `compliance_case_assignments`         | Assignment history.                        |
| `customer-compliance`         | `ComplianceCaseComment`            | `compliance_case_comments`            | Immutable comment.                         |
| `customer-compliance`         | `ComplianceCaseEvidence`           | `compliance_case_evidence`            | Evidence metadata.                         |
| `customer-eligibility`        | `CustomerEligibility`              | `customer_eligibilities`              | Eligibility record.                        |
| `customer-eligibility`        | `CustomerLimitProfile`             | `customer_limit_profiles`             | Customer limit configuration.              |
| `customer-eligibility`        | `CustomerProductEnrollment`        | `customer_product_enrollments`        | Product enrollment.                        |
| `customer-eligibility`        | `CustomerOperatingPermission`      | `customer_operating_permissions`      | Operating permission.                      |
| `customer-eligibility`        | `CustomerRestriction`              | `customer_restrictions`               | Customer restriction.                      |
| `customer-funding-instrument` | `CustomerFundingInstrument`        | `customer_funding_instruments`        | Funding instrument.                        |
| `customer-funding-instrument` | `FundingInstrumentOwnership`       | `funding_instrument_ownerships`       | Instrument ownership.                      |
| `customer-funding-instrument` | `FundingInstrumentVerification`    | `funding_instrument_verifications`    | Instrument verification.                   |
| `customer-funding-instrument` | `FundingInstrumentHistory`         | `funding_instrument_histories`        | Instrument lifecycle history.              |
| `customer-onboarding`         | `CustomerOnboarding`               | `customer_onboardings`                | Onboarding workflow.                       |
| `customer-onboarding`         | `CustomerAgreement`                | `customer_agreements`                 | Agreement evidence.                        |
| `customer-onboarding`         | `CustomerOnboardingTask`           | `customer_onboarding_tasks`           | Onboarding task.                           |
| `customer-onboarding`         | `CustomerApprovalDecision`         | `customer_approval_decisions`         | Approval history.                          |
| `customer-onboarding`         | `CustomerRiskProfile`              | `customer_risk_profiles`              | Legacy onboarding-era risk representation. |
| `customer-preference`         | `CustomerPreference`               | `customer_preferences`                | Preference profile.                        |
| `customer-preference`         | `PreferenceHistory`                | `preference_histories`                | Preference history.                        |
| `customer-risk-profile`       | `CustomerRiskProfile`              | `customer_risk_assessments`           | P1.10 manual risk profile.                 |
| `customer-risk-profile`       | `CustomerRiskFactor`               | `customer_risk_assessment_factors`    | Current risk factors.                      |
| `customer-risk-profile`       | `RiskProfileHistory`               | `risk_assessment_histories`           | Assessment snapshots.                      |
| `customer-risk-profile`       | `RiskFactorHistory`                | `risk_assessment_factor_histories`    | Factor snapshots.                          |
| `customer-wallet`             | `CustomerWallet`                   | `customer_wallets`                    | Customer wallet metadata.                  |
| `customer-wallet`             | `WalletProvisioningHistory`        | `wallet_provisioning_histories`       | Provisioning history.                      |
| `customer-wallet`             | `WalletAlias`                      | `wallet_aliases`                      | Wallet alias.                              |
| `customer-wallet`             | `WalletOwnership`                  | `wallet_ownerships`                   | Wallet ownership.                          |
| `deposit`                     | `Deposit`                          | `deposits`                            | Deposit lifecycle.                         |
| `ledger`                      | `LedgerAccount`                    | `ledger_accounts`                     | Ledger account authority.                  |
| `ledger`                      | `LedgerJournal`                    | `ledger_journals`                     | Journal authority.                         |
| `ledger`                      | `LedgerLine`                       | `ledger_lines`                        | Journal-line authority.                    |
| `maturity`                    | `GovernanceMetadata`               | `governance_metadata`                 | Startup governance metadata.               |
| `operations`                  | `AuditEvent`                       | `audit_events`                        | Immutable audit authority.                 |
| `operations`                  | `IdempotencyRecord`                | `idempotency_records`                 | Idempotency authority.                     |
| `operations`                  | `OperationalMetric`                | `operational_metrics`                 | Operational counters.                      |
| `operations`                  | `OutboxEvent`                      | `outbox_events`                       | Durable event facts.                       |
| `payment`                     | `PaymentReference`                 | `payment_references`                  | Payment-reference authority.               |
| `product-governance`          | `ProductGovernanceRecord`          | `product_governance_records`          | Governance authority.                      |
| `quote`                       | `PaymentQuote`                     | `payment_quotes`                      | Quote metadata.                            |
| `transfer`                    | `Transfer`                         | `transfers`                           | Transfer lifecycle.                        |
| `virtual-account`             | `VirtualAccount`                   | `virtual_accounts`                    | Virtual-account metadata.                  |
| `wallet`                      | `WalletAccount`                    | `wallet_accounts`                     | Ledger-backed wallet facade.               |
| `withdrawal`                  | `Withdrawal`                       | `withdrawals`                         | Withdrawal lifecycle.                      |

### Embedded non-table value objects

- `LanguagePreference` — embedded in `CustomerPreference`.
- `ThemePreference` — embedded in `CustomerPreference`.
- `NotificationPreference` — embedded in `CustomerPreference`.
- `SecurityPreference` — embedded in `CustomerPreference`.

## 4. Complete controller and service inventory

| Controller                            | Owning module                 | Service                                                                                                                                 | Route prefix                   | Endpoint ownership                                          |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `BankController`                      | `bank`                        | `BankService`                                                                                                                           | `/banks`                       | Bank directory CRUD.                                        |
| `BeneficiaryController`               | `beneficiary`                 | `BeneficiaryService`                                                                                                                    | `/beneficiaries`               | Legacy beneficiary CRUD.                                    |
| `CustomerController`                  | `customer`                    | `CustomerService`                                                                                                                       | `/customers`                   | Customer identity and P1.1 subresources.                    |
| `CustomerAuthenticationController`    | `customer-authentication`     | `CustomerAuthenticationService`                                                                                                         | `/customers`                   | Credential/recovery/MFA/device metadata.                    |
| `CustomerBeneficiaryController`       | `customer-beneficiary`        | `CustomerBeneficiaryService`                                                                                                            | `/customers`                   | Customer trusted recipients.                                |
| `CustomerComplianceController`        | `customer-compliance`         | `CustomerComplianceService`                                                                                                             | `/customers`                   | Customer compliance cases.                                  |
| `CustomerEligibilityController`       | `customer-eligibility`        | `CustomerEligibilityService`                                                                                                            | `/customers`                   | Eligibility, limits, enrollment, permissions, restrictions. |
| `CustomerFundingInstrumentController` | `customer-funding-instrument` | `CustomerFundingInstrumentService`                                                                                                      | `/customers`                   | Funding-instrument metadata.                                |
| `CustomerOnboardingController`        | `customer-onboarding`         | `CustomerOnboardingService`                                                                                                             | `/customers`                   | Onboarding, agreements, tasks, approvals.                   |
| `CustomerPreferenceController`        | `customer-preference`         | `CustomerPreferenceService`                                                                                                             | `/customers`                   | Customer preferences.                                       |
| `CustomerRiskProfileController`       | `customer-risk-profile`       | `CustomerRiskProfileService`                                                                                                            | `/customers`                   | P1.10 risk assessments.                                     |
| `CustomerWalletController`            | `customer-wallet`             | `CustomerWalletService`                                                                                                                 | `/customers`                   | Customer wallet metadata.                                   |
| `DepositController`                   | `deposit`                     | `DepositService`                                                                                                                        | `/deposits`                    | Deposit lifecycle.                                          |
| `FeeController`                       | `fee`                         | `FeeEngine`                                                                                                                             | `/fees`                        | Fee calculation.                                            |
| `HealthController`                    | `health`                      | `HealthService`                                                                                                                         | `/health`                      | Health probes.                                              |
| `LedgerController`                    | `ledger`                      | `LedgerService`                                                                                                                         | `/ledger`                      | Ledger accounts/journals.                                   |
| `LimitController`                     | `limit`                       | `LimitEngine`                                                                                                                           | `/limits`                      | Limit evaluation.                                           |
| `MaturityController`                  | `maturity`                    | `MaturityService`, `GovernanceService`, `OperationalReportService`, `RetentionService`                                                  | `/internal`                    | Maturity reports and maintenance.                           |
| `OperationsController`                | `operations`                  | `AuditService`, `DiagnosticsService`, `IdempotencyService`, `MetricsService`, `OutboxService`                                           | `/internal`                    | Operational primitives.                                     |
| `ProductGovernanceController`         | `product-governance`          | `ProductGovernanceService`                                                                                                              | `/internal/product-governance` | Governance records and readiness.                           |
| `ProductionController`                | `production`                  | `ApiVersionService`, `ProductionConfigurationService`, `ProductionReadinessService`, `RequestTrackerService`, `GracefulShutdownService` | `/internal`                    | Runtime metadata and readiness.                             |
| `QuoteController`                     | `quote`                       | `QuoteService`                                                                                                                          | `/quotes`                      | Quote lifecycle.                                            |
| `ReconciliationController`            | `reconciliation`              | `ReconciliationService`                                                                                                                 | `/internal/reconciliation`     | Independent finance reports.                                |
| `TransferController`                  | `transfer`                    | `TransferService`                                                                                                                       | `/transfers`                   | Transfer lifecycle.                                         |
| `WalletTransactionController`         | `transfer`                    | `TransferService`                                                                                                                       | `/wallets`                     | Wallet transaction history.                                 |
| `VirtualAccountController`            | `virtual-account`             | `VirtualAccountService`                                                                                                                 | `/virtual-accounts`            | Virtual-account metadata.                                   |
| `WalletController`                    | `wallet`                      | `WalletService`                                                                                                                         | `/wallets`                     | Ledger-backed wallet and balance.                           |
| `WithdrawalController`                | `withdrawal`                  | `WithdrawalService`                                                                                                                     | `/withdrawals`                 | Withdrawal lifecycle.                                       |

## 5. Complete endpoint inventory

Each route below is owned by exactly one controller. These are implemented routes; “public” here means HTTP-registered, not authorized for public production exposure.

### `BankController`

- `POST /api/v1/banks`
- `GET /api/v1/banks`
- `GET /api/v1/banks/:id`
- `PATCH /api/v1/banks/:id`
- `DELETE /api/v1/banks/:id`

### `BeneficiaryController`

- `POST /api/v1/beneficiaries`
- `GET /api/v1/beneficiaries`
- `GET /api/v1/beneficiaries/:id`
- `PATCH /api/v1/beneficiaries/:id`
- `DELETE /api/v1/beneficiaries/:id`

### `CustomerController`

- `POST /api/v1/customers`
- `GET /api/v1/customers`
- `GET /api/v1/customers/:id`
- `PATCH /api/v1/customers/:id`
- `POST /api/v1/customers/:id/profile`
- `POST /api/v1/customers/:id/address`
- `POST /api/v1/customers/:id/contact-method`
- `POST /api/v1/customers/:id/identity-document`
- `POST /api/v1/customers/:id/kyc-assessment`
- `GET /api/v1/customers/:id/profile`
- `GET /api/v1/customers/:id/addresses`
- `GET /api/v1/customers/:id/contact-methods`
- `GET /api/v1/customers/:id/identity-documents`
- `GET /api/v1/customers/:id/kyc`

### `CustomerAuthenticationController`

- `POST /api/v1/customers/:id/authentication-credentials`
- `GET /api/v1/customers/:id/authentication-credentials`
- `GET /api/v1/customers/:id/authentication-credentials/:credentialId`
- `PATCH /api/v1/customers/:id/authentication-credentials/:credentialId`
- `POST /api/v1/customers/:id/authentication-credentials/:credentialId/password-rotate`
- `POST /api/v1/customers/:id/authentication-credentials/:credentialId/failed-attempt`
- `POST /api/v1/customers/:id/authentication-credentials/:credentialId/unlock`
- `GET /api/v1/customers/:id/authentication-credentials/:credentialId/password-history`
- `POST /api/v1/customers/:id/password-reset-requests`
- `GET /api/v1/customers/:id/password-reset-requests`
- `PATCH /api/v1/customers/:id/password-reset-requests/:requestId`
- `POST /api/v1/customers/:id/password-reset-requests/:requestId/token`
- `GET /api/v1/customers/:id/password-reset-requests/:requestId/tokens`
- `PATCH /api/v1/customers/:id/password-reset-requests/:requestId/tokens/:tokenId`
- `POST /api/v1/customers/:id/mfa-enrollments`
- `GET /api/v1/customers/:id/mfa-enrollments`
- `PATCH /api/v1/customers/:id/mfa-enrollments/:enrollmentId`
- `POST /api/v1/customers/:id/mfa-enrollments/:enrollmentId/method`
- `GET /api/v1/customers/:id/mfa-enrollments/:enrollmentId/methods`
- `PATCH /api/v1/customers/:id/mfa-methods/:methodId`
- `POST /api/v1/customers/:id/trusted-devices`
- `GET /api/v1/customers/:id/trusted-devices`
- `PATCH /api/v1/customers/:id/trusted-devices/:deviceId`
- `POST /api/v1/customers/:id/recovery-codes`
- `GET /api/v1/customers/:id/recovery-codes`
- `PATCH /api/v1/customers/:id/recovery-codes/:codeId`
- `GET /api/v1/customers/:id/security-events`

### `CustomerBeneficiaryController`

- `POST /api/v1/customers/:id/beneficiaries`
- `GET /api/v1/customers/:id/beneficiaries`
- `GET /api/v1/customers/:id/beneficiaries/:beneficiaryId`
- `PATCH /api/v1/customers/:id/beneficiaries/:beneficiaryId`
- `POST /api/v1/customers/:id/beneficiaries/:beneficiaryId/verify`
- `GET /api/v1/customers/:id/beneficiaries/:beneficiaryId/history`
- `GET /api/v1/customers/:id/beneficiaries/:beneficiaryId/ownership`

### `CustomerComplianceController`

- `POST /api/v1/customers/:id/compliance-cases`
- `GET /api/v1/customers/:id/compliance-cases`
- `GET /api/v1/customers/:id/compliance-cases/:caseId`
- `PATCH /api/v1/customers/:id/compliance-cases/:caseId`
- `POST /api/v1/customers/:id/compliance-cases/:caseId/comment`
- `GET /api/v1/customers/:id/compliance-cases/:caseId/comments`
- `POST /api/v1/customers/:id/compliance-cases/:caseId/evidence`
- `GET /api/v1/customers/:id/compliance-cases/:caseId/evidence`
- `POST /api/v1/customers/:id/compliance-cases/:caseId/assignment`
- `GET /api/v1/customers/:id/compliance-cases/:caseId/assignments`
- `GET /api/v1/customers/:id/compliance-cases/:caseId/history`

### `CustomerEligibilityController`

- `POST /api/v1/customers/:id/eligibility`
- `GET /api/v1/customers/:id/eligibility`
- `PATCH /api/v1/customers/:id/eligibility`
- `POST /api/v1/customers/:id/limit-profile`
- `GET /api/v1/customers/:id/limit-profile`
- `PATCH /api/v1/customers/:id/limit-profile`
- `POST /api/v1/customers/:id/product-enrollment`
- `GET /api/v1/customers/:id/product-enrollments`
- `PATCH /api/v1/customers/:id/product-enrollments/:enrollmentId`
- `POST /api/v1/customers/:id/permission`
- `GET /api/v1/customers/:id/permissions`
- `POST /api/v1/customers/:id/restriction`
- `GET /api/v1/customers/:id/restrictions`
- `GET /api/v1/customers/:id/operating-status`

### `CustomerFundingInstrumentController`

- `POST /api/v1/customers/:id/funding-instruments`
- `GET /api/v1/customers/:id/funding-instruments`
- `GET /api/v1/customers/:id/funding-instruments/:instrumentId`
- `PATCH /api/v1/customers/:id/funding-instruments/:instrumentId`
- `POST /api/v1/customers/:id/funding-instruments/:instrumentId/verify`
- `GET /api/v1/customers/:id/funding-instruments/:instrumentId/history`
- `GET /api/v1/customers/:id/funding-instruments/:instrumentId/ownership`

### `CustomerOnboardingController`

- `POST /api/v1/customers/:id/onboarding`
- `GET /api/v1/customers/:id/onboarding`
- `PATCH /api/v1/customers/:id/onboarding`
- `POST /api/v1/customers/:id/agreements`
- `GET /api/v1/customers/:id/agreements`
- `POST /api/v1/customers/:id/onboarding-task`
- `GET /api/v1/customers/:id/onboarding-tasks`
- `POST /api/v1/customers/:id/approval`
- `GET /api/v1/customers/:id/approval`
- `GET /api/v1/customers/:id/onboarding-readiness`

### `CustomerPreferenceController`

- `POST /api/v1/customers/:id/preferences`
- `GET /api/v1/customers/:id/preferences`
- `PATCH /api/v1/customers/:id/preferences`
- `GET /api/v1/customers/:id/preferences/history`

### `CustomerRiskProfileController`

- `POST /api/v1/customers/:id/risk-profile`
- `GET /api/v1/customers/:id/risk-profile`
- `PATCH /api/v1/customers/:id/risk-profile`
- `POST /api/v1/customers/:id/risk-profile/reassess`
- `GET /api/v1/customers/:id/risk-profile/history`

### `CustomerWalletController`

- `POST /api/v1/customers/:id/wallets`
- `GET /api/v1/customers/:id/wallets`
- `GET /api/v1/customers/:id/wallets/:walletId`
- `PATCH /api/v1/customers/:id/wallets/:walletId`
- `POST /api/v1/customers/:id/wallets/:walletId/alias`
- `GET /api/v1/customers/:id/wallets/:walletId/history`
- `GET /api/v1/customers/:id/wallets/:walletId/ownership`

### `DepositController`

- `POST /api/v1/deposits`
- `GET /api/v1/deposits`
- `GET /api/v1/deposits/:depositId`
- `POST /api/v1/deposits/:depositId/complete`
- `POST /api/v1/deposits/:depositId/fail`
- `POST /api/v1/deposits/:depositId/cancel`

### `FeeController`

- `POST /api/v1/fees/calculate`

### `HealthController`

- `GET /api/v1/health`
- `GET /api/v1/health/ready`

### `LedgerController`

- `POST /api/v1/ledger/accounts`
- `GET /api/v1/ledger/accounts`
- `GET /api/v1/ledger/accounts/:accountId/balance`
- `GET /api/v1/ledger/accounts/:accountId`
- `POST /api/v1/ledger/journals`
- `GET /api/v1/ledger/journals/:journalId`
- `POST /api/v1/ledger/journals/:journalId/reversal`

### `LimitController`

- `POST /api/v1/limits/evaluate`

### `MaturityController`

- `GET /api/v1/internal/health-dashboard`
- `GET /api/v1/internal/acceptance`
- `GET /api/v1/internal/maintenance/preview`
- `POST /api/v1/internal/maintenance/execute`
- `GET /api/v1/internal/reports/daily`
- `GET /api/v1/internal/reports/ledger`
- `GET /api/v1/internal/reports/wallets`
- `GET /api/v1/internal/reports/transfers`
- `GET /api/v1/internal/reports/deposits`
- `GET /api/v1/internal/reports/withdrawals`
- `GET /api/v1/internal/reports/reconciliation`
- `GET /api/v1/internal/reports/outbox`
- `GET /api/v1/internal/reports/audit`

### `OperationsController`

- `GET /api/v1/internal/metrics`
- `GET /api/v1/internal/diagnostics`
- `GET /api/v1/internal/audit`
- `GET /api/v1/internal/outbox`

### `ProductGovernanceController`

- `POST /api/v1/internal/product-governance/records`
- `GET /api/v1/internal/product-governance/records`
- `GET /api/v1/internal/product-governance/records/:id`
- `PATCH /api/v1/internal/product-governance/records/:id`
- `GET /api/v1/internal/product-governance/report`
- `GET /api/v1/internal/product-governance/readiness`
- `GET /api/v1/internal/product-governance/configuration`

### `ProductionController`

- `GET /api/v1/internal/version`
- `GET /api/v1/internal/configuration`
- `GET /api/v1/internal/deployment`
- `GET /api/v1/internal/readiness`

### `QuoteController`

- `POST /api/v1/quotes`
- `GET /api/v1/quotes`
- `GET /api/v1/quotes/:id`
- `POST /api/v1/quotes/:id/use`

### `ReconciliationController`

- `GET /api/v1/internal/reconciliation/report`
- `GET /api/v1/internal/reconciliation/trial-balance`
- `GET /api/v1/internal/reconciliation/finance`
- `GET /api/v1/internal/reconciliation/accounts/:accountId/activity`

### `TransferController`

- `POST /api/v1/transfers`
- `GET /api/v1/transfers/:transferId`

### `WalletTransactionController`

- `GET /api/v1/wallets/:walletId/transactions`

### `VirtualAccountController`

- `POST /api/v1/virtual-accounts`
- `GET /api/v1/virtual-accounts`
- `GET /api/v1/virtual-accounts/lookup`
- `GET /api/v1/virtual-accounts/:id`
- `POST /api/v1/virtual-accounts/:id/deactivate`

### `WalletController`

- `POST /api/v1/wallets`
- `GET /api/v1/wallets`
- `GET /api/v1/wallets/:walletId/balance`
- `GET /api/v1/wallets/:walletId`

### `WithdrawalController`

- `POST /api/v1/withdrawals`
- `GET /api/v1/withdrawals`
- `GET /api/v1/withdrawals/:withdrawalId`
- `POST /api/v1/withdrawals/:withdrawalId/process`
- `POST /api/v1/withdrawals/:withdrawalId/complete`
- `POST /api/v1/withdrawals/:withdrawalId/fail`
- `POST /api/v1/withdrawals/:withdrawalId/cancel`

## 6. Service-only and infrastructure service inventory

| Service                            | Owning module                 | Role                                                   | Classification                | Downstream consumers                          |
| ---------------------------------- | ----------------------------- | ------------------------------------------------------ | ----------------------------- | --------------------------------------------- |
| `BankService`                      | `bank`                        | Bank metadata operations.                              | Metadata-only                 | Virtual accounts, quotes, legacy beneficiary. |
| `BeneficiaryService`               | `beneficiary`                 | Legacy beneficiary operations.                         | Compatibility metadata        | Legacy payment tooling.                       |
| `CustomerService`                  | `customer`                    | Customer identity/domain operations.                   | Canonical source              | All customer modules.                         |
| `CustomerAuthenticationService`    | `customer-authentication`     | Credential/recovery/MFA/device metadata.               | Metadata-only                 | Future A2 runtime identity.                   |
| `CustomerBeneficiaryService`       | `customer-beneficiary`        | Customer recipient operations.                         | Metadata-only                 | Future A5/A6 transfer/funding flows.          |
| `CustomerComplianceService`        | `customer-compliance`         | Case, assignment, comment, evidence operations.        | Metadata-only workflow        | Future A4 policy and support.                 |
| `CustomerEligibilityService`       | `customer-eligibility`        | Eligibility and product-decision metadata.             | Policy input/projection       | Future A4 policy.                             |
| `CustomerFundingInstrumentService` | `customer-funding-instrument` | Funding-instrument registration.                       | Metadata-only                 | Future A6 settlement.                         |
| `CustomerOnboardingService`        | `customer-onboarding`         | Onboarding workflow and readiness.                     | Canonical workflow            | Eligibility and risk.                         |
| `CustomerPreferenceService`        | `customer-preference`         | Preference profile and history.                        | Metadata-only                 | Future A2/A7 consumers.                       |
| `CustomerRiskProfileService`       | `customer-risk-profile`       | Manual risk assessment and history.                    | Metadata-only decision input  | Future A4 policy.                             |
| `CustomerWalletService`            | `customer-wallet`             | Customer-wallet provisioning metadata.                 | Metadata-only                 | Future A3 binding.                            |
| `DepositService`                   | `deposit`                     | Deposit lifecycle and journal-backed completion.       | Canonical financial lifecycle | Ledger, payment, reconciliation.              |
| `FeeEngine`                        | `fee`                         | Pure fee/VAT calculation.                              | Projection/decision tooling   | Quote and payment commands.                   |
| `HealthService`                    | `health`                      | Health response.                                       | Projection                    | Deployment probes.                            |
| `LedgerService`                    | `ledger`                      | Ledger posting, balances, reversals, invariants.       | Canonical financial authority | Wallet and financial lifecycles.              |
| `LimitEngine`                      | `limit`                       | Pure limit evaluation.                                 | Projection/decision tooling   | Payment/quote decisions.                      |
| `GovernanceService`                | `maturity`                    | Startup governance metadata.                           | Governance                    | Operations and release gates.                 |
| `MaturityService`                  | `maturity`                    | Acceptance and maintenance coordination.               | Governance/projection         | Operators and release governance.             |
| `OperationalReportService`         | `maturity`                    | Read-only reports.                                     | Projection                    | Operators, finance, release gates.            |
| `RetentionService`                 | `maturity`                    | Manual retention preview/execution.                    | Infrastructure/maintenance    | Operators.                                    |
| `AuditService`                     | `operations`                  | Immutable audit writes and queries.                    | Infrastructure authority      | Every mutating domain.                        |
| `DiagnosticsService`               | `operations`                  | Operational diagnostics.                               | Projection                    | Operators/readiness.                          |
| `IdempotencyService`               | `operations`                  | Durable command deduplication.                         | Infrastructure authority      | Financial and future command domains.         |
| `MetricsService`                   | `operations`                  | Operational counters.                                  | Infrastructure                | Operations and maturity.                      |
| `OutboxService`                    | `operations`                  | Durable event facts.                                   | Infrastructure authority      | Future event publisher/consumers.             |
| `PaymentReferenceService`          | `payment`                     | Shared financial reference generation/registry.        | Financial support authority   | Transfer, deposit, withdrawal, quote.         |
| `SettlementAccountService`         | `payment`                     | Settlement account lookup/support.                     | Financial support             | Deposit/withdrawal and future external rails. |
| `ProductGovernanceService`         | `product-governance`          | Governance record lifecycle/readiness.                 | Governance authority          | Product and release owners.                   |
| `ApiVersionService`                | `production`                  | API version metadata.                                  | Infrastructure                | HTTP responses and operators.                 |
| `GracefulShutdownService`          | `production`                  | Shutdown coordination.                                 | Infrastructure                | Runtime.                                      |
| `ProductionConfigurationService`   | `production`                  | Safe configuration view.                               | Infrastructure                | Operators.                                    |
| `ProductionReadinessService`       | `production`                  | Startup readiness and migration-head check.            | Infrastructure gate           | Bootstrap and release.                        |
| `RequestTrackerService`            | `production`                  | Active request and drain tracking.                     | Infrastructure                | HTTP runtime.                                 |
| `QuoteService`                     | `quote`                       | Quote lifecycle/use.                                   | Metadata/decision tooling     | Future payment commands.                      |
| `ReconciliationService`            | `reconciliation`              | Independent finance verification.                      | Control authority             | Production, maturity, finance.                |
| `TransferService`                  | `transfer`                    | Transfer lifecycle and posting orchestration.          | Financial lifecycle           | Ledger, wallet, reconciliation.               |
| `VirtualAccountService`            | `virtual-account`             | Virtual-account metadata.                              | Metadata-only                 | Future funding/settlement.                    |
| `WalletService`                    | `wallet`                      | Financial wallet creation and ledger-derived balances. | Financial facade              | Transfer, deposit, withdrawal, channels.      |
| `WithdrawalService`                | `withdrawal`                  | Withdrawal lifecycle and posting.                      | Financial lifecycle           | Ledger, payment, reconciliation.              |

## 7. Public endpoint ownership and duplicate API analysis

### Endpoint ownership verification

Every implemented route is owned by one controller in the current route inventory. Customer-domain routes are partitioned by path segment:

- `/customers/:id` — `CustomerController`.
- `/customers/:id/onboarding...` — `CustomerOnboardingController`.
- `/customers/:id/eligibility...`, `/limit-profile`, `/product-enrollment`, `/permission`, `/restriction` — `CustomerEligibilityController`.
- `/customers/:id/wallets...` — `CustomerWalletController`.
- `/customers/:id/funding-instruments...` — `CustomerFundingInstrumentController`.
- `/customers/:id/beneficiaries...` — `CustomerBeneficiaryController`.
- `/customers/:id/preferences...` — `CustomerPreferenceController`.
- `/customers/:id/authentication-credentials...`, recovery, MFA, devices, codes, events — `CustomerAuthenticationController`.
- `/customers/:id/compliance-cases...` — `CustomerComplianceController`.
- `/customers/:id/risk-profile...` — `CustomerRiskProfileController`.

### Duplicate or overlapping API responsibilities

| Area          | Current APIs/controllers                                                                   | Finding                                                            | Consolidation candidate                                                |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Beneficiaries | `/beneficiaries` and `/customers/:id/beneficiaries`                                        | Two beneficiary models with different ownership semantics.         | A1 ownership decision; A5 transfer-facing authority.                   |
| Wallets       | `/wallets` and `/customers/:id/wallets`                                                    | Financial wallet versus provisioning metadata; paths are distinct. | A3 binding, not route merging.                                         |
| Risk          | `/customers/:id/risk-profile` and eligibility-era risk internals                           | P1.10 assessment API versus P1.3 decision metadata.                | A4 policy authority.                                                   |
| Limits        | `/limits/evaluate` and customer limit-profile routes                                       | Evaluator versus stored customer configuration.                    | A4 enforcement contract.                                               |
| Operations    | `/internal/diagnostics`, maturity dashboards, production readiness, reconciliation reports | Multiple read-oriented operational surfaces.                       | Keep ownership distinct; define readiness/acceptance precedence in A1. |

No duplicate HTTP method/path combination is intended in the current route inventory. Overlap is primarily semantic ownership, not identical route registration.

## 8. Entity ownership verification

- Every TypeORM `@Entity` is mapped to one owning module in the entity/table inventory.
- Embedded preference value objects intentionally do not own tables.
- The onboarding-era `CustomerRiskProfile` and P1.10 `CustomerRiskProfile` class names represent separate storage concepts and require A1/A4 consolidation review.
- `WalletAccount` and `CustomerWallet` represent separate financial and metadata concepts and require A3 binding.
- Legacy `Beneficiary` and `CustomerBeneficiary` represent separate historical/Customer Foundation models and require A1/A5 disposition.
- No entity is intentionally assigned to multiple module owners.

## 9. Database and financial authority verification

- Ledger accounts, journals, and lines are the only financial source-of-truth tables.
- Wallet balances are derived from ledger lines; no customer metadata table is an authoritative balance store.
- Transfer, deposit, withdrawal, and payment-reference tables own lifecycle/reference metadata, while the ledger owns posted value.
- Reconciliation reads independently and does not write financial state.
- Customer Foundation tables do not write ledger tables.
- Operations tables own audit, idempotency, metrics, and outbox infrastructure.

## 10. Current implementation status

- M0-M9 platform and financial modules: implemented with internal operational boundaries.
- P1.0-P1.10 Customer Foundation modules: implemented as metadata, lifecycle, governance, and decision-input domains.
- Runtime authentication and authorization: not implemented.
- Customer-to-ledger account binding: not implemented.
- Central capability and policy engine: not implemented.
- External bank/NIBSS and settlement integrations: not implemented.
- Public customer-facing exposure: not authorized before A2.

## 11. Migration and schema-control inventory

The migration chain is explicit and migration-only. The current expected head is `1785753600017`.

| Migration                                           | Primary tables / domain                                                       | Authority and control boundary                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `1785753600000-CreateWalletAndLedger.ts`            | `ledger_accounts`, `ledger_journals`, `ledger_lines`, `wallet_accounts`       | Ledger owns accounts, journals, lines, and balances; wallet is a ledger-backed facade.            |
| `1785753600001-CreateTransfers.ts`                  | `transfers`                                                                   | Transfer lifecycle metadata; posted value remains ledger-owned.                                   |
| `1785753600002-CreatePaymentCapabilities.ts`        | `payment_references`, `deposits`, `withdrawals`                               | Payment lifecycle/reference authority; no external rail is implied.                               |
| `1785753600003-CreateExpandedFinancialProducts.ts`  | `virtual_accounts`, legacy `beneficiaries`, `banks`, `payment_quotes`         | Metadata/product tooling; external activation remains future A6.                                  |
| `1785753600004-RepairM6UuidDefaults.ts`             | Existing M6 UUID defaults                                                     | Compatibility repair only; no new domain authority.                                               |
| `1785753600005-CreateOperationalResilience.ts`      | `idempotency_records`, `audit_events`, `outbox_events`, `operational_metrics` | Operations owns shared operational primitives and retention controls.                             |
| `1785753600006-CreateProductionMaturityMetadata.ts` | `governance_metadata`                                                         | Maturity/governance metadata; readiness is not financial truth.                                   |
| `1785753600007-CreateProductGovernance.ts`          | `product_governance_records`                                                  | Product governance and release evidence.                                                          |
| `1785753600008-CreateCustomerFoundation.ts`         | Customer identity/profile/address/contact/document/KYC tables                 | `customer` owns canonical customer identity and evidence metadata.                                |
| `1785753600009-CreateCustomerOnboarding.ts`         | Onboarding, agreements, tasks, approval decisions, onboarding-era risk        | `customer-onboarding` owns workflow evidence; no financial writes.                                |
| `1785753600010-CreateCustomerEligibility.ts`        | Eligibility, limits, enrollment, permissions, restrictions                    | `customer-eligibility` owns current source metadata until A4.                                     |
| `1785753600011-CreateCustomerWalletProvisioning.ts` | Customer wallets, aliases, ownership, provisioning history                    | `customer-wallet` owns provisioning metadata; no ledger account/balance authority.                |
| `1785753600012-CreateCustomerFundingInstruments.ts` | Funding instruments, ownership, verification, history                         | `customer-funding-instrument` owns registration metadata; no provider settlement authority.       |
| `1785753600013-CreateCustomerBeneficiaries.ts`      | Customer beneficiaries, ownership, verification, history                      | `customer-beneficiary` owns preferred customer-recipient metadata; legacy model remains separate. |
| `1785753600014-CreateCustomerPreferences.ts`        | Preferences and preference histories                                          | `customer-preference` owns customer intent; no delivery state.                                    |
| `1785753600015-CreateCustomerAuthentication.ts`     | Credentials, password/recovery, MFA, devices, security events                 | `customer-authentication` owns metadata; no runtime authentication/authorization.                 |
| `1785753600016-CreateCustomerComplianceCases.ts`    | Compliance cases, histories, assignments, comments, evidence                  | `customer-compliance` owns case-management evidence; no screening engine.                         |
| `1785753600017-CreateCustomerRiskAssessments.ts`    | Risk assessments, factors, assessment/factor histories                        | `customer-risk-profile` owns manual assessment evidence; no automated risk engine.                |

All schema changes remain migration-controlled. `synchronize=false` is required, and the production readiness boundary rejects an incompatible migration head.

## 12. Foreign-key, uniqueness, deletion, and version inventory

### Foreign-key and relationship authorities

- Customer Foundation child records use `customer_id` relationships to the canonical `customers` record where defined; child modules do not own customer identity.
- Customer onboarding, eligibility, wallet metadata, funding instruments, beneficiaries, preferences, authentication, compliance, and risk records retain parent/history relationships within their owning module.
- `wallet_accounts.ledger_account_id` identifies the ledger account used by the financial wallet facade; it does not make the wallet table the balance authority.
- Financial lifecycle records reference wallet/journal/payment records through their financial-domain contracts; reconciliation reads those relationships independently.
- Operations audit/outbox records identify entities or aggregates for evidence and publication; they do not become source-domain writers.

### Constraint and lifecycle inventory

| Constraint/lifecycle category | Current enforcement / authority                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UUID primary keys             | TypeORM UUID primary keys across customer, metadata, financial, and operations records; identifiers are owned by the bounded context.                                                       |
| Domain references             | Customer, case, beneficiary, funding-instrument, MFA, and wallet aliases use domain normalization and declared uniqueness rules.                                                            |
| Financial uniqueness          | Ledger account codes, wallet customer/currency pairs, ledger-account bindings, payment references, financial journal links, and command/idempotency keys have domain-specific constraints.  |
| Scoped idempotency            | Operations uses `(scope, idempotencyKey)`; financial command tables may add local constraints without replacing the shared scope rule.                                                      |
| Soft deletion                 | Customer Foundation metadata uses `deleted_at`/TypeORM soft deletion where defined; active-only partial indexes exclude deleted rows only where reuse is explicitly allowed.                |
| Non-reusable references       | Customer, case, beneficiary, funding-instrument, and payment references remain unique across soft deletion where their owning schema defines global uniqueness.                             |
| Optimistic versioning         | Mutable Customer Foundation records use version columns and expected-version checks; stale updates are rejected rather than silently overwritten.                                           |
| Append-only history           | Beneficiary, funding-instrument, preference, authentication/security, compliance, risk, audit, and financial posting histories are preserved according to their owner and retention policy. |
| Financial immutability        | Posted ledger journals and lines are immutable; corrections use compensating entries and reconciliation.                                                                                    |
| Operational immutability      | Audit event facts are append-only; outbox payload/identity facts are immutable while lifecycle status/retry fields are operationally mutable.                                               |

These are inventory findings, not new schema decisions. Detailed identifier and privacy rules remain in [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md).

## 13. Duplicate-route and overlap report

| Concern                                      | Current finding                                                                                      | Ownership result                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Identical HTTP method/path combinations      | Static route inventory contains no intended duplicate method/path combination                        | Each route remains assigned to one controller; any future collision blocks the route review. |
| Legacy versus Customer Beneficiary APIs      | `/beneficiaries` and `/customers/:id/beneficiaries` are different paths and different models         | Semantic overlap is documented; A1/A5 chooses one transfer-facing authority.                 |
| Financial wallet versus customer-wallet APIs | `/wallets` and `/customers/:id/wallets` are different paths                                          | Financial wallet and provisioning metadata remain separate; A3 binds them.                   |
| Risk representations                         | P1.10 risk-profile routes and eligibility-era risk metadata are different responsibilities           | P1.10 is preferred evidence; A4 owns future policy output.                                   |
| Limits                                       | `/limits/evaluate` and customer limit-profile routes are different responsibilities                  | Evaluation versus stored configuration remains explicit; A4 defines enforcement.             |
| Operations/readiness surfaces                | Operations, maturity, production, reconciliation, and governance expose read-oriented internal views | Views do not write source records and are not production-public before A2.                   |

## 14. Internal-route exposure report

- HTTP registration is not public authorization. Routes under `/api/v1/internal` and other current routes remain internal until A2 provides authentication and authorization.
- DTO validation, request context, and error envelopes do not establish a runtime principal or permission.
- Operations, production, maturity, product-governance, reconciliation, ledger, wallet, and financial lifecycle controllers require deployment/network restriction before A2.
- Customer Foundation routes are metadata/lifecycle APIs and must not be interpreted as customer-authenticated or financial-command APIs.
- No A1T03 change exposes, protects, removes, or renames an existing route.

## 15. A1T03 acceptance evidence

A1T03 is complete when:

- Every current NestJS module is represented.
- Every TypeORM entity and database table is represented.
- Every controller and service is represented.
- Every implemented endpoint has one owning controller.
- Duplicate APIs, overlapping entities, duplicate tables, unclear ownership, and consolidation candidates are documented.
- Ledger authority is confirmed.
- No application file is changed.
- Documentation formatting and consistency checks pass.
