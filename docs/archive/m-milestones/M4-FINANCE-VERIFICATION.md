# M4 Finance Verification and Reconciliation Guide

This guide covers controlled verification of the wallet, ledger, and transfer domains. It does not move money through an external rail and must use synthetic local data only.

## Verification surfaces

The internal-only verification routes are prefixed with `/api/v1/internal/reconciliation`:

| Route                               | Purpose                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /report`                       | Independent reconciliation checks with `PASS`, `WARNING`, or `ERROR`.                      |
| `GET /trial-balance`                | Account-level debit, credit, and normal-balance totals.                                    |
| `GET /finance`                      | Trial balance, assets, liabilities, journal integrity, conservation, and account activity. |
| `GET /accounts/:accountId/activity` | Activity summary for one ledger account.                                                   |

These routes have no authentication in the current application because identity and access are outside this scope. They are not a production public API and must remain restricted by deployment/network controls until the appropriate trust boundary exists.

## Reconciliation procedure

1. Start PostgreSQL and apply all migrations:

   ```bash
   docker compose up -d postgres
   npm run migration:run
   npm run start:dev
   ```

2. Run the independent report:

   ```bash
   curl --fail-with-body -sS \
     http://localhost:3000/api/v1/internal/reconciliation/report | jq .
   ```

3. Confirm that the report contains checks for:
   - Ledger-derived wallet balances and negative balances
   - One compatible liability account per wallet
   - Balanced journals
   - Orphan ledger lines
   - Missing journal-line accounts
   - Completed transfers, deposits, and withdrawals without journals
   - Currency consistency
   - Accounting-unit consistency
   - Failed transfer attempts

4. Interpret statuses:
   - `PASS`: the check found no exception.
   - `WARNING`: the check completed and found an operational condition requiring review, such as failed transfer records.
   - `ERROR`: financial integrity cannot be proven or an exception was found. Treat this as a release blocker until investigated and cleared.

5. A normal clean synthetic environment should report `PASS`, unless failed transfer tests have intentionally created `FAILED` transfer records. Failed records are warnings, not successful money movement, but must be reviewed.

The reconciliation service reads PostgreSQL independently through SQL queries. It does not call wallet balance methods or the ledger posting service as its source of truth.

## Finance verification checklist

Run the finance report:

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/reconciliation/finance | jq .
```

Verify:

- Every trial-balance currency/accounting-unit dimension has equal total debits and credits.
- Every completed journal is balanced and has valid lines.
- Every wallet is linked to exactly one liability account with a credit normal balance.
- Customer wallet accounts are not allowed to become negative.
- Total assets and total liabilities are reported by currency and accounting unit.
- Balance-conservation dimensions show equal debit and credit totals.
- Account activity summaries contain expected debit, credit, signed balance, and first/last activity timestamps.
- Transfer records with `COMPLETED` status have a journal reference.
- Wallet transaction history agrees with the transfer records and journal references.

For an individual account:

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/reconciliation/accounts/<ACCOUNT_ID>/activity | jq .
```

Do not edit ledger rows or wallet rows to make a report pass. Corrections to a financial record must follow the existing compensating-entry model.

## Failure and recovery procedure

The automated failure suite is the first recovery check:

```bash
npm test -- --runInBand test/transfer.service.spec.ts
npm test -- --runInBand test/financial-invariants.spec.ts
npm test -- --runInBand test/reconciliation.service.spec.ts
```

The suite verifies that:

- An interrupted journal creation rolls back the transfer row, journal, journal lines, and balance changes together.
- Retrying after the simulated interruption can complete exactly once.
- An insufficient-funds attempt creates no journal and does not change balances.
- Duplicate idempotent requests do not create another transfer or journal.
- Concurrent spending attempts cannot overdraw the source account.

For a controlled database failure drill in a disposable environment:

1. Prepare two funded synthetic wallets.
2. Start one transfer and interrupt the database connection before commit using the approved test harness or database fault-injection tooling.
3. Restore PostgreSQL connectivity.
4. Retry the same idempotency key.
5. Verify that exactly one durable outcome exists.
6. Run the reconciliation report and confirm no orphan transfer, journal, or line exists.
7. Compare Wallet A and Wallet B balances with the trial balance and account activity report.

Do not perform an interruption drill against customer funds or an uncontrolled shared environment.

## Disaster-recovery verification process

For an approved synthetic backup/restore exercise:

1. Capture the current migration version and a baseline reconciliation report.
2. Create a database backup using the environment's approved backup process.
3. Restore the backup into an isolated PostgreSQL instance.
4. Start the application against the restored instance without schema synchronisation.
5. Verify migration state and run the reconciliation report.
6. Compare trial-balance dimensions, wallet-derived balances, journal counts, transfer counts, and account activity summaries with the baseline.
7. Exercise one idempotent retry and one read-only history query.
8. Record any mismatch as a recovery defect; do not repair financial rows manually.

A restore exercise is successful only when the restored ledger remains balanced, wallet balances remain ledger-derived, completed transfers still reference journals, and the reconciliation report is `PASS` apart from explicitly documented warnings.
