# ADR-0019: Customer Authentication Credentials & Identity Recovery

- Status: Accepted
- Date: 2026-08-04
- Decision owners: Engineering, Security, Operations
- Scope: P1.8 internal authentication metadata and recovery lifecycle

## Context

P1.7 established customer preferences, including security preference metadata. The platform now needs durable storage for password credential metadata, password rotation and expiry, lock state, recovery workflows, MFA enrollment metadata, trusted devices, recovery codes, and security events.

P1.8 explicitly excludes authentication execution. No login, JWT, sessions, cookies, authentication middleware, authorization, OTP delivery, email, SMS, push, wallet operation, ledger operation, payment, transfer, or external identity provider may be introduced.

## Decision

Create a separate `src/customer-authentication` NestJS module with:

- `CustomerAuthenticationCredential`
- `PasswordHistory`
- `PasswordResetRequest`
- `PasswordResetToken`
- `MfaEnrollment`
- `MfaMethod`
- `TrustedDevice`
- `RecoveryCode`
- `SecurityEventHistory`

The module reads the existing `Customer` repository and stores internal metadata only.

### Password safety

Credential and rotation DTOs accept `passwordHash`, `hashAlgorithm`, `passwordVersion`, and optional expiry. They do not define plaintext password fields. Password history stores hash values and metadata; views and audit values omit hashes. Password reset tokens and recovery codes use `tokenHash` and `codeHash`; raw token and code values are never accepted or returned.

P1.8 does not verify hash correctness or compare passwords. Hashing and password comparison belong to an authentication execution layer that is deliberately outside this milestone.

### Credential lifecycle

Credentials have `PENDING`, `ACTIVE`, `SUSPENDED`, and `REVOKED` statuses. A customer has one non-deleted active password credential. Password rotation appends history and updates expiry metadata. Failed-authentication metadata increments a counter and locks the account after five failures. Unlock explicitly clears the counter and lock fields without silently changing lifecycle status.

### Recovery lifecycle

Reset requests and reset tokens have independent statuses and optimistic versions. Issuing a token accepts only a token hash and advances a requested reset to `IN_PROGRESS`. Updating a request or token records security events. No request or token endpoint resets a password or delivers a token.

### MFA, devices, and recovery codes

MFA enrollment and methods store status, type, labels, and optional identifier hashes. Trusted devices store device metadata and a fingerprint hash. Recovery codes store code hashes and lifecycle status. No secret, challenge, OTP, device proof, or delivery mechanism is implemented.

### Audit and security history

Every mutation writes an immutable audit event in the same transaction. Security event history is append-only and records the customer, optional credential, event type, actor, metadata, and occurrence time. Read endpoints do not mutate security state.

### Deletion and concurrency

Mutable records use soft deletion and optimistic version columns. Append-only records have no update endpoints. Unique active indexes prevent duplicate current credentials, MFA enrollments, device references, token hashes, and recovery-code hashes.

## Alternatives considered

### Implement login or authentication middleware

Rejected. P1.8 is metadata only. Login execution, sessions, JWT, cookies, and authorization require a separate security architecture and threat-model decision.

### Store plaintext passwords or reset tokens

Rejected. Only hash fields are present in DTOs and database columns. Plaintext values are not accepted by the public metadata API.

### Deliver OTPs or reset tokens from this module

Rejected. Email, SMS, push, and other delivery integrations are outside P1.8.

### Use preferences to enforce security settings

Rejected. P1.7 stores preferences only. P1.8 stores credential and security metadata but does not enforce authentication policy in middleware.

### Couple credentials to wallets or ledger operations

Rejected. Authentication metadata must remain independent from financial state.

## Consequences

### Positive

- Password lifecycle and recovery evidence are durable and auditable.
- Plaintext credentials, tokens, and recovery codes are excluded from the data model.
- Lock and unlock workflows are explicit.
- MFA, trusted-device, and recovery-code metadata can be registered without implementing authentication.
- Existing financial, notification, and identity-provider behavior remains unchanged.

### Trade-offs

- Hashing, comparison, login, token delivery, and OTP challenges are not available in P1.8.
- Security settings are recorded but not enforced by middleware.
- Metadata endpoints require controlled internal callers in a later authorization layer.
- Security-event history grows with every credential and recovery mutation.

## Verification

P1.8 verification includes:

- TypeScript build.
- ESLint.
- Prettier format checks.
- Unit tests for credential creation, password history, rotation, expiry metadata, failure counters, lock/unlock, reset requests and tokens, MFA, trusted devices, recovery codes, security events, hash-only DTO validation, and UUID validation.
- Existing wallet, ledger, payment, reconciliation, governance, production, customer, onboarding, eligibility, preference, funding-instrument, beneficiary, resilience, and maturity tests.
- PowerShell API verification in `docs/P1.8-CUSTOMER-AUTHENTICATION.md`.
