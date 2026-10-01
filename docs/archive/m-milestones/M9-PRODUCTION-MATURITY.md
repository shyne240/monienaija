# M9 Production Maturity

M9 is the final engineering milestone. It adds long-term operational reporting, governance metadata, retention maintenance, health dashboards, and final acceptance evidence without adding money movement or financial products.

## Internal surfaces

- `GET /api/v1/internal/health-dashboard`
- `GET /api/v1/internal/reports/*`
- `GET /api/v1/internal/maintenance/preview`
- `POST /api/v1/internal/maintenance/execute`
- `GET /api/v1/internal/acceptance`

## Acceptance model

`PASS` means all required checks pass. `WARNING` means the system is operational but has reviewable conditions such as failed outbox events. `FAIL` means database, migration, reconciliation, governance, or operational dependency checks are not acceptable.

M9 endpoints remain internal and unauthenticated until the identity and authorization trust boundary is approved.
