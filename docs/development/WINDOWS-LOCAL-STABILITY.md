# Stable Windows local development (PostgreSQL 16)

This procedure preserves an **existing** `C:\dev\monienaija` checkout and Docker PostgreSQL volume. It does not create or replace `.env`, passwords, PostgreSQL users, authentication rules or volumes. `.env.example` is documentation, not a replacement for an existing `.env`. Never commit environment files, credentials or backups. Review local Git hooks and dependency scripts; use `npm ci --ignore-scripts` below to avoid dependency lifecycle scripts. Network/package supply-chain and machine firewall protections remain your responsibility.

## Before every update

1. Use a PowerShell window with Node 22+, npm 10+, Git and Docker Desktop. Open `C:\dev\monienaija`; retain the existing `.env` and Docker volume untouched. Verify that this is a dedicated **synthetic-only local** database, not a port-forward, VPN tunnel, replica, shared service or production database. A loopback hostname alone cannot prove isolation. Do not use real provider credentials or production identities in development.
2. Inspect incoming migration changes and stop for review/approval **before applying migrations**. Pulling or installing dependencies does not itself run repository migrations; app startup and UI operations **can write data**. App bootstrap inserts missing catalogue/dashboard/product data and may normalize historical provider references. Thus starting the backend is not a read-only operation and must only target the independently verified database. The preflight is read-only; it does not prove isolation or schema compatibility.
3. Do not run `docker compose down -v`, `docker volume rm`, `docker compose up --force-recreate`, database reset/restore, authentication changes, seed/fund scripts, migration run/revert, or embedded PostgreSQL tooling as routine troubleshooting. Do not use `prepare-pg-test-env.js` on this checkout. Never change credentials to match a template. If an authentication check fails, stop and investigate privately with the environment owner; do not print or paste secrets.

## PowerShell: update and start

The commands below are for the operator to run on Windows, **not commands executed by this change**. Ensure the current branch has an upstream and no unrelated tracked changes. The migration check intentionally stops on *any* incoming migration change; the owner must review data impact and separately authorize any migration. A later application may require an approved migration; do not silently apply it.

```powershell
Set-Location 'C:\dev\monienaija'
git status --short
# Stop and resolve any unrelated tracked changes before proceeding.
git fetch
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; stop.' }
$migrations = @(git diff --name-only 'HEAD..@{u}' -- src/migrations)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect upstream; stop.' }
if ($migrations.Count -gt 0) { throw 'Incoming migrations require explicit review and approval; stop.' }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Pull failed; stop.' }
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency install failed; stop.' }
Push-Location apps/admin-web
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Admin dependency install failed; stop.' }
Pop-Location
```

`--ignore-scripts` avoids install-time lifecycle hooks; if a dependency truly needs an install script, review it separately rather than running arbitrary scripts automatically. Git hooks, local tooling and external package registries are outside this repository's control.

Ensure the **existing** Docker PostgreSQL container is running. This starts an existing stopped container without recreating it or changing its configured volume; if it does not exist, stop and ask the owner instead of provisioning or resetting one:

```powershell
docker ps -a --filter 'name=^/monienaija-postgres$' --format 'table {{.Names}}\t{{.Status}}'
docker start monienaija-postgres
if ($LASTEXITCODE -ne 0) { throw 'Existing PostgreSQL container not available; stop.' }
```

Set safety flags **only in this PowerShell process** after independently confirming isolation. They do not edit `.env` or change database credentials. The isolated-database confirmation is an attestation, not a technical proof. The emergency stop covers only its implemented policy paths, not every financial API. The safe launcher refuses non-loopback DB hosts, real SMS/email/partner configuration, enabled notification/expiry workers, and POA uploads; these conservative restrictions may block existing configurations rather than modifying them. Resolve any unsafe setting with its owner; do not assume disabling a worker disables all direct sends.

```powershell
$env:LOCAL_DB_CONFIRMED_ISOLATED = 'yes'
$env:A5_PILOT_EMERGENCY_STOP = 'true'
npm run local:preflight
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; stop without changing credentials.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed; stop.' }
npm run local:start:safe
```

Keep the backend window open. Its launcher repeats the read-only preflight then starts `dist/main.js` with the loopback-only Node network guard. It still performs normal application bootstrap and **can write** to the isolated local database. Do not start it against an unverified DB. In another PowerShell window, from the repo root, check the database and backend's public liveness endpoint, then start the Admin Console with an explicit local-only proxy. Set the same process-only attestation and emergency stop in that second window. The `npm run dev` Vite server listens on `0.0.0.0` and allows preview hosts in this repository: use only a trusted local network and restrict it with the OS firewall; do not expose it to the internet.

```powershell
Set-Location 'C:\dev\monienaija'
$env:LOCAL_DB_CONFIRMED_ISOLATED = 'yes'
$env:A5_PILOT_EMERGENCY_STOP = 'true'
npm run local:preflight -- --backend
if ($LASTEXITCODE -ne 0) { throw 'Backend health check failed; stop.' }
Set-Location apps/admin-web
$env:ADMIN_WEB_API_BASE_URL = '/api/v1'
$env:ADMIN_WEB_DEV_PROXY_TARGET = 'http://127.0.0.1:3000'
npm run dev
```

Open `http://localhost:5173` locally. Stop each process with Ctrl+C; stopping the backend does not delete the DB. Avoid mutation screens, sends, provider verification and financial operations unless specifically authorized for synthetic data. Never enter real customer data or live credentials.

## Preflight and test boundaries

- `npm run local:preflight` loads `.env` in memory only, with exported shell values taking precedence as in Nest/dotenv. It checks DB-required fields and the application environment schema, local/safety settings, then connects with the existing credentials using a read-only PostgreSQL session and `SELECT 1`; it has a timeout and sanitizes DB errors. `--backend` also requests only `http://127.0.0.1:<PORT>/api/v1/health`. It never runs a migration, creates data, changes configuration or prints secrets. PostgreSQL/server logs may record connection attempts.
- The guard on `local:start:safe` and standard root test scripts blocks non-loopback Node socket/DNS/fetch traffic; it is **not an OS firewall**, does not constrain native child processes, browsers, containers or a remote service tunneled to loopback, and does not stop local ledger writes. Existing DB-managed provider records can override environment provider selections. Do not rely on configuration flags or this guard as an absolute guarantee: use a separate local cluster, synthetic data, OS/container deny-egress controls and no production credentials/routes. Legacy `npm run start:dev`, direct `node`, direct Jest, browser code and ad-hoc scripts do not automatically inherit all safeguards; do not use them for unverified environments.
- Root `npm test` is the non-PG unit suite with the Node guard. `npm run test:pg` **creates, migrates and drops databases**, even though its names are scoped. It is not a read-only check and must never run on the working PostgreSQL cluster. Its global setup now requires `NODE_ENV=test`, an explicit loopback `DB_HOST`, and `PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes`. This attestation is not proof: obtain approval and use a **separately provisioned disposable local PostgreSQL cluster** with synthetic credentials, not a different database on the existing server. Direct custom runners, external tools and unguarded ad-hoc tests can bypass these controls.
- `scripts/prepare-pg-test-env.js` requires explicit `--create-if-missing` and atomically refuses any existing `.env`, including `--force`; it is intended only for a disposable checkout/CI. `scripts/embedded-pg.js` also requires `EMBEDDED_PG_CONFIRM_DISPOSABLE=yes` and refuses an existing data directory; it initializes and may remove its new test directory. Neither is part of normal Windows startup.
- All migration additions/edits, especially `DELETE`, `UPDATE`, `TRUNCATE`, `DROP` and backfills, require explicit review and owner approval before execution. This policy is not enforced by an automatic SQL classifier; even apparently additive migrations and application bootstrap may change data. Keep backups and a separately approved recovery plan; never automatically restore/reset data as a test fix.
