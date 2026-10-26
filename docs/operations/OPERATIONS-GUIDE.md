# Operations Guide

## Daily checks

1. Query `/api/v1/internal/health-dashboard`.
2. Query `/api/v1/internal/acceptance`.
3. Review the daily report.
4. Review reconciliation status.
5. Review failed outbox events, audit volume, idempotency records, and operational failures.
6. Record application version, migration head, and governance metadata.

## Incident priorities

- `FAIL` acceptance or reconciliation `ERROR`: stop affected financial operations and escalate to ledger/finance owners.
- Reconciliation `WARNING`: investigate and assign an owner; startup remains permitted only where the production policy allows warnings.
- Outbox failure: preserve event facts and use approved retry procedures. Never edit payloads.
- Retention cleanup failure: keep data, investigate capacity, and retry after approval.

## Evidence

Every operational review should retain request/correlation/trace IDs, application version, migration head, report timestamps, and the acceptance response. Do not modify ledger, audit, governance, or outbox facts to clear a report.
