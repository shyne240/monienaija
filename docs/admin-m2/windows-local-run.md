# M2 Admin Web — Windows local run (development only)

Use **only a disposable local database and dummy data**. These public test passwords, the local password login and fixture-only role grants are not production authentication, real OIDC/MFA, or production authorization policy. Keep real SMS, external providers, notification workers and expiry workers off. The Arena preview is stopped. A00, E05, E08 and E09 remain policy-blocked.

## Requirements and safety

Windows PowerShell, Git, Node.js 22, Docker Desktop with Compose, and free ports 5432, 3000 and 5173. A fresh checkout and new local PostgreSQL volume are recommended. Existing Docker volumes keep their old credentials and data; back up and inspect any existing `.env` or volume. **Never point this fixture at a shared, staging or production database**, even through a localhost tunnel. Docker publishes PostgreSQL; restrict it with your local firewall.

## Fresh installation

From PowerShell:

```powershell
git clone https://github.com/shyne240/monienaija.git
cd monienaija
git fetch origin arena/44f00580-monienaija
git switch --track origin/arena/44f00580-monienaija
npm ci
cd apps/admin-web
npm ci
cd ../..
# Refuses to overwrite an existing .env. Do not use --force on an existing setup.
node scripts/prepare-pg-test-env.js
docker compose up -d postgres
docker compose ps
# Wait for PostgreSQL to be healthy before continuing.
npm run migration:run
npm run build
$env:NODE_ENV = 'development'
$env:NOTIFICATION_WORKER_ENABLED = 'false'
$env:CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false'
# Only after confirming the database is disposable and local:
$env:LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database'
node scripts/local-dev-seed-11-roles.js
npm start
```

The generated ignored `.env` supplies the full five-role legacy configuration plus the database-backed 11-role catalogue, local DB `monienaija` / `monienaija-pw`, enabled workforce authentication and a placeholder issuer. Verify `DB_HOST=127.0.0.1`, `NODE_ENV=development`, `NOTIFICATION_WORKER_ENABLED=false`, `CASH_TO_CASH_EXPIRY_WORKER_ENABLED=false` and provider integrations disabled. Do not add production secrets. The seed refuses non-loopback DB hosts, production/staging, missing explicit confirmation or enabled workers; a loopback host alone cannot prove a database is safe. It uses the same issuer as the backend: do not change `A2_WORKFORCE_OIDC_ISSUER` between seeding and running the server.

Leave the backend running. In a second PowerShell terminal:

```powershell
cd path\to\monienaija\apps\admin-web
npm run dev
```

Open `http://localhost:5173`. Vite proxies same-origin `/api/v1` to the backend at port 3000. Use the test accounts below; no real messages or funds are involved.

## Updating an existing disposable Windows installation

Stop both app terminals. From the repository root:

```powershell
git switch arena/44f00580-monienaija
git pull --ff-only origin arena/44f00580-monienaija
npm ci
cd apps/admin-web
npm ci
cd ../..
docker compose up -d postgres
docker compose ps
# Wait for healthy; inspect existing .env and database before proceeding.
npm run migration:run
npm run build
$env:NODE_ENV = 'development'
$env:NOTIFICATION_WORKER_ENABLED = 'false'
$env:CASH_TO_CASH_EXPIRY_WORKER_ENABLED = 'false'
$env:LOCAL_DEV_SEED_CONFIRM = 'disposable-local-database'
node scripts/local-dev-seed-11-roles.js
npm start
```

Start Vite in the second terminal as above. Do **not** regenerate or overwrite an existing `.env` blindly: ensure its workforce configuration is enabled, includes all five legacy roles and has the same issuer in both processes. If uncertain, inspect the output and stop. Re-running the seed preserves existing passwords and valid assignments. If it reports a conflicting role, revoked/expired assignment, or an unknown existing password for an account without a current assignment, it rolls back and stops rather than replacing the account or overriding a deliberate restriction. Resolve that only after inspecting the disposable DB; do not delete real data. When a known default credential was seeded under a different issuer, the script adds its missing current-issuer assignment without deleting the older row.

## Development-only test accounts

For newly created accounts, the password is `MonieNaija_<ROLE>_123!`, using the exact uppercase role in this table. **Existing passwords are never reset**; the seed output says if a password was preserved. Do not reuse these public values outside a disposable local setup.

| Role | Email | New-account password |
|---|---|---|
| SUPER_ADMIN | `super-admin@monienaija.local` | `MonieNaija_SUPER_ADMIN_123!` |
| FINANCE_PREPARER | `finance-preparer@monienaija.local` | `MonieNaija_FINANCE_PREPARER_123!` |
| FINANCE_CONTROLLER | `finance-controller@monienaija.local` | `MonieNaija_FINANCE_CONTROLLER_123!` |
| FINANCE_AUDITOR | `finance-auditor@monienaija.local` | `MonieNaija_FINANCE_AUDITOR_123!` |
| ADMINISTRATOR | `administrator@monienaija.local` | `MonieNaija_ADMINISTRATOR_123!` |
| OPERATIONS | `operations@monienaija.local` | `MonieNaija_OPERATIONS_123!` |
| AGENT_NETWORK_MANAGER | `agent-network-manager@monienaija.local` | `MonieNaija_AGENT_NETWORK_MANAGER_123!` |
| COMPLIANCE | `compliance@monienaija.local` | `MonieNaija_COMPLIANCE_123!` |
| RISK_FRAUD | `risk-fraud@monienaija.local` | `MonieNaija_RISK_FRAUD_123!` |
| CUSTOMER_SERVICE | `customer-service@monienaija.local` | `MonieNaija_CUSTOMER_SERVICE_123!` |
| TREASURY | `treasury@monienaija.local` | `MonieNaija_TREASURY_123!` |

The prior guide created **`admin@monienaija.local` / `MonieNaijaAdmin123!`** as a separate SUPER_ADMIN identity, not an alias for `super-admin@…`. The new seed does not create it on fresh databases. If it already exists, its credential and valid assignment are preserved, and a missing current-issuer assignment is added only if its password matches the old default. Custom passwords are never reset; an unknown password plus missing assignment requires manual review. Use the new `super-admin@…` account for a fresh installation.

## Why the old setup failed

The previous Windows instructions ran the single-account seed, so a fresh database did not receive the eleven role-specific credentials. The older 11-role script also assumed a Unix manifest path and could fail finance-role creation when another principal already held that role. Password login derives its principal ID from the configured issuer and email, then resolves active, in-window assignments against the role catalogue. A credential can therefore verify successfully but receive “No valid workforce roles” if its assignment is missing, expired, disabled, or tied to a previous issuer. An issuer mismatch has been reproduced and repaired in the PostgreSQL integration test; without inspecting a particular Windows database, it is not possible to assert which condition caused that installation's error. The seeded role permissions still come from the existing runtime catalogue and legacy scopes, not a client-side bypass.

## Troubleshooting and shutdown

- “No valid workforce roles” means the password verified but no recognized, active, currently effective assignment was resolved for the current issuer-derived principal. Confirm the seed succeeded, backend and seed share the same `.env`/issuer/database, and the role is active. An incorrect password instead reports invalid credentials. Do not post passwords or database secrets in support logs.
- An empty database contains little business data; use dummy records. Role-specific accounts permit local role review but do not establish real IdP/MFA or production acceptance. See [owner checklist](owner-review-checklist.md).
- To stop, Ctrl+C in both terminals and run `docker compose stop postgres` from the root. This retains the volume. Do not run `docker compose down -v` unless intentionally deleting disposable local data.
- These commands were exercised with real PostgreSQL in automated tests, but were not executed on Windows in this sandbox.

## Verify which Admin Web your browser is serving

The current login should show the green identity panel and “Clarity for the work that matters” on desktop. Compare [actual current and baseline renders](design-verification-20261106.md#the-windows-login-question). This diagnostic does not modify your database. We have not observed your Windows instance, so an older server, checkout or cache is only a possibility.

From the repository root in PowerShell, first stop the old Vite terminal, then check:

```powershell
Get-Location
git status --short --branch
git rev-parse HEAD
git log -1 --oneline
Select-String -Path apps/admin-web/src/screens/unauthenticated/LoginScreen.tsx -Pattern 'Clarity for the work that matters'
Select-String -Path apps/admin-web/src/screens/unauthenticated/login.css -Pattern 'mn-login__identity'
cd apps/admin-web
npm ci
$env:ADMIN_WEB_API_BASE_URL = '/api/v1'
$env:ADMIN_WEB_DEV_AUTH_MOCK = 'false'
npm run build
# Vite dev uses /api/v1 and proxies it to the local backend, as described above.
npm run dev -- --port 5173 --strictPort
```

Open the exact URL printed by that terminal (`http://localhost:5173`); `--strictPort` prevents silently choosing a different port if another process already owns 5173. If it fails, inspect `Get-NetTCPConnection -LocalPort 5173 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess` and `Get-Process -Id <OwningProcess>` (replace the placeholder with the observed PID) before stopping the correct process. In a second PowerShell window, check that the **dev server** on that port serves the M2 CSS:

```powershell
(Invoke-WebRequest 'http://localhost:5173/src/screens/unauthenticated/login.css' -UseBasicParsing).Content | Select-String 'mn-login__identity'
```

The CSS check is for Vite dev mode, not a production bundle. A match is an identity clue, not proof the browser uses that process; compare the exact URL and use a hard reload or a private window. If the visual still differs, record the branch, commit, printed Vite URL, port-owner process and screenshot without passwords or secrets. Do not reset or reseed your existing database merely to diagnose styling. These steps are reproducible instructions, **not** a claim that Windows was tested in this sandbox.
