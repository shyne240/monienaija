# ADR-0010: Operational maturity is read-only, governed, and manually maintained

- **Status:** Proposed for domain review
- **Date:** 2026-08-03
- **Decision owners:** Future Engineering, Operations, Finance, Risk, and Security owners

## Context

M9 is the final engineering milestone. Long-term production confidence requires summaries, retention, governance metadata, maintenance reporting, and an explicit acceptance decision without adding financial products, changing the ledger, or introducing an external operations platform.

## Decision

- Expose internal health dashboards and domain reports backed by read-only queries over existing source tables.
- Store one immutable governance metadata record per startup with application version, migration head, configuration fingerprint, build timestamp, startup timestamp, environment, and API version.
- Use manually invoked retention preview and execution services. Cleanup is bounded to configured datasets and never removes pending outbox events.
- Return `PASS`, `WARNING`, or `FAIL` from final acceptance. Warnings require documented ownership and risk acceptance; failures block launch.
- Keep all M9 operational APIs internal and unauthenticated until the identity/access trust boundary exists.

## Alternatives considered

1. **Scheduled cleanup workers:** rejected because M9 explicitly excludes background jobs and schedulers.
2. **External monitoring/reporting platforms:** rejected because M9 keeps operational state inside the backend and PostgreSQL.
3. **Mutating financial records during maintenance:** rejected because the ledger remains authoritative and financial corrections use existing controlled processes.

## Consequences

Reports and cleanup operations must be run deliberately and their evidence retained. Governance metadata accumulates immutable startup records. Operational dashboards may be expensive on large datasets and require future indexing/capacity work, but no new consistency model or balance cache is introduced.
