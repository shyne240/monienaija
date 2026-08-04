# ADR-0016: Customer Funding Instruments

- Status: Accepted
- Date: 2026-08-04
- Decision owners: Engineering, Operations, Risk
- Scope: P1.5 internal funding-instrument registration and lifecycle

## Context

P1.4 established customer-wallet provisioning metadata without money movement. Customers now need to register funding instruments that may be used by later approved payment workflows.

P1.5 is intentionally a registration and lifecycle milestone. It must not execute payments, debit or credit wallets, post ledger journals, integrate banks, create cards, create transfers, create virtual accounts, or invoke reconciliation. Existing financial wallet, ledger, payment, and reconciliation modules must remain unchanged.

## Decision

Create a separate `src/customer-funding-instrument` NestJS module with:

- `CustomerFundingInstrument`
- `FundingInstrumentOwnership`
- `FundingInstrumentVerification`
- `FundingInstrumentHistory`

The module reads the existing `Customer` repository only. Registration does not require or mutate onboarding, eligibility, wallet, ledger, or payment state because P1.5 defines customer ownership and instrument lifecycle rather than payment eligibility.

### Instrument identity

Every instrument has a UUID, one customer UUID, a supported type, display name, normalized reference, lifecycle status, verification state, timestamps, soft deletion, and an optimistic version. References are trimmed and normalized to lowercase. A database unique constraint covers all references, including soft-deleted rows, so a reference cannot be reused.

### Ownership

Creating an instrument creates one ownership row in the same transaction. Ownership contains the instrument and customer UUIDs and has no update endpoint. The ownership unique index prevents more than one non-deleted owner row for an instrument. Ownership transfer is outside P1.5.

### Lifecycle and verification

Instrument lifecycle states are `PENDING`, `VERIFIED`, `SUSPENDED`, `INACTIVE`, and `REJECTED`. `VERIFIED` is reached only through the verification endpoint. Rejected instruments are terminal and cannot become verified. Deleted instruments cannot be verified.

Verification evidence is append-only. Each verification row records the verifying actor, verification timestamp, method, and remarks. Verification changes the instrument to `VERIFIED` and creates both a verification history event and audit events.

Status changes are explicit and append history. A status patch cannot directly set `VERIFIED`; this prevents a lifecycle update from bypassing verification evidence.

### History and audit

History records are append-only and record creation, ownership creation, status changes, and verification. Every domain mutation calls the existing immutable `AuditService` in the same transaction. Read endpoints create no audit records.

### Concurrency and deletion

The instrument, ownership, verification, and history tables have soft-deletion columns. Instrument updates use an optional expected optimistic version. No hard-delete endpoint is exposed.

## Alternatives considered

### Register funding instruments in the financial wallet module

Rejected. The existing wallet module creates ledger-backed financial wallets and reads balances. Coupling funding-instrument registration to it would violate the P1.5 no-money-movement boundary.

### Store verification fields directly on the instrument

Rejected. Verification is append-only and may occur more than once over an instrument lifecycle. Separate verification rows preserve evidence history and make each verification auditable.

### Allow reference reuse after soft deletion

Rejected. The requirement is a globally unique normalized reference and explicitly prohibits reuse. The database constraint therefore includes soft-deleted rows.

### Allow ownership updates

Rejected. Ownership is immutable in P1.5. Any later ownership transfer requires a separately approved workflow with its own controls.

### Gate registration on onboarding or eligibility

Rejected for this milestone. The explicit P1.5 rule is that a customer must exist. Registration does not authorize payment use; later milestones may apply onboarding, eligibility, and product-permission gates at the point of use.

## Consequences

### Positive

- Funding instruments can be registered without financial side effects.
- Reference uniqueness is durable and globally enforced.
- Verification and lifecycle history are append-only and auditable.
- Ownership cannot be modified through the P1.5 API.
- Existing wallet, ledger, payment, and reconciliation behavior remains unchanged.

### Trade-offs

- P1.5 does not verify with an external bank or mobile-money provider.
- A rejected instrument is terminal and requires a new reference for a new registration.
- Funding-instrument verification does not authorize or execute payments.
- Soft-deleted references remain unavailable for reuse.

## Verification

P1.5 verification includes:

- TypeScript build.
- ESLint.
- Prettier format checks.
- Unit tests for creation, duplicate references, verification, history, ownership, status transitions, soft deletion, DTO validation, UUID validation, audit events, and repository persistence.
- Existing wallet, ledger, payment, reconciliation, governance, production, customer, onboarding, eligibility, resilience, and maturity tests.
- PowerShell API verification in `docs/P1.5-CUSTOMER-FUNDING-INSTRUMENTS.md`.
