# ADR-0009: Production launch gates and request-safe runtime behavior

- **Status:** Proposed for domain review
- **Date:** 2026-08-03
- **Decision owners:** Future Engineering, Operations, Finance, Risk, and Security owners

## Context

The wallet, ledger, transfer, payment, and resilience domains need a controlled runtime boundary before production deployment. Startup must not serve an incompatible schema, requests need traceable context, failures need a stable contract, and shutdown must not abandon in-flight work.

## Decision

- Validate production configuration at startup with explicit development, test, staging, and production profiles.
- Verify PostgreSQL and the expected migration head before the HTTP listener accepts traffic.
- Expose additive API version metadata and return the active version header on responses.
- Generate or propagate request, correlation, and trace identifiers at the HTTP boundary and include them in structured logs and error responses.
- Standardize errors to stable status, code, message, timestamp, path, and correlation fields without exposing internals.
- Track active requests, reject new work during drain, wait a bounded interval, and rely on Nest/TypeORM shutdown hooks for resource cleanup.
- Keep deployment, disaster recovery, and operational acceptance as governance gates rather than embedding cloud or CI/CD tooling in the application.

## Consequences

Startup becomes deliberately fail-fast and requires a migrated database. Diagnostics and readiness execute read-only checks and may be more expensive than liveness. No authentication or authorization is introduced; internal endpoints must remain network-restricted until that trust boundary exists.
