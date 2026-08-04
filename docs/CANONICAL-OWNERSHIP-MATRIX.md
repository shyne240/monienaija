# Canonical Ownership Matrix

- Scope: MonieNaija after Customer Foundation P1.0-P1.10
- Rule: one authoritative writer per concept; projections and metadata must never become competing sources of truth

| Concept                  | Authoritative owner                                                                            | Current model/module                                          | Metadata or projection                        | Consolidation recommendation                                                            | Target phase |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| Customer                 | Customer domain                                                                                | `Customer` / `customer`                                       | Authority                                     | Continue as canonical UUID identity.                                                    | A1           |
| Customer Profile         | Customer domain                                                                                | `CustomerProfile`                                             | Authority for profile fields                  | Continue.                                                                               | A1           |
| Customer Identity        | Customer domain                                                                                | Contacts, identity documents, KYC metadata                    | Authority for stored identity evidence        | Keep provider verification separate from identity record.                               | A1/A2        |
| Customer Onboarding      | Customer Onboarding domain                                                                     | `CustomerOnboarding`                                          | Authority for onboarding workflow             | Continue.                                                                               | A1           |
| Customer Eligibility     | Eligibility domain                                                                             | `CustomerEligibility`                                         | Decision input                                | Consolidate with policy decision output; retain source evidence.                        | A4           |
| Customer Restrictions    | Eligibility domain                                                                             | `CustomerRestriction`                                         | Decision input                                | Centralize precedence in policy layer; retain source record.                            | A4           |
| Customer Limits          | Eligibility domain / Limit domain                                                              | `CustomerLimitProfile`, existing `LimitEngine`                | Profile is configuration; engine is evaluator | Define one enforcement contract; do not merge storage and evaluation blindly.           | A4           |
| Product Enrollment       | Eligibility domain                                                                             | `CustomerProductEnrollment`                                   | Entitlement metadata                          | Make policy layer the consumer-facing authority.                                        | A4           |
| Customer Wallet Metadata | Customer Wallet domain                                                                         | `CustomerWallet`                                              | Provisioning metadata                         | Bind to financial account through an explicit mapping; do not replace ledger wallet.    | A3           |
| Financial Wallet         | Wallet domain                                                                                  | `WalletAccount`                                               | Financial account facade                      | Remains the financial wallet record; bind to customer UUID through A3.                  | A3           |
| Ledger Wallet            | Ledger domain                                                                                  | Ledger liability account referenced by `WalletAccount`        | Financial source                              | Ledger account remains authoritative for value.                                         | A3/A5        |
| Ledger Accounts          | Ledger domain                                                                                  | `LedgerAccount`                                               | Authority                                     | Continue.                                                                               | A3           |
| Ledger Balances          | Ledger domain                                                                                  | Journal-line aggregation                                      | Derived financial projection                  | Never duplicate as a mutable wallet balance.                                            | A3/A5        |
| Funding Instruments      | Customer Funding Instrument domain                                                             | `CustomerFundingInstrument`                                   | Registration metadata                         | Remain metadata until external funding policy is approved.                              | A6           |
| Beneficiaries            | Customer Beneficiary domain for customer ownership; legacy M6 Beneficiary for existing tooling | `CustomerBeneficiary` and `Beneficiary`                       | Competing metadata models                     | Consolidate transfer-facing authority in A1/A5; preserve migration history.             | A1/A5        |
| Preferences              | Customer Preference domain                                                                     | `CustomerPreference`                                          | Customer configuration                        | Continue; later consumers read preferences through contracts.                           | A2/A6        |
| Authentication Metadata  | Customer Authentication domain                                                                 | Credential, reset, MFA, device, recovery entities             | Credential/recovery metadata                  | Continue as credential metadata; do not treat it as runtime auth.                       | A2           |
| Runtime Authentication   | Not yet owned                                                                                  | No login/session implementation                               | Missing capability                            | Create a dedicated identity-access boundary.                                            | A2           |
| Authorization            | Not yet owned                                                                                  | No authorization policy enforcement                           | Missing capability                            | Create customer, operator, and service authorization authority.                         | A2           |
| Compliance               | Compliance domain                                                                              | `CustomerComplianceCase` and history                          | Case metadata and operational record          | Cases remain evidence/workflow records; policy consumes decisions, not raw cases.       | A1/A4        |
| Risk                     | Risk domain                                                                                    | P1.10 risk assessment plus P1.3 eligibility-era risk metadata | Assessment evidence and decision input        | Consolidate canonical risk assessment authority and deprecate duplicate representation. | A1/A4        |
| Policy Decisions         | Not yet owned                                                                                  | P1.3 operating status and eligibility checks                  | Distributed decision logic                    | Introduce a versioned, explainable policy decision authority.                           | A4           |
| Transfers                | Transfer domain                                                                                | Existing `Transfer` and transfer lifecycle                    | Financial command and record                  | Customer-aware command boundary must consume policy and account mapping.                | A5           |
| Payments                 | Payment domain                                                                                 | Payment lifecycle/reference support                           | Financial orchestration metadata              | Keep payment orchestration separate from ledger posting and external adapters.          | A5/A6        |
| Reconciliation           | Reconciliation domain                                                                          | Independent reconciliation services                           | Independent control                           | Remains authoritative control for financial consistency, not transaction execution.     | A3-A7        |
| Audit                    | Operations domain                                                                              | `AuditService` / `audit_events`                               | Immutable operational history                 | Continue as the sole audit write boundary.                                              | All phases   |
| Outbox                   | Operations domain                                                                              | `OutboxService` / `outbox_events`                             | Durable event facts                           | Continue; add publisher/inbox only through ADR-0003-compatible design.                  | A5/A6        |
| Idempotency              | Operations domain                                                                              | PostgreSQL idempotency records                                | Command deduplication                         | Continue as shared primitive; require scoped command contracts.                         | A2-A7        |

## Overlap decisions

### P1.3 risk representation and P1.10 risk assessments

- **Why both exist:** P1.3 introduced risk-level metadata for eligibility and prohibited-risk gating. P1.10 introduced richer dated manual assessments and factor histories.
- **Authoritative model:** P1.10 should become the canonical assessment evidence model.
- **Metadata/projection:** P1.3 eligibility risk data is legacy decision metadata until migrated or explicitly treated as a projection.
- **Should both continue:** temporarily, for compatibility and history; not as independent writers.
- **Recommended consolidation:** define one risk assessment authority and one policy read model.
- **Phase:** A1 design; A4 enforcement.

### P1.4 CustomerWallet and financial WalletAccount

- **Why both exist:** P1.4 was intentionally non-financial; the existing wallet is ledger-backed and balance-derived.
- **Authoritative model:** `WalletAccount` plus the ledger is authoritative for financial account and value state.
- **Metadata/projection:** `CustomerWallet` is customer provisioning metadata.
- **Should both continue:** yes, but their relationship must be explicit.
- **Recommended consolidation:** add an account-binding boundary; do not merge tables or add balance fields to `CustomerWallet`.
- **Phase:** A3.

### M6 Beneficiary and P1.6 CustomerBeneficiary

- **Why both exist:** M6 beneficiary tooling predates Customer Foundation and supports existing financial-product tooling; P1.6 models customer-owned trusted recipients.
- **Authoritative model:** A1 must choose one transfer-facing beneficiary authority; likely P1.6 for customer ownership, with M6 records migrated or projected.
- **Metadata/projection:** the non-authoritative model becomes a compatibility projection or historical record.
- **Should both continue:** only during migration; not as two writable transfer authorities.
- **Recommended consolidation:** define transfer command input and migration mapping before A5.
- **Phase:** A1/A5.

### Customer Eligibility and future Policy Decisions

- **Why both exist:** P1.3 stores eligibility and restrictions; future policy decisions combine them with risk, compliance, limits, enrollment, and account state.
- **Authoritative model:** source domains remain authoritative for their facts; the policy service is authoritative for a specific decision at a specific version/time.
- **Metadata/projection:** policy result is a derived decision, not a replacement for source evidence.
- **Should both continue:** yes, with explicit read/write boundaries.
- **Recommended consolidation:** remove duplicated checks from financial services.
- **Phase:** A4.

### P1.8 Authentication Metadata and Runtime Authentication

- **Why both exist:** P1.8 intentionally stopped at credentials and recovery metadata; runtime authentication needs execution, sessions, challenges, and revocation.
- **Authoritative model:** P1.8 metadata remains credential source; A2 runtime service owns authentication decisions and sessions.
- **Metadata/projection:** session/token views are runtime projections and must not become credential storage.
- **Should both continue:** yes, with a strict trust boundary.
- **Recommended consolidation:** no table merge; define contracts and secret handling.
- **Phase:** A2.

### Preferences and notification delivery

- **Why both exist:** P1.7 stores customer intent; a future notification system would execute delivery.
- **Authoritative model:** preferences are authoritative for customer settings; notification service owns delivery state.
- **Metadata/projection:** delivery receipts are operational projections, not preferences.
- **Should both continue:** yes.
- **Recommended consolidation:** no; use versioned event/command contracts.
- **Phase:** A6 or later.

## Ownership rules

1. A projection may not write to its source authority.
2. A policy decision must reference its source versions and evidence.
3. Financial balances are never owned by customer metadata.
4. Audit, idempotency, and outbox writes remain owned by Operations.
5. Shared database tables may be read only through approved contracts; cross-domain shared-table writes are prohibited.
