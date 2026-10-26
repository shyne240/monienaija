# M8 Production Launch

M8 prepares the backend for a controlled production deployment. It adds no financial product or external integration.

## Release boundaries

- The ledger remains the only monetary source of truth.
- Wallet balances remain ledger-derived.
- No authentication or authorization is introduced by M8; internal APIs must remain network-restricted until that trust boundary exists.
- External payment rails, cloud deployment, brokers, Redis, background workers, and monitoring platforms remain outside this milestone.

## Startup gates

The application must refuse to listen when:

- Required configuration is invalid.
- PostgreSQL is unavailable.
- The migration table is unavailable.
- The latest migration is not `CreateOperationalResilience1785753600005`.
- Reconciliation readiness is `ERROR`.
- The outbox diagnostics cannot be read.

## Runtime behavior

Every request receives or propagates:

- `X-Request-Id`
- `X-Correlation-Id`
- `X-Trace-Id`
- `X-API-Version`

Structured request logs include operation name, status code, latency, and correlation context. SIGTERM and SIGINT initiate request draining before application resources close.

## Acceptance evidence

Run the quality commands, apply all migrations to a production-like database, verify `/api/v1/internal/readiness`, exercise the manual acceptance guide, run reconciliation, and record the production checklist approval before deployment.
