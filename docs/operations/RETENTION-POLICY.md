# Retention Policy

Retention is configurable and manually executed. M9 does not add a scheduler or background worker.

| Dataset                        | Configuration                   |  Default |
| ------------------------------ | ------------------------------- | -------: |
| Operational metrics            | `METRICS_RETENTION_SECONDS`     |  30 days |
| Audit events                   | `AUDIT_RETENTION_SECONDS`       | 365 days |
| Idempotency records            | `IDEMPOTENCY_RETENTION_SECONDS` |    1 day |
| Published/failed outbox events | `OUTBOX_RETENTION_SECONDS`      |  30 days |

Pending outbox events are never removed by retention cleanup. Audit deletion is allowed only through the controlled maintenance transaction and remains blocked for ordinary updates/deletes.

Use preview first:

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/maintenance/preview | jq .
```

Execute only after review:

```bash
curl --fail-with-body -sS \
  -X POST http://localhost:3000/api/v1/internal/maintenance/execute | jq .
```

Every cleanup response reports policy cutoffs, candidate counts, execution mode, and timestamp.
