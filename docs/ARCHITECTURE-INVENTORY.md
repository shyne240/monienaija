# MonieNaija Architecture Inventory

- Review point: Customer Foundation complete through P1.10
- Purpose: single inventory used before A1-A8 Architecture phase design and implementation

## 1. Runtime

| Concern    | Current implementation             | Constraint                                                            |
| ---------- | ---------------------------------- | --------------------------------------------------------------------- |
| HTTP       | NestJS 11, Fastify                 | Global `/api/v1` prefix.                                              |
| Validation | Global `ValidationPipe`            | Transform, whitelist, and forbidden unknown properties.               |
| Errors     | Global exception filter            | Stable error envelope with request context.                           |
| Logging    | Pino/nestjs-pino                   | Request, correlation, and trace metadata; sensitive headers redacted. |
| Shutdown   | Request tracker and shutdown hooks | Drain before close; bounded wait.                                     |
| Versioning | API and response headers           | Current API version is `v1`.                                          |

## 2. Persistence

| Concern     | Current implementation            | Constraint                                   |
| ----------- | --------------------------------- | -------------------------------------------- |
| Database    | PostgreSQL                        | Production readiness checks connectivity.    |
| ORM         | TypeORM                           | `synchronize=false`; migration-only schema.  |
| IDs         | UUIDs for customer-domain records | Route/service UUID validation.               |
| Mutability  | Soft deletion and version columns | No hard-delete API in Customer Foundation.   |
| History     | Dedicated append-only tables      | History records are audited.                 |
| Schema head | Migration `1785753600017`         | Readiness requires exact head compatibility. |

## 3. Operational foundation

- `AuditService` owns immutable audit event creation and querying.
- `IdempotencyService` provides PostgreSQL-backed request deduplication.
- `OutboxService` stores transactional domain facts.
- `MetricsService` stores operational counters.
- `DiagnosticsService` provides operational views.
- `ReconciliationService` independently checks financial state.
- `ProductionReadinessService` checks database, migration head, reconciliation, and outbox state.
- `Maturity` owns governance startup metadata, reports, retention, and final acceptance.
- `ProductGovernance` owns product scope, launch evidence, and readiness records.

## 4. Financial domains

| Domain               | Authority                           | Current boundary                                           |
| -------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Wallet               | `WalletAccount`                     | Ledger-backed financial wallet; balance is ledger-derived. |
| Ledger               | Ledger accounts, journals, lines    | Sole source of financial truth.                            |
| Transfers            | Transfer lifecycle                  | Existing internal transfer capability.                     |
| Deposits/withdrawals | Deposit and withdrawal lifecycles   | Controlled internal journal-backed flows.                  |
| Payments             | Payment lifecycle/reference support | No assumption that every payment is an external rail.      |
| Fees/limits/quotes   | Pure or metadata tooling            | Does not itself move money.                                |
| Reconciliation       | Independent database queries        | Financial control, not execution.                          |

## 5. Customer domains

| Domain              | Current authority                                                  | State                                                     |
| ------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| Customer identity   | `Customer` and related profile/contact/document tables             | P1.1 complete.                                            |
| Onboarding          | Onboarding workflow, agreements, tasks, approval decisions         | P1.2 complete.                                            |
| Eligibility         | Eligibility, restrictions, limits, enrollment, permissions         | P1.3 complete.                                            |
| Customer wallet     | `CustomerWallet`                                                   | Provisioning metadata only; not ledger-linked.            |
| Funding instruments | Customer funding-instrument entities                               | Registration and verification metadata only.              |
| Beneficiaries       | `CustomerBeneficiary`                                              | Trusted-recipient metadata only.                          |
| Preferences         | Customer preference profile and history                            | Stored intent only; no delivery.                          |
| Authentication      | Credential, recovery, MFA, device, and security metadata           | No runtime authentication or authorization.               |
| Compliance          | Case, assignment, comment, evidence, and history                   | Metadata-only case management.                            |
| Risk                | Manual risk assessment, current factors, assessment/factor history | No automated AML, sanctions, fraud, or monitoring engine. |

## 6. Current modules

The Nest application includes:

- `customer`
- `customer-onboarding`
- `customer-eligibility`
- `customer-wallet`
- `customer-funding-instrument`
- `customer-beneficiary`
- `customer-preference`
- `customer-authentication`
- `customer-compliance`
- `customer-risk-profile`
- `wallet`
- `ledger`
- `transfer`
- `deposit`
- `withdrawal`
- `payment`
- `quote`
- `fee`
- `limit`
- `bank`
- `beneficiary`
- `virtual-account`
- `reconciliation`
- `operations`
- `production`
- `maturity`
- `product-governance`

The duplicate `beneficiary`/`customer-beneficiary` and risk representations are documented in the ownership matrix and require A1 consolidation decisions.

## 7. ADR inventory

| ADR range     | State and subject                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0001-0003 | Accepted architectural foundations: domain boundaries, money representation, durable events.                                                        |
| ADR-0004-0007 | Proposed financial, reconciliation, payment, and expanded-product decisions.                                                                        |
| ADR-0008-0011 | Proposed operational resilience, launch, maturity, and governance decisions.                                                                        |
| ADR-0012      | Missing historical ADR; reconstructed in `ADR-0012-Customer-Foundation.md`.                                                                         |
| ADR-0013-0019 | Accepted Customer Foundation decisions: onboarding, eligibility, wallet metadata, instruments, beneficiaries, preferences, authentication metadata. |

The proposed ADRs must be ratified or superseded before the corresponding A1-A8 Architecture phase production gate.

## 8. Architecture gaps

1. **Runtime access:** no login, session, authorization, or protected internal API boundary.
2. **Financial binding:** customer-wallet metadata is not canonically mapped to `WalletAccount` and ledger accounts.
3. **Policy authority:** eligibility, restrictions, risk, compliance, limits, and enrollment do not yet produce one versioned capability decision.
4. **Risk overlap:** P1.3 eligibility risk data and P1.10 risk assessments have different purposes and storage history.
5. **Beneficiary overlap:** M6 beneficiary tooling and P1.6 customer beneficiaries have different ownership models.
6. **External partner boundary:** no bank/NIBSS adapter, callback, settlement, or external reconciliation boundary.
7. **Event delivery:** outbox persistence exists, but broker/publisher/inbox delivery is not part of the foundation.
8. **Operational authorization:** compliance, risk, support, and privileged administrative endpoints need role and approval controls.
9. **Privacy and retention:** A1 must define classification, minimization, retention, legal holds, and data-subject operations across customer records.

## 9. Non-negotiable invariants

- Ledger is the only authoritative financial record.
- Posted journals and lines are immutable.
- Money uses exact integer minor units and explicit currency.
- No customer metadata table may mutate balances.
- Financial commands are idempotent and auditable.
- External ambiguity enters pending/recovery/reconciliation, never silent success.
- Domain boundaries use contracts, not shared-table writes.
