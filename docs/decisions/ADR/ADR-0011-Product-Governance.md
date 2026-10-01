# ADR-0011: Product governance is persisted, versioned, auditable, and non-financial

- **Status:** Proposed for product and governance review
- **Date:** 2026-08-03
- **Decision owners:** Future Product, Regulatory, Risk, Finance, Security, and Operations owners

## Context

The engineering platform is complete, but commercial product decisions require a durable governance record before customer-facing implementation begins. Product scope, regulatory requirements, launch controls, operational ownership, partner assessment, and acceptance evidence must not live only in documents or mutable application configuration.

## Decision

- Store P1.0 governance records in PostgreSQL as typed record kinds with keys, versions, statuses, owners, payloads, and timestamps.
- Treat records marked immutable as append-only; changes require a new version. Mutable configuration records remain auditable and status-controlled.
- Record create and update mutations through the existing immutable audit event framework in the same transaction.
- Provide internal product-governance APIs for record management, reporting, configuration reads, and launch-readiness evaluation only.
- Keep P1.0 non-financial. It cannot post ledger journals, alter wallets, execute payments, or change reconciliation behavior.
- Evaluate launch readiness from explicit governance evidence. Missing evidence is a warning; blocked evidence is a failure.

## Alternatives considered

1. **Markdown-only product governance:** rejected because launch evidence, ownership, and approvals need queryable durable records.
2. **One mutable configuration blob:** rejected because it loses record-level ownership, versioning, and auditability.
3. **Governance writes without audit:** rejected because product and launch decisions require an immutable operational trail.
4. **Embedding governance decisions in financial services:** rejected because P1.0 must not alter the frozen money engine.

## Consequences

P1.0 introduces one registry table with typed record kinds rather than a separate schema for every future product decision. Governance payload schemas remain product-owned and must be reviewed before P1.1. Internal APIs are unauthenticated because identity/access is explicitly later work and must be deployment-restricted.
