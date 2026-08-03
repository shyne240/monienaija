# MonieNaija Backend Foundation

Production-oriented backend foundation for the future MonieNaija mobile-money platform. This milestone intentionally contains **only infrastructure**: application bootstrap, PostgreSQL connectivity, health checks, configuration validation, logging, error handling, testing, and delivery tooling. It contains no customer, authentication, wallet, transfer, ledger, or financial-product functionality.

## Architecture

- **NestJS 11** with the **Fastify** HTTP adapter and strict TypeScript.
- **PostgreSQL** connectivity through TypeORM, with schema synchronisation disabled and migrations configured.
- **Configuration** is read from `.env` and validated at startup. Missing/invalid required database configuration prevents the process from starting.
- **Pino** provides structured request logs. Authorization, cookie, and API-key headers are redacted.
- `/api/v1` is the global API prefix. A global validation pipe and a structured global exception filter are installed at bootstrap.
- Liveness is process-only; readiness verifies the PostgreSQL connection with `SELECT 1`.
- Nest shutdown hooks close application resources cleanly on termination signals.

## Prerequisites

- Node.js 22 or later
- npm 10 or later
- Docker Engine with Docker Compose v2 (for local PostgreSQL)

## Local setup

1. Create the local environment file:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   npm ci
   ```

3. Start PostgreSQL and wait for its health check:

   ```bash
   docker compose up -d postgres
   docker compose ps
   ```

4. Run pending migrations (the initial foundation has no business schema migrations):

   ```bash
   npm run migration:run
   ```

5. Start the API:

   ```bash
   npm run start:dev
   ```

The service binds to `0.0.0.0:3000` by default. Change `PORT` in `.env` when required.

## Environment configuration

Use `.env.example` as the complete local reference. These database values are required and are validated before Nest starts:

- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

`DB_PORT`, `PORT`, `NODE_ENV`, log level, and SSL controls have validated defaults. `DB_SSL` and `DB_SSL_REJECT_UNAUTHORIZED` must be the literal strings `true` or `false`. Never commit a real `.env` file or production credentials.

## Health endpoints

| Endpoint                   | Meaning                                                             | Expected response                          |
| -------------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `GET /api/v1/health`       | Liveness: the HTTP process is running. Does not query dependencies. | `200 { "status": "ok", "timestamp": "…" }` |
| `GET /api/v1/health/ready` | Readiness: PostgreSQL can be queried.                               | `200` when ready; `503` when unavailable.  |

## Quality commands

```bash
npm run lint
npm run format:check
npm test
npm run build
```

## Database migrations

TypeORM schema synchronisation is permanently disabled. Use migrations for every future schema change:

```bash
npm run migration:generate -- src/migrations/MeaningfulChange
npm run migration:run
npm run migration:revert
```

Review generated migrations, test upgrade and rollback behaviour on representative data, and never alter a migration that has been applied to a shared environment.

## Manual verification

With PostgreSQL and the application running:

```bash
curl -i http://localhost:3000/api/v1/health
curl -i http://localhost:3000/api/v1/health/ready
```

Both commands should return HTTP `200` and a JSON body with `status: "ok"`. To verify readiness handling, stop PostgreSQL (`docker compose stop postgres`) and repeat the readiness request; it should return HTTP `503`. Start PostgreSQL again with `docker compose start postgres`.

## Container image

A production-oriented `Dockerfile` is included. Build it after producing a lockfile-consistent dependency install:

```bash
docker build -t monienaija-backend:local .
```

Supply the required environment variables through your deployment platform or an approved secret manager. The image deliberately contains no `.env` file.
