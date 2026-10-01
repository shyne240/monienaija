# Maintenance Guide

## Preview mode

Preview is read-only and reports candidate counts for metrics, audit, idempotency, and eligible outbox records.

## Execution mode

Execution runs one database transaction, enables the controlled audit-retention session setting, removes only records past policy cutoffs, and returns a cleanup report. It does not remove pending outbox events.

## Safety rules

- Review preview output before execution.
- Execute in an approved maintenance window.
- Preserve the returned report.
- Never pass arbitrary table or column names to cleanup services.
- Never manually update/delete audit or outbox facts.
- Run reconciliation and diagnostics after cleanup.
- If cleanup fails, leave data intact and investigate.
