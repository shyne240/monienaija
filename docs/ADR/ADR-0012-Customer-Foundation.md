# ADR-0012: Customer Identity, Profile, and KYC Foundation

- Status: Reconstructed for canonical architecture review
- Original status: Missing from the repository
- Reconstruction date: 2026-08-04
- Decision owners: Engineering, Security, Risk, Compliance, Operations
- Scope: P1.1 Customer Foundation

## Missing-record determination

The repository contains ADR-0001 through ADR-0011 and ADR-0013 through ADR-0019. No file named `ADR-0012` or an equivalent Customer Foundation ADR was found under `docs/ADR`.

ADR-0012 is therefore reconstructed here from the P1.1 implementation, migration, tests, documentation references, and the downstream P1.2-P1.10 ADRs. It is not a duplicate of another intentionally named ADR.

## Context

The platform required a customer domain before customer onboarding, eligibility, wallet provisioning, funding instruments, beneficiaries, preferences, authentication metadata, compliance cases, and risk assessments could be modeled. The customer domain needed to remain separate from the financial wallet and ledger domain.

The platform also needed durable identity and KYC metadata without authentication, authorization, external BVN/NIN providers, OCR, face matching, sanctions screening, AML automation, notifications, or payment behavior.

## Decision

Create a separate `src/customer` domain with PostgreSQL entities for:

- `Customer`
- `CustomerProfile`
- `CustomerAddress`
- `CustomerContactMethod`
- `CustomerIdentityDocument`
- `CustomerKycAssessment`

### Customer identity

Customer IDs are UUIDs. Customer references are normalized and globally unique. Customer type and lifecycle status are constrained enums. Customer records use soft deletion, timestamps, and optimistic versioning.

### Profile and supporting records

Profiles, addresses, contacts, identity documents, and KYC assessments belong to the customer through UUID foreign keys. Active-profile and current-KYC uniqueness are enforced through PostgreSQL partial indexes. Contact uniqueness uses normalized email and phone values. Identity-document types cannot duplicate for the same active customer record.

### KYC boundary

P1.1 stores KYC level, status, assessment metadata, and identity-document metadata only. It does not verify BVN or NIN, call a provider, run OCR, perform face matching, screen sanctions, run an AML engine, or make an external compliance decision.

### Financial boundary

Customer creation does not create wallets, ledger accounts, journals, transfers, deposits, withdrawals, payments, quotes, or external payment records. The financial system remains governed by ADR-0004 and the ledger domain.

### Audit and persistence

Every customer-domain create or update mutation uses the existing immutable `AuditService` in the same transaction as the PostgreSQL write. Schema synchronization is disabled; all schema changes use migrations. DTO validation is global and rejects unknown fields.

## Alternatives considered

### Put customer fields in the wallet table

Rejected. ADR-0001 requires domain ownership and ADR-0004 makes the ledger-backed wallet a financial boundary. Customer identity must not be coupled to financial account state.

### Use authentication credentials as customer identity

Rejected. Authentication and authorization were explicitly outside P1.1. Credential metadata is addressed later by ADR-0019 and runtime access is a future P2 phase.

### Call BVN/NIN providers during customer creation

Rejected. P1.1 is an internal metadata foundation. External identity providers require separate consent, privacy, partner, risk, retry, and reconciliation decisions.

### Use an untyped customer JSON document

Rejected. Typed PostgreSQL entities permit field validation, uniqueness, foreign keys, soft deletion, history, and predictable audit values.

## Consequences

### Positive

- Customer identity is independently owned and queryable.
- Onboarding and eligibility can use durable identity and evidence records.
- Financial modules can reference customer UUIDs without owning customer data.
- P1.2-P1.10 can add customer workflows without modifying the ledger.
- Audit and migration conventions are consistent with ADR-0008 and ADR-0009.

### Trade-offs

- KYC completion is metadata, not external verification.
- Customer endpoints are not production-public until the P2 identity/access boundary exists.
- Customer-to-ledger account binding remains a future phase.
- Some later milestones introduced adjacent models that require P2 consolidation.

## Dependencies

- **ADR-0001:** domain-oriented architecture and owned data.
- **ADR-0002:** any future financial relationship must use explicit currency and exact money representation.
- **ADR-0003:** later customer facts may publish durable events through the outbox contract.
- **ADR-0008:** immutable audit and operational resilience.
- **ADR-0009:** migration-head and production readiness.
- **ADR-0011:** product and launch governance.
- **ADR-0013:** onboarding consumes the Customer Foundation.
- **ADR-0014:** eligibility consumes customer and onboarding facts.
- **ADR-0019:** authentication metadata remains separate from customer identity.

## Future-phase dependency

ADR-0012 is a prerequisite for:

- **P2.0:** canonical ownership and model consolidation.
- **P2.1:** runtime identity and access.
- **P2.2:** customer-to-financial-account binding.
- **P2.3:** capability and risk policy decisions.
- **P2.4:** customer-aware financial commands.

## Verification record

The reconstruction is based on the P1.1 customer entities, migration `1785753600008-CreateCustomerFoundation.ts`, customer service tests, P1.1 documentation references, and the downstream customer-domain ADRs. The historical ADR absence should be recorded in the architecture decision log rather than silently treated as an original file.
