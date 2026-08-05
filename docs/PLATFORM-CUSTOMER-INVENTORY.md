# Platform and Customer Foundation Inventory

- Task: A1T02 — Platform and Customer Foundation Inventory
- Review point: M0-M9 and P1.0-P1.10
- Classification: Documentation-only baseline
- Runtime/API status: Implemented internal routes are not production-public until A2 runtime identity and access exists.

## 1. Classification model

| Classification            | Meaning                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Canonical source of truth | Owns authoritative state and is the only permitted domain writer for that concept.                       |
| Metadata-only             | Stores registration, intent, evidence, or lifecycle metadata without executing the associated operation. |
| Projection/read model     | Derives a view from authoritative data and must not become an independent writer.                        |
| Infrastructure            | Provides shared runtime, persistence, resilience, observability, or request behavior.                    |
| Governance                | Stores or evaluates product, launch, acceptance, or operational governance evidence.                     |

The current application is a modular monolith. Module boundaries are logical ownership boundaries; they are not yet separate deployable services.

## 2. Platform composition

| Module               | Classification          | Purpose                                                                                     | Domain owner                               | Primary entities/services                                             | Public APIs                                                                 | Dependencies                                       | Upstream dependencies                    | Downstream consumers                           | Current status                                                          |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `AppModule`          | Composition             | Composes all Nest modules and global configuration.                                         | Platform Engineering                       | Nest application, TypeORM root, LoggerModule                          | All `/api/v1` routes                                                        | All imported modules, configuration, TypeORM       | M0 foundation                            | Entire application                             | Implemented composition root.                                           |
| `common`             | Infrastructure          | Shared money parsing, currency normalization, and transformers.                             | Platform Engineering / Finance             | `money`, bigint transformer                                           | None                                                                        | None                                               | Ledger and financial-domain requirements | Ledger, wallet, quotes, limits, fees, payments | Implemented shared library; not a Nest module.                          |
| `health`             | Projection/read model   | Liveness and basic health response.                                                         | Platform Operations                        | `HealthService`                                                       | `GET /api/v1/health`, `GET /api/v1/health/ready`                            | Configuration/runtime checks                       | Process and database readiness           | Deployment probes and operators                | Implemented; readiness remains separate from full production readiness. |
| `operations`         | Infrastructure          | Audit, idempotency, outbox, metrics, diagnostics.                                           | Platform Operations                        | `AuditEvent`, `IdempotencyRecord`, `OutboxEvent`, `OperationalMetric` | Internal metrics, diagnostics, audit, outbox routes                         | PostgreSQL, reconciliation read service            | All mutating domains                     | All domains, operators, production readiness   | Implemented shared infrastructure; outbox publisher is not included.    |
| `production`         | Infrastructure          | Configuration, API metadata, request context, readiness, draining, shutdown.                | Platform Operations / Platform Engineering | Readiness and request-tracker services                                | Internal version, configuration, deployment, readiness routes               | Reconciliation, configuration, HTTP runtime        | M8 production requirements               | App bootstrap and operators                    | Implemented; authentication/authorization is still a future boundary.   |
| `maturity`           | Governance / projection | Health dashboard, acceptance, maintenance, retention, reports, startup governance metadata. | Platform Operations / Governance           | `GovernanceMetadata`, reports, retention services                     | Internal health, acceptance, maintenance, report routes                     | Operations, Production, Reconciliation, PostgreSQL | M9 acceptance requirements               | Operators and release governance               | Implemented; manually operated and read-heavy.                          |
| `product-governance` | Governance              | Product scope, regulatory, launch, partner, ownership, and readiness evidence.              | Product / Regulatory / Governance          | `ProductGovernanceRecord`                                             | Internal product-governance record, report, configuration, readiness routes | Operations, PostgreSQL                             | P1.0 governance                          | Product, release, compliance, operations       | Implemented; non-financial and internal.                                |

## 3. Financial and M0-M9 domain modules

| Module            | Classification                            | Purpose                                                                                        | Domain owner                  | Primary entities/services                                       | Public APIs                                                                                                         | Dependencies                               | Upstream dependencies                           | Downstream consumers                                      | Current status                                                                               |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ledger`          | Canonical source of truth                 | Own ledger accounts, journals, lines, balance calculation, reversal, and financial invariants. | Finance / Ledger Engineering  | `LedgerAccount`, `LedgerJournal`, `LedgerLine`, `LedgerService` | `POST/GET /api/v1/ledger/accounts`; account balance/detail; `POST /api/v1/ledger/journals`; journal detail/reversal | PostgreSQL, common money rules             | M2 chart of accounts and ADR-0002/0004          | Wallet, transfers, deposits, withdrawals, reconciliation  | Implemented financial authority.                                                             |
| `wallet`          | Canonical financial facade                | Own ledger-backed customer wallet records and ledger-derived balance reads.                    | Wallet / Finance              | `WalletAccount`, `WalletService`                                | `POST/GET /api/v1/wallets`; wallet detail and balance                                                               | Ledger, PostgreSQL, idempotency behavior   | Customer reference, currency, ledger account    | Transfers, virtual accounts, deposit/withdrawal, channels | Implemented; not customer-identity-owned yet.                                                |
| `transfer`        | Canonical financial lifecycle             | Own internal transfer request state and customer-to-wallet transfer commands.                  | Payments / Finance            | `Transfer`, `TransferService`                                   | `POST /api/v1/transfers`; transfer detail; wallet transaction history                                               | Ledger, Payment, WalletAccount, PostgreSQL | Wallets, ledger, idempotency, transfer rules    | Reconciliation, support, future customer command boundary | Implemented internal flow; customer authorization binding is future A5.                      |
| `deposit`         | Canonical financial lifecycle             | Own controlled internal deposit state and journal-backed completion.                           | Payments / Finance            | `Deposit`, `DepositService`                                     | Deposit create/list/detail and complete/fail/cancel routes                                                          | Ledger, Payment, PostgreSQL                | Wallet, settlement accounts, payment references | Reconciliation and operations                             | Implemented controlled internal capability; no external rail.                                |
| `withdrawal`      | Canonical financial lifecycle             | Own controlled internal withdrawal and processing state.                                       | Payments / Finance            | `Withdrawal`, `WithdrawalService`                               | Withdrawal create/list/detail and process/complete/fail/cancel routes                                               | Ledger, Payment, PostgreSQL                | Wallet, settlement accounts, payment references | Reconciliation and operations                             | Implemented controlled internal capability; no external rail.                                |
| `payment`         | Financial support / reference authority   | Own shared payment references and settlement-account support.                                  | Payments / Finance            | `PaymentReference`, settlement-account service                  | No standalone payment controller; consumed by payment domains                                                       | Ledger, PostgreSQL                         | Financial command requirements                  | Deposit, withdrawal, transfer, quote, virtual account     | Implemented support boundary; not a payment execution facade by itself.                      |
| `quote`           | Metadata / decision tooling               | Create and consume immutable payment quotes.                                                   | Payments / Product            | `PaymentQuote`, `QuoteService`                                  | `POST/GET /api/v1/quotes`; quote use                                                                                | Payment, PostgreSQL, money/fee rules       | Product and payment request inputs              | Future payment commands                                   | Implemented non-money-moving quote tooling.                                                  |
| `fee`             | Projection/decision tooling               | Calculate fee and VAT values using integer-safe rules.                                         | Finance / Payments            | `FeeEngine`                                                     | `POST /api/v1/fees/calculate`                                                                                       | Common money rules                         | Product/payment inputs                          | Quote and future payment commands                         | Implemented pure calculation; no persistence or movement.                                    |
| `limit`           | Projection/decision tooling               | Evaluate caller-provided usage against supplied limits.                                        | Risk / Payments               | `LimitEngine`                                                   | `POST /api/v1/limits/evaluate`                                                                                      | Common money rules                         | Limit request and usage inputs                  | Quote/payment decisions, future A4 policy                 | Implemented pure evaluation; does not persist usage or enforce transactions.                 |
| `bank`            | Metadata-only directory                   | Locally manage bank institution metadata.                                                      | Product Operations / Payments | `Bank`, `BankService`                                           | `/api/v1/banks` CRUD routes                                                                                         | PostgreSQL                                 | Local operational data                          | Virtual accounts, quotes, legacy beneficiary tooling      | Implemented local directory; no bank integration.                                            |
| `beneficiary`     | Legacy metadata-only compatibility module | Store pre-Customer-Foundation beneficiary records for M6 tooling.                              | Product/Payments legacy owner | `Beneficiary`, `BeneficiaryService`                             | `/api/v1/beneficiaries` CRUD routes                                                                                 | PostgreSQL                                 | Legacy M6 product tooling                       | Legacy payment/virtual-account consumers                  | Implemented compatibility model; future consolidation candidate with `customer-beneficiary`. |
| `virtual-account` | Metadata-only product tooling             | Assign and deactivate local virtual-account records.                                           | Payments / Product            | `VirtualAccount`, `VirtualAccountService`                       | `/api/v1/virtual-accounts` create/list/lookup/detail/deactivate                                                     | Payment, WalletAccount, PostgreSQL         | Wallet and local bank metadata                  | Future external funding activation                        | Implemented non-money-moving tooling.                                                        |
| `reconciliation`  | Independent control / projection          | Read source tables independently and report financial consistency.                             | Finance / Operations          | `ReconciliationService` and reports                             | Internal reconciliation report, trial balance, finance, account activity routes                                     | Read-only PostgreSQL queries               | Ledger, wallet, transfer, deposit, withdrawal   | Production readiness, maturity, finance, release gates    | Implemented independent control; not a financial writer.                                     |

## 4. Customer Foundation modules P1.0-P1.10

| Module                        | Classification                   | Purpose                                                                                                                  | Domain owner                            | Primary entities/services                                                                                                      | Public APIs                                                                                  | Dependencies                                              | Upstream dependencies                             | Downstream consumers                                | Current status                                                      |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `customer`                    | Canonical source of truth        | Own customer identity, profile, address, contacts, identity-document, and KYC metadata.                                  | Customer Operations / Compliance        | `Customer`, `CustomerProfile`, `CustomerAddress`, `CustomerContactMethod`, `CustomerIdentityDocument`, `CustomerKycAssessment` | `/api/v1/customers` and customer subresource routes                                          | Operations, PostgreSQL                                    | Customer creation and internal actors             | Onboarding, eligibility, all customer-owned modules | P1.1 implemented.                                                   |
| `customer-onboarding`         | Canonical workflow metadata      | Own onboarding status, agreements, tasks, approval decisions, and readiness.                                             | Customer Operations / Risk              | Onboarding, agreement, task, approval entities                                                                                 | Onboarding, agreements, tasks, approval, readiness routes                                    | Customer entities, Operations, PostgreSQL                 | Customer profile/address/identity evidence        | Eligibility, compliance, risk, future activation    | P1.2 implemented.                                                   |
| `customer-eligibility`        | Decision metadata / policy input | Own eligibility, restrictions, customer limits, product enrollment, permissions, and operating status view.              | Risk / Product Operations               | Eligibility, limit profile, enrollment, permission, restriction entities                                                       | Eligibility, limit, enrollment, permission, restriction, operating-status routes             | Customer, onboarding, Operations, PostgreSQL              | Onboarding completion and risk/restriction inputs | Wallet provisioning, future A4 policy               | P1.3 implemented; not a central policy engine.                      |
| `customer-wallet`             | Metadata-only                    | Record customer-wallet provisioning, ownership, aliases, lifecycle, and history without ledger accounts.                 | Customer Operations / Wallet Operations | `CustomerWallet`, ownership, alias, provisioning history                                                                       | Customer wallet provisioning, status, alias, history, ownership routes                       | Customer, onboarding, eligibility, Operations, PostgreSQL | Completed onboarding and eligibility              | Future A3 account binding                           | P1.4 implemented; not financial-wallet authority.                   |
| `customer-funding-instrument` | Metadata-only                    | Register customer funding instruments, verification metadata, lifecycle, ownership, and history.                         | Customer Operations / Payments Risk     | Funding instrument, ownership, verification, history entities                                                                  | Funding-instrument registration, verification, history, ownership routes                     | Customer, Operations, PostgreSQL                          | Customer existence                                | Future A6 external funding                          | P1.5 implemented; no external ownership validation.                 |
| `customer-beneficiary`        | Metadata-only                    | Register customer trusted recipients, destination identifiers, verification metadata, lifecycle, ownership, and history. | Customer Operations / Payments Risk     | Customer beneficiary, ownership, verification, history entities                                                                | Beneficiary registration, verification, history, ownership routes                            | Customer, Operations, PostgreSQL                          | Customer existence                                | Future A5 transfers and A6 rails                    | P1.6 implemented; overlaps legacy `beneficiary`.                    |
| `customer-preference`         | Metadata-only                    | Store language, theme, notification, and security preferences with history.                                              | Customer Operations / Product           | `CustomerPreference`, embedded preference values, `PreferenceHistory`                                                          | Preferences create/read/update/history routes                                                | Customer, Operations, PostgreSQL                          | Customer existence                                | Future A2 access and A7 notifications               | P1.7 implemented; no notification delivery or security enforcement. |
| `customer-authentication`     | Metadata-only                    | Store password hash metadata, recovery, MFA, device, recovery-code, lock, and security-event metadata.                   | Security / Customer Operations          | Credential, password history, reset, MFA, device, recovery, security-event entities                                            | Credential, rotation, lock/unlock, reset, MFA, devices, recovery-code, security-event routes | Customer, Operations, PostgreSQL                          | Customer identity and internal security actor     | Future A2 runtime authentication and authorization  | P1.8 implemented; no login, sessions, JWT, or authorization.        |
| `customer-compliance`         | Metadata-only workflow           | Manage compliance cases, assignments, comments, evidence metadata, resolution, closure, and history.                     | Compliance / Risk Operations            | Compliance case, history, assignment, comment, evidence entities                                                               | Case, comment, evidence, assignment, history routes                                          | Customer, Operations, PostgreSQL                          | Customer existence and manual operations          | Future A4 policy decisions and support              | P1.9 implemented; no AML/sanctions/monitoring engine.               |
| `customer-risk-profile`       | Metadata-only decision input     | Store manual risk assessments, factors, review dates, reassessment snapshots, and factor history.                        | Risk / Compliance                       | Risk assessment, factor, profile-history, factor-history entities                                                              | Risk profile create/read/update/reassess/history routes                                      | Customer, Operations, PostgreSQL                          | Customer existence and manual assessment          | Future A4 policy engine                             | P1.10 implemented; no automated risk engine.                        |

## 5. Module classifications

### Canonical source-of-truth modules

- Customer identity: `customer`.
- Financial value: `ledger`.
- Ledger-backed wallet/account: `wallet` plus `ledger`.
- Transfer/deposit/withdrawal lifecycle records: respective financial modules.
- Product governance records: `product-governance`.
- Audit records: `operations`.
- Reconciliation control: `reconciliation` for independent financial verification.

### Metadata-only modules

- `customer-wallet`.
- `customer-funding-instrument`.
- `customer-beneficiary`.
- `customer-preference`.
- `customer-authentication`.
- `customer-compliance`.
- `customer-risk-profile`.
- Legacy `beneficiary`.
- `bank`.
- `virtual-account`.

### Projection/read-model modules

- `health`.
- `reconciliation` reports.
- `maturity` reports and dashboards.
- `production` readiness and diagnostics views.
- `customer-eligibility` operating-status view.
- `fee` and `limit` evaluation outputs.
- Future policy decision output in A4.

### Infrastructure modules

- `common`.
- `operations`.
- `production`.
- `health`.

### Governance modules

- `product-governance`.
- `maturity` governance metadata and acceptance.
- `operations` audit and operational evidence.

## 6. Duplicate responsibilities and consolidation candidates

### Customer wallet versus financial wallet

- **Why both exist:** P1.4 intentionally records provisioning metadata without ledger interaction; M2 wallet is ledger-backed.
- **Authoritative model:** `WalletAccount` and ledger for financial state.
- **Metadata/projection:** `CustomerWallet` for customer provisioning state.
- **Recommendation:** Keep both, add explicit binding in A3, never duplicate balances.

### Legacy beneficiary versus customer beneficiary

- **Why both exist:** M6 product tooling predates Customer Foundation; P1.6 is customer-owned.
- **Authoritative model:** To be selected in A1; P1.6 is the preferred transfer-facing candidate.
- **Metadata/projection:** Non-authoritative model becomes migrated or compatibility data.
- **Recommendation:** Stop independent writers before A5 transfers.

### P1.3 risk data versus P1.10 risk assessment

- **Why both exist:** P1.3 supports eligibility-era decisions; P1.10 preserves dated manual assessments and factor history.
- **Authoritative model:** P1.10 for assessment evidence; P1.3 for current eligibility/restriction state until A4.
- **Recommendation:** Centralize policy output in A4 and preserve historical source records.

### Internal operations and maturity reporting

- **Why both exist:** M7 provides operational primitives; M9 provides read-only reporting, retention, and acceptance.
- **Authoritative model:** Operations owns operational facts; Maturity owns governance/acceptance views.
- **Recommendation:** Keep both and document readiness-warning precedence before A5.

## 7. Current architectural status

The platform and Customer Foundation are implemented as a modular monolith with owned repositories and migrations. The foundation is not yet a runtime trust boundary and is not yet connected to customer-authorized financial commands.

The next Architecture phase is A1 Foundation Consolidation. A1 must use this inventory to finalize canonical ownership before A2 Runtime Identity & Access, A3 Customer-to-Financial Account Binding, A4 Capability & Policy Engine, or A5 Internal Financial Pilot begins.
