# Post-Customer-Foundation Phases

## Scope

These phases begin after P1.0-P1.10. They are architecture and delivery gates. A phase does not authorize production release merely because its implementation is complete.

## Phase P2.0 — Foundation Closure and Model Consolidation

### Objective

Resolve overlapping models and make canonical ownership explicit before runtime activation.

### Work

- Reconstruct and approve the missing ADR-0012.
- Inventory every customer, wallet, risk, beneficiary, compliance, authentication, and financial-account representation.
- Define authoritative records, projections, history, and read models.
- Establish customer UUID as the canonical identity key for customer-owned domains.
- Define the customer-to-financial-account mapping boundary.
- Reconcile P1.3 risk representation with P1.10 risk assessments.
- Reconcile the M6 beneficiary module with P1.6 customer beneficiaries.
- Define data classification, retention, privacy, and operator access boundaries.

### Dependencies

- ADR-0001, ADR-0003, ADR-0008, ADR-0011.
- P1.0-P1.10 completion.
- Security, Finance, Risk, Compliance, and Operations ownership.

### Exit criteria

- Approved canonical ownership matrix.
- Approved identity and reference map.
- Approved risk and policy authority model.
- Approved wallet/account mapping model.
- ADR-0012 formally reconstructed and accepted.
- Proposed ADRs for P2.1-P2.4 reviewed.
- No unresolved duplicate authoritative writers.

## Phase P2.1 — Identity and Access Trust Boundary

### Objective

Protect customer, operator, support, and internal APIs with runtime authentication and authorization.

### Work

- Password verification against P1.8 hash metadata.
- Session or token lifecycle.
- MFA challenge execution.
- Password-reset completion using controlled hash inputs.
- Trusted-device enforcement.
- Customer authorization and operator authorization.
- Privileged-action approval and audit.
- Internal API access policy.

### Dependencies

- P1.7 preferences.
- P1.8 authentication metadata.
- ADR-0008 audit and operational resilience.
- ADR-0009 production runtime.
- P2.0 data and ownership decisions.

### Exit criteria

- Threat model and privacy review approved.
- No plaintext credential, raw token, or secret leakage.
- Login, session, MFA, reset, lockout, and revocation tests.
- Operator and support role matrix approved.
- Protected-route integration tests.
- Privileged action audit evidence.
- Key rotation and incident-response runbook.

## Phase P2.2 — Customer-to-Financial Account Binding

### Objective

Create one canonical mapping between Customer Foundation wallet metadata and ledger-backed financial accounts.

### Work

- Account-binding record and ownership rules.
- Idempotent customer-wallet provisioning to ledger account mapping.
- Currency and accounting-unit validation.
- Read-only customer account and balance views.
- Mapping repair and exception handling.
- Independent reconciliation of binding state.

### Dependencies

- P2.0 canonical ownership.
- P2.1 authorization.
- ADR-0002, ADR-0004, ADR-0005, ADR-0008.
- P1.4 customer-wallet metadata.
- Existing Wallet and Ledger modules.

### Exit criteria

- Exactly one authoritative financial account mapping.
- Duplicate and concurrent provisioning tests.
- No direct balance mutation.
- Ledger and customer ownership reconciliation pass.
- Partial-failure repair procedure.

## Phase P2.3 — Capability and Risk Policy Authority

### Objective

Convert customer state into a single explainable and versioned policy decision consumed by future financial commands.

### Work

- Combine onboarding, eligibility, restrictions, limits, product enrollment, compliance cases, and P1.10 risk assessments.
- Define precedence for closed, suspended, blacklisted, frozen, critical-risk, pending-review, and limited states.
- Produce `ALLOW`, `ALLOW_WITH_LIMITS`, `PENDING_REVIEW`, `DENY`, or `SUSPEND` decisions.
- Include policy version, evidence references, expiry, and explanation.
- Prohibit duplicated eligibility rules in individual payment services.

### Dependencies

- P2.0 risk and model consolidation.
- P1.3 eligibility.
- P1.9 compliance cases.
- P1.10 risk profiles.
- P1.4 product enrollment.
- P2.1 authorization.

### Exit criteria

- Decision matrix approved by Risk, Compliance, Finance, and Product.
- Policy version and evidence references persisted.
- Deterministic decision tests.
- Explainability and audit tests.
- Conflict and precedence cases documented.
- Consumer contract approved for financial commands.

## Phase P2.4 — Controlled Internal Financial Pilot

### Objective

Activate one bounded internal money-moving capability using customer identity, authorization, policy, ledger, idempotency, outbox, and reconciliation.

### Recommended first capability

Internal customer-to-customer transfer. It avoids external provider and settlement complexity while exercising the complete command path.

### Dependencies

- P2.1 identity and authorization.
- P2.2 account binding.
- P2.3 capability policy.
- ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0008.
- Existing transfer and ledger implementations.

### Exit criteria

- Concurrent double-spend tests.
- Idempotent retry and changed-payload rejection tests.
- Ledger balance and currency invariants.
- Outbox publication/replay evidence.
- Reconciliation pass.
- Customer and support trace from command to journal.
- Pilot cohort, limits, rollback, and go/no-go approval.

## Phase P2.5 — External Partner and Settlement Boundary

### Objective

Add external banks, NIBSS, funding, callback, and settlement workflows only after the internal pilot is proven.

### Work

- Partner adapters.
- Callback authenticity and replay protection.
- External references and idempotency.
- Settlement and suspense handling.
- Funding-instrument use.
- Timeout, retry, circuit-breaker, and ambiguous-outcome handling.
- External reconciliation and exception ownership.

### Dependencies

- P2.1-P2.4.
- ADR-0005, ADR-0006, ADR-0007.
- Partner certification.
- Legal, regulatory, security, and data-protection review.

### Exit criteria

- Partner certification.
- Callback replay tests.
- Provider outage drills.
- Settlement reconciliation.
- Suspense-account procedures.
- Customer-support and rollback runbooks.

## Phase P2.6 — Product-Specific Expansion

### Objective

Add new financial products one at a time under the common authorization, policy, ledger, event, and reconciliation boundaries.

### Recommended order

1. Virtual accounts.
2. Bills and airtime.
3. QR and merchant payments.
4. Agent and assisted channels.
5. Cards.
6. Bulk and payroll.
7. Savings and credit products.

### Dependencies

- P2.1-P2.5 as applicable.
- P1.0 product governance.
- Product-specific legal, risk, settlement, disclosure, support, and rollback approval.

### Exit criteria

- Product ADR and governance record.
- Product-specific reconciliation.
- Product-specific limits and policy tests.
- Partner readiness where applicable.
- Controlled cohort and rollback evidence.

## Phase P2.7 — Scale, Regional Resilience, and Selective Extraction

### Objective

Scale and extract services only when evidence demonstrates a need for independent fault isolation, ownership, release cadence, or regional operation.

### Dependencies

- Production volume and latency evidence.
- DR and failover tests.
- Event lag and outbox evidence.
- Reconciliation throughput evidence.
- ADR-0001, ADR-0003, ADR-0008, ADR-0009, ADR-0010.

### Exit criteria

- Load and chaos tests.
- RTO/RPO evidence.
- Regional failover evidence.
- Capacity and cost model.
- Extraction boundary ADRs.
- Operational ownership and on-call readiness.
