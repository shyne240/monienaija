# V1-RELEASE-01 — Production & Deployment Readiness Audit

**Scope:** whole-repo audit of MonieNaija V1's real deployability into a fresh production
environment. Not a feature review, not an architecture redesign, not "tests pass therefore
ready." Every claim below is backed by a command that was actually run, a file that was
actually read, or a test that actually executed in this sandbox — nothing here is inferred
from documentation alone without independent verification. Where documentation and code
disagreed, the code's actual behaviour is reported, and the mismatch is called out explicitly.

Each major item below is tagged with exactly one of: **VERIFIED**, **CONFIGURED BUT
UNTESTED**, **MISSING**, **REQUIRES REAL INFRASTRUCTURE**, **BLOCKED**, **NOT APPLICABLE**.

---

## 1. Starting HEAD

`62e88ce0af8278be02f121752e485de32e67f853` — `docs(V1): add V1-HARDEN-01 support
authentication security audit` (tip of `arena/01a10374-monienaija` at the start of this
audit; confirmed matching local and remote `origin/arena/01a10374-monienaija` before any
work in this audit began).

## 2. Final HEAD

`a33ddd7958eb3b06f6bfe3cabfb5d55e6c3f89a4` — `release: harden production deployment
readiness` (third of three code commits produced by this audit; local and remote
`origin/arena/01a10374-monienaija` confirmed matching after each push). This audit document
itself lands in a fourth, docs-only commit on top of this HEAD.

Code commits produced by this audit (all `release: harden production deployment readiness`,
pushed individually, verified clean-tree/matching-remote before and after each one per the
task's strict git rules):

| Commit | Files | Summary |
|---|---|---|
| `f25b8bd` | 10 files | Admin-web dev-mock-auth bypass hardening (completed earlier, see below); Customer/Agent Mobile `EXPO_PUBLIC_API_URL` wiring; workforce OIDC/session sandbox-bypass narrowing (the P0 finding, §8); migration-sync regression test |
| `d62bf1e` | 3 files | Production SMS-provider fail-fast (§9, §20); `.env.example` completeness |
| `a33ddd7` | 2 files | `DEPLOYMENT.md`/`PRODUCTION-CHECKLIST.md` updated to match the new SMS fail-fast requirement |

## 3. Environment variable inventory

Full inventory of every environment variable actually read by the backend
(`src/config/environment.ts`, the single zod schema that gates `NestFactory.create`), plus
the two frontend apps. Tag legend: **REQUIRED** (no safe default, startup fails without it),
**SAFE-DEFAULT** (has a default fine for production), **DEV-ONLY** (must not matter in
production and is proven not to), **PRODUCTION-REQUIRED** (only required once
`NODE_ENV=production`), **SECRET** (credential material), **PUBLIC-MOBILE-CONFIG** (baked
into a mobile bundle, not a secret).

### Backend — core
| Variable | Tag | Notes |
|---|---|---|
| `NODE_ENV` | REQUIRED (has default `development`, but production must set it explicitly) | `development`\|`test`\|`staging`\|`production` |
| `APP_VERSION`, `API_VERSION`, `PORT`, `LOG_LEVEL` | SAFE-DEFAULT | |
| `IDEMPOTENCY_RETENTION_SECONDS`, `OUTBOX_RETRY_DELAY_SECONDS`, `METRICS_RETENTION_SECONDS`, `AUDIT_RETENTION_SECONDS`, `OUTBOX_RETENTION_SECONDS`, `SHUTDOWN_DRAIN_TIMEOUT_SECONDS`, `BUILD_TIMESTAMP`, `CASH_TO_CASH_EXPIRY_SECONDS` | SAFE-DEFAULT | |
| `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | REQUIRED, `DB_PASSWORD` SECRET | No default; zod rejects empty |
| `DB_PORT`, `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED` | SAFE-DEFAULT | `DB_SSL` defaults `false` — see §4 |
| `COMMERCIAL_ACCOUNTING_ENABLED`/`_VAT_TREATMENT`/`_COMMISSION_ACCOUNTING_TREATMENT`/`_COMMISSION_RECOGNITION_TIMING` | SAFE-DEFAULT (all optional; feature inert if absent) | Was **missing from `.env.example`** — fixed this audit |

### Backend — A2 workforce/OIDC (production-required only when `A2_WORKFORCE_ENABLED=true`)
| Variable | Tag | Notes |
|---|---|---|
| `A2_WORKFORCE_ENABLED`, `A2_BOOTSTRAP_ENABLED` | SAFE-DEFAULT (`false`) | Fail-closed when disabled |
| `A2_WORKFORCE_OIDC_ISSUER/_JWKS_URI/_AUDIENCE/_CLIENT_ID`, `A2_WORKFORCE_INTERNAL_AUDIENCE`, `A2_WORKFORCE_SESSION_TTL_SECONDS` | REQUIRED when enabled | Validated by `workforceConfiguration()` (separate, stricter parser — see §8) |
| `A2_BOOTSTRAP_ISSUER/_AUDIENCE/_JWKS_JSON/_ADMIN_SCOPES_JSON` | REQUIRED when bootstrap enabled | `A2_BOOTSTRAP_JWKS_JSON` SECRET-adjacent (public JWKs only, but gates break-glass identity — verified empirically: app refuses to boot with an empty JWKS array when bootstrap is enabled) |
| `A2_FINANCE_ROLES_JSON` | REQUIRED when enabled | Verified empirically: app refuses to boot with fewer than 4 roles |
| `A2_MAKER_CHECKER_RULES_JSON` | REQUIRED when enabled | Verified empirically: app refuses to boot with fewer than 3 rules |
| `A2_WORKFORCE_RATE_LIMITS_JSON`, `A2_TRUSTED_PROXY_ADDRESSES_JSON` | REQUIRED when enabled | |

### Backend — A6 external bank partner (NIBSS; out of V1 scope per task, inventoried for completeness only)
`A6_PARTNER_*` (15 variables) — all SAFE-DEFAULT/inert while `A6_PARTNER_ENABLED=false`
(the shipped default). Credential-reference variables are SECRET placeholders only (no
secret material belongs directly in env per `environment.ts` design — references only).

### Backend — SMS/OTP (SMS-V1-01)
| Variable | Tag | Notes |
|---|---|---|
| `NOTIFICATION_SMS_PROVIDER` | **PRODUCTION-REQUIRED** (must be `robase`) | **Was a dangerous default — fixed this audit, see §9/§20.** Default `console` logs live OTP codes to stdout and delivers nothing |
| `ROBASE_API_KEY` | SECRET, REQUIRED when provider=robase | Must start with `robe_`; validated fail-fast |
| `ROBASE_API_BASE_URL`, `ROBASE_REQUEST_TIMEOUT_MS` | SAFE-DEFAULT | |
| `NOTIFICATION_WORKER_ENABLED/_POLL_INTERVAL_MS/_BATCH_SIZE`, `SMS_RETRY_MAX_ATTEMPTS/_BASE_DELAY_SECONDS` | SAFE-DEFAULT | All were **missing from `.env.example`** — fixed this audit |

### Backend — read outside the central schema (self-contained, bounded)
| Variable | Tag | Notes |
|---|---|---|
| `LIMIT_RESERVATION_STALE_THRESHOLD_MINUTES` | OPTIONAL/SAFE-DEFAULT | Read directly in `limit-catalog/limit-diagnostics.service.ts`, not via the zod schema. Re-examined this audit: has its own bounded parse (`Number.parseInt` + `Number.isSafeInteger` + `>=1` check) that falls back to a safe default of 30 on anything invalid — diagnostic-only (read-only SELECTs, never mutates reservations). **Not a validation gap**; previously flagged as one in an earlier pass of this audit, downgraded after closer inspection. |

### `apps/admin-web` (build-time, Vite `define`)
| Variable | Tag | Notes |
|---|---|---|
| `ADMIN_WEB_API_BASE_URL` | PUBLIC-MOBILE-CONFIG equivalent (public, baked at build time) | **Fixed this audit** — previously hardcoded `http://localhost:3000/api/v1` unconditionally; now env-overridable, falling back to same-origin `/api/v1` in production builds |
| `NODE_ENV` (Vite-set) | DEV-ONLY gate | Drives `DEV_AUTH_MOCK`; proven dead-code-eliminated from production bundles (see §8) |

### `apps/customer-mobile`, `apps/agent-mobile` (Expo build-time inlining)
| Variable | Tag | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | PUBLIC-MOBILE-CONFIG | **Fixed this audit** — previously no environment switching existed at all (hardcoded `http://10.0.2.2:3000` literal, `setBaseUrl()` dead code); now read at build time with the original literal as dev fallback |

## 4. Secrets audit

No real secret value is reproduced anywhere in this document or in any committed file.

- **DB credentials**: `DB_PASSWORD` required, non-empty, never defaulted; not logged (not
  in the pino redact list because it's never in a request body/header — it only ever
  reaches the TypeORM connection string, which is never logged). **VERIFIED**.
- **JWT/session material**: the workforce/OIDC plane uses real externally-issued OIDC
  JWTs verified against a configured JWKS (`A2_WORKFORCE_OIDC_JWKS_URI`) — no
  backend-held signing secret for that plane. Customer/Agent/Support sessions are
  opaque, server-generated, hashed-at-rest tokens (confirmed via migration DDL,
  e.g. `support_workforce_sessions.token_hash CHAR(64)` with a `CHECK` constraint
  enforcing a 64-hex-char SHA-256-shaped value, never the raw token). **VERIFIED**.
- **OTP**: generated with `randomInt` (CSPRNG-backed `node:crypto`), stored as a salted
  hash (`code_salt`/`code_hash` columns in `customer_registration_phone_challenges`),
  never stored or logged in plaintext by the backend's structured logger (pino redact
  list includes `req.body.otp`, `req.body.code`, `req.body.codeHash`). **One exception
  found and documented, not a redaction-list gap**: the `console` SMS provider's raw
  `console.log` call bypasses the structured logger entirely and does log the OTP
  in plaintext — see §9/§20, now blocked from production by a fail-fast config check.
- **Encryption at rest**: no application-level column encryption was found or claimed;
  relies on PostgreSQL storage encryption which is an infrastructure-layer control
  (**REQUIRES REAL INFRASTRUCTURE** to confirm for any specific hosting target).
- **API credentials** (`ROBASE_API_KEY`, A6 partner references): validated non-empty/
  correctly-shaped before use, held only in process env, never logged (confirmed via
  `RobaseNotificationProvider`'s own doc comment and by reading its `send()` method —
  the key appears only in the `Authorization` header, which pino redacts).
- **Support credentials**: one-time CSPRNG temp passwords, never persisted in plaintext,
  never logged (traced in full in the prior V1-HARDEN-01 audit; re-confirmed this audit
  via a live, successful `POST /internal/admin/support/workforce-users` →
  `POST /internal/support/workforce-sessions` round trip against a freshly migrated
  database, §18).

**Tag: VERIFIED** for everything above except encryption-at-rest, which is **REQUIRES REAL
INFRASTRUCTURE**.

## 5. Database readiness

- **PostgreSQL version**: tested live against embedded PostgreSQL **18.4** this session
  (all 1,681 PG-integration tests pass, full migration chain applies cleanly). The
  project's own `docker-compose.yml` pins `postgres:16-alpine` for local dev. Both
  versions were exercised at some point in this audit; no version-specific SQL feature
  was found that would behave differently between 16 and 18. **VERIFIED** for the schema
  working correctly on both 16 and 18-class PostgreSQL; no claim is made about any other
  version.
- **Pooling/timeouts/retries**: `src/config/database.config.ts` sets no explicit
  `poolSize`/`max`/`connectTimeoutMS`. This means the `pg` driver's own default pool
  (10 connections) and `@nestjs/typeorm`'s own default connection-retry behaviour
  (`retryAttempts: 10`, `retryDelay: 3000ms` — reasonable resilience against a DB
  container that isn't ready yet at orchestrated startup) apply unmodified. Not a
  dangerous default, but **not explicitly tuned for production load** — **CONFIGURED BUT
  UNTESTED** at any specific target throughput; recommend explicit tuning once real
  traffic shape is known. Not a blocker.
- **SSL**: `DB_SSL` defaults `false`; must be explicitly set `true` (with
  `DB_SSL_REJECT_UNAUTHORIZED=true`, also the default) for any real hosted PostgreSQL
  requiring TLS. **CONFIGURED BUT UNTESTED** against a real TLS-terminating PostgreSQL
  endpoint in this sandbox (only tested against a local, unencrypted embedded instance).
- **Fresh-DB and upgrade behaviour**: directly tested this audit, twice — once mid-audit
  and once again at final HEAD against a genuinely empty database (`DROP`+`CREATE
  DATABASE`, then `npm run migration:run`): all 82 migrations applied cleanly end to end
  with zero manual intervention (§18). **VERIFIED**.

## 6. Migration readiness

- **Authoritative count**: `82` files in `src/migrations/*.ts` (confirmed via `ls` against
  the actual repo at final HEAD, not copied from any prior document). Latest:
  `1785753600081-CreateSupportWorkforceAuthentication.ts`.
- **Ordering/idempotency**: `test/migration-chain.integration.spec.ts` runs the complete
  chain against a genuinely empty, dedicated PostgreSQL database per test run and
  passed. The migration count assertion is derived from the filesystem
  (`readdirSync`), not hardcoded, specifically to avoid the exact class of defect found
  and fixed in this audit (see next bullet). **VERIFIED**.
- **P0 defect found and fixed this audit**: `src/production/production-readiness.service.ts`
  hardcodes the expected latest-migration timestamp/name
  (`EXPECTED_MIGRATION_TIMESTAMP`/`EXPECTED_MIGRATION_NAME`) and refuses to report the
  application ready (`schema_incompatible`) if the database's actual latest-applied
  migration doesn't match. This constant had **drifted twice already** during normal
  feature work (stuck at migration `…079` while `…080` and `…081` were added), which
  would have made a freshly, fully migrated **production** database fail to start —
  directly breaking `docs/deployment/DEPLOYMENT.md`'s own documented step 5
  ("Confirm the migration head through `GET /api/v1/internal/readiness`"). This was
  **not hypothetical**: a live process was observed actually failing this check before
  the fix was applied (see Current-State evidence from the prior session). The constant
  has been corrected and a brand-new regression test added this audit,
  `test/v1-release-01-production-readiness-migration-sync.integration.spec.ts`, which
  runs the real migration chain and then asks the real `ProductionReadinessService`
  (wired through the real `AppModule`) whether it is compatible — closing the exact gap
  that let this regress twice before (the pre-existing `test/production-readiness.spec.ts`
  only exercises a mocked `DataSource`, so it structurally cannot catch the constant
  falling behind the real migration chain). The new test was verified to actually catch
  the regression (deliberately reverted the constant, confirmed the test fails with the
  exact same `schema_incompatible` error a real deployment would hit, then restored it
  and confirmed green). **VERIFIED, FIXED, regression-tested**.
- **Destructive changes / missing constraints**: no destructive migration (`DROP COLUMN`,
  `DROP TABLE`, unconditional data rewrite) was found in a review of the full migration
  list; migrations consistently add `CHECK` constraints, unique partial indexes, and
  foreign keys with explicit `ON DELETE` semantics (spot-checked several, including the
  two most recent). **VERIFIED** by sampling; a line-by-line review of all 82 files was
  not performed (**CONFIGURED BUT UNTESTED** for full exhaustive coverage).
- **Rollback**: `DEPLOYMENT.md` explicitly states "Do not roll back application code
  across an incompatible schema… revert a migration only under an approved recovery
  plan." No automatic down-migration tooling beyond TypeORM's own `migration:revert` is
  provided. **NOT APPLICABLE as a blocker** — this is a documented, deliberate
  forward-only operational policy, not a gap.

## 7. Startup/bootstrap readiness

- **Fail-fast**: `validateEnvironment()` runs before `NestFactory.create` in `main.ts`;
  any schema violation throws before the app ever listens. Separately,
  `workforceConfiguration()` (used by `AuthorizationModule`) performs its own, stricter
  validation when `A2_WORKFORCE_ENABLED=true`, and was observed this audit to correctly
  refuse to start the app for: an empty bootstrap JWKS, fewer than 4 finance roles,
  fewer than 3 maker-checker rules (all reproduced live against the compiled artifact,
  not inferred from source reading). **VERIFIED**.
- **Readiness ordering**: `ProductionReadinessService.getReadiness()` checks database
  connectivity → migration compatibility → reconciliation → pending outbox, in that
  order, short-circuiting on earlier failures. **VERIFIED** live (`GET
  /api/v1/health/ready` against a freshly migrated database returned `status: ok`,
  `migrations.appliedCount: 82`, `reconciliation.status: PASS`, `pendingOutbox: 0`).
- **Bootstrap determinism / first-Support-operator provisioning path**: fully traced in a
  prior session and re-confirmed working end-to-end this audit against a brand-new
  database (§18): OIDC bootstrap ceremony (per
  `docs/deployment/V1-WORKFORCE-BOOTSTRAP-RUNBOOK-01.md`) establishes the first
  FINANCE_ADMIN/PRIVILEGED workforce session → that session calls `POST
  /internal/admin/support/workforce-users` (gated to OPERATOR/SERVICE/PRIVILEGED only)
  to provision a SUPPORT user with a one-time CSPRNG temp password → the SUPPORT user
  logs in via the unauthenticated `POST /internal/support/workforce-sessions`. SUPPORT
  cannot self-provision or provision other SUPPORT identities (enforced at the
  controller layer). No manual SQL is required anywhere in the chain. **VERIFIED**.

## 8. Auth/session configuration across all actor types — including the P0 finding

- **Customer / Agent authentication**: password + PIN + OTP with lockout/failed-attempt
  tracking (`failedAttempts`-pattern code found in both
  `customer-authentication.service.ts` and `agent-authentication.service.ts`); sessions
  are opaque, hashed-at-rest tokens. **VERIFIED** via the full passing PG-integration
  suite (`a24-customer-transaction-pin-hardening`, `v1-agent-05-transaction-pin-security`,
  `a14-otp-hardening`, and others).
- **Support authentication**: fully re-verified this audit via a real, end-to-end call
  chain against a freshly migrated database (§18). **VERIFIED**.
- **Workforce/OIDC (A2) authentication — CRITICAL P0 FOUND AND FIXED THIS AUDIT.**
  `src/authorization/workforce-oidc.service.ts` contained a hardcoded sandbox bypass: if
  `idToken` started with the literal string `"mock-sandbox-token-"` **and**
  `NODE_ENV !== 'production'`, the service returned a fully forged, trusted
  `A2WorkforceAssertionEvidenceV1` with `assuranceLevel: 'MFA'` — zero signature
  verification, zero real IdP contact. A companion bypass in
  `src/authorization/workforce-session.service.ts`'s `resolve()` granted **all** enabled
  finance roles/scopes to any principal ID containing `"mock-sandbox-subject"`, under
  the same gate.

  This was pre-existing, intentionally documented "DEV/TEST ONLY" behaviour (see the
  original wording in `docs/deployment/config/v1-workforce-bootstrap.env.template`),
  which claimed the bypass was "dead code in production" because "the production Docker
  image pins `NODE_ENV=production`." **This audit found that claim too narrow to be
  safe**: `NODE_ENV` is a plain runtime variable, not stripped from the compiled `dist/`;
  `staging` is a first-class value in the app's own `environmentSchema`; the project's
  own docs reference a real internet-facing staging hostname
  (`staging-api.monienaija.ng`). An operator overriding `NODE_ENV=staging` on the exact
  same production image for a staging/UAT tier — a routine "build once, configure per
  environment" practice — fully reactivates the bypass there, with no separate opt-in
  flag to notice or audit.

  **Proven exploitable end-to-end, not theoretical.** A PoC server was started with
  `NODE_ENV=staging`, `A2_WORKFORCE_ENABLED=true`, and a complete, otherwise-valid
  production-shaped workforce configuration. A request with **zero real credentials** —
  `POST /api/v1/internal/a2/workforce/sessions` with body
  `{"idToken":"mock-sandbox-token-FINANCE_ADMIN"}` — returned HTTP 201 with a real,
  persisted, `PRIVILEGED` session carrying all 4 finance roles and
  `privileged:execute`/`privileged:approve` scopes. That forged token was then used to
  call `POST /internal/admin/support/workforce-users` and **successfully provisioned a
  real SUPPORT workforce user** in the database.

  **Fixed this audit**: the gate in both files was narrowed from `NODE_ENV !==
  'production'` to an explicit `NODE_ENV === 'development' || NODE_ENV === 'test'`
  allowlist. **Re-verified after the fix, against the final committed code**: the exact
  same exploit request under `NODE_ENV=staging` now receives `401 Unauthorized`
  ("Malformed compact JWS" — it correctly falls through to real JWT parsing and fails,
  exactly as a real OIDC-protected endpoint should). The same request under
  `NODE_ENV=development` still succeeds (preserving the intended local-developer
  convenience), and under true `NODE_ENV=production` against a freshly migrated
  database it is also correctly rejected (§18). The companion
  `workforce-session.service.ts` gate was updated identically for defense-in-depth
  consistency. Zero tests in the repository relied on `mock-sandbox` (`grep` confirmed
  zero matches in `test/`), and Jest defaults `NODE_ENV=test` automatically, so the fix
  does not affect the test suite (confirmed: all 1,806 unit tests and 1,681
  PG-integration tests still pass after the fix).

  **This is the single most important finding of this audit.** Tag: **BLOCKED → FIXED,
  VERIFIED**.
- **Admin-web dev-mock-auth bypass** (completed in an earlier session of this same audit,
  carried forward here for completeness): `apps/admin-web`'s `DEV_AUTH_MOCK` was
  hardcoded `true` unconditionally (would have shipped a client-side fabricated
  privileged session fallback in a real production build) and its `API_BASE_URL` was
  hardcoded to a `localhost` literal. Both fixed; the fix was verified against the
  actual production Vite build artifact (not just source review) — grepping the built
  bundle confirmed **zero** occurrences of `localhost:3000`, `mock-workforce-token`, or
  `"Sandbox Development Mode"`, with the production messaging and relative `/api/v1`
  default present instead. **VERIFIED, FIXED**.

## 9. OTP/SMS readiness

- A real, documented, provider-neutral SMS abstraction exists
  (`src/notification/notification.module.ts`) with two implementations: `console`
  (dev-only, logs to stdout, delivers nothing) and `robase`
  (`src/notification/robase-notification-provider.ts`, implementing a verified,
  documented third-party contract: `POST {base}/v1/sms/send`, Bearer `robe_*` auth,
  idempotency-key support, stable error-code consumption). Selecting `robase` requires a
  `ROBASE_API_KEY` matching the `robe_` prefix, validated fail-fast.
- **Dangerous default found and fixed this audit**: `NOTIFICATION_SMS_PROVIDER` defaulted
  to `console` with no guardrail, and `.env.example` didn't even mention the variable.
  The `console` provider's `send()` method logs the **entire message — including the
  live OTP code** (confirmed by reading `customer-registration.service.ts`'s
  `deliverOtpSms()`, which embeds the code directly in the SMS body) via plain
  `console.log`, bypassing the pino structured logger's redaction entirely. A production
  deployment that didn't know to set this variable would: (a) accept customer
  registrations, (b) never actually deliver a single real SMS, silently breaking the
  core OTP-gated registration/login flow for every real customer with no error
  anywhere, and (c) leak every OTP code to server stdout/log aggregation in plaintext.
  **Fixed**: `environment.ts` now fails configuration validation if
  `NODE_ENV === 'production'` and `NOTIFICATION_SMS_PROVIDER !== 'robase'`. Three new
  regression tests added and passing; `.env.example` and both deployment docs updated.
  See §20 for the full dangerous-defaults writeup.
- Whether a **live Robase account** actually delivers SMS to a real Nigerian handset was
  **not and cannot be verified from this sandbox** — no live `ROBASE_API_KEY` was
  available, and the task forbids real SMS/real-money claims. Tag: **REQUIRES REAL
  INFRASTRUCTURE** for end-to-end delivery confirmation. The adapter code itself, its
  contract conformance, and the new fail-fast guard are **VERIFIED**.

## 10. HTTP/network security

- **`/internal/*` protection**: fail-closed by design. `RuntimeAccessGuard` is registered
  as the single global `APP_GUARD`; the route-policy registry
  (`src/authorization/route-policy-registry.ts`) has a catch-all fallthrough that denies
  by default. Live-tested: `GET /api/v1/internal/readiness` and `GET
  /api/v1/internal/configuration` both correctly return `401` with no credentials;
  `GET /api/v1/internal/version` is intentionally public (documented, low-sensitivity).
  **VERIFIED**. Whether a real reverse proxy additionally restricts network-level access
  to `/internal/*` (defense in depth, not relied upon by the app) is a deployment-topology
  decision — **REQUIRES REAL INFRASTRUCTURE** to confirm for any specific target, but the
  application does not depend on it being present.
- **CORS**: entirely unconfigured in the backend (`grep` across all of `src/` for
  `cors`/`enableCors`/`CORS` returned zero matches). This fails safe (browsers will
  block cross-origin calls by default) but is a **functional gap**, not a vulnerability,
  for any deployment where `apps/admin-web` is served from a different origin than the
  API. **Tag: MISSING** (recommendation, not a fix applied — out of this audit's
  "genuine blocker" bar since it fails safe rather than open; flagged for the
  implementation team).
- **TLS termination**: the application itself does not terminate TLS; this is expected
  to be handled by a reverse proxy/load balancer in any real deployment, consistent with
  `DEPLOYMENT.md`. **REQUIRES REAL INFRASTRUCTURE** to confirm for any specific target.

## 11. Error/logging leak audit

- Pino `redact` configuration (`src/app.module.ts`) covers
  `req.headers.authorization/cookie/x-api-key`, `res.headers.set-cookie`, and 20+
  `req.body.*` fields including `password`, `pin`, `otp`, every `*Hash` variant,
  `token`/`accessToken`/`refreshToken`, `secret`, `code`, `transferCode`. A second,
  independent redaction layer (`src/common/sensitive-data-redaction.ts`,
  `redactSensitiveText`/`redactSensitiveData`) is applied inside
  `GlobalExceptionFilter` to error messages before they are logged or returned to the
  client.
- `GlobalExceptionFilter` returns a generic `"Internal server error"` for any `5xx`,
  never a stack trace or exception message, to the HTTP client; `4xx` messages pass
  through but are redacted first. Live-confirmed this session (and in a prior session):
  the `Authorization` header is rendered as `"[REDACTED]"` in actual request logs.
  **VERIFIED, no gap**.
- **One real leak found and fixed this audit** (§9/§20): the `console` SMS provider's
  raw `console.log` bypasses both redaction layers and logs live OTP codes in plaintext.
  Closed by making `console` unreachable in `NODE_ENV=production` (§9).
- No response-body logging is configured (pino-http default: headers/status only), so no
  endpoint response payload (which could contain PII) is written to logs by the
  framework. **VERIFIED**.

## 12. Health/readiness endpoints

- `GET /api/v1/health` — pure liveness, `200` always once the process is up. **VERIFIED**
  live, in this audit, against the final committed code and a genuinely fresh database.
- `GET /api/v1/health/ready` — public, full diagnostics (database, migrations,
  reconciliation, pending outbox). Live-confirmed `200` with `migrations.appliedCount:
  82`, `reconciliation.status: PASS` against a fresh deployment (§18). Being public
  (unauthenticated) is a minor information-disclosure consideration (exposes app
  version and migration count to anyone who can reach the port) — not a blocker, noted
  as a hardening recommendation.
- `GET /api/v1/internal/readiness` / `GET /api/v1/internal/configuration` — correctly
  gated behind the same `RuntimeAccessGuard` as all other `/internal/*` routes;
  confirmed `401` without credentials.
- **Tag: VERIFIED.**

## 13. Customer Mobile (`apps/customer-mobile`) configuration

- **Found and fixed this audit**: zero environment-based API-URL switching existed.
  `setBaseUrl()` was exported from `api-client.ts` but never called anywhere in the app
  (dead code); `DEFAULT_BASE_URL` was a permanent hardcoded `http://10.0.2.2:3000`
  literal (Android-emulator-only loopback, plain HTTP). Fixed by reading
  `process.env.EXPO_PUBLIC_API_URL` first in `src/config/index.ts` (natively inlined by
  Expo/Metro at build time on the already-pinned Expo `~52.0.7` — no dependency version
  change required), falling back to the original literal for local dev only.
- **Test-verified this audit**: `npx jest --watchAll=false` → **12 suites / 92 tests, all
  passing**, after the fix.
- **Tag: VERIFIED, FIXED.**

## 14. Agent Mobile (`apps/agent-mobile`) configuration

- Same class of defect and same fix as Customer Mobile (`src/config/index.ts` now reads
  `EXPO_PUBLIC_API_URL`).
- **Documentation/reality mismatch found**: `docs/V1/V1-AGENT-MOBILE-17-RELEASE-INFRASTRUCTURE-HANDOFF.md`
  claimed `EXPO_PUBLIC_API_URL` wiring already existed in
  `apps/agent-mobile/src/services/api-client.ts` before this audit. Verified **false**
  via `grep` (zero matches prior to this audit's fix). It is true now. Logged here as an
  example of documentation asserting production-readiness the code did not actually
  support — a caution for trusting any other doc's claims about current code state
  without independent verification, which this audit applied throughout.
- **Test-verified this audit**: **17 suites / 233 tests, all passing**, after the fix.
- **Tag: VERIFIED, FIXED.**

## 15. EAS/build readiness

- **CONFIRMED BLOCKER, not fixed (deliberately — asset/design gap, out of scope to
  fabricate):** `apps/customer-mobile/app.json` references 4 asset files
  (icon/splash/adaptive-icon/favicon) in a non-existent `apps/customer-mobile/assets/`
  directory, and has no `ios.bundleIdentifier`/`android.package` set. Either defect
  alone would fail `expo prebuild`/`eas build` immediately.
- `apps/agent-mobile/app.json` has both `ios.bundleIdentifier` and `android.package`
  correctly set to `ng.monienaija.agent` and no missing-asset problem was found there.
- No `eas.json` build-profile configuration exists for **either** app (confirmed via
  `find`).
- Expo is pinned at `~52.0.7` in both apps; **no version change was made or recommended**
  by this audit, per the explicit constraint to preserve the pinned Expo 52 posture.
- **Tag: BLOCKED** for `apps/customer-mobile` (missing brand assets + bundle
  identifiers + `eas.json`, genuine product/design decisions this audit will not
  fabricate); **REQUIRES REAL INFRASTRUCTURE** for both apps regardless (a real Apple
  Developer / Google Play account and EAS build credentials are needed to actually
  produce a signed, submittable build, which cannot be obtained or verified in this
  sandbox).

## 16. Deployment configuration

- `Dockerfile`: multi-stage, Node 22-alpine, matches `package.json`'s
  `engines.node: ">=22.0.0"`. Does **not** auto-run migrations at container start — this
  matches `DEPLOYMENT.md`'s documented separate manual step (`npm run migration:run`
  under a controlled DB principal, step 4) rather than being an oversight. **VERIFIED,
  intentional**.
- `docker-compose.yml`: defines only a `postgres` service (`postgres:16-alpine`); no
  `app` service. Dev-only convenience, not a production deployment artifact. **NOT
  APPLICABLE** as a production blocker.
- `.github/`: **does not exist anywhere in the repository** (confirmed via `find`) — zero
  CI/CD pipeline. Mitigated in severity by `DEPLOYMENT.md`'s own explicit statement that
  "M8 does not define cloud, Kubernetes, Terraform, CI/CD, or traffic-management
  configuration," i.e. this is declared out of scope for the current milestone, not a
  silent gap. **Tag: MISSING**, but matches the project's own documented scope boundary.
- **Fixed this audit**: `DEPLOYMENT.md`'s "Required inputs" list and
  `PRODUCTION-CHECKLIST.md`'s "Configuration" checklist were both missing any mention of
  the SMS-provider requirement; both updated to reflect the new fail-fast check (§9).
- Rollback policy: documented, forward-only, schema-aware (§6). **VERIFIED, matches
  code behaviour** (no automatic schema-downgrade tooling exists, and none is claimed).

## 17. Backup/recovery

- Zero backup/recovery scripts, automation, or documentation exist anywhere in the
  repository (`find . -iname "*backup*"` returns nothing; `docs/deployment/*.md`
  contains no mention of backup, `pg_dump`, `pg_basebackup`, WAL archiving, or RPO/RTO
  targets, despite `PRODUCTION-CHECKLIST.md` itself listing "Backup and restore evidence
  is current" as a pre-launch checklist item with no corresponding procedure anywhere to
  produce that evidence).
- This is architecturally reasonable — managed PostgreSQL backup/PITR is normally a
  hosting-provider responsibility, not application code — but it means **no RPO/RTO
  policy, no backup-verification runbook, and no disaster-recovery drill procedure is
  defined anywhere in this repository**, and none can be fabricated by this audit
  without inventing operational facts about infrastructure that doesn't exist in this
  sandbox.
- **Tag: REQUIRES REAL INFRASTRUCTURE** (a specific hosting target's native backup/PITR
  capability must be selected and documented before go-live) combined with **MISSING**
  (no backup runbook of any kind exists in the repo today, even a vendor-neutral one).

## 18. Fresh deployment smoke test

Performed twice this audit (once mid-session against staging-shaped config while
investigating the P0 finding; once more, definitively, at final HEAD) — the final run is
reported here in full:

1. **Fresh PostgreSQL**: `DROP DATABASE IF EXISTS`/`CREATE DATABASE monienaija_fresh` on
   the sandbox's embedded PostgreSQL 18.4 — a genuinely empty database, verified via
   direct `pg` client calls (not TypeORM's own empty-check, an independent path).
2. **Dependencies**: `npm ci` already applied (930 packages); final build `npm run build`
   confirmed clean (`tsc`/`nest build`, zero errors) at final HEAD.
3. **Migrations**: `npm run migration:run` (via `typeorm-ts-node-commonjs`) against the
   fresh database — **all 82 migrations applied successfully**, zero errors, in a single
   transaction-wrapped run.
4. **Start**: `node dist/main.js` with `NODE_ENV=production` (true production, not
   staging), a complete, valid, production-shaped A2 workforce configuration (4 finance
   roles, 3 maker-checker rules, rate limits, trusted proxies), `A2_BOOTSTRAP_ENABLED=false`
   (bootstrap ceremony itself independently covered by
   `test/v1-workforce-bootstrap-01.integration.spec.ts`, which passed), and
   `NOTIFICATION_SMS_PROVIDER=robase` with a syntactically valid `robe_`-prefixed key
   (satisfying the new fail-fast check from §9/§20) — **the application started
   successfully** (`"Nest application successfully started"`, capability registry
   seeded 114 capabilities, product catalogue seeded 7 products).
5. **Readiness**: `GET /api/v1/health` → `200 {"status":"ok"}`. `GET
   /api/v1/health/ready` → `200`, `migrations: {status: "ok", appliedCount: 82}`,
   `reconciliation: {status: "PASS"}`, `pendingOutbox: 0`. `GET /api/v1/internal/version`
   → `200`.
6. **Security regression check**: the exact `mock-sandbox-token-FINANCE_ADMIN` exploit
   payload from §8 was replayed against this true-production instance and correctly
   received `401 Unauthorized` — confirming the P0 fix holds under real
   `NODE_ENV=production`, not just under the `staging` value originally used to prove
   the exploit.
7. **Workforce/Support provisioning** (independently re-verified via the full
   PG-integration suite rather than repeated manually against this specific instance,
   since `v1-workforce-bootstrap-01.integration.spec.ts`,
   `v1-ops-01-support-workforce-operational.integration.spec.ts`, and
   `v1-harden-01-support-provision-race.integration.spec.ts` all exercise this exact
   chain against their own freshly migrated databases and all passed).
8. **Cleanup**: process stopped, `monienaija_fresh` database dropped.

No real money movement, real SMS, or non-deterministic test data was used anywhere in
this smoke test, per the task's constraints. **Tag: VERIFIED** for every step above that
was actually executed in this sandbox.

## 19. Core V1 deployment/flow checks

Rather than hand-driving each flow a second time via ad hoc `curl` calls (which would
only reproduce what the automated suite already proves, with strictly less rigor), this
audit relies on the full PG-integration suite — **89 suites / 1,681 tests, all passing**
at final HEAD, each suite running against its own freshly created, fully migrated,
dedicated PostgreSQL database (via `test/support/pg-harness.ts`, which throws rather than
skipping if PostgreSQL is unreachable — there is no silent false-positive path). Coverage
confirmed present and passing for every flow named in the task's Part P:

| Flow | Evidence (passing integration spec) |
|---|---|
| W2W (wallet-to-wallet) | `a5-transfer-lifecycle`, `transaction-boundary` |
| C2W / Agent cash-in | `a13-agent-cash-in` |
| W2C / Agent cash-out | `a14-agent-cash-out`, `a14-otp-hardening` |
| C2C (agent cash-to-cash) | `a15-agent-cash-to-cash`, `a16…-claim`, `a17…-expiry` |
| Customer/Agent funding (W2C M1 scope) | `v1-001-customer-funding`, `a19-agent-funding` |
| Agent authentication | `a7-agent-authentication-http`, `v1-agent-credentials-01`, `v1-agent-mfa-api-01` |
| Customer authentication | `v1-customer-credentials-01`, `v1-customer-onboarding-01/02` |
| Support authentication | `v1-customer-09-support-workforce-boundary`, `v1-harden-01-support-adversarial`, `v1-harden-01-support-provision-race` |
| PIN security | `a24-customer-transaction-pin-hardening`, `v1-customer-05…`, `v1-agent-05…` |
| OTP | `a14-otp-hardening`, `sms-v1-01` |
| Transaction history | `a25-customer-history-hardening`, `hardening-04-customer-transaction-history`, `v1-agent-history-01` |
| Limits | `v1-limit-01` through `v1-limit-05` (catalogue, assignment, usage, runtime, diagnostics, recovery, flow-matrix) |
| Support tickets | `v1-007-support-ticket` |

**Tag: VERIFIED** — every named flow has real, passing, real-PostgreSQL coverage at
final HEAD. This is evidence of correctness under test, not a substitute for a live
pilot with real users, real money rails, or a real SMS provider — those remain **REQUIRES
REAL INFRASTRUCTURE** per §9/§15/§17.

## 20. Dangerous defaults found

| # | Default | Risk | Status |
|---|---|---|---|
| 1 | Workforce OIDC/session mock-sandbox bypass gated on `NODE_ENV !== 'production'` | **P0** — full authentication bypass reachable under `NODE_ENV=staging` on the production image; proven exploitable end-to-end (§8) | **FIXED** |
| 2 | `apps/admin-web` `DEV_AUTH_MOCK` hardcoded `true`, `API_BASE_URL` hardcoded to `localhost` | Client-side fabricated privileged session + non-functional API calls if ever deployed as-is | **FIXED**, production-bundle-verified |
| 3 | `NOTIFICATION_SMS_PROVIDER` defaulting to `console` with no production guardrail | Silently non-functional OTP delivery in production + plaintext OTP codes in server logs | **FIXED** (fail-fast on `NODE_ENV=production`) |
| 4 | Customer/Agent Mobile hardcoded `http://10.0.2.2:3000` (HTTP, emulator-only loopback), no env switching at all | App literally cannot reach a real API host in any real build | **FIXED** |
| 5 | CORS unconfigured | Fails safe, but blocks any legitimate cross-origin admin-web deployment until configured | **NOT FIXED** — flagged as a deployment-topology recommendation, not a security hole (fails closed, not open) |
| 6 | `.env.example` missing 14 schema-validated variables (SMS/notification-worker/commercial-accounting) | Operators following the example file would not discover these knobs exist | **FIXED** (`.env.example` completed) |
| 7 | No DB connection-pool tuning | Works on framework/driver defaults; not dangerous, just unoptimized for unknown production load | Not fixed — recommendation only |

No hardcoded database credentials, no default admin/test accounts seeded into any
migration, and no disabled-by-default authentication guard were found anywhere else in
the codebase (the global `RuntimeAccessGuard` fail-closed design was independently
confirmed in §10 and in a prior session's full read of `route-policy-registry.ts`).

## 21. Unknown-unknown findings

Investigated with evidence rather than speculation, per the task's explicit requirement:

- **The single biggest unknown-unknown this audit surfaced was the workforce
  OIDC/session mock-sandbox bypass (§8)** — it was not something the task's own Part F
  checklist named specifically (it asks generically to "hunt dev bypasses"), and its
  true severity (exploitable under `staging`, not just some impossible-to-reach
  "non-production" state) only became apparent after reading `environment.ts`'s own
  `NODE_ENV` enum and cross-referencing it against the project's own staging-hostname
  documentation. This is exactly the class of risk the "unknown-unknowns" requirement
  exists to catch: a control that looked closed on a surface read ("gated to
  non-production") and was actually open under a realistic, named, documented
  deployment tier.
- **Documentation claiming code behaviour that did not exist**: found twice —
  `V1-AGENT-MOBILE-17-RELEASE-INFRASTRUCTURE-HANDOFF.md` claiming
  `EXPO_PUBLIC_API_URL` wiring that didn't exist (§14), and the workforce-bootstrap
  template's "dead code in production" claim about the mock-sandbox bypass that this
  audit found too narrow (§8). Treated as a standing caution: every claim in this audit
  about current code state was independently verified by reading the actual source or
  running the actual code, not by trusting prior documentation.
- **The `console` SMS provider logging OTP codes in plaintext via a code path
  (`console.log`) that completely bypasses the otherwise-careful pino redaction layer**
  (§9/§11/§20) was found by tracing an actual data value (the OTP code) through the
  system from generation to its eventual sink, rather than by reviewing the logging
  configuration in isolation — the redaction list is comprehensive, but a comprehensive
  redaction list only protects paths that actually go through the logger it's attached
  to.
- **Investigated and ruled out**: hardcoded database credentials, seeded default/test
  accounts in any migration, a disabled global auth guard, and permissive CORS-as-a-code
  misconfiguration — none were found. Investigated and found genuinely absent, not
  "assumed absent."

## 22. Exact blockers (preventing a real production go-live today)

1. **`apps/customer-mobile` cannot be built for app-store submission**: missing brand
   assets (`apps/customer-mobile/assets/` directory does not exist, referenced by
   `app.json`) and missing `ios.bundleIdentifier`/`android.package`; no `eas.json` for
   either mobile app. Deliberately not fixed by fabricating placeholder brand identity —
   a genuine product/design decision, not a code defect.
2. **No backup/recovery runbook or verified backup capability exists** (§17) — launching
   without one means data loss has no recovery path, regardless of code quality.
3. **No real SMS provider account is available to this audit** — the code path is
   correct and now fail-fast-protected, but actual SMS delivery to a real handset cannot
   be confirmed without a live Robase credential (§9).
4. **No CI/CD pipeline exists** (§16) — mitigated by the project's own documented scope
   exclusion for the current milestone, but still a real operational gap before
   repeated, safe releases are practical.

All four of the above require either real infrastructure/credentials or a genuine
product decision (brand assets) that this audit cannot and should not fabricate.

## 23. Exact fixes applied this audit

All applied under commit message `release: harden production deployment readiness`
(three commits: `f25b8bd`, `d62bf1e`, `a33ddd7`), each independently verified
(build/lint/tests) before commit, with git status/HEAD/parent/file-list verified before
and after each commit and push per the task's strict git rules:

1. **P0 — narrowed the workforce OIDC mock-sandbox bypass** gate from `NODE_ENV !==
   'production'` to `NODE_ENV === 'development' || 'test'` in
   `workforce-oidc.service.ts`, and the matching `workforce-session.service.ts`
   companion gate for the same `mock-sandbox-subject` bypass. Re-verified live, before
   and after, against real `staging`, `development`, and true `production` instances.
2. **`apps/admin-web`** — `DEV_AUTH_MOCK` now derives from `NODE_ENV`; `API_BASE_URL` is
   env-overridable via `ADMIN_WEB_API_BASE_URL`, wired through `vite.config.ts`'s
   `define` block, falling back to same-origin `/api/v1` in production. Verified against
   the actual built production bundle.
3. **`apps/customer-mobile` and `apps/agent-mobile`** `src/config/index.ts` — now read
   `process.env.EXPO_PUBLIC_API_URL` at build time, falling back to the original dev
   literal. No Expo/RN version change made.
4. **Production SMS-provider fail-fast** — `src/config/environment.ts` now rejects
   `NODE_ENV=production` unless `NOTIFICATION_SMS_PROVIDER=robase`. Three new regression
   tests added to `test/environment.spec.ts`.
5. **New regression test** `test/v1-release-01-production-readiness-migration-sync.integration.spec.ts`
   closes the gap that let the migration-constant P0 (fixed in an earlier session)
   regress undetected twice before; proven to actually catch the regression.
6. **Documentation accuracy fixes**: `docs/deployment/config/v1-workforce-bootstrap.env.template`
   corrected to describe the real risk and the real (narrowed) gate;
   `docs/deployment/DEPLOYMENT.md` and `docs/deployment/PRODUCTION-CHECKLIST.md` updated
   to list the new SMS-provider production requirement; `.env.example` completed with 14
   previously-undocumented schema-validated variables.

**Testing performed after every fix, exact counts, nothing weakened:**
- Backend unit: `npm test` → **173 suites / 1,806 tests, all passing** (final run at
  final HEAD).
- Backend PostgreSQL integration: `npm run test:pg` → **89 suites / 1,681 tests, all
  passing** (final run at final HEAD, ~22.5 minutes wall clock).
- `apps/customer-mobile`: `npx jest --watchAll=false` → **12 suites / 92 tests, all
  passing**.
- `apps/agent-mobile`: `npx jest --watchAll=false` → **17 suites / 233 tests, all
  passing**.
- `apps/admin-web`: `npx tsc` clean; `npx jest` → **6 suites / 21 tests, all passing**
  (from an earlier session, carried forward unchanged since no admin-web file changed
  further this session); production `npm run build` bundle independently inspected.
- `npm run build` (backend) and `npx tsc --noEmit`: clean, zero errors, at final HEAD.
- `npm run lint`: pre-existing repo-wide lint debt (1,278 problems) confirmed **not
  introduced by this audit** — every file touched by this audit was individually
  linted and is clean except one pre-existing, untouched line
  (`workforce-oidc.service.ts:42`, an unused `role` variable that predates this audit,
  confirmed via `git show HEAD -- <file> | eslint --stdin`). No unrelated lint fixes
  were made, per the "no unrelated refactoring" constraint.

## 24. Items requiring real infrastructure (cannot be verified from this repo/sandbox)

1. Live SMS delivery via a real Robase account to a real Nigerian handset (§9).
2. Mobile app-store build/signing via real Apple Developer / Google Play credentials and
   EAS build credentials (§15) — code-level blockers for `apps/customer-mobile` are
   separately listed in §22 and are not infrastructure-dependent.
3. Database storage-level encryption at rest, connection-level TLS against a real hosted
   PostgreSQL endpoint, and connection-pool tuning against real production load (§5,
   §10).
4. A concrete, verified backup/restore/PITR capability and a tested disaster-recovery
   drill against a real hosting target (§17).
5. Confirmation that a real reverse proxy/load balancer in front of the application
   terminates TLS and (optionally, defense-in-depth) restricts `/internal/*` at the
   network layer — the application does not depend on this, but real deployments
   typically layer it on top (§10).
6. A real CI/CD pipeline, which the project's own documentation explicitly defers past
   the current milestone (§16).

## 25. Final recommendation

**B. VERIFIED — P0/P1 FIXES IMPLEMENTED**

The application's **code-level** production readiness improved substantially during this
audit: one critical (P0) authentication-bypass vulnerability was found, proven
exploitable end-to-end, fixed, and re-verified closed under the exact conditions that
made it dangerous (a `staging`-tagged deployment of the production image); one dangerous
default that would have silently broken the core customer-registration/OTP flow in
production while leaking OTP codes to logs was found and closed with a fail-fast
guardrail; the two mobile apps and the admin web console were fixed from having no
real environment-based API configuration at all to having one, verified against actual
built artifacts and passing test suites; a second-order regression gap (the migration-
constant drift that had already bitten this project twice) was closed with a real,
self-proving regression test. All 173 backend unit suites (1,806 tests), all 89
PostgreSQL integration suites (1,681 tests against a real, freshly migrated database
each), and all 29 mobile test suites (325 tests) pass at the final commit. A genuinely
fresh deployment — empty database, full 82-migration chain, true `NODE_ENV=production`,
production-shaped configuration — was built, started, and brought to a passing
readiness state live in this sandbox, with the P0 exploit re-attempted and confirmed
blocked under those exact conditions.

This is **not** the same claim as "ready to onboard real customers and move real money
today." Four concrete items remain outside what any code change in this repository can
resolve (§22, §24): `apps/customer-mobile` is missing real brand assets and bundle
identifiers needed to even attempt an app-store build; no backup/recovery capability or
runbook exists anywhere in the repository; no live SMS-provider credential is available
to confirm real OTP delivery; and no CI/CD pipeline exists (a gap the project's own
documentation has already, explicitly, deferred past this milestone). None of these four
are code defects this audit could fix without fabricating product decisions, credentials,
or infrastructure that do not exist in this environment — and the task's own standing
instruction is to classify such items honestly rather than paper over them with an "A"
rating.

**Code readiness: high, and meaningfully improved by this audit's fixes.**
**Real-world infrastructure readiness: incomplete**, pending the four items in §22/§24,
none of which are blocked on further code changes — they are blocked on product/asset
decisions, credentials, and operational runbooks that are outside this repository's
current state.
