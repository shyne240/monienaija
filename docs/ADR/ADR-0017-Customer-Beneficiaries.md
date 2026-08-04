# ADR-0017: Customer Beneficiaries & Trusted Recipients

- Status: Accepted
- Date: 2026-08-04
- Decision owners: Engineering, Operations, Risk
- Scope: P1.6 internal beneficiary registration and lifecycle

## Context

P1.5 established customer funding-instrument registration without financial execution. Customers now need to save trusted recipients for potential future transfers.

P1.6 is a registry and lifecycle milestone only. It must not perform transfers, debit or credit wallets, post ledger journals, integrate banks or NIBSS, validate account ownership externally, or invoke reconciliation. Existing financial modules must remain unchanged.

## Decision

Create a separate `src/customer-beneficiary` NestJS module with:

- `CustomerBeneficiary`
- `BeneficiaryOwnership`
- `BeneficiaryVerification`
- `BeneficiaryHistory`

The module reads only the existing `Customer` repository. It records no wallet, ledger, payment, transfer, bank, or external-provider state.

### Beneficiary identity

Each beneficiary has a UUID, exactly one customer UUID, a supported beneficiary type, display name, normalized globally unique reference, destination identifier, optional destination metadata, nickname, status, verified flag, timestamps, soft deletion, and optimistic version.

References are trimmed and normalized to lowercase. The reference database constraint includes soft-deleted rows, so references cannot be reused. Destination identifiers are normalized for duplicate detection. A partial unique index prevents a customer from saving duplicate non-deleted destinations.

### Ownership

Beneficiary creation creates one ownership row in the same transaction. Ownership contains the beneficiary and customer UUIDs and has no update endpoint. Beneficiary ownership transfer is outside P1.6.

### Lifecycle

Beneficiary statuses are `PENDING`, `ACTIVE`, `SUSPENDED`, and `DELETED`. A suspended beneficiary may be explicitly reactivated. A deleted beneficiary is terminal and cannot become active again. Soft-deleted beneficiaries are excluded from ordinary list and detail reads, while ownership and history remain queryable for audit purposes.

### Verification

Verification is append-only. A verification request records the verifying actor, verification timestamp, method, and remarks, then sets the beneficiary verified flag to true. Verification does not change status to `ACTIVE` and does not execute or authorize a transfer. Deleted beneficiaries cannot be verified.

### History and audit

History records creation, ownership creation, status changes, and verification. Every beneficiary, ownership, verification, and history mutation calls the existing immutable `AuditService` in the same transaction. No read endpoint generates audit events.

### Concurrency and deletion

Beneficiary updates accept an optional expected optimistic version. All domain records have soft deletion fields, and no hard-delete endpoint is exposed.

## Alternatives considered

### Reuse the transfer or beneficiary module

Rejected. The existing beneficiary module is an operational/financial support domain and P1.6 requires a customer-owned trusted-recipient registry without transfer execution or external integrations.

### Validate account ownership externally

Rejected. P1.6 explicitly excludes banks, NIBSS, and external ownership verification. The verification endpoint records internal evidence only.

### Store verification on the beneficiary row only

Rejected. Verification is append-only and may occur more than once. Separate verification records preserve evidence history and audit detail.

### Allow reference reuse after soft deletion

Rejected. References are globally unique after normalization and cannot be reused. The database constraint covers soft-deleted records.

### Allow ownership updates

Rejected. Ownership is immutable in P1.6. Any later ownership transfer requires a separately approved workflow.

## Consequences

### Positive

- Trusted recipients can be registered without financial side effects.
- Duplicate destination and reference protections are enforced at service and database layers.
- Verification and lifecycle history are append-only and auditable.
- Ownership cannot be modified through the P1.6 API.
- Existing wallet, ledger, payment, transfer, bank, and reconciliation behavior remains unchanged.

### Trade-offs

- P1.6 does not validate recipient ownership with a bank, NIBSS, or external provider.
- A deleted beneficiary is terminal and cannot be reactivated.
- The verified flag does not authorize transfers.
- Soft-deleted references remain unavailable for reuse.

## Verification

P1.6 verification includes:

- TypeScript build.
- ESLint.
- Prettier format checks.
- Unit tests for creation, duplicate destinations and references, verification, status transitions, suspension reactivation, soft deletion, ownership, history, DTO validation, UUID validation, audit events, and repository persistence.
- Existing wallet, ledger, payment, reconciliation, governance, production, customer, onboarding, eligibility, funding-instrument, resilience, and maturity tests.
- PowerShell API verification in `docs/P1.6-CUSTOMER-BENEFICIARIES.md`.
