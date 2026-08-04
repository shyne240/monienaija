# Architecture Phase Plan — A1-A8

## 1. Architecture-phase objective

The A1-A8 Architecture phases are the engineering execution track after Customer Foundation. They connect customer identity and lifecycle to protected operational and financial capabilities without weakening the ledger, audit, idempotency, outbox, or reconciliation boundaries. They enable the unchanged Product Roadmap P1.0-P1.15; they do not replace it.

The Architecture phases must not be treated as a request to add another isolated customer metadata module.

## 2. A1 — Foundation Consolidation

### Deliverables

- Reconstructed ADR-0012.
- Architecture inventory.
- Canonical ownership matrix.
- Duplicate-model disposition plan.
- Customer/account identity map.
- Risk and policy authority decision.
- Data classification and retention decisions.
- Architecture-phase ADR review calendar.

### Proposed ADRs

- ADR-0020 — Customer Foundation Closure and Scope Boundary.
- ADR-0021 — Customer Domain Canonical Model and Ownership Rules.
- ADR-0022 — Risk, Compliance, and Eligibility Decision Authority.
- ADR-0023 — Customer Identifier and Reference Conventions.
- ADR-0024 — Customer Data Classification, Retention, and Privacy.

### Dependencies

ADR-0001, ADR-0003, ADR-0008, ADR-0011, ADR-0012, and P1.0-P1.10.

### Exit gate

No duplicate authoritative writer remains unresolved. All A2-A5 boundaries have owners, source-of-truth definitions, data contracts, and rollback assumptions.

## 3. A2 — Runtime Identity & Access

### Objective

Create the runtime trust boundary needed to protect customer, operator, support, and internal APIs.

### Proposed ADRs

- ADR-0025 — Authentication Execution Boundary.
- ADR-0026 — Session and Token Lifecycle.
- ADR-0027 — Customer Authentication and Recovery Execution.
- ADR-0028 — Operator and Administrative Authorization.
- ADR-0029 — Privileged Actions and Approval.
- ADR-0030 — Secret, Hash, Token, and Device-Data Protection.

### Depends on

A1, P1.7 preferences, P1.8 authentication metadata, ADR-0008, and ADR-0009.

### Must not include

No payment authorization implementation, external OTP delivery, wallet changes, or ledger writes in the initial access-boundary phase.

### Exit gate

Protected routes, login/session/revocation tests, MFA execution tests, lockout tests, operator-role tests, secret-handling review, and privileged audit evidence pass.

## 4. A3 — Customer-to-Financial Account Binding

### Objective

Make the relationship between customer-wallet metadata and ledger-backed financial accounts explicit and repairable.

### Proposed ADRs

- ADR-0031 — Customer-to-Financial-Account Identity Binding.
- ADR-0032 — Wallet Provisioning to Ledger Account Mapping.
- ADR-0033 — Financial Account Ownership and Lifecycle Authority.
- ADR-0034 — Customer Financial Account Read Model.
- ADR-0035 — Account Binding Idempotency and Repair.

### Depends on

A1, A2, ADR-0002, ADR-0004, ADR-0005, ADR-0008, P1.4, Wallet, and Ledger.

### Exit gate

Customer UUID to account mappings reconcile, duplicate mappings are impossible, provisioning is idempotent, and no mapping operation creates or changes monetary value unexpectedly.

## 5. A4 — Capability & Policy Engine

### Objective

Create one versioned and explainable policy decision consumed by future financial commands.

### Proposed ADRs

- ADR-0036 — Customer Capability Policy Authority.
- ADR-0037 — Risk, Restriction, Compliance, and Limit Precedence.
- ADR-0038 — Product Eligibility and Limit Enforcement Contract.
- ADR-0039 — Customer-Visible Decision Reasons.
- ADR-0040 — Policy Versioning and Reproducibility.

### Depends on

A1, A2, P1.3 eligibility, P1.9 compliance cases, P1.10 risk assessments, and P1.4 enrollment.

### Exit gate

A policy result includes decision, product/capability, policy version, source evidence, expiry, and reasons. Financial services no longer implement independent eligibility or restriction logic.

## 6. A5 — Internal Financial Pilot

### Objective

Activate one bounded internal money-moving capability, recommended as customer-to-customer transfer.

### Proposed ADRs

- ADR-0041 — Customer-Aware Internal Transfer Command Boundary.
- ADR-0042 — Financial Command Authorization and Policy Evaluation.
- ADR-0043 — Ledger Posting and Customer Transaction Correlation.
- ADR-0044 — Transfer Idempotency, Outbox, and Recovery.
- ADR-0045 — Customer Transaction State and Pending Outcomes.
- ADR-0046 — Pilot Limits, Cohorts, and Rollback.

### Depends on

A2, A3, A4, ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0008, and existing transfer/ledger modules.

### Exit gate

Concurrent commands, duplicate retries, failed database transactions, outbox replay, ledger invariants, reconciliation, support traceability, and rollback all pass.

## 7. A6 — External Partners & Settlement

### Objective

Introduce external banks, NIBSS, funding, callbacks, settlement, and suspense handling only after the internal pilot.

### Proposed ADRs

- ADR-0047 — External Partner Adapter Boundary.
- ADR-0048 — NIBSS and Bank Integration Isolation.
- ADR-0049 — External Callback and Reference Idempotency.
- ADR-0050 — Settlement, Suspense, and Exception Ownership.
- ADR-0051 — External Funding-Instrument Use.
- ADR-0052 — External-Rail Data Minimization and Consent.

### Depends on

A2-A5, ADR-0005-0007, partner certification, legal, regulatory, security, and privacy review.

### Exit gate

Callback replay, provider outage, timeout, ambiguous outcome, settlement, suspense, reconciliation, and partner rollback evidence is approved.

## 8. A7 — Product Expansion Infrastructure

### Objective

Deliver products one at a time under common access, policy, ledger, event, and reconciliation contracts.

### Proposed ADRs

- ADR-0053 — Virtual Account Product Boundary.
- ADR-0054 — Bills and Airtime Product Boundary.
- ADR-0055 — Merchant and QR Payment Boundary.
- ADR-0056 — Agent and Assisted Channel Boundary.
- ADR-0057 — Card Product Boundary.
- ADR-0058 — Bulk and Payroll Payment Boundary.
- ADR-0059 — Savings and Credit Product Boundary.

### Depends on

A2-A6 as applicable, product governance, legal scope, partner readiness, risk approval, and product-specific reconciliation.

## 9. A8 — Scale & Selective Extraction

### Objective

Scale operationally and extract bounded services only where measured evidence justifies it.

### Proposed ADRs

- ADR-0060 — Service Extraction Criteria.
- ADR-0061 — Event Contract Ownership and Schema Evolution.
- ADR-0062 — Regional Data and Failover Strategy.
- ADR-0063 — Ledger and Reconciliation Scaling.
- ADR-0064 — Customer Financial Journey SLOs.

### Depends on

Production volume, load/chaos tests, DR evidence, reconciliation throughput, outbox lag, and capacity economics.

## 10. Rollback strategy

Every Architecture-phase implementation must provide:

- Feature or cohort gate.
- Command-level kill switch where applicable.
- Backward-compatible database migration strategy.
- No destructive migration without a restore and rollback plan.
- Replay-safe outbox/inbox behavior.
- Ledger corrections through compensating entries only.
- External ambiguity routed to pending/reconciliation, never silently reversed.
- Explicit operator runbook and customer-support message.
- Evidence that disabling a phase does not corrupt earlier customer metadata.
