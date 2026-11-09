# M2 Admin Web — Windows local run (development only)

Use an isolated local database and dummy data only. This is **not** production authentication or acceptance verification. The local seeded administrator is a development-only credential and does not represent real OIDC/MFA or all maker/checker roles. Keep real SMS, notification workers and external providers off. A00, E05, E08 and E09 remain policy-blocked. The earlier Arena preview was stopped after a reported 404.

## Requirements

Windows PowerShell, Git, Node.js 22 (npm 10+), Docker Desktop with Compose, and an available local port 5432, 3000 and 5173. These commands use a fresh checkout and a new Docker PostgreSQL volume. If you already have `.env` or a `postgres-data` volume, back them up and review their contents; **do not overwrite them or connect to an existing shared/production database**. Compose volume names are project-prefixed; existing volumes preserve their original database credentials. The container port is published by Compose: restrict access to your machine/firewall and do not expose this setup publicly.

## Setup, from PowerShell

```powershell
git clone https://github.com/shyne240/monienaija.git
cd monienaija
git fetch origin arena/44f00580-monienaija
git switch --track origin/arena/44f00580-monienaija
npm ci
Set-Location apps/admin-web
npm ci
Set-Location ../..
# Refuses to overwrite an existing .env; do not use --force on an existing setup.
node scripts/prepare-pg-test-env.js
```

The generated ignored `.env` uses local placeholder workforce settings and `monienaija` / `monienaija-pw` for the local DB. Verify `NODE_ENV=development`, `NOTIFICATION_WORKER_ENABLED=false`, `CASH_TO_CASH_EXPIRY_WORKER_ENABLED=false`, and provider integrations disabled; do not insert production secrets. The generation script sets a working five-role test configuration; the older commented four-role block in `.env.example` is not sufficient. Local authentication is separate from the retired OIDC mock-token bypass: never enable `A2_WORKFORCE_DEV_MOCK_ENABLED`.

```powershell
docker compose up -d postgres
docker compose ps
# Wait until postgres is healthy before migrating.
npm run migration:run
npm run build
$env:NODE_ENV = 'development'
node scripts/local-dev-seed-admin.js
npm start
```

The seed is idempotent: an existing account's password is not replaced. Its defaults are `admin@monienaija.local` and `MonieNaijaAdmin123!` and must only be used in this disposable local environment. If migration or seed fails, stop and inspect the error and DB settings; do not point it at real data. `npm start` runs the actual backend on port 3000; leave this terminal open.

In a second PowerShell terminal:

```powershell
cd path\to\monienaija\apps\admin-web
npm run dev
```

Open `http://localhost:5173` on the Windows machine and sign in with the disposable local credential. Vite proxies same-origin `/api/v1` to the local backend at port 3000. An empty DB contains little business data; production-only integrations, notification delivery and the policy-blocked features will not become functional simply by starting locally. Seeded SUPER_ADMIN does not substitute for separate checker/operational principals. Mutations affect the local database: use synthetic records only.

To stop, press Ctrl+C in both terminals and run `docker compose stop postgres` from the repository root. Stopping retains the database volume. Do not run `docker compose down -v` unless you intentionally want to permanently delete that local data.

## Limits and troubleshooting

- These Windows instructions are derived from repository configuration; they were not executed on Windows in this sandbox.
- If 5432 is occupied, use an isolated PostgreSQL instance and matching `DB_*` values; Docker's first-start credentials do not update an existing volume. Do not use `--force` to overwrite an existing `.env`.
- An authentication failure can indicate disabled workforce settings, an existing seed with a different password, or an unmigrated/wrong database. See `docs/V1/V1-ADMIN-LOCAL-LOGIN-01.md`, but note its historical claims about a mock assertion bypass and universal SUPER_ADMIN coverage are outdated.
- Automated and synthetic evidence is listed in [acceptance-review.md](acceptance-review.md). Actual zoom, screen reader, independent role verification and full workflows are not established by the local login or screenshots.
