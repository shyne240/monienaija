# M9 Production Maturity Manual Verification

## Setup

```bash
cp .env.example .env
npm ci
docker compose up -d postgres
npm run migration:run
npm run start:dev
```

## 1. Health dashboard and acceptance

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/health-dashboard | jq .

curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/acceptance | jq .
```

Verify the responses include system, database, migration, ledger, reconciliation, outbox, audit, metrics, application-version, API-version, and governance status.

## 2. Operational reports

```bash
for report in daily ledger wallets transfers deposits withdrawals reconciliation outbox audit; do
  curl --fail-with-body -sS \
    "http://localhost:3000/api/v1/internal/reports/${report}" | jq .
done
```

Reports must be read-only and must not change wallet balances or ledger rows.

## 3. Governance metadata

Start the application and query:

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/health-dashboard | jq '.governance'
```

Verify application version, migration head, configuration fingerprint, environment, API version, build timestamp, and startup timestamp. Restarting the application should append a new immutable startup record rather than modifying the previous record.

## 4. Retention maintenance

Preview first:

```bash
curl --fail-with-body -sS \
  http://localhost:3000/api/v1/internal/maintenance/preview | jq .
```

Verify four policies and candidate counts. Execute only in the disposable environment:

```bash
curl --fail-with-body -sS \
  -X POST http://localhost:3000/api/v1/internal/maintenance/execute | jq .
```

Run diagnostics and reconciliation after cleanup. Pending outbox events must remain.

## 5. Final acceptance

Run the complete automated suite and verify the final acceptance response is `PASS` or has an approved `WARNING`. `FAIL` blocks production launch.
