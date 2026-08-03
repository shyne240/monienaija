# Deployment Guide

## Required inputs

Provide configuration through the approved environment/secret mechanism. Required values:

- `NODE_ENV` — `development`, `test`, `staging`, or `production`
- `APP_VERSION`
- `API_VERSION=v1`
- `PORT`
- `LOG_LEVEL`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL`
- `DB_SSL_REJECT_UNAUTHORIZED`
- `IDEMPOTENCY_RETENTION_SECONDS`
- `OUTBOX_RETRY_DELAY_SECONDS`
- `SHUTDOWN_DRAIN_TIMEOUT_SECONDS`

Never place credentials in the image, repository, command history, or logs.

## Deployment sequence

1. Build the lockfile-consistent application image or artifact.
2. Run dependency, secret, and vulnerability checks in the approved delivery process.
3. Provision PostgreSQL and confirm encrypted transport settings.
4. Apply migrations with `npm run migration:run` using a controlled database principal.
5. Confirm the migration head through `GET /api/v1/internal/readiness`.
6. Start the application with the immutable version in `APP_VERSION`.
7. Verify liveness, readiness, diagnostics, metrics, and reconciliation.
8. Run the manual production acceptance guide with synthetic or approved test data.
9. Release traffic only after accountable engineering, finance, risk, security, and operations approval.

M8 does not define cloud, Kubernetes, Terraform, CI/CD, or traffic-management configuration.

## Rollback

Do not roll back application code across an incompatible schema. Prefer forward-compatible application rollback. Revert a migration only under an approved recovery plan after confirming foreign-key, journal, audit, and outbox consequences.
