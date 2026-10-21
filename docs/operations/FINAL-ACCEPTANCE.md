# Final Production Acceptance Guide

## Required commands

```bash
npm run build
npm run lint
npm run format:check
npm test -- --runInBand
npm run migration:run
```

## Required endpoint checks

```bash
curl --fail-with-body -sS http://localhost:3000/api/v1/health | jq .
curl --fail-with-body -sS http://localhost:3000/api/v1/health/ready | jq .
curl --fail-with-body -sS http://localhost:3000/api/v1/internal/diagnostics | jq .
curl --fail-with-body -sS http://localhost:3000/api/v1/internal/health-dashboard | jq .
curl --fail-with-body -sS http://localhost:3000/api/v1/internal/acceptance | jq .
```

## PASS criteria

- Configuration is valid.
- Database is healthy.
- Migration head is compatible.
- Reconciliation is `PASS` or an approved `WARNING`.
- Ledger and wallet checks are acceptable.
- Application and API versions are available.
- Audit, outbox, metrics, and governance metadata are readable.
- No unowned critical failures remain.
- Retention preview has been reviewed.
- Disaster-recovery and graceful-shutdown evidence is current.

A final `FAIL` blocks launch. A `WARNING` requires an accountable owner, documented risk acceptance, and expiry.
