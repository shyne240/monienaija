# ADR-0013: Customer Onboarding, Risk Profiling & Customer Lifecycle

- Status: Accepted
- Date: 2026-08-04
- Decision owners: Engineering, Operations, Risk
- Scope: P1.2 internal customer onboarding domain

## Context

P1.1 established the internal customer, profile, address, contact, identity-document, and KYC foundation. The platform now needs a controlled internal workflow for onboarding evidence, risk classification, review decisions, and lifecycle completion.

The workflow must remain separate from financial behavior. Customer onboarding must not create wallets, access ledger accounts, post journals, initiate transfers, process payments, call external KYC services, authenticate users, authorize users, or send notifications.

The existing platform already provides PostgreSQL migrations, TypeORM repositories, DTO validation, optimistic version columns, soft deletion conventions, and immutable audit events through `AuditService`. P1.2 must extend those patterns without changing the wallet, ledger, payment, reconciliation, resilience, production, maturity, governance, or P1.1 customer behavior.

## Decision

Create a separate `src/customer-onboarding` NestJS module with five PostgreSQL entities:

- `CustomerOnboarding`
- `CustomerAgreement`
- `CustomerRiskProfile`
- `CustomerOnboardingTask`
- `CustomerApprovalDecision`

The module uses the existing customer tables as read-only evidence sources for readiness checks. It injects repositories for the existing customer, profile, address, and identity-document entities but does not call any financial module.

### Workflow ownership

An onboarding record belongs to one customer. Its status follows this state machine:

```text
NOT_STARTED -> IN_PROGRESS -> AWAITING_REVIEW -> APPROVED -> COMPLETED
                                |                  |
                                v                  v
                             REJECTED           COMPLETED
```

The implementation permits rejection from `IN_PROGRESS` and `AWAITING_REVIEW`. `REJECTED` and `COMPLETED` are terminal. A partial unique index allows one active workflow per customer while preserving terminal history.

### Completion gate

A workflow can move from `APPROVED` to `COMPLETED` only when:

1. The customer is `ACTIVE`.
2. An active profile exists.
3. At least one non-deleted address exists.
4. At least one non-deleted identity document exists.
5. At least one required agreement exists and all required agreements are accepted.
6. At least one required onboarding task exists and all required tasks are completed.
7. The current risk profile is not `PROHIBITED`.

The readiness endpoint evaluates these conditions independently and returns the missing conditions and boolean checks. A rejected workflow can never satisfy the completion transition.

### Agreement evidence

Agreements are versioned records scoped to the onboarding workflow. Each record stores its agreement type, version, required flag, acceptance state, acceptance time, and accepting actor. The `(onboarding_id, agreement_type, agreement_version)` combination is unique while the record is not soft-deleted. A new version is a new immutable evidence record rather than an in-place mutation.

### Risk profile

A customer has at most one non-deleted current risk profile, enforced by a partial unique index. The profile records `LOW`, `MEDIUM`, `HIGH`, or `PROHIBITED`, the rationale, and the assessing actor. P1.2 does not calculate risk using an external engine; it persists an internal classification supplied by an authorized future workflow. `PROHIBITED` explicitly blocks approval.

### Tasks

Tasks are scoped to the active onboarding workflow and carry a required flag and either `PENDING` or `COMPLETED` status. Readiness requires at least one required task and requires every required task to be completed. Task creation is audited. P1.2 intentionally does not add an external task engine or notification mechanism.

### Approval decisions

Approval decisions are append-only history with one `is_latest` record per customer. The latest decision may progress from `PENDING` or `ESCALATED` to a subsequent decision. Repeating the latest decision is rejected. Superseding a decision updates only its latest marker and creates an immutable audit event; the previous decision remains stored.

### Concurrency and deletion

All P1.2 entities have UUID identifiers, timestamps, a soft-deletion timestamp, and a TypeORM version column. Onboarding updates accept an optional expected version and reject stale versions. PostgreSQL partial unique indexes exclude soft-deleted rows. No hard-delete API is exposed.

### Audit

Every create or lifecycle mutation calls the existing `AuditService` in the same TypeORM transaction as the domain write. Audit entity types are:

- `CUSTOMER_ONBOARDING`
- `CUSTOMER_AGREEMENT`
- `CUSTOMER_RISK_PROFILE`
- `CUSTOMER_ONBOARDING_TASK`
- `CUSTOMER_APPROVAL_DECISION`

## Alternatives considered

### Put onboarding fields on `Customer`

Rejected. Onboarding is a workflow with its own history, tasks, evidence, decisions, and lifecycle. Adding it to `Customer` would make history and concurrency less explicit and would mix identity with process state.

### Use one mutable JSON document

Rejected. PostgreSQL tables and typed columns allow database constraints, unique current-record indexes, queryable readiness evidence, independent audit values, and stable DTO-to-domain mappings.

### Automatically create wallets at completion

Rejected. P1.2 is explicitly non-financial. Wallet creation belongs to a later, separately approved milestone and must not be coupled to onboarding completion.

### Replace the audit framework

Rejected. The existing immutable `AuditService` is the platform audit boundary and is used transactionally by this module.

## Consequences

### Positive

- Onboarding history is durable and queryable.
- Duplicate active workflows, current risk profiles, and latest decisions are constrained at both service and database layers.
- Completion readiness is explicit and diagnosable.
- Lifecycle transitions are validated and audited.
- Financial modules remain untouched and isolated.
- The module can evolve toward later workflow capabilities without changing P1.1 identity records.

### Trade-offs

- Required agreements and tasks must be explicitly created as evidence records before readiness can pass.
- Risk profiles and approval decisions require a later controlled update/history strategy beyond the P1.2 API surface.
- Manual task completion is represented by the internal API; no external task orchestration exists.
- Migration-head compatibility must be advanced for every schema milestone.

## Verification

P1.2 verification includes:

- TypeScript build.
- ESLint.
- Prettier format checks.
- Unit tests for onboarding, evidence persistence, readiness, duplicates, transitions, prohibited risk, and audit calls.
- Existing repository test suites.
- PowerShell API verification in `docs/P1.2-CUSTOMER-ONBOARDING.md`.
