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

## Registration and identity correction pass

- Individual registration now requires structured first and last names; middle name is optional, and display/legal names are derived. Business registration uses `businessName`. The workforce-only `/customers/:id/registration-profile` endpoint validates the type-aware payload while the legacy profile endpoints remain compatible.
- Identity records are saved independently, can coexist for one customer (including multiple documents of one type), and are corrected by their selected record ID. Duplicate type/normalized-number pairs return a conflict. Saved-document deletion remains unavailable.
- NIN/BVN issue and expiry dates are hidden, cleared, omitted from requests, and enforced as `NULL` by the service. Migration `1785753600092-AllowMultipleCustomerIdentityDocuments` removes the obsolete one-document-per-type index and clears existing inapplicable NIN/BVN dates; its down migration refuses to recreate the old index if duplicates exist.
- Profile save triggers a fresh directory query; the authenticated browser script checks the name in the directory before and after a full refresh.

The integration checks also confirm that identity submission does not promote KYC, activation remains blocked before phone verification, OTP verification leaves the customer DRAFT, and no wallet is created.

Verification performed for this correction pass:

- `npm run build` (backend) and `npx tsc --noEmit --incremental false` (backend): passed.
- `npm run ts:check`, `npm run build`, and `npm test -- --runInBand` in `apps/admin-web`: passed (16 suites, 103 tests).
- Focused backend unit tests: passed (15 tests across `customer.service.spec.ts` and `production-readiness.spec.ts`).
- Real-PostgreSQL Batch 2A integration and production-readiness/migration-sync tests: passed (2 suites, 5 tests); migration head is `1785753600092`.
- The browser E2E was attempted with a disposable `*_e2e` database after migrations, but no browser assertions ran: this Linux sandbox lacks `libnspr4.so`, required by the pinned Chromium runtime. Install the host Chromium runtime libraries as described above, then rerun `npm run test:e2e:batch-2a` to complete authenticated browser verification.
