# ADR-0014: Customer Eligibility, Limits & Product Enrollment

- Status: Accepted
- Date: 2026-08-04
- Decision owners: Engineering, Operations, Risk
- Scope: P1.3 internal customer operating-permission domain

## Context

P1.2 established the internal onboarding workflow and requires completed evidence before a customer reaches onboarding `COMPLETED`. The platform now needs a separate decision layer for eligibility, customer limits, product enrollment, permissions, and restrictions.

This layer must remain non-financial. It may describe what a customer is allowed to use, but it must not create wallets, execute payments, post ledger entries, change balances, or call external services. It must preserve the existing customer, onboarding, audit, migration, and production-readiness patterns.

## Decision

Create a separate `src/customer-eligibility` NestJS module with five PostgreSQL entities:

- `CustomerEligibility`
- `CustomerLimitProfile`
- `CustomerProductEnrollment`
- `CustomerOperatingPermission`
- `CustomerRestriction`

The module reads the existing `Customer` and P1.2 `CustomerOnboarding` repositories. It records no wallet, ledger, payment, or external-system state.

### Eligibility gate

Eligibility is created as `PENDING` unless a caller supplies another valid status. A customer may become `ELIGIBLE` only when:

1. A non-deleted P1.2 onboarding record for the customer is `COMPLETED`.
2. There is no active `BLACKLISTED` restriction.

The eligibility state machine is explicit. `REVOKED` is terminal. A partial unique index ensures one non-deleted eligibility record per customer, preserving soft-deleted history without permitting a second active record.

### Limit profile

A limit profile stores the configured customer limits as typed values:

- Daily transaction count as a PostgreSQL integer.
- Daily transaction amount, single transaction amount, monthly transaction amount, and wallet balance as PostgreSQL `BIGINT` minor-unit strings.
- Three-letter currency code.

A partial unique index ensures one non-deleted active profile per customer. P1.3 only stores and updates configuration. It does not evaluate or apply limits to transactions.

### Product enrollment

Products are represented by normalized lowercase internal product identifiers rather than a new financial-product registry. Enrollment state follows an explicit lifecycle. Only an `ELIGIBLE` customer can create or transition an enrollment to `ACTIVE`; an active `FROZEN` restriction blocks the operation. A partial unique index ensures one non-deleted enrollment per customer and product.

The module does not create the product, wallet, account, card, virtual account, or payment capability associated with an enrollment.

### Permissions and restrictions

Permissions are one-record-per-type decisions with an `enabled` flag. Restrictions are one-record-per-type decisions with an `isActive` flag. `BLACKLISTED` blocks transition to `ELIGIBLE`; `FROZEN` blocks new active enrollments. `LIMITED` and `MANUAL_REVIEW` are represented in the operating-status decision view as `RESTRICTED`. `NONE` is retained as an explicit non-blocking record.

P1.3 exposes create and read APIs for these records. No hard-delete API is added, and no external screening provider is integrated.

### Operating status

The operating-status endpoint is a read-only decision view. It combines current eligibility, active restrictions, active enrollments, enabled permissions, and customer closure state. It returns a status, a `canOperate` boolean, and blocking reasons. It does not authorize or execute any transaction.

### Audit and concurrency

Every create or update mutation calls the existing immutable `AuditService` in the same TypeORM transaction as the domain write. All P1.3 entities use UUID IDs, timestamps, soft deletion, and TypeORM version columns. Mutating endpoints accept expected versions where a record is updated and reject stale versions.

## Alternatives considered

### Add eligibility fields to `Customer`

Rejected. Eligibility is a decision record with its own lifecycle and audit history. Keeping it separate avoids mixing identity state with product-operating state and allows database uniqueness and soft-deletion history.

### Use the existing financial limit engine

Rejected. The existing limit engine evaluates transaction requests and requires wallet/payment context. P1.3 only stores customer limit configuration and must not introduce financial behavior or couple customer eligibility to transaction execution.

### Use a product enum or create product tables

Rejected for P1.3. The milestone does not define a product catalogue. A normalized internal product identifier supports enrollment without implementing a later product registry or financial product provisioning flow.

### Automatically suspend or delete enrollments when restrictions change

Rejected. P1.3 does not perform cascading financial or product actions. The operating-status view reports the effect of current restrictions, while enrollment changes remain explicit and audited.

### Hard-delete duplicate records

Rejected. All duplicate protections use service checks and PostgreSQL partial unique indexes that exclude only soft-deleted records.

## Consequences

### Positive

- Eligibility is explicitly gated by completed onboarding.
- Customer operating permissions and restrictions are queryable and auditable.
- Active product enrollment and limit-profile uniqueness is enforced at service and database layers.
- Limit values remain exact minor-unit strings and are not exposed to floating-point rounding.
- Existing financial modules remain unchanged and isolated.
- The operating-status API gives operations a deterministic non-financial decision view.

### Trade-offs

- Permission and restriction records cannot be changed in place through P1.3; the API intentionally provides create and read operations only.
- A customer can retain historical soft-deleted records, but duplicate active records are rejected.
- P1.3 does not provision products or apply limits to transactions.
- The production migration-head compatibility check must advance with the new schema.

## Verification

P1.3 verification includes:

- TypeScript build.
- ESLint.
- Prettier format checks.
- Unit tests for eligibility gating, transitions, duplicate protection, limit profiles, enrollments, permissions, restrictions, blacklist and frozen enforcement, operating status, repository persistence, audit calls, and DTO validation.
- Existing wallet, ledger, payment, reconciliation, governance, production, customer, onboarding, resilience, and maturity tests.
- PowerShell API verification in `docs/P1.3-CUSTOMER-ELIGIBILITY.md`.
