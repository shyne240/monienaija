# Disaster Recovery Guide

## Scope

This guide covers application and PostgreSQL recovery verification. It does not prescribe a cloud provider, backup vendor, region topology, or deployment orchestrator.

## Backup and restore drill

1. Record the current application version, migration head, reconciliation report, trial balance, journal count, and outbox count.
2. Create a synthetic database backup through the approved database process.
3. Restore it into an isolated PostgreSQL instance.
4. Apply no destructive changes to the source database.
5. Start the exact application version against the restored database.
6. Verify `/api/v1/internal/readiness` and `/api/v1/internal/diagnostics`.
7. Compare reconciliation status, balances, trial-balance dimensions, audit records, outbox records, and metrics.
8. Retry one idempotent command and verify replay rather than duplicate execution.
9. Record RTO/RPO results and every mismatch.

## Failure handling

If readiness reports a schema mismatch, do not start serving traffic. If reconciliation reports `ERROR`, stop financial operations and preserve evidence. Do not edit ledger, audit, idempotency, or outbox facts to make recovery pass.

## Recovery acceptance

Recovery is accepted only when:

- The migration head is compatible.
- Ledger and reconciliation checks pass.
- Wallet balances remain ledger-derived.
- Completed money movements remain journal-backed.
- Audit events remain immutable.
- Idempotency replay remains deterministic.
- Outbox facts remain available for controlled retry.
