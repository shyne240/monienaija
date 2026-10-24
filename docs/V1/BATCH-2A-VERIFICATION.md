# Batch 2A verification (disposable data only)

The authenticated browser test is checked in at `scripts/batch-2a-customer-registration-e2e.cjs` and runs as `npm run test:e2e:batch-2a`. It starts a local Nest API and Vite UI, signs its own short-lived OIDC assertion against an in-process test JWKS, and overrides notification delivery with `TestNotificationProvider`.

The E2E test uses only generated synthetic customer information. OTPs, local administrator credentials, bearer tokens, and the temporary signing key stay in process memory; none are written to files or printed. The API logger is set to `silent` for the harness. Never run this test against a production or shared database.

## Prerequisites

- Node.js 22+ and npm 10+.
- A local PostgreSQL instance and a **disposable database whose name contains `e2e`**. The harness refuses other database names.
- On Windows, install Chromium for Playwright once with `npx playwright install chromium`. On Linux, the test uses the pinned `@sparticuz/chromium` development dependency and needs the host Chromium runtime libraries (`libnspr4` and `libnss3` on Debian/Ubuntu; install the equivalents for your distribution).

## PowerShell setup and run

Create a dedicated database, using an account with database-creation permission:

```powershell
psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE monienaija_batch2a_e2e;"
```

From the repository root, set connection variables for this disposable database. Use your own local PostgreSQL password; do not put it in source control:

```powershell
$env:DB_HOST = "127.0.0.1"
$env:DB_PORT = "5432"
$env:DB_NAME = "monienaija_batch2a_e2e"
$env:DB_USER = "postgres"
$env:DB_PASSWORD = "<your-local-PostgreSQL-password>"
$env:DB_SSL = "false"

npm ci
npm --prefix apps/admin-web ci
npm run migration:run
npm run build
npx playwright install chromium
npm run test:e2e:batch-2a
```

If PostgreSQL is already configured through `.env`, set the same values there instead of the PowerShell environment, and keep that file local and ignored. The database must already have the repository migrations applied before starting the browser harness; the harness checks startup readiness and does not run migrations itself.

The test starts the API on port 3000, the fake JWKS endpoint on 3001, and Vite on 5173. Stop any existing process using those ports first. It leaves synthetic test records in the dedicated database; for a clean rerun, stop the harness and drop/recreate **only** `monienaija_batch2a_e2e` before applying migrations again.

The supported API integration check, which also captures OTP only in memory and uses its own isolated PostgreSQL test database, is:

```powershell
$env:DB_ADMIN_NAME = "postgres"
$env:PG_TEST_CONCURRENCY = "1"
npm run test:pg -- test/batch-2a-customer-registration.integration.spec.ts
```
