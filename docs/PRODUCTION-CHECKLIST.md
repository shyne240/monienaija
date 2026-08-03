# Production Checklist

## Configuration

- [ ] Production profile selected.
- [ ] `APP_VERSION` is immutable and traceable.
- [ ] `API_VERSION` is supported.
- [ ] Database credentials come from approved secret management.
- [ ] SSL and certificate verification are enabled as required.
- [ ] Idempotency, outbox, and shutdown durations are within approved ranges.

## Database

- [ ] Backup and restore evidence is current.
- [ ] All migrations are applied.
- [ ] Migration head matches the application compatibility check.
- [ ] Database user privileges are least-privilege.
- [ ] Connection limits and timeouts are reviewed.

## Financial correctness

- [ ] Reconciliation report is `PASS`.
- [ ] Trial balance is balanced by currency/accounting unit.
- [ ] Wallet balances match ledger-derived balances.
- [ ] Completed money movements have journals.
- [ ] No orphan journals, lines, transfers, deposits, or withdrawals exist.
- [ ] Failed operations and warnings have owners.

## Operational resilience

- [ ] Idempotency replay and changed-payload tests pass.
- [ ] Outbox pending/failed count is understood.
- [ ] Audit events are readable and immutable.
- [ ] Metrics endpoint responds.
- [ ] Diagnostics endpoint responds.
- [ ] Request, correlation, and trace headers are verified.
- [ ] Graceful SIGTERM/SIGINT drain has been exercised.
- [ ] Restart and timeout recovery have been exercised.

## Approval

- [ ] Engineering owner approved.
- [ ] Finance/ledger owner approved.
- [ ] Risk/compliance owner approved.
- [ ] Security owner approved.
- [ ] Operations/support owner approved.
- [ ] Rollback and incident contacts are available.
