# ADR-0018: Customer Preferences & Notification Settings

- Status: Accepted
- Date: 2026-08-04
- Decision owners: Engineering, Operations, Product
- Scope: P1.7 internal customer preference profile

## Context

P1.6 established trusted-recipient registration without transfer execution. Customers now need to store language, theme, notification-channel, and security preferences.

P1.7 is a configuration and history milestone only. It must not send notifications, integrate email, SMS, or push providers, authenticate users, authorize users, execute financial operations, or invoke external services.

## Decision

Create a separate `src/customer-preference` NestJS module with:

- `CustomerPreference`
- `NotificationPreference`
- `LanguagePreference`
- `ThemePreference`
- `SecurityPreference`
- `PreferenceHistory`

`NotificationPreference`, `LanguagePreference`, `ThemePreference`, and `SecurityPreference` are TypeORM embedded value objects stored as columns in `customer_preferences`. `PreferenceHistory` is a separate append-only table.

### Single active profile

A customer may have one non-deleted preference profile. A partial unique index enforces this rule. A soft-deleted profile does not block a replacement profile. The profile has a TypeORM optimistic version column, and PATCH accepts an optional expected version.

### Preference representation

Language and theme use constrained enums. Notification channels and security settings are represented by explicit booleans rather than delivery or authentication integrations:

- Notification: email, SMS, push, in-app.
- Security: login alerts, transaction alerts, device-registration alerts, biometric allowed.

The API uses nested DTOs. Updates are partial and preserve unspecified nested values.

### History and audit

Every create or update writes a `PreferenceHistory` record containing the previous and new serialized values. The existing immutable `AuditService` records both the preference mutation and history creation in the same transaction. Read endpoints create no audit events.

### Non-functional boundary

Preference changes do not send notifications, invoke providers, change wallets, post ledger journals, execute payments, or call reconciliation. The module reads only the existing customer repository to verify ownership of the profile.

## Alternatives considered

### Create separate database tables for every preference group

Rejected. The milestone specifies two tables. Embedded value objects keep the profile atomic while retaining typed domain classes and DTOs.

### Trigger notification delivery from preference updates

Rejected. P1.7 stores intent only. Delivery belongs to a later notification milestone with provider, retry, consent, and operational controls.

### Use an untyped JSON preference blob

Rejected. Typed embedded fields and enum constraints provide stable validation, queryability, and audit snapshots.

### Allow multiple active profiles

Rejected. A customer owns exactly one active preference profile. Historical versions are represented by append-only history, not concurrent profiles.

### Mix security preferences with authentication

Rejected. P1.7 stores security settings only. It does not authenticate, authorize, register devices, or enforce biometrics.

## Consequences

### Positive

- Customers have a single, versioned preference profile.
- Partial updates are explicit and preserve unspecified settings.
- Preference changes are auditable and historically reconstructable.
- Notification and security settings can be stored without integrating delivery or authentication systems.
- Existing financial and operational behavior remains unchanged.

### Trade-offs

- Preferences do not cause any immediate notification behavior.
- Security settings are stored but not enforced by P1.7.
- Soft-deleted profiles require a replacement profile to be created explicitly.
- History is append-only and may grow with every preference update.

## Verification

P1.7 verification includes:

- TypeScript build.
- ESLint.
- Prettier format checks.
- Unit tests for creation, duplicate profile rejection, nested updates, history, optimistic versioning, soft-deleted replacement, DTO validation, UUID validation, audit events, and repository persistence.
- Existing wallet, ledger, payment, reconciliation, governance, production, customer, onboarding, eligibility, funding-instrument, beneficiary, resilience, and maturity tests.
- PowerShell API verification in `docs/P1.7-CUSTOMER-PREFERENCES.md`.
