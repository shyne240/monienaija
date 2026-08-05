# Canonical Ownership Matrix

- **Task:** A1T08 — Canonical Ownership, Roadmap, and Dependency Package
- **Scope:** MonieNaija after the Customer Foundation P1.0-P1.10 and A1T02-A1T07 reviews
- **Classification:** Documentation-only architecture synthesis
- **Application code, API, entity, migration, and configuration changes:** None
- **Detailed inputs:** [`PLATFORM-CUSTOMER-INVENTORY.md`](PLATFORM-CUSTOMER-INVENTORY.md), [`MODULE-SCHEMA-API-INVENTORY.md`](MODULE-SCHEMA-API-INVENTORY.md), [`CROSS-CUTTING-CONTRACTS.md`](CROSS-CUTTING-CONTRACTS.md), [`CUSTOMER-ADJACENT-OVERLAP-REVIEW.md`](CUSTOMER-ADJACENT-OVERLAP-REVIEW.md), [`RISK-COMPLIANCE-AUTHORITY-REVIEW.md`](RISK-COMPLIANCE-AUTHORITY-REVIEW.md), and [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md)
- **Decision status:** A1 canonical decision package and ADR-0021 input; formal ADR approval remains a later A1 task

## 1. Ownership rules

1. Each concept has one authoritative writer. A consumer, report, policy result, or compatibility view may not become a competing source of truth.
2. `Customer.id` is the canonical customer UUID for customer-owned records. Customer references, aliases, case numbers, and provider references are not replacements for it.
3. The ledger owns financial value, posted journals, journal lines, and ledger-account state. Wallet and customer metadata may identify or request financial capabilities but may not mutate balances.
4. A metadata record describes provisioning, registration, preference, credential, risk, or workflow state. A projection is derived and read-only. Neither may write to its source.
5. A policy decision is authoritative only for its stated subject, capability, action, policy version, and evaluation time. It does not rewrite the evidence used to produce it.
6. Cross-domain reads use an approved contract. Cross-domain shared-table writes are prohibited.
7. Operations remains the owner of shared audit, idempotency, outbox, metrics, diagnostics, and operational evidence primitives. Financial domains remain owners of financial command and lifecycle state.
8. Reconciliation is an independent control and cannot repair source records by changing them to match a report.
9. Identifier scope, normalization, retention owner, and external-sharing restrictions are part of ownership. A domain that receives a reference does not acquire the referenced data.
10. A1 decisions establish boundaries only. Runtime access, account binding, policy enforcement, financial activation, and external integration remain future Architecture phases.

## 2. Canonical ownership matrix

| Concept                                                                     | Authoritative owner                                                                                | Current model / module                                                               | Authority type                                             | Metadata or projection status                                                           | Consolidation recommendation                                                                                                                | Target phase      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Customer UUID and customer reference                                        | `customer`                                                                                         | `Customer` / `customers`                                                             | Canonical identity                                         | Customer UUID is the canonical join key; reference is a controlled lookup/display value | Keep one customer identity authority. Never replace UUIDs with references or provider IDs.                                                  | A1 / A2           |
| Customer profile, contacts, addresses, identity documents, and KYC metadata | `customer`                                                                                         | Customer Foundation profile/contact/address/document/KYC entities                    | Customer evidence authority                                | Source records, not financial projections                                               | Keep identity evidence in `customer`; external verification and runtime access remain separate boundaries.                                  | A1 / A2 / A6      |
| Customer onboarding                                                         | `customer-onboarding`                                                                              | Onboarding, agreements, tasks, approval decisions, readiness                         | Workflow authority                                         | Source workflow and historical decision evidence                                        | Continue as onboarding authority; expose completion as an input, not a wallet or policy write.                                              | A1 / A4           |
| Eligibility status                                                          | `customer-eligibility`                                                                             | `CustomerEligibility`                                                                | Current eligibility source until A4                        | Decision metadata / policy input                                                        | Keep current eligibility writes here until A4 defines a policy output authority.                                                            | A4                |
| Customer restrictions                                                       | `customer-eligibility`                                                                             | `CustomerRestriction`                                                                | Current restriction source until A4                        | Decision metadata / policy input                                                        | Keep source restrictions and centralize precedence in A4; financial modules must not reinterpret them independently.                        | A4                |
| Customer limits                                                             | `customer-eligibility` with existing limit tooling                                                 | `CustomerLimitProfile`, limit evaluator                                              | Configuration and evaluation input                         | Configuration is source metadata; an evaluated limit is a derived result                | Define one A4 enforcement contract without merging configuration storage with transaction execution.                                        | A4 / A5           |
| Product enrollment and permissions                                          | `customer-eligibility`                                                                             | Enrollment and operating-permission entities                                         | Capability input authority                                 | Entitlement metadata, not runtime authorization                                         | A4 consumes versioned enrollment and permission evidence; A2 owns principal authorization.                                                  | A2 / A4           |
| Customer-wallet provisioning metadata                                       | `customer-wallet`                                                                                  | `CustomerWallet`, aliases, ownership, provisioning history                           | Provisioning metadata authority                            | Metadata only; no ledger account or balance                                             | Preserve as customer-facing provisioning state and bind explicitly to financial accounts in A3.                                             | A3                |
| Financial wallet                                                            | `wallet`                                                                                           | `WalletAccount`                                                                      | Financial wallet facade                                    | References ledger account; balance is ledger-derived                                    | Keep financial wallet separate from `CustomerWallet`; A3 owns the binding and repair contract.                                              | A3 / A5           |
| Ledger accounts                                                             | `ledger`                                                                                           | `LedgerAccount`                                                                      | Financial account authority                                | Source financial record                                                                 | Continue as the account authority; no customer metadata table may create a competing account or balance.                                    | A3 / A5           |
| Ledger journals and lines                                                   | `ledger`                                                                                           | `LedgerJournal`, `LedgerLine`                                                        | Immutable financial posting authority                      | Source financial history                                                                | Continue as the only posted-value history; corrections use compensating entries.                                                            | A5 / A6           |
| Financial balances                                                          | `ledger`                                                                                           | Journal-line aggregation                                                             | Derived financial truth                                    | Read-only calculation / projection                                                      | Never add mutable customer or wallet balance columns as an authority.                                                                       | A3 / A5           |
| Transfers                                                                   | `transfer`                                                                                         | Transfer lifecycle and command records                                               | Financial lifecycle authority                              | Command outcome and financial record; journal remains value authority                   | A5 must add customer authorization, policy, account binding, recovery, and reconciliation around the existing lifecycle.                    | A5                |
| Deposits and withdrawals                                                    | `deposit` / `withdrawal`                                                                           | Controlled payment lifecycle records                                                 | Financial lifecycle authority                              | Pending/completed/failure metadata; journal remains value authority                     | Keep internal scope controlled; external rails and ambiguous outcomes belong to A6.                                                         | A5 / A6           |
| Payments and payment references                                             | `payment` plus respective financial domain                                                         | Payment reference registry and payment lifecycle support                             | Financial reference/control authority                      | Payment reference is a cross-domain lookup value, not monetary truth                    | Keep reference generation centralized and correlate to source records without copying balances.                                             | A5 / A6           |
| Funding instruments                                                         | `customer-funding-instrument`                                                                      | Funding instrument, ownership, verification, history                                 | Customer registration metadata authority                   | Metadata only; not external account ownership or settlement proof                       | Keep registration metadata separate; map to provider/settlement references only through A6.                                                 | A6                |
| Customer beneficiaries                                                      | `customer-beneficiary` preferred for customer-owned transfer authority                             | `CustomerBeneficiary` and related history/verification/ownership                     | Customer recipient metadata authority, subject to ADR-0021 | Trusted-recipient metadata; verification does not authorize transfers                   | Stop independent transfer-facing writes to the legacy model after migration approval; preserve compatibility history.                       | A1 / A5 / A6      |
| Legacy beneficiaries                                                        | Legacy `beneficiary`                                                                               | `Beneficiary` / M6 tooling                                                           | Compatibility authority for existing consumers only        | Legacy metadata / compatibility projection candidate                                    | Do not create a second writable customer-recipient authority; define mapping before A5.                                                     | A5 / A6           |
| Customer preferences                                                        | `customer-preference`                                                                              | `CustomerPreference`, embedded preferences, history                                  | Customer intent authority                                  | Stored intent; delivery and enforcement are separate projections/consumers              | Continue as preference authority; notification systems read through a contract and do not write delivery state here.                        | A2 / A7           |
| Authentication and recovery metadata                                        | `customer-authentication`                                                                          | Credentials, password history, reset, MFA, device, recovery, security-event entities | Credential/security metadata authority                     | Metadata required by future runtime authentication; no sessions or authorization        | A2 consumes controlled contracts without duplicating hashes, sessions, or principal state.                                                  | A2                |
| Runtime authentication                                                      | Future A2 identity/access boundary                                                                 | No login/session runtime implementation                                              | Missing runtime authority                                  | Future execution result / session projection                                            | Create one protected runtime boundary; do not add it to customer metadata modules in A1.                                                    | A2                |
| Authorization and privileged access                                         | Future A2 identity/access boundary                                                                 | No complete authorization policy enforcement                                         | Missing security authority                                 | Future principal/role/approval decision                                                 | Centralize principal, role, service, support, and privileged-action authorization; financial modules consume decisions.                     | A2                |
| Compliance cases and evidence                                               | `customer-compliance`                                                                              | Cases, assignments, comments, evidence, histories                                    | Case-management and investigation-record authority         | Operational evidence, not an AML/sanctions/fraud engine                                 | Retain source case history; A4 may consume approved evidence references but must not reinterpret case creation as screening.                | A1 / A4           |
| Manual risk assessments and factors                                         | `customer-risk-profile` preferred evidence authority                                               | P1.10 assessments, factors, assessment/factor histories                              | Manual risk-evidence authority                             | Source evidence and history; not an automated risk engine                               | Use P1.10 for new manual assessments; retain P1.3-era metadata as compatibility evidence.                                                   | A1 / A4           |
| Policy decisions                                                            | Future A4 policy boundary                                                                          | No centralized versioned policy decision                                             | Future decision authority                                  | Derived, versioned decision output                                                      | A4 owns action-specific decisions and source-version references; it does not own identity, risk, compliance, or eligibility source records. | A4                |
| Audit events                                                                | `operations`                                                                                       | `AuditService`, `audit_events`                                                       | Immutable operational history authority                    | Audit record, not domain source state                                                   | All mutating domains use the shared service; no direct per-module audit tables.                                                             | All phases        |
| Idempotency                                                                 | `operations` with command-owner scopes                                                             | `IdempotencyService`, financial command keys, idempotency records                    | Shared command-deduplication authority                     | Operational command evidence; source resource remains domain-owned                      | Require explicit `(scope, key)` ownership and request-hash conflict behavior.                                                               | A2-A7             |
| Transactional outbox and event facts                                        | `operations` for persistence; event-producing domain for meaning                                   | `OutboxService`, `outbox_events`                                                     | Durable event-fact authority                               | Minimal versioned event fact; consumers are projections                                 | Preserve atomic source/outbox writes; publisher/inbox and external delivery require later ADR-compatible designs.                           | A5-A8             |
| Request, correlation, causation, and trace context                          | Production/HTTP boundary and event/command owners                                                  | Request context, audit correlation, future event envelope                            | Cross-cutting traceability authority                       | Operational correlation metadata, not business truth                                    | Propagate context; add explicit causation to future event envelopes before external publication.                                            | A2 / A5 / A6      |
| Data classification and privacy controls                                    | Domain owner for source data; Security/Compliance for policy and Legal for holds                   | Identifier/privacy/retention control package                                         | Governance control                                         | Classification and retention metadata govern sources and projections                    | Apply field-level minimization, hold precedence, and external-sharing rules without creating a new data owner.                              | A1 / A2 / A6      |
| Retention and legal holds                                                   | Dataset owner; Compliance/Legal owns legal-hold decision; Operations executes approved maintenance | Retention policy, maintenance, audit/outbox/metric cleanup                           | Governance/control authority                               | Retention action is a controlled operation, not a source-data projection                | Define schedules before deletion; holds override cleanup and financial/audit immutability.                                                  | A1 / A2 / A6      |
| Metrics and diagnostics                                                     | `operations`                                                                                       | Metrics, diagnostics, readiness views                                                | Operational observation authority                          | Read-only projections; not business or financial truth                                  | Continue shared primitives; degraded telemetry must not reject financial writes.                                                            | All phases        |
| Reconciliation                                                              | `reconciliation` with Finance ownership                                                            | Independent reconciliation queries and reports                                       | Independent financial control                              | Read-only control projection                                                            | Keep independent from write services; no report-clearing mutations.                                                                         | A3-A7             |
| Product governance and launch evidence                                      | `product-governance` / `maturity`                                                                  | Governance records, readiness, acceptance, reports                                   | Governance authority                                       | Readiness and evidence projections                                                      | Keep governance separate from domain state; gates must name accountable owners and evidence.                                                | A1 / A4 / A6 / A7 |

## 3. Overlap disposition register

| Overlap                                                     | Authority decision                                                                                                          | Metadata / projection disposition                                                                          | Consolidation phase and dependency                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `CustomerWallet` versus `WalletAccount` and ledger accounts | `wallet`/`ledger` own financial account and value; `customer-wallet` owns provisioning metadata                             | Customer-wallet state may project provisioning status; it cannot store or calculate balances               | A3; depends on A1 identity rules, A2 access, and independent reconciliation |
| Legacy `Beneficiary` versus `CustomerBeneficiary`           | P1.6 `customer-beneficiary` is the preferred customer-owned transfer-facing authority, subject to ADR-0021                  | Legacy data becomes compatibility/historical data or a read-only projection after migration approval       | A5, with A6 provider mapping; no two writable transfer authorities          |
| P1.3 eligibility-era risk versus P1.10 risk profiles        | P1.10 owns preferred manual assessment evidence; P1.3 owns current eligibility/restrictions until A4                        | Legacy risk data remains evidence/compatibility metadata; A4 owns the derived policy decision              | A4; preserve history and define explicit vocabulary mapping                 |
| Authentication metadata versus runtime authentication       | `customer-authentication` owns stored credential/recovery/device metadata; A2 owns runtime authentication and authorization | Sessions, tokens, and runtime decisions are projections/execution state, not duplicated credential records | A2; protected route boundary precedes customer-facing activation            |
| Preferences versus notification delivery                    | `customer-preference` owns customer intent; future notification infrastructure owns delivery                                | Delivery attempts, provider outcomes, and job state are separate operational records                       | A7, after access and event contracts                                        |
| Compliance cases versus policy decisions                    | `customer-compliance` owns case/evidence/workflow; A4 owns action-specific policy decisions                                 | Policy reads source evidence references and versions; it does not replace or silently rewrite case status  | A4; no automated AML, sanctions, fraud, or monitoring engine in A1          |
| Customer references versus financial identifiers            | Customer domain owns customer UUID/reference; financial domains own wallet/ledger/payment IDs                               | References may correlate records but never become balances, account ownership, or posting authority        | A3/A5; explicit mapping and reconciliation required                         |
| Source records versus audit/outbox/metrics/readiness        | Domain owner owns source; Operations owns shared operational facts; Reconciliation owns independent checks                  | Operational records are minimized projections/control evidence and cannot write back to sources            | All phases; retention and legal holds apply by owner                        |

## 4. Roadmap and phase mapping

The implementation sequence is intentionally two-track:

```text
M0-M9 Engineering & Financial Core
        |
        v
P1.0-P1.10 Customer Foundation
        |
        v
A1 Foundation Consolidation
        |
        +--> A2 Runtime Identity & Access
        +--> A3 Customer-to-Financial Account Binding  (design may run with A4)
        +--> A4 Capability & Policy Engine              (design may run with A3)
                    |
                    v
        A5 Internal Financial Pilot
                    |
                    v
        A6 External Partners & Settlement
                    |
                    v
        A7 Product Expansion Infrastructure
                    |
                    v
        A8 Scale & Selective Extraction
        |
        v
Product Roadmap delivery P1.11-P1.15 when its Architecture gates are satisfied
```

- **M0-M9:** Engineering and Financial Core; ledger, money, resilience, production, maturity, and governance foundations.
- **P1.0-P1.10:** Product governance and Customer Foundation metadata/lifecycle capabilities. These names remain Product Roadmap names.
- **A1:** Consolidates ownership and boundaries; it does not add runtime identity, account binding, policy execution, or financial activation.
- **A2:** Establishes the protected runtime identity and authorization boundary.
- **A3:** Binds canonical customer identity to ledger-backed financial accounts.
- **A4:** Produces versioned, explainable capability and policy decisions.
- **A5:** Activates one bounded internal financial flow with authorization, ledger, idempotency, outbox, recovery, and reconciliation.
- **A6:** Adds isolated external partner and settlement boundaries only after A5 evidence.
- **A7:** Adds product expansion infrastructure and shared notification/support/reporting contracts.
- **A8:** Applies evidence-led scale, resilience, regional, and selective extraction decisions.

The original Product Roadmap P1.0-P1.15 remains unchanged in [`ROADMAP.md`](ROADMAP.md). Architecture phases do not renumber or replace Product Roadmap milestones.

## 5. ADR-to-phase dependency package

| ADR range / decision      | Current state                                                                                                                                 | Primary phase dependency                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| ADR-0001 through ADR-0003 | Accepted architectural, money, and durable-event foundations                                                                                  | A1, A3, A5-A8                                           |
| ADR-0004 through ADR-0007 | Proposed financial, reconciliation, payment, and expanded-tooling decisions                                                                   | A3-A7 review before activation                          |
| ADR-0008 through ADR-0011 | Proposed resilience, launch, maturity, and governance decisions                                                                               | A1, A2, A5-A8 review                                    |
| ADR-0012                  | Reconstructed Customer Foundation decision                                                                                                    | A1, A2, A3, A4                                          |
| ADR-0013 through ADR-0019 | Customer Foundation decisions: onboarding, eligibility, wallet metadata, instruments, beneficiaries, preferences, and authentication metadata | A1-A6 as mapped in the ADR inventory                    |
| ADR-0020                  | Foundation Closure and Scope Boundary — later A1 draft                                                                                        | A1 exit and all A2-A8 gates                             |
| ADR-0021                  | Customer Domain Canonical Model and Ownership Rules — later A1 draft                                                                          | A1 ownership closure, A3-A5 boundaries                  |
| ADR-0022                  | Risk, Compliance, and Eligibility Decision Authority — later A1 draft                                                                         | A4 policy authority                                     |
| ADR-0023                  | Customer Identifier and Reference Conventions — later A1 draft                                                                                | A2 context, A3 identity binding, A5 command correlation |
| ADR-0024                  | Customer Data Classification, Retention, and Privacy — later A1 draft                                                                         | A2 access, A6 external processing, all retention gates  |

The rows for ADR-0020 through ADR-0024 are planned dependencies and inputs, not claims that those later ADR documents have already been approved.

## 6. Critical path and prohibited edges

### Critical path

```text
A1T01
  -> A1T02
  -> A1T03
  -> A1T04
  -> A1T05 / A1T06 / A1T07
  -> A1T08
  -> A1T09
  -> A1T10 / A1T11 / A1T12
  -> A1T13
  -> A1T14
  -> A2 entry

A1 exit
  -> A2
  -> A3 and A4 design/implementation gates may be prepared in parallel
  -> A2 + A3 + A4
  -> A5
  -> A6
  -> A7
  -> A8
```

A3 and A4 may be designed in parallel after A1, but A5 cannot start until A2, A3, and A4 gates all pass. A later phase may consume an earlier phase only through its approved contract.

### Prohibited edges

- Customer metadata or policy projections directly write ledger balances, journals, or lines.
- `CustomerWallet` becomes a second financial-wallet or balance authority.
- A customer reference, beneficiary reference, case number, payment reference, or provider ID replaces a canonical internal ID.
- Legacy and Customer Beneficiary models remain independent writable transfer authorities.
- Financial modules implement local conflicting risk, eligibility, restriction, or authorization decisions.
- Compliance case creation is treated as an AML, sanctions, fraud, or transaction-monitoring engine.
- Preferences directly own notification delivery state.
- Authentication metadata modules issue runtime authorization without A2.
- External providers are called from customer metadata modules before A6.
- Operations, metrics, readiness, or reconciliation projections mutate source records to clear a report.
- A1 documentation claims that A2-A8 runtime capabilities are already implemented.

## 7. A1T08 acceptance evidence

- [x] The matrix assigns an authoritative owner, metadata/projection status, consolidation recommendation, and target phase to each major concept.
- [x] Customer, wallet, ledger, beneficiary, funding-instrument, risk, compliance, authentication, identifier, privacy, and retention decisions are cross-referenced to their detailed A1 inputs.
- [x] Product Roadmap P1.0-P1.15 names remain unchanged.
- [x] Architecture phase names use A1-A8 consistently and are not presented as Product Roadmap milestones.
- [x] The dependency package shows A1 before A2-A8, allows A3/A4 parallel design after A1, and requires A2/A3/A4 before A5.
- [x] Prohibited cross-domain ownership and dependency edges are explicit.
- [x] ADR-0001 through ADR-0019 and proposed ADR-0020 through ADR-0024 dependencies are identified without silently replacing earlier ADRs.
- [x] No application code, schema, API, migration, module, or runtime configuration is introduced.
