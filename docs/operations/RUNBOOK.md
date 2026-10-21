# Operational Runbook

## Service healthy

Check:

```bash
curl -sS http://localhost:3000/api/v1/health
curl -sS http://localhost:3000/api/v1/health/ready
curl -sS http://localhost:3000/api/v1/internal/diagnostics
```

Review status, database, migration compatibility, reconciliation, and outbox counts.

## Reconciliation error

1. Stop or restrict money movement according to the approved incident process.
2. Capture the reconciliation report, diagnostics, audit events, outbox events, and relevant request IDs.
3. Identify whether the error is a schema, journal, currency, account, transfer, deposit, or withdrawal issue.
4. Do not edit financial rows.
5. Escalate to the ledger/finance owner and follow the approved compensating-entry or recovery procedure.

## Outbox backlog

Inspect:

```bash
curl -sS 'http://localhost:3000/api/v1/internal/outbox?limit=100' | jq .
```

M8 does not publish externally. Use the operational outbox service in an approved process to claim, retry, or mark events. Never modify event payloads.

## Idempotency issue

Compare the request hash and stored result for the scoped key. A changed payload is a conflict. An expired record may be cleaned through the approved cleanup operation. Never delete a non-expired record to force re-execution.

## Graceful shutdown

Send SIGTERM or SIGINT, confirm new requests receive draining responses, wait for active requests to finish, and verify the process closes its database connections. Do not terminate forcefully during an active financial write unless the incident procedure requires it.

## Correlation

Every investigation should record:

- Request ID
- Correlation ID
- Trace ID
- Payment/transfer/journal ID
- Application version
- Timestamp and environment
