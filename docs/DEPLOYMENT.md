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

## Operational route access

`GET /api/v1/internal/readiness`, `/version`, `/deployment`, `/configuration`, `/diagnostics`, `/metrics`, `/audit`, and `/outbox` require an authenticated workforce bearer session whose configured role grants `internal:access`. The workforce role vocabulary is supplied through `A2_FINANCE_ROLES_JSON`; no built-in role grants `internal:access`, so a deployment must define an operations role that includes that scope before readiness and migration-head checks can be performed. The routes are never public and are never customer-reachable; until such a role exists they fail closed with `403` and must not be made public as a workaround.

### Provisioning an operations principal

The supported cold-start path is the break-glass bootstrap, followed by a role assignment. It is a
configuration-driven sequence: the platform grants no operational scope until an operator has
defined it on a role and assigned that role.

1. Enable the bootstrap channel (`A2_BOOTSTRAP_ENABLED=true`, `A2_BOOTSTRAP_ISSUER`,
   `A2_BOOTSTRAP_AUDIENCE`, `A2_BOOTSTRAP_ADMIN_SCOPES_JSON`, `A2_BOOTSTRAP_JWKS_JSON`) and define
   the operations role that carries `internal:access` in `A2_FINANCE_ROLES_JSON`. Bootstrap signing
   keys are supplied as public JWKs whose `environment` matches `NODE_ENV`.
2. Establish a workforce session for the bootstrap principal by exchanging a first-party OIDC
   assertion at `POST /api/v1/internal/a2/workforce/sessions`. That endpoint is assertion-gated, not
   bearer-gated: the signed assertion is the credential. Assertions with an untrusted signature, a
   wrong issuer/audience, an expired validity window, or no recent multi-factor authentication are
   rejected with `401`. Sessions issued by the removed development mock assertion path no longer
   exist.
3. Submit a bootstrap statement signed by a trusted bootstrap key at
   `POST /api/v1/internal/a2/workforce/bootstrap`. The statement must be canonical JSON, its
   `issuer:workforceSubject` must equal the authenticated session principal, its `environment`,
   `audience`, and `signingKeyReference` must match configuration, its `initialRoleKey` must be
   `FINANCE_ADMIN`, and its scopes must equal `A2_BOOTSTRAP_ADMIN_SCOPES_JSON` exactly. Each nonce is
   single-use and only one `FINANCE_ADMIN` bootstrap is accepted per environment, so treat it as a
   change-controlled, one-time operation.
4. Re-establish the bootstrap principal's session: roles and scopes are resolved when a session is
   issued, so a session created before the bootstrap carries no finance role.
5. Assign the operations role to the human operations principal through
   `POST /api/v1/internal/a2/workforce/roles`. The initial assignment of `FINANCE_PREPARER`,
   `FINANCE_CONTROLLER`, or `FINANCE_AUDITOR` is the documented bootstrap path; later assignments
   follow the configured maker-checker rules.
6. Have that principal establish its own session and confirm the operational reads return `200`.

`FINANCE_ADMIN` alone does not satisfy the operational routes: the founding administrator is
expected to receive `403` on them until an operations role that includes `internal:access` is
assigned, which keeps administrative capability and operational read access separable. Session
revocation takes effect immediately, and role removal is reflected at the next session issuance.

## Request validation

Every workforce administration route (`/api/v1/internal/a2/workforce/...`) is validated by the same
global `ValidationPipe` as the rest of the API (`transform`, `whitelist`, `forbidNonWhitelisted`). A
missing, empty, wrongly typed, oversized, or unknown property is rejected with `400` before any
session, role, bootstrap, or approval operation is attempted, and the rejected body is never echoed
back. The workforce session exchange is assertion-gated rather than bearer-gated: the signed
assertion is the credential, and an untrusted signature, a wrong issuer or audience, an expired
window, or an assertion without recent multi-factor authentication is rejected with `401`.

## Known operational limits

- **Shared state for horizontal scaling.** Security rate limiting (workforce and customer credential
  exchange) and the credential lockout counter are stored in PostgreSQL and are therefore shared by
  every instance. The partner circuit breaker and the OIDC unknown-key cooldown cache are
  per-process, so each instance keeps its own cooldown state. HORIZONTAL SCALING REQUIRES SHARED
  RATE-LIMIT/CIRCUIT-BREAKER STATE; do not scale out on the assumption that a single instance's
  in-memory state protects the deployment.
- **Beneficiary routes.** `GET`, `PATCH`, and `DELETE /api/v1/beneficiaries/:id` resolve the record
  from the path id alone, and the route registry contains no customer rule for `/beneficiaries`, so
  they currently fail closed for non-operational principals. Whether a customer should manage their
  own beneficiaries is DECISION REQUIRED; the route must not be made customer-reachable by widening
  the internal policy.
- **Governance metadata retention.** `governance_metadata` records one row per application startup
  and no retention or cleanup policy exists: RETENTION POLICY REQUIRED before a long-lived deployment
  accumulates unbounded startup history.

## Customer Mobile builds

`apps/customer-mobile` resolves the API base URL from `EXPO_PUBLIC_API_BASE_URL` (with `API_BASE_URL` as the fallback variable) at build time. Set it to the public HTTPS origin of the environment's API before building any non-local app; when the variable is absent the client refuses to send authenticated requests instead of falling back to a loopback address. Session material is stored with `expo-secure-store` and customer credentials are never persisted on the device.

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
